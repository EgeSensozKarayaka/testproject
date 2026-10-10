import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createProbeNetworkPolicy } from './address-policy.js';
import { ProbeEngine } from './engine.js';
import { DnsResolutionError } from './resolver.js';
import type {
  HttpTransportPort,
  ProbeInfrastructureError,
  ResolverPort,
  TransportRequest,
  TransportResponse,
} from './types.js';

function body(...chunks: string[]): AsyncIterable<Uint8Array> {
  return Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
}

const publicAddress = [{ address: '93.184.216.34', family: 4 as const }];

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('aborted');
}

function response(input?: {
  statusCode?: number;
  headers?: Record<string, string>;
  chunks?: string[];
}): TransportResponse {
  return {
    statusCode: input?.statusCode ?? 200,
    headers: input?.headers ?? {},
    body: body(...(input?.chunks ?? ['expected content'])),
    timings: { connectMs: 2, tlsMs: 1, ttfbMs: 3 },
    close: vi.fn(() => Promise.resolve()),
  };
}

function invocation(url = 'https://first.example/health') {
  return {
    input: {
      schemaVersion: 1 as const,
      url,
      timeoutMs: 1_000,
      expectedStatusCode: 200,
      expectedBodySubstring: 'expected content',
    },
    signal: new AbortController().signal,
  };
}

function engine(resolver: ResolverPort, transport: HttpTransportPort, allowedPorts = [80, 443]) {
  return new ProbeEngine(
    {
      networkPolicy: createProbeNetworkPolicy({ allowedPorts }),
      maxRedirects: 5,
      maxResponseBytes: 1024,
      maxHeaderBytes: 16_384,
      connectTimeoutMs: 500,
      userAgent: 'site-monitor-test/1',
    },
    { resolver, transport },
  );
}

describe('ProbeEngine', () => {
  it('uses one DNS answer set and passes a streaming body match', async () => {
    const resolve = vi.fn(() => Promise.resolve(publicAddress));
    const request = vi.fn((input: TransportRequest) => {
      expect(input.address).toEqual({ address: '93.184.216.34', family: 4 });
      return Promise.resolve(response({ chunks: ['expected ', 'content'] }));
    });

    const result = await engine({ resolve }, { request }).run(invocation());

    expect(result).toMatchObject({
      outcome: 'PASS',
      failureCategory: null,
      statusCode: 200,
      bodyMatch: true,
      redirectCount: 0,
    });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('re-resolves and revalidates every redirect hop', async () => {
    const resolve = vi
      .fn<ResolverPort['resolve']>()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }]);
    const request = vi
      .fn<HttpTransportPort['request']>()
      .mockResolvedValueOnce(
        response({ statusCode: 302, headers: { location: 'https://next.example/ok' } }),
      )
      .mockResolvedValueOnce(response());

    const result = await engine({ resolve }, { request }).run(invocation());

    expect(result.outcome).toBe('PASS');
    expect(result.redirectCount).toBe(1);
    expect(resolve).toHaveBeenNthCalledWith(1, 'first.example', expect.any(AbortSignal));
    expect(resolve).toHaveBeenNthCalledWith(2, 'next.example', expect.any(AbortSignal));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('blocks a redirect that resolves private before opening its socket', async () => {
    const resolve = vi
      .fn<ResolverPort['resolve']>()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    const request = vi
      .fn<HttpTransportPort['request']>()
      .mockResolvedValueOnce(
        response({ statusCode: 302, headers: { location: 'http://metadata.example/latest' } }),
      );

    const result = await engine({ resolve }, { request }).run(invocation('http://first.example'));

    expect(result).toMatchObject({
      outcome: 'FAIL',
      failureCategory: 'BLOCKED_TARGET',
      diagnosticCode: 'PRIVATE_ADDRESS',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('applies response-size precedence before status mismatch', async () => {
    const resolver: ResolverPort = {
      resolve: () => Promise.resolve(publicAddress),
    };
    const transport: HttpTransportPort = {
      request: () =>
        Promise.resolve(
          response({ statusCode: 503, headers: { 'content-length': '2048' }, chunks: [] }),
        ),
    };

    const result = await engine(resolver, transport).run(invocation());

    expect(result).toMatchObject({
      failureCategory: 'RESPONSE_TOO_LARGE',
      diagnosticCode: 'WIRE_BODY_LIMIT',
      statusCode: 503,
    });
  });

  it('classifies DNS, status and body failures without exposing sensitive content', async () => {
    const failingResolver: ResolverPort = {
      resolve: () => Promise.reject(new DnsResolutionError('NXDOMAIN')),
    };
    await expect(
      engine(failingResolver, { request: () => Promise.resolve(response()) }).run(invocation()),
    ).resolves.toMatchObject({
      failureCategory: 'DNS_ERROR',
      diagnosticCode: 'DNS_NXDOMAIN',
    });
    await expect(
      engine(
        { resolve: () => Promise.resolve([]) },
        { request: () => Promise.resolve(response()) },
      ).run(invocation()),
    ).resolves.toMatchObject({
      failureCategory: 'DNS_ERROR',
      diagnosticCode: 'DNS_NO_ADDRESS',
    });

    const resolver: ResolverPort = {
      resolve: () => Promise.resolve(publicAddress),
    };
    const statusResult = await engine(resolver, {
      request: () => Promise.resolve(response({ statusCode: 503, chunks: ['SECRET_BODY'] })),
    }).run(invocation('https://first.example/health?token=SECRET_QUERY'));
    expect(statusResult).toMatchObject({
      failureCategory: 'UNEXPECTED_STATUS',
      diagnosticCode: 'STATUS_MISMATCH',
    });
    expect(JSON.stringify(statusResult).includes('SECRET_QUERY')).toBe(false);
    expect(JSON.stringify(statusResult).includes('SECRET_BODY')).toBe(false);

    const bodyResult = await engine(resolver, {
      request: () => Promise.resolve(response({ chunks: ['different'] })),
    }).run(invocation());
    expect(bodyResult).toMatchObject({
      failureCategory: 'BODY_MISMATCH',
      diagnosticCode: 'EXPECTED_TEXT_MISSING',
      bodyMatch: false,
    });
  });

  it('detects canonical redirect loops', async () => {
    const resolver: ResolverPort = {
      resolve: () => Promise.resolve(publicAddress),
    };
    const transport: HttpTransportPort = {
      request: ({ url }) =>
        Promise.resolve(
          response({
            statusCode: 302,
            headers: { location: url.pathname === '/a' ? '/b' : '/a' },
          }),
        ),
    };

    const looped = await engine(resolver, transport).run(invocation('https://first.example/a'));
    expect(looped).toMatchObject({
      failureCategory: 'TOO_MANY_REDIRECTS',
      diagnosticCode: 'REDIRECT_LOOP',
      redirectCount: 1,
    });
  });

  it('closes the response when a redirect header is invalid', async () => {
    const close = vi.fn<TransportResponse['close']>(() => Promise.resolve());
    const invalidRedirect = {
      ...response({ statusCode: 302, headers: { location: 'http://[' } }),
      close,
    };
    const resolver: ResolverPort = { resolve: () => Promise.resolve(publicAddress) };
    const result = await engine(resolver, {
      request: () => Promise.resolve(invalidRedirect),
    }).run(invocation());

    expect(result).toMatchObject({
      failureCategory: 'PROTOCOL_ERROR',
      diagnosticCode: 'INVALID_REDIRECT',
    });
    expect(close).toHaveBeenCalledWith('abort');
  });

  it('rejects unsupported content encoding when body validation is required', async () => {
    const resolver: ResolverPort = {
      resolve: () => Promise.resolve(publicAddress),
    };
    const transport: HttpTransportPort = {
      request: () => Promise.resolve(response({ headers: { 'content-encoding': 'compress' } })),
    };

    await expect(engine(resolver, transport).run(invocation())).resolves.toMatchObject({
      failureCategory: 'PROTOCOL_ERROR',
      diagnosticCode: 'UNSUPPORTED_CONTENT_ENCODING',
    });
  });

  it('classifies the total deadline as target timeout', async () => {
    const resolver: ResolverPort = {
      resolve: () => Promise.resolve(publicAddress),
    };
    const transport: HttpTransportPort = {
      request: ({ signal }) =>
        new Promise<TransportResponse>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError(signal)), { once: true });
        }),
    };
    const run = invocation();
    run.input.timeoutMs = 20;

    const result = await engine(resolver, transport).run(run);

    expect(result).toMatchObject({
      outcome: 'FAIL',
      failureCategory: 'TIMEOUT',
      diagnosticCode: 'TOTAL_DEADLINE',
    });
  });

  it('keeps caller cancellation outside target health', async () => {
    const resolver: ResolverPort = {
      resolve: () => Promise.resolve(publicAddress),
    };
    const transport: HttpTransportPort = {
      request: ({ signal }) =>
        new Promise<TransportResponse>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError(signal)), { once: true });
        }),
    };
    const controller = new AbortController();
    const pending = engine(resolver, transport).run({ ...invocation(), signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject<Partial<ProbeInfrastructureError>>({
      code: 'CANCELLED',
    });
  });
});
