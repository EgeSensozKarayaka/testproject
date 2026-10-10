# Next Steps

**Last Updated:** 2026-10-10 21:07 +06:00

**Current Milestone:** Stage 14 delivery scope complete; final submission rehearsal and production hardening next

This document is not an open-ended wishlist; it specifies the immediate prioritized work order following the current implementation status. Detailed milestone dependencies are tracked in `docs/IMPLEMENTATION_PLAN.md`.

## 1. Immediate Work — Submission Rehearsal

Following user direction, a separate frontend architecture specification document was skipped. The user interface required for delivery is now fully implemented directly:

- Live status, freshness, and maintenance dashboard with operational filters and active downtime counters
- Daily, weekly, and monthly response-time and availability views with incident journal
- Maintenance window and notification recipient / default-policy management
- Opaque-link, allowlist-filtered public status pages
- Dual-client Playwright acceptance and public anonymous viewing flows

The immediate concrete task is executing a clean rehearsal with `docker compose --profile app up --detach --build --wait`, verifying demo seeding, and walking through final evaluator inspection steps.

Stage 13 benchmarks are recorded in the [Realtime Capacity Report](./REALTIME_CAPACITY_REPORT.md), and Stage 12 metrics are preserved in the [History Capacity Report](./HISTORY_CAPACITY_REPORT.md).

## 2. Stage 10 Closing Verification Evidence

- Exact `[start, end)` boundaries and direct + group overlap projection
- Durable maintenance resolution following process restarts with fresh connection pools
- Uninterrupted probe execution, incident opening/closing, and notification fact emission during active maintenance windows
- Pure notification gate decisions (`CANCEL`, `DEFER`, `PROCEED`) and rejection of stale projections

## 3. Stage 9 Closing Verification Evidence

- [Scheduler and Worker Final Architecture](./SCHEDULER_AND_WORKERS.md)
- [20/200/500 Check Capacity Benchmark Report](./MONITOR_CAPACITY_REPORT.md)
- [Process Termination and Stale-Result Fencing Report](./MONITOR_FAILURE_RECOVERY_REPORT.md)
- [Dual-Worker and API Runtime Isolation Report](./MONITOR_RUNTIME_ISOLATION_REPORT.md)

## 4. Pre-Production Hardening

- Service-specific PostgreSQL login secrets and secret manager integration
- Managed database backups, point-in-time recovery (PITR), restore drill execution, and measured RPO/RTO metrics
- Reverse proxy / TLS termination, edge rate limiting, and outbound egress network policies
- Metrics, distributed tracing, alerting rules, runbooks, and comprehensive security audit
- Clean environment deployment, dual-client concurrency validation, and full end-to-end acceptance rehearsal

## 5. Deliberately Out of Scope

- Multi-tenant organization, team membership, and RBAC models are not v1 requirements; direct user ownership is preserved.
- The Python Early Warning / Anomaly Prediction system has been excluded from this milestone.
- The predictor is strictly an auxiliary, failure-isolated capability; it does not dictate the correctness or uptime of the primary monitoring engine.
- Premature microservice decomposition without measured scaling or isolation drivers is prohibited.
