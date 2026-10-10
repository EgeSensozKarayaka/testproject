# Domain Event Catalog

**Stage:** 4 — API, Event, and Error Contracts

**Status:** Approved; shared envelope/type allowlist implemented, producers will be added in corresponding domain stages

**Date:** 2026-10-10

**Related documents:** [`DOMAIN_MODEL.md`](./DOMAIN_MODEL.md), [`STATE_MACHINES.md`](./STATE_MACHINES.md), [`REALTIME_CONTRACT.md`](./REALTIME_CONTRACT.md)

## 1. Purpose and Boundaries

This catalog serves as the v1 contract for internal domain/integration events produced transactionally. Events loosely couple the worker, notification, realtime projection, audit, and predictor components. These are not direct browser SSE payloads; only allowlisted projections outlined in [`REALTIME_CONTRACT.md`](./REALTIME_CONTRACT.md) are exposed externally.

The PostgreSQL transactional outbox is the persistent source of delivery. `LISTEN/NOTIFY` is solely a drop-prone wake-up signal indicating that new records exist; it is not event data or a persistence mechanism.

## 2. Common Event Envelope v1

```json
{
  "event_id": "0192f82c-f949-72d8-bef2-461c4484df2c",
  "event_type": "check.health_changed",
  "schema_version": 1,
  "occurred_at": "2026-10-10T03:10:11.482Z",
  "recorded_at": "2026-10-10T03:10:11.489Z",
  "owner_id": "0192f7a7-dbd6-762b-9495-47ee57ef0f80",
  "aggregate_type": "check_state",
  "aggregate_id": "0192f7c8-548e-7c43-9f79-93cbf7eaf831",
  "aggregate_version": "18",
  "correlation_id": "0192f82c-08e8-77d0-8f85-29888b2a718d",
  "causation_id": "0192f82c-4291-759b-90b4-d6e43cdf281e",
  "payload": {}
}
```

| Field               | Rule                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `event_id`          | UUIDv7; immutable global event identifier and consumer idempotency key.                                           |
| `event_type`        | Lowercase dotted name defined in this catalog.                                                                    |
| `schema_version`    | Payload version for the same event type; initial version is `1`.                                                  |
| `occurred_at`       | UTC timestamp of the domain event. In delayed writes, it may be older than `recorded_at`.                         |
| `recorded_at`       | UTC timestamp when the outbox row was written in the same transaction; mapped to DB `created_at` in the envelope. |
| `owner_id`          | Mandatory UUID for private events; `null` for system-wide events.                                                 |
| `aggregate_type/id` | Root for event ordering and re-reading.                                                                           |
| `aggregate_version` | Decimal string for versioned aggregates; may be `null` for projection/system events.                              |
| `correlation_id`    | Identifier of the initiating HTTP request, scheduled job, or reconciliation chain.                                |
| `causation_id`      | Direct causing event/command identifier; `null` at the external root.                                             |
| `payload`           | Event-specific, minimal, and versioned data.                                                                      |

Adding new optional fields to the envelope is backward-compatible. Removing an existing field, changing its type/meaning, or making it required necessitates a new `schema_version`.

## 3. Delivery, Ordering, and Consumption Rules

- Delivery semantics are **at-least-once**. There is no claim of exactly-once delivery.
- The producer writes the domain state change and the outbox record in the same DB transaction.
- Consumers act idempotently using the unique `(consumer_name, event_id)` receipt. Business side effects and receipt logging reside within the same transaction where feasible.
- Only the `aggregate_version` sequence within the same `aggregate_type + aggregate_id` is meaningful. There is no global order across different aggregates.
- If a consumer detects a version gap or an unknown version, it does not reconstruct state from the event payload; it re-reads the source's current projection or routes to the dead-letter queue.
- Retries use exponential backoff + jitter. Poison events transition to a visible dead-letter status after bounded retries; they are never dropped silently.
- Once published, an event cannot be modified or deleted. Corrections are issued as a new event or a new schema version.
- Consumers use `occurred_at` for event timing and `recorded_at` for delivery latency; domain ordering is never inferred using wall-clock `now`.

## 4. Data Minimization

Payloads carry identifiers, versions, state transitions, and decision reasons to the greatest extent possible. If consumers require details, they read the owner-scoped source of truth.

Event payloads never contain:

- Passwords/hashes, session tokens, CSRF tokens, reset/verification tokens, or public access tokens;
- Email addresses, SMTP bodies, or headers;
- Full target URL queries/fragments, expected body texts, or response bodies;
- Resolved private IPs, stack traces, or provider secrets.

When target representation is required, safe `check_id` and configuration generations are transported instead of `target_origin`. The notification adapter reads address/template data from the owner-scoped DB.

## 5. Configuration Events

All payload fields in the tables are mandatory in v1; `null` is valid only where explicitly stated.

| Event                               | Aggregate | Payload v1                                                                                                        | Primary Consumers                                             |
| ----------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `user.created`                      | `user`    | `user_id`, `resource_version`                                                                                     | audit, onboarding                                             |
| `user.disabled`                     | `user`    | `user_id`, `resource_version`, `reason_code`                                                                      | session revocation, scheduler, audit                          |
| `check.created`                     | `check`   | `check_id`, `resource_version`, `probe_generation`, `schedule_generation`, `execution_state`, `group_id` nullable | scheduler, realtime, audit                                    |
| `check.metadata_changed`            | `check`   | `check_id`, `resource_version`, `changed_fields[]`                                                                | realtime, audit, public projection                            |
| `check.probe_configuration_changed` | `check`   | `check_id`, `resource_version`, `previous_probe_generation`, `probe_generation`, `changed_fields[]`               | scheduler, state engine, audit                                |
| `check.schedule_changed`            | `check`   | `check_id`, `resource_version`, `previous_schedule_generation`, `schedule_generation`, `interval_seconds`         | scheduler, realtime, audit                                    |
| `check.paused`                      | `check`   | `check_id`, `resource_version`, `probe_generation`, `schedule_generation`, `paused_at`                            | scheduler, realtime, notification reconciliation              |
| `check.resumed`                     | `check`   | `check_id`, `resource_version`, `probe_generation`, `schedule_generation`, `resumed_at`, `next_run_at`            | scheduler, realtime                                           |
| `check.group_changed`               | `check`   | `check_id`, `resource_version`, `previous_group_id` nullable, `group_id` nullable                                 | maintenance, notification policy, public projection, realtime |
| `check.deleted`                     | `check`   | `check_id`, `resource_version`, `deleted_at`                                                                      | scheduler, maintenance, public projection, realtime, audit    |
| `group.created`                     | `group`   | `group_id`, `resource_version`                                                                                    | realtime, audit                                               |
| `group.changed`                     | `group`   | `group_id`, `resource_version`, `changed_fields[]`                                                                | notification policy, public projection, realtime, audit       |
| `group.deleted`                     | `group`   | `group_id`, `resource_version`, `deleted_at`                                                                      | check reassignment, maintenance, public projection, realtime  |

`changed_fields` is an alphabetically sorted allowlist consisting solely of field names; it never carries old/new sensitive values.

## 6. Execution and Health Events

| Event                            | Aggregate     | Payload v1                                                                                                                                                                                  | Primary Consumers                                        |
| -------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `check.manual_run_requested`     | `check`       | `check_id`, `request_id`, `mode` (`STATEFUL`/`DIAGNOSTIC`), `requested_at`, `probe_generation`, `schedule_generation`                                                                       | scheduler, audit                                         |
| `check.job_available`            | `check_job`   | `job_id`, `check_id`, `job_kind`, `not_before`, `probe_generation`, `schedule_generation`                                                                                                   | monitor workers                                          |
| `check.run_recorded`             | `check_run`   | `run_id`, `check_id`, `finished_at`, `outcome` (`PASS`/`FAIL`), `accepted`, `failure_category` nullable, `response_time_ms`, `probe_generation`, `schedule_generation`                      | history, predictor trigger, audit metrics                |
| `check.observation_accepted`     | `check_state` | `check_id`, `run_id`, `finished_at`, `outcome`, `probe_generation`, `state_version`, `previous_health`, `candidate_health`                                                                  | state engine diagnostics, realtime coalescing            |
| `check.observation_rejected`     | `check_run`   | `check_id`, `run_id`, `finished_at`, `reason_code`, `observed_probe_generation`, `current_probe_generation`                                                                                 | operations metrics, audit                                |
| `check.health_changed`           | `check_state` | `check_id`, `state_version`, `previous_health`, `health`, `changed_at`, `trigger_run_id`, `active_incident_id` nullable                                                                     | history diagnostics, public projection, realtime         |
| `check.freshness_changed`        | `check_state` | `check_id`, `state_version`, `previous_freshness`, `freshness`, `changed_at`, `reason_code`                                                                                                 | operations, public projection, realtime                  |
| `incident.opened`                | `incident`    | `incident_id`, `check_id`, `resource_version`, `started_at`, `confirmed_at`, `trigger_run_id`, `maintenance_suppressed`                                                                     | notification intent, realtime, public projection         |
| `incident.observation_suspended` | `incident`    | `incident_id`, `check_id`, `resource_version`, `segment_id`, `suspended_at`, `reason_code`                                                                                                  | history, realtime                                        |
| `incident.observation_resumed`   | `incident`    | `incident_id`, `check_id`, `resource_version`, `segment_id`, `resumed_at`, `reason_code`                                                                                                    | history, realtime                                        |
| `incident.closed`                | `incident`    | `incident_id`, `check_id`, `resource_version`, `started_at`, `ended_at`, `closure_reason`, `observed_duration_ms`, `wall_duration_ms`, `recovery_run_id` nullable, `maintenance_suppressed` | notification intent, realtime, public projection, rollup |

A `check.run_recorded.accepted=false` outcome is retained in history but produces neither health updates nor incidents. The canonical allowlist for `check.observation_rejected.reason_code` is: `DUPLICATE_RUN`, `ATTEMPT_NOT_CURRENT`, `CHECK_DELETED`, `DIAGNOSTIC_RUN`, `CHECK_PAUSED`, `PROBE_GENERATION_MISMATCH`, `SCHEDULE_GENERATION_MISMATCH`, and `STALE_FENCING_TOKEN`. An engine/programming failure is not a target run and is never published as `FAIL` via this event.

## 7. Maintenance and Notification Events

| Event                                  | Aggregate                | Payload v1                                                                                                                             | Primary Consumers                                      |
| -------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `maintenance.created`                  | `maintenance_window`     | `maintenance_id`, `resource_version`, `target_type`, `target_id`, `starts_at`, `ends_at`                                               | reconciliation scheduler, realtime, audit              |
| `maintenance.changed`                  | `maintenance_window`     | `maintenance_id`, `resource_version`, `target_type`, `target_id`, `previous_starts_at`, `previous_ends_at`, `starts_at`, `ends_at`     | reconciliation scheduler, notification, realtime       |
| `maintenance.cancelled`                | `maintenance_window`     | `maintenance_id`, `resource_version`, `target_type`, `target_id`, `cancelled_at`                                                       | notification reconciliation, realtime, audit           |
| `maintenance.reconciliation_requested` | `maintenance_window`     | `maintenance_id`, `target_type`, `target_id`, `effective_at`, `reason_code`                                                            | maintenance reconciler                                 |
| `notification.recipient_created`       | `notification_recipient` | `recipient_id`, `resource_version`, `verification_state`                                                                               | verification sender, realtime, audit                   |
| `notification.recipient_reactivated`   | `notification_recipient` | `recipient_id`, `resource_version`                                                                                                     | verification sender, realtime, audit                   |
| `notification.recipient_verified`      | `notification_recipient` | `recipient_id`, `resource_version`, `verified_at`                                                                                      | notification policy, realtime, audit                   |
| `notification.recipient_disabled`      | `notification_recipient` | `recipient_id`, `resource_version`, `disabled_at`                                                                                      | delivery cancellation, policy reconciliation, realtime |
| `notification.policy_changed`          | `notification_policy`    | `policy_id`, `resource_version`, `scope_type`, `scope_id` nullable, `mode`, `recipient_ids[]`                                          | notification evaluator, realtime, audit                |
| `notification.intent_created`          | `notification_intent`    | `intent_id`, `incident_id`, `check_id`, `kind` (`DOWN`/`RECOVERY`), `decision`, `suppression_reason` nullable, `evaluate_at` nullable  | delivery planner, audit                                |
| `notification.delivery_scheduled`      | `notification_delivery`  | `delivery_id`, `intent_id`, `recipient_id`, `kind`, `attempt`, `not_before`                                                            | notification worker                                    |
| `notification.delivery_sent`           | `notification_delivery`  | `delivery_id`, `intent_id`, `recipient_id`, `kind`, `attempt`, `sent_at`, `provider_message_ref_hash` nullable                         | operations, audit                                      |
| `notification.delivery_failed`         | `notification_delivery`  | `delivery_id`, `intent_id`, `recipient_id`, `kind`, `attempt`, `failed_at`, `failure_category`, `terminal`, `next_attempt_at` nullable | retry scheduler, operations, audit                     |

Email addresses are not placed in events. `provider_message_ref_hash` is a one-way/truncated value for tracing purposes; it is neither a provider token nor a raw message ID.

A separate `maintenance.ended` event is not mandatory upon maintenance conclusion: when the time comes, a persistent reconciliation job reads the source of truth and produces `maintenance.reconciliation_requested`. Consequently, even if a timer signal is lost during a process restart, notifications are not missed.

## 8. Public Page and Prediction Events

| Event                      | Aggregate            | Payload v1                                                                                                   | Primary Consumers                              |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `public_page.published`    | `public_status_page` | `page_id`, `resource_version`, `published_at`, `page_revision`                                               | public snapshot, realtime, audit               |
| `public_page.changed`      | `public_status_page` | `page_id`, `resource_version`, `page_revision` nullable, `changed_fields[]`                                  | public snapshot, realtime, audit               |
| `public_page.link_rotated` | `public_status_page` | `page_id`, `resource_version`, `rotated_at`, `page_revision`                                                 | cache invalidation, realtime disconnect, audit |
| `public_page.disabled`     | `public_status_page` | `page_id`, `resource_version`, `disabled_at`, `page_revision` nullable                                       | cache invalidation, realtime disconnect, audit |
| `prediction.requested`     | `prediction_job`     | `prediction_job_id`, `check_id`, `feature_cutoff_at`, `algorithm_version`                                    | Python predictor                               |
| `prediction.updated`       | `prediction_score`   | `prediction_id`, `check_id`, `prediction_version`, `risk_level`, `score`, `valid_until`, `algorithm_version` | realtime, private UI                           |
| `prediction.expired`       | `prediction_score`   | `prediction_id`, `check_id`, `prediction_version`, `expired_at`, `reason_code`                               | realtime, private UI                           |

Raw public tokens never enter events. `page_revision` is a decimal string used for public snapshot/SSE ordering; it may be null in states without a snapshot. Prediction explanation/feature values are not placed in events; private endpoints read them from the source of truth. No consumer of prediction events can alter check health, incident, or notification state.

## 9. Producer and Destination Matrix

The implemented Stage 3 schema admits only four durable destinations; Stage 4 does not expand this list secretly:

| DB Destination | Responsibility                                                                         |
| -------------- | -------------------------------------------------------------------------------------- |
| `REALTIME`     | Private query invalidation, public snapshot regeneration, and SSE projection signaling |
| `NOTIFICATION` | Incident/maintenance/policy evaluation, intent, and delivery generation                |
| `PREDICTION`   | Coalesced analysis requests; does not block the main pipeline if disabled or degraded  |
| `AUDIT`        | Redacted, immutable audit trail                                                        |

The scheduler's source of truth is `monitoring.check_jobs`, the history/rollup source of truth is the run/interval tables, and the maintenance conclusion source of truth is the maintenance table + persistent reconciliation jobs; these are not new outbox destination names. Catalog events such as `check.job_available` represent observable/auditable domain facts, but job claiming is never bound to outbox delivery.

A destination is not a physical topic name; it is an `infra.outbox_dispatches.destination` value. A single canonical event can be fanned out to more than one of the four required destinations via separate dispatch rows. A global bus that broadcasts full payloads to consumers without need is never established. If a new durable consumer class is required, existing migration/check constraints are not modified; a reviewed forward-only migration is required.

Defining a destination in the catalog does not imply that the consumer is ready in deployment. The producer emits events/dispatches only for destinations possessing a migration-owned `infra.destination_activations` record. Prior to activation, snapshots/reconciliation/backfills are prepared from source-of-truth tables; after activation, transient failures of a consumer do not halt dispatch generation. This prevents unbounded backlogs and old notification replays on initial startup for consumers that have not yet been written. Detailed cutover rules are located in [`SCHEDULER_AND_WORKERS.md`](./SCHEDULER_AND_WORKERS.md).

## 10. Schema Evolution

1. New optional payload fields can be added in v1; consumers ignore unknown fields.
2. New required fields, field removals/renames, enum semantics changes, or unit changes require `schema_version: 2`.
3. During transition periods, the producer verifies compatibility between old and new consumers; if necessary, dual-publishing is conducted via separate outbox records.
4. Consumers do not acknowledge major event schemas they do not support; they generate visible dead-letter records and alerts.
5. Event names cannot be reused with altered historical semantics.
6. A payload change that expands PII classification requires not just a version bump, but also a security review.

## 11. Realtime Projection Mapping

Internal events are not transmitted one-to-one to the browser. The realtime projector coalesces events into the following external families based on owner/page allowlists:

| Internal Family               | Private SSE                             | Public SSE                                                |
| ----------------------------- | --------------------------------------- | --------------------------------------------------------- |
| Check config/health/freshness | `check.changed`, `check.status_changed` | `status_page.updated` only if it is a published component |
| Group/config                  | `group.changed`, `group.status_changed` | `status_page.updated` only if it is a published component |
| Incident                      | `incident.changed`                      | `status_page.updated` only if visibility is permitted     |
| Maintenance                   | `maintenance.changed`                   | `status_page.updated` only if component is published      |
| Notification                  | `notification.changed`                  | Never                                                     |
| Public config                 | `public_page.changed`                   | `status_page.updated` or stream closure                   |
| Prediction                    | `prediction.changed`                    | Never by default; if allowlisted, in a future version     |

The SSE payload is not the event source of truth; a client that misses events reconciles via REST snapshots.

## 12. Verification Gate

Before and after implementation, the following are verified:

- Every state-changing transaction commits either both domain changes + outbox or neither.
- When the same `event_id` is consumed twice, only a single business side effect occurs.
- The version ordering of the same aggregate is preserved; no global order is assumed across different aggregates.
- Unknown events/versions explicitly generate dead-letter entries and metrics.
- Event serialization passes schema validation tests; decimal versions are not represented as JSON numbers.
- Owner events never leak into incorrect consumer/owner streams.
- Tokens, email addresses, target secrets/queries, expected bodies, and response bodies are not found in payloads or logs.
- When the predictor is disabled/degraded, primary outbox and monitoring transactions are not blocked.
- Outbox backlog/retries/dead-letters are observable and can be safely reprocessed.
