import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  AlertTriangle,
  BookmarkPlus,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Save,
  Sparkles,
  SquareDashedMousePointer,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  GradeCellStatus,
  GradeCellValue,
  ImportBoundingBox,
  ImportExtractionResult,
  ImportTemplate,
  SchoolProfile,
  SchoolSection,
  SchoolStageGrade,
  SchoolStudent,
  SmartImportTarget,
  SubjectGradebook,
} from '../../types';
import { renderPdfPageFromDocument } from '../../services/documentProcessor';
import {
  commitSmartImportApi,
  deleteImportTemplateApi,
  extractSheetWithAiApi,
  saveImportTemplateApi,
  upsertStudentApi,
} from '../../services/schoolRecordClient';
import {
  findBestStudentMatch,
  MATCH_CONFIDENCE_THRESHOLD,
  normalizeDigits,
  parseRawCellValue,
} from '../../utils/arabicNameMatch';
import { formatCellDisplay, makeCellKey } from '../../utils/gradeCalculations';
import { generateMatchingA4Pdf, type A4PdfExportResult } from '../../services/a4PdfExport';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface SmartSheetImportWizardProps {
  school: SchoolProfile;
  stage?: SchoolStageGrade;
  section: SchoolSection;
  students: SchoolStudent[];
  subjects: SubjectGradebook[];
  templates: ImportTemplate[];
  onWorkspaceRefresh: () => Promise<void>;
  preselect?: SmartImportTarget | null;
  onClearPreselect?: () => void;
}

interface EditableColumnConfig {
  columnIndex: number;
  tempKey: string;
  include: boolean;
  periodId: 'term1' | 'midyear' | 'term2';
  subRecordName: string;
  label: string;
  maxScoreStr: string;
}

interface EditableRowState {
  rowIndex: number;
  rawNameText: string;
  editedName: string;
  cells: Record<number, { rawText: string; status: GradeCellStatus; scoreStr: string }>;
  matchedStudentId: string | null;
  confidence: number;
  confirmed: boolean;
}

type ConflictChoice = 'overwrite' | 'keep' | 'skip';

export const SmartSheetImportWizard: React.FC<SmartSheetImportWizardProps> = ({
  school,
  stage,
  section,
  students,
  subjects,
  templates,
  onWorkspaceRefresh,
  preselect,
  onClearPreselect,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Source state
  const [sheetImageUrl, setSheetImageUrl] = useState('');
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [description, setDescription] = useState('');

  // Live Camera state
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Mode & Bounding Boxes
  const [extractMode, setExtractMode] = useState<'auto' | 'manual'>('auto');
  const [boxes, setBoxes] = useState<ImportBoundingBox[]>([]);
  const [drawRole, setDrawRole] = useState<'name' | 'score'>('score');
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [templateName, setTemplateName] = useState('');
  const imageContainerRef = useRef<HTMLDivElement | null>(null);

  // Extraction & Editable Tables
  const [extracting, setExtracting] = useState(false);
  const [extraction, setExtraction] = useState<ImportExtractionResult | null>(null);
  const [columns, setColumns] = useState<EditableColumnConfig[]>([]);
  const [rows, setRows] = useState<EditableRowState[]>([]);

  // Target subject & conflicts & A4 PDF
  const [targetSubjectId, setTargetSubjectId] = useState<string>(subjects[0]?.id || '__new__');
  const [newSubjectName, setNewSubjectName] = useState('');
  const [conflictChoices, setConflictChoices] = useState<Record<string, ConflictChoice>>({});
  const [pdfPreview, setPdfPreview] = useState<A4PdfExportResult | null>(null);
  const [pdfDownloadUrl, setPdfDownloadUrl] = useState('');

  const [committing, setCommitting] = useState(false);
  const [addingStudentRow, setAddingStudentRow] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (!preselect) return;
    if (preselect.subjectId) {
      setTargetSubjectId(preselect.subjectId);
    }
    setColumns((prev) =>
      prev.map((c) => ({
        ...c,
        periodId: preselect.periodId,
        subRecordName: preselect.periodId === 'midyear' ? '' : preselect.subRecordName || c.subRecordName,
      }))
    );
  }, [preselect]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!pdfPreview) {
      setPdfDownloadUrl('');
      return;
    }
    const url = URL.createObjectURL(pdfPreview.pdfBlob);
    setPdfDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdfPreview]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const startCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 50);
    } catch {
      setError('تعذر تشغيل الكاميرا. تأكد من منح إذن الكاميرا للمتصفح أو ارفع صورة الكشف.');
    }
  };

  const captureCameraFrame = () => {
    const vid = videoRef.current;
    if (!vid) return;
    const canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth || 1280;
    canvas.height = vid.videoHeight || 960;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    setSheetImageUrl(canvas.toDataURL('image/jpeg', 0.9));
    setPdfDoc(null);
    stopCamera();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setSuccessMsg('');
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      try {
        const buffer = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
        setPdfDoc(doc);
        setPdfTotalPages(doc.numPages);
        setPdfPage(1);
        const rendered = await renderPdfPageFromDocument(doc, 1, 1.8, true);
        setSheetImageUrl(rendered.imageData);
      } catch {
        setError('تعذر قراءة ملف PDF المرفوع.');
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPdfDoc(null);
        setSheetImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const changePdfPage = async (nextPage: number) => {
    if (!pdfDoc || nextPage < 1 || nextPage > pdfTotalPages) return;
    setPdfPage(nextPage);
    const rendered = await renderPdfPageFromDocument(pdfDoc, nextPage, 1.8, true);
    setSheetImageUrl(rendered.imageData);
  };

  // Manual Bounding Box Drawing
  const getRelativePoint = (clientX: number, clientY: number) => {
    const el = imageContainerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (extractMode !== 'manual') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getRelativePoint(e.clientX, e.clientY);
    setDrawStart(pt);
    setDrawCurrent(pt);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (extractMode !== 'manual' || !drawStart) return;
    setDrawCurrent(getRelativePoint(e.clientX, e.clientY));
  };

  const handlePointerUp = () => {
    if (extractMode !== 'manual' || !drawStart || !drawCurrent) return;
    const x = Math.min(drawStart.x, drawCurrent.x);
    const y = Math.min(drawStart.y, drawCurrent.y);
    const width = Math.abs(drawCurrent.x - drawStart.x);
    const height = Math.abs(drawCurrent.y - drawStart.y);
    if (width >= 0.025 && height >= 0.025) {
      const scoreCount = boxes.filter((b) => b.role === 'score').length;
      const colOrder = drawRole === 'name' ? 0 : scoreCount + 1;
      setBoxes((prev) => [
        ...prev,
        {
          id: `box_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          label: drawRole === 'name' ? 'عمود الأسماء' : `عمود ${colOrder}`,
          role: drawRole,
          columnOrder: colOrder,
          x,
          y,
          width,
          height,
        },
      ]);
    }
    setDrawStart(null);
    setDrawCurrent(null);
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim() || boxes.length === 0) {
      setError('أدخل اسم القالب وحدد مربعاً واحداً على الأقل.');
      return;
    }
    setError('');
    try {
      await saveImportTemplateApi({
        name: templateName.trim(),
        description: description.trim(),
        boxes,
      });
      setTemplateName('');
      await onWorkspaceRefresh();
      setSuccessMsg('تم حفظ القالب بنجاح.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ القالب.');
    }
  };

  // Run AI Sheet Extraction
  const handleRunExtraction = async () => {
    if (!sheetImageUrl) {
      setError('يرجى رفع صورة الكشف أو التقاطها أولاً.');
      return;
    }
    if (extractMode === 'manual' && boxes.length === 0) {
      setError('يرجى رسم المربعات اليدوية على الصورة أو اختيار قالب محفوظ أو التبديل للتحليل التلقائي.');
      return;
    }
    setError('');
    setSuccessMsg('');
    setExtracting(true);
    try {
      const res = await extractSheetWithAiApi({
        imageDataUrl: sheetImageUrl,
        description: description.trim(),
        boxes: extractMode === 'manual' ? boxes : undefined,
      });
      setExtraction(res);

      // Determine column indices from headers or rows
      const colIndicesSet = new Set<number>();
      res.detectedHeaders.forEach((h) => colIndicesSet.add(h.columnIndex));
      res.rows.forEach((r) => r.cells.forEach((c) => colIndicesSet.add(c.columnIndex)));
      const sortedIndices = Array.from(colIndicesSet).sort((a, b) => a - b);
      if (sortedIndices.length === 0) sortedIndices.push(1);

      const headerMap = new Map(res.detectedHeaders.map((h) => [h.columnIndex, h]));
      const defaultPeriodId = preselect?.periodId || 'term1';
      const defaultSubRecordName =
        defaultPeriodId === 'midyear' ? '' : preselect?.subRecordName || 'استيراد كشف';
      const nextCols: EditableColumnConfig[] = sortedIndices.map((cIdx) => {
        const hdr = headerMap.get(cIdx);
        return {
          columnIndex: cIdx,
          tempKey: `imp_col_${cIdx}`,
          include: true,
          periodId: defaultPeriodId,
          subRecordName: defaultSubRecordName,
          // Never guess missing title or maxScore! Leave blank if AI didn't read one
          label: hdr?.label || '',
          maxScoreStr: hdr?.maxScore !== null && hdr?.maxScore !== undefined ? String(hdr.maxScore) : '',
        };
      });

      const activeStudents = students.filter((s) => s.status === 'active');
      const nextRows: EditableRowState[] = res.rows.map((r) => {
        const cellMap: EditableRowState['cells'] = {};
        for (const cIdx of sortedIndices) {
          const found = r.cells.find((c) => c.columnIndex === cIdx);
          const rawText = found?.rawText ?? '-';
          const parsed = found
            ? { status: found.parsedStatus, score: found.parsedScore }
            : parseRawCellValue(rawText);
          cellMap[cIdx] = {
            rawText,
            status: parsed.status,
            scoreStr: parsed.status === 'score' && parsed.score !== null ? String(parsed.score) : '',
          };
        }

        const match = findBestStudentMatch(r.rawNameText, activeStudents);
        return {
          rowIndex: r.rowIndex,
          rawNameText: r.rawNameText,
          editedName: r.rawNameText,
          cells: cellMap,
          matchedStudentId: match.studentId,
          confidence: match.confidence,
          confirmed: !match.needsReview && Boolean(match.studentId),
        };
      });

      setColumns(nextCols);
      setRows(nextRows);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحليل الكشف بالذكاء الاصطناعي.');
    } finally {
      setExtracting(false);
    }
  };

  // Re-run matching against current students whenever student list changes or name edited
  const recomputeMatches = (currentRows: EditableRowState[], currentStudents: SchoolStudent[]) => {
    const activeSt = currentStudents.filter((s) => s.status === 'active');
    return currentRows.map((r) => {
      if (r.matchedStudentId && activeSt.some((s) => s.id === r.matchedStudentId) && r.confirmed) {
        return r;
      }
      const match = findBestStudentMatch(r.editedName, activeSt);
      return {
        ...r,
        matchedStudentId: match.studentId,
        confidence: match.confidence,
        confirmed: !match.needsReview && Boolean(match.studentId),
      };
    });
  };

  const handleAddMissingStudent = async (rowIdx: number, rawName: string) => {
    const cleanName = rawName.trim();
    if (!cleanName) return;
    setAddingStudentRow(rowIdx);
    setError('');
    try {
      const created = await upsertStudentApi(section.id, {
        fullName: cleanName,
        status: 'active',
      });
      setRows((prev) =>
        prev.map((r) =>
          r.rowIndex === rowIdx
            ? {
                ...r,
                matchedStudentId: created.id,
                confidence: 100,
                confirmed: true,
              }
            : r
        )
      );
      await onWorkspaceRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة الطالب للشعبة.');
    } finally {
      setAddingStudentRow(null);
    }
  };

  // Validation gates before Step 5 / Atomic Commit
  const validationState = useMemo(() => {
    const includedCols = columns.filter((c) => c.include);
    const missingHeaders = includedCols.filter((c) => !c.label.trim());
    const invalidMaxCols = includedCols.filter((c) => {
      const m = Number(normalizeDigits(c.maxScoreStr));
      return !c.maxScoreStr.trim() || Number.isNaN(m) || m <= 0 || m > 1000;
    });

    const overMaxCells: { rowIndex: number; colLabel: string; val: number; max: number }[] = [];
    for (const r of rows) {
      for (const col of includedCols) {
        const cell = r.cells[col.columnIndex];
        const max = Number(normalizeDigits(col.maxScoreStr)) || 0;
        if (cell && cell.status === 'score') {
          const num = Number(normalizeDigits(cell.scoreStr));
          if (cell.scoreStr.trim() === '' || Number.isNaN(num) || num < 0 || (max > 0 && num > max)) {
            overMaxCells.push({
              rowIndex: r.rowIndex,
              colLabel: col.label || `عمود ${col.columnIndex}`,
              val: Number.isNaN(num) ? -1 : num,
              max,
            });
          }
        }
      }
    }

    const totalRows = rows.length;
    const highConfidenceCount = rows.filter(
      (r) => r.matchedStudentId && r.confidence >= MATCH_CONFIDENCE_THRESHOLD
    ).length;
    const matchRatePct = totalRows > 0 ? Math.round((highConfidenceCount / totalRows) * 100) : 0;
    const unconfirmedRows = rows.filter((r) => !r.confirmed || !r.matchedStudentId);

    const canMigrate =
      includedCols.length > 0 &&
      missingHeaders.length === 0 &&
      invalidMaxCols.length === 0 &&
      overMaxCells.length === 0 &&
      totalRows > 0 &&
      matchRatePct >= MATCH_CONFIDENCE_THRESHOLD &&
      unconfirmedRows.length === 0;

    return {
      includedCols,
      missingHeaders,
      invalidMaxCols,
      overMaxCells,
      matchRatePct,
      unconfirmedRows,
      canMigrate,
    };
  }, [columns, rows]);

  const targetSubject = useMemo(
    () => subjects.find((s) => s.id === targetSubjectId) || null,
    [subjects, targetSubjectId]
  );

  // Detect conflicts against existing cells in targetSubject
  const conflicts = useMemo(() => {
    if (!targetSubject) return [];
    const list: {
      conflictKey: string;
      studentId: string;
      studentName: string;
      tempKey: string;
      columnLabel: string;
      existingDisplay: string;
      newDisplay: string;
    }[] = [];

    for (const col of validationState.includedCols) {
      let existingColId: string | null = null;
      if (col.periodId === 'midyear') {
        existingColId = targetSubject.midyearColumns.find((c) => c.label === col.label.trim())?.id || null;
      } else {
        const rec = targetSubject.subRecords.find(
          (r) => r.periodId === col.periodId && r.name === col.subRecordName.trim()
        );
        existingColId = rec?.columns.find((c) => c.label === col.label.trim())?.id || null;
      }
      if (!existingColId) continue;

      for (const r of rows) {
        if (!r.matchedStudentId) continue;
        const existingCell = targetSubject.cells[makeCellKey(r.matchedStudentId, existingColId)];
        if (!existingCell || existingCell.status === 'blank') continue;

        const cState = r.cells[col.columnIndex];
        const newCell: GradeCellValue =
          cState?.status === 'score'
            ? { status: 'score', score: Number(normalizeDigits(cState.scoreStr)) }
            : { status: cState?.status || 'blank', score: null };

        const st = students.find((s) => s.id === r.matchedStudentId);
        list.push({
          conflictKey: `${r.matchedStudentId}::${col.tempKey}`,
          studentId: r.matchedStudentId,
          studentName: st?.fullName || r.editedName,
          tempKey: col.tempKey,
          columnLabel: col.label,
          existingDisplay: formatCellDisplay(existingCell),
          newDisplay: formatCellDisplay(newCell),
        });
      }
    }
    return list;
  }, [targetSubject, validationState.includedCols, rows, students]);

  const buildStep5Preview = () => {
    const subjLabel =
      targetSubjectId === '__new__'
        ? newSubjectName.trim() || 'مادة مستوردة'
        : targetSubject?.name || 'مادة مستوردة';
    const preview = generateMatchingA4Pdf({
      schoolName: school.name,
      directorate: school.directorate,
      academicYear: school.academicYear,
      sectionLabel: `${stage ? stage.name + ' — ' : ''}${section.name}`,
      subjectLabel: subjLabel,
      subtitle: 'كشف مطابق لعملية الاستيراد الذكي قبل الترحيل النهائي',
      columns: validationState.includedCols.map((c) => ({
        label: c.label || `عمود ${c.columnIndex}`,
        maxScoreLabel: `من ${c.maxScoreStr}`,
      })),
      rows: rows.map((r) => {
        const st = students.find((s) => s.id === r.matchedStudentId);
        return {
          studentName: st?.fullName || r.editedName,
          cells: validationState.includedCols.map((col) => {
            const c = r.cells[col.columnIndex];
            if (!c || c.status === 'blank') return '-';
            if (c.status === 'absent') return 'غائب';
            if (c.status === 'exempt') return 'معفى';
            return c.scoreStr;
          }),
        };
      }),
    });
    setPdfPreview(preview);
  };

  const handleAtomicCommit = async () => {
    if (!validationState.canMigrate) {
      setError('لا يمكن الترحيل قبل معالجة جميع التنبيهات وتأكيد الأسماء.');
      return;
    }
    if (targetSubjectId === '__new__' && !newSubjectName.trim()) {
      setError('يرجى اختيار مادة موجودة أو كتابة اسم مادة جديدة.');
      return;
    }

    setError('');
    setCommitting(true);
    try {
      const columnsSpec = validationState.includedCols.map((col) => ({
        tempKey: col.tempKey,
        periodId: col.periodId,
        subRecordName: col.subRecordName.trim() || 'استيراد كشف',
        columnLabel: col.label.trim(),
        maxScore: Number(normalizeDigits(col.maxScoreStr)),
      }));

      const entries: {
        studentId: string;
        tempKey: string;
        value: GradeCellValue;
        resolution: ConflictChoice;
      }[] = [];

      for (const r of rows) {
        if (!r.matchedStudentId) continue;
        for (const col of validationState.includedCols) {
          const c = r.cells[col.columnIndex];
          const val: GradeCellValue =
            c?.status === 'score'
              ? { status: 'score', score: Number(normalizeDigits(c.scoreStr)) }
              : { status: c?.status || 'blank', score: null };
          const ck = `${r.matchedStudentId}::${col.tempKey}`;
          const choice: ConflictChoice = conflictChoices[ck] || 'overwrite';
          entries.push({
            studentId: r.matchedStudentId,
            tempKey: col.tempKey,
            value: val,
            resolution: choice,
          });
        }
      }

      const res = await commitSmartImportApi(section.id, {
        subjectId: targetSubjectId !== '__new__' ? targetSubjectId : undefined,
        newSubjectName: targetSubjectId === '__new__' ? newSubjectName.trim() : undefined,
        columnsSpec,
        entries,
      });

      await onWorkspaceRefresh();
      setSuccessMsg(`تم الترحيل الذري بنجاح! طُبقت ${res.appliedCount} خلية (تخطي ${res.skippedCount}).`);
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الترحيل الذري وتم التراجع عن التغييرات.');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 space-y-5">
      {preselect && (
        <div className="p-3.5 rounded-xl bg-[#EEEAFF] dark:bg-violet-950/40 border border-[#653CF5]/30 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 text-[#4320D9] dark:text-violet-200 font-bold">
            <Sparkles className="w-4 h-4 text-[#653CF5]" />
            <span>
              الاستيراد الموجّه إلى: {subjects.find((s) => s.id === preselect.subjectId)?.name || 'المادة'} ←{' '}
              {preselect.periodId === 'term1'
                ? 'الفصل الأول'
                : preselect.periodId === 'term2'
                ? 'الفصل الثاني'
                : 'نصف السنة'}
              {preselect.periodId !== 'midyear' && preselect.subRecordName
                ? ` ← سجل «${preselect.subRecordName}»`
                : ''}
            </span>
          </div>
          {onClearPreselect && (
            <button
              type="button"
              onClick={onClearPreselect}
              className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-semibold cursor-pointer"
            >
              إلغاء التحديد المسبق
            </button>
          )}
        </div>
      )}

      {/* Stepper Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-[#EEEAFF] dark:bg-violet-950/60 text-[#653CF5] flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-bold text-base sm:text-lg text-[#171A36] dark:text-white">
              الاستيراد الذكي لكشوف الدرجات وتصدير A4
            </h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { n: 1, t: '1. المصدر' },
            { n: 2, t: '2. النص الخام' },
            { n: 3, t: '3. التحرير' },
            { n: 4, t: '4. المطابقة' },
            { n: 5, t: '5. A4 والترحيل' },
          ].map((s) => (
            <button
              key={s.n}
              type="button"
              disabled={s.n > 1 && !extraction}
              onClick={() => {
                if (s.n === 5) buildStep5Preview();
                setStep(s.n as 1 | 2 | 3 | 4 | 5);
              }}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-40 ${
                step === s.n
                  ? 'bg-[#653CF5] text-white'
                  : 'bg-[#F7F7FC] dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {s.t}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* STEP 1: Source & Mode */}
      {step === 1 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="min-h-[54px] px-4 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-dashed border-[#653CF5]/50 hover:border-[#653CF5] flex items-center justify-center gap-2 text-xs sm:text-sm font-bold text-[#4320D9] dark:text-violet-300 cursor-pointer">
              <Upload className="w-4 h-4" />
              <span>رفع صورة أو ملف PDF</span>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => void handleFileUpload(e)}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={() => (cameraActive ? stopCamera() : void startCamera())}
              className="min-h-[54px] px-4 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-2 text-xs sm:text-sm font-bold text-[#171A36] dark:text-white cursor-pointer"
            >
              <Camera className="w-4 h-4 text-[#653CF5]" />
              <span>{cameraActive ? 'إيقاف الكاميرا' : 'التقاط بالكاميرا المباشرة'}</span>
            </button>

            <div className="flex rounded-xl bg-[#F7F7FC] dark:bg-slate-800 p-1 border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setExtractMode('auto')}
                className={`flex-1 rounded-lg text-xs font-bold flex items-center justify-center gap-1 cursor-pointer ${
                  extractMode === 'auto' ? 'bg-[#653CF5] text-white' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>تحليل تلقائي AI</span>
              </button>
              <button
                type="button"
                onClick={() => setExtractMode('manual')}
                className={`flex-1 rounded-lg text-xs font-bold flex items-center justify-center gap-1 cursor-pointer ${
                  extractMode === 'manual' ? 'bg-[#653CF5] text-white' : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <SquareDashedMousePointer className="w-3.5 h-3.5" />
                <span>مربعات يدوية + قوالب</span>
              </button>
            </div>
          </div>

          {cameraActive && (
            <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-black relative">
              <video ref={videoRef} playsInline muted className="w-full max-h-[380px] object-contain mx-auto" />
              <div className="p-3 bg-slate-900 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={captureCameraFrame}
                  className="min-h-[42px] px-5 rounded-xl bg-[#653CF5] text-white text-sm font-bold cursor-pointer"
                >
                  التقاط الصورة الآن
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="min-h-[42px] px-4 rounded-xl bg-slate-700 text-white text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </div>
          )}

          {pdfDoc && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-[#EEEAFF]/60 dark:bg-violet-950/30 border border-[#653CF5]/25 text-xs">
              <span className="font-bold text-[#4320D9] dark:text-violet-300">
                صفحة PDF الحالية: {pdfPage} من {pdfTotalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={pdfPage <= 1}
                  onClick={() => void changePdfPage(pdfPage - 1)}
                  className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={pdfPage >= pdfTotalPages}
                  onClick={() => void changePdfPage(pdfPage + 1)}
                  className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Optional Description */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              وصف اختياري لترتيب الأعمدة أو الملاحظات (يساعد التحليل البصري)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثال: جدول من اليمين الاسم ثم عمود الشهر الأول من 20 ثم عمود اليومي من 10..."
              className="w-full min-h-[42px] px-3 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm"
            />
          </div>

          {/* Manual Boxes Toolbar & Saved Templates */}
          {extractMode === 'manual' && (
            <div className="p-4 rounded-2xl bg-[#F7F7FC] dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold">ارسم بالسحب على الصورة:</span>
                  <button
                    type="button"
                    onClick={() => setDrawRole('name')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                      drawRole === 'name'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200'
                    }`}
                  >
                    مربع عمود الأسماء
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawRole('score')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                      drawRole === 'score'
                        ? 'bg-[#653CF5] text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200'
                    }`}
                  >
                    مربع عمود درجات ({boxes.filter((b) => b.role === 'score').length + 1})
                  </button>
                  {boxes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBoxes([])}
                      className="px-2.5 py-1.5 rounded-lg text-xs text-red-600 hover:bg-red-50 font-semibold cursor-pointer"
                    >
                      مسح المربعات ({boxes.length})
                    </button>
                  )}
                </div>

                {/* Save current boxes as template */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="اسم لحفظ القالب..."
                    className="min-h-[34px] px-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveTemplate()}
                    className="min-h-[34px] px-3 rounded-lg bg-[#171A36] text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <BookmarkPlus className="w-3.5 h-3.5" />
                    <span>حفظ القالب</span>
                  </button>
                </div>
              </div>

              {templates.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-[11px] font-bold text-slate-500">القوالب المحفوظة:</span>
                  {templates.map((tpl) => (
                    <div
                      key={tpl.id}
                      className="inline-flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => setBoxes(tpl.boxes)}
                        className="font-bold text-[#653CF5] hover:underline cursor-pointer"
                      >
                        تطبيق: {tpl.name} ({tpl.boxes.length})
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteImportTemplateApi(tpl.id);
                          await onWorkspaceRefresh();
                        }}
                        className="text-slate-400 hover:text-red-600 cursor-pointer"
                        title="حذف القالب"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Sheet Image Preview & Interactive Box Overlay */}
          {sheetImageUrl ? (
            <div className="space-y-3">
              <div
                ref={imageContainerRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className={`relative mx-auto max-w-3xl rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 select-none ${
                  extractMode === 'manual' ? 'cursor-crosshair touch-none' : ''
                }`}
              >
                <img src={sheetImageUrl} alt="ورقة الكشف" className="w-full h-auto block pointer-events-none" />
                {boxes.map((b) => (
                  <div
                    key={b.id}
                    style={{
                      left: `${b.x * 100}%`,
                      top: `${b.y * 100}%`,
                      width: `${b.width * 100}%`,
                      height: `${b.height * 100}%`,
                    }}
                    className={`absolute border-2 flex items-start justify-between p-1 text-[10px] font-bold ${
                      b.role === 'name'
                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-950'
                        : 'border-[#653CF5] bg-[#653CF5]/15 text-[#171A36]'
                    }`}
                  >
                    <span className="px-1.5 py-0.5 rounded bg-white/90 shadow-xs">{b.label}</span>
                    <button
                      type="button"
                      onPointerDown={(ev) => ev.stopPropagation()}
                      onClick={() => setBoxes((prev) => prev.filter((x) => x.id !== b.id))}
                      className="w-4 h-4 rounded bg-red-600 text-white flex items-center justify-center cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {drawStart && drawCurrent && (
                  <div
                    style={{
                      left: `${Math.min(drawStart.x, drawCurrent.x) * 100}%`,
                      top: `${Math.min(drawStart.y, drawCurrent.y) * 100}%`,
                      width: `${Math.abs(drawCurrent.x - drawStart.x) * 100}%`,
                      height: `${Math.abs(drawCurrent.y - drawStart.y) * 100}%`,
                    }}
                    className="absolute border-2 border-dashed border-amber-500 bg-amber-400/20 pointer-events-none"
                  />
                )}
              </div>

              <button
                type="button"
                disabled={extracting}
                onClick={() => void handleRunExtraction()}
                className="w-full min-h-[48px] rounded-xl bg-[#653CF5] hover:bg-[#4320D9] text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {extracting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                <span>{extracting ? 'جاري التحليل البصري RTL ومنع الدمج...' : 'استخراج بيانات الكشف الآن'}</span>
              </button>
            </div>
          ) : (
            <div className="p-10 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center space-y-2 text-slate-400">
              <ImageIcon className="w-10 h-10 mx-auto" />
            </div>
          )}
        </div>
      )}

      {/* STEP 2: Cell-by-Cell Raw Text Review */}
      {step === 2 && extraction && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-[#EEEAFF]/60 dark:bg-violet-950/30 border border-[#653CF5]/20 text-xs space-y-1">
            <p className="font-bold text-[#4320D9] dark:text-violet-300">
              الخطوة 2: مراجعة النص الخام المستخرج خلية بخلية (RTL من اليمين إلى اليسار)
            </p>
          </div>

          {extraction.warnings.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200 space-y-1">
              <p className="font-bold">تنبيهات التحليل البصري:</p>
              {extraction.warnings.map((w, i) => (
                <p key={i}>• {w}</p>
              ))}
            </div>
          )}

          <div className="overflow-x-auto thin-scrollbar rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-[#171A36] text-white">
                  <th className="p-2.5 border border-slate-700">#</th>
                  <th className="p-2.5 border border-slate-700 text-right">الاسم الخام المستخرج</th>
                  {columns.map((col) => (
                    <th key={col.columnIndex} className="p-2.5 border border-slate-700 text-center">
                      العمود {col.columnIndex} {col.label ? `(${col.label})` : '(بدون عنوان)'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowIndex}>
                    <td className="p-2 border border-slate-200 dark:border-slate-700 text-center font-mono-num">
                      {r.rowIndex}
                    </td>
                    <td className="p-2 border border-slate-200 dark:border-slate-700 font-semibold">
                      {r.rawNameText || <span className="text-red-500">[اسم مفقود]</span>}
                    </td>
                    {columns.map((col) => {
                      const raw = r.cells[col.columnIndex]?.rawText || '-';
                      return (
                        <td
                          key={col.columnIndex}
                          className={`p-2 border border-slate-200 dark:border-slate-700 text-center font-mono-num ${
                            raw.includes('غير واضح') ? 'bg-amber-50 text-amber-800 font-bold' : ''
                          }`}
                        >
                          {raw}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
            >
              رجوع للمصدر
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="min-h-[42px] px-5 rounded-xl bg-[#653CF5] text-white text-xs sm:text-sm font-bold cursor-pointer"
            >
              التالي: تحرير الجدول وضبط الأعمدة
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Editable Table & Column Setup */}
      {step === 3 && (
        <div className="space-y-4">

          {/* Column configs */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {columns.map((col) => (
              <div
                key={col.columnIndex}
                className={`p-3.5 rounded-xl border space-y-2.5 text-xs ${
                  col.include
                    ? 'bg-[#F7F7FC] dark:bg-slate-800/70 border-[#653CF5]/30'
                    : 'bg-slate-50 dark:bg-slate-900 border-slate-200 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#4320D9] dark:text-violet-300">
                    عمود رقم {col.columnIndex}
                  </span>
                  <label className="flex items-center gap-1.5 font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={col.include}
                      onChange={(e) =>
                        setColumns((prev) =>
                          prev.map((c) =>
                            c.columnIndex === col.columnIndex ? { ...c, include: e.target.checked } : c
                          )
                        )
                      }
                      className="accent-[#653CF5]"
                    />
                    <span>تضمين بالترحيل</span>
                  </label>
                </div>

                {col.include && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={col.periodId}
                        onChange={(e) =>
                          setColumns((prev) =>
                            prev.map((c) =>
                              c.columnIndex === col.columnIndex
                                ? { ...c, periodId: e.target.value as EditableColumnConfig['periodId'] }
                                : c
                            )
                          )
                        }
                        className="min-h-[34px] px-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      >
                        <option value="term1">الفصل الأول</option>
                        <option value="midyear">نصف السنة</option>
                        <option value="term2">الفصل الثاني</option>
                      </select>
                      <input
                        type="text"
                        value={col.maxScoreStr}
                        onChange={(e) =>
                          setColumns((prev) =>
                            prev.map((c) =>
                              c.columnIndex === col.columnIndex ? { ...c, maxScoreStr: e.target.value } : c
                            )
                          )
                        }
                        placeholder="الدرجة العظمى *"
                        className={`min-h-[34px] px-2 rounded-lg bg-white dark:bg-slate-900 border font-mono-num ${
                          !col.maxScoreStr.trim() ? 'border-amber-500' : 'border-slate-200 dark:border-slate-700'
                        }`}
                      />
                    </div>

                    {col.periodId !== 'midyear' && (
                      <input
                        type="text"
                        value={col.subRecordName}
                        onChange={(e) =>
                          setColumns((prev) =>
                            prev.map((c) =>
                              c.columnIndex === col.columnIndex ? { ...c, subRecordName: e.target.value } : c
                            )
                          )
                        }
                        placeholder="اسم السجل الفرعي (مثال: يومي، شهري)"
                        className="w-full min-h-[34px] px-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      />
                    )}

                    <input
                      type="text"
                      value={col.label}
                      onChange={(e) =>
                        setColumns((prev) =>
                          prev.map((c) =>
                            c.columnIndex === col.columnIndex ? { ...c, label: e.target.value } : c
                          )
                        )
                      }
                      placeholder="عنوان العمود * (إلزامي)"
                      className={`w-full min-h-[34px] px-2.5 rounded-lg bg-white dark:bg-slate-900 border ${
                        !col.label.trim() ? 'border-amber-500' : 'border-slate-200 dark:border-slate-700'
                      }`}
                    />
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Editable grid */}
          <div className="overflow-x-auto thin-scrollbar rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-[#171A36] text-white">
                  <th className="p-2 border border-slate-700">#</th>
                  <th className="p-2 border border-slate-700 text-right min-w-[180px]">اسم الطالب</th>
                  {validationState.includedCols.map((col) => (
                    <th key={col.columnIndex} className="p-2 border border-slate-700 text-center min-w-[140px]">
                      {col.label || `عمود ${col.columnIndex}`} ({col.maxScoreStr || '؟'})
                    </th>
                  ))}
                  <th className="p-2 border border-slate-700">حذف</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowIndex}>
                    <td className="p-2 border border-slate-200 dark:border-slate-700 text-center font-mono-num">
                      {r.rowIndex}
                    </td>
                    <td className="p-1.5 border border-slate-200 dark:border-slate-700">
                      <input
                        type="text"
                        value={r.editedName}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRows((prev) =>
                            prev.map((row) =>
                              row.rowIndex === r.rowIndex ? { ...row, editedName: val } : row
                            )
                          );
                        }}
                        className="w-full min-h-[32px] px-2 rounded bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                      />
                    </td>
                    {validationState.includedCols.map((col) => {
                      const cell = r.cells[col.columnIndex] || { rawText: '-', status: 'blank', scoreStr: '' };
                      const max = Number(normalizeDigits(col.maxScoreStr)) || 0;
                      const num = Number(normalizeDigits(cell.scoreStr));
                      const overMax =
                        cell.status === 'score' && (cell.scoreStr.trim() === '' || Number.isNaN(num) || num < 0 || (max > 0 && num > max));
                      return (
                        <td
                          key={col.columnIndex}
                          className={`p-1.5 border border-slate-200 dark:border-slate-700 ${
                            overMax ? 'bg-red-50' : ''
                          }`}
                        >
                          <div className="flex items-center gap-1">
                            <select
                              value={cell.status}
                              onChange={(e) => {
                                const st = e.target.value as GradeCellStatus;
                                setRows((prev) =>
                                  prev.map((row) =>
                                    row.rowIndex === r.rowIndex
                                      ? {
                                          ...row,
                                          cells: {
                                            ...row.cells,
                                            [col.columnIndex]: {
                                              ...cell,
                                              status: st,
                                              scoreStr: st === 'score' ? (cell.scoreStr || '0') : '',
                                            },
                                          },
                                        }
                                      : row
                                  )
                                );
                              }}
                              className="min-h-[30px] px-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px]"
                            >
                              <option value="score">رقم</option>
                              <option value="blank">-</option>
                              <option value="absent">غائب</option>
                              <option value="exempt">معفى</option>
                            </select>
                            {cell.status === 'score' && (
                              <input
                                type="text"
                                value={cell.scoreStr}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setRows((prev) =>
                                    prev.map((row) =>
                                      row.rowIndex === r.rowIndex
                                        ? {
                                            ...row,
                                            cells: {
                                              ...row.cells,
                                              [col.columnIndex]: { ...cell, scoreStr: v },
                                            },
                                          }
                                        : row
                                    )
                                  );
                                }}
                                className={`w-16 min-h-[30px] px-1.5 rounded border text-center font-mono-num ${
                                  overMax ? 'border-red-500 text-red-700' : 'border-slate-200 dark:border-slate-700'
                                }`}
                              />
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="p-1.5 border border-slate-200 dark:border-slate-700 text-center">
                      <button
                        type="button"
                        onClick={() => setRows((prev) => prev.filter((x) => x.rowIndex !== r.rowIndex))}
                        className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-xs font-bold cursor-pointer"
            >
              السابق
            </button>
            <button
              type="button"
              onClick={() => {
                setRows((prev) => recomputeMatches(prev, students));
                setStep(4);
              }}
              className="min-h-[42px] px-5 rounded-xl bg-[#653CF5] text-white text-xs sm:text-sm font-bold cursor-pointer"
            >
              التالي: مطابقة الأسماء والتحقق
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Arabic Name Matching & Blocking Rules */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-500 block">نسبة التطابق الكلية</span>
              <span
                className={`font-mono-num text-lg font-extrabold ${
                  validationState.matchRatePct >= MATCH_CONFIDENCE_THRESHOLD ? 'text-emerald-600' : 'text-red-600'
                }`}
              >
                {validationState.matchRatePct}%
              </span>
              <span className="block text-[11px] text-slate-400">(الحد الأدنى الإلزامي 70%)</span>
            </div>

            <div className="p-3.5 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-500 block">الصفوف غير المؤكدة</span>
              <span
                className={`font-mono-num text-lg font-extrabold ${
                  validationState.unconfirmedRows.length === 0 ? 'text-emerald-600' : 'text-amber-600'
                }`}
              >
                {validationState.unconfirmedRows.length}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-500 block">درجات تتجاوز العظمى / ناقصة</span>
              <span
                className={`font-mono-num text-lg font-extrabold ${
                  validationState.overMaxCells.length === 0 &&
                  validationState.missingHeaders.length === 0 &&
                  validationState.invalidMaxCols.length === 0
                    ? 'text-emerald-600'
                    : 'text-red-600'
                }`}
              >
                {validationState.overMaxCells.length +
                  validationState.missingHeaders.length +
                  validationState.invalidMaxCols.length}
              </span>
            </div>
          </div>

          {!validationState.canMigrate && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 space-y-1">
              <p className="font-bold">الترحيل محجوب للأسباب التالية:</p>
              {validationState.matchRatePct < 70 && <p>• نسبة التطابق أقل من 70% ({validationState.matchRatePct}%).</p>}
              {validationState.unconfirmedRows.length > 0 && (
                <p>• يوجد {validationState.unconfirmedRows.length} صفاً غير مؤكد أو غير مربوط بطالب.</p>
              )}
              {validationState.missingHeaders.length > 0 && <p>• يوجد أعمدة مضمّنة بدون عنوان.</p>}
              {validationState.invalidMaxCols.length > 0 && <p>• يوجد أعمدة مضمّنة بدون درجة عظمى صالحة.</p>}
              {validationState.overMaxCells.length > 0 && (
                <p>• يوجد {validationState.overMaxCells.length} درجة تتجاوز الدرجة العظمى للعمود.</p>
              )}
            </div>
          )}

          <div className="overflow-x-auto thin-scrollbar rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-[#171A36] text-white">
                  <th className="p-2.5 border border-slate-700">الاسم في الكشف</th>
                  <th className="p-2.5 border border-slate-700">الطالب المطابق في الشعبة</th>
                  <th className="p-2.5 border border-slate-700">التطابق</th>
                  <th className="p-2.5 border border-slate-700">تأكيد / إضافة طالب</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowIndex}>
                    <td className="p-2.5 border border-slate-200 dark:border-slate-700 font-bold">
                      {r.editedName}
                    </td>
                    <td className="p-2 border border-slate-200 dark:border-slate-700">
                      <select
                        value={r.matchedStudentId || ''}
                        onChange={(e) => {
                          const sid = e.target.value || null;
                          setRows((prev) =>
                            prev.map((row) =>
                              row.rowIndex === r.rowIndex
                                ? {
                                    ...row,
                                    matchedStudentId: sid,
                                    confidence: sid ? Math.max(row.confidence, 100) : 0,
                                    confirmed: Boolean(sid),
                                  }
                                : row
                            )
                          );
                        }}
                        className="w-full min-h-[34px] px-2 rounded-lg bg-[#F7F7FC] dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                      >
                        <option value="">-- اختر الطالب يدوياً --</option>
                        {students
                          .filter((s) => s.status === 'active')
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.fullName}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="p-2.5 border border-slate-200 dark:border-slate-700 text-center font-mono-num font-bold">
                      <span
                        className={
                          r.confidence >= MATCH_CONFIDENCE_THRESHOLD ? 'text-emerald-600' : 'text-red-600'
                        }
                      >
                        {r.confidence}%
                      </span>
                    </td>
                    <td className="p-2 border border-slate-200 dark:border-slate-700">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <label className="inline-flex items-center gap-1 font-bold cursor-pointer">
                          <input
                            type="checkbox"
                            checked={r.confirmed}
                            disabled={!r.matchedStudentId}
                            onChange={(e) =>
                              setRows((prev) =>
                                prev.map((row) =>
                                  row.rowIndex === r.rowIndex ? { ...row, confirmed: e.target.checked } : row
                                )
                              )
                            }
                            className="accent-[#653CF5]"
                          />
                          <span>تأكيد</span>
                        </label>

                        {(!r.matchedStudentId || r.confidence < MATCH_CONFIDENCE_THRESHOLD) && (
                          <button
                            type="button"
                            disabled={addingStudentRow === r.rowIndex || !r.editedName.trim()}
                            onClick={() => void handleAddMissingStudent(r.rowIndex, r.editedName)}
                            className="px-2.5 py-1 rounded-lg bg-[#EEEAFF] text-[#4320D9] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            {addingStudentRow === r.rowIndex ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <UserPlus className="w-3 h-3" />
                            )}
                            <span>إضافة طالب غير موجود</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-xs font-bold cursor-pointer"
            >
              السابق
            </button>
            <button
              type="button"
              disabled={!validationState.canMigrate}
              onClick={() => {
                buildStep5Preview();
                setStep(5);
              }}
              className="min-h-[42px] px-5 rounded-xl bg-[#653CF5] text-white text-xs sm:text-sm font-bold cursor-pointer disabled:opacity-45"
            >
              التالي: معاينة A4 PDF وحسم التعارضات والترحيل
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: A4 PDF Preview, Conflict Resolution & Atomic Commit */}
      {step === 5 && (
        <div className="space-y-5">
          {/* Target Subject Selection */}
          <div className="p-4 rounded-2xl bg-[#F7F7FC] dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-3">
            <h4 className="font-display font-bold text-sm text-[#171A36] dark:text-white">
              اختيار المادة الهدف للترحيل الذري
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                value={targetSubjectId}
                onChange={(e) => {
                  setTargetSubjectId(e.target.value);
                  setTimeout(buildStep5Preview, 0);
                }}
                className="min-h-[42px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold"
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    مادة موجودة: {s.name}
                  </option>
                ))}
                <option value="__new__">+ إنشاء مادة جديدة</option>
              </select>

              {targetSubjectId === '__new__' && (
                <input
                  type="text"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder="اكتب اسم المادة الجديدة..."
                  className="min-h-[42px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm"
                />
              )}
            </div>
          </div>

          {/* Conflict Resolution */}
          {conflicts.length > 0 && (
            <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-display font-bold text-sm text-amber-900 dark:text-amber-200">
                  تعارضات مع درجات موجودة مسبقاً ({conflicts.length})
                </h4>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      const next: Record<string, ConflictChoice> = {};
                      conflicts.forEach((c) => (next[c.conflictKey] = 'overwrite'));
                      setConflictChoices(next);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-[#653CF5] text-white font-bold cursor-pointer"
                  >
                    استبدال الكل
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next: Record<string, ConflictChoice> = {};
                      conflicts.forEach((c) => (next[c.conflictKey] = 'keep'));
                      setConflictChoices(next);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 font-bold cursor-pointer"
                  >
                    احتفاظ بالموجود للكل
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto thin-scrollbar">
                {conflicts.map((c) => {
                  const choice = conflictChoices[c.conflictKey] || 'overwrite';
                  return (
                    <div
                      key={c.conflictKey}
                      className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-200/70 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <span className="font-bold text-[#171A36] dark:text-white">{c.studentName}</span>
                        <span className="text-slate-500 mx-1.5">· {c.columnLabel}:</span>
                        <span>
                          الموجود: <strong className="font-mono-num">{c.existingDisplay}</strong> ← الجديد:{' '}
                          <strong className="font-mono-num text-[#653CF5]">{c.newDisplay}</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {(
                          [
                            { id: 'keep' as ConflictChoice, label: 'احتفاظ' },
                            { id: 'overwrite' as ConflictChoice, label: 'استبدال' },
                            { id: 'skip' as ConflictChoice, label: 'استبعاد' },
                          ]
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() =>
                              setConflictChoices((p) => ({ ...p, [c.conflictKey]: opt.id }))
                            }
                            className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer ${
                              choice === opt.id
                                ? 'bg-[#653CF5] text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Matching A4 PDF Preview & Download */}
          {pdfPreview && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="px-4 py-3 bg-[#EEEAFF]/60 dark:bg-slate-800 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-bold text-[#4320D9] dark:text-violet-300 flex items-center gap-1.5">
                  <FileText className="w-4 h-4" />
                  معاينة PDF A4 مطابق ({pdfPreview.previewPages.length} صفحة)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={buildStep5Preview}
                    className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 text-xs font-bold cursor-pointer"
                  >
                    تحديث المعاينة
                  </button>
                  {pdfDownloadUrl && (
                    <a
                      href={pdfDownloadUrl}
                      download={pdfPreview.fileName}
                      className="px-3.5 py-1.5 rounded-lg bg-[#653CF5] text-white text-xs font-bold flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>تنزيل PDF A4</span>
                    </a>
                  )}
                </div>
              </div>
              <div className="p-4 bg-slate-100 dark:bg-slate-950 max-h-[420px] overflow-y-auto space-y-3">
                {pdfPreview.previewPages.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={`معاينة A4 صفحة ${i + 1}`}
                    className="w-full max-w-[620px] mx-auto rounded border border-slate-300 shadow-sm bg-white"
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(4)}
              className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-xs font-bold cursor-pointer"
            >
              السابق
            </button>
            <button
              type="button"
              disabled={committing || !validationState.canMigrate}
              onClick={() => void handleAtomicCommit()}
              className="min-h-[46px] px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{committing ? 'جاري الترحيل الذري...' : 'تنفيذ الترحيل الذري إلى الدفتر'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
