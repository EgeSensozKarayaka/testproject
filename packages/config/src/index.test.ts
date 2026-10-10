import { describe, expect, it } from 'vitest';

import { loadDatabaseUrl, loadResourceRuntimeConfig, loadRuntimeConfig } from './index.js';

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

describe('resource configuration', () => {
  it('uses deployment-safe defaults without fixing the product to 50 checks', () => {
    expect(loadResourceRuntimeConfig({})).toEqual({
      checksPerOwnerLimit: 500,
      groupsPerOwnerLimit: 100,
    });
  });

  it('supports explicit unlimited deployments and rejects ambiguous zero', () => {
    expect(
      loadResourceRuntimeConfig({
        CHECKS_PER_OWNER_LIMIT: 'unlimited',
        GROUPS_PER_OWNER_LIMIT: '250',
      }),
    ).toEqual({ checksPerOwnerLimit: 0, groupsPerOwnerLimit: 250 });
    expect(() => loadResourceRuntimeConfig({ GROUPS_PER_OWNER_LIMIT: '0' })).toThrow(
      'GROUPS_PER_OWNER_LIMIT must be a positive integer or unlimited',
    );
  });
});
