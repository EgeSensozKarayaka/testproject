import { describe, expect, it } from 'vitest';

import { nextCadenceAt, retryBackoffMs } from './scheduling.js';

describe('scheduler timing helpers', () => {
  it('returns the first anchor-aligned cadence instant strictly after now', () => {
    const anchor = new Date('2026-01-01T00:00:05.250Z');

    expect(nextCadenceAt(anchor, 30, new Date('2026-01-01T00:00:00Z')).toISOString()).toBe(
      '2026-01-01T00:00:05.250Z',
    );
    expect(nextCadenceAt(anchor, 30, anchor).toISOString()).toBe('2026-01-01T00:00:35.250Z');
    expect(nextCadenceAt(anchor, 30, new Date('2026-01-01T00:00:35.249Z')).toISOString()).toBe(
      '2026-01-01T00:00:35.250Z',
    );
  });

  it('skips missed ticks without cadence drift after a long outage', () => {
    const anchor = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-02-17T12:34:56.789Z');
    const next = nextCadenceAt(anchor, 300, now);

    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect((next.getTime() - anchor.getTime()) % 300_000).toBe(0);
    expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(300_000);
  });

  it('produces deterministic bounded infrastructure retry backoff', () => {
    const first = retryBackoffMs(1, 'job-a');
    expect(retryBackoffMs(1, 'job-a')).toBe(first);
    expect(first).toBeGreaterThanOrEqual(1_000);
    expect(first).toBeLessThanOrEqual(2_000);
    expect(retryBackoffMs(2, 'job-a')).toBeGreaterThanOrEqual(2_000);
    expect(retryBackoffMs(50, 'job-a')).toBe(30_000);
    expect(retryBackoffMs(3, 'job-a', { jitterWindowMs: 0 })).toBe(4_000);
  });

  it('rejects invalid timing inputs', () => {
    expect(() => nextCadenceAt(new Date('invalid'), 30, new Date())).toThrow(/anchor/u);
    expect(() => nextCadenceAt(new Date(), 0, new Date())).toThrow(/intervalSeconds/u);
    expect(() => retryBackoffMs(0, 'job')).toThrow(/attemptNumber/u);
    expect(() => retryBackoffMs(1, '')).toThrow(/stableKey/u);
  });
});
