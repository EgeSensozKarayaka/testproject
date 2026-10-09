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
