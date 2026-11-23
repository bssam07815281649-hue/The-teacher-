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

export function makeSchoolIdForUid(uid?: string): string {
  const safe = (uid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 110);
  return safe ? `school_${safe}` : 'default_school';
}

function clampStr(v: string | undefined, max: number): string {
  if (!v) return '';
  return v.length > max ? v.slice(0, max) : v;
}

function timestampToIso(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

export async function testFirestoreConnectivity(schoolId?: string): Promise<{
  reachable: boolean;
  projectId: string;
  message: string;
}> {
  const targetSchoolId = schoolId || makeSchoolIdForUid(auth.currentUser?.uid);
  try {
    await getDocFromServer(doc(db, 'schools', targetSchoolId));
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
  const snap = await getDocsFromServer(
    query(collection(db, 'schools', schoolId, subcol), where('ownerUid', '==', ownerUid))
  );
  const map = new Map<string, DocumentData>();
  snap.forEach((d) => map.set(d.id, d.data()));
  return map;
}

export async function syncWorkspaceToFirestore(
  workspace: SchoolWorkspacePayload
): Promise<SchoolFirebaseSyncMeta> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('يرجى تسجيل الدخول بحساب Google داخل إعدادات Firebase للمدير أولاً.');
  }

  const schoolId = (workspace.school.id || 'default_school').trim() || 'default_school';
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
    // Proceed cleanly for new school creation
  }

  const goalsList = (workspace.school.goals || [])
    .filter((g) => typeof g === 'string' && g.trim().length > 0)
    .map((g) => clampStr(g.trim(), 400))
    .slice(0, 30);

  // 1. Upsert school root doc first so isSchoolOwnerDoc(schoolId) evaluates true
  await setDoc(schoolRef, {
    id: schoolId,
    ownerUid: user.uid,
    name: clampStr(workspace.school.name || 'المدرسة الذكية', 200) || 'المدرسة الذكية',
    academicYear: clampStr(workspace.school.academicYear || '2025 - 2026', 40) || '2025 - 2026',
    directorate: clampStr(workspace.school.directorate || 'المديرية العامة للتربية', 160) || 'المديرية العامة للتربية',
    logoDataUrl: clampStr(workspace.school.logoDataUrl || '', 350000),
    coverDataUrl: clampStr(workspace.school.coverDataUrl || '', 450000),
    overview: clampStr(workspace.school.overview || '', 4000),
    vision: clampStr(workspace.school.vision || '', 2000),
    mission: clampStr(workspace.school.mission || '', 2000),
    goals: goalsList,
    createdAt: existingCreatedAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // 2. Ensure owner membership doc exists
  await setDoc(doc(db, 'schools', schoolId, 'members', user.uid), {
    uid: user.uid,
    schoolId,
    ownerUid: user.uid,
    role: 'admin',
    displayName: clampStr(user.displayName || 'مدير المدرسة', 160) || 'مدير المدرسة',
    status: 'active',
    updatedAt: serverTimestamp(),
  });

  // 3. Query existing subcollection docs so updates preserve immutable createdAt & delete removed records
  const [
    existingAnns,
    existingStages,
    existingSections,
    existingStudents,
    existingAbsences,
    existingSubjects,
    existingTemplates,
  ] = await Promise.all([
    fetchOwnerDocsMap(schoolId, 'announcements', user.uid),
    fetchOwnerDocsMap(schoolId, 'stages', user.uid),
    fetchOwnerDocsMap(schoolId, 'sections', user.uid),
    fetchOwnerDocsMap(schoolId, 'students', user.uid),
    fetchOwnerDocsMap(schoolId, 'absences', user.uid),
    fetchOwnerDocsMap(schoolId, 'subjects', user.uid),
    fetchOwnerDocsMap(schoolId, 'templates', user.uid),
  ]);

  const setOps: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];
  const delRefs: Array<ReturnType<typeof doc>> = [];

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
    if (!annIds.has(oldId)) delRefs.push(doc(db, 'schools', schoolId, 'announcements', oldId));
  }

  // Stages
  const stageIds = new Set<string>();
  for (const stg of workspace.stages.slice(0, 50)) {
    stageIds.add(stg.id);
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
    if (!stageIds.has(oldId)) delRefs.push(doc(db, 'schools', schoolId, 'stages', oldId));
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
    if (!sectionIds.has(oldId)) delRefs.push(doc(db, 'schools', schoolId, 'sections', oldId));
  }

  // Students
  const studentIds = new Set<string>();
  for (const stu of workspace.students.slice(0, 400)) {
    studentIds.add(stu.id);
    const prev = existingStudents.get(stu.id);
    if (prev && prev.sectionId !== stu.sectionId) {
      delRefs.push(doc(db, 'schools', schoolId, 'students', stu.id));
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
    if (!studentIds.has(oldId)) delRefs.push(doc(db, 'schools', schoolId, 'students', oldId));
  }

  // Absences
  const absenceIds = new Set<string>();
  for (const ab of workspace.absences.slice(0, 300)) {
    absenceIds.add(ab.id);
    const prev = existingAbsences.get(ab.id);
    const canUpdate = prev && prev.sectionId === ab.sectionId && prev.studentId === ab.studentId;
    if (prev && !canUpdate) {
      delRefs.push(doc(db, 'schools', schoolId, 'absences', ab.id));
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
    if (!absenceIds.has(oldId)) delRefs.push(doc(db, 'schools', schoolId, 'absences', oldId));
  }

  // Subjects
  const subjectIds = new Set<string>();
  for (const sub of workspace.subjects.slice(0, 150)) {
    subjectIds.add(sub.id);
    const prev = existingSubjects.get(sub.id);
    if (prev && prev.sectionId !== sub.sectionId) {
      delRefs.push(doc(db, 'schools', schoolId, 'subjects', sub.id));
    }
    const payloadJson = JSON.stringify({
      midyearColumns: sub.midyearColumns,
      subRecords: sub.subRecords,
      cells: sub.cells,
      annualPursuitConfig: sub.annualPursuitConfig,
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
    if (!subjectIds.has(oldId)) delRefs.push(doc(db, 'schools', schoolId, 'subjects', oldId));
  }

  // Templates (allow update: if false in firestore.rules -> create new only, delete removed)
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
    if (!templateIds.has(oldId)) delRefs.push(doc(db, 'schools', schoolId, 'templates', oldId));
  }

  // Delete first when docs moved sections, then commit sets in chunks
  for (let i = 0; i < delRefs.length; i += 350) {
    const batch = writeBatch(db);
    delRefs.slice(i, i + 350).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  for (let i = 0; i < setOps.length; i += 350) {
    const batch = writeBatch(db);
    setOps.slice(i, i + 350).forEach((op) => batch.set(op.ref, op.data));
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
    lastSyncMessage: `تمت المزامنة السحابية على حساب ${user.email || 'Google'} (${setOps.length} عنصر)`,
  };
}

export async function restoreWorkspaceFromFirestore(schoolId?: string): Promise<Record<string, unknown> | null> {
  const user = auth.currentUser;
  if (!user) return null;

  const primaryId = (schoolId || 'default_school').trim() || 'default_school';
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
  const [annsMap, stagesMap, secsMap, studentsMap, absencesMap, subjectsMap, templatesMap] = await Promise.all([
    fetchOwnerDocsMap(targetSchoolId, 'announcements', queryOwnerUid),
    fetchOwnerDocsMap(targetSchoolId, 'stages', queryOwnerUid),
    fetchOwnerDocsMap(targetSchoolId, 'sections', queryOwnerUid),
    fetchOwnerDocsMap(targetSchoolId, 'students', queryOwnerUid),
    fetchOwnerDocsMap(targetSchoolId, 'absences', queryOwnerUid),
    fetchOwnerDocsMap(targetSchoolId, 'subjects', queryOwnerUid),
    fetchOwnerDocsMap(targetSchoolId, 'templates', queryOwnerUid),
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

  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
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
  };
}
