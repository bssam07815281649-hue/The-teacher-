import {
  doc,
  getDoc,
  getDocFromServer,
  serverTimestamp,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import type {
  AnnualPursuitConfig,
  AuditLogEntry,
  CustomSubRecord,
  GradeCellValue,
  GradeColumn,
  GradePeriodId,
  ImportBoundingBox,
  ImportTemplate,
  ReleasedPeriod,
  SchoolAnnouncement,
  SchoolCodeStatus,
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
import { getTermColumns, makeCellKey } from '../utils/gradeCalculations';
import {
  computeCodeLookupId,
  generateHex64,
  generateReadableCode,
  isValidHex64,
  normalizeAccessCode,
  verifyAdminCodePbkdf2,
} from '../utils/schoolCodeHash';
import {
  cacheSchoolWorkspace,
  clearCloudSessionPointer,
  clearOfflineSchoolCache,
  getCachedSchoolSession,
  getCachedSchoolWorkspace,
  getCloudSessionPointer,
  saveCloudSessionPointer,
  synchronizeGradeEdits,
} from './schoolOffline';
import {
  buildCapStudentDocPayload,
  CANONICAL_SCHOOL_ID,
  clampStr,
  stripCapStudentSecretsForUi,
  stripUndefinedDeep,
  timestampToIso,
  type CloudCapSectionStudent,
} from './schoolCloudShared';
import {
  pullCloudSectionUpdatesForWorkspace,
  restoreWorkspaceFromFirestore,
  syncWorkspaceToFirestore,
} from './schoolFirebaseSync';

interface CloudSessionState {
  mode: 'admin' | 'counselor' | 'student';
  schoolId: string;
  ownerUid: string;
  capKey: string;
  codeHash: string;
  adminCode?: string;
  session: SchoolSessionUser;
}

let cloudSession: CloudSessionState | null = null;
let cloudAdminWorkspace: SchoolWorkspacePayload | null = null;
// Admin-only in-memory counselor plaintext codes during current active admin session
const adminSectionCodeCache = new Map<string, string>();
let unauthorizedCb: (() => void) | null = null;

export function setCloudUnauthorizedHandler(cb: (() => void) | null) {
  unauthorizedCb = cb;
}

export function isCloudSessionActive(): boolean {
  return cloudSession !== null;
}

export function getCloudSessionState(): CloudSessionState | null {
  return cloudSession;
}

export function getInMemoryAdminCode(): string | undefined {
  return cloudSession?.mode === 'admin' ? cloudSession.adminCode : undefined;
}

export function clearCloudSessionState() {
  cloudSession = null;
  cloudAdminWorkspace = null;
  adminSectionCodeCache.clear();
}

function makeHttpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

function defaultSchoolProfile(schoolId = CANONICAL_SCHOOL_ID): SchoolProfile {
  return {
    id: schoolId,
    name: 'المدرسة الذكية النموذجية',
    academicYear: '2025 - 2026',
    directorate: 'المديرية العامة للتربية',
    logoDataUrl: '',
    coverDataUrl: '',
    overview:
      'سجل الطالب الذكي لمتابعة التحصيل الدراسي، الحضور والغيابات، والسعي السنوي بشفافية وتكامل مع خطط الدراسة والاختبارات الذكية.',
    vision: 'تعليم رقمي منظم يضع الطالب وولي الأمر والمعلم في صورة واضحة للتقدم العلمي.',
    mission: 'توفير سجل درجات وغيابات دقيق وآمن يدعم تشخيص نقاط الضعف وبناء خطط التقوية.',
    goals: [
      'تنظيم متابعة درجات الفصول ونصف السنة والسعي السنوي بدقة.',
      'ربط نتائج الطالب بخطط المراجعة والاختبارات الذكية داخل التطبيق.',
      'حفظ خصوصية بيانات الطلبة وسجلات الشعب بصلاحيات محددة.',
    ],
    updatedAt: new Date().toISOString(),
  };
}

const MONTHLY_NAME = 'درجات الشهري';

function ensureMonthlyRecords(subject: SubjectGradebook): SubjectGradebook {
  for (const periodId of ['term1', 'term2'] as const) {
    const records = subject.subRecords.filter((r) => r.periodId === periodId);
    const existing = [
      MONTHLY_NAME,
      'الشهري',
      'شهري',
      periodId === 'term1' ? 'درجات الفصل الأول' : 'درجات الفصل الثاني',
    ]
      .map((name) => records.find((r) => r.name === name))
      .find(Boolean);
    if (existing) existing.name = MONTHLY_NAME;
    else {
      subject.subRecords.push({
        id: makeId('rec'),
        name: MONTHLY_NAME,
        periodId,
        columns: [],
        orderIndex: records.length,
      });
    }
  }
  return subject;
}

function capSectionDocToWorkspace(
  docData: DocumentData,
  overrideSession?: SchoolSessionUser
): {
  workspace: SchoolWorkspacePayload;
  rawStudents: CloudCapSectionStudent[];
  pendingAuditLogs: AuditLogEntry[];
  announcementReads: Record<string, { counselorName: string; readAt: string }>;
  counselorCodeHash: string;
  ownerUid: string;
} {
  const section = (docData.section || {}) as SchoolSection;
  const stages = (Array.isArray(docData.stages) ? docData.stages : []) as SchoolStageGrade[];
  const rawAnns = (Array.isArray(docData.announcements) ? docData.announcements : []) as SchoolAnnouncement[];
  const announcementReads = (docData.announcementReads || {}) as Record<
    string,
    { counselorName: string; readAt: string }
  >;
  const secId = String(docData.sectionId || section.id || '');
  const stageName = stages.find((st) => st.id === section.stageId)?.name || '';

  const announcements = rawAnns.map((ann) => {
    const readEntry = announcementReads[ann.id];
    if (!readEntry) return ann;
    return {
      ...ann,
      readBy: {
        ...(ann.readBy || {}),
        [secId]: readEntry,
      },
    };
  });

  const rawStudents = (Array.isArray(docData.students)
    ? docData.students
    : []) as CloudCapSectionStudent[];

  const session: SchoolSessionUser = overrideSession || {
    role: 'counselor',
    displayName: section.counselorName || 'مرشد الشعبة',
    schoolId: String(docData.schoolId || CANONICAL_SCHOOL_ID),
    sectionId: secId,
    sectionName: section.name || '',
    stageName,
  };

  const workspace: SchoolWorkspacePayload = {
    session,
    school: (docData.school || defaultSchoolProfile()) as SchoolProfile,
    announcements,
    stages: [...stages].sort((a, b) => a.orderIndex - b.orderIndex),
    sections: [section],
    students: rawStudents.map(stripCapStudentSecretsForUi),
    absences: ((Array.isArray(docData.absences) ? docData.absences : []) as StudentAbsence[]).sort((a, b) =>
      b.date.localeCompare(a.date)
    ),
    subjects: (Array.isArray(docData.subjects) ? docData.subjects : []) as SubjectGradebook[],
    templates: (Array.isArray(docData.templates) ? docData.templates : []) as ImportTemplate[],
    auditLogs: [],
    backups: [],
  };

  return {
    workspace,
    rawStudents,
    pendingAuditLogs: (Array.isArray(docData.pendingAuditLogs) ? docData.pendingAuditLogs : []) as AuditLogEntry[],
    announcementReads,
    counselorCodeHash: String(docData.counselorCodeHash || ''),
    ownerUid: String(docData.ownerUid || ''),
  };
}

function capStudentDocToWorkspace(
  docData: DocumentData,
  overrideSession?: SchoolSessionUser
): SchoolWorkspacePayload {
  const section = (docData.section || {}) as SchoolSection;
  const student = docData.student as SchoolStudent | undefined;
  const stages = (Array.isArray(docData.stages) ? docData.stages : []) as SchoolStageGrade[];
  const stageName = stages.find((st) => st.id === section.stageId)?.name || '';

  const session: SchoolSessionUser = overrideSession || {
    role: 'student',
    displayName: student?.fullName || 'طالب',
    schoolId: String(docData.schoolId || CANONICAL_SCHOOL_ID),
    sectionId: String(docData.sectionId || section.id || ''),
    sectionName: section.name || '',
    stageName,
    studentId: String(docData.studentId || student?.id || ''),
  };

  return {
    session,
    school: (docData.school || defaultSchoolProfile()) as SchoolProfile,
    announcements: ((Array.isArray(docData.announcements) ? docData.announcements : []) as SchoolAnnouncement[]).filter(
      (a) => a.visibility === 'public'
    ),
    stages: [...stages].sort((a, b) => a.orderIndex - b.orderIndex),
    sections: section.id ? [section] : [],
    students: student ? [student] : [],
    absences: ((Array.isArray(docData.absences) ? docData.absences : []) as StudentAbsence[]).sort((a, b) =>
      b.date.localeCompare(a.date)
    ),
    subjects: (Array.isArray(docData.subjects) ? docData.subjects : []) as SubjectGradebook[],
    templates: [],
    auditLogs: [],
    backups: [],
  };
}

export async function cloudFetchSchoolPublic(
  schoolId = CANONICAL_SCHOOL_ID
): Promise<SchoolPublicPayload> {
  const ref = doc(db, 'schools', schoolId, 'public', 'info');
  let snap;
  try {
    snap = navigator.onLine ? await getDocFromServer(ref) : await getDoc(ref);
  } catch {
    snap = await getDoc(ref).catch(() => null);
  }

  if (!snap || !snap.exists()) {
    return {
      school: defaultSchoolProfile(schoolId),
      announcements: [],
      stagesCount: 0,
      sectionsCount: 0,
      adminCodeConfigured: false,
    };
  }

  const d = snap.data();
  const baseSchool = defaultSchoolProfile(schoolId);
  return {
    school: {
      id: schoolId,
      name: String(d.name || baseSchool.name),
      academicYear: String(d.academicYear || baseSchool.academicYear),
      directorate: String(d.directorate || baseSchool.directorate),
      logoDataUrl: String(d.logoDataUrl || ''),
      coverDataUrl: String(d.coverDataUrl || ''),
      overview: String(d.overview || baseSchool.overview),
      vision: String(d.vision || baseSchool.vision),
      mission: String(d.mission || baseSchool.mission),
      goals: Array.isArray(d.goals) ? (d.goals as string[]) : baseSchool.goals,
      updatedAt: timestampToIso(d.updatedAt),
    },
    announcements: Array.isArray(d.announcements) ? (d.announcements as SchoolAnnouncement[]) : [],
    stagesCount: typeof d.stagesCount === 'number' ? d.stagesCount : 0,
    sectionsCount: typeof d.sectionsCount === 'number' ? d.sectionsCount : 0,
    adminCodeConfigured: Boolean(d.adminCodeConfigured),
  };
}

export async function cloudLoginWithCode(rawCode: string): Promise<{
  token: string;
  session: SchoolSessionUser;
  requiresGoogleAuth?: boolean;
}> {
  const clean = normalizeAccessCode(rawCode);
  if (!clean) {
    throw makeHttpError(400, 'يرجى إدخال كود الدخول.');
  }
  const schoolId = CANONICAL_SCHOOL_ID;
  const codeHash = await computeCodeLookupId(schoolId, clean);
  if (!isValidHex64(codeHash)) {
    throw makeHttpError(401, 'الكود غير صحيح أو تم إبطاله.');
  }

  let lookupSnap;
  try {
    lookupSnap = await getDocFromServer(doc(db, 'schools', schoolId, 'accessLookups', codeHash));
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'permission-denied') {
      throw makeHttpError(401, 'الكود غير صحيح أو تم إبطاله.');
    }
    throw makeHttpError(503, 'تعذّر الاتصال بقاعدة بيانات المدرسة السحابية. تحقق من الإنترنت وحاول مجدداً.');
  }

  if (!lookupSnap.exists()) {
    throw makeHttpError(401, 'الكود غير صحيح أو تم إبطاله.');
  }

  const lookup = lookupSnap.data();
  if (lookup.status !== 'active') {
    throw makeHttpError(401, 'تم إبطال هذا الكود. راجع إدارة المدرسة.');
  }

  if (lookup.role === 'admin_gate') {
    return {
      token: '',
      requiresGoogleAuth: true,
      session: {
        role: 'admin',
        displayName: String(lookup.displayName || 'مدير المدرسة'),
        schoolId,
      },
    };
  }

  const capKey = String(lookup.capabilityKey || '');
  if (!isValidHex64(capKey)) {
    throw makeHttpError(401, 'بيانات الجلسة غير صالحة. راجع إدارة المدرسة.');
  }

  if (lookup.role === 'counselor') {
    const capSnap = await getDocFromServer(doc(db, 'schools', schoolId, 'capSections', capKey));
    if (!capSnap.exists()) {
      throw makeHttpError(401, 'تم تحديث أو إبطال صلاحية هذه الشعبة.');
    }
    const capData = capSnap.data();
    if (capData.counselorCodeHash !== codeHash) {
      throw makeHttpError(401, 'تم تغيير كود المرشد. يرجى استخدام الكود الجديد.');
    }

    const session: SchoolSessionUser = {
      role: 'counselor',
      displayName: String(lookup.displayName || capData.section?.counselorName || 'مرشد الشعبة'),
      schoolId,
      sectionId: String(lookup.sectionId || capData.sectionId || ''),
      sectionName: String(lookup.sectionName || capData.section?.name || ''),
      stageName: String(lookup.stageName || ''),
    };

    cloudSession = {
      mode: 'counselor',
      schoolId,
      ownerUid: String(lookup.ownerUid || capData.ownerUid || ''),
      capKey,
      codeHash,
      session,
    };

    await saveCloudSessionPointer({
      schoolId,
      role: 'counselor',
      sectionId: session.sectionId || '',
      studentId: '',
      capKey,
      codeHash,
    });

    const parsed = capSectionDocToWorkspace(capData, session);
    await cacheSchoolWorkspace(parsed.workspace, true).catch(() => {});
    return { token: `cloud:${capKey}`, session };
  }

  if (lookup.role === 'student') {
    const capSnap = await getDocFromServer(doc(db, 'schools', schoolId, 'capStudents', capKey));
    if (!capSnap.exists()) {
      throw makeHttpError(401, 'سجل الطالب غير متاح حالياً.');
    }
    const capData = capSnap.data();
    const session: SchoolSessionUser = {
      role: 'student',
      displayName: String(lookup.displayName || capData.student?.fullName || 'طالب'),
      schoolId,
      sectionId: String(lookup.sectionId || capData.sectionId || ''),
      sectionName: String(lookup.sectionName || capData.section?.name || ''),
      stageName: String(lookup.stageName || ''),
      studentId: String(lookup.studentId || capData.studentId || ''),
    };

    cloudSession = {
      mode: 'student',
      schoolId,
      ownerUid: String(lookup.ownerUid || capData.ownerUid || ''),
      capKey,
      codeHash,
      session,
    };

    await saveCloudSessionPointer({
      schoolId,
      role: 'student',
      sectionId: session.sectionId || '',
      studentId: session.studentId || '',
      capKey,
      codeHash,
    });

    const ws = capStudentDocToWorkspace(capData, session);
    await cacheSchoolWorkspace(ws, true).catch(() => {});
    return { token: `cloud:${capKey}`, session };
  }

  throw makeHttpError(401, 'الكود غير صالح.');
}

export async function cloudLoginWithGoogleAdmin(input: {
  code?: string;
  initialCode?: string;
}): Promise<{ token: string; session: SchoolSessionUser; isNewSchool?: boolean }> {
  const user = auth.currentUser;
  if (!user || user.isAnonymous || !user.emailVerified) {
    throw makeHttpError(401, 'يرجى تسجيل الدخول بحساب Google موثّق البريد الإلكتروني.');
  }

  const schoolId = CANONICAL_SCHOOL_ID;
  const cleanCode = normalizeAccessCode(input.code || input.initialCode || '');
  if (!cleanCode) {
    throw makeHttpError(400, 'شرط الدخول: يرجى إدخال كود المدير.');
  }

  const schoolRef = doc(db, 'schools', schoolId);
  const secRef = doc(db, 'schools', schoolId, 'adminSecurity', 'config');

  let schoolSnap;
  try {
    schoolSnap = await getDocFromServer(schoolRef);
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'permission-denied') {
      throw makeHttpError(
        403,
        `حساب Google هذا (${user.email || user.uid}) غير مخوّل لإدارة المدرسة (403). تأكد من تسجيل الدخول بحساب المدير المالك للمدرسة.`
      );
    }
    throw err;
  }

  if (schoolSnap.exists()) {
    const ownerUid = String(schoolSnap.data().ownerUid || '');
    if (ownerUid && ownerUid !== user.uid) {
      throw makeHttpError(
        403,
        `حساب Google هذا (${user.email || user.uid}) غير مخوّل لإدارة المدرسة (403). المدرسة مسجلة على حساب مدير آخر.`
      );
    }
  }

  let secSnap = null;
  try {
    secSnap = await getDocFromServer(secRef);
  } catch {
    secSnap = null;
  }

  let isNewSchool = !schoolSnap.exists();
  if (secSnap && secSnap.exists()) {
    const secData = secSnap.data();
    const ok = await verifyAdminCodePbkdf2(
      cleanCode,
      String(secData.hash || ''),
      String(secData.salt || ''),
      Number(secData.iterations || 100000)
    );
    if (!ok) {
      throw makeHttpError(401, 'كود المدير غير صحيح.');
    }
  } else {
    if (cleanCode.length < 6) {
      throw makeHttpError(400, 'كود المدير الأول يجب أن يكون 6 أحرف أو أرقام على الأقل.');
    }
    isNewSchool = true;
  }

  const session: SchoolSessionUser = {
    role: 'admin',
    displayName: user.displayName || 'مدير المدرسة',
    schoolId,
    ownerEmail: user.email || '',
  };

  cloudSession = {
    mode: 'admin',
    schoolId,
    ownerUid: user.uid,
    capKey: '',
    codeHash: '',
    adminCode: cleanCode,
    session,
  };

  // Load full admin workspace from Firestore & hydrate if brand new
  const restored = await restoreWorkspaceFromFirestore(schoolId);
  if (restored) {
    cloudAdminWorkspace = {
      session,
      school: restored.school as SchoolProfile,
      announcements: (restored.announcements || []) as SchoolAnnouncement[],
      stages: (restored.stages || []) as SchoolStageGrade[],
      sections: (restored.sections || []) as SchoolSection[],
      students: (restored.students || []) as SchoolStudent[],
      absences: (restored.absences || []) as StudentAbsence[],
      subjects: (restored.subjects || []) as SubjectGradebook[],
      templates: (restored.templates || []) as ImportTemplate[],
      auditLogs: (restored.auditLogs || []) as AuditLogEntry[],
      backups: [],
      adminCodeConfigured: true,
      firebaseSync: {
        linked: true,
        projectId: '',
        linkedEmail: user.email || '',
        linkedUid: user.uid,
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: 'connected',
        lastSyncMessage: `متصل بقاعدة المدرسة السحابية (${user.email})`,
      },
    };
    const pulled = await pullCloudSectionUpdatesForWorkspace(cloudAdminWorkspace);
    if (pulled.changed) {
      cloudAdminWorkspace = pulled.workspace;
    }
    const meta = await syncWorkspaceToFirestore(cloudAdminWorkspace, { adminCode: cleanCode });
    cloudAdminWorkspace.firebaseSync = meta;
  } else {
    cloudAdminWorkspace = {
      session,
      school: defaultSchoolProfile(schoolId),
      announcements: [],
      stages: [],
      sections: [],
      students: [],
      absences: [],
      subjects: [],
      templates: [],
      auditLogs: [],
      backups: [],
      adminCodeConfigured: true,
    };
    const meta = await syncWorkspaceToFirestore(cloudAdminWorkspace, { adminCode: cleanCode });
    cloudAdminWorkspace.firebaseSync = meta;
  }

  return { token: `cloud-admin:${user.uid}`, session, isNewSchool };
}

export async function cloudResumeSchoolSession(): Promise<SchoolSessionUser | null> {
  const ptr = await getCloudSessionPointer();
  if (!ptr) return null;

  if (!navigator.onLine) {
    const cachedSession = await getCachedSchoolSession();
    if (!cachedSession) return null;
    cloudSession = {
      mode: ptr.role,
      schoolId: ptr.schoolId,
      ownerUid: '',
      capKey: ptr.capKey,
      codeHash: ptr.codeHash,
      session: cachedSession,
    };
    return cachedSession;
  }

  try {
    const lookupSnap = await getDocFromServer(
      doc(db, 'schools', ptr.schoolId, 'accessLookups', ptr.codeHash)
    );
    if (!lookupSnap.exists()) {
      await clearOfflineSchoolCache().catch(() => {});
      await clearCloudSessionPointer().catch(() => {});
      return null;
    }
    const lookup = lookupSnap.data();
    if (lookup.status !== 'active' || lookup.capabilityKey !== ptr.capKey) {
      await clearOfflineSchoolCache().catch(() => {});
      await clearCloudSessionPointer().catch(() => {});
      return null;
    }

    if (ptr.role === 'counselor') {
      const capSnap = await getDocFromServer(
        doc(db, 'schools', ptr.schoolId, 'capSections', ptr.capKey)
      );
      if (!capSnap.exists() || capSnap.data().counselorCodeHash !== ptr.codeHash) {
        await clearOfflineSchoolCache().catch(() => {});
        await clearCloudSessionPointer().catch(() => {});
        return null;
      }
      const parsed = capSectionDocToWorkspace(capSnap.data());
      cloudSession = {
        mode: 'counselor',
        schoolId: ptr.schoolId,
        ownerUid: parsed.ownerUid,
        capKey: ptr.capKey,
        codeHash: ptr.codeHash,
        session: parsed.workspace.session,
      };
      await cacheSchoolWorkspace(parsed.workspace, true).catch(() => {});
      return parsed.workspace.session;
    } else {
      const capSnap = await getDocFromServer(
        doc(db, 'schools', ptr.schoolId, 'capStudents', ptr.capKey)
      );
      if (!capSnap.exists()) {
        await clearOfflineSchoolCache().catch(() => {});
        await clearCloudSessionPointer().catch(() => {});
        return null;
      }
      const ws = capStudentDocToWorkspace(capSnap.data());
      cloudSession = {
        mode: 'student',
        schoolId: ptr.schoolId,
        ownerUid: String(capSnap.data().ownerUid || ''),
        capKey: ptr.capKey,
        codeHash: ptr.codeHash,
        session: ws.session,
      };
      await cacheSchoolWorkspace(ws, true).catch(() => {});
      return ws.session;
    }
  } catch {
    const cachedSession = await getCachedSchoolSession();
    if (cachedSession) {
      cloudSession = {
        mode: ptr.role,
        schoolId: ptr.schoolId,
        ownerUid: '',
        capKey: ptr.capKey,
        codeHash: ptr.codeHash,
        session: cachedSession,
      };
    }
    return cachedSession;
  }
}

export async function cloudLogoutSession(options?: { isAdmin?: boolean }): Promise<void> {
  if (!options?.isAdmin) {
    await clearOfflineSchoolCache();
    await clearCloudSessionPointer();
  }
  clearCloudSessionState();
}

function handleCloudAuthRejection(err: unknown): never {
  const code = (err as { code?: string })?.code || '';
  if (code === 'permission-denied') {
    clearCloudSessionState();
    unauthorizedCb?.();
    throw makeHttpError(401, 'انتهت الجلسة أو تم تغيير/إبطال الكود. يرجى تسجيل الدخول بالكود مجدداً.');
  }
  throw err;
}

export async function cloudFetchWorkspace(): Promise<SchoolWorkspacePayload> {
  if (!cloudSession) {
    const ptr = await getCloudSessionPointer();
    if (ptr) {
      await cloudResumeSchoolSession();
    }
  }
  if (!cloudSession) {
    throw makeHttpError(401, 'انتهت الجلسة أو لم يتم تسجيل الدخول.');
  }

  if (!navigator.onLine) {
    const cached = await getCachedSchoolWorkspace();
    if (cached) return cached;
    if (cloudSession.mode === 'admin' && cloudAdminWorkspace) return cloudAdminWorkspace;
    throw new Error('افتح سجلك بالإنترنت مرة واحدة حتى يُحفظ على الجهاز.');
  }

  if (cloudSession.mode === 'admin') {
    const user = auth.currentUser;
    if (!user || user.uid !== cloudSession.ownerUid) {
      clearCloudSessionState();
      unauthorizedCb?.();
      throw makeHttpError(401, 'انتهت جلسة المدير.');
    }
    if (!cloudAdminWorkspace) {
      const restored = await restoreWorkspaceFromFirestore(cloudSession.schoolId);
      if (restored) {
        cloudAdminWorkspace = {
          session: cloudSession.session,
          school: restored.school as SchoolProfile,
          announcements: (restored.announcements || []) as SchoolAnnouncement[],
          stages: (restored.stages || []) as SchoolStageGrade[],
          sections: (restored.sections || []) as SchoolSection[],
          students: (restored.students || []) as SchoolStudent[],
          absences: (restored.absences || []) as StudentAbsence[],
          subjects: (restored.subjects || []) as SubjectGradebook[],
          templates: (restored.templates || []) as ImportTemplate[],
          auditLogs: (restored.auditLogs || []) as AuditLogEntry[],
          backups: [],
          adminCodeConfigured: true,
        };
      }
    }
    if (!cloudAdminWorkspace) {
      throw makeHttpError(404, 'تعذر العثور على سجل المدرسة في السحابة.');
    }
    // Merge back counselor codes stored in memory so they survive refreshes within same session
    for (const sec of cloudAdminWorkspace.sections) {
      const memCode = adminSectionCodeCache.get(sec.id);
      if (memCode && sec.counselorCodeStatus === 'active' && !sec.counselorAccessCode) {
        sec.counselorAccessCode = memCode;
      }
    }
    const pulled = await pullCloudSectionUpdatesForWorkspace(cloudAdminWorkspace);
    if (pulled.changed) {
      cloudAdminWorkspace = pulled.workspace;
      const meta = await syncWorkspaceToFirestore(cloudAdminWorkspace, {
        adminCode: cloudSession.adminCode,
      });
      cloudAdminWorkspace.firebaseSync = meta;
    }
    return structuredClone(cloudAdminWorkspace);
  }

  try {
    const lookupSnap = await getDocFromServer(
      doc(db, 'schools', cloudSession.schoolId, 'accessLookups', cloudSession.codeHash)
    );
    if (!lookupSnap.exists() || lookupSnap.data().status !== 'active') {
      await clearOfflineSchoolCache().catch(() => {});
      await clearCloudSessionPointer().catch(() => {});
      clearCloudSessionState();
      unauthorizedCb?.();
      throw makeHttpError(401, 'انتهت الجلسة أو تم تغيير/إبطال الكود. يرجى تسجيل الدخول بالكود مجدداً.');
    }

    if (cloudSession.mode === 'counselor') {
      const capSnap = await getDocFromServer(
        doc(db, 'schools', cloudSession.schoolId, 'capSections', cloudSession.capKey)
      );
      if (!capSnap.exists() || capSnap.data().counselorCodeHash !== cloudSession.codeHash) {
        await clearOfflineSchoolCache().catch(() => {});
        await clearCloudSessionPointer().catch(() => {});
        clearCloudSessionState();
        unauthorizedCb?.();
        throw makeHttpError(401, 'تم تغيير أو إبطال كود المرشد. يرجى الدخول بالكود الجديد.');
      }
      const parsed = capSectionDocToWorkspace(capSnap.data(), cloudSession.session);
      const syncResult = await synchronizeGradeEdits(
        parsed.workspace,
        (sectionId, subjectId, updates) =>
          cloudUpdateGradeCells(sectionId, subjectId, updates)
      );
      return syncResult.workspace;
    }

    const stuSnap = await getDocFromServer(
      doc(db, 'schools', cloudSession.schoolId, 'capStudents', cloudSession.capKey)
    );
    if (!stuSnap.exists()) {
      await clearOfflineSchoolCache().catch(() => {});
      await clearCloudSessionPointer().catch(() => {});
      clearCloudSessionState();
      unauthorizedCb?.();
      throw makeHttpError(401, 'تم إبطال أو حذف سجل الطالب.');
    }
    const ws = capStudentDocToWorkspace(stuSnap.data(), cloudSession.session);
    await cacheSchoolWorkspace(ws, true).catch(() => {});
    return ws;
  } catch (err) {
    return handleCloudAuthRejection(err);
  }
}

// === Internal Helper for Admin Cloud Writes ===

function pushAudit(
  ws: SchoolWorkspacePayload,
  session: SchoolSessionUser,
  action: string,
  targetType: string,
  targetId: string,
  targetLabel: string,
  prevValue = '',
  nextValue = ''
): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: makeId('aud'),
    actorName: session.displayName,
    actorRole: session.role,
    action,
    targetType,
    targetId,
    targetLabel,
    prevValue: clampStr(prevValue, 800),
    nextValue: clampStr(nextValue, 800),
    timestamp: new Date().toISOString(),
  };
  ws.auditLogs.unshift(entry);
  if (ws.auditLogs.length > 600) ws.auditLogs = ws.auditLogs.slice(0, 600);
  return entry;
}

async function commitAdminCloudWorkspace(ws: SchoolWorkspacePayload): Promise<SchoolWorkspacePayload> {
  if (!cloudSession || cloudSession.mode !== 'admin') {
    throw makeHttpError(403, 'هذه العملية مخصصة لمدير المدرسة فقط.');
  }
  const meta = await syncWorkspaceToFirestore(ws, { adminCode: cloudSession.adminCode });
  ws.firebaseSync = meta;
  cloudAdminWorkspace = ws;
  return ws;
}

function assertCloudAdminWorkspace(): SchoolWorkspacePayload {
  if (!cloudSession || cloudSession.mode !== 'admin' || !cloudAdminWorkspace) {
    throw makeHttpError(403, 'هذه العملية مخصصة لمدير المدرسة فقط.');
  }
  return structuredClone(cloudAdminWorkspace);
}

// === Internal Helper for Section (Counselor or Admin) Writes ===

async function loadCloudSectionState(sectionId: string): Promise<{
  isAdmin: boolean;
  schoolId: string;
  ownerUid: string;
  capKey: string;
  docData: DocumentData;
  workspace: SchoolWorkspacePayload;
  rawStudents: CloudCapSectionStudent[];
  pendingAuditLogs: AuditLogEntry[];
  announcementReads: Record<string, { counselorName: string; readAt: string }>;
}> {
  if (!cloudSession) {
    throw makeHttpError(401, 'يرجى تسجيل الدخول للمتابعة.');
  }
  if (cloudSession.mode === 'admin') {
    const ws = assertCloudAdminWorkspace();
    const sec = ws.sections.find((s) => s.id === sectionId);
    if (!sec) throw makeHttpError(404, 'الشعبة غير موجودة.');
    return {
      isAdmin: true,
      schoolId: cloudSession.schoolId,
      ownerUid: cloudSession.ownerUid,
      capKey: '',
      docData: {},
      workspace: ws,
      rawStudents: ws.students.filter((st) => st.sectionId === sectionId),
      pendingAuditLogs: [],
      announcementReads: {},
    };
  }
  if (cloudSession.mode !== 'counselor' || cloudSession.session.sectionId !== sectionId) {
    throw makeHttpError(403, 'ليس لديك صلاحية على هذه الشعبة.');
  }

  try {
    const capSnap = await getDocFromServer(
      doc(db, 'schools', cloudSession.schoolId, 'capSections', cloudSession.capKey)
    );
    if (!capSnap.exists() || capSnap.data().counselorCodeHash !== cloudSession.codeHash) {
      throw makeHttpError(401, 'تم تغيير أو إبطال كود المرشد.');
    }
    const parsed = capSectionDocToWorkspace(capSnap.data(), cloudSession.session);
    return {
      isAdmin: false,
      schoolId: cloudSession.schoolId,
      ownerUid: parsed.ownerUid,
      capKey: cloudSession.capKey,
      docData: capSnap.data(),
      workspace: parsed.workspace,
      rawStudents: parsed.rawStudents,
      pendingAuditLogs: parsed.pendingAuditLogs,
      announcementReads: parsed.announcementReads,
    };
  } catch (err) {
    return handleCloudAuthRejection(err);
  }
}

async function commitCounselorSectionWrite(params: {
  schoolId: string;
  ownerUid: string;
  capKey: string;
  section: SchoolSection;
  school: SchoolProfile;
  stages: SchoolStageGrade[];
  announcements: SchoolAnnouncement[];
  rawStudents: CloudCapSectionStudent[];
  absences: StudentAbsence[];
  subjects: SubjectGradebook[];
  templates: ImportTemplate[];
  pendingAuditLogs: AuditLogEntry[];
  announcementReads: Record<string, { counselorName: string; readAt: string }>;
  affectedStudentIds?: string[];
  deletedStudentMeta?: { codeHash?: string; capKey?: string }[];
  issuedStudentOps?: {
    student: CloudCapSectionStudent;
    oldCodeHash?: string;
    oldCapKey?: string;
    newCodeHash?: string;
    newCapKey?: string;
  }[];
}) {
  const {
    schoolId,
    ownerUid,
    capKey,
    section,
    school,
    stages,
    announcements,
    rawStudents,
    absences,
    subjects,
    templates,
    pendingAuditLogs,
    announcementReads,
    affectedStudentIds = [],
    deletedStudentMeta = [],
    issuedStudentOps = [],
  } = params;

  const capSecRef = doc(db, 'schools', schoolId, 'capSections', capKey);
  const editedAt = new Date().toISOString();
  const stageName = stages.find((s) => s.id === section.stageId)?.name || '';

  // Primary update of capSections/{capKey} (preserves immutable school/stages/announcements)
  const capSectionUpdate = stripUndefinedDeep({
    section,
    students: rawStudents.slice(0, 400),
    absences: absences.slice(0, 1000),
    subjects: subjects.slice(0, 150),
    templates: templates.slice(0, 100),
    pendingAuditLogs: pendingAuditLogs.slice(0, 400),
    announcementReads,
    counselorEditedAt: editedAt,
    updatedAt: serverTimestamp(),
  });

  // Collect per-student side writes (capStudents & accessLookups), executed in batches of max 2 students!
  type StudentSideUnit = {
    deletes: ReturnType<typeof doc>[];
    sets: { ref: ReturnType<typeof doc>; data: Record<string, unknown> }[];
  };
  const units: StudentSideUnit[] = [];

  for (const delMeta of deletedStudentMeta) {
    const deletes: ReturnType<typeof doc>[] = [];
    if (isValidHex64(delMeta.codeHash)) {
      deletes.push(doc(db, 'schools', schoolId, 'accessLookups', delMeta.codeHash));
    }
    if (isValidHex64(delMeta.capKey)) {
      deletes.push(doc(db, 'schools', schoolId, 'capStudents', delMeta.capKey));
    }
    if (deletes.length > 0) units.push({ deletes, sets: [] });
  }

  for (const op of issuedStudentOps) {
    const deletes: ReturnType<typeof doc>[] = [];
    const sets: { ref: ReturnType<typeof doc>; data: Record<string, unknown> }[] = [];
    if (isValidHex64(op.oldCodeHash) && op.oldCodeHash !== op.newCodeHash) {
      deletes.push(doc(db, 'schools', schoolId, 'accessLookups', op.oldCodeHash));
    }
    if (isValidHex64(op.oldCapKey) && op.oldCapKey !== op.newCapKey) {
      deletes.push(doc(db, 'schools', schoolId, 'capStudents', op.oldCapKey));
    }
    if (isValidHex64(op.newCodeHash) && isValidHex64(op.newCapKey)) {
      sets.push({
        ref: doc(db, 'schools', schoolId, 'accessLookups', op.newCodeHash),
        data: {
          codeHash: op.newCodeHash,
          schoolId,
          ownerUid,
          role: 'student',
          sectionId: section.id,
          studentId: op.student.id,
          capabilityKey: op.newCapKey,
          displayName: clampStr(op.student.fullName || 'طالب', 160),
          sectionName: clampStr(section.name || '', 160),
          stageName: clampStr(stageName, 160),
          status: 'active',
          updatedAt: serverTimestamp(),
        },
      });
      sets.push({
        ref: doc(db, 'schools', schoolId, 'capStudents', op.newCapKey),
        data: buildCapStudentDocPayload({
          capKey: op.newCapKey,
          schoolId,
          ownerUid,
          section,
          stages,
          school,
          student: op.student,
          absences,
          subjects,
          announcements,
        }),
      });
    }
    if (deletes.length > 0 || sets.length > 0) units.push({ deletes, sets });
  }

  const alreadyHandled = new Set(issuedStudentOps.map((o) => o.student.id));
  for (const stuId of affectedStudentIds) {
    if (alreadyHandled.has(stuId)) continue;
    const stu = rawStudents.find((s) => s.id === stuId);
    if (!stu || stu.studentCodeStatus !== 'active' || !isValidHex64(stu._capKey)) continue;
    units.push({
      deletes: [],
      sets: [
        {
          ref: doc(db, 'schools', schoolId, 'capStudents', stu._capKey),
          data: buildCapStudentDocPayload({
            capKey: stu._capKey,
            schoolId,
            ownerUid,
            section,
            stages,
            school,
            student: stu,
            absences,
            subjects,
            announcements,
          }),
        },
      ],
    });
  }

  try {
    if (units.length === 0) {
      const batch = writeBatch(db);
      batch.update(capSecRef, capSectionUpdate);
      await batch.commit();
    } else {
      // Chunk into 2 students per writeBatch to stay comfortably under Firestore rules' multi-doc evaluation limit
      for (let i = 0; i < units.length; i += 2) {
        const batch = writeBatch(db);
        if (i === 0) {
          batch.update(capSecRef, capSectionUpdate);
        } else {
          batch.update(capSecRef, { updatedAt: serverTimestamp() });
        }
        const slice = units.slice(i, i + 2);
        for (const u of slice) {
          for (const dRef of u.deletes) batch.delete(dRef);
          for (const sOp of u.sets) batch.set(sOp.ref, sOp.data);
        }
        await batch.commit();
      }
    }

    // Refresh local offline cache so device reflects committed state immediately
    if (cloudSession) {
      const uiWorkspace: SchoolWorkspacePayload = {
        session: cloudSession.session,
        school,
        announcements: announcements.map((a) =>
          announcementReads[a.id]
            ? { ...a, readBy: { ...(a.readBy || {}), [section.id]: announcementReads[a.id] } }
            : a
        ),
        stages,
        sections: [section],
        students: rawStudents.map(stripCapStudentSecretsForUi),
        absences,
        subjects,
        templates,
        auditLogs: [],
        backups: [],
      };
      await cacheSchoolWorkspace(uiWorkspace, true).catch(() => {});
    }
  } catch (err) {
    handleCloudAuthRejection(err);
  }
}

// === Public Cloud API Mirrors ===

export async function cloudUpdateSchoolProfile(updates: Partial<SchoolProfile>): Promise<SchoolProfile> {
  const ws = assertCloudAdminWorkspace();
  const nextName = clampStr(updates.name ?? ws.school.name, 200) || ws.school.name;
  ws.school = {
    ...ws.school,
    name: nextName,
    academicYear: clampStr(updates.academicYear ?? ws.school.academicYear, 40) || ws.school.academicYear,
    directorate: clampStr(updates.directorate ?? ws.school.directorate, 160) || ws.school.directorate,
    overview: clampStr(updates.overview ?? ws.school.overview, 4000),
    vision: clampStr(updates.vision ?? ws.school.vision, 2000),
    mission: clampStr(updates.mission ?? ws.school.mission, 2000),
    goals: Array.isArray(updates.goals)
      ? updates.goals.map((g) => clampStr(g, 300)).filter(Boolean).slice(0, 30)
      : ws.school.goals,
    logoDataUrl: typeof updates.logoDataUrl === 'string' ? updates.logoDataUrl.slice(0, 350000) : ws.school.logoDataUrl,
    coverDataUrl: typeof updates.coverDataUrl === 'string' ? updates.coverDataUrl.slice(0, 450000) : ws.school.coverDataUrl,
    updatedAt: new Date().toISOString(),
  };
  pushAudit(ws, ws.session, 'تحديث ملف المدرسة', 'school', ws.school.id, ws.school.name);
  await commitAdminCloudWorkspace(ws);
  return ws.school;
}

export async function cloudRotateAdminCode(newCode: string): Promise<void> {
  const ws = assertCloudAdminWorkspace();
  const clean = normalizeAccessCode(newCode);
  if (clean.length < 6) {
    throw makeHttpError(400, 'كود المدير يجب أن يكون 6 أحرف أو أرقام على الأقل.');
  }
  const previousAdminCode = cloudSession?.adminCode;
  pushAudit(ws, ws.session, 'تغيير كود المدير', 'admin_code', 'admin', 'كود المدير');
  await syncWorkspaceToFirestore(ws, { adminCode: clean, previousAdminCode });
  clearCloudSessionState();
}

export async function cloudUpsertAnnouncement(input: {
  id?: string;
  title: string;
  body: string;
  pinned?: boolean;
  visibility?: 'public' | 'internal';
}): Promise<SchoolAnnouncement> {
  const ws = assertCloudAdminWorkspace();
  const ts = new Date().toISOString();
  const title = clampStr(input.title, 200);
  const body = clampStr(input.body, 4000);
  if (!title || !body) throw makeHttpError(400, 'عنوان الإعلان ونصه مطلوبان.');

  if (input.id) {
    const idx = ws.announcements.findIndex((a) => a.id === input.id);
    if (idx === -1) throw makeHttpError(404, 'الإعلان غير موجود.');
    const updated: SchoolAnnouncement = {
      ...ws.announcements[idx],
      title,
      body,
      pinned: input.pinned ?? ws.announcements[idx].pinned,
      visibility: input.visibility ?? ws.announcements[idx].visibility,
      updatedAt: ts,
    };
    ws.announcements[idx] = updated;
    pushAudit(ws, ws.session, 'تعديل إعلان', 'announcement', updated.id, updated.title);
    await commitAdminCloudWorkspace(ws);
    return updated;
  }

  const created: SchoolAnnouncement = {
    id: makeId('ann'),
    title,
    body,
    pinned: Boolean(input.pinned),
    visibility: input.visibility === 'internal' ? 'internal' : 'public',
    createdAt: ts,
    updatedAt: ts,
    authorName: ws.session.displayName || 'الإدارة',
  };
  ws.announcements.unshift(created);
  pushAudit(ws, ws.session, 'نشر إعلان', 'announcement', created.id, created.title);
  await commitAdminCloudWorkspace(ws);
  return created;
}

export async function cloudDeleteAnnouncement(id: string): Promise<void> {
  const ws = assertCloudAdminWorkspace();
  const idx = ws.announcements.findIndex((a) => a.id === id);
  if (idx === -1) throw makeHttpError(404, 'الإعلان غير موجود.');
  const removed = ws.announcements[idx];
  ws.announcements.splice(idx, 1);
  pushAudit(ws, ws.session, 'حذف إعلان', 'announcement', removed.id, removed.title);
  await commitAdminCloudWorkspace(ws);
}

export async function cloudAcknowledgeNotice(announcementId: string): Promise<void> {
  if (!cloudSession || cloudSession.mode !== 'counselor' || !cloudSession.session.sectionId) {
    throw makeHttpError(403, 'تأكيد قراءة البلاغ مخصص لمرشد الشعبة.');
  }
  const state = await loadCloudSectionState(cloudSession.session.sectionId);
  const ann = state.workspace.announcements.find(
    (a) => a.id === announcementId && a.visibility === 'internal'
  );
  if (!ann) throw makeHttpError(404, 'البلاغ غير موجود.');
  const sec = state.workspace.sections[0];
  if (!sec) throw makeHttpError(404, 'الشعبة غير موجودة.');

  if (!state.announcementReads[announcementId]) {
    const nextReads = {
      ...state.announcementReads,
      [announcementId]: {
        counselorName: sec.counselorName || state.workspace.session.displayName || 'مرشد الشعبة',
        readAt: new Date().toISOString(),
      },
    };
    await commitCounselorSectionWrite({
      schoolId: state.schoolId,
      ownerUid: state.ownerUid,
      capKey: state.capKey,
      section: sec,
      school: state.workspace.school,
      stages: state.workspace.stages,
      announcements: state.workspace.announcements,
      rawStudents: state.rawStudents,
      absences: state.workspace.absences,
      subjects: state.workspace.subjects,
      templates: state.workspace.templates,
      pendingAuditLogs: state.pendingAuditLogs,
      announcementReads: nextReads,
    });
  }
}

export async function cloudUpsertStage(input: { id?: string; name: string }): Promise<SchoolStageGrade> {
  const ws = assertCloudAdminWorkspace();
  const name = clampStr(input.name, 160);
  if (!name) throw makeHttpError(400, 'اسم الصف مطلوب.');
  if (input.id) {
    const idx = ws.stages.findIndex((s) => s.id === input.id);
    if (idx === -1) throw makeHttpError(404, 'الصف غير موجود.');
    ws.stages[idx] = { ...ws.stages[idx], name };
    pushAudit(ws, ws.session, 'تعديل اسم صف', 'stage', input.id, name);
    await commitAdminCloudWorkspace(ws);
    return ws.stages[idx];
  }
  const created: SchoolStageGrade = { id: makeId('stg'), name, orderIndex: ws.stages.length };
  ws.stages.push(created);
  pushAudit(ws, ws.session, 'إضافة صف جديد', 'stage', created.id, name);
  await commitAdminCloudWorkspace(ws);
  return created;
}

export async function cloudReorderStages(orderedStageIds: string[]): Promise<void> {
  const ws = assertCloudAdminWorkspace();
  const orderMap = new Map<string, number>();
  orderedStageIds.forEach((id, i) => orderMap.set(id, i));
  ws.stages.forEach((s) => {
    const next = orderMap.get(s.id);
    if (next !== undefined) s.orderIndex = next;
  });
  ws.stages.sort((a, b) => a.orderIndex - b.orderIndex);
  await commitAdminCloudWorkspace(ws);
}

export async function cloudDeleteStage(id: string): Promise<void> {
  const ws = assertCloudAdminWorkspace();
  if (ws.sections.some((s) => s.stageId === id)) {
    throw makeHttpError(400, 'لا يمكن حذف الصف لوجود شعب مرتبطة به. احذف الشعب أولاً.');
  }
  const idx = ws.stages.findIndex((s) => s.id === id);
  if (idx === -1) throw makeHttpError(404, 'الصف غير موجود.');
  const removed = ws.stages[idx];
  ws.stages.splice(idx, 1);
  pushAudit(ws, ws.session, 'حذف صف', 'stage', removed.id, removed.name);
  await commitAdminCloudWorkspace(ws);
}

export async function cloudUpsertSection(input: {
  id?: string;
  stageId: string;
  name: string;
  counselorName: string;
}): Promise<SchoolSection> {
  const ws = assertCloudAdminWorkspace();
  const name = clampStr(input.name, 160);
  const counselorName = clampStr(input.counselorName, 160) || 'مرشد الشعبة';
  if (!name) throw makeHttpError(400, 'اسم الشعبة مطلوب.');
  if (!ws.stages.some((st) => st.id === input.stageId)) {
    throw makeHttpError(400, 'الصف الدراسي المحدد غير موجود.');
  }
  if (input.id) {
    const idx = ws.sections.findIndex((s) => s.id === input.id);
    if (idx === -1) throw makeHttpError(404, 'الشعبة غير موجودة.');
    ws.sections[idx] = { ...ws.sections[idx], stageId: input.stageId, name, counselorName };
    pushAudit(ws, ws.session, 'تعديل شعبة', 'section', input.id, name);
    await commitAdminCloudWorkspace(ws);
    return ws.sections[idx];
  }
  const created: SchoolSection = {
    id: makeId('sec'),
    stageId: input.stageId,
    name,
    counselorName,
    counselorCodeStatus: 'unset',
    orderIndex: ws.sections.filter((s) => s.stageId === input.stageId).length,
  };
  ws.sections.push(created);
  pushAudit(ws, ws.session, 'إنشاء شعبة جديدة', 'section', created.id, name);
  await commitAdminCloudWorkspace(ws);
  return created;
}

export async function cloudDeleteSection(id: string): Promise<void> {
  const ws = assertCloudAdminWorkspace();
  const idx = ws.sections.findIndex((s) => s.id === id);
  if (idx === -1) throw makeHttpError(404, 'الشعبة غير موجودة.');
  const removed = ws.sections[idx];
  ws.sections.splice(idx, 1);
  ws.students = ws.students.filter((st) => st.sectionId !== id);
  ws.absences = ws.absences.filter((ab) => ab.sectionId !== id);
  ws.subjects = ws.subjects.filter((sb) => sb.sectionId !== id);
  adminSectionCodeCache.delete(id);
  pushAudit(ws, ws.session, 'حذف شعبة', 'section', removed.id, removed.name);
  await commitAdminCloudWorkspace(ws);
}

export async function cloudSetCounselorCode(
  sectionId: string,
  action: 'issue' | 'change' | 'revoke',
  code?: string
): Promise<SchoolSection> {
  const ws = assertCloudAdminWorkspace();
  const idx = ws.sections.findIndex((s) => s.id === sectionId);
  if (idx === -1) throw makeHttpError(404, 'الشعبة غير موجودة.');
  const sec = ws.sections[idx];
  const ts = new Date().toISOString();

  if (action === 'revoke') {
    sec.counselorCodeStatus = 'revoked';
    sec.counselorAccessCode = undefined;
    sec.counselorCodeUpdatedAt = ts;
    adminSectionCodeCache.delete(sectionId);
    pushAudit(ws, ws.session, 'إبطال كود المرشد', 'counselor_code', sec.id, sec.name);
    await commitAdminCloudWorkspace(ws);
    return sec;
  }

  const clean = normalizeAccessCode(code || '');
  if (clean.length < 4) {
    throw makeHttpError(400, 'يجب أن يتكون كود المرشد من 4 أحرف/أرقام على الأقل.');
  }
  const existingHash = await computeCodeLookupId(ws.school.id, clean);
  if (isValidHex64(existingHash)) {
    const snap = await getDocFromServer(
      doc(db, 'schools', ws.school.id, 'accessLookups', existingHash)
    ).catch(() => null);
    if (snap && snap.exists()) {
      const existingData = snap.data();
      if (existingData.status === 'active' && existingData.sectionId !== sectionId) {
        throw makeHttpError(409, 'هذا الكود مستخدم مسبقاً. اختر كوداً مختلفاً.');
      }
    }
  }

  sec.counselorCodeStatus = 'active';
  sec.counselorAccessCode = clean;
  sec.counselorCodeUpdatedAt = ts;
  adminSectionCodeCache.set(sectionId, clean);
  pushAudit(ws, ws.session, action === 'issue' ? 'إصدار كود مرشد' : 'تغيير كود مرشد', 'counselor_code', sec.id, sec.name);
  await commitAdminCloudWorkspace(ws);
  return sec;
}

export async function cloudUpdateFirebaseLink(meta: Partial<SchoolFirebaseSyncMeta>): Promise<SchoolFirebaseSyncMeta> {
  const ws = assertCloudAdminWorkspace();
  ws.firebaseSync = {
    linked: meta.linked ?? ws.firebaseSync?.linked ?? true,
    projectId: meta.projectId ?? ws.firebaseSync?.projectId ?? '',
    linkedEmail: meta.linkedEmail ?? ws.firebaseSync?.linkedEmail ?? '',
    linkedUid: meta.linkedUid ?? ws.firebaseSync?.linkedUid ?? '',
    lastSyncedAt: meta.lastSyncedAt ?? ws.firebaseSync?.lastSyncedAt ?? new Date().toISOString(),
    lastSyncStatus: meta.lastSyncStatus ?? ws.firebaseSync?.lastSyncStatus ?? 'synced',
    lastSyncMessage: meta.lastSyncMessage ?? ws.firebaseSync?.lastSyncMessage ?? '',
  };
  if (cloudAdminWorkspace) cloudAdminWorkspace.firebaseSync = ws.firebaseSync;
  return ws.firebaseSync;
}

export async function cloudFetchAuditLogs(): Promise<AuditLogEntry[]> {
  const ws = assertCloudAdminWorkspace();
  return [...ws.auditLogs];
}

export async function cloudExportSanitizedBackup(): Promise<Record<string, unknown>> {
  const ws = assertCloudAdminWorkspace();
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    school: ws.school,
    announcements: ws.announcements,
    stages: ws.stages,
    sections: ws.sections.map(({ counselorAccessCode: _o, ...rest }) => rest),
    students: ws.students.map(({ studentAccessCode: _o, ...rest }) => rest),
    absences: ws.absences,
    subjects: ws.subjects,
    templates: ws.templates,
    auditLogs: ws.auditLogs,
  };
}

export async function cloudRestoreBackup(input: {
  fileName?: string;
  backupData?: Record<string, unknown>;
}): Promise<{ workspace: SchoolWorkspacePayload }> {
  const ws = assertCloudAdminWorkspace();
  const data = input.backupData;
  if (!data || typeof data !== 'object') {
    throw makeHttpError(400, 'لا يمكن استعادة هذا الملف في وضع السحابة المباشر بدون بيانات JSON صالحة.');
  }
  const school = (data.school || ws.school) as SchoolProfile;
  school.id = ws.school.id;
  ws.school = school;
  if (Array.isArray(data.announcements)) ws.announcements = data.announcements as SchoolAnnouncement[];
  if (Array.isArray(data.stages)) ws.stages = data.stages as SchoolStageGrade[];
  if (Array.isArray(data.sections)) ws.sections = data.sections as SchoolSection[];
  if (Array.isArray(data.students)) ws.students = data.students as SchoolStudent[];
  if (Array.isArray(data.absences)) ws.absences = data.absences as StudentAbsence[];
  if (Array.isArray(data.subjects)) ws.subjects = data.subjects as SubjectGradebook[];
  if (Array.isArray(data.templates)) ws.templates = data.templates as ImportTemplate[];
  pushAudit(ws, ws.session, 'استعادة نسخة احتياطية سحابية', 'backup', ws.school.id, ws.school.name);
  await commitAdminCloudWorkspace(ws);
  return { workspace: structuredClone(ws) };
}

// === Section / Counselor Operations ===

export async function cloudUpsertStudent(
  sectionId: string,
  input: { id?: string; fullName: string; status?: SchoolStudentStatus; notes?: string }
): Promise<SchoolStudent> {
  const state = await loadCloudSectionState(sectionId);
  const fullName = clampStr(input.fullName, 160);
  if (!fullName) throw makeHttpError(400, 'اسم الطالب مطلوب.');
  const ts = new Date().toISOString();

  if (state.isAdmin) {
    const ws = state.workspace;
    let saved: SchoolStudent;
    if (input.id) {
      const idx = ws.students.findIndex((st) => st.id === input.id && st.sectionId === sectionId);
      if (idx === -1) throw makeHttpError(404, 'الطالب غير موجود في هذه الشعبة.');
      ws.students[idx] = {
        ...ws.students[idx],
        fullName,
        status: input.status ?? ws.students[idx].status,
        notes: input.notes !== undefined ? clampStr(input.notes, 1000) : ws.students[idx].notes,
        updatedAt: ts,
      };
      saved = ws.students[idx];
      pushAudit(ws, ws.session, 'تعديل بيانات طالب', 'student', saved.id, fullName);
    } else {
      saved = {
        id: makeId('stu'),
        sectionId,
        fullName,
        status: input.status ?? 'active',
        studentCodeStatus: 'unset',
        notes: clampStr(input.notes || '', 1000),
        createdAt: ts,
        updatedAt: ts,
      };
      ws.students.push(saved);
      pushAudit(ws, ws.session, 'إضافة طالب', 'student', saved.id, fullName);
    }
    await commitAdminCloudWorkspace(ws);
    return saved;
  }

  const rawList = [...state.rawStudents];
  let savedRaw: CloudCapSectionStudent;
  if (input.id) {
    const idx = rawList.findIndex((st) => st.id === input.id);
    if (idx === -1) throw makeHttpError(404, 'الطالب غير موجود في هذه الشعبة.');
    rawList[idx] = {
      ...rawList[idx],
      fullName,
      status: input.status ?? rawList[idx].status,
      notes: input.notes !== undefined ? clampStr(input.notes, 1000) : rawList[idx].notes,
      updatedAt: ts,
    };
    savedRaw = rawList[idx];
  } else {
    savedRaw = {
      id: makeId('stu'),
      sectionId,
      fullName,
      status: input.status ?? 'active',
      studentCodeStatus: 'unset',
      notes: clampStr(input.notes || '', 1000),
      createdAt: ts,
      updatedAt: ts,
    };
    rawList.push(savedRaw);
  }

  const auditEntry: AuditLogEntry = {
    id: makeId('aud'),
    actorName: state.workspace.session.displayName,
    actorRole: 'counselor',
    action: input.id ? 'تعديل بيانات طالب' : 'إضافة طالب',
    targetType: 'student',
    targetId: savedRaw.id,
    targetLabel: fullName,
    prevValue: '',
    nextValue: fullName,
    timestamp: ts,
  };

  await commitCounselorSectionWrite({
    schoolId: state.schoolId,
    ownerUid: state.ownerUid,
    capKey: state.capKey,
    section: state.workspace.sections[0],
    school: state.workspace.school,
    stages: state.workspace.stages,
    announcements: state.workspace.announcements,
    rawStudents: rawList,
    absences: state.workspace.absences,
    subjects: state.workspace.subjects,
    templates: state.workspace.templates,
    pendingAuditLogs: [auditEntry, ...state.pendingAuditLogs],
    announcementReads: state.announcementReads,
    affectedStudentIds: input.id ? [savedRaw.id] : [],
  });
  return stripCapStudentSecretsForUi(savedRaw);
}

export async function cloudDeleteStudent(sectionId: string, studentId: string): Promise<void> {
  const state = await loadCloudSectionState(sectionId);
  if (state.isAdmin) {
    const ws = state.workspace;
    const idx = ws.students.findIndex((st) => st.id === studentId && st.sectionId === sectionId);
    if (idx === -1) throw makeHttpError(404, 'الطالب غير موجود في هذه الشعبة.');
    const removed = ws.students[idx];
    ws.students.splice(idx, 1);
    const sec = ws.sections.find((s) => s.id === sectionId);
    if (sec?.messages) sec.messages = sec.messages.filter((m) => m.studentId !== studentId);
    for (const grp of sec?.caseGroups || []) grp.studentIds = grp.studentIds.filter((id) => id !== studentId);
    if (sec?.observations) sec.observations = sec.observations.filter((o) => o.studentId !== studentId);
    ws.absences = ws.absences.filter((ab) => ab.studentId !== studentId);
    const prefix = `${studentId}::`;
    for (const subj of ws.subjects) {
      if (subj.sectionId !== sectionId) continue;
      for (const k of Object.keys(subj.cells)) {
        if (k.startsWith(prefix)) delete subj.cells[k];
      }
    }
    pushAudit(ws, ws.session, 'حذف طالب', 'student', removed.id, removed.fullName);
    await commitAdminCloudWorkspace(ws);
    return;
  }

  const rawList = [...state.rawStudents];
  const idx = rawList.findIndex((st) => st.id === studentId);
  if (idx === -1) throw makeHttpError(404, 'الطالب غير موجود في هذه الشعبة.');
  const removed = rawList[idx];
  rawList.splice(idx, 1);

  const sec = { ...state.workspace.sections[0] };
  if (sec.messages) sec.messages = sec.messages.filter((m) => m.studentId !== studentId);
  if (sec.caseGroups) {
    sec.caseGroups = sec.caseGroups.map((g) => ({
      ...g,
      studentIds: g.studentIds.filter((id) => id !== studentId),
    }));
  }
  if (sec.observations) sec.observations = sec.observations.filter((o) => o.studentId !== studentId);

  const absences = state.workspace.absences.filter((ab) => ab.studentId !== studentId);
  const prefix = `${studentId}::`;
  const subjects = state.workspace.subjects.map((sb) => {
    const nextCells = { ...sb.cells };
    for (const k of Object.keys(nextCells)) {
      if (k.startsWith(prefix)) delete nextCells[k];
    }
    return { ...sb, cells: nextCells };
  });

  const auditEntry: AuditLogEntry = {
    id: makeId('aud'),
    actorName: state.workspace.session.displayName,
    actorRole: 'counselor',
    action: 'حذف طالب',
    targetType: 'student',
    targetId: removed.id,
    targetLabel: removed.fullName,
    prevValue: removed.fullName,
    nextValue: 'محذوف',
    timestamp: new Date().toISOString(),
  };

  await commitCounselorSectionWrite({
    schoolId: state.schoolId,
    ownerUid: state.ownerUid,
    capKey: state.capKey,
    section: sec,
    school: state.workspace.school,
    stages: state.workspace.stages,
    announcements: state.workspace.announcements,
    rawStudents: rawList,
    absences,
    subjects,
    templates: state.workspace.templates,
    pendingAuditLogs: [auditEntry, ...state.pendingAuditLogs],
    announcementReads: state.announcementReads,
    deletedStudentMeta: [{ codeHash: removed._codeHash, capKey: removed._capKey }],
  });
}

export async function cloudSetStudentCode(
  sectionId: string,
  studentId: string,
  action: 'issue' | 'change' | 'revoke',
  code?: string
): Promise<SchoolStudent> {
  const state = await loadCloudSectionState(sectionId);
  const ts = new Date().toISOString();

  if (state.isAdmin) {
    const ws = state.workspace;
    const stu = ws.students.find((s) => s.id === studentId && s.sectionId === sectionId);
    if (!stu) throw makeHttpError(404, 'الطالب غير موجود.');
    if (action === 'revoke') {
      stu.studentCodeStatus = 'revoked';
      stu.studentAccessCode = undefined;
      stu.studentCodeUpdatedAt = ts;
      stu.updatedAt = ts;
    } else {
      const clean = normalizeAccessCode(code || '');
      if (clean.length < 4) throw makeHttpError(400, 'يجب أن يتكون كود الطالب من 4 أحرف/أرقام على الأقل.');
      stu.studentCodeStatus = 'active';
      stu.studentAccessCode = clean;
      stu.studentCodeUpdatedAt = ts;
      stu.updatedAt = ts;
    }
    pushAudit(ws, ws.session, action === 'revoke' ? 'إبطال كود طالب' : 'إصدار/تغيير كود طالب', 'student_code', stu.id, stu.fullName);
    await commitAdminCloudWorkspace(ws);
    return stu;
  }

  const rawList = [...state.rawStudents];
  const idx = rawList.findIndex((st) => st.id === studentId);
  if (idx === -1) throw makeHttpError(404, 'الطالب غير موجود.');
  const prev = rawList[idx];
  const oldCodeHash = prev._codeHash;
  const oldCapKey = prev._capKey;

  if (action === 'revoke') {
    const updated: CloudCapSectionStudent = {
      ...prev,
      studentCodeStatus: 'revoked',
      studentAccessCode: undefined,
      studentCodeUpdatedAt: ts,
      updatedAt: ts,
      _codeHash: '',
      _capKey: '',
    };
    rawList[idx] = updated;
    const auditEntry: AuditLogEntry = {
      id: makeId('aud'),
      actorName: state.workspace.session.displayName,
      actorRole: 'counselor',
      action: 'إبطال كود طالب',
      targetType: 'student_code',
      targetId: updated.id,
      targetLabel: updated.fullName,
      prevValue: '',
      nextValue: 'مُبطل',
      timestamp: ts,
    };
    await commitCounselorSectionWrite({
      schoolId: state.schoolId,
      ownerUid: state.ownerUid,
      capKey: state.capKey,
      section: state.workspace.sections[0],
      school: state.workspace.school,
      stages: state.workspace.stages,
      announcements: state.workspace.announcements,
      rawStudents: rawList,
      absences: state.workspace.absences,
      subjects: state.workspace.subjects,
      templates: state.workspace.templates,
      pendingAuditLogs: [auditEntry, ...state.pendingAuditLogs],
      announcementReads: state.announcementReads,
      deletedStudentMeta: [{ codeHash: oldCodeHash, capKey: oldCapKey }],
    });
    return stripCapStudentSecretsForUi(updated);
  }

  const clean = normalizeAccessCode(code || '');
  if (clean.length < 4) throw makeHttpError(400, 'يجب أن يتكون كود الطالب من 4 أحرف/أرقام على الأقل.');
  const newCodeHash = await computeCodeLookupId(state.schoolId, clean);
  const newCapKey =
    oldCodeHash === newCodeHash && isValidHex64(oldCapKey) ? oldCapKey : generateHex64();

  const updated: CloudCapSectionStudent = {
    ...prev,
    studentCodeStatus: 'active',
    studentAccessCode: clean,
    studentCodeUpdatedAt: ts,
    updatedAt: ts,
    _codeHash: newCodeHash,
    _capKey: newCapKey,
  };
  rawList[idx] = updated;

  const auditEntry: AuditLogEntry = {
    id: makeId('aud'),
    actorName: state.workspace.session.displayName,
    actorRole: 'counselor',
    action: action === 'issue' ? 'إصدار كود طالب' : 'تغيير كود طالب',
    targetType: 'student_code',
    targetId: updated.id,
    targetLabel: updated.fullName,
    prevValue: '',
    nextValue: 'مفعّل',
    timestamp: ts,
  };

  await commitCounselorSectionWrite({
    schoolId: state.schoolId,
    ownerUid: state.ownerUid,
    capKey: state.capKey,
    section: state.workspace.sections[0],
    school: state.workspace.school,
    stages: state.workspace.stages,
    announcements: state.workspace.announcements,
    rawStudents: rawList,
    absences: state.workspace.absences,
    subjects: state.workspace.subjects,
    templates: state.workspace.templates,
    pendingAuditLogs: [auditEntry, ...state.pendingAuditLogs],
    announcementReads: state.announcementReads,
    issuedStudentOps: [
      {
        student: updated,
        oldCodeHash,
        oldCapKey,
        newCodeHash,
        newCapKey,
      },
    ],
  });

  return stripCapStudentSecretsForUi(updated);
}

export async function cloudBulkIssueStudentCodes(
  sectionId: string,
  mode: 'missing_only' | 'regenerate_all' = 'missing_only'
): Promise<{ issuedCount: number; skippedCount: number; students: SchoolStudent[] }> {
  const state = await loadCloudSectionState(sectionId);
  const activeStudents = state.rawStudents.filter((s) => s.status === 'active');
  if (activeStudents.length === 0) {
    throw makeHttpError(400, 'لا يوجد طلبة نشطون في هذه الشعبة لإصدار الأكواد لهم.');
  }

  const usedCodes = new Set<string>(
    state.rawStudents
      .map((s) => s.studentAccessCode || '')
      .filter(Boolean)
  );
  const ts = new Date().toISOString();
  let issuedCount = 0;
  let skippedCount = 0;

  if (state.isAdmin) {
    const ws = state.workspace;
    for (const stu of ws.students) {
      if (stu.sectionId !== sectionId || stu.status !== 'active') continue;
      if (mode === 'missing_only' && stu.studentCodeStatus === 'active' && stu.studentAccessCode) {
        skippedCount += 1;
        continue;
      }
      let nextCode = generateReadableCode('STU');
      while (usedCodes.has(nextCode)) nextCode = generateReadableCode('STU');
      usedCodes.add(nextCode);
      stu.studentCodeStatus = 'active';
      stu.studentAccessCode = nextCode;
      stu.studentCodeUpdatedAt = ts;
      stu.updatedAt = ts;
      issuedCount += 1;
    }
    pushAudit(ws, ws.session, 'إصدار أكواد جماعي للطلبة', 'student_code', sectionId, `${issuedCount} طالب`);
    await commitAdminCloudWorkspace(ws);
    return {
      issuedCount,
      skippedCount,
      students: ws.students.filter((s) => s.sectionId === sectionId),
    };
  }

  const rawList = [...state.rawStudents];
  const issuedOps: {
    student: CloudCapSectionStudent;
    oldCodeHash?: string;
    oldCapKey?: string;
    newCodeHash?: string;
    newCapKey?: string;
  }[] = [];

  for (let i = 0; i < rawList.length; i++) {
    const stu = rawList[i];
    if (stu.status !== 'active') continue;
    if (mode === 'missing_only' && stu.studentCodeStatus === 'active' && stu.studentAccessCode && isValidHex64(stu._codeHash) && isValidHex64(stu._capKey)) {
      skippedCount += 1;
      continue;
    }
    let nextCode = generateReadableCode('STU');
    while (usedCodes.has(nextCode)) nextCode = generateReadableCode('STU');
    usedCodes.add(nextCode);

    const newCodeHash = await computeCodeLookupId(state.schoolId, nextCode);
    const newCapKey = generateHex64();
    const updated: CloudCapSectionStudent = {
      ...stu,
      studentCodeStatus: 'active',
      studentAccessCode: nextCode,
      studentCodeUpdatedAt: ts,
      updatedAt: ts,
      _codeHash: newCodeHash,
      _capKey: newCapKey,
    };
    rawList[i] = updated;
    issuedOps.push({
      student: updated,
      oldCodeHash: stu._codeHash,
      oldCapKey: stu._capKey,
      newCodeHash,
      newCapKey,
    });
    issuedCount += 1;
  }

  if (issuedCount > 0) {
    const auditEntry: AuditLogEntry = {
      id: makeId('aud'),
      actorName: state.workspace.session.displayName,
      actorRole: 'counselor',
      action: 'إصدار أكواد جماعي للطلبة',
      targetType: 'student_code',
      targetId: sectionId,
      targetLabel: `${issuedCount} طالب`,
      prevValue: '',
      nextValue: `${issuedCount}`,
      timestamp: ts,
    };
    await commitCounselorSectionWrite({
      schoolId: state.schoolId,
      ownerUid: state.ownerUid,
      capKey: state.capKey,
      section: state.workspace.sections[0],
      school: state.workspace.school,
      stages: state.workspace.stages,
      announcements: state.workspace.announcements,
      rawStudents: rawList,
      absences: state.workspace.absences,
      subjects: state.workspace.subjects,
      templates: state.workspace.templates,
      pendingAuditLogs: [auditEntry, ...state.pendingAuditLogs],
      announcementReads: state.announcementReads,
      issuedStudentOps: issuedOps,
    });
  }

  return {
    issuedCount,
    skippedCount,
    students: rawList.map(stripCapStudentSecretsForUi),
  };
}

export async function cloudUpsertAbsence(
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
  const state = await loadCloudSectionState(sectionId);
  const stu = state.rawStudents.find((s) => s.id === input.studentId);
  if (!stu) throw makeHttpError(404, 'الطالب غير موجود في هذه الشعبة.');
  const ts = new Date().toISOString();

  if (state.isAdmin) {
    const ws = state.workspace;
    let saved: StudentAbsence;
    if (input.id) {
      const idx = ws.absences.findIndex((ab) => ab.id === input.id && ab.sectionId === sectionId);
      if (idx === -1) throw makeHttpError(404, 'سجل الغياب غير موجود.');
      ws.absences[idx] = {
        ...ws.absences[idx],
        studentId: input.studentId,
        date: clampStr(input.date, 20),
        excuseType: input.excuseType,
        subjectName: clampStr(input.subjectName || '', 120),
        notes: clampStr(input.notes || '', 1000),
        updatedAt: ts,
      };
      saved = ws.absences[idx];
    } else {
      saved = {
        id: makeId('abs'),
        sectionId,
        studentId: input.studentId,
        date: clampStr(input.date || ts.slice(0, 10), 20),
        excuseType: input.excuseType,
        subjectName: clampStr(input.subjectName || '', 120),
        notes: clampStr(input.notes || '', 1000),
        recordedBy: ws.session.displayName,
        createdAt: ts,
        updatedAt: ts,
      };
      ws.absences.unshift(saved);
    }
    pushAudit(ws, ws.session, 'تسجيل/تعديل غياب', 'absence', saved.id, stu.fullName);
    await commitAdminCloudWorkspace(ws);
    return saved;
  }

  const absences = [...state.workspace.absences];
  let saved: StudentAbsence;
  if (input.id) {
    const idx = absences.findIndex((ab) => ab.id === input.id);
    if (idx === -1) throw makeHttpError(404, 'سجل الغياب غير موجود.');
    absences[idx] = {
      ...absences[idx],
      studentId: input.studentId,
      date: clampStr(input.date, 20),
      excuseType: input.excuseType,
      subjectName: clampStr(input.subjectName || '', 120),
      notes: clampStr(input.notes || '', 1000),
      updatedAt: ts,
    };
    saved = absences[idx];
  } else {
    saved = {
      id: makeId('abs'),
      sectionId,
      studentId: input.studentId,
      date: clampStr(input.date || ts.slice(0, 10), 20),
      excuseType: input.excuseType,
      subjectName: clampStr(input.subjectName || '', 120),
      notes: clampStr(input.notes || '', 1000),
      recordedBy: state.workspace.session.displayName,
      createdAt: ts,
      updatedAt: ts,
    };
    absences.unshift(saved);
  }

  const auditEntry: AuditLogEntry = {
    id: makeId('aud'),
    actorName: state.workspace.session.displayName,
    actorRole: 'counselor',
    action: 'تسجيل/تعديل غياب',
    targetType: 'absence',
    targetId: saved.id,
    targetLabel: stu.fullName,
    prevValue: '',
    nextValue: saved.date,
    timestamp: ts,
  };

  await commitCounselorSectionWrite({
    schoolId: state.schoolId,
    ownerUid: state.ownerUid,
    capKey: state.capKey,
    section: state.workspace.sections[0],
    school: state.workspace.school,
    stages: state.workspace.stages,
    announcements: state.workspace.announcements,
    rawStudents: state.rawStudents,
    absences,
    subjects: state.workspace.subjects,
    templates: state.workspace.templates,
    pendingAuditLogs: [auditEntry, ...state.pendingAuditLogs],
    announcementReads: state.announcementReads,
    affectedStudentIds: [input.studentId],
  });
  return saved;
}

export async function cloudDeleteAbsence(sectionId: string, absenceId: string): Promise<void> {
  const state = await loadCloudSectionState(sectionId);
  if (state.isAdmin) {
    const ws = state.workspace;
    const idx = ws.absences.findIndex((ab) => ab.id === absenceId && ab.sectionId === sectionId);
    if (idx === -1) throw makeHttpError(404, 'سجل الغياب غير موجود.');
    const removed = ws.absences[idx];
    ws.absences.splice(idx, 1);
    pushAudit(ws, ws.session, 'حذف غياب', 'absence', removed.id, removed.date);
    await commitAdminCloudWorkspace(ws);
    return;
  }

  const absences = [...state.workspace.absences];
  const idx = absences.findIndex((ab) => ab.id === absenceId);
  if (idx === -1) throw makeHttpError(404, 'سجل الغياب غير موجود.');
  const removed = absences[idx];
  absences.splice(idx, 1);

  await commitCounselorSectionWrite({
    schoolId: state.schoolId,
    ownerUid: state.ownerUid,
    capKey: state.capKey,
    section: state.workspace.sections[0],
    school: state.workspace.school,
    stages: state.workspace.stages,
    announcements: state.workspace.announcements,
    rawStudents: state.rawStudents,
    absences,
    subjects: state.workspace.subjects,
    templates: state.workspace.templates,
    pendingAuditLogs: state.pendingAuditLogs,
    announcementReads: state.announcementReads,
    affectedStudentIds: [removed.studentId],
  });
}

export async function cloudUpsertSubject(
  sectionId: string,
  input: {
    id?: string;
    name: string;
    midyearColumns?: GradeColumn[];
    subRecords?: CustomSubRecord[];
    annualPursuitConfig?: AnnualPursuitConfig;
  }
): Promise<SubjectGradebook> {
  const state = await loadCloudSectionState(sectionId);
  const name = clampStr(input.name, 160);
  if (!name) throw makeHttpError(400, 'اسم المادة مطلوب.');
  const ts = new Date().toISOString();

  const applySubjectEdit = (list: SubjectGradebook[]): { saved: SubjectGradebook; affectedAll: boolean } => {
    if (input.id) {
      const idx = list.findIndex((sb) => sb.id === input.id && sb.sectionId === sectionId);
      if (idx === -1) throw makeHttpError(404, 'دفتر المادة غير موجود.');
      const nextSubj: SubjectGradebook = ensureMonthlyRecords({
        ...list[idx],
        name,
        midyearColumns: input.midyearColumns ?? list[idx].midyearColumns,
        subRecords: input.subRecords ?? list[idx].subRecords,
        annualPursuitConfig: input.annualPursuitConfig ?? list[idx].annualPursuitConfig,
        updatedAt: ts,
      });
      list[idx] = nextSubj;
      return { saved: nextSubj, affectedAll: true };
    }
    const created: SubjectGradebook = ensureMonthlyRecords({
      id: makeId('sub'),
      sectionId,
      name,
      midyearColumns: input.midyearColumns || [],
      subRecords: input.subRecords || [],
      cells: {},
      annualPursuitConfig: input.annualPursuitConfig || {
        term1ColumnIds: [],
        midyearColumnIds: [],
        term2ColumnIds: [],
        scaleMode: 'scale100',
      },
      updatedAt: ts,
    });
    list.push(created);
    return { saved: created, affectedAll: true };
  };

  if (state.isAdmin) {
    const ws = state.workspace;
    const { saved } = applySubjectEdit(ws.subjects);
    pushAudit(ws, ws.session, input.id ? 'تعديل دفتر مادة' : 'إنشاء دفتر مادة جديد', 'subject', saved.id, saved.name);
    await commitAdminCloudWorkspace(ws);
    return saved;
  }

  const subjects = [...state.workspace.subjects];
  const { saved } = applySubjectEdit(subjects);
  const auditEntry: AuditLogEntry = {
    id: makeId('aud'),
    actorName: state.workspace.session.displayName,
    actorRole: 'counselor',
    action: input.id ? 'تعديل دفتر مادة' : 'إنشاء دفتر مادة جديد',
    targetType: 'subject',
    targetId: saved.id,
    targetLabel: saved.name,
    prevValue: '',
    nextValue: saved.name,
    timestamp: ts,
  };

  await commitCounselorSectionWrite({
    schoolId: state.schoolId,
    ownerUid: state.ownerUid,
    capKey: state.capKey,
    section: state.workspace.sections[0],
    school: state.workspace.school,
    stages: state.workspace.stages,
    announcements: state.workspace.announcements,
    rawStudents: state.rawStudents,
    absences: state.workspace.absences,
    subjects,
    templates: state.workspace.templates,
    pendingAuditLogs: [auditEntry, ...state.pendingAuditLogs],
    announcementReads: state.announcementReads,
    affectedStudentIds: state.rawStudents.filter((s) => s.studentCodeStatus === 'active').map((s) => s.id),
  });
  return saved;
}

export async function cloudDeleteSubject(sectionId: string, subjectId: string): Promise<void> {
  const state = await loadCloudSectionState(sectionId);
  if (state.isAdmin) {
    const ws = state.workspace;
    const idx = ws.subjects.findIndex((sb) => sb.id === subjectId && sb.sectionId === sectionId);
    if (idx === -1) throw makeHttpError(404, 'دفتر المادة غير موجود.');
    const removed = ws.subjects[idx];
    ws.subjects.splice(idx, 1);
    pushAudit(ws, ws.session, 'حذف دفتر مادة', 'subject', removed.id, removed.name);
    await commitAdminCloudWorkspace(ws);
    return;
  }

  const subjects = [...state.workspace.subjects];
  const idx = subjects.findIndex((sb) => sb.id === subjectId);
  if (idx === -1) throw makeHttpError(404, 'دفتر المادة غير موجود.');
  const removed = subjects[idx];
  subjects.splice(idx, 1);

  await commitCounselorSectionWrite({
    schoolId: state.schoolId,
    ownerUid: state.ownerUid,
    capKey: state.capKey,
    section: state.workspace.sections[0],
    school: state.workspace.school,
    stages: state.workspace.stages,
    announcements: state.workspace.announcements,
    rawStudents: state.rawStudents,
    absences: state.workspace.absences,
    subjects,
    templates: state.workspace.templates,
    pendingAuditLogs: state.pendingAuditLogs,
    announcementReads: state.announcementReads,
    affectedStudentIds: state.rawStudents.filter((s) => s.studentCodeStatus === 'active').map((s) => s.id),
  });
}

export async function cloudSaveSectionAction(
  sectionId: string,
  action: 'group' | 'message',
  data: { name?: string; studentIds?: string[]; studentId?: string; body?: string }
): Promise<void> {
  const state = await loadCloudSectionState(sectionId);
  const ts = new Date().toISOString();
  const mutateSection = (sec: SchoolSection): string[] => {
    const valid = (id: unknown) =>
      typeof id === 'string' && state.rawStudents.some((s) => s.id === id);
    if (action === 'group') {
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!name || name.length > 100 || !Array.isArray(data.studentIds) || !data.studentIds.every(valid)) {
        throw makeHttpError(400, 'تحقق من اسم الحالة والطلاب المختارين.');
      }
      sec.caseGroups ??= [];
      let grp = sec.caseGroups.find((g) => g.name === name);
      if (!grp) {
        grp = { name, studentIds: [] };
        sec.caseGroups.push(grp);
      }
      grp.studentIds = [...new Set([...grp.studentIds, ...data.studentIds])];
      return [];
    }
    const body = typeof data.body === 'string' ? data.body.trim() : '';
    if (!body || body.length > 2000 || (data.studentId !== undefined && !valid(data.studentId))) {
      throw makeHttpError(400, 'تحقق من الرسالة والمستلم.');
    }
    sec.messages ??= [];
    sec.messages.push({ id: makeId('msg'), body, studentId: data.studentId, createdAt: ts });
    return data.studentId
      ? [data.studentId]
      : state.rawStudents.filter((s) => s.studentCodeStatus === 'active').map((s) => s.id);
  };

  if (state.isAdmin) {
    const ws = state.workspace;
    const sec = ws.sections.find((s) => s.id === sectionId);
    if (!sec) throw makeHttpError(404, 'الشعبة غير موجودة.');
    mutateSection(sec);
    pushAudit(ws, ws.session, action === 'group' ? 'تسجيل حالة' : 'إرسال رسالة', 'section', sectionId, sec.name);
    await commitAdminCloudWorkspace(ws);
    return;
  }

  const sec = structuredClone(state.workspace.sections[0]);
  const affectedStudentIds = mutateSection(sec);
  const auditEntry: AuditLogEntry = {
    id: makeId('aud'),
    actorName: state.workspace.session.displayName,
    actorRole: 'counselor',
    action: action === 'group' ? 'تسجيل حالة' : 'إرسال رسالة',
    targetType: 'section',
    targetId: sectionId,
    targetLabel: sec.name,
    prevValue: '',
    nextValue: '',
    timestamp: ts,
  };
  await commitCounselorSectionWrite({
    schoolId: state.schoolId,
    ownerUid: state.ownerUid,
    capKey: state.capKey,
    section: sec,
    school: state.workspace.school,
    stages: state.workspace.stages,
    announcements: state.workspace.announcements,
    rawStudents: state.rawStudents,
    absences: state.workspace.absences,
    subjects: state.workspace.subjects,
    templates: state.workspace.templates,
    pendingAuditLogs: [auditEntry, ...state.pendingAuditLogs],
    announcementReads: state.announcementReads,
    affectedStudentIds,
  });
}

export async function cloudAddSectionObservation(
  sectionId: string,
  input: { studentId?: string; category: string; note: string }
): Promise<void> {
  const state = await loadCloudSectionState(sectionId);
  const category = input.category?.trim();
  const note = input.note?.trim() || '';
  if (!category || category.length > 100 || note.length > 2000) {
    throw makeHttpError(400, 'تحقق من عنوان الحالة وطول الملاحظة.');
  }
  const ts = new Date().toISOString();
  const obs = { id: makeId('obs'), studentId: input.studentId, category, note, createdAt: ts };

  if (state.isAdmin) {
    const ws = state.workspace;
    const sec = ws.sections.find((s) => s.id === sectionId);
    if (!sec) throw makeHttpError(404, 'الشعبة غير موجودة.');
    sec.observations = [...(sec.observations || []), obs];
    pushAudit(ws, ws.session, 'إضافة ملاحظة', 'section', sectionId, sec.name);
    await commitAdminCloudWorkspace(ws);
    return;
  }

  const sec = structuredClone(state.workspace.sections[0]);
  sec.observations = [...(sec.observations || []), obs];
  await commitCounselorSectionWrite({
    schoolId: state.schoolId,
    ownerUid: state.ownerUid,
    capKey: state.capKey,
    section: sec,
    school: state.workspace.school,
    stages: state.workspace.stages,
    announcements: state.workspace.announcements,
    rawStudents: state.rawStudents,
    absences: state.workspace.absences,
    subjects: state.workspace.subjects,
    templates: state.workspace.templates,
    pendingAuditLogs: state.pendingAuditLogs,
    announcementReads: state.announcementReads,
  });
}

function applyReleasePeriodToSubject(
  subj: SubjectGradebook,
  sectionStudents: SchoolStudent[],
  period: GradePeriodId,
  approve: boolean,
  chosen?: string[]
) {
  const monthly = period !== 'midyear';
  const previous = subj.releases?.[period];
  const monthlyIds = new Set(
    subj.subRecords.find((r) => r.periodId === period && r.name === MONTHLY_NAME)?.columns.map((c) => c.id)
  );
  const columns =
    monthly && approve
      ? (previous?.columns || []).filter((c) => monthlyIds.has(c.id))
      : getTermColumns(subj, period).filter((c) => !monthly || monthlyIds.has(c.id));

  if (
    monthly &&
    approve &&
    (!Array.isArray(chosen) ||
      !chosen.length ||
      chosen.some(
        (id) =>
          !columns.some((c) => c.id === id) ||
          !Object.keys(previous?.cells || {}).some((key) => key.endsWith('::' + id))
      ))
  ) {
    throw makeHttpError(400, 'اختر الأشهر المنشورة التي تريد اعتمادها.');
  }

  const selected =
    subj.annualPursuitConfig[
      period === 'midyear' ? 'midyearColumnIds' : period === 'term1' ? 'term1ColumnIds' : 'term2ColumnIds'
    ];
  const counted = columns.filter((c) => (monthly && approve ? chosen! : selected).includes(c.id));
  const release: ReleasedPeriod = {
    updatedAt: new Date().toISOString(),
    approved: approve,
    columns: structuredClone(columns),
    cells: {},
    official: {},
  };

  for (const student of sectionStudents) {
    for (const col of columns) {
      const key = makeCellKey(student.id, col.id);
      const cell = monthly && approve ? previous?.cells[key] : subj.cells[key];
      if (cell && cell.status !== 'blank') release.cells[key] = { ...cell };
    }
    if (!approve || !counted.length) continue;
    const marks = counted.map((c) => ({ col: c, cell: release.cells[makeCellKey(student.id, c.id)] }));
    if (marks.some((m) => !m.cell || !['score', 'exempt'].includes(m.cell.status))) continue;
    const numeric = marks.filter((m) => m.cell.status === 'score' && m.cell.score != null);
    if (numeric.length) {
      release.official[student.id] =
        Math.round(
          (1000 * numeric.reduce((sum, m) => sum + m.cell.score! / m.col.maxScore, 0)) / numeric.length
        ) / 10;
    }
  }

  if (!Object.keys(release.cells).length) throw makeHttpError(400, 'لا توجد درجات محفوظة للنشر.');
  if (approve && !counted.length) {
    throw makeHttpError(400, 'لم تحدد أعمدة للحساب. اختر أعمدة الفترة من «السعي السنوي والإعدادات» ثم اعتمدها.');
  }
  if (approve && !Object.keys(release.official).length) {
    throw makeHttpError(400, 'لكل طالب خانة فارغة أو غياب ضمن الأعمدة المختارة.');
  }
  if (monthly) {
    release.approvedColumnIds = approve ? counted.map((c) => c.id) : previous?.approvedColumnIds;
    if (!approve && previous?.approved) {
      release.approved = true;
      release.official = { ...previous.official };
    }
  }
  subj.releases = { ...subj.releases, [period]: release };
}

export async function cloudReleaseGrades(
  sectionId: string,
  subjectId: string,
  period: GradePeriodId,
  approve: boolean,
  columnIds?: string[]
): Promise<void> {
  const state = await loadCloudSectionState(sectionId);
  if (state.isAdmin) {
    const ws = state.workspace;
    const subj = ws.subjects.find((s) => s.id === subjectId && s.sectionId === sectionId);
    if (!subj) throw makeHttpError(404, 'المادة غير موجودة.');
    applyReleasePeriodToSubject(
      subj,
      ws.students.filter((s) => s.sectionId === sectionId),
      period,
      approve,
      columnIds
    );
    pushAudit(ws, ws.session, approve ? 'اعتماد فترة' : 'نشر درجات', 'subject', subjectId, subj.name);
    await commitAdminCloudWorkspace(ws);
    return;
  }

  const subjects = structuredClone(state.workspace.subjects);
  const subj = subjects.find((s) => s.id === subjectId);
  if (!subj) throw makeHttpError(404, 'المادة غير موجودة.');
  applyReleasePeriodToSubject(subj, state.rawStudents, period, approve, columnIds);

  await commitCounselorSectionWrite({
    schoolId: state.schoolId,
    ownerUid: state.ownerUid,
    capKey: state.capKey,
    section: state.workspace.sections[0],
    school: state.workspace.school,
    stages: state.workspace.stages,
    announcements: state.workspace.announcements,
    rawStudents: state.rawStudents,
    absences: state.workspace.absences,
    subjects,
    templates: state.workspace.templates,
    pendingAuditLogs: state.pendingAuditLogs,
    announcementReads: state.announcementReads,
    affectedStudentIds: state.rawStudents.filter((s) => s.studentCodeStatus === 'active').map((s) => s.id),
  });
}

function applyCellUpdatesToSubject(
  subj: SubjectGradebook,
  students: SchoolStudent[],
  updates: { studentId: string; columnId: string; value: GradeCellValue }[]
): { affectedStudentIds: string[]; changedCount: number } {
  const findCol = (colId: string): GradeColumn | null => {
    for (const c of subj.midyearColumns) if (c.id === colId) return c;
    for (const r of subj.subRecords) for (const c of r.columns) if (c.id === colId) return c;
    return null;
  };
  const affected = new Set<string>();
  let changedCount = 0;

  for (const item of updates) {
    const stu = students.find((s) => s.id === item.studentId);
    if (!stu) throw makeHttpError(400, 'أحد الطلبة غير موجود ضمن هذه الشعبة.');
    const col = findCol(item.columnId);
    if (!col) throw makeHttpError(400, 'أحد الأعمدة غير موجود في دفتر هذه المادة.');
    const status = item.value?.status;
    if (!['score', 'blank', 'absent', 'exempt'].includes(status)) {
      throw makeHttpError(400, 'حالة الدرجة غير صالحة.');
    }
    let score: number | null = null;
    if (status === 'score') {
      const num = Number(item.value.score);
      if (!Number.isFinite(num) || num < 0 || num > col.maxScore) {
        throw makeHttpError(400, `الدرجة للطالب ${stu.fullName} غير صالحة (0 إلى ${col.maxScore}).`);
      }
      score = Math.round(num * 100) / 100;
    }
    const key = makeCellKey(stu.id, col.id);
    const nextVal: GradeCellValue = { status, score };
    const prev = subj.cells[key] ?? { status: 'blank', score: null };
    if (prev.status !== nextVal.status || prev.score !== nextVal.score) {
      if (nextVal.status === 'blank') delete subj.cells[key];
      else subj.cells[key] = nextVal;
      affected.add(stu.id);
      changedCount += 1;
    }
  }
  subj.updatedAt = new Date().toISOString();
  return { affectedStudentIds: Array.from(affected), changedCount };
}

export async function cloudUpdateGradeCells(
  sectionId: string,
  subjectId: string,
  updates: { studentId: string; columnId: string; value: GradeCellValue }[]
): Promise<SubjectGradebook> {
  const state = await loadCloudSectionState(sectionId);
  if (state.isAdmin) {
    const ws = state.workspace;
    const subj = ws.subjects.find((sb) => sb.id === subjectId && sb.sectionId === sectionId);
    if (!subj) throw makeHttpError(404, 'دفتر المادة غير موجود.');
    const { changedCount } = applyCellUpdatesToSubject(
      subj,
      ws.students.filter((s) => s.sectionId === sectionId),
      updates
    );
    if (changedCount > 0) {
      pushAudit(ws, ws.session, 'تعديل درجات في الدفتر', 'grade_cells', subj.id, subj.name, '', `${changedCount} خلية`);
      await commitAdminCloudWorkspace(ws);
    }
    return subj;
  }

  const subjects = structuredClone(state.workspace.subjects);
  const subj = subjects.find((sb) => sb.id === subjectId);
  if (!subj) throw makeHttpError(404, 'دفتر المادة غير موجود.');
  const { affectedStudentIds, changedCount } = applyCellUpdatesToSubject(subj, state.rawStudents, updates);
  if (changedCount === 0) return subj;

  const auditEntry: AuditLogEntry = {
    id: makeId('aud'),
    actorName: state.workspace.session.displayName,
    actorRole: 'counselor',
    action: 'تعديل درجات في الدفتر',
    targetType: 'grade_cells',
    targetId: subj.id,
    targetLabel: subj.name,
    prevValue: '',
    nextValue: `${changedCount} خلية`,
    timestamp: new Date().toISOString(),
  };

  await commitCounselorSectionWrite({
    schoolId: state.schoolId,
    ownerUid: state.ownerUid,
    capKey: state.capKey,
    section: state.workspace.sections[0],
    school: state.workspace.school,
    stages: state.workspace.stages,
    announcements: state.workspace.announcements,
    rawStudents: state.rawStudents,
    absences: state.workspace.absences,
    subjects,
    templates: state.workspace.templates,
    pendingAuditLogs: [auditEntry, ...state.pendingAuditLogs],
    announcementReads: state.announcementReads,
    affectedStudentIds,
  });
  return subj;
}

export async function cloudCommitSmartImport(
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
  const state = await loadCloudSectionState(sectionId);
  const ts = new Date().toISOString();
  const runImport = (subjectsList: SubjectGradebook[]) => {
    let targetSubj = payload.subjectId
      ? subjectsList.find((sb) => sb.id === payload.subjectId && sb.sectionId === sectionId)
      : undefined;
    if (payload.subjectId && !targetSubj) throw makeHttpError(404, 'المادة الهدف غير موجودة.');
    if (!targetSubj) {
      const sName = clampStr(payload.newSubjectName || '', 160);
      if (!sName) throw makeHttpError(400, 'يرجى تحديد مادة أو كتابة اسم مادة جديدة.');
      targetSubj = {
        id: makeId('sub'),
        sectionId,
        name: sName,
        midyearColumns: [],
        subRecords: [],
        cells: {},
        annualPursuitConfig: { term1ColumnIds: [], midyearColumnIds: [], term2ColumnIds: [], scaleMode: 'scale100' },
        updatedAt: ts,
      };
      subjectsList.push(targetSubj);
    }
    ensureMonthlyRecords(targetSubj);
    const tempToCol = new Map<string, GradeColumn>();
    for (const spec of payload.columnsSpec) {
      const maxScore = Number(spec.maxScore);
      const label = clampStr(spec.columnLabel, 120);
      if (!label || !Number.isFinite(maxScore) || maxScore <= 0) {
        throw makeHttpError(400, `بيانات العمود «${spec.columnLabel}» غير صالحة.`);
      }
      if (spec.periodId === 'midyear') {
        let col = targetSubj.midyearColumns.find((c) => c.label === label);
        if (!col) {
          col = { id: makeId('col'), label, maxScore, orderIndex: targetSubj.midyearColumns.length };
          targetSubj.midyearColumns.push(col);
          targetSubj.annualPursuitConfig.midyearColumnIds.push(col.id);
        } else col.maxScore = maxScore;
        tempToCol.set(spec.tempKey, col);
      } else {
        const inputName = clampStr(spec.subRecordName || MONTHLY_NAME, 120);
        const recName = ['الشهري', 'شهري'].includes(inputName) ? MONTHLY_NAME : inputName;
        let rec = targetSubj.subRecords.find((r) => r.periodId === spec.periodId && r.name === recName);
        if (!rec) {
          rec = {
            id: makeId('rec'),
            periodId: spec.periodId,
            name: recName,
            orderIndex: targetSubj.subRecords.filter((r) => r.periodId === spec.periodId).length,
            columns: [],
          };
          targetSubj.subRecords.push(rec);
        }
        let col = rec.columns.find((c) => c.label === label);
        if (!col) {
          col = { id: makeId('col'), label, maxScore, orderIndex: rec.columns.length };
          rec.columns.push(col);
          if (spec.periodId === 'term1') targetSubj.annualPursuitConfig.term1ColumnIds.push(col.id);
          else targetSubj.annualPursuitConfig.term2ColumnIds.push(col.id);
        } else col.maxScore = maxScore;
        tempToCol.set(spec.tempKey, col);
      }
    }

    let appliedCount = 0;
    let skippedCount = 0;
    const affected = new Set<string>();
    for (const entry of payload.entries) {
      if (entry.resolution === 'skip') {
        skippedCount += 1;
        continue;
      }
      const col = tempToCol.get(entry.tempKey);
      if (!col) continue;
      const key = makeCellKey(entry.studentId, col.id);
      const existing = targetSubj.cells[key];
      if (entry.resolution === 'keep' && existing && existing.status !== 'blank') {
        skippedCount += 1;
        continue;
      }
      if (entry.value.status === 'blank') delete targetSubj.cells[key];
      else targetSubj.cells[key] = entry.value;
      appliedCount += 1;
      affected.add(entry.studentId);
    }
    targetSubj.updatedAt = ts;
    return { subject: targetSubj, appliedCount, skippedCount, affectedStudentIds: Array.from(affected) };
  };

  if (state.isAdmin) {
    const ws = state.workspace;
    const res = runImport(ws.subjects);
    pushAudit(ws, ws.session, 'استيراد درجات من كشف', 'grade_cells', res.subject.id, res.subject.name, '', `${res.appliedCount}`);
    await commitAdminCloudWorkspace(ws);
    return { subject: res.subject, appliedCount: res.appliedCount, skippedCount: res.skippedCount };
  }

  const subjects = structuredClone(state.workspace.subjects);
  const res = runImport(subjects);
  await commitCounselorSectionWrite({
    schoolId: state.schoolId,
    ownerUid: state.ownerUid,
    capKey: state.capKey,
    section: state.workspace.sections[0],
    school: state.workspace.school,
    stages: state.workspace.stages,
    announcements: state.workspace.announcements,
    rawStudents: state.rawStudents,
    absences: state.workspace.absences,
    subjects,
    templates: state.workspace.templates,
    pendingAuditLogs: state.pendingAuditLogs,
    announcementReads: state.announcementReads,
    affectedStudentIds: res.affectedStudentIds,
  });
  return { subject: res.subject, appliedCount: res.appliedCount, skippedCount: res.skippedCount };
}

export async function cloudSaveImportTemplate(input: {
  name: string;
  description?: string;
  boxes: ImportBoundingBox[];
}): Promise<ImportTemplate> {
  if (!cloudSession || (cloudSession.mode !== 'admin' && cloudSession.mode !== 'counselor')) {
    throw makeHttpError(403, 'غير مصرح بحفظ القوالب.');
  }
  const tpl: ImportTemplate = {
    id: makeId('tpl'),
    name: clampStr(input.name, 160),
    description: clampStr(input.description || '', 1000),
    boxes: (input.boxes || []).slice(0, 40),
    createdAt: new Date().toISOString(),
  };
  if (cloudSession.mode === 'admin') {
    const ws = assertCloudAdminWorkspace();
    ws.templates.unshift(tpl);
    pushAudit(ws, ws.session, 'حفظ قالب استيراد كشوف', 'template', tpl.id, tpl.name);
    await commitAdminCloudWorkspace(ws);
    return tpl;
  }
  const state = await loadCloudSectionState(cloudSession.session.sectionId || '');
  const templates = [tpl, ...state.workspace.templates];
  await commitCounselorSectionWrite({
    schoolId: state.schoolId,
    ownerUid: state.ownerUid,
    capKey: state.capKey,
    section: state.workspace.sections[0],
    school: state.workspace.school,
    stages: state.workspace.stages,
    announcements: state.workspace.announcements,
    rawStudents: state.rawStudents,
    absences: state.workspace.absences,
    subjects: state.workspace.subjects,
    templates,
    pendingAuditLogs: state.pendingAuditLogs,
    announcementReads: state.announcementReads,
  });
  return tpl;
}

export async function cloudDeleteImportTemplate(id: string): Promise<void> {
  if (!cloudSession || (cloudSession.mode !== 'admin' && cloudSession.mode !== 'counselor')) {
    throw makeHttpError(403, 'غير مصرح بحذف القوالب.');
  }
  if (cloudSession.mode === 'admin') {
    const ws = assertCloudAdminWorkspace();
    ws.templates = ws.templates.filter((t) => t.id !== id);
    await commitAdminCloudWorkspace(ws);
    return;
  }
  const state = await loadCloudSectionState(cloudSession.session.sectionId || '');
  const templates = state.workspace.templates.filter((t) => t.id !== id);
  await commitCounselorSectionWrite({
    schoolId: state.schoolId,
    ownerUid: state.ownerUid,
    capKey: state.capKey,
    section: state.workspace.sections[0],
    school: state.workspace.school,
    stages: state.workspace.stages,
    announcements: state.workspace.announcements,
    rawStudents: state.rawStudents,
    absences: state.workspace.absences,
    subjects: state.workspace.subjects,
    templates,
    pendingAuditLogs: state.pendingAuditLogs,
    announcementReads: state.announcementReads,
  });
}
