import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import type { ServiceHealth } from '@site-monitor/contracts';
import { openApiOperations } from '@site-monitor/contracts/openapi';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import type { Logger } from 'pino';

import { installProblemHandling } from './problem.js';
import { requestIdFromHeader } from './request-id.js';
import { registerAuthRoutes, type AuthServicePort } from './auth-routes.js';
import { registerCheckRoutes } from './check-routes.js';
import type { CheckServicePort } from './check-service.js';
import { registerGroupRoutes } from './group-routes.js';
import type { GroupServicePort } from './group-service.js';
import { registerHistoryRoutes } from './history-routes.js';
import type { HistoryServicePort } from './history-service.js';
import { registerMaintenanceRoutes } from './maintenance-routes.js';
import type { MaintenanceServicePort } from './maintenance-service.js';
import { registerNotificationRoutes } from './notification-routes.js';
import type { NotificationServicePort } from './notification-service.js';
import type { RealtimeHub } from './realtime-hub.js';
import { registerRealtimeRoutes } from './realtime-routes.js';

export interface ApiApplicationOptions {
  allowedOrigin: string;
  authService?: AuthServicePort;
  checkService?: CheckServicePort;
  cookieSecure?: boolean;
  groupService?: GroupServicePort;
  historyService?: HistoryServicePort;
  logger: Logger;
  maintenanceService?: MaintenanceServicePort;
  notificationService?: NotificationServicePort;
  realtimeHub?: RealtimeHub;
  readiness: () => Promise<boolean>;
  serviceName: string;
  version: string;
}

function healthPayload(
  serviceName: string,
  version: string,
  status: ServiceHealth['status'],
): ServiceHealth {
  return {
    service: serviceName,
    status,
    timestamp: new Date().toISOString(),
    version,
  };
}

export function buildApiApplication(options: ApiApplicationOptions) {
  const logger: FastifyBaseLogger = options.logger;
  const app = Fastify({
    bodyLimit: 64 * 1024,
    genReqId: requestIdFromHeader,
    loggerInstance: logger,
  });

  installProblemHandling(app);

  app.addHook('onRequest', (request, reply, done) => {
    reply.header('X-Request-Id', request.id);
    done();
  });

  void app.register(cookie);
  void app.register(cors, {
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: options.allowedOrigin,
  });

  if (options.authService) {
    void app.register(registerAuthRoutes, {
      allowedOrigin: options.allowedOrigin,
      authService: options.authService,
      cookieSecure: options.cookieSecure ?? false,
      ...(options.realtimeHub
        ? { onSessionRevoked: (sessionId: string) => options.realtimeHub!.closeSession(sessionId) }
        : {}),
    });
    if (options.checkService) {
      void app.register(registerCheckRoutes, {
        allowedOrigin: options.allowedOrigin,
        authService: options.authService,
        checkService: options.checkService,
        cookieSecure: options.cookieSecure ?? false,
      });
    }
    if (options.groupService) {
      void app.register(registerGroupRoutes, {
        allowedOrigin: options.allowedOrigin,
        authService: options.authService,
        cookieSecure: options.cookieSecure ?? false,
        groupService: options.groupService,
      });
    }
    if (options.historyService) {
      void app.register(registerHistoryRoutes, {
        authService: options.authService,
        cookieSecure: options.cookieSecure ?? false,
        historyService: options.historyService,
      });
    }
    if (options.maintenanceService) {
      void app.register(registerMaintenanceRoutes, {
        allowedOrigin: options.allowedOrigin,
        authService: options.authService,
        cookieSecure: options.cookieSecure ?? false,
        maintenanceService: options.maintenanceService,
      });
    }
    if (options.notificationService) {
      void app.register(registerNotificationRoutes, {
        allowedOrigin: options.allowedOrigin,
        authService: options.authService,
        cookieSecure: options.cookieSecure ?? false,
        notificationService: options.notificationService,
      });
    }
    if (options.realtimeHub) {
      void app.register(registerRealtimeRoutes, {
        allowedOrigin: options.allowedOrigin,
        authService: options.authService,
        cookieSecure: options.cookieSecure ?? false,
        hub: options.realtimeHub,
      });
      app.addHook('onClose', async () => {
        await options.realtimeHub!.shutdown();
      });
    }
  }

  app.get('/health/live', { schema: openApiOperations.getLiveness.routeSchema }, () =>
    healthPayload(options.serviceName, options.version, 'ok'),
  );

  app.get(
    '/health/ready',
    { schema: openApiOperations.getReadiness.routeSchema },
    async (_request, reply) => {
      const ready = await options.readiness();
      if (!ready) reply.code(503);
      return healthPayload(options.serviceName, options.version, ready ? 'ok' : 'unavailable');
    },
  );

  return app;
}
