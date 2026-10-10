import { describe, expect, it } from 'vitest';

import {
  DomainValidationError,
  canonicalizeCheckUrl,
  classifyCheckChanges,
  normalizeCheckConfiguration,
  normalizeExpectedBodySubstring,
  type CheckConfiguration,
} from './checks.js';

const current: CheckConfiguration = {
  expectedBodySubstring: null,
  expectedStatusCode: 200,
  groupId: null,
  intervalSeconds: 30,
  name: 'Homepage',
  timeoutMs: 5000,
  url: 'https://example.com/',
};

describe('check configuration policy', () => {
  it('canonicalizes a public HTTP URL without changing query ordering', () => {
    expect(canonicalizeCheckUrl(' HTTPS://ExAmPle.com:443/a?b=2&a=1#section ')).toBe(
      'https://example.com/a?b=2&a=1',
    );
  });

  it.each([
    'ftp://example.com',
    'https://user:secret@example.com',
    'http://localhost',
    'http://service.internal',
    'http://127.0.0.1',
    'http://2130706433',
    'http://10.2.3.4',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]',
    'http://[::ffff:7f00:1]',
    'http://[fc00::1]',
    'http://192.0.2.1',
    'http://single-label',
  ])('rejects a non-public or invalid target: %s', (url) => {
    expect(() => canonicalizeCheckUrl(url)).toThrow(DomainValidationError);
  });

  it('accepts public IPv4 and IPv6 literals at configuration time', () => {
    expect(canonicalizeCheckUrl('http://8.8.8.8')).toBe('http://8.8.8.8/');
    expect(canonicalizeCheckUrl('https://[2606:4700:4700::1111]')).toBe(
      'https://[2606:4700:4700::1111]/',
    );
  });

  it('enforces UTF-8 bytes rather than JavaScript character count for expected text', () => {
    expect(normalizeExpectedBodySubstring('ü'.repeat(1024))).toHaveLength(1024);
    expect(() => normalizeExpectedBodySubstring('ü'.repeat(1025))).toThrow(/2048 UTF-8 bytes/u);
    expect(() => normalizeExpectedBodySubstring('')).toThrow(DomainValidationError);
  });

  it('normalizes a complete configuration', () => {
    expect(
      normalizeCheckConfiguration({
        expectedStatusCode: 204,
        intervalSeconds: 60,
        name: '  API  ',
        timeoutMs: 10_000,
        url: 'https://API.example.com',
      }),
    ).toEqual({
      expectedBodySubstring: null,
      expectedStatusCode: 204,
      groupId: null,
      intervalSeconds: 60,
      name: 'API',
      timeoutMs: 10_000,
      url: 'https://api.example.com/',
    });
  });

  it.each([
    [{ ...current, intervalSeconds: 29 }, 'interval_seconds'],
    [{ ...current, intervalSeconds: 3601 }, 'interval_seconds'],
    [{ ...current, timeoutMs: 99 }, 'timeout_ms'],
    [{ ...current, timeoutMs: 60_001 }, 'timeout_ms'],
    [{ ...current, expectedStatusCode: 99 }, 'expected_status_code'],
    [{ ...current, expectedStatusCode: 600 }, 'expected_status_code'],
  ])('rejects invalid numeric boundaries', (input, field) => {
    try {
      normalizeCheckConfiguration(input);
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      expect((error as DomainValidationError).field).toBe(field);
    }
  });

  it('classifies combined metadata, probe, schedule and group changes once', () => {
    const changes = classifyCheckChanges(current, {
      expectedBodySubstring: 'ready',
      groupId: '00000000-0000-4000-8000-000000000010',
      intervalSeconds: 60,
      name: 'API',
      url: 'https://api.example.com',
    });
    expect(changes).toMatchObject({
      changedFields: ['expected_body_substring', 'group_id', 'interval_seconds', 'name', 'url'],
      groupChanged: true,
      metadataChanged: true,
      noop: false,
      probeChanged: true,
      scheduleChanged: true,
    });
  });

  it('recognizes normalized no-op patches', () => {
    expect(
      classifyCheckChanges(current, { name: ' Homepage ', url: 'HTTPS://example.com' }),
    ).toMatchObject({ changedFields: [], noop: true });
  });
});
