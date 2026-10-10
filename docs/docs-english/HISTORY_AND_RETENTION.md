# History, Rollup, Availability, and Housekeeping Architecture

**Status:** Completed — implementation, correctness, and capacity closures verified

**Date:** 2026-10-10 17:27 +06:00

**Last Implementation Update:** 2026-10-10 19:02 +06:00

**Scope:** FR-HIST-001–008, AC-011, AC-035, AC-060–065, NFR-DATA-002

## 1. Purpose and Boundaries

This stage addresses three product requirements within a single, consistent data pipeline:

1. Returning the response-time graph for a check over the last day, week, and month with bounded overhead.
2. Calculating availability from observed health duration rather than run counts; not treating data gaps as downtime.
3. Executing partitioning, rollups, retention, and bounded purge tasks isolated from the primary monitoring pipeline as raw data grows.

This stage does not implement the React chart interface, SSE updates, the public status projection, or the predictor model. Those fall under Stages 14, 13, 15, and 16, respectively. Stage 12 completes the private API and persistence layer.

## 2. Invariant Product Semantics

### 2.1 Time Axis

- All persistent and external API timestamps are UTC.
- All intervals are half-open in the form `[from,to)`.
- `period=day|week|month` is pinned not to the client clock, but to a `to` instant derived from the PostgreSQL `transaction_timestamp()` of the history transaction. For exact rollup aggregation, the day/week `to` value is rounded down to the UTC minute, while the month `to` value is rounded down to the UTC hour; the actual transaction timestamp is additionally exposed as `generated_at`.
- The V1 client does not supply arbitrary historical `to` values. This ensures caching, query budgets, and cursor behaviors remain bounded.
- Runs missed while the server is down are never synthesized. That duration becomes `UNKNOWN/no data`; it is never backfilled as FAIL or DOWN.

### 2.2 Availability and Coverage

Availability is calculated solely from finalized `UP` and `DOWN` durations:

```text
observed_ms  = up_ms + down_ms
availability = observed_ms = 0 ? null : up_ms / observed_ms
coverage     = observed_ms / requested_window_ms
```

`UNKNOWN`, time with no data, and open `PROVISIONAL` duration do not enter the availability denominator. The response also returns `unknown_ms` and `provisional_ms`; the following invariant is preserved for every response and bucket:

```text
requested_window_ms = up_ms + down_ms + unknown_ms + provisional_ms
```

Ratios fall within the `0..1` range. When there is no data, availability is `null`, not `0`. Maintenance does not pause measurement and does not alter the availability formula.

### 2.3 Provisional / SUSPECT Resolution

The `PROVISIONAL` interval opened after the first failing observation is not a permanent availability result:

- if a subsequent accepted FAIL confirms the incident, it is finalized as `DOWN` starting from the initial failing observation;
- if a PASS arrives before the threshold is exceeded, that same duration is finalized as `UP`;
- if freshness is lost, or a pause or config change occurs, the unconfirmed segment is finalized as `UNKNOWN`.

The failed run remains in immutable history; only the availability classification is settled later.

### 2.4 Response-Time Samples

- Only stateful runs with `accepted_for_state=true` participate in the primary chart.
- Diagnostic runs for paused checks, stale-fence results, and other rejected runs serve as technical evidence but do not participate in the SLA/history chart.
- `total_ms` is the probe's observed end-to-end duration for both PASS and FAIL; thus both represent response-time samples.
- Each bucket carries `sample_count`, `response_sum_ms`, `min`, and `max`; the API derives the average via `sum/count`.
- A change in probe generation does not split the time series. Rollup rows are stored per generation, and the API aggregates all generations for the check within the window. The UNKNOWN interval produced during a config change is honestly reflected in coverage.

## 3. Existing Foundations and Gaps to Close

The existing revision 20 schema already incorporated the following sound foundations:

- monthly `monitoring.check_runs` and `monitoring.health_intervals` partitions;
- monthly minute and yearly hour rollup parent tables;
- separation between `open_health_intervals` and finalized `health_intervals`;
- owner/check/time indexes on run/history, health intervals, and rollups;
- `rollup_checkpoints` and the `site_monitor_housekeeper` role;
- DEFAULT partition safety net and future partition helpers.

Gaps that needed to be closed prior to implementation:

1. Absence of a production worker and source cursor to populate rollup tables.
2. Long open intervals whose finalization can occur days later can corrupt historical buckets; a time watermark alone is insufficient.
3. Although OpenAPI routes for history and incidents were defined, API/service implementations were missing.
4. The existing `resolution=minute|hour` field does not indicate the output bucket width.
5. The foreign key chain from `check_runs → jobs/attempts` and `incidents/segments/current-state/open-health/finalized-health → check_runs` blocks partition drops and bounded purges across documented differing retention horizons.
6. The historical meaning of the incident `group_id` filter relied on the check's current group membership; no group snapshot existed at incident opening.
7. There was no safe repair contract defined for automatic attach operations when data lands in the DEFAULT partition.

## 4. Component Architecture

```text
monitor worker transaction
  ├─ immutable check_run
  ├─ current state + open/finalized health interval
  └─ compact run evidence
              │
              ▼
housekeeping-worker (separate process, same Node.js monorepo)
  ├─ source discovery/checkpoints
  ├─ bounded minute rebuild ranges
  ├─ minute → hour aggregation
  ├─ partition pre-creation/default guard
  └─ retention + bounded purge
              │
              ▼
PostgreSQL rollup projection
              │
              ▼
Fastify history/incident API
```

The `housekeeping-worker` is not a separate product microservice: it is a deployment process without a public API or independent domain data. A separate process/container was chosen so that heavy aggregation, DDL, and purge operations do not exhaust the event loop or database connection pools of the probe dispatcher, API, or notification worker.

The worker operates solely under the `site_monitor_housekeeper` login/role, via a small, dedicated database pool. API or monitor readiness does not depend on housekeeper readiness; if the history projection lags excessively, only the history endpoint returns a controlled error.

## 5. Forward-Only Revision 21 Applied

Revision 21 introduced the following foundation without mutating already-applied migrations:

### 5.1 Long-Lived Run Evidence

`monitoring.run_evidence` provides the bounded run summary required over extended lifespans by current state, incident, and health-interval lineage:

| Field | Description |
| ----------------------------------------- | ------------------------------------------ |
| `owner_id, check_id, finished_at, id`     | Composite primary key and original run locator |
| `outcome`, `failure_category`, `total_ms` | Bounded evidence summary                   |
| `recorded_at`                             | Initial persistence timestamp              |
| `created_at`                              | Evidence row timestamp                     |

Every accepted stateful run idempotently writes an evidence row within its state effect transaction. Run locator foreign keys from `check_current_states`, `incidents`, `incident_segments`, `open_health_intervals`, and `health_intervals` are re-pointed to this compact table. The migration first backfills evidence for existing references, verifies row counts and missing locators for each reference type, and only then updates foreign key constraints.

Evidence rows that are no longer referenced are deleted in bounded batches after a short grace period; rows referenced by incidents or current state are retained due to FK `RESTRICT`. This model preserves 400-day incident evidence while allowing large 90-day raw run partitions to be dropped cleanly.

The job/attempt IDs on `check_runs` remain as immutable trace locators but do not maintain persistent foreign keys to parent queue rows. Before dropping the FK, a new `BEFORE INSERT` lineage trigger/function validates owner/check/job/attempt alignment at insert time. Consequently, the 30-day purge of terminal jobs/attempts is decoupled from the 90-day raw run retention, while invalid new lineage continues to be rejected at the database level.

### 5.2 Source Cursor and Bounded Rebuild Queue

`monitoring.rollup_checkpoints` is extended with the following typed cursor fields:

- source watermark (`recorded_at` or `finalized_at`),
- tie-breaker owner/check/source-time/id tuple,
- projection `data_through`,
- last success/error and monotonic revision.

The new `monitoring.rollup_rebuild_ranges` table carries owner/check, `MINUTE|HOUR`, aligned `[range_start,range_end)`, `next_bucket_start`, reason, retry metadata, and a stable source fingerprint. A long health interval observation transaction does not write thousands of buckets; the source scanner generates a single range, and the worker subdivides that range into small bucket batches.

To ensure cursor scans do not grow linearly with the number of partitions, Revision 21 adds a partial discovery index on accepted runs for `(recorded_at,owner_id,check_id,finished_at,id)`, and a discovery index on finalized intervals for `(finalized_at,owner_id,check_id,started_at,id)`. The index ordering mirrors the cursor tuple and is validated via `EXPLAIN` capacity gates.

Range processing does not involve external SMTP-like claim states. A single `security_api.process_rollup_range(batch_size)` transaction selects the range using `FOR UPDATE SKIP LOCKED`, recomputes deterministic buckets, upserts them, and advances progress. If the process dies, the transaction rolls back; even if two replicas write the same bucket, source recomputation combined with a unique PK yields identical results.

### 5.3 Incident Opening Snapshot

`monitoring.incidents.group_id_at_open` is added as a nullable composite foreign key. A new incident snapshots the current group ID under the check lock at opening. Existing incidents are backfilled on a best-effort basis with their current group; it is explicitly documented that historical group fidelity cannot be fabricated for pre-migration incidents.

This field is intended solely for filtering and explanatory presentation. Notification policy and maintenance window decisions continue to evaluate their respective defined current/snapshot rules.

### 5.4 Partition Retention Manifest

`infra.partition_retention_runs` records parent, child, boundary, row count, detach/drop timestamp, status, and bounded error codes. It does not replace an audit log for partition removal; it serves as an operational replay and evidence record. A unique constraint ensures only a single active operation exists per child partition.

### 5.5 Privilege Boundaries

The housekeeper is not granted blanket DML on tables. Instead, narrow `security_api` functions are provided:

- source discovery + range enqueue,
- bounded rollup range process,
- partition ensure/status,
- bounded retention/purge step,
- projection readiness/status.

The API reads rollup, interval, and incident tables strictly under existing owner RLS. Cross-owner check or incident IDs return `404`, indistinguishable from non-existent resources.

## 6. Rollup Data Pipeline

### 6.1 Source Discovery

Two independent cursors are utilized:

1. New accepted runs are identified in `check_runs.recorded_at` order, and the minute ranges they touch are enqueued.
2. New finalized intervals are identified in `health_intervals.finalized_at` order, and the intersecting minute ranges are enqueued.

The cursor ordering is not a timestamp alone; it is the full tuple `(watermark,owner_id,check_id,source_time,id)`. Range insertion and cursor advancement execute within the same transaction. A crash rolls back both operations; re-reading does not generate duplicate side effects due to idempotent fingerprints and unique constraints.

At cutover, cursors are initialized at the start of the retention window and existing sources are backfilled through the identical pipeline. Periods lacking historical raw runs but possessing finalized intervals continue to generate availability; latency samples naturally remain empty.

### 6.2 Minute Recompute

Every minute bucket is completely recomputed from the source-of-truth:

- run count / latency: accepted runs that finished within the bucket;
- duration: intersection of finalized intervals and the bucket clipped via `greatest(start)` / `least(end)`;
- generation: preserved in the storage PK, aggregated across all generations by the API;
- open intervals: never written to rollups; they are layered as a query-time overlay.

If no underlying source records remain for a given generation/bucket, stale projection rows are deleted. If the total `up+down+unknown+provisional` duration exceeds the bucket width, the transaction rolls back with an invariant error and raises an alert; data is never silently clamped.

### 6.3 Hour Rollup

Modified minute buckets enqueue the corresponding check/hour range at the end of the same transaction. Hour buckets are aggregated deterministically solely from minute rollups. The hour checkpoint never advances before the minute projection completes.

The hour rollup aggregates response min, max, sum, and count alongside duration fields. An average-of-averages is never computed.

### 6.4 Open Intervals and Recent Data Tail

The history query supplements the rollup projection with two bounded sources:

- subdividing `open_health_intervals` rows into query-time buckets over `[max(start,from),to)`;
- computing the short raw tail between the rollup watermark and `to` from accepted runs and finalized intervals.

The raw tail limit is a typed configuration setting: 15 minutes for minute sources and 2 hours for hour sources. If the projection lags further behind, the API will not fall back to scanning 30 days of raw data in the month view; it returns `503 history_projection_lagging` with a bounded `Retry-After`. The dashboard and check API remain fully operational.

If pending rebuild ranges intersect the requested window, the API performs on-the-fly source recomputations strictly within the configured tail budget; for larger pending rebuilds, the same controlled `503` behavior is triggered. Missing buckets are never silently presented as valid.

## 7. History API Contract

`GET /api/v1/checks/{check_id}/history?period=day|week|month` requires an active session, owner-scoped rate limiting, and RLS. The tombstone of a soft-deleted check remains accessible to its owner for history and incident queries throughout its retention period; the standard check config/list endpoints do not expose it as a live resource.

### 7.1 Fixed Output Budget

| Period  | Exact Window | Source | Output Bucket | Maximum Buckets |
| ------- | -----------: | ------ | ------------: | --------------: |
| `day`   |     24 hours | minute |   300 seconds |             288 |
| `week`  |   7×24 hours | minute |  1800 seconds |             336 |
| `month` |  30×24 hours | hour   |  7200 seconds |             360 |

The API contract retains the existing `resolution: minute|hour` field as the source resolution and adds a mandatory `bucket_seconds`. This allows charting consumers to know the exact bucket width without expanding the payload.

### 7.2 Response Fields

The top-level response includes at least the following:

- `check_id`, `period`, exact `from/to`;
- `resolution`, `bucket_seconds`, `generated_at`, `data_through`;
- `availability_ratio`, `coverage_ratio`;
- `observed_up_ms`, `observed_down_ms`, `unknown_ms`, `provisional_ms`;
- an ordered and exhaustive array of buckets.

Each bucket contains exact `from/to`, response-time average or `null`, sample count, the same four durations, availability/coverage, and a classification.

Classification is deterministic:

- no observed duration and no provisional duration: `UNKNOWN`;
- provisional duration only: `PROVISIONAL`;
- all observed duration belongs to a single class: `UP` or `DOWN`;
- multiple observed classes or observed + provisional: `MIXED`.

Gaps where no buckets exist are synthesized server-side; the frontend never infers missing array elements. Pre-creation periods, server outages, pauses, and retention cutoffs appear as UNKNOWN durations.

### 7.3 Consistency and HTTP Behavior

- The query runs within a single read-only `REPEATABLE READ` transaction pinned to a single database time anchor.
- `statement_timeout` is separately configured and bounded for history queries; timeouts do not exhaust the general API pool.
- Responses carry `Cache-Control: private, max-age=15, stale-while-revalidate=30` and `Vary: Cookie`; shared/public caching is forbidden.
- Parameter/contract errors yield `422`, checks inaccessible to the owner yield `404`, and projection lag yields `503`.
- Target URL, expected body, raw diagnostic data, and response bodies are excluded from history responses and logs.

## 8. Incident Journal API

### 8.1 List

`GET /api/v1/incidents` supports the following filters:

- `check_id`;
- `group_id` — matched against the `group_id_at_open` snapshot;
- `status=OPEN|CLOSED`;
- `started_before` and `ended_after` overlap filter;
- `limit` (default 50, maximum 100) and signed keyset cursor pagination.

The sort order is `(started_at DESC, id DESC)`. The cursor encodes owner ID, filter fingerprint, snapshot time, and the last boundary tuple via HMAC; replay across different filters or bit-level tampering is rejected. Offset pagination is not supported.

Each list item includes the check ID alongside the current/tombstone check display name, start / confirmation / resolution timestamps, status, observation mode, closure reason, observed duration, and wall-clock duration. The check display name does not claim to be a historical snapshot; incident timestamps and the group snapshot represent immutable historical facts.

### 8.2 Details and Durations

`GET /api/v1/incidents/{incident_id}` returns observed segments and gaps:

- `incident_segments` rows are classified as `OBSERVED_DOWN`;
- gaps between observed segments, as well as leading and trailing gaps, are synthesized as `UNOBSERVED` in the response-time projection;
- open observed segments are evaluated up to the `to` instant; open unobserved incidents accrue wall duration without increasing observed duration.

The `observed_duration_ms` value of a closed incident is immutable. For an open incident, only the `[started_at,to)` duration of the currently open observed segment is added to the sum of stored completed segments. `wall_duration_ms = effective_end - incident.started_at`; these two values intentionally diverge whenever data gaps occur.

## 9. Partition and Retention Policy

### 9.1 Default Retention

| Data | Minimum Retention | Purge Mechanism |
| ------------------------- | ---------------------: | -------------------------------------- |
| Raw check runs | 90 days | Monthly partition detach/drop |
| Finalized health interval | 400 days | Monthly partition detach/drop |
| Minute rollup | 35 days | Monthly partition detach/drop |
| Hour rollup | 400 days | Yearly partition detach/drop |
| Incident / segment | 400 days | Bounded owner/time delete |
| Terminal job / attempt | 30 days | Bounded delete; decoupled from run FK |
| Unreferenced run evidence | 2-day grace | Bounded anti-join delete |
| Referenced run evidence | Until reference removed | Protected by FK |
| Completed outbox | 30 days | Bounded delete |
| DEAD outbox | Until operator resolves | Never automatically deleted |

Because of partition granularity, retention is an enforced minimum: a monthly partition is dropped only after its entire boundary expires, and a yearly hour partition is dropped only once fully expired. As a result, physical data retention may exceed the configured day count, but will never fall short. This storage overhead is consciously preferred over risking dashboard inaccuracy and is surfaced in status and metrics.

### 9.2 Partition Lifecycle

- The housekeeper verifies the current month and at least the next three upcoming months daily.
- Partition DDL executes under a deployment-constant advisory lock, with `lock_timeout=5s` and an explicit statement timeout.
- The DEFAULT partition contains zero rows under normal operation. If rows are detected, it triggers a distinct high-priority metric/alert rather than failing process readiness.
- The standard loop does not attempt to attach partitions while the DEFAULT partition holds rows falling within the target range. A dedicated operator repair routine executes staged copy/delete/attach steps with row counts and checksum validation; failures are never suppressed.
- Child partitions reaching retention limits are first detached, recorded with boundary and row counts in the manifest, and dropped only after a configurable 24-hour grace period.
- Because `health_intervals` is partitioned by `started_at`, evaluating only the partition's upper boundary is insufficient. If `max(ended_at)` within a child partition is not older than the retention cutoff, the partition is not detached; the portion of an extended interval that remains within the retention window is preserved, and the retention delay is emitted as a metric.
- If active or legal hold requirements arise, an explicit deployment policy pausing partition drops can be applied; v1 intentionally avoids implementing mock legal-hold features.

### 9.3 Row Purging

Non-partitioned tables are purged in small batches via `(time,id)` keyset pagination. Each step adheres to a statement timeout, maximum row limit, and maximum wall-clock budget. Purging proceeds hierarchically from child to parent tables. Rows that cannot be deleted due to active FK references are not treated as errors; they are retried in subsequent cycles and tracked via age metrics.

## 10. Worker Runtime and Fault Isolation

`apps/housekeeping-worker` executes the following independent background loops:

1. source discovery / backfill;
2. minute / hour range processing;
3. partition pre-creation / default guard;
4. retention / row purge.

Each loop claims bounded batches of work, supports AbortSignal, and operates with a dedicated, jittered polling interval. The default DB pool size is 4, rollup concurrency is 2, and DDL concurrency is 1; all are configurable via typed configuration.

Worker readiness requires schema compliance, database connectivity, and at least one successful iteration across all four loops. A rollup source failure degrades housekeeper readiness without impacting the API, monitor, or notification services. Graceful shutdown prevents new processing steps, awaits active transactions up to a configured grace period, and cleanly closes database connection pools.

Two concurrent housekeeper replicas are supported. `SKIP LOCKED`, deterministic upserts, and partition advisory locks guarantee that concurrent executions cannot produce corrupt or invalid state. There is no claim of exactly-once execution; behavior is strictly idempotent.

## 11. Security, Privacy, and Observability

- History and incident queries execute exclusively within transaction-local authenticated owner contexts.
- The housekeeper cannot read user sessions/credentials, notification recipients, or public tokens.
- URLs, check names, email addresses, response bodies, and raw diagnostics are never exposed in logs or metrics.
- High-cardinality owner, check, or incident IDs are never used as metric labels; if correlation is required, HMAC fingerprints are logged.
- Recommended metrics: source cursor lag, pending range count / oldest age, processed bucket rate, API raw-tail width, projection-lag 503 counts, DEFAULT partition row count, future partition horizon, retention overdue partition / row count, and loop failure codes.
- Rebuild and purge logs record processor, resolution, bounded row/bucket counts, duration, and sanitized result codes.

## 12. Performance Budgets

Warmed reference environment targets:

- 30-day history DB query work for a single check: p95 `<500 ms`;
- History endpoint including HTTP parse and serialization: p95 `<2 s`;
- Incident list: p95 `<500 ms`;
- Output limited to a maximum of 360 buckets with a bounded response payload size;
- Monthly query plan mandates partition pruning and utilization of hour rollup indexes;
- Scanning 30 days of raw `check_runs` is strictly prohibited.

The reference benchmark dataset reflects an equivalent distribution of at least 500 checks × 30-second cadence × 35 days. Rather than generating millions of rows on every CI execution, compact correctness fixtures are mandatory for standard CI, while the massive deterministic SQL dataset runs under a dedicated `test:history-capacity` profile. The benchmark hardware/CPU/RAM/PostgreSQL version and `EXPLAIN (ANALYZE, BUFFERS)` summaries are preserved in the capacity report. If performance budgets are exceeded, the feature is not declared successful; measurements and bottlenecks are reported honestly.

The closing capacity profile validated source discovery and the minute→hour pipeline across 20, 200, and 500 checks; verified the 35-day distribution with 420,000 hour rows equivalent to 50.4 million raw samples; and confirmed private API isolation under housekeeper load. The 500-check projection took 9.54 seconds, the month service query took 25.32 ms, and the underlying query plan execution was 4.568 ms; the query scanned a single yearly partition using indexes and returned exactly 360 buckets. Full details are documented in [`HISTORY_CAPACITY_REPORT.md`](./HISTORY_CAPACITY_REPORT.md).

## 13. Mandatory Testing and Acceptance Matrix

### 13.1 Domain and Correctness

- identical timelines yielding identical availability regardless of check interval cadences;
- clipping of `UP/DOWN/UNKNOWN/PROVISIONAL` across bucket boundaries;
- resolving provisional periods for FAIL→PASS transitions to UP, and FAIL→FAIL transitions to DOWN starting from the initial FAIL;
- server downtime gaps, check pauses, and periods prior to check creation not depressing availability;
- open interval query-time overlay and proper separation between observed and wall-clock durations for open incidents;
- proper aggregation across config generation shifts and honest presentation of UNKNOWN gaps;
- strict avoidance of computing an average-of-averages.

### 13.2 PostgreSQL and Concurrency

- atomic source cursor advancement and range enqueueing within the same transaction, with crash replay validation;
- bounded range advancement for lengthy finalized intervals;
- convergence of two workers executing over the same range or partition;
- minute corrections triggering hour rollup recomputations;
- resumption of cursors and ranges following service restarts;
- run evidence migration/backfill and preservation of FK integrity for incidents, current state, open health, and finalized health during raw partition detachment;
- preservation of raw run trace locators after purging terminal jobs and attempts;
- DEFAULT partition guards and maintenance of a three-month future partition horizon;
- idempotency of retention grace periods and manifest logging;
- enforcement of RLS hiding history, incidents, and rollups across tenant owners.

### 13.3 API

- exact `to` boundaries, expected bucket counts, and contiguous sequences across day, week, and month views;
- no-data scenarios yielding `null` availability with accurately reduced coverage;
- incident cursor filter-binding, anti-tampering protection, and group-at-open filtering;
- history retrieval for soft-deleted check tombstones;
- bounded 503 responses during projection lag without impacting dashboard operations;
- negative assertions confirming absence of sensitive data in responses and logs.

### 13.4 Capacity

- Rollup throughput profiling across 20, 200, and 500 checks;
- Month query performance evaluated on synthetic 35-day distributions equivalent to 500 checks;
- Verification of API database pool and latency isolation during concurrent housekeeper execution;
- Proof of partition pruning and enforcement of the 360-bucket maximum.

## 14. Implementation Slices

1. **Revision 21 + Pure Aggregation — Completed (17:44):** Run evidence and FK/retention refactoring, checkpoint/range/manifest schema, duration/bucket domain functions, and migration safety tests.
2. **Housekeeping Runtime — Completed (17:52):** Source discovery, bounded minute/hour recomputations, partition/default guard, retention/purge loops, readiness checks, and restart / two-replica concurrency tests.
3. **Private API — Completed (18:29):** Canonical OpenAPI history/incident contract, owner-scoped services/routes, tombstone accessibility, filter-bound cursor pagination, bounded raw-tail overlay, and projection-lag handling.
4. **Closing Verification — Completed (19:02):** Correctness matrix, 20/200/500 rollup capacity profiles, 35-day history capacity/plan report, API–housekeeper runtime isolation, full CI suite, and status documentation.

Each slice is captured in distinct granular commits. Revisions 21–26 were applied forward-only without mutating existing migration files. Revision 26 introduced the narrow `security_api.history_projection_status` boundary returning owner-scoped projection status without granting the API direct SELECT permissions on housekeeping tables. Retention fails closed and is deferred whenever source scan horizons lag or pending rebuild backlogs exist. Retention first executes a detach step and logs a manifest record; physical dropping occurs only in a subsequent cycle after the 24-hour rollback grace period has expired.

## 15. Deliberately Out of Scope

- User-defined arbitrary date ranges and timezone-aligned calendar reports;
- Percentile histograms, t-digest tracking, and SLA contract management;
- Excluding recurring maintenance windows from availability calculations;
- Public history and incident projections;
- Cold object storage archiving and analytical data warehouses;
- Legal-hold user interfaces;
- Cross-region rollup replication.

These items are not introduced into the existing data model via stub fields. Should product requirements demand them, they will require dedicated API contracts, migrations, and capacity assessments.
