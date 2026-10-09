import { z } from 'zod';

export const serviceHealthSchema = z.object({
  service: z.string().min(1),
  status: z.enum(['ok', 'unavailable']),
  timestamp: z.iso.datetime(),
  version: z.string().min(1),
});

export type ServiceHealth = z.infer<typeof serviceHealthSchema>;
