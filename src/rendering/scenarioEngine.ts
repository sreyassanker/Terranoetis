/**
 * Scenario Engine — What-If Simulation via Causal Network Rollout
 *
 * Implements forward-rollout scenario analysis using the Noisy-OR CBN:
 * 1. Start with base evidence from tool execution
 * 2. Inject scenario-specific perturbations
 * 3. Propagate through causal graph via topological-order belief propagation
 * 4. Compute cascading risk deltas
 *
 * Based on:
 *   Caselton & Zidek (2004) - Spatial Bayesian networks for environmental assessment
 *   Panel on causal BNs - Pearl (1988) Probabilistic Reasoning in Intelligent Systems
 */

import {
  computeCausalProbabilities,
  computeFullCausalState,
  getAllNodes,
  type CausalState,
} from './causalGraph';

/* ═════════════════════════════════════════════════════════════════
   TYPES
   ═════════════════════════════════════════════════════════════════ */

export interface Scenario {
  id: string;
  name: string;
  description: string;
  evidence: Record<string, number>;
  /** Physical parameters for the scenario (used by physics surrogates) */
  physicalParams?: Record<string, number>;
}

export interface ScenarioDiff {
  toolId: string;
  baseProb: number;
  scenarioProb: number;
  delta: number;
  /** Entropy change — information gained/lost */
  entropyDelta: number;
  /** Confidence in this delta estimate */
  confidence: number;
  /** Human-readable label */
  label: string;
}

export interface ScenarioResult {
  diffs: ScenarioDiff[];
  scenario: Scenario;
  /** Full causal state after scenario rollout */
  causalState: CausalState;
  /** Total risk increase across all nodes */
  totalRiskDelta: number;
  /** Maximum single-node risk change */
  maxNodeDelta: number;
  /** Number of nodes with >5% risk change */
  significantChanges: number;
}

/* ═════════════════════════════════════════════════════════════════
   DEFAULT SCENARIOS — Physically-grounded disaster scenarios
   ═════════════════════════════════════════════════════════════════ */

const DEFAULT_SCENARIOS: Scenario[] = [
  {
    id: 'big_quake',
    name: 'Major Earthquake (M6+)',
    description: 'A magnitude 6+ earthquake strikes the study area. Expect secondary hazards: liquefaction, tsunami risk, structural damage, and aftershock sequences.',
    evidence: {
      earthquakes: 0.95,
      seismic_events: 0.85,
    },
    physicalParams: {
      magnitude: 6.5,
      depth_km: 15,
      pga_gal: 400,
      rupture_length_km: 30,
    },
  },
  {
    id: 'severe_storm',
    name: 'Category 3+ Hurricane',
    description: 'A major tropical cyclone (Cat 3+) approaches. Storm surge, extreme winds, and inland flooding expected.',
    evidence: {
      storms: 0.90,
      weather_forecast: 0.85,
    },
    physicalParams: {
      category: 3,
      wind_speed_ms: 50,
      central_pressure_hpa: 960,
      storm_surge_m: 3,
    },
  },
  {
    id: 'wildfire_outbreak',
    name: 'Wildfire Outbreak',
    description: 'Multiple wildfires ignite simultaneously under extreme fire weather. High wind, low humidity, and dry fuel conditions.',
    evidence: {
      wildfires: 0.95,
      firms_fires: 0.90,
    },
    physicalParams: {
      fire_count: 8,
      wind_speed_ms: 15,
      relative_humidity_pct: 15,
      fuel_moisture_pct: 5,
    },
  },
  {
    id: 'compound_disaster',
    name: 'Compound Disaster',
    description: 'Earthquake triggers flooding (dam failure) and fires (gas line rupture). Cascading multi-hazard event.',
    evidence: {
      earthquakes: 0.90,
      storms: 0.60,
      wildfires: 0.75,
      floods: 0.80,
    },
    physicalParams: {
      magnitude: 6.0,
      dam_breach: 1,
      gas_line_rupture: 1,
    },
  },
];

/* ═════════════════════════════════════════════════════════════════
   PUBLIC API
   ═════════════════════════════════════════════════════════════════ */

export function getDefaultScenarios(): Scenario[] {
  return DEFAULT_SCENARIOS;
}

/**
 * Rollout a scenario: merge scenario evidence with base evidence,
 * propagate through causal network, compute deltas.
 */
export function rolloutScenario(
  scenario: Scenario,
  baseEvidence: Record<string, number>,
  location?: { lat: number; lon: number },
): ScenarioDiff[] {
  // Merge: take max of base and scenario evidence for each node
  const mergedEvidence: Record<string, number> = { ...baseEvidence };
  for (const [key, value] of Object.entries(scenario.evidence)) {
    const existing = mergedEvidence[key] ?? 0;
    mergedEvidence[key] = Math.max(existing, value);
  }

  // Compute base and scenario probabilities
  const baseProbs = computeCausalProbabilities(baseEvidence, true, location);
  const scenarioProbs = computeCausalProbabilities(mergedEvidence, true, location);

  // Compute base and scenario entropy for information-theoretic deltas
  const baseState = computeFullCausalState(baseEvidence, location);
  const scenarioState = computeFullCausalState(mergedEvidence, location);

  const allToolIds = new Set([
    ...Object.keys(baseProbs),
    ...Object.keys(scenarioProbs),
  ]);

  const nodeMap = new Map(getAllNodes().map(n => [n.toolId, n]));

  const diffs: ScenarioDiff[] = [];
  for (const toolId of allToolIds) {
    const baseProb = baseProbs[toolId] ?? 0;
    const scenarioProb = scenarioProbs[toolId] ?? 0;
    const delta = scenarioProb - baseProb;
    const entropyDelta = (baseState.beliefs[toolId]?.entropy ?? 0)
      - (scenarioState.beliefs[toolId]?.entropy ?? 0);

    if (Math.abs(delta) > 0.005) { // Lower threshold for sensitivity
      diffs.push({
        toolId,
        baseProb,
        scenarioProb,
        delta,
        entropyDelta,
        confidence: scenarioState.beliefs[toolId]?.confidence ?? 0.5,
        label: nodeMap.get(toolId)?.label ?? toolId,
      });
    }
  }

  // Sort by absolute delta (largest impact first)
  diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return diffs;
}

/**
 * Full scenario analysis with complete causal state.
 */

/**
 * Convenience wrapper: get scenario impact with scenario lookup.
 */
