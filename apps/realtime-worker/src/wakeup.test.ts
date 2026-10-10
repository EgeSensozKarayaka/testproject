import { describe, expect, it } from 'vitest';

import { classifyRealtimeClaim, type RealtimeClaim, realtimeRetryDelaySeconds } from './wakeup.js';

function claim(overrides: Partial<RealtimeClaim> = {}): RealtimeClaim {
  return {
    aggregateId: '00000000-0000-4000-8000-000000000003',
    aggregateType: 'check_state',
    aggregateVersion: '19',
    attemptCount: 1,
    eventId: '00000000-0000-4000-8000-000000000001',
    eventType: 'check.health_changed',
    fencingToken: '7',
    occurredAt: new Date('2026-10-10T13:12:00.000Z'),
    ownerId: '00000000-0000-4000-8000-000000000002',
    schemaVersion: 1,
    ...overrides,
  };
}

describe('realtime wakeup policy', () => {
  it('projects only bounded routing data for supported events', () => {
    expect(classifyRealtimeClaim(claim(), 5)).toEqual({
      result: 'COMPLETED',
      resultCode: 'PUBLISHED',
      wakeup: {
        aggregate_id: '00000000-0000-4000-8000-000000000003',
        aggregate_type: 'check_state',
        aggregate_version: '19',
        event_id: '00000000-0000-4000-8000-000000000001',
        event_type: 'check.health_changed',
        occurred_at: '2026-10-10T13:12:00.000Z',
        owner_id: '00000000-0000-4000-8000-000000000002',
        v: 1,
      },
    });
  });

  it.each([
    [claim({ schemaVersion: 2 }), 'UNSUPPORTED_SCHEMA_VERSION'],
    [claim({ ownerId: null }), 'MISSING_OWNER'],
    [claim({ eventType: 'secret.payload_exposed' }), 'UNSUPPORTED_EVENT_TYPE'],
    [claim({ attemptCount: 6 }), 'MAX_ATTEMPTS_EXCEEDED'],
  ] as const)('dead-letters unsafe claim %#', (candidate, resultCode) => {
    expect(classifyRealtimeClaim(candidate, 5)).toEqual({ result: 'DEAD', resultCode });
  });

  it('keeps deterministic full-jitter retry inside the configured cap', () => {
    const first = realtimeRetryDelaySeconds(claim().eventId, 3, 2, 60);
    const repeated = realtimeRetryDelaySeconds(claim().eventId, 3, 2, 60);
    expect(repeated).toBe(first);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(8);
    expect(realtimeRetryDelaySeconds(claim().eventId, 20, 2, 60)).toBeLessThanOrEqual(60);
  });
});
