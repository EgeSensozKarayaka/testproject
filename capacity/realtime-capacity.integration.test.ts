import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RealtimeHub, type RealtimeTransport } from '../apps/api/src/realtime-hub.js';
import { PostgresRealtimeListener } from '../apps/api/src/realtime-listener.js';
import {
  RealtimeProjectionCoordinator,
  RealtimeProjectionService,
} from '../apps/api/src/realtime-projection.js';
import type { ApiRealtimeRuntimeConfig } from '../packages/config/src/index.js';
import {
  createDatabasePool,
  runMigrations,
  withUserTransaction,
  type Pool,
} from '../packages/database/src/index.js';
import { dropTestDatabase } from '../packages/database/src/testing.js';

const adminConnectionString = process.env.DATABASE_TEST_ADMIN_URL;
const capacityEnabled = process.env.REALTIME_CAPACITY === '1';
const databaseSuite = adminConnectionString && capacityEnabled ? describe : describe.skip;
const profileSizes = [20, 200, 500] as const;

function quotedIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/u.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function databaseUrl(adminUrl: string, databaseName: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

function config(): ApiRealtimeRuntimeConfig {
  return {
    globalConnectionLimit: 20,
    heartbeatMs: 60_000,
    ipConnectionLimit: 20,
    listenerGraceMs: 100,
    ownerConnectionLimit: 20,
    projectionConcurrency: 16,
    projectionQueueLimit: 4_096,
    queueByteLimit: 4 * 1_048_576,
    queueEventLimit: 32,
    sessionConnectionLimit: 10,
    sessionRevalidateBatchSize: 20,
    sessionRevalidateMs: 60_000,
    shutdownGraceMs: 100,
  };
}

function capture(backpressured = false): RealtimeTransport & {
  closed: boolean;
  frames: string[];
} {
  return {
    closed: false,
    end() {
      this.closed = true;
    },
    frames: [],
    onClose: () => undefined,
    onDrain: () => undefined,
    write(frame) {
      this.frames.push(frame);
      return !backpressured;
    },
  };
}

function subscribe(hub: RealtimeHub, ownerId: string, output: RealtimeTransport): string {
  const id = hub.subscribe({
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ipAddress: '127.0.0.1',
    ownerId,
    sessionId: randomUUID(),
    transport: output,
    validateSession: () => Promise.resolve(true),
  });
  hub.start(id);
  return id;
}

databaseSuite('realtime 20/200/500 capacity profile', () => {
  const databaseName = `site_monitor_realtime_capacity_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const listeners: PostgresRealtimeListener[] = [];
  const hubs: RealtimeHub[] = [];
  const queryPools: Pool[] = [];
  const listenerPools: Pool[] = [];
  let adminPool: Pool;
  let setupPool: Pool;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'realtime-capacity-admin',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    const connectionString = databaseUrl(adminConnectionString!, databaseName);
    setupPool = createDatabasePool({
      applicationName: 'realtime-capacity-setup',
      connectionString,
      maxConnections: 4,
    });
    await runMigrations(setupPool, { appBuild: 'realtime-capacity' });

    for (let replica = 0; replica < 2; replica += 1) {
      const queryPool = createDatabasePool({
        applicationName: `realtime-capacity-query-${replica}`,
        connectionString,
        databaseRole: 'site_monitor_api',
        maxConnections: 18,
      });
      const listenerPool = createDatabasePool({
        applicationName: `realtime-capacity-listener-${replica}`,
        connectionString,
        databaseRole: 'site_monitor_api',
        maxConnections: 1,
      });
      queryPools.push(queryPool);
      listenerPools.push(listenerPool);
      const hub = new RealtimeHub(config(), Buffer.alloc(32, replica + 20));
      hubs.push(hub);
      const coordinator = new RealtimeProjectionCoordinator({
        concurrency: 16,
        hub,
        limit: 4_096,
        projector: new RealtimeProjectionService(queryPool),
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
      listener.start();
      listeners.push(listener);
      expect(await listener.waitUntilConnected(5_000)).toBe(true);
    }
  }, 60_000);

  afterAll(async () => {
    await Promise.all(listeners.map(async (listener) => listener.stop()));
    await Promise.all(hubs.map(async (hub) => hub.shutdown()));
    await Promise.all(listenerPools.map(async (pool) => pool.end()));
    await Promise.all(queryPools.map(async (pool) => pool.end()));
    if (setupPool) await setupPool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName);
      await adminPool.end();
    }
  }, 60_000);

  for (const checkCount of profileSizes) {
    it(`broadcasts a ${checkCount}-check burst to two replicas without stalling reads`, async () => {
      const ownerId = randomUUID();
      const checkIds = Array.from({ length: checkCount }, () => randomUUID());
      await setupPool.query(
        `INSERT INTO auth.users
           (id, email_normalized, email_display, display_name, status, email_verified_at)
         VALUES ($1,$2,$2,$3,'ACTIVE',statement_timestamp())`,
        [ownerId, `capacity-${checkCount}@example.test`, `Capacity ${checkCount}`],
      );
      await setupPool.query(
        `INSERT INTO app.checks
           (id, owner_id, name, url, interval_seconds, timeout_ms,
            expected_status_code, next_run_at)
         SELECT id, $1, 'Capacity ' || ordinal, 'https://capacity.example.test/' || ordinal,
                30, 5000, 200, statement_timestamp()
         FROM unnest($2::uuid[]) WITH ORDINALITY AS source(id, ordinal)`,
        [ownerId, checkIds],
      );
      await setupPool.query(
        `INSERT INTO monitoring.check_current_states
           (owner_id, check_id, health_state, freshness_state, fresh_until,
            last_response_time_ms, state_version)
         SELECT $1, id, 'UP', 'FRESH', statement_timestamp() + interval '1 minute', 25, 2
         FROM unnest($2::uuid[]) AS source(id)`,
        [ownerId, checkIds],
      );

      const outputs = [capture(), capture()];
      const connectionIds = hubs.map((hub, replica) => subscribe(hub, ownerId, outputs[replica]!));
      for (const output of outputs) output.frames.length = 0;
      const slow = checkCount === 500 ? capture(true) : undefined;
      const slowConnection = slow ? subscribe(hubs[0]!, ownerId, slow) : undefined;
      if (slow) slow.frames.length = 0;
      const wakeups = checkIds.map((checkId) => ({
        aggregate_id: checkId,
        aggregate_type: 'check_state',
        aggregate_version: '2',
        event_id: randomUUID(),
        event_type: 'check.health_changed',
        occurred_at: new Date().toISOString(),
        owner_id: ownerId,
        v: 1,
      }));

      const readLatencies: number[] = [];
      const startedAt = performance.now();
      await setupPool.query(
        `SELECT pg_notify('site_monitor_realtime_v1', item::text)
         FROM jsonb_array_elements($1::jsonb) AS item`,
        [JSON.stringify(wakeups)],
      );
      const reads = Array.from({ length: 20 }, async () => {
        const started = performance.now();
        await withUserTransaction(queryPools[0]!, ownerId, async (client) => {
          await client.query('SELECT count(*) FROM app.checks WHERE owner_id = $1', [ownerId]);
        });
        readLatencies.push(performance.now() - started);
      });
      await Promise.all(reads);
      await expect
        .poll(() => outputs.every((output) => output.frames.length === checkCount), {
          timeout: 30_000,
        })
        .toBe(true);
      const elapsedMs = performance.now() - startedAt;

      expect(outputs[0]!.frames).toHaveLength(checkCount);
      expect(outputs[1]!.frames).toHaveLength(checkCount);
      expect(percentile(readLatencies, 0.95)).toBeLessThan(2_000);
      if (slow) {
        await expect.poll(() => slow.closed).toBe(true);
        expect(slow.frames.some((frame) => frame.includes('BUFFER_OVERFLOW'))).toBe(true);
      }
      process.stdout.write(
        `REALTIME_CAPACITY ${JSON.stringify({
          apiReadP95Ms: percentile(readLatencies, 0.95),
          checkCount,
          deliveryMs: elapsedMs,
          eventsPerSecond: (checkCount * 2 * 1_000) / elapsedMs,
          replicaCount: 2,
          slowConsumerIsolated: slow?.closed ?? null,
        })}\n`,
      );

      hubs.forEach((hub, replica) => hub.close(connectionIds[replica]!));
      if (slowConnection) hubs[0]!.close(slowConnection);
    }, 45_000);
  }
});
