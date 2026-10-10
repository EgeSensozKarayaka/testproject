import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

import { createDatabasePool, runMigrations, type Pool } from '@site-monitor/database';
import { dropTestDatabase } from '@site-monitor/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const adminConnectionString = process.env.DATABASE_TEST_ADMIN_URL;
const databaseSuite = adminConnectionString ? describe : describe.skip;

const checkCount = 200;
const ownerCount = 4;
const apiOwnerId = '21000000-0000-4000-8000-000000000001';
const sessionId = '21000000-0000-4000-8000-000000000101';
const sessionToken = 'runtime-isolation-session-token-v1';

interface ManagedProcess {
  child: ChildProcess;
  exit: Promise<{ code: number | null; signal: string | null }>;
  label: string;
  output(): string;
  spawnError(): Error | null;
}

interface ApiSample {
  listMs: number;
  readyMs: number;
}

interface RuntimeEvidenceRow {
  accepted_runs: string;
  active_jobs: string;
  attempts: string;
  completed_jobs: string;
  max_attempt_number: number;
  runs: string;
  worker_count: string;
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

function spawnService(
  label: string,
  entrypoint: string,
  environment: NodeJS.ProcessEnv,
): ManagedProcess {
  const child = spawn(process.execPath, ['--import', 'tsx', path.resolve(entrypoint)], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let processError: Error | null = null;
  const rememberOutput = (chunk: Buffer): void => {
    output = `${output}${chunk.toString('utf8')}`.slice(-4_000);
  };
  child.stdout?.on('data', rememberOutput);
  child.stderr?.on('data', rememberOutput);
  child.once('error', (error) => {
    processError = error;
  });
  const exit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    exit,
    label,
    output: () => output,
    spawnError: () => processError,
  };
}

async function stopService(service: ManagedProcess): Promise<void> {
  if (service.child.exitCode !== null || service.child.signalCode !== null) return;
  service.child.kill('SIGTERM');
  const stopped = await Promise.race([
    service.exit.then(() => true),
    delay(10_000).then(() => false),
  ]);
  if (!stopped && service.child.exitCode === null && service.child.signalCode === null) {
    service.child.kill('SIGKILL');
    await Promise.race([service.exit, delay(5_000)]);
  }
}

async function waitForReady(service: ManagedProcess, url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const spawnError = service.spawnError();
    if (spawnError) {
      throw new Error(`${service.label} could not start: ${spawnError.name}. ${service.output()}`);
    }
    if (service.child.exitCode !== null || service.child.signalCode !== null) {
      throw new Error(`${service.label} exited before readiness. ${service.output()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }
    } catch {
      // Startup connection failures are expected until the service binds its port.
    }
    await delay(50);
  }
  throw new Error(`${service.label} did not become ready. ${service.output()}`);
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Cannot calculate a percentile without samples.');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

async function timedFetch(url: string, headers?: Record<string, string>) {
  const startedAt = performance.now();
  const response = await fetch(url, {
    ...(headers ? { headers } : {}),
    signal: AbortSignal.timeout(3_000),
  });
  return { elapsedMs: performance.now() - startedAt, response };
}

databaseSuite('monitor multi-process runtime isolation', () => {
  const databaseName = `site_monitor_isolation_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  let adminPool: Pool;
  let connectionString: string;
  let schemaPool: Pool;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'runtime-isolation-admin-test',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    connectionString = databaseUrl(adminConnectionString!, databaseName);
    schemaPool = createDatabasePool({
      applicationName: 'runtime-isolation-schema-test',
      connectionString,
      maxConnections: 4,
    });
    await runMigrations(schemaPool, { appBuild: 'runtime-isolation-integration-test' });
  }, 30_000);

  afterAll(async () => {
    if (schemaPool) await schemaPool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName);
      await adminPool.end();
    }
  }, 30_000);

  async function insertFixture(targetOrigin: string): Promise<void> {
    await schemaPool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       SELECT ('21000000-0000-4000-8000-' || lpad(to_hex(owner_number), 12, '0'))::uuid,
              format('isolation-%s@example.test', owner_number),
              format('isolation-%s@example.test', owner_number),
              format('Isolation Owner %s', owner_number),
              'ACTIVE', statement_timestamp()
       FROM generate_series(1, $1::integer) AS owner_number`,
      [ownerCount],
    );
    await schemaPool.query(
      `WITH fixture AS (
         SELECT item, ((item - 1) % $2::integer) + 1 AS owner_number
         FROM generate_series(1, $1::integer) AS item
       )
       INSERT INTO app.checks
         (id, owner_id, name, url, interval_seconds, timeout_ms,
          expected_status_code, cadence_anchor_at, next_run_at)
       SELECT ('31000000-0000-4000-8000-' || lpad(to_hex(item), 12, '0'))::uuid,
              ('21000000-0000-4000-8000-' || lpad(to_hex(owner_number), 12, '0'))::uuid,
              format('Isolation Check %s', item),
              $3 || '/ok?item=' || item::text,
              30, 5000, 200,
              statement_timestamp() - interval '1 minute',
              statement_timestamp() + interval '1 hour'
       FROM fixture`,
      [checkCount, ownerCount, targetOrigin],
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
    await schemaPool.query(
      `INSERT INTO auth.password_credentials (owner_id, password_hash, password_version)
       VALUES ($1, 'test-only-unused-password-hash', 1)`,
      [apiOwnerId],
    );
    await schemaPool.query(
      `INSERT INTO auth.sessions
         (id, owner_id, token_digest, issued_password_version,
          expires_at, absolute_expires_at, idle_expires_at)
       VALUES ($1, $2, $3, 1,
               statement_timestamp() + interval '7 days',
               statement_timestamp() + interval '7 days',
               statement_timestamp() + interval '1 day')`,
      [sessionId, apiOwnerId, createHash('sha256').update(sessionToken, 'utf8').digest()],
    );
  }

  async function sampleApi(apiOrigin: string): Promise<ApiSample> {
    const ready = await timedFetch(`${apiOrigin}/health/ready`);
    expect(ready.response.status).toBe(200);
    await ready.response.arrayBuffer();
    const list = await timedFetch(`${apiOrigin}/api/v1/checks?limit=100`, {
      cookie: `site_monitor_session=${sessionToken}`,
    });
    expect(list.response.status).toBe(200);
    const payload = (await list.response.json()) as { data?: unknown[] };
    expect(payload.data).toHaveLength(checkCount / ownerCount);
    return { listMs: list.elapsedMs, readyMs: ready.elapsedMs };
  }

  it('keeps the API responsive while two production workers drain the same queue exactly once', async () => {
    let activeTargets = 0;
    let maxActiveTargets = 0;
    let targetRequests = 0;
    const targetServer = createServer((_request, response) => {
      activeTargets += 1;
      maxActiveTargets = Math.max(maxActiveTargets, activeTargets);
      targetRequests += 1;
      setTimeout(() => {
        activeTargets -= 1;
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('healthy');
      }, 150);
    });
    const targetPort = await listenOnEphemeralPort(targetServer);
    const [apiPort, monitorPortA, monitorPortB] = await Promise.all([
      reserveEphemeralPort(),
      reserveEphemeralPort(),
      reserveEphemeralPort(),
    ]);
    const targetOrigin = `http://127.0.0.1:${targetPort}`;
    const apiOrigin = `http://127.0.0.1:${apiPort}`;
    await insertFixture(targetOrigin);

    const commonEnvironment = {
      DATABASE_URL: connectionString,
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      SERVICE_VERSION: 'runtime-isolation-test',
    } satisfies NodeJS.ProcessEnv;
    const api = spawnService('api', 'apps/api/src/index.ts', {
      ...commonEnvironment,
      CHECKS_PER_OWNER_LIMIT: '1000',
      GROUPS_PER_OWNER_LIMIT: '100',
      PORT: String(apiPort),
      PUBLIC_WEB_URL: 'http://localhost:15173',
      SERVICE_NAME: 'api-isolation-test',
      WEB_ORIGIN: 'http://localhost:15173',
    });
    const monitorEnvironment = {
      ...commonEnvironment,
      MONITOR_CANDIDATE_BATCH_SIZE: '32',
      MONITOR_DB_POOL_SIZE: '4',
      MONITOR_DISPATCH_POLL_MS: '25',
      MONITOR_FRESHNESS_POLL_MS: '250',
      MONITOR_GLOBAL_CONCURRENCY: '8',
      MONITOR_HEARTBEAT_MS: '1000',
      MONITOR_LEASE_GRACE_MS: '3000',
      MONITOR_PER_HOST_CONCURRENCY: '4',
      MONITOR_PER_OWNER_CONCURRENCY: '4',
      MONITOR_RECOVERY_POLL_MS: '100',
      MONITOR_SCHEDULE_BATCH_SIZE: '32',
      MONITOR_SCHEDULER_GRACE_MS: '5000',
      MONITOR_SCHEDULER_POLL_MS: '25',
      MONITOR_SHUTDOWN_GRACE_MS: '5000',
      PROBE_ALLOWED_PORTS: String(targetPort),
      PROBE_CONNECT_TIMEOUT_MS: '1000',
      PROBE_DEV_ALLOWED_ORIGINS: targetOrigin,
      SERVICE_NAME: 'monitor-worker-isolation-test',
    } satisfies NodeJS.ProcessEnv;
    const monitorA = spawnService('monitor-a', 'apps/monitor-worker/src/index.ts', {
      ...monitorEnvironment,
      PORT: String(monitorPortA),
    });
    const monitorB = spawnService('monitor-b', 'apps/monitor-worker/src/index.ts', {
      ...monitorEnvironment,
      PORT: String(monitorPortB),
    });
    const services = [api, monitorA, monitorB];

    try {
      await Promise.all([
        waitForReady(api, `${apiOrigin}/health/ready`),
        waitForReady(monitorA, `http://127.0.0.1:${monitorPortA}/health/ready`),
        waitForReady(monitorB, `http://127.0.0.1:${monitorPortB}/health/ready`),
      ]);

      const baselineSamples: ApiSample[] = [];
      for (let index = 0; index < 5; index += 1) {
        baselineSamples.push(await sampleApi(apiOrigin));
      }

      await schemaPool.query(
        `UPDATE app.checks
         SET next_run_at = statement_timestamp() - interval '1 second'
         WHERE lifecycle_state = 'LIVE' AND execution_state = 'ACTIVE'`,
      );

      const loadSamples: ApiSample[] = [];
      let completedJobs = 0;
      let cadenceParked = false;
      const deadline = Date.now() + 30_000;
      while (completedJobs < checkCount && Date.now() < deadline) {
        if (loadSamples.length < 40) loadSamples.push(await sampleApi(apiOrigin));
        const progress = await schemaPool.query<{ completed: string; total: string }>(
          `SELECT count(*)::text AS total,
                  count(*) FILTER (WHERE state = 'COMPLETED')::text AS completed
           FROM monitoring.check_jobs`,
        );
        const row = progress.rows[0]!;
        completedJobs = Number(row.completed);
        if (!cadenceParked && Number(row.total) === checkCount) {
          await schemaPool.query(
            `UPDATE app.checks
             SET next_run_at = statement_timestamp() + interval '1 hour'
             WHERE lifecycle_state = 'LIVE' AND execution_state = 'ACTIVE'`,
          );
          cadenceParked = true;
        }
        if (completedJobs < checkCount) await delay(50);
      }
      expect(completedJobs).toBe(checkCount);
      expect(cadenceParked).toBe(true);
      expect(loadSamples.length).toBeGreaterThanOrEqual(5);

      const evidence = await schemaPool.query<RuntimeEvidenceRow>(
        `SELECT
           (SELECT count(*)::text FROM monitoring.check_jobs
            WHERE state = 'COMPLETED') AS completed_jobs,
           (SELECT count(*)::text FROM monitoring.check_jobs
            WHERE state IN ('PENDING', 'LEASED', 'RUNNING')) AS active_jobs,
           (SELECT count(*)::text FROM monitoring.check_job_attempts) AS attempts,
           (SELECT count(DISTINCT worker_id)::text
            FROM monitoring.check_job_attempts) AS worker_count,
           (SELECT COALESCE(max(attempt_number), 0)
            FROM monitoring.check_job_attempts) AS max_attempt_number,
           (SELECT count(*)::text FROM monitoring.check_runs) AS runs,
           (SELECT count(*)::text FROM monitoring.check_runs
            WHERE accepted_for_state) AS accepted_runs`,
      );
      expect(evidence.rows[0]).toEqual({
        accepted_runs: String(checkCount),
        active_jobs: '0',
        attempts: String(checkCount),
        completed_jobs: String(checkCount),
        max_attempt_number: 1,
        runs: String(checkCount),
        worker_count: '2',
      });
      expect(targetRequests).toBe(checkCount);
      expect(maxActiveTargets).toBeGreaterThanOrEqual(2);
      expect(maxActiveTargets).toBeLessThanOrEqual(8);

      const baselineReadyP95Ms = percentile95(baselineSamples.map((sample) => sample.readyMs));
      const baselineListP95Ms = percentile95(baselineSamples.map((sample) => sample.listMs));
      const loadedReadyP95Ms = percentile95(loadSamples.map((sample) => sample.readyMs));
      const loadedListP95Ms = percentile95(loadSamples.map((sample) => sample.listMs));
      const loadedReadyMaxMs = Math.max(...loadSamples.map((sample) => sample.readyMs));
      const loadedListMaxMs = Math.max(...loadSamples.map((sample) => sample.listMs));
      expect(loadedReadyP95Ms).toBeLessThan(1_000);
      expect(loadedListP95Ms).toBeLessThan(1_500);
      expect(loadedReadyMaxMs).toBeLessThan(3_000);
      expect(loadedListMaxMs).toBeLessThan(3_000);

      process.stdout.write(
        `MONITOR_ISOLATION ${JSON.stringify({
          apiSampleCount: loadSamples.length,
          baselineListP95Ms,
          baselineReadyP95Ms,
          checkCount,
          loadedListMaxMs,
          loadedListP95Ms,
          loadedReadyMaxMs,
          loadedReadyP95Ms,
          maxActiveTargets,
          ownerCount,
          targetRequests,
          workerCount: 2,
        })}\n`,
      );
    } finally {
      await Promise.all(services.map(stopService));
      targetServer.closeAllConnections();
      await new Promise<void>((resolve) => targetServer.close(() => resolve()));
    }
  }, 60_000);
});
