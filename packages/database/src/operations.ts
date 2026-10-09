import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Pool } from 'pg';

import { runMigrations, type MigrationResult } from './migrations.js';

const RESETTABLE_SCHEMAS = [
  'audit',
  'prediction',
  'public_status',
  'notification',
  'monitoring',
  'app',
  'auth',
  'security_api',
  'infra',
] as const;

function databaseRoot(): string {
  return process.env.DATABASE_ROOT
    ? path.resolve(process.env.DATABASE_ROOT)
    : path.resolve(process.cwd(), 'database');
}

function assertNonProduction(environment: NodeJS.ProcessEnv): void {
  if (environment.NODE_ENV === 'production') {
    throw new Error('Database seed/reset operations are forbidden in production');
  }
}

function assertSafeResetTarget(connectionString: string, environment: NodeJS.ProcessEnv): void {
  assertNonProduction(environment);
  if (environment.ALLOW_DATABASE_RESET !== 'true') {
    throw new Error(
      'Set ALLOW_DATABASE_RESET=true to acknowledge the destructive local/test reset',
    );
  }

  const url = new URL(connectionString);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const safeHost = ['127.0.0.1', 'localhost', 'postgres'].includes(url.hostname);
  const safeDatabase =
    databaseName === 'site_monitor' || /^site_monitor_[a-z0-9_]*test[a-z0-9_]*$/.test(databaseName);
  if (!safeHost || !safeDatabase) {
    throw new Error(
      `Refusing to reset non-local or unexpected database target ${url.hostname}/${databaseName}`,
    );
  }
}

export async function resetDatabase(
  pool: Pool,
  connectionString: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<MigrationResult> {
  assertSafeResetTarget(connectionString, environment);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const schema of RESETTABLE_SCHEMAS) {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return runMigrations(pool);
}

export async function runSeeds(
  pool: Pool,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  assertNonProduction(environment);
  const directory = path.join(databaseRoot(), 'seeds');
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d{6}_[a-z0-9_]+\.sql$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length === 0) throw new Error(`No seed files found in ${directory}`);

  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE site_monitor_schema_owner');
    for (const entry of entries) {
      await client.query(await readFile(path.join(directory, entry.name), 'utf8'));
      applied.push(entry.name);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
