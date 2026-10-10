import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { Pool, PoolClient } from '@site-monitor/database';
import { withUserTransaction } from '@site-monitor/database';
import {
  classifyCheckChanges,
  DomainValidationError,
  normalizeCheckConfiguration,
  type CheckConfiguration,
  type CheckConfigurationInput,
  type CheckConfigurationPatch,
} from '@site-monitor/domain';

import { ApiProblemError } from './problem.js';
import { createUuidV7 } from './request-id.js';

type ExecutionState = 'ACTIVE' | 'PAUSED';
type FreshnessState = 'FRESH' | 'STALE';
type HealthState = 'DOWN' | 'SUSPECT' | 'UNKNOWN' | 'UP';
type ManualMode = 'DIAGNOSTIC' | 'STATEFUL';

export interface CheckCreateInput {
  expected_body_substring?: string | null;
  expected_status_code: number;
  group_id?: string | null;
  interval_seconds: number;
  name: string;
  timeout_ms: number;
  url: string;
}

export interface CheckPatchInput {
  expected_body_substring?: string | null;
  expected_status_code?: number;
  group_id?: string | null;
  interval_seconds?: number;
  name?: string;
  timeout_ms?: number;
  url?: string;
}

export interface CheckDto {
  created_at: string;
  execution_state: ExecutionState;
  expected_body_substring: string | null;
  expected_status_code: number;
  group_id: string | null;
  id: string;
  interval_seconds: number;
  name: string;
  probe_generation: string;
  resource_version: string;
  schedule_generation: string;
  timeout_ms: number;
  updated_at: string;
  url: string;
}

export interface CurrentStatusDto {
  check_id: string;
  current_incident: {
    confirmed_at: string;
    id: string;
    observation_mode: 'OBSERVED' | 'UNOBSERVED';
    observed_duration_ms: string;
    started_at: string;
  } | null;
  execution_state: ExecutionState;
  freshness_state: FreshnessState;
  health_state: HealthState;
  last_checked_at: string | null;
  last_response_time_ms: number | null;
  maintenance: { active: boolean; until: string | null };
  state_version: string;
}

export interface CheckPageDto {
  data: { check: CheckDto; status: CurrentStatusDto }[];
  page: { has_more: boolean; next_cursor: string | null };
}

export interface CheckListInput {
  cursor?: string;
  executionState?: ExecutionState;
  freshness?: FreshnessState;
  groupId?: string;
  health?: HealthState;
  limit: number;
}

export interface ManualRunReceiptDto {
  check_id: string;
  disposition: 'COALESCED' | 'ENQUEUED';
  mode: ManualMode;
  request_id: string;
  requested_at: string;
}

export interface CheckCreateResult {
  check: CheckDto;
  replayed: boolean;
}

export interface CheckServicePort {
  create: (
    ownerId: string,
    input: CheckCreateInput,
    idempotencyKey: string,
    correlationId: string,
  ) => Promise<CheckCreateResult>;
  delete: (
    ownerId: string,
    checkId: string,
    expectedVersion: string,
    correlationId: string,
  ) => Promise<void>;
  get: (ownerId: string, checkId: string) => Promise<CheckDto>;
  list: (ownerId: string, input: CheckListInput) => Promise<CheckPageDto>;
  pause: (
    ownerId: string,
    checkId: string,
    expectedVersion: string,
    correlationId: string,
  ) => Promise<CheckDto>;
  requestManualRun: (
    ownerId: string,
    checkId: string,
    expectedVersion: string,
    idempotencyKey: string,
    correlationId: string,
  ) => Promise<ManualRunReceiptDto>;
  resume: (
    ownerId: string,
    checkId: string,
    expectedVersion: string,
    correlationId: string,
  ) => Promise<CheckDto>;
  update: (
    ownerId: string,
    checkId: string,
    expectedVersion: string,
    patch: CheckPatchInput,
    correlationId: string,
  ) => Promise<CheckDto>;
}

interface CheckRow {
  created_at: Date | string;
  execution_state: ExecutionState;
  expected_body_substring: string | null;
  expected_status_code: number;
  group_id: string | null;
  id: string;
  interval_seconds: number;
  name: string;
  probe_generation: string;
  resource_version: string;
  schedule_generation: string;
  timeout_ms: number;
  updated_at: Date | string;
  url: string;
}

interface CheckListRow extends CheckRow {
  freshness_state: FreshnessState;
  health_state: HealthState;
  incident_confirmed_at: Date | string | null;
  incident_id: string | null;
  incident_observation_mode: 'OBSERVED' | 'UNOBSERVED' | null;
  incident_observed_duration_ms: string | null;
  incident_started_at: Date | string | null;
  last_accepted_run_finished_at: Date | string | null;
  last_response_time_ms: number | null;
  maintenance_until: Date | string | null;
  state_version: string;
}

interface CursorPayload {
  createdAt: string;
  expiresAt: number;
  filterHash: string;
  id: string;
  version: 1;
}

interface ClosedIncident {
  closedAt: string;
  id: string;
  observedDurationMs: string;
  resourceVersion: string;
  startedAt: string;
}

export interface CheckServiceOptions {
  checkLimit?: number;
  cursorTtlSeconds?: number;
  schedulerGraceSeconds?: number;
  securityKey: Buffer;
}

function instant(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function optionalInstant(value: Date | string | null): string | null {
  return value === null ? null : instant(value);
}

function mapCheck(row: CheckRow): CheckDto {
  return {
    created_at: instant(row.created_at),
    execution_state: row.execution_state,
    expected_body_substring: row.expected_body_substring,
    expected_status_code: row.expected_status_code,
    group_id: row.group_id,
    id: row.id,
    interval_seconds: row.interval_seconds,
    name: row.name,
    probe_generation: String(row.probe_generation),
    resource_version: String(row.resource_version),
    schedule_generation: String(row.schedule_generation),
    timeout_ms: row.timeout_ms,
    updated_at: instant(row.updated_at),
    url: row.url,
  };
}

function mapConfiguration(row: CheckRow): CheckConfiguration {
  return {
    expectedBodySubstring: row.expected_body_substring,
    expectedStatusCode: row.expected_status_code,
    groupId: row.group_id,
    intervalSeconds: row.interval_seconds,
    name: row.name,
    timeoutMs: row.timeout_ms,
    url: row.url,
  };
}

function externalConfiguration(input: CheckCreateInput): CheckConfigurationInput {
  return {
    ...(Object.hasOwn(input, 'expected_body_substring')
      ? { expectedBodySubstring: input.expected_body_substring }
      : {}),
    expectedStatusCode: input.expected_status_code,
    ...(Object.hasOwn(input, 'group_id') ? { groupId: input.group_id } : {}),
    intervalSeconds: input.interval_seconds,
    name: input.name,
    timeoutMs: input.timeout_ms,
    url: input.url,
  };
}

function externalPatch(input: CheckPatchInput): CheckConfigurationPatch {
  return {
    ...(Object.hasOwn(input, 'expected_body_substring')
      ? { expectedBodySubstring: input.expected_body_substring }
      : {}),
    ...(Object.hasOwn(input, 'expected_status_code')
      ? { expectedStatusCode: input.expected_status_code }
      : {}),
    ...(Object.hasOwn(input, 'group_id') ? { groupId: input.group_id } : {}),
    ...(Object.hasOwn(input, 'interval_seconds')
      ? { intervalSeconds: input.interval_seconds }
      : {}),
    ...(Object.hasOwn(input, 'name') ? { name: input.name } : {}),
    ...(Object.hasOwn(input, 'timeout_ms') ? { timeoutMs: input.timeout_ms } : {}),
    ...(Object.hasOwn(input, 'url') ? { url: input.url } : {}),
  };
}

function validationProblem(error: DomainValidationError): ApiProblemError {
  return new ApiProblemError({
    code: 'validation_failed',
    detail: 'One or more fields are invalid.',
    issues: [{ code: error.code, message: error.message, pointer: `/${error.field}` }],
    status: 422,
  });
}

function normalize<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof DomainValidationError) throw validationProblem(error);
    throw error;
  }
}

function digest(key: Buffer, domain: string, value: string): Buffer {
  return createHmac('sha256', key).update(domain).update('\0').update(value).digest();
}

function requestHash(value: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(value)).digest();
}

function resourceNotFound(): ApiProblemError {
  return new ApiProblemError({
    code: 'resource_not_found',
    detail: 'The requested resource was not found.',
    status: 404,
  });
}

function assertVersion(actual: string, expected: string): void {
  if (actual === expected) return;
  throw new ApiProblemError({
    code: 'resource_version_mismatch',
    detail: 'The check changed after it was read.',
    etag: `"rv-${actual}"`,
    status: 412,
  });
}

async function writeEvent(
  client: PoolClient,
  input: {
    aggregateId: string;
    aggregateType: string;
    aggregateVersion: string;
    correlationId: string;
    destinations?: Array<'NOTIFICATION' | 'REALTIME'>;
    eventType: string;
    ownerId: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const eventId = createUuidV7();
  await client.query(
    `INSERT INTO infra.outbox_events
       (id, owner_id, event_type, schema_version, aggregate_type, aggregate_id,
        aggregate_version, correlation_id, occurred_at, payload)
     VALUES ($1, $2, $3, 1, $4, $5, $6, $7, statement_timestamp(), $8::jsonb)`,
    [
      eventId,
      input.ownerId,
      input.eventType,
      input.aggregateType,
      input.aggregateId,
      input.aggregateVersion,
      input.correlationId,
      JSON.stringify(input.payload),
    ],
  );
  for (const destination of input.destinations ?? ['REALTIME']) {
    await client.query(
      `INSERT INTO infra.outbox_dispatches (event_id, destination) VALUES ($1, $2)`,
      [eventId, destination],
    );
  }
}

async function writeAudit(
  client: PoolClient,
  input: {
    action: string;
    correlationId: string;
    metadata?: Record<string, unknown>;
    ownerId: string;
    resourceId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit.events
       (occurred_at, owner_id, actor_type, actor_id, action, resource_type,
        resource_id, correlation_id, result, metadata)
     VALUES (statement_timestamp(), $1::uuid, 'USER', $1::text, $2, 'check', $3, $4,
             'SUCCESS', $5::jsonb)`,
    [
      input.ownerId,
      input.action,
      input.resourceId,
      input.correlationId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function validateLiveGroup(
  client: PoolClient,
  ownerId: string,
  groupId: string | null,
): Promise<void> {
  if (groupId === null) return;
  const result = await client.query(
    `SELECT id FROM app.check_groups
     WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL
     FOR UPDATE`,
    [ownerId, groupId],
  );
  if (!result.rows[0]) throw resourceNotFound();
}

async function cancelActiveJobs(
  client: PoolClient,
  ownerId: string,
  checkId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `UPDATE monitoring.check_jobs
     SET state = 'CANCELLED', completed_at = statement_timestamp(),
         terminal_reason = $3, updated_at = statement_timestamp()
     WHERE owner_id = $1 AND check_id = $2
       AND state IN ('PENDING', 'LEASED', 'RUNNING')`,
    [ownerId, checkId, reason],
  );
}

async function rotateHealthInterval(
  client: PoolClient,
  input: {
    checkId: string;
    openNext: boolean;
    ownerId: string;
    probeGeneration: string;
    source: 'CONFIG' | 'FRESHNESS' | 'PAUSE' | 'RESUME';
  },
): Promise<void> {
  await client.query(
    `INSERT INTO monitoring.health_intervals
       (started_at, id, owner_id, check_id, ended_at, classification,
        probe_generation, source_kind, source_run_id, source_run_finished_at)
     SELECT started_at, id, owner_id, check_id,
            GREATEST(statement_timestamp(), started_at + interval '1 microsecond'),
            CASE WHEN classification = 'PROVISIONAL' THEN 'UNKNOWN' ELSE classification END,
            probe_generation, source_kind, source_run_id, source_run_finished_at
     FROM monitoring.open_health_intervals
     WHERE owner_id = $1 AND check_id = $2
     FOR UPDATE`,
    [input.ownerId, input.checkId],
  );
  await client.query(
    `DELETE FROM monitoring.open_health_intervals WHERE owner_id = $1 AND check_id = $2`,
    [input.ownerId, input.checkId],
  );
  if (input.openNext) {
    await client.query(
      `INSERT INTO monitoring.open_health_intervals
         (owner_id, check_id, classification, started_at, probe_generation, source_kind)
       VALUES ($1, $2, 'UNKNOWN', statement_timestamp(), $3, $4)`,
      [input.ownerId, input.checkId, input.probeGeneration, input.source],
    );
  }
}

async function closeIncident(
  client: PoolClient,
  input: {
    checkId: string;
    correlationId: string;
    ownerId: string;
    reason: 'CHECK_DELETED' | 'CONFIG_CHANGED';
  },
): Promise<ClosedIncident | null> {
  const selected = await client.query<{ id: string }>(
    `SELECT id FROM monitoring.incidents
     WHERE owner_id = $1 AND check_id = $2 AND status = 'OPEN'
     FOR UPDATE`,
    [input.ownerId, input.checkId],
  );
  const incidentId = selected.rows[0]?.id;
  if (!incidentId) return null;
  const segment = await client.query<{ duration_ms: string }>(
    `UPDATE monitoring.incident_segments
     SET ended_at = GREATEST(statement_timestamp(), started_at + interval '1 microsecond'),
         close_reason = $4, updated_at = statement_timestamp()
     WHERE owner_id = $1 AND check_id = $2 AND incident_id = $3 AND ended_at IS NULL
     RETURNING floor(extract(epoch FROM (ended_at - started_at)) * 1000)::bigint::text AS duration_ms`,
    [
      input.ownerId,
      input.checkId,
      incidentId,
      input.reason === 'CHECK_DELETED' ? 'DELETED' : 'CONFIG_CHANGED',
    ],
  );
  const closed = await client.query<{
    closed_at: Date | string;
    id: string;
    observed_duration_ms: string;
    resource_version: string;
    started_at: Date | string;
  }>(
    `UPDATE monitoring.incidents
     SET status = 'CLOSED', closed_at = statement_timestamp(), closure_reason = $4,
         observed_duration_ms = observed_duration_ms + $5::bigint,
         resource_version = resource_version + 1, updated_at = statement_timestamp()
     WHERE owner_id = $1 AND check_id = $2 AND id = $3 AND status = 'OPEN'
     RETURNING id, started_at, closed_at, observed_duration_ms::text,
               resource_version::text`,
    [input.ownerId, input.checkId, incidentId, input.reason, segment.rows[0]?.duration_ms ?? '0'],
  );
  const row = closed.rows[0]!;
  const result = {
    closedAt: instant(row.closed_at),
    id: row.id,
    observedDurationMs: row.observed_duration_ms,
    resourceVersion: row.resource_version,
    startedAt: instant(row.started_at),
  };
  const wallDuration = Math.max(
    0,
    new Date(result.closedAt).getTime() - new Date(result.startedAt).getTime(),
  );
  const maintenance = await client.query<{ active: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM app.maintenance_windows w
       JOIN app.checks c ON c.owner_id = w.owner_id AND c.id = $2
       WHERE w.owner_id = $1 AND w.state = 'SCHEDULED' AND w.cancelled_at IS NULL
         AND w.starts_at <= statement_timestamp() AND w.ends_at > statement_timestamp()
         AND (w.check_id = $2 OR (w.group_id IS NOT NULL AND w.group_id = c.group_id))
     ) AS active`,
    [input.ownerId, input.checkId],
  );
  await writeEvent(client, {
    aggregateId: result.id,
    aggregateType: 'incident',
    aggregateVersion: result.resourceVersion,
    correlationId: input.correlationId,
    destinations: ['NOTIFICATION', 'REALTIME'],
    eventType: 'incident.closed',
    ownerId: input.ownerId,
    payload: {
      check_id: input.checkId,
      closure_reason: input.reason,
      ended_at: result.closedAt,
      incident_id: result.id,
      maintenance_suppressed: maintenance.rows[0]?.active ?? false,
      observed_duration_ms: result.observedDurationMs,
      recovery_run_id: null,
      resource_version: result.resourceVersion,
      started_at: result.startedAt,
      wall_duration_ms: String(wallDuration),
    },
  });
  return result;
}

async function suspendIncident(
  client: PoolClient,
  input: {
    checkId: string;
    correlationId: string;
    ownerId: string;
    reason: 'PAUSED' | 'STALE';
  },
): Promise<void> {
  const selected = await client.query<{ id: string; resource_version: string }>(
    `SELECT id, resource_version::text FROM monitoring.incidents
     WHERE owner_id = $1 AND check_id = $2 AND status = 'OPEN'
       AND observation_mode = 'OBSERVED'
     FOR UPDATE`,
    [input.ownerId, input.checkId],
  );
  const current = selected.rows[0];
  if (!current) return;
  const segment = await client.query<{
    duration_ms: string;
    ended_at: Date | string;
    id: string;
  }>(
    `UPDATE monitoring.incident_segments
     SET ended_at = GREATEST(statement_timestamp(), started_at + interval '1 microsecond'),
         close_reason = $4, updated_at = statement_timestamp()
     WHERE owner_id = $1 AND check_id = $2 AND incident_id = $3 AND ended_at IS NULL
     RETURNING id, ended_at,
               floor(extract(epoch FROM (ended_at - started_at)) * 1000)::bigint::text AS duration_ms`,
    [input.ownerId, input.checkId, current.id, input.reason],
  );
  const changed = await client.query<{ resource_version: string }>(
    `UPDATE monitoring.incidents
     SET observation_mode = 'UNOBSERVED', resource_version = resource_version + 1,
         observed_duration_ms = observed_duration_ms + $4::bigint,
         updated_at = statement_timestamp()
     WHERE owner_id = $1 AND check_id = $2 AND id = $3
     RETURNING resource_version::text`,
    [input.ownerId, input.checkId, current.id, segment.rows[0]?.duration_ms ?? '0'],
  );
  if (segment.rows[0]) {
    await writeEvent(client, {
      aggregateId: current.id,
      aggregateType: 'incident',
      aggregateVersion: changed.rows[0]!.resource_version,
      correlationId: input.correlationId,
      eventType: 'incident.observation_suspended',
      ownerId: input.ownerId,
      payload: {
        check_id: input.checkId,
        incident_id: current.id,
        reason_code: input.reason,
        resource_version: changed.rows[0]!.resource_version,
        segment_id: segment.rows[0].id,
        suspended_at: instant(segment.rows[0].ended_at),
      },
    });
  }
}

export class CheckService implements CheckServicePort {
  readonly #checkLimit: number;
  readonly #cursorTtlSeconds: number;
  readonly #pool: Pool;
  readonly #schedulerGraceSeconds: number;
  readonly #securityKey: Buffer;

  constructor(pool: Pool, options: CheckServiceOptions) {
    this.#pool = pool;
    this.#securityKey = options.securityKey;
    this.#checkLimit = options.checkLimit ?? 500;
    this.#cursorTtlSeconds = options.cursorTtlSeconds ?? 900;
    this.#schedulerGraceSeconds = options.schedulerGraceSeconds ?? 5;
  }

  async create(
    ownerId: string,
    input: CheckCreateInput,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<CheckCreateResult> {
    const configuration = normalize(() =>
      normalizeCheckConfiguration(externalConfiguration(input)),
    );
    const subjectDigest = digest(this.#securityKey, 'check-create-subject', ownerId);
    const keyDigest = digest(this.#securityKey, 'check-create-key', idempotencyKey);
    const hash = requestHash(configuration);

    return withUserTransaction(this.#pool, ownerId, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `check-create:${keyDigest.toString('hex')}`,
      ]);
      const existing = await client.query<{ request_hash: Buffer; response_body: CheckDto }>(
        `SELECT request_hash, response_body
         FROM infra.api_idempotency_records
         WHERE owner_id = $1 AND subject_digest = $2
           AND operation = 'check.create' AND key_digest = $3`,
        [ownerId, subjectDigest, keyDigest],
      );
      const receipt = existing.rows[0];
      if (receipt) {
        if (!timingSafeEqual(receipt.request_hash, hash)) {
          throw new ApiProblemError({
            code: 'idempotency_key_reused',
            detail: 'The idempotency key was already used with a different request.',
            status: 409,
          });
        }
        return { check: receipt.response_body, replayed: true };
      }

      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `quota:checks:${ownerId}`,
      ]);
      if (this.#checkLimit > 0) {
        const count = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM app.checks
           WHERE owner_id = $1 AND lifecycle_state = 'LIVE'`,
          [ownerId],
        );
        if (BigInt(count.rows[0]?.count ?? '0') >= BigInt(this.#checkLimit)) {
          throw new ApiProblemError({
            code: 'quota_exceeded',
            detail: 'The deployment check quota has been reached.',
            status: 409,
          });
        }
      }
      await validateLiveGroup(client, ownerId, configuration.groupId);

      const checkId = createUuidV7();
      const jitterMs =
        digest(this.#securityKey, 'check-startup-jitter', checkId).readUInt16BE() % 5001;
      const inserted = await client.query<CheckRow>(
        `INSERT INTO app.checks
           (id, owner_id, group_id, name, url, interval_seconds, timeout_ms,
            expected_status_code, expected_body_substring, next_run_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 statement_timestamp() + ($10::int * interval '1 millisecond'))
         RETURNING id, group_id, name, url, interval_seconds, timeout_ms,
                   expected_status_code, expected_body_substring, execution_state,
                   resource_version::text, probe_generation::text,
                   schedule_generation::text, created_at, updated_at`,
        [
          checkId,
          ownerId,
          configuration.groupId,
          configuration.name,
          configuration.url,
          configuration.intervalSeconds,
          configuration.timeoutMs,
          configuration.expectedStatusCode,
          configuration.expectedBodySubstring,
          jitterMs,
        ],
      );
      const check = mapCheck(inserted.rows[0]!);
      await client.query(
        `INSERT INTO monitoring.check_current_states (owner_id, check_id) VALUES ($1, $2)`,
        [ownerId, check.id],
      );
      await client.query(
        `INSERT INTO monitoring.open_health_intervals
           (owner_id, check_id, classification, started_at, probe_generation, source_kind)
         VALUES ($1, $2, 'UNKNOWN', statement_timestamp(), 1, 'STARTUP')`,
        [ownerId, check.id],
      );
      await writeEvent(client, {
        aggregateId: check.id,
        aggregateType: 'check',
        aggregateVersion: check.resource_version,
        correlationId,
        eventType: 'check.created',
        ownerId,
        payload: {
          check_id: check.id,
          execution_state: check.execution_state,
          group_id: check.group_id,
          probe_generation: check.probe_generation,
          resource_version: check.resource_version,
          schedule_generation: check.schedule_generation,
        },
      });
      await writeAudit(client, {
        action: 'check.created',
        correlationId,
        ownerId,
        resourceId: check.id,
      });
      await client.query(
        `INSERT INTO infra.api_idempotency_records
           (owner_id, subject_digest, operation, key_digest, request_hash,
            response_status, response_headers, response_body, expires_at)
         VALUES ($1, $2, 'check.create', $3, $4, 201,
                 jsonb_build_object('Location', $5::text, 'ETag', $6::text),
                 $7::jsonb, statement_timestamp() + interval '24 hours')`,
        [
          ownerId,
          subjectDigest,
          keyDigest,
          hash,
          `/api/v1/checks/${check.id}`,
          `"rv-${check.resource_version}"`,
          JSON.stringify(check),
        ],
      );
      return { check, replayed: false };
    });
  }

  async get(ownerId: string, checkId: string): Promise<CheckDto> {
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      const result = await client.query<CheckRow>(
        `${this.#checkSelect}
         WHERE owner_id = $1 AND id = $2 AND lifecycle_state = 'LIVE'`,
        [ownerId, checkId],
      );
      if (!result.rows[0]) throw resourceNotFound();
      return mapCheck(result.rows[0]);
    });
  }

  async list(ownerId: string, input: CheckListInput): Promise<CheckPageDto> {
    const filterHash = this.#filterHash(input);
    const cursor = input.cursor ? this.#decodeCursor(input.cursor, filterHash) : undefined;
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      const result = await client.query<CheckListRow>(
        `SELECT c.id, c.group_id, c.name, c.url, c.interval_seconds, c.timeout_ms,
                c.expected_status_code, c.expected_body_substring, c.execution_state,
                c.resource_version::text, c.probe_generation::text,
                c.schedule_generation::text, c.created_at, c.updated_at,
                s.freshness_state,
                CASE WHEN c.execution_state = 'PAUSED' OR s.freshness_state = 'STALE'
                     THEN 'UNKNOWN' ELSE s.health_state END AS health_state,
                s.last_response_time_ms, s.last_accepted_run_finished_at,
                s.state_version::text, maintenance.ends_at AS maintenance_until,
                i.id AS incident_id, i.started_at AS incident_started_at,
                i.confirmed_at AS incident_confirmed_at,
                i.observation_mode AS incident_observation_mode,
                CASE WHEN i.id IS NULL THEN NULL ELSE
                  (i.observed_duration_ms + CASE
                    WHEN i.observation_mode = 'OBSERVED' AND seg.started_at IS NOT NULL
                    THEN floor(extract(epoch FROM (statement_timestamp() - seg.started_at)) * 1000)::bigint
                    ELSE 0 END)::text END AS incident_observed_duration_ms
         FROM app.checks c
         JOIN monitoring.check_current_states s
           ON s.owner_id = c.owner_id AND s.check_id = c.id
         LEFT JOIN monitoring.incidents i
           ON i.owner_id = s.owner_id AND i.id = s.open_incident_id AND i.status = 'OPEN'
         LEFT JOIN monitoring.incident_segments seg
           ON seg.owner_id = i.owner_id AND seg.incident_id = i.id AND seg.ended_at IS NULL
         LEFT JOIN LATERAL (
           SELECT max(w.ends_at) AS ends_at
           FROM app.maintenance_windows w
           WHERE w.owner_id = c.owner_id AND w.state = 'SCHEDULED' AND w.cancelled_at IS NULL
             AND w.starts_at <= statement_timestamp() AND w.ends_at > statement_timestamp()
             AND (w.check_id = c.id OR (w.group_id IS NOT NULL AND w.group_id = c.group_id))
         ) maintenance ON true
         WHERE c.owner_id = $1 AND c.lifecycle_state = 'LIVE'
           AND ($2::timestamptz IS NULL OR (c.created_at, c.id) < ($2::timestamptz, $3::uuid))
           AND ($4::uuid IS NULL OR c.group_id = $4)
           AND ($5::text IS NULL OR c.execution_state = $5)
           AND ($6::text IS NULL OR
                CASE WHEN c.execution_state = 'PAUSED' OR s.freshness_state = 'STALE'
                     THEN 'UNKNOWN' ELSE s.health_state END = $6)
           AND ($7::text IS NULL OR s.freshness_state = $7)
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT $8`,
        [
          ownerId,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          input.groupId ?? null,
          input.executionState ?? null,
          input.health ?? null,
          input.freshness ?? null,
          input.limit + 1,
        ],
      );
      const hasMore = result.rows.length > input.limit;
      const rows = result.rows.slice(0, input.limit);
      const last = rows.at(-1);
      return {
        data: rows.map((row) => ({
          check: mapCheck(row),
          status: {
            check_id: row.id,
            current_incident: row.incident_id
              ? {
                  confirmed_at: instant(row.incident_confirmed_at!),
                  id: row.incident_id,
                  observation_mode: row.incident_observation_mode!,
                  observed_duration_ms: row.incident_observed_duration_ms!,
                  started_at: instant(row.incident_started_at!),
                }
              : null,
            execution_state: row.execution_state,
            freshness_state: row.freshness_state,
            health_state: row.health_state,
            last_checked_at: optionalInstant(row.last_accepted_run_finished_at),
            last_response_time_ms: row.last_response_time_ms,
            maintenance: {
              active: row.maintenance_until !== null,
              until: optionalInstant(row.maintenance_until),
            },
            state_version: String(row.state_version),
          },
        })),
        page: {
          has_more: hasMore,
          next_cursor:
            hasMore && last
              ? this.#encodeCursor({
                  createdAt: instant(last.created_at),
                  expiresAt: Math.floor(Date.now() / 1000) + this.#cursorTtlSeconds,
                  filterHash,
                  id: last.id,
                  version: 1,
                })
              : null,
        },
      };
    });
  }

  async update(
    ownerId: string,
    checkId: string,
    expectedVersion: string,
    patch: CheckPatchInput,
    correlationId: string,
  ): Promise<CheckDto> {
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      const preparedGroupId = Object.hasOwn(patch, 'group_id')
        ? await this.#prepareGroupChange(client, ownerId, checkId, patch.group_id ?? null)
        : undefined;
      const current = await this.#lockCheck(client, ownerId, checkId);
      assertVersion(current.resource_version, expectedVersion);
      if (preparedGroupId !== undefined && current.group_id !== preparedGroupId) {
        throw new ApiProblemError({
          code: 'resource_conflict',
          detail: 'The check group changed while the update was being prepared.',
          status: 409,
        });
      }
      const changes = normalize(() =>
        classifyCheckChanges(mapConfiguration(current), externalPatch(patch)),
      );
      if (changes.noop) return mapCheck(current);
      if (changes.probeChanged || changes.scheduleChanged) {
        await this.#lockCurrentState(client, ownerId, checkId);
      }

      const jitterMs = this.#jitterMs(checkId);
      const updated = await client.query<CheckRow>(
        `UPDATE app.checks
         SET group_id = $3, name = $4, url = $5, interval_seconds = $6::smallint,
             timeout_ms = $7, expected_status_code = $8, expected_body_substring = $9,
             resource_version = resource_version + 1,
             probe_generation = probe_generation + $10::int,
             schedule_generation = schedule_generation + $11::int,
             cadence_anchor_at = CASE WHEN $11::int = 1 THEN statement_timestamp()
                                      ELSE cadence_anchor_at END,
             next_run_at = CASE
               WHEN execution_state = 'PAUSED' THEN NULL
               WHEN $10::int = 1 THEN statement_timestamp() + ($12::int * interval '1 millisecond')
               WHEN $11::int = 1 THEN statement_timestamp() + ($6::smallint * interval '1 second')
               ELSE next_run_at END,
             updated_at = statement_timestamp()
         WHERE owner_id = $1 AND id = $2 AND lifecycle_state = 'LIVE'
         RETURNING id, group_id, name, url, interval_seconds, timeout_ms,
                   expected_status_code, expected_body_substring, execution_state,
                   resource_version::text, probe_generation::text,
                   schedule_generation::text, created_at, updated_at`,
        [
          ownerId,
          checkId,
          changes.next.groupId,
          changes.next.name,
          changes.next.url,
          changes.next.intervalSeconds,
          changes.next.timeoutMs,
          changes.next.expectedStatusCode,
          changes.next.expectedBodySubstring,
          changes.probeChanged ? 1 : 0,
          changes.scheduleChanged ? 1 : 0,
          jitterMs,
        ],
      );
      const check = mapCheck(updated.rows[0]!);
      if (changes.probeChanged || changes.scheduleChanged) {
        await cancelActiveJobs(client, ownerId, checkId, 'CONFIGURATION_CHANGED');
      }
      if (changes.probeChanged) {
        await closeIncident(client, {
          checkId,
          correlationId,
          ownerId,
          reason: 'CONFIG_CHANGED',
        });
        await client.query(
          `UPDATE monitoring.check_current_states
           SET health_state = 'UNKNOWN', freshness_state = 'STALE',
               consecutive_failure_count = 0, candidate_started_at = NULL,
               candidate_run_id = NULL, candidate_run_finished_at = NULL,
               open_incident_id = NULL, fresh_until = NULL, stale_reconciled_at = NULL,
               state_version = state_version + 1, updated_at = statement_timestamp()
           WHERE owner_id = $1 AND check_id = $2
           RETURNING freshness_state`,
          [ownerId, checkId],
        );
        await rotateHealthInterval(client, {
          checkId,
          openNext: true,
          ownerId,
          probeGeneration: check.probe_generation,
          source: 'CONFIG',
        });
      } else if (changes.scheduleChanged) {
        const state = await client.query<{ freshness_state: FreshnessState }>(
          `UPDATE monitoring.check_current_states
           SET fresh_until = CASE WHEN last_accepted_run_finished_at IS NULL THEN NULL
                                  ELSE last_accepted_run_finished_at
                                    + ($3::int * interval '1 second')
                                    + ($4::int * interval '1 millisecond')
                                    + ($5::int * interval '1 second') END,
               freshness_state = CASE
                 WHEN last_accepted_run_finished_at IS NULL THEN 'STALE'
                 WHEN last_accepted_run_finished_at
                        + ($3::int * interval '1 second')
                        + ($4::int * interval '1 millisecond')
                        + ($5::int * interval '1 second') > statement_timestamp()
                   THEN 'FRESH' ELSE 'STALE' END,
               state_version = state_version + 1, updated_at = statement_timestamp()
           WHERE owner_id = $1 AND check_id = $2
           RETURNING freshness_state`,
          [
            ownerId,
            checkId,
            changes.next.intervalSeconds,
            changes.next.timeoutMs,
            this.#schedulerGraceSeconds,
          ],
        );
        if (state.rows[0]?.freshness_state === 'STALE') {
          await suspendIncident(client, {
            checkId,
            correlationId,
            ownerId,
            reason: 'STALE',
          });
          const interval = await client.query<{ classification: string }>(
            `SELECT classification FROM monitoring.open_health_intervals
             WHERE owner_id = $1 AND check_id = $2`,
            [ownerId, checkId],
          );
          if (interval.rows[0]?.classification !== 'UNKNOWN') {
            await rotateHealthInterval(client, {
              checkId,
              openNext: true,
              ownerId,
              probeGeneration: check.probe_generation,
              source: 'FRESHNESS',
            });
          }
        }
      }

      await this.#writeChangeEvents(
        client,
        ownerId,
        current,
        check,
        changes.changedFields,
        {
          groupChanged: changes.groupChanged,
          metadataChanged: changes.metadataChanged,
          probeChanged: changes.probeChanged,
          scheduleChanged: changes.scheduleChanged,
        },
        correlationId,
      );
      await writeAudit(client, {
        action: 'check.updated',
        correlationId,
        metadata: { changed_fields: changes.changedFields },
        ownerId,
        resourceId: checkId,
      });
      return check;
    });
  }

  async pause(
    ownerId: string,
    checkId: string,
    expectedVersion: string,
    correlationId: string,
  ): Promise<CheckDto> {
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      const current = await this.#lockCheck(client, ownerId, checkId);
      assertVersion(current.resource_version, expectedVersion);
      if (current.execution_state === 'PAUSED') return mapCheck(current);
      await this.#lockCurrentState(client, ownerId, checkId);
      const updated = await client.query<CheckRow>(
        `UPDATE app.checks
         SET execution_state = 'PAUSED', resource_version = resource_version + 1,
             schedule_generation = schedule_generation + 1, next_run_at = NULL,
             updated_at = statement_timestamp()
         WHERE owner_id = $1 AND id = $2 AND lifecycle_state = 'LIVE'
         RETURNING id, group_id, name, url, interval_seconds, timeout_ms,
                   expected_status_code, expected_body_substring, execution_state,
                   resource_version::text, probe_generation::text,
                   schedule_generation::text, created_at, updated_at`,
        [ownerId, checkId],
      );
      const check = mapCheck(updated.rows[0]!);
      await cancelActiveJobs(client, ownerId, checkId, 'CHECK_PAUSED');
      await suspendIncident(client, {
        checkId,
        correlationId,
        ownerId,
        reason: 'PAUSED',
      });
      await client.query(
        `UPDATE monitoring.check_current_states
         SET freshness_state = 'STALE', consecutive_failure_count = 0,
             candidate_started_at = NULL, candidate_run_id = NULL,
             candidate_run_finished_at = NULL, fresh_until = NULL,
             stale_reconciled_at = NULL, state_version = state_version + 1,
             updated_at = statement_timestamp()
         WHERE owner_id = $1 AND check_id = $2`,
        [ownerId, checkId],
      );
      await rotateHealthInterval(client, {
        checkId,
        openNext: true,
        ownerId,
        probeGeneration: check.probe_generation,
        source: 'PAUSE',
      });
      await writeEvent(client, {
        aggregateId: checkId,
        aggregateType: 'check',
        aggregateVersion: check.resource_version,
        correlationId,
        eventType: 'check.paused',
        ownerId,
        payload: {
          check_id: checkId,
          paused_at: check.updated_at,
          probe_generation: check.probe_generation,
          resource_version: check.resource_version,
          schedule_generation: check.schedule_generation,
        },
      });
      await writeAudit(client, {
        action: 'check.paused',
        correlationId,
        ownerId,
        resourceId: checkId,
      });
      return check;
    });
  }

  async resume(
    ownerId: string,
    checkId: string,
    expectedVersion: string,
    correlationId: string,
  ): Promise<CheckDto> {
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      const current = await this.#lockCheck(client, ownerId, checkId);
      assertVersion(current.resource_version, expectedVersion);
      if (current.execution_state === 'ACTIVE') return mapCheck(current);
      await this.#lockCurrentState(client, ownerId, checkId);
      const nextRun = await client.query<CheckRow & { next_run_at: Date | string }>(
        `UPDATE app.checks
         SET execution_state = 'ACTIVE', resource_version = resource_version + 1,
             schedule_generation = schedule_generation + 1,
             cadence_anchor_at = statement_timestamp(),
             next_run_at = statement_timestamp() + ($3::int * interval '1 millisecond'),
             updated_at = statement_timestamp()
         WHERE owner_id = $1 AND id = $2 AND lifecycle_state = 'LIVE'
         RETURNING id, group_id, name, url, interval_seconds, timeout_ms,
                   expected_status_code, expected_body_substring, execution_state,
                   resource_version::text, probe_generation::text,
                   schedule_generation::text, created_at, updated_at, next_run_at`,
        [ownerId, checkId, this.#jitterMs(checkId)],
      );
      const check = mapCheck(nextRun.rows[0]!);
      await client.query(
        `UPDATE monitoring.check_current_states
         SET freshness_state = 'STALE', fresh_until = NULL, stale_reconciled_at = NULL,
             state_version = state_version + 1, updated_at = statement_timestamp()
         WHERE owner_id = $1 AND check_id = $2`,
        [ownerId, checkId],
      );
      await rotateHealthInterval(client, {
        checkId,
        openNext: true,
        ownerId,
        probeGeneration: check.probe_generation,
        source: 'RESUME',
      });
      await writeEvent(client, {
        aggregateId: checkId,
        aggregateType: 'check',
        aggregateVersion: check.resource_version,
        correlationId,
        eventType: 'check.resumed',
        ownerId,
        payload: {
          check_id: checkId,
          next_run_at: instant(nextRun.rows[0]!.next_run_at),
          probe_generation: check.probe_generation,
          resource_version: check.resource_version,
          resumed_at: check.updated_at,
          schedule_generation: check.schedule_generation,
        },
      });
      await writeAudit(client, {
        action: 'check.resumed',
        correlationId,
        ownerId,
        resourceId: checkId,
      });
      return check;
    });
  }

  async delete(
    ownerId: string,
    checkId: string,
    expectedVersion: string,
    correlationId: string,
  ): Promise<void> {
    await withUserTransaction(this.#pool, ownerId, async (client) => {
      const current = await this.#lockCheck(client, ownerId, checkId);
      assertVersion(current.resource_version, expectedVersion);
      await this.#lockCurrentState(client, ownerId, checkId);
      await cancelActiveJobs(client, ownerId, checkId, 'CHECK_DELETED');
      await closeIncident(client, {
        checkId,
        correlationId,
        ownerId,
        reason: 'CHECK_DELETED',
      });
      const deleted = await client.query<{
        deleted_at: Date | string;
        resource_version: string;
      }>(
        `UPDATE app.checks
         SET lifecycle_state = 'DELETED', deleted_at = statement_timestamp(),
             execution_state = 'PAUSED', next_run_at = NULL, manual_requested_at = NULL,
             resource_version = resource_version + 1,
             schedule_generation = schedule_generation + 1,
             updated_at = statement_timestamp()
         WHERE owner_id = $1 AND id = $2 AND lifecycle_state = 'LIVE'
         RETURNING deleted_at, resource_version::text`,
        [ownerId, checkId],
      );
      await client.query(
        `UPDATE monitoring.check_current_states
         SET health_state = 'UNKNOWN', freshness_state = 'STALE',
             consecutive_failure_count = 0, candidate_started_at = NULL,
             candidate_run_id = NULL, candidate_run_finished_at = NULL,
             open_incident_id = NULL, fresh_until = NULL, stale_reconciled_at = NULL,
             state_version = state_version + 1, updated_at = statement_timestamp()
         WHERE owner_id = $1 AND check_id = $2`,
        [ownerId, checkId],
      );
      await rotateHealthInterval(client, {
        checkId,
        openNext: false,
        ownerId,
        probeGeneration: current.probe_generation,
        source: 'CONFIG',
      });
      const row = deleted.rows[0]!;
      await writeEvent(client, {
        aggregateId: checkId,
        aggregateType: 'check',
        aggregateVersion: row.resource_version,
        correlationId,
        eventType: 'check.deleted',
        ownerId,
        payload: {
          check_id: checkId,
          deleted_at: instant(row.deleted_at),
          resource_version: row.resource_version,
        },
      });
      await writeAudit(client, {
        action: 'check.deleted',
        correlationId,
        ownerId,
        resourceId: checkId,
      });
    });
  }

  async requestManualRun(
    ownerId: string,
    checkId: string,
    expectedVersion: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<ManualRunReceiptDto> {
    const subjectDigest = digest(
      this.#securityKey,
      'check-manual-subject',
      `${ownerId}:${checkId}`,
    );
    const keyDigest = digest(this.#securityKey, 'check-manual-key', idempotencyKey);
    const hash = requestHash({ checkId, expectedVersion });
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `check-manual:${keyDigest.toString('hex')}`,
      ]);
      const existing = await client.query<{
        request_hash: Buffer;
        response_body: ManualRunReceiptDto;
      }>(
        `SELECT request_hash, response_body
         FROM infra.api_idempotency_records
         WHERE owner_id = $1 AND subject_digest = $2
           AND operation = 'check.manual_run' AND key_digest = $3`,
        [ownerId, subjectDigest, keyDigest],
      );
      const stored = existing.rows[0];
      if (stored) {
        if (!timingSafeEqual(stored.request_hash, hash)) {
          throw new ApiProblemError({
            code: 'idempotency_key_reused',
            detail: 'The idempotency key was already used with a different request.',
            status: 409,
          });
        }
        return stored.response_body;
      }

      const current = await this.#lockCheck(client, ownerId, checkId);
      assertVersion(current.resource_version, expectedVersion);
      const active = await client.query<{ id: string }>(
        `SELECT id FROM monitoring.check_jobs
         WHERE owner_id = $1 AND check_id = $2
           AND state IN ('PENDING', 'LEASED', 'RUNNING')
         FOR UPDATE`,
        [ownerId, checkId],
      );
      const mode: ManualMode = current.execution_state === 'ACTIVE' ? 'STATEFUL' : 'DIAGNOSTIC';
      const requestId = createUuidV7();
      const requested = await client.query<{ requested_at: Date | string }>(
        `SELECT statement_timestamp() AS requested_at`,
      );
      const requestedAt = instant(requested.rows[0]!.requested_at);
      const disposition = active.rows[0] ? 'COALESCED' : 'ENQUEUED';
      if (disposition === 'ENQUEUED') {
        await client.query(
          `INSERT INTO monitoring.check_jobs
             (id, owner_id, check_id, trigger_kind, manual_mode, scheduled_for,
              available_at, priority, state, config_snapshot, resource_version,
              probe_generation, schedule_generation)
           VALUES ($1, $2, $3, 'MANUAL', $4, statement_timestamp(),
                   statement_timestamp(), 100, 'PENDING', $5::jsonb, $6, $7, $8)`,
          [
            requestId,
            ownerId,
            checkId,
            mode,
            JSON.stringify({
              schema_version: 1,
              expected_body_substring: current.expected_body_substring,
              expected_status_code: current.expected_status_code,
              interval_seconds: current.interval_seconds,
              timeout_ms: current.timeout_ms,
              url: current.url,
            }),
            current.resource_version,
            current.probe_generation,
            current.schedule_generation,
          ],
        );
      } else {
        await client.query(
          `UPDATE app.checks
           SET manual_requested_at = COALESCE(manual_requested_at, statement_timestamp()),
               updated_at = updated_at
           WHERE owner_id = $1 AND id = $2 AND lifecycle_state = 'LIVE'`,
          [ownerId, checkId],
        );
      }
      const receipt: ManualRunReceiptDto = {
        check_id: checkId,
        disposition,
        mode,
        request_id: requestId,
        requested_at: requestedAt,
      };
      await writeEvent(client, {
        aggregateId: checkId,
        aggregateType: 'check',
        aggregateVersion: current.resource_version,
        correlationId,
        eventType: 'check.manual_run_requested',
        ownerId,
        payload: {
          check_id: checkId,
          mode,
          probe_generation: current.probe_generation,
          request_id: requestId,
          requested_at: requestedAt,
          schedule_generation: current.schedule_generation,
        },
      });
      await writeAudit(client, {
        action: 'check.manual_run_requested',
        correlationId,
        metadata: { disposition, mode },
        ownerId,
        resourceId: checkId,
      });
      await client.query(
        `INSERT INTO infra.api_idempotency_records
           (owner_id, subject_digest, operation, key_digest, request_hash,
            response_status, response_headers, response_body, expires_at)
         VALUES ($1, $2, 'check.manual_run', $3, $4, 202,
                 '{}'::jsonb, $5::jsonb,
                 statement_timestamp() + interval '24 hours')`,
        [ownerId, subjectDigest, keyDigest, hash, JSON.stringify(receipt)],
      );
      return receipt;
    });
  }

  readonly #checkSelect = `SELECT id, group_id, name, url, interval_seconds, timeout_ms,
      expected_status_code, expected_body_substring, execution_state,
      resource_version::text, probe_generation::text, schedule_generation::text,
      created_at, updated_at FROM app.checks`;

  async #lockCheck(client: PoolClient, ownerId: string, checkId: string): Promise<CheckRow> {
    const result = await client.query<CheckRow>(
      `${this.#checkSelect}
       WHERE owner_id = $1 AND id = $2 AND lifecycle_state = 'LIVE'
       FOR UPDATE`,
      [ownerId, checkId],
    );
    if (!result.rows[0]) throw resourceNotFound();
    return result.rows[0];
  }

  async #lockCurrentState(
    client: PoolClient,
    ownerId: string,
    checkId: string,
  ): Promise<{ freshness_state: FreshnessState }> {
    const result = await client.query<{ freshness_state: FreshnessState }>(
      `SELECT freshness_state FROM monitoring.check_current_states
       WHERE owner_id = $1 AND check_id = $2 FOR UPDATE`,
      [ownerId, checkId],
    );
    if (!result.rows[0]) throw resourceNotFound();
    return result.rows[0];
  }

  async #prepareGroupChange(
    client: PoolClient,
    ownerId: string,
    checkId: string,
    targetGroupId: string | null,
  ): Promise<string | null> {
    const snapshot = await client.query<{ group_id: string | null }>(
      `SELECT group_id FROM app.checks
       WHERE owner_id = $1 AND id = $2 AND lifecycle_state = 'LIVE'`,
      [ownerId, checkId],
    );
    if (!snapshot.rows[0]) throw resourceNotFound();
    const previousGroupId = snapshot.rows[0].group_id;
    const groupIds = [previousGroupId, targetGroupId]
      .filter((id): id is string => id !== null)
      .filter((id, index, values) => values.indexOf(id) === index)
      .sort();
    if (groupIds.length > 0) {
      const locked = await client.query<{ id: string }>(
        `SELECT id FROM app.check_groups
         WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
         ORDER BY id FOR UPDATE`,
        [ownerId, groupIds],
      );
      if (targetGroupId !== null && !locked.rows.some((row) => row.id === targetGroupId)) {
        throw resourceNotFound();
      }
    }
    return previousGroupId;
  }

  #jitterMs(checkId: string): number {
    return digest(this.#securityKey, 'check-startup-jitter', checkId).readUInt16BE() % 5001;
  }

  #filterHash(input: CheckListInput): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          executionState: input.executionState ?? null,
          freshness: input.freshness ?? null,
          groupId: input.groupId ?? null,
          health: input.health ?? null,
          limit: input.limit,
        }),
      )
      .digest('base64url');
  }

  #encodeCursor(payload: CursorPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = digest(this.#securityKey, 'check-list-cursor', body).toString('base64url');
    return `${body}.${signature}`;
  }

  #decodeCursor(value: string, filterHash: string): CursorPayload {
    try {
      const [body, signature, extra] = value.split('.');
      if (!body || !signature || extra) throw new Error('invalid parts');
      const actual = Buffer.from(signature, 'base64url');
      const expected = digest(this.#securityKey, 'check-list-cursor', body);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new Error('invalid signature');
      }
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CursorPayload;
      if (
        payload.version !== 1 ||
        payload.filterHash !== filterHash ||
        typeof payload.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(payload.createdAt)) ||
        typeof payload.id !== 'string' ||
        !/^[0-9a-f-]{36}$/u.test(payload.id) ||
        !Number.isInteger(payload.expiresAt) ||
        payload.expiresAt < Math.floor(Date.now() / 1000)
      ) {
        throw new Error('invalid payload');
      }
      return payload;
    } catch {
      throw new ApiProblemError({
        code: 'invalid_cursor',
        detail: 'The page cursor is invalid, expired, or does not match the filters.',
        status: 400,
      });
    }
  }

  async #writeChangeEvents(
    client: PoolClient,
    ownerId: string,
    previous: CheckRow,
    check: CheckDto,
    changedFields: string[],
    kinds: {
      groupChanged: boolean;
      metadataChanged: boolean;
      probeChanged: boolean;
      scheduleChanged: boolean;
    },
    correlationId: string,
  ): Promise<void> {
    const base = {
      aggregateId: check.id,
      aggregateType: 'check',
      aggregateVersion: check.resource_version,
      correlationId,
      ownerId,
    };
    if (kinds.metadataChanged) {
      await writeEvent(client, {
        ...base,
        eventType: 'check.metadata_changed',
        payload: {
          changed_fields: changedFields.filter((field) => field === 'name'),
          check_id: check.id,
          resource_version: check.resource_version,
        },
      });
    }
    if (kinds.groupChanged) {
      await writeEvent(client, {
        ...base,
        eventType: 'check.group_changed',
        payload: {
          check_id: check.id,
          group_id: check.group_id,
          previous_group_id: previous.group_id,
          resource_version: check.resource_version,
        },
      });
    }
    if (kinds.probeChanged) {
      await writeEvent(client, {
        ...base,
        eventType: 'check.probe_configuration_changed',
        payload: {
          changed_fields: changedFields.filter((field) =>
            ['expected_body_substring', 'expected_status_code', 'timeout_ms', 'url'].includes(
              field,
            ),
          ),
          check_id: check.id,
          previous_probe_generation: previous.probe_generation,
          probe_generation: check.probe_generation,
          resource_version: check.resource_version,
        },
      });
    }
    if (kinds.scheduleChanged) {
      await writeEvent(client, {
        ...base,
        eventType: 'check.schedule_changed',
        payload: {
          check_id: check.id,
          interval_seconds: check.interval_seconds,
          previous_schedule_generation: previous.schedule_generation,
          resource_version: check.resource_version,
          schedule_generation: check.schedule_generation,
        },
      });
    }
  }
}
