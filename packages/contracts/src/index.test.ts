import { describe, expect, it } from 'vitest';

import { serviceHealthSchema } from './index.js';

describe('serviceHealthSchema', () => {
  it('accepts a valid health response', () => {
    const value = {
      service: 'api',
      status: 'ok',
      timestamp: '2026-10-09T17:00:00.000Z',
      version: '0.1.0',
    };

    expect(serviceHealthSchema.parse(value)).toEqual(value);
  });
});
