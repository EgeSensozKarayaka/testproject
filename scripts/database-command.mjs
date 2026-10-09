const command = process.argv[2] ?? 'unknown';

console.error(
  `Database command "${command}" is intentionally unavailable until the Phase 3 schema is approved.`,
);
process.exitCode = 1;
