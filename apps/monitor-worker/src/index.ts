import { loadDatabaseUrl, loadRuntimeConfig } from '@site-monitor/config';
import type { ServiceHealth } from '@site-monitor/contracts';
import { createDatabasePool, isDatabaseReady } from '@site-monitor/database';
import { createLogger } from '@site-monitor/observability';
import Fastify from 'fastify';

const config = loadRuntimeConfig({ defaultPort: 3011, serviceName: 'monitor-worker' });
const logger = createLogger({
  environment: config.nodeEnv,
  service: config.serviceName,
  version: config.version,
});
const database = createDatabasePool({
  applicationName: config.serviceName,
  connectionString: loadDatabaseUrl(),
  databaseRole: 'site_monitor_monitor',
  maxConnections: 2,
});
const app = Fastify({ loggerInstance: logger });

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
  const ready = await isDatabaseReady(database);
  if (!ready) reply.code(503);
  return payload(ready ? 'ok' : 'unavailable');
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
