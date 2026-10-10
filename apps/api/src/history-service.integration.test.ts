import { randomUUID } from 'node:crypto';

import { createDatabasePool, runMigrations, type Pool } from '@site-monitor/database';
import { dropTestDatabase } from '@site-monitor/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HistoryService } from './history-service.js';

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

databaseSuite('history service PostgreSQL boundary', () => {
  const databaseName = `site_monitor_history_api_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerA = '00000000-0000-4000-8000-000000000001';
  const ownerB = '00000000-0000-4000-8000-000000000002';
  const groupA = '00000000-0000-4000-8000-000000000101';
  const groupB = '00000000-0000-4000-8000-000000000102';
  const checkA = '00000000-0000-4000-8000-000000000201';
  const checkB = '00000000-0000-4000-8000-000000000202';
  const incidentA = '00000000-0000-4000-8000-000000000301';
  const incidentAOlder = '00000000-0000-4000-8000-000000000302';
  const key = Buffer.alloc(32, 71);
  let adminPool: Pool;
  let apiPool: Pool;
  let schemaPool: Pool;
  let service: HistoryService;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'history-api-admin-test',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    const connectionString = databaseUrl(adminConnectionString!, databaseName);
    schemaPool = createDatabasePool({
      applicationName: 'history-api-schema-test',
      connectionString,
      maxConnections: 2,
    });
    await runMigrations(schemaPool, { appBuild: 'history-api-integration-test' });
    await schemaPool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES
         ($1, 'history-a@example.test', 'history-a@example.test', 'History A', 'ACTIVE', statement_timestamp()),
         ($2, 'history-b@example.test', 'history-b@example.test', 'History B', 'ACTIVE', statement_timestamp())`,
      [ownerA, ownerB],
    );
    await schemaPool.query(
      `INSERT INTO app.check_groups (id, owner_id, name)
       VALUES ($3, $1, 'Owner A group'), ($4, $2, 'Owner B group')`,
      [ownerA, ownerB, groupA, groupB],
    );
    await schemaPool.query(
      `INSERT INTO app.checks
         (id, owner_id, group_id, name, url, interval_seconds, timeout_ms,
          expected_status_code, next_run_at)
       VALUES
         ($5, $1, $3, 'Owner A tombstone', 'https://history-a.example.test/', 30, 5000, 200, statement_timestamp()),
         ($6, $2, $4, 'Owner B private', 'https://history-b.example.test/', 30, 5000, 200, statement_timestamp())`,
      [ownerA, ownerB, groupA, groupB, checkA, checkB],
    );
    await schemaPool.query(
      `UPDATE monitoring.rollup_checkpoints
       SET data_through = statement_timestamp(), updated_at = statement_timestamp()
       WHERE processor_name IN ('runs-minute-source', 'intervals-minute-source')`,
    );
    await schemaPool.query(
      `INSERT INTO monitoring.rollups_minute (
         bucket_start, owner_id, check_id, probe_generation,
         accepted_run_count, pass_count, fail_count, response_sample_count,
         response_sum_ms, response_min_ms, response_max_ms,
         up_ms, down_ms, unknown_ms, provisional_ms, computed_through
       ) VALUES (
         date_trunc('minute', statement_timestamp()) - interval '2 hours',
         $1, $2, 1, 2, 1, 1, 2, 300, 100, 200,
         60000, 0, 0, 0, statement_timestamp()
       )`,
      [ownerA, checkA],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.open_health_intervals (
         check_id, owner_id, classification, started_at, probe_generation, source_kind
       ) VALUES ($2, $1, 'UP', statement_timestamp() - interval '2 minutes', 1, 'STARTUP')`,
      [ownerA, checkA],
    );

    const evidence = Array.from({ length: 8 }, (_, index) => ({
      at: new Date(Date.now() - (6 * 60 - index * 20) * 60_000),
      id: randomUUID(),
    }));
    for (const item of evidence) {
      await schemaPool.query(
        `INSERT INTO monitoring.run_evidence (
           finished_at, id, owner_id, check_id, outcome,
           failure_category, total_ms, recorded_at
         ) VALUES ($1, $2, $3, $4, 'FAIL', 'HTTP_STATUS', 250, $1)`,
        [item.at, item.id, ownerA, checkA],
      );
    }
    await schemaPool.query(
      `INSERT INTO monitoring.incidents (
         id, owner_id, check_id, status, observation_mode,
         first_failure_run_id, first_failure_run_finished_at,
         confirmation_run_id, confirmation_run_finished_at,
         started_at, confirmed_at, closed_at, closure_reason, observed_duration_ms
       ) VALUES
         ($1, $2, $3, 'CLOSED', 'OBSERVED', $4, $5, $6, $7,
          statement_timestamp() - interval '3 hours', statement_timestamp() - interval '179 minutes',
          statement_timestamp() - interval '1 hour', 'RECOVERED', 5400000),
         ($8, $2, $3, 'CLOSED', 'OBSERVED', $9, $10, $11, $12,
          statement_timestamp() - interval '5 hours', statement_timestamp() - interval '299 minutes',
          statement_timestamp() - interval '4 hours', 'RECOVERED', 3600000)`,
      [
        incidentA,
        ownerA,
        checkA,
        evidence[0]!.id,
        evidence[0]!.at,
        evidence[1]!.id,
        evidence[1]!.at,
        incidentAOlder,
        evidence[4]!.id,
        evidence[4]!.at,
        evidence[5]!.id,
        evidence[5]!.at,
      ],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.incident_segments (
         owner_id, check_id, incident_id, started_at, ended_at,
         start_run_id, start_run_finished_at, end_run_id, end_run_finished_at, close_reason
       ) VALUES
         ($1, $2, $3, statement_timestamp() - interval '3 hours',
          statement_timestamp() - interval '2 hours', $4, $5, $6, $7, 'STALE'),
         ($1, $2, $3, statement_timestamp() - interval '90 minutes',
          statement_timestamp() - interval '1 hour', $8, $9, $10, $11, 'RECOVERED'),
         ($1, $2, $12, statement_timestamp() - interval '5 hours',
          statement_timestamp() - interval '4 hours', $13, $14, $15, $16, 'RECOVERED')`,
      [
        ownerA,
        checkA,
        incidentA,
        evidence[0]!.id,
        evidence[0]!.at,
        evidence[2]!.id,
        evidence[2]!.at,
        evidence[3]!.id,
        evidence[3]!.at,
        evidence[1]!.id,
        evidence[1]!.at,
        incidentAOlder,
        evidence[4]!.id,
        evidence[4]!.at,
        evidence[6]!.id,
        evidence[6]!.at,
      ],
    );
    await schemaPool.query(
      `UPDATE app.checks
       SET lifecycle_state = 'DELETED', deleted_at = statement_timestamp(),
           next_run_at = NULL, updated_at = statement_timestamp()
       WHERE owner_id = $1 AND id = $2`,
      [ownerA, checkA],
    );

    apiPool = createDatabasePool({
      applicationName: 'history-api-role-test',
      connectionString,
      databaseRole: 'site_monitor_api',
      maxConnections: 4,
    });
    service = new HistoryService(apiPool, { securityKey: key, statementTimeoutMs: 5_000 });
  }, 30_000);

  afterAll(async () => {
    if (apiPool) await apiPool.end();
    if (schemaPool) await schemaPool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName);
      await adminPool.end();
    }
  }, 30_000);

  it('combines historical rollups with the bounded raw/open tail for tombstoned checks', async () => {
    const history = await service.getHistory(ownerA, checkA, 'day');
    expect(history).toMatchObject({
      bucket_seconds: 300,
      check_id: checkA,
      period: 'day',
      resolution: 'minute',
    });
    expect(history.buckets).toHaveLength(288);
    expect(history.buckets.find((bucket) => bucket.sample_count === 2)).toMatchObject({
      response_time_ms: 150,
      sample_count: 2,
    });
    expect(Number(history.observed_up_ms)).toBeGreaterThanOrEqual(60_000);
    expect(
      Number(history.observed_up_ms) +
        Number(history.observed_down_ms) +
        Number(history.unknown_ms) +
        Number(history.provisional_ms),
    ).toBe(86_400_000);
    expect(new Date(history.generated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(history.to).getTime(),
    );
    await expect(service.getHistory(ownerB, checkA, 'day')).rejects.toMatchObject({
      code: 'resource_not_found',
      status: 404,
    });
  });

  it('fails closed with bounded retry metadata when source discovery is outside the raw tail', async () => {
    await schemaPool.query(
      `UPDATE monitoring.rollup_checkpoints
       SET data_through = statement_timestamp() - interval '1 day'
       WHERE processor_name = 'runs-minute-source'`,
    );
    await expect(service.getHistory(ownerA, checkA, 'day')).rejects.toMatchObject({
      code: 'history_projection_lagging',
      retryAfterSeconds: 5,
      retryable: true,
      status: 503,
    });
    await schemaPool.query(
      `UPDATE monitoring.rollup_checkpoints
       SET data_through = statement_timestamp()
       WHERE processor_name = 'runs-minute-source'`,
    );
  });

  it('paginates a filter-bound owner journal and synthesizes unobserved gaps', async () => {
    const first = await service.listIncidents(ownerA, {
      groupId: groupA,
      limit: 1,
      status: 'CLOSED',
    });
    expect(first.data).toHaveLength(1);
    expect(first.data[0]).toMatchObject({
      check_name: 'Owner A tombstone',
      group_id_at_open: groupA,
      status: 'CLOSED',
    });
    expect(first.page).toMatchObject({ has_more: true });
    const second = await service.listIncidents(ownerA, {
      cursor: first.page.next_cursor!,
      groupId: groupA,
      limit: 1,
      status: 'CLOSED',
    });
    expect(second.data).toHaveLength(1);
    expect(second.data[0]!.id).not.toBe(first.data[0]!.id);
    expect(second.generated_at).toBe(first.generated_at);
    await expect(
      service.listIncidents(ownerA, {
        cursor: first.page.next_cursor!,
        groupId: groupA,
        limit: 2,
        status: 'CLOSED',
      }),
    ).rejects.toMatchObject({ code: 'invalid_cursor', status: 400 });

    const detail = await service.getIncident(ownerA, incidentA);
    expect(detail).toMatchObject({
      check_name: 'Owner A tombstone',
      group_id_at_open: groupA,
      observed_duration_ms: '5400000',
      status: 'CLOSED',
      wall_duration_ms: '7200000',
    });
    expect(detail.segments.map((segment) => segment.kind)).toEqual([
      'UNOBSERVED',
      'OBSERVED_DOWN',
      'UNOBSERVED',
      'OBSERVED_DOWN',
    ]);
    await expect(service.getIncident(ownerB, incidentA)).rejects.toMatchObject({
      code: 'resource_not_found',
      status: 404,
    });
    await expect(
      service.listIncidents(ownerB, { checkId: checkA, limit: 50 }),
    ).rejects.toMatchObject({ code: 'resource_not_found', status: 404 });
    await expect(
      service.listIncidents(ownerB, { groupId: groupA, limit: 50 }),
    ).rejects.toMatchObject({ code: 'resource_not_found', status: 404 });
  });

  it('exposes only the narrow projection-status function to the API role', async () => {
    const privileges = await schemaPool.query<{
      direct_select: boolean;
      function_execute: boolean;
    }>(
      `SELECT
         has_table_privilege('site_monitor_api', 'monitoring.rollup_rebuild_ranges', 'SELECT') AS direct_select,
         has_function_privilege(
           'site_monitor_api',
           'security_api.history_projection_status(uuid,text,timestamptz,timestamptz)',
           'EXECUTE'
         ) AS function_execute`,
    );
    expect(privileges.rows[0]).toEqual({ direct_select: false, function_execute: true });
  });
});
