import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { Pool, PoolClient } from '@site-monitor/database';
import { withUserTransaction, writeActivatedOutboxEvent } from '@site-monitor/database';
import {
  classifyMaintenanceChanges,
  deriveMaintenanceState,
  DomainValidationError,
  MaintenanceWindowImmutableError,
  normalizeMaintenanceConfiguration,
  normalizeMaintenanceConfigurationRange,
  type MaintenanceEffectiveState,
  type MaintenanceStoredState,
} from '@site-monitor/domain';

import { ApiProblemError } from './problem.js';

export type MaintenanceTargetType = 'CHECK' | 'GROUP';

export interface MaintenanceCreateInput {
  ends_at: string;
  note?: string | null;
  starts_at: string;
  target_id: string;
  target_type: MaintenanceTargetType;
}

export interface MaintenancePatchInput {
  ends_at?: string;
  note?: string | null;
  starts_at?: string;
}

export interface MaintenanceListInput {
  checkId?: string;
  cursor?: string;
  endsAfter?: string;
  groupId?: string;
  limit: number;
  startsBefore?: string;
  state?: MaintenanceEffectiveState;
}

export interface MaintenanceWindowDto {
  created_at: string;
  ends_at: string;
  id: string;
  note: string | null;
  resource_version: string;
  starts_at: string;
  state: MaintenanceEffectiveState;
  target_id: string;
  target_type: MaintenanceTargetType;
  updated_at: string;
}

export interface MaintenancePageDto {
  data: MaintenanceWindowDto[];
  page: { has_more: boolean; next_cursor: string | null };
}

export interface MaintenanceCreateResult {
  replayed: boolean;
  window: MaintenanceWindowDto;
}

export interface MaintenanceServicePort {
  cancel: (
    ownerId: string,
    windowId: string,
    expectedVersion: string,
    correlationId: string,
  ) => Promise<void>;
  create: (
    ownerId: string,
    input: MaintenanceCreateInput,
    idempotencyKey: string,
    correlationId: string,
  ) => Promise<MaintenanceCreateResult>;
  get: (ownerId: string, windowId: string) => Promise<MaintenanceWindowDto>;
  list: (ownerId: string, input: MaintenanceListInput) => Promise<MaintenancePageDto>;
  update: (
    ownerId: string,
    windowId: string,
    expectedVersion: string,
    patch: MaintenancePatchInput,
    correlationId: string,
  ) => Promise<MaintenanceWindowDto>;
}

interface MaintenanceRow {
  cancelled_at: Date | string | null;
  check_id: string | null;
  created_at: Date | string;
  ends_at: Date | string;
  group_id: string | null;
  id: string;
  note: string | null;
  resource_version: string;
  starts_at: Date | string;
  state: MaintenanceStoredState;
  updated_at: Date | string;
}

interface CursorPayload {
  evaluatedAt: string;
  expiresAt: number;
  filterHash: string;
  id: string;
  startsAt: string;
  version: 1;
}

interface NormalizedCreate {
  endsAt: Date;
  note: string | null;
  startsAt: Date;
  targetId: string;
  targetType: MaintenanceTargetType;
}

interface NormalizedList {
  checkId: string | null;
  endsAfter: Date | null;
  groupId: string | null;
  limit: number;
  startsBefore: Date | null;
  state: MaintenanceEffectiveState | null;
}

export interface MaintenanceServiceOptions {
  cursorTtlSeconds?: number;
  maintenanceWindowLimit?: number;
  securityKey: Buffer;
}

function instant(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function parseInstant(value: string, field: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new DomainValidationError(
      field,
      'invalid_instant',
      `${field} must be a valid timestamp.`,
    );
  }
  return parsed;
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
    if (error instanceof MaintenanceWindowImmutableError) {
      throw new ApiProblemError({
        code: 'maintenance_window_immutable',
        detail: error.message,
        status: 409,
      });
    }
    throw error;
  }
}

function digest(key: Buffer, domain: string, value: string): Buffer {
  return createHmac('sha256', key).update(domain).update('\0').update(value).digest();
}

function resourceNotFound(): ApiProblemError {
  return new ApiProblemError({
    code: 'resource_not_found',
    detail: 'The requested maintenance window or target was not found.',
    status: 404,
  });
}

function assertVersion(actual: string, expected: string): void {
  if (actual === expected) return;
  throw new ApiProblemError({
    code: 'resource_version_mismatch',
    detail: 'The maintenance window changed after it was read.',
    etag: `"rv-${actual}"`,
    status: 412,
  });
}

function target(row: MaintenanceRow): { id: string; type: MaintenanceTargetType } {
  if (row.check_id) return { id: row.check_id, type: 'CHECK' };
  if (row.group_id) return { id: row.group_id, type: 'GROUP' };
  throw new Error('Maintenance row has no target');
}

function mapWindow(row: MaintenanceRow, evaluatedAt: Date): MaintenanceWindowDto {
  const resolvedTarget = target(row);
  return {
    created_at: instant(row.created_at),
    ends_at: instant(row.ends_at),
    id: row.id,
    note: row.note,
    resource_version: String(row.resource_version),
    starts_at: instant(row.starts_at),
    state: deriveMaintenanceState(
      {
        endsAt: asDate(row.ends_at),
        startsAt: asDate(row.starts_at),
        storedState: row.state,
      },
      evaluatedAt,
    ),
    target_id: resolvedTarget.id,
    target_type: resolvedTarget.type,
    updated_at: instant(row.updated_at),
  };
}

function normalizeCreate(input: MaintenanceCreateInput): NormalizedCreate {
  const configuration = normalize(() =>
    normalizeMaintenanceConfigurationRange({
      endsAt: parseInstant(input.ends_at, 'ends_at'),
      note: input.note ?? null,
      startsAt: parseInstant(input.starts_at, 'starts_at'),
    }),
  );
  return {
    endsAt: configuration.endsAt,
    note: configuration.note,
    startsAt: configuration.startsAt,
    targetId: input.target_id,
    targetType: input.target_type,
  };
}

function normalizeList(input: MaintenanceListInput): NormalizedList {
  return normalize(() => ({
    checkId: input.checkId ?? null,
    endsAfter: input.endsAfter ? parseInstant(input.endsAfter, 'ends_after') : null,
    groupId: input.groupId ?? null,
    limit: input.limit,
    startsBefore: input.startsBefore ? parseInstant(input.startsBefore, 'starts_before') : null,
    state: input.state ?? null,
  }));
}

async function writeEvent(
  client: PoolClient,
  input: {
    correlationId: string;
    eventType: string;
    ownerId: string;
    payload: Record<string, unknown>;
    window: MaintenanceWindowDto;
  },
): Promise<void> {
  await writeActivatedOutboxEvent(client, {
    aggregateId: input.window.id,
    aggregateType: 'maintenance_window',
    aggregateVersion: input.window.resource_version,
    correlationId: input.correlationId,
    destinations: ['NOTIFICATION', 'REALTIME'],
    eventType: input.eventType,
    ownerId: input.ownerId,
    payload: input.payload,
  });
}

async function writeAudit(
  client: PoolClient,
  input: {
    action: string;
    correlationId: string;
    metadata: Record<string, unknown>;
    ownerId: string;
    resourceId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit.events
       (occurred_at, owner_id, actor_type, actor_id, action, resource_type,
        resource_id, correlation_id, result, metadata)
     VALUES (statement_timestamp(), $1::uuid, 'USER', $1::text, $2,
             'maintenance_window', $3, $4, 'SUCCESS', $5::jsonb)`,
    [
      input.ownerId,
      input.action,
      input.resourceId,
      input.correlationId,
      JSON.stringify(input.metadata),
    ],
  );
}

const selectColumns = `id, check_id, group_id, note, starts_at, ends_at, state,
  cancelled_at, resource_version::text, created_at, updated_at`;

export class MaintenanceService implements MaintenanceServicePort {
  readonly #cursorTtlSeconds: number;
  readonly #maintenanceWindowLimit: number;
  readonly #pool: Pool;
  readonly #securityKey: Buffer;

  constructor(pool: Pool, options: MaintenanceServiceOptions) {
    this.#pool = pool;
    this.#securityKey = options.securityKey;
    this.#maintenanceWindowLimit = options.maintenanceWindowLimit ?? 500;
    this.#cursorTtlSeconds = options.cursorTtlSeconds ?? 900;
  }

  async create(
    ownerId: string,
    input: MaintenanceCreateInput,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<MaintenanceCreateResult> {
    const candidate = normalizeCreate(input);
    const canonical = {
      ends_at: candidate.endsAt.toISOString(),
      note: candidate.note,
      starts_at: candidate.startsAt.toISOString(),
      target_id: candidate.targetId,
      target_type: candidate.targetType,
    };
    const subjectDigest = digest(this.#securityKey, 'maintenance-create-subject', ownerId);
    const keyDigest = digest(this.#securityKey, 'maintenance-create-key', idempotencyKey);
    const requestHash = createHash('sha256').update(JSON.stringify(canonical)).digest();

    return withUserTransaction(this.#pool, ownerId, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `maintenance-create:${keyDigest.toString('hex')}`,
      ]);
      const existing = await client.query<{
        request_hash: Buffer;
        response_body: MaintenanceWindowDto;
      }>(
        `SELECT request_hash, response_body
         FROM infra.api_idempotency_records
         WHERE owner_id = $1 AND subject_digest = $2
           AND operation = 'maintenance.create' AND key_digest = $3`,
        [ownerId, subjectDigest, keyDigest],
      );
      const receipt = existing.rows[0];
      if (receipt) {
        if (!timingSafeEqual(receipt.request_hash, requestHash)) {
          throw new ApiProblemError({
            code: 'idempotency_key_reused',
            detail: 'The idempotency key was already used with a different request.',
            status: 409,
          });
        }
        return { replayed: true, window: receipt.response_body };
      }

      await this.#lockTarget(client, ownerId, candidate.targetType, candidate.targetId);
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `quota:maintenance:${ownerId}`,
      ]);
      const clock = await client.query<{ evaluated_at: Date }>(
        'SELECT clock_timestamp() AS evaluated_at',
      );
      const evaluatedAt = clock.rows[0]!.evaluated_at;
      const configuration = normalize(() =>
        normalizeMaintenanceConfiguration(
          { endsAt: candidate.endsAt, note: candidate.note, startsAt: candidate.startsAt },
          evaluatedAt,
        ),
      );
      if (this.#maintenanceWindowLimit > 0) {
        const count = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM app.maintenance_windows
           WHERE owner_id = $1 AND state = 'SCHEDULED'
             AND ends_at > $2`,
          [ownerId, evaluatedAt],
        );
        if (BigInt(count.rows[0]?.count ?? '0') >= BigInt(this.#maintenanceWindowLimit)) {
          throw new ApiProblemError({
            code: 'quota_exceeded',
            detail: 'The deployment maintenance-window quota has been reached.',
            status: 409,
          });
        }
      }

      const inserted = await client.query<MaintenanceRow>(
        `INSERT INTO app.maintenance_windows
           (owner_id, check_id, group_id, note, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${selectColumns}`,
        [
          ownerId,
          candidate.targetType === 'CHECK' ? candidate.targetId : null,
          candidate.targetType === 'GROUP' ? candidate.targetId : null,
          configuration.note,
          configuration.startsAt,
          configuration.endsAt,
        ],
      );
      const window = mapWindow(inserted.rows[0]!, evaluatedAt);
      await writeEvent(client, {
        correlationId,
        eventType: 'maintenance.created',
        ownerId,
        payload: {
          ends_at: window.ends_at,
          maintenance_id: window.id,
          resource_version: window.resource_version,
          starts_at: window.starts_at,
          target_id: window.target_id,
          target_type: window.target_type,
        },
        window,
      });
      await writeAudit(client, {
        action: 'maintenance.created',
        correlationId,
        metadata: { target_type: window.target_type },
        ownerId,
        resourceId: window.id,
      });
      await client.query(
        `INSERT INTO infra.api_idempotency_records
           (owner_id, subject_digest, operation, key_digest, request_hash,
            response_status, response_headers, response_body, expires_at)
         VALUES ($1, $2, 'maintenance.create', $3, $4, 201,
                 jsonb_build_object('Location', $5::text, 'ETag', $6::text),
                 $7::jsonb, statement_timestamp() + interval '24 hours')`,
        [
          ownerId,
          subjectDigest,
          keyDigest,
          requestHash,
          `/api/v1/maintenance-windows/${window.id}`,
          `"rv-${window.resource_version}"`,
          JSON.stringify(window),
        ],
      );
      return { replayed: false, window };
    });
  }

  async get(ownerId: string, windowId: string): Promise<MaintenanceWindowDto> {
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      const result = await client.query<MaintenanceRow & { evaluated_at: Date }>(
        `SELECT ${selectColumns}, transaction_timestamp() AS evaluated_at
         FROM app.maintenance_windows WHERE owner_id = $1 AND id = $2`,
        [ownerId, windowId],
      );
      const row = result.rows[0];
      if (!row) throw resourceNotFound();
      return mapWindow(row, row.evaluated_at);
    });
  }

  async list(ownerId: string, input: MaintenanceListInput): Promise<MaintenancePageDto> {
    const normalized = normalizeList(input);
    const filterHash = this.#filterHash(normalized);
    const cursor = input.cursor ? this.#decodeCursor(input.cursor, filterHash) : undefined;
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      const evaluatedAt = cursor
        ? new Date(cursor.evaluatedAt)
        : (
            await client.query<{ evaluated_at: Date }>(
              'SELECT transaction_timestamp() AS evaluated_at',
            )
          ).rows[0]!.evaluated_at;
      const result = await client.query<MaintenanceRow>(
        `SELECT ${selectColumns}
         FROM app.maintenance_windows
         WHERE owner_id = $1
           AND ($2::timestamptz IS NULL OR (starts_at, id) < ($2::timestamptz, $3::uuid))
           AND ($4::uuid IS NULL OR check_id = $4)
           AND ($5::uuid IS NULL OR group_id = $5)
           AND ($6::timestamptz IS NULL OR starts_at < $6)
           AND ($7::timestamptz IS NULL OR ends_at > $7)
           AND ($8::text IS NULL OR CASE
             WHEN state = 'CANCELLED' THEN 'CANCELLED'
             WHEN $9::timestamptz < starts_at THEN 'UPCOMING'
             WHEN $9::timestamptz < ends_at THEN 'ACTIVE'
             ELSE 'ENDED'
           END = $8)
         ORDER BY starts_at DESC, id DESC
         LIMIT $10`,
        [
          ownerId,
          cursor?.startsAt ?? null,
          cursor?.id ?? null,
          normalized.checkId,
          normalized.groupId,
          normalized.startsBefore,
          normalized.endsAfter,
          normalized.state,
          evaluatedAt,
          normalized.limit + 1,
        ],
      );
      const hasMore = result.rows.length > normalized.limit;
      const rows = result.rows.slice(0, normalized.limit);
      const last = rows.at(-1);
      return {
        data: rows.map((row) => mapWindow(row, evaluatedAt)),
        page: {
          has_more: hasMore,
          next_cursor:
            hasMore && last
              ? this.#encodeCursor({
                  evaluatedAt: evaluatedAt.toISOString(),
                  expiresAt: Math.floor(Date.now() / 1000) + this.#cursorTtlSeconds,
                  filterHash,
                  id: last.id,
                  startsAt: instant(last.starts_at),
                  version: 1,
                })
              : null,
        },
      };
    });
  }

  async update(
    ownerId: string,
    windowId: string,
    expectedVersion: string,
    patch: MaintenancePatchInput,
    correlationId: string,
  ): Promise<MaintenanceWindowDto> {
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      const selected = await client.query<MaintenanceRow>(
        `SELECT ${selectColumns}
         FROM app.maintenance_windows
         WHERE owner_id = $1 AND id = $2 FOR UPDATE`,
        [ownerId, windowId],
      );
      const current = selected.rows[0];
      if (!current) throw resourceNotFound();
      assertVersion(current.resource_version, expectedVersion);
      const evaluatedAt = (
        await client.query<{ evaluated_at: Date }>('SELECT clock_timestamp() AS evaluated_at')
      ).rows[0]!.evaluated_at;
      const changes = normalize(() =>
        classifyMaintenanceChanges(
          {
            endsAt: asDate(current.ends_at),
            note: current.note,
            startsAt: asDate(current.starts_at),
          },
          current.state,
          {
            ...(Object.hasOwn(patch, 'ends_at')
              ? { endsAt: parseInstant(patch.ends_at!, 'ends_at') }
              : {}),
            ...(Object.hasOwn(patch, 'note') ? { note: patch.note } : {}),
            ...(Object.hasOwn(patch, 'starts_at')
              ? { startsAt: parseInstant(patch.starts_at!, 'starts_at') }
              : {}),
          },
          evaluatedAt,
        ),
      );
      if (changes.noop) return mapWindow(current, evaluatedAt);

      const updated = await client.query<MaintenanceRow>(
        `UPDATE app.maintenance_windows
         SET note = $3, starts_at = $4, ends_at = $5,
             resource_version = resource_version + 1,
             updated_at = statement_timestamp()
         WHERE owner_id = $1 AND id = $2
         RETURNING ${selectColumns}`,
        [ownerId, windowId, changes.next.note, changes.next.startsAt, changes.next.endsAt],
      );
      const window = mapWindow(updated.rows[0]!, evaluatedAt);
      await writeEvent(client, {
        correlationId,
        eventType: 'maintenance.changed',
        ownerId,
        payload: {
          changed_fields: changes.changedFields,
          ends_at: window.ends_at,
          maintenance_id: window.id,
          previous_ends_at: instant(current.ends_at),
          previous_starts_at: instant(current.starts_at),
          resource_version: window.resource_version,
          starts_at: window.starts_at,
          target_id: window.target_id,
          target_type: window.target_type,
        },
        window,
      });
      await writeAudit(client, {
        action: 'maintenance.updated',
        correlationId,
        metadata: { changed_fields: changes.changedFields, target_type: window.target_type },
        ownerId,
        resourceId: window.id,
      });
      return window;
    });
  }

  async cancel(
    ownerId: string,
    windowId: string,
    expectedVersion: string,
    correlationId: string,
  ): Promise<void> {
    await withUserTransaction(this.#pool, ownerId, async (client) => {
      const selected = await client.query<MaintenanceRow>(
        `SELECT ${selectColumns}
         FROM app.maintenance_windows
         WHERE owner_id = $1 AND id = $2 FOR UPDATE`,
        [ownerId, windowId],
      );
      const current = selected.rows[0];
      if (!current) throw resourceNotFound();
      assertVersion(current.resource_version, expectedVersion);
      const evaluatedAt = (
        await client.query<{ evaluated_at: Date }>('SELECT clock_timestamp() AS evaluated_at')
      ).rows[0]!.evaluated_at;
      const effectiveState = normalize(() =>
        deriveMaintenanceState(
          {
            endsAt: asDate(current.ends_at),
            startsAt: asDate(current.starts_at),
            storedState: current.state,
          },
          evaluatedAt,
        ),
      );
      if (effectiveState === 'CANCELLED') return;
      if (effectiveState === 'ENDED') {
        throw new ApiProblemError({
          code: 'maintenance_window_immutable',
          detail: 'Ended maintenance cannot be cancelled.',
          status: 409,
        });
      }

      const cancelled = await client.query<MaintenanceRow>(
        `UPDATE app.maintenance_windows
         SET state = 'CANCELLED', cancelled_at = transaction_timestamp(),
             resource_version = resource_version + 1,
             updated_at = statement_timestamp()
         WHERE owner_id = $1 AND id = $2
         RETURNING ${selectColumns}`,
        [ownerId, windowId],
      );
      const window = mapWindow(cancelled.rows[0]!, evaluatedAt);
      await writeEvent(client, {
        correlationId,
        eventType: 'maintenance.cancelled',
        ownerId,
        payload: {
          cancelled_at: instant(cancelled.rows[0]!.cancelled_at!),
          maintenance_id: window.id,
          resource_version: window.resource_version,
          target_id: window.target_id,
          target_type: window.target_type,
        },
        window,
      });
      await writeAudit(client, {
        action: 'maintenance.cancelled',
        correlationId,
        metadata: { target_type: window.target_type },
        ownerId,
        resourceId: window.id,
      });
    });
  }

  async #lockTarget(
    client: PoolClient,
    ownerId: string,
    targetType: MaintenanceTargetType,
    targetId: string,
  ): Promise<void> {
    const result =
      targetType === 'CHECK'
        ? await client.query(
            `SELECT id FROM app.checks
             WHERE owner_id = $1 AND id = $2 AND lifecycle_state = 'LIVE'
             FOR UPDATE`,
            [ownerId, targetId],
          )
        : await client.query(
            `SELECT id FROM app.check_groups
             WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL
             FOR UPDATE`,
            [ownerId, targetId],
          );
    if (!result.rows[0]) throw resourceNotFound();
  }

  #filterHash(input: NormalizedList): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          checkId: input.checkId,
          endsAfter: input.endsAfter?.toISOString() ?? null,
          groupId: input.groupId,
          limit: input.limit,
          startsBefore: input.startsBefore?.toISOString() ?? null,
          state: input.state,
        }),
      )
      .digest('base64url');
  }

  #encodeCursor(payload: CursorPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = digest(this.#securityKey, 'maintenance-list-cursor', body).toString(
      'base64url',
    );
    return `${body}.${signature}`;
  }

  #decodeCursor(value: string, filterHash: string): CursorPayload {
    try {
      const [body, signature, extra] = value.split('.');
      if (!body || !signature || extra) throw new Error('invalid parts');
      const actual = Buffer.from(signature, 'base64url');
      const expected = digest(this.#securityKey, 'maintenance-list-cursor', body);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new Error('invalid signature');
      }
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CursorPayload;
      if (
        payload.version !== 1 ||
        payload.filterHash !== filterHash ||
        !Number.isFinite(Date.parse(payload.evaluatedAt)) ||
        !Number.isFinite(Date.parse(payload.startsAt)) ||
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
}
