import { loadDatabaseUrl, loadRuntimeConfig } from '@site-monitor/config';
import { createDatabasePool, isDatabaseReady } from '@site-monitor/database';
import { createLogger } from '@site-monitor/observability';

import { buildApiApplication } from './app.js';

const config = loadRuntimeConfig({ defaultPort: 13_000, serviceName: 'api' });
const logger = createLogger({
  environment: config.nodeEnv,
  service: config.serviceName,
  version: config.version,
});
const database = createDatabasePool({
  applicationName: config.serviceName,
  connectionString: loadDatabaseUrl(),
  databaseRole: 'site_monitor_api',
});
const app = buildApiApplication({
  allowedOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:15173',
  logger,
  readiness: async () => isDatabaseReady(database),
  serviceName: config.serviceName,
  version: config.version,
});

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down');
  await app.close();
  await database.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void stop(signal).then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
