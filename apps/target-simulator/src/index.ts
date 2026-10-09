import { loadRuntimeConfig } from '@site-monitor/config';
import { createLogger } from '@site-monitor/observability';

import { buildTargetSimulator } from './app.js';

const config = loadRuntimeConfig({ defaultPort: 4010, serviceName: 'target-simulator' });
const logger = createLogger({
  environment: config.nodeEnv,
  service: config.serviceName,
  version: config.version,
});
const app = buildTargetSimulator(logger);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down');
  await app.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void stop(signal).then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
