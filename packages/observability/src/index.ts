import pino, { type Logger, type LoggerOptions } from 'pino';

const redactPaths = [
  'password',
  '*.password',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'token',
  '*.token',
  'csrf_token',
  '*.csrf_token',
  'DATABASE_URL',
  '*.DATABASE_URL',
];

function redactSensitiveUrl(url: string | undefined): string | undefined {
  return url?.replace(
    /\/api\/public\/v1\/status-pages\/[^/?#]+/g,
    '/api/public/v1/status-pages/:public_token',
  );
}

export interface LoggerContext {
  environment: string;
  service: string;
  version: string;
}

export function createLogger(context: LoggerContext): Logger {
  const options: LoggerOptions = {
    base: {
      environment: context.environment,
      service: context.service,
      version: context.version,
    },
    level: process.env.LOG_LEVEL ?? (context.environment === 'test' ? 'silent' : 'info'),
    redact: {
      censor: '[REDACTED]',
      paths: redactPaths,
    },
    serializers: {
      req(request: {
        headers?: { host?: string };
        method?: string;
        remoteAddress?: string;
        remotePort?: number;
        url?: string;
      }) {
        return {
          host: request.headers?.host,
          method: request.method,
          remoteAddress: request.remoteAddress,
          remotePort: request.remotePort,
          url: redactSensitiveUrl(request.url),
        };
      },
    },
  };

  return pino(options);
}
