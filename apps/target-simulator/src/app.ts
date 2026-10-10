import { Readable } from 'node:stream';
import { createBrotliCompress, createDeflate, createGzip } from 'node:zlib';

import Fastify, { LogController } from 'fastify';
import type { Logger } from 'pino';

export function buildTargetSimulator(logger: Logger) {
  const app = Fastify({
    logController: new LogController({ disableRequestLogging: true }),
    loggerInstance: logger,
  });
  const flakyCounters = new Map<string, number>();

  app.get('/health/live', () => ({ status: 'ok' }));
  app.get('/health/ready', () => ({ status: 'ok' }));
  app.get('/ok', () => ({
    body: 'expected content',
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

  app.get<{ Params: { chunks: string; delay: string } }>(
    '/stream/:chunks/:delay',
    async (request, reply) => {
      const chunks = Number(request.params.chunks);
      const delay = Number(request.params.delay);
      if (!Number.isInteger(chunks) || chunks < 1 || chunks > 100) {
        return reply.code(400).send({ error: 'chunks must be between 1 and 100' });
      }
      if (!Number.isInteger(delay) || delay < 0 || delay > 1_000) {
        return reply.code(400).send({ error: 'delay must be between 0 and 1000' });
      }
      async function* stream() {
        for (let index = 0; index < chunks; index += 1) {
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
          yield `chunk-${index}\n`;
        }
      }
      return reply.type('text/plain').send(Readable.from(stream()));
    },
  );

  app.get('/body/match', (_request, reply) =>
    reply.type('text/plain').send(Readable.from(['prefix-expec', 'ted content-suffix'])),
  );
  app.get('/body/mismatch', (_request, reply) => reply.type('text/plain').send('other content'));

  app.get<{ Params: { bytes: string } }>('/large/:bytes', async (request, reply) => {
    const bytes = Number(request.params.bytes);
    if (!Number.isInteger(bytes) || bytes < 0 || bytes > 2_097_152) {
      return reply.code(400).send({ error: 'bytes must be between 0 and 2097152' });
    }
    function* stream() {
      let remaining = bytes;
      while (remaining > 0) {
        const length = Math.min(16_384, remaining);
        remaining -= length;
        yield Buffer.alloc(length, 0x61);
      }
    }
    reply.header('content-length', String(bytes));
    return reply.type('application/octet-stream').send(Readable.from(stream()));
  });

  app.get<{ Params: { encoding: string } }>('/compressed/:encoding', async (request, reply) => {
    const compressors = {
      br: createBrotliCompress,
      deflate: createDeflate,
      gzip: createGzip,
    } as const;
    const encoding = request.params.encoding as keyof typeof compressors;
    const createCompressor = compressors[encoding];
    if (!createCompressor) {
      return reply.code(400).send({ error: 'encoding must be gzip, deflate or br' });
    }
    reply.header('content-encoding', encoding);
    return reply
      .type('text/plain')
      .send(Readable.from(['expected content']).pipe(createCompressor()));
  });

  app.get<{ Params: { remaining: string } }>('/redirect/:remaining', async (request, reply) => {
    const remaining = Number(request.params.remaining);
    if (!Number.isInteger(remaining) || remaining < 0 || remaining > 10) {
      return reply.code(400).send({ error: 'remaining must be between 0 and 10' });
    }
    return reply.redirect(remaining === 0 ? '/ok' : `/redirect/${remaining - 1}`);
  });
  app.get('/redirect-loop/a', (_request, reply) => reply.redirect('/redirect-loop/b'));
  app.get('/redirect-loop/b', (_request, reply) => reply.redirect('/redirect-loop/a'));
  app.get<{ Querystring: { target?: string } }>('/redirect-to', async (request, reply) => {
    const target = request.query.target;
    if (!target || Buffer.byteLength(target, 'utf8') > 2048) {
      return reply.code(400).send({ error: 'a bounded target is required' });
    }
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return reply.code(400).send({ error: 'target must be a URL' });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reply.code(400).send({ error: 'target must use HTTP(S)' });
    }
    return reply.redirect(parsed.href);
  });

  app.get<{ Params: { key: string } }>('/flaky/:key', async (request, reply) => {
    const key = request.params.key;
    if (!/^[a-zA-Z0-9_-]{1,32}$/u.test(key)) {
      return reply.code(400).send({ error: 'key must contain 1 through 32 safe characters' });
    }
    const attempt = (flakyCounters.get(key) ?? 0) + 1;
    flakyCounters.set(key, attempt);
    return reply.code(attempt % 2 === 1 ? 503 : 200).send({ attempt });
  });

  app.get('/close', (request, reply) => {
    reply.hijack();
    request.raw.socket.destroy();
  });

  return app;
}
