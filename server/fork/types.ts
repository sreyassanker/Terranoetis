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
}

export interface ForkDelta {
  type: 'CLOSE_PORT' | 'BLOCK_ROUTE' | 'INJECT_EVENT' | 'MODIFY_PARAM';
  targetId: string;
  parameters: Record<string, any>;
  effectiveTimeOffsetHours: number;
}

export interface ForkState {
  forkId: string;
  entities: Record<string, any>;
  events: any[];
  lastTick: number;
}

export interface ForkCreateRequest {
  name: string;
  lat: number;
  lon: number;
  altitudeKm?: number;
  deltas: ForkDelta[];
  maxSimulationHours?: number;
}

export interface ForkStreamMessage {
  type: 'FORK_INIT' | 'FORK_TICK' | 'FORK_EVENT' | 'FORK_DIVERGENCE' | 'FORK_TERMINATED';
  forkId: string;
  timestamp: number;
  payload: any;
}
