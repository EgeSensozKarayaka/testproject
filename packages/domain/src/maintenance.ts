import { DomainValidationError } from './checks.js';

const MAX_NOTE_CODE_POINTS = 1000;

export type MaintenanceEffectiveState = 'ACTIVE' | 'CANCELLED' | 'ENDED' | 'UPCOMING';
export type MaintenanceStoredState = 'CANCELLED' | 'SCHEDULED';

export interface MaintenanceConfiguration {
  endsAt: Date;
  note: string | null;
  startsAt: Date;
}

export interface MaintenanceConfigurationInput {
  endsAt: Date;
  note?: string | null;
  startsAt: Date;
}

export interface MaintenanceConfigurationPatch {
  endsAt?: Date;
  note?: string | null;
  startsAt?: Date;
}

export interface MaintenanceChangeSet {
  changedFields: string[];
  next: MaintenanceConfiguration;
  noop: boolean;
}

export interface MaintenanceWindowProjectionInput extends MaintenanceConfiguration {
  checkId: string | null;
  groupId: string | null;
  storedState: MaintenanceStoredState;
}

export class MaintenanceWindowImmutableError extends Error {
  readonly code = 'maintenance_window_immutable';
}

function fail(field: string, code: string, message: string): never {
  throw new DomainValidationError(field, code, message);
}

function copyValidInstant(value: Date, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    fail(field, 'invalid_instant', `${field} must be a valid timestamp.`);
  }
  return new Date(value.getTime());
}

function trimAsciiWhitespace(value: string): string {
  return value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu, '');
}

export function normalizeMaintenanceNote(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = trimAsciiWhitespace(value).normalize('NFC');
  if (normalized === '') return null;
  if (Array.from(normalized).length > MAX_NOTE_CODE_POINTS) {
    fail('note', 'invalid_length', 'note must not exceed 1000 characters.');
  }
  return normalized;
}

function assertRange(startsAt: Date, endsAt: Date, evaluatedAt: Date): void {
  if (endsAt.getTime() <= startsAt.getTime()) {
    fail('ends_at', 'invalid_range', 'ends_at must be later than starts_at.');
  }
  if (endsAt.getTime() <= evaluatedAt.getTime()) {
    fail('ends_at', 'not_in_future', 'ends_at must be later than the current database time.');
  }
}

export function normalizeMaintenanceConfiguration(
  input: MaintenanceConfigurationInput,
  evaluatedAt: Date,
): MaintenanceConfiguration {
  const now = copyValidInstant(evaluatedAt, 'evaluated_at');
  const startsAt = copyValidInstant(input.startsAt, 'starts_at');
  const endsAt = copyValidInstant(input.endsAt, 'ends_at');
  assertRange(startsAt, endsAt, now);
  return { endsAt, note: normalizeMaintenanceNote(input.note), startsAt };
}

export function deriveMaintenanceState(
  input: Pick<MaintenanceWindowProjectionInput, 'endsAt' | 'startsAt' | 'storedState'>,
  evaluatedAt: Date,
): MaintenanceEffectiveState {
  const now = copyValidInstant(evaluatedAt, 'evaluated_at');
  const startsAt = copyValidInstant(input.startsAt, 'starts_at');
  const endsAt = copyValidInstant(input.endsAt, 'ends_at');
  if (endsAt.getTime() <= startsAt.getTime()) {
    fail('ends_at', 'invalid_range', 'ends_at must be later than starts_at.');
  }
  if (input.storedState === 'CANCELLED') return 'CANCELLED';
  if (now.getTime() < startsAt.getTime()) return 'UPCOMING';
  if (now.getTime() < endsAt.getTime()) return 'ACTIVE';
  return 'ENDED';
}

export function classifyMaintenanceChanges(
  current: MaintenanceConfiguration,
  storedState: MaintenanceStoredState,
  patch: MaintenanceConfigurationPatch,
  evaluatedAt: Date,
): MaintenanceChangeSet {
  const effectiveState = deriveMaintenanceState({ ...current, storedState }, evaluatedAt);
  if (effectiveState === 'CANCELLED' || effectiveState === 'ENDED') {
    throw new MaintenanceWindowImmutableError('Ended or cancelled maintenance cannot be changed.');
  }

  const next: MaintenanceConfiguration = {
    endsAt: Object.hasOwn(patch, 'endsAt')
      ? copyValidInstant(patch.endsAt!, 'ends_at')
      : new Date(current.endsAt.getTime()),
    note: Object.hasOwn(patch, 'note') ? normalizeMaintenanceNote(patch.note) : current.note,
    startsAt: Object.hasOwn(patch, 'startsAt')
      ? copyValidInstant(patch.startsAt!, 'starts_at')
      : new Date(current.startsAt.getTime()),
  };

  if (effectiveState === 'ACTIVE' && next.startsAt.getTime() !== current.startsAt.getTime()) {
    throw new MaintenanceWindowImmutableError('The start of active maintenance cannot be changed.');
  }
  assertRange(next.startsAt, next.endsAt, copyValidInstant(evaluatedAt, 'evaluated_at'));

  const changedFields = [
    ...(current.endsAt.getTime() === next.endsAt.getTime() ? [] : ['ends_at']),
    ...(current.note === next.note ? [] : ['note']),
    ...(current.startsAt.getTime() === next.startsAt.getTime() ? [] : ['starts_at']),
  ];
  return { changedFields, next, noop: changedFields.length === 0 };
}

export function projectMaintenanceForCheck(
  windows: MaintenanceWindowProjectionInput[],
  input: { checkId: string; evaluatedAt: Date; groupId: string | null },
): { active: boolean; until: Date | null } {
  const evaluatedAt = copyValidInstant(input.evaluatedAt, 'evaluated_at');
  let until: Date | null = null;

  for (const window of windows) {
    const targetsCheck = window.checkId === input.checkId;
    const targetsCurrentGroup =
      input.groupId !== null && window.groupId !== null && window.groupId === input.groupId;
    if (!targetsCheck && !targetsCurrentGroup) continue;
    if (deriveMaintenanceState(window, evaluatedAt) !== 'ACTIVE') continue;
    if (until === null || window.endsAt.getTime() > until.getTime()) {
      until = new Date(window.endsAt.getTime());
    }
  }

  return { active: until !== null, until };
}
