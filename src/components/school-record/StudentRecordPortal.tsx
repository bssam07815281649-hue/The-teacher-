import React, { useEffect, useState } from 'react';
import type { Book, GradePeriodId, ReleasedPeriod, SchoolWorkspacePayload, SubjectGradebook } from '../../types';
import { formatCellDisplay, makeCellKey } from '../../utils/gradeCalculations';

interface StudentRecordPortalProps {
  workspace: SchoolWorkspacePayload;
  books: Book[];
  onWorkspaceRefresh: () => Promise<void>;
  onBuildRemedialPlan: (weakSubjects: string[]) => void;
  onPracticeWeakArea: (subject: string, bookId?: string) => void;
  onLogout: () => Promise<void>;
}


const periods: {id: GradePeriodId; label: string}[] = [
  {id: 'term1', label: 'الفصل الأول'}, {id: 'midyear', label: 'نصف السنة'}, {id: 'term2', label: 'الفصل الثاني'},
];
const card = 'rounded-2xl border border-violet-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900';
const row = 'flex w-full items-center justify-between gap-3 py-3 text-start font-bold';
const number = new Intl.NumberFormat('ar-IQ', { maximumFractionDigits: 1 });
const mean = (values: number[]) => values.length ? values.reduce((a,b) => a+b, 0) / values.length : null;
function entries(release: ReleasedPeriod | undefined, studentId: string) {
  return (release?.columns ?? []).flatMap(col => {
    const cell = release?.cells[makeCellKey(studentId, col.id)];
    return cell ? [{col, cell, percent: cell.score == null ? null : 100 * cell.score / col.maxScore}] : [];
  });
}
function average(release: ReleasedPeriod | undefined, studentId: string) {
  return mean(entries(release, studentId).flatMap(e => e.percent == null ? [] : [e.percent]));
}
function level(value: number) {
  return value < 50 ? 'ضعيف' : value < 70 ? 'متوسط' : value < 85 ? 'جيد' : 'قوي';
}
function display(value: number | null) {
  return value == null ? '—' : number.format(value) + '٪';
}
function trend(subjects: SubjectGradebook[], studentId: string, period: GradePeriodId) {
  const groups = new Map<string, number[]>();
  for (const subject of subjects) {
    for (const entry of entries(subject.releases?.[period], studentId)) {
      if (entry.percent == null) continue;
      const label = entry.col.label.trim();
      const values = groups.get(label) ?? [];
      values.push(entry.percent);
      groups.set(label, values);
    }
  }
  const monthOrder = (label: string) => {
    const text = label.replace(/[أإآ]/g,'ا').replace(/[٠-٩]/g,c => String(c.charCodeAt(0)-1632));
    const numeric = text.match(/(?:شهر|شهري)\s*(\d+)/);
    if (numeric) return Number(numeric[1]);
    return ['الاول','الثاني','الثالث','الرابع','الخامس','السادس'].findIndex(word => text.includes(word)) + 1 || 99;
  };
  return Array.from(groups, ([label, values]) => ({label, value: mean(values)!}))
    .sort((a,b) => monthOrder(a.label) - monthOrder(b.label));
}
export function StudentRecordPortal({ workspace, onLogout, onWorkspaceRefresh }: StudentRecordPortalProps) {
  const [open, setOpen] = useState<GradePeriodId | 'annual' | null>(null);
  const [subjectId, selectSubject] = useState('');
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
  if (!student) return <p>تعذر تحميل بيانات الطالب.</p>;
  const id = student.id, subjects = workspace.subjects;
  const general = mean(subjects.flatMap(subject => {
    const marks = periods.flatMap(p => entries(subject.releases?.[p.id], id).flatMap(e => e.percent == null ? [] : [e.percent]));
    const value = mean(marks);
    return value == null ? [] : [value];
  }));
  function toggle(period: typeof open) {
    setOpen(open === period ? null : period);
    selectSubject('');
  }
  return <main dir="rtl" className="mx-auto max-w-2xl space-y-3">
    <header className={card}><div className={row}><h1>{student.fullName}</h1><button onClick={() => void onLogout()}>خروج</button></div>
      <p>حالة الطالب: {{active:'مستمر',inactive:'غير مستمر',transferred:'منقول'}[student.status]}</p>
      <p className="mt-2 text-xl font-bold">المعدل العام: {display(general)} {general != null && ' · ' + level(general)}</p>
    </header>
    <details className={card}><summary className="cursor-pointer font-bold">تطوّر المعدل</summary>
      {general == null && <p>لا توجد درجات منشورة.</p>}
      {periods.map(p => {const points = trend(subjects,id,p.id); return points.length > 0 && <section key={p.id}><h3 className="mt-3 font-bold">{p.label}</h3>{points.map(v => <p key={v.label}>{v.label} · {display(v.value)} · {level(v.value)}</p>)}</section>;})}
    </details>
    {periods.map(p => {
      const visible = subjects.filter(s => entries(s.releases?.[p.id],id).length > 0);
      return <section key={p.id} className={card}><button className={row} aria-expanded={open === p.id} onClick={()=>toggle(p.id)}>{p.label}<span>{open === p.id ? '−' : '+'}</span></button>
        {open === p.id && <div>{!visible.length && <p>{p.id === 'midyear' ? 'لم تعتمد الدرجات.' : 'لم تكتمل الدرجات.'}</p>}
          {visible.map(subject => {
            const release = subject.releases![p.id]!, official = release.official[id];
            return <article className="border-t py-1" key={subject.id}><button className={row} aria-expanded={subjectId === subject.id} onClick={()=>selectSubject(subjectId === subject.id ? '' : subject.id)}>{subject.name}<span>{display(average(release,id))}</span></button>
              {subjectId === subject.id && <div className="space-y-2 pb-3">
                <p className="font-bold">{official == null ? (p.id === 'midyear' ? 'لم تعتمد الدرجات.' : 'لم تكتمل الدرجات.') : 'درجة '+p.label+' المعتمدة: '+display(official)}</p>
                {entries(release,id).map(e=><div className="flex justify-between gap-3" key={e.col.id}><span>{e.col.label}</span><span>{formatCellDisplay(e.cell)} / {number.format(e.col.maxScore)} {e.percent != null && ' · '+level(e.percent)}</span></div>)}
              </div>}</article>;
          })}</div>}
      </section>;
    })}
    <section className={card}><button className={row} aria-expanded={open === 'annual'} onClick={()=>toggle('annual')}>السعي السنوي<span>{open === 'annual' ? '−' : '+'}</span></button>
      {open === 'annual' && <div>{subjects.filter(s => periods.every(p => s.releases?.[p.id]?.official[id] != null)).length === 0 && <p>بانتظار اعتماد درجات الفترات الثلاث.</p>}
        {subjects.map(s=>{const values = periods.flatMap(p=>{const n=s.releases?.[p.id]?.official[id]; return n == null ? [] : [n];});
          return values.length === 3 && <details key={s.id} className="border-t py-2"><summary>{s.name} · {display(mean(values))}</summary>{periods.map((p,i)=><p key={p.id}>{p.label} · {display(values[i])}</p>)}</details>;
        })}</div>}
    </section>
    <details className={card}><summary>الغيابات ({workspace.absences.length})</summary>{workspace.absences.map(a=><p key={a.id}>{a.date} · {a.subjectName} · {{excused:'بعذر',unexcused:'بدون عذر',medical:'إجازة مرضية',official:'مهمة رسمية'}[a.excuseType]}</p>)}</details>
  </main>;
}
