import { PassThrough } from 'node:stream';

import { createLogger } from '@site-monitor/observability';
import pino, { type Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApiApplication } from './app.js';
import type { AuthServicePort } from './auth-routes.js';
import type { CheckDto, CheckServicePort } from './check-service.js';

const applications: ReturnType<typeof buildApiApplication>[] = [];
const ownerId = '00000000-0000-4000-8000-000000000001';
const checkId = '00000000-0000-4000-8000-000000000101';

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (app) => app.close()));
});

function check(overrides: Partial<CheckDto> = {}): CheckDto {
  return {
    created_at: '2026-10-10T00:00:00.000Z',
    execution_state: 'ACTIVE',
    expected_body_substring: null,
    expected_status_code: 200,
    group_id: null,
    id: checkId,
    interval_seconds: 30,
    name: 'Website',
    probe_generation: '1',
    resource_version: '1',
    schedule_generation: '1',
    timeout_ms: 5000,
    updated_at: '2026-10-10T00:00:00.000Z',
    url: 'https://example.com/',
    ...overrides,
  };
}

function authService(authenticated = true): AuthServicePort {
  return {
    confirmEmail: vi.fn(() => Promise.resolve()),
    confirmPasswordReset: vi.fn(() => Promise.resolve()),
    enforceRateLimit: vi.fn(() => Promise.resolve()),
    getSession: vi.fn(() =>
      Promise.resolve(
        authenticated
          ? {
              csrfToken: 'v1.valid-csrf-token-value',
              expiresAt: '2026-10-11T00:00:00.000Z',
              sessionId: '00000000-0000-4000-8000-000000000002',
              user: {
                created_at: '2026-10-10T00:00:00.000Z',
                display_name: 'Alice',
                email: 'alice@example.test',
                email_verified: true,
                id: ownerId,
                resource_version: '1',
              },
            }
          : null,
      ),
    ),
    login: vi.fn(() => Promise.reject(new Error('unused'))),
    logout: vi.fn(() => Promise.resolve()),
    register: vi.fn(() => Promise.resolve()),
    requestChallenge: vi.fn(() => Promise.resolve()),
    runAnonymousIdempotent: vi.fn<AuthServicePort['runAnonymousIdempotent']>((_input, operation) =>
      operation(),
    ),
    updateProfile: vi.fn(() => Promise.reject(new Error('unused'))),
    verifyCsrf: vi.fn(() => true),
  };
}

function checkService(overrides: Partial<CheckServicePort> = {}): CheckServicePort {
  return {
    create: vi.fn(() => Promise.resolve({ check: check(), replayed: false })),
    delete: vi.fn(() => Promise.resolve()),
    get: vi.fn(() => Promise.resolve(check())),
    list: vi.fn(() => Promise.resolve({ data: [], page: { has_more: false, next_cursor: null } })),
    pause: vi.fn(() =>
      Promise.resolve(
        check({ execution_state: 'PAUSED', resource_version: '2', schedule_generation: '2' }),
      ),
    ),
    requestManualRun: vi.fn(() =>
      Promise.resolve({
        check_id: checkId,
        disposition: 'ENQUEUED' as const,
        mode: 'STATEFUL' as const,
        request_id: '00000000-0000-7000-8000-000000000501',
        requested_at: '2026-10-10T00:00:01.000Z',
      }),
    ),
    resume: vi.fn(() =>
      Promise.resolve(check({ resource_version: '3', schedule_generation: '3' })),
    ),
    update: vi.fn(() => Promise.resolve(check({ name: 'Updated', resource_version: '2' }))),
    ...overrides,
  };
}

function application(
  auth: AuthServicePort,
  checks: CheckServicePort,
  logger: Logger = createLogger({ environment: 'test', service: 'api-test', version: '0.1.0' }),
) {
  const app = buildApiApplication({
    allowedOrigin: 'http://localhost:15173',
    authService: auth,
    checkService: checks,
    cookieSecure: false,
    logger,
    readiness: () => Promise.resolve(true),
    serviceName: 'api',
    version: '0.1.0',
  });
  applications.push(app);
  return app;
}

const browserHeaders = {
  cookie: 'site_monitor_session=valid-token',
  origin: 'http://localhost:15173',
  'sec-fetch-site': 'same-site',
  'x-csrf-token': 'v1.valid-csrf-token-value',
};

describe('check HTTP boundary', () => {
  it('requires authentication before listing owner checks', async () => {
    const service = checkService();
    const response = await application(authService(false), service).inject({
      method: 'GET',
      url: '/api/v1/checks',
    });

    expect(response.statusCode).toBe(401);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('creates a check with owner-only context and stable response metadata', async () => {
    const service = checkService();
    const payload = {
      expected_status_code: 200,
      interval_seconds: 30,
      name: 'Website',
      timeout_ms: 5000,
      url: 'https://example.com',
    };
    const response = await application(authService(), service).inject({
      headers: {
        ...browserHeaders,
        'content-type': 'application/json',
        'idempotency-key': 'check-create-001',
      },
      method: 'POST',
      payload,
      url: '/api/v1/checks',
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe(`/api/v1/checks/${checkId}`);
    expect(response.headers.etag).toBe('"rv-1"');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.create).toHaveBeenCalledWith(
      ownerId,
      payload,
      'check-create-001',
      expect.any(String),
    );
  });

  it('does not write target URLs or expected body text to request logs', async () => {
    const output = new PassThrough();
    let logs = '';
    output.on('data', (chunk: Buffer) => {
      logs += chunk.toString('utf8');
    });
    const logger = pino({ level: 'info' }, output);
    const target = 'https://sensitive.example.test/health?credential=never-log-this';
    const expectedText = 'private-response-marker-never-log-this';
    const response = await application(authService(), checkService(), logger).inject({
      headers: {
        ...browserHeaders,
        'content-type': 'application/json',
        'idempotency-key': 'check-log-redaction-001',
      },
      method: 'POST',
      payload: {
        expected_body_substring: expectedText,
        expected_status_code: 200,
        interval_seconds: 30,
        name: 'Sensitive target',
        timeout_ms: 5000,
        url: target,
      },
      url: '/api/v1/checks',
    });

    expect(response.statusCode).toBe(201);
    expect(logs).toContain('/api/v1/checks');
    expect(logs).not.toContain(target);
    expect(logs).not.toContain('credential=never-log-this');
    expect(logs).not.toContain(expectedText);
  });

  it('passes query filters to the signed-cursor list service', async () => {
    const service = checkService();
    const response = await application(authService(), service).inject({
      headers: { cookie: browserHeaders.cookie },
      method: 'GET',
      url: '/api/v1/checks?limit=25&health=UNKNOWN&execution_state=PAUSED&freshness=STALE',
    });

    expect(response.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(ownerId, {
      executionState: 'PAUSED',
      freshness: 'STALE',
      health: 'UNKNOWN',
      limit: 25,
    });
  });

  it('updates and pauses with strong If-Match preconditions', async () => {
    const service = checkService();
    const app = application(authService(), service);
    const update = await app.inject({
      headers: {
        ...browserHeaders,
        'content-type': 'application/json',
        'if-match': '"rv-1"',
      },
      method: 'PATCH',
      payload: { name: 'Updated' },
      url: `/api/v1/checks/${checkId}`,
    });
    const pause = await app.inject({
      headers: { ...browserHeaders, 'if-match': '"rv-1"' },
      method: 'POST',
      url: `/api/v1/checks/${checkId}/pause`,
    });

    expect(update.statusCode).toBe(200);
    expect(update.headers.etag).toBe('"rv-2"');
    expect(pause.statusCode).toBe(200);
    expect(pause.headers.etag).toBe('"rv-2"');
    expect(service.pause).toHaveBeenCalledWith(ownerId, checkId, '1', expect.any(String));
  });

  it('accepts a durable manual run without changing the check ETag', async () => {
    const auth = authService();
    const service = checkService();
    const response = await application(auth, service).inject({
      headers: {
        ...browserHeaders,
        'idempotency-key': 'manual-run-001',
        'if-match': '"rv-1"',
      },
      method: 'POST',
      url: `/api/v1/checks/${checkId}/runs`,
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers.etag).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.requestManualRun).toHaveBeenCalledWith(
      ownerId,
      checkId,
      '1',
      'manual-run-001',
      expect.any(String),
    );
    expect(auth.enforceRateLimit).toHaveBeenCalledWith(
      'checks.manual.check',
      `${ownerId}:${checkId}`,
      30,
      60,
    );
  });

  it('soft-deletes through the command service', async () => {
    const service = checkService();
    const response = await application(authService(), service).inject({
      headers: { ...browserHeaders, 'if-match': '"rv-1"' },
      method: 'DELETE',
      url: `/api/v1/checks/${checkId}`,
    });

    expect(response.statusCode).toBe(204);
    expect(service.delete).toHaveBeenCalledWith(ownerId, checkId, '1', expect.any(String));
  });
});
