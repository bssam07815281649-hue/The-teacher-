import React, { useState } from 'react';
import {
  Building2,
  Calendar,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MapPin,
  ShieldCheck,
  Target,
  Compass,
  Sparkles,
  Wifi,
  WifiOff,
  AlertTriangle,
} from 'lucide-react';
import type { SchoolPublicPayload, SchoolSessionUser } from '../../types';
import { clearSchoolSessionToken, loginSchoolWithCode } from '../../services/schoolRecordClient';

interface PublicSchoolPortalProps {
  publicData: SchoolPublicPayload;
  onLoginSuccess: (session: SchoolSessionUser) => void;
  onAdminGoogleLogin?: (adminCode?: string) => void;
}

export const PublicSchoolPortal: React.FC<PublicSchoolPortalProps> = ({
  publicData,
  onLoginSuccess,
  onAdminGoogleLogin,
}) => {
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { school, stagesCount, sectionsCount, adminCodeConfigured, firebaseSync } = publicData;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim();
    if (!cleanCode) {
      setError('يرجى إدخال كود الدخول الخاص بك.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await loginSchoolWithCode(cleanCode);
      setCode('');
      if (res.session.role === 'admin' && onAdminGoogleLogin) {
        clearSchoolSessionToken();
        onAdminGoogleLogin(cleanCode);
        return;
      }
      onLoginSuccess(res.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الدخول بالكود.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* School Hero Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="relative h-36 sm:h-48 bg-gradient-to-l from-[#653CF5] via-[#532CE8] to-[#4320D9]">
          {school.coverDataUrl && (
            <img
              src={school.coverDataUrl}
              alt="غلاف المدرسة"
              className="w-full h-full object-cover opacity-85"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#171A36]/80 via-[#171A36]/25 to-transparent" />
          <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-bold backdrop-blur-md border ${
                firebaseSync.linked && firebaseSync.lastSyncStatus !== 'offline'
                  ? 'bg-emerald-500/20 text-emerald-50 border-emerald-300/40'
                  : 'bg-white/15 text-white border-white/25'
              }`}
            >
              {firebaseSync.linked ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              <span>
                {firebaseSync.linked ? 'مربوط بمشروع Firebase' : 'خادم المدرسة المحلي نشط'}
              </span>
            </span>
          </div>
        </div>

        <div className="px-5 sm:px-6 pb-6 -mt-10 relative">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-white dark:bg-slate-800 border-4 border-white dark:border-slate-900 shadow-md flex items-center justify-center overflow-hidden shrink-0">
                {school.logoDataUrl ? (
                  <img src={school.logoDataUrl} alt="شعار المدرسة" className="w-full h-full object-cover" />
                ) : (
                  <Building2 className="w-10 h-10 text-[#653CF5]" />
                )}
              </div>
              <div className="pt-2">
                <h2 className="font-display text-xl sm:text-2xl font-extrabold text-[#171A36] dark:text-white">
                  {school.name}
                </h2>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-[#653CF5]" />
                    {school.directorate}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-[#653CF5]" />
                    السنة الدراسية: <strong className="font-mono-num">{school.academicYear}</strong>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 self-start sm:self-end bg-[#EEEAFF] dark:bg-slate-800 px-4 py-2.5 rounded-xl border border-[#653CF5]/20">
              <div className="text-center">
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">الصفوف</span>
                <span className="font-mono-num text-base font-extrabold text-[#4320D9] dark:text-violet-300">
                  {stagesCount}
                </span>
              </div>
              <div className="w-px h-7 bg-[#653CF5]/20" />
              <div className="text-center">
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">الشعب</span>
                <span className="font-mono-num text-base font-extrabold text-[#4320D9] dark:text-violet-300">
                  {sectionsCount}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Split: Unified Code Login + School Identity & Announcements */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Unified Code-Only Login Card */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#EEEAFF] dark:bg-violet-950/60 text-[#653CF5] dark:text-violet-300 flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-lg text-[#171A36] dark:text-white">
                الدخول الموحد بالكود
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                للمدير، المرشد، والطالب عبر الكود الشخصي حصراً
              </p>
            </div>
          </div>

          {!adminCodeConfigured && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <div>
                <p className="font-bold">تنبيه إعداد المدير الأول:</p>
                <p className="mt-0.5 leading-relaxed">
                  لم يتم تعيين كود المدير الأول بعد — اضغط زر «دخول المدير (كود المدير + حساب Google)» أدناه لتعيين كودك الأول والدخول.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 font-medium"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="school-unified-code-input"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300"
              >
                أدخل كود الدخول
              </label>
              <div className="relative">
                <input
                  id="school-unified-code-input"
                  dir="ltr"
                  type={showCode ? 'text' : 'password'}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="أدخل الكود الخاص بك..."
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="w-full min-h-[48px] pl-24 pr-3.5 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono-num focus:outline-none focus:ring-2 focus:ring-[#653CF5]"
                />
                <button
                  type="button"
                  onClick={() => setShowCode((s) => !s)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#EEEAFF] hover:bg-[#e1d9ff] dark:bg-slate-700 dark:hover:bg-slate-600 text-xs font-bold text-[#4320D9] dark:text-violet-200 cursor-pointer"
                  aria-label={showCode ? 'إخفاء الكود' : 'إظهار الكود'}
                >
                  {showCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  <span>{showCode ? 'إخفاء' : 'إظهار'}</span>
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-sm cursor-pointer disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              <span>{loading ? 'جاري التحقق الآمن...' : 'دخول إلى سجل الطالب الذكي'}</span>
            </button>
          </form>

          {onAdminGoogleLogin && (
            <button
              type="button"
              onClick={() => onAdminGoogleLogin()}
              className="w-full min-h-[44px] rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>دخول المدير (كود المدير + حساب Google)</span>
            </button>
          )}

          <div className="p-3.5 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 space-y-1 leading-relaxed">
            <p className="font-bold text-[#171A36] dark:text-white">ملاحظة الصلاحيات:</p>
            <p>• المرشد والطالب يدخلان مباشرة بالكود دون الحاجة لحساب Google.</p>
            <p>• المدير يدخل عبر كود المدير + تسجيل الدخول بحساب Google، وتُحفظ مدرسته وأكواده على نفس الجيميل.</p>
          </div>
        </div>

        {/* School Overview, Vision, Mission, Goals */}
        <div className="lg:col-span-7 space-y-5">
          {/* Overview, Vision, Mission, Goals */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            {school.overview && (
              <div className="space-y-1.5">
                <h4 className="font-display font-bold text-sm text-[#171A36] dark:text-white flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[#653CF5]" />
                  نبذة عن المدرسة
                </h4>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {school.overview}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {school.vision && (
                <div className="p-3.5 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#4320D9] dark:text-violet-300">
                    <Compass className="w-4 h-4" />
                    الرؤية
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{school.vision}</p>
                </div>
              )}
              {school.mission && (
                <div className="p-3.5 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#4320D9] dark:text-violet-300">
                    <Target className="w-4 h-4" />
                    الرسالة
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{school.mission}</p>
                </div>
              )}
            </div>

            {school.goals && school.goals.length > 0 && (
              <div className="space-y-2 pt-1">
                <h4 className="font-display font-bold text-xs text-slate-700 dark:text-slate-200">
                  الأهداف التربوية والتعليمية
                </h4>
                <ul className="space-y-1.5">
                  {school.goals.map((goal, idx) => (
                    <li
                      key={idx}
                      className="text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2"
                    >
                      <span className="w-5 h-5 rounded-md bg-[#EEEAFF] dark:bg-violet-950/60 text-[#4320D9] dark:text-violet-300 font-mono-num font-bold text-[11px] flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <span className="pt-0.5">{goal}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
