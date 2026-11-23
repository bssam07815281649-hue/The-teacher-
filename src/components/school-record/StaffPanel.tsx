import React, { useState } from 'react';
import type { SchoolSection, SchoolWorkspacePayload } from '../../types';
import { saveSectionAction, upsertAnnouncementApi } from '../../services/schoolRecordClient';

type Props = { mode: 'cases'|'mail'|'notices'|'admin'; workspace: SchoolWorkspacePayload; section?: SchoolSection; refresh: ()=>Promise<void> };
const field = 'block w-full rounded-lg border bg-transparent p-3';
const button = 'rounded-lg bg-violet-700 px-4 py-2 text-white disabled:opacity-50';
export function StaffPanel({mode, workspace, section, refresh}: Props) {
  const [name,setName]=useState(''), [body,setBody]=useState(''), [target,setTarget]=useState('');
  const [ids,setIds]=useState<string[]>([]), [busy,setBusy]=useState(false), [status,setStatus]=useState('');
  const students=workspace.students.filter(s=>s.sectionId===section?.id);
  const group=section?.caseGroups?.find(g=>g.name===target);
  async function submit(action:()=>Promise<unknown>) {
    if(busy) return;
    setBusy(true); setStatus('');
    try { await action(); setName(''); setBody(''); setIds([]); await refresh(); setStatus('تم الحفظ'); }
    catch(e) {setStatus(e instanceof Error ? e.message : 'تعذر الحفظ');}
    finally {setBusy(false);}
  }
  return <section className="space-y-4 rounded-xl border p-4">
    {mode==='cases' && section && <>
      <h2 className="font-bold">حالات الطلاب</h2>
      <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void submit(async()=>{await saveSectionAction(section.id,'group',{name,studentIds:[]});setTarget(name.trim());});}}>
        <input required maxLength={100} aria-label="اسم الحالة" placeholder="اسم الحالة الجديدة" className={field} value={name} onChange={e=>setName(e.target.value)}/><button className={button} disabled={busy}>إضافة</button>
      </form>
      <select aria-label="اختيار حالة" className={field} value={target} onChange={e=>{setTarget(e.target.value);setIds([]);}}><option value="">اختر الحالة</option>{section.caseGroups?.map(g=><option key={g.name}>{g.name}</option>)}</select>
      {group && <><ul>{students.filter(s=>group.studentIds.includes(s.id)).map(s=><li key={s.id}>{s.fullName}</li>)}</ul><details><summary>إضافة طلاب للحالة</summary>{students.filter(s=>!group.studentIds.includes(s.id)).map(s=><label key={s.id} className="block py-1"><input type="checkbox" checked={ids.includes(s.id)} onChange={e=>setIds(e.target.checked?[...ids,s.id]:ids.filter(id=>id!==s.id))}/> {s.fullName}</label>)}<button className={button} disabled={busy||!ids.length} onClick={()=>void submit(()=>saveSectionAction(section.id,'group',{name:target,studentIds:ids}))}>حفظ الاختيار</button></details></>}
    </>}
    {mode==='mail' && section && <><h2 className="font-bold">سجل رسائل الطلاب</h2><select className={field} aria-label="المستلم" value={target} onChange={e=>setTarget(e.target.value)}><option value="">اختر المستلم</option><option value="*">جميع طلاب الشعبة</option>{students.map(s=><option key={s.id} value={s.id}>{s.fullName}</option>)}</select>
      {target && <><textarea className={field} placeholder="اكتب ملاحظة أو إعلاناً" maxLength={2000} value={body} onChange={e=>setBody(e.target.value)}/><button className={button} disabled={busy||!body.trim()} onClick={()=>void submit(()=>saveSectionAction(section.id,'message',{body,studentId:target==='*'?undefined:target}))}>إرسال</button>
      {(section.messages||[]).filter(m=>m.studentId===(target==='*'?undefined:target)).slice().reverse().map(m=><p className="border-t py-2 whitespace-pre-wrap" key={m.id}>{new Date(m.createdAt).toLocaleDateString('ar-IQ')} · {m.body}</p>)}</>}
    </>}
    {(mode==='notices'||mode==='admin') && <><h2 className="font-bold">تبليغات المرشدين</h2>{mode==='admin' && <form className="space-y-2" onSubmit={e=>{e.preventDefault();void submit(()=>upsertAnnouncementApi({title:name,body,visibility:'internal'}));}}><input required className={field} placeholder="عنوان التبليغ" value={name} onChange={e=>setName(e.target.value)}/><textarea required className={field} placeholder="نص التبليغ" value={body} onChange={e=>setBody(e.target.value)}/><button className={button} disabled={busy}>إرسال للمرشدين</button></form>}
      {!workspace.announcements.some(a=>a.visibility==='internal') && <p>لا توجد تبليغات.</p>}{workspace.announcements.filter(a=>a.visibility==='internal').map(a=><article key={a.id} className="border-t py-2"><strong>{a.title}</strong><p>{a.body}</p></article>)}</>}
    {status && <p role="status">{status}</p>}
  </section>;
}
