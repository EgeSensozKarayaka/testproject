# Database Schema and Column Dictionary

**Status:** Implemented and verified via migration integration tests  
**Related document:** [`DATABASE.md`](./DATABASE.md)

This dictionary serves as the normative data model for the initial migrations. Minor column naming implementation details may evolve during coding; however, ownership, data integrity, lifecycle state, and temporal semantics may only be modified through a formal architectural decision record.

## 1. Common Rules

### 1.1 Types and Defaults

| Concept    | PostgreSQL Equivalent | Rule / Meaning                                                        |
| ---------- | --------------------- | --------------------------------------------------------------------- |
| Identifier | `uuid`                | `DEFAULT uuidv7()` for aggregates/events                              |
| Owner      | `owner_id uuid`       | Normally `NOT NULL` on private rows; references `auth.users(id)` root |
| Timestamp  | `timestamptz`         | UTC; business rule instants are explicitly named                      |
| Duration   | `integer` or `bigint` | Milliseconds; cannot be negative                                      |
| Version    | `bigint`              | `>= 1`; atomically incremented                                        |
| State      | `text`                | Closed set enforced by a named `CHECK` constraint                     |
| Digest     | `bytea`               | Raw secrets/tokens are never stored                                   |
| JSON       | `jsonb`               | Schema-versioned, bounded, canonical object                           |

`updated_at` is never implicitly modified via hidden triggers; repositories explicitly update it on every mutation. Optimistic locking updates follow the pattern `WHERE id = ? AND resource_version = ?`, returning the new version in the same statement.

### 1.2 Common Constraint Principles

- Tenant parent entities carry `UNIQUE (owner_id, id)`.
- Tenant child entities carry both `owner_id` and the parent ID, utilizing composite foreign keys.
- If a child row denormalizes multiple IDs from the same parent lineage, it does not rely solely on separate owner foreign keys; it enforces a full lineage key. For example, a job carries `UNIQUE (owner_id, check_id, id)`, an attempt carries `(owner_id, check_id, job_id)` FK, and a run carries `(owner_id, check_id, job_id, attempt_id)` FK.
- Foreign keys are explicitly named; delete actions are chosen deliberately and never left to database defaults.
- High-volume and historical tables do not use broad cascades (`ON DELETE CASCADE`). Purges are executed via dedicated background service operations.
- In-row validation rules such as `created_at <= updated_at`, `start < end`, counter/duration `>= 0` are guarded by named `CHECK` constraints.
- URL protocol compliance, email normalization, and JSON semantics are verified via integration tests in addition to application-level validation; complex regular expression constraints are avoided.
- Columns containing PII or secrets are never copied into logging or audit payloads.

## 2. `infra` Schema

### 2.1 `infra.schema_migrations`

Immutable ledger of database migration history.

| Column            | Type          | Rule / Meaning                                                       |
| ----------------- | ------------- | -------------------------------------------------------------------- |
| `version`         | `bigint`      | PK; monotonic migration sequence number                              |
| `name`            | `text`        | Human-readable migration file name                                   |
| `checksum_sha256` | `bytea`       | SHA-256 digest of applied file; drift causes validation failure      |
| `transactional`   | `boolean`     | Indicates whether migration ran within a transaction                 |
| `applied_at`      | `timestamptz` | Database timestamp of application                                    |
| `execution_ms`    | `bigint`      | Operational execution duration for audit proof                       |
| `app_build`       | `text`        | Application build/commit identifier applying migration, if available |

This table is written exclusively by the migration runner; the application runtime only reads it for readiness probes.

### 2.2 `infra.schema_compatibility`

Single-row (`singleton_id=true`) contract defining application and schema compatibility.

| Column                | Type          | Rule / Meaning                                    |
| --------------------- | ------------- | ------------------------------------------------- |
| `singleton_id`        | `boolean`     | PK; constrained strictly to `true`                |
| `current_revision`    | `bigint`      | Latest completed migration revision               |
| `compatibility_epoch` | `bigint`      | Incremented upon breaking schema contract changes |
| `minimum_app_epoch`   | `bigint`      | Oldest application contract epoch supported       |
| `updated_at`          | `timestamptz` | Last modification timestamp                       |

### 2.3 `infra.outbox_events`

Append-only event envelope written atomically within domain transactions.

| Column              | Type          | Rule / Meaning                                     |
| ------------------- | ------------- | -------------------------------------------------- |
| `id`                | `uuid`        | PK; UUIDv7                                         |
| `owner_id`          | `uuid NULL`   | Required for tenant events; NULL for system events |
| `event_type`        | `text`        | Unversioned semantic event name                    |
| `schema_version`    | `smallint`    | `>= 1`                                             |
| `aggregate_type`    | `text`        | Aggregate classification                           |
| `aggregate_id`      | `uuid`        | Aggregate identifier                               |
| `aggregate_version` | `bigint NULL` | Version of the associated resource/state           |
| `correlation_id`    | `uuid`        | Request / job trace lineage                        |
| `causation_id`      | `uuid NULL`   | Preceding command or triggering event              |
| `occurred_at`       | `timestamptz` | Domain event occurrence timestamp                  |
| `payload`           | `jsonb`       | Redacted, schema-validated, maximum 32 KiB         |
| `created_at`        | `timestamptz` | Database insertion timestamp                       |

Payloads are never updated. Event schemas corresponding to event type + version reside within the contract package.

### 2.4 `infra.outbox_dispatches`

Durable delivery tracking of an outbox event to a specific target consumer.

| Column             | Type               | Rule / Meaning                                             |
| ------------------ | ------------------ | ---------------------------------------------------------- |
| `event_id`         | `uuid`             | `outbox_events` FK                                         |
| `destination`      | `text`             | `REALTIME`, `NOTIFICATION`, `PREDICTION`, `AUDIT`          |
| `state`            | `text`             | `PENDING`, `PROCESSING`, `RETRY_WAIT`, `COMPLETED`, `DEAD` |
| `available_at`     | `timestamptz`      | Earliest eligible claim timestamp                          |
| `attempt_count`    | `integer`          | `>= 0`                                                     |
| `lease_owner`      | `text NULL`        | Worker instance identifier                                 |
| `lease_expires_at` | `timestamptz NULL` | Time-bounded lease ownership deadline                      |
| `fencing_token`    | `bigint`           | Incremented monotonically on each claim                    |
| `last_error_code`  | `text NULL`        | Bounded, sanitized error classification                    |
| `completed_at`     | `timestamptz NULL` | Terminal completion timestamp                              |

PK is `(event_id, destination)`; lease fields are populated only in active states. If a client misses a realtime dispatch after completion, it resynchronizes by fetching current state.

### 2.5 `infra.api_idempotency_records`

Bounded receipt of retryable HTTP create/command operations. Never stores raw idempotency keys, emails, passwords, or authentication tokens.

| Column                   | Type          | Rule / Meaning                                                        |
| ------------------------ | ------------- | --------------------------------------------------------------------- |
| `id`                     | `uuid`        | PK; UUIDv7                                                            |
| `owner_id`               | `uuid NULL`   | Authenticated owner; NULL for anonymous flows                         |
| `subject_digest`         | `bytea`       | 32-byte server-HMAC subject scope                                     |
| `operation`              | `text`        | Stable operation scope                                                |
| `key_digest`             | `bytea`       | 32-byte server-HMAC idempotency key digest                            |
| `request_hash`           | `bytea`       | 32-byte canonical method/path/body hash                               |
| `response_status`        | `smallint`    | Constrained to `200..499`; `5xx` errors are never cached as successes |
| `response_headers`       | `jsonb`       | Maximum 2 KiB; restricted to `Location` and `ETag`                    |
| `response_body`          | `jsonb NULL`  | Secret-free object response; maximum 64 KiB                           |
| `encrypted_response`     | `bytea NULL`  | Ciphertext for secret-bearing replays such as one-time links          |
| `encryption_key_version` | `text NULL`   | Key version mandatory alongside ciphertext                            |
| `created_at`             | `timestamptz` | Transaction commit timestamp                                          |
| `expires_at`             | `timestamptz` | After `created_at`, maximum 7 days; default policy 24 hours           |

`UNIQUE (subject_digest, operation, key_digest)` deduplicates race conditions at the database level. Authenticated records are visible strictly to the current owner via `FORCE RLS`. Anonymous rows are hidden from direct API RLS access; in Stage 5, access is restricted to a narrow `security_api` function that requires the full HMAC scope.

## 3. `auth` Schema

### 3.1 `auth.users`

| Column                     | Type               | Rule / Meaning                                                     |
| -------------------------- | ------------------ | ------------------------------------------------------------------ |
| `id`                       | `uuid`             | PK and owner root                                                  |
| `email_normalized`         | `varchar(320)`     | Unique; result of trim and lowercase normalization                 |
| `email_display`            | `varchar(320)`     | User-facing display address                                        |
| `display_name`             | `varchar(120)`     | Cannot be empty                                                    |
| `status`                   | `text`             | `PENDING_VERIFICATION`, `ACTIVE`, `DISABLED`, `DELETION_REQUESTED` |
| `email_verified_at`        | `timestamptz NULL` | Proof of email verification                                        |
| `resource_version`         | `bigint`           | Optimistic concurrency control                                     |
| `deletion_requested_at`    | `timestamptz NULL` | Consistent with deletion status                                    |
| `created_at`, `updated_at` | `timestamptz`      | Audit timestamps                                                   |

A `CHECK` constraint validates consistency between `status` and verification/deletion timestamps. Email is globally unique; account enumeration is mitigated by unified API error responses.

### 3.2 `auth.password_credentials`

| Column             | Type          | Rule / Meaning                                         |
| ------------------ | ------------- | ------------------------------------------------------ |
| `owner_id`         | `uuid`        | PK and user FK                                         |
| `password_hash`    | `text`        | Argon2id encoded hash; plaintext is never stored       |
| `password_version` | `integer`     | Incremented upon password or hashing parameter updates |
| `changed_at`       | `timestamptz` | Used to evaluate session invalidation                  |

`ON DELETE RESTRICT`; user purge workflows explicitly purge credentials first.

### 3.3 `auth.sessions`

| Column                     | Type               | Rule / Meaning                                |
| -------------------------- | ------------------ | --------------------------------------------- |
| `id`                       | `uuid`             | PK                                            |
| `owner_id`                 | `uuid`             | User composite FK                             |
| `token_digest`             | `bytea`            | Globally unique; raw cookies are never stored |
| `issued_password_version`  | `integer`          | Credential version snapshot at issuance       |
| `created_at`, `expires_at` | `timestamptz`      | `expires_at > created_at`                     |
| `last_seen_at`             | `timestamptz NULL` | Rate-limited activity touch                   |
| `revoked_at`               | `timestamptz NULL` | Non-null indicates revoked session            |
| `revoke_reason`            | `text NULL`        | Bounded categorization                        |
| `rotated_from_session_id`  | `uuid NULL`        | Secure rotation chain tracking                |

Token lookup is performed exclusively through a narrow security-definer function. Session metadata is not required for v1; storing user-agent/IP requires an explicit privacy decision.

### 3.4 `auth.one_time_tokens`

| Column                     | Type               | Rule / Meaning                           |
| -------------------------- | ------------------ | ---------------------------------------- |
| `id`                       | `uuid`             | PK                                       |
| `owner_id`                 | `uuid`             | User composite FK                        |
| `purpose`                  | `text`             | `VERIFY_ACCOUNT_EMAIL`, `RESET_PASSWORD` |
| `token_digest`             | `bytea`            | Globally unique                          |
| `created_at`, `expires_at` | `timestamptz`      | Validity period                          |
| `consumed_at`              | `timestamptz NULL` | Single-use consumption guard             |

When multiple active tokens are issued for the same user and purpose, previous tokens are consumed/revoked within the same transaction.

## 4. `app` Schema

### 4.1 `app.check_groups`

| Column                     | Type               | Rule / Meaning                           |
| -------------------------- | ------------------ | ---------------------------------------- |
| `id`                       | `uuid`             | PK                                       |
| `owner_id`                 | `uuid`             | User composite FK                        |
| `name`                     | `varchar(160)`     | May have duplicates under the same owner |
| `resource_version`         | `bigint`           | Optimistic concurrency control           |
| `created_at`, `updated_at` | `timestamptz`      | Audit timestamps                         |
| `deleted_at`               | `timestamptz NULL` | Soft delete timestamp                    |

`UNIQUE (owner_id, id)` serves as the composite ownership foreign key target. Group deletion transactions set `group_id = NULL` on live checks.

### 4.2 `app.checks`

| Column                     | Type                 | Rule / Meaning                                     |
| -------------------------- | -------------------- | -------------------------------------------------- |
| `id`                       | `uuid`               | PK                                                 |
| `owner_id`                 | `uuid`               | User composite FK                                  |
| `group_id`                 | `uuid NULL`          | `(owner_id, group_id)` → group FK                  |
| `name`                     | `varchar(160)`       | Cannot be empty                                    |
| `url`                      | `varchar(4096)`      | Normalized HTTP/HTTPS URL                          |
| `interval_seconds`         | `smallint`           | `30..3600`                                         |
| `timeout_ms`               | `integer`            | `1..300000`; deployment limits may be lower        |
| `expected_status_code`     | `smallint`           | `100..599`                                         |
| `expected_body_substring`  | `varchar(2048) NULL` | The response body itself is never stored           |
| `lifecycle_state`          | `text`               | `LIVE`, `DELETED`                                  |
| `execution_state`          | `text`               | `ACTIVE`, `PAUSED`                                 |
| `resource_version`         | `bigint`             | Incremented on every visible configuration edit    |
| `probe_generation`         | `bigint`             | Incremented on edits that alter probe semantics    |
| `schedule_generation`      | `bigint`             | Incremented on cadence, pause, or resume changes   |
| `cadence_anchor_at`        | `timestamptz`        | Drift-free cadence root anchor                     |
| `next_run_at`              | `timestamptz NULL`   | Populated only for LIVE + ACTIVE checks            |
| `manual_requested_at`      | `timestamptz NULL`   | Coalesced single manual execution intent           |
| `next_fencing_token`       | `bigint`             | Atomically allocated and incremented during claims |
| `created_at`, `updated_at` | `timestamptz`        | Audit timestamps                                   |
| `deleted_at`               | `timestamptz NULL`   | Consistent with lifecycle state                    |

`UNIQUE (owner_id, id)` is enforced. Probe semantics changes include URL, timeout, and expected status code/body substring modifications. Changing name or group does not increment `probe_generation`. Changing the interval for an ACTIVE check increments `schedule_generation` and recalculates `fresh_until`.

### 4.3 `app.maintenance_windows`

| Column                     | Type                 | Rule / Meaning                                          |
| -------------------------- | -------------------- | ------------------------------------------------------- |
| `id`                       | `uuid`               | PK                                                      |
| `owner_id`                 | `uuid`               | User composite FK                                       |
| `check_id`                 | `uuid NULL`          | Target check                                            |
| `group_id`                 | `uuid NULL`          | Target group                                            |
| `note`                     | `varchar(1000) NULL` | Optional user note; omitted from events and logs        |
| `starts_at`, `ends_at`     | `timestamptz`        | Half-open `[starts_at, ends_at)`, `starts_at < ends_at` |
| `state`                    | `text`               | `SCHEDULED`, `CANCELLED`                                |
| `cancelled_at`             | `timestamptz NULL`   | Consistent with state                                   |
| `resource_version`         | `bigint`             | Optimistic concurrency control                          |
| `created_at`, `updated_at` | `timestamptz`        | Audit timestamps                                        |

Enforces `num_nonnulls(check_id, group_id) = 1`. Both potential targets are guarded by composite owner foreign keys. `ACTIVE` and `ENDED` states are not stored in the database; they are derived from database time and the window range. Overlapping maintenance windows are permitted; effective maintenance evaluates as a union over intervals.

The `app.effective_maintenance_until(owner_id, check_id, evaluated_at)` security-invoker function returns the maximum `ends_at` among active windows targeting the check directly or via its current group. The API, monitor workers, and notifier share this identical half-open interval evaluation. The owner listing query is backed by an `(owner_id, starts_at DESC, id DESC)` index.

## 5. `monitoring` Schema

### 5.1 `monitoring.check_current_states`

Single high-performance dashboard projection per check.

| Column                               | Type               | Rule / Meaning                                            |
| ------------------------------------ | ------------------ | --------------------------------------------------------- |
| `check_id`                           | `uuid`             | PK                                                        |
| `owner_id`                           | `uuid`             | Check composite FK                                        |
| `health_state`                       | `text`             | `UNKNOWN`, `UP`, `SUSPECT`, `DOWN`                        |
| `freshness_state`                    | `text`             | `FRESH`, `STALE`                                          |
| `consecutive_failure_count`          | `integer`          | `>= 0`                                                    |
| `candidate_started_at`               | `timestamptz NULL` | Timestamp of the first sub-threshold FAIL                 |
| `candidate_run_id`                   | `uuid NULL`        | ID component of the candidate run locator                 |
| `candidate_run_finished_at`          | `timestamptz NULL` | Partition key component of the candidate run locator      |
| `open_incident_id`                   | `uuid NULL`        | Incident FK under the same owner and check                |
| `last_accepted_run_id`               | `uuid NULL`        | ID of the latest accepted run                             |
| `last_accepted_run_finished_at`      | `timestamptz NULL` | Composite run FK partition component                      |
| `last_accepted_fencing_token`        | `bigint`           | Monotonic token used to reject stale attempts             |
| `last_success_at`, `last_failure_at` | `timestamptz NULL` | Timestamps of accepted observations                       |
| `last_response_time_ms`              | `integer NULL`     | `>= 0`                                                    |
| `last_status_code`                   | `smallint NULL`    | HTTP response status code, if available                   |
| `last_failure_category`              | `text NULL`        | Failure taxonomy category                                 |
| `fresh_until`                        | `timestamptz NULL` | Timestamp after which the check is effectively STALE      |
| `stale_reconciled_at`                | `timestamptz NULL` | Checkpoint for interval/incident freshness reconciliation |
| `state_version`                      | `bigint`           | Incremented on every visible projection update            |
| `updated_at`                         | `timestamptz`      | Last projection write timestamp                           |

The two columns of the candidate run pair must be jointly null or non-null; the same rule applies to the last accepted run pair. Foreign keys enforce `(owner_id, check_id, run_finished_at, run_id)` 4-tuple lineage referencing the partitioned runs table. `freshness_state` is a persisted projection; however, read models evaluate `fresh_until <= now()` as effectively STALE even if the background reconciler is delayed.

### 5.2 `monitoring.check_jobs`

| Column                             | Type               | Rule / Meaning                                                   |
| ---------------------------------- | ------------------ | ---------------------------------------------------------------- |
| `id`                               | `uuid`             | PK                                                               |
| `owner_id`, `check_id`             | `uuid`             | Composite check FK                                               |
| `trigger_kind`                     | `text`             | `SCHEDULED`, `MANUAL`                                            |
| `manual_mode`                      | `text NULL`        | `STATEFUL`, `DIAGNOSTIC`; valid only for manual runs             |
| `scheduled_for`                    | `timestamptz`      | Cadence or manual request timestamp                              |
| `available_at`                     | `timestamptz`      | Eligible claim timestamp, accounting for retries/backoff         |
| `priority`                         | `smallint`         | Fairness weighting between manual and scheduled jobs             |
| `state`                            | `text`             | `PENDING`, `LEASED`, `RUNNING`, `COMPLETED`, `CANCELLED`, `DEAD` |
| `config_snapshot`                  | `jsonb`            | URL/probe configuration; max 16 KiB; contains zero secrets       |
| `resource_version`                 | `bigint`           | Enqueue configuration snapshot                                   |
| `probe_generation`                 | `bigint`           | Acceptance generation snapshot                                   |
| `schedule_generation`              | `bigint`           | Acceptance generation snapshot                                   |
| `attempt_count`, `max_attempts`    | `smallint`         | `0 <= attempt_count <= max_attempts`                             |
| `lease_owner`                      | `text NULL`        | Worker instance identifier                                       |
| `lease_expires_at`, `heartbeat_at` | `timestamptz NULL` | Active worker lease tracking                                     |
| `fencing_token`                    | `bigint NULL`      | Latest allocated claim fencing token                             |
| `started_at`, `completed_at`       | `timestamptz NULL` | Job lifecycle timestamps                                         |
| `terminal_reason`                  | `text NULL`        | Bounded termination category                                     |
| `created_at`, `updated_at`         | `timestamptz`      | Operational timestamps                                           |

Active or queued job combinations per check are deduplicated via a partial unique index. `UNIQUE (owner_id, check_id, id)` serves as the target for attempt lineage foreign keys. Reclaiming an expired lease generates a new attempt and a higher fencing token on the same job.

### 5.3 `monitoring.check_job_attempts`

| Column                            | Type               | Rule / Meaning                                                       |
| --------------------------------- | ------------------ | -------------------------------------------------------------------- |
| `id`                              | `uuid`             | PK                                                                   |
| `owner_id`, `check_id`, `job_id`  | `uuid`             | Composite ownership and job FK                                       |
| `attempt_number`                  | `smallint`         | Starts at 1 within the job; unique                                   |
| `worker_id`                       | `text`             | Worker instance identity                                             |
| `fencing_token`                   | `bigint`           | Monotonic fencing token allocated to this attempt                    |
| `lease_acquired_at`, `started_at` | `timestamptz`      | Execution start timestamps                                           |
| `last_heartbeat_at`               | `timestamptz NULL` | Operational heartbeat proof                                          |
| `ended_at`                        | `timestamptz NULL` | Terminal completion timestamp                                        |
| `terminal_reason`                 | `text NULL`        | `RESULT_RECORDED`, `LEASE_LOST`, `INTERNAL_ERROR`, `CANCELLED`, etc. |
| `result_recorded_at`              | `timestamptz NULL` | Guard preventing duplicate result insertions                         |

An attempt references the job through a full composite FK on `(owner_id, check_id, job_id)`, providing the `UNIQUE (owner_id, check_id, job_id, id)` target for runs. Enforces `UNIQUE (job_id, attempt_number)` and `UNIQUE (job_id, fencing_token)`. Under an attempt row lock, checking `result_recorded_at IS NULL` prevents duplicate run results.

### 5.4 `monitoring.check_runs` — Monthly Partitioning

Immutable observation and diagnostic record for every completed probe. Response bodies are never stored.

| Column                                                        | Type                 | Rule / Meaning                                                          |
| ------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| `finished_at`                                                 | `timestamptz`        | Partition key and composite PK component                                |
| `id`                                                          | `uuid`               | Composite PK component                                                  |
| `owner_id`, `check_id`                                        | `uuid`               | Composite PK component and check FK                                     |
| `job_id`, `attempt_id`                                        | `uuid`               | Originating job and attempt identifiers                                 |
| `trigger_kind`                                                | `text`               | Trigger kind snapshot                                                   |
| `manual_mode`                                                 | `text NULL`          | Diagnostic mode indicator                                               |
| `resource_version`, `probe_generation`, `schedule_generation` | `bigint`             | Acceptance generation inputs                                            |
| `fencing_token`                                               | `bigint`             | Monotonic token for acceptance ordering                                 |
| `scheduled_for`, `started_at`                                 | `timestamptz`        | Timing details                                                          |
| `dns_ms`, `connect_ms`, `tls_ms`, `ttfb_ms`, `total_ms`       | `integer NULL`       | Non-negative; measurable network phases                                 |
| `status_code`                                                 | `smallint NULL`      | HTTP response status code, if received                                  |
| `body_match`                                                  | `boolean NULL`       | Evaluated if expected substring was configured                          |
| `outcome`                                                     | `text`               | `PASS`, `FAIL`                                                          |
| `failure_category`                                            | `text NULL`          | DNS, CONNECT, TLS, TIMEOUT, STATUS, BODY, PROTOCOL, etc.                |
| `diagnostic`                                                  | `varchar(1024) NULL` | Sanitized; contains zero response bodies or secrets                     |
| `accepted_for_state`                                          | `boolean`            | Indicates whether run mutated current state                             |
| `rejection_reason`                                            | `text NULL`          | Cause for rejection (generation mismatch, stale fence, paused, deleted) |
| `recorded_at`                                                 | `timestamptz`        | Database insertion timestamp                                            |

The primary key is composite: `(owner_id, check_id, finished_at, id)`. Run records bind to the check/job/attempt lineage through composite foreign keys. Downstream references to runs utilize the 4-column foreign key `(owner_id, check_id, run_finished_at, run_id)`. Diagnostic manual runs record `accepted_for_state = false`. A `FAIL` outcome does not denote a failed background job; it represents a successfully recorded probe result for a `COMPLETED` job.

### 5.5 `monitoring.open_health_intervals`

Maintains exactly one open/provisional interval per check, enforcing the global "single open interval" invariant independent of table partitioning boundaries.

| Column                                    | Type          | Rule / Meaning                                             |
| ----------------------------------------- | ------------- | ---------------------------------------------------------- |
| `check_id`                                | `uuid`        | PK                                                         |
| `owner_id`                                | `uuid`        | Composite check FK                                         |
| `id`                                      | `uuid`        | Becomes the history interval ID once closed                |
| `classification`                          | `text`        | `UP`, `DOWN`, `UNKNOWN`, `PROVISIONAL`                     |
| `started_at`                              | `timestamptz` | Interval start timestamp                                   |
| `probe_generation`                        | `bigint`      | Semantic configuration boundary                            |
| `source_kind`                             | `text`        | `RUN`, `FRESHNESS`, `PAUSE`, `RESUME`, `CONFIG`, `STARTUP` |
| `source_run_id`, `source_run_finished_at` | nullable pair | Originating run locator, if triggered by a run             |
| `updated_at`                              | `timestamptz` | Last reconciliation timestamp                              |

`id` carries a unique constraint. When a new state begins, the preceding open row is moved to historical intervals and the new open row is upserted within the same transaction.

### 5.6 `monitoring.health_intervals` — Monthly Partitioning

Finalized, half-open availability timeline intervals.

| Column                                    | Type             | Rule / Meaning                                               |
| ----------------------------------------- | ---------------- | ------------------------------------------------------------ |
| `started_at`, `id`                        | timestamp + uuid | Composite PK; start partition key                            |
| `owner_id`, `check_id`                    | `uuid`           | Composite check FK                                           |
| `ended_at`                                | `timestamptz`    | `ended_at > started_at`                                      |
| `classification`                          | `text`           | `UP`, `DOWN`, `UNKNOWN`; `PROVISIONAL` resolves upon closing |
| `probe_generation`                        | `bigint`         | Configuration boundary                                       |
| `source_kind`                             | `text`           | Triggering event kind                                        |
| `source_run_id`, `source_run_finished_at` | nullable pair    | Originating run locator                                      |
| `finalized_at`                            | `timestamptz`    | Decision timestamp                                           |

DOWN periods correspond directly to incident segments; UNKNOWN intervals are excluded from the availability denominator. Because intervals are sequentially produced under check or incident row locks, overlapping intervals are prevented by transaction protocols and verified by tests.

### 5.7 `monitoring.incidents`

| Column                                                  | Type               | Rule / Meaning                                                   |
| ------------------------------------------------------- | ------------------ | ---------------------------------------------------------------- |
| `id`                                                    | `uuid`             | PK                                                               |
| `owner_id`, `check_id`                                  | `uuid`             | Composite check FK                                               |
| `status`                                                | `text`             | `OPEN`, `CLOSED`                                                 |
| `observation_mode`                                      | `text`             | `OBSERVED`, `UNOBSERVED`                                         |
| `first_failure_run_id`, `first_failure_run_finished_at` | pair               | FK to first sub-threshold FAIL run                               |
| `confirmation_run_id`, `confirmation_run_finished_at`   | pair               | FK to confirmation FAIL run crossing threshold                   |
| `started_at`, `confirmed_at`                            | `timestamptz`      | Start matches initial failure timestamp                          |
| `closed_at`                                             | `timestamptz NULL` | Mandatory when status is `CLOSED`                                |
| `closure_reason`                                        | `text NULL`        | `RECOVERED`, `CONFIG_CHANGED`, `CHECK_DELETED`, `ADMINISTRATIVE` |
| `observed_duration_ms`                                  | `bigint`           | Sum of observed segment durations; excludes gaps                 |
| `last_failure_category`                                 | `text NULL`        | Latest accepted FAIL category                                    |
| `resource_version`                                      | `bigint`           | Monotonic mutation order                                         |
| `created_at`, `updated_at`                              | `timestamptz`      | Audit timestamps                                                 |

`UNIQUE (owner_id, check_id, id)` serves as the target for incident segment and notification lineage foreign keys. At most one `OPEN` incident per check is permitted, enforced by a partial unique index. `closed_at >= started_at`; elapsed wall-clock duration remains distinct from observed downtime duration.

### 5.8 `monitoring.incident_segments`

| Column                                  | Type               | Rule / Meaning                                              |
| --------------------------------------- | ------------------ | ----------------------------------------------------------- |
| `id`                                    | `uuid`             | PK                                                          |
| `owner_id`, `check_id`, `incident_id`   | `uuid`             | Composite ownership FKs                                     |
| `started_at`                            | `timestamptz`      | Start of observed DOWN segment                              |
| `ended_at`                              | `timestamptz NULL` | NULL denotes currently active observed segment              |
| `start_run_id`, `start_run_finished_at` | pair               | Initiating FAIL run locator                                 |
| `end_run_id`, `end_run_finished_at`     | nullable pair      | Resolving PASS run locator; may be NULL on freshness close  |
| `close_reason`                          | `text NULL`        | `RECOVERED`, `STALE`, `PAUSED`, `CONFIG_CHANGED`, `DELETED` |
| `created_at`, `updated_at`              | `timestamptz`      | Audit timestamps                                            |

At most one open segment per incident is enforced via a partial unique index. Segment mutations occur under incident row locks, preventing temporal overlaps.

### 5.9 `monitoring.rollups_minute` and `monitoring.rollups_hour`

Both tables share identical measurement metrics; minute rollups are range-partitioned monthly, hour rollups yearly.

| Column                                             | Type           | Rule / Meaning                                        |
| -------------------------------------------------- | -------------- | ----------------------------------------------------- |
| `bucket_start`                                     | `timestamptz`  | Partition key and composite PK component; UTC-aligned |
| `owner_id`, `check_id`                             | `uuid`         | Composite check FK                                    |
| `probe_generation`                                 | `bigint`       | Configuration boundary; composite PK component        |
| `accepted_run_count`, `pass_count`, `fail_count`   | `integer`      | Non-negative run counts                               |
| `response_sample_count`                            | `integer`      | Count of latency samples                              |
| `response_sum_ms`                                  | `bigint`       | Sum of latency samples for average calculation        |
| `response_min_ms`, `response_max_ms`               | `integer NULL` | NULL if no samples exist                              |
| `up_ms`, `down_ms`, `unknown_ms`, `provisional_ms` | `bigint`       | Durations clipped to the bucket window                |
| `computed_through`                                 | `timestamptz`  | Calculation watermark                                 |
| `revision`                                         | `bigint`       | Incremented upon late corrections                     |
| `updated_at`                                       | `timestamptz`  | Projection update timestamp                           |

Composite PK is `(bucket_start, check_id, probe_generation)`. Availability evaluates as `up_ms / (up_ms + down_ms)`; coverage evaluates as `(up_ms + down_ms) / desired_interval_ms`. UNKNOWN and provisional durations are excluded from the availability denominator.

### 5.10 `monitoring.rollup_checkpoints`

| Column            | Type          | Rule / Meaning                            |
| ----------------- | ------------- | ----------------------------------------- |
| `processor_name`  | `text`        | PK; minute / hour / reconciliation        |
| `watermark_at`    | `timestamptz` | Definitively processed watermark boundary |
| `last_partition`  | `text NULL`   | Operational partition visibility          |
| `updated_at`      | `timestamptz` | Heartbeat timestamp                       |
| `last_error_code` | `text NULL`   | Sanitized error code                      |

## 6. `notification` Schema

### 6.1 `notification.recipients`

| Column                              | Type               | Rule / Meaning                                 |
| ----------------------------------- | ------------------ | ---------------------------------------------- |
| `id`                                | `uuid`             | PK                                             |
| `owner_id`                          | `uuid`             | User composite FK                              |
| `email_normalized`, `email_display` | `varchar(320)`     | Normalized address unique per owner            |
| `status`                            | `text`             | `PENDING_VERIFICATION`, `VERIFIED`, `DISABLED` |
| `verified_at`, `disabled_at`        | `timestamptz NULL` | Consistent with status                         |
| `resource_version`                  | `bigint`           | Optimistic concurrency control                 |
| `created_at`, `updated_at`          | `timestamptz`      | Audit timestamps                               |

Deliveries are materialized exclusively for `VERIFIED` recipients.

### 6.2 `notification.recipient_verification_tokens`

Carries `id`, `owner_id`, `recipient_id`, unique `token_digest`, `created_at`, `expires_at`, and nullable `consumed_at`. Raw tokens are never stored; previous tokens are consumed during active token rotation transactions.

### 6.3 `notification.policies`

| Column                           | Type           | Rule / Meaning                               |
| -------------------------------- | -------------- | -------------------------------------------- |
| `id`                             | `uuid`         | PK                                           |
| `owner_id`                       | `uuid`         | User composite FK                            |
| `group_id`                       | `uuid NULL`    | NULL = user default; non-null = group policy |
| `mode`                           | `text`         | `ACTIVE`, `INHERIT`, `DISABLED`              |
| `notify_down`, `notify_recovery` | `boolean NULL` | Mandatory when ACTIVE; NULL when INHERIT     |
| `resource_version`               | `bigint`       | Optimistic concurrency control               |
| `created_at`, `updated_at`       | `timestamptz`  | Audit timestamps                             |

`UNIQUE NULLS NOT DISTINCT (owner_id, group_id)` guarantees exactly one default policy per user and at most one policy per group. User default cannot be `INHERIT`. Group policies in `INHERIT` mode do not carry recipient attachments.

### 6.4 `notification.policy_recipients`

Carries `owner_id`, `policy_id`, `recipient_id`, and `created_at`. PK is `(policy_id, recipient_id)`; both sides link to the same owner via composite foreign keys.

### 6.5 `notification.intents`

| Column                                       | Type               | Rule / Meaning                                                                             |
| -------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `id`                                         | `uuid`             | PK                                                                                         |
| `owner_id`, `check_id`, `incident_id`        | `uuid`             | Composite origin FKs                                                                       |
| `source_event_id`                            | `uuid`             | Outbox event unique FK                                                                     |
| `event_kind`                                 | `text`             | `INCIDENT_OPENED`, `INCIDENT_RECOVERED`                                                    |
| `state`                                      | `text`             | `PENDING_EVALUATION`, `DEFERRED_MAINTENANCE`, `MATERIALIZED`, `CANCELLED`, `NO_RECIPIENTS` |
| `maintenance_until`                          | `timestamptz NULL` | Lower bound for re-evaluation if deferred by maintenance                                   |
| `policy_version_snapshot`                    | `bigint NULL`      | Snapshot proof at materialization                                                          |
| `created_at`, `evaluated_at`, `completed_at` | `timestamptz NULL` | Intent lifecycle timestamps                                                                |

`UNIQUE (incident_id, event_kind)` deduplicates notification intents for the same incident transition. Policies and recipients are resolved dynamically at materialization time.

### 6.6 `notification.deliveries`

| Column                                  | Type               | Rule / Meaning                                                                           |
| --------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| `id`                                    | `uuid`             | PK                                                                                       |
| `owner_id`, `intent_id`, `recipient_id` | `uuid`             | Composite FKs                                                                            |
| `incident_id`                           | `uuid`             | Denormalized for rapid idempotency lookups                                               |
| `event_kind`                            | `text`             | Intent event kind snapshot                                                               |
| `recipient_address_snapshot`            | `varchar(320)`     | Snapshot proof of address; recipient record may change later                             |
| `state`                                 | `text`             | `PENDING`, `PROCESSING`, `RETRY_WAIT`, `SENT`, `FAILED`, `DELIVERY_UNKNOWN`, `CANCELLED` |
| `attempt_count`, `max_attempts`         | `smallint`         | Bounded retry limits                                                                     |
| `available_at`, `next_attempt_at`       | `timestamptz`      | Claim scheduling timestamps                                                              |
| `lease_owner`, `lease_expires_at`       | nullable           | Time-bounded lease ownership                                                             |
| `fencing_token`                         | `bigint`           | Monotonic claim ordering token                                                           |
| `provider_message_id`                   | `text NULL`        | Result returned by Mailpit / SMTP adapter                                                |
| `last_result_code`, `last_error_detail` | `text NULL`        | Sanitized and bounded error fields                                                       |
| `sent_at`, `completed_at`               | `timestamptz NULL` | Terminal delivery timestamps                                                             |
| `created_at`, `updated_at`              | `timestamptz`      | Operational timestamps                                                                   |

`UNIQUE (incident_id, event_kind, recipient_id)` prevents duplicate emails. If connection state is uncertain following SMTP acceptance, `DELIVERY_UNKNOWN` is terminal, and automatic retries are skipped by default.

## 7. `public_status` Schema

### 7.1 `public_status.pages`

| Column                                      | Type                 | Rule / Meaning                                    |
| ------------------------------------------- | -------------------- | ------------------------------------------------- |
| `id`                                        | `uuid`               | PK                                                |
| `owner_id`                                  | `uuid`               | User composite FK                                 |
| `title`                                     | `varchar(160)`       | Public page title                                 |
| `description`                               | `varchar(2000) NULL` | Public page description                           |
| `state`                                     | `text`               | `DRAFT`, `PUBLISHED`, `DISABLED`                  |
| `slug_digest`                               | `bytea`              | Unique digest; raw public tokens are never stored |
| `token_revision`                            | `bigint`             | Incremented on token rotation                     |
| `resource_version`                          | `bigint`             | Configuration concurrency control                 |
| `published_at`, `disabled_at`, `deleted_at` | `timestamptz NULL`   | Consistent with state and lifecycle               |
| `created_at`, `updated_at`                  | `timestamptz`        | Audit timestamps                                  |

A user may create multiple public status pages. The public routing identifier is not a UUID; it is a high-entropy secret token.

### 7.2 `public_status.components`

| Column                     | Type                | Rule / Meaning                            |
| -------------------------- | ------------------- | ----------------------------------------- |
| `id`                       | `uuid`              | PK                                        |
| `owner_id`, `page_id`      | `uuid`              | Composite page FK                         |
| `check_id`, `group_id`     | `uuid NULL`         | Exactly one non-null; composite owner FKs |
| `position`                 | `integer`           | Unique within page, `>= 0`                |
| `display_name`             | `varchar(160) NULL` | Public display name override              |
| `show_url`                 | `boolean`           | Explicit permission flag                  |
| `show_response_time`       | `boolean`           | Explicit permission flag                  |
| `show_incident_history`    | `boolean`           | Explicit permission flag                  |
| `created_at`, `updated_at` | `timestamptz`       | Audit timestamps                          |

The same check or group can be attached to a page only once, enforced by two partial unique indexes.

### 7.3 `public_status.snapshots`

The sole data surface exposed to anonymous public access.

| Column                   | Type          | Rule / Meaning                                      |
| ------------------------ | ------------- | --------------------------------------------------- |
| `page_id`                | `uuid`        | PK                                                  |
| `owner_id`               | `uuid`        | Page composite FK and private RLS scope             |
| `slug_digest`            | `bytea`       | Unique lookup digest                                |
| `page_revision`          | `bigint`      | Represents page resource, token, and state revision |
| `payload_schema_version` | `smallint`    | DTO schema version                                  |
| `payload`                | `jsonb`       | Public allowlisted projection; maximum 256 KiB      |
| `generated_at`           | `timestamptz` | Projection generation timestamp                     |

Snapshots exist solely for `PUBLISHED` pages. Deactivation, token rotation, or deletion removes or updates the snapshot within the same transaction. `owner_id` is retained exclusively for private RLS and purge isolation; it is never included in the payload. The payload contains zero owner IDs, private recipient details, internal error strings, or confidential URL parameters.

## 8. `prediction` Schema

### 8.1 `prediction.analysis_jobs`

| Column                                     | Type               | Rule / Meaning                                                            |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------------------- |
| `id`                                       | `uuid`             | PK                                                                        |
| `owner_id`, `check_id`                     | `uuid`             | Composite check identity; predictor cannot read private check definitions |
| `requested_through`                        | `timestamptz`      | Coalesced feature watermark                                               |
| `state`                                    | `text`             | `PENDING`, `PROCESSING`, `RETRY_WAIT`, `COMPLETED`, `DEAD`                |
| `available_at`                             | `timestamptz`      | Eligible claim timestamp                                                  |
| `attempt_count`, `max_attempts`            | `smallint`         | Bounded retry limits                                                      |
| `lease_owner`, `lease_expires_at`          | nullable           | Time-bounded lease ownership                                              |
| `fencing_token`                            | `bigint`           | Monotonic claim ordering token                                            |
| `created_at`, `updated_at`, `completed_at` | `timestamptz NULL` | Job lifecycle timestamps                                                  |

Active analysis jobs per check are deduplicated via a partial unique index; new requests advance the `requested_through` watermark.

### 8.2 `prediction.model_versions`

Carries `id uuid` PK, unique `name` + `version`, `artifact_digest`, `feature_schema_version`, `status` (`CANDIDATE`, `ACTIVE`, `RETIRED`), `activated_at`, `retired_at`, bounded `metadata jsonb`, and audit timestamps. Model artifact binaries are never stored in the database; only digests and provenance metadata are persisted.

### 8.3 `prediction.scores` — Monthly Partitioning

| Column                                       | Type             | Rule / Meaning                                           |
| -------------------------------------------- | ---------------- | -------------------------------------------------------- |
| `computed_at`, `id`                          | timestamp + uuid | Composite PK, monthly range-partitioned                  |
| `owner_id`, `check_id`                       | `uuid`           | Identity; predictor writes exclusively to its own schema |
| `analysis_job_id`                            | `uuid`           | Originating analysis job ID                              |
| `model_version_id`                           | `uuid`           | Model registry FK                                        |
| `horizon_seconds`                            | `integer`        | `> 0`                                                    |
| `risk_score`                                 | `numeric(6,5)`   | Bounded between `0` and `1`                              |
| `risk_level`                                 | `text`           | `LOW`, `MEDIUM`, `HIGH`, `INSUFFICIENT_DATA`             |
| `valid_until`                                | `timestamptz`    | `> computed_at`                                          |
| `feature_window_start`, `feature_window_end` | `timestamptz`    | Bounded feature input window                             |
| `feature_snapshot`                           | `jsonb`          | Aggregated non-PII features; maximum 32 KiB              |
| `reason_codes`                               | `jsonb`          | Bounded list of reason codes and weights                 |

Scores are immutable. An "insufficient data" outcome is also persisted as an explainable score record; scores produce zero foreign keys or trigger side-effects on operational health or incident states.

## 9. `audit` Schema

### 9.1 `audit.events` — Monthly Partitioning

| Column                         | Type                | Rule / Meaning                            |
| ------------------------------ | ------------------- | ----------------------------------------- |
| `occurred_at`, `id`            | timestamp + uuid    | Composite PK and monthly partition key    |
| `owner_id`                     | `uuid NULL`         | Tenant or system scope                    |
| `actor_type`                   | `text`              | `USER`, `WORKER`, `SYSTEM`                |
| `actor_id`                     | `uuid/text NULL`    | Non-PII actor identifier                  |
| `action`                       | `text`              | Semantic action identifier                |
| `resource_type`, `resource_id` | `text`, `uuid NULL` | Target resource                           |
| `correlation_id`               | `uuid`              | Trace lineage identifier                  |
| `result`                       | `text`              | `SUCCESS`, `DENIED`, `FAILED`             |
| `metadata`                     | `jsonb`             | Redacted context metadata; maximum 16 KiB |
| `recorded_at`                  | `timestamptz`       | Insertion timestamp                       |

Append-only table; runtime application roles have zero `UPDATE` or `DELETE` grants. Passwords, tokens, response bodies, full internal stack traces, or recipient email addresses are strictly forbidden from audit metadata.

## 10. Cross-Table Integrity Matrix

| Rule                                                                      | Enforcement Mechanism                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Foreign resources belonging to different owners cannot be linked          | Composite foreign keys referencing `(owner_id, id)` on every tenant relation         |
| A check cannot begin a concurrent second job                              | Partial unique index on active states in `check_jobs`                                |
| A check has at most one open incident                                     | Partial unique index on `incidents(check_id) WHERE status = 'OPEN'`                  |
| An incident has at most one open observed segment                         | Partial unique index on `incident_segments(incident_id) WHERE ended_at IS NULL`      |
| A check has at most one open health interval                              | `open_health_intervals.check_id` PK                                                  |
| Run references target the exact owner, check, and partition row           | Composite foreign key on `(owner_id, check_id, run_finished_at, run_id)`             |
| Maintenance belongs to exactly one target entity                          | Named `CHECK (num_nonnulls(check_id, group_id) = 1)` + two composite FKs             |
| The same incident transition does not generate duplicate emails           | Unique constraints on notification intents and deliveries                            |
| Public token rotation immediately revokes the previous link               | Unique slug digest + atomic snapshot invalidation within the same transaction        |
| Stale workers cannot overwrite current state                              | Generation counter + fencing token comparisons inside locked acceptance transactions |
| Outages of user accounts / system gaps are not counted as target downtime | `UNKNOWN` intervals + availability denominator rules in rollup views                 |

Foreign keys prevent corrupted data states; however, raw constraint details are never surfaced to end users for authorization checks. The API maps database constraint violations to standard `404 Not Found` or `409 Conflict` error contracts.

## 11. Deliberate Non-Inclusions

- Organization, membership, and team role tables
- Raw HTTP response bodies, full header dumps, or TLS certificate contents
- Full duplicate copies of email template HTML per delivery; instead, template versions and rendering outputs are managed according to adapter log policies
- Redis lock or job queue state
- Predictor model artifact binaries
- Browser IP and user-agent history logs (without an explicit privacy policy decision)
- Hardcoded `50 check` quota constraints embedded into the database schema
