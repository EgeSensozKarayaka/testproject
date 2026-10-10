import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { heartbeatFrame, resyncEvent, serializePrivateEvent } from './realtime-frames.js';

describe('realtime SSE frames', () => {
  it('keeps frame identity aligned with the validated JSON envelope', () => {
    const event = resyncEvent('VERSION_GAP', new Date('2026-10-10T12:00:00.000Z'));
    const frame = serializePrivateEvent(event);
    expect(frame).toContain(`id: ${event.event_id}\n`);
    expect(frame).toContain('event: resync.required\n');
    expect(frame).toContain(`"event_id":"${event.event_id}"`);
    expect(frame.endsWith('\n\n')).toBe(true);
  });

  it('rejects values outside the private event allowlist', () => {
    expect(() =>
      serializePrivateEvent({
        event_id: randomUUID(),
        event_type: 'check.health_changed',
        occurred_at: new Date().toISOString(),
        payload: {},
        resource: { id: randomUUID(), type: 'check', version: '1' },
        schema_version: 1,
      } as never),
    ).toThrow();
  });

  it('uses comments for heartbeat traffic', () => {
    expect(heartbeatFrame(new Date('2026-10-10T12:00:00.000Z'))).toBe(
      ': heartbeat 2026-10-10T12:00:00.000Z\n\n',
    );
  });
});
