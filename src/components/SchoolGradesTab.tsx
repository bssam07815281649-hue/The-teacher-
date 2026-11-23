import React, { useMemo, useState } from 'react';
import {
  Plus,
  Edit3,
  Trash2,
  Check,
  X,
  TrendingUp,
  AlertTriangle,
  CalendarCheck,
  FileCheck2,
  GraduationCap,
  Building2,
  Loader2,
  UserCheck,
} from 'lucide-react';
import type {
  Book,
  SchoolExamType,
  SchoolGrade,
  SchoolPublicPayload,
  SchoolSessionUser,
  SchoolWorkspacePayload,
} from '../types';
import {
  clearSchoolSessionToken,
  fetchSchoolPublic,
  fetchSchoolWorkspace,
  getSchoolSessionToken,
  logoutSchoolSession,
  setSchoolUnauthorizedHandler,
} from '../services/schoolRecordClient';
import { PublicSchoolPortal } from './school-record/PublicSchoolPortal';
import { AdminDashboard } from './school-record/AdminDashboard';
import { AdminFirebaseModal } from './school-record/AdminFirebaseModal';
import { CounselorWorkspace } from './school-record/CounselorWorkspace';
import { StudentRecordPortal } from './school-record/StudentRecordPortal';
import { AdminGate } from './AdminGate';

interface SchoolGradesTabProps {
  grades: SchoolGrade[];
  books: Book[];
  onAddGrade: (
    grade: Omit<SchoolGrade, 'id' | 'userId' | 'percentage' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
  onUpdateGrade: (
    gradeId: string,
    updates: Omit<SchoolGrade, 'id' | 'userId' | 'percentage' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
  onDeleteGrade: (gradeId: string) => Promise<void>;
  onBuildRemedialPlan: (weakSubjects: string[]) => void;
  onPracticeWeakArea: (subject: string, bookId?: string) => void;
}

const EXAM_TYPE_OPTIONS: { id: SchoolExamType; label: string; order: number }[] = [
  { id: 'daily', label: 'امتحان يومي', order: 1 },
  { id: 'month1', label: 'الشهر الأول', order: 2 },
  { id: 'month2', label: 'الشهر الثاني', order: 3 },
  { id: 'midyear', label: 'نصف السنة', order: 4 },
  { id: 'final', label: 'النهائي / آخر السنة', order: 5 },
  { id: 'other', label: 'تقييم آخر', order: 6 },
];

const EXAM_ORDER_MAP: Record<SchoolExamType, number> = {
  daily: 1,
  month1: 2,
  month2: 3,
  midyear: 4,
  final: 5,
  other: 6,
};

const EXAM_LABEL_MAP: Record<SchoolExamType, string> = {
  daily: 'امتحان يومي',
  month1: 'الشهر الأول',
  month2: 'الشهر الثاني',
  midyear: 'نصف السنة',
  final: 'النهائي',
  other: 'تقييم آخر',
};

const COMMON_SUBJECTS = [
  'الأحياء',
  'الفيزياء',
  'الكيمياء',
  'الرياضيات',
  'اللغة العربية',
  'اللغة الإنجليزية',
  'التاريخ',
  'الجغرافية',
];

function parseGradeNumber(input: string): number {
  const normalized = input.trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0))
    .replace('٫', '.');
  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized) ? Number(normalized) : NaN;
}

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function getPerformanceMeta(pct: number): { label: string; colorClass: string } {
  if (pct >= 85) {
    return {
      label: 'ممتاز',
      colorClass: 'text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-900',
    };
  }
  if (pct >= 70) {
    return {
      label: 'جيد',
      colorClass: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900',
    };
  }
  return {
    label: 'يحتاج تحسين وتقوية',
    colorClass: 'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900',
  };
}

export const SchoolGradesTab: React.FC<SchoolGradesTabProps> = ({
  grades,
  books,
  onAddGrade,
  onUpdateGrade,
  onDeleteGrade,
  onBuildRemedialPlan,
  onPracticeWeakArea,
}) => {
  const [portalMode, setPortalMode] = useState<'smart_school' | 'personal'>('smart_school');
  const [publicData, setPublicData] = useState<SchoolPublicPayload | null>(null);
  const [workspace, setWorkspace] = useState<SchoolWorkspacePayload | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(true);
  const [portalError, setPortalError] = useState('');
  const [adminEnteredSectionId, setAdminEnteredSectionId] = useState<string | null>(null);
  const [showFirebaseModal, setShowFirebaseModal] = useState(false);
  const [showAdminGoogleGate, setShowAdminGoogleGate] = useState(false);
  const [pendingAdminCode, setPendingAdminCode] = useState('');

  const loadPublic = async () => {
    try {
      const data = await fetchSchoolPublic();
      setPublicData(data);
      setPortalError('');
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'تعذر تحميل الصفحة العامة للمدرسة.');
    }
  };

  const loadWorkspace = async () => {
    const ws = await fetchSchoolWorkspace();
    setWorkspace(ws);
    setPortalError('');
  };

  React.useEffect(() => {
    let mounted = true;
    setSchoolUnauthorizedHandler(() => {
      if (!mounted) return;
      setWorkspace(null);
      setAdminEnteredSectionId(null);
      setPortalError('تم إنهاء الجلسة أو تغيير الكود. يرجى تسجيل الدخول بالكود مجدداً.');
      void loadPublic();
    });

    (async () => {
      setLoadingPortal(true);
      await loadPublic();
      if (getSchoolSessionToken()) {
        try {
          await loadWorkspace();
        } catch {
          clearSchoolSessionToken();
          setWorkspace(null);
        }
      }
      if (mounted) setLoadingPortal(false);
    })();

    return () => {
      mounted = false;
      setSchoolUnauthorizedHandler(null);
    };
  }, []);

  const handleLoginSuccess = async (_session: SchoolSessionUser) => {
    setLoadingPortal(true);
    setPortalError('');
    try {
      await loadWorkspace();
      setAdminEnteredSectionId(null);
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'تعذر فتح سجل الطالب الذكي.');
    } finally {
      setLoadingPortal(false);
    }
  };

  const handleSchoolLogout = async () => {
    await logoutSchoolSession();
    setWorkspace(null);
    setAdminEnteredSectionId(null);
    setShowFirebaseModal(false);
    await loadPublic();
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [examType, setExamType] = useState<SchoolExamType>('month1');
  const [customExamLabel, setCustomExamLabel] = useState('');
  const [score, setScore] = useState<string>('');
  const [maxScore, setMaxScore] = useState<string>('100');
  const [chapterOrTopic, setChapterOrTopic] = useState('');
  const [bookId, setBookId] = useState('');
  const [examDate, setExamDate] = useState(getTodayIso());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const subjectSuggestions = useMemo(() => {
    const set = new Set<string>(COMMON_SUBJECTS);
    books.forEach((b) => {
      if (b.subject?.trim()) set.add(b.subject.trim());
    });
    grades.forEach((g) => {
      if (g.subject?.trim()) set.add(g.subject.trim());
    });
    return Array.from(set);
  }, [books, grades]);

  const groupedBySubject = useMemo(() => {
    const map = new Map<string, SchoolGrade[]>();
    for (const g of grades) {
      const key = g.subject.trim() || 'مادة عامة';
      const arr = map.get(key) || [];
      arr.push(g);
      map.set(key, arr);
    }

    const groups = Array.from(map.entries()).map(([subj, items]) => {
      const sorted = [...items].sort((a, b) => {
        const orderDiff = (EXAM_ORDER_MAP[a.examType] || 6) - (EXAM_ORDER_MAP[b.examType] || 6);
        if (orderDiff !== 0) return orderDiff;
        return (a.examDate || '').localeCompare(b.examDate || '');
      });
      const avg =
        sorted.length > 0
          ? Math.round((sorted.reduce((sum, item) => sum + item.percentage, 0) / sorted.length) * 10) / 10
          : 0;
      const weakChapters = Array.from(
        new Set(
          sorted
            .filter((item) => item.percentage < 70 && item.chapterOrTopic?.trim())
            .map((item) => item.chapterOrTopic!.trim())
        )
      );
      const linkedBookId = sorted.find((i) => i.bookId)?.bookId;
      return {
        subject: subj,
        grades: sorted,
        average: avg,
        weakChapters,
        linkedBookId,
      };
    });

    // Put weaker subjects first so student immediately sees what needs improvement
    return groups.sort((a, b) => a.average - b.average);
  }, [grades]);

  const overallSummary = useMemo(() => {
    if (grades.length === 0) {
      return {
        overallAverage: null as number | null,
        weakSubjects: [] as string[],
        weakChaptersList: [] as { subject: string; chapter: string; percentage: number }[],
      };
    }
    const overallAverage =
      Math.round((grades.reduce((acc, g) => acc + g.percentage, 0) / grades.length) * 10) / 10;
    const weakSubjects = groupedBySubject.filter((g) => g.average < 70).map((g) => g.subject);
    const weakChaptersList = grades
      .filter((g) => g.percentage < 70)
      .map((g) => ({
        subject: g.subject,
        chapter: g.chapterOrTopic?.trim() || g.examLabel,
        percentage: g.percentage,
      }));
    return { overallAverage, weakSubjects, weakChaptersList };
  }, [grades, groupedBySubject]);

  const resetForm = () => {
    setEditingId(null);
    setSubject('');
    setExamType('month1');
    setCustomExamLabel('');
    setScore('');
    setMaxScore('100');
    setChapterOrTopic('');
    setBookId('');
    setExamDate(getTodayIso());
    setNotes('');
    setFormError('');
  };

  const handleEditClick = (g: SchoolGrade) => {
    setEditingId(g.id);
    setSubject(g.subject);
    setExamType(g.examType);
    setCustomExamLabel(g.examLabel !== EXAM_LABEL_MAP[g.examType] ? g.examLabel : '');
    setScore(String(g.score));
    setMaxScore(String(g.maxScore));
    setChapterOrTopic(g.chapterOrTopic || '');
    setBookId(g.bookId || '');
    setExamDate(g.examDate || getTodayIso());
    setNotes(g.notes || '');
    setFormError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const cleanSubject = subject.trim();
    const numScore = parseGradeNumber(score);
    const numMax = parseGradeNumber(maxScore);

    if (!cleanSubject) {
      setFormError('يرجى كتابة اسم المادة الدراسية (مثل: الأحياء أو الفيزياء).');
      return;
    }
    if (!Number.isFinite(numMax) || numMax <= 0) {
      setFormError('يجب أن تكون الدرجة العظمى أكبر من صفر.');
      return;
    }
    if (!Number.isFinite(numScore) || numScore < 0 || numScore > numMax) {
      setFormError(`يجب أن تكون الدرجة بين 0 و ${numMax}.`);
      return;
    }

    const payload = {
      subject: cleanSubject,
      examType,
      examLabel: customExamLabel.trim() || EXAM_LABEL_MAP[examType],
      score: numScore,
      maxScore: numMax,
      chapterOrTopic: chapterOrTopic.trim(),
      bookId: bookId || undefined,
      examDate: examDate || getTodayIso(),
      notes: notes.trim(),
    };

    setSaving(true);
    try {
      if (editingId) {
        await onUpdateGrade(editingId, payload);
      } else {
        await onAddGrade(payload);
      }
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'تعذر حفظ الدرجة، حاول مجدداً.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Mode Switcher: Smart School Record vs Preserved Personal Grade Tracker */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-2 flex flex-wrap items-center gap-2 shadow-xs">
        <button
          type="button"
          onClick={() => setPortalMode('smart_school')}
          className={`flex-1 min-w-[200px] min-h-[44px] px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors ${
            portalMode === 'smart_school'
              ? 'bg-[#653CF5] text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-[#F7F7FC] dark:hover:bg-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>سجل الطالب الذكي (المدرسة والصف)</span>
        </button>

        <button
          type="button"
          onClick={() => setPortalMode('personal')}
          className={`flex-1 min-w-[200px] min-h-[44px] px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors ${
            portalMode === 'personal'
              ? 'bg-[#653CF5] text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-[#F7F7FC] dark:hover:bg-slate-800'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>سجلي الشخصي (درجاتي الخاصة · {grades.length})</span>
        </button>
      </div>

      {portalMode === 'smart_school' ? (
        <div className="space-y-5">
          {portalError && (
            <div role="alert" className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs sm:text-sm text-red-700 dark:text-red-300 font-medium">
              {portalError}
            </div>
          )}

          {showAdminGoogleGate ? (
            <AdminGate
              initialAdminCode={pendingAdminCode}
              onBack={() => {
                setShowAdminGoogleGate(false);
                setPendingAdminCode('');
                if (getSchoolSessionToken()) {
                  void loadWorkspace().catch(() => {
                    clearSchoolSessionToken();
                    void loadPublic();
                  });
                } else {
                  void loadPublic();
                }
              }}
            />
          ) : loadingPortal ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center space-y-2">
              <Loader2 className="w-7 h-7 animate-spin text-[#653CF5] mx-auto" />
              <p className="text-xs sm:text-sm text-slate-500">جاري تحميل بوابة سجل الطالب الذكي...</p>
            </div>
          ) : !workspace ? (
            publicData ? (
              <PublicSchoolPortal
                publicData={publicData}
                onLoginSuccess={handleLoginSuccess}
                onAdminGoogleLogin={(adminCode) => {
                  setPendingAdminCode(adminCode || '');
                  setShowAdminGoogleGate(true);
                }}
              />
            ) : null
          ) : workspace.session.role === 'admin' ? (
            <>
              {adminEnteredSectionId ? (
                <CounselorWorkspace
                  workspace={workspace}
                  sectionId={adminEnteredSectionId}
                  onWorkspaceRefresh={loadWorkspace}
                  onBackToAdmin={() => setAdminEnteredSectionId(null)}
                  onLogout={handleSchoolLogout}
                />
              ) : (
                <AdminDashboard
                  workspace={workspace}
                  onWorkspaceRefresh={loadWorkspace}
                  onEnterSection={(secId) => setAdminEnteredSectionId(secId)}
                  onOpenFirebaseModal={() => setShowFirebaseModal(true)}
                  onLogout={handleSchoolLogout}
                />
              )}

              {showFirebaseModal && (
                <AdminFirebaseModal
                  workspace={workspace}
                  onClose={() => setShowFirebaseModal(false)}
                  onSyncMetaUpdated={(meta) => {
                    setWorkspace((prev) => (prev ? { ...prev, firebaseSync: meta } : prev));
                    void loadPublic();
                  }}
                  onWorkspaceRestored={loadWorkspace}
                />
              )}
            </>
          ) : workspace.session.role === 'counselor' ? (
            <CounselorWorkspace
              workspace={workspace}
              sectionId={workspace.session.sectionId || workspace.sections[0]?.id || ''}
              onWorkspaceRefresh={loadWorkspace}
              onLogout={handleSchoolLogout}
            />
          ) : (
            <StudentRecordPortal
              workspace={workspace}
              books={books}
              onWorkspaceRefresh={loadWorkspace}
              onBuildRemedialPlan={onBuildRemedialPlan}
              onPracticeWeakArea={onPracticeWeakArea}
              onLogout={handleSchoolLogout}
            />
          )}
        </div>
      ) : (
        <>
      {/* Top Diagnosis & Improvement Overview */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 flex items-center justify-center shrink-0">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-display font-bold text-lg text-slate-900 dark:text-white">
                سجل درجات الصف الحقيقية بالمدرسة
              </h2>
            </div>
          </div>

          {overallSummary.overallAverage !== null && (
            <div className="flex items-center gap-4 shrink-0 bg-slate-50 dark:bg-slate-800/70 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
              <div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">المعدل العام</span>
                <span className="font-mono-num text-xl font-extrabold text-blue-700 dark:text-blue-400">
                  {overallSummary.overallAverage}%
                </span>
              </div>
              <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />
              <div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">الدرجات المسجلة</span>
                <span className="font-mono-num text-xl font-extrabold text-slate-900 dark:text-white">
                  {grades.length}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Weaknesses Diagnosis Bar */}
        {grades.length > 0 && (
          <div
            className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
              overallSummary.weakSubjects.length > 0 || overallSummary.weakChaptersList.length > 0
                ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900'
                : 'bg-teal-50/70 dark:bg-teal-950/30 border-teal-200 dark:border-teal-900'
            }`}
          >
            <div className="flex items-start gap-2.5 text-xs sm:text-sm">
              {overallSummary.weakSubjects.length > 0 || overallSummary.weakChaptersList.length > 0 ? (
                <>
                  <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-amber-900 dark:text-amber-200">
                      تشخيص نقاط الضعف التي تحتاج إلى تحسين وتقوية:
                    </p>
                    {overallSummary.weakSubjects.length > 0 && (
                      <p className="text-amber-800 dark:text-amber-300">
                        المواد الأقل من 70%: <strong>{overallSummary.weakSubjects.join('، ')}</strong>
                      </p>
                    )}
                    {overallSummary.weakChaptersList.length > 0 && (
                      <p className="text-amber-800 dark:text-amber-300">
                        تقييمات منخفضة:{' '}
                        {overallSummary.weakChaptersList
                          .slice(0, 4)
                          .map((w) => `${w.subject} (${w.chapter}: ${w.percentage}%)`)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <TrendingUp className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5" />
                  <p className="font-semibold text-teal-900 dark:text-teal-200">
                    مستواك العلمي مستقر وجيد جداً في جميع المواد المسجلة! واصل المراجعة والاختبارات للحفاظ على التفوق.
                  </p>
                </>
              )}
            </div>

            {overallSummary.weakSubjects.length > 0 && (
              <button
                type="button"
                onClick={() => onBuildRemedialPlan(overallSummary.weakSubjects)}
                className="min-h-[42px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs sm:text-sm font-semibold flex items-center gap-2 shrink-0 cursor-pointer"
              >
                <CalendarCheck className="w-4 h-4" />
                <span>إنشاء خطة تقوية لهذه المواد</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Add / Edit Grade Form */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold text-base text-slate-900 dark:text-white">
              {editingId ? 'تعديل الدرجة' : 'إضافة درجة مدرسية جديدة'}
            </h3>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                إلغاء التعديل
              </button>
            )}
          </div>

          {formError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
            >
              {formError}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              المادة الدراسية
            </label>
            <input
              type="text"
              list="school-subjects-list"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="مثال: الأحياء، الفيزياء، الرياضيات..."
              required
              className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <datalist id="school-subjects-list">
              {subjectSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {subjectSuggestions.slice(0, 6).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSubject(s)}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-[11px] font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                نوع الامتحان
              </label>
              <select
                value={examType}
                onChange={(e) => setExamType(e.target.value as SchoolExamType)}
                className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
              >
                {EXAM_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                تاريخ الامتحان
              </label>
              <input
                type="date"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
              />
            </div>
          </div>

          {examType === 'other' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                تسمية التقييم
              </label>
              <input
                type="text"
                value={customExamLabel}
                onChange={(e) => setCustomExamLabel(e.target.value)}
                placeholder="مثال: اختبار مختبر أو كويز مفاجئ"
                className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                درجتك
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                placeholder="مثال: 14 أو 72"
                required
                className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono-num"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                الدرجة من كم؟
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={maxScore}
                onChange={(e) => setMaxScore(e.target.value)}
                placeholder="100 أو 20"
                required
                className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono-num"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              الفصل أو الموضوع (اختياري — مهم لتحديد نقطة الضعف بدقة)
            </label>
            <input
              type="text"
              value={chapterOrTopic}
              onChange={(e) => setChapterOrTopic(e.target.value)}
              placeholder="مثال: الفصل الثاني - الانقسام الخلوي"
              className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
            />
          </div>

          {books.length > 0 && (
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                ربط بكتاب من مكتبتك (اختياري)
              </label>
              <select
                value={bookId}
                onChange={(e) => {
                  const chosenId = e.target.value;
                  setBookId(chosenId);
                  if (!subject.trim()) {
                    const matched = books.find((b) => b.id === chosenId);
                    if (matched) setSubject(matched.subject || matched.title);
                  }
                }}
                className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
              >
                <option value="">بدون ربط بكتاب محدد</option>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              ملاحظات عن الامتحان (اختياري)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: أخطأت في مسائل القوانين أو تعليل الرسم"
              className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full min-h-[48px] rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {editingId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            <span>{saving ? 'جاري الحفظ...' : editingId ? 'حفظ التعديل' : 'إضافة الدرجة إلى السجل'}</span>
          </button>
        </form>

        {/* Automatically Grouped & Sorted Grades List */}
        <div className="lg:col-span-7 space-y-4">
          {groupedBySubject.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
              <GraduationCap className="w-10 h-10 mx-auto text-slate-400" />
              <h3 className="font-display font-bold text-base text-slate-900 dark:text-white">
                لا توجد درجات مسجلة بعد
              </h3>
            </div>
          ) : (
            groupedBySubject.map((group) => {
              const meta = getPerformanceMeta(group.average);
              return (
                <div
                  key={group.subject}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
                >
                  <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display font-bold text-lg text-slate-900 dark:text-white">
                          {group.subject}
                        </h3>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${meta.colorClass}`}>
                          {meta.label} · {group.average}%
                        </span>
                      </div>
                      {group.weakChapters.length > 0 && (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          فصول تحتاج مراجعة: {group.weakChapters.join('، ')}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onPracticeWeakArea(group.subject, group.linkedBookId)}
                      className="min-h-[38px] px-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-blue-700 dark:text-blue-400 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileCheck2 className="w-4 h-4" />
                      <span>اختبر نفسك في {group.subject}</span>
                    </button>
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {group.grades.map((g) => {
                      const gMeta = getPerformanceMeta(g.percentage);
                      const isConfirmDel = confirmDeleteId === g.id;
                      return (
                        <div key={g.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="font-bold text-slate-900 dark:text-white">
                                {g.examLabel}
                              </span>
                              <span className="font-mono-num font-bold text-blue-700 dark:text-blue-400">
                                {g.score} / {g.maxScore} ({g.percentage}%)
                              </span>
                              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${gMeta.colorClass}`}>
                                {gMeta.label}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2">
                              {g.chapterOrTopic && <span>الموضوع: {g.chapterOrTopic}</span>}
                              {g.chapterOrTopic && <span>·</span>}
                              <span className="font-mono-num">{g.examDate}</span>
                            </p>
                            {g.notes && (
                              <p className="text-xs text-slate-600 dark:text-slate-300 pt-0.5">{g.notes}</p>
                            )}
                          </div>

                          {isConfirmDel ? (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={async () => {
                                  await onDeleteGrade(g.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="min-h-[36px] px-3 rounded-lg bg-red-600 text-white text-xs font-semibold cursor-pointer"
                              >
                                تأكيد الحذف
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleEditClick(g)}
                                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-blue-700 cursor-pointer"
                                aria-label="تعديل الدرجة"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(g.id)}
                                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600 cursor-pointer"
                                aria-label="حذف الدرجة"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
};
