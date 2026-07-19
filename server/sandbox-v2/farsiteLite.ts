import { SimulationEngine, type SimulationResult } from './simulationEngine';

export interface FarsiteInputs {
  dem: number[][];
  fuelModel: number[][];
  windSpeed: number;
  windDir: number;
  moisture: number;
  ignitionPoint: [number, number];
  duration: number;
}

export interface FarsiteOutputs {
  firePerimeters: number[][][];
  spreadRate: number[][];
  intensity: number[][];
  timeSteps: number;
}

const DEFAULT_INPUTS: FarsiteInputs = {
  dem: Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => 0)),
  fuelModel: Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => 0)),
  windSpeed: 20,
  windDir: 180,
  moisture: 0.15,
  ignitionPoint: [50, 50],
  duration: 120,
};

export async function runFarsiteSimulation(
  engine: SimulationEngine,
  inputs: Partial<FarsiteInputs> = {},
): Promise<SimulationResult> {
  const params: FarsiteInputs = { ...DEFAULT_INPUTS, ...inputs };

  validateFarsiteInputs(params);

  return engine.runSimulation({
    model: 'farsite-lite',
    params: params as unknown as Record<string, unknown>,
    timeoutMs: 60000,
    memoryLimitMb: 256,
  });
}

function validateFarsiteInputs(inputs: FarsiteInputs): void {
  const rows = inputs.dem.length;
  const cols = inputs.dem[0]?.length || 0;

  if (rows < 10 || cols < 10) {
    throw new Error(`DEM grid too small: ${rows}x${cols}. Minimum 10x10.`);
  }
  if (inputs.fuelModel.length !== rows || (inputs.fuelModel[0]?.length || 0) !== cols) {
    throw new Error('fuelModel grid must match DEM dimensions');
  }
  if (inputs.windSpeed < 0 || inputs.windSpeed > 200) {
    throw new Error('windSpeed must be 0-200 km/h');
  }
  if (inputs.windDir < 0 || inputs.windDir >= 360) {
    throw new Error('windDir must be 0-359 degrees');
  }
  if (inputs.moisture < 0 || inputs.moisture > 1) {
    throw new Error('moisture must be 0-1');
  }
  if (inputs.ignitionPoint[0] < 0 || inputs.ignitionPoint[0] >= rows ||
      inputs.ignitionPoint[1] < 0 || inputs.ignitionPoint[1] >= cols) {
    throw new Error('ignitionPoint outside grid bounds');
  }
  if (inputs.duration < 1 || inputs.duration > 1440) {
    throw new Error('duration must be 1-1440 minutes');
  }
}

export function farsiteOutputsToGeoJSON(outputs: FarsiteOutputs): Record<string, unknown> {
  const features: Record<string, unknown>[] = [];

  for (let t = 0; t < outputs.firePerimeters.length; t++) {
    const perimeter = outputs.firePerimeters[t];
    if (perimeter.length < 3) continue;

    const coords = perimeter.map(([row, col]) => {
      const lon = col * 0.01 + 72;
      const lat = row * 0.01 + 8;
      return [lon, lat];
    });
    coords.push(coords[0]);

    features.push({
      type: 'Feature',
      properties: { timeStep: t, area: perimeter.length },
      geometry: { type: 'Polygon', coordinates: [coords] },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}



const FUEL_MODEL_PARAMS: Record<number, { load: number; depth: number; savr: number; ext: number; heat: number }> = {
  1: { load: 0.74, depth: 0.3, savr: 3500, ext: 0.15, heat: 18608 },
  2: { load: 2.00, depth: 0.3, savr: 3000, ext: 0.20, heat: 18608 },
  3: { load: 3.50, depth: 0.6, savr: 2500, ext: 0.25, heat: 18608 },
  4: { load: 5.00, depth: 0.6, savr: 2000, ext: 0.30, heat: 18608 },
  5: { load: 1.00, depth: 0.2, savr: 4000, ext: 0.15, heat: 18608 },
};

export function getFuelModelParams(fuelModel: number) {
  return FUEL_MODEL_PARAMS[fuelModel] || FUEL_MODEL_PARAMS[1];
}







