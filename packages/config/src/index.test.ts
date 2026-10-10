import { describe, expect, it } from 'vitest';

import {
  loadApiRealtimeRuntimeConfig,
  loadDatabaseUrl,
  loadHousekeepingRuntimeConfig,
  loadHistoryRuntimeConfig,
  loadMonitorRuntimeConfig,
  loadProbeRuntimeConfig,
  loadRealtimeRuntimeConfig,
  loadResourceRuntimeConfig,
  loadRuntimeConfig,
} from './index.js';

describe('configuration', () => {
  it('uses explicit defaults and validates numeric ports', () => {
    expect(loadRuntimeConfig({ defaultPort: 3000, serviceName: 'api' }, {})).toEqual({
      host: '0.0.0.0',
      nodeEnv: 'development',
      port: 3000,
      serviceName: 'api',
      version: '0.1.0',
    });
  });

  it('rejects non-PostgreSQL database URLs', () => {
    expect(() => loadDatabaseUrl({ DATABASE_URL: 'https://example.com' })).toThrow(
      'DATABASE_URL must use the postgres or postgresql scheme',
    );
  });
});

describe('history API configuration', () => {
  it('uses bounded raw-tail and query defaults', () => {
    expect(loadHistoryRuntimeConfig({})).toEqual({
      cursorTtlSeconds: 900,
      hourRawTailSeconds: 7_200,
      minuteRawTailSeconds: 900,
      retryAfterSeconds: 5,
      statementTimeoutMs: 2_000,
    });
  });

  it('rejects an unbounded raw tail or statement timeout', () => {
    expect(() => loadHistoryRuntimeConfig({ HISTORY_MINUTE_RAW_TAIL_SECONDS: '3601' })).toThrow();
    expect(() => loadHistoryRuntimeConfig({ HISTORY_STATEMENT_TIMEOUT_MS: '10001' })).toThrow();
  });
});

describe('monitor worker configuration', () => {
  it('uses bounded defaults that are independent from the check count', () => {
    expect(loadMonitorRuntimeConfig({})).toEqual({
      candidateBatchSize: 128,
      databasePoolSize: 8,
      dispatchPollMs: 100,
      freshnessPollMs: 250,
      globalConcurrency: 64,
      heartbeatMs: 5_000,
      leaseGraceMs: 15_000,
      perHostConcurrency: 4,
      perOwnerConcurrency: 32,
      recoveryPollMs: 1_000,
      scheduleBatchSize: 64,
      schedulerGraceMs: 5_000,
      schedulerPollMs: 250,
      shutdownGraceMs: 30_000,
    });
  });

  it('rejects inconsistent concurrency and lease timing', () => {
    expect(() =>
      loadMonitorRuntimeConfig({
        MONITOR_GLOBAL_CONCURRENCY: '8',
        MONITOR_PER_OWNER_CONCURRENCY: '9',
      }),
    ).toThrow('MONITOR_PER_OWNER_CONCURRENCY cannot exceed');
    expect(() =>
      loadMonitorRuntimeConfig({
        MONITOR_HEARTBEAT_MS: '5001',
        MONITOR_LEASE_GRACE_MS: '15000',
      }),
    ).toThrow('MONITOR_HEARTBEAT_MS must be at most one third');
    expect(() =>
      loadMonitorRuntimeConfig({
        MONITOR_CANDIDATE_BATCH_SIZE: '8',
        MONITOR_GLOBAL_CONCURRENCY: '16',
        MONITOR_PER_OWNER_CONCURRENCY: '8',
      }),
    ).toThrow('MONITOR_CANDIDATE_BATCH_SIZE cannot be lower than concurrency');
  });
});

describe('housekeeping worker configuration', () => {
  it('uses bounded defaults for every independent loop', () => {
    expect(loadHousekeepingRuntimeConfig({})).toEqual({
      databasePoolSize: 4,
      discoveryBatchSize: 500,
      discoveryPollMs: 1_000,
      partitionPollMs: 60_000,
      purgeBatchSize: 250,
      retentionPollMs: 30_000,
      rollupBucketBatchSize: 60,
      rollupPollMs: 250,
      shutdownGraceMs: 30_000,
    });
  });

  it('rejects unbounded batches and hot DDL loops', () => {
    expect(() =>
      loadHousekeepingRuntimeConfig({ HOUSEKEEPING_ROLLUP_BUCKET_BATCH_SIZE: '1441' }),
    ).toThrow();
    expect(() =>
      loadHousekeepingRuntimeConfig({ HOUSEKEEPING_PARTITION_POLL_MS: '999' }),
    ).toThrow();
  });
});

describe('realtime worker configuration', () => {
  it('uses bounded relay defaults', () => {
    expect(loadRealtimeRuntimeConfig({})).toEqual({
      batchSize: 100,
      databasePoolSize: 4,
      leaseSeconds: 30,
      maxDispatchAttempts: 5,
      pollMs: 100,
      retryBaseSeconds: 2,
      retryCapSeconds: 60,
      shutdownGraceMs: 15_000,
    });
  });

  it('rejects an inverted retry range and unbounded batch', () => {
    expect(() =>
      loadRealtimeRuntimeConfig({
        REALTIME_RETRY_BASE_SECONDS: '60',
        REALTIME_RETRY_CAP_SECONDS: '30',
      }),
    ).toThrow('REALTIME_RETRY_CAP_SECONDS cannot be lower');
    expect(() => loadRealtimeRuntimeConfig({ REALTIME_BATCH_SIZE: '1001' })).toThrow();
  });
});

describe('API realtime configuration', () => {
  it('uses bounded connection, queue and lifecycle defaults', () => {
    expect(loadApiRealtimeRuntimeConfig({})).toEqual({
      globalConnectionLimit: 1_000,
      heartbeatMs: 15_000,
      ipConnectionLimit: 50,
      listenerGraceMs: 5_000,
      ownerConnectionLimit: 20,
      projectionConcurrency: 8,
      projectionQueueLimit: 2_048,
      queueByteLimit: 1_048_576,
      queueEventLimit: 256,
      sessionConnectionLimit: 5,
      sessionRevalidateBatchSize: 100,
      sessionRevalidateMs: 60_000,
      shutdownGraceMs: 5_000,
    });
  });

  it('rejects limits that cannot be enforced hierarchically', () => {
    expect(() =>
      loadApiRealtimeRuntimeConfig({
        REALTIME_API_OWNER_CONNECTION_LIMIT: '10',
        REALTIME_API_SESSION_CONNECTION_LIMIT: '11',
      }),
    ).toThrow('SESSION_CONNECTION_LIMIT cannot exceed');
    expect(() =>
      loadApiRealtimeRuntimeConfig({
        REALTIME_API_GLOBAL_CONNECTION_LIMIT: '20',
        REALTIME_API_IP_CONNECTION_LIMIT: '21',
      }),
    ).toThrow('IP_CONNECTION_LIMIT cannot exceed');
  });
});

describe('resource configuration', () => {
  it('uses deployment-safe defaults without fixing the product to 50 checks', () => {
    expect(loadResourceRuntimeConfig({})).toEqual({
      checksPerOwnerLimit: 500,
      groupsPerOwnerLimit: 100,
      maintenanceWindowsPerOwnerLimit: 500,
    });
  });

  it('supports explicit unlimited deployments and rejects ambiguous zero', () => {
    expect(
      loadResourceRuntimeConfig({
        CHECKS_PER_OWNER_LIMIT: 'unlimited',
        GROUPS_PER_OWNER_LIMIT: '250',
        MAINTENANCE_WINDOWS_PER_OWNER_LIMIT: 'unlimited',
      }),
    ).toEqual({
      checksPerOwnerLimit: 0,
      groupsPerOwnerLimit: 250,
      maintenanceWindowsPerOwnerLimit: 0,
    });
    expect(() => loadResourceRuntimeConfig({ GROUPS_PER_OWNER_LIMIT: '0' })).toThrow(
      'GROUPS_PER_OWNER_LIMIT must be a positive integer or unlimited',
    );
    expect(() => loadResourceRuntimeConfig({ MAINTENANCE_WINDOWS_PER_OWNER_LIMIT: '0' })).toThrow(
      'MAINTENANCE_WINDOWS_PER_OWNER_LIMIT must be a positive integer or unlimited',
    );
  });
});

describe('probe configuration', () => {
  it('uses bounded public-only defaults', () => {
    expect(loadProbeRuntimeConfig({})).toEqual({
      allowedPorts: [80, 443],
      connectTimeoutMs: 10_000,
      developmentAllowedOrigins: [],
      maxDnsResults: 16,
      maxHeaderBytes: 16_384,
      maxRedirects: 5,
      maxResponseBytes: 1_048_576,
      userAgent: 'SiteAvailabilityMonitor/0.1',
    });
  });

  it('accepts an exact local origin only outside production', () => {
    expect(
      loadProbeRuntimeConfig({
        NODE_ENV: 'development',
        PROBE_ALLOWED_PORTS: '80,443,4010',
        PROBE_DEV_ALLOWED_ORIGINS: 'http://target-simulator:4010',
      }),
    ).toMatchObject({
      allowedPorts: [80, 443, 4010],
      developmentAllowedOrigins: ['http://target-simulator:4010'],
    });
    expect(() =>
      loadProbeRuntimeConfig({
        NODE_ENV: 'production',
        PROBE_DEV_ALLOWED_ORIGINS: 'http://target-simulator:4010',
      }),
    ).toThrow('PROBE_DEV_ALLOWED_ORIGINS is forbidden in production');
  });

  it('rejects malformed ports, origins and header injection', () => {
    expect(() => loadProbeRuntimeConfig({ PROBE_ALLOWED_PORTS: '80,nope' })).toThrow();
    expect(() =>
      loadProbeRuntimeConfig({ PROBE_DEV_ALLOWED_ORIGINS: 'http://example.com/path' }),
    ).toThrow();
    expect(() =>
      loadProbeRuntimeConfig({ PROBE_USER_AGENT: 'monitor\r\nX-Test: injected' }),
    ).toThrow();
  });
});
