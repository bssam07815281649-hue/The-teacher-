import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  ListTree,
  Bookmark,
  CheckCircle2,
  Circle,
  Send,
  Volume2,
  Mic,
  Square,
  X,
  BookOpen,
  BookmarkPlus,
  BookmarkCheck,
  Loader2,
  ClipboardList,
} from 'lucide-react';
import { transcribeChatAudio } from '../services/aiClient';
import type {
  Book,
  BookPage,
  ChapterItem,
  ChatMessage,
  ImportantTaskItem,
  LiveConnectionState,
  PageAudioState,
  TutorLanguage,
} from '../types';
import { PageImageViewer } from './PageImageViewer';

interface LearnSectionProps {
  books: Book[];
  activeBook: Book | null;
  currentPageNumber: number;
  currentPageData: BookPage | null;
  loadingPage: boolean;
  pageZoom: number;
  onPageZoomChange: (z: number) => void;
  tutorLanguage: TutorLanguage;
  voiceName: string;
  chatMessages: ChatMessage[];
  chatSending: boolean;
  onSelectBook: (book: Book) => void;
  onNavigatePage: (pageNumber: number) => void;
  onSaveProgressCheckpoint: () => Promise<void>;
  onTogglePageCompleted: () => Promise<void>;
  pageAudio: PageAudioState;
  isPageAudioLocked: boolean;
  onStartPageAudio: () => void;
  onSendChat: (text: string, options?: { selectedText?: string; selectedImage?: string }) => Promise<void>;
  onQuickSelectionAction: (
    action: 'explain' | 'example' | 'explain_diagram',
    payload: { selectedText?: string; croppedImage?: string }
  ) => Promise<void>;
  onSaveNote: (note: {
    title: string;
    content: string;
    selectedText?: string;
    noteType: 'selection' | 'explanation' | 'diagram' | 'manual';
  }) => Promise<void>;
  onOpenNotesDrawer: () => void;
  onExtractImportantTasks: (scope: 'page' | 'chapter') => Promise<ImportantTaskItem[]>;
  onStartExamFromTasks: (tasks: ImportantTaskItem[]) => void;
  // Live Voice Props
  liveState: LiveConnectionState;
  liveMuted: boolean;
  liveInputDraft: string;
  liveOutputDraft: string;
  liveError: string;
  autoAdvanceEnabled: boolean;
  autoAdvanceMode: 'read' | 'explain';
  onStartLiveCall: () => Promise<void>;
  onEndLiveCall: () => void;
  onToggleLiveMute: () => void;
  onPauseLive: () => void;
  onResumeLive: () => void;
  onSendCroppedToLive: (croppedDataUrl: string) => void;
  onToggleAutoAdvance: (enabled: boolean, mode?: 'read' | 'explain') => void;
  onGoToLibrary: () => void;
}

export const LearnSection: React.FC<LearnSectionProps> = ({
  books,
  activeBook,
  currentPageNumber,
  currentPageData,
  loadingPage,
  pageZoom,
  onPageZoomChange,
  tutorLanguage,
  chatMessages,
  chatSending,
  onSelectBook,
  onNavigatePage,
  onSaveProgressCheckpoint,
  onTogglePageCompleted,
  pageAudio,
  isPageAudioLocked,
  onStartPageAudio,
  onSendChat,
  onQuickSelectionAction,
  onSaveNote,
  onOpenNotesDrawer,
  onExtractImportantTasks,
  onStartExamFromTasks,
  liveState,
  liveMuted,
  liveInputDraft,
  liveOutputDraft,
  autoAdvanceEnabled,
  autoAdvanceMode,
  onStartLiveCall,
  onEndLiveCall,
  onToggleLiveMute,
  onSendCroppedToLive,
  onToggleAutoAdvance,
  onGoToLibrary,
}) => {
  const [sliderPreviewPage, setSliderPreviewPage] = useState<number | null>(null);
  const [pageInput, setPageInput] = useState('');
  const [tocOpen, setTocOpen] = useState(false);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [savingCheckpoint, setSavingCheckpoint] = useState(false);

  // Important tasks panel
  const [tasksModalOpen, setTasksModalOpen] = useState(false);
  const [extractingTasks, setExtractingTasks] = useState(false);
  const [extractedTasks, setExtractedTasks] = useState<ImportantTaskItem[]>([]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Voice chat recording state
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordError, setRecordError] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordCancelledRef = useRef(false);

  useEffect(() => {
    setCroppedImage(null);
  }, [activeBook?.id, currentPageNumber]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length, liveInputDraft, liveOutputDraft]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const currentChapter: ChapterItem | null = useMemo(() => {
    if (!activeBook?.chapters || activeBook.chapters.length === 0) return null;
    const sorted = [...activeBook.chapters].sort((a, b) => a.startPage - b.startPage);
    let matched: ChapterItem | null = null;
    for (const ch of sorted) {
      if (ch.startPage <= currentPageNumber) matched = ch;
    }
    return matched;
  }, [activeBook?.chapters, currentPageNumber]);

  const visiblePageStrip = useMemo(() => {
    if (!activeBook) return [];
    const total = activeBook.totalPages;
    const start = Math.max(1, currentPageNumber - 4);
    const end = Math.min(total, currentPageNumber + 4);
    const nums: number[] = [];
    for (let p = start; p <= end; p++) nums.push(p);
    return nums;
  }, [activeBook, currentPageNumber]);

  const handleJumpPageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBook) return;
    const num = parseInt(pageInput.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))), 10);
    if (!Number.isNaN(num) && num >= 1 && num <= activeBook.totalPages) {
      onNavigatePage(num);
      setPageInput('');
    }
  };

  const handleSendChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = chatInput.trim();
    if (!q || chatSending) return;
    setChatInput('');
    setRecordError('');
    if (autoAdvanceEnabled) {
      // Pause auto-advance when student asks a question
      onToggleAutoAdvance(false);
    }
    await onSendChat(q, {
      selectedImage: croppedImage || undefined,
    });
  };

  const cleanupRecordingStream = () => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
  };

  const startVoiceRecording = async () => {
    if (recordingState !== 'idle' || chatSending) return;
    setRecordError('');

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecordError('المتصفح الحالي لا يدعم تسجيل الصوت.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeCandidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const supportedMime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);

      recordChunksRef.current = [];
      recordCancelledRef.current = false;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const mimeType = recorder.mimeType || supportedMime || 'audio/webm';
        const chunks = [...recordChunksRef.current];
        recordChunksRef.current = [];
        cleanupRecordingStream();

        if (recordCancelledRef.current || chunks.length === 0) {
          setRecordingState('idle');
          setRecordSeconds(0);
          return;
        }

        const audioBlob = new Blob(chunks, { type: mimeType });
        if (audioBlob.size < 300) {
          setRecordingState('idle');
          setRecordSeconds(0);
          setRecordError('التسجيل قصير جداً، تحدث بوضوح ثم اضغط إرسال الصوت.');
          return;
        }

        setRecordingState('transcribing');
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const res = typeof reader.result === 'string' ? reader.result : '';
              const b64 = res.includes(',') ? res.split(',')[1] : res;
              resolve(b64);
            };
            reader.onerror = () => reject(new Error('تعذر قراءة الملف الصوتي.'));
            reader.readAsDataURL(audioBlob);
          });

          const { transcript } = await transcribeChatAudio({
            audioBase64: base64,
            mimeType: mimeType.split(';')[0] || 'audio/webm',
            tutorLanguage,
          });

          const cleanText = transcript.trim();
          if (!cleanText) {
            setRecordingState('idle');
            setRecordSeconds(0);
            setRecordError('لم يتم التقاط كلام واضح، حاول التحدث بصوت أوضح.');
            return;
          }

          setRecordingState('idle');
          setRecordSeconds(0);
          if (autoAdvanceEnabled) {
            onToggleAutoAdvance(false);
          }
          await onSendChat(cleanText, {
            selectedImage: croppedImage || undefined,
          });
        } catch (err) {
          setRecordingState('idle');
          setRecordSeconds(0);
          setRecordError(
            err instanceof Error && err.message
              ? err.message
              : 'تعذر تحويل التسجيل الصوتي إلى نص.'
          );
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setRecordingState('recording');
      setRecordSeconds(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      cleanupRecordingStream();
      setRecordingState('idle');
      setRecordError('يرجى السماح بالوصول إلى الميكروفون لتسجيل سؤالك الصوتي.');
    }
  };

  const stopAndSendRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      recordCancelledRef.current = false;
      try {
        mediaRecorderRef.current.requestData?.();
      } catch {
        // ignore if unsupported
      }
      mediaRecorderRef.current.stop();
    }
  };

  const cancelVoiceRecording = () => {
    recordCancelledRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      cleanupRecordingStream();
      setRecordingState('idle');
      setRecordSeconds(0);
    }
  };

  const formatRecordTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleExtractTasksClick = async (scope: 'page' | 'chapter') => {
    setTasksModalOpen(true);
    setExtractingTasks(true);
    try {
      const items = await onExtractImportantTasks(scope);
      setExtractedTasks(items);
    } finally {
      setExtractingTasks(false);
    }
  };

  if (!activeBook) {
    return (
      <section className="max-w-4xl mx-auto px-4 py-14 text-center space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 flex items-center justify-center mx-auto">
          <BookOpen className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            اختر كتاباً لبدء الدراسة
          </h1>
        </div>

        {books.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            {books.slice(0, 6).map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onSelectBook(b)}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-500 text-sm font-semibold cursor-pointer"
              >
                {b.title} (ص {b.lastPage})
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={onGoToLibrary}
            className="min-h-[46px] px-6 rounded-xl bg-blue-700 text-white font-semibold text-sm cursor-pointer"
          >
            الانتقال إلى مكتبتي
          </button>
        )}
      </section>
    );
  }

  const isCompleted = Boolean(currentPageData?.isCompleted);
  const displayPageNum = sliderPreviewPage ?? currentPageNumber;

  return (
    <section className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5">
      {/* 1. Book Name & Current Chapter */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <select
              value={activeBook.id}
              onChange={(e) => {
                const found = books.find((b) => b.id === e.target.value);
                if (found) onSelectBook(found);
              }}
              aria-label="تبديل الكتاب المفتوح"
              className="font-display font-bold text-base sm:text-lg text-slate-900 dark:text-white bg-transparent border-b border-dashed border-slate-300 dark:border-slate-700 pb-0.5 max-w-full truncate cursor-pointer focus:outline-none"
            >
              {books.map((b) => (
                <option key={b.id} value={b.id} className="bg-white dark:bg-slate-900 text-sm">
                  {b.title}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 truncate">
            {currentPageData?.chapterTitle || currentChapter?.title || activeBook.subject || 'الدراسة العامة'}
            {currentPageData?.printedPageLabel &&
              currentPageData.printedPageLabel !== String(currentPageNumber) && (
                <span> · الصفحة المطبوعة: {currentPageData.printedPageLabel}</span>
              )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void onTogglePageCompleted()}
            className={`min-h-[42px] px-3.5 rounded-xl text-xs sm:text-sm font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
              isCompleted
                ? 'bg-teal-700 text-white border-teal-700'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-teal-50 dark:hover:bg-teal-950/30'
            }`}
          >
            {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
            <span>{isCompleted ? 'صفحة مكتملة' : 'تحديد كمكتملة'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenNotesDrawer}
            className="min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Bookmark className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <span>الملاحظات</span>
          </button>

          <button
            type="button"
            onClick={() => setTocOpen(true)}
            className="min-h-[42px] px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <ListTree className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            <span>الفهرس</span>
          </button>
        </div>
      </div>

      {/* 2. Fast Page Navigation Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPageNumber <= 1}
              onClick={() => onNavigatePage(currentPageNumber - 1)}
              className="min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-sm font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
              <span>السابقة</span>
            </button>

            <span className="px-2 sm:px-3 text-sm font-semibold font-mono-num text-slate-800 dark:text-slate-200">
              {displayPageNum} / {activeBook.totalPages}
            </span>

            <button
              type="button"
              disabled={currentPageNumber >= activeBook.totalPages}
              onClick={() => onNavigatePage(currentPageNumber + 1)}
              className="min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-sm font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-40"
            >
              <span>التالية</span>
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Explicit Continue-Progress Checkpoint Button */}
            <button
              type="button"
              disabled={savingCheckpoint}
              onClick={async () => {
                setSavingCheckpoint(true);
                try {
                  await onSaveProgressCheckpoint();
                } finally {
                  setSavingCheckpoint(false);
                }
              }}
              className={`min-h-[42px] px-3.5 rounded-xl text-xs sm:text-sm font-semibold border flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeBook.lastPage === currentPageNumber
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800 hover:bg-teal-100 dark:hover:bg-teal-900/50'
              }`}
            >
              <BookmarkCheck className="w-4 h-4 shrink-0" />
              <span>
                {activeBook.lastPage === currentPageNumber
                  ? `نقطة التقدم الحالية (ص ${currentPageNumber})`
                  : 'حفظ مواصلة التقدم هنا'}
              </span>
            </button>

            {activeBook.lastPage > 0 && activeBook.lastPage !== currentPageNumber && (
              <button
                type="button"
                onClick={() => onNavigatePage(activeBook.lastPage)}
                className="min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 cursor-pointer"
              >
                متابعة من ص {activeBook.lastPage}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {activeBook.chapters && activeBook.chapters.length > 0 && (
              <select
                value={currentChapter?.id || ''}
                onChange={(e) => {
                  const found = activeBook.chapters.find((c) => c.id === e.target.value);
                  if (found) onNavigatePage(found.startPage);
                }}
                aria-label="الانتقال إلى فصل"
                className="min-h-[42px] max-w-[190px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-700 dark:text-slate-200 truncate cursor-pointer"
              >
                <option value="" disabled>
                  الفصول والموضوعات...
                </option>
                {activeBook.chapters.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.title} (ص {ch.startPage})
                  </option>
                ))}
              </select>
            )}

            <form onSubmit={handleJumpPageSubmit} className="flex items-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                placeholder="رقم صفحة..."
                className="w-24 min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-mono-num text-center"
              />
              <button
                type="submit"
                className="min-h-[42px] px-3.5 rounded-xl bg-blue-700 text-white text-xs sm:text-sm font-semibold cursor-pointer"
              >
                انتقال
              </button>
            </form>
          </div>
        </div>

        {/* Fast Drag Slider (shows target page while dragging, loads ONLY on release) */}
        {activeBook.totalPages > 1 && (
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono-num text-slate-400">1</span>
            <input
              type="range"
              min={1}
              max={activeBook.totalPages}
              value={displayPageNum}
              onChange={(e) => setSliderPreviewPage(Number(e.target.value))}
              onMouseUp={() => {
                if (sliderPreviewPage !== null) {
                  onNavigatePage(sliderPreviewPage);
                  setSliderPreviewPage(null);
                }
              }}
              onTouchEnd={() => {
                if (sliderPreviewPage !== null) {
                  onNavigatePage(sliderPreviewPage);
                  setSliderPreviewPage(null);
                }
              }}
              onKeyUp={() => {
                if (sliderPreviewPage !== null) {
                  onNavigatePage(sliderPreviewPage);
                  setSliderPreviewPage(null);
                }
              }}
              aria-label="شريط الانتقال السريع بين الصفحات"
              className="flex-1 accent-blue-700 cursor-pointer"
            />
            <span className="text-xs font-mono-num text-slate-400">{activeBook.totalPages}</span>
          </div>
        )}

        {/* Horizontal Scrollable Page Strip */}
        {activeBook.totalPages > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 thin-scrollbar">
            {visiblePageStrip[0] > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => onNavigatePage(1)}
                  className="min-h-[36px] min-w-[38px] px-2.5 rounded-lg text-xs font-mono-num border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
                >
                  1
                </button>
                <span className="text-xs text-slate-400 px-1">…</span>
              </>
            )}
            {visiblePageStrip.map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => onNavigatePage(num)}
                className={`min-h-[36px] min-w-[38px] px-2.5 rounded-lg text-xs font-mono-num font-semibold transition-colors cursor-pointer shrink-0 ${
                  num === currentPageNumber
                    ? 'bg-blue-700 text-white'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                {num}
              </button>
            ))}
            {visiblePageStrip[visiblePageStrip.length - 1] < activeBook.totalPages && (
              <>
                <span className="text-xs text-slate-400 px-1">…</span>
                <button
                  type="button"
                  onClick={() => onNavigatePage(activeBook.totalPages)}
                  className="min-h-[36px] min-w-[38px] px-2.5 rounded-lg text-xs font-mono-num border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
                >
                  {activeBook.totalPages}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 3. Original Page Image Viewer */}
      <PageImageViewer
        imageData={currentPageData?.imageData}
        pageNumber={currentPageNumber}
        totalPages={activeBook.totalPages}
        onPrevPage={() => onNavigatePage(Math.max(1, currentPageNumber - 1))}
        onNextPage={() => onNavigatePage(Math.min(activeBook.totalPages, currentPageNumber + 1))}
        zoom={pageZoom}
        onZoomChange={onPageZoomChange}
        croppedImage={croppedImage}
        onCropComplete={(img) => {
          setCroppedImage(img);
          if (img && liveState !== 'disconnected') {
            onSendCroppedToLive(img);
          }
        }}
        onExplainCroppedDiagram={() => {
          if (croppedImage) {
            void onQuickSelectionAction('explain_diagram', { croppedImage });
          }
        }}
        onSaveCroppedAsNote={() => {
          void onSaveNote({
            title: `رسم توضيحي — صفحة ${currentPageNumber}`,
            content: 'رسم محدد من الصفحة للدراسة والمراجعة.',
            noteType: 'diagram',
          });
        }}
        loadingPage={loadingPage}
        liveState={liveState}
        liveMuted={liveMuted}
        onStartLiveCall={onStartLiveCall}
        onEndLiveCall={onEndLiveCall}
        onToggleLiveMute={onToggleLiveMute}
      />

      {/* 4. Visual Study & Reading Tools (Locked when Top Header Audio is active) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={
                isPageAudioLocked ||
                loadingPage ||
                (!currentPageData?.imageData && !currentPageData?.extractedText)
              }
              onClick={onStartPageAudio}
              className="min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Volume2 className="w-4 h-4" />
              <span>اقرأ واشرح الصفحة بالصوت</span>
            </button>

            <button
              type="button"
              onClick={() => void handleExtractTasksClick('page')}
              className="min-h-[44px] px-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-sm font-semibold flex items-center gap-2 cursor-pointer"
            >
              <ClipboardList className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              <span>مهمات وتعاليل الصفحة</span>
            </button>
          </div>

          {/* Auto-Advance Controls */}
          <div className="flex flex-wrap items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
            <label className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={autoAdvanceEnabled}
                onChange={(e) => onToggleAutoAdvance(e.target.checked, autoAdvanceMode)}
                className="w-4 h-4 accent-blue-700 cursor-pointer"
              />
              <span>الانتقال التلقائي</span>
            </label>

            {autoAdvanceEnabled && (
              <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => onToggleAutoAdvance(true, 'read')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                    autoAdvanceMode === 'read'
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  قراءة الكتاب
                </button>
                <button
                  type="button"
                  onClick={() => onToggleAutoAdvance(true, 'explain')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                    autoAdvanceMode === 'explain'
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  شرح الكتاب
                </button>
              </div>
            )}
          </div>
        </div>

        {isPageAudioLocked && (
          <p className="text-xs text-teal-800 dark:text-teal-300 bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900 px-3 py-2 rounded-xl">
            جاري {pageAudio.phase === 'loading' ? 'تحميل' : 'تشغيل'} صوت صفحة {pageAudio.pageNumber} في الشريط العلوي. يمكنك التحكم بالسرعة أو إطفاؤه من الشريط العلوي لقراءة صفحة جديدة.
          </p>
        )}
      </div>

      {/* 6. Unified Voice + Text Chat with AI Tutor */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="font-display font-bold text-base text-slate-900 dark:text-white">
              المحادثة مع المعلم الذكي
            </h3>
          </div>
        </div>

        {/* Quick question shortcuts */}
        <div className="px-4 pt-3 flex flex-wrap gap-2">
          {[
            'اشرح لي هذه الصفحة بطريقة أسهل',
            'أعطني مثالاً من الحياة الواقعية',
            'انطيني أهم التعاليل والتعاريف في هذه الصفحة',
            'اشرح لي الصورة أو الرسم الموجود في الصفحة',
          ].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => void onSendChat(preset)}
              disabled={chatSending}
              className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 hover:border-blue-400 cursor-pointer"
            >
              {preset}
            </button>
          ))}
        </div>

        {/* Messages (Written Questions + Saved & Live Voice Call Transcripts) */}
        <div className="p-4 space-y-3 min-h-[300px] max-h-[540px] overflow-y-auto thin-scrollbar">
          {chatMessages.length === 0 && !liveInputDraft && !liveOutputDraft ? (
            <></>
          ) : (
            chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed space-y-2 ${
                    msg.role === 'user'
                      ? 'bg-blue-700 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                  {msg.role === 'assistant' && (
                    <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-200/70 dark:border-slate-700/70 text-[11px] text-slate-500 dark:text-slate-400">
                      <span>مرجع الصفحة {msg.pageNumber}</span>
                      <button
                        type="button"
                        onClick={() =>
                          void onSaveNote({
                            title: `شرح صفحة ${msg.pageNumber}`,
                            content: msg.text,
                            noteType: 'explanation',
                          })
                        }
                        className="font-semibold text-blue-700 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <BookmarkPlus className="w-3.5 h-3.5" />
                        <span>حفظ كملاحظة</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Live student spoken draft inside the unified chat */}
          {liveInputDraft && (
            <div className="flex justify-start">
              <div className="max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed bg-blue-600/90 text-white space-y-1">
                <span className="text-[10px] font-semibold text-blue-100 block">كلامك مباشر...</span>
                <p className="whitespace-pre-wrap">{liveInputDraft}</p>
              </div>
            </div>
          )}

          {/* Live tutor spoken draft inside the unified chat */}
          {liveOutputDraft && (
            <div className="flex justify-end">
              <div className="max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-slate-900 dark:text-slate-100 space-y-1">
                <span className="text-[10px] font-semibold text-teal-700 dark:text-teal-400 block">
                  المعلم يتحدث الآن...
                </span>
                <p className="whitespace-pre-wrap">{liveOutputDraft}</p>
              </div>
            </div>
          )}

          {chatSending && (
            <div className="flex justify-end">
              <div className="px-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-xs text-slate-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
                <span>المعلم يراجع الصفحة ويكتب الإجابة...</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {recordError && (
          <div className="mx-3 mt-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
            <span>{recordError}</span>
            <button
              type="button"
              onClick={() => setRecordError('')}
              aria-label="إغلاق التنبيه"
              className="text-red-500 hover:text-red-700 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Input */}
        <form
          onSubmit={handleSendChatSubmit}
          className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 bg-slate-50/70 dark:bg-slate-900"
        >
          {recordingState === 'recording' ? (
            <div className="flex-1 min-h-[46px] px-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-300 text-xs sm:text-sm font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse motion-reduce:animate-none" />
                <span>جاري تسجيل سؤالك...</span>
                <span className="font-mono-num">{formatRecordTimer(recordSeconds)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={cancelVoiceRecording}
                  title="إلغاء التسجيل"
                  aria-label="إلغاء التسجيل"
                  className="min-h-[34px] px-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>إلغاء</span>
                </button>
                <button
                  type="button"
                  onClick={stopAndSendRecording}
                  title="إيقاف وإرسال السؤال الصوتي"
                  aria-label="إيقاف وإرسال السؤال الصوتي"
                  className="min-h-[34px] px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>إرسال الصوت</span>
                </button>
              </div>
            </div>
          ) : recordingState === 'transcribing' ? (
            <div className="flex-1 min-h-[46px] px-4 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 flex items-center gap-2 text-xs sm:text-sm font-semibold text-blue-800 dark:text-blue-300">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>جاري تحويل صوتك إلى سؤال وإرساله للمعلم...</span>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="اكتب سؤالك للمعلم الذكي أو سجله بالصوت..."
                className="flex-1 min-h-[46px] px-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <button
                type="button"
                onClick={() => void startVoiceRecording()}
                disabled={chatSending}
                title="سجل رسالة صوتية للمعلم"
                aria-label="سجل رسالة صوتية للمعلم"
                className="min-h-[46px] min-w-[46px] px-3 rounded-xl bg-teal-50 dark:bg-teal-950/40 hover:bg-teal-100 dark:hover:bg-teal-900/50 border border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-300 font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Mic className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline text-xs">تسجيل صوت</span>
              </button>
              <button
                type="submit"
                disabled={chatSending || !chatInput.trim()}
                className="min-h-[46px] min-w-[46px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                aria-label="إرسال السؤال"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline text-sm">إرسال</span>
              </button>
            </>
          )}
        </form>
      </div>

      {/* Smart TOC Modal */}
      {tocOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-display font-bold text-lg text-slate-900 dark:text-white">
                فهرس الكتاب الذكي
              </h3>
              <button
                type="button"
                onClick={() => setTocOpen(false)}
                className="min-h-[40px] px-3 rounded-lg text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                إغلاق
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-2 thin-scrollbar">
              {activeBook.chapters && activeBook.chapters.length > 0 ? (
                activeBook.chapters.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      onNavigatePage(ch.startPage);
                      setTocOpen(false);
                    }}
                    className={`w-full text-right p-3.5 rounded-xl border transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                      currentChapter?.id === ch.id
                        ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800'
                        : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-800 hover:border-blue-400'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-900 dark:text-white">{ch.title}</p>
                      {ch.topics && ch.topics.length > 0 && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {ch.topics.join(' · ')}
                        </p>
                      )}
                    </div>
                    <span className="text-xs font-mono-num font-semibold text-blue-700 dark:text-blue-400 shrink-0">
                      ص {ch.startPage}
                      {ch.printedStartPage && ch.printedStartPage !== String(ch.startPage)
                        ? ` (مطبوع ${ch.printedStartPage})`
                        : ''}
                    </span>
                  </button>
                ))
              ) : (
                <p className="py-10 text-center text-sm text-slate-500">
                  جاري تجهيز الفهرس الذكي للكتاب، أو يمكنك التنقل برقم الصفحة مباشرة.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Important Tasks Modal */}
      {tasksModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <h3 className="font-display font-bold text-lg text-slate-900 dark:text-white">
                أهم النقاط والتعاليل والتعاريف
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleExtractTasksClick('chapter')}
                  disabled={extractingTasks}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer"
                >
                  استخراج مهمات الفصل كامل
                </button>
                <button
                  type="button"
                  onClick={() => setTasksModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            </div>
            <div className="p-5 overflow-y-auto space-y-3 thin-scrollbar">
              {extractingTasks ? (
                <div className="py-12 flex flex-col items-center gap-2 text-slate-500">
                  <Loader2 className="w-7 h-7 animate-spin text-blue-700" />
                  <span className="text-sm">جاري استخراج التعريفات والتعاليل والمهمات...</span>
                </div>
              ) : extractedTasks.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">لم تُستخرج مهمات في هذا النطاق.</p>
              ) : (
                extractedTasks.map((t) => (
                  <div
                    key={t.id}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-slate-900 dark:text-white">{t.title}</span>
                      <button
                        type="button"
                        onClick={() => {
                          onNavigatePage(t.pageNumber);
                          setTasksModalOpen(false);
                        }}
                        className="text-xs font-mono-num text-blue-700 dark:text-blue-400 hover:underline cursor-pointer shrink-0"
                      >
                        صفحة {t.pageNumber}
                      </button>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      {t.summary}
                    </p>
                  </div>
                ))
              )}
            </div>
            {extractedTasks.length > 0 && !extractingTasks && (
              <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTasksModalOpen(false);
                    onStartExamFromTasks(extractedTasks);
                  }}
                  className="min-h-[44px] px-5 rounded-xl bg-blue-700 text-white text-sm font-semibold cursor-pointer"
                >
                  امتحني في هذه المهمات الآن
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
