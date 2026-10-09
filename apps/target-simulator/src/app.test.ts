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
});
