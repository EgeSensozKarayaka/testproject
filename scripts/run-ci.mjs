import { spawnSync } from 'node:child_process';

const commands = [
  ['pnpm', ['format:check']],
  ['pnpm', ['lint']],
  ['pnpm', ['typecheck']],
  ['pnpm', ['test']],
  ['pnpm', ['build']],
];
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('pnpm must invoke this script');

for (const [, args] of commands) {
  const result = spawnSync(process.execPath, [pnpmCli, ...args], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
