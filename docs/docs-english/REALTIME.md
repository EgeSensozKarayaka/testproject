# Realtime Update Infrastructure Architecture

**Stage:** 13 — Realtime Update Infrastructure

**Status:** Final architecture; Slice 1 relay and Slice 2 private API stream/projection implemented and verified

**Date:** 2026-10-10 19:50 +06:00

**Scope:** FR-DASH-004–005, FR-PUBLIC-004–005, NFR-PERF-002, AC-013–014, AC-070–074

**Related documents:** [`REALTIME_CONTRACT.md`](./REALTIME_CONTRACT.md), [`EVENT_CATALOG.md`](./EVENT_CATALOG.md), [`API_DESIGN.md`](./API_DESIGN.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## 1. Purpose and Outcome

This stage establishes the realtime update pipeline that enables private management screens to observe changes without manual page refreshes. SSE is a rapid invalidation channel; it is not persistent state, an event replay store, or an alternative to REST.

The final approach:

- Domain mutations and event records remain within the same PostgreSQL transaction;
- A dedicated `realtime-worker` consumes `REALTIME` outbox dispatches via lease/fencing;
- The worker broadcasts only a compact, redaction-safe wake-up envelope containing no sensitive data via `pg_notify`;
- Each API replica listens to the same PostgreSQL channel and delivers owner/page-scoped projections only to its own connected clients;
- The client opens the stream prior to taking a snapshot, buffers incoming invalidations, and converges via REST;
- Loss of a connection, worker, or notification signal never produces incorrect state; at worst, liveness is delayed;
- With bounded queues, coalescing, admission limits, and polling fallback, a slow consumer or disrupted realtime channel never degrades the core monitoring system.

This is not a microservice decomposition. The `realtime-worker` is a deployment process within the same Node.js monorepo/domain, lacking a separate public API and separate data ownership. Choosing a separate process serves solely to segregate outbox consumption privileges from the API and isolate failures.

## 2. Scope Boundaries

### 2.1 Within Scope of Stage 13

- Private `GET /api/v1/events` SSE runtime;
- `REALTIME` outbox claim/complete/dead-letter boundary and safe activation;
- Dedicated realtime relay process and a dedicated PostgreSQL listener for each API replica;
- Owner-based in-memory subscriber hub and private projection mapper;
- Client infrastructure for heartbeat, reconnect, snapshot reconciliation, and polling fallback;
- Query invalidation and refetch integration within the existing authenticated React screen;
- Acceptance tests covering two independent clients, two API replicas, listener/worker restarts, and slow consumers;
- Ports and test doubles for the upcoming public channel to utilize the same hub/serializer/admission mechanism.

### 2.2 Outside Scope of Stage 13

- Public status page allowlist snapshot, token lifecycle, and actual public SSE route activation — Stage 15;
- Complete visual design of the monitoring dashboard, history charts, and notification settings screens — Stage 14;
- Prediction event producer/model lifecycle — Stage 16;
- CDN/WAF and multi-region deployment — production infrastructure scope.

The public SSE route in the canonical OpenAPI specification is reserved. The event route alone will not be exposed before public snapshots and token validation are ready; a public stream running without a snapshot cannot fulfill the race-free contract. Stage 13 establishes the shared transport, while Stage 15 completes end-to-end public acceptance.

## 3. Invariants

1. **PostgreSQL current projection is the source of truth.** Browser state is never reconstructed solely from SSE payloads.
2. **Domain write and outbox are atomic.** A mutation cannot commit while an event record is lost; both commit or roll back together.
3. **`LISTEN/NOTIFY` is not a persistent queue.** It carries only a post-commit bounded wake-up signal; it may be missed, duplicated, or reordered.
4. **There is no persistent browser replay.** `Last-Event-ID` provides neither authorization nor correctness guarantees. Every reconnect requires REST reconciliation.
5. **Owner isolation is enforced twice.** The wake-up is routed to the hub by owner identity; the DTO read is independently executed within an owner-scoped DB transaction/RLS.
6. **Public and private serializers are never shared.** Public projections originate exclusively from Stage 15's allowlist reader; private identities or state objects are never serialized onto the public channel.
7. **A client never blocks the consumer/server.** Each connection enforces byte and event limits; buffer overflow triggers a resync and disconnect.
8. **There is no global order beyond the sequence of a single resource.** Version numbers are compared strictly within the same `resource.type + resource.id`.
9. **The realtime channel is not product state.** Worker/API restarts, deployments, or transient outages never generate DOWN events or history samples.
10. **Prediction is not a hard dependency.** If prediction event mapping or its worker encounters an error, other event families and streams continue uninterrupted.

## 4. Existing Foundation and Implementation Gaps

The existing repository provides the following foundation:

- `infra.outbox_events` and destination-based `infra.outbox_dispatches`;
- A common transaction helper that writes events/dispatches exclusively for active destinations;
- Lease, fencing token, retry, and dead-letter fields;
- Domain event catalog with private and public SSE allowlists;
- Owner RLS, opaque sessions, exact-origin CORS, and HMAC-based rate-limit keys;
- Canonical SSE endpoint and frame contracts;
- Intended `REALTIME` destination targeting from check, group, maintenance, and notification producers;
- 30-second polling fallback and 60-second visible-tab reconciliation rules.

Remaining implementation gaps:

1. The `REALTIME` destination was activated in Revision 28, following the completion of relay/API/browser acceptance.
2. The fetch-stream browser parser, 45-second stale detection, snapshot coordination, and polling fallback were pending implementation.
3. The existing OpenAPI `DashboardPage` describes two collections with a single cursor; browser convergence therefore utilizes a bounded snapshot set of visible screen queries.
4. Production capacity/proxy acceptance and two real-browser convergence tests fall under Slice 3.
5. The public snapshot/token projection does not yet exist; exposing the public route prematurely is unsafe.

## 5. Component Topology

```text
domain transaction (API / monitor / notification)
  ├─ source-of-truth mutation
  ├─ infra.outbox_events
  └─ infra.outbox_dispatches(destination=REALTIME)
                         │
                         ▼
realtime-worker (1..N replica, dedicated DB pool/role)
  ├─ bounded claim via lease + fencing
  ├─ internal event → wake-up family allowlist
  ├─ dispatch complete + pg_notify in same transaction
  └─ retry/dead-letter + health/metrics
                         │ PostgreSQL broadcast
             ┌───────────┴───────────┐
             ▼                       ▼
API replica A listener       API replica B listener
  ├─ bounded projection queue  ├─ bounded projection queue
  ├─ owner-scoped DB read      ├─ owner-scoped DB read
  └─ local owner hub           └─ local owner hub
       │     │                       │
       ▼     ▼                       ▼
   browser 1 browser 2           browser 3
       └──── stream → REST snapshot → buffered invalidation ────┘
```

The realtime worker transitions an event to dispatch completion exactly once. PostgreSQL `NOTIFY`, meanwhile, is broadcast at commit time to all listening API sessions. As worker replicas scale, duplicate processing remains bounded, while each API replica can deliver the identical modification to its own local clients.

## 6. Persistence and Revision 27 Plan

### 6.1 Roles and Privileges

The new `site_monitor_realtime` NOLOGIN role possesses strictly narrowed privileges:

- Invoking the realtime dispatch claim/complete/retry/dead-letter SECURITY DEFINER functions;
- Invoking the worker schema compatibility/preflight function;
- Emitting redacted wake-up notifications to the fixed `site_monitor_realtime_v1` channel via the completion function.

The role holds no permissions on domain tables, authentication tables, unconstrained outbox `SELECT/UPDATE` operations, or arbitrary notification payload creation. Local Compose executes a `SET ROLE` to this role via the existing bootstrap login; production requires a dedicated login and secret.

The API role cannot consume the outbox. The dedicated listener connection performs only `LISTEN site_monitor_realtime_v1`; owner DTO reads are executed through RLS-scoped transactions within the existing `site_monitor_api` pool.

### 6.2 Scoped Database Functions

Revision 27 introduces the following scoped functions:

- `security_api.claim_realtime_dispatch(worker_id, lease_seconds)`:
  - Strictly `destination='REALTIME'`;
  - Matches `PENDING`, due `RETRY_WAIT`, or expired `PROCESSING` rows;
  - Uses `FOR UPDATE SKIP LOCKED` and deterministic `(available_at, event_id)` ordering;
  - Increments `attempt_count` and monotonically increases `fencing_token`;
  - Returns the event envelope alongside lease details.
- `security_api.complete_realtime_dispatch(event_id, worker_id, fencing_token, result, result_code, retry_delay_seconds)`:
  - Can only succeed if matching the active lease and fencing token;
  - Applies `COMPLETED`, `RETRY`, or `DEAD` outcomes within a single fencing boundary;
  - Obtains retry intervals from the worker's bounded deterministic backoff calculation;
  - Generates a fixed wake-up envelope under 1 KiB from stored routing metadata strictly on `COMPLETED` outcomes.

The worker executes the `complete` invocation and the fixed-channel `pg_notify` within the same database transaction. Because PostgreSQL delivers notifications strictly upon commit, one of two deterministic states occurs:

- Transaction rollback: dispatch is not completed, no notification is broadcast, and the task is retried after lease expiry;
- Transaction commit: dispatch completes and the notification is broadcast to all active listeners.

There is no claim of exactly-once browser delivery. The database transaction guarantees solely that "dispatch completion and wake-up notification are never decoupled."

### 6.3 Activation and Historical Event Policy

The `REALTIME` activation is enabled in a forward-only cutover migration strictly after these preflight conditions succeed:

1. The realtime worker supports the schema version;
2. At least one worker reports readiness;
3. API listener and private SSE route tests pass;
4. Two-client and two-API-replica acceptance tests pass.

Historical domain events created prior to activation are not backfilled. Clients obtain the current state during their initial snapshot. This avoids storming clients with stale events and rendering meaningless notifications.

## 7. Wake-up Envelope and Projection

### 7.1 PostgreSQL Notification Payload

The channel payload is strictly under 1 KiB, schema-versioned, and carries only routing metadata:

```json
{
  "v": 1,
  "event_id": "0192...",
  "owner_id": "0191...",
  "event_type": "check.health_changed",
  "aggregate_type": "check_state",
  "aggregate_id": "0190...",
  "aggregate_version": "19",
  "occurred_at": "2026-10-10T13:12:00.000Z"
}
```

The payload never contains target URLs, emails, expected bodies, response bodies, session/token identifiers, incident details, or public tokens. Events with `owner_id=null` never enter the private hub unless explicitly allowlisted. Unknown schema versions (`v`), unrecognized event types, or malformed JSON trigger `resync.required(PROJECTION_INVALIDATED)` across affected local streams and emit alerts rather than broadcasting corrupt data.

### 7.2 Internal Event to External Event Mapping

The worker validates only the internal event family; the API projection mapper determines the external event type:

| Internal Event Family                                          | External Private Event                   | Read Behavior                                                                          |
| -------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| check create/metadata/probe/schedule/pause/resume/group/delete | `check.changed`                          | Current check list/detail query invalidation; minimal tombstone invalidation on delete |
| observation/health/freshness/incident state                    | `check.status_changed`                   | Reads current check status projection within an owner-scoped transaction               |
| group create/change/delete or member status impact             | `group.changed` / `group.status_changed` | Rereads group configuration and computed status                                        |
| incident lifecycle                                             | `incident.changed`                       | Rereads incident journal/detail projection                                             |
| maintenance lifecycle                                          | `maintenance.changed`                    | Reads current window state within owner scope                                          |
| recipient/policy/delivery                                      | `notification.changed`                   | Reads resource state excluding sensitive addresses                                     |
| public config                                                  | `public_page.changed`                    | Private management view only; not a public broadcast                                   |
| prediction                                                     | `prediction.changed`                     | Optional port; errors do not disrupt other families                                    |

When a wake-up arrives and no active stream exists for that owner on the local replica, no projection database query is executed. If active streams exist, jobs are coalesced using the key `(owner_id, external_family, resource_id)`. For the same key, only the highest version is retained; `version=null` represents a query invalidation and cannot be superseded.

If a projection read fails, synthetic events are never invented. A resync signal is dispatched to the relevant owner streams, and the error is recorded with bounded retries and metrics; the worker dispatch has already indicated that durable current state has changed.

## 8. API Replica and Subscriber Hub

### 8.1 Dedicated Listener

Each API replica establishes a single long-lived `pg.Client` outside the general connection pool:

- Upon establishing the connection, it issues `LISTEN` on the fixed channel;
- The API readiness check will not report `ready` until connect and listen complete;
- If the connection drops, it reconnects using full-jitter backoff;
- A single `resync.required(SUBSCRIBER_RESTARTED)` is dispatched to all local streams between disconnect and reconnect;
- The listener never consumes connection budget from the primary request pool.

A listener disconnect does not degrade liveness. Readiness transitions to `unavailable` after a short grace period; ongoing HTTP/REST requests and monitoring workers continue functioning independently.

### 8.2 In-Memory Indexes

The private hub maintains the following bounded in-memory indexes:

```text
owner_id   -> Set<connection>
session_id -> connection count
ip_hash    -> connection count
connection -> queue bytes/events + last write + auth deadline
```

The hub is not persistent state. A restart terminates all active connections; clients recover through reconnect + snapshot. Redis is not added. V1 admission limits are enforced per replica; deployment-wide ceilings are maintained at the reverse proxy/WAF layer. This architectural tradeoff is documented and does not compromise user state correctness.

### 8.3 Stream Initialization

The lifecycle sequence for `GET /api/v1/events`:

1. Verifies `Accept: text/event-stream`; otherwise returns `406`.
2. Exact-origin/CORS, session validity, and disabled-user checks occur before the connection opens.
3. Handshake rate limits and local session/owner/IP/global connection admission limits are evaluated; rejections return `429` problem JSON.
4. The connection is atomically registered in owner and session indexes.
5. SSE response headers are written and compression is disabled.
6. The initial frame sent is `stream.ready`; events arriving after this point enter the connection queue.
7. Socket `close`/`error`/abort idempotent cleanup cleans all timers and index references.

The client requests its snapshot strictly after receiving `stream.ready`. Any event arriving in the infinitesimal window between stream registration and the ready frame is preserved in the connection queue.

### 8.4 Session Lifecycle

- The stream tracks the session's DB expiration timestamp via a timer and closes no later than that instant.
- A logout or session revocation event closes connections in the local session index immediately.
- To safeguard against missed revocation signals, a 60-second reconciliation sweep revalidates active session identifiers in bounded batches.
- Connections whose authorization has lapsed receive no further owner data or problem JSON frames; the socket is terminated, and a standard HTTP reconnect receives `401`.

## 9. Frame Structure, Backpressure, and Coalescing

The wire format strictly adheres to [`REALTIME_CONTRACT.md`](./REALTIME_CONTRACT.md). The serializer:

- Validates event names and payloads against a Zod allowlist;
- Produces single-line JSON; rejects any `id` or `event` value containing CR/LF;
- Enforces identity between the JSON `event_id`, SSE `id`, and event name;
- Carries the private resource version as a decimal string;
- Emits a `: heartbeat <UTC>` comment every 15 seconds.

For each connection, the first limit reached is enforced:

- 256 pending events;
- 1 MiB serialized frame buffer.

If socket `write()` returns false, new frames are not written directly. Pending invalidations for the same resource are coalesced to retain only the highest version. If capacity limits are exceeded, the server sends `resync.required(BUFFER_OVERFLOW)` where possible and terminates the connection. The global relay/projection queue is likewise bounded; global overflow triggers resync strictly for affected owner streams, preventing unbounded RAM consumption or backpressure on the outbox.

Initial configuration values are validated in code and configurable via the environment. Closing acceptance tests make no unverified claims of high concurrent connections. Minimum acceptance requires two independent browsers; the capacity profile additionally records a local baseline and a loose regression budget.

## 10. Browser Client and Consistency Algorithm

### 10.1 Why Not Native `EventSource`

Native `EventSource` does not surface heartbeat comments to application code and provides insufficient control over responses to reliably distinguish between 401, 404, and 429 status codes. Consequently, the client utilizes a compact, tested SSE parser built on top of browser `fetch` + `ReadableStream`:

- `credentials: 'include'`;
- `Accept: 'text/event-stream'`;
- Response status and content-type validation;
- Tracking the timestamp of the last received byte, including comments;
- Terminating stale connections via `AbortController` after 45 seconds of silence;
- 1–30 second exponential full-jitter reconnect backoff;
- Transition to logged-out auth state on 401/403, terminal stop on public 404, and `Retry-After` adherence on 429.

No new runtime dependencies are required. The parser is unit-tested across scenarios including chunk-split UTF-8 sequences, CRLF/LF line endings, multi-line `data:` entries, comments, incomplete terminal frames, and abort handling.

### 10.2 Private Snapshot Plan

The race-free initialization sequence:

1. Open the stream;
2. Receive `stream.ready`;
3. Buffer application events into a bounded client buffer;
4. Refetch visible-screen owner-scoped REST queries;
5. Record snapshot resource versions into the local cache;
6. Apply buffered events only if their version is newer or unversioned;
7. Transition to standard event processing.

Because a single `DashboardPage` cursor cannot fully represent two independent collections, the Stage 13 correctness algorithm employs a "snapshot set": the visible screen's queries for `/checks`, `/groups`, `/incidents`, notifications, and related entities are revalidated under their respective bounded cursor/ETag contracts. The Stage 14 dashboard endpoint may provide a convenience projection for these queries; realtime channel correctness is never tightly coupled to a single monolithic response.

Direct optimistic state mutation from event payloads is not required. Default behavior centers on query-key invalidation and bounded refetching. This eliminates the risk of rendering intermediate inconsistent states caused by out-of-order or coalesced events.

### 10.3 Periodic Reconciliation and Fallback

- REST reconciliation occurs at least every 60 seconds while SSE remains active on a visible tab.
- Immediate reconciliation triggers when returning to the foreground via `visibilitychange`.
- If SSE fails to stabilize across three consecutive connection cycles, the client falls back to 30-second + jitter polling.
- In background tabs, polling pauses or slows; it resumes immediately upon returning to the foreground.
- Polling ceases once SSE connectivity stabilizes again.
- Client transport errors never mark any check as `DOWN`; they render an independent "live updates delayed" UI freshness indicator.

Because `Last-Event-ID` does not offer persistent replay, it is not a mandatory header in cross-origin fetch requests. When supplied, it is treated strictly as a diagnostic gap indicator permitted by the CORS allowlist; it never waives the snapshot requirement.

## 11. Public Channel Stage 15 Integration Boundary

When the public status page is introduced, the same core transport is utilized with distinct ports:

- Token hash lookup and generic-not-found semantics;
- Page-scoped local hub (`page_id -> connections`);
- An allowlist snapshot reader identical to REST;
- A public projection transaction that generates page revisions;
- Serializer restricted strictly to `status_page.updated`;
- Immediate termination of local streams when a token is rotated or disabled.

A public wake-up cannot be broadcast before the projection revision has committed. Public payloads never contain private check/group/incident IDs, owner IDs, URLs, or tokens. Following a notification, the API replica routes events to the local hub using only the page ID; on the wire, the resource ID is represented as the opaque string `"public"`.

Stage 13 test doubles prove that these ports cannot inadvertently wire into the private serializer. The production public route and acceptance testing connect to the unified commit/read model alongside snapshots in Stage 15.

## 12. Error Handling, Retry, and Shutdown

### 12.1 Realtime Worker

- Transient DB/projection errors: bounded exponential backoff with jitter;
- Unsupported schema/events: marked directly as visible `DEAD` without retrying, raising alarms and metrics;
- Lost lease/fencing token mismatch: stale workers cannot commit completion or notification;
- Poison events: never block the main queue indefinitely;
- Shutdown: new claims cease, active transactions either complete within a grace period or roll back, and database pools close.

### 12.2 API Subscriber

- Listener reconnect: triggers a resync across all local streams;
- Projection read timeout: resyncs the affected owner while other owners continue uninterrupted;
- Socket backpressure: triggers connection-local buffer overflow and disconnection;
- Serializer rejection: payload is dropped, affected owner streams receive a resync, and metrics increment;
- Graceful shutdown: closes new SSE admission, dispatches `SUBSCRIBER_RESTARTED` where possible, and terminates sockets upon expiry of a bounded grace period.

Worker readiness checks monitor schema preflight, database connectivity, and at least one successful claim/poll cycle. API readiness checks ensure normal database readiness and confirm the listener is not disconnected beyond the grace window. When the realtime worker is offline, API/monitor/notification liveness remains unharmed; clients maintain fresh state via polling fallback.

## 13. Security and Privacy

- Private streams are strictly scoped to the session owner; never derived from query or path parameters.
- The wake-up `owner_id` exists solely within the internal PostgreSQL connection and is never included in browser payloads.
- Projection queries cannot read the aggregate ID from a notification without enforcing owner RLS.
- Public tokens remain masked/redacted in access logs, APM traces, metric labels, and problem instances.
- SSE responses enforce `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`; HTTP compression is disabled.
- Exact-origin CORS and `Vary: Origin` headers are preserved; wildcard origins with credentials are prohibited.
- Handshake rate-limit keys are HMAC-hashed bounded identifiers rather than raw IP/session/token strings.
- Frames, logs, and metrics never expose target query strings, expected bodies, email addresses, response bodies, session IDs, CSRF tokens, or provider secrets.
- Error codes come from a bounded allowlist; raw exception messages are never written to outbox records or metric labels.

## 14. Observability and Capacity Budgets

Mandatory metric families with low-cardinality labels:

- Realtime dispatch counts for pending, processing, retry, dead, and oldest age gauge;
- Totals for claim, complete, and retry alongside dispatch latency histograms;
- Listener connection state and reconnect count totals;
- Active streams aggregated by scope and replica; omitting owner, session, and token labels;
- Projection queue depth, coalesced count, overflow count, and read latency;
- SSE frames and bytes counts, heartbeats, slow-consumer disconnects, and resync reasons;
- Handshake rejection reasons (`AUTH`, `RATE`, `CAPACITY`, `MEDIA_TYPE`);
- Client-side reconnect counts, stale connection aborts, polling fallback counts, and snapshot latency.

Logs record `request_id`, internal `event_id`, bounded event family, worker/replica id, and sanitized result. Raw owner, session, IP, and token values are never logged.

Capacity closure measurements evaluate at minimum:

- Burst events generated from 20, 200, and 500 checks;
- Two API replicas, each serving multiple clients;
- Delivery latency for fast clients when slow clients are present;
- Outbox backlog accumulation while the worker is offline, followed by backlog drain upon recovery;
- Snapshot convergence during listener restarts;
- Authenticated REST latency on the separate API request pool.

Findings are reported as a local baseline; no unverified production SLOs or claims of infinite concurrent connections are made.

## 15. Proxy and Deployment Requirements

- HTTP/1.1 keep-alive or HTTP/2 streaming is maintained.
- Reverse proxy buffering and SSE response compression are disabled.
- Proxy idle timeout is at least 60 seconds, preferably 75 seconds—longer than triple the 15-second heartbeat interval.
- Response/body timeouts are handled separately from standard JSON endpoints.
- During rolling deployments, connection drain intervals are bounded; client reconnects are expected.
- Sticky sessions are not required for correctness. Every replica listens to the PostgreSQL channel, and snapshots are stored in the authoritative database.
- Global connection and internet abuse limits are enforced independently at the production edge layer; internal application limits serve as defense-in-depth.

## 16. Implementation Slices

### Slice 1 — Persistence, Worker, and Relay Core

- [x] Revision 27 roles, functions, and preflight checks;
- [x] Realtime worker configuration, claim/fencing/retry/dead-letter mechanics;
- [x] Safe wake-up mapper and transactional `pg_notify`;
- [x] Unit + real PostgreSQL tests and container readiness smoke checks while activation remains disabled.

### Slice 2 — Private API Stream and Projection

- [x] Dedicated listener, owner hub, frame serializer, and backpressure handling;
- [x] Private projection reader and mapper;
- [x] Session expiry/revocation handling and graceful shutdown;
- [x] Private route, headers, and media/auth/rate/capacity error responses;
- [x] Two API replica owner-isolation and listener reconnect integration tests.

### Slice 3 — Browser Client, Cutover, and Closure

- [x] Fetch-stream parser, stale detection, backoff, snapshot coordinator, and polling fallback;
- [x] Integration with existing authenticated UI query invalidation;
- [x] `REALTIME` activation cutover via Revision 28;
- [x] Acceptance testing across two browsers, reconnects, replicas, and slow consumers;
- [x] Capacity report and Compose/proxy configuration;
- [ ] Full CI and production image/E2E closure gate.

The public production adapter connects to the shared Stage 13 transport in the initial slice of Stage 15.

## 17. Mandatory Verification Matrix

| Scenario                    | Expected Verification Evidence                                         |
| --------------------------- | ---------------------------------------------------------------------- |
| Domain mutation rollback    | No event or dispatch created                                           |
| Worker crash post-claim     | Higher fencing token upon lease expiry; single committed wake-up       |
| Two workers                 | Only the active fencing token completes the dispatch                   |
| Two API replicas            | Each replica delivers the identical owner invalidation to its clients  |
| Two browsers                | Change appears across both browser windows without manual reload       |
| Cross-owner isolation       | No leaks of event type, ID, timing, or payload                         |
| Stream-before-snapshot race | Buffered newer version is preserved                                    |
| Duplicate/out-of-order      | Stale version is discarded or query is invalidated                     |
| Listener disconnect         | Reaches current state via resync + reconnect + snapshot                |
| Worker outage               | Core product functions; polling updates; backlog drains on recovery    |
| Slow consumer               | Connection-isolated overflow/resync; other clients and API unaffected  |
| Session expiry/logout       | Stream terminates within bounded window; reconnect receives 401        |
| Heartbeat/stale connection  | 15s comment; aborts and reconnects after 45s of silence                |
| Unsupported schema          | Not written to wire; triggers dead-letter, alarm, and resync           |
| Graceful shutdown           | Halts new admissions; bounded drain; no stuck sockets                  |
| 500-check burst             | Queue/RAM remains bounded; authenticated REST latency budget preserved |
| Public adapter boundary     | Private serializer, IDs, and tokens cannot leak into public payload    |

## 18. Completion Criteria

Stage 13 is considered complete in implementation only when all of the following criteria are satisfied:

- Revisions 27–28, the realtime worker, and the cutover can be provisioned against a clean database and pass the idempotent migration gate;
- Private SSE demonstrates automatic updates across two browsers and two API replicas;
- Owner isolation, race-free snapshots, listener/worker restarts, and slow-consumer scenarios pass;
- Polling fallback never misinterprets the loss of the realtime channel as a check DOWN state;
- `REALTIME` activation is enabled strictly after consumers are confirmed ready;
- Proxy, Compose, configuration documentation, and capacity reports are up to date;
- Formatting, contract drift, linting, strict typechecking, unit, integration, E2E, and production build gates pass;
- Project status documentation transparently records that the public route depends on Stage 15.
