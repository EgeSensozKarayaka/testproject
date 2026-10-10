import { setTimeout as delay } from 'node:timers/promises';

import type { RealtimeRuntimeConfig } from '@site-monitor/config';

import type { RealtimeStorePort } from './store.js';
import { classifyRealtimeClaim, realtimeRetryDelaySeconds } from './wakeup.js';

type RuntimeState = 'DRAINING' | 'NEW' | 'RUNNING' | 'STOPPED';
type Sleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export interface RealtimeLogger {
  error(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

const silentLogger: RealtimeLogger = {
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

export class RealtimeRuntimeCoordinator {
  readonly #config: RealtimeRuntimeConfig;
  readonly #controller = new AbortController();
  readonly #logger: RealtimeLogger;
  readonly #sleep: Sleep;
  readonly #store: RealtimeStorePort;
  #failed = false;
  #healthy = false;
  #loop: Promise<void> | undefined;
  #state: RuntimeState = 'NEW';

  constructor(input: {
    config: RealtimeRuntimeConfig;
    logger?: RealtimeLogger;
    sleep?: Sleep;
    store: RealtimeStorePort;
  }) {
    this.#config = input.config;
    this.#logger = input.logger ?? silentLogger;
    this.#sleep = input.sleep ?? defaultSleep;
    this.#store = input.store;
  }

  get ready(): boolean {
    return this.#state === 'RUNNING' && this.#healthy && !this.#failed;
  }

  get state(): RuntimeState {
    return this.#state;
  }

  start(): void {
    if (this.#state !== 'NEW') throw new Error('Realtime runtime can only be started once.');
    this.#state = 'RUNNING';
    this.#loop = this.#runLoop();
  }

  async drain(): Promise<void> {
    if (this.#state === 'STOPPED') return;
    this.#state = 'DRAINING';
    this.#controller.abort();
    const timedOut = Symbol('timed-out');
    const result = await Promise.race([
      (this.#loop ?? Promise.resolve()).then(() => undefined),
      delay(this.#config.shutdownGraceMs, timedOut),
    ]);
    if (result === timedOut) {
      this.#logger.warn(
        { grace_ms: this.#config.shutdownGraceMs },
        'realtime runtime exceeded shutdown grace',
      );
    }
    this.#state = 'STOPPED';
  }

  async #processBatch(): Promise<{ completed: number; dead: number; leaseLost: number }> {
    let completed = 0;
    let dead = 0;
    let leaseLost = 0;
    for (let index = 0; index < this.#config.batchSize; index += 1) {
      if (this.#controller.signal.aborted) break;
      const claim = await this.#store.claimDispatch();
      if (!claim) break;
      const decision = classifyRealtimeClaim(claim, this.#config.maxDispatchAttempts);
      const retrySeconds = realtimeRetryDelaySeconds(
        claim.eventId,
        claim.attemptCount,
        this.#config.retryBaseSeconds,
        this.#config.retryCapSeconds,
      );
      const won = await this.#store.completeDispatch(
        claim,
        decision.result,
        decision.resultCode,
        retrySeconds,
      );
      if (!won) {
        leaseLost += 1;
        continue;
      }
      if (decision.result === 'COMPLETED') completed += 1;
      else dead += 1;
    }
    return { completed, dead, leaseLost };
  }

  async #runLoop(): Promise<void> {
    while (!this.#controller.signal.aborted) {
      try {
        const result = await this.#processBatch();
        this.#healthy = true;
        if (this.#failed) {
          this.#failed = false;
          this.#logger.info({}, 'realtime relay loop recovered');
        }
        if (result.completed + result.dead + result.leaseLost > 0) {
          this.#logger.info(
            {
              completed: result.completed,
              dead: result.dead,
              lease_lost: result.leaseLost,
            },
            'realtime relay batch completed',
          );
        }
      } catch (error) {
        this.#healthy = false;
        if (!this.#failed) {
          this.#failed = true;
          this.#logger.error(
            { error_code: safeErrorCode(error) },
            'realtime relay loop iteration failed',
          );
        }
      }

      if (this.#controller.signal.aborted) break;
      try {
        await this.#sleep(this.#config.pollMs, this.#controller.signal);
      } catch {
        if (this.#controller.signal.aborted) break;
      }
    }
  }
}
