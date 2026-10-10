import { randomUUID } from 'node:crypto';

import { decryptJson } from '@site-monitor/auth';
import {
  loadAuthRuntimeConfig,
  loadDatabaseUrl,
  loadRuntimeConfig,
  loadTransactionalEmailConfig,
} from '@site-monitor/config';
import type { ServiceHealth } from '@site-monitor/contracts';
import { createDatabasePool, isDatabaseReady } from '@site-monitor/database';
import { createLogger } from '@site-monitor/observability';
import Fastify from 'fastify';
import nodemailer from 'nodemailer';

import {
  transactionalEmailContent,
  type SecretEmailPayload,
  type TransactionalEmailPurpose,
} from './email-content.js';

const config = loadRuntimeConfig({ defaultPort: 3012, serviceName: 'notification-worker' });
const logger = createLogger({
  environment: config.nodeEnv,
  service: config.serviceName,
  version: config.version,
});
const database = createDatabasePool({
  applicationName: config.serviceName,
  connectionString: loadDatabaseUrl(),
  databaseRole: 'site_monitor_notifier',
  maxConnections: 2,
});
const app = Fastify({ loggerInstance: logger });
const authConfig = loadAuthRuntimeConfig();
const emailConfig = loadTransactionalEmailConfig();
const workerId = `${config.serviceName}:${randomUUID()}`;
const transport = nodemailer.createTransport({
  host: emailConfig.smtpHost,
  port: emailConfig.smtpPort,
  secure: false,
});

interface ClaimedEmail {
  attempt_count: number;
  delivery_id: string;
  encrypted_payload: Buffer;
  encryption_iv: Buffer;
  encryption_key_version: string;
  encryption_tag: Buffer;
  fencing_token: string;
  owner_id: string;
  purpose: TransactionalEmailPurpose;
  recipient_address: string;
}

async function completeEmail(
  claim: ClaimedEmail,
  result: 'DELIVERY_UNKNOWN' | 'RETRY' | 'SENT',
  resultCode: string,
  providerMessageId: string | null,
): Promise<void> {
  await database.query('SELECT security_api.complete_transactional_email($1,$2,$3,$4,$5,$6,$7)', [
    claim.delivery_id,
    workerId,
    claim.fencing_token,
    result,
    resultCode,
    providerMessageId,
    30,
  ]);
}

async function deliverOne(): Promise<boolean> {
  const result = await database.query<ClaimedEmail>(
    'SELECT * FROM security_api.claim_transactional_email($1,$2)',
    [workerId, 60],
  );
  const claim = result.rows[0];
  if (!claim) return false;

  try {
    const payload = decryptJson<SecretEmailPayload>(
      {
        ciphertext: claim.encrypted_payload,
        initializationVector: claim.encryption_iv,
        keyVersion: claim.encryption_key_version,
        tag: claim.encryption_tag,
      },
      [{ key: authConfig.emailEncryptionKey, version: authConfig.emailEncryptionKeyVersion }],
    );
    const content = transactionalEmailContent(claim.purpose, payload, authConfig.publicWebUrl);
    const sent = await transport.sendMail({
      from: emailConfig.fromAddress,
      subject: content.subject,
      text: content.text,
      to: claim.recipient_address,
    });
    await completeEmail(claim, 'SENT', 'smtp_accepted', sent.messageId);
    logger.info(
      { delivery_id: claim.delivery_id, purpose: claim.purpose },
      'transactional email delivered',
    );
  } catch (error) {
    const code =
      error instanceof Error && Reflect.has(error, 'code')
        ? String(Reflect.get(error, 'code'))
        : 'smtp_error';
    const ambiguous = ['ECONNRESET', 'ETIMEDOUT'].includes(code);
    await completeEmail(claim, ambiguous ? 'DELIVERY_UNKNOWN' : 'RETRY', code, null);
    logger.warn(
      { delivery_id: claim.delivery_id, error_code: code, purpose: claim.purpose },
      'transactional email delivery failed',
    );
  }
  return true;
}

const deliveryState: { timer?: NodeJS.Timeout } = {};
let deliveryRunning = false;
async function pollDeliveries(): Promise<void> {
  if (deliveryRunning || stopping) return;
  deliveryRunning = true;
  try {
    while (!stopping && (await deliverOne())) {
      // Drain available jobs without delaying unrelated HTTP health checks.
    }
  } catch (error) {
    logger.error({ err: error }, 'transactional email poll failed');
  } finally {
    deliveryRunning = false;
  }
}

function payload(status: ServiceHealth['status']): ServiceHealth {
  return {
    service: config.serviceName,
    status,
    timestamp: new Date().toISOString(),
    version: config.version,
  };
}

app.get('/health/live', () => payload('ok'));
app.get('/health/ready', async (_request, reply) => {
  const ready = await isDatabaseReady(database);
  if (!ready) reply.code(503);
  return payload(ready ? 'ok' : 'unavailable');
});

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (deliveryState.timer) clearInterval(deliveryState.timer);
  logger.info({ signal }, 'shutting down');
  await app.close();
  await database.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void stop(signal).then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
deliveryState.timer = setInterval(() => void pollDeliveries(), emailConfig.pollIntervalMs);
deliveryState.timer.unref();
void pollDeliveries();
