import { describe, expect, it, vi } from 'vitest';

import { dropTestDatabase } from './testing.js';

describe('test database cleanup', () => {
  it('retries a graceful drop while closing clients are still visible', async () => {
    const objectInUse = Object.assign(new Error('database is being accessed'), { code: '55006' });
    const query = vi
      .fn<(statement: string) => Promise<unknown>>()
      .mockRejectedValueOnce(objectInUse)
      .mockResolvedValueOnce(undefined);

    await dropTestDatabase({ query }, 'site_monitor_cleanup_test', {
      retryDelayMs: 0,
      timeoutMs: 1_000,
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith('DROP DATABASE IF EXISTS "site_monitor_cleanup_test"');
    expect(query.mock.calls[0]?.[0]).not.toContain('FORCE');
  });

  it('does not retry unrelated PostgreSQL errors', async () => {
    const denied = Object.assign(new Error('permission denied'), { code: '42501' });
    const query = vi.fn<(statement: string) => Promise<unknown>>().mockRejectedValue(denied);

    await expect(
      dropTestDatabase({ query }, 'site_monitor_cleanup_test', {
        retryDelayMs: 0,
        timeoutMs: 1_000,
      }),
    ).rejects.toBe(denied);
    expect(query).toHaveBeenCalledOnce();
  });
});
