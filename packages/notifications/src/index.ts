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

export type SmtpFailureResult = 'DELIVERY_UNKNOWN' | 'FAILED' | 'RETRY';

export interface SmtpFailureClassification {
  code: string;
  result: SmtpFailureResult;
}

function errorProperty(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null && Reflect.has(error, key)
    ? Reflect.get(error, key)
    : undefined;
}

/** Maps provider failures to a bounded, persistence-safe result. */
export function classifySmtpFailure(error: unknown): SmtpFailureClassification {
  const responseCode = Number(errorProperty(error, 'responseCode'));
  const providerCode = errorProperty(error, 'code');
  const rawCode = (typeof providerCode === 'string' ? providerCode : 'smtp_error').toUpperCase();
  const code = /^[A-Z0-9_]{1,40}$/u.test(rawCode) ? rawCode.toLowerCase() : 'smtp_error';
  if (responseCode >= 500 && responseCode <= 599)
    return { code: `smtp_${responseCode}`, result: 'FAILED' };
  if (responseCode >= 400 && responseCode <= 499)
    return { code: `smtp_${responseCode}`, result: 'RETRY' };
  if (['EAUTH', 'EENVELOPE', 'EMESSAGE'].includes(rawCode)) return { code, result: 'FAILED' };
  if (['ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(rawCode))
    return { code, result: 'RETRY' };
  if (['ECONNRESET', 'ETIMEDOUT', 'ESOCKET'].includes(rawCode)) {
    return { code, result: 'DELIVERY_UNKNOWN' };
  }
  return { code, result: 'DELIVERY_UNKNOWN' };
}

/** Stable jitter keeps retries spread without requiring mutable random state. */
export function notificationRetryDelaySeconds(
  deliveryId: string,
  attempt: number,
  baseSeconds: number,
  capSeconds: number,
): number {
  if (!Number.isInteger(attempt) || attempt < 1 || baseSeconds < 1 || capSeconds < baseSeconds) {
    throw new RangeError('Invalid notification retry parameters.');
  }
  let hash = 2_166_136_261;
  for (const character of `${deliveryId}:${attempt}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  const ceiling = Math.min(capSeconds, baseSeconds * 2 ** Math.min(attempt - 1, 20));
  return Math.max(1, Math.floor((hash / 0xffff_ffff) * ceiling));
}

export type IncidentTemplateKey = 'INCIDENT_DOWN' | 'INCIDENT_RECOVERED' | 'MONITORING_ENDED';

export interface IncidentEmailContent {
  html: string;
  subject: string;
  text: string;
}

function requiredText(payload: Record<string, unknown>, field: string, maxLength = 500): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new TypeError(`Invalid incident notification field: ${field}`);
  }
  return value;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function durationText(milliseconds: string): string {
  const value = Number(milliseconds);
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid incident duration.');
  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Renders only the allowlisted snapshot; URLs and response bodies are impossible inputs. */
export function renderIncidentEmail(
  templateKey: IncidentTemplateKey,
  templateVersion: number,
  payload: Record<string, unknown>,
): IncidentEmailContent {
  if (templateVersion !== 1)
    throw new TypeError('Unsupported incident notification template version.');
  const checkName = requiredText(payload, 'check_name', 160);
  let subject: string;
  let lines: string[];
  if (templateKey === 'INCIDENT_DOWN') {
    subject = `DOWN: ${checkName}`;
    lines = [
      `${checkName} is unavailable.`,
      `Incident started: ${requiredText(payload, 'started_at', 40)}`,
      `Confirmed: ${requiredText(payload, 'confirmed_at', 40)}`,
      `Failure category: ${requiredText(payload, 'failure_category', 80)}`,
    ];
  } else if (templateKey === 'INCIDENT_RECOVERED') {
    subject = `RECOVERED: ${checkName}`;
    lines = [
      `${checkName} is available again.`,
      `Incident started: ${requiredText(payload, 'started_at', 40)}`,
      `Recovered: ${requiredText(payload, 'ended_at', 40)}`,
      `Observed downtime: ${durationText(requiredText(payload, 'observed_duration_ms', 24))}`,
    ];
  } else {
    subject = `MONITORING ENDED: ${checkName}`;
    lines = [
      `Monitoring for ${checkName} changed while an incident was open.`,
      `Closed: ${requiredText(payload, 'ended_at', 40)}`,
      `Reason: ${requiredText(payload, 'closure_reason', 40)}`,
    ];
  }
  return {
    html: `<p>${lines.map(htmlEscape).join('</p><p>')}</p>`,
    subject,
    text: lines.join('\n'),
  };
}
