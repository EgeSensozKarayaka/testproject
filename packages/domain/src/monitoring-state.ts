export const FAILURE_THRESHOLD_V1 = 2 as const;
export const DEFAULT_SCHEDULER_GRACE_MS = 5_000 as const;

export type HealthState = 'UNKNOWN' | 'UP' | 'SUSPECT' | 'DOWN';
export type FreshnessState = 'FRESH' | 'STALE';
export type ExecutionState = 'ACTIVE' | 'PAUSED';
export type LifecycleState = 'ACTIVE' | 'DELETED';
export type ObservationOutcome = 'PASS' | 'FAIL';
export type ManualRunMode = 'STATEFUL' | 'DIAGNOSTIC' | null;
export type IncidentObservationMode = 'OBSERVED' | 'UNOBSERVED';
export type TimelineClassification = 'UNKNOWN' | 'UP' | 'PROVISIONAL' | 'DOWN';
export type TimelineSource = 'STARTUP' | 'RUN' | 'FRESHNESS' | 'CONFIG' | 'PAUSE' | 'RESUME';

export type ObservationRejectionReason =
  | 'DUPLICATE_RUN'
  | 'ATTEMPT_NOT_CURRENT'
  | 'CHECK_DELETED'
  | 'DIAGNOSTIC_RUN'
  | 'CHECK_PAUSED'
  | 'PROBE_GENERATION_MISMATCH'
  | 'SCHEDULE_GENERATION_MISMATCH'
  | 'STALE_FENCING_TOKEN';

export class MonitoringInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MonitoringInvariantError';
  }
}

export interface RunReference {
  finishedAtMs: number;
  id: string;
}

export interface FailureCandidate {
  run: RunReference;
  startedAtMs: number;
}

export interface CurrentHealthSnapshot {
  candidate: FailureCandidate | null;
  consecutiveFailureCount: 0 | 1 | 2;
  freshUntilMs: number | null;
  freshnessState: FreshnessState;
  healthState: HealthState;
  lastAcceptedFencingToken: bigint;
  lastAcceptedRun: RunReference | null;
  lastFailureAtMs: number | null;
  lastFailureCategory: string | null;
  lastResponseTimeMs: number | null;
  lastStatusCode: number | null;
  lastSuccessAtMs: number | null;
  openIncidentId: string | null;
  staleReconciledAtMs: number | null;
  stateVersion: bigint;
}

export interface OpenIncidentSnapshot {
  confirmedAtMs: number;
  id: string;
  lastFailureCategory: string | null;
  observationMode: IncidentObservationMode;
  observedDurationMs: bigint;
  resourceVersion: bigint;
  startedAtMs: number;
}

export interface OpenIncidentSegmentSnapshot {
  id: string;
  incidentId: string;
  startRun: RunReference;
  startedAtMs: number;
}

export interface OpenHealthIntervalSnapshot {
  classification: TimelineClassification;
  id: string;
  probeGeneration: bigint;
  source: TimelineSource;
  sourceRun: RunReference | null;
  startedAtMs: number;
}

export interface CheckRuntimeSnapshot {
  executionState: ExecutionState;
  groupId: string | null;
  intervalSeconds: number;
  lifecycleState: LifecycleState;
  probeGeneration: bigint;
  scheduleGeneration: bigint;
  timeoutMs: number;
}

export interface CompletedObservation {
  alreadyRecorded: boolean;
  attemptCurrent: boolean;
  failureCategory: string | null;
  fencingToken: bigint;
  manualMode: ManualRunMode;
  outcome: ObservationOutcome;
  probeGeneration: bigint;
  run: RunReference;
  scheduleGeneration: bigint;
  statusCode: number | null;
  totalMs: number;
}

export interface TransitionAllocations {
  incidentId: string;
  intervalIds: readonly string[];
  segmentId: string;
}

export interface ObservationTransitionInput {
  allocations: TransitionAllocations;
  check: CheckRuntimeSnapshot;
  current: CurrentHealthSnapshot;
  incident: OpenIncidentSnapshot | null;
  observation: CompletedObservation;
  openInterval: OpenHealthIntervalSnapshot;
  openSegment: OpenIncidentSegmentSnapshot | null;
  schedulerGraceMs?: number;
}

export type ObservationAcceptance =
  { accepted: true } | { accepted: false; reason: ObservationRejectionReason };

export type IntervalEffect =
  | {
      classification: Exclude<TimelineClassification, 'PROVISIONAL'>;
      endedAtMs: number;
      intervalId: string;
      kind: 'FINALIZE_INTERVAL';
      startedAtMs: number;
    }
  | {
      interval: OpenHealthIntervalSnapshot;
      kind: 'SET_OPEN_INTERVAL';
      mode: 'UPDATE' | 'ROTATE';
    };

export type IncidentEffect =
  | {
      incident: OpenIncidentSnapshot;
      kind: 'OPEN_INCIDENT';
      segment: OpenIncidentSegmentSnapshot;
    }
  | {
      incident: OpenIncidentSnapshot;
      kind: 'UPDATE_INCIDENT_FAILURE';
    }
  | {
      incident: OpenIncidentSnapshot;
      kind: 'SUSPEND_INCIDENT';
      segmentEndedAtMs: number;
      segmentId: string;
    }
  | {
      incident: OpenIncidentSnapshot;
      kind: 'RESUME_INCIDENT';
      segment: OpenIncidentSegmentSnapshot;
    }
  | {
      closedAtMs: number;
      closedIncident: OpenIncidentSnapshot;
      kind: 'CLOSE_INCIDENT';
      segmentId: string | null;
    };

export type MonitoringEventFact =
  | { kind: 'OBSERVATION_ACCEPTED'; outcome: ObservationOutcome; run: RunReference }
  | { kind: 'OBSERVATION_REJECTED'; reason: ObservationRejectionReason; run: RunReference }
  | {
      from: FreshnessState;
      kind: 'FRESHNESS_CHANGED';
      to: FreshnessState;
      transitionedAtMs: number;
    }
  | { from: HealthState; kind: 'HEALTH_CHANGED'; to: HealthState; transitionedAtMs: number }
  | { incidentId: string; kind: 'INCIDENT_OPENED'; transitionedAtMs: number }
  | { incidentId: string; kind: 'INCIDENT_SUSPENDED'; transitionedAtMs: number }
  | { incidentId: string; kind: 'INCIDENT_RESUMED'; transitionedAtMs: number }
  | { incidentId: string; kind: 'INCIDENT_CLOSED'; transitionedAtMs: number };

export interface AcceptedObservationTransition {
  acceptance: { accepted: true };
  affectedGroupId: string | null;
  current: CurrentHealthSnapshot;
  eventFacts: MonitoringEventFact[];
  incident: OpenIncidentSnapshot | null;
  incidentEffects: IncidentEffect[];
  intervalEffects: IntervalEffect[];
  openInterval: OpenHealthIntervalSnapshot;
  openSegment: OpenIncidentSegmentSnapshot | null;
}

export interface RejectedObservationTransition {
  acceptance: { accepted: false; reason: ObservationRejectionReason };
  eventFacts: MonitoringEventFact[];
}

export type ObservationTransition = AcceptedObservationTransition | RejectedObservationTransition;

export interface FreshnessReconciliationInput {
  asOfMs: number;
  current: CurrentHealthSnapshot;
  incident: OpenIncidentSnapshot | null;
  nextIntervalId: string;
  openInterval: OpenHealthIntervalSnapshot;
  openSegment: OpenIncidentSegmentSnapshot | null;
}

export interface FreshnessReconciliation {
  current: CurrentHealthSnapshot;
  eventFacts: MonitoringEventFact[];
  incident: OpenIncidentSnapshot | null;
  incidentEffects: IncidentEffect[];
  intervalEffects: IntervalEffect[];
  openInterval: OpenHealthIntervalSnapshot;
  openSegment: null;
}

export interface EffectiveCheckStatusInput {
  executionState: ExecutionState;
  freshUntilMs: number | null;
  healthState: HealthState;
  persistedFreshnessState: FreshnessState;
  queryTimeMs: number;
}

export interface EffectiveCheckStatus {
  freshnessState: FreshnessState;
  healthState: HealthState;
}

export interface EffectiveIncidentProjectionInput {
  freshUntilMs: number | null;
  incident: OpenIncidentSnapshot | null;
  openSegment: OpenIncidentSegmentSnapshot | null;
  queryTimeMs: number;
}

export interface EffectiveIncidentProjection {
  incidentId: string;
  observationMode: IncidentObservationMode;
  observedDurationMs: bigint;
}

export interface GroupStatusMember {
  executionState: ExecutionState;
  freshUntilMs: number | null;
  healthState: HealthState;
  lifecycleState: LifecycleState;
  persistedFreshnessState: FreshnessState;
}

export interface GroupStatusSummary {
  active: number;
  down: number;
  healthState: HealthState;
  paused: number;
  suspect: number;
  unknown: number;
  up: number;
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new MonitoringInvariantError(message);
}

function assertInstant(value: number, label: string): void {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    `${label} must be a non-negative safe integer.`,
  );
}

function assertIdentifier(value: string, label: string): void {
  invariant(value.trim().length > 0, `${label} must not be empty.`);
}

function assertRun(run: RunReference, label: string): void {
  assertIdentifier(run.id, `${label}.id`);
  assertInstant(run.finishedAtMs, `${label}.finishedAtMs`);
}

function cloneRun(run: RunReference): RunReference {
  return { ...run };
}

function cloneCandidate(candidate: FailureCandidate | null): FailureCandidate | null {
  return candidate === null
    ? null
    : { run: cloneRun(candidate.run), startedAtMs: candidate.startedAtMs };
}

function cloneCurrent(current: CurrentHealthSnapshot): CurrentHealthSnapshot {
  return {
    ...current,
    candidate: cloneCandidate(current.candidate),
    lastAcceptedRun: current.lastAcceptedRun === null ? null : cloneRun(current.lastAcceptedRun),
  };
}

function cloneIncident(incident: OpenIncidentSnapshot | null): OpenIncidentSnapshot | null {
  return incident === null ? null : { ...incident };
}

function cloneSegment(
  segment: OpenIncidentSegmentSnapshot | null,
): OpenIncidentSegmentSnapshot | null {
  return segment === null ? null : { ...segment, startRun: cloneRun(segment.startRun) };
}

function cloneInterval(interval: OpenHealthIntervalSnapshot): OpenHealthIntervalSnapshot {
  return {
    ...interval,
    sourceRun: interval.sourceRun === null ? null : cloneRun(interval.sourceRun),
  };
}

function validateRuntime(check: CheckRuntimeSnapshot): void {
  invariant(
    Number.isInteger(check.intervalSeconds) &&
      check.intervalSeconds >= 30 &&
      check.intervalSeconds <= 3_600,
    'intervalSeconds is invalid.',
  );
  invariant(
    Number.isInteger(check.timeoutMs) && check.timeoutMs >= 100 && check.timeoutMs <= 60_000,
    'timeoutMs is invalid.',
  );
  invariant(check.probeGeneration >= 1n, 'probeGeneration must be positive.');
  invariant(check.scheduleGeneration >= 1n, 'scheduleGeneration must be positive.');
}

function expectedOpenClassification(current: CurrentHealthSnapshot): TimelineClassification {
  if (current.freshnessState === 'STALE') return 'UNKNOWN';
  switch (current.healthState) {
    case 'UNKNOWN':
      return 'UNKNOWN';
    case 'UP':
      return 'UP';
    case 'SUSPECT':
      return 'PROVISIONAL';
    case 'DOWN':
      return 'DOWN';
  }
}

function validateSnapshots(
  current: CurrentHealthSnapshot,
  incident: OpenIncidentSnapshot | null,
  segment: OpenIncidentSegmentSnapshot | null,
  interval: OpenHealthIntervalSnapshot,
): void {
  invariant(current.stateVersion >= 0n, 'stateVersion must not be negative.');
  invariant(
    current.lastAcceptedFencingToken >= 0n,
    'lastAcceptedFencingToken must not be negative.',
  );
  if (current.freshUntilMs !== null) assertInstant(current.freshUntilMs, 'freshUntilMs');
  if (current.staleReconciledAtMs !== null)
    assertInstant(current.staleReconciledAtMs, 'staleReconciledAtMs');
  if (current.lastAcceptedRun !== null) assertRun(current.lastAcceptedRun, 'lastAcceptedRun');
  if (current.candidate !== null) {
    assertRun(current.candidate.run, 'candidate.run');
    assertInstant(current.candidate.startedAtMs, 'candidate.startedAtMs');
    invariant(current.healthState === 'SUSPECT', 'A candidate requires SUSPECT health.');
    invariant(
      current.consecutiveFailureCount === 1,
      'A candidate requires one consecutive failure.',
    );
    invariant(current.openIncidentId === null, 'A candidate cannot coexist with an open incident.');
  } else {
    invariant(
      current.consecutiveFailureCount !== 1,
      'One consecutive failure requires a candidate.',
    );
  }
  if (current.freshnessState === 'STALE') {
    invariant(current.candidate === null, 'A stale state cannot retain a candidate.');
    invariant(current.consecutiveFailureCount === 0, 'A stale state cannot retain failure count.');
  } else {
    invariant(current.freshUntilMs !== null, 'A fresh state requires a freshness deadline.');
    invariant(current.staleReconciledAtMs === null, 'A fresh state cannot be marked reconciled.');
    if (current.healthState === 'SUSPECT') {
      invariant(current.candidate !== null, 'Fresh SUSPECT health requires a candidate.');
    }
    if (current.healthState === 'DOWN') {
      invariant(
        current.consecutiveFailureCount === FAILURE_THRESHOLD_V1,
        'Fresh DOWN health requires a saturated failure count.',
      );
    }
  }
  invariant(
    current.openIncidentId === (incident?.id ?? null),
    'The current state and open incident pointers disagree.',
  );
  if (current.healthState === 'DOWN')
    invariant(incident !== null, 'DOWN health requires an open incident.');
  if (incident !== null)
    invariant(current.healthState === 'DOWN', 'An open incident requires DOWN health.');
  if (incident === null) {
    invariant(segment === null, 'An open segment requires an open incident.');
  } else {
    assertIdentifier(incident.id, 'incident.id');
    assertInstant(incident.startedAtMs, 'incident.startedAtMs');
    assertInstant(incident.confirmedAtMs, 'incident.confirmedAtMs');
    invariant(
      incident.confirmedAtMs >= incident.startedAtMs,
      'Incident confirmation precedes its start.',
    );
    invariant(incident.observedDurationMs >= 0n, 'Incident duration must not be negative.');
    invariant(incident.resourceVersion >= 1n, 'Incident resourceVersion must be positive.');
    invariant(
      (incident.observationMode === 'OBSERVED') === (segment !== null),
      'Incident observation mode and open segment disagree.',
    );
    if (segment !== null) {
      assertIdentifier(segment.id, 'segment.id');
      assertInstant(segment.startedAtMs, 'segment.startedAtMs');
      assertRun(segment.startRun, 'segment.startRun');
      invariant(segment.incidentId === incident.id, 'Segment belongs to another incident.');
      invariant(segment.startedAtMs >= incident.startedAtMs, 'Segment starts before its incident.');
    }
  }
  assertIdentifier(interval.id, 'openInterval.id');
  assertInstant(interval.startedAtMs, 'openInterval.startedAtMs');
  invariant(interval.probeGeneration >= 1n, 'Interval probeGeneration must be positive.');
  invariant(
    interval.classification === expectedOpenClassification(current),
    'The open interval does not represent the current effective state.',
  );
}

export function decideObservationAcceptance(
  check: CheckRuntimeSnapshot,
  current: CurrentHealthSnapshot,
  observation: CompletedObservation,
): ObservationAcceptance {
  if (observation.alreadyRecorded) return { accepted: false, reason: 'DUPLICATE_RUN' };
  if (!observation.attemptCurrent) return { accepted: false, reason: 'ATTEMPT_NOT_CURRENT' };
  if (check.lifecycleState === 'DELETED') return { accepted: false, reason: 'CHECK_DELETED' };
  if (observation.manualMode === 'DIAGNOSTIC') {
    return { accepted: false, reason: 'DIAGNOSTIC_RUN' };
  }
  if (check.executionState === 'PAUSED') return { accepted: false, reason: 'CHECK_PAUSED' };
  if (observation.probeGeneration !== check.probeGeneration) {
    return { accepted: false, reason: 'PROBE_GENERATION_MISMATCH' };
  }
  if (observation.scheduleGeneration !== check.scheduleGeneration) {
    return { accepted: false, reason: 'SCHEDULE_GENERATION_MISMATCH' };
  }
  if (observation.fencingToken <= current.lastAcceptedFencingToken) {
    return { accepted: false, reason: 'STALE_FENCING_TOKEN' };
  }
  return { accepted: true };
}

function safeAddMs(base: number, delta: number): number {
  const value = base + delta;
  invariant(Number.isSafeInteger(value) && value >= base, 'Timestamp arithmetic overflowed.');
  return value;
}

function durationMs(startedAtMs: number, endedAtMs: number): bigint {
  invariant(endedAtMs >= startedAtMs, 'A duration cannot end before it starts.');
  return BigInt(endedAtMs - startedAtMs);
}

interface WorkingTransition {
  current: CurrentHealthSnapshot;
  eventFacts: MonitoringEventFact[];
  incident: OpenIncidentSnapshot | null;
  incidentEffects: IncidentEffect[];
  intervalEffects: IntervalEffect[];
  openInterval: OpenHealthIntervalSnapshot;
  openSegment: OpenIncidentSegmentSnapshot | null;
}

function rotateInterval(
  work: WorkingTransition,
  nextClassification: TimelineClassification,
  atMs: number,
  finalClassification: Exclude<TimelineClassification, 'PROVISIONAL'>,
  nextId: string,
  probeGeneration: bigint,
  source: TimelineSource,
  sourceRun: RunReference | null,
): void {
  if (work.openInterval.classification === nextClassification) return;
  invariant(
    atMs >= work.openInterval.startedAtMs,
    'Timeline transition precedes its open interval.',
  );
  assertIdentifier(nextId, 'nextIntervalId');

  let mode: 'UPDATE' | 'ROTATE' = 'UPDATE';
  let id = work.openInterval.id;
  if (atMs > work.openInterval.startedAtMs) {
    work.intervalEffects.push({
      classification: finalClassification,
      endedAtMs: atMs,
      intervalId: work.openInterval.id,
      kind: 'FINALIZE_INTERVAL',
      startedAtMs: work.openInterval.startedAtMs,
    });
    mode = 'ROTATE';
    id = nextId;
  }

  work.openInterval = {
    classification: nextClassification,
    id,
    probeGeneration,
    source,
    sourceRun: sourceRun === null ? null : cloneRun(sourceRun),
    startedAtMs: atMs,
  };
  work.intervalEffects.push({
    interval: cloneInterval(work.openInterval),
    kind: 'SET_OPEN_INTERVAL',
    mode,
  });
}

function reconcileFreshnessInPlace(
  work: WorkingTransition,
  deadlineMs: number,
  nextIntervalId: string,
): void {
  const previousFreshness = work.current.freshnessState;
  rotateInterval(
    work,
    'UNKNOWN',
    deadlineMs,
    work.openInterval.classification === 'PROVISIONAL'
      ? 'UNKNOWN'
      : work.openInterval.classification,
    nextIntervalId,
    work.openInterval.probeGeneration,
    'FRESHNESS',
    null,
  );

  if (work.incident?.observationMode === 'OBSERVED') {
    invariant(work.openSegment !== null, 'An observed incident requires an open segment.');
    const segment = work.openSegment;
    work.incident = {
      ...work.incident,
      observationMode: 'UNOBSERVED',
      observedDurationMs:
        work.incident.observedDurationMs + durationMs(segment.startedAtMs, deadlineMs),
      resourceVersion: work.incident.resourceVersion + 1n,
    };
    work.incidentEffects.push({
      incident: { ...work.incident },
      kind: 'SUSPEND_INCIDENT',
      segmentEndedAtMs: deadlineMs,
      segmentId: segment.id,
    });
    work.eventFacts.push({
      incidentId: work.incident.id,
      kind: 'INCIDENT_SUSPENDED',
      transitionedAtMs: deadlineMs,
    });
    work.openSegment = null;
  }

  work.current = {
    ...work.current,
    candidate: null,
    consecutiveFailureCount: 0,
    freshnessState: 'STALE',
    staleReconciledAtMs: deadlineMs,
    stateVersion: work.current.stateVersion + 1n,
  };
  if (previousFreshness !== 'STALE') {
    work.eventFacts.push({
      from: previousFreshness,
      kind: 'FRESHNESS_CHANGED',
      to: 'STALE',
      transitionedAtMs: deadlineMs,
    });
  }
}

export function planFreshnessReconciliation(
  input: FreshnessReconciliationInput,
): FreshnessReconciliation | null {
  assertInstant(input.asOfMs, 'asOfMs');
  validateSnapshots(input.current, input.incident, input.openSegment, input.openInterval);
  if (
    input.current.freshnessState === 'STALE' ||
    input.current.freshUntilMs === null ||
    input.asOfMs < input.current.freshUntilMs
  ) {
    return null;
  }

  const work: WorkingTransition = {
    current: cloneCurrent(input.current),
    eventFacts: [],
    incident: cloneIncident(input.incident),
    incidentEffects: [],
    intervalEffects: [],
    openInterval: cloneInterval(input.openInterval),
    openSegment: cloneSegment(input.openSegment),
  };
  reconcileFreshnessInPlace(work, input.current.freshUntilMs, input.nextIntervalId);
  return {
    current: work.current,
    eventFacts: work.eventFacts,
    incident: work.incident,
    incidentEffects: work.incidentEffects,
    intervalEffects: work.intervalEffects,
    openInterval: work.openInterval,
    openSegment: null,
  };
}

function validateObservation(input: ObservationTransitionInput): void {
  validateRuntime(input.check);
  assertRun(input.observation.run, 'observation.run');
  invariant(input.observation.fencingToken >= 1n, 'fencingToken must be positive.');
  invariant(
    Number.isInteger(input.observation.totalMs) && input.observation.totalMs >= 0,
    'totalMs is invalid.',
  );
  const schedulerGraceMs = input.schedulerGraceMs ?? DEFAULT_SCHEDULER_GRACE_MS;
  invariant(
    Number.isInteger(schedulerGraceMs) && schedulerGraceMs >= 0 && schedulerGraceMs <= 60_000,
    'schedulerGraceMs is invalid.',
  );
  if (input.observation.statusCode !== null) {
    invariant(
      Number.isInteger(input.observation.statusCode) &&
        input.observation.statusCode >= 100 &&
        input.observation.statusCode <= 599,
      'statusCode is invalid.',
    );
  }
  if (input.observation.outcome === 'PASS') {
    invariant(
      input.observation.failureCategory === null,
      'A passing observation cannot have a failure category.',
    );
  } else {
    invariant(
      input.observation.failureCategory !== null && input.observation.failureCategory.length > 0,
      'A failed observation requires a failure category.',
    );
  }
}

function nextIntervalId(input: ObservationTransitionInput, index: number): string {
  const id = input.allocations.intervalIds[index];
  invariant(id !== undefined, 'Not enough interval IDs were allocated for this transition.');
  return id;
}

function openIncident(
  work: WorkingTransition,
  input: ObservationTransitionInput,
  candidate: FailureCandidate,
): void {
  assertIdentifier(input.allocations.incidentId, 'allocations.incidentId');
  assertIdentifier(input.allocations.segmentId, 'allocations.segmentId');
  const incident: OpenIncidentSnapshot = {
    confirmedAtMs: input.observation.run.finishedAtMs,
    id: input.allocations.incidentId,
    lastFailureCategory: input.observation.failureCategory,
    observationMode: 'OBSERVED',
    observedDurationMs: 0n,
    resourceVersion: 1n,
    startedAtMs: candidate.startedAtMs,
  };
  const segment: OpenIncidentSegmentSnapshot = {
    id: input.allocations.segmentId,
    incidentId: incident.id,
    startRun: cloneRun(candidate.run),
    startedAtMs: candidate.startedAtMs,
  };
  work.incident = incident;
  work.openSegment = segment;
  work.current.openIncidentId = incident.id;
  work.incidentEffects.push({
    incident: { ...incident },
    kind: 'OPEN_INCIDENT',
    segment: cloneSegment(segment)!,
  });
  work.eventFacts.push({
    incidentId: incident.id,
    kind: 'INCIDENT_OPENED',
    transitionedAtMs: input.observation.run.finishedAtMs,
  });
}

function resumeIncident(work: WorkingTransition, input: ObservationTransitionInput): void {
  invariant(work.incident !== null, 'Cannot resume a missing incident.');
  invariant(work.openSegment === null, 'Cannot resume an incident with an open segment.');
  assertIdentifier(input.allocations.segmentId, 'allocations.segmentId');
  const segment: OpenIncidentSegmentSnapshot = {
    id: input.allocations.segmentId,
    incidentId: work.incident.id,
    startRun: cloneRun(input.observation.run),
    startedAtMs: input.observation.run.finishedAtMs,
  };
  work.incident = {
    ...work.incident,
    lastFailureCategory: input.observation.failureCategory,
    observationMode: 'OBSERVED',
    resourceVersion: work.incident.resourceVersion + 1n,
  };
  work.openSegment = segment;
  work.incidentEffects.push({
    incident: { ...work.incident },
    kind: 'RESUME_INCIDENT',
    segment: cloneSegment(segment)!,
  });
  work.eventFacts.push({
    incidentId: work.incident.id,
    kind: 'INCIDENT_RESUMED',
    transitionedAtMs: input.observation.run.finishedAtMs,
  });
}

function closeIncident(work: WorkingTransition, atMs: number): void {
  invariant(work.incident !== null, 'Cannot close a missing incident.');
  const incident = work.incident;
  let closedIncident = { ...incident };
  let segmentId: string | null = null;
  if (incident.observationMode === 'OBSERVED') {
    invariant(work.openSegment !== null, 'An observed incident requires an open segment.');
    segmentId = work.openSegment.id;
    closedIncident = {
      ...closedIncident,
      observedDurationMs:
        closedIncident.observedDurationMs + durationMs(work.openSegment.startedAtMs, atMs),
      resourceVersion: closedIncident.resourceVersion + 1n,
    };
  } else {
    invariant(work.openSegment === null, 'An unobserved incident cannot have an open segment.');
    closedIncident = { ...closedIncident, resourceVersion: closedIncident.resourceVersion + 1n };
  }
  work.incidentEffects.push({
    closedAtMs: atMs,
    closedIncident,
    kind: 'CLOSE_INCIDENT',
    segmentId,
  });
  work.eventFacts.push({
    incidentId: incident.id,
    kind: 'INCIDENT_CLOSED',
    transitionedAtMs: atMs,
  });
  work.incident = null;
  work.openSegment = null;
  work.current.openIncidentId = null;
}

function applyAcceptedObservation(
  work: WorkingTransition,
  input: ObservationTransitionInput,
  intervalAllocationIndex: number,
): void {
  const observation = input.observation;
  const atMs = observation.run.finishedAtMs;
  const previousHealth = work.current.healthState;
  const previousFreshness = work.current.freshnessState;
  const candidateBefore = cloneCandidate(work.current.candidate);
  const intervalId = nextIntervalId(input, intervalAllocationIndex);

  if (work.incident !== null) {
    if (observation.outcome === 'FAIL') {
      work.current.healthState = 'DOWN';
      work.current.consecutiveFailureCount = FAILURE_THRESHOLD_V1;
      work.current.candidate = null;
      if (work.incident.observationMode === 'UNOBSERVED') {
        resumeIncident(work, input);
      } else {
        work.incident = {
          ...work.incident,
          lastFailureCategory: observation.failureCategory,
          resourceVersion: work.incident.resourceVersion + 1n,
        };
        work.incidentEffects.push({
          incident: { ...work.incident },
          kind: 'UPDATE_INCIDENT_FAILURE',
        });
      }
      rotateInterval(
        work,
        'DOWN',
        atMs,
        work.openInterval.classification === 'PROVISIONAL'
          ? 'DOWN'
          : work.openInterval.classification,
        intervalId,
        input.check.probeGeneration,
        'RUN',
        observation.run,
      );
    } else {
      work.current.healthState = 'UP';
      work.current.consecutiveFailureCount = 0;
      work.current.candidate = null;
      closeIncident(work, atMs);
      rotateInterval(
        work,
        'UP',
        atMs,
        work.openInterval.classification === 'PROVISIONAL'
          ? 'UP'
          : work.openInterval.classification,
        intervalId,
        input.check.probeGeneration,
        'RUN',
        observation.run,
      );
    }
  } else if (
    previousFreshness === 'FRESH' &&
    work.current.healthState === 'SUSPECT' &&
    candidateBefore !== null
  ) {
    if (observation.outcome === 'FAIL') {
      work.current.healthState = 'DOWN';
      work.current.consecutiveFailureCount = FAILURE_THRESHOLD_V1;
      work.current.candidate = null;
      openIncident(work, input, candidateBefore);
      rotateInterval(
        work,
        'DOWN',
        atMs,
        'DOWN',
        intervalId,
        input.check.probeGeneration,
        'RUN',
        observation.run,
      );
    } else {
      work.current.healthState = 'UP';
      work.current.consecutiveFailureCount = 0;
      work.current.candidate = null;
      rotateInterval(
        work,
        'UP',
        atMs,
        'UP',
        intervalId,
        input.check.probeGeneration,
        'RUN',
        observation.run,
      );
    }
  } else if (observation.outcome === 'FAIL') {
    work.current.healthState = 'SUSPECT';
    work.current.consecutiveFailureCount = 1;
    work.current.candidate = { run: cloneRun(observation.run), startedAtMs: atMs };
    rotateInterval(
      work,
      'PROVISIONAL',
      atMs,
      work.openInterval.classification === 'PROVISIONAL'
        ? 'UNKNOWN'
        : work.openInterval.classification,
      intervalId,
      input.check.probeGeneration,
      'RUN',
      observation.run,
    );
  } else {
    work.current.healthState = 'UP';
    work.current.consecutiveFailureCount = 0;
    work.current.candidate = null;
    rotateInterval(
      work,
      'UP',
      atMs,
      work.openInterval.classification === 'PROVISIONAL' ? 'UP' : work.openInterval.classification,
      intervalId,
      input.check.probeGeneration,
      'RUN',
      observation.run,
    );
  }

  const freshnessWindowMs =
    input.check.intervalSeconds * 1_000 +
    input.check.timeoutMs +
    (input.schedulerGraceMs ?? DEFAULT_SCHEDULER_GRACE_MS);
  work.current = {
    ...work.current,
    freshUntilMs: safeAddMs(atMs, freshnessWindowMs),
    freshnessState: 'FRESH',
    lastAcceptedFencingToken: observation.fencingToken,
    lastAcceptedRun: cloneRun(observation.run),
    lastFailureAtMs: observation.outcome === 'FAIL' ? atMs : work.current.lastFailureAtMs,
    lastFailureCategory:
      observation.outcome === 'FAIL'
        ? observation.failureCategory
        : work.current.lastFailureCategory,
    lastResponseTimeMs: observation.totalMs,
    lastStatusCode: observation.statusCode,
    lastSuccessAtMs: observation.outcome === 'PASS' ? atMs : work.current.lastSuccessAtMs,
    staleReconciledAtMs: null,
    stateVersion: work.current.stateVersion + 1n,
  };
  if (previousFreshness !== 'FRESH') {
    work.eventFacts.push({
      from: previousFreshness,
      kind: 'FRESHNESS_CHANGED',
      to: 'FRESH',
      transitionedAtMs: atMs,
    });
  }
  if (previousHealth !== work.current.healthState) {
    work.eventFacts.push({
      from: previousHealth,
      kind: 'HEALTH_CHANGED',
      to: work.current.healthState,
      transitionedAtMs: atMs,
    });
  }
  work.eventFacts.push({
    kind: 'OBSERVATION_ACCEPTED',
    outcome: observation.outcome,
    run: cloneRun(observation.run),
  });
}

export function planObservationTransition(
  input: ObservationTransitionInput,
): ObservationTransition {
  const acceptance = decideObservationAcceptance(input.check, input.current, input.observation);
  if (!acceptance.accepted) {
    return {
      acceptance,
      eventFacts:
        acceptance.reason === 'DUPLICATE_RUN'
          ? []
          : [
              {
                kind: 'OBSERVATION_REJECTED',
                reason: acceptance.reason,
                run: cloneRun(input.observation.run),
              },
            ],
    };
  }

  validateObservation(input);
  validateSnapshots(input.current, input.incident, input.openSegment, input.openInterval);
  const work: WorkingTransition = {
    current: cloneCurrent(input.current),
    eventFacts: [],
    incident: cloneIncident(input.incident),
    incidentEffects: [],
    intervalEffects: [],
    openInterval: cloneInterval(input.openInterval),
    openSegment: cloneSegment(input.openSegment),
  };

  let intervalAllocationIndex = 0;
  if (
    work.current.freshnessState === 'FRESH' &&
    work.current.freshUntilMs !== null &&
    input.observation.run.finishedAtMs >= work.current.freshUntilMs
  ) {
    reconcileFreshnessInPlace(
      work,
      work.current.freshUntilMs,
      nextIntervalId(input, intervalAllocationIndex),
    );
    intervalAllocationIndex += 1;
  }
  applyAcceptedObservation(work, input, intervalAllocationIndex);
  validateSnapshots(work.current, work.incident, work.openSegment, work.openInterval);
  return {
    acceptance: { accepted: true },
    affectedGroupId: input.check.groupId,
    current: work.current,
    eventFacts: work.eventFacts,
    incident: work.incident,
    incidentEffects: work.incidentEffects,
    intervalEffects: work.intervalEffects,
    openInterval: work.openInterval,
    openSegment: work.openSegment,
  };
}

export function deriveEffectiveCheckStatus(input: EffectiveCheckStatusInput): EffectiveCheckStatus {
  assertInstant(input.queryTimeMs, 'queryTimeMs');
  const stale =
    input.executionState === 'PAUSED' ||
    input.persistedFreshnessState === 'STALE' ||
    input.freshUntilMs === null ||
    input.freshUntilMs <= input.queryTimeMs;
  return stale
    ? { freshnessState: 'STALE', healthState: 'UNKNOWN' }
    : { freshnessState: 'FRESH', healthState: input.healthState };
}

export function deriveEffectiveIncidentProjection(
  input: EffectiveIncidentProjectionInput,
): EffectiveIncidentProjection | null {
  assertInstant(input.queryTimeMs, 'queryTimeMs');
  if (input.incident === null) {
    invariant(input.openSegment === null, 'An open segment requires an incident.');
    return null;
  }
  invariant(
    (input.incident.observationMode === 'OBSERVED') === (input.openSegment !== null),
    'Incident observation mode and open segment disagree.',
  );
  let observedDurationMs = input.incident.observedDurationMs;
  let observationMode = input.incident.observationMode;
  if (input.openSegment !== null) {
    const effectiveEndMs =
      input.freshUntilMs === null
        ? input.openSegment.startedAtMs
        : Math.min(input.queryTimeMs, input.freshUntilMs);
    observedDurationMs += durationMs(input.openSegment.startedAtMs, effectiveEndMs);
    if (input.freshUntilMs === null || input.freshUntilMs <= input.queryTimeMs) {
      observationMode = 'UNOBSERVED';
    }
  }
  return { incidentId: input.incident.id, observationMode, observedDurationMs };
}

export function deriveGroupStatus(
  members: readonly GroupStatusMember[],
  queryTimeMs: number,
): GroupStatusSummary {
  assertInstant(queryTimeMs, 'queryTimeMs');
  const summary: GroupStatusSummary = {
    active: 0,
    down: 0,
    healthState: 'UNKNOWN',
    paused: 0,
    suspect: 0,
    unknown: 0,
    up: 0,
  };
  for (const member of members) {
    if (member.lifecycleState === 'DELETED') continue;
    if (member.executionState === 'PAUSED') {
      summary.paused += 1;
      continue;
    }
    summary.active += 1;
    const status = deriveEffectiveCheckStatus({
      executionState: member.executionState,
      freshUntilMs: member.freshUntilMs,
      healthState: member.healthState,
      persistedFreshnessState: member.persistedFreshnessState,
      queryTimeMs,
    });
    switch (status.healthState) {
      case 'DOWN':
        summary.down += 1;
        break;
      case 'SUSPECT':
        summary.suspect += 1;
        break;
      case 'UP':
        summary.up += 1;
        break;
      case 'UNKNOWN':
        summary.unknown += 1;
        break;
    }
  }
  summary.healthState =
    summary.down > 0
      ? 'DOWN'
      : summary.suspect > 0
        ? 'SUSPECT'
        : summary.unknown > 0 || summary.active === 0
          ? 'UNKNOWN'
          : 'UP';
  return summary;
}
