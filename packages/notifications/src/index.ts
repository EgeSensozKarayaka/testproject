import { DomainValidationError, type EntityId } from '@site-monitor/domain';

export type NotificationPolicyMode = 'ACTIVE' | 'DISABLED' | 'INHERIT';

export interface NotificationPolicyConfiguration {
  id: EntityId;
  mode: NotificationPolicyMode;
  notifyDown: boolean | null;
  notifyRecovery: boolean | null;
  recipientIds: EntityId[];
  resourceVersion: string;
}

export interface NotificationPolicyInput {
  mode: NotificationPolicyMode;
  notifyDown: boolean | null;
  notifyRecovery: boolean | null;
  recipientIds: EntityId[];
}

export interface EffectiveNotificationPolicy {
  id: EntityId;
  mode: 'ACTIVE' | 'DISABLED';
  notifyDown: boolean | null;
  notifyRecovery: boolean | null;
  recipientIds: EntityId[];
  resourceVersion: string;
}

function invalidPolicy(field: string, code: string, message: string): never {
  throw new DomainValidationError(field, code, message);
}

export function normalizeNotificationPolicy(
  input: NotificationPolicyInput,
  options: { allowInherit: boolean },
): NotificationPolicyInput {
  if (!options.allowInherit && input.mode === 'INHERIT') {
    invalidPolicy('mode', 'inherit_not_allowed', 'The default policy cannot inherit.');
  }
  const recipientIds = [...input.recipientIds].sort();
  if (new Set(recipientIds).size !== recipientIds.length) {
    invalidPolicy('recipient_ids', 'duplicate_recipient', 'Recipient identifiers must be unique.');
  }
  if (input.mode !== 'ACTIVE') {
    if (input.notifyDown !== null || input.notifyRecovery !== null || recipientIds.length !== 0) {
      invalidPolicy(
        'mode',
        'inactive_policy_has_configuration',
        'Inherited and disabled policies cannot contain notification settings.',
      );
    }
    return { mode: input.mode, notifyDown: null, notifyRecovery: null, recipientIds: [] };
  }
  if (typeof input.notifyDown !== 'boolean' || typeof input.notifyRecovery !== 'boolean') {
    invalidPolicy(
      'notify_down',
      'active_policy_flags_required',
      'An active policy requires explicit notification flags.',
    );
  }
  if (recipientIds.length === 0) {
    invalidPolicy(
      'recipient_ids',
      'active_policy_recipient_required',
      'An active policy requires at least one verified recipient.',
    );
  }
  if (input.notifyRecovery && !input.notifyDown) {
    invalidPolicy(
      'notify_recovery',
      'recovery_requires_down',
      'Recovery notifications require down notifications.',
    );
  }
  return {
    mode: 'ACTIVE',
    notifyDown: input.notifyDown,
    notifyRecovery: input.notifyRecovery,
    recipientIds,
  };
}

/** Resolves a group override without merging recipient sets or flags. */
export function resolveNotificationPolicy(
  group: NotificationPolicyConfiguration,
  ownerDefault: NotificationPolicyConfiguration,
): EffectiveNotificationPolicy {
  const source = group.mode === 'INHERIT' ? ownerDefault : group;
  if (source.mode === 'INHERIT') {
    throw new RangeError('The owner default policy cannot inherit.');
  }
  return {
    id: source.id,
    mode: source.mode,
    notifyDown: source.notifyDown,
    notifyRecovery: source.notifyRecovery,
    recipientIds: [...source.recipientIds],
    resourceVersion: source.resourceVersion,
  };
}

export interface NotificationReference {
  incidentId: EntityId;
}

export interface MaintenanceNotificationGateInput {
  /**
   * Event-specific eligibility is resolved from current incident and delivery lineage.
   * For example, a recovered incident with no sent DOWN delivery is not eligible.
   */
  eligible: boolean;
  /** The shared database projection; null means no effective direct/group maintenance. */
  effectiveMaintenanceUntilMs: number | null;
  evaluatedAtMs: number;
}

export type MaintenanceNotificationGateDecision =
  | { kind: 'CANCEL'; reason: 'NOT_ELIGIBLE' }
  | { kind: 'DEFER'; reevaluateAtMs: number }
  | { kind: 'PROCEED' };

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${field} must be a safe integer timestamp.`);
  }
}

/**
 * Applies only the maintenance gate. Recipient policy resolution and delivery
 * materialization deliberately remain downstream concerns.
 */
export function decideMaintenanceNotificationGate(
  input: MaintenanceNotificationGateInput,
): MaintenanceNotificationGateDecision {
  assertTimestamp(input.evaluatedAtMs, 'evaluatedAtMs');
  if (input.effectiveMaintenanceUntilMs !== null) {
    assertTimestamp(input.effectiveMaintenanceUntilMs, 'effectiveMaintenanceUntilMs');
    if (input.effectiveMaintenanceUntilMs <= input.evaluatedAtMs) {
      throw new RangeError('effectiveMaintenanceUntilMs must be later than evaluatedAtMs.');
    }
  }

  if (!input.eligible) return { kind: 'CANCEL', reason: 'NOT_ELIGIBLE' };
  if (input.effectiveMaintenanceUntilMs !== null) {
    return { kind: 'DEFER', reevaluateAtMs: input.effectiveMaintenanceUntilMs };
  }
  return { kind: 'PROCEED' };
}
