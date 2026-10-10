import { randomUUID } from 'node:crypto';

import { digestToken } from '@site-monitor/auth';
import { createDatabasePool, runMigrations, type Pool } from '@site-monitor/database';
import { dropTestDatabase } from '@site-monitor/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NotificationService } from './notification-service.js';

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

databaseSuite('notification service PostgreSQL boundary', () => {
  const databaseName = `site_monitor_notifications_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const ownerA = '00000000-0000-4000-8000-000000000001';
  const ownerB = '00000000-0000-4000-8000-000000000002';
  const groupA = '00000000-0000-4000-8000-000000000101';
  let adminPool: Pool;
  let apiPool: Pool;
  let schemaPool: Pool;
  let service: NotificationService;
  let recipientA: Awaited<ReturnType<NotificationService['createRecipient']>>;

  beforeAll(async () => {
    adminPool = createDatabasePool({
      applicationName: 'notification-service-admin-test',
      connectionString: adminConnectionString!,
      maxConnections: 1,
    });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    const connectionString = databaseUrl(adminConnectionString!, databaseName);
    schemaPool = createDatabasePool({
      applicationName: 'notification-service-schema-test',
      connectionString,
      maxConnections: 2,
    });
    await runMigrations(schemaPool, { appBuild: 'notification-service-integration-test' });
    await schemaPool.query(
      `INSERT INTO infra.destination_activations
         (destination, activated_at, activated_by_revision)
       VALUES ('REALTIME', statement_timestamp(), 16)`,
    );
    await schemaPool.query(
      `INSERT INTO auth.users
         (id, email_normalized, email_display, display_name, status, email_verified_at)
       VALUES
         ($1, 'owner-a@example.test', 'owner-a@example.test', 'Owner A', 'ACTIVE', statement_timestamp()),
         ($2, 'owner-b@example.test', 'owner-b@example.test', 'Owner B', 'ACTIVE', statement_timestamp())`,
      [ownerA, ownerB],
    );
    await schemaPool.query(
      `INSERT INTO app.check_groups (id, owner_id, name) VALUES ($1, $2, 'Production')`,
      [groupA, ownerA],
    );
    await schemaPool.query(
      `INSERT INTO notification.policies
         (owner_id, group_id, mode, notify_down, notify_recovery)
       VALUES ($2, $1, 'INHERIT', NULL, NULL)`,
      [groupA, ownerA],
    );
    apiPool = createDatabasePool({
      applicationName: 'notification-service-api-test',
      connectionString,
      databaseRole: 'site_monitor_api',
      maxConnections: 4,
    });
    service = new NotificationService(apiPool, {
      emailEncryptionKey: { key: Buffer.alloc(32, 31), version: 'test-v1' },
      securityKey: Buffer.alloc(32, 32),
    });
  }, 30_000);

  afterAll(async () => {
    if (apiPool) await apiPool.end();
    if (schemaPool) await schemaPool.end();
    if (adminPool) {
      await dropTestDatabase(adminPool, databaseName);
      await adminPool.end();
    }
  }, 30_000);

  it('creates one pending recipient and encrypted verification job under concurrent replay', async () => {
    const request = [
      ownerA,
      ' Alerts@Example.test ',
      'notification-recipient-create-001',
      '00000000-0000-7000-8000-000000000001',
    ] as const;
    const [first, second] = await Promise.all([
      service.createRecipient(...request),
      service.createRecipient(...request),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ email: 'Alerts@Example.test', verification_state: 'PENDING' });
    recipientA = first;

    const persisted = await schemaPool.query<{
      defaults: string;
      deliveries: string;
      recipients: string;
      tokens: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM notification.recipients WHERE owner_id = $1) AS recipients,
         (SELECT count(*)::text FROM notification.recipient_verification_tokens
            WHERE owner_id = $1 AND consumed_at IS NULL) AS tokens,
         (SELECT count(*)::text FROM notification.transactional_email_deliveries
            WHERE owner_id = $1 AND purpose = 'VERIFY_NOTIFICATION_RECIPIENT') AS deliveries,
         (SELECT count(*)::text FROM notification.policies
            WHERE owner_id = $1 AND group_id IS NULL AND mode = 'DISABLED') AS defaults`,
      [ownerA],
    );
    expect(persisted.rows[0]).toEqual({
      defaults: '1',
      deliveries: '1',
      recipients: '1',
      tokens: '1',
    });
  });

  it('confirms a single-use token without an owner context and exposes the verified recipient', async () => {
    const token = 'known-recipient-verification-token';
    await schemaPool.query(
      `UPDATE notification.recipient_verification_tokens
       SET token_digest = $1 WHERE owner_id = $2 AND recipient_id = $3 AND consumed_at IS NULL`,
      [digestToken(token), ownerA, recipientA.id],
    );
    await service.confirmRecipient(token, '00000000-0000-7000-8000-000000000002');
    await expect(
      service.confirmRecipient(token, '00000000-0000-7000-8000-000000000003'),
    ).rejects.toMatchObject({ code: 'invalid_or_expired_token', status: 422 });
    const page = await service.listRecipients(ownerA, { limit: 20 });
    expect(page.data).toContainEqual(
      expect.objectContaining({
        id: recipientA.id,
        resource_version: '2',
        verification_state: 'VERIFIED',
      }),
    );
  });

  it('replaces the default and resolves group inheritance without merging', async () => {
    const defaultBefore = await service.getDefaultPolicy(ownerA);
    const active = await service.replaceDefaultPolicy(
      ownerA,
      defaultBefore.resource_version,
      {
        mode: 'ACTIVE',
        notify_down: true,
        notify_recovery: true,
        recipient_ids: [recipientA.id],
      },
      '00000000-0000-7000-8000-000000000004',
    );
    expect(active).toMatchObject({
      effective_mode: 'ACTIVE',
      effective_policy_id: active.id,
      effective_recipient_ids: [recipientA.id],
      resource_version: '2',
    });
    const inherited = await service.getGroupPolicy(ownerA, groupA);
    expect(inherited).toMatchObject({
      effective_mode: 'ACTIVE',
      effective_policy_id: active.id,
      effective_policy_version: '2',
      mode: 'INHERIT',
      recipient_ids: [],
    });
    const disabled = await service.replaceGroupPolicy(
      ownerA,
      groupA,
      inherited.resource_version,
      { mode: 'DISABLED', notify_down: null, notify_recovery: null, recipient_ids: [] },
      '00000000-0000-7000-8000-000000000005',
    );
    expect(disabled).toMatchObject({
      effective_mode: 'DISABLED',
      effective_policy_id: disabled.id,
      effective_recipient_ids: [],
    });
  });

  it('queues one idempotent test email and prevents disabling an active recipient', async () => {
    await service.sendTestEmail(ownerA, recipientA.id, 'notification-test-email-001');
    await service.sendTestEmail(ownerA, recipientA.id, 'notification-test-email-001');
    await expect(
      service.deleteRecipient(ownerA, recipientA.id, '2', '00000000-0000-7000-8000-000000000006'),
    ).rejects.toMatchObject({ code: 'resource_conflict', status: 409 });

    const queued = await schemaPool.query<{ count: string }>(
      `SELECT count(*)::text FROM notification.transactional_email_deliveries
       WHERE owner_id = $1 AND recipient_id = $2 AND purpose = 'TEST_NOTIFICATION'`,
      [ownerA, recipientA.id],
    );
    expect(queued.rows[0]!.count).toBe('1');
  });

  it('keeps recipient ownership isolated and allows disable after policy deactivation', async () => {
    const ownerBRecipient = await service.createRecipient(
      ownerB,
      'private@example.test',
      'owner-b-recipient-001',
      '00000000-0000-7000-8000-000000000007',
    );
    await expect(
      service.deleteRecipient(
        ownerA,
        ownerBRecipient.id,
        ownerBRecipient.resource_version,
        '00000000-0000-7000-8000-000000000008',
      ),
    ).rejects.toMatchObject({ code: 'resource_not_found', status: 404 });

    const current = await service.getDefaultPolicy(ownerA);
    await service.replaceDefaultPolicy(
      ownerA,
      current.resource_version,
      { mode: 'DISABLED', notify_down: null, notify_recovery: null, recipient_ids: [] },
      '00000000-0000-7000-8000-000000000009',
    );
    await service.deleteRecipient(
      ownerA,
      recipientA.id,
      '2',
      '00000000-0000-7000-8000-000000000010',
    );
    const page = await service.listRecipients(ownerA, { limit: 20 });
    expect(page.data).toContainEqual(
      expect.objectContaining({
        id: recipientA.id,
        resource_version: '3',
        verification_state: 'DISABLED',
      }),
    );
  });
});
