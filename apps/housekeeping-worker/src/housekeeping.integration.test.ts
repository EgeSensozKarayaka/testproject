import { randomUUID } from 'node:crypto';

import { createDatabasePool, type Pool } from '@site-monitor/database';
import { dropTestDatabase } from '@site-monitor/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HousekeepingStore } from './store.js';

const adminConnectionString = process.env.DATABASE_TEST_ADMIN_URL;
const databaseSuite = adminConnectionString ? describe : describe.skip;

function quotedIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/u.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function databaseUrl(adminUrl: string, databaseName: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

databaseSuite('housekeeping runtime', () => {
  const databaseName = `site_monitor_housekeeping_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerId = randomUUID();
  const groupId = randomUUID();
  const checkId = randomUUID();
  const jobId = randomUUID();
  const attemptId = randomUUID();
  const runId = randomUUID();
  const intervalId = randomUUID();
  let adminPool: Pool;
  let pool: Pool;
  let replicaOnePool: Pool;
  let replicaTwoPool: Pool;
  let replicaOne: HousekeepingStore;
  let replicaTwo: HousekeepingStore;
  let bucketStart: Date;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'housekeeping-test-admin',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    const connectionString = databaseUrl(adminConnectionString!, databaseName);
    pool = createDatabasePool({
      applicationName: 'housekeeping-test-setup',
      connectionString,
      maxConnections: 2,
    });
    const { runMigrations } = await import('@site-monitor/database');
    await runMigrations(pool, { appBuild: 'housekeeping-integration-test' });

    bucketStart = new Date(Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000);
    const runFinishedAt = new Date(bucketStart.getTime() + 30_000);
    await pool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES ($1, 'housekeeping@example.test', 'housekeeping@example.test',
               'Housekeeping Owner', 'ACTIVE', statement_timestamp())`,
      [ownerId],
    );
    await pool.query('INSERT INTO app.check_groups (id, owner_id, name) VALUES ($1,$2,$3)', [
      groupId,
      ownerId,
      'Housekeeping Group',
    ]);
    await pool.query(
      `INSERT INTO app.checks
         (id, owner_id, group_id, name, url, interval_seconds, timeout_ms,
          expected_status_code, next_run_at)
       VALUES ($1,$2,$3,'Housekeeping Check','https://housekeeping.example.test',
               30,5000,200,statement_timestamp())`,
      [checkId, ownerId, groupId],
    );
    await pool.query(
      `INSERT INTO monitoring.check_jobs
         (id, owner_id, check_id, trigger_kind, scheduled_for, state,
          config_snapshot, resource_version, probe_generation,
          schedule_generation, attempt_count, completed_at, terminal_reason,
          created_at, updated_at)
       VALUES ($1,$2,$3,'SCHEDULED',$4,'COMPLETED','{}'::jsonb,1,1,1,1,$5,
               'RESULT_RECORDED',$4,$5)`,
      [jobId, ownerId, checkId, new Date(runFinishedAt.getTime() - 10_000), runFinishedAt],
    );
    await pool.query(
      `INSERT INTO monitoring.check_job_attempts
         (id, owner_id, check_id, job_id, attempt_number, worker_id,
          fencing_token, lease_acquired_at, started_at, ended_at, terminal_reason)
       VALUES ($1,$2,$3,$4,1,'housekeeping-test-worker',1,$5,$6,$7,'RESULT_RECORDED')`,
      [
        attemptId,
        ownerId,
        checkId,
        jobId,
        new Date(runFinishedAt.getTime() - 9_000),
        new Date(runFinishedAt.getTime() - 8_000),
        runFinishedAt,
      ],
    );
    await pool.query(
      `INSERT INTO monitoring.check_runs
         (finished_at, id, owner_id, check_id, job_id, attempt_id, trigger_kind,
          resource_version, probe_generation, schedule_generation, fencing_token,
          scheduled_for, started_at, total_ms, status_code, body_match,
          outcome, accepted_for_state)
       VALUES ($1,$2,$3,$4,$5,$6,'SCHEDULED',1,1,1,1,$7,$8,120,200,true,'PASS',true)`,
      [
        runFinishedAt,
        runId,
        ownerId,
        checkId,
        jobId,
        attemptId,
        new Date(runFinishedAt.getTime() - 10_000),
        new Date(runFinishedAt.getTime() - 8_000),
      ],
    );
    await pool.query(
      `INSERT INTO monitoring.health_intervals
         (started_at, id, owner_id, check_id, ended_at, classification,
          probe_generation, source_kind)
       VALUES ($1,$2,$3,$4,$5,'UP',1,'STARTUP')`,
      [
        new Date(bucketStart.getTime() + 10_000),
        intervalId,
        ownerId,
        checkId,
        new Date(bucketStart.getTime() + 140_000),
      ],
    );

    replicaOnePool = createDatabasePool({
      applicationName: 'housekeeping-replica-one',
      connectionString,
      databaseRole: 'site_monitor_housekeeper',
      maxConnections: 2,
    });
    replicaTwoPool = createDatabasePool({
      applicationName: 'housekeeping-replica-two',
      connectionString,
      databaseRole: 'site_monitor_housekeeper',
      maxConnections: 2,
    });
    replicaOne = new HousekeepingStore(replicaOnePool);
    replicaTwo = new HousekeepingStore(replicaTwoPool);
  }, 60_000);

  afterAll(async () => {
    if (replicaOnePool) await replicaOnePool.end();
    if (replicaTwoPool) await replicaTwoPool.end();
    if (pool) await pool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName);
      await adminPool.end();
    }
  }, 30_000);

  it('discovers once and converges across two replicas and a restarted worker', async () => {
    const discovery = await Promise.all([
      replicaOne.discoverSources(100),
      replicaTwo.discoverSources(100),
    ]);
    expect(discovery.reduce((sum, item) => sum + item.runSources, 0)).toBe(1);
    expect(discovery.reduce((sum, item) => sum + item.intervalSources, 0)).toBe(1);

    await expect(replicaOne.retainAndPurge(10)).resolves.toEqual({
      partitionAction: 'DEFERRED_PROJECTION_BACKLOG',
      rowsPurged: 0,
    });

    const firstStep = await replicaOne.processRollup('MINUTE', 1);
    expect(firstStep.bucketsProcessed).toBe(1);

    // A new Store/pool represents process restart. Durable range progress, not
    // process memory, determines where processing resumes.
    const restartPool = createDatabasePool({
      applicationName: 'housekeeping-restarted',
      connectionString: databaseUrl(adminConnectionString!, databaseName),
      databaseRole: 'site_monitor_housekeeper',
      maxConnections: 2,
    });
    const restarted = new HousekeepingStore(restartPool);
    try {
      for (let index = 0; index < 20; index += 1) {
        const [left, right] = await Promise.all([
          restarted.processRollup('MINUTE', 1),
          replicaTwo.processRollup('MINUTE', 1),
        ]);
        if (left.rangeId === null && right.rangeId === null) break;
      }
      for (let index = 0; index < 30; index += 1) {
        const [left, right] = await Promise.all([
          restarted.processRollup('HOUR', 1),
          replicaTwo.processRollup('HOUR', 1),
        ]);
        if (left.rangeId === null && right.rangeId === null) break;
      }
    } finally {
      await restartPool.end();
    }

    const minute = await pool.query<{
      accepted_run_count: number;
      bucket_start: Date;
      up_ms: string;
    }>(
      `SELECT bucket_start, accepted_run_count, up_ms::text
       FROM monitoring.rollups_minute
       WHERE owner_id = $1 AND check_id = $2
       ORDER BY bucket_start`,
      [ownerId, checkId],
    );
    expect(
      minute.rows.map((row) => [row.bucket_start.getTime(), row.accepted_run_count, row.up_ms]),
    ).toEqual([
      [bucketStart.getTime(), 1, '50000'],
      [bucketStart.getTime() + 60_000, 0, '60000'],
      [bucketStart.getTime() + 120_000, 0, '20000'],
    ]);

    const hour = await pool.query<{ accepted_run_count: number; up_ms: string }>(
      `SELECT accepted_run_count, up_ms::text
       FROM monitoring.rollups_hour
       WHERE owner_id = $1 AND check_id = $2`,
      [ownerId, checkId],
    );
    expect(
      hour.rows.reduce(
        (total, row) => ({
          acceptedRunCount: total.acceptedRunCount + row.accepted_run_count,
          upMs: total.upMs + Number.parseInt(row.up_ms, 10),
        }),
        { acceptedRunCount: 0, upMs: 0 },
      ),
    ).toEqual({ acceptedRunCount: 1, upMs: 130_000 });

    const repeated = await replicaOne.discoverSources(100);
    expect(repeated).toEqual({ intervalSources: 0, rangesEnqueued: 0, runSources: 0 });

    const horizons = await pool.query<{ current_count: string }>(
      `SELECT count(*)::text AS current_count
       FROM monitoring.rollup_checkpoints
       WHERE processor_name IN ('runs-minute-source', 'intervals-minute-source')
         AND data_through >= statement_timestamp() - interval '5 minutes'`,
    );
    expect(horizons.rows[0]?.current_count).toBe('2');
  });

  it('reports DEFAULT rows without blocking readiness', async () => {
    const futureBucket = new Date(Date.UTC(2040, 0, 1));
    await pool.query(
      `INSERT INTO monitoring.rollups_minute
         (bucket_start, owner_id, check_id, probe_generation, computed_through)
       VALUES ($1,$2,$3,1,$1)`,
      [futureBucket, ownerId, checkId],
    );

    const status = await replicaOne.ensurePartitions();
    expect(status).toEqual({ defaultRowCount: 1, futurePartitionsReady: true });
    expect(await replicaOne.storageReady()).toBe(true);
  });

  it('detaches an expired partition with grace and performs bounded row purge', async () => {
    await pool.query(
      `SELECT infra.ensure_month_partition(
         'monitoring.rollups_minute'::regclass,
         'monitoring', 'rollups_minute', date '2020-01-01'
       )`,
    );
    await pool.query(
      `INSERT INTO infra.api_idempotency_records
         (subject_digest, operation, key_digest, request_hash,
          response_status, created_at, expires_at)
       VALUES ($1,'housekeeping.test',$2,$3,204,
               statement_timestamp() - interval '2 days',
               statement_timestamp() - interval '1 day')`,
      [Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 3)],
    );

    const result = await replicaOne.retainAndPurge(10);
    expect(result.partitionAction).toBe('DETACHED');
    expect(result.rowsPurged).toBeGreaterThanOrEqual(1);

    const manifest = await pool.query<{
      attached: boolean;
      grace_seconds: string;
      state: string;
    }>(
      `SELECT state,
              extract(epoch FROM (drop_after - detached_at))::bigint::text AS grace_seconds,
              EXISTS (
                SELECT 1 FROM pg_inherits
                WHERE inhrelid = 'monitoring.rollups_minute_2020_01'::regclass
              ) AS attached
       FROM infra.partition_retention_runs
       WHERE child_name = 'rollups_minute_2020_01'`,
    );
    expect(manifest.rows).toEqual([{ attached: false, grace_seconds: '86400', state: 'DETACHED' }]);

    const privileges = await pool.query<{ direct_insert: boolean; function_execute: boolean }>(
      `SELECT
         has_table_privilege(
           'site_monitor_housekeeper', 'monitoring.rollup_rebuild_ranges', 'INSERT'
         ) AS direct_insert,
         has_function_privilege(
           'site_monitor_housekeeper',
           'security_api.housekeeping_process_rollup_range(text,integer)',
           'EXECUTE'
         ) AS function_execute`,
    );
    expect(privileges.rows[0]).toEqual({ direct_insert: false, function_execute: true });
  });
});
