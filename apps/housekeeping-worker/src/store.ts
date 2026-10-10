import type { Pool } from '@site-monitor/database';

export interface DiscoveryStepResult {
  intervalSources: number;
  rangesEnqueued: number;
  runSources: number;
}

export interface RollupStepResult {
  bucketsProcessed: number;
  rangeCompleted: boolean;
  rangeId: string | null;
}

export interface PartitionStepResult {
  defaultRowCount: number;
  futurePartitionsReady: boolean;
}

export interface RetentionStepResult {
  partitionAction: string;
  rowsPurged: number;
}

interface DiscoveryRow {
  interval_sources: number;
  ranges_enqueued: number;
  run_sources: number;
}

interface RollupRow {
  buckets_processed: number;
  range_completed: boolean;
  range_id: string | null;
}

interface PartitionRow {
  default_row_count: string;
  future_partitions_ready: boolean;
}

interface RetentionRow {
  action: string;
  purged_rows: number;
}

export class HousekeepingStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async discoverSources(batchSize: number): Promise<DiscoveryStepResult> {
    const result = await this.#pool.query<DiscoveryRow>(
      'SELECT * FROM security_api.housekeeping_discover_sources($1)',
      [batchSize],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Housekeeping source discovery returned no result.');
    return {
      intervalSources: row.interval_sources,
      rangesEnqueued: row.ranges_enqueued,
      runSources: row.run_sources,
    };
  }

  async processRollup(
    resolution: 'HOUR' | 'MINUTE',
    bucketLimit: number,
  ): Promise<RollupStepResult> {
    const result = await this.#pool.query<RollupRow>(
      'SELECT * FROM security_api.housekeeping_process_rollup_range($1,$2)',
      [resolution, bucketLimit],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Housekeeping rollup processing returned no result.');
    return {
      bucketsProcessed: row.buckets_processed,
      rangeCompleted: row.range_completed,
      rangeId: row.range_id,
    };
  }

  async ensurePartitions(): Promise<PartitionStepResult> {
    const result = await this.#pool.query<PartitionRow>(
      'SELECT * FROM security_api.housekeeping_partition_step()',
    );
    const row = result.rows[0];
    if (!row) throw new Error('Housekeeping partition step returned no result.');
    return {
      defaultRowCount: Number.parseInt(row.default_row_count, 10),
      futurePartitionsReady: row.future_partitions_ready,
    };
  }

  async retainAndPurge(batchSize: number): Promise<RetentionStepResult> {
    const result = await this.#pool.query<RetentionRow>(
      'SELECT * FROM security_api.housekeeping_retention_step($1)',
      [batchSize],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Housekeeping retention step returned no result.');
    return { partitionAction: row.action, rowsPurged: row.purged_rows };
  }

  async storageReady(): Promise<boolean> {
    try {
      const result = await this.#pool.query<{ ready: boolean }>(
        'SELECT security_api.housekeeping_storage_ready() AS ready',
      );
      return result.rows[0]?.ready === true;
    } catch {
      return false;
    }
  }
}
