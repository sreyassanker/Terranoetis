import { generateScenario } from '../../scenarios/scenarioGenerator';
import type { ScenarioType } from '../../scenarios/templates';
import { type PointCloud } from '../../earthgen/flowMatching';
import { logger } from '../../observability/logger';

export interface ScenarioStats {
  numScenarios: number;
  probabilityDistribution: Array<{ bin: string; count: number }>;
  mostLikely: ScenarioOutcome;
  worstCase: ScenarioOutcome;
  bestCase: ScenarioOutcome;
  meanPoints: number;
  stdPoints: number;
}

export interface ScenarioOutcome {
  probability: number;
  severity: 'low' | 'medium' | 'high' | 'extreme';
  description: string;
  sampleCloud: PointCloud;
}

const SCENARIO_DESCRIPTIONS: Record<string, string> = {
  earthquake_swarm: 'Earthquake swarm with aftershocks',
  hurricane_landfall: 'Hurricane making landfall',
  wildfire_spread: 'Wildfire spreading with wind',
  volcanic_eruption: 'Volcanic eruption with ash plume',
  flood_inundation: 'Flood inundation from heavy rainfall',
  tsunami_wave: 'Tsunami wave propagation',
};

export class ScenarioPredictor {
  async predict(type: string, params: Record<string, unknown>, numRuns = 100): Promise<ScenarioStats> {
    const scenarioType = type as unknown as ScenarioType;
    const clouds: PointCloud[] = [];
    const probabilities: number[] = [];
    const severityScores: number[] = [];

    for (let i = 0; i < numRuns; i++) {
      try {
        const scenario = await generateScenario(scenarioType, params);
        clouds.push(scenario.pointCloud);
        probabilities.push(scenario.validationScore);
        severityScores.push(scenario.validationScore);
      } catch (e) {
        logger.warn({ run: i, err: e }, 'Scenario prediction run failed');
      }
    }

    const n = clouds.length;
    if (n === 0) {
      return {
        numScenarios: 0,
        probabilityDistribution: [],
        mostLikely: { probability: 0, severity: 'low', description: 'No scenarios generated', sampleCloud: [] },
        worstCase: { probability: 0, severity: 'low', description: 'No scenarios generated', sampleCloud: [] },
        bestCase: { probability: 0, severity: 'low', description: 'No scenarios generated', sampleCloud: [] },
        meanPoints: 0,
        stdPoints: 0,
      };
    }

    const sortedByProb = clouds.map((cloud, i) => ({
      probability: probabilities[i],
      severity: severityScores[i],
      cloud,
    })).sort((a, b) => a.probability - b.probability);

    const meanPoints = clouds.reduce((s, c) => s + c.length, 0) / n;
    const variance = clouds.reduce((s, c) => s + (c.length - meanPoints) ** 2, 0) / n;
    const stdPoints = Math.sqrt(variance);

    const bins = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    const distribution = bins.slice(0, -1).map((bin, i) => ({
      bin: `${bin.toFixed(1)}-${bins[i + 1].toFixed(1)}`,
      count: probabilities.filter(p => p >= bin && p < bins[i + 1]).length,
    }));

    function severityLabel(score: number): 'low' | 'medium' | 'high' | 'extreme' {
      if (score > 0.8) return 'extreme';
      if (score > 0.6) return 'high';
      if (score > 0.4) return 'medium';
      return 'low';
    }

    const mostLikely = sortedByProb[sortedByProb.length - 1];
    const worstCase = sortedByProb[0];

    return {
      numScenarios: n,
      probabilityDistribution: distribution,
      mostLikely: {
        probability: mostLikely.probability,
        severity: severityLabel(mostLikely.severity),
        description: SCENARIO_DESCRIPTIONS[scenarioType] || `${scenarioType} scenario`,
        sampleCloud: mostLikely.cloud,
      },
      worstCase: {
        probability: worstCase.probability,
        severity: severityLabel(worstCase.severity),
        description: `Worst-case ${SCENARIO_DESCRIPTIONS[scenarioType] || scenarioType}`,
        sampleCloud: worstCase.cloud,
      },
      bestCase: {
        probability: sortedByProb[sortedByProb.length - 1].probability,
        severity: severityLabel(sortedByProb[sortedByProb.length - 1].severity),
        description: `Best-case ${SCENARIO_DESCRIPTIONS[scenarioType] || scenarioType}`,
        sampleCloud: sortedByProb[sortedByProb.length - 1].cloud,
      },
      meanPoints,
      stdPoints,
    };
  }
}

export const scenarioPredictor = new ScenarioPredictor();
