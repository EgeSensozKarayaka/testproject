import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  PasswordService,
  canonicalizeEmail,
  createCsrfToken,
  createOpaqueToken,
  decryptJson,
  digestToken,
  encryptJson,
  verifyCsrfToken,
} from './index.js';

describe('authentication primitives', () => {
  it('canonicalizes email without provider-specific rewriting', () => {
    expect(canonicalizeEmail(' Alice+Monitor@EXAMPLE.com ')).toEqual({
      display: 'Alice+Monitor@EXAMPLE.com',
      normalized: 'alice+monitor@example.com',
    });
  });

  it('creates high-entropy opaque tokens and fixed-length digests', () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();
    expect(first).not.toBe(second);
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(digestToken(first)).toHaveLength(32);
  });

  it('binds CSRF tokens to a session and key version', () => {
    const key = { key: randomBytes(32), version: 'v1' };
    const token = createCsrfToken('session-a', key);
    expect(verifyCsrfToken(token, 'session-a', [key])).toBe(true);
    expect(verifyCsrfToken(token, 'session-b', [key])).toBe(false);
  });

  it('authenticates encrypted transactional payloads', () => {
    const key = { key: randomBytes(32), version: 'v1' };
    const encrypted = encryptJson({ token: 'secret' }, key);
    expect(encrypted.ciphertext.toString('utf8')).not.toContain('secret');
    expect(decryptJson<{ token: string }>(encrypted, [key])).toEqual({ token: 'secret' });
  });

  it('enforces length and strength before hashing with Argon2id', async () => {
    const passwords = new PasswordService(1);
    expect(passwords.assess('passwordpassword').accepted).toBe(false);
    const strong = 'Correct Horse Battery Staple! 2026';
    expect(passwords.assess(strong).accepted).toBe(true);
    const encoded = await passwords.hash(strong);
    expect(encoded).toContain('$argon2id$');
    await expect(passwords.verify(encoded, strong)).resolves.toBe(true);
    await expect(passwords.verify(encoded, `${strong}!`)).resolves.toBe(false);
    expect(passwords.needsRehash(encoded)).toBe(false);
    expect(
      passwords.needsRehash(
        '$argon2id$v=19$m=65536,t=3,p=2$c29tZXNhbHQxMjM0NTY3OA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ),
    ).toBe(false);
  });
});
