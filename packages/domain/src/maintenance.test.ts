import { describe, expect, it } from 'vitest';

import { DomainValidationError } from './checks.js';
import {
  MaintenanceWindowImmutableError,
  classifyMaintenanceChanges,
  deriveMaintenanceState,
  normalizeMaintenanceConfiguration,
  normalizeMaintenanceNote,
  projectMaintenanceForCheck,
  type MaintenanceWindowProjectionInput,
} from './maintenance.js';

const at = new Date('2026-10-10T10:00:00.000Z');
const startsAt = new Date('2026-10-10T10:01:00.000Z');
const endsAt = new Date('2026-10-10T11:00:00.000Z');

function window(
  overrides: Partial<MaintenanceWindowProjectionInput> = {},
): MaintenanceWindowProjectionInput {
  return {
    checkId: 'check-a',
    endsAt,
    groupId: null,
    note: null,
    startsAt,
    storedState: 'SCHEDULED',
    ...overrides,
  };
}

describe('maintenance policy', () => {
  it('uses exact half-open boundaries and keeps cancellation dominant', () => {
    const input = window();
    expect(deriveMaintenanceState(input, new Date(startsAt.getTime() - 1))).toBe('UPCOMING');
    expect(deriveMaintenanceState(input, startsAt)).toBe('ACTIVE');
    expect(deriveMaintenanceState(input, new Date(endsAt.getTime() - 1))).toBe('ACTIVE');
    expect(deriveMaintenanceState(input, endsAt)).toBe('ENDED');
    expect(deriveMaintenanceState({ ...input, storedState: 'CANCELLED' }, startsAt)).toBe(
      'CANCELLED',
    );
  });

  it('normalizes notes and validates create ranges against evaluation time', () => {
    expect(normalizeMaintenanceNote('  Cafe\u0301  ')).toBe('Café');
    expect(normalizeMaintenanceNote('   ')).toBeNull();
    expect(() => normalizeMaintenanceNote('a'.repeat(1001))).toThrow(DomainValidationError);
    expect(normalizeMaintenanceConfiguration({ endsAt, startsAt }, at)).toEqual({
      endsAt,
      note: null,
      startsAt,
    });
    expect(() => normalizeMaintenanceConfiguration({ endsAt: at, startsAt }, at)).toThrow(
      /later than starts_at/u,
    );
    expect(() =>
      normalizeMaintenanceConfiguration({ endsAt: startsAt, startsAt: endsAt }, at),
    ).toThrow(DomainValidationError);
  });

  it('allows upcoming edits and recognizes normalized no-ops', () => {
    const current = { endsAt, note: null, startsAt };
    const movedStart = new Date(startsAt.getTime() + 60_000);
    expect(
      classifyMaintenanceChanges(
        current,
        'SCHEDULED',
        { note: ' Deploy ', startsAt: movedStart },
        at,
      ),
    ).toEqual({
      changedFields: ['note', 'starts_at'],
      next: { endsAt, note: 'Deploy', startsAt: movedStart },
      noop: false,
    });
    expect(classifyMaintenanceChanges(current, 'SCHEDULED', { note: ' ' }, at)).toMatchObject({
      changedFields: [],
      noop: true,
    });
  });

  it('allows active end changes but rejects start changes and immutable history', () => {
    const activeAt = new Date(startsAt.getTime() + 1);
    const current = { endsAt, note: null, startsAt };
    expect(
      classifyMaintenanceChanges(
        current,
        'SCHEDULED',
        { endsAt: new Date(endsAt.getTime() + 60_000) },
        activeAt,
      ).changedFields,
    ).toEqual(['ends_at']);
    expect(() =>
      classifyMaintenanceChanges(
        current,
        'SCHEDULED',
        { startsAt: new Date(startsAt.getTime() + 1) },
        activeAt,
      ),
    ).toThrow(MaintenanceWindowImmutableError);
    expect(() =>
      classifyMaintenanceChanges(current, 'SCHEDULED', { note: 'late' }, endsAt),
    ).toThrow(MaintenanceWindowImmutableError);
    expect(() =>
      classifyMaintenanceChanges(current, 'CANCELLED', { note: 'late' }, activeAt),
    ).toThrow(MaintenanceWindowImmutableError);
  });

  it('projects the union of direct and current-group windows', () => {
    const evaluatedAt = new Date(startsAt.getTime() + 1);
    const directEnd = new Date(endsAt.getTime() + 60_000);
    const groupEnd = new Date(endsAt.getTime() + 120_000);
    const result = projectMaintenanceForCheck(
      [
        window({ endsAt: directEnd }),
        window({ checkId: null, endsAt: groupEnd, groupId: 'group-current' }),
        window({ checkId: null, endsAt: new Date(groupEnd.getTime() + 60_000), groupId: 'old' }),
        window({ endsAt: new Date(groupEnd.getTime() + 120_000), storedState: 'CANCELLED' }),
      ],
      { checkId: 'check-a', evaluatedAt, groupId: 'group-current' },
    );
    expect(result).toEqual({ active: true, until: groupEnd });
    expect(
      projectMaintenanceForCheck([], {
        checkId: 'check-a',
        evaluatedAt,
        groupId: 'group-current',
      }),
    ).toEqual({ active: false, until: null });
  });
});
