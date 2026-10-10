# Site Availability Monitor — Glossary

**Version:** 1.0  
**Date:** 2026-10-09 22:53 +06:00

This glossary ensures uniform terminology across the product, codebase, API specifications, and documentation.

| Term | Definition |
| --- | --- |
| User | An authenticated product user who is the sole owner of their resources. |
| Owner | The specific user to whom a resource belongs. In v1, this is an individual user rather than an organization/tenant. |
| Check | A managed resource defining the target URL, probe schedule, and evaluation expectations. |
| Probe configuration | Attributes defining the HTTP request semantics and evaluation criteria (URL, timeout, expected status/body, redirect policy). |
| Schedule configuration | Attributes governing execution cadence (interval, execution state, cadence anchor, next scheduled run). |
| Check job | A durable intent to execute a specific check at a designated time using a frozen configuration snapshot. |
| Job attempt | A single worker execution attempt executed under an acquired lease on a check job. |
| Check run | An immutable historical observation recording an executed HTTP probe attempt to the target URL. |
| Accepted observation | A check run that satisfies generation and fencing token invariants and is permitted to update domain health state. |
| Diagnostic run | A run persisted to historical logs that bypasses the health state machine, incidents, availability rollups, and alerts. |
| Scheduled run | A routine run generated automatically by the periodic schedule cadence. |
| Manual run | An on-demand run triggered explicitly by a user's "test now" command. |
| Execution state | The schedule lifecycle axis indicating whether automated jobs are generated (`ACTIVE` or `PAUSED`). |
| Health state | Target health classification derived from valid observations (`UNKNOWN`, `UP`, `SUSPECT`, `DOWN`). |
| Last observed health | The last health state classification recorded from an accepted observation, even if data has since become stale. |
| Effective health | Target health presented to users after incorporating freshness; transitions to `UNKNOWN` when stale. |
| Freshness | Time-validity axis indicating whether the latest observation satisfies scheduling deadlines (`FRESH` or `STALE`). |
| Fresh-until | UTC timestamp beyond which existing health observations must be considered stale unless renewed. |
| Maintenance | A scheduled operational window that suppresses alert dispatching without suspending probe executions. |
| Failure candidate | A provisional state initiated by the first failing accepted observation that has not yet crossed incident thresholds. |
| Incident | A confirmed downtime record opened when consecutive failure thresholds are satisfied. |
| Incident segment | A confirmed continuous DOWN interval within an incident backed by active observations. Gap periods are excluded. |
| Observed duration | Aggregate time span of all confirmed DOWN segments within an incident. |
| Wall-clock span | Total elapsed calendar duration from incident opening to resolution; may include unobserved gaps. |
| Data gap | An unobserved time interval during which the system could not record accepted observations. Not counted as target DOWN. |
| Availability | The ratio of observed UP time to total observed time (UP / (UP + DOWN)) across an evaluation window. |
| Coverage | The percentage of a time window backed by known, active health observations. |
| Group | An organizational resource used to aggregate checks for notifications, maintenance windows, and status rollups. |
| Group health | Real-time aggregate health projection calculated from the effective health of active, fresh member checks. |
| Outbox event | An event committed atomically within domain transactions to trigger asynchronous, guaranteed side effects. |
| Notification intent | A durable evaluation intent generated for a domain event; precedes individual recipient deliveries. |
| Notification delivery | The delivery lifecycle for a single notification intent dispatched to a specific recipient. |
| Public page | A publicly accessible status page exposing a restricted subset of check projections without authentication. |
| Prediction score | A probabilistic risk assessment produced by the optional Python predictor; does not mutate core health states. |
| Cadence | The ideal target schedule timeline derived from configured interval steps. |
| Jitter | Controlled pseudo-random offset applied to scheduled execution times to prevent thundering herd load spikes. |
| Lease | Exclusive time-bounded authorization granted to a worker instance to execute a job attempt. |
| Heartbeat | Periodic renewal signal emitted by an active worker to prove ongoing execution of a leased job. |
| Fencing token | Monotonically increasing sequence number that prevents stale or expired workers from mutating current state. |
| Probe generation | Monotonic counter incremented on probe config changes; results from previous generations are rejected by the reducer. |
| Schedule generation | Monotonic counter incremented on scheduling mutations (pause, resume, interval modifications, deletions). |
| Resource version | Monotonic counter incremented on any resource mutation to guarantee optimistic concurrency control. |
| Reconciliation | An idempotent recovery process that rebuilds derived runtime state and projections from durable source-of-truth tables. |
| Housekeeping | Background maintenance routines managing table partitioning, retention pruning, rollup precomputations, and session cleanup. |
