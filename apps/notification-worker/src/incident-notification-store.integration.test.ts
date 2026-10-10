import { randomUUID } from 'node:crypto';

import { createDatabasePool, runMigrations, type Pool } from '@site-monitor/database';
import { dropTestDatabase } from '@site-monitor/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IncidentNotificationStore } from './incident-notification-store.js';

const adminConnectionString = process.env.DATABASE_TEST_ADMIN_URL;
const databaseSuite = adminConnectionString ? describe : describe.skip;

function quotedIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/u.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function databaseUrl(adminUrl: string, databaseName: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

databaseSuite('incident notification PostgreSQL runtime', () => {
  const databaseName = `site_monitor_notification_runtime_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerId = '00000000-0000-4000-8000-000000001101';
  const checkId = '00000000-0000-4000-8000-000000001102';
  const jobId = '00000000-0000-7000-8000-000000001103';
  const attemptId = '00000000-0000-7000-8000-000000001104';
  const runId = '00000000-0000-7000-8000-000000001105';
  const incidentId = '00000000-0000-7000-8000-000000001106';
  const recipientId = '00000000-0000-7000-8000-000000001107';
  const openedEventId = '00000000-0000-7000-8000-000000001108';
  const closedEventId = '00000000-0000-7000-8000-000000001109';
  const downMaintenanceId = '00000000-0000-7000-8000-000000001110';
  const downMaintenanceEventId = '00000000-0000-7000-8000-000000001111';
  const recoveryMaintenanceId = '00000000-0000-7000-8000-000000001112';
  const recoveryMaintenanceEventId = '00000000-0000-7000-8000-000000001113';
  let adminPool: Pool;
  let schemaPool: Pool;
  let notifierPool: Pool;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'notification-runtime-admin-test',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    const connectionString = databaseUrl(adminConnectionString!, databaseName);
    schemaPool = createDatabasePool({
      applicationName: 'notification-runtime-schema-test',
      connectionString,
      maxConnections: 2,
    });
    await runMigrations(schemaPool, { appBuild: 'notification-runtime-integration-test' });
    notifierPool = createDatabasePool({
      applicationName: 'notification-runtime-notifier-test',
      connectionString,
      databaseRole: 'site_monitor_notifier',
      maxConnections: 4,
    });

    await schemaPool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES ($1, 'owner@example.test', 'owner@example.test', 'Owner', 'ACTIVE', statement_timestamp())`,
      [ownerId],
    );
    await schemaPool.query(
      `INSERT INTO app.checks
         (id, owner_id, name, url, interval_seconds, timeout_ms,
          expected_status_code, next_run_at)
       VALUES ($1, $2, 'Critical API <primary>', 'https://example.test', 30, 5000, 200,
               statement_timestamp())`,
      [checkId, ownerId],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.check_jobs
         (id, owner_id, check_id, trigger_kind, scheduled_for, state, config_snapshot,
          resource_version, probe_generation, schedule_generation, attempt_count,
          completed_at, terminal_reason)
       VALUES ($1, $2, $3, 'SCHEDULED', statement_timestamp() - interval '2 minutes',
               'COMPLETED', '{}'::jsonb, 1, 1, 1, 1, statement_timestamp(), 'RESULT_RECORDED')`,
      [jobId, ownerId, checkId],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.check_job_attempts
         (id, owner_id, check_id, job_id, attempt_number, worker_id, fencing_token,
          lease_acquired_at, started_at)
       VALUES ($1, $2, $3, $4, 1, 'test-worker', 1,
               statement_timestamp() - interval '2 minutes',
               statement_timestamp() - interval '2 minutes')`,
      [attemptId, ownerId, checkId, jobId],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.check_runs
         (finished_at, id, owner_id, check_id, job_id, attempt_id, trigger_kind,
          resource_version, probe_generation, schedule_generation, fencing_token,
          scheduled_for, started_at, total_ms, outcome, failure_category, accepted_for_state)
       VALUES (statement_timestamp() - interval '90 seconds', $1, $2, $3, $4, $5,
               'SCHEDULED', 1, 1, 1, 1, statement_timestamp() - interval '2 minutes',
               statement_timestamp() - interval '100 seconds', 5000, 'FAIL', 'TIMEOUT', true)`,
      [runId, ownerId, checkId, jobId, attemptId],
    );
    await schemaPool.query(
      `UPDATE monitoring.check_job_attempts AS attempt
       SET ended_at = statement_timestamp(), terminal_reason = 'RESULT_RECORDED',
           result_recorded_at = statement_timestamp(),
           result_run_finished_at = run.finished_at, result_run_id = run.id
       FROM monitoring.check_runs AS run
       WHERE attempt.id = $1 AND run.id = $2`,
      [attemptId, runId],
    );
    await schemaPool.query(
      `INSERT INTO monitoring.incidents
         (id, owner_id, check_id, first_failure_run_id, first_failure_run_finished_at,
          confirmation_run_id, confirmation_run_finished_at, started_at, confirmed_at,
          last_failure_category)
       SELECT $1, $2, $3, $4, run.finished_at, $4, run.finished_at,
              run.started_at, run.finished_at, 'TIMEOUT'
       FROM monitoring.check_runs AS run
       WHERE run.owner_id = $2 AND run.check_id = $3 AND run.id = $4`,
      [incidentId, ownerId, checkId, runId],
    );
    await schemaPool.query(
      `INSERT INTO notification.recipients
         (id, owner_id, email_normalized, email_display, status, verified_at)
       VALUES ($1, $2, 'alerts@example.test', 'alerts@example.test', 'VERIFIED', statement_timestamp())`,
      [recipientId, ownerId],
    );
    const policy = await schemaPool.query<{ id: string }>(
      `UPDATE notification.policies
       SET mode = 'ACTIVE', notify_down = true, notify_recovery = true,
           resource_version = resource_version + 1, updated_at = statement_timestamp()
       WHERE owner_id = $1 AND group_id IS NULL RETURNING id`,
      [ownerId],
    );
    await schemaPool.query(
      `INSERT INTO notification.policy_recipients (owner_id, policy_id, recipient_id)
       VALUES ($1, $2, $3)`,
      [ownerId, policy.rows[0]!.id, recipientId],
    );
    await schemaPool.query(
      `INSERT INTO infra.outbox_events
         (id, owner_id, event_type, schema_version, aggregate_type, aggregate_id,
          aggregate_version, correlation_id, occurred_at, payload)
       VALUES ($1, $2, 'incident.opened', 1, 'incident', $3, 1, $4,
               statement_timestamp(), jsonb_build_object('incident_id', $3::uuid, 'check_id', $5::uuid))`,
      [openedEventId, ownerId, incidentId, jobId, checkId],
    );
    await schemaPool.query(
      `INSERT INTO infra.outbox_dispatches (event_id, destination)
       VALUES ($1, 'NOTIFICATION')`,
      [openedEventId],
    );
  }, 30_000);

  afterAll(async () => {
    if (notifierPool) await notifierPool.end();
    if (schemaPool) await schemaPool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName);
      await adminPool.end();
    }
  }, 30_000);

  it('preserves one fenced DOWN/recovery lineage across maintenance and restart races', async () => {
    const first = new IncidentNotificationStore(notifierPool, 'notifier:first', 60, 5);
    const second = new IncidentNotificationStore(notifierPool, 'notifier:second', 60, 5);
    await expect(first.reconcileOpenIncidents()).resolves.toBe(1);
    await expect(second.reconcileOpenIncidents()).resolves.toBe(0);
    const dispatchResults = await Promise.all([first.consumeDispatch(), second.consumeDispatch()]);
    expect(dispatchResults).toEqual([true, true]);
    await expect(first.evaluateIntent()).resolves.toBe(true);
    await expect(second.evaluateIntent()).resolves.toBe(false);

    await schemaPool.query(
      `INSERT INTO app.maintenance_windows
         (id, owner_id, check_id, note, starts_at, ends_at)
       VALUES ($1, $2, $3, 'delivery race', statement_timestamp() - interval '1 minute',
               statement_timestamp() + interval '1 hour')`,
      [downMaintenanceId, ownerId, checkId],
    );
    await expect(first.claimDelivery()).resolves.toBeUndefined();
    await expect(
      schemaPool.query<{ state: string }>(
        `SELECT state FROM notification.deliveries
         WHERE incident_id = $1 AND event_kind = 'INCIDENT_OPENED'`,
        [incidentId],
      ),
    ).resolves.toMatchObject({ rows: [{ state: 'DEFERRED_MAINTENANCE' }] });

    await schemaPool.query(
      `UPDATE app.maintenance_windows
       SET state = 'CANCELLED', cancelled_at = statement_timestamp(),
           resource_version = resource_version + 1, updated_at = statement_timestamp()
       WHERE id = $1`,
      [downMaintenanceId],
    );
    await schemaPool.query(
      `INSERT INTO infra.outbox_events
         (id, owner_id, event_type, schema_version, aggregate_type, aggregate_id,
          aggregate_version, correlation_id, occurred_at, payload)
       VALUES ($1, $2, 'maintenance.cancelled', 1, 'maintenance_window', $3, 2, $4,
               statement_timestamp(),
               jsonb_build_object('check_id', $5::uuid, 'target_type', 'CHECK',
                                  'target_id', $5::uuid))`,
      [downMaintenanceEventId, ownerId, downMaintenanceId, jobId, checkId],
    );
    await schemaPool.query(
      `INSERT INTO infra.outbox_dispatches (event_id, destination)
       VALUES ($1, 'NOTIFICATION')`,
      [downMaintenanceEventId],
    );
    await expect(second.consumeDispatch()).resolves.toBe(true);

    const downClaims = await Promise.all([first.claimDelivery(), second.claimDelivery()]);
    expect(downClaims.filter((claim) => claim !== undefined)).toHaveLength(1);
    const down = downClaims[0] ?? downClaims[1];
    expect(down).toMatchObject({
      event_kind: 'INCIDENT_OPENED',
      recipient_address: 'alerts@example.test',
      template_key: 'INCIDENT_DOWN',
    });
    const staleCompletion = await notifierPool.query<{ completed: boolean }>(
      `SELECT security_api.complete_incident_notification_delivery(
         $1, 'notifier:stale', $2, 'SENT', 'smtp_accepted', 'stale-digest', 30
       ) AS completed`,
      [down!.delivery_id, down!.fencing_token],
    );
    expect(staleCompletion.rows[0]?.completed).toBe(false);
    const downClaimingStore = downClaims[0] ? first : second;
    await downClaimingStore.completeDelivery(down!, 'SENT', 'smtp_accepted', 'provider-digest', 30);

    await schemaPool.query(
      `UPDATE monitoring.incidents
       SET status = 'CLOSED', closed_at = statement_timestamp(), closure_reason = 'RECOVERED',
           observed_duration_ms = 90000, resource_version = resource_version + 1,
           updated_at = statement_timestamp()
       WHERE id = $1`,
      [incidentId],
    );
    await schemaPool.query(
      `INSERT INTO infra.outbox_events
         (id, owner_id, event_type, schema_version, aggregate_type, aggregate_id,
          aggregate_version, correlation_id, occurred_at, payload)
       VALUES ($1, $2, 'incident.closed', 1, 'incident', $3, 2, $4,
               statement_timestamp(), jsonb_build_object('incident_id', $3::uuid, 'check_id', $5::uuid))`,
      [closedEventId, ownerId, incidentId, jobId, checkId],
    );
    await schemaPool.query(
      `INSERT INTO infra.outbox_dispatches (event_id, destination)
       VALUES ($1, 'NOTIFICATION')`,
      [closedEventId],
    );

    await schemaPool.query(
      `INSERT INTO app.maintenance_windows
         (id, owner_id, check_id, note, starts_at, ends_at)
       VALUES ($1, $2, $3, 'recovery restart', statement_timestamp() - interval '1 minute',
               statement_timestamp() + interval '1 hour')`,
      [recoveryMaintenanceId, ownerId, checkId],
    );

    await expect(first.consumeDispatch()).resolves.toBe(true);
    await expect(first.evaluateIntent()).resolves.toBe(true);
    const deferredRecovery = await schemaPool.query<{
      maintenance_until: Date;
      state: string;
    }>(
      `SELECT maintenance_until, state FROM notification.intents
       WHERE incident_id = $1 AND event_kind = 'INCIDENT_RECOVERED'`,
      [incidentId],
    );
    expect(deferredRecovery.rows[0]).toMatchObject({ state: 'DEFERRED_MAINTENANCE' });
    expect(deferredRecovery.rows[0]!.maintenance_until.getTime()).toBeGreaterThan(Date.now());

    const restarted = new IncidentNotificationStore(notifierPool, 'notifier:restarted', 60, 5);
    await expect(restarted.claimDelivery()).resolves.toBeUndefined();
    await schemaPool.query(
      `UPDATE app.maintenance_windows
       SET state = 'CANCELLED', cancelled_at = statement_timestamp(),
           resource_version = resource_version + 1, updated_at = statement_timestamp()
       WHERE id = $1`,
      [recoveryMaintenanceId],
    );
    await schemaPool.query(
      `INSERT INTO infra.outbox_events
         (id, owner_id, event_type, schema_version, aggregate_type, aggregate_id,
          aggregate_version, correlation_id, occurred_at, payload)
       VALUES ($1, $2, 'maintenance.cancelled', 1, 'maintenance_window', $3, 2, $4,
               statement_timestamp(),
               jsonb_build_object('check_id', $5::uuid, 'target_type', 'CHECK',
                                  'target_id', $5::uuid))`,
      [recoveryMaintenanceEventId, ownerId, recoveryMaintenanceId, jobId, checkId],
    );
    await schemaPool.query(
      `INSERT INTO infra.outbox_dispatches (event_id, destination)
       VALUES ($1, 'NOTIFICATION')`,
      [recoveryMaintenanceEventId],
    );
    await expect(restarted.consumeDispatch()).resolves.toBe(true);
    await expect(restarted.evaluateIntent()).resolves.toBe(true);
    const recovery = await restarted.claimDelivery();
    expect(recovery).toMatchObject({
      event_kind: 'INCIDENT_RECOVERED',
      recipient_address: 'alerts@example.test',
      template_key: 'INCIDENT_RECOVERED',
    });
    await restarted.completeDelivery(
      recovery!,
      'SENT',
      'smtp_accepted',
      'recovery-provider-digest',
      30,
    );

    const evidence = await schemaPool.query<{
      attempts: string;
      down_deliveries: string;
      reconciliation_events: string;
      recovery_deliveries: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM notification.deliveries
           WHERE incident_id = $1 AND event_kind = 'INCIDENT_OPENED') AS down_deliveries,
         (SELECT count(*)::text FROM notification.deliveries
           WHERE incident_id = $1 AND event_kind = 'INCIDENT_RECOVERED') AS recovery_deliveries,
         (SELECT count(*)::text FROM infra.outbox_events
           WHERE aggregate_id = $1
             AND payload->>'notification_reconciliation' = 'cutover-v1') AS reconciliation_events,
         (SELECT count(*)::text FROM notification.delivery_attempts) AS attempts`,
      [incidentId],
    );
    expect(evidence.rows[0]).toEqual({
      attempts: '2',
      down_deliveries: '1',
      reconciliation_events: '1',
      recovery_deliveries: '1',
    });
  });

  it('persists retry, permanent, ambiguous and expired-lease SMTP outcomes', async () => {
    const retryId = '00000000-0000-7000-8000-000000001121';
    const failedId = '00000000-0000-7000-8000-000000001122';
    const unknownId = '00000000-0000-7000-8000-000000001123';
    const expiredId = '00000000-0000-7000-8000-000000001124';
    await schemaPool.query(
      `INSERT INTO notification.transactional_email_deliveries
         (id, owner_id, purpose, recipient_address_snapshot, encrypted_payload,
          encryption_iv, encryption_tag, encryption_key_version, available_at)
       VALUES
         ($1, $5, 'RESET_PASSWORD', 'retry@example.test', decode('01', 'hex'),
          decode(repeat('01', 12), 'hex'), decode(repeat('01', 16), 'hex'), 'test-v1',
          statement_timestamp() - interval '4 seconds'),
         ($2, $5, 'RESET_PASSWORD', 'failed@example.test', decode('01', 'hex'),
          decode(repeat('01', 12), 'hex'), decode(repeat('01', 16), 'hex'), 'test-v1',
          statement_timestamp() - interval '3 seconds'),
         ($3, $5, 'RESET_PASSWORD', 'unknown@example.test', decode('01', 'hex'),
          decode(repeat('01', 12), 'hex'), decode(repeat('01', 16), 'hex'), 'test-v1',
          statement_timestamp() - interval '2 seconds'),
         ($4, $5, 'RESET_PASSWORD', 'expired@example.test', decode('01', 'hex'),
          decode(repeat('01', 12), 'hex'), decode(repeat('01', 16), 'hex'), 'test-v1',
          statement_timestamp() - interval '1 second')`,
      [retryId, failedId, unknownId, expiredId, ownerId],
    );

    const claim = async (workerId: string) =>
      notifierPool.query<{
        delivery_id: string;
        fencing_token: string;
      }>('SELECT * FROM security_api.claim_transactional_email($1, 60)', [workerId]);
    const complete = async (
      deliveryId: string,
      workerId: string,
      fence: string,
      result: 'DELIVERY_UNKNOWN' | 'FAILED' | 'RETRY',
    ) =>
      notifierPool.query(
        `SELECT security_api.complete_transactional_email(
           $1, $2, $3, $4, 'smtp_test', NULL, 30
         )`,
        [deliveryId, workerId, fence, result],
      );

    const retryClaim = (await claim('notifier:retry')).rows[0]!;
    expect(retryClaim.delivery_id).toBe(retryId);
    await complete(retryId, 'notifier:retry', retryClaim.fencing_token, 'RETRY');
    const retryState = await schemaPool.query<{ available_at: Date; state: string }>(
      `SELECT available_at, state FROM notification.transactional_email_deliveries WHERE id = $1`,
      [retryId],
    );
    expect(retryState.rows[0]).toMatchObject({ state: 'RETRY_WAIT' });
    expect(retryState.rows[0]!.available_at.getTime()).toBeGreaterThan(Date.now());

    const failedClaim = (await claim('notifier:failed')).rows[0]!;
    expect(failedClaim.delivery_id).toBe(failedId);
    await complete(failedId, 'notifier:failed', failedClaim.fencing_token, 'FAILED');
    const unknownClaim = (await claim('notifier:unknown')).rows[0]!;
    expect(unknownClaim.delivery_id).toBe(unknownId);
    await complete(unknownId, 'notifier:unknown', unknownClaim.fencing_token, 'DELIVERY_UNKNOWN');

    const expiredClaim = (await claim('notifier:crashed')).rows[0]!;
    expect(expiredClaim.delivery_id).toBe(expiredId);
    await schemaPool.query(
      `UPDATE notification.transactional_email_deliveries
       SET lease_expires_at = statement_timestamp() - interval '1 second'
       WHERE id = $1`,
      [expiredId],
    );
    await expect(claim('notifier:after-restart')).resolves.toMatchObject({ rows: [] });

    const outcomes = await schemaPool.query<{ id: string; state: string }>(
      `SELECT id, state FROM notification.transactional_email_deliveries
       WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[retryId, failedId, unknownId, expiredId]],
    );
    expect(Object.fromEntries(outcomes.rows.map((row) => [row.id, row.state]))).toEqual({
      [expiredId]: 'DELIVERY_UNKNOWN',
      [failedId]: 'FAILED',
      [retryId]: 'RETRY_WAIT',
      [unknownId]: 'DELIVERY_UNKNOWN',
    });
  });
});
