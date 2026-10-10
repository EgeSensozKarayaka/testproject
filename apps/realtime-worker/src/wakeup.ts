import { createHash } from 'node:crypto';

export const realtimeEventTypes = [
  'check.created',
  'check.metadata_changed',
  'check.probe_configuration_changed',
  'check.schedule_changed',
  'check.paused',
  'check.resumed',
  'check.group_changed',
  'check.deleted',
  'check.manual_run_requested',
  'check.observation_accepted',
  'check.health_changed',
  'check.freshness_changed',
  'group.created',
  'group.changed',
  'group.deleted',
  'incident.opened',
  'incident.observation_suspended',
  'incident.observation_resumed',
  'incident.closed',
  'maintenance.created',
  'maintenance.changed',
  'maintenance.cancelled',
  'notification.recipient_created',
  'notification.recipient_reactivated',
  'notification.recipient_verified',
  'notification.recipient_disabled',
  'notification.policy_changed',
  'notification.intent_created',
  'notification.delivery_scheduled',
  'notification.delivery_sent',
  'notification.delivery_failed',
  'public_page.published',
  'public_page.changed',
  'public_page.link_rotated',
  'public_page.disabled',
  'prediction.updated',
  'prediction.expired',
] as const;

const realtimeEventTypeSet = new Set<string>(realtimeEventTypes);

export interface RealtimeClaim {
  aggregateId: string;
  aggregateType: string;
  aggregateVersion: string | null;
  attemptCount: number;
  eventId: string;
  eventType: string;
  fencingToken: string;
  occurredAt: Date;
  ownerId: string | null;
  schemaVersion: number;
}

export interface RealtimeWakeup {
  aggregate_id: string;
  aggregate_type: string;
  aggregate_version: string | null;
  event_id: string;
  event_type: string;
  occurred_at: string;
  owner_id: string;
  v: 1;
}

export type RealtimeClaimDecision =
  | { result: 'COMPLETED'; resultCode: 'PUBLISHED'; wakeup: RealtimeWakeup }
  | {
      result: 'DEAD';
      resultCode:
        | 'MAX_ATTEMPTS_EXCEEDED'
        | 'MISSING_OWNER'
        | 'UNSAFE_WAKEUP_SIZE'
        | 'UNSUPPORTED_EVENT_TYPE'
        | 'UNSUPPORTED_SCHEMA_VERSION';
    };

export function classifyRealtimeClaim(
  claim: RealtimeClaim,
  maxDispatchAttempts: number,
): RealtimeClaimDecision {
  if (claim.attemptCount > maxDispatchAttempts) {
    return { result: 'DEAD', resultCode: 'MAX_ATTEMPTS_EXCEEDED' };
  }
  if (claim.schemaVersion !== 1) {
    return { result: 'DEAD', resultCode: 'UNSUPPORTED_SCHEMA_VERSION' };
  }
  if (!claim.ownerId) return { result: 'DEAD', resultCode: 'MISSING_OWNER' };
  if (!realtimeEventTypeSet.has(claim.eventType)) {
    return { result: 'DEAD', resultCode: 'UNSUPPORTED_EVENT_TYPE' };
  }

  const wakeup: RealtimeWakeup = {
    aggregate_id: claim.aggregateId,
    aggregate_type: claim.aggregateType,
    aggregate_version: claim.aggregateVersion,
    event_id: claim.eventId,
    event_type: claim.eventType,
    occurred_at: claim.occurredAt.toISOString(),
    owner_id: claim.ownerId,
    v: 1,
  };
  if (Buffer.byteLength(JSON.stringify(wakeup), 'utf8') > 1024) {
    return { result: 'DEAD', resultCode: 'UNSAFE_WAKEUP_SIZE' };
  }
  return { result: 'COMPLETED', resultCode: 'PUBLISHED', wakeup };
}

export function realtimeRetryDelaySeconds(
  eventId: string,
  attemptCount: number,
  baseSeconds: number,
  capSeconds: number,
): number {
  const exponential = Math.min(capSeconds, baseSeconds * 2 ** Math.max(0, attemptCount - 1));
  const sample = createHash('sha256').update(`${eventId}:${attemptCount}`).digest().readUInt32BE(0);
  return Math.max(1, Math.floor((sample / 0xffffffff) * exponential) + 1);
}
