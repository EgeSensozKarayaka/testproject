export type EntityId = string;

export * from './checks.js';
export * from './groups.js';
export * from './history.js';
export * from './maintenance.js';
export * from './monitoring-state.js';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
