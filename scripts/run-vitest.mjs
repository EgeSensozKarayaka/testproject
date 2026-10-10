import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('pnpm must invoke this script');

function run(args) {
  const result = spawnSync(process.execPath, [pnpmCli, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['-r', '--filter', './packages/*', '--if-present', 'build']);

function integrationTestFiles(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.integration.test.ts'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

const mode = process.argv[2];
const vitestArgs =
  mode === 'integration'
    ? [
        'exec',
        'vitest',
        'run',
        '--passWithNoTests',
        '--no-file-parallelism',
        ...integrationTestFiles('apps'),
        ...integrationTestFiles('packages'),
      ]
    : ['exec', 'vitest', 'run', '--exclude', '**/*.integration.test.ts', '--exclude', 'e2e/**'];

run(vitestArgs);
