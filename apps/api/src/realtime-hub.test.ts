import { randomUUID } from 'node:crypto';

import type { ApiRealtimeRuntimeConfig } from '@site-monitor/config';
import type { PrivateRealtimeEvent } from '@site-monitor/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RealtimeHub, type RealtimeTransport } from './realtime-hub.js';

const hubs: RealtimeHub[] = [];

afterEach(async () => {
  await Promise.all(hubs.splice(0).map(async (hub) => hub.shutdown()));
});

function config(overrides: Partial<ApiRealtimeRuntimeConfig> = {}): ApiRealtimeRuntimeConfig {
  return {
    globalConnectionLimit: 4,
    heartbeatMs: 60_000,
    ipConnectionLimit: 4,
    listenerGraceMs: 100,
    ownerConnectionLimit: 4,
    projectionConcurrency: 2,
    projectionQueueLimit: 16,
    queueByteLimit: 16_384,
    queueEventLimit: 4,
    sessionConnectionLimit: 2,
    sessionRevalidateBatchSize: 2,
    sessionRevalidateMs: 60_000,
    shutdownGraceMs: 100,
    ...overrides,
  };
}

function fakeTransport(backpressure = false): RealtimeTransport & {
  close(): void;
  drain(): void;
  endSpy: ReturnType<typeof vi.fn>;
  frames: string[];
} {
  let closeHandler: () => void = () => undefined;
  let drainHandler: () => void = () => undefined;
  const endSpy = vi.fn();
  return {
    close: () => closeHandler(),
    drain: () => drainHandler(),
    end: endSpy,
    endSpy,
    frames: [],
    onClose: (callback) => {
      closeHandler = callback;
    },
    onDrain: (callback) => {
      drainHandler = callback;
    },
    write(frame) {
      this.frames.push(frame);
      return !backpressure;
    },
  };
}

function changed(id: string, version: string, eventId = randomUUID()): PrivateRealtimeEvent {
  return {
    event_id: eventId,
    event_type: 'check.changed',
    occurred_at: new Date().toISOString(),
    payload: { changed_fields: ['name'] },
    resource: { id, type: 'check', version },
    schema_version: 1,
  };
}

function subscribe(
  hub: RealtimeHub,
  ownerId: string,
  sessionId: string,
  output: RealtimeTransport,
) {
  const id = hub.subscribe({
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ipAddress: '127.0.0.1',
    ownerId,
    sessionId,
    transport: output,
    validateSession: () => Promise.resolve(true),
  });
  hub.start(id);
  return id;
}

describe('realtime owner hub', () => {
  it('routes only to the matching owner and closes a revoked session', () => {
    const hub = new RealtimeHub(config(), Buffer.alloc(32, 7));
    hubs.push(hub);
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const sessionA = randomUUID();
    const outputA = fakeTransport();
    const outputB = fakeTransport();
    subscribe(hub, ownerA, sessionA, outputA);
    subscribe(hub, ownerB, randomUUID(), outputB);
    outputA.frames.length = 0;
    outputB.frames.length = 0;

    hub.publish(ownerA, changed(randomUUID(), '2'));
    expect(outputA.frames).toHaveLength(1);
    expect(outputB.frames).toEqual([]);
    hub.closeSession(sessionA);
    expect(outputA.endSpy).toHaveBeenCalledOnce();
    expect(hub.connectionCount).toBe(1);
  });

  it('coalesces a backpressured resource at its newest version', () => {
    const hub = new RealtimeHub(config(), Buffer.alloc(32, 8));
    hubs.push(hub);
    const output = fakeTransport(true);
    const ownerId = randomUUID();
    const resourceId = randomUUID();
    const connectionId = subscribe(hub, ownerId, randomUUID(), output);
    output.frames.length = 0;
    hub.publish(ownerId, changed(resourceId, '2'));
    hub.publish(ownerId, changed(resourceId, '4'));
    hub.publish(ownerId, changed(resourceId, '3'));
    output.drain();

    expect(output.frames).toHaveLength(1);
    expect(output.frames[0]).toContain('"version":"4"');
    hub.close(connectionId);
  });

  it('rejects excess session connections before opening a stream', () => {
    const hub = new RealtimeHub(config({ sessionConnectionLimit: 1 }), Buffer.alloc(32, 9));
    hubs.push(hub);
    const ownerId = randomUUID();
    const sessionId = randomUUID();
    subscribe(hub, ownerId, sessionId, fakeTransport());
    expect(() => subscribe(hub, ownerId, sessionId, fakeTransport())).toThrow(
      'realtime connection capacity',
    );
  });

  it('disconnects only the slow connection when its bounded queue overflows', () => {
    const hub = new RealtimeHub(config({ queueEventLimit: 1 }), Buffer.alloc(32, 10));
    hubs.push(hub);
    const ownerId = randomUUID();
    const slow = fakeTransport(true);
    const fast = fakeTransport();
    subscribe(hub, ownerId, randomUUID(), slow);
    subscribe(hub, ownerId, randomUUID(), fast);
    slow.frames.length = 0;
    fast.frames.length = 0;

    hub.publish(ownerId, changed(randomUUID(), '1'));
    hub.publish(ownerId, changed(randomUUID(), '1'));

    expect(slow.frames.some((frame) => frame.includes('BUFFER_OVERFLOW'))).toBe(true);
    expect(slow.endSpy).toHaveBeenCalledOnce();
    expect(fast.frames).toHaveLength(2);
    expect(fast.endSpy).not.toHaveBeenCalled();
    expect(hub.connectionCount).toBe(1);
  });
});
