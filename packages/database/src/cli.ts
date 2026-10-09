import { createDatabasePool } from './index.js';
import { getSchemaState, runMigrations } from './migrations.js';
import { resetDatabase, runSeeds } from './operations.js';

function localConnectionString(environment: NodeJS.ProcessEnv): string {
  if (environment.DATABASE_URL) return environment.DATABASE_URL;
  const user = environment.POSTGRES_USER ?? 'site_monitor';
  const password = environment.POSTGRES_PASSWORD ?? 'local_dev_only_change_me';
  const host = environment.POSTGRES_HOST ?? '127.0.0.1';
  const port = environment.POSTGRES_PORT ?? '15432';
  const database = environment.POSTGRES_DB ?? 'site_monitor';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || !['migrate', 'reset', 'seed', 'status'].includes(command)) {
    throw new Error('Usage: database-command <migrate|reset|seed|status>');
  }

  const connectionString = localConnectionString(process.env);
  const pool = createDatabasePool({
    applicationName: `database-${command}`,
    connectionString,
    maxConnections: 1,
  });

  try {
    if (command === 'migrate') {
      const result = await runMigrations(pool);
      process.stdout.write(
        `Database revision ${result.currentRevision}; applied ${result.applied.length === 0 ? 'none' : result.applied.join(', ')}.\n`,
      );
      return;
    }
    if (command === 'seed') {
      const files = await runSeeds(pool);
      process.stdout.write(`Applied ${files.length} idempotent seed file(s).\n`);
      return;
    }
    if (command === 'reset') {
      const result = await resetDatabase(pool, connectionString);
      process.stdout.write(`Database reset and migrated to revision ${result.currentRevision}.\n`);
      return;
    }

    const state = await getSchemaState(pool);
    process.stdout.write(`${JSON.stringify(state)}\n`);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown database command failure';
  process.stderr.write(`Database command failed: ${message}\n`);
  process.exitCode = 1;
}
