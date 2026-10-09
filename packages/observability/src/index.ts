import pino, { type Logger, type LoggerOptions } from 'pino';

const redactPaths = [
  'password',
  '*.password',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'DATABASE_URL',
  '*.DATABASE_URL',
];

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
  };

  return pino(options);
}
