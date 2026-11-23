import React, { useEffect, useState } from 'react';
import { CheckCircle2, Cloud, CloudDownload, Loader2, RefreshCw, Unlink, Wifi, WifiOff, X } from 'lucide-react';
import type { SchoolFirebaseSyncMeta, SchoolWorkspacePayload } from '../../types';
import {
  linkGoogleForPrincipal,
  restoreWorkspaceFromFirestore,
  syncWorkspaceToFirestore,
  testFirestoreConnectivity,
} from '../../services/schoolFirebaseSync';
import { restoreBackupApi, updateFirebaseLinkApi } from '../../services/schoolRecordClient';

interface AdminFirebaseModalProps {
  workspace: SchoolWorkspacePayload;
  onClose: () => void;
  onSyncMetaUpdated: (meta: SchoolFirebaseSyncMeta) => void;
  onWorkspaceRestored?: () => Promise<void>;
}

export const AdminFirebaseModal: React.FC<AdminFirebaseModalProps> = ({
  workspace,
  onClose,
  onSyncMetaUpdated,
  onWorkspaceRestored,
}) => {
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [liveStatus, setLiveStatus] = useState<{
    reachable: boolean;
    projectId: string;
    message: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const runCheck = async () => {
    setChecking(true);
    setError('');
    try {
      const res = await testFirestoreConnectivity(workspace.school.id);
      setLiveStatus(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر فحص الاتصال بـ Firebase.');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void runCheck();
  }, [workspace.school.id]);

  const handleLinkAndSync = async () => {
    setSyncing(true);
    setError('');
    setSuccessMsg('');
    try {
      const linked = await linkGoogleForPrincipal();
      const syncedMeta = await syncWorkspaceToFirestore(workspace);
      const saved = await updateFirebaseLinkApi({
        ...syncedMeta,
        linkedUid: linked.uid,
        linkedEmail: linked.email,
        projectId: linked.projectId,
      });
      onSyncMetaUpdated(saved);
      setSuccessMsg(`تمت مزامنة المدرسة على حساب ${linked.email} بنجاح.`);
      await runCheck();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر الربط أو المزامنة مع Firestore.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncOnly = async () => {
    setSyncing(true);
    setError('');
    setSuccessMsg('');
    try {
      const syncedMeta = await syncWorkspaceToFirestore(workspace);
      const saved = await updateFirebaseLinkApi(syncedMeta);
      onSyncMetaUpdated(saved);
      setSuccessMsg('تم تحديث النسخة السحابية للمدرسة على نفس الجيميل.');
      await runCheck();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر المزامنة الآن. يمكنك ربط حساب Google مجدداً.');
    } finally {
      setSyncing(false);
    }
  };

  const handleRestoreFromCloud = async () => {
    setSyncing(true);
    setError('');
    setSuccessMsg('');
    try {
      const cloudBackup = await restoreWorkspaceFromFirestore(workspace.school.id);
      if (!cloudBackup) {
        setError('لا توجد نسخة محفوظة لهذه المدرسة على هذا الحساب السحابي بعد.');
        return;
      }
      await restoreBackupApi({ backupData: cloudBackup });
      if (onWorkspaceRestored) {
        await onWorkspaceRestored();
      }
      setSuccessMsg('تمت استعادة بيانات المدرسة والشعب والطلبة والدرجات من سحابة Gmail بنجاح.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر استعادة البيانات من سحابة Gmail.');
    } finally {
      setSyncing(false);
    }
  };

  const handleUnlink = async () => {
    setSyncing(true);
    setError('');
    setSuccessMsg('');
    try {
      const saved = await updateFirebaseLinkApi({
        linked: false,
        lastSyncStatus: 'idle',
        lastSyncMessage: 'تم فصل المزامنة السحابية (العمل المحلي الخادمي مستمر)',
      });
      onSyncMetaUpdated(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث حالة الربط.');
    } finally {
      setSyncing(false);
    }
  };

  const meta = workspace.firebaseSync;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#EEEAFF] dark:bg-violet-950/60 text-[#653CF5] flex items-center justify-center">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-[#171A36] dark:text-white">
                إعدادات Firebase والمزامنة (للمدير فقط)
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                ربط مشروع المدرسة بحساب Google ومراقبة الاتصال الفعلي
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300 font-bold">
              {successMsg}
            </div>
          )}

          {/* Real Live Connectivity Indicator */}
          <div className="p-4 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#171A36] dark:text-white flex items-center gap-2">
                {liveStatus?.reachable ? (
                  <Wifi className="w-4 h-4 text-emerald-600" />
                ) : (
                  <WifiOff className="w-4 h-4 text-amber-600" />
                )}
                حالة الاتصال الفعلي بـ Firestore
              </span>
              <button
                type="button"
                onClick={() => void runCheck()}
                disabled={checking}
                className="text-xs font-semibold text-[#653CF5] hover:underline flex items-center gap-1 cursor-pointer"
              >
                {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                <span>فحص الآن</span>
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {checking ? 'جاري اختبار الاتصال بالخادم السحابي...' : liveStatus?.message || '—'}
            </p>
            {liveStatus?.projectId && (
              <p className="text-[11px] text-slate-500 font-mono-num">
                Project ID: {liveStatus.projectId}
              </p>
            )}
          </div>

          {/* Current Link Metadata */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">حالة الربط الإداري:</span>
              <span
                className={`font-bold inline-flex items-center gap-1 ${
                  meta.linked ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {meta.linked && <CheckCircle2 className="w-3.5 h-3.5" />}
                {meta.linked ? 'مربوط بحساب Google' : 'غير مربوط بعد'}
              </span>
            </div>
            {meta.linkedEmail && (
              <div className="flex items-center justify-between">
                <span className="text-slate-500">البريد الإداري:</span>
                <span className="font-mono-num font-semibold text-[#171A36] dark:text-white">{meta.linkedEmail}</span>
              </div>
            )}
            {meta.lastSyncedAt && (
              <div className="flex items-center justify-between">
                <span className="text-slate-500">آخر مزامنة:</span>
                <span className="font-mono-num text-slate-700 dark:text-slate-200">
                  {new Date(meta.lastSyncedAt).toLocaleString('ar-IQ')}
                </span>
              </div>
            )}
            <p className="text-[11px] text-slate-500 pt-1">{meta.lastSyncMessage}</p>
          </div>

          <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900 p-3 rounded-xl leading-relaxed">
            <strong>ملاحظة الأمان والاستمرارية:</strong> لا يتم رفع أي أكواد دخول أو تجزئات سرية إلى Firestore مطلقاً. كما يستمر عمل المرشدين والطلبة عبر الخادم الآمن والنسخ المحلية حتى بعد خروج المدير أو انقطاع الشبكة.
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              disabled={syncing}
              onClick={() => void handleLinkAndSync()}
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
              <span>{meta.linked ? 'تأكيد Google والمزامنة' : 'ربط حساب Google ومزامنة'}</span>
            </button>

            <button
              type="button"
              disabled={syncing}
              onClick={() => void handleRestoreFromCloud()}
              className="min-h-[44px] px-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <CloudDownload className="w-4 h-4" />
              <span>استعادة من Gmail</span>
            </button>

            {meta.linked && (
              <>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => void handleSyncOnly()}
                  className="min-h-[44px] px-4 rounded-xl bg-[#EEEAFF] dark:bg-slate-800 text-[#4320D9] dark:text-violet-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>مزامنة فورية</span>
                </button>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => void handleUnlink()}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>فصل</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
