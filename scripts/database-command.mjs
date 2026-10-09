import { spawnSync } from 'node:child_process';

const command = process.argv[2] ?? 'unknown';
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'packages/database/src/cli.ts', command],
  { stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
