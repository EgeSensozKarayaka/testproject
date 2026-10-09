import { Pool, type PoolConfig } from 'pg';

export interface DatabasePoolOptions {
  applicationName: string;
  connectionString: string;
  maxConnections?: number;
}

export function createDatabasePool(options: DatabasePoolOptions): Pool {
  const config: PoolConfig = {
    application_name: options.applicationName,
    connectionString: options.connectionString,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
    max: options.maxConnections ?? 4,
  };
  return new Pool(config);
}

export async function isDatabaseReady(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
