# Realtime SSE Contract

**Stage:** 4 — API, Event, and Error Contracts

**Status:** Approved; payload type allowlist implemented, private SSE runtime under Stage 13 and public runtime under Stage 15

**Date:** 2026-10-10

**Related documents:** [`API_DESIGN.md`](./API_DESIGN.md), [`EVENT_CATALOG.md`](./EVENT_CATALOG.md), [`openapi-v1.yaml`](./openapi-v1.yaml)

## 1. Purpose and Guarantees

Server-Sent Events (SSE) serve as an **invalidation and projection notification channel** to update dashboards and public status pages rapidly without manual browser refreshes. It is not the authoritative source of truth, makes no persistent replay guarantees, and never substitutes for authoritative REST snapshots.

Guarantee Model:

- Authorized clients receive notifications for changes within their owner or public-page scope normally within seconds.
- Events may be dropped, duplicated, coalesced, or delivered out of sequence.
- Clients reconcile with authoritative REST snapshots upon initial connection, reconnection, after `resync.required` events, and on periodic timers.
- Business state is never reconstructed solely from event payloads. The `resource.version` property exists exclusively to discard obsolete events and prompt refetching.

WebSockets are deliberately omitted; the product does not require continuous bidirectional client-to-server messaging. User mutations travel over standard HTTP API endpoints.

## 2. Endpoints and Authorization

| Endpoint                                                | Authorization        | Scope                                                          |
| ------------------------------------------------------- | -------------------- | -------------------------------------------------------------- |
| `GET /api/v1/events`                                    | Valid session cookie | Private projection events belonging strictly to session owner  |
| `GET /api/public/v1/status-pages/{public_token}/events` | Public status token  | Published allowlist component projections for this status page |

The public endpoint is reserved in canonical contracts. Production routes, public REST snapshots, token lifecycle management, and allowlist page revisions activate in Stage 15. Stage 13 implements shared public-safe transport ports without exposing half-formed public streams prior to snapshots.

Request:

```http
GET /api/v1/events HTTP/1.1
Accept: text/event-stream
Cache-Control: no-cache
Cookie: site_monitor_session=...
Last-Event-ID: 0192f8fe-ec53-71ac-bad7-70f299a607a4
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store, no-transform
Connection: keep-alive
X-Accel-Buffering: no
X-Request-Id: 0192f82c-17f8-782b-bf7a-d31fd8bc499a
```

- Private streams rely on cookie authentication; as HTTP GET requests, they omit CSRF headers. Exact-origin CORS and active session validations apply.
- Public tokens travel in URL paths but are masked as `{redacted}` in access logs, APM traces, metrics, and problem `instance` attributes.
- When a public token is rotated or disabled, active streams terminate immediately. Subsequent client requests return generic `404 public_page_not_found`.
- Missing `Accept: text/event-stream` headers return `406 not_acceptable`; invalid authentication returns standard RFC 9457 problem payloads before stream initialization.

## 3. SSE Frame Structure

```text
id: 0192f902-5e39-7d40-a565-8d881fd07a67
event: check.status_changed
data: {"event_id":"0192f902-5e39-7d40-a565-8d881fd07a67","event_type":"check.status_changed","schema_version":1,"occurred_at":"2026-10-10T03:24:51.104Z","resource":{"type":"check_status","id":"0192f7c8-548e-7c43-9f79-93cbf7eaf831","version":"19"},"payload":{"health_state":"DOWN","freshness_state":"FRESH"}}

```

Every data event schema:

```json
{
  "event_id": "0192f902-5e39-7d40-a565-8d881fd07a67",
  "event_type": "check.status_changed",
  "schema_version": 1,
  "occurred_at": "2026-10-10T03:24:51.104Z",
  "resource": {
    "type": "check",
    "id": "0192f7c8-548e-7c43-9f79-93cbf7eaf831",
    "version": "19"
  },
  "payload": {}
}
```

- SSE `id` and JSON `event_id` are identical opaque UUID strings.
- SSE `event` and JSON `event_type` match exactly.
- `resource.version` is a decimal string compared strictly within the same `resource.type + resource.id` boundary. Check configuration uses `check/resource_version`; live check status uses `check_status/state_version`; non-versioned projections may use `null`.
- JSON payloads serialize as single-line UTF-8; each frame terminates with a blank line.
- The server emits comment heartbeats approximately every 15 seconds: `: heartbeat 2026-10-10T03:25:00Z`.
- Clients ignore heartbeats at the application level. If no data or heartbeat arrives for 45 seconds, the connection is considered stale and reconnected with jitter.

## 4. Connection and Snapshot Synchronization Algorithm

Race-free client startup sequence:

1. Open the SSE connection.
2. Buffer inbound application events in memory until `stream.ready` is received.
3. For private streams, fetch the visible screen's owner-scoped REST snapshot (`checks`, `groups`, `incidents`, or convenience `dashboard` projections). For public views, fetch the public status-page REST snapshot.
4. Record every resource/projection version from the snapshot into client state.
5. Process buffered events with resource versions strictly greater than snapshot versions; discard equal or older events.
6. Transition to real-time event processing.
7. Reconcile with REST snapshots at least every 60 seconds on visible tabs, and immediately when tabs return to the foreground.

Fetching snapshots before opening the stream creates race conditions where intermediate mutations are missed. Therefore, the order is strictly: **stream -> ready -> snapshot -> buffered events**. If snapshot requests fail, the stream remains connected while UI components mark data as degraded and retry REST calls with bounded backoff.

Reconnection Semantics:

- Clients may send `Last-Event-ID`; this is utilized strictly for diagnostics and short in-memory gap analysis.
- The server makes no replay guarantees; new connections state `replay_supported: false` in `stream.ready`.
- Every reconnection mandates REST snapshot reconciliation; `Last-Event-ID` does not eliminate this requirement.
- Backoff strategy: exponential starting at 1 second with full jitter, capped at 30 seconds. Terminal client errors (`401`, `404`) cease reconnect loops.

## 5. System Events

### 5.1 `stream.ready`

Emitted immediately after binding a connection to an owner or public-page scope.

```json
{
  "event_id": "0192f909-eed8-7934-9ad6-89dc20dafdf5",
  "event_type": "stream.ready",
  "schema_version": 1,
  "occurred_at": "2026-10-10T03:26:00.000Z",
  "resource": { "type": "stream", "id": "private", "version": null },
  "payload": {
    "scope": "PRIVATE",
    "replay_supported": false,
    "heartbeat_seconds": 15,
    "snapshot_reconcile_seconds": 60
  }
}
```

On public streams, `resource.id` is the opaque string `"public"` rather than an internal page ID or token, returning `scope: "PUBLIC"`.

### 5.2 `resync.required`

Emitted when the server identifies event gaps, local subscriber restarts, buffer overflows, or projection drift, typically followed by connection closure.

```json
{
  "event_id": "0192f90d-a995-7fa9-80e4-5f00a1ea951d",
  "event_type": "resync.required",
  "schema_version": 1,
  "occurred_at": "2026-10-10T03:27:00.000Z",
  "resource": { "type": "stream", "id": "private", "version": null },
  "payload": { "reason": "BUFFER_OVERFLOW" }
}
```

Reasons: `BUFFER_OVERFLOW`, `SUBSCRIBER_RESTARTED`, `VERSION_GAP`, `PROJECTION_INVALIDATED`. The client triggers an immediate REST snapshot; raw internal reasons are not displayed to end users.

Heartbeats are sent as raw comments rather than JSON `stream.heartbeat` events to prevent unnecessary frontend re-renders.

## 6. Private Event Catalog

Private payloads are minimal and omit sensitive configuration. Upon receipt, UI layers invalidate query caches or update safe status indicators without optimistic speculation.

| Event                  | Resource                | Payload v1                                                                                                                                                       |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check.changed`        | `check`                 | `changed_fields[]`                                                                                                                                               |
| `check.status_changed` | `check_status`          | `health_state`, `freshness_state`, `execution_state`, `maintenance_active`, `last_response_time_ms` nullable, `last_checked_at` nullable, `incident_id` nullable |
| `group.changed`        | `group`                 | `changed_fields[]`                                                                                                                                               |
| `group.status_changed` | `group_status`          | `health_state`, `counts` (`up`, `suspect`, `down`, `unknown`, `paused`); version `null`, requires query cache invalidation                                       |
| `incident.changed`     | `incident`              | `check_id`, `status`, `started_at`, `ended_at` nullable                                                                                                          |
| `maintenance.changed`  | `maintenance_window`    | `target_type`, `target_id`, `state`, `starts_at`, `ends_at`                                                                                                      |
| `notification.changed` | `notification_resource` | `kind` (`RECIPIENT`/`POLICY`/`DELIVERY`), `state`                                                                                                                |
| `public_page.changed`  | `public_status_page`    | `state`, `page_revision` nullable                                                                                                                                |
| `prediction.changed`   | `prediction_score`      | `check_id`, `status`, `risk_level` nullable, `valid_until` nullable                                                                                              |

`changed_fields` contains allowlisted attribute names without disclosing past or updated values. Notification events omit email addresses and delivery providers. Check events omit target URLs and body expectation strings.

## 7. Public Event Catalog

The public stream emits a single application event type:

| Event                 | Resource      | Payload v1                                           |
| --------------------- | ------------- | ---------------------------------------------------- |
| `status_page.updated` | `status_page` | `page_revision`, `changed_component_ids[]`, `reason` |

`reason`: `STATUS`, `INCIDENT`, `MAINTENANCE`, `CONFIGURATION`, `PUBLICATION`. `changed_component_ids` lists only public component IDs; internal check/group IDs, target URLs, owner IDs, and incident IDs are excluded.

Public clients issue conditional REST `GET` requests upon receiving events. Keeping status payloads out of events prevents allowlist discrepancies between REST and SSE. If public snapshots have not changed, the API returns `304 Not Modified` via `ETag`.

## 8. Backpressure and Resource Ceilings

- Client stream buffers cap at 256 events or 1 MiB, whichever is reached first.
- Pending `*.changed` events for the same resource may be coalesced preserving the highest resource version.
- If buffers overflow, the server emits `resync.required(BUFFER_OVERFLOW)` and terminates the connection to protect memory.
- Slow client write backpressure never blocks primary database outbox dispatch transactions.
- Concurrency limits are enforced per user/session/IP for private streams, and per token/IP for public streams.
- Multiple browser tabs share a single stream; component-level multiplexing is forbidden.
- Reverse proxy response buffering is disabled, idle timeouts are set to at least 3x heartbeat intervals, and gzip/brotli compression is disabled for SSE.

## 9. Replica and Broadcast Architecture

- Each API replica listens to PostgreSQL notification channels and dispatches owner/page-filtered projections to its local connected clients.
- The `REALTIME` outbox consumer rebuilds snapshots for affected public pages in owner-scoped transactions; dispatch completion and `pg_notify` wake-up payloads execute in the same transaction. PostgreSQL delivers signals only after commit. Public SSE never broadcasts revisions ahead of REST snapshots.
- Private states reside in current projection tables; outbox completion and lightweight `pg_notify` wake-ups commit together, allowing replicas to read authoritative DTOs directly from the source of truth.
- Missed notifications do not compromise safety or correctness; periodic REST reconciliation recovers authoritative state.
- Rolling deployments and restarts terminate active streams gracefully; clients reconnect using standard backoff algorithms.
- Replicas maintain no durable client checkpoint tables. The transactional outbox drives real-time invalidations without client replay stores.
- Unsupported schema versions trigger `resync.required` events and emit operational alarms rather than pushing malformed payloads to clients.

## 10. Security Controls

- Owner filtering occurs inside database owner contexts prior to projection generation, not as an afterthought during event ID lookup.
- Public projections share identical allowlist queries with REST APIs.
- Stream endpoints disable CDN and shared proxy caching.
- CORS policies require exact origin allowlists, `Vary: Origin`, and credentialed access.
- Tokens, passwords, and sessions never appear in URLs, event data, comments, or diagnostic reason codes.
- Event IDs are opaque and unpredictable; submitting another tenant's `Last-Event-ID` grants zero data access.
- Public SSE rate limits enforce `429 Too Many Requests` prior to stream initialization; open streams never emit raw Problem JSON.

## 11. Polling Fallback Strategy

If SSE is unsupported or blocked by corporate proxies, clients fall back to polling:

- Issue conditional `GET` requests for dashboard and public snapshots every 30 seconds + jitter on active tabs.
- Throttle or pause polling loops when tabs are in the background.
- Reconcile immediately when tabs regain foreground focus.
- Leverage `ETag` and `304 Not Modified` to minimize bandwidth consumption.
- Distinguish polling communication failures from target downtime; the UI renders connectivity and data freshness independently.

## 12. Verification Criteria

- Dual independent browser sessions reflect owner status mutations without manual reloads.
- No private events leak across tenant boundaries via type, timing, or ID dimensions.
- Public streams emit only published component changes, strictly omitting private IDs and URLs.
- Buffered event processing eliminates race conditions between stream initialization and snapshot fetching.
- Duplicate, out-of-order, or obsolete events are deterministically ignored or mapped to query invalidations.
- Replica restarts and network drops recover state cleanly via REST snapshots without requiring `Last-Event-ID`.
- Slow consumers exceeding buffer limits are evicted without blocking the main dispatch loop.
- 15-second heartbeats keep proxy connections open; 45 seconds of silence initiates reconnects.
- Token rotations terminate active public streams immediately and prevent reconnects.
- Disabling the Python predictor has zero impact on core stream health or event delivery.
