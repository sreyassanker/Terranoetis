import { SimulationEngine, type SimulationResult } from './simulationEngine';

export interface AdcircInputs {
  bathymetry: number[][];
  magnitude: number;
  depth: number;
  epicenter: [number, number];
  duration: number;
}

export interface AdcircOutputs {
  waveHeights: number[][];
  arrivalTimes: number[][];
  inundationMap: number[][];
}

const DEFAULT_INPUTS: AdcircInputs = {
  bathymetry: Array.from({ length: 80 }, () => Array.from({ length: 80 }, () => -1000)),
  magnitude: 7.5,
  depth: 15,
  epicenter: [40, 40],
  duration: 3600,
};

const GRAVITY = 9.81;

export async function runAdcircSimulation(
  engine: SimulationEngine,
  inputs: Partial<AdcircInputs> = {},
): Promise<SimulationResult> {
  const params: AdcircInputs = { ...DEFAULT_INPUTS, ...inputs };
  validateAdcircInputs(params);
  return engine.runSimulation({
    model: 'adcirc-lite',
    params: params as unknown as Record<string, unknown>,
    timeoutMs: 120000,
    memoryLimitMb: 256,
  });
}

function validateAdcircInputs(inputs: AdcircInputs): void {
  const rows = inputs.bathymetry.length;
  const cols = inputs.bathymetry[0]?.length || 0;
  if (rows < 10 || cols < 10) {
    throw new Error(`Bathymetry grid too small: ${rows}x${cols}`);
  }
  if (inputs.magnitude < 5 || inputs.magnitude > 10) {
    throw new Error('magnitude must be 5-10');
  }
  if (inputs.depth < 1 || inputs.depth > 700) {
    throw new Error('depth must be 1-700 km');
  }
  if (inputs.epicenter[0] < 0 || inputs.epicenter[0] >= rows ||
      inputs.epicenter[1] < 0 || inputs.epicenter[1] >= cols) {
    throw new Error('epicenter outside grid bounds');
  }
  if (inputs.duration < 60 || inputs.duration > 86400) {
    throw new Error('duration must be 60-86400 seconds');
  }
}





export function computeCelerity(depth: number): number {
  return Math.sqrt(GRAVITY * Math.max(depth, 0.1));
}







export function adcircOutputsToGeoJSON(outputs: AdcircOutputs): Record<string, unknown> {
  const features: Record<string, unknown>[] = [];
  const rows = outputs.waveHeights.length;
  const cols = outputs.waveHeights[0]?.length || 0;

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (outputs.waveHeights[i][j] > 0.5) {
        features.push({
          type: 'Feature',
          properties: {
            waveHeight: Math.round(outputs.waveHeights[i][j] * 100) / 100,
            arrivalTime: Math.round(outputs.arrivalTimes[i][j]),
            inundation: Math.round(outputs.inundationMap[i][j] * 100) / 100,
          },
          geometry: {
            type: 'Point',
            coordinates: [72 + j * 0.05, 8 + i * 0.05],
          },
        });
      }
    }
  }

  return { type: 'FeatureCollection', features };
}
