import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { createProbeNetworkPolicy } from './address-policy.js';
import { ProbeEngine } from './engine.js';
import { UndiciPinnedTransport } from './transport.js';
import type { ResolverPort } from './types.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      async (server) =>
        await new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

async function fixtureServer(): Promise<{ origin: string; port: number }> {
  const server = createServer((request, response) => {
    switch (request.url) {
      case '/ok':
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.write('expected ');
        response.end('content');
        break;
      case '/large':
        response.writeHead(200, { 'content-length': '2048' });
        response.end();
        break;
      case '/redirect':
        response.writeHead(302, { location: '/ok' });
        response.end();
        break;
      case '/gzip':
        response.writeHead(200, { 'content-encoding': 'gzip' });
        response.end(gzipSync('expected content'));
        break;
      case '/hang':
        request.once('close', () => response.destroy());
        break;
      default:
        response.writeHead(404);
        response.end();
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { origin: `http://fixture.test:${port}`, port };
}

function createEngine(origin: string, port: number): ProbeEngine {
  const resolver: ResolverPort = {
    resolve: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
  };
  return new ProbeEngine(
    {
      networkPolicy: createProbeNetworkPolicy({
        allowedPorts: [port],
        developmentAllowedOrigins: [origin],
      }),
      maxRedirects: 5,
      maxResponseBytes: 1024,
      maxHeaderBytes: 16_384,
      connectTimeoutMs: 250,
      userAgent: 'site-monitor-integration/1',
    },
    { resolver, transport: new UndiciPinnedTransport() },
  );
}

function invocation(url: string, timeoutMs = 1_000) {
  return {
    input: {
      schemaVersion: 1 as const,
      url,
      timeoutMs,
      expectedStatusCode: 200,
      expectedBodySubstring: 'expected content',
    },
    signal: new AbortController().signal,
  };
}

describe('secure HTTP check engine with real sockets', () => {
  it('connects only to the pinned address and streams a successful body', async () => {
    const { origin, port } = await fixtureServer();

    const result = await createEngine(origin, port).run(invocation(`${origin}/ok`));

    expect(result).toMatchObject({ outcome: 'PASS', statusCode: 200, bodyMatch: true });
    expect(result.timings.connectMs !== null).toBe(true);
    expect(result.timings.ttfbMs !== null).toBe(true);
  });

  it('follows a policy-checked redirect and rejects oversized content before reading it', async () => {
    const { origin, port } = await fixtureServer();
    const probe = createEngine(origin, port);

    const redirected = await probe.run(invocation(`${origin}/redirect`));
    expect(redirected).toMatchObject({ outcome: 'PASS', redirectCount: 1 });

    const oversized = await probe.run(invocation(`${origin}/large`));
    expect(oversized).toMatchObject({
      outcome: 'FAIL',
      failureCategory: 'RESPONSE_TOO_LARGE',
      diagnosticCode: 'WIRE_BODY_LIMIT',
    });
  });

  it('matches a bounded compressed body and classifies a failed TLS handshake', async () => {
    const { origin, port } = await fixtureServer();
    const probe = createEngine(origin, port);

    await expect(probe.run(invocation(`${origin}/gzip`))).resolves.toMatchObject({
      outcome: 'PASS',
      bodyMatch: true,
    });

    const secureOrigin = `https://fixture.test:${port}`;
    const tlsProbe = createEngine(secureOrigin, port);
    await expect(tlsProbe.run(invocation(`${secureOrigin}/ok`))).resolves.toMatchObject({
      outcome: 'FAIL',
      failureCategory: 'TLS_ERROR',
    });
  });

  it('aborts a hanging socket at the total deadline without delaying fifty fast probes', async () => {
    const { origin, port } = await fixtureServer();
    const probe = createEngine(origin, port);
    const hanging = probe.run(invocation(`${origin}/hang`, 100));
    const fast = await Promise.all(
      Array.from({ length: 50 }, async () => await probe.run(invocation(`${origin}/ok`))),
    );

    expect(fast.every((result) => result.outcome === 'PASS')).toBe(true);
    await expect(hanging).resolves.toMatchObject({
      outcome: 'FAIL',
      failureCategory: 'TIMEOUT',
    });
  });
});
