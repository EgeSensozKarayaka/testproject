import { createLogger } from '@site-monitor/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApiApplication } from './app.js';
import type { AuthServicePort } from './auth-routes.js';
import type { MaintenanceServicePort, MaintenanceWindowDto } from './maintenance-service.js';

const applications: ReturnType<typeof buildApiApplication>[] = [];
const ownerId = '00000000-0000-4000-8000-000000000001';
const checkId = '00000000-0000-4000-8000-000000000101';
const groupId = '00000000-0000-4000-8000-000000000102';
const windowId = '00000000-0000-4000-8000-000000000201';

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (app) => app.close()));
});

function maintenance(overrides: Partial<MaintenanceWindowDto> = {}): MaintenanceWindowDto {
  return {
    created_at: '2026-10-10T10:00:00.000Z',
    ends_at: '2099-10-10T12:00:00.000Z',
    id: windowId,
    note: 'Deploy',
    resource_version: '1',
    starts_at: '2099-10-10T11:00:00.000Z',
    state: 'UPCOMING',
    target_id: checkId,
    target_type: 'CHECK',
    updated_at: '2026-10-10T10:00:00.000Z',
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
              expiresAt: '2099-10-11T00:00:00.000Z',
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

function maintenanceService(
  overrides: Partial<MaintenanceServicePort> = {},
): MaintenanceServicePort {
  return {
    cancel: vi.fn(() => Promise.resolve()),
    create: vi.fn(() => Promise.resolve({ replayed: false, window: maintenance() })),
    get: vi.fn(() => Promise.resolve(maintenance())),
    list: vi.fn(() => Promise.resolve({ data: [], page: { has_more: false, next_cursor: null } })),
    update: vi.fn(() => Promise.resolve(maintenance({ note: 'Updated', resource_version: '2' }))),
    ...overrides,
  };
}

function application(auth: AuthServicePort, service: MaintenanceServicePort) {
  const app = buildApiApplication({
    allowedOrigin: 'http://localhost:15173',
    authService: auth,
    cookieSecure: false,
    logger: createLogger({ environment: 'test', service: 'api-test', version: '0.1.0' }),
    maintenanceService: service,
    readiness: () => Promise.resolve(true),
    serviceName: 'api',
    version: '0.1.0',
  });
  applications.push(app);
  return app;
}

const commandHeaders = {
  'content-type': 'application/json',
  cookie: 'site_monitor_session=valid-token',
  origin: 'http://localhost:15173',
  'sec-fetch-site': 'same-site',
  'x-csrf-token': 'v1.valid-csrf-token-value',
};

describe('maintenance HTTP boundary', () => {
  it('requires a valid session before listing owner maintenance', async () => {
    const service = maintenanceService();
    const response = await application(authService(false), service).inject({
      method: 'GET',
      url: '/api/v1/maintenance-windows',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'authentication_required' });
    expect(service.list).not.toHaveBeenCalled();
  });

  it('maps all list filters into the owner-scoped service query', async () => {
    const service = maintenanceService();
    const response = await application(authService(), service).inject({
      headers: { cookie: commandHeaders.cookie },
      method: 'GET',
      url:
        `/api/v1/maintenance-windows?state=ACTIVE&check_id=${checkId}` +
        `&group_id=${groupId}&starts_before=2099-10-11T00%3A00%3A00.000Z` +
        `&ends_after=2099-10-10T00%3A00%3A00.000Z&limit=25&cursor=opaque`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.list).toHaveBeenCalledWith(ownerId, {
      checkId,
      cursor: 'opaque',
      endsAfter: '2099-10-10T00:00:00.000Z',
      groupId,
      limit: 25,
      startsBefore: '2099-10-11T00:00:00.000Z',
      state: 'ACTIVE',
    });
  });

  it('creates a window with stable Location and ETag metadata', async () => {
    const service = maintenanceService();
    const payload = {
      ends_at: '2099-10-10T12:00:00.000Z',
      note: 'Deploy',
      starts_at: '2099-10-10T11:00:00.000Z',
      target_id: checkId,
      target_type: 'CHECK' as const,
    };
    const response = await application(authService(), service).inject({
      headers: { ...commandHeaders, 'idempotency-key': 'maintenance-create-001' },
      method: 'POST',
      payload,
      url: '/api/v1/maintenance-windows',
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe(`/api/v1/maintenance-windows/${windowId}`);
    expect(response.headers.etag).toBe('"rv-1"');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.create).toHaveBeenCalledWith(
      ownerId,
      payload,
      'maintenance-create-001',
      expect.any(String),
    );
  });

  it('rejects a cross-origin create before invoking the service', async () => {
    const service = maintenanceService();
    const response = await application(authService(), service).inject({
      headers: {
        ...commandHeaders,
        'idempotency-key': 'maintenance-create-002',
        origin: 'https://attacker.example',
      },
      method: 'POST',
      payload: {
        ends_at: '2099-10-10T12:00:00.000Z',
        starts_at: '2099-10-10T11:00:00.000Z',
        target_id: checkId,
        target_type: 'CHECK',
      },
      url: '/api/v1/maintenance-windows',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'csrf_failed' });
    expect(service.create).not.toHaveBeenCalled();
  });

  it('passes a strong version into update and returns the new ETag', async () => {
    const service = maintenanceService();
    const response = await application(authService(), service).inject({
      headers: { ...commandHeaders, 'if-match': '"rv-1"' },
      method: 'PATCH',
      payload: { note: 'Updated' },
      url: `/api/v1/maintenance-windows/${windowId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"rv-2"');
    expect(service.update).toHaveBeenCalledWith(
      ownerId,
      windowId,
      '1',
      { note: 'Updated' },
      expect.any(String),
    );
  });

  it('cancels with CSRF and If-Match preconditions', async () => {
    const service = maintenanceService();
    const response = await application(authService(), service).inject({
      headers: {
        cookie: commandHeaders.cookie,
        'if-match': '"rv-1"',
        origin: commandHeaders.origin,
        'sec-fetch-site': commandHeaders['sec-fetch-site'],
        'x-csrf-token': commandHeaders['x-csrf-token'],
      },
      method: 'DELETE',
      url: `/api/v1/maintenance-windows/${windowId}`,
    });

    expect(response.statusCode).toBe(204);
    expect(service.cancel).toHaveBeenCalledWith(ownerId, windowId, '1', expect.any(String));
  });
});
