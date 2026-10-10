# Site Availability Monitor — Product Requirements

**Version:** 1.0  
**Status:** Baseline requirements frozen for Stage 0  
**Date:** 2026-10-09 22:47 +06:00

## 1. Role of This Document

This document defines what the product must do. `ARCHITECTURE.md` describes how these requirements are satisfied, and component design specifications detail the implementation of individual subsystems.

Order of Precedence:

1. Explicit downstream user decisions
2. Mandatory requirements stated in the original assignment specification
3. Formally approved Architectural Decision Records (ADRs)
4. Architecture and implementation details

Lower-level documents must not contradict these requirements. When new product decisions alter requirements, versions and decision records are updated concurrently.

## 2. Product Goal

The product enables users to monitor HTTP/HTTPS endpoints at configured intervals; observe real-time health, response latency, historical availability, and active incidents; receive transactional emails upon verified downtime and recovery; and publish selected metrics to an unauthenticated public status page.

An optional early warning capability derives explainable risk indicators from black-box probe metrics. This feature is decoupled from core health evaluations; if disabled or degraded, the core monitoring platform operates without interruption.

## 3. Actors

- **User:** An authenticated user who manages their own checks and configurations.
- **Public Visitor:** An unauthenticated user viewing a published status page.
- **System Operator:** A technical administrator managing deployments, database infrastructure, backups, and operational health.
- **Target Site:** An external HTTP/HTTPS endpoint probed by the system.

Version 1 excludes multi-tenant organizations, team invitations, and role-based access control (RBAC).

## 4. Functional Requirements

### 4.1 Authentication and Ownership

- **FR-AUTH-001:** The system must support multiple independent user accounts.
- **FR-AUTH-002:** Users must be able to register, log in, and log out via a secure email/password flow.
- **FR-AUTH-003:** Every private resource must belong to exactly one user.
- **FR-AUTH-004:** Users must not be able to read, mutate, delete, or subscribe to events for resources belonging to other users, even if target resource IDs are known.
- **FR-AUTH-005:** Public status pages represent an explicit, allowlisted exception to FR-AUTH-004.

### 4.2 Check Management

- **FR-CHECK-001:** Users must be able to create HTTP/HTTPS checks.
- **FR-CHECK-002:** A check must define a display name, target URL, interval between 30 seconds and 1 hour, positive timeout, expected HTTP status code, and optional expected body text.
- **FR-CHECK-003:** Users must be able to update and delete checks.
- **FR-CHECK-004:** Users must be able to pause and resume checks.
- **FR-CHECK-005:** Users must be able to trigger on-demand manual check executions.
- **FR-CHECK-006:** A check must never run multiple concurrent executions under normal conditions.
- **FR-CHECK-007:** If a probe execution exceeds its interval, intermediate runs must not accumulate or execute in parallel.
- **FR-CHECK-008:** Probe failures must distinguish between DNS resolution errors, connection failures, TLS handshakes, timeouts, HTTP status mismatches, and body assertion failures.
- **FR-CHECK-009:** Paused checks must not schedule automated jobs; historical observations must remain intact.
- **FR-CHECK-010:** Following server restarts, active checks must resume scheduled cadence using persistent configuration.
- **FR-CHECK-011:** Executions missed during system downtime must not be backfilled or attributed as target downtime.
- **FR-CHECK-012:** Manual runs on active checks participate in health state evaluation; manual runs on paused checks are diagnostic only and do not alter health, incidents, availability, or alerts.
- **FR-CHECK-013:** Modifying probe parameters (URL, timeout, expected response) invalidates in-flight executions for state evaluations and resets effective health to UNKNOWN until fresh observations arrive.
- **FR-CHECK-014:** Pausing a check cancels queued jobs and prevents stale running jobs from mutating state; resuming schedules a fresh probe promptly.

### 4.3 Groups

- **FR-GROUP-001:** Users must be able to organize checks into groups.
- **FR-GROUP-002:** A check belongs to zero or one group.
- **FR-GROUP-003:** A group must expose an aggregate health state derived from its member checks.
- **FR-GROUP-004:** Groups must serve as scopes for maintenance windows and notification routing.
- **FR-GROUP-005:** Deleting a group unlinks its checks into an ungrouped state without deleting the checks themselves.

### 4.4 Health States and Incidents

- **FR-STATE-001:** The system must decouple execution state, health state, maintenance state, and data freshness.
- **FR-STATE-002:** A single failed probe must not be classified as confirmed downtime.
- **FR-STATE-003:** The default confirmation threshold is two consecutive failed probe runs.
- **FR-STATE-004:** A second consecutive failure opens an incident; the incident start time reflects the timestamp of the initial failure.
- **FR-STATE-005:** An open incident closes upon the first successful probe, recording total downtime duration.
- **FR-STATE-006:** Subsequent failures during an open incident must not open duplicate incidents.
- **FR-STATE-007:** Checks lacking recent valid observations must be presented as `UNKNOWN`/stale rather than assumed `DOWN`.
- **FR-STATE-008:** Monitoring data gaps during open incidents must not close the incident; they suspend observed DOWN segments without incrementing observed downtime duration.
- **FR-STATE-009:** Updating probe configuration closes open incidents with `CONFIG_CHANGED`; deleting a check closes open incidents with `CHECK_DELETED`.

### 4.5 Live Dashboard

- **FR-DASH-001:** The dashboard must display health, execution state, maintenance status, and data freshness for every check.
- **FR-DASH-002:** The dashboard must display latest response latency, last checked timestamp, and active downtime duration.
- **FR-DASH-003:** Aggregate group status must be visible.
- **FR-DASH-004:** Dashboard metrics must update in real time without full page refreshes.
- **FR-DASH-005:** Multiple open browser sessions must synchronize status changes automatically.

### 4.6 History and Availability

- **FR-HIST-001:** Users must be able to view daily, weekly, and monthly response-time trends.
- **FR-HIST-002:** Users must be able to view daily, weekly, and monthly availability percentages.
- **FR-HIST-003:** Availability must be calculated as a time-weighted metric across known observation intervals.
- **FR-HIST-004:** Time intervals where the monitoring engine was offline must be classified as `UNKNOWN/no data` and excluded from downtime.
- **FR-HIST-005:** Data coverage percentages must be displayed alongside availability metrics.
- **FR-HIST-006:** An incident journal must display start, end, open/closed status, and observed durations.
- **FR-HIST-007:** Monthly query latency must not grow linearly with raw unaggregated table sizes.
- **FR-HIST-008:** Provisional `SUSPECT` intervals resolve based on subsequent outcomes: confirmed DOWN if followed by a second failure, or resolved to UP if followed by a success. Raw run records are preserved in both cases.

### 4.7 Maintenance Windows

- **FR-MAINT-001:** Users must be able to define maintenance windows with explicit start and end times for checks or groups.
- **FR-MAINT-002:** Probes continue executing, metrics are recorded, and live health is displayed during maintenance windows.
- **FR-MAINT-003:** Normal incident alert emails must be suppressed during active maintenance windows.
- **FR-MAINT-004:** Incidents that begin and resolve entirely within a maintenance window must never emit DOWN or RECOVERY emails.
- **FR-MAINT-005:** If an incident remains unresolved when a maintenance window concludes, a DOWN notification must be dispatched.
- **FR-MAINT-006:** If a DOWN notification was dispatched prior to maintenance and recovery occurs during maintenance, the RECOVERY email must be deferred until the maintenance window ends.
- **FR-MAINT-007:** Overlapping maintenance windows are evaluated as a union.
- **FR-MAINT-008:** Time evaluations use UTC timestamps within half-open `[starts_at, ends_at)` intervals.

### 4.8 Notifications

- **FR-NOTIFY-001:** Users must be able to configure verified default email notification recipients.
- **FR-NOTIFY-002:** Groups may inherit default recipients or define custom recipient overrides.
- **FR-NOTIFY-003:** When an incident is confirmed outside maintenance windows, exactly one DOWN notification is dispatched per recipient.
- **FR-NOTIFY-004:** Repeated failures during an ongoing incident must not emit additional emails.
- **FR-NOTIFY-005:** When an incident with an emitted DOWN alert resolves, exactly one RECOVERY email is dispatched per recipient.
- **FR-NOTIFY-006:** SMTP provider latency or unavailability must never block probe execution, state transitions, API operations, or frontend rendering.
- **FR-NOTIFY-007:** Failed deliveries must employ bounded retries with exponential backoff and observable final states.
- **FR-NOTIFY-008:** If an incident with dispatched DOWN alerts closes due to configuration edits, an informative closing notice may be emitted clarifying that recovery was not observed.
- **FR-NOTIFY-009:** Ambiguous SMTP provider outcomes must avoid duplicate retries and record as `DELIVERY_UNKNOWN`.

### 4.9 Public Status Pages

- **FR-PUBLIC-001:** Users must be able to publish unauthenticated, revocable public status pages.
- **FR-PUBLIC-002:** Users must be able to select specific groups and checks to publish.
- **FR-PUBLIC-003:** Users must have granular visibility controls over target URLs, response latencies, and incident histories.
- **FR-PUBLIC-004:** Non-allowlisted private data must never leak into public REST, SSE, HTML, or error payloads.
- **FR-PUBLIC-005:** Public status pages must update in real time without requiring manual page reloads.

### 4.10 Optional Early Warning (Predictor)

- **FR-PRED-001:** The system may generate explainable risk scores from response latency and error trends.
- **FR-PRED-002:** Risk outputs must include timestamp, prediction horizon, validity window, algorithm version, and human-readable rationales.
- **FR-PRED-003:** The predictor must never mutate core health states or incident records.
- **FR-PRED-004:** The predictor must never emit standard DOWN/RECOVERY notifications.
- **FR-PRED-005:** Core monitoring must operate normally if the predictor is offline, slow, or failing.
- **FR-PRED-006:** Expired predictions must not be presented as active insights.

## 5. Scheduling and Timing Invariants

- **TR-001:** All persistent timestamps are stored in UTC as `timestamptz`; client interfaces convert to local time for display.
- **TR-002:** Periodic schedules follow fixed cadences. `next_run_at` represents the earliest cadence slot following current time.
- **TR-003:** Missed scheduling slots during downtime are never backfilled.
- **TR-004:** Manual runs do not alter periodic scheduling cadences.
- **TR-005:** Concurrent manual requests submitted during an active probe are coalesced into at most one pending manual run.
- **TR-006:** Every job carries a frozen configuration snapshot and a monotonic fencing token.
- **TR-007:** Obsolete config versions or expired fencing tokens cannot mutate current state or incidents.
- **TR-008:** Lease durations must exceed probe timeouts plus network buffers; active workers renew leases via heartbeats.

## 6. Non-Functional Requirements

### 6.1 Architecture

- **NFR-ARCH-001:** Frontend and backend must run as independently deployable applications communicating over the network.
- **NFR-ARCH-002:** The primary architecture must be a modular monolith; API and background workers execute in separate processes.
- **NFR-ARCH-003:** PostgreSQL is the authoritative persistent source of truth.
- **NFR-ARCH-004:** The core system has zero synchronous or startup dependency on the Python predictor.

### 6.2 Scale and Performance

- **NFR-PERF-001:** The codebase must not hardcode arbitrary ceilings on the number of managed checks.
- **NFR-PERF-002:** Configurable operational quotas, concurrency limits, and rate limits must protect system stability.
- **NFR-PERF-003:** 20, 200, and 500 active checks must execute against identical schemas and code paths.
- **NFR-PERF-004:** Running 500 checks on a 30-second cadence must not starve management APIs or other checks in reference environments.
- **NFR-PERF-005:** Live dashboard queries must decouple from raw unaggregated history table sizes.
- **NFR-PERF-006:** Monthly history queries should return within 2 seconds in reference environments.
- **NFR-PERF-007:** API listing and detail endpoints target p95 response times under 1 second in reference environments.

### 6.3 Reliability

- **NFR-REL-001:** Worker processes, SMTP services, and the predictor must be isolated from one another.
- **NFR-REL-002:** Job scheduling and outbox dispatches must not rely on ephemeral process memory.
- **NFR-REL-003:** Domain state transitions and associated outbox events commit within the same atomic transaction.
- **NFR-REL-004:** Worker termination must gracefully complete active tasks or safely release leases for reclamation.
- **NFR-REL-005:** Local setups run on single PostgreSQL instances; production profiles must define backup, point-in-time recovery, restore tests, and high-availability options.

### 6.4 Security

- **NFR-SEC-001:** Probes must defend against SSRF, DNS rebinding, redirect loops, and private network egress.
- **NFR-SEC-002:** Default profiles monitor public HTTP/HTTPS endpoints only; private intranet monitoring is out of scope for v1.
- **NFR-SEC-003:** Passwords must be hashed using memory-hard Argon2id.
- **NFR-SEC-004:** Sessions enforce HTTP-only cookies, rotation, idle timeouts, and HMAC CSRF defenses.
- **NFR-SEC-005:** Secrets, response bodies, and sensitive query parameters must be redacted from logs and notifications.
- **NFR-SEC-006:** Tenant ownership enforces defense-in-depth across application logic, constraints, and Row-Level Security (RLS).
- **NFR-SEC-007:** Sensitive configuration updates must emit structured audit events.

### 6.5 Data Operations and Observability

- **NFR-DATA-001:** Schemas are managed strictly via versioned, forward-only migrations.
- **NFR-DATA-002:** Raw measurements utilize monthly partitioning and automated retention pruning.
- **NFR-DATA-003:** Rollup aggregations and housekeeping operations must be idempotent.
- **NFR-OPS-001:** All services produce structured JSON logs, request correlation IDs, readiness probes, and metrics.
- **NFR-OPS-002:** Queue lag, stale checks, notification backlogs, and predictor freshness must be observable.
- **NFR-OPS-003:** Production deployments specify defined RPO/RTO objectives and verified restore procedures.

### 6.6 Engineering Practices and Verification

- **NFR-DEV-001:** The system must launch cleanly in local environments via Docker Compose.
- **NFR-DEV-002:** Outbound dependencies (SMTP and target servers) are emulated via Mailpit and target simulator.
- **NFR-DEV-003:** Critical business rules must be verified with unit, integration, and end-to-end tests.
- **NFR-DEV-004:** Linting, formatting, type checking, migrations, and test suites must run deterministically in CI.
- **NFR-DEV-005:** Architectural decisions, AI tool usage, development timelines, and known limitations must be transparently documented.

## 7. Explicitly Out of Scope for Version 1

- Organizations, team invitations, and role hierarchies
- Many-to-many check-to-group relationships
- Intranet probe agents deployed on user networks
- Multi-region distributed probe locations
- SMS, voice call, Slack, or webhook alert integrations
- Recurring cron-like maintenance schedules
- Custom public status page domains
- Kubernetes deployment prerequisites
- Redis or Apache Kafka dependencies
- Supervised machine learning outage prediction prior to gathering labeled datasets
- Direct predictor intervention in core health or incident state machines
- Strict mathematical exactly-once SMTP delivery guarantees

## 8. Change Management

Any modification altering baseline requirements must:

1. Be recorded under a unique requirement ID.
2. Be justified with a formal ADR in `DECISIONS.md`.
3. Update corresponding acceptance criteria and architectural documents.
4. Assess backward compatibility and database migration implications.
