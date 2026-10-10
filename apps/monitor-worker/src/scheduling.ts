import { createHash } from 'node:crypto';

const MAX_DATE_MS = 8_640_000_000_000_000;

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
}

function requireValidDate(value: Date, name: string): number {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${name} must be a valid Date.`);
  return milliseconds;
}

/** Returns the first anchor-aligned cadence instant strictly after `now`. */
export function nextCadenceAt(anchor: Date, intervalSeconds: number, now: Date): Date {
  const anchorMs = requireValidDate(anchor, 'anchor');
  const nowMs = requireValidDate(now, 'now');
  requirePositiveInteger(intervalSeconds, 'intervalSeconds');

  const intervalMs = intervalSeconds * 1_000;
  const slots = nowMs < anchorMs ? 0 : Math.floor((nowMs - anchorMs) / intervalMs) + 1;
  const nextMs = anchorMs + slots * intervalMs;
  if (!Number.isSafeInteger(nextMs) || Math.abs(nextMs) > MAX_DATE_MS) {
    throw new RangeError('The next cadence instant is outside the supported Date range.');
  }
  return new Date(nextMs);
}

export interface RetryBackoffOptions {
  baseDelayMs?: number;
  jitterWindowMs?: number;
  maxDelayMs?: number;
}

/**
 * Computes bounded exponential infrastructure-retry backoff. Jitter is stable
 * for one job/attempt pair so restarts cannot keep moving the availability time.
 */
export function retryBackoffMs(
  attemptNumber: number,
  stableKey: string,
  options: RetryBackoffOptions = {},
): number {
  requirePositiveInteger(attemptNumber, 'attemptNumber');
  if (stableKey.length === 0) throw new TypeError('stableKey must not be empty.');

  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const jitterWindowMs = options.jitterWindowMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  requirePositiveInteger(baseDelayMs, 'baseDelayMs');
  requirePositiveInteger(maxDelayMs, 'maxDelayMs');
  if (!Number.isSafeInteger(jitterWindowMs) || jitterWindowMs < 0) {
    throw new TypeError('jitterWindowMs must be a non-negative safe integer.');
  }

  const exponent = Math.min(attemptNumber - 1, 52);
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
  const digest = createHash('sha256')
    .update('monitor-retry-v1\0')
    .update(stableKey)
    .update('\0')
    .update(String(attemptNumber))
    .digest();
  const jitter = jitterWindowMs === 0 ? 0 : digest.readUInt32BE(0) % (jitterWindowMs + 1);
  return Math.min(maxDelayMs, exponential + jitter);
}
