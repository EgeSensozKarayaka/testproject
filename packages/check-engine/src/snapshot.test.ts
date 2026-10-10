import { describe, expect, it } from 'vitest';

import { ProbeInfrastructureError } from './types.js';
import { decodeProbeJobSnapshot } from './snapshot.js';

const legacy = {
  expected_body_substring: 'healthy',
  expected_status_code: 200,
  interval_seconds: 30,
  timeout_ms: 5_000,
  url: 'https://example.com/health',
};

describe('probe job snapshot decoder', () => {
  it('normalizes exact legacy and versioned snapshots', () => {
    expect(decodeProbeJobSnapshot(legacy)).toEqual({
      schemaVersion: 1,
      url: legacy.url,
      timeoutMs: 5_000,
      expectedStatusCode: 200,
      expectedBodySubstring: 'healthy',
    });
    expect(decodeProbeJobSnapshot({ schema_version: 1, ...legacy })).toEqual(
      decodeProbeJobSnapshot(legacy),
    );
  });

  it.each([
    { ...legacy, schema_version: 2 },
    { ...legacy, unexpected: true },
    { ...legacy, timeout_ms: 0 },
    { ...legacy, interval_seconds: 29 },
    { ...legacy, expected_body_substring: '' },
    null,
  ])('rejects unsupported snapshots without echoing their content', (value) => {
    try {
      decodeProbeJobSnapshot(value);
      throw new Error('expected decoder to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ProbeInfrastructureError);
      expect((error as ProbeInfrastructureError).code).toBe('UNSUPPORTED_JOB_SNAPSHOT');
      expect(String(error).includes('example.com')).toBe(false);
      expect(String(error).includes('healthy')).toBe(false);
    }
  });
});
