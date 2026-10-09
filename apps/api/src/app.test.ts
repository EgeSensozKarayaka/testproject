import { createLogger } from '@site-monitor/observability';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApiApplication } from './app.js';

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
});
