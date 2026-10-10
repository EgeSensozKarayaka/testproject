import { createLogger } from '@site-monitor/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApiApplication } from './app.js';
import type { AuthServicePort } from './auth-routes.js';
import type {
  NotificationPolicyDto,
  NotificationRecipientDto,
  NotificationServicePort,
} from './notification-service.js';

const applications: ReturnType<typeof buildApiApplication>[] = [];
const ownerId = '00000000-0000-4000-8000-000000000001';
const recipientId = '00000000-0000-4000-8000-000000000101';
const groupId = '00000000-0000-4000-8000-000000000201';
const policyId = '00000000-0000-4000-8000-000000000301';

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

function recipient(): NotificationRecipientDto {
  return {
    created_at: '2026-10-10T10:00:00.000Z',
    email: 'alerts@example.test',
    id: recipientId,
    resource_version: '1',
    verification_state: 'PENDING',
  };
}

function policy(overrides: Partial<NotificationPolicyDto> = {}): NotificationPolicyDto {
  return {
    effective_mode: 'DISABLED',
    effective_notify_down: null,
    effective_notify_recovery: null,
    effective_policy_id: policyId,
    effective_policy_version: '1',
    effective_recipient_ids: [],
    id: policyId,
    mode: 'DISABLED',
    notify_down: null,
    notify_recovery: null,
    recipient_ids: [],
    resource_version: '1',
    scope_id: null,
    scope_type: 'DEFAULT',
    ...overrides,
  };
}

function notificationService(
  overrides: Partial<NotificationServicePort> = {},
): NotificationServicePort {
  return {
    confirmRecipient: vi.fn(() => Promise.resolve()),
    createRecipient: vi.fn(() => Promise.resolve(recipient())),
    deleteRecipient: vi.fn(() => Promise.resolve()),
    getDefaultPolicy: vi.fn(() => Promise.resolve(policy())),
    getGroupPolicy: vi.fn(() =>
      Promise.resolve(
        policy({
          id: '00000000-0000-4000-8000-000000000302',
          mode: 'INHERIT',
          resource_version: '3',
          scope_id: groupId,
          scope_type: 'GROUP',
        }),
      ),
    ),
    listRecipients: vi.fn(() =>
      Promise.resolve({ data: [], page: { has_more: false, next_cursor: null } }),
    ),
    replaceDefaultPolicy: vi.fn(() => Promise.resolve(policy({ resource_version: '2' }))),
    replaceGroupPolicy: vi.fn(() =>
      Promise.resolve(
        policy({
          effective_policy_id: '00000000-0000-4000-8000-000000000302',
          id: '00000000-0000-4000-8000-000000000302',
          resource_version: '4',
          scope_id: groupId,
          scope_type: 'GROUP',
        }),
      ),
    ),
    resendRecipientVerification: vi.fn(() => Promise.resolve()),
    sendTestEmail: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function application(auth: AuthServicePort, service: NotificationServicePort) {
  const app = buildApiApplication({
    allowedOrigin: 'http://localhost:15173',
    authService: auth,
    cookieSecure: false,
    logger: createLogger({ environment: 'test', service: 'api-test', version: '0.1.0' }),
    notificationService: service,
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

describe('notification HTTP boundary', () => {
  it('requires a session before listing owner recipients', async () => {
    const service = notificationService();
    const response = await application(authService(false), service).inject({
      method: 'GET',
      url: '/api/v1/notification-recipients',
    });
    expect(response.statusCode).toBe(401);
    expect(service.listRecipients).not.toHaveBeenCalled();
  });

  it('creates a recipient with CSRF, idempotency metadata and resource headers', async () => {
    const service = notificationService();
    const response = await application(authService(), service).inject({
      headers: { ...commandHeaders, 'idempotency-key': 'notification-recipient-001' },
      method: 'POST',
      payload: { email: 'alerts@example.test' },
      url: '/api/v1/notification-recipients',
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe(`/api/v1/notification-recipients/${recipientId}`);
    expect(response.headers.etag).toBe('"rv-1"');
    expect(service.createRecipient).toHaveBeenCalledWith(
      ownerId,
      'alerts@example.test',
      'notification-recipient-001',
      expect.any(String),
    );
  });

  it('accepts public confirmation without a session while applying network throttling', async () => {
    const auth = authService(false);
    const service = notificationService();
    const response = await application(auth, service).inject({
      headers: {
        'content-type': 'application/json',
        origin: commandHeaders.origin,
        'sec-fetch-site': commandHeaders['sec-fetch-site'],
      },
      method: 'POST',
      payload: { token: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' },
      url: '/api/v1/notification-recipient-verifications/confirm',
    });
    expect(response.statusCode).toBe(204);
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.enforceRateLimit).toHaveBeenCalledWith(
      'notifications.confirm.network',
      expect.any(String),
      30,
      60,
    );
    expect(service.confirmRecipient).toHaveBeenCalledWith(expect.any(String), expect.any(String));
  });

  it('queues an idempotent test email only through the verified-recipient command', async () => {
    const service = notificationService();
    const response = await application(authService(), service).inject({
      headers: {
        cookie: commandHeaders.cookie,
        'idempotency-key': 'notification-test-email-001',
        origin: commandHeaders.origin,
        'sec-fetch-site': commandHeaders['sec-fetch-site'],
        'x-csrf-token': commandHeaders['x-csrf-token'],
      },
      method: 'POST',
      url: `/api/v1/notification-recipients/${recipientId}/test-email`,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true });
    expect(service.sendTestEmail).toHaveBeenCalledWith(
      ownerId,
      recipientId,
      'notification-test-email-001',
    );
  });

  it('replaces a group policy through PUT with CSRF and a strong version', async () => {
    const service = notificationService();
    const payload = {
      mode: 'DISABLED' as const,
      notify_down: null,
      notify_recovery: null,
      recipient_ids: [],
    };
    const response = await application(authService(), service).inject({
      headers: { ...commandHeaders, 'if-match': '"rv-3"' },
      method: 'PUT',
      payload,
      url: `/api/v1/groups/${groupId}/notification-policy`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"rv-4"');
    expect(service.replaceGroupPolicy).toHaveBeenCalledWith(
      ownerId,
      groupId,
      '3',
      payload,
      expect.any(String),
    );
  });
});
