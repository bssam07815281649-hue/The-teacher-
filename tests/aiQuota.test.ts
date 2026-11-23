import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DailyAiQuotaTracker } from '../server/aiQuota';

test('DailyAiQuotaTracker enforces guest and auth daily limits and resets on day rollover', () => {
  let currentDay = '2026-11-22';
  const tracker = new DailyAiQuotaTracker({
    storageFilePath: null,
    guestDailyLimit: 3,
    authDailyLimit: 5,
    guestLiveDailyLimit: 2,
    authLiveDailyLimit: 4,
    dateProvider: () => currentDay,
  });

  // Guest uses 3 AI requests then gets blocked on 4th
  assert.equal(tracker.consume('ai', 'guest_ip:1.2.3.4', true).remaining, 2);
  assert.equal(tracker.consume('ai', 'guest_ip:1.2.3.4', true).remaining, 1);
  const third = tracker.consume('ai', 'guest_ip:1.2.3.4', true);
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);

  const fourth = tracker.consume('ai', 'guest_ip:1.2.3.4', true);
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.limit, 3);
  assert.equal(fourth.remaining, 0);

  // Separate authenticated user still has full 5-request quota
  const authFirst = tracker.consume('ai', 'uid:user_1', false);
  assert.equal(authFirst.allowed, true);
  assert.equal(authFirst.limit, 5);
  assert.equal(authFirst.remaining, 4);

  // Live bucket is tracked independently from AI bucket
  assert.equal(tracker.consume('live', 'guest_ip:1.2.3.4', true).remaining, 1);
  assert.equal(tracker.consume('live', 'guest_ip:1.2.3.4', true).remaining, 0);
  assert.equal(tracker.consume('live', 'guest_ip:1.2.3.4', true).allowed, false);

  // Rollover to next day restores quotas automatically
  currentDay = '2026-11-23';
  const peeked = tracker.peek('guest_ip:1.2.3.4', true);
  assert.equal(peeked.date, '2026-11-23');
  assert.equal(peeked.ai.used, 0);
  assert.equal(peeked.ai.remaining, 3);
  assert.equal(peeked.live.remaining, 2);
  assert.equal(tracker.consume('ai', 'guest_ip:1.2.3.4', true).allowed, true);
});

test('DailyAiQuotaTracker persists counts to disk for current day and clears stale dates on restart', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-quota-test-'));
  const filePath = path.join(tmpDir, 'ai-daily-quota.json');

  try {
    let day = '2026-11-22';
    const trackerA = new DailyAiQuotaTracker({
      storageFilePath: filePath,
      guestDailyLimit: 2,
      dateProvider: () => day,
    });
    assert.equal(trackerA.consume('ai', 'guest_ip:10.0.0.1', true).remaining, 1);

    // Reload on same day preserves used count
    const trackerB = new DailyAiQuotaTracker({
      storageFilePath: filePath,
      guestDailyLimit: 2,
      dateProvider: () => day,
    });
    assert.equal(trackerB.peek('guest_ip:10.0.0.1', true).ai.used, 1);
    assert.equal(trackerB.consume('ai', 'guest_ip:10.0.0.1', true).remaining, 0);
    assert.equal(trackerB.consume('ai', 'guest_ip:10.0.0.1', true).allowed, false);

    // Reload on next day discards stale data
    day = '2026-11-23';
    const trackerC = new DailyAiQuotaTracker({
      storageFilePath: filePath,
      guestDailyLimit: 2,
      dateProvider: () => day,
    });
    assert.equal(trackerC.peek('guest_ip:10.0.0.1', true).ai.used, 0);
    assert.equal(trackerC.consume('ai', 'guest_ip:10.0.0.1', true).allowed, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
