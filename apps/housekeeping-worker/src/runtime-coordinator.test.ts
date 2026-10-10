import { describe, expect, it, vi } from 'vitest';

import { HousekeepingRuntimeCoordinator } from './runtime-coordinator.js';
import type { HousekeepingStore } from './store.js';

const config = {
  databasePoolSize: 4,
  discoveryBatchSize: 10,
  discoveryPollMs: 50,
  partitionPollMs: 1_000,
  purgeBatchSize: 10,
  retentionPollMs: 1_000,
  rollupBucketBatchSize: 10,
  rollupPollMs: 50,
  shutdownGraceMs: 1_000,
};

describe('HousekeepingRuntimeCoordinator', () => {
  it('becomes ready only after all four loops complete and drains cleanly', async () => {
    const processRollup = vi.fn().mockResolvedValue({
      bucketsProcessed: 0,
      rangeCompleted: false,
      rangeId: null,
    });
    const store = {
      discoverSources: vi.fn().mockResolvedValue({
        intervalSources: 0,
        rangesEnqueued: 0,
        runSources: 0,
      }),
      ensurePartitions: vi.fn().mockResolvedValue({
        defaultRowCount: 0,
        futurePartitionsReady: true,
      }),
      processRollup,
      retainAndPurge: vi.fn().mockResolvedValue({ partitionAction: 'NONE', rowsPurged: 0 }),
    } as unknown as HousekeepingStore;
    const coordinator = new HousekeepingRuntimeCoordinator({ config, store });

    coordinator.start();
    await vi.waitFor(() => expect(coordinator.ready).toBe(true));
    await coordinator.drain();

    expect(coordinator.state).toBe('STOPPED');
    expect(processRollup).toHaveBeenCalledWith('MINUTE', 10);
    expect(processRollup).toHaveBeenCalledWith('HOUR', 10);
  });
});
