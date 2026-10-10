import { isIP } from 'node:net';

const MAX_NAME_CODE_POINTS = 160;
const MAX_INPUT_URL_CODE_POINTS = 2048;
const MAX_CANONICAL_URL_BYTES = 4096;
const MAX_EXPECTED_SUBSTRING_BYTES = 2048;

const blockedHostnames = new Set([
  'instance-data.ec2.internal',
  'localhost',
  'metadata.aws.internal',
  'metadata.google.internal',
]);
const blockedHostnameSuffixes = ['.home.arpa', '.internal', '.local', '.localhost'];

export class DomainValidationError extends Error {
  constructor(
    readonly field: string,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CheckConfiguration {
  expectedBodySubstring: string | null;
  expectedStatusCode: number;
  groupId: string | null;
  intervalSeconds: number;
  name: string;
  timeoutMs: number;
  url: string;
}

export interface CheckConfigurationInput {
  expectedBodySubstring?: string | null;
  expectedStatusCode: number;
  groupId?: string | null;
  intervalSeconds: number;
  name: string;
  timeoutMs: number;
  url: string;
}

export interface CheckConfigurationPatch {
  expectedBodySubstring?: string | null;
  expectedStatusCode?: number;
  groupId?: string | null;
  intervalSeconds?: number;
  name?: string;
  timeoutMs?: number;
  url?: string;
}

export interface CheckChangeSet {
  changedFields: string[];
  groupChanged: boolean;
  metadataChanged: boolean;
  next: CheckConfiguration;
  noop: boolean;
  probeChanged: boolean;
  scheduleChanged: boolean;
}

function fail(field: string, code: string, message: string): never {
  throw new DomainValidationError(field, code, message);
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function trimAsciiWhitespace(value: string): string {
  return value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu, '');
}

function assertIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(field, 'out_of_range', `${field} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

export function normalizeResourceName(value: string): string {
  const normalized = trimAsciiWhitespace(value).normalize('NFC');
  const length = codePointLength(normalized);
  if (length < 1 || length > MAX_NAME_CODE_POINTS) {
    fail('name', 'invalid_length', 'name must contain from 1 through 160 characters.');
  }
  return normalized;
}

function ipv4Number(address: string): number {
  return address
    .split('.')
    .map(Number)
    .reduce((result, octet) => result * 256 + octet, 0);
}

function ipv4InCidr(address: number, network: number, prefix: number): boolean {
  const divisor = 2 ** (32 - prefix);
  return Math.floor(address / divisor) === Math.floor(network / divisor);
}

function isBlockedIpv4(address: string): boolean {
  const value = ipv4Number(address);
  const networks: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  return networks.some(([network, prefix]) => ipv4InCidr(value, ipv4Number(network), prefix));
}

function mappedIpv4(address: string): string | null {
  if (!address.startsWith('::ffff:')) return null;
  const suffix = address.slice('::ffff:'.length);
  if (isIP(suffix) === 4) return suffix;
  const parts = suffix.split(':');
  if (parts.length !== 2) return null;
  const high = Number.parseInt(parts[0] ?? '', 16);
  const low = Number.parseInt(parts[1] ?? '', 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) return null;
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  const mapped = mappedIpv4(normalized);
  if (mapped) return isBlockedIpv4(mapped);

  const firstHextet = Number.parseInt(normalized.split(':', 1)[0] || '0', 16);
  return (
    normalized === '::' ||
    normalized === '::1' ||
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00 ||
    normalized.startsWith('100:') ||
    normalized.startsWith('2001:2:') ||
    normalized.startsWith('2001:db8:') ||
    normalized.startsWith('2001:10:')
  );
}

function assertPublicConfigurationHost(rawHostname: string): string {
  const unwrapped = rawHostname.startsWith('[') ? rawHostname.slice(1, -1) : rawHostname;
  const hostname = unwrapped.toLowerCase().replace(/\.$/u, '');
  const ipVersion = isIP(hostname);
  if (
    (ipVersion === 4 && isBlockedIpv4(hostname)) ||
    (ipVersion === 6 && isBlockedIpv6(hostname))
  ) {
    fail('url', 'blocked_target', 'url must not use a private or reserved network target.');
  }
  if (ipVersion > 0) return hostname;
  if (
    blockedHostnames.has(hostname) ||
    blockedHostnameSuffixes.some((suffix) => hostname.endsWith(suffix))
  ) {
    fail('url', 'blocked_target', 'url must not use a local or metadata hostname.');
  }
  if (!hostname.includes('.')) {
    fail('url', 'blocked_target', 'url must use a public fully-qualified hostname.');
  }
  return hostname;
}

export function canonicalizeCheckUrl(value: string): string {
  const trimmed = trimAsciiWhitespace(value);
  if (codePointLength(trimmed) < 1 || codePointLength(trimmed) > MAX_INPUT_URL_CODE_POINTS) {
    fail('url', 'invalid_length', 'url must contain from 1 through 2048 characters.');
  }
  if (
    Array.from(trimmed).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    fail('url', 'invalid_url', 'url must not contain control characters.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    fail('url', 'invalid_url', 'url must be an absolute HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    fail('url', 'invalid_protocol', 'url must use the HTTP or HTTPS protocol.');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    fail('url', 'credentials_forbidden', 'url must not contain credentials.');
  }

  const hostname = assertPublicConfigurationHost(parsed.hostname);
  if (isIP(hostname) === 0) parsed.hostname = hostname;
  parsed.hash = '';
  const canonical = parsed.toString();
  if (Buffer.byteLength(canonical, 'utf8') > MAX_CANONICAL_URL_BYTES) {
    fail('url', 'invalid_length', 'canonical url must not exceed 4096 UTF-8 bytes.');
  }
  return canonical;
}

export function normalizeExpectedBodySubstring(value: string | null): string | null {
  if (value === null) return null;
  const length = Buffer.byteLength(value, 'utf8');
  if (length < 1 || length > MAX_EXPECTED_SUBSTRING_BYTES) {
    fail(
      'expected_body_substring',
      'invalid_length',
      'expected_body_substring must contain from 1 through 2048 UTF-8 bytes.',
    );
  }
  return value;
}

export function normalizeCheckConfiguration(input: CheckConfigurationInput): CheckConfiguration {
  return {
    expectedBodySubstring: normalizeExpectedBodySubstring(input.expectedBodySubstring ?? null),
    expectedStatusCode: assertIntegerInRange(
      input.expectedStatusCode,
      100,
      599,
      'expected_status_code',
    ),
    groupId: input.groupId ?? null,
    intervalSeconds: assertIntegerInRange(input.intervalSeconds, 30, 3600, 'interval_seconds'),
    name: normalizeResourceName(input.name),
    timeoutMs: assertIntegerInRange(input.timeoutMs, 100, 60_000, 'timeout_ms'),
    url: canonicalizeCheckUrl(input.url),
  };
}

export function classifyCheckChanges(
  current: CheckConfiguration,
  patch: CheckConfigurationPatch,
): CheckChangeSet {
  const next: CheckConfiguration = {
    ...current,
    ...(Object.hasOwn(patch, 'name') ? { name: normalizeResourceName(patch.name!) } : {}),
    ...(Object.hasOwn(patch, 'url') ? { url: canonicalizeCheckUrl(patch.url!) } : {}),
    ...(Object.hasOwn(patch, 'groupId') ? { groupId: patch.groupId ?? null } : {}),
    ...(Object.hasOwn(patch, 'intervalSeconds')
      ? {
          intervalSeconds: assertIntegerInRange(
            patch.intervalSeconds!,
            30,
            3600,
            'interval_seconds',
          ),
        }
      : {}),
    ...(Object.hasOwn(patch, 'timeoutMs')
      ? { timeoutMs: assertIntegerInRange(patch.timeoutMs!, 100, 60_000, 'timeout_ms') }
      : {}),
    ...(Object.hasOwn(patch, 'expectedStatusCode')
      ? {
          expectedStatusCode: assertIntegerInRange(
            patch.expectedStatusCode!,
            100,
            599,
            'expected_status_code',
          ),
        }
      : {}),
    ...(Object.hasOwn(patch, 'expectedBodySubstring')
      ? {
          expectedBodySubstring: normalizeExpectedBodySubstring(
            patch.expectedBodySubstring ?? null,
          ),
        }
      : {}),
  };

  const fieldPairs: Array<[keyof CheckConfiguration, string]> = [
    ['expectedBodySubstring', 'expected_body_substring'],
    ['expectedStatusCode', 'expected_status_code'],
    ['groupId', 'group_id'],
    ['intervalSeconds', 'interval_seconds'],
    ['name', 'name'],
    ['timeoutMs', 'timeout_ms'],
    ['url', 'url'],
  ];
  const changedFields = fieldPairs
    .filter(([field]) => current[field] !== next[field])
    .map(([, externalName]) => externalName)
    .sort();
  const changed = new Set(changedFields);
  const probeChanged = [
    'url',
    'timeout_ms',
    'expected_status_code',
    'expected_body_substring',
  ].some((field) => changed.has(field));

  return {
    changedFields,
    groupChanged: changed.has('group_id'),
    metadataChanged: changed.has('name'),
    next,
    noop: changedFields.length === 0,
    probeChanged,
    scheduleChanged: changed.has('interval_seconds'),
  };
}
