import { Rankings, Observations } from './SectionInsights';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarX2,
  Check,
  Copy,
  Download,
  Edit3,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  SchoolCodeStatus,
  SchoolStudent,
  SchoolStudentStatus,
  SchoolWorkspacePayload,
  SmartImportTarget,
  StudentAbsence,
} from '../../types';
import {
  bulkIssueStudentCodesApi,
  deleteAbsenceApi,
  deleteStudentApi,
  setStudentCodeApi,
  upsertAbsenceApi,
  upsertStudentApi,
} from '../../services/schoolRecordClient';
import { generateStudentCodesA4Pdf, type A4PdfExportResult } from '../../services/a4PdfExport';
import { SubjectGradebookEditor } from './SubjectGradebookEditor';
import { SmartSheetImportWizard } from './SmartSheetImportWizard';

interface CounselorWorkspaceProps {
  workspace: SchoolWorkspacePayload;
  sectionId: string;
  onWorkspaceRefresh: () => Promise<void>;
  onBackToAdmin?: () => void;
  onLogout: () => Promise<void>;
}

type CounselorTab = 'students' | 'absences' | 'gradebooks' | 'import_pdf';

function generateStudentCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `STU-${suffix}`;
}

function studentStatusLabel(status: SchoolStudentStatus): { label: string; cls: string } {
  if (status === 'active') {
    return {
      label: 'مستمر',
      cls: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
    };
  }
  if (status === 'transferred') {
    return {
      label: 'منقول',
      cls: 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-900',
    };
  }
  return {
    label: 'موقوف',
    cls: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  };
}

function codeStatusLabel(status: SchoolCodeStatus): string {
  if (status === 'active') return 'الكود مفعّل';
  if (status === 'revoked') return 'الكود مُبطل';
  return 'بدون كود';
}

const EXCUSE_LABELS: Record<StudentAbsence['excuseType'], string> = {
  unexcused: 'بدون عذر',
  excused: 'بعذر مقبول',
  medical: 'إجازة مرضية',
  official: 'مهمة رسمية',
};

export const CounselorWorkspace: React.FC<CounselorWorkspaceProps> = ({
  workspace,
  sectionId,
  onWorkspaceRefresh,
  onBackToAdmin,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<CounselorTab>('students');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  // Student CRUD state
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentStatus, setNewStudentStatus] = useState<SchoolStudentStatus>('active');
  const [newStudentNotes, setNewStudentNotes] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [editingStudent, setEditingStudent] = useState<{
    id: string;
    fullName: string;
    status: SchoolStudentStatus;
    notes: string;
  } | null>(null);
  const [confirmDeleteStudentId, setConfirmDeleteStudentId] = useState<string | null>(null);

  // Student Code Issue UI
  const [codeTargetStudentId, setCodeTargetStudentId] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [issuedStudentCodeBanner, setIssuedStudentCodeBanner] = useState<{
    fullName: string;
    code: string;
  } | null>(null);
  const [confirmRevokeStudentId, setConfirmRevokeStudentId] = useState<string | null>(null);
  const [copiedStudentId, setCopiedStudentId] = useState<string | null>(null);
  const [bulkIssuingCodes, setBulkIssuingCodes] = useState(false);

  // 20-students-per-A4-page printable codes sheet modal
  const [codesA4Preview, setCodesA4Preview] = useState<A4PdfExportResult | null>(null);
  const [codesA4DownloadUrl, setCodesA4DownloadUrl] = useState('');
  const [printableCount, setPrintableCount] = useState(0);

  // Direct import target launched from inside a subject sub-record
  const [importTarget, setImportTarget] = useState<SmartImportTarget | null>(null);

  useEffect(() => {
    if (!codesA4Preview) {
      setCodesA4DownloadUrl('');
      return;
    }
    const url = URL.createObjectURL(codesA4Preview.pdfBlob);
    setCodesA4DownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [codesA4Preview]);

  // Absences CRUD state
  const [absStudentId, setAbsStudentId] = useState('');
  const [absDate, setAbsDate] = useState(new Date().toISOString().slice(0, 10));
  const [absExcuse, setAbsExcuse] = useState<StudentAbsence['excuseType']>('unexcused');
  const [absSubject, setAbsSubject] = useState('');
  const [absNotes, setAbsNotes] = useState('');
  const [absFilterStudentId, setAbsFilterStudentId] = useState('all');
  const [confirmDeleteAbsId, setConfirmDeleteAbsId] = useState<string | null>(null);

  const section = useMemo(
    () => workspace.sections.find((s) => s.id === sectionId) || workspace.sections[0],
    [workspace.sections, sectionId]
  );

  const stage = useMemo(
    () => workspace.stages.find((st) => st.id === section?.stageId),
    [workspace.stages, section]
  );

  const sectionStudents = useMemo(
    () => workspace.students.filter((s) => s.sectionId === section?.id),
    [workspace.students, section]
  );

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return sectionStudents;
    return sectionStudents.filter((s) => s.fullName.toLowerCase().includes(q));
  }, [sectionStudents, studentSearch]);

  const sectionSubjects = useMemo(
    () => workspace.subjects.filter((s) => s.sectionId === section?.id),
    [workspace.subjects, section]
  );

  const sectionAbsences = useMemo(() => {
    return workspace.absences
      .filter((a) => a.sectionId === section?.id)
      .filter((a) => absFilterStudentId === 'all' || a.studentId === absFilterStudentId)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [workspace.absences, section, absFilterStudentId]);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3200);
  };

  if (!section) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">لم يتم العثور على الشعبة المطلوبة.</p>
        {onBackToAdmin && (
          <button
            type="button"
            onClick={onBackToAdmin}
            className="min-h-[40px] px-4 rounded-xl bg-[#653CF5] text-white text-xs font-bold cursor-pointer"
          >
            العودة للوحة المدير
          </button>
        )}
      </div>
    );
  }

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudentName.trim()) {
      setError('أدخل اسم الطالب الثلاثي أو الرباعي.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const created = await upsertStudentApi(section.id, {
        fullName: newStudentName.trim(),
        status: newStudentStatus,
        notes: newStudentNotes.trim(),
      });
      setNewStudentName('');
      setNewStudentNotes('');
      await onWorkspaceRefresh();
      notify(`تمت إضافة الطالب «${created.fullName}».`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة الطالب.');
    } finally {
      setBusy(false);
    }
  };

  const handleIssueStudentCode = async (stu: SchoolStudent) => {
    const clean = codeInput.trim();
    if (clean.length < 4) {
      setError('كود الطالب يجب أن يكون 4 أحرف/أرقام على الأقل.');
      return;
    }
    const action = stu.studentCodeStatus === 'active' ? 'change' : 'issue';
    setError('');
    setBusy(true);
    try {
      await setStudentCodeApi(section.id, stu.id, action, clean);
      setCodeTargetStudentId(null);
      setCodeInput('');
      setIssuedStudentCodeBanner({ fullName: stu.fullName, code: clean });
      await onWorkspaceRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إصدار كود الطالب.');
    } finally {
      setBusy(false);
    }
  };

  const handleBulkIssueStudentCodes = async () => {
    setError('');
    setBulkIssuingCodes(true);
    try {
      const res = await bulkIssueStudentCodesApi(section.id, 'missing_only');
      await onWorkspaceRefresh();
      if (res.issuedCount > 0) {
        notify(`تم إصدار ${res.issuedCount} كوداً جديداً للطلبة بنجاح.`);
      } else {
        notify('جميع الطلبة النشطين لديهم أكواد فعّالة وقابلة للطباعة بالفعل.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة أكواد للطلبة.');
    } finally {
      setBulkIssuingCodes(false);
    }
  };

  const handleOpenPrintCodesA4 = () => {
    setError('');
    const printable = sectionStudents
      .filter((st) => st.status === 'active' && st.studentCodeStatus === 'active' && Boolean(st.studentAccessCode))
      .map((st) => ({
        fullName: st.fullName,
        code: st.studentAccessCode!,
      }));

    if (printable.length === 0) {
      setError('لا توجد أكواد فعّالة ظاهرة للطباعة بعد. اضغط «إضافة أكواد لجميع الطلاب» أولاً.');
      return;
    }

    const result = generateStudentCodesA4Pdf({
      schoolName: workspace.school.name,
      directorate: workspace.school.directorate,
      academicYear: workspace.school.academicYear,
      sectionLabel: `${stage ? stage.name + ' — ' : ''}شعبة ${section.name}`,
      students: printable,
    });
    setPrintableCount(printable.length);
    setCodesA4Preview(result);
  };

  const handlePrintA4InHiddenFrame = (preview: A4PdfExportResult) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      return;
    }

    doc.open();
    doc.close();

    const styleEl = doc.createElement('style');
    styleEl.textContent = `
      @page { size: A4 portrait; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; }
      .a4-page { page-break-after: always; width: 210mm; height: 297mm; display: flex; align-items: center; justify-content: center; }
      .a4-page:last-child { page-break-after: auto; }
      .a4-page img { width: 100%; height: 100%; object-fit: contain; display: block; }
    `;
    doc.head.appendChild(styleEl);

    for (const src of preview.previewPages) {
      const pageDiv = doc.createElement('div');
      pageDiv.className = 'a4-page';
      const img = doc.createElement('img');
      img.src = src;
      pageDiv.appendChild(img);
      doc.body.appendChild(pageDiv);
    }

    window.setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      window.setTimeout(() => iframe.remove(), 5000);
    }, 350);
  };

  const handleAddAbsence = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetStuId = absStudentId || sectionStudents[0]?.id;
    if (!targetStuId) {
      setError('أضف طالباً أولاً لتسجيل الغياب.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await upsertAbsenceApi(section.id, {
        studentId: targetStuId,
        date: absDate,
        excuseType: absExcuse,
        subjectName: absSubject.trim(),
        notes: absNotes.trim(),
      });
      setAbsSubject('');
      setAbsNotes('');
      await onWorkspaceRefresh();
      notify('تم تسجيل الغياب في سجل الشعبة.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الغياب.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Section Header (Counselor Name Read-Only for Counselor) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#EEEAFF] dark:bg-violet-950/60 text-[#653CF5] flex items-center justify-center shrink-0">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display font-extrabold text-lg text-[#171A36] dark:text-white">
                {stage?.name || 'الصف'} — شعبة {section.name}
              </h2>
              <span className="px-2.5 py-0.5 rounded-lg bg-[#EEEAFF] dark:bg-violet-950/60 text-[#4320D9] dark:text-violet-300 text-xs font-bold">
                المرشد: {section.counselorName || 'غير مسمى'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onWorkspaceRefresh()}
            className="min-h-[40px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 text-[#653CF5]" />
            <span>تحديث</span>
          </button>

          {onBackToAdmin ? (
            <button
              type="button"
              onClick={onBackToAdmin}
              className="min-h-[40px] px-3.5 rounded-xl bg-[#171A36] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              <span>العودة للوحة المدير</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onLogout()}
              className="min-h-[40px] px-3.5 rounded-xl border border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>تسجيل الخروج</span>
            </button>
          )}
        </div>
      </div>

      <Rankings students={sectionStudents} subjects={sectionSubjects} sections={[section]} />
      <Observations key={section.id+'-students'} section={section} students={sectionStudents} personal refresh={onWorkspaceRefresh}/>
      <Observations key={section.id+'-class'} section={section} students={sectionStudents} personal={false} refresh={onWorkspaceRefresh}/>
      {/* Counselor Sub-tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'students', label: `الطلاب والأكواد (${sectionStudents.length})`, icon: Users },
            { id: 'absences', label: `سجل الغيابات (${sectionAbsences.length})`, icon: CalendarX2 },
            { id: 'gradebooks', label: `دفاتر الدرجات (${sectionSubjects.length})`, icon: BookOpen },
            { id: 'import_pdf', label: 'الاستيراد الذكي وتصدير A4', icon: FileSpreadsheet },
          ] as { id: CounselorTab; label: string; icon: React.ComponentType<{ className?: string }> }[]
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
                  ? 'bg-[#653CF5] text-white border-[#653CF5]'
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
        <div role="alert" className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs sm:text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {toast && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs sm:text-sm text-emerald-700 dark:text-emerald-300 font-bold">
          {toast}
        </div>
      )}

      {issuedStudentCodeBanner && (
        <div className="p-4 rounded-2xl bg-[#EEEAFF] dark:bg-violet-950/50 border border-[#653CF5] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs sm:text-sm font-extrabold text-[#4320D9] dark:text-violet-200">
              كود الدخول الخاص بالطالب «{issuedStudentCodeBanner.fullName}» (احفظه وشاركه مع الطالب/ولي الأمر):
            </span>
            <button type="button" onClick={() => setIssuedStudentCodeBanner(null)} className="cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <code className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#653CF5]/40 font-mono-num text-base font-extrabold select-all">
              {issuedStudentCodeBanner.code}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(issuedStudentCodeBanner.code);
                notify('تم نسخ كود الطالب.');
              }}
              className="min-h-[36px] px-3 rounded-lg bg-[#653CF5] text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>نسخ</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 1: STUDENTS & CODES */}
      {activeTab === 'students' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleAddStudent}
            className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3.5"
          >
            <h3 className="font-display font-bold text-base text-[#171A36] dark:text-white flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-[#653CF5]" />
              <span>إضافة طالب جديد للشعبة</span>
            </h3>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">اسم الطالب الكامل</label>
              <input
                type="text"
                required
                value={newStudentName}
                onChange={(e) => setNewStudentName(e.target.value)}
                placeholder="مثال: علي حسين محمد"
                className="w-full min-h-[42px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">الحالة</label>
              <select
                value={newStudentStatus}
                onChange={(e) => setNewStudentStatus(e.target.value as SchoolStudentStatus)}
                className="w-full min-h-[42px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
              >
                <option value="active">مستمر</option>
                <option value="transferred">منقول</option>
                <option value="inactive">موقوف</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">ملاحظات (اختياري)</label>
              <input
                type="text"
                value={newStudentNotes}
                onChange={(e) => setNewStudentNotes(e.target.value)}
                className="w-full min-h-[40px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[44px] rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة الطالب</span>
            </button>
          </form>

          <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h3 className="font-display font-bold text-base text-[#171A36] dark:text-white">
                  قائمة طلبة الشعبة
                </h3>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="بحث باسم الطالب..."
                    className="w-full sm:w-56 min-h-[38px] pr-9 pl-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                  />
                </div>
              </div>

              {/* Bulk Issue Codes + A4 Print (20 students per sheet) */}
              <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-[#EEEAFF]/60 dark:bg-violet-950/30 border border-[#653CF5]/20">
                <button
                  type="button"
                  disabled={bulkIssuingCodes || sectionStudents.length === 0}
                  onClick={() => void handleBulkIssueStudentCodes()}
                  className="min-h-[38px] px-3.5 rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {bulkIssuingCodes ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>إضافة أكواد لجميع الطلاب</span>
                </button>

                <button
                  type="button"
                  disabled={sectionStudents.length === 0}
                  onClick={handleOpenPrintCodesA4}
                  className="min-h-[38px] px-3.5 rounded-xl bg-[#171A36] hover:bg-[#4320D9] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة الأكواد (A4 — 20 طالب/ورقة)</span>
                </button>

                <span className="text-[11px] text-slate-600 dark:text-slate-300">
                  
                </span>
              </div>
            </div>

            {filteredStudents.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">
                لا يوجد طلبة مسجلون في هذه الشعبة بعد.
              </p>
            ) : (
              <div className="space-y-2.5">
                {filteredStudents.map((stu, idx) => {
                  const stMeta = studentStatusLabel(stu.status);
                  return (
                    <div
                      key={stu.id}
                      className="p-3.5 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2.5"
                    >
                      {editingStudent?.id === stu.id ? (
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                          <input
                            type="text"
                            value={editingStudent.fullName}
                            onChange={(e) =>
                              setEditingStudent({ ...editingStudent, fullName: e.target.value })
                            }
                            className="sm:col-span-5 min-h-[36px] px-2.5 rounded-lg bg-white dark:bg-slate-900 border text-xs font-bold"
                          />
                          <select
                            value={editingStudent.status}
                            onChange={(e) =>
                              setEditingStudent({
                                ...editingStudent,
                                status: e.target.value as SchoolStudentStatus,
                              })
                            }
                            className="sm:col-span-3 min-h-[36px] px-2 rounded-lg bg-white dark:bg-slate-900 border text-xs"
                          >
                            <option value="active">مستمر</option>
                            <option value="transferred">منقول</option>
                            <option value="inactive">موقوف</option>
                          </select>
                          <div className="sm:col-span-4 flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={async () => {
                                await upsertStudentApi(section.id, {
                                  id: stu.id,
                                  fullName: editingStudent.fullName.trim(),
                                  status: editingStudent.status,
                                  notes: editingStudent.notes.trim(),
                                });
                                setEditingStudent(null);
                                await onWorkspaceRefresh();
                              }}
                              className="flex-1 min-h-[36px] rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                            >
                              حفظ
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingStudent(null)}
                              className="min-h-[36px] px-2.5 rounded-lg border text-xs cursor-pointer"
                            >
                              إلغاء
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono-num text-xs text-slate-400">{idx + 1}.</span>
                              <span className="font-bold text-sm text-[#171A36] dark:text-white">
                                {stu.fullName}
                              </span>
                              <span className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold ${stMeta.cls}`}>
                                {stMeta.label}
                              </span>
                              <span className="text-[11px] font-semibold text-slate-500">
                                ({codeStatusLabel(stu.studentCodeStatus)})
                              </span>
                            </div>
                            {stu.studentCodeStatus === 'active' &&
                              (stu.studentAccessCode ? (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-[#653CF5]/30 text-xs">
                                    <span className="text-[11px] text-slate-500">الكود:</span>
                                    <code
                                      dir="ltr"
                                      className="font-mono-num font-extrabold text-[#4320D9] dark:text-violet-300 select-all"
                                    >
                                      {stu.studentAccessCode}
                                    </code>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void navigator.clipboard?.writeText(stu.studentAccessCode!);
                                        setCopiedStudentId(stu.id);
                                        setTimeout(
                                          () =>
                                            setCopiedStudentId((prev) => (prev === stu.id ? null : prev)),
                                          2000
                                        );
                                        notify(`تم نسخ كود الطالب: ${stu.studentAccessCode}`);
                                      }}
                                      className="px-1.5 py-0.5 rounded bg-[#EEEAFF] dark:bg-violet-950 text-[#4320D9] dark:text-violet-200 text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer"
                                    >
                                      {copiedStudentId === stu.id ? (
                                        <Check className="w-3 h-3" />
                                      ) : (
                                        <Copy className="w-3 h-3" />
                                      )}
                                      <span>{copiedStudentId === stu.id ? 'نُسخ' : 'نسخ'}</span>
                                    </button>
                                  </span>
                                </div>
                              ) : (
                                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                                  كود صادر
                                </p>
                              ))}
                            {stu.notes && <p className="text-[11px] text-slate-500">{stu.notes}</p>}
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setCodeTargetStudentId(stu.id);
                                setCodeInput(generateStudentCode());
                              }}
                              className="min-h-[34px] px-2.5 rounded-lg bg-[#EEEAFF] dark:bg-slate-900 text-[#4320D9] dark:text-violet-300 text-xs font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                              <span>{stu.studentCodeStatus === 'active' ? 'تغيير الكود' : 'إصدار كود'}</span>
                            </button>

                            {stu.studentCodeStatus === 'active' &&
                              (confirmRevokeStudentId === stu.id ? (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await setStudentCodeApi(section.id, stu.id, 'revoke');
                                    setConfirmRevokeStudentId(null);
                                    await onWorkspaceRefresh();
                                    notify('تم إبطال كود الطالب.');
                                  }}
                                  className="min-h-[34px] px-2.5 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer"
                                >
                                  تأكيد الإبطال
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmRevokeStudentId(stu.id)}
                                  className="min-h-[34px] px-2 rounded-lg border border-amber-300 text-amber-700 dark:text-amber-300 text-[11px] font-semibold cursor-pointer"
                                >
                                  إبطال
                                </button>
                              ))}

                            <button
                              type="button"
                              onClick={() =>
                                setEditingStudent({
                                  id: stu.id,
                                  fullName: stu.fullName,
                                  status: stu.status,
                                  notes: stu.notes || '',
                                })
                              }
                              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-[#653CF5] cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            {confirmDeleteStudentId === stu.id ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  await deleteStudentApi(section.id, stu.id);
                                  setConfirmDeleteStudentId(null);
                                  await onWorkspaceRefresh();
                                }}
                                className="min-h-[34px] px-2.5 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer"
                              >
                                تأكيد الحذف
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteStudentId(stu.id)}
                                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-600 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {codeTargetStudentId === stu.id && (
                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-[#653CF5]/30 flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={codeInput}
                            onChange={(e) => setCodeInput(e.target.value)}
                            className="flex-1 min-w-[140px] min-h-[34px] px-2.5 rounded-lg bg-[#F7F7FC] dark:bg-slate-800 border text-xs font-mono-num font-bold"
                          />
                          <button
                            type="button"
                            onClick={() => setCodeInput(generateStudentCode())}
                            className="min-h-[34px] px-2.5 rounded-lg border text-xs cursor-pointer"
                          >
                            توليد
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleIssueStudentCode(stu)}
                            className="min-h-[34px] px-3 rounded-lg bg-[#653CF5] text-white text-xs font-bold cursor-pointer"
                          >
                            اعتماد الكود
                          </button>
                          <button
                            type="button"
                            onClick={() => setCodeTargetStudentId(null)}
                            className="min-h-[34px] px-2 rounded-lg border text-xs cursor-pointer"
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

      {/* TAB 2: ABSENCES LOG */}
      {activeTab === 'absences' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleAddAbsence}
            className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3.5"
          >
            <h3 className="font-display font-bold text-base text-[#171A36] dark:text-white flex items-center gap-2">
              <CalendarX2 className="w-5 h-5 text-[#653CF5]" />
              <span>تسجيل غياب طالب</span>
            </h3>

            <div className="space-y-1">
              <label className="block text-xs font-bold">الطالب</label>
              <select
                value={absStudentId || sectionStudents[0]?.id || ''}
                onChange={(e) => setAbsStudentId(e.target.value)}
                className="w-full min-h-[40px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm"
              >
                {sectionStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="block text-xs font-bold">التاريخ</label>
                <input
                  type="date"
                  required
                  value={absDate}
                  onChange={(e) => setAbsDate(e.target.value)}
                  className="w-full min-h-[40px] px-2.5 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono-num"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-bold">نوع الغياب</label>
                <select
                  value={absExcuse}
                  onChange={(e) => setAbsExcuse(e.target.value as StudentAbsence['excuseType'])}
                  className="w-full min-h-[40px] px-2 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                >
                  <option value="unexcused">بدون عذر</option>
                  <option value="excused">بعذر مقبول</option>
                  <option value="medical">إجازة مرضية</option>
                  <option value="official">مهمة رسمية</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold">المادة / الحصة (اختياري)</label>
              <input
                type="text"
                value={absSubject}
                onChange={(e) => setAbsSubject(e.target.value)}
                placeholder="مثال: يوم كامل أو حصة الفيزياء"
                className="w-full min-h-[40px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold">ملاحظات</label>
              <input
                type="text"
                value={absNotes}
                onChange={(e) => setAbsNotes(e.target.value)}
                className="w-full min-h-[40px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={busy || sectionStudents.length === 0}
              className="w-full min-h-[44px] rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-sm font-bold cursor-pointer disabled:opacity-50"
            >
              تسجيل الغياب
            </button>
          </form>

          <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display font-bold text-base text-[#171A36] dark:text-white">
                سجل غيابات الشعبة
              </h3>
              <select
                value={absFilterStudentId}
                onChange={(e) => setAbsFilterStudentId(e.target.value)}
                className="min-h-[38px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
              >
                <option value="all">جميع الطلبة</option>
                {sectionStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
              </select>
            </div>

            {sectionAbsences.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">لا توجد غيابات مسجلة.</p>
            ) : (
              <div className="space-y-2">
                {sectionAbsences.map((ab) => {
                  const stu = sectionStudents.find((s) => s.id === ab.studentId);
                  return (
                    <div
                      key={ab.id}
                      className="p-3.5 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3"
                    >
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                          <span className="font-bold text-[#171A36] dark:text-white">
                            {stu?.fullName || 'طالب'}
                          </span>
                          <span className="font-mono-num text-xs text-[#653CF5] font-bold">{ab.date}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              ab.excuseType === 'unexcused'
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {EXCUSE_LABELS[ab.excuseType]}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {ab.subjectName && <span>{ab.subjectName} · </span>}
                          {ab.notes}
                        </p>
                      </div>

                      {confirmDeleteAbsId === ab.id ? (
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteAbsenceApi(section.id, ab.id);
                            setConfirmDeleteAbsId(null);
                            await onWorkspaceRefresh();
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer"
                        >
                          تأكيد الحذف
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteAbsId(ab.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: SUBJECT GRADEBOOKS */}
      {activeTab === 'gradebooks' && (
        <SubjectGradebookEditor
          school={workspace.school}
          stage={stage}
          section={section}
          students={sectionStudents}
          subjects={sectionSubjects}
          onWorkspaceRefresh={onWorkspaceRefresh}
          onRequestImport={(target) => {
            setImportTarget(target);
            setActiveTab('import_pdf');
          }}
        />
      )}

      {/* TAB 4: SMART SHEET IMPORT & A4 PDF */}
      {activeTab === 'import_pdf' && (
        <SmartSheetImportWizard
          school={workspace.school}
          stage={stage}
          section={section}
          students={sectionStudents}
          subjects={sectionSubjects}
          templates={workspace.templates}
          onWorkspaceRefresh={onWorkspaceRefresh}
          preselect={importTarget}
          onClearPreselect={() => setImportTarget(null)}
        />
      )}

      {/* A4 Student Codes Print & Download Modal (20 Students / A4 Sheet) */}
      {codesA4Preview && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-display font-bold text-base text-[#171A36] dark:text-white">
                  معاينة وطباعة أكواد الطلبة (A4 — 20 طالب في كل ورقة)
                </h4>
                <p className="text-xs text-slate-500">
                  إجمالي {printableCount} طالباً موزعين على {codesA4Preview.previewPages.length} صفحة A4
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePrintA4InHiddenFrame(codesA4Preview)}
                  className="min-h-[38px] px-4 rounded-xl bg-[#171A36] hover:bg-[#4320D9] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة الآن</span>
                </button>
                {codesA4DownloadUrl && (
                  <a
                    href={codesA4DownloadUrl}
                    download={codesA4Preview.fileName}
                    className="min-h-[38px] px-4 rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    <span>تنزيل PDF A4</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setCodesA4Preview(null)}
                  className="w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 bg-slate-100 dark:bg-slate-950 space-y-4">
              {codesA4Preview.previewPages.map((src, idx) => (
                <img
                  key={idx}
                  src={src}
                  alt={`ورقة أكواد A4 رقم ${idx + 1}`}
                  className="w-full max-w-[740px] mx-auto rounded-lg shadow-md border border-slate-200 bg-white"
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
