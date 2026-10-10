// @vitest-environment jsdom

import { randomUUID } from 'node:crypto';

import type { PrivateRealtimeEvent } from '@site-monitor/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EventStreamParser,
  PrivateRealtimeSync,
  RealtimeResponseError,
  RealtimeStaleError,
  readPrivateRealtime,
  reconnectDelayMs,
} from './realtime-client.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function event(eventType: PrivateRealtimeEvent['event_type']): PrivateRealtimeEvent {
  return {
    event_id: randomUUID(),
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    payload:
      eventType === 'stream.ready'
        ? {
            heartbeat_seconds: 15,
            replay_supported: false,
            scope: 'PRIVATE',
            snapshot_reconcile_seconds: 60,
          }
        : { changed_fields: ['name'] },
    resource:
      eventType === 'stream.ready'
        ? { id: 'private', type: 'stream', version: null }
        : { id: randomUUID(), type: 'check', version: '2' },
    schema_version: 1,
  };
}

describe('event stream parser', () => {
  it('handles split UTF-8, CRLF, comments and multiple data lines', () => {
    const messages: { data: string; event: string; id: string }[] = [];
    const onComment = vi.fn();
    const parser = new EventStreamParser({
      onComment,
      onMessage: (message) => messages.push(message),
    });
    const bytes = new TextEncoder().encode(
      ': heartbeat\r\nid: ö-event\r\nevent: sample\r\ndata: {"part":\r\ndata: true}\r\n\r\n',
    );
    parser.push(bytes.slice(0, 19));
    parser.push(bytes.slice(19, 27));
    parser.push(bytes.slice(27));
    parser.finish();

    expect(onComment).toHaveBeenCalledOnce();
    expect(messages).toEqual([{ data: '{"part":\ntrue}', event: 'sample', id: 'ö-event' }]);
  });

  it('does not dispatch an unterminated final event', () => {
    const onMessage = vi.fn();
    const parser = new EventStreamParser({ onMessage });
    parser.push(new TextEncoder().encode('event: sample\ndata: {}\n'));
    parser.finish();
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe('private realtime transport', () => {
  it('validates a private event and sends credentialed stream headers', async () => {
    const ready = event('stream.ready');
    const frame = `id: ${ready.event_id}\nevent: ${ready.event_type}\ndata: ${JSON.stringify(ready)}\n\n`;
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(frame, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } }),
      ),
    );
    const onEvent = vi.fn();
    await readPrivateRealtime({
      fetch: fetchImplementation,
      onEvent,
      signal: new AbortController().signal,
      staleMs: 1_000,
      url: 'https://api.example.test/api/v1/events',
    });

    expect(onEvent).toHaveBeenCalledWith(ready);
    const request = fetchImplementation.mock.calls[0];
    expect(request?.[0]).toBe('https://api.example.test/api/v1/events');
    expect(request?.[1]).toMatchObject({ credentials: 'include' });
    expect(new Headers(request?.[1]?.headers).get('Accept')).toBe('text/event-stream');
  });

  it('uses bounded full-jitter reconnect delays', () => {
    expect(reconnectDelayMs(1, () => 0)).toBe(100);
    expect(reconnectDelayMs(2, () => 0.5)).toBe(1_000);
    expect(reconnectDelayMs(20, () => 1)).toBe(30_000);
  });

  it('aborts a stream that remains silent past the stale deadline', async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );
    const reading = readPrivateRealtime({
      fetch: fetchImplementation,
      onEvent: () => undefined,
      signal: new AbortController().signal,
      staleMs: 45_000,
    });
    const rejected = expect(reading).rejects.toBeInstanceOf(RealtimeStaleError);
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
  });
});

describe('private realtime synchronization', () => {
  it('reconciles stream-before-snapshot and a concurrent invalidation without losing it', async () => {
    let releaseSnapshot: () => void = () => undefined;
    const firstSnapshot = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    const reconcile = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstSnapshot)
      .mockResolvedValue(undefined);
    let releaseStream: () => void = () => undefined;
    const stream = vi.fn(async (input: { onEvent(event: PrivateRealtimeEvent): void }) => {
      input.onEvent(event('stream.ready'));
      input.onEvent(event('check.changed'));
      await new Promise<void>((resolve) => {
        releaseStream = resolve;
      });
    });
    const states: string[] = [];
    const sync = new PrivateRealtimeSync({
      onAuthLost: () => undefined,
      onState: (state) => states.push(state),
      reconcile,
      stream,
    });
    sync.start();
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    releaseSnapshot();
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(states).toContain('live'));
    sync.stop();
    releaseStream();
  });

  it('stops reconnecting and expires auth after a 401 response', async () => {
    const onAuthLost = vi.fn();
    const sync = new PrivateRealtimeSync({
      onAuthLost,
      onState: () => undefined,
      reconcile: () => Promise.resolve(),
      stream: () => Promise.reject(new RealtimeResponseError(401)),
    });
    sync.start();
    await vi.waitFor(() => expect(onAuthLost).toHaveBeenCalledOnce());
    sync.stop();
  });

  it('enables polling fallback after three unstable connection cycles', async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const sync = new PrivateRealtimeSync({
      onAuthLost: () => undefined,
      onState: (state) => states.push(state),
      random: () => 0,
      reconcile: () => Promise.resolve(),
      stream: () => Promise.reject(new Error('offline')),
    });
    sync.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(states).toContain('polling');
    sync.stop();
  });
});
