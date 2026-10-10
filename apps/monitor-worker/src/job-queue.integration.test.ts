import { randomUUID } from 'node:crypto';

import { createDatabasePool, runMigrations, type Pool } from '@site-monitor/database';
import { dropTestDatabase } from '@site-monitor/database/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type ClaimedJob, PostgresJobQueue } from './job-queue.js';

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

databaseSuite('monitor PostgreSQL job queue', () => {
  const databaseName = `site_monitor_queue_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerA = '00000000-0000-4000-8000-000000000101';
  const ownerB = '00000000-0000-4000-8000-000000000102';
  let adminPool: Pool;
  let monitorPool: Pool;
  let schemaPool: Pool;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'job-queue-admin-test',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    const connectionString = databaseUrl(adminConnectionString!, databaseName);
    schemaPool = createDatabasePool({
      applicationName: 'job-queue-schema-test',
      connectionString,
      maxConnections: 4,
    });
    await runMigrations(schemaPool, { appBuild: 'job-queue-integration-test' });
    await schemaPool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES
         ($1, 'queue-a@example.test', 'queue-a@example.test', 'Queue A', 'ACTIVE', statement_timestamp()),
         ($2, 'queue-b@example.test', 'queue-b@example.test', 'Queue B', 'ACTIVE', statement_timestamp())`,
      [ownerA, ownerB],
    );
    await schemaPool.query(
      `INSERT INTO infra.destination_activations
         (destination, activated_at, activated_by_revision)
       VALUES ('AUDIT', statement_timestamp(), 14)`,
    );
    monitorPool = createDatabasePool({
      applicationName: 'job-queue-monitor-test',
      connectionString,
      databaseRole: 'site_monitor_monitor',
      maxConnections: 8,
    });
  }, 30_000);

  beforeEach(async () => {
    await schemaPool.query(`DELETE FROM audit.events`);
    await schemaPool.query(`DELETE FROM infra.outbox_dispatches`);
    await schemaPool.query(`DELETE FROM infra.outbox_events`);
    await schemaPool.query(`DELETE FROM monitoring.check_job_attempts`);
    await schemaPool.query(`DELETE FROM monitoring.check_jobs`);
    await schemaPool.query(`DELETE FROM app.checks`);
  });

  afterAll(async () => {
    if (monitorPool) await monitorPool.end();
    if (schemaPool) await schemaPool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName);
      await adminPool.end();
    }
  }, 30_000);

  async function insertCheck(input: {
    id: string;
    manualMode?: 'DIAGNOSTIC' | 'STATEFUL';
    ownerId: string;
    paused?: boolean;
  }): Promise<void> {
    await schemaPool.query(
      `INSERT INTO app.checks
         (id, owner_id, name, url, interval_seconds, timeout_ms,
          expected_status_code, expected_body_substring, execution_state,
          cadence_anchor_at, next_run_at, manual_requested_at, manual_requested_mode)
       VALUES ($1, $2, 'Queue fixture', $3, 30, 5000, 200, 'healthy',
               $4, '2026-01-01T00:00:05.250Z',
               CASE WHEN $4 = 'ACTIVE' THEN '2026-01-01T00:00:05.250Z'::timestamptz ELSE NULL END,
               CASE WHEN $5::text IS NOT NULL THEN '2026-10-10T01:00:00Z'::timestamptz ELSE NULL END,
               $5)`,
      [
        input.id,
        input.ownerId,
        `https://${input.id.slice(-4)}.example.test/status?secret=never-emit`,
        input.paused ? 'PAUSED' : 'ACTIVE',
        input.manualMode ?? null,
      ],
    );
  }

  async function insertPendingJob(input: {
    checkId: string;
    id: string;
    manual?: boolean;
    ownerId: string;
  }): Promise<void> {
    await schemaPool.query(
      `INSERT INTO monitoring.check_jobs
         (id, owner_id, check_id, trigger_kind, manual_mode, scheduled_for,
          available_at, priority, state, config_snapshot, resource_version,
          probe_generation, schedule_generation)
       SELECT $1, $2, $3,
              CASE WHEN $4 THEN 'MANUAL' ELSE 'SCHEDULED' END,
              CASE WHEN $4 THEN 'STATEFUL' ELSE NULL END,
              '2026-10-10T01:00:00Z', '2026-10-10T01:00:00Z',
              CASE WHEN $4 THEN 100 ELSE 0 END, 'PENDING',
              jsonb_build_object(
                'schema_version', 1,
                'expected_body_substring', expected_body_substring,
                'expected_status_code', expected_status_code,
                'interval_seconds', interval_seconds,
                'timeout_ms', timeout_ms,
                'url', url
              ), resource_version, probe_generation, schedule_generation
       FROM app.checks WHERE owner_id = $2 AND id = $3`,
      [input.id, input.ownerId, input.checkId, input.manual ?? false],
    );
  }

  it('materializes manual intent before scheduled work with owner-fair bounded selection', async () => {
    const checks = [
      ['00000000-0000-4000-8000-000000001001', ownerA, 'DIAGNOSTIC'],
      ['00000000-0000-4000-8000-000000001002', ownerA, undefined],
      ['00000000-0000-4000-8000-000000001003', ownerA, undefined],
      ['00000000-0000-4000-8000-000000002001', ownerB, undefined],
    ] as const;
    for (const [id, ownerId, manualMode] of checks) {
      await insertCheck({
        id,
        ...(manualMode ? { manualMode, paused: true } : {}),
        ownerId,
      });
    }

    const queue = new PostgresJobQueue(monitorPool, 'monitor-worker:test-a', 15_000);
    const candidates = await queue.listMaterializationCandidates(2);
    expect(candidates).toEqual([
      { checkId: checks[0][0], ownerId: ownerA },
      { checkId: checks[3][0], ownerId: ownerB },
    ]);

    const jobs = await queue.materializeDueBatch(2);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => [job.ownerId, job.kind, job.manualMode])).toEqual([
      [ownerA, 'MANUAL', 'DIAGNOSTIC'],
      [ownerB, 'SCHEDULED', null],
    ]);

    const state = await schemaPool.query<{
      audits: string;
      events: string;
      manual_requested_at: Date | null;
      manual_requested_mode: string | null;
      next_run_at: Date;
    }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events) AS audits,
         (SELECT count(*)::text FROM infra.outbox_events) AS events,
         manual_requested_at, manual_requested_mode, next_run_at
       FROM app.checks WHERE id = $1`,
      [checks[0][0]],
    );
    expect(state.rows[0]).toMatchObject({
      audits: '2',
      events: '2',
      manual_requested_at: null,
      manual_requested_mode: null,
    });
    const advanced = await schemaPool.query<{ next_run_at: Date }>(
      `SELECT next_run_at FROM app.checks WHERE id = $1`,
      [checks[3][0]],
    );
    expect(advanced.rows[0]!.next_run_at.getTime()).toBeGreaterThan(Date.now());
    expect(
      (advanced.rows[0]!.next_run_at.getTime() - Date.parse('2026-01-01T00:00:05.250Z')) % 30_000,
    ).toBe(0);

    const emissions = await schemaPool.query<{ payloads: unknown }>(
      `SELECT jsonb_agg(payload) AS payloads FROM infra.outbox_events`,
    );
    expect(JSON.stringify(emissions.rows[0]!.payloads)).not.toContain('never-emit');
  });

  it('uses the check lock and active-job invariant to materialize only once', async () => {
    const checkId = '00000000-0000-4000-8000-000000003001';
    await insertCheck({ id: checkId, ownerId: ownerA });
    const first = new PostgresJobQueue(monitorPool, 'monitor-worker:race-a', 15_000);
    const second = new PostgresJobQueue(monitorPool, 'monitor-worker:race-b', 15_000);

    const results = await Promise.all([
      first.materializeCandidate({ checkId, ownerId: ownerA }),
      second.materializeCandidate({ checkId, ownerId: ownerA }),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(['MATERIALIZED', 'SKIPPED']);
    const persisted = await schemaPool.query<{ jobs: string }>(
      `SELECT count(*)::text AS jobs FROM monitoring.check_jobs WHERE check_id = $1`,
      [checkId],
    );
    expect(persisted.rows[0]!.jobs).toBe('1');
  });

  it('claims owner-fair work exactly once and fences heartbeat ownership', async () => {
    const fixtures = [
      [
        '00000000-0000-4000-8000-000000004001',
        '00000000-0000-7000-8000-000000004001',
        ownerA,
        true,
      ],
      [
        '00000000-0000-4000-8000-000000004002',
        '00000000-0000-7000-8000-000000004002',
        ownerA,
        false,
      ],
      [
        '00000000-0000-4000-8000-000000004003',
        '00000000-0000-7000-8000-000000004003',
        ownerA,
        false,
      ],
      [
        '00000000-0000-4000-8000-000000005001',
        '00000000-0000-7000-8000-000000005001',
        ownerB,
        false,
      ],
    ] as const;
    for (const [checkId, id, ownerId, manual] of fixtures) {
      await insertCheck({ id: checkId, ownerId });
      await insertPendingJob({ checkId, id, manual, ownerId });
    }

    const workerA = new PostgresJobQueue(monitorPool, 'monitor-worker:claim-a', 15_000);
    const workerB = new PostgresJobQueue(monitorPool, 'monitor-worker:claim-b', 15_000);
    const candidates = await workerA.listClaimCandidates(2);
    expect(candidates.map((candidate) => candidate.ownerId)).toEqual([ownerA, ownerB]);
    expect(candidates[0]!.jobId).toBe(fixtures[0][1]);

    const attempts = await Promise.all([
      workerA.claimCandidate(candidates[0]!),
      workerB.claimCandidate(candidates[0]!),
    ]);
    expect(attempts.map((result) => result.outcome).sort()).toEqual(['CLAIMED', 'SKIPPED']);
    const claimedIndex = attempts.findIndex((result) => result.outcome === 'CLAIMED');
    const claimed = (attempts[claimedIndex] as { job: ClaimedJob; outcome: 'CLAIMED' }).job;
    const owner = claimedIndex === 0 ? workerA : workerB;
    const stranger = owner === workerA ? workerB : workerA;

    await expect(
      owner.startClaim({ ...claimed, attemptId: '00000000-0000-7000-8000-000000009999' }),
    ).resolves.toEqual({ outcome: 'LEASE_LOST' });
    await expect(owner.startClaim(claimed)).resolves.toMatchObject({ outcome: 'ACTIVE' });
    await expect(stranger.heartbeat(claimed)).resolves.toEqual({ outcome: 'LEASE_LOST' });
    await expect(owner.heartbeat(claimed)).resolves.toMatchObject({ outcome: 'ACTIVE' });

    await schemaPool.query(
      `UPDATE monitoring.check_jobs
       SET cancellation_requested_at = statement_timestamp(), cancellation_reason = 'CHECK_PAUSED'
       WHERE id = $1`,
      [claimed.jobId],
    );
    await expect(owner.heartbeat(claimed)).resolves.toEqual({
      cancellationReason: 'CHECK_PAUSED',
      outcome: 'CANCELLATION_REQUESTED',
    });

    const persisted = await schemaPool.query<{
      attempt_count: number;
      attempts: string;
      fencing_token: string;
      next_fencing_token: string;
      state: string;
    }>(
      `SELECT job.attempt_count, job.fencing_token::text, job.state,
              check_row.next_fencing_token::text,
              (SELECT count(*)::text FROM monitoring.check_job_attempts a
               WHERE a.job_id = job.id) AS attempts
       FROM monitoring.check_jobs AS job
       JOIN app.checks AS check_row
         ON check_row.owner_id = job.owner_id AND check_row.id = job.check_id
       WHERE job.id = $1`,
      [claimed.jobId],
    );
    expect(persisted.rows[0]).toEqual({
      attempt_count: 1,
      attempts: '1',
      fencing_token: '1',
      next_fencing_token: '2',
      state: 'RUNNING',
    });
  });

  it('acknowledges cancellation and atomically materializes coalesced manual intent', async () => {
    const checkId = '00000000-0000-4000-8000-000000006001';
    const jobId = '00000000-0000-7000-8000-000000006001';
    await insertCheck({ id: checkId, ownerId: ownerA });
    await insertPendingJob({ checkId, id: jobId, ownerId: ownerA });

    const queue = new PostgresJobQueue(monitorPool, 'monitor-worker:cancel', 15_000);
    const claim = await queue.claimCandidate({ checkId, jobId, ownerId: ownerA });
    if (claim.outcome !== 'CLAIMED') throw new Error('Fixture job was not claimed.');
    await expect(queue.startClaim(claim.job)).resolves.toMatchObject({ outcome: 'ACTIVE' });

    await schemaPool.query(
      `UPDATE app.checks
       SET manual_requested_at = statement_timestamp(), manual_requested_mode = 'STATEFUL'
       WHERE owner_id = $1 AND id = $2`,
      [ownerA, checkId],
    );
    await schemaPool.query(
      `UPDATE monitoring.check_jobs
       SET cancellation_requested_at = statement_timestamp(),
           cancellation_reason = 'CONFIGURATION_CHANGED'
       WHERE owner_id = $1 AND check_id = $2 AND id = $3`,
      [ownerA, checkId, jobId],
    );

    const settlement = await queue.settleInfrastructureFault(claim.job, 'CANCELLED');
    expect(settlement).toMatchObject({ outcome: 'CANCELLED' });
    if (settlement.outcome !== 'CANCELLED') throw new Error('Cancellation was not settled.');
    expect(settlement.manualJobId).toEqual(expect.any(String));

    const persisted = await schemaPool.query<{
      active_jobs: string;
      attempt_reason: string;
      manual_requested_at: Date | null;
      manual_requested_mode: string | null;
      old_reason: string;
      old_state: string;
      replacement_mode: string;
      replacement_state: string;
      replacement_trigger: string;
    }>(
      `SELECT old.state AS old_state, old.terminal_reason AS old_reason,
              attempt.terminal_reason AS attempt_reason,
              replacement.state AS replacement_state,
              replacement.trigger_kind AS replacement_trigger,
              replacement.manual_mode AS replacement_mode,
              check_row.manual_requested_at, check_row.manual_requested_mode,
              (SELECT count(*)::text FROM monitoring.check_jobs active
               WHERE active.owner_id = old.owner_id AND active.check_id = old.check_id
                 AND active.state IN ('PENDING', 'LEASED', 'RUNNING')) AS active_jobs
       FROM monitoring.check_jobs AS old
       JOIN monitoring.check_job_attempts AS attempt ON attempt.job_id = old.id
       JOIN monitoring.check_jobs AS replacement ON replacement.id = $2
       JOIN app.checks AS check_row
         ON check_row.owner_id = old.owner_id AND check_row.id = old.check_id
       WHERE old.id = $1`,
      [jobId, settlement.manualJobId],
    );
    expect(persisted.rows[0]).toEqual({
      active_jobs: '1',
      attempt_reason: 'CANCELLED',
      manual_requested_at: null,
      manual_requested_mode: null,
      old_reason: 'CONFIGURATION_CHANGED',
      old_state: 'CANCELLED',
      replacement_mode: 'STATEFUL',
      replacement_state: 'PENDING',
      replacement_trigger: 'MANUAL',
    });
  });

  it('retries transient infrastructure faults and dead-letters unsupported snapshots', async () => {
    const retryCheckId = '00000000-0000-4000-8000-000000007001';
    const retryJobId = '00000000-0000-7000-8000-000000007001';
    const deadCheckId = '00000000-0000-4000-8000-000000007002';
    const deadJobId = '00000000-0000-7000-8000-000000007002';
    const exhaustedCheckId = '00000000-0000-4000-8000-000000007003';
    const exhaustedJobId = '00000000-0000-7000-8000-000000007003';
    await insertCheck({ id: retryCheckId, ownerId: ownerA });
    await insertPendingJob({ checkId: retryCheckId, id: retryJobId, ownerId: ownerA });
    await insertCheck({ id: deadCheckId, ownerId: ownerA });
    await insertPendingJob({ checkId: deadCheckId, id: deadJobId, ownerId: ownerA });
    await insertCheck({ id: exhaustedCheckId, ownerId: ownerA });
    await insertPendingJob({
      checkId: exhaustedCheckId,
      id: exhaustedJobId,
      ownerId: ownerA,
    });
    await schemaPool.query(`UPDATE monitoring.check_jobs SET max_attempts = 1 WHERE id = $1`, [
      exhaustedJobId,
    ]);

    const queue = new PostgresJobQueue(monitorPool, 'monitor-worker:faults', 15_000);
    const retryClaim = await queue.claimCandidate({
      checkId: retryCheckId,
      jobId: retryJobId,
      ownerId: ownerA,
    });
    if (retryClaim.outcome !== 'CLAIMED') throw new Error('Retry fixture was not claimed.');
    await queue.startClaim(retryClaim.job);
    const retry = await queue.settleInfrastructureFault(retryClaim.job, 'ENGINE_ERROR');
    expect(retry).toMatchObject({ outcome: 'RETRY_SCHEDULED' });

    const deadClaim = await queue.claimCandidate({
      checkId: deadCheckId,
      jobId: deadJobId,
      ownerId: ownerA,
    });
    if (deadClaim.outcome !== 'CLAIMED') throw new Error('Dead fixture was not claimed.');
    await queue.startClaim(deadClaim.job);
    const dead = await queue.settleInfrastructureFault(deadClaim.job, 'UNSUPPORTED_JOB_SNAPSHOT');
    expect(dead).toEqual({ manualJobId: null, outcome: 'DEAD' });

    const exhaustedClaim = await queue.claimCandidate({
      checkId: exhaustedCheckId,
      jobId: exhaustedJobId,
      ownerId: ownerA,
    });
    if (exhaustedClaim.outcome !== 'CLAIMED') {
      throw new Error('Exhausted fixture was not claimed.');
    }
    await queue.startClaim(exhaustedClaim.job);
    await expect(
      queue.settleInfrastructureFault(exhaustedClaim.job, 'ENGINE_ERROR'),
    ).resolves.toEqual({ manualJobId: null, outcome: 'DEAD' });

    const persisted = await schemaPool.query<{
      attempt_reason: string;
      available_at: Date;
      completed_at: Date | null;
      job_id: string;
      state: string;
      terminal_reason: string | null;
    }>(
      `SELECT job.id::text AS job_id, job.state, job.available_at, job.completed_at,
              job.terminal_reason, attempt.terminal_reason AS attempt_reason
       FROM monitoring.check_jobs AS job
       JOIN monitoring.check_job_attempts AS attempt ON attempt.job_id = job.id
       WHERE job.id IN ($1, $2, $3)
       ORDER BY job.id`,
      [retryJobId, deadJobId, exhaustedJobId],
    );
    expect(persisted.rows).toEqual([
      expect.objectContaining({
        attempt_reason: 'INTERNAL_ERROR',
        completed_at: null,
        job_id: retryJobId,
        state: 'PENDING',
        terminal_reason: null,
      }),
      expect.objectContaining({
        attempt_reason: 'INTERNAL_ERROR',
        job_id: deadJobId,
        state: 'DEAD',
        terminal_reason: 'UNSUPPORTED_JOB_SNAPSHOT',
      }),
      expect.objectContaining({
        attempt_reason: 'INTERNAL_ERROR',
        job_id: exhaustedJobId,
        state: 'DEAD',
        terminal_reason: 'ENGINE_ERROR_RETRY_EXHAUSTED',
      }),
    ]);
    expect(persisted.rows[0]!.available_at.getTime()).toBeGreaterThan(Date.now());
    expect(persisted.rows[1]!.completed_at).toBeInstanceOf(Date);
    expect(persisted.rows[2]!.completed_at).toBeInstanceOf(Date);
  });

  it('recovers one expired lease once under concurrent sweepers', async () => {
    const checkId = '00000000-0000-4000-8000-000000008001';
    const jobId = '00000000-0000-7000-8000-000000008001';
    await insertCheck({ id: checkId, ownerId: ownerB });
    await insertPendingJob({ checkId, id: jobId, ownerId: ownerB });

    const owner = new PostgresJobQueue(monitorPool, 'monitor-worker:expired-owner', 15_000);
    const first = new PostgresJobQueue(monitorPool, 'monitor-worker:sweeper-a', 15_000);
    const second = new PostgresJobQueue(monitorPool, 'monitor-worker:sweeper-b', 15_000);
    const claim = await owner.claimCandidate({ checkId, jobId, ownerId: ownerB });
    if (claim.outcome !== 'CLAIMED') throw new Error('Expired fixture was not claimed.');
    await owner.startClaim(claim.job);
    await schemaPool.query(
      `UPDATE monitoring.check_jobs
       SET lease_expires_at = statement_timestamp() - interval '1 second'
       WHERE owner_id = $1 AND check_id = $2 AND id = $3`,
      [ownerB, checkId, jobId],
    );

    await expect(first.listExpiredLeaseCandidates(10)).resolves.toEqual([
      { checkId, jobId, ownerId: ownerB },
    ]);
    const settlements = await Promise.all([
      first.recoverExpiredLease({ checkId, jobId, ownerId: ownerB }),
      second.recoverExpiredLease({ checkId, jobId, ownerId: ownerB }),
    ]);
    expect(settlements.map((item) => item.outcome).sort()).toEqual(['RETRY_SCHEDULED', 'STALE']);

    const persisted = await schemaPool.query<{
      attempt_reason: string;
      fencing_token: string | null;
      lease_owner: string | null;
      state: string;
    }>(
      `SELECT job.state, job.lease_owner, job.fencing_token::text,
              attempt.terminal_reason AS attempt_reason
       FROM monitoring.check_jobs AS job
       JOIN monitoring.check_job_attempts AS attempt ON attempt.job_id = job.id
       WHERE job.id = $1`,
      [jobId],
    );
    expect(persisted.rows[0]).toEqual({
      attempt_reason: 'LEASE_LOST',
      fencing_token: null,
      lease_owner: null,
      state: 'PENDING',
    });
  });

  it('cancels rather than retries an expired lease with a cancellation request', async () => {
    const checkId = '00000000-0000-4000-8000-000000009001';
    const jobId = '00000000-0000-7000-8000-000000009001';
    await insertCheck({ id: checkId, ownerId: ownerB });
    await insertPendingJob({ checkId, id: jobId, ownerId: ownerB });

    const owner = new PostgresJobQueue(monitorPool, 'monitor-worker:cancel-expired', 15_000);
    const sweeper = new PostgresJobQueue(monitorPool, 'monitor-worker:cancel-sweeper', 15_000);
    const claim = await owner.claimCandidate({ checkId, jobId, ownerId: ownerB });
    if (claim.outcome !== 'CLAIMED') throw new Error('Cancellation fixture was not claimed.');
    await owner.startClaim(claim.job);
    await schemaPool.query(
      `UPDATE monitoring.check_jobs
       SET cancellation_requested_at = statement_timestamp(),
           cancellation_reason = 'CHECK_PAUSED',
           lease_expires_at = statement_timestamp() - interval '1 second'
       WHERE owner_id = $1 AND check_id = $2 AND id = $3`,
      [ownerB, checkId, jobId],
    );

    await expect(sweeper.recoverExpiredLease({ checkId, jobId, ownerId: ownerB })).resolves.toEqual(
      { manualJobId: null, outcome: 'CANCELLED' },
    );
    const persisted = await schemaPool.query<{
      attempt_reason: string;
      state: string;
      terminal_reason: string;
    }>(
      `SELECT job.state, job.terminal_reason,
              attempt.terminal_reason AS attempt_reason
       FROM monitoring.check_jobs AS job
       JOIN monitoring.check_job_attempts AS attempt ON attempt.job_id = job.id
       WHERE job.id = $1`,
      [jobId],
    );
    expect(persisted.rows[0]).toEqual({
      attempt_reason: 'CANCELLED',
      state: 'CANCELLED',
      terminal_reason: 'CHECK_PAUSED',
    });
  });
});
