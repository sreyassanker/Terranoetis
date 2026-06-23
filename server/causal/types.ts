export interface CausalNode {
  nodeId: string;
  name: string;
  type: 'seismic' | 'port' | 'weather' | 'vessel' | 'flight' | 'economic' | 'political';
  lat?: number;
  lon?: number;
  properties: Record<string, unknown>;
  embedding?: number[];
  createdAt: number;
}

export interface CausalEdge {
  edgeId: string;
  sourceId: string;
  targetId: string;
  relation: 'CAUSES' | 'INFLUENCES' | 'CORRELATES_WITH' | 'PRECEDES' | 'BLOCKS';
  correlation: number;
  causalStrength: number;
  timeLagHours: number;
  confidence: number;
  evidenceCount: number;
  lastUpdated: number;
  isSynthetic: boolean;
}

export interface Discovery {
  discoveryId: string;
  edge: CausalEdge;
  summary: string;
  discoveredAt: number;
  validatedBy: string | null;
  validationStatus: 'pending' | 'validated' | 'rejected';
  forkId?: string;
}

export interface EntropyReading {
  timestamp: number;
  domainScores: Record<string, number>;
  planetaryEntropy: number;
  interpretation: 'baseline' | 'restless' | 'critical' | 'catastrophic';
}
