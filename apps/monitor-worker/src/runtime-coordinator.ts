import { setTimeout as delay } from 'node:timers/promises';

import type { Pool } from '@site-monitor/database';

import type { DispatchIteration } from './dispatcher.js';
import type { JobSettlement, MaterializedJob } from './job-queue.js';
import type { FreshnessCandidate, FreshnessReconciliationResult } from './observation-store.js';

export interface RuntimeCoordinatorLogger {
  error(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface RuntimeQueuePort {
  materializeDueBatch(limit: number): Promise<MaterializedJob[]>;
  recoverExpiredBatch(limit: number): Promise<JobSettlement[]>;
}

export interface RuntimeDispatcherPort {
  abortActive(): void;
  awaitIdle(): Promise<void>;
  dispatchOnce(): Promise<DispatchIteration>;
  stopAccepting(): void;
}

export interface RuntimeFreshnessPort {
  listFreshnessCandidates(limit: number): Promise<FreshnessCandidate[]>;
  reconcileFreshness(
    candidate: Pick<FreshnessCandidate, 'checkId' | 'ownerId'>,
  ): Promise<FreshnessReconciliationResult>;
}

export interface RuntimeCoordinatorConfig {
  candidateBatchSize: number;
  dispatchPollMs: number;
  freshnessPollMs: number;
  recoveryPollMs: number;
  scheduleBatchSize: number;
  schedulerPollMs: number;
  shutdownGraceMs: number;
}

export interface RuntimeDrainResult {
  aborted: boolean;
  drained: boolean;
}

type LoopName = 'dispatch' | 'freshness' | 'recovery' | 'scheduler';
type RuntimeState = 'DRAINING' | 'NEW' | 'RUNNING' | 'STOPPED';
type Sleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;

const silentLogger: RuntimeCoordinatorLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

async function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  await delay(milliseconds, undefined, { signal });
}

function safeErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]{1,32}$/u.test(code)) return code;
  }
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name)
    ? error.name
    : 'UNKNOWN_ERROR';
}

function countSettlements(settlements: JobSettlement[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const settlement of settlements) {
    counts[settlement.outcome] = (counts[settlement.outcome] ?? 0) + 1;
  }
  return counts;
}

async function settlesWithin(operation: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation.then(
        () => true,
        () => false,
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function isMonitorStorageReady(pool: Pool): Promise<boolean> {
  try {
    const result = await pool.query<{ ready: boolean }>(
      `WITH required_months AS (
         SELECT date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC') AS month_start
         UNION ALL
         SELECT date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC') + interval '1 month'
       )
       SELECT bool_and(
         to_regclass(
           format('monitoring.check_runs_%s', to_char(month_start, 'YYYY_MM'))
         ) IS NOT NULL
         AND to_regclass(
           format('monitoring.health_intervals_%s', to_char(month_start, 'YYYY_MM'))
         ) IS NOT NULL
       ) AS ready
       FROM required_months`,
    );
    return result.rows[0]?.ready === true;
  } catch {
    return false;
  }
}

export class MonitorRuntimeCoordinator {
  readonly #config: RuntimeCoordinatorConfig;
  readonly #controller = new AbortController();
  readonly #dispatcher: RuntimeDispatcherPort;
  readonly #freshness: RuntimeFreshnessPort;
  readonly #logger: RuntimeCoordinatorLogger;
  readonly #queue: RuntimeQueuePort;
  readonly #sleep: Sleep;
  #drainPromise: Promise<RuntimeDrainResult> | null = null;
  readonly #failedLoops = new Set<LoopName>();
  readonly #healthyLoops = new Set<LoopName>();
  #loops: Promise<void>[] = [];
  #state: RuntimeState = 'NEW';

  constructor(input: {
    config: RuntimeCoordinatorConfig;
    dispatcher: RuntimeDispatcherPort;
    freshness: RuntimeFreshnessPort;
    logger?: RuntimeCoordinatorLogger;
    queue: RuntimeQueuePort;
    sleep?: Sleep;
  }) {
    this.#config = input.config;
    this.#dispatcher = input.dispatcher;
    this.#freshness = input.freshness;
    this.#logger = input.logger ?? silentLogger;
    this.#queue = input.queue;
    this.#sleep = input.sleep ?? defaultSleep;
  }

  get ready(): boolean {
    return (
      this.#state === 'RUNNING' && this.#healthyLoops.size === 4 && this.#failedLoops.size === 0
    );
  }

  get state(): RuntimeState {
    return this.#state;
  }

  start(): void {
    if (this.#state !== 'NEW') throw new Error('Monitor runtime can only be started once.');
    this.#state = 'RUNNING';
    this.#loops = [
      this.#runLoop('scheduler', this.#config.schedulerPollMs, () => this.#scheduleOnce()),
      this.#runLoop('dispatch', this.#config.dispatchPollMs, () => this.#dispatchOnce()),
      this.#runLoop('recovery', this.#config.recoveryPollMs, () => this.#recoverOnce()),
      this.#runLoop('freshness', this.#config.freshnessPollMs, () => this.#freshnessOnce()),
    ];
    this.#logger.info({ loop_count: this.#loops.length }, 'monitor runtime started');
  }

  drain(graceMs: number = this.#config.shutdownGraceMs): Promise<RuntimeDrainResult> {
    if (this.#drainPromise) return this.#drainPromise;
    if (!Number.isInteger(graceMs) || graceMs < 1 || graceMs > 600_000) {
      return Promise.reject(new TypeError('graceMs must be an integer from 1 through 600000.'));
    }
    this.#drainPromise = this.#drain(graceMs);
    return this.#drainPromise;
  }

  async #dispatchOnce(): Promise<void> {
    const summary = await this.#dispatcher.dispatchOnce();
    if (summary.claimed > 0 || summary.failed > 0) {
      this.#logger.info(
        {
          active: summary.active,
          claimed: summary.claimed,
          failed: summary.failed,
          saturated: summary.saturated,
          scanned: summary.scanned,
          skipped: summary.skipped,
        },
        'monitor dispatch batch completed',
      );
    }
  }

  async #drain(graceMs: number): Promise<RuntimeDrainResult> {
    if (this.#state === 'STOPPED') return { aborted: false, drained: true };
    const deadline = Date.now() + graceMs;
    this.#state = 'DRAINING';
    this.#dispatcher.stopAccepting();
    this.#controller.abort();
    const loopsStopped = await settlesWithin(
      Promise.all(this.#loops).then(() => undefined),
      Math.min(graceMs, 5_000),
    );
    if (!loopsStopped) {
      this.#logger.warn({ grace_ms: graceMs }, 'monitor poll loops exceeded drain grace');
    }

    const idle = this.#dispatcher.awaitIdle();
    let probesDrained = await settlesWithin(idle, Math.max(1, deadline - Date.now()));
    let aborted = false;
    if (!probesDrained) {
      aborted = true;
      this.#logger.warn({ grace_ms: graceMs }, 'monitor drain grace expired; aborting probes');
      this.#dispatcher.abortActive();
      probesDrained = await settlesWithin(idle, Math.min(graceMs, 5_000));
    }
    const drained = loopsStopped && probesDrained;
    this.#state = 'STOPPED';
    this.#logger.info({ aborted, drained }, 'monitor runtime stopped');
    return { aborted, drained };
  }

  async #freshnessOnce(): Promise<void> {
    const candidates = await this.#freshness.listFreshnessCandidates(
      this.#config.scheduleBatchSize,
    );
    let reconciled = 0;
    let maxLagMs = 0;
    for (const candidate of candidates) {
      if (this.#controller.signal.aborted) break;
      const result = await this.#freshness.reconcileFreshness(candidate);
      if (result.outcome === 'RECONCILED') {
        reconciled += 1;
        maxLagMs = Math.max(maxLagMs, result.lagMs);
      }
    }
    if (reconciled > 0) {
      this.#logger.info(
        { candidate_count: candidates.length, max_lag_ms: maxLagMs, reconciled },
        'freshness batch completed',
      );
    }
  }

  async #recoverOnce(): Promise<void> {
    const settlements = await this.#queue.recoverExpiredBatch(this.#config.candidateBatchSize);
    const actionable = settlements.filter((result) => result.outcome !== 'STALE');
    if (actionable.length > 0) {
      this.#logger.info(
        { outcomes: countSettlements(actionable), settlement_count: actionable.length },
        'lease recovery batch completed',
      );
    }
  }

  #recordFailure(name: LoopName, error: unknown): void {
    this.#healthyLoops.delete(name);
    if (this.#failedLoops.has(name)) return;
    this.#failedLoops.add(name);
    this.#logger.error(
      { error_code: safeErrorCode(error), loop: name },
      'monitor runtime loop iteration failed',
    );
  }

  #recordSuccess(name: LoopName): void {
    this.#healthyLoops.add(name);
    if (!this.#failedLoops.delete(name)) return;
    this.#logger.info({ loop: name }, 'monitor runtime loop recovered');
  }

  async #runLoop(name: LoopName, pollMs: number, operation: () => Promise<void>): Promise<void> {
    while (!this.#controller.signal.aborted) {
      try {
        await operation();
        this.#recordSuccess(name);
      } catch (error) {
        this.#recordFailure(name, error);
      }
      if (this.#controller.signal.aborted) break;
      try {
        await this.#sleep(pollMs, this.#controller.signal);
      } catch (error) {
        if (this.#controller.signal.aborted) break;
        this.#logger.error(
          { error_code: safeErrorCode(error), loop: name },
          'monitor runtime loop sleep failed',
        );
      }
    }
  }

  async #scheduleOnce(): Promise<void> {
    const jobs = await this.#queue.materializeDueBatch(this.#config.scheduleBatchSize);
    if (jobs.length > 0) {
      const manual = jobs.filter((job) => job.kind === 'MANUAL').length;
      this.#logger.info(
        { job_count: jobs.length, manual, scheduled: jobs.length - manual },
        'scheduler batch completed',
      );
    }
  }
}
