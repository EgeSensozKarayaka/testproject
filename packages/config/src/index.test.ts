import { describe, expect, it } from 'vitest';

import { loadDatabaseUrl, loadRuntimeConfig } from './index.js';

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
