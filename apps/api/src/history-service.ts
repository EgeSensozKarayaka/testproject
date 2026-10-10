import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Pool, PoolClient } from '@site-monitor/database';
import {
  combineResponseSampleAggregates,
  HistoryAggregationInvariantError,
  planHistoryWindow,
  summarizeHistoryDuration,
  type HistoryPeriod,
  type HistorySourceResolution,
  type HistoryTimelineClassification,
  type ResponseSampleAggregate,
} from '@site-monitor/domain';

import { ApiProblemError } from './problem.js';

type IncidentObservationMode = 'OBSERVED' | 'UNOBSERVED';
type IncidentState = 'CLOSED' | 'OPEN';
type IncidentClosureReason = 'ADMINISTRATIVE' | 'CHECK_DELETED' | 'CONFIG_CHANGED' | 'RECOVERED';

export interface HistoryBucketDto {
  availability_ratio: number | null;
  classification: 'DOWN' | 'MIXED' | 'PROVISIONAL' | 'UNKNOWN' | 'UP';
  coverage_ratio: number;
  from: string;
  observed_down_ms: string;
  observed_up_ms: string;
  provisional_ms: string;
  response_time_ms: number | null;
  sample_count: number;
  to: string;
  unknown_ms: string;
}

export interface HistoryResponseDto {
  availability_ratio: number | null;
  bucket_seconds: number;
  buckets: HistoryBucketDto[];
  check_id: string;
  coverage_ratio: number;
  data_through: string;
  from: string;
  generated_at: string;
  observed_down_ms: string;
  observed_up_ms: string;
  period: HistoryPeriod;
  provisional_ms: string;
  resolution: HistorySourceResolution;
  to: string;
  unknown_ms: string;
}

export interface IncidentDto {
  check_id: string;
  check_name: string;
  closure_reason: IncidentClosureReason | null;
  confirmed_at: string;
  ended_at: string | null;
  group_id_at_open: string | null;
  id: string;
  observation_mode: IncidentObservationMode;
  observed_duration_ms: string;
  started_at: string;
  status: IncidentState;
  wall_duration_ms: string;
}

export interface IncidentSegmentDto {
  ends_at: string | null;
  kind: 'OBSERVED_DOWN' | 'UNOBSERVED';
  starts_at: string;
}

export interface IncidentDetailDto extends IncidentDto {
  generated_at: string;
  segments: IncidentSegmentDto[];
}

export interface IncidentPageDto {
  data: IncidentDto[];
  generated_at: string;
  page: { has_more: boolean; next_cursor: string | null };
}

export interface IncidentListInput {
  checkId?: string;
  cursor?: string;
  endedAfter?: string;
  groupId?: string;
  limit: number;
  startedBefore?: string;
  status?: IncidentState;
}

export interface HistoryServicePort {
  getHistory: (
    ownerId: string,
    checkId: string,
    period: HistoryPeriod,
  ) => Promise<HistoryResponseDto>;
  getIncident: (ownerId: string, incidentId: string) => Promise<IncidentDetailDto>;
  listIncidents: (ownerId: string, input: IncidentListInput) => Promise<IncidentPageDto>;
}

export interface HistoryServiceOptions {
  cursorTtlSeconds?: number;
  hourRawTailSeconds?: number;
  minuteRawTailSeconds?: number;
  retryAfterSeconds?: number;
  securityKey: Buffer;
  statementTimeoutMs?: number;
}

interface ProjectionStatusRow {
  pending_from: Date | string | null;
  source_data_through: Date | string | null;
}

interface RollupRow {
  bucket_index: number;
  down_ms: string;
  response_max_ms: number | null;
  response_min_ms: number | null;
  response_sample_count: string;
  response_sum_ms: string;
  up_ms: string;
}

interface RunRow {
  finished_at: Date | string;
  total_ms: number;
}

interface TimelineRow {
  classification: HistoryTimelineClassification;
  ended_at: Date | string | null;
  started_at: Date | string;
}

interface IncidentRow {
  check_id: string;
  check_name: string;
  closure_reason: IncidentClosureReason | null;
  confirmed_at: Date | string;
  effective_observation_mode: IncidentObservationMode;
  effective_status: IncidentState;
  ended_at: Date | string | null;
  group_id_at_open: string | null;
  id: string;
  observed_duration_ms: string;
  started_at: Date | string;
  wall_duration_ms: string;
}

interface IncidentCursorPayload {
  expiresAt: number;
  filterHash: string;
  id: string;
  snapshotAt: string;
  startedAt: string;
  version: 1;
}

interface NormalizedIncidentList {
  checkId: string | null;
  endedAfter: Date | null;
  groupId: string | null;
  limit: number;
  startedBefore: Date | null;
  status: IncidentState | null;
}

interface MutableHistoryBucket {
  downMs: number;
  responseAggregates: ResponseSampleAggregate[];
  upMs: number;
  provisionalMs: number;
}

function instant(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function timeMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function safeInteger(value: number | string, label: string): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new HistoryAggregationInvariantError(`${label} is outside the supported integer range.`);
  }
  return parsed;
}

function resourceNotFound(): ApiProblemError {
  return new ApiProblemError({
    code: 'resource_not_found',
    detail: 'The requested resource was not found.',
    status: 404,
  });
}

function validationProblem(field: string): ApiProblemError {
  return new ApiProblemError({
    code: 'validation_failed',
    detail: 'One or more fields are invalid.',
    issues: [
      {
        code: 'invalid_instant',
        message: 'The value must be a valid UTC instant.',
        pointer: `/${field}`,
      },
    ],
    status: 422,
  });
}

function parseOptionalInstant(value: string | undefined, field: string): Date | null {
  if (value === undefined) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw validationProblem(field);
  return parsed;
}

function digest(key: Buffer, domain: string, value: string): Buffer {
  return createHmac('sha256', key).update(domain).update('\0').update(value).digest();
}

function addTimelineInterval(
  buckets: MutableHistoryBucket[],
  window: ReturnType<typeof planHistoryWindow>,
  classification: HistoryTimelineClassification,
  startMs: number,
  endMs: number,
): void {
  const clippedStart = Math.max(window.fromMs, startMs);
  const clippedEnd = Math.min(window.toMs, endMs);
  if (clippedEnd <= clippedStart || classification === 'UNKNOWN') return;
  const first = Math.floor((clippedStart - window.fromMs) / window.bucketSizeMs);
  const last = Math.floor((clippedEnd - 1 - window.fromMs) / window.bucketSizeMs);
  for (let index = first; index <= last; index += 1) {
    const bucket = buckets[index];
    if (!bucket) throw new HistoryAggregationInvariantError('Timeline escaped history buckets.');
    const bucketFrom = window.fromMs + index * window.bucketSizeMs;
    const overlap = Math.max(
      0,
      Math.min(clippedEnd, bucketFrom + window.bucketSizeMs) - Math.max(clippedStart, bucketFrom),
    );
    if (classification === 'UP') bucket.upMs += overlap;
    else if (classification === 'DOWN') bucket.downMs += overlap;
    else bucket.provisionalMs += overlap;
  }
}

function mapIncident(row: IncidentRow): IncidentDto {
  return {
    check_id: row.check_id,
    check_name: row.check_name,
    closure_reason: row.closure_reason,
    confirmed_at: instant(row.confirmed_at),
    ended_at: row.ended_at === null ? null : instant(row.ended_at),
    group_id_at_open: row.group_id_at_open,
    id: row.id,
    observation_mode: row.effective_observation_mode,
    observed_duration_ms: String(row.observed_duration_ms),
    started_at: instant(row.started_at),
    status: row.effective_status,
    wall_duration_ms: String(row.wall_duration_ms),
  };
}

export class HistoryService implements HistoryServicePort {
  readonly #cursorTtlSeconds: number;
  readonly #hourRawTailMs: number;
  readonly #minuteRawTailMs: number;
  readonly #pool: Pool;
  readonly #retryAfterSeconds: number;
  readonly #securityKey: Buffer;
  readonly #statementTimeoutMs: number;

  constructor(pool: Pool, options: HistoryServiceOptions) {
    this.#pool = pool;
    this.#securityKey = options.securityKey;
    this.#cursorTtlSeconds = options.cursorTtlSeconds ?? 900;
    this.#hourRawTailMs = (options.hourRawTailSeconds ?? 7_200) * 1_000;
    this.#minuteRawTailMs = (options.minuteRawTailSeconds ?? 900) * 1_000;
    this.#retryAfterSeconds = options.retryAfterSeconds ?? 5;
    this.#statementTimeoutMs = options.statementTimeoutMs ?? 2_000;
  }

  async getHistory(
    ownerId: string,
    checkId: string,
    period: HistoryPeriod,
  ): Promise<HistoryResponseDto> {
    try {
      return await this.#readTransaction(ownerId, async (client) => {
        const check = await client.query(
          'SELECT id FROM app.checks WHERE owner_id = $1 AND id = $2',
          [ownerId, checkId],
        );
        if (!check.rows[0]) throw resourceNotFound();

        const generatedAt = (
          await client.query<{ generated_at: Date }>(
            'SELECT transaction_timestamp() AS generated_at',
          )
        ).rows[0]!.generated_at;
        const window = planHistoryWindow(period, generatedAt.getTime());
        const rawTailMs =
          window.sourceResolution === 'minute' ? this.#minuteRawTailMs : this.#hourRawTailMs;
        const tailStartMs = Math.max(window.fromMs, window.toMs - rawTailMs);
        const status = (
          await client.query<ProjectionStatusRow>(
            `SELECT * FROM security_api.history_projection_status($1, $2, $3, $4)`,
            [checkId, window.sourceResolution, new Date(window.fromMs), new Date(window.toMs)],
          )
        ).rows[0];
        const projectionLagging =
          !status?.source_data_through ||
          timeMs(status.source_data_through) < tailStartMs ||
          (status.pending_from !== null && timeMs(status.pending_from) < tailStartMs);
        if (projectionLagging) {
          throw new ApiProblemError({
            code: 'history_projection_lagging',
            detail: 'History projection is catching up. Retry the bounded query shortly.',
            retryAfterSeconds: this.#retryAfterSeconds,
            retryable: true,
            status: 503,
          });
        }

        const buckets: MutableHistoryBucket[] = Array.from({ length: window.bucketCount }, () => ({
          downMs: 0,
          provisionalMs: 0,
          responseAggregates: [],
          upMs: 0,
        }));
        const rollupTable =
          window.sourceResolution === 'minute'
            ? 'monitoring.rollups_minute'
            : 'monitoring.rollups_hour';
        const historical = await client.query<RollupRow>(
          `SELECT
             floor(extract(epoch FROM (bucket_start - $3::timestamptz)) / $5)::integer AS bucket_index,
             sum(up_ms)::text AS up_ms,
             sum(down_ms)::text AS down_ms,
             sum(response_sample_count)::text AS response_sample_count,
             sum(response_sum_ms)::text AS response_sum_ms,
             min(response_min_ms) AS response_min_ms,
             max(response_max_ms) AS response_max_ms
           FROM ${rollupTable}
           WHERE owner_id = $1 AND check_id = $2
             AND bucket_start >= $3 AND bucket_start < $4
           GROUP BY bucket_index
           ORDER BY bucket_index`,
          [
            ownerId,
            checkId,
            new Date(window.fromMs),
            new Date(tailStartMs),
            window.bucketSizeMs / 1_000,
          ],
        );
        for (const row of historical.rows) {
          const bucket = buckets[row.bucket_index];
          if (!bucket)
            throw new HistoryAggregationInvariantError('Rollup escaped history buckets.');
          bucket.upMs += safeInteger(row.up_ms, 'rollup up_ms');
          bucket.downMs += safeInteger(row.down_ms, 'rollup down_ms');
          bucket.responseAggregates.push({
            maxMs: row.response_max_ms,
            minMs: row.response_min_ms,
            sampleCount: safeInteger(row.response_sample_count, 'rollup sample count'),
            sumMs: safeInteger(row.response_sum_ms, 'rollup response sum'),
          });
        }

        const rawRuns = await client.query<RunRow>(
          `SELECT finished_at, total_ms
           FROM monitoring.check_runs
           WHERE owner_id = $1 AND check_id = $2 AND accepted_for_state
             AND finished_at >= $3 AND finished_at < $4
           ORDER BY finished_at, id`,
          [ownerId, checkId, new Date(tailStartMs), new Date(window.toMs)],
        );
        for (const run of rawRuns.rows) {
          const index = Math.floor((timeMs(run.finished_at) - window.fromMs) / window.bucketSizeMs);
          const bucket = buckets[index];
          if (!bucket)
            throw new HistoryAggregationInvariantError('Raw run escaped history buckets.');
          bucket.responseAggregates.push({
            maxMs: run.total_ms,
            minMs: run.total_ms,
            sampleCount: 1,
            sumMs: run.total_ms,
          });
        }

        const finalized = await client.query<TimelineRow>(
          `SELECT classification, started_at, ended_at
           FROM monitoring.health_intervals
           WHERE owner_id = $1 AND check_id = $2
             AND started_at < $4 AND ended_at > $3
           ORDER BY started_at, id`,
          [ownerId, checkId, new Date(tailStartMs), new Date(window.toMs)],
        );
        const open = await client.query<TimelineRow>(
          `SELECT classification, started_at, NULL::timestamptz AS ended_at
           FROM monitoring.open_health_intervals
           WHERE owner_id = $1 AND check_id = $2 AND started_at < $3`,
          [ownerId, checkId, new Date(window.toMs)],
        );
        for (const interval of finalized.rows) {
          addTimelineInterval(
            buckets,
            window,
            interval.classification,
            Math.max(tailStartMs, timeMs(interval.started_at)),
            timeMs(interval.ended_at!),
          );
        }
        for (const interval of open.rows) {
          addTimelineInterval(
            buckets,
            window,
            interval.classification,
            timeMs(interval.started_at),
            window.toMs,
          );
        }

        const resultBuckets: HistoryBucketDto[] = buckets.map((bucket, index) => {
          const explicit = bucket.upMs + bucket.downMs + bucket.provisionalMs;
          const summary = summarizeHistoryDuration(
            {
              downMs: bucket.downMs,
              provisionalMs: bucket.provisionalMs,
              unknownMs: window.bucketSizeMs - explicit,
              upMs: bucket.upMs,
            },
            window.bucketSizeMs,
          );
          const response = combineResponseSampleAggregates(bucket.responseAggregates);
          return {
            availability_ratio: summary.availabilityRatio,
            classification: summary.classification,
            coverage_ratio: summary.coverageRatio,
            from: new Date(window.fromMs + index * window.bucketSizeMs).toISOString(),
            observed_down_ms: String(summary.downMs),
            observed_up_ms: String(summary.upMs),
            provisional_ms: String(summary.provisionalMs),
            response_time_ms: response.averageMs,
            sample_count: response.sampleCount,
            to: new Date(window.fromMs + (index + 1) * window.bucketSizeMs).toISOString(),
            unknown_ms: String(summary.unknownMs),
          };
        });
        const totals = resultBuckets.reduce(
          (sum, bucket) => ({
            downMs: sum.downMs + Number(bucket.observed_down_ms),
            provisionalMs: sum.provisionalMs + Number(bucket.provisional_ms),
            unknownMs: sum.unknownMs + Number(bucket.unknown_ms),
            upMs: sum.upMs + Number(bucket.observed_up_ms),
          }),
          { downMs: 0, provisionalMs: 0, unknownMs: 0, upMs: 0 },
        );
        const overall = summarizeHistoryDuration(totals, window.toMs - window.fromMs);
        return {
          availability_ratio: overall.availabilityRatio,
          bucket_seconds: window.bucketSizeMs / 1_000,
          buckets: resultBuckets,
          check_id: checkId,
          coverage_ratio: overall.coverageRatio,
          data_through: new Date(window.toMs).toISOString(),
          from: new Date(window.fromMs).toISOString(),
          generated_at: generatedAt.toISOString(),
          observed_down_ms: String(overall.downMs),
          observed_up_ms: String(overall.upMs),
          period,
          provisional_ms: String(overall.provisionalMs),
          resolution: window.sourceResolution,
          to: new Date(window.toMs).toISOString(),
          unknown_ms: String(overall.unknownMs),
        };
      });
    } catch (error) {
      if (error instanceof HistoryAggregationInvariantError) {
        throw new ApiProblemError({
          code: 'dependency_unavailable',
          detail: 'History projection failed its consistency check.',
          retryAfterSeconds: this.#retryAfterSeconds,
          retryable: true,
          status: 503,
        });
      }
      throw error;
    }
  }

  async listIncidents(ownerId: string, input: IncidentListInput): Promise<IncidentPageDto> {
    const normalized: NormalizedIncidentList = {
      checkId: input.checkId ?? null,
      endedAfter: parseOptionalInstant(input.endedAfter, 'ended_after'),
      groupId: input.groupId ?? null,
      limit: input.limit,
      startedBefore: parseOptionalInstant(input.startedBefore, 'started_before'),
      status: input.status ?? null,
    };
    const filterHash = this.#incidentFilterHash(normalized);
    const cursor = input.cursor ? this.#decodeIncidentCursor(input.cursor, filterHash) : null;
    return this.#readTransaction(ownerId, async (client) => {
      if (normalized.checkId) {
        const check = await client.query(
          'SELECT id FROM app.checks WHERE owner_id = $1 AND id = $2',
          [ownerId, normalized.checkId],
        );
        if (!check.rows[0]) throw resourceNotFound();
      }
      if (normalized.groupId) {
        const group = await client.query(
          'SELECT id FROM app.check_groups WHERE owner_id = $1 AND id = $2',
          [ownerId, normalized.groupId],
        );
        if (!group.rows[0]) throw resourceNotFound();
      }
      const snapshotAt = cursor
        ? new Date(cursor.snapshotAt)
        : (
            await client.query<{ snapshot_at: Date }>(
              'SELECT transaction_timestamp() AS snapshot_at',
            )
          ).rows[0]!.snapshot_at;
      const result = await client.query<IncidentRow>(
        `SELECT incident.id, incident.check_id, check_row.name AS check_name,
                incident.group_id_at_open, incident.started_at, incident.confirmed_at,
                CASE WHEN incident.closed_at IS NOT NULL AND incident.closed_at <= $2
                  THEN 'CLOSED' ELSE 'OPEN' END AS effective_status,
                CASE
                  WHEN incident.closed_at IS NULL OR incident.closed_at > $2 THEN
                    CASE WHEN EXISTS (
                      SELECT 1 FROM monitoring.incident_segments AS active_segment
                      WHERE active_segment.owner_id = incident.owner_id
                        AND active_segment.incident_id = incident.id
                        AND active_segment.started_at < $2
                        AND (active_segment.ended_at IS NULL OR active_segment.ended_at > $2)
                    ) THEN 'OBSERVED' ELSE 'UNOBSERVED' END
                  ELSE incident.observation_mode
                END AS effective_observation_mode,
                CASE WHEN incident.closed_at IS NOT NULL AND incident.closed_at <= $2
                  THEN incident.closed_at ELSE NULL END AS ended_at,
                CASE WHEN incident.closed_at IS NOT NULL AND incident.closed_at <= $2
                  THEN incident.closure_reason ELSE NULL END AS closure_reason,
                coalesce((
                  SELECT round(sum(extract(epoch FROM (
                    least(coalesce(segment.ended_at, $2), $2) - segment.started_at
                  )) * 1000))::bigint::text
                  FROM monitoring.incident_segments AS segment
                  WHERE segment.owner_id = incident.owner_id
                    AND segment.incident_id = incident.id
                    AND segment.started_at < $2
                ), '0') AS observed_duration_ms,
                round(extract(epoch FROM (
                  CASE WHEN incident.closed_at IS NOT NULL AND incident.closed_at <= $2
                    THEN incident.closed_at ELSE $2 END - incident.started_at
                )) * 1000)::bigint::text AS wall_duration_ms
         FROM monitoring.incidents AS incident
         JOIN app.checks AS check_row
           ON check_row.owner_id = incident.owner_id AND check_row.id = incident.check_id
         WHERE incident.owner_id = $1
           AND incident.started_at < $2
           AND ($3::uuid IS NULL OR incident.check_id = $3)
           AND ($4::uuid IS NULL OR incident.group_id_at_open = $4)
           AND ($5::text IS NULL OR
             CASE WHEN incident.closed_at IS NOT NULL AND incident.closed_at <= $2
               THEN 'CLOSED' ELSE 'OPEN' END = $5)
           AND ($6::timestamptz IS NULL OR incident.started_at < $6)
           AND ($7::timestamptz IS NULL OR
             CASE WHEN incident.closed_at IS NOT NULL AND incident.closed_at <= $2
               THEN incident.closed_at ELSE $2 END > $7)
           AND ($8::timestamptz IS NULL OR (incident.started_at, incident.id) < ($8, $9::uuid))
         ORDER BY incident.started_at DESC, incident.id DESC
         LIMIT $10`,
        [
          ownerId,
          snapshotAt,
          normalized.checkId,
          normalized.groupId,
          normalized.status,
          normalized.startedBefore,
          normalized.endedAfter,
          cursor?.startedAt ?? null,
          cursor?.id ?? null,
          normalized.limit + 1,
        ],
      );
      const hasMore = result.rows.length > normalized.limit;
      const rows = result.rows.slice(0, normalized.limit);
      const last = rows.at(-1);
      return {
        data: rows.map(mapIncident),
        generated_at: snapshotAt.toISOString(),
        page: {
          has_more: hasMore,
          next_cursor:
            hasMore && last
              ? this.#encodeIncidentCursor({
                  expiresAt: Math.floor(Date.now() / 1_000) + this.#cursorTtlSeconds,
                  filterHash,
                  id: last.id,
                  snapshotAt: snapshotAt.toISOString(),
                  startedAt: instant(last.started_at),
                  version: 1,
                })
              : null,
        },
      };
    });
  }

  async getIncident(ownerId: string, incidentId: string): Promise<IncidentDetailDto> {
    return this.#readTransaction(ownerId, async (client) => {
      const snapshotAt = (
        await client.query<{ snapshot_at: Date }>('SELECT transaction_timestamp() AS snapshot_at')
      ).rows[0]!.snapshot_at;
      const incident = (
        await client.query<IncidentRow>(
          `SELECT incident.id, incident.check_id, check_row.name AS check_name,
                  incident.group_id_at_open, incident.started_at, incident.confirmed_at,
                  CASE WHEN incident.closed_at IS NOT NULL AND incident.closed_at <= $3
                    THEN 'CLOSED' ELSE 'OPEN' END AS effective_status,
                  CASE
                    WHEN incident.closed_at IS NULL OR incident.closed_at > $3 THEN
                      CASE WHEN EXISTS (
                        SELECT 1 FROM monitoring.incident_segments AS active_segment
                        WHERE active_segment.owner_id = incident.owner_id
                          AND active_segment.incident_id = incident.id
                          AND active_segment.started_at < $3
                          AND (active_segment.ended_at IS NULL OR active_segment.ended_at > $3)
                      ) THEN 'OBSERVED' ELSE 'UNOBSERVED' END
                    ELSE incident.observation_mode
                  END AS effective_observation_mode,
                  CASE WHEN incident.closed_at IS NOT NULL AND incident.closed_at <= $3
                    THEN incident.closed_at ELSE NULL END AS ended_at,
                  CASE WHEN incident.closed_at IS NOT NULL AND incident.closed_at <= $3
                    THEN incident.closure_reason ELSE NULL END AS closure_reason,
                  coalesce((
                    SELECT round(sum(extract(epoch FROM (
                      least(coalesce(segment.ended_at, $3), $3) - segment.started_at
                    )) * 1000))::bigint::text
                    FROM monitoring.incident_segments AS segment
                    WHERE segment.owner_id = incident.owner_id
                      AND segment.incident_id = incident.id
                      AND segment.started_at < $3
                  ), '0') AS observed_duration_ms,
                  round(extract(epoch FROM (
                    CASE WHEN incident.closed_at IS NOT NULL AND incident.closed_at <= $3
                      THEN incident.closed_at ELSE $3 END - incident.started_at
                  )) * 1000)::bigint::text AS wall_duration_ms
           FROM monitoring.incidents AS incident
           JOIN app.checks AS check_row
             ON check_row.owner_id = incident.owner_id AND check_row.id = incident.check_id
           WHERE incident.owner_id = $1 AND incident.id = $2`,
          [ownerId, incidentId, snapshotAt],
        )
      ).rows[0];
      if (!incident) throw resourceNotFound();

      const effectiveEnd = incident.ended_at === null ? snapshotAt : new Date(incident.ended_at);
      const observed = await client.query<{
        ended_at: Date | string | null;
        started_at: Date | string;
      }>(
        `SELECT started_at,
                CASE WHEN ended_at IS NULL OR ended_at > $3 THEN NULL ELSE ended_at END AS ended_at
         FROM monitoring.incident_segments
         WHERE owner_id = $1 AND incident_id = $2 AND started_at < $3
         ORDER BY started_at, id`,
        [ownerId, incidentId, effectiveEnd],
      );
      const segments: IncidentSegmentDto[] = [];
      let cursorMs = timeMs(incident.started_at);
      const effectiveEndMs = effectiveEnd.getTime();
      for (const segment of observed.rows) {
        const startMs = timeMs(segment.started_at);
        if (startMs > cursorMs) {
          segments.push({
            ends_at: new Date(startMs).toISOString(),
            kind: 'UNOBSERVED',
            starts_at: new Date(cursorMs).toISOString(),
          });
        }
        const endMs = segment.ended_at === null ? effectiveEndMs : timeMs(segment.ended_at);
        segments.push({
          ends_at:
            segment.ended_at === null && incident.ended_at === null
              ? null
              : new Date(endMs).toISOString(),
          kind: 'OBSERVED_DOWN',
          starts_at: new Date(startMs).toISOString(),
        });
        cursorMs = endMs;
      }
      if (cursorMs < effectiveEndMs) {
        segments.push({
          ends_at: incident.ended_at === null ? null : effectiveEnd.toISOString(),
          kind: 'UNOBSERVED',
          starts_at: new Date(cursorMs).toISOString(),
        });
      }
      return { ...mapIncident(incident), generated_at: snapshotAt.toISOString(), segments };
    });
  }

  async #readTransaction<T>(
    ownerId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query(`SELECT set_config('statement_timeout', $1, true)`, [
        `${this.#statementTimeoutMs}ms`,
      ]);
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [ownerId]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '57014'
      ) {
        throw new ApiProblemError({
          code: 'dependency_unavailable',
          detail: 'The bounded history query exceeded its execution budget.',
          retryAfterSeconds: this.#retryAfterSeconds,
          retryable: true,
          status: 503,
        });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  #incidentFilterHash(input: NormalizedIncidentList): string {
    return digest(
      this.#securityKey,
      'incident-list-filter',
      JSON.stringify({
        checkId: input.checkId,
        endedAfter: input.endedAfter?.toISOString() ?? null,
        groupId: input.groupId,
        limit: input.limit,
        startedBefore: input.startedBefore?.toISOString() ?? null,
        status: input.status,
      }),
    ).toString('base64url');
  }

  #encodeIncidentCursor(payload: IncidentCursorPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${digest(this.#securityKey, 'incident-list-cursor', body).toString('base64url')}`;
  }

  #decodeIncidentCursor(value: string, filterHash: string): IncidentCursorPayload {
    try {
      const [body, signature, extra] = value.split('.');
      if (!body || !signature || extra) throw new Error('invalid parts');
      const actual = Buffer.from(signature, 'base64url');
      const expected = digest(this.#securityKey, 'incident-list-cursor', body);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new Error('invalid signature');
      }
      const payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as IncidentCursorPayload;
      if (
        payload.version !== 1 ||
        payload.filterHash !== filterHash ||
        !Number.isFinite(Date.parse(payload.snapshotAt)) ||
        !Number.isFinite(Date.parse(payload.startedAt)) ||
        !/^[0-9a-f-]{36}$/u.test(payload.id) ||
        !Number.isInteger(payload.expiresAt) ||
        payload.expiresAt < Math.floor(Date.now() / 1_000)
      ) {
        throw new Error('invalid payload');
      }
      return payload;
    } catch {
      throw new ApiProblemError({
        code: 'invalid_cursor',
        detail: 'The page cursor is invalid, expired, or does not match the filters.',
        status: 400,
      });
    }
  }
}
