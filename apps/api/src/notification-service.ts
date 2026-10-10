import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import {
  canonicalizeEmail,
  createOpaqueToken,
  digestToken,
  encryptJson,
  InvalidEmailError,
  type VersionedSecretKey,
} from '@site-monitor/auth';
import type { Pool, PoolClient } from '@site-monitor/database';
import { withUserTransaction, writeActivatedOutboxEvent } from '@site-monitor/database';
import { DomainValidationError } from '@site-monitor/domain';
import {
  normalizeNotificationPolicy,
  resolveNotificationPolicy,
  type NotificationPolicyConfiguration,
  type NotificationPolicyInput,
} from '@site-monitor/notifications';

import { ApiProblemError } from './problem.js';

type PolicyMode = 'ACTIVE' | 'DISABLED' | 'INHERIT';

export interface NotificationRecipientDto {
  created_at: string;
  email: string;
  id: string;
  resource_version: string;
  verification_state: 'DISABLED' | 'PENDING' | 'VERIFIED';
}

export interface NotificationRecipientPageDto {
  data: NotificationRecipientDto[];
  page: { has_more: boolean; next_cursor: string | null };
}

export interface NotificationPolicyWriteDto {
  mode: PolicyMode;
  notify_down: boolean | null;
  notify_recovery: boolean | null;
  recipient_ids: string[];
}

export interface NotificationPolicyDto extends NotificationPolicyWriteDto {
  effective_mode: 'ACTIVE' | 'DISABLED';
  effective_notify_down: boolean | null;
  effective_notify_recovery: boolean | null;
  effective_policy_id: string;
  effective_policy_version: string;
  effective_recipient_ids: string[];
  id: string;
  resource_version: string;
  scope_id: string | null;
  scope_type: 'DEFAULT' | 'GROUP';
}

export interface NotificationServicePort {
  confirmRecipient: (token: string, correlationId: string) => Promise<void>;
  createRecipient: (
    ownerId: string,
    email: string,
    idempotencyKey: string,
    correlationId: string,
  ) => Promise<NotificationRecipientDto>;
  deleteRecipient: (
    ownerId: string,
    recipientId: string,
    expectedVersion: string,
    correlationId: string,
  ) => Promise<void>;
  getDefaultPolicy: (ownerId: string) => Promise<NotificationPolicyDto>;
  getGroupPolicy: (ownerId: string, groupId: string) => Promise<NotificationPolicyDto>;
  listRecipients: (
    ownerId: string,
    input: { cursor?: string; limit: number },
  ) => Promise<NotificationRecipientPageDto>;
  replaceDefaultPolicy: (
    ownerId: string,
    expectedVersion: string,
    input: NotificationPolicyWriteDto,
    correlationId: string,
  ) => Promise<NotificationPolicyDto>;
  replaceGroupPolicy: (
    ownerId: string,
    groupId: string,
    expectedVersion: string,
    input: NotificationPolicyWriteDto,
    correlationId: string,
  ) => Promise<NotificationPolicyDto>;
  resendRecipientVerification: (
    ownerId: string,
    recipientId: string,
    idempotencyKey: string,
  ) => Promise<void>;
  sendTestEmail: (ownerId: string, recipientId: string, idempotencyKey: string) => Promise<void>;
}

interface RecipientRow {
  created_at: Date | string;
  email_display: string;
  id: string;
  resource_version: string;
  status: 'DISABLED' | 'PENDING_VERIFICATION' | 'VERIFIED';
}

interface PolicyRow {
  group_id: string | null;
  id: string;
  mode: PolicyMode;
  notify_down: boolean | null;
  notify_recovery: boolean | null;
  recipient_ids: string[];
  resource_version: string;
}

interface CursorPayload {
  createdAt: string;
  expiresAt: number;
  id: string;
  version: 1;
}

function instant(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapRecipient(row: RecipientRow): NotificationRecipientDto {
  return {
    created_at: instant(row.created_at),
    email: row.email_display,
    id: row.id,
    resource_version: String(row.resource_version),
    verification_state: row.status === 'PENDING_VERIFICATION' ? 'PENDING' : row.status,
  };
}

function digest(key: Buffer, domain: string, value: string): Buffer {
  return createHmac('sha256', key).update(domain).update('\0').update(value).digest();
}

function resourceNotFound(noun: string): ApiProblemError {
  return new ApiProblemError({
    code: 'resource_not_found',
    detail: `The requested ${noun} was not found.`,
    status: 404,
  });
}

function conflict(detail: string): ApiProblemError {
  return new ApiProblemError({ code: 'resource_conflict', detail, status: 409 });
}

function assertVersion(actual: string, expected: string, noun: string): void {
  if (actual === expected) return;
  throw new ApiProblemError({
    code: 'resource_version_mismatch',
    detail: `The ${noun} changed after it was read.`,
    etag: `"rv-${actual}"`,
    status: 412,
  });
}

function validation(error: DomainValidationError | InvalidEmailError): ApiProblemError {
  const field = error instanceof DomainValidationError ? error.field : 'email';
  const code = error instanceof DomainValidationError ? error.code : 'invalid_email';
  return new ApiProblemError({
    code: 'validation_failed',
    detail: 'One or more fields are invalid.',
    issues: [{ code, message: error.message, pointer: `/${field}` }],
    status: 422,
  });
}

function policyConfiguration(row: PolicyRow): NotificationPolicyConfiguration {
  return {
    id: row.id,
    mode: row.mode,
    notifyDown: row.notify_down,
    notifyRecovery: row.notify_recovery,
    recipientIds: row.recipient_ids,
    resourceVersion: String(row.resource_version),
  };
}

function policyDto(
  configured: PolicyRow,
  effective: ReturnType<typeof resolveNotificationPolicy>,
): NotificationPolicyDto {
  return {
    effective_mode: effective.mode,
    effective_notify_down: effective.notifyDown,
    effective_notify_recovery: effective.notifyRecovery,
    effective_policy_id: effective.id,
    effective_policy_version: effective.resourceVersion,
    effective_recipient_ids: effective.recipientIds,
    id: configured.id,
    mode: configured.mode,
    notify_down: configured.notify_down,
    notify_recovery: configured.notify_recovery,
    recipient_ids: configured.recipient_ids,
    resource_version: String(configured.resource_version),
    scope_id: configured.group_id,
    scope_type: configured.group_id ? 'GROUP' : 'DEFAULT',
  };
}

async function selectPolicy(
  client: PoolClient,
  ownerId: string,
  groupId: string | null,
  lock = false,
): Promise<PolicyRow | undefined> {
  if (lock) {
    await client.query(
      `SELECT id FROM notification.policies
       WHERE owner_id = $1 AND group_id IS NOT DISTINCT FROM $2::uuid
       FOR UPDATE`,
      [ownerId, groupId],
    );
  }
  const result = await client.query<PolicyRow>(
    `SELECT policy.id, policy.group_id, policy.mode, policy.notify_down,
            policy.notify_recovery, policy.resource_version::text,
            COALESCE(array_agg(link.recipient_id ORDER BY link.recipient_id)
              FILTER (WHERE link.recipient_id IS NOT NULL), ARRAY[]::uuid[]) AS recipient_ids
     FROM notification.policies AS policy
     LEFT JOIN notification.policy_recipients AS link
       ON link.owner_id = policy.owner_id AND link.policy_id = policy.id
     WHERE policy.owner_id = $1 AND policy.group_id IS NOT DISTINCT FROM $2::uuid
     GROUP BY policy.id`,
    [ownerId, groupId],
  );
  return result.rows[0];
}

async function writeAudit(
  client: PoolClient,
  input: {
    action: string;
    correlationId: string;
    ownerId: string;
    resourceId: string;
    resourceType: 'notification_policy' | 'notification_recipient';
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit.events
       (occurred_at, owner_id, actor_type, actor_id, action, resource_type,
        resource_id, correlation_id, result, metadata)
     VALUES (statement_timestamp(), $1::uuid, 'USER', $1::uuid::text, $2, $3, $4, $5,
             'SUCCESS', '{}'::jsonb)`,
    [input.ownerId, input.action, input.resourceType, input.resourceId, input.correlationId],
  );
}

export interface NotificationServiceOptions {
  cursorTtlSeconds?: number;
  emailEncryptionKey: VersionedSecretKey;
  securityKey: Buffer;
  verificationTtlSeconds?: number;
}

export class NotificationService implements NotificationServicePort {
  readonly #cursorTtlSeconds: number;
  readonly #emailEncryptionKey: VersionedSecretKey;
  readonly #pool: Pool;
  readonly #securityKey: Buffer;
  readonly #verificationTtlSeconds: number;

  constructor(pool: Pool, options: NotificationServiceOptions) {
    this.#pool = pool;
    this.#securityKey = options.securityKey;
    this.#emailEncryptionKey = options.emailEncryptionKey;
    this.#cursorTtlSeconds = options.cursorTtlSeconds ?? 900;
    this.#verificationTtlSeconds = options.verificationTtlSeconds ?? 3600;
  }

  async createRecipient(
    ownerId: string,
    inputEmail: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<NotificationRecipientDto> {
    let email: ReturnType<typeof canonicalizeEmail>;
    try {
      email = canonicalizeEmail(inputEmail);
    } catch (error) {
      if (error instanceof InvalidEmailError) throw validation(error);
      throw error;
    }
    const subjectDigest = digest(
      this.#securityKey,
      'notification-recipient-create-subject',
      ownerId,
    );
    const keyDigest = digest(
      this.#securityKey,
      'notification-recipient-create-key',
      idempotencyKey,
    );
    const requestHash = createHash('sha256').update(email.normalized).digest();

    return withUserTransaction(this.#pool, ownerId, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `notification-recipient-create:${keyDigest.toString('hex')}`,
      ]);
      const receipt = await client.query<{
        request_hash: Buffer;
        response_body: NotificationRecipientDto;
      }>(
        `SELECT request_hash, response_body
         FROM infra.api_idempotency_records
         WHERE owner_id = $1 AND subject_digest = $2
           AND operation = 'notification.recipient.create' AND key_digest = $3`,
        [ownerId, subjectDigest, keyDigest],
      );
      if (receipt.rows[0]) {
        if (!timingSafeEqual(receipt.rows[0].request_hash, requestHash)) {
          throw new ApiProblemError({
            code: 'idempotency_key_reused',
            detail: 'The idempotency key was already used with different input.',
            status: 409,
          });
        }
        return receipt.rows[0].response_body;
      }

      const selected = await client.query<RecipientRow>(
        `SELECT id, email_display, status, resource_version::text, created_at
         FROM notification.recipients
         WHERE owner_id = $1 AND email_normalized = $2
         FOR UPDATE`,
        [ownerId, email.normalized],
      );
      let row = selected.rows[0];
      let action = 'notification.recipient_created';
      if (row && row.status !== 'DISABLED') {
        throw conflict('That notification recipient already exists.');
      }
      if (row) {
        const updated = await client.query<RecipientRow>(
          `UPDATE notification.recipients
           SET email_display = $3, status = 'PENDING_VERIFICATION', verified_at = NULL,
               disabled_at = NULL, resource_version = resource_version + 1,
               updated_at = statement_timestamp()
           WHERE owner_id = $1 AND id = $2
           RETURNING id, email_display, status, resource_version::text, created_at`,
          [ownerId, row.id, email.display],
        );
        row = updated.rows[0]!;
        action = 'notification.recipient_reactivated';
      } else {
        const inserted = await client.query<RecipientRow>(
          `INSERT INTO notification.recipients (owner_id, email_normalized, email_display)
           VALUES ($1, $2, $3)
           RETURNING id, email_display, status, resource_version::text, created_at`,
          [ownerId, email.normalized, email.display],
        );
        row = inserted.rows[0]!;
      }
      await this.#queueVerification(client, ownerId, row);
      const recipient = mapRecipient(row);
      await writeActivatedOutboxEvent(client, {
        aggregateId: recipient.id,
        aggregateType: 'notification_recipient',
        aggregateVersion: recipient.resource_version,
        correlationId,
        destinations: ['REALTIME'],
        eventType: action,
        ownerId,
        payload: { recipient_id: recipient.id, resource_version: recipient.resource_version },
      });
      await writeAudit(client, {
        action,
        correlationId,
        ownerId,
        resourceId: recipient.id,
        resourceType: 'notification_recipient',
      });
      await client.query(
        `INSERT INTO infra.api_idempotency_records
           (owner_id, subject_digest, operation, key_digest, request_hash,
            response_status, response_headers, response_body, expires_at)
         VALUES ($1, $2, 'notification.recipient.create', $3, $4, 201,
                 jsonb_build_object('Location', $5::text, 'ETag', $6::text), $7::jsonb,
                 statement_timestamp() + interval '24 hours')`,
        [
          ownerId,
          subjectDigest,
          keyDigest,
          requestHash,
          `/api/v1/notification-recipients/${recipient.id}`,
          `"rv-${recipient.resource_version}"`,
          JSON.stringify(recipient),
        ],
      );
      return recipient;
    });
  }

  async listRecipients(
    ownerId: string,
    input: { cursor?: string; limit: number },
  ): Promise<NotificationRecipientPageDto> {
    const cursor = input.cursor ? this.#decodeCursor(input.cursor) : undefined;
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      const result = await client.query<RecipientRow>(
        `SELECT id, email_display, status, resource_version::text, created_at
         FROM notification.recipients
         WHERE owner_id = $1
           AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
         ORDER BY created_at DESC, id DESC
         LIMIT $4`,
        [ownerId, cursor?.createdAt ?? null, cursor?.id ?? null, input.limit + 1],
      );
      const hasMore = result.rows.length > input.limit;
      const rows = result.rows.slice(0, input.limit);
      const last = rows.at(-1);
      return {
        data: rows.map(mapRecipient),
        page: {
          has_more: hasMore,
          next_cursor:
            hasMore && last
              ? this.#encodeCursor({
                  createdAt: instant(last.created_at),
                  expiresAt: Math.floor(Date.now() / 1000) + this.#cursorTtlSeconds,
                  id: last.id,
                  version: 1,
                })
              : null,
        },
      };
    });
  }

  async resendRecipientVerification(
    ownerId: string,
    recipientId: string,
    idempotencyKey: string,
  ): Promise<void> {
    await this.#runAccepted(
      ownerId,
      'notification.recipient.verify.resend',
      recipientId,
      idempotencyKey,
      async (client) => {
        const result = await client.query<RecipientRow>(
          `SELECT id, email_display, status, resource_version::text, created_at
         FROM notification.recipients WHERE owner_id = $1 AND id = $2 FOR UPDATE`,
          [ownerId, recipientId],
        );
        const recipient = result.rows[0];
        if (!recipient) throw resourceNotFound('notification recipient');
        if (recipient.status !== 'PENDING_VERIFICATION') {
          throw conflict('Only a pending notification recipient can be verified.');
        }
        await this.#queueVerification(client, ownerId, recipient);
      },
    );
  }

  async sendTestEmail(ownerId: string, recipientId: string, idempotencyKey: string): Promise<void> {
    await this.#runAccepted(
      ownerId,
      'notification.recipient.test',
      recipientId,
      idempotencyKey,
      async (client) => {
        const result = await client.query<RecipientRow>(
          `SELECT id, email_display, status, resource_version::text, created_at
         FROM notification.recipients WHERE owner_id = $1 AND id = $2 FOR UPDATE`,
          [ownerId, recipientId],
        );
        const recipient = result.rows[0];
        if (!recipient) throw resourceNotFound('notification recipient');
        if (recipient.status !== 'VERIFIED') {
          throw conflict('Only a verified notification recipient can receive a test email.');
        }
        const encrypted = encryptJson({}, this.#emailEncryptionKey);
        await this.#enqueueSecretEmail(client, ownerId, recipient, 'TEST_NOTIFICATION', encrypted);
      },
    );
  }

  async confirmRecipient(token: string, correlationId: string): Promise<void> {
    const result = await this.#pool.query<{ owner_id: string }>(
      'SELECT * FROM security_api.confirm_notification_recipient($1,$2)',
      [digestToken(token), correlationId],
    );
    if (!result.rows[0]) {
      throw new ApiProblemError({
        code: 'invalid_or_expired_token',
        detail: 'The verification token is invalid or expired.',
        status: 422,
      });
    }
  }

  async deleteRecipient(
    ownerId: string,
    recipientId: string,
    expectedVersion: string,
    correlationId: string,
  ): Promise<void> {
    await withUserTransaction(this.#pool, ownerId, async (client) => {
      const result = await client.query<RecipientRow>(
        `SELECT id, email_display, status, resource_version::text, created_at
         FROM notification.recipients WHERE owner_id = $1 AND id = $2 FOR UPDATE`,
        [ownerId, recipientId],
      );
      const recipient = result.rows[0];
      if (!recipient) throw resourceNotFound('notification recipient');
      assertVersion(recipient.resource_version, expectedVersion, 'notification recipient');
      if (recipient.status === 'DISABLED') return;
      const referenced = await client.query(
        `SELECT 1
         FROM notification.policy_recipients AS link
         JOIN notification.policies AS policy
           ON policy.owner_id = link.owner_id AND policy.id = link.policy_id
         WHERE link.owner_id = $1 AND link.recipient_id = $2 AND policy.mode = 'ACTIVE'
         LIMIT 1`,
        [ownerId, recipientId],
      );
      if (referenced.rows[0]) {
        throw conflict('Disable active notification policies before disabling this recipient.');
      }
      const updated = await client.query<{ resource_version: string }>(
        `UPDATE notification.recipients
         SET status = 'DISABLED', disabled_at = statement_timestamp(),
             resource_version = resource_version + 1, updated_at = statement_timestamp()
         WHERE owner_id = $1 AND id = $2 RETURNING resource_version::text`,
        [ownerId, recipientId],
      );
      await client.query(
        `UPDATE notification.recipient_verification_tokens
         SET consumed_at = statement_timestamp()
         WHERE owner_id = $1 AND recipient_id = $2 AND consumed_at IS NULL`,
        [ownerId, recipientId],
      );
      await client.query('SELECT security_api.cancel_recipient_transactional_emails($1,$2)', [
        ownerId,
        recipientId,
      ]);
      const version = updated.rows[0]!.resource_version;
      await writeActivatedOutboxEvent(client, {
        aggregateId: recipientId,
        aggregateType: 'notification_recipient',
        aggregateVersion: version,
        correlationId,
        destinations: ['REALTIME'],
        eventType: 'notification.recipient_disabled',
        ownerId,
        payload: { recipient_id: recipientId, resource_version: version },
      });
      await writeAudit(client, {
        action: 'notification.recipient_disabled',
        correlationId,
        ownerId,
        resourceId: recipientId,
        resourceType: 'notification_recipient',
      });
    });
  }

  async getDefaultPolicy(ownerId: string): Promise<NotificationPolicyDto> {
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      const policy = await selectPolicy(client, ownerId, null);
      if (!policy) throw resourceNotFound('default notification policy');
      const configured = policyConfiguration(policy);
      if (configured.mode === 'INHERIT') throw new Error('Default policy cannot inherit.');
      return policyDto(policy, {
        ...configured,
        mode: configured.mode,
      });
    });
  }

  async getGroupPolicy(ownerId: string, groupId: string): Promise<NotificationPolicyDto> {
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      await this.#assertGroup(client, ownerId, groupId);
      const [group, ownerDefault] = await Promise.all([
        selectPolicy(client, ownerId, groupId),
        selectPolicy(client, ownerId, null),
      ]);
      if (!group || !ownerDefault) throw resourceNotFound('notification policy');
      return policyDto(
        group,
        resolveNotificationPolicy(policyConfiguration(group), policyConfiguration(ownerDefault)),
      );
    });
  }

  async replaceDefaultPolicy(
    ownerId: string,
    expectedVersion: string,
    input: NotificationPolicyWriteDto,
    correlationId: string,
  ): Promise<NotificationPolicyDto> {
    return this.#replacePolicy(ownerId, null, expectedVersion, input, correlationId);
  }

  async replaceGroupPolicy(
    ownerId: string,
    groupId: string,
    expectedVersion: string,
    input: NotificationPolicyWriteDto,
    correlationId: string,
  ): Promise<NotificationPolicyDto> {
    return this.#replacePolicy(ownerId, groupId, expectedVersion, input, correlationId);
  }

  async #replacePolicy(
    ownerId: string,
    groupId: string | null,
    expectedVersion: string,
    input: NotificationPolicyWriteDto,
    correlationId: string,
  ): Promise<NotificationPolicyDto> {
    let normalized: NotificationPolicyInput;
    try {
      normalized = normalizeNotificationPolicy(
        {
          mode: input.mode,
          notifyDown: input.notify_down,
          notifyRecovery: input.notify_recovery,
          recipientIds: input.recipient_ids,
        },
        { allowInherit: groupId !== null },
      );
    } catch (error) {
      if (error instanceof DomainValidationError) throw validation(error);
      throw error;
    }
    return withUserTransaction(this.#pool, ownerId, async (client) => {
      if (groupId) await this.#assertGroup(client, ownerId, groupId);
      const current = await selectPolicy(client, ownerId, groupId, true);
      if (!current) throw resourceNotFound('notification policy');
      assertVersion(current.resource_version, expectedVersion, 'notification policy');
      if (normalized.mode === 'ACTIVE') {
        const verified = await client.query<{ id: string }>(
          `SELECT id FROM notification.recipients
           WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND status = 'VERIFIED'
           ORDER BY id FOR SHARE`,
          [ownerId, normalized.recipientIds],
        );
        if (verified.rows.length !== normalized.recipientIds.length) {
          throw new ApiProblemError({
            code: 'unprocessable_configuration',
            detail: 'Every active policy recipient must exist and be verified.',
            issues: [
              {
                code: 'recipient_not_verified',
                message: 'Every recipient must be verified.',
                pointer: '/recipient_ids',
              },
            ],
            status: 422,
          });
        }
      }
      const unchanged =
        current.mode === normalized.mode &&
        current.notify_down === normalized.notifyDown &&
        current.notify_recovery === normalized.notifyRecovery &&
        current.recipient_ids.join(',') === normalized.recipientIds.join(',');
      let configured = current;
      if (!unchanged) {
        const updated = await client.query<PolicyRow>(
          `UPDATE notification.policies
           SET mode = $3, notify_down = $4, notify_recovery = $5,
               resource_version = resource_version + 1, updated_at = statement_timestamp()
           WHERE owner_id = $1 AND id = $2
           RETURNING id, group_id, mode, notify_down, notify_recovery,
                     resource_version::text, ARRAY[]::uuid[] AS recipient_ids`,
          [ownerId, current.id, normalized.mode, normalized.notifyDown, normalized.notifyRecovery],
        );
        await client.query(
          'DELETE FROM notification.policy_recipients WHERE owner_id = $1 AND policy_id = $2',
          [ownerId, current.id],
        );
        if (normalized.recipientIds.length > 0) {
          await client.query(
            `INSERT INTO notification.policy_recipients (owner_id, policy_id, recipient_id)
             SELECT $1, $2, recipient_id FROM unnest($3::uuid[]) AS recipient_id`,
            [ownerId, current.id, normalized.recipientIds],
          );
        }
        configured = { ...updated.rows[0]!, recipient_ids: normalized.recipientIds };
        await writeActivatedOutboxEvent(client, {
          aggregateId: configured.id,
          aggregateType: 'notification_policy',
          aggregateVersion: configured.resource_version,
          correlationId,
          destinations: ['REALTIME'],
          eventType: 'notification.policy_changed',
          ownerId,
          payload: {
            policy_id: configured.id,
            resource_version: configured.resource_version,
            scope_id: groupId,
          },
        });
        await writeAudit(client, {
          action: 'notification.policy_updated',
          correlationId,
          ownerId,
          resourceId: configured.id,
          resourceType: 'notification_policy',
        });
      }
      const ownerDefault = groupId ? await selectPolicy(client, ownerId, null) : configured;
      if (!ownerDefault) throw resourceNotFound('default notification policy');
      const effective = groupId
        ? resolveNotificationPolicy(
            policyConfiguration(configured),
            policyConfiguration(ownerDefault),
          )
        : policyConfiguration(configured);
      if (effective.mode === 'INHERIT') throw new Error('Default policy cannot inherit.');
      return policyDto(configured, { ...effective, mode: effective.mode });
    });
  }

  async #assertGroup(client: PoolClient, ownerId: string, groupId: string): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM app.check_groups
       WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [ownerId, groupId],
    );
    if (!result.rows[0]) throw resourceNotFound('group');
  }

  async #queueVerification(
    client: PoolClient,
    ownerId: string,
    recipient: RecipientRow,
  ): Promise<void> {
    const token = createOpaqueToken();
    await client.query(
      `UPDATE notification.recipient_verification_tokens
       SET consumed_at = statement_timestamp()
       WHERE owner_id = $1 AND recipient_id = $2 AND consumed_at IS NULL`,
      [ownerId, recipient.id],
    );
    await client.query('SELECT security_api.cancel_recipient_transactional_emails($1,$2)', [
      ownerId,
      recipient.id,
    ]);
    await client.query(
      `INSERT INTO notification.recipient_verification_tokens
         (owner_id, recipient_id, token_digest, expires_at)
       VALUES ($1, $2, $3, statement_timestamp() + make_interval(secs => $4))`,
      [ownerId, recipient.id, digestToken(token), this.#verificationTtlSeconds],
    );
    const encrypted = encryptJson({ token }, this.#emailEncryptionKey);
    await this.#enqueueSecretEmail(
      client,
      ownerId,
      recipient,
      'VERIFY_NOTIFICATION_RECIPIENT',
      encrypted,
    );
  }

  async #enqueueSecretEmail(
    client: PoolClient,
    ownerId: string,
    recipient: RecipientRow,
    purpose: 'TEST_NOTIFICATION' | 'VERIFY_NOTIFICATION_RECIPIENT',
    encrypted: ReturnType<typeof encryptJson>,
  ): Promise<void> {
    await client.query(
      `SELECT security_api.enqueue_recipient_transactional_email($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        ownerId,
        recipient.id,
        purpose,
        recipient.email_display,
        encrypted.ciphertext,
        encrypted.initializationVector,
        encrypted.tag,
        encrypted.keyVersion,
      ],
    );
  }

  async #runAccepted(
    ownerId: string,
    operation: string,
    subject: string,
    idempotencyKey: string,
    action: (client: PoolClient) => Promise<void>,
  ): Promise<void> {
    const subjectDigest = digest(
      this.#securityKey,
      `${operation}-subject`,
      `${ownerId}:${subject}`,
    );
    const keyDigest = digest(this.#securityKey, `${operation}-key`, idempotencyKey);
    const requestHash = createHash('sha256').update(subject).digest();
    await withUserTransaction(this.#pool, ownerId, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${operation}:${keyDigest.toString('hex')}`,
      ]);
      const receipt = await client.query<{ request_hash: Buffer }>(
        `SELECT request_hash FROM infra.api_idempotency_records
         WHERE owner_id = $1 AND subject_digest = $2 AND operation = $3 AND key_digest = $4`,
        [ownerId, subjectDigest, operation, keyDigest],
      );
      if (receipt.rows[0]) {
        if (!timingSafeEqual(receipt.rows[0].request_hash, requestHash)) {
          throw new ApiProblemError({
            code: 'idempotency_key_reused',
            detail: 'The idempotency key was already used with different input.',
            status: 409,
          });
        }
        return;
      }
      await action(client);
      await client.query(
        `INSERT INTO infra.api_idempotency_records
           (owner_id, subject_digest, operation, key_digest, request_hash,
            response_status, response_headers, response_body, expires_at)
         VALUES ($1, $2, $3, $4, $5, 202, '{}'::jsonb,
                 '{"accepted":true}'::jsonb, statement_timestamp() + interval '24 hours')`,
        [ownerId, subjectDigest, operation, keyDigest, requestHash],
      );
    });
  }

  #encodeCursor(payload: CursorPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = digest(
      this.#securityKey,
      'notification-recipient-list-cursor',
      body,
    ).toString('base64url');
    return `${body}.${signature}`;
  }

  #decodeCursor(value: string): CursorPayload {
    try {
      const [body, signature, extra] = value.split('.');
      if (!body || !signature || extra) throw new Error('invalid parts');
      const actual = Buffer.from(signature, 'base64url');
      const expected = digest(this.#securityKey, 'notification-recipient-list-cursor', body);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new Error('invalid signature');
      }
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CursorPayload;
      if (
        payload.version !== 1 ||
        typeof payload.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(payload.createdAt)) ||
        typeof payload.id !== 'string' ||
        !/^[0-9a-f-]{36}$/u.test(payload.id) ||
        !Number.isInteger(payload.expiresAt) ||
        payload.expiresAt < Math.floor(Date.now() / 1000)
      ) {
        throw new Error('invalid payload');
      }
      return payload;
    } catch {
      throw new ApiProblemError({
        code: 'invalid_cursor',
        detail: 'The page cursor is invalid or expired.',
        status: 400,
      });
    }
  }
}
