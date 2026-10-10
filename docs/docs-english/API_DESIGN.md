# API, Command, and HTTP Contract

**Stage:** 4 — API, Event, and Error Contracts  
**Status:** Approved; contract generation and API boundary infrastructure implemented  
**Date:** 2026-10-10  
**Related contracts:** [`openapi-v1.yaml`](./openapi-v1.yaml), [`API_ERRORS.md`](./API_ERRORS.md), [`EVENT_CATALOG.md`](./EVENT_CATALOG.md), [`REALTIME_CONTRACT.md`](./REALTIME_CONTRACT.md)

## 1. Purpose and Boundary of Authority

This document fixes the network contract between browser and API, API and domain/application layer, and public client and public projection. The HTTP handler carries no business rules; it performs authentication, input validation, transaction invocation, DTO mapping, and error translation.

The TypeScript types, Fastify runtime route schemas, drift checks, centralized problem mapper, and request-ID boundary of this contract have been implemented. The auth and domain behaviors of product routes will be added in the respective Stage 5–15 slices; not all endpoints will be populated with mock behaviors in one sweep.

## 2. Core Decisions

### 2.1 Resource-Oriented REST + Explicit Command Endpoints

- Resource read/write operations use standard HTTP methods.
- State transitions such as `pause`, `resume`, `manual-run`, `publish`, `disable`, and `rotate-link` are explicit command endpoints.
- Long-running execution is not held waiting within the HTTP request. Manual run returns a persistent request receipt with `202 Accepted`.
- The API does not leak worker tables or queue implementation details into the external contract.

### 2.2 Source of Truth for the Contract

`docs/openapi-v1.yaml` is the canonical, reviewable source of truth for the external HTTP contract. During implementation:

1. TypeScript request/response types and Fastify runtime schemas are generated from the same schema under `packages/contracts/src/generated/`.
2. Runtime request and response validation is mandatory at the route level.
3. CI checks syntax/reference resolution, operationId, path parameters, auth/CSRF, idempotency, and precondition rules, as well as generated file drift via `pnpm contracts:check`. Breaking-change comparison will be added separately once the release pipeline is established.
4. If the response returned by a handler does not conform to the schema, a hard failure occurs in non-production/test environments.

OpenAPI and runtime schemas cannot be turned into two independently maintained manual truths. Pinned `openapi-typescript` generates types; a repository-owned generator generates dereferenced Fastify schemas and operation security metadata from the same document. Generated files are not edited manually.

### 2.3 Versioning

- Private base: `/api/v1`
- Public base: `/api/public/v1`
- Health endpoints are unversioned: `/health/live`, `/health/ready`
- Adding fields, adding new events, and adding optional request fields within v1 are backward compatible.
- Removing/renaming fields, altering semantics, or changing enum values in a way that clients cannot safely recognize constitutes a breaking change.
- A breaking HTTP change requires `/api/v2`. The domain event payload also carries `schema_version`.

## 3. Protocol Rules

### 3.1 Media Types, Naming, and Time

- Normal JSON: `application/json`
- Errors: `application/problem+json`
- SSE: `text/event-stream`
- JSON fields use `snake_case`.
- All timestamps are UTC-offset RFC 3339 strings; canonical output uses `Z`.
- Durations carry units in field names: `_ms`, `_seconds`.
- UUIDs are canonical lowercase strings.
- Resource/state/generation versions originating from PostgreSQL `bigint` are returned as decimal strings to prevent JavaScript precision loss.
- There is no monetary or floating duration data. Availability/coverage ratios are JSON numbers between `0..1` or `null` if no data exists.

### 3.2 Header Contract

| Header            | Direction        | Rule                                                                                                                                     |
| ----------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Request-Id`    | request/response | Only canonical UUID is accepted; if missing or invalid, the server generates a UUIDv7 and returns the same trusted ID in every response. |
| `ETag`            | response         | Strong tag derived from `resource_version` on mutable singular resources: `"rv-<decimal>"`.                                              |
| `If-Match`        | request          | Mandatory on mutable resource update/delete/commands; `428` if missing, `412` if stale.                                                  |
| `Idempotency-Key` | request          | Mandatory on selected create and command endpoints; 8–128 printable ASCII, scoped to user + operation.                                   |
| `X-CSRF-Token`    | request          | Mandatory on all unsafe methods with cookie auth.                                                                                        |
| `Retry-After`     | response         | Seconds where possible on transient `409 idempotency_in_progress`, `429`, and `503` responses.                                           |
| `Location`        | response         | Canonical URI of the resource created with `201`.                                                                                        |

Pagination cursors, raw SQL versions, internal job leases, or fencing tokens are not returned to the browser.

### 3.3 CORS, Cookies, and CSRF

- Production allowlist is exact origin matching; wildcard + credentials is forbidden.
- Session cookie is `site_monitor_session`; `HttpOnly`, host-only, `Path=/`, `SameSite=Lax`, and `Secure` in production.
- CSRF token is provided to the browser via a separate `site_monitor_csrf` signed double-submit cookie, and the same value is sent as `X-CSRF-Token` on unsafe requests. This cookie is not `HttpOnly` so that JavaScript can copy it to the header; it carries no secret/session authorization.
- In addition to CSRF verification for unsafe requests, `Origin` (or `Referer` if absent) is checked against the allowlist.
- Session cookie/token is never written to response bodies or logs.
- SSE is an authenticated GET; because it does not mutate state, it does not require a CSRF header, but it is subject to exact CORS and cookie rules.

Auth details will be finalized with the threat model in the Stage 5 document; if cookie/header names in this contract change, OpenAPI and decision records will be updated together.

## 4. Authentication and Ownership Semantics

- Authenticated endpoints require a valid session; otherwise `401`.
- If a resource ID belongs to another user, the API returns `404` to avoid leaking its existence; `403` is reserved only for authenticated operations prohibited by product policy.
- Every private application operation runs with a transaction-local owner context; DTO mappers see only the rows belonging to the relevant owner.
- Public endpoints do not serialize private entities. They only return the `public_status.snapshots` allowlist projection.
- Public tokens are high-entropy bearer links; path/log/APM redaction is mandatory. Tokens are never copied into any error `instance` or `detail` field.

## 5. Concurrency and Idempotency

### 5.1 Optimistic Concurrency

Mutable configuration resource responses carry `ETag: "rv-12"`. `PATCH`, `PUT`, `DELETE`, and state-dependent commands require the same value via `If-Match`. The continuously changing current-status projection is not embedded into the same strong ETag representation; list/dashboard items carry config `resource_version` and status `state_version` axes separately as `{ check, status }` or `{ group, status }`.

- Missing header: `428 precondition_required`
- Malformed format: `400 invalid_precondition`
- Resource version changed: `412 resource_version_mismatch`
- Valid version but domain transition forbidden: `409 invalid_state_transition`

The API returns the updated representation and a new ETag after a successful mutation; delete returns `204`.

### 5.2 Idempotent Retry

After a network timeout, the same request must be safely repeatable. The following endpoints require `Idempotency-Key`:

- account/register, email verification/password reset initiation, and verification email resend operations
- check/group/maintenance/recipient/public-page create
- manual run
- public page publish and link rotation

If the key arrives again with the same subject, HTTP operation, and normalized request hash, the previous status/body/allowlist response headers are replayed. If the same key arrives with a different payload, `409 idempotency_key_reused` is returned. If the transaction for the same key is still locked, duplicate requests wait only for a short, bounded duration; if the timeout expires, it receives `409 idempotency_in_progress` and `Retry-After`. `5xx` results are not cached as permanent success; if the transaction outcome is uncertain, it is resolved via the record.

There is no HTTP idempotency receipt table in the current Stage 3 schema. Following approval, `infra.api_idempotency_records` will be added via a new forward migration without altering historical migrations. Minimum fields:

- `id`, nullable `owner_id`, and privacy-preserving `subject_digest` across all flows
- `operation`, HMAC `key_digest`, and canonical method/path/body `request_hash`
- `response_status`, allowlist `response_headers` (`Location`, `ETag`), and bounded/sanitized `response_body`
- application-layer ciphertext and `encryption_key_version` solely for secret-bearing responses such as publish/rotation
- `created_at`, `expires_at`

`UNIQUE(subject_digest, operation, key_digest)` deduplicates races at the database level. The receipt, domain mutation/job enqueue, and outbox event are written in their completed state within the same short transaction; no external service calls are made. Thus, no separately committed `PROCESSING`/lease state is created: a crash rolls back the transaction entirely, and response loss after commit is replayed from the completed receipt.

The authenticated subject digest is derived from the owner UUID; in unauthenticated flows, it is derived from flow name + normalized email via server-side HMAC. Raw idempotency keys, emails, passwords, or request secret payloads are never stored. Normal response receipts hold only bounded and sanitized JSON. To safely replay the same one-time public URL upon publish/rotation retries, the raw token is not kept as plaintext, but in an application-layer encrypted response blob using a dedicated key; the DB does not possess this key, and ciphertext is not even written to logs/metrics. Default receipt and ciphertext retention is 24 hours; after that, the same key provides no guarantee of a new operation, and the client must read the current resource and request rotation again if needed.

## 6. Pagination, Filtering, and Sorting

- List responses follow the format `{ data: [], page: { next_cursor, has_more } }`.
- Cursors are opaque, signed/base64url tokens containing sort/filter/snapshot context. Clients do not generate or parse cursors.
- Default `limit=50`, maximum `100`; this is not a product check quota, but a single HTTP response boundary.
- Stable sorting always carries a unique tie-breaker (such as `created_at DESC, id DESC`).
- If sort/filter changes alongside a cursor: `400 invalid_cursor`.
- Page-number/offset is not used in high-volume history and incident listings.
- List filters are allowlisted; arbitrary SQL-like filter/sort is not accepted.

Cursor payload carries at least `version`, route/query fingerprint, normalized sort, last key tuple, `snapshot_at` for dashboards, `issued_at`, and `expires_at`. It carries no PII or secrets; because base64url is merely encoding, the entire payload is signed with a server-side HMAC. Verification uses constant-time signature comparison; limited key rotation is supported with active + previous signing keys. Cursors that have expired or are used with mismatched filters result in `400 invalid_cursor`.

Dashboard snapshots are paginated. The cursor is bound to the `snapshot_at` value of the first page; subsequent pages read the same logical slice. Deployment quota is not a hardcoded source code limit, but is protected by response size and rate limits.

## 7. Endpoint Catalog

### 7.1 Health

| Method and path     | Auth | Success   | Purpose                                                     |
| ------------------- | ---- | --------- | ----------------------------------------------------------- |
| `GET /health/live`  | None | `200`     | Process is alive; does not check dependencies.              |
| `GET /health/ready` | None | `200/503` | DB schema compatibility and mandatory dependency readiness. |

Health responses do not use problem details; they return a compact, static `ServiceHealth` object for orchestrators.

### 7.2 Auth and User

| Method and path                                 | Success | Notes                                                                      |
| ----------------------------------------------- | ------- | -------------------------------------------------------------------------- |
| `POST /api/v1/auth/register`                    | `202`   | Generic result without leaking email existence; idempotent.                |
| `POST /api/v1/auth/login`                       | `200`   | Establishes session cookie; errors are always generic credential problems. |
| `POST /api/v1/auth/logout`                      | `204`   | Revokes the current session; safe to repeat.                               |
| `GET /api/v1/auth/session`                      | `200`   | User/session summary and CSRF bootstrap info.                              |
| `POST /api/v1/auth/email-verifications`         | `202`   | Request new verification email; enumeration-safe.                          |
| `POST /api/v1/auth/email-verifications/confirm` | `204`   | Consume single-use token.                                                  |
| `POST /api/v1/auth/password-resets`             | `202`   | Enumeration-safe reset request.                                            |
| `POST /api/v1/auth/password-resets/confirm`     | `204`   | Token + new password; revokes all existing sessions.                       |
| `GET /api/v1/me`                                | `200`   | Private user profile.                                                      |
| `PATCH /api/v1/me`                              | `200`   | `If-Match`; allowlisted profile fields only.                               |

### 7.3 Dashboard, Check, and Group

| Method and path                            | Success | Notes                                                                                                       |
| ------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/dashboard`                    | `200`   | Current-state snapshot with cursor; group summaries and check status cards.                                 |
| `GET /api/v1/checks`                       | `200`   | Filter: group, execution, health, freshness; cursor.                                                        |
| `POST /api/v1/checks`                      | `201`   | `Idempotency-Key`; Location + ETag.                                                                         |
| `GET /api/v1/checks/{check_id}`            | `200`   | Private check configuration; live status is in dashboard/list projections.                                  |
| `PATCH /api/v1/checks/{check_id}`          | `200`   | `If-Match`; metadata/probe/schedule differences are translated into separate application commands.          |
| `DELETE /api/v1/checks/{check_id}`         | `204`   | `If-Match`; soft-delete domain flow.                                                                        |
| `POST /api/v1/checks/{check_id}/pause`     | `200`   | `If-Match`; returns updated check.                                                                          |
| `POST /api/v1/checks/{check_id}/resume`    | `200`   | `If-Match`; schedules the earliest possible run.                                                            |
| `POST /api/v1/checks/{check_id}/runs`      | `202`   | `If-Match` + `Idempotency-Key`; `ENQUEUED` or `COALESCED`, stateful/diagnostic based on ACTIVE/PAUSED mode. |
| `GET /api/v1/checks/{check_id}/runs`       | `200`   | Diagnostic run history with cursor; no body.                                                                |
| `GET /api/v1/checks/{check_id}/history`    | `200`   | `period` enum day/week/month; response-time, availability, coverage, and no-data.                           |
| `GET /api/v1/checks/{check_id}/prediction` | `200`   | Not an error if predictor is absent: `UNAVAILABLE/STALE/INSUFFICIENT_DATA`.                                 |
| `GET /api/v1/groups`                       | `200`   | Group list with cursor and derived health.                                                                  |
| `POST /api/v1/groups`                      | `201`   | `Idempotency-Key`; ETag.                                                                                    |
| `GET /api/v1/groups/{group_id}`            | `200`   | Group configuration; derived status is in dashboard/list projections.                                       |
| `PATCH /api/v1/groups/{group_id}`          | `200`   | `If-Match`.                                                                                                 |
| `DELETE /api/v1/groups/{group_id}`         | `204`   | `If-Match`; checks become ungrouped.                                                                        |

Allowlisted fields for `PATCH /api/v1/checks/{check_id}`: `name`, `url`, `group_id`, `interval_seconds`, `timeout_ms`, `expected_status_code`, `expected_body_substring`. If a field is omitted, it remains unchanged; clearing a nullable field requires an explicit `null`. `execution_state` is not modified via PATCH; pause/resume commands are used instead.

### 7.4 Incidents and History

| Method and path                       | Success | Notes                                                 |
| ------------------------------------- | ------- | ----------------------------------------------------- |
| `GET /api/v1/incidents`               | `200`   | Filter: check/group/status/time range; cursor.        |
| `GET /api/v1/incidents/{incident_id}` | `200`   | Segments and observed duration; data-gap distinction. |

Incidents are not created or closed by users in the standard flow. There is no administrative close endpoint in the initial release; if needed, that would be a new audited product decision.

### 7.5 Maintenance

| Method and path                                  | Success | Notes                                                     |
| ------------------------------------------------ | ------- | --------------------------------------------------------- |
| `GET /api/v1/maintenance-windows`                | `200`   | check/group/state/time filters; cursor.                   |
| `POST /api/v1/maintenance-windows`               | `201`   | Targets exactly check or group; idempotent.               |
| `GET /api/v1/maintenance-windows/{window_id}`    | `200`   | Half-open UTC interval.                                   |
| `PATCH /api/v1/maintenance-windows/{window_id}`  | `200`   | `If-Match`; active window edge-cases are domain commands. |
| `DELETE /api/v1/maintenance-windows/{window_id}` | `204`   | `If-Match`; cancel instead of physical delete.            |

### 7.6 Notification Settings

| Method and path                                                    | Success | Notes                                                                        |
| ------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------- |
| `GET /api/v1/notification-recipients`                              | `200`   | Private addresses only to owner; with cursor.                                |
| `POST /api/v1/notification-recipients`                             | `201`   | Creates verification email intent; idempotent.                               |
| `DELETE /api/v1/notification-recipients/{recipient_id}`            | `204`   | `If-Match`.                                                                  |
| `POST /api/v1/notification-recipients/{recipient_id}/verification` | `202`   | Verification email resend; rate-limited.                                     |
| `POST /api/v1/notification-recipient-verifications/confirm`        | `204`   | Consume token; no session required.                                          |
| `GET /api/v1/notification-policies/default`                        | `200`   | User default policy.                                                         |
| `PUT /api/v1/notification-policies/default`                        | `200`   | `If-Match`; complete replacement.                                            |
| `GET /api/v1/groups/{group_id}/notification-policy`                | `200`   | With `INHERIT/ACTIVE/DISABLED` resolution.                                   |
| `PUT /api/v1/groups/{group_id}/notification-policy`                | `200`   | `If-Match`; recipient ID list must belong to the same owner and be verified. |

The account creation transaction creates the default policy row as `DISABLED`, and the group creation transaction creates the group policy row as `INHERIT`. Thus, both `PUT` endpoints operate with a real `resource_version`/ETag rather than a synthetic "non-existent resource" version. The default policy cannot be `INHERIT`. In `ACTIVE` mode, `notify_down` and `notify_recovery` are booleans; in `INHERIT`/`DISABLED` mode, they are null and the recipient list is empty.

### 7.7 Public Page Management and Public Reading

| Method and path                                         | Success | Notes                                                                            |
| ------------------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| `GET /api/v1/public-pages`                              | `200`   | Private config list with cursor.                                                 |
| `POST /api/v1/public-pages`                             | `201`   | Creates draft; idempotent.                                                       |
| `GET /api/v1/public-pages/{page_id}`                    | `200`   | Private config + components.                                                     |
| `PATCH /api/v1/public-pages/{page_id}`                  | `200`   | `If-Match`; title/description.                                                   |
| `PUT /api/v1/public-pages/{page_id}/components`         | `200`   | `If-Match`; atomic replacement of ordered allowlist.                             |
| `POST /api/v1/public-pages/{page_id}/publish`           | `200`   | `If-Match` + idempotency; raw token returns only once in this/rotation response. |
| `POST /api/v1/public-pages/{page_id}/disable`           | `200`   | `If-Match`; snapshot/link invalidated immediately.                               |
| `POST /api/v1/public-pages/{page_id}/rotate-link`       | `200`   | `If-Match` + idempotency; old token invalidated in the same transaction.         |
| `DELETE /api/v1/public-pages/{page_id}`                 | `204`   | `If-Match`; closes public access atomically.                                     |
| `GET /api/public/v1/status-pages/{public_token}`        | `200`   | No auth; public snapshot only.                                                   |
| `GET /api/public/v1/status-pages/{public_token}/events` | SSE     | No auth; events only from the same snapshot allowlist.                           |

The public management response does not return a token digest. If the raw token is lost, it cannot be read back; rotation is required.

The component allowlist carries permissions matching the DB model one-to-one: `show_url`, `show_response_time`, and `show_incident_history`. If a permission is disabled, the public JSON field is not set to `null`, but completely omitted; this distinguishes "no value" from "no permission to publish". Maintenance-active status is part of the state semantics of the published component. Public DTOs do not contain private check/group IDs, owner IDs, or target details; they use only page-scoped public component IDs.

Because group components have no single URL or response time, `show_url` and `show_response_time` must be false. `display_name=null` means taking a public copy of the source name when the snapshot is generated; if the private name changes later, the public snapshot is regenerated. The public projection does not filter private DTOs at the last moment; it generates the allowlist schema from scratch.

### 7.8 Realtime Events

| Method and path                                         | Auth         | Contract                                                            |
| ------------------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| `GET /api/v1/events`                                    | Session      | Owner-scoped SSE; [`REALTIME_CONTRACT.md`](./REALTIME_CONTRACT.md). |
| `GET /api/public/v1/status-pages/{public_token}/events` | Public token | Page-scoped public SSE.                                             |

## 8. Core DTO Rules

### 8.1 Check Configuration

```json
{
  "id": "uuid",
  "name": "Primary website",
  "url": "https://example.com/health",
  "group_id": null,
  "execution_state": "ACTIVE",
  "interval_seconds": 30,
  "timeout_ms": 5000,
  "expected_status_code": 200,
  "expected_body_substring": null,
  "resource_version": "3",
  "created_at": "2026-10-10T00:00:00.000Z",
  "updated_at": "2026-10-10T00:05:00.000Z"
}
```

`url` and expected substring appear only in private responses. Error responses do not echo rejected values.

### 8.2 Current Status Card

Status axes are not combined into a single enum:

```json
{
  "check_id": "uuid",
  "health_state": "DOWN",
  "execution_state": "ACTIVE",
  "freshness_state": "FRESH",
  "maintenance": { "active": false, "until": null },
  "last_response_time_ms": 842,
  "last_checked_at": "2026-10-10T00:05:00.000Z",
  "current_incident": {
    "id": "uuid",
    "started_at": "2026-10-10T00:04:00.000Z",
    "confirmed_at": "2026-10-10T00:04:30.000Z",
    "observation_mode": "OBSERVED",
    "observed_duration_ms": "60000"
  },
  "state_version": "18"
}
```

`current_incident` is populated only for confirmed open incidents. `SUSPECT` is not current downtime.

### 8.3 History

`period` is determined based on PostgreSQL time within a single `REPEATABLE READ` transaction and source resolution boundaries:

| Period  | Interval         | Resolution |
| ------- | ---------------- | ---------- |
| `day`   | Last 24 hours    | minute     |
| `week`  | Last 7×24 hours  | minute     |
| `month` | Last 30×24 hours | hour       |

The response carries `from`, `to`, `generated_at`, `data_through`, source `resolution`, actual `bucket_seconds`, `availability_ratio`, `coverage_ratio`, four duration classifications, and ordered buckets. Day/week/month outputs are bounded to 288/336/360 buckets respectively. No-data buckets have `response_time_ms=null`, `classification=UNKNOWN`; they are not filled as DOWN. If the projection lags behind the configured raw-tail budget, a retryable `503 history_projection_lagging` is returned rather than performing unbounded raw table scans.

### 8.4 Prediction

Prediction responses are always kept separate from primary health:

- `status`: `AVAILABLE`, `INSUFFICIENT_DATA`, `STALE`, `UNAVAILABLE`
- `risk_level`: `LOW`, `MEDIUM`, `HIGH` or null
- `risk_score`, `computed_at`, `valid_until`, `horizon_seconds`
- `model`: name/version
- bounded, allowlist `reason_codes`

When the prediction endpoint errors, the dashboard primary status request does not fail.

## 9. Caching and Conditional Reads

- Private mutation/list responses default to `Cache-Control: no-store`.
- Private immutable/history responses may be kept in client cache for a short period, but shared cache is forbidden: `private, max-age=<bounded>`.
- Public snapshot responses carry `ETag` and page revision; may be narrowed by deployment with an upper bound of `Cache-Control: public, max-age=15, stale-while-revalidate=30`.
- Disable/rotation immediately invalidates the old token in the DB function; if a CDN is used, token revision is included in the cache key and a purge mechanism is required.
- `304 Not Modified` carries no body; auth/authorization is still applied.

## 10. Rate Limiting and Quotas

Rate limits are deployment-configurable and scoped by user/IP/operation. Sample initial budgets will be verified with load tests during implementation:

- auth login/reset: strict IP + subject digest limit
- manual run: owner- and check-based burst limit
- mutation: owner-based
- private read: session/owner-based
- public snapshot/SSE: token + IP-based, distinct from private budget

`429` returns a problem response and `Retry-After`. Quotas (such as number of `check`s) are distinct from rate limits; there is no hardcoded 50 limit in source code. Quota exhaustion returns `409 quota_exceeded` or, if fixed by product contract, a centralized problem code rather than `422`.

## 11. Transaction and Response Boundaries

Handler order:

1. Generate/validate correlation/request ID.
2. Check content type, body size, and rate limits.
3. Validate session + CSRF + input.
4. Call application command/query.
5. Single DB transaction and owner context for private commands.
6. Map domain result to explicit DTO.
7. Validate response schema and produce structured audit/log.

A success response is never written before the transaction is committed. A disconnected client connection is not automatically assumed to have rolled back the transaction; the idempotency receipt resolves the result. HTTP status never substitutes for domain truth.

## 12. Size and Timeout Boundaries

- Initial upper limit for JSON request body: 64 KiB; can be tighter per endpoint.
- UTF-8 byte limit for expected body substring is enforced in application validation.
- List responses are bounded by limit/cursor.
- Public snapshot payload is bounded and schema-versioned in the DB.
- API request deadline is chosen slightly longer than DB statement timeout; proxy deadline is chosen slightly longer than API deadline.
- Manual probe, email, and predictor calls are never executed within the API request.

Exact numeric timeout/byte limits will be recorded via threat/load testing during the relevant implementation phase; they will not be left to silent framework defaults.

## 13. Security and Data Minimization

- Mass-assignment is forbidden; every request DTO is an explicit allowlist.
- URL user-info is rejected; URL fragments are not stored in persistent config.
- Passwords, tokens, public tokens, expected substrings, and sensitive URL queries are redacted in logs.
- Response bodies, SMTP details, SQL error details, or stack traces never leak into external responses.
- Public DTOs are never produced by stripping fields from private DTOs; they use separate schemas and mappers.
- CSV/export, bulk admin, arbitrary queries, and GraphQL are not part of the initial v1 contract.

## 14. Testing and Acceptance Gates

To complete the Stage 4 contract infrastructure, the first four items are verified directly in this stage. The remaining behavioral items turn into mandatory acceptance tests as the corresponding routes are implemented across Stages 5–15; absence of routes is not counted as mock success:

- OpenAPI syntax and reference resolution must pass in CI.
- Each operationId must be unique; auth, CSRF, idempotency, and If-Match requirements must be verified in contract tests.
- Problem responses on implemented error paths must adhere to the same schema; every subsequent route must add its own error conformance tests.
- Negative tests where User A receives `404` for User B's resources must exist.
- Duplicate idempotency keys must produce the same result, and different payloads must produce a conflict.
- Stale ETag must be `412`, invalid state must be `409`, validation error must be `422`.
- History must not convert no-data into DOWN.
- Public responses/SSE must not leak non-allowlisted fields.
- Two authenticated clients must reach the same state via SSE + REST reconciliation.
- OpenAPI examples must pass conformance tests against handler responses.

## 15. Conscious Trade-offs and Open Work

- There is no organization/workspace scope; all private routes operate within the current user owner scope.
- GraphQL/WebSocket is not added; REST + SSE is sufficient.
- Generic async operation resources are not present in the initial version; manual run returns a specialized receipt.
- Public custom domains, webhooks, and API token auth are out of scope.
- The idempotency table requires a new migration; migrations are not written before approval.
- No global, lossless SSE event replay is guaranteed. The source of truth is the REST snapshot; SSE serves as an acceleration and invalidation channel.
