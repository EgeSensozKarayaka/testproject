import { randomUUID } from 'node:crypto';

import { createDatabasePool, runMigrations, type Pool } from '@site-monitor/database';
import { dropTestDatabase } from '@site-monitor/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CheckService } from './check-service.js';
import { GroupService } from './group-service.js';
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

databaseSuite('maintenance cross-resource PostgreSQL boundary', () => {
  const databaseName = `site_monitor_maintenance_cross_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerId = '00000000-0000-4000-8000-000000000001';
  const key = Buffer.alloc(32, 88);
  let adminPool: Pool;
  let apiPool: Pool;
  let schemaPool: Pool;
  let checks: CheckService;
  let groups: GroupService;
  let maintenance: MaintenanceService;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'maintenance-cross-admin-test',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    const connectionString = databaseUrl(adminConnectionString!, databaseName);
    schemaPool = createDatabasePool({
      applicationName: 'maintenance-cross-schema-test',
      connectionString,
      maxConnections: 2,
    });
    await runMigrations(schemaPool, { appBuild: 'maintenance-cross-integration-test' });
    await schemaPool.query(
      `INSERT INTO infra.destination_activations
         (destination, activated_at, activated_by_revision)
       VALUES
         ('REALTIME', statement_timestamp(), 14),
         ('NOTIFICATION', statement_timestamp(), 15)
       ON CONFLICT (destination) DO NOTHING`,
    );
    await schemaPool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES ($1, 'owner@example.test', 'owner@example.test', 'Owner', 'ACTIVE',
               statement_timestamp())`,
      [ownerId],
    );
    apiPool = createDatabasePool({
      applicationName: 'maintenance-cross-api-test',
      connectionString,
      databaseRole: 'site_monitor_api',
      maxConnections: 6,
    });
    checks = new CheckService(apiPool, { checkLimit: 50, securityKey: key });
    groups = new GroupService(apiPool, { groupLimit: 20, securityKey: key });
    maintenance = new MaintenanceService(apiPool, {
      maintenanceWindowLimit: 50,
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

  async function createGroup(name: string) {
    return (await groups.create(ownerId, { name }, `group-${randomUUID()}`, randomUUID())).group;
  }

  async function createCheck(name: string, groupId: string | null = null) {
    return (
      await checks.create(
        ownerId,
        {
          expected_status_code: 200,
          group_id: groupId,
          interval_seconds: 30,
          name,
          timeout_ms: 5000,
          url: `https://${name.toLowerCase().replaceAll(' ', '-')}.example.test/`,
        },
        `check-${randomUUID()}`,
        randomUUID(),
      )
    ).check;
  }

  async function createActiveMaintenance(targetType: 'CHECK' | 'GROUP', targetId: string) {
    return (
      await maintenance.create(
        ownerId,
        {
          ends_at: relativeInstant(7_200_000),
          starts_at: relativeInstant(-60_000),
          target_id: targetId,
          target_type: targetType,
        },
        `maintenance-${randomUUID()}`,
        randomUUID(),
      )
    ).window;
  }

  async function maintenanceStatus(checkId: string) {
    const page = await checks.list(ownerId, { limit: 100 });
    return page.data.find((item) => item.check.id === checkId)?.status.maintenance;
  }

  it('reprojects group maintenance immediately when a check changes groups', async () => {
    const previousGroup = await createGroup('Previous maintenance group');
    const nextGroup = await createGroup('Next maintenance group');
    const check = await createCheck('Moving check', previousGroup.id);
    await createActiveMaintenance('GROUP', previousGroup.id);
    expect(await maintenanceStatus(check.id)).toMatchObject({ active: true });

    const correlationId = randomUUID();
    const moved = await checks.update(
      ownerId,
      check.id,
      check.resource_version,
      { group_id: nextGroup.id },
      correlationId,
    );
    expect(moved.group_id).toBe(nextGroup.id);
    expect(await maintenanceStatus(check.id)).toEqual({ active: false, until: null });

    await createActiveMaintenance('GROUP', nextGroup.id);
    expect(await maintenanceStatus(check.id)).toMatchObject({ active: true });
    const routed = await schemaPool.query<{ destination: string }>(
      `SELECT dispatch.destination
       FROM infra.outbox_events event
       JOIN infra.outbox_dispatches dispatch ON dispatch.event_id = event.id
       WHERE event.correlation_id = $1 AND event.event_type = 'check.group_changed'
       ORDER BY dispatch.destination`,
      [correlationId],
    );
    expect(routed.rows.map((row) => row.destination)).toEqual(['NOTIFICATION', 'REALTIME']);
  });

  it('serializes check deletion with maintenance create and preserves ended history', async () => {
    const check = await createCheck('Delete race check');
    const active = await createActiveMaintenance('CHECK', check.id);
    const endedId = randomUUID();
    await schemaPool.query(
      `INSERT INTO app.maintenance_windows
         (id, owner_id, check_id, starts_at, ends_at)
       VALUES ($1, $2, $3, statement_timestamp() - interval '2 hours',
               statement_timestamp() - interval '1 hour')`,
      [endedId, ownerId, check.id],
    );

    const deleteCorrelationId = randomUUID();
    const outcomes = await Promise.allSettled([
      maintenance.create(
        ownerId,
        {
          ends_at: relativeInstant(14_400_000),
          starts_at: relativeInstant(10_800_000),
          target_id: check.id,
          target_type: 'CHECK',
        },
        `maintenance-race-${randomUUID()}`,
        randomUUID(),
      ),
      checks.delete(ownerId, check.id, check.resource_version, deleteCorrelationId),
    ]);
    expect(outcomes[1]?.status).toBe('fulfilled');
    if (outcomes[0]?.status === 'rejected') {
      expect(outcomes[0].reason).toMatchObject({ code: 'resource_not_found', status: 404 });
    }

    const persisted = await schemaPool.query<{
      active_state: string;
      ended_state: string;
      live_scheduled: string;
    }>(
      `SELECT
         (SELECT state FROM app.maintenance_windows WHERE id = $2) AS active_state,
         (SELECT state FROM app.maintenance_windows WHERE id = $3) AS ended_state,
         (SELECT count(*)::text FROM app.maintenance_windows
          WHERE owner_id = $1 AND check_id = $4 AND state = 'SCHEDULED'
            AND ends_at > clock_timestamp()) AS live_scheduled`,
      [ownerId, active.id, endedId, check.id],
    );
    expect(persisted.rows[0]).toEqual({
      active_state: 'CANCELLED',
      ended_state: 'SCHEDULED',
      live_scheduled: '0',
    });

    const effects = await schemaPool.query<{
      cancellations: string;
      notification_dispatches: string;
    }>(
      `SELECT
         count(DISTINCT event.id) FILTER (
           WHERE event.event_type = 'maintenance.cancelled'
         )::text AS cancellations,
         count(*) FILTER (
           WHERE dispatch.destination = 'NOTIFICATION'
             AND event.event_type IN ('maintenance.cancelled', 'check.deleted')
         )::text AS notification_dispatches
       FROM infra.outbox_events event
       JOIN infra.outbox_dispatches dispatch ON dispatch.event_id = event.id
       WHERE event.correlation_id = $1`,
      [deleteCorrelationId],
    );
    expect(Number(effects.rows[0]?.cancellations)).toBeGreaterThanOrEqual(1);
    expect(Number(effects.rows[0]?.notification_dispatches)).toBeGreaterThanOrEqual(2);
  });

  it('cancels group maintenance, detaches checks and emits reconciliation wake-ups', async () => {
    const group = await createGroup('Delete maintenance group');
    const first = await createCheck('First grouped check', group.id);
    const second = await createCheck('Second grouped check', group.id);
    const active = await createActiveMaintenance('GROUP', group.id);
    const endedId = randomUUID();
    await schemaPool.query(
      `INSERT INTO app.maintenance_windows
         (id, owner_id, group_id, starts_at, ends_at)
       VALUES ($1, $2, $3, statement_timestamp() - interval '2 hours',
               statement_timestamp() - interval '1 hour')`,
      [endedId, ownerId, group.id],
    );
    expect(await maintenanceStatus(first.id)).toMatchObject({ active: true });

    const correlationId = randomUUID();
    await groups.delete(ownerId, group.id, group.resource_version, correlationId);
    expect(await maintenanceStatus(first.id)).toEqual({ active: false, until: null });
    expect(await maintenanceStatus(second.id)).toEqual({ active: false, until: null });

    const state = await schemaPool.query<{
      active_state: string;
      detached: string;
      ended_state: string;
    }>(
      `SELECT
         (SELECT state FROM app.maintenance_windows WHERE id = $2) AS active_state,
         (SELECT state FROM app.maintenance_windows WHERE id = $3) AS ended_state,
         (SELECT count(*)::text FROM app.checks
          WHERE owner_id = $1 AND id = ANY($4::uuid[]) AND group_id IS NULL) AS detached`,
      [ownerId, active.id, endedId, [first.id, second.id]],
    );
    expect(state.rows[0]).toEqual({
      active_state: 'CANCELLED',
      detached: '2',
      ended_state: 'SCHEDULED',
    });

    const events = await schemaPool.query<{
      event_type: string;
      notification_dispatches: string;
    }>(
      `SELECT event.event_type,
              count(*) FILTER (WHERE dispatch.destination = 'NOTIFICATION')::text
                AS notification_dispatches
       FROM infra.outbox_events event
       JOIN infra.outbox_dispatches dispatch ON dispatch.event_id = event.id
       WHERE event.correlation_id = $1
       GROUP BY event.event_type
       ORDER BY event.event_type`,
      [correlationId],
    );
    expect(events.rows).toEqual([
      { event_type: 'check.group_changed', notification_dispatches: '2' },
      { event_type: 'group.deleted', notification_dispatches: '1' },
      { event_type: 'maintenance.cancelled', notification_dispatches: '1' },
    ]);
  });
});
