import { randomUUID } from 'node:crypto';

import { createDatabasePool, runMigrations, type Pool } from '@site-monitor/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GroupService } from './group-service.js';

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

databaseSuite('group service PostgreSQL boundary', () => {
  const databaseName = `site_monitor_groups_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerA = '00000000-0000-4000-8000-000000000001';
  const ownerB = '00000000-0000-4000-8000-000000000002';
  const key = Buffer.alloc(32, 71);
  let adminPool: Pool;
  let apiPool: Pool;
  let schemaPool: Pool;
  let service: GroupService;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'group-service-admin-test',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    const connectionString = databaseUrl(adminConnectionString!, databaseName);
    schemaPool = createDatabasePool({
      applicationName: 'group-service-schema-test',
      connectionString,
      maxConnections: 2,
    });
    await runMigrations(schemaPool, { appBuild: 'group-service-integration-test' });
    await schemaPool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES
         ($1, 'owner-a@example.test', 'owner-a@example.test', 'Owner A', 'ACTIVE', statement_timestamp()),
         ($2, 'owner-b@example.test', 'owner-b@example.test', 'Owner B', 'ACTIVE', statement_timestamp())`,
      [ownerA, ownerB],
    );
    apiPool = createDatabasePool({
      applicationName: 'group-service-api-test',
      connectionString,
      databaseRole: 'site_monitor_api',
      maxConnections: 4,
    });
    service = new GroupService(apiPool, { groupLimit: 10, securityKey: key });
  }, 30_000);

  afterAll(async () => {
    if (apiPool) await apiPool.end();
    if (schemaPool) await schemaPool.end();
    if (adminPool) {
      await adminPool.query(
        `DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)} WITH (FORCE)`,
      );
      await adminPool.end();
    }
  }, 30_000);

  it('serializes concurrent create retries into one atomic group aggregate', async () => {
    const request = {
      correlationId: '00000000-0000-7000-8000-000000000010',
      idempotencyKey: 'group-create-concurrent-001',
      input: { description: ' Customer-facing services ', name: ' Production ' },
    };
    const [first, second] = await Promise.all([
      service.create(ownerA, request.input, request.idempotencyKey, request.correlationId),
      service.create(ownerA, request.input, request.idempotencyKey, request.correlationId),
    ]);

    expect(first.group).toEqual(second.group);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(first.group).toMatchObject({
      description: 'Customer-facing services',
      name: 'Production',
      resource_version: '1',
    });

    const persisted = await schemaPool.query<{ count: string }>(
      `SELECT
         (SELECT count(*)::text FROM app.check_groups WHERE owner_id = $1) AS groups,
         (SELECT count(*)::text FROM notification.policies WHERE owner_id = $1) AS policies,
         (SELECT count(*)::text FROM infra.api_idempotency_records WHERE owner_id = $1) AS receipts,
         (SELECT count(*)::text FROM infra.outbox_events WHERE owner_id = $1) AS events,
         (SELECT count(*)::text FROM audit.events WHERE owner_id = $1) AS audits`,
      [ownerA],
    );
    expect(persisted.rows[0]).toEqual({
      audits: '1',
      events: '1',
      groups: '1',
      policies: '1',
      receipts: '1',
    });
  });

  it('rejects an idempotency key reused with a different normalized request', async () => {
    await expect(
      service.create(
        ownerA,
        { name: 'Different' },
        'group-create-concurrent-001',
        '00000000-0000-7000-8000-000000000011',
      ),
    ).rejects.toMatchObject({ code: 'idempotency_key_reused', status: 409 });
  });

  it('hides another owner resource and enforces optimistic concurrency', async () => {
    const created = await service.create(
      ownerB,
      { name: 'Private owner B group' },
      'owner-b-group-001',
      '00000000-0000-7000-8000-000000000012',
    );
    await expect(service.get(ownerA, created.group.id)).rejects.toMatchObject({
      code: 'resource_not_found',
      status: 404,
    });

    const updated = await service.update(
      ownerB,
      created.group.id,
      '1',
      { description: 'B only' },
      '00000000-0000-7000-8000-000000000013',
    );
    expect(updated.resource_version).toBe('2');
    await expect(
      service.update(
        ownerB,
        created.group.id,
        '1',
        { name: 'Stale write' },
        '00000000-0000-7000-8000-000000000014',
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'resource_version_mismatch',
        etag: '"rv-2"',
        status: 412,
      }),
    );
  });

  it('paginates with a signed cursor and rejects tampering', async () => {
    await service.create(
      ownerA,
      { name: 'Second group' },
      'owner-a-group-002',
      '00000000-0000-7000-8000-000000000015',
    );
    const firstPage = await service.list(ownerA, { limit: 1 });
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.page).toMatchObject({ has_more: true });
    expect(firstPage.page.next_cursor).not.toBeNull();

    const secondPage = await service.list(ownerA, {
      cursor: firstPage.page.next_cursor!,
      limit: 1,
    });
    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.data[0]?.group.id).not.toBe(firstPage.data[0]?.group.id);
    await expect(
      service.list(ownerA, { cursor: `${firstPage.page.next_cursor!}x`, limit: 1 }),
    ).rejects.toMatchObject({ code: 'invalid_cursor', status: 400 });
  });

  it('soft-deletes a group and atomically detaches its live checks', async () => {
    const target = await service.create(
      ownerA,
      { name: 'Delete target' },
      'owner-a-group-delete-001',
      '00000000-0000-7000-8000-000000000016',
    );
    const checkId = '00000000-0000-7000-8000-000000000201';
    await schemaPool.query(
      `INSERT INTO app.checks
         (id, owner_id, group_id, name, url, interval_seconds, timeout_ms,
          expected_status_code, next_run_at)
       VALUES ($1, $2, $3, 'Attached', 'https://example.test/', 30, 5000, 200,
               statement_timestamp())`,
      [checkId, ownerA, target.group.id],
    );

    await service.delete(
      ownerA,
      target.group.id,
      target.group.resource_version,
      '00000000-0000-7000-8000-000000000017',
    );
    await expect(service.get(ownerA, target.group.id)).rejects.toMatchObject({
      code: 'resource_not_found',
    });
    const state = await schemaPool.query<{
      check_version: string;
      deleted: boolean;
      group_id: string | null;
    }>(
      `SELECT c.group_id, c.resource_version::text AS check_version,
              g.deleted_at IS NOT NULL AS deleted
       FROM app.checks c
       JOIN app.check_groups g ON g.id = $2
       WHERE c.id = $1`,
      [checkId, target.group.id],
    );
    expect(state.rows[0]).toEqual({ check_version: '2', deleted: true, group_id: null });
  });

  it('enforces the deployment quota inside the owner transaction', async () => {
    const quotaService = new GroupService(apiPool, { groupLimit: 1, securityKey: key });
    await expect(
      quotaService.create(
        ownerB,
        { name: 'Over quota' },
        'owner-b-over-quota-001',
        '00000000-0000-7000-8000-000000000018',
      ),
    ).rejects.toMatchObject({ code: 'quota_exceeded', status: 409 });
  });
});
