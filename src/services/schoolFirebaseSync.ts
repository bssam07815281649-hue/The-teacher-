import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { auth, db, signInWithGoogle } from './firebase';
import type {
  AuditLogEntry,
  ImportTemplate,
  SchoolAnnouncement,
  SchoolFirebaseSyncMeta,
  SchoolSection,
  SchoolStageGrade,
  SchoolStudent,
  SchoolWorkspacePayload,
  StudentAbsence,
  SubjectGradebook,
} from '../types';
import {
  computeCodeLookupId,
  generateHex64,
  hashAdminCodePbkdf2,
  isValidHex64,
} from '../utils/schoolCodeHash';
import {
  buildCapSectionDocPayload,
  buildCapStudentDocPayload,
  buildPublicInfoDocPayload,
  CANONICAL_SCHOOL_ID,
  clampStr,
  stripCapStudentSecretsForUi,
  stripUndefinedDeep,
  timestampToIso,
  type CloudCapSectionStudent,
} from './schoolCloudShared';

export function makeSchoolIdForUid(uid?: string): string {
  const safe = (uid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 110);
  return safe ? `school_${safe}` : CANONICAL_SCHOOL_ID;
}

export async function testFirestoreConnectivity(schoolId?: string): Promise<{
  reachable: boolean;
  projectId: string;
  message: string;
}> {
  const targetSchoolId = schoolId || CANONICAL_SCHOOL_ID;
  try {
    await getDocFromServer(doc(db, 'schools', targetSchoolId, 'public', 'info'));
    return {
      reachable: true,
      projectId: firebaseConfig.projectId,
      message: 'متصل فعلياً بقاعدة بيانات Firestore',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isPermission =
      msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('missing or insufficient');
    if (isPermission) {
      return {
        reachable: true,
        projectId: firebaseConfig.projectId,
        message: 'متصل بخادم Firebase (جاهز للمزامنة بعد تسجيل دخول المدير)',
      };
    }
    return {
      reachable: false,
      projectId: firebaseConfig.projectId,
      message: 'تعذر الوصول إلى Firestore حالياً (وضع العمل المحلي نشط)',
    };
  }
}

export async function linkGoogleForPrincipal(): Promise<{
  uid: string;
  email: string;
  projectId: string;
}> {
  const cred = await signInWithGoogle();
  const user = cred.user;
  if (!user || !user.emailVerified) {
    throw new Error('يجب أن يكون حساب Google موثّق البريد الإلكتروني للربط الإداري.');
  }
  return {
    uid: user.uid,
    email: user.email || '',
    projectId: firebaseConfig.projectId,
  };
}

async function fetchOwnerDocsMap(
  schoolId: string,
  subcol: string,
  ownerUid: string
): Promise<Map<string, DocumentData>> {
  try {
    const snap = await getDocsFromServer(
      query(collection(db, 'schools', schoolId, subcol), where('ownerUid', '==', ownerUid))
    );
    const map = new Map<string, DocumentData>();
    snap.forEach((d) => map.set(d.id, d.data()));
    return map;
  } catch {
    return new Map<string, DocumentData>();
  }
}

/**
 * Pulls newer counselor edits (grades, absences, students, notice read receipts,
 * observations, messages, and pending audit logs) from Firestore capSections into
 * the admin's workspace so counselor work submitted while admin was offline/logged out
 * is never lost or overwritten.
 */
export async function pullCloudSectionUpdatesForWorkspace(
  workspace: SchoolWorkspacePayload
): Promise<{ workspace: SchoolWorkspacePayload; changed: boolean }> {
  const user = auth.currentUser;
  if (!user || user.isAnonymous || !user.emailVerified) {
    return { workspace, changed: false };
  }
  const schoolId = (workspace.school.id || CANONICAL_SCHOOL_ID).trim() || CANONICAL_SCHOOL_ID;
  const capSecs = await fetchOwnerDocsMap(schoolId, 'capSections', user.uid);
  if (capSecs.size === 0) {
    return { workspace, changed: false };
  }

  const next = structuredClone(workspace);
  let changed = false;

  const existingAuditIds = new Set(next.auditLogs.map((l) => l.id));
  const existingTemplateIds = new Set(next.templates.map((t) => t.id));

  for (const capData of capSecs.values()) {
    const sectionId = String(capData.sectionId || '');
    const localSec = next.sections.find((s) => s.id === sectionId);
    if (!localSec) continue;

    // 1. Merge notice read receipts unconditionally (only adds missing sectionId reads)
    const cloudReads = (capData.announcementReads || {}) as Record<
      string,
      { counselorName: string; readAt: string }
    >;
    for (const [annId, receipt] of Object.entries(cloudReads)) {
      const targetAnn = next.announcements.find((a) => a.id === annId);
      if (targetAnn && receipt && receipt.readAt) {
        targetAnn.readBy ??= {};
        if (!targetAnn.readBy[sectionId]) {
          targetAnn.readBy[sectionId] = {
            counselorName: String(receipt.counselorName || localSec.counselorName || 'المرشد'),
            readAt: String(receipt.readAt),
          };
          changed = true;
        }
      }
    }

    // 2. Append any pending audit logs from counselor
    const pendingLogs = Array.isArray(capData.pendingAuditLogs)
      ? (capData.pendingAuditLogs as AuditLogEntry[])
      : [];
    for (const log of pendingLogs) {
      if (log?.id && !existingAuditIds.has(log.id)) {
        existingAuditIds.add(log.id);
        next.auditLogs.unshift(log);
        changed = true;
      }
    }

    // 3. Merge any newly saved import templates
    const cloudTemplates = Array.isArray(capData.templates)
      ? (capData.templates as ImportTemplate[])
      : [];
    for (const tpl of cloudTemplates) {
      if (tpl?.id && !existingTemplateIds.has(tpl.id)) {
        existingTemplateIds.add(tpl.id);
        next.templates.unshift(tpl);
        changed = true;
      }
    }

    // 4. Merge students / absences / subjects / section notes when counselorEditedAt is newer
    const cloudEditedAt = String(capData.counselorEditedAt || '');
    const localSavedAt = localSec.lastCounselorSavedAt || '';
    if (cloudEditedAt && cloudEditedAt > localSavedAt) {
      const cloudSec = (capData.section || {}) as Partial<SchoolSection>;
      if (cloudSec.observations) localSec.observations = cloudSec.observations;
      if (cloudSec.caseGroups) localSec.caseGroups = cloudSec.caseGroups;
      if (cloudSec.messages) localSec.messages = cloudSec.messages;
      localSec.lastCounselorSavedAt = cloudEditedAt;

      const cloudStudents = Array.isArray(capData.students)
        ? (capData.students as CloudCapSectionStudent[]).map(stripCapStudentSecretsForUi)
        : [];
      const otherStudents = next.students.filter((st) => st.sectionId !== sectionId);
      next.students = [...otherStudents, ...cloudStudents];

      const cloudAbsences = Array.isArray(capData.absences)
        ? (capData.absences as StudentAbsence[])
        : [];
      const otherAbsences = next.absences.filter((ab) => ab.sectionId !== sectionId);
      next.absences = [...otherAbsences, ...cloudAbsences];

      const cloudSubjects = Array.isArray(capData.subjects)
        ? (capData.subjects as SubjectGradebook[])
        : [];
      const otherSubjects = next.subjects.filter((sb) => sb.sectionId !== sectionId);
      next.subjects = [...otherSubjects, ...cloudSubjects];

      changed = true;
    }
  }

  if (changed) {
    next.auditLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    if (next.auditLogs.length > 600) {
      next.auditLogs = next.auditLogs.slice(0, 600);
    }
  }

  return { workspace: next, changed };
}

export async function syncWorkspaceToFirestore(
  workspace: SchoolWorkspacePayload,
  options?: { adminCode?: string; previousAdminCode?: string }
): Promise<SchoolFirebaseSyncMeta> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    throw new Error('يرجى تسجيل الدخول بحساب Google موثّق داخل إعدادات Firebase للمدير أولاً.');
  }

  const schoolId = (workspace.school.id || CANONICAL_SCHOOL_ID).trim() || CANONICAL_SCHOOL_ID;
  const schoolRef = doc(db, 'schools', schoolId);
  let existingCreatedAt: unknown = null;
  try {
    const snap = await getDocFromServer(schoolRef);
    if (snap.exists()) {
      const existingData = snap.data();
      if (existingData.ownerUid && existingData.ownerUid !== user.uid) {
        throw new Error('هذه المدرسة محفوظة مسبقاً في Firestore على حساب Google آخر.');
      }
      existingCreatedAt = existingData.createdAt || null;
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('حساب Google آخر')) {
      throw err;
    }
  }

  const goalsList = (workspace.school.goals || [])
    .filter((g) => typeof g === 'string' && g.trim().length > 0)
    .map((g) => clampStr(g.trim(), 400))
    .slice(0, 30);

  // 1. Upsert school root doc first so isSchoolOwnerDoc(schoolId) evaluates true
  await setDoc(
    schoolRef,
    stripUndefinedDeep({
      id: schoolId,
      ownerUid: user.uid,
      name: clampStr(workspace.school.name || 'المدرسة الذكية', 200) || 'المدرسة الذكية',
      academicYear: clampStr(workspace.school.academicYear || '2025 - 2026', 40) || '2025 - 2026',
      directorate:
        clampStr(workspace.school.directorate || 'المديرية العامة للتربية', 160) || 'المديرية العامة للتربية',
      logoDataUrl: clampStr(workspace.school.logoDataUrl || '', 350000),
      coverDataUrl: clampStr(workspace.school.coverDataUrl || '', 450000),
      overview: clampStr(workspace.school.overview || '', 4000),
      vision: clampStr(workspace.school.vision || '', 2000),
      mission: clampStr(workspace.school.mission || '', 2000),
      goals: goalsList,
      createdAt: existingCreatedAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // 2. Ensure owner membership doc exists
  await setDoc(
    doc(db, 'schools', schoolId, 'members', user.uid),
    stripUndefinedDeep({
      uid: user.uid,
      schoolId,
      ownerUid: user.uid,
      role: 'admin',
      displayName: clampStr(user.displayName || 'مدير المدرسة', 160) || 'مدير المدرسة',
      status: 'active',
      updatedAt: serverTimestamp(),
    })
  );

  // 3. Query existing subcollections so updates preserve createdAt/capKeys and prune obsolete docs
  const [
    existingAnns,
    existingStages,
    existingSections,
    existingStudents,
    existingAbsences,
    existingSubjects,
    existingTemplates,
    existingLocks,
    existingCapSections,
    existingCapStudents,
  ] = await Promise.all([
    fetchOwnerDocsMap(schoolId, 'announcements', user.uid),
    fetchOwnerDocsMap(schoolId, 'stages', user.uid),
    fetchOwnerDocsMap(schoolId, 'sections', user.uid),
    fetchOwnerDocsMap(schoolId, 'students', user.uid),
    fetchOwnerDocsMap(schoolId, 'absences', user.uid),
    fetchOwnerDocsMap(schoolId, 'subjects', user.uid),
    fetchOwnerDocsMap(schoolId, 'templates', user.uid),
    fetchOwnerDocsMap(schoolId, 'sectionLocks', user.uid),
    fetchOwnerDocsMap(schoolId, 'capSections', user.uid),
    fetchOwnerDocsMap(schoolId, 'capStudents', user.uid),
  ]);

  const setOps: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];
  const delRefs: Array<ReturnType<typeof doc>> = [];
  const delPaths = new Set<string>();
  const queueDelete = (ref: ReturnType<typeof doc>) => {
    if (!delPaths.has(ref.path)) {
      delPaths.add(ref.path);
      delRefs.push(ref);
    }
  };

  // Public school profile & gate metadata
  const adminConfigured =
    workspace.adminCodeConfigured !== false || Boolean(options?.adminCode?.trim());
  setOps.push({
    ref: doc(db, 'schools', schoolId, 'public', 'info'),
    data: buildPublicInfoDocPayload(schoolId, workspace, adminConfigured),
  });

  // Admin PBKDF2 security verifier & admin_gate lookup (when adminCode provided)
  if (options?.adminCode && options.adminCode.trim()) {
    const cleanAdmin = options.adminCode.trim();
    const [pbkdf2, adminGateHash] = await Promise.all([
      hashAdminCodePbkdf2(cleanAdmin),
      computeCodeLookupId(schoolId, cleanAdmin),
    ]);
    setOps.push({
      ref: doc(db, 'schools', schoolId, 'adminSecurity', 'config'),
      data: {
        id: 'config',
        schoolId,
        ownerUid: user.uid,
        hash: pbkdf2.hash,
        salt: pbkdf2.salt,
        iterations: pbkdf2.iterations,
        updatedAt: serverTimestamp(),
      },
    });
    if (adminGateHash) {
      setOps.push({
        ref: doc(db, 'schools', schoolId, 'accessLookups', adminGateHash),
        data: {
          codeHash: adminGateHash,
          schoolId,
          ownerUid: user.uid,
          role: 'admin_gate',
          sectionId: '',
          studentId: '',
          capabilityKey: '',
          displayName: clampStr(user.displayName || 'مدير المدرسة', 160) || 'مدير المدرسة',
          sectionName: '',
          stageName: '',
          status: 'active',
          updatedAt: serverTimestamp(),
        },
      });
    }
    if (options.previousAdminCode && options.previousAdminCode.trim() !== cleanAdmin) {
      const oldAdminHash = await computeCodeLookupId(schoolId, options.previousAdminCode);
      if (oldAdminHash && oldAdminHash !== adminGateHash) {
        queueDelete(doc(db, 'schools', schoolId, 'accessLookups', oldAdminHash));
      }
    }
  }

  // Announcements
  const annIds = new Set<string>();
  for (const ann of workspace.announcements.slice(0, 100)) {
    annIds.add(ann.id);
    const prev = existingAnns.get(ann.id);
    setOps.push({
      ref: doc(db, 'schools', schoolId, 'announcements', ann.id),
      data: {
        id: ann.id,
        schoolId,
        ownerUid: user.uid,
        title: clampStr(ann.title || 'إعلان', 200) || 'إعلان',
        body: clampStr(ann.body || '-', 4000) || '-',
        pinned: Boolean(ann.pinned),
        visibility: ann.visibility === 'internal' ? 'internal' : 'public',
        authorName: clampStr(ann.authorName || 'الإدارة', 160) || 'الإدارة',
        createdAt: prev?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  }
  for (const oldId of existingAnns.keys()) {
    if (!annIds.has(oldId)) queueDelete(doc(db, 'schools', schoolId, 'announcements', oldId));
  }

  // Stages
  const stageIds = new Set<string>();
  const stageNameById = new Map<string, string>();
  for (const stg of workspace.stages.slice(0, 50)) {
    stageIds.add(stg.id);
    stageNameById.set(stg.id, stg.name);
    setOps.push({
      ref: doc(db, 'schools', schoolId, 'stages', stg.id),
      data: {
        id: stg.id,
        schoolId,
        ownerUid: user.uid,
        name: clampStr(stg.name || 'صف', 160) || 'صف',
        orderIndex: Math.max(0, Math.min(200, Math.round(stg.orderIndex))),
        updatedAt: serverTimestamp(),
      },
    });
  }
  for (const oldId of existingStages.keys()) {
    if (!stageIds.has(oldId)) queueDelete(doc(db, 'schools', schoolId, 'stages', oldId));
  }

  // Sections
  const sectionIds = new Set<string>();
  for (const sec of workspace.sections.slice(0, 150)) {
    sectionIds.add(sec.id);
    setOps.push({
      ref: doc(db, 'schools', schoolId, 'sections', sec.id),
      data: {
        id: sec.id,
        schoolId,
        ownerUid: user.uid,
        stageId: sec.stageId,
        name: clampStr(sec.name || 'أ', 160) || 'أ',
        counselorName: clampStr(sec.counselorName || '', 160),
        counselorCodeStatus: sec.counselorCodeStatus,
        orderIndex: Math.max(0, Math.min(500, Math.round(sec.orderIndex))),
        updatedAt: serverTimestamp(),
      },
    });
  }
  for (const oldId of existingSections.keys()) {
    if (!sectionIds.has(oldId)) queueDelete(doc(db, 'schools', schoolId, 'sections', oldId));
  }

  // Students
  const studentIds = new Set<string>();
  for (const stu of workspace.students.slice(0, 400)) {
    studentIds.add(stu.id);
    const prev = existingStudents.get(stu.id);
    if (prev && prev.sectionId !== stu.sectionId) {
      queueDelete(doc(db, 'schools', schoolId, 'students', stu.id));
    }
    setOps.push({
      ref: doc(db, 'schools', schoolId, 'students', stu.id),
      data: {
        id: stu.id,
        schoolId,
        ownerUid: user.uid,
        sectionId: stu.sectionId,
        fullName: clampStr(stu.fullName || 'طالب', 160) || 'طالب',
        status: stu.status,
        studentCodeStatus: stu.studentCodeStatus,
        notes: clampStr(stu.notes || '', 1000),
        createdAt: prev && prev.sectionId === stu.sectionId && prev.createdAt ? prev.createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  }
  for (const oldId of existingStudents.keys()) {
    if (!studentIds.has(oldId)) queueDelete(doc(db, 'schools', schoolId, 'students', oldId));
  }

  // Absences
  const absenceIds = new Set<string>();
  for (const ab of workspace.absences.slice(0, 300)) {
    absenceIds.add(ab.id);
    const prev = existingAbsences.get(ab.id);
    const canUpdate = prev && prev.sectionId === ab.sectionId && prev.studentId === ab.studentId;
    if (prev && !canUpdate) {
      queueDelete(doc(db, 'schools', schoolId, 'absences', ab.id));
    }
    setOps.push({
      ref: doc(db, 'schools', schoolId, 'absences', ab.id),
      data: {
        id: ab.id,
        schoolId,
        ownerUid: user.uid,
        sectionId: ab.sectionId,
        studentId: ab.studentId,
        date: clampStr(ab.date || new Date().toISOString().slice(0, 10), 20),
        excuseType: ab.excuseType,
        subjectName: clampStr(ab.subjectName || '', 120),
        notes: clampStr(ab.notes || '', 1000),
        recordedBy: clampStr(ab.recordedBy || 'المرشد', 160) || 'المرشد',
        createdAt: canUpdate && prev.createdAt ? prev.createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
  }
  for (const oldId of existingAbsences.keys()) {
    if (!absenceIds.has(oldId)) queueDelete(doc(db, 'schools', schoolId, 'absences', oldId));
  }

  // Subjects
  const subjectIds = new Set<string>();
  for (const sub of workspace.subjects.slice(0, 150)) {
    subjectIds.add(sub.id);
    const prev = existingSubjects.get(sub.id);
    if (prev && prev.sectionId !== sub.sectionId) {
      queueDelete(doc(db, 'schools', schoolId, 'subjects', sub.id));
    }
    const payloadJson = JSON.stringify({
      midyearColumns: sub.midyearColumns,
      subRecords: sub.subRecords,
      cells: sub.cells,
      annualPursuitConfig: sub.annualPursuitConfig,
      releases: sub.releases || {},
    });
    setOps.push({
      ref: doc(db, 'schools', schoolId, 'subjects', sub.id),
      data: {
        id: sub.id,
        schoolId,
        ownerUid: user.uid,
        sectionId: sub.sectionId,
        name: clampStr(sub.name || 'مادة', 160) || 'مادة',
        payloadJson: clampStr(payloadJson, 350000),
        updatedAt: serverTimestamp(),
      },
    });
  }
  for (const oldId of existingSubjects.keys()) {
    if (!subjectIds.has(oldId)) queueDelete(doc(db, 'schools', schoolId, 'subjects', oldId));
  }

  // Templates (allow update: if false -> create new only, delete removed)
  const templateIds = new Set<string>();
  for (const tpl of workspace.templates.slice(0, 60)) {
    templateIds.add(tpl.id);
    if (!existingTemplates.has(tpl.id)) {
      const boxesJson = JSON.stringify(tpl.boxes || []);
      setOps.push({
        ref: doc(db, 'schools', schoolId, 'templates', tpl.id),
        data: {
          id: tpl.id,
          schoolId,
          ownerUid: user.uid,
          name: clampStr(tpl.name || 'قالب', 160) || 'قالب',
          description: clampStr(tpl.description || '', 1000),
          boxesJson: clampStr(boxesJson, 60000),
          createdAt: serverTimestamp(),
        },
      });
    }
  }
  for (const oldId of existingTemplates.keys()) {
    if (!templateIds.has(oldId)) queueDelete(doc(db, 'schools', schoolId, 'templates', oldId));
  }

  // 4. Synchronize capability documents: sectionLocks, accessLookups, capSections, capStudents
  const prevStudentCapByStudentId = new Map<
    string,
    { capKey: string; codeHash: string }
  >();
  for (const capData of existingCapSections.values()) {
    const sts = Array.isArray(capData.students)
      ? (capData.students as CloudCapSectionStudent[])
      : [];
    for (const st of sts) {
      if (st?.id && isValidHex64(st._capKey) && isValidHex64(st._codeHash)) {
        prevStudentCapByStudentId.set(st.id, { capKey: st._capKey, codeHash: st._codeHash });
      }
    }
  }

  const activeCapSectionKeys = new Set<string>();
  const activeCapStudentKeys = new Set<string>();

  for (const sec of workspace.sections.slice(0, 150)) {
    const stageName = stageNameById.get(sec.stageId) || '';
    const existingLock = existingLocks.get(sec.id);
    const secStudents = workspace.students.filter((st) => st.sectionId === sec.id);
    const secAbsences = workspace.absences.filter((ab) => ab.sectionId === sec.id);
    const secSubjects = workspace.subjects.filter((sb) => sb.sectionId === sec.id);

    // Prepare student capability records for this section
    const capStudentsForSection: CloudCapSectionStudent[] = [];
    for (const stu of secStudents) {
      const prevMeta = prevStudentCapByStudentId.get(stu.id);
      if (stu.studentCodeStatus === 'active' && stu.studentAccessCode) {
        const stHash = await computeCodeLookupId(schoolId, stu.studentAccessCode);
        const reuseKey =
          prevMeta && prevMeta.codeHash === stHash && isValidHex64(prevMeta.capKey)
            ? prevMeta.capKey
            : '';
        const stCapKey = reuseKey || generateHex64();

        if (prevMeta && prevMeta.codeHash !== stHash) {
          queueDelete(doc(db, 'schools', schoolId, 'accessLookups', prevMeta.codeHash));
        }
        if (prevMeta && prevMeta.capKey !== stCapKey) {
          queueDelete(doc(db, 'schools', schoolId, 'capStudents', prevMeta.capKey));
        }

        activeCapStudentKeys.add(stCapKey);
        capStudentsForSection.push({
          ...stu,
          _codeHash: stHash,
          _capKey: stCapKey,
        });

        if (stHash) {
          setOps.push({
            ref: doc(db, 'schools', schoolId, 'accessLookups', stHash),
            data: {
              codeHash: stHash,
              schoolId,
              ownerUid: user.uid,
              role: 'student',
              sectionId: sec.id,
              studentId: stu.id,
              capabilityKey: stCapKey,
              displayName: clampStr(stu.fullName || 'طالب', 160),
              sectionName: clampStr(sec.name, 160),
              stageName: clampStr(stageName, 160),
              status: 'active',
              updatedAt: serverTimestamp(),
            },
          });
        }

        setOps.push({
          ref: doc(db, 'schools', schoolId, 'capStudents', stCapKey),
          data: buildCapStudentDocPayload({
            capKey: stCapKey,
            schoolId,
            ownerUid: user.uid,
            section: sec,
            stages: workspace.stages,
            school: workspace.school,
            student: stu,
            absences: secAbsences,
            subjects: secSubjects,
            announcements: workspace.announcements,
          }),
        });
      } else {
        if (prevMeta) {
          queueDelete(doc(db, 'schools', schoolId, 'accessLookups', prevMeta.codeHash));
          queueDelete(doc(db, 'schools', schoolId, 'capStudents', prevMeta.capKey));
        }
        capStudentsForSection.push({ ...stu });
      }
    }

    // Counselor section lock + capSection + lookup
    if (sec.counselorCodeStatus === 'active' && sec.counselorAccessCode) {
      const cHash = await computeCodeLookupId(schoolId, sec.counselorAccessCode);
      const prevHash = String(existingLock?.counselorCodeHash || '');
      const prevCapKey = String(existingLock?.sectionCapKey || '');
      const reuseCapKey = prevHash === cHash && isValidHex64(prevCapKey) ? prevCapKey : '';
      const sectionCapKey = reuseCapKey || generateHex64();

      if (isValidHex64(prevHash) && prevHash !== cHash) {
        queueDelete(doc(db, 'schools', schoolId, 'accessLookups', prevHash));
      }
      if (isValidHex64(prevCapKey) && prevCapKey !== sectionCapKey) {
        queueDelete(doc(db, 'schools', schoolId, 'capSections', prevCapKey));
      }

      activeCapSectionKeys.add(sectionCapKey);

      setOps.push({
        ref: doc(db, 'schools', schoolId, 'sectionLocks', sec.id),
        data: {
          id: sec.id,
          schoolId,
          ownerUid: user.uid,
          sectionId: sec.id,
          counselorCodeHash: cHash,
          sectionCapKey,
          updatedAt: serverTimestamp(),
        },
      });

      if (cHash) {
        setOps.push({
          ref: doc(db, 'schools', schoolId, 'accessLookups', cHash),
          data: {
            codeHash: cHash,
            schoolId,
            ownerUid: user.uid,
            role: 'counselor',
            sectionId: sec.id,
            studentId: '',
            capabilityKey: sectionCapKey,
            displayName: clampStr(sec.counselorName || 'مرشد الشعبة', 160),
            sectionName: clampStr(sec.name, 160),
            stageName: clampStr(stageName, 160),
            status: 'active',
            updatedAt: serverTimestamp(),
          },
        });
      }

      const announcementReads: Record<string, { counselorName: string; readAt: string }> = {};
      for (const ann of workspace.announcements) {
        if (ann.readBy?.[sec.id]) {
          announcementReads[ann.id] = ann.readBy[sec.id];
        }
      }

      setOps.push({
        ref: doc(db, 'schools', schoolId, 'capSections', sectionCapKey),
        data: buildCapSectionDocPayload({
          capKey: sectionCapKey,
          schoolId,
          ownerUid: user.uid,
          section: sec,
          counselorCodeHash: cHash,
          school: workspace.school,
          stages: workspace.stages,
          announcements: workspace.announcements,
          students: capStudentsForSection,
          absences: secAbsences,
          subjects: secSubjects,
          templates: workspace.templates,
          pendingAuditLogs: [],
          announcementReads,
          counselorEditedAt: sec.lastCounselorSavedAt || '',
        }),
      });
    } else {
      const prevHash = String(existingLock?.counselorCodeHash || '');
      const prevCapKey = String(existingLock?.sectionCapKey || '');
      if (isValidHex64(prevHash)) {
        queueDelete(doc(db, 'schools', schoolId, 'accessLookups', prevHash));
      }
      if (isValidHex64(prevCapKey)) {
        queueDelete(doc(db, 'schools', schoolId, 'capSections', prevCapKey));
      }
      setOps.push({
        ref: doc(db, 'schools', schoolId, 'sectionLocks', sec.id),
        data: {
          id: sec.id,
          schoolId,
          ownerUid: user.uid,
          sectionId: sec.id,
          counselorCodeHash: '',
          sectionCapKey: '',
          updatedAt: serverTimestamp(),
        },
      });
    }
  }

  // Delete locks/caps for removed sections and removed students
  for (const [oldSecId, lockData] of existingLocks.entries()) {
    if (!sectionIds.has(oldSecId)) {
      const oldHash = String(lockData.counselorCodeHash || '');
      const oldCap = String(lockData.sectionCapKey || '');
      if (isValidHex64(oldHash)) queueDelete(doc(db, 'schools', schoolId, 'accessLookups', oldHash));
      if (isValidHex64(oldCap)) queueDelete(doc(db, 'schools', schoolId, 'capSections', oldCap));
      queueDelete(doc(db, 'schools', schoolId, 'sectionLocks', oldSecId));
    }
  }
  for (const capKey of existingCapSections.keys()) {
    if (!activeCapSectionKeys.has(capKey)) {
      queueDelete(doc(db, 'schools', schoolId, 'capSections', capKey));
    }
  }
  for (const [capKey, stCapData] of existingCapStudents.entries()) {
    if (!activeCapStudentKeys.has(capKey)) {
      const oldStuId = String(stCapData.studentId || '');
      const prevMeta = prevStudentCapByStudentId.get(oldStuId);
      if (prevMeta && isValidHex64(prevMeta.codeHash)) {
        queueDelete(doc(db, 'schools', schoolId, 'accessLookups', prevMeta.codeHash));
      }
      queueDelete(doc(db, 'schools', schoolId, 'capStudents', capKey));
    }
  }

  // Commit deletes first, then commit sets in safe chunks
  for (let i = 0; i < delRefs.length; i += 250) {
    const batch = writeBatch(db);
    delRefs.slice(i, i + 250).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  for (let i = 0; i < setOps.length; i += 100) {
    const batch = writeBatch(db);
    setOps.slice(i, i + 100).forEach((op) => batch.set(op.ref, op.data));
    await batch.commit();
  }

  const now = new Date().toISOString();
  return {
    linked: true,
    projectId: firebaseConfig.projectId,
    linkedEmail: user.email || '',
    linkedUid: user.uid,
    lastSyncedAt: now,
    lastSyncStatus: 'synced',
    lastSyncMessage: `تمت المزامنة السحابية المركزية على حساب ${user.email || 'Google'} (${setOps.length} عنصر)`,
  };
}

export async function restoreWorkspaceFromFirestore(schoolId?: string): Promise<Record<string, unknown> | null> {
  const user = auth.currentUser;
  if (!user) return null;

  const primaryId = (schoolId || CANONICAL_SCHOOL_ID).trim() || CANONICAL_SCHOOL_ID;
  const legacyUidId = makeSchoolIdForUid(user.uid);
  let targetSchoolId = primaryId;
  let schoolSnap = await getDocFromServer(doc(db, 'schools', targetSchoolId));
  if (!schoolSnap.exists() && legacyUidId !== primaryId) {
    const legacySnap = await getDocFromServer(doc(db, 'schools', legacyUidId));
    if (legacySnap.exists()) {
      targetSchoolId = legacyUidId;
      schoolSnap = legacySnap;
    }
  }
  if (!schoolSnap.exists()) {
    return null;
  }

  const sData = schoolSnap.data();
  const queryOwnerUid = String(sData.ownerUid || user.uid);
  const [annsMap, stagesMap, secsMap, studentsMap, absencesMap, subjectsMap, templatesMap, capSecsMap] =
    await Promise.all([
      fetchOwnerDocsMap(targetSchoolId, 'announcements', queryOwnerUid),
      fetchOwnerDocsMap(targetSchoolId, 'stages', queryOwnerUid),
      fetchOwnerDocsMap(targetSchoolId, 'sections', queryOwnerUid),
      fetchOwnerDocsMap(targetSchoolId, 'students', queryOwnerUid),
      fetchOwnerDocsMap(targetSchoolId, 'absences', queryOwnerUid),
      fetchOwnerDocsMap(targetSchoolId, 'subjects', queryOwnerUid),
      fetchOwnerDocsMap(targetSchoolId, 'templates', queryOwnerUid),
      fetchOwnerDocsMap(targetSchoolId, 'capSections', queryOwnerUid),
    ]);

  const announcements: SchoolAnnouncement[] = Array.from(annsMap.values()).map((d) => ({
    id: String(d.id || ''),
    title: String(d.title || ''),
    body: String(d.body || ''),
    pinned: Boolean(d.pinned),
    visibility: d.visibility === 'internal' ? 'internal' : 'public',
    authorName: String(d.authorName || 'الإدارة'),
    createdAt: timestampToIso(d.createdAt),
    updatedAt: timestampToIso(d.updatedAt),
  }));

  const stages: SchoolStageGrade[] = Array.from(stagesMap.values())
    .map((d) => ({
      id: String(d.id || ''),
      name: String(d.name || ''),
      orderIndex: typeof d.orderIndex === 'number' ? d.orderIndex : 0,
      updatedAt: timestampToIso(d.updatedAt),
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex);

  const sections: SchoolSection[] = Array.from(secsMap.values())
    .map((d) => ({
      id: String(d.id || ''),
      stageId: String(d.stageId || ''),
      name: String(d.name || ''),
      counselorName: String(d.counselorName || ''),
      counselorCodeStatus: (d.counselorCodeStatus as SchoolSection['counselorCodeStatus']) || 'unset',
      orderIndex: typeof d.orderIndex === 'number' ? d.orderIndex : 0,
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex);

  const students: SchoolStudent[] = Array.from(studentsMap.values()).map((d) => ({
    id: String(d.id || ''),
    sectionId: String(d.sectionId || ''),
    fullName: String(d.fullName || ''),
    status: (d.status as SchoolStudent['status']) || 'active',
    studentCodeStatus: (d.studentCodeStatus as SchoolStudent['studentCodeStatus']) || 'unset',
    notes: String(d.notes || ''),
    createdAt: timestampToIso(d.createdAt),
    updatedAt: timestampToIso(d.updatedAt),
  }));

  const absences: StudentAbsence[] = Array.from(absencesMap.values()).map((d) => ({
    id: String(d.id || ''),
    sectionId: String(d.sectionId || ''),
    studentId: String(d.studentId || ''),
    date: String(d.date || ''),
    excuseType: (d.excuseType as StudentAbsence['excuseType']) || 'unexcused',
    subjectName: String(d.subjectName || ''),
    notes: String(d.notes || ''),
    recordedBy: String(d.recordedBy || 'المرشد'),
    createdAt: timestampToIso(d.createdAt),
    updatedAt: timestampToIso(d.updatedAt),
  }));

  const subjects: SubjectGradebook[] = Array.from(subjectsMap.values()).map((d) => {
    let parsed: {
      midyearColumns?: SubjectGradebook['midyearColumns'];
      subRecords?: SubjectGradebook['subRecords'];
      cells?: SubjectGradebook['cells'];
      annualPursuitConfig?: SubjectGradebook['annualPursuitConfig'];
      releases?: SubjectGradebook['releases'];
    } = {};
    try {
      parsed = JSON.parse(String(d.payloadJson || '{}'));
    } catch {
      parsed = {};
    }
    return {
      id: String(d.id || ''),
      sectionId: String(d.sectionId || ''),
      name: String(d.name || ''),
      midyearColumns: parsed.midyearColumns || [],
      subRecords: parsed.subRecords || [],
      cells: parsed.cells || {},
      releases: parsed.releases || {},
      annualPursuitConfig: parsed.annualPursuitConfig || {
        term1ColumnIds: [],
        midyearColumnIds: [],
        term2ColumnIds: [],
        scaleMode: 'scale100',
      },
      updatedAt: timestampToIso(d.updatedAt),
    };
  });

  const templates: ImportTemplate[] = Array.from(templatesMap.values()).map((d) => {
    let boxes: ImportTemplate['boxes'] = [];
    try {
      boxes = JSON.parse(String(d.boxesJson || '[]'));
    } catch {
      boxes = [];
    }
    return {
      id: String(d.id || ''),
      name: String(d.name || ''),
      description: String(d.description || ''),
      boxes,
      createdAt: timestampToIso(d.createdAt),
    };
  });

  const restoredWorkspace: SchoolWorkspacePayload = {
    session: { role: 'admin', displayName: 'مدير المدرسة', schoolId: targetSchoolId },
    school: {
      id: targetSchoolId,
      name: String(sData.name || 'المدرسة الذكية'),
      academicYear: String(sData.academicYear || '2025 - 2026'),
      directorate: String(sData.directorate || 'المديرية العامة للتربية'),
      logoDataUrl: String(sData.logoDataUrl || ''),
      coverDataUrl: String(sData.coverDataUrl || ''),
      overview: String(sData.overview || ''),
      vision: String(sData.vision || ''),
      mission: String(sData.mission || ''),
      goals: Array.isArray(sData.goals) ? sData.goals : [],
      updatedAt: timestampToIso(sData.updatedAt),
    },
    announcements,
    stages,
    sections,
    students,
    absences,
    subjects,
    templates,
    auditLogs: [],
    backups: [],
  };

  // Overlay any newer counselor edits / student codes stored in capSections
  if (capSecsMap.size > 0) {
    const merged = await pullCloudSectionUpdatesForWorkspace(restoredWorkspace);
    return {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      school: merged.workspace.school,
      announcements: merged.workspace.announcements,
      stages: merged.workspace.stages,
      sections: merged.workspace.sections,
      students: merged.workspace.students,
      absences: merged.workspace.absences,
      subjects: merged.workspace.subjects,
      templates: merged.workspace.templates,
      auditLogs: merged.workspace.auditLogs,
    };
  }

  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    school: restoredWorkspace.school,
    announcements,
    stages,
    sections,
    students,
    absences,
    subjects,
    templates,
  };
}
