import { ProbeInfrastructureError, type ProbeInputV1 } from './types.js';

const legacyKeys = [
  'expected_body_substring',
  'expected_status_code',
  'interval_seconds',
  'timeout_ms',
  'url',
] as const;
const versionedKeys = ['schema_version', ...legacyKeys] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function invalidSnapshot(): never {
  throw new ProbeInfrastructureError('UNSUPPORTED_JOB_SNAPSHOT');
}

export function decodeProbeJobSnapshot(value: unknown): Readonly<ProbeInputV1> {
  if (!isRecord(value)) invalidSnapshot();

  const versioned = Object.hasOwn(value, 'schema_version');
  if (!hasExactKeys(value, versioned ? versionedKeys : legacyKeys)) invalidSnapshot();
  if (versioned && value.schema_version !== 1) invalidSnapshot();

  const { expected_body_substring, expected_status_code, interval_seconds, timeout_ms, url } =
    value;
  if (
    typeof url !== 'string' ||
    Buffer.byteLength(url, 'utf8') < 1 ||
    Buffer.byteLength(url, 'utf8') > 2048
  ) {
    invalidSnapshot();
  }
  if (
    !Number.isInteger(timeout_ms) ||
    (timeout_ms as number) < 1 ||
    (timeout_ms as number) > 60_000
  ) {
    invalidSnapshot();
  }
  if (
    !Number.isInteger(expected_status_code) ||
    (expected_status_code as number) < 100 ||
    (expected_status_code as number) > 599
  ) {
    invalidSnapshot();
  }
  if (
    !Number.isInteger(interval_seconds) ||
    (interval_seconds as number) < 30 ||
    (interval_seconds as number) > 3600
  ) {
    invalidSnapshot();
  }
  if (
    expected_body_substring !== null &&
    (typeof expected_body_substring !== 'string' ||
      Buffer.byteLength(expected_body_substring, 'utf8') < 1 ||
      Buffer.byteLength(expected_body_substring, 'utf8') > 2048)
  ) {
    invalidSnapshot();
  }

  return Object.freeze({
    schemaVersion: 1,
    url,
    timeoutMs: timeout_ms as number,
    expectedStatusCode: expected_status_code as number,
    expectedBodySubstring: expected_body_substring,
  });
}
