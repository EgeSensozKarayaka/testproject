import {
  ProbeInfrastructureError,
  type ProbeInfrastructureErrorCode,
  type ProbeResult,
} from '@site-monitor/check-engine';
import { describe, expect, it, vi } from 'vitest';

import {
  ActiveTaskRegistry,
  ConcurrencyGate,
  ProbeDispatcher,
  type DispatcherLogger,
  type DispatcherQueuePort,
  type JobExecutionSink,
} from './dispatcher.js';
import type { ClaimedJob, ClaimResult, DispatchCandidate, LeaseStatus } from './job-queue.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const passingResult: ProbeResult = {
  bodyMatch: null,
  diagnosticCode: null,
  failureCategory: null,
  outcome: 'PASS',
  redirectCount: 0,
  statusCode: 200,
  timings: { connectMs: 1, dnsMs: 1, tlsMs: 1, totalMs: 4, ttfbMs: 1 },
};

function snapshot(url: string): Record<string, unknown> {
  return {
    schema_version: 1,
    expected_body_substring: null,
    expected_status_code: 200,
    interval_seconds: 30,
    timeout_ms: 5_000,
    url,
  };
}

function claimed(
  candidate: DispatchCandidate,
  configSnapshot: unknown = snapshot(candidate.targetUrl!),
) {
  return {
    attemptId: candidate.jobId.replace('7000', '7100'),
    attemptNumber: 1,
    checkId: candidate.checkId,
    configSnapshot,
    fencingToken: '1',
    jobId: candidate.jobId,
    leaseDurationMs: 20_000,
    leaseExpiresAt: new Date(Date.now() + 20_000).toISOString(),
    manualMode: null,
    ownerId: candidate.ownerId,
    probeGeneration: '1',
    resourceVersion: '1',
    scheduleGeneration: '1',
    scheduledFor: new Date().toISOString(),
    triggerKind: 'SCHEDULED',
  } satisfies ClaimedJob;
}

function candidate(index: number, ownerId: string, targetUrl: string): DispatchCandidate {
  const suffix = String(index).padStart(4, '0');
  return {
    checkId: `00000000-0000-4000-8000-00000000${suffix}`,
    jobId: `00000000-0000-7000-8000-00000000${suffix}`,
    ownerId,
    targetUrl,
  };
}

class FakeQueue implements DispatcherQueuePort {
  readonly claimed: string[] = [];
  heartbeatPromise: Promise<LeaseStatus> | null = null;
  heartbeatResult: LeaseStatus = {
    leaseExpiresAt: new Date(Date.now() + 20_000).toISOString(),
    outcome: 'ACTIVE',
  };
  leaseDurationMs = 20_000;
  snapshotOverride: Record<string, unknown> | null = null;

  constructor(readonly candidates: DispatchCandidate[]) {}

  listClaimCandidates(): Promise<DispatchCandidate[]> {
    return Promise.resolve(this.candidates);
  }

  claimCandidate(candidateValue: DispatchCandidate): Promise<ClaimResult> {
    this.claimed.push(candidateValue.jobId);
    return Promise.resolve({
      job: {
        ...claimed(candidateValue, this.snapshotOverride ?? snapshot(candidateValue.targetUrl!)),
        leaseDurationMs: this.leaseDurationMs,
      },
      outcome: 'CLAIMED',
    });
  }

  startClaim(job: ClaimedJob): Promise<LeaseStatus> {
    return Promise.resolve({ leaseExpiresAt: job.leaseExpiresAt, outcome: 'ACTIVE' });
  }

  heartbeat(): Promise<LeaseStatus> {
    return this.heartbeatPromise ?? Promise.resolve(this.heartbeatResult);
  }
}

class FakeSink implements JobExecutionSink {
  readonly faults: Array<{ code: ProbeInfrastructureErrorCode; jobId: string }> = [];
  readonly results: Array<{ jobId: string; result: ProbeResult }> = [];

  recordInfrastructureFault(job: ClaimedJob, code: ProbeInfrastructureErrorCode): Promise<void> {
    this.faults.push({ code, jobId: job.jobId });
    return Promise.resolve();
  }

  recordResult(job: ClaimedJob, result: ProbeResult): Promise<void> {
    this.results.push({ jobId: job.jobId, result });
    return Promise.resolve();
  }
}

const logger: DispatcherLogger = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

const ownerA = '00000000-0000-4000-8000-000000000001';
const ownerB = '00000000-0000-4000-8000-000000000002';

describe('process-local concurrency gate', () => {
  it('enforces global, owner, and normalized-host limits and cleans empty buckets', () => {
    const gate = new ConcurrencyGate({
      globalLimit: 3,
      hostLimit: 1,
      key: Buffer.alloc(32, 7),
      ownerLimit: 2,
    });
    const first = gate.tryAcquire(ownerA, 'https://Primary.Example.com/a');
    const second = gate.tryAcquire(ownerA, 'https://secondary.example.com/a');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(gate.tryAcquire(ownerA, 'https://third.example.com')).toBeNull();
    expect(gate.tryAcquire(ownerB, 'https://primary.example.com/b')).toBeNull();
    expect(gate.active).toBe(2);

    first!.release();
    const replacement = gate.tryAcquire(ownerB, 'https://primary.example.com/b');
    expect(replacement).not.toBeNull();
    second!.release();
    replacement!.release();
    replacement!.release();
    expect({ active: gate.active, hosts: gate.hostBuckets, owners: gate.ownerBuckets }).toEqual({
      active: 0,
      hosts: 0,
      owners: 0,
    });
  });
});

describe('active task registry', () => {
  it('prevents duplicate tasks, isolates rejection, and drains deterministically', async () => {
    const failures: string[] = [];
    const registry = new ActiveTaskRegistry((jobId) => failures.push(jobId));
    const controller = new AbortController();
    expect(registry.start('job-1', controller, () => Promise.reject(new Error('isolated')))).toBe(
      true,
    );
    expect(registry.start('job-1', controller, () => Promise.resolve())).toBe(false);
    await registry.awaitIdle();
    expect(failures).toEqual(['job-1']);
    expect(registry.size).toBe(0);
    registry.stopAccepting();
    expect(registry.start('job-2', new AbortController(), () => Promise.resolve())).toBe(false);
  });
});

describe('probe dispatcher', () => {
  it('scans past saturated candidates and runs only bounded owner/host work', async () => {
    const candidates = [
      candidate(1, ownerA, 'https://one.example.com/a'),
      candidate(2, ownerA, 'https://two.example.com/a'),
      candidate(3, ownerB, 'https://three.example.com/a'),
      candidate(4, ownerB, 'https://one.example.com/b'),
    ];
    const queue = new FakeQueue(candidates);
    const sink = new FakeSink();
    const pending = new Map(candidates.map((item) => [item.targetUrl!, deferred<ProbeResult>()]));
    const dispatcher = new ProbeDispatcher({
      config: {
        candidateBatchSize: 16,
        globalConcurrency: 2,
        heartbeatMs: 10_000,
        perHostConcurrency: 1,
        perOwnerConcurrency: 1,
      },
      logger,
      probe: {
        run: async ({ input }) => pending.get(input.url)!.promise,
      },
      queue,
      sink,
    });

    await expect(dispatcher.dispatchOnce()).resolves.toEqual({
      active: 2,
      claimed: 2,
      failed: 0,
      saturated: 2,
      scanned: 4,
      skipped: 0,
    });
    expect(queue.claimed).toEqual([candidates[0]!.jobId, candidates[2]!.jobId]);

    pending.get(candidates[0]!.targetUrl!)!.resolve(passingResult);
    pending.get(candidates[2]!.targetUrl!)!.resolve(passingResult);
    await dispatcher.awaitIdle();
    expect(sink.results.map((entry) => entry.jobId)).toEqual([
      candidates[0]!.jobId,
      candidates[2]!.jobId,
    ]);
    expect(dispatcher.activeCount).toBe(0);
  });

  it('routes unsupported snapshots to the infrastructure-fault sink without probing', async () => {
    const queue = new FakeQueue([candidate(5, ownerA, 'not a URL')]);
    queue.snapshotOverride = { schema_version: 99 };
    const sink = new FakeSink();
    const run = vi.fn();
    const dispatcher = new ProbeDispatcher({
      config: {
        candidateBatchSize: 4,
        globalConcurrency: 1,
        heartbeatMs: 1_000,
        perHostConcurrency: 1,
        perOwnerConcurrency: 1,
      },
      logger,
      probe: { run },
      queue,
      sink,
    });

    await dispatcher.dispatchOnce();
    await dispatcher.awaitIdle();
    expect(run).not.toHaveBeenCalled();
    expect(sink.faults).toEqual([
      { code: 'UNSUPPORTED_JOB_SNAPSHOT', jobId: queue.candidates[0]!.jobId },
    ]);
  });

  it('aborts the probe and reports cancellation when heartbeat observes a request', async () => {
    const queue = new FakeQueue([candidate(6, ownerA, 'https://cancel.example.com')]);
    queue.heartbeatResult = {
      cancellationReason: 'CHECK_PAUSED',
      outcome: 'CANCELLATION_REQUESTED',
    };
    const sink = new FakeSink();
    const dispatcher = new ProbeDispatcher({
      config: {
        candidateBatchSize: 4,
        globalConcurrency: 1,
        heartbeatMs: 1,
        perHostConcurrency: 1,
        perOwnerConcurrency: 1,
      },
      logger,
      probe: {
        run: ({ signal }) =>
          new Promise<ProbeResult>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new ProbeInfrastructureError('CANCELLED')),
              { once: true },
            );
          }),
      },
      queue,
      sink,
      sleep: () => Promise.resolve(),
    });

    await dispatcher.dispatchOnce();
    await dispatcher.awaitIdle();
    expect(sink.results).toEqual([]);
    expect(sink.faults).toEqual([{ code: 'CANCELLED', jobId: queue.candidates[0]!.jobId }]);
  });

  it('aborts without persisting when heartbeat cannot verify the lease before deadline', async () => {
    const queue = new FakeQueue([candidate(7, ownerA, 'https://lease.example.com')]);
    queue.leaseDurationMs = 3;
    queue.heartbeatPromise = new Promise<LeaseStatus>(() => undefined);
    const sink = new FakeSink();
    const dispatcher = new ProbeDispatcher({
      config: {
        candidateBatchSize: 4,
        globalConcurrency: 1,
        heartbeatMs: 1,
        perHostConcurrency: 1,
        perOwnerConcurrency: 1,
      },
      logger,
      probe: {
        run: ({ signal }) =>
          new Promise<ProbeResult>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new ProbeInfrastructureError('CANCELLED')),
              { once: true },
            );
          }),
      },
      queue,
      sink,
      sleep: () => Promise.resolve(),
    });

    await dispatcher.dispatchOnce();
    await dispatcher.awaitIdle();
    expect(sink.results).toEqual([]);
    expect(sink.faults).toEqual([]);
  });
});
