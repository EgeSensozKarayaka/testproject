export type EntityId = string;

export * from './checks.js';
export * from './groups.js';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
