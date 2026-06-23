import { causalGraph } from './causalGraph';
import { tsunamiProbability, aftershockProbability, fireIgnitionProbability, rothermelSpreadRate } from './physicsNN';
import { logger } from '../observability/logger';

// ── Types ───────────────────────────────────────────────────────

export interface ScenarioVariable {
  name: string;
  currentValue: number | string;
  newValue: number | string;
  unit: string;
}

export interface ScenarioEffect {
  affectedVariable: string;
  directEffect: string;
  cascadeEffects: string[];
  probability: number;
}

export interface ScenarioResult {
  name: string;
  description: string;
  variables: ScenarioVariable[];
  effects: ScenarioEffect[];
  overallRisk: 'negligible' | 'low' | 'moderate' | 'high' | 'extreme';
  confidence: number;
  chainResponse: Array<{ step: number; event: string; probability: number; description: string }>;
}

// ── Scenario templates ──────────────────────────────────────────

const SCENARIO_TEMPLATES: Record<string, (vars: Record<string, number>) => ScenarioResult> = {
  earthquake_magnitude_change: (vars) => {
    const originalMag = vars.originalMag || 6.0;
    const newMag = vars.newMag || 8.0;
    const depth = vars.depth || 10;

    // Energy increase: 10^1.5*(M2-M1)
    const energyRatio = Math.pow(10, 1.5 * (newMag - originalMag));
    const tsunamiProb = tsunamiProbability(newMag, depth, true);
    const afterProb = aftershockProbability(newMag, 4.0, 7);

    const chain = [
      { step: 1, event: 'earthquake', probability: 0.95, description: `M${newMag} earthquake at ${depth}km depth` },
      { step: 2, event: 'ground_shaking', probability: 0.9, description: `${(energyRatio * 0.1).toFixed(1)}x stronger shaking than M${originalMag}` },
    ];

    if (tsunamiProb > 0.1) {
      chain.push({ step: 3, event: 'tsunami', probability: tsunamiProb, description: `${(tsunamiProb * 100).toFixed(0)}% tsunami probability` });
    }
    if (afterProb > 0.3) {
      chain.push({ step: 4, event: 'aftershocks', probability: afterProb, description: `${(afterProb * 100).toFixed(0)}% chance of M4+ aftershocks within 7 days` });
    }

    return {
      name: 'Earthquake Magnitude Change',
      description: `What if the earthquake had been M${newMag} instead of M${originalMag}?`,
      variables: [
        { name: 'Magnitude', currentValue: originalMag, newValue: newMag, unit: 'Mw' },
        { name: 'Energy Ratio', currentValue: 1, newValue: energyRatio, unit: 'x' },
      ],
      effects: [
        {
          affectedVariable: 'Seismic Energy Release',
          directEffect: `${energyRatio.toFixed(1)}x more energy released`,
          cascadeEffects: ['Stronger ground acceleration', 'Wider area of damage', 'Higher chance of liquefaction'],
          probability: 0.9,
        },
        {
          affectedVariable: 'Tsunami Risk',
          directEffect: `${(tsunamiProb * 100).toFixed(0)}% tsunami probability`,
          cascadeEffects: ['Coastal inundation', 'Port disruption', 'Evacuation orders'],
          probability: tsunamiProb,
        },
      ],
      overallRisk: newMag >= 7.5 ? 'extreme' : newMag >= 6.5 ? 'high' : 'moderate',
      confidence: 0.6,
      chainResponse: chain,
    };
  },

  tsunami_trigger: (vars) => {
    const mag = vars.magnitude || 7.5;
    const depth = vars.depth || 10;

    const chain = [
      { step: 1, event: 'submarine_landslide_or_rupture', probability: 0.7, description: `M${mag} triggers seafloor displacement` },
      { step: 2, event: 'wave_generation', probability: 0.65, description: 'Tsunami wave forms with initial height proportional to displacement' },
      { step: 3, event: 'coastal_impact', probability: 0.5, description: 'Wave reaches coast within 30-60 minutes' },
      { step: 4, event: 'inundation', probability: 0.35, description: 'Coastal areas flooded up to 500m inland depending on topography' },
    ];

    return {
      name: 'Tsunami Cascade',
      description: `What if the M${mag} earthquake triggers a tsunami?`,
      variables: [
        { name: 'Earthquake Magnitude', currentValue: mag, newValue: mag, unit: 'Mw' },
        { name: 'Depth', currentValue: depth, newValue: depth, unit: 'km' },
      ],
      effects: [
        {
          affectedVariable: 'Wave Height',
          directEffect: `${(0.5 + mag * 0.3).toFixed(1)}m estimated runup height`,
          cascadeEffects: ['Coastal flooding', 'Beach erosion', 'Harbor damage'],
          probability: 0.5,
        },
      ],
      overallRisk: mag >= 7 ? 'high' : 'moderate',
      confidence: 0.45,
      chainResponse: chain,
    };
  },

  wildfire_conditions: (vars) => {
    const tempC = vars.temperature || 30;
    const humidity = vars.humidity || 25;
    const windMs = vars.windSpeed || 15;
    const droughtIndex = vars.droughtIndex || 400;

    const ignitionProb = fireIgnitionProbability(tempC, humidity, windMs, droughtIndex);
    const spreadRate = rothermelSpreadRate(windMs, 5, 5, 1.5);

    return {
      name: 'Wildfire Conditions',
      description: `What if temperature rises to ${tempC}°C with ${humidity}% humidity and ${windMs}m/s winds?`,
      variables: [
        { name: 'Temperature', currentValue: 25, newValue: tempC, unit: '°C' },
        { name: 'Humidity', currentValue: 40, newValue: humidity, unit: '%' },
        { name: 'Wind Speed', currentValue: 10, newValue: windMs, unit: 'm/s' },
      ],
      effects: [
        {
          affectedVariable: 'Ignition Probability',
          directEffect: `${(ignitionProb * 100).toFixed(0)}% ignition risk`,
          cascadeEffects: ['Rapid fire growth', 'Spotting ahead of main front', 'Fire-generated thunderstorms'],
          probability: ignitionProb,
        },
        {
          affectedVariable: 'Fire Spread Rate',
          directEffect: `${spreadRate.toFixed(1)} m/min spread rate`,
          cascadeEffects: ['Difficult to contain', 'Rapid area growth', 'Extended burning period'],
          probability: Math.min(1, spreadRate / 30),
        },
      ],
      overallRisk: ignitionProb > 0.5 ? 'high' : ignitionProb > 0.3 ? 'moderate' : 'low',
      confidence: 0.55,
      chainResponse: [
        { step: 1, event: 'fire_ignition', probability: ignitionProb, description: `${(ignitionProb * 100).toFixed(0)}% chance of ignition` },
        { step: 2, event: 'fire_spread', probability: Math.min(1, spreadRate / 15), description: `Fire spreads at ${spreadRate.toFixed(1)} m/min` },
        { step: 3, event: 'atmospheric_coupling', probability: 0.3, description: 'Possible pyrocumulonimbus cloud formation' },
      ],
    };
  },
};

// ── ScenarioSimulator ───────────────────────────────────────────

export class ScenarioSimulator {
  init(): void {
    logger.info('ScenarioSimulator initialized');
  }

  simulate(scenarioName: string, variables: Record<string, number>): ScenarioResult | null {
    const template = SCENARIO_TEMPLATES[scenarioName];
    if (template) {
      return template(variables);
    }

    // Dynamic simulation using causal graph
    return this.dynamicSimulate(scenarioName, variables);
  }

  private dynamicSimulate(scenarioName: string, variables: Record<string, number>): ScenarioResult | null {
    const nodeName = scenarioName.replace(/_/g, ' ');
    const node = causalGraph.getNodeByName(nodeName);
    if (!node) return null;

    const downstream = causalGraph.getDownstream(nodeName, 3);
    if (downstream.length === 0) return null;

    const chain: ScenarioResult['chainResponse'] = downstream.map((d, i) => ({
      step: i + 1,
      event: d.nodeName,
      probability: d.posterior,
      description: `${d.nodeName} (${(d.posterior * 100).toFixed(0)}%)`,
    }));

    return {
      name: scenarioName,
      description: `Simulating changes to "${nodeName}"`,
      variables: Object.entries(variables).map(([k, v]) => ({
        name: k,
        currentValue: 0,
        newValue: v,
        unit: '',
      })),
      effects: downstream.slice(0, 3).map(d => ({
        affectedVariable: d.nodeName,
        directEffect: `Posterior probability: ${(d.posterior * 100).toFixed(0)}%`,
        cascadeEffects: d.contributingPaths.slice(0, 3).map(p => p.path),
        probability: d.posterior,
      })),
      overallRisk: downstream.some(d => d.posterior > 0.6) ? 'high' : downstream.some(d => d.posterior > 0.3) ? 'moderate' : 'low',
      confidence: downstream.reduce((s, d) => s + d.confidence, 0) / downstream.length,
      chainResponse: chain,
    };
  }

  async simulateFreeform(description: string): Promise<ScenarioResult> {
    // Parse scenario description to find applicable template
    const lower = description.toLowerCase();

    if (lower.includes('magnitude') || lower.includes('earthquake') || lower.includes('m8') || lower.includes('m7')) {
      const magMatch = description.match(/M(\d+\.?\d*)/);
      const originalMag = parseFloat(description.match(/instead of M(\d+\.?\d*)/)?.[1] || '6.0');
      const newMag = magMatch ? parseFloat(magMatch[1]) : 7.0;
      return this.simulate('earthquake_magnitude_change', { originalMag, newMag, depth: 10 })!;
    }

    if (lower.includes('tsunami')) {
      const magMatch = description.match(/M(\d+\.?\d*)/);
      const mag = magMatch ? parseFloat(magMatch[1]) : 7.5;
      return this.simulate('tsunami_trigger', { magnitude: mag, depth: 10 })!;
    }

    if (lower.includes('fire') || lower.includes('wildfire') || lower.includes('burn')) {
      return this.simulate('wildfire_conditions', {
        temperature: 30, humidity: 25, windSpeed: 15, droughtIndex: 400,
      })!;
    }

    // Fallback: try causal graph
    const words = lower.split(/\s+/).filter(w => w.length > 3);
    for (const word of words) {
      const node = causalGraph.getNodeByName(word);
      if (node) {
        return this.dynamicSimulate(word, {})!;
      }
    }

    // Generic fallback
    return {
      name: 'Unknown Scenario',
      description: `Simulating: ${description}`,
      variables: [],
      effects: [],
      overallRisk: 'low',
      confidence: 0.1,
      chainResponse: [],
    };
  }

  listScenarios(): string[] {
    return Object.keys(SCENARIO_TEMPLATES);
  }
}

export const scenarioSimulator = new ScenarioSimulator();
