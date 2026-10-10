import { randomUUID } from 'node:crypto';

import { createDatabasePool, runMigrations, type Pool } from '@site-monitor/database';
import { dropTestDatabase } from '@site-monitor/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CheckService } from './check-service.js';

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

databaseSuite('check service PostgreSQL boundary', () => {
  const databaseName = `site_monitor_checks_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerA = '00000000-0000-4000-8000-000000000001';
  const ownerB = '00000000-0000-4000-8000-000000000002';
  const key = Buffer.alloc(32, 67);
  let adminPool: Pool;
  let apiPool: Pool;
  let schemaPool: Pool;
  let service: CheckService;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'check-service-admin-test',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    const connectionString = databaseUrl(adminConnectionString!, databaseName);
    schemaPool = createDatabasePool({
      applicationName: 'check-service-schema-test',
      connectionString,
      maxConnections: 2,
    });
    await runMigrations(schemaPool, { appBuild: 'check-service-integration-test' });
    await schemaPool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES
         ($1, 'owner-a@example.test', 'owner-a@example.test', 'Owner A', 'ACTIVE', statement_timestamp()),
         ($2, 'owner-b@example.test', 'owner-b@example.test', 'Owner B', 'ACTIVE', statement_timestamp())`,
      [ownerA, ownerB],
    );
    apiPool = createDatabasePool({
      applicationName: 'check-service-api-test',
      connectionString,
      databaseRole: 'site_monitor_api',
      maxConnections: 6,
    });
    service = new CheckService(apiPool, { checkLimit: 20, securityKey: key });
  }, 30_000);

  afterAll(async () => {
    if (apiPool) await apiPool.end();
    if (schemaPool) await schemaPool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName);
      await adminPool.end();
    }
  }, 30_000);

  function createInput(name: string) {
    return {
      expected_status_code: 200,
      interval_seconds: 30,
      name,
      timeout_ms: 5000,
      url: `https://${name.toLowerCase().replaceAll(' ', '-')}.example.com/path#fragment`,
    };
  }

  it('serializes create retries into one complete aggregate and canonical receipt', async () => {
    const sensitiveUrl = 'https://primary-site.example.com/path?credential=never-emit-this';
    const sensitiveExpectedText = 'private-response-marker-never-emit-this';
    const input = {
      ...createInput('Primary Site'),
      expected_body_substring: sensitiveExpectedText,
      url: sensitiveUrl,
    };
    const [first, second] = await Promise.all([
      service.create(
        ownerA,
        input,
        'check-create-concurrent-001',
        '00000000-0000-7000-8000-000000000011',
      ),
      service.create(
        ownerA,
        input,
        'check-create-concurrent-001',
        '00000000-0000-7000-8000-000000000012',
      ),
    ]);

    expect(first.check).toEqual(second.check);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(first.check).toMatchObject({
      execution_state: 'ACTIVE',
      probe_generation: '1',
      resource_version: '1',
      schedule_generation: '1',
      url: sensitiveUrl,
    });
    const persisted = await schemaPool.query<{
      audits: string;
      checks: string;
      events: string;
      intervals: string;
      receipts: string;
      states: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM app.checks WHERE owner_id = $1) AS checks,
         (SELECT count(*)::text FROM monitoring.check_current_states WHERE owner_id = $1) AS states,
         (SELECT count(*)::text FROM monitoring.open_health_intervals WHERE owner_id = $1) AS intervals,
         (SELECT count(*)::text FROM infra.api_idempotency_records WHERE owner_id = $1) AS receipts,
         (SELECT count(*)::text FROM infra.outbox_events WHERE owner_id = $1) AS events,
         (SELECT count(*)::text FROM audit.events WHERE owner_id = $1) AS audits`,
      [ownerA],
    );
    expect(persisted.rows[0]).toEqual({
      audits: '1',
      checks: '1',
      events: '1',
      intervals: '1',
      receipts: '1',
      states: '1',
    });
    const emitted = await schemaPool.query<{ audits: unknown; events: unknown }>(
      `SELECT
         (SELECT jsonb_agg(metadata ORDER BY occurred_at, id)
            FROM audit.events WHERE owner_id = $1) AS audits,
         (SELECT jsonb_agg(payload ORDER BY occurred_at, id)
            FROM infra.outbox_events WHERE owner_id = $1) AS events`,
      [ownerA],
    );
    const serializedEmissions = JSON.stringify(emitted.rows[0]);
    expect(serializedEmissions).not.toContain(sensitiveUrl);
    expect(serializedEmissions).not.toContain('credential=never-emit-this');
    expect(serializedEmissions).not.toContain(sensitiveExpectedText);
  });

  it('isolates owners and applies combined changes with one increment per version axis', async () => {
    const created = await service.create(
      ownerB,
      createInput('Owner B Site'),
      'owner-b-check-001',
      '00000000-0000-7000-8000-000000000021',
    );
    await expect(service.get(ownerA, created.check.id)).rejects.toMatchObject({
      code: 'resource_not_found',
      status: 404,
    });

    const updated = await service.update(
      ownerB,
      created.check.id,
      '1',
      { interval_seconds: 60, name: 'Owner B Updated', timeout_ms: 6000 },
      '00000000-0000-7000-8000-000000000022',
    );
    expect(updated).toMatchObject({
      interval_seconds: 60,
      name: 'Owner B Updated',
      probe_generation: '2',
      resource_version: '2',
      schedule_generation: '2',
      timeout_ms: 6000,
    });
    const noop = await service.update(
      ownerB,
      created.check.id,
      '2',
      { name: 'Owner B Updated' },
      '00000000-0000-7000-8000-000000000023',
    );
    expect(noop.resource_version).toBe('2');
    await expect(
      service.update(
        ownerB,
        created.check.id,
        '1',
        { name: 'Stale write' },
        '00000000-0000-7000-8000-000000000024',
      ),
    ).rejects.toMatchObject({ code: 'resource_version_mismatch', etag: '"rv-2"', status: 412 });

    const state = await schemaPool.query<{
      freshness_state: string;
      health_state: string;
      historical_intervals: string;
      open_intervals: string;
    }>(
      `SELECT s.health_state, s.freshness_state,
              (SELECT count(*)::text FROM monitoring.health_intervals h
               WHERE h.owner_id = s.owner_id AND h.check_id = s.check_id) AS historical_intervals,
              (SELECT count(*)::text FROM monitoring.open_health_intervals h
               WHERE h.owner_id = s.owner_id AND h.check_id = s.check_id) AS open_intervals
       FROM monitoring.check_current_states s WHERE s.owner_id = $1 AND s.check_id = $2`,
      [ownerB, created.check.id],
    );
    expect(state.rows[0]).toEqual({
      freshness_state: 'STALE',
      health_state: 'UNKNOWN',
      historical_intervals: '1',
      open_intervals: '1',
    });
  });

  it('coalesces concurrent manual requests behind the single-active-job invariant', async () => {
    const created = await service.create(
      ownerA,
      createInput('Manual Site'),
      'manual-site-create-001',
      '00000000-0000-7000-8000-000000000031',
    );
    const [first, second] = await Promise.all([
      service.requestManualRun(
        ownerA,
        created.check.id,
        '1',
        'manual-site-run-001',
        '00000000-0000-7000-8000-000000000032',
      ),
      service.requestManualRun(
        ownerA,
        created.check.id,
        '1',
        'manual-site-run-002',
        '00000000-0000-7000-8000-000000000033',
      ),
    ]);
    expect([first.disposition, second.disposition].sort()).toEqual(['COALESCED', 'ENQUEUED']);
    const replay = await service.requestManualRun(
      ownerA,
      created.check.id,
      '1',
      'manual-site-run-001',
      '00000000-0000-7000-8000-000000000034',
    );
    expect(replay).toEqual(first);

    const state = await schemaPool.query<{
      active_jobs: string;
      manual_pending: boolean;
      manual_requested_mode: string | null;
      resource_version: string;
    }>(
      `SELECT c.resource_version::text,
              c.manual_requested_at IS NOT NULL AS manual_pending,
              c.manual_requested_mode,
              count(j.id) FILTER (WHERE j.state IN ('PENDING', 'LEASED', 'RUNNING'))::text AS active_jobs
       FROM app.checks c
       LEFT JOIN monitoring.check_jobs j ON j.owner_id = c.owner_id AND j.check_id = c.id
       WHERE c.owner_id = $1 AND c.id = $2
       GROUP BY c.id`,
      [ownerA, created.check.id],
    );
    expect(state.rows[0]).toEqual({
      active_jobs: '1',
      manual_pending: true,
      manual_requested_mode: 'STATEFUL',
      resource_version: '1',
    });
  });

  it('pauses, resumes, and soft-deletes without exposing the deleted configuration', async () => {
    const created = await service.create(
      ownerA,
      createInput('Lifecycle Site'),
      'lifecycle-site-create-001',
      '00000000-0000-7000-8000-000000000041',
    );
    await service.requestManualRun(
      ownerA,
      created.check.id,
      '1',
      'lifecycle-site-run-001',
      '00000000-0000-7000-8000-000000000042',
    );
    const paused = await service.pause(
      ownerA,
      created.check.id,
      '1',
      '00000000-0000-7000-8000-000000000043',
    );
    expect(paused).toMatchObject({
      execution_state: 'PAUSED',
      resource_version: '2',
      schedule_generation: '2',
    });
    const pausedAgain = await service.pause(
      ownerA,
      created.check.id,
      '2',
      '00000000-0000-7000-8000-000000000044',
    );
    expect(pausedAgain.resource_version).toBe('2');
    const resumed = await service.resume(
      ownerA,
      created.check.id,
      '2',
      '00000000-0000-7000-8000-000000000045',
    );
    expect(resumed).toMatchObject({
      execution_state: 'ACTIVE',
      resource_version: '3',
      schedule_generation: '3',
    });
    await service.delete(ownerA, created.check.id, '3', '00000000-0000-7000-8000-000000000046');
    await expect(service.get(ownerA, created.check.id)).rejects.toMatchObject({
      code: 'resource_not_found',
    });
    const state = await schemaPool.query<{
      active_jobs: string;
      lifecycle_state: string;
      open_intervals: string;
      resource_version: string;
      schedule_generation: string;
    }>(
      `SELECT c.lifecycle_state, c.resource_version::text, c.schedule_generation::text,
              (SELECT count(*)::text FROM monitoring.check_jobs j
               WHERE j.owner_id = c.owner_id AND j.check_id = c.id
                 AND j.state IN ('PENDING', 'LEASED', 'RUNNING')) AS active_jobs,
              (SELECT count(*)::text FROM monitoring.open_health_intervals h
               WHERE h.owner_id = c.owner_id AND h.check_id = c.id) AS open_intervals
       FROM app.checks c WHERE c.owner_id = $1 AND c.id = $2`,
      [ownerA, created.check.id],
    );
    expect(state.rows[0]).toEqual({
      active_jobs: '0',
      lifecycle_state: 'DELETED',
      open_intervals: '0',
      resource_version: '4',
      schedule_generation: '4',
    });
  });

  it('keeps a leased job active until cancellation acknowledgement', async () => {
    const created = await service.create(
      ownerA,
      createInput('Cancellation Site'),
      'cancellation-site-create-001',
      '00000000-0000-7000-8000-000000000051',
    );
    const enqueued = await service.requestManualRun(
      ownerA,
      created.check.id,
      '1',
      'cancellation-site-run-001',
      '00000000-0000-7000-8000-000000000052',
    );
    const attemptId = randomUUID();
    await schemaPool.query(
      `UPDATE monitoring.check_jobs
       SET state = 'LEASED', attempt_count = 1, lease_owner = 'integration-worker',
           lease_expires_at = statement_timestamp() + interval '30 seconds',
           heartbeat_at = statement_timestamp(), fencing_token = 1,
           updated_at = statement_timestamp()
       WHERE id = $1`,
      [enqueued.request_id],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.check_job_attempts
         (id, owner_id, check_id, job_id, attempt_number, worker_id, fencing_token,
          lease_acquired_at, started_at, last_heartbeat_at)
       VALUES ($1, $2, $3, $4, 1, 'integration-worker', 1,
               statement_timestamp(), statement_timestamp(), statement_timestamp())`,
      [attemptId, ownerA, created.check.id, enqueued.request_id],
    );
    const coalesced = await service.requestManualRun(
      ownerA,
      created.check.id,
      '1',
      'cancellation-site-run-002',
      '00000000-0000-7000-8000-000000000053',
    );
    expect(coalesced).toMatchObject({ disposition: 'COALESCED', mode: 'STATEFUL' });

    await service.pause(ownerA, created.check.id, '1', '00000000-0000-7000-8000-000000000054');
    const persisted = await schemaPool.query<{
      cancellation_reason: string | null;
      cancellation_requested: boolean;
      manual_requested_at: Date | null;
      manual_requested_mode: string | null;
      state: string;
    }>(
      `SELECT j.state, j.cancellation_reason,
              j.cancellation_requested_at IS NOT NULL AS cancellation_requested,
              c.manual_requested_at, c.manual_requested_mode
       FROM monitoring.check_jobs j
       JOIN app.checks c ON c.owner_id = j.owner_id AND c.id = j.check_id
       WHERE j.id = $1`,
      [enqueued.request_id],
    );
    expect(persisted.rows[0]).toEqual({
      cancellation_reason: 'CHECK_PAUSED',
      cancellation_requested: true,
      manual_requested_at: null,
      manual_requested_mode: null,
      state: 'LEASED',
    });
  });

  it('suspends an observed incident on pause and closes it on delete', async () => {
    const created = await service.create(
      ownerB,
      createInput('Incident Site'),
      'incident-site-create-001',
      '00000000-0000-7000-8000-000000000047',
    );
    const jobId = randomUUID();
    const attemptId = randomUUID();
    const runId = randomUUID();
    const incidentId = randomUUID();
    const segmentId = randomUUID();
    await schemaPool.query(
      `INSERT INTO monitoring.check_jobs
         (id, owner_id, check_id, trigger_kind, manual_mode, scheduled_for,
          state, config_snapshot, resource_version, probe_generation,
          schedule_generation, completed_at, terminal_reason)
       VALUES ($1, $2, $3, 'MANUAL', 'STATEFUL', statement_timestamp() - interval '10 seconds',
               'COMPLETED', '{}'::jsonb, 1, 1, 1, statement_timestamp(), 'RESULT_RECORDED')`,
      [jobId, ownerB, created.check.id],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.check_job_attempts
         (id, owner_id, check_id, job_id, attempt_number, worker_id, fencing_token,
          lease_acquired_at, started_at, ended_at, terminal_reason)
       VALUES ($1, $2, $3, $4, 1, 'integration-worker', 1,
               statement_timestamp() - interval '10 seconds',
               statement_timestamp() - interval '9 seconds',
               statement_timestamp() - interval '5 seconds', 'RESULT_RECORDED')`,
      [attemptId, ownerB, created.check.id, jobId],
    );
    const run = await schemaPool.query<{ finished_at: string }>(
      `INSERT INTO monitoring.check_runs
         (finished_at, id, owner_id, check_id, job_id, attempt_id, trigger_kind,
          manual_mode, resource_version, probe_generation, schedule_generation,
          fencing_token, scheduled_for, started_at, total_ms, status_code,
          body_match, outcome, failure_category, accepted_for_state)
       VALUES (statement_timestamp() - interval '5 seconds', $1, $2, $3, $4, $5,
               'MANUAL', 'STATEFUL', 1, 1, 1, 1,
               statement_timestamp() - interval '10 seconds',
               statement_timestamp() - interval '9 seconds', 4000, 503, true,
               'FAIL', 'HTTP_STATUS', true)
       RETURNING finished_at::text AS finished_at`,
      [runId, ownerB, created.check.id, jobId, attemptId],
    );
    await schemaPool.query(
      `UPDATE monitoring.check_job_attempts
       SET result_recorded_at = $5, result_run_finished_at = $5, result_run_id = $4
       WHERE owner_id = $1 AND check_id = $2 AND job_id = $3 AND id = $6`,
      [ownerB, created.check.id, jobId, runId, run.rows[0]!.finished_at, attemptId],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.incidents
         (id, owner_id, check_id, first_failure_run_id, first_failure_run_finished_at,
          confirmation_run_id, confirmation_run_finished_at, started_at, confirmed_at,
          last_failure_category)
       VALUES ($1, $2, $3, $4, $5, $4, $5, $5, $5, 'HTTP_STATUS')`,
      [incidentId, ownerB, created.check.id, runId, run.rows[0]!.finished_at],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.incident_segments
         (id, owner_id, check_id, incident_id, started_at,
          start_run_id, start_run_finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $5)`,
      [segmentId, ownerB, created.check.id, incidentId, run.rows[0]!.finished_at, runId],
    );
    await schemaPool.query(
      `UPDATE monitoring.check_current_states
       SET health_state = 'DOWN', freshness_state = 'FRESH', open_incident_id = $3,
           last_accepted_run_id = $4, last_accepted_run_finished_at = $5,
           last_accepted_fencing_token = 1, last_failure_at = $5,
           last_response_time_ms = 4000, last_status_code = 503,
           last_failure_category = 'HTTP_STATUS', fresh_until = statement_timestamp() + interval '30 seconds'
       WHERE owner_id = $1 AND check_id = $2`,
      [ownerB, created.check.id, incidentId, runId, run.rows[0]!.finished_at],
    );
    await schemaPool.query(
      `UPDATE monitoring.open_health_intervals
       SET classification = 'DOWN', started_at = $3, source_kind = 'RUN',
           source_run_id = $4, source_run_finished_at = $3
       WHERE owner_id = $1 AND check_id = $2`,
      [ownerB, created.check.id, run.rows[0]!.finished_at, runId],
    );

    await schemaPool.query(
      `UPDATE monitoring.check_current_states
       SET fresh_until = $3::timestamptz + interval '4 seconds'
       WHERE owner_id = $1 AND check_id = $2`,
      [ownerB, created.check.id, run.rows[0]!.finished_at],
    );
    const overduePage = await service.list(ownerB, {
      freshness: 'STALE',
      health: 'UNKNOWN',
      limit: 20,
    });
    const overdue = overduePage.data.find((item) => item.check.id === created.check.id);
    expect(overdue?.status).toMatchObject({
      freshness_state: 'STALE',
      health_state: 'UNKNOWN',
      current_incident: {
        id: incidentId,
        observation_mode: 'UNOBSERVED',
      },
    });
    expect(overdue!.status.current_incident!.observed_duration_ms).toBe('4000');
    const falselyFresh = await service.list(ownerB, { freshness: 'FRESH', limit: 20 });
    expect(falselyFresh.data.some((item) => item.check.id === created.check.id)).toBe(false);
    await schemaPool.query(
      `UPDATE monitoring.check_current_states
       SET fresh_until = statement_timestamp() + interval '30 seconds'
       WHERE owner_id = $1 AND check_id = $2`,
      [ownerB, created.check.id],
    );

    const paused = await service.pause(
      ownerB,
      created.check.id,
      '1',
      '00000000-0000-7000-8000-000000000048',
    );
    const suspended = await schemaPool.query<{
      close_reason: string;
      observation_mode: string;
      observed_duration_ms: string;
      status: string;
    }>(
      `SELECT i.status, i.observation_mode, i.observed_duration_ms::text, s.close_reason
       FROM monitoring.incidents i
       JOIN monitoring.incident_segments s ON s.incident_id = i.id
       WHERE i.id = $1 AND s.id = $2`,
      [incidentId, segmentId],
    );
    expect(paused.resource_version).toBe('2');
    expect(suspended.rows[0]).toMatchObject({
      close_reason: 'PAUSED',
      observation_mode: 'UNOBSERVED',
      status: 'OPEN',
    });
    expect(BigInt(suspended.rows[0]!.observed_duration_ms)).toBeGreaterThanOrEqual(5000n);

    await service.delete(ownerB, created.check.id, '2', '00000000-0000-7000-8000-000000000049');
    const closed = await schemaPool.query<{
      closure_reason: string;
      current_incident: string | null;
      status: string;
    }>(
      `SELECT i.status, i.closure_reason, s.open_incident_id AS current_incident
       FROM monitoring.incidents i
       JOIN monitoring.check_current_states s
         ON s.owner_id = i.owner_id AND s.check_id = i.check_id
       WHERE i.id = $1`,
      [incidentId],
    );
    expect(closed.rows[0]).toEqual({
      closure_reason: 'CHECK_DELETED',
      current_incident: null,
      status: 'CLOSED',
    });
  });

  it('binds keyset cursors to normalized list filters', async () => {
    await service.create(
      ownerA,
      createInput('Cursor Site A'),
      'cursor-site-create-001',
      '00000000-0000-7000-8000-000000000051',
    );
    await service.create(
      ownerA,
      createInput('Cursor Site B'),
      'cursor-site-create-002',
      '00000000-0000-7000-8000-000000000052',
    );
    const first = await service.list(ownerA, { health: 'UNKNOWN', limit: 1 });
    expect(first.data).toHaveLength(1);
    expect(first.page.has_more).toBe(true);
    const second = await service.list(ownerA, {
      cursor: first.page.next_cursor!,
      health: 'UNKNOWN',
      limit: 1,
    });
    expect(second.data[0]?.check.id).not.toBe(first.data[0]?.check.id);
    await expect(
      service.list(ownerA, { cursor: first.page.next_cursor!, health: 'UP', limit: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_cursor', status: 400 });
  });

  it.each([
    ['small', '00000000-0000-4000-8000-000000000003', 20],
    ['medium', '00000000-0000-4000-8000-000000000004', 200],
    ['large', '00000000-0000-4000-8000-000000000005', 500],
  ] as const)(
    'paginates the %s capacity fixture without unbounded responses',
    async (_, ownerId, count) => {
      await schemaPool.query(
        `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES ($1, $2, $2, $3, 'ACTIVE', statement_timestamp())`,
        [ownerId, `capacity-${count}@example.test`, `Capacity ${count}`],
      );
      await schemaPool.query(
        `WITH inserted AS (
         INSERT INTO app.checks
           (id, owner_id, name, url, interval_seconds, timeout_ms,
            expected_status_code, cadence_anchor_at, next_run_at, created_at, updated_at)
         SELECT uuidv7(), $1::uuid, format('Capacity %s', item),
                format('https://capacity-%s.example.test/', item), 30, 5000, 200,
                statement_timestamp(), statement_timestamp(),
                statement_timestamp() - (item * interval '1 millisecond'),
                statement_timestamp() - (item * interval '1 millisecond')
         FROM generate_series(1, $2::integer) AS item
         RETURNING owner_id, id
       )
       INSERT INTO monitoring.check_current_states (owner_id, check_id)
       SELECT owner_id, id FROM inserted`,
        [ownerId, count],
      );

      const ids = new Set<string>();
      const pageDurations: number[] = [];
      let cursor: string | undefined;
      do {
        const startedAt = performance.now();
        const page = await service.list(ownerId, { ...(cursor ? { cursor } : {}), limit: 100 });
        pageDurations.push(performance.now() - startedAt);
        expect(page.data.length).toBeLessThanOrEqual(100);
        for (const item of page.data) ids.add(item.check.id);
        cursor = page.page.next_cursor ?? undefined;
      } while (cursor);

      expect(ids.size).toBe(count);
      expect(pageDurations).toHaveLength(Math.ceil(count / 100));
      expect(Math.max(...pageDurations)).toBeLessThan(5_000);
    },
  );
});
