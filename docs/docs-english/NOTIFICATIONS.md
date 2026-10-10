# Transactional Email and Notification System Architecture

**Status:** Final pre-implementation design; ready for review  
**Date:** 2026-10-10 16:27 +06:00  
**Dependencies:** Stage 5 auth email queue, Stage 8 incident model, Stage 9 outbox/lease infrastructure, Stage 10 maintenance gate  
**Next stage boundary:** History/rollup and retention belong to Stage 12.

## 1. Purpose and Invariants

This stage reliably delivers confirmed incident transitions to user-verified email recipients. SMTP or notification worker failure must not compromise monitoring, API, or incident correctness.

Invariants to preserve:

- A single transient measurement failure does not produce an email; only a confirmed incident opening constitutes a DOWN intent.
- For a given incident and recipient, there exists at most one DOWN and at most one regular RECOVERY delivery record.
- Repeated FAIL results do not generate new intents or deliveries.
- RECOVERY is never sent to a recipient without a successful DOWN delivery.
- Maintenance does not halt health/incident flows; the delivery decision is verified against the fresh source of truth both during intent evaluation and at delivery claim time.
- Email addresses can only originate from a VERIFIED recipient record of the same owner.
- API or monitor transactions never invoke SMTP.
- Retry/lease races from the same worker or multiple replicas cannot create duplicate durable deliveries.
- Absolute exactly-once delivery is not claimed over SMTP. Dispatches whose outcome cannot be proven become `DELIVERY_UNKNOWN` and are not automatically retried.
- URL, expected body, response body, token, and email address are never written to log, event, or metric fields.

## 2. Scope

### In Scope

- Owner-scoped recipient CRUD, verification, and test email to verified recipients
- User default policy and group override/inherit model
- Outbox consumption of `incident.opened` and `incident.closed`
- Idempotent intent evaluation and per-recipient delivery materialization
- Maintenance defer/cancel/reconciliation behavior
- Matching DOWN, RECOVERY, and non-recovery closures
- Lease/fencing, retry/backoff, terminal failure, and ambiguous result policies
- HTML + plain text templates and Mailpit acceptance flows
- Multi-replica safety, restart recovery, observability, and safe cutover

### Out of Scope

- SMS, webhooks, push notifications, or third-party incident management
- User-editable HTML templates
- Digests, escalation chains, quiet hours, or recurring reminders
- Organization/role-based recipient sharing
- Provider dashboard or billing integrations
- Prediction alerts; the predictor is not wired into the primary incident notification path

## 3. Components and Boundaries

### API

The API manages recipient, verification token, and policy mutations within a single owner transaction. Raw verification tokens are stored in the database only as digests, and in the email queue within the existing AES-256-GCM envelope. The API never invokes SMTP.

### `packages/notifications`

Encapsulates framework- and I/O-independent domain rules:

- Policy resolution
- Intent eligibility
- Stage 10 maintenance gate
- DOWN/RECOVERY lineage decisions
- Deterministic retry/backoff and SMTP result classification
- Allowlist template payload validation and text/HTML rendering

### Notification Worker

Executes four non-blocking bounded loops within the same deployable process:

1. `NOTIFICATION` outbox dispatch claim/consume
2. Pending/deferred intent evaluation and deadline reconciliation
3. Operational incident delivery claim/send/complete
4. Transactional email claim/send/complete carrying account/recipient verifications and test emails

Loops fairly share the same global SMTP concurrency budget; the auth/verification queue has priority but cannot starve the incident queue. PostgreSQL connections are never held during an SMTP call.

### SMTP Adapter

Nodemailer serves solely as an adapter. The domain classifies outcomes as `SENT`, `RETRY`, `FAILED`, or `DELIVERY_UNKNOWN`. Mailpit is used locally; in production, TLS and credential configuration are validated fail-fast.

## 4. Revision 16 Persistence Plan

Existing tables are preserved; applied migration history is never altered.

### 4.1 Recipient and Verification Queue

`notification.recipients` remains the source of truth. Lifecycle:

```text
PENDING_VERIFICATION -> VERIFIED -> DISABLED
DISABLED --re-add same normalized address--> PENDING_VERIFICATION
```

A single row is maintained per owner and normalized address. Re-adding a disabled address does not produce a new identity; version is incremented, the address returns to pending verification, and a new token is created. Re-adding a VERIFIED or PENDING address with a different idempotency key returns `409 recipient_already_exists`.

`notification.recipient_verification_tokens` does not store raw tokens. A new token transaction consumes prior open tokens.

The existing `notification.transactional_email_deliveries` table is reused for secret-bearing emails:

- `recipient_id uuid NULL` is added with a composite owner FK.
- `VERIFY_NOTIFICATION_RECIPIENT` and `TEST_NOTIFICATION` are added to `purpose` values.
- `recipient_id` is mandatory for recipient purposes and null for auth purposes.
- `CANCELLED` terminal state is added.
- Disabling a recipient cancels open verification/test deliveries.

No new parallel secret queue is established.

### 4.2 Default and Group Policy

Each owner has exactly one default policy with `group_id IS NULL`; each group has exactly one group policy. Revision 16:

- Backfills a `DISABLED` default policy for existing users,
- Backfills missing group policies as `INHERIT`,
- Adds a safe trigger to `auth.users` creating a default policy in the same transaction for new rows.

Policy semantics:

| Scope   | Mode       | Result                                     |
| ------- | ---------- | ------------------------------------------ |
| Default | `DISABLED` | No notifications                           |
| Default | `ACTIVE`   | Own flags and recipient list               |
| Group   | `INHERIT`  | Entire current default policy              |
| Group   | `DISABLED` | Overrides default; no notifications        |
| Group   | `ACTIVE`   | Does not merge with default; own full list |

Ungrouped checks use the default policy. Group membership resolves via the current `check.group_id` at intent materialization time. An `ACTIVE` policy requires at least one VERIFIED recipient, and `notify_recovery=true` is valid only when `notify_down=true`.

Policy responses separate configured and effective results. `effective_policy_id`, `effective_mode`, `effective_notify_down`, `effective_notify_recovery`, `effective_recipient_ids`, and `effective_policy_version` are added to OpenAPI. ETag represents only the target mutation's `resource_version`; because private responses are `no-store`, inherited projections are not used as cache validators.

### 4.3 Intent

`notification.intents` is a durable, idempotent decision record per incident transition. The existing unique `(incident_id,event_kind)` constraint is preserved. Revision 16 adds the following evidence fields:

- `decision_code`: bounded enum; e.g., `READY`, `MAINTENANCE`, `POLICY_DISABLED`, `INCIDENT_CLOSED`, `NO_SENT_DOWN`
- `policy_id_snapshot` and existing `policy_version_snapshot`
- `template_key`, `template_version`, bounded `template_payload jsonb`

Canonical kinds:

- `INCIDENT_OPENED` -> DOWN
- `INCIDENT_RECOVERED` -> True recovery
- `INCIDENT_CLOSED` -> Non-recovery closure for `CONFIG_CHANGED` or `CHECK_DELETED`

Intent states:

```text
PENDING_EVALUATION
  -> DEFERRED_MAINTENANCE
  -> MATERIALIZED
  -> CANCELLED
  -> NO_RECIPIENTS

DEFERRED_MAINTENANCE
  -> DEFERRED_MAINTENANCE
  -> MATERIALIZED
  -> CANCELLED
  -> NO_RECIPIENTS
```

`MATERIALIZED` denotes that delivery records have been atomically created; it does not indicate that the email has been sent.

### 4.4 Operational Delivery and Attempt Journal

`notification.deliveries` represents a durable delivery record per recipient. Revision 16:

- Adds `DEFERRED_MAINTENANCE` state and `maintenance_until`,
- Adds `related_down_delivery_id` self-FK linking recovery/closure deliveries to the exact DOWN delivery,
- Stores the `notify_recovery` decision at DOWN time as `recovery_enabled_snapshot`,
- Adds `cancel_requested_at` and bounded `cancellation_reason`,
- Updates claim/retry/deadline indexes with the new states.

A new append-only `notification.delivery_attempts` table, uniquely keyed by `(delivery_id, attempt_number)`, records claim timestamp, fence, completion timestamp, outcome category, sanitized result code, and provider message reference digest. Raw SMTP error strings, recipient addresses, and payloads are never written to the attempt journal.

The template payload is snapshotted once on the intent; even if check name or incident data changes during retries, message content remains immutable. The recipient address is snapshotted on the delivery. If the recipient is explicitly DISABLED, unsent snapshots are cancelled.

### 4.5 Database Access Boundaries

Revision 16 exposes claim/complete, recipient secret-email enqueue, and open-incident cutover enqueue operations through narrow `security_api` functions that validate fences and owners. Unnecessary blanket write privileges over the secret queue or outbox are withheld from the API and notifier. Broad privileges on notification tables are restricted to required columns; the attempt journal remains append-only.

## 5. Recipient and Policy API Rules

Canonical existing endpoints are implemented:

- `GET/POST /api/v1/notification-recipients`
- `DELETE /api/v1/notification-recipients/{recipient_id}`
- `POST /api/v1/notification-recipients/{recipient_id}/verification`
- `POST /api/v1/notification-recipient-verifications/confirm`
- `GET/PUT /api/v1/notification-policies/default`
- `GET/PUT /api/v1/groups/{group_id}/notification-policy`

Added endpoint:

- `POST /api/v1/notification-recipients/{recipient_id}/test-email` -> `202`; VERIFIED recipients only, CSRF + idempotency + strict owner/recipient rate limiting

Mutations follow existing patterns: session authentication, CSRF/origin validation, RFC 9457 error formatting, exact idempotency receipts, and strong ETags. Cross-owner resources appear as `404`. Policy replacement:

1. Locks policy and recipient rows in deterministic ID order,
2. Verifies that all recipients belong to the same owner and are VERIFIED,
3. Atomically replaces the policy-recipient set,
4. Writes version, redacted audit log, and realtime events within the same transaction.

Disabling a recipient returns `409 recipient_in_use` if attached to an ACTIVE policy; it performs no covert policy mutations. The user must update the policy first. PENDING/RETRY test and verification emails are cancelled within the disable transaction.

Public token confirmation returns uniform `422 invalid_or_expired_token` for invalid, expired, consumed, or disabled recipients. Token and email values are never logged.

## 6. Intent Evaluation Algorithm

Every evaluation locks owner, check, incident, and intent within a transaction; event payload is never the source of decision.

### DOWN

1. If the incident is no longer open: `CANCELLED/INCIDENT_CLOSED`.
2. If current direct+group maintenance is active: `DEFERRED_MAINTENANCE`, with `maintenance_until` set to the furthest active end timestamp in the shared DB projection.
3. Resolve current group/default policy.
4. If policy is disabled or `notify_down=false`: `CANCELLED/POLICY_DISABLED`.
5. If there are no VERIFIED recipients: `NO_RECIPIENTS`.
6. Policy/template are snapshotted, unique deliveries are created, and intent transitions to `MATERIALIZED`.

### RECOVERY

1. Read DOWN deliveries in `SENT` state for the same incident.
2. Only lineages where `recovery_enabled_snapshot=true` and the recipient remains VERIFIED are eligible.
3. If no eligible lineage exists: `CANCELLED/NO_SENT_DOWN`.
4. If maintenance is active, recovery is also deferred.
5. For each eligible DOWN delivery, create exactly one RECOVERY delivery linked via `related_down_delivery_id`.

Even if the policy is modified subsequently, the matching recovery decision for a successful DOWN uses the snapshot captured at DOWN time. Explicitly disabling a recipient takes precedence as a security/opt-out measure, suppressing recovery delivery.

### Non-Recovery Closure

`CONFIG_CHANGED` and `CHECK_DELETED` generate a "monitoring changed/stopped" message to recipients who received a successful DOWN delivery and had recovery snapshot enabled; the message makes no claim that the site recovered. Unsent DOWN deliveries are cancelled. If other closure reasons fall outside the allowlist, no email is generated and an observable decision code is recorded.

## 7. Maintenance and Race Conditions

Intent evaluation alone is insufficient: a maintenance window may start after a delivery has materialized. Therefore, the operational delivery claim transaction repeats the following source-of-truth checks immediately prior to SMTP invocation:

- Is the recipient still VERIFIED?
- For DOWN, is the incident still open?
- Has delivery cancellation been requested?
- Is `app.effective_maintenance_until(owner,check,db_now)` populated?

If maintenance is active, delivery transitions to `DEFERRED_MAINTENANCE`; the DB connection is released, and SMTP is not invoked. When the deadline arrives, re-evaluation defers to the new end if another or extended window exists.

Maintenance create/change/cancel, `check.group_changed`, `check.deleted`, and `group.deleted` dispatches awaken affected non-terminal intents/deliveries early. Deadline polling is not tied to in-process timers.

The linearization point for a claim decision versus concurrent maintenance commits is the delivery claim SQL statement. If the claim finalized first, the external SMTP invocation cannot be rolled back; if maintenance became visible first, the claim cannot proceed with dispatch. This race condition is honestly documented.

Race between incident recovery and `PROCESSING` DOWN:

- The in-flight SMTP invocation is not aborted; `cancel_requested_at` is flagged.
- If DOWN completes as `SENT`, a RECOVERY delivery is created for the same lineage.
- If a definitive failure/retry outcome occurs, it transitions to `CANCELLED` instead of scheduling a new retry.
- An ambiguous outcome remains `DELIVERY_UNKNOWN`; no automated RECOVERY or retry occurs due to duplication risks.

## 8. Outbox Consumption and Cutover

The notification dispatch consumer accepts only recognized event and schema versions:

- `incident.opened`, `incident.closed`: Intent creation
- Maintenance and group/check scope events: Reconciliation wake-up
- Recipient/policy events: Cancellation of open secret deliveries or non-terminal re-evaluation

Dispatch claims use `SKIP LOCKED`, leases, and fencing tokens. The intent/wake-up effect and the dispatch `COMPLETED` transition occur within the same DB transaction. A duplicate consumer encounters the existing unique intent and completes the dispatch without triggering duplicate side effects. Schema incompatibilities transition to `DEAD` with alarms after bounded retries.

The production `NOTIFICATION` destination is enabled in the following sequence:

1. Revision 16, API, and worker code are deployed while the destination is inactive.
2. The worker passes DB/loop preflights; SMTP reachability is not made a readiness dependency of the core system.
3. A forward-only cutover migration inserts the `NOTIFICATION` activation record.
4. Worker source-of-truth reconciliation generates synthetic, NOTIFICATION-targeted `incident.opened` events for currently open incidents.
5. Post-activation live event dispatches enter the regular consumer path.

Historical outbox entries are never blindly replayed. The unique intent constraint prevents duplicate emails during activation/backfill races. Incidents closed post-activation that never had a DOWN email dispatched produce no recovery notification.

## 9. Delivery, Retry, and SMTP Outcomes

Claim:

- Acquires due records ordered by `available_at, id` using `SKIP LOCKED`,
- Updates state to `PROCESSING`, assigning lease owner/expiry and an incremented fence,
- Writes an immutable attempt journal row within the same transaction,
- Invokes SMTP post-commit.

Outcome policy:

| SMTP Outcome                                                       | Delivery Outcome                                  |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| Provider `2xx` acceptance                                          | `SENT`                                            |
| Definite transient error prior to dispatch or `4xx`                | `RETRY_WAIT` with full-jitter exponential backoff |
| Definite permanent address/policy error or `5xx`                   | `FAILED`                                          |
| Connection loss/timeout where provider acceptance cannot be proven | `DELIVERY_UNKNOWN`                                |
| Retry budget exhausted                                             | `FAILED`                                          |

Initial baseline is 30 seconds base, 30 minutes cap, and up to 8 attempts; values reside in typed deployment configuration rather than hardcoded constants in production code. Each email is dispatched to an individual recipient via `To`; recipients cannot see one another.

A deterministic `Message-ID` is derived from the delivery UUID and application domain. This facilitates provider deduplication but does not guarantee exactly-once delivery. `DELIVERY_UNKNOWN` emits an operator metric/audit entry and requires manual inspection.

## 10. Templates and Data Minimization

Templates are versioned in code and strictly allowlisted, accepting no user HTML:

- DOWN: check display name, incident start/confirmation timestamp, bounded failure category
- RECOVERY: check display name, start/end timestamps, observed and wall-clock duration
- MONITORING_ENDED: check display name, closure reason and timestamp
- Recipient verification: single-use HTTPS link
- Test: product name and test delivery explanation

Raw check URLs, query strings, expected-body text, and response bodies are never placed in emails. User-controlled plain text is HTML-escaped; there are no remote assets, tracking pixels, or scripts. Each message provides text and minimal HTML alternatives.

The verification link carries the raw token in the URL fragment; browsers do not send this to server access logs. The frontend extracts the fragment and sends it to the API in the confirmation POST body.

## 11. Configuration and Readiness

Typed configuration contains at minimum:

- SMTP host/port, `none|starttls|tls` mode, optional username/password
- Mandatory TLS for production and secure `From` address
- Connect/greeting/socket timeouts
- Global SMTP concurrency and dual-queue fairness budgets
- Outbox/intent/delivery poll intervals and batch sizes
- Lease duration, retry base/cap, and max attempts
- Public web URL and deterministic Message-ID domain

Notification worker readiness:

- Schema revision compatible,
- DB accessible,
- All four loops have completed at least one successful iteration with no active fatal errors.

SMTP outages do not degrade readiness or trigger worker restart loops; queue lag/failure/unknown metrics raise alerts. API and monitor workers do not depend on notification worker readiness.

Shutdown halts new claims, awaits in-flight SMTP calls up to the configured timeout, flushes DB completions, and closes the pool. Leases/fences ensure safe continuation by subsequent replicas.

## 12. Security and Observability

- `site_monitor_notifier` reads only required source tables across owners and mutates notification/dispatch/attempt domains; it cannot read auth credentials or sessions.
- Recipient and policy APIs execute under RLS current-owner context.
- SMTP credentials originate exclusively from environment/secret managers; they are never written to DB or logs.
- Logs record delivery/intent/incident IDs, template keys, attempts, states, and bounded codes; they never include emails, URLs, tokens, subjects, or raw provider error strings.
- Metric labels are bounded: queue kind, template, state, result code family. Owner, recipient, and check IDs are never used as labels.
- Recommended metrics: queue depth/oldest age, intent evaluation lag, maintenance deferred count, attempt outcome, sent latency, retry count, unknown/failed terminal count, outbox dead count.
- Notification lifecycle events are scoped to `AUDIT`/operations; they are never routed back to the `NOTIFICATION` destination.

## 13. Mandatory Acceptance Scenarios

1. `FAIL -> FAIL -> FAIL...` produces exactly one DOWN email per incident and recipient.
2. A subsequent PASS produces a RECOVERY email only for recipients whose DOWN delivery was `SENT`.
3. A single FAIL followed by PASS produces no incident and no email.
4. If an incident opens and closes within maintenance, neither DOWN nor RECOVERY is dispatched.
5. If an incident opens within maintenance and remains open after the window ends, exactly one DOWN is dispatched.
6. If recovery occurs within maintenance after a DOWN was sent, RECOVERY is deferred until the final window ends.
7. Maintenance beginning after materialization halts delivery prior to claim.
8. In direct and group overlap, expiration of the first window does not release the delivery.
9. Worker restart does not lose deferred intents/deliveries or retry deadlines.
10. When two workers concurrently claim the same dispatch/delivery, exactly one fence wins.
11. SMTP definite transient error results in retry, definite permanent error becomes FAILED, ambiguous result becomes UNKNOWN.
12. Recipient disable cancels unsent deliveries; cross-owner recipients cannot be attached to policies.
13. Group `INHERIT/ACTIVE/DISABLED` and ungrouped default resolution produce the correct recipient set.
14. Policy/recipient mutations pass ETag, idempotency, RLS, and redaction tests.
15. Verification, test, DOWN, RECOVERY, and MONITORING_ENDED text/HTML contents are verified in Mailpit.
16. While SMTP is unavailable, checks continue running, incidents open, the API responds, and the queue remains durable.
17. Concurrent new events during cutover for an open incident do not produce a duplicate DOWN email.

## 14. Implementation Slices

1. **Revision 16 + domain/API:** Schema expansion/backfill/trigger, policy/gate/lineage rules, recipient and policy endpoints, verification/test queue.
2. **Worker runtime + cutover:** Outbox/intent/delivery adapters, SMTP classifier/templates, four loops, readiness/shutdown, and destination activation.
3. **Closing evidence:** Maintenance race conditions, two replicas, restart recovery, SMTP failure matrix, Mailpit acceptance, full CI, and status documents.

Each slice constitutes a distinct meaningful commit. The first slice does not alter migration history; in the second slice, worker preflight and source-of-truth reconciliation tests must pass prior to cutover.

## 15. Implementation and Completion Status

Stage 11 was completed with revisions 16–20. The first two slices were tracked across separate commits as preflight and cutover; the closing slice introduced the following unified evidence:

- When two notifiers concurrently claim the same delivery, exactly one fence wins and stale completions are rejected;
- Maintenance starting after materialization halts claim, and cancellation wake-up re-evaluates the work;
- Recovery intent persists in PostgreSQL throughout maintenance and resumes from the identical lineage after maintenance via a new worker instance;
- The transactional SMTP state machine persists definite transient outcomes as `RETRY_WAIT`, permanent outcomes as `FAILED`, and ambiguous/expired-lease outcomes as `DELIVERY_UNKNOWN`;
- In real Mailpit acceptance, account/recipient verifications and test emails are verified through API and production worker paths, while three operational templates are verified over actual SMTP as text and HTML using the identical versioned production renderer;
- When Mailpit is stopped, the registration API and the two primary workers remain healthy; failed SMTP results are preserved as durable terminal evidence and Mailpit is restarted at test completion;
- The full local quality gate passed with 200 unit tests and 77 real PostgreSQL/socket/process integration tests, plus a separate browser/Mailpit suite passing 4 acceptance tests.

This completion makes no exactly-once claim for standard SMTP. Socket timeouts in local outage drills deliberately became terminal `DELIVERY_UNKNOWN`; potential duplicates were avoided by omitting automatic retries.
