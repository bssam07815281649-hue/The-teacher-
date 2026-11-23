import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CalendarCheck,
  CalendarX2,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  GraduationCap,
  LogOut,
  RefreshCw,
  TrendingUp,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { Book, SchoolWorkspacePayload, StudentAbsence, SubjectGradebook } from '../../types';
import {
  computeStudentSubjectSummary,
  formatCellDisplay,
  getCellValue,
  getTermColumns,
} from '../../utils/gradeCalculations';

interface StudentRecordPortalProps {
  workspace: SchoolWorkspacePayload;
  books: Book[];
  onWorkspaceRefresh: () => Promise<void>;
  onBuildRemedialPlan: (weakSubjects: string[]) => void;
  onPracticeWeakArea: (subject: string, bookId?: string) => void;
  onLogout: () => Promise<void>;
}

const EXCUSE_LABELS: Record<StudentAbsence['excuseType'], string> = {
  unexcused: 'بدون عذر',
  excused: 'بعذر مقبول',
  medical: 'إجازة مرضية',
  official: 'مهمة رسمية',
};

export const StudentRecordPortal: React.FC<StudentRecordPortalProps> = ({
  workspace,
  books,
  onWorkspaceRefresh,
  onBuildRemedialPlan,
  onPracticeWeakArea,
  onLogout,
}) => {
  const [expandedSubjectId, setExpandedSubjectId] = useState<string | null>(
    workspace.subjects[0]?.id || null
  );

  const student = workspace.students[0];
  const section = workspace.sections[0];
  const stage = workspace.stages[0];

  const subjectSummaries = useMemo(() => {
    if (!student) return [];
    return workspace.subjects.map((sub) => ({
      subject: sub,
      summary: computeStudentSubjectSummary(sub, student.id),
    }));
  }, [workspace.subjects, student]);

  const weakSubjectNames = useMemo(
    () =>
      subjectSummaries
        .filter((s) => s.summary.percentageEquivalent !== null && s.summary.percentageEquivalent < 70)
        .map((s) => s.subject.name),
    [subjectSummaries]
  );

  const findLinkedBookId = (subjectName: string): string | undefined => {
    const clean = subjectName.trim().toLowerCase();
    const match = books.find(
      (b) =>
        b.subject?.trim().toLowerCase() === clean ||
        b.title.trim().toLowerCase().includes(clean) ||
        clean.includes(b.subject?.trim().toLowerCase() || '___')
    );
    return match?.id;
  };

  const renderSubjectPeriodBlock = (
    sub: SubjectGradebook,
    title: string,
    cols: ReturnType<typeof getTermColumns>
  ) => {
    if (!student || cols.length === 0) return null;
    return (
      <div className="space-y-1.5">
        <h5 className="text-xs font-bold text-[#4320D9] dark:text-violet-300">{title}</h5>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {cols.map((col) => {
            const cell = getCellValue(sub, student.id, col.id);
            const disp = formatCellDisplay(cell);
            return (
              <div
                key={col.id}
                className="p-2.5 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-center space-y-0.5"
              >
                <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate">
                  {col.label}
                </span>
                <span
                  className={`block font-mono-num text-sm font-extrabold ${
                    cell.status === 'absent'
                      ? 'text-red-600'
                      : cell.status === 'exempt'
                      ? 'text-[#653CF5]'
                      : cell.status === 'blank'
                      ? 'text-slate-400'
                      : 'text-[#171A36] dark:text-white'
                  }`}
                >
                  {disp}
                </span>
                <span className="block text-[10px] text-slate-400 font-mono-num">من {col.maxScore}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (!student) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center">
        <p className="text-sm text-slate-500">تعذر تحميل بيانات الطالب.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Student Header Banner (Read-only) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#EEEAFF] dark:bg-violet-950/60 text-[#653CF5] flex items-center justify-center shrink-0">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display font-extrabold text-lg text-[#171A36] dark:text-white">
                {student.fullName}
              </h2>
              <span className="px-2.5 py-0.5 rounded-lg bg-[#EEEAFF] dark:bg-violet-950/60 text-[#4320D9] dark:text-violet-300 text-xs font-bold">
                {stage?.name || 'الصف'} — شعبة {section?.name || '—'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {workspace.school.name} · السنة الدراسية <span className="font-mono-num">{workspace.school.academicYear}</span> · المرشد: {section?.counselorName || '—'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border ${
              workspace.firebaseSync.linked
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
                : 'bg-[#F7F7FC] dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
            }`}
          >
            {workspace.firebaseSync.linked ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span>{workspace.firebaseSync.linked ? 'سجل متزامن' : 'نسخة المدرسة المحلية'}</span>
          </span>

          <button
            type="button"
            onClick={() => void onWorkspaceRefresh()}
            className="min-h-[40px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 text-[#653CF5]" />
            <span>تحديث</span>
          </button>

          <button
            type="button"
            onClick={() => void onLogout()}
            className="min-h-[40px] px-3.5 rounded-xl border border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>خروج</span>
          </button>
        </div>
      </div>

      {/* Remedial Tutor Action Strip */}
      <div
        className={`p-4 sm:p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
          weakSubjectNames.length > 0
            ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900'
            : 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900'
        }`}
      >
        <div className="flex items-start gap-2.5 text-xs sm:text-sm">
          {weakSubjectNames.length > 0 ? (
            <>
              <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-amber-900 dark:text-amber-200">
                  مواد تحتاج إلى خطة تقوية وتدريب (أقل من 70%):
                </p>
                <p className="text-amber-800 dark:text-amber-300 mt-0.5 font-semibold">
                  {weakSubjectNames.join('، ')}
                </p>
              </div>
            </>
          ) : (
            <>
              <TrendingUp className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
              <p className="font-semibold text-emerald-900 dark:text-emerald-200">
                نتائجك المسجلة مستقرة.
              </p>
            </>
          )}
        </div>

        {weakSubjectNames.length > 0 && (
          <button
            type="button"
            onClick={() => onBuildRemedialPlan(weakSubjectNames)}
            className="min-h-[44px] px-4 rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-xs sm:text-sm font-bold flex items-center gap-2 shrink-0 cursor-pointer"
          >
            <CalendarCheck className="w-4 h-4" />
            <span>إنشاء خطة تقوية للمواد الأضعف</span>
          </button>
        )}
      </div>

      {/* Grades & Annual Pursuit by Subject */}
      <div className="space-y-4">
        <h3 className="font-display font-bold text-base text-[#171A36] dark:text-white flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-[#653CF5]" />
          <span>سجل الدرجات والسعي السنوي ({subjectSummaries.length} مادة)</span>
        </h3>

        {subjectSummaries.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500">
            لم تُنشر دفاتر درجات لشعبتك بعد.
          </div>
        ) : (
          subjectSummaries.map(({ subject: sub, summary }) => {
            const expanded = expandedSubjectId === sub.id;
            const linkedBookId = findLinkedBookId(sub.name);

            return (
              <div
                key={sub.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
              >
                <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-display font-extrabold text-lg text-[#171A36] dark:text-white">
                        {sub.name}
                      </h4>
                      {summary.annualPursuit !== null ? (
                        <span className="px-3 py-1 rounded-xl bg-[#EEEAFF] dark:bg-violet-950/60 text-[#4320D9] dark:text-violet-300 text-xs font-extrabold font-mono-num">
                          السعي السنوي: {summary.annualPursuit}
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs font-semibold">
                          السعي السنوي: بانتظار اكتمال الفترات الثلاث
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="px-2.5 py-1 rounded-lg bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono-num">
                        الفصل الأول: <strong>{summary.term1Avg ?? '-'}</strong>
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono-num">
                        نصف السنة: <strong>{summary.midyearAvg ?? '-'}</strong>
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono-num">
                        الفصل الثاني: <strong>{summary.term2Avg ?? '-'}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onPracticeWeakArea(sub.name, linkedBookId)}
                      className="min-h-[40px] px-3.5 rounded-xl bg-[#EEEAFF] dark:bg-slate-800 text-[#4320D9] dark:text-violet-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileCheck2 className="w-4 h-4" />
                      <span>اختبر نفسك في {sub.name}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedSubjectId(expanded ? null : sub.id)}
                      className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <span>التفاصيل</span>
                      {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="px-4 sm:px-5 pb-5 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-4">
                    {renderSubjectPeriodBlock(sub, 'الفصل الأول', getTermColumns(sub, 'term1'))}
                    {renderSubjectPeriodBlock(sub, 'نصف السنة', getTermColumns(sub, 'midyear'))}
                    {renderSubjectPeriodBlock(sub, 'الفصل الثاني', getTermColumns(sub, 'term2'))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Absences Summary & History */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display font-bold text-base text-[#171A36] dark:text-white flex items-center gap-2">
            <CalendarX2 className="w-5 h-5 text-[#653CF5]" />
            <span>سجل الغيابات والحضور ({workspace.absences.length})</span>
          </h3>
          {workspace.absences.length > 0 && (
            <span className="text-xs text-red-600 dark:text-red-400 font-bold font-mono-num">
              بدون عذر: {workspace.absences.filter((a) => a.excuseType === 'unexcused').length}
            </span>
          )}
        </div>

        {workspace.absences.length === 0 ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold">
            لا توجد غيابات مسجلة.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {workspace.absences.map((ab) => (
              <div
                key={ab.id}
                className="p-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-num font-bold text-[#171A36] dark:text-white">{ab.date}</span>
                  <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border text-[10px] font-bold">
                    {EXCUSE_LABELS[ab.excuseType]}
                  </span>
                </div>
                {ab.subjectName && <p className="text-slate-600 dark:text-slate-300">المادة/الحصة: {ab.subjectName}</p>}
                {ab.notes && <p className="text-slate-500">{ab.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
