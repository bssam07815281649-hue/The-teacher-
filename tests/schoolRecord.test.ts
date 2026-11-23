import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { SchoolRecordStore } from '../server/schoolRecordStore';
import { createSchoolRecordRouter } from '../server/schoolRecordRoutes';
import {
  computeArabicNameSimilarity,
  findBestStudentMatch,
  normalizeArabicName,
  normalizeDigits,
  parseRawCellValue,
} from '../src/utils/arabicNameMatch';
import { computeStudentSubjectSummary } from '../src/utils/gradeCalculations';
import type { SubjectGradebook } from '../src/types';

async function startTestServer(
  dataDir: string,
  verifyFirebaseIdToken?: (
    idToken: string
  ) => Promise<{ uid: string; email: string; emailVerified: boolean } | null>
): Promise<{
  baseUrl: string;
  store: SchoolRecordStore;
  close: () => Promise<void>;
}> {
  const store = new SchoolRecordStore(dataDir);
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/school-record', createSchoolRecordRouter(store, { verifyFirebaseIdToken }));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}/api/school-record`;

  return {
    baseUrl,
    store,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function apiJson(
  baseUrl: string,
  route: string,
  options: { method?: string; token?: string; body?: unknown; ipHeader?: string } = {}
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  const resp = await fetch(`${baseUrl}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  return { status: resp.status, data };
}

test('Arabic normalization, digits conversion, cell parsing & 70% matching rules', () => {
  assert.equal(normalizeDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(normalizeArabicName('أحمد إبرآهيم عيسى فاطمة'), 'احمد ابراهيم عيسي فاطمه');
  assert.equal(computeArabicNameSimilarity('أحمد محمد علي', 'احمد محمد علي'), 100);

  const syntheticStudents = [
    {
      id: 'st_1',
      sectionId: 'sec_1',
      fullName: 'إبراهيم علي حسين',
      status: 'active' as const,
      studentCodeStatus: 'unset' as const,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'st_2',
      sectionId: 'sec_1',
      fullName: 'فاطمة الزهراء حسن',
      status: 'active' as const,
      studentCodeStatus: 'unset' as const,
      createdAt: '',
      updatedAt: '',
    },
  ];

  const m1 = findBestStudentMatch('ابراهيم علي حسين', syntheticStudents);
  assert.equal(m1.studentId, 'st_1');
  assert.ok(m1.confidence >= 95);
  assert.equal(m1.needsReview, false);

  const mLow = findBestStudentMatch('اسم مختلف تماماً', syntheticStudents);
  assert.equal(mLow.needsReview, true);

  assert.deepEqual(parseRawCellValue('0'), { status: 'score', score: 0 });
  assert.deepEqual(parseRawCellValue('٠'), { status: 'score', score: 0 });
  assert.deepEqual(parseRawCellValue('-'), { status: 'blank', score: null });
  assert.deepEqual(parseRawCellValue('غائب'), { status: 'absent', score: null });
  assert.deepEqual(parseRawCellValue('معفى'), { status: 'exempt', score: null });
  assert.deepEqual(parseRawCellValue('١٨.٥'), { status: 'score', score: 18.5 });
});

test('Annual pursuit strict 3-period rule, scale100 vs raw, and numeric zero vs blank/absent', () => {
  const subject: SubjectGradebook = {
    id: 'sub_test',
    sectionId: 'sec_test',
    name: 'الرياضيات',
    subRecords: [
      {
        id: 'rec_t1',
        periodId: 'term1',
        name: 'فصل أول',
        orderIndex: 0,
        columns: [
          { id: 'c_t1_a', label: 'الشهر 1', maxScore: 20, orderIndex: 0 },
          { id: 'c_t1_b', label: 'الشهر 2', maxScore: 20, orderIndex: 1 },
        ],
      },
      {
        id: 'rec_t2',
        periodId: 'term2',
        name: 'فصل ثاني',
        orderIndex: 0,
        columns: [{ id: 'c_t2_a', label: 'الشهر 1', maxScore: 20, orderIndex: 0 }],
      },
    ],
    midyearColumns: [{ id: 'c_mid', label: 'نصف السنة', maxScore: 100, orderIndex: 0 }],
    cells: {
      'stu1::c_t1_a': { status: 'score', score: 0 }, // Zero IS numeric!
      'stu1::c_t1_b': { status: 'absent', score: null }, // Ignored in numeric average
      'stu1::c_mid': { status: 'score', score: 60 },
      'stu1::c_t2_a': { status: 'blank', score: null }, // Term 2 missing numeric -> incomplete!
    },
    annualPursuitConfig: {
      term1ColumnIds: ['c_t1_a', 'c_t1_b'],
      midyearColumnIds: ['c_mid'],
      term2ColumnIds: ['c_t2_a'],
      scaleMode: 'scale100',
    },
    updatedAt: '',
  };

  const incomplete = computeStudentSubjectSummary(subject, 'stu1');
  assert.equal(incomplete.term1Avg, 0);
  assert.equal(incomplete.midyearAvg, 60);
  assert.equal(incomplete.term2Avg, null);
  assert.equal(incomplete.annualPursuit, null);
  assert.equal(incomplete.isComplete, false);
  assert.deepEqual(incomplete.missingPeriods, ['term2']);

  // Now complete Term 2 with 15 / 20 (= 75%)
  subject.cells['stu1::c_t2_a'] = { status: 'score', score: 15 };
  const scaled = computeStudentSubjectSummary(subject, 'stu1');
  assert.equal(scaled.isComplete, true);
  // (0 + 60 + 75) / 3 = 45
  assert.equal(scaled.annualPursuit, 45);

  // Switch to raw mode: (0 + 60 + 15) / 3 = 25
  subject.annualPursuitConfig.scaleMode = 'raw';
  const rawSummary = computeStudentSubjectSummary(subject, 'stu1');
  assert.equal(rawSummary.annualPursuit, 25);
});

test('Server security, RBAC scope isolation, session revocation, rate limiting, rollback, and sanitized backups', async () => {
  const prevAdminEnv = process.env.SCHOOL_ADMIN_CODE;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-record-test-'));
  delete process.env.SCHOOL_ADMIN_CODE;

  const { baseUrl, close } = await startTestServer(tempDir);

  try {
    // 1. Public check reports adminCodeConfigured = false when env unset (zero default code fallback!)
    const pub1 = await apiJson(baseUrl, '/public');
    assert.equal(pub1.status, 200);
    assert.equal(pub1.data.adminCodeConfigured, false);

    // Default code guesses must fail
    const badDefault = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { code: 'admin123' },
    });
    assert.equal(badDefault.status, 401);

    // 2. Configure synthetic admin secret via process.env and login
    process.env.SCHOOL_ADMIN_CODE = 'TEST_ADM_SECRET_991';
    const pub2 = await apiJson(baseUrl, '/public');
    assert.equal(pub2.data.adminCodeConfigured, true);

    const adminLogin = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { code: 'TEST_ADM_SECRET_991' },
    });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.data.session.role, 'admin');
    const adminToken = adminLogin.data.token as string;

    // 3. Admin creates Stage & Sections A, B and issues counselor codes
    const stgRes = await apiJson(baseUrl, '/stages', {
      method: 'POST',
      token: adminToken,
      body: { name: 'الصف الاختباري' },
    });
    assert.equal(stgRes.status, 200);
    const stageId = stgRes.data.stage.id;

    const secARes = await apiJson(baseUrl, '/sections', {
      method: 'POST',
      token: adminToken,
      body: { stageId, name: 'أ', counselorName: 'مرشد أ' },
    });
    const secBRes = await apiJson(baseUrl, '/sections', {
      method: 'POST',
      token: adminToken,
      body: { stageId, name: 'ب', counselorName: 'مرشد ب' },
    });
    const secAId = secARes.data.section.id;
    const secBId = secBRes.data.section.id;

    await apiJson(baseUrl, `/sections/${secAId}/counselor-code`, {
      method: 'POST',
      token: adminToken,
      body: { action: 'issue', code: 'TEST_CSL_A_11' },
    });
    await apiJson(baseUrl, `/sections/${secBId}/counselor-code`, {
      method: 'POST',
      token: adminToken,
      body: { action: 'issue', code: 'TEST_CSL_B_22' },
    });

    // 4. Counselor A logs in -> strict scope isolation check
    const cslALogin = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { code: 'TEST_CSL_A_11' },
    });
    assert.equal(cslALogin.status, 200);
    assert.equal(cslALogin.data.session.role, 'counselor');
    const cslAToken = cslALogin.data.token as string;

    // Counselor A CANNOT access Section B or Admin endpoints
    const crossSec = await apiJson(baseUrl, `/sections/${secBId}/students`, {
      method: 'POST',
      token: cslAToken,
      body: { fullName: 'طالب مخترق' },
    });
    assert.equal(crossSec.status, 403);

    const adminEditByCsl = await apiJson(baseUrl, '/school', {
      method: 'PUT',
      token: cslAToken,
      body: { name: 'تعديل غير مصرح' },
    });
    assert.equal(adminEditByCsl.status, 403);

    // Counselor A adds two synthetic students in Section A & issues Student 1 code
    const stu1Res = await apiJson(baseUrl, `/sections/${secAId}/students`, {
      method: 'POST',
      token: cslAToken,
      body: { fullName: 'طالب اختباري أول', status: 'active' },
    });
    assert.equal(stu1Res.status, 200);
    const stu1Id = stu1Res.data.student.id;

    const stu2Res = await apiJson(baseUrl, `/sections/${secAId}/students`, {
      method: 'POST',
      token: cslAToken,
      body: { fullName: 'طالب اختباري ثاني', status: 'active' },
    });
    assert.equal(stu2Res.status, 200);

    await apiJson(baseUrl, `/sections/${secAId}/students/${stu1Id}/code`, {
      method: 'POST',
      token: cslAToken,
      body: { action: 'issue', code: 'TEST_STU_1_77' },
    });

    // 5. Student 1 logs in -> scoped strictly to own student record
    const stuLogin = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { code: 'TEST_STU_1_77' },
    });
    assert.equal(stuLogin.status, 200);
    assert.equal(stuLogin.data.session.role, 'student');
    const stuToken = stuLogin.data.token as string;

    const stuWs = await apiJson(baseUrl, '/workspace', { token: stuToken });
    assert.equal(stuWs.status, 200);
    assert.equal(stuWs.data.students.length, 1);
    assert.equal(stuWs.data.students[0].id, stu1Id);

    const stuWriteForbidden = await apiJson(baseUrl, `/sections/${secAId}/students`, {
      method: 'POST',
      token: stuToken,
      body: { fullName: 'محاولة طالب' },
    });
    assert.equal(stuWriteForbidden.status, 403);

    // 6. Atomic commitSmartImport rollback when any entry exceeds maxScore
    const badImport = await apiJson(baseUrl, `/sections/${secAId}/import-commit`, {
      method: 'POST',
      token: cslAToken,
      body: {
        newSubjectName: 'فيزياء اختبارية',
        columnsSpec: [
          {
            tempKey: 'k1',
            periodId: 'term1',
            subRecordName: 'يومي',
            columnLabel: 'امتحان 1',
            maxScore: 20,
          },
        ],
        entries: [
          {
            studentId: stu1Id,
            tempKey: 'k1',
            value: { status: 'score', score: 18 },
            resolution: 'overwrite',
          },
          {
            studentId: stu2Res.data.student.id,
            tempKey: 'k1',
            value: { status: 'score', score: 25 }, // EXCEEDS maxScore 20 -> must rollback ALL!
            resolution: 'overwrite',
          },
        ],
      },
    });
    assert.equal(badImport.status, 400);

    const afterRollbackWs = await apiJson(baseUrl, '/workspace', { token: cslAToken });
    assert.equal(
      afterRollbackWs.data.subjects.some((s: any) => s.name === 'فيزياء اختبارية'),
      false,
      'Rollback must prevent creating partial subject on failure'
    );

    // Valid import succeeds atomically
    const goodImport = await apiJson(baseUrl, `/sections/${secAId}/import-commit`, {
      method: 'POST',
      token: cslAToken,
      body: {
        newSubjectName: 'فيزياء اختبارية',
        columnsSpec: [
          {
            tempKey: 'k1',
            periodId: 'term1',
            subRecordName: 'يومي',
            columnLabel: 'امتحان 1',
            maxScore: 20,
          },
        ],
        entries: [
          {
            studentId: stu1Id,
            tempKey: 'k1',
            value: { status: 'score', score: 18 },
            resolution: 'overwrite',
          },
        ],
      },
    });
    assert.equal(goodImport.status, 200);
    assert.equal(goodImport.data.appliedCount, 1);

    // Verify role-scoped code visibility BEFORE revoking counselor A
    const adminWsCheck = await apiJson(baseUrl, '/workspace', { token: adminToken });
    assert.equal(adminWsCheck.status, 200);
    const secAFromAdmin = adminWsCheck.data.sections.find((s: any) => s.id === secAId);
    assert.equal(secAFromAdmin?.counselorAccessCode, 'TEST_CSL_A_11');
    const stu1FromAdmin = adminWsCheck.data.students.find((s: any) => s.id === stu1Id);
    assert.equal(stu1FromAdmin?.studentAccessCode, 'TEST_STU_1_77');

    // Counselor A sees studentAccessCode for section A, never counselorAccessCode
    const cslWsCheck = await apiJson(baseUrl, '/workspace', { token: cslAToken });
    assert.equal(cslWsCheck.status, 200);
    assert.equal(cslWsCheck.data.sections[0]?.counselorAccessCode, undefined);
    const stu1FromCsl = cslWsCheck.data.students.find((s: any) => s.id === stu1Id);
    assert.equal(stu1FromCsl?.studentAccessCode, 'TEST_STU_1_77');

    // Student 1 NEVER sees any plaintext access codes in their workspace
    assert.equal(stuWs.data.sections[0]?.counselorAccessCode, undefined);
    assert.equal(stuWs.data.students[0]?.studentAccessCode, undefined);

    // Bulk-generate codes for remaining students missing active codes (stu2 gets STU-..., stu1 keeps TEST_STU_1_77)
    const bulkForbidden = await apiJson(baseUrl, `/sections/${secAId}/students/bulk-codes`, {
      method: 'POST',
      token: stuToken,
      body: { mode: 'missing_only' },
    });
    assert.equal(bulkForbidden.status, 403);

    const bulkRes = await apiJson(baseUrl, `/sections/${secAId}/students/bulk-codes`, {
      method: 'POST',
      token: cslAToken,
      body: { mode: 'missing_only' },
    });
    assert.equal(bulkRes.status, 200);
    assert.equal(bulkRes.data.issuedCount, 1);
    assert.equal(bulkRes.data.skippedCount, 1);
    const updatedStu1 = bulkRes.data.students.find((s: any) => s.id === stu1Id);
    const updatedStu2 = bulkRes.data.students.find((s: any) => s.id === stu2Res.data.student.id);
    assert.equal(updatedStu1?.studentAccessCode, 'TEST_STU_1_77');
    const stu2GeneratedCode = updatedStu2?.studentAccessCode as string;
    assert.match(stu2GeneratedCode, /^STU-[A-Z0-9]{6}$/);

    // Verify student 1 kept TEST_STU_1_77 and student 2 can login with generated code
    const stu2Login = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { code: stu2GeneratedCode },
    });
    assert.equal(stu2Login.status, 200);
    assert.equal(stu2Login.data.session.studentId, stu2Res.data.student.id);

    // 7. Immediate session revocation when counselor code is changed or revoked
    await apiJson(baseUrl, `/sections/${secAId}/counselor-code`, {
      method: 'POST',
      token: adminToken,
      body: { action: 'revoke' },
    });
    const revokedCslCheck = await apiJson(baseUrl, '/workspace', { token: cslAToken });
    assert.equal(revokedCslCheck.status, 401);

    // Revoking clears counselorAccessCode from admin workspace
    const adminAfterRevoke = await apiJson(baseUrl, '/workspace', { token: adminToken });
    const secAAfterRevoke = adminAfterRevoke.data.sections.find((s: any) => s.id === secAId);
    assert.equal(secAAfterRevoke?.counselorAccessCode, undefined);

    // 8. Sanitized backup export contains NO plaintext codes or scrypt hashes, and Audit logs are populated
    const backupRes = await apiJson(baseUrl, '/backups/export', { token: adminToken });
    assert.equal(backupRes.status, 200);
    const serialized = JSON.stringify(backupRes.data);
    assert.equal(serialized.includes('TEST_ADM_SECRET_991'), false);
    assert.equal(serialized.includes('TEST_CSL_A_11'), false);
    assert.equal(serialized.includes('TEST_CSL_B_22'), false);
    assert.equal(serialized.includes('TEST_STU_1_77'), false);
    assert.equal(serialized.includes(stu2GeneratedCode), false);
    assert.equal(serialized.includes('counselorAccessCode'), false);
    assert.equal(serialized.includes('studentAccessCode'), false);
    assert.equal(serialized.includes('displayCode'), false);
    assert.equal(serialized.includes('counselorCred'), false);
    assert.equal(serialized.includes('studentCred'), false);

    const auditRes = await apiJson(baseUrl, '/audit-logs', { token: adminToken });
    assert.equal(auditRes.status, 200);
    assert.ok(auditRes.data.auditLogs.length >= 5);

    // 9. Rate limiting triggers 429 after repeated failed guesses
    let saw429 = false;
    for (let i = 0; i < 7; i++) {
      const attempt = await apiJson(baseUrl, '/auth/login', {
        method: 'POST',
        body: { code: `WRONG_CODE_${i}` },
      });
      if (attempt.status === 429) {
        saw429 = true;
        assert.ok(attempt.data.retryAfterSeconds > 0);
        break;
      }
    }
    assert.equal(saw429, true);
  } finally {
    await close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (prevAdminEnv !== undefined) {
      process.env.SCHOOL_ADMIN_CODE = prevAdminEnv;
    } else {
      delete process.env.SCHOOL_ADMIN_CODE;
    }
  }
});

test('Multi-tenant Google Admin requires valid Principal Code, isolates schools per Gmail, and supports code-only counselors', async () => {
  const prevAdminEnv = process.env.SCHOOL_ADMIN_CODE;
  const prevEmailEnv = process.env.SCHOOL_ADMIN_EMAIL;
  delete process.env.SCHOOL_ADMIN_CODE;
  delete process.env.SCHOOL_ADMIN_EMAIL;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-google-admin-test-'));

  const mockVerifier = async (token: string) => {
    if (token === 'token_principal_a') {
      return {
        uid: 'uid_bssam',
        email: 'Bssam07815281649@gmail.com',
        emailVerified: true,
        displayName: 'بسام المدير',
      };
    }
    if (token === 'token_principal_unverified') {
      return { uid: 'uid_bssam', email: 'bssam07815281649@gmail.com', emailVerified: false };
    }
    if (token === 'token_principal_b') {
      return {
        uid: 'uid_other',
        email: 'otherprincipal@gmail.com',
        emailVerified: true,
        displayName: 'مدير ثانٍ',
      };
    }
    return null;
  };

  const { baseUrl, close } = await startTestServer(tempDir, mockVerifier);

  try {
    // 1. Reject invalid Google ID token
    const badTok = await apiJson(baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'invalid_token', initialCode: 'BOSS_CODE_2026' },
    });
    assert.equal(badTok.status, 401);

    // 2. Reject unverified Gmail
    const unverified = await apiJson(baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'token_principal_unverified', initialCode: 'BOSS_CODE_2026' },
    });
    assert.equal(unverified.status, 401);

    // 3. Reject initial setup with missing/too-short initial code
    const shortInit = await apiJson(baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'token_principal_a', initialCode: '123' },
    });
    assert.equal(shortInit.status, 400);

    // 4. Verified Gmail A sets initial Principal Code atomically and enters isolated school_uid_bssam
    const okResA = await apiJson(baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'token_principal_a', initialCode: 'BOSS_CODE_2026' },
    });
    assert.equal(okResA.status, 200);
    assert.equal(okResA.data.session.role, 'admin');
    assert.equal(okResA.data.session.schoolId, 'school_uid_bssam');
    assert.equal(okResA.data.session.ownerEmail, 'bssam07815281649@gmail.com');
    assert.equal(okResA.data.isNewSchool, true);
    const tokenA = okResA.data.token as string;

    // 5. Public now reports adminCodeConfigured = true
    const pub = await apiJson(baseUrl, '/public');
    assert.equal(pub.data.adminCodeConfigured, true);

    // 6. Any other verified Gmail B is rejected WITHOUT the valid Principal Code
    const missingCodeB = await apiJson(baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'token_principal_b' },
    });
    assert.equal(missingCodeB.status, 401);

    const wrongCodeB = await apiJson(baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'token_principal_b', code: 'WRONG_ADMIN_CODE' },
    });
    assert.equal(wrongCodeB.status, 401);

    // 7. Verified Gmail B succeeds WITH valid Principal Code and gets its own isolated school
    const okResB = await apiJson(baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'token_principal_b', code: 'BOSS_CODE_2026' },
    });
    assert.equal(okResB.status, 200);
    assert.equal(okResB.data.session.schoolId, 'school_uid_other');
    assert.equal(okResB.data.session.ownerEmail, 'otherprincipal@gmail.com');
    const tokenB = okResB.data.token as string;

    // 8. Data created under Gmail A is strictly isolated from Gmail B
    await apiJson(baseUrl, '/school', {
      method: 'PUT',
      token: tokenA,
      body: { name: 'مدرسة بسام الخاصة' },
    });
    const stgA = await apiJson(baseUrl, '/stages', {
      method: 'POST',
      token: tokenA,
      body: { name: 'صف مدرسة بسام' },
    });
    const secA = await apiJson(baseUrl, '/sections', {
      method: 'POST',
      token: tokenA,
      body: { stageId: stgA.data.stage.id, name: 'أ', counselorName: 'مرشد بسام' },
    });
    await apiJson(baseUrl, `/sections/${secA.data.section.id}/counselor-code`, {
      method: 'POST',
      token: tokenA,
      body: { action: 'issue', code: 'GMAIL_A_CSL_11' },
    });

    const wsA = await apiJson(baseUrl, '/workspace', { token: tokenA });
    assert.equal(wsA.data.school.name, 'مدرسة بسام الخاصة');
    assert.equal(wsA.data.stages.length, 1);

    const wsB = await apiJson(baseUrl, '/workspace', { token: tokenB });
    assert.notEqual(wsB.data.school.name, 'مدرسة بسام الخاصة');
    assert.equal(wsB.data.stages.length, 0);

    // 9. Counselor issued inside Gmail A's school logs in by code ONLY (no Google) into school_uid_bssam
    const cslLogin = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { code: 'GMAIL_A_CSL_11' },
    });
    assert.equal(cslLogin.status, 200);
    assert.equal(cslLogin.data.session.role, 'counselor');
    assert.equal(cslLogin.data.session.schoolId, 'school_uid_bssam');

    // 10. Rotating admin code invalidates previous admin sessions immediately
    const setCodeRes = await apiJson(baseUrl, '/admin/code', {
      method: 'PUT',
      token: tokenA,
      body: { newCode: 'NEW_BOSS_2027' },
    });
    assert.equal(setCodeRes.status, 200);

    const oldCheck = await apiJson(baseUrl, '/workspace', { token: tokenA });
    assert.equal(oldCheck.status, 401);

    const codeLogin = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { code: 'NEW_BOSS_2027' },
    });
    assert.equal(codeLogin.status, 200);
    assert.equal(codeLogin.data.session.role, 'admin');

    // Arabic-Indic digits + invisible directional mark also verify cleanly
    const arabicDigitLogin = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { code: '\u200fNEW_BOSS_٢٠٢٧ ' },
    });
    assert.equal(arabicDigitLogin.status, 200);
    assert.equal(arabicDigitLogin.data.session.role, 'admin');
  } finally {
    await close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (prevAdminEnv !== undefined) process.env.SCHOOL_ADMIN_CODE = prevAdminEnv;
    if (prevEmailEnv !== undefined) process.env.SCHOOL_ADMIN_EMAIL = prevEmailEnv;
  }
});
