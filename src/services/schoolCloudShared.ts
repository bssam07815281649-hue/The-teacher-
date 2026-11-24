import { serverTimestamp } from 'firebase/firestore';
import type {
  AuditLogEntry,
  ImportTemplate,
  SchoolAnnouncement,
  SchoolProfile,
  SchoolSection,
  SchoolStageGrade,
  SchoolStudent,
  SchoolWorkspacePayload,
  StudentAbsence,
  SubjectGradebook,
} from '../types';

export const CANONICAL_SCHOOL_ID = 'default_school';

export type CloudCapSectionStudent = SchoolStudent & {
  _codeHash?: string;
  _capKey?: string;
};

export function clampStr(v: string | undefined, max: number): string {
  if (!v) return '';
  return v.length > max ? v.slice(0, max) : v;
}

export function timestampToIso(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (
    typeof val === 'object' &&
    val !== null &&
    'toDate' in val &&
    typeof (val as { toDate: () => Date }).toDate === 'function'
  ) {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

export function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) return value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  // Preserve Firestore FieldValue sentinels (e.g., serverTimestamp())
  if ('_methodName' in (value as Record<string, unknown>)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) {
      out[k] = stripUndefinedDeep(v);
    }
  }
  return out as T;
}

export function buildLightweightSchoolProfile(school: SchoolProfile): SchoolProfile {
  return stripUndefinedDeep({
    id: school.id || CANONICAL_SCHOOL_ID,
    name: clampStr(school.name || 'المدرسة الذكية', 200) || 'المدرسة الذكية',
    academicYear: clampStr(school.academicYear || '2025 - 2026', 40) || '2025 - 2026',
    directorate: clampStr(school.directorate || 'المديرية العامة للتربية', 160) || 'المديرية العامة للتربية',
    overview: clampStr(school.overview || '', 4000),
    vision: clampStr(school.vision || '', 2000),
    mission: clampStr(school.mission || '', 2000),
    goals: (school.goals || []).filter((g) => typeof g === 'string' && g.trim()).slice(0, 30),
    updatedAt: school.updatedAt || new Date().toISOString(),
  });
}

export function sanitizeSectionForCloud(section: SchoolSection): SchoolSection {
  const { counselorAccessCode: _omitCode, ...rest } = section;
  return stripUndefinedDeep({
    ...rest,
    counselorName: clampStr(section.counselorName || '', 160),
    name: clampStr(section.name || 'أ', 160) || 'أ',
  });
}

export function stripCapStudentSecretsForUi(student: CloudCapSectionStudent): SchoolStudent {
  const { _codeHash: _h, _capKey: _k, ...rest } = student;
  return rest;
}

export function buildPublicInfoDocPayload(
  schoolId: string,
  workspace: Pick<SchoolWorkspacePayload, 'school' | 'announcements' | 'stages' | 'sections'>,
  adminCodeConfigured: boolean
) {
  const publicAnnouncements = (workspace.announcements || [])
    .filter((a) => a.visibility === 'public')
    .slice(0, 100)
    .map((a) =>
      stripUndefinedDeep({
        id: a.id,
        title: clampStr(a.title, 200),
        body: clampStr(a.body, 4000),
        pinned: Boolean(a.pinned),
        visibility: 'public' as const,
        createdAt: a.createdAt || new Date().toISOString(),
        updatedAt: a.updatedAt || new Date().toISOString(),
        authorName: clampStr(a.authorName || 'الإدارة', 160),
      })
    );

  return stripUndefinedDeep({
    id: 'info',
    schoolId,
    name: clampStr(workspace.school.name || 'المدرسة الذكية', 200) || 'المدرسة الذكية',
    academicYear: clampStr(workspace.school.academicYear || '2025 - 2026', 40) || '2025 - 2026',
    directorate: clampStr(workspace.school.directorate || 'المديرية العامة للتربية', 160) || 'المديرية العامة للتربية',
    logoDataUrl: clampStr(workspace.school.logoDataUrl || '', 350000),
    coverDataUrl: clampStr(workspace.school.coverDataUrl || '', 450000),
    overview: clampStr(workspace.school.overview || '', 4000),
    vision: clampStr(workspace.school.vision || '', 2000),
    mission: clampStr(workspace.school.mission || '', 2000),
    goals: (workspace.school.goals || [])
      .filter((g) => typeof g === 'string' && g.trim())
      .map((g) => clampStr(g.trim(), 400))
      .slice(0, 30),
    announcements: publicAnnouncements,
    stagesCount: Math.max(0, Math.min(200, workspace.stages.length)),
    sectionsCount: Math.max(0, Math.min(500, workspace.sections.length)),
    adminCodeConfigured: Boolean(adminCodeConfigured),
    updatedAt: serverTimestamp(),
  });
}

export function buildCapSectionDocPayload(params: {
  capKey: string;
  schoolId: string;
  ownerUid: string;
  section: SchoolSection;
  counselorCodeHash: string;
  school: SchoolProfile;
  stages: SchoolStageGrade[];
  announcements: SchoolAnnouncement[];
  students: CloudCapSectionStudent[];
  absences: StudentAbsence[];
  subjects: SubjectGradebook[];
  templates: ImportTemplate[];
  pendingAuditLogs?: AuditLogEntry[];
  announcementReads?: Record<string, { counselorName: string; readAt: string }>;
  counselorEditedAt?: string;
}) {
  const {
    capKey,
    schoolId,
    ownerUid,
    section,
    counselorCodeHash,
    school,
    stages,
    announcements,
    students,
    absences,
    subjects,
    templates,
    pendingAuditLogs = [],
    announcementReads = {},
    counselorEditedAt = '',
  } = params;

  return stripUndefinedDeep({
    capKey,
    schoolId,
    ownerUid,
    sectionId: section.id,
    stageId: section.stageId,
    counselorCodeHash,
    school: buildLightweightSchoolProfile(school),
    stages: stages.slice(0, 200),
    announcements: announcements.slice(0, 150),
    section: sanitizeSectionForCloud(section),
    students: students.slice(0, 400),
    absences: absences.slice(0, 1000),
    subjects: subjects.slice(0, 150),
    templates: templates.slice(0, 100),
    pendingAuditLogs: pendingAuditLogs.slice(0, 400),
    announcementReads,
    counselorEditedAt: clampStr(counselorEditedAt, 40),
    updatedAt: serverTimestamp(),
  });
}

export function buildCapStudentDocPayload(params: {
  capKey: string;
  schoolId: string;
  ownerUid: string;
  section: SchoolSection;
  stages: SchoolStageGrade[];
  school: SchoolProfile;
  student: SchoolStudent;
  absences: StudentAbsence[];
  subjects: SubjectGradebook[];
  announcements: SchoolAnnouncement[];
}) {
  const { capKey, schoolId, ownerUid, section, stages, school, student, absences, subjects, announcements } = params;
  const studentId = student.id;
  const secId = section.id;

  const { studentAccessCode: _omitCode, ...cleanStudentBase } = student as CloudCapSectionStudent;
  delete (cleanStudentBase as CloudCapSectionStudent)._codeHash;
  delete (cleanStudentBase as CloudCapSectionStudent)._capKey;

  const cleanSection: SchoolSection = stripUndefinedDeep({
    id: section.id,
    stageId: section.stageId,
    name: section.name,
    counselorName: section.counselorName,
    counselorCodeStatus: section.counselorCodeStatus,
    orderIndex: section.orderIndex,
    messages: (section.messages || []).filter((m) => !m.studentId || m.studentId === studentId),
  });

  const ownSubjects: SubjectGradebook[] = subjects
    .filter((sb) => sb.sectionId === secId)
    .slice(0, 150)
    .map((sb) => {
      const releases: SubjectGradebook['releases'] = {};
      for (const period of ['term1', 'midyear', 'term2'] as const) {
        const release = sb.releases?.[period];
        if (!release) continue;
        const cells = Object.fromEntries(
          Object.entries(release.cells || {}).filter(([key]) => key.startsWith(studentId + '::'))
        );
        if (Object.keys(cells).length === 0) continue;
        const grade = release.official?.[studentId];
        releases[period] = { ...release, cells, official: grade == null ? {} : { [studentId]: grade } };
      }
      const ownCells = Object.fromEntries(
        Object.entries(sb.cells || {}).filter(
          ([key, cell]) => key.startsWith(studentId + '::') && cell.status !== 'blank'
        )
      );
      return stripUndefinedDeep({
        id: sb.id,
        name: sb.name,
        sectionId: secId,
        releases,
        cells: ownCells,
        midyearColumns: [...(sb.midyearColumns || [])].sort((a, b) => a.orderIndex - b.orderIndex),
        subRecords: [...(sb.subRecords || [])]
          .sort((a, b) => a.periodId.localeCompare(b.periodId) || a.orderIndex - b.orderIndex)
          .map((record) => ({
            ...record,
            columns: [...(record.columns || [])].sort((a, b) => a.orderIndex - b.orderIndex),
          })),
        updatedAt: sb.updatedAt,
        annualPursuitConfig: { term1ColumnIds: [], midyearColumnIds: [], term2ColumnIds: [], scaleMode: 'scale100' },
      });
    });

  const publicAnnouncements = (announcements || [])
    .filter((a) => a.visibility === 'public')
    .slice(0, 150);

  return stripUndefinedDeep({
    capKey,
    schoolId,
    ownerUid,
    sectionId: secId,
    studentId,
    school: buildLightweightSchoolProfile(school),
    stages: stages.slice(0, 200),
    section: cleanSection,
    student: cleanStudentBase,
    absences: absences
      .filter((ab) => ab.studentId === studentId && ab.sectionId === secId)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 400),
    subjects: ownSubjects,
    announcements: publicAnnouncements,
    updatedAt: serverTimestamp(),
  });
}

export function isBackendUnavailableResponse(
  status: number,
  rawText: string,
  contentType = ''
): boolean {
  if (status === 405 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const trimmed = (rawText || '').trim();
  const ct = (contentType || '').toLowerCase();
  const isHtml =
    ct.includes('text/html') ||
    trimmed.startsWith('<!') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<HTML') ||
    trimmed.startsWith('<');
  if (status === 404 && !ct.includes('application/json')) {
    return true;
  }
  if (status >= 200 && status < 300 && isHtml) {
    return true;
  }
  return false;
}

