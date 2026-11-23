import { initializeApp } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  deleteUser,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  writeBatch,
  deleteField,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  Book,
  BookPage,
  ChatMessage,
  Exam,
  ExamQuestion,
  Note,
  SchoolGrade,
  StudyPlan,
  StudyTask,
  UserProfile,
} from '../types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function clampStr(val: string | undefined, max: number): string {
  if (!val) return '';
  return val.length > max ? val.slice(0, max) : val;
}

function timestampToMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts && typeof (ts as { toMillis: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts && typeof (ts as { seconds: number }).seconds === 'number') {
    return (ts as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function reportSnapshotError(error: unknown, operationType: OperationType, path: string, onError?: (err: unknown) => void) {
  try {
    handleFirestoreError(error, operationType, path);
  } catch (wrapped) {
    if (onError) onError(wrapped);
  }
}

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signInWithGoogleRedirect() {
  return signInWithRedirect(auth, googleProvider);
}

export async function consumeGoogleRedirectResult() {
  return getRedirectResult(auth);
}

export async function signOutUser() {
  return signOut(auth);
}

export async function getOrCreateUserProfile(user: User): Promise<UserProfile> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }
    const profile: UserProfile = {
      uid: user.uid,
      displayName: clampStr(user.displayName || 'طالب', 160),
      email: clampStr(user.email || (user.isAnonymous ? `guest-${user.uid}@anonymous.school.invalid` : ''), 200),
      photoURL: clampStr(user.photoURL || '', 500),
      tutorLanguage: 'ar-msa',
      theme: 'light',
      fontSize: 18,
      speechRate: 1.0,
      voiceName: 'Zephyr',
      gradeLevel: '',
    };
    await setDoc(ref, {
      ...profile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return profile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateUserProfile(
  uid: string,
  updates: Partial<
    Pick<
      UserProfile,
      'displayName' | 'photoURL' | 'tutorLanguage' | 'theme' | 'fontSize' | 'speechRate' | 'voiceName' | 'gradeLevel'
    >
  >
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeBooks(
  uid: string,
  onData: (books: Book[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = `users/${uid}/books`;
  const q = query(
    collection(db, 'users', uid, 'books'),
    where('userId', '==', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as Book)
        .sort((a, b) => timestampToMs(b.updatedAt || b.createdAt) - timestampToMs(a.updatedAt || a.createdAt));
      onData(list);
    },
    (error) => reportSnapshotError(error, OperationType.LIST, path, onError)
  );
}

export async function createBookRecord(uid: string, book: Book): Promise<void> {
  const path = `users/${uid}/books/${book.id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'books', book.id), {
      id: book.id,
      userId: uid,
      title: clampStr(book.title || 'كتاب جديد', 240),
      subject: clampStr(book.subject || '', 120),
      gradeLevel: clampStr(book.gradeLevel || '', 80),
      fileType: book.fileType,
      totalPages: Math.max(1, Math.min(5000, Math.round(book.totalPages))),
      lastPage: Math.max(1, Math.round(book.lastPage)),
      completedCount: Math.max(0, Math.round(book.completedCount)),
      analyzedCount: Math.max(0, Math.round(book.analyzedCount)),
      analysisStatus: book.analysisStatus,
      coverImage: clampStr(book.coverImage || '', 350000),
      chapters: (book.chapters || []).slice(0, 150),
      importantTasks: (book.importantTasks || []).slice(0, 200),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateBookMetadata(
  uid: string,
  bookId: string,
  updates: { title?: string; subject?: string; gradeLevel?: string; coverImage?: string }
): Promise<void> {
  const path = `users/${uid}/books/${bookId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.title !== undefined) clean.title = clampStr(updates.title, 240);
    if (updates.subject !== undefined) clean.subject = clampStr(updates.subject, 120);
    if (updates.gradeLevel !== undefined) clean.gradeLevel = clampStr(updates.gradeLevel, 80);
    if (updates.coverImage !== undefined) clean.coverImage = clampStr(updates.coverImage, 350000);
    await updateDoc(doc(db, 'users', uid, 'books', bookId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateBookProgress(
  uid: string,
  bookId: string,
  lastPage: number,
  completedCount?: number
): Promise<void> {
  const path = `users/${uid}/books/${bookId}`;
  try {
    const payload: Record<string, unknown> = {
      lastPage: Math.max(1, Math.round(lastPage)),
      updatedAt: serverTimestamp(),
    };
    if (completedCount !== undefined) {
      payload.completedCount = Math.max(0, Math.round(completedCount));
    }
    await updateDoc(doc(db, 'users', uid, 'books', bookId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateBookAnalysis(
  uid: string,
  bookId: string,
  updates: {
    subject?: string;
    gradeLevel?: string;
    analyzedCount?: number;
    analysisStatus?: Book['analysisStatus'];
    chapters?: Book['chapters'];
    importantTasks?: Book['importantTasks'];
  }
): Promise<void> {
  const path = `users/${uid}/books/${bookId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.subject !== undefined) clean.subject = clampStr(updates.subject, 120);
    if (updates.gradeLevel !== undefined) clean.gradeLevel = clampStr(updates.gradeLevel, 80);
    if (updates.analyzedCount !== undefined) clean.analyzedCount = Math.max(0, Math.round(updates.analyzedCount));
    if (updates.analysisStatus !== undefined) clean.analysisStatus = updates.analysisStatus;
    if (updates.chapters !== undefined) clean.chapters = updates.chapters.slice(0, 150);
    if (updates.importantTasks !== undefined) clean.importantTasks = updates.importantTasks.slice(0, 200);
    await updateDoc(doc(db, 'users', uid, 'books', bookId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function getBookPage(
  uid: string,
  bookId: string,
  pageNumber: number
): Promise<BookPage | null> {
  const pageId = `p_${pageNumber}`;
  const path = `users/${uid}/books/${bookId}/pages/${pageId}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'books', bookId, 'pages', pageId));
    return snap.exists() ? (snap.data() as BookPage) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getBookPagesList(uid: string, bookId: string): Promise<BookPage[]> {
  const path = `users/${uid}/books/${bookId}/pages`;
  try {
    const q = query(
      collection(db, 'users', uid, 'books', bookId, 'pages'),
      where('userId', '==', uid)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as BookPage).sort((a, b) => a.pageNumber - b.pageNumber);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveBookPage(uid: string, bookId: string, page: BookPage): Promise<void> {
  const pageId = `p_${page.pageNumber}`;
  const path = `users/${uid}/books/${bookId}/pages/${pageId}`;
  const ref = doc(db, 'users', uid, 'books', bookId, 'pages', pageId);
  try {
    const existingSnap = await getDoc(ref);
    const safePayload = {
      pageNumber: Math.max(1, Math.round(page.pageNumber)),
      userId: uid,
      bookId,
      printedPageLabel: clampStr(page.printedPageLabel || String(page.pageNumber), 40),
      chapterTitle: clampStr(page.chapterTitle || '', 200),
      imageData: clampStr(page.imageData || '', 750000),
      extractedText: clampStr(page.extractedText || '', 60000),
      concepts: (page.concepts || []).slice(0, 40).map((c) => clampStr(c, 300)),
      diagrams: (page.diagrams || []).slice(0, 30).map((d) => clampStr(d, 300)),
      equations: (page.equations || []).slice(0, 40).map((e) => clampStr(e, 300)),
      difficulty: page.difficulty || 'medium',
      estimatedMinutes: Math.max(1, Math.min(180, Math.round(page.estimatedMinutes || 8))),
      isCompleted: Boolean(page.isCompleted),
      isAnalyzed: Boolean(page.isAnalyzed),
      ocrApplied: Boolean(page.ocrApplied),
      updatedAt: serverTimestamp(),
    };

    if (!existingSnap.exists()) {
      await setDoc(ref, safePayload);
    } else {
      await updateDoc(ref, {
        printedPageLabel: safePayload.printedPageLabel,
        chapterTitle: safePayload.chapterTitle,
        extractedText: safePayload.extractedText,
        concepts: safePayload.concepts,
        diagrams: safePayload.diagrams,
        equations: safePayload.equations,
        difficulty: safePayload.difficulty,
        estimatedMinutes: safePayload.estimatedMinutes,
        isAnalyzed: safePayload.isAnalyzed,
        ocrApplied: safePayload.ocrApplied,
        imageData: safePayload.imageData,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function togglePageCompleted(
  uid: string,
  bookId: string,
  pageNumber: number,
  isCompleted: boolean
): Promise<number> {
  const pageId = `p_${pageNumber}`;
  const path = `users/${uid}/books/${bookId}/pages/${pageId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'books', bookId, 'pages', pageId), {
      isCompleted,
      updatedAt: serverTimestamp(),
    });
    const pages = await getBookPagesList(uid, bookId);
    const completedCount = pages.filter((p) => p.isCompleted).length;
    await updateBookProgress(uid, bookId, pageNumber, completedCount);
    return completedCount;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteBookCascade(uid: string, bookId: string): Promise<void> {
  const path = `users/${uid}/books/${bookId}`;
  try {
    const pagesSnap = await getDocs(
      query(collection(db, 'users', uid, 'books', bookId, 'pages'), where('userId', '==', uid))
    );
    const msgsSnap = await getDocs(
      query(collection(db, 'users', uid, 'books', bookId, 'messages'), where('userId', '==', uid))
    );
    const allRefs = [...pagesSnap.docs.map((d) => d.ref), ...msgsSnap.docs.map((d) => d.ref)];
    for (let i = 0; i < allRefs.length; i += 400) {
      const batch = writeBatch(db);
      allRefs.slice(i, i + 400).forEach((r) => batch.delete(r));
      await batch.commit();
    }
    await deleteDoc(doc(db, 'users', uid, 'books', bookId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Notes
export function subscribeNotes(
  uid: string,
  onData: (notes: Note[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = `users/${uid}/notes`;
  const q = query(
    collection(db, 'users', uid, 'notes'),
    where('userId', '==', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as Note)
        .sort((a, b) => timestampToMs(b.updatedAt || b.createdAt) - timestampToMs(a.updatedAt || a.createdAt));
      onData(list);
    },
    (error) => reportSnapshotError(error, OperationType.LIST, path, onError)
  );
}

export async function createNote(uid: string, note: Omit<Note, 'id' | 'userId'>): Promise<string> {
  const id = makeSafeId('nt');
  const path = `users/${uid}/notes/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'notes', id), {
      id,
      userId: uid,
      bookId: note.bookId,
      bookTitle: clampStr(note.bookTitle, 240),
      chapterTitle: clampStr(note.chapterTitle || '', 200),
      pageNumber: Math.max(1, Math.round(note.pageNumber)),
      noteType: note.noteType,
      title: clampStr(note.title || 'ملاحظة دراسية', 200),
      selectedText: clampStr(note.selectedText || '', 4000),
      content: clampStr(note.content || ' ', 20000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateNoteContent(
  uid: string,
  noteId: string,
  title: string,
  content: string
): Promise<void> {
  const path = `users/${uid}/notes/${noteId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'notes', noteId), {
      title: clampStr(title, 200),
      content: clampStr(content, 20000),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteNoteRecord(uid: string, noteId: string): Promise<void> {
  const path = `users/${uid}/notes/${noteId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'notes', noteId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Chat Messages
export function subscribeBookChat(
  uid: string,
  bookId: string,
  onData: (messages: ChatMessage[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = `users/${uid}/books/${bookId}/messages`;
  const q = query(
    collection(db, 'users', uid, 'books', bookId, 'messages'),
    where('userId', '==', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as ChatMessage)
        .sort((a, b) => timestampToMs(a.createdAt) - timestampToMs(b.createdAt));
      onData(list);
    },
    (error) => reportSnapshotError(error, OperationType.LIST, path, onError)
  );
}

export async function saveBookChatMessage(
  uid: string,
  bookId: string,
  msg: Omit<ChatMessage, 'id' | 'userId' | 'bookId'>
): Promise<string> {
  const id = makeSafeId('msg');
  const path = `users/${uid}/books/${bookId}/messages/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'books', bookId, 'messages', id), {
      id,
      userId: uid,
      bookId,
      role: msg.role,
      text: clampStr(msg.text || ' ', 24000),
      pageNumber: Math.max(1, Math.round(msg.pageNumber)),
      chapterTitle: clampStr(msg.chapterTitle || '', 200),
      selectedText: clampStr(msg.selectedText || '', 4000),
      createdAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// Study Plans
export function subscribeStudyPlans(
  uid: string,
  onData: (plans: StudyPlan[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = `users/${uid}/studyPlans`;
  const q = query(
    collection(db, 'users', uid, 'studyPlans'),
    where('userId', '==', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as StudyPlan)
        .sort((a, b) => timestampToMs(b.updatedAt || b.createdAt) - timestampToMs(a.updatedAt || a.createdAt));
      onData(list);
    },
    (error) => reportSnapshotError(error, OperationType.LIST, path, onError)
  );
}

export function subscribeStudyTasks(
  uid: string,
  planId: string,
  onData: (tasks: StudyTask[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = `users/${uid}/studyPlans/${planId}/tasks`;
  const q = query(
    collection(db, 'users', uid, 'studyPlans', planId, 'tasks'),
    where('userId', '==', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as StudyTask)
        .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
      onData(list);
    },
    (error) => reportSnapshotError(error, OperationType.LIST, path, onError)
  );
}

export async function createStudyPlanWithTasks(
  uid: string,
  plan: Omit<StudyPlan, 'id' | 'userId'>,
  tasks: Omit<StudyTask, 'id' | 'userId' | 'planId'>[]
): Promise<string> {
  const planId = makeSafeId('pln');
  const path = `users/${uid}/studyPlans/${planId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'studyPlans', planId), {
      id: planId,
      userId: uid,
      title: clampStr(plan.title, 200),
      startDate: clampStr(plan.startDate, 20),
      examDate: clampStr(plan.examDate, 20),
      dailyHours: Math.max(0.5, Math.min(16, plan.dailyHours)),
      availableDays: (plan.availableDays || []).slice(0, 7),
      hardSubjects: (plan.hardSubjects || []).slice(0, 20),
      studyMode: plan.studyMode,
      bookIds: (plan.bookIds || []).slice(0, 30),
      totalTasks: tasks.length,
      completedTasks: 0,
      adviceMessage: clampStr(plan.adviceMessage || '', 4000),
      status: plan.status || 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (let i = 0; i < tasks.length; i += 350) {
      const batch = writeBatch(db);
      tasks.slice(i, i + 350).forEach((t, idx) => {
        const taskId = makeSafeId(`tsk${i + idx}`);
        const tRef = doc(db, 'users', uid, 'studyPlans', planId, 'tasks', taskId);
        batch.set(tRef, {
          id: taskId,
          userId: uid,
          planId,
          date: clampStr(t.date, 20),
          bookId: t.bookId,
          bookTitle: clampStr(t.bookTitle, 240),
          subject: clampStr(t.subject || '', 120),
          chapterTitle: clampStr(t.chapterTitle || '', 200),
          startPage: Math.max(1, Math.round(t.startPage)),
          endPage: Math.max(Math.max(1, Math.round(t.startPage)), Math.round(t.endPage)),
          estimatedMinutes: Math.max(5, Math.min(600, Math.round(t.estimatedMinutes))),
          actualMinutes: Math.max(0, Math.round(t.actualMinutes || 0)),
          taskType: t.taskType,
          difficulty: t.difficulty || 'medium',
          status: t.status || 'pending',
          orderIndex: i + idx,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }
    return planId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateStudyTaskStatus(
  uid: string,
  planId: string,
  taskId: string,
  updates: { status?: StudyTask['status']; actualMinutes?: number; date?: string; estimatedMinutes?: number; orderIndex?: number },
  newCompletedTasksCount?: number
): Promise<void> {
  const path = `users/${uid}/studyPlans/${planId}/tasks/${taskId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'studyPlans', planId, 'tasks', taskId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    if (newCompletedTasksCount !== undefined) {
      await updateDoc(doc(db, 'users', uid, 'studyPlans', planId), {
        completedTasks: Math.max(0, newCompletedTasksCount),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteStudyPlanCascade(uid: string, planId: string): Promise<void> {
  const path = `users/${uid}/studyPlans/${planId}`;
  try {
    const tasksSnap = await getDocs(
      query(collection(db, 'users', uid, 'studyPlans', planId, 'tasks'), where('userId', '==', uid))
    );
    for (let i = 0; i < tasksSnap.docs.length; i += 400) {
      const batch = writeBatch(db);
      tasksSnap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(db, 'users', uid, 'studyPlans', planId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Exams
export function subscribeExams(
  uid: string,
  onData: (exams: Exam[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = `users/${uid}/exams`;
  const q = query(
    collection(db, 'users', uid, 'exams'),
    where('userId', '==', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as Exam)
        .sort((a, b) => timestampToMs(b.createdAt || b.updatedAt) - timestampToMs(a.createdAt || a.updatedAt));
      onData(list);
    },
    (error) => reportSnapshotError(error, OperationType.LIST, path, onError)
  );
}

export async function createExamWithQuestions(
  uid: string,
  exam: Omit<Exam, 'id' | 'userId'>,
  questions: Omit<ExamQuestion, 'id' | 'userId' | 'examId'>[]
): Promise<{ examId: string; questions: ExamQuestion[] }> {
  const examId = makeSafeId('exm');
  const path = `users/${uid}/exams/${examId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'exams', examId), {
      id: examId,
      userId: uid,
      bookId: exam.bookId,
      bookTitle: clampStr(exam.bookTitle, 240),
      scopeLabel: clampStr(exam.scopeLabel, 240),
      startPage: Math.max(1, Math.round(exam.startPage)),
      endPage: Math.max(1, Math.round(exam.endPage)),
      mode: exam.mode,
      difficulty: exam.difficulty,
      selectionStrategy: exam.selectionStrategy,
      evaluationMode: exam.evaluationMode,
      durationMinutes: Math.max(0, Math.min(300, Math.round(exam.durationMinutes || 0))),
      totalQuestions: questions.length,
      score: 0,
      status: 'in_progress',
      weakTopics: [],
      coverageWarning: clampStr(exam.coverageWarning || '', 500),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const createdQuestions: ExamQuestion[] = [];
    const batch = writeBatch(db);
    questions.slice(0, 100).forEach((qItem, idx) => {
      const qId = makeSafeId(`q${idx}`);
      const qDoc: ExamQuestion = {
        id: qId,
        userId: uid,
        examId,
        orderIndex: idx,
        questionType: qItem.questionType,
        prompt: clampStr(qItem.prompt, 4000),
        options: (qItem.options || []).slice(0, 10).map((o) => clampStr(o, 500)),
        correctAnswer: clampStr(qItem.correctAnswer, 4000),
        studentAnswer: '',
        transcript: '',
        isCorrect: false,
        earnedPoints: 0,
        maxPoints: Math.max(1, Math.min(100, qItem.maxPoints || 10)),
        mistakeReason: '',
        explanation: clampStr(qItem.explanation || '', 4000),
        sourcePage: Math.max(1, Math.round(qItem.sourcePage)),
        topicTitle: clampStr(qItem.topicTitle || '', 200),
      };
      createdQuestions.push(qDoc);
      batch.set(doc(db, 'users', uid, 'exams', examId, 'questions', qId), {
        ...qDoc,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
    return { examId, questions: createdQuestions };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function getExamQuestions(uid: string, examId: string): Promise<ExamQuestion[]> {
  const path = `users/${uid}/exams/${examId}/questions`;
  try {
    const q = query(
      collection(db, 'users', uid, 'exams', examId, 'questions'),
      where('userId', '==', uid)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as ExamQuestion)
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function updateExamQuestionResult(
  uid: string,
  examId: string,
  questionId: string,
  updates: {
    studentAnswer?: string;
    transcript?: string;
    isCorrect?: boolean;
    earnedPoints?: number;
    mistakeReason?: string;
    explanation?: string;
  }
): Promise<void> {
  const path = `users/${uid}/exams/${examId}/questions/${questionId}`;
  try {
    const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.studentAnswer !== undefined) clean.studentAnswer = clampStr(updates.studentAnswer, 4000);
    if (updates.transcript !== undefined) clean.transcript = clampStr(updates.transcript, 4000);
    if (updates.isCorrect !== undefined) clean.isCorrect = updates.isCorrect;
    if (updates.earnedPoints !== undefined) clean.earnedPoints = updates.earnedPoints;
    if (updates.mistakeReason !== undefined) clean.mistakeReason = clampStr(updates.mistakeReason, 2000);
    if (updates.explanation !== undefined) clean.explanation = clampStr(updates.explanation, 4000);
    await updateDoc(doc(db, 'users', uid, 'exams', examId, 'questions', questionId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function completeExamRecord(
  uid: string,
  examId: string,
  score: number,
  weakTopics: string[]
): Promise<void> {
  const path = `users/${uid}/exams/${examId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'exams', examId), {
      score: Math.max(0, Math.min(100, Math.round(score * 10) / 10)),
      status: 'completed',
      weakTopics: weakTopics.slice(0, 30).map((t) => clampStr(t, 200)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// Real School Class Grades (سجل درجات الصف)
export function subscribeSchoolGrades(
  uid: string,
  onData: (grades: SchoolGrade[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = `users/${uid}/schoolGrades`;
  const q = query(
    collection(db, 'users', uid, 'schoolGrades'),
    where('userId', '==', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as SchoolGrade)
        .sort((a, b) => {
          const dateCmp = (b.examDate || '').localeCompare(a.examDate || '');
          if (dateCmp !== 0) return dateCmp;
          return timestampToMs(b.createdAt) - timestampToMs(a.createdAt);
        });
      onData(list);
    },
    (error) => reportSnapshotError(error, OperationType.LIST, path, onError)
  );
}

export async function createSchoolGrade(
  uid: string,
  grade: Omit<SchoolGrade, 'id' | 'userId' | 'percentage' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = makeSafeId('grd');
  const path = `users/${uid}/schoolGrades/${id}`;
  const safeMax = Math.max(1, Math.min(1000, Number(grade.maxScore) || 100));
  const safeScore = Math.max(0, Math.min(safeMax, Number(grade.score) || 0));
  const percentage = Math.round((safeScore / safeMax) * 1000) / 10;

  try {
    const payload: Record<string, unknown> = {
      id,
      userId: uid,
      subject: clampStr(grade.subject.trim() || 'مادة عامة', 120),
      examType: grade.examType,
      examLabel: clampStr(grade.examLabel.trim() || 'تقييم مدرسي', 160),
      score: safeScore,
      maxScore: safeMax,
      percentage,
      chapterOrTopic: clampStr(grade.chapterOrTopic?.trim() || '', 200),
      examDate: clampStr(grade.examDate || new Date().toISOString().slice(0, 10), 20),
      notes: clampStr(grade.notes?.trim() || '', 1000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (grade.bookId && /^[a-zA-Z0-9_-]+$/.test(grade.bookId)) {
      payload.bookId = grade.bookId;
    }
    await setDoc(doc(db, 'users', uid, 'schoolGrades', id), payload);
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSchoolGrade(
  uid: string,
  gradeId: string,
  updates: Omit<SchoolGrade, 'id' | 'userId' | 'percentage' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  const path = `users/${uid}/schoolGrades/${gradeId}`;
  const safeMax = Math.max(1, Math.min(1000, Number(updates.maxScore) || 100));
  const safeScore = Math.max(0, Math.min(safeMax, Number(updates.score) || 0));
  const percentage = Math.round((safeScore / safeMax) * 1000) / 10;

  try {
    const clean: Record<string, unknown> = {
      subject: clampStr(updates.subject.trim() || 'مادة عامة', 120),
      examType: updates.examType,
      examLabel: clampStr(updates.examLabel.trim() || 'تقييم مدرسي', 160),
      score: safeScore,
      maxScore: safeMax,
      percentage,
      chapterOrTopic: clampStr(updates.chapterOrTopic?.trim() || '', 200),
      examDate: clampStr(updates.examDate || new Date().toISOString().slice(0, 10), 20),
      notes: clampStr(updates.notes?.trim() || '', 1000),
      updatedAt: serverTimestamp(),
    };
    if (updates.bookId && /^[a-zA-Z0-9_-]+$/.test(updates.bookId)) {
      clean.bookId = updates.bookId;
    } else {
      clean.bookId = deleteField();
    }
    await updateDoc(doc(db, 'users', uid, 'schoolGrades', gradeId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteSchoolGrade(uid: string, gradeId: string): Promise<void> {
  const path = `users/${uid}/schoolGrades/${gradeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'schoolGrades', gradeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function deleteAllUserDataAndAccount(user: User): Promise<void> {
  const uid = user.uid;
  const booksSnap = await getDocs(
    query(collection(db, 'users', uid, 'books'), where('userId', '==', uid))
  );
  for (const b of booksSnap.docs) {
    await deleteBookCascade(uid, b.id);
  }
  const notesSnap = await getDocs(
    query(collection(db, 'users', uid, 'notes'), where('userId', '==', uid))
  );
  for (const n of notesSnap.docs) {
    await deleteNoteRecord(uid, n.id);
  }
  const plansSnap = await getDocs(
    query(collection(db, 'users', uid, 'studyPlans'), where('userId', '==', uid))
  );
  for (const p of plansSnap.docs) {
    await deleteStudyPlanCascade(uid, p.id);
  }
  const gradesSnap = await getDocs(
    query(collection(db, 'users', uid, 'schoolGrades'), where('userId', '==', uid))
  );
  for (const g of gradesSnap.docs) {
    await deleteSchoolGrade(uid, g.id);
  }
  const examsSnap = await getDocs(
    query(collection(db, 'users', uid, 'exams'), where('userId', '==', uid))
  );
  for (const e of examsSnap.docs) {
    const qsSnap = await getDocs(
      query(collection(db, 'users', uid, 'exams', e.id, 'questions'), where('userId', '==', uid))
    );
    const batch = writeBatch(db);
    qsSnap.docs.forEach((qd) => batch.delete(qd.ref));
    await batch.commit();
    await deleteDoc(e.ref);
  }
  await deleteDoc(doc(db, 'users', uid));
  await deleteUser(user);
}
