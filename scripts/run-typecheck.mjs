import { spawnSync } from 'node:child_process';

const steps = [
  ['-r', '--filter', './packages/*', '--if-present', 'build'],
  ['-r', '--if-present', 'typecheck'],
];
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('pnpm must invoke this script');

for (const args of steps) {
  const result = spawnSync(process.execPath, [pnpmCli, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
