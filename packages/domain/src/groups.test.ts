import { describe, expect, it } from 'vitest';

import {
  classifyGroupChanges,
  normalizeGroupConfiguration,
  normalizeGroupDescription,
} from './groups.js';

describe('group configuration policy', () => {
  it('normalizes names and blank descriptions', () => {
    expect(normalizeGroupConfiguration({ description: '   ', name: '  Production  ' })).toEqual({
      description: null,
      name: 'Production',
    });
  });

  it('uses NFC for human-readable fields', () => {
    expect(normalizeGroupDescription('  Cafe\u0301  ')).toBe('Café');
  });

  it('rejects descriptions over 1000 code points', () => {
    expect(() => normalizeGroupDescription('a'.repeat(1001))).toThrow(/1000 characters/u);
  });

  it('classifies group updates and normalized no-ops', () => {
    const current = { description: null, name: 'Production' };
    expect(classifyGroupChanges(current, { description: 'Primary sites' })).toEqual({
      changedFields: ['description'],
      next: { description: 'Primary sites', name: 'Production' },
      noop: false,
    });
    expect(classifyGroupChanges(current, { description: ' ', name: ' Production ' })).toEqual({
      changedFields: [],
      next: current,
      noop: true,
    });
  });
});
