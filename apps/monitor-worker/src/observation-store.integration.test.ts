import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { ProbeResult } from '@site-monitor/check-engine';
import { createDatabasePool, runMigrations, type Pool } from '@site-monitor/database';
import { dropTestDatabase } from '@site-monitor/database/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type ClaimedJob, PostgresJobQueue } from './job-queue.js';
import { PostgresObservationStore } from './observation-store.js';
import { isMonitorStorageReady } from './runtime-coordinator.js';

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

async function listenOnEphemeralPort(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Test server did not receive an IP port.');
  }
  return address.port;
}

async function reserveEphemeralPort(): Promise<number> {
  const server = createServer();
  const port = await listenOnEphemeralPort(server);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForValue<T>(
  operation: () => Promise<T | null> | T | null,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await operation();
    if (value !== null) return value;
    await delay(25);
  }
  throw new Error(`Condition did not become true within ${timeoutMs} ms.`);
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

const passingResult: ProbeResult = {
  bodyMatch: true,
  diagnosticCode: null,
  failureCategory: null,
  outcome: 'PASS',
  redirectCount: 0,
  statusCode: 200,
  timings: { connectMs: 2, dnsMs: 1, tlsMs: 3, totalMs: 12, ttfbMs: 5 },
};

const failingResult: ProbeResult = {
  bodyMatch: null,
  diagnosticCode: 'TOTAL_DEADLINE',
  failureCategory: 'TIMEOUT',
  outcome: 'FAIL',
  redirectCount: 0,
  statusCode: null,
  timings: { connectMs: 2, dnsMs: 1, tlsMs: null, totalMs: 5_000, ttfbMs: null },
};

databaseSuite('monitor PostgreSQL observation store', () => {
  const databaseName = `site_monitor_observation_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerId = '00000000-0000-4000-8000-000000000201';
  let adminPool: Pool;
  let monitorPool: Pool;
  let schemaPool: Pool;
  let testConnectionString: string;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'observation-admin-test',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    const connectionString = databaseUrl(adminConnectionString!, databaseName);
    testConnectionString = connectionString;
    schemaPool = createDatabasePool({
      applicationName: 'observation-schema-test',
      connectionString,
      maxConnections: 4,
    });
    await runMigrations(schemaPool, { appBuild: 'observation-integration-test' });
    await schemaPool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES ($1, 'observation@example.test', 'observation@example.test',
               'Observation Owner', 'ACTIVE', statement_timestamp())`,
      [ownerId],
    );
    await schemaPool.query(
      `INSERT INTO infra.destination_activations
         (destination, activated_at, activated_by_revision)
       VALUES
         ('AUDIT', statement_timestamp(), 14),
         ('NOTIFICATION', statement_timestamp(), 14),
         ('PREDICTION', statement_timestamp(), 14),
         ('REALTIME', statement_timestamp(), 14)`,
    );
    monitorPool = createDatabasePool({
      applicationName: 'observation-monitor-test',
      connectionString,
      databaseRole: 'site_monitor_monitor',
      maxConnections: 8,
    });
  }, 30_000);

  beforeEach(async () => {
    await schemaPool.query(`DELETE FROM audit.events`);
    await schemaPool.query(`DELETE FROM infra.outbox_dispatches`);
    await schemaPool.query(`DELETE FROM infra.outbox_events`);
    await schemaPool.query(`DELETE FROM monitoring.health_intervals`);
    await schemaPool.query(`DELETE FROM monitoring.open_health_intervals`);
    await schemaPool.query(`DELETE FROM monitoring.incident_segments`);
    await schemaPool.query(`DELETE FROM monitoring.check_current_states`);
    await schemaPool.query(`DELETE FROM monitoring.incidents`);
    await schemaPool.query(
      `UPDATE monitoring.check_job_attempts
       SET result_recorded_at = NULL, result_run_finished_at = NULL, result_run_id = NULL`,
    );
    await schemaPool.query(`DELETE FROM monitoring.check_runs`);
    await schemaPool.query(`DELETE FROM monitoring.check_job_attempts`);
    await schemaPool.query(`DELETE FROM monitoring.check_jobs`);
    await schemaPool.query(`DELETE FROM app.maintenance_windows`);
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
    ownerId?: string;
    paused?: boolean;
  }): Promise<void> {
    const checkOwnerId = input.ownerId ?? ownerId;
    await schemaPool.query(
      `INSERT INTO app.checks
         (id, owner_id, name, url, interval_seconds, timeout_ms,
          expected_status_code, expected_body_substring, execution_state,
          cadence_anchor_at, next_run_at)
       VALUES ($1, $2, 'Observation fixture', $3, 30, 5000, 200,
               'healthy', $4, statement_timestamp() - interval '1 minute',
               CASE WHEN $4 = 'ACTIVE' THEN statement_timestamp() - interval '1 second'
                    ELSE NULL END)`,
      [
        input.id,
        checkOwnerId,
        `https://${input.id.slice(-4)}.example.test/status?secret=never-emit`,
        input.paused ? 'PAUSED' : 'ACTIVE',
      ],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.check_current_states (owner_id, check_id)
       VALUES ($1, $2)`,
      [checkOwnerId, input.id],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.open_health_intervals
         (owner_id, check_id, classification, started_at,
          probe_generation, source_kind)
       VALUES ($1, $2, 'UNKNOWN', statement_timestamp() - interval '1 second',
               1, 'STARTUP')`,
      [checkOwnerId, input.id],
    );
  }

  async function insertJob(input: {
    checkId: string;
    id: string;
    manualMode?: 'DIAGNOSTIC' | 'STATEFUL';
  }): Promise<void> {
    await schemaPool.query(
      `INSERT INTO monitoring.check_jobs
         (id, owner_id, check_id, trigger_kind, manual_mode, scheduled_for,
          available_at, priority, state, config_snapshot, resource_version,
          probe_generation, schedule_generation)
       SELECT $1, $2, $3,
              CASE WHEN $4::text IS NULL THEN 'SCHEDULED' ELSE 'MANUAL' END,
              $4, statement_timestamp() - interval '1 second',
              statement_timestamp() - interval '1 second',
              CASE WHEN $4::text IS NULL THEN 0 ELSE 100 END,
              'PENDING',
              jsonb_build_object(
                'schema_version', 1,
                'expected_body_substring', expected_body_substring,
                'expected_status_code', expected_status_code,
                'interval_seconds', interval_seconds,
                'timeout_ms', timeout_ms,
                'url', url
              ), resource_version, probe_generation, schedule_generation
       FROM app.checks WHERE owner_id = $2 AND id = $3`,
      [input.id, ownerId, input.checkId, input.manualMode ?? null],
    );
  }

  async function claimStarted(
    queue: PostgresJobQueue,
    checkId: string,
    jobId: string,
  ): Promise<ClaimedJob> {
    const claim = await queue.claimCandidate({ checkId, jobId, ownerId });
    if (claim.outcome !== 'CLAIMED') throw new Error('Fixture job was not claimed.');
    const started = await queue.startClaim(claim.job);
    if (started.outcome !== 'ACTIVE') throw new Error('Fixture job was not started.');
    return claim.job;
  }

  function runtime(workerId: string) {
    const queue = new PostgresJobQueue(monitorPool, workerId, 15_000);
    return {
      queue,
      store: new PostgresObservationStore(monitorPool, workerId, 5_000, queue),
    };
  }

  async function expireFreshness(checkId: string): Promise<Date> {
    const interval = await schemaPool.query(
      `UPDATE monitoring.open_health_intervals AS open_interval
       SET started_at = state.last_accepted_run_finished_at - interval '1 second'
       FROM monitoring.check_current_states AS state
       WHERE open_interval.owner_id = state.owner_id
         AND open_interval.check_id = state.check_id
         AND state.owner_id = $1 AND state.check_id = $2
         AND state.last_accepted_run_finished_at IS NOT NULL`,
      [ownerId, checkId],
    );
    expect(interval.rowCount).toBe(1);
    const state = await schemaPool.query<{ fresh_until: Date }>(
      `UPDATE monitoring.check_current_states
       SET fresh_until = last_accepted_run_finished_at
       WHERE owner_id = $1 AND check_id = $2
         AND last_accepted_run_finished_at IS NOT NULL
       RETURNING fresh_until`,
      [ownerId, checkId],
    );
    expect(state.rowCount).toBe(1);
    return state.rows[0]!.fresh_until;
  }

  it('passes monitor storage preflight when current and next UTC partitions exist', async () => {
    await expect(isMonitorStorageReady(monitorPool)).resolves.toBe(true);
  });

  it('persists one concurrent result and materializes pending manual intent atomically', async () => {
    const checkId = '00000000-0000-4000-8000-000000010001';
    const jobId = '00000000-0000-7000-8000-000000010001';
    await insertCheck({ id: checkId });
    await insertJob({ checkId, id: jobId });
    const { queue, store } = runtime('monitor-worker:observation-pass');
    const claimed = await claimStarted(queue, checkId, jobId);
    await schemaPool.query(
      `UPDATE app.checks
       SET manual_requested_at = statement_timestamp(), manual_requested_mode = 'STATEFUL'
       WHERE owner_id = $1 AND id = $2`,
      [ownerId, checkId],
    );

    const results = await Promise.all([
      store.persistResult(claimed, passingResult),
      store.persistResult(claimed, passingResult),
    ]);
    const first = results.find((result) => !result.duplicate);
    const replay = results.find((result) => result.duplicate);
    expect(first).toMatchObject({
      accepted: true,
      duplicate: false,
      jobOutcome: 'COMPLETED',
      rejectionReason: null,
    });
    expect(replay).toEqual({
      ...first,
      duplicate: true,
    });

    const persisted = await schemaPool.query<{
      accepted: boolean;
      attempts: string;
      events: string;
      freshness_state: string;
      health_state: string;
      intervals: string;
      job_state: string;
      manual_requested_at: Date | null;
      pending_jobs: string;
      state_version: string;
      terminal_reason: string;
    }>(
      `SELECT state.health_state, state.freshness_state,
              state.state_version::text, run.accepted_for_state AS accepted,
              job.state AS job_state, attempt.terminal_reason,
              (SELECT count(*)::text FROM monitoring.check_runs r
               WHERE r.check_id = $1) AS attempts,
              (SELECT count(*)::text FROM monitoring.health_intervals h
               WHERE h.check_id = $1) AS intervals,
              (SELECT count(*)::text FROM monitoring.check_jobs pending
               WHERE pending.check_id = $1 AND pending.state = 'PENDING') AS pending_jobs,
              check_row.manual_requested_at,
              (SELECT count(*)::text FROM infra.outbox_events) AS events
       FROM monitoring.check_current_states AS state
       JOIN app.checks AS check_row
         ON check_row.owner_id = state.owner_id AND check_row.id = state.check_id
       JOIN monitoring.check_runs AS run
         ON run.owner_id = state.owner_id AND run.check_id = state.check_id
       JOIN monitoring.check_jobs AS job ON job.id = run.job_id
       JOIN monitoring.check_job_attempts AS attempt ON attempt.id = run.attempt_id
       WHERE state.owner_id = $2 AND state.check_id = $1`,
      [checkId, ownerId],
    );
    expect(persisted.rows[0]).toEqual({
      accepted: true,
      attempts: '1',
      events: '5',
      freshness_state: 'FRESH',
      health_state: 'UP',
      intervals: '1',
      job_state: 'COMPLETED',
      manual_requested_at: null,
      pending_jobs: '1',
      state_version: '2',
      terminal_reason: 'RESULT_RECORDED',
    });
    const payloads = await schemaPool.query<{ payloads: unknown }>(
      `SELECT jsonb_agg(payload) AS payloads FROM infra.outbox_events`,
    );
    expect(JSON.stringify(payloads.rows[0]!.payloads)).not.toContain('never-emit');
  });

  it('opens an incident on the second failure and closes it on recovery', async () => {
    const checkId = '00000000-0000-4000-8000-000000010002';
    await insertCheck({ id: checkId });
    const { queue, store } = runtime('monitor-worker:observation-incident');
    for (const [suffix, result] of [
      ['1', failingResult],
      ['2', failingResult],
      ['3', passingResult],
    ] as const) {
      const jobId = `00000000-0000-7000-8000-00000001000${suffix}`;
      await insertJob({ checkId, id: jobId });
      const claimed = await claimStarted(queue, checkId, jobId);
      await store.persistResult(claimed, result);
    }

    const persisted = await schemaPool.query<{
      closed_at: Date;
      closure_reason: string;
      health_state: string;
      observed_duration_ms: string;
      open_incident_id: string | null;
      runs: string;
      segments: string;
      state_version: string;
      status: string;
    }>(
      `SELECT state.health_state, state.open_incident_id, state.state_version::text,
              incident.status, incident.closure_reason, incident.closed_at,
              incident.observed_duration_ms::text,
              (SELECT count(*)::text FROM monitoring.incident_segments segment
               WHERE segment.incident_id = incident.id) AS segments,
              (SELECT count(*)::text FROM monitoring.check_runs run
               WHERE run.check_id = $1) AS runs
       FROM monitoring.check_current_states AS state
       JOIN monitoring.incidents AS incident
         ON incident.owner_id = state.owner_id AND incident.check_id = state.check_id
       WHERE state.owner_id = $2 AND state.check_id = $1`,
      [checkId, ownerId],
    );
    expect(persisted.rows[0]).toMatchObject({
      closure_reason: 'RECOVERED',
      health_state: 'UP',
      open_incident_id: null,
      runs: '3',
      segments: '1',
      state_version: '4',
      status: 'CLOSED',
    });
    expect(persisted.rows[0]!.closed_at).toBeInstanceOf(Date);
    expect(Number(persisted.rows[0]!.observed_duration_ms)).toBeGreaterThan(0);
    const runs = await schemaPool.query<{ finished_at: Date }>(
      `SELECT finished_at
       FROM monitoring.check_runs
       WHERE owner_id = $1 AND check_id = $2
       ORDER BY finished_at, id`,
      [ownerId, checkId],
    );
    expect(runs.rows).toHaveLength(3);
    expect(runs.rows[1]!.finished_at.getTime()).toBeGreaterThan(
      runs.rows[0]!.finished_at.getTime(),
    );
    expect(runs.rows[2]!.finished_at.getTime()).toBeGreaterThan(
      runs.rows[1]!.finished_at.getTime(),
    );
  });

  it('continues probes and incident facts while maintenance is active', async () => {
    const checkId = '00000000-0000-4000-8000-000000010009';
    await insertCheck({ id: checkId });
    await schemaPool.query(
      `INSERT INTO app.maintenance_windows
         (owner_id, check_id, note, starts_at, ends_at)
       VALUES ($1, $2, 'acceptance fixture',
               statement_timestamp() - interval '1 minute',
               statement_timestamp() + interval '1 hour')`,
      [ownerId, checkId],
    );
    const { queue, store } = runtime('monitor-worker:maintenance-acceptance');

    for (const [suffix, result] of [
      ['1', failingResult],
      ['2', failingResult],
      ['3', passingResult],
    ] as const) {
      const jobId = `00000000-0000-7000-8000-00000001009${suffix}`;
      await insertJob({ checkId, id: jobId });
      const claimed = await claimStarted(queue, checkId, jobId);
      await expect(store.persistResult(claimed, result)).resolves.toMatchObject({
        accepted: true,
        jobOutcome: 'COMPLETED',
      });
    }

    const state = await schemaPool.query<{
      health_state: string;
      incident_status: string;
      runs: string;
    }>(
      `SELECT state.health_state, incident.status AS incident_status,
              (SELECT count(*)::text FROM monitoring.check_runs run
               WHERE run.owner_id = $1 AND run.check_id = $2) AS runs
       FROM monitoring.check_current_states AS state
       JOIN monitoring.incidents AS incident
         ON incident.owner_id = state.owner_id AND incident.check_id = state.check_id
       WHERE state.owner_id = $1 AND state.check_id = $2`,
      [ownerId, checkId],
    );
    expect(state.rows[0]).toEqual({
      health_state: 'UP',
      incident_status: 'CLOSED',
      runs: '3',
    });

    const facts = await schemaPool.query<{
      event_type: string;
      maintenance_suppressed: boolean;
      notification_dispatches: string;
    }>(
      `SELECT event.event_type,
              (event.payload->>'maintenance_suppressed')::boolean AS maintenance_suppressed,
              count(dispatch.*) FILTER (WHERE dispatch.destination = 'NOTIFICATION')::text
                AS notification_dispatches
       FROM infra.outbox_events AS event
       LEFT JOIN infra.outbox_dispatches AS dispatch ON dispatch.event_id = event.id
       WHERE event.owner_id = $1 AND event.aggregate_type = 'incident'
       GROUP BY event.id, event.event_type, event.occurred_at
       ORDER BY event.occurred_at, event.event_type`,
      [ownerId],
    );
    expect(facts.rows).toEqual([
      {
        event_type: 'incident.opened',
        maintenance_suppressed: true,
        notification_dispatches: '1',
      },
      {
        event_type: 'incident.closed',
        maintenance_suppressed: true,
        notification_dispatches: '1',
      },
    ]);
  });

  it('records a diagnostic run without mutating health state', async () => {
    const checkId = '00000000-0000-4000-8000-000000010003';
    const jobId = '00000000-0000-7000-8000-000000010003';
    await insertCheck({ id: checkId, paused: true });
    await insertJob({ checkId, id: jobId, manualMode: 'DIAGNOSTIC' });
    const { queue, store } = runtime('monitor-worker:observation-diagnostic');
    const claimed = await claimStarted(queue, checkId, jobId);

    await expect(store.persistResult(claimed, passingResult)).resolves.toMatchObject({
      accepted: false,
      jobOutcome: 'COMPLETED',
      rejectionReason: 'DIAGNOSTIC_RUN',
    });
    const persisted = await schemaPool.query<{
      accepted_for_state: boolean;
      audits: string;
      health_state: string;
      rejection_reason: string;
      state_version: string;
    }>(
      `SELECT run.accepted_for_state, run.rejection_reason,
              state.health_state, state.state_version::text,
              (SELECT count(*)::text FROM audit.events) AS audits
       FROM monitoring.check_runs AS run
       JOIN monitoring.check_current_states AS state
         ON state.owner_id = run.owner_id AND state.check_id = run.check_id
       WHERE run.job_id = $1`,
      [jobId],
    );
    expect(persisted.rows[0]).toEqual({
      accepted_for_state: false,
      audits: '1',
      health_state: 'UNKNOWN',
      rejection_reason: 'DIAGNOSTIC_RUN',
      state_version: '1',
    });
  });

  it('acknowledges a cancellation race and rolls back an invalid accepted snapshot', async () => {
    const cancelledCheckId = '00000000-0000-4000-8000-000000010004';
    const cancelledJobId = '00000000-0000-7000-8000-000000010004';
    await insertCheck({ id: cancelledCheckId });
    await insertJob({ checkId: cancelledCheckId, id: cancelledJobId });
    const cancelledRuntime = runtime('monitor-worker:observation-cancelled');
    const cancelledClaim = await claimStarted(
      cancelledRuntime.queue,
      cancelledCheckId,
      cancelledJobId,
    );
    await schemaPool.query(
      `UPDATE monitoring.check_jobs
       SET cancellation_requested_at = statement_timestamp(),
           cancellation_reason = 'CONFIGURATION_CHANGED'
       WHERE id = $1`,
      [cancelledJobId],
    );
    const cancelled = await cancelledRuntime.store.persistResult(cancelledClaim, passingResult);
    expect(cancelled).toMatchObject({
      accepted: false,
      jobOutcome: 'CANCELLED',
      rejectionReason: 'ATTEMPT_NOT_CURRENT',
    });
    await expect(
      cancelledRuntime.store.persistResult(cancelledClaim, passingResult),
    ).resolves.toEqual({ ...cancelled, duplicate: true });

    const invalidCheckId = '00000000-0000-4000-8000-000000010005';
    const invalidJobId = '00000000-0000-7000-8000-000000010005';
    await insertCheck({ id: invalidCheckId });
    await insertJob({ checkId: invalidCheckId, id: invalidJobId });
    const invalidRuntime = runtime('monitor-worker:observation-invalid');
    const invalidClaim = await claimStarted(invalidRuntime.queue, invalidCheckId, invalidJobId);
    await schemaPool.query(`DELETE FROM monitoring.open_health_intervals WHERE check_id = $1`, [
      invalidCheckId,
    ]);
    await expect(invalidRuntime.store.persistResult(invalidClaim, passingResult)).rejects.toThrow(
      'Accepted observation has no open health interval',
    );

    const persisted = await schemaPool.query<{
      cancelled_attempt_reason: string;
      cancelled_job_state: string;
      invalid_attempt_recorded_at: Date | null;
      invalid_job_state: string;
      invalid_runs: string;
    }>(
      `SELECT cancelled_job.state AS cancelled_job_state,
              cancelled_attempt.terminal_reason AS cancelled_attempt_reason,
              invalid_job.state AS invalid_job_state,
              invalid_attempt.result_recorded_at AS invalid_attempt_recorded_at,
              (SELECT count(*)::text FROM monitoring.check_runs run
               WHERE run.job_id = invalid_job.id) AS invalid_runs
       FROM monitoring.check_jobs AS cancelled_job
       JOIN monitoring.check_job_attempts AS cancelled_attempt
         ON cancelled_attempt.job_id = cancelled_job.id
       JOIN monitoring.check_jobs AS invalid_job ON invalid_job.id = $2
       JOIN monitoring.check_job_attempts AS invalid_attempt
         ON invalid_attempt.job_id = invalid_job.id
       WHERE cancelled_job.id = $1`,
      [cancelledJobId, invalidJobId],
    );
    expect(persisted.rows[0]).toEqual({
      cancelled_attempt_reason: 'CANCELLED',
      cancelled_job_state: 'CANCELLED',
      invalid_attempt_recorded_at: null,
      invalid_job_state: 'RUNNING',
      invalid_runs: '0',
    });
  });

  it('reconciles one overdue state once across concurrent replicas', async () => {
    const checkId = '00000000-0000-4000-8000-000000010006';
    const jobId = '00000000-0000-7000-8000-000000010006';
    await insertCheck({ id: checkId });
    await insertJob({ checkId, id: jobId });
    const firstRuntime = runtime('monitor-worker:freshness-first');
    const claim = await claimStarted(firstRuntime.queue, checkId, jobId);
    await firstRuntime.store.persistResult(claim, passingResult);
    const deadline = await expireFreshness(checkId);

    const candidates = await firstRuntime.store.listFreshnessCandidates(10);
    expect(candidates).toContainEqual({
      checkId,
      freshUntil: deadline.toISOString(),
      ownerId,
    });
    const secondRuntime = runtime('monitor-worker:freshness-second');
    const outcomes = await Promise.all([
      firstRuntime.store.reconcileFreshness({ checkId, ownerId }),
      secondRuntime.store.reconcileFreshness({ checkId, ownerId }),
    ]);
    expect(outcomes.filter((result) => result.outcome === 'RECONCILED')).toHaveLength(1);
    await expect(firstRuntime.store.reconcileFreshness({ checkId, ownerId })).resolves.toEqual({
      outcome: 'STALE',
    });

    const persisted = await schemaPool.query<{
      deadline_events: string;
      freshness_state: string;
      health_state: string;
      history_intervals: string;
      source_kind: string;
      stale_reconciled_at: Date;
      state_version: string;
    }>(
      `SELECT state.freshness_state, state.health_state,
              state.stale_reconciled_at, state.state_version::text,
              open_interval.source_kind,
              (SELECT count(*)::text FROM monitoring.health_intervals history
               WHERE history.owner_id = state.owner_id
                 AND history.check_id = state.check_id) AS history_intervals,
              (SELECT count(*)::text FROM infra.outbox_events event
               WHERE event.event_type = 'check.freshness_changed'
                 AND event.aggregate_id = state.check_id
                 AND event.payload->>'reason_code' = 'DEADLINE') AS deadline_events
       FROM monitoring.check_current_states AS state
       JOIN monitoring.open_health_intervals AS open_interval
         ON open_interval.owner_id = state.owner_id
        AND open_interval.check_id = state.check_id
       WHERE state.owner_id = $1 AND state.check_id = $2`,
      [ownerId, checkId],
    );
    expect(persisted.rows[0]).toEqual({
      deadline_events: '1',
      freshness_state: 'STALE',
      health_state: 'UP',
      history_intervals: '2',
      source_kind: 'FRESHNESS',
      stale_reconciled_at: deadline,
      state_version: '3',
    });
  });

  it('suspends an observed incident at the exact freshness deadline', async () => {
    const checkId = '00000000-0000-4000-8000-000000010007';
    await insertCheck({ id: checkId });
    const { queue, store } = runtime('monitor-worker:freshness-incident');
    for (const suffix of ['1', '2']) {
      const jobId = `00000000-0000-7000-8000-00000001007${suffix}`;
      await insertJob({ checkId, id: jobId });
      const claim = await claimStarted(queue, checkId, jobId);
      await store.persistResult(claim, failingResult);
    }
    const deadline = await expireFreshness(checkId);

    await expect(store.reconcileFreshness({ checkId, ownerId })).resolves.toMatchObject({
      outcome: 'RECONCILED',
      stateVersion: '4',
    });
    const persisted = await schemaPool.query<{
      close_reason: string;
      ended_at: Date;
      freshness_state: string;
      health_state: string;
      incident_events: string;
      observation_mode: string;
      observed_duration_ms: string;
      runs: string;
    }>(
      `SELECT state.freshness_state, state.health_state,
              incident.observation_mode, incident.observed_duration_ms::text,
              segment.ended_at, segment.close_reason,
              (SELECT count(*)::text FROM monitoring.check_runs run
               WHERE run.owner_id = state.owner_id AND run.check_id = state.check_id) AS runs,
              (SELECT count(*)::text FROM infra.outbox_events event
               WHERE event.event_type = 'incident.observation_suspended'
                 AND event.aggregate_id = incident.id) AS incident_events
       FROM monitoring.check_current_states AS state
       JOIN monitoring.incidents AS incident
         ON incident.owner_id = state.owner_id AND incident.id = state.open_incident_id
       JOIN monitoring.incident_segments AS segment
         ON segment.owner_id = incident.owner_id AND segment.incident_id = incident.id
       WHERE state.owner_id = $1 AND state.check_id = $2`,
      [ownerId, checkId],
    );
    expect(persisted.rows[0]).toMatchObject({
      close_reason: 'STALE',
      ended_at: deadline,
      freshness_state: 'STALE',
      health_state: 'DOWN',
      incident_events: '1',
      observation_mode: 'UNOBSERVED',
      runs: '2',
    });
    expect(Number(persisted.rows[0]!.observed_duration_ms)).toBeGreaterThan(0);
  });

  it('converges when a new observation races freshness reconciliation', async () => {
    const checkId = '00000000-0000-4000-8000-000000010008';
    const firstJobId = '00000000-0000-7000-8000-000000010081';
    const secondJobId = '00000000-0000-7000-8000-000000010082';
    await insertCheck({ id: checkId });
    await insertJob({ checkId, id: firstJobId });
    const { queue, store } = runtime('monitor-worker:freshness-race');
    const firstClaim = await claimStarted(queue, checkId, firstJobId);
    await store.persistResult(firstClaim, passingResult);
    await expireFreshness(checkId);
    await insertJob({ checkId, id: secondJobId });
    const secondClaim = await claimStarted(queue, checkId, secondJobId);

    const [, observation] = await Promise.all([
      store.reconcileFreshness({ checkId, ownerId }),
      store.persistResult(secondClaim, passingResult),
    ]);
    expect(observation).toMatchObject({ accepted: true, jobOutcome: 'COMPLETED' });

    const persisted = await schemaPool.query<{
      deadline_events: string;
      freshness_state: string;
      health_state: string;
      runs: string;
      source_kind: string;
      stale_reconciled_at: Date | null;
      state_version: string;
    }>(
      `SELECT state.freshness_state, state.health_state,
              state.stale_reconciled_at, state.state_version::text,
              open_interval.source_kind,
              (SELECT count(*)::text FROM monitoring.check_runs run
               WHERE run.owner_id = state.owner_id AND run.check_id = state.check_id) AS runs,
              (SELECT count(*)::text FROM infra.outbox_events event
               WHERE event.event_type = 'check.freshness_changed'
                 AND event.aggregate_id = state.check_id
                 AND event.payload->>'reason_code' = 'DEADLINE') AS deadline_events
       FROM monitoring.check_current_states AS state
       JOIN monitoring.open_health_intervals AS open_interval
         ON open_interval.owner_id = state.owner_id
        AND open_interval.check_id = state.check_id
       WHERE state.owner_id = $1 AND state.check_id = $2`,
      [ownerId, checkId],
    );
    expect(persisted.rows[0]).toEqual({
      deadline_events: '1',
      freshness_state: 'FRESH',
      health_state: 'UP',
      runs: '2',
      source_kind: 'RUN',
      stale_reconciled_at: null,
      state_version: '4',
    });
  });

  it('recovers a real process-killed probe and fences its zombie result', async () => {
    const checkId = '00000000-0000-4000-8000-000000010009';
    const jobId = '00000000-0000-7000-8000-000000010091';
    let targetRequests = 0;
    const targetServer = createServer(() => {
      targetRequests += 1;
    });
    const targetPort = await listenOnEphemeralPort(targetServer);
    const workerPort = await reserveEphemeralPort();
    const targetOrigin = `http://127.0.0.1:${targetPort}`;
    await insertCheck({ id: checkId });
    await schemaPool.query(
      `UPDATE app.checks
       SET url = $3, timeout_ms = 3000,
           next_run_at = statement_timestamp() + interval '1 hour'
       WHERE owner_id = $1 AND id = $2`,
      [ownerId, checkId, `${targetOrigin}/hang`],
    );
    await insertJob({ checkId, id: jobId });

    const child = spawn(
      process.execPath,
      ['--import', 'tsx', path.resolve('apps/monitor-worker/src/index.ts')],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: testConnectionString,
          HOST: '127.0.0.1',
          MONITOR_CANDIDATE_BATCH_SIZE: '1',
          MONITOR_DB_POOL_SIZE: '2',
          MONITOR_DISPATCH_POLL_MS: '25',
          MONITOR_FRESHNESS_POLL_MS: '60000',
          MONITOR_GLOBAL_CONCURRENCY: '1',
          MONITOR_HEARTBEAT_MS: '300',
          MONITOR_LEASE_GRACE_MS: '1000',
          MONITOR_PER_HOST_CONCURRENCY: '1',
          MONITOR_PER_OWNER_CONCURRENCY: '1',
          MONITOR_RECOVERY_POLL_MS: '60000',
          MONITOR_SCHEDULE_BATCH_SIZE: '1',
          MONITOR_SCHEDULER_GRACE_MS: '0',
          MONITOR_SCHEDULER_POLL_MS: '60000',
          MONITOR_SHUTDOWN_GRACE_MS: '1000',
          NODE_ENV: 'test',
          PORT: String(workerPort),
          PROBE_ALLOWED_PORTS: String(targetPort),
          PROBE_CONNECT_TIMEOUT_MS: '1000',
          PROBE_DEV_ALLOWED_ORIGINS: targetOrigin,
          SERVICE_NAME: 'monitor-crash-test',
          SERVICE_VERSION: 'process-recovery-test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const childExit = waitForExit(child);
    let childOutput = '';
    const rememberOutput = (chunk: Buffer): void => {
      childOutput = `${childOutput}${chunk.toString('utf8')}`.slice(-4_000);
    };
    child.stdout?.on('data', rememberOutput);
    child.stderr?.on('data', rememberOutput);

    interface ActiveClaimRow {
      attempt_id: string;
      attempt_number: number;
      config_snapshot: unknown;
      fencing_token: string;
      lease_duration_ms: number;
      lease_expires_at: Date;
      manual_mode: 'DIAGNOSTIC' | 'STATEFUL' | null;
      probe_generation: string;
      resource_version: string;
      schedule_generation: string;
      scheduled_for: Date;
      trigger_kind: 'MANUAL' | 'SCHEDULED';
      worker_id: string;
    }

    try {
      const active = await waitForValue<ActiveClaimRow>(async () => {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`Monitor process exited before claiming the job. ${childOutput}`);
        }
        const result = await schemaPool.query<ActiveClaimRow>(
          `SELECT attempt.id::text AS attempt_id, attempt.attempt_number,
                  job.config_snapshot, job.fencing_token::text,
                  checks.timeout_ms + 1000 AS lease_duration_ms,
                  job.lease_expires_at, job.manual_mode,
                  job.probe_generation::text, job.resource_version::text,
                  job.schedule_generation::text, job.scheduled_for,
                  job.trigger_kind, attempt.worker_id
           FROM monitoring.check_jobs AS job
           JOIN app.checks AS checks
             ON checks.owner_id = job.owner_id AND checks.id = job.check_id
           JOIN monitoring.check_job_attempts AS attempt
             ON attempt.owner_id = job.owner_id AND attempt.check_id = job.check_id
            AND attempt.job_id = job.id AND attempt.ended_at IS NULL
           WHERE job.owner_id = $1 AND job.check_id = $2 AND job.id = $3
             AND job.state = 'RUNNING'`,
          [ownerId, checkId, jobId],
        );
        return result.rows[0] ?? null;
      }, 10_000);
      await waitForValue(() => (targetRequests > 0 ? true : null), 2_000);

      const crashedClaim: ClaimedJob = {
        attemptId: active.attempt_id,
        attemptNumber: active.attempt_number,
        checkId,
        configSnapshot: active.config_snapshot,
        fencingToken: active.fencing_token,
        jobId,
        leaseDurationMs: active.lease_duration_ms,
        leaseExpiresAt: active.lease_expires_at.toISOString(),
        manualMode: active.manual_mode,
        ownerId,
        probeGeneration: active.probe_generation,
        resourceVersion: active.resource_version,
        scheduleGeneration: active.schedule_generation,
        scheduledFor: active.scheduled_for.toISOString(),
        triggerKind: active.trigger_kind,
      };

      expect(child.kill('SIGKILL')).toBe(true);
      const exit = await Promise.race([
        childExit,
        delay(5_000).then(() => {
          throw new Error('Killed monitor process did not exit within 5000 ms.');
        }),
      ]);
      expect(exit.code === null || exit.code !== 0).toBe(true);

      const abandoned = await schemaPool.query<{
        lease_owner: string;
        state: string;
        terminal_reason: string | null;
      }>(
        `SELECT state, lease_owner, terminal_reason
         FROM monitoring.check_jobs
         WHERE owner_id = $1 AND check_id = $2 AND id = $3`,
        [ownerId, checkId, jobId],
      );
      expect(abandoned.rows[0]).toEqual({
        lease_owner: active.worker_id,
        state: 'RUNNING',
        terminal_reason: null,
      });

      const reclaimer = new PostgresJobQueue(monitorPool, 'monitor-worker:reclaimer', 1_000);
      const expired = await waitForValue(async () => {
        const candidates = await reclaimer.listExpiredLeaseCandidates(10);
        return candidates.find((candidate) => candidate.jobId === jobId) ?? null;
      }, 6_000);
      const recovery = await reclaimer.recoverExpiredLease(expired);
      expect(recovery).toMatchObject({ outcome: 'RETRY_SCHEDULED' });

      const replacementQueue = new PostgresJobQueue(
        monitorPool,
        'monitor-worker:replacement',
        1_000,
      );
      const retryCandidate = await waitForValue(async () => {
        const candidates = await replacementQueue.listClaimCandidates(10);
        return candidates.find((candidate) => candidate.jobId === jobId) ?? null;
      }, 4_000);
      const replacementClaimResult = await replacementQueue.claimCandidate(retryCandidate);
      if (replacementClaimResult.outcome !== 'CLAIMED') {
        throw new Error('Recovered job could not be claimed by the replacement worker.');
      }
      const replacementClaim = replacementClaimResult.job;
      expect(BigInt(replacementClaim.fencingToken)).toBeGreaterThan(
        BigInt(crashedClaim.fencingToken),
      );
      await expect(replacementQueue.startClaim(replacementClaim)).resolves.toMatchObject({
        outcome: 'ACTIVE',
      });
      const replacementStore = new PostgresObservationStore(
        monitorPool,
        'monitor-worker:replacement',
        5_000,
        replacementQueue,
      );
      await expect(
        replacementStore.persistResult(replacementClaim, passingResult),
      ).resolves.toMatchObject({ accepted: true, jobOutcome: 'COMPLETED' });

      const stateBeforeZombie = await schemaPool.query<{
        health_state: string;
        last_accepted_fencing_token: string;
        last_response_time_ms: number;
        state_version: string;
      }>(
        `SELECT health_state, last_accepted_fencing_token::text,
                last_response_time_ms, state_version::text
         FROM monitoring.check_current_states
         WHERE owner_id = $1 AND check_id = $2`,
        [ownerId, checkId],
      );
      const crashedQueue = new PostgresJobQueue(monitorPool, active.worker_id, 1_000);
      const crashedStore = new PostgresObservationStore(
        monitorPool,
        active.worker_id,
        5_000,
        crashedQueue,
      );
      await expect(crashedStore.persistResult(crashedClaim, failingResult)).resolves.toMatchObject({
        accepted: false,
        jobOutcome: 'UNCHANGED',
        rejectionReason: 'ATTEMPT_NOT_CURRENT',
      });
      const stateAfterZombie = await schemaPool.query<{
        health_state: string;
        last_accepted_fencing_token: string;
        last_response_time_ms: number;
        state_version: string;
      }>(
        `SELECT health_state, last_accepted_fencing_token::text,
                last_response_time_ms, state_version::text
         FROM monitoring.check_current_states
         WHERE owner_id = $1 AND check_id = $2`,
        [ownerId, checkId],
      );
      expect(stateAfterZombie.rows[0]).toEqual(stateBeforeZombie.rows[0]);
      expect(stateAfterZombie.rows[0]).toMatchObject({
        health_state: 'UP',
        last_accepted_fencing_token: replacementClaim.fencingToken,
        last_response_time_ms: passingResult.timings.totalMs,
      });

      const evidence = await schemaPool.query<{
        accepted_for_state: boolean;
        attempt_number: number;
        job_state: string;
        outcome: string;
        rejection_reason: string | null;
        terminal_reason: string;
      }>(
        `SELECT attempt.attempt_number, attempt.terminal_reason,
                run.accepted_for_state, run.outcome, run.rejection_reason,
                job.state AS job_state
         FROM monitoring.check_job_attempts AS attempt
         JOIN monitoring.check_jobs AS job
           ON job.owner_id = attempt.owner_id AND job.check_id = attempt.check_id
          AND job.id = attempt.job_id
         JOIN monitoring.check_runs AS run
           ON run.owner_id = attempt.owner_id AND run.check_id = attempt.check_id
          AND run.attempt_id = attempt.id
         WHERE attempt.owner_id = $1 AND attempt.check_id = $2 AND attempt.job_id = $3
         ORDER BY attempt.attempt_number`,
        [ownerId, checkId, jobId],
      );
      expect(evidence.rows).toEqual([
        {
          accepted_for_state: false,
          attempt_number: 1,
          job_state: 'COMPLETED',
          outcome: 'FAIL',
          rejection_reason: 'ATTEMPT_NOT_CURRENT',
          terminal_reason: 'LEASE_LOST',
        },
        {
          accepted_for_state: true,
          attempt_number: 2,
          job_state: 'COMPLETED',
          outcome: 'PASS',
          rejection_reason: null,
          terminal_reason: 'RESULT_RECORDED',
        },
      ]);
      const incidents = await schemaPool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM monitoring.incidents
         WHERE owner_id = $1 AND check_id = $2`,
        [ownerId, checkId],
      );
      expect(incidents.rows[0]?.count).toBe('0');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      targetServer.closeAllConnections();
      await new Promise<void>((resolve) => targetServer.close(() => resolve()));
    }
  }, 30_000);

  it('selects overdue candidates fairly across owners before applying the batch limit', async () => {
    const secondOwnerId = '00000000-0000-4000-8000-000000000202';
    await schemaPool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES ($1, 'freshness-owner@example.test', 'freshness-owner@example.test',
               'Freshness Owner', 'ACTIVE', statement_timestamp())
       ON CONFLICT (id) DO NOTHING`,
      [secondOwnerId],
    );
    const checks = [
      { id: '00000000-0000-4000-8000-000000010091', ownerId },
      { id: '00000000-0000-4000-8000-000000010092', ownerId },
      { id: '00000000-0000-4000-8000-000000010093', ownerId: secondOwnerId },
    ];
    for (const check of checks) {
      await insertCheck(check);
      await schemaPool.query(
        `UPDATE monitoring.check_current_states
         SET freshness_state = 'FRESH',
             fresh_until = statement_timestamp() - interval '1 second',
             stale_reconciled_at = NULL
         WHERE owner_id = $1 AND check_id = $2`,
        [check.ownerId, check.id],
      );
    }

    const { store } = runtime('monitor-worker:freshness-fairness');
    const candidates = await store.listFreshnessCandidates(2);
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map((candidate) => candidate.ownerId))).toEqual(
      new Set([ownerId, secondOwnerId]),
    );
  });
});
