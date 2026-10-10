# Site Availability Monitor — State Machines

**Version:** 1.0  
**Status:** Canonical domain state transitions; aligned with Stage 8 acceptance semantics  
**Date:** 2026-10-09 22:53 +06:00  
**Last Updated:** 2026-10-10 11:02 +06:00

## 1. General Invariants

- All transitions are triggered explicitly by commands, accepted observations, temporal deadlines, or reconciliation sweeps.
- Re-processing an existing event ID or run ID produces zero additional domain mutations.
- Domain sequence ordering never relies solely on wall-clock timestamps; it is strictly guarded by resource versions, generation counters, and monotonic fencing tokens.
- Unrecognized or invalid commands for a given state are rejected with typed validation or conflict responses rather than being silently ignored.
- Domain transactions never make external network calls.

## 2. Check Lifecycle and Execution

Lifecycle and execution state axes are strictly separated.

### Lifecycle Axis

```text
LIVE ──DeleteCheck──> DELETED
```

`DELETED` is a terminal state. An identical Check ID cannot be resurrected; users may create a new check using identical parameters.

### Execution Axis

```text
ACTIVE ──PauseCheck──> PAUSED
PAUSED ──ResumeCheck─> ACTIVE
```

| Current | Event | Next | Side Effects |
| --- | --- | --- | --- |
| ACTIVE | Pause | PAUSED | Increments schedule generation, cancels queued jobs, invalidates running results for state updates, clears failure candidate, suspends active incident segments. |
| PAUSED | Pause | PAUSED | Idempotent no-op; resource version does not increment unnecessarily. |
| PAUSED | Resume | ACTIVE | Increments schedule generation, enqueues immediate scheduled probe, preserves effective health as UNKNOWN until fresh observation. |
| ACTIVE | Resume | ACTIVE | Idempotent no-op. |
| LIVE | Delete | DELETED | Halts scheduling, cancels pending jobs, closes open incident with `CHECK_DELETED`, removes public page projections. |
| DELETED | Any mutation | DELETED | Returns `resource_not_found` or terminal conflict error. |

## 3. Manual Run Modes

Manual execution is not a check state; it is an attribute of a check job.

| Check Status | Manual Mode | State Effect | Cadence Effect |
| --- | --- | --- | --- |
| LIVE + ACTIVE | STATEFUL | Participates in health/incident state machines. | None |
| LIVE + PAUSED | DIAGNOSTIC | Persisted to history; does not alter health, incidents, availability, or alerts. | None |
| DELETED | None | Request rejected. | None |

If a check has active or queued jobs, concurrent manual run requests coalesce into a single `manual_requested = true` intent flag. Upon job completion, at most one manual job is enqueued.

## 4. Check Job State Machine

```text
PENDING ──claim──> LEASED ──start──> RUNNING ──result persisted──> COMPLETED
   │                 │                  │
   │                 ├─lease expiry─────┤──> PENDING (retryable)
   │                 │                  │
   ├─invalidate──────┘                  ├─cancel request──> RUNNING + cancel_requested
   │        │                           │                         │
   │        └───────────────────────────┴─────────ack/recovery──> CANCELLED
   │
   └─retry budget exhausted / permanent internal error──> DEAD
```

| State | Allowed Operations | Notes |
| --- | --- | --- |
| PENDING | Claim, cancel | Claim atomically assigns lease and monotonic fencing token. |
| LEASED | Start, heartbeat, release, expire, cancellation request | Brief window prior to outbound HTTP connection. Remains active until cancellation acknowledgement. |
| RUNNING | Heartbeat, persist result, lose lease, cancellation request | Worker receives abort signal on lease loss or cancellation request; preserves partial unique invariant until acknowledged. |
| COMPLETED | None | Target may return PASS or FAIL; both represent successful job execution. |
| CANCELLED | None | Job discarded due to pause, delete, or config invalidation. |
| DEAD | Operator/reconciliation inspection | Internal infrastructure errors exhausted retry budget; does not emit target failure observations. |

Expired leases return jobs to `PENDING`. Subsequent claims receive higher fencing tokens. While stale attempt results may be archived as diagnostic check runs, they fail observation acceptance rules.

PENDING jobs transition directly to `CANCELLED` during invalidation sweeps. LEASED or RUNNING jobs are marked with `cancellation_requested`; replacement jobs are held until worker acknowledgement or lease expiry confirms termination.

## 5. Observation Acceptance Policy

A check run becomes an accepted stateful observation only if it satisfies all of the following conditions:

1. Check lifecycle is `LIVE`.
2. Job and attempt identities are valid and have not been previously applied.
3. Run mode is `STATEFUL`.
4. Probe generation matches the check's current probe generation.
5. Schedule generation is valid.
6. Fencing token is strictly greater than the last accepted fencing token on current state.
7. Terminal outcome is classified as target `PASS` or `FAIL`.

Rejection reasons are tracked as a stable enum:

- `DUPLICATE_RUN`
- `ATTEMPT_NOT_CURRENT`
- `CHECK_DELETED`
- `DIAGNOSTIC_RUN`
- `CHECK_PAUSED`
- `PROBE_GENERATION_MISMATCH`
- `SCHEDULE_GENERATION_MISMATCH`
- `STALE_FENCING_TOKEN`

Rejected runs remain in immutable audit tables but exert zero influence on health states, incidents, availability calculations, or alert dispatchers. Engine crashes or network partition errors are classified as infrastructure faults rather than target probe failures.

## 6. Freshness State Machine

```text
STALE ──accepted observation──> FRESH
FRESH ──fresh_until elapsed───> STALE
FRESH ──pause/config reset────> STALE
```

| Current | Trigger | Next | Domain Effect |
| --- | --- | --- | --- |
| STALE | Accepted PASS/FAIL | FRESH | Recomputes `fresh_until` deadline. |
| FRESH | Accepted PASS/FAIL | FRESH | Advances `fresh_until` deadline. |
| FRESH | Clock > fresh_until | STALE | Clears failure candidate, closes open incident segment at `fresh_until`, timeline transitions to UNKNOWN. |
| Any | Pause | STALE | State becomes unobserved. |
| Any | Probe config changed | STALE | Obsoletes past observations. |
| FRESH | Interval changed | FRESH or STALE | Recomputes `fresh_until` against latest accepted run and new interval. |

`last_observed_health` is preserved. Effective health presented to clients:

```text
effective_health = freshness == STALE ? UNKNOWN : last_observed_health
```

## 7. Health State Machine

Only accepted stateful observations trigger health state transitions.

| Last Observed Health | Outcome | Next Health | Candidate | Incident Action |
| --- | --- | --- | --- | --- |
| UNKNOWN | PASS | UP | None | None |
| UNKNOWN | FAIL | SUSPECT | Initiated | None |
| UP | PASS | UP | None | None |
| UP | FAIL | SUSPECT | Initiated | None |
| SUSPECT | PASS | UP | Cleared | Provisional interval finalized as UP. |
| SUSPECT | FAIL | DOWN | Confirmed | Opens incident; start time backdated to first FAIL. |
| DOWN | FAIL | DOWN | None | Active incident segment continues. |
| DOWN | PASS | UP | None | Active segment and incident closed with `RECOVERED`. |

When an active incident is `UNOBSERVED`, effective health is UNKNOWN:

| Open Incident | New Accepted Outcome | Behavior |
| --- | --- | --- |
| UNOBSERVED | FAIL | Health transitions to DOWN, opens new observed segment under existing incident; zero duplicate alerts emitted. |
| UNOBSERVED | PASS | Health transitions to UP, closes incident with `RECOVERED`. |

### Provisional SUSPECT Timeline Semantics

- The time interval following an initial FAIL is treated as `PROVISIONAL`.
- If a subsequent consecutive FAIL occurs, the provisional interval is finalized retroactively as DOWN starting from the initial failure timestamp.
- If a subsequent PASS occurs, the provisional interval resolves to UP.
- Pausing, stale deadlines, configuration edits, or deletions clear the candidate; unfinalized intervals transition to UNKNOWN.
- The initial failed `CheckRun` is never expunged from historical records.

## 8. Incident State Machine

Persistence status is `OPEN` or `CLOSED`; observation mode is `OBSERVED` or `UNOBSERVED`.

```text
NONE
  └─threshold reached──> OPEN + OBSERVED
                            │
                            ├─freshness gap/pause──> OPEN + UNOBSERVED
                            │                           │
                            │                           ├─FAIL──> OPEN + OBSERVED
                            │                           └─PASS──> CLOSED/RECOVERED
                            │
                            ├─PASS───────────────> CLOSED/RECOVERED
                            ├─probe changed──────> CLOSED/CONFIG_CHANGED
                            └─check deleted──────> CLOSED/CHECK_DELETED
```

| Current | Event | Next | Segment Behavior | Outbox Event |
| --- | --- | --- | --- | --- |
| None | Second consecutive FAIL | OPEN/OBSERVED | Opens initial segment backdated to first FAIL. | `incident.opened` |
| OPEN/OBSERVED | FAIL | Same | Active segment continues. | None |
| OPEN/OBSERVED | PASS | CLOSED/RECOVERED | Closes active segment at PASS timestamp. | `incident.closed:RECOVERED` |
| OPEN/OBSERVED | Freshness stale | OPEN/UNOBSERVED | Closes active segment at `fresh_until`. | `incident.observation_suspended` |
| OPEN/OBSERVED | Pause | OPEN/UNOBSERVED | Closes active segment at pause timestamp. | `incident.observation_suspended` |
| OPEN/UNOBSERVED | FAIL | OPEN/OBSERVED | Opens new segment at FAIL timestamp. | `incident.observation_resumed` |
| OPEN/UNOBSERVED | PASS | CLOSED/RECOVERED | No new segment opened. | `incident.closed:RECOVERED` |
| OPEN | Probe config changed | CLOSED/CONFIG_CHANGED | Closes active segment at edit timestamp. | `incident.closed:CONFIG_CHANGED` |
| OPEN | Check deleted | CLOSED/CHECK_DELETED | Closes active segment at deletion timestamp. | `incident.closed:CHECK_DELETED` |

Total `observed_duration` equals the sum of closed segments plus the elapsed duration of active open segments. Unobserved gap periods never increment observed downtime duration.

## 9. Availability Timeline State Machine

Timeline interval classifications:

- `UP`
- `DOWN`
- `UNKNOWN`
- `PROVISIONAL`

Transitions:

| Event | Timeline Effect |
| --- | --- |
| First accepted PASS | UP starting from timestamp. |
| First accepted FAIL | PROVISIONAL starting from timestamp. |
| Second consecutive FAIL | Resolves PROVISIONAL -> DOWN from candidate start timestamp. |
| PASS following SUSPECT | Resolves PROVISIONAL -> UP from candidate start timestamp. |
| PASS following DOWN | DOWN terminates at PASS timestamp; UP commences. |
| Exceeding `fresh_until` | Known interval terminates; UNKNOWN commences. |
| Pause command | UNKNOWN commences at pause timestamp. |
| Resume command | UNKNOWN until first accepted observation. |
| Probe config edit | UNKNOWN commencing at edit timestamp. |
| Delete command | Historical queries terminate at deletion; retention policies govern archiving. |

Availability percentages are computed exclusively from finalized UP and DOWN durations. Open PROVISIONAL intervals are displayed as "pending classification" and excluded from availability denominators until resolved.

## 10. Maintenance State Machine

User-persisted maintenance lifecycle:

```text
SCHEDULED ──cancel──> CANCELLED
```

Time-derived effective state:

| Condition | Effective State |
| --- | --- |
| Cancelled | CANCELLED |
| now < starts_at | UPCOMING |
| starts_at <= now < ends_at | ACTIVE |
| now >= ends_at | ENDED |

Effective maintenance evaluation for a check:

```text
direct active maintenance OR current group's active maintenance
```

If multiple windows overlap, alert suppression persists until all active windows terminate. Creating, updating, or cancelling maintenance windows never alters health states or incidents; it triggers notification reconciliation sweeps.

## 11. Notification Intent State Machine

```text
PENDING_EVALUATION
   ├─incident no longer eligible────────────> CANCELLED
   ├─maintenance active─────────────────────> DEFERRED_MAINTENANCE
   └─eligible recipients found──────────────> MATERIALIZED

DEFERRED_MAINTENANCE
   ├─still maintained───────────────────────> DEFERRED_MAINTENANCE
   ├─incident recovered without sent DOWN──> CANCELLED
   └─maintenance ended + still eligible────> MATERIALIZED
```

`MATERIALIZED` is the terminal intent state indicating that recipient-level delivery tasks have been idempotently created. The absence of recipients is logged as a terminal `NO_RECIPIENTS` state for observability.

## 12. Notification Delivery State Machine

```text
PENDING ──claim──> PROCESSING ──provider success──> SENT
                       │
                       ├─known failure, retryable──> RETRY_WAIT ──due──> PENDING
                       ├─permanent failure─────────> FAILED
                       ├─outcome unknowable────────> DELIVERY_UNKNOWN
                       └─no longer eligible────────> CANCELLED
```

| State | Description |
| --- | --- |
| PENDING | Queued for outbound delivery. |
| PROCESSING | Acquired under lease by a notification worker instance. |
| RETRY_WAIT | Suspended in backoff sleep until next retry window. |
| SENT | Confirmed successful dispatch with provider receipt timestamp. |
| FAILED | Terminal error or retry budget exhausted. |
| DELIVERY_UNKNOWN | Ambiguous SMTP response; requires operator inspection to prevent duplicate spam. |
| CANCELLED | Obsoleted prior to transmission due to incident resolution or policy deletion. |

A RECOVERY notification is never dispatched unless a corresponding DOWN notification reached `SENT`. Incidents with `DELIVERY_UNKNOWN` DOWN deliveries do not trigger automated recovery emails.

## 13. Recipient State Machine

```text
PENDING_VERIFICATION ──valid token──> VERIFIED ──disable──> DISABLED
          │                               │
          └─expire/resend──> PENDING      └─reverify new address──> PENDING
```

Modifying an email address generates a new recipient record or requires re-verification. Non-verified addresses are excluded from alert materialization.

## 14. Public Page State Machine

```text
DRAFT ──publish──> PUBLISHED ──disable──> DISABLED
  ▲                    │                     │
  └────unpublish───────┘                     └─republish/new slug──> PUBLISHED
```

- Publishing mandates at least one visible component.
- Mutating components, visibility toggles, or slugs increments the page revision counter.
- Disabling or rotating slugs invalidates historical public URLs immediately.
- Republishing generates a fresh high-entropy slug by default.

## 15. Prediction Status Projection

Prediction metrics do not represent health states. Derived effective status:

| Condition | Projected Status |
| --- | --- |
| Predictor disabled | DISABLED |
| No scores generated | UNAVAILABLE |
| `now < valid_until` | CURRENT |
| `now >= valid_until` | STALE |
| Analysis error | UNAVAILABLE or last score projected as STALE |

Predictions never dispatch events to Check health or Incident state machines. Only explicitly enabled predictive warning policies can generate notification intents.

## 16. Group Projection State Machine

Group health is a dynamic projection derived from member check snapshots:

```text
DOWN > SUSPECT > UNKNOWN > UP
```

| Member Check Set | Group Health Projection |
| --- | --- |
| At least one fresh DOWN | DOWN |
| Zero DOWN, at least one fresh SUSPECT | SUSPECT |
| Zero DOWN/SUSPECT, at least one stale/UNKNOWN | UNKNOWN |
| All included checks fresh UP | UP |
| Zero active checks, paused checks present | Health UNKNOWN, execution PAUSED |
| Zero checks attached | Health UNKNOWN, empty flag true |

Paused and deleted checks are excluded from health calculations. Group maintenance status is evaluated independently as `NONE`, `PARTIAL`, or `FULL`.

## 17. End-to-End Execution Sequences

### 17.1 Transient Single Failure

```text
UP
-> FAIL: Health SUSPECT, opens candidate, zero alert emails
-> PASS: Health UP, candidate cleared, zero incidents opened
-> Provisional interval resolved to UP
```

### 17.2 Confirmed Outage

```text
UP
-> FAIL #1: Health SUSPECT
-> FAIL #2: Health DOWN, incident opens (started_at = FAIL #1, confirmed_at = FAIL #2)
-> DOWN notification dispatched
-> FAIL #3..N: Same incident continues, zero duplicate emails
-> PASS: Incident closed (RECOVERED), observed duration calculated
-> RECOVERY notification dispatched to recipients who received initial DOWN alert
```

### 17.3 Outage Within Maintenance Window

```text
Maintenance ACTIVE
-> FAIL #1
-> FAIL #2: Incident opens, DOWN notification intent DEFERRED
-> Maintenance concludes
-> Incident remains open: DOWN notification materialized and dispatched
-> PASS: Incident closes, RECOVERY notification dispatched
```

If the incident resolves before maintenance concludes, both DOWN and RECOVERY notifications are cancelled.

### 17.4 Monitoring Data Gap During Active Incident

```text
DOWN + Incident OPEN/OBSERVED
-> Exceeds fresh_until: Health UNKNOWN, active segment closes, incident OPEN/UNOBSERVED
-> Data gap interval excluded from availability metrics
-> Fresh FAIL: Same incident resumes, opens new segment, zero duplicate DOWN emails
-> PASS: Incident closes (RECOVERED), duration sums only active DOWN segments
```

### 17.5 Probe Configuration Change During Outage

```text
DOWN + Active Incident
-> Target URL, status expectation, or timeout modified
-> Probe generation increments
-> In-flight jobs invalidated for state evaluation
-> Incident terminates with CONFIG_CHANGED
-> Effective health resets to UNKNOWN
-> Immediate probe scheduled under new configuration
```

Closing notices may be dispatched to alert recipients clarifying that resolution was triggered by reconfiguration rather than confirmed recovery.

### 17.6 Pausing and Diagnostic Manual Probe

```text
ACTIVE / DOWN
-> Pause: State PAUSED, active segment closes, incident OPEN/UNOBSERVED
-> Manual run FAIL: Recorded to history as DIAGNOSTIC; incident unaffected
-> Resume: State ACTIVE, effective health UNKNOWN
-> Scheduled PASS: Incident closes with RECOVERED
```

## 18. Invariants Enforced by Automated Testing

- At most one open incident exists per check at any time.
- At most one accepted fencing sequence updates state per check.
- Stale generations and obsolete fencing tokens cannot mutate current state.
- Diagnostic runs cannot mutate health states or availability calculations.
- A single probe failure cannot open an incident.
- Data gaps are excluded from observed downtime durations.
- A closed incident cannot be reopened.
- Maintenance windows cannot alter health evaluations.
- RECOVERY notifications are never sent to recipients who did not receive initial DOWN alerts.
- Public projections strictly omit non-allowlisted configuration fields.
- Prediction outputs cannot trigger core health or incident transitions.
