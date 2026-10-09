import { spawnSync } from 'node:child_process';

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('pnpm must invoke this script');

function run(args) {
  const result = spawnSync(process.execPath, [pnpmCli, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['-r', '--filter', './packages/*', '--if-present', 'build']);

const mode = process.argv[2];
const vitestArgs =
  mode === 'integration'
    ? ['exec', 'vitest', 'run', '--passWithNoTests', '**/*.integration.test.ts']
    : ['exec', 'vitest', 'run', '--exclude', '**/*.integration.test.ts', '--exclude', 'e2e/**'];

run(vitestArgs);
