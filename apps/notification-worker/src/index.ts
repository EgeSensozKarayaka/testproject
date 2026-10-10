import { createHash, randomUUID } from 'node:crypto';

import { decryptJson } from '@site-monitor/auth';
import {
  loadAuthRuntimeConfig,
  loadDatabaseUrl,
  loadRuntimeConfig,
  loadTransactionalEmailConfig,
} from '@site-monitor/config';
import type { ServiceHealth } from '@site-monitor/contracts';
import { createDatabasePool, isDatabaseReady } from '@site-monitor/database';
import {
  classifySmtpFailure,
  notificationRetryDelaySeconds,
  renderIncidentEmail,
} from '@site-monitor/notifications';
import { createLogger } from '@site-monitor/observability';
import Fastify from 'fastify';
import nodemailer from 'nodemailer';

import {
  transactionalEmailContent,
  type SecretEmailPayload,
  type TransactionalEmailPurpose,
} from './email-content.js';
import {
  IncidentNotificationStore,
  type ClaimedIncidentDelivery,
} from './incident-notification-store.js';

const config = loadRuntimeConfig({ defaultPort: 3012, serviceName: 'notification-worker' });
const emailConfig = loadTransactionalEmailConfig();
const logger = createLogger({
  environment: config.nodeEnv,
  service: config.serviceName,
  version: config.version,
});
const database = createDatabasePool({
  applicationName: config.serviceName,
  connectionString: loadDatabaseUrl(),
  databaseRole: 'site_monitor_notifier',
  maxConnections: emailConfig.databasePoolSize,
});
const app = Fastify({ loggerInstance: logger });
const authConfig = loadAuthRuntimeConfig();
const workerId = `${config.serviceName}:${randomUUID()}`;
const transport = nodemailer.createTransport({
  connectionTimeout: emailConfig.smtpConnectionTimeoutMs,
  greetingTimeout: emailConfig.smtpGreetingTimeoutMs,
  host: emailConfig.smtpHost,
  port: emailConfig.smtpPort,
  requireTLS: emailConfig.smtpTlsMode === 'starttls',
  secure: emailConfig.smtpTlsMode === 'tls',
  socketTimeout: emailConfig.smtpSocketTimeoutMs,
});
const incidentStore = new IncidentNotificationStore(
  database,
  workerId,
  emailConfig.leaseSeconds,
  emailConfig.maxDispatchAttempts,
);

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

function retrySeconds(deliveryId: string, attempt: number): number {
  return notificationRetryDelaySeconds(
    deliveryId,
    attempt,
    emailConfig.retryBaseSeconds,
    emailConfig.retryCapSeconds,
  );
}

function providerReference(value: string | undefined): string | null {
  return value ? createHash('sha256').update(value).digest('hex') : null;
}

async function completeEmail(
  claim: ClaimedEmail,
  result: 'DELIVERY_UNKNOWN' | 'FAILED' | 'RETRY' | 'SENT',
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
    retrySeconds(claim.delivery_id, claim.attempt_count),
  ]);
}

async function deliverTransactionalOne(): Promise<boolean> {
  const result = await database.query<ClaimedEmail>(
    'SELECT * FROM security_api.claim_transactional_email($1,$2)',
    [workerId, emailConfig.leaseSeconds],
  );
  const claim = result.rows[0];
  if (!claim) return false;

  try {
    const secretPayload = decryptJson<SecretEmailPayload>(
      {
        ciphertext: claim.encrypted_payload,
        initializationVector: claim.encryption_iv,
        keyVersion: claim.encryption_key_version,
        tag: claim.encryption_tag,
      },
      [{ key: authConfig.emailEncryptionKey, version: authConfig.emailEncryptionKeyVersion }],
    );
    const content = transactionalEmailContent(
      claim.purpose,
      secretPayload,
      authConfig.publicWebUrl,
    );
    const sent = await transport.sendMail({
      from: emailConfig.fromAddress,
      html: content.html,
      messageId: `<transactional.${claim.delivery_id}@${emailConfig.messageIdDomain}>`,
      subject: content.subject,
      text: content.text,
      to: claim.recipient_address,
    });
    await completeEmail(claim, 'SENT', 'smtp_accepted', providerReference(sent.messageId));
    logger.info(
      { delivery_id: claim.delivery_id, purpose: claim.purpose },
      'transactional email delivered',
    );
  } catch (error) {
    const classified = classifySmtpFailure(error);
    await completeEmail(claim, classified.result, classified.code, null);
    logger.warn(
      {
        delivery_id: claim.delivery_id,
        purpose: claim.purpose,
        result: classified.result,
        result_code: classified.code,
      },
      'transactional email delivery failed',
    );
  }
  return true;
}

async function deliverIncidentOne(): Promise<boolean> {
  const claim: ClaimedIncidentDelivery | undefined = await incidentStore.claimDelivery();
  if (!claim) return false;
  try {
    const content = renderIncidentEmail(
      claim.template_key,
      claim.template_version,
      claim.template_payload,
    );
    const sent = await transport.sendMail({
      from: emailConfig.fromAddress,
      html: content.html,
      messageId: `<incident.${claim.delivery_id}@${emailConfig.messageIdDomain}>`,
      subject: content.subject,
      text: content.text,
      to: claim.recipient_address,
    });
    await incidentStore.completeDelivery(
      claim,
      'SENT',
      'smtp_accepted',
      providerReference(sent.messageId),
      retrySeconds(claim.delivery_id, claim.attempt_count),
    );
    logger.info(
      { delivery_id: claim.delivery_id, event_kind: claim.event_kind },
      'incident notification delivered',
    );
  } catch (error) {
    const classified = classifySmtpFailure(error);
    await incidentStore.completeDelivery(
      claim,
      classified.result,
      classified.code,
      null,
      retrySeconds(claim.delivery_id, claim.attempt_count),
    );
    logger.warn(
      {
        delivery_id: claim.delivery_id,
        event_kind: claim.event_kind,
        result: classified.result,
        result_code: classified.code,
      },
      'incident notification delivery failed',
    );
  }
  return true;
}

const successfulLoops = new Set<string>();
let lastLoopError: string | null = null;
let preferTransactional = true;
let stopping = false;
let pollPromise: Promise<void> | undefined;
const deliveryState: { timer?: NodeJS.Timeout } = {};

async function runSmtpSlot(startWithTransactional: boolean): Promise<void> {
  let transactionalFirst = startWithTransactional;
  while (!stopping) {
    const primary = transactionalFirst ? deliverTransactionalOne : deliverIncidentOne;
    const secondary = transactionalFirst ? deliverIncidentOne : deliverTransactionalOne;
    let worked = await primary();
    if (!worked) worked = await secondary();
    successfulLoops.add('transactional-delivery');
    successfulLoops.add('incident-delivery');
    if (!worked) return;
    transactionalFirst = !transactionalFirst;
  }
}

async function pollWork(): Promise<void> {
  if (pollPromise || stopping) return;
  pollPromise = (async () => {
    try {
      const reconciled = await incidentStore.reconcileOpenIncidents();
      if (reconciled > 0) {
        logger.info({ reconciled_incident_count: reconciled }, 'open incidents reconciled');
      }
      for (let index = 0; index < 100 && !stopping; index += 1) {
        if (!(await incidentStore.consumeDispatch())) break;
      }
      successfulLoops.add('outbox');
      for (let index = 0; index < 100 && !stopping; index += 1) {
        if (!(await incidentStore.evaluateIntent())) break;
      }
      successfulLoops.add('intent');
      const slotStart = preferTransactional;
      preferTransactional = !preferTransactional;
      await Promise.all(
        Array.from({ length: emailConfig.smtpConcurrency }, (_, index) =>
          runSmtpSlot(index % 2 === 0 ? slotStart : !slotStart),
        ),
      );
      lastLoopError = null;
    } catch (error) {
      lastLoopError = error instanceof Error ? error.name : 'unknown_error';
      logger.error({ err: error }, 'notification worker poll failed');
    }
  })().finally(() => {
    pollPromise = undefined;
  });
  await pollPromise;
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
  const databaseReady = await isDatabaseReady(database);
  const loopsReady = successfulLoops.size === 4 && lastLoopError === null;
  const ready = databaseReady && loopsReady;
  if (!ready) reply.code(503);
  return payload(ready ? 'ok' : 'unavailable');
});

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (deliveryState.timer) clearInterval(deliveryState.timer);
  logger.info({ signal }, 'shutting down');
  await app.close();
  if (pollPromise) {
    await Promise.race([
      pollPromise,
      new Promise<void>((resolve) => setTimeout(resolve, emailConfig.shutdownGraceMs)),
    ]);
  }
  transport.close();
  await database.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void stop(signal).then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
deliveryState.timer = setInterval(() => void pollWork(), emailConfig.pollIntervalMs);
deliveryState.timer.unref();
void pollWork();
