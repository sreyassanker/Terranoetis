import type { ScenarioParams, ScenarioTimeSeries, ScenarioType } from '../templates';
import { simulateEarthquake } from './earthquake';
import { simulateHurricane } from './hurricane';
import { simulateWildfire } from './wildfire';
import { simulateVolcanic } from './volcanic';
import { simulateFlood } from './flood';
import { simulateTsunami } from './tsunami';
import { simulateLandslide } from './landslide';
import { validateScenario } from '../geographicValidator';

const simulators: Record<string, (params: ScenarioParams) => ScenarioTimeSeries> = {
  earthquake_swarm: simulateEarthquake,
  hurricane_landfall: simulateHurricane,
  wildfire_spread: simulateWildfire,
  volcanic_eruption: simulateVolcanic,
  flood_inundation: simulateFlood,
  tsunami_wave: simulateTsunami,
  landslide: simulateLandslide,
};

/**
 * Get location from params based on scenario type
 */
function getLocationFromParams(type: string, params: ScenarioParams): { lat: number; lon: number } | null {
  const p = params as unknown as Record<string, unknown>;
  
  switch (type) {
    case 'tsunami_wave':
      return { lat: p.epicenterLat as number, lon: p.epicenterLon as number };
    case 'landslide':
      return { lat: p.lat as number, lon: p.lon as number };
    case 'earthquake_swarm':
    case 'hurricane_landfall':
    case 'wildfire_spread':
    case 'volcanic_eruption':
    case 'flood_inundation':
      return { lat: p.lat as number, lon: p.lon as number };
    default:
      return null;
  }
}

export function simulateScenario(type: ScenarioType, params: ScenarioParams): ScenarioTimeSeries {
  const fn = simulators[type];
  if (!fn) return { steps: [], metadata: { duration: 0, dt: 1, type, params: params as unknown as Record<string, unknown> } };
  
  // Validate location before simulation
  const location = getLocationFromParams(type, params);
  if (location) {
    const validation = validateScenario(type, location.lat, location.lon);
    if (!validation.valid) {
      console.warn(`Scenario validation warning: ${validation.reason}`);
      // Continue simulation but log warning - don't block user
    }
  }
  
  return fn(params);
}


/**
 * Get validation result for a scenario without running simulation
 */
