import type { Pool, PoolClient } from '@site-monitor/database';
import { writeActivatedOutboxEvent } from '@site-monitor/database';
import type { ProbeInfrastructureErrorCode } from '@site-monitor/check-engine';

import { retryBackoffMs } from './scheduling.js';

export interface CheckCandidate {
  checkId: string;
  ownerId: string;
}

export interface JobCandidate extends CheckCandidate {
  jobId: string;
}

export interface DispatchCandidate extends JobCandidate {
  /** Sensitive scheduling input. It must never be logged or emitted. */
  targetUrl: string | null;
}

export interface MaterializedJob extends JobCandidate {
  kind: 'MANUAL' | 'SCHEDULED';
  manualMode: 'DIAGNOSTIC' | 'STATEFUL' | null;
  scheduledFor: string;
}

export type MaterializationResult =
  { outcome: 'MATERIALIZED'; job: MaterializedJob } | { outcome: 'SKIPPED' };

export interface ClaimedJob extends JobCandidate {
  attemptId: string;
  attemptNumber: number;
  configSnapshot: unknown;
  fencingToken: string;
  leaseDurationMs: number;
  leaseExpiresAt: string;
  manualMode: 'DIAGNOSTIC' | 'STATEFUL' | null;
  probeGeneration: string;
  resourceVersion: string;
  scheduleGeneration: string;
  scheduledFor: string;
  triggerKind: 'MANUAL' | 'SCHEDULED';
}

export type ClaimResult = { job: ClaimedJob; outcome: 'CLAIMED' } | { outcome: 'SKIPPED' };

export type JobSettlement =
  | {
      manualJobId: string | null;
      outcome: 'CANCELLED' | 'DEAD';
    }
  | {
      nextAvailableAt: string;
      outcome: 'RETRY_SCHEDULED';
    }
  | { outcome: 'STALE' };

type CancellationReason = 'CHECK_DELETED' | 'CHECK_PAUSED' | 'CONFIGURATION_CHANGED';

export type LeaseStatus =
  | { outcome: 'ACTIVE'; leaseExpiresAt: string }
  | {
      cancellationReason: CancellationReason;
      outcome: 'CANCELLATION_REQUESTED';
    }
  | { outcome: 'LEASE_LOST' };

export interface LockedCheckRow {
  cadence_anchor_at: Date | string;
  execution_state: 'ACTIVE' | 'PAUSED';
  expected_body_substring: string | null;
  expected_status_code: number;
  interval_seconds: number;
  is_due: boolean;
  lifecycle_state: 'DELETED' | 'LIVE';
  manual_requested_at: Date | string | null;
  manual_requested_mode: 'DIAGNOSTIC' | 'STATEFUL' | null;
  next_run_at: Date | string | null;
  probe_generation: string;
  resource_version: string;
  schedule_generation: string;
  timeout_ms: number;
  url: string;
}

interface LockedJobRow {
  attempt_count: number;
  config_snapshot: unknown;
  manual_mode: 'DIAGNOSTIC' | 'STATEFUL' | null;
  max_attempts: number;
  probe_generation: string;
  resource_version: string;
  schedule_generation: string;
  scheduled_for: Date | string;
  trigger_kind: 'MANUAL' | 'SCHEDULED';
}

interface LockedActiveJobRow extends LockedJobRow {
  cancellation_reason: CancellationReason | null;
  cancellation_requested_at: Date | string | null;
  fencing_token: string;
  lease_expires_at: Date | string;
  lease_owner: string;
  state: 'LEASED' | 'RUNNING';
}

function instant(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function requireBatchSize(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 2_000) {
    throw new TypeError('batch size must be an integer from 1 through 2000.');
  }
}

function requireWorkerId(value: string): void {
  if (value.trim().length === 0 || value.length > 160) {
    throw new TypeError('workerId must contain from 1 through 160 characters.');
  }
}

async function inTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function probeSnapshot(check: LockedCheckRow): Record<string, unknown> {
  return {
    schema_version: 1,
    expected_body_substring: check.expected_body_substring,
    expected_status_code: check.expected_status_code,
    interval_seconds: check.interval_seconds,
    timeout_ms: check.timeout_ms,
    url: check.url,
  };
}

export async function materializePendingManualIntent(
  client: PoolClient,
  candidate: CheckCandidate,
  check: LockedCheckRow,
  workerId: string,
): Promise<string | null> {
  if (check.manual_requested_at === null) return null;
  if (check.manual_requested_mode === null) {
    throw new Error('Manual request mode invariant violated.');
  }

  const scheduledFor = check.manual_requested_at;
  const manualMode = check.manual_requested_mode;
  if (
    check.lifecycle_state === 'DELETED' ||
    (check.execution_state === 'PAUSED' && manualMode === 'STATEFUL')
  ) {
    const cleared = await client.query(
      `UPDATE app.checks
       SET manual_requested_at = NULL, manual_requested_mode = NULL,
           updated_at = updated_at
       WHERE owner_id = $1 AND id = $2
         AND manual_requested_at IS NOT NULL AND manual_requested_mode = $3`,
      [candidate.ownerId, candidate.checkId, manualMode],
    );
    if (cleared.rowCount !== 1) throw new Error('Manual request changed while locked.');
    return null;
  }

  const inserted = await client.query<{ available_at: Date | string; id: string }>(
    `INSERT INTO monitoring.check_jobs
       (owner_id, check_id, trigger_kind, manual_mode, scheduled_for,
        available_at, priority, state, config_snapshot, resource_version,
        probe_generation, schedule_generation)
     VALUES ($1, $2, 'MANUAL', $3, $4, transaction_timestamp(), 100,
             'PENDING', $5::jsonb, $6::bigint, $7::bigint, $8::bigint)
     RETURNING id::text, available_at`,
    [
      candidate.ownerId,
      candidate.checkId,
      manualMode,
      scheduledFor,
      JSON.stringify(probeSnapshot(check)),
      check.resource_version,
      check.probe_generation,
      check.schedule_generation,
    ],
  );
  const jobId = inserted.rows[0]!.id;
  const availableAt = instant(inserted.rows[0]!.available_at);
  const cleared = await client.query(
    `UPDATE app.checks
     SET manual_requested_at = NULL, manual_requested_mode = NULL,
         updated_at = updated_at
     WHERE owner_id = $1 AND id = $2
       AND manual_requested_at IS NOT NULL AND manual_requested_mode = $3`,
    [candidate.ownerId, candidate.checkId, manualMode],
  );
  if (cleared.rowCount !== 1) throw new Error('Manual request changed while locked.');

  const payload = {
    check_id: candidate.checkId,
    job_id: jobId,
    job_kind: 'MANUAL',
    not_before: availableAt,
    probe_generation: check.probe_generation,
    schedule_generation: check.schedule_generation,
  };
  await client.query(
    `INSERT INTO audit.events
       (occurred_at, owner_id, actor_type, actor_id, action, resource_type,
        resource_id, correlation_id, result, metadata)
     VALUES (transaction_timestamp(), $1, 'WORKER', $2, 'check.job_available',
             'check_job', $3, $3, 'SUCCESS', $4::jsonb)`,
    [candidate.ownerId, workerId, jobId, JSON.stringify(payload)],
  );
  await writeActivatedOutboxEvent(client, {
    aggregateId: jobId,
    aggregateType: 'check_job',
    aggregateVersion: check.resource_version,
    correlationId: jobId,
    destinations: ['AUDIT'],
    eventType: 'check.job_available',
    ownerId: candidate.ownerId,
    payload,
  });
  return jobId;
}

export class PostgresJobQueue {
  constructor(
    private readonly pool: Pool,
    private readonly workerId: string,
    private readonly leaseGraceMs: number,
  ) {
    requireWorkerId(workerId);
    if (!Number.isInteger(leaseGraceMs) || leaseGraceMs < 1_000 || leaseGraceMs > 300_000) {
      throw new TypeError('leaseGraceMs must be an integer from 1000 through 300000.');
    }
  }

  async #lockCheck(client: PoolClient, candidate: CheckCandidate): Promise<LockedCheckRow | null> {
    const result = await client.query<LockedCheckRow>(
      `SELECT cadence_anchor_at, execution_state, expected_body_substring,
              expected_status_code, interval_seconds, lifecycle_state,
              manual_requested_at, manual_requested_mode, next_run_at,
              probe_generation::text, resource_version::text,
              schedule_generation::text, timeout_ms, url,
              (next_run_at IS NOT NULL AND next_run_at <= transaction_timestamp()) AS is_due
       FROM app.checks
       WHERE owner_id = $1 AND id = $2
       FOR UPDATE SKIP LOCKED`,
      [candidate.ownerId, candidate.checkId],
    );
    return result.rows[0] ?? null;
  }

  async #materializePendingManualIntent(
    client: PoolClient,
    candidate: CheckCandidate,
    check: LockedCheckRow,
  ): Promise<string | null> {
    return materializePendingManualIntent(client, candidate, check, this.workerId);
  }

  async listMaterializationCandidates(limit: number): Promise<CheckCandidate[]> {
    requireBatchSize(limit);
    const result = await this.pool.query<{ check_id: string; owner_id: string }>(
      `WITH ranked AS (
         SELECT c.owner_id, c.id AS check_id,
                CASE WHEN c.manual_requested_at IS NOT NULL THEN 1 ELSE 0 END AS manual_priority,
                COALESCE(c.manual_requested_at, c.next_run_at) AS due_at,
                row_number() OVER (
                  PARTITION BY c.owner_id
                  ORDER BY
                    CASE WHEN c.manual_requested_at IS NOT NULL THEN 0 ELSE 1 END,
                    COALESCE(c.manual_requested_at, c.next_run_at),
                    c.id
                ) AS owner_rank
         FROM app.checks AS c
         WHERE c.lifecycle_state = 'LIVE'
           AND (
             c.manual_requested_at IS NOT NULL
             OR (c.execution_state = 'ACTIVE' AND c.next_run_at <= statement_timestamp())
           )
           AND NOT EXISTS (
             SELECT 1 FROM monitoring.check_jobs AS active
             WHERE active.owner_id = c.owner_id AND active.check_id = c.id
               AND active.state IN ('PENDING', 'LEASED', 'RUNNING')
           )
       )
       SELECT owner_id::text, check_id::text
       FROM ranked
       ORDER BY owner_rank, manual_priority DESC, due_at, owner_id, check_id
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({ checkId: row.check_id, ownerId: row.owner_id }));
  }

  async materializeDueBatch(limit: number): Promise<MaterializedJob[]> {
    const candidates = await this.listMaterializationCandidates(limit);
    const materialized: MaterializedJob[] = [];
    for (const candidate of candidates) {
      const result = await this.materializeCandidate(candidate);
      if (result.outcome === 'MATERIALIZED') materialized.push(result.job);
    }
    return materialized;
  }

  async materializeCandidate(candidate: CheckCandidate): Promise<MaterializationResult> {
    return inTransaction(this.pool, async (client) => {
      const locked = await client.query<LockedCheckRow>(
        `SELECT cadence_anchor_at, execution_state, expected_body_substring,
                expected_status_code, interval_seconds, lifecycle_state,
                manual_requested_at, manual_requested_mode, next_run_at,
                probe_generation::text, resource_version::text,
                schedule_generation::text, timeout_ms, url,
                (next_run_at IS NOT NULL AND next_run_at <= transaction_timestamp()) AS is_due
         FROM app.checks
         WHERE owner_id = $1 AND id = $2 AND lifecycle_state = 'LIVE'
         FOR UPDATE SKIP LOCKED`,
        [candidate.ownerId, candidate.checkId],
      );
      const check = locked.rows[0];
      if (!check) return { outcome: 'SKIPPED' };

      const active = await client.query(
        `SELECT id FROM monitoring.check_jobs
         WHERE owner_id = $1 AND check_id = $2
           AND state IN ('PENDING', 'LEASED', 'RUNNING')
         FOR UPDATE`,
        [candidate.ownerId, candidate.checkId],
      );
      if (active.rowCount !== 0) return { outcome: 'SKIPPED' };

      const manual = check.manual_requested_at !== null;
      if (!manual && (check.execution_state !== 'ACTIVE' || !check.is_due || !check.next_run_at)) {
        return { outcome: 'SKIPPED' };
      }
      if (manual && check.manual_requested_mode === null) {
        throw new Error('Manual request mode invariant violated.');
      }

      const kind = manual ? 'MANUAL' : 'SCHEDULED';
      const manualMode = manual ? check.manual_requested_mode : null;
      const scheduledFor = manual ? check.manual_requested_at! : check.next_run_at!;
      const priority = manual ? 100 : 0;
      const inserted = await client.query<{
        available_at: Date | string;
        id: string;
      }>(
        `INSERT INTO monitoring.check_jobs
           (owner_id, check_id, trigger_kind, manual_mode, scheduled_for,
            available_at, priority, state, config_snapshot, resource_version,
            probe_generation, schedule_generation)
         VALUES ($1, $2, $3, $4, $5, transaction_timestamp(), $6, 'PENDING',
                 $7::jsonb, $8::bigint, $9::bigint, $10::bigint)
         RETURNING id::text, available_at`,
        [
          candidate.ownerId,
          candidate.checkId,
          kind,
          manualMode,
          scheduledFor,
          priority,
          JSON.stringify(probeSnapshot(check)),
          check.resource_version,
          check.probe_generation,
          check.schedule_generation,
        ],
      );
      const jobId = inserted.rows[0]!.id;
      const availableAt = instant(inserted.rows[0]!.available_at);

      if (manual) {
        const cleared = await client.query(
          `UPDATE app.checks
           SET manual_requested_at = NULL, manual_requested_mode = NULL,
               updated_at = updated_at
           WHERE owner_id = $1 AND id = $2
             AND manual_requested_at IS NOT NULL AND manual_requested_mode = $3`,
          [candidate.ownerId, candidate.checkId, manualMode],
        );
        if (cleared.rowCount !== 1) throw new Error('Manual request changed while locked.');
      } else {
        const advanced = await client.query(
          `UPDATE app.checks
           SET next_run_at = CASE
                 WHEN transaction_timestamp() < cadence_anchor_at THEN cadence_anchor_at
                 ELSE cadence_anchor_at + (
                   (floor(extract(epoch FROM (transaction_timestamp() - cadence_anchor_at))
                          / interval_seconds)::bigint + 1)
                   * interval_seconds * interval '1 second'
                 )
               END,
               updated_at = updated_at
           WHERE owner_id = $1 AND id = $2`,
          [candidate.ownerId, candidate.checkId],
        );
        if (advanced.rowCount !== 1) throw new Error('Scheduled cadence changed while locked.');
      }

      const payload = {
        check_id: candidate.checkId,
        job_id: jobId,
        job_kind: kind,
        not_before: availableAt,
        probe_generation: check.probe_generation,
        schedule_generation: check.schedule_generation,
      };
      await client.query(
        `INSERT INTO audit.events
           (occurred_at, owner_id, actor_type, actor_id, action, resource_type,
            resource_id, correlation_id, result, metadata)
         VALUES (transaction_timestamp(), $1, 'WORKER', $2, 'check.job_available',
                 'check_job', $3, $3, 'SUCCESS', $4::jsonb)`,
        [candidate.ownerId, this.workerId, jobId, JSON.stringify(payload)],
      );
      await writeActivatedOutboxEvent(client, {
        aggregateId: jobId,
        aggregateType: 'check_job',
        aggregateVersion: check.resource_version,
        correlationId: jobId,
        destinations: ['AUDIT'],
        eventType: 'check.job_available',
        ownerId: candidate.ownerId,
        payload,
      });

      return {
        job: {
          checkId: candidate.checkId,
          jobId,
          kind,
          manualMode,
          ownerId: candidate.ownerId,
          scheduledFor: instant(scheduledFor),
        },
        outcome: 'MATERIALIZED',
      };
    });
  }

  async listClaimCandidates(limit: number): Promise<DispatchCandidate[]> {
    requireBatchSize(limit);
    const result = await this.pool.query<{
      check_id: string;
      id: string;
      owner_id: string;
      target_url: string | null;
    }>(
      `WITH ranked AS (
         SELECT j.id, j.owner_id, j.check_id, j.priority, j.available_at, j.created_at,
                CASE WHEN jsonb_typeof(j.config_snapshot->'url') = 'string'
                  THEN j.config_snapshot->>'url' ELSE NULL END AS target_url,
                row_number() OVER (
                  PARTITION BY j.owner_id
                  ORDER BY j.priority DESC, j.available_at, j.created_at, j.id
                ) AS owner_rank
         FROM monitoring.check_jobs AS j
         WHERE j.state = 'PENDING'
           AND j.available_at <= statement_timestamp()
           AND j.attempt_count < j.max_attempts
       )
       SELECT id::text, owner_id::text, check_id::text, target_url
       FROM ranked
       ORDER BY owner_rank, priority DESC, available_at, owner_id, id
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      checkId: row.check_id,
      jobId: row.id,
      ownerId: row.owner_id,
      targetUrl: row.target_url,
    }));
  }

  async claimCandidate(candidate: JobCandidate): Promise<ClaimResult> {
    return inTransaction(this.pool, async (client) => {
      const checkResult = await client.query<{
        next_fencing_token: string;
        timeout_ms: number;
      }>(
        `SELECT next_fencing_token::text, timeout_ms
         FROM app.checks
         WHERE owner_id = $1 AND id = $2
         FOR UPDATE SKIP LOCKED`,
        [candidate.ownerId, candidate.checkId],
      );
      const check = checkResult.rows[0];
      if (!check) return { outcome: 'SKIPPED' };

      const jobResult = await client.query<LockedJobRow>(
        `SELECT attempt_count, config_snapshot, manual_mode, max_attempts,
                probe_generation::text, resource_version::text,
                schedule_generation::text, scheduled_for, trigger_kind
         FROM monitoring.check_jobs
         WHERE owner_id = $1 AND check_id = $2 AND id = $3
           AND state = 'PENDING' AND available_at <= transaction_timestamp()
           AND attempt_count < max_attempts
         FOR UPDATE`,
        [candidate.ownerId, candidate.checkId, candidate.jobId],
      );
      const job = jobResult.rows[0];
      if (!job) return { outcome: 'SKIPPED' };

      const leaseDurationMs = check.timeout_ms + this.leaseGraceMs;
      const fenced = await client.query<{ fencing_token: string }>(
        `UPDATE app.checks
         SET next_fencing_token = next_fencing_token + 1, updated_at = updated_at
         WHERE owner_id = $1 AND id = $2
         RETURNING (next_fencing_token - 1)::text AS fencing_token`,
        [candidate.ownerId, candidate.checkId],
      );
      const fencingToken = fenced.rows[0]!.fencing_token;
      const leased = await client.query<{
        attempt_count: number;
        lease_expires_at: Date | string;
      }>(
        `UPDATE monitoring.check_jobs
         SET state = 'LEASED', attempt_count = attempt_count + 1,
             lease_owner = $4,
             lease_expires_at = transaction_timestamp() + $5::integer * interval '1 millisecond',
             heartbeat_at = transaction_timestamp(), fencing_token = $6::bigint,
             updated_at = transaction_timestamp()
         WHERE owner_id = $1 AND check_id = $2 AND id = $3
           AND state = 'PENDING' AND attempt_count < max_attempts
         RETURNING attempt_count, lease_expires_at`,
        [
          candidate.ownerId,
          candidate.checkId,
          candidate.jobId,
          this.workerId,
          leaseDurationMs,
          fencingToken,
        ],
      );
      if (leased.rowCount !== 1) throw new Error('Pending job changed while locked.');
      const attemptNumber = leased.rows[0]!.attempt_count;
      const attempt = await client.query<{ id: string }>(
        `INSERT INTO monitoring.check_job_attempts
           (owner_id, check_id, job_id, attempt_number, worker_id, fencing_token,
            lease_acquired_at, started_at, last_heartbeat_at)
         VALUES ($1, $2, $3, $4, $5, $6::bigint, transaction_timestamp(),
                 transaction_timestamp(), transaction_timestamp())
         RETURNING id::text`,
        [
          candidate.ownerId,
          candidate.checkId,
          candidate.jobId,
          attemptNumber,
          this.workerId,
          fencingToken,
        ],
      );

      return {
        job: {
          attemptId: attempt.rows[0]!.id,
          attemptNumber,
          checkId: candidate.checkId,
          configSnapshot: job.config_snapshot,
          fencingToken,
          jobId: candidate.jobId,
          leaseDurationMs,
          leaseExpiresAt: instant(leased.rows[0]!.lease_expires_at),
          manualMode: job.manual_mode,
          ownerId: candidate.ownerId,
          probeGeneration: job.probe_generation,
          resourceVersion: job.resource_version,
          scheduleGeneration: job.schedule_generation,
          scheduledFor: instant(job.scheduled_for),
          triggerKind: job.trigger_kind,
        },
        outcome: 'CLAIMED',
      };
    });
  }

  async startClaim(job: ClaimedJob): Promise<LeaseStatus> {
    const result = await this.pool.query<{
      cancellation_reason: string | null;
      lease_expires_at: Date | string | null;
      outcome: 'ACTIVE' | 'CANCELLATION_REQUESTED';
    }>(
      `WITH started AS (
         UPDATE monitoring.check_jobs
         SET state = 'RUNNING', started_at = transaction_timestamp(),
             heartbeat_at = transaction_timestamp(), updated_at = transaction_timestamp()
         WHERE owner_id = $1 AND check_id = $2 AND id = $3
           AND state = 'LEASED' AND lease_owner = $4 AND fencing_token = $5::bigint
           AND lease_expires_at > transaction_timestamp()
           AND cancellation_requested_at IS NULL
           AND EXISTS (
             SELECT 1 FROM monitoring.check_job_attempts AS attempt
             WHERE attempt.owner_id = $1 AND attempt.check_id = $2
               AND attempt.job_id = $3 AND attempt.id = $6
               AND attempt.worker_id = $4 AND attempt.fencing_token = $5::bigint
               AND attempt.ended_at IS NULL
           )
         RETURNING lease_expires_at
       )
       SELECT 'ACTIVE'::text AS outcome, lease_expires_at, NULL::text AS cancellation_reason
       FROM started
       UNION ALL
       SELECT 'CANCELLATION_REQUESTED'::text, NULL::timestamptz, cancellation_reason
       FROM monitoring.check_jobs
       WHERE owner_id = $1 AND check_id = $2 AND id = $3
         AND state IN ('LEASED', 'RUNNING') AND lease_owner = $4
         AND fencing_token = $5::bigint AND cancellation_requested_at IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM monitoring.check_job_attempts AS attempt
           WHERE attempt.owner_id = $1 AND attempt.check_id = $2
             AND attempt.job_id = $3 AND attempt.id = $6
             AND attempt.worker_id = $4 AND attempt.fencing_token = $5::bigint
             AND attempt.ended_at IS NULL
         )
         AND NOT EXISTS (SELECT 1 FROM started)
       LIMIT 1`,
      [job.ownerId, job.checkId, job.jobId, this.workerId, job.fencingToken, job.attemptId],
    );
    const row = result.rows[0];
    if (!row) return { outcome: 'LEASE_LOST' };
    if (row.outcome === 'ACTIVE') {
      return { leaseExpiresAt: instant(row.lease_expires_at!), outcome: 'ACTIVE' };
    }
    return {
      cancellationReason: row.cancellation_reason as CancellationReason,
      outcome: 'CANCELLATION_REQUESTED',
    };
  }

  async heartbeat(job: ClaimedJob): Promise<LeaseStatus> {
    const result = await this.pool.query<{
      cancellation_reason: string | null;
      lease_expires_at: Date | string;
    }>(
      `WITH heartbeat_job AS (
         UPDATE monitoring.check_jobs AS job
         SET heartbeat_at = transaction_timestamp(),
             lease_expires_at = transaction_timestamp() + $7::integer * interval '1 millisecond',
             updated_at = transaction_timestamp()
         WHERE job.owner_id = $1 AND job.check_id = $2 AND job.id = $3
           AND job.state IN ('LEASED', 'RUNNING') AND job.lease_owner = $4
           AND job.fencing_token = $5::bigint
           AND job.lease_expires_at > transaction_timestamp()
           AND EXISTS (
             SELECT 1 FROM monitoring.check_job_attempts AS attempt
             WHERE attempt.owner_id = job.owner_id AND attempt.check_id = job.check_id
               AND attempt.job_id = job.id AND attempt.id = $6
               AND attempt.fencing_token = job.fencing_token AND attempt.ended_at IS NULL
           )
         RETURNING job.heartbeat_at, job.lease_expires_at, job.cancellation_reason
       ), heartbeat_attempt AS (
         UPDATE monitoring.check_job_attempts AS attempt
         SET last_heartbeat_at = heartbeat_job.heartbeat_at
         FROM heartbeat_job
         WHERE attempt.owner_id = $1 AND attempt.check_id = $2
           AND attempt.job_id = $3 AND attempt.id = $6
           AND attempt.fencing_token = $5::bigint AND attempt.ended_at IS NULL
         RETURNING attempt.id
       )
       SELECT cancellation_reason, lease_expires_at
       FROM heartbeat_job
       WHERE EXISTS (SELECT 1 FROM heartbeat_attempt)`,
      [
        job.ownerId,
        job.checkId,
        job.jobId,
        this.workerId,
        job.fencingToken,
        job.attemptId,
        job.leaseDurationMs,
      ],
    );
    const row = result.rows[0];
    if (!row) return { outcome: 'LEASE_LOST' };
    if (row.cancellation_reason) {
      return {
        cancellationReason: row.cancellation_reason as CancellationReason,
        outcome: 'CANCELLATION_REQUESTED',
      };
    }
    return { leaseExpiresAt: instant(row.lease_expires_at), outcome: 'ACTIVE' };
  }

  async settleInfrastructureFault(
    claimed: ClaimedJob,
    code: ProbeInfrastructureErrorCode,
  ): Promise<JobSettlement> {
    return inTransaction(this.pool, async (client) => {
      const check = await this.#lockCheck(client, claimed);
      if (!check) return { outcome: 'STALE' };

      const jobResult = await client.query<LockedActiveJobRow>(
        `SELECT attempt_count, cancellation_reason, cancellation_requested_at,
                config_snapshot, fencing_token::text, lease_expires_at, lease_owner,
                manual_mode, max_attempts, probe_generation::text,
                resource_version::text, schedule_generation::text, scheduled_for,
                state, trigger_kind
         FROM monitoring.check_jobs
         WHERE owner_id = $1 AND check_id = $2 AND id = $3
           AND state IN ('LEASED', 'RUNNING') AND lease_owner = $4
           AND fencing_token = $5::bigint
           AND lease_expires_at > transaction_timestamp()
         FOR UPDATE`,
        [claimed.ownerId, claimed.checkId, claimed.jobId, this.workerId, claimed.fencingToken],
      );
      const job = jobResult.rows[0];
      if (!job) return { outcome: 'STALE' };

      const attempt = await client.query<{ id: string }>(
        `SELECT id::text
         FROM monitoring.check_job_attempts
         WHERE owner_id = $1 AND check_id = $2 AND job_id = $3 AND id = $4
           AND worker_id = $5 AND fencing_token = $6::bigint AND ended_at IS NULL
         FOR UPDATE`,
        [
          claimed.ownerId,
          claimed.checkId,
          claimed.jobId,
          claimed.attemptId,
          this.workerId,
          claimed.fencingToken,
        ],
      );
      if (attempt.rowCount !== 1) return { outcome: 'STALE' };

      if (job.cancellation_requested_at !== null) {
        const ended = await client.query(
          `UPDATE monitoring.check_job_attempts
           SET ended_at = transaction_timestamp(), terminal_reason = 'CANCELLED'
           WHERE owner_id = $1 AND check_id = $2 AND job_id = $3 AND id = $4
             AND ended_at IS NULL`,
          [claimed.ownerId, claimed.checkId, claimed.jobId, claimed.attemptId],
        );
        if (ended.rowCount !== 1) throw new Error('Open attempt changed while locked.');
        const cancelled = await client.query(
          `UPDATE monitoring.check_jobs
           SET state = 'CANCELLED', completed_at = transaction_timestamp(),
               terminal_reason = cancellation_reason,
               lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
               fencing_token = NULL, updated_at = transaction_timestamp()
           WHERE owner_id = $1 AND check_id = $2 AND id = $3
             AND state IN ('LEASED', 'RUNNING') AND lease_owner = $4
             AND fencing_token = $5::bigint`,
          [claimed.ownerId, claimed.checkId, claimed.jobId, this.workerId, claimed.fencingToken],
        );
        if (cancelled.rowCount !== 1) throw new Error('Active job changed while locked.');
        const manualJobId = await this.#materializePendingManualIntent(client, claimed, check);
        return { manualJobId, outcome: 'CANCELLED' };
      }

      const attemptReason = code === 'CANCELLED' ? 'CANCELLED' : 'INTERNAL_ERROR';
      const retryable = code !== 'UNSUPPORTED_JOB_SNAPSHOT';
      if (retryable && job.attempt_count < job.max_attempts) {
        const delayMs = retryBackoffMs(job.attempt_count, claimed.jobId);
        const ended = await client.query(
          `UPDATE monitoring.check_job_attempts
           SET ended_at = transaction_timestamp(), terminal_reason = $5
           WHERE owner_id = $1 AND check_id = $2 AND job_id = $3 AND id = $4
             AND ended_at IS NULL`,
          [claimed.ownerId, claimed.checkId, claimed.jobId, claimed.attemptId, attemptReason],
        );
        if (ended.rowCount !== 1) throw new Error('Open attempt changed while locked.');
        const retried = await client.query<{ available_at: Date | string }>(
          `UPDATE monitoring.check_jobs
           SET state = 'PENDING',
               available_at = transaction_timestamp() + $6::integer * interval '1 millisecond',
               lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
               fencing_token = NULL, started_at = NULL, completed_at = NULL,
               terminal_reason = NULL, cancellation_requested_at = NULL,
               cancellation_reason = NULL, updated_at = transaction_timestamp()
           WHERE owner_id = $1 AND check_id = $2 AND id = $3
             AND state IN ('LEASED', 'RUNNING') AND lease_owner = $4
             AND fencing_token = $5::bigint
           RETURNING available_at`,
          [
            claimed.ownerId,
            claimed.checkId,
            claimed.jobId,
            this.workerId,
            claimed.fencingToken,
            delayMs,
          ],
        );
        if (retried.rowCount !== 1) throw new Error('Active job changed while locked.');
        return {
          nextAvailableAt: instant(retried.rows[0]!.available_at),
          outcome: 'RETRY_SCHEDULED',
        };
      }

      const ended = await client.query(
        `UPDATE monitoring.check_job_attempts
         SET ended_at = transaction_timestamp(), terminal_reason = $5
         WHERE owner_id = $1 AND check_id = $2 AND job_id = $3 AND id = $4
           AND ended_at IS NULL`,
        [claimed.ownerId, claimed.checkId, claimed.jobId, claimed.attemptId, attemptReason],
      );
      if (ended.rowCount !== 1) throw new Error('Open attempt changed while locked.');
      const terminalReason =
        code === 'UNSUPPORTED_JOB_SNAPSHOT'
          ? 'UNSUPPORTED_JOB_SNAPSHOT'
          : `${code}_RETRY_EXHAUSTED`;
      const dead = await client.query(
        `UPDATE monitoring.check_jobs
         SET state = 'DEAD', completed_at = transaction_timestamp(),
             terminal_reason = $6,
             lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
             fencing_token = NULL, updated_at = transaction_timestamp()
         WHERE owner_id = $1 AND check_id = $2 AND id = $3
           AND state IN ('LEASED', 'RUNNING') AND lease_owner = $4
           AND fencing_token = $5::bigint`,
        [
          claimed.ownerId,
          claimed.checkId,
          claimed.jobId,
          this.workerId,
          claimed.fencingToken,
          terminalReason,
        ],
      );
      if (dead.rowCount !== 1) throw new Error('Active job changed while locked.');
      const manualJobId = await this.#materializePendingManualIntent(client, claimed, check);
      return { manualJobId, outcome: 'DEAD' };
    });
  }

  async listExpiredLeaseCandidates(limit: number): Promise<JobCandidate[]> {
    requireBatchSize(limit);
    const result = await this.pool.query<{ check_id: string; id: string; owner_id: string }>(
      `WITH ranked AS (
         SELECT j.id, j.owner_id, j.check_id, j.lease_expires_at,
                row_number() OVER (
                  PARTITION BY j.owner_id
                  ORDER BY j.lease_expires_at, j.id
                ) AS owner_rank
         FROM monitoring.check_jobs AS j
         WHERE j.state IN ('LEASED', 'RUNNING')
           AND j.lease_expires_at <= statement_timestamp()
       )
       SELECT id::text, owner_id::text, check_id::text
       FROM ranked
       ORDER BY owner_rank, lease_expires_at, owner_id, id
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      checkId: row.check_id,
      jobId: row.id,
      ownerId: row.owner_id,
    }));
  }

  async recoverExpiredBatch(limit: number): Promise<JobSettlement[]> {
    const candidates = await this.listExpiredLeaseCandidates(limit);
    const settlements: JobSettlement[] = [];
    for (const candidate of candidates) {
      settlements.push(await this.recoverExpiredLease(candidate));
    }
    return settlements;
  }

  async recoverExpiredLease(candidate: JobCandidate): Promise<JobSettlement> {
    return inTransaction(this.pool, async (client) => {
      const check = await this.#lockCheck(client, candidate);
      if (!check) return { outcome: 'STALE' };

      const jobResult = await client.query<LockedActiveJobRow>(
        `SELECT attempt_count, cancellation_reason, cancellation_requested_at,
                config_snapshot, fencing_token::text, lease_expires_at, lease_owner,
                manual_mode, max_attempts, probe_generation::text,
                resource_version::text, schedule_generation::text, scheduled_for,
                state, trigger_kind
         FROM monitoring.check_jobs
         WHERE owner_id = $1 AND check_id = $2 AND id = $3
           AND state IN ('LEASED', 'RUNNING')
           AND lease_expires_at <= transaction_timestamp()
         FOR UPDATE`,
        [candidate.ownerId, candidate.checkId, candidate.jobId],
      );
      const job = jobResult.rows[0];
      if (!job) return { outcome: 'STALE' };

      const attempt = await client.query<{ id: string }>(
        `SELECT id::text
         FROM monitoring.check_job_attempts
         WHERE owner_id = $1 AND check_id = $2 AND job_id = $3
           AND fencing_token = $4::bigint AND ended_at IS NULL
         FOR UPDATE`,
        [candidate.ownerId, candidate.checkId, candidate.jobId, job.fencing_token],
      );
      const attemptId = attempt.rows[0]?.id;
      if (!attemptId || attempt.rowCount !== 1) {
        throw new Error('Expired active job does not have exactly one open attempt.');
      }

      let cancellationReason = job.cancellation_reason;
      if (!cancellationReason && check.lifecycle_state === 'DELETED') {
        cancellationReason = 'CHECK_DELETED';
      }
      if (
        !cancellationReason &&
        (job.probe_generation !== check.probe_generation ||
          job.schedule_generation !== check.schedule_generation)
      ) {
        cancellationReason = 'CONFIGURATION_CHANGED';
      }
      if (
        !cancellationReason &&
        check.execution_state === 'PAUSED' &&
        !(job.trigger_kind === 'MANUAL' && job.manual_mode === 'DIAGNOSTIC')
      ) {
        cancellationReason = 'CHECK_PAUSED';
      }

      if (cancellationReason) {
        const ended = await client.query(
          `UPDATE monitoring.check_job_attempts
           SET ended_at = transaction_timestamp(), terminal_reason = 'CANCELLED'
           WHERE owner_id = $1 AND check_id = $2 AND job_id = $3 AND id = $4
             AND ended_at IS NULL`,
          [candidate.ownerId, candidate.checkId, candidate.jobId, attemptId],
        );
        if (ended.rowCount !== 1) throw new Error('Open attempt changed while locked.');
        const cancelled = await client.query(
          `UPDATE monitoring.check_jobs
           SET state = 'CANCELLED', completed_at = transaction_timestamp(),
               terminal_reason = $4,
               cancellation_requested_at = COALESCE(cancellation_requested_at, transaction_timestamp()),
               cancellation_reason = $4,
               lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
               fencing_token = NULL, updated_at = transaction_timestamp()
           WHERE owner_id = $1 AND check_id = $2 AND id = $3
             AND state IN ('LEASED', 'RUNNING')`,
          [candidate.ownerId, candidate.checkId, candidate.jobId, cancellationReason],
        );
        if (cancelled.rowCount !== 1) throw new Error('Expired job changed while locked.');
        const manualJobId = await this.#materializePendingManualIntent(client, candidate, check);
        return { manualJobId, outcome: 'CANCELLED' };
      }

      const ended = await client.query(
        `UPDATE monitoring.check_job_attempts
         SET ended_at = transaction_timestamp(), terminal_reason = 'LEASE_LOST'
         WHERE owner_id = $1 AND check_id = $2 AND job_id = $3 AND id = $4
           AND ended_at IS NULL`,
        [candidate.ownerId, candidate.checkId, candidate.jobId, attemptId],
      );
      if (ended.rowCount !== 1) throw new Error('Open attempt changed while locked.');

      if (job.attempt_count < job.max_attempts) {
        const delayMs = retryBackoffMs(job.attempt_count, candidate.jobId);
        const retried = await client.query<{ available_at: Date | string }>(
          `UPDATE monitoring.check_jobs
           SET state = 'PENDING',
               available_at = transaction_timestamp() + $4::integer * interval '1 millisecond',
               lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
               fencing_token = NULL, started_at = NULL, completed_at = NULL,
               terminal_reason = NULL, cancellation_requested_at = NULL,
               cancellation_reason = NULL, updated_at = transaction_timestamp()
           WHERE owner_id = $1 AND check_id = $2 AND id = $3
             AND state IN ('LEASED', 'RUNNING')
           RETURNING available_at`,
          [candidate.ownerId, candidate.checkId, candidate.jobId, delayMs],
        );
        if (retried.rowCount !== 1) throw new Error('Expired job changed while locked.');
        return {
          nextAvailableAt: instant(retried.rows[0]!.available_at),
          outcome: 'RETRY_SCHEDULED',
        };
      }

      const dead = await client.query(
        `UPDATE monitoring.check_jobs
         SET state = 'DEAD', completed_at = transaction_timestamp(),
             terminal_reason = 'LEASE_RETRY_EXHAUSTED',
             lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
             fencing_token = NULL, updated_at = transaction_timestamp()
         WHERE owner_id = $1 AND check_id = $2 AND id = $3
           AND state IN ('LEASED', 'RUNNING')`,
        [candidate.ownerId, candidate.checkId, candidate.jobId],
      );
      if (dead.rowCount !== 1) throw new Error('Expired job changed while locked.');
      const manualJobId = await this.#materializePendingManualIntent(client, candidate, check);
      return { manualJobId, outcome: 'DEAD' };
    });
  }
}
