import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Award, BookOpen, CalendarDays, ChevronLeft, Eye, GraduationCap, Library, Megaphone, School, Target } from 'lucide-react';
import { signInWithEmailAndPassword, signInAnonymously } from 'firebase/auth';
import { auth } from '../services/firebase';
import type { AppSection } from '../types';
import tutorImage from '../assets/images/tutor_welcome_hero_1794766024306.jpg';
import school from '../school-home.json';

const sections = [
  { title: 'عن المدرسة', body: school.about, icon: School },
  { title: 'رؤيتنا', body: school.vision, icon: Eye },
  { title: 'أهدافنا', body: school.goals, icon: Target },
  { title: 'إعلانات المدرسة', body: school.announcements, icon: Megaphone },
  ...school.extra.map((item: { title: string; body: string }) => ({ ...item, icon: School })),
];
const destinations = [
  { id: 'learn', label: 'تعلّم', icon: GraduationCap },
  { id: 'library', label: 'مكتبتي', icon: Library },
  { id: 'exam', label: 'اختبر نفسك', icon: Award },
  { id: 'plan', label: 'خطتي الدراسية', icon: CalendarDays },
] as const;

export function AuthView({ ready, onOpen, onSchoolRole, profileError, onRetryProfile }: { ready: boolean; onOpen: (section: AppSection) => void; onSchoolRole: (role: 'admin' | 'counselor' | 'student') => void; profileError?: string; onRetryProfile?: () => void }) {
  const [tutor, setTutor] = useState(location.hash !== '#school');
  const [pending, setPending] = useState<AppSection | null>(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [guestBusy, setGuestBusy] = useState(false);
  useEffect(() => {
    const changed = () => { setTutor(location.hash !== '#school'); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    if (ready && pending) {
      onOpen(pending);
      setPending(null);
    }
  }, [ready, pending, onOpen]);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (ready && !auth.currentUser?.isAnonymous) {
      const claims = (await auth.currentUser.getIdTokenResult()).claims;
      const role = claims.schoolRole === 'admin' ? 'admin' : claims.schoolRole === 'counselor' ? 'counselor' : 'student';
      onSchoolRole(role);
      return;
    }
    setMessage('');
    const match = /^([a-z0-9]{6,32})\.([A-Za-z0-9_-]{12,128})$/i.exec(code.trim());
    if (!match) { setMessage('تحقق من كتابة كود المدرسة كاملاً.'); return; }
    setBusy(true);
    try {
      const result = await signInWithEmailAndPassword(auth, match[1].toLowerCase() + '@codes.school.invalid', match[2]);
      // Firebase has already validated the code account's password. School codes
      // are not mailbox-based users and cannot complete an email verification flow.
      if (!result.user) throw new Error('AUTH_NO_USER');
      setCode('');
      // Only server-issued Firebase custom claims can authorize staff pages.
      const claims = (await result.user.getIdTokenResult()).claims;
      const role = claims.schoolRole === 'admin' ? 'admin' : claims.schoolRole === 'counselor' ? 'counselor' : 'student';
      onSchoolRole(role);
    } catch (error) {
      const errorCode = (error as { code?: string }).code;
      if (errorCode === 'auth/invalid-credential' || errorCode === 'auth/wrong-password' || errorCode === 'auth/user-not-found') {
        setMessage('الكود غير صحيح أو غير مفعّل. راجع إدارة المدرسة.');
      } else if (errorCode === 'auth/too-many-requests') {
        setMessage('محاولات دخول كثيرة. حاول مرة ثانية لاحقاً.');
      } else if (errorCode === 'auth/network-request-failed') {
        setMessage('تعذّر الاتصال بالإنترنت. تحقق من الشبكة وحاول مجدداً.');
      } else {
        setMessage('تعذّر تسجيل الدخول حالياً. حاول مجدداً أو راجع إدارة المدرسة.');
      }
    } finally { setBusy(false); }
  }
  async function choose(section: AppSection) {
    if (ready) { onOpen(section); return; }
    if (guestBusy) return;
    setPending(section);
    setMessage('');
    setGuestBusy(true);
    try {
      // Anonymous Firebase users get their own isolated tutor workspace.
      // This does not grant access to school records or administrator permissions.
      await signInAnonymously(auth);
    } catch (error) {
      console.error('Guest tutor sign-in unavailable:', error);
      setPending(null);
      setMessage('المعلم الذكي متاح للعرض، لكن وظائف الحفظ والذكاء الاصطناعي تحتاج تفعيل دخول الضيف في Firebase وإعدادات الخادم.');
    } finally {
      setGuestBusy(false);
    }
  }
  const card = 'rounded-2xl bg-violet-50 dark:bg-slate-800';
  return <main dir="rtl" className="min-h-screen bg-violet-50 px-3 py-4 text-violet-950 dark:bg-slate-950 dark:text-slate-100">
    <div className="mx-auto w-full max-w-xl space-y-4 rounded-3xl bg-white p-4 shadow-lg sm:p-6 dark:bg-slate-900">
      {tutor ? <>
        <a href="#school" className="inline-flex items-center gap-2 text-violet-700 dark:text-violet-300"><ArrowRight size={18}/>العودة إلى المدرسة</a>
        <header className="space-y-2 py-5 text-center"><BookOpen className="mx-auto text-violet-600" size={58}/><h1 className="text-3xl font-bold">المعلّم الذكي</h1><p>مساعدك الدراسي الشخصي</p></header>
        <img className="aspect-[2/1] w-full rounded-2xl object-cover" src={tutorImage} alt="كتب وأدوات للدراسة"/>
        <nav className="grid grid-cols-2 gap-3">{destinations.map(({id,label,icon: Icon}) => <button key={id} type="button" disabled={guestBusy} onClick={() => void choose(id)} className={card + ' grid justify-items-center gap-2 px-2 py-6 font-bold hover:bg-violet-100 disabled:opacity-60'}><Icon size={34}/>{label}</button>)}</nav>
        {guestBusy && <p role="status">جاري فتح مساحة المعلم الذكي دون كود…</p>}
        {message && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{message}</p>}
      </> : <>
        <p className="text-sm font-semibold">هذا الكود لصفحات المدرسة المحمية (الطالب، المرشد، المدير) فقط.</p>
        <form onSubmit={login} className="flex gap-2"><input ref={input} aria-label="أدخل الكود" placeholder="أدخل الكود" type="password" autoComplete="current-password" required={!ready} value={code} onChange={e=>setCode(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-violet-500 px-3 py-3"/><button disabled={busy} className="rounded-xl bg-violet-700 px-5 font-bold text-white">{busy ? 'جارٍ الدخول…' : 'دخول'}</button></form>
        {message && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{message}</p>}
        {profileError && <div role="alert" className="space-y-2 rounded-xl border border-amber-300 p-3 text-sm"><p>{profileError}</p>{onRetryProfile && <button type="button" onClick={onRetryProfile} className="rounded-lg bg-violet-700 px-3 py-2 text-white">إعادة تحميل حسابي</button>}</div>}
        <img className="aspect-[2.4/1] w-full rounded-2xl object-cover" src={school.image} alt="صورة توضيحية لمدرسة"/>
        <header className="space-y-1 text-center"><h1 className="text-3xl font-bold">{school.name}</h1><p>{school.year}</p></header>
        <section className="space-y-2">{sections.map(({title,body,icon: Icon})=><article key={title} className={card + ' flex items-center gap-3 p-3'}><Icon className="shrink-0 text-violet-600"/><div><h2 className="font-bold">{title}</h2><p className="text-sm leading-relaxed">{body}</p></div></article>)}</section>
        <a href="#tutor" className="flex items-center justify-between rounded-xl bg-violet-200 px-4 py-3 font-bold text-violet-950"><BookOpen/><span>الدخول للمعلم الذكي</span><ChevronLeft/></a>
      </>}
    </div>
  </main>;
}
