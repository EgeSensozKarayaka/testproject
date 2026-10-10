import { describe, expect, it } from 'vitest';

import {
  loadDatabaseUrl,
  loadHousekeepingRuntimeConfig,
  loadHistoryRuntimeConfig,
  loadMonitorRuntimeConfig,
  loadProbeRuntimeConfig,
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
