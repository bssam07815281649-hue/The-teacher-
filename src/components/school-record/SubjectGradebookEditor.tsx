import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calculator,
  Check,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  Save,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AnnualPursuitConfig,
  CustomSubRecord,
  GradeCellStatus,
  GradeCellValue,
  GradeColumn,
  SchoolProfile,
  SchoolSection,
  SchoolStageGrade,
  SchoolStudent,
  SmartImportTarget,
  SubjectGradebook,
} from '../../types';
import {
  approvedSummary,
  formatCellDisplay,
  getCellValue,
  makeCellKey,
} from '../../utils/gradeCalculations';
import {
  deleteSubjectApi,
  updateGradeCellsApi,
  releaseGrades,
  upsertSubjectApi,
  pendingGradeChanges,
} from '../../services/schoolRecordClient';
import { generateMatchingA4Pdf, type A4PdfExportResult } from '../../services/a4PdfExport';
import { normalizeDigits } from '../../utils/arabicNameMatch';

interface SubjectGradebookEditorProps {
  school: SchoolProfile;
  stage?: SchoolStageGrade;
  section: SchoolSection;
  students: SchoolStudent[];
  subjects: SubjectGradebook[];
  onWorkspaceRefresh: () => Promise<void>;
  onRequestImport?: (target: SmartImportTarget) => void;
}

type ActiveTab = 'term1' | 'midyear' | 'term2' | 'pursuit';

function makeLocalId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export const SubjectGradebookEditor: React.FC<SubjectGradebookEditorProps> = ({
  school,
  stage,
  section,
  students,
  subjects,
  onWorkspaceRefresh,
  onRequestImport,
}) => {
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(subjects[0]?.id || '');
  const [activeTab, setActiveTab] = useState<ActiveTab>('term1');
  const [newSubjectName, setNewSubjectName] = useState('');
  const [editingSubjectName, setEditingSubjectName] = useState<string | null>(null);
  const [confirmDeleteSubjId, setConfirmDeleteSubjId] = useState<string | null>(null);

  // Sub-record navigation & Preview-Only vs Edit mode
  const [openSubRecordId, setOpenSubRecordId] = useState<string | null>(null);
  const [isEditingRecord, setIsEditingRecord] = useState(false);
  const [isEditingMidyear, setIsEditingMidyear] = useState(false);

  // Pending cell edits map: `${studentId}::${columnId}` -> GradeCellValue
  const [draftCells, setDraftCells] = useState<Record<string, GradeCellValue>>({});
  const [savingCells, setSavingCells] = useState(false);
  const [approval,setApproval] = useState<{key:string; ids:string[]}|null>(null);
  const [savingStructure, setSavingStructure] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Custom sub-record / column add inputs
  const [newSubRecordName, setNewSubRecordName] = useState('');
  const [newColInputs, setNewColInputs] = useState<Record<string, { label: string; maxScore: string }>>({});
  const [confirmDeleteRecId, setConfirmDeleteRecId] = useState<string | null>(null);
  const [confirmDeleteColId, setConfirmDeleteColId] = useState<string | null>(null);
  const [renamingRec, setRenamingRec] = useState<{ id: string; name: string } | null>(null);
  const [editingCol, setEditingCol] = useState<{ id: string; label: string; maxScore: string } | null>(null);

  // A4 PDF Preview Modal
  const [pdfPreview, setPdfPreview] = useState<A4PdfExportResult | null>(null);
  const [pdfDownloadUrl, setPdfDownloadUrl] = useState('');

  React.useEffect(() => {
    if (!pdfPreview) {
      setPdfDownloadUrl('');
      return;
    }
    const url = URL.createObjectURL(pdfPreview.pdfBlob);
    setPdfDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdfPreview]);

  const activeSubject = useMemo(
    () => subjects.find((s) => s.id === selectedSubjectId) || subjects[0] || null,
    [subjects, selectedSubjectId]
  );

  const activeStudents = useMemo(
    () => students.filter((s) => s.status === 'active'),
    [students]
  );

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubjectName.trim()) return;
    setError('');
    setSavingStructure(true);
    try {
      const created = await upsertSubjectApi(section.id, { name: newSubjectName.trim() });
      setNewSubjectName('');
      setSelectedSubjectId(created.id);
      await onWorkspaceRefresh();
      showToast(`تم إنشاء دفتر مادة «${created.name}»`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء دفتر المادة.');
    } finally {
      setSavingStructure(false);
    }
  };

  const handleRenameSubject = async () => {
    if (!activeSubject || !editingSubjectName?.trim()) return;
    setError('');
    setSavingStructure(true);
    try {
      await upsertSubjectApi(section.id, {
        id: activeSubject.id,
        name: editingSubjectName.trim(),
      });
      setEditingSubjectName(null);
      await onWorkspaceRefresh();
      showToast('تم تعديل اسم المادة.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تعديل اسم المادة.');
    } finally {
      setSavingStructure(false);
    }
  };

  const handleDeleteSubject = async (subjectId: string) => {
    setError('');
    setSavingStructure(true);
    try {
      await deleteSubjectApi(section.id, subjectId);
      setConfirmDeleteSubjId(null);
      setDraftCells({});
      await onWorkspaceRefresh();
      showToast('تم حذف دفتر المادة.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف المادة.');
    } finally {
      setSavingStructure(false);
    }
  };

  const saveSubjectStructure = async (
    nextSubRecords: CustomSubRecord[],
    nextMidyearCols: GradeColumn[],
    nextPursuitConfig?: AnnualPursuitConfig
  ) => {
    if (!activeSubject) return;
    setError('');
    setSavingStructure(true);
    try {
      await upsertSubjectApi(section.id, {
        id: activeSubject.id,
        name: activeSubject.name,
        subRecords: nextSubRecords,
        midyearColumns: nextMidyearCols,
        annualPursuitConfig: nextPursuitConfig || activeSubject.annualPursuitConfig,
      });
      await onWorkspaceRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث هيكل السجل.');
    } finally {
      setSavingStructure(false);
    }
  };

  const handleAddSubRecord = async (periodId: 'term1' | 'term2') => {
    if (!activeSubject || !newSubRecordName.trim()) return;
    const recName = newSubRecordName.trim();
    const newColId = makeLocalId('col');
    const newRec: CustomSubRecord = {
      id: makeLocalId('rec'),
      periodId,
      name: recName,
      orderIndex: activeSubject.subRecords.filter((r) => r.periodId === periodId).length,
      columns: [{ id: newColId, label: `${recName} ١`, maxScore: 100, orderIndex: 0 }],
    };
    const cfg = { ...activeSubject.annualPursuitConfig };
    if (periodId === 'term1') cfg.term1ColumnIds = [...cfg.term1ColumnIds, newColId];
    else cfg.term2ColumnIds = [...cfg.term2ColumnIds, newColId];
    setNewSubRecordName('');
    await saveSubjectStructure([...activeSubject.subRecords, newRec], activeSubject.midyearColumns, cfg);
    setOpenSubRecordId(newRec.id);
    setIsEditingRecord(false);
    showToast(`تمت إضافة سجل «${recName}» — يُفتح الآن للمعاينة، اضغط «تعديل» لإضافة أو استيراد الدرجات.`);
  };

  const handleDeleteSubRecord = async (recId: string) => {
    if (!activeSubject) return;
    const nextRecs = activeSubject.subRecords.filter((r) => r.id !== recId);
    setConfirmDeleteRecId(null);
    if (openSubRecordId === recId) {
      setOpenSubRecordId(null);
      setIsEditingRecord(false);
    }
    await saveSubjectStructure(nextRecs, activeSubject.midyearColumns);
    showToast('تم حذف السجل الفرعي.');
  };

  const handleRenameSubRecord = async () => {
    if (!activeSubject || !renamingRec || !renamingRec.name.trim()) return;
    const nextRecs = activeSubject.subRecords.map((r) =>
      r.id === renamingRec.id ? { ...r, name: renamingRec.name.trim() } : r
    );
    setRenamingRec(null);
    await saveSubjectStructure(nextRecs, activeSubject.midyearColumns);
  };

  const handleAddColumn = async (targetRecId: string | 'midyear') => {
    if (!activeSubject) return;
    const inp = newColInputs[targetRecId] || { label: '', maxScore: '100' };
    const label = inp.label.trim();
    const maxScore = Math.max(1, Math.min(1000, Number(normalizeDigits(inp.maxScore)) || 100));
    if (!label) {
      setError('يرجى كتابة عنوان العمود.');
      return;
    }

    const colId = makeLocalId('col');
    const cfg = { ...activeSubject.annualPursuitConfig };

    if (targetRecId === 'midyear') {
      const nextMid = [
        ...activeSubject.midyearColumns,
        { id: colId, label, maxScore, orderIndex: activeSubject.midyearColumns.length },
      ];
      cfg.midyearColumnIds = [...cfg.midyearColumnIds, colId];
      setNewColInputs((p) => ({ ...p, midyear: { label: '', maxScore: '100' } }));
      await saveSubjectStructure(activeSubject.subRecords, nextMid, cfg);
    } else {
      const targetRec = activeSubject.subRecords.find((r) => r.id === targetRecId);
      if (!targetRec) return;
      const nextRecs = activeSubject.subRecords.map((r) =>
        r.id === targetRecId
          ? {
              ...r,
              columns: [...r.columns, { id: colId, label, maxScore, orderIndex: r.columns.length }],
            }
          : r
      );
      if (targetRec.periodId === 'term1') cfg.term1ColumnIds = [...cfg.term1ColumnIds, colId];
      else cfg.term2ColumnIds = [...cfg.term2ColumnIds, colId];
      setNewColInputs((p) => ({ ...p, [targetRecId]: { label: '', maxScore: '100' } }));
      await saveSubjectStructure(nextRecs, activeSubject.midyearColumns, cfg);
    }
    showToast(`تمت إضافة عمود «${label}».`);
  };

  const handleMoveColumn = async (
    targetRecId: string | 'midyear',
    colId: string,
    dir: -1 | 1
  ) => {
    if (!activeSubject) return;
    const reorder = (cols: GradeColumn[]) => {
      const sorted = [...cols].sort((a, b) => a.orderIndex - b.orderIndex);
      const idx = sorted.findIndex((c) => c.id === colId);
      const swapIdx = idx + dir;
      if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return sorted;
      [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
      return sorted.map((c, i) => ({ ...c, orderIndex: i }));
    };

    if (targetRecId === 'midyear') {
      await saveSubjectStructure(activeSubject.subRecords, reorder(activeSubject.midyearColumns));
    } else {
      const nextRecs = activeSubject.subRecords.map((r) =>
        r.id === targetRecId ? { ...r, columns: reorder(r.columns) } : r
      );
      await saveSubjectStructure(nextRecs, activeSubject.midyearColumns);
    }
  };

  const handleDeleteColumn = async (targetRecId: string | 'midyear', colId: string) => {
    if (!activeSubject) return;
    if (targetRecId === 'midyear') {
      const nextMid = activeSubject.midyearColumns.filter((c) => c.id !== colId);
      await saveSubjectStructure(activeSubject.subRecords, nextMid);
    } else {
      const nextRecs = activeSubject.subRecords.map((r) =>
        r.id === targetRecId ? { ...r, columns: r.columns.filter((c) => c.id !== colId) } : r
      );
      await saveSubjectStructure(nextRecs, activeSubject.midyearColumns);
    }
    setConfirmDeleteColId(null);
    showToast('تم حذف العمود.');
  };

  const handleSaveEditedCol = async (targetRecId: string | 'midyear') => {
    if (!activeSubject || !editingCol) return;
    const cleanLabel = editingCol.label.trim();
    const maxScore = Math.max(1, Math.min(1000, Number(normalizeDigits(editingCol.maxScore)) || 100));
    if (!cleanLabel) return;
    if (targetRecId === 'midyear') {
      const nextMid = activeSubject.midyearColumns.map((c) =>
        c.id === editingCol.id ? { ...c, label: cleanLabel, maxScore } : c
      );
      await saveSubjectStructure(activeSubject.subRecords, nextMid);
    } else {
      const nextRecs = activeSubject.subRecords.map((r) =>
        r.id === targetRecId
          ? {
              ...r,
              columns: r.columns.map((c) =>
                c.id === editingCol.id ? { ...c, label: cleanLabel, maxScore } : c
              ),
            }
          : r
      );
      await saveSubjectStructure(nextRecs, activeSubject.midyearColumns);
    }
    setEditingCol(null);
  };

  const getCurrentCell = (studentId: string, columnId: string): GradeCellValue => {
    const key = makeCellKey(studentId, columnId);
    if (draftCells[key]) return draftCells[key];
    if (!activeSubject) return { status: 'blank', score: null };
    return getCellValue(activeSubject, studentId, columnId);
  };

  const setDraftCellValue = (studentId: string, columnId: string, val: GradeCellValue) => {
    const key = makeCellKey(studentId, columnId);
    setDraftCells((prev) => ({ ...prev, [key]: val }));
  };

  const pendingDraftCount = Object.keys(draftCells).length;

  const handleSaveDraftCells = async () => {
    if (!activeSubject || pendingDraftCount === 0) return;
    setError('');
    setSavingCells(true);
    try {
      const updates = Object.entries(draftCells).map(([key, value]) => {
        const [studentId, columnId] = key.split('::');
        return { studentId, columnId, value };
      });
      await updateGradeCellsApi(section.id, activeSubject.id, updates);
      setDraftCells({});
      await onWorkspaceRefresh();
      const pending = await pendingGradeChanges();
      showToast(pending ? `حُفظت ${updates.length} درجة على الجهاز. توجد ${pending} مجموعة تعديلات تنتظر المزامنة.` : `تم حفظ ${updates.length} درجة على الخادم بنجاح.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ الدرجات.');
    } finally {
      setSavingCells(false);
    }
  };

  const togglePursuitColumn = async (periodId: 'term1' | 'midyear' | 'term2', colId: string) => {
    if (!activeSubject) return;
    const cfg = { ...activeSubject.annualPursuitConfig };
    const field =
      periodId === 'term1' ? 'term1ColumnIds' : periodId === 'midyear' ? 'midyearColumnIds' : 'term2ColumnIds';
    const current = new Set(cfg[field] || []);
    if (current.has(colId)) current.delete(colId);
    else current.add(colId);
    cfg[field] = Array.from(current);
    await saveSubjectStructure(activeSubject.subRecords, activeSubject.midyearColumns, cfg);
  };

  const togglePursuitScale = async (scaleMode: 'scale100' | 'raw') => {
    if (!activeSubject) return;
    await saveSubjectStructure(activeSubject.subRecords, activeSubject.midyearColumns, {
      ...activeSubject.annualPursuitConfig,
      scaleMode,
    });
  };

  const handleOpenA4Pdf = () => {
    if (!activeSubject) return;
    const termCols = [
      ...activeSubject.subRecords
        .filter((r) => r.periodId === 'term1')
        .flatMap((r) => r.columns.map((c) => ({ ...c, fullLabel: `ف1: ${c.label}` }))),
      ...activeSubject.midyearColumns.map((c) => ({ ...c, fullLabel: `ن.س: ${c.label}` })),
      ...activeSubject.subRecords
        .filter((r) => r.periodId === 'term2')
        .flatMap((r) => r.columns.map((c) => ({ ...c, fullLabel: `ف2: ${c.label}` }))),
    ];

    const cols = termCols.slice(0, 8);
    const exportRes = generateMatchingA4Pdf({
      schoolName: school.name,
      directorate: school.directorate,
      academicYear: school.academicYear,
      sectionLabel: `${stage ? stage.name + ' — ' : ''}${section.name} (المرشد: ${section.counselorName || '—'})`,
      subjectLabel: `مادة: ${activeSubject.name}`,
      subtitle:
        activeSubject.annualPursuitConfig.scaleMode === 'scale100'
          ? 'السعي السنوي محسوب بتوحيد المقياس إلى 100 بعد توفر الفترات الثلاث'
          : 'السعي السنوي محسوب بالمتوسط الخام بعد توفر الفترات الثلاث',
      columns: cols.map((c) => ({ label: c.fullLabel, maxScoreLabel: `من ${c.maxScore}` })),
      rows: activeStudents.map((stu) => {
        const sum = approvedSummary(activeSubject, stu.id);
        return {
          studentName: stu.fullName,
          cells: cols.map((c) => formatCellDisplay(getCurrentCell(stu.id, c.id))),
          extraSummary: sum.annualPursuit !== null ? String(sum.annualPursuit) : '-',
        };
      }),
    });
    setPdfPreview(exportRes);
  };

  const renderCellEditor = (student: SchoolStudent, col: GradeColumn) => {
    const val = getCurrentCell(student.id, col.id);
    const key = makeCellKey(student.id, col.id);
    const isDirty = Boolean(draftCells[key]);
    const isInvalid =
      val.status === 'score' &&
      (val.score === null || val.score < 0 || val.score > col.maxScore);

    return (
      <td
        key={col.id}
        className={`p-2 border border-slate-200 dark:border-slate-700 align-top min-w-[140px] ${
          isDirty ? 'bg-[#EEEAFF]/40 dark:bg-violet-950/30' : ''
        }`}
      >
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            {val.status === 'score' ? (
              <input
                type="number"
                step="0.5"
                min={0}
                max={col.maxScore}
                value={val.score ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    setDraftCellValue(student.id, col.id, { status: 'blank', score: null });
                  } else {
                    const num = Number(normalizeDigits(raw));
                    setDraftCellValue(student.id, col.id, {
                      status: 'score',
                      score: Number.isNaN(num) ? 0 : num,
                    });
                  }
                }}
                placeholder={`0-${col.maxScore}`}
                className={`w-full min-h-[34px] px-2 rounded-lg border text-center font-mono-num text-sm font-bold focus:outline-none focus:ring-2 ${
                  isInvalid
                    ? 'border-red-500 bg-red-50 text-red-700 focus:ring-red-500'
                    : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-[#171A36] dark:text-white focus:ring-[#653CF5]'
                }`}
              />
            ) : (
              <button
                type="button"
                onClick={() => setDraftCellValue(student.id, col.id, { status: 'score', score: 0 })}
                className={`w-full min-h-[34px] px-2 rounded-lg border text-xs font-bold cursor-pointer ${
                  val.status === 'absent'
                    ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
                    : val.status === 'exempt'
                    ? 'bg-[#EEEAFF] dark:bg-violet-950/50 border-[#653CF5]/30 text-[#4320D9] dark:text-violet-300'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'
                }`}
                title="انقر لإدخال رقم (0 أو درجة)"
              >
                {val.status === 'absent' ? 'غائب' : val.status === 'exempt' ? 'معفى' : '- (فارغ)'}
              </button>
            )}
          </div>

          <div className="flex items-center justify-center gap-1 text-[10px]">
            {(
              [
                { st: 'score' as GradeCellStatus, lbl: 'رقم' },
                { st: 'blank' as GradeCellStatus, lbl: '-' },
                { st: 'absent' as GradeCellStatus, lbl: 'غائب' },
                { st: 'exempt' as GradeCellStatus, lbl: 'معفى' },
              ]
            ).map((opt) => (
              <button
                key={opt.st}
                type="button"
                onClick={() =>
                  setDraftCellValue(student.id, col.id, {
                    status: opt.st,
                    score: opt.st === 'score' ? (val.score ?? 0) : null,
                  })
                }
                className={`px-1.5 py-0.5 rounded font-semibold cursor-pointer ${
                  val.status === opt.st
                    ? 'bg-[#653CF5] text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {opt.lbl}
              </button>
            ))}
          </div>
        </div>
      </td>
    );
  };

  const renderColumnsGrid = (
    targetRecId: string | 'midyear',
    columns: GradeColumn[]
  ) => {
    const sortedCols = [...columns].sort((a, b) => a.orderIndex - b.orderIndex);
    const colInput = newColInputs[targetRecId] || { label: '', maxScore: '100' };

    return (
      <div className="space-y-3">
        {/* Add new column bar */}
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
          <input
            type="text"
            value={colInput.label}
            onChange={(e) =>
              setNewColInputs((p) => ({
                ...p,
                [targetRecId]: { ...colInput, label: e.target.value },
              }))
            }
            placeholder="عنوان العمود (مثال: يومي ١، شهر أول، إنشاء)"
            className="flex-1 min-w-[160px] min-h-[38px] px-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
          />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">العظمى:</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={colInput.maxScore}
              onChange={(e) =>
                setNewColInputs((p) => ({
                  ...p,
                  [targetRecId]: { ...colInput, maxScore: e.target.value },
                }))
              }
              className="w-20 min-h-[38px] px-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono-num text-center"
            />
          </div>
          <button
            type="button"
            disabled={savingStructure}
            onClick={() => void handleAddColumn(targetRecId)}
            className="min-h-[38px] px-3 rounded-lg bg-[#653CF5] hover:bg-[#4320D9] text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة عمود</span>
          </button>
        </div>

        {/* Grades Table */}
        {activeStudents.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">
            لا يوجد طلبة نشطون في الشعبة.
          </p>
        ) : sortedCols.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">
            لا توجد أعمدة.
          </p>
        ) : (
          <div className="overflow-x-auto thin-scrollbar rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#171A36] text-white">
                  <th className="p-2.5 text-right border border-slate-700 w-10">ت</th>
                  <th className="p-2.5 text-right border border-slate-700 min-w-[180px]">اسم الطالب</th>
                  {sortedCols.map((col, idx) => (
                    <th key={col.id} className="p-2 border border-slate-700 text-center min-w-[140px]">
                      {editingCol?.id === col.id ? (
                        <div className="space-y-1.5 text-slate-900">
                          <input
                            type="text"
                            value={editingCol.label}
                            onChange={(e) => setEditingCol({ ...editingCol, label: e.target.value })}
                            className="w-full px-2 py-1 rounded text-xs bg-white"
                          />
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={1}
                              value={editingCol.maxScore}
                              onChange={(e) => setEditingCol({ ...editingCol, maxScore: e.target.value })}
                              className="w-16 px-1 py-1 rounded text-xs bg-white font-mono-num"
                            />
                            <button
                              type="button"
                              onClick={() => void handleSaveEditedCol(targetRecId)}
                              className="px-2 py-1 rounded bg-emerald-600 text-white text-[11px] cursor-pointer"
                            >
                              حفظ
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingCol(null)}
                              className="px-1.5 py-1 rounded bg-slate-600 text-white text-[11px] cursor-pointer"
                            >
                              إلغاء
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="font-bold">{col.label}</div>
                          <div className="text-[11px] text-violet-200 font-mono-num">
                            من {col.maxScore}
                          </div>
                          <div className="flex items-center justify-center gap-1 pt-0.5">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => void handleMoveColumn(targetRecId, col.id, -1)}
                              className="p-1 rounded hover:bg-white/15 disabled:opacity-30 cursor-pointer"
                              title="تحريك لليمين"
                            >
                              <ArrowRight className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingCol({
                                  id: col.id,
                                  label: col.label,
                                  maxScore: String(col.maxScore),
                                })
                              }
                              className="p-1 rounded hover:bg-white/15 cursor-pointer"
                              title="تعديل عنوان أو عظمى العمود"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            {confirmDeleteColId === col.id ? (
                              <button
                                type="button"
                                onClick={() => void handleDeleteColumn(targetRecId, col.id)}
                                className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold cursor-pointer"
                              >
                                تأكيد
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteColId(col.id)}
                                className="p-1 rounded hover:bg-red-500/40 cursor-pointer"
                                title="حذف العمود"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={idx === sortedCols.length - 1}
                              onClick={() => void handleMoveColumn(targetRecId, col.id, 1)}
                              className="p-1 rounded hover:bg-white/15 disabled:opacity-30 cursor-pointer"
                              title="تحريك لليسار"
                            >
                              <ArrowLeft className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeStudents.map((stu, rIdx) => (
                  <tr key={stu.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="p-2 border border-slate-200 dark:border-slate-700 text-center font-mono-num text-xs text-slate-500">
                      {rIdx + 1}
                    </td>
                    <td className="p-2.5 border border-slate-200 dark:border-slate-700 font-bold text-[#171A36] dark:text-white">
                      {stu.fullName}
                    </td>
                    {sortedCols.map((col) => renderCellEditor(stu, col))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderReadOnlyColumnsGrid = (columns: GradeColumn[]) => {
    const sortedCols = [...columns].sort((a, b) => a.orderIndex - b.orderIndex);
    if (activeStudents.length === 0) {
      return (
        <p className="text-xs text-slate-500 py-5 text-center">
          لا يوجد طلبة نشطون في الشعبة.
        </p>
      );
    }
    if (sortedCols.length === 0) {
      return (
        <p className="text-xs text-slate-500 py-5 text-center">
          لا توجد أعمدة درجات.
        </p>
      );
    }
    return (
      <div className="overflow-x-auto thin-scrollbar rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full border-collapse text-xs sm:text-sm">
          <thead>
            <tr className="bg-[#171A36] text-white">
              <th className="p-2.5 text-right border border-slate-700 w-10">ت</th>
              <th className="p-2.5 text-right border border-slate-700 min-w-[180px]">اسم الطالب</th>
              {sortedCols.map((col) => (
                <th key={col.id} className="p-2.5 border border-slate-700 text-center min-w-[120px]">
                  <div className="font-bold">{col.label}</div>
                  <div className="text-[11px] text-violet-200 font-mono-num">من {col.maxScore}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeStudents.map((stu, rIdx) => (
              <tr key={stu.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                <td className="p-2.5 border border-slate-200 dark:border-slate-700 text-center font-mono-num text-xs text-slate-500">
                  {rIdx + 1}
                </td>
                <td className="p-2.5 border border-slate-200 dark:border-slate-700 font-bold text-[#171A36] dark:text-white">
                  {stu.fullName}
                </td>
                {sortedCols.map((col) => {
                  const val = getCurrentCell(stu.id, col.id);
                  const text = formatCellDisplay(val);
                  return (
                    <td
                      key={col.id}
                      className="p-2.5 border border-slate-200 dark:border-slate-700 text-center font-mono-num font-bold"
                    >
                      {val.status === 'absent' ? (
                        <span className="px-2 py-0.5 rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs">
                          غائب
                        </span>
                      ) : val.status === 'exempt' ? (
                        <span className="px-2 py-0.5 rounded bg-[#EEEAFF] dark:bg-violet-950/50 text-[#4320D9] dark:text-violet-300 text-xs">
                          معفى
                        </span>
                      ) : val.status === 'blank' ? (
                        <span className="text-slate-400">-</span>
                      ) : (
                        <span className="text-[#171A36] dark:text-white">{text}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Subject Selector & Create Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {subjects.map((sub) => {
              const active = activeSubject?.id === sub.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => {
                    setSelectedSubjectId(sub.id);
                    setOpenSubRecordId(null);
                    setIsEditingRecord(false);
                    setIsEditingMidyear(false);
                    setDraftCells({});
                  }}
                  className={`min-h-[40px] px-3.5 rounded-xl text-xs sm:text-sm font-bold border flex items-center gap-1.5 cursor-pointer ${
                    active
                      ? 'bg-[#653CF5] text-white border-[#653CF5]'
                      : 'bg-[#F7F7FC] dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <BookOpen className="w-4 h-4" />
                  <span>{sub.name}</span>
                </button>
              );
            })}
          </div>

          <form onSubmit={handleCreateSubject} className="flex items-center gap-2">
            <input
              type="text"
              value={newSubjectName}
              onChange={(e) => setNewSubjectName(e.target.value)}
              placeholder="اسم مادة جديدة..."
              className="min-h-[40px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm"
            />
            <button
              type="submit"
              disabled={savingStructure || !newSubjectName.trim()}
              className="min-h-[40px] px-3.5 rounded-xl bg-[#171A36] hover:bg-[#4320D9] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>إنشاء دفتر مادة</span>
            </button>
          </form>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {toast && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300 font-semibold">
            {toast}
          </div>
        )}
      </div>

      {!activeSubject ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500">
          لا توجد مواد.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-5">
          {/* Subject Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              {editingSubjectName !== null ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editingSubjectName}
                    onChange={(e) => setEditingSubjectName(e.target.value)}
                    className="min-h-[38px] px-3 rounded-lg bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => void handleRenameSubject()}
                    className="min-h-[38px] px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                  >
                    حفظ
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingSubjectName(null)}
                    className="min-h-[38px] px-2.5 rounded-lg border border-slate-200 text-xs cursor-pointer"
                  >
                    إلغاء
                  </button>
                </div>
              ) : (
                <>
                  <h3 className="font-display font-extrabold text-lg text-[#171A36] dark:text-white">
                    دفتر مادة: {activeSubject.name}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setEditingSubjectName(activeSubject.name)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-[#653CF5] cursor-pointer"
                    title="تعديل اسم المادة"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  {confirmDeleteSubjId === activeSubject.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleDeleteSubject(activeSubject.id)}
                        className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer"
                      >
                        تأكيد حذف المادة
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteSubjId(null)}
                        className="p-1 rounded-lg border border-slate-200 text-xs cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteSubjId(activeSubject.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 cursor-pointer"
                      title="حذف المادة"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {pendingDraftCount > 0 && (
                <button
                  type="button"
                  disabled={savingCells}
                  onClick={() => void handleSaveDraftCells()}
                  className="min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-60"
                >
                  {savingCells ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>حفظ التعديلات ({pendingDraftCount})</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleOpenA4Pdf}
                className="min-h-[40px] px-3.5 rounded-xl bg-[#EEEAFF] dark:bg-slate-800 text-[#4320D9] dark:text-violet-300 text-xs sm:text-sm font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                <span>معاينة وتنزيل PDF A4</span>
              </button>
            </div>
          </div>

          {/* Term Switcher */}
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'term1', label: 'الفصل الأول' },
                { id: 'midyear', label: 'نصف السنة' },
                { id: 'term2', label: 'الفصل الثاني' },
                { id: 'pursuit', label: 'السعي السنوي والإعدادات' },
              ] as { id: ActiveTab; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setActiveTab(t.id);
                  setOpenSubRecordId(null);
                  setIsEditingRecord(false);
                  setIsEditingMidyear(false);
                }}
                className={`min-h-[40px] px-4 rounded-xl text-xs sm:text-sm font-bold border cursor-pointer ${
                  activeTab === t.id
                    ? 'bg-[#653CF5] text-white border-[#653CF5]'
                    : 'bg-[#F7F7FC] dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeTab !== 'pursuit' && <div className="flex flex-wrap gap-2">
            {[false,true].map(approve => <button key={String(approve)} type="button"
              className="rounded-xl border px-4 py-2 font-bold" disabled={savingStructure || savingCells || pendingDraftCount > 0}
              onClick={async () => {
                const label = approve ? 'اعتماد درجة الفترة' : 'نشر الدرجات دون اعتماد';
                if (approve && activeTab !== 'midyear') {
                  const snapshot=activeSubject.releases?.[activeTab];
                  const options=activeSubject.subRecords.find(r=>r.periodId===activeTab && r.name==='درجات الشهري')?.columns.filter(c=>snapshot?.columns.some(p=>p.id===c.id) && Object.keys(snapshot.cells).some(k=>k.endsWith('::'+c.id))) || [];
                  if (!options.length) { setError('انشر درجات سجل الشهري أولاً.'); return; }
                  setApproval({key:activeSubject.id+activeTab,ids:options.filter(c=>!snapshot?.approvedColumnIds || snapshot.approvedColumnIds.includes(c.id)).map(c=>c.id)});
                  return;
                }
                if (!window.confirm(label + ' للطلبة؟')) return;
                setSavingStructure(true);
                try {
                  await releaseGrades(section.id, activeSubject.id, activeTab, approve);
                  await onWorkspaceRefresh();
                  showToast(approve ? 'تم اعتماد الدرجات المكتملة.' : 'تم نشر تفاصيل الدرجات.');
                } catch (err) { setError(err instanceof Error ? err.message : 'تعذّر النشر.'); }
                finally { setSavingStructure(false); }
              }}>{approve ? 'اعتماد درجة الفترة' : 'نشر الدرجات دون اعتماد'}</button>)}
          </div>}
          {activeTab !== 'pursuit' && activeTab !== 'midyear' && approval?.key === activeSubject.id+activeTab && <fieldset className="rounded-xl border p-4 space-y-2"><legend>اختيار أشهر الاعتماد</legend>
            {activeSubject.releases?.[activeTab]?.columns.filter(c=>activeSubject.subRecords.some(r=>r.periodId===activeTab && r.name==='درجات الشهري' && r.columns.some(col=>col.id===c.id)) && Object.keys(activeSubject.releases?.[activeTab]?.cells || {}).some(k=>k.endsWith('::'+c.id))).map(c=><label key={c.id} className="block"><input type="checkbox" checked={approval.ids.includes(c.id)} onChange={e=>setApproval({...approval,ids:e.target.checked?[...approval.ids,c.id]:approval.ids.filter(id=>id!==c.id)})}/> {c.label}</label>)}
            <button className="rounded-lg border p-2" disabled={savingStructure || !approval.ids.length} onClick={async()=>{
              setSavingStructure(true);
              try { await releaseGrades(section.id,activeSubject.id,activeTab,true,approval.ids); setApproval(null); await onWorkspaceRefresh(); showToast('تم اعتماد درجة الفصل.'); }
              catch(e){setError(e instanceof Error?e.message:'تعذر الاعتماد');} finally {setSavingStructure(false);}
            }}>تثبيت واعتماد الأشهر المختارة</button> <button onClick={()=>setApproval(null)}>إلغاء</button>
          </fieldset>}
          {/* TERM 1 & TERM 2 CUSTOM SUB-RECORDS (List -> Click -> Read-Only Preview -> Edit -> Edit/Import) */}
          {(activeTab === 'term1' || activeTab === 'term2') && (() => {
            const termRecs = activeSubject.subRecords
              .filter((r) => r.periodId === activeTab)
              .sort((a, b) => a.orderIndex - b.orderIndex);
            const activeSubRec = termRecs.find((r) => r.id === openSubRecordId) || null;

            if (activeSubRec) {
              return (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 sm:p-5 space-y-4">
                  {/* Top Bar of Opened Sub-Record */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenSubRecordId(null);
                          setIsEditingRecord(false);
                          setDraftCells({});
                        }}
                        className="min-h-[36px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        <span>كل السجلات</span>
                      </button>

                      {renamingRec?.id === activeSubRec.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={renamingRec.name}
                            onChange={(e) => setRenamingRec({ ...renamingRec, name: e.target.value })}
                            className="min-h-[36px] px-3 rounded-lg bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 text-sm font-bold"
                          />
                          <button
                            type="button"
                            onClick={() => void handleRenameSubRecord()}
                            className="min-h-[36px] px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                          >
                            حفظ
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingRec(null)}
                            className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 text-xs cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-display font-extrabold text-base text-[#171A36] dark:text-white">
                            {activeSubRec.name}
                          </h4>
                          <span
                            className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold ${
                              isEditingRecord
                                ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800'
                                : 'bg-[#EEEAFF] dark:bg-violet-950/60 text-[#4320D9] dark:text-violet-200 border border-[#653CF5]/25'
                            }`}
                          >
                            {isEditingRecord ? 'وضع التعديل وإضافة الدرجات' : 'للمعاينة فقط'}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!isEditingRecord ? (
                        <button
                          type="button"
                          onClick={() => setIsEditingRecord(true)}
                          className="min-h-[40px] px-4 rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-xs sm:text-sm font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                          <span>تعديل</span>
                        </button>
                      ) : (
                        <>
                          {onRequestImport && (
                            <button
                              type="button"
                              onClick={() =>
                                onRequestImport({
                                  subjectId: activeSubject.id,
                                  periodId: activeSubRec.periodId,
                                  subRecordName: activeSubRec.name,
                                  nonce: Date.now(),
                                })
                              }
                              className="min-h-[38px] px-3.5 rounded-xl bg-[#171A36] hover:bg-[#4320D9] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                            >
                              <FileSpreadsheet className="w-4 h-4" />
                              <span>استيراد درجات</span>
                            </button>
                          )}

                          <button
                            type="button"
                            hidden={activeSubRec.name==='درجات الشهري'} disabled={activeSubRec.name==='درجات الشهري'} onClick={() => setRenamingRec({ id: activeSubRec.id, name: activeSubRec.name })}
                            className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-[#653CF5] flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>تسمية السجل</span>
                          </button>

                          {confirmDeleteRecId === activeSubRec.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void handleDeleteSubRecord(activeSubRec.id)}
                                className="min-h-[38px] px-3 rounded-xl bg-red-600 text-white text-xs font-bold cursor-pointer"
                              >
                                تأكيد حذف السجل
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteRecId(null)}
                                className="min-h-[38px] px-2 rounded-xl border border-slate-200 text-xs cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              hidden={activeSubRec.name==='درجات الشهري'} disabled={activeSubRec.name==='درجات الشهري'} onClick={() => setConfirmDeleteRecId(activeSubRec.id)}
                              className="min-h-[38px] px-2.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold flex items-center gap-1 cursor-pointer"
                              title="حذف السجل الفرعي"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>حذف</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setIsEditingRecord(false)}
                            className="min-h-[38px] px-3.5 rounded-xl bg-[#EEEAFF] dark:bg-slate-800 text-[#4320D9] dark:text-violet-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                            <span>وضع المعاينة</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isEditingRecord
                    ? renderColumnsGrid(activeSubRec.id, activeSubRec.columns)
                    : renderReadOnlyColumnsGrid(activeSubRec.columns)}
                </div>
              );
            }

            // Sub-records List + Add New Sub-Record Bar
            return (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-[#EEEAFF]/60 dark:bg-violet-950/25 border border-[#653CF5]/20 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs sm:text-sm font-extrabold text-[#4320D9] dark:text-violet-200">
                      إضافة سجل جديد في {activeTab === 'term1' ? 'الفصل الأول' : 'الفصل الثاني'}
                    </span>

                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={newSubRecordName}
                      onChange={(e) => setNewSubRecordName(e.target.value)}
                      placeholder="اكتب اسم السجل الجديد (مثال: الشهري، اليومي، النشاط...)"
                      className="flex-1 min-w-[200px] min-h-[42px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm"
                    />
                    <button
                      type="button"
                      disabled={savingStructure || !newSubRecordName.trim()}
                      onClick={() => void handleAddSubRecord(activeTab)}
                      className="min-h-[42px] px-4 rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-xs sm:text-sm font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Plus className="w-4 h-4" />
                      <span>إضافة سجل جديد</span>
                    </button>
                  </div>
                </div>

                {termRecs.length === 0 ? (
                  <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs sm:text-sm text-slate-500">
                    لا توجد سجلات في هذا الفصل.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {termRecs.map((rec) => {
                      const filledCells = activeStudents.reduce((acc, stu) => {
                        return (
                          acc +
                          rec.columns.filter((c) => getCurrentCell(stu.id, c.id).status !== 'blank').length
                        );
                      }, 0);
                      return (
                        <button
                          key={rec.id}
                          type="button"
                          onClick={() => {
                            setOpenSubRecordId(rec.id);
                            setIsEditingRecord(false);
                            setDraftCells({});
                          }}
                          className="text-right p-4 rounded-2xl bg-[#F7F7FC] dark:bg-slate-800/60 hover:bg-[#EEEAFF]/60 dark:hover:bg-violet-950/30 border border-slate-200 dark:border-slate-700 hover:border-[#653CF5]/50 transition flex items-center justify-between gap-3 cursor-pointer"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-[#653CF5]/25 text-[#653CF5] flex items-center justify-center shrink-0">
                              <FolderOpen className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-display font-extrabold text-sm sm:text-base text-[#171A36] dark:text-white truncate">
                                {rec.name}
                              </h4>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                                {rec.columns.length} عمود · {filledCells} درجة مدخلة
                              </p>
                            </div>
                          </div>
                          <span className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[#4320D9] dark:text-violet-300 text-xs font-bold flex items-center gap-1 shrink-0">
                            <Eye className="w-3.5 h-3.5" />
                            <span>معاينة</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* MIDYEAR */}
          {activeTab === 'midyear' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-display font-extrabold text-base text-[#171A36] dark:text-white">
                    درجات امتحان نصف السنة
                  </h4>
                  <span
                    className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold ${
                      isEditingMidyear
                        ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800'
                        : 'bg-[#EEEAFF] dark:bg-violet-950/60 text-[#4320D9] dark:text-violet-200 border border-[#653CF5]/25'
                    }`}
                  >
                    {isEditingMidyear ? 'وضع التعديل وإضافة الدرجات' : 'للمعاينة فقط'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!isEditingMidyear ? (
                    <button
                      type="button"
                      onClick={() => setIsEditingMidyear(true)}
                      className="min-h-[38px] px-4 rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-xs sm:text-sm font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                      <span>تعديل</span>
                    </button>
                  ) : (
                    <>
                      {onRequestImport && (
                        <button
                          type="button"
                          onClick={() =>
                            onRequestImport({
                              subjectId: activeSubject.id,
                              periodId: 'midyear',
                              subRecordName: 'نصف السنة',
                              nonce: Date.now(),
                            })
                          }
                          className="min-h-[38px] px-3.5 rounded-xl bg-[#171A36] hover:bg-[#4320D9] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                          <span>استيراد درجات</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setIsEditingMidyear(false)}
                        className="min-h-[38px] px-3.5 rounded-xl bg-[#EEEAFF] dark:bg-slate-800 text-[#4320D9] dark:text-violet-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Eye className="w-4 h-4" />
                        <span>وضع المعاينة</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {isEditingMidyear
                ? renderColumnsGrid('midyear', activeSubject.midyearColumns)
                : renderReadOnlyColumnsGrid(activeSubject.midyearColumns)}
            </div>
          )}

          {/* ANNUAL PURSUIT */}
          {activeTab === 'pursuit' && (
            <div className="space-y-5">
              <details className="rounded-xl border p-3"><summary>أعمدة اعتماد نصف السنة</summary>
                  {/* Midyear columns */}
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2">
                    <div className="font-bold text-[#4320D9] dark:text-violet-300">أعمدة نصف السنة</div>
                    {activeSubject.midyearColumns.map((c) => {
                      const checked = activeSubject.annualPursuitConfig.midyearColumnIds.includes(c.id);
                      return (
                        <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => void togglePursuitColumn('midyear', c.id)}
                            className="accent-[#653CF5]"
                          />
                          <span>
                            {c.label} (/{c.maxScore})
                          </span>
                        </label>
                      );
                    })}
                  </div>

              </details>
              {/* Annual Pursuit Summary Table */}
              <div className="overflow-x-auto thin-scrollbar rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-[#171A36] text-white">
                      <th className="p-2.5 text-right border border-slate-700 w-10">ت</th>
                      <th className="p-2.5 text-right border border-slate-700">اسم الطالب</th>
                      <th className="p-2.5 text-center border border-slate-700">معدل الفصل الأول</th>
                      <th className="p-2.5 text-center border border-slate-700">نصف السنة</th>
                      <th className="p-2.5 text-center border border-slate-700">معدل الفصل الثاني</th>
                      <th className="p-2.5 text-center border border-slate-700">السعي السنوي</th>
                      <th className="p-2.5 text-center border border-slate-700">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeStudents.map((stu, idx) => {
                      const sum = approvedSummary(activeSubject, stu.id);
                      return (
                        <tr key={stu.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="p-2.5 border border-slate-200 dark:border-slate-700 text-center font-mono-num">
                            {idx + 1}
                          </td>
                          <td className="p-2.5 border border-slate-200 dark:border-slate-700 font-bold text-[#171A36] dark:text-white">
                            {stu.fullName}
                          </td>
                          <td className="p-2.5 border border-slate-200 dark:border-slate-700 text-center font-mono-num">
                            {sum.term1Avg !== null ? sum.term1Avg : '-'}
                          </td>
                          <td className="p-2.5 border border-slate-200 dark:border-slate-700 text-center font-mono-num">
                            {sum.midyearAvg !== null ? sum.midyearAvg : '-'}
                          </td>
                          <td className="p-2.5 border border-slate-200 dark:border-slate-700 text-center font-mono-num">
                            {sum.term2Avg !== null ? sum.term2Avg : '-'}
                          </td>
                          <td className="p-2.5 border border-slate-200 dark:border-slate-700 text-center font-mono-num font-extrabold text-[#4320D9] dark:text-violet-300">
                            {sum.annualPursuit !== null ? sum.annualPursuit : '—'}
                          </td>
                          <td className="p-2.5 border border-slate-200 dark:border-slate-700 text-center text-xs">
                            {sum.isComplete ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 font-bold">
                                <Calculator className="w-3.5 h-3.5" /> مكتمل
                              </span>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-300 font-semibold">
                                بانتظار: {sum.missingPeriods.map((p) => (p === 'term1' ? 'ف1' : p === 'midyear' ? 'ن.س' : 'ف2')).join('، ')}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* A4 PDF Preview & Download Modal */}
      {pdfPreview && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h4 className="font-display font-bold text-base text-[#171A36] dark:text-white">
                معاينة كشف الدرجات بمقاس A4 ({pdfPreview.previewPages.length} صفحة)
              </h4>
              <div className="flex items-center gap-2">
                {pdfDownloadUrl && (
                  <a
                    href={pdfDownloadUrl}
                    download={pdfPreview.fileName}
                    className="min-h-[38px] px-4 rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    <span>تنزيل PDF A4</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setPdfPreview(null)}
                  className="w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 bg-slate-100 dark:bg-slate-950 space-y-4">
              {pdfPreview.previewPages.map((src, idx) => (
                <img
                  key={idx}
                  src={src}
                  alt={`صفحة A4 رقم ${idx + 1}`}
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
