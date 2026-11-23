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

// === سجل الطالب الذكي (Smart Student Record) ===

export type SchoolUserRole = 'admin' | 'counselor' | 'student';
export type SchoolCodeStatus = 'active' | 'revoked' | 'unset';
export type SchoolStudentStatus = 'active' | 'inactive' | 'transferred';
export type GradePeriodId = 'term1' | 'midyear' | 'term2';
export type GradeCellStatus = 'score' | 'blank' | 'absent' | 'exempt';
export type AnnualPursuitScaleMode = 'scale100' | 'raw';

export interface SchoolAnnouncement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  visibility: 'public' | 'internal';
  createdAt: string;
  updatedAt: string;
  authorName: string;
}

export interface SchoolProfile {
  id: string;
  name: string;
  academicYear: string;
  directorate: string;
  logoDataUrl?: string;
  coverDataUrl?: string;
  overview: string;
  vision: string;
  mission: string;
  goals: string[];
  updatedAt: string;
}

export interface SchoolStageGrade {
  id: string;
  name: string;
  orderIndex: number;
}

export interface SchoolSection {
  id: string;
  stageId: string;
  name: string;
  counselorName: string;
  counselorCodeStatus: SchoolCodeStatus;
  counselorCodeUpdatedAt?: string;
  counselorAccessCode?: string;
  orderIndex: number;
}

export interface SchoolStudent {
  id: string;
  sectionId: string;
  fullName: string;
  status: SchoolStudentStatus;
  studentCodeStatus: SchoolCodeStatus;
  studentCodeUpdatedAt?: string;
  studentAccessCode?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SmartImportTarget {
  subjectId: string;
  periodId: GradePeriodId;
  subRecordName: string;
  nonce: number;
}

export interface StudentAbsence {
  id: string;
  sectionId: string;
  studentId: string;
  date: string;
  excuseType: 'excused' | 'unexcused' | 'medical' | 'official';
  subjectName: string;
  notes: string;
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface GradeCellValue {
  status: GradeCellStatus;
  score: number | null;
}

export interface GradeColumn {
  id: string;
  label: string;
  maxScore: number;
  orderIndex: number;
}

export interface CustomSubRecord {
  id: string;
  periodId: 'term1' | 'term2';
  name: string;
  orderIndex: number;
  columns: GradeColumn[];
}

export interface AnnualPursuitConfig {
  term1ColumnIds: string[];
  midyearColumnIds: string[];
  term2ColumnIds: string[];
  scaleMode: AnnualPursuitScaleMode;
}

export interface SubjectGradebook {
  id: string;
  sectionId: string;
  name: string;
  midyearColumns: GradeColumn[];
  subRecords: CustomSubRecord[];
  // Map of `${studentId}::${columnId}` -> GradeCellValue
  cells: Record<string, GradeCellValue>;
  annualPursuitConfig: AnnualPursuitConfig;
  updatedAt: string;
}

export interface ImportBoundingBox {
  id: string;
  label: string;
  role: 'name' | 'score';
  columnOrder: number;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  width: number; // normalized 0..1
  height: number; // normalized 0..1
}

export interface ImportTemplate {
  id: string;
  name: string;
  description: string;
  boxes: ImportBoundingBox[];
  createdAt: string;
}

export interface ImportExtractedCell {
  columnIndex: number;
  rawText: string;
  parsedStatus: GradeCellStatus;
  parsedScore: number | null;
}

export interface ImportExtractedRow {
  rowIndex: number;
  rawNameText: string;
  cells: ImportExtractedCell[];
}

export interface ImportExtractionResult {
  detectedHeaders: { columnIndex: number; label: string; maxScore: number | null }[];
  rows: ImportExtractedRow[];
  warnings: string[];
}

export interface AuditLogEntry {
  id: string;
  actorName: string;
  actorRole: SchoolUserRole | 'system';
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  prevValue: string;
  nextValue: string;
  timestamp: string;
}

export interface SchoolFirebaseSyncMeta {
  linked: boolean;
  projectId: string;
  linkedEmail: string;
  linkedUid: string;
  lastSyncedAt: string;
  lastSyncStatus: 'idle' | 'connected' | 'synced' | 'offline' | 'error';
  lastSyncMessage: string;
}

export interface SchoolSessionUser {
  role: SchoolUserRole;
  displayName: string;
  schoolId?: string;
  ownerEmail?: string;
  sectionId?: string;
  sectionName?: string;
  stageName?: string;
  studentId?: string;
}

export interface SchoolPublicPayload {
  school: SchoolProfile;
  announcements: SchoolAnnouncement[];
  stagesCount: number;
  sectionsCount: number;
  adminCodeConfigured: boolean;
  firebaseSync: SchoolFirebaseSyncMeta;
}

export interface SchoolBackupSummary {
  fileName: string;
  createdAt: string;
  sizeBytes: number;
}

export interface SchoolWorkspacePayload {
  session: SchoolSessionUser;
  school: SchoolProfile;
  announcements: SchoolAnnouncement[];
  stages: SchoolStageGrade[];
  sections: SchoolSection[];
  students: SchoolStudent[];
  absences: StudentAbsence[];
  subjects: SubjectGradebook[];
  templates: ImportTemplate[];
  auditLogs: AuditLogEntry[];
  firebaseSync: SchoolFirebaseSyncMeta;
  backups: SchoolBackupSummary[];
  adminCodeConfigured?: boolean;
}


