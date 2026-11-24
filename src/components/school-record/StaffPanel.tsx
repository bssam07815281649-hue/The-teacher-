import React, { useState } from 'react';
import type { SchoolSection, SchoolWorkspacePayload } from '../../types';
import { acknowledgeSchoolNotice, deleteAnnouncementApi, saveSectionAction, upsertAnnouncementApi } from '../../services/schoolRecordClient';

type Props = { mode: 'cases'|'mail'|'notices'|'admin'; workspace: SchoolWorkspacePayload; section?: SchoolSection; refresh: ()=>Promise<void> };
const field = 'block w-full min-w-0 max-w-full rounded-lg border bg-transparent p-3';
const button = 'w-full min-h-[44px] rounded-lg bg-violet-700 px-4 py-2 text-white disabled:opacity-50';
export function StaffPanel({mode, workspace, section, refresh}: Props) {
  const [name,setName]=useState(''), [body,setBody]=useState(''), [target,setTarget]=useState('');
  const [ids,setIds]=useState<string[]>([]), [busy,setBusy]=useState(false), [status,setStatus]=useState('');
  const [openNoticeId, setOpenNoticeId] = useState<string | null>(null);
  const [publicTitle,setPublicTitle] = useState('');
  const [publicBody,setPublicBody] = useState('');
  const [publicPinned,setPublicPinned] = useState(false);
  const [editingPublicId,setEditingPublicId] = useState<string | null>(null);
  const publicNotices = workspace.announcements
    .filter(a => a.visibility === 'public')
    .slice().sort((a,b) => Number(b.pinned)-Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));

  async function savePublicNotice(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !publicTitle.trim() || !publicBody.trim()) return;
    setBusy(true); setStatus('');
    try {
      await upsertAnnouncementApi({
        id: editingPublicId || undefined,
        title: publicTitle.trim(), body: publicBody.trim(),
        pinned: publicPinned, visibility: 'public',
      });
      await refresh();
      setEditingPublicId(null); setPublicTitle(''); setPublicBody(''); setPublicPinned(false);
      setStatus('تم نشر إعلان المدرسة. سيظهر فوق حقل تسجيل الدخول.');
    } catch (err) { setStatus(err instanceof Error ? err.message : 'تعذر نشر الإعلان'); }
    finally { setBusy(false); }
  }

  async function removePublicNotice(id: string) {
    if (busy || !window.confirm('هل تريد حذف إعلان المدرسة؟ سيختفي من صفحة الدخول.')) return;
    setBusy(true); setStatus('');
    try { await deleteAnnouncementApi(id); await refresh(); setStatus('تم حذف الإعلان.'); }
    catch (err) { setStatus(err instanceof Error ? err.message : 'تعذر حذف الإعلان'); }
    finally { setBusy(false); }
  }

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
      <form className="flex w-full min-w-0 flex-col gap-2" onSubmit={e=>{e.preventDefault();void submit(async()=>{await saveSectionAction(section.id,'group',{name,studentIds:[]});setTarget(name.trim());});}}>
        <input required maxLength={100} aria-label="اسم الحالة" placeholder="اسم الحالة الجديدة" className={field} value={name} onChange={e=>setName(e.target.value)}/><button className={button} disabled={busy}>إضافة</button>
      </form>
      <select aria-label="اختيار حالة" className={field} value={target} onChange={e=>{setTarget(e.target.value);setIds([]);}}><option value="">اختر الحالة</option>{section.caseGroups?.map(g=><option key={g.name}>{g.name}</option>)}</select>
      {group && <><ul>{students.filter(s=>group.studentIds.includes(s.id)).map(s=><li key={s.id}>{s.fullName}</li>)}</ul><details><summary>إضافة طلاب للحالة</summary>{students.filter(s=>!group.studentIds.includes(s.id)).map(s=><label key={s.id} className="block py-1"><input type="checkbox" checked={ids.includes(s.id)} onChange={e=>setIds(e.target.checked?[...ids,s.id]:ids.filter(id=>id!==s.id))}/> {s.fullName}</label>)}<button className={button} disabled={busy||!ids.length} onClick={()=>void submit(()=>saveSectionAction(section.id,'group',{name:target,studentIds:ids}))}>حفظ الاختيار</button></details></>}
    </>}
    {mode==='mail' && section && <><h2 className="font-bold">سجل رسائل الطلاب</h2><select className={field} aria-label="المستلم" value={target} onChange={e=>setTarget(e.target.value)}><option value="">اختر المستلم</option><option value="*">جميع طلاب الشعبة</option>{students.map(s=><option key={s.id} value={s.id}>{s.fullName}</option>)}</select>
      {target && <><textarea className={field} placeholder="اكتب ملاحظة أو إعلاناً" maxLength={2000} value={body} onChange={e=>setBody(e.target.value)}/><button className={button} disabled={busy||!body.trim()} onClick={()=>void submit(()=>saveSectionAction(section.id,'message',{body,studentId:target==='*'?undefined:target}))}>إرسال</button>
      {(section.messages||[]).filter(m=>m.studentId===(target==='*'?undefined:target)).slice().reverse().map(m=><p className="border-t py-2 whitespace-pre-wrap" key={m.id}>{new Date(m.createdAt).toLocaleDateString('ar-IQ')} · {m.body}</p>)}</>}
    </>}
    {(mode==='notices'||mode==='admin') && <div className="space-y-4">
      {mode === 'admin' && <div className="space-y-4 rounded-xl border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900 dark:bg-sky-950/20">
        <div>
          <h2 className="text-lg font-extrabold text-sky-950 dark:text-sky-100">إعلانات المدرسة</h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            الإعلان العام يظهر فوق خانة تسجيل الدخول لجميع الزائرين. إذا ماكو إعلانات منشورة، ما تظهر أي خانة إعلانات.
          </p>
        </div>
        <form onSubmit={e => void savePublicNotice(e)} className="space-y-2">
          <input required maxLength={200} aria-label="عنوان إعلان المدرسة"
            className={field} placeholder="عنوان إعلان المدرسة" value={publicTitle}
            onChange={e=>setPublicTitle(e.target.value)}/>
          <textarea required maxLength={4000} rows={3} aria-label="نص إعلان المدرسة"
            className={field} placeholder="اكتب الإعلان الذي سيظهر للطلاب فوق تسجيل الدخول"
            value={publicBody} onChange={e=>setPublicBody(e.target.value)}/>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={publicPinned} onChange={e=>setPublicPinned(e.target.checked)}/>
            تثبيت الإعلان في الأعلى
          </label>
          <button type="submit" className={button} disabled={busy || !publicTitle.trim() || !publicBody.trim()}>
            {editingPublicId ? 'حفظ تعديل الإعلان' : 'نشر إعلان المدرسة'}
          </button>
          {editingPublicId && <button type="button" className="w-full rounded-lg border p-2 text-sm"
            onClick={()=>{setEditingPublicId(null);setPublicTitle('');setPublicBody('');setPublicPinned(false);}}>
              إلغاء التعديل
            </button>}
        </form>
        {publicNotices.length > 0 && <div className="space-y-2 border-t border-sky-200 pt-3">
          <h3 className="font-bold">الإعلانات المنشورة ({publicNotices.length})</h3>
          {publicNotices.map(a => <article key={a.id} className="min-w-0 space-y-2 rounded-xl bg-white p-3 dark:bg-slate-900">
            <h4 className="break-words font-extrabold">{a.pinned ? '📌 ' : ''}{a.title}</h4>
            <p className="whitespace-pre-wrap break-words text-sm">{a.body}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="min-h-[40px] flex-1 rounded-lg border px-3 text-sm" disabled={busy}
                onClick={()=>{setEditingPublicId(a.id);setPublicTitle(a.title);setPublicBody(a.body);setPublicPinned(Boolean(a.pinned));}}>
                تعديل
              </button>
              <button type="button" className="min-h-[40px] flex-1 rounded-lg bg-red-50 px-3 text-sm text-red-700 dark:bg-red-950/30" disabled={busy}
                onClick={()=>void removePublicNotice(a.id)}>حذف</button>
            </div>
          </article>)}
        </div>}
      </div>}
      <h2 className="border-t pt-4 text-lg font-extrabold">{mode === 'admin' ? 'تبليغات المرشدين (خاصة)' : 'تبليغات المرشدين'}</h2>
      {mode==='admin' && <form className="space-y-2" onSubmit={e=>{e.preventDefault();void submit(()=>upsertAnnouncementApi({title:name,body,visibility:'internal'}));}}>
        <input required className={field} placeholder="عنوان البلاغ" value={name} onChange={e=>setName(e.target.value)}/>
        <textarea required className={field} placeholder="اكتب البلاغ للمرشدين" value={body} onChange={e=>setBody(e.target.value)}/>
        <button className={button} disabled={busy||!name.trim()||!body.trim()}>إرسال البلاغ</button>
      </form>}
      {mode==='admin' && <h3 className="border-t pt-4 text-base font-extrabold">البلاغات السابقة</h3>}
      {!workspace.announcements.some(a=>a.visibility==='internal') && <p className="text-sm text-slate-500">لا توجد بلاغات.</p>}
      <div className="space-y-5">
        {(mode === 'admin'
          ? [{ title: '', notices: workspace.announcements.filter(a=>a.visibility==='internal') }]
          : [{ title: 'بلاغات جديدة', notices: workspace.announcements.filter(a=>a.visibility==='internal' && section && !a.readBy?.[section.id]) },
             { title: 'البلاغات السابقة', notices: workspace.announcements.filter(a=>a.visibility==='internal' && section && !!a.readBy?.[section.id]) }]
        ).map(group=><section key={group.title || 'all'} className="space-y-3">
          {group.title && <h3 className="font-bold text-violet-800 dark:text-violet-300">{group.title} ({group.notices.length})</h3>}
          {group.notices.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
          .map(a=>{
            const readBy=a.readBy||{};
            const readSections=workspace.sections.filter(sec=>Boolean(readBy[sec.id]));
            const unread=mode==='notices' && section && !readBy[section.id];
            const expanded=openNoticeId===a.id;
            const markOpened=async ()=>{
              setOpenNoticeId(expanded?null:a.id);
              if(!expanded && unread) {
                try {await acknowledgeSchoolNotice(a.id);await refresh();}
                catch(err){setStatus(err instanceof Error?err.message:'تعذر تسجيل قراءة البلاغ');}
              }
            };
            return <article key={a.id} className="overflow-hidden rounded-2xl border border-violet-100 bg-white dark:border-slate-700 dark:bg-slate-900">
              <button type="button" aria-expanded={expanded} onClick={()=>void markOpened()} className="flex w-full items-center justify-between gap-2 p-4 text-right">
                <span className="space-y-1"><strong className="block">{a.title}</strong><span className="block text-xs text-slate-500">{new Date(a.createdAt).toLocaleString('ar-IQ')}</span></span>
                {unread ? <span className="shrink-0 rounded-full bg-rose-100 px-2 py-1 text-xs font-bold text-rose-700">بلاغ جديد</span> : <span className="shrink-0 text-xs text-violet-700">{expanded?'إغلاق':'فتح البلاغ'}</span>}
              </button>
              {expanded && <div className="space-y-3 border-t p-4 text-sm">
                <p className="whitespace-pre-wrap leading-7">{a.body}</p>
                {mode==='admin' && <div className="rounded-xl bg-violet-50 p-3 dark:bg-slate-800">
                  <h4 className="mb-2 font-bold">المرشدون الذين قرأوا البلاغ ({readSections.length} من {workspace.sections.length})</h4>
                  {workspace.sections.map(sec=><p key={sec.id} className="py-1">{readBy[sec.id] ? '✓' : '○'} {sec.counselorName||'مرشد الشعبة'} — {sec.name} {readBy[sec.id] ? '· '+new Date(readBy[sec.id].readAt).toLocaleString('ar-IQ') : '· لم يفتح البلاغ'}</p>)}
                </div>}
              </div>}
            </article>;
          })}
        </section>)}
      </div>
    </div>}
    {status && <p role="status">{status}</p>}
  </section>;
}
