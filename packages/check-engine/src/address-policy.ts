import ipaddr from 'ipaddr.js';

import type { ProbeDiagnosticCode, ResolvedAddress } from './types.js';

const EXPLICIT_BLOCKED_CIDRS = [
  '192.0.0.0/29',
  '192.0.0.8/32',
  '192.0.0.170/31',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '64:ff9b::/96',
  '64:ff9b:1::/48',
  '100::/64',
  '2001::/32',
  '2001:2::/48',
  '2001:db8::/32',
  '2001:10::/28',
  '2001:20::/28',
  '2002::/16',
] as const;

const parsedBlockedCidrs = EXPLICIT_BLOCKED_CIDRS.map((cidr) => ipaddr.parseCIDR(cidr));
const blockedHostnameSuffixes = ['.localhost', '.local', '.internal', '.home.arpa'] as const;

export interface ProbeNetworkPolicy {
  readonly allowedPorts: ReadonlySet<number>;
  readonly developmentAllowedOrigins: ReadonlySet<string>;
  readonly maxDnsResults: number;
}

export interface ValidatedTarget {
  readonly url: URL;
  readonly hostname: string;
  readonly port: number;
  readonly developmentException: boolean;
}

export class TargetPolicyError extends Error {
  public override readonly name = 'TargetPolicyError';

  public constructor(public readonly diagnosticCode: ProbeDiagnosticCode) {
    super(diagnosticCode);
  }
}

function normalizedHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase();
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function isIpLiteral(hostname: string): boolean {
  return ipaddr.isValid(hostname);
}

function isBlockedHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    (!isIpLiteral(hostname) && !hostname.includes('.')) ||
    blockedHostnameSuffixes.some(
      (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
    )
  );
}

function isExplicitlyBlocked(address: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  return parsedBlockedCidrs.some(([network, prefix]) => {
    if (network.kind() !== address.kind()) return false;
    return address.match(network, prefix);
  });
}

export function normalizeAddress(address: string): ResolvedAddress {
  if (!ipaddr.isValid(address)) throw new TargetPolicyError('PRIVATE_ADDRESS');
  const parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).zoneId !== undefined) {
    throw new TargetPolicyError('PRIVATE_ADDRESS');
  }
  const processed = ipaddr.process(address);
  return Object.freeze({
    address: processed.toString(),
    family: processed.kind() === 'ipv4' ? 4 : 6,
  });
}

function isPublicAddress(address: ResolvedAddress): boolean {
  const parsed = ipaddr.parse(address.address);
  return parsed.range() === 'unicast' && !isExplicitlyBlocked(parsed);
}

function isDevelopmentAddress(address: ResolvedAddress): boolean {
  const range = ipaddr.parse(address.address).range();
  return range === 'loopback' || range === 'private' || range === 'uniqueLocal';
}

export function validateTargetUrl(rawUrl: string, policy: ProbeNetworkPolicy): ValidatedTarget {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TargetPolicyError('INVALID_URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TargetPolicyError('UNSUPPORTED_SCHEME');
  }
  if (url.username !== '' || url.password !== '') {
    throw new TargetPolicyError('CREDENTIALS_NOT_ALLOWED');
  }
  if (Buffer.byteLength(url.href, 'utf8') > 2048) throw new TargetPolicyError('INVALID_URL');
  url.hash = '';

  const hostname = normalizedHostname(url);
  const developmentException = policy.developmentAllowedOrigins.has(url.origin);
  if (
    hostname === '' ||
    hostname.includes('%') ||
    (isBlockedHostname(hostname) && !developmentException)
  ) {
    throw new TargetPolicyError('HOSTNAME_NOT_ALLOWED');
  }

  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  if (!policy.allowedPorts.has(port)) throw new TargetPolicyError('PORT_NOT_ALLOWED');

  return Object.freeze({ url, hostname, port, developmentException });
}

export function literalAddress(hostname: string): ResolvedAddress | null {
  return isIpLiteral(hostname) ? normalizeAddress(hostname) : null;
}

export function validateResolvedAddresses(
  target: ValidatedTarget,
  addresses: readonly ResolvedAddress[],
  policy: ProbeNetworkPolicy,
): readonly ResolvedAddress[] {
  if (addresses.length === 0) throw new TargetPolicyError('PRIVATE_ADDRESS');
  if (addresses.length > policy.maxDnsResults) {
    throw new TargetPolicyError('DNS_RESPONSE_LIMIT');
  }

  const unique = new Map<string, ResolvedAddress>();
  let blocked = false;
  let sawPublic = false;
  let sawPrivate = false;
  for (const candidate of addresses) {
    const normalized = normalizeAddress(candidate.address);
    if (normalized.family !== candidate.family) blocked = true;
    const isPublic = isPublicAddress(normalized);
    sawPublic ||= isPublic;
    sawPrivate ||= !isPublic;
    if (!isPublic && !(target.developmentException && isDevelopmentAddress(normalized))) {
      blocked = true;
    }
    unique.set(`${normalized.family}:${normalized.address}`, normalized);
  }

  if (blocked) {
    throw new TargetPolicyError(sawPublic && sawPrivate ? 'MIXED_ADDRESS_SET' : 'PRIVATE_ADDRESS');
  }
  return Object.freeze([...unique.values()]);
}

export function createProbeNetworkPolicy(input?: {
  readonly allowedPorts?: readonly number[];
  readonly developmentAllowedOrigins?: readonly string[];
  readonly maxDnsResults?: number;
}): ProbeNetworkPolicy {
  const allowedPorts = input?.allowedPorts ?? [80, 443];
  const maxDnsResults = input?.maxDnsResults ?? 16;
  if (
    allowedPorts.length === 0 ||
    allowedPorts.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)
  ) {
    throw new Error('allowedPorts must contain valid TCP ports');
  }
  if (!Number.isInteger(maxDnsResults) || maxDnsResults < 1 || maxDnsResults > 32) {
    throw new Error('maxDnsResults must be between 1 and 32');
  }

  const developmentAllowedOrigins = (input?.developmentAllowedOrigins ?? []).map((origin) => {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      throw new Error('developmentAllowedOrigins must contain canonical HTTP(S) origins');
    }
    return origin;
  });

  return Object.freeze({
    allowedPorts: new Set(allowedPorts),
    developmentAllowedOrigins: new Set(developmentAllowedOrigins),
    maxDnsResults,
  });
}
