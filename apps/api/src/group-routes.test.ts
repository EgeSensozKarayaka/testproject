import { createLogger } from '@site-monitor/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApiApplication } from './app.js';
import type { AuthServicePort } from './auth-routes.js';
import { ApiProblemError } from './problem.js';
import type { GroupDto, GroupServicePort } from './group-service.js';

const applications: ReturnType<typeof buildApiApplication>[] = [];
const ownerId = '00000000-0000-4000-8000-000000000001';
const groupId = '00000000-0000-4000-8000-000000000101';

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (app) => app.close()));
});

function group(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    created_at: '2026-10-10T00:00:00.000Z',
    description: null,
    id: groupId,
    name: 'Production',
    resource_version: '1',
    updated_at: '2026-10-10T00:00:00.000Z',
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

function groupService(overrides: Partial<GroupServicePort> = {}): GroupServicePort {
  return {
    create: vi.fn(() => Promise.resolve({ group: group(), replayed: false })),
    delete: vi.fn(() => Promise.resolve()),
    get: vi.fn(() => Promise.resolve(group())),
    list: vi.fn(() =>
      Promise.resolve({
        data: [],
        page: { has_more: false, next_cursor: null },
      }),
    ),
    update: vi.fn(() => Promise.resolve(group({ name: 'Updated', resource_version: '2' }))),
    ...overrides,
  };
}

function application(auth: AuthServicePort, groups: GroupServicePort) {
  const app = buildApiApplication({
    allowedOrigin: 'http://localhost:15173',
    authService: auth,
    cookieSecure: false,
    groupService: groups,
    logger: createLogger({ environment: 'test', service: 'api-test', version: '0.1.0' }),
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

describe('group HTTP boundary', () => {
  it('requires a valid session before listing owner groups', async () => {
    const service = groupService();
    const response = await application(authService(false), service).inject({
      method: 'GET',
      url: '/api/v1/groups',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'authentication_required' });
    expect(service.list).not.toHaveBeenCalled();
  });

  it('creates a group for the authenticated owner with stable HTTP metadata', async () => {
    const service = groupService();
    const response = await application(authService(), service).inject({
      headers: { ...commandHeaders, 'idempotency-key': 'group-create-001' },
      method: 'POST',
      payload: { description: 'Customer-facing services', name: 'Production' },
      url: '/api/v1/groups',
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe(`/api/v1/groups/${groupId}`);
    expect(response.headers.etag).toBe('"rv-1"');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.create).toHaveBeenCalledWith(
      ownerId,
      { description: 'Customer-facing services', name: 'Production' },
      'group-create-001',
      expect.any(String),
    );
  });

  it('rejects a cross-origin mutation before invoking the group service', async () => {
    const service = groupService();
    const response = await application(authService(), service).inject({
      headers: {
        ...commandHeaders,
        'idempotency-key': 'group-create-002',
        origin: 'https://attacker.example',
      },
      method: 'POST',
      payload: { name: 'Production' },
      url: '/api/v1/groups',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'csrf_failed' });
    expect(service.create).not.toHaveBeenCalled();
  });

  it('passes a strong resource version into an update and returns the new ETag', async () => {
    const service = groupService();
    const response = await application(authService(), service).inject({
      headers: { ...commandHeaders, 'if-match': '"rv-1"' },
      method: 'PATCH',
      payload: { name: 'Updated' },
      url: `/api/v1/groups/${groupId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"rv-2"');
    expect(service.update).toHaveBeenCalledWith(
      ownerId,
      groupId,
      '1',
      { name: 'Updated' },
      expect.any(String),
    );
  });

  it('returns the current ETag when optimistic concurrency fails', async () => {
    const service = groupService({
      update: vi.fn(() =>
        Promise.reject(
          new ApiProblemError({
            code: 'resource_version_mismatch',
            detail: 'The group changed after it was read.',
            etag: '"rv-3"',
            status: 412,
          }),
        ),
      ),
    });
    const response = await application(authService(), service).inject({
      headers: { ...commandHeaders, 'if-match': '"rv-1"' },
      method: 'PATCH',
      payload: { name: 'Updated' },
      url: `/api/v1/groups/${groupId}`,
    });

    expect(response.statusCode).toBe(412);
    expect(response.headers.etag).toBe('"rv-3"');
    expect(response.json()).toMatchObject({ code: 'resource_version_mismatch' });
  });

  it('maps a malformed If-Match header to the stable precondition problem', async () => {
    const service = groupService();
    const response = await application(authService(), service).inject({
      headers: { ...commandHeaders, 'if-match': 'rv-1' },
      method: 'PATCH',
      payload: { name: 'Updated' },
      url: `/api/v1/groups/${groupId}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'invalid_precondition' });
    expect(service.update).not.toHaveBeenCalled();
  });

  it('deletes with CSRF and If-Match preconditions', async () => {
    const service = groupService();
    const response = await application(authService(), service).inject({
      headers: {
        cookie: commandHeaders.cookie,
        'if-match': '"rv-1"',
        origin: commandHeaders.origin,
        'sec-fetch-site': commandHeaders['sec-fetch-site'],
        'x-csrf-token': commandHeaders['x-csrf-token'],
      },
      method: 'DELETE',
      url: `/api/v1/groups/${groupId}`,
    });

    expect(response.statusCode).toBe(204);
    expect(service.delete).toHaveBeenCalledWith(ownerId, groupId, '1', expect.any(String));
  });
});
