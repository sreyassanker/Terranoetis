import { SimulationEngine, type SimulationResult } from './simulationEngine';

export interface WindField {
  altitude: number;
  speed: number;
  direction: number;
}

export interface HysplitInputs {
  eruptionHeight: number;
  ashMass: number;
  windFields: WindField[];
  duration: number;
  /** Simulation-center latitude [°]; defaults to 8 (Ethiopia Rift). */
  lat?: number;
  /** Simulation-center longitude [°]; defaults to 72 (Ethiopia Rift). */
  lon?: number;
}

export interface HysplitOutputs {
  ashConcentration: number[][][];
  depositionMap: number[][];
  /** Grid origin (south-west corner) in degrees, for GeoJSON export. */
  lat0?: number;
  lon0?: number;
  /** Cell size in degrees (north, east). */
  dlat?: number;
  dlon?: number;
}

const DEFAULT_INPUTS: HysplitInputs = {
  eruptionHeight: 12,
  ashMass: 5000,
  windFields: [
    { altitude: 0, speed: 5, direction: 270 },
    { altitude: 5000, speed: 15, direction: 260 },
    { altitude: 10000, speed: 25, direction: 250 },
    { altitude: 15000, speed: 30, direction: 240 },
  ],
  duration: 24,
};

export async function runHysplitSimulation(
  engine: SimulationEngine,
  inputs: Partial<HysplitInputs> = {},
): Promise<SimulationResult> {
  const params: HysplitInputs = { ...DEFAULT_INPUTS, ...inputs };
  validateHysplitInputs(params);
  return engine.runSimulation({
    model: 'hysplit-lite',
    params: params as unknown as Record<string, unknown>,
    timeoutMs: 60000,
    memoryLimitMb: 256,
  });
}

function validateHysplitInputs(inputs: HysplitInputs): void {
  if (inputs.eruptionHeight < 1 || inputs.eruptionHeight > 55) {
    throw new Error('eruptionHeight must be 1-55 km');
  }
  if (inputs.ashMass < 1 || inputs.ashMass > 10000000) {
    throw new Error('ashMass must be 1-10,000,000 tonnes');
  }
  if (!inputs.windFields || inputs.windFields.length === 0) {
    throw new Error('windFields array required');
  }
  for (const wf of inputs.windFields) {
    if (wf.speed < 0 || wf.speed > 200) throw new Error('wind speed out of range 0-200 m/s');
    if (wf.direction < 0 || wf.direction >= 360) throw new Error('wind direction out of range 0-359');
  }
  if (inputs.duration < 1 || inputs.duration > 168) {
    throw new Error('duration must be 1-168 hours');
  }
}







export function hysplitOutputsToGeoJSON(outputs: HysplitOutputs): Record<string, unknown> {
  const features: Record<string, unknown>[] = [];
  const rows = outputs.depositionMap.length;
  const cols = outputs.depositionMap[0]?.length || 0;
  // Use the real grid origin/cell size emitted by the simulation so the
  // deposition overlay lands at the correct lat/lon (was hardcoded 72°E/8°N).
  const lat0 = outputs.lat0 ?? 8.0;
  const lon0 = outputs.lon0 ?? 72.0;
  const dlat = outputs.dlat ?? 0.027;
  const dlon = outputs.dlon ?? 0.027;

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const dep = outputs.depositionMap[i][j];
      if (dep > 0.01) {
        features.push({
          type: 'Feature',
          properties: {
            deposition: Math.round(dep * 1000) / 1000,
          },
          // i is the row from the north; latitudes increase northward.
          geometry: {
            type: 'Point',
            coordinates: [lon0 + j * dlon, lat0 + (rows - 1 - i) * dlat],
          },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}
