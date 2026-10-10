import { DomainValidationError, normalizeResourceName } from './checks.js';

export interface GroupConfiguration {
  description: string | null;
  name: string;
}

export interface GroupConfigurationInput {
  description?: string | null;
  name: string;
}

export interface GroupConfigurationPatch {
  description?: string | null;
  name?: string;
}

export interface GroupChangeSet {
  changedFields: string[];
  next: GroupConfiguration;
  noop: boolean;
}

function trimAsciiWhitespace(value: string): string {
  return value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu, '');
}

export function normalizeGroupDescription(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = trimAsciiWhitespace(value).normalize('NFC');
  if (normalized === '') return null;
  if (Array.from(normalized).length > 1000) {
    throw new DomainValidationError(
      'description',
      'invalid_length',
      'description must not exceed 1000 characters.',
    );
  }
  return normalized;
}

export function normalizeGroupConfiguration(input: GroupConfigurationInput): GroupConfiguration {
  return {
    description: normalizeGroupDescription(input.description),
    name: normalizeResourceName(input.name),
  };
}

export function classifyGroupChanges(
  current: GroupConfiguration,
  patch: GroupConfigurationPatch,
): GroupChangeSet {
  const next: GroupConfiguration = {
    ...current,
    ...(Object.hasOwn(patch, 'name') ? { name: normalizeResourceName(patch.name!) } : {}),
    ...(Object.hasOwn(patch, 'description')
      ? { description: normalizeGroupDescription(patch.description) }
      : {}),
  };
  const changedFields = (['description', 'name'] as const).filter(
    (field) => current[field] !== next[field],
  );
  return { changedFields, next, noop: changedFields.length === 0 };
}
