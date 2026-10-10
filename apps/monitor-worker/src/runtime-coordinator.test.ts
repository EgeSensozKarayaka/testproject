import { describe, expect, it, vi } from 'vitest';

import {
  MonitorRuntimeCoordinator,
  type RuntimeCoordinatorLogger,
  type RuntimeDispatcherPort,
  type RuntimeFreshnessPort,
  type RuntimeQueuePort,
} from './runtime-coordinator.js';

const config = {
  candidateBatchSize: 8,
  dispatchPollMs: 20,
  freshnessPollMs: 40,
  recoveryPollMs: 30,
  scheduleBatchSize: 4,
  schedulerPollMs: 50,
  shutdownGraceMs: 100,
};

function blockingSleep(calls: number[]) {
  return (milliseconds: number, signal: AbortSignal) => {
    calls.push(milliseconds);
    return new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', () => resolve(), { once: true });
    });
  };
}

function ports() {
  const materializeDueBatch = vi.fn().mockResolvedValue([]);
  const recoverExpiredBatch = vi.fn().mockResolvedValue([]);
  const queue: RuntimeQueuePort = {
    materializeDueBatch,
    recoverExpiredBatch,
  };
  const abortActive = vi.fn();
  const awaitIdle = vi.fn().mockResolvedValue(undefined);
  const dispatchOnce = vi.fn().mockResolvedValue({
    active: 0,
    claimed: 0,
    failed: 0,
    saturated: 0,
    scanned: 0,
    skipped: 0,
  });
  const stopAccepting = vi.fn();
  const dispatcher: RuntimeDispatcherPort = {
    abortActive,
    awaitIdle,
    dispatchOnce,
    stopAccepting,
  };
  const listFreshnessCandidates = vi.fn().mockResolvedValue([]);
  const reconcileFreshness = vi.fn().mockResolvedValue({ outcome: 'STALE' });
  const freshness: RuntimeFreshnessPort = {
    listFreshnessCandidates,
    reconcileFreshness,
  };
  const error = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  const logger: RuntimeCoordinatorLogger = {
    error,
    info,
    warn,
  };
  return {
    dispatcher,
    freshness,
    logger,
    mocks: {
      abortActive,
      awaitIdle,
      dispatchOnce,
      error,
      info,
      listFreshnessCandidates,
      materializeDueBatch,
      recoverExpiredBatch,
      stopAccepting,
      warn,
    },
    queue,
  };
}

describe('monitor runtime coordinator', () => {
  it('starts every independent loop once and drains without overlapping timers', async () => {
    const input = ports();
    const sleepCalls: number[] = [];
    const coordinator = new MonitorRuntimeCoordinator({
      ...input,
      config,
      sleep: blockingSleep(sleepCalls),
    });

    coordinator.start();
    await vi.waitFor(() => {
      expect(input.mocks.materializeDueBatch).toHaveBeenCalledOnce();
      expect(input.mocks.dispatchOnce).toHaveBeenCalledOnce();
      expect(input.mocks.recoverExpiredBatch).toHaveBeenCalledOnce();
      expect(input.mocks.listFreshnessCandidates).toHaveBeenCalledOnce();
    });
    await vi.waitFor(() => expect(coordinator.ready).toBe(true));
    await vi.waitFor(() => expect(sleepCalls).toHaveLength(4));
    expect(new Set(sleepCalls)).toEqual(new Set([20, 30, 40, 50]));

    await expect(coordinator.drain()).resolves.toEqual({ aborted: false, drained: true });
    expect(input.mocks.stopAccepting).toHaveBeenCalledOnce();
    expect(input.mocks.abortActive).not.toHaveBeenCalled();
    expect(coordinator.ready).toBe(false);
    expect(coordinator.state).toBe('STOPPED');
  });

  it('isolates a loop failure and retries it after the configured poll boundary', async () => {
    const input = ports();
    const schedulerSleepResolvers: Array<() => void> = [];
    input.mocks.materializeDueBatch
      .mockRejectedValueOnce(
        Object.assign(new Error('sensitive database detail'), { code: '57P01' }),
      )
      .mockRejectedValueOnce(new Error('another sensitive database detail'))
      .mockResolvedValue([]);
    const coordinator = new MonitorRuntimeCoordinator({
      ...input,
      config,
      sleep: (milliseconds, signal) =>
        new Promise<void>((resolve) => {
          if (milliseconds === config.schedulerPollMs) {
            schedulerSleepResolvers.push(resolve);
          }
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        }),
    });

    coordinator.start();
    await vi.waitFor(() => expect(schedulerSleepResolvers).toHaveLength(1));
    expect(coordinator.ready).toBe(false);
    schedulerSleepResolvers.shift()!();
    await vi.waitFor(() => expect(input.mocks.materializeDueBatch).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(schedulerSleepResolvers).toHaveLength(1));
    expect(input.mocks.error).toHaveBeenCalledWith(
      { error_code: '57P01', loop: 'scheduler' },
      'monitor runtime loop iteration failed',
    );
    expect(input.mocks.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(input.mocks.error.mock.calls)).not.toContain('sensitive database detail');
    schedulerSleepResolvers.shift()!();
    await vi.waitFor(() => expect(input.mocks.materializeDueBatch).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(coordinator.ready).toBe(true));
    expect(input.mocks.info).toHaveBeenCalledWith(
      { loop: 'scheduler' },
      'monitor runtime loop recovered',
    );
    await coordinator.drain();
  });

  it('aborts active probes only after the graceful drain deadline', async () => {
    const input = ports();
    let releaseIdle: (() => void) | undefined;
    input.mocks.awaitIdle.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseIdle = resolve;
        }),
    );
    input.mocks.abortActive.mockImplementation(() => releaseIdle?.());
    const coordinator = new MonitorRuntimeCoordinator({
      ...input,
      config,
      sleep: blockingSleep([]),
    });

    coordinator.start();
    await vi.waitFor(() => expect(input.mocks.dispatchOnce).toHaveBeenCalledOnce());
    await expect(coordinator.drain(10)).resolves.toEqual({ aborted: true, drained: true });
    expect(input.mocks.stopAccepting).toHaveBeenCalledOnce();
    expect(input.mocks.abortActive).toHaveBeenCalledOnce();
  });

  it('bounds shutdown even when a poll iteration never settles', async () => {
    const input = ports();
    input.mocks.materializeDueBatch.mockImplementation(() => new Promise(() => undefined));
    const coordinator = new MonitorRuntimeCoordinator({
      ...input,
      config,
      sleep: blockingSleep([]),
    });

    coordinator.start();
    await vi.waitFor(() => expect(input.mocks.materializeDueBatch).toHaveBeenCalledOnce());
    await expect(coordinator.drain(10)).resolves.toEqual({ aborted: false, drained: false });
    expect(input.mocks.error).not.toHaveBeenCalled();
    expect(input.mocks.warn).toHaveBeenCalledWith(
      { grace_ms: 10 },
      'monitor poll loops exceeded drain grace',
    );
  });
});
