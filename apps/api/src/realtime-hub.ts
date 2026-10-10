import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { ApiRealtimeRuntimeConfig } from '@site-monitor/config';
import type { PrivateRealtimeEvent } from '@site-monitor/contracts';

import { ApiProblemError } from './problem.js';
import {
  eventCoalescingKey,
  heartbeatFrame,
  resyncEvent,
  serializePrivateEvent,
  streamReadyEvent,
} from './realtime-frames.js';

export interface RealtimeTransport {
  end(): void;
  onClose(callback: () => void): void;
  onDrain(callback: () => void): void;
  write(frame: string): boolean;
}

export interface RealtimeSubscriptionInput {
  expiresAt: string;
  ipAddress: string;
  ownerId: string;
  sessionId: string;
  transport: RealtimeTransport;
  validateSession: () => Promise<boolean>;
}

interface QueuedFrame {
  bytes: number;
  event: PrivateRealtimeEvent;
  frame: string;
  key: string | undefined;
}

interface ConnectionRecord extends RealtimeSubscriptionInput {
  backpressured: boolean;
  closed: boolean;
  id: string;
  ipDigest: string;
  queuedBytes: number;
  queue: QueuedFrame[];
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function decrement(map: Map<string, number>, key: string): void {
  const next = (map.get(key) ?? 1) - 1;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}

function newerOrEqual(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return true;
  return BigInt(left) >= BigInt(right);
}

export class RealtimeHub {
  readonly #admissionKey: Buffer;
  readonly #config: ApiRealtimeRuntimeConfig;
  readonly #connections = new Map<string, ConnectionRecord>();
  readonly #ipCounts = new Map<string, number>();
  readonly #ownerConnections = new Map<string, Set<string>>();
  readonly #ownerCounts = new Map<string, number>();
  readonly #sessionConnections = new Map<string, Set<string>>();
  readonly #sessionCounts = new Map<string, number>();
  #closed = false;
  #heartbeatTimer: NodeJS.Timeout;
  #revalidationTimer: NodeJS.Timeout;
  #revalidationCursor = 0;

  constructor(config: ApiRealtimeRuntimeConfig, admissionKey: Buffer) {
    this.#config = config;
    this.#admissionKey = admissionKey;
    this.#heartbeatTimer = setInterval(() => this.#heartbeat(), config.heartbeatMs);
    const batches = Math.max(
      1,
      Math.ceil(config.globalConnectionLimit / config.sessionRevalidateBatchSize),
    );
    const interval = Math.max(1_000, Math.floor(config.sessionRevalidateMs / batches));
    this.#revalidationTimer = setInterval(() => void this.#revalidateBatch(), interval);
    this.#heartbeatTimer.unref();
    this.#revalidationTimer.unref();
  }

  get connectionCount(): number {
    return this.#connections.size;
  }

  hasOwner(ownerId: string): boolean {
    return (this.#ownerCounts.get(ownerId) ?? 0) > 0;
  }

  subscribe(input: RealtimeSubscriptionInput): string {
    if (this.#closed) throw this.#capacityProblem();
    const ipDigest = createHmac('sha256', this.#admissionKey)
      .update(`realtime-ip\0${input.ipAddress}`, 'utf8')
      .digest('hex');
    if (
      this.#connections.size >= this.#config.globalConnectionLimit ||
      (this.#ownerCounts.get(input.ownerId) ?? 0) >= this.#config.ownerConnectionLimit ||
      (this.#sessionCounts.get(input.sessionId) ?? 0) >= this.#config.sessionConnectionLimit ||
      (this.#ipCounts.get(ipDigest) ?? 0) >= this.#config.ipConnectionLimit
    ) {
      throw this.#capacityProblem();
    }

    const id = randomUUID();
    const record: ConnectionRecord = {
      ...input,
      backpressured: false,
      closed: false,
      id,
      ipDigest,
      queuedBytes: 0,
      queue: [],
    };
    this.#connections.set(id, record);
    increment(this.#ownerCounts, record.ownerId);
    increment(this.#sessionCounts, record.sessionId);
    increment(this.#ipCounts, record.ipDigest);
    const ownerSet = this.#ownerConnections.get(record.ownerId) ?? new Set<string>();
    ownerSet.add(id);
    this.#ownerConnections.set(record.ownerId, ownerSet);
    const sessionSet = this.#sessionConnections.get(record.sessionId) ?? new Set<string>();
    sessionSet.add(id);
    this.#sessionConnections.set(record.sessionId, sessionSet);
    input.transport.onClose(() => this.close(id));
    input.transport.onDrain(() => this.#flush(record));

    const expiresIn = Math.max(0, new Date(record.expiresAt).getTime() - Date.now());
    const expiryTimer = setTimeout(() => this.close(id), expiresIn);
    expiryTimer.unref();
    input.transport.onClose(() => clearTimeout(expiryTimer));
    return id;
  }

  start(id: string): void {
    const record = this.#connections.get(id);
    if (record) this.#send(record, streamReadyEvent(this.#config.heartbeatMs / 1_000));
  }

  publish(ownerId: string, event: PrivateRealtimeEvent): void {
    for (const id of this.#ownerConnections.get(ownerId) ?? []) {
      const record = this.#connections.get(id);
      if (record) this.#send(record, event);
    }
  }

  resyncOwner(
    ownerId: string,
    reason: 'BUFFER_OVERFLOW' | 'PROJECTION_INVALIDATED' | 'SUBSCRIBER_RESTARTED' | 'VERSION_GAP',
  ): void {
    for (const id of this.#ownerConnections.get(ownerId) ?? []) {
      const record = this.#connections.get(id);
      if (record) this.#send(record, resyncEvent(reason));
    }
  }

  resyncAll(
    reason: 'BUFFER_OVERFLOW' | 'PROJECTION_INVALIDATED' | 'SUBSCRIBER_RESTARTED' | 'VERSION_GAP',
  ): void {
    for (const record of this.#connections.values()) this.#send(record, resyncEvent(reason));
  }

  closeSession(sessionId: string): void {
    for (const id of [...(this.#sessionConnections.get(sessionId) ?? [])]) this.close(id);
  }

  close(id: string): void {
    const record = this.#connections.get(id);
    if (!record || record.closed) return;
    record.closed = true;
    this.#connections.delete(id);
    decrement(this.#ownerCounts, record.ownerId);
    decrement(this.#sessionCounts, record.sessionId);
    decrement(this.#ipCounts, record.ipDigest);
    const ownerSet = this.#ownerConnections.get(record.ownerId);
    ownerSet?.delete(id);
    if (ownerSet?.size === 0) this.#ownerConnections.delete(record.ownerId);
    const sessionSet = this.#sessionConnections.get(record.sessionId);
    sessionSet?.delete(id);
    if (sessionSet?.size === 0) this.#sessionConnections.delete(record.sessionId);
    record.queue.length = 0;
    record.queuedBytes = 0;
    record.transport.end();
  }

  async shutdown(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#heartbeatTimer);
    clearInterval(this.#revalidationTimer);
    for (const record of this.#connections.values()) {
      try {
        record.transport.write(serializePrivateEvent(resyncEvent('SUBSCRIBER_RESTARTED')));
      } finally {
        this.close(record.id);
      }
    }
    await delay(Math.min(this.#config.shutdownGraceMs, 10));
  }

  #capacityProblem(): ApiProblemError {
    return new ApiProblemError({
      code: 'rate_limit_exceeded',
      detail: 'The realtime connection capacity has been reached. Try again later.',
      retryAfterSeconds: 5,
      retryable: true,
      status: 429,
    });
  }

  #send(record: ConnectionRecord, event: PrivateRealtimeEvent): void {
    if (record.closed) return;
    let frame: string;
    try {
      frame = serializePrivateEvent(event);
    } catch {
      this.#overflow(record, 'PROJECTION_INVALIDATED');
      return;
    }
    if (!record.backpressured && record.queue.length === 0) {
      record.backpressured = !record.transport.write(frame);
      return;
    }

    const key = eventCoalescingKey(event);
    const existingIndex = key ? record.queue.findIndex((item) => item.key === key) : -1;
    if (existingIndex >= 0) {
      const existing = record.queue[existingIndex]!;
      if (!newerOrEqual(event.resource.version, existing.event.resource.version)) return;
      record.queuedBytes -= existing.bytes;
      record.queue.splice(existingIndex, 1);
    }
    const bytes = Buffer.byteLength(frame, 'utf8');
    if (
      record.queue.length + 1 > this.#config.queueEventLimit ||
      record.queuedBytes + bytes > this.#config.queueByteLimit
    ) {
      this.#overflow(record, 'BUFFER_OVERFLOW');
      return;
    }
    record.queue.push({ bytes, event, frame, key });
    record.queuedBytes += bytes;
  }

  #flush(record: ConnectionRecord): void {
    if (record.closed) return;
    record.backpressured = false;
    while (!record.backpressured && record.queue.length > 0) {
      const next = record.queue.shift()!;
      record.queuedBytes -= next.bytes;
      record.backpressured = !record.transport.write(next.frame);
    }
  }

  #overflow(record: ConnectionRecord, reason: 'BUFFER_OVERFLOW' | 'PROJECTION_INVALIDATED'): void {
    if (record.closed) return;
    try {
      record.transport.write(serializePrivateEvent(resyncEvent(reason)));
    } finally {
      this.close(record.id);
    }
  }

  #heartbeat(): void {
    const frame = heartbeatFrame();
    for (const record of this.#connections.values()) {
      if (record.closed || record.backpressured || record.queue.length > 0) continue;
      record.backpressured = !record.transport.write(frame);
    }
  }

  async #revalidateBatch(): Promise<void> {
    const records = [...this.#connections.values()];
    if (records.length === 0) return;
    const batch: ConnectionRecord[] = [];
    for (
      let index = 0;
      index < Math.min(this.#config.sessionRevalidateBatchSize, records.length);
      index += 1
    ) {
      batch.push(records[(this.#revalidationCursor + index) % records.length]!);
    }
    this.#revalidationCursor =
      (this.#revalidationCursor + this.#config.sessionRevalidateBatchSize) % records.length;
    await Promise.all(
      batch.map(async (record) => {
        try {
          if (!(await record.validateSession())) this.close(record.id);
        } catch {
          this.close(record.id);
        }
      }),
    );
  }
}
