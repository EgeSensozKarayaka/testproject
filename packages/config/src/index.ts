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
  fromAddress: string;
  pollIntervalMs: number;
  smtpHost: string;
  smtpPort: number;
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
        .default('Site Monitor <no-reply@site-monitor.local>'),
      AUTH_EMAIL_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
      SMTP_HOST: z.string().min(1).default('127.0.0.1'),
      SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
    })
    .parse(environment);
  return {
    fromAddress: parsed.AUTH_EMAIL_FROM,
    pollIntervalMs: parsed.AUTH_EMAIL_POLL_INTERVAL_MS,
    smtpHost: parsed.SMTP_HOST,
    smtpPort: parsed.SMTP_PORT,
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
