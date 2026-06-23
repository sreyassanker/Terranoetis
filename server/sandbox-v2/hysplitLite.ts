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
}

export interface HysplitOutputs {
  ashConcentration: number[][][];
  depositionMap: number[][];
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

const K_H = 5000;
const K_V = 50;

export function computeGaussianPlumeRise(
  heatFlux: number,
  windSpeed: number,
  _ambientLapseRate: number,
): number {
  const buoyancyFlux = heatFlux * 5.0;
  if (windSpeed > 0.1) {
    return Math.min(10000, 2.6 * (buoyancyFlux / windSpeed) ** 0.67);
  }
  return Math.min(10000, 5.0 * buoyancyFlux ** 0.25);
}

export function computeHorizontalDiffusivity(
  windSpeed: number,
  stability: string,
): number {
  const base = K_H;
  switch (stability) {
    case 'unstable': return base * 2.0;
    case 'stable': return base * 0.5;
    case 'neutral': return base * 1.0;
    default: return base;
  }
}

export function computeVerticalDiffusivity(
  windShear: number,
  stabilityClass: string,
): number {
  const base = K_V;
  const shearFactor = 1 + windShear * 10;
  switch (stabilityClass) {
    case 'unstable': return base * 3.0 * shearFactor;
    case 'stable': return base * 0.3 * shearFactor;
    case 'neutral': return base * shearFactor;
    default: return base * shearFactor;
  }
}

export function computeAshConcentration(
  massEmitted: number,
  plumeHeight: number,
  windSpeed: number,
  distance: number,
  horizontalDispersion: number,
  verticalDispersion: number,
): number {
  if (windSpeed < 0.1 || distance < 100) return 0;
  const travelTime = distance / windSpeed;
  const sigmaY = Math.sqrt(2 * horizontalDispersion * travelTime);
  const sigmaZ = Math.sqrt(2 * verticalDispersion * travelTime);
  const denominator = 2 * Math.PI * sigmaY * sigmaZ;
  if (denominator < 1e-10) return 0;
  const yTerm = Math.exp(-0.5 * (0 / sigmaY) ** 2);
  const zTerm = Math.exp(-0.5 * (plumeHeight / sigmaZ) ** 2);
  return (massEmitted / (windSpeed * denominator)) * yTerm * zTerm;
}

export function estimateAshSettlingTime(
  particleDiameterMm: number,
  particleDensity: number,
): number {
  const d = particleDiameterMm / 1000;
  const rho = particleDensity;
  const rhoAir = 1.2;
  const g = 9.81;
  const terminalVelocity = Math.sqrt(
    (4 * d * rho * g) / (3 * rhoAir * 0.5),
  );
  return terminalVelocity > 0.01 ? 10000 / terminalVelocity : 100000;
}

export function hysplitOutputsToGeoJSON(outputs: HysplitOutputs): Record<string, unknown> {
  const features: Record<string, unknown>[] = [];
  const rows = outputs.depositionMap.length;
  const cols = outputs.depositionMap[0]?.length || 0;

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (outputs.depositionMap[i][j] > 0.01) {
        features.push({
          type: 'Feature',
          properties: {
            deposition: Math.round(outputs.depositionMap[i][j] * 1000) / 1000,
          },
          geometry: {
            type: 'Point',
            coordinates: [72 + j * 0.1, 8 + i * 0.1],
          },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}
