# Health, Incident, and Group Status Engine

**Status:** Stage 8 implemented and locally verified — 2026-10-10 11:53 +06:00  
**Date:** 2026-10-10 11:02 +06:00  
**Basis:** `REQUIREMENTS.md`, `ACCEPTANCE_CRITERIA.md`, `DOMAIN_MODEL.md`, `STATE_MACHINES.md`, `DATABASE_SCHEMA.md`, `EVENT_CATALOG.md`, `CHECKS_AND_GROUPS.md`, `CHECK_ENGINE.md`  
**Pure domain package:** `packages/domain`  
**Persistent executor:** `apps/monitor-worker` — Connected to Stage 9 atomic observation transaction and verified on real PostgreSQL

## 1. Purpose

This document formalizes the Stage 8 engine that translates accepted probe observations into deterministic health, freshness, availability timeline, incident, and group status outcomes. The engine:

- is pure domain logic independent of scheduler, HTTP, PostgreSQL, and wall-clock access;
- defines transitions across `UNKNOWN`, `UP`, `SUSPECT`, and `DOWN` in a single place;
- distinguishes a single transient measurement failure from a confirmed outage;
- does not treat a monitoring gap as target downtime;
- distinguishes an incident's wall-clock duration from its genuinely observed DOWN duration;
- excludes duplicate, diagnostic, generation-mismatched, or stale fencing token observations from mutating state;
- produces availability interval changes as a lossless transaction plan;
- derives group status from child check snapshots in a bounded manner.

This stage does not execute probes, claim jobs, open SQL transactions, send emails, or write to SSE connections.

## 2. Scope and Stage Boundaries

### 2.1 Within Stage 8

- Pure observation acceptance decisions
- Health/freshness reducer
- Two consecutive FAIL threshold and failure candidate
- Incident opening, sustaining, suspending, resuming, and recovery plan
- Provisional/UP/DOWN/UNKNOWN interval rotation plan
- Freshness deadline reconciliation decisions
- Effective check health/freshness read rules
- Group health and counter derivation
- Typed transition effects and domain event facts
- Table-driven, sequence, property/invariant, and idempotency tests

### 2.2 Stage 9 Responsibilities

- Job/attempt claim, lease, heartbeat, and retry
- Real `check_runs` insert and attempt idempotency guard — implemented
- Row locks, SQL effect application, and transaction commit — implemented
- Bounded, owner-fair selection and persistent execution of freshness reconciliation jobs — implemented
- Connecting the engine to the real probe result stream — persistence sink implemented; production loop activation open
- Worker concurrency, fairness, overlap prevention, and restart recovery

### 2.3 Deferred to Subsequent Stages

- Maintenance CRUD and notification reconciliation: Stage 10
- Incident email materialization/delivery: Stage 11
- History rollup and retention: Stage 12
- Dashboard/SSE/public projections: Stages 13–15
- Predictor: Stage 16

Maintenance state does not alter health. Stage 8 may produce incident event facts; re-evaluating maintenance and recipient policies at dispatch time is the responsibility of subsequent stages.

## 3. Existing Foundation and Gaps to Close

The schema already contains the necessary source-of-truth tables:

- `monitoring.check_current_states`
- `monitoring.open_health_intervals`
- `monitoring.health_intervals`
- `monitoring.incidents`
- `monitoring.incident_segments`
- partitioned `monitoring.check_runs`

Stage 6 implemented the incident and timeline side effects of pause/resume/probe-change/delete commands. Stage 8 does not alter these semantics; it introduces the canonical domain reducer that uses the same invariants for observation and clock transitions.

There are two read races that must be closed in implementation:

1. When persistent `freshness_state=FRESH`, `fresh_until` may have already passed. Even if the reconciler is delayed, the API must immediately present the effective state as `STALE/UNKNOWN`.
2. An open observed incident segment must not continue to grow via `now - started_at` during reconciler latency. Query-time duration must be capped at `fresh_until`, and the effective observation mode must be displayed as `UNOBSERVED`.

These rules do not modify the source of truth; when the delayed projection write completes, it makes the identical outcome persistent.

## 4. Architectural Boundaries

```text
ProbeResultV1 (Stage 7)
        |
        v
Stage 9 acceptance/persistence adapter
        |
        |  immutable snapshot + canonical DB time
        v
@site-monitor/domain state engine (Stage 8)
        |
        +--> acceptance decision
        +--> current-state patch
        +--> interval rotation effects
        +--> incident/segment effects
        +--> redacted event facts
        +--> affected group invalidation
        |
        v
Stage 9 single PostgreSQL transaction executor
```

The pure engine:

- performs no DB queries, `Date.now()`, UUID generation, or log writing;
- does not mutate the input snapshot;
- produces byte-level equivalent semantic output for identical inputs;
- accepts no raw URLs, queries, expected bodies, or response bodies;
- returns a list of typed effects instead of persistence details.

New incident, segment, and interval rows requiring identities are generated by the transaction executor. The domain effect carries all lineage fields; the executor links the generated IDs to the current-state and event rows within the same transaction.

## 5. Canonical Types

```ts
type HealthState = 'UNKNOWN' | 'UP' | 'SUSPECT' | 'DOWN';
type FreshnessState = 'FRESH' | 'STALE';
type ObservationOutcome = 'PASS' | 'FAIL';
type ObservationMode = 'OBSERVED' | 'UNOBSERVED';
type TimelineClass = 'UNKNOWN' | 'UP' | 'PROVISIONAL' | 'DOWN';

interface HealthPolicyV1 {
  failureThreshold: 2;
  schedulerGraceMs: number;
}
```

The v1 failure threshold is not configurable per deployment or per user: **it is strictly 2**. The counter saturates at `2`; it does not grow unbounded during prolonged outages. If a per-check threshold is added in the future, it will become part of probe semantics, versioned in configuration snapshots, and increment probe generation.

`schedulerGraceMs` belongs to deployment policy rather than observation snapshots. The baseline value is 5 seconds, consistent with existing behavior, and is provided as a bounded config from a single source in Stage 9.

### 5.1 Observation Input

The state engine receives only sanitized fields:

- owner/check/run/job/attempt references
- trigger and manual mode
- resource/probe/schedule generation
- fencing token
- DB-assigned canonical `finishedAt`
- PASS/FAIL
- total duration, status code, body-match, and allowlist failure category
- check lifecycle/execution and interval/timeout snapshot
- current state, open interval, and open incident/segment snapshot (if present)
- acceptance inputs proven by the transaction adapter, such as duplicate/attempt-current status

`finishedAt` is not trusted from worker host clocks. Stage 9 derives the canonical transition time from PostgreSQL time when persisting results; probe phase durations are monotonic measurements.

### 5.2 Transition Plan

```ts
interface StateTransitionPlan {
  acceptance: AcceptanceDecision;
  currentState?: CurrentStateMutation;
  intervalEffects: IntervalEffect[];
  incidentEffects: IncidentEffect[];
  eventFacts: DomainEventFact[];
  affectedGroupId?: string;
}
```

For rejected observations, an acceptance decision and a redacted `check.observation_rejected` fact may be returned; no health, incident, interval, or standard notification facts are created. A duplicate replay returns the existing persisted decision without emitting a second event. `check.run_recorded` and job terminal status handling are the responsibility of the Stage 9 adapter.

## 6. Observation Acceptance

### 6.1 Decision Precedence

Precedence is fixed; identical malformed input yields the same reason code on every evaluation:

1. If the same run/attempt result was previously recorded: `DUPLICATE_RUN` and the existing result is idempotently returned.
2. If the attempt is no longer the current claim: `ATTEMPT_NOT_CURRENT`.
3. If the check is `DELETED`: `CHECK_DELETED`.
4. If the run is `DIAGNOSTIC`: `DIAGNOSTIC_RUN`.
5. If the check is `PAUSED`: `CHECK_PAUSED`.
6. If the probe generation differs: `PROBE_GENERATION_MISMATCH`.
7. If the schedule generation differs: `SCHEDULE_GENERATION_MISMATCH`.
8. If the fencing token is not greater than the last accepted token: `STALE_FENCING_TOKEN`.
9. The remaining PASS/FAIL result is an accepted stateful observation.

Canonical rejection allowlist:

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

An engine or programming exception is not an observation and is never fabricated as `check_runs.outcome=FAIL`. Stage 7 infrastructure faults route to job/attempt retry or DEAD policies.

### 6.2 Shared Updates for Accepted Observations

Every accepted observation:

- sets `freshness_state=FRESH`;
- computes `fresh_until = finishedAt + interval + timeout + schedulerGrace`;
- updates the last accepted run and fencing token;
- updates last response/status fields from the result;
- updates `last_success_at` for PASS, or `last_failure_at` for FAIL;
- increments current state `state_version` **exactly once**;
- clears `stale_reconciled_at`;
- generates a redacted `check.observation_accepted` fact.

Even if health remains unchanged, an accepted observation increments state version because the visible projection of last-check, latency, and freshness deadline has changed.

## 7. Health Transition Matrix

| Initial State           | Observation | Result  | Candidate     | Incident                            | Timeline                                                 |
| ----------------------- | ----------- | ------- | ------------- | ----------------------------------- | -------------------------------------------------------- |
| UNKNOWN                 | PASS        | UP      | Clean         | None                                | UNKNOWN closes, UP opens                                 |
| UNKNOWN                 | FAIL        | SUSPECT | First FAIL    | None                                | UNKNOWN closes, PROVISIONAL opens                        |
| UP                      | PASS        | UP      | Clean         | None                                | UP interval continues                                    |
| UP                      | FAIL        | SUSPECT | First FAIL    | None                                | UP closes, PROVISIONAL opens                             |
| SUSPECT                 | PASS        | UP      | Cleared       | None                                | PROVISIONAL finalized as UP in history, new UP opens     |
| SUSPECT                 | FAIL        | DOWN    | Confirmed     | Opens at first FAIL timestamp       | PROVISIONAL finalized as DOWN in history, new DOWN opens |
| DOWN + OPEN/OBSERVED    | FAIL        | DOWN    | None          | Same incident/segment               | DOWN interval continues                                  |
| DOWN + OPEN/OBSERVED    | PASS        | UP      | None          | Closes as RECOVERED                 | DOWN closes, UP opens                                    |
| STALE + OPEN/UNOBSERVED | FAIL        | DOWN    | None          | Segment continues for same incident | UNKNOWN closes, DOWN opens                               |
| STALE + OPEN/UNOBSERVED | PASS        | UP      | None          | Closes as RECOVERED                 | UNKNOWN closes, UP opens                                 |
| STALE, no incident      | FAIL        | SUSPECT | New candidate | None                                | UNKNOWN closes, PROVISIONAL opens                        |
| STALE, no incident      | PASS        | UP      | Clean         | None                                | UNKNOWN closes, UP opens                                 |

Impossible snapshot scenarios (`DOWN` without an open incident, open incident marked `OBSERVED` without an open segment, candidate present when health is not `SUSPECT`) are never patched fail-open. The engine raises a typed `DOMAIN_INVARIANT_VIOLATION`; the transaction rolls back, no FAIL is recorded against the target, and an operator alarm is triggered.

## 8. Failure Candidate and Threshold

The first accepted FAIL:

- sets `health_state=SUSPECT`;
- sets `consecutive_failure_count=1`;
- sets `candidate_started_at=finishedAt`;
- links candidate run lineage to the first FAIL;
- emits no incident or DOWN notification facts;
- shifts timeline to `PROVISIONAL`.

The second consecutive accepted FAIL:

- saturates count at `2`;
- transitions health to `DOWN`;
- sets incident `started_at` to the first FAIL timestamp and `confirmed_at` to the second FAIL timestamp;
- starts the incident's first observed segment at the first FAIL timestamp;
- finalizes the provisional interval from first FAIL to confirmation as DOWN;
- opens an active DOWN interval at the confirmation moment.

A PASS following SUSPECT clears the candidate. The provisional interval from the first FAIL to PASS is finalized as UP; the failed run remains in immutable history, but is not counted as availability downtime.

Pause, probe reset, deletion, or freshness expiry clears the candidate. In these cases, the provisional span is finalized as `UNKNOWN`.

## 9. Incident and Segment Semantics

An incident is created only when the failure threshold is crossed. Invariants ensuring at most one open incident per check and at most one open segment per incident are enforced by both the reducer and partial unique indexes.

### 9.1 Opening

- `started_at`: candidate first FAIL timestamp
- `confirmed_at`: threshold-crossing FAIL timestamp
- `status=OPEN`
- `observation_mode=OBSERVED`
- `observed_duration_ms=0`
- initial segment `[firstFailureAt, open)`
- first/confirmation run lineage is mandatory

### 9.2 Repeated FAIL

During an open observed incident, a FAIL does not create a new incident, segment, or DOWN event. The last failure category and incident resource version are updated as needed; the active segment continues.

### 9.3 Recovery

An accepted PASS:

- closes the active segment (if present) at the PASS timestamp with `RECOVERED`;
- adds the segment duration to the `observed_duration_ms` sum exactly once;
- marks the incident `CLOSED/RECOVERED`;
- clears the `open_incident_id` field in current state;
- transitions health to UP and rotates the timeline;
- emits a single `incident.closed` fact.

If an open incident is already UNOBSERVED, PASS closes it without opening a new zero-length segment. The unobserved gap is never counted toward observed duration.

### 9.4 Observation Suspension and Resumption

- Freshness expiry closes the segment at precisely `fresh_until` with `STALE`.
- Pause closes the segment at the command's canonical DB timestamp with `PAUSED`.
- The incident remains OPEN, with observation mode becoming UNOBSERVED.
- A subsequent accepted FAIL opens a new segment for the same incident and emits `incident.observation_resumed`.
- The new segment begins at the resume FAIL timestamp; the intervening gap is never added to any interval or incident DOWN duration.

Probe configuration changes and deletion close the incident terminally with `CONFIG_CHANGED` and `CHECK_DELETED` respectively; these command behaviors remain aligned with Stage 6.

### 9.5 Durations

```text
observed_duration = closed segments sum
                  + (if open segment present) min(now, fresh_until) - open segment start

wall_duration = min(now, closed_at ?? now) - started_at
```

Negative duration is never clamped or concealed; canonical chronological order violations represent invariant faults. The API conveys decimal millisecond values as strings.

## 10. Availability Timeline

There is exactly one open interval per check in the `open_health_intervals` table. Rotation generates half-open `[start, end)` intervals.

### 10.1 General Rotation

1. Check/current-state and open interval are read within the same locking order.
2. `effectiveAt < open.started_at` is an invariant fault.
3. If `effectiveAt > open.started_at`, the old interval is inserted into history with its resolved final class.
4. Within the same transaction, the old open row is updated with the new class, lineage, and start timestamp.
5. If `effectiveAt == open.started_at`, zero-length history is not recorded; the open row is updated in-place semantically.

### 10.2 Provisional Resolution

| Subsequent Event       | Final PROVISIONAL Class             |
| ---------------------- | ----------------------------------- |
| FAIL meeting threshold | DOWN                                |
| PASS                   | UP                                  |
| Freshness expiry       | UNKNOWN                             |
| Pause                  | UNKNOWN                             |
| Probe reset            | UNKNOWN                             |
| Delete                 | End of history; open row is removed |

`PROVISIONAL` is never a final classification in `health_intervals`. Consequently, monthly availability queries never erroneously attribute indeterminate periods to UP or DOWN.

### 10.3 Idempotency

Re-applying the same run or stale reconciliation produces zero secondary interval inserts. This is collectively guaranteed by run idempotency guards, current-state version/token checks, and the `stale_reconciled_at` deadline checkpoint.

## 11. Freshness and Monitoring Gaps

### 11.1 Deadline

```text
fresh_until = accepted_finished_at
            + interval_seconds
            + timeout_ms
            + scheduler_grace_ms
```

The v1 default scheduler grace is 5 seconds. The formula is encapsulated in a single helper, and overflow or invalid input is rejected fail-fast.

### 11.2 Read-Time Effective State

Reconciler latency cannot present incorrect UP/DOWN states to users:

```text
effective_freshness =
  execution == PAUSED
  OR fresh_until IS NULL
  OR fresh_until <= query_time
    ? STALE
    : persisted_freshness

effective_health = effective_freshness == STALE
  ? UNKNOWN
  : persisted_health
```

Check listings, dashboards, group aggregations, private/public snapshots, and SSE reconciliation all adhere to identical helper and SQL expression semantics. In PostgreSQL queries, a single `statement_timestamp()` is evaluated.

Even if an open incident is recorded as persisted `OBSERVED`, if the deadline has passed, the API presents effective observation mode as `UNOBSERVED` and caps dynamic duration at `fresh_until`.

### 11.3 Persistent Reconciliation

`ReconcileFreshness(now)`:

- accepts current state/interval/incident snapshots as locked transaction inputs;
- behaves as a no-op if `now < fresh_until` or if the same deadline was previously reconciled;
- fixes the transition timestamp strictly at `fresh_until`, not `now`;
- sets freshness to STALE, clears failure candidates, and sets effective health to UNKNOWN;
- rotates interval to UNKNOWN;
- closes the open segment and marks the incident as UNOBSERVED;
- increments current state version and relevant incident version once;
- emits `check.freshness_changed` and, if applicable, `incident.observation_suspended` facts.

No synthetic FAIL or run entries are fabricated for probes missed while workers or servers were down. Monitoring gaps are recorded as UNKNOWN.

## 12. Group Status

Group health is not a separate mutable aggregate or table. It is derived as a query-time bounded aggregate exclusively from `LIVE` child checks belonging to the same owner.

### 12.1 Inclusion

- `ACTIVE` checks participate in health precedence evaluation.
- `PAUSED` checks do not participate in health precedence; they are tallied in the `paused` counter.
- `DELETED` checks are excluded completely.
- Read-time effective freshness and health rules are evaluated for every ACTIVE child check.

### 12.2 Precedence

```text
DOWN > SUSPECT > UNKNOWN > UP
```

| Child Check Outcomes                      | Group Health                |
| ----------------------------------------- | --------------------------- |
| At least one DOWN                         | DOWN                        |
| No DOWN, at least one SUSPECT             | SUSPECT                     |
| No DOWN or SUSPECT, at least one UNKNOWN  | UNKNOWN                     |
| All ACTIVE children are UP                | UP                          |
| No ACTIVE children, paused checks present | UNKNOWN                     |
| No live children exist                    | UNKNOWN; all counters are 0 |

`up + suspect + down + unknown` equals the count of active checks; `paused` is tracked separately. The current OpenAPI contract represents an empty group via zeroed counter values. A separate `empty` property will only be introduced upon deliberate contract versioning.

Maintenance summaries remain decoupled from health. Placeholder maintenance fields are not added to the GroupStatus DTO prior to Stage 10.

### 12.3 Performance and Invalidation

- Per-owner deployment quotas keep the aggregation bounded; 50 is not a hardcoded product ceiling.
- v1 relies on a single set-based SQL aggregation query rather than per-child queries.
- The `fresh_until` read-time override is identical across both individual check and group queries.
- Changes in health, freshness, or check group assignments emit group query invalidation signals to realtime/public projectors; mutable group health is never made an event source of truth.
- 20/200/500 fixture query plans are re-benchmarked at the close of Stage 8 implementation.

## 13. Event Facts

The engine does not write directly to the durable outbox; it returns a minimal, redacted list of facts. The Stage 9 adapter binds IDs/versions and writes envelope/dispatch records in the same transaction solely for persistently activated destinations.

| Fact                             | Trigger Condition                                        |
| -------------------------------- | -------------------------------------------------------- |
| `check.observation_accepted`     | Every accepted run                                       |
| `check.observation_rejected`     | Persisted run excluded from state mutations              |
| `check.health_changed`           | When persisted observed health actually changes          |
| `check.freshness_changed`        | When transitioning FRESH ↔ STALE                         |
| `incident.opened`                | When threshold is crossed for the first time             |
| `incident.observation_suspended` | When open segment closes due to gap or pause             |
| `incident.observation_resumed`   | When an UNOBSERVED incident is observed again via FAIL   |
| `incident.closed`                | On recovery, config change, or deletion terminal closure |

Repeated DOWN FAILs do not produce duplicate `incident.opened` or DOWN notification facts. `maintenance_suppressed` is an event-time diagnostic field, not a dispatch decision. While the adapter may attach a maintenance snapshot when persisting events, the notification worker re-evaluates the durable source of truth prior to dispatch.

Payloads never contain URLs, queries, IP addresses, expected bodies, response bodies, or raw network errors. Versions are represented as JSON decimal strings.

## 14. Transaction and Locking Protocol

The Stage 9 observation transaction follows this strict sequence:

1. Lock check row.
2. Lock job and attempt rows; verify duplicate/result eligibility.
3. Lock current-state row.
4. Lock open incident and segment rows (if present).
5. Lock open health interval row.
6. Compute the pure transition plan from locked snapshot and candidate result.
7. Insert immutable run row along with acceptance decision.
8. Apply current-state, interval, incident, and segment effects.
9. Write activation-aware event/outbox dispatch records.
10. Update attempt/job terminal status and commit transaction.

The canonical global locking order is `check -> job -> attempt -> current state -> incident -> segment -> interval`. Because API check commands also acquire locks in the `check -> job` sequence, workers cannot acquire locks in reverse order. If multiple checks are processed, locks are acquired in ascending UUID order. No HTTP, SMTP, SSE, or predictor invocations occur inside domain transactions. Detailed claim and cancellation protocols are formalized in [`SCHEDULER_AND_WORKERS.md`](./SCHEDULER_AND_WORKERS.md).

In case of failure, no part of the transaction becomes visible. External email or realtime delivery occurs strictly after outbox commit.

## 15. Schema and Migration Assessment

Revision 14 introduced attempt result pointers, rejection allowlists, and destination activation records as forward-only additions for Stage 9 integration. The atomic observation adapter was validated against this schema.

The following items have passed migration and test review:

- whether the canonical rejection reason allowlist requires DB-level constraints;
- least-privilege UPDATE permissions for the monitor role on required columns;
- cross-owner FK and RLS behavior in incident/current-state/interval snapshots;
- existence of relevant monthly partitions without falling back to default partitions;
- rotation helpers ensuring zero-length intervals are never emitted;
- atomicity of outbox event/dispatch writes with the state transaction for active destinations, and absence of backlog generation for inactive destinations.

Applied migration files are never modified; if changes are required, revision 14+ forward-only migrations are authored.

## 16. Error Policy and Observability

### 16.1 Non-Target Failure Scenarios

- Reducer invariant violation
- DB/serialization/constraint errors
- Engine infrastructure faults
- Lease loss or cancellation

These conditions never generate target FAIL outcomes or incidents. They route to job retry/dead-letter mechanisms and operational alerts.

### 16.2 Bounded Telemetry

Metrics:

- count of accepted/rejected observations and reason codes
- count of health/freshness transitions
- count of incident opened/closed/suspended/resumed events
- stale reconciliation lag (`processed_at - fresh_until`)
- count of domain invariant violations
- group aggregate query latency and child count

Logs carry owner/check/run/incident/job correlation IDs and allowlisted reason codes; they never include URLs, IPs, bodies, or query parameters. High-cardinality identifiers are never used as metric labels.

## 17. Testing Architecture

### 17.1 Table-Driven Unit Tests

- Complete health transition matrix
- Acceptance precedence and all rejection reason codes
- Fresh-until calculation and boundary semantics (`now == fresh_until` evaluates to STALE)
- Incident open/recovery/suspend/resume transitions
- Provisional → UP/DOWN/UNKNOWN resolution
- Non-multiplication of incidents/events on repeated FAIL
- Effective read-time freshness and duration capping
- Group precedence/counter/empty/paused behavior

### 17.2 Sequence and Property Tests

Deterministic event sequences and seeded generated sequences verify the following invariants:

- at most one open incident per check;
- at most one open segment per incident;
- finalized intervals never overlap, and negative or zero durations are never written;
- failure candidates exist only in SUSPECT state;
- DOWN state exists only with an open incident;
- observed duration strictly equals the sum of closed segments;
- duplicate events produce zero secondary effects;
- fencing tokens and generations never regress;
- monitoring gaps are never attributed to DOWN duration;
- closed incidents can never be reopened.

A property-based testing framework dependency is added only if the existing Vitest table/seed approach proves insufficient. The preferred initial approach is a compact sequence generator with a fixed seed.

### 17.3 PostgreSQL Integration Tests

The pure transition plan is tested prior to Stage 9 integration; once integrated, the following are verified against real PostgreSQL:

- only one of two concurrent results is accepted;
- stale attempts/runs remain in history without mutating state;
- incident/segment partial unique constraints and invariants;
- atomic commit/rollback of run + state + interval + incident + active outbox routing;
- RLS owner isolation;
- freshness deadlines and reconciler idempotency;
- 20/200/500 group aggregate query plan and latency profiles.

## 18. Implementation Slices

1. Canonical domain types, invariant validator, and health policy
2. Acceptance decision and precedence tests
3. Accepted observation reducer and transition matrix tests
4. Failure candidate and provisional interval effects
5. Incident/segment effects and sequence tests
6. Freshness reconciliation and read-time effective projection helpers
7. Group status derivation and API SQL semantics regression tests
8. Event fact mapping and redaction tests
9. Full repository quality gate, documentation, and status updates

This sequence performs no direct DB scheduler integration; it produces a stable semantic port to be executed by Stage 9.

## 19. Completion Gate

Stage 8 is considered complete only when all of the following are satisfied:

- The pure engine executes deterministically without I/O or global clock dependencies.
- AC-040–048 health and incident rules are proven through table and sequence tests.
- A single FAIL does not open an incident; a second consecutive FAIL opens an incident with the timestamp of the first FAIL.
- PASS correctly closes recovery and finalizes observed duration.
- Data gaps immediately render effective state as UNKNOWN and cap duration at the deadline.
- Duplicate, stale, or diagnostic observations produce zero state effects.
- Provisional intervals are finalized exclusively as UP, DOWN, or UNKNOWN.
- Group status is derived using the identical read-time freshness rules and set-based query semantics.
- Domain event facts are minimal, redacted, and idempotent.
- Lint, format, strict typecheck, and relevant test suites pass.
- `PROJECT_STATUS`, `DECISIONS`, and `DEVELOPMENT_LOG` are updated honestly.

## 20. Known Trade-offs

- The failure threshold is fixed at 2 in v1; deterministic product semantics were chosen over per-user configurability.
- Group status is computed at query time; if high-scale benchmarking reveals issues, a rebuildable projection will be introduced under a separate architectural decision.
- The reconciler may experience delay; read-time overrides maintain correctness, but persistent interval/outbox updates may lag by a few seconds. This lag must remain observable.
- Stage 8 alone does not wire probe results to the database. End-to-end incident generation operates once the Stage 9 observation transaction is completed.
- Maintenance, notification, and realtime consumers are not completed in this stage; only the accurate domain facts they require are established.
