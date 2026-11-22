import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileCheck2,
  Mic,
  MicOff,
  PhoneOff,
  Clock,
  ChevronRight,
  ChevronLeft,
  RotateCcw,
  BookOpen,
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  GraduationCap,
} from 'lucide-react';
import type {
  Book,
  DifficultyLevel,
  Exam,
  ExamQuestion,
  ImportantTaskItem,
  LiveConnectionState,
  QuestionType,
  SchoolGrade,
  TutorLanguage,
} from '../types';
import { GeminiLiveClient } from '../services/liveAudioClient';
import { checkSingleQuestionAI } from '../services/aiClient';
import { SchoolGradesTab } from './SchoolGradesTab';

interface ExamSectionProps {
  books: Book[];
  exams: Exam[];
  schoolGrades: SchoolGrade[];
  initialSubTab?: 'smart_exams' | 'school_grades';
  onSubTabHandled?: () => void;
  tutorLanguage: TutorLanguage;
  voiceName: string;
  preselectedTasks?: ImportantTaskItem[] | null;
  preselectedBookId?: string | null;
  onClearPreselection: () => void;
  onCreateExam: (config: {
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
  }) => Promise<{ exam: Exam; questions: ExamQuestion[] }>;
  onLoadExamQuestions: (examId: string) => Promise<ExamQuestion[]>;
  onSaveQuestionProgress: (
    examId: string,
    questionId: string,
    updates: {
      studentAnswer?: string;
      transcript?: string;
      isCorrect?: boolean;
      earnedPoints?: number;
      mistakeReason?: string;
      explanation?: string;
    }
  ) => Promise<void>;
  onSubmitWrittenExam: (exam: Exam, questions: ExamQuestion[]) => Promise<Exam>;
  onFinalizeOralExam: (exam: Exam, questions: ExamQuestion[]) => Promise<Exam>;
  onOpenSourcePage: (bookId: string, pageNumber: number) => void;
  onExplainMistake: (bookId: string, pageNumber: number, prompt: string) => void;
  onAddSchoolGrade: (
    grade: Omit<SchoolGrade, 'id' | 'userId' | 'percentage' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
  onUpdateSchoolGrade: (
    gradeId: string,
    updates: Omit<SchoolGrade, 'id' | 'userId' | 'percentage' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
  onDeleteSchoolGrade: (gradeId: string) => Promise<void>;
  onBuildRemedialPlan: (weakSubjects: string[]) => void;
}

const QUESTION_TYPE_OPTIONS: { id: QuestionType; label: string }[] = [
  { id: 'mcq', label: 'اختيار من متعدد' },
  { id: 'true_false', label: 'صح أو خطأ' },
  { id: 'definition', label: 'التعريفات' },
  { id: 'reasoning', label: 'التعاليل' },
  { id: 'fill_blank', label: 'أكمل الفراغ' },
  { id: 'comparison', label: 'المقارنة' },
  { id: 'essay', label: 'الأسئلة المقالية' },
  { id: 'math', label: 'المسائل الحسابية' },
  { id: 'diagram', label: 'تفسير الرسومات' },
];

export const ExamSection: React.FC<ExamSectionProps> = ({
  books,
  exams,
  schoolGrades,
  initialSubTab,
  onSubTabHandled,
  tutorLanguage,
  voiceName,
  preselectedTasks,
  preselectedBookId,
  onClearPreselection,
  onCreateExam,
  onLoadExamQuestions,
  onSaveQuestionProgress,
  onSubmitWrittenExam,
  onFinalizeOralExam,
  onOpenSourcePage,
  onExplainMistake,
  onAddSchoolGrade,
  onUpdateSchoolGrade,
  onDeleteSchoolGrade,
  onBuildRemedialPlan,
}) => {
  const [subTab, setSubTab] = useState<'smart_exams' | 'school_grades'>(initialSubTab || 'smart_exams');
  const [view, setView] = useState<'setup' | 'taking' | 'result' | 'review'>('setup');

  // Setup state
  const [bookId, setBookId] = useState<string>(preselectedBookId || books[0]?.id || '');
  const [scopeType, setScopeType] = useState<'progress' | 'book' | 'single_page' | 'range' | 'chapter' | 'chapters' | 'tasks'>(
    preselectedTasks && preselectedTasks.length > 0 ? 'tasks' : 'progress'
  );
  const [singlePage, setSinglePage] = useState(1);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(5);
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [mode, setMode] = useState<'written' | 'oral'>('written');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('medium');
  const [selectionStrategy, setSelectionStrategy] = useState<'comprehensive' | 'important' | 'random'>('important');
  const [evaluationMode, setEvaluationMode] = useState<'practice' | 'exam'>('exam');
  const [autoQuestionCount, setAutoQuestionCount] = useState(true);
  const [questionCount, setQuestionCount] = useState(8);
  const [useTimer, setUseTimer] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>([
    'mcq',
    'true_false',
    'definition',
    'reasoning',
  ]);
  const [generating, setGenerating] = useState(false);
  const [setupError, setSetupError] = useState('');

  // Active exam state
  const [activeExam, setActiveExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingStep, setCheckingStep] = useState(false);
  const [stepNotice, setStepNotice] = useState('');

  // Oral Live Exam state
  const oralClientRef = useRef<GeminiLiveClient | null>(null);
  const [oralState, setOralState] = useState<LiveConnectionState>('disconnected');
  const [oralMuted, setOralMuted] = useState(false);
  const [oralInputTranscript, setOralInputTranscript] = useState('');
  const [oralOutputTranscript, setOralOutputTranscript] = useState('');
  const [oralError, setOralError] = useState('');
  const questionsRef = useRef<ExamQuestion[]>([]);
  questionsRef.current = questions;
  const activeExamRef = useRef<Exam | null>(null);
  activeExamRef.current = activeExam;
  const currentIndexRef = useRef<number>(0);
  currentIndexRef.current = currentIndex;

  useEffect(() => {
    if (!bookId && books[0]) {
      setBookId(books[0].id);
    }
  }, [books, bookId]);

  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
      setView('setup');
      onSubTabHandled?.();
    }
  }, [initialSubTab, onSubTabHandled]);

  useEffect(() => {
    if (preselectedBookId) {
      setBookId(preselectedBookId);
      setSubTab('smart_exams');
    }
    if (preselectedTasks && preselectedTasks.length > 0) {
      setScopeType('tasks');
      setSubTab('smart_exams');
    }
  }, [preselectedBookId, preselectedTasks]);

  const selectedBook = useMemo(() => books.find((b) => b.id === bookId) || null, [books, bookId]);

  useEffect(() => {
    if (selectedBook) {
      setRangeEnd(Math.min(selectedBook.totalPages, Math.max(1, selectedBook.lastPage || 5)));
    }
  }, [selectedBook?.id]);

  // Written countdown timer
  useEffect(() => {
    if (view !== 'taking' || secondsLeft === null) return;
    if (secondsLeft <= 0) {
      if (activeExam && activeExam.mode === 'written' && !submitting) {
        void handleSubmitWritten();
      }
      return;
    }
    const timer = window.setInterval(() => {
      setSecondsLeft((s) => (s !== null ? Math.max(0, s - 1) : null));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [view, secondsLeft, activeExam, submitting]);

  // Cleanup oral live call on unmount
  useEffect(() => {
    return () => {
      oralClientRef.current?.disconnect();
    };
  }, []);

  const computeScope = (): { startPage: number; endPage: number; scopeLabel: string } => {
    if (!selectedBook) return { startPage: 1, endPage: 1, scopeLabel: 'صفحة ١' };
    if (scopeType === 'progress') {
      const savedLast = Math.max(1, Math.min(selectedBook.totalPages, selectedBook.lastPage || 1));
      return {
        startPage: 1,
        endPage: savedLast,
        scopeLabel: `التقدم الذي وصلت إليه (ص 1 - ص ${savedLast})`,
      };
    }
    if (scopeType === 'book') {
      return { startPage: 1, endPage: selectedBook.totalPages, scopeLabel: 'الكتاب بالكامل' };
    }
    if (scopeType === 'single_page') {
      const p = Math.max(1, Math.min(selectedBook.totalPages, singlePage));
      return { startPage: p, endPage: p, scopeLabel: `صفحة ${p}` };
    }
    if (scopeType === 'range') {
      const s = Math.max(1, Math.min(selectedBook.totalPages, rangeStart));
      const e = Math.max(s, Math.min(selectedBook.totalPages, rangeEnd));
      return { startPage: s, endPage: e, scopeLabel: `من صفحة ${s} إلى صفحة ${e}` };
    }
    if (scopeType === 'tasks' && preselectedTasks && preselectedTasks.length > 0) {
      const pages = preselectedTasks.map((t) => t.pageNumber);
      const s = Math.min(...pages);
      const e = Math.max(...pages);
      return { startPage: s, endPage: e, scopeLabel: 'المهمات المستخرجة' };
    }
    if ((scopeType === 'chapter' || scopeType === 'chapters') && selectedBook.chapters.length > 0) {
      const chosen = selectedBook.chapters.filter((c) => selectedChapterIds.includes(c.id));
      const list = chosen.length > 0 ? chosen : [selectedBook.chapters[0]];
      const sortedAll = [...selectedBook.chapters].sort((a, b) => a.startPage - b.startPage);
      let minP = selectedBook.totalPages;
      let maxP = 1;
      for (const ch of list) {
        const idx = sortedAll.findIndex((c) => c.id === ch.id);
        const nextCh = idx >= 0 && idx + 1 < sortedAll.length ? sortedAll[idx + 1] : null;
        const chEnd = ch.endPage || (nextCh ? Math.max(ch.startPage, nextCh.startPage - 1) : selectedBook.totalPages);
        minP = Math.min(minP, ch.startPage);
        maxP = Math.max(maxP, chEnd);
      }
      return {
        startPage: minP,
        endPage: Math.max(minP, maxP),
        scopeLabel: list.map((c) => c.title).join('، '),
      };
    }
    return { startPage: 1, endPage: Math.min(5, selectedBook.totalPages), scopeLabel: 'نطاق افتراضي' };
  };

  const startExamFlow = async (focusWeak?: string[]) => {
    if (!selectedBook) return;
    setSetupError('');
    if (selectedTypes.length === 0) {
      setSetupError('اختر نوعاً واحداً على الأقل للأسئلة.');
      return;
    }
    const { startPage, endPage, scopeLabel } = computeScope();
    setGenerating(true);
    try {
      const { exam, questions: createdQs } = await onCreateExam({
        bookId: selectedBook.id,
        scopeType,
        startPage,
        endPage,
        scopeLabel,
        mode,
        difficulty,
        selectionStrategy,
        evaluationMode,
        questionCount: autoQuestionCount ? undefined : questionCount,
        durationMinutes: useTimer ? durationMinutes : 0,
        questionTypes: selectedTypes,
        focusWeakTopics: focusWeak,
      });
      onClearPreselection();
      setActiveExam(exam);
      setQuestions(createdQs);
      setCurrentIndex(0);
      setSecondsLeft(useTimer ? durationMinutes * 60 : null);
      setView('taking');

      if (exam.mode === 'oral') {
        await startOralLiveSession(exam, createdQs);
      }
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'تعذر إنشاء الامتحان.');
    } finally {
      setGenerating(false);
    }
  };

  const startOralLiveSession = async (exam: Exam, qs: ExamQuestion[]) => {
    setOralError('');
    setOralInputTranscript('');
    setOralOutputTranscript('');

    const client = new GeminiLiveClient({
      onStatusChange: (s) => setOralState(s),
      onInputTranscript: (txt) => {
        setOralInputTranscript((prev) => `${prev} ${txt}`.trim());
        const idx = currentIndexRef.current;
        const currentQ = questionsRef.current[idx];
        if (currentQ) {
          setQuestions((prev) =>
            prev.map((q) =>
              q.id === currentQ.id ? { ...q, transcript: `${q.transcript || ''} ${txt}`.trim(), studentAnswer: `${q.studentAnswer || ''} ${txt}`.trim() } : q
            )
          );
        }
      },
      onOutputTranscript: (txt) => {
        setOralOutputTranscript((prev) => `${prev} ${txt}`.trim().slice(-600));
      },
      onTurnComplete: () => {},
      onPlaybackIdle: () => {},
      onToolCall: async (call) => {
        if (call.name === 'submit_answer') {
          const args = call.args as {
            questionId?: string;
            transcript?: string;
            isCorrect?: boolean;
            earnedPoints?: number;
            mistakeReason?: string;
          };
          const idx = currentIndexRef.current;
          const targetQ =
            questionsRef.current.find((q) => q.id === args.questionId) || questionsRef.current[idx];
          if (targetQ) {
            const updatedAnswer = args.transcript || targetQ.studentAnswer || '';
            const earned =
              typeof args.earnedPoints === 'number'
                ? Math.max(0, Math.min(targetQ.maxPoints, args.earnedPoints))
                : args.isCorrect
                ? targetQ.maxPoints
                : 0;
            const upd = {
              studentAnswer: updatedAnswer,
              transcript: updatedAnswer,
              isCorrect: Boolean(args.isCorrect),
              earnedPoints: earned,
              mistakeReason: args.mistakeReason || '',
            };
            setQuestions((prev) => prev.map((q) => (q.id === targetQ.id ? { ...q, ...upd } : q)));
            await onSaveQuestionProgress(exam.id, targetQ.id, upd);

            const nextIdx = idx + 1;
            if (nextIdx < questionsRef.current.length) {
              setCurrentIndex(nextIdx);
              setOralInputTranscript('');
              client.sendToolResult(call.id, call.name, {
                ok: true,
                nextQuestionIndex: nextIdx + 1,
                nextQuestionPrompt: questionsRef.current[nextIdx].prompt,
              });
            } else {
              client.sendToolResult(call.id, call.name, {
                ok: true,
                allQuestionsAnswered: true,
              });
            }
          }
        } else if (call.name === 'finish_exam') {
          client.sendToolResult(call.id, call.name, { ok: true });
          await handleFinishOral();
        } else {
          client.sendToolResult(call.id, call.name, { ok: true });
        }
      },
      onError: (msg) => setOralError(msg),
    });

    oralClientRef.current = client;
    await client.connect({ lang: tutorLanguage, voiceName, mode: 'oral_exam' });

    const examBrief = `بدأت جلسة امتحان شفهي لكتاب "${exam.bookTitle}" (${exam.scopeLabel}).
وضع التقييم: ${exam.evaluationMode === 'exam' ? 'امتحان حقيقي (لا تكشف الإجابات قبل النهاية)' : 'تدريب (صحح واشرح بعد كل إجابة)'}.
الأسئلة بالترتيب:
${qs.map((q, i) => `${i + 1}. [id=${q.id}] ${q.prompt} (الدرجة: ${q.maxPoints}، الإجابة النموذجية المرجعية: ${q.correctAnswer})`).join('\n')}

ابدأ الآن بطرح السؤال الأول فقط بهدوء ووضوح وانتظر إجابة الطالب.`;

    client.sendContextUpdate(examBrief);
  };

  const handleAnswerChange = (questionId: string, answer: string) => {
    setStepNotice('');
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === questionId
          ? {
              ...q,
              studentAnswer: answer,
              transcript: answer,
              isCorrect: undefined,
              earnedPoints: undefined,
              mistakeReason: undefined,
            }
          : q
      )
    );
  };

  const persistCurrentQuestion = async (q: ExamQuestion) => {
    if (!activeExam) return;
    await onSaveQuestionProgress(activeExam.id, q.id, {
      studentAnswer: q.studentAnswer || '',
      transcript: q.transcript || '',
    });
  };

  const handleCheckCurrentQuestion = async (q: ExamQuestion): Promise<boolean> => {
    if (!activeExam) return false;
    const answer = (q.studentAnswer || '').trim();
    if (!answer) {
      setStepNotice('اختر أو اكتب إجابتك أولاً لتعرف إن كانت صحيحة أم خاطئة والسبب.');
      return false;
    }
    setStepNotice('');
    setCheckingStep(true);
    try {
      const res = await checkSingleQuestionAI({
        bookTitle: activeExam.bookTitle,
        question: {
          id: q.id,
          questionType: q.questionType,
          prompt: q.prompt,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          studentAnswer: answer,
          maxPoints: q.maxPoints,
          sourcePage: q.sourcePage,
        },
        tutorLanguage,
      });

      setQuestions((prev) =>
        prev.map((item) =>
          item.id === q.id
            ? {
                ...item,
                isCorrect: res.isCorrect,
                earnedPoints: res.earnedPoints,
                mistakeReason: res.reason,
                explanation: res.explanation || item.explanation,
              }
            : item
        )
      );

      await onSaveQuestionProgress(activeExam.id, q.id, {
        studentAnswer: answer,
        transcript: q.transcript || answer,
        isCorrect: res.isCorrect,
        earnedPoints: res.earnedPoints,
        mistakeReason: res.reason,
        explanation: res.explanation || q.explanation || '',
      });
      return true;
    } catch (err) {
      setStepNotice(
        err instanceof Error && err.message
          ? err.message
          : 'تعذر تصحيح هذه الخطوة الآن، حاول مرة أخرى.'
      );
      return false;
    } finally {
      setCheckingStep(false);
    }
  };

  const handleSubmitWritten = async () => {
    if (!activeExam || submitting) return;
    setSubmitting(true);
    try {
      const currentQ = questions[currentIndex];
      if (currentQ) await persistCurrentQuestion(currentQ);
      const completed = await onSubmitWrittenExam(activeExam, questions);
      const freshQs = await onLoadExamQuestions(completed.id);
      setActiveExam(completed);
      setQuestions(freshQs);
      setView('result');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinishOral = async () => {
    if (!activeExamRef.current || submitting) return;
    setSubmitting(true);
    oralClientRef.current?.disconnect();
    try {
      const completed = await onFinalizeOralExam(activeExamRef.current, questionsRef.current);
      const freshQs = await onLoadExamQuestions(completed.id);
      setActiveExam(completed);
      setQuestions(freshQs);
      setView('result');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenPastExam = async (exam: Exam) => {
    const qs = await onLoadExamQuestions(exam.id);
    setActiveExam(exam);
    setQuestions(qs);
    if (exam.status === 'completed') {
      setView('result');
    } else {
      setCurrentIndex(0);
      setView('taking');
    }
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // VIEW: RESULT SCREEN (Minimal & Clear per prompt spec)
  if (view === 'result' && activeExam) {
    const roundedScore = Math.round(activeExam.score);
    const wrongCount = questions.filter((q) => !q.isCorrect).length;

    return (
      <section className="max-w-2xl mx-auto px-4 py-10">
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-6">
          <div className="space-y-2">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {activeExam.bookTitle} · {activeExam.scopeLabel}
            </p>
            <h1 className="font-display text-4xl sm:text-5xl font-extrabold text-slate-900 dark:text-white font-mono-num">
              درجتك: {roundedScore} من ١٠٠
            </h1>
          </div>

          {activeExam.weakTopics && activeExam.weakTopics.length > 0 ? (
            <p className="text-sm sm:text-base text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 rounded-xl">
              تحتاج إلى مراجعة موضوع: {activeExam.weakTopics[0]}
            </p>
          ) : (
            <p className="text-sm sm:text-base text-teal-800 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40 px-4 py-3 rounded-xl">
              {wrongCount === 0 ? 'أحسنت! أتقنت جميع نقاط هذا النطاق.' : 'أداء جيد، راجع الأخطاء البسيطة لتثبيت المعلومة.'}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={() => setView('review')}
              className="flex-1 min-h-[50px] px-6 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-base cursor-pointer"
            >
              راجع أخطاءك
            </button>
            <button
              type="button"
              onClick={() => {
                setBookId(activeExam.bookId);
                void startExamFlow(activeExam.weakTopics);
              }}
              disabled={generating}
              className="flex-1 min-h-[50px] px-6 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-bold text-base cursor-pointer disabled:opacity-50"
            >
              {generating ? 'جاري إعداد أسئلة جديدة...' : 'أعد الاختبار'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setView('setup')}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline cursor-pointer"
          >
            العودة لإعداد امتحان جديد
          </button>
        </div>
      </section>
    );
  }

  // VIEW: MISTAKE REVIEW SCREEN
  if (view === 'review' && activeExam) {
    const wrongQuestions = questions.filter((q) => !q.isCorrect);
    return (
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              مراجعة الأخطاء — {activeExam.bookTitle}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              درجتك: {Math.round(activeExam.score)} من ١٠٠ · {wrongQuestions.length} أخطاء للمراجعة
            </p>
          </div>
          <button
            type="button"
            onClick={() => setView('result')}
            className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold cursor-pointer"
          >
            العودة للنتيجة
          </button>
        </div>

        {wrongQuestions.length === 0 ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-2">
            <CheckCircle2 className="w-10 h-10 text-teal-600 mx-auto" />
            <p className="font-semibold text-slate-900 dark:text-white">لا توجد أخطاء في هذا الامتحان!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {wrongQuestions.map((q, idx) => (
              <article
                key={q.id}
                className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-base text-slate-900 dark:text-white">
                    {idx + 1}. {q.prompt}
                  </h3>
                  <span className="text-xs font-mono-num text-red-600 dark:text-red-400 shrink-0">
                    {q.earnedPoints || 0} / {q.maxPoints}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="p-3 rounded-xl bg-red-50/70 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
                    <span className="text-xs font-semibold text-red-700 dark:text-red-400 block mb-1">
                      إجابتك:
                    </span>
                    <p className="text-slate-800 dark:text-slate-200">{q.studentAnswer || '(لم تُجب)'}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900">
                    <span className="text-xs font-semibold text-teal-700 dark:text-teal-400 block mb-1">
                      الإجابة الصحيحة:
                    </span>
                    <p className="text-slate-800 dark:text-slate-200">{q.correctAnswer}</p>
                  </div>
                </div>

                {q.mistakeReason && (
                  <p className="text-xs sm:text-sm text-amber-800 dark:text-amber-300">
                    <strong>سبب الخطأ:</strong> {q.mistakeReason}
                  </p>
                )}

                {q.explanation && (
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    <strong>توضيح التصحيح:</strong> {q.explanation}
                  </p>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      onExplainMistake(
                        activeExam.bookId,
                        q.sourcePage,
                        `اشرح لي هذا السؤال ولماذا الإجابة الصحيحة هي "${q.correctAnswer}": ${q.prompt}`
                      )
                    }
                    className="min-h-[40px] px-4 rounded-xl bg-blue-700 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>اشرح لي</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenSourcePage(activeExam.bookId, q.sourcePage)}
                    className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <BookOpen className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                    <span>افتح الصفحة الأصلية (ص {q.sourcePage})</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  // VIEW: TAKING EXAM (WRITTEN OR ORAL)
  if (view === 'taking' && activeExam) {
    const currentQ = questions[currentIndex];
    const isPractice = activeExam.evaluationMode === 'practice';

    return (
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Exam Top Header */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display font-bold text-lg text-slate-900 dark:text-white">
              {activeExam.mode === 'oral' ? 'امتحان شفهي' : 'امتحان كتابي'} — {activeExam.bookTitle}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {activeExam.scopeLabel} · سؤال <span className="font-mono-num">{currentIndex + 1}</span> من{' '}
              <span className="font-mono-num">{questions.length}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            {secondsLeft !== null && (
              <div className="px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 text-sm font-mono-num font-bold flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                <span>{formatTimer(secondsLeft)}</span>
              </div>
            )}
            {activeExam.mode === 'written' ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmitWritten()}
                className="min-h-[42px] px-5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'جاري التصحيح...' : 'تسليم الامتحان'}
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleFinishOral()}
                className="min-h-[42px] px-5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <PhoneOff className="w-4 h-4" />
                <span>{submitting ? 'جاري احتساب الدرجة...' : 'إنهاء الامتحان الشفهي'}</span>
              </button>
            )}
          </div>
        </div>

        {activeExam.coverageWarning && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{activeExam.coverageWarning}</span>
          </div>
        )}

        {/* Oral Exam Live Panel */}
        {activeExam.mode === 'oral' && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-teal-700 dark:text-teal-400">
                حالة الاتصال الشفهي: {oralState === 'speaking' ? 'المعلم يقرأ السؤال' : oralState === 'listening' ? 'يستمع لإجابتك' : oralState}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const next = !oralMuted;
                    setOralMuted(next);
                    oralClientRef.current?.setMuted(next);
                  }}
                  className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  {oralMuted ? <MicOff className="w-4 h-4 text-red-600" /> : <Mic className="w-4 h-4 text-teal-600" />}
                  <span>{oralMuted ? 'فتح الميكروفون' : 'كتم الميكروفون'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (currentQ) {
                      oralClientRef.current?.sendTextPrompt(`أعد قراءة السؤال رقم ${currentIndex + 1} من فضلك: ${currentQ.prompt}`);
                    }
                  }}
                  className="min-h-[40px] px-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>أعد السؤال</span>
                </button>
              </div>
            </div>

            {oralOutputTranscript && (
              <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl">
                <strong>المعلم:</strong> {oralOutputTranscript}
              </p>
            )}
            {oralError && <p className="text-xs text-red-600">{oralError}</p>}
          </div>
        )}

        {/* Current Question Card */}
        {currentQ && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>سؤال {currentIndex + 1} · {currentQ.topicTitle || 'موضوع الدرس'}</span>
              <span className="font-mono-num">{currentQ.maxPoints} درجات</span>
            </div>

            <h2 className="font-display font-bold text-lg sm:text-xl text-slate-900 dark:text-white leading-relaxed">
              {currentQ.prompt}
            </h2>

            {currentQ.options && currentQ.options.length > 0 ? (
              <div className="space-y-2.5">
                {currentQ.options.map((opt, oIdx) => {
                  const chosen = currentQ.studentAnswer === opt;
                  return (
                    <button
                      key={oIdx}
                      type="button"
                      onClick={() => handleAnswerChange(currentQ.id, opt)}
                      className={`w-full min-h-[48px] px-4 py-3 rounded-xl border text-right text-sm font-medium transition-colors cursor-pointer ${
                        chosen
                          ? 'bg-blue-700 text-white border-blue-700'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {activeExam.mode === 'oral'
                    ? 'النص المفهوم من إجابتك الصوتية (يمكنك تصحيحه يدوياً إذا أخطأ التعرف على الكلام):'
                    : 'اكتب إجابتك هنا:'}
                </label>
                <textarea
                  rows={4}
                  value={currentQ.studentAnswer || oralInputTranscript || ''}
                  onChange={(e) => handleAnswerChange(currentQ.id, e.target.value)}
                  placeholder="اكتب الإجابة..."
                  className="w-full p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            )}

            {/* Step-by-Step Verification Controls & Feedback (Written Exam) */}
            {activeExam.mode === 'written' && (
              <div className="space-y-3">
                {stepNotice && (
                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs sm:text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{stepNotice}</span>
                  </div>
                )}

                {currentQ.isCorrect === undefined ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={checkingStep || submitting}
                      onClick={() => void handleCheckCurrentQuestion(currentQ)}
                      className="min-h-[44px] px-5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {checkingStep ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>جاري التحقق من إجابتك...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>تحقق من إجابتي الآن</span>
                        </>
                      )}
                    </button>
                    {!isPractice && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        ستظهر لك صحة الإجابة والسبب قبل الانتقال للسؤال التالي
                      </span>
                    )}
                  </div>
                ) : (
                  <div
                    className={`p-4 rounded-xl border space-y-2 ${
                      currentQ.isCorrect
                        ? 'bg-teal-50/80 dark:bg-teal-950/30 border-teal-300 dark:border-teal-800'
                        : 'bg-red-50/80 dark:bg-red-950/30 border-red-300 dark:border-red-800'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {currentQ.isCorrect ? (
                          <CheckCircle2 className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
                        )}
                        <span
                          className={`font-bold text-sm ${
                            currentQ.isCorrect
                              ? 'text-teal-800 dark:text-teal-300'
                              : 'text-red-800 dark:text-red-300'
                          }`}
                        >
                          {currentQ.isCorrect ? 'إجابة صحيحة' : 'إجابة غير صحيحة'}
                        </span>
                      </div>
                      <span className="text-xs font-mono-num font-bold text-slate-700 dark:text-slate-200">
                        {currentQ.earnedPoints ?? 0} / {currentQ.maxPoints}
                      </span>
                    </div>

                    {currentQ.mistakeReason && (
                      <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                        <strong>السبب (لماذا): </strong>
                        {currentQ.mistakeReason}
                      </p>
                    )}

                    <p className="text-xs sm:text-sm text-blue-800 dark:text-blue-300">
                      <strong>الإجابة النموذجية: </strong>
                      {currentQ.correctAnswer}
                    </p>

                    {currentQ.explanation && (
                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        <strong>التوضيح: </strong>
                        {currentQ.explanation}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Question Navigation */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={currentIndex === 0 || checkingStep}
                onClick={async () => {
                  setStepNotice('');
                  await persistCurrentQuestion(currentQ);
                  setCurrentIndex((i) => Math.max(0, i - 1));
                }}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
                <span>السابق</span>
              </button>

              <div className="flex flex-wrap gap-1">
                {questions.map((qItem, idx) => (
                  <button
                    key={qItem.id}
                    type="button"
                    disabled={checkingStep}
                    onClick={async () => {
                      setStepNotice('');
                      await persistCurrentQuestion(currentQ);
                      setCurrentIndex(idx);
                    }}
                    className={`w-9 h-9 rounded-lg text-xs font-mono-num font-semibold cursor-pointer ${
                      idx === currentIndex
                        ? 'bg-blue-700 text-white'
                        : qItem.isCorrect === true
                        ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-300 border border-teal-300 dark:border-teal-800'
                        : qItem.isCorrect === false
                        ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-800'
                        : qItem.studentAnswer
                        ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>

              {currentIndex < questions.length - 1 ? (
                <button
                  type="button"
                  disabled={checkingStep || submitting}
                  onClick={async () => {
                    if (activeExam.mode === 'written' && currentQ.isCorrect === undefined) {
                      // First check & show why, staying on current step so the student reads the feedback
                      await handleCheckCurrentQuestion(currentQ);
                      return;
                    }
                    setStepNotice('');
                    await persistCurrentQuestion(currentQ);
                    setCurrentIndex((i) => Math.min(questions.length - 1, i + 1));
                  }}
                  className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-40"
                >
                  {checkingStep ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>جاري الفحص...</span>
                    </>
                  ) : activeExam.mode === 'written' && currentQ.isCorrect === undefined ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>تحقق أولاً</span>
                    </>
                  ) : (
                    <>
                      <span>التالي</span>
                      <ChevronLeft className="w-4 h-4" />
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={checkingStep || submitting}
                  onClick={() =>
                    void (activeExam.mode === 'written' ? handleSubmitWritten() : handleFinishOral())
                  }
                  className="min-h-[44px] px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold cursor-pointer disabled:opacity-40"
                >
                  {submitting
                    ? 'جاري الإنهاء...'
                    : activeExam.mode === 'written'
                    ? 'إنهاء وتسليم الامتحان'
                    : 'إنهاء الامتحان الشفهي'}
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    );
  }

  // VIEW: EXAM SETUP & SCHOOL GRADES RECORD
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            اختبر نفسك وسجل درجات الصف
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            أنشئ اختبارات شفهية وكتابية أو سجّل درجاتك المدرسية الحقيقية لتشخيص نقاط الضعف وتحسين مستواك العلمي
          </p>
        </div>

        <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 border border-slate-200 dark:border-slate-700 self-start">
          {(
            [
              { id: 'smart_exams', label: 'الاختبارات الذكية', icon: FileCheck2 },
              { id: 'school_grades', label: 'سجل درجات الصف', icon: GraduationCap },
            ] as { id: 'smart_exams' | 'school_grades'; label: string; icon: typeof FileCheck2 }[]
          ).map((t) => {
            const Icon = t.icon;
            const active = subTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id)}
                className={`min-h-[40px] px-4 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {subTab === 'school_grades' ? (
        <SchoolGradesTab
          grades={schoolGrades}
          books={books}
          onAddGrade={onAddSchoolGrade}
          onUpdateGrade={onUpdateSchoolGrade}
          onDeleteGrade={onDeleteSchoolGrade}
          onBuildRemedialPlan={onBuildRemedialPlan}
          onPracticeWeakArea={(subj, linkedBookId) => {
            const matched =
              (linkedBookId && books.find((b) => b.id === linkedBookId)) ||
              books.find(
                (b) =>
                  (b.subject || '').toLowerCase().includes(subj.toLowerCase()) ||
                  b.title.toLowerCase().includes(subj.toLowerCase())
              ) ||
              books[0];
            if (matched) setBookId(matched.id);
            setSubTab('smart_exams');
          }}
        />
      ) : (
        <>
          {setupError && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300"
            >
              {setupError}
            </div>
          )}

          {books.length === 0 ? (
            <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center text-sm text-slate-500">
              ارفع كتاباً أولاً في قسم «مكتبتي» لتتمكن من إجراء الاختبارات عليه.
            </div>
          ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Exam Configurator */}
          <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-5">
            {/* Book selector */}
            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                1. اختر الكتاب
              </label>
              <select
                value={bookId}
                onChange={(e) => setBookId(e.target.value)}
                className="w-full min-h-[46px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-semibold"
              >
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title} ({b.totalPages} صفحة)
                  </option>
                ))}
              </select>
            </div>

            {/* Scope */}
            <div className="space-y-2.5">
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                2. نطاق الامتحان
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(
                  [
                    { id: 'progress', label: 'التقدم الذي وصلت إليه' },
                    { id: 'range', label: 'نطاق صفحات محدد' },
                    { id: 'single_page', label: 'صفحة واحدة' },
                    { id: 'chapter', label: 'فصل كامل' },
                    { id: 'chapters', label: 'عدة فصول' },
                    { id: 'book', label: 'الكتاب بالكامل' },
                    ...(preselectedTasks && preselectedTasks.length > 0
                      ? [{ id: 'tasks' as const, label: 'المهمات المستخرجة' }]
                      : []),
                  ] as { id: typeof scopeType; label: string }[]
                ).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setScopeType(s.id)}
                    className={`min-h-[42px] px-3 rounded-xl text-xs sm:text-sm font-semibold border cursor-pointer ${
                      scopeType === s.id
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {scopeType === 'progress' && selectedBook && (
                <p className="text-xs text-teal-800 dark:text-teal-300 bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900 px-3 py-2.5 rounded-xl">
                  سيتم إنشاء الاختبار من الصفحات التي أنجزتها وفق نقطة مواصلة التقدم المحفوظة (من صفحة ١ إلى صفحة{' '}
                  <span className="font-mono-num font-bold">{Math.max(1, selectedBook.lastPage || 1)}</span>).
                </p>
              )}

              {scopeType === 'single_page' && selectedBook && (
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-xs font-semibold">رقم الصفحة:</span>
                  <input
                    type="number"
                    min={1}
                    max={selectedBook.totalPages}
                    value={singlePage}
                    onChange={(e) => setSinglePage(Number(e.target.value))}
                    className="w-24 min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono-num"
                  />
                </div>
              )}

              {scopeType === 'range' && selectedBook && (
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <label className="text-xs font-semibold">من صفحة:</label>
                  <input
                    type="number"
                    min={1}
                    max={selectedBook.totalPages}
                    value={rangeStart}
                    onChange={(e) => setRangeStart(Number(e.target.value))}
                    className="w-24 min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono-num"
                  />
                  <label className="text-xs font-semibold">إلى صفحة:</label>
                  <input
                    type="number"
                    min={1}
                    max={selectedBook.totalPages}
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(Number(e.target.value))}
                    className="w-24 min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono-num"
                  />
                </div>
              )}

              {(scopeType === 'chapter' || scopeType === 'chapters') && selectedBook && (
                <div className="pt-1 space-y-2 max-h-44 overflow-y-auto thin-scrollbar">
                  {selectedBook.chapters.length === 0 ? (
                    <p className="text-xs text-slate-500">لا توجد فصول مفهرسة بعد؛ استخدم نطاق الصفحات.</p>
                  ) : (
                    selectedBook.chapters.map((ch) => {
                      const active = selectedChapterIds.includes(ch.id);
                      return (
                        <label
                          key={ch.id}
                          className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm cursor-pointer"
                        >
                          <input
                            type={scopeType === 'chapter' ? 'radio' : 'checkbox'}
                            name="exam-chapter"
                            checked={active}
                            onChange={() =>
                              setSelectedChapterIds((prev) =>
                                scopeType === 'chapter'
                                  ? [ch.id]
                                  : prev.includes(ch.id)
                                  ? prev.filter((id) => id !== ch.id)
                                  : [...prev, ch.id]
                              )
                            }
                            className="accent-blue-700"
                          />
                          <span>
                            {ch.title} (ص {ch.startPage})
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Method & Evaluation Mode */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                  3. طريقة الامتحان
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('written')}
                    className={`min-h-[44px] rounded-xl text-sm font-semibold border cursor-pointer ${
                      mode === 'written'
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    امتحان كتابي
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('oral')}
                    className={`min-h-[44px] rounded-xl text-sm font-semibold border cursor-pointer ${
                      mode === 'oral'
                        ? 'bg-teal-700 text-white border-teal-700'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    امتحان شفهي بالصوت
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                  4. نظام التصحيح
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEvaluationMode('practice')}
                    className={`min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold border cursor-pointer ${
                      evaluationMode === 'practice'
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    وضع التدريب (فوري)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEvaluationMode('exam')}
                    className={`min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold border cursor-pointer ${
                      evaluationMode === 'exam'
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    وضع الامتحان الحقيقي
                  </button>
                </div>
              </div>
            </div>

            {/* Difficulty & Selection Strategy */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                  5. مستوى الصعوبة
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'easy', label: 'سهل' },
                      { id: 'medium', label: 'متوسط' },
                      { id: 'hard', label: 'صعب' },
                    ] as const
                  ).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDifficulty(d.id)}
                      className={`min-h-[42px] rounded-xl text-xs sm:text-sm font-semibold border cursor-pointer ${
                        difficulty === d.id
                          ? 'bg-blue-700 text-white border-blue-700'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                  6. طريقة اختيار الأسئلة
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'comprehensive', label: 'شامل' },
                      { id: 'important', label: 'المهمات' },
                      { id: 'random', label: 'عشوائي' },
                    ] as const
                  ).map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setSelectionStrategy(st.id)}
                      className={`min-h-[42px] rounded-xl text-xs sm:text-sm font-semibold border cursor-pointer ${
                        selectionStrategy === st.id
                          ? 'bg-blue-700 text-white border-blue-700'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Question types */}
            <div className="space-y-2">
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                7. أنواع الأسئلة
              </span>
              <div className="flex flex-wrap gap-2">
                {QUESTION_TYPE_OPTIONS.map((qt) => {
                  const active = selectedTypes.includes(qt.id);
                  return (
                    <button
                      key={qt.id}
                      type="button"
                      onClick={() =>
                        setSelectedTypes((prev) =>
                          prev.includes(qt.id) ? prev.filter((x) => x !== qt.id) : [...prev, qt.id]
                        )
                      }
                      className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold border cursor-pointer ${
                        active
                          ? 'bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-600'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {qt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Count & Optional Timer */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoQuestionCount}
                    onChange={(e) => setAutoQuestionCount(e.target.checked)}
                    className="accent-blue-700"
                  />
                  <span>ترك عدد الأسئلة لتقدير المعلم الذكي</span>
                </label>
                {!autoQuestionCount && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs">عدد الأسئلة:</span>
                    <input
                      type="number"
                      min={2}
                      max={40}
                      value={questionCount}
                      onChange={(e) => setQuestionCount(Number(e.target.value))}
                      className="w-20 min-h-[38px] px-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-mono-num text-center"
                    />
                  </div>
                )}
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useTimer}
                    onChange={(e) => setUseTimer(e.target.checked)}
                    className="accent-blue-700"
                  />
                  <span>تفعيل مؤقت زمني للامتحان</span>
                </label>
                {useTimer && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs">المدة (دقيقة):</span>
                    <input
                      type="number"
                      min={2}
                      max={180}
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(Number(e.target.value))}
                      className="w-20 min-h-[38px] px-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-mono-num text-center"
                    />
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              disabled={generating}
              onClick={() => void startExamFlow()}
              className="w-full min-h-[52px] rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-base flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-60"
            >
              {generating ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileCheck2 className="w-5 h-5" />}
              <span>{generating ? 'جاري توليد الأسئلة من محتوى الكتاب...' : 'ابدأ الامتحان الآن'}</span>
            </button>
          </div>

          {/* Previous Exams History */}
          <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <h2 className="font-display font-bold text-base text-slate-900 dark:text-white">
              سجل الامتحانات السابقة
            </h2>
            {exams.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                لم تُجرِ أي امتحان بعد.
              </p>
            ) : (
              <div className="space-y-2.5">
                {exams.slice(0, 10).map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => void handleOpenPastExam(ex)}
                    className="w-full text-right p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 hover:border-blue-400 transition-colors space-y-1 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                        {ex.bookTitle}
                      </span>
                      <span className="font-mono-num text-xs font-bold text-blue-700 dark:text-blue-400 shrink-0">
                        {ex.status === 'completed' ? `${Math.round(ex.score)}/100` : 'قيد الحل'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {ex.scopeLabel} · {ex.mode === 'oral' ? 'شفهي' : 'كتابي'}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
        </>
      )}
    </section>
  );
};
