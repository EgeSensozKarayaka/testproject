import type { Pool, PoolClient } from '@site-monitor/database';
import { writeActivatedOutboxEvent } from '@site-monitor/database';

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

type CancellationReason = 'CHECK_DELETED' | 'CHECK_PAUSED' | 'CONFIGURATION_CHANGED';

export type LeaseStatus =
  | { outcome: 'ACTIVE'; leaseExpiresAt: string }
  | {
      cancellationReason: CancellationReason;
      outcome: 'CANCELLATION_REQUESTED';
    }
  | { outcome: 'LEASE_LOST' };

interface LockedCheckRow {
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
             AND manual_requested_at = $3 AND manual_requested_mode = $4`,
          [candidate.ownerId, candidate.checkId, scheduledFor, manualMode],
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
           WHERE owner_id = $1 AND id = $2 AND next_run_at = $3`,
          [candidate.ownerId, candidate.checkId, scheduledFor],
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
}
