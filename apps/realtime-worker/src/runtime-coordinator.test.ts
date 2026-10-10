import { describe, expect, it, vi } from 'vitest';

import { RealtimeRuntimeCoordinator } from './runtime-coordinator.js';
import type { RealtimeStorePort } from './store.js';
import type { RealtimeClaim } from './wakeup.js';

const config = {
  batchSize: 10,
  databasePoolSize: 4,
  leaseSeconds: 30,
  maxDispatchAttempts: 5,
  pollMs: 25,
  retryBaseSeconds: 2,
  retryCapSeconds: 60,
  shutdownGraceMs: 1_000,
};

function claim(eventType: string): RealtimeClaim {
  return {
    aggregateId: '00000000-0000-4000-8000-000000000003',
    aggregateType: 'check',
    aggregateVersion: '1',
    attemptCount: 1,
    eventId:
      eventType === 'check.created'
        ? '00000000-0000-4000-8000-000000000001'
        : '00000000-0000-4000-8000-000000000004',
    eventType,
    fencingToken: '1',
    occurredAt: new Date('2026-10-10T13:12:00.000Z'),
    ownerId: '00000000-0000-4000-8000-000000000002',
    schemaVersion: 1,
  };
}

describe('RealtimeRuntimeCoordinator', () => {
  it('publishes supported claims, dead-letters poison events and drains cleanly', async () => {
    const claims = [claim('check.created'), claim('unknown.event')];
    const completeDispatch = vi.fn().mockResolvedValue(true);
    const store: RealtimeStorePort = {
      claimDispatch: vi.fn().mockImplementation(() => Promise.resolve(claims.shift())),
      completeDispatch,
      storageReady: vi.fn().mockResolvedValue(true),
    };
    const coordinator = new RealtimeRuntimeCoordinator({ config, store });

    coordinator.start();
    await vi.waitFor(() => expect(completeDispatch).toHaveBeenCalledTimes(2));
    expect(coordinator.ready).toBe(true);
    expect(completeDispatch.mock.calls[0]?.slice(1, 3)).toEqual(['COMPLETED', 'PUBLISHED']);
    expect(completeDispatch.mock.calls[1]?.slice(1, 3)).toEqual(['DEAD', 'UNSUPPORTED_EVENT_TYPE']);

    await coordinator.drain();
    expect(coordinator.state).toBe('STOPPED');
  });

  it('drops readiness on a loop error and reports recovery without leaking the error', async () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const claimDispatch = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('secret database detail'), { code: '08006' }))
      .mockResolvedValue(undefined);
    const store: RealtimeStorePort = {
      claimDispatch,
      completeDispatch: vi.fn().mockResolvedValue(true),
      storageReady: vi.fn().mockResolvedValue(true),
    };
    const coordinator = new RealtimeRuntimeCoordinator({ config, logger, store });

    coordinator.start();
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
    expect(logger.error).toHaveBeenCalledWith(
      { error_code: '08006' },
      'realtime relay loop iteration failed',
    );
    await vi.waitFor(() => expect(coordinator.ready).toBe(true));
    expect(logger.info).toHaveBeenCalledWith({}, 'realtime relay loop recovered');

    await coordinator.drain();
  });
});
