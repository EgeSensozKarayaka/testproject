import {
  loadApiRealtimeRuntimeConfig,
  loadAuthRuntimeConfig,
  loadDatabaseUrl,
  loadHistoryRuntimeConfig,
  loadResourceRuntimeConfig,
  loadRuntimeConfig,
} from '@site-monitor/config';
import { createDatabasePool, isDatabaseReady } from '@site-monitor/database';
import { createLogger } from '@site-monitor/observability';

import { buildApiApplication } from './app.js';
import { AuthService } from './auth-service.js';
import { CheckService } from './check-service.js';
import { GroupService } from './group-service.js';
import { HistoryService } from './history-service.js';
import { MaintenanceService } from './maintenance-service.js';
import { NotificationService } from './notification-service.js';
import { RealtimeHub } from './realtime-hub.js';
import { PostgresRealtimeListener } from './realtime-listener.js';
import { RealtimeProjectionCoordinator, RealtimeProjectionService } from './realtime-projection.js';

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
const authConfig = loadAuthRuntimeConfig();
const apiRealtimeConfig = loadApiRealtimeRuntimeConfig();
const authService = await AuthService.create(database, {
  csrfKey: { key: authConfig.csrfKey, version: authConfig.csrfKeyVersion },
  emailEncryptionKey: {
    key: authConfig.emailEncryptionKey,
    version: authConfig.emailEncryptionKeyVersion,
  },
  rateLimitKey: authConfig.rateLimitKey,
});
const resourceConfig = loadResourceRuntimeConfig();
const historyConfig = loadHistoryRuntimeConfig();
const checkService = new CheckService(database, {
  checkLimit: resourceConfig.checksPerOwnerLimit,
  securityKey: authConfig.rateLimitKey,
});
const groupService = new GroupService(database, {
  groupLimit: resourceConfig.groupsPerOwnerLimit,
  securityKey: authConfig.rateLimitKey,
});
const historyService = new HistoryService(database, {
  ...historyConfig,
  securityKey: authConfig.rateLimitKey,
});
const maintenanceService = new MaintenanceService(database, {
  maintenanceWindowLimit: resourceConfig.maintenanceWindowsPerOwnerLimit,
  securityKey: authConfig.rateLimitKey,
});
const notificationService = new NotificationService(database, {
  emailEncryptionKey: {
    key: authConfig.emailEncryptionKey,
    version: authConfig.emailEncryptionKeyVersion,
  },
  securityKey: authConfig.rateLimitKey,
});
const realtimeListenerDatabase = createDatabasePool({
  applicationName: `${config.serviceName}-realtime-listener`,
  connectionString: loadDatabaseUrl(),
  databaseRole: 'site_monitor_api',
  maxConnections: 1,
});
const realtimeHub = new RealtimeHub(apiRealtimeConfig, authConfig.rateLimitKey);
const realtimeProjection = new RealtimeProjectionCoordinator({
  concurrency: apiRealtimeConfig.projectionConcurrency,
  hub: realtimeHub,
  limit: apiRealtimeConfig.projectionQueueLimit,
  projector: new RealtimeProjectionService(database),
});
const realtimeListener = new PostgresRealtimeListener({
  graceMs: apiRealtimeConfig.listenerGraceMs,
  logger,
  onInvalidPayload: () => realtimeHub.resyncAll('PROJECTION_INVALIDATED'),
  onRestart: () => realtimeHub.resyncAll('SUBSCRIBER_RESTARTED'),
  onWakeup: (wakeup) => {
    if (realtimeHub.hasOwner(wakeup.owner_id)) realtimeProjection.enqueue(wakeup);
  },
  pool: realtimeListenerDatabase,
});
realtimeListener.start();
const app = buildApiApplication({
  allowedOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:15173',
  authService,
  checkService,
  cookieSecure: authConfig.cookieSecure,
  groupService,
  historyService,
  logger,
  maintenanceService,
  notificationService,
  realtimeHub,
  readiness: async () => (await isDatabaseReady(database)) && realtimeListener.ready,
  serviceName: config.serviceName,
  version: config.version,
});

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down');
  await realtimeListener.stop();
  await realtimeHub.shutdown();
  await app.close();
  await realtimeListenerDatabase.end();
  await database.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void stop(signal).then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
