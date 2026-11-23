import type {
  AnnualPursuitConfig,
  AuditLogEntry,
  CustomSubRecord,
  GradeCellValue,
  GradeColumn,
  ImportBoundingBox,
  ImportExtractionResult,
  ImportTemplate,
  SchoolAnnouncement,
  SchoolBackupSummary,
  SchoolFirebaseSyncMeta,
  SchoolProfile,
  SchoolPublicPayload,
  SchoolSection,
  SchoolSessionUser,
  SchoolStageGrade,
  SchoolStudent,
  SchoolStudentStatus,
  SchoolWorkspacePayload,
  StudentAbsence,
  SubjectGradebook,
} from '../types';

// Strictly held in memory (never in localStorage or sessionStorage)
let inMemoryToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setSchoolUnauthorizedHandler(cb: (() => void) | null) {
  unauthorizedHandler = cb;
}

export function getSchoolSessionToken(): string | null {
  return inMemoryToken;
}

export function clearSchoolSessionToken() {
  inMemoryToken = null;
}

async function apiRequest<T>(path: string, init: RequestInit = {}, authRequired = true): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (authRequired && inMemoryToken) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }

  const resp = await fetch(`/api/school-record${path}`, {
    ...init,
    headers,
  });

  const rawText = await resp.text().catch(() => '');
  let parsed: ({ error?: string; retryAfterSeconds?: number } & T) | null = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText) as { error?: string; retryAfterSeconds?: number } & T;
    } catch {
      parsed = null;
    }
  }
  const data = (parsed || {}) as {
    error?: string;
    retryAfterSeconds?: number;
  } & T;

  if (!resp.ok) {
    if (resp.status === 401 && authRequired) {
      inMemoryToken = null;
      unauthorizedHandler?.();
    }
    const fallbackSnippet =
      !data?.error && rawText && !rawText.trim().startsWith('<')
        ? ` — ${rawText.trim().slice(0, 140)}`
        : '';
    const err = new Error(
      data?.error || `خطأ في الاتصال بالخادم (${resp.status})${fallbackSnippet}`
    ) as Error & {
      status?: number;
      retryAfterSeconds?: number;
    };
    err.status = resp.status;
    err.retryAfterSeconds = data?.retryAfterSeconds;
    throw err;
  }

  return data;
}

export async function fetchSchoolPublic(): Promise<SchoolPublicPayload> {
  return apiRequest<SchoolPublicPayload>('/public', { method: 'GET' }, false);
}

export async function loginSchoolWithCode(code: string): Promise<{ token: string; session: SchoolSessionUser }> {
  const res = await apiRequest<{ token: string; session: SchoolSessionUser }>(
    '/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ code }),
    },
    false
  );
  inMemoryToken = res.token;
  return res;
}

export async function loginSchoolWithGoogleAdmin(input: {
  idToken: string;
  code?: string;
  initialCode?: string;
}): Promise<{ token: string; session: SchoolSessionUser; isNewSchool?: boolean }> {
  const res = await apiRequest<{ token: string; session: SchoolSessionUser; isNewSchool?: boolean }>(
    '/auth/google-admin',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    false
  );
  inMemoryToken = res.token;
  return res;
}

export async function logoutSchoolSession(): Promise<void> {
  if (!inMemoryToken) return;
  try {
    await apiRequest('/auth/logout', { method: 'POST' }, true);
  } catch {
    // Ignore logout network error
  } finally {
    inMemoryToken = null;
  }
}

export async function fetchSchoolWorkspace(): Promise<SchoolWorkspacePayload> {
  return apiRequest<SchoolWorkspacePayload>('/workspace', { method: 'GET' }, true);
}

export async function updateSchoolProfileApi(updates: Partial<SchoolProfile>): Promise<SchoolProfile> {
  const res = await apiRequest<{ school: SchoolProfile }>('/school', {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return res.school;
}

export async function rotateAdminCodeApi(newCode: string): Promise<void> {
  await apiRequest('/admin/code', {
    method: 'PUT',
    body: JSON.stringify({ newCode }),
  });
  inMemoryToken = null;
}

export async function upsertAnnouncementApi(input: {
  id?: string;
  title: string;
  body: string;
  pinned?: boolean;
  visibility?: 'public' | 'internal';
}): Promise<SchoolAnnouncement> {
  const path = input.id ? `/announcements/${input.id}` : '/announcements';
  const res = await apiRequest<{ announcement: SchoolAnnouncement }>(path, {
    method: input.id ? 'PUT' : 'POST',
    body: JSON.stringify(input),
  });
  return res.announcement;
}

export async function deleteAnnouncementApi(id: string): Promise<void> {
  await apiRequest(`/announcements/${id}`, { method: 'DELETE' });
}

export async function upsertStageApi(input: { id?: string; name: string }): Promise<SchoolStageGrade> {
  const path = input.id ? `/stages/${input.id}` : '/stages';
  const res = await apiRequest<{ stage: SchoolStageGrade }>(path, {
    method: input.id ? 'PUT' : 'POST',
    body: JSON.stringify(input),
  });
  return res.stage;
}

export async function reorderStagesApi(orderedStageIds: string[]): Promise<void> {
  await apiRequest('/stages/reorder', {
    method: 'POST',
    body: JSON.stringify({ orderedStageIds }),
  });
}

export async function deleteStageApi(id: string): Promise<void> {
  await apiRequest(`/stages/${id}`, { method: 'DELETE' });
}

export async function upsertSectionApi(input: {
  id?: string;
  stageId: string;
  name: string;
  counselorName: string;
}): Promise<SchoolSection> {
  const path = input.id ? `/sections/${input.id}` : '/sections';
  const res = await apiRequest<{ section: SchoolSection }>(path, {
    method: input.id ? 'PUT' : 'POST',
    body: JSON.stringify(input),
  });
  return res.section;
}

export async function deleteSectionApi(id: string): Promise<void> {
  await apiRequest(`/sections/${id}`, { method: 'DELETE' });
}

export async function setCounselorCodeApi(
  sectionId: string,
  action: 'issue' | 'change' | 'revoke',
  code?: string
): Promise<SchoolSection> {
  const res = await apiRequest<{ section: SchoolSection }>(`/sections/${sectionId}/counselor-code`, {
    method: 'POST',
    body: JSON.stringify({ action, code }),
  });
  return res.section;
}

export async function updateFirebaseLinkApi(meta: Partial<SchoolFirebaseSyncMeta>): Promise<SchoolFirebaseSyncMeta> {
  const res = await apiRequest<{ firebaseSync: SchoolFirebaseSyncMeta }>('/firebase-link', {
    method: 'PUT',
    body: JSON.stringify(meta),
  });
  return res.firebaseSync;
}

export async function fetchAuditLogsApi(): Promise<AuditLogEntry[]> {
  const res = await apiRequest<{ auditLogs: AuditLogEntry[] }>('/audit-logs', { method: 'GET' });
  return res.auditLogs;
}

export async function createLocalBackupSnapshotApi(): Promise<{
  backup: SchoolBackupSummary;
  backups: SchoolBackupSummary[];
}> {
  return apiRequest('/backups/snapshot', { method: 'POST' });
}

export async function exportSanitizedBackupApi(): Promise<Record<string, unknown>> {
  return apiRequest('/backups/export', { method: 'GET' });
}

export async function restoreBackupApi(input: {
  fileName?: string;
  backupData?: Record<string, unknown>;
}): Promise<{ workspace: SchoolWorkspacePayload }> {
  return apiRequest('/backups/restore', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// === Section / Counselor / Student / Absence / Subject APIs ===

export async function upsertStudentApi(
  sectionId: string,
  input: { id?: string; fullName: string; status?: SchoolStudentStatus; notes?: string }
): Promise<SchoolStudent> {
  const path = input.id
    ? `/sections/${sectionId}/students/${input.id}`
    : `/sections/${sectionId}/students`;
  const res = await apiRequest<{ student: SchoolStudent }>(path, {
    method: input.id ? 'PUT' : 'POST',
    body: JSON.stringify(input),
  });
  return res.student;
}

export async function deleteStudentApi(sectionId: string, studentId: string): Promise<void> {
  await apiRequest(`/sections/${sectionId}/students/${studentId}`, { method: 'DELETE' });
}

export async function bulkIssueStudentCodesApi(
  sectionId: string,
  mode: 'missing_only' | 'regenerate_all' = 'missing_only'
): Promise<{ issuedCount: number; skippedCount: number; students: SchoolStudent[] }> {
  return apiRequest<{ issuedCount: number; skippedCount: number; students: SchoolStudent[] }>(
    `/sections/${sectionId}/students/bulk-codes`,
    {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }
  );
}

export async function setStudentCodeApi(
  sectionId: string,
  studentId: string,
  action: 'issue' | 'change' | 'revoke',
  code?: string
): Promise<SchoolStudent> {
  const res = await apiRequest<{ student: SchoolStudent }>(
    `/sections/${sectionId}/students/${studentId}/code`,
    {
      method: 'POST',
      body: JSON.stringify({ action, code }),
    }
  );
  return res.student;
}

export async function upsertAbsenceApi(
  sectionId: string,
  input: {
    id?: string;
    studentId: string;
    date: string;
    excuseType: StudentAbsence['excuseType'];
    subjectName?: string;
    notes?: string;
  }
): Promise<StudentAbsence> {
  const path = input.id
    ? `/sections/${sectionId}/absences/${input.id}`
    : `/sections/${sectionId}/absences`;
  const res = await apiRequest<{ absence: StudentAbsence }>(path, {
    method: input.id ? 'PUT' : 'POST',
    body: JSON.stringify(input),
  });
  return res.absence;
}

export async function deleteAbsenceApi(sectionId: string, absenceId: string): Promise<void> {
  await apiRequest(`/sections/${sectionId}/absences/${absenceId}`, { method: 'DELETE' });
}

export async function upsertSubjectApi(
  sectionId: string,
  input: {
    id?: string;
    name: string;
    midyearColumns?: GradeColumn[];
    subRecords?: CustomSubRecord[];
    annualPursuitConfig?: AnnualPursuitConfig;
  }
): Promise<SubjectGradebook> {
  const path = input.id
    ? `/sections/${sectionId}/subjects/${input.id}`
    : `/sections/${sectionId}/subjects`;
  const res = await apiRequest<{ subject: SubjectGradebook }>(path, {
    method: input.id ? 'PUT' : 'POST',
    body: JSON.stringify(input),
  });
  return res.subject;
}

export async function deleteSubjectApi(sectionId: string, subjectId: string): Promise<void> {
  await apiRequest(`/sections/${sectionId}/subjects/${subjectId}`, { method: 'DELETE' });
}

export function addSectionObservation(sectionId: string, input: {studentId?: string; category: string; note: string}) {
  return apiRequest(`/sections/${sectionId}/observations`, {method:'POST', body:JSON.stringify(input)});
}

export function releaseGrades(sectionId: string, subjectId: string, period: 'term1' | 'midyear' | 'term2', approve: boolean) {
  return apiRequest(`/sections/${sectionId}/subjects/${subjectId}/release`, {
    method: 'POST', body: JSON.stringify({ period, approve }),
  });
}

export async function updateGradeCellsApi(
  sectionId: string,
  subjectId: string,
  updates: { studentId: string; columnId: string; value: GradeCellValue }[]
): Promise<SubjectGradebook> {
  const res = await apiRequest<{ subject: SubjectGradebook }>(
    `/sections/${sectionId}/subjects/${subjectId}/cells`,
    {
      method: 'POST',
      body: JSON.stringify({ updates }),
    }
  );
  return res.subject;
}

export async function extractSheetWithAiApi(input: {
  imageDataUrl: string;
  description?: string;
  boxes?: ImportBoundingBox[];
}): Promise<ImportExtractionResult> {
  return apiRequest<ImportExtractionResult>('/import-extract', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function commitSmartImportApi(
  sectionId: string,
  payload: {
    subjectId?: string;
    newSubjectName?: string;
    columnsSpec: {
      tempKey: string;
      periodId: 'term1' | 'midyear' | 'term2';
      subRecordName: string;
      columnLabel: string;
      maxScore: number;
    }[];
    entries: {
      studentId: string;
      tempKey: string;
      value: GradeCellValue;
      resolution: 'overwrite' | 'keep' | 'skip';
    }[];
  }
): Promise<{ subject: SubjectGradebook; appliedCount: number; skippedCount: number }> {
  return apiRequest(`/sections/${sectionId}/import-commit`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function saveImportTemplateApi(input: {
  name: string;
  description?: string;
  boxes: ImportBoundingBox[];
}): Promise<ImportTemplate> {
  const res = await apiRequest<{ template: ImportTemplate }>('/templates', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.template;
}

export async function deleteImportTemplateApi(id: string): Promise<void> {
  await apiRequest(`/templates/${id}`, { method: 'DELETE' });
}
