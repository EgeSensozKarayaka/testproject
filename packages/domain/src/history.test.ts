import { describe, expect, it } from 'vitest';

import {
  aggregateTimelineIntoBuckets,
  combineResponseSampleAggregates,
  HistoryAggregationInvariantError,
  planHistoryWindow,
  summarizeHistoryDuration,
  type HistoryWindowPlan,
} from './history.js';

function twoMinuteWindow(): HistoryWindowPlan {
  return {
    bucketCount: 2,
    bucketSizeMs: 60_000,
    fromMs: 0,
    period: 'day',
    sourceResolution: 'minute',
    toMs: 120_000,
  };
}

describe('history aggregation', () => {
  it.each([
    ['day', 288, 300_000, 'minute', 60_000],
    ['week', 336, 1_800_000, 'minute', 60_000],
    ['month', 360, 7_200_000, 'hour', 3_600_000],
  ] as const)(
    'plans a bounded %s window aligned to its source resolution',
    (period, bucketCount, bucketSizeMs, sourceResolution, alignmentMs) => {
      const plan = planHistoryWindow(period, Date.UTC(2026, 9, 10, 12, 34, 56, 789));

      expect(plan).toMatchObject({ bucketCount, bucketSizeMs, period, sourceResolution });
      expect(plan.toMs % alignmentMs).toBe(0);
      expect(plan.toMs - plan.fromMs).toBe(bucketCount * bucketSizeMs);
    },
  );

  it('clips intervals at half-open bucket boundaries and leaves gaps unknown', () => {
    const buckets = aggregateTimelineIntoBuckets(twoMinuteWindow(), [
      { classification: 'UP', endMs: 30_000, startMs: -30_000 },
      { classification: 'DOWN', endMs: 90_000, startMs: 30_000 },
      { classification: 'PROVISIONAL', endMs: 120_000, startMs: 90_000 },
    ]);

    expect(buckets).toEqual([
      {
        availabilityRatio: 0.5,
        classification: 'MIXED',
        coverageRatio: 1,
        downMs: 30_000,
        fromMs: 0,
        provisionalMs: 0,
        requestedMs: 60_000,
        toMs: 60_000,
        unknownMs: 0,
        upMs: 30_000,
      },
      {
        availabilityRatio: 0,
        classification: 'MIXED',
        coverageRatio: 0.5,
        downMs: 30_000,
        fromMs: 60_000,
        provisionalMs: 30_000,
        requestedMs: 60_000,
        toMs: 120_000,
        unknownMs: 0,
        upMs: 0,
      },
    ]);
  });

  it('keeps no-data availability null and reports coverage independently', () => {
    expect(
      summarizeHistoryDuration(
        { downMs: 0, provisionalMs: 15_000, unknownMs: 45_000, upMs: 0 },
        60_000,
      ),
    ).toEqual({
      availabilityRatio: null,
      classification: 'PROVISIONAL',
      coverageRatio: 0,
      downMs: 0,
      provisionalMs: 15_000,
      requestedMs: 60_000,
      unknownMs: 45_000,
      upMs: 0,
    });
  });

  it('derives the same availability from duration regardless of run cadence', () => {
    const duration = { downMs: 25_000, provisionalMs: 0, unknownMs: 20_000, upMs: 55_000 };
    const thirtySecondCadence = summarizeHistoryDuration(duration, 100_000);
    const hourlyCadence = summarizeHistoryDuration(duration, 100_000);

    expect(thirtySecondCadence.availabilityRatio).toBe(0.6875);
    expect(hourlyCadence).toEqual(thirtySecondCadence);
  });

  it('combines response sums and counts instead of averaging averages', () => {
    expect(
      combineResponseSampleAggregates([
        { maxMs: 100, minMs: 100, sampleCount: 1, sumMs: 100 },
        { maxMs: 900, minMs: 900, sampleCount: 9, sumMs: 8_100 },
      ]),
    ).toEqual({
      averageMs: 820,
      maxMs: 900,
      minMs: 100,
      sampleCount: 10,
      sumMs: 8_200,
    });
  });

  it('rejects overlapping timelines and incomplete duration accounting', () => {
    expect(() =>
      aggregateTimelineIntoBuckets(twoMinuteWindow(), [
        { classification: 'UP', endMs: 60_001, startMs: 0 },
        { classification: 'DOWN', endMs: 120_000, startMs: 60_000 },
      ]),
    ).toThrow(HistoryAggregationInvariantError);

    expect(() =>
      summarizeHistoryDuration({ downMs: 10, provisionalMs: 0, unknownMs: 10, upMs: 10 }, 31),
    ).toThrow(/exactly cover/u);
  });

  it('rejects malformed response aggregates', () => {
    expect(() =>
      combineResponseSampleAggregates([{ maxMs: 200, minMs: 100, sampleCount: 2, sumMs: 50 }]),
    ).toThrow(/outside min\/max bounds/u);
  });
});
