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

const MANNING_N = 0.025;
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

export function estimateInitialWaveHeight(magnitude: number, depth: number): number {
  return 10 ** (0.5 * magnitude - 3.0) * Math.min(1, Math.max(0.1, 30 / Math.max(depth, 1)));
}

export function computeArrivalTime(
  distanceKm: number,
  avgDepth: number,
): number {
  const waveSpeed = Math.sqrt(GRAVITY * Math.max(avgDepth, 1));
  return waveSpeed > 0 ? (distanceKm * 1000) / waveSpeed : 3600;
}

export function computeInundationDepth(
  waveHeight: number,
  elevation: number,
  manningCoeff: number = MANNING_N,
): number {
  if (elevation >= 0) {
    const maxRunup = waveHeight * (1 + 0.5 / manningCoeff);
    return Math.max(0, maxRunup - elevation);
  }
  return Math.max(0, waveHeight - Math.abs(elevation) * 0.1);
}

export function computeCourantNumber(
  waveSpeed: number,
  dt: number,
  dx: number,
): number {
  return waveSpeed * dt / dx;
}

export function computeCelerity(depth: number): number {
  return Math.sqrt(GRAVITY * Math.max(depth, 0.1));
}

export function computeWaveAmplitude(
  initialAmplitude: number,
  distanceKm: number,
  avgDepth: number,
  spreadingFactor: number = 1,
): number {
  const greenFactor = Math.pow(avgDepth / 4000, -0.25);
  const spreadFactor = Math.pow(distanceKm / 100 + 1, -0.5);
  return initialAmplitude * greenFactor * spreadFactor * spreadingFactor;
}

export function estimateTsunamiInundationZone(
  coastalElevation: number[][],
  maxWaveHeight: number,
  manningCoeff: number = MANNING_N,
): number[][] {
  const rows = coastalElevation.length;
  const cols = coastalElevation[0]?.length || 0;
  const inundation: number[][] = [];

  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      const elevation = coastalElevation[i][j];
      if (elevation < 0) {
        row.push(maxWaveHeight);
      } else {
        const runup = maxWaveHeight * (1 + 0.5 / manningCoeff);
        row.push(Math.max(0, runup - elevation));
      }
    }
    inundation.push(row);
  }
  return inundation;
}

export function computeMomentMagnitude(
  area_km2: number,
  slip_m: number,
  rigidity: number = 3e10,
): number {
  const mo = area_km2 * 1e6 * slip_m * rigidity;
  return (2 / 3) * Math.log10(mo) - 10.7;
}

export function computeTsunamiEnergy(
  waveHeight: number,
  waterDensity: number = 1025,
): number {
  return 0.125 * waterDensity * GRAVITY * waveHeight ** 2;
}

export function computeEddyViscosity(
  depth: number,
  currentSpeed: number,
  manningCoeff: number = MANNING_N,
): number {
  return manningCoeff ** 2 * GRAVITY * depth ** (4 / 3) * currentSpeed * 10;
}

export function computeWaveRefractionAngle(
  incidentAngle: number,
  depth1: number,
  depth2: number,
): number {
  const c1 = computeCelerity(depth1);
  const c2 = computeCelerity(depth2);
  if (c1 < 0.1 || c2 < 0.1) return incidentAngle;
  const sinTheta2 = Math.sin(incidentAngle) * c2 / c1;
  return Math.asin(Math.max(-1, Math.min(1, sinTheta2)));
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
