import { z } from 'zod';

import { decimalVersionSchema } from './http.js';

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

function realtimeEnvelope(eventType: z.ZodType) {
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
