export interface SyntheticEvent {
  eventId: string;
  type: 'earthquake' | 'hurricane' | 'port_strike' | 'cyber_attack' | 'tsunami' | 'volcanic_eruption';
  region: { lat: number; lon: number; radiusKm: number };
  magnitude: number;
  parameters: Record<string, unknown>;
  isReal: boolean;
  createdAt: number;
}

export interface SyntheticScenario {
  scenarioId: string;
  name: string;
  events: SyntheticEvent[];
  forkId: string | null;
  predictedOutcome: string;
  actualOutcome: string | null;
  predictionAccuracy: number | null;
  evaluatedAt: number | null;
  lessonsLearned: string[];
}

export interface DreamLog {
  dreamId: string;
  startedAt: number;
  completedAt: number | null;
  scenariosRun: number;
  scenarios: SyntheticScenario[];
  modelUpdates: Array<{
    modelType: string;
    oldAccuracy: number;
    newAccuracy: number;
    reason: string;
  }>;
  newCausalEdges: Array<{
    source: string;
    target: string;
    strength: number;
    discoveredInScenario: string;
  }>;
}
