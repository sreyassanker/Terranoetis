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

export function estimateFireSpreadRate(
  windSpeed: number,
  moisture: number,
  fuelModel: number,
): number {
  const baseRate = 0.1 + fuelModel * 0.5;
  const windFactor = 1.0 + (windSpeed / 30.0) ** 0.5;
  const moistureFactor = 1.0 - moisture * 0.8;
  const slopeFactor = 1.0;
  return baseRate * windFactor * moistureFactor * slopeFactor;
}

export function calculateIntensity(
  spreadRate: number,
  fuelLoad: number,
  heatContent: number = 18608,
): number {
  return spreadRate * fuelLoad * heatContent / 60.0;
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

export function computeRothermelSpreadRate(
  windSpeed: number,
  windDir: number,
  slopeDeg: number,
  slopeAzimuth: number,
  fuelModel: number,
  moisture: number,
): number {
  const fuel = getFuelModelParams(fuelModel);
  const maxSpreadRate = 1.0 + fuel.load * 0.5;
  const windFactor = windSpeed > 0
    ? 1.0 + (windSpeed / 30.0) * Math.cos((windDir - slopeAzimuth) * Math.PI / 180)
    : 1.0;
  const slopeFactor = 1.0 + Math.tan(slopeDeg * Math.PI / 180) * 2.0;
  const moistureFactor = 1.0 - Math.min(1, moisture / fuel.ext);
  const savrFactor = fuel.savr / 3500;
  return maxSpreadRate * Math.max(0, windFactor) * slopeFactor * Math.max(0, moistureFactor) * savrFactor;
}

export function computeFirelineIntensity(
  spreadRate: number,
  fuelConsumed: number,
  heatContent: number = 18608,
): number {
  return spreadRate * fuelConsumed * heatContent / 60.0;
}

export function computeFlameLength(intensity: number): number {
  return 0.45 * Math.pow(intensity, 0.46);
}

export function computeCrownFractionBurned(
  spreadRate: number,
  canopyBaseHeight: number,
  _canopyBulkDensity: number,
): number {
  if (spreadRate < 0.1) return 0;
  if (canopyBaseHeight > 20) return 0;
  const criticalIntensity = 0.01 * canopyBaseHeight ** 2;
  const actualIntensity = 5000 * spreadRate;
  return Math.min(1, actualIntensity / criticalIntensity);
}

export function estimateContainmentProbability(
  fireSizeHa: number,
  windSpeed: number,
  resourcesAvailable: number,
  timeToContainmentHr: number,
): number {
  const sizeFactor = Math.max(0, 1 - fireSizeHa / 10000);
  const windFactor = Math.max(0, 1 - windSpeed / 100);
  const resourceFactor = Math.min(1, resourcesAvailable / 10);
  const timeFactor = Math.max(0, 1 - timeToContainmentHr / 24);
  return 0.25 * (sizeFactor + windFactor + resourceFactor + timeFactor);
}

export function estimateFirePerimeterGrowth(
  currentPerimeterKm: number,
  spreadRate: number,
  timeStepMin: number,
  shapeFactor: number = 1.2,
): number {
  const growthRate = spreadRate * timeStepMin * 60 / 1000;
  return currentPerimeterKm + growthRate * shapeFactor;
}

export function convertFlameLengthToCrownScorch(
  flameLength: number,
  windSpeed: number,
): number {
  const flameHeight = flameLength * 0.5;
  const tiltFactor = 1 + windSpeed * 0.01;
  return Math.min(100, flameHeight * tiltFactor * 10);
}
