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
  options: {
    method?: string;
    token?: string;
    cookie?: string;
    origin?: string;
    body?: unknown;
  } = {}
): Promise<{ status: number; data: any; cookies: string[] }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.cookie) headers['Cookie'] = options.cookie;
  if (options.origin) headers['Origin'] = options.origin;
  const resp = await fetch(`${baseUrl}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  const rawSetCookies = typeof resp.headers.getSetCookie === 'function'
    ? resp.headers.getSetCookie()
    : resp.headers.get('set-cookie')
    ? [resp.headers.get('set-cookie')!]
    : [];
  return { status: resp.status, data, cookies: rawSetCookies };
}

function extractSessionCookie(cookies: string[]): string {
  for (const c of cookies) {
    const first = c.split(';')[0] || '';
    if (first.startsWith('school_record_session=') && first.length > 'school_record_session='.length) {
      return first;
    }
  }
  return '';
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
  const prevEmailEnv = process.env.SCHOOL_ADMIN_EMAIL;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-record-test-'));
  delete process.env.SCHOOL_ADMIN_CODE;
  process.env.SCHOOL_ADMIN_EMAIL = 'bssam07815281649@gmail.com';

  const mockAdminVerifier = async (token: string) => {
    if (token === 'token_admin_ok') {
      return {
        uid: 'uid_bssam',
        email: 'bssam07815281649@gmail.com',
        emailVerified: true,
        displayName: 'مدير المدرسة',
      };
    }
    return null;
  };

  const { baseUrl, close } = await startTestServer(tempDir, mockAdminVerifier);

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

    // 2. Configure synthetic admin secret via process.env: code-only login opens Google gate WITHOUT issuing an admin token
    process.env.SCHOOL_ADMIN_CODE = 'TEST_ADM_SECRET_991';
    const pub2 = await apiJson(baseUrl, '/public');
    assert.equal(pub2.data.adminCodeConfigured, true);

    const codeOnlyAdmin = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { code: 'TEST_ADM_SECRET_991' },
    });
    assert.equal(codeOnlyAdmin.status, 200);
    assert.equal(codeOnlyAdmin.data.session.role, 'admin');
    assert.equal(codeOnlyAdmin.data.requiresGoogleAuth, true);
    assert.equal(codeOnlyAdmin.data.token, '');
    assert.equal(extractSessionCookie(codeOnlyAdmin.cookies), '');

    // Complete verified Google Admin authentication to receive admin token
    const adminLogin = await apiJson(baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'token_admin_ok', code: 'TEST_ADM_SECRET_991' },
    });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.data.session.role, 'admin');
    const adminToken = adminLogin.data.token as string;
    assert.ok(adminToken.length > 20);

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
            subRecordName: 'درجات الشهري',
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
            subRecordName: 'درجات الشهري',
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

    const releasedId = goodImport.data.subject.id;
    const path = `/sections/${secAId}/subjects/${releasedId}/release`;
    const release = (token: string, approve: boolean) => apiJson(baseUrl, path, {
      method: 'POST', token, body: {period:'term1', approve, columnIds:goodImport.data.subject.subRecords.find((r:any)=>r.periodId==='term1' && r.name==='درجات الشهري').columns.map((c:any)=>c.id)},
    });
    const readStudentSubject = async () => {
      const result = await apiJson(baseUrl, '/workspace', {token:stuToken});
      assert.equal(result.data.firebaseSync, undefined);
      return result.data.subjects.find((s: any) => s.id === releasedId);
    };
    assert.deepEqual((await readStudentSubject())?.releases ?? {}, {});
    assert.equal((await release(stuToken,true)).status,403);
    assert.equal((await release(cslAToken,true)).status,400);
    assert.equal((await release(cslAToken,false)).status,200);
    const published = (await readStudentSubject()).releases.term1;
    assert.deepEqual(published.official,{});
    assert.equal(Object.values(published.cells).length,1);
    assert.equal((await release(cslAToken,true)).status,200);
    assert.equal((await readStudentSubject()).releases.term1.official[stu1Id],90);

    const notesPath = `/sections/${secAId}/observations`;
    assert.equal((await apiJson(baseUrl, notesPath, {method:'POST',token:stuToken,body:{category:'test'}})).status,403);
    assert.equal((await apiJson(baseUrl, notesPath, {method:'POST',token:cslAToken,body:{studentId:stu1Id,category:'متابعة',note:'ملاحظة اختبار'}})).status,200);
    assert.equal((await apiJson(baseUrl, notesPath, {method:'POST',token:cslAToken,body:{category:'النظافة جيدة'}})).status,200);
    const staffNotes = (await apiJson(baseUrl,'/workspace',{token:cslAToken})).data.sections[0].observations;
    assert.equal(staffNotes.length,2);
    const privateView = (await apiJson(baseUrl,'/workspace',{token:stuToken})).data.sections[0];
    assert.equal(privateView.observations,undefined);
    const send = (action:string, body:Record<string,unknown>, token=cslAToken) =>
      apiJson(baseUrl, '/sections/'+secAId+'/staff-actions/'+action,{method:'POST',token,body});
    assert.equal((await send('group',{name:'متابعة',studentIds:[]})).status,200);
    assert.equal((await send('group',{name:'متابعة',studentIds:[stu1Id]})).status,200);
    assert.equal((await send('message',{body:'خاص',studentId:stu2Res.data.student.id})).status,200);
    assert.equal((await send('message',{body:'للجميع'})).status,200);
    assert.equal((await send('message',{body:'غير مسموح'},stuToken)).status,403);
    const inbox=(await apiJson(baseUrl,'/workspace',{token:stuToken})).data.sections[0];
    assert.deepEqual(inbox.messages.map((m:any)=>m.body),['للجميع']);
    assert.equal(inbox.caseGroups,undefined);
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
    if (prevEmailEnv !== undefined) {
      process.env.SCHOOL_ADMIN_EMAIL = prevEmailEnv;
    } else {
      delete process.env.SCHOOL_ADMIN_EMAIL;
    }
  }
});

test('Stable canonical schoolId ownership, Google-verified Admin gate, admin logout independence, and cross-device sync', async () => {
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

    // 4. Verified Gmail A sets initial Principal Code and claims the single stable canonical schoolId ('default_school')
    const okResA = await apiJson(baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'token_principal_a', initialCode: 'BOSS_CODE_2026' },
    });
    assert.equal(okResA.status, 200);
    assert.equal(okResA.data.session.role, 'admin');
    assert.equal(okResA.data.session.schoolId, 'default_school');
    assert.equal(okResA.data.session.ownerEmail, 'bssam07815281649@gmail.com');
    assert.equal(okResA.data.isNewSchool, true);
    const tokenA = okResA.data.token as string;

    // 5. Public now reports adminCodeConfigured = true
    const pub = await apiJson(baseUrl, '/public');
    assert.equal(pub.data.adminCodeConfigured, true);

    // 6. Unauthorized Gmail B is ALWAYS rejected with 403 even if they possess the Principal Code
    const unauthorizedB = await apiJson(baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'token_principal_b', code: 'BOSS_CODE_2026' },
    });
    assert.equal(unauthorizedB.status, 403);

    // 7. Same authorized Gmail signing in on Device 2 gets the EXACT same stable schoolId (no duplicate DB)
    const device2Res = await apiJson(baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'token_principal_a', code: 'BOSS_CODE_2026' },
    });
    assert.equal(device2Res.status, 200);
    assert.equal(device2Res.data.session.schoolId, 'default_school');
    assert.equal(device2Res.data.isNewSchool, false);

    // 8. Admin creates school profile, stage, section, student, subject, and codes on stable schoolId
    await apiJson(baseUrl, '/school', {
      method: 'PUT',
      token: tokenA,
      body: { name: 'مدرسة بسام الموحدة' },
    });
    const stgA = await apiJson(baseUrl, '/stages', {
      method: 'POST',
      token: tokenA,
      body: { name: 'الصف السادس الإعدادي' },
    });
    const secA = await apiJson(baseUrl, '/sections', {
      method: 'POST',
      token: tokenA,
      body: { stageId: stgA.data.stage.id, name: 'أ', counselorName: 'مرشد بسام' },
    });
    const sectionId = secA.data.section.id as string;
    await apiJson(baseUrl, `/sections/${sectionId}/counselor-code`, {
      method: 'POST',
      token: tokenA,
      body: { action: 'issue', code: 'GMAIL_A_CSL_11' },
    });
    const stuRes = await apiJson(baseUrl, `/sections/${sectionId}/students`, {
      method: 'POST',
      token: tokenA,
      body: { fullName: 'علي حسين كريم', status: 'active' },
    });
    const studentId = stuRes.data.student.id as string;
    await apiJson(baseUrl, `/sections/${sectionId}/students/${studentId}/code`, {
      method: 'POST',
      token: tokenA,
      body: { action: 'issue', code: 'STU_ALI_7788' },
    });
    const subjRes = await apiJson(baseUrl, `/sections/${sectionId}/subjects`, {
      method: 'POST',
      token: tokenA,
      body: { name: 'الأحياء' },
    });
    const subjectObj = subjRes.data.subject;
    const term1ColId = subjectObj.subRecords[0].columns[0].id as string;

    // 9. Admin explicitly logs out -> database, counselor codes, and student codes MUST keep working normally!
    const adminLogout = await apiJson(baseUrl, '/auth/logout', {
      method: 'POST',
      token: tokenA,
    });
    assert.equal(adminLogout.status, 200);

    // Public portal remains available with updated school profile
    const pubAfterLogout = await apiJson(baseUrl, '/public');
    assert.equal(pubAfterLogout.status, 200);
    assert.equal(pubAfterLogout.data.school.name, 'مدرسة بسام الموحدة');

    // 10. Device 2 (Counselor) logs in using code ONLY while Admin is completely signed out
    const cslLogin = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { code: 'GMAIL_A_CSL_11' },
    });
    assert.equal(cslLogin.status, 200);
    assert.equal(cslLogin.data.session.role, 'counselor');
    assert.equal(cslLogin.data.session.schoolId, 'default_school');
    const cslCookie = extractSessionCookie(cslLogin.cookies);
    assert.ok(cslCookie.startsWith('school_record_session='), 'Counselor must receive remembered HttpOnly cookie');

    // Counselor resumes session via HttpOnly cookie alone (simulated page reload on Device 2)
    const cslResume = await apiJson(baseUrl, '/auth/me', {
      cookie: cslCookie,
    });
    assert.equal(cslResume.status, 200);
    assert.equal(cslResume.data.session.role, 'counselor');
    assert.equal(cslResume.data.session.sectionId, sectionId);

    // Cross-site CSRF origin check rejects cookie-authenticated mutation from foreign Origin
    const csrfBlocked = await apiJson(baseUrl, `/sections/${sectionId}/subjects/${subjectObj.id}/cells`, {
      method: 'POST',
      cookie: cslCookie,
      origin: 'https://evil-attacker.example',
      body: {
        updates: [{ studentId, columnId: term1ColId, value: { status: 'score', score: 95 } }],
      },
    });
    assert.equal(csrfBlocked.status, 403);

    // Same-origin counselor grade edit saves centrally using cookie session while admin is signed out
    const sameHostOrigin = new URL(baseUrl).origin;
    const cslGradeSave = await apiJson(baseUrl, `/sections/${sectionId}/subjects/${subjectObj.id}/cells`, {
      method: 'POST',
      cookie: cslCookie,
      origin: sameHostOrigin,
      body: {
        updates: [{ studentId, columnId: term1ColId, value: { status: 'score', score: 92 } }],
      },
    });
    assert.equal(cslGradeSave.status, 200);

    // 11. Device 3 (Student) logs in by code ONLY while Admin is signed out and sees counselor's synced grade read-only
    const stuLogin = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { code: 'STU_ALI_7788' },
    });
    assert.equal(stuLogin.status, 200);
    assert.equal(stuLogin.data.session.role, 'student');
    assert.equal(stuLogin.data.session.schoolId, 'default_school');
    const stuCookie = extractSessionCookie(stuLogin.cookies);
    assert.ok(stuCookie.startsWith('school_record_session='));

    const stuReport = await apiJson(baseUrl, '/my-record', { cookie: stuCookie });
    assert.equal(stuReport.status, 200);
    assert.equal(stuReport.data.subjects[0].cells[`${studentId}::${term1ColId}`]?.score, 92);

    // 12. Admin logs back in (code + verified Google) and sees counselor's edit on the exact same canonical school
    const adminRelogin = await apiJson(baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'token_principal_a', code: 'BOSS_CODE_2026' },
    });
    assert.equal(adminRelogin.status, 200);
    const adminWs = await apiJson(baseUrl, '/workspace', { token: adminRelogin.data.token });
    assert.equal(adminWs.status, 200);
    assert.equal(adminWs.data.school.id, 'default_school');
    assert.equal(adminWs.data.subjects[0].cells[`${studentId}::${term1ColId}`]?.score, 92);

    // 13. Rotating admin code invalidates previous admin sessions, and /auth/login returns requiresGoogleAuth (NO token!)
    const setCodeRes = await apiJson(baseUrl, '/admin/code', {
      method: 'PUT',
      token: adminRelogin.data.token,
      body: { newCode: 'NEW_BOSS_2027' },
    });
    assert.equal(setCodeRes.status, 200);

    const oldCheck = await apiJson(baseUrl, '/workspace', { token: adminRelogin.data.token });
    assert.equal(oldCheck.status, 401);

    // Code-only admin login NEVER issues a token; must route through Google Admin verification
    const codeLogin = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { code: 'NEW_BOSS_2027' },
    });
    assert.equal(codeLogin.status, 200);
    assert.equal(codeLogin.data.session.role, 'admin');
    assert.equal(codeLogin.data.requiresGoogleAuth, true);
    assert.equal(codeLogin.data.token, '');

    // Arabic-Indic digits + invisible directional mark also verify at Admin gate
    const arabicDigitLogin = await apiJson(baseUrl, '/auth/login', {
      method: 'POST',
      body: { code: '\u200fNEW_BOSS_٢٠٢٧ ' },
    });
    assert.equal(arabicDigitLogin.status, 200);
    assert.equal(arabicDigitLogin.data.session.role, 'admin');
    assert.equal(arabicDigitLogin.data.requiresGoogleAuth, true);
    assert.equal(arabicDigitLogin.data.token, '');

    // Counselor & Student existing sessions remain valid even after admin code rotation & logout!
    const cslStillActive = await apiJson(baseUrl, '/auth/me', { cookie: cslCookie });
    assert.equal(cslStillActive.status, 200);
    const stuStillActive = await apiJson(baseUrl, '/my-record', { cookie: stuCookie });
    assert.equal(stuStillActive.status, 200);
  } finally {
    await close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (prevAdminEnv !== undefined) process.env.SCHOOL_ADMIN_CODE = prevAdminEnv;
    else delete process.env.SCHOOL_ADMIN_CODE;
    if (prevEmailEnv !== undefined) process.env.SCHOOL_ADMIN_EMAIL = prevEmailEnv;
    else delete process.env.SCHOOL_ADMIN_EMAIL;
  }
});

test('Migration preserves existing legacy per-UID school data and counselor/student code mappings under one canonical schoolId', async () => {
  const prevAdminEnv = process.env.SCHOOL_ADMIN_CODE;
  const prevEmailEnv = process.env.SCHOOL_ADMIN_EMAIL;
  delete process.env.SCHOOL_ADMIN_CODE;
  process.env.SCHOOL_ADMIN_EMAIL = 'bssam07815281649@gmail.com';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-legacy-migrate-test-'));

  try {
    // Seed a legacy store.json where default_school is empty and populated school lives under school_uid_legacy
    const legacyAdminHash = await import('../server/schoolRecordStore').then((m) => m.hashAccessCode('LEGACY_ADM_99'));
    const legacyCslHash = await import('../server/schoolRecordStore').then((m) => m.hashAccessCode('LEGACY_CSL_11'));
    const legacyStore = {
      schemaVersion: 2,
      activePublicSchoolId: 'school_uid_legacy',
      adminAuth: {
        mode: 'custom',
        customCred: {
          hash: legacyAdminHash.hash,
          salt: legacyAdminHash.salt,
          status: 'active',
          sessionVersion: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        sessionVersion: 1,
        displayName: 'المدير',
      },
      schools: {
        default_school: {
          id: 'default_school',
          ownerUid: '',
          ownerEmail: '',
          school: {
            id: 'default_school',
            name: 'فارغة',
            academicYear: '2025 - 2026',
            directorate: '-',
            overview: '',
            vision: '',
            mission: '',
            goals: [],
            updatedAt: '',
          },
          announcements: [],
          stages: [],
          sections: [],
          students: [],
          absences: [],
          subjects: [],
          templates: [],
          auditLogs: [],
        },
        school_uid_legacy: {
          id: 'school_uid_legacy',
          ownerUid: 'uid_legacy_admin',
          ownerEmail: 'bssam07815281649@gmail.com',
          school: {
            id: 'school_uid_legacy',
            name: 'ثانوية بغداد التراثية',
            academicYear: '2025 - 2026',
            directorate: 'تربية الرصافة',
            overview: '',
            vision: '',
            mission: '',
            goals: [],
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          announcements: [],
          stages: [{ id: 'stg_1', name: 'الخامس العلمي', orderIndex: 0 }],
          sections: [
            {
              id: 'sec_legacy_1',
              stageId: 'stg_1',
              name: 'أ',
              counselorName: 'أ. محمد',
              counselorCodeStatus: 'active',
              orderIndex: 0,
              counselorCred: {
                hash: legacyCslHash.hash,
                salt: legacyCslHash.salt,
                status: 'active',
                sessionVersion: 1,
                updatedAt: '2026-01-01T00:00:00.000Z',
                displayCode: 'LEGACY_CSL_11',
              },
            },
          ],
          students: [],
          absences: [],
          subjects: [],
          templates: [],
          auditLogs: [],
        },
      },
    };
    fs.writeFileSync(path.join(tempDir, 'store.json'), JSON.stringify(legacyStore, null, 2), 'utf-8');

    const { baseUrl, close } = await startTestServer(tempDir, async (token) => {
      if (token === 'token_new_device') {
        return {
          uid: 'uid_legacy_admin',
          email: 'bssam07815281649@gmail.com',
          emailVerified: true,
          displayName: 'بسام',
        };
      }
      return null;
    });

    try {
      // Public automatically picks populated existing school_uid_legacy as canonicalSchoolId
      const pub = await apiJson(baseUrl, '/public');
      assert.equal(pub.status, 200);
      assert.equal(pub.data.school.id, 'school_uid_legacy');
      assert.equal(pub.data.school.name, 'ثانوية بغداد التراثية');

      // Legacy counselor code works immediately even before any admin Google login
      const cslLogin = await apiJson(baseUrl, '/auth/login', {
        method: 'POST',
        body: { code: 'LEGACY_CSL_11' },
      });
      assert.equal(cslLogin.status, 200);
      assert.equal(cslLogin.data.session.schoolId, 'school_uid_legacy');
      assert.equal(cslLogin.data.session.sectionId, 'sec_legacy_1');

      // Admin login on new session keeps the EXACT canonical school_uid_legacy without overwriting stages/sections
      const admRes = await apiJson(baseUrl, '/auth/google-admin', {
        method: 'POST',
        body: { idToken: 'token_new_device', code: 'LEGACY_ADM_99' },
      });
      assert.equal(admRes.status, 200);
      assert.equal(admRes.data.session.schoolId, 'school_uid_legacy');
      assert.equal(admRes.data.isNewSchool, false);

      const admWs = await apiJson(baseUrl, '/workspace', { token: admRes.data.token });
      assert.equal(admWs.status, 200);
      assert.equal(admWs.data.stages.length, 1);
      assert.equal(admWs.data.sections.length, 1);
    } finally {
      await close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (prevAdminEnv !== undefined) process.env.SCHOOL_ADMIN_CODE = prevAdminEnv;
    else delete process.env.SCHOOL_ADMIN_CODE;
    if (prevEmailEnv !== undefined) process.env.SCHOOL_ADMIN_EMAIL = prevEmailEnv;
    else delete process.env.SCHOOL_ADMIN_EMAIL;
  }
});

test('Malformed non-email SCHOOL_ADMIN_EMAIL env value does not block verified Google admin with valid SCHOOL_ADMIN_CODE', async () => {
  const prevAdminEnv = process.env.SCHOOL_ADMIN_CODE;
  const prevEmailEnv = process.env.SCHOOL_ADMIN_EMAIL;
  process.env.SCHOOL_ADMIN_CODE = 'ADMIN_CODE_9';
  process.env.SCHOOL_ADMIN_EMAIL = 'not_email9';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-malformed-email-test-'));

  const mockVerifier = async (token: string) => {
    if (token === 'token_bssam') {
      return {
        uid: 'uid_bssam',
        email: 'bssam07815281649@gmail.com',
        emailVerified: true,
        displayName: 'بسام',
      };
    }
    if (token === 'token_intruder') {
      return {
        uid: 'uid_intruder',
        email: 'other@gmail.com',
        emailVerified: true,
        displayName: 'مستخدم آخر',
      };
    }
    return null;
  };

  const { baseUrl, close } = await startTestServer(tempDir, mockVerifier);

  try {
    const okLogin = await apiJson(baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'token_bssam', code: 'ADMIN_CODE_9' },
    });
    assert.equal(okLogin.status, 200);
    assert.equal(okLogin.data.session.role, 'admin');
    assert.equal(okLogin.data.session.ownerEmail, 'bssam07815281649@gmail.com');

    // Once claimed, another Google account is still rejected with 403
    const otherLogin = await apiJson(baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'token_intruder', code: 'ADMIN_CODE_9' },
    });
    assert.equal(otherLogin.status, 403);
  } finally {
    await close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (prevAdminEnv !== undefined) process.env.SCHOOL_ADMIN_CODE = prevAdminEnv;
    else delete process.env.SCHOOL_ADMIN_CODE;
    if (prevEmailEnv !== undefined) process.env.SCHOOL_ADMIN_EMAIL = prevEmailEnv;
    else delete process.env.SCHOOL_ADMIN_EMAIL;
  }
});

test('Active Admin and Counselor sessions survive server restarts via persisted .session-secret when SCHOOL_SESSION_SECRET is unset', async () => {
  const prevAdminEnv = process.env.SCHOOL_ADMIN_CODE;
  const prevEmailEnv = process.env.SCHOOL_ADMIN_EMAIL;
  const prevSessionSecret = process.env.SCHOOL_SESSION_SECRET;
  delete process.env.SCHOOL_ADMIN_CODE;
  delete process.env.SCHOOL_ADMIN_EMAIL;
  delete process.env.SCHOOL_SESSION_SECRET;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-restart-session-test-'));
  const mockVerifier = async (token: string) => {
    if (token === 'token_admin_restart') {
      return {
        uid: 'uid_restart_admin',
        email: 'bssam07815281649@gmail.com',
        emailVerified: true,
        displayName: 'مدير المدرسة',
      };
    }
    return null;
  };

  let closeServer1: (() => Promise<void>) | null = null;
  let closeServer2: (() => Promise<void>) | null = null;

  try {
    // Server instance 1: Admin sets initial code, creates section + counselor code, Counselor logs in
    const server1 = await startTestServer(tempDir, mockVerifier);
    closeServer1 = server1.close;

    const admLogin = await apiJson(server1.baseUrl, '/auth/google-admin', {
      method: 'POST',
      body: { idToken: 'token_admin_restart', initialCode: 'RESTART_ADM_2026' },
    });
    assert.equal(admLogin.status, 200);
    const adminToken = admLogin.data.token as string;

    const stg = await apiJson(server1.baseUrl, '/stages', {
      method: 'POST',
      token: adminToken,
      body: { name: 'الخامس العلمي' },
    });
    const sec = await apiJson(server1.baseUrl, '/sections', {
      method: 'POST',
      token: adminToken,
      body: { stageId: stg.data.stage.id, name: 'أ', counselorName: 'أحمد' },
    });
    await apiJson(server1.baseUrl, `/sections/${sec.data.section.id}/counselor-code`, {
      method: 'POST',
      token: adminToken,
      body: { action: 'issue', code: 'CSL_RESTART_11' },
    });

    const cslLogin = await apiJson(server1.baseUrl, '/auth/login', {
      method: 'POST',
      body: { code: 'CSL_RESTART_11' },
    });
    assert.equal(cslLogin.status, 200);
    const cslCookie = extractSessionCookie(cslLogin.cookies);
    assert.ok(cslCookie.startsWith('school_record_session='));

    // Close server instance 1 cleanly (simulating dev server / process restart)
    await server1.close();
    closeServer1 = null;

    // Verify .session-secret exists in tempDir
    const secretFile = path.join(tempDir, '.session-secret');
    assert.equal(fs.existsSync(secretFile), true);
    const rawSecret = fs.readFileSync(secretFile, 'utf-8').trim();

    // Server instance 2: fresh SchoolRecordStore on the same tempDir
    const server2 = await startTestServer(tempDir, mockVerifier);
    closeServer2 = server2.close;

    // Existing Admin Bearer token and Counselor cookie must still succeed (200, NOT 401)
    const admWsAfterRestart = await apiJson(server2.baseUrl, '/workspace', { token: adminToken });
    assert.equal(admWsAfterRestart.status, 200);
    assert.equal(admWsAfterRestart.data.stages.length, 1);

    const cslMeAfterRestart = await apiJson(server2.baseUrl, '/auth/me', { cookie: cslCookie });
    assert.equal(cslMeAfterRestart.status, 200);
    assert.equal(cslMeAfterRestart.data.session.role, 'counselor');

    const cslWsAfterRestart = await apiJson(server2.baseUrl, '/workspace', { cookie: cslCookie });
    assert.equal(cslWsAfterRestart.status, 200);

    // Exported sanitized backup must NEVER contain the persisted session signing secret
    const backup = await apiJson(server2.baseUrl, '/backups/export', { token: adminToken });
    assert.equal(backup.status, 200);
    assert.equal(JSON.stringify(backup.data).includes(rawSecret), false);
  } finally {
    if (closeServer1) await closeServer1();
    if (closeServer2) await closeServer2();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (prevAdminEnv !== undefined) process.env.SCHOOL_ADMIN_CODE = prevAdminEnv;
    else delete process.env.SCHOOL_ADMIN_CODE;
    if (prevEmailEnv !== undefined) process.env.SCHOOL_ADMIN_EMAIL = prevEmailEnv;
    else delete process.env.SCHOOL_ADMIN_EMAIL;
    if (prevSessionSecret !== undefined) process.env.SCHOOL_SESSION_SECRET = prevSessionSecret;
    else delete process.env.SCHOOL_SESSION_SECRET;
  }
});


