import { randomUUID } from 'node:crypto';
import { appendFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabasePool, createQueryDatabase, isDatabaseReady } from './index.js';
import { getSchemaState, runMigrations, TARGET_SCHEMA_REVISION } from './migrations.js';
import { resetDatabase, runSeeds } from './operations.js';

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
  role: 'site_monitor_api' | 'site_monitor_predictor' | 'site_monitor_public',
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

databaseSuite('PostgreSQL persistence architecture', () => {
  const databaseName = `site_monitor_phase3_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerA = '00000000-0000-4000-8000-000000000001';
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
      await adminPool.query(
        `DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)} WITH (FORCE)`,
      );
      await adminPool.end();
    }
  }, 30_000);

  it('migrates from zero, records checksums, and is idempotent', async () => {
    const first = await runMigrations(pool, { appBuild: 'integration-test' });
    expect(first.currentRevision).toBe(TARGET_SCHEMA_REVISION);
    expect(first.applied).toEqual([1, 2, 3, 4, 5, 6]);

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

  it('blocks cross-owner foreign-key links and duplicate active jobs', async () => {
    await expect(
      pool.query(
        `
          INSERT INTO app.maintenance_windows
            (owner_id, check_id, name, starts_at, ends_at)
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
    expect(result.applied).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await pool.query('SELECT id FROM auth.users')).rowCount).toBe(0);
  });
});
