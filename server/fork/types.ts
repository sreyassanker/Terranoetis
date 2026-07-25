export interface ForkDefinition {
  forkId: string;
  name: string;
  createdAt: number;
  createdBy: string;
  baselineSnapshot: string;
  deltas: ForkDelta[];
  status: 'running' | 'paused' | 'terminated';
  divergenceScore: number;
  simulatedTimeMs: number;
  maxSimulationHours: number;
  bufferRadiusM: number;
}

export interface ForkDelta {
  type: 'CLOSE_PORT' | 'BLOCK_ROUTE' | 'INJECT_EVENT' | 'MODIFY_PARAM';
  targetId: string;
  parameters: Record<string, unknown>;
  effectiveTimeOffsetHours: number;
}

export interface ForkState {
  forkId: string;
  entities: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
  lastTick: number;
}

export interface ForkCreateRequest {
  name: string;
  lat: number;
  lon: number;
  altitudeKm?: number;
  deltas: ForkDelta[];
  maxSimulationHours?: number;
  bufferRadiusM?: number;
}

export interface ForkStreamMessage {
  type: 'FORK_INIT' | 'FORK_TICK' | 'FORK_EVENT' | 'FORK_DIVERGENCE' | 'FORK_TERMINATED';
  forkId: string;
  timestamp: number;
  payload: unknown;
}
