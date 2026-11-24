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
import {
  cacheSchoolWorkspace,
  canQueueOffline,
  clearOfflineSchoolCache,
  getCachedSchoolSession,
  getCachedSchoolWorkspace,
  getOfflineStatus,
  saveGradeEditOffline,
  synchronizeGradeEdits,
} from './schoolOffline';
import {
  clearCloudSessionState,
  cloudAcknowledgeNotice,
  cloudAddSectionObservation,
  cloudBulkIssueStudentCodes,
  cloudCommitSmartImport,
  cloudDeleteAbsence,
  cloudDeleteAnnouncement,
  cloudDeleteImportTemplate,
  cloudDeleteSection,
  cloudDeleteStage,
  cloudDeleteStudent,
  cloudDeleteSubject,
  cloudExportSanitizedBackup,
  cloudFetchAuditLogs,
  cloudFetchSchoolPublic,
  cloudFetchWorkspace,
  cloudLoginWithCode,
  cloudLoginWithGoogleAdmin,
  cloudLogoutSession,
  cloudReleaseGrades,
  cloudReorderStages,
  cloudRestoreBackup,
  cloudResumeSchoolSession,
  cloudRotateAdminCode,
  cloudSaveImportTemplate,
  cloudSaveSectionAction,
  cloudSetCounselorCode,
  cloudSetStudentCode,
  cloudUpdateFirebaseLink,
  cloudUpdateGradeCells,
  cloudUpdateSchoolProfile,
  cloudUpsertAbsence,
  cloudUpsertAnnouncement,
  cloudUpsertSection,
  cloudUpsertStage,
  cloudUpsertStudent,
  cloudUpsertSubject,
  isCloudSessionActive,
  setCloudUnauthorizedHandler,
} from './schoolCloudAdapter';
import { isBackendUnavailableResponse } from './schoolCloudShared';

export { isBackendUnavailableResponse, isCloudSessionActive };

// Strictly held in memory (never in localStorage or sessionStorage)
let inMemoryToken: string | null = null;
const MANUAL_SIGNOUT_FLAG = 'school_record_manual_signout';
let unauthorizedHandler: (() => void) | null = null;

export class BackendUnavailableError extends Error {
  status: number;
  constructor(status: number, message = 'خادم API غير متوفر على هذه الاستضافة.') {
    super(message);
    this.name = 'BackendUnavailableError';
    this.status = status;
  }
}

export function setSchoolUnauthorizedHandler(cb: (() => void) | null) {
  unauthorizedHandler = cb;
  setCloudUnauthorizedHandler(cb);
}

export function getSchoolSessionToken(): string | null {
  return inMemoryToken;
}

export function clearSchoolSessionToken() {
  inMemoryToken = null;
  clearCloudSessionState();
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
    credentials: 'same-origin',
    ...init,
    headers,
  });

  const contentType = resp.headers.get('content-type') || '';
  const rawText = await resp.text().catch(() => '');

  if (isBackendUnavailableResponse(resp.status, rawText, contentType)) {
    throw new BackendUnavailableError(resp.status);
  }

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
    const default403Message =
      path === '/auth/google-admin'
        ? 'حساب Google هذا غير مخوّل لإدارة المدرسة (403). تأكد من اختيار حساب Google المصرّح به أو المالك المسجّل للمدرسة.'
        : 'ليس لديك صلاحية كافية لتنفيذ هذه العملية (403).';
    const err = new Error(
      data?.error ||
        (resp.status === 403
          ? default403Message
          : `خطأ في الاتصال بالخادم (${resp.status})${fallbackSnippet}`)
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

async function runWithCloudFallback<T>(
  cloudOp: () => Promise<T>,
  serverOp: () => Promise<T>
): Promise<T> {
  if (isCloudSessionActive()) {
    return cloudOp();
  }
  try {
    return await serverOp();
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      return cloudOp();
    }
    throw err;
  }
}

export async function fetchSchoolPublic(): Promise<SchoolPublicPayload> {
  try {
    const res = await apiRequest<SchoolPublicPayload>('/public', { method: 'GET' }, false);
    if (res && res.school && res.school.name) {
      return res;
    }
  } catch (err) {
    if (!(err instanceof BackendUnavailableError)) {
      try {
        return await cloudFetchSchoolPublic();
      } catch {
        throw err;
      }
    }
  }
  return cloudFetchSchoolPublic();
}

export async function loginSchoolWithCode(code: string): Promise<{
  token: string;
  session: SchoolSessionUser;
  requiresGoogleAuth?: boolean;
}> {
  try {
    const res = await apiRequest<{
      token: string;
      session: SchoolSessionUser;
      requiresGoogleAuth?: boolean;
    }>(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ code }),
      },
      false
    );
    clearCloudSessionState();
    if (res.requiresGoogleAuth || res.session.role === 'admin' || !res.token) {
      inMemoryToken = null;
    } else {
      inMemoryToken = res.token;
      localStorage.removeItem(MANUAL_SIGNOUT_FLAG);
    }
    return res;
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      inMemoryToken = null;
      const cloudRes = await cloudLoginWithCode(code);
      if (!cloudRes.requiresGoogleAuth && cloudRes.session.role !== 'admin') {
        localStorage.removeItem(MANUAL_SIGNOUT_FLAG);
      }
      return cloudRes;
    }
    throw err;
  }
}

export async function loginSchoolWithGoogleAdmin(input: {
  idToken: string;
  code?: string;
  initialCode?: string;
}): Promise<{ token: string; session: SchoolSessionUser; isNewSchool?: boolean }> {
  try {
    const res = await apiRequest<{ token: string; session: SchoolSessionUser; isNewSchool?: boolean }>(
      '/auth/google-admin',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      false
    );
    clearCloudSessionState();
    inMemoryToken = res.token;
    localStorage.removeItem(MANUAL_SIGNOUT_FLAG);
    return res;
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      inMemoryToken = null;
      const cloudRes = await cloudLoginWithGoogleAdmin({
        code: input.code,
        initialCode: input.initialCode,
      });
      localStorage.removeItem(MANUAL_SIGNOUT_FLAG);
      return cloudRes;
    }
    throw err;
  }
}

export async function logoutSchoolSession(options?: { isAdmin?: boolean }): Promise<void> {
  if (!options?.isAdmin) {
    // Keep pending offline marks intact for counselors/students: clear cache on manual logout.
    await clearOfflineSchoolCache();
    localStorage.setItem(MANUAL_SIGNOUT_FLAG, '1');
  }
  const wasCloud = isCloudSessionActive();
  await cloudLogoutSession(options).catch(() => {});
  if (!wasCloud) {
    try {
      await apiRequest('/auth/logout', { method: 'POST' }, true);
    } catch {
      // Ignore logout network / static host errors
    }
  }
  inMemoryToken = null;
}

export async function acknowledgeSchoolNotice(announcementId: string): Promise<void> {
  await runWithCloudFallback(
    () => cloudAcknowledgeNotice(announcementId),
    () => apiRequest(`/announcements/${encodeURIComponent(announcementId)}/read`, { method: 'POST' })
  );
}

// Resumes a same-device HttpOnly session or cloud capability pointer without storing bearer tokens in Web Storage.
export async function resumeSchoolSession(): Promise<SchoolSessionUser | null> {
  if (localStorage.getItem(MANUAL_SIGNOUT_FLAG) === '1') {
    if (navigator.onLine) {
      await fetch('/api/school-record/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    }
    return null;
  }
  if (!navigator.onLine) {
    return (await cloudResumeSchoolSession()) || getCachedSchoolSession();
  }
  try {
    const result = await apiRequest<{ session: SchoolSessionUser }>('/auth/me', { method: 'GET' }, false);
    if (result.session?.role === 'counselor' || result.session?.role === 'student') {
      return result.session;
    }
    return null;
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      return cloudResumeSchoolSession();
    }
    if (canQueueOffline(err)) {
      return (await cloudResumeSchoolSession()) || getCachedSchoolSession();
    }
    return null;
  }
}

export async function fetchSchoolWorkspace(): Promise<SchoolWorkspacePayload> {
  if (isCloudSessionActive()) {
    return cloudFetchWorkspace();
  }
  if (!navigator.onLine) {
    const cloudSess = await cloudResumeSchoolSession().catch(() => null);
    if (cloudSess) return cloudFetchWorkspace();
    const cached = await getCachedSchoolWorkspace();
    if (cached) return cached;
    throw new Error('افتح سجلك بالإنترنت مرة واحدة حتى يُحفظ على الجهاز.');
  }
  try {
    const remote = await apiRequest<SchoolWorkspacePayload>('/workspace', { method: 'GET' }, true);
    if (remote.session.role === 'counselor') {
      const result = await synchronizeGradeEdits(remote, (sectionId, subjectId, updates) =>
        apiRequest(`/sections/${sectionId}/subjects/${subjectId}/cells`, {
          method: 'POST',
          body: JSON.stringify({ updates }),
        })
      );
      return result.workspace;
    }
    await cacheSchoolWorkspace(remote, true).catch((err) => console.warn('Offline cache unavailable', err));
    return remote;
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      return cloudFetchWorkspace();
    }
    if (canQueueOffline(err)) {
      const cached = await getCachedSchoolWorkspace();
      if (cached) return cached;
    }
    throw err;
  }
}

export async function synchronizeSchoolNow(): Promise<SchoolWorkspacePayload> {
  return fetchSchoolWorkspace();
}

export async function pendingGradeChanges(): Promise<number> {
  return (await getOfflineStatus()).pendingCount;
}

export async function updateSchoolProfileApi(updates: Partial<SchoolProfile>): Promise<SchoolProfile> {
  return runWithCloudFallback(
    () => cloudUpdateSchoolProfile(updates),
    async () => {
      const res = await apiRequest<{ school: SchoolProfile }>('/school', {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      return res.school;
    }
  );
}

export async function rotateAdminCodeApi(newCode: string): Promise<void> {
  await runWithCloudFallback(
    () => cloudRotateAdminCode(newCode),
    async () => {
      await apiRequest('/admin/code', {
        method: 'PUT',
        body: JSON.stringify({ newCode }),
      });
      inMemoryToken = null;
    }
  );
}

export async function upsertAnnouncementApi(input: {
  id?: string;
  title: string;
  body: string;
  pinned?: boolean;
  visibility?: 'public' | 'internal';
}): Promise<SchoolAnnouncement> {
  return runWithCloudFallback(
    () => cloudUpsertAnnouncement(input),
    async () => {
      const path = input.id ? `/announcements/${input.id}` : '/announcements';
      const res = await apiRequest<{ announcement: SchoolAnnouncement }>(path, {
        method: input.id ? 'PUT' : 'POST',
        body: JSON.stringify(input),
      });
      return res.announcement;
    }
  );
}

export async function deleteAnnouncementApi(id: string): Promise<void> {
  await runWithCloudFallback(
    () => cloudDeleteAnnouncement(id),
    () => apiRequest(`/announcements/${id}`, { method: 'DELETE' })
  );
}

export async function upsertStageApi(input: { id?: string; name: string }): Promise<SchoolStageGrade> {
  return runWithCloudFallback(
    () => cloudUpsertStage(input),
    async () => {
      const path = input.id ? `/stages/${input.id}` : '/stages';
      const res = await apiRequest<{ stage: SchoolStageGrade }>(path, {
        method: input.id ? 'PUT' : 'POST',
        body: JSON.stringify(input),
      });
      return res.stage;
    }
  );
}

export async function reorderStagesApi(orderedStageIds: string[]): Promise<void> {
  await runWithCloudFallback(
    () => cloudReorderStages(orderedStageIds),
    () =>
      apiRequest('/stages/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedStageIds }),
      })
  );
}

export async function deleteStageApi(id: string): Promise<void> {
  await runWithCloudFallback(
    () => cloudDeleteStage(id),
    () => apiRequest(`/stages/${id}`, { method: 'DELETE' })
  );
}

export async function upsertSectionApi(input: {
  id?: string;
  stageId: string;
  name: string;
  counselorName: string;
}): Promise<SchoolSection> {
  return runWithCloudFallback(
    () => cloudUpsertSection(input),
    async () => {
      const path = input.id ? `/sections/${input.id}` : '/sections';
      const res = await apiRequest<{ section: SchoolSection }>(path, {
        method: input.id ? 'PUT' : 'POST',
        body: JSON.stringify(input),
      });
      return res.section;
    }
  );
}

export async function deleteSectionApi(id: string): Promise<void> {
  await runWithCloudFallback(
    () => cloudDeleteSection(id),
    () => apiRequest(`/sections/${id}`, { method: 'DELETE' })
  );
}

export async function setCounselorCodeApi(
  sectionId: string,
  action: 'issue' | 'change' | 'revoke',
  code?: string
): Promise<SchoolSection> {
  return runWithCloudFallback(
    () => cloudSetCounselorCode(sectionId, action, code),
    async () => {
      const res = await apiRequest<{ section: SchoolSection }>(`/sections/${sectionId}/counselor-code`, {
        method: 'POST',
        body: JSON.stringify({ action, code }),
      });
      return res.section;
    }
  );
}

export async function updateFirebaseLinkApi(meta: Partial<SchoolFirebaseSyncMeta>): Promise<SchoolFirebaseSyncMeta> {
  return runWithCloudFallback(
    () => cloudUpdateFirebaseLink(meta),
    async () => {
      const res = await apiRequest<{ firebaseSync: SchoolFirebaseSyncMeta }>('/firebase-link', {
        method: 'PUT',
        body: JSON.stringify(meta),
      });
      return res.firebaseSync;
    }
  );
}

export async function fetchAuditLogsApi(): Promise<AuditLogEntry[]> {
  return runWithCloudFallback(
    () => cloudFetchAuditLogs(),
    async () => {
      const res = await apiRequest<{ auditLogs: AuditLogEntry[] }>('/audit-logs', { method: 'GET' });
      return res.auditLogs;
    }
  );
}

export async function createLocalBackupSnapshotApi(): Promise<{
  backup: SchoolBackupSummary;
  backups: SchoolBackupSummary[];
}> {
  if (isCloudSessionActive()) {
    throw new Error(
      'اللقطات الاحتياطية على القرص المحلي للخادم غير متاحة على الاستضافة الثابتة — استخدم «تصدير JSON آمن» أو المزامنة السحابية مع Firebase.'
    );
  }
  try {
    return await apiRequest('/backups/snapshot', { method: 'POST' });
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      throw new Error(
        'اللقطات الاحتياطية على القرص المحلي للخادم غير متاحة على هذه الاستضافة — استخدم «تصدير JSON آمن».'
      );
    }
    throw err;
  }
}

export async function exportSanitizedBackupApi(): Promise<Record<string, unknown>> {
  return runWithCloudFallback(
    () => cloudExportSanitizedBackup(),
    () => apiRequest('/backups/export', { method: 'GET' })
  );
}

export async function restoreBackupApi(input: {
  fileName?: string;
  backupData?: Record<string, unknown>;
}): Promise<{ workspace: SchoolWorkspacePayload }> {
  return runWithCloudFallback(
    () => cloudRestoreBackup(input),
    () =>
      apiRequest('/backups/restore', {
        method: 'POST',
        body: JSON.stringify(input),
      })
  );
}

// === Section / Counselor / Student / Absence / Subject APIs ===

export async function upsertStudentApi(
  sectionId: string,
  input: { id?: string; fullName: string; status?: SchoolStudentStatus; notes?: string }
): Promise<SchoolStudent> {
  return runWithCloudFallback(
    () => cloudUpsertStudent(sectionId, input),
    async () => {
      const path = input.id
        ? `/sections/${sectionId}/students/${input.id}`
        : `/sections/${sectionId}/students`;
      const res = await apiRequest<{ student: SchoolStudent }>(path, {
        method: input.id ? 'PUT' : 'POST',
        body: JSON.stringify(input),
      });
      return res.student;
    }
  );
}

export async function deleteStudentApi(sectionId: string, studentId: string): Promise<void> {
  await runWithCloudFallback(
    () => cloudDeleteStudent(sectionId, studentId),
    () => apiRequest(`/sections/${sectionId}/students/${studentId}`, { method: 'DELETE' })
  );
}

export async function bulkIssueStudentCodesApi(
  sectionId: string,
  mode: 'missing_only' | 'regenerate_all' = 'missing_only'
): Promise<{ issuedCount: number; skippedCount: number; students: SchoolStudent[] }> {
  return runWithCloudFallback(
    () => cloudBulkIssueStudentCodes(sectionId, mode),
    () =>
      apiRequest<{ issuedCount: number; skippedCount: number; students: SchoolStudent[] }>(
        `/sections/${sectionId}/students/bulk-codes`,
        {
          method: 'POST',
          body: JSON.stringify({ mode }),
        }
      )
  );
}

export async function setStudentCodeApi(
  sectionId: string,
  studentId: string,
  action: 'issue' | 'change' | 'revoke',
  code?: string
): Promise<SchoolStudent> {
  return runWithCloudFallback(
    () => cloudSetStudentCode(sectionId, studentId, action, code),
    async () => {
      const res = await apiRequest<{ student: SchoolStudent }>(
        `/sections/${sectionId}/students/${studentId}/code`,
        {
          method: 'POST',
          body: JSON.stringify({ action, code }),
        }
      );
      return res.student;
    }
  );
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
  return runWithCloudFallback(
    () => cloudUpsertAbsence(sectionId, input),
    async () => {
      const path = input.id
        ? `/sections/${sectionId}/absences/${input.id}`
        : `/sections/${sectionId}/absences`;
      const res = await apiRequest<{ absence: StudentAbsence }>(path, {
        method: input.id ? 'PUT' : 'POST',
        body: JSON.stringify(input),
      });
      return res.absence;
    }
  );
}

export async function deleteAbsenceApi(sectionId: string, absenceId: string): Promise<void> {
  await runWithCloudFallback(
    () => cloudDeleteAbsence(sectionId, absenceId),
    () => apiRequest(`/sections/${sectionId}/absences/${absenceId}`, { method: 'DELETE' })
  );
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
  return runWithCloudFallback(
    () => cloudUpsertSubject(sectionId, input),
    async () => {
      const path = input.id
        ? `/sections/${sectionId}/subjects/${input.id}`
        : `/sections/${sectionId}/subjects`;
      const res = await apiRequest<{ subject: SubjectGradebook }>(path, {
        method: input.id ? 'PUT' : 'POST',
        body: JSON.stringify(input),
      });
      return res.subject;
    }
  );
}

export async function deleteSubjectApi(sectionId: string, subjectId: string): Promise<void> {
  await runWithCloudFallback(
    () => cloudDeleteSubject(sectionId, subjectId),
    () => apiRequest(`/sections/${sectionId}/subjects/${subjectId}`, { method: 'DELETE' })
  );
}

export function saveSectionAction(
  sectionId: string,
  action: 'group' | 'message',
  data: { name?: string; studentIds?: string[]; studentId?: string; body?: string }
) {
  return runWithCloudFallback(
    () => cloudSaveSectionAction(sectionId, action, data),
    () => apiRequest(`/sections/${sectionId}/staff-actions/${action}`, { method: 'POST', body: JSON.stringify(data) })
  );
}

export function addSectionObservation(
  sectionId: string,
  input: { studentId?: string; category: string; note: string }
) {
  return runWithCloudFallback(
    () => cloudAddSectionObservation(sectionId, input),
    () => apiRequest(`/sections/${sectionId}/observations`, { method: 'POST', body: JSON.stringify(input) })
  );
}

export function releaseGrades(
  sectionId: string,
  subjectId: string,
  period: 'term1' | 'midyear' | 'term2',
  approve: boolean,
  columnIds?: string[]
) {
  return runWithCloudFallback(
    () => cloudReleaseGrades(sectionId, subjectId, period, approve, columnIds),
    () =>
      apiRequest(`/sections/${sectionId}/subjects/${subjectId}/release`, {
        method: 'POST',
        body: JSON.stringify({ period, approve, columnIds }),
      })
  );
}

export async function updateGradeCellsApi(
  sectionId: string,
  subjectId: string,
  updates: { studentId: string; columnId: string; value: GradeCellValue }[]
): Promise<SubjectGradebook> {
  if (!navigator.onLine) return saveGradeEditOffline(sectionId, subjectId, updates);
  try {
    // Existing offline updates must be reconciled first to preserve edit order.
    if (await pendingGradeChanges()) {
      await fetchSchoolWorkspace();
      if (await pendingGradeChanges()) {
        throw new Error('توجد تعديلات محلية تحتاج مراجعة قبل حفظ درجات جديدة.');
      }
    }
    return await runWithCloudFallback(
      () => cloudUpdateGradeCells(sectionId, subjectId, updates),
      async () => {
        const res = await apiRequest<{ subject: SubjectGradebook }>(
          `/sections/${sectionId}/subjects/${subjectId}/cells`,
          { method: 'POST', body: JSON.stringify({ updates }) }
        );
        return res.subject;
      }
    );
  } catch (err) {
    if (canQueueOffline(err)) return saveGradeEditOffline(sectionId, subjectId, updates);
    throw err;
  }
}

export async function extractSheetWithAiApi(input: {
  imageDataUrl: string;
  description?: string;
  boxes?: ImportBoundingBox[];
}): Promise<ImportExtractionResult> {
  try {
    return await apiRequest<ImportExtractionResult>('/import-extract', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      throw new Error(
        'خدمة قراءة كشوف الدرجات بالذكاء الاصطناعي تتطلب تشغيل خادم التطبيق الكامل (Backend Server) وغير متاحة على الاستضافة الثابتة.'
      );
    }
    throw err;
  }
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
  return runWithCloudFallback(
    () => cloudCommitSmartImport(sectionId, payload),
    () =>
      apiRequest(`/sections/${sectionId}/import-commit`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
  );
}

export async function saveImportTemplateApi(input: {
  name: string;
  description?: string;
  boxes: ImportBoundingBox[];
}): Promise<ImportTemplate> {
  return runWithCloudFallback(
    () => cloudSaveImportTemplate(input),
    async () => {
      const res = await apiRequest<{ template: ImportTemplate }>('/templates', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return res.template;
    }
  );
}

export async function deleteImportTemplateApi(id: string): Promise<void> {
  await runWithCloudFallback(
    () => cloudDeleteImportTemplate(id),
    () => apiRequest(`/templates/${id}`, { method: 'DELETE' })
  );
}

