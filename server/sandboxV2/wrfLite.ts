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
  Array.from({ length: 60 }, () => 0),
);

const DEFAULT_INPUTS: WrfInputs = {
  initialConditions: {
    temperature: Array.from({ length: 60 }, () =>
      Array.from({ length: 60 }, () => 0),
    ),
    pressure: Array.from({ length: 60 }, () =>
      Array.from({ length: 60 }, () => 0),
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


export function computePotentialTemperature(
  temperature: number,
  pressure: number,
): number {
  const p0 = 100000;
  return temperature * (p0 / pressure) ** (RD / CP);
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
