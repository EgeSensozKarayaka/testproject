import { describe, expect, it } from 'vitest';

import {
  MonitoringInvariantError,
  decideObservationAcceptance,
  deriveEffectiveCheckStatus,
  deriveEffectiveIncidentProjection,
  deriveGroupStatus,
  planFreshnessReconciliation,
  planObservationTransition,
  type AcceptedObservationTransition,
  type CheckRuntimeSnapshot,
  type CompletedObservation,
  type CurrentHealthSnapshot,
  type ObservationTransition,
  type ObservationTransitionInput,
  type OpenHealthIntervalSnapshot,
  type OpenIncidentSegmentSnapshot,
  type OpenIncidentSnapshot,
} from './monitoring-state.js';

const check: CheckRuntimeSnapshot = {
  executionState: 'ACTIVE',
  groupId: 'group-1',
  intervalSeconds: 30,
  lifecycleState: 'ACTIVE',
  probeGeneration: 1n,
  scheduleGeneration: 1n,
  timeoutMs: 1_000,
};

const staleCurrent: CurrentHealthSnapshot = {
  candidate: null,
  consecutiveFailureCount: 0,
  freshUntilMs: null,
  freshnessState: 'STALE',
  healthState: 'UNKNOWN',
  lastAcceptedFencingToken: 0n,
  lastAcceptedRun: null,
  lastFailureAtMs: null,
  lastFailureCategory: null,
  lastResponseTimeMs: null,
  lastStatusCode: null,
  lastSuccessAtMs: null,
  openIncidentId: null,
  staleReconciledAtMs: null,
  stateVersion: 0n,
};

const unknownInterval: OpenHealthIntervalSnapshot = {
  classification: 'UNKNOWN',
  id: 'interval-0',
  probeGeneration: 1n,
  source: 'STARTUP',
  sourceRun: null,
  startedAtMs: 0,
};

function observation(
  outcome: 'PASS' | 'FAIL',
  finishedAtMs: number,
  fencingToken: bigint,
): CompletedObservation {
  return {
    alreadyRecorded: false,
    attemptCurrent: true,
    failureCategory: outcome === 'FAIL' ? 'TIMEOUT' : null,
    fencingToken,
    manualMode: null,
    outcome,
    probeGeneration: 1n,
    run: { finishedAtMs, id: `run-${fencingToken}` },
    scheduleGeneration: 1n,
    statusCode: outcome === 'PASS' ? 200 : null,
    totalMs: outcome === 'PASS' ? 120 : 1_000,
  };
}

interface InputOverrides {
  check?: Partial<CheckRuntimeSnapshot>;
  current?: CurrentHealthSnapshot;
  incident?: OpenIncidentSnapshot | null;
  observation?: CompletedObservation;
  openInterval?: OpenHealthIntervalSnapshot;
  openSegment?: OpenIncidentSegmentSnapshot | null;
}

function transitionInput(overrides: InputOverrides = {}): ObservationTransitionInput {
  return {
    allocations: {
      incidentId: 'incident-new',
      intervalIds: ['interval-next-1', 'interval-next-2'],
      segmentId: 'segment-new',
    },
    check: { ...check, ...overrides.check },
    current: overrides.current ?? { ...staleCurrent },
    incident: overrides.incident ?? null,
    observation: overrides.observation ?? observation('FAIL', 1_000, 1n),
    openInterval: overrides.openInterval ?? { ...unknownInterval },
    openSegment: overrides.openSegment ?? null,
  };
}

function accepted(result: ObservationTransition): AcceptedObservationTransition {
  expect(result.acceptance.accepted).toBe(true);
  if (!('current' in result)) throw new Error('Expected an accepted observation');
  return result;
}

function nextInput(
  previous: AcceptedObservationTransition,
  nextObservation: CompletedObservation,
  allocationSuffix: string,
): ObservationTransitionInput {
  return {
    allocations: {
      incidentId: `incident-${allocationSuffix}`,
      intervalIds: [`interval-${allocationSuffix}-1`, `interval-${allocationSuffix}-2`],
      segmentId: `segment-${allocationSuffix}`,
    },
    check,
    current: previous.current,
    incident: previous.incident,
    observation: nextObservation,
    openInterval: previous.openInterval,
    openSegment: previous.openSegment,
  };
}

describe('observation acceptance', () => {
  it('applies the documented rejection precedence', () => {
    const input = transitionInput({
      check: { executionState: 'PAUSED', lifecycleState: 'DELETED' },
      observation: {
        ...observation('FAIL', 1_000, 0n),
        alreadyRecorded: true,
        attemptCurrent: false,
        manualMode: 'DIAGNOSTIC',
        probeGeneration: 99n,
        scheduleGeneration: 99n,
      },
    });
    expect(decideObservationAcceptance(input.check, input.current, input.observation)).toEqual({
      accepted: false,
      reason: 'DUPLICATE_RUN',
    });

    input.observation.alreadyRecorded = false;
    expect(
      decideObservationAcceptance(input.check, input.current, input.observation),
    ).toMatchObject({
      reason: 'ATTEMPT_NOT_CURRENT',
    });
    input.observation.attemptCurrent = true;
    expect(
      decideObservationAcceptance(input.check, input.current, input.observation),
    ).toMatchObject({
      reason: 'CHECK_DELETED',
    });
    input.check.lifecycleState = 'ACTIVE';
    expect(
      decideObservationAcceptance(input.check, input.current, input.observation),
    ).toMatchObject({
      reason: 'DIAGNOSTIC_RUN',
    });
    input.observation.manualMode = null;
    expect(
      decideObservationAcceptance(input.check, input.current, input.observation),
    ).toMatchObject({
      reason: 'CHECK_PAUSED',
    });
    input.check.executionState = 'ACTIVE';
    expect(
      decideObservationAcceptance(input.check, input.current, input.observation),
    ).toMatchObject({
      reason: 'PROBE_GENERATION_MISMATCH',
    });
    input.observation.probeGeneration = 1n;
    expect(
      decideObservationAcceptance(input.check, input.current, input.observation),
    ).toMatchObject({
      reason: 'SCHEDULE_GENERATION_MISMATCH',
    });
    input.observation.scheduleGeneration = 1n;
    expect(
      decideObservationAcceptance(input.check, input.current, input.observation),
    ).toMatchObject({
      reason: 'STALE_FENCING_TOKEN',
    });
  });

  it('keeps duplicate replay silent and rejects diagnostics without changing state', () => {
    const duplicate = planObservationTransition(
      transitionInput({
        observation: {
          ...observation('PASS', 1_000, 1n),
          alreadyRecorded: true,
          failureCategory: 'INVALID_BUT_IRRELEVANT_TO_DUPLICATE',
          fencingToken: 0n,
          totalMs: -1,
        },
      }),
    );
    expect(duplicate).toEqual({
      acceptance: { accepted: false, reason: 'DUPLICATE_RUN' },
      eventFacts: [],
    });

    const diagnostic = planObservationTransition(
      transitionInput({
        observation: { ...observation('PASS', 1_000, 1n), manualMode: 'DIAGNOSTIC' },
      }),
    );
    expect(diagnostic).toMatchObject({
      acceptance: { accepted: false, reason: 'DIAGNOSTIC_RUN' },
      eventFacts: [{ kind: 'OBSERVATION_REJECTED', reason: 'DIAGNOSTIC_RUN' }],
    });
  });
});

describe('health and incident transitions', () => {
  it('requires two consecutive failures and backdates the incident to the first failure', () => {
    const first = accepted(planObservationTransition(transitionInput()));
    expect(first.current).toMatchObject({
      consecutiveFailureCount: 1,
      freshnessState: 'FRESH',
      healthState: 'SUSPECT',
      stateVersion: 1n,
    });
    expect(first.current.candidate).toEqual({
      run: { finishedAtMs: 1_000, id: 'run-1' },
      startedAtMs: 1_000,
    });
    expect(first.incident).toBeNull();
    expect(first.openInterval.classification).toBe('PROVISIONAL');

    const second = accepted(
      planObservationTransition(nextInput(first, observation('FAIL', 2_000, 2n), 'second')),
    );
    expect(second.current).toMatchObject({
      candidate: null,
      consecutiveFailureCount: 2,
      healthState: 'DOWN',
      openIncidentId: 'incident-second',
      stateVersion: 2n,
    });
    expect(second.incident).toMatchObject({
      confirmedAtMs: 2_000,
      id: 'incident-second',
      startedAtMs: 1_000,
    });
    expect(second.openSegment).toMatchObject({ startedAtMs: 1_000 });
    expect(second.intervalEffects).toContainEqual({
      classification: 'DOWN',
      endedAtMs: 2_000,
      intervalId: first.openInterval.id,
      kind: 'FINALIZE_INTERVAL',
      startedAtMs: 1_000,
    });
  });

  it('resolves a one-check failure as UP history when the next observation passes', () => {
    const first = accepted(planObservationTransition(transitionInput()));
    const recovery = accepted(
      planObservationTransition(nextInput(first, observation('PASS', 2_000, 2n), 'recovery')),
    );
    expect(recovery.current).toMatchObject({
      candidate: null,
      consecutiveFailureCount: 0,
      healthState: 'UP',
      openIncidentId: null,
    });
    expect(recovery.incident).toBeNull();
    expect(recovery.intervalEffects[0]).toMatchObject({
      classification: 'UP',
      kind: 'FINALIZE_INTERVAL',
    });
  });

  it('does not open another incident for repeated failures and closes once on recovery', () => {
    const first = accepted(planObservationTransition(transitionInput()));
    const down = accepted(
      planObservationTransition(nextInput(first, observation('FAIL', 2_000, 2n), 'down')),
    );
    const stillDown = accepted(
      planObservationTransition(nextInput(down, observation('FAIL', 3_000, 3n), 'still-down')),
    );
    expect(stillDown.incident?.id).toBe('incident-down');
    expect(stillDown.incidentEffects.map((effect) => effect.kind)).toEqual([
      'UPDATE_INCIDENT_FAILURE',
    ]);

    const recovered = accepted(
      planObservationTransition(nextInput(stillDown, observation('PASS', 4_000, 4n), 'up')),
    );
    const close = recovered.incidentEffects.find((effect) => effect.kind === 'CLOSE_INCIDENT');
    expect(close).toMatchObject({
      closedAtMs: 4_000,
      closedIncident: { observedDurationMs: 3_000n },
      kind: 'CLOSE_INCIDENT',
    });
    expect(recovered.incident).toBeNull();
    expect(recovered.current.healthState).toBe('UP');
  });

  it('is deterministic and does not mutate its inputs', () => {
    const input = transitionInput();
    const inputBefore = structuredClone(input);
    const first = planObservationTransition(input);
    const second = planObservationTransition(input);
    expect(first).toEqual(second);
    expect(input).toEqual(inputBefore);
  });

  it('preserves core invariants across a deterministic generated observation sequence', () => {
    let result = accepted(
      planObservationTransition(transitionInput({ observation: observation('PASS', 1_000, 1n) })),
    );
    let randomState = 0x5eed1234;
    let atMs = 1_000;
    for (let index = 2; index <= 250; index += 1) {
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
      const outcome = (randomState & 3) === 0 ? 'PASS' : 'FAIL';
      atMs += (randomState & 15) === 0 ? 45_000 : 1_000;
      const previousVersion = result.current.stateVersion;
      const next = nextInput(
        result,
        observation(outcome, atMs, BigInt(index)),
        `generated-${index}`,
      );
      result = accepted(planObservationTransition(next));

      expect(result.current.lastAcceptedFencingToken).toBe(BigInt(index));
      expect(
        result.current.stateVersion === previousVersion + 1n ||
          result.current.stateVersion === previousVersion + 2n,
      ).toBe(true);
      expect(result.current.candidate === null).toBe(result.current.healthState !== 'SUSPECT');
      expect(result.current.healthState === 'DOWN').toBe(result.incident !== null);
      expect(result.openSegment !== null).toBe(result.incident?.observationMode === 'OBSERVED');
      expect(
        result.intervalEffects
          .filter((effect) => effect.kind === 'FINALIZE_INTERVAL')
          .every((effect) => effect.endedAtMs > effect.startedAtMs),
      ).toBe(true);
    }
  });

  it('emits only bounded event facts without target or failure details', () => {
    const result = accepted(planObservationTransition(transitionInput()));
    const serializedFacts = JSON.stringify(result.eventFacts);
    expect(serializedFacts).not.toContain('TIMEOUT');
    expect(serializedFacts).not.toContain('example.com');
    expect(result.eventFacts.every((fact) => 'kind' in fact)).toBe(true);
  });
});

describe('freshness and observation gaps', () => {
  function downTransition(): AcceptedObservationTransition {
    const first = accepted(planObservationTransition(transitionInput()));
    return accepted(
      planObservationTransition(nextInput(first, observation('FAIL', 2_000, 2n), 'down')),
    );
  }

  it('reconciles at the exact deadline and suspends an observed incident once', () => {
    const down = downTransition();
    expect(down.current.freshUntilMs).toBe(38_000);
    const before = planFreshnessReconciliation({
      asOfMs: 37_999,
      current: down.current,
      incident: down.incident,
      nextIntervalId: 'interval-stale',
      openInterval: down.openInterval,
      openSegment: down.openSegment,
    });
    expect(before).toBeNull();

    const stale = planFreshnessReconciliation({
      asOfMs: 38_000,
      current: down.current,
      incident: down.incident,
      nextIntervalId: 'interval-stale',
      openInterval: down.openInterval,
      openSegment: down.openSegment,
    });
    expect(stale).not.toBeNull();
    expect(stale?.current).toMatchObject({
      freshnessState: 'STALE',
      healthState: 'DOWN',
      staleReconciledAtMs: 38_000,
      stateVersion: 3n,
    });
    expect(stale?.incident).toMatchObject({
      observationMode: 'UNOBSERVED',
      observedDurationMs: 37_000n,
    });
    expect(stale?.openInterval.classification).toBe('UNKNOWN');

    const again = planFreshnessReconciliation({
      asOfMs: 50_000,
      current: stale!.current,
      incident: stale!.incident,
      nextIntervalId: 'interval-unused',
      openInterval: stale!.openInterval,
      openSegment: stale!.openSegment,
    });
    expect(again).toBeNull();
  });

  it('resumes the same incident after a gap and excludes that gap from duration', () => {
    const down = downTransition();
    const stale = planFreshnessReconciliation({
      asOfMs: 50_000,
      current: down.current,
      incident: down.incident,
      nextIntervalId: 'interval-stale',
      openInterval: down.openInterval,
      openSegment: down.openSegment,
    })!;
    const resumed = accepted(
      planObservationTransition({
        ...nextInput(down, observation('FAIL', 50_000, 3n), 'resume'),
        current: stale.current,
        incident: stale.incident,
        openInterval: stale.openInterval,
        openSegment: stale.openSegment,
      }),
    );
    expect(resumed.incident?.id).toBe('incident-down');
    expect(resumed.incidentEffects[0]?.kind).toBe('RESUME_INCIDENT');

    const recovered = accepted(
      planObservationTransition(nextInput(resumed, observation('PASS', 55_000, 4n), 'recover')),
    );
    expect(recovered.incidentEffects[0]).toMatchObject({
      closedIncident: { observedDurationMs: 42_000n },
      kind: 'CLOSE_INCIDENT',
    });
  });

  it('reconciles an overdue snapshot before applying a newly completed observation', () => {
    const down = downTransition();
    const recovered = accepted(
      planObservationTransition(nextInput(down, observation('PASS', 50_000, 3n), 'late-pass')),
    );
    expect(recovered.current).toMatchObject({
      freshnessState: 'FRESH',
      healthState: 'UP',
      stateVersion: 4n,
    });
    expect(recovered.incidentEffects.map((effect) => effect.kind)).toEqual([
      'SUSPEND_INCIDENT',
      'CLOSE_INCIDENT',
    ]);
    expect(recovered.intervalEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ classification: 'DOWN', endedAtMs: 38_000 }),
        expect.objectContaining({ classification: 'UNKNOWN', endedAtMs: 50_000 }),
      ]),
    );
    const close = recovered.incidentEffects[1];
    expect(close).toMatchObject({ closedIncident: { observedDurationMs: 37_000n } });
  });
});

describe('query-time projections', () => {
  it('uses the deadline as an immediate inclusive stale boundary', () => {
    const base = {
      executionState: 'ACTIVE' as const,
      freshUntilMs: 10_000,
      healthState: 'DOWN' as const,
      persistedFreshnessState: 'FRESH' as const,
    };
    expect(deriveEffectiveCheckStatus({ ...base, queryTimeMs: 9_999 })).toEqual({
      freshnessState: 'FRESH',
      healthState: 'DOWN',
    });
    expect(deriveEffectiveCheckStatus({ ...base, queryTimeMs: 10_000 })).toEqual({
      freshnessState: 'STALE',
      healthState: 'UNKNOWN',
    });
  });

  it('caps live incident duration at fresh_until before reconciliation catches up', () => {
    const projection = deriveEffectiveIncidentProjection({
      freshUntilMs: 10_000,
      incident: {
        confirmedAtMs: 2_000,
        id: 'incident-1',
        lastFailureCategory: 'TIMEOUT',
        observationMode: 'OBSERVED',
        observedDurationMs: 500n,
        resourceVersion: 1n,
        startedAtMs: 1_000,
      },
      openSegment: {
        id: 'segment-1',
        incidentId: 'incident-1',
        startRun: { finishedAtMs: 3_000, id: 'run-1' },
        startedAtMs: 3_000,
      },
      queryTimeMs: 20_000,
    });
    expect(projection).toEqual({
      incidentId: 'incident-1',
      observationMode: 'UNOBSERVED',
      observedDurationMs: 7_500n,
    });
  });

  it('derives group severity from active live checks without a cardinality cap', () => {
    const members = Array.from({ length: 500 }, (_, index) => ({
      executionState: index === 499 ? ('PAUSED' as const) : ('ACTIVE' as const),
      freshUntilMs: 20_000,
      healthState: index === 300 ? ('DOWN' as const) : ('UP' as const),
      lifecycleState: index === 498 ? ('DELETED' as const) : ('ACTIVE' as const),
      persistedFreshnessState: 'FRESH' as const,
    }));
    expect(deriveGroupStatus(members, 10_000)).toMatchObject({
      active: 498,
      down: 1,
      healthState: 'DOWN',
      paused: 1,
      up: 497,
    });
  });

  it('uses DOWN, SUSPECT, UNKNOWN, UP precedence and reports empty groups as UNKNOWN', () => {
    const member = (healthState: 'UNKNOWN' | 'UP' | 'SUSPECT' | 'DOWN') => ({
      executionState: 'ACTIVE' as const,
      freshUntilMs: 20_000,
      healthState,
      lifecycleState: 'ACTIVE' as const,
      persistedFreshnessState: 'FRESH' as const,
    });
    expect(deriveGroupStatus([], 10_000).healthState).toBe('UNKNOWN');
    expect(deriveGroupStatus([member('UP'), member('UNKNOWN')], 10_000).healthState).toBe(
      'UNKNOWN',
    );
    expect(deriveGroupStatus([member('UNKNOWN'), member('SUSPECT')], 10_000).healthState).toBe(
      'SUSPECT',
    );
    expect(deriveGroupStatus([member('SUSPECT'), member('DOWN')], 10_000).healthState).toBe('DOWN');
  });
});

describe('invariant enforcement', () => {
  it('rejects a contradictory incident pointer before reducing an accepted observation', () => {
    expect(() =>
      planObservationTransition(
        transitionInput({ current: { ...staleCurrent, openIncidentId: 'missing-incident' } }),
      ),
    ).toThrow(MonitoringInvariantError);
  });
});
