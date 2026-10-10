import type { ProbeInfrastructureErrorCode, ProbeResult } from '@site-monitor/check-engine';
import type { Pool, PoolClient } from '@site-monitor/database';
import { writeActivatedOutboxEvent } from '@site-monitor/database';
import {
  decideObservationAcceptance,
  planObservationTransition,
  type AcceptedObservationTransition,
  type CurrentHealthSnapshot,
  type IncidentEffect,
  type MonitoringEventFact,
  type ObservationRejectionReason,
  type ObservationTransition,
  type OpenHealthIntervalSnapshot,
  type OpenIncidentSegmentSnapshot,
  type OpenIncidentSnapshot,
} from '@site-monitor/domain';

import type { JobExecutionSink } from './dispatcher.js';
import {
  materializePendingManualIntent,
  type ClaimedJob,
  type LockedCheckRow,
  type PostgresJobQueue,
} from './job-queue.js';

interface LockedObservationCheckRow extends LockedCheckRow {
  group_id: string | null;
}

interface LockedObservationJobRow {
  cancellation_reason: 'CHECK_DELETED' | 'CHECK_PAUSED' | 'CONFIGURATION_CHANGED' | null;
  cancellation_requested_at: Date | string | null;
  fencing_token: string | null;
  lease_expires_at: Date | string | null;
  lease_owner: string | null;
  manual_mode: 'DIAGNOSTIC' | 'STATEFUL' | null;
  probe_generation: string;
  resource_version: string;
  schedule_generation: string;
  state: 'CANCELLED' | 'COMPLETED' | 'DEAD' | 'LEASED' | 'PENDING' | 'RUNNING';
  trigger_kind: 'MANUAL' | 'SCHEDULED';
}

interface LockedAttemptRow {
  ended_at: Date | string | null;
  fencing_token: string;
  result_recorded_at: Date | string | null;
  result_run_finished_at: Date | string | null;
  result_run_id: string | null;
  terminal_reason: 'CANCELLED' | 'INTERNAL_ERROR' | 'LEASE_LOST' | 'RESULT_RECORDED' | null;
  worker_id: string;
}

interface CurrentStateRow {
  candidate_run_finished_at: Date | string | null;
  candidate_run_id: string | null;
  candidate_started_at: Date | string | null;
  consecutive_failure_count: number;
  fresh_until: Date | string | null;
  freshness_state: 'FRESH' | 'STALE';
  health_state: 'DOWN' | 'SUSPECT' | 'UNKNOWN' | 'UP';
  last_accepted_fencing_token: string;
  last_accepted_run_finished_at: Date | string | null;
  last_accepted_run_id: string | null;
  last_failure_at: Date | string | null;
  last_failure_category: string | null;
  last_response_time_ms: number | null;
  last_status_code: number | null;
  last_success_at: Date | string | null;
  open_incident_id: string | null;
  stale_reconciled_at: Date | string | null;
  state_version: string;
}

interface OpenIncidentRow {
  confirmed_at: Date | string;
  id: string;
  last_failure_category: string | null;
  observation_mode: 'OBSERVED' | 'UNOBSERVED';
  observed_duration_ms: string;
  resource_version: string;
  started_at: Date | string;
}

interface OpenSegmentRow {
  id: string;
  incident_id: string;
  start_run_finished_at: Date | string;
  start_run_id: string;
  started_at: Date | string;
}

interface OpenIntervalRow {
  classification: 'DOWN' | 'PROVISIONAL' | 'UNKNOWN' | 'UP';
  id: string;
  probe_generation: string;
  source_kind: 'CONFIG' | 'FRESHNESS' | 'PAUSE' | 'RESUME' | 'RUN' | 'STARTUP';
  source_run_finished_at: Date | string | null;
  source_run_id: string | null;
  started_at: Date | string;
}

interface AllocationsRow {
  finished_at: Date | string;
  incident_id: string;
  interval_id_1: string;
  interval_id_2: string;
  observed_at: Date | string;
  run_id: string;
  segment_id: string;
}

export interface ObservationPersistenceResult {
  accepted: boolean;
  duplicate: boolean;
  finishedAt: string;
  jobOutcome: 'CANCELLED' | 'COMPLETED' | 'UNCHANGED';
  rejectionReason: ObservationRejectionReason | null;
  runId: string;
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

function instant(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function milliseconds(value: Date | string): number {
  return (value instanceof Date ? value : new Date(value)).getTime();
}

function optionalMilliseconds(value: Date | string | null): number | null {
  return value === null ? null : milliseconds(value);
}

function timestamp(value: number | null): Date | null {
  return value === null ? null : new Date(value);
}

function exactlyOne(rowCount: number | null, message: string): void {
  if (rowCount !== 1) throw new Error(message);
}

function currentSnapshot(row: CurrentStateRow): CurrentHealthSnapshot {
  if (![0, 1, 2].includes(row.consecutive_failure_count)) {
    throw new Error('Current-state failure count is outside the v1 policy.');
  }
  const candidate =
    row.candidate_run_id === null ||
    row.candidate_run_finished_at === null ||
    row.candidate_started_at === null
      ? null
      : {
          run: {
            finishedAtMs: milliseconds(row.candidate_run_finished_at),
            id: row.candidate_run_id,
          },
          startedAtMs: milliseconds(row.candidate_started_at),
        };
  const lastAcceptedRun =
    row.last_accepted_run_id === null || row.last_accepted_run_finished_at === null
      ? null
      : {
          finishedAtMs: milliseconds(row.last_accepted_run_finished_at),
          id: row.last_accepted_run_id,
        };
  return {
    candidate,
    consecutiveFailureCount: row.consecutive_failure_count as 0 | 1 | 2,
    freshUntilMs: optionalMilliseconds(row.fresh_until),
    freshnessState: row.freshness_state,
    healthState: row.health_state,
    lastAcceptedFencingToken: BigInt(row.last_accepted_fencing_token),
    lastAcceptedRun,
    lastFailureAtMs: optionalMilliseconds(row.last_failure_at),
    lastFailureCategory: row.last_failure_category,
    lastResponseTimeMs: row.last_response_time_ms,
    lastStatusCode: row.last_status_code,
    lastSuccessAtMs: optionalMilliseconds(row.last_success_at),
    openIncidentId: row.open_incident_id,
    staleReconciledAtMs: optionalMilliseconds(row.stale_reconciled_at),
    stateVersion: BigInt(row.state_version),
  };
}

function incidentSnapshot(row: OpenIncidentRow | undefined): OpenIncidentSnapshot | null {
  return row
    ? {
        confirmedAtMs: milliseconds(row.confirmed_at),
        id: row.id,
        lastFailureCategory: row.last_failure_category,
        observationMode: row.observation_mode,
        observedDurationMs: BigInt(row.observed_duration_ms),
        resourceVersion: BigInt(row.resource_version),
        startedAtMs: milliseconds(row.started_at),
      }
    : null;
}

function segmentSnapshot(row: OpenSegmentRow | undefined): OpenIncidentSegmentSnapshot | null {
  return row
    ? {
        id: row.id,
        incidentId: row.incident_id,
        startRun: {
          finishedAtMs: milliseconds(row.start_run_finished_at),
          id: row.start_run_id,
        },
        startedAtMs: milliseconds(row.started_at),
      }
    : null;
}

function intervalSnapshot(row: OpenIntervalRow): OpenHealthIntervalSnapshot {
  const sourceRun =
    row.source_run_id === null || row.source_run_finished_at === null
      ? null
      : {
          finishedAtMs: milliseconds(row.source_run_finished_at),
          id: row.source_run_id,
        };
  return {
    classification: row.classification,
    id: row.id,
    probeGeneration: BigInt(row.probe_generation),
    source: row.source_kind,
    sourceRun,
    startedAtMs: milliseconds(row.started_at),
  };
}

function transitionTime(value: number): string {
  return new Date(value).toISOString();
}

function isAcceptedTransition(
  transition: ObservationTransition,
): transition is AcceptedObservationTransition {
  return transition.acceptance.accepted;
}

export class PostgresObservationStore implements JobExecutionSink {
  constructor(
    private readonly pool: Pool,
    private readonly workerId: string,
    private readonly schedulerGraceMs: number,
    private readonly queue: PostgresJobQueue,
  ) {
    if (!Number.isInteger(schedulerGraceMs) || schedulerGraceMs < 0 || schedulerGraceMs > 60_000) {
      throw new TypeError('schedulerGraceMs must be an integer from 0 through 60000.');
    }
  }

  async recordInfrastructureFault(
    job: ClaimedJob,
    code: ProbeInfrastructureErrorCode,
  ): Promise<void> {
    await this.queue.settleInfrastructureFault(job, code);
  }

  async recordResult(job: ClaimedJob, result: ProbeResult): Promise<void> {
    await this.persistResult(job, result);
  }

  async persistResult(
    claimed: ClaimedJob,
    result: ProbeResult,
  ): Promise<ObservationPersistenceResult> {
    return inTransaction(this.pool, async (client) => {
      const checkResult = await client.query<LockedObservationCheckRow>(
        `SELECT cadence_anchor_at, execution_state, expected_body_substring,
                expected_status_code, group_id, interval_seconds, lifecycle_state,
                manual_requested_at, manual_requested_mode, next_run_at,
                probe_generation::text, resource_version::text,
                schedule_generation::text, timeout_ms, url,
                (next_run_at IS NOT NULL AND next_run_at <= transaction_timestamp()) AS is_due
         FROM app.checks
         WHERE owner_id = $1 AND id = $2
         FOR UPDATE`,
        [claimed.ownerId, claimed.checkId],
      );
      const check = checkResult.rows[0];
      if (!check) throw new Error('Claimed check no longer exists.');

      const jobResult = await client.query<LockedObservationJobRow>(
        `SELECT cancellation_reason, cancellation_requested_at, fencing_token::text,
                lease_expires_at, lease_owner, manual_mode, probe_generation::text,
                resource_version::text, schedule_generation::text, state, trigger_kind
         FROM monitoring.check_jobs
         WHERE owner_id = $1 AND check_id = $2 AND id = $3
         FOR UPDATE`,
        [claimed.ownerId, claimed.checkId, claimed.jobId],
      );
      const persistedJob = jobResult.rows[0];
      if (!persistedJob) throw new Error('Claimed job no longer exists.');

      const attemptResult = await client.query<LockedAttemptRow>(
        `SELECT ended_at, fencing_token::text, result_recorded_at,
                result_run_finished_at, result_run_id, terminal_reason, worker_id
         FROM monitoring.check_job_attempts
         WHERE owner_id = $1 AND check_id = $2 AND job_id = $3 AND id = $4
         FOR UPDATE`,
        [claimed.ownerId, claimed.checkId, claimed.jobId, claimed.attemptId],
      );
      const attempt = attemptResult.rows[0];
      if (!attempt) throw new Error('Claimed attempt no longer exists.');

      if (attempt.result_recorded_at !== null) {
        if (attempt.result_run_finished_at === null || attempt.result_run_id === null) {
          throw new Error('Recorded attempt is missing its run pointer.');
        }
        const existing = await client.query<{
          accepted_for_state: boolean;
          finished_at: Date | string;
          id: string;
          rejection_reason: ObservationRejectionReason | null;
        }>(
          `SELECT id::text, finished_at, accepted_for_state, rejection_reason
           FROM monitoring.check_runs
           WHERE owner_id = $1 AND check_id = $2 AND finished_at = $3 AND id = $4`,
          [claimed.ownerId, claimed.checkId, attempt.result_run_finished_at, attempt.result_run_id],
        );
        const run = existing.rows[0];
        if (!run) throw new Error('Recorded attempt points to a missing run.');
        return {
          accepted: run.accepted_for_state,
          duplicate: true,
          finishedAt: instant(run.finished_at),
          jobOutcome:
            persistedJob.state === 'COMPLETED'
              ? 'COMPLETED'
              : persistedJob.state === 'CANCELLED'
                ? 'CANCELLED'
                : 'UNCHANGED',
          rejectionReason: run.rejection_reason,
          runId: run.id,
        };
      }

      const currentResult = await client.query<CurrentStateRow>(
        `SELECT candidate_run_finished_at, candidate_run_id, candidate_started_at,
                consecutive_failure_count, fresh_until, freshness_state, health_state,
                last_accepted_fencing_token::text, last_accepted_run_finished_at,
                last_accepted_run_id, last_failure_at, last_failure_category,
                last_response_time_ms, last_status_code, last_success_at,
                open_incident_id, stale_reconciled_at, state_version::text
         FROM monitoring.check_current_states
         WHERE owner_id = $1 AND check_id = $2
         FOR UPDATE`,
        [claimed.ownerId, claimed.checkId],
      );
      const currentRow = currentResult.rows[0];
      if (!currentRow) throw new Error('Check current state is missing.');
      const current = currentSnapshot(currentRow);

      const allocationResult = await client.query<AllocationsRow>(
        `SELECT clock.observed_at,
                GREATEST(
                  clock.observed_at,
                  date_trunc('milliseconds', attempt.started_at) + interval '1 millisecond',
                  COALESCE(
                    date_trunc('milliseconds', state.last_accepted_run_finished_at)
                      + interval '1 millisecond',
                    '-infinity'::timestamptz
                  )
                ) AS finished_at,
                uuidv7()::text AS run_id, uuidv7()::text AS incident_id,
                uuidv7()::text AS segment_id, uuidv7()::text AS interval_id_1,
                uuidv7()::text AS interval_id_2
         FROM monitoring.check_job_attempts AS attempt
         JOIN monitoring.check_current_states AS state
           ON state.owner_id = attempt.owner_id AND state.check_id = attempt.check_id
         CROSS JOIN LATERAL (
           SELECT date_trunc('milliseconds', clock_timestamp()) AS observed_at
         ) AS clock
         WHERE attempt.owner_id = $1 AND attempt.check_id = $2
           AND attempt.job_id = $3 AND attempt.id = $4`,
        [claimed.ownerId, claimed.checkId, claimed.jobId, claimed.attemptId],
      );
      const allocations = allocationResult.rows[0];
      if (!allocations) throw new Error('Could not allocate canonical observation identity.');
      const finishedAtMs = milliseconds(allocations.finished_at);
      const observedAtMs = milliseconds(allocations.observed_at);

      const activeJob = persistedJob.state === 'LEASED' || persistedJob.state === 'RUNNING';
      const sameClaim =
        activeJob &&
        persistedJob.lease_owner === this.workerId &&
        persistedJob.fencing_token === claimed.fencingToken &&
        attempt.worker_id === this.workerId &&
        attempt.fencing_token === claimed.fencingToken &&
        attempt.ended_at === null;
      const leaseCurrent =
        sameClaim &&
        persistedJob.cancellation_requested_at === null &&
        persistedJob.lease_expires_at !== null &&
        milliseconds(persistedJob.lease_expires_at) > observedAtMs;
      const cancellationAcknowledged = sameClaim && persistedJob.cancellation_requested_at !== null;

      const observation = {
        alreadyRecorded: false,
        attemptCurrent: leaseCurrent,
        failureCategory: result.failureCategory,
        fencingToken: BigInt(claimed.fencingToken),
        manualMode: persistedJob.manual_mode,
        outcome: result.outcome,
        probeGeneration: BigInt(persistedJob.probe_generation),
        run: { finishedAtMs, id: allocations.run_id },
        scheduleGeneration: BigInt(persistedJob.schedule_generation),
        statusCode: result.statusCode,
        totalMs: result.timings.totalMs,
      } as const;
      const checkSnapshot = {
        executionState: check.execution_state,
        groupId: check.group_id,
        intervalSeconds: check.interval_seconds,
        lifecycleState:
          check.lifecycle_state === 'LIVE' ? ('ACTIVE' as const) : ('DELETED' as const),
        probeGeneration: BigInt(check.probe_generation),
        scheduleGeneration: BigInt(check.schedule_generation),
        timeoutMs: check.timeout_ms,
      };
      const acceptance = decideObservationAcceptance(checkSnapshot, current, observation);

      let transition: ObservationTransition;
      if (!acceptance.accepted) {
        transition = {
          acceptance,
          eventFacts:
            acceptance.reason === 'DUPLICATE_RUN'
              ? []
              : [
                  {
                    kind: 'OBSERVATION_REJECTED',
                    reason: acceptance.reason,
                    run: observation.run,
                  },
                ],
        };
      } else {
        const incidentResult = await client.query<OpenIncidentRow>(
          `SELECT confirmed_at, id::text, last_failure_category, observation_mode,
                  observed_duration_ms::text, resource_version::text, started_at
           FROM monitoring.incidents
           WHERE owner_id = $1 AND check_id = $2 AND status = 'OPEN'
           FOR UPDATE`,
          [claimed.ownerId, claimed.checkId],
        );
        const incidentRow = incidentResult.rows[0];
        const segmentResult = incidentRow
          ? await client.query<OpenSegmentRow>(
              `SELECT id::text, incident_id::text, start_run_finished_at,
                      start_run_id::text, started_at
               FROM monitoring.incident_segments
               WHERE owner_id = $1 AND check_id = $2 AND incident_id = $3
                 AND ended_at IS NULL
               FOR UPDATE`,
              [claimed.ownerId, claimed.checkId, incidentRow.id],
            )
          : null;
        const intervalResult = await client.query<OpenIntervalRow>(
          `SELECT classification, id::text, probe_generation::text, source_kind,
                  source_run_finished_at, source_run_id::text, started_at
           FROM monitoring.open_health_intervals
           WHERE owner_id = $1 AND check_id = $2
           FOR UPDATE`,
          [claimed.ownerId, claimed.checkId],
        );
        const intervalRow = intervalResult.rows[0];
        if (!intervalRow) throw new Error('Accepted observation has no open health interval.');
        transition = planObservationTransition({
          allocations: {
            incidentId: allocations.incident_id,
            intervalIds: [allocations.interval_id_1, allocations.interval_id_2],
            segmentId: allocations.segment_id,
          },
          check: checkSnapshot,
          current,
          incident: incidentSnapshot(incidentRow),
          observation,
          openInterval: intervalSnapshot(intervalRow),
          openSegment: segmentSnapshot(segmentResult?.rows[0]),
          schedulerGraceMs: this.schedulerGraceMs,
        });
      }

      await this.#insertRun(client, claimed, persistedJob, result, allocations, transition);
      if (isAcceptedTransition(transition)) {
        await this.#applyAcceptedTransition(client, claimed, current, transition, result);
      }
      await this.#writeEvents(client, claimed, check, current, transition, result);

      const attemptTerminal = leaseCurrent
        ? 'RESULT_RECORDED'
        : cancellationAcknowledged
          ? 'CANCELLED'
          : attempt.terminal_reason;
      const marked = await client.query(
        `UPDATE monitoring.check_job_attempts
         SET result_recorded_at = transaction_timestamp(),
             result_run_finished_at = $5, result_run_id = $6,
             ended_at = CASE WHEN $7::text IS NOT NULL AND ended_at IS NULL THEN $5 ELSE ended_at END,
             terminal_reason = CASE
               WHEN $7::text IS NOT NULL AND ended_at IS NULL THEN $7
               ELSE terminal_reason END
         WHERE owner_id = $1 AND check_id = $2 AND job_id = $3 AND id = $4
           AND result_recorded_at IS NULL`,
        [
          claimed.ownerId,
          claimed.checkId,
          claimed.jobId,
          claimed.attemptId,
          allocations.finished_at,
          allocations.run_id,
          attemptTerminal,
        ],
      );
      exactlyOne(marked.rowCount, 'Attempt result marker changed while locked.');

      let jobOutcome: ObservationPersistenceResult['jobOutcome'] = 'UNCHANGED';
      if (leaseCurrent) {
        const completed = await client.query(
          `UPDATE monitoring.check_jobs
           SET state = 'COMPLETED', completed_at = $6, terminal_reason = 'RESULT_RECORDED',
               lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
               fencing_token = NULL, updated_at = transaction_timestamp()
           WHERE owner_id = $1 AND check_id = $2 AND id = $3
             AND state IN ('LEASED', 'RUNNING') AND lease_owner = $4
             AND fencing_token = $5::bigint AND cancellation_requested_at IS NULL`,
          [
            claimed.ownerId,
            claimed.checkId,
            claimed.jobId,
            this.workerId,
            claimed.fencingToken,
            allocations.finished_at,
          ],
        );
        exactlyOne(completed.rowCount, 'Current result job changed while locked.');
        jobOutcome = 'COMPLETED';
      } else if (cancellationAcknowledged) {
        const cancelled = await client.query(
          `UPDATE monitoring.check_jobs
           SET state = 'CANCELLED', completed_at = $6,
               terminal_reason = cancellation_reason,
               lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
               fencing_token = NULL, updated_at = transaction_timestamp()
           WHERE owner_id = $1 AND check_id = $2 AND id = $3
             AND state IN ('LEASED', 'RUNNING') AND lease_owner = $4
             AND fencing_token = $5::bigint AND cancellation_requested_at IS NOT NULL`,
          [
            claimed.ownerId,
            claimed.checkId,
            claimed.jobId,
            this.workerId,
            claimed.fencingToken,
            allocations.finished_at,
          ],
        );
        exactlyOne(cancelled.rowCount, 'Cancelled result job changed while locked.');
        jobOutcome = 'CANCELLED';
      }

      if (jobOutcome !== 'UNCHANGED') {
        await materializePendingManualIntent(client, claimed, check, this.workerId);
      }

      return {
        accepted: transition.acceptance.accepted,
        duplicate: false,
        finishedAt: instant(allocations.finished_at),
        jobOutcome,
        rejectionReason: transition.acceptance.accepted ? null : transition.acceptance.reason,
        runId: allocations.run_id,
      };
    });
  }

  async #insertRun(
    client: PoolClient,
    claimed: ClaimedJob,
    job: LockedObservationJobRow,
    result: ProbeResult,
    allocations: AllocationsRow,
    transition: ObservationTransition,
  ): Promise<void> {
    const inserted = await client.query(
      `INSERT INTO monitoring.check_runs
         (finished_at, id, owner_id, check_id, job_id, attempt_id,
          trigger_kind, manual_mode, resource_version, probe_generation,
          schedule_generation, fencing_token, scheduled_for, started_at,
          dns_ms, connect_ms, tls_ms, ttfb_ms, total_ms, status_code,
          body_match, outcome, failure_category, diagnostic,
          accepted_for_state, rejection_reason)
       SELECT $5, $6, job.owner_id, job.check_id, job.id, attempt.id,
              job.trigger_kind, job.manual_mode, job.resource_version,
              job.probe_generation, job.schedule_generation, attempt.fencing_token,
              job.scheduled_for, attempt.started_at,
              $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
              $17, $18
       FROM monitoring.check_jobs AS job
       JOIN monitoring.check_job_attempts AS attempt
         ON attempt.owner_id = job.owner_id AND attempt.check_id = job.check_id
        AND attempt.job_id = job.id AND attempt.id = $4
       WHERE job.owner_id = $1 AND job.check_id = $2 AND job.id = $3`,
      [
        claimed.ownerId,
        claimed.checkId,
        claimed.jobId,
        claimed.attemptId,
        allocations.finished_at,
        allocations.run_id,
        result.timings.dnsMs,
        result.timings.connectMs,
        result.timings.tlsMs,
        result.timings.ttfbMs,
        result.timings.totalMs,
        result.statusCode,
        result.bodyMatch,
        result.outcome,
        result.failureCategory,
        result.diagnosticCode,
        transition.acceptance.accepted,
        transition.acceptance.accepted ? null : transition.acceptance.reason,
      ],
    );
    exactlyOne(inserted.rowCount, 'Run lineage changed while locked.');
    if (
      job.resource_version !== claimed.resourceVersion ||
      job.probe_generation !== claimed.probeGeneration ||
      job.schedule_generation !== claimed.scheduleGeneration
    ) {
      throw new Error('Claimed job metadata differs from its persisted snapshot.');
    }
  }

  async #applyAcceptedTransition(
    client: PoolClient,
    claimed: ClaimedJob,
    previousCurrent: CurrentHealthSnapshot,
    transition: AcceptedObservationTransition,
    result: ProbeResult,
  ): Promise<void> {
    let openInterval = await this.#loadOpenInterval(client, claimed);
    for (const effect of transition.intervalEffects) {
      if (effect.kind === 'FINALIZE_INTERVAL') {
        if (
          openInterval.id !== effect.intervalId ||
          milliseconds(openInterval.started_at) !== effect.startedAtMs
        ) {
          throw new Error('Interval finalize effect does not match the locked open interval.');
        }
        const inserted = await client.query(
          `INSERT INTO monitoring.health_intervals
             (started_at, id, owner_id, check_id, ended_at, classification,
              probe_generation, source_kind, source_run_id, source_run_finished_at)
           SELECT started_at, id, owner_id, check_id, $4, $5,
                  probe_generation, source_kind, source_run_id, source_run_finished_at
           FROM monitoring.open_health_intervals
           WHERE owner_id = $1 AND check_id = $2 AND id = $3`,
          [
            claimed.ownerId,
            claimed.checkId,
            effect.intervalId,
            new Date(effect.endedAtMs),
            effect.classification,
          ],
        );
        exactlyOne(inserted.rowCount, 'Open interval changed before finalization.');
        continue;
      }

      const next = effect.interval;
      const updated = await client.query(
        `UPDATE monitoring.open_health_intervals
         SET id = $4, classification = $5, started_at = $6,
             probe_generation = $7::bigint, source_kind = $8,
             source_run_id = $9, source_run_finished_at = $10,
             updated_at = transaction_timestamp()
         WHERE owner_id = $1 AND check_id = $2 AND id = $3`,
        [
          claimed.ownerId,
          claimed.checkId,
          openInterval.id,
          next.id,
          next.classification,
          new Date(next.startedAtMs),
          next.probeGeneration.toString(),
          next.source,
          next.sourceRun?.id ?? null,
          timestamp(next.sourceRun?.finishedAtMs ?? null),
        ],
      );
      exactlyOne(updated.rowCount, 'Open interval changed while applying transition.');
      openInterval = {
        classification: next.classification,
        id: next.id,
        probe_generation: next.probeGeneration.toString(),
        source_kind: next.source,
        source_run_finished_at: timestamp(next.sourceRun?.finishedAtMs ?? null),
        source_run_id: next.sourceRun?.id ?? null,
        started_at: new Date(next.startedAtMs),
      };
    }

    for (const effect of transition.incidentEffects) {
      await this.#applyIncidentEffect(client, claimed, effect, transition);
    }

    const next = transition.current;
    const state = await client.query(
      `UPDATE monitoring.check_current_states
       SET health_state = $4, freshness_state = $5,
           consecutive_failure_count = $6,
           candidate_started_at = $7, candidate_run_id = $8,
           candidate_run_finished_at = $9, open_incident_id = $10,
           last_accepted_run_id = $11, last_accepted_run_finished_at = $12,
           last_accepted_fencing_token = $13::bigint,
           last_success_at = $14, last_failure_at = $15,
           last_response_time_ms = $16, last_status_code = $17,
           last_failure_category = $18, fresh_until = $19,
           stale_reconciled_at = $20, state_version = $21::bigint,
           updated_at = transaction_timestamp()
       WHERE owner_id = $1 AND check_id = $2 AND state_version = $3::bigint`,
      [
        claimed.ownerId,
        claimed.checkId,
        previousCurrent.stateVersion.toString(),
        next.healthState,
        next.freshnessState,
        next.consecutiveFailureCount,
        timestamp(next.candidate?.startedAtMs ?? null),
        next.candidate?.run.id ?? null,
        timestamp(next.candidate?.run.finishedAtMs ?? null),
        next.openIncidentId,
        next.lastAcceptedRun?.id ?? null,
        timestamp(next.lastAcceptedRun?.finishedAtMs ?? null),
        next.lastAcceptedFencingToken.toString(),
        timestamp(next.lastSuccessAtMs),
        timestamp(next.lastFailureAtMs),
        next.lastResponseTimeMs,
        next.lastStatusCode,
        next.lastFailureCategory,
        timestamp(next.freshUntilMs),
        timestamp(next.staleReconciledAtMs),
        next.stateVersion.toString(),
      ],
    );
    exactlyOne(state.rowCount, 'Current state changed while applying transition.');
    if (next.lastResponseTimeMs !== result.timings.totalMs) {
      throw new Error('Reducer response time differs from the probe result.');
    }
  }

  async #loadOpenInterval(client: PoolClient, claimed: ClaimedJob): Promise<OpenIntervalRow> {
    const result = await client.query<OpenIntervalRow>(
      `SELECT classification, id::text, probe_generation::text, source_kind,
              source_run_finished_at, source_run_id::text, started_at
       FROM monitoring.open_health_intervals
       WHERE owner_id = $1 AND check_id = $2`,
      [claimed.ownerId, claimed.checkId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Open health interval disappeared while locked.');
    return row;
  }

  async #applyIncidentEffect(
    client: PoolClient,
    claimed: ClaimedJob,
    effect: IncidentEffect,
    transition: AcceptedObservationTransition,
  ): Promise<void> {
    switch (effect.kind) {
      case 'OPEN_INCIDENT': {
        const inserted = await client.query(
          `INSERT INTO monitoring.incidents
             (id, owner_id, check_id, status, observation_mode,
              first_failure_run_id, first_failure_run_finished_at,
              confirmation_run_id, confirmation_run_finished_at,
              started_at, confirmed_at, observed_duration_ms,
              last_failure_category, resource_version)
           VALUES ($1, $2, $3, 'OPEN', $4, $5, $6, $7, $8,
                   $9, $10, $11::bigint, $12, $13::bigint)`,
          [
            effect.incident.id,
            claimed.ownerId,
            claimed.checkId,
            effect.incident.observationMode,
            effect.segment.startRun.id,
            new Date(effect.segment.startRun.finishedAtMs),
            transition.current.lastAcceptedRun!.id,
            new Date(transition.current.lastAcceptedRun!.finishedAtMs),
            new Date(effect.incident.startedAtMs),
            new Date(effect.incident.confirmedAtMs),
            effect.incident.observedDurationMs.toString(),
            effect.incident.lastFailureCategory,
            effect.incident.resourceVersion.toString(),
          ],
        );
        exactlyOne(inserted.rowCount, 'Incident open effect was not applied.');
        const segment = await client.query(
          `INSERT INTO monitoring.incident_segments
             (id, owner_id, check_id, incident_id, started_at,
              start_run_id, start_run_finished_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            effect.segment.id,
            claimed.ownerId,
            claimed.checkId,
            effect.incident.id,
            new Date(effect.segment.startedAtMs),
            effect.segment.startRun.id,
            new Date(effect.segment.startRun.finishedAtMs),
          ],
        );
        exactlyOne(segment.rowCount, 'Initial incident segment was not created.');
        return;
      }
      case 'UPDATE_INCIDENT_FAILURE': {
        const updated = await client.query(
          `UPDATE monitoring.incidents
           SET last_failure_category = $4, resource_version = $5::bigint,
               updated_at = transaction_timestamp()
           WHERE owner_id = $1 AND check_id = $2 AND id = $3
             AND status = 'OPEN' AND resource_version = $6::bigint`,
          [
            claimed.ownerId,
            claimed.checkId,
            effect.incident.id,
            effect.incident.lastFailureCategory,
            effect.incident.resourceVersion.toString(),
            (effect.incident.resourceVersion - 1n).toString(),
          ],
        );
        exactlyOne(updated.rowCount, 'Incident failure effect did not match its version.');
        return;
      }
      case 'SUSPEND_INCIDENT': {
        const segment = await client.query(
          `UPDATE monitoring.incident_segments
           SET ended_at = $5, close_reason = 'STALE',
               updated_at = transaction_timestamp()
           WHERE owner_id = $1 AND check_id = $2 AND incident_id = $3 AND id = $4
             AND ended_at IS NULL`,
          [
            claimed.ownerId,
            claimed.checkId,
            effect.incident.id,
            effect.segmentId,
            new Date(effect.segmentEndedAtMs),
          ],
        );
        exactlyOne(segment.rowCount, 'Incident segment suspension was not applied.');
        const incident = await client.query(
          `UPDATE monitoring.incidents
           SET observation_mode = 'UNOBSERVED',
               observed_duration_ms = $4::bigint,
               last_failure_category = $5, resource_version = $6::bigint,
               updated_at = transaction_timestamp()
           WHERE owner_id = $1 AND check_id = $2 AND id = $3
             AND status = 'OPEN' AND resource_version = $7::bigint`,
          [
            claimed.ownerId,
            claimed.checkId,
            effect.incident.id,
            effect.incident.observedDurationMs.toString(),
            effect.incident.lastFailureCategory,
            effect.incident.resourceVersion.toString(),
            (effect.incident.resourceVersion - 1n).toString(),
          ],
        );
        exactlyOne(incident.rowCount, 'Incident suspension did not match its version.');
        return;
      }
      case 'RESUME_INCIDENT': {
        const incident = await client.query(
          `UPDATE monitoring.incidents
           SET observation_mode = 'OBSERVED', last_failure_category = $4,
               resource_version = $5::bigint, updated_at = transaction_timestamp()
           WHERE owner_id = $1 AND check_id = $2 AND id = $3
             AND status = 'OPEN' AND resource_version = $6::bigint`,
          [
            claimed.ownerId,
            claimed.checkId,
            effect.incident.id,
            effect.incident.lastFailureCategory,
            effect.incident.resourceVersion.toString(),
            (effect.incident.resourceVersion - 1n).toString(),
          ],
        );
        exactlyOne(incident.rowCount, 'Incident resume did not match its version.');
        const segment = await client.query(
          `INSERT INTO monitoring.incident_segments
             (id, owner_id, check_id, incident_id, started_at,
              start_run_id, start_run_finished_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            effect.segment.id,
            claimed.ownerId,
            claimed.checkId,
            effect.incident.id,
            new Date(effect.segment.startedAtMs),
            effect.segment.startRun.id,
            new Date(effect.segment.startRun.finishedAtMs),
          ],
        );
        exactlyOne(segment.rowCount, 'Resumed incident segment was not created.');
        return;
      }
      case 'CLOSE_INCIDENT': {
        if (effect.segmentId !== null) {
          const segment = await client.query(
            `UPDATE monitoring.incident_segments
             SET ended_at = $5, end_run_id = $6, end_run_finished_at = $7,
                 close_reason = 'RECOVERED', updated_at = transaction_timestamp()
             WHERE owner_id = $1 AND check_id = $2 AND incident_id = $3 AND id = $4
               AND ended_at IS NULL`,
            [
              claimed.ownerId,
              claimed.checkId,
              effect.closedIncident.id,
              effect.segmentId,
              new Date(effect.closedAtMs),
              transition.current.lastAcceptedRun!.id,
              new Date(transition.current.lastAcceptedRun!.finishedAtMs),
            ],
          );
          exactlyOne(segment.rowCount, 'Recovered incident segment was not closed.');
        }
        const incident = await client.query(
          `UPDATE monitoring.incidents
           SET status = 'CLOSED', closed_at = $4, closure_reason = 'RECOVERED',
               observed_duration_ms = $5::bigint,
               last_failure_category = $6, resource_version = $7::bigint,
               updated_at = transaction_timestamp()
           WHERE owner_id = $1 AND check_id = $2 AND id = $3
             AND status = 'OPEN' AND resource_version = $8::bigint`,
          [
            claimed.ownerId,
            claimed.checkId,
            effect.closedIncident.id,
            new Date(effect.closedAtMs),
            effect.closedIncident.observedDurationMs.toString(),
            effect.closedIncident.lastFailureCategory,
            effect.closedIncident.resourceVersion.toString(),
            (effect.closedIncident.resourceVersion - 1n).toString(),
          ],
        );
        exactlyOne(incident.rowCount, 'Incident recovery did not match its version.');
        return;
      }
    }
  }

  async #writeEvents(
    client: PoolClient,
    claimed: ClaimedJob,
    check: LockedObservationCheckRow,
    previousCurrent: CurrentHealthSnapshot,
    transition: ObservationTransition,
    result: ProbeResult,
  ): Promise<void> {
    const acceptedTransition = isAcceptedTransition(transition) ? transition : null;
    const rejectedFact = transition.eventFacts.find(
      (fact): fact is Extract<MonitoringEventFact, { kind: 'OBSERVATION_REJECTED' }> =>
        fact.kind === 'OBSERVATION_REJECTED',
    );
    if (acceptedTransition === null && !rejectedFact) {
      throw new Error('Rejected observation has no rejection event fact.');
    }
    const run = acceptedTransition?.current.lastAcceptedRun ?? rejectedFact?.run;
    if (!run) throw new Error('Observation transition has no run reference.');
    const runPayload = {
      accepted: acceptedTransition !== null,
      check_id: claimed.checkId,
      failure_category: result.failureCategory,
      finished_at: transitionTime(run.finishedAtMs),
      outcome: result.outcome,
      probe_generation: claimed.probeGeneration,
      response_time_ms: result.timings.totalMs,
      run_id: run.id,
      schedule_generation: claimed.scheduleGeneration,
    };
    const runId = runPayload.run_id;
    await writeActivatedOutboxEvent(client, {
      aggregateId: runId,
      aggregateType: 'check_run',
      aggregateVersion: 1,
      correlationId: claimed.jobId,
      destinations: ['PREDICTION'],
      eventType: 'check.run_recorded',
      ownerId: claimed.ownerId,
      payload: runPayload,
    });

    const maintenanceSuppressed = transition.eventFacts.some(
      (fact) => fact.kind === 'INCIDENT_OPENED' || fact.kind === 'INCIDENT_CLOSED',
    )
      ? await this.#maintenanceActive(client, claimed)
      : false;
    for (const fact of transition.eventFacts) {
      await this.#writeFact(
        client,
        claimed,
        check,
        previousCurrent,
        transition,
        fact,
        maintenanceSuppressed,
      );
    }
  }

  async #writeFact(
    client: PoolClient,
    claimed: ClaimedJob,
    check: LockedObservationCheckRow,
    previousCurrent: CurrentHealthSnapshot,
    transition: ObservationTransition,
    fact: MonitoringEventFact,
    maintenanceSuppressed: boolean,
  ): Promise<void> {
    const accepted = isAcceptedTransition(transition) ? transition : null;
    let eventType: string;
    let aggregateId: string;
    let aggregateType: string;
    let aggregateVersion: bigint | number | string;
    let destinations: ('AUDIT' | 'NOTIFICATION' | 'REALTIME')[];
    let payload: Record<string, unknown>;

    switch (fact.kind) {
      case 'OBSERVATION_ACCEPTED':
        eventType = 'check.observation_accepted';
        aggregateId = claimed.checkId;
        aggregateType = 'check_state';
        aggregateVersion = accepted!.current.stateVersion;
        destinations = ['REALTIME'];
        payload = {
          candidate_health: accepted!.current.healthState,
          check_id: claimed.checkId,
          finished_at: transitionTime(fact.run.finishedAtMs),
          outcome: fact.outcome,
          previous_health: previousCurrent.healthState,
          probe_generation: check.probe_generation,
          run_id: fact.run.id,
          state_version: accepted!.current.stateVersion.toString(),
        };
        break;
      case 'OBSERVATION_REJECTED':
        eventType = 'check.observation_rejected';
        aggregateId = fact.run.id;
        aggregateType = 'check_run';
        aggregateVersion = 1;
        destinations = ['AUDIT'];
        payload = {
          check_id: claimed.checkId,
          current_probe_generation: check.probe_generation,
          finished_at: transitionTime(fact.run.finishedAtMs),
          observed_probe_generation: claimed.probeGeneration,
          reason_code: fact.reason,
          run_id: fact.run.id,
        };
        await client.query(
          `INSERT INTO audit.events
             (occurred_at, owner_id, actor_type, actor_id, action, resource_type,
              resource_id, correlation_id, result, metadata)
           VALUES (transaction_timestamp(), $1, 'WORKER', $2,
                   'check.observation_rejected', 'check_run', $3, $4,
                   'SUCCESS', $5::jsonb)`,
          [claimed.ownerId, this.workerId, fact.run.id, claimed.jobId, JSON.stringify(payload)],
        );
        break;
      case 'FRESHNESS_CHANGED':
        eventType = 'check.freshness_changed';
        aggregateId = claimed.checkId;
        aggregateType = 'check_state';
        aggregateVersion = accepted!.current.stateVersion;
        destinations = ['REALTIME'];
        payload = {
          changed_at: transitionTime(fact.transitionedAtMs),
          check_id: claimed.checkId,
          freshness: fact.to,
          previous_freshness: fact.from,
          reason_code: fact.to === 'STALE' ? 'DEADLINE' : 'OBSERVATION',
          state_version: accepted!.current.stateVersion.toString(),
        };
        break;
      case 'HEALTH_CHANGED':
        eventType = 'check.health_changed';
        aggregateId = claimed.checkId;
        aggregateType = 'check_state';
        aggregateVersion = accepted!.current.stateVersion;
        destinations = ['REALTIME'];
        payload = {
          active_incident_id: accepted!.current.openIncidentId,
          changed_at: transitionTime(fact.transitionedAtMs),
          check_id: claimed.checkId,
          health: fact.to,
          previous_health: fact.from,
          state_version: accepted!.current.stateVersion.toString(),
          trigger_run_id: accepted!.current.lastAcceptedRun!.id,
        };
        break;
      case 'INCIDENT_OPENED': {
        const effect = accepted!.incidentEffects.find(
          (item): item is Extract<IncidentEffect, { kind: 'OPEN_INCIDENT' }> =>
            item.kind === 'OPEN_INCIDENT' && item.incident.id === fact.incidentId,
        );
        if (!effect) throw new Error('Incident-open event has no matching effect.');
        eventType = 'incident.opened';
        aggregateId = fact.incidentId;
        aggregateType = 'incident';
        aggregateVersion = effect.incident.resourceVersion;
        destinations = ['REALTIME', 'NOTIFICATION'];
        payload = {
          check_id: claimed.checkId,
          confirmed_at: transitionTime(effect.incident.confirmedAtMs),
          incident_id: fact.incidentId,
          maintenance_suppressed: maintenanceSuppressed,
          resource_version: effect.incident.resourceVersion.toString(),
          started_at: transitionTime(effect.incident.startedAtMs),
          trigger_run_id: accepted!.current.lastAcceptedRun!.id,
        };
        break;
      }
      case 'INCIDENT_SUSPENDED': {
        const effect = accepted!.incidentEffects.find(
          (item): item is Extract<IncidentEffect, { kind: 'SUSPEND_INCIDENT' }> =>
            item.kind === 'SUSPEND_INCIDENT' && item.incident.id === fact.incidentId,
        );
        if (!effect) throw new Error('Incident-suspend event has no matching effect.');
        eventType = 'incident.observation_suspended';
        aggregateId = fact.incidentId;
        aggregateType = 'incident';
        aggregateVersion = effect.incident.resourceVersion;
        destinations = ['REALTIME'];
        payload = {
          check_id: claimed.checkId,
          incident_id: fact.incidentId,
          reason_code: 'STALE',
          resource_version: effect.incident.resourceVersion.toString(),
          segment_id: effect.segmentId,
          suspended_at: transitionTime(fact.transitionedAtMs),
        };
        break;
      }
      case 'INCIDENT_RESUMED': {
        const effect = accepted!.incidentEffects.find(
          (item): item is Extract<IncidentEffect, { kind: 'RESUME_INCIDENT' }> =>
            item.kind === 'RESUME_INCIDENT' && item.incident.id === fact.incidentId,
        );
        if (!effect) throw new Error('Incident-resume event has no matching effect.');
        eventType = 'incident.observation_resumed';
        aggregateId = fact.incidentId;
        aggregateType = 'incident';
        aggregateVersion = effect.incident.resourceVersion;
        destinations = ['REALTIME'];
        payload = {
          check_id: claimed.checkId,
          incident_id: fact.incidentId,
          reason_code: 'OBSERVATION',
          resource_version: effect.incident.resourceVersion.toString(),
          resumed_at: transitionTime(fact.transitionedAtMs),
          segment_id: effect.segment.id,
        };
        break;
      }
      case 'INCIDENT_CLOSED': {
        const effect = accepted!.incidentEffects.find(
          (item): item is Extract<IncidentEffect, { kind: 'CLOSE_INCIDENT' }> =>
            item.kind === 'CLOSE_INCIDENT' && item.closedIncident.id === fact.incidentId,
        );
        if (!effect) throw new Error('Incident-close event has no matching effect.');
        eventType = 'incident.closed';
        aggregateId = fact.incidentId;
        aggregateType = 'incident';
        aggregateVersion = effect.closedIncident.resourceVersion;
        destinations = ['REALTIME', 'NOTIFICATION'];
        payload = {
          check_id: claimed.checkId,
          closure_reason: 'RECOVERED',
          ended_at: transitionTime(effect.closedAtMs),
          incident_id: fact.incidentId,
          maintenance_suppressed: maintenanceSuppressed,
          observed_duration_ms: effect.closedIncident.observedDurationMs.toString(),
          recovery_run_id: accepted!.current.lastAcceptedRun!.id,
          resource_version: effect.closedIncident.resourceVersion.toString(),
          started_at: transitionTime(effect.closedIncident.startedAtMs),
          wall_duration_ms: String(effect.closedAtMs - effect.closedIncident.startedAtMs),
        };
        break;
      }
    }

    await writeActivatedOutboxEvent(client, {
      aggregateId,
      aggregateType,
      aggregateVersion,
      correlationId: claimed.jobId,
      destinations,
      eventType,
      ownerId: claimed.ownerId,
      payload,
    });
  }

  async #maintenanceActive(client: PoolClient, claimed: ClaimedJob): Promise<boolean> {
    const result = await client.query<{ active: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM app.maintenance_windows AS maintenance_window
         JOIN app.checks AS check_row
           ON check_row.owner_id = maintenance_window.owner_id AND check_row.id = $2
         WHERE maintenance_window.owner_id = $1
           AND maintenance_window.state = 'SCHEDULED'
           AND maintenance_window.cancelled_at IS NULL
           AND maintenance_window.starts_at <= transaction_timestamp()
           AND maintenance_window.ends_at > transaction_timestamp()
           AND (
             maintenance_window.check_id = $2
             OR (
               maintenance_window.group_id IS NOT NULL
               AND maintenance_window.group_id = check_row.group_id
             )
           )
       ) AS active`,
      [claimed.ownerId, claimed.checkId],
    );
    return result.rows[0]?.active ?? false;
  }
}
