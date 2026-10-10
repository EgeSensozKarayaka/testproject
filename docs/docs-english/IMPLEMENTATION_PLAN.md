# Site Availability Monitor — Sequential Implementation Plan

**Status:** Pre-implementation work breakdown  
**Date:** 2026-10-09 22:35 +06:00  
**Basis:** `AGENTS.md` and `docs/ARCHITECTURE.md`

## 1. Purpose

This document divides the overall project effort into work packages ordered by their dependencies and independently verifiable. Detailed final designs of components are not produced at this stage; instead, the boundaries, prerequisites, and expected deliverables for each work package are defined.

The detailed architecture of each component will be addressed separately upon commencing the respective work package and recorded in the project repository prior to writing implementation code.

## 2. Gate System to be Applied in Every Work Package

Each work package is executed in the following order:

1. Relevant requirements and existing decisions are re-read.
2. Ambiguities, edge cases, and invariant rules are extracted.
3. The final design document for component v1 is created.
4. The design is evaluated with the user and revised if necessary.
5. Implementation code is not started before the design is accepted.
6. Code, migrations, and automated tests are implemented in small steps.
7. Work package-specific acceptance and failure scenarios are executed.
8. `DECISIONS`, `DEVELOPMENT_LOG`, and `PROJECT_STATUS` documents are updated.
9. Meaningful and scoped Git commits are created.

The completion of a work package signifies not merely that its code has been written, but that its design, tests, failure handling behaviors, and documentation are also complete.

## 3. Sequential Work Packages

### Stage 0 — Requirements and Architecture Cleanup

**Status:** Completed — 2026-10-09 22:47 +06:00

**Objective:** To consolidate all requirements and gaps identified in the final architectural review into a single, coherent source of truth before coding.

**Design deliverables:**

- `docs/REQUIREMENTS.md`
- `docs/DECISIONS.md`
- Revised `docs/ARCHITECTURE.md` v1.1
- Acceptance criteria and out-of-scope items

**Topics to clarify:**

- Scheduler timing and lease/fencing rules
- Availability and data coverage semantics
- State, execution, maintenance, and freshness axes
- Maintenance–notification race conditions
- Distinction between operational quotas and product limits
- Production backup and continuity expectations

**Completion criterion:** No contradictory requirements or architectural decisions remain.

---

### Stage 1 — Domain Model and State Machines

**Status:** Completed — 2026-10-09 22:58 +06:00

**Objective:** To define the business domain and invariant rules prior to database and API development.

**Design deliverables:**

- `docs/DOMAIN_MODEL.md`
- `docs/STATE_MACHINES.md`
- Glossary of terms

**Scope:**

- User, Check, Group, Check Run, and Check Job
- Current State and freshness
- Incident lifecycle
- Maintenance Window
- Notification Intent and Delivery
- Public Status Page
- Prediction Score
- Pause, resume, edit, delete, and manual-run behaviors
- Group state derivation rules
- Time zone and `[start, end)` rules

**Completion criterion:** All state transitions (valid, invalid, and idempotent behaviors) are defined with examples.

---

### Stage 2 — Repository, Toolchain, and Local Development Foundation

**Status:** Completed — 2026-10-10 00:50 +06:00

**Objective:** To establish the monorepo foundation where all subsequent components will share identical quality standards and operational rules.

**Design deliverable:**

- `docs/DEVELOPMENT_ENVIRONMENT.md`

**Implementation scope:**

- Node/TypeScript workspace structure
- React, API, and worker entrypoints
- Isolated, locked environment for Python predictor
- Shared domain, database, contract, and observability packages
- Initial Docker Compose setup
- Environment variable validation and `.env.example`
- Format, lint, type-check, and test commands
- Initial CI pipeline
- Initial README

**Completion criterion:** Clean-environment installation of dependencies via a single documented workflow and empty services passing verification checks.

---

### Stage 3 — Final Database and Persistence Architecture

**Status:** Designed, implemented, and verified on 2026-10-10.

**Objective:** To finalize the v1 database architecture supporting all core and optional components prior to implementation.

**Design deliverables:**

- `docs/DATABASE.md`
- ER diagram
- Table and column dictionary
- Index and query plan
- RLS and database role matrix
- Partition, rollup, and retention plan
- Migration, backup, and restore approach

**Scope:**

- Users and sessions
- Checks and groups
- Current state, jobs, and runs
- Incidents
- Maintenance windows
- Notification/outbox tables
- Public page configuration
- Rollup tables
- Prediction tables
- Composite ownership constraints
- Lease and fencing fields
- UTC time semantics
- Soft/hard delete decisions

**Implementation scope:** Migration infrastructure, baseline schema, test database, and seed mechanism.

**Completion criterion:** Verification of greenfield migrations, restore tests, ownership constraints, and critical indices via integration testing.

---

### Stage 4 — API, Event, and Error Contracts

**Status:** Completed — design approved; contract generation, API boundary, and revision 7 migration verified

**Objective:** To ensure frontend, API, and workers agree on identical contracts prior to implementation.

**Design deliverables:**

- `docs/API_DESIGN.md`
- Initial OpenAPI contract
- Domain event catalog
- SSE event contract
- Problem-details error format

**Scope:**

- Auth endpoints
- Check and group resources
- Manual-run command
- Maintenance and notification settings
- Incident and history queries
- Public status endpoints
- Prediction endpoint
- Pagination, filtering, sorting, and idempotency
- API versioning approach

**Completion criterion:** Frontend and backend can be developed independently using the mock contract.

---

### Stage 5 — Authentication and User Isolation

**Status:** Completed — design, implementation, and local acceptance gates verified

**Objective:** To establish a secure identity and ownership foundation before any other user resources.

**Design deliverable:**

- `docs/AUTH_AND_OWNERSHIP.md`

**Implementation scope:**

- Registration, login, logout, and session rotation
- Secure password storage
- HTTP-only cookies and CSRF protection
- Email verification and password reset boundaries
- RLS request context
- API and worker database roles
- Rate limiting
- Cross-user access barriers
- Basic audit events

**Completion criterion:** Negative cross-user access tests passing for every resource type and prevention of connection-pool context leakage.

---

### Stage 6 — Check and Group Management

**Status:** Completed — local and GitHub CI verifications passed

**Objective:** To construct a reliable CRUD model for check configurations before monitoring execution begins.

**Design deliverable:**

- `docs/CHECKS_AND_GROUPS.md`

**Implementation scope:**

- Check creation, editing, listing, and deletion
- Pause and resume
- Group creation and management
- Associating a check with zero or one group
- URL, interval, timeout, expected status, and expected text validation
- Config version and audit history
- API side of manual check requests
- User-based operational quota infrastructure

**Completion criterion:** CRUD, ownership, validation, concurrent editing, and deletion policies passing integration tests.

---

### Stage 7 — Secure HTTP Check Engine and Target Simulator

**Status:** Completed and verified — 2026-10-10 10:44 +06:00

**Objective:** To develop an HTTP check engine that is deterministic, secure, and decoupled from the scheduler.

**Design deliverable:**

- `docs/CHECK_ENGINE.md`

**Implementation scope:**

- DNS, TCP, TLS, TTFB, and total duration measurement
- Status code and body text verification
- Connect and total timeout
- Streaming and response-size limits
- Redirect policy
- IPv4/IPv6 behavior
- SSRF, DNS rebinding, and private-address protection
- Structured error categories
- Non-retention of raw response bodies
- Target simulator featuring successful, slow, error, redirect, flaky, and hanging endpoints

**Completion criterion:** The check engine correctly classifying all success, error, timeout, and SSRF scenarios in pure integration tests.

---

### Stage 8 — Health State, Incident, and Group State

**Status:** Completed and verified — 2026-10-10 11:53 +06:00

**Objective:** To implement the domain layer that deterministically derives state transitions from observation results, independent of the scheduler.

**Design deliverables:**

- `docs/HEALTH_AND_INCIDENT_ENGINE.md`
- Executable transition table from the accepted `STATE_MACHINES.md` document

**Implementation scope:**

- `UNKNOWN`, `UP`, `SUSPECT`, `DOWN` health states
- Separate `ACTIVE/PAUSED`, maintenance, and freshness axes
- Consecutive failure threshold
- Incident opening, updating, and resolution
- Incident commencement anchored to the initial failure
- Rejection of stale results and stale fencing tokens
- Derivation of group state
- State behavior following config mutations and unpause

**Completion criterion:** Transition matrix, property/sequence tests, and idempotency tests against replay of identical events all passing.

---

### Stage 9 — Persistent Scheduler and Monitor Worker

**Objective:** To execute checks timely, fairly, horizontally scalable, and without overlapping a check with itself.

**Design deliverable:**

- `docs/SCHEDULER_AND_WORKERS.md`

**Implementation scope:**

- `next_run_at` cadence algorithm
- No backfilling of missed checks
- Jitter
- PostgreSQL job queue
- `SKIP LOCKED`, lease, heartbeat, and fencing token
- Single active job per check
- Manual-run coalescing
- User and hostname fairness
- Configurable concurrency
- Graceful shutdown and crash recovery
- Result, current state, incident, and outbox transaction

**Completion criterion:** Multiple workers, prolonged checks, process kill, lease loss, restart, and manual/periodic conflict tests all passing.

---

### Stage 10 — Maintenance Windows

**Status:** Completed and verified — 2026-10-10 16:19 +06:00

**Objective:** To implement a maintenance model with explicit timing and race condition handling that suppresses notifications without halting check execution.

**Design deliverable:**

- `docs/MAINTENANCE_WINDOWS.md`

**Implementation scope:**

- Check- and group-scoped maintenance
- UTC and `[start, end)` semantics
- Overlapping windows
- Extending, shortening, and deleting active windows
- Incident behavior during maintenance
- Maintenance completion reconciliation job
- Maintenance scope during group modifications

**Completion criterion:** Boundary timings, overlapping maintenance, and opening/closing incidents during maintenance scenarios passing time-controlled tests.

---

### Stage 11 — Transactional Email and Notification System

**Status:** Completed — 2026-10-10 17:19 +06:00

**Objective:** To deliver downtime and recovery emails deduplicated, compliant with maintenance rules, and isolated from the core monitoring engine.

**Design deliverable:**

- `docs/NOTIFICATIONS.md`

**Implementation scope:**

- Default and group-based recipients
- Recipient validation
- Transactional outbox
- Notification delivery state machine
- DOWN/RECOVERY pairing
- Postponement or cancellation during maintenance
- Retry, exponential backoff, and dead-letter behavior
- SMTP adapter
- Mailpit development environment
- HTML and text templates
- URL and sensitive data redaction
- Test email and abuse rate limiting

**Completion criterion:** Monitoring system remaining unaffected when email provider is offline, slow, or returning indeterminate outcomes; producing strictly the expected events per incident for intended recipients.

---

### Stage 12 — History, Rollup, Availability, and Housekeeping

**Status:** Completed — 2026-10-10 19:02 +06:00

**Objective:** To ensure daily, weekly, and monthly history queries load fast and accurately as raw data volume expands.

**Design deliverable:**

- `docs/HISTORY_AND_RETENTION.md`

**Implementation scope:**

- Monthly partition management
- Index strategy
- Minute/hourly rollup
- Time-weighted availability
- Data coverage and unknown intervals
- Incident duration calculations
- Impact of late-arriving results on rollups
- Idempotent housekeeping jobs
- Raw and aggregate retention
- Partition pre-creation and pruning
- Query timeout and pagination

**Completion criterion:** Day/week/month queries over large synthetic datasets meeting defined performance budgets and gaps not being penalized as downtime.

---

### Stage 13 — Real-Time Update Infrastructure

**Objective:** To enable safe, push-based updates for administrative and public views without requiring manual page refreshes.

**Design deliverable:**

- `docs/REALTIME.md`

**Architectural status:** Final design completed on 2026-10-10 19:12 +06:00; Slice 1 relay core completed at 19:31, Slice 2 private API stream/projection completed at 19:50, and Slice 3 browser client/cutover/closure completed at 20:22. The actual public route/snapshot activation will be performed atomically in Stage 15.

**Implementation scope:**

- PostgreSQL `LISTEN/NOTIFY`
- Authenticated SSE channel and public-safe transport ports to be activated with snapshot in Stage 15
- Event filtering and ownership isolation
- Heartbeat and reconnection
- Achieving consistency via snapshot catchup
- Proxy buffering configuration
- Connection limit and rate limiting
- Polling fallback

**Completion criterion:** Automated updates across two browsers, disconnect recovery, API replica failover, and snapshot catchup scenarios after missed events passing verification.

---

### Stage 14 — Authenticated Frontend

**Objective:** To complete the core administrative user experience.

**Implementation approach:**

- Per user direction on 2026-10-10, a separate frontend architecture document is not produced.
- Treating existing OpenAPI, domain architectures, and real-time contracts as authoritative sources of truth, the user interface is developed directly in small, functional, and tested slices.
- UI decisions are recorded in decision/development logs as necessary; behavioral contracts are enforced through component and Playwright tests.

**Implementation scope:**

- Login and account flows
- Dashboard
- Check and group management
- Manual execution
- Current status, freshness, and maintenance indicators
- History charts and availability
- Incident log
- Maintenance management
- Notification settings
- Loading, empty, error, and stale states
- Responsive and accessible UI

**Completion criterion:** Critical user flows verified via Playwright tests and with two concurrent active clients.

---

### Stage 15 — Public Status Page

**Objective:** To deliver an unauthenticated public view strictly complying with data publication permissions.

**Design deliverable:**

- `docs/PUBLIC_STATUS.md`

**Implementation scope:**

- Rotatable and revocable public slug
- Publishing selected checks/groups
- Field-level visibility
- Obfuscation/hiding of raw URLs by default
- Public REST projection
- Public SSE or polling fallback
- Cache and abuse protection
- Public view frontend

**Completion criterion:** No unshared fields leaking via REST, SSE, error payloads, or page source.

---

### Stage 16 — Optional Python Early Warning System

**Objective:** To generate explainable risk signals without introducing dependencies into the core product.

**Design deliverable:**

- `docs/PREDICTION_SYSTEM.md`

**Implementation scope:**

- Feature contract
- Coalesced analysis jobs
- Statistical baseline and trend analysis
- Risk score, validity, and explanations
- Model/algorithm versioning
- Stale prediction handling
- Dedicated DB role, timeouts, and resource limits
- Feature flag
- Optional `PREDICTIVE_WARNING`
- Frontend risk panel

**Completion criterion:** Core system performance and accuracy remaining unaffected when the predictor is disabled, killed, backlogged, or utilizing an erroneous model.

---

### Stage 17 — Observability and Operational Hardening

**Objective:** To ensure system health is measurable, incidents are diagnosable, and production operations are clearly defined.

**Design deliverables:**

- `docs/OBSERVABILITY.md`
- `docs/OPERATIONS.md`
- `docs/SECURITY.md`

**Implementation scope:**

- Structured logging and redaction
- Correlation, job, run, and incident identifiers
- Metrics and dashboard definitions
- Liveness/readiness probes
- Core system SLOs/SLIs
- Queue-lag and stale-check alerts
- Audit log
- Secret management
- Backup, PITR, and restore procedures
- RPO/RTO objectives
- Graceful deployment and migration sequencing
- Dependency and container security audits

**Completion criterion:** An operator diagnosing lagging checks, worker failures, mail queues, and database degradation purely via logs and metrics; verified restore procedure.

---

### Stage 18 — System-Wide Performance and Resilience Verification

**Objective:** Following isolated tests, to prove that the entire system collectively meets requirements.

**Design deliverables:**

- `docs/TEST_STRATEGY.md`
- Reproducible benchmark and failure-test scenarios

**Scope:**

- 20, 200, and 500 check load profiles
- All targets responding slowly or timing out
- Multiple monitor workers
- Worker kill and lease recovery
- API and SSE concurrent user load
- Large monthly history queries
- SMTP outage
- PostgreSQL restart
- Predictor outage and backlog
- Live updates across two browsers
- User isolation attack tests
- SSRF and redirect tests

**Completion criterion:** Measured reports satisfying predefined performance budgets and architectural success criteria.

---

### Stage 19 — Delivery, Evidence, and GitHub Preparation

**Objective:** To deliver the project in an evaluable, transparent, and reproducible manner.

**Deliverables:**

- Completed `README.md`
- `docs/AI_USAGE.md`
- Up-to-date `docs/DECISIONS.md`
- Up-to-date `docs/DEVELOPMENT_LOG.md`
- Up-to-date `docs/PROJECT_STATUS.md`
- `docs/NEXT_STEPS.md`
- Architecture and API documentation
- Demo data and verification walkthrough
- Test and performance reports
- List of templates/generators/sources utilized
- GitHub repository link

**Completion criterion:** Successful reproduction of installation, migration, seed, application launch, test, and demo walkthrough on a clean machine using documented commands.

## 4. Dependency Summary

```text
0  Requirements and architecture cleanup
↓
1  Domain model and state machines
↓
2  Repository and development foundation
↓
3  Database architecture
↓
4  API and event contracts
↓
5  Auth and user isolation
↓
6  Check and group management
↓
7  Secure check engine
↓
8  State and incident engine
↓
9  Scheduler and monitor worker
↓
10 Maintenance windows
↓
11 Email and notifications
↓
12 History, rollup, and availability
↓
13 Real-time updates
↓
14 Management frontend
↓
15 Public status page
↓
16 Optional Python predictor
↓
17 Operational hardening
↓
18 System-wide verification
↓
19 Delivery
```

This sequence represents the core dependency chain. Before moving to implementation for any stage, its respective design document is completed. Cross-cutting concerns like security, testing, logging, and documentation are never deferred to the final stage; they are implemented at every stage and verified system-wide in Stages 17 and 18.

## 5. Active Work and Next Transition

**Stage 2 — Repository, Toolchain, and Local Development Foundation** is completed. Workspace scaffolding, pinned dependencies, minimal runtimes, container profiles, CI, and local quality/E2E proofs are documented in `docs/DEVELOPMENT_ENVIRONMENT.md` and `docs/PROJECT_STATUS.md`.

**Stage 3 — Final Database and Persistence Architecture** is completed. Six migrations, idempotent seeding, typed access surface, RLS/role boundaries, partitions, a migration container, and a real PostgreSQL integration test suite have been implemented. Greenfield migrations and logical restore to a separate database have been verified.

**Stage 4 — API, Event, and Error Contracts** is completed. TypeScript types and Fastify runtime schemas are generated from canonical OpenAPI; CI validates drift and security metadata. Centralized RFC 9457 mapper, UUIDv7 request correlation, and the revision 7 idempotency receipt schema have been implemented and tested. Business logic for product routes defined in OpenAPI is not considered complete here; each route binds to this contract within its respective Stage 5–15 domain slice.

**Stage 5 — Authentication and User Isolation** is completed. Opaque sessions, Argon2id/password policy, CSRF/origin verification, enumeration-safe token flows, PostgreSQL rate limiting, encrypted durable auth emails, profile ETags, and RLS ownership boundaries have been implemented across revisions 8–11. Unit, PostgreSQL integration, Mailpit, and Playwright acceptance suites have passed.

**Stage 6 — Check and Group Management** is completed. Design, domain, revisions 12–13, owner-scoped API, and a React administrative interface consuming generated contract types have been implemented. Acceptance flows for stale `If-Match` conflicts across two independent browsers, CRUD, pause/resume, and manual-run; 20/200/500 PostgreSQL cursor profiling; 500-record bounded UI fixture; and sensitive-field log/audit/outbox redaction proofs have passed. GitHub Actions run [`38022028585`](https://github.com/EgeSensozKarayaka/testproject/actions/runs/38022028585) succeeded across all five jobs.

**Stage 7 — Secure HTTP Check Engine and Target Simulator** is completed. Resolve-once DNS/IP pinning, public-address policy, direct connector, single total deadline, bounded streaming/decompression, redirect policy, typed error taxonomy, extended simulator, and real socket integration tests have been implemented. The monitor worker instantiates the engine; job claim, overlap/fairness, and result persistence belong to Stage 9.

**Stage 8 — Health State, Incident, and Group State** is completed. Pure reducer, invariant verification, canonical acceptance precedence, fixed two-failure threshold, provisional timeline resolution, incident segment/duration effects, deadline reconciliation, read-time freshness/duration projection, query-time group derivation, and bounded event facts have been implemented. API check/group queries have also transitioned to the same live deadline semantics.

**Stage 9 — Persistent Scheduler and Monitor Worker** is completed. Revision 14, typed monitor configuration, cancellation/manual-intent foundation, partition-aware result pointer, activation-aware shared outbox writer, pure cadence/backoff helpers, check-first materializer, claim/lease/heartbeat/fencing adapter, global/owner/hostname bounded probe dispatcher, cancellation acknowledgement, infrastructure retry/DEAD, expired-lease recovery, atomic observation transaction, deadline freshness reconciler, four independent production loops, loop-aware readiness, current/next-month storage preflight, bounded graceful shutdown, 20/200/500 real PostgreSQL capacity profiling, process-kill → natural lease expiry → reclaim → stale-result fencing, and API isolation under two real workers have been verified.

**Stage 10 — Maintenance Windows** is completed. Revision 15/domain foundation, owner-scoped CRUD API, cross check/group behavior, shared DB projection, least-privilege boundaries, pure time/mutation policy, time-filtered cursor, create idempotency, ETag/cancel, dynamic group scoping, and cancellation of open windows upon resource deletion have been implemented. Exact `[start,end)` boundaries, direct+group overlap, durable projection following restarts with a fresh process pool, probe/incident continuity during maintenance, and the notification maintenance gate have been verified.

**Stage 11 — Transactional Email and Notification System** is completed. Revisions 16–20 implement the recipient/policy API, encrypted transactional queue expansion, durable outbox → intent → delivery worker, two-phase maintenance check, recovery linked to valid DOWN lineage, conservative SMTP outcome model, and source-of-truth cutover reconciliation. Dual workers/fencing, restart/deadline, maintenance race conditions, SMTP result matrix, Mailpit text/HTML formatting, and SMTP outage isolation have been verified in the closure test suite.

**Stage 12 — History, Rollup, Availability, and Housekeeping Final Architecture** is completed. Time-weighted availability/coverage, fixed day/week/month bucket budgets, bounded recomputation queue, dedicated housekeeping process, incident journal cursor semantics, and the detach → grace → drop retention lifecycle have been finalized in `docs/HISTORY_AND_RETENTION.md`. Having identified that existing foreign key chains rendered documented retention periods unworkable, compact run evidence and write-time lineage validation were designed for Revision 21.

**Stage 12 Implementation Slice 1** is completed. Forward-only Revision 21 introduces compact run evidence and FK rewiring, write-time queue lineage validation, incident group-at-open snapshot, typed rollup cursor/rebuild range, retention manifest, and source-discovery indices. The pure domain layer implements source-aligned fixed windows, exact duration accounting, availability/coverage classification, and sum/count response aggregation. Revision 20 → 21 upgrade, raw-run/queue retention decoupling, least privilege, and existing PostgreSQL workflows have been verified.

**Stage 12 Implementation Slice 2** is completed. Revisions 22–25 implement the dedicated `housekeeping-worker`, atomic full-tuple source discovery, separate scan horizon for quiescent systems, bounded minute/hour recomputation, two-replica resolution lanes, partition/default guard, projection-backlog retention gate, and bounded detach/grace/drop + row purge workflow. Restarts, two replicas, DEFAULT visibility, least privilege, and retention manifest have been verified on real PostgreSQL.

**Stage 12 Implementation Slice 3** is completed. Revision 26 implements the narrow projection-status function; the private API implements source-aligned day/week/month queries, combination of rollup + bounded raw/open tail, tombstone access, signed/filter-bound incident cursor, and observed/unobserved segment synthesis. Cross-owner IDs return `404`, and excessive projection lag/timeout returns a controlled `503`.

**Stage 12 Closure Slice** is completed. A dedicated heavy capacity harness verifies 20/200/500 source discovery and minute → hour throughput; a 35-day distribution of 420,000 hour rows equivalent to 50.4 million raw samples; indexed/pruned month queries; and private API isolation under a concurrent housekeeper load of 3,840 buckets. 500-check projection was measured at 9.54 seconds, month service query at 25.32 ms, and loaded API p95 at 15.20 ms.

**Stage 13 Slice 1 — Realtime Relay Core** is completed. Revision 27 introduces the narrow `site_monitor_realtime` role, REALTIME-only lease/fencing claim and completion/retry/dead boundaries, transactional redacted PostgreSQL wake-up, and storage preflight. The separate realtime worker was verified in a production-like container with bounded polling, deterministic retries, readiness, and graceful shutdown; `REALTIME` activation intentionally remained disabled.

**Stage 13 Slice 2 — Private API Stream and Projection** is completed. Dedicated API listener, owner-scoped bounded hub/projection, authenticated SSE route, session/backpressure lifecycle, cross-owner RLS, and dual API replica reconnect/broadcast behavior were implemented and verified. `REALTIME` activation remained disabled.

**Stage 13 Slice 3 — Browser Client, Cutover, and Closure** is completed. Credentialed fetch-stream parser, 45-second stale threshold, full-jitter reconnect, stream-before-snapshot coordination, 60-second periodic reconciliation, and polling fallback after three unstable cycles have been implemented. Revision 28 activates the `REALTIME` target; two browsers converged without reload, and 20/200/500 dual-replica capacity profiling and slow-client isolation passed.

**Stage 14 — Authenticated Frontend Direct Implementation Has Commenced.** Without generating a separate frontend architecture document, the existing live configuration interface will be completed in small, verifiable slices incorporating the status dashboard, freshness/maintenance views, history graphs, incident journal, and notification/maintenance management. The initial slice encompasses the live status overview, operational filters, and active downtime duration.
