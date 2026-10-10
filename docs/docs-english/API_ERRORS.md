# API Error Contract

**Stage:** 4 — API, Event, and Error Contracts

**Status:** Approved; centralized mapper and core conformance tests implemented

**Date:** 2026-10-10

**Related documents:** [`API_DESIGN.md`](./API_DESIGN.md), [`openapi-v1.yaml`](./openapi-v1.yaml)

## 1. Purpose

API errors use a single RFC 9457-compliant envelope with media type `application/problem+json` so clients can behave securely and deterministically without parsing freeform text. While human-readable `detail` messages may change, client handling must rely solely on HTTP `status`, stable machine `code`, and field-level `pointer` identifiers.

## 2. Problem Envelope

```json
{
  "type": "https://status-monitor.example/problems/validation-failed",
  "title": "Request validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "instance": "/api/v1/checks",
  "code": "validation_failed",
  "request_id": "0192f82c-2f28-7448-8cc1-334f117c0630",
  "retryable": false,
  "errors": [
    {
      "pointer": "/timeout_ms",
      "code": "must_be_less_than_interval",
      "message": "timeout_ms must be lower than interval_seconds."
    }
  ]
}
```

Fields:

| Field                 | Requirement | Meaning                                                                                                                  |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `type`                | Required    | Stable, resolvable problem type URI. Represents versioned code; never includes request payloads.                         |
| `title`               | Required    | Short, stable English summary of problem type.                                                                           |
| `status`              | Required    | Duplicate copy of HTTP status code in payload body.                                                                      |
| `detail`              | Required    | Safe human-readable explanation for this specific instance; not a programmatic contract.                                 |
| `instance`            | Required    | Request path sanitized of query parameters, tokens, and secrets. Public tokens are masked as `{redacted}`.               |
| `code`                | Required    | Stable `snake_case` machine error code for client decision logic.                                                        |
| `request_id`          | Required    | Log and support correlation ID; matches response `X-Request-Id` header.                                                  |
| `retryable`           | Required    | Indicates whether the exact semantic operation can safely be retried later. Retry safety also depends on idempotency.    |
| `errors`              | Conditional | Ordered list of validation errors, present only for field or parameter validation failures.                              |
| `retry_after_seconds` | Conditional | Non-negative integer seconds for retryable transient `409`, `429`, or `503` responses; aligns with `Retry-After` header. |

`null` values, empty arrays, and debug metadata are omitted. Stack traces, raw SQL queries, database table/role names, filesystem paths, internal dependency payloads, and unhandled exception traces are strictly forbidden in public responses.

## 3. Field Errors

Each element of `errors` has the following schema:

```json
{
  "pointer": "/expected_status_code",
  "code": "out_of_range",
  "message": "expected_status_code must be between 100 and 599."
}
```

- JSON body fields are identified using RFC 6901 JSON Pointers (e.g., `/expected_status_code`).
- Query parameters use `/query/cursor`, path parameters use `/path/check_id`, and headers use `/headers/if-match`.
- Field errors are sorted deterministically: first by pointer, then by code.
- `message` must never echo rejected passwords, secret tokens, URL query parameters, expected body needles, or email addresses.
- Unknown request fields are rejected with code `unknown_field`.
- Multiple field errors can be reported in a single response; expensive domain and database validations are skipped until basic schema constraints pass.

## 4. Stable Problem Codes

| HTTP | `code`                        | Usage Description                                                                                    | Retry                      |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------- |
| 400  | `malformed_json`              | Malformed JSON syntax in request body.                                                               | No                         |
| 400  | `invalid_request`             | Request violates schema but cannot be mapped to a specific field.                                    | No                         |
| 400  | `invalid_cursor`              | Pagination cursor is corrupt, expired, or issued for a different query.                              | No                         |
| 400  | `invalid_precondition`        | Precondition header syntax or header combination is invalid.                                         | No                         |
| 401  | `authentication_required`     | Missing, expired, or invalidated session.                                                            | After re-authentication    |
| 401  | `invalid_credentials`         | Incorrect credentials; does not reveal whether the username exists.                                  | No                         |
| 403  | `csrf_failed`                 | CSRF token or origin validation check failed.                                                        | After fetching fresh token |
| 403  | `operation_forbidden`         | Authenticated user lacks permission for account-level action. Not used for other tenants' resources. | No                         |
| 404  | `resource_not_found`          | Resource does not exist, has been deleted, or belongs to another tenant.                             | No                         |
| 404  | `public_page_not_found`       | Public status token is invalid, rotated, disabled, or does not exist.                                | No                         |
| 405  | `method_not_allowed`          | Route exists but HTTP method is unsupported.                                                         | No                         |
| 406  | `not_acceptable`              | Requested `Accept` header cannot be satisfied.                                                       | No                         |
| 409  | `invalid_state_transition`    | Resource cannot accept the command in its current lifecycle state.                                   | After state changes        |
| 409  | `idempotency_key_reused`      | Idempotency key reused with a different operation or request fingerprint.                            | With fresh key             |
| 409  | `idempotency_in_progress`     | Concurrent transaction with identical key is still processing after bounded wait.                    | After `Retry-After`        |
| 409  | `resource_conflict`           | Unique constraint, invariant, or domain conflict.                                                    | Conditional                |
| 409  | `quota_exceeded`              | Configured operational quota reached; check counts are not hardcoded.                                | When resources freed       |
| 412  | `resource_version_mismatch`   | `If-Match` does not match current resource `ETag`.                                                   | Re-read & re-evaluate      |
| 413  | `payload_too_large`           | Request body, field, or response size limit exceeded.                                                | No                         |
| 415  | `unsupported_media_type`      | Unsupported `Content-Type` header.                                                                   | Once corrected             |
| 422  | `validation_failed`           | Field, query parameter, or header validation failed.                                                 | Once corrected             |
| 422  | `unprocessable_configuration` | Schema syntax valid, but cross-field domain rules violated.                                          | Once corrected             |
| 428  | `precondition_required`       | Missing mandatory `If-Match` header on a mutable resource.                                           | Provide header             |
| 429  | `rate_limit_exceeded`         | Abuse prevention or operational rate limit exceeded.                                                 | After `Retry-After`        |
| 500  | `internal_error`              | Unexpected internal server error.                                                                    | Only if idempotent         |
| 503  | `dependency_unavailable`      | Critical external or internal dependency is temporarily unavailable.                                 | Yes                        |
| 503  | `schema_incompatible`         | Runtime and database schema compatibility epoch/revision mismatch.                                   | After deployment/migration |

This catalog may be expanded in v1. Clients must safely treat unknown error codes as generic instances of their parent HTTP status code class.

## 5. Security and Tenant Isolation

- Non-existent resources and resources belonging to other tenants return an identical `404 resource_not_found` response; timing and `detail` strings reveal no distinction.
- Invalid, revoked, or rotated public tokens return identical `404 public_page_not_found` responses.
- Registration, password reset initiation, and verification endpoints never disclose account existence via error codes; all return generic `202 Accepted` receipts.
- Login failures do not distinguish between "unknown email" and "invalid password".
- SSRF and egress policy denials never reveal internal IP addresses or DNS lookup details; private APIs may provide sanitized failure categories to resource owners, while public views disclose nothing.

## 6. Concurrency, Retry, and Idempotency

- `428 Precondition Required` instructs clients to supply missing precondition headers, not to re-fetch state.
- `412 Precondition Failed` instructs clients to fetch the latest representation and prompt the user; automatic silent overwrites are prohibited.
- `409 idempotency_key_reused` occurs when an existing idempotency key is submitted with a different request fingerprint within the same operation scope.
- When an identical idempotency key and request fingerprint match an existing completed operation, the original status, body, and `Location` headers are replayed semantically without re-executing domain actions.
- Following ambiguous network errors, only idempotent HTTP methods or commands bearing an `Idempotency-Key` header may be retried automatically.
- `500 Internal Error` responses default to `retryable: false`, as server transaction commit status may be uncertain.

## 7. Internal Error Mapping Hierarchy

As errors bubble to the HTTP transport boundary, the centralized error mapper resolves them in the following order:

1. Media parsing and request schema validation
2. Authentication, session validity, and CSRF token verification
3. Resource visibility and tenant ownership
4. Preconditions and optimistic concurrency (`If-Match`)
5. Domain state machine rules and invariants
6. Rate limits and quota constraints
7. Known transient dependency failures
8. Unhandled internal exceptions

Raw database constraints and database driver errors are never returned to clients. Expected database constraint violations are translated into stable domain error codes; unexpected violations map to `internal_error` with details logged exclusively on the server.

## 8. Logging and Observability

Every problem response is logged structurally with `request_id`, machine `code`, HTTP `status`, route template, and sanitized actor/resource IDs. Client operational errors (`4xx`) do not emit log warning/error noise; security-relevant signals are metered separately. Unhandled exceptions (`5xx`) log full causal exception chains on the server without leaking details into HTTP responses.

The following data is strictly redacted in all log sinks:

- Session tokens, CSRF tokens, verification/reset tokens, and public status tokens
- `Authorization`, `Cookie`, and `Set-Cookie` headers
- Email addresses, expected response body markers, and sensitive URL query strings
- Probe response bodies and raw SMTP transmission payloads

## 9. Examples

### 9.1 Stale ETag Conflict

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json
X-Request-Id: 0192f82c-3f95-73d0-a459-240f319f5d9a
ETag: "rv-18"

{
  "type": "https://status-monitor.example/problems/resource-version-mismatch",
  "title": "Resource version mismatch",
  "status": 412,
  "detail": "The resource changed after it was read.",
  "instance": "/api/v1/checks/0192f7c8-548e-7c43-9f79-93cbf7eaf831",
  "code": "resource_version_mismatch",
  "request_id": "0192f82c-3f95-73d0-a459-240f319f5d9a",
  "retryable": true
}
```

### 9.2 Rate Limit Exceeded

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
Retry-After: 30

{
  "type": "https://status-monitor.example/problems/rate-limit-exceeded",
  "title": "Rate limit exceeded",
  "status": 429,
  "detail": "Too many requests for this operation.",
  "instance": "/api/v1/checks/{redacted}/runs",
  "code": "rate_limit_exceeded",
  "request_id": "0192f82c-50a9-71a4-9815-6dbef890f1eb",
  "retryable": true,
  "retry_after_seconds": 30
}
```

## 10. Conformance Verification

During implementation, automated contract test suites must enforce:

- Every documented `4xx/5xx` response strictly satisfies OpenAPI `Problem` schema definitions.
- `Content-Type` header, JSON body `status`, and actual HTTP status code are perfectly aligned.
- Response payloads and corresponding server logs share the exact same `request_id`.
- Non-existent and cross-tenant resources produce indistinguishable observable responses.
- Validation error ordering is deterministic and never leaks sensitive input.
- Database constraints, driver errors, and stack traces never leak into public responses.
- `Retry-After`, `retryable`, and idempotency semantics are fully respected.
- Public status tokens never appear in `instance`, `detail`, logs, or metric label dimensions.
