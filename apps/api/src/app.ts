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

export interface ApiApplicationOptions {
  allowedOrigin: string;
  authService?: AuthServicePort;
  checkService?: CheckServicePort;
  cookieSecure?: boolean;
  groupService?: GroupServicePort;
  logger: Logger;
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
    origin: options.allowedOrigin,
  });

  if (options.authService) {
    void app.register(registerAuthRoutes, {
      allowedOrigin: options.allowedOrigin,
      authService: options.authService,
      cookieSecure: options.cookieSecure ?? false,
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
