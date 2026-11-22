import { useEffect, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth } from '../services/firebase';

type AccessState = 'loading' | 'signed-out' | 'authorized' | 'denied';

export function AdminGate({ onBack }: { onBack: () => void }) {
  const [access, setAccess] = useState<AccessState>('loading');
  const [account, setAccount] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => onAuthStateChanged(auth, async (user) => {
    setAccount(user);
    if (!user || user.isAnonymous) {
      setAccess('signed-out');
      return;
    }
    setAccess('loading');
    try {
      // An email address alone is NOT enough; Firebase Admin must grant
      // the schoolRole=admin claim to the single approved Google account.
      const token = await user.getIdTokenResult(true);
      const isGoogle = user.providerData.some(p => p.providerId === 'google.com');
      setAccess(isGoogle && token.claims.schoolRole === 'admin' ? 'authorized' : 'denied');
    } catch {
      setAccess('denied');
      setError('تعذّر التحقق من صلاحية الإدارة. تحقق من الاتصال وحاول مجدداً.');
    }
  }), []);

  async function googleLogin() {
    setBusy(true);
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error('Google administrator sign-in:', err);
      setError('تعذّر تسجيل الدخول عبر Google. تحقق من السماح بالنوافذ المنبثقة وتفعيل Google في Firebase.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <section className="mx-auto max-w-lg space-y-5 rounded-2xl bg-white p-6 shadow-md">
        <h1 className="text-2xl font-bold">لوحة مدير المدرسة</h1>
        {access === 'loading' && <p role="status">جاري التحقق من صلاحيات حساب Google…</p>}
        {access === 'signed-out' && <>
          <p>هذه الصفحة لا تعرض بيانات المدرسة إلا بعد تسجيل دخول المدير بحساب Google المصرّح له.</p>
          <button type="button" disabled={busy} onClick={() => void googleLogin()} className="rounded-lg bg-blue-700 px-4 py-3 text-white disabled:opacity-60">
            {busy ? 'جاري تسجيل الدخول…' : 'تسجيل الدخول بحساب Google'}
          </button>
        </>}
        {access === 'denied' && <>
          <p role="alert" className="text-red-700">هذا الحساب غير مصرح له بإدارة المدرسة. لن تُعرض أي بيانات أو أدوات إدارية.</p>
          <button type="button" onClick={() => void signOut(auth)} className="rounded-lg bg-slate-200 px-4 py-2">تسجيل الخروج واختيار حساب آخر</button>
        </>}
        {access === 'authorized' && <>
          <p className="text-green-800">تم التحقق من حساب المدير عبر Google وصلاحية Firebase.</p>
          <p>منطقة الإدارة جاهزة للربط ببيانات المدرسة. عمليات الإضافة والتعديل والحذف لا تُفعّل قبل تطبيق قواعد Firebase الخاصة بالمدير.</p>
          <button type="button" onClick={() => void signOut(auth)} className="rounded-lg bg-slate-200 px-4 py-2">تسجيل الخروج</button>
        </>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="button" onClick={onBack} className="block text-sm underline">العودة إلى صفحة المدرسة</button>
      </section>
    </main>
  );
}
