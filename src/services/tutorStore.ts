import type { User } from 'firebase/auth';
import * as fb from './firebase';
import * as guest from './localGuestStore';
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

export { GUEST_UID } from './localGuestStore';

function isGuest(uid: string): boolean {
  return uid === guest.GUEST_UID;
}

export async function loadOrCreateProfile(user: User | null): Promise<UserProfile> {
  if (!user) return guest.getOrCreateGuestProfile();
  return fb.getOrCreateUserProfile(user);
}

export async function saveUserProfile(
  uid: string,
  updates: Partial<
    Pick<
      UserProfile,
      'displayName' | 'photoURL' | 'tutorLanguage' | 'theme' | 'fontSize' | 'speechRate' | 'voiceName' | 'gradeLevel'
    >
  >
): Promise<void> {
  if (isGuest(uid)) {
    guest.updateGuestProfile(updates);
    return;
  }
  await fb.updateUserProfile(uid, updates);
}

export function subscribeBooks(uid: string, onData: (books: Book[]) => void) {
  return isGuest(uid) ? guest.subscribeGuestBooks(onData) : fb.subscribeBooks(uid, onData);
}

export async function createBookRecord(uid: string, book: Book): Promise<void> {
  if (isGuest(uid)) {
    guest.createGuestBook(book);
    return;
  }
  await fb.createBookRecord(uid, book);
}

export async function updateBookMetadata(
  uid: string,
  bookId: string,
  updates: { title?: string; subject?: string; gradeLevel?: string; coverImage?: string }
): Promise<void> {
  if (isGuest(uid)) {
    guest.updateGuestBookMetadata(bookId, updates);
    return;
  }
  await fb.updateBookMetadata(uid, bookId, updates);
}

export async function updateBookProgress(
  uid: string,
  bookId: string,
  lastPage: number,
  completedCount?: number
): Promise<void> {
  if (isGuest(uid)) {
    guest.updateGuestBookProgress(bookId, lastPage, completedCount);
    return;
  }
  await fb.updateBookProgress(uid, bookId, lastPage, completedCount);
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
  if (isGuest(uid)) {
    guest.updateGuestBookAnalysis(bookId, updates);
    return;
  }
  await fb.updateBookAnalysis(uid, bookId, updates);
}

export async function getBookPage(uid: string, bookId: string, pageNumber: number): Promise<BookPage | null> {
  return isGuest(uid) ? guest.getGuestBookPage(bookId, pageNumber) : fb.getBookPage(uid, bookId, pageNumber);
}

export async function saveBookPage(uid: string, bookId: string, page: BookPage): Promise<void> {
  if (isGuest(uid)) {
    await guest.saveGuestBookPage(bookId, page);
    return;
  }
  await fb.saveBookPage(uid, bookId, page);
}

export async function togglePageCompleted(
  uid: string,
  bookId: string,
  pageNumber: number,
  isCompleted: boolean
): Promise<number> {
  return isGuest(uid)
    ? guest.toggleGuestPageCompleted(bookId, pageNumber, isCompleted)
    : fb.togglePageCompleted(uid, bookId, pageNumber, isCompleted);
}

export async function deleteBookCascade(uid: string, bookId: string): Promise<void> {
  if (isGuest(uid)) {
    guest.deleteGuestBookCascade(bookId);
    return;
  }
  await fb.deleteBookCascade(uid, bookId);
}

export function subscribeNotes(uid: string, onData: (notes: Note[]) => void) {
  return isGuest(uid) ? guest.subscribeGuestNotes(onData) : fb.subscribeNotes(uid, onData);
}

export async function createNote(uid: string, note: Omit<Note, 'id' | 'userId'>): Promise<string> {
  return isGuest(uid) ? guest.createGuestNote(note) : fb.createNote(uid, note);
}

export async function updateNoteContent(uid: string, noteId: string, title: string, content: string): Promise<void> {
  if (isGuest(uid)) {
    guest.updateGuestNoteContent(noteId, title, content);
    return;
  }
  await fb.updateNoteContent(uid, noteId, title, content);
}

export async function deleteNoteRecord(uid: string, noteId: string): Promise<void> {
  if (isGuest(uid)) {
    guest.deleteGuestNoteRecord(noteId);
    return;
  }
  await fb.deleteNoteRecord(uid, noteId);
}

export function subscribeBookChat(uid: string, bookId: string, onData: (messages: ChatMessage[]) => void) {
  return isGuest(uid) ? guest.subscribeGuestBookChat(bookId, onData) : fb.subscribeBookChat(uid, bookId, onData);
}

export async function saveBookChatMessage(
  uid: string,
  bookId: string,
  msg: Omit<ChatMessage, 'id' | 'userId' | 'bookId'>
): Promise<string> {
  return isGuest(uid) ? guest.saveGuestBookChatMessage(bookId, msg) : fb.saveBookChatMessage(uid, bookId, msg);
}

export function subscribeStudyPlans(uid: string, onData: (plans: StudyPlan[]) => void) {
  return isGuest(uid) ? guest.subscribeGuestStudyPlans(onData) : fb.subscribeStudyPlans(uid, onData);
}

export function subscribeStudyTasks(uid: string, planId: string, onData: (tasks: StudyTask[]) => void) {
  return isGuest(uid) ? guest.subscribeGuestStudyTasks(planId, onData) : fb.subscribeStudyTasks(uid, planId, onData);
}

export async function createStudyPlanWithTasks(
  uid: string,
  plan: Omit<StudyPlan, 'id' | 'userId'>,
  tasks: Omit<StudyTask, 'id' | 'userId' | 'planId'>[]
): Promise<string> {
  return isGuest(uid)
    ? guest.createGuestStudyPlanWithTasks(plan, tasks)
    : fb.createStudyPlanWithTasks(uid, plan, tasks);
}

export async function updateStudyTaskStatus(
  uid: string,
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
): Promise<void> {
  if (isGuest(uid)) {
    guest.updateGuestStudyTaskStatus(planId, taskId, updates, newCompletedTasksCount);
    return;
  }
  await fb.updateStudyTaskStatus(uid, planId, taskId, updates, newCompletedTasksCount);
}

export async function deleteStudyPlanCascade(uid: string, planId: string): Promise<void> {
  if (isGuest(uid)) {
    guest.deleteGuestStudyPlanCascade(planId);
    return;
  }
  await fb.deleteStudyPlanCascade(uid, planId);
}

export function subscribeExams(uid: string, onData: (exams: Exam[]) => void) {
  return isGuest(uid) ? guest.subscribeGuestExams(onData) : fb.subscribeExams(uid, onData);
}

export async function createExamWithQuestions(
  uid: string,
  exam: Omit<Exam, 'id' | 'userId'>,
  questions: Omit<ExamQuestion, 'id' | 'userId' | 'examId'>[]
): Promise<{ examId: string; questions: ExamQuestion[] }> {
  return isGuest(uid)
    ? guest.createGuestExamWithQuestions(exam, questions)
    : fb.createExamWithQuestions(uid, exam, questions);
}

export async function getExamQuestions(uid: string, examId: string): Promise<ExamQuestion[]> {
  return isGuest(uid) ? guest.getGuestExamQuestions(examId) : fb.getExamQuestions(uid, examId);
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
  if (isGuest(uid)) {
    guest.updateGuestExamQuestionResult(examId, questionId, updates);
    return;
  }
  await fb.updateExamQuestionResult(uid, examId, questionId, updates);
}

export async function completeExamRecord(
  uid: string,
  examId: string,
  score: number,
  weakTopics: string[]
): Promise<void> {
  if (isGuest(uid)) {
    guest.completeGuestExamRecord(examId, score, weakTopics);
    return;
  }
  await fb.completeExamRecord(uid, examId, score, weakTopics);
}

export function subscribeSchoolGrades(uid: string, onData: (grades: SchoolGrade[]) => void) {
  return isGuest(uid) ? guest.subscribeGuestSchoolGrades(onData) : fb.subscribeSchoolGrades(uid, onData);
}

export async function createSchoolGrade(
  uid: string,
  grade: Omit<SchoolGrade, 'id' | 'userId' | 'percentage' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  return isGuest(uid) ? guest.createGuestSchoolGrade(grade) : fb.createSchoolGrade(uid, grade);
}

export async function updateSchoolGrade(
  uid: string,
  gradeId: string,
  updates: Omit<SchoolGrade, 'id' | 'userId' | 'percentage' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  if (isGuest(uid)) {
    guest.updateGuestSchoolGrade(gradeId, updates);
    return;
  }
  await fb.updateSchoolGrade(uid, gradeId, updates);
}

export async function deleteSchoolGrade(uid: string, gradeId: string): Promise<void> {
  if (isGuest(uid)) {
    guest.deleteGuestSchoolGrade(gradeId);
    return;
  }
  await fb.deleteSchoolGrade(uid, gradeId);
}

export async function deleteAllTutorData(user: User | null): Promise<void> {
  if (!user) {
    guest.clearAllGuestData();
    return;
  }
  await fb.deleteAllUserDataAndAccount(user);
}
