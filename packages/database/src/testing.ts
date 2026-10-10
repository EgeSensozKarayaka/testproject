import { setTimeout as delay } from 'node:timers/promises';

export interface DropTestDatabaseOptions {
  retryDelayMs?: number;
  timeoutMs?: number;
}

export interface TestDatabaseAdminConnection {
  query(statement: string): Promise<unknown>;
}

function quotedIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/u.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/**
 * Drops an isolated integration-test database after its application pools have
 * been ended. node-postgres can resolve Pool.end() just before every client
 * socket has completed its close handshake, so a forced drop can race that
 * handshake and surface PostgreSQL 57P01 as an uncaught pool error.
 */
export async function dropTestDatabase(
  adminPool: TestDatabaseAdminConnection,
  databaseName: string,
  options: DropTestDatabaseOptions = {},
): Promise<void> {
  const retryDelayMs = options.retryDelayMs ?? 25;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  const statement = `DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`;

  while (true) {
    try {
      await adminPool.query(statement);
      return;
    } catch (error) {
      // 55006 (object_in_use) is expected only while a client close handshake
      // is still visible to PostgreSQL. Every other error remains actionable.
      if (postgresErrorCode(error) !== '55006' || Date.now() >= deadline) throw error;
      await delay(retryDelayMs);
    }
  }
}
