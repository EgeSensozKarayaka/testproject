import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import {
  TargetPolicyError,
  literalAddress,
  validateResolvedAddresses,
  validateTargetUrl,
  type ProbeNetworkPolicy,
  type ValidatedTarget,
} from './address-policy.js';
import { StreamingByteMatcher } from './matcher.js';
import { DnsResolutionError } from './resolver.js';
import {
  ProbeInfrastructureError,
  TransportFailure,
  type HttpTransportPort,
  type ProbeDiagnosticCode,
  type ProbeFailureCategory,
  type ProbeInvocation,
  type ProbeResult,
  type ResolvedAddress,
  type ResolverPort,
  type TransportResponse,
  type TransportTimings,
} from './types.js';

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

interface MutableTimings {
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
}

export interface ProbeEngineConfig {
  readonly networkPolicy: ProbeNetworkPolicy;
  readonly maxRedirects: number;
  readonly maxResponseBytes: number;
  readonly maxHeaderBytes: number;
  readonly connectTimeoutMs: number;
  readonly userAgent: string;
}

export interface ProbeEngineDependencies {
  readonly resolver: ResolverPort;
  readonly transport: HttpTransportPort;
  readonly now?: () => number;
}

function assertProbeInput(input: ProbeInvocation['input']): void {
  if (
    input.schemaVersion !== 1 ||
    typeof input.url !== 'string' ||
    Buffer.byteLength(input.url, 'utf8') < 1 ||
    Buffer.byteLength(input.url, 'utf8') > 2048 ||
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 60_000 ||
    !Number.isInteger(input.expectedStatusCode) ||
    input.expectedStatusCode < 100 ||
    input.expectedStatusCode > 599 ||
    (input.expectedBodySubstring !== null &&
      (typeof input.expectedBodySubstring !== 'string' ||
        Buffer.byteLength(input.expectedBodySubstring, 'utf8') < 1 ||
        Buffer.byteLength(input.expectedBodySubstring, 'utf8') > 2048))
  ) {
    throw new ProbeInfrastructureError('UNSUPPORTED_JOB_SNAPSHOT');
  }
}

class ResponseProcessingError extends Error {
  public override readonly name = 'ResponseProcessingError';

  public constructor(
    public readonly category: Extract<
      ProbeFailureCategory,
      'RESPONSE_TOO_LARGE' | 'PROTOCOL_ERROR' | 'UNKNOWN_NETWORK_ERROR'
    >,
    public readonly diagnosticCode: ProbeDiagnosticCode,
  ) {
    super(diagnosticCode);
  }
}

function roundDuration(value: number): number {
  return Math.max(0, Math.round(value));
}

function addTiming(current: number | null, addition: number | null): number | null {
  if (addition === null) return current;
  return (current ?? 0) + addition;
}

function mergeTransportTimings(target: MutableTimings, source: TransportTimings): void {
  target.connectMs = addTiming(target.connectMs, source.connectMs);
  target.tlsMs = addTiming(target.tlsMs, source.tlsMs);
  target.ttfbMs = addTiming(target.ttfbMs, source.ttfbMs);
}

function headerValue(
  headers: TransportResponse['headers'],
  name: string,
): string | readonly string[] | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return value;
}

function singleHeader(headers: TransportResponse['headers'], name: string): string | null {
  const value = headerValue(headers, name);
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  if (value.length !== 1) throw new ResponseProcessingError('PROTOCOL_ERROR', 'MALFORMED_HTTP');
  return value[0] ?? null;
}

function contentLength(headers: TransportResponse['headers']): number | null {
  const raw = singleHeader(headers, 'content-length');
  if (raw === null) return null;
  if (!/^(0|[1-9][0-9]*)$/u.test(raw)) {
    throw new ResponseProcessingError('PROTOCOL_ERROR', 'MALFORMED_HTTP');
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new ResponseProcessingError('RESPONSE_TOO_LARGE', 'WIRE_BODY_LIMIT');
  }
  return parsed;
}

function decoderFor(headers: TransportResponse['headers']) {
  const raw = singleHeader(headers, 'content-encoding');
  if (raw === null || raw.toLowerCase() === 'identity') return null;
  if (raw.includes(',')) {
    throw new ResponseProcessingError('PROTOCOL_ERROR', 'UNSUPPORTED_CONTENT_ENCODING');
  }
  switch (raw.trim().toLowerCase()) {
    case 'gzip':
      return createGunzip();
    case 'deflate':
      return createInflate();
    case 'br':
      return createBrotliDecompress();
    default:
      throw new ResponseProcessingError('PROTOCOL_ERROR', 'UNSUPPORTED_CONTENT_ENCODING');
  }
}

async function consumeBody(
  response: TransportResponse,
  maxResponseBytes: number,
  expectedBodySubstring: string | null,
): Promise<boolean | null> {
  const declaredLength = contentLength(response.headers);
  if (declaredLength !== null && declaredLength > maxResponseBytes) {
    throw new ResponseProcessingError('RESPONSE_TOO_LARGE', 'WIRE_BODY_LIMIT');
  }

  const matcher =
    expectedBodySubstring === null
      ? null
      : new StreamingByteMatcher(Buffer.from(expectedBodySubstring, 'utf8'));
  let wireBytes = 0;
  async function* boundedWire(): AsyncGenerator<Uint8Array> {
    try {
      for await (const rawChunk of response.body) {
        const chunk = rawChunk instanceof Uint8Array ? rawChunk : Buffer.from(rawChunk);
        wireBytes += chunk.byteLength;
        if (wireBytes > maxResponseBytes) {
          throw new ResponseProcessingError('RESPONSE_TOO_LARGE', 'WIRE_BODY_LIMIT');
        }
        yield chunk;
      }
    } catch (error) {
      if (error instanceof ResponseProcessingError) throw error;
      throw new ResponseProcessingError('UNKNOWN_NETWORK_ERROR', 'NETWORK_FAILURE');
    }
  }

  const decoder = matcher === null ? null : decoderFor(response.headers);
  if (decoder === null) {
    for await (const chunk of boundedWire()) matcher?.push(chunk);
  } else if (matcher !== null) {
    let decodedBytes = 0;
    try {
      const decoded = Readable.from(boundedWire()).pipe(decoder);
      for await (const rawChunk of decoded) {
        const chunk = rawChunk instanceof Uint8Array ? rawChunk : Buffer.from(rawChunk);
        decodedBytes += chunk.byteLength;
        if (decodedBytes > maxResponseBytes) {
          throw new ResponseProcessingError('RESPONSE_TOO_LARGE', 'DECODED_BODY_LIMIT');
        }
        matcher.push(chunk);
      }
    } catch (error) {
      if (error instanceof ResponseProcessingError) throw error;
      throw new ResponseProcessingError('PROTOCOL_ERROR', 'MALFORMED_HTTP');
    }
  }
  return matcher?.found ?? null;
}

function dnsDiagnostic(error: DnsResolutionError): ProbeDiagnosticCode {
  switch (error.code) {
    case 'NXDOMAIN':
      return 'DNS_NXDOMAIN';
    case 'SERVFAIL':
      return 'DNS_SERVFAIL';
    case 'NO_ADDRESS':
      return 'DNS_NO_ADDRESS';
  }
}

export class ProbeEngine {
  readonly #config: ProbeEngineConfig;
  readonly #now: () => number;
  readonly #resolver: ResolverPort;
  readonly #transport: HttpTransportPort;

  public constructor(config: ProbeEngineConfig, dependencies: ProbeEngineDependencies) {
    if (
      !Number.isInteger(config.maxRedirects) ||
      config.maxRedirects < 0 ||
      config.maxRedirects > 10
    ) {
      throw new Error('maxRedirects must be between 0 and 10');
    }
    if (
      !Number.isInteger(config.maxResponseBytes) ||
      config.maxResponseBytes < 1024 ||
      config.maxResponseBytes > 10_485_760
    ) {
      throw new Error('maxResponseBytes must be between 1024 and 10485760');
    }
    if (
      !Number.isInteger(config.maxHeaderBytes) ||
      config.maxHeaderBytes < 1024 ||
      config.maxHeaderBytes > 65_536
    ) {
      throw new Error('maxHeaderBytes must be between 1024 and 65536');
    }
    if (
      !Number.isInteger(config.connectTimeoutMs) ||
      config.connectTimeoutMs < 1 ||
      config.connectTimeoutMs > 60_000
    ) {
      throw new Error('connectTimeoutMs must be between 1 and 60000');
    }
    if (
      config.userAgent.length === 0 ||
      config.userAgent.length > 256 ||
      /[\r\n]/u.test(config.userAgent)
    ) {
      throw new Error('userAgent must contain 1 through 256 characters without CR/LF');
    }
    this.#config = config;
    this.#resolver = dependencies.resolver;
    this.#transport = dependencies.transport;
    this.#now = dependencies.now ?? performance.now.bind(performance);
  }

  public async run(invocation: ProbeInvocation): Promise<ProbeResult> {
    assertProbeInput(invocation.input);
    const startedAt = this.#now();
    const deadline = startedAt + invocation.input.timeoutMs;
    const controller = new AbortController();
    let callerCancelled = invocation.signal.aborted;
    let deadlineExpired = false;
    const abortFromCaller = () => {
      callerCancelled = true;
      controller.abort(new ProbeInfrastructureError('CANCELLED'));
    };
    invocation.signal.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => {
      deadlineExpired = true;
      controller.abort(new Error('probe deadline'));
    }, invocation.input.timeoutMs);
    if (callerCancelled) abortFromCaller();

    const timings: MutableTimings = { dnsMs: null, connectMs: null, tlsMs: null, ttfbMs: null };
    let redirectCount = 0;
    let statusCode: number | null = null;

    const result = (
      outcome: 'PASS' | 'FAIL',
      failureCategory: ProbeFailureCategory | null,
      diagnosticCode: ProbeDiagnosticCode | null,
      bodyMatch: boolean | null,
    ): ProbeResult => ({
      outcome,
      failureCategory,
      diagnosticCode,
      statusCode,
      bodyMatch,
      redirectCount,
      timings: {
        ...timings,
        totalMs: roundDuration(this.#now() - startedAt),
      },
    });

    try {
      let target = validateTargetUrl(invocation.input.url, this.#config.networkPolicy);
      const visited = new Set([target.url.href]);

      while (true) {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (this.#now() >= deadline) {
          deadlineExpired = true;
          controller.abort(new Error('probe deadline'));
          return result('FAIL', 'TIMEOUT', 'TOTAL_DEADLINE', null);
        }

        const addresses = await this.#addressesFor(target, controller.signal, timings);
        if (controller.signal.aborted) throw controller.signal.reason;
        let response: TransportResponse | null = null;
        let lastConnectFailure: TransportFailure | null = null;
        for (const address of addresses) {
          const remaining = Math.max(1, Math.ceil(deadline - this.#now()));
          try {
            response = await this.#transport.request({
              url: target.url,
              address,
              signal: controller.signal,
              connectTimeoutMs: Math.min(this.#config.connectTimeoutMs, remaining),
              headersTimeoutMs: remaining,
              bodyTimeoutMs: remaining,
              maxHeaderBytes: this.#config.maxHeaderBytes,
              userAgent: this.#config.userAgent,
            });
            mergeTransportTimings(timings, response.timings);
            break;
          } catch (error) {
            if (controller.signal.aborted) throw error;
            if (error instanceof TransportFailure) {
              mergeTransportTimings(timings, error.timings);
              if (error.category === 'CONNECT_ERROR') {
                lastConnectFailure = error;
                continue;
              }
            }
            throw error;
          }
        }
        if (response === null) {
          if (lastConnectFailure !== null) {
            return result(
              'FAIL',
              lastConnectFailure.category,
              lastConnectFailure.diagnosticCode,
              null,
            );
          }
          throw new ProbeInfrastructureError('ENGINE_ERROR');
        }

        statusCode = response.statusCode;
        let location: string | null;
        try {
          location = redirectStatuses.has(response.statusCode)
            ? singleHeader(response.headers, 'location')
            : null;
        } catch (error) {
          await response.close('abort');
          throw error;
        }
        if (location !== null) {
          await response.close('abort');
          if (redirectCount >= this.#config.maxRedirects) {
            return result('FAIL', 'TOO_MANY_REDIRECTS', 'REDIRECT_LIMIT', null);
          }
          let nextUrl: URL;
          try {
            nextUrl = new URL(location, target.url);
          } catch {
            return result('FAIL', 'PROTOCOL_ERROR', 'INVALID_REDIRECT', null);
          }
          if (target.url.protocol === 'https:' && nextUrl.protocol === 'http:') {
            return result('FAIL', 'BLOCKED_TARGET', 'REDIRECT_DOWNGRADE', null);
          }
          const nextTarget = validateTargetUrl(nextUrl.href, this.#config.networkPolicy);
          if (visited.has(nextTarget.url.href)) {
            return result('FAIL', 'TOO_MANY_REDIRECTS', 'REDIRECT_LOOP', null);
          }
          visited.add(nextTarget.url.href);
          redirectCount += 1;
          target = nextTarget;
          statusCode = null;
          continue;
        }

        if (response.statusCode === 101) {
          await response.close('abort');
          return result('FAIL', 'PROTOCOL_ERROR', 'HTTP_UPGRADE_NOT_ALLOWED', null);
        }

        try {
          const bodyMatch = await consumeBody(
            response,
            this.#config.maxResponseBytes,
            response.statusCode === invocation.input.expectedStatusCode
              ? invocation.input.expectedBodySubstring
              : null,
          );
          await response.close('graceful');
          if (response.statusCode !== invocation.input.expectedStatusCode) {
            return result('FAIL', 'UNEXPECTED_STATUS', 'STATUS_MISMATCH', null);
          }
          if (invocation.input.expectedBodySubstring !== null && bodyMatch !== true) {
            return result('FAIL', 'BODY_MISMATCH', 'EXPECTED_TEXT_MISSING', false);
          }
          return result('PASS', null, null, bodyMatch);
        } catch (error) {
          await response.close('abort');
          throw error;
        }
      }
    } catch (error) {
      if (deadlineExpired || this.#now() >= deadline) {
        return result('FAIL', 'TIMEOUT', 'TOTAL_DEADLINE', null);
      }
      if (callerCancelled || invocation.signal.aborted) {
        throw new ProbeInfrastructureError('CANCELLED');
      }
      if (error instanceof TargetPolicyError) {
        const category =
          error.diagnosticCode === 'DNS_RESPONSE_LIMIT' ? 'DNS_ERROR' : 'BLOCKED_TARGET';
        return result('FAIL', category, error.diagnosticCode, null);
      }
      if (error instanceof DnsResolutionError) {
        return result('FAIL', 'DNS_ERROR', dnsDiagnostic(error), null);
      }
      if (error instanceof TransportFailure) {
        return result('FAIL', error.category, error.diagnosticCode, null);
      }
      if (error instanceof ResponseProcessingError) {
        return result('FAIL', error.category, error.diagnosticCode, null);
      }
      if (error instanceof ProbeInfrastructureError) throw error;
      throw new ProbeInfrastructureError('ENGINE_ERROR', { cause: error });
    } finally {
      clearTimeout(timer);
      invocation.signal.removeEventListener('abort', abortFromCaller);
    }
  }

  async #addressesFor(
    target: ValidatedTarget,
    signal: AbortSignal,
    timings: MutableTimings,
  ): Promise<readonly ResolvedAddress[]> {
    const literal = literalAddress(target.hostname);
    if (literal !== null) {
      timings.dnsMs = addTiming(timings.dnsMs, 0);
      return validateResolvedAddresses(target, [literal], this.#config.networkPolicy);
    }

    const startedAt = this.#now();
    try {
      const addresses = await this.#resolver.resolve(target.hostname, signal);
      if (addresses.length === 0) throw new DnsResolutionError('NO_ADDRESS');
      return validateResolvedAddresses(target, addresses, this.#config.networkPolicy);
    } finally {
      timings.dnsMs = addTiming(timings.dnsMs, roundDuration(this.#now() - startedAt));
    }
  }
}
