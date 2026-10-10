import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { createDatabasePool, type Pool, type PoolClient } from '@site-monitor/database';
import { dropTestDatabase } from '@site-monitor/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RealtimeStore } from './store.js';

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

databaseSuite('realtime relay database boundary', () => {
  const databaseName = `site_monitor_realtime_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerId = randomUUID();
  const aggregateId = randomUUID();
  let adminPool: Pool;
  let databasePool: Pool;
  let realtimePool: Pool;
  let listener: PoolClient;
  let connectionString: string;
  const notifications: string[] = [];

  async function insertDispatch(
    input: {
      eventType?: string;
      schemaVersion?: number;
    } = {},
  ): Promise<string> {
    const eventId = randomUUID();
    await databasePool.query(
      `INSERT INTO infra.outbox_events (
         id, owner_id, event_type, schema_version, aggregate_type, aggregate_id,
         aggregate_version, correlation_id, occurred_at, payload
       ) VALUES ($1,$2,$3,$4,'check_state',$5,19,$6,statement_timestamp(),$7::jsonb)`,
      [
        eventId,
        ownerId,
        input.eventType ?? 'check.health_changed',
        input.schemaVersion ?? 1,
        aggregateId,
        randomUUID(),
        JSON.stringify({ secret_marker: 'must-not-leave-outbox' }),
      ],
    );
    await databasePool.query(
      `INSERT INTO infra.outbox_dispatches (event_id, destination)
       VALUES ($1, 'REALTIME')`,
      [eventId],
    );
    return eventId;
  }

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'realtime-test-admin',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    connectionString = databaseUrl(adminConnectionString!, databaseName);
    databasePool = createDatabasePool({
      applicationName: 'realtime-test-setup',
      connectionString,
      maxConnections: 2,
    });
    const { runMigrations } = await import('@site-monitor/database');
    await runMigrations(databasePool, { appBuild: 'realtime-relay-integration-test' });
    await databasePool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES ($1, 'realtime@example.test', 'realtime@example.test',
               'Realtime Owner', 'ACTIVE', statement_timestamp())`,
      [ownerId],
    );
    realtimePool = createDatabasePool({
      applicationName: 'realtime-test-worker',
      connectionString,
      databaseRole: 'site_monitor_realtime',
      maxConnections: 2,
    });
    listener = await databasePool.connect();
    listener.on('notification', (notification) => {
      if (notification.channel === 'site_monitor_realtime_v1' && notification.payload) {
        notifications.push(notification.payload);
      }
    });
    await listener.query('LISTEN site_monitor_realtime_v1');
  });

  afterAll(async () => {
    if (listener) {
      await listener.query('UNLISTEN *');
      listener.release();
    }
    if (realtimePool) await realtimePool.end();
    if (databasePool) await databasePool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName);
      await adminPool.end();
    }
  });

  it('keeps REALTIME inactive and exposes only the narrow worker boundary', async () => {
    const activation = await databasePool.query<{ active: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM infra.destination_activations WHERE destination = 'REALTIME'
       ) AS active`,
    );
    expect(activation.rows[0]?.active).toBe(false);

    const identity = await realtimePool.query<{ current_user: string }>('SELECT current_user');
    expect(identity.rows[0]?.current_user).toBe('site_monitor_realtime');
    await expect(realtimePool.query('SELECT id FROM infra.outbox_events')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      realtimePool.query(`UPDATE infra.outbox_dispatches SET state = 'DEAD'`),
    ).rejects.toMatchObject({ code: '42501' });

    const store = new RealtimeStore(realtimePool, 'realtime-test:ready', 30);
    await expect(store.storageReady()).resolves.toBe(true);
  });

  it('publishes a redacted wakeup only when completion commits', async () => {
    notifications.length = 0;
    const eventId = await insertDispatch();
    const workerId = 'realtime-test:commit';
    const store = new RealtimeStore(realtimePool, workerId, 30);
    const claim = await store.claimDispatch();
    expect(claim?.eventId).toBe(eventId);

    const transaction = await realtimePool.connect();
    try {
      await transaction.query('BEGIN');
      const rolledBack = await transaction.query<{ completed: boolean }>(
        `SELECT security_api.complete_realtime_dispatch($1,$2,$3,'COMPLETED','PUBLISHED',1)
           AS completed`,
        [claim!.eventId, workerId, claim!.fencingToken],
      );
      expect(rolledBack.rows[0]?.completed).toBe(true);
      await transaction.query('ROLLBACK');
    } finally {
      transaction.release();
    }
    await delay(75);
    expect(notifications).toEqual([]);

    await expect(store.completeDispatch(claim!, 'COMPLETED', 'PUBLISHED', 1)).resolves.toBe(true);
    await expect.poll(() => notifications.length, { timeout: 2_000 }).toBe(1);
    const wakeup = JSON.parse(notifications[0]!) as Record<string, unknown>;
    expect(wakeup).toEqual({
      aggregate_id: aggregateId,
      aggregate_type: 'check_state',
      aggregate_version: '19',
      event_id: eventId,
      event_type: 'check.health_changed',
      occurred_at: expect.any(String),
      owner_id: ownerId,
      v: 1,
    });
    expect(notifications[0]).not.toContain('secret_marker');
    expect(Buffer.byteLength(notifications[0]!, 'utf8')).toBeLessThanOrEqual(1024);
  });

  it('uses fencing for lease recovery and lets only the current worker publish', async () => {
    notifications.length = 0;
    const eventId = await insertDispatch({ eventType: 'group.changed' });
    const staleStore = new RealtimeStore(realtimePool, 'realtime-test:stale', 30);
    const currentStore = new RealtimeStore(realtimePool, 'realtime-test:current', 30);
    const staleClaim = await staleStore.claimDispatch();
    expect(staleClaim?.eventId).toBe(eventId);
    await databasePool.query(
      `UPDATE infra.outbox_dispatches
       SET lease_expires_at = statement_timestamp() - interval '1 second'
       WHERE event_id = $1 AND destination = 'REALTIME'`,
      [eventId],
    );
    const currentClaim = await currentStore.claimDispatch();
    expect(currentClaim?.eventId).toBe(eventId);
    expect(BigInt(currentClaim!.fencingToken)).toBeGreaterThan(BigInt(staleClaim!.fencingToken));

    await expect(
      staleStore.completeDispatch(staleClaim!, 'COMPLETED', 'PUBLISHED', 1),
    ).resolves.toBe(false);
    await expect(
      currentStore.completeDispatch(currentClaim!, 'COMPLETED', 'PUBLISHED', 1),
    ).resolves.toBe(true);
    await expect.poll(() => notifications.length, { timeout: 2_000 }).toBe(1);
  });

  it('persists retry and dead-letter outcomes without broadcasting', async () => {
    notifications.length = 0;
    const eventId = await insertDispatch({ schemaVersion: 2 });
    const store = new RealtimeStore(realtimePool, 'realtime-test:retry', 30);
    const first = await store.claimDispatch();
    expect(first?.eventId).toBe(eventId);
    await expect(store.completeDispatch(first!, 'RETRY', 'TRANSIENT_FAILURE', 1)).resolves.toBe(
      true,
    );

    const retryState = await databasePool.query<{ last_error_code: string; state: string }>(
      `SELECT state, last_error_code FROM infra.outbox_dispatches
       WHERE event_id = $1 AND destination = 'REALTIME'`,
      [eventId],
    );
    expect(retryState.rows[0]).toEqual({
      last_error_code: 'TRANSIENT_FAILURE',
      state: 'RETRY_WAIT',
    });
    await databasePool.query(
      `UPDATE infra.outbox_dispatches SET available_at = statement_timestamp()
       WHERE event_id = $1 AND destination = 'REALTIME'`,
      [eventId],
    );
    const second = await store.claimDispatch();
    await expect(
      store.completeDispatch(second!, 'DEAD', 'UNSUPPORTED_SCHEMA_VERSION', 1),
    ).resolves.toBe(true);

    const deadState = await databasePool.query<{
      completed: boolean;
      last_error_code: string;
      state: string;
    }>(
      `SELECT state, last_error_code, completed_at IS NOT NULL AS completed
       FROM infra.outbox_dispatches
       WHERE event_id = $1 AND destination = 'REALTIME'`,
      [eventId],
    );
    expect(deadState.rows[0]).toEqual({
      completed: true,
      last_error_code: 'UNSUPPORTED_SCHEMA_VERSION',
      state: 'DEAD',
    });
    await delay(75);
    expect(notifications).toEqual([]);
  });
});
