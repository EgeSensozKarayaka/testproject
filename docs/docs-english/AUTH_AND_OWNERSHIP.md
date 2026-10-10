# Authentication and User Isolation Architecture

**Stage:** 5 — Authentication and User Isolation  
**Status:** Implemented and verified via local quality gates  
**Date:** 2026-10-10  
**Related documents:** [`API_DESIGN.md`](./API_DESIGN.md), [`API_ERRORS.md`](./API_ERRORS.md), [`DATABASE.md`](./DATABASE.md), [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md), [`DATABASE_SECURITY.md`](./DATABASE_SECURITY.md), [`openapi-v1.yaml`](./openapi-v1.yaml)

## 1. Purpose and Scope

This document establishes the security boundaries for registration, email verification, login, session validation/rotation, logout, and password reset flows. It also defines how an authenticated request operates with the correct `owner_id`, ensuring that another user's rows remain invisible via PostgreSQL RLS even in the event of an application error.

The V1 model is genuinely multi-user but does not include organizations/workspaces. Each private aggregate belongs directly to a single user. If organization membership is to be added later, it will be a separate domain, authorization, and data migration decision; it is not surreptitiously introduced into Stage 5.

This design is implemented via `packages/auth`, API auth/account routes, the notification worker, React auth screens, and a forward-only revision 8–11 migration chain. Migration 9 provides the notifier schema `USAGE` grant discovered during clean database testing; migration 10 completes the anonymous idempotency boundary; and migration 11 completes the profile mutation and safe Argon2 rehash surface without altering past migrations.

## 2. Security Invariants

1. Bearer tokens are never held in the browser's `localStorage`, `sessionStorage`, URL path, or query string.
2. The session identifier is output from a CSPRNG with at least 256 bits of entropy; it exists on the client solely as an `HttpOnly` cookie, and only its SHA-256 digest is stored in the database.
3. The session identifier carries no user, role, or other PII; JWT is not used.
4. Passwords never appear in any log, event, audit metadata, idempotency record, or email job.
5. On login, cases where the user does not exist, password is incorrect, account is unverified, or account is disabled all externally yield the same `401 invalid_credentials` result.
6. Registration, verification email, and password reset requests all yield the same `202` response without revealing account existence.
7. Token validation, password alteration, token consumption, session revocation, and audit recording are all performed within a single database transaction for the respective command.
8. Authenticated domain queries only execute inside a transaction where the transaction-local `app.current_user_id` context has been established.
9. Application queries use an explicit owner predicate; composite foreign keys and FORCE RLS serve as second and third lines of defense.
10. The API role is not granted broad `SELECT/INSERT/UPDATE/DELETE` on auth tables; bootstrap and auth mutations go through narrow `security_api` functions.
11. Worker roles cannot read session/password data. The notification worker only receives the address snapshot and encrypted template payload required for delivery.
12. Access by another user to a user's resource yields the same `404` result as the resource not existing at all.
13. Failures in auth email, predictor, or other optional services cannot stop existing session validation or the monitoring system.
14. Raw cookies, CSRF tokens, one-time tokens, passwords, emails, and IP addresses are never logged.

## 3. Trust Boundaries and Components

```text
React browser
  ├─ HttpOnly session cookie ────────────────┐
  ├─ memory-only CSRF token                  │
  └─ exact-origin credentialed fetch         ▼
Fastify API
  ├─ auth/origin/CSRF/rate-limit hooks
  ├─ packages/auth: pure policy + crypto adapters
  └─ packages/database: transaction and repository boundary
            │
            ├─ narrow security_api.* functions
            ├─ SET LOCAL app.current_user_id
            ▼
PostgreSQL 18 / FORCE RLS
            │
            └─ durable auth email job ──► notification worker ──► SMTP/Mailpit
```

The API authenticates identity; business rules reside in `packages/auth` and the application service layer, while SQL details remain inside `packages/database`. The Fastify handler only handles contract validation, hook orchestration, cookie/response generation, and error mapping.

## 4. Account Model and States

The existing `auth.users.status` states are preserved:

| Status                 | Login | Private API | Transition                                                                           |
| ---------------------- | ----: | ----------: | ------------------------------------------------------------------------------------ |
| `PENDING_VERIFICATION` |    No |          No | Post-registration; transitions to `ACTIVE` with a valid verification token           |
| `ACTIVE`               |   Yes |         Yes | Administrative disable or deletion request                                           |
| `DISABLED`             |    No |          No | Administrative process; existing sessions become invalid during resolution           |
| `DELETION_REQUESTED`   |    No |          No | Separate data deletion/retention process; physical purge is not performed in Stage 5 |

When registration is successfully accepted, the user is not automatically logged in. First, the email is verified, and then a normal login is performed. This separation mitigates the risk of session fixation and creating private resources under unverified addresses.

V1 does not feature email change, MFA/passkeys, OAuth/OIDC, "remember me", user-facing session listing, or administrator impersonation. These are not stubbed into the current model with dummy fields; they are recorded as next steps.

## 5. Input and Normalization Rules

### 5.1 Email

- Leading/trailing ASCII whitespace is stripped; empty values are rejected.
- For V1 SMTP compatibility, the local-part is restricted to ASCII. The domain is converted to IDNA ASCII format and lowercased.
- As a product canonicalization policy, the local-part is also lowercased. This behavior is explained in the UI.
- Provider-specific equivalences like Gmail dots or `+tag` are not applied.
- The canonical address is stored as `email_normalized`, while the cleaned user-facing casing is stored as `email_display`.
- The maximum external contract length is 254 characters; the database's 320-character defensive limit can remain without narrowing.
- A unique violation never produces an external error that reveals email existence.

### 5.2 Display Name

Because the existing database does not permit an empty `display_name` field, a required `display_name` is added to `RegisterRequest`. The value is normalized to Unicode NFC, leading/trailing whitespace is trimmed, and it must be 1–120 characters. Names are not automatically derived from the email local-part.

### 5.3 Password

- After Unicode NFC normalization, a minimum of 15 and a maximum of 128 Unicode code points are accepted; byte sequences are never silently truncated.
- Spaces and all printable Unicode characters are accepted; no uppercase/digit/symbol composition rules are enforced.
- Copy/paste and password managers are not blocked.
- There is no mandatory periodic password expiration; changes occur upon compromise or user request.
- Common/easily guessable passwords are evaluated offline using pinned `@zxcvbn-ts/core`, `@zxcvbn-ts/language-common`, and `@zxcvbn-ts/language-en` dictionaries; scores 0–2 are rejected. The normalized email local-part, display name, and product name are provided as `userInputs`. Package versions and licenses are recorded in dependency commits; the server decision is authoritative.
- Password validation errors never echo the password itself back into the response or logs.

The existing OpenAPI `minLength: 12` value will be raised to 15 prior to implementation.

## 6. Password Storage and Verification

### 6.1 Algorithm

`Argon2id` and PHC-encoded hashes are used. The initial secure baseline:

| Parameter   |  Initial Value |
| ----------- | -------------: |
| Memory      |     19,456 KiB |
| Time/pass   |              2 |
| Parallelism |              1 |
| Salt        | 16 random byte |
| Hash output |        32 byte |

These values represent the minimum baseline. Benchmarking is conducted on production instance classes; the target is approximately 250–500 ms verification under normal load while remaining within the defined memory budget. Automatic runtime tuning that degrades security is not performed. Value adjustments are tracked as configuration/version updates.

Pinned `@node-rs/argon2` is selected for implementation: it provides async hash/verify and PHC format out-of-the-box, with prebuilt N-API distributions for Node 24/Windows/Linux. While Node 24 offers a built-in Argon2 API, it is not the primary choice due to its release-candidate lifecycle in our project version and the responsibility of PHC encode/verify. Licenses, platform images, and supply-chain audits are separately verified before installing dependencies.

### 6.2 Resource Consumption and Timing

- Hash/verify operations are never executed synchronously on the event loop.
- Hash concurrency per API instance is constrained via a bounded semaphore; default is 4, explicitly configured based on container memory limits.
- The queue is bounded in terms of both length and wait time. Saturation produces a safe, retryable `503 dependency_unavailable`.
- Rate limiting is applied prior to expensive hashing.
- For unknown emails, a dummy PHC hash generated at startup with identical parameters is verified. This prevents the emergence of an "unknown user" fast path.
- Comparisons use library verification or `timingSafeEqual`; standard string equality is never used.
- Outdated hash parameters are rehashed upon successful login. Under the existing design, `password_version` is incremented, and other sessions are invalidated to remain on the safe side.

Pepper is not used in V1. This is due to the operational cost of secret loss/rotation affecting all accounts; Argon2id, unique salts, narrow DB roles, encrypted disk/backups, and rate limits together provide the baseline defense. A KMS-based pepper is not introduced without a dedicated threat model and recovery plan.

## 7. Session Model

### 7.1 Token and Cookie

- The token is unpadded base64url representation of `randomBytes(32)` output; it contains no predictable information.
- A 32-byte digest of `SHA-256(token)` is stored in the database. Slow password hashing is not used for random 256-bit tokens.
- Only cookie transport is accepted; sessions are never accepted via headers, body, path, or query strings.
- The cookie name remains identical to OpenAPI: `site_monitor_session`.
- Production attributes: `HttpOnly; Secure; SameSite=Strict; Path=/`; `Domain` is omitted.
- In local HTTP development, only `Secure=false` is permitted. This exception is disallowed in production configuration and enforced via startup validation.
- Cookie `Expires` and `Max-Age` cannot exceed the database absolute expiry.
- Auth/session responses carry `Cache-Control: no-store` and `Pragma: no-cache`.

In production, serving the frontend and API behind a reverse proxy on the same origin is preferred. If separate origins are required, credentialed CORS must only use a strictly matched explicit origin allowlist; `*`, suffix/regex subdomain allowlists, and request origin reflection are forbidden.

### 7.2 Lifetimes

| Rule                      |    Default | Meaning                                                        |
| ------------------------- | ---------: | -------------------------------------------------------------- |
| Absolute session lifetime |     7 days | Non-extendable upper limit from the moment of login            |
| Idle timeout              |   24 hours | Inactivity period following `last_seen_at`/`created_at`        |
| Last-seen touch           |  5 minutes | Minimum interval preventing writes on every request            |
| Rotation period           |   24 hours | New token/session row during active usage                      |
| Rotation grace            | 30 seconds | Prevents in-flight parallel requests from receiving false 401s |

Lifetimes can be shortened via configuration; exceeding these upper bounds in production requires an explicit decision. Database time is the source of truth.

### 7.3 Rotation and Revocation

- Successful login always generates a new session; the old cookie from the request is never reused.
- Periodic rotation revokes the old row with reason `ROTATED`, links the new row via `rotated_from_session_id`, and issues a new cookie in the response.
- The old token may only validate parallel requests already in flight within the 30-second grace period; it cannot issue new cookies/tokens. It is strictly invalid after the grace window.
- Competing rotations for the same old session produce a single new session under `SELECT ... FOR UPDATE`.
- Logout revokes only the current session and clears the cookie with an expired value. If the session does not exist or is invalid, an enumeration-safe, idempotent `204` is returned.
- Password resets and actual password changes revoke all sessions in the same transaction.
- Sessions belonging to `DISABLED` or `DELETION_REQUESTED` users are rejected during `resolve_session`; background cleanup is not awaited.
- A session row is never reactivated.

Logout's required auth/`401` definition in the existing OpenAPI will be brought into alignment with the idempotent `204` behavior.

## 8. CSRF, Origin, and Browser Boundaries

### 8.1 CSRF Token

The CSRF token is a session-bound, versioned HMAC value:

```text
v1.base64url(HMAC-SHA-256(csrf_key_v1, "csrf\0" + session_id + "\0" + session_token_digest))
```

The token is delivered to browser JavaScript memory via the `SessionView.csrf_token` field in the response of login and `GET /api/v1/auth/session`; it is never persistently written to local/session storage. Unsafe authenticated requests transmit the token strictly in the `X-CSRF-Token` header. The API re-derives the expected value and performs a constant-time comparison. Rotation generates a new CSRF token.

CSRF keys are loaded from the secret store as a versioned key ring. Current and, for a limited time, previous keys can be validated concurrently; no plaintext key resides in the repository.

### 8.2 Multi-Layered Request Policy

Across all unsafe methods utilizing cookies (`POST`, `PUT`, `PATCH`, `DELETE`):

1. `Sec-Fetch-Site: cross-site` is strictly rejected.
2. `Origin`, if present, must match the configured frontend origin exactly.
3. If `Origin` is missing, only a same-origin `Referer` fallback is accepted; if both are missing, the browser API request is rejected.
4. On authenticated endpoints, a valid `X-CSRF-Token` is mandatory.
5. Endpoints accepting a body only accept `application/json`; simple form content types are rejected.
6. CORS preflight succeeds only for explicit origin, method, and header allowlists; wildcards are never used with credentials.
7. Proxy-derived origin/IP is utilized only after explicit trusted proxy CIDR/hop configuration; client `Forwarded`/`X-Forwarded-*` headers are never trusted directly.

Because login, registration, verification request/confirm, and password reset request/confirm do not yet hold a session, they cannot require a synchronizer token; nevertheless, they pass Origin/Fetch Metadata, JSON-only, and exact CORS checks to defend against login-CSRF and email abuse.

CSRF is not protection against XSS. Frontend CSP, output escaping, and dependency hygiene form a separate security layer.

## 9. Auth Flows

### 9.1 Registration

1. Request schema, origin, and rate limits are validated.
2. Email/display name are normalized; password policy and blocklist are checked.
3. The Argon2id hash is computed within bounded worker capacity. To minimize timing discrepancies, the expensive path is not skipped even for duplicate accounts.
4. A 32-byte verification token is generated; only its digest is written to the DB, while the encrypted mail payload goes to the durable delivery table.
5. The `register_account` security function creates user, credential, token, mail job, audit, and anonymous idempotency receipt within a single transaction.
6. If the email is not new, the external response is still the same `202`. A new verification token is not generated for an `ACTIVE` account. For a pending account, if cooldown/rate limits permit, the old open token is consumed and a new one is created.
7. SMTP operations are not executed within the request transaction.

### 9.2 Email Verification

- The email link carries the token in the frontend URL fragment rather than query/path parameters. The SPA captures the token into memory, immediately clears the address bar, and transmits it via a JSON body to the confirm endpoint.
- The token is 32 random bytes; its digest is stored, and it is valid for 24 hours by default.
- `confirm_email_verification` consumes the token under a row lock, writing the `PENDING_VERIFICATION → ACTIVE` transition, `email_verified_at`, resource version, and audit event within the same transaction.
- Invalid, expired, wrong-purpose, or previously consumed tokens all yield the same generic `422 invalid_or_expired_token` result.
- Confirmation does not automatically create a session.

### 9.3 Login

1. Origin/JSON/rate limit checks execute prior to expensive operations.
2. `security_api.lookup_login_credential` is invoked with the normalized email.
3. If no record exists, a dummy hash is verified; if found, the returned PHC hash is verified.
4. If the password is wrong, user is not `ACTIVE`, or credentials changed during a race, the same `401 invalid_credentials` is returned.
5. On success, `create_session(owner_id, expected_password_version, token_digest, expiry)` generates atomic session and audit records.
6. A `SessionView` containing the cookie and new CSRF token is returned. The response carries no password or hash information.

### 9.4 Session Resolution

On every private request, the auth hook:

1. Parses the single, bounded cookie value.
2. Generates the digest and invokes the narrow `resolve_session` function.
3. Obtains no result for revoked, absolute-expired, idle-expired, inactive users, or outdated password versions.
4. Attaches the immutable `{ownerId, sessionId, expiresAt}` auth context to the request.
5. Establishes the owner/correlation context in the domain repository transaction via `SET LOCAL`.
6. Invokes the bounded, race-safe security function if touch/rotation is required.

The authentication query and domain query may reside in separate transactions; the domain transaction does not re-derive owner information from the session cookie, but retrieves it from the verified immutable context. Every public repository method requires a transaction parameter; session-level `SET` on pool clients is never used.

### 9.5 Logout

If a valid session exists, CSRF/origin are validated, the current session is revoked with `USER_LOGOUT`, and an audit log is recorded. The cookie is cleared under all circumstances. Repeated/expired session logout returns `204`; other sessions remain unaffected.

### 9.6 Verification Resend and Password Reset Requests

- The endpoint uses the same `202` body/duration class for every syntactically valid request.
- Rate limiting is applied across IP scope and normalized email HMAC scope, independent of user existence.
- Verification generates a durable mail job only for pending accounts; reset generates one only for active accounts.
- When a new challenge is generated, open old tokens for the same owner/purpose are consumed in the same transaction.
- Repeated requests within the cooldown period do not generate emails, but the external response remains identical.
- Email delivery errors never expose account existence in the response.

### 9.7 Password Reset Confirmation

- Reset tokens are valid for 30 minutes by default.
- The new password undergoes standard registration policy, blocklist, and Argon2id processing.
- `complete_password_reset` locks/consumes the token, updates the credential hash, increments `password_version`, revokes all active sessions with `PASSWORD_RESET`, and records an audit log—all within a single transaction.
- If the transaction fails, the token is not considered consumed.
- Success returns `204`; invalid/expired/consumed tokens return generic `422 invalid_or_expired_token`.

## 10. Distributed Rate Limiting

Because the API can run across multiple replicas, auth abuse limits are not kept solely in process memory. Redis is not added to v1; atomic fixed-window counters in PostgreSQL are used instead. Enforcing minute and hourly/daily windows concurrently bounds window-boundary bursts.

Proposed revision 8 table `auth.rate_limit_counters`:

| Column           | Meaning                                          |
| ---------------- | ------------------------------------------------ |
| `policy_key`     | Versioned allowlist policy name                  |
| `subject_digest` | HMAC-SHA-256 digest instead of raw email/IP/user |
| `window_start`   | Window start timestamp calculated using DB time  |
| `attempt_count`  | Atomically incrementing counter                  |
| `expires_at`     | Bounded retention for housekeeper cleanup        |

The primary key is `(policy_key, subject_digest, window_start)`. The API receives no direct table privileges; `security_api.consume_rate_limit(...)` increments the counter and returns allowed/retry-after in a single statement. On storage errors, auth mutations fail-closed.

Initial values are deployment configuration:

| Flow                       | Network Scope       | Subject Scope                    |
| -------------------------- | ------------------- | -------------------------------- |
| Login                      | 30 / 15 minutes     | 10 / 15 minutes / email          |
| Register                   | 5 / hour            | 3 / 24 hours / email             |
| Verification/reset request | 10 / hour           | 3 / hour / email                 |
| Token confirm              | 30 / hour           | 10 / hour / token digest         |
| Authenticated auth/session | 120 / minute / user | Route-specific additional limits |

Network scope is the HMAC of the canonical IPv4 or IPv6 `/64` prefix after trusted proxy resolution. Raw IP/email addresses are never written to counter tables or logs. Counter retention is at most 48 hours. `429 rate_limit_exceeded` uses exact `Retry-After` headers and the standard problem-details envelope; it does not vary based on account existence.

These limits are configurable security defaults tested for capacity and abuse, not product quotas. Standard dashboard/check/history traffic is not recorded to the Stage 5 counter table on every request; product route limits are designed during their own risk and capacity phase. Distributed botnets/DDoS additionally require production edge/CDN/WAF rate limiting.

## 11. Durable Auth Emails

Incident email tables are not forcibly merged with auth challenges. Revision 8 adds the `notification.transactional_email_deliveries` table:

- `id`, `owner_id`, `challenge_id`, `kind`
- `recipient_address_snapshot`
- AES-256-GCM encrypted, schema-versioned template payload envelope
- `encryption_key_version`
- `state`, attempt/max-attempt, available/lease/fencing fields
- Provider message ID, bounded result code, sent/completed timestamps
- `UNIQUE(challenge_id, kind)` idempotency

The raw token resides only inside the short-lived encrypted payload; it never enters outbox event, audit, or log payloads. The encryption key does not reside in the repository or database; it is supplied via a versioned secret store key ring. The notification worker claims jobs via narrow claim/complete functions, decrypts them, and dispatches them to the SMTP/Mailpit adapter. The monitoring incident email queue may share the same SMTP adapter/observability, but domain tables remain segregated.

Retries utilize bounded exponential backoff with jitter. If connectivity outcome is indeterminate after provider acceptance, the terminal state `DELIVERY_UNKNOWN` is selected; duplicate emails are not generated automatically. Users may request a new challenge once rate limits permit. Undelivered jobs for expired challenges are cancelled. Encrypted payloads are purged following token expiration plus an operational grace period.

## 12. Forward-Only Database Change Plan

Upon approval, `000008_auth_and_ownership.sql` is added without altering past migrations.

### 12.1 Schema Changes

- Session rotation grace and explicit revoke reason constraints
- `auth.rate_limit_counters`
- `notification.transactional_email_deliveries`
- Required unique/check/FK/index constraints and FORCE RLS policies
- Narrow cleanup permissions for housekeeper limited to expired counters/jobs
- Expansion of Kysely types to include new columns and tables

### 12.2 Narrow Security Functions

| Function                             | Responsibility                                                       |
| ------------------------------------ | -------------------------------------------------------------------- |
| `lookup_login_credential`            | Minimal login verifier details; existing function hardened           |
| `register_account`                   | User + credential + verify token + mail job + receipt + audit        |
| `issue_account_challenge`            | Enumeration-safe verify/reset challenge rotation and mail job        |
| `confirm_email_verification`         | Token consumption + account activation + audit                       |
| `complete_password_reset`            | Token consumption + credential version + revoke all sessions + audit |
| `create_session`                     | Session creation with expected credential version + audit            |
| `record_login_denial`                | PII-free, bounded failed auth audit with allowlisted reason          |
| `resolve_session`                    | Absolute/idle/status/version/grace validations                       |
| `touch_or_rotate_session`            | Rate-limited touch and race-safe rotation                            |
| `revoke_session`                     | Idempotent revocation of current session                             |
| `update_current_user_profile`        | Narrow profile mutation with owner + expected resource version       |
| `consume_rate_limit`                 | Cross-replica atomic counter and retry-after                         |
| `read/write_anonymous_idempotency`   | Owner-null receipt with exact HMAC scope; no direct table access     |
| `claim/complete_transactional_email` | Minimal encrypted job surface for notification worker                |

Functions adhere to fixed `search_path`, schema-qualified objects, bounded inputs, minimal return types, explicit `PUBLIC EXECUTE` revocation, and grants restricted to necessary roles. A function accepting a user ID from the API does not treat this value as proof of authentication on its own; it verifies concurrency via expected credential/session version and DB row locking.

The API execute privilege on the legacy generic `consume_one_time_token` function is revoked. The legacy surface decoupling token consumption from account mutation is deprecated.

## 13. API Contract Changes

In the initial commit of the Stage 5 implementation, canonical OpenAPI receives these controlled modifications, and generated artifacts are regenerated:

1. `display_name` is added to `RegisterRequest.required`; 1–120 constraint is defined.
2. Minimum password length for register/reset is raised to 15; Unicode/code-point semantics are documented.
3. Stable problem code `invalid_or_expired_token` is added, and the `422` meaning for confirm endpoints is clarified.
4. Logout is defined as an idempotent `204` that clears the cookie even for missing/invalid sessions; CSRF remains mandatory if a valid session exists.
5. Login `Set-Cookie` security attributes and `no-store` behavior across all auth responses are documented.
6. `SessionView.csrf_token` remains a bootstrap value that may change after rotation.
7. Origin/Fetch Metadata policies for anonymous unsafe auth endpoints are added to documentation descriptions.

Because there is no active public v1 in production, these changes do not necessitate a breaking migration; nevertheless, OpenAPI diffs are reviewed and the 57-operation matrix is preserved.

## 14. Ownership and RLS Implementation Pattern

Private handler flow:

```text
auth hook resolves cookie -> AuthContext(ownerId, sessionId)
  -> application command/query
    -> withOwnerTransaction(ownerId, requestId)
      -> SET LOCAL app.current_user_id
      -> SET LOCAL app.correlation_id
      -> repository uses owner predicate
      -> PostgreSQL FORCE RLS checks the same owner
```

- An `owner_id` in request bodies/paths is not ignored; such fields do not exist in external contracts.
- Create operations retrieve the owner ID solely from the immutable auth context.
- Single read/update/delete queries use `WHERE owner_id=? AND id=?`; zero rows returned yields `404`.
- Cross-owner FK violations are mapped to `404` or generic conflict; constraint/table names are never leaked.
- Worker operations never impersonate human owner contexts; they operate under dedicated NOLOGIN roles with explicit policies and GRANTs.
- Query builders/clients are never leaked outside the pool transaction callback. Following commit, rollback, cancellation, or timeout, `SET LOCAL` is automatically cleared.
- At runtime, there are no admin/bypass endpoints or API roles capable of viewing all tenants.

## 15. Secrets and Configuration Boundary

Production startup fails fast if the following secrets/configs are missing:

- Platform CSPRNG for session/one-time token generation (requires no secret configuration)
- Versioned CSRF HMAC key ring
- Rate-limit/idempotency subject HMAC key ring
- Transactional email payload AES-256-GCM key ring
- Database login secrets and SMTP/provider credentials
- Exact frontend origin and explicit trusted proxy configuration
- Session, token, Argon2 concurrency, and rate-limit settings

`.env.example` provides only formatting and secure placeholders. Real values are never committed to Git, container image layers, CI logs, or development logs. Key versions may appear in ciphertext/digest metadata; key material never does. Key rotation operates under a current+previous read and current-only write model.

## 16. Logging, Audit, and Metrics

### 16.1 Audit Action Allowlist

- `auth.registration.accepted`
- `auth.login.succeeded`, `auth.login.denied`, `auth.login.rate_limited`
- `auth.session.rotated`, `auth.session.revoked`
- `auth.email_verification.requested`, `auth.email_verification.completed`
- `auth.password_reset.requested`, `auth.password_reset.completed`
- `auth.account.status_changed`
- `auth.ownership.denied`

Audit metadata never carries raw email, IP, token, cookie, CSRF, password, or hash data. When necessary, it includes only versioned HMAC subjects, reason categories, and policy keys. Unknown account attempts record `owner_id=null`. Audit writes occur in the same transaction as the auth state mutation; high-volume edge/DDoS logs are not forwarded to audit tables without bounds.

### 16.2 Metrics

- Auth result, endpoint, and reason category counters; email, user, or IP addresses are never used as labels.
- Argon2 queue depth, wait/hash latency, and saturation.
- Session resolve/rotation/revoke counts and latencies.
- Rate-limit deny and storage error counts.
- Transactional email pending/retry/dead/unknown counts and ages.
- RLS/ownership denial and auth security function error counts.

Unexpected secret-like header/body values are prevented from being logged via test suites and redaction allowlists.

## 17. Error and Dependency Behavior

| Condition                                | External Result                         | Internal Behavior                                      |
| ---------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| Cookie missing/malformed/expired/revoked | `401 authentication_required`           | Cookie may be cleared; details are not leaked          |
| Login account missing/incorrect/inactive | `401 invalid_credentials`               | Dummy/real hash path and generic audit                 |
| Origin/CSRF validation failure           | `403 csrf_failed`                       | Safe reason metric; token is not logged                |
| Token invalid/expired/consumed           | `422 invalid_or_expired_token`          | Purpose/owner existence is not revealed                |
| Rate limit exceeded                      | `429 rate_limit_exceeded`               | `Retry-After`; identical scope semantics               |
| Hash capacity saturated                  | `503 dependency_unavailable`            | Retryable; no new session/state is written             |
| PostgreSQL auth transaction error        | `503` or safe `500`                     | Atomic rollback; no cookie is issued                   |
| SMTP/Mailpit transient error             | Request may already have returned `202` | Durable job retry; auth transaction is not rolled back |

Error responses on auth endpoints strictly adhere to `application/problem+json`, request ID tracking, and safe instance conventions.

## 18. Mandatory Test and Evidence Matrix

### 18.1 Unit/Contract

- Email/display-name/password normalization and boundary tests
- Unicode NFC, code-point length, absence of silent truncation
- Argon2 PHC hash/verify, incorrect password, dummy hash, and rehash decision
- Token entropy/format/digest; deterministic CSRF derivation and constant-time verification
- Cookie attributes and `no-store` contract compliance
- OpenAPI auth/CSRF/idempotency and generated artifact drift
- Problem code/title/status alignments

### 18.2 PostgreSQL Integration

- Registration transaction and enumeration-safe result for duplicate emails
- Verification/reset token single-use, expiry, wrong-purpose, and two parallel consumption races
- Preservation of open token state on password reset transaction rollback
- Password reset revoking all sessions
- Expected password version race post-login
- Session absolute/idle expiry, touch, rotation, and 30-second grace window
- Parallel rotation of the same session yielding a single successor
- Rate counters not exceeding limits across simulated multiple connections/API instances
- Auth email job unique/lease/fencing and cancellation of expired challenges
- Anonymous idempotency receipts accessible only via exact HMAC scope
- Rejection of security-definer search-path/overload attacks

### 18.3 Ownership Isolation

- User A sees zero rows in every private parent table belonging to User B.
- Even if B's ID is known, read/update/delete returns `404`; constraint details do not leak into responses.
- User A cannot associate User B's resources into their own parent/child relationships.
- Spoofed owner IDs cannot be passed in bodies, and creation operations derive ownership solely from auth context.
- Private queries without context default-deny.
- Pooled connection context does not leak across commits, rollbacks, cancellations, or statement timeouts.
- Negative tests verify boundary restrictions for API, monitor, notifier, predictor, and public roles on auth tables and security functions.

### 18.4 HTTP/E2E

- Happy path: Register → Mailpit link → verify → login → session → logout
- Reset request → Mailpit link → reset → previous sessions invalidated with 401
- Unknown/existing email request body and status code parity
- Incorrect password / unknown / pending / disabled login body and status parity, verifying dummy hash execution
- Cookie attributes: `HttpOnly`, production `Secure`, `SameSite=Strict`, Path, and absence of Domain
- CSRF missing/invalid, cross-site Origin, `Sec-Fetch-Site`, form content types, and CORS negative tests
- Multi-user isolation across two browser contexts
- Two tabs/sessions for the same user; logout in one does not disrupt the independent session in the other
- Monitoring/API health and existing session validation functioning while notification worker is offline
- Absence of passwords, cookies, CSRF tokens, and one-time tokens in captured logs

Timing parity is not demonstrated through flaky millisecond thresholds; it is proven via instrumentation tests confirming that unknown and wrong-password paths invoke the exact same hash adapter routines.

## 19. Implementation Order

1. OpenAPI auth adjustments and contract tests
2. `packages/auth` policy/crypto boundary and unit tests
3. Revision 8 schema, security functions, Kysely types, and DB integration tests
4. PostgreSQL-backed rate limiter
5. Fastify cookie, auth context, origin, and CSRF hooks
6. Registration/verification flows and durable auth email delivery
7. Login / session rotation / logout
8. Password reset and global session revocation
9. Completion of the cross-owner/RLS negative test matrix
10. React auth bootstrap/form flows and two-client E2E verification
11. Compose/Mailpit smoke testing, full quality gates, documentation, and CI

Each step constitutes small commits. Migrations do not alter preceding files; vertical slices are preferred so that the frontend never presents mock success before routes are complete.

## 20. Completion Criteria

Stage 5 is complete only when all of the following criteria are met:

- Registration, verification, login, session, logout, and reset flows function against real PostgreSQL.
- Password and session security policies are enforced; secrets are not logged.
- Origin/CSRF/CORS/cookie negative tests pass.
- Rate limiting behaves consistently across two replicas/connections.
- All auth mutations are atomic and comply with idempotency boundaries.
- Cross-user access and pool context leakage tests pass.
- Notification worker failure does not crash primary API/monitoring functionality.
- Two-browser-client scenario passes.
- Docker Compose clean installation, migrations, Mailpit flow, local CI, and GitHub CI are proven.
- README, decision/development logs, and project status documents are updated with real results.

## 21. Known Trade-Offs and Deferred Items

- Organization/membership/role models are out of scope for V1.
- MFA/passkeys and OAuth/OIDC are not implemented; password + verified email represents the single-factor model.
- Account recovery relies strictly on access to verified email.
- User session listings and "log out of other devices" UI are not implemented; reset revokes all sessions globally.
- Pepper, provider-level breached-password checking, and KMS field encryption require dedicated threat models.
- PostgreSQL rate limiting is a sufficient, replica-safe starting point for auth traffic; high-volume edge traffic may warrant Redis/WAF as a separate capacity decision.
- Local `Secure=false` cookie configuration is strictly a development exception; production cannot start without HTTPS.

## 22. Verified References

- [NIST SP 800-63B — Password Authenticator Requirements](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Node.js 24 Crypto — Argon2](https://nodejs.org/download/release/v24.16.0/docs/api/crypto.html#cryptoargon2algorithm-parameters-callback)
- [`@node-rs/argon2` repository](https://github.com/napi-rs/node-rs)
- [`zxcvbn-ts` repository and dictionaries](https://github.com/zxcvbn-ts/zxcvbn)
- [`@fastify/rate-limit` custom/external store behavior](https://github.com/fastify/fastify-rate-limit)

References serve as design inputs; the project makes no claims of certified compliance to any external standard.
