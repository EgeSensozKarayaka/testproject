# Monitor Worker Process Failure Recovery Report

**Stage:** 9 — Durable Scheduler and Monitor Worker  
**Verification Date:** 2026-10-10 15:23 +06:00  
**Status:** Process-kill, natural lease expiry/reclaim, and stale-result fencing verified successfully

## 1. Demonstrated Risk

This test proves that the catastrophic, ungraceful termination of a monitor worker process during an in-flight HTTP probe never leaves a job stuck permanently in `RUNNING`, and that a delayed result submitted with an obsolete attempt identity cannot corrupt newer state.

This is not a mock invoking raw queue functions. A distinct Node.js child process executes the production entrypoint (`apps/monitor-worker/src/index.ts`), the actual probe engine, the runtime coordinator, and the restricted `site_monitor_worker` PostgreSQL role.

## 2. Scenario Walkthrough

1. An isolated PostgreSQL database migrated to Revisions 1–14 is created for the test run.
2. The test suite launches a local HTTP server that deliberately hangs without completing responses, and inserts a single pending check job.
3. The production monitor worker starts in a separate child process. The job transitions to `RUNNING`, and the mock HTTP target receives the inbound probe.
4. A hard `SIGKILL` is sent to the worker process, bypassing all graceful shutdown handlers.
5. The database is inspected to verify that the job remains `RUNNING` under the deceased worker's lease; the test does not manually alter database timestamps.
6. The test waits for `timeout_ms + lease_grace_ms` to expire naturally against the database clock. The reclaimer loop detects the expired lease, closes the attempt as `LEASE_LOST`, and requeues the job as `PENDING` with deterministic bounded backoff.
7. A replacement worker claims the job. Its fencing token is verified to be strictly greater than the initial token, and its `PASS` result is atomically committed.
8. A delayed `FAIL` persistence call is executed using the stale attempt identity. This simulates zombie deliveries caused by network partitions or delayed callbacks against the exact production persistence adapter.
9. The stale result is recorded in history marked with `accepted_for_state=false` and rejection reason `ATTEMPT_NOT_CURRENT`. Current state, accepted fence, response latency, and state version remain unchanged; no false incident is opened.

## 3. Persistent Outcome

| Record Property       | Attempt 1 — Terminated Worker | Attempt 2 — Replacement Worker |
| --------------------- | ----------------------------- | ------------------------------ |
| Attempt Terminal Code | `LEASE_LOST`                  | `RESULT_RECORDED`              |
| Fencing Token         | Initial                       | Monotonically Greater          |
| Probe Outcome         | Delayed `FAIL`                | `PASS`                         |
| State Acceptance      | No                            | Yes                            |
| Rejection Reason      | `ATTEMPT_NOT_CURRENT`         | None                           |

The job reaches terminal status `COMPLETED` exactly once, current health remains `UP`, and the incident count remains zero. This proves that while external HTTP calls cannot guarantee physical exactly-once execution, only current, valid leases and fencing tokens are permitted to alter health and incident states.

## 4. Reproduction Instructions

With the PostgreSQL container running, execute in PowerShell:

```powershell
$env:DATABASE_TEST_ADMIN_URL = 'postgresql://site_monitor:local_dev_only_change_me@127.0.0.1:15432/postgres'
pnpm exec vitest run --no-file-parallelism apps/monitor-worker/src/observation-store.integration.test.ts
Remove-Item Env:DATABASE_TEST_ADMIN_URL
```

The targeted test suite passed with **10/10** tests. The process test adheres to cross-platform Node.js termination semantics on both Windows and POSIX; it does not depend on hardcoded ports or leak sensitive URL/body payloads into assertions or reports.

## 5. Non-Claims and Boundaries

- This test does not claim that outbound HTTP probe requests execute with physical exactly-once semantics. Transient overlaps can occur during network partition boundaries.
- This is not a test of PostgreSQL cluster failover, operating system crashes, or multi-node network splits.
- API latency under worker load and dual-worker concurrent throughput profiles are addressed separately in the Stage 9 closing isolation report.
- The representation of historical downtime gaps within read models is tested under Stage 12. The persistence layer never generates synthetic phantom runs in the absence of active worker processes.

## 6. Automated Enforcement

This test is integrated into standard `pnpm test:integration` and `pnpm run ci` pipelines. Time thresholds serve as generous safety ceilings to abort hung processes, lease stalls, or backoff regressions rather than strict performance SLOs.

The final quality gate passed with code formatting, 57-operation contract drift checks, linting, strict workspace-wide type checks, **165/165 unit tests**, **56/56 real PostgreSQL/socket/process integration tests**, and clean production container builds.
