import { problemDetailsSchema } from '@site-monitor/contracts';
import { createLogger } from '@site-monitor/observability';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApiApplication } from './app.js';
import { ApiProblemError } from './problem.js';

const applications: ReturnType<typeof buildApiApplication>[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (app) => app.close()));
});

function createApplication(readiness: () => Promise<boolean>) {
  const app = buildApiApplication({
    allowedOrigin: 'http://localhost:5173',
    logger: createLogger({ environment: 'test', service: 'api-test', version: '0.1.0' }),
    readiness,
    serviceName: 'api',
    version: '0.1.0',
  });
  applications.push(app);
  return app;
}

describe('API health contract', () => {
  it('reports liveness without checking dependencies', async () => {
    const app = createApplication(() => Promise.resolve(false));
    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ service: 'api', status: 'ok', version: '0.1.0' });
  });

  it('reports dependency failure through readiness', async () => {
    const app = createApplication(() => Promise.resolve(false));
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'unavailable' });
  });

  it('echoes a valid request id and replaces an invalid one with UUIDv7', async () => {
    const app = createApplication(() => Promise.resolve(true));
    const requestId = '0192f82c-2f28-7448-8cc1-334f117c0630';
    const accepted = await app.inject({
      headers: { 'x-request-id': requestId },
      method: 'GET',
      url: '/health/live',
    });
    const replaced = await app.inject({
      headers: { 'x-request-id': 'not-a-uuid' },
      method: 'GET',
      url: '/health/live',
    });

    expect(accepted.headers['x-request-id']).toBe(requestId);
    expect(replaced.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('allows the API mutation methods and concurrency headers in CORS preflight', async () => {
    const app = createApplication(() => Promise.resolve(true));
    const response = await app.inject({
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-headers': 'content-type,if-match,x-csrf-token',
        'access-control-request-method': 'PATCH',
      },
      method: 'OPTIONS',
      url: '/api/v1/checks/check-id',
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-methods']).toContain('PATCH');
    expect(response.headers['access-control-allow-methods']).toContain('DELETE');
    expect(response.headers['access-control-allow-headers']).toBe(
      'content-type,if-match,x-csrf-token',
    );
  });

  it('returns the central problem contract for unknown routes', async () => {
    const app = createApplication(() => Promise.resolve(true));
    const response = await app.inject({ method: 'GET', url: '/api/v1/missing?secret=nope' });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.headers['x-request-id']).toBe(body.request_id);
    expect(body).toMatchObject({
      code: 'resource_not_found',
      instance: '/api/v1/missing',
      retryable: false,
      status: 404,
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('distinguishes unsupported methods from missing resources', async () => {
    const app = createApplication(() => Promise.resolve(true));
    const response = await app.inject({ method: 'POST', url: '/health/live' });

    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toContain('GET');
    expect(response.json()).toMatchObject({ code: 'method_not_allowed', status: 405 });
  });

  it('maps explicit retryable application problems and Retry-After', async () => {
    const app = createApplication(() => Promise.resolve(true));
    app.get('/test/retry', () => {
      throw new ApiProblemError({
        code: 'idempotency_in_progress',
        detail: 'The operation is still being committed.',
        retryAfterSeconds: 2,
        retryable: true,
        status: 409,
      });
    });
    const response = await app.inject({ method: 'GET', url: '/test/retry' });

    expect(response.statusCode).toBe(409);
    expect(response.headers['retry-after']).toBe('2');
    expect(response.json()).toMatchObject({
      code: 'idempotency_in_progress',
      retry_after_seconds: 2,
      retryable: true,
    });
  });

  it('maps schema validation failures without echoing rejected values', async () => {
    const app = createApplication(() => Promise.resolve(true));
    app.post(
      '/test/validated',
      {
        schema: {
          body: {
            additionalProperties: false,
            properties: { name: { minLength: 1, type: 'string' } },
            required: ['name'],
            type: 'object',
          },
        },
      },
      () => ({ accepted: true }),
    );
    const secretValue = 'must-not-be-reflected';
    const response = await app.inject({
      method: 'POST',
      payload: { name: '', secret: secretValue },
      url: '/test/validated',
    });
    const body = problemDetailsSchema.parse(response.json());

    expect(response.statusCode).toBe(422);
    expect(body).toMatchObject({ code: 'validation_failed', status: 422 });
    const errors = body.errors ?? [];
    expect(errors).not.toHaveLength(0);
    expect(errors).toEqual(
      [...errors].sort((left, right) =>
        left.pointer === right.pointer
          ? left.code.localeCompare(right.code)
          : left.pointer.localeCompare(right.pointer),
      ),
    );
    expect(response.body).not.toContain(secretValue);
  });

  it('maps malformed JSON to the stable problem code', async () => {
    const app = createApplication(() => Promise.resolve(true));
    app.post('/test/json', () => ({ accepted: true }));
    const response = await app.inject({
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      payload: '{"name":',
      url: '/test/json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'malformed_json', status: 400 });
  });

  it('redacts public tokens in problem instances', async () => {
    const app = createApplication(() => Promise.resolve(true));
    const token = 'super-secret-public-token';
    const response = await app.inject({
      method: 'GET',
      url: `/api/public/v1/status-pages/${token}/missing`,
    });

    expect(response.json()).toMatchObject({
      instance: '/api/public/v1/status-pages/{redacted}/missing',
    });
    expect(response.body).not.toContain(token);
  });
});
