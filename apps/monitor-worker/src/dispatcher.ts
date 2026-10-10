import { createHmac, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import {
  decodeProbeJobSnapshot,
  ProbeInfrastructureError,
  type ProbeInfrastructureErrorCode,
  type ProbeInvocation,
  type ProbeResult,
} from '@site-monitor/check-engine';

import {
  type ClaimedJob,
  type ClaimResult,
  type DispatchCandidate,
  type LeaseStatus,
} from './job-queue.js';

export interface DispatcherLogger {
  error(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface DispatcherQueuePort {
  claimCandidate(candidate: DispatchCandidate): Promise<ClaimResult>;
  heartbeat(job: ClaimedJob): Promise<LeaseStatus>;
  listClaimCandidates(limit: number): Promise<DispatchCandidate[]>;
  startClaim(job: ClaimedJob): Promise<LeaseStatus>;
}

export interface DispatcherProbePort {
  run(invocation: ProbeInvocation): Promise<ProbeResult>;
}

export interface JobExecutionSink {
  recordInfrastructureFault(job: ClaimedJob, code: ProbeInfrastructureErrorCode): Promise<void>;
  recordResult(job: ClaimedJob, result: ProbeResult): Promise<void>;
}

export interface DispatcherConfig {
  candidateBatchSize: number;
  globalConcurrency: number;
  heartbeatMs: number;
  perHostConcurrency: number;
  perOwnerConcurrency: number;
}

export interface DispatchIteration {
  active: number;
  claimed: number;
  failed: number;
  saturated: number;
  scanned: number;
  skipped: number;
}

interface SlotLease {
  release(): void;
}

interface TaskEntry {
  controller: AbortController;
  promise: Promise<void>;
}

type Sleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;

type HeartbeatRace =
  | { kind: 'DEADLINE' }
  | { error: unknown; kind: 'ERROR' }
  | { kind: 'STATUS'; status: LeaseStatus };

const silentLogger: DispatcherLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

async function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  await delay(milliseconds, undefined, { signal });
}

function safeErrorCode(error: unknown): string {
  if (error instanceof ProbeInfrastructureError) return error.code;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]{1,32}$/u.test(code)) return code;
  }
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name)
    ? error.name
    : 'UNKNOWN_ERROR';
}

function cancellationFault(
  status: LeaseStatus,
): status is Extract<LeaseStatus, { outcome: 'CANCELLATION_REQUESTED' }> {
  return status.outcome === 'CANCELLATION_REQUESTED';
}

export class ConcurrencyGate {
  readonly #globalLimit: number;
  readonly #hostLimit: number;
  readonly #key: Buffer;
  readonly #ownerLimit: number;
  #globalActive = 0;
  readonly #hosts = new Map<string, number>();
  readonly #owners = new Map<string, number>();

  constructor(input: { globalLimit: number; hostLimit: number; key?: Buffer; ownerLimit: number }) {
    for (const [name, value] of [
      ['globalLimit', input.globalLimit],
      ['ownerLimit', input.ownerLimit],
      ['hostLimit', input.hostLimit],
    ] as const) {
      if (!Number.isInteger(value) || value < 1) {
        throw new TypeError(`${name} must be a positive integer.`);
      }
    }
    if (input.ownerLimit > input.globalLimit || input.hostLimit > input.globalLimit) {
      throw new TypeError('Owner and host limits cannot exceed the global limit.');
    }
    if (input.key && input.key.byteLength < 32) {
      throw new TypeError('Concurrency fingerprint key must contain at least 32 bytes.');
    }
    this.#globalLimit = input.globalLimit;
    this.#ownerLimit = input.ownerLimit;
    this.#hostLimit = input.hostLimit;
    this.#key = input.key ? Buffer.from(input.key) : randomBytes(32);
  }

  get active(): number {
    return this.#globalActive;
  }

  get hostBuckets(): number {
    return this.#hosts.size;
  }

  get ownerBuckets(): number {
    return this.#owners.size;
  }

  tryAcquire(ownerId: string, targetUrl: string | null): SlotLease | null {
    const ownerKey = this.#fingerprint('owner', ownerId);
    const hostKey = this.#fingerprint('host', this.#hostname(targetUrl));
    const ownerActive = this.#owners.get(ownerKey) ?? 0;
    const hostActive = this.#hosts.get(hostKey) ?? 0;
    if (
      this.#globalActive >= this.#globalLimit ||
      ownerActive >= this.#ownerLimit ||
      hostActive >= this.#hostLimit
    ) {
      return null;
    }

    this.#globalActive += 1;
    this.#owners.set(ownerKey, ownerActive + 1);
    this.#hosts.set(hostKey, hostActive + 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.#globalActive -= 1;
        this.#decrement(this.#owners, ownerKey);
        this.#decrement(this.#hosts, hostKey);
      },
    };
  }

  #decrement(map: Map<string, number>, key: string): void {
    const next = (map.get(key) ?? 1) - 1;
    if (next === 0) map.delete(key);
    else map.set(key, next);
  }

  #fingerprint(domain: string, value: string): string {
    return createHmac('sha256', this.#key).update(domain).update('\0').update(value).digest('hex');
  }

  #hostname(targetUrl: string | null): string {
    if (targetUrl === null) return '<invalid>';
    try {
      return new URL(targetUrl).hostname.toLowerCase().replace(/\.$/u, '') || '<invalid>';
    } catch {
      return '<invalid>';
    }
  }
}

export class ActiveTaskRegistry {
  readonly #entries = new Map<string, TaskEntry>();
  readonly #onUnhandled: (jobId: string, error: unknown) => void;
  #accepting = true;

  constructor(onUnhandled: (jobId: string, error: unknown) => void = () => undefined) {
    this.#onUnhandled = onUnhandled;
  }

  get accepting(): boolean {
    return this.#accepting;
  }

  get size(): number {
    return this.#entries.size;
  }

  start(jobId: string, controller: AbortController, operation: () => Promise<void>): boolean {
    if (!this.#accepting || this.#entries.has(jobId)) return false;
    const promise = Promise.resolve()
      .then(operation)
      .catch((error: unknown) => this.#onUnhandled(jobId, error))
      .finally(() => this.#entries.delete(jobId));
    this.#entries.set(jobId, { controller, promise });
    return true;
  }

  stopAccepting(): void {
    this.#accepting = false;
  }

  abortAll(reason: unknown = new ProbeInfrastructureError('CANCELLED')): void {
    for (const entry of this.#entries.values()) entry.controller.abort(reason);
  }

  async awaitIdle(): Promise<void> {
    await Promise.all([...this.#entries.values()].map((entry) => entry.promise));
  }
}

export class ProbeDispatcher {
  readonly #config: DispatcherConfig;
  readonly #gate: ConcurrencyGate;
  readonly #logger: DispatcherLogger;
  readonly #probe: DispatcherProbePort;
  readonly #queue: DispatcherQueuePort;
  readonly #registry: ActiveTaskRegistry;
  readonly #sink: JobExecutionSink;
  readonly #sleep: Sleep;

  constructor(input: {
    config: DispatcherConfig;
    gate?: ConcurrencyGate;
    logger?: DispatcherLogger;
    probe: DispatcherProbePort;
    queue: DispatcherQueuePort;
    registry?: ActiveTaskRegistry;
    sink: JobExecutionSink;
    sleep?: Sleep;
  }) {
    this.#config = input.config;
    this.#gate =
      input.gate ??
      new ConcurrencyGate({
        globalLimit: input.config.globalConcurrency,
        hostLimit: input.config.perHostConcurrency,
        ownerLimit: input.config.perOwnerConcurrency,
      });
    this.#logger = input.logger ?? silentLogger;
    this.#probe = input.probe;
    this.#queue = input.queue;
    this.#sink = input.sink;
    this.#sleep = input.sleep ?? defaultSleep;
    this.#registry =
      input.registry ??
      new ActiveTaskRegistry((jobId, error) =>
        this.#logger.error(
          { error_code: safeErrorCode(error), job_id: jobId },
          'probe task escaped its isolation boundary',
        ),
      );
  }

  get activeCount(): number {
    return this.#registry.size;
  }

  async dispatchOnce(): Promise<DispatchIteration> {
    const summary: DispatchIteration = {
      active: this.#registry.size,
      claimed: 0,
      failed: 0,
      saturated: 0,
      scanned: 0,
      skipped: 0,
    };
    if (!this.#registry.accepting) return summary;

    const candidates = await this.#queue.listClaimCandidates(this.#config.candidateBatchSize);
    summary.scanned = candidates.length;
    for (const candidate of candidates) {
      if (!this.#registry.accepting) break;
      const slot = this.#gate.tryAcquire(candidate.ownerId, candidate.targetUrl);
      if (!slot) {
        summary.saturated += 1;
        continue;
      }

      try {
        const result = await this.#queue.claimCandidate(candidate);
        if (result.outcome === 'SKIPPED') {
          summary.skipped += 1;
          slot.release();
          continue;
        }

        const controller = new AbortController();
        const registered = this.#registry.start(result.job.jobId, controller, async () => {
          try {
            await this.#execute(result.job, controller);
          } finally {
            slot.release();
          }
        });
        if (!registered) {
          slot.release();
          summary.skipped += 1;
          await this.#sink.recordInfrastructureFault(result.job, 'CANCELLED');
          continue;
        }
        summary.claimed += 1;
      } catch (error) {
        slot.release();
        summary.failed += 1;
        this.#logger.error(
          { error_code: safeErrorCode(error), job_id: candidate.jobId },
          'job claim failed',
        );
      }
    }
    summary.active = this.#registry.size;
    return summary;
  }

  stopAccepting(): void {
    this.#registry.stopAccepting();
  }

  abortActive(): void {
    this.#registry.abortAll();
  }

  async awaitIdle(): Promise<void> {
    await this.#registry.awaitIdle();
  }

  async #execute(job: ClaimedJob, controller: AbortController): Promise<void> {
    let input: ReturnType<typeof decodeProbeJobSnapshot>;
    try {
      input = decodeProbeJobSnapshot(job.configSnapshot);
    } catch (error) {
      await this.#sink.recordInfrastructureFault(
        job,
        error instanceof ProbeInfrastructureError ? error.code : 'ENGINE_ERROR',
      );
      return;
    }

    const start = await this.#queue.startClaim(job);
    if (start.outcome === 'LEASE_LOST') {
      this.#logger.warn({ job_id: job.jobId }, 'job lease was lost before probe start');
      return;
    }
    if (cancellationFault(start)) {
      await this.#sink.recordInfrastructureFault(job, 'CANCELLED');
      return;
    }

    const heartbeatController = new AbortController();
    const leaseDecision: { current: LeaseStatus | null } = { current: null };
    const heartbeat = this.#watchLease(job, heartbeatController.signal, controller, (decision) => {
      leaseDecision.current = decision;
    });

    try {
      const result = await this.#probe.run({ input, signal: controller.signal });
      heartbeatController.abort();
      await heartbeat;
      if (leaseDecision.current?.outcome === 'LEASE_LOST') return;
      if (leaseDecision.current?.outcome === 'CANCELLATION_REQUESTED') {
        await this.#sink.recordInfrastructureFault(job, 'CANCELLED');
        return;
      }
      await this.#sink.recordResult(job, result);
    } catch (error) {
      heartbeatController.abort();
      await heartbeat;
      if (leaseDecision.current?.outcome === 'LEASE_LOST') return;
      const code =
        leaseDecision.current?.outcome === 'CANCELLATION_REQUESTED'
          ? 'CANCELLED'
          : error instanceof ProbeInfrastructureError
            ? error.code
            : 'ENGINE_ERROR';
      await this.#sink.recordInfrastructureFault(job, code);
    }
  }

  async #watchLease(
    job: ClaimedJob,
    signal: AbortSignal,
    probeController: AbortController,
    decide: (status: LeaseStatus) => void,
  ): Promise<void> {
    let localDeadline =
      Date.now() +
      Math.max(this.#config.heartbeatMs, job.leaseDurationMs - 2 * this.#config.heartbeatMs);
    while (!signal.aborted) {
      try {
        await this.#sleep(this.#config.heartbeatMs, signal);
      } catch {
        if (signal.aborted) return;
        throw new Error('Heartbeat sleep failed.');
      }
      if (signal.aborted) return;

      const heartbeat = await this.#heartbeatBefore(job, localDeadline);
      if (heartbeat.kind === 'DEADLINE') {
        const lost: LeaseStatus = { outcome: 'LEASE_LOST' };
        decide(lost);
        probeController.abort(new ProbeInfrastructureError('CANCELLED'));
        return;
      }
      if (heartbeat.kind === 'STATUS') {
        const { status } = heartbeat;
        if (status.outcome === 'ACTIVE') {
          localDeadline =
            Date.now() +
            Math.max(this.#config.heartbeatMs, job.leaseDurationMs - 2 * this.#config.heartbeatMs);
          continue;
        }
        decide(status);
        probeController.abort(new ProbeInfrastructureError('CANCELLED'));
        return;
      }

      this.#logger.warn(
        { error_code: safeErrorCode(heartbeat.error), job_id: job.jobId },
        'job heartbeat failed',
      );
      if (Date.now() >= localDeadline) {
        const lost: LeaseStatus = { outcome: 'LEASE_LOST' };
        decide(lost);
        probeController.abort(new ProbeInfrastructureError('CANCELLED'));
        return;
      }
    }
  }

  async #heartbeatBefore(job: ClaimedJob, localDeadline: number): Promise<HeartbeatRace> {
    const remainingMs = localDeadline - Date.now();
    if (remainingMs <= 0) return { kind: 'DEADLINE' };

    return new Promise<HeartbeatRace>((resolve) => {
      const timer = setTimeout(() => resolve({ kind: 'DEADLINE' }), remainingMs);
      void this.#queue.heartbeat(job).then(
        (status) => {
          clearTimeout(timer);
          resolve({ kind: 'STATUS', status });
        },
        (error: unknown) => {
          clearTimeout(timer);
          resolve({ error, kind: 'ERROR' });
        },
      );
    });
  }
}
