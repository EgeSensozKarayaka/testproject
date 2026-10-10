# Monitor Worker Capacity Benchmark Report

**Stage:** 9 — Durable Scheduler and Monitor Worker  
**Measurement Date:** 2026-10-10 15:11 +06:00  
**Status:** 20, 200, and 500 runtime profiles passed successfully

## 1. Purpose

This benchmark evaluates the performance of the unified production scheduler, PostgreSQL queue, claim/lease/fencing mechanics, bounded dispatcher, and atomic observation persistence pipeline across 20, 200, and 500 due checks without assuming fixed 50-check ceilings.

These results do not represent production hardware-independent SLAs. They provide a repeatable local performance baseline validating correctness invariants alongside generous fail-safe regression ceilings on identical data paths.

## 2. Reproduction Instructions

With the PostgreSQL container running, execute in PowerShell:

```powershell
$env:DATABASE_TEST_ADMIN_URL = 'postgresql://site_monitor:local_dev_only_change_me@127.0.0.1:15432/postgres'
pnpm test:capacity
Remove-Item Env:DATABASE_TEST_ADMIN_URL
```

Each run provisions a fresh database, executes Revisions 1–14 migrations, runs all three profiles against production adapters, and gracefully tears down the schema. Every profile emits a single machine-readable JSON line prefixed with `MONITOR_CAPACITY`. This test is part of standard `pnpm test:integration` and `pnpm run ci` quality gates.

## 3. Benchmark Environment

| Component          | Specification                       |
| ------------------ | ----------------------------------- |
| Operating System   | Windows `10.0.26200`                |
| CPU                | AMD Ryzen 7 7735HS, 16 logical CPUs |
| Memory             | 15.2 GiB                            |
| Node.js            | 24.19.0                             |
| pnpm               | 11.25.0                             |
| Docker             | client/server 29.8.2, Compose 5.5.1 |
| PostgreSQL         | 18.6, Docker container              |
| DB Pool Limits     | Max 8 connections with worker role  |
| Worker Concurrency | Global 64, owner 32, hostname 4     |

Because this host simultaneously ran IDE tooling and Docker Desktop, these figures reflect development environments rather than isolated bare-metal servers.

## 4. Test Fixture and Methodology

- Profiles test 20 checks across 2 owners, 200 checks across 4 owners, and 500 checks across 8 owners, respectively.
- All checks start in a due state configured with a 30-second cadence.
- Target URLs are deterministically spread across 128 unique hostnames; initial owner-fair claim rounds verify representation for all active owners.
- The scheduler materializes due checks in bounded batches of 64.
- The dispatcher enforces production defaults: candidate batches of 128, global concurrency of 64, per-owner concurrency of 32, and per-host concurrency of 4.
- To isolate queue and persistence overhead from external network jitter, the mock probe port provides deterministic responses: ~10% complete after 50 ms, and the remaining 90% return `PASS/200` after 5 ms.
- Job claims, leases, attempt tracking, state transitions, immutable run records, health intervals, audit logs, and result pointers execute against real PostgreSQL using production `PostgresJobQueue` and `PostgresObservationStore` code.
- Aligned with Stage 9 deployment scope, inactive downstream outbox consumers create zero dispatch backlog.
- Stage 7 integration suites separately verify that 50 fast probes succeed even when concurrent targets hang; network transport reliability is not re-tested here.

## 5. Benchmark Results

| Checks | Owners |  Scheduler | Dispatch + Persist | End-to-End | Throughput (checks/s) | Claim Lag p95 | Execution/Persist p95 | Peak Active | Peak DB Busy |   CPU Time | Peak RSS |
| -----: | -----: | ---------: | -----------------: | ---------: | --------------------: | ------------: | --------------------: | ----------: | -----------: | ---------: | -------: |
|     20 |      2 |   214.6 ms |           265.6 ms |   480.2 ms |               41.65/s |      199.8 ms |               62.6 ms |           7 |            8 |     250 ms | 105.7 MiB|
|    200 |      4 | 1,864.2 ms |         1,707.2 ms | 3,571.4 ms |               56.00/s |    1,843.8 ms |               60.1 ms |           6 |            7 |   1,360 ms | 127.0 MiB|
|    500 |      8 | 4,595.1 ms |         4,138.0 ms | 8,733.1 ms |               57.25/s |    4,554.0 ms |               60.2 ms |           6 |            7 |   3,078 ms | 139.4 MiB|

Across all profiles:

- Materialized, claimed, completed, and accepted run counts matched fixture totals exactly.
- Remaining `PENDING`, `LEASED`, or `RUNNING` jobs at test conclusion was zero.
- Concurrency never exceeded the global 64 limit or the pool ceiling of 8.
- The initial owner-fair claim slice represented every registered owner at least once.
- Zero duplicate runs or lost observation records occurred.

A workload of 500 checks recurring every 30 seconds requires a baseline processing rate of `16.67 checks/s`. The measured end-to-end throughput of `57.25 checks/s` provides ~3.4x headroom; the entire 500-check burst cleared within 8.74 seconds with a p95 claim lag of 4.56 seconds.

## 6. Automated Regression Ceilings

To absorb environmental CI variance, raw timings are bounded by generous safety ceilings:

- Scheduler execution `< 60 s`
- Dispatch & persistence execution `< 90 s`
- Total end-to-end execution `< 120 s`
- Overall and dispatch throughput `> 1 check/s`
- Active probes `<= 64`, busy DB connections `<= 8`
- Exact parity across all job and run counts
- Complete representation in initial owner-fair claims

These thresholds detect runaway queries, unbounded concurrency, deadlocks, and algorithmic regressions rather than acting as strict optimization targets. Tighter SLOs will be formalized during pre-production hardening.

## 7. Analysis and Observations

- Scheduler and persistence execution overhead scaled linearly with check counts; 500 checks completed well inside the 30-second cadence window.
- Peak concurrent in-flight probes hovered around 6–7. Sequential fenced claims coupled with an 8-connection database pool provided natural backpressure prior to reaching the global 64 concurrency cap.
- Memory usage (RSS) captures full Vitest and Node runtime overhead rather than isolated test fixture heap growth.
- External internet transport, live DNS resolution, timeout-heavy incident generation, active outbox consumers, ungraceful worker termination, dual-process workers, and concurrent API requests are evaluated in dedicated reports.
