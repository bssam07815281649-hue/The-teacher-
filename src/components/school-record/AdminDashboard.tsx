import { StaffPanel } from './StaffPanel';
import { Rankings } from './SectionInsights';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Building2,
  Check,
  Cloud,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileClock,
  FolderSync,
  HardDriveDownload,
  History,
  ImagePlus,
  KeyRound,
  Layers,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  ShieldAlert,
  Trash2,
  Upload,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  SchoolCodeStatus,
  SchoolWorkspacePayload,
} from '../../types';
import {
  createLocalBackupSnapshotApi,
  deleteSectionApi,
  deleteStageApi,
  exportSanitizedBackupApi,
  reorderStagesApi,
  restoreBackupApi,
  rotateAdminCodeApi,
  setCounselorCodeApi,
  updateFirebaseLinkApi,
  updateSchoolProfileApi,
  upsertSectionApi,
  upsertStageApi,
} from '../../services/schoolRecordClient';
import { auth } from '../../services/firebase';
import {
  syncWorkspaceToFirestore,
  testFirestoreConnectivity,
} from '../../services/schoolFirebaseSync';

interface AdminDashboardProps {
  workspace: SchoolWorkspacePayload;
  onWorkspaceRefresh: () => Promise<void>;
  onEnterSection: (sectionId: string) => void;
  onOpenFirebaseModal: () => void;
  onLogout: () => Promise<void>;
}

type AdminTab = 'profile' | 'structure' | 'audit_backup' | 'notices';

function compressImageFile(file: File, maxDim: number, maxKb: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('صيغة الصورة غير مدعومة.'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('تعذر معالجة الصورة.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        let quality = 0.85;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > maxKb * 1024 * 1.35 && quality > 0.35) {
          quality -= 0.12;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function generateReadableCode(prefix = 'CSL'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${suffix}`;
}

function codeStatusBadge(status: SchoolCodeStatus) {
  if (status === 'active') {
    return (
      <span className="px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900 text-[11px] font-bold">
        مفعّل
      </span>
    );
  }
  if (status === 'revoked') {
    return (
      <span className="px-2 py-0.5 rounded-lg bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900 text-[11px] font-bold">
        مُبطل
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[11px] font-bold">
      غير صادر
    </span>
  );
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  workspace,
  onWorkspaceRefresh,
  onEnterSection,
  onOpenFirebaseModal,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('structure');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  // Live Firestore indicator + Automatic per-Gmail Cloud Sync
  const [fbReachable, setFbReachable] = useState<boolean | null>(null);
  const [autoSyncLabel, setAutoSyncLabel] = useState('');
  const lastSyncFingerprintRef = useRef<string>('');
  const syncInFlightRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    void testFirestoreConnectivity(workspace.school.id).then((res) => {
      if (mounted) setFbReachable(res.reachable);
    });
    return () => {
      mounted = false;
    };
  }, [workspace.school.id, workspace.firebaseSync?.lastSyncedAt]);

  const syncFingerprint = useMemo(
    () =>
      JSON.stringify({
        school: {
          id: workspace.school.id,
          name: workspace.school.name,
          academicYear: workspace.school.academicYear,
          directorate: workspace.school.directorate,
          updatedAt: workspace.school.updatedAt,
        },
        announcements: workspace.announcements.map((a) => `${a.id}:${a.updatedAt}`),
        stages: workspace.stages.map((s) => `${s.id}:${s.orderIndex}:${s.name}`),
        sections: workspace.sections.map((s) => `${s.id}:${s.name}:${s.counselorName}:${s.counselorCodeStatus}`),
        students: workspace.students.map((st) => `${st.id}:${st.updatedAt}:${st.studentCodeStatus}`),
        absences: workspace.absences.map((ab) => ab.id),
        subjects: workspace.subjects.map((sb) => `${sb.id}:${sb.updatedAt}`),
        templates: workspace.templates.map((t) => t.id),
      }),
    [
      workspace.school,
      workspace.announcements,
      workspace.stages,
      workspace.sections,
      workspace.students,
      workspace.absences,
      workspace.subjects,
      workspace.templates,
    ]
  );

  useEffect(() => {
    const user = auth.currentUser;
    if (!user || user.isAnonymous || !user.emailVerified) return;
    if (!workspace.firebaseSync?.linked) return;
    const expectedEmail = (workspace.session.ownerEmail || workspace.firebaseSync.linkedEmail || '').trim().toLowerCase();
    const userEmail = (user.email || '').trim().toLowerCase();
    if (expectedEmail && userEmail !== expectedEmail) return;
    if (syncFingerprint === lastSyncFingerprintRef.current) return;

    const timer = window.setTimeout(() => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      lastSyncFingerprintRef.current = syncFingerprint;
      void syncWorkspaceToFirestore(workspace)
        .then(async (meta) => {
          setFbReachable(true);
          setAutoSyncLabel(`محفوظ على ${user.email}`);
          await updateFirebaseLinkApi(meta).catch(() => {});
        })
        .catch(() => {
          // Local server persistence remains unaffected if network/cloud is offline
        })
        .finally(() => {
          syncInFlightRef.current = false;
        });
    }, 1100);

    return () => window.clearTimeout(timer);
  }, [syncFingerprint, workspace]);

  // === Tab 1: School Profile & Announcements ===
  const [schoolName, setSchoolName] = useState(workspace.school.name);
  const [academicYear, setAcademicYear] = useState(workspace.school.academicYear);
  const [directorate, setDirectorate] = useState(workspace.school.directorate);
  const [overview, setOverview] = useState(workspace.school.overview);
  const [vision, setVision] = useState(workspace.school.vision);
  const [mission, setMission] = useState(workspace.school.mission);
  const [goals, setGoals] = useState<string[]>(workspace.school.goals || []);
  const [newGoal, setNewGoal] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState(workspace.school.logoDataUrl || '');
  const [coverDataUrl, setCoverDataUrl] = useState(workspace.school.coverDataUrl || '');

  useEffect(() => {
    setSchoolName(workspace.school.name);
    setAcademicYear(workspace.school.academicYear);
    setDirectorate(workspace.school.directorate);
    setOverview(workspace.school.overview);
    setVision(workspace.school.vision);
    setMission(workspace.school.mission);
    setGoals(workspace.school.goals || []);
    setLogoDataUrl(workspace.school.logoDataUrl || '');
    setCoverDataUrl(workspace.school.coverDataUrl || '');
  }, [workspace.school]);

  // === Tab 2: Stages, Sections & Counselors ===
  const [newStageName, setNewStageName] = useState('');
  const [editingStage, setEditingStage] = useState<{ id: string; name: string } | null>(null);
  const [confirmDeleteStageId, setConfirmDeleteStageId] = useState<string | null>(null);

  const [secStageId, setSecStageId] = useState(workspace.stages[0]?.id || '');
  const [secName, setSecName] = useState('');
  const [secCounselorName, setSecCounselorName] = useState('');
  const [editingSection, setEditingSection] = useState<{
    id: string;
    stageId: string;
    name: string;
    counselorName: string;
  } | null>(null);
  const [confirmDeleteSecId, setConfirmDeleteSecId] = useState<string | null>(null);

  // Counselor code issuance UI
  const [codeTargetSecId, setCodeTargetSecId] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [issuedCodeBanner, setIssuedCodeBanner] = useState<{
    sectionName: string;
    counselorName: string;
    code: string;
  } | null>(null);
  const [confirmRevokeSecId, setConfirmRevokeSecId] = useState<string | null>(null);
  const [copiedSecId, setCopiedSecId] = useState<string | null>(null);

  useEffect(() => {
    if (!secStageId && workspace.stages[0]) {
      setSecStageId(workspace.stages[0].id);
    }
  }, [workspace.stages, secStageId]);

  // === Tab 3: Audit, Backups & Admin Code ===
  const [auditRoleFilter, setAuditRoleFilter] = useState<string>('all');
  const [auditSearch, setAuditSearch] = useState('');
  const [confirmRestoreFile, setConfirmRestoreFile] = useState<string | null>(null);
  const [newAdminCode, setNewAdminCode] = useState('');
  const [showNewAdminCode, setShowNewAdminCode] = useState(true);
  const [confirmRotateAdmin, setConfirmRotateAdmin] = useState(false);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const sortedStages = useMemo(
    () => [...workspace.stages].sort((a, b) => a.orderIndex - b.orderIndex),
    [workspace.stages]
  );

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return workspace.auditLogs.filter((log) => {
      if (auditRoleFilter !== 'all' && log.actorRole !== auditRoleFilter) return false;
      if (!q) return true;
      return (
        log.actorName.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.targetLabel.toLowerCase().includes(q) ||
        log.nextValue.toLowerCase().includes(q)
      );
    });
  }, [workspace.auditLogs, auditRoleFilter, auditSearch]);

  const handleSaveSchoolProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await updateSchoolProfileApi({
        name: schoolName.trim(),
        academicYear: academicYear.trim(),
        directorate: directorate.trim(),
        overview: overview.trim(),
        vision: vision.trim(),
        mission: mission.trim(),
        goals: goals.filter((g) => g.trim()),
        logoDataUrl,
        coverDataUrl,
      });
      await onWorkspaceRefresh();
      notify('تم حفظ ملف المدرسة وهويتها بنجاح.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ ملف المدرسة.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStageName.trim()) return;
    setError('');
    setBusy(true);
    try {
      const created = await upsertStageApi({ name: newStageName.trim() });
      setNewStageName('');
      if (!secStageId) setSecStageId(created.id);
      await onWorkspaceRefresh();
      notify(`تمت إضافة الصف «${created.name}».`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة الصف.');
    } finally {
      setBusy(false);
    }
  };

  const handleMoveStage = async (stageId: string, dir: -1 | 1) => {
    const idx = sortedStages.findIndex((s) => s.id === stageId);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= sortedStages.length) return;
    const copy = [...sortedStages];
    [copy[idx], copy[swapIdx]] = [copy[swapIdx], copy[idx]];
    setError('');
    setBusy(true);
    try {
      await reorderStagesApi(copy.map((s) => s.id));
      await onWorkspaceRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إعادة ترتيب الصفوف.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secStageId || !secName.trim()) {
      setError('اختر الصف واكتب اسم الشعبة.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const created = await upsertSectionApi({
        stageId: secStageId,
        name: secName.trim(),
        counselorName: secCounselorName.trim() || 'مرشد الشعبة',
      });
      setSecName('');
      setSecCounselorName('');
      await onWorkspaceRefresh();
      notify(`تم إنشاء شعبة «${created.name}».`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الشعبة.');
    } finally {
      setBusy(false);
    }
  };

  const handleIssueCounselorCode = async (sectionId: string, sectionName: string, counselorName: string) => {
    const cleanCode = codeInput.trim();
    if (cleanCode.length < 4) {
      setError('يجب أن يتكون كود المرشد من 4 أحرف/أرقام على الأقل.');
      return;
    }
    const existingSec = workspace.sections.find((s) => s.id === sectionId);
    const action = existingSec?.counselorCodeStatus === 'active' ? 'change' : 'issue';
    setError('');
    setBusy(true);
    try {
      await setCounselorCodeApi(sectionId, action, cleanCode);
      setCodeTargetSecId(null);
      setCodeInput('');
      setIssuedCodeBanner({ sectionName, counselorName, code: cleanCode });
      await onWorkspaceRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إصدار كود المرشد.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeCounselorCode = async (sectionId: string) => {
    setError('');
    setBusy(true);
    try {
      await setCounselorCodeApi(sectionId, 'revoke');
      setConfirmRevokeSecId(null);
      await onWorkspaceRefresh();
      notify('تم إبطال كود المرشد وإنهاء جلساته النشطة فوراً.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إبطال الكود.');
    } finally {
      setBusy(false);
    }
  };

  const handleExportJson = async () => {
    setError('');
    try {
      const data = await exportSanitizedBackupApi();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `school-record-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('تم تصدير النسخة الآمنة (بدون أي أكواد أو تجزئات).');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تصدير النسخة الاحتياطية.');
    }
  };

  const handleUploadRestoreJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      await restoreBackupApi({ backupData: parsed });
      await onWorkspaceRefresh();
      notify('تمت استعادة البيانات من ملف JSON بنجاح.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل استعادة ملف النسخة الاحتياطية.');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-5">
      {/* Principal Top Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#EEEAFF] dark:bg-violet-950/60 text-[#653CF5] flex items-center justify-center shrink-0">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display font-extrabold text-lg text-[#171A36] dark:text-white">
                لوحة مدير المدرسة — {workspace.school.name}
              </h2>
              <span className="px-2.5 py-0.5 rounded-lg bg-[#653CF5] text-white text-[11px] font-bold">
                صلاحية المدير
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {workspace.session.ownerEmail || workspace.firebaseSync?.linkedEmail
                ? `حساب الإدارة والحفظ السحابي: ${workspace.session.ownerEmail || workspace.firebaseSync?.linkedEmail}${autoSyncLabel ? ` · ${autoSyncLabel}` : ''}`
                : 'إدارة ملف المدرسة، الصفوف والشعب، المرشدين والأكواد، سجل التدقيق، والنسخ الاحتياطي والمزامنة السحابية.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenFirebaseModal}
            className={`min-h-[40px] px-3.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
              workspace.firebaseSync?.linked && fbReachable !== false
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
                : 'bg-[#EEEAFF] dark:bg-slate-800 border-[#653CF5]/30 text-[#4320D9] dark:text-violet-300'
            }`}
          >
            {fbReachable ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            <Cloud className="w-4 h-4" />
            <span>
              {workspace.firebaseSync?.linked ? 'إعدادات Firebase (مربوط)' : 'ربط Firebase (Google)'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void onWorkspaceRefresh()}
            className="min-h-[40px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            title="تحديث البيانات"
          >
            <RefreshCw className="w-4 h-4 text-[#653CF5]" />
            <span>تحديث</span>
          </button>

          <button
            type="button"
            onClick={() => void onLogout()}
            className="min-h-[40px] px-3.5 rounded-xl border border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>خروج المدير</span>
          </button>
        </div>
      </div>

      {/* Navigation Sub-tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'structure', label: 'الصفوف والشعب والمرشدون', icon: Layers },
            { id:'notices',label:'تبليغات المرشدين',icon:BookOpen },
            { id: 'profile', label: 'ملف المدرسة', icon: Building2 },
            { id: 'audit_backup', label: 'سجل التدقيق والنسخ الاحتياطي والأمان', icon: History },
          ] as { id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }[]
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[44px] px-4 rounded-xl text-xs sm:text-sm font-bold border flex items-center gap-2 cursor-pointer ${
                active
                  ? 'bg-[#653CF5] text-white border-[#653CF5] shadow-xs'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs sm:text-sm text-red-700 dark:text-red-300 font-medium">
          {error}
        </div>
      )}
      {toast && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs sm:text-sm text-emerald-700 dark:text-emerald-300 font-bold">
          {toast}
        </div>
      )}

      {workspace.adminCodeConfigured === false && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 text-xs">
            <p className="font-extrabold text-amber-900 dark:text-amber-200">
              لم يتم تعيين كود دخول المدير حتى الآن
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('audit_backup')}
            className="min-h-[38px] px-3.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer shrink-0"
          >
            تعيين كود المدير الآن
          </button>
        </div>
      )}

      {issuedCodeBanner && (
        <div className="p-4 rounded-2xl bg-[#EEEAFF] dark:bg-violet-950/50 border border-[#653CF5] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs sm:text-sm font-extrabold text-[#4320D9] dark:text-violet-200">
              تم إصدار كود المرشد «{issuedCodeBanner.counselorName}» — شعبة {issuedCodeBanner.sectionName} (يُعرض مرة واحدة للنسخ):
            </span>
            <button
              type="button"
              onClick={() => setIssuedCodeBanner(null)}
              className="text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#653CF5]/40 font-mono-num text-base font-extrabold text-[#171A36] dark:text-white select-all">
              {issuedCodeBanner.code}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(issuedCodeBanner.code);
                notify('تم نسخ كود المرشد.');
              }}
              className="min-h-[36px] px-3 rounded-lg bg-[#653CF5] text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>نسخ الكود</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 1: SCHOOL PROFILE */}
      {activeTab === 'notices' && <StaffPanel mode="admin" workspace={workspace} refresh={onWorkspaceRefresh}/>}
      {activeTab === 'profile' && (
        <div className="max-w-3xl mx-auto">
          {/* School Profile Form */}
          <form
            onSubmit={handleSaveSchoolProfile}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4"
          >
            <h3 className="font-display font-bold text-base text-[#171A36] dark:text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#653CF5]" />
              <span>تعديل بيانات المدرسة والهوية العامة</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">اسم المدرسة</label>
                <input
                  type="text"
                  required
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">السنة الدراسية</label>
                <input
                  type="text"
                  required
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-mono-num"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">المديرية العامة للتربية</label>
              <input
                type="text"
                required
                value={directorate}
                onChange={(e) => setDirectorate(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
              />
            </div>

            {/* Logo & Cover Uploaders */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                <span className="text-xs font-bold block">شعار المدرسة</span>
                <div className="flex items-center gap-2">
                  {logoDataUrl && (
                    <img src={logoDataUrl} alt="الشعار" className="w-12 h-12 rounded-xl object-cover border" />
                  )}
                  <label className="flex-1 min-h-[38px] px-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer">
                    <ImagePlus className="w-4 h-4 text-[#653CF5]" />
                    <span>رفع شعار</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          setLogoDataUrl(await compressImageFile(f, 360, 180));
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'تعذر تحميل الشعار.');
                        }
                      }}
                    />
                  </label>
                  {logoDataUrl && (
                    <button
                      type="button"
                      onClick={() => setLogoDataUrl('')}
                      className="p-2 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                <span className="text-xs font-bold block">صورة الغلاف</span>
                <div className="flex items-center gap-2">
                  {coverDataUrl && (
                    <img src={coverDataUrl} alt="الغلاف" className="w-16 h-12 rounded-xl object-cover border" />
                  )}
                  <label className="flex-1 min-h-[38px] px-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer">
                    <ImagePlus className="w-4 h-4 text-[#653CF5]" />
                    <span>رفع غلاف</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          setCoverDataUrl(await compressImageFile(f, 1100, 260));
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'تعذر تحميل الغلاف.');
                        }
                      }}
                    />
                  </label>
                  {coverDataUrl && (
                    <button
                      type="button"
                      onClick={() => setCoverDataUrl('')}
                      className="p-2 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">نبذة عن المدرسة</label>
              <textarea
                rows={3}
                value={overview}
                onChange={(e) => setOverview(e.target.value)}
                className="w-full p-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">الرؤية</label>
                <textarea
                  rows={2}
                  value={vision}
                  onChange={(e) => setVision(e.target.value)}
                  className="w-full p-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">الرسالة</label>
                <textarea
                  rows={2}
                  value={mission}
                  onChange={(e) => setMission(e.target.value)}
                  className="w-full p-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>
            </div>

            {/* Dynamic Goals */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">الأهداف التربوية</label>
              <div className="space-y-1.5">
                {goals.map((g, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={g}
                      onChange={(e) => {
                        const copy = [...goals];
                        copy[i] = e.target.value;
                        setGoals(copy);
                      }}
                      className="flex-1 min-h-[38px] px-3 rounded-lg bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setGoals(goals.filter((_, idx) => idx !== i))}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newGoal}
                  onChange={(e) => setNewGoal(e.target.value)}
                  placeholder="أضف هدفاً جديداً..."
                  className="flex-1 min-h-[38px] px-3 rounded-lg bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newGoal.trim()) return;
                    setGoals([...goals, newGoal.trim()]);
                    setNewGoal('');
                  }}
                  className="min-h-[38px] px-3 rounded-lg bg-[#EEEAFF] dark:bg-slate-800 text-[#4320D9] dark:text-violet-300 text-xs font-bold cursor-pointer"
                >
                  إضافة هدف
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[46px] rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>حفظ ملف المدرسة</span>
            </button>
          </form>
        </div>
      )}

      {/* TAB 2: STAGES, SECTIONS & COUNSELORS */}
      {activeTab === 'structure' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Stages Column */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <h3 className="font-display font-bold text-base text-[#171A36] dark:text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-[#653CF5]" />
              <span>الصفوف والمراحل (قابلة لإعادة الترتيب)</span>
            </h3>

            <form onSubmit={handleAddStage} className="flex items-center gap-2">
              <input
                type="text"
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
                placeholder="اسم الصف (مثال: السادس الإعدادي)..."
                className="flex-1 min-h-[42px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
              />
              <button
                type="submit"
                disabled={busy || !newStageName.trim()}
                className="min-h-[42px] px-4 rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة صف</span>
              </button>
            </form>

            {sortedStages.length === 0 ? (
              <></>
            ) : (
              <div className="space-y-2">
                {sortedStages.map((stg, idx) => {
                  const stageSections = workspace.sections.filter(s => s.stageId === stg.id);
                  const sectionIds = new Set(stageSections.map(s => s.id));
                  const stageSecsCount = stageSections.length;
                  return (
                    <div
                      key={stg.id}
                      className="flex-wrap p-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2"
                    >
                      {editingStage?.id === stg.id ? (
                        <div className="flex-1 flex items-center gap-2">
                          <input
                            type="text"
                            value={editingStage.name}
                            onChange={(e) => setEditingStage({ ...editingStage, name: e.target.value })}
                            className="flex-1 min-h-[34px] px-2.5 rounded-lg bg-white dark:bg-slate-900 border text-xs font-bold"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              if (!editingStage.name.trim()) return;
                              await upsertStageApi({ id: stg.id, name: editingStage.name.trim() });
                              setEditingStage(null);
                              await onWorkspaceRefresh();
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                          >
                            حفظ
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingStage(null)}
                            className="px-2 py-1.5 rounded-lg border text-xs cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[#171A36] dark:text-white truncate">{stg.name}</p>
                            <p className="text-[11px] text-slate-500">{stageSecsCount} شعب</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              disabled={idx === 0 || busy}
                              onClick={() => void handleMoveStage(stg.id, -1)}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-30 cursor-pointer"
                              title="تحريك للأعلى"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === sortedStages.length - 1 || busy}
                              onClick={() => void handleMoveStage(stg.id, 1)}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-30 cursor-pointer"
                              title="تحريك للأسفل"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingStage({ id: stg.id, name: stg.name })}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-[#653CF5] cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            {confirmDeleteStageId === stg.id ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await deleteStageApi(stg.id);
                                    setConfirmDeleteStageId(null);
                                    await onWorkspaceRefresh();
                                  } catch (err) {
                                    setError(err instanceof Error ? err.message : 'تعذر حذف الصف.');
                                    setConfirmDeleteStageId(null);
                                  }
                                }}
                                className="px-2 py-1 rounded-lg bg-red-600 text-white text-[10px] font-bold cursor-pointer"
                              >
                                تأكيد
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteStageId(stg.id)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                      <div className="w-full"><Rankings sections={stageSections} students={workspace.students.filter(s=>sectionIds.has(s.sectionId))} subjects={workspace.subjects.filter(s=>sectionIds.has(s.sectionId))}/></div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sections & Counselors Column */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <h3 className="font-display font-bold text-base text-[#171A36] dark:text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-[#653CF5]" />
              <span>الشعب والمرشدون وإدارة الأكواد</span>
            </h3>

            <form
              onSubmit={handleCreateSection}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 p-3.5 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700"
            >
              <select
                value={secStageId}
                onChange={(e) => setSecStageId(e.target.value)}
                disabled={sortedStages.length === 0}
                className="sm:col-span-4 min-h-[40px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm"
              >
                {sortedStages.length === 0 ? (
                  <option value="">أضف صفاً أولاً</option>
                ) : (
                  sortedStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))
                )}
              </select>

              <input
                type="text"
                value={secName}
                onChange={(e) => setSecName(e.target.value)}
                placeholder="اسم الشعبة (مثل: أ)"
                className="sm:col-span-3 min-h-[40px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm"
              />

              <input
                type="text"
                value={secCounselorName}
                onChange={(e) => setSecCounselorName(e.target.value)}
                placeholder="اسم المرشد التربوي"
                className="sm:col-span-3 min-h-[40px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm"
              />

              <button
                type="submit"
                disabled={busy || sortedStages.length === 0 || !secName.trim()}
                className="sm:col-span-2 min-h-[40px] px-3 rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                إنشاء شعبة
              </button>
            </form>

            {workspace.sections.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">
                لا توجد شعب مسجلة.
              </p>
            ) : (
              <div className="space-y-3">
                {workspace.sections.map((sec) => {
                  const stage = workspace.stages.find((s) => s.id === sec.stageId);
                  const secStuCount = workspace.students.filter((s) => s.sectionId === sec.id).length;
                  const secSubjCount = workspace.subjects.filter((s) => s.sectionId === sec.id).length;

                  return (
                    <div
                      key={sec.id}
                      className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3"
                    >
                      {editingSection?.id === sec.id ? (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={editingSection.name}
                            onChange={(e) => setEditingSection({ ...editingSection, name: e.target.value })}
                            placeholder="اسم الشعبة"
                            className="min-h-[38px] px-3 rounded-lg bg-[#F7F7FC] dark:bg-slate-800 border text-xs font-bold"
                          />
                          <input
                            type="text"
                            value={editingSection.counselorName}
                            onChange={(e) =>
                              setEditingSection({ ...editingSection, counselorName: e.target.value })
                            }
                            placeholder="اسم المرشد"
                            className="min-h-[38px] px-3 rounded-lg bg-[#F7F7FC] dark:bg-slate-800 border text-xs font-bold"
                          />
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={async () => {
                                await upsertSectionApi({
                                  id: sec.id,
                                  stageId: editingSection.stageId,
                                  name: editingSection.name.trim(),
                                  counselorName: editingSection.counselorName.trim(),
                                });
                                setEditingSection(null);
                                await onWorkspaceRefresh();
                              }}
                              className="flex-1 min-h-[38px] rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                            >
                              حفظ
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSection(null)}
                              className="min-h-[38px] px-3 rounded-lg border text-xs cursor-pointer"
                            >
                              إلغاء
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2.5 py-0.5 rounded-lg bg-[#EEEAFF] dark:bg-violet-950/60 text-[#4320D9] dark:text-violet-300 text-xs font-bold">
                                {stage?.name || 'صف'}
                              </span>
                              <h4 className="font-display font-bold text-base text-[#171A36] dark:text-white">
                                شعبة {sec.name}
                              </h4>
                              {codeStatusBadge(sec.counselorCodeStatus)}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                              <span>
                                المرشد: <strong>{sec.counselorName || 'غير محدد'}</strong>
                              </span>
                              <span className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] dark:bg-slate-800">آخر حفظ وصل من المرشد: {sec.lastCounselorSavedAt ? new Date(sec.lastCounselorSavedAt).toLocaleString('ar-IQ') : 'لم تُحفظ تعديلات بعد'}</span>
                              {sec.counselorCodeStatus === 'active' &&
                                (sec.counselorAccessCode ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#EEEAFF] dark:bg-violet-950/60 border border-[#653CF5]/30 text-[#4320D9] dark:text-violet-200">
                                    <span className="text-[11px] font-semibold">كود الدخول:</span>
                                    <code
                                      dir="ltr"
                                      className="font-mono-num font-extrabold text-xs select-all text-[#171A36] dark:text-white"
                                    >
                                      {sec.counselorAccessCode}
                                    </code>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void navigator.clipboard?.writeText(sec.counselorAccessCode!);
                                        setCopiedSecId(sec.id);
                                        setTimeout(
                                          () => setCopiedSecId((prev) => (prev === sec.id ? null : prev)),
                                          2000
                                        );
                                        notify(`تم نسخ كود المرشد: ${sec.counselorAccessCode}`);
                                      }}
                                      className="px-2 py-0.5 rounded-md bg-[#653CF5] hover:bg-[#4320D9] text-white text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer"
                                      title="نسخ كود المرشد"
                                    >
                                      {copiedSecId === sec.id ? (
                                        <Check className="w-3 h-3" />
                                      ) : (
                                        <Copy className="w-3 h-3" />
                                      )}
                                      <span>{copiedSecId === sec.id ? 'نُسخ' : 'نسخ'}</span>
                                    </button>
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-700 dark:text-amber-300">
                                    كود صادر
                                  </span>
                                ))}
                              <span>
                                · <span className="font-mono-num">{secStuCount}</span> طالب ·{' '}
                                <span className="font-mono-num">{secSubjCount}</span> مادة
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onEnterSection(sec.id)}
                              className="min-h-[38px] px-3.5 rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                            >
                              <BookOpen className="w-3.5 h-3.5" />
                              <span>الدخول إلى الشعبة</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setCodeTargetSecId(sec.id);
                                setCodeInput(generateReadableCode('CSL'));
                              }}
                              className="min-h-[38px] px-3 rounded-xl bg-[#EEEAFF] dark:bg-slate-800 text-[#4320D9] dark:text-violet-300 text-xs font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                              <span>{sec.counselorCodeStatus === 'active' ? 'تغيير الكود' : 'إصدار كود'}</span>
                            </button>

                            {sec.counselorCodeStatus === 'active' &&
                              (confirmRevokeSecId === sec.id ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRevokeCounselorCode(sec.id)}
                                  className="min-h-[38px] px-2.5 rounded-xl bg-red-600 text-white text-xs font-bold cursor-pointer"
                                >
                                  تأكيد الإبطال
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmRevokeSecId(sec.id)}
                                  className="min-h-[38px] px-2.5 rounded-xl border border-amber-300 text-amber-700 dark:text-amber-300 text-xs font-semibold cursor-pointer"
                                >
                                  إبطال الكود
                                </button>
                              ))}

                            <button
                              type="button"
                              onClick={() =>
                                setEditingSection({
                                  id: sec.id,
                                  stageId: sec.stageId,
                                  name: sec.name,
                                  counselorName: sec.counselorName,
                                })
                              }
                              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-[#653CF5] cursor-pointer"
                              title="تعديل الشعبة أو اسم المرشد"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            {confirmDeleteSecId === sec.id ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  await deleteSectionApi(sec.id);
                                  setConfirmDeleteSecId(null);
                                  await onWorkspaceRefresh();
                                }}
                                className="min-h-[36px] px-2.5 rounded-xl bg-red-600 text-white text-xs font-bold cursor-pointer"
                              >
                                تأكيد الحذف
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteSecId(sec.id)}
                                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-600 cursor-pointer"
                                title="حذف الشعبة"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {codeTargetSecId === sec.id && (
                        <div className="p-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-[#653CF5]/30 flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={codeInput}
                            onChange={(e) => setCodeInput(e.target.value)}
                            placeholder="أدخل كود المرشد الجديد..."
                            className="flex-1 min-w-[160px] min-h-[38px] px-3 rounded-lg bg-white dark:bg-slate-900 border text-xs font-mono-num font-bold"
                          />
                          <button
                            type="button"
                            onClick={() => setCodeInput(generateReadableCode('CSL'))}
                            className="min-h-[38px] px-3 rounded-lg border text-xs font-semibold cursor-pointer"
                          >
                            توليد عشوائي
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void handleIssueCounselorCode(sec.id, sec.name, sec.counselorName)
                            }
                            className="min-h-[38px] px-3.5 rounded-lg bg-[#653CF5] text-white text-xs font-bold cursor-pointer"
                          >
                            اعتماد وحفظ الكود
                          </button>
                          <button
                            type="button"
                            onClick={() => setCodeTargetSecId(null)}
                            className="min-h-[38px] px-2.5 rounded-lg border text-xs cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: AUDIT LOGS, BACKUPS & ADMIN CODE ROTATION */}
      {activeTab === 'audit_backup' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Local Backups & Security */}
          <div className="lg:col-span-5 space-y-5">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
              <h3 className="font-display font-bold text-base text-[#171A36] dark:text-white flex items-center gap-2">
                <HardDriveDownload className="w-5 h-5 text-[#653CF5]" />
                <span>النسخ الاحتياطي المحلي واستمرارية العمل</span>
              </h3>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await createLocalBackupSnapshotApi();
                      await onWorkspaceRefresh();
                      notify('تم إنشاء لقطة احتياطية محلية آمنة على الخادم.');
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'تعذر إنشاء النسخة.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FolderSync className="w-4 h-4" />
                  <span>لقطة احتياطية الآن</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleExportJson()}
                  className="min-h-[42px] px-3.5 rounded-xl bg-[#EEEAFF] dark:bg-slate-800 text-[#4320D9] dark:text-violet-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>تصدير JSON آمن</span>
                </button>

                <label className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                  <Upload className="w-4 h-4 text-[#653CF5]" />
                  <span>استعادة JSON</span>
                  <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => void handleUploadRestoreJson(e)} />
                </label>
              </div>

              {workspace.backups.length > 0 && (
                <div className="space-y-2 pt-2">
                  <span className="text-xs font-bold text-slate-500">اللقطات المحفوظة على الخادم:</span>
                  {workspace.backups.slice(0, 8).map((b) => (
                    <div
                      key={b.fileName}
                      className="p-2.5 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-mono-num font-bold truncate">{b.fileName}</p>
                        <p className="text-[11px] text-slate-500 font-mono-num">
                          {new Date(b.createdAt).toLocaleString('ar-IQ')} · {Math.round(b.sizeBytes / 1024)} KB
                        </p>
                      </div>
                      {confirmRestoreFile === b.fileName ? (
                        <button
                          type="button"
                          onClick={async () => {
                            await restoreBackupApi({ fileName: b.fileName });
                            setConfirmRestoreFile(null);
                            await onWorkspaceRefresh();
                            notify('تمت استعادة اللقطة الاحتياطية.');
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-amber-600 text-white text-[11px] font-bold cursor-pointer"
                        >
                          تأكيد الاستعادة
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmRestoreFile(b.fileName)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>استعادة</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Rotate Principal Code */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3">
              <h3 className="font-display font-bold text-base text-[#171A36] dark:text-white flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-600" />
                <span>تغيير كود المدير</span>
              </h3>
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <input
                    dir="ltr"
                    type={showNewAdminCode ? 'text' : 'password'}
                    value={newAdminCode}
                    onChange={(e) => setNewAdminCode(e.target.value)}
                    placeholder="كود المدير الجديد (6 أحرف على الأقل)..."
                    autoCapitalize="none"
                    spellCheck={false}
                    className="w-full min-h-[40px] pr-3 pl-20 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono-num"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewAdminCode((v) => !v)}
                    className="absolute left-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#EEEAFF] dark:bg-slate-700 text-[11px] font-bold text-[#4320D9] dark:text-violet-200 cursor-pointer"
                    aria-label={showNewAdminCode ? 'إخفاء الكود' : 'إظهار الكود'}
                  >
                    {showNewAdminCode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showNewAdminCode ? 'إخفاء' : 'إظهار'}</span>
                  </button>
                </div>
                {!confirmRotateAdmin ? (
                  <button
                    type="button"
                    disabled={newAdminCode.trim().length < 6}
                    onClick={() => setConfirmRotateAdmin(true)}
                    className="min-h-[40px] px-3.5 rounded-xl bg-[#171A36] text-white text-xs font-bold cursor-pointer disabled:opacity-40"
                  >
                    تغيير الكود
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      await rotateAdminCodeApi(newAdminCode.trim());
                      await onLogout();
                    }}
                    className="min-h-[40px] px-3.5 rounded-xl bg-red-600 text-white text-xs font-bold cursor-pointer"
                  >
                    تأكيد والخروج
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Audit Logs */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="font-display font-bold text-base text-[#171A36] dark:text-white flex items-center gap-2">
                <FileClock className="w-5 h-5 text-[#653CF5]" />
                <span>سجل التدقيق غير القابل للتعديل ({filteredAuditLogs.length})</span>
              </h3>
              <div className="flex items-center gap-2">
                <select
                  value={auditRoleFilter}
                  onChange={(e) => setAuditRoleFilter(e.target.value)}
                  className="min-h-[36px] px-2.5 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                >
                  <option value="all">كل الأدوار</option>
                  <option value="admin">المدير</option>
                  <option value="counselor">المرشد</option>
                  <option value="student">الطالب</option>
                </select>
                <input
                  type="search"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="بحث في السجل..."
                  className="min-h-[36px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                />
              </div>
            </div>

            <div className="space-y-2 max-h-[540px] overflow-y-auto thin-scrollbar">
              {filteredAuditLogs.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">لا توجد قيود مطابقة في سجل التدقيق.</p>
              ) : (
                filteredAuditLogs.slice(0, 120).map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded bg-[#EEEAFF] dark:bg-violet-950/60 text-[#4320D9] dark:text-violet-300 font-bold text-[10px]">
                          {log.actorRole === 'admin' ? 'مدير' : log.actorRole === 'counselor' ? 'مرشد' : log.actorRole === 'student' ? 'طالب' : 'نظام'}
                        </span>
                        <span className="font-bold text-[#171A36] dark:text-white">{log.actorName}</span>
                        <span className="text-slate-500">·</span>
                        <span className="font-semibold text-[#653CF5]">{log.action}</span>
                        {log.targetLabel && <span className="text-slate-600 dark:text-slate-300">({log.targetLabel})</span>}
                      </div>
                      <span className="font-mono-num text-[11px] text-slate-400">
                        {new Date(log.timestamp).toLocaleString('ar-IQ')}
                      </span>
                    </div>
                    {(log.prevValue || log.nextValue) && (
                      <div className="text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap gap-x-3 gap-y-0.5">
                        {log.prevValue && <span>السابق: {log.prevValue}</span>}
                        {log.nextValue && <span>الجديد: {log.nextValue}</span>}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
