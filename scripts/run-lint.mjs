import { spawnSync } from 'node:child_process';

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('pnpm must invoke this script');

function run(args) {
  const result = spawnSync(process.execPath, [pnpmCli, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Workspace package exports point at dist declarations. Build those declarations
// so type-aware ESLint behaves identically in clean CI and incremental local runs.
run(['-r', '--filter', './packages/*', '--if-present', 'build']);
run(['exec', 'eslint', '.']);
