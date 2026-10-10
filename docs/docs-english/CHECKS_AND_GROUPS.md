# Check and Group Management Architecture

**Stage:** 6 — Check and Group Management  
**Status:** Completed; local sign-off and GitHub Actions `38022028585` verifications passed  
**Last Updated:** 2026-10-10 08:22 +06:00  
**Related Documents:** [`REQUIREMENTS.md`](./REQUIREMENTS.md), [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md), [`DOMAIN_MODEL.md`](./DOMAIN_MODEL.md), [`STATE_MACHINES.md`](./STATE_MACHINES.md), [`DATABASE.md`](./DATABASE.md), [`API_DESIGN.md`](./API_DESIGN.md), [`API_ERRORS.md`](./API_ERRORS.md), [`EVENT_CATALOG.md`](./EVENT_CATALOG.md), [`openapi-v1.yaml`](./openapi-v1.yaml), [`AUTH_AND_OWNERSHIP.md`](./AUTH_AND_OWNERSHIP.md)

## 1. Purpose and Scope

This stage establishes the reliable management boundary for check and check group configurations prior to executing the HTTP check engine. Users can create, read, update, pause, resume, and delete checks, as well as submit manual run requests. Groups can be created, updated, and removed without deleting the checks within them.

V1 is truly multi-tenant. Each check and group belongs directly to a single `owner_id` owner; organization, workspace, role, or shared ownership models are not introduced in this stage. A check is attached to zero or one group. The resource count is not fixed at `50`: the same data model accommodates 20, 200, and 500 check profiles; operational safety quotas are configured per deployment.

The scope of this stage does not include HTTP/DNS/TLS probe details, scheduler claim/lease cycles, accepted observation processing, history rollup, maintenance UI, notification dispatch, public status, or prediction. However, the generation counters, outbox events, and state transitions of check commands that safeguard these downstream domains from disruption are finalized in this document.

## 2. Design Goals

1. Ownership relies not merely on handler filters, but on explicit owner predicates, composite foreign keys, and FORCE RLS.
2. Silent last-write-wins does not occur when two browsers or API replicas modify the same resource concurrently.
3. Retried create and manual run requests do not produce duplicate resources or duplicate jobs.
4. Check configuration, current-state transition, job invalidation, audit, and outbox are either committed together or not at all.
5. The API never executes any probe within the lifespan of an HTTP request.
6. A second parallel active job cannot be spawned for a check that is long-running or already queued.
7. URLs and expected texts are never exposed to any log, metric label, audit metadata, or outbox payload.
8. The cost of list queries is independent of the total history/run volume.
9. Upon soft-delete, the resource is immediately excluded from all private/public reads; historical lineage is preserved.
10. Failures in downstream projection consumers such as Predictor, SMTP, etc., do not block check/group mutations via external service calls.

## 3. Invariants

### 3.1 Check

- `owner_id` is derived solely from the authenticated session context; it is never accepted in request bodies.
- Checks are created as `LIVE` and cannot be restored from the terminal `DELETED` state.
- Execution state is strictly either `ACTIVE` or `PAUSED`; it is transitioned via pause/resume commands, not via PATCH.
- URLs must strictly be absolute `http` or `https` URLs; user-info/credentials are rejected.
- Interval is inclusive on both ends: `30..3600` seconds.
- The V1 external timeout contract is `100..60000` ms and may exceed the interval.
- Expected HTTP status is within the `100..599` range.
- Expected body text is either null or a non-empty exact substring of at most 2048 UTF-8 bytes; it is not a regex.
- Group may be null; if provided, it must belong to the same owner and have `deleted_at IS NULL`.
- Check names do not need to be unique under the same owner; identity is established by UUID.
- Exactly one `monitoring.check_current_states` row is created alongside every check creation.
- At most one job exists in `PENDING`, `LEASED`, or `RUNNING` status for a check.

### 3.2 Group

- Group name cannot be empty; duplicate names under the same owner are permitted.
- Description is null or at most 1000 characters.
- Deleting a group does not delete checks; all active members are set to `group_id = NULL` within the same transaction.
- New checks cannot be attached to a deleted group.
- Group health is not a writable aggregate; it is derived from active child current-state records.
- Group create operations insert an `INHERIT` group policy row within the same transaction to maintain singleton future notification settings. If no owner default policy exists, the notification resolver fails closed (acts as disabled).

### 3.3 Version Axes

- `resource_version`: Increments by 1 on every real change to the check/group configuration observed by clients.
- `probe_generation`: Increments by 1 whenever the semantic meaning of the URL, timeout, expected status, or expected body changes.
- `schedule_generation`: Increments by 1 whenever interval, pause, resume, or delete alters schedule validity.
- Name and group changes do not increment probe or schedule generation.
- Requesting a manual run does not modify check configuration; it does not increment `resource_version`.
- No-op PATCH/pause/resume returns the same representation and ETag after verifying the current `If-Match`; it produces zero audit/outbox/version churn.

## 4. Component and Code Boundaries

```text
React UI
  └─ generated OpenAPI client types
       │ cookie + CSRF + If-Match/Idempotency-Key
       ▼
Fastify check/group routes
  ├─ runtime contract validation
  ├─ session/owner/rate-limit hooks
  └─ application command/query services
       ├─ packages/domain
       │    normalization, policy, change classification
       ├─ packages/database
       │    owner transaction, repositories, cursor/idempotency
       └─ PostgreSQL
            config + current state + job + audit + outbox
```

Fastify handlers write no SQL or state transitions. Pure normalization/change classification resides in `packages/domain`; transaction and query mechanics stay in `packages/database`; orchestration remains in the `apps/api` application service layer. `packages/check-engine` does not invoke URLs in this stage; it consumes the immutable job snapshot generated here in Stage 7.

Suggested modules:

- `packages/domain/src/checks/*`: input normalization, URL policy, change-sets, and state command results
- `packages/domain/src/groups/*`: group validation and delete plans
- `packages/database/src/checks-repository.ts`: owner-scoped command/query SQL
- `packages/database/src/groups-repository.ts`: group and membership SQL
- `packages/database/src/idempotency.ts`: authenticated receipt orchestration
- `apps/api/src/check-routes.ts` and `group-routes.ts`: HTTP adapters

## 5. Cross-Review with Existing Schema and Revision 12

Existing revisions 1–11 are not modified. During implementation, revision 12 applies the following forward fixes:

1. Adds `app.check_groups.description varchar(1000) NULL`. This field exists in the OpenAPI/domain model but was missing in the existing table.
2. Adds a constraint for `app.checks.expected_body_substring` to be null or `octet_length(...) BETWEEN 1 AND 2048`. `varchar(2048)` is a character limit; alone it does not enforce the agreed UTF-8 byte boundary.
3. Adds the narrowest necessary grants/policies allowing the API to write initial current-state, manual job, audit, and outbox within the same transaction as domain mutations. Worker claim/lease/fencing or cross-owner permissions are never granted to the API.
4. Revokes physical `DELETE` API privileges on `app.checks` and `app.check_groups`; product deletions are strictly soft-delete commands.
5. Grants insertion privileges on `infra.outbox_events`, necessary `infra.outbox_dispatches`, and `audit.events` guarded by owner/correlation validations; the API cannot perform general reads or updates on these tables.
6. Following new migrations, Kysely schema types and real PostgreSQL integration fixtures are updated.

During implementation, real PostgreSQL tests verified that revision 12 granted current-state and job write permissions to the API, but did not grant the narrow permissions required for config/pause/delete incident and health-interval transitions mandated by this document. Applied revision 12 was left untouched; forward-only revision 13 granted the API role only incident closure/suspension columns, open interval rotation lock, and finalized interval insert capabilities. Worker claim, run acceptance, fencing, and probe result fields were not exposed to the API.

The defensive `varchar(4096)` column in the database is retained; the external contract accepts at most 2048 Unicode code points prior to normalization, and at most 4096 UTF-8 bytes following canonical serialization. The defensive ceiling `timeout_ms <= 300000` in the database is also preserved; the v1 API enforces the narrower `60000` ms ceiling. This separation enables safe future expansion without mandatory migrations while ensuring v1 routes reject broader values.

## 6. Input Normalization and Validation

### 6.1 Name and Description

- `name`: Unicode NFC, trimmed leading/trailing whitespace, 1–160 characters.
- `description`: Unicode NFC, trimmed leading/trailing whitespace; null if empty, otherwise at most 1000 characters.
- Names are not used as log labels and are not uniqueness keys.

### 6.2 URL Canonicalization

Canonicalization is a single, pure, unit-tested function:

1. Strips leading/trailing ASCII whitespace; rejects control characters.
2. Parses absolute URL with a WHATWG-compliant parser.
3. Lowercases scheme; strictly accepts only `http:`/`https:`.
4. Rejects request if username or password fields are populated.
5. Converts host to IDNA ASCII canonical format; rejects empty host, wildcards, and invalid ports.
6. Strips default `:80`/`:443` ports; empty path resolves to `/`.
7. Discards fragment as it carries no probe semantics. Because the canonical URL is returned in the response, this transformation is not silent.
8. Preserves significant ordering of path and query; does not sort query parameters.
9. Canonical URL must satisfy external/DB length boundaries again.

Users may embed secrets in URL queries; the service must store the URL in plaintext to probe and echo it back to the owner. In contrast, queries are never written to structured logs, audit/event payloads, metrics, problem details, or emails. V1 provides no support for custom headers, cookies, or authenticated targets.

### 6.3 Two-Tier SSRF Policy

The Configuration API makes no network or DNS calls. Resolving DNS within API requests couples latency/availability to the target and fails to resolve DNS-rebinding races.

At the API stage, explicitly local/private targets on the canonical host are rejected:

- loopback, private, link-local, multicast, unspecified, documentation, and reserved IPv4/IPv6 literals
- IPv4-mapped IPv6 and canonical equivalents of alternative numerical IPv4 notations
- `localhost`, `.localhost`, `.local`, `.internal`, `.home.arpa`, and an explicit metadata host allowlist

The actual A/AAAA resolution of the hostname and every redirect target are re-verified in the Stage 7 check engine by pinning the IP used for connection. If runtime resolution points to private/reserved space, no connection is established, producing a safe `BLOCKED_TARGET` classification. Thus, acceptance by the API does not constitute security clearance to execute against the target; execution-time checks are authoritative.

### 6.4 Expected Text

- `null` signifies that no body check will be performed.
- Empty string is rejected; content including whitespace is preserved verbatim.
- At most 2048 UTF-8 bytes accepted.
- Case-sensitive literal substring; no regex/glob or Unicode normalization is applied.
- The raw expected string never enters events, audit, or logs outside the job snapshot. Response bodies are never stored; Stage 7 produces only a boolean match and bounded diagnostic results.

## 7. Common Command Transaction Pattern

The authenticated mutation sequence is as follows:

1. Validate Request ID/correlation ID, session, exact origin, CSRF, media type, body, and rate limits.
2. Normalize body against an allowlist; unknown fields are rejected by schema.
3. Open `withOwnerTransaction(ownerId)` and execute `SET LOCAL app.current_user_id`.
4. For idempotent endpoints, lookup existing receipt using subject/operation/key/request digest and replay if present.
5. Lock resource and associated aggregates in predefined lock order.
6. If `If-Match` is present, compare against the locked row's `resource_version`.
7. Compute domain change plan; re-validate quotas and invariants within transaction.
8. Write config, state/job side effects, audit, outbox/dispatch, and idempotency receipt within the same transaction.
9. Map explicit DTO post-commit; success is never written to socket prior to commit.

There are no DNS, HTTP, SMTP, predictor, or other external service calls within the transaction. Constraint/serialization errors that do not conform to bounded retry policy propagate to the central problem mapper as stable codes; SQL internals are never exposed.

## 8. Lock Ordering and Deadlock Prevention

- Single check commands lock only the check row, followed by current-state/job rows tied to the check ID.
- Group membership changes lock existing and target group rows in UUID order first, then lock the check row and re-read all values.
- Group deletion locks the group row first, followed by live child checks in UUID order.
- Owner quota create operations acquire the owner+resource-kind transaction advisory lock first, followed by the relevant group row.
- Check lists to be locked within the same transaction are always sorted in UUID order.

Cross-owner rows are never visible due to RLS. If the target group is missing, deleted, or belongs to another owner, an identical `404 resource_not_found` is returned. This ordering mitigates deadlock risks during concurrent move/delete operations and prevents adding members to a deleted group at the last moment.

## 9. Check Creation and Reading

### 9.1 Create

`POST /api/v1/checks` requires an `Idempotency-Key`. The transaction:

1. Executes owner check quota lock/count checks.
2. Locks and validates optional group as belonging to the same owner and being live.
3. Inserts UUIDv7 check with `LIVE + ACTIVE`, all three versions at `1`, and `cadence_anchor_at = now`.
4. Schedules initial `next_run_at` at the earliest possible instant with deterministic startup jitter of at most 5 seconds.
5. Inserts `UNKNOWN + STALE`, `state_version=1` current-state row.
6. Writes redacted `check.created`, audit, and idempotency receipt.

Success returns `201`, `Location`, `ETag: "rv-1"`, and the canonical Check DTO. The API does not connect to the target during this process.

### 9.2 Single Read

`GET /api/v1/checks/{id}` returns only live configuration; current operational status resides in separate list/dashboard projections. Soft-deleted, unknown, and cross-owner IDs all return an identical `404`. Responses include `Cache-Control: no-store` and a strong config ETag.

### 9.3 List

`GET /api/v1/checks` starts from owner/live predicates; it never scans history or raw runs. Check configuration, singleton current-state, and optional group projections are joined.

- ordering: `created_at DESC, id DESC`
- default page size: 50, maximum: 100; this is not a product quota
- filters: `group_id`, `execution_state`, effective `health`, `freshness`
- cursor: HMAC-signed opaque token carrying route + normalized filter fingerprint + last `(created_at,id)` + issued/expiry timestamps
- cursor tampering, expiry, or filter change: `400 invalid_cursor`

Effective health is `UNKNOWN` if `freshness_state=STALE` or check is `PAUSED`; otherwise, it is stored health. The primary index for list queries is the existing owner/lifecycle/created index; filter query plans are recorded with `EXPLAIN (ANALYZE, BUFFERS)` using a 500-check fixture.

## 10. PATCH Change Classification

Multiple fields can change within a single PATCH; all real modifications result in a single `resource_version` increment and a single transaction. Probe and schedule generations increment by at most 1 if their respective categories are present.

| Change | Resource | Probe gen. | Schedule gen. | Job/schedule and state impact |
| :--- | ---: | ---: | ---: | :--- |
| `name` only | +1 | — | — | None |
| `group_id` | +1 | — | — | Health preserved; future maintenance/policy scope updates to new group |
| URL/timeout/expected status/body | +1 | +1 | — | Active old jobs canceled/invalidated; candidates cleared; incident `CONFIG_CHANGED`; freshness STALE, health UNKNOWN; scheduled ASAP if ACTIVE |
| `interval` only | +1 | — | +1 | Active old jobs canceled/invalidated; anchor set to change instant; `next_run_at=now+interval`; health preserved, freshness recalculated |
| Probe + interval | +1 | +1 | +1 | Probe reset dominates; scheduled ASAP for new semantics if ACTIVE |

When probe config changes, old last response fields may be retained as diagnostic history, but current effective health becomes UNKNOWN. Open health intervals close at the change instant, open incidents close with `CONFIG_CHANGED`, and pending failure candidates are cleared. On interval changes, `fresh_until = last_accepted_finished_at + new_interval + timeout + scheduler_grace` is recalculated; if in the past, it immediately becomes STALE.

If a request matches current values after normalization, it is a successful no-op. However, a stale `If-Match` yields `412` first even if the change appears to be a no-op; an outdated client cannot assume success without knowing the current state.

## 11. Pause, Resume, and Delete

### 11.1 Pause

`ACTIVE -> PAUSED`:

- resource and schedule generations increment by 1
- `next_run_at = NULL`
- active jobs transition to cancellation terminal state; running workers' old results cannot pass lifecycle/generation/fencing gates
- candidate is cleared, freshness becomes STALE
- last observed health is retained diagnostically
- open incidents do not close; observed segment closes at pause instant and incident transitions to `UNOBSERVED`
- `check.paused`, audit, and realtime/reconciliation dispatches are written in the same transaction

If already PAUSED, returns no-op `200` with the current ETag.

### 11.2 Resume

`PAUSED -> ACTIVE`:

- resource and schedule generations increment by 1
- cadence anchor is set to the resume instant
- `next_run_at` scheduled ASAP with deterministic jitter of at most 5 seconds
- freshness remains STALE/effective UNKNOWN until a new accepted observation
- open unobserved incidents are preserved; subsequent accepted FAIL observation continues the incident, while PASS resolves it via recovery

If already ACTIVE, returns no-op `200` with the current ETag.

### 11.3 Delete

Delete does not physically delete rows:

- `lifecycle_state=DELETED`, `deleted_at=now`, `next_run_at=NULL`, `manual_requested_at=NULL`
- resource and schedule generations increment by 1; probe generation unchanged
- queued/running jobs are canceled; lifecycle and schedule generations reject old results
- candidate and open interval close; open incidents close with `CHECK_DELETED`
- pending normal notification intents/deliveries enter safe cancellation/reconciliation paths
- public projection consumers evict the check on the next snapshot; private queries return 404 immediately following commit
- historical runs/incidents/audit are retained per retention policy

Deleted resources return `404` on subsequent mutations; there is no restore endpoint.

## 12. Manual Run Command

`POST /api/v1/checks/{id}/runs` requires both `If-Match` and `Idempotency-Key`. The API does not wait for probe results and returns `202 ManualRunReceipt`.

The transaction locks the check and generates a current configuration snapshot:

- LIVE+ACTIVE: `STATEFUL`
- LIVE+PAUSED: `DIAGNOSTIC`
- DELETED/cross-owner: `404`

If no active job exists for the check, a persistent `PENDING + MANUAL` job is inserted directly in `monitoring.check_jobs` with disposition `ENQUEUED`. The job snapshot includes URL, timeout, expected values, and all three version/generation values; it cannot exceed the 16 KiB limit.

If an active `PENDING/LEASED/RUNNING` job already exists, no new job is created. If `manual_requested_at` is null, it is set to the request timestamp; if populated, it remains unchanged; disposition becomes `COALESCED`. The Stage 9 forward migration stores the first pending intent's request-time `STATEFUL/DIAGNOSTIC` decision alongside `manual_requested_mode`. Schedulers/workers completing a job consume this single intent to generate at most one new manual job with the latest config snapshot. A partial unique index serves as the final concurrency barrier.

A manual request:

- does not modify scheduled cadence or check ETag
- passes through separate distributed rate limits per check and per owner
- replays the same `request_id`, disposition, mode, and requested time on idempotency key retries
- does not carry URL/expected text in `check.manual_run_requested` payloads

## 13. Group Commands

### 13.1 Create and Update

`POST /groups` verifies owner group quota, records `Idempotency-Key` receipt, and writes group + `INHERIT` notification policy + audit + `group.created` in a single transaction. Success returns `201`, Location, and ETag.

`PATCH /groups/{id}` requires `If-Match`. After normalizing name/description, if real differences exist, resource version increments by 1 and a redacted `group.changed` event is emitted. Duplicate names are permitted. No-ops return the same ETag.

### 13.2 Delete

Group deletion is atomic and soft:

1. Locks the group and live child checks in defined order.
2. Group is updated with `deleted_at=now`, `resource_version+1`.
3. Every child check receives `group_id=NULL`, `resource_version+1`, `updated_at=now`; probe/schedule generations are unchanged.
4. Minimal `check.group_changed` is written for each affected check, and `group.deleted` is written for the group.
5. Group-scoped scheduled maintenance enters cancel/reconciliation paths to avoid new effects; public group components enter re-projection paths.
6. Notification policies and historical delivery records are not physically deleted; policy resolvers treat deleted groups as invalid.

This fan-out is bounded by owner operational quotas. Per-check version increments prevent a second open browser tab from writing back to the group using an outdated ETag. Success returns `204`; the affected check count may appear as a bounded integer solely in metric/audit metadata, without writing check lists.

### 13.3 Group List/Status

Group listing uses `created_at DESC, id DESC` keyset cursors. Status is calculated across live child checks and current-state via a single bounded aggregate query:

```text
DOWN > SUSPECT > UNKNOWN > UP
```

Paused and deleted checks are excluded from priority calculation; paused counts are returned separately. If there are no active checks but paused checks exist, health is UNKNOWN; if there are no child checks, health is UNKNOWN and all internal counters are zero. Until Stage 8 processes observations, the natural state of new checks is UNKNOWN; synthetic UP is never produced.

## 14. Optimistic Concurrency and Idempotency

- Mutable single configuration responses include `ETag: "rv-N"`.
- PATCH, DELETE, pause, resume, and manual run require a valid `If-Match`.
- Missing header results in `428 precondition_required`, malformed header yields `400 invalid_precondition`, stale version yields `412 resource_version_mismatch`.
- Create check/group and manual run utilize authenticated persistent receipts.
- Receipt operation scope covers path identity and canonical request hash; same key with different request yields `409 idempotency_key_reused`.
- Successful receipts are committed within the same transaction as domain mutations, outbox, and response allowlist headers/bodies.
- `5xx` responses are never stored as success receipts; response loss post-commit is resolved from completed receipts.
- If a single PATCH creates multiple categories of change, multiple typed events may be emitted with the same final aggregate version. Consumers are idempotent by event ID and interpret version order as non-decreasing; they do not assume exactly one event per version.

Two-tab scenario: both read `rv-3`; the first tab updates and receives `rv-4`. The second tab's PATCH with `rv-3` receives `412`, the UI refetches the latest resource, and the user intentionally reapplies their change.

## 15. Ownership and Authorization Model

- All repository queries explicitly carry `owner_id` and live predicates.
- Without `SET LOCAL app.current_user_id`, FORCE RLS acts as default-deny.
- Check-group relations enforce `(owner_id, group_id)` composite foreign keys, rejecting cross-owner links.
- Owner context is never established from body/route values.
- Cross-owner read/update/delete/move/manual commands return `404`; DB constraint names are never exposed.
- The API role is not granted worker lease/claim, run acceptance, public raw snapshot, or predictor write permissions.
- Worker roles can read check config but cannot read user/session/password tables.
- While FKs could technically attach to soft-deleted parents, repository logic enforces locking live groups; application integration tests close this semantic gap.

## 16. Quotas and Rate Limits

Resource counts are not hardcoded to `50` in the product contract. Two distinct controls exist:

### Operational Quota

- `CHECKS_PER_OWNER_LIMIT` and `GROUPS_PER_OWNER_LIMIT` are validated deployment configurations; local/reference values are documented in `.env.example`.
- Values represent positive limits or explicit unlimited semantics; there is no hidden fallback of `50` in code.
- Create transactions acquire owner+resource-kind advisory locks, execute live count checks, and then insert; distinct API replicas cannot exceed quotas via race conditions.
- Modifying limits requires no migrations. Should requirements for higher tiers or owner overrides arise, a separate operator-controlled quota table will be introduced; fake billing models are excluded from v1.
- Exceeding quotas returns `409 quota_exceeded`; deleting checks reclaims slots.

### Rate Limits

- Mutations, manual run owner scope, and manual run check scope utilize existing PostgreSQL/HMAC counters.
- Rate limiting guards against bursts and abuse, independent of total resource count.
- Exceeding rate limits returns `429 rate_limit_exceeded` and `Retry-After`.
- Initial budgets are in config and tuned via 20/200/500 load tests; metric labels contain no owner or check IDs.

Quotas are not worker concurrency limits. Stage 9 separately enforces global/per-owner/per-host concurrency and fairness.

## 17. Events, Audit, and Privacy

Successful genuine mutations emit cataloged events within the same transaction. Event payloads contain strictly identifiers, version/generation, state, changed field names, and timestamps. They never carry URLs, queries, group/check names, descriptions, or expected texts.

Audit records:

- actor type/id, owner, action, resource type/id, result, correlation, and timestamp
- safe metadata for create/update/pause/resume/manual/delete and group bulk ungroup
- alphabetical `changed_fields` on update; no old/new values
- strictly bounded `affected_check_count` on group delete

Audit is not a full configuration backup and provides no automated rollback. Configuration versions prove who changed which category of fields and when; sensitive old URLs/substrings are not cloned persistently. Immutable job/run snapshots are strictly for probe lineage actually executed and are subject to private retention policies.

Outbox dispatch failures do not roll back domain commits; dispatch records persist in the same transaction and are retried by workers. If event insertion itself fails, the domain mutation also rolls back.

With Stage 9, API and workers share an activation-aware outbox writer. Events/dispatches are not generated for destinations defined in the catalog whose consumers have not yet been activated; once a destination is permanently activated, transient consumer failures leave dispatches in the same transaction for retry. This preserves atomicity invariants without generating unbounded backlogs for unimplemented consumers.

## 18. Error Contract

| Condition | HTTP / code |
| :--- | :--- |
| Body/query/header schema or domain validation | `422 validation_failed` or defined `400` for header/cursor |
| Missing/invalid session | `401 authentication_required` |
| Resource missing, deleted, or belongs to another owner | `404 resource_not_found` |
| Group missing, deleted, or cross-owner | `404 resource_not_found` |
| Quota exhausted | `409 quota_exceeded` |
| Invalid lifecycle transition | `409 invalid_state_transition` |
| Idempotency key reused with different request | `409 idempotency_key_reused` |
| Stale ETag | `412 resource_version_mismatch` |
| Missing If-Match | `428 precondition_required` |
| Rate limit | `429 rate_limit_exceeded` + `Retry-After` |

Field errors carry JSON Pointers but never expose normalized URLs, DB constraints, SQL, stacks, or target response internals. `X-Request-Id` is present on all responses.

## 19. OpenAPI Implementation Adjustments

Prior to implementation commits, canonical `openapi-v1.yaml` was synchronized with the exact design at the following points and generated artifacts were regenerated:

- Rejection of empty strings for `expected_body_substring` and route-level UTF-8 byte validation documentation
- Description fields for URL canonicalization, fragment, and user-info behavior
- Missing `404` responses for pause, resume, and manual run
- Addition of `Cache-Control: no-store` to manual run `202` response; documentation that check ETag does not change
- Quota/rate-limit problem responses on create/list mutations
- Alignment of Group `description` with revision 12 schema
- Finalization of new ETag headers on successful pause/resume responses

Following contract modifications, `pnpm contracts:generate` and `pnpm contracts:check` act as byte-level drift gates. Generated files are never edited manually.

## 20. Test Strategy

### 20.1 Unit / Domain

- Name/description limits and Unicode behavior
- Interval, timeout, status, and expected substring byte boundaries
- URL canonicalization; credentials, protocol, port, IPv4/IPv6/private/local/metadata negative cases
- PATCH change classification and generation matrix
- Pause/resume/no-op/delete state plans
- Cursor sign/verify, filter binding, expiry, and key rotation
- Audit/event redaction allowlist

### 20.2 Real PostgreSQL Integration

- Atomicity of check + current state + audit + outbox + receipt upon create
- Negative isolation matrix for read/update/delete/move/manual across two owners
- Default-deny without owner context and context cleanup post pool commit/rollback
- Stale/missing/malformed ETag behaviors
- Identical idempotency key replay and divergent payload conflict
- Quota enforcement under concurrent creates preventing race conditions across replicas/connections
- Parallel manual requests on the same check generating a single active job + at most one pending intent
- Combined PATCH incrementing resource/probe/schedule versions by at most 1 each
- Generation/lifecycle barriers rejecting old jobs and results during pause/probe/edit/delete
- Group delete atomically ungrouping all child checks and incrementing each ETag
- Concurrent move and group delete ensuring no live checks remain attached to deleted groups
- Complete transaction rollback upon audit/outbox error injection
- Exclusion of soft-deleted rows from normal queries and quota counts

### 20.3 API / Contract / E2E

- CSRF/origin/media type/session protections and problem schema conformance
- Happy paths for create/get/list/patch/pause/resume/manual/delete
- Stale ETag `412`, refetch, and intentional retry across two browser tabs
- User A probing User B IDs receiving `404` across all check/group routes
- Bounded cursor pagination across 20, 200, and 500 check fixtures; ensuring response ceilings are not mistaken for product quotas
- Absence of URLs, queries, or expected texts in captured logs, audit, and outbox
- API requests not blocking on slow/hanging target simulator endpoints

At the conclusion of Stage 6, `pnpm run ci`, real DB integration, Docker Compose smoke, and relevant Playwright flows are executed. Worker results belonging to Stages 7/8/9 are not falsely reported as existing.

## 21. Observability

Initial low-cardinality metrics:

- Command/query latency and outcome counters (`operation`, `outcome`)
- Validation/problem code counters
- Idempotency replay/conflict counters
- Quota denied and quota utilization buckets
- Manual disposition (`ENQUEUED`/`COALESCED`) and mode
- DB transaction retry/deadlock/lock-wait duration
- Separate worker metric for outbox dispatch backlog

Structured logs contain only request/correlation ID, operation, HTTP status, duration, and safe error codes. Owner, check ID, or group ID may only be used as irreversible HMAC fingerprints with limited retention if diagnostic requirements demand it; URLs, names, and substrings are never logged.

## 22. Implementation Sequence

1. OpenAPI adjustments, generated contracts, and contract tests
2. Pure domain normalization/change classification and unit tests
3. Revision 12 schema/grant/policy changes and Kysely types
4. Authenticated idempotency, ETag parser, and cursor infrastructure
5. Group create/get/list/update with quota and negative ownership tests
6. Check create/get/list/update with current-state initialization
7. Pause/resume/delete and generation/state/job invalidation
8. Manual run enqueue/coalescing and distributed rate limits
9. Atomic group delete/ungroup fan-out and concurrency tests
10. React check/group management screens; loading/empty/error/412 recovery and responsive/accessibility design
11. Two-client E2E, 20/200/500 fixtures/profiles, log-redaction tests
12. Compose smoke, full CI, decisions/development/project status, and README updates

Each vertical slice is a small and meaningful commit. Once applied, revision 12 is never altered; any discovered issue is addressed via revision 13+ forward-fixes.

Implementation status as of 2026-10-10: Steps 1–12 completed. Two-client E2E, 20/200/500 PostgreSQL cursor profiles, 500-record bounded UI fixture, log/audit/outbox redaction, Compose smoke, and full CI passed. GitHub Actions [`38022028585`](https://github.com/EgeSensozKarayaka/testproject/actions/runs/38022028585) succeeded across all Node, PostgreSQL, Python, dependency audit, and full-stack smoke jobs.

## 23. Definition of Done

Stage 6 is considered complete only when all of the following are satisfied:

- Check/group CRUD, pause/resume/delete, and manual requests run on real PostgreSQL.
- All cross-owner paths return 404 and are protected via RLS.
- ETag, idempotency, and cursor behaviors adhere to contract.
- Validation and two-tier URL security boundaries are tested.
- Group delete atomically ungroups checks without data loss.
- Concurrent manual requests do not exceed the single active job and single pending intent boundary.
- Transactional integrity across config/state/job/audit/outbox is proven via fault injection.
- Operational quota is not hardcoded to 50 and is verified with 20/200/500 profiles.
- Two-browser stale edit scenarios behave safely.
- UI displays accessible loading, empty, error, and conflict states.
- Local quality checks, Compose smoke, and GitHub CI pass; shortcomings are documented honestly.

## 24. Known Trade-offs and Next Steps

- The Configuration API has no DNS preflight; secure connection and redirect/DNS-rebinding defenses are the authoritative responsibility of Stage 7.
- Stage 6 persists manual jobs, but actual probe execution is handled by Stage 7, and claim/schedule/recovery loops by Stage 9.
- Group status reports UNKNOWN for new checks; real health/incident state machines activate in Stage 8.
- There is no user-facing audit history endpoint/UI; immutable audit records are preserved. Secure projection requirements are a separate contract decision.
- There are no per-plan or per-user commercial quota override tables. V1 deployment-level owner quotas are sufficient; no billing model is assumed.
- Bulk import/export, multi-select deletion, clone, tags, custom headers/auth, TCP/ICMP probes, and organization memberships are out of scope.
