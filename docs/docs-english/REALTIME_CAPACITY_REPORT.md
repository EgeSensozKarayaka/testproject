# Realtime Capacity and Isolation Report

**Stage:** 13 — Live Update Infrastructure  
**Measurement Date:** 2026-10-10 20:02 +06:00  
**Status:** 20, 200, and 500 event bursts, dual-replica broadcast, REST isolation, and slow-client boundaries passed successfully

## 1. Purpose

This report demonstrates that the private realtime data pipeline is not bound by fixed 50-check assumptions and satisfies the following closing criteria:

- Invalidation bursts for 20, 200, and 500 checks reach two independent API replica listeners without data loss;
- Inbound owner-scoped REST reads continue progressing on distinct database connection pools during active broadcasts;
- In a 500-event burst, a slow client filling its bounded queue is terminated without degrading neighboring clients or replicas;
- Listeners, client hubs, and REST queries execute against production classes and real PostgreSQL instances.

These figures do not represent production SLAs or unlimited client connection guarantees. They provide a repeatable local performance baseline to detect algorithmic regressions, lost broadcasts, pool starvation, and backpressure leaks.

## 2. Reproduction Instructions

With the PostgreSQL container running, execute in PowerShell:

```powershell
$env:DATABASE_TEST_ADMIN_URL = 'postgresql://site_monitor:local_dev_only_change_me@127.0.0.1:15432/postgres'
pnpm test:realtime-capacity
Remove-Item Env:DATABASE_TEST_ADMIN_URL
```

The test provisions an isolated database, applies all migrations from scratch, initializes two dedicated listeners/pools and two owner hubs, executes all three profiles, and tears down the database. Each profile emits a single machine-readable JSON line prefixed with `REALTIME_CAPACITY`.

This heavy benchmark is intentionally excluded from default `pnpm run ci` runs. Standard CI runs correctness, RLS, reconnect, session, and backpressure fixtures; burst profiles are executed on demand.

## 3. Benchmark Environment and Methodology

| Component        | Specification                      |
| ---------------- | ---------------------------------- |
| Operating System | Windows `10.0.26200`               |
| CPU              | AMD Ryzen 7 7735HS, 16 logical CPUs|
| Memory           | 15.2 GiB                           |
| Node.js          | 24.19.0                            |
| PostgreSQL       | 18.6, Docker container             |
| Replicas         | 2 listeners + 2 owner hubs         |
| REST Concurrency | 20 concurrent reads per profile    |

For each check, an owner-scoped record is created in the production schema. The benchmark generates batches of redacted `pg_notify` wake-up payloads; each replica receives events via its dedicated listener connection and routes them to local hubs. Transit latency is measured from notification generation until both replicas receive the exact event set. Concurrently, 20 owner-scoped reads execute against independent query pools.

In the 500-check profile, an additional client callback intentionally stalls with a queue buffer ceiling of 32 events. The expected outcome is for that connection to terminate with `BUFFER_OVERFLOW` without impacting other subscribers.

## 4. Benchmark Results

| Checks | Events per Replica | Delivery Duration | Aggregate Broadcast Rate | REST p95 | Slow Client Isolated |
| -----: | -----------------: | ----------------: | -----------------------: | -------: | :------------------: |
|     20 |                 20 |         120.82 ms |          331.06 events/s | 62.99 ms |    Not Applicable    |
|    200 |                200 |         210.28 ms |        1,902.26 events/s | 35.98 ms |    Not Applicable    |
|    500 |                500 |         513.77 ms |        1,946.38 events/s | 34.87 ms |         Yes          |

Across all three profiles, both replicas received the exact event set with zero dropped or disparate deliveries. All 20 REST reads completed successfully. In the 500-check burst, the slow consumer was evicted cleanly while normal clients and the second replica ingested all 500 events.

Automated regression guardrails enforce 10 seconds for event delivery and 2 seconds for REST p95. These thresholds serve to flag deadlocks, listener disconnections, pool starvation, and major performance degradations.

## 5. Proxy and Reverse-Proxy Boundaries

Local Docker Compose exposes the frontend and API directly on distinct ports without intermediary response-buffering proxies. Production edge proxies must preserve the following contract:

- Response buffering and dynamic gzip/brotli compression disabled for SSE routes;
- HTTP/1.1 keep-alive or HTTP/2 streaming maintained;
- Idle read timeouts configured to at least 60 (preferably 75) seconds;
- Long-lived streaming policies separated from standard REST request timeouts;
- Bounded connection draining during rolling deployments to facilitate graceful client reconnection;
- Edge-level global connection limits and anti-abuse controls augmenting internal application limits.

Sticky sessions are not required for correctness. Every API replica listens to the same PostgreSQL notification channel; upon reconnecting, browser clients reconcile authoritative state via persistent REST snapshots.

## 6. Analysis and Boundaries

- Broadcast completion across 20 -> 200 -> 500 burst increments stayed under 514 ms, validating linear scaling beyond 50-check limits.
- Dedicated listener connections and isolated query pools prevented REST queries from being blocked during heavy event bursts.
- Bounded per-client buffering safely isolated slow consumers from other owners, clients, and replicas.
- Measurements reflect a single PostgreSQL container with two in-process replica fixtures; they do not test multi-node PostgreSQL failovers or wide-area networks.
- Browser reconnection and snapshot/polling reconciliation are verified in dedicated unit and Playwright acceptance suites; this benchmark focuses strictly on wire throughput.
- Total connection density limits are not benchmarked here. Production connection caps, file descriptor budgets, and edge proxy behaviors must be validated under separate load testing.
