import { readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const roots = ['apps', 'packages'];
for (const root of roots) {
  const directory = resolve(root);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await rm(resolve(directory, entry.name, 'dist'), { force: true, recursive: true });
    await rm(resolve(directory, entry.name, 'coverage'), { force: true, recursive: true });
  }
}
