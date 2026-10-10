import net from 'node:net';
import tls from 'node:tls';

import { Client } from 'undici';
import type { buildConnector } from 'undici';

import { TransportFailure, type HttpTransportPort, type TransportRequest } from './types.js';

interface MutableTimings {
  connectMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
}

class PinnedSocketError extends Error {
  public override readonly name = 'PinnedSocketError';

  public constructor(
    public readonly phase: 'CONNECT' | 'TLS',
    public readonly code: string,
  ) {
    super(code);
  }
}

function roundDuration(value: number): number {
  return Math.max(0, Math.round(value));
}

function errorProperty(error: unknown, property: 'code' | 'phase'): string | undefined {
  let cursor: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    const record = cursor as Record<string, unknown>;
    if (typeof record[property] === 'string') return record[property];
    cursor = record.cause;
  }
  return undefined;
}

function mapTransportFailure(error: unknown, timings: MutableTimings): TransportFailure {
  const code = errorProperty(error, 'code');
  const phase = errorProperty(error, 'phase');
  const snapshot = { ...timings };

  if (code === 'ECONNREFUSED') {
    return new TransportFailure('CONNECT_ERROR', 'CONNECT_REFUSED', snapshot);
  }
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'EADDRNOTAVAIL') {
    return new TransportFailure('CONNECT_ERROR', 'CONNECT_UNREACHABLE', snapshot);
  }
  if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') {
    return new TransportFailure('TIMEOUT', 'TOTAL_DEADLINE', snapshot);
  }
  if (phase === 'CONNECT' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return new TransportFailure('CONNECT_ERROR', 'CONNECT_FAILED', snapshot);
  }
  if (
    phase === 'TLS' ||
    code?.startsWith('ERR_TLS_') === true ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  ) {
    const diagnostic =
      code?.includes('CERT') === true ||
      code?.includes('SELF_SIGNED') === true ||
      code?.includes('VERIFY') === true
        ? 'TLS_CERTIFICATE'
        : 'TLS_HANDSHAKE';
    return new TransportFailure('TLS_ERROR', diagnostic, snapshot);
  }
  if (code === 'UND_ERR_HEADERS_OVERFLOW') {
    return new TransportFailure('PROTOCOL_ERROR', 'HEADERS_TOO_LARGE', snapshot);
  }
  if (code === 'HPE_INVALID_CONSTANT' || code?.startsWith('HPE_') === true) {
    return new TransportFailure('PROTOCOL_ERROR', 'MALFORMED_HTTP', snapshot);
  }
  return new TransportFailure('UNKNOWN_NETWORK_ERROR', 'NETWORK_FAILURE', snapshot);
}

function createPinnedConnector(
  input: TransportRequest,
  timings: MutableTimings,
): ReturnType<typeof buildConnector> {
  return (_options, callback) => {
    const startedAt = performance.now();
    let settled = false;
    let connectedAt: number | null = null;
    let socket: net.Socket | tls.TLSSocket;

    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal.removeEventListener('abort', abort);
      if (error) {
        socket.destroy();
        callback(error, null);
      } else {
        callback(null, socket);
      }
    };
    const abort = () => finish(new PinnedSocketError('CONNECT', 'ABORTED'));
    const timer = setTimeout(
      () => finish(new PinnedSocketError(connectedAt === null ? 'CONNECT' : 'TLS', 'ETIMEDOUT')),
      input.connectTimeoutMs,
    );

    if (input.url.protocol === 'https:') {
      const tcpSocket = net.connect({
        family: input.address.family,
        host: input.address.address,
        port: Number(input.url.port || 443),
      });
      socket = tcpSocket;
      tcpSocket.once('connect', () => {
        connectedAt = performance.now();
        timings.connectMs = roundDuration(connectedAt - startedAt);
        const hostname = input.url.hostname.replace(/^\[|\]$/gu, '');
        const tlsSocket = tls.connect({
          ALPNProtocols: ['http/1.1'],
          checkServerIdentity: (_servername, certificate) =>
            tls.checkServerIdentity(hostname, certificate),
          rejectUnauthorized: true,
          servername: net.isIP(hostname) === 0 ? hostname : undefined,
          socket: tcpSocket,
        });
        socket = tlsSocket;
        tlsSocket.once('secureConnect', () => {
          const securedAt = performance.now();
          timings.tlsMs = roundDuration(securedAt - connectedAt!);
          finish(null);
        });
        tlsSocket.once('error', (error) => {
          const code = (error as NodeJS.ErrnoException).code ?? 'TLS_ERROR';
          finish(new PinnedSocketError('TLS', code));
        });
      });
    } else {
      socket = net.connect({
        family: input.address.family,
        host: input.address.address,
        port: Number(input.url.port || 80),
      });
      socket.once('connect', () => {
        timings.connectMs = roundDuration(performance.now() - startedAt);
        finish(null);
      });
    }

    socket.once('error', (error) => {
      const phase = input.url.protocol === 'https:' && connectedAt !== null ? 'TLS' : 'CONNECT';
      const code = 'code' in error ? String(error.code) : 'SOCKET_ERROR';
      finish(new PinnedSocketError(phase, code));
    });
    input.signal.addEventListener('abort', abort, { once: true });
    if (input.signal.aborted) abort();
  };
}

export class UndiciPinnedTransport implements HttpTransportPort {
  public async request(input: TransportRequest) {
    const timings: MutableTimings = { connectMs: null, tlsMs: null, ttfbMs: null };
    const client = new Client(input.url.origin, {
      allowH2: false,
      bodyTimeout: input.bodyTimeoutMs,
      connect: createPinnedConnector(input, timings),
      connectTimeout: input.connectTimeoutMs,
      headersTimeout: input.headersTimeoutMs,
      maxCachedSessions: 0,
      maxHeaderSize: input.maxHeaderBytes,
      maxRequestsPerClient: 1,
      pipelining: 1,
    });
    const requestStartedAt = performance.now();

    try {
      const response = await client.request({
        bodyTimeout: input.bodyTimeoutMs,
        headers: {
          accept: '*/*',
          'accept-encoding': 'identity',
          'cache-control': 'no-cache',
          'user-agent': input.userAgent,
        },
        headersTimeout: input.headersTimeoutMs,
        method: 'GET',
        path: `${input.url.pathname}${input.url.search}`,
        reset: true,
        signal: input.signal,
      });
      timings.ttfbMs = roundDuration(performance.now() - requestStartedAt);
      let closed = false;
      return {
        statusCode: response.statusCode,
        headers: response.headers,
        body: response.body,
        timings: { ...timings },
        async close(mode: 'graceful' | 'abort'): Promise<void> {
          if (closed) return;
          closed = true;
          if (mode === 'abort') {
            response.body.once('error', () => undefined);
            response.body.destroy();
            await client.destroy();
          } else {
            await client.close();
          }
        },
      };
    } catch (error) {
      await client.destroy();
      if (input.signal.aborted) throw error;
      throw mapTransportFailure(error, timings);
    }
  }
}
