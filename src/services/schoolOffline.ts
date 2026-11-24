import type { GradeCellValue, SchoolSessionUser, SchoolWorkspacePayload, SubjectGradebook } from '../types';
import { makeCellKey } from '../utils/gradeCalculations';

// Offline grade edits are scoped by the authenticated school's counselor section.
// No bearer tokens or administrator credentials are stored on the device.
interface CachedWorkspace {
  key: string;
  workspace: SchoolWorkspacePayload;
  lastServerSyncAt: string;
}
export interface PendingGradeWrite {
  id: string;
  key: string;
  sectionId: string;
  subjectId: string;
  createdAt: string;
  updates: { studentId: string; columnId: string; value: GradeCellValue }[];
  originals: Record<string, GradeCellValue | null>;
}
export interface SchoolOfflineStatus {
  online: boolean;
  pendingCount: number;
  lastServerSyncAt: string;
  conflictCount: number;
}
export interface CloudSessionPointer {
  schoolId: string;
  role: 'counselor' | 'student';
  sectionId: string;
  studentId: string;
  capKey: string;
  codeHash: string;
}
const DB = 'smart-school-counselor-offline-v1';
const VERSION = 1;
const syncEvent = 'smart-school-offline-status';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('التخزين المحلي غير مدعوم في هذا المتصفح.')); return; }
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('لم يتم حفظ التعديل على الجهاز.'));
  });
}
async function readStore<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, 'readonly');
    const result = await done(tx.objectStore(store).get(key));
    return result as T | undefined;
  } finally { db.close(); }
}
async function putStore(store: string, value: unknown, key?: IDBValidKey) {
  const db = await openDb();
  try {
    const tx = db.transaction(store, 'readwrite');
    if (key === undefined) tx.objectStore(store).put(value);
    else tx.objectStore(store).put(value, key);
    await txDone(tx);
  } finally { db.close(); }
}
async function getPendingAll(): Promise<PendingGradeWrite[]> {
  const db = await openDb();
  try {
    const tx = db.transaction('pending', 'readonly');
    return await done(tx.objectStore('pending').getAll()) as PendingGradeWrite[];
  } finally { db.close(); }
}
async function removePending(id: string) {
  const db = await openDb();
  try {
    const tx = db.transaction('pending', 'readwrite');
    tx.objectStore('pending').delete(id);
    await txDone(tx);
  } finally { db.close(); }
}
export function scopeKey(session: SchoolSessionUser): string {
  return [session.schoolId, session.role, session.sectionId || '', session.studentId || ''].join('::');
}
function announce() {
  window.dispatchEvent(new Event(syncEvent));
}
export const SCHOOL_OFFLINE_STATUS_EVENT = syncEvent;

export async function cacheSchoolWorkspace(workspace: SchoolWorkspacePayload, synced: boolean) {
  if (workspace.session.role !== 'counselor' && workspace.session.role !== 'student') return;
  const key = scopeKey(workspace.session);
  const existing = await readStore<CachedWorkspace>('snapshots', key);
  await putStore('snapshots', {
    key, workspace,
    lastServerSyncAt: synced ? new Date().toISOString() : existing?.lastServerSyncAt || '',
  } satisfies CachedWorkspace);
  await putStore('meta', key, 'recentScope');
  announce();
}
export async function getCachedSchoolWorkspace(): Promise<SchoolWorkspacePayload | null> {
  const key = await readStore<string>('meta', 'recentScope');
  return key ? (await readStore<CachedWorkspace>('snapshots', key))?.workspace || null : null;
}
export async function getCachedSchoolSession(): Promise<SchoolSessionUser | null> {
  return (await getCachedSchoolWorkspace())?.session || null;
}
export async function saveCloudSessionPointer(pointer: CloudSessionPointer): Promise<void> {
  if (pointer.role !== 'counselor' && pointer.role !== 'student') return;
  await putStore('meta', pointer, 'cloudSessionPointer');
}
export async function getCloudSessionPointer(): Promise<CloudSessionPointer | null> {
  const ptr = await readStore<CloudSessionPointer>('meta', 'cloudSessionPointer');
  if (!ptr || (ptr.role !== 'counselor' && ptr.role !== 'student') || !ptr.capKey || !ptr.codeHash) {
    return null;
  }
  return ptr;
}
export async function clearCloudSessionPointer(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').delete('cloudSessionPointer');
    await txDone(tx);
  } finally { db.close(); }
}
export async function getOfflineStatus(session?: SchoolSessionUser): Promise<SchoolOfflineStatus> {
  const key = session ? scopeKey(session) : await readStore<string>('meta', 'recentScope');
  const cached = key ? await readStore<CachedWorkspace>('snapshots', key) : null;
  const pending = key ? (await getPendingAll()).filter(x => x.key === key) : [];
  return {
    online: navigator.onLine,
    pendingCount: pending.length,
    lastServerSyncAt: cached?.lastServerSyncAt || '',
    conflictCount: key ? await readStore<number>('meta', 'conflicts:' + key) || 0 : 0,
  };
}
export async function clearOfflineSchoolCache() {
  // Never discard unsynchronized edits on logout.
  if ((await getPendingAll()).length) {
    throw new Error('توجد درجات محفوظة على الجهاز ولم تُزامن. زامنها قبل تسجيل الخروج.');
  }
  const db = await openDb();
  try {
    const tx = db.transaction(['snapshots','meta'], 'readwrite');
    tx.objectStore('snapshots').clear();
    tx.objectStore('meta').clear();
    await txDone(tx);
  } finally { db.close(); }
  announce();
}
export function canQueueOffline(err: unknown): boolean {
  return !navigator.onLine || (err instanceof TypeError && /fetch|network|failed|load/i.test(err.message));
}

export async function saveGradeEditOffline(
  sectionId: string,
  subjectId: string,
  updates: PendingGradeWrite['updates'],
): Promise<SubjectGradebook> {
  const key = await readStore<string>('meta', 'recentScope');
  if (!key) throw new Error('افتح الشعبة مرة واحدة بالإنترنت قبل استخدام الحفظ دون إنترنت.');
  const db = await openDb();
  try {
    const tx = db.transaction(['snapshots','pending'], 'readwrite');
    const snapshots = tx.objectStore('snapshots');
    const pending = tx.objectStore('pending');
    const cached = await done(snapshots.get(key)) as CachedWorkspace | undefined;
    const workspace = cached?.workspace;
    if (!workspace || workspace.session.role !== 'counselor' || workspace.session.sectionId !== sectionId) {
      tx.abort();
      throw new Error('لا يمكن حفظ الدرجات خارج شعبة المرشد المسجلة على هذا الجهاز.');
    }
    const subject = workspace.subjects.find(s => s.id === subjectId && s.sectionId === sectionId);
    if (!subject) { tx.abort(); throw new Error('لا يوجد دفتر مادة محفوظ محلياً.'); }
    const originals: PendingGradeWrite['originals'] = {};
    for (const entry of updates) {
      if (!workspace.students.some(s => s.id === entry.studentId && s.sectionId === sectionId)) {
        tx.abort(); throw new Error('طالب غير موجود في الشعبة المحفوظة.');
      }
      if (![...subject.midyearColumns, ...subject.subRecords.flatMap(r=>r.columns)].some(c=>c.id===entry.columnId)) {
        tx.abort(); throw new Error('العمود غير موجود في السجل المحفوظ.');
      }
      const cellKey = makeCellKey(entry.studentId, entry.columnId);
      originals[cellKey] = subject.cells[cellKey] ? {...subject.cells[cellKey]} : null;
      subject.cells[cellKey] = {...entry.value};
    }
    pending.put({id: crypto.randomUUID(), key, sectionId, subjectId, createdAt: new Date().toISOString(),
      updates, originals} satisfies PendingGradeWrite);
    snapshots.put(cached as CachedWorkspace);
    await txDone(tx);
    announce();
    return subject;
  } finally { db.close(); }
}
function equalCell(a: GradeCellValue | null | undefined, b: GradeCellValue | null | undefined) {
  const x = a || {status:'blank',score:null};
  const y = b || {status:'blank',score:null};
  return x.status === y.status && x.score === y.score;
}
export async function synchronizeGradeEdits(
  serverWorkspace: SchoolWorkspacePayload,
  send: (sectionId: string, subjectId: string, updates: PendingGradeWrite['updates']) => Promise<unknown>,
): Promise<{ workspace: SchoolWorkspacePayload; conflictCount: number; pendingCount: number }> {
  const key = scopeKey(serverWorkspace.session);
  const ops = (await getPendingAll()).filter(op => op.key === key).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const workspace = structuredClone(serverWorkspace);
  let conflictCount=0;
  for (const op of ops) {
    const subject = workspace.subjects.find(s=>s.id===op.subjectId && s.sectionId===op.sectionId);
    if (!subject) { conflictCount++; continue; }
    const conflict = op.updates.some(change=>{
      const k=makeCellKey(change.studentId,change.columnId);
      const remote=subject.cells[k];
      return !equalCell(remote, op.originals[k]) && !equalCell(remote, change.value);
    });
    if (conflict) { conflictCount++; continue; }
    const needsUpload = op.updates.some(change=>!equalCell(subject.cells[makeCellKey(change.studentId,change.columnId)],change.value));
    if (needsUpload) {
      try { await send(op.sectionId,op.subjectId,op.updates); }
      catch { break; }
    }
    for (const change of op.updates) subject.cells[makeCellKey(change.studentId,change.columnId)]={...change.value};
    await removePending(op.id);
  }
  const left = (await getPendingAll()).filter(op=>op.key===key);
  for (const op of left) {
    const subject=workspace.subjects.find(s=>s.id===op.subjectId);
    if (!subject) continue;
    for (const u of op.updates) subject.cells[makeCellKey(u.studentId,u.columnId)]={...u.value};
  }
  await putStore('meta', conflictCount, 'conflicts:' + key);
  await cacheSchoolWorkspace(workspace, left.length===0);
  return {workspace, conflictCount, pendingCount:left.length};
}
