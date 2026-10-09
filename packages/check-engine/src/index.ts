import type { Clock } from '@site-monitor/domain';

export interface ProbeEngineDependencies {
  clock: Clock;
}

export type ProbeEngineFactory = (dependencies: ProbeEngineDependencies) => unknown;
