import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AnnualPursuitConfig,
  AuditLogEntry,
  CustomSubRecord,
  GradeCellValue,
  GradeColumn,
  GradePeriodId,
  ReleasedPeriod,
  ImportBoundingBox,
  ImportTemplate,
  SchoolAnnouncement,
  SchoolBackupSummary,
  SchoolCodeStatus,
  SchoolFirebaseSyncMeta,
  SchoolProfile,
  SchoolPublicPayload,
  SchoolSection,
  SchoolSessionUser,
  SchoolStageGrade,
  SchoolStudent,
  SchoolStudentStatus,
  SchoolUserRole,
  SchoolWorkspacePayload,
  StudentAbsence,
  SubjectGradebook,
} from '../src/types';
import { computeStudentSubjectSummary, getTermColumns, makeCellKey } from '../src/utils/gradeCalculations';

const scryptAsync = promisify(crypto.scrypt);
const RUNTIME_FALLBACK_SESSION_SECRET = crypto.randomBytes(32);

function getSessionSigningKey(): Buffer {
  const envSecret = (process.env.SCHOOL_SESSION_SECRET || '').trim();
  if (envSecret.length >= 16) {
    return crypto.createHash('sha256').update(envSecret).digest();
  }
  return RUNTIME_FALLBACK_SESSION_SECRET;
}

export interface SecretCredential {
  hash: string;
  salt: string;
  status: SchoolCodeStatus;
  sessionVersion: number;
  updatedAt: string;
  displayCode?: string;
}

interface InternalSection extends SchoolSection {
  counselorCred: SecretCredential;
}

interface InternalStudent extends SchoolStudent {
  studentCred: SecretCredential;
}

export interface InternalSchoolTenant {
  id: string;
  ownerUid: string;
  ownerEmail: string;
  school: SchoolProfile;
  announcements: SchoolAnnouncement[];
  stages: SchoolStageGrade[];
  sections: InternalSection[];
  students: InternalStudent[];
  absences: StudentAbsence[];
  subjects: SubjectGradebook[];
  templates: ImportTemplate[];
  auditLogs: AuditLogEntry[];
  firebaseSync: SchoolFirebaseSyncMeta;
}

export interface InternalSchoolStoreData {
  schemaVersion: number;
  activePublicSchoolId: string;
  schools: Record<string, InternalSchoolTenant>;
  adminAuth: {
    mode: 'env' | 'custom';
    customCred: SecretCredential | null;
    sessionVersion: number;
    displayName: string;
  };
}

interface SessionTokenPayload {
  sid: string;
  schoolId: string;
  role: SchoolUserRole;
  displayName: string;
  ownerEmail?: string;
  sectionId?: string;
  studentId?: string;
  authMethod?: 'code' | 'google';
  sv: number;
  iat: number;
  exp: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  const rand = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${Date.now()}_${rand}`;
}

export function makeSchoolIdFromUid(uid: string): string {
  const safe = (uid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 110);
  return safe ? `school_${safe}` : 'default_school';
}

function clampStr(val: unknown, max: number, fallback = ''): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function safeAuditValue(val: unknown): string {
  const s = typeof val === 'string' ? val : JSON.stringify(val ?? '');
  return s.length > 800 ? s.slice(0, 797) + '...' : s;
}

export function normalizeAccessCode(rawCode: string): string {
  if (typeof rawCode !== 'string') return '';
  return rawCode
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim();
}

export async function hashAccessCode(rawCode: string): Promise<{ hash: string; salt: string }> {
  const clean = normalizeAccessCode(rawCode);
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scryptAsync(clean, salt, 64)) as Buffer;
  return { hash: derived.toString('hex'), salt };
}

async function verifyScryptRaw(clean: string, hash: string, salt: string): Promise<boolean> {
  const expected = Buffer.from(hash, 'hex');
  const derived = (await scryptAsync(clean, salt, 64)) as Buffer;
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

export async function verifyAccessCode(rawCode: string, hash: string, salt: string): Promise<boolean> {
  if (!rawCode || !hash || !salt) return false;
  try {
    const normalized = normalizeAccessCode(rawCode);
    if (normalized && (await verifyScryptRaw(normalized, hash, salt))) {
      return true;
    }
    const rawTrimmed = rawCode.trim();
    if (rawTrimmed && rawTrimmed !== normalized) {
      return await verifyScryptRaw(rawTrimmed, hash, salt);
    }
    return false;
  } catch {
    return false;
  }
}

function emptyCred(): SecretCredential {
  return {
    hash: '',
    salt: '',
    status: 'unset',
    sessionVersion: 1,
    updatedAt: '',
  };
}

function defaultTenantData(schoolId = 'default_school', ownerUid = '', ownerEmail = ''): InternalSchoolTenant {
  const ts = nowIso();
  return {
    id: schoolId,
    ownerUid,
    ownerEmail,
    school: {
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
      updatedAt: ts,
    },
    announcements: [],
    stages: [],
    sections: [],
    students: [],
    absences: [],
    subjects: [],
    templates: [],
    auditLogs: [],
    firebaseSync: {
      linked: Boolean(ownerUid),
      projectId: '',
      linkedEmail: ownerEmail,
      linkedUid: ownerUid,
      lastSyncedAt: '',
      lastSyncStatus: ownerUid ? 'connected' : 'idle',
      lastSyncMessage: ownerEmail
        ? `مربوط بحساب ${ownerEmail}`
        : 'غير مربوط بحساب Google الإداري بعد',
    },
  };
}

function defaultStoreData(): InternalSchoolStoreData {
  return {
    schemaVersion: 2,
    activePublicSchoolId: 'default_school',
    schools: {
      default_school: defaultTenantData('default_school'),
    },
    adminAuth: {
      mode: 'env',
      customCred: null,
      sessionVersion: 1,
      displayName: 'مدير المدرسة',
    },
  };
}

function normalizeTenant(raw: Partial<InternalSchoolTenant>, fallbackId: string): InternalSchoolTenant {
  const tenantId = clampStr(raw.id, 128) || fallbackId;
  const base = defaultTenantData(tenantId, raw.ownerUid || '', raw.ownerEmail || '');
  return {
    ...base,
    ...raw,
    id: tenantId,
    school: {
      ...base.school,
      ...(raw.school || {}),
      id: tenantId,
    },
    announcements: Array.isArray(raw.announcements) ? raw.announcements : base.announcements,
    stages: Array.isArray(raw.stages) ? raw.stages : [],
    sections: Array.isArray(raw.sections) ? raw.sections : [],
    students: Array.isArray(raw.students) ? raw.students : [],
    absences: Array.isArray(raw.absences) ? raw.absences : [],
    subjects: Array.isArray(raw.subjects) ? raw.subjects : [],
    templates: Array.isArray(raw.templates) ? raw.templates : [],
    auditLogs: Array.isArray(raw.auditLogs) ? raw.auditLogs : [],
    firebaseSync: {
      ...base.firebaseSync,
      ...(raw.firebaseSync || {}),
    },
  };
}

export class SchoolRecordError extends Error {
  statusCode: number;
  retryAfterSeconds?: number;
  constructor(statusCode: number, message: string, retryAfterSeconds?: number) {
    super(message);
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class SchoolRecordStore {
  private baseDir: string;
  private backupsDir: string;
  private storeFilePath: string;
  private data: InternalSchoolStoreData;
  private envAdminCodeCache: { raw: string; hash: string; salt: string } | null = null;
  private loginRateMap = new Map<string, { failTimestamps: number[]; lockedUntil: number; streak: number }>();

  constructor(dataDirOverride?: string) {
    this.baseDir = path.resolve(dataDirOverride || path.join(process.cwd(), '.school-record-data'));
    this.backupsDir = this.resolveSafePath('backups');
    this.storeFilePath = this.resolveSafePath('store.json');
    this.ensureDirs();
    this.data = this.loadFromDisk();
  }

  private resolveSafePath(rel: string): string {
    const resolved = path.resolve(this.baseDir, rel);
    if (resolved !== this.baseDir && !resolved.startsWith(this.baseDir + path.sep)) {
      throw new SchoolRecordError(400, 'مسار تخزين غير صالح.');
    }
    return resolved;
  }

  private ensureDirs() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(this.backupsDir)) {
      fs.mkdirSync(this.backupsDir, { recursive: true, mode: 0o700 });
    }
  }

  private loadFromDisk(): InternalSchoolStoreData {
    if (!fs.existsSync(this.storeFilePath)) {
      const initial = defaultStoreData();
      this.atomicWriteFile(this.storeFilePath, JSON.stringify(initial, null, 2));
      return initial;
    }
    try {
      const raw = fs.readFileSync(this.storeFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, any>;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid store format');
      }

      const base = defaultStoreData();
      const adminAuth = {
        ...base.adminAuth,
        ...(parsed.adminAuth || {}),
      };

      // Schema v2: multi-tenant schools map
      if (parsed.schools && typeof parsed.schools === 'object') {
        const schools: Record<string, InternalSchoolTenant> = {};
        for (const [k, v] of Object.entries(parsed.schools as Record<string, Partial<InternalSchoolTenant>>)) {
          if (v && typeof v === 'object') {
            schools[k] = normalizeTenant(v, k);
          }
        }
        if (Object.keys(schools).length === 0) {
          schools.default_school = defaultTenantData('default_school');
        }
        const activeId =
          parsed.activePublicSchoolId && schools[parsed.activePublicSchoolId]
            ? parsed.activePublicSchoolId
            : schools.default_school
            ? 'default_school'
            : Object.keys(schools)[0];
        return {
          schemaVersion: 2,
          activePublicSchoolId: activeId,
          schools,
          adminAuth,
        };
      }

      // Migrate v1 store -> v2 default_school tenant seamlessly
      if (parsed.school && typeof parsed.school === 'object') {
        const migratedDefault = normalizeTenant(
          {
            id: 'default_school',
            ownerUid: parsed.firebaseSync?.linkedUid || '',
            ownerEmail: parsed.firebaseSync?.linkedEmail || '',
            school: parsed.school,
            announcements: parsed.announcements,
            stages: parsed.stages,
            sections: parsed.sections,
            students: parsed.students,
            absences: parsed.absences,
            subjects: parsed.subjects,
            templates: parsed.templates,
            auditLogs: parsed.auditLogs,
            firebaseSync: parsed.firebaseSync,
          },
          'default_school'
        );
        const migrated: InternalSchoolStoreData = {
          schemaVersion: 2,
          activePublicSchoolId: 'default_school',
          schools: {
            default_school: migratedDefault,
          },
          adminAuth,
        };
        this.atomicWriteFile(this.storeFilePath, JSON.stringify(migrated, null, 2));
        return migrated;
      }

      throw new Error('Unknown store structure');
    } catch {
      return defaultStoreData();
    }
  }

  private atomicWriteFile(targetPath: string, content: string) {
    this.ensureDirs();
    const dir = path.dirname(targetPath);
    const tmpName = `.tmp_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const tmpPath = path.resolve(dir, tmpName);
    if (!tmpPath.startsWith(this.baseDir + path.sep)) {
      throw new SchoolRecordError(500, 'فشل التحقق من مسار الكتابة الآمن.');
    }
    fs.writeFileSync(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmpPath, targetPath);
    try {
      fs.chmodSync(targetPath, 0o600);
    } catch {
      // Ignore chmod error on non-POSIX filesystems
    }
  }

  private persist() {
    this.atomicWriteFile(this.storeFilePath, JSON.stringify(this.data, null, 2));
  }

  private getPublicTenant(): InternalSchoolTenant {
    return (
      this.data.schools[this.data.activePublicSchoolId] ||
      this.data.schools.default_school ||
      Object.values(this.data.schools)[0]
    );
  }

  private getTenantForSession(session: SchoolSessionUser): InternalSchoolTenant {
    const id = session.schoolId || this.data.activePublicSchoolId || 'default_school';
    const tenant = this.data.schools[id];
    if (!tenant) {
      throw new SchoolRecordError(401, 'مساحة المدرسة غير موجودة أو انتهت الجلسة.');
    }
    return tenant;
  }

  private appendAudit(
    tenant: InternalSchoolTenant,
    actor: { name: string; role: SchoolUserRole | 'system' },
    action: string,
    targetType: string,
    targetId: string,
    targetLabel: string,
    prevValue: unknown,
    nextValue: unknown
  ) {
    const entry: AuditLogEntry = {
      id: makeId('aud'),
      actorName: clampStr(actor.name || 'نظام', 160),
      actorRole: actor.role,
      action: clampStr(action, 160),
      targetType: clampStr(targetType, 80),
      targetId: clampStr(targetId, 128),
      targetLabel: clampStr(targetLabel, 200),
      prevValue: safeAuditValue(prevValue),
      nextValue: safeAuditValue(nextValue),
      timestamp: nowIso(),
    };
    tenant.auditLogs.unshift(entry);
    if (tenant.auditLogs.length > 1500) {
      tenant.auditLogs = tenant.auditLogs.slice(0, 1500);
    }
  }

  private getEnvAdminCode(): string {
    return (process.env.SCHOOL_ADMIN_CODE || '').trim();
  }

  public isAdminCodeConfigured(): boolean {
    if (this.data.adminAuth.mode === 'custom' && this.data.adminAuth.customCred?.status === 'active') {
      return Boolean(this.data.adminAuth.customCred.hash);
    }
    return this.getEnvAdminCode().length > 0;
  }

  private async verifyAdminCode(rawCode: string): Promise<boolean> {
    if (this.data.adminAuth.mode === 'custom' && this.data.adminAuth.customCred) {
      if (this.data.adminAuth.customCred.status !== 'active') return false;
      return verifyAccessCode(rawCode, this.data.adminAuth.customCred.hash, this.data.adminAuth.customCred.salt);
    }
    const envCode = this.getEnvAdminCode();
    if (!envCode) return false;
    if (!this.envAdminCodeCache || this.envAdminCodeCache.raw !== envCode) {
      const hashed = await hashAccessCode(envCode);
      this.envAdminCodeCache = { raw: envCode, ...hashed };
    }
    return verifyAccessCode(rawCode, this.envAdminCodeCache.hash, this.envAdminCodeCache.salt);
  }

  public getPublicPayload(): SchoolPublicPayload {
    const tenant = this.getPublicTenant();
    const publicAnnouncements = tenant.announcements
      .filter((a) => a.visibility === 'public')
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      });

    return {
      school: { ...tenant.school },
      announcements: publicAnnouncements,
      stagesCount: tenant.stages.length,
      sectionsCount: tenant.sections.length,
      adminCodeConfigured: this.isAdminCodeConfigured(),
    };
  }

  private checkLoginRateLimit(clientKey: string) {
    const now = Date.now();
    const rec = this.loginRateMap.get(clientKey);
    if (!rec) return;
    if (rec.lockedUntil > now) {
      const retrySec = Math.max(1, Math.ceil((rec.lockedUntil - now) / 1000));
      throw new SchoolRecordError(
        429,
        `تم تقييد محاولات الدخول مؤقتاً بسبب محاولات غير صحيحة متكررة. أعد المحاولة بعد ${retrySec} ثانية.`,
        retrySec
      );
    }
  }

  private recordLoginFailure(clientKey: string) {
    const now = Date.now();
    const rec = this.loginRateMap.get(clientKey) || { failTimestamps: [], lockedUntil: 0, streak: 0 };
    rec.failTimestamps = rec.failTimestamps.filter((ts) => now - ts < 5 * 60 * 1000);
    rec.failTimestamps.push(now);
    rec.streak += 1;
    if (rec.failTimestamps.length >= 5) {
      const lockMs = rec.streak >= 10 ? 5 * 60 * 1000 : 60 * 1000;
      rec.lockedUntil = now + lockMs;
      rec.failTimestamps = [];
    }
    this.loginRateMap.set(clientKey, rec);
  }

  private clearLoginFailure(clientKey: string) {
    this.loginRateMap.delete(clientKey);
  }

  private signSessionToken(payload: SessionTokenPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
    const sig = crypto
      .createHmac('sha256', getSessionSigningKey())
      .update(encoded)
      .digest('base64url');
    return `${encoded}.${sig}`;
  }

  public verifySessionToken(token: string): SchoolSessionUser | null {
    if (!token || !token.includes('.')) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, providedSig] = parts;
    try {
      const expectedSig = crypto
        .createHmac('sha256', getSessionSigningKey())
        .update(encoded)
        .digest('base64url');
      const a = Buffer.from(providedSig, 'utf-8');
      const b = Buffer.from(expectedSig, 'utf-8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return null;
      }
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as SessionTokenPayload;
      if (!payload || !payload.exp || payload.exp < Date.now()) {
        return null;
      }

      const tenant = this.data.schools[payload.schoolId || 'default_school'];
      if (!tenant) return null;

      if (payload.role === 'admin') {
        if (!this.isAdminCodeConfigured()) return null;
        if (payload.sv !== this.data.adminAuth.sessionVersion) return null;
        return {
          role: 'admin',
          displayName: payload.displayName || this.data.adminAuth.displayName || 'مدير المدرسة',
          schoolId: tenant.id,
          ownerEmail: tenant.ownerEmail || payload.ownerEmail || undefined,
        };
      }

      if (payload.role === 'counselor' && payload.sectionId) {
        const section = tenant.sections.find((s) => s.id === payload.sectionId);
        if (!section) return null;
        if (section.counselorCred.status !== 'active') return null;
        if (payload.sv !== section.counselorCred.sessionVersion) return null;
        const stage = tenant.stages.find((st) => st.id === section.stageId);
        return {
          role: 'counselor',
          displayName: section.counselorName || 'مرشد الشعبة',
          schoolId: tenant.id,
          sectionId: section.id,
          sectionName: section.name,
          stageName: stage?.name || '',
        };
      }

      if (payload.role === 'student' && payload.studentId) {
        const student = tenant.students.find((st) => st.id === payload.studentId);
        if (!student) return null;
        if (student.studentCred.status !== 'active') return null;
        if (student.status !== 'active') return null;
        if (payload.sv !== student.studentCred.sessionVersion) return null;
        const section = tenant.sections.find((s) => s.id === student.sectionId);
        const stage = section ? tenant.stages.find((st) => st.id === section.stageId) : undefined;
        return {
          role: 'student',
          displayName: student.fullName,
          schoolId: tenant.id,
          sectionId: student.sectionId,
          sectionName: section?.name || '',
          stageName: stage?.name || '',
          studentId: student.id,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  public async loginWithCode(rawCode: string, clientKey: string): Promise<{ token: string; session: SchoolSessionUser }> {
    this.checkLoginRateLimit(clientKey);
    const code = normalizeAccessCode(rawCode);
    if (!code || code.length < 3) {
      this.recordLoginFailure(clientKey);
      throw new SchoolRecordError(401, 'كود الدخول غير صحيح أو مبطل.');
    }

    // 1. Check Admin code
    if (await this.verifyAdminCode(code)) {
      this.clearLoginFailure(clientKey);
      const pubTenant = this.getPublicTenant();
      const session: SchoolSessionUser = {
        role: 'admin',
        displayName: this.data.adminAuth.displayName || 'مدير المدرسة',
        schoolId: pubTenant.id,
        ownerEmail: pubTenant.ownerEmail || undefined,
      };
      const token = this.signSessionToken({
        sid: makeId('ses'),
        schoolId: pubTenant.id,
        role: 'admin',
        displayName: session.displayName,
        ownerEmail: pubTenant.ownerEmail || undefined,
        authMethod: 'code',
        sv: this.data.adminAuth.sessionVersion,
        iat: Date.now(),
        exp: Date.now() + 12 * 60 * 60 * 1000,
      });
      this.appendAudit(pubTenant, { name: session.displayName, role: 'admin' }, 'تسجيل دخول المدير', 'auth', 'admin', 'المدير', '-', 'جلسة نشطة');
      this.persist();
      return { token, session };
    }

    // 2. Check Counselor codes across ALL school tenants (code-only, no Google needed)
    for (const tenant of Object.values(this.data.schools)) {
      for (const sec of tenant.sections) {
        if (sec.counselorCred.status === 'active' && sec.counselorCred.hash) {
          const ok = await verifyAccessCode(code, sec.counselorCred.hash, sec.counselorCred.salt);
          if (ok) {
            this.clearLoginFailure(clientKey);
            const stage = tenant.stages.find((st) => st.id === sec.stageId);
            const session: SchoolSessionUser = {
              role: 'counselor',
              displayName: sec.counselorName || 'مرشد الشعبة',
              schoolId: tenant.id,
              sectionId: sec.id,
              sectionName: sec.name,
              stageName: stage?.name || '',
            };
            const token = this.signSessionToken({
              sid: makeId('ses'),
              schoolId: tenant.id,
              role: 'counselor',
              displayName: session.displayName,
              sectionId: sec.id,
              sv: sec.counselorCred.sessionVersion,
              iat: Date.now(),
              exp: Date.now() + 12 * 60 * 60 * 1000,
            });
            this.appendAudit(
              tenant,
              { name: session.displayName, role: 'counselor' },
              'تسجيل دخول المرشد',
              'section',
              sec.id,
              sec.name,
              '-',
              'جلسة نشطة'
            );
            this.persist();
            return { token, session };
          }
        }
      }
    }

    // 3. Check Student codes across ALL school tenants (code-only, no Google needed)
    for (const tenant of Object.values(this.data.schools)) {
      for (const student of tenant.students) {
        if (student.studentCred.status === 'active' && student.status === 'active' && student.studentCred.hash) {
          const ok = await verifyAccessCode(code, student.studentCred.hash, student.studentCred.salt);
          if (ok) {
            this.clearLoginFailure(clientKey);
            const sec = tenant.sections.find((s) => s.id === student.sectionId);
            const stage = sec ? tenant.stages.find((st) => st.id === sec.stageId) : undefined;
            const session: SchoolSessionUser = {
              role: 'student',
              displayName: student.fullName,
              schoolId: tenant.id,
              sectionId: student.sectionId,
              sectionName: sec?.name || '',
              stageName: stage?.name || '',
              studentId: student.id,
            };
            const token = this.signSessionToken({
              sid: makeId('ses'),
              schoolId: tenant.id,
              role: 'student',
              displayName: student.fullName,
              sectionId: student.sectionId,
              studentId: student.id,
              sv: student.studentCred.sessionVersion,
              iat: Date.now(),
              exp: Date.now() + 12 * 60 * 60 * 1000,
            });
            this.appendAudit(
              tenant,
              { name: student.fullName, role: 'student' },
              'تسجيل دخول الطالب',
              'student',
              student.id,
              student.fullName,
              '-',
              'جلسة نشطة'
            );
            this.persist();
            return { token, session };
          }
        }
      }
    }

    this.recordLoginFailure(clientKey);
    throw new SchoolRecordError(401, 'كود الدخول غير صحيح أو تم إبطاله.');
  }

  public async loginWithVerifiedGoogleAdmin(
    input: {
      verified: { uid: string; email: string; emailVerified: boolean; displayName?: string };
      code?: string;
      initialCode?: string;
    },
    clientKey: string
  ): Promise<{ token: string; session: SchoolSessionUser; isNewSchool: boolean }> {
    this.checkLoginRateLimit(clientKey);
    const { verified } = input;
    const email = (verified.email || '').trim().toLowerCase();

    if (!verified.uid || !email || !verified.emailVerified) {
      this.recordLoginFailure(clientKey);
      throw new SchoolRecordError(
        401,
        'يجب تسجيل الدخول بحساب Google موثّق البريد الإلكتروني للمتابعة.'
      );
    }

    // Enforce Principal Code condition for EVERY Google Principal login
    if (this.isAdminCodeConfigured()) {
      const cleanCode = normalizeAccessCode(input.code || '');
      if (!cleanCode) {
        throw new SchoolRecordError(401, 'شرط الدخول: يرجى إدخال كود المدير مع حساب Google.');
      }
      const ok = await this.verifyAdminCode(cleanCode);
      if (!ok) {
        this.recordLoginFailure(clientKey);
        throw new SchoolRecordError(401, 'كود المدير غير صحيح. تأكد من كود المدير ثم أعد المحاولة.');
      }
    } else {
      const cleanInit = normalizeAccessCode(input.initialCode || input.code || '');
      if (cleanInit.length < 6) {
        throw new SchoolRecordError(
          400,
          'لم يتم تعيين كود المدير الأول بعد. أدخل كود مدير جديد (6 خانات على الأقل) لحفظه والدخول.'
        );
      }
      if (await this.checkCodeCollision(cleanInit)) {
        throw new SchoolRecordError(409, 'هذا الكود مستخدم بالفعل لحساب آخر. اختر كوداً فريداً.');
      }
      const { hash, salt } = await hashAccessCode(cleanInit);
      this.data.adminAuth.mode = 'custom';
      this.data.adminAuth.customCred = {
        hash,
        salt,
        status: 'active',
        sessionVersion: this.data.adminAuth.sessionVersion,
        updatedAt: nowIso(),
      };
    }

    this.clearLoginFailure(clientKey);

    // Isolate school storage per Gmail UID
    const schoolId = makeSchoolIdFromUid(verified.uid);
    let isNewSchool = false;
    let tenant = this.data.schools[schoolId];
    if (!tenant) {
      tenant = defaultTenantData(schoolId, verified.uid, email);
      this.data.schools[schoolId] = tenant;
      isNewSchool = true;
    } else {
      tenant.ownerUid = verified.uid;
      tenant.ownerEmail = email;
      tenant.school.id = schoolId;
    }

    tenant.firebaseSync = {
      ...tenant.firebaseSync,
      linked: true,
      linkedUid: verified.uid,
      linkedEmail: email,
      lastSyncStatus: tenant.firebaseSync.lastSyncStatus === 'synced' ? 'synced' : 'connected',
      lastSyncMessage: tenant.firebaseSync.lastSyncMessage || `مربوط بحساب ${email}`,
    };

    this.data.activePublicSchoolId = schoolId;

    const displayName = clampStr(verified.displayName || '', 160) || email || 'مدير المدرسة';
    const session: SchoolSessionUser = {
      role: 'admin',
      displayName,
      schoolId,
      ownerEmail: email,
    };

    const token = this.signSessionToken({
      sid: makeId('ses'),
      schoolId,
      role: 'admin',
      displayName,
      ownerEmail: email,
      authMethod: 'google',
      sv: this.data.adminAuth.sessionVersion,
      iat: Date.now(),
      exp: Date.now() + 12 * 60 * 60 * 1000,
    });

    this.appendAudit(
      tenant,
      { name: displayName, role: 'admin' },
      'تحقق ودخول المدير بحساب Google وكود المدير',
      'auth',
      verified.uid,
      email,
      '-',
      `جلسة مدرسة ${schoolId}`
    );
    this.persist();
    return { token, session, isNewSchool };
  }

  private sanitizeSection(sec: InternalSection, includeAccessCode = false, includeObservations = false): SchoolSection {
    return {
      id: sec.id,
      stageId: sec.stageId,
      ...(includeObservations ? { observations: sec.observations || [] } : {}),
      name: sec.name,
      counselorName: sec.counselorName,
      counselorCodeStatus: sec.counselorCodeStatus,
      counselorCodeUpdatedAt: sec.counselorCodeUpdatedAt,
      ...(includeAccessCode && sec.counselorCred.status === 'active' && sec.counselorCred.displayCode
        ? { counselorAccessCode: sec.counselorCred.displayCode }
        : {}),
      orderIndex: sec.orderIndex,
    };
  }

  private sanitizeStudent(st: InternalStudent, includeAccessCode = false): SchoolStudent {
    return {
      id: st.id,
      sectionId: st.sectionId,
      fullName: st.fullName,
      status: st.status,
      studentCodeStatus: st.studentCodeStatus,
      studentCodeUpdatedAt: st.studentCodeUpdatedAt,
      ...(includeAccessCode && st.studentCred.status === 'active' && st.studentCred.displayCode
        ? { studentAccessCode: st.studentCred.displayCode }
        : {}),
      notes: st.notes,
      createdAt: st.createdAt,
      updatedAt: st.updatedAt,
    };
  }

  public getWorkspaceForSession(session: SchoolSessionUser): SchoolWorkspacePayload {
    const tenant = this.getTenantForSession(session);
    const sortedStages = [...tenant.stages].sort((a, b) => a.orderIndex - b.orderIndex);
    const sortedAnnouncements = [...tenant.announcements].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

    if (session.role === 'admin') {
      return {
        session,
        school: { ...tenant.school },
        announcements: sortedAnnouncements,
        stages: sortedStages,
        sections: [...tenant.sections]
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((s) => this.sanitizeSection(s, true, true)),
        students: tenant.students.map((st) => this.sanitizeStudent(st, true)),
        absences: [...tenant.absences].sort((a, b) => b.date.localeCompare(a.date)),
        subjects: tenant.subjects.map((sb) => ({ ...sb })),
        templates: [...tenant.templates],
        auditLogs: tenant.auditLogs.slice(0, 300),
        firebaseSync: { ...tenant.firebaseSync },
        backups: this.listBackups(tenant.id),
        adminCodeConfigured: this.isAdminCodeConfigured(),
      };
    }

    if (session.role === 'counselor' && session.sectionId) {
      const secId = session.sectionId;
      return {
        session,
        school: { ...tenant.school },
        announcements: sortedAnnouncements,
        stages: sortedStages,
        sections: tenant.sections
          .filter((s) => s.id === secId)
          .map((s) => this.sanitizeSection(s, false, true)),
        students: tenant.students
          .filter((st) => st.sectionId === secId)
          .map((st) => this.sanitizeStudent(st, true)),
        absences: tenant.absences
          .filter((ab) => ab.sectionId === secId)
          .sort((a, b) => b.date.localeCompare(a.date)),
        subjects: tenant.subjects
          .filter((sb) => sb.sectionId === secId)
          .map((sb) => ({ ...sb })),
        templates: [...tenant.templates],
        auditLogs: [],
        backups: [],
      };
    }

    // Student read-only scope: ONLY own student profile, own absences, and own cells
    const studentId = session.studentId || '';
    const secId = session.sectionId || '';
    const ownStudent = tenant.students.find((st) => st.id === studentId && st.sectionId === secId);
    const ownSubjects: SubjectGradebook[] = tenant.subjects
      .filter((sb) => sb.sectionId === secId)
      .map((sb) => {
        const releases: SubjectGradebook['releases'] = {};
        for (const period of ['term1', 'midyear', 'term2'] as const) {
          const release = sb.releases?.[period];
          if (!release) continue;
          const cells = Object.fromEntries(Object.entries(release.cells)
            .filter(([key]) => key.startsWith(studentId + '::')));
          if (Object.keys(cells).length === 0) continue;
          const grade = release.official[studentId];
          releases[period] = { ...release, cells, official: grade == null ? {} : { [studentId]: grade } };
        }
        return { id: sb.id, name: sb.name, sectionId: secId, releases, cells: {},
          midyearColumns: [], subRecords: [], updatedAt: sb.updatedAt,
          annualPursuitConfig: { term1ColumnIds: [], midyearColumnIds: [], term2ColumnIds: [], scaleMode: 'scale100' } };
      });

    return {
      session,
      school: { ...tenant.school },
      announcements: sortedAnnouncements,
      stages: sortedStages,
      sections: tenant.sections
        .filter((s) => s.id === secId)
        .map((s) => this.sanitizeSection(s)),
      students: ownStudent ? [this.sanitizeStudent(ownStudent)] : [],
      absences: tenant.absences
        .filter((ab) => ab.studentId === studentId && ab.sectionId === secId)
        .sort((a, b) => b.date.localeCompare(a.date)),
      subjects: ownSubjects,
      templates: [],
      auditLogs: [],
      backups: [],
    };
  }

  public getStudentPersonalReport(session: SchoolSessionUser) {
    if (session.role !== 'student' || !session.studentId || !session.sectionId) {
      throw new SchoolRecordError(403, 'هذا المسار مخصص لحساب الطالب فقط.');
    }
    const workspace = this.getWorkspaceForSession(session);
    const summaries = workspace.subjects.map(subj => {
      const periods = ['term1','midyear','term2'] as const;
      const values = periods.map(p => subj.releases?.[p]?.official[session.studentId!] ?? null);
      const numeric = values.filter((v): v is number => v !== null);
      const mean = numeric.length ? Math.round(numeric.reduce((a,b) => a+b,0) * 10 / numeric.length) / 10 : null;
      return { subjectId: subj.id, subjectName: subj.name, summary: {
        term1Avg: values[0], midyearAvg: values[1], term2Avg: values[2],
        isComplete: numeric.length === 3, annualPursuit: numeric.length === 3 ? mean : null,
        percentageEquivalent: mean, missingPeriods: periods.filter((_,i) => values[i] === null),
      }};
    });
    return {
      student: workspace.students[0] || null,
      sectionName: session.sectionName || '',
      stageName: session.stageName || '',
      absences: workspace.absences,
      subjects: workspace.subjects,
      summaries,
    };
  }

  private assertAdmin(session: SchoolSessionUser) {
    if (session.role !== 'admin') {
      throw new SchoolRecordError(403, 'هذه العملية محصورة بمدير المدرسة فقط.');
    }
  }

  private assertSectionManager(session: SchoolSessionUser, sectionId: string): InternalSchoolTenant {
    const tenant = this.getTenantForSession(session);
    if (session.role === 'admin') {
      const exists = tenant.sections.some((s) => s.id === sectionId);
      if (!exists) throw new SchoolRecordError(404, 'الشعبة المطلوبة غير موجودة.');
      return tenant;
    }
    if (session.role === 'counselor' && session.sectionId === sectionId) {
      return tenant;
    }
    throw new SchoolRecordError(403, 'ليس لديك صلاحية للوصول أو التعديل على هذه الشعبة.');
  }

  public recordLogout(session: SchoolSessionUser) {
    const tenant = this.getTenantForSession(session);
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'تسجيل خروج',
      'auth',
      session.studentId || session.sectionId || 'admin',
      session.displayName,
      'جلسة نشطة',
      'خروج'
    );
    this.persist();
  }

  // === Admin Operations ===

  public updateSchoolProfile(
    session: SchoolSessionUser,
    updates: Partial<SchoolProfile>
  ): SchoolProfile {
    this.assertAdmin(session);
    const tenant = this.getTenantForSession(session);
    const prev = {
      name: tenant.school.name,
      academicYear: tenant.school.academicYear,
      directorate: tenant.school.directorate,
    };
    const nextName = clampStr(updates.name ?? tenant.school.name, 200, tenant.school.name);
    if (!nextName) throw new SchoolRecordError(400, 'اسم المدرسة مطلوب.');
    const nextYear = clampStr(updates.academicYear ?? tenant.school.academicYear, 40, tenant.school.academicYear);
    const nextDir = clampStr(updates.directorate ?? tenant.school.directorate, 160, tenant.school.directorate);

    tenant.school = {
      ...tenant.school,
      id: tenant.id,
      name: nextName,
      academicYear: nextYear,
      directorate: nextDir,
      overview: clampStr(updates.overview ?? tenant.school.overview, 4000),
      vision: clampStr(updates.vision ?? tenant.school.vision, 2000),
      mission: clampStr(updates.mission ?? tenant.school.mission, 2000),
      goals: Array.isArray(updates.goals)
        ? updates.goals.map((g) => clampStr(g, 300)).filter(Boolean).slice(0, 30)
        : tenant.school.goals,
      logoDataUrl:
        typeof updates.logoDataUrl === 'string'
          ? updates.logoDataUrl.slice(0, 350000)
          : tenant.school.logoDataUrl,
      coverDataUrl:
        typeof updates.coverDataUrl === 'string'
          ? updates.coverDataUrl.slice(0, 450000)
          : tenant.school.coverDataUrl,
      updatedAt: nowIso(),
    };
    this.data.activePublicSchoolId = tenant.id;

    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'تحديث ملف المدرسة',
      'school',
      tenant.school.id,
      tenant.school.name,
      prev,
      { name: nextName, academicYear: nextYear, directorate: nextDir }
    );
    this.persist();
    return tenant.school;
  }

  public async rotateAdminCode(session: SchoolSessionUser, newCode: string): Promise<void> {
    this.assertAdmin(session);
    const tenant = this.getTenantForSession(session);
    const clean = normalizeAccessCode(newCode || '');
    if (clean.length < 6) {
      throw new SchoolRecordError(400, 'كود المدير الجديد يجب أن لا يقل عن 6 أحرف أو أرقام.');
    }
    const { hash, salt } = await hashAccessCode(clean);
    this.data.adminAuth.sessionVersion += 1;
    this.data.adminAuth.mode = 'custom';
    this.data.adminAuth.customCred = {
      hash,
      salt,
      status: 'active',
      sessionVersion: this.data.adminAuth.sessionVersion,
      updatedAt: nowIso(),
    };
    this.appendAudit(
      tenant,
      { name: session.displayName, role: 'admin' },
      'تغيير كود المدير وإبطال الجلسات السابقة',
      'auth',
      'admin',
      'كود المدير',
      '[كود محمي سابق]',
      '[كود محمي محدث]'
    );
    this.persist();
  }

  public upsertAnnouncement(
    session: SchoolSessionUser,
    input: { id?: string; title: string; body: string; pinned?: boolean; visibility?: 'public' | 'internal' }
  ): SchoolAnnouncement {
    this.assertAdmin(session);
    const tenant = this.getTenantForSession(session);
    const title = clampStr(input.title, 200);
    const body = clampStr(input.body, 4000);
    if (!title || !body) {
      throw new SchoolRecordError(400, 'عنوان الإعلان ومحتواه مطلوبان.');
    }
    const ts = nowIso();
    this.data.activePublicSchoolId = tenant.id;
    if (input.id) {
      const idx = tenant.announcements.findIndex((a) => a.id === input.id);
      if (idx === -1) throw new SchoolRecordError(404, 'الإعلان غير موجود.');
      const prev = { ...tenant.announcements[idx] };
      tenant.announcements[idx] = {
        ...prev,
        title,
        body,
        pinned: Boolean(input.pinned),
        visibility: input.visibility === 'internal' ? 'internal' : 'public',
        updatedAt: ts,
      };
      this.appendAudit(
        tenant,
        { name: session.displayName, role: session.role },
        'تعديل إعلان',
        'announcement',
        prev.id,
        title,
        { title: prev.title, pinned: prev.pinned, visibility: prev.visibility },
        { title, pinned: Boolean(input.pinned), visibility: tenant.announcements[idx].visibility }
      );
      this.persist();
      return tenant.announcements[idx];
    }

    const created: SchoolAnnouncement = {
      id: makeId('ann'),
      title,
      body,
      pinned: Boolean(input.pinned),
      visibility: input.visibility === 'internal' ? 'internal' : 'public',
      createdAt: ts,
      updatedAt: ts,
      authorName: session.displayName,
    };
    tenant.announcements.unshift(created);
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'إضافة إعلان',
      'announcement',
      created.id,
      title,
      '-',
      { title, pinned: created.pinned, visibility: created.visibility }
    );
    this.persist();
    return created;
  }

  public deleteAnnouncement(session: SchoolSessionUser, id: string) {
    this.assertAdmin(session);
    const tenant = this.getTenantForSession(session);
    const idx = tenant.announcements.findIndex((a) => a.id === id);
    if (idx === -1) throw new SchoolRecordError(404, 'الإعلان غير موجود.');
    const removed = tenant.announcements[idx];
    tenant.announcements.splice(idx, 1);
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'حذف إعلان',
      'announcement',
      removed.id,
      removed.title,
      removed.title,
      'محذوف'
    );
    this.persist();
  }

  public upsertStage(
    session: SchoolSessionUser,
    input: { id?: string; name: string }
  ): SchoolStageGrade {
    this.assertAdmin(session);
    const tenant = this.getTenantForSession(session);
    const name = clampStr(input.name, 160);
    if (!name) throw new SchoolRecordError(400, 'اسم الصف/المرحلة مطلوب.');

    if (input.id) {
      const idx = tenant.stages.findIndex((s) => s.id === input.id);
      if (idx === -1) throw new SchoolRecordError(404, 'الصف غير موجود.');
      const prevName = tenant.stages[idx].name;
      tenant.stages[idx] = { ...tenant.stages[idx], name };
      this.appendAudit(
        tenant,
        { name: session.displayName, role: session.role },
        'تعديل اسم الصف',
        'stage',
        tenant.stages[idx].id,
        name,
        prevName,
        name
      );
      this.persist();
      return tenant.stages[idx];
    }

    const maxOrder = tenant.stages.reduce((m, s) => Math.max(m, s.orderIndex), -1);
    const created: SchoolStageGrade = {
      id: makeId('stg'),
      name,
      orderIndex: maxOrder + 1,
    };
    tenant.stages.push(created);
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'إضافة صف دراسي',
      'stage',
      created.id,
      name,
      '-',
      name
    );
    this.persist();
    return created;
  }

  public reorderStages(session: SchoolSessionUser, orderedStageIds: string[]) {
    this.assertAdmin(session);
    const tenant = this.getTenantForSession(session);
    if (!Array.isArray(orderedStageIds)) throw new SchoolRecordError(400, 'ترتيب غير صالح.');
    const prevOrder = [...tenant.stages]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((s) => s.name);

    const map = new Map<string, number>();
    orderedStageIds.forEach((id, idx) => map.set(id, idx));
    let tail = orderedStageIds.length;
    tenant.stages.forEach((st) => {
      const newIdx = map.get(st.id);
      st.orderIndex = newIdx !== undefined ? newIdx : tail++;
    });
    tenant.stages.sort((a, b) => a.orderIndex - b.orderIndex);
    const nextOrder = tenant.stages.map((s) => s.name);

    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'إعادة ترتيب الصفوف',
      'stage',
      'stages_order',
      'ترتيب الصفوف',
      prevOrder,
      nextOrder
    );
    this.persist();
  }

  public deleteStage(session: SchoolSessionUser, stageId: string) {
    this.assertAdmin(session);
    const tenant = this.getTenantForSession(session);
    const idx = tenant.stages.findIndex((s) => s.id === stageId);
    if (idx === -1) throw new SchoolRecordError(404, 'الصف غير موجود.');
    const hasSections = tenant.sections.some((sec) => sec.stageId === stageId);
    if (hasSections) {
      throw new SchoolRecordError(400, 'يرجى حذف أو نقل الشعب المرتبطة بهذا الصف أولاً.');
    }
    const removed = tenant.stages[idx];
    tenant.stages.splice(idx, 1);
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'حذف صف دراسي',
      'stage',
      removed.id,
      removed.name,
      removed.name,
      'محذوف'
    );
    this.persist();
  }

  public upsertSection(
    session: SchoolSessionUser,
    input: { id?: string; stageId: string; name: string; counselorName: string }
  ): SchoolSection {
    this.assertAdmin(session);
    const tenant = this.getTenantForSession(session);
    const stage = tenant.stages.find((s) => s.id === input.stageId);
    if (!stage) throw new SchoolRecordError(400, 'الصف المحدد غير موجود.');
    const name = clampStr(input.name, 160);
    const counselorName = clampStr(input.counselorName, 160);
    if (!name) throw new SchoolRecordError(400, 'اسم الشعبة مطلوب.');

    if (input.id) {
      const idx = tenant.sections.findIndex((s) => s.id === input.id);
      if (idx === -1) throw new SchoolRecordError(404, 'الشعبة غير موجودة.');
      const prev = tenant.sections[idx];
      const prevSnapshot = { stageId: prev.stageId, name: prev.name, counselorName: prev.counselorName };
      prev.stageId = stage.id;
      prev.name = name;
      prev.counselorName = counselorName;
      this.appendAudit(
        tenant,
        { name: session.displayName, role: session.role },
        'تعديل الشعبة / اسم المرشد',
        'section',
        prev.id,
        `${stage.name} - ${name}`,
        prevSnapshot,
        { stageId: stage.id, name, counselorName }
      );
      this.persist();
      return this.sanitizeSection(prev, true);
    }

    const maxOrder = tenant.sections
      .filter((s) => s.stageId === stage.id)
      .reduce((m, s) => Math.max(m, s.orderIndex), -1);

    const created: InternalSection = {
      id: makeId('sec'),
      stageId: stage.id,
      name,
      counselorName,
      counselorCodeStatus: 'unset',
      orderIndex: maxOrder + 1,
      counselorCred: emptyCred(),
    };
    tenant.sections.push(created);
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'إنشاء شعبة جديدة',
      'section',
      created.id,
      `${stage.name} - ${name}`,
      '-',
      { name, counselorName }
    );
    this.persist();
    return this.sanitizeSection(created);
  }

  public deleteSection(session: SchoolSessionUser, sectionId: string) {
    this.assertAdmin(session);
    const tenant = this.getTenantForSession(session);
    const idx = tenant.sections.findIndex((s) => s.id === sectionId);
    if (idx === -1) throw new SchoolRecordError(404, 'الشعبة غير موجودة.');
    const removed = tenant.sections[idx];
    tenant.sections.splice(idx, 1);
    tenant.students = tenant.students.filter((st) => st.sectionId !== sectionId);
    tenant.absences = tenant.absences.filter((ab) => ab.sectionId !== sectionId);
    tenant.subjects = tenant.subjects.filter((sb) => sb.sectionId !== sectionId);
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'حذف شعبة',
      'section',
      removed.id,
      removed.name,
      removed.name,
      'محذوف'
    );
    this.persist();
  }

  private async checkCodeCollision(rawCode: string, excludeId?: string): Promise<boolean> {
    if (await this.verifyAdminCode(rawCode)) return true;
    for (const tenant of Object.values(this.data.schools)) {
      for (const sec of tenant.sections) {
        if (sec.id !== excludeId && sec.counselorCred.status === 'active' && sec.counselorCred.hash) {
          if (await verifyAccessCode(rawCode, sec.counselorCred.hash, sec.counselorCred.salt)) return true;
        }
      }
      for (const st of tenant.students) {
        if (st.id !== excludeId && st.studentCred.status === 'active' && st.studentCred.hash) {
          if (await verifyAccessCode(rawCode, st.studentCred.hash, st.studentCred.salt)) return true;
        }
      }
    }
    return false;
  }

  public async setCounselorCode(
    session: SchoolSessionUser,
    sectionId: string,
    action: 'issue' | 'change' | 'revoke',
    rawCode?: string
  ): Promise<SchoolSection> {
    this.assertAdmin(session);
    const tenant = this.getTenantForSession(session);
    const sec = tenant.sections.find((s) => s.id === sectionId);
    if (!sec) throw new SchoolRecordError(404, 'الشعبة غير موجودة.');

    const prevStatus = sec.counselorCodeStatus;
    const ts = nowIso();

    if (action === 'revoke') {
      sec.counselorCred.status = 'revoked';
      sec.counselorCred.hash = '';
      sec.counselorCred.salt = '';
      sec.counselorCred.displayCode = '';
      sec.counselorCred.sessionVersion += 1;
      sec.counselorCred.updatedAt = ts;
      sec.counselorCodeStatus = 'revoked';
      sec.counselorCodeUpdatedAt = ts;
      this.appendAudit(
        tenant,
        { name: session.displayName, role: session.role },
        'إبطال كود المرشد وإلغاء جلساته',
        'counselor_code',
        sec.id,
        `${sec.name} (${sec.counselorName || 'مرشد'})`,
        prevStatus,
        'revoked'
      );
      this.persist();
      return this.sanitizeSection(sec, true);
    }

    const code = normalizeAccessCode(rawCode || '');
    if (code.length < 4) {
      throw new SchoolRecordError(400, 'يجب أن يتكون الكود من 4 خانات على الأقل.');
    }
    if (await this.checkCodeCollision(code, sec.id)) {
      throw new SchoolRecordError(409, 'هذا الكود مستخدم بالفعل لحساب آخر. اختر كوداً مختلفاً.');
    }

    const { hash, salt } = await hashAccessCode(code);
    sec.counselorCred.hash = hash;
    sec.counselorCred.salt = salt;
    sec.counselorCred.displayCode = code;
    sec.counselorCred.status = 'active';
    sec.counselorCred.sessionVersion += 1;
    sec.counselorCred.updatedAt = ts;
    sec.counselorCodeStatus = 'active';
    sec.counselorCodeUpdatedAt = ts;

    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      action === 'change' ? 'تغيير كود المرشد وإبطال الجلسات السابقة' : 'إصدار كود المرشد',
      'counselor_code',
      sec.id,
      `${sec.name} (${sec.counselorName || 'مرشد'})`,
      prevStatus,
      'active (كود محمي مجزأ)'
    );
    this.persist();
    return this.sanitizeSection(sec, true);
  }

  public updateFirebaseLink(
    session: SchoolSessionUser,
    meta: Partial<SchoolFirebaseSyncMeta>
  ): SchoolFirebaseSyncMeta {
    this.assertAdmin(session);
    const tenant = this.getTenantForSession(session);
    const prev = { ...tenant.firebaseSync };
    tenant.firebaseSync = {
      linked: meta.linked ?? tenant.firebaseSync.linked,
      projectId: clampStr(meta.projectId ?? tenant.firebaseSync.projectId, 160),
      linkedEmail: clampStr(meta.linkedEmail ?? tenant.firebaseSync.linkedEmail, 200),
      linkedUid: clampStr(meta.linkedUid ?? tenant.firebaseSync.linkedUid, 128),
      lastSyncedAt: clampStr(meta.lastSyncedAt ?? tenant.firebaseSync.lastSyncedAt, 40),
      lastSyncStatus: meta.lastSyncStatus ?? tenant.firebaseSync.lastSyncStatus,
      lastSyncMessage: clampStr(meta.lastSyncMessage ?? tenant.firebaseSync.lastSyncMessage, 300),
    };
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'تحديث ربط ومزامنة Firebase',
      'firebase_sync',
      tenant.firebaseSync.projectId || 'firebase',
      tenant.firebaseSync.linkedEmail || 'Firebase',
      { linked: prev.linked, status: prev.lastSyncStatus },
      { linked: tenant.firebaseSync.linked, status: tenant.firebaseSync.lastSyncStatus }
    );
    this.persist();
    return { ...tenant.firebaseSync };
  }

  // === Students & Student Codes ===

  public upsertStudent(
    session: SchoolSessionUser,
    sectionId: string,
    input: { id?: string; fullName: string; status?: SchoolStudentStatus; notes?: string }
  ): SchoolStudent {
    const tenant = this.assertSectionManager(session, sectionId);
    const fullName = clampStr(input.fullName, 160);
    if (!fullName) throw new SchoolRecordError(400, 'اسم الطالب الكامل مطلوب.');
    const status: SchoolStudentStatus =
      input.status === 'inactive' || input.status === 'transferred' ? input.status : 'active';
    const notes = clampStr(input.notes || '', 1000);
    const ts = nowIso();

    if (input.id) {
      const idx = tenant.students.findIndex((st) => st.id === input.id && st.sectionId === sectionId);
      if (idx === -1) throw new SchoolRecordError(404, 'الطالب غير موجود في هذه الشعبة.');
      const prev = tenant.students[idx];
      const prevSnap = { fullName: prev.fullName, status: prev.status, notes: prev.notes };
      prev.fullName = fullName;
      prev.status = status;
      if (status !== 'active') {
        prev.studentCred.sessionVersion += 1;
      }
      prev.notes = notes;
      prev.updatedAt = ts;
      this.appendAudit(
        tenant,
        { name: session.displayName, role: session.role },
        'تعديل بيانات طالب',
        'student',
        prev.id,
        fullName,
        prevSnap,
        { fullName, status, notes }
      );
      this.persist();
      return this.sanitizeStudent(prev, true);
    }

    const created: InternalStudent = {
      id: makeId('std'),
      sectionId,
      fullName,
      status,
      studentCodeStatus: 'unset',
      notes,
      createdAt: ts,
      updatedAt: ts,
      studentCred: emptyCred(),
    };
    tenant.students.push(created);
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'إضافة طالب جديد',
      'student',
      created.id,
      fullName,
      '-',
      { fullName, status, sectionId }
    );
    this.persist();
    return this.sanitizeStudent(created, true);
  }

  public addObservation(session: SchoolSessionUser, sectionId: string, input: {studentId?: string; category?: string; note?: string}) {
    const tenant = this.assertSectionManager(session, sectionId);
    const section = tenant.sections.find(s => s.id === sectionId);
    if (!section) throw new SchoolRecordError(404, 'الشعبة غير موجودة.');
    const category = input.category?.trim(), note = input.note?.trim() || '';
    if (!category || category.length > 100 || note.length > 2000)
      throw new SchoolRecordError(400, 'تحقق من عنوان الحالة وطول الملاحظة.');
    if (input.studentId !== undefined && !tenant.students.some(s => s.id === input.studentId && s.sectionId === sectionId))
      throw new SchoolRecordError(400, 'اختر طالباً من الشعبة.');
    const observation = {id: makeId('obs'), studentId: input.studentId, category, note, createdAt: new Date().toISOString()};
    section.observations = [...(section.observations || []), observation];
    this.appendAudit(tenant, {name:session.displayName, role:session.role}, 'إضافة ملاحظة', 'section', sectionId, section.name, '', observation.id);
    this.persist();
  }

  public deleteStudent(session: SchoolSessionUser, sectionId: string, studentId: string) {
    const tenant = this.assertSectionManager(session, sectionId);
    const idx = tenant.students.findIndex((st) => st.id === studentId && st.sectionId === sectionId);
    if (idx === -1) throw new SchoolRecordError(404, 'الطالب غير موجود في هذه الشعبة.');
    const removed = tenant.students[idx];
    tenant.students.splice(idx, 1);
    const section = tenant.sections.find(s => s.id === sectionId);
    if (section?.observations) section.observations = section.observations.filter(n => n.studentId !== studentId);
    tenant.absences = tenant.absences.filter((ab) => ab.studentId !== studentId);
    const prefix = `${studentId}::`;
    for (const subj of tenant.subjects) {
      if (subj.sectionId !== sectionId) continue;
      for (const k of Object.keys(subj.cells)) {
        if (k.startsWith(prefix)) delete subj.cells[k];
      }
    }
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'حذف طالب',
      'student',
      removed.id,
      removed.fullName,
      removed.fullName,
      'محذوف'
    );
    this.persist();
  }

  public async setStudentCode(
    session: SchoolSessionUser,
    sectionId: string,
    studentId: string,
    action: 'issue' | 'change' | 'revoke',
    rawCode?: string
  ): Promise<SchoolStudent> {
    const tenant = this.assertSectionManager(session, sectionId);
    const student = tenant.students.find((st) => st.id === studentId && st.sectionId === sectionId);
    if (!student) throw new SchoolRecordError(404, 'الطالب غير موجود في هذه الشعبة.');
    const prevStatus = student.studentCodeStatus;
    const ts = nowIso();

    if (action === 'revoke') {
      student.studentCred.status = 'revoked';
      student.studentCred.hash = '';
      student.studentCred.salt = '';
      student.studentCred.displayCode = '';
      student.studentCred.sessionVersion += 1;
      student.studentCred.updatedAt = ts;
      student.studentCodeStatus = 'revoked';
      student.studentCodeUpdatedAt = ts;
      student.updatedAt = ts;
      this.appendAudit(
        tenant,
        { name: session.displayName, role: session.role },
        'إبطال كود الطالب وإلغاء جلساته',
        'student_code',
        student.id,
        student.fullName,
        prevStatus,
        'revoked'
      );
      this.persist();
      return this.sanitizeStudent(student, true);
    }

    const code = normalizeAccessCode(rawCode || '');
    if (code.length < 4) {
      throw new SchoolRecordError(400, 'يجب أن يتكون كود الطالب من 4 خانات على الأقل.');
    }
    if (await this.checkCodeCollision(code, student.id)) {
      throw new SchoolRecordError(409, 'هذا الكود مستخدم بالفعل لحساب آخر. اختر كوداً فريداً.');
    }

    const { hash, salt } = await hashAccessCode(code);
    student.studentCred.hash = hash;
    student.studentCred.salt = salt;
    student.studentCred.displayCode = code;
    student.studentCred.status = 'active';
    student.studentCred.sessionVersion += 1;
    student.studentCred.updatedAt = ts;
    student.studentCodeStatus = 'active';
    student.studentCodeUpdatedAt = ts;
    student.updatedAt = ts;

    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      action === 'change' ? 'تغيير كود الطالب وإبطال الجلسات السابقة' : 'إصدار كود الطالب',
      'student_code',
      student.id,
      student.fullName,
      prevStatus,
      'active (كود محمي مجزأ)'
    );
    this.persist();
    return this.sanitizeStudent(student, true);
  }

  public async bulkIssueStudentCodes(
    session: SchoolSessionUser,
    sectionId: string,
    mode: 'missing_only' | 'regenerate_all' = 'missing_only'
  ): Promise<{ issuedCount: number; skippedCount: number; students: SchoolStudent[] }> {
    const tenant = this.assertSectionManager(session, sectionId);
    const sectionStudents = tenant.students.filter((st) => st.sectionId === sectionId);
    if (sectionStudents.length === 0) {
      throw new SchoolRecordError(400, 'لا يوجد طلبة في هذه الشعبة لإصدار الأكواد لهم.');
    }

    const activeStudents = sectionStudents.filter((st) => st.status === 'active');
    if (activeStudents.length === 0) {
      throw new SchoolRecordError(400, 'لا يوجد طلبة نشطون في هذه الشعبة لإصدار الأكواد لهم.');
    }

    const usedDisplayCodes = new Set<string>();
    for (const t of Object.values(this.data.schools)) {
      for (const sec of t.sections) {
        if (sec.counselorCred.displayCode) usedDisplayCodes.add(sec.counselorCred.displayCode);
      }
      for (const st of t.students) {
        if (st.studentCred.displayCode) usedDisplayCodes.add(st.studentCred.displayCode);
      }
    }

    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const generateCandidate = () => {
      let suffix = '';
      for (let i = 0; i < 6; i++) {
        suffix += alphabet[crypto.randomInt(0, alphabet.length)];
      }
      return `STU-${suffix}`;
    };

    const ts = nowIso();
    let issuedCount = 0;
    let skippedCount = 0;

    for (const student of activeStudents) {
      const hasActive =
        student.studentCred.status === 'active' &&
        Boolean(student.studentCred.hash) &&
        Boolean(student.studentCred.displayCode);
      if (mode === 'missing_only' && hasActive) {
        skippedCount += 1;
        continue;
      }

      let code = generateCandidate();
      let guard = 0;
      while (
        guard < 25 &&
        (usedDisplayCodes.has(code) || (await this.checkCodeCollision(code, student.id)))
      ) {
        code = generateCandidate();
        guard += 1;
      }
      usedDisplayCodes.add(code);

      const { hash, salt } = await hashAccessCode(code);
      student.studentCred.hash = hash;
      student.studentCred.salt = salt;
      student.studentCred.displayCode = code;
      student.studentCred.status = 'active';
      student.studentCred.sessionVersion += 1;
      student.studentCred.updatedAt = ts;
      student.studentCodeStatus = 'active';
      student.studentCodeUpdatedAt = ts;
      student.updatedAt = ts;
      issuedCount += 1;
    }

    if (issuedCount > 0) {
      this.appendAudit(
        tenant,
        { name: session.displayName, role: session.role },
        mode === 'regenerate_all'
          ? 'إعادة توليد أكواد جماعية لطلبة الشعبة'
          : 'إصدار أكواد جماعية لطلبة الشعبة',
        'student_code_bulk',
        sectionId,
        `الشعبة (${activeStudents.length} طالب)`,
        `متبقي ${skippedCount}`,
        `تم إصدار ${issuedCount} كود محمي`
      );
      this.persist();
    }

    return {
      issuedCount,
      skippedCount,
      students: sectionStudents.map((st) => this.sanitizeStudent(st, true)),
    };
  }

  // === Absences ===

  public upsertAbsence(
    session: SchoolSessionUser,
    sectionId: string,
    input: {
      id?: string;
      studentId: string;
      date: string;
      excuseType: StudentAbsence['excuseType'];
      subjectName?: string;
      notes?: string;
    }
  ): StudentAbsence {
    const tenant = this.assertSectionManager(session, sectionId);
    const student = tenant.students.find((st) => st.id === input.studentId && st.sectionId === sectionId);
    if (!student) throw new SchoolRecordError(404, 'الطالب غير موجود في هذه الشعبة.');
    const date = clampStr(input.date, 20);
    if (!date) throw new SchoolRecordError(400, 'تاريخ الغياب مطلوب.');
    const excuseType: StudentAbsence['excuseType'] =
      ['excused', 'unexcused', 'medical', 'official'].includes(input.excuseType)
        ? input.excuseType
        : 'unexcused';
    const subjectName = clampStr(input.subjectName || '', 120);
    const notes = clampStr(input.notes || '', 1000);
    const ts = nowIso();

    if (input.id) {
      const idx = tenant.absences.findIndex((ab) => ab.id === input.id && ab.sectionId === sectionId);
      if (idx === -1) throw new SchoolRecordError(404, 'سجل الغياب غير موجود.');
      const prev = { ...tenant.absences[idx] };
      tenant.absences[idx] = {
        ...prev,
        date,
        excuseType,
        subjectName,
        notes,
        updatedAt: ts,
      };
      this.appendAudit(
        tenant,
        { name: session.displayName, role: session.role },
        'تعديل غياب طالب',
        'absence',
        prev.id,
        `${student.fullName} (${date})`,
        { date: prev.date, excuseType: prev.excuseType, subjectName: prev.subjectName },
        { date, excuseType, subjectName }
      );
      this.persist();
      return tenant.absences[idx];
    }

    const created: StudentAbsence = {
      id: makeId('abs'),
      sectionId,
      studentId: student.id,
      date,
      excuseType,
      subjectName,
      notes,
      recordedBy: session.displayName,
      createdAt: ts,
      updatedAt: ts,
    };
    tenant.absences.unshift(created);
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'تسجيل غياب طالب',
      'absence',
      created.id,
      `${student.fullName} (${date})`,
      '-',
      { date, excuseType, subjectName, notes }
    );
    this.persist();
    return created;
  }

  public deleteAbsence(session: SchoolSessionUser, sectionId: string, absenceId: string) {
    const tenant = this.assertSectionManager(session, sectionId);
    const idx = tenant.absences.findIndex((ab) => ab.id === absenceId && ab.sectionId === sectionId);
    if (idx === -1) throw new SchoolRecordError(404, 'سجل الغياب غير موجود.');
    const removed = tenant.absences[idx];
    const student = tenant.students.find((s) => s.id === removed.studentId);
    tenant.absences.splice(idx, 1);
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'حذف سجل غياب',
      'absence',
      removed.id,
      `${student?.fullName || removed.studentId} (${removed.date})`,
      { date: removed.date, excuseType: removed.excuseType },
      'محذوف'
    );
    this.persist();
  }

  // === Subjects & Gradebooks ===

  public createOrUpdateSubject(
    session: SchoolSessionUser,
    sectionId: string,
    input: {
      id?: string;
      name: string;
      midyearColumns?: GradeColumn[];
      subRecords?: CustomSubRecord[];
      annualPursuitConfig?: AnnualPursuitConfig;
    }
  ): SubjectGradebook {
    const tenant = this.assertSectionManager(session, sectionId);
    const name = clampStr(input.name, 160);
    if (!name) throw new SchoolRecordError(400, 'اسم المادة مطلوب.');
    const ts = nowIso();

    if (input.id) {
      const idx = tenant.subjects.findIndex((sb) => sb.id === input.id && sb.sectionId === sectionId);
      if (idx === -1) throw new SchoolRecordError(404, 'دفتر المادة غير موجود.');
      const existing = tenant.subjects[idx];
      const prevSnap = {
        name: existing.name,
        subRecordsCount: existing.subRecords.length,
        midyearCols: existing.midyearColumns.length,
        scaleMode: existing.annualPursuitConfig.scaleMode,
      };

      const validColIds = new Set<string>();
      const midyearCols = (input.midyearColumns ?? existing.midyearColumns)
        .map((c, i) => {
          const cid = clampStr(c.id, 128) || makeId('col');
          validColIds.add(cid);
          return {
            id: cid,
            label: clampStr(c.label, 120, 'درجة نصف السنة'),
            maxScore: Math.max(1, Math.min(1000, Number(c.maxScore) || 100)),
            orderIndex: i,
          };
        });

      const subRecords = (input.subRecords ?? existing.subRecords).map((r, rIdx) => {
        const rid = clampStr(r.id, 128) || makeId('rec');
        const cols = (r.columns || []).map((c, cIdx) => {
          const cid = clampStr(c.id, 128) || makeId('col');
          validColIds.add(cid);
          return {
            id: cid,
            label: clampStr(c.label, 120, 'عمود'),
            maxScore: Math.max(1, Math.min(1000, Number(c.maxScore) || 100)),
            orderIndex: cIdx,
          };
        });
        return {
          id: rid,
          periodId: (r.periodId === 'term2' ? 'term2' : 'term1') as 'term1' | 'term2',
          name: clampStr(r.name, 120, 'سجل'),
          orderIndex: rIdx,
          columns: cols,
        };
      });

      const cleanedCells: Record<string, GradeCellValue> = {};
      for (const [k, v] of Object.entries(existing.cells)) {
        const parts = k.split('::');
        const colId = parts[1];
        if (!colId || !validColIds.has(colId)) continue;
        cleanedCells[k] = v;
      }

      const incomingCfg = input.annualPursuitConfig ?? existing.annualPursuitConfig;
      const annualPursuitConfig: AnnualPursuitConfig = {
        term1ColumnIds: (incomingCfg.term1ColumnIds || []).filter((id) => validColIds.has(id)),
        midyearColumnIds: (incomingCfg.midyearColumnIds || []).filter((id) => validColIds.has(id)),
        term2ColumnIds: (incomingCfg.term2ColumnIds || []).filter((id) => validColIds.has(id)),
        scaleMode: incomingCfg.scaleMode === 'raw' ? 'raw' : 'scale100',
      };

      tenant.subjects[idx] = {
        ...existing,
        name,
        midyearColumns: midyearCols,
        subRecords,
        cells: cleanedCells,
        annualPursuitConfig,
        updatedAt: ts,
      };

      this.appendAudit(
        tenant,
        { name: session.displayName, role: session.role },
        'تحديث هيكل دفتر المادة',
        'subject',
        existing.id,
        name,
        prevSnap,
        {
          name,
          subRecordsCount: subRecords.length,
          midyearCols: midyearCols.length,
          scaleMode: annualPursuitConfig.scaleMode,
        }
      );
      this.persist();
      return tenant.subjects[idx];
    }

    const colT1 = makeId('col');
    const colMid = makeId('col');
    const colT2 = makeId('col');
    const created: SubjectGradebook = {
      id: makeId('sub'),
      sectionId,
      name,
      midyearColumns: [{ id: colMid, label: 'امتحان نصف السنة', maxScore: 100, orderIndex: 0 }],
      subRecords: [
        {
          id: makeId('rec'),
          periodId: 'term1',
          name: 'درجات الفصل الأول',
          orderIndex: 0,
          columns: [{ id: colT1, label: 'معدل الفصل الأول', maxScore: 100, orderIndex: 0 }],
        },
        {
          id: makeId('rec'),
          periodId: 'term2',
          name: 'درجات الفصل الثاني',
          orderIndex: 0,
          columns: [{ id: colT2, label: 'معدل الفصل الثاني', maxScore: 100, orderIndex: 0 }],
        },
      ],
      cells: {},
      annualPursuitConfig: {
        term1ColumnIds: [colT1],
        midyearColumnIds: [colMid],
        term2ColumnIds: [colT2],
        scaleMode: 'scale100',
      },
      updatedAt: ts,
    };
    tenant.subjects.push(created);
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'إنشاء دفتر مادة جديد',
      'subject',
      created.id,
      name,
      '-',
      name
    );
    this.persist();
    return created;
  }

  public deleteSubject(session: SchoolSessionUser, sectionId: string, subjectId: string) {
    const tenant = this.assertSectionManager(session, sectionId);
    const idx = tenant.subjects.findIndex((sb) => sb.id === subjectId && sb.sectionId === sectionId);
    if (idx === -1) throw new SchoolRecordError(404, 'دفتر المادة غير موجود.');
    const removed = tenant.subjects[idx];
    tenant.subjects.splice(idx, 1);
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'حذف دفتر مادة',
      'subject',
      removed.id,
      removed.name,
      removed.name,
      'محذوف'
    );
    this.persist();
  }

  private findColumnInSubject(subj: SubjectGradebook, columnId: string): GradeColumn | null {
    for (const c of subj.midyearColumns) {
      if (c.id === columnId) return c;
    }
    for (const rec of subj.subRecords) {
      for (const c of rec.columns) {
        if (c.id === columnId) return c;
      }
    }
    return null;
  }

  public releasePeriod(session: SchoolSessionUser, sectionId: string, subjectId: string, period: GradePeriodId, approve: boolean) {
    const tenant = this.assertSectionManager(session, sectionId);
    if (!['term1', 'midyear', 'term2'].includes(period) || typeof approve !== 'boolean')
      throw new SchoolRecordError(400, 'طلب نشر غير صالح.');
    const subject = tenant.subjects.find(s => s.sectionId === sectionId && s.id === subjectId);
    if (!subject) throw new SchoolRecordError(404, 'المادة غير موجودة.');
    const columns = getTermColumns(subject, period);
    const selected = subject.annualPursuitConfig[period === 'midyear' ? 'midyearColumnIds' : period === 'term1' ? 'term1ColumnIds' : 'term2ColumnIds'];
    const counted = columns.filter(c => selected.includes(c.id));
    const release: ReleasedPeriod = { updatedAt: new Date().toISOString(), approved: approve,
      columns: structuredClone(columns), cells: {}, official: {} };
    for (const student of tenant.students.filter(s => s.sectionId === sectionId)) {
      for (const col of columns) {
        const key = makeCellKey(student.id, col.id);
        const cell = subject.cells[key];
        if (cell && cell.status !== 'blank') release.cells[key] = { ...cell };
      }
      if (!approve || !counted.length) continue;
      const marks = counted.map(c => ({ col: c, cell: release.cells[makeCellKey(student.id, c.id)] }));
      if (marks.some(m => !m.cell || !['score','exempt'].includes(m.cell.status))) continue;
      const numeric = marks.filter(m => m.cell.status === 'score' && m.cell.score != null);
      if (numeric.length) release.official[student.id] = Math.round(1000 * numeric.reduce((sum,m) =>
        sum + m.cell.score! / m.col.maxScore, 0) / numeric.length) / 10;
    }
    if (!Object.keys(release.cells).length) throw new SchoolRecordError(400, 'لا توجد درجات محفوظة للنشر.');
    if (approve && !Object.keys(release.official).length) throw new SchoolRecordError(400, 'لم تكتمل درجات الأعمدة المحددة للحساب لأي طالب.');
    subject.releases = { ...subject.releases, [period]: release };
    this.appendAudit(tenant, { name: session.displayName, role: session.role }, approve ? 'اعتماد فترة' : 'نشر درجات', 'subject', subjectId, subject.name, '', period);
    this.persist();
  }

  public updateGradeCells(
    session: SchoolSessionUser,
    sectionId: string,
    subjectId: string,
    updates: { studentId: string; columnId: string; value: GradeCellValue }[]
  ): SubjectGradebook {
    const tenant = this.assertSectionManager(session, sectionId);
    const subj = tenant.subjects.find((sb) => sb.id === subjectId && sb.sectionId === sectionId);
    if (!subj) throw new SchoolRecordError(404, 'دفتر المادة غير موجود.');
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new SchoolRecordError(400, 'لا توجد تغييرات للحفظ.');
    }

    const validated: { key: string; studentName: string; colLabel: string; nextVal: GradeCellValue }[] = [];
    for (const item of updates) {
      const student = tenant.students.find((s) => s.id === item.studentId && s.sectionId === sectionId);
      if (!student) {
        throw new SchoolRecordError(400, 'أحد الطلبة غير موجود ضمن هذه الشعبة.');
      }
      const col = this.findColumnInSubject(subj, item.columnId);
      if (!col) {
        throw new SchoolRecordError(400, 'أحد الأعمدة غير موجود في دفتر هذه المادة.');
      }
      const status = item.value?.status;
      if (!['score', 'blank', 'absent', 'exempt'].includes(status)) {
        throw new SchoolRecordError(400, 'حالة الدرجة غير صالحة.');
      }
      let score: number | null = null;
      if (status === 'score') {
        const num = Number(item.value.score);
        if (item.value.score === null || item.value.score === undefined || Number.isNaN(num) || !Number.isFinite(num)) {
          throw new SchoolRecordError(400, `يرجى إدخال قيمة رقمية صالحة للطالب ${student.fullName}.`);
        }
        if (num < 0 || num > col.maxScore) {
          throw new SchoolRecordError(
            400,
            `الدرجة (${num}) للطالب ${student.fullName} تتجاوز الحدود المسموحة (0 إلى ${col.maxScore}).`
          );
        }
        score = Math.round(num * 100) / 100;
      }
      validated.push({
        key: makeCellKey(student.id, col.id),
        studentName: student.fullName,
        colLabel: col.label,
        nextVal: { status, score },
      });
    }

    const changeLog: string[] = [];
    for (const v of validated) {
      const prev = subj.cells[v.key] ?? { status: 'blank', score: null };
      if (prev.status !== v.nextVal.status || prev.score !== v.nextVal.score) {
        changeLog.push(`${v.studentName} [${v.colLabel}]: ${prev.status === 'score' ? prev.score : prev.status} -> ${v.nextVal.status === 'score' ? v.nextVal.score : v.nextVal.status}`);
        if (v.nextVal.status === 'blank') {
          delete subj.cells[v.key];
        } else {
          subj.cells[v.key] = v.nextVal;
        }
      }
    }

    subj.updatedAt = nowIso();
    if (changeLog.length > 0) {
      this.appendAudit(
        tenant,
        { name: session.displayName, role: session.role },
        'تعديل درجات في الدفتر',
        'grade_cells',
        subj.id,
        subj.name,
        `${changeLog.length} خلية`,
        changeLog.slice(0, 6).join(' | ')
      );
      this.persist();
    }
    return subj;
  }

  public commitSmartImport(
    session: SchoolSessionUser,
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
  ): { subject: SubjectGradebook; appliedCount: number; skippedCount: number } {
    const tenant = this.assertSectionManager(session, sectionId);
    if (!Array.isArray(payload.columnsSpec) || payload.columnsSpec.length === 0) {
      throw new SchoolRecordError(400, 'يجب تضمين عمود واحد على الأقل للترحيل.');
    }

    const prevSubjectsSnapshot = JSON.stringify(tenant.subjects);
    const prevLogsSnapshot = JSON.stringify(tenant.auditLogs);

    try {
      let targetSubj: SubjectGradebook | undefined;
      const ts = nowIso();

      if (payload.subjectId) {
        targetSubj = tenant.subjects.find((sb) => sb.id === payload.subjectId && sb.sectionId === sectionId);
        if (!targetSubj) throw new SchoolRecordError(404, 'المادة الهدف غير موجودة في هذه الشعبة.');
      } else {
        const sName = clampStr(payload.newSubjectName || '', 160);
        if (!sName) throw new SchoolRecordError(400, 'يرجى تحديد مادة موجودة أو كتابة اسم مادة جديدة.');
        targetSubj = {
          id: makeId('sub'),
          sectionId,
          name: sName,
          midyearColumns: [],
          subRecords: [],
          cells: {},
          annualPursuitConfig: {
            term1ColumnIds: [],
            midyearColumnIds: [],
            term2ColumnIds: [],
            scaleMode: 'scale100',
          },
          updatedAt: ts,
        };
        tenant.subjects.push(targetSubj);
      }

      const tempToCol = new Map<string, GradeColumn>();
      for (const spec of payload.columnsSpec) {
        const maxScore = Number(spec.maxScore);
        if (Number.isNaN(maxScore) || maxScore <= 0 || maxScore > 1000) {
          throw new SchoolRecordError(400, `الدرجة العظمى للعمود «${spec.columnLabel}» غير صالحة.`);
        }
        const label = clampStr(spec.columnLabel, 120);
        if (!label) {
          throw new SchoolRecordError(400, 'عنوان أحد الأعمدة المضمّنة فارغ.');
        }

        if (spec.periodId === 'midyear') {
          let existingCol = targetSubj.midyearColumns.find((c) => c.label === label);
          if (!existingCol) {
            existingCol = {
              id: makeId('col'),
              label,
              maxScore,
              orderIndex: targetSubj.midyearColumns.length,
            };
            targetSubj.midyearColumns.push(existingCol);
            targetSubj.annualPursuitConfig.midyearColumnIds.push(existingCol.id);
          } else {
            existingCol.maxScore = maxScore;
          }
          tempToCol.set(spec.tempKey, existingCol);
        } else {
          const recName = clampStr(spec.subRecordName || (spec.periodId === 'term1' ? 'درجات الفصل الأول' : 'درجات الفصل الثاني'), 120);
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
            col = {
              id: makeId('col'),
              label,
              maxScore,
              orderIndex: rec.columns.length,
            };
            rec.columns.push(col);
            if (spec.periodId === 'term1') {
              targetSubj.annualPursuitConfig.term1ColumnIds.push(col.id);
            } else {
              targetSubj.annualPursuitConfig.term2ColumnIds.push(col.id);
            }
          } else {
            col.maxScore = maxScore;
          }
          tempToCol.set(spec.tempKey, col);
        }
      }

      let appliedCount = 0;
      let skippedCount = 0;

      for (const entry of payload.entries) {
        if (entry.resolution === 'skip') {
          skippedCount += 1;
          continue;
        }
        const student = tenant.students.find((s) => s.id === entry.studentId && s.sectionId === sectionId);
        if (!student) {
          throw new SchoolRecordError(400, `الطالب (${entry.studentId}) غير موجود في الشعبة.`);
        }
        const col = tempToCol.get(entry.tempKey);
        if (!col) {
          throw new SchoolRecordError(400, 'عمود الترحيل غير مطابق للمواصفات.');
        }

        const key = makeCellKey(student.id, col.id);
        const existingCell = targetSubj.cells[key];
        const hasConflict = Boolean(existingCell && existingCell.status !== 'blank');
        if (hasConflict && entry.resolution === 'keep') {
          skippedCount += 1;
          continue;
        }

        const val = entry.value;
        if (val.status === 'score') {
          const num = Number(val.score);
          if (val.score === null || val.score === undefined || Number.isNaN(num) || num < 0 || num > col.maxScore) {
            throw new SchoolRecordError(
              400,
              `الدرجة (${val.score}) للطالب «${student.fullName}» في «${col.label}» تتجاوز الحد (0 - ${col.maxScore}).`
            );
          }
          targetSubj.cells[key] = { status: 'score', score: Math.round(num * 100) / 100 };
        } else if (val.status === 'absent' || val.status === 'exempt') {
          targetSubj.cells[key] = { status: val.status, score: null };
        } else {
          delete targetSubj.cells[key];
        }
        appliedCount += 1;
      }

      targetSubj.updatedAt = ts;
      this.appendAudit(
        tenant,
        { name: session.displayName, role: session.role },
        'ترحيل درجات من الاستيراد الذكي',
        'smart_import',
        targetSubj.id,
        targetSubj.name,
        `${payload.columnsSpec.length} عمود`,
        `تم ترحيل ${appliedCount} خلية (تخطي ${skippedCount})`
      );
      this.persist();
      return { subject: targetSubj, appliedCount, skippedCount };
    } catch (err) {
      tenant.subjects = JSON.parse(prevSubjectsSnapshot) as SubjectGradebook[];
      tenant.auditLogs = JSON.parse(prevLogsSnapshot) as AuditLogEntry[];
      throw err;
    }
  }

  // === Import Templates ===

  public saveImportTemplate(
    session: SchoolSessionUser,
    input: { name: string; description?: string; boxes: ImportBoundingBox[] }
  ): ImportTemplate {
    if (session.role !== 'admin' && session.role !== 'counselor') {
      throw new SchoolRecordError(403, 'غير مصرح بحفظ القوالب.');
    }
    const tenant = this.getTenantForSession(session);
    const name = clampStr(input.name, 160);
    if (!name) throw new SchoolRecordError(400, 'اسم القالب مطلوب.');
    if (!Array.isArray(input.boxes) || input.boxes.length === 0) {
      throw new SchoolRecordError(400, 'يجب رسم مربع واحد على الأقل لحفظ القالب.');
    }
    const tpl: ImportTemplate = {
      id: makeId('tpl'),
      name,
      description: clampStr(input.description || '', 1000),
      boxes: input.boxes.slice(0, 40),
      createdAt: nowIso(),
    };
    tenant.templates.unshift(tpl);
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'حفظ قالب استيراد كشوف',
      'template',
      tpl.id,
      tpl.name,
      '-',
      `${tpl.boxes.length} مربعات`
    );
    this.persist();
    return tpl;
  }

  public deleteImportTemplate(session: SchoolSessionUser, templateId: string) {
    if (session.role !== 'admin' && session.role !== 'counselor') {
      throw new SchoolRecordError(403, 'غير مصرح بحذف القوالب.');
    }
    const tenant = this.getTenantForSession(session);
    const idx = tenant.templates.findIndex((t) => t.id === templateId);
    if (idx === -1) throw new SchoolRecordError(404, 'القالب غير موجود.');
    const removed = tenant.templates[idx];
    tenant.templates.splice(idx, 1);
    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'حذف قالب استيراد',
      'template',
      removed.id,
      removed.name,
      removed.name,
      'محذوف'
    );
    this.persist();
  }

  // === Offline Backups (Scoped per school; Zero plaintext codes or hashes exported) ===

  public listBackups(schoolId = 'default_school'): SchoolBackupSummary[] {
    this.ensureDirs();
    try {
      const files = fs.readdirSync(this.backupsDir).filter((f) => {
        if (!/^backup_[a-zA-Z0-9_-]+(?:__\d+)?\.json$/.test(f)) return false;
        if (f.startsWith(`backup_${schoolId}__`)) return true;
        if (schoolId === 'default_school' && /^backup_\d+\.json$/.test(f)) return true;
        return false;
      });
      return files
        .map((fileName) => {
          const full = this.resolveSafePath(path.join('backups', fileName));
          const stat = fs.statSync(full);
          return {
            fileName,
            createdAt: stat.mtime.toISOString(),
            sizeBytes: stat.size,
          };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  public exportSanitizedData(schoolId?: string) {
    const tenant =
      (schoolId && this.data.schools[schoolId]) || this.getPublicTenant();
    return {
      schemaVersion: this.data.schemaVersion,
      exportedAt: nowIso(),
      school: tenant.school,
      announcements: tenant.announcements,
      stages: tenant.stages,
      sections: tenant.sections.map((s) => this.sanitizeSection(s, false, true)),
      students: tenant.students.map((st) => this.sanitizeStudent(st)),
      absences: tenant.absences,
      subjects: tenant.subjects,
      templates: tenant.templates,
      auditLogs: tenant.auditLogs,
    };
  }

  public createLocalBackupSnapshot(session: SchoolSessionUser): SchoolBackupSummary {
    this.assertAdmin(session);
    const tenant = this.getTenantForSession(session);
    this.ensureDirs();
    const fileName = `backup_${tenant.id}__${Date.now()}.json`;
    const target = this.resolveSafePath(path.join('backups', fileName));
    const snapshot = this.exportSanitizedData(tenant.id);
    const json = JSON.stringify(snapshot, null, 2);
    this.atomicWriteFile(target, json);

    const all = this.listBackups(tenant.id);
    if (all.length > 20) {
      for (const old of all.slice(20)) {
        try {
          fs.unlinkSync(this.resolveSafePath(path.join('backups', old.fileName)));
        } catch {
          // ignore
        }
      }
    }

    this.appendAudit(
      tenant,
      { name: session.displayName, role: session.role },
      'إنشاء نسخة احتياطية محلية آمنة',
      'backup',
      fileName,
      fileName,
      '-',
      `${json.length} بايت`
    );
    this.persist();

    const stat = fs.statSync(target);
    return {
      fileName,
      createdAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    };
  }

  public restoreSanitizedBackup(
    session: SchoolSessionUser,
    backupFileName?: string,
    uploadedBackup?: ReturnType<SchoolRecordStore['exportSanitizedData']>
  ) {
    this.assertAdmin(session);
    const tenant = this.getTenantForSession(session);
    const prevSnapshot = JSON.stringify(tenant);
    try {
      let source: ReturnType<SchoolRecordStore['exportSanitizedData']>;
      if (backupFileName) {
        if (!/^backup_[a-zA-Z0-9_-]+(?:__\d+)?\.json$/.test(backupFileName)) {
          throw new SchoolRecordError(400, 'اسم ملف النسخة الاحتياطية غير صالح.');
        }
        const belongsToTenant =
          backupFileName.startsWith(`backup_${tenant.id}__`) ||
          (tenant.id === 'default_school' && /^backup_\d+\.json$/.test(backupFileName));
        if (!belongsToTenant) {
          throw new SchoolRecordError(403, 'لا يمكن استعادة نسخة تخص مدرسة أخرى.');
        }
        const full = this.resolveSafePath(path.join('backups', backupFileName));
        if (!fs.existsSync(full)) throw new SchoolRecordError(404, 'ملف النسخة الاحتياطية غير موجود.');
        source = JSON.parse(fs.readFileSync(full, 'utf-8'));
      } else if (uploadedBackup) {
        source = uploadedBackup;
      } else {
        throw new SchoolRecordError(400, 'يرجى تحديد نسخة احتياطية للاستعادة.');
      }

      if (!source || !source.school || !Array.isArray(source.stages) || !Array.isArray(source.sections)) {
        throw new SchoolRecordError(400, 'بنية النسخة الاحتياطية غير صالحة.');
      }

      // Preserve existing hashed credentials when matching IDs exist so active codes aren't lost
      const prevSectionCreds = new Map(tenant.sections.map((s) => [s.id, s.counselorCred]));
      const prevStudentCreds = new Map(tenant.students.map((st) => [st.id, st.studentCred]));

      tenant.school = {
        ...source.school,
        id: tenant.id,
      };
      tenant.announcements = source.announcements || [];
      tenant.stages = source.stages || [];
      tenant.sections = (source.sections || []).map((sec) => {
        const existingCred = prevSectionCreds.get(sec.id) || emptyCred();
        return {
          ...sec,
          counselorCodeStatus: existingCred.status,
          counselorCred: existingCred,
        };
      });
      tenant.students = (source.students || []).map((st) => {
        const existingCred = prevStudentCreds.get(st.id) || emptyCred();
        return {
          ...st,
          studentCodeStatus: existingCred.status,
          studentCred: existingCred,
        };
      });
      tenant.absences = source.absences || [];
      tenant.subjects = source.subjects || [];
      tenant.templates = source.templates || [];
      this.data.activePublicSchoolId = tenant.id;

      this.appendAudit(
        tenant,
        { name: session.displayName, role: session.role },
        'استعادة نسخة احتياطية',
        'backup',
        backupFileName || 'cloud_or_json',
        backupFileName || 'نسخة مستعادة',
        'الحالة السابقة',
        'تمت الاستعادة بنجاح'
      );
      this.persist();
    } catch (err) {
      this.data.schools[tenant.id] = JSON.parse(prevSnapshot) as InternalSchoolTenant;
      throw err;
    }
  }
}
