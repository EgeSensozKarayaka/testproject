import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Pool, PoolClient } from 'pg';

const MIGRATION_FILE_PATTERN = /^(?<version>\d{6})_(?<name>[a-z0-9_]+)\.sql$/;
const TRANSACTION_DIRECTIVE = /^--\s*migrate:transaction\s+(?<value>true|false)\s*$/m;
const MIGRATION_LOCK_NAME = 'site-availability-monitor:migrations:v1';
const SCHEMA_OWNER_ROLE = 'site_monitor_schema_owner';

export const TARGET_SCHEMA_REVISION = 27;

interface MigrationFile {
  checksum: Buffer;
  name: string;
  path: string;
  sql: string;
  transactional: boolean;
  version: number;
}

interface AppliedMigrationRow {
  checksum_sha256: Buffer;
  name: string;
  version: string;
}

export interface MigrationResult {
  applied: number[];
  currentRevision: number;
}

export interface SchemaState {
  compatibilityEpoch: number;
  currentRevision: number;
  minimumAppEpoch: number;
}

function databaseRoot(): string {
  return process.env.DATABASE_ROOT
    ? path.resolve(process.env.DATABASE_ROOT)
    : path.resolve(process.cwd(), 'database');
}

async function loadMigrationFiles(directory = path.join(databaseRoot(), 'migrations')) {
  const entries = await readdir(directory, { withFileTypes: true });
  const migrations: MigrationFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = MIGRATION_FILE_PATTERN.exec(entry.name);
    if (!match?.groups) continue;

    const version = Number.parseInt(match.groups.version ?? '', 10);
    const name = match.groups.name ?? '';
    const filePath = path.join(directory, entry.name);
    const sql = await readFile(filePath, 'utf8');
    const directive = TRANSACTION_DIRECTIVE.exec(sql)?.groups?.value;
    migrations.push({
      checksum: createHash('sha256').update(sql).digest(),
      name,
      path: filePath,
      sql,
      transactional: directive !== 'false',
      version,
    });
  }

  migrations.sort((left, right) => left.version - right.version);
  if (migrations.length === 0) throw new Error(`No migration files found in ${directory}`);

  const seen = new Set<number>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version ${migration.version}`);
    }
    seen.add(migration.version);
  }

  return migrations;
}

async function bootstrapLedger(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS infra;
    CREATE TABLE IF NOT EXISTS infra.schema_migrations (
      version bigint PRIMARY KEY,
      name text NOT NULL,
      checksum_sha256 bytea NOT NULL,
      transactional boolean NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      execution_ms bigint NOT NULL CHECK (execution_ms >= 0),
      app_build text
    );
  `);
}

async function schemaOwnerExists(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
    [SCHEMA_OWNER_ROLE],
  );
  return result.rows[0]?.exists ?? false;
}

async function migrationLedgerExists(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('infra.schema_migrations') IS NOT NULL AS exists`,
  );
  return result.rows[0]?.exists ?? false;
}

async function assumeSchemaOwner(client: PoolClient): Promise<void> {
  await client.query(`SET ROLE ${SCHEMA_OWNER_ROLE}`);
}

async function loadAppliedMigrations(
  client: PoolClient,
): Promise<Map<number, AppliedMigrationRow>> {
  const result = await client.query<AppliedMigrationRow>(`
    SELECT version::text, name, checksum_sha256
    FROM infra.schema_migrations
    ORDER BY version
  `);
  return new Map(result.rows.map((row) => [Number.parseInt(row.version, 10), row]));
}

function validateMigrationHistory(
  files: MigrationFile[],
  applied: Map<number, AppliedMigrationRow>,
): void {
  const fileByVersion = new Map(files.map((migration) => [migration.version, migration]));
  for (const [version, row] of applied) {
    const file = fileByVersion.get(version);
    if (!file) throw new Error(`Applied migration ${version} (${row.name}) is missing from disk`);
    if (file.name !== row.name) {
      throw new Error(`Applied migration ${version} name drift: ${row.name} != ${file.name}`);
    }
    if (!file.checksum.equals(row.checksum_sha256)) {
      throw new Error(`Applied migration ${version} (${row.name}) checksum drift detected`);
    }
  }
}

async function recordMigration(
  client: PoolClient,
  migration: MigrationFile,
  executionMs: number,
  appBuild: string | null,
): Promise<void> {
  await client.query(
    `
      INSERT INTO infra.schema_migrations
        (version, name, checksum_sha256, transactional, execution_ms, app_build)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      migration.version,
      migration.name,
      migration.checksum,
      migration.transactional,
      executionMs,
      appBuild,
    ],
  );
  await client.query(
    `
      UPDATE infra.schema_compatibility
      SET current_revision = $1, updated_at = statement_timestamp()
      WHERE singleton_id = true
    `,
    [migration.version],
  );
}

async function applyMigration(
  client: PoolClient,
  migration: MigrationFile,
  appBuild: string | null,
): Promise<void> {
  const startedAt = performance.now();
  if (migration.transactional) {
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      await client.query(`SET LOCAL statement_timeout = '5min'`);
      await client.query(migration.sql);
      await recordMigration(client, migration, Math.round(performance.now() - startedAt), appBuild);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    return;
  }

  await client.query(`SET lock_timeout = '5s'`);
  await client.query(`SET statement_timeout = '30min'`);
  try {
    await client.query(migration.sql);
    await recordMigration(client, migration, Math.round(performance.now() - startedAt), appBuild);
  } finally {
    await client.query('RESET lock_timeout');
    await client.query('RESET statement_timeout');
  }
}

export async function getSchemaState(pool: Pool): Promise<SchemaState | null> {
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
    const row = result.rows[0];
    if (!row) return null;
    return {
      compatibilityEpoch: Number.parseInt(row.compatibility_epoch, 10),
      currentRevision: Number.parseInt(row.current_revision, 10),
      minimumAppEpoch: Number.parseInt(row.minimum_app_epoch, 10),
    };
  } catch {
    return null;
  }
}

export async function runMigrations(
  pool: Pool,
  options: { appBuild?: string; directory?: string } = {},
): Promise<MigrationResult> {
  const migrations = await loadMigrationFiles(options.directory);
  const client = await pool.connect();
  const appliedNow: number[] = [];

  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_NAME]);
    const ledgerWasPresent = await migrationLedgerExists(client);
    if (!ledgerWasPresent) await bootstrapLedger(client);
    if (ledgerWasPresent && (await schemaOwnerExists(client))) await assumeSchemaOwner(client);

    const applied = await loadAppliedMigrations(client);
    validateMigrationHistory(migrations, applied);

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await applyMigration(
        client,
        migration,
        options.appBuild ?? process.env.SERVICE_VERSION ?? null,
      );
      appliedNow.push(migration.version);
      if (migration.version === 1) await assumeSchemaOwner(client);
    }

    const currentRevision = Math.max(
      0,
      ...migrations
        .filter((item) => applied.has(item.version) || appliedNow.includes(item.version))
        .map((item) => item.version),
    );
    return { applied: appliedNow, currentRevision };
  } finally {
    try {
      await client.query('RESET ROLE');
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_NAME]);
    } finally {
      client.release();
    }
  }
}
