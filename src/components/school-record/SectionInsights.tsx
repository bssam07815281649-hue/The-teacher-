import React, { useState } from 'react';
import type { SchoolSection, SchoolStudent, SubjectGradebook } from '../../types';
import { getTermColumns } from '../../utils/gradeCalculations';
import { addSectionObservation } from '../../services/schoolRecordClient';

const panel = 'rounded-xl border border-violet-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900';
const field = 'w-full rounded-lg border bg-transparent px-3 py-2';
export function Rankings({students,subjects,sections}:{students:SchoolStudent[]; subjects:SubjectGradebook[]; sections:SchoolSection[]}) {
  const [mode,setMode]=useState('study1');
  const period=mode.endsWith('1')?'term1':'term2';
  const official=mode.startsWith('official');
  const ranked = students.flatMap(student => {
    const subjectMeans = subjects.filter(s => s.sectionId === student.sectionId).flatMap(s => {
      if (official) {
        const release=s.releases?.[period];
        const grade=release?.approvedColumnIds?.length ? release.official[student.id] : null;
        return grade==null ? [] : [grade];
      }
      const values = getTermColumns(s,period).flatMap(col => {
        const cell = s.cells[student.id+'::'+col.id];
        return cell?.status === 'score' && cell.score != null && col.maxScore > 0 ? [100*cell.score/col.maxScore] : [];
      });
      return values.length ? [values.reduce((a,b)=>a+b,0)/values.length] : [];
    });
    const average = subjectMeans.length ? subjectMeans.reduce((a,b)=>a+b,0)/subjectMeans.length : null;
    return average == null ? [] : [{student,average}];
  });
  return <details className={panel}><summary className="cursor-pointer font-bold">المتميزون والطلاب بحاجة إلى متابعة</summary>
    <select className={field+' mt-3'} aria-label="أساس الترتيب" value={mode} onChange={e=>setMode(e.target.value)}>
      <option value="study1">أثناء دراسة الفصل الأول</option><option value="official1">درجات الفصل الأول المعتمدة</option>
      <option value="study2">أثناء دراسة الفصل الثاني</option><option value="official2">درجات الفصل الثاني المعتمدة</option>
    </select>
    {!ranked.length ? <p className="mt-3">{official?'لا توجد درجات معتمدة لهذا الفصل.':'لا توجد درجات رقمية محفوظة لهذا الفصل.'}</p> : <div className="mt-3 grid gap-4 sm:grid-cols-2">
      {[true,false].map(high => <section key={String(high)}><h4 className="font-bold">{high ? 'المتميزون · أعلى خمسة' : 'بحاجة إلى متابعة · أقل من ٤٠٪'}</h4>
        <ol className="mt-2 space-y-2">{!high && !ranked.some(r=>r.average<40) && <li>لا يوجد طلاب ضمن هذا النطاق.</li>}{ranked.filter(r=>high || r.average<40).sort((a,b)=>(high ? b.average-a.average : a.average-b.average) || a.student.fullName.localeCompare(b.student.fullName,'ar') || a.student.id.localeCompare(b.student.id))
          .slice(0,high?5:ranked.length).map(({student,average},index)=><li key={student.id} className="flex justify-between gap-2"><span>{index+1}. {student.fullName} {sections.length>1 && ' · '+(sections.find(s=>s.id===student.sectionId)?.name || '')}</span><b>{average.toLocaleString('ar-IQ',{maximumFractionDigits:1})}٪</b></li>)}</ol>
      </section>)}</div>}
  </details>;
}

export function Observations({section,students,personal,refresh}:{section:SchoolSection;students:SchoolStudent[];personal:boolean;refresh:()=>Promise<void>}) {
  const [studentId,select] = useState(''), [category,setCategory]=useState(''), [note,setNote]=useState('');
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const records=(section.observations || []).filter(n=>Boolean(n.studentId)===personal);
  return <details className={panel}><summary className="cursor-pointer font-bold">{personal?'حالة الطلاب':'حالة الصف'}</summary>
    <form className="mt-3 space-y-2" onSubmit={async e=>{
      e.preventDefault(); if(busy)return; setBusy(true);setError('');
      try {await addSectionObservation(section.id,{...(personal?{studentId}:{}),category,note}); setCategory('');setNote('');await refresh();}
      catch(err){setError(err instanceof Error?err.message:'تعذر حفظ الملاحظة.');}finally{setBusy(false);}
    }}>
      {personal && <select className={field} aria-label="الطالب" required value={studentId} onChange={e=>select(e.target.value)}><option value="">اختر الطالب</option>{students.map(s=><option key={s.id} value={s.id}>{s.fullName}</option>)}</select>}
      <input className={field} list={personal?'student-states':'class-states'} required maxLength={100} placeholder="عنوان الحالة" aria-label="عنوان الحالة" value={category} onChange={e=>setCategory(e.target.value)}/>
      <datalist id={personal?'student-states':'class-states'}>{(personal?['متعفف','يتيم','أخرى']:['النظافة جيدة','النظافة تحتاج متابعة','أخرى']).map(v=><option key={v} value={v}/>)}</datalist>
      <textarea className={field} maxLength={2000} placeholder="ملاحظات أخرى" aria-label="ملاحظات أخرى" value={note} onChange={e=>setNote(e.target.value)}/>
      <button disabled={busy} className="rounded-lg bg-violet-700 px-4 py-2 text-white">حفظ الحالة</button>{error && <p role="alert">{error}</p>}
    </form>
    <ul className="mt-3 space-y-2">{[...records].reverse().map(n=><li key={n.id} className="border-t pt-2"><strong>{personal && students.find(s=>s.id===n.studentId)?.fullName+' · '}{n.category}</strong><p className="whitespace-pre-wrap">{n.note}</p><small>{new Date(n.createdAt).toLocaleDateString('ar-IQ')}</small></li>)}</ul>
  </details>;
}
