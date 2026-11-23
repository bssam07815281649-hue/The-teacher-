import React, { useState } from 'react';
import { X, Sun, Moon, LogOut, Trash2, Volume2, Type as TypeIcon, Globe, GraduationCap } from 'lucide-react';
import type { ThemeMode, TutorLanguage, UserProfile } from '../types';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  profile: UserProfile;
  onUpdateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  onSignOut: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  profile,
  onUpdateProfile,
  onSignOut,
  onDeleteAccount,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [gradeDraft, setGradeDraft] = useState(profile.gradeLevel || '');

  if (!open) return null;

  const handleDeleteAll = async () => {
    setError('');
    setDeleting(true);
    try {
      await onDeleteAccount();
    } catch {
      setError('لأسباب أمنية، قد يتطلب حذف الحساب إعادة تسجيل الدخول مؤخراً. جرّب الخروج ثم الدخول وإعادة المحاولة.');
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="إعدادات الحساب والدراسة"
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-display font-bold text-lg text-slate-900 dark:text-white">
            الإعدادات والحساب
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            aria-label="إغلاق الإعدادات"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6 overflow-y-auto thin-scrollbar">
          {/* Student info */}
          <div className="flex items-center gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
            {profile.photoURL ? (
              <img
                src={profile.photoURL}
                alt={profile.displayName}
                referrerPolicy="no-referrer"
                className="w-12 h-12 rounded-full object-cover border border-slate-200 dark:border-slate-700"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-lg">
                {(profile.displayName || 'ط')[0]}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900 dark:text-white truncate">{profile.displayName}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{profile.email}</p>
            </div>
          </div>

          {/* Language & Dialect */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
              <Globe className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              <span>لغة ولهجة شرح المعلم</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'ar-msa', label: 'العربية الفصحى' },
                  { id: 'ar-iq', label: 'اللهجة العراقية' },
                  { id: 'en', label: 'English' },
                ] as { id: TutorLanguage; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => void onUpdateProfile({ tutorLanguage: opt.id })}
                  className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                    profile.tutorLanguage === opt.id
                      ? 'bg-blue-700 text-white border-blue-700'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Theme */}
          <div className="space-y-2">
            <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
              مظهر القراءة
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'light', label: 'نهاري ورقي', icon: Sun },
                  { id: 'dark', label: 'ليلي هادئ', icon: Moon },
                ] as { id: ThemeMode; label: string; icon: typeof Sun }[]
              ).map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => void onUpdateProfile({ theme: opt.id })}
                    className={`min-h-[44px] px-3 py-2 rounded-xl text-sm font-medium border flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                      profile.theme === opt.id
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Font size */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
                <TypeIcon className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                <span>حجم خط النصوص</span>
              </span>
              <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
                {profile.fontSize} px
              </span>
            </div>
            <input
              type="range"
              min={15}
              max={28}
              step={1}
              value={profile.fontSize}
              onChange={(e) => void onUpdateProfile({ fontSize: Number(e.target.value) })}
              className="w-full accent-blue-700 cursor-pointer"
            />
          </div>

          {/* Voice selection */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
              <Volume2 className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              <span>صوت المعلم الذكي</span>
            </label>
            <select
              value={profile.voiceName || 'Zephyr'}
              onChange={(e) => void onUpdateProfile({ voiceName: e.target.value })}
              className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white"
            >
              <option value="Zephyr">Zephyr (هادئ وواضح)</option>
              <option value="Kore">Kore (دافئ ومتزن)</option>
              <option value="Puck">Puck (حيوي ونشيط)</option>
              <option value="Charon">Charon (عميق ووقور)</option>
              <option value="Fenrir">Fenrir (قوي ومباشر)</option>
            </select>
          </div>

          {/* Grade level */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
              <GraduationCap className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              <span>المرحلة الدراسية (اختياري)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={gradeDraft}
                onChange={(e) => setGradeDraft(e.target.value)}
                placeholder="مثال: السادس الإعدادي أو المرحلة الجامعية"
                className="flex-1 min-h-[44px] px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => void onUpdateProfile({ gradeLevel: gradeDraft.trim() })}
                className="min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-sm font-medium cursor-pointer"
              >
                حفظ
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 p-3 rounded-lg">
              {error}
            </p>
          )}

          {/* Account Actions */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="w-full min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>{profile.uid === 'guest_local' ? 'العودة إلى بوابة المدرسة' : 'تسجيل الخروج'}</span>
            </button>

            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="w-full min-h-[44px] px-4 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-sm font-medium flex items-center justify-center gap-2 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>
                  {profile.uid === 'guest_local'
                    ? 'مسح جميع البيانات المحفوظة محلياً'
                    : 'حذف جميع البيانات والحساب'}
                </span>
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 space-y-2">
                <p className="text-xs text-red-700 dark:text-red-300 font-medium">
                  سيتم حذف كافة كتبك وملاحظاتك وخططك وامتحاناتك نهائياً. هل أنت متأكد؟
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => void handleDeleteAll()}
                    className="flex-1 min-h-[40px] rounded-lg bg-red-600 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                  >
                    {deleting ? 'جاري الحذف...' : 'نعم، احذف نهائياً'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 min-h-[40px] rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
