# History and Housekeeping Capacity Benchmark Report

**Stage:** 12 — History, Rollups, Availability, and Housekeeping  
**Measurement Date:** 2026-10-10 19:02 +06:00  
**Status:** 20/200/500 rollup projections, 35-day month query, and API runtime isolation passed successfully

## 1. Purpose

This report demonstrates that the historical data pipeline is not constrained by fixed 50-check assumptions and satisfies the following closing criteria:

- Source discovery and minute -> hour rollup pipelines scale in bounded fashion across 20, 200, and 500 checks;
- Month view queries open rapidly across synthetic datasets equivalent to 500 checks running at 30-second cadence over 35 days;
- Month queries effectively utilize partition pruning, index scans, and enforce a maximum output ceiling of 360 buckets;
- Background housekeeping tasks running on dedicated database pools do not block private history API queries.

These figures do not represent production SLAs or hardware-independent throughput guarantees. They establish a repeatable local baseline exercising production code paths and fail-safe regression thresholds.

## 2. Reproduction Instructions

With the PostgreSQL container running, execute in PowerShell:

```powershell
$env:DATABASE_TEST_ADMIN_URL = 'postgresql://site_monitor:local_dev_only_change_me@127.0.0.1:15432/postgres'
pnpm test:history-capacity
Remove-Item Env:DATABASE_TEST_ADMIN_URL
```

Each run provisions a distinct database, executes all migrations from scratch, runs four acceptance scenarios, and drops the temporary database. Machine-readable JSON metrics are output prefixed with `HISTORY_ROLLUP_CAPACITY`, `HISTORY_MONTH_CAPACITY`, `HISTORY_API_ISOLATION`, and `HISTORY_CAPACITY_HOST`.

This resource-intensive benchmark is excluded from default `pnpm run ci` runs. Standard CI executes smaller correctness fixtures; this 420,000-row capacity test is run on demand.

## 3. Benchmark Environment

| Component           | Specification                       |
| ------------------- | ----------------------------------- |
| Operating System    | Windows `10.0.26200`                |
| CPU                 | AMD Ryzen 7 7735HS, 16 logical CPUs |
| Memory              | 15.2 GiB                            |
| Node.js             | 24.19.0                             |
| PostgreSQL          | 18.6, Docker container              |
| API DB Pool         | Max 4 connections                   |
| Housekeeper DB Pool | Max 2 connections                   |
| Host Fingerprint    | `d18f67f2ee14e71b`                  |

The benchmark ran on a local machine running Docker Desktop and IDE background processes. Free memory was ~2.13 GiB at benchmark conclusion.

## 4. Rollup Benchmark Profile

For each check, genuine job, attempt, accepted run, and 1-minute finalized `UP` interval records are created in the production schema. The production `HousekeepingStore` advances source cursors using narrow `security_api` functions; minute buckets are recomputed from raw sources, and hour buckets are aggregated from minute rollups.

Because two source fingerprints independently trigger recomputation of identical check/minute buckets, the total processed minute and hour buckets count is double the check count. This is the anticipated overhead of idempotent source-of-truth recomputation.

| Checks | Fixture Prep | Discovery | Minute Projection | Hour Projection | Total Projection | Aggregate Rate |
| -----: | -----------: | --------: | ----------------: | --------------: | ---------------: | -------------: |
|     20 |     42.68 ms |  23.66 ms |         192.26 ms |       182.69 ms |        398.61 ms |  50.17 check/s |
|    200 |     80.81 ms |  23.97 ms |       1,876.26 ms |     1,710.47 ms |      3,610.70 ms |  55.39 check/s |
|    500 |    184.80 ms |  83.38 ms |       4,899.71 ms |     4,557.76 ms |      9,540.85 ms |  52.41 check/s |

Across all profiles, run and interval sources exactly matched check counts, while enqueued ranges and processed buckets matched `2 × checks`. Processing yielded exactly one minute and one hour rollup row per check. The 2-connection housekeeper pool ceiling was respected throughout.

Automated quality gates require total projection times under 120 seconds and throughput above 1 check/s to prevent deadlocks and algorithmic regressions.

## 5. 35-Day Month Query Benchmark

At a 30-second cadence, 500 checks running over 35 days equal **50,400,000 raw probe samples**. Because the API month view reads rollups instead of raw runs, the fixture populates **420,000 `rollups_hour` rows** (at 120 samples/hour) matching this distribution. This tests realistic query cardinality and index distributions without incurring the overhead of inserting 50 million raw test rows.

| Benchmark Metric                   |              Result |
| ---------------------------------- | ------------------: |
| Dataset creation + `ANALYZE`       |        16,690.11 ms |
| `EXPLAIN (ANALYZE, BUFFERS)`       |            4.568 ms |
| `HistoryService.getHistory(month)` |            25.32 ms |
| Output buckets returned            |                 360 |
| Partitions scanned                 | `rollups_hour_2026` |
| Partition count                    |                   1 |
| Index-backed query plan            |                 Yes |
| DEFAULT partition scanned          |                  No |

The database query plan utilized owner/check/time composite indexes and pruned all non-matching annual and default partitions. The API query seamlessly coalesced the 2-hour bounded raw tail within the same read-only `REPEATABLE READ` transaction. Automated budgets bound both plan execution and end-to-end service responses to under 2 seconds, with results capped at 360 buckets.

## 6. API vs. Housekeeper Runtime Isolation

In addition to the target check for the month query, 64 checks were initialized with 60-minute repair ranges. While the housekeeper processed 3,840 minute buckets across its dedicated 2-connection pool, 40 concurrent month queries were submitted via the API's distinct 4-connection pool.

| API Metric Sample   |   Result | Regression Budget |
| ------------------- | -------: | ----------------: |
| Idle p95            | 17.79 ms |                 — |
| Under load p95      | 15.20 ms |        < 1,500 ms |
| Under load Max      | 15.59 ms |        < 3,000 ms |
| Successful requests |       40 |             40/40 |

Neither connection pool limit was breached. The benchmark verifies that private history reads proceed uninhibited while bounded housekeeping jobs run on the same PostgreSQL instance; it does not simulate isolated physical database clusters.

## 7. Analysis and Limitations

- Rollup projection overhead scaled near-linearly from 20 to 500 checks, completing in under 10 seconds for 500 checks.
- The month view query leveraged index scans and partition pruning to read only ~30 days of hourly rollup rows for the requested check, avoiding full scans across raw `check_runs`.
- Housekeeper advisory locks on minute and hour lanes maintain correctness without requiring complex cross-replica sharding. The measured rate of 52.41 checks/s satisfies v1 requirements.
- The benchmark fixture models pre-aggregated data distributions rather than raw sample ingestion pipelines. Raw ingestion capacity is evaluated in the monitor worker report.
- Results reflect a single local development host and Docker container. Multi-node clusters, disk I/O contention, failover drills, and cross-region latency will be evaluated in pre-production hardening.
