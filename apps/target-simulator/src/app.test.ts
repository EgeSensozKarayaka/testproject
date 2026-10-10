import { createLogger } from '@site-monitor/observability';
import { afterEach, describe, expect, it } from 'vitest';

import { buildTargetSimulator } from './app.js';

const apps: ReturnType<typeof buildTargetSimulator>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function createApp() {
  const app = buildTargetSimulator(
    createLogger({ environment: 'test', service: 'target-simulator-test', version: '0.1.0' }),
  );
  apps.push(app);
  return app;
}

describe('target simulator', () => {
  it('emulates an explicit status code', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/status/503' });
    expect(response.statusCode).toBe(503);
  });

  it('rejects unbounded delays', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/delay/120001' });
    expect(response.statusCode).toBe(400);
  });

  it('streams a body match across chunks', async () => {
    const response = await createApp().inject({ method: 'GET', url: '/body/match' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('expected content');
  });

  it('emulates redirects and deterministic flaky recovery', async () => {
    const app = createApp();
    const redirect = await app.inject({ method: 'GET', url: '/redirect/2' });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe('/redirect/1');

    expect((await app.inject({ method: 'GET', url: '/flaky/probe-a' })).statusCode).toBe(503);
    expect((await app.inject({ method: 'GET', url: '/flaky/probe-a' })).statusCode).toBe(200);
  });

  it('bounds generated large and compressed responses', async () => {
    const app = createApp();
    const large = await app.inject({ method: 'GET', url: '/large/1024' });
    expect(large.statusCode).toBe(200);
    expect(large.rawPayload).toHaveLength(1024);
    expect((await app.inject({ method: 'GET', url: '/large/2097153' })).statusCode).toBe(400);

    const compressed = await app.inject({ method: 'GET', url: '/compressed/gzip' });
    expect(compressed.statusCode).toBe(200);
    expect(compressed.headers['content-encoding']).toBe('gzip');
  });
});
