import type { Pool } from 'pg';

export interface ClaimedDispatch {
  aggregate_id: string;
  attempt_count: number;
  event_id: string;
  event_type: string;
  fencing_token: string;
  owner_id: string;
  schema_version: number;
}

export interface ClaimedIncidentDelivery {
  attempt_count: number;
  delivery_id: string;
  event_kind: 'INCIDENT_CLOSED' | 'INCIDENT_OPENED' | 'INCIDENT_RECOVERED';
  fencing_token: string;
  recipient_address: string;
  template_key: 'INCIDENT_DOWN' | 'INCIDENT_RECOVERED' | 'MONITORING_ENDED';
  template_payload: Record<string, unknown>;
  template_version: number;
}

const supportedEvents = new Set([
  'check.deleted',
  'check.group_changed',
  'group.deleted',
  'incident.closed',
  'incident.opened',
  'maintenance.cancelled',
  'maintenance.created',
  'maintenance.updated',
  'notification.policy_updated',
  'notification.recipient_disabled',
]);

export class IncidentNotificationStore {
  constructor(
    private readonly pool: Pool,
    private readonly workerId: string,
    private readonly leaseSeconds: number,
    private readonly maxDispatchAttempts: number,
  ) {}

  async reconcileOpenIncidents(): Promise<number> {
    const result = await this.pool.query<{ count: number }>(
      'SELECT security_api.reconcile_open_incident_notifications() AS count',
    );
    return result.rows[0]?.count ?? 0;
  }

  async consumeDispatch(): Promise<boolean> {
    const result = await this.pool.query<ClaimedDispatch>(
      'SELECT * FROM security_api.claim_notification_dispatch($1,$2)',
      [this.workerId, this.leaseSeconds],
    );
    const claim = result.rows[0];
    if (!claim) return false;
    const supported = claim.schema_version === 1 && supportedEvents.has(claim.event_type);
    const terminal = claim.attempt_count >= this.maxDispatchAttempts;
    await this.pool.query('SELECT security_api.complete_notification_dispatch($1,$2,$3,$4,$5,$6)', [
      claim.event_id,
      this.workerId,
      claim.fencing_token,
      supported ? 'COMPLETED' : terminal ? 'DEAD' : 'RETRY',
      supported
        ? 'consumed'
        : claim.schema_version !== 1
          ? 'unsupported_schema'
          : 'unsupported_event',
      30,
    ]);
    return true;
  }

  async evaluateIntent(): Promise<boolean> {
    const result = await this.pool.query<{ processed: boolean }>(
      'SELECT * FROM security_api.evaluate_notification_intent()',
    );
    return result.rows[0]?.processed ?? false;
  }

  async claimDelivery(): Promise<ClaimedIncidentDelivery | undefined> {
    const result = await this.pool.query<ClaimedIncidentDelivery>(
      'SELECT * FROM security_api.claim_incident_notification_delivery($1,$2)',
      [this.workerId, this.leaseSeconds],
    );
    return result.rows[0];
  }

  async completeDelivery(
    claim: ClaimedIncidentDelivery,
    result: 'DELIVERY_UNKNOWN' | 'FAILED' | 'RETRY' | 'SENT',
    resultCode: string,
    providerMessageId: string | null,
    retrySeconds: number,
  ): Promise<void> {
    await this.pool.query(
      'SELECT security_api.complete_incident_notification_delivery($1,$2,$3,$4,$5,$6,$7)',
      [
        claim.delivery_id,
        this.workerId,
        claim.fencing_token,
        result,
        resultCode,
        providerMessageId,
        retrySeconds,
      ],
    );
  }
}
