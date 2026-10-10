import type { AddressInfo } from 'node:net';

import type { ApiRealtimeRuntimeConfig } from '@site-monitor/config';
import { createLogger } from '@site-monitor/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApiApplication } from './app.js';
import type { AuthServicePort } from './auth-routes.js';
import { RealtimeHub } from './realtime-hub.js';

const applications: ReturnType<typeof buildApiApplication>[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (app) => app.close()));
});

function config(): ApiRealtimeRuntimeConfig {
  return {
    globalConnectionLimit: 8,
    heartbeatMs: 15_000,
    ipConnectionLimit: 8,
    listenerGraceMs: 100,
    ownerConnectionLimit: 8,
    projectionConcurrency: 2,
    projectionQueueLimit: 16,
    queueByteLimit: 16_384,
    queueEventLimit: 8,
    sessionConnectionLimit: 4,
    sessionRevalidateBatchSize: 4,
    sessionRevalidateMs: 60_000,
    shutdownGraceMs: 100,
  };
}

function authService(authenticated = true): AuthServicePort {
  return {
    enforceRateLimit: vi.fn(() => Promise.resolve()),
    getSession: vi.fn(() =>
      Promise.resolve(
        authenticated
          ? {
              csrfToken: 'csrf',
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              sessionId: '00000000-0000-4000-8000-000000000002',
              user: {
                created_at: '2026-10-10T00:00:00.000Z',
                display_name: 'Realtime User',
                email: 'realtime@example.test',
                email_verified: true,
                id: '00000000-0000-4000-8000-000000000001',
                resource_version: '1',
              },
            }
          : null,
      ),
    ),
  } as unknown as AuthServicePort;
}

function application(authenticated = true) {
  const hub = new RealtimeHub(config(), Buffer.alloc(32, 3));
  const app = buildApiApplication({
    allowedOrigin: 'http://localhost:5173',
    authService: authService(authenticated),
    logger: createLogger({ environment: 'test', service: 'api-test', version: '0.1.0' }),
    readiness: () => Promise.resolve(true),
    realtimeHub: hub,
    serviceName: 'api',
    version: '0.1.0',
  });
  applications.push(app);
  return app;
}

describe('private realtime route', () => {
  it('rejects missing media type and invalid sessions before hijacking', async () => {
    const app = application(false);
    const wrongMedia = await app.inject({
      headers: { cookie: 'site_monitor_session=token', origin: 'http://localhost:5173' },
      method: 'GET',
      url: '/api/v1/events',
    });
    expect(wrongMedia.statusCode).toBe(406);

    const unauthenticated = await app.inject({
      headers: {
        accept: 'text/event-stream',
        cookie: 'site_monitor_session=token',
        origin: 'http://localhost:5173',
      },
      method: 'GET',
      url: '/api/v1/events',
    });
    expect(unauthenticated.statusCode).toBe(401);
  });

  it('opens an owner-scoped no-cache stream with stream.ready first', async () => {
    const app = application();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/events`, {
      headers: {
        Accept: 'text/event-stream',
        Cookie: 'site_monitor_session=token',
        Origin: 'http://localhost:5173',
      },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const reader = response.body!.getReader();
    const first = await reader.read();
    const value: unknown = first.value;
    if (!(value instanceof Uint8Array)) throw new Error('Expected a realtime response frame.');
    const frame = new TextDecoder().decode(value);
    expect(frame).toContain('event: stream.ready');
    expect(frame).toContain('"replay_supported":false');
    controller.abort();
  });
});
