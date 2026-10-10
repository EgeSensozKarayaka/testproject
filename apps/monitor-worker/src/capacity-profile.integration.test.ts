import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

import type { ProbeInvocation, ProbeResult } from '@site-monitor/check-engine';
import { createDatabasePool, runMigrations, type Pool } from '@site-monitor/database';
import { dropTestDatabase } from '@site-monitor/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProbeDispatcher } from './dispatcher.js';
import { PostgresJobQueue } from './job-queue.js';
import { PostgresObservationStore } from './observation-store.js';

const adminConnectionString = process.env.DATABASE_TEST_ADMIN_URL;
const databaseSuite = adminConnectionString ? describe : describe.skip;

interface CapacityMeasurement {
  acceptedRuns: number;
  claimLagP95Ms: number;
  completedJobs: number;
  count: number;
  cpuMs: number;
  dispatchMs: number;
  endToEndMs: number;
  endToEndThroughputPerSecond: number;
  executionP95Ms: number;
  maxActiveProbes: number;
  maxBusyDatabaseConnections: number;
  ownerCount: number;
  peakRssMiB: number;
  schedulerMs: number;
  throughputPerSecond: number;
}

interface PersistedMetricsRow {
  accepted_runs: string;
  claim_lag_p95_ms: number | string;
  completed_jobs: string;
  execution_p95_ms: number | string;
}

function quotedIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/u.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function databaseUrl(adminUrl: string, databaseName: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function probeResult(slow: boolean): ProbeResult {
  const totalMs = slow ? 50 : 5;
  return {
    bodyMatch: null,
    diagnosticCode: null,
    failureCategory: null,
    outcome: 'PASS',
    redirectCount: 0,
    statusCode: 200,
    timings: { connectMs: 1, dnsMs: 1, tlsMs: 1, totalMs, ttfbMs: totalMs - 2 },
  };
}

async function runDeterministicProbe(invocation: ProbeInvocation): Promise<ProbeResult> {
  const hostname = new URL(invocation.input.url).hostname;
  const hostNumber = Number(hostname.match(/capacity-(\d+)/u)?.[1] ?? 1);
  const slow = hostNumber % 10 === 0;
  await delay(slow ? 50 : 5, undefined, { signal: invocation.signal });
  return probeResult(slow);
}

databaseSuite('monitor runtime capacity profile', () => {
  const databaseName = `site_monitor_capacity_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  let adminPool: Pool;
  let monitorPool: Pool;
  let schemaPool: Pool;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'capacity-admin-test',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    const connectionString = databaseUrl(adminConnectionString!, databaseName);
    schemaPool = createDatabasePool({
      applicationName: 'capacity-schema-test',
      connectionString,
      maxConnections: 4,
    });
    await runMigrations(schemaPool, { appBuild: 'monitor-capacity-profile' });
    monitorPool = createDatabasePool({
      applicationName: 'capacity-monitor-test',
      connectionString,
      databaseRole: 'site_monitor_monitor',
      maxConnections: 8,
    });
  }, 30_000);

  afterAll(async () => {
    if (monitorPool) await monitorPool.end();
    if (schemaPool) await schemaPool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName);
      await adminPool.end();
    }
  }, 30_000);

  async function resetRuntimeData(): Promise<void> {
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
    await schemaPool.query(`DELETE FROM app.checks`);
  }

  async function insertFixture(count: number, ownerCount: number): Promise<void> {
    await schemaPool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       SELECT ('20000000-0000-4000-8000-' || lpad(to_hex(owner_number), 12, '0'))::uuid,
              format('capacity-%s@example.test', owner_number),
              format('capacity-%s@example.test', owner_number),
              format('Capacity Owner %s', owner_number),
              'ACTIVE', statement_timestamp()
       FROM generate_series(1, $1::integer) AS owner_number
       ON CONFLICT (id) DO NOTHING`,
      [ownerCount],
    );
    await schemaPool.query(
      `WITH fixture AS (
         SELECT item,
                ((item - 1) % $2::integer) + 1 AS owner_number
         FROM generate_series(1, $1::integer) AS item
       )
       INSERT INTO app.checks
         (id, owner_id, name, url, interval_seconds, timeout_ms,
          expected_status_code, cadence_anchor_at, next_run_at)
       SELECT ('30000000-0000-4000-8000-' || lpad(to_hex(item), 12, '0'))::uuid,
              ('20000000-0000-4000-8000-' || lpad(to_hex(owner_number), 12, '0'))::uuid,
              format('Capacity Check %s', item),
              format('https://capacity-%s.example.test/ok', item % 128),
              30, 5000, 200,
              statement_timestamp() - interval '1 minute',
              statement_timestamp() - interval '1 second'
       FROM fixture`,
      [count, ownerCount],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.check_current_states (owner_id, check_id)
       SELECT owner_id, id FROM app.checks`,
    );
    await schemaPool.query(
      `INSERT INTO monitoring.open_health_intervals
         (owner_id, check_id, classification, started_at, probe_generation, source_kind)
       SELECT owner_id, id, 'UNKNOWN', statement_timestamp() - interval '2 seconds',
              probe_generation, 'STARTUP'
       FROM app.checks`,
    );
  }

  async function persistedMetrics(): Promise<PersistedMetricsRow> {
    const result = await schemaPool.query<PersistedMetricsRow>(
      `SELECT
         count(*) FILTER (WHERE job.state = 'COMPLETED')::text AS completed_jobs,
         count(*) FILTER (WHERE run.accepted_for_state)::text AS accepted_runs,
         COALESCE(
           percentile_cont(0.95) WITHIN GROUP (
             ORDER BY extract(epoch FROM (attempt.lease_acquired_at - job.available_at)) * 1000
           ), 0
         ) AS claim_lag_p95_ms,
         COALESCE(
           percentile_cont(0.95) WITHIN GROUP (
             ORDER BY extract(epoch FROM (attempt.result_recorded_at - attempt.started_at)) * 1000
           ), 0
         ) AS execution_p95_ms
       FROM monitoring.check_jobs AS job
       JOIN monitoring.check_job_attempts AS attempt
         ON attempt.owner_id = job.owner_id
        AND attempt.check_id = job.check_id
        AND attempt.job_id = job.id
       JOIN monitoring.check_runs AS run
         ON run.owner_id = attempt.owner_id
        AND run.check_id = attempt.check_id
        AND run.job_id = attempt.job_id
        AND run.attempt_id = attempt.id`,
    );
    return result.rows[0]!;
  }

  async function profile(count: number): Promise<CapacityMeasurement> {
    await resetRuntimeData();
    const ownerCount = Math.min(8, Math.max(2, Math.ceil(count / 50)));
    await insertFixture(count, ownerCount);

    const queue = new PostgresJobQueue(monitorPool, `monitor-worker:capacity-${count}`, 15_000);
    const store = new PostgresObservationStore(
      monitorPool,
      `monitor-worker:capacity-${count}`,
      5_000,
      queue,
    );
    const dispatcher = new ProbeDispatcher({
      config: {
        candidateBatchSize: 128,
        globalConcurrency: 64,
        heartbeatMs: 5_000,
        perHostConcurrency: 4,
        perOwnerConcurrency: 32,
      },
      probe: { run: runDeterministicProbe },
      queue,
      sink: store,
    });

    const cpuStart = process.cpuUsage();
    let maxActiveProbes = 0;
    let maxBusyDatabaseConnections = 0;
    let peakRssBytes = process.memoryUsage().rss;
    const sampler = setInterval(() => {
      maxActiveProbes = Math.max(maxActiveProbes, dispatcher.activeCount);
      maxBusyDatabaseConnections = Math.max(
        maxBusyDatabaseConnections,
        monitorPool.totalCount - monitorPool.idleCount,
      );
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    }, 2);

    let materialized = 0;
    let claimed = 0;
    let schedulerMs = 0;
    let dispatchMs = 0;
    try {
      const schedulerStartedAt = performance.now();
      while (true) {
        const jobs = await queue.materializeDueBatch(64);
        materialized += jobs.length;
        if (jobs.length === 0) break;
      }
      schedulerMs = performance.now() - schedulerStartedAt;

      const dispatchStartedAt = performance.now();
      while (claimed < count) {
        const iteration = await dispatcher.dispatchOnce();
        claimed += iteration.claimed;
        await dispatcher.awaitIdle();
        if (iteration.claimed === 0) break;
      }
      dispatchMs = performance.now() - dispatchStartedAt;
    } finally {
      clearInterval(sampler);
    }

    const cpu = process.cpuUsage(cpuStart);
    const persisted = await persistedMetrics();
    const measurement: CapacityMeasurement = {
      acceptedRuns: Number(persisted.accepted_runs),
      claimLagP95Ms: Number(persisted.claim_lag_p95_ms),
      completedJobs: Number(persisted.completed_jobs),
      count,
      cpuMs: (cpu.user + cpu.system) / 1_000,
      dispatchMs,
      endToEndMs: schedulerMs + dispatchMs,
      endToEndThroughputPerSecond: count / ((schedulerMs + dispatchMs) / 1_000),
      executionP95Ms: Number(persisted.execution_p95_ms),
      maxActiveProbes,
      maxBusyDatabaseConnections,
      ownerCount,
      peakRssMiB: peakRssBytes / 1024 / 1024,
      schedulerMs,
      throughputPerSecond: count / (dispatchMs / 1_000),
    };

    expect(materialized).toBe(count);
    expect(claimed).toBe(count);
    expect(measurement.completedJobs).toBe(count);
    expect(measurement.acceptedRuns).toBe(count);
    expect(measurement.maxActiveProbes).toBeLessThanOrEqual(64);
    expect(measurement.maxBusyDatabaseConnections).toBeLessThanOrEqual(8);
    expect(measurement.schedulerMs).toBeLessThan(60_000);
    expect(measurement.dispatchMs).toBeLessThan(90_000);
    expect(measurement.endToEndMs).toBeLessThan(120_000);
    expect(measurement.endToEndThroughputPerSecond).toBeGreaterThan(1);
    expect(measurement.throughputPerSecond).toBeGreaterThan(1);

    const active = await schemaPool.query<{ active_jobs: string }>(
      `SELECT count(*)::text AS active_jobs
       FROM monitoring.check_jobs
       WHERE state IN ('PENDING', 'LEASED', 'RUNNING')`,
    );
    expect(active.rows[0]!.active_jobs).toBe('0');

    const firstAttempts = await schemaPool.query<{ owner_count: string }>(
      `SELECT count(DISTINCT owner_id)::text AS owner_count
       FROM (
         SELECT owner_id
         FROM monitoring.check_job_attempts
         ORDER BY lease_acquired_at, id
         LIMIT $1
       ) AS first_attempts`,
      [ownerCount],
    );
    expect(firstAttempts.rows[0]!.owner_count).toBe(String(ownerCount));

    process.stdout.write(`MONITOR_CAPACITY ${JSON.stringify(measurement)}\n`);
    return measurement;
  }

  it.each([20, 200, 500])(
    'drains %i due checks through the production queue and persistence path',
    async (count) => {
      await profile(count);
    },
    120_000,
  );
});
