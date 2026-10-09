import Fastify from 'fastify';
import type { Logger } from 'pino';

export function buildTargetSimulator(logger: Logger) {
  const app = Fastify({ loggerInstance: logger });

  app.get('/health/live', () => ({ status: 'ok' }));
  app.get('/health/ready', () => ({ status: 'ok' }));
  app.get('/ok', (request) => ({
    body: (request.query as { body?: string }).body ?? 'expected content',
    status: 'ok',
  }));
  app.get<{ Params: { code: string } }>('/status/:code', async (request, reply) => {
    const code = Number(request.params.code);
    if (!Number.isInteger(code) || code < 100 || code > 599) {
      return reply.code(400).send({ error: 'code must be an integer between 100 and 599' });
    }
    return reply.code(code).send({ status: code });
  });
  app.get<{ Params: { milliseconds: string } }>('/delay/:milliseconds', async (request, reply) => {
    const milliseconds = Number(request.params.milliseconds);
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 120_000) {
      return reply.code(400).send({ error: 'milliseconds must be between 0 and 120000' });
    }
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    return { delayedByMs: milliseconds, status: 'ok' };
  });
  app.get('/hang', async (request) => {
    await new Promise<void>((resolve) => request.raw.once('close', resolve));
    return undefined;
  });

  return app;
}
