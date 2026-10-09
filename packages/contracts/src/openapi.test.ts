import { describe, expect, it } from 'vitest';

import { openApiOperations } from './openapi.js';

describe('generated OpenAPI runtime contract', () => {
  it('contains every reviewed operation', () => {
    const operationIds = Object.keys(openApiOperations);
    expect(operationIds).toHaveLength(57);
    expect(new Set(operationIds).size).toBe(57);
  });

  it('provides runtime request and response schemas', () => {
    expect(openApiOperations.createCheck.routeSchema.body).toMatchObject({
      allOf: expect.any(Array),
      unevaluatedProperties: false,
    });
    expect(openApiOperations.createCheck.routeSchema.headers).toMatchObject({ type: 'object' });
    expect(openApiOperations.getLiveness.routeSchema.response[200]).toMatchObject({
      additionalProperties: false,
      type: 'object',
    });
  });

  it('publishes security and retry metadata from the canonical contract', () => {
    expect(openApiOperations.createCheck).toMatchObject({
      authentication: 'cookie',
      csrfRequired: true,
      idempotencyRequired: true,
      preconditionRequired: false,
    });
    expect(openApiOperations.requestManualRun).toMatchObject({
      csrfRequired: true,
      idempotencyRequired: true,
      preconditionRequired: true,
    });
    expect(openApiOperations.getPublicStatusPage).toMatchObject({
      authentication: 'public',
      csrfRequired: false,
    });
  });
});
