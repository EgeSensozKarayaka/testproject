import { spawnSync } from 'node:child_process';

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('pnpm must invoke this script');

for (const script of ['test:unit', 'test:integration']) {
  const result = spawnSync(process.execPath, [pnpmCli, script], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
