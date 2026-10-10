import { z } from 'zod';

import { domainEventTypeSchema } from './events.js';
import { decimalVersionSchema } from './http.js';

export const internalRealtimeWakeupSchema = z.strictObject({
  aggregate_id: z.uuid(),
  aggregate_type: z.string().min(1).max(100),
  aggregate_version: decimalVersionSchema.nullable(),
  event_id: z.uuid(),
  event_type: domainEventTypeSchema,
  occurred_at: z.iso.datetime({ offset: true }),
  owner_id: z.uuid(),
  v: z.literal(1),
});

export const privateRealtimeEventTypeSchema = z.enum([
  'stream.ready',
  'resync.required',
  'check.changed',
  'check.status_changed',
  'group.changed',
  'group.status_changed',
  'incident.changed',
  'maintenance.changed',
  'notification.changed',
  'public_page.changed',
  'prediction.changed',
]);

export const publicRealtimeEventTypeSchema = z.enum([
  'stream.ready',
  'resync.required',
  'status_page.updated',
]);

const realtimeResourceSchema = z.strictObject({
  id: z.string().min(1),
  type: z.string().min(1),
  version: decimalVersionSchema.nullable(),
});

function realtimeEnvelope<T extends z.ZodType<string>>(eventType: T) {
  return z.strictObject({
    event_id: z.uuid(),
    event_type: eventType,
    occurred_at: z.iso.datetime({ offset: true }),
    payload: z.record(z.string(), z.json()),
    resource: realtimeResourceSchema,
    schema_version: z.number().int().positive(),
  });
}

export const privateRealtimeEventSchema = realtimeEnvelope(privateRealtimeEventTypeSchema);
export const publicRealtimeEventSchema = realtimeEnvelope(publicRealtimeEventTypeSchema);

export type PrivateRealtimeEvent = z.infer<typeof privateRealtimeEventSchema>;
export type PublicRealtimeEvent = z.infer<typeof publicRealtimeEventSchema>;
export type InternalRealtimeWakeup = z.infer<typeof internalRealtimeWakeupSchema>;
