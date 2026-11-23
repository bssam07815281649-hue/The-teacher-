import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Library,
  BookOpen,
  CalendarDays,
  FileCheck2,
  Settings,
  Loader2,
  Play,
  Pause,
  Volume2,
  X,
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  School,
} from 'lucide-react';
import { auth, makeSafeId, signOutUser } from './services/firebase';
import {
  GUEST_UID,
  completeExamRecord,
  createBookRecord,
  createExamWithQuestions,
  createNote,
  createSchoolGrade,
  createStudyPlanWithTasks,
  deleteAllTutorData,
  deleteBookCascade,
  deleteNoteRecord,
  deleteSchoolGrade,
  deleteStudyPlanCascade,
  getBookPage,
  getExamQuestions,
  loadOrCreateProfile,
  saveBookChatMessage,
  saveBookPage,
  saveUserProfile,
  subscribeBookChat,
  subscribeBooks,
  subscribeExams,
  subscribeNotes,
  subscribeSchoolGrades,
  subscribeStudyPlans,
  subscribeStudyTasks,
  togglePageCompleted,
  updateBookAnalysis,
  updateBookMetadata,
  updateBookProgress,
  updateExamQuestionResult,
  updateNoteContent,
  updateSchoolGrade,
  updateStudyTaskStatus,
} from './services/tutorStore';
import {
  clearSchoolSessionToken,
  fetchSchoolWorkspace,
  logoutSchoolSession,
  resumeSchoolSession,
  setSchoolUnauthorizedHandler,
} from './services/schoolRecordClient';
import {
  cacheBookPage,
  deleteBookFromLocalCache,
  getCachedBookPage,
  getCachedRawPdfBytes,
} from './services/localCache';
import {
  extractPdfTextSnippetOnly,
  processUploadedFiles,
  renderPdfPageOnDemand,
} from './services/documentProcessor';
import * as pdfjsLib from 'pdfjs-dist';
import {
  buildSmartToc,
  explainSelection,
  extractImportantTasks,
  generateExamAI,
  generateStudyPlanAI,
  generateTtsAudio,
  gradeExamAI,
  rescheduleStudyPlanAI,
  sendTutorChat,
} from './services/aiClient';
import { GeminiLiveClient, type LiveToolCall } from './services/liveAudioClient';
import type {
  AppSection,
  Book,
  BookPage,
  ChatMessage,
  DifficultyLevel,
  Exam,
  ExamQuestion,
  ImportantTaskItem,
  LiveConnectionState,
  Note,
  PageAudioState,
  QuestionType,
  SchoolGrade,
  SchoolWorkspacePayload,
  StudyPlan,
  StudyTask,
  UserProfile,
} from './types';
import { AuthView } from './components/AuthView';
import { AdminGate } from './components/AdminGate';
import { CounselorWorkspace } from './components/school-record/CounselorWorkspace';
import { StudentRecordPortal } from './components/school-record/StudentRecordPortal';
import { LibrarySection } from './components/LibrarySection';
import { LearnSection } from './components/LearnSection';
import { StudyPlanSection } from './components/StudyPlanSection';
import { ExamSection } from './components/ExamSection';
import { SettingsModal } from './components/SettingsModal';
import { NotesDrawer } from './components/NotesDrawer';

function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function extractReferencedPageNumbers(prompt: string, totalPages: number): number[] {
  const norm = normalizeDigits(prompt);
  const pages = new Set<number>();
  const rangeMatch = norm.match(/(?:من\s*صفح[ةه]?\s*)(\d+)\s*(?:إلى|الى|حتى|-)\s*(?:صفح[ةه]?\s*)?(\d+)/);
  if (rangeMatch) {
    const start = Math.max(1, parseInt(rangeMatch[1], 10));
    const end = Math.min(totalPages, parseInt(rangeMatch[2], 10));
    for (let p = start; p <= Math.min(end, start + 14); p++) {
      pages.add(p);
    }
  } else {
    const matches = norm.matchAll(/صفح[ةه]?\s*(\d+)/g);
    for (const m of matches) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= totalPages) pages.add(n);
    }
  }
  return Array.from(pages).slice(0, 15);
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [guestMode, setGuestMode] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState('');

  const [portalOpen, setPortalOpen] = useState(true);
  const [schoolRole, setSchoolRole] = useState<'admin' | 'counselor' | 'student' | null>(null);
  const [pendingAdminCode, setPendingAdminCode] = useState('');
  const [schoolWorkspace, setSchoolWorkspace] = useState<SchoolWorkspacePayload | null>(null);
  const [schoolWorkspaceLoading, setSchoolWorkspaceLoading] = useState(false);
  const [schoolWorkspaceError, setSchoolWorkspaceError] = useState('');
  const [activeSection, setActiveSection] = useState<AppSection>('library');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notesDrawerOpen, setNotesDrawerOpen] = useState(false);

  const activeUid = firebaseUser?.uid || (guestMode ? GUEST_UID : null);

  // Core Firestore data
  const [books, setBooks] = useState<Book[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [studyTasks, setStudyTasks] = useState<StudyTask[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [schoolGrades, setSchoolGrades] = useState<SchoolGrade[]>([]);

  // Active Learning Workspace State (preserved across tab switches!)
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [currentPageNumber, setCurrentPageNumber] = useState<number>(1);
  const [currentPageData, setCurrentPageData] = useState<BookPage | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [pageZoom, setPageZoom] = useState(1);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSending, setChatSending] = useState(false);

  // Upload & background analysis state
  const [uploadProgress, setUploadProgress] = useState({ active: false, percent: 0, message: '' });
  const [backgroundStatus, setBackgroundStatus] = useState<Record<string, string>>({});

  // Preselection for Exams / Grades / Remedial Plans
  const [examPreselectedTasks, setExamPreselectedTasks] = useState<ImportantTaskItem[] | null>(null);
  const [examPreselectedBookId, setExamPreselectedBookId] = useState<string | null>(null);
  const [examInitialSubTab, setExamInitialSubTab] = useState<'smart_exams' | 'school_grades' | undefined>(undefined);
  const [remedialSubjectsTrigger, setRemedialSubjectsTrigger] = useState<string[] | null>(null);

  // Live Voice State
  const liveClientRef = useRef<GeminiLiveClient | null>(null);
  const lastSyncedLiveKeyRef = useRef<string>('');
  const [liveState, setLiveState] = useState<LiveConnectionState>('disconnected');
  const [liveMuted, setLiveMuted] = useState(false);
  const [liveInputDraft, setLiveInputDraft] = useState('');
  const [liveOutputDraft, setLiveOutputDraft] = useState('');
  const liveInputDraftRef = useRef('');
  const liveOutputDraftRef = useRef('');
  const liveChatBookIdRef = useRef<string | null>(null);
  const [liveError, setLiveError] = useState('');
  const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(false);
  const [autoAdvanceMode, setAutoAdvanceMode] = useState<'read' | 'explain'>('explain');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Global Page Audio Player State (persists across page flips & tab switches, rendered in Top Header)
  const [pageAudio, setPageAudio] = useState<PageAudioState>({
    phase: 'idle',
    bookId: null,
    bookTitle: '',
    pageNumber: 1,
    loadPercent: 0,
    loadLabel: '',
    duration: 0,
    currentTime: 0,
    playbackRate: 1,
    error: '',
  });
  const readingAbortRef = useRef(false);
  const ttsAudioCtxRef = useRef<AudioContext | null>(null);
  const ttsBufferRef = useRef<AudioBuffer | null>(null);
  const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ttsOffsetRef = useRef(0);
  const ttsStartCtxTimeRef = useRef(0);
  const ttsRateRef = useRef(1);
  const ttsRafRef = useRef<number | null>(null);
  const pageAudioCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const pageAudioRef = useRef<PageAudioState>(pageAudio);
  pageAudioRef.current = pageAudio;

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((prev) => (prev === msg ? null : prev)), 3500);
  }, []);

  const buildOfflineFallbackProfile = useCallback((user: User): UserProfile => {
    const cacheKey = `smart_tutor_profile_${user.uid}`;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as UserProfile;
        if (parsed && parsed.uid === user.uid) return parsed;
      }
    } catch {
      // Ignore storage errors
    }
    return {
      uid: user.uid,
      displayName: user.displayName || 'طالب',
      email: user.email || '',
      photoURL: user.photoURL || '',
      tutorLanguage: 'ar-msa',
      theme: 'light',
      fontSize: 18,
      speechRate: 1.0,
      voiceName: 'Zephyr',
      gradeLevel: '',
    };
  }, []);

  const cacheUserProfileLocally = useCallback((prof: UserProfile) => {
    try {
      localStorage.setItem(`smart_tutor_profile_${prof.uid}`, JSON.stringify(prof));
    } catch {
      // Ignore quota errors
    }
  }, []);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setProfileError('');
      if (user) {
        setGuestMode(false);
        try {
          const prof = await loadOrCreateProfile(user);
          cacheUserProfileLocally(prof);
          setProfile(prof);
        } catch (err) {
          const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
          if (msg.includes('client is offline') || msg.includes('unavailable')) {
            setProfile(buildOfflineFallbackProfile(user));
          } else {
            setProfile(null);
            setProfileError('تم تسجيل الدخول، لكن تعذّر تحميل بيانات حسابك. تحقق من الاتصال أو صلاحيات Firebase ثم أعد المحاولة.');
          }
        }
      } else {
        setProfile(null);
        setBooks([]);
        setNotes([]);
        setPlans([]);
        setExams([]);
        setSchoolGrades([]);
        setActiveBookId(null);
        liveClientRef.current?.disconnect();
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, [buildOfflineFallbackProfile, cacheUserProfileLocally]);

  // Recover signed, revocable counselor/student sessions without a second code entry.
  useEffect(() => {
    let active = true;
    void resumeSchoolSession().then(session => {
      if (!active || !session) return;
      setSchoolRole(session.role as 'counselor' | 'student');
      setPortalOpen(false);
    });
    return () => { active = false; };
  }, []);

  // Load local guest profile automatically when open Guest Mode is active without Firebase user
  useEffect(() => {
    if (!firebaseUser && guestMode) {
      void loadOrCreateProfile(null).then(setProfile);
    }
  }, [firebaseUser, guestMode]);

  const loadSchoolWorkspace = useCallback(async () => {
    setSchoolWorkspaceLoading(true);
    setSchoolWorkspaceError('');
    try {
      const ws = await fetchSchoolWorkspace();
      setSchoolWorkspace(ws);
    } catch (err) {
      setSchoolWorkspaceError(
        err instanceof Error && err.message
          ? err.message
          : 'تعذر تحميل بيانات المدرسة. تأكد من صلاحية الكود وحاول مجدداً.'
      );
    } finally {
      setSchoolWorkspaceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (schoolRole === 'counselor' || schoolRole === 'student') {
      setSchoolUnauthorizedHandler(() => {
        setSchoolWorkspace(null);
        setSchoolRole(null);
        setPortalOpen(true);
      });
      void loadSchoolWorkspace();
      return () => setSchoolUnauthorizedHandler(null);
    }
    setSchoolWorkspace(null);
    setSchoolWorkspaceError('');
  }, [schoolRole, loadSchoolWorkspace]);

  const handleSchoolLogout = useCallback(async () => {
    try { await logoutSchoolSession(); }
    catch (error) { showToast(error instanceof Error ? error.message : 'تعذر تسجيل الخروج قبل مزامنة التعديلات المحلية.'); return; }
    clearSchoolSessionToken();
    setSchoolWorkspace(null);
    setSchoolRole(null);
    setPortalOpen(true);
  }, [showToast]);

  const retryProfileLoad = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    setProfileError('');
    try {
      const loaded = await loadOrCreateProfile(user);
      cacheUserProfileLocally(loaded);
      setProfile(loaded);
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      if (msg.includes('client is offline') || msg.includes('unavailable')) {
        setProfile(buildOfflineFallbackProfile(user));
      } else {
        setProfileError('تعذّر تحميل حسابك مرة أخرى. تحقق من الاتصال وصلاحيات Firebase.');
      }
    }
  }, [buildOfflineFallbackProfile, cacheUserProfileLocally]);

  // Theme sync on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (profile?.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [profile?.theme]);

  // Subscribe to student's private collections (Firebase or Local Guest Mode)
  useEffect(() => {
    if (!activeUid) return;
    const uBooks = subscribeBooks(activeUid, (list) => {
      setBooks(list);
    });
    const uNotes = subscribeNotes(activeUid, setNotes);
    const uPlans = subscribeStudyPlans(activeUid, (list) => {
      setPlans(list);
      setActivePlanId((prev) => prev || list[0]?.id || null);
    });
    const uExams = subscribeExams(activeUid, setExams);
    const uGrades = subscribeSchoolGrades(activeUid, setSchoolGrades);
    return () => {
      uBooks();
      uNotes();
      uPlans();
      uExams();
      uGrades();
    };
  }, [activeUid]);

  // Subscribe to active study plan tasks
  useEffect(() => {
    if (!activeUid || !activePlanId) {
      setStudyTasks([]);
      return;
    }
    const unsub = subscribeStudyTasks(activeUid, activePlanId, setStudyTasks);
    return () => unsub();
  }, [activeUid, activePlanId]);

  const activeBook = useMemo(
    () => books.find((b) => b.id === activeBookId) || null,
    [books, activeBookId]
  );

  const activePlan = useMemo(
    () => plans.find((p) => p.id === activePlanId) || plans[0] || null,
    [plans, activePlanId]
  );

  const schoolGradesSummary = useMemo(() => {
    if (schoolGrades.length === 0) {
      return {
        overallAverage: null as number | null,
        weakSubjects: [] as string[],
        weakChapters: [] as string[],
        summaryText: '',
      };
    }

    const overallAverage =
      Math.round((schoolGrades.reduce((sum, g) => sum + g.percentage, 0) / schoolGrades.length) * 10) / 10;

    const bySubject = new Map<string, SchoolGrade[]>();
    schoolGrades.forEach((g) => {
      const k = g.subject.trim() || 'مادة عامة';
      const arr = bySubject.get(k) || [];
      arr.push(g);
      bySubject.set(k, arr);
    });

    const weakSubjects: string[] = [];
    const weakChaptersSet = new Set<string>();

    bySubject.forEach((list, subj) => {
      const avg = list.reduce((s, item) => s + item.percentage, 0) / list.length;
      if (avg < 70) weakSubjects.push(subj);
      list.forEach((item) => {
        if (item.percentage < 70) {
          weakChaptersSet.add(
            item.chapterOrTopic ? `${subj}: ${item.chapterOrTopic} (${item.percentage}%)` : `${subj} (${item.examLabel}: ${item.percentage}%)`
          );
        }
      });
    });

    const weakChapters = Array.from(weakChaptersSet).slice(0, 10);
    const summaryText = `المعدل العام في سجل درجات الصف: ${overallAverage}%.${
      weakSubjects.length > 0 ? ` المواد التي تحتاج تحسيناً وتقوية (<70%): ${weakSubjects.join('، ')}.` : ''
    }${weakChapters.length > 0 ? ` الفصول/الاختبارات الأضعف: ${weakChapters.join('؛ ')}.` : ''}`;

    return { overallAverage, weakSubjects, weakChapters, summaryText };
  }, [schoolGrades]);

  const weakTopics = useMemo(() => {
    const set = new Set<string>();
    exams.forEach((ex) => {
      (ex.weakTopics || []).forEach((t) => set.add(t));
    });
    return Array.from(set).slice(0, 15);
  }, [exams]);

  // Subscribe to book chat
  useEffect(() => {
    if (!activeUid || !activeBookId) {
      setChatMessages([]);
      return;
    }
    const unsub = subscribeBookChat(activeUid, activeBookId, setChatMessages);
    return () => unsub();
  }, [activeUid, activeBookId]);

  // Fast page load on demand (does NOT overwrite saved progress checkpoint; student uses explicit checkpoint button)
  const loadSpecificPage = useCallback(
    async (book: Book, pageNum: number): Promise<BookPage | null> => {
      if (!activeUid) return null;
      const uid = activeUid;
      const clamped = Math.max(1, Math.min(book.totalPages, pageNum));
      setCurrentPageNumber(clamped);
      setLoadingPage(true);

      try {
        let pageData = await getCachedBookPage(uid, book.id, clamped);
        if (!pageData || !pageData.imageData) {
          const remote = await getBookPage(uid, book.id, clamped);
          if (remote) {
            pageData = remote;
            await cacheBookPage(uid, book.id, remote);
          }
        }

        if ((!pageData || !pageData.imageData) && book.fileType === 'pdf') {
          const rendered = await renderPdfPageOnDemand(book.id, clamped, true);
          if (rendered) {
            pageData = {
              pageNumber: clamped,
              userId: uid,
              bookId: book.id,
              printedPageLabel: String(clamped),
              chapterTitle: '',
              imageData: rendered.imageData,
              extractedText: '',
              isCompleted: false,
              isAnalyzed: false,
              ocrApplied: false,
            };
            await cacheBookPage(uid, book.id, pageData);
            void saveBookPage(uid, book.id, pageData).catch(() => {});
          }
        }

        setCurrentPageData(pageData || null);
        return pageData || null;
      } finally {
        setLoadingPage(false);
      }
    },
    [activeUid]
  );

  const handleSaveProgressCheckpoint = useCallback(async () => {
    if (!activeUid || !activeBook) return;
    await updateBookProgress(activeUid, activeBook.id, currentPageNumber);
    showToast(`تم تثبيت مواصلة التقدم عند صفحة ${currentPageNumber}`);
  }, [activeUid, activeBook, currentPageNumber, showToast]);

  // Global Page Audio Helpers (Web Audio API + Gemini 3.8 TTS)
  const stopTtsRaf = useCallback(() => {
    if (ttsRafRef.current !== null) {
      window.cancelAnimationFrame(ttsRafRef.current);
      ttsRafRef.current = null;
    }
  }, []);

  const stopTtsSourceNodeOnly = useCallback(() => {
    stopTtsRaf();
    if (ttsSourceRef.current) {
      try {
        ttsSourceRef.current.onended = null;
        ttsSourceRef.current.stop();
        ttsSourceRef.current.disconnect();
      } catch {
        // Ignore already stopped source
      }
      ttsSourceRef.current = null;
    }
  }, [stopTtsRaf]);

  const ensureTtsAudioContext = useCallback((): AudioContext => {
    if (!ttsAudioCtxRef.current || ttsAudioCtxRef.current.state === 'closed') {
      try {
        ttsAudioCtxRef.current = new AudioContext({ sampleRate: 24000 });
      } catch {
        ttsAudioCtxRef.current = new AudioContext();
      }
    }
    if (ttsAudioCtxRef.current.state === 'suspended') {
      void ttsAudioCtxRef.current.resume().catch(() => {});
    }
    return ttsAudioCtxRef.current;
  }, []);

  const handleStopPageAudio = useCallback(() => {
    readingAbortRef.current = true;
    stopTtsSourceNodeOnly();
    ttsBufferRef.current = null;
    ttsOffsetRef.current = 0;
    setPageAudio((prev) => ({
      ...prev,
      phase: 'idle',
      bookId: null,
      bookTitle: '',
      loadPercent: 0,
      loadLabel: '',
      duration: 0,
      currentTime: 0,
      error: '',
    }));
  }, [stopTtsSourceNodeOnly]);

  const startPageAudioFromRef = useRef<
    (book: Book, pageNum: number, pageObj: BookPage | null) => Promise<void>
  >(async () => {});

  const playTtsBufferFromOffset = useCallback(
    (buffer: AudioBuffer, offsetSec: number, rateOverride?: number) => {
      const ctx = ensureTtsAudioContext();
      stopTtsSourceNodeOnly();

      const rate = rateOverride ?? ttsRateRef.current;
      ttsRateRef.current = rate;
      const safeOffset = Math.max(0, Math.min(offsetSec, Math.max(0, buffer.duration - 0.05)));

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.setValueAtTime(rate, ctx.currentTime);
      source.connect(ctx.destination);

      ttsSourceRef.current = source;
      ttsOffsetRef.current = safeOffset;
      ttsStartCtxTimeRef.current = ctx.currentTime;

      setPageAudio((prev) => ({
        ...prev,
        phase: 'playing',
        duration: buffer.duration,
        currentTime: safeOffset,
        playbackRate: rate,
      }));

      const updateProgress = () => {
        if (!ttsAudioCtxRef.current || !ttsSourceRef.current) return;
        const elapsed =
          ttsOffsetRef.current +
          (ttsAudioCtxRef.current.currentTime - ttsStartCtxTimeRef.current) * ttsRateRef.current;
        if (elapsed >= buffer.duration) {
          setPageAudio((prev) => ({ ...prev, currentTime: buffer.duration }));
          return;
        }
        setPageAudio((prev) => ({ ...prev, currentTime: elapsed }));
        ttsRafRef.current = window.requestAnimationFrame(updateProgress);
      };
      ttsRafRef.current = window.requestAnimationFrame(updateProgress);

      source.onended = () => {
        stopTtsRaf();
        if (ttsSourceRef.current !== source) return;
        ttsSourceRef.current = null;
        if (!readingAbortRef.current) {
          ttsOffsetRef.current = 0;
          ttsBufferRef.current = null;
          const finishedBookId = pageAudioRef.current.bookId;
          const finishedPageNum = pageAudioRef.current.pageNumber;
          setPageAudio((prev) => ({
            ...prev,
            phase: 'idle',
            currentTime: 0,
            duration: 0,
          }));

          const st = stateRef.current;
          if (
            autoAdvanceEnabled &&
            autoAdvanceMode === 'read' &&
            st.activeBook &&
            st.activeBook.id === finishedBookId &&
            finishedPageNum < st.activeBook.totalPages
          ) {
            const targetBook = st.activeBook;
            const nextPage = finishedPageNum + 1;
            void loadSpecificPage(targetBook, nextPage).then((nextPg) => {
              if (nextPg) {
                void startPageAudioFromRef.current(targetBook, nextPage, nextPg);
              }
            });
          }
        }
      };

      source.start(0, safeOffset);
    },
    [autoAdvanceEnabled, autoAdvanceMode, ensureTtsAudioContext, loadSpecificPage, stopTtsRaf, stopTtsSourceNodeOnly]
  );

  const handlePausePageAudio = useCallback(() => {
    if (pageAudioRef.current.phase !== 'playing' || !ttsAudioCtxRef.current || !ttsBufferRef.current) return;
    const elapsed =
      ttsOffsetRef.current +
      (ttsAudioCtxRef.current.currentTime - ttsStartCtxTimeRef.current) * ttsRateRef.current;
    ttsOffsetRef.current = Math.min(elapsed, ttsBufferRef.current.duration);
    stopTtsSourceNodeOnly();
    setPageAudio((prev) => ({
      ...prev,
      phase: 'paused',
      currentTime: ttsOffsetRef.current,
    }));
  }, [stopTtsSourceNodeOnly]);

  const handleResumePageAudio = useCallback(() => {
    if (pageAudioRef.current.phase !== 'paused' || !ttsBufferRef.current) return;
    readingAbortRef.current = false;
    playTtsBufferFromOffset(ttsBufferRef.current, ttsOffsetRef.current);
  }, [playTtsBufferFromOffset]);

  const handleSeekPageAudio = useCallback(
    (targetSec: number) => {
      if (!ttsBufferRef.current) return;
      const clamped = Math.max(0, Math.min(targetSec, ttsBufferRef.current.duration));
      ttsOffsetRef.current = clamped;
      setPageAudio((prev) => ({ ...prev, currentTime: clamped }));
      if (pageAudioRef.current.phase === 'playing') {
        playTtsBufferFromOffset(ttsBufferRef.current, clamped);
      }
    },
    [playTtsBufferFromOffset]
  );

  const handleChangePageAudioSpeed = useCallback((newRate: number) => {
    const safeRate = Math.max(0.5, Math.min(2.0, newRate));
    if (
      pageAudioRef.current.phase === 'playing' &&
      ttsAudioCtxRef.current &&
      ttsSourceRef.current &&
      ttsBufferRef.current
    ) {
      const now = ttsAudioCtxRef.current.currentTime;
      const elapsed = ttsOffsetRef.current + (now - ttsStartCtxTimeRef.current) * ttsRateRef.current;
      ttsOffsetRef.current = Math.min(elapsed, ttsBufferRef.current.duration);
      ttsStartCtxTimeRef.current = now;
      ttsSourceRef.current.playbackRate.setValueAtTime(safeRate, now);
    }
    ttsRateRef.current = safeRate;
    setPageAudio((prev) => ({ ...prev, playbackRate: safeRate }));
  }, []);

  const startVisualPageAudioFor = useCallback(
    async (book: Book, pageNum: number, pageObj: BookPage | null) => {
      if (!profile || (!pageObj?.imageData && !pageObj?.extractedText)) return;
      // Strict global lock: cannot start a second reading while one is loading, playing, or paused!
      const ph = pageAudioRef.current.phase;
      if (ph === 'loading' || ph === 'playing' || ph === 'paused') {
        showToast('يوجد صوت قيد التشغيل أو التحميل حالياً — أوقفه من الشريط العلوي أولاً.');
        return;
      }

      const ctx = ensureTtsAudioContext();
      await ctx.resume().catch(() => {});

      stopTtsSourceNodeOnly();
      readingAbortRef.current = false;

      const selectedVoice = profile.voiceName || 'Zephyr';
      const activeSpeed = ttsRateRef.current || profile.speechRate || 1;
      ttsRateRef.current = activeSpeed;

      const cacheKey = `${book.id}:${pageNum}:${selectedVoice}`;
      const cachedBuffer = pageAudioCacheRef.current.get(cacheKey);
      if (cachedBuffer) {
        setPageAudio({
          phase: 'playing',
          bookId: book.id,
          bookTitle: book.title,
          pageNumber: pageNum,
          loadPercent: 100,
          loadLabel: '',
          duration: cachedBuffer.duration,
          currentTime: 0,
          playbackRate: activeSpeed,
          error: '',
        });
        ttsBufferRef.current = cachedBuffer;
        playTtsBufferFromOffset(cachedBuffer, 0, activeSpeed);
        return;
      }

      setPageAudio({
        phase: 'loading',
        bookId: book.id,
        bookTitle: book.title,
        pageNumber: pageNum,
        loadPercent: 18,
        loadLabel: `جاري قراءة صفحة ${pageNum} بصرياً...`,
        duration: 0,
        currentTime: 0,
        playbackRate: activeSpeed,
        error: '',
      });

      try {
        const res = await explainSelection({
          action: 'explain_page',
          bookTitle: book.title,
          pageNumber: pageNum,
          chapterTitle: pageObj.chapterTitle || '',
          pageText: pageObj.extractedText || '',
          pageImage: pageObj.imageData,
          tutorLanguage: profile.tutorLanguage,
        });
        if (readingAbortRef.current) return;

        const textToSpeak = (res.explanation || pageObj.extractedText || '').trim();
        if (!textToSpeak) {
          throw new Error('لم يتم العثور على محتوى مقروء في هذه الصفحة.');
        }

        setPageAudio((prev) => ({
          ...prev,
          loadPercent: 58,
          loadLabel: `جاري توليد الصوت عبر Gemini 3.8...`,
        }));

        const { audioBase64 } = await generateTtsAudio({
          text: textToSpeak.slice(0, 7500),
          voiceName: selectedVoice,
          style: 'Clear, steady, supportive educational tutor reading and explaining strictly what is on the page.',
        });
        if (readingAbortRef.current) return;

        setPageAudio((prev) => ({
          ...prev,
          loadPercent: 88,
          loadLabel: 'جاري تجهيز الصوت...',
        }));

        const binary = atob(audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
        if (readingAbortRef.current) return;

        if (pageAudioCacheRef.current.size >= 5) {
          const firstKey = pageAudioCacheRef.current.keys().next().value;
          if (firstKey) pageAudioCacheRef.current.delete(firstKey);
        }
        pageAudioCacheRef.current.set(cacheKey, audioBuffer);

        ttsBufferRef.current = audioBuffer;
        playTtsBufferFromOffset(audioBuffer, 0, activeSpeed);
      } catch (err) {
        if (readingAbortRef.current) return;
        setPageAudio((prev) => ({
          ...prev,
          phase: 'error',
          loadPercent: 0,
          error:
            err instanceof Error && err.message
              ? err.message
              : 'تعذر قراءة وشرح الصفحة بالصوت حالياً. يرجى المحاولة مرة أخرى.',
        }));
      }
    },
    [ensureTtsAudioContext, playTtsBufferFromOffset, profile, showToast, stopTtsSourceNodeOnly]
  );

  startPageAudioFromRef.current = startVisualPageAudioFor;

  useEffect(() => {
    return () => {
      stopTtsSourceNodeOnly();
      if (ttsAudioCtxRef.current) {
        void ttsAudioCtxRef.current.close().catch(() => {});
        ttsAudioCtxRef.current = null;
      }
    };
  }, [stopTtsSourceNodeOnly]);

  // Sync current page image & context to active Live Voice Session quietly on page change
  useEffect(() => {
    if (
      liveState === 'disconnected' ||
      liveState === 'error' ||
      liveState === 'connecting' ||
      !liveClientRef.current ||
      !activeBook ||
      !currentPageData
    ) {
      return;
    }
    const syncKey = `${activeBook.id}:${currentPageNumber}:${currentPageData.imageData ? 'img' : 'noimg'}`;
    if (lastSyncedLiveKeyRef.current === syncKey) return;
    lastSyncedLiveKeyRef.current = syncKey;

    const shouldSpeakNewPage = Boolean(autoAdvanceEnabled && autoAdvanceMode === 'explain');
    const contextText = `انتقل الطالب إلى الصفحة ${currentPageNumber} من ${activeBook.totalPages} في كتاب "${activeBook.title}".
- الفصل: ${currentPageData.chapterTitle || 'غير محدد'}
أرسلت لك صورة هذه الصفحة الآن لتقرأها بصرياً.
${shouldSpeakNewPage ? 'وضع الانتقال التلقائي مفعل على "شرح الكتاب"؛ اشرح هذه الصفحة بوضوح ثم توقف.' : 'لا تقاطع كلامك ولا تبدأ شرحاً جديداً من تلقاء نفسك إلا إذا سألك الطالب عن هذه الصفحة.'}`;

    liveClientRef.current.sendContextUpdate(contextText, currentPageData.imageData, shouldSpeakNewPage);
  }, [liveState, activeBook, currentPageNumber, currentPageData, autoAdvanceEnabled, autoAdvanceMode]);

  const handleOpenBook = useCallback(
    (book: Book, specificPage?: number) => {
      const targetPage = specificPage || book.lastPage || 1;
      setActiveBookId(book.id);
      setActiveSection('learn');
      void loadSpecificPage(book, targetPage);
    },
    [loadSpecificPage]
  );

  // Lightweight background metadata/TOC pass (NO heavy 120-page canvas rendering or OCR!)
  const runBackgroundBookPipeline = useCallback(async (uid: string, book: Book) => {
    try {
      // If PDF already had native outline bookmarks or non-PDF format, mark ready right away
      if (book.fileType !== 'pdf' || (book.chapters && book.chapters.length > 0)) {
        await updateBookAnalysis(uid, book.id, {
          analyzedCount: book.totalPages,
          analysisStatus: 'ready',
        });
        return;
      }

      setBackgroundStatus((prev) => ({ ...prev, [book.id]: 'جاري فحص الفهرس السريع...' }));
      const pdfBytes = await getCachedRawPdfBytes(book.id);
      if (!pdfBytes) {
        await updateBookAnalysis(uid, book.id, { analyzedCount: 1, analysisStatus: 'ready' });
        return;
      }

      const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
      const snippets: { pageNumber: number; snippet: string }[] = [];
      const sampleCount = Math.min(book.totalPages, 24);
      const step = Math.max(1, Math.floor(book.totalPages / sampleCount));

      for (let p = 1; p <= book.totalPages && snippets.length < sampleCount; p += step) {
        const snippet = await extractPdfTextSnippetOnly(pdfDoc, p);
        if (snippet.length > 15) {
          snippets.push({ pageNumber: p, snippet: snippet.slice(0, 220) });
        }
      }

      if (snippets.length > 0) {
        const toc = await buildSmartToc({
          bookTitle: book.title,
          totalPages: book.totalPages,
          pageSnippets: snippets,
        });
        const mergedChapters = (toc.chapters || []).map((c, idx) => ({
          id: `ch_${idx + 1}`,
          title: c.title,
          startPage: Math.max(1, Math.min(book.totalPages, c.startPage || 1)),
          printedStartPage: c.printedStartPage,
          difficulty: (c.difficulty as DifficultyLevel) || 'medium',
          estimatedMinutes: c.estimatedMinutes || 20,
          topics: c.topics || [],
        }));

        await updateBookAnalysis(uid, book.id, {
          subject: toc.subject || book.subject,
          gradeLevel: toc.gradeLevel || book.gradeLevel,
          chapters: mergedChapters,
          analyzedCount: book.totalPages,
          analysisStatus: 'ready',
        });
      } else {
        await updateBookAnalysis(uid, book.id, {
          analyzedCount: book.totalPages,
          analysisStatus: 'ready',
        });
      }
    } catch (err) {
      console.error('Background book pipeline error:', err);
      await updateBookAnalysis(uid, book.id, { analysisStatus: 'ready' }).catch(() => {});
    } finally {
      setBackgroundStatus((prev) => {
        const next = { ...prev };
        delete next[book.id];
        return next;
      });
    }
  }, []);

  const handleUploadFiles = async (files: File[]) => {
    if (!activeUid) return;
    const uid = activeUid;
    const bookId = makeSafeId('bk');

    setUploadProgress({ active: true, percent: 5, message: 'جاري فحص الملف...' });
    try {
      const processed = await processUploadedFiles(files, bookId, (pct, msg) => {
        setUploadProgress({ active: true, percent: pct, message: msg });
      });

      const newBook: Book = {
        id: bookId,
        userId: uid,
        title: processed.title,
        subject: '',
        gradeLevel: profile?.gradeLevel || '',
        fileType: processed.fileType,
        totalPages: processed.totalPages,
        lastPage: 1,
        completedCount: 0,
        analyzedCount: processed.initialPages.length,
        analysisStatus: 'analyzing',
        coverImage: processed.coverImage,
        chapters: processed.chapters,
        importantTasks: [],
      };

      setUploadProgress({ active: true, percent: 90, message: 'جاري حفظ الكتاب في مكتبتك...' });
      await createBookRecord(uid, newBook);

      for (const p of processed.initialPages) {
        const fullPage: BookPage = { ...p, userId: uid, bookId };
        await cacheBookPage(uid, bookId, fullPage);
        await saveBookPage(uid, bookId, fullPage);
      }

      setUploadProgress({ active: false, percent: 100, message: '' });
      showToast(`تمت إضافة "${newBook.title}" إلى مكتبتك!`);

      // Start background indexing & smart TOC without blocking student from studying immediately
      void runBackgroundBookPipeline(uid, newBook);
    } catch (err) {
      setUploadProgress({ active: false, percent: 0, message: '' });
      throw err;
    }
  };

  // Refs for Live/Chat tool execution so callbacks never read stale state
  const stateRef = useRef({
    books,
    activeBook,
    currentPageNumber,
    currentPageData,
    notes,
    plans,
    studyTasks,
    exams,
  });
  stateRef.current = {
    books,
    activeBook,
    currentPageNumber,
    currentPageData,
    notes,
    plans,
    studyTasks,
    exams,
  };

  // REAL Tool Executor for Gemini Live & Text Chat Function Calling
  const executeToolCall = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const uid = activeUid;
      if (!uid) return { ok: false, error: 'غير مسجل الدخول' };
      const st = stateRef.current;

      switch (name) {
        case 'list_books':
          return {
            ok: true,
            books: st.books.map((b) => ({
              id: b.id,
              title: b.title,
              subject: b.subject,
              totalPages: b.totalPages,
              lastPage: b.lastPage,
            })),
          };

        case 'open_book': {
          const targetId = String(args.bookId || '');
          const targetTitle = String(args.bookTitle || '').trim().toLowerCase();
          const found =
            st.books.find((b) => b.id === targetId) ||
            st.books.find(
              (b) =>
                b.title.toLowerCase().includes(targetTitle) ||
                (b.subject || '').toLowerCase().includes(targetTitle)
            );
          if (!found) {
            return {
              ok: false,
              message: 'لم أجد كتاباً بهذا الاسم في مكتبتك.',
              availableBooks: st.books.map((b) => b.title),
            };
          }
          handleOpenBook(found);
          return { ok: true, bookTitle: found.title, openedPage: found.lastPage };
        }

        case 'next_page': {
          if (!st.activeBook) return { ok: false, error: 'لا يوجد كتاب مفتوح حالياً' };
          if (st.currentPageNumber >= st.activeBook.totalPages) {
            return { ok: false, message: 'أنت في الصفحة الأخيرة من الكتاب.' };
          }
          const next = st.currentPageNumber + 1;
          void loadSpecificPage(st.activeBook, next);
          return { ok: true, newPage: next };
        }

        case 'previous_page': {
          if (!st.activeBook) return { ok: false, error: 'لا يوجد كتاب مفتوح حالياً' };
          if (st.currentPageNumber <= 1) {
            return { ok: false, message: 'أنت في الصفحة الأولى بالفعل.' };
          }
          const prev = st.currentPageNumber - 1;
          void loadSpecificPage(st.activeBook, prev);
          return { ok: true, newPage: prev };
        }

        case 'go_to_page': {
          if (!st.activeBook) return { ok: false, error: 'لا يوجد كتاب مفتوح' };
          const pageNum = Number(args.pageNumber);
          if (Number.isNaN(pageNum) || pageNum < 1 || pageNum > st.activeBook.totalPages) {
            return {
              ok: false,
              error: `رقم الصفحة غير صحيح. نطاق الكتاب من 1 إلى ${st.activeBook.totalPages}.`,
            };
          }
          setActiveSection('learn');
          await loadSpecificPage(st.activeBook, pageNum);
          return { ok: true, currentPage: pageNum };
        }

        case 'go_to_chapter':
        case 'find_topic': {
          if (!st.activeBook) return { ok: false, error: 'لا يوجد كتاب مفتوح' };
          const q = String(args.chapterName || args.topicName || '').trim().toLowerCase();
          if (!q) return { ok: false, needsClarification: true };

          const matches = (st.activeBook.chapters || []).filter(
            (c) =>
              c.title.toLowerCase().includes(q) ||
              (c.topics || []).some((t) => t.toLowerCase().includes(q))
          );
          if (matches.length === 1) {
            setActiveSection('learn');
            await loadSpecificPage(st.activeBook, matches[0].startPage);
            return {
              ok: true,
              chapterTitle: matches[0].title,
              navigatedToPage: matches[0].startPage,
            };
          }
          if (matches.length > 1) {
            return {
              ok: false,
              needsClarification: true,
              message: 'يوجد أكثر من فصل أو موضوع مطابق؛ اسأل الطالب أيهما يقصد:',
              candidates: matches.slice(0, 5).map((m) => ({ title: m.title, startPage: m.startPage })),
            };
          }
          return {
            ok: false,
            needsClarification: true,
            message: 'لم أجد هذا الفصل أو الموضوع بدقة في الفهرس؛ اطلب من الطالب توضيح رقم الصفحة أو اسم الفصل.',
            availableChapters: (st.activeBook.chapters || []).slice(0, 12).map((c) => c.title),
          };
        }

        case 'get_current_page':
          return st.activeBook
            ? {
                ok: true,
                bookTitle: st.activeBook.title,
                pageNumber: st.currentPageNumber,
                totalPages: st.activeBook.totalPages,
                chapterTitle: st.currentPageData?.chapterTitle || '',
                extractedText: (st.currentPageData?.extractedText || '').slice(0, 6000),
              }
            : { ok: false, error: 'لا يوجد كتاب مفتوح' };

        case 'get_page_content': {
          if (!st.activeBook) return { ok: false, error: 'لا يوجد كتاب مفتوح' };
          const p = Number(args.pageNumber);
          if (Number.isNaN(p) || p < 1 || p > st.activeBook.totalPages) {
            return { ok: false, error: 'رقم الصفحة خارج نطاق الكتاب' };
          }
          let page = await getCachedBookPage(uid, st.activeBook.id, p);
          if (!page) page = await getBookPage(uid, st.activeBook.id, p);
          if (!page && st.activeBook.fileType === 'pdf') {
            const rendered = await renderPdfPageOnDemand(st.activeBook.id, p);
            if (rendered) {
              return { ok: true, pageNumber: p, extractedText: rendered.extractedText.slice(0, 8000) };
            }
          }
          return page
            ? { ok: true, pageNumber: p, extractedText: page.extractedText.slice(0, 8000) }
            : { ok: false, error: 'تعذر قراءة هذه الصفحة' };
        }

        case 'get_selected_text':
          return { ok: true, selectedText: window.getSelection()?.toString().trim() || '' };

        case 'zoom_page': {
          const act = String(args.action || 'in');
          setPageZoom((prev) =>
            act === 'in' ? Math.min(2.5, prev + 0.3) : act === 'out' ? Math.max(0.6, prev - 0.3) : 1
          );
          return { ok: true, action: act };
        }

        case 'set_auto_advance': {
          const enabled = Boolean(args.enabled);
          const modeVal = args.mode === 'read' ? 'read' : 'explain';
          setAutoAdvanceEnabled(enabled);
          setAutoAdvanceMode(modeVal);
          return { ok: true, autoAdvanceEnabled: enabled, mode: modeVal };
        }

        case 'mark_topic_completed': {
          if (!st.activeBook || !st.currentPageData) return { ok: false };
          const targetDone = args.completed !== undefined ? Boolean(args.completed) : true;
          await togglePageCompleted(uid, st.activeBook.id, st.currentPageNumber, targetDone);
          setCurrentPageData({ ...st.currentPageData, isCompleted: targetDone });
          return { ok: true, pageNumber: st.currentPageNumber, isCompleted: targetDone };
        }

        case 'save_note': {
          if (!st.activeBook) return { ok: false, error: 'يجب فتح كتاب لحفظ الملاحظة فيه' };
          const noteId = await createNote(uid, {
            bookId: st.activeBook.id,
            bookTitle: st.activeBook.title,
            chapterTitle: st.currentPageData?.chapterTitle || '',
            pageNumber: st.currentPageNumber,
            noteType: 'explanation',
            title: String(args.title || `ملاحظة صفحة ${st.currentPageNumber}`),
            content: String(args.content || ''),
          });
          showToast('تم حفظ الملاحظة في حسابك.');
          return { ok: true, noteId, pageNumber: st.currentPageNumber };
        }

        case 'get_notes':
          return {
            ok: true,
            notes: st.notes.slice(0, 15).map((n) => ({
              id: n.id,
              title: n.title,
              bookTitle: n.bookTitle,
              pageNumber: n.pageNumber,
            })),
          };

        case 'open_saved_note': {
          const q = String(args.noteTitle || '').toLowerCase();
          const note = st.notes.find((n) => n.title.toLowerCase().includes(q));
          if (!note) return { ok: false, message: 'لم أجد ملاحظة بهذا العنوان.' };
          const book = st.books.find((b) => b.id === note.bookId);
          if (book) handleOpenBook(book, note.pageNumber);
          return { ok: true, openedNote: note.title, pageNumber: note.pageNumber };
        }

        case 'get_today_tasks': {
          const todayStr = new Date().toISOString().slice(0, 10);
          const today = st.studyTasks.filter((t) => t.date <= todayStr && t.status !== 'completed');
          return {
            ok: true,
            todayTasks: today.map((t) => ({
              id: t.id,
              bookTitle: t.bookTitle,
              chapterTitle: t.chapterTitle,
              pages: `${t.startPage}-${t.endPage}`,
              estimatedMinutes: t.estimatedMinutes,
            })),
          };
        }

        case 'create_study_plan': {
          const days = Math.max(1, Number(args.daysUntilExam || 14));
          const hours = Math.max(0.5, Number(args.dailyHours || 2));
          const requestedTitles = Array.isArray(args.bookTitles)
            ? args.bookTitles.map((x) => String(x).toLowerCase())
            : [];
          const matchedBooks =
            requestedTitles.length > 0
              ? st.books.filter((b) =>
                  requestedTitles.some(
                    (rt) => b.title.toLowerCase().includes(rt) || (b.subject || '').toLowerCase().includes(rt)
                  )
                )
              : st.books;
          if (matchedBooks.length === 0) {
            return { ok: false, message: 'لا توجد كتب مطابقة في مكتبتك لإنشاء الخطة.' };
          }
          const start = new Date();
          const end = new Date();
          end.setDate(end.getDate() + days);
          await handleCreateStudyPlan({
            bookIds: matchedBooks.map((b) => b.id),
            startDate: start.toISOString().slice(0, 10),
            examDate: end.toISOString().slice(0, 10),
            dailyHours: hours,
            availableDays: ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'],
            hardSubjects: [],
            studyMode: (args.studyMode as 'new' | 'review' | 'both') || 'both',
          });
          setActiveSection('plan');
          return { ok: true, message: 'تم إنشاء الخطة الدراسية وحفظها بنجاح.' };
        }

        case 'get_exam_result': {
          const latest = st.exams.find((e) => e.status === 'completed');
          return latest
            ? {
                ok: true,
                bookTitle: latest.bookTitle,
                score: latest.score,
                weakTopics: latest.weakTopics || [],
              }
            : { ok: false, message: 'لا توجد امتحانات مكتملة بعد.' };
        }

        case 'review_exam_mistakes':
          setActiveSection('exam');
          return { ok: true, message: 'تم فتح قسم الامتحانات لمراجعة الأخطاء.' };

        case 'open_answer_source': {
          const p = Number(args.pageNumber);
          if (st.activeBook && p >= 1 && p <= st.activeBook.totalPages) {
            setActiveSection('learn');
            await loadSpecificPage(st.activeBook, p);
            return { ok: true, pageNumber: p };
          }
          return { ok: false };
        }

        case 'generate_exam':
          setActiveSection('exam');
          return { ok: true, message: 'تم فتح قسم الاختبارات لإعداد الامتحان المطلوب.' };

        default:
          return { ok: true };
      }
    },
    [activeUid, handleOpenBook, loadSpecificPage, showToast]
  );

  const flushLiveDraftsToChat = useCallback(
    (flushInput: boolean, flushOutput: boolean) => {
      const uid = activeUid;
      const targetBookId = liveChatBookIdRef.current || stateRef.current.activeBook?.id;
      const pageNum = stateRef.current.currentPageNumber || 1;
      const chapterTitle = stateRef.current.currentPageData?.chapterTitle || '';

      if (flushInput) {
        const userText = liveInputDraftRef.current.trim();
        liveInputDraftRef.current = '';
        setLiveInputDraft('');
        if (uid && targetBookId && userText) {
          void saveBookChatMessage(uid, targetBookId, {
            role: 'user',
            text: userText,
            pageNumber: pageNum,
            chapterTitle,
          }).catch(() => {});
        }
      }

      if (flushOutput) {
        const tutorText = liveOutputDraftRef.current.trim();
        liveOutputDraftRef.current = '';
        setLiveOutputDraft('');
        if (uid && targetBookId && tutorText) {
          void saveBookChatMessage(uid, targetBookId, {
            role: 'assistant',
            text: tutorText,
            pageNumber: pageNum,
            chapterTitle,
          }).catch(() => {});
        }
      }
    },
    [activeUid]
  );

  // Live Voice Call Management (Single active session, voice transcripts merged into Book Chat)
  const handleStartLiveCall = async () => {
    if (!activeBook || !profile) return;
    // Disconnect any previous active call first so two voices can NEVER overlap
    if (liveClientRef.current) {
      liveClientRef.current.disconnect();
      liveClientRef.current = null;
    }

    setLiveError('');
    liveInputDraftRef.current = '';
    liveOutputDraftRef.current = '';
    setLiveInputDraft('');
    setLiveOutputDraft('');
    liveChatBookIdRef.current = activeBook.id;
    lastSyncedLiveKeyRef.current = '';

    const client = new GeminiLiveClient({
      onStatusChange: (status) => {
        if (liveClientRef.current !== client) return;
        setLiveState(status);
        if (status === 'disconnected' || status === 'error') {
          flushLiveDraftsToChat(true, true);
        }
      },
      onInputTranscript: (txt) => {
        if (liveClientRef.current !== client) return;
        const merged = `${liveInputDraftRef.current} ${txt}`.replace(/\s+/g, ' ').trim();
        liveInputDraftRef.current = merged;
        setLiveInputDraft(merged);
      },
      onOutputTranscript: (txt) => {
        if (liveClientRef.current !== client) return;
        // Finalize any pending spoken question from student right above the tutor's reply
        if (liveInputDraftRef.current.trim()) {
          flushLiveDraftsToChat(true, false);
        }
        const merged = `${liveOutputDraftRef.current} ${txt}`.replace(/\s+/g, ' ').trim();
        liveOutputDraftRef.current = merged;
        setLiveOutputDraft(merged);
      },
      onTurnComplete: () => {
        if (liveClientRef.current !== client) return;
        flushLiveDraftsToChat(true, true);
      },
      onPlaybackIdle: () => {
        if (liveClientRef.current !== client) return;
        // Auto-Advance in Live Explain mode waits until actual audio playback finishes!
        if (
          autoAdvanceEnabled &&
          autoAdvanceMode === 'explain' &&
          stateRef.current.activeBook &&
          stateRef.current.currentPageNumber < stateRef.current.activeBook.totalPages
        ) {
          void loadSpecificPage(stateRef.current.activeBook, stateRef.current.currentPageNumber + 1);
        }
      },
      onToolCall: async (call: LiveToolCall) => {
        const result = await executeToolCall(call.name, call.args);
        client.sendToolResult(call.id, call.name, result);
      },
      onError: (msg) => {
        if (liveClientRef.current === client) {
          setLiveError(msg);
        }
      },
    });

    liveClientRef.current = client;
    await client.connect({
      lang: profile.tutorLanguage,
      voiceName: profile.voiceName || 'Zephyr',
      mode: 'tutor',
    });

    if (liveClientRef.current !== client) return;

    const initialContext = `بدأت المكالمة الصوتية المباشرة مع الطالب على Gemini 3.8 Live:
- اسم الكتاب: ${activeBook.title}
- المادة: ${activeBook.subject || 'غير محددة'}
- الصفحة المعروضة الآن: ${currentPageNumber} من ${activeBook.totalPages}
- الفصل الحالي: ${currentPageData?.chapterTitle || 'غير محدد'}
${schoolGradesSummary.summaryText ? `- مستوى الطالب في سجل درجات المدرسة: ${schoolGradesSummary.summaryText}` : ''}
أرسلت لك صورة الصفحة ${currentPageNumber} لتقرأها بصرياً. رحّب بالطالب باختصار بلغة واحدة واضحة فقط (بدون خلط الإنجليزية مع العربية)، واذكر أنك ترى الصفحة ${currentPageNumber} أمامه الآن، والتزم بمحتوى هذه الصفحة فقط واسأله بماذا يود أن نبدأ الشرح.`;

    if (currentPageData) {
      lastSyncedLiveKeyRef.current = `${activeBook.id}:${currentPageNumber}:${currentPageData.imageData ? 'img' : 'noimg'}`;
    }
    client.sendContextUpdate(initialContext, currentPageData?.imageData, true);
  };

  const handleEndLiveCall = () => {
    lastSyncedLiveKeyRef.current = '';
    flushLiveDraftsToChat(true, true);
    liveClientRef.current?.disconnect();
    liveClientRef.current = null;
    setLiveState('disconnected');
    setLiveMuted(false);
    setAutoAdvanceEnabled(false);
  };

  // Text Chat Handler (supports visual-first multi-page queries + function calls + school grade awareness)
  const handleSendChat = async (
    text: string,
    options?: { selectedText?: string; selectedImage?: string }
  ) => {
    if (!activeUid || !activeBook || !profile) return;
    const uid = activeUid;
    setChatSending(true);
    try {
      await saveBookChatMessage(uid, activeBook.id, {
        role: 'user',
        text,
        pageNumber: currentPageNumber,
        chapterTitle: currentPageData?.chapterTitle || '',
        selectedText: options?.selectedText || '',
      });

      // Retrieve referenced pages if student asks about other pages (e.g., "من صفحة ٢٠ إلى صفحة ٤٠")
      const refNums = extractReferencedPageNumbers(text, activeBook.totalPages).filter(
        (n) => n !== currentPageNumber
      );
      const extraPages: { pageNumber: number; text?: string; imageData?: string }[] = [];
      for (const n of refNums) {
        let pg = await getCachedBookPage(uid, activeBook.id, n);
        if (!pg) pg = await getBookPage(uid, activeBook.id, n);
        if ((!pg || !pg.imageData) && activeBook.fileType === 'pdf') {
          const rendered = await renderPdfPageOnDemand(activeBook.id, n, true);
          if (rendered) {
            extraPages.push({ pageNumber: n, text: '', imageData: rendered.imageData });
            continue;
          }
        }
        if (pg) {
          extraPages.push({ pageNumber: n, text: pg.extractedText, imageData: pg.imageData });
        }
      }

      const res = await sendTutorChat({
        bookTitle: activeBook.title,
        subject: activeBook.subject,
        gradeLevel: profile.gradeLevel || activeBook.gradeLevel,
        currentPage: currentPageNumber,
        totalPages: activeBook.totalPages,
        chapterTitle: currentPageData?.chapterTitle || '',
        pageText: currentPageData?.extractedText || '',
        pageImage: currentPageData?.imageData,
        selectedText: options?.selectedText,
        selectedImage: options?.selectedImage,
        extraPages,
        chapters: activeBook.chapters,
        history: chatMessages.slice(-8).map((m) => ({ role: m.role, text: m.text })),
        userMessage: text,
        tutorLanguage: profile.tutorLanguage,
        weakSubjects: schoolGradesSummary.weakSubjects,
        weakSchoolSummary: schoolGradesSummary.summaryText,
      });

      let toolSummaryNotes = '';
      if (res.toolCalls && res.toolCalls.length > 0) {
        for (const tc of res.toolCalls) {
          const outcome = await executeToolCall(tc.name, tc.args);
          if (!outcome.ok && outcome.message) {
            toolSummaryNotes += `\n${String(outcome.message)}`;
          }
        }
      }

      const assistantReply = (res.reply || 'تم تنفيذ طلبك بنجاح.') + toolSummaryNotes;
      await saveBookChatMessage(uid, activeBook.id, {
        role: 'assistant',
        text: assistantReply.trim(),
        pageNumber: currentPageNumber,
        chapterTitle: currentPageData?.chapterTitle || '',
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر إرسال الرسالة.');
    } finally {
      setChatSending(false);
    }
  };

  const handleQuickSelectionAction = async (
    action: 'explain' | 'example' | 'explain_diagram',
    payload: { selectedText?: string; croppedImage?: string }
  ) => {
    if (!activeUid || !activeBook || !profile) return;
    setChatSending(true);
    try {
      const userLabel =
        action === 'explain_diagram'
          ? 'اشرح لي هذا الرسم المحدد من الصفحة'
          : action === 'example'
          ? `أعطني مثالاً يوضح: "${payload.selectedText?.slice(0, 120)}"`
          : `اشرح لي: "${payload.selectedText?.slice(0, 120)}"`;

      await saveBookChatMessage(activeUid, activeBook.id, {
        role: 'user',
        text: userLabel,
        pageNumber: currentPageNumber,
        chapterTitle: currentPageData?.chapterTitle || '',
        selectedText: payload.selectedText || '',
      });

      const res = await explainSelection({
        action,
        bookTitle: activeBook.title,
        pageNumber: currentPageNumber,
        chapterTitle: currentPageData?.chapterTitle || '',
        pageText: currentPageData?.extractedText || '',
        selectedText: payload.selectedText,
        croppedImage: payload.croppedImage,
        pageImage: currentPageData?.imageData,
        tutorLanguage: profile.tutorLanguage,
      });

      await saveBookChatMessage(activeUid, activeBook.id, {
        role: 'assistant',
        text: res.explanation,
        pageNumber: currentPageNumber,
        chapterTitle: currentPageData?.chapterTitle || '',
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'تعذر شرح التحديد.');
    } finally {
      setChatSending(false);
    }
  };

  // Create Study Plan
  const handleCreateStudyPlan = async (input: {
    bookIds: string[];
    startDate: string;
    examDate: string;
    dailyHours: number;
    availableDays: string[];
    hardSubjects: string[];
    studyMode: 'new' | 'review' | 'both';
  }) => {
    if (!activeUid) return;
    const chosenBooks = books.filter((b) => input.bookIds.includes(b.id));
    const aiPlan = await generateStudyPlanAI({
      books: chosenBooks.map((b) => ({
        id: b.id,
        title: b.title,
        subject: b.subject || b.title,
        totalPages: b.totalPages,
        completedCount: b.completedCount,
        chapters: (b.chapters || []).map((c) => ({
          title: c.title,
          startPage: c.startPage,
          difficulty: c.difficulty,
          estimatedMinutes: c.estimatedMinutes,
        })),
      })),
      startDate: input.startDate,
      examDate: input.examDate,
      dailyHours: input.dailyHours,
      availableDays: input.availableDays,
      hardSubjects: input.hardSubjects,
      studyMode: input.studyMode,
      weakTopics,
      weakSchoolSummary: schoolGradesSummary.summaryText,
    });

    const newPlanId = await createStudyPlanWithTasks(
      activeUid,
      {
        title: aiPlan.title || 'خطتي الدراسية',
        startDate: input.startDate,
        examDate: input.examDate,
        dailyHours: input.dailyHours,
        availableDays: input.availableDays,
        hardSubjects: input.hardSubjects,
        studyMode: input.studyMode,
        bookIds: input.bookIds,
        totalTasks: (aiPlan.tasks || []).length,
        completedTasks: 0,
        adviceMessage: aiPlan.adviceMessage || '',
        status: 'active',
      },
      (aiPlan.tasks || []).map((t, idx) => ({
        date: t.date || input.startDate,
        bookId: chosenBooks.find((b) => b.id === t.bookId)?.id || chosenBooks[0].id,
        bookTitle: t.bookTitle || chosenBooks[0].title,
        subject: t.subject || '',
        chapterTitle: t.chapterTitle || '',
        startPage: Math.max(1, t.startPage || 1),
        endPage: Math.max(t.startPage || 1, t.endPage || t.startPage || 1),
        estimatedMinutes: Math.max(10, t.estimatedMinutes || 30),
        actualMinutes: 0,
        taskType: t.taskType || 'study',
        difficulty: t.difficulty || 'medium',
        status: 'pending',
        orderIndex: idx,
      }))
    );
    setActivePlanId(newPlanId);
    showToast('تم إنشاء خطتك الدراسية الذكية!');
  };

  // Create Exam from exact scope pages (supports visual-first PDF/photo books via imageData)
  const handleCreateExam = async (config: {
    bookId: string;
    scopeType: 'progress' | 'book' | 'single_page' | 'range' | 'chapter' | 'chapters' | 'tasks';
    startPage: number;
    endPage: number;
    scopeLabel: string;
    mode: 'written' | 'oral';
    difficulty: DifficultyLevel;
    selectionStrategy: 'comprehensive' | 'important' | 'random';
    evaluationMode: 'practice' | 'exam';
    questionCount?: number;
    durationMinutes?: number;
    questionTypes: QuestionType[];
    focusWeakTopics?: string[];
  }) => {
    if (!activeUid || !profile) throw new Error('غير مصرح');
    const uid = activeUid;
    const book = books.find((b) => b.id === config.bookId);
    if (!book) throw new Error('الكتاب غير موجود');

    // Load actual pages strictly within scope (including imageData when text is absent)
    const scopePages: { pageNumber: number; text?: string; imageData?: string }[] = [];
    const maxPagesToSample = 10;
    const step = Math.max(1, Math.ceil((config.endPage - config.startPage + 1) / maxPagesToSample));

    for (let p = config.startPage; p <= config.endPage; p += step) {
      let pg = await getCachedBookPage(uid, book.id, p);
      if (!pg) pg = await getBookPage(uid, book.id, p);
      if ((!pg || !pg.imageData) && book.fileType === 'pdf') {
        const rendered = await renderPdfPageOnDemand(book.id, p, true);
        if (rendered) {
          scopePages.push({ pageNumber: p, text: '', imageData: rendered.imageData });
          continue;
        }
      }
      if (pg) {
        scopePages.push({
          pageNumber: p,
          text: pg.extractedText || '',
          imageData: pg.imageData,
        });
      }
    }

    if (scopePages.length === 0) {
      scopePages.push({ pageNumber: config.startPage, text: book.title });
    }

    const aiRes = await generateExamAI({
      bookTitle: book.title,
      scopeLabel: config.scopeLabel,
      pages: scopePages,
      difficulty: config.difficulty,
      selectionStrategy: config.selectionStrategy,
      questionCount: config.questionCount,
      questionTypes: config.questionTypes,
      weakTopics: config.focusWeakTopics || weakTopics,
      weakSchoolSummary: schoolGradesSummary.summaryText,
      tutorLanguage: profile.tutorLanguage,
    });

    const rawQuestions = aiRes.questions || [];
    if (rawQuestions.length === 0) {
      throw new Error('تعذر استخراج أسئلة كافية من هذا النطاق.');
    }

    const equalPts = Math.round((100 / rawQuestions.length) * 10) / 10;
    const examPayload: Omit<Exam, 'id' | 'userId'> = {
      bookId: book.id,
      bookTitle: book.title,
      scopeLabel: config.scopeLabel,
      startPage: config.startPage,
      endPage: config.endPage,
      mode: config.mode,
      difficulty: config.difficulty,
      selectionStrategy: config.selectionStrategy,
      evaluationMode: config.evaluationMode,
      durationMinutes: config.durationMinutes || 0,
      totalQuestions: rawQuestions.length,
      score: 0,
      status: 'in_progress',
      weakTopics: [],
      coverageWarning: aiRes.coverageWarning || '',
    };

    const { examId, questions: createdQs } = await createExamWithQuestions(
      uid,
      examPayload,
      rawQuestions.map((q, idx) => ({
        orderIndex: idx,
        questionType: (q.questionType as QuestionType) || 'essay',
        prompt: q.prompt,
        options: q.options || [],
        correctAnswer: q.correctAnswer,
        explanation: q.explanation || '',
        sourcePage: Math.max(config.startPage, Math.min(config.endPage, q.sourcePage || config.startPage)),
        topicTitle: q.topicTitle || config.scopeLabel,
        maxPoints: equalPts,
      }))
    );

    return {
      exam: { ...examPayload, id: examId, userId: uid },
      questions: createdQs,
    };
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] dark:bg-slate-950 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-700" />
        <p className="text-sm text-slate-600 dark:text-slate-400">جاري تجهيز حسابك...</p>
      </div>
    );
  }

  if (schoolRole === 'admin') {
    return (
      <AdminGate
        initialAdminCode={pendingAdminCode}
        onBack={() => {
          setSchoolRole(null);
          setPendingAdminCode('');
          setPortalOpen(true);
        }}
      />
    );
  }

  // Counselor & Student workspaces open strictly via school access codes — NO Google login required!
  if (schoolRole === 'counselor' || schoolRole === 'student') {
    return (
      <div
        dir="rtl"
        className="min-h-screen bg-[#FAF9F6] dark:bg-slate-950 text-slate-900 dark:text-slate-100 py-5 px-3 sm:px-6"
      >
        <div className="max-w-6xl mx-auto space-y-4">
          {schoolWorkspaceLoading && !schoolWorkspace && (
            <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-[#653CF5]" />
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                جاري تحميل {schoolRole === 'counselor' ? 'مساحة المرشد التربوي' : 'سجل درجات الطالب'}…
              </p>
            </div>
          )}

          {schoolWorkspaceError && !schoolWorkspace && (
            <div className="mx-auto max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900 p-6 space-y-4 shadow-sm">
              <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">
                {schoolWorkspaceError}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void loadSchoolWorkspace()}
                  className="min-h-[42px] px-4 rounded-xl bg-[#653CF5] text-white text-xs font-bold cursor-pointer"
                >
                  إعادة المحاولة
                </button>
                <button
                  type="button"
                  onClick={() => void handleSchoolLogout()}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
                >
                  العودة إلى بوابة المدرسة
                </button>
              </div>
            </div>
          )}

          {schoolWorkspace && schoolRole === 'counselor' && schoolWorkspace.session.sectionId && (
            <CounselorWorkspace
              workspace={schoolWorkspace}
              sectionId={schoolWorkspace.session.sectionId}
              onWorkspaceRefresh={loadSchoolWorkspace}
              onLogout={handleSchoolLogout}
            />
          )}

          {schoolWorkspace && schoolRole === 'student' && (
            <StudentRecordPortal
              workspace={schoolWorkspace}
              books={books}
              onWorkspaceRefresh={loadSchoolWorkspace}
              onBuildRemedialPlan={(weakSubs) => {
                setSchoolRole(null);
                if (!firebaseUser) setGuestMode(true);
                setRemedialSubjectsTrigger(weakSubs);
                setActiveSection('plan');
                setPortalOpen(false);
              }}
              onPracticeWeakArea={(_subject, bookId) => {
                setSchoolRole(null);
                if (!firebaseUser) setGuestMode(true);
                if (bookId) setExamPreselectedBookId(bookId);
                setActiveSection('exam');
                setPortalOpen(false);
              }}
              onLogout={handleSchoolLogout}
            />
          )}
        </div>
      </div>
    );
  }

  if (portalOpen || !activeUid || !profile) {
    return (
      <AuthView
        ready={Boolean(activeUid && profile)}
        profileError={profileError}
        onRetryProfile={() => void retryProfileLoad()}
        onSchoolRole={(role, adminCode) => {
          setPendingAdminCode(role === 'admin' ? adminCode || '' : '');
          setSchoolRole(role);
          setPortalOpen(false);
        }}
        onOpen={(section) => {
          setSchoolRole(null);
          setActiveSection(section);
          setPortalOpen(false);
        }}
        onEnterGuest={(section) => {
          setSchoolRole(null);
          setGuestMode(true);
          setActiveSection(section);
          setPortalOpen(false);
        }}
      />
    );
  }

  const navItems: { id: AppSection; label: string; icon: typeof Library }[] = [
    { id: 'library', label: 'مكتبتي', icon: Library },
    { id: 'learn', label: 'تعلّم', icon: BookOpen },
    { id: 'plan', label: 'خطتي الدراسية', icon: CalendarDays },
    { id: 'exam', label: 'اختبر نفسك', icon: FileCheck2 },
  ];

  const formatHeaderAudioTime = (sec: number) => {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  const isPageAudioLocked =
    pageAudio.phase === 'loading' || pageAudio.phase === 'playing' || pageAudio.phase === 'paused';

  const getHeaderLiveStatus = () => {
    switch (liveState) {
      case 'connecting':
        return 'جاري الاتصال...';
      case 'connected':
      case 'listening':
        return 'متصل · يستمع إليك';
      case 'speaking':
        return 'متصل · المعلم يتحدث';
      case 'paused':
        return 'متصل · متوقف مؤقتاً';
      case 'reconnecting':
        return 'يعيد الاتصال...';
      case 'error':
        return 'تعذر الاتصال';
      default:
        return 'المعلم المباشر';
    }
  };

  const showHeaderLiveStrip = (activeSection === 'learn' && Boolean(activeBook)) || liveState !== 'disconnected';

  return (
    <div className="min-h-screen bg-[#FAF9F6] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pb-20 md:pb-6">
      {/* Desktop & Mobile Top Navigation Bar + Persistent Audio Player Bar */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto h-14 md:h-16 px-4 sm:px-6 flex items-center justify-between gap-8">
          {/* Zone 1: Brand wordmark */}
          <span className="font-display font-bold text-lg sm:text-xl text-slate-900 dark:text-white whitespace-nowrap shrink-0">
            المعلم الذكي
          </span>

          {/* Zone 2: 4 Nav Links (Desktop) */}
          <nav aria-label="الأقسام الرئيسية" className="hidden md:flex items-center gap-6">
            {navItems.map((item) => {
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={`py-1.5 text-sm font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                    active
                      ? 'text-blue-700 dark:text-blue-400 border-blue-700 dark:border-blue-400'
                      : 'text-slate-600 dark:text-slate-300 border-transparent hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: School Portal Switcher + Settings Trigger */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                window.location.hash = '#school';
                setPortalOpen(true);
              }}
              className="min-h-[40px] px-3 rounded-xl border border-violet-200 dark:border-slate-700 bg-violet-50 dark:bg-slate-800 text-violet-700 dark:text-violet-300 text-xs sm:text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer hover:bg-violet-100 dark:hover:bg-slate-700"
              aria-label="بوابة المدرسة والدخول بالكود"
            >
              <School className="w-4 h-4" />
              <span className="hidden sm:inline">بوابة المدرسة</span>
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-semibold flex items-center gap-2 whitespace-nowrap cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700"
              aria-label="الإعدادات والحساب"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">الإعدادات</span>
            </button>
          </div>
        </div>

        {/* Persistent Top Header Audio Bar (stays visible across page flips & tabs until stopped/finished) */}
        {pageAudio.phase !== 'idle' && (
          <div className="border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-950/90">
            <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2.5">
              {/* Page & Status Label */}
              <div className="flex items-center gap-2 min-w-0">
                {pageAudio.phase === 'loading' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-blue-700 dark:text-blue-400 shrink-0" />
                ) : (
                  <Volume2 className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                )}
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate max-w-[170px] sm:max-w-[220px]">
                  قراءة ص {pageAudio.pageNumber}
                  {pageAudio.bookTitle ? ` · ${pageAudio.bookTitle}` : ''}
                </span>
              </div>

              {/* Loading Bar */}
              {pageAudio.phase === 'loading' && (
                <div className="flex-1 min-w-[160px] flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-blue-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-blue-700 dark:bg-blue-500 transition-all duration-300 rounded-full"
                      style={{ width: `${pageAudio.loadPercent}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-mono-num font-semibold text-blue-800 dark:text-blue-300 shrink-0">
                    {pageAudio.loadPercent}%
                  </span>
                </div>
              )}

              {/* Playback Bar + Pause/Play + Speed Controls */}
              {(pageAudio.phase === 'playing' || pageAudio.phase === 'paused') && (
                <div className="flex-1 min-w-[200px] flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={
                      pageAudio.phase === 'playing' ? handlePausePageAudio : handleResumePageAudio
                    }
                    title={pageAudio.phase === 'playing' ? 'إيقاف مؤقت' : 'إكمال'}
                    aria-label={pageAudio.phase === 'playing' ? 'إيقاف مؤقت' : 'إكمال'}
                    className="w-9 h-9 rounded-full bg-teal-700 hover:bg-teal-800 text-white flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    {pageAudio.phase === 'playing' ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </button>

                  <input
                    type="range"
                    min={0}
                    max={Math.max(0.1, pageAudio.duration)}
                    step={0.1}
                    value={Math.min(pageAudio.currentTime, pageAudio.duration)}
                    onChange={(e) => handleSeekPageAudio(Number(e.target.value))}
                    aria-label="شريط تقديم وترجيع الصوت"
                    className="flex-1 min-w-[90px] accent-teal-700 cursor-pointer"
                  />

                  <span className="text-[11px] font-mono-num text-slate-600 dark:text-slate-300 shrink-0" dir="ltr">
                    {formatHeaderAudioTime(pageAudio.currentTime)} / {formatHeaderAudioTime(pageAudio.duration)}
                  </span>

                  {/* Speed Controls: بطيء / عادي / سريع */}
                  <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 shrink-0">
                    {[
                      { rate: 0.75, label: 'بطيء' },
                      { rate: 1, label: '١×' },
                      { rate: 1.25, label: 'سريع' },
                      { rate: 1.5, label: '١.٥×' },
                    ].map((sp) => (
                      <button
                        key={sp.rate}
                        type="button"
                        onClick={() => handleChangePageAudioSpeed(sp.rate)}
                        className={`px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer transition-colors ${
                          Math.abs(pageAudio.playbackRate - sp.rate) < 0.05
                            ? 'bg-blue-700 text-white'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {sp.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Error Text */}
              {pageAudio.phase === 'error' && (
                <span className="flex-1 text-xs text-red-600 dark:text-red-400 truncate">
                  {pageAudio.error || 'تعذر تشغيل الصوت.'}
                </span>
              )}

              {/* Stop / Close Button */}
              <button
                type="button"
                onClick={handleStopPageAudio}
                title="إطفاء وإلغاء الصوت"
                aria-label="إطفاء وإلغاء الصوت"
                className="min-h-[34px] px-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>{pageAudio.phase === 'loading' ? 'إلغاء' : 'إطفاء'}</span>
              </button>
            </div>
          </div>
        )}
        {/* Sticky Top Header Live Call Bar (always visible at top of the page while studying or in a call) */}
        {showHeaderLiveStrip && (
          <div className="border-t border-slate-200/80 dark:border-slate-800 bg-teal-50/40 dark:bg-slate-900/95">
            <div className="max-w-6xl mx-auto px-3 sm:px-6 py-1.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    liveState === 'connected' || liveState === 'listening' || liveState === 'speaking'
                      ? 'bg-emerald-500 animate-pulse motion-reduce:animate-none'
                      : liveState === 'connecting' || liveState === 'reconnecting'
                      ? 'bg-amber-500 animate-pulse motion-reduce:animate-none'
                      : liveState === 'error'
                      ? 'bg-red-500'
                      : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                />
                <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  {getHeaderLiveStatus()}
                </span>
                {activeBook && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate hidden sm:inline">
                    · {activeBook.title} (ص {currentPageNumber})
                  </span>
                )}
              </div>

              {liveError && (
                <span className="text-[11px] text-red-600 dark:text-red-400 truncate max-w-[260px] sm:max-w-[360px]">
                  {liveError}
                </span>
              )}

              <div className="flex items-center gap-2 shrink-0">
                {liveState === 'disconnected' || liveState === 'error' ? (
                  <div className="relative flex items-center justify-center shrink-0">
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full bg-teal-500/40 animate-ping motion-reduce:animate-none pointer-events-none"
                    />
                    <button
                      type="button"
                      disabled={!activeBook}
                      onClick={() => void handleStartLiveCall()}
                      title={liveState === 'error' ? 'إعادة الاتصال بالمعلم' : 'اتصال مع المعلم'}
                      aria-label={liveState === 'error' ? 'إعادة الاتصال بالمعلم' : 'اتصال مع المعلم'}
                      className="relative w-10 h-10 rounded-full bg-teal-700 hover:bg-teal-800 active:scale-95 text-white flex items-center justify-center shadow-sm transition-all cursor-pointer disabled:opacity-50"
                    >
                      <Phone className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    {liveState !== 'connecting' && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const next = !liveMuted;
                            setLiveMuted(next);
                            liveClientRef.current?.setMuted(next);
                          }}
                          title={liveMuted ? 'إلغاء كتم الميكروفون' : 'كتم الميكروفون'}
                          aria-label={liveMuted ? 'إلغاء كتم الميكروفون' : 'كتم الميكروفون'}
                          className={`w-9 h-9 rounded-full flex items-center justify-center border transition-colors cursor-pointer ${
                            liveMuted
                              ? 'bg-amber-600 text-white border-amber-600'
                              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          {liveMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                        </button>

                        {liveState === 'paused' ? (
                          <button
                            type="button"
                            onClick={() => liveClientRef.current?.resumePlayback()}
                            title="استئناف الشرح"
                            aria-label="استئناف الشرح"
                            className="w-9 h-9 rounded-full bg-blue-700 hover:bg-blue-800 text-white flex items-center justify-center cursor-pointer"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => liveClientRef.current?.pausePlayback()}
                            title="إيقاف الشرح مؤقتاً"
                            aria-label="إيقاف الشرح مؤقتاً"
                            className="w-9 h-9 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center cursor-pointer"
                          >
                            <Pause className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    )}

                    <div className="relative flex items-center justify-center shrink-0">
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-full bg-red-500/35 animate-pulse motion-reduce:animate-none pointer-events-none"
                      />
                      <button
                        type="button"
                        onClick={handleEndLiveCall}
                        title={liveState === 'connecting' ? 'إلغاء الاتصال' : 'إنهاء المكالمة'}
                        aria-label={liveState === 'connecting' ? 'إلغاء الاتصال' : 'إنهاء المكالمة'}
                        className="relative w-10 h-10 rounded-full bg-red-600 hover:bg-red-700 active:scale-95 text-white flex items-center justify-center shadow-sm transition-all cursor-pointer"
                      >
                        <PhoneOff className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main Active Section */}
      <main className="flex-1">
        {activeSection === 'library' && (
          <LibrarySection
            books={books}
            uploadProgress={uploadProgress}
            backgroundStatus={backgroundStatus}
            schoolAverage={schoolGradesSummary.overallAverage}
            weakSubjects={schoolGradesSummary.weakSubjects}
            onNavigateToGrades={() => {
              setExamInitialSubTab('school_grades');
              setActiveSection('exam');
            }}
            onUploadFiles={handleUploadFiles}
            onOpenBook={(book) => handleOpenBook(book)}
            onRenameBook={async (bookId, title) => {
              await updateBookMetadata(activeUid, bookId, { title });
              showToast('تم تعديل اسم الكتاب.');
            }}
            onDeleteBook={async (bookId) => {
              if (activeBookId === bookId) setActiveBookId(null);
              await deleteBookFromLocalCache(activeUid, bookId);
              await deleteBookCascade(activeUid, bookId);
              showToast('تم حذف الكتاب.');
            }}
          />
        )}

        {activeSection === 'learn' && (
          <LearnSection
            books={books}
            activeBook={activeBook}
            currentPageNumber={currentPageNumber}
            currentPageData={currentPageData}
            loadingPage={loadingPage}
            pageZoom={pageZoom}
            onPageZoomChange={setPageZoom}
            tutorLanguage={profile.tutorLanguage}
            voiceName={profile.voiceName || 'Zephyr'}
            chatMessages={chatMessages}
            chatSending={chatSending}
            onSelectBook={(book) => handleOpenBook(book)}
            onNavigatePage={(p) => activeBook && void loadSpecificPage(activeBook, p)}
            onSaveProgressCheckpoint={handleSaveProgressCheckpoint}
            onTogglePageCompleted={async () => {
              if (!activeBook || !currentPageData) return;
              const nextState = !currentPageData.isCompleted;
              await togglePageCompleted(activeUid, activeBook.id, currentPageNumber, nextState);
              const updated = { ...currentPageData, isCompleted: nextState };
              setCurrentPageData(updated);
              await cacheBookPage(activeUid, activeBook.id, updated);
            }}
            pageAudio={pageAudio}
            isPageAudioLocked={isPageAudioLocked}
            onStartPageAudio={() => {
              if (activeBook) {
                void startVisualPageAudioFor(activeBook, currentPageNumber, currentPageData);
              }
            }}
            onSendChat={handleSendChat}
            onQuickSelectionAction={handleQuickSelectionAction}
            onSaveNote={async (noteInput) => {
              if (!activeBook) return;
              await createNote(activeUid, {
                bookId: activeBook.id,
                bookTitle: activeBook.title,
                chapterTitle: currentPageData?.chapterTitle || '',
                pageNumber: currentPageNumber,
                noteType: noteInput.noteType,
                title: noteInput.title,
                selectedText: noteInput.selectedText,
                content: noteInput.content,
              });
              showToast('تم حفظ الملاحظة.');
            }}
            onOpenNotesDrawer={() => setNotesDrawerOpen(true)}
            onExtractImportantTasks={async (scope) => {
              if (!activeBook) return [];
              const uid = activeUid;
              const pages: { pageNumber: number; text?: string; imageData?: string }[] = [];
              if (scope === 'page' && currentPageData) {
                pages.push({
                  pageNumber: currentPageNumber,
                  text: currentPageData.extractedText,
                  imageData: currentPageData.imageData,
                });
              } else {
                const start = Math.max(1, currentPageNumber - 2);
                const end = Math.min(activeBook.totalPages, currentPageNumber + 3);
                for (let p = start; p <= end; p++) {
                  let pg = (await getCachedBookPage(uid, activeBook.id, p)) || (await getBookPage(uid, activeBook.id, p));
                  if ((!pg || !pg.imageData) && activeBook.fileType === 'pdf') {
                    const rendered = await renderPdfPageOnDemand(activeBook.id, p, true);
                    if (rendered) {
                      pages.push({ pageNumber: p, text: '', imageData: rendered.imageData });
                      continue;
                    }
                  }
                  if (pg) {
                    pages.push({ pageNumber: p, text: pg.extractedText, imageData: pg.imageData });
                  }
                }
              }
              const res = await extractImportantTasks({
                bookTitle: activeBook.title,
                scopeLabel: scope === 'page' ? `صفحة ${currentPageNumber}` : `حول صفحة ${currentPageNumber}`,
                pages,
                tutorLanguage: profile.tutorLanguage,
              });
              return (res.items || []).map((item, idx) => ({
                id: `tsk_${idx}`,
                title: item.title,
                type: item.type,
                pageNumber: item.pageNumber || currentPageNumber,
                summary: item.summary,
              }));
            }}
            onStartExamFromTasks={(tasks) => {
              if (!activeBook) return;
              setExamPreselectedBookId(activeBook.id);
              setExamPreselectedTasks(tasks);
              setActiveSection('exam');
            }}
            liveState={liveState}
            liveMuted={liveMuted}
            liveInputDraft={liveInputDraft}
            liveOutputDraft={liveOutputDraft}
            liveError={liveError}
            autoAdvanceEnabled={autoAdvanceEnabled}
            autoAdvanceMode={autoAdvanceMode}
            onStartLiveCall={handleStartLiveCall}
            onEndLiveCall={handleEndLiveCall}
            onToggleLiveMute={() => {
              const next = !liveMuted;
              setLiveMuted(next);
              liveClientRef.current?.setMuted(next);
            }}
            onPauseLive={() => liveClientRef.current?.pausePlayback()}
            onResumeLive={() => liveClientRef.current?.resumePlayback()}
            onSendCroppedToLive={(croppedImg) => {
              liveClientRef.current?.sendContextUpdate(
                `حدد الطالب هذا الرسم في الصفحة ${currentPageNumber}؛ اشرح أجزاءه الظاهرة ووظيفة كل جزء وأسهمه بدقة دون اختراع تسميات غير موجودة:`,
                croppedImg,
                true
              );
            }}
            onToggleAutoAdvance={(enabled, mode) => {
              setAutoAdvanceEnabled(enabled);
              if (mode) setAutoAdvanceMode(mode);
            }}
            onGoToLibrary={() => setActiveSection('library')}
          />
        )}

        {activeSection === 'plan' && (
          <StudyPlanSection
            books={books}
            plans={plans}
            activePlan={activePlan}
            tasks={studyTasks}
            weakTopics={weakTopics}
            weakSubjectsFromGrades={schoolGradesSummary.weakSubjects}
            remedialSubjectsTrigger={remedialSubjectsTrigger}
            onClearRemedialTrigger={() => setRemedialSubjectsTrigger(null)}
            onSelectPlan={(p) => setActivePlanId(p.id)}
            onCreatePlan={handleCreateStudyPlan}
            onCompleteTask={async (task, actualMinutes) => {
              if (!activePlan) return;
              const nextCompletedCount =
                studyTasks.filter((t) => t.status === 'completed' || t.id === task.id).length;
              await updateStudyTaskStatus(
                activeUid,
                activePlan.id,
                task.id,
                { status: 'completed', actualMinutes },
                nextCompletedCount
              );
              showToast('تم تسجيل إنجاز المهمة!');
            }}
            onReschedulePlan={async () => {
              if (!activePlan) return;
              const todayStr = new Date().toISOString().slice(0, 10);
              const pending = studyTasks.filter((t) => t.status !== 'completed');
              const completed = studyTasks
                .filter((t) => t.status === 'completed')
                .slice(0, 10)
                .map((t) => ({
                  estimatedMinutes: t.estimatedMinutes,
                  actualMinutes: t.actualMinutes,
                  difficulty: t.difficulty,
                }));
              const res = await rescheduleStudyPlanAI({
                plan: {
                  examDate: activePlan.examDate,
                  dailyHours: activePlan.dailyHours,
                  availableDays: activePlan.availableDays,
                },
                pendingTasks: pending.map((t) => ({
                  id: t.id,
                  bookTitle: t.bookTitle,
                  chapterTitle: t.chapterTitle,
                  startPage: t.startPage,
                  endPage: t.endPage,
                  estimatedMinutes: t.estimatedMinutes,
                  taskType: t.taskType,
                })),
                completedSample: completed,
                todayDate: todayStr,
                weakTopics,
                weakSchoolSummary: schoolGradesSummary.summaryText,
              });
              for (const upd of res.updatedTasks || []) {
                await updateStudyTaskStatus(activeUid, activePlan.id, upd.id, {
                  date: upd.date,
                  estimatedMinutes: Math.max(10, upd.estimatedMinutes),
                });
              }
              showToast(res.adviceMessage || 'تم تحديث الجدول وتكييفه حسب تقدمك.');
            }}
            onDeletePlan={async (planId) => {
              await deleteStudyPlanCascade(activeUid, planId);
              setActivePlanId(null);
              showToast('تم حذف الخطة الدراسية.');
            }}
            onOpenTaskInBook={(bookId, pageNumber) => {
              const target = books.find((b) => b.id === bookId);
              if (target) handleOpenBook(target, pageNumber);
            }}
          />
        )}

        {activeSection === 'exam' && (
          <ExamSection
            books={books}
            exams={exams}
            schoolGrades={schoolGrades}
            initialSubTab={examInitialSubTab}
            onSubTabHandled={() => setExamInitialSubTab(undefined)}
            tutorLanguage={profile.tutorLanguage}
            voiceName={profile.voiceName || 'Zephyr'}
            preselectedTasks={examPreselectedTasks}
            preselectedBookId={examPreselectedBookId}
            onClearPreselection={() => {
              setExamPreselectedTasks(null);
              setExamPreselectedBookId(null);
            }}
            onCreateExam={handleCreateExam}
            onLoadExamQuestions={(examId) => getExamQuestions(activeUid, examId)}
            onSaveQuestionProgress={(examId, qId, updates) =>
              updateExamQuestionResult(activeUid, examId, qId, updates)
            }
            onSubmitWrittenExam={async (exam, qs) => {
              const uid = activeUid;
              const book = books.find((b) => b.id === exam.bookId);
              const refPages: { pageNumber: number; text: string }[] = [];
              for (const q of qs) {
                if (!refPages.some((rp) => rp.pageNumber === q.sourcePage)) {
                  const pg = await getCachedBookPage(uid, exam.bookId, q.sourcePage);
                  if (pg) refPages.push({ pageNumber: q.sourcePage, text: pg.extractedText });
                }
              }

              const graded = await gradeExamAI({
                bookTitle: book?.title || exam.bookTitle,
                questions: qs.map((q) => ({
                  id: q.id,
                  questionType: q.questionType,
                  prompt: q.prompt,
                  correctAnswer: q.correctAnswer,
                  studentAnswer: q.studentAnswer || '',
                  maxPoints: q.maxPoints,
                  sourcePage: q.sourcePage,
                  topicTitle: q.topicTitle,
                })),
                pages: refPages,
                tutorLanguage: profile.tutorLanguage,
              });

              for (const r of graded.results) {
                await updateExamQuestionResult(uid, exam.id, r.id, {
                  isCorrect: r.isCorrect,
                  earnedPoints: r.earnedPoints,
                  mistakeReason: r.mistakeReason,
                  explanation: r.explanation,
                });
              }
              await completeExamRecord(uid, exam.id, graded.score, graded.weakTopics);
              return { ...exam, score: graded.score, weakTopics: graded.weakTopics, status: 'completed' };
            }}
            onFinalizeOralExam={async (exam, qs) => {
              const uid = activeUid;
              const needsAutoGrade = qs.some((q) => q.isCorrect === undefined && q.studentAnswer);
              if (needsAutoGrade) {
                const graded = await gradeExamAI({
                  bookTitle: exam.bookTitle,
                  questions: qs.map((q) => ({
                    id: q.id,
                    questionType: q.questionType,
                    prompt: q.prompt,
                    correctAnswer: q.correctAnswer,
                    studentAnswer: q.studentAnswer || q.transcript || '',
                    maxPoints: q.maxPoints,
                    sourcePage: q.sourcePage,
                    topicTitle: q.topicTitle,
                  })),
                  pages: [],
                  tutorLanguage: profile.tutorLanguage,
                });
                for (const r of graded.results) {
                  await updateExamQuestionResult(uid, exam.id, r.id, {
                    isCorrect: r.isCorrect,
                    earnedPoints: r.earnedPoints,
                    mistakeReason: r.mistakeReason,
                    explanation: r.explanation,
                  });
                }
                await completeExamRecord(uid, exam.id, graded.score, graded.weakTopics);
                return { ...exam, score: graded.score, weakTopics: graded.weakTopics, status: 'completed' };
              }

              let totalMax = 0;
              let totalEarned = 0;
              const weakSet = new Set<string>();
              qs.forEach((q) => {
                totalMax += q.maxPoints;
                totalEarned += q.earnedPoints || 0;
                if (!q.isCorrect && q.topicTitle) weakSet.add(q.topicTitle);
              });
              const score = totalMax > 0 ? Math.round((totalEarned / totalMax) * 1000) / 10 : 0;
              const weakArr = Array.from(weakSet);
              await completeExamRecord(uid, exam.id, score, weakArr);
              return { ...exam, score, weakTopics: weakArr, status: 'completed' };
            }}
            onOpenSourcePage={(bookId, pageNum) => {
              const target = books.find((b) => b.id === bookId);
              if (target) handleOpenBook(target, pageNum);
            }}
            onExplainMistake={(bookId, pageNum, prompt) => {
              const target = books.find((b) => b.id === bookId);
              if (target) {
                handleOpenBook(target, pageNum);
                setTimeout(() => void handleSendChat(prompt), 500);
              }
            }}
            onAddSchoolGrade={async (grade) => {
              await createSchoolGrade(activeUid, grade);
              showToast('تمت إضافة الدرجة إلى سجل الصف!');
            }}
            onUpdateSchoolGrade={async (gradeId, updates) => {
              await updateSchoolGrade(activeUid, gradeId, updates);
              showToast('تم تحديث الدرجة.');
            }}
            onDeleteSchoolGrade={async (gradeId) => {
              await deleteSchoolGrade(activeUid, gradeId);
              showToast('تم حذف الدرجة.');
            }}
            onBuildRemedialPlan={(weakSubs) => {
              setRemedialSubjectsTrigger(weakSubs);
              setActiveSection('plan');
            }}
          />
        )}
      </main>
      {/* Fixed Bottom Navigation Bar on Mobile matching mockups */}
      <nav
        aria-label="التنقل السفلي"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800 grid grid-cols-4 items-center px-2 shadow-lg"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={`min-h-[48px] py-1 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold cursor-pointer transition-all ${
                active
                  ? 'bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 rounded-2xl mx-1 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="truncate max-w-full px-1">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Settings & Account Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        profile={profile}
        onUpdateProfile={async (updates) => {
          setProfile((prev) => {
            if (!prev) return prev;
            const next = { ...prev, ...updates };
            cacheUserProfileLocally(next);
            return next;
          });
          await saveUserProfile(activeUid, updates).catch(() => {});
          showToast('تم حفظ الإعدادات.');
        }}
        onSignOut={async () => {
          setSettingsOpen(false);
          if (firebaseUser) {
            await signOutUser();
          }
          setGuestMode(false);
          setPortalOpen(true);
        }}
        onDeleteAccount={async () => {
          await deleteAllTutorData(firebaseUser);
          setSettingsOpen(false);
          setGuestMode(false);
          setPortalOpen(true);
        }}
      />

      {/* Notes Drawer (Inside Learn / App without extra top-level tab) */}
      <NotesDrawer
        open={notesDrawerOpen}
        onClose={() => setNotesDrawerOpen(false)}
        notes={notes}
        currentBookId={activeBook?.id}
        currentBookTitle={activeBook?.title}
        currentChapterTitle={currentPageData?.chapterTitle}
        currentPage={currentPageNumber}
        onCreateManualNote={async (title, content) => {
          if (!activeBook) return;
          await createNote(activeUid, {
            bookId: activeBook.id,
            bookTitle: activeBook.title,
            chapterTitle: currentPageData?.chapterTitle || '',
            pageNumber: currentPageNumber,
            noteType: 'manual',
            title,
            content,
          });
          showToast('تم حفظ الملاحظة.');
        }}
        onUpdateNote={(noteId, title, content) =>
          updateNoteContent(activeUid, noteId, title, content)
        }
        onDeleteNote={(noteId) => deleteNoteRecord(activeUid, noteId)}
        onOpenNoteSource={(bookId, pageNumber) => {
          const target = books.find((b) => b.id === bookId);
          if (target) handleOpenBook(target, pageNumber);
        }}
      />

      {/* Non-intrusive Toast Notification */}
      {toastMsg && (
        <div
          role="status"
          className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs sm:text-sm font-semibold shadow-lg border border-slate-700"
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
