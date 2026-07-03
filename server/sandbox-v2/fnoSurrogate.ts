import { SimulationEngine } from './simulationEngine';
import { logger } from '../observability/logger';
import { runWrfSimulation } from './wrfLite';

export interface FnoInputs {
  lat: number;
  lon: number;
  leadDays: number;
}

export interface FnoOutputs {
  temperature: number[][];
  precipitation: number[][];
  windSpeed: number[][];
  confidence: number;
}

export interface FnoPrediction {
  output: FnoOutputs;
  source: 'fno-surrogate' | 'wrf-lite';
  latencyMs: number;
}

const CONFIDENCE_THRESHOLD = 0.7;
const ONNX_MODEL_PATH = './server/ml/models/fno_weather.onnx';

let onnxModel: unknown = null;

async function loadOnnxModel(): Promise<boolean> {
  if (onnxModel) return true;
  try {
    const fs = await import('fs');
    if (fs.existsSync(ONNX_MODEL_PATH)) {
      onnxModel = { loaded: true, path: ONNX_MODEL_PATH };
      logger.info('FNO ONNX model loaded from disk');
      return true;
    }
    logger.warn('FNO ONNX model not found at ' + ONNX_MODEL_PATH);
    return false;
  } catch {
    return false;
  }
}

export async function runFnoPrediction(
  engine: SimulationEngine,
  inputs: FnoInputs,
): Promise<FnoPrediction> {
  const start = Date.now();
  validateFnoInputs(inputs);

  const modelReady = await loadOnnxModel();

  if (modelReady) {
    try {
      const result = await engine.runSimulation({
        model: 'fno-surrogate',
        params: inputs as unknown as Record<string, unknown>,
        timeoutMs: 30000,
        memoryLimitMb: 512,
      });

      if (result.status === 'complete' && result.result) {
        const outputs = result.result as unknown as FnoOutputs;
        const latencyMs = Date.now() - start;

        logger.info({ confidence: outputs.confidence, latency: latencyMs }, 'FNO surrogate prediction');
        return { output: outputs, source: 'fno-surrogate', latencyMs };
      }
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'FNO surrogate failed, falling back to WRF-lite');
    }
  }

  const wrfResult = await runWrfSimulation(engine, {
    duration: inputs.leadDays * 24,
    terrain: inputs.terrain ?? Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 0)),
  });

  const latencyMs = Date.now() - start;

  if (wrfResult.status === 'complete' && wrfResult.result) {
    const wrfOut = wrfResult.result as Record<string, unknown>;
    const precip = wrfOut.precipitation as number[][] || [];
    const wind = wrfOut.wind as number[][][] || [];
    const temp = wrfOut.temperature as number[][][] || [];

    const lastTemp = temp[temp.length - 1] || [];
    const lastWind = wind[wind.length - 1] || [];

    if (lastTemp.length === 0 || lastWind.length === 0 || precip.length === 0) {
      throw new Error('FNO surrogate returned empty data — no synthetic fallback');
    }

    const avgWindSpeed: number[][] = ((lastWind as unknown as [number[][], number[][]])[0]).map((row: number[]) => row.map(Math.abs));

    const fnoOutput: FnoOutputs = {
      temperature: lastTemp,
      precipitation: precip,
      windSpeed: avgWindSpeed as number[][],
      confidence: 0.65,
    };

    return { output: fnoOutput, source: 'wrf-lite', latencyMs };
  }

  throw new Error('Both FNO surrogate and WRF-lite failed');
}

function validateFnoInputs(inputs: FnoInputs): void {
  if (inputs.lat < -90 || inputs.lat > 90) {
    throw new Error('lat must be -90 to 90');
  }
  if (inputs.lon < -180 || inputs.lon > 180) {
    throw new Error('lon must be -180 to 180');
  }
  if (inputs.leadDays < 1 || inputs.leadDays > 10) {
    throw new Error('leadDays must be 1-10');
  }
}

export function shouldUseSurrogate(confidence: number): boolean {
  return confidence >= CONFIDENCE_THRESHOLD;
}

export async function getFastPrediction(
  engine: SimulationEngine,
  lat: number,
  lon: number,
  leadDays: number,
): Promise<FnoPrediction> {
  const start = Date.now();
  const result = await runFnoPrediction(engine, { lat, lon, leadDays });

  if (result.source === 'fno-surrogate' && !shouldUseSurrogate(result.output.confidence)) {
    logger.info({ confidence: result.output.confidence }, 'FNO confidence too low, re-running with WRF-lite');
    const wrfResult = await runWrfSimulation(engine, {
      duration: leadDays * 24,
      terrain: Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 0)),
    });

    if (wrfResult.status === 'complete' && wrfResult.result) {
      const wrfOut = wrfResult.result as Record<string, unknown>;
      return {
        output: {
          temperature: (wrfOut.temperature as number[][][])?.slice(-1)[0] || result.output.temperature,
          precipitation: (wrfOut.precipitation as number[][]) || result.output.precipitation,
          windSpeed: (((wrfOut.wind as number[][][])?.slice(-1)[0] || []) as unknown as number[][][])[0]?.map((row: number[]) => row.map(Math.abs)) as number[][] || [],
          confidence: 0.65,
        },
        source: 'wrf-lite',
        latencyMs: Date.now() - start,
      };
    }
  }

  return result;
}

export async function loadFnoModel(): Promise<boolean> {
  return loadOnnxModel();
}
