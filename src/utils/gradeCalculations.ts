import type {
  AnnualPursuitScaleMode,
  GradeCellValue,
  GradeColumn,
  SubjectGradebook,
} from '../types';

export interface StudentSubjectSummary {
  term1Avg: number | null;
  midyearAvg: number | null;
  term2Avg: number | null;
  annualPursuit: number | null;
  isComplete: boolean;
  missingPeriods: ('term1' | 'midyear' | 'term2')[];
  percentageEquivalent: number | null;
}

export function makeCellKey(studentId: string, columnId: string): string {
  return `${studentId}::${columnId}`;
}

export function getCellValue(
  subject: Pick<SubjectGradebook, 'cells'>,
  studentId: string,
  columnId: string
): GradeCellValue {
  return subject.cells[makeCellKey(studentId, columnId)] ?? { status: 'blank', score: null };
}

export function formatCellDisplay(cell: GradeCellValue | undefined): string {
  if (!cell || cell.status === 'blank') return '-';
  if (cell.status === 'absent') return 'غائب';
  if (cell.status === 'exempt') return 'معفى';
  if (cell.status === 'score' && cell.score !== null && !Number.isNaN(cell.score)) {
    return String(cell.score);
  }
  return '-';
}

export function getTermColumns(subject: SubjectGradebook, periodId: 'term1' | 'midyear' | 'term2'): GradeColumn[] {
  if (periodId === 'midyear') {
    return [...(subject.midyearColumns || [])].sort((a, b) => a.orderIndex - b.orderIndex);
  }
  const recs = (subject.subRecords || [])
    .filter((r) => r.periodId === periodId)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const cols: GradeColumn[] = [];
  for (const rec of recs) {
    const sorted = [...(rec.columns || [])].sort((a, b) => a.orderIndex - b.orderIndex);
    cols.push(...sorted);
  }
  return cols;
}

function computePeriodValue(
  cols: GradeColumn[],
  selectedIds: string[],
  cells: Record<string, GradeCellValue>,
  studentId: string,
  scaleMode: AnnualPursuitScaleMode
): number | null {
  const activeCols = cols.filter((c) => selectedIds.includes(c.id));
  if (activeCols.length === 0) return null;

  const numericEntries: { score: number; maxScore: number }[] = [];
  for (const col of activeCols) {
    const cell = cells[makeCellKey(studentId, col.id)];
    if (cell && cell.status === 'score' && typeof cell.score === 'number' && Number.isFinite(cell.score)) {
      numericEntries.push({
        score: cell.score,
        maxScore: col.maxScore > 0 ? col.maxScore : 100,
      });
    }
  }

  // Must have at least one valid numeric score in this period
  if (numericEntries.length === 0) return null;

  if (scaleMode === 'scale100') {
    const totalPct = numericEntries.reduce((acc, item) => acc + (item.score / item.maxScore) * 100, 0);
    return Math.round((totalPct / numericEntries.length) * 10) / 10;
  }

  const totalRaw = numericEntries.reduce((acc, item) => acc + item.score, 0);
  return Math.round((totalRaw / numericEntries.length) * 10) / 10;
}

export function computeStudentSubjectSummary(
  subject: SubjectGradebook,
  studentId: string
): StudentSubjectSummary {
  const cfg = subject.annualPursuitConfig || {
    term1ColumnIds: [],
    midyearColumnIds: [],
    term2ColumnIds: [],
    scaleMode: 'scale100' as AnnualPursuitScaleMode,
  };

  const term1Cols = getTermColumns(subject, 'term1');
  const midyearCols = getTermColumns(subject, 'midyear');
  const term2Cols = getTermColumns(subject, 'term2');

  const term1Avg = computePeriodValue(term1Cols, cfg.term1ColumnIds, subject.cells, studentId, cfg.scaleMode);
  const midyearAvg = computePeriodValue(midyearCols, cfg.midyearColumnIds, subject.cells, studentId, cfg.scaleMode);
  const term2Avg = computePeriodValue(term2Cols, cfg.term2ColumnIds, subject.cells, studentId, cfg.scaleMode);

  const missingPeriods: ('term1' | 'midyear' | 'term2')[] = [];
  if (term1Avg === null) missingPeriods.push('term1');
  if (midyearAvg === null) missingPeriods.push('midyear');
  if (term2Avg === null) missingPeriods.push('term2');

  if (missingPeriods.length > 0 || term1Avg === null || midyearAvg === null || term2Avg === null) {
    // Compute partial percentage if any valid scores exist just for weak-subject hints
    const validScores = [term1Avg, midyearAvg, term2Avg].filter((v): v is number => v !== null);
    let percentageEquivalent: number | null = null;
    if (validScores.length > 0 && cfg.scaleMode === 'scale100') {
      percentageEquivalent = Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 10) / 10;
    }
    return {
      term1Avg,
      midyearAvg,
      term2Avg,
      annualPursuit: null,
      isComplete: false,
      missingPeriods,
      percentageEquivalent,
    };
  }

  const annualPursuit = Math.round(((term1Avg + midyearAvg + term2Avg) / 3) * 10) / 10;
  let percentageEquivalent: number | null = annualPursuit;
  if (cfg.scaleMode === 'raw') {
    const pct1 = computePeriodValue(term1Cols, cfg.term1ColumnIds, subject.cells, studentId, 'scale100');
    const pctMid = computePeriodValue(midyearCols, cfg.midyearColumnIds, subject.cells, studentId, 'scale100');
    const pct2 = computePeriodValue(term2Cols, cfg.term2ColumnIds, subject.cells, studentId, 'scale100');
    if (pct1 !== null && pctMid !== null && pct2 !== null) {
      percentageEquivalent = Math.round(((pct1 + pctMid + pct2) / 3) * 10) / 10;
    } else {
      percentageEquivalent = null;
    }
  }

  return {
    term1Avg,
    midyearAvg,
    term2Avg,
    annualPursuit,
    isComplete: true,
    missingPeriods: [],
    percentageEquivalent,
  };
}
