import { describe, expect, it } from 'vitest';

import {
  domainEventEnvelopeSchema,
  idempotencyKeySchema,
  problemDetailsSchema,
  publicRealtimeEventSchema,
  resourceEtagSchema,
  serviceHealthSchema,
} from './index.js';

describe('serviceHealthSchema', () => {
  it('accepts a valid health response', () => {
    const value = {
      service: 'api',
      status: 'ok',
      timestamp: '2026-10-09T17:00:00.000Z',
      version: '0.1.0',
    };

    expect(serviceHealthSchema.parse(value)).toEqual(value);
  });
});

describe('HTTP contract schemas', () => {
  it('accepts a complete RFC 9457-compatible problem response', () => {
    const problem = {
      code: 'validation_failed',
      detail: 'One or more fields are invalid.',
      errors: [{ code: 'invalid_value', message: 'The field is invalid.', pointer: '/name' }],
      instance: '/api/v1/checks',
      request_id: '0192f82c-2f28-7448-8cc1-334f117c0630',
      retryable: false,
      status: 422,
      title: 'Request validation failed',
      type: 'https://status-monitor.example/problems/validation-failed',
    };

    expect(problemDetailsSchema.parse(problem)).toEqual(problem);
  });

  it('enforces idempotency key and resource ETag syntax', () => {
    expect(idempotencyKeySchema.safeParse('retry-key-0001').success).toBe(true);
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(resourceEtagSchema.safeParse('"rv-42"').success).toBe(true);
    expect(resourceEtagSchema.safeParse('W/"rv-42"').success).toBe(false);
  });
});

describe('event contract schemas', () => {
  it('validates the common domain event envelope', () => {
    const event = {
      aggregate_id: '0192f7c8-548e-7c43-9f79-93cbf7eaf831',
      aggregate_type: 'check_state',
      aggregate_version: '18',
      causation_id: null,
      correlation_id: '0192f82c-08e8-77d0-8f85-29888b2a718d',
      event_id: '0192f82c-f949-72d8-bef2-461c4484df2c',
      event_type: 'check.health_changed',
      occurred_at: '2026-10-10T03:10:11.482Z',
      owner_id: '0192f7a7-dbd6-762b-9495-47ee57ef0f80',
      payload: { health: 'DOWN' },
      recorded_at: '2026-10-10T03:10:11.489Z',
      schema_version: 1,
    };

    expect(domainEventEnvelopeSchema.parse(event)).toEqual(event);
  });

  it('keeps the public realtime event allowlist narrow', () => {
    const base = {
      event_id: '0192f902-5e39-7d40-a565-8d881fd07a67',
      occurred_at: '2026-10-10T03:24:51.104Z',
      payload: { page_revision: '3' },
      resource: { id: 'public', type: 'status_page', version: '3' },
      schema_version: 1,
    };

    expect(
      publicRealtimeEventSchema.safeParse({ ...base, event_type: 'status_page.updated' }).success,
    ).toBe(true);
    expect(
      publicRealtimeEventSchema.safeParse({ ...base, event_type: 'check.status_changed' }).success,
    ).toBe(false);
  });
});
