import { randomUUID } from 'node:crypto';

import { privateRealtimeEventSchema, type PrivateRealtimeEvent } from '@site-monitor/contracts';

function singleLine(value: string, field: string): string {
  if (value.includes('\r') || value.includes('\n')) {
    throw new Error(`Realtime ${field} must not contain CR or LF.`);
  }
  return value;
}

export function serializePrivateEvent(event: PrivateRealtimeEvent): string {
  const parsed = privateRealtimeEventSchema.parse(event);
  if (parsed.event_id !== event.event_id || parsed.event_type !== event.event_type) {
    throw new Error('Realtime frame identity changed during validation.');
  }
  const id = singleLine(parsed.event_id, 'event id');
  const eventType = singleLine(parsed.event_type, 'event type');
  const data = JSON.stringify(parsed);
  if (data.includes('\n') || data.includes('\r')) {
    throw new Error('Realtime frame data must serialize to one line.');
  }
  return `id: ${id}\nevent: ${eventType}\ndata: ${data}\n\n`;
}

export function heartbeatFrame(now = new Date()): string {
  return `: heartbeat ${now.toISOString()}\n\n`;
}

export function streamReadyEvent(heartbeatSeconds: number, now = new Date()): PrivateRealtimeEvent {
  return privateRealtimeEventSchema.parse({
    event_id: randomUUID(),
    event_type: 'stream.ready',
    occurred_at: now.toISOString(),
    payload: {
      heartbeat_seconds: heartbeatSeconds,
      replay_supported: false,
      scope: 'PRIVATE',
      snapshot_reconcile_seconds: 60,
    },
    resource: { id: 'private', type: 'stream', version: null },
    schema_version: 1,
  });
}

export function resyncEvent(
  reason: 'BUFFER_OVERFLOW' | 'PROJECTION_INVALIDATED' | 'SUBSCRIBER_RESTARTED' | 'VERSION_GAP',
  now = new Date(),
): PrivateRealtimeEvent {
  return privateRealtimeEventSchema.parse({
    event_id: randomUUID(),
    event_type: 'resync.required',
    occurred_at: now.toISOString(),
    payload: { reason },
    resource: { id: 'private', type: 'stream', version: null },
    schema_version: 1,
  });
}

export function eventCoalescingKey(event: PrivateRealtimeEvent): string | undefined {
  if (event.event_type === 'stream.ready' || event.event_type === 'resync.required') {
    return undefined;
  }
  return `${event.event_type}:${event.resource.type}:${event.resource.id}`;
}
