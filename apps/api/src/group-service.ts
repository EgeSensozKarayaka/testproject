import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { Pool, PoolClient } from '@site-monitor/database';
import { withUserTransaction } from '@site-monitor/database';
import {
  classifyGroupChanges,
  DomainValidationError,
  normalizeGroupConfiguration,
  type GroupConfigurationInput,
  type GroupConfigurationPatch,
} from '@site-monitor/domain';

import { ApiProblemError } from './problem.js';
import { createUuidV7 } from './request-id.js';

export interface GroupDto {
  created_at: string;
  description: string | null;
  id: string;
  name: string;
  resource_version: string;
  updated_at: string;
}

export interface GroupStatusDto {
  down: number;
  health_state: 'DOWN' | 'SUSPECT' | 'UNKNOWN' | 'UP';
  paused: number;
  suspect: number;
  unknown: number;
  up: number;
}

export interface GroupPageDto {
  data: { group: GroupDto; status: GroupStatusDto }[];
  page: { has_more: boolean; next_cursor: string | null };
}

export interface GroupCreateResult {
  group: GroupDto;
  replayed: boolean;
}

export interface GroupServicePort {
  create: (
    ownerId: string,
    input: GroupConfigurationInput,
    idempotencyKey: string,
    correlationId: string,
  ) => Promise<GroupCreateResult>;
  delete: (
    ownerId: string,
    groupId: string,
    expectedVersion: string,
    correlationId: string,
  ) => Promise<void>;
  get: (ownerId: string, groupId: string) => Promise<GroupDto>;
  list: (ownerId: string, input: { cursor?: string; limit: number }) => Promise<GroupPageDto>;
  update: (
    ownerId: string,
    groupId: string,
    expectedVersion: string,
    patch: GroupConfigurationPatch,
    correlationId: string,
  ) => Promise<GroupDto>;
}

interface GroupRow {
  created_at: Date | string;
  description: string | null;
  id: string;
  name: string;
  resource_version: string;
  updated_at: Date | string;
}

interface CursorPayload {
  createdAt: string;
  expiresAt: number;
  id: string;
  version: 1;
}

export interface GroupServiceOptions {
  cursorTtlSeconds?: number;
  groupLimit?: number;
  securityKey: Buffer;
}

function instant(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapGroup(row: GroupRow): GroupDto {
  return {
    created_at: instant(row.created_at),
    description: row.description,
    id: row.id,
    name: row.name,
    resource_version: String(row.resource_version),
    updated_at: instant(row.updated_at),
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

function resourceNotFound(): ApiProblemError {
  return new ApiProblemError({
    code: 'resource_not_found',
    detail: 'The requested group was not found.',
    status: 404,
  });
}

function assertVersion(actual: string, expected: string): void {
  if (actual === expected) return;
  throw new ApiProblemError({
    code: 'resource_version_mismatch',
    detail: 'The group changed after it was read.',
    etag: `"rv-${actual}"`,
    status: 412,
  });
}

async function writeEvent(
  client: PoolClient,
  input: {
    aggregateId: string;
    aggregateType: 'check' | 'group';
    aggregateVersion: string;
    correlationId: string;
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
  await client.query(
    `INSERT INTO infra.outbox_dispatches (event_id, destination)
     VALUES ($1, 'REALTIME')`,
    [eventId],
  );
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
     VALUES (statement_timestamp(), $1::uuid, 'USER', $1::text, $2, 'group', $3, $4,
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

export class GroupService implements GroupServicePort {
  readonly #cursorTtlSeconds: number;
  readonly #groupLimit: number;
  readonly #pool: Pool;
  readonly #securityKey: Buffer;

  constructor(pool: Pool, options: GroupServiceOptions) {
    this.#pool = pool;
    this.#securityKey = options.securityKey;
    this.#groupLimit = options.groupLimit ?? 100;
    this.#cursorTtlSeconds = options.cursorTtlSeconds ?? 900;
  }

  async create(
    ownerId: string,
    input: GroupConfigurationInput,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<GroupCreateResult> {
    const configuration = normalize(() => normalizeGroupConfiguration(input));
    const subjectDigest = digest(this.#securityKey, 'group-create-subject', ownerId);
    const keyDigest = digest(this.#securityKey, 'group-create-key', idempotencyKey);
    const requestHash = createHash('sha256').update(JSON.stringify(configuration)).digest();

    return withUserTransaction(this.#pool, ownerId, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `group-create:${keyDigest.toString('hex')}`,
      ]);
      const existing = await client.query<{
        request_hash: Buffer;
        response_body: GroupDto;
      }>(
        `SELECT request_hash, response_body
         FROM infra.api_idempotency_records
         WHERE owner_id = $1 AND subject_digest = $2
           AND operation = 'group.create' AND key_digest = $3`,
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
        return { group: receipt.response_body, replayed: true };
      }

      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `quota:groups:${ownerId}`,
      ]);
      if (this.#groupLimit > 0) {
        const count = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM app.check_groups
           WHERE owner_id = $1 AND deleted_at IS NULL`,
          [ownerId],
        );
        if (BigInt(count.rows[0]?.count ?? '0') >= BigInt(this.#groupLimit)) {
          throw new ApiProblemError({
            code: 'quota_exceeded',
            detail: 'The deployment group quota has been reached.',
            status: 409,
          });
        }
      }

      const inserted = await client.query<GroupRow>(
        `INSERT INTO app.check_groups (owner_id, name, description)
         VALUES ($1, $2, $3)
         RETURNING id, name, description, resource_version::text,
                   created_at, updated_at`,
        [ownerId, configuration.name, configuration.description],
      );
      const row = inserted.rows[0]!;
      const group = mapGroup(row);
      await client.query(
        `INSERT INTO notification.policies
           (owner_id, group_id, mode, notify_down, notify_recovery)
         VALUES ($1, $2, 'INHERIT', NULL, NULL)`,
        [ownerId, group.id],
      );
      await writeEvent(client, {
        aggregateId: group.id,
        aggregateType: 'group',
        aggregateVersion: group.resource_version,
        correlationId,
        eventType: 'group.created',
        ownerId,
        payload: { group_id: group.id, resource_version: group.resource_version },
      });
      await writeAudit(client, {
        action: 'group.created',
        correlationId,
        ownerId,
        resourceId: group.id,
      });
      await client.query(
        `INSERT INTO infra.api_idempotency_records
           (owner_id, subject_digest, operation, key_digest, request_hash,
            response_status, response_headers, response_body, expires_at)
         VALUES ($1, $2, 'group.create', $3, $4, 201,
                 jsonb_build_object('Location', $5::text, 'ETag', $6::text),
                 $7::jsonb, statement_timestamp() + interval '24 hours')`,
        [
          ownerId,
          subjectDigest,
          keyDigest,
          requestHash,
          `/api/v1/groups/${group.id}`,
          `"rv-${group.resource_version}"`,
          JSON.stringify(group),
        ],
      );
      return { group, replayed: false };
    });
  }

  async get(ownerId: string, groupId: string): Promise<GroupDto> {
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      const result = await client.query<GroupRow>(
        `SELECT id, name, description, resource_version::text, created_at, updated_at
         FROM app.check_groups
         WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [ownerId, groupId],
      );
      if (!result.rows[0]) throw resourceNotFound();
      return mapGroup(result.rows[0]);
    });
  }

  async list(ownerId: string, input: { cursor?: string; limit: number }): Promise<GroupPageDto> {
    const cursor = input.cursor ? this.#decodeCursor(input.cursor) : undefined;
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      const result = await client.query<
        GroupRow & {
          down: number;
          paused: number;
          suspect: number;
          unknown: number;
          up: number;
        }
      >(
        `SELECT g.id, g.name, g.description, g.resource_version::text,
                g.created_at, g.updated_at,
                count(*) FILTER (WHERE c.execution_state = 'ACTIVE' AND
                  s.freshness_state = 'FRESH' AND s.fresh_until > statement_timestamp()
                  AND s.health_state = 'UP')::int AS up,
                count(*) FILTER (WHERE c.execution_state = 'ACTIVE' AND
                  s.freshness_state = 'FRESH' AND s.fresh_until > statement_timestamp()
                  AND s.health_state = 'SUSPECT')::int AS suspect,
                count(*) FILTER (WHERE c.execution_state = 'ACTIVE' AND
                  s.freshness_state = 'FRESH' AND s.fresh_until > statement_timestamp()
                  AND s.health_state = 'DOWN')::int AS down,
                count(*) FILTER (WHERE c.execution_state = 'ACTIVE' AND
                  (s.freshness_state IS DISTINCT FROM 'FRESH'
                   OR s.fresh_until IS NULL OR s.fresh_until <= statement_timestamp()
                   OR s.health_state = 'UNKNOWN'))::int AS unknown,
                count(*) FILTER (WHERE c.execution_state = 'PAUSED')::int AS paused
         FROM app.check_groups g
         LEFT JOIN app.checks c ON c.owner_id = g.owner_id AND c.group_id = g.id
           AND c.lifecycle_state = 'LIVE'
         LEFT JOIN monitoring.check_current_states s ON s.owner_id = c.owner_id
           AND s.check_id = c.id
         WHERE g.owner_id = $1 AND g.deleted_at IS NULL
           AND ($2::timestamptz IS NULL OR (g.created_at, g.id) < ($2::timestamptz, $3::uuid))
         GROUP BY g.id
         ORDER BY g.created_at DESC, g.id DESC
         LIMIT $4`,
        [ownerId, cursor?.createdAt ?? null, cursor?.id ?? null, input.limit + 1],
      );
      const hasMore = result.rows.length > input.limit;
      const rows = result.rows.slice(0, input.limit);
      const last = rows.at(-1);
      return {
        data: rows.map((row) => ({
          group: mapGroup(row),
          status: {
            down: row.down,
            health_state:
              row.down > 0
                ? 'DOWN'
                : row.suspect > 0
                  ? 'SUSPECT'
                  : row.unknown > 0 || row.up === 0
                    ? 'UNKNOWN'
                    : 'UP',
            paused: row.paused,
            suspect: row.suspect,
            unknown: row.unknown,
            up: row.up,
          },
        })),
        page: {
          has_more: hasMore,
          next_cursor:
            hasMore && last
              ? this.#encodeCursor({
                  createdAt: instant(last.created_at),
                  expiresAt: Math.floor(Date.now() / 1000) + this.#cursorTtlSeconds,
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
    groupId: string,
    expectedVersion: string,
    patch: GroupConfigurationPatch,
    correlationId: string,
  ): Promise<GroupDto> {
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      const selected = await client.query<GroupRow>(
        `SELECT id, name, description, resource_version::text, created_at, updated_at
         FROM app.check_groups
         WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [ownerId, groupId],
      );
      const current = selected.rows[0];
      if (!current) throw resourceNotFound();
      assertVersion(current.resource_version, expectedVersion);
      const changes = normalize(() =>
        classifyGroupChanges({ description: current.description, name: current.name }, patch),
      );
      if (changes.noop) return mapGroup(current);

      const updated = await client.query<GroupRow>(
        `UPDATE app.check_groups
         SET name = $3, description = $4,
             resource_version = resource_version + 1,
             updated_at = statement_timestamp()
         WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING id, name, description, resource_version::text,
                   created_at, updated_at`,
        [ownerId, groupId, changes.next.name, changes.next.description],
      );
      const group = mapGroup(updated.rows[0]!);
      await writeEvent(client, {
        aggregateId: group.id,
        aggregateType: 'group',
        aggregateVersion: group.resource_version,
        correlationId,
        eventType: 'group.changed',
        ownerId,
        payload: {
          changed_fields: changes.changedFields,
          group_id: group.id,
          resource_version: group.resource_version,
        },
      });
      await writeAudit(client, {
        action: 'group.updated',
        correlationId,
        metadata: { changed_fields: changes.changedFields },
        ownerId,
        resourceId: group.id,
      });
      return group;
    });
  }

  async delete(
    ownerId: string,
    groupId: string,
    expectedVersion: string,
    correlationId: string,
  ): Promise<void> {
    await withUserTransaction(this.#pool, ownerId, async (client) => {
      const selected = await client.query<{ resource_version: string }>(
        `SELECT resource_version::text
         FROM app.check_groups
         WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [ownerId, groupId],
      );
      const current = selected.rows[0];
      if (!current) throw resourceNotFound();
      assertVersion(current.resource_version, expectedVersion);

      await client.query(
        `SELECT id
         FROM app.checks
         WHERE owner_id = $1 AND group_id = $2 AND lifecycle_state = 'LIVE'
         ORDER BY id
         FOR UPDATE`,
        [ownerId, groupId],
      );
      const detached = await client.query<{ id: string; resource_version: string }>(
        `UPDATE app.checks
         SET group_id = NULL, resource_version = resource_version + 1,
             updated_at = statement_timestamp()
         WHERE owner_id = $1 AND group_id = $2 AND lifecycle_state = 'LIVE'
         RETURNING id, resource_version::text`,
        [ownerId, groupId],
      );
      const deleted = await client.query<{ deleted_at: Date | string; resource_version: string }>(
        `UPDATE app.check_groups
         SET deleted_at = statement_timestamp(),
             resource_version = resource_version + 1,
             updated_at = statement_timestamp()
         WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING deleted_at, resource_version::text`,
        [ownerId, groupId],
      );
      for (const check of detached.rows) {
        await writeEvent(client, {
          aggregateId: check.id,
          aggregateType: 'check',
          aggregateVersion: check.resource_version,
          correlationId,
          eventType: 'check.group_changed',
          ownerId,
          payload: {
            check_id: check.id,
            group_id: null,
            previous_group_id: groupId,
            resource_version: check.resource_version,
          },
        });
      }
      await writeEvent(client, {
        aggregateId: groupId,
        aggregateType: 'group',
        aggregateVersion: deleted.rows[0]!.resource_version,
        correlationId,
        eventType: 'group.deleted',
        ownerId,
        payload: {
          deleted_at: instant(deleted.rows[0]!.deleted_at),
          group_id: groupId,
          resource_version: deleted.rows[0]!.resource_version,
        },
      });
      await writeAudit(client, {
        action: 'group.deleted',
        correlationId,
        metadata: { detached_check_count: detached.rowCount ?? 0 },
        ownerId,
        resourceId: groupId,
      });
    });
  }

  #encodeCursor(payload: CursorPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = digest(this.#securityKey, 'group-list-cursor', body).toString('base64url');
    return `${body}.${signature}`;
  }

  #decodeCursor(value: string): CursorPayload {
    try {
      const [body, signature, extra] = value.split('.');
      if (!body || !signature || extra) throw new Error('invalid parts');
      const actual = Buffer.from(signature, 'base64url');
      const expected = digest(this.#securityKey, 'group-list-cursor', body);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new Error('invalid signature');
      }
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CursorPayload;
      if (
        payload.version !== 1 ||
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
        detail: 'The page cursor is invalid or expired.',
        status: 400,
      });
    }
  }
}
