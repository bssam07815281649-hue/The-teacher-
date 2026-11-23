import type { GradePeriodId, SubjectGradebook } from '../types';

export function publishedAverage(subjects: SubjectGradebook[], studentId: string): number | null {
  const averages: number[] = [];
  for (const subject of subjects) {
    const marks: number[] = [];
    for (const period of ['term1','midyear','term2'] as GradePeriodId[]) {
      const release = subject.releases?.[period];
      if (!release) continue;
      for (const column of release.columns) {
        const cell = release.cells[studentId + '::' + column.id];
        if (cell?.status === 'score' && cell.score != null && column.maxScore > 0)
          marks.push(100 * cell.score / column.maxScore);
      }
    }
    if (marks.length) averages.push(marks.reduce((a,b) => a+b,0) / marks.length);
  }
  return averages.length ? averages.reduce((a,b) => a+b,0) / averages.length : null;
}
