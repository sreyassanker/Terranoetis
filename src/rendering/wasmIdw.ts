import type { InterpGrid, InterpPoint } from './idwInterpolation';
import { interpolateIDW as jsInterpolateIDW, renderGridToCanvas } from './idwInterpolation';

export { renderGridToCanvas }; export type { InterpGrid };

let wasmReady = false;

export async function initWasmIdw(): Promise<boolean> {
  try {
    // Try dynamic import of WASM module — gracefully fallback to JS
    const mod = await import('./wasm/idw_wasm.js').catch(() => null);
    if (mod && typeof (mod as Record<string, unknown>).interpolate_idw === 'function') {
      wasmReady = true;
      return true;
    }
    wasmReady = false;
    return false;
  } catch {
    wasmReady = false;
    return false;
  }
}

export function isWasmReady(): boolean {
  return wasmReady;
}

export function interpolateIDW(
  points: InterpPoint[],
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number },
  gridWidth: number,
  gridHeight: number,
  power: number = 2,
  neighbors: number = 12,
): InterpGrid {
  return jsInterpolateIDW(points, bbox, gridWidth, gridHeight, power, neighbors);
}
