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
import { cacheBookPage, getCachedBookPage } from './localCache';

export const GUEST_UID = 'guest_local';
const STORAGE_KEY = 'smart_tutor_guest_store_v1';

interface GuestDbShape {
  profile: UserProfile;
  books: Book[];
  pagesMeta: Record<string, Record<string, BookPage>>;
  chats: Record<string, ChatMessage[]>;
  notes: Note[];
  plans: StudyPlan[];
  planTasks: Record<string, StudyTask[]>;
  exams: Exam[];
  examQuestions: Record<string, ExamQuestion[]>;
  schoolGrades: SchoolGrade[];
}

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function defaultGuestProfile(): UserProfile {
  return {
    uid: GUEST_UID,
    displayName: 'زائر المعلم الذكي',
    email: 'دخول مفتوح بدون حساب',
    photoURL: '',
    tutorLanguage: 'ar-msa',
    theme: 'light',
    fontSize: 18,
    speechRate: 1.0,
    voiceName: 'Zephyr',
    gradeLevel: '',
  };
}

function defaultGuestDb(): GuestDbShape {
  return {
    profile: defaultGuestProfile(),
    books: [],
    pagesMeta: {},
    chats: {},
    notes: [],
    plans: [],
    planTasks: {},
    exams: [],
    examQuestions: {},
    schoolGrades: [],
  };
}

function loadGuestDb(): GuestDbShape {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultGuestDb();
    const parsed = JSON.parse(raw) as Partial<GuestDbShape>;
    return {
      ...defaultGuestDb(),
      ...parsed,
      profile: {
        ...defaultGuestProfile(),
        ...(parsed.profile || {}),
        uid: GUEST_UID,
      },
      books: Array.isArray(parsed.books) ? parsed.books : [],
      pagesMeta: parsed.pagesMeta || {},
      chats: parsed.chats || {},
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      plans: Array.isArray(parsed.plans) ? parsed.plans : [],
      planTasks: parsed.planTasks || {},
      exams: Array.isArray(parsed.exams) ? parsed.exams : [],
      examQuestions: parsed.examQuestions || {},
      schoolGrades: Array.isArray(parsed.schoolGrades) ? parsed.schoolGrades : [],
    };
  } catch {
    return defaultGuestDb();
  }
}

function saveGuestDb(db: GuestDbShape): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Ignore storage quota errors; IndexedDB still holds page images and raw PDFs
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();
function emitChange() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignore subscriber errors
    }
  });
}

function subscribeChannel(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getOrCreateGuestProfile(): UserProfile {
  const db = loadGuestDb();
  if (!window.localStorage.getItem(STORAGE_KEY)) {
    saveGuestDb(db);
  }
  return db.profile;
}

export function updateGuestProfile(
  updates: Partial<
    Pick<
      UserProfile,
      'displayName' | 'photoURL' | 'tutorLanguage' | 'theme' | 'fontSize' | 'speechRate' | 'voiceName' | 'gradeLevel'
    >
  >
): void {
  const db = loadGuestDb();
  db.profile = { ...db.profile, ...updates, uid: GUEST_UID };
  saveGuestDb(db);
  emitChange();
}

export function subscribeGuestBooks(onData: (books: Book[]) => void): () => void {
  const push = () => onData([...loadGuestDb().books]);
  push();
  return subscribeChannel(push);
}

export function createGuestBook(book: Book): void {
  const db = loadGuestDb();
  const cleanBook: Book = {
    ...book,
    userId: GUEST_UID,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db.books = [cleanBook, ...db.books.filter((b) => b.id !== book.id)];
  saveGuestDb(db);
  emitChange();
}

export function updateGuestBookMetadata(
  bookId: string,
  updates: { title?: string; subject?: string; gradeLevel?: string; coverImage?: string }
): void {
  const db = loadGuestDb();
  db.books = db.books.map((b) =>
    b.id === bookId ? { ...b, ...updates, updatedAt: Date.now() } : b
  );
  saveGuestDb(db);
  emitChange();
}

export function updateGuestBookProgress(
  bookId: string,
  lastPage: number,
  completedCount?: number
): void {
  const db = loadGuestDb();
  db.books = db.books.map((b) =>
    b.id === bookId
      ? {
          ...b,
          lastPage: Math.max(1, Math.round(lastPage)),
          ...(completedCount !== undefined ? { completedCount: Math.max(0, Math.round(completedCount)) } : {}),
          updatedAt: Date.now(),
        }
      : b
  );
  saveGuestDb(db);
  emitChange();
}

export function updateGuestBookAnalysis(
  bookId: string,
  updates: {
    subject?: string;
    gradeLevel?: string;
    analyzedCount?: number;
    analysisStatus?: Book['analysisStatus'];
    chapters?: Book['chapters'];
    importantTasks?: Book['importantTasks'];
  }
): void {
  const db = loadGuestDb();
  db.books = db.books.map((b) =>
    b.id === bookId ? { ...b, ...updates, updatedAt: Date.now() } : b
  );
  saveGuestDb(db);
  emitChange();
}

export async function getGuestBookPage(bookId: string, pageNumber: number): Promise<BookPage | null> {
  const cached = await getCachedBookPage(GUEST_UID, bookId, pageNumber);
  if (cached) return cached;
  const db = loadGuestDb();
  return db.pagesMeta[bookId]?.[String(pageNumber)] || null;
}

export async function saveGuestBookPage(bookId: string, page: BookPage): Promise<void> {
  const fullPage: BookPage = { ...page, userId: GUEST_UID, bookId };
  await cacheBookPage(GUEST_UID, bookId, fullPage);
  const db = loadGuestDb();
  if (!db.pagesMeta[bookId]) db.pagesMeta[bookId] = {};
  // Strip large imageData in localStorage copy (IndexedDB stores imageData cleanly)
  db.pagesMeta[bookId][String(page.pageNumber)] = {
    ...fullPage,
    imageData: undefined,
  };
  saveGuestDb(db);
}

export async function toggleGuestPageCompleted(
  bookId: string,
  pageNumber: number,
  isCompleted: boolean
): Promise<number> {
  const db = loadGuestDb();
  if (!db.pagesMeta[bookId]) db.pagesMeta[bookId] = {};
  const existing =
    db.pagesMeta[bookId][String(pageNumber)] ||
    (await getCachedBookPage(GUEST_UID, bookId, pageNumber)) || {
      pageNumber,
      userId: GUEST_UID,
      bookId,
      printedPageLabel: String(pageNumber),
      chapterTitle: '',
      extractedText: '',
      isCompleted: false,
      isAnalyzed: false,
      ocrApplied: false,
    };
  const updated: BookPage = { ...existing, isCompleted };
  await cacheBookPage(GUEST_UID, bookId, updated);
  db.pagesMeta[bookId][String(pageNumber)] = { ...updated, imageData: undefined };
  const completedCount = Object.values(db.pagesMeta[bookId]).filter((p) => p.isCompleted).length;
  db.books = db.books.map((b) =>
    b.id === bookId ? { ...b, lastPage: pageNumber, completedCount, updatedAt: Date.now() } : b
  );
  saveGuestDb(db);
  emitChange();
  return completedCount;
}

export function deleteGuestBookCascade(bookId: string): void {
  const db = loadGuestDb();
  db.books = db.books.filter((b) => b.id !== bookId);
  delete db.pagesMeta[bookId];
  delete db.chats[bookId];
  saveGuestDb(db);
  emitChange();
}

export function subscribeGuestNotes(onData: (notes: Note[]) => void): () => void {
  const push = () => onData([...loadGuestDb().notes]);
  push();
  return subscribeChannel(push);
}

export function createGuestNote(note: Omit<Note, 'id' | 'userId'>): string {
  const id = makeId('nt');
  const db = loadGuestDb();
  db.notes = [{ ...note, id, userId: GUEST_UID, createdAt: Date.now(), updatedAt: Date.now() }, ...db.notes];
  saveGuestDb(db);
  emitChange();
  return id;
}

export function updateGuestNoteContent(noteId: string, title: string, content: string): void {
  const db = loadGuestDb();
  db.notes = db.notes.map((n) =>
    n.id === noteId ? { ...n, title, content, updatedAt: Date.now() } : n
  );
  saveGuestDb(db);
  emitChange();
}

export function deleteGuestNoteRecord(noteId: string): void {
  const db = loadGuestDb();
  db.notes = db.notes.filter((n) => n.id !== noteId);
  saveGuestDb(db);
  emitChange();
}

export function subscribeGuestBookChat(
  bookId: string,
  onData: (messages: ChatMessage[]) => void
): () => void {
  const push = () => onData([...(loadGuestDb().chats[bookId] || [])]);
  push();
  return subscribeChannel(push);
}

export function saveGuestBookChatMessage(
  bookId: string,
  msg: Omit<ChatMessage, 'id' | 'userId' | 'bookId'>
): string {
  const id = makeId('msg');
  const db = loadGuestDb();
  const list = db.chats[bookId] || [];
  list.push({ ...msg, id, userId: GUEST_UID, bookId, createdAt: Date.now() });
  db.chats[bookId] = list.slice(-120);
  saveGuestDb(db);
  emitChange();
  return id;
}

export function subscribeGuestStudyPlans(onData: (plans: StudyPlan[]) => void): () => void {
  const push = () => onData([...loadGuestDb().plans]);
  push();
  return subscribeChannel(push);
}

export function subscribeGuestStudyTasks(
  planId: string,
  onData: (tasks: StudyTask[]) => void
): () => void {
  const push = () => onData([...(loadGuestDb().planTasks[planId] || [])]);
  push();
  return subscribeChannel(push);
}

export function createGuestStudyPlanWithTasks(
  plan: Omit<StudyPlan, 'id' | 'userId'>,
  tasks: Omit<StudyTask, 'id' | 'userId' | 'planId'>[]
): string {
  const planId = makeId('pln');
  const db = loadGuestDb();
  db.plans = [
    { ...plan, id: planId, userId: GUEST_UID, createdAt: Date.now(), updatedAt: Date.now() },
    ...db.plans,
  ];
  db.planTasks[planId] = tasks.map((t, idx) => ({
    ...t,
    id: makeId(`tsk${idx}`),
    userId: GUEST_UID,
    planId,
    orderIndex: idx,
  }));
  saveGuestDb(db);
  emitChange();
  return planId;
}

export function updateGuestStudyTaskStatus(
  planId: string,
  taskId: string,
  updates: {
    status?: StudyTask['status'];
    actualMinutes?: number;
    date?: string;
    estimatedMinutes?: number;
    orderIndex?: number;
  },
  newCompletedTasksCount?: number
): void {
  const db = loadGuestDb();
  db.planTasks[planId] = (db.planTasks[planId] || []).map((t) =>
    t.id === taskId ? { ...t, ...updates } : t
  );
  if (newCompletedTasksCount !== undefined) {
    db.plans = db.plans.map((p) =>
      p.id === planId ? { ...p, completedTasks: Math.max(0, newCompletedTasksCount), updatedAt: Date.now() } : p
    );
  }
  saveGuestDb(db);
  emitChange();
}

export function deleteGuestStudyPlanCascade(planId: string): void {
  const db = loadGuestDb();
  db.plans = db.plans.filter((p) => p.id !== planId);
  delete db.planTasks[planId];
  saveGuestDb(db);
  emitChange();
}

export function subscribeGuestExams(onData: (exams: Exam[]) => void): () => void {
  const push = () => onData([...loadGuestDb().exams]);
  push();
  return subscribeChannel(push);
}

export function createGuestExamWithQuestions(
  exam: Omit<Exam, 'id' | 'userId'>,
  questions: Omit<ExamQuestion, 'id' | 'userId' | 'examId'>[]
): { examId: string; questions: ExamQuestion[] } {
  const examId = makeId('exm');
  const db = loadGuestDb();
  db.exams = [
    { ...exam, id: examId, userId: GUEST_UID, createdAt: Date.now(), updatedAt: Date.now() },
    ...db.exams,
  ];
  const createdQuestions: ExamQuestion[] = questions.slice(0, 100).map((qItem, idx) => ({
    id: makeId(`q${idx}`),
    userId: GUEST_UID,
    examId,
    orderIndex: idx,
    questionType: qItem.questionType,
    prompt: qItem.prompt,
    options: qItem.options || [],
    correctAnswer: qItem.correctAnswer,
    studentAnswer: '',
    transcript: '',
    isCorrect: false,
    earnedPoints: 0,
    maxPoints: qItem.maxPoints || 10,
    mistakeReason: '',
    explanation: qItem.explanation || '',
    sourcePage: qItem.sourcePage,
    topicTitle: qItem.topicTitle || '',
  }));
  db.examQuestions[examId] = createdQuestions;
  saveGuestDb(db);
  emitChange();
  return { examId, questions: createdQuestions };
}

export function getGuestExamQuestions(examId: string): ExamQuestion[] {
  return [...(loadGuestDb().examQuestions[examId] || [])].sort(
    (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)
  );
}

export function updateGuestExamQuestionResult(
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
): void {
  const db = loadGuestDb();
  db.examQuestions[examId] = (db.examQuestions[examId] || []).map((q) =>
    q.id === questionId ? { ...q, ...updates } : q
  );
  saveGuestDb(db);
}

export function completeGuestExamRecord(
  examId: string,
  score: number,
  weakTopics: string[]
): void {
  const db = loadGuestDb();
  db.exams = db.exams.map((ex) =>
    ex.id === examId
      ? {
          ...ex,
          score: Math.max(0, Math.min(100, Math.round(score * 10) / 10)),
          status: 'completed',
          weakTopics: weakTopics.slice(0, 30),
          updatedAt: Date.now(),
        }
      : ex
  );
  saveGuestDb(db);
  emitChange();
}

export function subscribeGuestSchoolGrades(onData: (grades: SchoolGrade[]) => void): () => void {
  const push = () => onData([...loadGuestDb().schoolGrades]);
  push();
  return subscribeChannel(push);
}

export function createGuestSchoolGrade(
  grade: Omit<SchoolGrade, 'id' | 'userId' | 'percentage' | 'createdAt' | 'updatedAt'>
): string {
  const id = makeId('grd');
  const safeMax = Math.max(1, Math.min(1000, Number(grade.maxScore) || 100));
  const safeScore = Math.max(0, Math.min(safeMax, Number(grade.score) || 0));
  const percentage = Math.round((safeScore / safeMax) * 1000) / 10;
  const db = loadGuestDb();
  db.schoolGrades = [
    {
      ...grade,
      id,
      userId: GUEST_UID,
      score: safeScore,
      maxScore: safeMax,
      percentage,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    ...db.schoolGrades,
  ];
  saveGuestDb(db);
  emitChange();
  return id;
}

export function updateGuestSchoolGrade(
  gradeId: string,
  updates: Omit<SchoolGrade, 'id' | 'userId' | 'percentage' | 'createdAt' | 'updatedAt'>
): void {
  const safeMax = Math.max(1, Math.min(1000, Number(updates.maxScore) || 100));
  const safeScore = Math.max(0, Math.min(safeMax, Number(updates.score) || 0));
  const percentage = Math.round((safeScore / safeMax) * 1000) / 10;
  const db = loadGuestDb();
  db.schoolGrades = db.schoolGrades.map((g) =>
    g.id === gradeId
      ? {
          ...g,
          ...updates,
          score: safeScore,
          maxScore: safeMax,
          percentage,
          updatedAt: Date.now(),
        }
      : g
  );
  saveGuestDb(db);
  emitChange();
}

export function deleteGuestSchoolGrade(gradeId: string): void {
  const db = loadGuestDb();
  db.schoolGrades = db.schoolGrades.filter((g) => g.id !== gradeId);
  saveGuestDb(db);
  emitChange();
}

export function clearAllGuestData(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
  emitChange();
}
