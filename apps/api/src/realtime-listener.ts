import { setTimeout as delay } from 'node:timers/promises';

import { internalRealtimeWakeupSchema, type InternalRealtimeWakeup } from '@site-monitor/contracts';
import type { Notification, Pool, PoolClient } from '@site-monitor/database';

export interface RealtimeListenerLogger {
  error(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

const silentLogger: RealtimeListenerLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

function safeCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]{1,32}$/u.test(code)) return code;
  }
  return 'LISTENER_ERROR';
}

export class PostgresRealtimeListener {
  readonly #controller = new AbortController();
  readonly #graceMs: number;
  readonly #logger: RealtimeListenerLogger;
  readonly #onInvalidPayload: () => void;
  readonly #onRestart: () => void;
  readonly #onWakeup: (wakeup: InternalRealtimeWakeup) => void;
  readonly #pool: Pool;
  #client: PoolClient | undefined;
  #connected = false;
  #connectedOnce = false;
  #disconnectAt: number | undefined;
  #disconnectResolver: (() => void) | undefined;
  #loop: Promise<void> | undefined;
  #stopping = false;

  constructor(input: {
    graceMs: number;
    logger?: RealtimeListenerLogger;
    onInvalidPayload: () => void;
    onRestart: () => void;
    onWakeup: (wakeup: InternalRealtimeWakeup) => void;
    pool: Pool;
  }) {
    this.#graceMs = input.graceMs;
    this.#logger = input.logger ?? silentLogger;
    this.#onInvalidPayload = input.onInvalidPayload;
    this.#onRestart = input.onRestart;
    this.#onWakeup = input.onWakeup;
    this.#pool = input.pool;
  }

  get ready(): boolean {
    if (this.#connected) return true;
    return (
      this.#connectedOnce &&
      this.#disconnectAt !== undefined &&
      Date.now() - this.#disconnectAt <= this.#graceMs
    );
  }

  start(): void {
    if (this.#loop) throw new Error('Realtime listener can only be started once.');
    this.#loop = this.#run();
  }

  async waitUntilConnected(timeoutMs = 5_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!this.#connected && Date.now() < deadline && !this.#stopping) {
      await delay(10);
    }
    return this.#connected;
  }

  async stop(): Promise<void> {
    if (this.#stopping) return this.#loop;
    this.#stopping = true;
    this.#controller.abort();
    this.#disconnectResolver?.();
    await this.#loop;
  }

  async #run(): Promise<void> {
    let attempt = 0;
    while (!this.#stopping) {
      try {
        const client = await this.#pool.connect();
        this.#client = client;
        let resolveDisconnect: () => void = () => undefined;
        const disconnected = new Promise<void>((resolve) => {
          resolveDisconnect = resolve;
          this.#disconnectResolver = resolve;
        });
        const onError = () => resolveDisconnect();
        const onEnd = () => resolveDisconnect();
        const onNotification = (message: Notification) => {
          if (message.channel !== 'site_monitor_realtime_v1' || !message.payload) return;
          let value: unknown;
          try {
            value = JSON.parse(message.payload);
          } catch {
            this.#onInvalidPayload();
            return;
          }
          const parsed = internalRealtimeWakeupSchema.safeParse(value);
          if (!parsed.success) {
            this.#onInvalidPayload();
            return;
          }
          this.#onWakeup(parsed.data);
        };
        client.on('error', onError);
        client.on('end', onEnd);
        client.on('notification', onNotification);
        await client.query('LISTEN site_monitor_realtime_v1');
        this.#connected = true;
        this.#connectedOnce = true;
        this.#disconnectAt = undefined;
        attempt = 0;
        this.#logger.info({}, 'realtime listener connected');
        await disconnected;
        this.#connected = false;
        this.#disconnectAt = Date.now();
        if (!this.#stopping) this.#onRestart();
        client.removeListener('error', onError);
        client.removeListener('end', onEnd);
        client.removeListener('notification', onNotification);
        client.release(true);
        this.#client = undefined;
        this.#disconnectResolver = undefined;
      } catch (error) {
        this.#connected = false;
        this.#disconnectAt = Date.now();
        this.#logger.error({ error_code: safeCode(error) }, 'realtime listener iteration failed');
        if (this.#client) {
          this.#client.release(true);
          this.#client = undefined;
        }
      }
      if (this.#stopping) break;
      attempt += 1;
      const cap = Math.min(30_000, 250 * 2 ** Math.min(attempt, 7));
      try {
        await delay(Math.max(50, Math.floor(Math.random() * cap)), undefined, {
          signal: this.#controller.signal,
        });
      } catch {
        if (!this.#stopping) throw new Error('Realtime listener backoff was interrupted.');
      }
    }
  }
}
