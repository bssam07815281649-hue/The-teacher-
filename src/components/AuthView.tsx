import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Award,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  Eye,
  EyeOff,
  GraduationCap,
  Megaphone,
  Library,
  Loader2,
  School,
  ShieldCheck,
  Target,
} from 'lucide-react';
import { signInAnonymously } from 'firebase/auth';
import { auth } from '../services/firebase';
import { clearSchoolSessionToken, fetchSchoolPublic, loginSchoolWithCode } from '../services/schoolRecordClient';
import type { AppSection, SchoolPublicPayload } from '../types';
import tutorImage from '../assets/images/tutor_welcome_hero_1794766024306.jpg';
import schoolDefaults from '../school-home.json';

const destinations = [
  { id: 'learn', label: 'تعلّم', icon: GraduationCap },
  { id: 'library', label: 'مكتبتي', icon: Library },
  { id: 'exam', label: 'اختبر نفسك', icon: Award },
  { id: 'plan', label: 'خطتي الدراسية', icon: CalendarDays },
] as const;

interface AuthViewProps {
  ready: boolean;
  onOpen: (section: AppSection) => void;
  onEnterGuest: (section: AppSection) => void;
  onSchoolRole: (role: 'admin' | 'counselor' | 'student', adminCode?: string) => void;
  profileError?: string;
  onRetryProfile?: () => void;
}

export function AuthView({
  ready,
  onOpen,
  onEnterGuest,
  onSchoolRole,
  profileError,
  onRetryProfile,
}: AuthViewProps) {
  const [tutor, setTutor] = useState(location.hash === '#tutor');
  const [pending, setPending] = useState<AppSection | null>(null);
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);
  const [publicData, setPublicData] = useState<SchoolPublicPayload | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const changed = () => {
      setTutor(location.hash === '#tutor');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void fetchSchoolPublic()
        .then(res => { if (active) setPublicData(res); })
        .catch(() => { /* Preserve the last known public information while offline. */ });
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
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
    const cleanCode = code.trim();
    if (!cleanCode) {
      setMessage('يرجى كتابة كود الدخول الخاص بك.');
      return;
    }
    setMessage('');
    setBusy(true);
    try {
      const res = await loginSchoolWithCode(cleanCode);
      setCode('');
      if (res.requiresGoogleAuth || res.session.role === 'admin') {
        clearSchoolSessionToken();
        onSchoolRole('admin', cleanCode);
      } else {
        onSchoolRole(res.session.role);
      }
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 429) {
        setMessage(err instanceof Error ? err.message : 'محاولات دخول كثيرة. انتظر قليلاً ثم حاول مجدداً.');
      } else if (status === 401) {
        if (publicData && !publicData.adminCodeConfigured) {
          onSchoolRole('admin', cleanCode);
          return;
        } else {
          setMessage(
            'الكود غير صحيح أو تم إبطاله. اضغط «إظهار» لمراجعة الكود المكتوب أو راجع إدارة المدرسة.');
        }
      } else {
        setMessage(
          err instanceof Error && err.message
            ? err.message
            : 'تعذّر الاتصال بخادم المدرسة حالياً. حاول مجدداً.'
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function choose(section: AppSection) {
    if (ready) {
      onOpen(section);
      return;
    }
    if (guestBusy) return;
    setMessage('');
    setGuestBusy(true);
    try {
      if (auth.currentUser) {
        setPending(section);
        if (onRetryProfile) {
          await onRetryProfile();
        } else {
          onEnterGuest(section);
        }
        return;
      }
      // Try anonymous Firebase session first for cloud backup if enabled;
      // otherwise seamlessly enter Local Guest Mode so AI Smart Tutor opens with zero login/code!
      setPending(section);
      await signInAnonymously(auth);
    } catch {
      setPending(null);
      onEnterGuest(section);
    } finally {
      setGuestBusy(false);
    }
  }

  const card = 'rounded-2xl bg-violet-50 dark:bg-slate-800';
  const schoolName = publicData?.school?.name || schoolDefaults.name;
  const academicYear = publicData?.school?.academicYear || schoolDefaults.year;
  const directorate = publicData?.school?.directorate || '';
  const coverSrc = publicData?.school?.coverDataUrl || schoolDefaults.image;
  const logoSrc = publicData?.school?.logoDataUrl || '';

  const announcements = (publicData?.announcements ?? [])
    .filter(item => item.visibility === 'public' && item.title?.trim() && item.body?.trim())
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));

  const infoSections = [
    {
      title: 'عن المدرسة',
      body: publicData?.school?.overview || schoolDefaults.about,
      icon: School,
    },
    {
      title: 'رؤيتنا',
      body: publicData?.school?.vision || schoolDefaults.vision,
      icon: Eye,
    },
    ...(publicData?.school?.mission
      ? [{ title: 'رسالتنا', body: publicData.school.mission, icon: BookOpen }]
      : []),
    {
      title: 'أهدافنا',
      body:
        publicData?.school?.goals && publicData.school.goals.length > 0
          ? publicData.school.goals.join(' · ')
          : schoolDefaults.goals,
      icon: Target,
    },
  ];

  return (
    <main
      dir="rtl"
      className="min-h-screen bg-violet-50 px-3 py-4 text-violet-950 dark:bg-slate-950 dark:text-slate-100"
    >
      <div className="mx-auto w-full max-w-xl space-y-4 rounded-3xl bg-white p-4 shadow-lg sm:p-6 dark:bg-slate-900">
        {tutor ? (
          <>
            <a
              href="#school"
              className="inline-flex items-center gap-2 text-sm font-bold text-violet-700 dark:text-violet-300"
            >
              <ArrowRight size={18} />
              <span>العودة إلى بوابة المدرسة</span>
            </a>
            <header className="space-y-2 py-4 text-center">
              <BookOpen className="mx-auto text-violet-600" size={56} />
              <h1 className="text-3xl font-bold">المعلّم الذكي</h1>
            </header>
            <img
              className="aspect-[2/1] w-full rounded-2xl object-cover"
              src={tutorImage}
              alt="كتب وأدوات للدراسة"
            />
            <nav className="grid grid-cols-2 gap-3">
              {destinations.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  disabled={guestBusy}
                  onClick={() => void choose(id)}
                  className={
                    card +
                    ' grid justify-items-center gap-2 px-2 py-6 font-bold hover:bg-violet-100 dark:hover:bg-slate-700 disabled:opacity-60 cursor-pointer transition-colors'
                  }
                >
                  <Icon size={34} className="text-violet-700 dark:text-violet-300" />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
            {guestBusy && (
              <p role="status" className="text-xs text-center text-violet-700 dark:text-violet-300 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>جاري فتح المعلم الذكي مباشرة…</span>
              </p>
            )}
            {message && (
              <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
                {message}
              </p>
            )}
          </>
        ) : (
          <>
            {announcements.length > 0 && (
            <section className={card + ' space-y-2 p-3'} aria-label="إعلانات المدرسة">
              <h2 className="flex items-center gap-2 text-sm font-bold"><Megaphone size={20} />إعلانات المدرسة</h2>
              {announcements.map(item => (
                <article key={item.id} className="border-t border-violet-200 pt-2 dark:border-slate-700">
                  <h3 className="font-bold">{item.title}</h3>
                  <p className="whitespace-pre-line text-sm">{item.body}</p>
                </article>
              ))}
            </section>
            )}
            {/* Unified School Code Login (Principal / Counselor / Student) */}
            <div className="rounded-2xl border border-violet-200 dark:border-slate-700 bg-violet-50/60 dark:bg-slate-800/50 p-4 space-y-2.5">

              <form onSubmit={login} className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    ref={input}
                    dir="ltr"
                    aria-label="أدخل الكود"
                    placeholder="أدخل الكود"
                    type={showCode ? 'text' : 'password'}
                    autoComplete="current-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full rounded-xl border border-violet-400 dark:border-slate-600 bg-white dark:bg-slate-900 pr-3 pl-20 py-2.5 text-sm font-mono-num"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCode((prev) => !prev)}
                    className="absolute left-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-lg bg-violet-100 hover:bg-violet-200 dark:bg-slate-800 dark:hover:bg-slate-700 px-2 py-1 text-[11px] font-bold text-violet-800 dark:text-violet-200 cursor-pointer"
                    aria-label={showCode ? 'إخفاء الكود' : 'إظهار الكود'}
                  >
                    {showCode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showCode ? 'إخفاء' : 'إظهار'}</span>
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-violet-700 hover:bg-violet-800 px-5 font-bold text-sm text-white cursor-pointer disabled:opacity-60"
                >
                  {busy ? 'جارٍ الدخول…' : 'دخول'}
                </button>
              </form>



              {message && (
                <p role="alert" className="text-xs font-semibold text-rose-700 dark:text-rose-300 pt-1">
                  {message}
                </p>
              )}
            </div>

            {profileError && (
              <div role="alert" className="space-y-2 rounded-xl border border-amber-300 p-3 text-sm">
                <p>{profileError}</p>
                {onRetryProfile && (
                  <button
                    type="button"
                    onClick={onRetryProfile}
                    className="rounded-lg bg-violet-700 px-3 py-2 text-white"
                  >
                    إعادة تحميل حسابي
                  </button>
                )}
              </div>
            )}

            {/* School Identity & Cover */}
            <div className="relative">
              <img
                className="aspect-[2.4/1] w-full rounded-2xl object-cover"
                src={coverSrc}
                alt={`صورة ${schoolName}`}
              />
              {logoSrc && (
                <img
                  src={logoSrc}
                  alt={`شعار ${schoolName}`}
                  className="w-16 h-16 rounded-2xl object-cover border-4 border-white dark:border-slate-900 shadow-md absolute -bottom-5 right-4 bg-white"
                />
              )}
            </div>
            <header className="space-y-1 text-center pt-2">
              <h1 className="text-2xl sm:text-3xl font-bold">{schoolName}</h1>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {academicYear}
                {directorate ? ` · ${directorate}` : ''}
              </p>
            </header>

            {/* About, Vision, Mission, Goals */}
            <section className="space-y-2">
              {infoSections.map(({ title, body, icon: Icon }) => (
                <article key={title} className={card + ' flex items-start gap-3 p-3'}>
                  <Icon className="shrink-0 text-violet-600 mt-0.5" size={20} />
                  <div>
                    <h2 className="font-bold text-sm">{title}</h2>
                    <p className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                      {body}
                    </p>
                  </div>
                </article>
              ))}
            </section>

            {/* Quick link to open AI Smart Tutor without code */}
            <a
              href="#tutor"
              className="flex items-center justify-between rounded-2xl bg-violet-700 px-4 py-3.5 font-bold text-white shadow-sm hover:bg-violet-800 transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <BookOpen className="w-5 h-5" />
                <span>الدخول إلى المعلّم الذكي</span>
              </span>
              <ChevronLeft className="w-5 h-5" />
            </a>

          </>
        )}
      </div>
    </main>
  );
}
