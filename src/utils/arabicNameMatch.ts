// Arabic name normalization, numeral parsing, and fuzzy matching utilities
// Used across Smart Sheet Import, server-side validation, and automated tests.

const ARABIC_INDIC_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٫': '.',
  '،': '.',
};

export function normalizeDigits(input: string): string {
  if (!input) return '';
  let out = '';
  for (const ch of input) {
    out += ARABIC_INDIC_MAP[ch] ?? ch;
  }
  return out;
}

export function normalizeArabicName(input: string): string {
  if (!input) return '';
  let s = normalizeDigits(input).trim();
  // Remove Arabic tashkeel / diacritics & tatweel
  s = s.replace(/[\u064B-\u065F\u0670\u0640]/g, '');
  // Normalize alef forms (أ إ آ ٱ -> ا)
  s = s.replace(/[أإآٱ]/g, 'ا');
  // Normalize taa marbuta -> haa (ة -> ه)
  s = s.replace(/ة/g, 'ه');
  // Normalize alef maqsura -> yaa (ى -> ي)
  s = s.replace(/ى/g, 'ي');
  // Normalize hamza on waw/yaa if isolated variants appear
  s = s.replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
  // Normalize whitespace & strip stray punctuation
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  s = s.replace(/\s+/g, ' ').trim().toLowerCase();
  return s;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}

export function computeArabicNameSimilarity(rawA: string, rawB: string): number {
  const a = normalizeArabicName(rawA);
  const b = normalizeArabicName(rawB);
  if (!a || !b) return 0;
  if (a === b) return 100;

  const maxLen = Math.max(a.length, b.length);
  const charSim = maxLen > 0 ? (1 - levenshteinDistance(a, b) / maxLen) * 100 : 0;

  const tokensA = a.split(' ').filter(Boolean);
  const tokensB = b.split(' ').filter(Boolean);
  let tokenMatches = 0;
  for (const ta of tokensA) {
    let bestTokenScore = 0;
    for (const tb of tokensB) {
      if (ta === tb) {
        bestTokenScore = 1;
        break;
      }
      const len = Math.max(ta.length, tb.length);
      const sim = len > 0 ? 1 - levenshteinDistance(ta, tb) / len : 0;
      if (sim > bestTokenScore) bestTokenScore = sim;
    }
    if (bestTokenScore >= 0.78) {
      tokenMatches += bestTokenScore;
    }
  }
  const denom = Math.max(tokensA.length, tokensB.length, 1);
  const tokenSim = (tokenMatches / denom) * 100;

  // Weighted blend favoring exact normalized tokens & overall edit similarity
  const combined = Math.round(Math.max(charSim, tokenSim * 0.7 + charSim * 0.3));
  return Math.max(0, Math.min(100, combined));
}

export interface StudentMatchCandidate {
  id: string;
  fullName: string;
}

export interface StudentMatchResult {
  studentId: string | null;
  matchedName: string | null;
  confidence: number; // 0..100
  needsReview: boolean; // true if < 70% or no match
}

export const MATCH_CONFIDENCE_THRESHOLD = 70;

export function findBestStudentMatch(
  rawName: string,
  students: StudentMatchCandidate[]
): StudentMatchResult {
  const normalized = normalizeArabicName(rawName);
  if (!normalized || students.length === 0) {
    return { studentId: null, matchedName: null, confidence: 0, needsReview: true };
  }

  let best: StudentMatchCandidate | null = null;
  let bestScore = 0;

  for (const st of students) {
    const score = computeArabicNameSimilarity(normalized, st.fullName);
    if (score > bestScore) {
      bestScore = score;
      best = st;
    }
  }

  if (!best || bestScore === 0) {
    return { studentId: null, matchedName: null, confidence: 0, needsReview: true };
  }

  return {
    studentId: best.id,
    matchedName: best.fullName,
    confidence: bestScore,
    needsReview: bestScore < MATCH_CONFIDENCE_THRESHOLD,
  };
}

export function parseRawCellValue(rawText: string): {
  status: 'score' | 'blank' | 'absent' | 'exempt';
  score: number | null;
} {
  const cleaned = normalizeDigits((rawText || '').trim());
  if (!cleaned || cleaned === '-' || cleaned === '—' || cleaned === '_' || cleaned === '.') {
    return { status: 'blank', score: null };
  }
  const lower = cleaned.toLowerCase();
  if (lower === 'غ' || lower.includes('غائب') || lower.includes('غياب') || lower === 'abs' || lower === 'absent') {
    return { status: 'absent', score: null };
  }
  if (lower === 'م' || lower.includes('معفى') || lower.includes('معفي') || lower.includes('اعفاء') || lower === 'exempt') {
    return { status: 'exempt', score: null };
  }
  const numericMatch = cleaned.match(/^-?\d+(?:\.\d+)?$/);
  if (numericMatch) {
    const val = Number(numericMatch[0]);
    if (!Number.isNaN(val) && Number.isFinite(val)) {
      return { status: 'score', score: val };
    }
  }
  return { status: 'blank', score: null };
}
