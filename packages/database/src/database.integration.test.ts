import { randomUUID } from 'node:crypto';
import { appendFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabasePool,
  createQueryDatabase,
  isDatabaseReady,
  writeActivatedOutboxEvent,
} from './index.js';
import { getSchemaState, runMigrations, TARGET_SCHEMA_REVISION } from './migrations.js';
import { resetDatabase, runSeeds } from './operations.js';
import { dropTestDatabase } from './testing.js';

const adminConnectionString = process.env.DATABASE_TEST_ADMIN_URL;
const databaseSuite = adminConnectionString ? describe : describe.skip;

function quotedIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function databaseUrl(adminUrl: string, databaseName: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function withRole<T extends QueryResultRow>(
  pool: Pool,
  role:
    'site_monitor_api' | 'site_monitor_notifier' | 'site_monitor_predictor' | 'site_monitor_public',
  ownerId: string | null,
  query: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    if (ownerId) {
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [ownerId]);
    }
    const result = await query(client);
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function withRoleCommit<T extends QueryResultRow>(
  pool: Pool,
  role: 'site_monitor_api' | 'site_monitor_notifier',
  query: (client: PoolClient) => Promise<T>,
  ownerId: string | null = null,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    if (ownerId) {
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [ownerId]);
    }
    const result = await query(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

databaseSuite('PostgreSQL persistence architecture', () => {
  const databaseName = `site_monitor_phase3_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerA = '00000000-0000-4000-8000-000000000001';
  const groupA = '00000000-0000-4000-8000-000000000101';
  const checkA = '00000000-0000-4000-8000-000000000201';
  const ownerB = '00000000-0000-4000-8000-000000000002';
  const checkB = '00000000-0000-4000-8000-000000000203';
  let adminPool: Pool;
  let pool: Pool;
  let connectionString: string;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: adminConnectionString, max: 1 });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    connectionString = databaseUrl(adminConnectionString!, databaseName);
    pool = createDatabasePool({ applicationName: 'database-integration-test', connectionString });
  }, 30_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName);
      await adminPool.end();
    }
  }, 30_000);

  it('migrates from zero, records checksums, and is idempotent', async () => {
    const first = await runMigrations(pool, { appBuild: 'integration-test' });
    expect(first.currentRevision).toBe(TARGET_SCHEMA_REVISION);
    expect(first.applied).toEqual(
      Array.from({ length: TARGET_SCHEMA_REVISION }, (_, index) => index + 1),
    );

    const second = await runMigrations(pool, { appBuild: 'integration-test' });
    expect(second).toEqual({ applied: [], currentRevision: TARGET_SCHEMA_REVISION });
    expect(await getSchemaState(pool)).toEqual({
      compatibilityEpoch: 1,
      currentRevision: TARGET_SCHEMA_REVISION,
      minimumAppEpoch: 1,
    });
    await expect(isDatabaseReady(pool, { minimumRevision: TARGET_SCHEMA_REVISION })).resolves.toBe(
      true,
    );
  });

  it('rejects checksum drift in an already-applied migration', async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'site-monitor-migrations-'));
    const copiedMigrations = path.join(temporaryRoot, 'migrations');
    try {
      await cp(path.resolve('database/migrations'), copiedMigrations, { recursive: true });
      await appendFile(
        path.join(copiedMigrations, '000002_auth_and_core.sql'),
        '\n-- forbidden history rewrite\n',
      );
      await expect(runMigrations(pool, { directory: copiedMigrations })).rejects.toThrow(
        /checksum drift detected/,
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('applies the development seed repeatedly without duplicates', async () => {
    await runSeeds(pool, { NODE_ENV: 'test' });
    await runSeeds(pool, { NODE_ENV: 'test' });

    const result = await pool.query<{ checks: string; users: string }>(`
      SELECT
        (SELECT count(*)::text FROM app.checks) AS checks,
        (SELECT count(*)::text FROM auth.users) AS users
    `);
    expect(result.rows[0]).toEqual({ checks: '1', users: '1' });
  });

  it('enforces RLS isolation and clears transaction-local user context', async () => {
    await pool.query(
      `
        INSERT INTO auth.users
          (id, email_normalized, email_display, display_name, status, email_verified_at)
        VALUES ($1, 'second@example.test', 'second@example.test', 'Second User', 'ACTIVE', statement_timestamp())
      `,
      [ownerB],
    );
    await pool.query(
      `
        INSERT INTO app.checks
          (id, owner_id, name, url, interval_seconds, timeout_ms, expected_status_code, next_run_at)
        VALUES
          ($2, $1, 'Second Check', 'https://second.example.test', 30, 5000, 200, statement_timestamp())
      `,
      [ownerB, checkB],
    );

    const visibleToA = await withRole(pool, 'site_monitor_api', ownerA, async (client) => {
      const result = await client.query<{ id: string }>('SELECT id FROM app.checks ORDER BY id');
      return { count: result.rowCount ?? 0, first: result.rows[0]?.id ?? '' };
    });
    expect(visibleToA).toEqual({ count: 1, first: checkA });

    const changedRows = await withRole(pool, 'site_monitor_api', ownerA, async (client) => {
      const result = await client.query('UPDATE app.checks SET name = $1 WHERE id = $2', [
        'Forbidden rename',
        checkB,
      ]);
      return { count: result.rowCount ?? 0 };
    });
    expect(changedRows.count).toBe(0);

    await expect(
      withRole(pool, 'site_monitor_api', ownerA, async (client) => {
        await client.query(
          `INSERT INTO app.check_groups (owner_id, name) VALUES ($1, 'Cross owner')`,
          [ownerB],
        );
        return {};
      }),
    ).rejects.toMatchObject({ code: '42501' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE site_monitor_api');
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [ownerA]);
      expect((await client.query('SELECT id FROM app.checks')).rowCount).toBe(1);
      await client.query('COMMIT');

      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE site_monitor_api');
      expect((await client.query('SELECT id FROM app.checks')).rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('routes outbox facts only to migration-activated destinations', async () => {
    const activations = await pool.query<{ activated_by_revision: string; destination: string }>(
      `SELECT destination, activated_by_revision::text
       FROM infra.destination_activations
       ORDER BY destination`,
    );
    expect(activations.rows).toEqual([
      { activated_by_revision: '19', destination: 'NOTIFICATION' },
      { activated_by_revision: '28', destination: 'REALTIME' },
    ]);
    const inactive = await withRole(pool, 'site_monitor_api', ownerA, async (client) =>
      writeActivatedOutboxEvent(client, {
        aggregateId: checkA,
        aggregateType: 'check',
        aggregateVersion: 1,
        correlationId: '00000000-0000-7000-8000-000000000901',
        destinations: ['PREDICTION'],
        eventType: 'check.run_recorded',
        ownerId: ownerA,
        payload: { check_id: checkA },
      }),
    );
    expect(inactive).toEqual({ destinations: [], eventId: null });

    const active = await withRoleCommit(
      pool,
      'site_monitor_api',
      (client) =>
        writeActivatedOutboxEvent(client, {
          aggregateId: checkA,
          aggregateType: 'check',
          aggregateVersion: 1,
          correlationId: '00000000-0000-7000-8000-000000000902',
          destinations: ['PREDICTION', 'REALTIME', 'REALTIME'],
          eventType: 'check.health_changed',
          ownerId: ownerA,
          payload: { check_id: checkA },
        }),
      ownerA,
    );
    expect(active.eventId).not.toBeNull();
    expect(active.destinations).toEqual(['REALTIME']);
    const persisted = await pool.query<{ destinations: string; events: string }>(
      `SELECT
         (SELECT count(*)::text FROM infra.outbox_events WHERE correlation_id = $1) AS events,
         (SELECT count(*)::text FROM infra.outbox_dispatches d
            JOIN infra.outbox_events e ON e.id = d.event_id
            WHERE e.correlation_id = $1) AS destinations`,
      ['00000000-0000-7000-8000-000000000902'],
    );
    expect(persisted.rows[0]).toEqual({ destinations: '1', events: '1' });
  });

  it('applies the check/group foundation constraints and narrow API write boundary', async () => {
    await pool.query(
      `UPDATE app.check_groups SET description = 'Critical services' WHERE owner_id = $1`,
      [ownerA],
    );
    const group = await pool.query<{ description: string | null }>(
      'SELECT description FROM app.check_groups WHERE owner_id = $1',
      [ownerA],
    );
    expect(group.rows[0]?.description).toBe('Critical services');

    await expect(
      pool.query(
        'UPDATE app.checks SET expected_body_substring = $1 WHERE owner_id = $2 AND id = $3',
        ['ü'.repeat(1025), ownerB, checkB],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    const apiWrites = await withRole(pool, 'site_monitor_api', ownerB, async (client) => {
      const eventId = '00000000-0000-4000-8000-000000000801';
      await client.query(
        `INSERT INTO monitoring.check_current_states (owner_id, check_id) VALUES ($1, $2)`,
        [ownerB, checkB],
      );
      const event = await client.query(
        `
          INSERT INTO infra.outbox_events (
            id, owner_id, event_type, schema_version, aggregate_type, aggregate_id,
            aggregate_version, correlation_id, occurred_at, payload
          ) VALUES ($3, $1, 'check.created', 1, 'check', $2::uuid, 1, uuidv7(), statement_timestamp(),
            jsonb_build_object('check_id', $2::uuid, 'resource_version', '1'))
        `,
        [ownerB, checkB, eventId],
      );
      await client.query(
        `INSERT INTO infra.outbox_dispatches (event_id, destination) VALUES ($1, 'REALTIME')`,
        [eventId],
      );
      await client.query(
        `
          INSERT INTO audit.events (
            occurred_at, owner_id, actor_type, actor_id, action, resource_type,
            resource_id, correlation_id, result, metadata
          ) VALUES (
            statement_timestamp(), $1::uuid, 'USER', $1::uuid::text, 'check.created', 'check',
            $2, uuidv7(), 'SUCCESS', '{}'::jsonb
          )
        `,
        [ownerB, checkB],
      );
      return { eventCount: event.rowCount ?? 0 };
    });
    expect(apiWrites.eventCount).toBe(1);

    await expect(
      withRole(pool, 'site_monitor_api', ownerB, async (client) => {
        await client.query('DELETE FROM app.checks WHERE owner_id = $1 AND id = $2', [
          ownerB,
          checkB,
        ]);
        return {};
      }),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      withRole(pool, 'site_monitor_api', ownerA, async (client) => {
        await client.query(
          `
            INSERT INTO infra.outbox_events (
              owner_id, event_type, schema_version, aggregate_type, aggregate_id,
              aggregate_version, correlation_id, occurred_at, payload
            ) VALUES ($1, 'check.created', 1, 'check', $2::uuid, 1, uuidv7(), statement_timestamp(), '{}'::jsonb)
          `,
          [ownerB, checkB],
        );
        return {};
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('applies the maintenance foundation contract and least-privilege boundary', async () => {
    const maintenanceId = '00000000-0000-7000-8000-000000000915';
    const groupMaintenanceId = '00000000-0000-7000-8000-000000000916';
    const created = await withRoleCommit(
      pool,
      'site_monitor_api',
      async (client) => {
        await client.query(
          `INSERT INTO app.maintenance_windows
             (id, owner_id, check_id, note, starts_at, ends_at)
           VALUES ($1, $2, $3, NULL, transaction_timestamp(),
                   transaction_timestamp() + interval '1 hour')`,
          [maintenanceId, ownerA, checkA],
        );
        const groupWindow = await client.query<{ ends_at: Date }>(
          `INSERT INTO app.maintenance_windows
             (id, owner_id, group_id, note, starts_at, ends_at)
           VALUES ($1, $2, $3, 'group overlap', transaction_timestamp(),
                   transaction_timestamp() + interval '2 hours')
           RETURNING ends_at`,
          [groupMaintenanceId, ownerA, groupA],
        );
        return { groupUntil: groupWindow.rows[0]!.ends_at };
      },
      ownerA,
    );

    const projected = await withRole(pool, 'site_monitor_api', ownerA, async (client) => {
      const result = await client.query<{ until: Date | null }>(
        `SELECT app.effective_maintenance_until($1, $2, transaction_timestamp()) AS until`,
        [ownerA, checkA],
      );
      return { until: result.rows[0]?.until ?? null };
    });
    expect(projected.until?.toISOString()).toBe(created.groupUntil.toISOString());

    const hidden = await withRole(pool, 'site_monitor_api', ownerB, async (client) => {
      const result = await client.query<{ until: Date | null }>(
        `SELECT app.effective_maintenance_until($1, $2, transaction_timestamp()) AS until`,
        [ownerA, checkA],
      );
      return { until: result.rows[0]?.until ?? null };
    });
    expect(hidden.until).toBeNull();

    await expect(
      withRole(pool, 'site_monitor_api', ownerA, async (client) => {
        await client.query('DELETE FROM app.maintenance_windows WHERE id = $1', [maintenanceId]);
        return {};
      }),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withRole(pool, 'site_monitor_api', ownerA, async (client) => {
        await client.query('UPDATE app.maintenance_windows SET check_id = $1 WHERE id = $2', [
          checkB,
          maintenanceId,
        ]);
        return {};
      }),
    ).rejects.toMatchObject({ code: '42501' });

    const columns = await pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'app' AND table_name = 'maintenance_windows'
         AND column_name IN ('name', 'note')
       ORDER BY column_name`,
    );
    expect(columns.rows).toEqual([{ column_name: 'note', is_nullable: 'YES' }]);
  });

  it('uses exact half-open boundaries and restores overlapping maintenance from durable rows', async () => {
    const directId = '00000000-0000-7000-8000-000000000917';
    const groupId = '00000000-0000-7000-8000-000000000918';
    const directStart = new Date('2030-01-01T01:00:00.000Z');
    const groupStart = new Date('2030-01-01T02:00:00.000Z');
    const directEnd = new Date('2030-01-01T03:00:00.000Z');
    const groupEnd = new Date('2030-01-01T04:00:00.000Z');
    await pool.query(
      `INSERT INTO app.maintenance_windows
         (id, owner_id, check_id, note, starts_at, ends_at)
       VALUES ($1, $2, $3, 'direct boundary fixture', $4, $5)`,
      [directId, ownerA, checkA, directStart, directEnd],
    );
    await pool.query(
      `INSERT INTO app.maintenance_windows
         (id, owner_id, group_id, note, starts_at, ends_at)
       VALUES ($1, $2, $3, 'group boundary fixture', $4, $5)`,
      [groupId, ownerA, groupA, groupStart, groupEnd],
    );

    async function projectedUntil(at: Date, sourcePool: Pool = pool): Promise<Date | null> {
      const projected = await withRole(sourcePool, 'site_monitor_api', ownerA, async (client) => {
        const result = await client.query<{ until: Date | null }>(
          `SELECT app.effective_maintenance_until($1, $2, $3) AS until`,
          [ownerA, checkA, at],
        );
        return { until: result.rows[0]?.until ?? null };
      });
      return projected.until;
    }

    await expect(projectedUntil(new Date(directStart.getTime() - 1))).resolves.toBeNull();
    await expect(projectedUntil(directStart)).resolves.toEqual(directEnd);
    await expect(projectedUntil(groupStart)).resolves.toEqual(groupEnd);
    await expect(projectedUntil(directEnd)).resolves.toEqual(groupEnd);
    await expect(projectedUntil(groupEnd)).resolves.toBeNull();

    const restartedPool = createDatabasePool({
      applicationName: 'maintenance-restart-acceptance',
      connectionString,
      maxConnections: 1,
    });
    try {
      await expect(
        projectedUntil(new Date('2030-01-01T02:30:00.000Z'), restartedPool),
      ).resolves.toEqual(groupEnd);
    } finally {
      await restartedPool.end();
    }
  });

  it('executes the least-privilege account, session, throttle, and email lifecycle', async () => {
    const tokenDigest = Buffer.alloc(32, 41);
    const sessionDigest = Buffer.alloc(32, 42);
    const created = await withRoleCommit(pool, 'site_monitor_api', async (client) => {
      const result = await client.query<{ created: boolean; owner_id: string }>(
        `SELECT * FROM security_api.register_account(
          $1,$2,$3,$4,$5,statement_timestamp() + interval '1 hour',$6,$7,$8,$9
        )`,
        [
          'auth-flow@example.test',
          'auth-flow@example.test',
          'Auth Flow',
          '$argon2id$v=19$m=19456,t=2,p=1$placeholder',
          tokenDigest,
          Buffer.from('encrypted'),
          Buffer.alloc(12, 1),
          Buffer.alloc(16, 2),
          'test-v1',
        ],
      );
      return result.rows[0]!;
    });
    expect(created.created).toBe(true);

    const verified = await withRoleCommit(pool, 'site_monitor_api', async (client) => {
      const result = await client.query<{ accepted: boolean }>(
        'SELECT security_api.confirm_email_verification($1) AS accepted',
        [tokenDigest],
      );
      return result.rows[0]!;
    });
    expect(verified.accepted).toBe(true);

    const resolved = await withRoleCommit(pool, 'site_monitor_api', async (client) => {
      await client.query(
        `SELECT * FROM security_api.create_session(
          $1,$2,statement_timestamp() + interval '7 days',statement_timestamp() + interval '24 hours'
        )`,
        [created.owner_id, sessionDigest],
      );
      const result = await client.query<{ owner_id: string; user_status: string }>(
        'SELECT owner_id, user_status FROM security_api.resolve_session($1)',
        [sessionDigest],
      );
      return result.rows[0]!;
    });
    expect(resolved).toEqual({ owner_id: created.owner_id, user_status: 'ACTIVE' });

    const touched = await withRoleCommit(pool, 'site_monitor_api', async (client) => {
      const result = await client.query<{ rotated: boolean; session_id: string }>(
        `SELECT session_id, rotated FROM security_api.touch_or_rotate_session(
          $1,$2,statement_timestamp() + interval '24 hours',statement_timestamp() + interval '5 minutes'
        )`,
        [sessionDigest, Buffer.alloc(32, 44)],
      );
      return result.rows[0]!;
    });
    expect(touched).toEqual({ rotated: false, session_id: expect.any(String) });

    const profile = await withRoleCommit(pool, 'site_monitor_api', async (client) => {
      const result = await client.query<{ display_name: string; resource_version: string }>(
        'SELECT display_name, resource_version FROM security_api.update_current_user_profile($1,$2,$3)',
        [created.owner_id, 2, 'Updated Auth Flow'],
      );
      return result.rows[0]!;
    });
    expect(profile).toEqual({ display_name: 'Updated Auth Flow', resource_version: '3' });
    const staleProfile = await withRoleCommit(pool, 'site_monitor_api', async (client) =>
      client.query('SELECT * FROM security_api.update_current_user_profile($1,$2,$3)', [
        created.owner_id,
        2,
        'Stale Update',
      ]),
    );
    expect(staleProfile.rowCount).toBe(0);

    const upgraded = await withRoleCommit(pool, 'site_monitor_api', async (client) => {
      const result = await client.query<{ upgraded: boolean }>(
        'SELECT security_api.upgrade_password_hash($1,$2,$3,$4) AS upgraded',
        [
          created.owner_id,
          1,
          '$argon2id$v=19$m=19456,t=2,p=1$placeholder',
          '$argon2id$v=19$m=65536,t=3,p=1$upgraded',
        ],
      );
      return result.rows[0]!;
    });
    expect(upgraded.upgraded).toBe(true);

    const throttle = await withRoleCommit(pool, 'site_monitor_api', async (client) => {
      await client.query(`SELECT * FROM security_api.consume_rate_limit($1,'test.policy',1,60)`, [
        Buffer.alloc(32, 43),
      ]);
      const result = await client.query<{ allowed: boolean }>(
        `SELECT allowed FROM security_api.consume_rate_limit($1,'test.policy',1,60)`,
        [Buffer.alloc(32, 43)],
      );
      return result.rows[0]!;
    });
    expect(throttle.allowed).toBe(false);

    const delivery = await withRoleCommit(pool, 'site_monitor_notifier', async (client) => {
      const claimed = await client.query<{ delivery_id: string; fencing_token: string }>(
        `SELECT delivery_id, fencing_token FROM security_api.claim_transactional_email('test-worker',60)`,
      );
      const row = claimed.rows[0]!;
      const completed = await client.query<{ accepted: boolean }>(
        `SELECT security_api.complete_transactional_email(
          $1,'test-worker',$2,'SENT','smtp_accepted','message-id',30
        ) AS accepted`,
        [row.delivery_id, row.fencing_token],
      );
      return completed.rows[0]!;
    });
    expect(delivery.accepted).toBe(true);

    await expect(
      withRole(pool, 'site_monitor_api', null, async (client) => {
        await client.query('SELECT id FROM notification.transactional_email_deliveries');
        return {};
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('blocks cross-owner foreign-key links and duplicate active jobs', async () => {
    await expect(
      pool.query(
        `
          INSERT INTO app.maintenance_windows
            (owner_id, check_id, note, starts_at, ends_at)
          VALUES ($1, $2, 'Invalid owner link', statement_timestamp(), statement_timestamp() + interval '1 hour')
        `,
        [ownerA, checkB],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const jobValues = [ownerA, checkA, JSON.stringify({ url: 'http://target-simulator:4010/ok' })];
    await pool.query(
      `
        INSERT INTO monitoring.check_jobs
          (owner_id, check_id, trigger_kind, scheduled_for, config_snapshot, resource_version, probe_generation, schedule_generation)
        VALUES ($1, $2, 'SCHEDULED', statement_timestamp(), $3::jsonb, 1, 1, 1)
      `,
      jobValues,
    );
    await expect(
      pool.query(
        `
          INSERT INTO monitoring.check_jobs
            (owner_id, check_id, trigger_kind, scheduled_for, config_snapshot, resource_version, probe_generation, schedule_generation)
          VALUES ($1, $2, 'SCHEDULED', statement_timestamp(), $3::jsonb, 1, 1, 1)
        `,
        jobValues,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('restricts service roles and exposes only the public snapshot function', async () => {
    await pool.query(
      `
        UPDATE public_status.pages
        SET state = 'PUBLISHED', published_at = statement_timestamp(), updated_at = statement_timestamp()
        WHERE id = '00000000-0000-4000-8000-000000000501'
      `,
    );
    await pool.query(
      `
        INSERT INTO public_status.snapshots
          (page_id, owner_id, slug_digest, page_revision, payload_schema_version, payload)
        VALUES (
          '00000000-0000-4000-8000-000000000501',
          $1,
          decode(repeat('22', 32), 'hex'),
          1,
          1,
          '{"title":"Demo Status","components":[]}'::jsonb
        );
      `,
      [ownerA],
    );

    const publicPayload = await withRole(pool, 'site_monitor_public', null, async (client) => {
      const result = await client.query<{ payload: { title: string } }>(
        `SELECT payload FROM security_api.read_public_snapshot(decode(repeat('22', 32), 'hex'))`,
      );
      return result.rows[0] ?? { payload: { title: '' } };
    });
    expect(publicPayload.payload.title).toBe('Demo Status');

    await expect(
      withRole(pool, 'site_monitor_public', null, async (client) => {
        await client.query('SELECT id FROM app.checks');
        return {};
      }),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      withRole(pool, 'site_monitor_predictor', null, async (client) => {
        await client.query(`UPDATE monitoring.check_current_states SET health_state = 'DOWN'`);
        return {};
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('isolates idempotency receipts and enforces bounded sanitized storage', async () => {
    const insertReceipt = `
      INSERT INTO infra.api_idempotency_records
        (owner_id, subject_digest, operation, key_digest, request_hash, response_status, response_headers, response_body, expires_at)
      VALUES
        ($1, decode(repeat($2, 32), 'hex'), 'check.create', decode(repeat($3, 32), 'hex'), decode(repeat($4, 32), 'hex'), 201, '{"Location":"/api/v1/checks/example"}'::jsonb, '{"id":"example"}'::jsonb, statement_timestamp() + interval '24 hours')
    `;
    await pool.query(insertReceipt, [ownerA, '11', '12', '13']);
    await pool.query(insertReceipt, [ownerB, '21', '22', '23']);

    const ownerAView = await withRole(pool, 'site_monitor_api', ownerA, async (client) => {
      const result = await client.query<{ owner_id: string }>(
        'SELECT owner_id FROM infra.api_idempotency_records ORDER BY owner_id',
      );
      return { count: result.rowCount ?? 0, ownerId: result.rows[0]?.owner_id ?? '' };
    });
    expect(ownerAView).toEqual({ count: 1, ownerId: ownerA });

    await expect(
      withRole(pool, 'site_monitor_api', ownerA, async (client) => {
        await client.query(
          `
            INSERT INTO infra.api_idempotency_records
              (owner_id, subject_digest, operation, key_digest, request_hash, response_status, expires_at)
            VALUES
              (NULL, decode(repeat('31', 32), 'hex'), 'auth.register', decode(repeat('32', 32), 'hex'), decode(repeat('33', 32), 'hex'), 202, statement_timestamp() + interval '24 hours')
          `,
        );
        return {};
      }),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      pool.query(
        `
          INSERT INTO infra.api_idempotency_records
            (owner_id, subject_digest, operation, key_digest, request_hash, response_status, response_headers, expires_at)
          VALUES
            ($1, decode(repeat('41', 32), 'hex'), 'check.create', decode(repeat('42', 32), 'hex'), decode(repeat('43', 32), 'hex'), 201, '{"Set-Cookie":"forbidden"}'::jsonb, statement_timestamp() + interval '24 hours')
        `,
        [ownerA],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('starts runtime pools in their restricted database role', async () => {
    const apiPool = createDatabasePool({
      applicationName: 'database-role-integration-test',
      connectionString,
      databaseRole: 'site_monitor_api',
      maxConnections: 1,
    });
    try {
      const identity = await apiPool.query<{ current_user: string; session_user: string }>(
        'SELECT current_user, session_user',
      );
      expect(identity.rows[0]?.current_user).toBe('site_monitor_api');
      expect(identity.rows[0]?.session_user === 'site_monitor_api').toBe(false);
      expect((await apiPool.query('SELECT id FROM app.checks')).rowCount).toBe(0);
      await expect(isDatabaseReady(apiPool)).resolves.toBe(true);

      const typedDatabase = createQueryDatabase(apiPool);
      await expect(
        typedDatabase.selectFrom('app.checks').select(['id', 'name']).execute(),
      ).resolves.toEqual([]);
    } finally {
      await apiPool.end();
    }
  });

  it('creates required partitions and critical indexes', async () => {
    const result = await pool.query<{ default_rows: string; partition_count: string }>(`
      SELECT
        (SELECT count(*)::text FROM monitoring.check_runs_default) AS default_rows,
        (
          SELECT count(*)::text
          FROM pg_inherits
          WHERE inhparent IN (
            'monitoring.check_runs'::regclass,
            'monitoring.health_intervals'::regclass,
            'monitoring.rollups_minute'::regclass,
            'monitoring.rollups_hour'::regclass,
            'prediction.scores'::regclass,
            'audit.events'::regclass
          )
        ) AS partition_count
    `);
    expect(result.rows[0]?.default_rows).toBe('0');
    expect(Number(result.rows[0]?.partition_count ?? 0)).toBeGreaterThanOrEqual(32);

    const indexes = await pool.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE indexname IN (
        'checks_due_idx',
        'check_jobs_one_active_per_check_idx',
        'incidents_one_open_per_check_idx',
        'notification_deliveries_idempotency_unique',
        'public_snapshots_slug_unique'
      )
    `);
    expect(new Set(indexes.rows.map((row) => row.indexname))).toEqual(
      new Set([
        'checks_due_idx',
        'check_jobs_one_active_per_check_idx',
        'incidents_one_open_per_check_idx',
        'notification_deliveries_idempotency_unique',
        'public_snapshots_slug_unique',
      ]),
    );

    const ownerPrivilege = await pool.query<{ can_create: boolean }>(`
      SELECT has_database_privilege(
        'site_monitor_schema_owner',
        current_database(),
        'CREATE'
      ) AS can_create
    `);
    expect(ownerPrivilege.rows[0]?.can_create).toBe(false);
  });

  it('refuses reset without explicit non-production acknowledgement', async () => {
    await expect(resetDatabase(pool, connectionString, { NODE_ENV: 'test' })).rejects.toThrow(
      /ALLOW_DATABASE_RESET=true/,
    );
    await expect(
      resetDatabase(pool, connectionString, {
        ALLOW_DATABASE_RESET: 'true',
        NODE_ENV: 'production',
      }),
    ).rejects.toThrow(/forbidden in production/);
  });

  it('resets an explicitly approved test database back to the migration head', async () => {
    const result = await resetDatabase(pool, connectionString, {
      ALLOW_DATABASE_RESET: 'true',
      NODE_ENV: 'test',
    });
    expect(result.currentRevision).toBe(TARGET_SCHEMA_REVISION);
    expect(result.applied).toEqual(
      Array.from({ length: TARGET_SCHEMA_REVISION }, (_, index) => index + 1),
    );
    expect((await pool.query('SELECT id FROM auth.users')).rowCount).toBe(0);
  });
});
