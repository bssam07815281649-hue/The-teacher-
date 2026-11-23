import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import {
  auth,
  consumeGoogleRedirectResult,
  signInWithGoogle,
  signInWithGoogleRedirect,
} from '../services/firebase';
import {
  clearSchoolSessionToken,
  fetchSchoolPublic,
  fetchSchoolWorkspace,
  loginSchoolWithGoogleAdmin,
  logoutSchoolSession,
  restoreBackupApi,
  setSchoolUnauthorizedHandler,
} from '../services/schoolRecordClient';
import { restoreWorkspaceFromFirestore } from '../services/schoolFirebaseSync';
import type { SchoolWorkspacePayload } from '../types';
import { AdminDashboard } from './school-record/AdminDashboard';
import { CounselorWorkspace } from './school-record/CounselorWorkspace';
import { AdminFirebaseModal } from './school-record/AdminFirebaseModal';

type AccessState = 'form' | 'loading' | 'authorized';

function isRunningInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isGoogleUser(user: User | null): user is User {
  if (!user || user.isAnonymous) return false;
  return (
    user.providerData.some((p) => p.providerId === 'google.com') ||
    Boolean(user.email && user.email.includes('@'))
  );
}

function formatGoogleAuthError(err: unknown): {
  message: string;
  popupBlocked: boolean;
} {
  const code = (err as { code?: string } | null)?.code || '';
  if (code === 'auth/popup-blocked') {
    return {
      message:
        'المتصفح منع فتح نافذة تسجيل دخول Google المنبثقة. اسمح بالنوافذ المنبثقة أو افتح الصفحة في نافذة مستقلة.',
      popupBlocked: true,
    };
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return {
      message: 'أُغلقت نافذة تسجيل دخول Google قبل إكمال الاختيار. اضغط الزر مجدداً واختر حسابك.',
      popupBlocked: false,
    };
  }
  if (code === 'auth/unauthorized-domain') {
    return {
      message: `النطاق الحالي (${window.location.hostname}) غير مضاف إلى النطاقات المصرح بها في Firebase Authentication.`,
      popupBlocked: false,
    };
  }
  if (code === 'auth/operation-not-allowed') {
    return {
      message: 'تسجيل الدخول بحساب Google غير مفعّل في مشروع Firebase Authentication.',
      popupBlocked: false,
    };
  }
  if (code === 'auth/network-request-failed') {
    return {
      message: 'تعذّر الاتصال بخدمة Google بسبب ضعف أو انقطاع الإنترنت. حاول مجدداً.',
      popupBlocked: false,
    };
  }
  const rawMsg = err instanceof Error ? err.message : '';
  return {
    message: code
      ? `تعذّر إتمام تسجيل الدخول عبر Google (${code}). تأكد من السماح بالنوافذ المنبثقة وحاول مجدداً.`
      : rawMsg || 'تعذّر إتمام تسجيل الدخول عبر Google. تأكد من السماح بالنوافذ المنبثقة وحاول مجدداً.',
    popupBlocked: false,
  };
}

export function AdminGate({
  onBack,
  initialAdminCode = '',
}: {
  onBack: () => void;
  initialAdminCode?: string;
}) {
  const [access, setAccess] = useState<AccessState>('form');
  const [account, setAccount] = useState<User | null>(() =>
    isGoogleUser(auth.currentUser) ? auth.currentUser : null
  );
  const [adminCode, setAdminCode] = useState(initialAdminCode);
  const [showCode, setShowCode] = useState(false);
  const [adminCodeConfigured, setAdminCodeConfigured] = useState<boolean | null>(null);
  const [workspace, setWorkspace] = useState<SchoolWorkspacePayload | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [firebaseModalOpen, setFirebaseModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [popupBlocked, setPopupBlocked] = useState(false);

  const mountedRef = useRef(true);
  const inFlightVerifyRef = useRef(false);
  const autoTriedInitialRef = useRef(false);
  const adminCodeRef = useRef(adminCode);
  adminCodeRef.current = adminCode;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetchSchoolPublic()
      .then((pub) => {
        if (active) setAdminCodeConfigured(pub.adminCodeConfigured);
      })
      .catch(() => {
        // Non-fatal
      });
    return () => {
      active = false;
    };
  }, []);

  const loadWorkspace = useCallback(async () => {
    const ws = await fetchSchoolWorkspace();
    if (mountedRef.current) {
      setWorkspace(ws);
    }
  }, []);

  useEffect(() => {
    setSchoolUnauthorizedHandler(() => {
      if (!mountedRef.current || inFlightVerifyRef.current) return;
      setWorkspace(null);
      setActiveSectionId(null);
      setAccess('form');
    });
    return () => setSchoolUnauthorizedHandler(null);
  }, []);

  const completeAdminVerification = useCallback(
    async (user: User, codeToUse: string) => {
      if (inFlightVerifyRef.current) return;
      const cleanCode = codeToUse.trim();
      if (!cleanCode) {
        setError('شرط الدخول: يرجى إدخال كود المدير أولاً.');
        setAccess('form');
        return;
      }
      if (adminCodeConfigured === false && cleanCode.length < 6) {
        setError('كود المدير الأول يجب أن يكون 6 أحرف أو أرقام على الأقل.');
        setAccess('form');
        return;
      }

      inFlightVerifyRef.current = true;
      if (mountedRef.current) {
        setAccess('loading');
        setStatusMessage(`جاري التحقق من كود المدير وفتح مدرسة ${user.email || 'Google'}…`);
        setError('');
        setPopupBlocked(false);
      }

      try {
        let idToken = await user.getIdToken(false);
        try {
          await loginSchoolWithGoogleAdmin({
            idToken,
            code: cleanCode,
            initialCode: adminCodeConfigured === false ? cleanCode : undefined,
          });
        } catch (firstErr) {
          const status = (firstErr as { status?: number }).status;
          // Refresh Firebase ID token once only if token itself expired (not for wrong admin code)
          const msg = firstErr instanceof Error ? firstErr.message : '';
          if (status === 401 && !msg.includes('كود المدير')) {
            idToken = await user.getIdToken(true);
            await loginSchoolWithGoogleAdmin({
              idToken,
              code: cleanCode,
              initialCode: adminCodeConfigured === false ? cleanCode : undefined,
            });
          } else {
            throw firstErr;
          }
        }

        let ws = await fetchSchoolWorkspace();
        if (mountedRef.current) {
          setWorkspace(ws);
        }

        // If this Gmail's local server tenant is still fresh/empty, check its Firestore cloud space and restore automatically
        const isEmptyLocalSchool =
          ws.stages.length === 0 &&
          ws.sections.length === 0 &&
          ws.students.length === 0 &&
          ws.subjects.length === 0;

        if (isEmptyLocalSchool && auth.currentUser?.uid === user.uid) {
          try {
            if (mountedRef.current) {
              setStatusMessage(`جاري فحص واستعادة بيانات المدرسة المحفوظة على ${user.email}…`);
            }
            const cloudBackup = await restoreWorkspaceFromFirestore(ws.school.id);
            if (cloudBackup) {
              const restored = await restoreBackupApi({ backupData: cloudBackup });
              ws = restored.workspace;
              if (mountedRef.current) setWorkspace(ws);
            }
          } catch (cloudErr) {
            console.warn('Cloud school restore check skipped:', cloudErr);
          }
        }

        if (mountedRef.current) {
          setAdminCodeConfigured(true);
          setAccess('authorized');
        }
      } catch (err) {
        clearSchoolSessionToken();
        if (mountedRef.current) {
          setWorkspace(null);
          setAccess('form');
          const status = (err as { status?: number } | null)?.status;
          const baseMsg =
            err instanceof Error && err.message
              ? err.message
              : 'تعذّر التحقق من كود المدير أو حساب Google.';
          setError(
            status === 403 && user.email && !baseMsg.includes(user.email)
              ? `${baseMsg} (الحساب المستخدم: ${user.email})`
              : baseMsg
          );
        }
      } finally {
        inFlightVerifyRef.current = false;
        if (mountedRef.current) setStatusMessage('');
      }
    },
    [adminCodeConfigured, loadWorkspace]
  );

  useEffect(() => {
    let active = true;

    void consumeGoogleRedirectResult()
      .then((res) => {
        if (!active || !res?.user) return;
        if (isGoogleUser(res.user)) {
          setAccount(res.user);
          if (adminCodeRef.current.trim()) {
            void completeAdminVerification(res.user, adminCodeRef.current);
          }
        }
      })
      .catch((err) => {
        if (!active) return;
        const formatted = formatGoogleAuthError(err);
        setError(formatted.message);
        setPopupBlocked(formatted.popupBlocked);
      });

    const unsub = onAuthStateChanged(auth, (user) => {
      if (!active) return;
      if (isGoogleUser(user)) {
        setAccount(user);
        if (initialAdminCode.trim() && !autoTriedInitialRef.current) {
          autoTriedInitialRef.current = true;
          void completeAdminVerification(user, initialAdminCode);
        }
      } else {
        setAccount(null);
      }
    });

    return () => {
      active = false;
      unsub();
    };
  }, [completeAdminVerification, initialAdminCode]);

  async function handleSubmitAdminGate(e: React.FormEvent) {
    e.preventDefault();
    if (busy || inFlightVerifyRef.current) return;

    const cleanCode = adminCode.trim();
    if (!cleanCode) {
      setError('شرط الدخول: أدخل كود المدير أولاً للمتابعة.');
      return;
    }
    if (adminCodeConfigured === false && cleanCode.length < 6) {
      setError('يجب أن يتكون كود المدير الأول من 6 أحرف أو أرقام على الأقل.');
      return;
    }

    setError('');
    setPopupBlocked(false);
    setBusy(true);

    try {
      let targetUser = account && isGoogleUser(account) ? account : null;
      if (!targetUser) {
        const result = await signInWithGoogle();
        if (result.user && isGoogleUser(result.user)) {
          targetUser = result.user;
          if (mountedRef.current) setAccount(targetUser);
        }
      }

      if (targetUser) {
        await completeAdminVerification(targetUser, cleanCode);
      } else {
        setError('يرجى اختيار حساب Google موثّق البريد للمتابعة.');
      }
    } catch (err) {
      console.error('Google administrator sign-in:', err);
      const formatted = formatGoogleAuthError(err);
      if (formatted.popupBlocked && !isRunningInIframe()) {
        try {
          await signInWithGoogleRedirect();
          return;
        } catch (redirectErr) {
          console.error('Google administrator redirect fallback:', redirectErr);
        }
      }
      if (mountedRef.current) {
        setError(formatted.message);
        setPopupBlocked(formatted.popupBlocked);
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function handleSignInWithDifferentGoogle() {
    if (busy || inFlightVerifyRef.current) return;
    setError('');
    setPopupBlocked(false);
    setBusy(true);
    try {
      clearSchoolSessionToken();
      await signOut(auth);
      setAccount(null);
      const result = await signInWithGoogle();
      if (result.user && isGoogleUser(result.user)) {
        if (mountedRef.current) setAccount(result.user);
        if (adminCodeRef.current.trim()) {
          await completeAdminVerification(result.user, adminCodeRef.current);
        }
      }
    } catch (err) {
      const formatted = formatGoogleAuthError(err);
      if (mountedRef.current) {
        setError(formatted.message);
        setPopupBlocked(formatted.popupBlocked);
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function googleRedirectLogin() {
    if (busy) return;
    if (!adminCode.trim()) {
      setError('أدخل كود المدير أولاً ثم اضغط تسجيل الدخول.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signInWithGoogleRedirect();
    } catch (err) {
      const formatted = formatGoogleAuthError(err);
      if (mountedRef.current) {
        setError(formatted.message);
        setBusy(false);
      }
    }
  }

  async function handleAdminLogout() {
    await logoutSchoolSession({ isAdmin: true });
    setWorkspace(null);
    setActiveSectionId(null);
    setAccess('form');
    onBack();
  }

  if (access === 'authorized' && workspace) {
    return (
      <div
        dir="rtl"
        className="min-h-screen bg-[#FAF9F6] dark:bg-slate-950 text-slate-900 dark:text-slate-100 py-5 px-3 sm:px-6"
      >
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={onBack}
              className="min-h-[40px] px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              <span>العودة إلى بوابة المدرسة</span>
            </button>

            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                <span>{workspace.session.ownerEmail || account?.email || 'حساب المدير'}</span>
              </span>
            </div>
          </div>

          {activeSectionId ? (
            <CounselorWorkspace
              workspace={workspace}
              sectionId={activeSectionId}
              onWorkspaceRefresh={loadWorkspace}
              onBackToAdmin={() => setActiveSectionId(null)}
              onLogout={handleAdminLogout}
            />
          ) : (
            <AdminDashboard
              workspace={workspace}
              onWorkspaceRefresh={loadWorkspace}
              onEnterSection={(sectionId) => setActiveSectionId(sectionId)}
              onOpenFirebaseModal={() => setFirebaseModalOpen(true)}
              onLogout={handleAdminLogout}
            />
          )}

          {firebaseModalOpen && (
            <AdminFirebaseModal
              workspace={workspace}
              onClose={() => setFirebaseModalOpen(false)}
              onSyncMetaUpdated={(meta) => {
                setWorkspace((prev) => (prev ? { ...prev, firebaseSync: meta } : prev));
              }}
              onWorkspaceRestored={loadWorkspace}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <main
      dir="rtl"
      className="min-h-screen bg-[#F7F7FC] dark:bg-slate-950 px-4 py-10 text-slate-900 dark:text-slate-100 flex items-center justify-center"
    >
      <section className="mx-auto w-full max-w-lg space-y-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#EEEAFF] dark:bg-violet-950/60 text-[#653CF5] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-display font-bold text-[#171A36] dark:text-white">
              بوابة دخول مدير المدرسة
            </h1>
          </div>
        </div>

        {access === 'loading' ? (
          <div
            role="status"
            className="flex items-center gap-3 p-4 rounded-2xl bg-[#F7F7FC] dark:bg-slate-800 text-sm font-medium"
          >
            <Loader2 className="w-5 h-5 animate-spin text-[#653CF5] shrink-0" />
            <span>{statusMessage || 'جاري التحقق من كود المدير وحساب Google…'}</span>
          </div>
        ) : (
          <form onSubmit={handleSubmitAdminGate} className="space-y-4">
            {/* Step 1: Principal Code Input (Mandatory condition) */}
            <div className="space-y-1.5">
              <label
                htmlFor="admin-gate-code-input"
                className="flex items-center gap-1.5 text-xs font-bold text-[#171A36] dark:text-slate-200"
              >
                <KeyRound className="w-3.5 h-3.5 text-[#653CF5]" />
                <span>
                  {adminCodeConfigured === false
                    ? 'تعيين كود المدير الأول (6 خانات على الأقل — مطلوب)'
                    : 'كود المدير (شرط الدخول)'}
                </span>
              </label>

              <div className="relative">
                <input
                  id="admin-gate-code-input"
                  dir="ltr"
                  type={showCode ? 'text' : 'password'}
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                  placeholder={
                    adminCodeConfigured === false
                      ? 'اكتب كود المدير الجديد (6 أحرف/أرقام أو أكثر)...'
                      : 'أدخل كود المدير...'
                  }
                  autoComplete="current-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="w-full min-h-[48px] pl-24 pr-3.5 rounded-2xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono-num focus:outline-none focus:ring-2 focus:ring-[#653CF5]"
                />
                <button
                  type="button"
                  onClick={() => setShowCode((s) => !s)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#EEEAFF] hover:bg-[#e1d9ff] dark:bg-slate-700 dark:hover:bg-slate-600 text-xs font-bold text-[#4320D9] dark:text-violet-200 cursor-pointer"
                  aria-label={showCode ? 'إخفاء الكود' : 'إظهار الكود'}
                >
                  {showCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  <span>{showCode ? 'إخفاء' : 'إظهار'}</span>
                </button>
              </div>
            </div>

            {/* Step 2: Connected Google Account or Sign-In Trigger */}
            {account && (
              <div className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>حساب Google جاهز لحفظ المدرسة:</span>
                  </div>
                  <p className="text-xs font-mono-num text-emerald-900 dark:text-emerald-200 truncate mt-0.5">
                    {account.email}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSignInWithDifferentGoogle()}
                  className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-800 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>تغيير الحساب</span>
                </button>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 space-y-2 text-xs text-red-700 dark:text-red-300"
              >
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>تعذّر الدخول إلى الإدارة</span>
                </div>
                <p className="leading-relaxed">{error}</p>
                {popupBlocked && (
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 text-white px-3 py-2 text-xs font-bold hover:bg-red-700"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>فتح التطبيق في نافذة جديدة لإتمام الدخول</span>
                  </a>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[48px] rounded-2xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 shadow-sm"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              <span>
                {busy
                  ? 'جاري تسجيل الدخول والتحقق…'
                  : account
                  ? 'دخول إلى لوحة الإدارة بهذا الحساب'
                  : 'تسجيل الدخول بحساب Google ودخول الإدارة'}
              </span>
            </button>

            {!account && !isRunningInIframe() && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void googleRedirectLogin()}
                className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                الدخول بإعادة التوجيه
              </button>
            )}
          </form>
        )}

        <button
          type="button"
          onClick={() => {
            clearSchoolSessionToken();
            onBack();
          }}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-[#653CF5] hover:underline cursor-pointer"
        >
          <ArrowRight className="w-4 h-4" />
          <span>العودة إلى صفحة المدرسة</span>
        </button>
      </section>
    </main>
  );
}
