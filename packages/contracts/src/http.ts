import { z } from 'zod';

export const problemCodeSchema = z.enum([
  'malformed_json',
  'invalid_request',
  'invalid_cursor',
  'invalid_precondition',
  'authentication_required',
  'invalid_credentials',
  'invalid_or_expired_token',
  'csrf_failed',
  'operation_forbidden',
  'resource_not_found',
  'public_page_not_found',
  'method_not_allowed',
  'not_acceptable',
  'invalid_state_transition',
  'maintenance_window_immutable',
  'idempotency_key_reused',
  'idempotency_in_progress',
  'resource_conflict',
  'quota_exceeded',
  'resource_version_mismatch',
  'payload_too_large',
  'unsupported_media_type',
  'validation_failed',
  'unprocessable_configuration',
  'precondition_required',
  'rate_limit_exceeded',
  'internal_error',
  'dependency_unavailable',
  'schema_incompatible',
]);

export const validationIssueSchema = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_]*$/),
  message: z.string().min(1),
  pointer: z.string().startsWith('/'),
});

export const problemDetailsSchema = z.strictObject({
  code: problemCodeSchema,
  detail: z.string().min(1),
  errors: z.array(validationIssueSchema).min(1).optional(),
  instance: z.string().startsWith('/'),
  request_id: z.uuid(),
  retry_after_seconds: z.number().int().nonnegative().optional(),
  retryable: z.boolean(),
  status: z.number().int().min(400).max(599),
  title: z.string().min(1),
  type: z.url(),
});

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[\x20-\x7E]+$/);

export const resourceEtagSchema = z.string().regex(/^"rv-[1-9][0-9]*"$/);
export const decimalVersionSchema = z.string().regex(/^[0-9]+$/);

export type ProblemCode = z.infer<typeof problemCodeSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
