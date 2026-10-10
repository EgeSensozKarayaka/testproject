import { createHash, randomUUID } from 'node:crypto';
import { cpus, freemem, platform, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HistoryService } from '../apps/api/src/history-service.js';
import { HousekeepingStore } from '../apps/housekeeping-worker/src/store.js';
import { createDatabasePool, runMigrations, type Pool } from '../packages/database/src/index.js';
import { dropTestDatabase } from '../packages/database/src/testing.js';

const adminConnectionString = process.env.DATABASE_TEST_ADMIN_URL;
const capacityEnabled = process.env.HISTORY_CAPACITY === '1';
const databaseSuite = adminConnectionString && capacityEnabled ? describe : describe.skip;
const profileSizes = [20, 200, 500] as const;
const hourMs = 60 * 60 * 1_000;

interface RollupCapacityMeasurement {
  checkCount: number;
  discoveryMs: number;
  fixtureMs: number;
  hourBucketsProcessed: number;
  hourProjectionMs: number;
  minuteBucketsProcessed: number;
  minuteProjectionMs: number;
  projectionChecksPerSecond: number;
  rangesEnqueued: number;
  sourceRows: number;
  totalMs: number;
}

interface HistoryCapacityMeasurement {
  bucketCount: number;
  datasetRows: number;
  equivalentRawSamples: number;
  executionPlanMs: number;
  historyQueryMs: number;
  indexScanUsed: boolean;
  partitionCount: number;
  seedMs: number;
}

interface HistoryIsolationMeasurement {
  apiPoolLimit: number;
  baselineP95Ms: number;
  housekeeperBucketsProcessed: number;
  housekeeperPoolLimit: number;
  loadedMaxMs: number;
  loadedP95Ms: number;
  sampleCount: number;
}

interface ExplainSummary {
  executionTimeMs: number;
  indexScanUsed: boolean;
  relationNames: string[];
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

function profileOwnerId(count: number): string {
  return `10000000-0000-4000-8000-${count.toString(16).padStart(12, '0')}`;
}

function profileGroupId(count: number): string {
  return `20000000-0000-4000-8000-${count.toString(16).padStart(12, '0')}`;
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]!;
}

function inspectExplainValue(value: unknown, summary: ExplainSummary): void {
  if (Array.isArray(value)) {
    for (const item of value) inspectExplainValue(item, summary);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  if (typeof record['Execution Time'] === 'number') {
    summary.executionTimeMs = record['Execution Time'];
  }
  if (typeof record['Relation Name'] === 'string') {
    summary.relationNames.push(record['Relation Name']);
  }
  if (
    typeof record['Node Type'] === 'string' &&
    (record['Node Type'].includes('Index') || record['Node Type'] === 'Bitmap Heap Scan')
  ) {
    summary.indexScanUsed = true;
  }
  for (const child of Object.values(record)) inspectExplainValue(child, summary);
}

async function drainRollups(
  store: HousekeepingStore,
  resolution: 'HOUR' | 'MINUTE',
  bucketLimit: number,
): Promise<{ buckets: number; ranges: number }> {
  let buckets = 0;
  let ranges = 0;
  while (true) {
    const step = await store.processRollup(resolution, bucketLimit);
    if (step.rangeId === null) return { buckets, ranges };
    buckets += step.bucketsProcessed;
    ranges += step.rangeCompleted ? 1 : 0;
    if (ranges > 20_000) throw new Error(`Runaway ${resolution} rollup drain.`);
  }
}

databaseSuite('history and housekeeping capacity profile', () => {
  const databaseName = `site_monitor_history_capacity_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const securityKey = Buffer.alloc(32, 83);
  let adminPool: Pool;
  let apiPool: Pool;
  let connectionString: string;
  let historyService: HistoryService;
  let housekeeperPool: Pool;
  let housekeeperStore: HousekeepingStore;
  let schemaPool: Pool;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'history-capacity-admin',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    connectionString = databaseUrl(adminConnectionString!, databaseName);
    schemaPool = createDatabasePool({
      applicationName: 'history-capacity-schema',
      connectionString,
      maxConnections: 4,
    });
    await runMigrations(schemaPool, { appBuild: 'history-capacity-profile' });
    await schemaPool.query(
      `CREATE TABLE public.history_capacity_fixture (
         profile_size integer NOT NULL,
         ordinal integer NOT NULL,
         owner_id uuid NOT NULL,
         check_id uuid NOT NULL,
         job_id uuid NOT NULL,
         attempt_id uuid NOT NULL,
         run_id uuid NOT NULL,
         PRIMARY KEY (profile_size, ordinal)
       )`,
    );
    housekeeperPool = createDatabasePool({
      applicationName: 'history-capacity-housekeeper',
      connectionString,
      databaseRole: 'site_monitor_housekeeper',
      maxConnections: 2,
    });
    housekeeperStore = new HousekeepingStore(housekeeperPool);
    apiPool = createDatabasePool({
      applicationName: 'history-capacity-api',
      connectionString,
      databaseRole: 'site_monitor_api',
      maxConnections: 4,
    });
    historyService = new HistoryService(apiPool, {
      securityKey,
      statementTimeoutMs: 2_000,
    });
  }, 60_000);

  afterAll(async () => {
    if (apiPool) await apiPool.end();
    if (housekeeperPool) await housekeeperPool.end();
    if (schemaPool) await schemaPool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName, { timeoutMs: 15_000 });
      await adminPool.end();
    }
  }, 30_000);

  async function insertProfileFixture(count: number): Promise<void> {
    const ownerId = profileOwnerId(count);
    const groupId = profileGroupId(count);
    const finishedAt = new Date(Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000 + 30_000);
    await schemaPool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES ($1, $2, $2, $3, 'ACTIVE', statement_timestamp())`,
      [ownerId, `history-capacity-${count}@example.test`, `History Capacity ${count}`],
    );
    await schemaPool.query(`INSERT INTO app.check_groups (id, owner_id, name) VALUES ($1,$2,$3)`, [
      groupId,
      ownerId,
      `History Capacity ${count}`,
    ]);
    await schemaPool.query(
      `INSERT INTO public.history_capacity_fixture
         (profile_size, ordinal, owner_id, check_id, job_id, attempt_id, run_id)
       SELECT $1, ordinal, $2, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
       FROM generate_series(1, $1::integer) AS ordinal`,
      [count, ownerId],
    );
    await schemaPool.query(
      `INSERT INTO app.checks
         (id, owner_id, group_id, name, url, interval_seconds, timeout_ms,
          expected_status_code, next_run_at)
       SELECT check_id, owner_id, $2, format('History Capacity %s / %s', $1::integer, ordinal),
              format('https://history-capacity-%s-%s.example.test/', $1::integer, ordinal),
              30, 5000, 200, statement_timestamp()
       FROM public.history_capacity_fixture
       WHERE profile_size = $1`,
      [count, groupId],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.check_jobs
         (id, owner_id, check_id, trigger_kind, scheduled_for, state,
          config_snapshot, resource_version, probe_generation,
          schedule_generation, attempt_count, completed_at, terminal_reason,
          created_at, updated_at)
       SELECT job_id, owner_id, check_id, 'SCHEDULED', $2, 'COMPLETED',
              '{}'::jsonb, 1, 1, 1, 1, $3, 'RESULT_RECORDED', $2, $3
       FROM public.history_capacity_fixture
       WHERE profile_size = $1`,
      [count, new Date(finishedAt.getTime() - 10_000), finishedAt],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.check_job_attempts
         (id, owner_id, check_id, job_id, attempt_number, worker_id,
          fencing_token, lease_acquired_at, started_at, ended_at, terminal_reason)
       SELECT attempt_id, owner_id, check_id, job_id, 1, 'history-capacity-worker',
              1, $2, $3, $4, 'RESULT_RECORDED'
       FROM public.history_capacity_fixture
       WHERE profile_size = $1`,
      [
        count,
        new Date(finishedAt.getTime() - 9_000),
        new Date(finishedAt.getTime() - 8_000),
        finishedAt,
      ],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.check_runs
         (finished_at, id, owner_id, check_id, job_id, attempt_id, trigger_kind,
          resource_version, probe_generation, schedule_generation, fencing_token,
          scheduled_for, started_at, total_ms, status_code, body_match,
          outcome, accepted_for_state)
       SELECT $2, run_id, owner_id, check_id, job_id, attempt_id, 'SCHEDULED',
              1, 1, 1, 1, $3, $4, 100 + (ordinal % 20), 200, true, 'PASS', true
       FROM public.history_capacity_fixture
       WHERE profile_size = $1`,
      [
        count,
        finishedAt,
        new Date(finishedAt.getTime() - 10_000),
        new Date(finishedAt.getTime() - 8_000),
      ],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.health_intervals
         (started_at, id, owner_id, check_id, ended_at,
          classification, probe_generation, source_kind)
       SELECT date_trunc('minute', $2::timestamptz), gen_random_uuid(), owner_id, check_id,
              date_trunc('minute', $2::timestamptz) + interval '1 minute',
              'UP', 1, 'STARTUP'
       FROM public.history_capacity_fixture
       WHERE profile_size = $1`,
      [count, finishedAt],
    );
  }

  it('profiles source discovery and minute-to-hour rollups for 20/200/500 checks', async () => {
    for (const count of profileSizes) {
      const fixtureStartedAt = performance.now();
      await insertProfileFixture(count);
      const fixtureMs = performance.now() - fixtureStartedAt;

      const discoveryStartedAt = performance.now();
      const discovery = await housekeeperStore.discoverSources(5_000);
      const discoveryMs = performance.now() - discoveryStartedAt;

      const minuteStartedAt = performance.now();
      const minute = await drainRollups(housekeeperStore, 'MINUTE', 60);
      const minuteProjectionMs = performance.now() - minuteStartedAt;
      const hourStartedAt = performance.now();
      const hour = await drainRollups(housekeeperStore, 'HOUR', 60);
      const hourProjectionMs = performance.now() - hourStartedAt;
      const totalMs = discoveryMs + minuteProjectionMs + hourProjectionMs;
      const measurement: RollupCapacityMeasurement = {
        checkCount: count,
        discoveryMs,
        fixtureMs,
        hourBucketsProcessed: hour.buckets,
        hourProjectionMs,
        minuteBucketsProcessed: minute.buckets,
        minuteProjectionMs,
        projectionChecksPerSecond: count / (totalMs / 1_000),
        rangesEnqueued: discovery.rangesEnqueued,
        sourceRows: discovery.runSources + discovery.intervalSources,
        totalMs,
      };

      expect(discovery.runSources).toBe(count);
      expect(discovery.intervalSources).toBe(count);
      expect(discovery.rangesEnqueued).toBe(count * 2);
      expect(minute.buckets).toBe(count * 2);
      expect(hour.buckets).toBe(count * 2);
      expect(totalMs).toBeLessThan(120_000);
      expect(measurement.projectionChecksPerSecond).toBeGreaterThan(1);
      expect(housekeeperPool.totalCount).toBeLessThanOrEqual(2);

      const persisted = await schemaPool.query<{ hour_count: string; minute_count: string }>(
        `SELECT
           (SELECT count(*)::text FROM monitoring.rollups_minute WHERE owner_id = $1) AS minute_count,
           (SELECT count(*)::text FROM monitoring.rollups_hour WHERE owner_id = $1) AS hour_count`,
        [profileOwnerId(count)],
      );
      expect(persisted.rows[0]).toEqual({ hour_count: String(count), minute_count: String(count) });
      process.stdout.write(`HISTORY_ROLLUP_CAPACITY ${JSON.stringify(measurement)}\n`);
    }
  }, 180_000);

  it('serves a month from a 500-check, 35-day equivalent dataset with a pruned index plan', async () => {
    const ownerId = profileOwnerId(500);
    const target = await schemaPool.query<{ check_id: string }>(
      `SELECT check_id FROM public.history_capacity_fixture
       WHERE profile_size = 500 ORDER BY ordinal LIMIT 1`,
    );
    const checkId = target.rows[0]!.check_id;
    const toMs = Math.floor(Date.now() / hourMs) * hourMs;
    const datasetFrom = new Date(toMs - 35 * 24 * hourMs);
    const datasetTo = new Date(toMs);
    const seedStartedAt = performance.now();
    await schemaPool.query(
      `SELECT infra.ensure_year_partition(
         'monitoring.rollups_hour'::regclass, 'monitoring', 'rollups_hour', year_value
       )
       FROM generate_series(
         extract(year FROM $1::timestamptz)::integer,
         extract(year FROM $2::timestamptz)::integer
       ) AS year_value`,
      [datasetFrom, new Date(datasetTo.getTime() - 1)],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.rollups_hour (
         bucket_start, owner_id, check_id, probe_generation,
         accepted_run_count, pass_count, fail_count, response_sample_count,
         response_sum_ms, response_min_ms, response_max_ms,
         up_ms, down_ms, unknown_ms, provisional_ms, computed_through
       )
       SELECT bucket_start, fixture.owner_id, fixture.check_id, 1,
              120, 118, 2, 120, 14400, 100, 140,
              3540000, 60000, 0, 0, statement_timestamp()
       FROM public.history_capacity_fixture AS fixture
       CROSS JOIN generate_series(
         $1::timestamptz,
         $2::timestamptz - interval '1 hour',
         interval '1 hour'
       ) AS bucket_start
       WHERE fixture.profile_size = 500
       ON CONFLICT (owner_id, check_id, bucket_start, probe_generation)
       DO UPDATE SET
         accepted_run_count = EXCLUDED.accepted_run_count,
         pass_count = EXCLUDED.pass_count,
         fail_count = EXCLUDED.fail_count,
         response_sample_count = EXCLUDED.response_sample_count,
         response_sum_ms = EXCLUDED.response_sum_ms,
         response_min_ms = EXCLUDED.response_min_ms,
         response_max_ms = EXCLUDED.response_max_ms,
         up_ms = EXCLUDED.up_ms,
         down_ms = EXCLUDED.down_ms,
         unknown_ms = EXCLUDED.unknown_ms,
         provisional_ms = EXCLUDED.provisional_ms,
         computed_through = EXCLUDED.computed_through,
         revision = monitoring.rollups_hour.revision + 1,
         updated_at = statement_timestamp()`,
      [datasetFrom, datasetTo],
    );
    await schemaPool.query('ANALYZE monitoring.rollups_hour');
    const seedMs = performance.now() - seedStartedAt;

    const explainClient = await apiPool.connect();
    let explainPayload: unknown;
    try {
      await explainClient.query('BEGIN READ ONLY');
      await explainClient.query(`SELECT set_config('app.current_user_id', $1, true)`, [ownerId]);
      const explained = await explainClient.query<{ 'QUERY PLAN': unknown }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
         SELECT
           floor(extract(epoch FROM (bucket_start - $3::timestamptz)) / $5)::integer AS bucket_index,
           sum(up_ms)::text AS up_ms,
           sum(down_ms)::text AS down_ms,
           sum(response_sample_count)::text AS response_sample_count,
           sum(response_sum_ms)::text AS response_sum_ms,
           min(response_min_ms) AS response_min_ms,
           max(response_max_ms) AS response_max_ms
         FROM monitoring.rollups_hour
         WHERE owner_id = $1 AND check_id = $2
           AND bucket_start >= $3 AND bucket_start < $4
         GROUP BY bucket_index
         ORDER BY bucket_index`,
        [ownerId, checkId, new Date(toMs - 30 * 24 * hourMs), new Date(toMs - 2 * hourMs), 7_200],
      );
      explainPayload = explained.rows[0]?.['QUERY PLAN'];
      await explainClient.query('COMMIT');
    } catch (error) {
      await explainClient.query('ROLLBACK');
      throw error;
    } finally {
      explainClient.release();
    }
    const explainSummary: ExplainSummary = {
      executionTimeMs: 0,
      indexScanUsed: false,
      relationNames: [],
    };
    inspectExplainValue(explainPayload, explainSummary);
    const partitionNames = [...new Set(explainSummary.relationNames)];

    const historyStartedAt = performance.now();
    const history = await historyService.getHistory(ownerId, checkId, 'month');
    const historyQueryMs = performance.now() - historyStartedAt;
    const datasetRows = 500 * 35 * 24;
    const measurement: HistoryCapacityMeasurement = {
      bucketCount: history.buckets.length,
      datasetRows,
      equivalentRawSamples: datasetRows * 120,
      executionPlanMs: explainSummary.executionTimeMs,
      historyQueryMs,
      indexScanUsed: explainSummary.indexScanUsed,
      partitionCount: partitionNames.length,
      seedMs,
    };

    expect(history.buckets).toHaveLength(360);
    expect(historyQueryMs).toBeLessThan(2_000);
    expect(explainSummary.executionTimeMs).toBeLessThan(2_000);
    expect(explainSummary.indexScanUsed).toBe(true);
    expect(partitionNames.length).toBeGreaterThan(0);
    expect(partitionNames.length).toBeLessThanOrEqual(2);
    expect(partitionNames.every((name) => /^rollups_hour_\d{4}$/u.test(name))).toBe(true);
    expect(partitionNames.some((name) => name.endsWith('_default'))).toBe(false);
    expect(history.buckets.reduce((sum, bucket) => sum + bucket.sample_count, 0)).toBeGreaterThan(
      80_000,
    );
    process.stdout.write(
      `HISTORY_MONTH_CAPACITY ${JSON.stringify({ ...measurement, partitions: partitionNames })}\n`,
    );
  }, 180_000);

  it('keeps private month history bounded while a separate housekeeper pool rebuilds ranges', async () => {
    const ownerId = profileOwnerId(500);
    const target = await schemaPool.query<{ check_id: string }>(
      `SELECT check_id FROM public.history_capacity_fixture
       WHERE profile_size = 500 ORDER BY ordinal LIMIT 1`,
    );
    const checkId = target.rows[0]!.check_id;
    const baseline: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      const startedAt = performance.now();
      await historyService.getHistory(ownerId, checkId, 'month');
      baseline.push(performance.now() - startedAt);
    }

    await schemaPool.query(
      `INSERT INTO monitoring.rollup_rebuild_ranges (
         owner_id, check_id, resolution, range_start, range_end,
         next_bucket_start, reason, source_fingerprint
       )
       SELECT fixture.owner_id, fixture.check_id, 'MINUTE', range_start,
              range_start + interval '60 minutes', range_start, 'REPAIR',
              sha256(convert_to('history-capacity-load:' || fixture.check_id::text, 'UTF8'))
       FROM (
         SELECT date_trunc('minute', statement_timestamp()) - interval '3 days' AS range_start
       ) AS clock
       CROSS JOIN LATERAL (
         SELECT owner_id, check_id
         FROM public.history_capacity_fixture
         WHERE profile_size = 200
         ORDER BY ordinal
         LIMIT 64
       ) AS fixture`,
    );

    const loaded: number[] = [];
    const loadPromise = drainRollups(housekeeperStore, 'MINUTE', 60);
    const samplePromise = (async () => {
      for (let index = 0; index < 40; index += 1) {
        const startedAt = performance.now();
        const history = await historyService.getHistory(ownerId, checkId, 'month');
        loaded.push(performance.now() - startedAt);
        expect(history.buckets).toHaveLength(360);
      }
    })();
    const [load] = await Promise.all([loadPromise, samplePromise]);
    const measurement: HistoryIsolationMeasurement = {
      apiPoolLimit: 4,
      baselineP95Ms: percentile(baseline, 0.95),
      housekeeperBucketsProcessed: load.buckets,
      housekeeperPoolLimit: 2,
      loadedMaxMs: Math.max(...loaded),
      loadedP95Ms: percentile(loaded, 0.95),
      sampleCount: loaded.length,
    };

    expect(load.buckets).toBe(64 * 60);
    expect(loaded).toHaveLength(40);
    expect(measurement.loadedP95Ms).toBeLessThan(1_500);
    expect(measurement.loadedMaxMs).toBeLessThan(3_000);
    expect(apiPool.totalCount).toBeLessThanOrEqual(4);
    expect(housekeeperPool.totalCount).toBeLessThanOrEqual(2);
    process.stdout.write(`HISTORY_API_ISOLATION ${JSON.stringify(measurement)}\n`);
  }, 180_000);

  it('prints the reproducible host fingerprint without treating it as a production SLO', () => {
    const host = {
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpu: cpus().length,
      node: process.version,
      platform: `${platform()} ${release()}`,
      reportFingerprint: createHash('sha256')
        .update(`${platform()}|${release()}|${cpus()[0]?.model ?? 'unknown'}|${totalmem()}`)
        .digest('hex')
        .slice(0, 16),
      totalMemoryGiB: totalmem() / 1024 / 1024 / 1024,
      freeMemoryGiBAtReport: freemem() / 1024 / 1024 / 1024,
    };
    process.stdout.write(`HISTORY_CAPACITY_HOST ${JSON.stringify(host)}\n`);
    expect(host.logicalCpu).toBeGreaterThan(0);
  });
});
