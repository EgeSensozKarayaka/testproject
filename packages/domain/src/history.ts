export type HistoryPeriod = 'day' | 'month' | 'week';
export type HistorySourceResolution = 'hour' | 'minute';
export type HistoryBucketClassification = 'DOWN' | 'MIXED' | 'PROVISIONAL' | 'UNKNOWN' | 'UP';
export type HistoryTimelineClassification = 'DOWN' | 'PROVISIONAL' | 'UNKNOWN' | 'UP';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const PERIOD_PLANS = {
  day: {
    bucketSizeMs: 5 * MINUTE_MS,
    sourceResolution: 'minute',
    sourceResolutionMs: MINUTE_MS,
    windowMs: 24 * HOUR_MS,
  },
  month: {
    bucketSizeMs: 2 * HOUR_MS,
    sourceResolution: 'hour',
    sourceResolutionMs: HOUR_MS,
    windowMs: 30 * 24 * HOUR_MS,
  },
  week: {
    bucketSizeMs: 30 * MINUTE_MS,
    sourceResolution: 'minute',
    sourceResolutionMs: MINUTE_MS,
    windowMs: 7 * 24 * HOUR_MS,
  },
} as const satisfies Record<
  HistoryPeriod,
  {
    bucketSizeMs: number;
    sourceResolution: HistorySourceResolution;
    sourceResolutionMs: number;
    windowMs: number;
  }
>;

export class HistoryAggregationInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryAggregationInvariantError';
  }
}

export interface HistoryWindowPlan {
  bucketCount: number;
  bucketSizeMs: number;
  fromMs: number;
  period: HistoryPeriod;
  sourceResolution: HistorySourceResolution;
  toMs: number;
}

export interface HistoryTimelineInterval {
  classification: HistoryTimelineClassification;
  endMs: number;
  startMs: number;
}

export interface HistoryDurationTotals {
  downMs: number;
  provisionalMs: number;
  unknownMs: number;
  upMs: number;
}

export interface HistoryDurationSummary extends HistoryDurationTotals {
  availabilityRatio: number | null;
  classification: HistoryBucketClassification;
  coverageRatio: number;
  requestedMs: number;
}

export interface HistoryDurationBucket extends HistoryDurationSummary {
  fromMs: number;
  toMs: number;
}

export interface ResponseSampleAggregate {
  maxMs: number | null;
  minMs: number | null;
  sampleCount: number;
  sumMs: number;
}

export interface CombinedResponseSampleAggregate extends ResponseSampleAggregate {
  averageMs: number | null;
}

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new HistoryAggregationInvariantError(`${name} must be a safe integer.`);
  }
}

function assertNonnegativeInteger(value: number, name: string): void {
  assertSafeInteger(value, name);
  if (value < 0) {
    throw new HistoryAggregationInvariantError(`${name} must not be negative.`);
  }
}

export function planHistoryWindow(period: HistoryPeriod, databaseNowMs: number): HistoryWindowPlan {
  assertNonnegativeInteger(databaseNowMs, 'databaseNowMs');
  const plan = PERIOD_PLANS[period];
  const toMs = Math.floor(databaseNowMs / plan.sourceResolutionMs) * plan.sourceResolutionMs;
  const bucketCount = plan.windowMs / plan.bucketSizeMs;
  if (!Number.isInteger(bucketCount)) {
    throw new HistoryAggregationInvariantError(
      'History window is not divisible by its bucket size.',
    );
  }
  return {
    bucketCount,
    bucketSizeMs: plan.bucketSizeMs,
    fromMs: toMs - plan.windowMs,
    period,
    sourceResolution: plan.sourceResolution,
    toMs,
  };
}

export function summarizeHistoryDuration(
  totals: HistoryDurationTotals,
  requestedMs: number,
): HistoryDurationSummary {
  assertNonnegativeInteger(requestedMs, 'requestedMs');
  if (requestedMs === 0) {
    throw new HistoryAggregationInvariantError('requestedMs must be greater than zero.');
  }
  assertNonnegativeInteger(totals.upMs, 'upMs');
  assertNonnegativeInteger(totals.downMs, 'downMs');
  assertNonnegativeInteger(totals.unknownMs, 'unknownMs');
  assertNonnegativeInteger(totals.provisionalMs, 'provisionalMs');

  const accountedMs = totals.upMs + totals.downMs + totals.unknownMs + totals.provisionalMs;
  if (!Number.isSafeInteger(accountedMs) || accountedMs !== requestedMs) {
    throw new HistoryAggregationInvariantError(
      'UP, DOWN, UNKNOWN, and PROVISIONAL duration must exactly cover the requested window.',
    );
  }

  const observedMs = totals.upMs + totals.downMs;
  let classification: HistoryBucketClassification;
  if (observedMs === 0 && totals.provisionalMs === 0) {
    classification = 'UNKNOWN';
  } else if (observedMs === 0) {
    classification = 'PROVISIONAL';
  } else if (totals.downMs === 0 && totals.provisionalMs === 0) {
    classification = 'UP';
  } else if (totals.upMs === 0 && totals.provisionalMs === 0) {
    classification = 'DOWN';
  } else {
    classification = 'MIXED';
  }

  return {
    ...totals,
    availabilityRatio: observedMs === 0 ? null : totals.upMs / observedMs,
    classification,
    coverageRatio: observedMs / requestedMs,
    requestedMs,
  };
}

export function aggregateTimelineIntoBuckets(
  window: HistoryWindowPlan,
  intervals: readonly HistoryTimelineInterval[],
): HistoryDurationBucket[] {
  assertSafeInteger(window.fromMs, 'window.fromMs');
  assertSafeInteger(window.toMs, 'window.toMs');
  assertNonnegativeInteger(window.bucketSizeMs, 'window.bucketSizeMs');
  assertNonnegativeInteger(window.bucketCount, 'window.bucketCount');
  if (window.bucketSizeMs === 0 || window.bucketCount === 0) {
    throw new HistoryAggregationInvariantError(
      'History window requires positive bucket dimensions.',
    );
  }
  if (window.toMs - window.fromMs !== window.bucketSizeMs * window.bucketCount) {
    throw new HistoryAggregationInvariantError(
      'History window boundaries do not match its buckets.',
    );
  }

  const mutable = Array.from({ length: window.bucketCount }, (_, index) => ({
    downMs: 0,
    fromMs: window.fromMs + index * window.bucketSizeMs,
    provisionalMs: 0,
    toMs: window.fromMs + (index + 1) * window.bucketSizeMs,
    unknownMs: window.bucketSizeMs,
    upMs: 0,
  }));

  const clipped = intervals
    .map((interval) => {
      assertSafeInteger(interval.startMs, 'interval.startMs');
      assertSafeInteger(interval.endMs, 'interval.endMs');
      if (interval.endMs <= interval.startMs) {
        throw new HistoryAggregationInvariantError(
          'Timeline intervals must have positive duration.',
        );
      }
      return {
        ...interval,
        endMs: Math.min(interval.endMs, window.toMs),
        startMs: Math.max(interval.startMs, window.fromMs),
      };
    })
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

  let previousEnd = window.fromMs;
  for (const interval of clipped) {
    if (interval.startMs < previousEnd) {
      throw new HistoryAggregationInvariantError(
        'Timeline intervals overlap inside the history window.',
      );
    }
    previousEnd = interval.endMs;

    if (interval.classification === 'UNKNOWN') continue;
    const firstBucket = Math.floor((interval.startMs - window.fromMs) / window.bucketSizeMs);
    const lastBucket = Math.floor((interval.endMs - 1 - window.fromMs) / window.bucketSizeMs);
    for (let index = firstBucket; index <= lastBucket; index += 1) {
      const bucket = mutable[index];
      if (!bucket) {
        throw new HistoryAggregationInvariantError('Timeline interval escaped the history window.');
      }
      const overlapMs = Math.max(
        0,
        Math.min(interval.endMs, bucket.toMs) - Math.max(interval.startMs, bucket.fromMs),
      );
      bucket.unknownMs -= overlapMs;
      if (bucket.unknownMs < 0) {
        throw new HistoryAggregationInvariantError('Timeline duration exceeds its bucket.');
      }
      if (interval.classification === 'UP') bucket.upMs += overlapMs;
      else if (interval.classification === 'DOWN') bucket.downMs += overlapMs;
      else bucket.provisionalMs += overlapMs;
    }
  }

  return mutable.map((bucket) => ({
    fromMs: bucket.fromMs,
    toMs: bucket.toMs,
    ...summarizeHistoryDuration(bucket, window.bucketSizeMs),
  }));
}

export function combineResponseSampleAggregates(
  aggregates: readonly ResponseSampleAggregate[],
): CombinedResponseSampleAggregate {
  let sampleCount = 0;
  let sumMs = 0;
  let minMs: number | null = null;
  let maxMs: number | null = null;

  for (const aggregate of aggregates) {
    assertNonnegativeInteger(aggregate.sampleCount, 'sampleCount');
    assertNonnegativeInteger(aggregate.sumMs, 'sumMs');
    if (aggregate.sampleCount === 0) {
      if (aggregate.sumMs !== 0 || aggregate.minMs !== null || aggregate.maxMs !== null) {
        throw new HistoryAggregationInvariantError(
          'Empty response aggregate contains sample data.',
        );
      }
      continue;
    }
    if (aggregate.minMs === null || aggregate.maxMs === null) {
      throw new HistoryAggregationInvariantError('Non-empty response aggregate lacks min or max.');
    }
    assertNonnegativeInteger(aggregate.minMs, 'minMs');
    assertNonnegativeInteger(aggregate.maxMs, 'maxMs');
    if (aggregate.maxMs < aggregate.minMs) {
      throw new HistoryAggregationInvariantError('Response aggregate max is below min.');
    }
    if (
      aggregate.sumMs < aggregate.minMs * aggregate.sampleCount ||
      aggregate.sumMs > aggregate.maxMs * aggregate.sampleCount
    ) {
      throw new HistoryAggregationInvariantError(
        'Response aggregate sum is outside min/max bounds.',
      );
    }

    sampleCount += aggregate.sampleCount;
    sumMs += aggregate.sumMs;
    if (!Number.isSafeInteger(sampleCount) || !Number.isSafeInteger(sumMs)) {
      throw new HistoryAggregationInvariantError(
        'Combined response aggregate exceeds safe integers.',
      );
    }
    minMs = minMs === null ? aggregate.minMs : Math.min(minMs, aggregate.minMs);
    maxMs = maxMs === null ? aggregate.maxMs : Math.max(maxMs, aggregate.maxMs);
  }

  return {
    averageMs: sampleCount === 0 ? null : sumMs / sampleCount,
    maxMs,
    minMs,
    sampleCount,
    sumMs,
  };
}
