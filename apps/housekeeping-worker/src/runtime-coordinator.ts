import { setTimeout as delay } from 'node:timers/promises';

import type { HousekeepingRuntimeConfig } from '@site-monitor/config';

import type { HousekeepingStore } from './store.js';

type LoopName = 'discovery' | 'partition' | 'retention' | 'rollup';
type RuntimeState = 'DRAINING' | 'NEW' | 'RUNNING' | 'STOPPED';
type Sleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export interface HousekeepingLogger {
  error(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

const silentLogger: HousekeepingLogger = {
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

export class HousekeepingRuntimeCoordinator {
  readonly #config: HousekeepingRuntimeConfig;
  readonly #controller = new AbortController();
  readonly #healthyLoops = new Set<LoopName>();
  readonly #failedLoops = new Set<LoopName>();
  readonly #logger: HousekeepingLogger;
  readonly #sleep: Sleep;
  readonly #store: HousekeepingStore;
  #loops: Promise<void>[] = [];
  #state: RuntimeState = 'NEW';

  constructor(input: {
    config: HousekeepingRuntimeConfig;
    logger?: HousekeepingLogger;
    sleep?: Sleep;
    store: HousekeepingStore;
  }) {
    this.#config = input.config;
    this.#logger = input.logger ?? silentLogger;
    this.#sleep = input.sleep ?? defaultSleep;
    this.#store = input.store;
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
    if (this.#state !== 'NEW') throw new Error('Housekeeping runtime can only be started once.');
    this.#state = 'RUNNING';
    this.#loops = [
      this.#runLoop('discovery', this.#config.discoveryPollMs, async () => {
        const result = await this.#store.discoverSources(this.#config.discoveryBatchSize);
        if (result.runSources + result.intervalSources > 0) {
          this.#logger.info(
            {
              interval_sources: result.intervalSources,
              ranges_enqueued: result.rangesEnqueued,
              run_sources: result.runSources,
            },
            'housekeeping source discovery completed',
          );
        }
      }),
      this.#runLoop('rollup', this.#config.rollupPollMs, async () => {
        const minute = await this.#store.processRollup(
          'MINUTE',
          this.#config.rollupBucketBatchSize,
        );
        const hour = await this.#store.processRollup('HOUR', this.#config.rollupBucketBatchSize);
        if (minute.bucketsProcessed + hour.bucketsProcessed > 0) {
          this.#logger.info(
            { hour_buckets: hour.bucketsProcessed, minute_buckets: minute.bucketsProcessed },
            'housekeeping rollup batch completed',
          );
        }
      }),
      this.#runLoop('partition', this.#config.partitionPollMs, async () => {
        const result = await this.#store.ensurePartitions();
        if (result.defaultRowCount > 0) {
          this.#logger.warn(
            { default_row_count: result.defaultRowCount },
            'partition default rows require operator repair',
          );
        }
        if (!result.futurePartitionsReady) throw new Error('FuturePartitionHorizonMissing');
      }),
      this.#runLoop('retention', this.#config.retentionPollMs, async () => {
        const result = await this.#store.retainAndPurge(this.#config.purgeBatchSize);
        if (result.partitionAction !== 'NONE' || result.rowsPurged > 0) {
          this.#logger.info(
            { partition_action: result.partitionAction, rows_purged: result.rowsPurged },
            'housekeeping retention batch completed',
          );
        }
      }),
    ];
  }

  async drain(): Promise<void> {
    if (this.#state === 'STOPPED') return;
    this.#state = 'DRAINING';
    this.#controller.abort();
    const completion = Promise.all(this.#loops);
    const timedOut = Symbol('timed-out');
    const result = await Promise.race([
      completion.then(() => undefined),
      delay(this.#config.shutdownGraceMs, timedOut),
    ]);
    if (result === timedOut) {
      this.#logger.warn(
        { grace_ms: this.#config.shutdownGraceMs },
        'housekeeping runtime exceeded shutdown grace',
      );
    }
    this.#state = 'STOPPED';
  }

  async #runLoop(name: LoopName, pollMs: number, operation: () => Promise<void>): Promise<void> {
    while (!this.#controller.signal.aborted) {
      try {
        await operation();
        this.#healthyLoops.add(name);
        if (this.#failedLoops.delete(name)) {
          this.#logger.info({ loop: name }, 'housekeeping loop recovered');
        }
      } catch (error) {
        this.#healthyLoops.delete(name);
        if (!this.#failedLoops.has(name)) {
          this.#failedLoops.add(name);
          this.#logger.error(
            { error_code: safeErrorCode(error), loop: name },
            'housekeeping loop iteration failed',
          );
        }
      }
      if (this.#controller.signal.aborted) break;
      try {
        await this.#sleep(pollMs, this.#controller.signal);
      } catch {
        if (this.#controller.signal.aborted) break;
      }
    }
  }
}
