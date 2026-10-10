import { randomUUID } from 'node:crypto';

import {
  loadDatabaseUrl,
  loadMonitorRuntimeConfig,
  loadProbeRuntimeConfig,
  loadRuntimeConfig,
} from '@site-monitor/config';
import type { ServiceHealth } from '@site-monitor/contracts';
import { createDatabasePool, isDatabaseReady } from '@site-monitor/database';
import { createLogger } from '@site-monitor/observability';
import Fastify from 'fastify';

import { ProbeDispatcher } from './dispatcher.js';
import { PostgresJobQueue } from './job-queue.js';
import { PostgresObservationStore } from './observation-store.js';
import { createMonitorProbeEngine } from './probe-runtime.js';
import { isMonitorStorageReady, MonitorRuntimeCoordinator } from './runtime-coordinator.js';

const config = loadRuntimeConfig({ defaultPort: 3011, serviceName: 'monitor-worker' });
const logger = createLogger({
  environment: config.nodeEnv,
  service: config.serviceName,
  version: config.version,
});
const monitorConfig = loadMonitorRuntimeConfig();
const runtime = {
  database: createDatabasePool({
    applicationName: config.serviceName,
    connectionString: loadDatabaseUrl(),
    databaseRole: 'site_monitor_monitor',
    maxConnections: monitorConfig.databasePoolSize,
  }),
  probeEngine: createMonitorProbeEngine(loadProbeRuntimeConfig()),
};
const app = Fastify({ loggerInstance: logger });
const workerId = `${config.serviceName}:${randomUUID()}`;
const queue = new PostgresJobQueue(runtime.database, workerId, monitorConfig.leaseGraceMs);
const observationStore = new PostgresObservationStore(
  runtime.database,
  workerId,
  monitorConfig.schedulerGraceMs,
  queue,
);
const dispatcher = new ProbeDispatcher({
  config: {
    candidateBatchSize: monitorConfig.candidateBatchSize,
    globalConcurrency: monitorConfig.globalConcurrency,
    heartbeatMs: monitorConfig.heartbeatMs,
    perHostConcurrency: monitorConfig.perHostConcurrency,
    perOwnerConcurrency: monitorConfig.perOwnerConcurrency,
  },
  logger,
  probe: runtime.probeEngine,
  queue,
  sink: observationStore,
});
const coordinator = new MonitorRuntimeCoordinator({
  config: monitorConfig,
  dispatcher,
  freshness: observationStore,
  logger,
  queue,
});

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
    (await isDatabaseReady(runtime.database)) &&
    (await isMonitorStorageReady(runtime.database));
  if (!ready) reply.code(503);
  return payload(ready ? 'ok' : 'unavailable');
});

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down');
  const drain = await coordinator.drain();
  logger.info(drain, 'monitor runtime drain completed');
  await app.close();
  await runtime.database.end();
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
const storageReady =
  (await isDatabaseReady(runtime.database)) && (await isMonitorStorageReady(runtime.database));
if (!storageReady) {
  await app.close();
  await runtime.database.end();
  throw new Error('Monitor storage preflight failed.');
}
coordinator.start();
