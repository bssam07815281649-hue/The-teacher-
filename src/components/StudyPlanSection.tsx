import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  Circle,
  BookOpen,
  RefreshCw,
  Plus,
  Trash2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import type { Book, StudyPlan, StudyTask } from '../types';

interface StudyPlanSectionProps {
  books: Book[];
  plans: StudyPlan[];
  activePlan: StudyPlan | null;
  tasks: StudyTask[];
  weakTopics: string[];
  weakSubjectsFromGrades?: string[];
  remedialSubjectsTrigger?: string[] | null;
  onClearRemedialTrigger?: () => void;
  onSelectPlan: (plan: StudyPlan) => void;
  onCreatePlan: (input: {
    bookIds: string[];
    startDate: string;
    examDate: string;
    dailyHours: number;
    availableDays: string[];
    hardSubjects: string[];
    studyMode: 'new' | 'review' | 'both';
  }) => Promise<void>;
  onCompleteTask: (task: StudyTask, actualMinutes: number) => Promise<void>;
  onReschedulePlan: () => Promise<void>;
  onDeletePlan: (planId: string) => Promise<void>;
  onOpenTaskInBook: (bookId: string, pageNumber: number) => void;
}

const WEEK_DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDefaultExamIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

export const StudyPlanSection: React.FC<StudyPlanSectionProps> = ({
  books,
  plans,
  activePlan,
  tasks,
  weakTopics,
  weakSubjectsFromGrades = [],
  remedialSubjectsTrigger,
  onClearRemedialTrigger,
  onSelectPlan,
  onCreatePlan,
  onCompleteTask,
  onReschedulePlan,
  onDeletePlan,
  onOpenTaskInBook,
}) => {
  const [showBuilder, setShowBuilder] = useState(plans.length === 0 || Boolean(remedialSubjectsTrigger?.length));
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>(() =>
    books.slice(0, 2).map((b) => b.id)
  );
  const [startDate, setStartDate] = useState(getTodayIso());
  const [examDate, setExamDate] = useState(getDefaultExamIso());
  const [dailyHours, setDailyHours] = useState(3);
  const [availableDays, setAvailableDays] = useState<string[]>(WEEK_DAYS);
  const [hardSubjects, setHardSubjects] = useState<string[]>(() =>
    Array.from(new Set([...(remedialSubjectsTrigger || []), ...weakSubjectsFromGrades]))
  );
  const [studyMode, setStudyMode] = useState<'new' | 'review' | 'both'>('both');
  const [creating, setCreating] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [error, setError] = useState('');
  const [actualMinsMap, setActualMinsMap] = useState<Record<string, number>>({});

  React.useEffect(() => {
    if (remedialSubjectsTrigger && remedialSubjectsTrigger.length > 0) {
      setShowBuilder(true);
      setHardSubjects((prev) => Array.from(new Set([...prev, ...remedialSubjectsTrigger])));
      setStudyMode('both');
      const matchingBookIds = books
        .filter((b) =>
          remedialSubjectsTrigger.some(
            (s) =>
              (b.subject || '').toLowerCase().includes(s.toLowerCase()) ||
              b.title.toLowerCase().includes(s.toLowerCase())
          )
        )
        .map((b) => b.id);
      if (matchingBookIds.length > 0) {
        setSelectedBookIds(matchingBookIds);
      }
      onClearRemedialTrigger?.();
    }
  }, [remedialSubjectsTrigger, books, onClearRemedialTrigger]);

  const todayStr = getTodayIso();

  const subjectOptions = useMemo(() => {
    const set = new Set<string>();
    books.forEach((b) => {
      if (b.subject) set.add(b.subject);
      else set.add(b.title);
    });
    weakSubjectsFromGrades.forEach((s) => set.add(s));
    return Array.from(set);
  }, [books, weakSubjectsFromGrades]);

  const todayTasks = useMemo(
    () => tasks.filter((t) => t.date <= todayStr && t.status !== 'completed'),
    [tasks, todayStr]
  );

  const upcomingTasks = useMemo(
    () => tasks.filter((t) => t.date > todayStr || t.status === 'completed'),
    [tasks, todayStr]
  );

  const progressPct = useMemo(() => {
    if (tasks.length === 0) return 0;
    const done = tasks.filter((t) => t.status === 'completed').length;
    return Math.round((done / tasks.length) * 100);
  }, [tasks]);

  const handleToggleBook = (id: string) => {
    setSelectedBookIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleDay = (day: string) => {
    setAvailableDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (selectedBookIds.length === 0) {
      setError('يرجى اختيار كتاب واحد على الأقل لإنشاء الخطة.');
      return;
    }
    if (availableDays.length === 0) {
      setError('يرجى تحديد يوم واحد على الأقل متاح للدراسة.');
      return;
    }
    setCreating(true);
    try {
      await onCreatePlan({
        bookIds: selectedBookIds,
        startDate,
        examDate,
        dailyHours,
        availableDays,
        hardSubjects,
        studyMode,
      });
      setShowBuilder(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الخطة الدراسية.');
    } finally {
      setCreating(false);
    }
  };

  const handleReschedule = async () => {
    setRescheduling(true);
    setError('');
    try {
      await onReschedulePlan();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إعادة الجدولة حالياً.');
    } finally {
      setRescheduling(false);
    }
  };

  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            خطتي الدراسية
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {plans.length > 0 && (
            <button
              type="button"
              onClick={() => setShowBuilder((v) => !v)}
              className="min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{showBuilder ? 'عرض الخطة الحالية' : 'خطة جديدة'}</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {/* Plan Builder Form */}
      {showBuilder ? (
        <form
          onSubmit={handleCreateSubmit}
          className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-5"
        >
          <h2 className="font-display font-bold text-lg text-slate-900 dark:text-white">
            إعداد خطة دراسية شخصية
          </h2>

          {books.length === 0 ? (
            <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 p-4 rounded-xl">
              لا توجد كتب.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                  1. الكتب المطلوب دراستها
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {books.map((book) => {
                    const checked = selectedBookIds.includes(book.id);
                    return (
                      <label
                        key={book.id}
                        className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-colors ${
                          checked
                            ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-400 dark:border-blue-700'
                            : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleBook(book.id)}
                          className="w-4 h-4 accent-blue-700"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {book.title}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {book.subject || 'مادة عامة'} · {book.totalPages} صفحة
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    تاريخ البدء
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                    className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    موعد الامتحان أو الانتهاء
                  </label>
                  <input
                    type="date"
                    value={examDate}
                    onChange={(e) => setExamDate(e.target.value)}
                    required
                    className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    الساعات المتاحة يومياً ({dailyHours} ساعة)
                  </label>
                  <input
                    type="number"
                    min={0.5}
                    max={14}
                    step={0.5}
                    value={dailyHours}
                    onChange={(e) => setDailyHours(Number(e.target.value))}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono-num"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                  الأيام المتاحة للدراسة
                </span>
                <div className="flex flex-wrap gap-2">
                  {WEEK_DAYS.map((day) => {
                    const active = availableDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => handleToggleDay(day)}
                        className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold border cursor-pointer ${
                          active
                            ? 'bg-blue-700 text-white border-blue-700'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>

              {subjectOptions.length > 0 && (
                <div className="space-y-2">
                  <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                    المواد التي تراها أصعب (لتخصيص وقت إضافي لها)
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {subjectOptions.map((subj) => {
                      const active = hardSubjects.includes(subj);
                      return (
                        <button
                          key={subj}
                          type="button"
                          onClick={() =>
                            setHardSubjects((prev) =>
                              prev.includes(subj) ? prev.filter((s) => s !== subj) : [...prev, subj]
                            )
                          }
                          className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold border cursor-pointer ${
                            active
                              ? 'bg-amber-600 text-white border-amber-600'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {subj}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                  نوع الدراسة المطلوبة
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'new', label: 'دراسة جديدة' },
                      { id: 'review', label: 'مراجعة فقط' },
                      { id: 'both', label: 'دراسة ومراجعة' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setStudyMode(m.id)}
                      className={`min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold border cursor-pointer ${
                        studyMode === m.id
                          ? 'bg-blue-700 text-white border-blue-700'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {(weakTopics.length > 0 || weakSubjectsFromGrades.length > 0) && (
                <div className="text-xs text-teal-900 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/40 p-3.5 rounded-xl space-y-1">
                  {weakSubjectsFromGrades.length > 0 && (
                    <p>
                      <strong>من سجل درجات الصف:</strong> سيخصص المعلم حصص تقوية إضافية للمواد الأضعف ({weakSubjectsFromGrades.join('، ')}) لرفع مستواك العلمي.
                    </p>
                  )}
                  {weakTopics.length > 0 && (
                    <p>
                      <strong>من اختباراتك السابقة:</strong> مراجعة الموضوعات: {weakTopics.join('، ')}
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                {plans.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowBuilder(false)}
                    className="min-h-[46px] px-5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold cursor-pointer"
                  >
                    إلغاء
                  </button>
                )}
                <button
                  type="submit"
                  disabled={creating}
                  className="min-h-[46px] px-6 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{creating ? 'جاري بناء الخطة بالذكاء الاصطناعي...' : 'إنشاء الخطة الذكية'}</span>
                </button>
              </div>
            </>
          )}
        </form>
      ) : activePlan ? (
        <div className="space-y-6">
          {/* Plan Selector & Summary Card */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                {plans.length > 1 ? (
                  <select
                    value={activePlan.id}
                    onChange={(e) => {
                      const found = plans.find((p) => p.id === e.target.value);
                      if (found) onSelectPlan(found);
                    }}
                    className="font-display font-bold text-lg text-slate-900 dark:text-white bg-transparent border-b border-dashed border-slate-300 dark:border-slate-700 cursor-pointer"
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id} className="bg-white dark:bg-slate-900">
                        {p.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <h2 className="font-display font-bold text-lg text-slate-900 dark:text-white">
                    {activePlan.title}
                  </h2>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                  من {activePlan.startDate} إلى {activePlan.examDate} · {activePlan.dailyHours} ساعة يومياً
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={rescheduling}
                  onClick={() => void handleReschedule()}
                  className="min-h-[42px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs sm:text-sm font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${rescheduling ? 'animate-spin' : ''}`} />
                  <span>{rescheduling ? 'جاري التكييف...' : 'إعادة جدولة وتكييف الخطة'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void onDeletePlan(activePlan.id)}
                  className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600 cursor-pointer"
                  aria-label="حذف الخطة"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-slate-600 dark:text-slate-400">نسبة إنجاز الخطة</span>
                <span className="font-mono-num text-teal-700 dark:text-teal-400">
                  {progressPct}% ({tasks.filter((t) => t.status === 'completed').length}/{tasks.length} مهمة)
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div className="h-full bg-teal-600 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            {activePlan.adviceMessage && (
              <div className="p-3.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 flex items-start gap-2.5 text-xs sm:text-sm text-blue-900 dark:text-blue-200">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-blue-700 dark:text-blue-400" />
                <p className="leading-relaxed">{activePlan.adviceMessage}</p>
              </div>
            )}
          </div>

          {/* Today's Tasks */}
          <div className="space-y-3">
            <h3 className="font-display font-bold text-lg text-slate-900 dark:text-white">
              مهام اليوم ({todayTasks.length})
            </h3>
            {todayTasks.length === 0 ? (
              <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center text-sm text-slate-500">
                أتممت جميع مهام اليوم أو لا توجد مهام متأخرة حتى تاريخ {todayStr}.
              </div>
            ) : (
              <div className="space-y-3">
                {todayTasks.map((task) => {
                  const actualVal = actualMinsMap[task.id] ?? task.estimatedMinutes;
                  return (
                    <div
                      key={task.id}
                      className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>{task.date}</span>
                          <span>·</span>
                          <span>{task.subject || task.bookTitle}</span>
                          <span>·</span>
                          <Clock className="w-3.5 h-3.5" />
                          <span>{task.estimatedMinutes} دقيقة</span>
                        </div>
                        <h4 className="font-semibold text-base text-slate-900 dark:text-white">
                          {task.bookTitle} — {task.chapterTitle || 'دراسة'}
                        </h4>
                        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                          الصفحات المطلوبة: من ص {task.startPage} إلى ص {task.endPage}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onOpenTaskInBook(task.bookId, task.startPage)}
                          className="min-h-[42px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <BookOpen className="w-4 h-4" />
                          <span>ابدأ الدراسة</span>
                        </button>

                        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-2 py-1">
                          <input
                            type="number"
                            min={5}
                            max={600}
                            value={actualVal}
                            onChange={(e) =>
                              setActualMinsMap((prev) => ({
                                ...prev,
                                [task.id]: Number(e.target.value),
                              }))
                            }
                            aria-label="الوقت الفعلي بالدقائق"
                            className="w-12 text-xs font-mono-num text-center bg-transparent focus:outline-none"
                          />
                          <span className="text-[11px] text-slate-500">د</span>
                          <button
                            type="button"
                            onClick={() => void onCompleteTask(task, actualVal)}
                            className="min-h-[34px] px-2.5 rounded-lg bg-teal-700 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>إتمام</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Upcoming & Completed Tasks */}
          <div className="space-y-3">
            <h3 className="font-display font-bold text-lg text-slate-900 dark:text-white">
              المهام القادمة والمنجزة
            </h3>
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
              {upcomingTasks.map((task) => {
                const done = task.status === 'completed';
                return (
                  <div
                    key={task.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      {done ? (
                        <CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
                      ) : (
                        <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <p
                          className={`text-sm font-semibold ${
                            done
                              ? 'line-through text-slate-400 dark:text-slate-500'
                              : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {task.bookTitle} — {task.chapterTitle || 'دراسة'} (ص {task.startPage}–{task.endPage})
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                          {task.date} · {task.estimatedMinutes} دقيقة مقدرة
                          {done && task.actualMinutes ? ` · أُنجز في ${task.actualMinutes} دقيقة` : ''}
                        </p>
                      </div>
                    </div>

                    {!done && (
                      <button
                        type="button"
                        onClick={() => onOpenTaskInBook(task.bookId, task.startPage)}
                        className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:border-blue-500 cursor-pointer shrink-0"
                      >
                        فتح الصفحات
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
