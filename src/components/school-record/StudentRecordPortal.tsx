import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, CalendarDays, ChevronDown, ChevronUp, ClipboardList,
  GraduationCap, LogOut, MessageSquareText, ShieldCheck, Sparkles,
  TrendingUp, UserRound, Clock3,
} from 'lucide-react';
import type {
  Book, GradeCellValue, GradeColumn, GradePeriodId,
  SchoolWorkspacePayload, SubjectGradebook,
} from '../../types';
import { formatCellDisplay, makeCellKey } from '../../utils/gradeCalculations';
import { publishedAverage } from '../../utils/publishedAverage';

interface StudentRecordPortalProps {
  workspace: SchoolWorkspacePayload;
  books: Book[];
  onWorkspaceRefresh: () => Promise<void>;
  onBuildRemedialPlan: (weakSubjects: string[]) => void;
  onPracticeWeakArea: (subject: string, bookId?: string) => void;
  onLogout: () => Promise<void>;
}

const periods: { id: GradePeriodId; label: string }[] = [
  { id: 'term1', label: 'الفصل الأول' },
  { id: 'midyear', label: 'نصف السنة' },
  { id: 'term2', label: 'الفصل الثاني' },
];
const number = new Intl.NumberFormat('ar-IQ', { maximumFractionDigits: 1 });
const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const percent = (value: number | null) => value == null ? '—' : number.format(value) + '٪';
const surface = 'rounded-3xl border border-violet-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900';

interface GradeEntry {
  id: string;
  label: string;
  recordName: string;
  maxScore: number;
  value: GradeCellValue;
  period: GradePeriodId;
  released: boolean;
}
function savedGradeEntries(subject: SubjectGradebook, studentId: string, period: GradePeriodId): GradeEntry[] {
  const groups = period === 'midyear'
    ? [{ name: 'امتحان نصف السنة', columns: subject.midyearColumns || [] }]
    : [...(subject.subRecords || [])]
        .filter(record => record.periodId === period)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map(record => ({ name: record.name, columns: record.columns }));
  return groups.flatMap(group =>
    [...group.columns].sort((a, b) => a.orderIndex - b.orderIndex).flatMap((column: GradeColumn) => {
      const id = makeCellKey(studentId, column.id);
      const value = subject.cells[id];
      if (!value || value.status === 'blank') return [];
      return [{
        id: column.id,
        label: column.label,
        recordName: group.name,
        maxScore: column.maxScore,
        value,
        period,
        released: Boolean(subject.releases?.[period]?.cells[id]),
      }];
    })
  );
}
function rawAverage(subjects: SubjectGradebook[], studentId: string) {
  const perSubject = subjects.flatMap(subject => {
    const values = periods.flatMap(p => savedGradeEntries(subject, studentId, p.id))
      .filter(item => item.value.status === 'score' && item.value.score != null && item.maxScore > 0)
      .map(item => 100 * item.value.score! / item.maxScore);
    const result = average(values);
    return result == null ? [] : [result];
  });
  return average(perSubject);
}
function annualPursuit(subject: SubjectGradebook, studentId: string) {
  const values = periods.map(p => subject.releases?.[p.id]?.official[studentId] ?? null);
  return values.every(v => v !== null) ? average(values as number[]) : null;
}
function statusLabel(cell: GradeCellValue) {
  return cell.status === 'absent' ? 'غائب' :
    cell.status === 'exempt' ? 'معفى' : formatCellDisplay(cell);
}

export function StudentRecordPortal({ workspace, onLogout, onWorkspaceRefresh }: StudentRecordPortalProps) {
  const [openedSubject, setOpenedSubject] = useState<string | null>(null);
  const [openedPeriod, setOpenedPeriod] = useState<GradePeriodId>('term1');
  const [showMessages, setShowMessages] = useState(false);
  const [showAbsences, setShowAbsences] = useState(false);
  const [showTrend, setShowTrend] = useState(false);

  useEffect(() => {
    let busy = false;
    const refresh = async () => {
      if (document.hidden || busy) return;
      busy = true;
      try { await onWorkspaceRefresh(); } finally { busy = false; }
    };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [onWorkspaceRefresh]);

  const student = workspace.students[0];
  const subjects = workspace.subjects;
  const studentId = student?.id || '';
  const currentAverage = useMemo(() => rawAverage(subjects, studentId), [subjects, studentId]);
  const published = useMemo(() => publishedAverage(subjects, studentId), [subjects, studentId]);
  const completePursuits = useMemo(() =>
    subjects.map(subject => ({ subject, result: annualPursuit(subject, studentId) }))
      .filter(item => item.result !== null), [subjects, studentId]);
  const allEntries = useMemo(() =>
    subjects.flatMap(subject => periods.flatMap(p => savedGradeEntries(subject, studentId, p.id))),
    [subjects, studentId]);
  const messages = workspace.sections.flatMap(section => section.messages || [])
    .slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!student) return <p dir="rtl" className="p-6 text-center">تعذر تحميل بيانات الطالب.</p>;

  const stageName = workspace.stages.find(stage =>
    stage.id === workspace.sections[0]?.stageId)?.name || '';
  const sectionName = workspace.sections[0]?.name || '';
  const stateName = { active: 'مستمر', inactive: 'غير مستمر', transferred: 'منقول' }[student.status];

  return (
    <main dir="rtl" className="mx-auto max-w-5xl space-y-5 pb-10 text-[#171A36] dark:text-slate-100">
      <header className="relative overflow-hidden rounded-[28px] bg-gradient-to-l from-[#653CF5] via-[#532CE8] to-[#3420A7] p-5 text-white shadow-lg sm:p-8">
        <div className="pointer-events-none absolute -left-8 -top-12 h-48 w-48 rounded-full border-[32px] border-white/10" />
        <div className="pointer-events-none absolute bottom-0 left-28 h-24 w-24 rounded-full bg-white/10 blur-xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm"><UserRound size={28} /></div>
            <div className="min-w-0">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-white/80"><Sparkles size={14}/> بوابة الطالب الذكية</p>
              <h1 className="truncate text-xl font-extrabold sm:text-3xl">{student.fullName}</h1>
              <p className="mt-1 text-xs text-white/85 sm:text-sm">{[stageName, sectionName, workspace.school.academicYear].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          <button type="button" onClick={() => void onLogout()} className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/15 px-4 py-2.5 text-sm font-semibold transition hover:bg-white/25">
            <LogOut size={16}/> خروج
          </button>
        </div>
        <div className="relative mt-6 flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded-full bg-white/15 px-3 py-1.5">الحالة: {stateName}</span>
          <span className="rounded-full bg-white/15 px-3 py-1.5">الدرجات تخص حسابك فقط</span>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className={surface + ' space-y-2 p-4 sm:p-5'}>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400"><TrendingUp size={17} className="text-[#653CF5]"/> معدلك الحالي</div>
          <div className="text-2xl font-extrabold text-[#4320D9] dark:text-violet-300">{percent(currentAverage)}</div>
          <p className="text-[11px] text-slate-500">من كل الدرجات المحفوظة حتى الآن، غير رسمي</p>
        </div>
        <div className={surface + ' space-y-2 p-4 sm:p-5'}>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400"><ClipboardList size={17} className="text-[#653CF5]"/> درجات مسجلة</div>
          <div className="text-2xl font-extrabold text-[#4320D9] dark:text-violet-300">{number.format(allEntries.length)}</div>
          <p className="text-[11px] text-slate-500">جميع المواد والفترات</p>
        </div>
        <div className={surface + ' col-span-2 space-y-2 p-4 sm:col-span-1 sm:p-5'}>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400"><ShieldCheck size={17} className="text-[#653CF5]"/> معدل المنشور</div>
          <div className="text-2xl font-extrabold text-[#4320D9] dark:text-violet-300">{percent(published)}</div>
          <p className="text-[11px] text-slate-500">الدرجات التي نشرها المرشد فقط</p>
        </div>
      </div>

      <section className={surface + ' p-4 sm:p-6'}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold"><BookOpen size={20} className="text-[#653CF5]"/> درجاتي بالتفصيل</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">كل الدرجات التي أدخلها المرشد، مع ترتيب السجلات والأعمدة نفسه</p>
          </div>
          <span className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 dark:bg-slate-800 dark:text-violet-300">{number.format(subjects.length)} مادة</span>
        </div>
        <div className="space-y-3">
          {subjects.length === 0 && <p className="rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-500 dark:bg-slate-800">لم تُضف مواد للشعبة بعد.</p>}
          {subjects.map(subject => {
            const itemCount = periods.reduce((sum, p) => sum + savedGradeEntries(subject, studentId, p.id).length, 0);
            const isOpen = openedSubject === subject.id;
            const annual = annualPursuit(subject, studentId);
            return <article key={subject.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-[#FCFBFF] dark:border-slate-700 dark:bg-slate-800/60">
              <button type="button" aria-expanded={isOpen} onClick={() => { setOpenedSubject(isOpen ? null : subject.id); setOpenedPeriod('term1'); }}
                className="flex w-full items-center justify-between gap-3 p-4 text-right transition hover:bg-violet-50 dark:hover:bg-slate-800">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EEE9FF] text-[#653CF5] dark:bg-slate-700"><GraduationCap size={22}/></div>
                  <div className="min-w-0"><h3 className="truncate font-extrabold">{subject.name}</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{number.format(itemCount)} درجة مدخلة · السعي السنوي: {percent(annual)}</p>
                  </div>
                </div>
                {isOpen ? <ChevronUp size={19} className="shrink-0 text-[#653CF5]"/> : <ChevronDown size={19} className="shrink-0 text-slate-500"/>}
              </button>
              {isOpen && <div className="border-t border-slate-200 px-3 pb-4 pt-3 dark:border-slate-700 sm:px-4">
                <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
                  {periods.map(p => <button key={p.id} type="button" onClick={() => setOpenedPeriod(p.id)}
                    className={'shrink-0 rounded-xl px-3 py-2 text-xs font-bold transition ' + (openedPeriod === p.id ? 'bg-[#653CF5] text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700')}>{p.label}</button>)}
                </div>
                {(() => {
                  const list = savedGradeEntries(subject, studentId, openedPeriod);
                  const official = subject.releases?.[openedPeriod]?.official[studentId];
                  return <div className="space-y-3">
                    {list.length === 0 && <p className="rounded-xl bg-white px-4 py-6 text-center text-sm text-slate-500 dark:bg-slate-900">ماكو درجات مسجلة لك بهذه الفترة بعد.</p>}
                    {Array.from(new Set(list.map(item => item.recordName))).map(recordName =>
                      <div key={recordName} className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                        <div className="border-b border-slate-100 bg-violet-50/70 px-4 py-2.5 text-xs font-extrabold text-[#4320D9] dark:border-slate-700 dark:bg-slate-800 dark:text-violet-300">{recordName}</div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                          {list.filter(item => item.recordName === recordName).map(item =>
                            <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                              <div className="min-w-0"><p className="font-semibold">{item.label}</p><p className="mt-0.5 text-[11px] text-slate-500">{item.released ? 'منشورة' : 'محفوظة في السجل'}</p></div>
                              <div className="shrink-0 text-left"><span className="font-extrabold text-[#4320D9] dark:text-violet-300">{statusLabel(item.value)}</span><span className="mr-1 text-xs text-slate-500">/ {number.format(item.maxScore)}</span></div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="rounded-xl bg-violet-50 px-4 py-3 text-xs dark:bg-slate-800">
                      <span className="text-slate-500 dark:text-slate-400">الدرجة الرسمية المعتمدة لهذه الفترة: </span>
                      <strong className="text-[#4320D9] dark:text-violet-300">{official == null ? 'بانتظار الاعتماد' : percent(official)}</strong>
                    </div>
                  </div>;
                })()}
              </div>}
            </article>;
          })}
        </div>
      </section>

      <section className={surface + ' p-4 sm:p-6'}>
        <div className="mb-3 flex items-center gap-2"><CalendarDays size={20} className="text-[#653CF5]"/><h2 className="text-lg font-extrabold">السعي السنوي</h2></div>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">يُحسب من الدرجات الرسمية المعتمدة للفصل الأول ونصف السنة والفصل الثاني، ولا يُعدّل درجاتك الأصلية.</p>
        {completePursuits.length === 0
          ? <p className="rounded-xl bg-violet-50 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">السعي السنوي الرسمي بانتظار اعتماد الفترات الثلاث. درجاتك اليومية والشهرية موجودة أعلاه.</p>
          : <div className="space-y-2">{completePursuits.map(({subject, result}) =>
            <div key={subject.id} className="flex items-center justify-between rounded-xl bg-violet-50 px-4 py-3 dark:bg-slate-800">
              <span className="font-bold">{subject.name}</span><strong className="font-extrabold text-[#4320D9] dark:text-violet-300">{percent(result)}</strong>
            </div>)}</div>}
      </section>

      <section className={surface + ' overflow-hidden'}>
        <button type="button" aria-expanded={showTrend} onClick={() => setShowTrend(!showTrend)} className="flex w-full items-center justify-between gap-2 px-4 py-4 text-right font-extrabold sm:px-6">
          <span className="flex items-center gap-2"><TrendingUp size={19} className="text-[#653CF5]"/> تطور درجاتي</span>{showTrend ? <ChevronUp size={19}/> : <ChevronDown size={19}/>}
        </button>
        {showTrend && <div className="space-y-3 border-t p-4 sm:p-6">
          {periods.map(p => {
            const periodEntries = subjects.flatMap(s => savedGradeEntries(s, studentId, p.id));
            const values = periodEntries.filter(e => e.value.status === 'score' && e.value.score !== null && e.maxScore > 0)
              .map(e => 100 * e.value.score! / e.maxScore);
            return <div key={p.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800"><span>{p.label}</span><strong>{percent(average(values))}</strong></div>;
          })}
        </div>}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className={surface + ' overflow-hidden'}>
          <button type="button" aria-expanded={showMessages} onClick={() => setShowMessages(!showMessages)} className="flex w-full items-center justify-between gap-2 px-4 py-4 text-right font-extrabold sm:px-5">
            <span className="flex items-center gap-2"><MessageSquareText size={19} className="text-[#653CF5]"/> رسائل المرشد <span className="text-xs text-slate-500">({number.format(messages.length)})</span></span>{showMessages ? <ChevronUp size={19}/> : <ChevronDown size={19}/>}
          </button>
          {showMessages && <div className="space-y-2 border-t p-4 text-sm">{messages.length === 0 && <p className="text-slate-500">لا توجد رسائل.</p>}
            {messages.map(msg => <article key={msg.id} className="rounded-xl bg-violet-50 p-3 dark:bg-slate-800"><strong>{msg.studentId ? 'ملاحظة خاصة' : 'إعلان للشعبة'}</strong><p className="my-1 text-xs text-slate-500">{new Date(msg.createdAt).toLocaleDateString('ar-IQ')}</p><p className="whitespace-pre-wrap">{msg.body}</p></article>)}
          </div>}
        </section>
        <section className={surface + ' overflow-hidden'}>
          <button type="button" aria-expanded={showAbsences} onClick={() => setShowAbsences(!showAbsences)} className="flex w-full items-center justify-between gap-2 px-4 py-4 text-right font-extrabold sm:px-5">
            <span className="flex items-center gap-2"><Clock3 size={19} className="text-[#653CF5]"/> الغيابات <span className="text-xs text-slate-500">({number.format(workspace.absences.length)})</span></span>{showAbsences ? <ChevronUp size={19}/> : <ChevronDown size={19}/>}
          </button>
          {showAbsences && <div className="space-y-2 border-t p-4 text-sm">{workspace.absences.length === 0 && <p className="text-slate-500">لا توجد غيابات.</p>}
            {workspace.absences.map(item => <div key={item.id} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">{item.date} · {item.subjectName} · {({excused:'بعذر',unexcused:'بدون عذر',medical:'إجازة مرضية',official:'مهمة رسمية'} as const)[item.excuseType]}</div>)}
          </div>}
        </section>
      </div>
    </main>
  );
}
