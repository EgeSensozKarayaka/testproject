# Local Database Restore Rehearsal

**Date:** 2026-10-10 02:24 +06:00  
**Scope:** PostgreSQL 18.6 local Compose, logical `pg_dump` / `pg_restore`

## Purpose

To demonstrate, independently of automated migration tests, that an existing local database backup can be successfully restored into an empty, isolated database instance while fully preserving schema revisions, seed data, and security constraints.

This rehearsal does not constitute validation of production automated backups, point-in-time recovery (PITR), offsite encryption, provider snapshots, or formalized RPO/RTO SLAs. Production drills are scheduled under Stage 17.

## Procedure Followed

1. A custom-format logical dump of the `site_monitor` database was written to a temporary path inside the PostgreSQL container.
2. A temporary empty database named `site_monitor_restore_test` was created exclusively for this rehearsal.
3. The dump was restored into this database, including full owner and role privilege definitions.
4. Read-only verification queries were executed against the restored schema.
5. Following verification, `site_monitor_restore_test` and temporary dump artifacts were purged. The primary `site_monitor` database remained completely untouched with no reset or drop applied.

## Verified Results

| Check Item                       | Result |
| -------------------------------- | -----: |
| Schema revision                  |    `6` |
| Migration ledger rows            |    `6` |
| Demo users                       |    `1` |
| Demo checks                      |    `1` |
| `FORCE RLS` private parent table |   `29` |
| `pg_restore` process exit code   |    `0` |

## Production Drill Requirements

- Dedicated production-like database cluster with authentic deployment login wrappers
- Managed storage snapshots combined with continuous WAL archiving / PITR replay to target point-in-time targets
- Backup storage encryption and IAM access policy validation
- RLS negative security smoke tests, auth bootstrap verification, scheduler job claiming, history queries, and public snapshot acceptance tests
- Measured RPO/RTO metrics, data loss assessments, and formal restore audit reports
