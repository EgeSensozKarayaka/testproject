import type { EntityId } from '@site-monitor/domain';

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
