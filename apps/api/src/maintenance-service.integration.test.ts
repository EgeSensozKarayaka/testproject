import { randomUUID } from 'node:crypto';

import { createDatabasePool, runMigrations, type Pool } from '@site-monitor/database';
import { dropTestDatabase } from '@site-monitor/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MaintenanceService } from './maintenance-service.js';

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

function relativeInstant(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

databaseSuite('maintenance service PostgreSQL boundary', () => {
  const databaseName = `site_monitor_maintenance_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerA = '00000000-0000-4000-8000-000000000001';
  const ownerB = '00000000-0000-4000-8000-000000000002';
  const groupA = '00000000-0000-4000-8000-000000000101';
  const groupB = '00000000-0000-4000-8000-000000000102';
  const checkA = '00000000-0000-4000-8000-000000000201';
  const checkB = '00000000-0000-4000-8000-000000000202';
  const key = Buffer.alloc(32, 77);
  let adminPool: Pool;
  let apiPool: Pool;
  let schemaPool: Pool;
  let service: MaintenanceService;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'maintenance-service-admin-test',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    const connectionString = databaseUrl(adminConnectionString!, databaseName);
    schemaPool = createDatabasePool({
      applicationName: 'maintenance-service-schema-test',
      connectionString,
      maxConnections: 2,
    });
    await runMigrations(schemaPool, { appBuild: 'maintenance-service-integration-test' });
    await schemaPool.query(
      `INSERT INTO infra.destination_activations
         (destination, activated_at, activated_by_revision)
       VALUES ('REALTIME', statement_timestamp(), 14)`,
    );
    await schemaPool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES
         ($1, 'owner-a@example.test', 'owner-a@example.test', 'Owner A', 'ACTIVE', statement_timestamp()),
         ($2, 'owner-b@example.test', 'owner-b@example.test', 'Owner B', 'ACTIVE', statement_timestamp())`,
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
         ($5, $1, $3, 'Owner A check', 'https://owner-a.example.test/', 30, 5000, 200, statement_timestamp()),
         ($6, $2, $4, 'Owner B check', 'https://owner-b.example.test/', 30, 5000, 200, statement_timestamp())`,
      [ownerA, ownerB, groupA, groupB, checkA, checkB],
    );
    apiPool = createDatabasePool({
      applicationName: 'maintenance-service-api-test',
      connectionString,
      databaseRole: 'site_monitor_api',
      maxConnections: 4,
    });
    service = new MaintenanceService(apiPool, {
      maintenanceWindowLimit: 20,
      securityKey: key,
    });
  }, 30_000);

  afterAll(async () => {
    if (apiPool) await apiPool.end();
    if (schemaPool) await schemaPool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName);
      await adminPool.end();
    }
  }, 30_000);

  it('serializes concurrent create retries into one redacted aggregate', async () => {
    const input = {
      ends_at: relativeInstant(7_200_000),
      note: '  Private deploy note  ',
      starts_at: relativeInstant(3_600_000),
      target_id: checkA,
      target_type: 'CHECK' as const,
    };
    const [first, second] = await Promise.all([
      service.create(
        ownerA,
        input,
        'maintenance-create-concurrent-001',
        '00000000-0000-7000-8000-000000000010',
      ),
      service.create(
        ownerA,
        input,
        'maintenance-create-concurrent-001',
        '00000000-0000-7000-8000-000000000010',
      ),
    ]);

    expect(first.window).toEqual(second.window);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(first.window).toMatchObject({
      note: 'Private deploy note',
      resource_version: '1',
      state: 'UPCOMING',
      target_id: checkA,
      target_type: 'CHECK',
    });

    const persisted = await schemaPool.query<{
      audits: string;
      events: string;
      leaked: boolean;
      receipts: string;
      windows: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM app.maintenance_windows WHERE owner_id = $1) AS windows,
         (SELECT count(*)::text FROM infra.api_idempotency_records WHERE owner_id = $1
            AND operation = 'maintenance.create') AS receipts,
         (SELECT count(*)::text FROM infra.outbox_events WHERE owner_id = $1
            AND event_type = 'maintenance.created') AS events,
         (SELECT count(*)::text FROM audit.events WHERE owner_id = $1
            AND action = 'maintenance.created') AS audits,
         EXISTS (
           SELECT 1 FROM infra.outbox_events WHERE owner_id = $1
             AND payload::text LIKE '%Private deploy note%'
           UNION ALL
           SELECT 1 FROM audit.events WHERE owner_id = $1
             AND metadata::text LIKE '%Private deploy note%'
         ) AS leaked`,
      [ownerA],
    );
    expect(persisted.rows[0]).toEqual({
      audits: '1',
      events: '1',
      leaked: false,
      receipts: '1',
      windows: '1',
    });
  });

  it('replays the original response and rejects a reused key with another request', async () => {
    const created = await service.create(
      ownerB,
      {
        ends_at: relativeInstant(7_200_000),
        starts_at: relativeInstant(3_600_000),
        target_id: checkB,
        target_type: 'CHECK',
      },
      'maintenance-owner-b-replay-001',
      '00000000-0000-7000-8000-000000000011',
    );
    const originalRequest = {
      ends_at: created.window.ends_at,
      starts_at: created.window.starts_at,
      target_id: checkB,
      target_type: 'CHECK' as const,
    };
    const active = await service.update(
      ownerB,
      created.window.id,
      '1',
      { starts_at: relativeInstant(-60_000) },
      '00000000-0000-7000-8000-000000000012',
    );
    expect(active).toMatchObject({ resource_version: '2', state: 'ACTIVE' });

    const replay = await service.create(
      ownerB,
      originalRequest,
      'maintenance-owner-b-replay-001',
      '00000000-0000-7000-8000-000000000013',
    );
    expect(replay).toMatchObject({
      replayed: true,
      window: { id: created.window.id, resource_version: '1', state: 'UPCOMING' },
    });
    expect(await service.get(ownerB, created.window.id)).toMatchObject({
      resource_version: '2',
      state: 'ACTIVE',
    });
    await expect(
      service.create(
        ownerB,
        { ...originalRequest, note: 'Different' },
        'maintenance-owner-b-replay-001',
        '00000000-0000-7000-8000-000000000014',
      ),
    ).rejects.toMatchObject({ code: 'idempotency_key_reused', status: 409 });
  });

  it('hides cross-owner targets and resources', async () => {
    const privateWindow = await service.create(
      ownerB,
      {
        ends_at: relativeInstant(10_800_000),
        starts_at: relativeInstant(7_200_000),
        target_id: groupB,
        target_type: 'GROUP',
      },
      'maintenance-owner-b-private-001',
      '00000000-0000-7000-8000-000000000015',
    );
    await expect(service.get(ownerA, privateWindow.window.id)).rejects.toMatchObject({
      code: 'resource_not_found',
      status: 404,
    });
    await expect(
      service.create(
        ownerA,
        {
          ends_at: relativeInstant(10_800_000),
          starts_at: relativeInstant(7_200_000),
          target_id: checkB,
          target_type: 'CHECK',
        },
        'maintenance-cross-owner-target-001',
        '00000000-0000-7000-8000-000000000016',
      ),
    ).rejects.toMatchObject({ code: 'resource_not_found', status: 404 });
  });

  it('enforces optimistic concurrency and active-window mutation rules', async () => {
    const created = await service.create(
      ownerA,
      {
        ends_at: relativeInstant(14_400_000),
        starts_at: relativeInstant(10_800_000),
        target_id: groupA,
        target_type: 'GROUP',
      },
      'maintenance-update-001',
      '00000000-0000-7000-8000-000000000017',
    );
    const concurrent = await Promise.allSettled([
      service.update(
        ownerA,
        created.window.id,
        '1',
        { note: 'First contender' },
        '00000000-0000-7000-8000-000000000018',
      ),
      service.update(
        ownerA,
        created.window.id,
        '1',
        { note: 'Second contender' },
        '00000000-0000-7000-8000-000000000019',
      ),
    ]);
    const fulfilled = concurrent.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof service.update>>> =>
        result.status === 'fulfilled',
    );
    const rejected = concurrent.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]?.value).toMatchObject({ resource_version: '2' });
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      code: 'resource_version_mismatch',
      etag: '"rv-2"',
      status: 412,
    });

    const active = await service.create(
      ownerA,
      {
        ends_at: relativeInstant(3_600_000),
        starts_at: relativeInstant(-60_000),
        target_id: checkA,
        target_type: 'CHECK',
      },
      'maintenance-active-edit-001',
      '00000000-0000-7000-8000-000000000020',
    );
    await expect(
      service.update(
        ownerA,
        active.window.id,
        '1',
        { starts_at: relativeInstant(-120_000) },
        '00000000-0000-7000-8000-000000000021',
      ),
    ).rejects.toMatchObject({ code: 'maintenance_window_immutable', status: 409 });
    const extended = await service.update(
      ownerA,
      active.window.id,
      '1',
      { ends_at: relativeInstant(7_200_000) },
      '00000000-0000-7000-8000-000000000022',
    );
    expect(extended).toMatchObject({ resource_version: '2', state: 'ACTIVE' });
  });

  it('binds signed pagination cursors to time, state and target filters', async () => {
    for (const [keySuffix, startOffset] of [
      ['a', 18_000_000],
      ['b', 21_600_000],
    ] as const) {
      await service.create(
        ownerA,
        {
          ends_at: relativeInstant(startOffset + 3_600_000),
          starts_at: relativeInstant(startOffset),
          target_id: checkA,
          target_type: 'CHECK',
        },
        `maintenance-page-${keySuffix}`,
        `00000000-0000-7000-8000-00000000002${keySuffix === 'a' ? '3' : '4'}`,
      );
    }
    const filters = {
      checkId: checkA,
      endsAfter: relativeInstant(17_000_000),
      limit: 1,
      startsBefore: relativeInstant(30_000_000),
      state: 'UPCOMING' as const,
    };
    const firstPage = await service.list(ownerA, filters);
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.page).toMatchObject({ has_more: true });
    const secondPage = await service.list(ownerA, {
      ...filters,
      cursor: firstPage.page.next_cursor!,
    });
    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.data[0]?.id).not.toBe(firstPage.data[0]?.id);
    await expect(
      service.list(ownerA, {
        ...filters,
        cursor: firstPage.page.next_cursor!,
        state: 'ACTIVE',
      }),
    ).rejects.toMatchObject({ code: 'invalid_cursor', status: 400 });
    await expect(
      service.list(ownerA, { ...filters, cursor: `${firstPage.page.next_cursor!}x` }),
    ).rejects.toMatchObject({ code: 'invalid_cursor', status: 400 });
  });

  it('soft-cancels a live window idempotently and preserves ended history', async () => {
    const created = await service.create(
      ownerA,
      {
        ends_at: relativeInstant(36_000_000),
        starts_at: relativeInstant(32_400_000),
        target_id: groupA,
        target_type: 'GROUP',
      },
      'maintenance-cancel-001',
      '00000000-0000-7000-8000-000000000025',
    );
    await service.cancel(ownerA, created.window.id, '1', '00000000-0000-7000-8000-000000000026');
    const cancelled = await service.get(ownerA, created.window.id);
    expect(cancelled).toMatchObject({ resource_version: '2', state: 'CANCELLED' });
    await service.cancel(ownerA, created.window.id, '2', '00000000-0000-7000-8000-000000000027');
    await expect(
      service.update(
        ownerA,
        created.window.id,
        '2',
        { note: 'Too late' },
        '00000000-0000-7000-8000-000000000028',
      ),
    ).rejects.toMatchObject({ code: 'maintenance_window_immutable', status: 409 });

    const endedId = randomUUID();
    await schemaPool.query(
      `INSERT INTO app.maintenance_windows
         (id, owner_id, check_id, starts_at, ends_at)
       VALUES ($1, $2, $3, statement_timestamp() - interval '2 hours',
               statement_timestamp() - interval '1 hour')`,
      [endedId, ownerA, checkA],
    );
    await expect(
      service.cancel(ownerA, endedId, '1', '00000000-0000-7000-8000-000000000029'),
    ).rejects.toMatchObject({ code: 'maintenance_window_immutable', status: 409 });
  });

  it('enforces the configured active-and-upcoming owner quota', async () => {
    const quotaService = new MaintenanceService(apiPool, {
      maintenanceWindowLimit: 1,
      securityKey: key,
    });
    await expect(
      quotaService.create(
        ownerB,
        {
          ends_at: relativeInstant(43_200_000),
          starts_at: relativeInstant(39_600_000),
          target_id: checkB,
          target_type: 'CHECK',
        },
        'maintenance-owner-b-over-quota-001',
        '00000000-0000-7000-8000-000000000030',
      ),
    ).rejects.toMatchObject({ code: 'quota_exceeded', status: 409 });
  });
});
