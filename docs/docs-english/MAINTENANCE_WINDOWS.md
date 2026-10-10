# Maintenance Windows Architecture

**Status:** Completed and verified  
**Date:** 2026-10-10 15:46 +06:00  
**Dependencies:** Stage 6 check/group management, Stage 8 health/incident model, Stage 9 durable worker and outbox infrastructure  
**Downstream Boundary:** Email recipients, policy resolution, and SMTP delivery state machines belong to Stage 11.

## 1. Purpose

Maintenance windows do not pause check executions or alter genuine health and incident calculations. They strictly suppress and defer outbound DOWN and RECOVERY alert notifications during scheduled windows. Management dashboards and public status pages continue displaying real-time target health; maintenance is presented as an independent operational axis.

This architecture preserves the following invariants:

- Maintenance never alters health states or fabricates artificial `UP`, `DOWN`, or incident transitions.
- Check and group targets strictly respect tenant ownership boundaries.
- All timestamps use UTC `timestamptz`, and interval ranges are evaluated as half-open `[starts_at, ends_at)`.
- Overlapping direct check and group windows evaluate under union semantics.
- Process crashes or worker restarts never drop notification decisions at window conclusion.
- Window mutations commit atomically with domain audit and outbox records.

## 2. In Scope vs. Out of Scope

### In Scope for This Stage

- CRUD APIs for check-targeted or group-targeted maintenance windows
- Multi-tenant ownership, RLS enforcement, optimistic concurrency, and idempotent creation
- Derived lifecycle states: `UPCOMING`, `ACTIVE`, `ENDED`, `CANCELLED`
- Overlapping window evaluation, active window mutation, and cancellation mechanics
- Maintenance projections in check and group read models
- Real-time maintenance reassessment upon check group membership changes
- Automated cancellation of upcoming/active windows upon check or group deletion
- A unified, shared "effective maintenance" query interface for notification engines
- Transactional outbox events, audit trails, and clock-controlled test suites

### Out of Scope for This Stage

- Recurring calendar or cron-based maintenance schedules
- Organization or role-based permission hierarchies
- Pausing HTTP probes during maintenance
- Email templates, recipient/policy resolution, and SMTP delivery retries
- Public status page projections and live SSE streaming
- Backdating or retroactively modifying past completed maintenance windows

## 3. Persistent Data Model

The PostgreSQL table `app.maintenance_windows` remains the single source of truth:

| Column                     | Rule / Constraint                                                                 |
| -------------------------- | --------------------------------------------------------------------------------- |
| `id`                       | UUIDv7 primary key                                                               |
| `owner_id`                 | Tenant owner; enforces RLS and composite foreign key boundaries                   |
| `check_id` / `group_id`    | Mutually exclusive; exactly one target populated; immutable after creation        |
| `note`                     | `varchar(1000) NULL`; user note, omitted from log and event payloads               |
| `starts_at`, `ends_at`     | UTC timestamps; enforces `ends_at > starts_at`                                    |
| `state`                    | Persistent command state only: `SCHEDULED` or `CANCELLED`                         |
| `cancelled_at`             | Populated exclusively for `CANCELLED` windows                                     |
| `resource_version`         | Monotonic counter providing strong ETag versioning                                |
| `created_at`, `updated_at` | Database-generated audit timestamps                                              |

The historical `name varchar(160) NOT NULL` column conflicted with the nullable `note` specification in OpenAPI contracts. Revision 15 migrated this column to `note varchar(1000) NULL` without data loss. Maintenance windows require no mandatory titles under product requirements.

`ACTIVE` and `ENDED` states are not stored in database columns. For database evaluation time `t` captured in a single transaction, public lifecycle states are derived dynamically:

```text
state = CANCELLED                                  -> CANCELLED
state = SCHEDULED and t < starts_at                -> UPCOMING
state = SCHEDULED and starts_at <= t < ends_at     -> ACTIVE
state = SCHEDULED and ends_at <= t                 -> ENDED
```

This design eliminates race conditions where timer delays or process restarts leave stale status values in persistent storage.

## 4. Effective Maintenance Evaluation

A check `c` is under active maintenance at database time `t` if:

```text
exists scheduled window w where
  w.owner_id = c.owner_id
  and w.starts_at <= t
  and t < w.ends_at
  and (
    w.check_id = c.id
    or (w.group_id is not null and w.group_id = c.group_id)
  )
```

Direct check windows and attached group windows evaluate within a unified set. The computed `maintenance.until` value represents the maximum `ends_at` timestamp across all currently active overlapping windows. This timestamp designates the earliest re-evaluation deadline rather than an unalterable dispatch time; if contiguous windows remain active when the deadline arrives, notification evaluation defers again.

Boundary Semantics:

- At `t = starts_at`, maintenance is active.
- At `t = ends_at`, that specific window is no longer active.
- Contiguous windows (where one window's end matches another's start) produce seamless alert suppression without micro-gaps.
- `CANCELLED` records are excluded from active maintenance calculations.

Check listing endpoints, probe observation reducers, and notification workers share identical SQL query logic. Event fields such as `maintenance_suppressed` provide audit diagnostics at emission time but do not serve as authoritative sources of truth for future dispatches.

## 5. Command Operations

### Creation (`POST`)

- Mandatory `Idempotency-Key` header; identical keys and payloads return replayed results; payload mismatches return `409 Conflict`.
- Accepts exactly one `target_type` / `target_id` pair.
- Targets must belong to the authenticated owner and be active; missing or foreign resources return identical `404 Not Found` responses.
- `ends_at` must be in the future relative to transaction time, with `ends_at > starts_at`.
- `starts_at` may reside in the past; if `ends_at` is future-dated, the window is active immediately upon commit. Past dispatched emails are not recalled.
- A configurable active+upcoming window quota is enforced per tenant without hardcoded code limits.

### Modification (`PATCH`)

- Mandatory strong `If-Match` header; stale versions return `412 Precondition Failed`, missing headers return `428 Precondition Required`.
- Target assignments are immutable. To redirect maintenance, cancel the window and create a new one.
- `UPCOMING`: `starts_at`, `ends_at`, and `note` may be updated.
- `ACTIVE`: `starts_at` is immutable; `ends_at` may be extended or shortened (provided it remains in the future); `note` may be edited.
- To terminate active maintenance immediately, issue a `DELETE` / cancel command.
- `ENDED` and `CANCELLED` windows are immutable historical records; patch requests return `409 maintenance_window_immutable`.
- No-op updates emit zero version increments, events, or audit records, returning existing ETags.

### Cancellation (`DELETE`)

- Physical database deletions are prohibited.
- `UPCOMING` or `ACTIVE` windows transition atomically to `CANCELLED`; `cancelled_at` records the database timestamp, and resource versions increment.
- Repeated cancellations bearing matching ETags return `204 No Content`; stale ETags return `412`.
- `ENDED` windows cannot be cancelled and return `409 maintenance_window_immutable`.
- Cancelling an active window terminates maintenance effects immediately and wakes notification reconciliation workers.

## 6. Group Membership and Resource Deletion

Group maintenance scope evaluates dynamically against the check's current `group_id` at query time rather than snapshotting memberships at window creation.

- Moving a check into a group under active maintenance subjects it to maintenance suppression immediately upon commit.
- Removing a check from a group terminates inherited group maintenance immediately, falling back to direct check windows if present.
- `check.group_changed` events trigger notification reconciliation sweeps to re-evaluate active intents against updated memberships.
- Soft-deleting a check cancels all its upcoming or active direct maintenance windows atomically within the same transaction.
- Soft-deleting a group cancels all its upcoming or active group windows atomically; child checks detach into an ungrouped state within the same transaction.
- Previously concluded windows remain intact for historical auditing.

Deletions enforce strict lock acquisition hierarchies: target resource, affected checks, and maintenance rows locked in primary key order.

## 7. Health, Incident, and Alert Semantics

HTTP probes execute on schedule throughout maintenance windows. Run history, current health, freshness deadlines, incident tracking, and group rollups reflect real target metrics. Maintenance strictly governs notification dispatch decisions.

| Scenario                                                      | Operational Outcome                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Incident opens and resolves entirely within maintenance       | DOWN and RECOVERY emails suppressed; intents resolve to `CANCELLED` |
| Incident opens in maintenance and remains open at conclusion  | A single DOWN notification is materialized and dispatched           |
| DOWN alert sent prior to maintenance; incident persists       | Zero duplicate DOWN emails emitted during maintenance               |
| Incident with dispatched DOWN recovers during maintenance     | RECOVERY notification deferred until maintenance window ends        |
| DOWN delivery enqueued but maintenance starts before send     | Deferred during claim-time maintenance recheck                      |
| One maintenance window ends while an overlapping window runs  | Alert suppression persists; deferred until the latest window ends   |
| Check becomes `STALE/UNKNOWN` during maintenance              | Freshness and maintenance displayed independently; no fake recovery |

Notification delivery transactions re-evaluate maintenance status immediately prior to dispatching SMTP payloads, safely resolving races between window modifications and delivery claims.

## 8. Durable Reconciliation

No auxiliary maintenance job tables are introduced. The existing `notification.intents` table acts as the durable reconciliation queue:

1. An incident transition emits a notification intent.
2. If active maintenance is detected, the intent transitions to `DEFERRED_MAINTENANCE`, setting `maintenance_until` to the earliest window expiration.
3. The notification worker claims intents where `maintenance_until <= DB now` in bounded, owner-fair batches.
4. The worker re-reads current check, group, window, incident, and alert policy states from the database.
5. If overlapping windows remain active, the deadline advances; otherwise, delivery tasks materialize or intents cancel per policy.

Natural expirations are processed reliably across service restarts via deadline indexes. To handle early cancellations or scope edits without waiting for stale deadlines, domain mutations emit transactional wake-up events:

- `maintenance.created`
- `maintenance.changed`
- `maintenance.cancelled`
- `check.group_changed`
- `check.deleted`
- `group.deleted`

Events write to the outbox atomically with domain updates, ensuring zero signal loss. Workers handle duplicate wake-ups idempotently. When the `NOTIFICATION` outbox consumer is activated in Stage 11, reconciliation sweeps backfill open intents rather than blindly converting historic events into emails.

`maintenance.reconciliation_requested` serves as an operational trace event indicating that a worker has begun re-evaluating source-of-truth records following a deadline or wake-up trigger.

## 9. API Specification

The implementation adheres to canonical OpenAPI definitions:

- `GET /api/v1/maintenance-windows`
- `POST /api/v1/maintenance-windows`
- `GET /api/v1/maintenance-windows/{window_id}`
- `PATCH /api/v1/maintenance-windows/{window_id}`
- `DELETE /api/v1/maintenance-windows/{window_id}`

Listing queries sort by `starts_at DESC, id DESC` using filter-bound signed cursors. Filters support `state`, `check_id`, `group_id`, `starts_before`, and `ends_after`. Derived states evaluate against a single database timestamp. To prevent pagination drift, cursors embed the initial page's `evaluated_at` timestamp, ensuring consistent lifecycle projections across pages.

Responses normalize target references as `target_type` and `target_id`, returning `id`, target, `starts_at`, `ends_at`, `note`, derived `state`, `resource_version`, `created_at`, and `updated_at`. ETags utilize strong resource-version semantics.

Mutations enforce CSRF protection, origin validation, session authentication, tenant rate limiting, RFC 9457 error formatting, and atomic idempotency. Cross-tenant access attempts return generic `404 Not Found`.

## 10. Events, Audit Trails, and Data Privacy

Domain Events:

- `maintenance.created`: target ID, version, start/end timestamps
- `maintenance.changed`: target ID, version, previous/updated start-end timestamps, `changed_fields`
- `maintenance.cancelled`: target ID, version, `cancelled_at`
- `maintenance.reconciliation_requested`: target ID, `effective_at`, redacted `reason_code`

Notes, email addresses, target URLs, and response bodies are strictly omitted from event, audit, and log payloads. Audit logs record action names, resource IDs, target types, and modified field names. Correlation IDs propagate from API transactions into outbox and reconciliation pipelines.

## 11. Security Roles and Indexes

- The API role holds owner-scoped SELECT, INSERT, and restricted UPDATE privileges; physical `DELETE` permissions are revoked.
- The monitor role holds SELECT privileges solely to query active maintenance status.
- The notification worker reads maintenance source-of-truth tables without update privileges.
- `FORCE ROW LEVEL SECURITY` and composite owner foreign keys are strictly enforced.
- An index on `(owner_id, starts_at DESC, id DESC)` optimizes listing queries.
- Reconciliation workers query the partial `notification_intents_evaluation_idx` index.

Tenant IDs, target IDs, and user notes are excluded from metric label dimensions. Metrics track mutation outcomes, active/upcoming window counts, deferred intents, reconciliation latency, and error codes.

## 12. Race Conditions and Failure Modes

- Mutations acquire row-level locks via `FOR UPDATE` and validate versions within the same statement.
- Target creation acquires row locks on target checks/groups. Concurrent deletions either finish first (causing creation to return `404`) or complete afterward (cancelling the newly created window).
- If window modifications race against notification processing, delivery transactions re-read maintenance states immediately before transmission to make the definitive call.
- Obsolete reconciliation wake-ups evaluate as harmless no-ops against authoritative source-of-truth records.
- If outbox event insertion fails, the entire maintenance mutation rolls back.
- If notification workers go offline, probes, health evaluations, and incident tracking operate normally while deferred intents accumulate safely in persistent storage.

## 13. Verification and Acceptance Evidence

### Pure Domain Unit Tests

- Boundary evaluations at `starts_at - 1 ms`, exact `starts_at`, `ends_at - 1 ms`, and exact `ends_at`
- State transition matrix across upcoming, active, ended, and cancelled windows
- Rejection of active start modifications; valid extensions/shortenings of future ends
- Union calculations and re-evaluation deadlines for overlapping and contiguous windows

### Real PostgreSQL Integration Tests

- Verification that Tenant A cannot inspect or mutate Tenant B's windows
- Creation idempotency replay and payload conflict detection
- Concurrent updates producing exactly one success and one `412 Precondition Failed`
- Direct check and group overlap resolution calculating `max(ends_at)`
- Dynamic scope adjustments upon check group reassignments or unlinking
- Automatic cancellation of active/upcoming windows upon check or group deletion
- Atomic commit of mutations, audit trails, and outbox events with note redaction
- Accurate state derivation from persistent records following process restarts

### Stage 10 Closing Scenarios

- Probes and incidents continue progressing throughout active maintenance.
- Single transient failures during maintenance track normal incident thresholds.
- Incidents that open and resolve entirely within maintenance yield a "suppress" alert decision.
- Incidents open at maintenance conclusion produce a single DOWN alert; recoveries during maintenance yield a single deferred RECOVERY alert.
- Expiration of one overlapping window preserves suppression until the final window concludes.
