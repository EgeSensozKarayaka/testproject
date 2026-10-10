import { randomUUID } from 'node:crypto';

import type { ApiRealtimeRuntimeConfig } from '@site-monitor/config';
import type { InternalRealtimeWakeup } from '@site-monitor/contracts';
import { createDatabasePool, type Pool } from '@site-monitor/database';
import { dropTestDatabase } from '@site-monitor/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RealtimeHub, type RealtimeTransport } from './realtime-hub.js';
import { PostgresRealtimeListener } from './realtime-listener.js';
import { RealtimeProjectionCoordinator, RealtimeProjectionService } from './realtime-projection.js';

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

function config(): ApiRealtimeRuntimeConfig {
  return {
    globalConnectionLimit: 20,
    heartbeatMs: 60_000,
    ipConnectionLimit: 20,
    listenerGraceMs: 100,
    ownerConnectionLimit: 20,
    projectionConcurrency: 4,
    projectionQueueLimit: 100,
    queueByteLimit: 65_536,
    queueEventLimit: 32,
    sessionConnectionLimit: 10,
    sessionRevalidateBatchSize: 10,
    sessionRevalidateMs: 60_000,
    shutdownGraceMs: 100,
  };
}

function capture(): RealtimeTransport & { frames: string[] } {
  return {
    end: () => undefined,
    frames: [],
    onClose: () => undefined,
    onDrain: () => undefined,
    write(frame) {
      this.frames.push(frame);
      return true;
    },
  };
}

function subscribe(hub: RealtimeHub, ownerId: string, output: RealtimeTransport): void {
  const id = hub.subscribe({
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ipAddress: '127.0.0.1',
    ownerId,
    sessionId: randomUUID(),
    transport: output,
    validateSession: () => Promise.resolve(true),
  });
  hub.start(id);
}

databaseSuite('realtime API replica broadcast and owner isolation', () => {
  const databaseName = `site_monitor_realtime_api_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const checkA = randomUUID();
  const listeners: PostgresRealtimeListener[] = [];
  const hubs: RealtimeHub[] = [];
  const pools: Pool[] = [];
  let adminPool: Pool;
  let setupPool: Pool;
  let connectionString: string;
  let firstProjector: RealtimeProjectionService;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'realtime-api-admin',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    connectionString = databaseUrl(adminConnectionString!, databaseName);
    setupPool = createDatabasePool({
      applicationName: 'realtime-api-setup',
      connectionString,
      maxConnections: 2,
    });
    const { runMigrations } = await import('@site-monitor/database');
    await runMigrations(setupPool, { appBuild: 'realtime-api-integration-test' });
    await setupPool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES ($1, 'owner-a@example.test', 'owner-a@example.test', 'Owner A', 'ACTIVE', statement_timestamp()),
              ($2, 'owner-b@example.test', 'owner-b@example.test', 'Owner B', 'ACTIVE', statement_timestamp())`,
      [ownerA, ownerB],
    );
    await setupPool.query(
      `INSERT INTO app.checks
         (id, owner_id, name, url, interval_seconds, timeout_ms,
          expected_status_code, next_run_at)
       VALUES ($1,$2,'Realtime Check','https://realtime.example.test/',30,5000,200,
               statement_timestamp())`,
      [checkA, ownerA],
    );
    await setupPool.query(
      `INSERT INTO monitoring.check_current_states
         (owner_id, check_id, health_state, freshness_state, fresh_until,
          last_response_time_ms, state_version)
       VALUES ($1,$2,'DOWN','FRESH',statement_timestamp() + interval '1 minute',321,7)`,
      [ownerA, checkA],
    );
  });

  afterAll(async () => {
    await Promise.all(listeners.map(async (listener) => listener.stop()));
    await Promise.all(hubs.map(async (hub) => hub.shutdown()));
    await Promise.all(pools.map(async (pool) => pool.end()));
    if (setupPool) await setupPool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName);
      await adminPool.end();
    }
  });

  it('broadcasts through two dedicated listeners without leaking to another owner', async () => {
    const outputsA = [capture(), capture()];
    const outputB = capture();
    for (let replica = 0; replica < 2; replica += 1) {
      const queryPool = createDatabasePool({
        applicationName: `realtime-api-query-${replica}`,
        connectionString,
        databaseRole: 'site_monitor_api',
        maxConnections: 2,
      });
      const listenerPool = createDatabasePool({
        applicationName: `realtime-api-listener-${replica}`,
        connectionString,
        databaseRole: 'site_monitor_api',
        maxConnections: 1,
      });
      pools.push(queryPool, listenerPool);
      const hub = new RealtimeHub(config(), Buffer.alloc(32, replica + 1));
      hubs.push(hub);
      subscribe(hub, ownerA, outputsA[replica]!);
      if (replica === 0) subscribe(hub, ownerB, outputB);
      const projector = new RealtimeProjectionService(queryPool);
      if (replica === 0) firstProjector = projector;
      const coordinator = new RealtimeProjectionCoordinator({
        concurrency: 2,
        hub,
        limit: 20,
        projector,
      });
      const listener = new PostgresRealtimeListener({
        graceMs: 100,
        onInvalidPayload: () => hub.resyncAll('PROJECTION_INVALIDATED'),
        onRestart: () => hub.resyncAll('SUBSCRIBER_RESTARTED'),
        onWakeup: (wakeup) => {
          if (hub.hasOwner(wakeup.owner_id)) coordinator.enqueue(wakeup);
        },
        pool: listenerPool,
      });
      listeners.push(listener);
      listener.start();
      await expect.poll(() => listener.ready, { timeout: 5_000 }).toBe(true);
    }
    for (const output of [...outputsA, outputB]) output.frames.length = 0;

    const wakeup: InternalRealtimeWakeup = {
      aggregate_id: checkA,
      aggregate_type: 'check_state',
      aggregate_version: '7',
      event_id: randomUUID(),
      event_type: 'check.health_changed',
      occurred_at: new Date().toISOString(),
      owner_id: ownerA,
      v: 1,
    };
    const directProjection = await firstProjector.project(wakeup);
    expect(directProjection?.event_type).toBe('check.status_changed');
    await expect(
      firstProjector.project({ ...wakeup, event_id: randomUUID(), owner_id: ownerB }),
    ).resolves.toBeUndefined();
    await setupPool.query(`SELECT pg_notify('site_monitor_realtime_v1', $1)`, [
      JSON.stringify(wakeup),
    ]);

    await expect.poll(() => outputsA.every((output) => output.frames.length === 1)).toBe(true);
    expect(outputsA[0]!.frames[0]).toContain('event: check.status_changed');
    expect(outputsA[0]!.frames[0]).toContain('"health_state":"DOWN"');
    expect(outputsA[1]!.frames[0]).toContain('"last_response_time_ms":321');
    expect(outputB.frames).toEqual([]);
    expect(outputsA.map((output) => output.frames[0])).toHaveLength(2);

    await setupPool.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE application_name = 'realtime-api-listener-0'
         AND datname = current_database()`,
    );
    await expect
      .poll(() => outputsA[0]!.frames.some((frame) => frame.includes('SUBSCRIBER_RESTARTED')))
      .toBe(true);
    await expect.poll(async () => listeners[0]!.waitUntilConnected(100)).toBe(true);

    outputsA[0]!.frames.length = 0;
    const afterReconnect = { ...wakeup, event_id: randomUUID() };
    await setupPool.query(`SELECT pg_notify('site_monitor_realtime_v1', $1)`, [
      JSON.stringify(afterReconnect),
    ]);
    await expect.poll(() => outputsA[0]!.frames.length).toBe(1);
    expect(outputsA[0]!.frames[0]).toContain('event: check.status_changed');
  });
});
