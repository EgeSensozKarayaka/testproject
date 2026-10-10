# Site Availability Monitor

A multi-tenant website availability monitoring platform with strict, user-based ownership isolation.

The system periodically probes HTTP endpoints, tracks response times and availability, opens and closes incidents, suppresses notifications during maintenance windows, and exposes an owner-controlled public status page. It is designed as a production-oriented modular monolith with separate web, API, and worker processes.

## Highlights

- React dashboard with live status updates through authenticated Server-Sent Events (SSE)
- Node.js API and four isolated worker runtimes
- PostgreSQL persistence with row-level security and forward-only migrations
- Owner-scoped groups, checks, maintenance windows, notification policies, and history
- Incident detection that tolerates a single transient failure
- Email delivery through an isolated notification worker; Mailpit is used locally
- Public status pages that expose only explicitly allowlisted checks and fields
- Deterministic target simulator for success, error, delay, redirect, and timeout scenarios
- Capacity profiles for 20, 200, and 500 checks without a fixed 50-check ceiling
- Docker Compose setup for a repeatable local environment

## Contents

- [Architecture at a glance](#architecture-at-a-glance)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Local verification](#local-verification)
- [Daily development](#daily-development)
- [Quality and test commands](#quality-and-test-commands)
- [API contracts and end-to-end tests](#api-contracts-and-end-to-end-tests)
- [Database management](#database-management)
- [Target simulator](#target-simulator)
- [Repository structure](#repository-structure)
- [Current status and limitations](#current-status-and-limitations)
- [Documentation](#documentation)

## Architecture at a glance

| Component           | Responsibility                                                                   |
| ------------------- | -------------------------------------------------------------------------------- |
| Web                 | React application for private monitoring operations and public status pages      |
| API                 | Authentication, owner-scoped REST endpoints, validation, and SSE connections     |
| Monitor worker      | Fair scheduling, probe dispatch, lease recovery, and freshness evaluation        |
| Notification worker | Persistent notification consumption and SMTP delivery                            |
| Housekeeping worker | Rollups, retention, and source discovery                                         |
| Realtime worker     | Event leases, fencing, and PostgreSQL-backed realtime wake-ups                   |
| PostgreSQL          | Durable state, ownership constraints, row-level security, and history partitions |
| Target simulator    | Deterministic HTTP behavior for local and automated testing                      |
| Mailpit             | Captures development email without contacting an external provider               |

The authenticated dashboard reconciles SSE events with snapshots, allowing multiple browser clients to converge without page refreshes. Public status pages use 10-second polling and an isolated read-only data path.

For the full design, see [Architecture](docs/docs-english/ARCHITECTURE.md).

## Prerequisites

- Git 2.40 or newer
- Docker Desktop, or Docker Engine with Docker Compose v2
- Node.js `24.19.0` and pnpm `11.25.0` for host-side development

## Quick start

Start the complete container stack:

```sh
docker compose --profile app up --detach --build --wait
```

PostgreSQL starts first, followed by a one-off migration job. The API and workers start only after the migrations complete successfully.

To add the initial development fixtures after startup:

```sh
pnpm db:seed
```

The seed data does not create a reusable login password. Use the registration and Mailpit verification flow described below for the browser demo.

### Local endpoints

| Component        | Address                               | Purpose                             |
| ---------------- | ------------------------------------- | ----------------------------------- |
| Web application  | <http://localhost:15173>              | React user interface                |
| API readiness    | <http://localhost:13000/health/ready> | API health and readiness probe      |
| Target simulator | <http://localhost:4010/ok>            | Local probe scenarios               |
| Mailpit          | <http://localhost:8025>               | Captured development email          |
| PostgreSQL       | `localhost:15432`                     | Database access for host-side tools |

### Inspect and stop the stack

Inspect container status or follow logs:

```sh
docker compose --profile app ps
docker compose --profile app logs --follow
```

Stop the stack while preserving the database volume:

```sh
docker compose --profile app down
```

> [!CAUTION]
> `docker compose down --volumes` deletes persistent local data. Do not use it during routine development unless that data loss is intentional.

## Local verification

### Authentication flow

1. Open <http://localhost:15173> and create an account.
2. Open Mailpit at <http://localhost:8025>.
3. Follow the verification link in the captured email.
4. Sign in and confirm that the private monitoring workspace opens.
5. Optionally test **Forgot password** and follow the second Mailpit link.

Registration and password-reset requests return the same generic response whether an account exists or not. This prevents account enumeration.

Local HTTP development uses cookies with `Secure=false`. Production configuration fails fast unless secure secrets and HTTPS-compatible cookie settings are provided.

### Monitoring flow

After signing in, you can:

- create groups and HTTP checks;
- edit, pause, resume, manually run, and delete checks;
- inspect daily, weekly, and monthly response-time and availability history;
- review incident start, recovery, and duration details;
- schedule maintenance for a check or group;
- manage verified email recipients and default group policies; and
- create an anonymous public status link with an explicit check allowlist.

To verify optimistic concurrency, sign in to the same account from a second browser or incognito window. A stale edit produces an explanatory warning and reloads the current resource instead of silently overwriting newer data.

## Daily development

Install dependencies and start only the infrastructure services:

```sh
pnpm install --frozen-lockfile
pnpm dev:infra
pnpm db:migrate
pnpm db:seed
```

Then start the web application, API, and all four required workers with hot reload:

```sh
pnpm dev
```

Copy `.env.example` to `.env` when local overrides are needed. `.env` is ignored by Git, and `.env.example` contains no live secrets.

### Runtime limits and probe safety

The product does not hardcode a 50-check limit. The following deployment settings accept positive values, or the literal `unlimited` for intentionally unconstrained local environments:

- `CHECKS_PER_OWNER_LIMIT`
- `GROUPS_PER_OWNER_LIMIT`
- `MAINTENANCE_WINDOWS_PER_OWNER_LIMIT`

Probe egress ports, total deadlines, response-body limits, header limits, and redirect limits are configured through the `PROBE_*` variables in `.env.example`.

Access to the local target simulator is controlled through an exact-origin development allowlist. Production startup fails if this development-only bypass remains enabled.

### Optional predictor draft

`services/predictor/` contains an isolated Python research draft. It is deliberately outside the delivered product scope, is not started by the default `app` Compose profile, and does not contain an operational prediction model or model lifecycle. No primary platform health check or execution path depends on it.

## Quality and test commands

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:capacity
pnpm test:history-capacity
pnpm test:realtime-capacity
pnpm build
pnpm run ci
```

`pnpm run ci` executes the local unified pipeline: formatting, linting, type checking, unit and integration tests, and the production build.

> [!NOTE]
> Use `pnpm run ci`, not `pnpm ci`. pnpm interprets `pnpm ci` as its clean-install command (`pnpm install --frozen-lockfile`).

### Capacity evidence

- `pnpm test:capacity` profiles the production scheduler → queue → dispatcher → observation path against real PostgreSQL with 20, 200, and 500 due checks. See the [monitor capacity report](docs/docs-english/MONITOR_CAPACITY_REPORT.md).
- `pnpm test:history-capacity` measures housekeeping rollup throughput, a 35-day monthly query at a 500-check equivalent, and API/housekeeper isolation. See the [history capacity report](docs/docs-english/HISTORY_CAPACITY_REPORT.md).
- `pnpm test:realtime-capacity` measures 20, 200, and 500-event bursts across two API replicas, concurrent owner-scoped REST reads, and slow-client isolation. See the [realtime capacity report](docs/docs-english/REALTIME_CAPACITY_REPORT.md).

Process termination, natural lease recovery, and stale-result fencing are covered in the [failure recovery report](docs/docs-english/MONITOR_FAILURE_RECOVERY_REPORT.md). API readiness and authenticated list isolation across two real worker processes are covered in the [runtime isolation report](docs/docs-english/MONITOR_RUNTIME_ISOLATION_REPORT.md).

## API contracts and end-to-end tests

`docs/openapi-v1.yaml` is the canonical API contract. Generate TypeScript types and Fastify validation schemas, or check for contract drift, with:

```sh
pnpm contracts:generate
pnpm contracts:check
```

Files under `packages/contracts/src/generated/` are generated and must not be edited manually.

Install Playwright Chromium and run the end-to-end suite while the `app` profile is running:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

On Windows, an existing Microsoft Edge installation can be used without downloading Chromium:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
pnpm test:e2e
```

## Database management

Apply migrations or load idempotent development fixtures:

```sh
pnpm db:migrate # Applies pending forward-only migrations
pnpm db:seed    # Development and test environments only
```

Inspect migration status:

```sh
pnpm --filter @site-monitor/database db:status
```

Database reset is intentionally double-guarded. It runs only against local or test database names when `ALLOW_DATABASE_RESET=true` is set:

```powershell
$env:ALLOW_DATABASE_RESET = 'true'
pnpm db:reset
Remove-Item Env:ALLOW_DATABASE_RESET
```

Applied migration files are immutable. Corrections are introduced as new forward migrations. Local credentials are documented in `.env.example`; credentials and raw connection strings are never written to application logs.

## Target simulator

| Route                           | Behavior                                         |
| ------------------------------- | ------------------------------------------------ |
| `/ok`                           | Fast `200 OK` response                           |
| `/status/:code`                 | Returns the requested HTTP status code           |
| `/delay/:milliseconds`          | Adds bounded response latency                    |
| `/hang`                         | Keeps the connection open without responding     |
| `/stream/:chunks/:delay`        | Streams a chunked response with controlled delay |
| `/body/match`, `/body/mismatch` | Tests expected response-body assertions          |
| `/large/:bytes`                 | Returns a bounded large response                 |
| `/compressed/:encoding`         | Returns a bounded compressed response            |
| `/redirect/:remaining`          | Produces a bounded redirect chain                |
| `/redirect-loop/:key`           | Produces a deterministic redirect loop           |
| `/redirect-to?url=...`          | Tests redirect target policy                     |
| `/flaky/:key`                   | Produces deterministic intermittent failures     |
| `/close`                        | Closes the socket before a complete response     |
| `/health/live`, `/health/ready` | Container liveness and readiness probes          |

## Repository structure

```text
apps/               Web, API, workers, and target simulator
packages/           Domain, auth, contracts, configuration, database, and shared adapters
database/           Immutable SQL migrations and development seed data
services/predictor/ Isolated, out-of-scope Python research draft
infra/docker/       Multi-stage Dockerfiles and container definitions
docs/               Architecture, decisions, status, evidence, and engineering logs
e2e/                Playwright system and integration tests
```

## Current status and limitations

The planned delivery scope for Phases 0–14 is complete. The current implementation includes:

- 34 immutable, forward-only SQL migrations;
- composite ownership constraints, forced PostgreSQL row-level security, and scoped service roles;
- real account registration, verification, session, and password-reset flows;
- owner-scoped APIs for groups, checks, maintenance, notifications, history, incidents, and public status pages;
- authenticated private SSE with browser snapshot reconciliation;
- a bounded HTTP probe engine and deterministic health/incident reducer;
- persistent monitor, notification, housekeeping, and realtime workers;
- fixed 288/336/360 history buckets with a bounded raw tail;
- signed incident pagination with observed and unobserved history segments; and
- an opaque-token public status path backed by an isolated read-only database role.

Session tokens are stored only as cryptographic digests. Authentication email payloads are encrypted with AES-256-GCM, and SMTP delivery runs in a separate worker process.

The monitor runtime uses owner-fair scheduling, bounded dispatch, lease recovery, and freshness evaluation. Its readiness probe reflects loop failures, while graceful shutdown stops new claims and drains active work within a bounded deadline. Real PostgreSQL profiles have been exercised with 20, 200, and 500 checks.

Known limitations:

- The Python prediction feature is intentionally excluded from the delivered scope.
- Local logical restore tests have passed, but production backup/PITR automation has not been provisioned.
- Formal production RPO and RTO targets have not yet been established or validated.

See [Project status](docs/docs-english/PROJECT_STATUS.md) for the detailed evidence matrix and [Next steps](docs/docs-english/NEXT_STEPS.md) for recommended follow-up work.

## Documentation

- [Architecture](docs/docs-english/ARCHITECTURE.md)
- [Development environment](docs/docs-english/DEVELOPMENT_ENVIRONMENT.md)
- [API design](docs/docs-english/API_DESIGN.md)
- [Authentication and ownership](docs/docs-english/AUTH_AND_OWNERSHIP.md)
- [Database design](docs/docs-english/DATABASE.md)
- [Check engine](docs/docs-english/CHECK_ENGINE.md)
- [Scheduler and workers](docs/docs-english/SCHEDULER_AND_WORKERS.md)
- [Notifications](docs/docs-english/NOTIFICATIONS.md)
- [Realtime architecture](docs/docs-english/REALTIME.md)
- [Decision log](docs/docs-english/DECISIONS.md)
- [Development log](docs/docs-english/DEVELOPMENT_LOG.md)
- [AI usage](docs/docs-english/AI_USAGE.md)
- [Project status](docs/docs-english/PROJECT_STATUS.md)
