import {
  NodeDnsResolver,
  ProbeEngine,
  UndiciPinnedTransport,
  createProbeNetworkPolicy,
} from '@site-monitor/check-engine';
import type { ProbeRuntimeConfig } from '@site-monitor/config';

export function createMonitorProbeEngine(config: ProbeRuntimeConfig): ProbeEngine {
  return new ProbeEngine(
    {
      networkPolicy: createProbeNetworkPolicy({
        allowedPorts: config.allowedPorts,
        developmentAllowedOrigins: config.developmentAllowedOrigins,
        maxDnsResults: config.maxDnsResults,
      }),
      connectTimeoutMs: config.connectTimeoutMs,
      maxHeaderBytes: config.maxHeaderBytes,
      maxRedirects: config.maxRedirects,
      maxResponseBytes: config.maxResponseBytes,
      userAgent: config.userAgent,
    },
    {
      resolver: new NodeDnsResolver(),
      transport: new UndiciPinnedTransport(),
    },
  );
}
