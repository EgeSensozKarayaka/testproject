# Site Availability Monitor — Acceptance Criteria

**Version:** 1.0  
**Date:** 2026-10-09 22:47 +06:00  
**Source:** `docs/REQUIREMENTS.md`

These criteria define measurable and repeatable scenarios to verify that the project is working as intended. Detailed test commands are added to this document as implementation progresses.

## 1. Setup and Architecture

- **AC-001:** On a clean machine, frontend, API, monitor worker, notification worker, PostgreSQL, Mailpit, and target simulator can be started using documented commands.
- **AC-002:** Frontend and backend run as separate processes/containers and communicate over the network.
- **AC-003:** Migration and seeding operations complete repeatably on a clean database.
- **AC-004:** When the predictor is stopped/disabled, all other services start and continue operating normally.

## 2. User Isolation

- **AC-010:** Two users can sign in independently on the same system with distinct accounts.
- **AC-011:** User A cannot inspect User B's checks, groups, incidents, history, maintenance windows, notifications, or public status page configuration by guessing IDs.
- **AC-012:** User A cannot update, delete, or link any resource belonging to another user to their own group.
- **AC-013:** User A cannot receive User B's private SSE events.
- **AC-014:** The public endpoint returns only the fields explicitly published by the page owner.

## 3. Check Management

- **AC-020:** A user can create a check with a valid URL, interval, timeout, expected status code, and optional expected response text.
- **AC-021:** Intervals shorter than 30 seconds or longer than 1 hour are rejected.
- **AC-022:** Invalid protocols, URL credentials, and blocked network destinations are rejected.
- **AC-023:** When a check is paused, no new automated jobs are created; when resumed, freshness is displayed correctly until new probe results arrive.
- **AC-024:** A manual execution request is converted into a durable job, and the API request does not block waiting for the HTTP probe to finish.
- **AC-025:** Repeated manual requests submitted while a check is currently executing are coalesced into at most one pending manual execution.
- **AC-026:** On an active check, a manual run participates in the health state machine and does not alter the periodic schedule cadence.
- **AC-027:** On a paused check, a manual run completes in diagnostic mode; it does not produce health transitions, incidents, availability changes, or normal email alerts.
- **AC-028:** Updating probe configuration invalidates past generation results for state evaluation and resets health to UNKNOWN for the new config.
- **AC-029:** When a group is deleted, its member checks become ungrouped without being deleted.

## 4. Scheduler and Workers

- **AC-030:** Two normal active executions are never started concurrently for the same check.
- **AC-031:** Even if a probe request lasts longer than the interval, a second periodic execution is not started in parallel.
- **AC-032:** When two or more workers consume the same queue, any given job produces an accepted result from only one worker.
- **AC-033:** Results carrying a lost lease or a stale fencing token cannot mutate the current state or incidents.
- **AC-034:** If a worker is killed during execution, the job is safely reclaimed following the lease policy.
- **AC-035:** Check runs missed while the server is offline are not backfilled, resulting in an explicit no-data gap in history.
- **AC-036:** Manual executions do not alter periodic scheduling cadence.
- **AC-037:** A slow or hanging target does not block scheduling or API response handling for other targets.

## 5. Health and Incidents

- **AC-040:** An initial failure transitions the check to `SUSPECT` and does not open an incident.
- **AC-041:** A second consecutive failure opens an incident; the incident start timestamp reflects the time of the first failing run.
- **AC-042:** While an incident remains open, subsequent failures do not generate duplicate incidents.
- **AC-043:** The first passing result closes an open incident and calculates its total duration.
- **AC-044:** Stale or missing data is presented as UNKNOWN/stale rather than being falsely classified as DOWN.
- **AC-045:** Group status is derived based on the defined priority hierarchy of its active member checks.
- **AC-046:** When a data gap occurs during an active incident, the incident remains open/unobserved, and its observed duration does not increment across the gap.
- **AC-047:** A FAIL following a gap initiates a new observed segment under the same incident; a PASS following a gap resolves and closes the incident as recovered.
- **AC-048:** Modifying probe config closes an open incident with `CONFIG_CHANGED`; deleting a check closes an open incident with `CHECK_DELETED`.

## 6. Maintenance and Notifications

- **AC-050:** Checks and historical metric recordings continue during maintenance windows.
- **AC-051:** Incidents that begin and resolve entirely within a maintenance window do not generate email notifications.
- **AC-052:** An incident that remains unresolved at the conclusion of a maintenance window generates a complete set of DOWN alert deliveries.
- **AC-053:** If an incident that triggered a DOWN alert prior to maintenance resolves during the maintenance window, the RECOVERY alert is deferred until the maintenance window ends.
- **AC-054:** If two overlapping maintenance windows exist and only one expires, notifications remain suppressed until both conclude.
- **AC-055:** Repeated failing checks for the same incident and recipient do not trigger redundant DOWN deliveries.
- **AC-056:** For incidents resolved before a DOWN notification was dispatched, late DOWN or meaningless RECOVERY notifications are never sent.
- **AC-057:** When an incident with a dispatched DOWN notification resolves, exactly one RECOVERY notification is generated per recipient.
- **AC-058:** If SMTP is unavailable, checks, incidents, API, and frontend continue operating; deliveries remain in retry status.
- **AC-059:** DOWN and RECOVERY email payloads can be inspected and verified in Mailpit.
- **AC-059A:** If an SMTP outcome is ambiguous, delivery status transitions to `DELIVERY_UNKNOWN` without triggering automatic duplicate retries.

## 7. History and Availability

- **AC-060:** Day, week, and month response-time charts render with appropriate rollup resolutions.
- **AC-061:** Availability is calculated on a time-weighted basis, preventing count-based bias from varying check intervals.
- **AC-062:** Time elapsed while the monitoring service is offline is not counted toward DOWN downtime.
- **AC-063:** No-data periods appear as visual gaps on charts and as distinct coverage metrics.
- **AC-064:** The incident journal accurately reports start, end, open/closed status, and duration.
- **AC-065:** On reference large datasets, querying 30-day history returns usable results within the 2-second target budget.

## 8. Live and Public Views

- **AC-070:** Two open authenticated browser sessions reflect identical status transitions in real time without manual page reload.
- **AC-071:** A client reconnecting after an SSE interruption recovers the authoritative state via REST snapshot.
- **AC-072:** The public status page reflects published status transitions without requiring a page reload.
- **AC-073:** When a public status page is disabled or its slug is rotated, former links no longer return data.
- **AC-074:** If target URL visibility is toggled off, the URL is scrubbed from REST, SSE, HTML, and error responses.

## 9. Scale and Resilience

- **AC-080:** The same codebase and data schema operate across 20, 200, and 500 active check profiles.
- **AC-081:** The 500 checks / 30-second cadence profile meets documented queue latency and API response budgets in reference environments, or deviations are transparently recorded.
- **AC-082:** Under catastrophic target timeout scenarios, worker concurrency remains bounded and API responsiveness is preserved.
- **AC-083:** When a single tenant exhausts queue capacity, other tenants' jobs are not completely starved.
- **AC-084:** Checks resume from persistent configuration seamlessly after process restarts.
- **AC-085:** Predictor backlogs or internal failures cause zero degradation in core API or worker latency.

## 10. Early Warning (Predictor)

- **AC-090:** Given sufficient historical sample data, the predictor outputs risk score, timestamp, horizon, validity window, and explanation.
- **AC-091:** Stale risk calculations are not presented as current insights.
- **AC-092:** The predictor cannot modify core check health or incident tables.
- **AC-093:** If the predictor container is terminated, standard DOWN/RECOVERY notifications and core product flows continue running without interruption.

## 11. Security and Operations

- **AC-100:** Outbound requests to localhost, private IP ranges, link-local addresses, cloud metadata endpoints, and redirect exploits are blocked.
- **AC-101:** Tests verify that time-of-check to time-of-use (TOCTOU) DNS rebinding SSRF is prevented between DNS resolution and socket connection.
- **AC-102:** Response bodies, user passwords, session tokens, and sensitive URL query parameters are scrubbed from logs and outgoing emails.
- **AC-103:** Liveness/readiness probes, queue latency, stale check detection, and notification backlogs are observable.
- **AC-104:** Database backup restore procedures are validated through documented tests.
- **AC-105:** Linting, formatting, type checking, unit, integration, and critical end-to-end suites execute cleanly in CI.

## 12. Submission Evidence

- **AC-110:** README provides complete clean setup, migration, seed, startup, testing, and demonstration walkthroughs.
- **AC-111:** Project status documentation transparently distinguishes working features, partial work, and deferred scope.
- **AC-112:** AI tooling usage, architectural decisions, and timestamped development progression are included in submission artifacts.
- **AC-113:** Git commit history demonstrates incremental, meaningful development steps.
- **AC-114:** A functional GitHub repository link is provided for final evaluation.
