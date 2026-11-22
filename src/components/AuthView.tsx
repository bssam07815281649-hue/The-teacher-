import React, { useState } from 'react';
import { BookOpen, Mic, CalendarCheck, Award, ArrowLeft } from 'lucide-react';
import { signInWithGoogle } from '../services/firebase';

export const AuthView: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imgFailed, setImgFailed] = useState(false);

  const handleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('popup-closed-by-user')) {
        setError('تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية.');
      } else {
        setError('تعذر تسجيل الدخول بحساب Google. تأكد من السماح بالنوافذ المنبثقة وحاول مجدداً.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="max-w-6xl w-full mx-auto px-4 sm:px-8 py-5 flex items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800">
        <span className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
          المعلم الذكي
        </span>
        <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
          مساعدك الدراسي الشخصي
        </span>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-10 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
        <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
          <div className="space-y-4">
            <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
              تطبيق «المعلم الذكي» — لتحسين وتعديل المستوى العلمي للطالب
            </p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-[42px] font-bold leading-tight text-slate-900 dark:text-white [text-wrap:balance]">
              معلمك الذكي لتحسين وتعديل مستواك العلمي صفحةً بصفحة
            </h1>
            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
              يهدف البرنامج إلى تحسين وتعديل المستوى العلمي للطالب وتشخيص نقاط الضعف في المواد والفصول الدراسية من خلال درجات المدرسة والاختبارات، ثم بناء خطة دراسية شخصية وشرح الكتاب صفحة بصفحة.
            </p>
            <div className="p-3.5 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs sm:text-sm text-blue-950 dark:text-blue-200 leading-relaxed">
              رسالتنا: متابعة مستواك الحقيقي في الصف الدراسي، وتحديد المواضيع التي تحتاج تقوية، والعمل معك على تحسين درجاتك وتثبيت فهمك العلمي في كل مادة.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 font-semibold text-sm">
                <BookOpen className="w-4 h-4 shrink-0" />
                <span>عرض سريع وقراءة بصرية ذكية</span>
              </div>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                افتح صفحات الكتاب فوراً بصورتها الأصلية دون انتظار، والمعلم يرى الصفحة ويشرحها معك بصرياً.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 font-semibold text-sm">
                <Mic className="w-4 h-4 shrink-0" />
                <span>اتصال صوتي مباشر مع المعلم</span>
              </div>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                تحدث مع المعلم صفحةً بصفحة أثناء عرض الكتاب، وقاطعه أو اسأله عن أي رسم أو مسألة مباشرة.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 text-teal-700 dark:text-teal-400 font-semibold text-sm">
                <CalendarCheck className="w-4 h-4 shrink-0" />
                <span>تحسين المستوى وسجل درجات الصف</span>
              </div>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                سجّل درجاتك المدرسية ليرتبها التطبيق ويحدد نقاط ضعفك ويبني خطة تقوية مخصصة لك.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 text-teal-700 dark:text-teal-400 font-semibold text-sm">
                <Award className="w-4 h-4 shrink-0" />
                <span>امتحانات شفهية وكتابية</span>
              </div>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                اختبر نفسك في أي فصل أو نطاق صفحات وراجع أخطاءك من مصدرها بالكتاب لرفع درجاتك.
              </p>
            </div>
          </div>

          <div className="pt-2 space-y-3">
            <button
              type="button"
              onClick={handleLogin}
              disabled={loading}
              className="w-full sm:w-auto min-h-[52px] px-7 py-3.5 rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-semibold text-base transition-all flex items-center justify-center gap-3 shadow-sm cursor-pointer disabled:opacity-60"
            >
              <span>{loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول بحساب Google'}</span>
              <ArrowLeft className="w-5 h-5" />
            </button>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              تُحفظ كتبك وملاحظاتك وتقدمك الدراسي بخصوصية تامة لتستعيدها من أي جهاز.
            </p>
            {error && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-sm"
              >
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-6 flex">
          <div className="w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 min-h-[280px] lg:min-h-[460px] flex items-center justify-center">
            {!imgFailed ? (
              <img
                src="/src/assets/images/tutor_welcome_hero_1794766024306.jpg"
                alt="مكتب دراسي هادئ يحتوي على كتب علمية مفتوحة ودفتر ملاحظات"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="p-8 text-center space-y-3">
                <BookOpen className="w-12 h-12 mx-auto text-blue-700 dark:text-blue-400" />
                <p className="font-display font-semibold text-lg text-slate-700 dark:text-slate-300">
                  بيئة دراسة متكاملة وهادئة
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
