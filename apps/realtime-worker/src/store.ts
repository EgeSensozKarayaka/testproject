import type { Pool } from '@site-monitor/database';

import type { RealtimeClaim } from './wakeup.js';

interface ClaimedRealtimeRow {
  aggregate_id: string;
  aggregate_type: string;
  aggregate_version: string | null;
  attempt_count: number;
  event_id: string;
  event_type: string;
  fencing_token: string;
  occurred_at: Date;
  owner_id: string | null;
  schema_version: number;
}

export type RealtimeCompletionResult = 'COMPLETED' | 'DEAD' | 'RETRY';

export interface RealtimeStorePort {
  claimDispatch(): Promise<RealtimeClaim | undefined>;
  completeDispatch(
    claim: RealtimeClaim,
    result: RealtimeCompletionResult,
    resultCode: string,
    retrySeconds: number,
  ): Promise<boolean>;
  storageReady(): Promise<boolean>;
}

export class RealtimeStore implements RealtimeStorePort {
  readonly #leaseSeconds: number;
  readonly #pool: Pool;
  readonly #workerId: string;

  constructor(pool: Pool, workerId: string, leaseSeconds: number) {
    this.#leaseSeconds = leaseSeconds;
    this.#pool = pool;
    this.#workerId = workerId;
  }

  async claimDispatch(): Promise<RealtimeClaim | undefined> {
    const result = await this.#pool.query<ClaimedRealtimeRow>(
      'SELECT * FROM security_api.claim_realtime_dispatch($1,$2)',
      [this.#workerId, this.#leaseSeconds],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      aggregateId: row.aggregate_id,
      aggregateType: row.aggregate_type,
      aggregateVersion: row.aggregate_version,
      attemptCount: row.attempt_count,
      eventId: row.event_id,
      eventType: row.event_type,
      fencingToken: row.fencing_token,
      occurredAt: row.occurred_at,
      ownerId: row.owner_id,
      schemaVersion: row.schema_version,
    };
  }

  async completeDispatch(
    claim: RealtimeClaim,
    result: RealtimeCompletionResult,
    resultCode: string,
    retrySeconds: number,
  ): Promise<boolean> {
    const completed = await this.#pool.query<{ completed: boolean }>(
      `SELECT security_api.complete_realtime_dispatch($1,$2,$3,$4,$5,$6)
         AS completed`,
      [claim.eventId, this.#workerId, claim.fencingToken, result, resultCode, retrySeconds],
    );
    return completed.rows[0]?.completed === true;
  }

  async storageReady(): Promise<boolean> {
    try {
      const result = await this.#pool.query<{ ready: boolean }>(
        'SELECT security_api.realtime_storage_ready() AS ready',
      );
      return result.rows[0]?.ready === true;
    } catch {
      return false;
    }
  }
}
