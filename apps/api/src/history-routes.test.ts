import { createLogger } from '@site-monitor/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApiApplication } from './app.js';
import type { AuthServicePort } from './auth-routes.js';
import type { HistoryResponseDto, HistoryServicePort } from './history-service.js';
import { ApiProblemError } from './problem.js';

const applications: ReturnType<typeof buildApiApplication>[] = [];
const ownerId = '00000000-0000-4000-8000-000000000001';
const checkId = '00000000-0000-4000-8000-000000000101';
const incidentId = '00000000-0000-4000-8000-000000000201';

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (app) => app.close()));
});

function authService(authenticated = true): AuthServicePort {
  return {
    confirmEmail: vi.fn(() => Promise.resolve()),
    confirmPasswordReset: vi.fn(() => Promise.resolve()),
    enforceRateLimit: vi.fn(() => Promise.resolve()),
    getSession: vi.fn(() =>
      Promise.resolve(
        authenticated
          ? {
              csrfToken: 'v1.csrf',
              expiresAt: '2026-10-11T00:00:00.000Z',
              sessionId: '00000000-0000-4000-8000-000000000002',
              user: {
                created_at: '2026-10-10T00:00:00.000Z',
                display_name: 'Owner',
                email: 'owner@example.test',
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

function historyResponse(): HistoryResponseDto {
  return {
    availability_ratio: null,
    bucket_seconds: 300,
    buckets: [],
    check_id: checkId,
    coverage_ratio: 0,
    data_through: '2026-10-10T12:00:00.000Z',
    from: '2026-10-09T12:00:00.000Z',
    generated_at: '2026-10-10T12:00:10.000Z',
    observed_down_ms: '0',
    observed_up_ms: '0',
    period: 'day',
    provisional_ms: '0',
    resolution: 'minute',
    to: '2026-10-10T12:00:00.000Z',
    unknown_ms: '86400000',
  };
}

function historyService(overrides: Partial<HistoryServicePort> = {}): HistoryServicePort {
  return {
    getHistory: vi.fn(() => Promise.resolve(historyResponse())),
    getIncident: vi.fn<HistoryServicePort['getIncident']>(() =>
      Promise.resolve({
        check_id: checkId,
        check_name: 'Website',
        closure_reason: null,
        confirmed_at: '2026-10-10T10:00:30.000Z',
        ended_at: null,
        generated_at: '2026-10-10T12:00:00.000Z',
        group_id_at_open: null,
        id: incidentId,
        observation_mode: 'UNOBSERVED',
        observed_duration_ms: '30000',
        segments: [],
        started_at: '2026-10-10T10:00:00.000Z',
        status: 'OPEN',
        wall_duration_ms: '7200000',
      }),
    ),
    listIncidents: vi.fn(() =>
      Promise.resolve({
        data: [],
        generated_at: '2026-10-10T12:00:00.000Z',
        page: { has_more: false, next_cursor: null },
      }),
    ),
    ...overrides,
  };
}

function application(auth: AuthServicePort, history: HistoryServicePort) {
  const app = buildApiApplication({
    allowedOrigin: 'http://localhost:15173',
    authService: auth,
    cookieSecure: false,
    historyService: history,
    logger: createLogger({ environment: 'test', service: 'api-test', version: '0.1.0' }),
    readiness: () => Promise.resolve(true),
    serviceName: 'api',
    version: '0.1.0',
  });
  applications.push(app);
  return app;
}

describe('history and incident HTTP boundary', () => {
  it('requires authentication and applies private history cache headers', async () => {
    const unauthenticated = historyService();
    const denied = await application(authService(false), unauthenticated).inject({
      method: 'GET',
      url: `/api/v1/checks/${checkId}/history?period=day`,
    });
    expect(denied.statusCode).toBe(401);
    expect(unauthenticated.getHistory).not.toHaveBeenCalled();

    const service = historyService();
    const response = await application(authService(), service).inject({
      headers: { cookie: 'site_monitor_session=valid-token' },
      method: 'GET',
      url: `/api/v1/checks/${checkId}/history?period=day`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe(
      'private, max-age=15, stale-while-revalidate=30',
    );
    expect(response.headers.vary).toContain('Cookie');
    expect(service.getHistory).toHaveBeenCalledWith(ownerId, checkId, 'day');
  });

  it('passes incident filters and keeps journal responses non-cacheable', async () => {
    const service = historyService();
    const response = await application(authService(), service).inject({
      headers: { cookie: 'site_monitor_session=valid-token' },
      method: 'GET',
      url:
        '/api/v1/incidents?limit=25&status=CLOSED&started_before=2026-10-10T12%3A00%3A00.000Z' +
        '&ended_after=2026-10-01T00%3A00%3A00.000Z',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.listIncidents).toHaveBeenCalledWith(ownerId, {
      endedAfter: '2026-10-01T00:00:00.000Z',
      limit: 25,
      startedBefore: '2026-10-10T12:00:00.000Z',
      status: 'CLOSED',
    });
  });

  it('returns bounded retry metadata when projection is behind', async () => {
    const service = historyService({
      getHistory: vi.fn(() =>
        Promise.reject(
          new ApiProblemError({
            code: 'history_projection_lagging',
            detail: 'History projection is catching up.',
            retryAfterSeconds: 5,
            retryable: true,
            status: 503,
          }),
        ),
      ),
    });
    const response = await application(authService(), service).inject({
      headers: { cookie: 'site_monitor_session=valid-token' },
      method: 'GET',
      url: `/api/v1/checks/${checkId}/history?period=month`,
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(response.json()).toMatchObject({
      code: 'history_projection_lagging',
      retry_after_seconds: 5,
      retryable: true,
    });
  });
});
