# Durable Scheduler and Monitor Worker Architecture

**Stage:** 9 — Durable Scheduler and Monitor Worker

**Status:** Completed — production runtime, 20/200/500 capacity, process-kill/fencing, and two-worker/API-isolation proofs verified

**Date:** 2026-10-10 15:00 +06:00

**Referenced documents:** [`REQUIREMENTS.md`](./REQUIREMENTS.md), [`ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`STATE_MACHINES.md`](./STATE_MACHINES.md), [`DATABASE.md`](./DATABASE.md), [`DATABASE_OPERATIONS.md`](./DATABASE_OPERATIONS.md), [`CHECKS_AND_GROUPS.md`](./CHECKS_AND_GROUPS.md), [`CHECK_ENGINE.md`](./CHECK_ENGINE.md), [`HEALTH_AND_INCIDENT_ENGINE.md`](./HEALTH_AND_INCIDENT_ENGINE.md), [`EVENT_CATALOG.md`](./EVENT_CATALOG.md)

## 1. Purpose

This stage connects the secure probe engine from Stage 7 and the pure health/incident reducer from Stage 8 to the actual monitor worker pipeline via a durable PostgreSQL queue.

Upon completion of this stage, the system:

- schedules active checks with a fixed cadence;
- executes manual jobs in a durable and coalesced manner;
- prevents the same check from running concurrently with itself under normal conditions;
- enforces secure claim, lease, heartbeat, and fencing across multiple worker replicas;
- holds no database transactions or row locks open during a probe;
- atomically persists results alongside run, current state, interval, incident, segment, and outbox;
- resumes from the current time without backfilling missed ticks after worker/server downtime;
- preserves monitoring gaps as `UNKNOWN/no-data` rather than fabricating target failure.

This stage constitutes the primary monitoring path. A failure in the scheduler or persistence adapter is never fabricated as a target `FAIL` and does not generate false incidents.

## 2. Scope and Non-Goals

### 2.1 Scope of Stage 9

- Periodic due-check materialization
- Manual intent materialization and coalesced consumption
- Cadence, catch-up, and no-backfill calculation
- PostgreSQL job claim and multi-worker coordination
- Lease, heartbeat, fencing token, and stale attempt semantics
- Job cancellation request and worker acknowledgement protocol
- Global, owner, and hostname bounded concurrency
- Owner-fair candidate selection
- Probe engine orchestration and cancellation
- Separation of target outcomes from infrastructure faults
- Run/observation transaction and Stage 8 effect applier
- Freshness deadline reconciler
- Lease recovery, retry/backoff, DEAD, and restart behavior
- Graceful shutdown/drain
- Redacted logging, queue-lag, and worker lifecycle signals
- Concurrent worker, kill/recovery, and 20/200/500 capacity proofs

### 2.2 Deferred to Subsequent Stages

- Maintenance CRUD and post-maintenance reconciliation: Stage 10
- Notification intent/delivery and SMTP: Stage 11
- History API, rollup, and retention: Stage 12
- SSE/outbox consumer and live dashboard: Stages 13–14
- Public projection: Stage 15
- Prediction consumer: Stage 16
- Production metric exporter, alerting, and system-wide closure of runbooks: Stage 17

Stage 9 evaluates event facts according to the routing policy in the catalog. It writes transactional outbox events/dispatches only for durably activated destinations. If downstream consumers are not yet implemented, unbounded `PENDING` backlog is not generated and the monitoring transaction still completes; no SMTP, SSE, or predictor invocations are made.

## 3. Requirements Traceability

| Requirement     | Stage 9 Fulfillment                                                                          |
| --------------- | -------------------------------------------------------------------------------------------- |
| AC-023–028      | Pause/resume, manual stateful/diagnostic, generation, and coalescing rules                   |
| AC-030/031      | Single active job invariant, cancellation acknowledgement, and concurrency testing           |
| AC-032/033      | PostgreSQL claim, attempt guard, lease, and monotonic fencing token                          |
| AC-034          | Process kill, lease expiry, and retry/reclaim                                                |
| AC-035/036      | Fixed cadence, single catch-up job, no backfill; manual does not alter cadence               |
| AC-037          | Probing outside transactions; global/owner/host concurrency and independent cancellation     |
| AC-040–048      | Connecting Stage 8 reducer to the real PostgreSQL observation transaction                    |
| AC-062          | Deadline reconciler and read-time freshness ensuring gaps are not treated as DOWN           |
| AC-080/081      | 20/200/500 check profiles and measured queue lag using the exact same algorithm              |
| AC-082/083      | Bounded concurrency and owner-fair candidate ordering                                        |
| AC-084          | Entire schedule/job/state truth is durably persisted in PostgreSQL                          |
| AC-100–102      | Stage 7 secure probe engine and redacted worker boundaries                                   |
| NFR-REL-001–004 | Crash recovery, idempotent results, atomic state, and external service isolation             |
| NFR-OPS-001/002 | Worker identity, health, structured logs, and queue/freshness metrics                        |

## 4. Existing Foundation and Gaps to Close

The existing system provides the following foundation:

- `app.checks`: cadence, `next_run_at`, manual intent, and check-scoped fencing counter
- `monitoring.check_jobs`: durable queue and per-check partial unique active-job invariant
- `monitoring.check_job_attempts`: attempt/fencing lineage and result guard
- Partitioned `monitoring.check_runs`
- Current-state, health interval, incident, and segment tables
- Transactional outbox and destination dispatch tables
- Stage 7 immutable snapshot decoder and probe engine
- Stage 8 pure observation/freshness reducer
- Dedicated RLS policies and narrow service role for `site_monitor_monitor`

Logical gaps that must be closed prior to implementation:

1. The monitor worker currently sets up only the probe engine and health endpoint; no scheduler loop exists.
2. The existing draft lock order of job→check can deadlock with API commands that use check→job.
3. The API currently sets running jobs directly to `CANCELLED`. Before the network request terminates, the partial unique invariant could be prematurely released, causing a physical overlap with a new job.
4. `manual_requested_at` does not durably preserve the `STATEFUL/DIAGNOSTIC` mode of the initial coalesced manual intent.
5. While `result_recorded_at` guards attempt results, the attempt row lacks an exact result pointer containing the partition key; bounded lookup cannot be guaranteed across an expanding partitioned history using only `attempt_id`.
6. Several rejection/cancellation enum values exist in the application contract but lack DB allowlist enforcement.
7. Scheduler, retry, concurrency, and freshness parameters are not yet included in typed runtime config.

These gaps are closed via forward-only revision 14+ without modifying previously applied migrations.

## 5. Component Boundaries

```text
Monitor worker process
├── Due scheduler
├── Pending-job dispatcher
├── Lease recovery loop
├── Freshness reconciler
├── Active probe registry + bounded semaphores
├── Probe engine adapter
├── Observation persistence adapter
└── Health/readiness server

PostgreSQL
├── app.checks                    cadence + manual intent + fence source
├── monitoring.check_jobs         durable queue
├── monitoring.check_job_attempts lease/attempt lineage
├── monitoring.check_runs         immutable target results
├── monitoring current/history    health + incident source of truth
└── infra.outbox_*                downstream durable facts
```

Boundaries:

- Scheduler SQL never calls the probe engine.
- The probe engine has no knowledge of PostgreSQL.
- The pure reducer performs no ID generation, DB operations, clock lookups, logging, or network I/O.
- The persistence adapter does not reinterpret reducer decisions; it applies typed effects and verifies affected row counts.
- HTTP probes, SMTP, SSE, and prediction never execute within any DB transaction.
- PostgreSQL queue is the source of truth; the active registry in process memory is ephemeral and reconstructible state.

## 6. Runtime Loops and Fault Isolation

The worker runs four independent, abortable loops within the same process:

1. **Due scheduler:** generates a bounded batch of scheduled jobs from due checks.
2. **Dispatcher:** discovers pending jobs up to available concurrency slots, claims them, and launches probe tasks.
3. **Lease recovery:** transitions expired leased/running jobs to retry, cancel, or DEAD.
4. **Freshness reconciler:** durably transitions expired FRESH states to STALE at the exact `fresh_until` timestamp.

Each loop:

- does not run re-entrantly within a single process;
- operates with bounded batches;
- proceeds immediately when work is found, and applies bounded polling/backoff when idle;
- logs unexpected errors without silently halting the process;
- conforms to a shared shutdown signal;
- tracks in process memory whether each loop has completed at least one successful iteration and whether it is currently in an error state for readiness reporting.

A transient DB failure in one loop does not corrupt the state of another loop. During a database outage, all loops transition to bounded backoff; liveness remains healthy while readiness reports `unavailable`.

## 7. Authoritative Time and Cadence

Domain timestamps originate strictly from PostgreSQL. The worker host clock is not authoritative for:

- job available/due comparisons;
- lease acquisition/expiry;
- attempt start/completion;
- run `finished_at`;
- health/incident transition times;
- freshness reconciliation.

Probe phase durations are measured using a monotonic process clock; these do not establish wall-clock ordering.

### 7.1 Fixed Cadence Calculation

For a given check:

```text
anchor   = cadence_anchor_at
interval = interval_seconds
now      = canonical DB time
next     = anchor + (floor((now - anchor) / interval) + 1) * interval
```

`next` is strictly greater than `now`. If `now < anchor`, the first valid anchor/slot is used. This calculation is a pure function tested against boundaries, prolonged downtime, and interval modifications.

When materializing a scheduled job:

- `scheduled_for` is the check's previous `next_run_at` value at the start of the transaction;
- only a single job is materialized;
- `next_run_at` jumps forward to the earliest cadence slot strictly after `now`;
- separate jobs are not created for intermediate missed ticks;
- manual jobs do not alter this calculation or the `next_run_at` value.

Initial create/resume/probe-change jitter is preserved via the persistent `next_run_at` established in Stage 6. Subsequent slots advance via `cadence_anchor_at` without drift.

### 7.2 Long Execution and Downtime

If a scheduled job runs longer than its interval, no new scheduled job is created. Once the active job reaches a terminal state, if the check is still due, at most one catch-up job is produced and `next_run_at` is advanced again to the next future slot.

During server downtime, no runs are generated. Following restart, at most one job is created for an overdue check; the downtime period remains in history as a no-data gap.

## 8. Job Materialization

### 8.1 Scheduled Job

The due scheduler reads candidates in an owner-fair, bounded manner. Each materialization is a short transaction:

1. Lock the check row using `FOR UPDATE SKIP LOCKED`.
2. Verify that it remains `LIVE + ACTIVE`, `next_run_at <= now`, and has no active jobs.
3. Generate a versioned immutable snapshot from current config/version/generation values.
4. Insert a `PENDING + SCHEDULED` job.
5. Advance `next_run_at` to the earliest future cadence slot.
6. Write any required redacted job-available audit/event entries and commit.

The partial unique constraint `(owner_id, check_id) WHERE status IN ('PENDING', 'LEASED', 'RUNNING')` serves as the final concurrency barrier. A constraint conflict cannot leave a partial commit that advances the check schedule.

### 8.2 Manual Job and Coalesced Intent

If no active job exists, a `PENDING + MANUAL` job created by the API is directly consumed by the dispatcher.

If an active job already exists, the initial manual intent is recorded using two fields:

- `manual_requested_at`
- `manual_requested_mode`

Both fields must be either simultaneously null or simultaneously populated. The timestamp and mode of the initial pending intent are immutable; subsequent manual requests coalesce into this intent, and receipts reflect the persistent mode of that recorded intent.

When the active job transitions to a terminal state within the same check transaction:

1. Pending manual intent is re-evaluated.
2. If the check has not been deleted, a single manual job is created using the current config/generation snapshot.
3. The stored mode is copied to the new job.
4. The manual intent fields are cleared.

If a manual job is materialized after a config change, it uses the latest config snapshot while preserving the mode requested at invocation time. Deletion clears any pending intent. An ACTIVE→PAUSED command clears any STATEFUL intent that has not yet become a job; if a user requests a run while PAUSED, they explicitly receive a DIAGNOSTIC job.

Any manual intent left without an active job due to a crash or legacy code is materialized by a separate reconciliation branch of the due scheduler following the same rules.

### 8.3 Priority

- Manual jobs carry higher priority than scheduled jobs.
- If a check has a pending manual intent, the manual intent is materialized prior to any due scheduled job.
- Owner fairness prevents starvation ahead of priority; within a given owner, manual jobs precede scheduled jobs.
- Priority never overrides the single active job invariant per check.

## 9. Job and Attempt Lifecycle

```text
PENDING ──claim──> LEASED ──start──> RUNNING ──target result committed──> COMPLETED
   │                 │                  │
   │                 │                  ├─cancel request──> RUNNING + cancel_requested
   │                 │                  │                         │
   │                 │                  │                         └─ack/recovery──> CANCELLED
   │                 │                  │
   │                 └─lease expiry─────┴─> PENDING / DEAD / CANCELLED
   │
   └─config/pause/delete before claim────────────────────────────> CANCELLED
```

Both target `PASS` and target `FAIL` represent successful execution from the job's perspective and transition to `COMPLETED`. `DEAD` is reserved strictly for repeated or permanent infrastructure faults where no probe result can be produced.

### 9.1 Cancellation Request

After locking the check row, the API:

- may directly transition a `PENDING` job to terminal `CANCELLED`;
- sets `cancellation_requested_at` and an allowlisted `cancellation_reason` on `LEASED/RUNNING` jobs;
- leaves leased/running jobs in an active state until worker acknowledgement or lease recovery completes.

This prevents the partial unique invariant from being released before the network request actually terminates. When the worker heartbeat detects a cancellation request, it triggers the probe's `AbortSignal`; a brief acknowledgement transaction transitions both the attempt and the job to `CANCELLED`.

If the worker has crashed, lease recovery transitions an expired job with an outstanding cancellation request to `CANCELLED` rather than retrying it. Following config/pause/delete, a stale target result is never admitted into the new state.

### 9.2 Infrastructure Fault

- `UNSUPPORTED_JOB_SNAPSHOT`: permanent; job becomes `DEAD`.
- `ENGINE_ERROR`: bounded retry/backoff; transitions to `DEAD` if retry budget is exhausted.
- Lease/cancellation-driven `CANCELLED`: does not produce a target run.
- DB transaction/partition/constraint errors: not a target `FAIL`; routes to result persistence retry or job recovery.

Target timeout, DNS, connect, TLS, blocked target, status mismatch, and body mismatch are typed target `FAIL` outcomes from Stage 7; they are recorded as runs and, if stateful, feed into the health reducer.

## 10. Single Canonical Lock Ordering

Across all check-scoped worker and API operations, the mandatory lock order is:

1. `app.checks`
2. `monitoring.check_jobs`
3. `monitoring.check_job_attempts`
4. `monitoring.check_current_states`
5. `monitoring.incidents`
6. `monitoring.incident_segments`
7. `monitoring.open_health_intervals`
8. immutable history inserts
9. outbox/audit

When multiple checks must be locked, locks are acquired in ascending UUID order.

The prior draft job→attempt→check sequence from Stage 8 is rectified by this document. Because the API already operates in check→job order, the worker is brought into alignment, eliminating bidirectional wait cycles.

### 10.1 Separation of Candidate Query and Lock Transaction

The dispatcher first performs a lock-free, bounded query for candidate IDs. When claiming a candidate, it opens a new short transaction:

1. Lock the check using `FOR UPDATE SKIP LOCKED`.
2. Lock the corresponding job using `FOR UPDATE`.
3. Re-verify that the job remains claimable.
4. Record fencing, lease, and attempt updates.

Locking the pending job first and subsequently waiting on the check is strictly forbidden. Candidate reads may be stale; in-transaction re-verification is authoritative.

The heartbeat conditionally updates only its own job row and requires no lock on the check row. This brief single-row operation does not form deadlock cycles with operations utilizing the check→job order.

## 11. Claim, Lease, Heartbeat, and Fencing

### 11.1 Claim Transaction

After allocating an available execution slot, the worker:

1. Locks the check and pending job in canonical order.
2. Allocates and atomically increments `next_fencing_token` on the check for the new attempt.
3. Transitions the job to `LEASED`, increments `attempt_count`, and writes owner, expiry, heartbeat, and fence.
4. Inserts a row into `check_job_attempts` with the matching attempt number and fencing token.
5. Commits.

The fence is a check-scoped monotonic `bigint`; it is never generated from worker process counters or wall clocks.

Following snapshot decoding and pre-start validations, the job transitions to `RUNNING` under the same owner/fence condition. If a cancellation request was recorded in the interim, acknowledgement executes before the probe begins.

### 11.2 Lease Duration

The initial lease duration is bounded and computed as:

```text
snapshot.timeout_ms + MONITOR_LEASE_GRACE_MS
```

The heartbeat interval must not exceed one-third of the grace duration. Upon a successful heartbeat, the lease is extended by the same bounded period.

The worker also enforces a conservative local deadline derived from the latest successful DB heartbeat. If lease ownership cannot be confirmed before expiry, the probe is aborted, and no attempt is made to apply results to state.

### 11.3 Heartbeat Condition

A heartbeat update returns a row only under the following conditions:

- job status is `LEASED` or `RUNNING`;
- `lease_owner` matches the worker instance ID;
- `fencing_token` matches the attempt;
- the lease remains valid according to current DB time.

The response also returns cancellation fields. Zero affected rows indicates lease loss; raw DB errors are not converted to target failures.

### 11.4 Acceptance Guarantees

The system does not guarantee mathematical exactly-once HTTP calls to external targets. During process partition or lease expiry, an old zombie request and a new attempt may briefly overlap physically. The system guarantees:

- single active execution during normal interval and slow-target flows;
- single active durable job per check;
- strictly increasing fences on every claim;
- at most one run record per attempt;
- only current, unexpired results bearing the highest valid fencing token are admitted into state.

## 12. Fairness and Concurrency

### 12.1 Owner-Fair Ordering

The candidate query partitions the eligible pending set by owner to assign rankings, applying the global batch limit only after ordering:

```text
owner_rank = row_number() over (
  partition by owner_id
  order by priority desc, available_at, created_at, id
)

global order = owner_rank, priority desc, available_at, owner_id, id
```

This sequence evaluates the first job of each owner, followed by their second jobs, and so forth. Applying a global FIFO limit before computing owner rank is forbidden, as such a pre-limit allows a single large owner to monopolize the entire candidate batch. A single large owner cannot permanently starve a small owner. For due materialization, the same principle is applied over `next_run_at, id`.

The query plan is verified on PostgreSQL using `EXPLAIN (ANALYZE, BUFFERS)`. If necessary, partial indexes supporting owner + minute ordering are introduced in revision 14; wide indexes are never added without measured justification.

### 12.2 Bounded Semaphores

Prior to claiming, the worker acquires three process-local semaphore slots:

- global probe slot;
- owner slot;
- target hostname slot.

The hostname is parsed from the snapshot URL but is never logged or used as a metric label. In-memory keys may be process-secret HMAC fingerprints. A candidate lacking an available slot is not leased; the scan continues with other owner/host candidates within the same batch.

Baseline reference values:

| Config                          | Default | Constraint / Semantics             |
| ------------------------------- | ------: | ---------------------------------- |
| `MONITOR_GLOBAL_CONCURRENCY`    |      64 | Total probes per process           |
| `MONITOR_PER_OWNER_CONCURRENCY` |      32 | Per-owner upper bound per process  |
| `MONITOR_PER_HOST_CONCURRENCY`  |       4 | Per-host upper bound per process   |
| `MONITOR_CANDIDATE_BATCH_SIZE`  |     128 | Per dispatcher scan batch          |
| `MONITOR_SCHEDULE_BATCH_SIZE`   |      64 | Per due materialization round      |

Values must be positive, mutually consistent, and validated fail-fast at startup. There is no hardcoded product limit of `50`.

Per-owner and per-host hard caps are process-local in v1; across multiple replicas, the effective upper bound multiplies by replica count. Cluster-wide owner fairness is preserved via the database candidate ordering. If measurements indicate a strict cluster-wide politeness limit is required, an expiring shared token/slot table will be added via separate migration and ADR; holding advisory locks and exhausting DB connections across long probes is prohibited.

### 12.3 DB Connection Pool

No DB connection is held while a probe is executing. Pool size does not scale 1:1 with probe concurrency; it is sized independently for the scheduler, heartbeat, and short persistence bursts. The reference baseline is 8 connections, and the total PostgreSQL connection budget is documented alongside replica count.

## 13. Probe Execution

Each claimed task executes as follows:

1. Decodes the versioned snapshot using the strict decoder.
2. Converts job/attempt metadata into an immutable execution context.
3. Instantiates a job-scoped `AbortController`.
4. Starts the heartbeat/cancellation monitor.
5. Invokes `ProbeEngine.run` from Stage 7 outside any database transaction.
6. Produces either a target result or a typed infrastructure fault.
7. Stops the heartbeat and executes the result/fault transaction.
8. Releases global, owner, and host semaphore slots in a `finally` block.

Task exceptions do not crash the worker loop or impact other running probes. A promise registry tracks all active tasks; no unhandled rejections are left floating.

The worker identity is an ephemeral instance identifier such as `monitor-worker:<UUID>` that changes upon restart, containing no secrets or hostnames. Job, attempt, run, check, and incident IDs are used strictly for structured log correlation, never as high-cardinality metric labels.

## 14. Observation Persistence Transaction

Once the target result is received, a single short transaction executes:

1. Lock the check.
2. Lock the job and attempt.
3. If attempt `result_recorded_at` is populated, locate the existing run in the appropriate partition via the `(result_run_finished_at, result_run_id)` pointer and return idempotently without writing new events.
4. Lock current-state, open incident/segment, and open interval in canonical order.
5. Compute canonical `finished_at` at millisecond resolution, strictly greater than DB current time, attempt start, and any previous accepted run.
6. Evaluate the attempt-current input based on job state, owner, fence, and lease expiration at the exact time of DB observation.
7. Generate UUIDv7 allocations for run, incident, segment, and interval within the adapter.
8. Execute the Stage 8 reducer with the immutable snapshot.
9. Insert the immutable `check_runs` row reflecting the acceptance decision.
10. Apply current-state, interval, incident, and segment effects.
11. Write canonical event/outbox records and dispatches.
12. Atomically update attempt fields `result_recorded_at + result_run_finished_at + result_run_id`; record `RESULT_RECORDED` for current/non-terminal attempts without altering the terminal reason of previously terminal stale attempts.
13. If the job is current, transition it to `COMPLETED`; otherwise, leave new attempt/job state untouched.
14. If pending manual intent exists, materialize it within the same transaction.
15. Commit.

Every SQL effect verifies its expected row count. An invariant violation or row count mismatch rolls back the entire transaction; target results are never converted into false FAILs.

### 14.1 Definition of Attempt-Current

`attemptCurrent=true` holds strictly when all of the following conditions are met:

- the job still carries this attempt's `lease_owner + fencing_token`;
- the job is in `LEASED` or `RUNNING` status without a cancellation request;
- the lease has not expired according to canonical DB time;
- the attempt is not terminal;
- check/job lineage matches.

This check is independent of generation and lifecycle acceptance. The reducer subsequently enforces canonical precedence.

### 14.2 Run Idempotency

`check_job_attempts.result_recorded_at` guards against multiple result transactions per attempt. Global unique attempt constraints are not simulated on the partitioned run table. Because the attempt row lock, insert, and result marker reside in the same transaction, a second concurrent writer cannot create a duplicate run.

A nullable `(result_run_finished_at, result_run_id)` pair is added to the attempt row, governed by an all-or-nothing constraint with the result marker. Because this pair contains the partition key and identifier of the run, duplicate replays execute a direct `(owner_id, check_id, finished_at, id)` primary key lookup without scanning all monthly partitions. The attempt pointer is updated in the same transaction after inserting the run; deferred composite foreign keys verified by PostgreSQL preserve lineage at the database layer. Duplicate replays produce no secondary health, incident, or outbox effects.

`check_runs.finished_at` is never taken from the worker host clock. The adapter selects the maximum of `clock_timestamp()`, attempt `started_at + 1 ms`, and the previous accepted run `finished_at + 1 ms` (if present) evaluated on the locked snapshot. This guarantees that rapid successive transitions do not produce zero-length intervals or segments. Lease validity is determined based on the physical time of observation in the same query rather than this logical timestamp.

### 14.3 Run Content

Permitted for persistence:

- PASS/FAIL status, allowlisted failure category, and diagnostic code
- bounded phase and total durations
- HTTP status code and body-match boolean
- generation, fence, trigger/mode, and lineage identifiers

Never persisted:

- response body or response headers;
- raw socket or DNS errors;
- resolved IP addresses;
- expected substrings;
- target URLs or query parameters.

`diagnostic` stores only bounded allowlisted codes; exception messages and stack traces are never stored.

## 15. Reducer Effect Application

The adapter translates the Stage 8 plan according to the following mappings:

| Effect                   | SQL Behavior                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Current state            | Explicit column update on locked row; `state_version` must match plan              |
| Finalize interval        | Insert into partitioned history first; positive half-open interval required        |
| Set/rotate open interval | Explicit update/upsert on the same check primary key                               |
| Open incident            | Insert incident and initial segment with run foreign keys                          |
| Update incident failure  | Update latest failure and resource version                                         |
| Suspend incident         | Close segment + record observed duration + transition to UNOBSERVED                |
| Resume incident          | Insert new open segment + transition to OBSERVED                                   |
| Close incident           | Close active segment if present; transition incident to terminal                   |
| Event facts              | Canonical catalog payloads + corresponding destination dispatches                  |

The adapter never introduces transitions that were not produced by the reducer. In particular, repeated DOWN FAIL observations do not create duplicate incidents or redundant DOWN notification events.

### 15.1 Event Destinations

Destination routing defined in the catalog:

| Event Family                             | Destination               |
| ---------------------------------------- | ------------------------- |
| `check.run_recorded`                     | `PREDICTION`              |
| `check.observation_accepted`             | `REALTIME`                |
| `check.observation_rejected`             | `AUDIT`                   |
| `check.health_changed/freshness_changed` | `REALTIME`                |
| `incident.opened`, `incident.closed`     | `REALTIME + NOTIFICATION` |
| `incident.observation_suspended/resumed` | `REALTIME`                |

`check_runs` and incident/current-state tables serve as the authoritative sources of truth; the outbox is not a historical store. The producer intersects the requested destinations with the active set stored in `infra.destination_activations`. This global table contains the `destination` primary key, `activated_at` cutover timestamp, and `activated_by_revision` provenance; service roles have read-only access, and activations are added strictly via consumer-ready forward migrations. If the intersection is empty, no superfluous outbox event/dispatch rows are written. When a consumer is introduced in a subsequent stage, its activation and cutover timestamp are persisted, preventing unintended replay of legacy `PENDING` rows:

- the notification consumer handles existing open incidents according to its own reconciliation logic, without blindly sending alerts for historical incidents;
- the realtime projector initializes its initial snapshot from source-of-truth tables and subsequently processes post-cutover invalidations;
- the predictor performs initial backfills from run tables within retention windows before consuming new dispatches.

Once a destination is activated, a temporary outage of its consumer does not halt dispatch production; backlog and retries remain fully observable. Activation represents a deployment capability rather than a transient health signal. Job claiming in `check_jobs` is independent of the outbox; the PostgreSQL queue is the single source of truth.

## 16. Freshness Reconciler

Candidate selection query:

```text
freshness_state = 'FRESH'
AND fresh_until <= DB now
AND stale_reconciled_at IS NULL
```

Each candidate executes within a short transaction:

1. Lock the check using `FOR UPDATE SKIP LOCKED`.
2. Lock current-state, incident, segment, and open interval in canonical order.
3. Re-verify that the deadline remains expired.
4. Invoke `planFreshnessReconciliation` with `asOf >= fresh_until`.
5. Apply the transition at the exact `fresh_until` timestamp; transaction execution time is not used as an interval boundary.
6. Commit alongside outbox events.

Two replicas cannot reconcile the same check twice. If an observation transaction acquires locks after the deadline has passed, the reducer performs overdue reconciliation internally and applies the new observation; the independent reconciler subsequently becomes a no-op. If the reconciler locks first, the observation is evaluated against the newly established STALE snapshot. Both locking sequences yield identical semantic outcomes.

Read-time overrides preserve UI correctness even if the reconciler lags; durable reconciliation remains essential for history/outbox integrity and bounded lag.

## 17. Retry, Recovery, and Restart

### 17.1 Retry/Backoff

Infrastructure retries operate exclusively at the job/attempt layer:

```text
delay = min(max_delay, base_delay * 2^(attempt_count - 1) + deterministic_jitter)
```

The initial policy specifies three attempts, a 1-second base delay, and a 30-second maximum delay. Target FAIL results are not retried; the next cadence slot serves as the subsequent observation.
Deterministic jitter in v1 ranges from `0..1000 ms`, generated via SHA-256 over the job ID and attempt number; a persistent attempt will not yield varying availability times across process restarts.

### 17.2 Lease Recovery

The recovery candidate query reads expired `LEASED` or `RUNNING` jobs in bounded batches. Transactions follow the check→job→open attempt order:

- cancellation requested: transition attempt and job to `CANCELLED`;
- check deleted/paused or generation invalid: transition to `CANCELLED`;
- retryable with remaining budget: mark attempt as `LEASE_LOST`, job as `PENDING + backoff`, and clear lease fields;
- permanent fault or budget exhausted: mark attempt with appropriate terminal reason, transition job to `DEAD`;
- lease extended by another worker heartbeat: no-op.

Terminal transitions may materialize pending manual intent within the same transaction. A `DEAD` job does not transition health to DOWN; freshness naturally transitions to STALE upon reaching its deadline.

### 17.3 Restart

Worker startup creates no in-memory jobs and loads no bulk check lists. Standard loops scanning persistent tables:

- materialize due checks;
- recover expired leases;
- claim pending jobs;
- reconcile overdue freshness states.

There is no dedicated startup backfill mode. Standard operations and recovery after restart execute through the exact same tested code path.

## 18. Graceful Shutdown

SIGTERM/SIGINT sequence:

1. Readiness transitions to draining; new scheduling and claiming cease.
2. Recovery and freshness loops do not initiate new batches.
3. Active probes are allowed to complete within `MONITOR_SHUTDOWN_GRACE_MS`.
4. Remaining probes are aborted when grace period expires.
5. Owned jobs are released via short transactions back to `PENDING + short backoff` where possible, and attempts close as `CANCELLED`.
6. If release fails, lease expiry ensures automated recovery.
7. Health server and database pool close; no unhandled promises remain.

Shutdown cancellations do not create target runs or incidents. Repeated deployments cannot drive a check into a permanent DOWN state; they can only produce a monitoring gap.

## 19. Schema and Migration Plan

Applied revisions 1–13 remain unmodified. Revision 14 applied the following enhancements in a strictly forward-only manner:

1. `app.checks.manual_requested_mode` nullable enum and `(at, mode)` pair constraint
2. `monitoring.check_jobs.cancellation_requested_at`
3. `monitoring.check_jobs.cancellation_reason` allowlist and pair constraint
4. `check_runs` rejection reason allowlist constraint
5. `result_run_finished_at + result_run_id` pointer on attempts, all-or-nothing constraint, and deferred composite run FK
6. Owner-fair due/pending partial indexes (subject to query plan verification)
7. State-consistency forward constraints on job/attempt terminal and lease fields
8. `infra.destination_activations(destination, activated_at, activated_by_revision)` for migration-owned activation/cutover tracking; read-only grants to service roles and terminal classification of inactive `PENDING/RETRY_WAIT` dispatches with `DESTINATION_NOT_ACTIVATED` provenance
9. Required monitor-role column grants and RLS negative tests

The migration backfills existing open/pending rows with safe defaults/nulls. Constraints on large tables are added as `NOT VALID` where appropriate and validated in the same migration or controlled follow-up step.

### 19.1 Cancellation Allowlist

Initial allowlist:

```text
CHECK_PAUSED
CHECK_DELETED
CONFIGURATION_CHANGED
```

Raw user input or exception strings are never written to cancellation reasons.

### 19.2 Rejection Allowlist

DB constraints align strictly with canonical values from Stage 8:

```text
DUPLICATE_RUN
ATTEMPT_NOT_CURRENT
CHECK_DELETED
DIAGNOSTIC_RUN
CHECK_PAUSED
PROBE_GENERATION_MISMATCH
SCHEDULE_GENERATION_MISMATCH
STALE_FENCING_TOKEN
```

Accepted runs require a null reason; rejected runs require an allowlisted value.

## 20. Runtime Config

Typed configuration loads from a single source, using identical validation across production and development:

| Variable                        | Reference Default | Notes                                 |
| ------------------------------- | ----------------: | ------------------------------------- |
| `MONITOR_GLOBAL_CONCURRENCY`    |                64 | Per process                           |
| `MONITOR_PER_OWNER_CONCURRENCY` |                32 | Cannot exceed global concurrency      |
| `MONITOR_PER_HOST_CONCURRENCY`  |                 4 | Cannot exceed global concurrency      |
| `MONITOR_CANDIDATE_BATCH_SIZE`  |               128 | Bounded scan batch                    |
| `MONITOR_SCHEDULE_BATCH_SIZE`   |                64 | Bounded due batch                     |
| `MONITOR_SCHEDULER_POLL_MS`     |               250 | Idle queue polling                    |
| `MONITOR_DISPATCH_POLL_MS`      |               100 | Idle execution slot polling           |
| `MONITOR_RECOVERY_POLL_MS`      |              1000 | Expired lease scan                    |
| `MONITOR_FRESHNESS_POLL_MS`     |               250 | Deadline reconciliation               |
| `MONITOR_HEARTBEAT_MS`          |              5000 | Validated against lease grace         |
| `MONITOR_LEASE_GRACE_MS`        |             15000 | Added to snapshot timeout             |
| `MONITOR_SHUTDOWN_GRACE_MS`     |             30000 | Upper bound for draining              |
| `MONITOR_DB_POOL_SIZE`          |                 8 | Sized independently of probe capacity |

Polling intervals do not govern correctness; the database deadlines serve as the single source of truth. Values are tunable under load without requiring domain migrations.

## 21. Security and Data Minimization

- The worker connects strictly using the `site_monitor_monitor` role, never schema owner or superuser privileges.
- While the worker RLS policy permits reading across tenants, every join and write enforces composite owner lineage.
- The snapshot in the database may store URLs and expected text as private configuration; these are never propagated to logs, events, audit records, metrics, or error payloads.
- SSRF determinations are re-evaluated by Stage 7 on every execution and redirect hop; API acceptance does not imply execution permission.
- Raw response bodies never escape worker process boundaries.
- Hostname concurrency keys are never logged or exposed as metric cardinality labels.
- SQL queries never use dynamic identifiers; enum and reason values are strictly allowlisted.
- Unexpected exception logs pass through redaction formatters; snapshot and client objects are never serialized in full.

## 22. Observability and Health

### 22.1 Structured Log Events

- worker started/draining/stopped
- scheduler batch results
- job claimed/started/completed/retried/dead/cancelled
- lease lost and recovery outcomes
- observation accepted/rejected reasons
- freshness batch sizes and lag buckets
- invariant/transaction retry error codes

Logs contain no URLs, IPs, response bodies, expected text, owner email addresses, or raw DB/network errors.

### 22.2 Metrics

- due checks and oldest due lag
- pending jobs and oldest available lag
- leased/running/expired/dead job counts
- active probes; global/owner/host saturation buckets
- claim, probe, and persistence duration histograms
- target outcome and failure category counts
- infrastructure retry and dead counts
- accepted/rejected observations and reason counts
- freshness reconciliation lag
- scheduler/materializer conflict and DB retry counts

Owner, check, and hostname identifiers are never used as metric labels. Until Stage 17 finalizes exporter choices, these metrics are substantiated via bounded periodic operational snapshot logs.

### 22.3 Liveness/Readiness

- `/health/live`: verifies event loop and process health; executes no DB queries.
- `/health/ready`: verifies DB schema compatibility, monitor storage/current partition preflight, and runtime loop initialization.
- Queue lag alone does not degrade readiness; it produces metrics and alerts rather than causing restart storms.
- Draining workers transition readiness to unavailable and accept no new claims.

## 23. Test Architecture

### 23.1 Pure Unit Tests

- Cadence boundary conditions, timezone independence, and prolonged downtime
- Single catch-up and no-backfill rules
- Manual cadence immutability
- Retry/backoff and deterministic jitter
- Candidate owner-fair ordering
- Config invariants
- Probe result→observation mapping and redaction
- Infrastructure fault classification

### 23.2 PostgreSQL Integration Tests

- Two schedulers produce only a single job for the same due check.
- Two workers produce only a single current attempt for the same pending job.
- Partial unique invariant prevents a secondary job during prolonged probing.
- Pause/config/delete on a running job sets a cancellation request; no new job begins until acknowledgement.
- Expired leases are reclaimed with a higher fence; outdated results remain rejected in history without altering state.
- Duplicate replay of an attempt result locates the existing run via partition-key pointer without creating secondary runs or events.
- Manual coalesced intent materializes exactly once with the correct stored mode.
- Run + current state + interval + incident + segment + outbox commit or rollback atomically.
- Inactive destinations produce no unbounded pending backlog; active destination dispatches survive consumer outages.
- Reducer effect row-count/invariant errors leave no partial state.
- Freshness deadlines are reconciled once across two competing reconciler replicas.
- Cross-owner lineage and monitor role negative tests pass.
- Missing current or upcoming partitions produce visible readiness/persistence errors rather than false target FAILs.

### 23.3 Process and Crash Tests

- Worker killed during an active probe; another worker reclaims after lease expiry.
- Stale process attempts to write late results; only `ATTEMPT_NOT_CURRENT/STALE_FENCING_TOKEN` rejection occurs.
- Graceful shutdown allows tasks to complete or leaves them cleanly retryable.
- Transient PostgreSQL outage; API process and independent probe tasks behave predictably without generating false incidents.
- Following restart, due checks resume normally, leaving the downtime window as a no-data gap.

### 23.4 Capacity Tests

20, 200, and 500 check profiles tested using the exact same code path:

- 30-second cadence materialization cost
- owner-fair queue drain
- 50+ concurrent fast/slow simulator targets
- 100% target timeout scenarios
- concurrency bottlenecks on a single hostname
- queue saturation by a single owner while small owners continue progressing
- maintaining API readiness and list latencies under worker load

The report records CPU, memory, DB connections, queue lag, claim/persistence p95, and completed probe throughput. Targets that fail to be met are not obscured; bottlenecks and subsequent tuning requirements are documented explicitly.

The 2026-10-10 local baseline and reproduction commands are recorded in [`MONITOR_CAPACITY_REPORT.md`](./MONITOR_CAPACITY_REPORT.md). The production scheduler→queue→dispatcher→observation pipeline successfully passed 20/200/500 profiles against real PostgreSQL; external network layers were isolated via deterministic probe ports, and real socket concurrency proofs remain preserved separately in Stage 7 tests.

Force-killing a real production worker child process during a hanging HTTP probe, natural expiration of leases without manual intervention, completion of the replacement attempt with a higher fence, and rejection of the delayed FAIL result from the original claim without altering state or incidents are documented in [`MONITOR_FAILURE_RECOVERY_REPORT.md`](./MONITOR_FAILURE_RECOVERY_REPORT.md).

Exact job/attempt/run correctness under 200 due checks across two real production workers and a separate API process, dual worker participation, and authenticated API list/readiness latency remaining within budget under worker load are documented in [`MONITOR_RUNTIME_ISOLATION_REPORT.md`](./MONITOR_RUNTIME_ISOLATION_REPORT.md).

## 24. Transaction Retry Policy

Short, fully idempotent DB transactions undergo bounded retries exclusively for allowlisted transient SQLSTATE errors:

- `40001` serialization failure
- `40P01` deadlock detected

Probes are not re-executed; only the persistence transaction is retried using the identical immutable target result and pre-allocated IDs. Unique, constraint, or invariant violations are never automatically treated as transient.

Retry attempts and backoffs are logged without exposing SQL text, parameters, or sensitive snapshot data.

## 25. Implementation Slices

1. Typed monitor runtime config, pure cadence/backoff/fairness utilities, and unit tests
2. Revision 14 cancellation/manual-mode/result-pointer/destination-activation migration, Kysely types, and shared activation-aware outbox writer for API and worker
3. Canonical check-first lock helpers and scheduled/manual materializer
4. Claim/lease/heartbeat/fencing mechanisms and dual-worker PostgreSQL tests
5. Bounded dispatcher, semaphores, active task registry, and probe orchestration
6. Infrastructure fault handling, retry/DEAD policies, cancellation acknowledgement, and lease recovery
7. Observation snapshot loader, reducer adapter, and atomic result transaction
8. Freshness reconciler and deadline race condition tests
9. Graceful shutdown, readiness/storage preflight checks, and redacted operational logging
10. 20/200/500 capacity, process-kill/restart, and API-isolation proofs
11. Compose smoke tests, full CI verification, and decision/development/status updates

All implementation slices are completed and verified. Four loops are active in the production entrypoint; startup verifies run/interval partitions for the current and subsequent UTC month, readiness monitors loop initial success and ongoing health, and shutdown interrupts polling sleep, blocks new claims, and aborts active probes upon exceeding grace periods. Two real workers consumed the same PostgreSQL queue without duplicate attempts or runs, and a separate API process served authenticated listing and readiness requests within budget under full worker load. Once applied, migration revisions are never modified; issues identified subsequently are resolved strictly via forward migrations.

## 26. Completion Gate

Stage 9 is considered complete only when all of the following conditions are satisfied:

- Real scheduled and manual probes operate end-to-end.
- API requests never wait on probe execution.
- The same check does not run concurrently with itself under normal slow/interval conditions.
- No new job begins before cancellation acknowledgement completes.
- Two concurrent workers produce only a single current attempt and accepted observation.
- Lost leases and stale fences cannot alter current state or incidents.
- Following process termination, jobs resume under bounded lease policies.
- Downtime produces no backfill or false DOWN states.
- Target PASS/FAIL is cleanly differentiated from infrastructure faults.
- Run, state, interval, incident, segment, and outbox operations are atomic.
- Freshness is reconciled at the exact deadline, idempotently and gap-safely.
- Owner fairness and global/owner/host concurrency are measured under 20/200/500 profiles.
- No URLs, bodies, IPs, or secrets leak into logs or events.
- API and worker share the same activation-aware outbox routing helper; inactive destinations generate no new dispatches.
- The monitor role passes least privilege and cross-owner negative tests.
- Format, lint, strict typecheck, unit, PostgreSQL integration, process/failure, and Compose smoke checks all pass.
- `README`, `PROJECT_STATUS`, `DECISIONS`, `DEVELOPMENT_LOG`, and `NEXT_STEPS` are honestly updated.

## 27. Known Trade-offs

- External HTTP is not mathematically exactly-once. Brief zombie overlaps following a lease partition are theoretically possible; fencing ensures only one result is accepted into state.
- Per-owner and per-host hard concurrency caps are process-local. Replica count must be factored into deployment capacity planning; strict cluster-wide slots will be added only if justified by measured need.
- PostgreSQL polling serves as the source of truth for correctness; `LISTEN/NOTIFY` optimizations are not mandatory before Stage 13.
- DEAD infrastructure jobs are not classified as target downtime. The next cadence slot will produce a new job; operational metrics and alerts are required.
- Realtime, notification, and prediction consumers are deferred to subsequent stages. Dispatches are not generated until destinations are activated; backlogs accumulated post-activation do not block monitoring transactions.
- Until Stage 12 is complete, run and interval data is persisted, but daily/weekly/monthly rollup APIs are not yet exposed to users.
