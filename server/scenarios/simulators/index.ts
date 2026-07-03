import type { ScenarioParams, ScenarioTimeSeries, ScenarioType } from '../templates';
import { simulateEarthquake } from './earthquake';
import { simulateHurricane } from './hurricane';
import { simulateWildfire } from './wildfire';
import { simulateVolcanic } from './volcanic';
import { simulateFlood } from './flood';
import { simulateTsunami } from './tsunami';

const simulators: Record<string, (params: ScenarioParams) => ScenarioTimeSeries> = {
  earthquake_swarm: simulateEarthquake,
  hurricane_landfall: simulateHurricane,
  wildfire_spread: simulateWildfire,
  volcanic_eruption: simulateVolcanic,
  flood_inundation: simulateFlood,
  tsunami_wave: simulateTsunami,
};

export function simulateScenario(type: ScenarioType, params: ScenarioParams): ScenarioTimeSeries {
  const fn = simulators[type];
  if (!fn) return { steps: [], metadata: { duration: 0, dt: 1, type, params: params as unknown as Record<string, unknown> } };
  return fn(params);
}

export function getSimulatorNames(): string[] {
  return Object.keys(simulators);
}
