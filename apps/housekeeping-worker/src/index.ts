import {
  loadDatabaseUrl,
  loadHousekeepingRuntimeConfig,
  loadRuntimeConfig,
} from '@site-monitor/config';
import type { ServiceHealth } from '@site-monitor/contracts';
import { createDatabasePool, isDatabaseReady } from '@site-monitor/database';
import { createLogger } from '@site-monitor/observability';
import Fastify from 'fastify';

import { HousekeepingRuntimeCoordinator } from './runtime-coordinator.js';
import { HousekeepingStore } from './store.js';

const config = loadRuntimeConfig({ defaultPort: 3013, serviceName: 'housekeeping-worker' });
const housekeepingConfig = loadHousekeepingRuntimeConfig();
const logger = createLogger({
  environment: config.nodeEnv,
  service: config.serviceName,
  version: config.version,
});
const database = createDatabasePool({
  applicationName: config.serviceName,
  connectionString: loadDatabaseUrl(),
  databaseRole: 'site_monitor_housekeeper',
  maxConnections: housekeepingConfig.databasePoolSize,
});
const store = new HousekeepingStore(database);
const coordinator = new HousekeepingRuntimeCoordinator({
  config: housekeepingConfig,
  logger,
  store,
});
const app = Fastify({ loggerInstance: logger });
let stopping = false;

function payload(status: ServiceHealth['status']): ServiceHealth {
  return {
    service: config.serviceName,
    status,
    timestamp: new Date().toISOString(),
    version: config.version,
  };
}

app.get('/health/live', () => payload('ok'));
app.get('/health/ready', async (_request, reply) => {
  const ready =
    !stopping &&
    coordinator.ready &&
    (await isDatabaseReady(database)) &&
    (await store.storageReady());
  if (!ready) reply.code(503);
  return payload(ready ? 'ok' : 'unavailable');
});

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down');
  await coordinator.drain();
  await app.close();
  await database.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void stop(signal).then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

await app.listen({ host: config.host, port: config.port });
if (!(await isDatabaseReady(database)) || !(await store.storageReady())) {
  await app.close();
  await database.end();
  throw new Error('Housekeeping storage preflight failed.');
}
coordinator.start();
