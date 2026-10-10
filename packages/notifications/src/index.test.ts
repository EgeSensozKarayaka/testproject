import { describe, expect, it } from 'vitest';

import { decideMaintenanceNotificationGate } from './index.js';

describe('maintenance notification gate', () => {
  const evaluatedAtMs = Date.parse('2026-10-10T10:00:00.000Z');
  const maintenanceUntilMs = Date.parse('2026-10-10T11:00:00.000Z');

  it('defers an eligible transition to the effective maintenance deadline', () => {
    expect(
      decideMaintenanceNotificationGate({
        effectiveMaintenanceUntilMs: maintenanceUntilMs,
        eligible: true,
        evaluatedAtMs,
      }),
    ).toEqual({ kind: 'DEFER', reevaluateAtMs: maintenanceUntilMs });
  });

  it('proceeds after maintenance only when the transition remains eligible', () => {
    expect(
      decideMaintenanceNotificationGate({
        effectiveMaintenanceUntilMs: null,
        eligible: true,
        evaluatedAtMs: maintenanceUntilMs,
      }),
    ).toEqual({ kind: 'PROCEED' });
    expect(
      decideMaintenanceNotificationGate({
        effectiveMaintenanceUntilMs: null,
        eligible: false,
        evaluatedAtMs: maintenanceUntilMs,
      }),
    ).toEqual({ kind: 'CANCEL', reason: 'NOT_ELIGIBLE' });
  });

  it('cancels an ineligible transition even while maintenance remains active', () => {
    expect(
      decideMaintenanceNotificationGate({
        effectiveMaintenanceUntilMs: maintenanceUntilMs,
        eligible: false,
        evaluatedAtMs,
      }),
    ).toEqual({ kind: 'CANCEL', reason: 'NOT_ELIGIBLE' });
  });

  it('rejects a stale or invalid maintenance projection', () => {
    expect(() =>
      decideMaintenanceNotificationGate({
        effectiveMaintenanceUntilMs: evaluatedAtMs,
        eligible: true,
        evaluatedAtMs,
      }),
    ).toThrow(RangeError);
    expect(() =>
      decideMaintenanceNotificationGate({
        effectiveMaintenanceUntilMs: Number.NaN,
        eligible: true,
        evaluatedAtMs,
      }),
    ).toThrow(RangeError);
  });
});
