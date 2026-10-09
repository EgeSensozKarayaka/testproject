import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const TOKEN_BYTES = 32;

export interface VersionedSecretKey {
  key: Buffer;
  version: string;
}

export interface EncryptedPayload {
  ciphertext: Buffer;
  initializationVector: Buffer;
  keyVersion: string;
  tag: Buffer;
}

export function createOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function digestToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function createCsrfToken(sessionId: string, key: VersionedSecretKey): string {
  const mac = createHmac('sha256', key.key)
    .update(`csrf:v1:${sessionId}`, 'utf8')
    .digest('base64url');
  return `${key.version}.${mac}`;
}

export function verifyCsrfToken(
  candidate: string,
  sessionId: string,
  keys: readonly VersionedSecretKey[],
): boolean {
  const separator = candidate.indexOf('.');
  if (separator <= 0) return false;
  const version = candidate.slice(0, separator);
  const key = keys.find((item) => item.version === version);
  if (!key) return false;
  const expected = createCsrfToken(sessionId, key);
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function encryptJson(value: unknown, key: VersionedSecretKey): EncryptedPayload {
  if (key.key.length !== 32) throw new Error('Encryption keys must be exactly 32 bytes.');
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key.key, initializationVector);
  cipher.setAAD(Buffer.from(`transactional-email:${key.version}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    ciphertext,
    initializationVector,
    keyVersion: key.version,
    tag: cipher.getAuthTag(),
  };
}

export function decryptJson<T>(payload: EncryptedPayload, keys: readonly VersionedSecretKey[]): T {
  const key = keys.find((item) => item.version === payload.keyVersion);
  if (!key) throw new Error('Encryption key version is unavailable.');
  const decipher = createDecipheriv('aes-256-gcm', key.key, payload.initializationVector);
  decipher.setAAD(Buffer.from(`transactional-email:${key.version}`, 'utf8'));
  decipher.setAuthTag(payload.tag);
  const plaintext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
