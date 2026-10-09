import { createHash, createHmac } from 'node:crypto';

import {
  PasswordService,
  canonicalizeEmail,
  createCsrfToken,
  createOpaqueToken,
  digestToken,
  encryptJson,
  normalizeDisplayName,
  verifyCsrfToken,
  type VersionedSecretKey,
} from '@site-monitor/auth';
import type { Pool } from '@site-monitor/database';

import { ApiProblemError } from './problem.js';

const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1_000;
const SESSION_IDLE_MS = 24 * 60 * 60 * 1_000;
const SESSION_TOUCH_MS = 5 * 60 * 1_000;
const ROTATION_GRACE_MS = 30 * 1_000;
const CHALLENGE_MS = 60 * 60 * 1_000;

interface LoginCredentialRow {
  email_verified_at: Date | null;
  owner_id: string;
  password_hash: string;
  password_version: number;
  user_status: string;
}

interface SessionRow {
  absolute_expires_at: Date;
  created_at: Date;
  display_name: string;
  email_display: string;
  email_verified_at: Date | null;
  idle_expires_at: Date;
  owner_id: string;
  resource_version: string;
  session_id: string;
  user_created_at: Date;
}

interface TouchedSessionRow {
  absolute_expires_at: Date;
  idle_expires_at: Date;
  rotated: boolean;
  session_id: string;
}

interface UserProfileRow {
  created_at: Date;
  display_name: string;
  email_display: string;
  email_verified_at: Date | null;
  owner_id: string;
  resource_version: string;
}

export interface AuthenticatedSession {
  csrfToken: string;
  expiresAt: string;
  sessionId: string;
  tokenReplacement?: string;
  user: {
    created_at: string;
    display_name: string;
    email: string;
    email_verified: boolean;
    id: string;
    resource_version: string;
  };
}

export interface AuthServiceOptions {
  csrfKey: VersionedSecretKey;
  emailEncryptionKey: VersionedSecretKey;
  passwordConcurrency?: number;
  rateLimitKey: Buffer;
}

function addMilliseconds(milliseconds: number): Date {
  return new Date(Date.now() + milliseconds);
}

function minimumDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

export class AuthService {
  readonly #csrfKey: VersionedSecretKey;
  readonly #database: Pool;
  readonly #dummyPasswordHash: string;
  readonly #emailEncryptionKey: VersionedSecretKey;
  readonly #passwords: PasswordService;
  readonly #rateLimitKey: Buffer;

  private constructor(
    database: Pool,
    options: AuthServiceOptions,
    passwords: PasswordService,
    dummyPasswordHash: string,
  ) {
    this.#database = database;
    this.#csrfKey = options.csrfKey;
    this.#emailEncryptionKey = options.emailEncryptionKey;
    this.#rateLimitKey = options.rateLimitKey;
    this.#passwords = passwords;
    this.#dummyPasswordHash = dummyPasswordHash;
  }

  static async create(database: Pool, options: AuthServiceOptions): Promise<AuthService> {
    const passwords = new PasswordService(options.passwordConcurrency ?? 4);
    const dummyPasswordHash = await passwords.hash(
      'Local dummy credential - never an account - 2026!',
    );
    return new AuthService(database, options, passwords, dummyPasswordHash);
  }

  async enforceRateLimit(
    policy: string,
    scope: string,
    limit: number,
    bucketSeconds: number,
  ): Promise<void> {
    const scopeDigest = createHmac('sha256', this.#rateLimitKey)
      .update(`${policy}\0${scope}`, 'utf8')
      .digest();
    const result = await this.#database.query<{
      allowed: boolean;
      remaining: number;
      retry_after_seconds: number;
    }>('SELECT * FROM security_api.consume_rate_limit($1, $2, $3, $4)', [
      scopeDigest,
      policy,
      limit,
      bucketSeconds,
    ]);
    const decision = result.rows[0];
    if (!decision?.allowed) {
      throw new ApiProblemError({
        code: 'rate_limit_exceeded',
        detail: 'Too many requests. Try again later.',
        retryAfterSeconds: decision?.retry_after_seconds ?? bucketSeconds,
        retryable: true,
        status: 429,
      });
    }
  }

  async runAnonymousIdempotent(
    input: { body: unknown; key: string; operation: string; subject: string },
    operation: () => Promise<void>,
  ): Promise<void> {
    const subjectDigest = createHmac('sha256', this.#rateLimitKey)
      .update(
        `idempotency-subject\0${input.operation}\0${input.subject.trim().toLowerCase()}`,
        'utf8',
      )
      .digest();
    const keyDigest = createHmac('sha256', this.#rateLimitKey)
      .update(`idempotency-key\0${input.key}`, 'utf8')
      .digest();
    const requestHash = createHash('sha256').update(JSON.stringify(input.body), 'utf8').digest();
    const values = [subjectDigest, input.operation, keyDigest, requestHash] as const;
    const result = await this.#database.query<{ outcome: string }>(
      'SELECT security_api.begin_anonymous_idempotency($1,$2,$3,$4) AS outcome',
      [...values],
    );
    const outcome = result.rows[0]?.outcome;
    if (outcome === 'REPLAY') return;
    if (outcome === 'CONFLICT') {
      throw new ApiProblemError({
        code: 'idempotency_key_reused',
        detail: 'The idempotency key was already used for a different request.',
        status: 409,
      });
    }
    if (outcome !== 'ACQUIRED') {
      throw new ApiProblemError({
        code: 'idempotency_in_progress',
        detail: 'An equivalent operation is still in progress.',
        retryAfterSeconds: 1,
        retryable: true,
        status: 409,
      });
    }

    try {
      await operation();
      await this.#database.query(
        'SELECT security_api.complete_anonymous_idempotency($1,$2,$3,$4)',
        [...values],
      );
    } catch (error) {
      await this.#database
        .query('SELECT security_api.abandon_anonymous_idempotency($1,$2,$3,$4)', [...values])
        .catch(() => undefined);
      throw error;
    }
  }

  async register(input: {
    displayName: string;
    email: string;
    networkScope: string;
    password: string;
  }): Promise<void> {
    const email = canonicalizeEmail(input.email);
    const displayName = normalizeDisplayName(input.displayName);
    await this.enforceRateLimit('register.network', input.networkScope, 5, 3600);
    await this.enforceRateLimit('register.email', email.normalized, 3, 86400);
    const assessment = this.#passwords.assess(input.password, [email.normalized, displayName]);
    if (!assessment.accepted) {
      throw new ApiProblemError({
        code: 'validation_failed',
        detail: 'The password does not meet the length and strength requirements.',
        issues: [
          { code: 'weak_password', message: 'Choose a stronger password.', pointer: '/password' },
        ],
        status: 422,
      });
    }

    const [passwordHash, challenge] = await Promise.all([
      this.#passwords.hash(input.password),
      Promise.resolve(createOpaqueToken()),
    ]);
    const encrypted = encryptJson({ token: challenge }, this.#emailEncryptionKey);
    await this.#database.query(
      `SELECT * FROM security_api.register_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        email.normalized,
        email.display,
        displayName,
        passwordHash,
        digestToken(challenge),
        addMilliseconds(CHALLENGE_MS),
        encrypted.ciphertext,
        encrypted.initializationVector,
        encrypted.tag,
        encrypted.keyVersion,
      ],
    );
  }

  async login(input: {
    email: string;
    networkScope: string;
    password: string;
  }): Promise<{ session: AuthenticatedSession; token: string }> {
    let normalizedEmail = input.email.trim().toLowerCase();
    try {
      normalizedEmail = canonicalizeEmail(input.email).normalized;
    } catch {
      // Keep a stable, non-secret rate-limit scope and continue through the dummy hash path.
    }
    await this.enforceRateLimit('login.network', input.networkScope, 30, 900);
    await this.enforceRateLimit('login.email', normalizedEmail, 10, 900);
    const result = await this.#database.query<LoginCredentialRow>(
      'SELECT * FROM security_api.lookup_login_credential($1)',
      [normalizedEmail],
    );
    const credential = result.rows[0];
    const passwordMatches = await this.#passwords.verify(
      credential?.password_hash ?? this.#dummyPasswordHash,
      input.password,
    );
    if (
      !credential ||
      !passwordMatches ||
      credential.user_status !== 'ACTIVE' ||
      credential.email_verified_at === null
    ) {
      throw new ApiProblemError({
        code: 'invalid_credentials',
        detail: 'The email address or password is invalid.',
        status: 401,
      });
    }

    if (this.#passwords.needsRehash(credential.password_hash)) {
      const upgradedHash = await this.#passwords.hash(input.password);
      await this.#database.query('SELECT security_api.upgrade_password_hash($1,$2,$3,$4)', [
        credential.owner_id,
        credential.password_version,
        credential.password_hash,
        upgradedHash,
      ]);
    }

    const token = createOpaqueToken();
    const absoluteExpiry = addMilliseconds(SESSION_ABSOLUTE_MS);
    const idleExpiry = addMilliseconds(SESSION_IDLE_MS);
    await this.#database.query('SELECT * FROM security_api.create_session($1,$2,$3,$4)', [
      credential.owner_id,
      digestToken(token),
      absoluteExpiry,
      idleExpiry,
    ]);
    const session = await this.getSession(token, false);
    if (!session) throw new Error('The newly created session could not be resolved.');
    return { session, token };
  }

  async getSession(token: string, allowTouch = true): Promise<AuthenticatedSession | null> {
    const digest = digestToken(token);
    const result = await this.#database.query<SessionRow>(
      'SELECT * FROM security_api.resolve_session($1)',
      [digest],
    );
    const row = result.rows[0];
    if (!row) return null;

    let sessionId = row.session_id;
    let idleExpiry = row.idle_expires_at;
    let tokenReplacement: string | undefined;
    const shouldTouch =
      allowTouch && row.idle_expires_at.getTime() - Date.now() < SESSION_IDLE_MS - SESSION_TOUCH_MS;
    if (shouldTouch) {
      const nextToken = createOpaqueToken();
      const touched = await this.#database.query<TouchedSessionRow>(
        'SELECT * FROM security_api.touch_or_rotate_session($1,$2,$3,$4)',
        [
          digest,
          digestToken(nextToken),
          addMilliseconds(SESSION_IDLE_MS),
          addMilliseconds(ROTATION_GRACE_MS),
        ],
      );
      const updated = touched.rows[0];
      if (updated) {
        sessionId = updated.session_id;
        idleExpiry = updated.idle_expires_at;
        if (updated.rotated) tokenReplacement = nextToken;
      }
    }

    return {
      csrfToken: createCsrfToken(sessionId, this.#csrfKey),
      expiresAt: minimumDate(row.absolute_expires_at, idleExpiry).toISOString(),
      sessionId,
      ...(tokenReplacement ? { tokenReplacement } : {}),
      user: {
        created_at: row.user_created_at.toISOString(),
        display_name: row.display_name,
        email: row.email_display,
        email_verified: row.email_verified_at !== null,
        id: row.owner_id,
        resource_version: String(row.resource_version),
      },
    };
  }

  verifyCsrf(candidate: string, sessionId: string): boolean {
    return verifyCsrfToken(candidate, sessionId, [this.#csrfKey]);
  }

  async logout(token: string): Promise<void> {
    await this.#database.query('SELECT security_api.revoke_session($1,$2)', [
      digestToken(token),
      'USER_LOGOUT',
    ]);
  }

  async updateProfile(input: {
    csrfToken: string;
    displayName: string;
    expectedVersion: string;
    token: string;
  }): Promise<AuthenticatedSession['user']> {
    const session = await this.getSession(input.token, false);
    if (!session) {
      throw new ApiProblemError({
        code: 'authentication_required',
        detail: 'A valid session is required.',
        status: 401,
      });
    }
    if (!this.verifyCsrf(input.csrfToken, session.sessionId)) {
      throw new ApiProblemError({
        code: 'csrf_failed',
        detail: 'The CSRF token is invalid.',
        status: 403,
      });
    }

    const displayName = normalizeDisplayName(input.displayName);
    const result = await this.#database.query<UserProfileRow>(
      'SELECT * FROM security_api.update_current_user_profile($1,$2,$3)',
      [session.user.id, input.expectedVersion, displayName],
    );
    const row = result.rows[0];
    if (!row) {
      const current = await this.getSession(input.token, false);
      throw new ApiProblemError({
        code: 'resource_version_mismatch',
        detail: 'The profile changed after it was read.',
        ...(current ? { etag: `"rv-${current.user.resource_version}"` } : {}),
        status: 412,
      });
    }
    return {
      created_at: row.created_at.toISOString(),
      display_name: row.display_name,
      email: row.email_display,
      email_verified: row.email_verified_at !== null,
      id: row.owner_id,
      resource_version: String(row.resource_version),
    };
  }

  async requestChallenge(input: {
    email: string;
    networkScope: string;
    purpose: 'RESET_PASSWORD' | 'VERIFY_ACCOUNT_EMAIL';
  }): Promise<void> {
    let normalizedEmail = input.email.trim().toLowerCase();
    try {
      normalizedEmail = canonicalizeEmail(input.email).normalized;
    } catch {
      // Invalid addresses intentionally receive the same accepted response.
    }
    await this.enforceRateLimit('challenge.network', input.networkScope, 10, 3600);
    await this.enforceRateLimit(
      `challenge.email.${input.purpose.toLowerCase()}`,
      normalizedEmail,
      3,
      3600,
    );
    const challenge = createOpaqueToken();
    const encrypted = encryptJson({ token: challenge }, this.#emailEncryptionKey);
    await this.#database.query(
      'SELECT security_api.issue_account_challenge($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        normalizedEmail,
        input.purpose,
        digestToken(challenge),
        addMilliseconds(CHALLENGE_MS),
        encrypted.ciphertext,
        encrypted.initializationVector,
        encrypted.tag,
        encrypted.keyVersion,
      ],
    );
  }

  async confirmEmail(token: string, networkScope: string): Promise<void> {
    await this.enforceRateLimit('confirm.network', networkScope, 30, 3600);
    await this.enforceRateLimit('confirm.token', token, 10, 3600);
    const result = await this.#database.query<{ accepted: boolean }>(
      'SELECT security_api.confirm_email_verification($1) AS accepted',
      [digestToken(token)],
    );
    if (!result.rows[0]?.accepted) this.#invalidToken();
  }

  async confirmPasswordReset(token: string, password: string, networkScope: string): Promise<void> {
    await this.enforceRateLimit('confirm.network', networkScope, 30, 3600);
    await this.enforceRateLimit('confirm.token', token, 10, 3600);
    const assessment = this.#passwords.assess(password);
    if (!assessment.accepted) {
      throw new ApiProblemError({
        code: 'validation_failed',
        detail: 'The password does not meet the length and strength requirements.',
        issues: [
          { code: 'weak_password', message: 'Choose a stronger password.', pointer: '/password' },
        ],
        status: 422,
      });
    }
    const passwordHash = await this.#passwords.hash(password);
    const result = await this.#database.query<{ accepted: boolean }>(
      'SELECT security_api.complete_password_reset($1,$2) AS accepted',
      [digestToken(token), passwordHash],
    );
    if (!result.rows[0]?.accepted) this.#invalidToken();
  }

  #invalidToken(): never {
    throw new ApiProblemError({
      code: 'invalid_or_expired_token',
      detail: 'The link is invalid or has expired.',
      status: 422,
    });
  }
}
