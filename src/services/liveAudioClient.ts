import { auth } from './firebase';
import type { LiveConnectionState, TutorLanguage } from '../types';

export interface LiveToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LiveCallbacks {
  onStatusChange: (status: LiveConnectionState) => void;
  onInputTranscript: (text: string) => void;
  onOutputTranscript: (text: string) => void;
  onTurnComplete: () => void;
  onPlaybackIdle: () => void;
  onToolCall: (call: LiveToolCall) => void;
  onError: (message: string) => void;
}

function downsampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (!fromRate || fromRate === 16000) return input;
  const ratio = fromRate / 16000;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0;
    result[i] = s0 + (s1 - s0) * frac;
  }
  return result;
}

function pcmFloat32ToBase64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

async function compressImageForLive(dataUrl: string, maxWidth = 960): Promise<string> {
  if (!dataUrl || dataUrl.length < 180000) return dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private nextStartTime = 0;
  private isMuted = false;
  private isPaused = false;
  private callbacks: LiveCallbacks;
  private idleTimer: number | null = null;
  private connectTimer: number | null = null;
  private turnEnded = false;
  private isSessionConnected = false;
  private manualDisconnect = false;
  private hasErrorStatus = false;
  private audioGeneration = 0;
  private pendingContexts: { text: string; image?: string; expectReply: boolean }[] = [];

  constructor(callbacks: LiveCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(options: {
    lang: TutorLanguage;
    voiceName: string;
    mode: 'tutor' | 'oral_exam';
  }): Promise<void> {
    this.teardownInternal(false);
    this.manualDisconnect = false;
    this.hasErrorStatus = false;
    this.callbacks.onStatusChange('connecting');

    // Unlock AudioContexts synchronously inside the user-click gesture before awaiting network/mic
    try {
      this.outputCtx = new AudioContext({ sampleRate: 24000 });
    } catch {
      this.outputCtx = new AudioContext();
    }
    void this.outputCtx.resume().catch(() => {});
    this.nextStartTime = this.outputCtx.currentTime;

    const user = auth.currentUser;
    if (!user) {
      this.cleanupAudioOnly();
      this.callbacks.onError('يرجى تسجيل الدخول بحساب Google لاستخدام الاتصال الصوتي.');
      this.callbacks.onStatusChange('error');
      return;
    }

    let token = '';
    try {
      token = await user.getIdToken();
    } catch {
      this.cleanupAudioOnly();
      this.callbacks.onError('تعذر التحقق من جلسة الحساب. أعد تحميل الصفحة ثم حاول مجدداً.');
      this.callbacks.onStatusChange('error');
      return;
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch {
      this.cleanupAudioOnly();
      this.callbacks.onError('تعذر الوصول إلى الميكروفون. يرجى السماح بصلاحية الميكروفون من المتصفح ثم المحاولة.');
      this.callbacks.onStatusChange('error');
      return;
    }

    try {
      try {
        this.inputCtx = new AudioContext({ sampleRate: 16000 });
        this.sourceNode = this.inputCtx.createMediaStreamSource(this.mediaStream);
      } catch {
        if (this.inputCtx) {
          void this.inputCtx.close().catch(() => {});
        }
        this.inputCtx = new AudioContext();
        this.sourceNode = this.inputCtx.createMediaStreamSource(this.mediaStream);
      }
      await this.inputCtx.resume().catch(() => {});
      await this.outputCtx.resume().catch(() => {});
    } catch {
      this.cleanupAudioOnly();
      this.callbacks.onError('تعذر تشغيل معالجة الصوت في المتصفح.');
      this.callbacks.onStatusChange('error');
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/api/live?token=${encodeURIComponent(
      token
    )}&lang=${encodeURIComponent(options.lang)}&voice=${encodeURIComponent(
      options.voiceName || 'Zephyr'
    )}&mode=${encodeURIComponent(options.mode)}`;

    this.ws = new WebSocket(wsUrl);

    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
    }
    this.connectTimer = window.setTimeout(() => {
      if (!this.isSessionConnected && !this.manualDisconnect) {
        this.hasErrorStatus = true;
        this.callbacks.onError('انتهت مهلة الاتصال بالمعلم المباشر (Gemini 3.8 Live). يرجى المحاولة مرة أخرى.');
        this.callbacks.onStatusChange('error');
        this.teardownInternal(false);
      }
    }, 18000);

    this.ws.onopen = () => {
      if (!this.inputCtx || !this.sourceNode) return;
      try {
        this.processor = this.inputCtx.createScriptProcessor(4096, 1, 1);
        this.sourceNode.connect(this.processor);
        this.processor.connect(this.inputCtx.destination);

        const actualRate = this.inputCtx.sampleRate || 16000;
        this.processor.onaudioprocess = (event) => {
          if (this.isMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isSessionConnected) return;
          const channel = event.inputBuffer.getChannelData(0);
          const resampled = actualRate === 16000 ? channel : downsampleTo16k(channel, actualRate);
          const base64 = pcmFloat32ToBase64(resampled);
          this.ws.send(JSON.stringify({ type: 'audio', audio: base64 }));
        };
      } catch {
        this.hasErrorStatus = true;
        this.callbacks.onError('تعذر تفعيل التقاط صوت الميكروفون.');
        this.callbacks.onStatusChange('error');
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          status?: LiveConnectionState;
          audio?: string;
          text?: string;
          message?: string;
          call?: LiveToolCall;
        };

        if (msg.type === 'status' && msg.status) {
          if (msg.status === 'connected') {
            if (this.connectTimer !== null) {
              window.clearTimeout(this.connectTimer);
              this.connectTimer = null;
            }
            this.isSessionConnected = true;
            this.hasErrorStatus = false;
            void this.flushPendingContexts();
            this.callbacks.onStatusChange('listening');
          } else {
            if (msg.status === 'error') {
              this.hasErrorStatus = true;
              this.isSessionConnected = false;
              if (this.connectTimer !== null) {
                window.clearTimeout(this.connectTimer);
                this.connectTimer = null;
              }
            } else if (msg.status === 'reconnecting' || msg.status === 'disconnected') {
              this.isSessionConnected = false;
            }
            this.callbacks.onStatusChange(msg.status);
          }
        } else if (msg.type === 'audio' && msg.audio) {
          if (!this.isPaused) {
            this.turnEnded = false;
            this.callbacks.onStatusChange('speaking');
            this.playPcmChunk(msg.audio);
          }
        } else if (msg.type === 'interrupted') {
          this.stopPlaybackQueue();
          this.callbacks.onStatusChange('listening');
        } else if (msg.type === 'inputTranscript' && msg.text) {
          this.callbacks.onInputTranscript(msg.text);
        } else if (msg.type === 'outputTranscript' && msg.text) {
          this.callbacks.onOutputTranscript(msg.text);
        } else if (msg.type === 'turnComplete') {
          this.turnEnded = true;
          this.callbacks.onTurnComplete();
          this.schedulePlaybackIdleCheck();
        } else if (msg.type === 'toolCall' && msg.call) {
          this.callbacks.onToolCall(msg.call);
        } else if (msg.type === 'error' && msg.message) {
          this.hasErrorStatus = true;
          this.callbacks.onError(msg.message);
        }
      } catch {
        // Ignore malformed server payload
      }
    };

    this.ws.onerror = () => {
      if (this.connectTimer !== null) {
        window.clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      this.isSessionConnected = false;
      this.hasErrorStatus = true;
      this.callbacks.onError('تعذر الاتصال بخادم المكالمة المباشرة. تأكد من اتصال الإنترنت ثم حاول مجدداً.');
      this.callbacks.onStatusChange('error');
    };

    this.ws.onclose = () => {
      if (this.connectTimer !== null) {
        window.clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      const wasConnected = this.isSessionConnected;
      this.isSessionConnected = false;
      this.cleanupAudioOnly();

      if (this.manualDisconnect) {
        this.callbacks.onStatusChange('disconnected');
      } else if (this.hasErrorStatus) {
        this.callbacks.onStatusChange('error');
      } else if (!wasConnected) {
        this.callbacks.onError('أُغلق الاتصال قبل بدء الجلسة الصوتية. تأكد من صلاحية الحساب واتصال الإنترنت.');
        this.callbacks.onStatusChange('error');
      } else {
        this.callbacks.onStatusChange('disconnected');
      }
    };
  }

  private playPcmChunk(base64Audio: string) {
    if (!this.outputCtx || this.isPaused) return;
    if (this.outputCtx.state === 'suspended') {
      void this.outputCtx.resume();
    }
    const gen = this.audioGeneration;
    const floatData = base64PcmToFloat32(base64Audio);
    const audioBuffer = this.outputCtx.createBuffer(1, floatData.length, 24000);
    audioBuffer.getChannelData(0).set(floatData);

    const source = this.outputCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputCtx.destination);

    const now = this.outputCtx.currentTime;
    if (this.nextStartTime < now || this.nextStartTime - now > 20) {
      this.nextStartTime = now + 0.02;
    }
    const startAt = Math.max(now + 0.015, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + audioBuffer.duration;
    this.activeSources.add(source);

    source.onended = () => {
      if (gen !== this.audioGeneration) return;
      this.activeSources.delete(source);
      if (this.activeSources.size === 0) {
        this.callbacks.onStatusChange(this.isPaused ? 'paused' : 'listening');
        if (this.turnEnded) {
          this.schedulePlaybackIdleCheck();
        }
      }
    };
  }

  private schedulePlaybackIdleCheck() {
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
    }
    const remainingMs = this.outputCtx
      ? Math.max(50, (this.nextStartTime - this.outputCtx.currentTime) * 1000 + 120)
      : 150;
    this.idleTimer = window.setTimeout(() => {
      if (this.activeSources.size === 0 && this.turnEnded) {
        this.callbacks.onPlaybackIdle();
      }
    }, remainingMs);
  }

  stopPlaybackQueue() {
    this.audioGeneration += 1;
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.activeSources.forEach((src) => {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already stopped source
      }
    });
    this.activeSources.clear();
    if (this.outputCtx) {
      this.nextStartTime = this.outputCtx.currentTime;
    }
  }

  setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  pausePlayback() {
    this.isPaused = true;
    this.stopPlaybackQueue();
    this.callbacks.onStatusChange('paused');
  }

  resumePlayback() {
    this.isPaused = false;
    this.callbacks.onStatusChange('listening');
  }

  private async flushPendingContexts() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isSessionConnected) return;
    while (this.pendingContexts.length > 0) {
      const next = this.pendingContexts.shift();
      if (next) {
        const compressedImg = next.image ? await compressImageForLive(next.image) : undefined;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isSessionConnected) return;
        this.ws.send(
          JSON.stringify({
            type: 'contextUpdate',
            text: next.text,
            image: compressedImg,
            expectReply: next.expectReply,
          })
        );
      }
    }
  }

  sendContextUpdate(text: string, imageDataUrl?: string, expectReply = false) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isSessionConnected) {
      // Queue latest context so it is sent immediately once Gemini Live finishes setup
      this.pendingContexts = [{ text, image: imageDataUrl, expectReply }];
      return;
    }
    void (async () => {
      const compressedImg = imageDataUrl ? await compressImageForLive(imageDataUrl) : undefined;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isSessionConnected) {
        this.pendingContexts = [{ text, image: imageDataUrl, expectReply }];
        return;
      }
      this.ws.send(
        JSON.stringify({
          type: 'contextUpdate',
          text,
          image: compressedImg,
          expectReply,
        })
      );
    })();
  }

  sendTextPrompt(text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'text', text }));
  }

  sendToolResult(id: string, name: string, response: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'toolResult', id, name, response }));
  }

  private cleanupAudioOnly() {
    this.stopPlaybackQueue();
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch {
        // Ignore
      }
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // Ignore
      }
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.inputCtx) {
      void this.inputCtx.close().catch(() => {});
      this.inputCtx = null;
    }
    if (this.outputCtx) {
      void this.outputCtx.close().catch(() => {});
      this.outputCtx = null;
    }
  }

  private teardownInternal(notifyDisconnected: boolean) {
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.isSessionConnected = false;
    this.pendingContexts = [];
    this.cleanupAudioOnly();
    if (this.ws) {
      try {
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }
    if (notifyDisconnected) {
      this.callbacks.onStatusChange('disconnected');
    }
  }

  disconnect() {
    this.manualDisconnect = true;
    this.teardownInternal(true);
  }
}
