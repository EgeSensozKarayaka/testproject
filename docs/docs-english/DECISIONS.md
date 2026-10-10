# Site Availability Monitor — Decision Log

This document records accepted decisions affecting the product and architecture in chronological order. Decisions are immutable; superseded decisions are replaced by a new record and the former is marked as `Superseded`.

## D-001 — Modular Monolith and Separate Runtime Processes

- **Date:** 2026-10-09
- **Status:** Accepted
- **Context:** The API, check jobs, notifications, and optional analytics have different failure and scaling profiles.
- **Decision:** A single repository and shared domain modules will be maintained; the API, monitor worker, notification worker, and predictor will run as separate processes/containers.
- **Alternatives:** Single Node process; microservices architecture from the outset.
- **Rationale:** Provide process isolation and independent worker scaling while limiting cross-service network contract and distributed transaction complexity.
- **Consequences:** PostgreSQL serves as the shared source of truth; module boundaries must be enforced in code.

## D-002 — React/TypeScript, Node.js/TypeScript, and PostgreSQL

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** Frontend will be React/TypeScript; the primary backend will be Fastify-based Node.js/TypeScript; durable data will reside in PostgreSQL.
- **Rationale:** Node.js's I/O model for asynchronous HTTP checks, shared typing between frontend and backend, and PostgreSQL's transaction, locking, RLS, and partitioning capabilities align well with this product.
- **Consequences:** Due to advanced SQL features, a thin typed SQL/repository approach is preferred over a heavy ORM.

## D-003 — User-Based Ownership; No Organizations

- **Date:** 2026-10-09
- **Status:** Accepted
- **Context:** The product must be genuinely multi-user with tenant isolation; the task specification does not call for team/organization membership.
- **Decision:** Each private resource will belong directly to an individual user. Organization, membership, invitation, and role management systems will not be present in the initial release.
- **Alternatives:** A tenant model where a user can belong to multiple organizations.
- **Rationale:** Prevent unnecessary product and authorization complexity.
- **Consequences:** If collaborative work is required in the future, personal workspace migration will be designed as a separate project.

## D-004 — PostgreSQL-Backed Durable Job Queue

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** In the initial release, the scheduler, check jobs, and outbox will utilize PostgreSQL; Redis/Kafka will not be mandatory.
- **Rationale:** Sufficient for the targeted initial capacity, keeps transaction boundaries simple, and minimizes local setup footprint.
- **Consequences:** Queue queries, indexes, cleanup, and connection usage must be verified through load tests. A dedicated message broker can be added if measured needs arise.

## D-005 — Fixed Cadence, No Backlog, and Fencing Tokens

- **Date:** 2026-10-09
- **Status:** Accepted
- **Context:** Long-running checks must not collide; downtime while the server is offline must not be counted as target downtime or create an execution backlog.
- **Decision:** Scheduling uses a fixed cadence; `next_run_at` advances to the first scheduled timestamp after the current time. Missed ticks are not backfilled. Jobs carry leases, heartbeats, a single-active-job invariant, and monotonic fencing tokens.
- **Rationale:** Reduce risks of parallel execution, stale results, and post-restart thundering herd problems.
- **Consequences:** Results with an outdated token cannot alter the current state or incident. Mathematical exactly-once execution against external targets is not guaranteed; only a single accepted result is guaranteed.

## D-006 — Four Distinct State Axes

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** Execution (`ACTIVE/PAUSED`), health (`UNKNOWN/UP/SUSPECT/DOWN`), maintenance (`true/false`), and freshness (`FRESH/STALE`) will be maintained as separate state axes.
- **Rationale:** Avoid cramming states that can be simultaneously true (such as `PAUSED`, `DOWN`, and `under maintenance`) into a single enum.
- **Consequences:** The API and frontend represent these axes as separate fields.

## D-007 — Incident Triggered on Two Consecutive Failures

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** The default threshold is two consecutive failures. The first error produces `SUSPECT`, and the second produces `DOWN`. The incident is created upon the second error, but its `started_at` is set to the first failed observation timestamp. The first success resolves the incident.
- **Rationale:** Prevent a single transient glitch from being recorded as downtime, and provide clear baseline behavior.
- **Consequences:** The threshold may become user-configurable in the future; it remains a system default in the initial release.

## D-008 — Time-Weighted Availability and Separate Coverage

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** Availability will be calculated not as a ratio of completed run counts, but based on the timeline duration of UP/DOWN states across known observation periods. UNKNOWN/no-data periods are excluded from the availability denominator and reported separately as coverage.
- **Alternatives:** Ratio of successful runs to total runs.
- **Rationale:** Prevent weighting distortion caused by interval changes and avoid counting monitoring outages as target downtime.
- **Consequences:** Rollup design handles response time and state durations separately.

## D-009 — Maintenance Does Not Stop Checks, but Suppresses Notifications

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** Maintenance windows are specified as UTC `[start, end)` intervals. Check executions and state/incident calculations continue. Overlapping windows merge. Standard emails are suppressed during maintenance; if an incident remains open at window close, a DOWN notification is sent.
- **Consequences:** The notification worker re-verifies maintenance state at send time. Recovery of an incident that received a DOWN notification prior to maintenance is deferred until the maintenance window ends.

## D-010 — Transactional Outbox and Dedicated Notification Worker

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** Incident transitions and outbox events are written within the same transaction. Emails are dispatched by a separate Node.js worker via an SMTP adapter. Locally, Mailpit is used.
- **Rationale:** Prevent SMTP failures from affecting the monitoring pipeline and avoid notification loss.
- **Consequences:** Application-level idempotency is enforced; mathematical exactly-once delivery across SMTP transport is not claimed.

## D-011 — SSE and REST Snapshot

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** Live updates are delivered via Server-Sent Events (SSE); correct baseline and reconnection states are established via REST snapshots. PostgreSQL `LISTEN/NOTIFY` acts solely as a wake-up signal.
- **Alternatives:** WebSockets; polling-only.
- **Rationale:** Data flow is predominantly unidirectional from server to client, and SSE presents a smaller operational footprint.
- **Consequences:** Heartbeats, proxy buffering handling, connection limits, and polling fallback are required.

## D-012 — Partitioned Raw History and Rollups

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** `check_runs` is managed with time partitions, while daily, weekly, and monthly queries are served via rollup tables. The current dashboard reads exclusively from current-state projections.
- **Rationale:** Decouple UI query performance from raw row volume as check counts and data age increase.
- **Consequences:** Partition lifecycles and rollup operations require idempotent housekeeping background tasks.

## D-013 — Python Predictor as an Optional Advisory Component

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** The Python worker only reads feature/rollup data and writes explainable risk assessment scores into prediction tables. It cannot alter core state, incidents, or standard notifications.
- **Rationale:** Leverage Python's analytics ecosystem while keeping core product reliability completely decoupled from the predictor.
- **Consequences:** The predictor operates under a feature flag, separate DB role, small connection pool, and resource limits; it is implemented only after the core system is established.

## D-014 — Public Internet Targets and Strict SSRF Protection

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** The initial release will only probe public HTTP/HTTPS targets. Private, loopback, link-local, and metadata addresses are blocked. Redirect targets are re-validated, and connections are pinned to verified IP addresses.
- **Rationale:** Prevent user-controlled URLs from becoming an internal network access vector.
- **Consequences:** Monitoring private networks in the future will require a separate trusted probe architecture installed within the customer network.

## D-015 — No Hard-Coded Product Limits, Configurable Guardrails

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** There will be no hard-coded 50-check limit in source code. User quotas, worker concurrency, hostname limits, and rate limits will be configurable according to deployment capacity.
- **Rationale:** Accommodate 20, 200, 500, and larger installations with the same architecture while mitigating abuse and noisy-neighbor issues.
- **Consequences:** Performance profiles at 20, 200, and 500 checks are benchmarked; capacity is measured, not assumed.

## D-016 — A Check Belongs to at Most One Group

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** A check may belong to zero or one group.
- **Rationale:** Avoid conflicting or duplicated semantics in group status calculation, group maintenance windows, and email recipient routing.
- **Consequences:** If multi-tagging is required in the future, a separate tag system decoupled from group membership can be added.

## D-017 — Distinct Local and Production Database Profiles

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** Local development runs against a single PostgreSQL container. The production architecture specifies managed/HA PostgreSQL, automated backups, PITR, restore drills, connection pooling, and explicit RPO/RTO objectives.
- **Rationale:** Do not conflate local setup convenience with production business continuity guarantees.
- **Consequences:** The repository is not required to spin up a full HA environment locally; operational documentation clarifies production expectations and verification procedures.

## D-018 — Manual Run Is Stateful When Active, Diagnostic When Paused

- **Date:** 2026-10-09
- **Status:** Accepted
- **Context:** The incident/availability behavior of a manual run was not specified in the original requirements.
- **Decision:** For an ACTIVE check, a manual run participates in the normal observation state machine but does not alter scheduling cadence. For a PAUSED check, a manual run is diagnostic and does not alter health, incidents, availability, or trigger standard notifications.
- **Alternatives:** Treating all manual runs as diagnostic; rejecting manual runs on paused checks.
- **Rationale:** Satisfy user expectations of "check now" for active monitors while preserving pause semantics and history accuracy.
- **Consequences:** Manual mode is explicitly stored on the run and job records.

## D-019 — Monitoring Gaps Do Not Close Open Incidents; They Halt Observed Segments

- **Date:** 2026-10-09
- **Status:** Accepted
- **Context:** A server/worker outage should not be counted as downtime of the target website; however, recovery of a previously verified incident has not been observed either.
- **Decision:** When freshness becomes STALE, the incident remains OPEN/UNOBSERVED, and the active DOWN segment is closed. The gap is excluded from observed duration. A subsequent FAIL opens a new segment; a subsequent PASS resolves the incident with recovery.
- **Alternatives:** Closing the incident at the start of the gap; adding the gap duration to DOWN time.
- **Rationale:** Maintain notification continuity without turning unobserved time into false downtime.
- **Consequences:** An incident may contain multiple observed segments; observed duration is decoupled from wall-clock duration.

## D-020 — Probe Changes Invalidate Health Context and Close Open Incidents

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** When URL, timeout, expected status/body, or equivalent probe behavior changes, the probe generation increments, older results are rejected for state updates, health resets to UNKNOWN, and open incidents close with CONFIG_CHANGED.
- **Rationale:** Do not report different targets or success criteria under the same health and incident continuum.
- **Consequences:** An explanatory closing notification that makes no claim of recovery can be sent to recipients who previously received a DOWN alert.

## D-021 — Deleting a Group Does Not Delete Its Checks

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** When a group is deleted, checks become ungrouped; group maintenance, policies, and public status component effects cease.
- **Alternatives:** Cascading deletion of all checks in the group.
- **Rationale:** Prevent high-impact and unexpected data loss.
- **Consequences:** The group deletion transaction must safely clear check associations; historical DOWN recipient records must be preserved for subsequent recovery notifications.

## D-022 — Ambiguous SMTP Results Are Not Automatically Retried

- **Date:** 2026-10-09
- **Status:** Accepted
- **Context:** If the connection drops after an SMTP server accepts a message, the application cannot determine with certainty whether delivery completed.
- **Decision:** Deliveries with indeterminate results are marked `DELIVERY_UNKNOWN` and are not automatically retried by default.
- **Alternatives:** Retrying every ambiguous result and accepting the risk of duplicate emails.
- **Rationale:** Prioritize the expectation of not spamming users with duplicate alerts for the same incident over retrying uncertain deliveries.
- **Consequences:** Requires operator visibility and provider adapters that support idempotency in future iterations.

## D-023 — State Ordering Guarded by Three Distinct Version Axes

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** Separate version tracks are maintained: resource version for general optimistic concurrency, probe generation for probe semantics, and schedule generation for scheduling semantics. Worker attempt ordering is further guarded by fencing tokens.
- **Rationale:** Prevent benign edits (like renaming) from invalidating valid observations while preventing semantic changes (like URL edits or pausing) from applying stale probe results to current state.
- **Consequences:** The job configuration snapshot records these versions; the database schema and acceptance transactions verify them atomically.

## D-024 — Polyglot Monorepo and pnpm Workspace

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** Node applications and shared TypeScript packages reside in a single pnpm workspace; the optional Python predictor is kept in the same Git repository but in an isolated Python environment. Turborepo or Nx will not be introduced initially.
- **Alternatives:** Separate repositories for each runtime; introducing Turborepo/Nx with task graphs and remote caching from day one.
- **Rationale:** Enable atomic contract changes and a unified development workflow while separating Python dependency resolution from the Node ecosystem; avoid carrying additional orchestration overhead before build times warrant it.
- **Consequences:** Workspace boundaries are enforced via import linting rules. Task orchestrators can be added later if build durations become an issue.

## D-025 — Node.js 24 LTS and pnpm 11.25 Tooling Baseline

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** The core runtime will be Node.js 24 LTS, and the package manager will be the pnpm 11.25 series. The repository, CI, and containers will use the exact verified versions.
- **Rationale:** Ensure LTS runtime support, native workspace protocol, deterministic lockfiles, and reproducible environments matching local setups.
- **Consequences:** Exact Node patch and image digests are verified in container registries in Stage 2. Major upgrades require separate changes and CI validation.

## D-026 — Python 3.14 and uv for the Predictor

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** The predictor will use CPython 3.14, `pyproject.toml`, pinned uv, and a committed `uv.lock`. Python 3.15, released on design day, was not selected for v1.
- **Alternatives:** System Python and pip/requirements files; adopting Python 3.15 on release day.
- **Rationale:** Provide cross-platform deterministic resolution, isolated environments, and a more mature compatibility baseline across data analytics packages.
- **Consequences:** Host Python installation is optional; the predictor can run via container profiles. Python 3.15 upgrade will be considered after dependency and performance verification.

## D-027 — Dual Local Development Modes and Optional Prediction Profile

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** For daily development, Node applications run on the host while PostgreSQL, Mailpit, and the target simulator run in containers. For clean-room testing and demos, a full-container `app` profile is provided; a separate `prediction` profile handles the predictor.
- **Rationale:** Provide fast hot reload alongside reproducible full-stack container verification without making the predictor a prerequisite of the core stack.
- **Consequences:** The core system must function completely without the prediction profile. Both operating modes are verified via CI/smoke tests.

## D-028 — ESM, Strict TypeScript, and Root Command Interface

- **Date:** 2026-10-09
- **Status:** Accepted
- **Decision:** Node code will use ESM and strict TypeScript. Installation, linting, format checks, type-checking, testing, building, and migrations will be exposed from the repository root via platform-independent pnpm scripts.
- **Rationale:** Provide uniform language safety and developer experience across applications; prevent divergence between Windows and Linux development workflows.
- **Consequences:** Bash-only package scripts are prohibited. CI enforces the same root commands using frozen lockfiles.

## D-029 — PostgreSQL 18.6 and Mailpit 1.31.4 in Local Infrastructure

- **Date:** 2026-10-09
- **Status:** Accepted
- **Context:** Stage 2 container infrastructure must be established with reproducible image versions.
- **Decision:** Local Compose infrastructure will use `postgres:18.6-bookworm` and `axllent/mailpit:v1.31.4`. The host PostgreSQL port defaults to `15432` to avoid conflicts with existing `5432` instances, while using standard `5432` within the container network.
- **Alternatives:** Floating `latest` tags; stopping other user services on `5432`; using random host ports.
- **Rationale:** Ensure deterministic image selection, avoid disrupting running services on the host machine, and preserve a documented, stable connection endpoint.
- **Consequences:** Applications connect to `postgres:5432` inside Compose and host tools connect to `localhost:15432`. PostgreSQL 18 schema/extension compatibility is re-verified in Stage 3; image digests are pinned before release.

## D-030 — Toolchain Versions Co-Pinned According to Ecosystem Peer Boundaries

- **Date:** 2026-10-10
- **Status:** Accepted
- **Decision:** Node `24.19.0`, pnpm `11.25.0`, TypeScript `6.0.3`, and related developer tools are pinned exactly. TypeScript 7 is not adopted due to being outside the peer dependency range of `typescript-eslint`. ESLint `9.39.5` is pinned as an interim compatibility measure until `eslint-plugin-jsx-a11y` supports ESLint 10 or an equivalent accessibility rule set is verified.
- **Rationale:** Use a cohesive toolchain that passes strict peer validation and reproduces deterministically via lockfile rather than arbitrarily mixing bleeding-edge versions.
- **Consequences:** Deprecation and major upgrades are not accepted blindly via dependency bots; peer compatibility, lint checks, and builds are verified together.

## D-031 — Application and Prediction Compose Profiles Serve as Fault Boundaries

- **Date:** 2026-10-10
- **Status:** Accepted
- **Decision:** Core Node processes run under the `app` profile, while the predictor runs under a distinct `prediction` profile. Core services carry no `depends_on` or readiness dependencies on the predictor. The predictor operates with CPU/memory limits in a separate container/process.
- **Rationale:** A crash, slowdown, or outage in the experimental prediction feature must never degrade or halt the monitoring product.
- **Consequences:** Smoke tests verify that API readiness remains intact both when predictor health is passing and when the predictor container is forcibly stopped.

## D-032 — Root Quality Gate Explicitly Invoked via `pnpm run ci`

- **Date:** 2026-10-10
- **Status:** Accepted
- **Context:** pnpm interprets `ci` as an alias for clean/frozen installation (`pnpm install --frozen-lockfile`) and does not execute a package script with the same name.
- **Decision:** The unified repository quality gate command is `pnpm run ci`; GitHub Actions and documentation explicitly use the `run` syntax.
- **Consequences:** `pnpm ci` remains dependency installation; mistaking it for the quality gate and skipping verification suites is prevented.

## D-033 — SQL-First PostgreSQL Schema with Typed Kysely Access

- **Date:** 2026-10-10 01:13 +06:00
- **Status:** Accepted — Implemented in Stage 3 migration set
- **Context:** PostgreSQL-specific capabilities like RLS, roles, partitioning, partial indexes, and online constraints are central to v1 data integrity.
- **Decision:** Migrations are versioned, checksummed plain SQL files. Application queries are typed using Kysely over the `pg` transaction infrastructure; ORM schema auto-synchronization is not used.
- **Alternatives:** Full ORM migration generation; string-based raw SQL repository without query typing; external migration binaries.
- **Rationale:** Keep production DDL explicit and reviewable while preserving TypeScript type safety in application queries; decouple migration behavior from ORM runtime quirks.
- **Consequences:** The repository-owned runner applies advisory locking, checksum ledgers, transaction/no-transaction partitioning, and schema compatibility checks. Applied migrations are immutable; fixes must be forward-only migrations.

## D-034 — UUIDv7, Direct Owner Column, and Three-Tier Tenant Isolation

- **Date:** 2026-10-10 01:13 +06:00
- **Status:** Accepted — Implemented in Stage 3 migration set
- **Decision:** Aggregate and event IDs use PostgreSQL 18 `uuidv7()`. Every private table row carries a direct `owner_id`; composite owner foreign keys, API authorization checks, and PostgreSQL FORCE RLS are applied in concert. Runtime roles cannot own tables or have `BYPASSRLS`.
- **Alternatives:** Sequential IDs; filtering solely in the API layer; deriving ownership via relational join chains; single broad DB role for all services.
- **Rationale:** Provide global uniqueness and index locality, reject cross-tenant data access at the database level even if application joins or filters fail, and constrain blast radiuses through least privilege.
- **Consequences:** Private API queries require a transaction-local user context. Authentication and public bootstrap routines operate via tight security-definer functions. RLS context leakage and cross-owner references are verified through negative integration tests.

## D-035 — Separation of Current Projections, Immutable Runs, and Open Intervals

- **Date:** 2026-10-10 01:13 +06:00
- **Status:** Accepted — Persistence structure implemented; domain transition logic in subsequent stages
- **Decision:** The dashboard reads a single current-state projection row per check; each probe observation is recorded as an immutable run. The single active/provisional availability window is stored in `open_health_intervals`, while finalized history resides in monthly partition tables.
- **Alternatives:** Deriving dashboard views by scanning raw runs; combining current state and run history into a single table; storing open and finalized intervals in the same partitioned table.
- **Rationale:** Decouple dashboard read latency from historical data volume, retain rejected/stale observations for auditability, and enforce the invariant of "at most one open interval per check" across partition boundaries via primary key constraints.
- **Consequences:** The probe acceptance transaction atomically updates run, current state, open interval, incident, and outbox tables. Projections can be rebuilt; historical runs are append-heavy.

## D-036 — Monthly Raw Partitions, Minute/Hour Rollups, and Coverage Separation

- **Date:** 2026-10-10 01:13 +06:00
- **Status:** Accepted — Partition and rollup tables implemented
- **Decision:** Raw runs and high-volume time series are partitioned by UTC timestamp; minute rollups are used for 24-hour/7-day views, and hour rollups for monthly views. Availability is calculated strictly from UP + DOWN duration, while coverage is the proportion of observed duration relative to the requested query window.
- **Alternatives:** Storing all history in a single unpartitioned table; scanning raw runs for monthly queries; classifying UNKNOWN time as downtime; adopting a separate time-series database on day one.
- **Rationale:** Manage data retention and query costs without placing a hard cap of 50 checks, keep monthly views bounded, and prevent data gaps from distorting uptime SLA calculations.
- **Consequences:** Partitioned primary keys include the timestamp column; full lineage requires composite foreign keys `(owner_id, check_id, finished_at, run_id)`. The default partition serves as a safety catch and raises an alert if rows land there.

## D-037 — Forward-Only Migrations and Verified PITR/Restore Objectives

- **Date:** 2026-10-10 01:13 +06:00
- **Status:** Accepted — Migration runner and local restore rehearsal implemented
- **Decision:** Production schema modifications follow an expand/backfill/verify/switch/contract and forward-fix pattern. Production business continuity targets on managed PostgreSQL are RPO ≤ 5 minutes, RTO ≤ 60 minutes, 14-day PITR retention, and quarterly restore verification drills.
- **Alternatives:** Automated rollback down-migrations; daily logical dumps without PITR; declaring backup success without restore drills.
- **Rationale:** Avoid destructive rollbacks and long lock acquisitions; prove restoreability against application invariants rather than relying on unverified backup file creation.
- **Consequences:** Runtime processes do not execute migrations; schema evolution is applied via dedicated deployment jobs beforehand. Schema mismatch drops readiness. Local restore drills pass; production continuity metrics require real provider infrastructure setup and regular drill execution.

## D-038 — NOLOGIN Privilege Roles and Deployment Login Wrappers

- **Date:** 2026-10-10 02:24 +06:00
- **Status:** Accepted — Implemented in migration and runtime pool configuration
- **Context:** Conflating service privilege definitions with secret-bearing login identities complicates credential rotation. Local Compose needs a single bootstrap account for simplicity.
- **Decision:** Migrations define all schema and service roles as `NOLOGIN`, `NOBYPASSRLS` permission groups. Local runtime connections switch to the narrow role upon opening. Production provides distinct login user wrappers that belong to the required role with distinct secrets; applications never connect as superusers.
- **Alternatives:** Making each service role a direct LOGIN role; using a single broad login user across all services; requiring separate secrets for every role in local development.
- **Rationale:** Separate authorization matrices from credential lifecycles, simplify production secret rotation, and keep local setup single-command while testing actual execution under narrow privileges.
- **Consequences:** Locally, `session_user` is the bootstrap account, but `current_user` is the restricted service role. Integration tests verify role constraints on private tables. Creating production login wrappers is delegated to infrastructure runbooks.

## D-039 — OpenAPI 3.1 URI-Major REST and Explicit Command Endpoints

- **Date:** 2026-10-10 02:57 +06:00
- **Status:** Accepted — Contract and code generation infrastructure implemented
- **Context:** Frontend, API, and worker processes must progress independently without contract drift or tying long operations to HTTP request lifecycles.
- **Decision:** `docs/openapi-v1.yaml` is the canonical source for external HTTP contracts. Private API routes live under `/api/v1` and public projections under `/api/public/v1` following resource-oriented REST; state transitions like pause, resume, manual run, publish, and rotate are exposed as explicit command endpoints. Long-running actions return `202 Accepted` with a durable receipt.
- **Alternatives:** GraphQL; purely RPC-style endpoints; code-first undocumented routes; holding HTTP connections open until manual runs finish.
- **Rationale:** Maintain a single reviewable contract that supports mock generation; clearly express caching, status, and idempotency semantics over HTTP; isolate the UI from worker execution delays.
- **Consequences:** Runtime validators and TypeScript types are generated from this specification, enforced by CI conformance checks. Breaking changes require a new major URI version.

## D-040 — ETag Preconditions, Durable Idempotency Receipts, and Opaque Cursors

- **Date:** 2026-10-10 02:57 +06:00
- **Status:** Accepted — Revision 7 receipt schema implemented; endpoint adoption across domain stages
- **Context:** Multiple open clients can modify the same resource simultaneously; network retries can duplicate create/command side effects; offset pagination is unstable and expensive on growing datasets.
- **Decision:** Mutable resources return strong `ETag: "rv-N"` headers and mutations require `If-Match`. Retriable commands and creations accept an `Idempotency-Key` and store durable receipts scoped by subject and operation. Lists use signed, opaque keyset cursors; response page sizes are capped at 100 items.
- **Alternatives:** Last-write-wins; in-memory deduplication only; offset pagination; assuming all operations are naturally idempotent.
- **Rationale:** Prevent silent data loss, duplicate side effects (manual runs, emails, token rotations), and pagination drift on append-heavy datasets.
- **Consequences:** Forward-only revision 7 added `infra.api_idempotency_records`. Receipts, domain state changes, and outbox events commit in the same short transaction without lingering `PROCESSING` lock states. Non-sensitive responses are stored as sanitized JSON; one-time URLs (like status page links) are stored encrypted with a dedicated key and replayed for up to 24 hours. Stale ETags yield `412 Precondition Failed`, missing ETags yield `428 Precondition Required`, and payload mismatches on identical idempotency keys yield `409 Conflict`.

## D-041 — Unified Problem-Details Envelope and Invisible Ownership

- **Date:** 2026-10-10 02:57 +06:00
- **Status:** Accepted — Central mapper and HTTP boundary tests implemented
- **Context:** Clients must not parse raw text error strings, log correlation must be maintained, and error messages must not leak tenant existence or token validity.
- **Decision:** All external error responses use RFC 9457 `application/problem+json` envelopes with stable `code`, `request_id`, `retryable` flags, and JSON Pointer field validation arrays. Resources owned by another tenant return generic `404 Not Found` indistinguishable from non-existent resources; invalid, disabled, or rotated public tokens also return generic `404`.
- **Alternatives:** Custom error schemas per endpoint; leaking raw database or exception messages; returning `403 Forbidden` for cross-tenant access.
- **Rationale:** Make client handling deterministic and testable while preventing tenant enumeration and internal infrastructure leakage.
- **Consequences:** A central error mapper is mandatory. Stack traces, SQL errors, secrets, and PII are restricted to redacted server logs; all responses include an `X-Request-Id` header.

## D-042 — SSE as Loss-Tolerant Acceleration; REST Snapshot as Source of Truth

- **Date:** 2026-10-10 02:57 +06:00
- **Status:** Accepted — External contract established; runtime implemented in Stage 13
- **Context:** Multiple browser clients must reflect updates promptly without incurring the complexity of persistent event stores or WebSockets. PostgreSQL notifications can drop during replica restarts.
- **Decision:** Authenticated and public SSE streams use distinct endpoints and projections. SSE events convey lightweight invalidation notifications; clients open the stream, fetch a REST snapshot, reconcile buffered events via version numbers, and periodically re-fetch a REST snapshot (at least every 60s when visible). `Last-Event-ID` is diagnostic and does not guarantee durable replay.
- **Alternatives:** WebSockets; durable event streams to the browser; polling-only; exposing internal event payloads directly.
- **Rationale:** Deliver low-latency updates with minimal operational overhead without tying system correctness to ephemeral transport signals.
- **Consequences:** Heartbeats, bounded buffers, coalescing, `resync.required` events, polling fallback, and proxy buffering configurations form part of the contract. Public SSE emits only `status_page.updated` invalidation markers.

## D-043 — Transactional Outbox and At-Least-Once Consumption for Internal Events

- **Date:** 2026-10-10 02:57 +06:00
- **Status:** Accepted — Envelope allowlist implemented; consumers implemented in domain stages
- **Context:** Dual-write inconsistencies must not arise between domain updates and scheduler, notification, realtime, or predictor side effects. Failures in ancillary services must not block core monitoring transactions.
- **Decision:** Domain events are committed in the same database transaction as the business change, stored in an outbox table with versioned envelopes. Delivery is at-least-once, ordering is maintained strictly per-aggregate, and consumers deduplicate using `event_id`. `LISTEN/NOTIFY` serves merely as a wakeup hint.
- **Alternatives:** Direct broker/HTTP calls after transaction commit; claiming exactly-once delivery; global total ordering; embedding full aggregate/PII payloads in events.
- **Rationale:** Prevent event loss across process crashes, support isolated retries and dead-letter queues, and decouple optional workers from the primary write path.
- **Consequences:** Consumers maintain idempotency records, dead-letter policies, and schema version compatibility. Browsers never consume raw internal events directly.

## D-044 — Deterministic Types and Runtime Schemas Generated from Single-Source OpenAPI

- **Date:** 2026-10-10 03:52 +06:00
- **Status:** Accepted — Verified in Stage 4 implementation
- **Context:** Manually maintained OpenAPI files, TypeScript DTOs, and Fastify JSON Schemas inevitably drift. Frontend types and backend runtime validation must derive from the exact same contract.
- **Decision:** `docs/openapi-v1.yaml` is the sole canonical source of truth. Pinned `openapi-typescript` 7.13.0 generates TypeScript types, while a custom repository-owned generator outputs Fastify request/response schemas with resolved local references and operation security metadata. Generated artifacts are committed; `pnpm contracts:check` ensures byte-level zero-drift, verifying 57 operations, parameter bindings, and CSRF/idempotency/If-Match requirements.
- **Alternatives:** Hand-writing duplicate DTOs and runtime schemas; code-first OpenAPI generation; generating artifacts only at build time without committing them; adopting an API gateway/codegen framework.
- **Rationale:** Maintain a human-reviewable YAML contract, allow frontend and backend development to proceed in parallel, catch subtle contract drift early in CI, and avoid unneeded platform bloat.
- **Consequences:** The generated directory is never hand-edited and is excluded from linting, but is subject to formatting, type checking, and drift validation. Routes present in OpenAPI but awaiting domain stages are not considered operational. Minor health schema differences discovered during implementation were resolved in the canonical YAML using the working `ok/unavailable + timestamp/version` model.

## D-045 — Stateful Opaque Session Cookies with Defense-in-Depth CSRF Protection

- **Date:** 2026-10-10 04:15 +06:00
- **Status:** Accepted — Verified in Stage 5 implementation
- **Context:** Browser sessions require instant revocation, session rotation, global logout on password reset, concurrency across multiple client tabs, and secure tenant identity extraction. Cookie authentication alone is vulnerable to CSRF.
- **Decision:** Rather than stateless JWTs in localStorage, sessions use 256-bit cryptographically random opaque tokens stored in `HttpOnly; Secure; SameSite=Strict` cookies, with only their SHA-256 digests stored in PostgreSQL. Absolute and idle timeouts, periodic rotation, and a brief grace period for concurrent requests are enforced server-side. State-changing requests require a session-bound HMAC CSRF token, exact Origin verification, Fetch Metadata validation, JSON-only payloads, and restrictive CORS credentials.
- **Alternatives:** Stateless JWT refresh tokens; bearer tokens in browser storage; relying solely on SameSite cookies; relying solely on CSRF tokens; framework-provided stateless encrypted cookies.
- **Rationale:** Enable instantaneous revocation and password-version invalidation, prevent token theft via XSS, and avoid relying on any single browser security mechanism for CSRF defense.
- **Consequences:** Session lookup is performed via a narrow security-definer function. Outside local development, HTTPS/Secure cookies are strictly required. Logout is an idempotent `204 No Content`, password resets revoke all active sessions, and separate browser sessions operate independently.

## D-046 — Argon2id Password Hashing, 15-Character Minimum, and Bounded Capacity

- **Date:** 2026-10-10 04:15 +06:00
- **Status:** Accepted — Verified in Stage 5 implementation
- **Context:** Password storage must resist offline cracking, but computationally expensive verification must not exhaust event loop resources or API memory under abuse. Timing differences must not leak user existence.
- **Decision:** Argon2id parameters follow PHC encoding with an initial baseline of `m=19456 KiB, t=2, p=1`, 16-byte random salt, and 32-byte output; production tuning will only adjust parameters upward. Passwords require a minimum of 15 characters (up to 128) with no arbitrary composition rules or forced rotation. Offline password strength estimation via pinned `zxcvbn-ts` rejects weak scores (0–2). Asynchronous hashing/verification runs under a per-instance bounded queue; non-existent users undergo an identical dummy hash calculation to eliminate timing side channels.
- **Alternatives:** bcrypt/PBKDF2; fast SHA-256 hashes; length-only validation; synchronous hashing; unbounded parallel hashing; third-party online breach lookup APIs.
- **Rationale:** Adhere to current OWASP/NIST guidelines for offline attack resistance, accommodate password managers, and bound CPU/memory consumption.
- **Consequences:** The minimum password length in OpenAPI was adjusted from 12 to 15. Pinned implementations `@node-rs/argon2`, `@zxcvbn-ts/core`, `@zxcvbn-ts/language-common`, and `@zxcvbn-ts/language-en` were adopted and validated. v1 does not use a pepper; introducing a KMS pepper would require a separate threat model.

## D-047 — Restricted DB Functions and PostgreSQL Atomic Rate Limiting for Auth

- **Date:** 2026-10-10 04:15 +06:00
- **Status:** Accepted — Verified in Stage 5 implementation
- **Context:** Granting the general API role direct table access to authentication data violates least privilege. Process-memory rate limiters fail across multiple API replicas, while introducing Redis would add an external dependency to the v1 architecture.
- **Decision:** User registration, challenge issuance and redemption, session creation, rotation, and revocation, and password resets are executed atomically through security-definer functions with fixed `search_path`. The API role has no general DML permissions on auth tables. Rate limiting counters are tracked in PostgreSQL using HMAC-hashed identifiers (avoiding raw IPs or emails in rate tables) within atomic fixed windows (minute and hour/day windows combined).
- **Alternatives:** Granting the API role full CRUD on the auth schema; relying solely on application-level transactions; in-memory rate limiting; adopting Redis on day one; delegating rate limiting entirely to edge proxies.
- **Rationale:** Enforce least privilege, guarantee transactional atomicity, apply identical abuse controls across multiple API instances, and keep the operational architecture minimal.
- **Consequences:** Forward-only revision 8 established session/counter functions, revision 10 added anonymous idempotency support, and revision 11 added profile mutation and rehash boundaries. If the rate limit storage encounters an error, auth mutations fail closed; high-volume volumetric DDoS still requires edge/WAF mitigation.

## D-048 — Encrypted Durable Delivery Queue for Transactional Auth Emails

- **Date:** 2026-10-10 04:15 +06:00
- **Status:** Accepted — Verified in Stage 5 implementation
- **Context:** Connecting directly to SMTP within user registration or password reset transactions would allow external email failures to block user authentication flows. Storing only token digests prevents regenerating email links if the process crashes before dispatch. Incident notification tables do not align with one-time challenge semantics.
- **Decision:** `notification.transactional_email_deliveries` serves as a dedicated durable queue for one-time verification and reset tokens. Raw challenge tokens are stored only within AES-256-GCM encrypted, versioned payloads with short TTLs. The notification worker claims and completes deliveries via a narrow interface, employing bounded retries, fencing tokens, and `DELIVERY_UNKNOWN` handling.
- **Alternatives:** Synchronous SMTP dispatch from the API; writing raw tokens to outbox event JSON; overloading incident notification tables; fire-and-forget background dispatches after commit.
- **Rationale:** Decouple SMTP from authentication availability, guarantee message dispatch across process restarts, and prevent plaintext secrets in database columns, logs, or events.
- **Consequences:** Mailpit acts as the local transport implementation. Encryption keys originate from a versioned key ring; expired challenge payloads are pruned automatically. Email delivery errors do not alter the generic `202 Accepted` response already returned to the client.

## D-049 — Forward-Fix and Profile Boundaries for Applied Auth Migrations

- **Date:** 2026-10-10 04:53 +06:00
- **Status:** Accepted — Verified in migration and clean database test suites
- **Context:** After revision 8 was applied to local databases, clean integration tests revealed that the notifier role lacked `USAGE` permissions on the `security_api` schema. Furthermore, anonymous idempotency and `/me` profile updates required dedicated narrow functions.
- **Decision:** The applied revision 8 checksum history remains immutable. Permission grants were addressed in forward-only revision 9, anonymous idempotency in revision 10, and optimistic profile updates along with race-safe password rehashing in revision 11.
- **Alternatives:** Silently modifying revision 8; granting broad schema/table privileges to the notifier role; opening general DML access on auth tables for profile updates.
- **Rationale:** Preserve migration ledger integrity and least-privilege boundaries while ensuring clean setups and upgraded databases reach the exact same schema state.
- **Consequences:** Schema head is revision 11. The API and notifier roles invoke only allowlisted security-definer functions; both fresh database provisioning and incremental migration upgrades are verified in integration tests.

## D-050 — Single-Owner Transactions and Three Distinct Version Tracks on Check/Group Commands

- **Date:** 2026-10-10 06:52 +06:00
- **Status:** Accepted — Approved for Stage 6 implementation
- **Context:** Multiple client tabs can modify the same check concurrently; configuration changes trigger cascading updates across jobs, current state, incidents, audit logs, and outbox events. A single monolithic version number cannot distinguish between probe specification changes and scheduling changes.
- **Decision:** Every mutation executes within a transaction-local owner context using appropriate row locks and strong `If-Match` preconditions. A substantive HTTP mutation increments `resource_version` by one, and increments `probe_generation` and `schedule_generation` at most once depending on the updated fields. Configuration, state, jobs, audit logs, outbox events, and idempotency receipts commit within a single database transaction.
- **Alternatives:** Last-write-wins; committing each table independently; using timestamps to detect stale writes; incrementing all generations on every modification.
- **Rationale:** Prevent data loss and inconsistent partial states across multiple clients; evaluate probe semantics, scheduling cadence, and browser ETags independently.
- **Consequences:** No-op commands validate the precondition but do not increment versions or emit events. Combined PATCH requests emit multiple redacted events under a single resource version; consumers treat versions as monotonically non-decreasing.

## D-051 — API-Level Canonicalization and Execution-Time SSRF Validation Required Together

- **Date:** 2026-10-10 06:52 +06:00
- **Status:** Accepted — Approved for Stage 6 implementation
- **Context:** Resolving DNS within the API ties user mutation latency to remote nameservers and still fails to prevent DNS rebinding attacks. Conversely, checking targets only at runtime delays detection of blatant localhost or private IP errors.
- **Decision:** The API canonicalizes absolute HTTP/HTTPS URLs, rejects embedded credentials, local hostnames, and private/reserved literals, and strips URL fragments. Hostname resolution (A/AAAA records) and each redirect hop are re-validated in Stage 7 with socket connections pinned to validated IPs. API acceptance does not confer execution permission.
- **Alternatives:** Single DNS lookup during resource creation; regex-only validation; allowing private target probing; validating targets exclusively at API creation time.
- **Rationale:** Combine fast, deterministic CRUD performance with robust defense against SSRF and DNS-rebinding attacks.
- **Consequences:** If a public hostname resolves to a private IP at runtime, the API save succeeds, but the probe execution terminates with a `BLOCKED_TARGET` result. Raw target URLs and query parameters are never logged in audit trails or event payloads.

## D-052 — Manual Runs Produce Either a Durable Job or a Single Coalesced Intent

- **Date:** 2026-10-10 06:52 +06:00
- **Status:** Accepted — Approved for Stage 6 implementation
- **Context:** A "Run Now" action cannot keep the HTTP request waiting for network probe completion; repeated triggers while a check is already running must not spawn unbounded parallel work or execution queues.
- **Decision:** If no job is currently active, the API creates a `PENDING + MANUAL` job with a configuration snapshot. If an active job already exists, the API records at most one pending intent in `manual_requested_at`. Manual runs on ACTIVE checks execute as STATEFUL; manual runs on PAUSED checks execute as DIAGNOSTIC; scheduling cadence remains untouched. The endpoint requires `If-Match`, returns a durable idempotency receipt, and applies per-check rate limits.
- **Alternatives:** Synchronous HTTP probing; creating a new job row on every click; volatile in-memory queues; rejecting manual runs on paused checks.
- **Rationale:** Isolate API response times from target latency, preserve user intent across server restarts, and enforce the invariant of at most one concurrent job per check.
- **Consequences:** The response is `202 Accepted` with status `ENQUEUED` or `COALESCED`. When the scheduler finishes a running job, it consumes at most one pending manual intent; a partial unique index serves as the final concurrency barrier.

## D-053 — Resource Counts Governed by Configurable Owner Quotas, Not Hard Limits

- **Date:** 2026-10-10 06:52 +06:00
- **Status:** Accepted — Approved for Stage 6 implementation
- **Context:** The mention of 50 checks in requirements is a capacity benchmark; the architecture must support 20, 200, or 500 checks. Conversely, unbounded creation would allow a single user to monopolize database and worker resources.
- **Decision:** Check and group quotas are deployment-configurable owner limits; there is no hard-coded `50` in the application code. Creation transactions acquire an advisory lock on the owner and resource type before verifying count and inserting. Quotas are separate from rate limits and worker concurrency; exceeding quota returns `409 Conflict (quota_exceeded)`.
- **Alternatives:** Hard-coding a limit of 50; enforcing no quotas; restricting limits solely in the UI; introducing billing plan tables in v1.
- **Rationale:** Support variable capacity targets while ensuring fair-share allocation and replica-safe operations across multi-tenant environments.
- **Consequences:** Limits are adjusted via environment configuration and tested with 20/200/500 test fixtures. Per-owner overrides can be introduced later via operator tooling if required.

## D-054 — Group Deletion Is an Atomic Soft-Delete with Versioned Ungrouping

- **Date:** 2026-10-10 06:52 +06:00
- **Status:** Accepted — Approved for Stage 6 implementation
- **Context:** Deleting a group must preserve its member checks; concurrent group deletion and check relocation must not leave orphaned checks or cause silent write overwrites.
- **Decision:** The group and its child checks are locked in deterministic order. The group is soft-deleted; all active child checks are ungrouped within the same transaction, incrementing each check's `resource_version`. Probe and schedule generations are unchanged; a redacted group-change event is emitted per check.
- **Alternatives:** Cascading deletion of all child checks; leaving the deleted group ID on checks; asynchronous background ungrouping; leaving child ETags unmodified.
- **Rationale:** Fulfill requirement AC-029 without data loss in a race-resilient manner, cleanly terminating group maintenance, policy, and public status scopes.
- **Consequences:** Fan-out is bounded by the owner's check quota. Clients attempting to update a child check using an outdated ETag receive `412 Precondition Failed`; notification delivery histories are preserved.

## D-055 — OpenAPI URI Path Parameters Deterministically Transformed to Framework Syntax

- **Date:** 2026-10-10 07:47 +06:00
- **Status:** Accepted — Verified via parametric group route tests
- **Context:** Canonical OpenAPI specifications use `{group_id}` path parameters, whereas Fastify expects `:group_id`. Registering raw OpenAPI paths directly in Fastify causes literal path matching, returning 404 for valid UUID requests.
- **Decision:** The canonical OpenAPI YAML remains framework-agnostic. The code generator deterministically transforms `{name}` path parameters to `:name` format for Fastify route registration; generated artifacts are never manually edited.
- **Alternatives:** Adopting Fastify's colon syntax directly in the OpenAPI specification; hardcoding routes in handlers; transforming paths ad-hoc inside handler wrappers.
- **Rationale:** Preserve a single standards-compliant OpenAPI specification across 57 operations while eliminating contract and route registration discrepancies via automated testing.
- **Consequences:** All existing and future parametric routes benefit from this automated mapping. Contract drift checks enforce transformation integrity; test suites use genuine UUID URLs.

## D-056 — Revision 13 Forward-Fix for Check State Command Privileges

- **Date:** 2026-10-10 08:22 +06:00
- **Status:** Accepted — Verified with integration tests against PostgreSQL check services
- **Context:** Revision 12 granted the API role permissions for current state and job mutations. However, approved semantics for probe configuration updates, pausing, and deletion required closing active incident segments and health intervals in the same transaction, tables on which the API role only had `SELECT` permissions.
- **Decision:** Applied revision 12 remains untouched. Forward-only revision 13 grants the API role column-level `UPDATE` on incident closing/suspension columns, column-level `UPDATE` on incident segment closure columns, `INSERT`/`DELETE` on `open_health_intervals`, `updated_at` `UPDATE` for row-locking on open intervals, and `INSERT` on `finalized_health_intervals`.
- **Alternatives:** Deferring state side effects to background workers; granting broad unrestricted `UPDATE` on monitoring tables to the API role; altering the revision 12 checksum; creating security-definer wrapper functions.
- **Rationale:** Preserve atomicity across configuration, state, jobs, audit logs, and outbox events while maintaining least-privilege boundaries and migration immutability.
- **Consequences:** The API role remains unable to write probe runs, accepted observation fields, worker leases, or raw probe outcomes. Revision 13 was incorporated into fresh and reset migration tests; check commands were verified under the actual restricted database role.

## D-057 — OpenAPI 3.1 Write Schemas Converted to Draft-07 for Fastify Runtime Validation

- **Date:** 2026-10-10 08:22 +06:00
- **Status:** Accepted — Verified via check routes and contract drift tests
- **Context:** Canonical schemas `CheckCreate` and `CheckPatch` merge shared properties using `allOf` and forbid unrecognized fields using OpenAPI 3.1's `unevaluatedProperties: false`. Fastify's default Ajv draft-07 compiler strictly rejects this keyword, crashing route registration.
- **Decision:** The canonical OpenAPI 3.1 document and generated TypeScript types remain unchanged. The runtime schema generator detects simple object compositions using `allOf + unevaluatedProperties` and merges their properties, constraints, and required fields into an equivalent draft-07 schema with `additionalProperties: false`.
- **Alternatives:** Disabling Ajv strict mode; permitting unrecognized payload fields; duplicating schemas across canonical definitions; writing manual route schemas; migrating the entire runtime to a different JSON Schema compiler.
- **Rationale:** Preserve closed request body validation and single-source API contracts while isolating framework compatibility adjustments to the deterministic code generator.
- **Consequences:** Rejection of unknown properties continues to function properly; external OpenAPI and TypeScript definitions remain untouched. Generator unit tests verify the flattened schemas, and drift gates protect the generated artifacts.

## D-058 — Management UI Uses Generated Types and Explicit Server-State Reconciliation

- **Date:** 2026-10-10 09:42 +06:00
- **Status:** Accepted — Verified via unit tests and dual-session Playwright flows
- **Context:** The Stage 6 management dashboard executes check/group operations over cookie-authenticated sessions. Multiple tabs can read identical resource versions; the UI must not overwrite state silently or introduce custom DTOs separate from the API contract.
- **Decision:** The frontend interacts through a lightweight fetch adapter utilizing TypeScript types generated directly from canonical OpenAPI. No external global state or caching libraries are introduced at this stage; server state remains scoped to component boundaries. Mutations include CSRF tokens, idempotency keys, and `If-Match` headers where required. Upon receiving a `412 Precondition Failed`, local drafts are not automatically overwritten; the latest data is re-fetched, and the user is alerted to the conflict.
- **Alternatives:** Manually duplicating DTO types in the frontend; last-write-wins overwrites; silently reapplying stale drafts; adding Redux or React Query before requirements dictate.
- **Rationale:** Prevent contract drift and silent data loss, keep dependency footprints proportional to view complexity, and maintain a clear reconciliation boundary ahead of real-time SSE integration.
- **Consequences:** Following a 412 error, user edits are not silently re-applied but require explicit re-submission. When live data requirements mature in Stage 13, query caching solutions will be re-evaluated. Acceptance tests also surfaced the need to align CORS method allowlists explicitly with API mutation verbs.

## D-059 — DNS Resolution Pinned to Validated Candidate Sets

- **Date:** 2026-10-10 10:01 +06:00
- **Status:** Accepted — Verified in Stage 7 implementation and test suites
- **Context:** If the DNS answer seen during URL validation differs from the address resolved when opening the network socket, DNS rebinding attacks can bypass SSRF filters to access internal or cloud metadata services. Validating literal IP addresses at API submission time does not address runtime DNS resolution or redirect hops.
- **Decision:** Each request and redirect hop resolves DNS exactly once; all returned A/AAAA records are normalized and verified against public-address policies. If any resolved address is forbidden, the entire hop fails closed. The HTTP connector connects strictly to the immutable validated IP candidate set without performing subsequent DNS lookups. TLS hostname and SNI verification continue against the original URL hostname.
- **Alternatives:** Performing DNS checks only during URL creation; delegating connections to default system resolvers; picking only public IPs from mixed responses; using basic RFC 1918 blacklists.
- **Rationale:** Eliminate validation-to-connection race conditions, enforce uniform security invariants across IPv4/IPv6 and redirect chains, and prove compliance with AC-100/101 at the socket layer.
- **Consequences:** The resolver and connector are decoupled into testable interfaces. Rebinding test doubles verify resolver call counts and connector candidate sets. Sensitive DNS/IP details are excluded from logs.

## D-060 — Probes Enforce Monotonic Total Deadlines and Bounded Response Streaming

- **Date:** 2026-10-10 10:01 +06:00
- **Status:** Accepted — Verified in Stage 7 implementation and test suites
- **Context:** Resetting timeouts on each redirect hop or network phase allows slow targets to exceed the user-configured deadline. Buffering full response bodies allows oversized or infinite payloads to exhaust worker memory and cause head-of-line blocking.
- **Decision:** Job `timeout_ms` represents a single monotonic deadline covering the entire lifecycle from initial DNS resolution to body EOF. Sub-phase timeouts only constrain the remaining time budget. Headers, raw wire data, and decompressed streams are bounded by strict hard caps; expected response substrings are identified using bounded streaming matchers, and raw body contents are never buffered in memory or exposed upwards.
- **Alternatives:** Full timeout budget per connection phase; relying on Undici's default timeouts; buffering entire bodies as strings; terminating connections immediately upon finding expected substrings without consuming remaining headers/data.
- **Rationale:** Guarantee deterministic timeout semantics, enforce bounded memory utilization, and reliably cancel hanging or slow target probes.
- **Consequences:** Caller cancellations produce infrastructure errors, while expired deadlines yield target `TIMEOUT` outcomes. Status-only probes read through body EOF within bounded limits. Error precedence is verified across a comprehensive test matrix.

## D-061 — Public-Only Direct Egress via Ephemeral Per-Hop HTTP Clients

- **Date:** 2026-10-10 10:01 +06:00
- **Status:** Accepted — Verified in Stage 7 implementation and test suites
- **Context:** Ambient proxy configurations, shared connection pools, or permissive development flags can unintentionally widen outbound network boundaries. The Docker target simulator requires private network connectivity for local demonstrations.
- **Decision:** v1 establishes direct outbound connections strictly to public HTTP/HTTPS endpoints via an operator-controlled port allowlist without intermediate proxies. Each redirect hop instantiates an ephemeral Undici client bound to the validated candidate IP set. Access to the local simulator is permitted solely via an explicit origin allowlist rejected in production environments; wildcard or CIDR private bypasses are prohibited.
- **Alternatives:** Maintaining a global keep-alive connection pool; enabling `ALLOW_PRIVATE=true`; automatically inheriting system proxy environment variables; relaxing production security policies for simulator testing.
- **Rationale:** Prevent cross-job connection contamination and configuration-driven SSRF vulnerabilities while preserving reproducible local verification through narrow exceptions.
- **Consequences:** Keep-alive connection reuse is traded off for strict isolation; 20/200/500 check throughput is evaluated in Stage 9. Secure connection pooling can be revisited via a separate ADR if required. Production environments fail fast if development simulator origins are configured.

## D-062 — Health Engine Architected as a Pure Reducer Producing Typed Transaction Plans

- **Date:** 2026-10-10 11:02 +06:00
- **Status:** Accepted — Verified in Stage 8 implementation and test suites
- **Context:** Embedding health and incident rules directly inside schedulers, SQL scripts, or worker loops makes state transitions difficult to test outside full integration suites and obscures retry/replay semantics.
- **Decision:** The Stage 8 health engine within `packages/domain` is implemented as a pure reducer free of I/O, system clock dependencies, and UUID generation. It accepts an immutable state snapshot and probe observation, returning a typed transaction plan consisting of acceptance status, current-state patches, interval/incident effects, and redacted event facts. SQL execution is isolated to Stage 9 database adapters.
- **Alternatives:** Embedding state machines into worker SQL queries; deriving state eventually via event consumers; encapsulating all domain transitions inside database stored procedures.
- **Rationale:** Enable deterministic property-based and sequence testing, decouple business rules from persistence layers, and ensure identical inputs produce identical transaction plans.
- **Consequences:** Stage 8 alone does not persist incidents end-to-end. The Stage 9 adapter must execute the resulting transaction plan atomically; internal reducer invariant failures must never be conflated with target probe failures.

## D-063 — Fixed Failure Threshold of Two with Saturating Failure Counter

- **Date:** 2026-10-10 11:02 +06:00
- **Status:** Accepted — Verified in Stage 8 implementation and test suites
- **Context:** Requirements specify that single transient failures should not register as outages, but user-configurable thresholds are not required for v1. Dynamic runtime thresholds could alter historical incident interpretations.
- **Decision:** v1 enforces a fixed threshold of two consecutive accepted FAIL observations. The first failure moves state to SUSPECT (candidate); the second triggers DOWN and opens an incident. The failure counter saturates at 2. If per-check thresholds are added in the future, they will trigger a probe configuration version change and new generation.
- **Alternatives:** Dynamic thresholds via environment variables; user-configurable thresholds in v1; time-windowed failure rates; immediate DOWN on first failure.
- **Rationale:** Provide simple, deterministic behavior matching product specifications while maintaining bounded state representation during sustained outages.
- **Consequences:** A solitary failure never creates an incident or triggers alerts. Configurable thresholds will require an explicit database migration and contract amendment.

## D-064 — Read-Time Freshness Override Decouples Display Accuracy from Background Reconcilers

- **Date:** 2026-10-10 11:02 +06:00
- **Status:** Accepted — Verified in Stage 8 implementation and test suites
- **Context:** Background freshness reconciliation loops can experience momentary execution delays. Reading a persisted `FRESH` status from a check whose deadline has elapsed could report an overdue check as UP/DOWN and falsely attribute unmonitored time to an open incident.
- **Decision:** All snapshot and group queries evaluate `fresh_until <= statement_timestamp()`, immediately treating expired checks as STALE and effectively UNKNOWN. The query-time observed duration of an open incident caps at `fresh_until`, switching its observation mode to UNOBSERVED. The background reconciler subsequently persists the interval and segment at the exact same cutoff.
- **Alternatives:** Relying solely on the background reconciler; updating the state table on every read; tolerating minor display lag; counting stale time as DOWN.
- **Rationale:** Ensure compliance with AC-044/046/062 independently of background scheduler latency and prevent misrepresenting unmonitored time as downtime.
- **Consequences:** Read projections and persisted projections may briefly diverge during reconciliation intervals, but they resolve to identical semantic states. Lag is monitored, and duplicate reconciliations act as idempotent no-ops.

## D-065 — Group Health Derived at Query Time from Child Snapshots

- **Date:** 2026-10-10 11:02 +06:00
- **Status:** Accepted — Verified in Stage 8 implementation and test suites
- **Context:** Group health represents the aggregated effective health of its member checks. Maintaining a separate mutable group state row introduces dual-write hazards, stale projections, and rebuilding overhead, whereas owner quotas keep aggregate queries strictly bounded.
- **Decision:** v1 derives group health at query time from `LIVE + ACTIVE` member checks using the precedence rule `DOWN > SUSPECT > UNKNOWN > UP` in a single set-based SQL query. PAUSED checks are counted separately and DELETED checks are excluded; there is no hard limit of 50 checks.
- **Alternatives:** Updating a group state table on every check observation; issuing N+1 queries per child check; treating cache as the source of truth.
- **Rationale:** Preserve a single source of truth, eliminate database write contention, and ensure bounded aggregation suited for 20, 200, and 500 check configurations.
- **Consequences:** Child status changes trigger cache invalidation in realtime/public subscribers. If performance profiling indicates a bottleneck, a rebuildable projection can be added via a separate ADR.

## D-066 — Integration Test Databases Dropped via Controlled Retries, Not Force Disconnects

- **Date:** 2026-10-10 12:18 +06:00
- **Status:** Accepted — Verified in local quality gates and PostgreSQL test packages
- **Context:** The GitHub PostgreSQL test workflow failed with uncaught exception `57P01 terminating connection due to administrator command` despite all 34 assertions passing. `node-postgres` `Pool.end()` can resolve before idle socket close handshakes complete on the database server; a subsequent `DROP DATABASE ... WITH (FORCE)` killed those lingering connections, raising unhandled pool error events.
- **Decision:** Test database cleanup routines will not use `WITH (FORCE)`. Standard `DROP DATABASE` statements apply a bounded retry loop strictly when encountering PostgreSQL error code `55006 object_in_use`; all other errors rethrow immediately. This logic is encapsulated within `@site-monitor/database/testing`.
- **Alternatives:** Swallowing pool error events; introducing arbitrary sleep pauses; keeping forced drops while ignoring error `57P01`; leaving test databases uncleaned.
- **Rationale:** Eliminate connection teardown races at the source, avoid fragile timing assumptions, and ensure genuine connection or permission failures continue to fail test suites.
- **Consequences:** Cleanup waits up to 5 seconds retrying only while lingering sessions finish closing. Unit tests verify that SQL queries omit `FORCE`, handle error `55006`, and fail fast on unrelated database errors.

## D-067 — Worker and API Enforce Canonical Check-First Lock Hierarchy

- **Date:** 2026-10-10 12:33 +06:00
- **Status:** Accepted — Stage 9 implementation design
- **Context:** API check commands acquire row locks on checks before mutating active jobs. If workers locked jobs before checks, concurrent operations on the same entities would cause reverse lock acquisition orders and database deadlocks.
- **Decision:** All operations scoped to a check follow the strict hierarchy: `check → job → attempt → current state → incident → segment → interval`. The job dispatcher reads candidates without locks using bounded queries; the claim transaction locks the check using `FOR UPDATE SKIP LOCKED`, followed by the job row. Locking a pending job and then waiting on a check is prohibited.
- **Alternatives:** Locking jobs first in API commands; relying on application retries upon SQLSTATE deadlock exceptions; merging the scheduler and API into a single process.
- **Rationale:** Maintain aggregate-root lock hierarchy, structurally eliminate deadlock hazards across horizontally scaled workers and API replicas, and keep transactions short by eliminating external I/O during lock retention.
- **Consequences:** Historical ordering documentation in Stage 8 and database guides was updated. Heartbeat operations update only their own job row conditionally and do not acquire check-level locks.

## D-068 — Running Jobs Use Cancellation Acknowledgement Rather Than Terminal State Overwrites

- **Date:** 2026-10-10 12:33 +06:00
- **Status:** Accepted — Stage 9 implementation design
- **Context:** Forcibly setting a `LEASED`/`RUNNING` job to `CANCELLED` within an API transaction immediately releases the partial unique index, allowing a new job to start before the running HTTP probe has aborted, resulting in concurrent execution.
- **Decision:** `PENDING` jobs can be cancelled directly. For `LEASED`/`RUNNING` jobs, an allowlisted cancellation request is recorded while preserving the active state. The worker detects the cancellation request via heartbeats and aborts the probe; an acknowledgement transaction then marks the attempt and job terminal. If a worker crashes, lease recovery handles finalization.
- **Alternatives:** Relying solely on fencing tokens; applying fixed sleep pauses after cancellation; scanning open attempts alongside terminal jobs; maintaining per-check in-memory mutexes.
- **Rationale:** Prevent physical check overlap during pause, configuration, or deletion operations, ensure durable crash recovery, and eliminate reliance on process-local synchronization.
- **Consequences:** Revision 14 added cancellation columns and constraints. In the event of lease expiration during network partitions, a zombie probe may briefly overlap, but only the current fencing token is accepted into the state machine, maintaining consistency without claiming external exactly-once semantics.

## D-069 — Fair-Share Queue Ordering Combined with Bounded Process-Local Concurrency

- **Date:** 2026-10-10 12:33 +06:00
- **Status:** Accepted — Stage 9 implementation design
- **Context:** A simple global FIFO queue allows large tenants to starve smaller tenants. Holding PostgreSQL connections or advisory locks throughout network probes ties connection pool capacity directly to probe concurrency.
- **Decision:** Due and pending candidate jobs are ranked per owner in a round-robin order. Workers claim jobs only when process-local global, owner, and hostname concurrency slots are available; database connections are released during network probe execution. Reference initial limits per worker process are 64 global, 32 per owner, and 4 per hostname.
- **Alternatives:** Global FIFO queue; dedicated queues per owner; distributed Redis semaphores; session-level advisory locks during probes; cluster-wide concurrency lease tables in v1.
- **Rationale:** Preserve PostgreSQL as the sole durable coordination engine while preventing starvation and resource exhaustion across 20, 200, and 500 check profiles.
- **Consequences:** Owner fairness is enforced at the database level across replicas; hard owner and host concurrency limits scale with replica count. If strict cluster-wide concurrency caps become necessary, an expiring shared slot table can be added via a future ADR.

## D-070 — Coalesced Manual Intents Persist Their Request-Time Execution Mode

- **Date:** 2026-10-10 12:33 +06:00
- **Status:** Accepted — Stage 9 implementation design
- **Context:** The `manual_requested_at` timestamp records pending intent but does not capture the execution mode (`STATEFUL` vs `DIAGNOSTIC`) derived from the check's ACTIVE/PAUSED state at request time. If check status changes before the job is materialized, the API receipt and actual execution semantics diverge.
- **Decision:** A pending manual intent is stored as a `manual_requested_at + manual_requested_mode` pair. Subsequent triggers coalesce into the existing intent without overwriting mode. The job is instantiated using the latest configuration snapshot but executes under the stored mode. Transitioning a check from ACTIVE to PAUSED clears any unmaterialized STATEFUL intent.
- **Alternatives:** Recomputing execution mode when materializing the job; removing the mode field from API receipts; maintaining an unbounded queue of manual requests.
- **Rationale:** Guarantee API receipt accuracy, uphold the single-pending-intent invariant, and enforce clear separation between diagnostic and stateful runs.
- **Consequences:** Revision 14 introduced nullable pair constraints and API coalescing adjustments. Configuration changes execute the intent using the latest snapshot; check deletion purges pending intents.

## D-071 — Attempt Outcomes Identified Idempotently via Partition-Key Pointers

- **Date:** 2026-10-10 12:33 +06:00
- **Status:** Accepted — Stage 9 implementation design
- **Context:** `check_runs` is partitioned monthly, and its primary key includes `finished_at`. While a `result_recorded_at` marker prevents duplicate attempts, locating an existing run using only `attempt_id` requires full scans across all partitions as history grows.
- **Decision:** The attempt record contains a nullable `result_run_finished_at + result_run_id` pointer pair; the result marker and pointer are either both null or both populated. The run insertion and attempt pointer update execute in the same transaction. Replay attempts perform partition-pruned lookups using `(owner_id, check_id, finished_at, id)`. Deferred composite foreign keys ensure relational integrity on PostgreSQL.
- **Alternatives:** Indexing `attempt_id` globally on every partition; returning success without reading the run during replay; maintaining an unpartitioned mapping table; keeping an unpartitioned global run table.
- **Rationale:** Ensure fast, deterministic idempotent result lookups across growing monthly partitions, prevent duplicate side effects, and preserve the partitioning strategy.
- **Consequences:** Revision 14 added two pointer columns, an all-or-none constraint, and foreign keys. If a stale attempt result arrives, the pointer is recorded, but the terminal `LEASE_LOST` or `CANCELLED` status remains unchanged.

## D-072 — Outbox Emits Dispatches Exclusively for Active Destinations

- **Date:** 2026-10-10 12:33 +06:00
- **Status:** Accepted — Stage 9 implementation design
- **Context:** Stage 9 generates high volumes of run and incident events, while notification, realtime, and prediction consumers are built in subsequent stages. Accumulating pending dispatches for non-existent consumers creates unbounded backlog growth and risks spamming historical emails upon initial consumer startup.
- **Decision:** Destination activation and cutovers are recorded in `infra.destination_activations`. Producers intersect catalog routing rules with the set of currently active destinations; if none are active, no outbox row is inserted. Once activated, consumer outages do not halt dispatch generation. During initial startup, notifications reconcile currently open incidents, realtime fetches source-of-truth snapshots, and predictors backfill history rather than replaying historical outbox events blindly.
- **Alternatives:** Generating pending dispatches indefinitely regardless of consumer readiness; environment flags; consuming all historical events upon startup; using the outbox as an audit log.
- **Rationale:** Decouple core monitoring transactions, distinguish unmonitored history from active operational failure, and bound database table sizes across large check installations.
- **Consequences:** Revision 14 introduced the activation table and shared routing helpers. Consumer activation and reconciliation sequences are verified in subsequent stages; primary truth remains in run, current state, and incident tables.

## D-073 — Canonical Run Timestamps Derived from the Database and Monotonic per Check

- **Date:** 2026-10-10 14:17 +06:00
- **Status:** Accepted — Verified via atomic observation adapter and PostgreSQL tests
- **Context:** PostgreSQL timestamps operate at microsecond resolution, whereas Node domain models and run partition keys use milliseconds. If two accepted runs complete within the same millisecond, an incident segment or health interval could have `ended_at = started_at`, violating positive interval duration constraints. Furthermore, worker system clocks cannot be trusted as canonical ordering sources.
- **Decision:** The observation transaction locks the current-state row and obtains the database observation timestamp. The persisted `finished_at` is computed as the maximum of `clock_timestamp()` (rounded to ms), attempt `started_at + 1 ms`, and previous accepted run `finished_at + 1 ms`. Lease expiration is evaluated against the physical database timestamp rather than the logical `finished_at`.
- **Alternatives:** Relying on worker system clocks; truncating `transaction_timestamp()`; permitting zero-duration intervals; applying retry sleeps upon constraint violations; extending the entire domain model to microseconds.
- **Rationale:** Guarantee strict run ordering and positive interval durations without relying on worker clocks, decouple lease validity from logical presentation timestamps, and eliminate artificial sleep pauses.
- **Consequences:** Consecutive rapid transitions on a check advance by at least one millisecond and may occasionally sit a few milliseconds ahead of wall-clock time. This bounded adjustment is accepted to maintain per-check ordering invariants without affecting lease or cancellation decisions.

## D-074 — Production Worker Loops Enforce Healthy Startup and Bounded Draining

- **Date:** 2026-10-10 15:00 +06:00
- **Status:** Accepted — Verified via unit tests, PostgreSQL tests, Compose restart smoke tests, and full CI
- **Context:** Tying scheduler, dispatcher, recovery, and freshness routines solely to recurring timers can cause a process to report healthy HTTP status while loops fail continuously in the background. Furthermore, shutting down processes while database queries or probes are active can leave indeterminate states after connection pools close.
- **Decision:** The four worker functions run as independent, non-overlapping loops managed by a coordinator. Readiness reports `ok` only if all four loops have completed at least one iteration successfully, none are currently in an error state, the database schema is compatible, and partition tables exist for the current and subsequent UTC months. Loop errors are logged with redacted error codes upon state transition, and successful recoveries emit log notices. Shutdown stops claiming new jobs, aborts sleep intervals, waits for active operations within a bounded grace period, and cancels remaining probes.
- **Alternatives:** Reporting readiness immediately upon process launch; logging loop exceptions without affecting readiness; chaining all tasks sequentially in a single timer; unbounded shutdown waiting; exiting processes immediately.
- **Rationale:** Ensure that an issue in one loop does not halt others, prevent orchestrators from routing work to stalled workers, and guarantee deterministic process shutdown and restart cycles.
- **Consequences:** Transient errors downgrade readiness until the next successful iteration while keeping liveness intact. If active operations exceed the shutdown grace period, `drained=false` is logged honestly, and durable lease/fencing recovery mechanisms ensure subsequent processes resume state cleanly. Queue lag is tracked via metrics and alarms rather than readiness checks.

## D-075 — Worker Capacity Proven via Layered, Repeatable Performance Profiling

- **Date:** 2026-10-10 15:11 +06:00
- **Status:** Accepted — Verified against PostgreSQL profiles at 20, 200, and 500 checks
- **Context:** Running performance benchmarks against public internet targets conflates external DNS, TLS, and network latency with database scheduling and persistence overhead. Conversely, mocking the database queue obscures PostgreSQL contention, fencing, and transaction costs. Furthermore, declaring single local latency measurements as production SLOs is misleading.
- **Decision:** Capacity tests run against isolated PostgreSQL databases using production implementations of `PostgresJobQueue`, `ProbeDispatcher`, and `PostgresObservationStore`, mocking only the network probe endpoint with deterministic 5/50 ms `PASS/200` responses. Profiles at 20, 200, and 500 checks evaluate correctness, owner fairness, concurrency/pool limits, and resource utilization. Stage 7's 50-socket concurrency test against hanging targets complements this by validating network-layer concurrency. CI thresholds serve as loose anti-regression budgets rather than production baselines.
- **Alternatives:** Pure unit benchmarks; testing against 500 live internet targets; testing only a single 50-check scenario; adopting local benchmark numbers as production SLOs; running performance tests manually outside CI.
- **Rationale:** Eliminate network variance while measuring real database coordination costs across multiple check scales; produce repeatable, honest results protected by CI automation.
- **Consequences:** `pnpm test:capacity` can be executed independently and runs as part of integration CI suites. Results establish performance baselines for the given test hardware; live network validation, timeout-heavy targets, and process kill tests remain distinct proofs.

## D-076 — Crash Recovery Verification Distinguishes Process Death from Deterministic Zombie Deliveries

- **Date:** 2026-10-10 15:23 +06:00
- **Status:** Accepted — Verified via process-kill and PostgreSQL integration tests
- **Context:** Backdating lease timestamps within an in-process test does not prove resilience against unexpected process termination. Conversely, a process terminated via `SIGKILL` cannot write late outcomes; the zombie-result failure mode stems from network partitions or delayed callbacks rather than process termination itself.
- **Decision:** A comprehensive acceptance test proves both boundaries sequentially. A production worker process initiates a hanging HTTP probe and is forcibly terminated (`SIGKILL`), allowing the lease to expire naturally based on the database clock. After a replacement worker claims the job with a higher fencing token and records a successful result, the original stale claim is submitted to the observation store as a delayed FAIL.
- **Alternatives:** Manually expiring leases via SQL queries; testing queue logic solely in unit tests; assuming terminated processes can execute late writes; relying on OS-specific process freeze/resume features; non-deterministic internet testing.
- **Rationale:** Crash recovery and stale-result protection represent distinct failure modes. Verifying both along the same durable lineage avoids misleading narratives and ensures platform-independent test reproducibility.
- **Consequences:** The test validates the progression: `SIGKILL → natural expiry → LEASE_LOST → retry → higher fence → accepted PASS → rejected stale FAIL`. External HTTP calls cannot guarantee mathematical exactly-once execution; current state and incident tracking accept only the current attempt's outcome. Detailed evidence is documented in `MONITOR_FAILURE_RECOVERY_REPORT.md`.

## D-077 — Worker Scaling and API Isolation Proven via Multi-Process Architecture

- **Date:** 2026-10-10 15:34 +06:00
- **Status:** Accepted — Verified via dual-worker and API multi-process acceptance test
- **Context:** Running load tests within a single event loop or shared PostgreSQL connection pool cannot prove that worker probe loads do not starve the API of CPU or database connections. Calling readiness endpoints alone does not exercise authenticated owner-scoped lists, RLS filters, or pagination cursors.
- **Decision:** The acceptance suite launches the API and two independent monitor workers across three separate Node.js processes. Each worker operates with its own 4-connection pool and distinct worker ID, while the API manages an independent connection pool. While 200 due checks probe a real 150 ms HTTP target, API readiness and authenticated 100-item check listings are continuously sampled. Exact job, attempt, run, and HTTP request counts alongside multi-worker participation are validated against durable storage.
- **Alternatives:** In-process Fastify injection; calling `CheckService.list` directly; sampling readiness during single-worker tests; inspecting connection pool metrics only; using external internet targets.
- **Rationale:** Validate process, event loop, connection pool, HTTP/auth/RLS, and multi-replica claim boundaries within a single deterministic scenario, exposing API starvation and duplicate execution risks without network fluctuations.
- **Consequences:** In local test runs, all 200 jobs, attempts, runs, and HTTP calls matched exactly, both workers claimed work, and attempt numbers did not exceed 1. Under load across 40 API samples, readiness p95 was 18.4 ms and list p95 was 32.1 ms. Limits serve as broad regression budgets rather than production SLOs; per-process concurrency caps across two replicas yielded a combined concurrency of 8 as designed.

## D-078 — Maintenance Expiration Reconciliation Leverages Notification Intent Deadlines

- **Date:** 2026-10-10 15:46 +06:00
- **Status:** Accepted — Stage 10 final architecture
- **Context:** Notifications must not be lost when maintenance windows conclude, change, or when group memberships update. Building a dedicated maintenance reconciliation table duplicates the existing `notification.intents.maintenance_until` durable deadline queue, introducing multiple sources of truth.
- **Decision:** Natural window expiration is managed via `DEFERRED_MAINTENANCE` intents and `maintenance_until` indexes. Window creation, modification, cancellation, and check/group reassignment events awaken early evaluation through the transactional outbox. Every evaluation re-reads current check, group, window, and incident data; event-time suppression flags are not used as decision sources.
- **Alternatives:** Dedicated maintenance reconciliation tables and workers; process-level in-memory timers; scheduling future cancellable outbox jobs for every window.
- **Rationale:** Rely on established durable primitives for crash safety, ensure a single source of truth during window extensions or truncations, and prevent unnecessary architectural complexity between Stages 10 and 11.
- **Consequences:** If another maintenance window remains active when an intent deadline arrives, the notification worker re-defers the intent. Configuration and group-change events do not postpone earlier expirations. Activating Stage 11 destinations requires backfilling open incidents and active intents; historical outbox entries are not replayed blindly.

## D-079 — Maintenance Evaluation Is a Pure Decision Decoupled from Eligibility and Delivery

- **Date:** 2026-10-10 16:19 +06:00
- **Status:** Accepted — Verified via Stage 10 test suites
- **Context:** Stage 10 must prove the impact of maintenance windows on notifications, while recipient resolution, DOWN/RECOVERY lineage, and SMTP state machines belong to Stage 11. Treating event payload suppression flags as send decisions produces stale results after window modifications or restarts.
- **Decision:** The notification domain evaluates current event eligibility alongside the result of `app.effective_maintenance_until` within a pure maintenance gate. If ineligible, it produces `CANCEL`; if an active window applies, it produces `DEFER` to the furthest end time; otherwise, it yields `PROCEED`. The gate does not resolve recipients, write delivery records, or invoke SMTP.
- **Alternatives:** Implementing the notification worker partially in Stage 10; treating event-time suppression flags as the source of truth; re-implementing maintenance logic in SQL across consumers; coupling incident eligibility into maintenance helpers.
- **Rationale:** Prove maintenance decision logic through deterministic production code without violating stage boundaries, rely on durable sources of truth over event payloads, and develop Stage 11 recipient routing independently.
- **Consequences:** The Stage 11 adapter maps `PROCEED/DEFER/CANCEL` outcomes to durable intent states. Recovery eligibility is calculated based on recipient delivery lineages; invalid or expired maintenance timestamps are rejected by the gate.

## D-080 — Recovery Recipients Derived Strictly from Successful DOWN Delivery Lineages

- **Date:** 2026-10-10 16:27 +06:00
- **Status:** Accepted — Stage 11 final architecture
- **Context:** Using the current notification policy at recovery time could send recovery notices to recipients who never received a DOWN alert; conversely, freezing policy at event time ignores explicit user opt-outs.
- **Decision:** When a DOWN alert is materialized, its `notify_recovery` preference is snapshotted. RECOVERY notifications are materialized only for lineages where the matching incident's DOWN delivery is `SENT`, the snapshot is enabled, and the recipient remains `VERIFIED`; each recovery delivery references its originating DOWN delivery via a foreign key.
- **Alternatives:** Querying the current recipient policy upon recovery; using an incident-level boolean flag; assuming `DELIVERY_UNKNOWN` DOWN deliveries succeeded.
- **Rationale:** Tie every recovery alert to a confirmed prior DOWN delivery, prevent policy changes from adding unwarranted recipients, and respect user opt-out preferences.
- **Consequences:** Failed, cancelled, or unknown DOWN alerts do not trigger recovery emails. Policy updates do not invalidate prior DOWN matches, but disabling a recipient blocks subsequent recovery delivery.

## D-081 — Ambiguous SMTP Dispatches Are Terminal Without Claiming Exactly-Once Delivery

- **Date:** 2026-10-10 16:27 +06:00
- **Status:** Accepted — Stage 11 final architecture
- **Context:** If network connections drop after an SMTP server accepts a message, the client cannot verify delivery. Blind retries cause duplicate emails, while assuming success can generate erroneous recovery notices.
- **Decision:** Deliveries with indeterminate outcomes transition to the terminal state `DELIVERY_UNKNOWN`; automatic retries and recovery alerts are suppressed. Confirmed transient network errors trigger retries, permanent failures mark `FAILED`, and explicit `2xx` acceptances transition to `SENT`. Deterministic Message-IDs mitigate duplicate deliveries but do not guarantee exactly-once behavior.
- **Alternatives:** Retrying all network errors; marking all timeouts as failed; replacing standard SMTP with provider-specific idempotency APIs.
- **Rationale:** Limit duplicate email hazards without claiming impossible exactly-once delivery guarantees over standard SMTP.
- **Consequences:** Unknown delivery states are surfaced via metrics, audit logs, and operator dashboards without impacting core monitoring or API functions.

## D-082 — Notification Cutover Uses Activation and Source Reconciliation Instead of Outbox Replay

- **Date:** 2026-10-10 16:27 +06:00
- **Status:** Accepted — Verified via Revision 19/20 cutover and PostgreSQL race tests
- **Context:** The `NOTIFICATION` destination is inactive in earlier stages. Replaying all historical incident events would dispatch delayed emails for past resolved outages; conversely, processing only new events would miss ongoing active incidents.
- **Decision:** Following worker deployment and preflight verification, the destination is activated via forward-only migration. Synthetic `incident.opened` events restricted to the NOTIFICATION destination are created exclusively for incidents that remain open in primary tables. Unique incident/event-kind constraints prevent duplicate intents.
- **Alternatives:** Replaying the entire historical outbox; ignoring existing open incidents; maintaining an in-memory backfill list; activating the destination before deploying worker code.
- **Rationale:** Prevent historical notification spam, accurately cover currently active incidents at cutover time, and ensure crash safety.
- **Consequences:** Consumer downtime after activation creates standard durable backlogs. Reconciliation events use a `cutover-v1` marker and partial unique indexes for restart safety. Revision 19 surfaced an issue where data-modifying CTEs could not observe newly inserted rows in the same statement; forward-only Revision 20 incorporated `RETURNING` rows explicitly into dispatch queries. Even if backfill and live events race to consume dispatches, unique intent and delivery constraints prevent duplicate DOWN notifications.

## D-083 — Availability Calculated as an Observed Duration Ratio, Not a Run Count Ratio

- **Date:** 2026-10-10 17:27 +06:00
- **Status:** Accepted — Verified via pure aggregation test suites
- **Context:** Monitoring intervals can vary; server downtime, paused states, and unverified initial glitches distort metrics based on simple run counts. Unmonitored time must not be counted as downtime.
- **Decision:** Availability is calculated strictly as `UP / (UP + DOWN)` over observed durations. `UNKNOWN` and open `PROVISIONAL` intervals are excluded from the denominator; coverage is reported separately as `(UP + DOWN) / requested_window`. Every query window and rollup bucket satisfies the invariant: `UP + DOWN + UNKNOWN + PROVISIONAL = requested duration`.
- **Alternatives:** Ratio of successful runs to total runs; counting missing data as downtime; including UNKNOWN duration in the availability denominator.
- **Rationale:** Ensure identical uptime percentages for the same availability profile across different check cadences, and avoid turning monitoring gaps into false downtime or SLA breaches.
- **Consequences:** If no observation data exists, availability returns `null` rather than `0`. Daily, weekly, and monthly responses include explicit coverage and duration breakdowns; the frontend does not guess missing data.

## D-084 — History Outputs Use Bounded Budgets; Rollup Corrections Are Source-Driven and Bounded

- **Date:** 2026-10-10 17:27 +06:00
- **Status:** Accepted — Verified via Revision 21–25 schemas and housekeeping runtime
- **Context:** Scanning 30-second raw runs directly for monthly views produces query costs proportional to data age. Because late-finalized intervals can amend past buckets, simple monotonic time watermarks are insufficient.
- **Decision:** Daily, weekly, and monthly views return at most 288, 336, and 360 buckets respectively; minute and hour rollups are computed deterministically from primary source data. Source cursors enqueue modified ranges as bounded, progressive rebuild tasks. Minute corrections trigger hour corrections; averaging averages is prohibited.
- **Alternatives:** Scanning raw data on demand; append-only watermarks; rewriting all buckets in a single transaction whenever an interval finalizes; approximate availability estimations.
- **Rationale:** Guarantee accuracy during retrospective corrections, support worker idempotency and crash recovery, and ensure bounded query latency over monthly ranges.
- **Consequences:** If rollup projection lag exceeds the configured raw-tail budget, the history endpoint returns `503 Service Unavailable (history_projection_lagging)` rather than returning inaccurate or unbounded fallback queries. Dashboard and monitoring operations remain unaffected.

## D-085 — Housekeeping Operates as a Dedicated Process, Not an Independent Microservice

- **Date:** 2026-10-10 17:27 +06:00
- **Status:** Accepted — Stage 12 final architecture
- **Context:** Executing rollup aggregations, partition DDLs, and retention purging in the same event loop or connection pool as the API or monitoring workers could allow slow maintenance jobs to degrade core monitoring paths.
- **Decision:** `apps/housekeeping-worker` runs as a distinct process/container within the shared Node.js monorepo without a public API, using restricted `site_monitor_housekeeper` database privileges. It utilizes a separate small connection pool and manages independent loops for source scanning, rollups, partition management, and data retention.
- **Alternatives:** In-process cron inside the API; additional loops inside the monitor worker; a fully separate microservice with its own repository and database.
- **Rationale:** Provide operational fault isolation while avoiding the complexity and overhead of distributed microservices.
- **Consequences:** API and monitor worker readiness are independent of the housekeeping worker. Multiple worker replicas coordinate via `SKIP LOCKED`, deterministic upserts, and advisory locks, achieving idempotent execution.

## D-086 — Data Retention Enforces Compact Lineage Evidence Decoupled from Raw Runs

- **Date:** 2026-10-10 17:27 +06:00
- **Status:** Accepted — Verified via Revision 21 migration and retention safety tests
- **Context:** Foreign key chains connecting `check_runs → jobs/attempts` and `incidents/current-state/segments/health → check_runs` prevented enforcing differing retention targets (30 days for queues, 90 days for raw runs, 400 days for health and incident history).
- **Decision:** Forward-only Revision 21 writes compact `run_evidence` rows for accepted stateful runs and redirects long-lived state, incident, and health interval references to this table. Job/attempt locators in raw runs are preserved while foreign key constraints are removed; integrity is validated at insert time via triggers and functions. Migrations backfill evidence and verify row counts before altering constraints.
- **Alternatives:** Retaining all raw runs, jobs, and attempts for 400 days; removing incident foreign keys without evidence tracking; cascading deletes; ignoring retention requirements.
- **Rationale:** Preserve historical incident integrity while allowing raw partitions and queue tables to be purged on their respective schedules.
- **Consequences:** Referenced evidence records remain protected via `RESTRICT`; unreferenced evidence is purged after a grace period. Health interval child partitions cannot be dropped until their latest `ended_at` timestamp exceeds the retention horizon. Dropping production partitions is disabled until backfill, safety, and restore tests pass.

## D-087 — History Windows Align with Source Rollup Resolutions

- **Date:** 2026-10-10 17:44 +06:00
- **Status:** Accepted — Verified via pure window-planning test suites
- **Context:** Minute and hour rollup rows align with UTC calendar boundaries. Returning fixed bucket counts ending at arbitrary seconds would require fractional source row calculations at boundaries, making exact reconstruction from rollup data impossible.
- **Decision:** The history query records the exact database execution time as `generated_at`, while truncating the `to` boundary down to the nearest UTC minute for daily/weekly views, and the nearest UTC hour for monthly views. Rolling windows and buckets are computed backwards from this aligned boundary.
- **Alternatives:** Scanning raw intervals across arbitrary boundaries; approximating partial source bucket weights; extending windows forward into the future with UNKNOWN data.
- **Rationale:** Ensure exact, repeatable, and cacheable calculations from bounded rollups without producing approximate availability metrics, accepting an alignment edge of at most 59 minutes on monthly views.
- **Consequences:** The API returns `generated_at`, aligned `to`, and `data_through` as separate attributes. The UI displays data currency clearly; daily/weekly data latency is under a minute, and monthly data latency is under an hour.

## D-088 — Overlapping Rollup Ranges Serialized per Resolution Lane, Not per Replica

- **Date:** 2026-10-10 17:52 +06:00
- **Status:** Accepted — Verified via Revision 23 dual-replica race tests
- **Context:** While `SKIP LOCKED` prevents duplicate range processing, distinct source events can generate rebuild ranges covering overlapping checks and time buckets. If two workers process these ranges concurrently, delete-and-recompute operations cause primary key race conditions on hourly rollup tables.
- **Decision:** Minute and hour rollups operate under independent advisory lock lanes. Each invocation of `housekeeping_process_rollup_range` acquires its respective resolution lock for the duration of the transaction before claiming pending ranges via `SKIP LOCKED`. Revision 22 was preserved; the locking wrapper was introduced in forward-only Revision 23.
- **Alternatives:** Relying solely on range row locking; resolving conflicts via table triggers; acquiring granular locks per check and bucket; retrying duplicate key errors.
- **Rationale:** Guarantee accuracy using bounded batches and two independent lock lanes, preventing data loss or unique constraint violations during overlapping rollup recalculations.
- **Consequences:** Worker replicas provide safe failover and concurrent processing across resolutions, though throughput within the same resolution does not scale linearly with replica count. Profiling a 500-check dataset completed in 9.54 seconds (52.41 checks/sec); finer-grained sharded locking was deemed unnecessary for v1.

## D-089 — Data Retention Never Outpaces Projection Backlogs

- **Date:** 2026-10-10 18:01 +06:00
- **Status:** Accepted — Verified via Revision 24 and PostgreSQL backlog tests
- **Context:** If workers are offline, source cursors can lag behind retention cutoffs. If raw or minute partitions are detached while unconsumed, historical data not yet rolled up could be lost permanently.
- **Decision:** Partition drops and reference purges fail closed with `DEFERRED_PROJECTION_BACKLOG` unless the `data_through` scanning horizon for both sources is within five minutes of current time and all rebuild queues are empty. Revision 24 added the gate, and Revision 25 introduced distinct horizons confirming idle scans; Revision 22 remained untouched.
- **Alternatives:** Running retention unconditionally based on wall-clock time; checking only pending range counts; treating post-deletion restore from backups as standard operations.
- **Rationale:** Extending retention temporarily is safer than dropping source data needed to compute accurate historical metrics.
- **Consequences:** During substantial projection backlogs, partition and row purging are postponed and alerted via metrics and logs. Successful scans advance horizons even with low row volumes, preventing idle systems from stalling. Purging resumes automatically once backlogs clear; API and worker health remain unaffected.

## D-090 — Private History Uses Bounded Raw Tails or Controlled 503s Rather Than Hiding Stale Projections

- **Date:** 2026-10-10 18:29 +06:00
- **Status:** Accepted — Verified via Revision 26 and private API PostgreSQL tests
- **Context:** Falling back to scanning 30 days of raw data makes monthly query latency depend on dataset size; conversely, reading only rollups could return incomplete buckets as complete during scanner or rebuild backlogs. Granting the API role direct SELECT permissions on housekeeping tables broadens access excessively.
- **Decision:** The trailing 15 minutes for daily/weekly views and trailing 2 hours for monthly views are calculated on-the-fly from raw accepted runs, finalized intervals, and open intervals; older data is read from rollups. If the scan horizon or pending rebuild ranges for a check lag behind this tail, the endpoint returns a retryable `503 Service Unavailable (history_projection_lagging)`. The API calls the restricted `security_api.history_projection_status` function using the owner's context, without gaining table permissions on rebuild queues.
- **Alternatives:** Scanning raw data on every request; ignoring projection lag; granting the API role access to global checkpoint tables; coupling housekeeping worker health to overall API readiness.
- **Rationale:** Ensure bounded query latency, accurate no-data semantics, least privilege, and isolate housekeeping issues strictly to history endpoints.
- **Consequences:** History queries execute within read-only `REPEATABLE READ` transactions with bounded statement timeouts. Tombstoned checks retain queryable history; cross-tenant identifiers return `404 Not Found`. History endpoints use short private cache headers; incident journals remain `no-store`; dashboard and worker readiness remain independent of projection backlogs.

## D-091 — History Capacity Benchmark Evaluates Equivalent Rollup Volumes Separately from CI

- **Date:** 2026-10-10 19:02 +06:00
- **Status:** Accepted — Verified via Stage 12 capacity benchmarking
- **Context:** Generating 35 days of 30-second raw observations for 500 checks yields 50.4 million rows. By design, monthly APIs query hourly rollups rather than raw runs; inserting 50 million raw records in everyday CI runs wastes execution time and resources without testing production query paths.
- **Decision:** The large-scale benchmark represents identical query cardinality using 420,000 deterministic hourly rollup rows (each representing 120 raw samples). This profile executes explicitly via `pnpm test:history-capacity`, while regular CI runs maintain correctness, migration, and isolation tests. Real source discovery and minute-to-hour rollups across 20, 200, and 500 checks use dedicated fixtures within the heavy profile.
- **Alternatives:** Inserting 50.4 million raw runs in regular CI; claiming performance based only on small fixtures; relying on sanitized production dumps; omitting automated performance budgets entirely.
- **Rationale:** Maintain reproducible testing of genuine monthly query plans while keeping CI resource consumption bounded; clearly differentiate synthetic rollup equivalence from raw ingest capacity.
- **Consequences:** The benchmark report distinguishes dataset rows from equivalent raw sample counts. Measurements serve as hardware baselines rather than production SLOs; raw ingestion capacity is proven in the monitor report, and history query/housekeeping capacity is proven here.

## D-092 — Realtime Outbox Relay Operates as a Dedicated Process; NOTIFY Transmits Only Wake-Up Hints

- **Date:** 2026-10-10 19:12 +06:00
- **Status:** Accepted — Stage 13 final architecture
- **Context:** Every API replica must broadcast tenant changes to its connected clients, yet outbox dispatches must be claimed and completed by a single consumer. Granting the API role global outbox update privileges violates least privilege; relying on PostgreSQL `NOTIFY` payloads as durable data fails during disconnections and restarts.
- **Decision:** A dedicated `realtime-worker` without public APIs claims and completes `REALTIME` outbox dispatches using lease/fencing tokens. Dispatch completion and a lightweight, redacted wake-up signal sent via `pg_notify` to a static channel commit in the same transaction. Each API replica listens for broadcasts on this channel and reads the source DTO from the owner-scoped current projection table.
- **Alternatives:** Having every API replica consume the outbox with individual checkpoints; introducing Redis pub/sub; running the relay inside the API process.
- **Rationale:** Marry single durable dispatch consumption with multi-replica client fan-out without broadening API database permissions or event payloads.
- **Consequences:** The API role requires no elevated outbox permissions, multi-replica deployments operate safely, and worker outages do not bring down the main application. Dropped notifications are recovered via REST snapshot reconciliation.

## D-093 — SSE Acts as a Convergent Invalidation Channel via Snapshots, Not a Durable Replay Stream

- **Date:** 2026-10-10 19:12 +06:00
- **Status:** Accepted — Stage 13 final architecture
- **Context:** Building durable event replay for browser clients introduces per-client offset tracking, retention management, authorization updates, and tombstone tracking; the actual product requirement is updating UI state within seconds.
- **Decision:** SSE provides best-effort, idempotent, coalesced invalidation signals. The client opens the stream, waits for `stream.ready`, retrieves a baseline REST snapshot, and applies buffered version updates. Reconnections, resync events, foreground switches, and periodic 60-second refreshes reconcile state via REST snapshots.
- **Alternatives:** Durable SSE event storage with browser replay; reconstructing client state purely from event streams; combining event invalidation with periodic REST polling.
- **Rationale:** Rely on owner-scoped PostgreSQL projections for durable correctness and decouple transient stream interruptions from application consistency.
- **Consequences:** Dropped events do not corrupt application state, and `Last-Event-ID` does not serve as an authorization or correctness token. The client coordinates query caching and snapshots; transient push disconnects delay updates at most by the polling interval.

## D-094 — Subscriber State Resides in API Replica Memory with Layered Concurrency Limits

- **Date:** 2026-10-10 19:12 +06:00
- **Status:** Accepted — Stage 13 final architecture
- **Context:** Open SSE connections are inherently pinned to a specific API instance. Introducing Redis for distributed connection tracking adds complexity without improving state consistency.
- **Decision:** The subscriber hub is in-memory and bounded within each API replica. The application enforces admission limits per session, owner, IP, and replica; global connection limits are managed by reverse proxies or WAF layers. Sticky sessions are not required.
- **Alternatives:** Distributed Redis connection registry; database-backed connection leases; bounded hubs inside API replicas.
- **Rationale:** Deliver fast, lightweight tenant routing and connection backpressure without introducing external infrastructure dependencies.
- **Consequences:** There is no strict cluster-wide user connection cap; maximum concurrent connections scale with replica count as documented and verified via capacity tests.

## D-095 — Browser Client Uses Fetch-Stream Parser Rather Than Native EventSource

- **Date:** 2026-10-10 19:12 +06:00
- **Status:** Accepted — Stage 13 final architecture
- **Context:** The API specification requires detecting stale connections via 45-second heartbeat comments and handling 401/404/429 status codes with customized reconnection strategies. The native browser `EventSource` API hides comments and provides limited visibility into HTTP response codes.
- **Decision:** The browser transport uses credentialed `fetch` with readable streams, `AbortController`, and a custom parser. Comments update activity timestamps; HTTP status, content-types, stale timeouts, and full-jitter reconnection backoffs are controlled in application logic.
- **Alternatives:** Native `EventSource`; converting heartbeats into application data events; adopting third-party SSE client libraries.
- **Rationale:** Support heartbeat detection and fine-grained HTTP error policies without altering wire protocols or adding heavy dependencies.
- **Consequences:** The parser requires comprehensive unit tests covering chunk boundaries, UTF-8 decoding, and SSE framing; no external runtime libraries are required.

## D-096 — Public SSE Withheld from Production Until Public Snapshots Are Ready

- **Date:** 2026-10-10 19:12 +06:00
- **Status:** Accepted — Stage 13 final architecture
- **Context:** OpenAPI reserves public SSE routes, but public token lookup, allowlisted snapshots, and page revision projections belong to Stage 15. Opening the streaming endpoint early compromises race-free reconciliation and data minimization guarantees.
- **Decision:** Stage 13 implements private real-time capabilities along with public transport interfaces and unit tests. The production public SSE endpoint is activated in Stage 15 alongside public REST snapshots, token lifecycles, and projection allowlists.
- **Alternatives:** Shipping an incomplete public route in Stage 13; pulling forward the public status domain; deferring the entire route and snapshot to Stage 15.
- **Rationale:** Prevent releasing unverified public APIs that could potentially leak sensitive tenant monitoring data.
- **Consequences:** Stage 13 acceptance covers private multi-client and multi-replica synchronization; public end-to-end acceptance is explicitly assigned to Stage 15.

## D-097 — Authenticated Frontend Developed via Working Functional Slices Without a Separate Architecture Document

- **Date:** 2026-10-10 20:37 +06:00
- **Status:** Accepted — User directive
- **Context:** Backend, data, and real-time boundaries are already thoroughly defined in OpenAPI and domain documentation. Producing a separate `FRONTEND_ARCHITECTURE.md` before Stage 14 would delay implementation and largely duplicate existing specifications.
- **Decision:** A separate frontend architecture document will not be created. The authenticated UI is developed in small, directly functional slices: current status, history/incidents, maintenance windows, and notification management. Major architectural decisions are recorded in this log, user behavior is verified via component and Playwright tests, and scope is tracked in `PROJECT_STATUS.md`.
- **Alternatives:** Writing a full frontend architecture document with wireframes before implementation; developing all of Stage 14 as a single monolithic PR.
- **Rationale:** Prioritize implementation velocity while preserving traceability, accessibility, and automated regression verification; retain the existing backend specification as the sole source of truth.
- **Consequences:** A standalone frontend architecture file is not a delivery artifact. Each functional slice is verified with its own tests, CI gates, and granular commits; if backend contracts change, existing documentation is updated accordingly.

## D-098 — Public Status Reads Use a Dedicated Database Role and Allowlist Projection

- **Date:** 2026-10-10 21:07 +06:00
- **Status:** Accepted — Delivery implementation
- **Context:** Anonymous viewers must receive up-to-date status information without leaking tenant IDs or private check fields, and the mechanism must survive server restarts.
- **Decision:** The management API generates opaque tokens, with only their SHA-256 digests stored in PostgreSQL. Anonymous requests use a dedicated `site_monitor_public` connection pool calling a single `SECURITY DEFINER` function that projects only allowlisted public components from live monitoring state. The browser uses 10-second REST polling.
- **Alternatives:** Querying tables directly using the general API role; filtering full check DTOs in the application layer; shipping public SSE in the initial release.
- **Rationale:** Enforce least privilege and data minimization at the database boundary while avoiding unneeded real-time push complexity on the critical delivery path.
- **Consequences:** Public status pages update without manual page reloads, and tokens are masked in logs. Updates may lag by at most the polling interval; public SSE remains a future enhancement.

## D-099 — Python Early Warning System Excluded from Delivery Scope

- **Date:** 2026-10-10 21:07 +06:00
- **Status:** Accepted — User scope decision
- **Context:** The predictive anomaly feature is not part of core requirements, and delivery priorities focus on robust core monitoring, frontend usability, and reproducible deployment.
- **Decision:** The predictor analysis and ML model lifecycle will not be implemented or presented as completed product features. The existing isolated draft remains in the repository without being deleted, but is excluded from the default `app` Compose profile and primary service readiness checks.
- **Alternatives:** Rushing a simplistic heuristic score; attaching the unverified draft to the main system; deleting prior exploratory code from the repository.
- **Rationale:** Avoid misrepresenting unverified experimental AI features as production-ready and eliminate unnecessary operational risk from the core product.
- **Consequences:** The core product operates strictly on the Node.js and PostgreSQL runtime. The exploratory draft can be investigated independently in the future, but is officially out of scope for the current delivery.
