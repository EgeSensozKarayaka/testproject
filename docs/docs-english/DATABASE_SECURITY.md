# Database Security, Row-Level Security (RLS), and Role Architecture

**Status:** Implemented; verified via role/privilege and negative RLS integration test suites  
**Related Document:** [`DATABASE.md`](./DATABASE.md)

## 1. Security Invariant

The core security invariant is:

> A user must never be able to read, mutate, delete, or link another user's private data to their own resources—even if resource IDs are guessed, API query filters are omitted, or incorrect SQL joins are executed.

This invariant is protected through layered defense-in-depth:

1. API command and query layers execute with authenticated owner contexts.
2. Composite foreign keys containing owner IDs prevent cross-tenant linking at the schema level.
3. PostgreSQL Row-Level Security (RLS) restricts row visibility and mutation at the database engine level.
4. Runtime database roles adhere to least privilege and never own database tables.
5. Negative integration test suites validate cross-tenant boundaries across all layers.

RLS does not replace authentication. Authentication resolves session tokens to user identities; authorization and RLS policies enforce access control thereafter.

## 2. PostgreSQL Roles

End users do not map to PostgreSQL login roles. Database migrations provision functional runtime roles configured with `NOLOGIN` and `NOBYPASSRLS`. In local Docker Compose environments, connections open via a single bootstrap login and immediately execute `SET ROLE` to switch to narrow service roles. In production, each service connects using dedicated credentials granted membership only in its specific `NOLOGIN` role. Superuser connections are strictly forbidden at runtime.

| Role                        | Login            | BYPASSRLS        | Purpose                                                                 | Explicitly Revoked Privileges                           |
| --------------------------- | ---------------: | ---------------: | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `site_monitor_schema_owner` | No               | No               | Owns schemas and objects; assumed solely by migrator via `SET ROLE`    | Runtime login, normal application traffic               |
| `site_monitor_migrator`     | No               | No               | Acquires advisory locks and applies migrations; switches to owner role  | Application traffic                                     |
| `site_monitor_api`          | No               | No               | Executes auth bootstrap functions and user-context CRUD under RLS       | DDL, worker queue claims, raw backup dumps              |
| `site_monitor_monitor`      | No               | No               | Manages scheduler, probe jobs/attempts/runs, health state, rollups       | User credentials/sessions, notifications, public secrets|
| `site_monitor_notifier`     | No               | No               | Claims intents/deliveries, inspects policies/recipients/maintenance     | User passwords/sessions, check configs, health states   |
| `site_monitor_predictor`    | No               | No               | Reads security-barrier feature views, writes prediction scores          | Raw URLs, PII, mutating current health or incidents     |
| `site_monitor_public`       | No               | No               | Executes digest-based public snapshot projection functions              | Direct SELECT on private tables and all mutating actions|
| `site_monitor_housekeeper`  | No               | No               | Executes narrow procedures for partitioning, retention, and rebuilds    | General DDL and authentication data                     |
| `site_monitor_realtime`     | No               | No               | Claims/completes REALTIME dispatches and emits redacted wake-up signals | Outbox table access, arbitrary payloads, user data      |
| `site_monitor_backup`       | Deployment-bound | Controlled/Audit | Performs logical backup and restore jobs outside normal runtime         | Application traffic                                     |

Role Invariants:

- No runtime role holds superuser status, object ownership, `CREATEDB`, `CREATEROLE`, `REPLICATION`, or `BYPASSRLS`.
- Runtime roles never inherit permissions from other runtime roles.
- Default schema, table, and function permissions for `PUBLIC` are revoked.
- Default privileges on future tables are deny-by-default; explicit `GRANT` statements are required.
- The schema owner role is `NOLOGIN`. `FORCE ROW LEVEL SECURITY` provides defense-in-depth regardless of owner status.
- Backup credentials are kept out of application runtime secret stores. Managed physical storage snapshots and WAL archiving (PITR) are preferred.

Per PostgreSQL documentation, superusers and roles with `BYPASSRLS` bypass security policies unconditionally; because table owners also bypass RLS by default, enforcing non-owner runtime connections alongside `FORCE ROW LEVEL SECURITY` is mandatory.

## 3. API Tenant Context

Every authenticated API operation executes within an isolated database transaction:

1. `BEGIN`
2. `SELECT set_config('app.current_user_id', $ownerId::text, true)`
3. Optionally `SELECT set_config('app.correlation_id', $correlationId::text, true)`
4. Execute repository queries
5. `COMMIT` or `ROLLBACK`

Passing `true` to `set_config` scopes the setting strictly to the current transaction. When connections return to the pool, tenant context is completely wiped. Private repository queries executed outside transactions are prohibited by architectural linting and integration tests.

RLS Helper Semantics:

```sql
nullif(current_setting('app.current_user_id', true), '')::uuid
```

If tenant context is uninitialized, this expression yields `NULL`, causing default-deny policies to evaluate to false. Malformed UUID values fail safely. Session-scoped `SET` commands are prohibited.

Connection Pooling Rules:

- Maximum connection pools across services are budgeted centrally against PostgreSQL limits.
- Connection checkouts do not initialize tenant context; context is bound only after starting a transaction.
- Timeouts and cancellations trigger immediate rollbacks.
- PgBouncer deployments operate in transaction pooling mode without relying on session state.
- Readiness and health probes query non-private tables and require no tenant context.

## 4. RLS Policy Patterns

### 4.1 Tenant-Owned Private Tables

API policies on private tables follow this structure:

```sql
USING (
  owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid
)
WITH CHECK (
  owner_id = nullif(current_setting('app.current_user_id', true), '')::uuid
)
```

In `auth.users`, `id` is evaluated instead of `owner_id`. The `WITH CHECK` clause ensures users cannot transfer row ownership to another tenant during inserts or updates.

### 4.2 Background Worker Policies

Background workers do not establish user contexts. Role-specific policies grant `USING (true)` and `WITH CHECK (true)` across all tenants on required tables, but access is tightly constrained by granular SQL privilege grants (`GRANT SELECT, UPDATE (...)`).

Examples:

- The monitor worker holds `SELECT` and `UPDATE` on scheduling columns in `app.checks`, and full CRUD on monitoring execution tables.
- The notification worker holds `SELECT` on recipients, policies, maintenance, and incidents, with CRUD on intents and delivery tracking.
- The predictor has zero access to private core tables, reading only security-barrier feature views.
- The housekeeper executes controlled stored procedures owned by the schema owner rather than holding broad table privileges.

Possessing an RLS policy grants zero access unless corresponding table permissions are explicitly granted; both are mandatory.

### 4.3 Partitioned Tables

- RLS is defined on the partitioned parent table.
- Runtime roles receive zero direct privileges on individual child partition tables.
- All DML statements target parent table names.
- Automated tests ensure newly attached partitions inherit parent RLS policies and privilege boundaries.
- Partition tables are owned strictly by `site_monitor_schema_owner`.

## 5. Role and Data Access Matrix

`R` = Read, `I` = Insert, `U` = Update, `D` = Delete, `X` = Execute function/view only.

| Data Domain            | API                    | Monitor                  | Notifier                 | Predictor                | Public | Housekeeper         |
| ---------------------- | ---------------------- | ------------------------ | ------------------------ | ------------------------ | ------ | ------------------- |
| User Profiles          | R/U (RLS)              | –                        | –                        | –                        | –      | purge X             |
| Passwords/Sessions     | X + restricted RLS     | –                        | –                        | –                        | –      | cleanup X           |
| Checks/Groups          | R/I/U/D (RLS)          | R + schedule U           | restricted R view        | feature view             | –      | purge X             |
| Maintenance Windows    | R/I/narrow U + proj X  | R + proj X               | R + proj X               | –                        | –      | cleanup X           |
| Jobs/Attempts          | R where needed (RLS)   | R/I/U                    | –                        | –                        | –      | cleanup X           |
| Runs/Health Intervals  | R (RLS)                | R/I/U                    | restricted R view        | feature view             | –      | partition/rebuild X |
| Incidents/Segments     | R (RLS)                | R/I/U                    | restricted R             | feature view             | –      | cleanup X           |
| Recipients/Policies    | R/I/U/D (RLS)          | –                        | R                        | –                        | –      | cleanup X           |
| Intents/Deliveries     | R (RLS)                | –                        | R/I/U                    | –                        | –      | cleanup X           |
| Idempotency Receipts   | R/I (owner RLS)        | –                        | –                        | –                        | –      | expired D           |
| Outbox/Dispatch Lines  | –                      | destination R/I/U        | destination R/I/U        | destination R/I/U        | –      | cleanup X           |
| Public Config          | R/I/U/D (RLS)          | snapshot refresh event   | –                        | –                        | –      | cleanup X           |
| Public Snapshots       | R/I/U/D (RLS/internal) | refresh X                | –                        | –                        | X      | cleanup X           |
| Metric Rollups         | R (RLS)                | R/I/U                    | –                        | R via view               | –      | rebuild X           |
| Predictions            | R (RLS)                | queue X                  | –                        | R/I/U                    | –      | cleanup X           |
| Audit Log              | R (by product policy)  | I                        | I                        | I                        | –      | partition X         |

If column-level grants prove complex to maintain, identical boundaries are enforced via narrow views and security-definer procedures. Temporary broad schema grants are strictly rejected.

## 6. Authentication Bootstrap Pattern

User-context RLS cannot evaluate until an incoming session token resolves to an owner ID. To avoid granting the API role unrestricted `SELECT` on `auth.sessions` or `password_credentials`, access is mediated via narrow `SECURITY DEFINER` functions in the `security_api` schema.

### 6.1 Bootstrap Functions

| Function                  | Inputs           | Returned Data Payload                                  | Security Defenses                                     |
| ------------------------- | ---------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| `resolve_session`         | Token digest     | Owner ID, session ID, expiry, status, password version | Exact digest match; revoked/expired tokens return zero|
| `lookup_login_credential` | Normalized email | User ID, hash, user/password status/version            | API execution only; external errors remain generic    |
| `consume_one_time_token`  | Purpose + digest | Owner ID and atomic consumption status                 | Row-level lock; enforces single-use consumption       |
| `read_public_snapshot`    | Slug digest      | Public payload and generation timestamp only           | Returns only `PUBLISHED` snapshots                    |

### 6.2 Security-Definer Rules

- Functions are owned by the schema owner; runtime callers hold no ownership privileges.
- Execution sets fixed secure search paths: `SECURITY DEFINER SET search_path = pg_catalog, ...`.
- All object references remain fully schema-qualified.
- Dynamic SQL is prohibited unless parameterized against strict allowlists.
- `PUBLIC EXECUTE` is revoked; execution is granted only to specific functional roles.
- Result sets return minimum scalar fields rather than full table row types.
- Functions never accept caller-supplied owner IDs as authoritative assertions.
- User enumeration risks are mitigated via API contract design and IP-based rate limiting.

## 7. Isolated Feature Surface for Predictor

The predictor consumes a `security_barrier` view or narrow function scrubbed of:

- Target URLs and expected response body markers
- User emails, names, and contact metadata
- Notification recipient addresses
- Session tokens, hashes, and passwords
- Raw probe diagnostic strings
- Public status page token digests

The feature surface exposes only surrogate `owner_id`/`check_id` identifiers, UTC bucket timestamps, latency aggregates, PASS/FAIL counts, availability percentages, and incident metrics. `owner_id` is retained solely for data purging and tenant partitioning, and is never logged by the predictor.

The predictor possesses zero `INSERT`, `UPDATE`, or `DELETE` privileges across `app`, `monitoring.current_state`, `monitoring.incidents`, `notification`, or `public_status` tables. Model faults or malicious scores cannot alter core operational state.

## 8. Public Status Page Trust Boundary

Anonymous public traffic never initializes `app.current_user_id`. The `site_monitor_public` role:

- Holds zero `SELECT` privileges on private tables or views.
- Executes only `security_api.read_public_snapshot(bytea)`.
- Has incoming URL tokens hashed to SHA-256 digests in application memory before hitting the database.
- Receives only `payload`, `payload_schema_version`, and `generated_at`.

Public snapshots are assembled using explicit allowlisted DTOs. Deserializing private entities and deleting private fields is prohibited. Adding new attributes to public snapshots requires formal security review.

## 9. PII, Secrets, and Encryption

- Passwords are encrypted exclusively with Argon2id.
- Sessions, email verification tokens, and public links are stored exclusively as SHA-256 digests.
- Disks, backups, and WAL archives in production enforce platform-level encryption-at-rest; TLS is mandatory in transit.
- Email addresses must be reversible for SMTP delivery. Version 1 relies on RLS, table privileges, encrypted storage, and log redaction rather than application-level envelope encryption.
- Database passwords and connection strings are excluded from Git repositories and migration logs.
- SQL query loggers suppress bind parameters by default.
- Diagnostic fields exclude response bodies, `Authorization`/`Cookie` headers, and URL query secrets.

## 10. Audit Logging and Administrator Access

- The application contains zero "superadmin can view all tenants" backdoors.
- Operational debugging is conducted via time-bounded, audited break-glass roles outside application deployments.
- User mutations, authentication events, policy edits, public page toggles, and authorization failures emit structured audit logs.
- Audit tables are append-only for runtime roles.
- Detailed database constraint errors are scrubbed from public responses and correlated via internal request IDs.

## 11. Mandatory Security Verification Tests

Automated integration test suites enforce:

1. User A cannot read User B's rows on any private table, even when providing User B's IDs.
2. User A cannot link User B's checks to User A's groups, status pages, maintenance windows, or alert policies.
3. Attempting to update `owner_id` to transfer row ownership fails.
4. Queries executed without tenant context return zero rows (default-deny).
5. Tenant context set on a pooled connection never bleeds into subsequent transactions.
6. Transaction rollbacks, timeouts, and cancellations clear tenant context completely.
7. Runtime roles attempting DDL, `SET ROLE`, direct child partition access, or RLS bypass are rejected.
8. The public role cannot read private tables, returning data only for valid slug digests.
9. Rotated or disabled public status tokens cease returning data immediately.
10. The predictor cannot write to core health, incident, check, or notification tables, and cannot view PII.
11. The notification worker cannot access credentials or sessions; the monitor worker cannot access recipient emails or passwords.
12. Security-definer functions resist search-path hijacking and unexpected function overloads.
13. Newly provisioned table partitions inherit parent security policies and privilege boundaries.
14. Backup and restore rehearsals verify complete row recovery without data omission caused by RLS.

## 12. Relevant PostgreSQL Documentation

- [Row Security Policies](https://www.postgresql.org/docs/18/ddl-rowsecurity.html): Default-deny behavior, superuser/BYPASSRLS interactions, and table owner policies.
- [CREATE ROLE](https://www.postgresql.org/docs/18/sql-createrole.html): `NOBYPASSRLS` and role attributes.
- [Configuration Setting Functions](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADMIN-SET): `current_setting(..., true)` and transaction-local `set_config`.
