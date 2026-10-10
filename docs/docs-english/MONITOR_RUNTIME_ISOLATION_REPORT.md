# Monitor Runtime and API Isolation Report

**Stage:** 9 — Durable Scheduler and Monitor Worker  
**Measurement Date:** 2026-10-10 15:34 +06:00  
**Status:** Dual-worker correctness and API isolation under worker load verified successfully

## 1. Purpose

This report proves that two separate monitor worker processes consume the shared PostgreSQL job queue concurrently without race conditions or duplicate executions, while a distinct API process continues serving readiness checks and authenticated check-listing requests without starvation.

This benchmark does not assert production hardware-independent SLOs. It is a repeatable, local acceptance and regression suite running against production entrypoints and real PostgreSQL, bounded by generous fail-safe latency thresholds.

## 2. Process and Resource Boundaries

The test provisions four independent execution surfaces concurrently:

| Surface   | Real Code Path                     | Resource Boundary                            |
| --------- | ---------------------------------- | -------------------------------------------- |
| API       | `apps/api/src/index.ts`            | Dedicated Node process and private DB pool   |
| Monitor A | `apps/monitor-worker/src/index.ts` | Dedicated Node process, max 4 DB connections |
| Monitor B | `apps/monitor-worker/src/index.ts` | Dedicated Node process, max 4 DB connections |
| Target    | Authentic local HTTP server        | Responds with `200` after 150 ms delay       |

Process-local concurrency limits for each worker instance are configured at global 8, owner 4, and hostname 4. Consequently, aggregate physical concurrency against a single target across both workers has a ceiling of 8. The API does not share database pools with monitor workers.

## 3. Scenario Walkthrough

1. An isolated PostgreSQL database is provisioned and migrated from scratch across Revisions 1–14.
2. 200 checks evenly distributed across 4 distinct user accounts are inserted with scheduled times set in the future. A valid authentication session is prepared for one tenant.
3. Production entrypoints for the API and both monitor workers launch simultaneously in distinct child processes; all three readiness endpoints must reach `200`.
4. Five baseline, idle-load samples of `/health/ready` and authenticated `GET /api/v1/checks?limit=100` are captured.
5. All 200 checks are transitioned to `due` in a single atomic SQL update. While both production scheduler/dispatcher loops consume the queue, API endpoints are continuously sampled under load.
6. Job/run/attempt lineage, worker task distribution, target HTTP hit counts, and API latency distributions are verified from persistent database records.
7. Processes receive graceful `SIGTERM` signals; hard termination fallbacks are reserved strictly for test cleanup timeouts.

## 4. Correctness Results

| Metric                       | Result |
| ---------------------------- | -----: |
| Due checks inserted          |    200 |
| Completed jobs               |    200 |
| Job attempts recorded        |    200 |
| Check runs executed          |    200 |
| Runs accepted into state     |    200 |
| Target HTTP requests served  |    200 |
| Distinct active worker IDs   |      2 |
| Maximum attempt sequence ID  |      1 |
| Active jobs remaining at end |      0 |
| Peak target concurrency      |      8 |

Both worker instances actively processed jobs. No job was claimed more than once, zero retries were needed, duplicate runs were completely absent, and combined hostname concurrency across both processes remained exactly at the expected maximum of 8.

## 5. API Isolation Results

Under peak worker execution, all 40 authenticated list calls and 40 readiness probes returned HTTP `200`. Every listing response accurately returned all 50 checks belonging to the authenticated tenant.

| API Endpoint Sample        | Idle p95 | Under-Load p95 | Under-Load Max |            Regression Budget |
| -------------------------- | -------: | -------------: | -------------: | ---------------------------: |
| `/health/ready`            |  15.4 ms |        18.4 ms |        19.0 ms | p95 < 1000 ms, max < 3000 ms |
| `/api/v1/checks?limit=100` |  75.5 ms |        32.1 ms |        33.8 ms | p95 < 1500 ms, max < 3000 ms |

Because the initial call in the 5-sample baseline incurred cold plan compilation and cache warmup overhead, its latency was higher than subsequent under-load percentiles. Therefore, the test does not treat relative degradation ratios as an SLO, but enforces strict absolute runaway ceilings. Machine-readable metrics are emitted as a `MONITOR_ISOLATION` JSON log entry.

## 6. Reproduction Instructions

With the PostgreSQL container running, execute in PowerShell:

```powershell
$env:DATABASE_TEST_ADMIN_URL = 'postgresql://site_monitor:local_dev_only_change_me@127.0.0.1:15432/postgres'
pnpm exec vitest run --no-file-parallelism apps/monitor-worker/src/runtime-isolation.integration.test.ts
Remove-Item Env:DATABASE_TEST_ADMIN_URL
```

The targeted test passed with **1/1**. It is also included in default `pnpm test:integration` and `pnpm run ci` runs.

The final gate passed with code formatting, 57-operation contract drift validation, linting, workspace-wide strict type checking, **165/165 unit tests**, **57/57 real PostgreSQL/socket/process integration tests**, and clean production container builds. A hardened subsequent CI run recorded readiness p95 at **18.1 ms** and authenticated listing p95 at **26.9 ms**.

## 7. Scope and Limitations

- Benchmarks reflect the documented local machine, Docker PostgreSQL container, and deterministic 150 ms mock target; they do not measure internet DNS/TLS latencies.
- Per-owner and per-host concurrency controls are process-local and scale linearly with replica counts. This deployment property is acknowledged: 4 per host per worker, yielding an aggregate of 8 across 2 workers.
- The test demonstrates that the API maintains progress under independent pools and processes; it does not benchmark production connection poolers (PgBouncer), multi-node PostgreSQL failovers, or cross-region network partitions.
- Latency budgets do not represent user-facing SLOs; they are safety boundaries designed to halt deadlocks, pool starvation, or event-loop blocking regressions.
