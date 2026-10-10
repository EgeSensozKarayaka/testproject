import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabasePool } from './index.js';
import { runMigrations, TARGET_SCHEMA_REVISION } from './migrations.js';
import { dropTestDatabase } from './testing.js';

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

databaseSuite('history and retention foundation migration', () => {
  const databaseName = `site_monitor_history_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerId = randomUUID();
  const groupId = randomUUID();
  const checkId = randomUUID();
  const jobId = randomUUID();
  const attemptId = randomUUID();
  const runId = randomUUID();
  const incidentId = randomUUID();
  const segmentId = randomUUID();
  let adminPool: Pool;
  let pool: Pool;
  let legacyMigrations: string;
  let runFinishedAt: Date;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: adminConnectionString, max: 1 });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    pool = createDatabasePool({
      applicationName: 'history-foundation-integration-test',
      connectionString: databaseUrl(adminConnectionString!, databaseName),
    });

    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'site-monitor-history-migrations-'));
    legacyMigrations = path.join(temporaryRoot, 'migrations');
    await cp(path.resolve('database/migrations'), legacyMigrations, { recursive: true });
    const migrationFiles = await readdir(legacyMigrations);
    await Promise.all(
      migrationFiles
        .filter((file) => /^\d{6}_[a-z0-9_]+\.sql$/u.test(file))
        .filter((file) => Number.parseInt(file.slice(0, 6), 10) > 20)
        .map(async (file) => rm(path.join(legacyMigrations, file))),
    );
    const legacy = await runMigrations(pool, {
      appBuild: 'history-foundation-v20',
      directory: legacyMigrations,
    });
    expect(legacy.currentRevision).toBe(20);

    await pool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES ($1, 'history@example.test', 'history@example.test', 'History Owner',
               'ACTIVE', statement_timestamp())`,
      [ownerId],
    );
    await pool.query(
      `INSERT INTO app.check_groups (id, owner_id, name)
       VALUES ($1, $2, 'History Group')`,
      [groupId, ownerId],
    );
    await pool.query(
      `INSERT INTO app.checks
         (id, owner_id, group_id, name, url, interval_seconds, timeout_ms,
          expected_status_code, next_run_at)
       VALUES ($1, $2, $3, 'History Check', 'https://history.example.test',
               30, 5000, 200, statement_timestamp())`,
      [checkId, ownerId, groupId],
    );
    await pool.query(
      `INSERT INTO monitoring.check_jobs
         (id, owner_id, check_id, trigger_kind, scheduled_for, state,
          config_snapshot, resource_version, probe_generation,
          schedule_generation, attempt_count, completed_at, terminal_reason)
       VALUES ($1, $2, $3, 'SCHEDULED', statement_timestamp() - interval '2 minutes',
               'COMPLETED', '{}'::jsonb, 1, 1, 1, 1,
               statement_timestamp(), 'RESULT_RECORDED')`,
      [jobId, ownerId, checkId],
    );
    await pool.query(
      `INSERT INTO monitoring.check_job_attempts
         (id, owner_id, check_id, job_id, attempt_number, worker_id,
          fencing_token, lease_acquired_at, started_at, ended_at, terminal_reason)
       VALUES ($1, $2, $3, $4, 1, 'history-worker', 1,
               statement_timestamp() - interval '110 seconds',
               statement_timestamp() - interval '100 seconds',
               statement_timestamp() - interval '80 seconds', 'RESULT_RECORDED')`,
      [attemptId, ownerId, checkId, jobId],
    );
    const run = await pool.query<{ finished_at: Date }>(
      `INSERT INTO monitoring.check_runs
         (finished_at, id, owner_id, check_id, job_id, attempt_id,
          trigger_kind, resource_version, probe_generation, schedule_generation,
          fencing_token, scheduled_for, started_at, total_ms, status_code,
          body_match, outcome, accepted_for_state)
       VALUES (
         date_trunc('milliseconds', statement_timestamp() - interval '90 seconds'),
         $1, $2, $3, $4, $5, 'SCHEDULED', 1, 1, 1, 1,
         statement_timestamp() - interval '2 minutes',
         statement_timestamp() - interval '100 seconds',
         120, 200, true, 'PASS', true
       )
       RETURNING finished_at`,
      [runId, ownerId, checkId, jobId, attemptId],
    );
    runFinishedAt = run.rows[0]!.finished_at;

    await pool.query(
      `INSERT INTO monitoring.incidents
         (id, owner_id, check_id, status, observation_mode,
          first_failure_run_id, first_failure_run_finished_at,
          confirmation_run_id, confirmation_run_finished_at,
          started_at, confirmed_at, closed_at, closure_reason,
          observed_duration_ms, resource_version)
       VALUES ($1, $2, $3, 'CLOSED', 'OBSERVED', $4, $5::timestamptz,
               $4, $5::timestamptz, $5::timestamptz, $5::timestamptz,
               $5::timestamptz + interval '1 millisecond', 'RECOVERED', 1, 1)`,
      [incidentId, ownerId, checkId, runId, runFinishedAt],
    );
    await pool.query(
      `INSERT INTO monitoring.incident_segments
         (id, owner_id, check_id, incident_id, started_at, ended_at,
          start_run_id, start_run_finished_at, end_run_id,
          end_run_finished_at, close_reason)
       VALUES ($1, $2, $3, $4, $6::timestamptz,
               $6::timestamptz + interval '1 millisecond',
               $5, $6::timestamptz, $5, $6::timestamptz, 'RECOVERED')`,
      [segmentId, ownerId, checkId, incidentId, runId, runFinishedAt],
    );
    await pool.query(
      `INSERT INTO monitoring.check_current_states
         (check_id, owner_id, health_state, freshness_state,
          last_accepted_run_id, last_accepted_run_finished_at,
          last_accepted_fencing_token, last_success_at, last_response_time_ms,
          last_status_code, fresh_until)
       VALUES ($1, $2, 'UP', 'FRESH', $3, $4::timestamptz, 1,
               $4::timestamptz, 120, 200, $4::timestamptz + interval '1 minute')`,
      [checkId, ownerId, runId, runFinishedAt],
    );
    await pool.query(
      `INSERT INTO monitoring.open_health_intervals
         (owner_id, check_id, classification, started_at, probe_generation,
          source_kind, source_run_id, source_run_finished_at)
       VALUES ($1, $2, 'UP', $4::timestamptz, 1, 'RUN', $3, $4::timestamptz)`,
      [ownerId, checkId, runId, runFinishedAt],
    );
    await pool.query(
      `INSERT INTO monitoring.health_intervals
         (started_at, id, owner_id, check_id, ended_at, classification,
          probe_generation, source_kind, source_run_id, source_run_finished_at)
       VALUES ($5::timestamptz - interval '1 minute', $1, $2, $3,
               $5::timestamptz, 'UP', 1, 'RUN', $4, $5::timestamptz)`,
      [randomUUID(), ownerId, checkId, runId, runFinishedAt],
    );
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName);
      await adminPool.end();
    }
    if (legacyMigrations)
      await rm(path.dirname(legacyMigrations), { recursive: true, force: true });
  }, 30_000);

  it('backfills every durable run reference before rewiring foreign keys', async () => {
    const migration = await runMigrations(pool, { appBuild: 'history-foundation-v21' });
    expect(migration).toEqual({
      applied: Array.from({ length: TARGET_SCHEMA_REVISION - 20 }, (_, index) => index + 21),
      currentRevision: TARGET_SCHEMA_REVISION,
    });

    const evidence = await pool.query<{
      evidence_count: string;
      group_id_at_open: string | null;
    }>(
      `SELECT
         (SELECT count(*)::text
          FROM monitoring.run_evidence
          WHERE owner_id = $1 AND check_id = $2 AND id = $3) AS evidence_count,
         (SELECT group_id_at_open::text
          FROM monitoring.incidents
          WHERE id = $4) AS group_id_at_open`,
      [ownerId, checkId, runId, incidentId],
    );
    expect(evidence.rows[0]).toEqual({ evidence_count: '1', group_id_at_open: groupId });

    const constraints = await pool.query<{ constraint_name: string; target: string }>(
      `SELECT constraint_row.conname AS constraint_name,
              constraint_row.confrelid::regclass::text AS target
       FROM pg_constraint AS constraint_row
       WHERE constraint_row.conname = ANY($1::text[])
         AND constraint_row.conparentid = 0
       ORDER BY constraint_row.conname`,
      [
        [
          'check_current_states_last_run_fk',
          'health_intervals_source_run_fk',
          'incident_segments_start_run_fk',
          'incidents_first_run_fk',
          'open_health_intervals_source_run_fk',
        ],
      ],
    );
    expect(constraints.rows).toHaveLength(5);
    expect(constraints.rows.every((row) => row.target === 'monitoring.run_evidence')).toBe(true);

    await pool.query(
      `DELETE FROM monitoring.check_runs
       WHERE owner_id = $1 AND check_id = $2 AND finished_at = $3 AND id = $4`,
      [ownerId, checkId, runFinishedAt, runId],
    );
    await pool.query(`DELETE FROM monitoring.check_job_attempts WHERE id = $1`, [attemptId]);
    await pool.query(`DELETE FROM monitoring.check_jobs WHERE id = $1`, [jobId]);

    const preserved = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM monitoring.run_evidence
       WHERE owner_id = $1 AND check_id = $2 AND finished_at = $3 AND id = $4`,
      [ownerId, checkId, runFinishedAt, runId],
    );
    expect(preserved.rows[0]?.count).toBe('1');
  });

  it('captures new accepted evidence and rejects mismatched queue lineage', async () => {
    const nextJobId = randomUUID();
    const nextAttemptId = randomUUID();
    const nextRunId = randomUUID();
    await pool.query(
      `INSERT INTO monitoring.check_jobs
         (id, owner_id, check_id, trigger_kind, scheduled_for, state,
          config_snapshot, resource_version, probe_generation,
          schedule_generation, attempt_count)
       VALUES ($1, $2, $3, 'SCHEDULED', statement_timestamp() - interval '5 seconds',
               'PENDING', '{}'::jsonb, 1, 1, 1, 1)`,
      [nextJobId, ownerId, checkId],
    );
    await pool.query(
      `INSERT INTO monitoring.check_job_attempts
         (id, owner_id, check_id, job_id, attempt_number, worker_id,
          fencing_token, lease_acquired_at, started_at)
       VALUES ($1, $2, $3, $4, 1, 'history-worker-v21', 2,
               statement_timestamp() - interval '4 seconds',
               statement_timestamp() - interval '3 seconds')`,
      [nextAttemptId, ownerId, checkId, nextJobId],
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE site_monitor_monitor');
      await client.query(
        `INSERT INTO monitoring.check_runs
           (finished_at, id, owner_id, check_id, job_id, attempt_id,
            trigger_kind, resource_version, probe_generation, schedule_generation,
            fencing_token, scheduled_for, started_at, total_ms, status_code,
            body_match, outcome, accepted_for_state)
         VALUES (
           date_trunc('milliseconds', statement_timestamp()),
           $1, $2, $3, $4, $5, 'SCHEDULED', 1, 1, 1, 2,
           statement_timestamp() - interval '5 seconds',
           statement_timestamp() - interval '3 seconds',
           140, 200, true, 'PASS', true
         )`,
        [nextRunId, ownerId, checkId, nextJobId, nextAttemptId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const captured = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM monitoring.run_evidence
       WHERE owner_id = $1 AND check_id = $2 AND id = $3`,
      [ownerId, checkId, nextRunId],
    );
    expect(captured.rows[0]?.count).toBe('1');

    await expect(
      pool.query(
        `INSERT INTO monitoring.check_runs
           (finished_at, id, owner_id, check_id, job_id, attempt_id,
            trigger_kind, resource_version, probe_generation, schedule_generation,
            fencing_token, scheduled_for, started_at, total_ms,
            outcome, failure_category, accepted_for_state, rejection_reason)
         VALUES (
           date_trunc('milliseconds', statement_timestamp() + interval '1 millisecond'),
           $1, $2, $3, $4, $5, 'SCHEDULED', 1, 1, 1, 2,
           statement_timestamp() - interval '5 seconds',
           statement_timestamp() - interval '3 seconds',
           5000, 'FAIL', 'TIMEOUT', false, 'ATTEMPT_NOT_CURRENT'
         )`,
        [randomUUID(), ownerId, checkId, nextJobId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('captures the current group for new incidents and keeps internal tables least-privileged', async () => {
    const newestEvidence = await pool.query<{ finished_at: Date; id: string }>(
      `SELECT finished_at, id::text
       FROM monitoring.run_evidence
       WHERE owner_id = $1 AND check_id = $2
       ORDER BY finished_at DESC
       LIMIT 1`,
      [ownerId, checkId],
    );
    const evidence = newestEvidence.rows[0]!;

    const openedIncidentId = randomUUID();
    await pool.query(
      `INSERT INTO monitoring.incidents
         (id, owner_id, check_id, status, observation_mode,
          first_failure_run_id, first_failure_run_finished_at,
          confirmation_run_id, confirmation_run_finished_at,
          started_at, confirmed_at, observed_duration_ms, resource_version)
       VALUES ($1, $2, $3, 'OPEN', 'OBSERVED', $4, $5, $4, $5,
               $5, $5, 0, 1)`,
      [openedIncidentId, ownerId, checkId, evidence.id, evidence.finished_at],
    );
    const snapshot = await pool.query<{ group_id_at_open: string | null }>(
      `SELECT group_id_at_open::text
       FROM monitoring.incidents
       WHERE id = $1`,
      [openedIncidentId],
    );
    expect(snapshot.rows[0]?.group_id_at_open).toBe(groupId);

    const privileges = await pool.query<{
      evidence_delete: boolean;
      manifest_insert: boolean;
      range_insert: boolean;
    }>(
      `SELECT
         has_table_privilege(
           'site_monitor_housekeeper', 'monitoring.run_evidence', 'DELETE'
         ) AS evidence_delete,
         has_table_privilege(
           'site_monitor_housekeeper', 'infra.partition_retention_runs', 'INSERT'
         ) AS manifest_insert,
         has_table_privilege(
           'site_monitor_housekeeper', 'monitoring.rollup_rebuild_ranges', 'INSERT'
         ) AS range_insert`,
    );
    expect(privileges.rows[0]).toEqual({
      evidence_delete: false,
      manifest_insert: false,
      range_insert: false,
    });
  });
});
