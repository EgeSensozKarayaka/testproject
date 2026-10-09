import cors from '@fastify/cors';
import type { ServiceHealth } from '@site-monitor/contracts';
import Fastify from 'fastify';
import type { Logger } from 'pino';

export interface ApiApplicationOptions {
  allowedOrigin: string;
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
  const app = Fastify({ loggerInstance: options.logger });

  void app.register(cors, {
    origin: options.allowedOrigin,
  });

  app.get('/health/live', () => healthPayload(options.serviceName, options.version, 'ok'));

  app.get('/health/ready', async (_request, reply) => {
    const ready = await options.readiness();
    if (!ready) reply.code(503);
    return healthPayload(options.serviceName, options.version, ready ? 'ok' : 'unavailable');
  });

  return app;
}
