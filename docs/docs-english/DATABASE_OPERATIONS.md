# Database Operations, Query, and Continuity Plan

**Status:** Implemented; migrations, clean setup, and logical restore rehearsal verified  
**Related documents:** [`DATABASE.md`](./DATABASE.md), [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md), [`DATABASE_SECURITY.md`](./DATABASE_SECURITY.md)

## 1. Operational Goals

- Dashboard queries run without touching raw run history.
- A slow target does not block the claim/probe flow of other checks.
- The same check does not run concurrently with itself; lease loss does not produce stale writes.
- 24-hour, 7-day, and 30-day historical queries scan a fixed number of partitions and bounded rows.
- Migrations run independently of application deployments, as a single instance with an advisory lock.
- Backups do not produce incomplete data due to RLS; restore is routinely proven.
- Partition/rollup lag is observable and can be reprocessed without data loss.

## 2. Critical Queries and Index Plan

Indexes are added in migrations with explicit names and query justifications. The actual usage of each index is monitored via `pg_stat_user_indexes`, alongside size and write overhead; speculative "might be needed in the future" indexes are not added.

### 2.1 Main Index Matrix

| Query / Invariant | Table | Index / Constraint |
| ----------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Login lookup | `auth.users` | unique B-tree `(email_normalized)` |
| Session exact digest | `auth.sessions` | unique B-tree `(token_digest)`; cleanup `(expires_at)` |
| User check list | `app.checks` | `(owner_id, lifecycle_state, created_at DESC, id)` INCLUDE `(name,group_id,execution_state)` |
| Group check list | `app.checks` | `(owner_id, group_id, lifecycle_state, id)` |
| Scheduler due scan | `app.checks` | partial `(next_run_at,id)` WHERE LIVE+ACTIVE |
| Pending manual reconciliation | `app.checks` | partial `(manual_requested_at,id)` WHERE non-null and LIVE |
| Composite ownership | Every tenant parent | unique `(owner_id,id)` |
| Dashboard state join | `check_current_states` | PK `(check_id)`, unique `(owner_id,check_id)`; `(owner_id,health_state,updated_at DESC)` |
| Job claim | `check_jobs` | partial `(available_at,priority DESC,created_at,id)` WHERE `PENDING` |
| Lease recovery | `check_jobs` | partial `(lease_expires_at,id)` WHERE `LEASED/RUNNING` |
| Single active job | `check_jobs` | unique partial `(check_id)` WHERE `PENDING/LEASED/RUNNING` |
| Job history | `check_jobs` | `(owner_id,check_id,created_at DESC,id)` |
| Attempt order | `check_job_attempts` | unique `(job_id,attempt_number)` and `(job_id,fencing_token)` |
| Run history | Every run partition | `(owner_id,check_id,finished_at DESC,id)` INCLUDE `(outcome,total_ms,status_code,accepted_for_state)` |
| Rollup source scan | Every run partition | partial `(finished_at,check_id)` WHERE `accepted_for_state` |
| Partition time scan | Large partition | BRIN `(finished_at)` only if size/plan evidence proves beneficial |
| Single open incident | `incidents` | unique partial `(check_id)` WHERE `status='OPEN'` |
| Incident journal | `incidents` | `(owner_id,check_id,started_at DESC,id)` and `(owner_id,status,started_at DESC)` |
| Single open segment | `incident_segments` | unique partial `(incident_id)` WHERE `ended_at IS NULL` |
| Incident segments | `incident_segments` | `(owner_id,incident_id,started_at,id)` |
| Active maintenance | `maintenance_windows` | partial `(owner_id,check_id,starts_at,ends_at)` and group equivalent WHERE SCHEDULED |
| Maintenance expiration | `maintenance_windows` | partial `(ends_at,id)` WHERE SCHEDULED |
| Maintenance owner list | `maintenance_windows` | `(owner_id,starts_at DESC,id DESC)` |
| Recipient lookup | `recipients` | unique `(owner_id,email_normalized)` |
| Policy scope | `policies` | unique NULLS NOT DISTINCT `(owner_id,group_id)` |
| Intent evaluation | `notification.intents` | partial `(maintenance_until,created_at,id)` WHERE pending/deferred |
| Intent idempotency | `notification.intents` | unique `(incident_id,event_kind)` |
| Delivery claim | `notification.deliveries` | partial `(available_at,id)` WHERE pending/retry; lease expiry equivalent |
| Delivery idempotency | `notification.deliveries` | unique `(incident_id,event_kind,recipient_id)` |
| Outbox claim | `outbox_dispatches` | partial `(available_at,event_id,destination)` WHERE pending/retry |
| Public lookup | `public_status.snapshots` | unique `(slug_digest)` |
| Component ordering | `public_status.components` | unique `(page_id,position)` + check/group partial unique |
| History rollup | Rollup partition | PK `(bucket_start,check_id,probe_generation)` + `(owner_id,check_id,bucket_start)` |
| Prediction claim | `analysis_jobs` | active partial unique `(check_id)` + pending `(available_at,id)` |
| Latest score | Score partition | `(owner_id,check_id,computed_at DESC,id)` |
| Audit list | Audit partition | `(owner_id,occurred_at DESC,id)` |

Foreign key columns are additionally indexed if cascade/parent mutation queries show actual usage. Because PostgreSQL does not automatically create child indexes for foreign keys, migration reviews explicitly verify this.

### 2.2 Scheduler Claim Flow

The scheduler selects due checks in a bounded batch using `FOR UPDATE SKIP LOCKED` within a short transaction. For each selected check:

1. Verifies via unique invariant whether an active job already exists.
2. Enqueues the job with a config/version snapshot.
3. Advances `next_run_at` using the formula `cadence_anchor_at + k * interval`; does not use `now + interval` to avoid drift.
4. Does not create backfill jobs for missed intervals; skips ahead to the next future cadence slot.
5. Commits/closes the transaction; no HTTP calls are ever made while any DB transaction or lock is open.

Owner fairness is not left to a single global FIFO. Batch selection applies limited candidates per owner or round-robin ordering; a single large owner cannot starve smaller owners indefinitely. This algorithm is finalized via load testing in the Phase 9 scheduler implementation, but the prerequisite index is the due scan index shown above.

Workers first read bounded candidates without locks. The claim transaction locks rows in the same canonical order as API commands: first the check row with `FOR UPDATE SKIP LOCKED`, then the job row; it atomically increments `next_fencing_token` on the check, assigns the previous value to the attempt, and writes both the lease and the attempt in the same transaction. Locking the pending job first and waiting on the check is strictly forbidden. Network calls are executed outside transactions. Result acceptance opens another short transaction and locks check/job/attempt/current-state rows in the same order. Details are in [`SCHEDULER_AND_WORKERS.md`](./SCHEDULER_AND_WORKERS.md).

### 2.3 Lock Ordering

To reduce deadlock risk, all commands follow this order whenever possible:

1. `auth.users` (only for account lifecycle)
2. Aggregate root: check/group/page/policy/incident/intent
3. Current/projection row
4. Child/history rows
5. Outbox/audit

If multiple checks must be locked, UUIDs are acquired in ascending order. External HTTP, SMTP, prediction, or SSE broadcast operations are never performed inside a transaction.

### 2.4 Dashboard Query

The dashboard only joins live check, group, and current-state rows. Effective freshness is computed in the query as follows:

- If execution is PAUSED or lifecycle is DELETED, displayed separately according to the product contract,
- If `fresh_until <= statement_timestamp()`, then `STALE/UNKNOWN`,
- Otherwise, the projection value.

Thus, even if the reconciler is delayed by a few seconds, the UI will not display a false UP. Overall group state is a bounded aggregate of check current states in priority order (`DOWN > SUSPECT > UNKNOWN > UP`); in v1 there is no separate persistent group-state table. If measurements indicate a bottleneck, a rebuildable projection can be introduced.

### 2.5 History Query

| Interval | Primary Source | Graph Resolution |
| ------------- | -------------------------------------- | ------------------ |
| Last 24 hours | Minute rollup | 1–5 minutes |
| Last 7 days | API bucket aggregate from minute rollup | 15–60 minutes |
| Last 30/31 days | Hour rollup | 1–6 hours |

Requests are strictly bounded by `owner_id + check_id + [from,to)`. The `bucket_start` condition is mandatory for partition pruning. The first and last partial buckets are clipped directly with finalized health interval/minute data; full buckets come from rollups. Open health intervals are appended at query time up to `min(now,to)`.

The response-time graph uses only accepted run samples. The displayed average is `response_sum_ms / response_sample_count`; min/max reside in the same bucket. Rejected/diagnostic runs can be displayed in a separate technical details feed without affecting the primary SLA series.

Availability and coverage are returned separately:

```text
availability = up_ms / (up_ms + down_ms)
coverage     = (up_ms + down_ms) / requested_window_ms
```

If the denominator is zero, availability is `null`, not `0%`. UNKNOWN and provisional periods that have not yet been finalized remain as gaps / no-data on the chart.

## 3. Partitioning Plan

### 3.1 Partition Matrix

| Parent | Key | Interval | Default Retention |
| ----------------------------- | -------------- | ------ | --------------------------------- |
| `monitoring.check_runs` | `finished_at` | Monthly | 90 days raw |
| `monitoring.health_intervals` | `started_at` | Monthly | 400 days |
| `monitoring.rollups_minute` | `bucket_start` | Monthly | 35 days |
| `monitoring.rollups_hour` | `bucket_start` | Yearly | 400 days |
| `prediction.scores` | `computed_at` | Monthly | 90 days |
| `audit.events` | `occurred_at` | Monthly | 400 days, customizable by policy |

Partition names explicitly carry UTC boundaries: e.g., `check_runs_2026_10`. Queries target the parent table; the application does not generate partition names.

### 3.2 Partition Lifecycle

- Migrations create partitions for the current month, the preceding retention window, and the subsequent three months.
- The housekeeper daily verifies that at least three upcoming monthly partitions exist and creates missing ones via a controlled procedure.
- A DEFAULT partition safety net exists for each parent; in normal operations, it must contain zero rows.
- Any row landing in DEFAULT triggers an alert. The housekeeper creates the target partition and moves the rows in bounded batches; this partition is not a permanent store.
- Partitions reaching retention expiration are first detached, recorded in a manifest/count log, and dropped after a grace period.
- Legal hold is not default within this product scope; if needed, an explicit deployment setting is added to pause the partition drop policy.

Due to PostgreSQL's requirement that unique/primary constraints must include the partition key, tenant partitioned history PKs follow the owner + timestamp + id format. Run references carry the same triplet. This trade-off was accepted in favor of both partition pruning and ownership referential integrity.

### 3.3 Partition Creation and Indexes

DDL for new empty partitions is executed with a short lock timeout. If a new index is required on a large existing partition:

1. A suitable partitioned index shell is prepared on the parent.
2. Child indexes are created one by one using `CREATE INDEX CONCURRENTLY`.
3. Child indexes are attached to the parent index.
4. Validity and query plans are verified.

Migrations fail fast with a default `lock_timeout=5s`; they do not stall traffic indefinitely waiting for locks. Operational migrations require a separate runbook and measurement.

## 4. Rollup Architecture

### 4.1 Sources

- Latency and run counts: `check_runs WHERE accepted_for_state=true`
- Availability/coverage durations: finalized `health_intervals`
- Open/current intervals: appended dynamically at history query time; never finalized into permanent rollups before closing

The rollup worker operates independently from the main probe worker. Any lag on its part does not degrade monitoring accuracy; only historical freshness decreases, producing observable telemetry.

### 4.2 Idempotent Computation

- The minute processor only processes buckets finalized before the watermark; for example, the current minute and a small lateness window are left open.
- The same bucket can be recomputed idempotently; deterministic aggregates are pulled from the source and revision is incremented via `INSERT ... ON CONFLICT ... DO UPDATE`.
- The hour rollup is derived from finalized minute buckets.
- If a late/reconciled interval affects a previous bucket, a bounded correction queue schedules that bucket for recomputation.
- Checkpoints advance only after the respective bucket transaction completes successfully.
- Rebuild commands are bounded by owner/check/time intervals and are fully resumable.

### 4.3 Speed Targets and Evidence

Reference dataset: synthetic raw/rollup distribution equivalent to at least 500 checks running every 30 seconds for 35 days. A small correctness fixture runs in CI, while a large dataset is used in a dedicated performance profile.

Targets for a warmed reference environment:

- 30-day history API DB query for a single check: p95 < 500 ms
- Endpoint p95 including API serialization: < 2 seconds
- Dashboard list query: p95 < 300 ms

These are not production SLO guarantees, but rather an acceptance / performance regression budget. `EXPLAIN (ANALYZE, BUFFERS)` execution plans are archived using fixtures free of personal data. Plans must demonstrate partition pruning; raw 30-day run scans are unacceptable.

## 5. Retention and Purge

Defaults can be extended via deployment configuration; the minimum product requirement of one month of history is preserved.

| Data | Default Retention | Purge Method |
| ---------------------------- | ---------------------: | ---------------------------------------- |
| Raw accepted/rejected runs | 90 days | Partition detach/drop |
| Finalized health intervals | 400 days | Partition detach/drop |
| Minute rollup | 35 days | Partition detach/drop |
| Hour rollup | 400 days | Partition detach/drop |
| Completed jobs/attempts | 30 days | Bounded batch delete |
| Open jobs | Until terminal | Retention does not apply |
| Incidents and segments | 400 days | Bounded owner/check batch |
| Notification intent/delivery | 400 days | Bounded batch; subject to audit requirements |
| Completed outbox/dispatch | 30 days | Bounded batch |
| Dead outbox/dispatch | Until operator resolves | Never automatically deleted |
| Session/one-time tokens | Expiry/revocation + 30 days | Bounded batch |
| API idempotency receipts | Default 24 hours | Bounded delete using expiry index |
| Public snapshots | Current only | Transactional replace/delete |
| Prediction scores | 90 days | Partition detach/drop |
| Audit events | 400 days | Partition; deployment policy override |

Purges utilize small batches, statement timeouts, and progress checkpoints. Autovacuum pressure is monitored. Partition dropping is preferred over row deletions wherever possible. Because account deletion cannot drop a partition shared by multiple owners, it uses bounded deletes indexed on `(owner_id, time, id)`; the owner tombstone is retained until completion.

Changing retention policies does not restore data already purged in the past. The UI/API returns the earliest available historical boundary.

## 6. Migration Architecture

### 6.1 File and Runner Contract

Migrations are immutable, sequentially ordered SQL files located under `database/migrations/`:

```text
000001_bootstrap_roles_and_schemas.sql
000002_auth_and_core.sql
000003_monitoring.sql
000004_messaging_public_prediction_audit.sql
000005_security_and_access.sql
000006_partitions_and_housekeeping.sql
000007_api_idempotency_records.sql
000008_auth_and_ownership.sql
000009_transactional_email_grants.sql
000010_anonymous_idempotency_boundary.sql
000011_account_profile_boundary.sql
```

The repository-owned TypeScript runner using `pg`:

1. Opens an isolated migrator connection.
2. Acquires a PostgreSQL advisory lock; a secondary migrator stops according to the fail/wait policy.
3. Compares checksums of applied files in the ledger against disk; halts execution if any divergence is detected.
4. Applies pending migrations by default within a single transaction.
5. Writes ledger and compatibility records.
6. Releases the lock and closes the connection.

Migrations that must run outside transactions, such as `CREATE INDEX CONCURRENTLY`, are explicitly tagged with metadata/headers, carry idempotent preconditions/postconditions, and are reviewed in isolation. They are never mixed with transactional DDL in the same file.

`db:migrate` is the production-safe forward operation command. `db:reset` operates strictly when `NODE_ENV != production`, `ALLOW_DATABASE_RESET=true`, local host, and an allowlisted database name are all verified together; it never executes on a production URL. `db:seed` runs only in `NODE_ENV=development|test` environments.

### 6.2 Forward-Only and Expand/Contract

There are no generic `down` migrations for production rollbacks. Rollbacks occur either through application rollbacks or new forward-fix migrations. Destructive contract migrations that result in data loss require a verified backup/PITR recovery point beforehand.

Schema evolution sequence:

1. **Expand:** Nullable / new column, new table / index; legacy app continues running.
2. **Dual compatibility:** Application writes and reads both formats if necessary.
3. **Backfill:** Bounded, resumable job; millions of rows are never updated within a single migration transaction.
4. **Verify:** Null, count, checksum, and shadow-read comparison.
5. **Switch:** New application read path becomes active.
6. **Contract:** Old columns / constraints are dropped in a separate release / migration once the old fleet is fully decommissioned.

The runtime build carries the schema compatibility epoch/revision range it supports. Readiness returns false if the current schema revision falls outside this range; liveness remains true. App startup does not run migrations.

### 6.3 SQL Rules

- Every migration uses explicit schema-qualified object names.
- `lock_timeout` is kept short; `statement_timeout` is bounded according to migration type.
- Table rewrite and prolonged ACCESS EXCLUSIVE lock risks are documented during migration review.
- Adding NOT NULL: conducted safely via nullable + backfill + `CHECK NOT VALID` / validate + NOT NULL.
- Adding FK on large tables: added with `NOT VALID` if necessary, followed by online `VALIDATE CONSTRAINT`.
- Index redundancy is checked against `pg_indexes` and query workload.
- Triggers are used only when strictly atomic DB invariants are required; hidden business workflows are never buried in triggers.
- Once a migration file is merged into main, it is never modified; fixes are introduced in new migration files.

### 6.4 Seed and Fixtures

Development seed:

- Deterministic user, check, group, and public page samples
- UP, SUSPECT, DOWN, UNKNOWN, and maintenance scenarios
- Incident, history, and rollup samples
- Verified recipient suitable for Mailpit
- Documented local-only demo credentials instead of raw passwords; excluded from production seeds

Seeds are re-runnable using idempotent upserts or fixed namespace identifiers. Test fixtures are independent of development seed data; each test sets up only the data it requires using factories.

## 7. Backup, PITR, and Restore

### 7.1 Initial Production Targets

| Target | Value | Note |
| --------------- | ------------------------------------------------: | -------------------------------------------------------- |
| RPO | Maximum 5 minutes | Via managed WAL/PITR; validated at deployment |
| RTO | Maximum 60 minutes | Must be tested against data size and provider restore latency |
| PITR window | 14 days | For accidental migration or user errors |
| Daily snapshot | 35 days | Encrypted and automated |
| Restore drill | At least quarterly and prior to destructive migrations | Isolated environment |

These values are not considered "met" until infrastructure is provisioned; they must be verified with provider evidence during deployment acceptance. Local Compose is not a production continuity solution.

### 7.2 Backup Approach

- In production, managed PostgreSQL automated snapshots + continuous WAL/PITR are preferred.
- Backup storage employs encryption-at-rest, TLS in transit, and dedicated access policies.
- Backup credentials are segregated from the application runtime.
- Logical `pg_dump` serves as an additional verification layer for release/portability; it is not the sole continuity solution.
- `pg_dump` must not omit rows due to RLS. A privileged backup role and `row_security=off` fail-closed behavior are enforced; filtered dumps are not considered successful.
- Because backups contain secret digests and PII, production data is never pulled into local development. Test restores are performed in access-restricted isolated environments or after approved anonymization.

### 7.3 Restore Runbook

1. Incident commander identifies the target restore timestamp/backup; halts write traffic or prepares a redirection plan to the new cluster.
2. Snapshot/PITR is restored to an isolated new PostgreSQL 18-compatible instance.
3. Extensions, roles, ownership, RLS, functions, and privileges are validated.
4. Migration ledger checksums and schema compatibility are verified; migrations are not automatically run to "latest".
5. Consistency checks run for table/partition row counts, FK/constraints, open incidents/jobs, and rollup watermarks.
6. Cross-user RLS smoke tests, auth bootstrap, scheduler claim, history, and public snapshot tests run.
7. Application connects initially in read-only/canary mode; controlled traffic cutover follows.
8. RPO data gap is measured. Missing operational intervals are not backfilled as check FAIL; they remain as UNKNOWN/gaps in history.
9. Results, durations, and discrepancies are logged in a restore report.

Restore success is not merely that the database starts; it requires application invariant and security tests to pass.

## 8. Observability and Alert Thresholds

Database telemetry covers at least the following:

- Connection pool utilization rate, pool wait p95/p99
- Transaction and statement durations; timeout, deadlock, and lock wait counts
- Due check lag and oldest pending job age
- Lease reclaim / stale result rejection counts
- Outbox, notification, and prediction queue depth and oldest message age
- DEFAULT partition row count
- Upcoming partition count
- Minute/hour rollup watermark lag
- Autovacuum lag, dead tuples, table/index bloat, and cache hit ratio
- Replica / WAL / PITR replication lag (production)
- Backup last success timestamp and restore drill age
- Anomalies in RLS / permission denied error counts

Recommended initial alert thresholds are tuned via deployment load testing; fixed universal thresholds are avoided. However, rows in the DEFAULT partition, failed backups, migration checksum drift, and unexpected schema revisions are always actionable conditions.

## 9. Test Strategy

### 9.1 Migration Tests

- Zero-to-head migration on clean PostgreSQL 18.6
- Idempotency verification (second execution on head is a no-op)
- Checksum drift error on modified applied migration files
- Advisory lock behavior under two concurrent migrators
- Readiness returns false on unsupported schema revisions
- Full snapshot verification of constraints, indexes, policies, and privileges

### 9.2 Integration Test Database

CI uses PostgreSQL service containers. Each suite/worker provisions an isolated database cloned from a migrated template; transaction rollback alone is not sufficient for test isolation because roles, RLS, and DDL are also tested. Upon test completion, only verified test database names are dropped.

### 9.3 Critical Concurrency Tests

- Two schedulers convert the same due check into a single job.
- Two workers cannot claim the same job.
- A worker losing its lease cannot write state using an outdated fencing token.
- Multiple manual requests during an active job collapse into a single follow-up run.
- Results racing with pause/config/delete operations are recorded in history but not applied to active state.
- Racing duplicate FAIL executions open only a single incident.
- Race between maintenance completion and recovery does not generate duplicate or erroneous emails.
- Two notifiers claim the same delivery only once.
- Re-processing the same bucket in rollup does not duplicate aggregate metrics.

### 9.4 Query Plan Tests

On performance fixtures:

- 30-day history queries use partition pruning.
- Dashboard queries never perform sequential scans on raw `check_runs`.
- Due scheduler scans and queue claims utilize partial indexes.
- Maintenance lookups use the owner + target + time index.
- Public lookups hit only the digest unique index.

Due to query planner variability, CI does not pin exact cost figures; it catches critical "sequential scans across all partitions" and missing pruning patterns, while periodic benchmarks validate the real latency budget.

## 10. Implementation Sequence — Post-Approval

1. SQL migration runner, checksum ledger, and advisory lock
2. Roles, schemas, default privileges, and security helpers
3. Auth/core tables and RLS
4. Monitoring job/current/run/incident tables and partition helpers
5. Notification, outbox, public, prediction, and audit tables
6. Rollup, retention, and checkpoint infrastructure
7. Deterministic seeds and factories
8. Integration tests for RLS, ownership, constraints, migrations, and concurrency
9. Backup/restore local rehearsal and evidence documentation
10. Query plan and performance fixture verification

This sequence applies to subsequent prompts for migration code implementation; it is not executed during the current design round.

## 11. PostgreSQL References

- [Declarative partitioning and its limitations](https://www.postgresql.org/docs/18/ddl-partitioning.html)
- [Unique and primary key constraint behavior](https://www.postgresql.org/docs/18/ddl-constraints.html)
- [Online child index creation and attachment](https://www.postgresql.org/docs/18/ddl-partitioning.html#DDL-PARTITIONING-DECLARATIVE-MAINTENANCE)
- [Row security and backup caveats](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)
