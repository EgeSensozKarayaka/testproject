import { z } from 'zod';

const runtimeEnvironmentSchema = z.enum(['development', 'test', 'production']);

export interface RuntimeDefaults {
  defaultPort: number;
  serviceName: string;
}

export interface RuntimeConfig {
  host: string;
  nodeEnv: z.infer<typeof runtimeEnvironmentSchema>;
  port: number;
  serviceName: string;
  version: string;
}

export function loadRuntimeConfig(
  defaults: RuntimeDefaults,
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const schema = z.object({
    HOST: z.string().min(1).default('0.0.0.0'),
    NODE_ENV: runtimeEnvironmentSchema.default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(defaults.defaultPort),
    SERVICE_NAME: z.string().min(1).default(defaults.serviceName),
    SERVICE_VERSION: z.string().min(1).default('0.1.0'),
  });
  const parsed = schema.parse(environment);

  return {
    host: parsed.HOST,
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    serviceName: parsed.SERVICE_NAME,
    version: parsed.SERVICE_VERSION,
  };
}

export function loadDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  return z
    .string()
    .url()
    .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
      message: 'DATABASE_URL must use the postgres or postgresql scheme',
    })
    .parse(environment.DATABASE_URL);
}

export interface ResourceRuntimeConfig {
  checksPerOwnerLimit: number;
  groupsPerOwnerLimit: number;
  maintenanceWindowsPerOwnerLimit: number;
}

function resourceLimit(value: string | undefined, fallback: number, name: string): number {
  const candidate = value ?? String(fallback);
  if (candidate === 'unlimited') return 0;
  if (!/^[1-9][0-9]*$/u.test(candidate)) {
    throw new Error(`${name} must be a positive integer or unlimited`);
  }
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive safe integer or unlimited`);
  }
  return parsed;
}

export function loadResourceRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ResourceRuntimeConfig {
  return {
    checksPerOwnerLimit: resourceLimit(
      environment.CHECKS_PER_OWNER_LIMIT,
      500,
      'CHECKS_PER_OWNER_LIMIT',
    ),
    groupsPerOwnerLimit: resourceLimit(
      environment.GROUPS_PER_OWNER_LIMIT,
      100,
      'GROUPS_PER_OWNER_LIMIT',
    ),
    maintenanceWindowsPerOwnerLimit: resourceLimit(
      environment.MAINTENANCE_WINDOWS_PER_OWNER_LIMIT,
      500,
      'MAINTENANCE_WINDOWS_PER_OWNER_LIMIT',
    ),
  };
}

export interface AuthRuntimeConfig {
  cookieSecure: boolean;
  csrfKey: Buffer;
  csrfKeyVersion: string;
  emailEncryptionKey: Buffer;
  emailEncryptionKeyVersion: string;
  publicWebUrl: string;
  rateLimitKey: Buffer;
}

function secretKey(
  environment: NodeJS.ProcessEnv,
  name: string,
  nodeEnvironment: z.infer<typeof runtimeEnvironmentSchema>,
  localFallback: string,
): Buffer {
  const encoded = environment[name];
  if (!encoded) {
    if (nodeEnvironment === 'production') throw new Error(`${name} is required in production`);
    return Buffer.from(localFallback, 'base64');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error(`${name} must be a base64-encoded 32-byte key`);
  return key;
}

export function loadAuthRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AuthRuntimeConfig {
  const nodeEnvironment = runtimeEnvironmentSchema
    .default('development')
    .parse(environment.NODE_ENV);
  const localKeys = {
    csrf: 'ERERERERERERERERERERERERERERERERERERERERERE=',
    email: 'IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI=',
    rate: 'MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM=',
  } as const;
  const parsed = z
    .object({
      AUTH_CSRF_KEY_VERSION: z.string().min(1).default('local-v1'),
      AUTH_EMAIL_KEY_VERSION: z.string().min(1).default('local-v1'),
      PUBLIC_WEB_URL: z.string().url().default('http://localhost:15173'),
    })
    .parse(environment);
  return {
    cookieSecure: nodeEnvironment === 'production',
    csrfKey: secretKey(environment, 'AUTH_CSRF_KEY_BASE64', nodeEnvironment, localKeys.csrf),
    csrfKeyVersion: parsed.AUTH_CSRF_KEY_VERSION,
    emailEncryptionKey: secretKey(
      environment,
      'AUTH_EMAIL_KEY_BASE64',
      nodeEnvironment,
      localKeys.email,
    ),
    emailEncryptionKeyVersion: parsed.AUTH_EMAIL_KEY_VERSION,
    publicWebUrl: parsed.PUBLIC_WEB_URL,
    rateLimitKey: secretKey(
      environment,
      'AUTH_RATE_LIMIT_KEY_BASE64',
      nodeEnvironment,
      localKeys.rate,
    ),
  };
}

export interface TransactionalEmailConfig {
  databasePoolSize: number;
  fromAddress: string;
  leaseSeconds: number;
  maxDispatchAttempts: number;
  messageIdDomain: string;
  pollIntervalMs: number;
  retryBaseSeconds: number;
  retryCapSeconds: number;
  shutdownGraceMs: number;
  smtpConcurrency: number;
  smtpConnectionTimeoutMs: number;
  smtpGreetingTimeoutMs: number;
  smtpHost: string;
  smtpPort: number;
  smtpSocketTimeoutMs: number;
  smtpTlsMode: 'none' | 'starttls' | 'tls';
}

export function loadTransactionalEmailConfig(
  environment: NodeJS.ProcessEnv = process.env,
): TransactionalEmailConfig {
  const parsed = z
    .object({
      AUTH_EMAIL_FROM: z
        .string()
        .min(3)
        .includes('@')
        .refine((value) => !/[\r\n]/u.test(value), 'AUTH_EMAIL_FROM cannot contain line breaks')
        .default('Site Monitor <no-reply@site-monitor.local>'),
      AUTH_EMAIL_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
      NOTIFICATION_DB_POOL_SIZE: z.coerce.number().int().min(2).max(32).default(6),
      NOTIFICATION_LEASE_SECONDS: z.coerce.number().int().min(15).max(900).default(60),
      NOTIFICATION_MAX_DISPATCH_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
      NOTIFICATION_MESSAGE_ID_DOMAIN: z
        .string()
        .regex(
          /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu,
        )
        .default('site-monitor.local'),
      NOTIFICATION_RETRY_BASE_SECONDS: z.coerce.number().int().min(1).max(3600).default(30),
      NOTIFICATION_RETRY_CAP_SECONDS: z.coerce.number().int().min(1).max(3600).default(1800),
      NOTIFICATION_SHUTDOWN_GRACE_MS: z.coerce
        .number()
        .int()
        .min(1000)
        .max(120_000)
        .default(15_000),
      NOTIFICATION_SMTP_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
      SMTP_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
      SMTP_GREETING_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
      SMTP_HOST: z.string().min(1).default('127.0.0.1'),
      SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
      SMTP_SOCKET_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(30_000),
      SMTP_TLS_MODE: z.enum(['none', 'starttls', 'tls']).default('none'),
    })
    .parse(environment);
  if (parsed.NOTIFICATION_RETRY_CAP_SECONDS < parsed.NOTIFICATION_RETRY_BASE_SECONDS) {
    throw new Error('NOTIFICATION_RETRY_CAP_SECONDS cannot be lower than the retry base');
  }
  const nodeEnvironment = runtimeEnvironmentSchema
    .default('development')
    .parse(environment.NODE_ENV);
  if (nodeEnvironment === 'production' && parsed.SMTP_TLS_MODE === 'none') {
    throw new Error('SMTP_TLS_MODE must enable TLS in production');
  }
  return {
    databasePoolSize: parsed.NOTIFICATION_DB_POOL_SIZE,
    fromAddress: parsed.AUTH_EMAIL_FROM,
    leaseSeconds: parsed.NOTIFICATION_LEASE_SECONDS,
    maxDispatchAttempts: parsed.NOTIFICATION_MAX_DISPATCH_ATTEMPTS,
    messageIdDomain: parsed.NOTIFICATION_MESSAGE_ID_DOMAIN,
    pollIntervalMs: parsed.AUTH_EMAIL_POLL_INTERVAL_MS,
    retryBaseSeconds: parsed.NOTIFICATION_RETRY_BASE_SECONDS,
    retryCapSeconds: parsed.NOTIFICATION_RETRY_CAP_SECONDS,
    shutdownGraceMs: parsed.NOTIFICATION_SHUTDOWN_GRACE_MS,
    smtpConcurrency: parsed.NOTIFICATION_SMTP_CONCURRENCY,
    smtpConnectionTimeoutMs: parsed.SMTP_CONNECTION_TIMEOUT_MS,
    smtpGreetingTimeoutMs: parsed.SMTP_GREETING_TIMEOUT_MS,
    smtpHost: parsed.SMTP_HOST,
    smtpPort: parsed.SMTP_PORT,
    smtpSocketTimeoutMs: parsed.SMTP_SOCKET_TIMEOUT_MS,
    smtpTlsMode: parsed.SMTP_TLS_MODE,
  };
}

export interface ProbeRuntimeConfig {
  allowedPorts: number[];
  connectTimeoutMs: number;
  developmentAllowedOrigins: string[];
  maxDnsResults: number;
  maxHeaderBytes: number;
  maxRedirects: number;
  maxResponseBytes: number;
  userAgent: string;
}

function commaSeparatedPorts(value: string): number[] {
  const ports = [...new Set(value.split(',').map((part) => Number(part.trim())))];
  if (
    ports.length === 0 ||
    ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)
  ) {
    throw new Error('PROBE_ALLOWED_PORTS must be a comma-separated list of TCP ports');
  }
  return ports;
}

function commaSeparatedOrigins(value: string): string[] {
  if (value.trim() === '') return [];
  return [...new Set(value.split(',').map((part) => part.trim()))].map((origin) => {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      throw new Error('PROBE_DEV_ALLOWED_ORIGINS must contain canonical HTTP(S) origins');
    }
    return origin;
  });
}

export function loadProbeRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ProbeRuntimeConfig {
  const nodeEnvironment = runtimeEnvironmentSchema
    .default('development')
    .parse(environment.NODE_ENV);
  const parsed = z
    .object({
      PROBE_ALLOWED_PORTS: z.string().default('80,443'),
      PROBE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1).max(60_000).default(10_000),
      PROBE_DEV_ALLOWED_ORIGINS: z.string().default(''),
      PROBE_MAX_DNS_RESULTS: z.coerce.number().int().min(1).max(32).default(16),
      PROBE_MAX_HEADER_BYTES: z.coerce.number().int().min(1_024).max(65_536).default(16_384),
      PROBE_MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(5),
      PROBE_MAX_RESPONSE_BYTES: z.coerce
        .number()
        .int()
        .min(1_024)
        .max(10_485_760)
        .default(1_048_576),
      PROBE_USER_AGENT: z
        .string()
        .min(1)
        .max(256)
        .refine((value) => !value.includes('\r') && !value.includes('\n'))
        .default('SiteAvailabilityMonitor/0.1'),
    })
    .parse(environment);
  const developmentAllowedOrigins = commaSeparatedOrigins(parsed.PROBE_DEV_ALLOWED_ORIGINS);
  if (nodeEnvironment === 'production' && developmentAllowedOrigins.length > 0) {
    throw new Error('PROBE_DEV_ALLOWED_ORIGINS is forbidden in production');
  }
  return {
    allowedPorts: commaSeparatedPorts(parsed.PROBE_ALLOWED_PORTS),
    connectTimeoutMs: parsed.PROBE_CONNECT_TIMEOUT_MS,
    developmentAllowedOrigins,
    maxDnsResults: parsed.PROBE_MAX_DNS_RESULTS,
    maxHeaderBytes: parsed.PROBE_MAX_HEADER_BYTES,
    maxRedirects: parsed.PROBE_MAX_REDIRECTS,
    maxResponseBytes: parsed.PROBE_MAX_RESPONSE_BYTES,
    userAgent: parsed.PROBE_USER_AGENT,
  };
}

export interface MonitorRuntimeConfig {
  candidateBatchSize: number;
  databasePoolSize: number;
  dispatchPollMs: number;
  freshnessPollMs: number;
  globalConcurrency: number;
  heartbeatMs: number;
  leaseGraceMs: number;
  perHostConcurrency: number;
  perOwnerConcurrency: number;
  recoveryPollMs: number;
  scheduleBatchSize: number;
  schedulerGraceMs: number;
  schedulerPollMs: number;
  shutdownGraceMs: number;
}

export function loadMonitorRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MonitorRuntimeConfig {
  const parsed = z
    .object({
      MONITOR_CANDIDATE_BATCH_SIZE: z.coerce.number().int().min(1).max(2_000).default(128),
      MONITOR_DB_POOL_SIZE: z.coerce.number().int().min(2).max(64).default(8),
      MONITOR_DISPATCH_POLL_MS: z.coerce.number().int().min(25).max(60_000).default(100),
      MONITOR_FRESHNESS_POLL_MS: z.coerce.number().int().min(25).max(60_000).default(250),
      MONITOR_GLOBAL_CONCURRENCY: z.coerce.number().int().min(1).max(1_000).default(64),
      MONITOR_HEARTBEAT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
      MONITOR_LEASE_GRACE_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
      MONITOR_PER_HOST_CONCURRENCY: z.coerce.number().int().min(1).max(1_000).default(4),
      MONITOR_PER_OWNER_CONCURRENCY: z.coerce.number().int().min(1).max(1_000).default(32),
      MONITOR_RECOVERY_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
      MONITOR_SCHEDULE_BATCH_SIZE: z.coerce.number().int().min(1).max(2_000).default(64),
      MONITOR_SCHEDULER_GRACE_MS: z.coerce.number().int().min(0).max(60_000).default(5_000),
      MONITOR_SCHEDULER_POLL_MS: z.coerce.number().int().min(25).max(60_000).default(250),
      MONITOR_SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
    })
    .parse(environment);

  if (parsed.MONITOR_PER_OWNER_CONCURRENCY > parsed.MONITOR_GLOBAL_CONCURRENCY) {
    throw new Error('MONITOR_PER_OWNER_CONCURRENCY cannot exceed MONITOR_GLOBAL_CONCURRENCY');
  }
  if (parsed.MONITOR_PER_HOST_CONCURRENCY > parsed.MONITOR_GLOBAL_CONCURRENCY) {
    throw new Error('MONITOR_PER_HOST_CONCURRENCY cannot exceed MONITOR_GLOBAL_CONCURRENCY');
  }
  if (parsed.MONITOR_HEARTBEAT_MS * 3 > parsed.MONITOR_LEASE_GRACE_MS) {
    throw new Error('MONITOR_HEARTBEAT_MS must be at most one third of MONITOR_LEASE_GRACE_MS');
  }
  if (parsed.MONITOR_CANDIDATE_BATCH_SIZE < parsed.MONITOR_GLOBAL_CONCURRENCY) {
    throw new Error('MONITOR_CANDIDATE_BATCH_SIZE cannot be lower than concurrency');
  }

  return {
    candidateBatchSize: parsed.MONITOR_CANDIDATE_BATCH_SIZE,
    databasePoolSize: parsed.MONITOR_DB_POOL_SIZE,
    dispatchPollMs: parsed.MONITOR_DISPATCH_POLL_MS,
    freshnessPollMs: parsed.MONITOR_FRESHNESS_POLL_MS,
    globalConcurrency: parsed.MONITOR_GLOBAL_CONCURRENCY,
    heartbeatMs: parsed.MONITOR_HEARTBEAT_MS,
    leaseGraceMs: parsed.MONITOR_LEASE_GRACE_MS,
    perHostConcurrency: parsed.MONITOR_PER_HOST_CONCURRENCY,
    perOwnerConcurrency: parsed.MONITOR_PER_OWNER_CONCURRENCY,
    recoveryPollMs: parsed.MONITOR_RECOVERY_POLL_MS,
    scheduleBatchSize: parsed.MONITOR_SCHEDULE_BATCH_SIZE,
    schedulerGraceMs: parsed.MONITOR_SCHEDULER_GRACE_MS,
    schedulerPollMs: parsed.MONITOR_SCHEDULER_POLL_MS,
    shutdownGraceMs: parsed.MONITOR_SHUTDOWN_GRACE_MS,
  };
}
