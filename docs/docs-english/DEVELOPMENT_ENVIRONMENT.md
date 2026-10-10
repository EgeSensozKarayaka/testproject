# Site Availability Monitor — Repository and Development Environment Architecture

**Version:** 1.1
**Status:** Phase 2 implemented and verified
**Date:** 2026-10-10 00:50 +06:00
**Basis:** `ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `STATE_MACHINES.md`

## 1. Purpose

This document finalizes the repository structure, runtime versions, dependency management, local development modes, Docker Compose topology, configuration approach, quality commands, and CI gates.

The purpose of this phase is not to develop product features, but to establish a reliable foundation where all subsequent phases can progress with the same tools, boundaries, and reproducible commands.

## 2. Key Decisions

| Area                      | Decision                                                 |
| ------------------------- | -------------------------------------------------------- |
| Repository                | Single Git repository, polyglot monorepo                 |
| Node runtime              | Node.js 24 LTS; exact patch version pinned               |
| Node package manager      | pnpm 11.25.x; exact version pinned within repository      |
| Python runtime            | CPython 3.14.x; minor series locked for predictor        |
| Python dependency manager | `uv`, `pyproject.toml`, and committed `uv.lock`       |
| Local PostgreSQL base     | PostgreSQL 18.6, Debian Bookworm image                   |
| Node module system        | ESM                                                      |
| Node language             | Strict TypeScript                                        |
| Task orchestration        | pnpm workspace commands; initially no Turborepo/Nx       |
| Local infrastructure      | Docker Compose v2                                        |
| Host development          | Applications hot-reloaded on host, infrastructure in containers |
| Full-stack verification   | All services in containers via Compose profile           |
| CI target                 | Linux runner; Windows host development compatibility maintained |
| Main CI                   | GitHub Actions                                           |

Node.js 24 is officially in LTS status as of the design date. For the Python predictor, rather than the new major released on the same date, the more mature Python 3.14 series in terms of package ecosystem is preferred. Versions are fixed not with the `latest` tag, but via pin files and container tag/digest.

## 3. Repository Structure

```text
/
├─ apps/
│  ├─ web/                    # React/Vite browser application
│  ├─ api/                    # Fastify API and SSE entrypoint
│  ├─ monitor-worker/         # Scheduler and probe execution entrypoint
│  ├─ notification-worker/    # Outbox and SMTP entrypoint
│  ├─ housekeeping-worker/    # Rollup, partition, and retention entrypoint
│  ├─ realtime-worker/        # Outbox relay and PostgreSQL wake-up entrypoint
│  └─ target-simulator/       # Test/demo target server
│
├─ packages/
│  ├─ domain/                 # Framework-agnostic domain rules
│  ├─ database/               # Repository, transaction, and migration tools
│  ├─ check-engine/           # SSRF-safe HTTP probe engine
│  ├─ notifications/          # Notification policies and templates
│  ├─ contracts/              # API/event schemas and shared public types
│  ├─ config/                 # Typed environment/config loading
│  ├─ observability/          # Log, metric, and correlation utilities
│  └─ testing/                # Test fixtures/factories and shared test helpers
│
├─ services/
│  └─ predictor/              # Optional Python worker
│
├─ database/
│  ├─ migrations/
│  └─ seeds/
│
├─ infra/
│  └─ docker/
│     ├─ node.Dockerfile
│     ├─ predictor.Dockerfile
│     └─ entrypoints/
│
├─ docs/
├─ scripts/                   # Shell-independent Node helper scripts
├─ .github/workflows/
├─ compose.yaml
├─ package.json
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml
├─ tsconfig.base.json
├─ eslint.config.js
├─ prettier.config.js
├─ .editorconfig
├─ .gitattributes
├─ .gitignore
└─ .env.example
```

`apps/*` contains only composition roots and runtime-specific adapters. Domain rules, repository implementations, or notification policies are not duplicated across app directories.

## 4. Workspace Boundaries and Dependency Direction

Main permitted direction:

```text
apps/*
  ├─> packages/contracts
  ├─> packages/config
  ├─> packages/observability
  ├─> packages/domain
  ├─> packages/database
  ├─> packages/check-engine
  └─> packages/notifications

database/check-engine/notifications ──> domain
web ──> contracts
domain ──> no infrastructure packages
```

Rules:

- `domain` has no knowledge of Fastify, PostgreSQL, React, SMTP, or environment variables.
- `web` cannot import server-only packages; it uses only `contracts` and browser-safe packages.
- `contracts` does not directly leak domain entities outside; it carries API/event schemas.
- `database` implements domain interfaces, but the domain has no dependency on the database.
- `check-engine` is a network adapter; it returns normalized observations to the domain.
- `notifications` uses domain events and policy interfaces; SMTP calls reside in the adapter layer.
- Workspace dependencies are explicitly defined using the `workspace:*` protocol.
- Circular workspace dependencies are considered errors in CI.

Initially, there are no independently published npm packages. All workspace packages remain private.

## 5. Runtime and Version Policy

### Node.js

- Node.js `24.x` LTS is used.
- The exact patch that runs and is verified during the initial scaffold is pinned to the same value across `.nvmrc`/`.node-version`, `engines`, and the CI setup file.
- The container base image uses the same major/minor/patch version; digest is pinned prior to release.
- Only a single Node major version is supported; broad `>=` ranges are not allowed.
- LTS security updates are applied in a controlled manner via dependency update PRs.

Since the local runtime at design time was `v24.19.0`, this is a suitable candidate for the initial pin. The pin is not finalized until the same version is verified in the container registry during implementation.

### pnpm

- The package manager version is pinned exactly in root `package.json`.
- `pnpm-lock.yaml` is committed and not edited manually.
- CI and container installations run with frozen lockfile.
- `pnpm-workspace.yaml` is the single source of scope for the workspace.
- Intra-workspace imports use `workspace:*`.
- No runtime dependencies are added to root; root carries only repository tooling.

The initial version was planned as `pnpm 11.25.0`. Major updates are not performed automatically; they require a separate decision and CI verification.

### Python

- Predictor is bound to the CPython 3.14 series with `requires-python = "==3.14.*"`.
- `.python-version` specifies the development minor version; the container is pinned with exact patch/digest.
- The newly released Python 3.15 is not used for the initial release; it will be evaluated as a separate update after scientific/analytical dependency compatibility is proven.
- Host Python is not mandatory; predictor can be run via Docker profile.

### uv

- `services/predictor/pyproject.toml` is the dependency declaration.
- `services/predictor/uv.lock` is committed as the exact resolution.
- CI uses `uv sync --locked` and `uv run --locked`.
- The uv version is pinned in CI and the Dockerfile.
- Predictor dependencies do not mix with the root Node lockfile.

### PostgreSQL and Helper Images

The local infrastructure base is initiated with PostgreSQL `18.6-bookworm` and Mailpit `v1.31.4`. PostgreSQL 18 compatibility, extension requirements, and schema features are further verified in Phase 3 database design; unless an incompatibility is found, this same major becomes the production base. No Compose service permanently uses the `latest` tag. Verified image digests are also pinned prior to release.

## 6. TypeScript Standard

TypeScript runs with the following strictness/safety options:

- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `useUnknownInCatchVariables`
- `noImplicitOverride`
- `noFallthroughCasesInSwitch`
- `noImplicitReturns`
- `forceConsistentCasingInFileNames`

The shared `tsconfig.base.json` contains only shared security and module settings. Browser, Node app, and library packages isolate their environment libraries using their own `tsconfig.json` files.

ESM is used. Node packages compile using ESM and modern Node resolution rules; the frontend uses Vite bundler resolution. Package exports are preferred over ambiguous path aliases for testing or building.

Build outputs are generated outside the source tree under `dist/` and are not committed to Git. Source maps can be generated; access to production source maps is restricted according to the deployment policy.

## 7. Node Quality Tools

### Lint

ESLint flat config is used. Rules:

- TypeScript type-aware lint
- React hooks and accessibility checks
- Promise misuse/floating promise checks
- Import boundary and cycle checks
- Separate environment rules for test files

### Format

Prettier is the single formatter. ESLint is not used as a formatting tool. CI does not alter formatting; it only verifies via `format:check`.

### Test

- Vitest: domain, package, and component unit tests
- Vitest + real PostgreSQL/Testcontainers or CI service: integration tests
- React Testing Library: behavior-driven UI component tests
- Playwright: critical browser end-to-end flows

Tests may be located alongside source code as `*.test.ts`/`*.test.tsx` or in package `test/` directories; a single convention is chosen across the repository and not mixed. E2E tests are kept under root `e2e/`.

Coverage is a quality goal, but not the sole success criterion. Domain state machine, tenant isolation, and scheduler concurrency tests must have mandatory path coverage.

## 8. Python Quality Tools

For the predictor:

- Ruff: lint and format
- mypy: near-strict static type checking
- pytest: unit and integration tests
- Coverage.py/pytest-cov: meaningful coverage reporting

The Python package uses a `src/` layout. A notebook cannot be production code or the sole source of a model; if experimental notebooks exist, they are kept under `experiments/` with an executable pipeline and decision log.

Model/algorithm artifacts are not indiscriminately committed to Git as binaries. Except for small deterministic fixtures, large artifacts use the registry/storage approach defined in the subsequent predictor design.

## 9. Root Command Contract

Commands that users and CI need to remember must run from the root. The planned contract:

```text
pnpm install --frozen-lockfile   # Locked Node dependencies
pnpm dev:infra                   # PostgreSQL, Mailpit, and simulator
pnpm dev                         # Web, API, and mandatory workers
pnpm dev:prediction              # Optional predictor
pnpm build                       # All production builds
pnpm typecheck                   # All TS projects
pnpm lint                        # Node/web lint
pnpm format:check                # Format check
pnpm test:unit                   # Fast unit tests
pnpm test:integration            # PostgreSQL/external adapter integrations
pnpm test:e2e                    # Playwright flows
pnpm test                        # Unit + integration default suite
pnpm run ci                      # Local equivalent of CI quality gates
pnpm db:migrate                  # Up migrations
pnpm db:seed                     # Idempotent demo seed
pnpm db:reset                    # Local/test only; rejected in production
```

Scripts do not contain Bash-only syntax. The same command names are used across Windows, macOS, and Linux. When complex orchestration is required, cross-platform Node scripts such as `scripts/*.mjs` are written; long shell chains are not embedded into package.json.

`pnpm dev` does not automatically delete or recreate infrastructure services. Destructive `db:reset` requires an explicit environment guard.

## 10. Local Development Modes

### Mode A — Host Applications + Container Infrastructure

Default for day-to-day development:

```text
Host:
  web, api, monitor-worker, notification-worker, housekeeping-worker, realtime-worker

Docker:
  postgres, mailpit, target-simulator
```

Advantages:

- Fast hot reload
- IDE/debugger integration
- Natural usage of Node dependency cache
- Reproducibility of infrastructure services

If not working on the predictor, a Python host installation is not required.

### Mode B — Full Container Stack

For CI-like verification and demos:

```text
docker compose --profile app up --build
```

All main applications run inside containers. This mode is not optimized for hot reload; it is intended for clean-environment verification.

### Mode C — Prediction Profile

The predictor starts only with an explicit profile:

```text
docker compose --profile prediction up --build predictor
```

API or worker services do not carry a `depends_on` for the predictor.

## 11. Docker Compose Topology

Planned services:

| Service                | Default/Profile      | Persistent Volume | Health Dependency                                       |
| ---------------------- | -------------------- | ----------------- | ------------------------------------------------------- |
| `postgres`             | Default              | Yes               | Own healthcheck                                         |
| `mailpit`              | Default              | No                | Own healthcheck                                         |
| `target-simulator`     | Default              | No                | HTTP healthcheck                                        |
| `api`                  | `app`                | No                | PostgreSQL ready + migration + dedicated listener ready |
| `monitor-worker`       | `app`                | No                | PostgreSQL ready + migration complete                   |
| `notification-worker`  | `app`                | No                | PostgreSQL ready; SMTP readiness does not block startup |
| `housekeeping-worker`  | `app`                | No                | PostgreSQL ready + migration complete                   |
| `realtime-worker`      | `app`                | No                | PostgreSQL ready + migration complete                   |
| `web`                  | `app`                | No                | API liveness; no hard startup dependency required      |
| `predictor`            | `prediction`         | No                | PostgreSQL ready; core services not dependent on it     |
| `migrate`              | One-shot profile/job | No                | PostgreSQL ready                                        |

Compose rules:

- The internal database network is exposed to the host solely for local development purposes.
- Services use container names as DNS hosts; `localhost` is not shared.
- The PostgreSQL volume carries an explicit name and is not accidentally deleted.
- Mailpit data is ephemeral by default.
- Healthchecks check the minimum required dependency rather than process presence alone.
- Each API replica uses a single-connection `LISTEN site_monitor_realtime_v1` pool separate from the request pool; if the listener is disconnected beyond grace, readiness fails-closed.
- `depends_on` does not replace readiness; applications connect with retry/backoff.
- Resource limits can be defined especially for workers and the predictor.
- When the predictor profile is inactive, Compose remains valid and the core system is fully functional.

## 12. Container Image Principles

- Multi-stage builds are used.
- Dependency installation is performed using frozen lockfiles.
- The runtime image contains only required production files.
- The process does not run as the root user.
- Shell and package manager are not included in the runtime image unless necessary.
- App-specific target images can be produced from a single Node build context; entrypoints are clearly separated.
- Secrets are not written to build arguments or image layers.
- Commit SHA/build timestamp can be added via OCI labels.
- Containers initiate graceful shutdown upon receiving `SIGTERM`.
- Image tags are traceable commit/release values; production does not use `latest`.

## 13. Port and URL Contract

Local defaults:

| Component        | Port                                 |
| ---------------- | ------------------------------------ |
| Web dev server   | `5173`                               |
| Web container    | `15173` (host), `8080` (Compose network) |
| API              | `13000` (host), `3000` (Compose network) |
| Target simulator | `4010`                               |
| PostgreSQL       | `15432` (host), `5432` (Compose network) |
| Mailpit SMTP     | `1025`                               |
| Mailpit UI       | `8025`                               |
| Predictor        | `18000` (host), `8000` (Compose network) |

Ports can be overridden via environment variables. The frontend only uses the public API base URL; database or SMTP addresses do not enter the browser build.

The HTTP development exception for local cookie security is managed through explicit configuration. Secure-cookie protection cannot be disabled in production.

## 14. Configuration and Secret Management

Each process validates only the variables it requires at startup using a typed schema. Missing or invalid critical configuration halts the process before startup with an explicit error message.

Planned groups:

- Runtime identity and environment
- API host/origin/cookie settings
- Process-specific PostgreSQL connection URL/role
- Scheduler concurrency, lease, and grace settings
- Probe timeout/size/redirect limits
- SMTP connection
- Retention/housekeeping settings
- Public/SSE limits
- Predictor enable/resource settings

Rules:

- `.env.example` contains no real secrets.
- `.env` is not committed to Git.
- Behavioral groupings are not managed by a single ambiguous environment flag other than `NODE_ENV`; features carry explicit variables.
- Configuration is parsed once at process startup and injected as an immutable typed object.
- Secret values are not logged; a redacted configuration summary can be produced.
- Only explicit allowlist variables such as `VITE_PUBLIC_*` are exposed to the frontend.
- Production secrets originate from the platform secret store; they are not kept in the repository.

## 15. Database Development Workflow

Phase 3 has implemented the definitive schema. The repository adheres to the following contract:

- Migrations are single, forward-only, and sequential.
- Application startup does not execute automatic destructive migrations.
- `migrate` is a separate one-shot command/job.
- Seed is idempotent and generates only local/demo data.
- The test database uses an isolated schema or database for each test worker.
- Production reset/drop commands are rejected by environment guards.
- Migration status can be verified by health/readiness checks.

## 16. Test Environment Strategy

### Unit Tests

- Do not require external services.
- Use fake clocks, deterministic IDs, and seeded randomness.
- Domain tests do not directly call real time or network connections.

### Integration Tests

- Use real PostgreSQL.
- Run in isolation with Testcontainers or CI PostgreSQL service.
- Each suite executes migrations authentically.
- Transaction rollback is not the sole isolation method; concurrent worker tests must observe real commits.

### E2E Tests

- Use built or production-like services.
- Verify external behavior via Mailpit API and target simulator.
- Wait for observable conditions rather than fixed sleeps.
- Clean up created data or tear down the ephemeral stack at the end of the test.

### Time-Controlled Tests

State machine tests use an injectable clock. PostgreSQL time and lock tests use real clocks with tolerant assertions. Long 30-second/1-hour waits are not performed with real time in tests.

## 17. CI Pipeline

The primary GitHub Actions workflow runs on pull requests and pushes to the main branch.

### Job 1 — Repository validation

- Lockfile and workspace consistency
- Forbidden secret/file scanning
- Markdown and basic document link checks
- Generated artifact drift checks — when introduced

### Job 2 — Node quality

- Pinned Node/pnpm setup
- Frozen install
- Format check
- ESLint
- TypeScript typecheck
- Unit tests
- Production build

### Job 3 — Python quality

When predictor files are present:

- Pinned Python/uv setup
- `uv sync --locked`
- Ruff format/lint
- mypy
- pytest

Although the predictor is an optional runtime, repository quality gates are not optional; if code exists, it is tested.

### Job 4 — Database/integration

- Ephemeral PostgreSQL
- Clean migration run from scratch
- Seed smoke test
- Node integration tests
- RLS/ownership/concurrency tests

### Job 5 — E2E

- Full-stack image build
- Service startup via Compose
- Readiness wait
- Playwright critical flows
- Service logs and test artifact upload on failure

### Job 6 — Security baseline

- Dependency audit
- Secret scanning
- Container/dependency vulnerability reporting
- Defined failure policy on critical findings

CI principles:

- Cache retains only package manager/download caches; `node_modules` is not considered a reliable artifact.
- Workflow permissions are minimal.
- Jobs requiring secrets do not run on fork PRs.
- Previous workflows for the same branch can be cancelled when a new push arrives.
- Test logs must not contain secrets or tokens.

## 18. Git and Commit Policy

The repository is initialized during the Phase 2 implementation.

- Default branch is `main`.
- Commits are kept small and working.
- Conventional Commits format is preferred: `docs:`, `chore:`, `feat:`, `fix:`, `test:`.
- Lockfile changes occur in the same commit as dependency manifest changes.
- Generated or binary files are committed only if there is a documented requirement.
- `.gitattributes` enforces LF line endings for source and config files.
- Large model artifacts are not committed to standard Git history.
- User or agent changes are not rewritten unrelatedly.

Initial recommended commit sequence:

1. `docs: define project requirements and architecture`
2. `chore: initialize monorepo toolchain`
3. `chore: add local infrastructure compose`
4. `ci: add baseline quality workflow`

Existing documents are included in the initial commit; the entire project is not delivered as a single final commit.

## 19. Editor and Platform Compatibility

- `.editorconfig` defines UTF-8, final newline, and basic indentation.
- `.gitattributes` provides text normalization.
- Scripts are invoked under the same name across Windows PowerShell, macOS, and Linux via package manager commands.
- Path operations use Node APIs or platform-agnostic libraries.
- If a shell-specific helper is unavoidable, a single Node script is preferred over separate Windows and POSIX equivalents.
- Case-sensitive CI catches file name/import errors that are invisible on Windows.

## 20. Dependency Management

- Direct dependencies are explicitly listed in the manifest; transitive imports are not allowed.
- Production and development dependency separation is maintained.
- When adding a new package, the purpose, maintenance status, security surface, and reason why existing tooling cannot resolve it are recorded in the decision/log records.
- Lockfile updates form separate, reviewable PRs/commits.
- Automated dependency bots may propose weekly grouped updates; major updates are handled separately.
- In runtime packages, lockfiles are relied upon rather than wide, uncontrolled version ranges.
- Packages using install scripts are subjected to an allowlist policy when necessary.

## 21. Observability Baseline

Phase 2 prepares only the basic adapters; detailed metrics are completed in Phase 17.

- Each process generates structured logs at startup containing service name, version, and environment.
- A common interface exists for correlation ID propagation.
- The API adheres to the `/health/live` and `/health/ready` contract.
- Worker processes carry a common interface for liveness and database heartbeat.
- The logging layer applies secret redaction centrally.
- Raw `console.log` is not accepted as standard production application code.

## 22. Implementation Sequence

After the Phase 2 design is approved, implementation proceeds in the following order:

1. Git repository and baseline ignore/editor files
2. Root pnpm workspace and version pins
3. Shared TypeScript/ESLint/Prettier configurations
4. Package/app directories and minimal entrypoints
5. Root quality and development scripts
6. Docker Compose infrastructure services
7. Multi-stage Node and predictor Dockerfile foundation
8. Python predictor `pyproject.toml`/uv foundation
9. Basic liveness/readiness smoke tests
10. GitHub Actions baseline pipeline
11. Clean environment setup and Windows/Linux command verification

During this sequence, domain or database business rules are not yet implemented; skeleton runtimes and the quality chain are prepared for subsequent phases.

## 23. Completion Criteria

The Phase 2 implementation is considered complete only when the following are proven:

- Frozen install succeeds with pinned Node/pnpm.
- Workspace dependency graph contains no cycles.
- All minimal Node apps/packages typecheck and build successfully.
- Python predictor skeleton passes lint/typecheck/test in a locked environment.
- Host development mode starts infrastructure services.
- Full container profile starts all mandatory services.
- The core stack continues running unchanged when the predictor profile is completely omitted.
- `.env.example` is complete and contains no secrets.
- Root `lint`, `format:check`, `typecheck`, `test`, and `build` commands succeed.
- CI reproduces the same checks on a clean runner.
- No Windows-specific shell dependencies exist.
- README onboarding steps are verified in a clean environment.

## 24. Deliberately Omitted Tooling

- **Turborepo/Nx:** For the initial workspace size, pnpm recursive commands are sufficient. Added only if measured build durations become an issue.
- **Kubernetes:** Not required for local operation and initial deployment.
- **Redis/Kafka:** Not required for repository foundations; PostgreSQL queue is the primary decision.
- **Mandatory Husky/Lefthook:** CI serves as the primary enforcement point. Optional local hooks can be introduced later.
- **Storybook:** Not added until substantial UI component volume exists.
- **Monorepo package publishing tooling:** Packages are private and internal to the repository.

## 25. Reference and Version Notes

- Node.js 24 is in LTS status on the official release table: <https://nodejs.org/en/about/previous-releases>
- pnpm workspace natively supports `pnpm-workspace.yaml` and the `workspace:` protocol: <https://pnpm.io/workspaces>
- Python 3.14 has a mature maintenance release as of the design date; Python 3.15 was released as a new major on the same date: <https://www.python.org/downloads/>
- uv supports `pyproject.toml`, `.python-version`, and committable cross-platform `uv.lock` project workflows: <https://docs.astral.sh/uv/guides/projects/>
- Docker Compose profiles are used to enable optional service groups: <https://docs.docker.com/compose/how-tos/profiles/>

## 26. Implementation Outcome

Phase 2 was implemented on 2026-10-10 and verified in the local environment:

- Frozen pnpm install, format, lint, strict typecheck, unit/integration test commands, and all builds passed.
- The `app` profile built API, web, two workers, and target simulator images and started with all healthchecks passing.
- Playwright verified web/API integration and two independent browser contexts.
- Predictor image ran under a separate profile; when stopped, the primary API remained healthy.
- Predictor Ruff/mypy/pytest gates passed, achieving `84.95%` coverage above the required `70%` threshold.
- In Phase 3, a separate non-root `migrate` service, real `db:migrate|seed|reset|status` commands, and schema-aware readiness were added. `app`/`prediction` services do not start before the migration job completes successfully.
