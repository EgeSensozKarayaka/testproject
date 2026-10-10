import { describe, expect, it } from 'vitest';

import { DomainValidationError } from '@site-monitor/domain';

import {
  decideMaintenanceNotificationGate,
  classifySmtpFailure,
  notificationRetryDelaySeconds,
  normalizeNotificationPolicy,
  renderIncidentEmail,
  resolveNotificationPolicy,
} from './index.js';

describe('notification policy', () => {
  it('canonicalizes active recipients and keeps a group override atomic', () => {
    const policy = normalizeNotificationPolicy(
      {
        mode: 'ACTIVE',
        notifyDown: true,
        notifyRecovery: true,
        recipientIds: [
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ],
      },
      { allowInherit: true },
    );
    expect(policy.recipientIds).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]);
    expect(
      resolveNotificationPolicy(
        { id: 'group', resourceVersion: '2', ...policy },
        {
          id: 'default',
          mode: 'ACTIVE',
          notifyDown: true,
          notifyRecovery: false,
          recipientIds: ['default-recipient'],
          resourceVersion: '9',
        },
      ),
    ).toMatchObject({ id: 'group', recipientIds: policy.recipientIds, resourceVersion: '2' });
  });

  it('resolves INHERIT exclusively from the current owner default', () => {
    expect(
      resolveNotificationPolicy(
        {
          id: 'group',
          mode: 'INHERIT',
          notifyDown: null,
          notifyRecovery: null,
          recipientIds: [],
          resourceVersion: '3',
        },
        {
          id: 'default',
          mode: 'DISABLED',
          notifyDown: null,
          notifyRecovery: null,
          recipientIds: [],
          resourceVersion: '7',
        },
      ),
    ).toEqual({
      id: 'default',
      mode: 'DISABLED',
      notifyDown: null,
      notifyRecovery: null,
      recipientIds: [],
      resourceVersion: '7',
    });
  });

  it.each([
    {
      input: { mode: 'ACTIVE' as const, notifyDown: true, notifyRecovery: true, recipientIds: [] },
      code: 'active_policy_recipient_required',
    },
    {
      input: {
        mode: 'ACTIVE' as const,
        notifyDown: false,
        notifyRecovery: true,
        recipientIds: ['recipient'],
      },
      code: 'recovery_requires_down',
    },
    {
      input: {
        mode: 'DISABLED' as const,
        notifyDown: true,
        notifyRecovery: false,
        recipientIds: [],
      },
      code: 'inactive_policy_has_configuration',
    },
  ])('rejects invalid policy semantics: $code', ({ code, input }) => {
    try {
      normalizeNotificationPolicy(input, { allowInherit: true });
      throw new Error('expected policy validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      expect((error as DomainValidationError).code).toBe(code);
    }
  });

  it('forbids INHERIT for the owner default', () => {
    expect(() =>
      normalizeNotificationPolicy(
        { mode: 'INHERIT', notifyDown: null, notifyRecovery: null, recipientIds: [] },
        { allowInherit: false },
      ),
    ).toThrow(DomainValidationError);
  });
});

describe('notification delivery rules', () => {
  it('classifies SMTP failures without persisting provider text', () => {
    expect(classifySmtpFailure({ responseCode: 421 })).toEqual({
      code: 'smtp_421',
      result: 'RETRY',
    });
    expect(classifySmtpFailure({ responseCode: 550 })).toEqual({
      code: 'smtp_550',
      result: 'FAILED',
    });
    expect(classifySmtpFailure({ code: 'ETIMEDOUT', message: 'private provider detail' })).toEqual({
      code: 'etimedout',
      result: 'DELIVERY_UNKNOWN',
    });
  });

  it('uses deterministic bounded retry jitter', () => {
    const first = notificationRetryDelaySeconds('delivery-a', 3, 30, 1800);
    expect(notificationRetryDelaySeconds('delivery-a', 3, 30, 1800)).toBe(first);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(120);
  });

  it('renders escaped incident snapshots without URLs or response data', () => {
    const content = renderIncidentEmail('INCIDENT_DOWN', 1, {
      check_name: '<Critical API>',
      confirmed_at: '2026-10-10T10:00:30.000Z',
      failure_category: 'TIMEOUT',
      started_at: '2026-10-10T10:00:00.000Z',
    });
    expect(content.subject).toContain('<Critical API>');
    expect(content.html).toContain('&lt;Critical API&gt;');
    expect(content.html).not.toContain('<Critical API>');
    expect(content.text).not.toContain('http');
  });

  it.each([
    {
      marker: 'Primary API is unavailable.',
      payload: {
        check_name: 'Primary API',
        confirmed_at: '2026-10-10T10:00:30.000Z',
        failure_category: 'TIMEOUT',
        started_at: '2026-10-10T10:00:00.000Z',
      },
      subject: 'DOWN: Primary API',
      template: 'INCIDENT_DOWN' as const,
    },
    {
      marker: 'Primary API is available again.',
      payload: {
        check_name: 'Primary API',
        ended_at: '2026-10-10T10:02:00.000Z',
        observed_duration_ms: '90000',
        started_at: '2026-10-10T10:00:00.000Z',
      },
      subject: 'RECOVERED: Primary API',
      template: 'INCIDENT_RECOVERED' as const,
    },
    {
      marker: 'Monitoring for Primary API changed',
      payload: {
        check_name: 'Primary API',
        closure_reason: 'CONFIG_CHANGED',
        ended_at: '2026-10-10T10:02:00.000Z',
      },
      subject: 'MONITORING ENDED: Primary API',
      template: 'MONITORING_ENDED' as const,
    },
  ])(
    'renders text and HTML alternatives for $template',
    ({ marker, payload, subject, template }) => {
      const content = renderIncidentEmail(template, 1, payload);
      expect(content.subject).toBe(subject);
      expect(content.text).toContain(marker);
      expect(content.html).toContain(`<p>${marker}`);
    },
  );
});

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
