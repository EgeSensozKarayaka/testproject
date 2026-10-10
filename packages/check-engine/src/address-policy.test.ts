import { describe, expect, it } from 'vitest';

import {
  TargetPolicyError,
  createProbeNetworkPolicy,
  literalAddress,
  validateResolvedAddresses,
  validateTargetUrl,
} from './address-policy.js';

const productionPolicy = createProbeNetworkPolicy();

function expectPolicyError(action: () => unknown, diagnosticCode: string): void {
  try {
    action();
    throw new Error('expected policy rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(TargetPolicyError);
    expect((error as TargetPolicyError).diagnosticCode).toBe(diagnosticCode);
  }
}

describe('probe address policy', () => {
  it.each([
    ['http://localhost', 'HOSTNAME_NOT_ALLOWED'],
    ['http://service.internal', 'HOSTNAME_NOT_ALLOWED'],
    ['ftp://example.com', 'UNSUPPORTED_SCHEME'],
    ['https://user:secret@example.com', 'CREDENTIALS_NOT_ALLOWED'],
    ['https://example.com:8443', 'PORT_NOT_ALLOWED'],
  ])('rejects unsafe URL %s', (url, diagnostic) => {
    expectPolicyError(() => validateTargetUrl(url, productionPolicy), diagnostic);
  });

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '192.0.2.1',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '64:ff9b::a00:1',
    '::ffff:10.0.0.1',
  ])('blocks special-use address %s', (address) => {
    const target = validateTargetUrl('https://example.com', productionPolicy);
    const candidate = literalAddress(address)!;
    expectPolicyError(
      () => validateResolvedAddresses(target, [candidate], productionPolicy),
      'PRIVATE_ADDRESS',
    );
  });

  it('allows globally routed IPv4 and IPv6 addresses', () => {
    const target = validateTargetUrl('https://example.com', productionPolicy);
    expect(
      validateResolvedAddresses(
        target,
        [literalAddress('93.184.216.34')!, literalAddress('2606:4700:4700::1111')!],
        productionPolicy,
      ),
    ).toHaveLength(2);
  });

  it('rejects the whole mixed public/private answer set', () => {
    const target = validateTargetUrl('https://example.com', productionPolicy);
    expectPolicyError(
      () =>
        validateResolvedAddresses(
          target,
          [literalAddress('93.184.216.34')!, literalAddress('10.0.0.1')!],
          productionPolicy,
        ),
      'MIXED_ADDRESS_SET',
    );
  });

  it('canonicalizes legacy IPv4 spellings before blocking them', () => {
    const target = validateTargetUrl('http://2130706433', productionPolicy);
    expect(target.hostname).toBe('127.0.0.1');
    expectPolicyError(
      () => validateResolvedAddresses(target, [literalAddress(target.hostname)!], productionPolicy),
      'PRIVATE_ADDRESS',
    );
  });

  it('limits the development exception to an exact origin and explicit port', () => {
    const policy = createProbeNetworkPolicy({
      allowedPorts: [80, 4010],
      developmentAllowedOrigins: ['http://target-simulator:4010', 'http://target.test:4010'],
    });
    const composeTarget = validateTargetUrl('http://target-simulator:4010/ok', policy);
    expect(
      validateResolvedAddresses(composeTarget, [literalAddress('172.20.0.10')!], policy),
    ).toHaveLength(1);
    expectPolicyError(
      () => validateTargetUrl('http://other-service:4010/ok', policy),
      'HOSTNAME_NOT_ALLOWED',
    );

    const allowed = validateTargetUrl('http://target.test:4010/ok', policy);
    expect(validateResolvedAddresses(allowed, [literalAddress('127.0.0.1')!], policy)).toHaveLength(
      1,
    );
    expectPolicyError(
      () => validateResolvedAddresses(allowed, [literalAddress('169.254.169.254')!], policy),
      'PRIVATE_ADDRESS',
    );

    const otherPort = validateTargetUrl('http://target.test/ok', policy);
    expectPolicyError(
      () => validateResolvedAddresses(otherPort, [literalAddress('127.0.0.1')!], policy),
      'PRIVATE_ADDRESS',
    );
  });
});
