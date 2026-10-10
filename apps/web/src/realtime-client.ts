import { privateRealtimeEventSchema, type PrivateRealtimeEvent } from '@site-monitor/contracts';

import { apiUrl } from './api-client.js';

export type RealtimeConnectionState = 'connecting' | 'live' | 'polling' | 'reconnecting';

export interface EventStreamMessage {
  data: string;
  event: string;
  id: string;
}

export class EventStreamParser {
  readonly #decoder = new TextDecoder();
  readonly #onComment: () => void;
  readonly #onMessage: (message: EventStreamMessage) => void;
  #buffer = '';
  #data: string[] = [];
  #event = 'message';
  #id = '';

  constructor(input: { onComment?: () => void; onMessage: (message: EventStreamMessage) => void }) {
    this.#onComment = input.onComment ?? (() => undefined);
    this.#onMessage = input.onMessage;
  }

  push(chunk: Uint8Array): void {
    this.#buffer += this.#decoder.decode(chunk, { stream: true });
    this.#consumeCompleteLines();
  }

  finish(): void {
    this.#buffer += this.#decoder.decode();
    this.#consumeCompleteLines();
    // An event without its terminating blank line is deliberately incomplete.
    this.#buffer = '';
    this.#resetEvent();
  }

  #consumeCompleteLines(): void {
    while (true) {
      const newline = this.#buffer.indexOf('\n');
      if (newline < 0) return;
      let line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.#line(line);
    }
  }

  #line(line: string): void {
    if (line === '') {
      if (this.#data.length > 0) {
        this.#onMessage({ data: this.#data.join('\n'), event: this.#event, id: this.#id });
      }
      this.#resetEvent();
      return;
    }
    if (line.startsWith(':')) {
      this.#onComment();
      return;
    }
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.#data.push(value);
    else if (field === 'event') this.#event = value;
    else if (field === 'id' && !value.includes('\0')) this.#id = value;
  }

  #resetEvent(): void {
    this.#data = [];
    this.#event = 'message';
    this.#id = '';
  }
}

export class RealtimeResponseError extends Error {
  readonly retryAfterMs: number | undefined;
  readonly status: number;

  constructor(status: number, retryAfterMs?: number) {
    super(`Realtime endpoint returned HTTP ${status}.`);
    this.name = 'RealtimeResponseError';
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

export class RealtimeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RealtimeProtocolError';
  }
}

export class RealtimeStaleError extends Error {
  constructor() {
    super('Realtime stream became stale.');
    this.name = 'RealtimeStaleError';
  }
}

function retryAfterMilliseconds(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const duration = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - now;
  if (!Number.isFinite(duration)) return undefined;
  return Math.min(300_000, Math.max(0, duration));
}

export function reconnectDelayMs(attempt: number, random = Math.random): number {
  const cap = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  return Math.max(100, Math.floor(random() * cap));
}

function validatedEvent(message: EventStreamMessage): PrivateRealtimeEvent {
  let value: unknown;
  try {
    value = JSON.parse(message.data);
  } catch {
    throw new RealtimeProtocolError('Realtime event data is not valid JSON.');
  }
  const parsed = privateRealtimeEventSchema.safeParse(value);
  if (!parsed.success) throw new RealtimeProtocolError('Realtime event payload is invalid.');
  if (parsed.data.event_id !== message.id || parsed.data.event_type !== message.event) {
    throw new RealtimeProtocolError('Realtime event metadata does not match its payload.');
  }
  return parsed.data;
}

export interface ReadPrivateRealtimeInput {
  fetch?: typeof fetch;
  onEvent(event: PrivateRealtimeEvent): void;
  signal: AbortSignal;
  staleMs?: number;
  url?: string;
}

export async function readPrivateRealtime(input: ReadPrivateRealtimeInput): Promise<void> {
  const fetchImplementation = input.fetch ?? fetch;
  const controller = new AbortController();
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let stale = false;
  let staleTimer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => {
    controller.abort(input.signal.reason);
    void activeReader?.cancel();
  };
  input.signal.addEventListener('abort', abort, { once: true });
  const refreshStaleTimer = () => {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      stale = true;
      controller.abort();
      void activeReader?.cancel();
    }, input.staleMs ?? 45_000);
  };

  try {
    const response = await fetchImplementation(input.url ?? apiUrl('/api/v1/events'), {
      credentials: 'include',
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new RealtimeResponseError(
        response.status,
        retryAfterMilliseconds(response.headers.get('retry-after')),
      );
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
      throw new RealtimeProtocolError('Realtime endpoint returned an unexpected media type.');
    }
    if (!response.body) throw new RealtimeProtocolError('Realtime response has no body.');

    const parser = new EventStreamParser({
      onMessage: (message) => input.onEvent(validatedEvent(message)),
    });
    const reader = response.body.getReader();
    activeReader = reader;
    refreshStaleTimer();
    while (true) {
      const result = await reader.read();
      if (result.done) {
        if (stale) throw new RealtimeStaleError();
        parser.finish();
        return;
      }
      if (result.value.byteLength > 0) refreshStaleTimer();
      parser.push(result.value);
    }
  } catch (cause) {
    if (stale) throw new RealtimeStaleError();
    throw cause;
  } finally {
    if (staleTimer) clearTimeout(staleTimer);
    activeReader?.releaseLock();
    input.signal.removeEventListener('abort', abort);
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

interface RealtimeStreamPortInput {
  onEvent(event: PrivateRealtimeEvent): void;
  signal: AbortSignal;
}

export interface PrivateRealtimeSyncOptions {
  document?: Document;
  onAuthLost(): void;
  onState(state: RealtimeConnectionState): void;
  random?: () => number;
  reconcile(): Promise<void>;
  stream?: (input: RealtimeStreamPortInput) => Promise<void>;
}

export class PrivateRealtimeSync {
  readonly #controller = new AbortController();
  readonly #document: Document | undefined;
  readonly #onAuthLost: () => void;
  readonly #onState: (state: RealtimeConnectionState) => void;
  readonly #random: () => number;
  readonly #reconcile: () => Promise<void>;
  readonly #stream: (input: RealtimeStreamPortInput) => Promise<void>;
  #activeGeneration = 0;
  #dirty = false;
  #failures = 0;
  #pollTimer: ReturnType<typeof setTimeout> | undefined;
  #reconcilePromise: Promise<boolean> | undefined;
  #reconcileTimer: ReturnType<typeof setInterval> | undefined;
  #readyGeneration = 0;
  #stableTimer: ReturnType<typeof setTimeout> | undefined;
  #started = false;
  #state: RealtimeConnectionState = 'connecting';

  constructor(options: PrivateRealtimeSyncOptions) {
    this.#document = options.document ?? (typeof document === 'undefined' ? undefined : document);
    this.#onAuthLost = () => options.onAuthLost();
    this.#onState = (state) => options.onState(state);
    this.#random = options.random ?? Math.random;
    this.#reconcile = () => options.reconcile();
    this.#stream = options.stream ?? readPrivateRealtime;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#setState('connecting');
    this.#document?.addEventListener('visibilitychange', this.#visibilityChanged);
    this.#reconcileTimer = setInterval(() => {
      if (this.#visible() && this.#state === 'live') void this.#requestReconcile();
    }, 60_000);
    void this.#run();
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#controller.abort();
    this.#document?.removeEventListener('visibilitychange', this.#visibilityChanged);
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    if (this.#reconcileTimer) clearInterval(this.#reconcileTimer);
    if (this.#stableTimer) clearTimeout(this.#stableTimer);
  }

  readonly #visibilityChanged = () => {
    if (this.#visible()) void this.#requestReconcile();
  };

  #visible(): boolean {
    return !this.#document || this.#document.visibilityState !== 'hidden';
  }

  #setState(state: RealtimeConnectionState): void {
    if (state === this.#state && this.#started) return;
    this.#state = state;
    this.#onState(state);
  }

  async #run(): Promise<void> {
    while (!this.#controller.signal.aborted) {
      const generation = ++this.#activeGeneration;
      let readyAt: number | undefined;
      try {
        await this.#stream({
          onEvent: (event) => {
            if (event.event_type === 'stream.ready') {
              readyAt = Date.now();
              this.#readyGeneration = generation;
              void this.#synchronizeReady(generation);
              return;
            }
            this.#dirty = true;
            if (this.#readyGeneration !== generation) return;
            void this.#requestReconcile();
          },
          signal: this.#controller.signal,
        });
        if (this.#controller.signal.aborted) return;
        throw new RealtimeProtocolError('Realtime stream closed unexpectedly.');
      } catch (cause) {
        if (this.#controller.signal.aborted) return;
        this.#activeGeneration += 1;
        if (cause instanceof RealtimeResponseError && [401, 403].includes(cause.status)) {
          this.#onAuthLost();
          this.stop();
          return;
        }
        if (this.#stableTimer) clearTimeout(this.#stableTimer);
        const stable = readyAt !== undefined && Date.now() - readyAt >= 30_000;
        this.#failures = stable ? 1 : this.#failures + 1;
        if (this.#failures >= 3) this.#startPolling();
        this.#setState(this.#pollTimer ? 'polling' : 'reconnecting');
        const retryAfter = cause instanceof RealtimeResponseError ? cause.retryAfterMs : undefined;
        await abortableDelay(
          retryAfter ?? reconnectDelayMs(this.#failures, this.#random),
          this.#controller.signal,
        );
      }
    }
  }

  async #synchronizeReady(generation: number): Promise<void> {
    const synchronized = await this.#requestReconcile();
    if (!synchronized || generation !== this.#activeGeneration || this.#controller.signal.aborted) {
      return;
    }
    this.#setState('live');
    this.#stopPolling();
    if (this.#stableTimer) clearTimeout(this.#stableTimer);
    this.#stableTimer = setTimeout(() => {
      if (generation === this.#activeGeneration) this.#failures = 0;
    }, 30_000);
  }

  #requestReconcile(): Promise<boolean> {
    if (this.#reconcilePromise) {
      this.#dirty = true;
      return this.#reconcilePromise;
    }
    this.#reconcilePromise = (async () => {
      let succeeded = true;
      do {
        this.#dirty = false;
        if (!this.#visible()) break;
        try {
          await this.#reconcile();
        } catch {
          succeeded = false;
          this.#startPolling();
          this.#setState('polling');
        }
      } while (this.#dirty && !this.#controller.signal.aborted);
      return succeeded;
    })().finally(() => {
      this.#reconcilePromise = undefined;
    });
    return this.#reconcilePromise;
  }

  #startPolling(): void {
    if (this.#pollTimer || this.#controller.signal.aborted) return;
    const schedule = () => {
      const milliseconds = 30_000 + Math.floor(this.#random() * 5_000);
      this.#pollTimer = setTimeout(() => {
        this.#pollTimer = undefined;
        void this.#pollOnce(schedule);
      }, milliseconds);
    };
    schedule();
  }

  async #pollOnce(schedule: () => void): Promise<void> {
    if (this.#visible()) await this.#requestReconcile();
    if (this.#state === 'polling' && !this.#controller.signal.aborted) schedule();
  }

  #stopPolling(): void {
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    this.#pollTimer = undefined;
  }
}
