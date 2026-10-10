import { createLogger } from '@site-monitor/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApiApplication } from './app.js';
import type { AuthServicePort } from './auth-routes.js';

const applications: ReturnType<typeof buildApiApplication>[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (app) => app.close()));
});

function session() {
  return {
    csrfToken: 'v1.valid-csrf-token-value',
    expiresAt: '2026-10-11T00:00:00.000Z',
    sessionId: '00000000-0000-4000-8000-000000000001',
    user: {
      created_at: '2026-10-10T00:00:00.000Z',
      display_name: 'Alice',
      email: 'alice@example.test',
      email_verified: true,
      id: '00000000-0000-4000-8000-000000000002',
      resource_version: '1',
    },
  };
}

function createService(overrides: Partial<AuthServicePort> = {}): AuthServicePort {
  return {
    confirmEmail: vi.fn<AuthServicePort['confirmEmail']>(() => Promise.resolve()),
    confirmPasswordReset: vi.fn<AuthServicePort['confirmPasswordReset']>(() => Promise.resolve()),
    enforceRateLimit: vi.fn<AuthServicePort['enforceRateLimit']>(() => Promise.resolve()),
    getSession: vi.fn<AuthServicePort['getSession']>(() => Promise.resolve(null)),
    login: vi.fn<AuthServicePort['login']>(() =>
      Promise.resolve({ session: session(), token: 'opaque-session-token' }),
    ),
    logout: vi.fn<AuthServicePort['logout']>(() => Promise.resolve()),
    register: vi.fn<AuthServicePort['register']>(() => Promise.resolve()),
    requestChallenge: vi.fn<AuthServicePort['requestChallenge']>(() => Promise.resolve()),
    runAnonymousIdempotent: vi.fn<AuthServicePort['runAnonymousIdempotent']>((_input, operation) =>
      operation(),
    ),
    updateProfile: vi.fn<AuthServicePort['updateProfile']>(() =>
      Promise.resolve({ ...session().user, display_name: 'Updated', resource_version: '2' }),
    ),
    verifyCsrf: vi.fn(() => true),
    ...overrides,
  };
}

function createApplication(authService: AuthServicePort) {
  const app = buildApiApplication({
    allowedOrigin: 'http://localhost:15173',
    authService,
    cookieSecure: false,
    logger: createLogger({ environment: 'test', service: 'api-test', version: '0.1.0' }),
    readiness: () => Promise.resolve(true),
    serviceName: 'api',
    version: '0.1.0',
  });
  applications.push(app);
  return app;
}

const trustedHeaders = {
  'content-type': 'application/json',
  origin: 'http://localhost:15173',
  'sec-fetch-site': 'same-site',
};

describe('authentication HTTP boundary', () => {
  it('rejects cross-origin auth commands before service execution', async () => {
    const service = createService();
    const response = await createApplication(service).inject({
      headers: { ...trustedHeaders, origin: 'https://attacker.example' },
      method: 'POST',
      payload: { email: 'alice@example.test', password: 'a password' },
      url: '/api/v1/auth/login',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'csrf_failed' });
    expect(service.login).not.toHaveBeenCalled();
  });

  it('sets an HttpOnly strict session cookie and disables caching after login', async () => {
    const response = await createApplication(createService()).inject({
      headers: trustedHeaders,
      method: 'POST',
      payload: { email: 'alice@example.test', password: 'a password' },
      url: '/api/v1/auth/login',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toContain('site_monitor_session=opaque-session-token');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Strict');
    expect(response.json()).toMatchObject({ csrf_token: 'v1.valid-csrf-token-value' });
  });

  it('keeps logout idempotent for an absent session', async () => {
    const service = createService();
    const response = await createApplication(service).inject({
      headers: { ...trustedHeaders, 'x-csrf-token': 'unused-for-an-absent-session' },
      method: 'POST',
      payload: {},
      url: '/api/v1/auth/logout',
    });
    expect(response.statusCode).toBe(204);
    expect(service.logout).not.toHaveBeenCalled();
    expect(response.headers['set-cookie']).toContain('site_monitor_session=');
  });

  it('requires a valid CSRF token before revoking a valid session', async () => {
    const service = createService({
      getSession: vi.fn<AuthServicePort['getSession']>(() => Promise.resolve(session())),
      verifyCsrf: vi.fn(() => false),
    });
    const response = await createApplication(service).inject({
      headers: {
        ...trustedHeaders,
        cookie: 'site_monitor_session=valid-token',
        'x-csrf-token': 'invalid-token-value-long-enough',
      },
      method: 'POST',
      payload: {},
      url: '/api/v1/auth/logout',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'csrf_failed' });
    expect(service.logout).not.toHaveBeenCalled();
  });

  it('returns the authenticated profile with a strong resource ETag', async () => {
    const service = createService({
      getSession: vi.fn<AuthServicePort['getSession']>(() => Promise.resolve(session())),
    });
    const response = await createApplication(service).inject({
      headers: { cookie: 'site_monitor_session=valid-token' },
      method: 'GET',
      url: '/api/v1/me',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"rv-1"');
    expect(response.json()).toMatchObject({ display_name: 'Alice', resource_version: '1' });
  });

  it('updates only the authenticated profile with CSRF and optimistic concurrency', async () => {
    const service = createService();
    const response = await createApplication(service).inject({
      headers: {
        ...trustedHeaders,
        cookie: 'site_monitor_session=valid-token',
        'if-match': '"rv-1"',
        'x-csrf-token': 'v1.valid-csrf-token-value',
      },
      method: 'PATCH',
      payload: { display_name: 'Updated' },
      url: '/api/v1/me',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"rv-2"');
    expect(service.updateProfile).toHaveBeenCalledWith({
      csrfToken: 'v1.valid-csrf-token-value',
      displayName: 'Updated',
      expectedVersion: '1',
      token: 'valid-token',
    });
  });

  it('maps a missing If-Match header to the documented 428 problem', async () => {
    const response = await createApplication(createService()).inject({
      headers: {
        ...trustedHeaders,
        cookie: 'site_monitor_session=valid-token',
        'x-csrf-token': 'v1.valid-csrf-token-value',
      },
      method: 'PATCH',
      payload: { display_name: 'Updated' },
      url: '/api/v1/me',
    });
    expect(response.statusCode).toBe(428);
    expect(response.json()).toMatchObject({ code: 'precondition_required' });
  });
});
