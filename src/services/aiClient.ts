import { auth } from './firebase';
import type { ChapterItem, DifficultyLevel, ImportantTaskItem, TutorLanguage } from '../types';

async function authedPost<T>(endpoint: string, body: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('يرجى تسجيل الدخول أولاً.');
  }
  const token = await user.getIdToken();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'حدث خطأ أثناء الاتصال بالخادم.');
  }
  return data as T;
}

export interface PageAnalysisResult {
  verbatimText?: string;
  printedPageLabel?: string;
  chapterTitle?: string;
  subject?: string;
  gradeLevel?: string;
  concepts?: string[];
  diagrams?: string[];
  equations?: string[];
  difficulty?: DifficultyLevel;
  estimatedMinutes?: number;
  importantTasks?: Omit<ImportantTaskItem, 'id' | 'pageNumber'>[];
}

export function analyzeBookPage(payload: {
  bookTitle: string;
  pageNumber: number;
  extractedText: string;
  pageImage?: string;
  needOcr: boolean;
}) {
  return authedPost<PageAnalysisResult>('/api/ai/analyze-page', payload);
}

export function buildSmartToc(payload: {
  bookTitle: string;
  totalPages: number;
  pageSnippets: { pageNumber: number; snippet: string }[];
}) {
  return authedPost<{
    subject?: string;
    gradeLevel?: string;
    chapters?: (Omit<ChapterItem, 'id'> & { topics?: string[] })[];
  }>('/api/ai/build-toc', payload);
}

export function sendTutorChat(payload: {
  bookTitle: string;
  subject?: string;
  gradeLevel?: string;
  currentPage: number;
  totalPages: number;
  chapterTitle?: string;
  pageText?: string;
  pageImage?: string;
  selectedText?: string;
  selectedImage?: string;
  extraPages?: { pageNumber: number; text?: string; imageData?: string }[];
  chapters?: ChapterItem[];
  history: { role: 'user' | 'assistant'; text: string }[];
  userMessage: string;
  tutorLanguage: TutorLanguage;
  weakSubjects?: string[];
  weakSchoolSummary?: string;
}) {
  return authedPost<{
    reply: string;
    toolCalls: { id?: string; name: string; args: Record<string, unknown> }[];
  }>('/api/ai/chat', payload);
}

export function explainSelection(payload: {
  action: 'explain' | 'example' | 'explain_diagram' | 'explain_page';
  bookTitle: string;
  pageNumber: number;
  chapterTitle?: string;
  pageText?: string;
  selectedText?: string;
  croppedImage?: string;
  pageImage?: string;
  tutorLanguage: TutorLanguage;
}) {
  return authedPost<{ explanation: string }>('/api/ai/explain-selection', payload);
}

export function extractImportantTasks(payload: {
  bookTitle: string;
  scopeLabel: string;
  pages: { pageNumber: number; text?: string; imageData?: string }[];
  tutorLanguage: TutorLanguage;
}) {
  return authedPost<{
    disclaimer?: string;
    items: {
      title: string;
      type: 'definition' | 'reasoning' | 'concept' | 'diagram' | 'equation';
      pageNumber: number;
      summary: string;
    }[];
  }>('/api/ai/extract-tasks', payload);
}

export function generateStudyPlanAI(payload: {
  books: {
    id: string;
    title: string;
    subject: string;
    totalPages: number;
    completedCount: number;
    chapters: { title: string; startPage: number; difficulty?: string; estimatedMinutes?: number }[];
  }[];
  startDate: string;
  examDate: string;
  dailyHours: number;
  availableDays: string[];
  hardSubjects: string[];
  studyMode: 'new' | 'review' | 'both';
  weakTopics?: string[];
  weakSchoolSummary?: string;
}) {
  return authedPost<{
    title: string;
    adviceMessage: string;
    tasks: {
      date: string;
      bookId: string;
      bookTitle: string;
      subject: string;
      chapterTitle: string;
      startPage: number;
      endPage: number;
      estimatedMinutes: number;
      taskType: 'study' | 'review' | 'quiz' | 'rest';
      difficulty: DifficultyLevel;
    }[];
  }>('/api/ai/generate-study-plan', payload);
}

export function rescheduleStudyPlanAI(payload: {
  plan: { examDate: string; dailyHours: number; availableDays: string[] };
  pendingTasks: { id: string; bookTitle: string; chapterTitle?: string; startPage: number; endPage: number; estimatedMinutes: number; taskType: string }[];
  completedSample: { estimatedMinutes: number; actualMinutes?: number; difficulty?: string }[];
  todayDate: string;
  weakTopics: string[];
  weakSchoolSummary?: string;
}) {
  return authedPost<{
    adviceMessage: string;
    updatedTasks: { id: string; date: string; estimatedMinutes: number }[];
  }>('/api/ai/reschedule-plan', payload);
}

export function generateExamAI(payload: {
  bookTitle: string;
  scopeLabel: string;
  pages: { pageNumber: number; text?: string; imageData?: string }[];
  difficulty: DifficultyLevel;
  selectionStrategy: 'comprehensive' | 'important' | 'random';
  questionCount?: number;
  questionTypes: string[];
  weakTopics?: string[];
  weakSchoolSummary?: string;
  tutorLanguage: TutorLanguage;
}) {
  return authedPost<{
    coverageWarning?: string;
    questions: {
      questionType: string;
      prompt: string;
      options?: string[];
      correctAnswer: string;
      explanation: string;
      sourcePage: number;
      topicTitle: string;
      maxPoints: number;
    }[];
  }>('/api/ai/generate-exam', payload);
}

export function gradeExamAI(payload: {
  bookTitle: string;
  questions: {
    id: string;
    questionType: string;
    prompt: string;
    correctAnswer: string;
    studentAnswer: string;
    maxPoints: number;
    sourcePage: number;
    topicTitle?: string;
  }[];
  pages: { pageNumber: number; text: string }[];
  tutorLanguage: TutorLanguage;
}) {
  return authedPost<{
    results: {
      id: string;
      isCorrect: boolean;
      earnedPoints: number;
      mistakeReason: string;
      explanation: string;
    }[];
    weakTopics: string[];
    score: number;
  }>('/api/ai/grade-exam', payload);
}

export function generateTtsAudio(payload: {
  text: string;
  voiceName?: string;
  style?: string;
}) {
  return authedPost<{ audioBase64: string; mimeType: string }>('/api/ai/tts', payload);
}

export function transcribeChatAudio(payload: {
  audioBase64: string;
  mimeType: string;
  tutorLanguage?: TutorLanguage;
}) {
  return authedPost<{ transcript: string }>('/api/ai/transcribe', payload);
}

export function checkSingleQuestionAI(payload: {
  bookTitle: string;
  question: {
    id: string;
    questionType: string;
    prompt: string;
    options?: string[];
    correctAnswer: string;
    explanation?: string;
    studentAnswer: string;
    maxPoints: number;
    sourcePage: number;
  };
  tutorLanguage: TutorLanguage;
}) {
  return authedPost<{
    isCorrect: boolean;
    earnedPoints: number;
    reason: string;
    explanation: string;
  }>('/api/ai/check-question', payload);
}
