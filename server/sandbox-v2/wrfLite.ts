import { SimulationEngine, type SimulationResult } from './simulationEngine';

export interface WrfInitialConditions {
  temperature?: number[][];
  pressure?: number[][];
  humidity?: number[][];
  windU?: number[][];
  windV?: number[][];
}

export interface WrfBoundaryConditions {
  north?: { temperature?: number; pressure?: number; windU?: number; windV?: number };
  south?: { temperature?: number; pressure?: number; windU?: number; windV?: number };
  east?: { temperature?: number; pressure?: number; windU?: number; windV?: number };
  west?: { temperature?: number; pressure?: number; windU?: number; windV?: number };
}

export interface WrfInputs {
  initialConditions: WrfInitialConditions;
  boundaryConditions: WrfBoundaryConditions;
  terrain: number[][];
  duration: number;
}

export interface WrfOutputs {
  wind: number[][][];
  pressure: number[][][];
  temperature: number[][][];
  precipitation: number[][];
}

const DEFAULT_TERRAIN = Array.from({ length: 60 }, () =>
  Array.from({ length: 60 }, () => Math.random() * 1000),
);

const DEFAULT_INPUTS: WrfInputs = {
  initialConditions: {
    temperature: Array.from({ length: 60 }, () =>
      Array.from({ length: 60 }, () => (Math.random() - 0.5) * 5),
    ),
    pressure: Array.from({ length: 60 }, () =>
      Array.from({ length: 60 }, () => (Math.random() - 0.5) * 200),
    ),
  },
  boundaryConditions: {},
  terrain: DEFAULT_TERRAIN,
  duration: 24,
};

export async function runWrfSimulation(
  engine: SimulationEngine,
  inputs: Partial<WrfInputs> = {},
): Promise<SimulationResult> {
  const params: WrfInputs = {
    initialConditions: inputs.initialConditions || DEFAULT_INPUTS.initialConditions,
    boundaryConditions: inputs.boundaryConditions || DEFAULT_INPUTS.boundaryConditions,
    terrain: inputs.terrain || DEFAULT_INPUTS.terrain,
    duration: inputs.duration ?? DEFAULT_INPUTS.duration,
  };
  validateWrfInputs(params);
  return engine.runSimulation({
    model: 'wrf-lite',
    params: params as unknown as Record<string, unknown>,
    timeoutMs: 120000,
    memoryLimitMb: 512,
  });
}

function validateWrfInputs(inputs: WrfInputs): void {
  const rows = inputs.terrain.length;
  const cols = inputs.terrain[0]?.length || 0;
  if (rows < 20 || cols < 20) {
    throw new Error(`Terrain grid too small: ${rows}x${cols}. Minimum 20x20.`);
  }
  if (inputs.initialConditions.temperature) {
    if (inputs.initialConditions.temperature.length !== rows ||
        (inputs.initialConditions.temperature[0]?.length || 0) !== cols) {
      throw new Error('initialConditions.temperature must match terrain dimensions');
    }
  }
  if (inputs.duration < 1 || inputs.duration > 720) {
    throw new Error('duration must be 1-720 hours');
  }
}

const CP = 1004;
const RD = 287;
const F_CORIOLIS = 1e-4;

export function computeGeostrophicWind(
  pressureGradientX: number,
  pressureGradientY: number,
  density: number,
): { u: number; v: number } {
  const factor = 1 / (density * F_CORIOLIS);
  return {
    u: -factor * pressureGradientY,
    v: factor * pressureGradientX,
  };
}

export function computePotentialTemperature(
  temperature: number,
  pressure: number,
): number {
  const p0 = 100000;
  return temperature * (p0 / pressure) ** (RD / CP);
}

export function computeEquivalentPotentialTemperature(
  temperature: number,
  pressure: number,
  mixingRatio: number,
): number {
  const tlcl = 55 + 2840 / (3.5 * Math.log(temperature) - Math.log(100 * mixingRatio) - 4.805);
  const thetaDL = temperature * (100000 / pressure) ** (0.2854 * (1 - 0.28 * mixingRatio));
  return thetaDL * Math.exp((3036 / tlcl - 1.78) * mixingRatio * (1 + 0.448 * mixingRatio));
}

export function computeBruntVaisalaFrequency(
  temperature: number,
  potentialTemperatureGradient: number,
): number {
  const theta = computePotentialTemperature(temperature, 100000);
  if (theta <= 0) return 0;
  return Math.sqrt(GRAVITY / theta * Math.max(0, potentialTemperatureGradient));
}

export function computeRichardsonNumber(
  windShear: number,
  buoyancyFrequency: number,
): number {
  const shearSq = windShear ** 2;
  if (shearSq < 1e-10) return 999;
  return buoyancyFrequency ** 2 / shearSq;
}

export function computeSurfaceFlux(
  windSpeed: number,
  temperatureDiff: number,
  humidityDiff: number,
  roughnessLength: number,
  stabilityCorrection: number = 1,
): { sensibleHeat: number; latentHeat: number; momentum: number } {
  const Cd = (0.4 / Math.log(10 / Math.max(roughnessLength, 0.001))) ** 2;
  const rho = 1.2;
  const sensibleHeat = rho * CP * Cd * windSpeed * temperatureDiff * stabilityCorrection;
  const latentHeat = rho * 2.5e6 * Cd * windSpeed * humidityDiff * stabilityCorrection;
  const momentum = rho * Cd * windSpeed ** 2 * stabilityCorrection;
  return { sensibleHeat, latentHeat, momentum };
}

export function computeAdvectionTerm(
  field: number[][],
  u: number[][],
  v: number[][],
  dx: number,
  dy: number,
): number[][] {
  const rows = field.length;
  const cols = field[0]?.length || 0;
  const advection: number[][] = [];

  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      const iPrev = Math.max(0, i - 1);
      const iNext = Math.min(rows - 1, i + 1);
      const jPrev = Math.max(0, j - 1);
      const jNext = Math.min(cols - 1, j + 1);
      const dfdx = (field[i][jNext] - field[i][jPrev]) / (2 * dx);
      const dfdy = (field[iNext][j] - field[iPrev][j]) / (2 * dy);
      row.push(-u[i][j] * dfdx - v[i][j] * dfdy);
    }
    advection.push(row);
  }
  return advection;
}

export function computeCoriolisForce(
  u: number[][],
  v: number[][],
  latitude: number,
): { fu: number[][]; fv: number[][] } {
  const f = 2 * 7.2921e-5 * Math.sin(latitude * Math.PI / 180);
  const fu = v.map(row => row.map(val => f * val));
  const fv = u.map(row => row.map(val => -f * val));
  return { fu, fv };
}

export function computePrecipitationRate(
  specificHumidity: number[][],
  verticalVelocity: number[][],
  pressureLevel: number,
): number[][] {
  const rows = specificHumidity.length;
  const cols = specificHumidity[0]?.length || 0;
  const precip: number[][] = [];

  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      const omega = verticalVelocity[i][j];
      const q = specificHumidity[i][j];
      const condensation = omega < 0 ? Math.max(0, -omega * q * pressureLevel / (GRAVITY * 100)) : 0;
      row.push(condensation);
    }
    precip.push(row);
  }
  return precip;
}

export function wrfOutputsToGridJSON(outputs: WrfOutputs): Record<string, unknown> {
  return {
    type: 'wrf-lite-output',
    timeSteps: outputs.wind.length,
    gridShape: {
      rows: outputs.precipitation.length,
      cols: outputs.precipitation[0]?.length || 0,
    },
    summary: {
      maxWindSpeed: Math.max(
        ...outputs.wind.flatMap(t => t.flatMap(u => u)),
      ),
      minPressure: Math.min(
        ...outputs.pressure.flatMap(t => t.flatMap(p => p)),
      ),
      maxTemperature: Math.max(
        ...outputs.temperature.flatMap(t => t.flatMap(temp => temp)),
      ),
      totalPrecipitation: outputs.precipitation.reduce(
        (s, row) => s + row.reduce((a, b) => a + Math.max(0, b), 0), 0,
      ),
    },
  };
}
