export type AppSection = 'library' | 'learn' | 'plan' | 'exam';

export type TutorLanguage = 'ar-msa' | 'ar-iq' | 'en';
export type ThemeMode = 'light' | 'dark';
export type FileType = 'pdf' | 'pptx' | 'image' | 'docx' | 'txt';
export type DifficultyLevel = 'easy' | 'medium' | 'hard';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  tutorLanguage: TutorLanguage;
  theme: ThemeMode;
  fontSize: number;
  speechRate: number;
  voiceName: string;
  gradeLevel: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ChapterItem {
  id: string;
  title: string;
  startPage: number;
  endPage?: number;
  printedStartPage?: string;
  difficulty?: DifficultyLevel;
  estimatedMinutes?: number;
  topics?: string[];
}

export interface ImportantTaskItem {
  id: string;
  title: string;
  type: 'definition' | 'reasoning' | 'concept' | 'diagram' | 'equation';
  pageNumber: number;
  summary: string;
}

export interface Book {
  id: string;
  userId: string;
  title: string;
  subject: string;
  gradeLevel: string;
  fileType: FileType;
  totalPages: number;
  lastPage: number;
  completedCount: number;
  analyzedCount: number;
  analysisStatus: 'pending' | 'analyzing' | 'ready' | 'partial' | 'error';
  coverImage?: string;
  chapters: ChapterItem[];
  importantTasks: ImportantTaskItem[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BookPage {
  pageNumber: number;
  userId: string;
  bookId: string;
  printedPageLabel?: string;
  chapterTitle?: string;
  imageData?: string;
  extractedText: string;
  concepts?: string[];
  diagrams?: string[];
  equations?: string[];
  difficulty?: DifficultyLevel;
  estimatedMinutes?: number;
  isCompleted: boolean;
  isAnalyzed: boolean;
  ocrApplied?: boolean;
  updatedAt?: unknown;
}

export interface Note {
  id: string;
  userId: string;
  bookId: string;
  bookTitle: string;
  chapterTitle?: string;
  pageNumber: number;
  noteType: 'selection' | 'explanation' | 'diagram' | 'manual';
  title: string;
  selectedText?: string;
  content: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ChatMessage {
  id: string;
  userId: string;
  bookId: string;
  role: 'user' | 'assistant';
  text: string;
  pageNumber: number;
  chapterTitle?: string;
  selectedText?: string;
  createdAt?: unknown;
}

export interface StudyPlan {
  id: string;
  userId: string;
  title: string;
  startDate: string;
  examDate: string;
  dailyHours: number;
  availableDays: string[];
  hardSubjects: string[];
  studyMode: 'new' | 'review' | 'both';
  bookIds: string[];
  totalTasks: number;
  completedTasks: number;
  adviceMessage?: string;
  status: 'active' | 'completed' | 'archived';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudyTask {
  id: string;
  userId: string;
  planId: string;
  date: string;
  bookId: string;
  bookTitle: string;
  subject?: string;
  chapterTitle?: string;
  startPage: number;
  endPage: number;
  estimatedMinutes: number;
  actualMinutes?: number;
  taskType: 'study' | 'review' | 'quiz' | 'rest';
  difficulty?: DifficultyLevel;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  orderIndex: number;
  updatedAt?: unknown;
}

export type QuestionType =
  | 'mcq'
  | 'true_false'
  | 'definition'
  | 'reasoning'
  | 'fill_blank'
  | 'comparison'
  | 'essay'
  | 'math'
  | 'diagram';

export interface Exam {
  id: string;
  userId: string;
  bookId: string;
  bookTitle: string;
  scopeLabel: string;
  startPage: number;
  endPage: number;
  mode: 'written' | 'oral';
  difficulty: DifficultyLevel;
  selectionStrategy: 'comprehensive' | 'important' | 'random';
  evaluationMode: 'practice' | 'exam';
  durationMinutes?: number;
  totalQuestions: number;
  score: number;
  status: 'in_progress' | 'completed';
  weakTopics?: string[];
  coverageWarning?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ExamQuestion {
  id: string;
  userId: string;
  examId: string;
  orderIndex: number;
  questionType: QuestionType;
  prompt: string;
  options?: string[];
  correctAnswer: string;
  studentAnswer?: string;
  transcript?: string;
  isCorrect?: boolean;
  earnedPoints?: number;
  maxPoints: number;
  mistakeReason?: string;
  explanation?: string;
  sourcePage: number;
  topicTitle?: string;
  updatedAt?: unknown;
}

export type LiveConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'speaking'
  | 'paused'
  | 'reconnecting'
  | 'error';

export type SchoolExamType = 'daily' | 'month1' | 'month2' | 'midyear' | 'final' | 'other';

export interface SchoolGrade {
  id: string;
  userId: string;
  subject: string;
  examType: SchoolExamType;
  examLabel: string;
  score: number;
  maxScore: number;
  percentage: number;
  chapterOrTopic?: string;
  bookId?: string;
  examDate: string;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AppActionRequest {
  name: string;
  args: Record<string, unknown>;
}

export interface PageAudioState {
  phase: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  bookId: string | null;
  bookTitle: string;
  pageNumber: number;
  loadPercent: number;
  loadLabel: string;
  duration: number;
  currentTime: number;
  playbackRate: number;
  error: string;
}

