import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';

import { TARGET_SCHEMA_REVISION } from './migrations.js';
import type { DatabaseSchema } from './schema.js';

export {
  getSchemaState,
  runMigrations,
  type MigrationResult,
  type SchemaState,
} from './migrations.js';
export { TARGET_SCHEMA_REVISION } from './migrations.js';
export type { Pool, PoolClient } from 'pg';
export { resetDatabase, runSeeds } from './operations.js';
export {
  type ActivatedOutboxEventInput,
  type ActivatedOutboxEventResult,
  type OutboxDestination,
  writeActivatedOutboxEvent,
} from './outbox.js';
export type * from './schema.js';

export interface DatabasePoolOptions {
  applicationName: string;
  connectionString: string;
  databaseRole?:
    | 'site_monitor_api'
    | 'site_monitor_monitor'
    | 'site_monitor_notifier'
    | 'site_monitor_predictor'
    | 'site_monitor_public'
    | 'site_monitor_housekeeper'
    | 'site_monitor_realtime';
  maxConnections?: number;
}

export interface DatabaseReadinessOptions {
  applicationCompatibilityEpoch?: number;
  minimumRevision?: number;
}

export function createDatabasePool(options: DatabasePoolOptions): Pool {
  const config: PoolConfig = {
    application_name: options.applicationName,
    connectionString: options.connectionString,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
    max: options.maxConnections ?? 4,
    ...(options.databaseRole ? { options: `-c role=${options.databaseRole}` } : {}),
  };
  return new Pool(config);
}

export function createQueryDatabase(pool: Pool): Kysely<DatabaseSchema> {
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({ pool }),
  });
}

export async function isDatabaseReady(
  pool: Pool,
  options: DatabaseReadinessOptions = {},
): Promise<boolean> {
  try {
    const result = await pool.query<{
      compatibility_epoch: string;
      current_revision: string;
      minimum_app_epoch: string;
    }>(`
      SELECT
        compatibility_epoch::text,
        current_revision::text,
        minimum_app_epoch::text
      FROM infra.schema_compatibility
      WHERE singleton_id = true
    `);
    const state = result.rows[0];
    if (!state) return false;

    const applicationEpoch = BigInt(options.applicationCompatibilityEpoch ?? 1);
    return (
      BigInt(state.current_revision) >= BigInt(options.minimumRevision ?? TARGET_SCHEMA_REVISION) &&
      BigInt(state.compatibility_epoch) === applicationEpoch &&
      BigInt(state.minimum_app_epoch) <= applicationEpoch
    );
  } catch {
    return false;
  }
}

export async function withUserTransaction<T>(
  pool: Pool,
  ownerId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [ownerId]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
