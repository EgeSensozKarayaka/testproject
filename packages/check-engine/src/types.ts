export const PROBE_FAILURE_CATEGORIES = [
  'DNS_ERROR',
  'CONNECT_ERROR',
  'TLS_ERROR',
  'TIMEOUT',
  'TOO_MANY_REDIRECTS',
  'BLOCKED_TARGET',
  'RESPONSE_TOO_LARGE',
  'UNEXPECTED_STATUS',
  'BODY_MISMATCH',
  'PROTOCOL_ERROR',
  'UNKNOWN_NETWORK_ERROR',
] as const;

export type ProbeFailureCategory = (typeof PROBE_FAILURE_CATEGORIES)[number];

export const PROBE_DIAGNOSTIC_CODES = [
  'DNS_NXDOMAIN',
  'DNS_SERVFAIL',
  'DNS_NO_ADDRESS',
  'DNS_RESPONSE_LIMIT',
  'CONNECT_REFUSED',
  'CONNECT_UNREACHABLE',
  'CONNECT_FAILED',
  'TLS_CERTIFICATE',
  'TLS_HANDSHAKE',
  'TOTAL_DEADLINE',
  'INVALID_URL',
  'UNSUPPORTED_SCHEME',
  'CREDENTIALS_NOT_ALLOWED',
  'HOSTNAME_NOT_ALLOWED',
  'PORT_NOT_ALLOWED',
  'PRIVATE_ADDRESS',
  'MIXED_ADDRESS_SET',
  'REDIRECT_LOOP',
  'REDIRECT_LIMIT',
  'REDIRECT_DOWNGRADE',
  'INVALID_REDIRECT',
  'HEADERS_TOO_LARGE',
  'WIRE_BODY_LIMIT',
  'DECODED_BODY_LIMIT',
  'UNSUPPORTED_CONTENT_ENCODING',
  'HTTP_UPGRADE_NOT_ALLOWED',
  'MALFORMED_HTTP',
  'STATUS_MISMATCH',
  'EXPECTED_TEXT_MISSING',
  'NETWORK_FAILURE',
] as const;

export type ProbeDiagnosticCode = (typeof PROBE_DIAGNOSTIC_CODES)[number];

export interface ProbeInputV1 {
  readonly schemaVersion: 1;
  readonly url: string;
  readonly timeoutMs: number;
  readonly expectedStatusCode: number;
  readonly expectedBodySubstring: string | null;
}

export interface ProbeInvocation {
  readonly input: Readonly<ProbeInputV1>;
  readonly signal: AbortSignal;
}

export interface ProbeTimings {
  readonly dnsMs: number | null;
  readonly connectMs: number | null;
  readonly tlsMs: number | null;
  readonly ttfbMs: number | null;
  readonly totalMs: number;
}

export interface ProbeResult {
  readonly outcome: 'PASS' | 'FAIL';
  readonly failureCategory: ProbeFailureCategory | null;
  readonly statusCode: number | null;
  readonly bodyMatch: boolean | null;
  readonly timings: ProbeTimings;
  readonly redirectCount: number;
  readonly diagnosticCode: ProbeDiagnosticCode | null;
}

export type ProbeInfrastructureErrorCode =
  'CANCELLED' | 'UNSUPPORTED_JOB_SNAPSHOT' | 'ENGINE_ERROR';

export class ProbeInfrastructureError extends Error {
  public override readonly name = 'ProbeInfrastructureError';

  public constructor(
    public readonly code: ProbeInfrastructureErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
  }
}

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface ResolverPort {
  resolve(hostname: string, signal: AbortSignal): Promise<readonly ResolvedAddress[]>;
}

export interface TransportTimings {
  readonly connectMs: number | null;
  readonly tlsMs: number | null;
  readonly ttfbMs: number | null;
}

export interface TransportResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
  readonly timings: TransportTimings;
  close(mode: 'graceful' | 'abort'): Promise<void>;
}

export interface TransportRequest {
  readonly url: URL;
  readonly address: ResolvedAddress;
  readonly signal: AbortSignal;
  readonly connectTimeoutMs: number;
  readonly headersTimeoutMs: number;
  readonly bodyTimeoutMs: number;
  readonly maxHeaderBytes: number;
  readonly userAgent: string;
}

export interface HttpTransportPort {
  request(input: TransportRequest): Promise<TransportResponse>;
}

export class TransportFailure extends Error {
  public override readonly name = 'TransportFailure';

  public constructor(
    public readonly category: Extract<
      ProbeFailureCategory,
      'CONNECT_ERROR' | 'TLS_ERROR' | 'TIMEOUT' | 'PROTOCOL_ERROR' | 'UNKNOWN_NETWORK_ERROR'
    >,
    public readonly diagnosticCode: ProbeDiagnosticCode,
    public readonly timings: TransportTimings,
    options?: ErrorOptions,
  ) {
    super(diagnosticCode, options);
  }
}
