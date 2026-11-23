import fs from 'node:fs';
import path from 'node:path';

export type QuotaBucket = 'ai' | 'live';

export interface DailyQuotaCheckResult {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  date: string;
}

export interface DailyQuotaSnapshot {
  date: string;
  ai: { limit: number; used: number; remaining: number };
  live: { limit: number; used: number; remaining: number };
}

export interface DailyAiQuotaOptions {
  storageFilePath?: string | null;
  guestDailyLimit?: number;
  authDailyLimit?: number;
  guestLiveDailyLimit?: number;
  authLiveDailyLimit?: number;
  dateProvider?: () => string;
}

interface PersistedQuotaFile {
  date: string;
  counts: Record<string, number>;
}

function parseLimit(raw: string | undefined, fallback: number, min = 1, max = 5000): number {
  const num = Number(raw);
  if (!Number.isFinite(num) || num < min) return fallback;
  return Math.min(Math.floor(num), max);
}

export function getBaghdadDateString(now = new Date()): string {
  try {
    // en-CA formats reliably as YYYY-MM-DD
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Baghdad',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
      return formatted;
    }
  } catch {
    // Fallback to UTC+3 offset manually if ICU timezone data is unavailable
  }
  const shifted = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export class DailyAiQuotaTracker {
  private readonly storageFilePath: string | null;
  private readonly guestDailyLimit: number;
  private readonly authDailyLimit: number;
  private readonly guestLiveDailyLimit: number;
  private readonly authLiveDailyLimit: number;
  private readonly dateProvider: () => string;

  private activeDate: string;
  private counts = new Map<string, number>();

  constructor(options: DailyAiQuotaOptions = {}) {
    this.storageFilePath = options.storageFilePath === undefined ? null : options.storageFilePath;
    this.guestDailyLimit = options.guestDailyLimit ?? parseLimit(process.env.AI_DAILY_LIMIT_GUEST, 40);
    this.authDailyLimit = options.authDailyLimit ?? parseLimit(process.env.AI_DAILY_LIMIT_AUTH, 80);
    this.guestLiveDailyLimit =
      options.guestLiveDailyLimit ?? parseLimit(process.env.AI_DAILY_LIVE_LIMIT_GUEST, 8);
    this.authLiveDailyLimit =
      options.authLiveDailyLimit ?? parseLimit(process.env.AI_DAILY_LIVE_LIMIT_AUTH, 15);
    this.dateProvider = options.dateProvider ?? (() => getBaghdadDateString());
    this.activeDate = this.dateProvider();
    this.loadFromDisk();
  }

  private getLimit(bucket: QuotaBucket, isGuest: boolean): number {
    if (bucket === 'live') {
      return isGuest ? this.guestLiveDailyLimit : this.authLiveDailyLimit;
    }
    return isGuest ? this.guestDailyLimit : this.authDailyLimit;
  }

  private rolloverIfNeeded(): string {
    const today = this.dateProvider();
    if (today !== this.activeDate) {
      this.activeDate = today;
      this.counts.clear();
      this.saveToDisk();
    }
    return today;
  }

  private loadFromDisk(): void {
    if (!this.storageFilePath) return;
    try {
      if (!fs.existsSync(this.storageFilePath)) return;
      const raw = fs.readFileSync(this.storageFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedQuotaFile>;
      if (parsed && parsed.date === this.activeDate && parsed.counts && typeof parsed.counts === 'object') {
        for (const [k, v] of Object.entries(parsed.counts)) {
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
            this.counts.set(k, Math.floor(v));
          }
        }
      } else if (parsed && parsed.date && parsed.date !== this.activeDate) {
        // Prune stale previous-day data immediately
        this.saveToDisk();
      }
    } catch {
      // Non-fatal: start fresh in memory if quota file is unreadable
    }
  }

  private saveToDisk(): void {
    if (!this.storageFilePath) return;
    try {
      const dir = path.dirname(this.storageFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const payload: PersistedQuotaFile = {
        date: this.activeDate,
        counts: Object.fromEntries(this.counts.entries()),
      };
      const tmpPath = `${this.storageFilePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload), 'utf-8');
      fs.renameSync(tmpPath, this.storageFilePath);
    } catch {
      // Non-fatal: quota still enforced in memory
    }
  }

  private makeBucketKey(bucket: QuotaBucket, subjectKey: string): string {
    return `${bucket}:${subjectKey}`;
  }

  public consume(bucket: QuotaBucket, subjectKey: string, isGuest: boolean): DailyQuotaCheckResult {
    const date = this.rolloverIfNeeded();
    const limit = this.getLimit(bucket, isGuest);
    const key = this.makeBucketKey(bucket, subjectKey);
    const current = this.counts.get(key) ?? 0;

    if (current >= limit) {
      return {
        allowed: false,
        limit,
        used: current,
        remaining: 0,
        date,
      };
    }

    const next = current + 1;
    this.counts.set(key, next);
    this.saveToDisk();

    return {
      allowed: true,
      limit,
      used: next,
      remaining: Math.max(0, limit - next),
      date,
    };
  }

  public peek(subjectKey: string, isGuest: boolean): DailyQuotaSnapshot {
    const date = this.rolloverIfNeeded();
    const aiLimit = this.getLimit('ai', isGuest);
    const liveLimit = this.getLimit('live', isGuest);
    const aiUsed = this.counts.get(this.makeBucketKey('ai', subjectKey)) ?? 0;
    const liveUsed = this.counts.get(this.makeBucketKey('live', subjectKey)) ?? 0;

    return {
      date,
      ai: {
        limit: aiLimit,
        used: aiUsed,
        remaining: Math.max(0, aiLimit - aiUsed),
      },
      live: {
        limit: liveLimit,
        used: liveUsed,
        remaining: Math.max(0, liveLimit - liveUsed),
      },
    };
  }
}
