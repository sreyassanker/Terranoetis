/**
 * Shared utilities for Kaggle simulation overlays.
 *
 * Provides:
 * - Per-simulation-type grid cell size (meters) — the ground truth domain
 *   extent is `gridShape * cellSizeM`, NOT the old hardcoded 2.56 km guess.
 * - GIS-style color ramps (Viridis, Turbo, Spectral, ...) + interpolation.
 * - Canvas rasterization of a value grid into colored imagery.
 * - Rectangle computation to position the overlay at the study site.
 */

import * as Cesium from 'cesium';
import type { CfaColormapName } from './gpu/cfdColormaps';

export type SimulationType =
  | 'flood_inundation'
  | 'wildfire_spread'
  | 'earthquake_swarm'
  | 'tsunami_wave'
  | 'hurricane_landfall'
  | 'volcanic_eruption'
  | 'landslide';

/** Grid cell size in meters for each kernel (matches kaggle-kernels kernels). */
export const SIM_CELL_SIZE_M: Record<string, number> = {
  flood_inundation: 5,
  wildfire_spread: 100,
  earthquake_swarm: 500,
  tsunami_wave: 5000,
  hurricane_landfall: 2000,
  volcanic_eruption: 50,
  landslide: 20,
};

export interface ColorStop {
  stop: number;
  r: number;
  g: number;
  b: number;
}

export const COLORMAPS: Record<string, { label: string; stops: ColorStop[] }> = {
  viridis: {
    label: 'Viridis',
    stops: [
      { stop: 0.00, r: 68,  g: 1,   b: 84 },
      { stop: 0.25, r: 59,  g: 82,  b: 139 },
      { stop: 0.50, r: 33,  g: 145, b: 140 },
      { stop: 0.75, r: 94,  g: 201, b: 98 },
      { stop: 1.00, r: 253, g: 231, b: 37 },
    ],
  },
  turbo: {
    label: 'Turbo',
    stops: [
      { stop: 0.00, r: 48,  g: 18,  b: 59 },
      { stop: 0.20, r: 66,  g: 100, b: 203 },
      { stop: 0.40, r: 53,  g: 176, b: 137 },
      { stop: 0.60, r: 128, g: 216, b: 62 },
      { stop: 0.80, r: 240, g: 178, b: 24 },
      { stop: 1.00, r: 122, g: 4,   b: 3 },
    ],
  },
  inferno: {
    label: 'Inferno',
    stops: [
      { stop: 0.00, r: 0,   g: 0,   b: 4 },
      { stop: 0.25, r: 87,  g: 16,  b: 110 },
      { stop: 0.50, r: 178, g: 24,  b: 43 },
      { stop: 0.75, r: 249, g: 127, b: 10 },
      { stop: 1.00, r: 252, g: 255, b: 164 },
    ],
  },
  plasma: {
    label: 'Plasma',
    stops: [
      { stop: 0.00, r: 13,  g: 8,   b: 135 },
      { stop: 0.25, r: 75,  g: 3,   b: 161 },
      { stop: 0.50, r: 175, g: 19,  b: 102 },
      { stop: 0.75, r: 242, g: 104, b: 34 },
      { stop: 1.00, r: 240, g: 249, b: 33 },
    ],
  },
  spectral: {
    label: 'Spectral',
    stops: [
      { stop: 0.00, r: 94,  g: 79,  b: 162 },
      { stop: 0.20, r: 50,  g: 136, b: 189 },
      { stop: 0.40, r: 96,  g: 200, b: 181 },
      { stop: 0.60, r: 218, g: 224, b: 102 },
      { stop: 0.80, r: 246, g: 160, b: 42 },
      { stop: 1.00, r: 158, g: 1,   b: 66 },
    ],
  },
  coolwarm: {
    label: 'Cool–Warm',
    stops: [
      { stop: 0.00, r: 59,  g: 76,  b: 192 },
      { stop: 0.50, r: 220, g: 220, b: 220 },
      { stop: 1.00, r: 180, g: 4,   b: 38 },
    ],
  },
  grayscale: {
    label: 'Grayscale',
    stops: [
      { stop: 0.00, r: 0,   g: 0,   b: 0 },
      { stop: 1.00, r: 255, g: 255, b: 255 },
    ],
  },
  terrain: {
    label: 'Terrain',
    stops: [
      { stop: 0.00, r: 34,  g: 120, b: 30 },
      { stop: 0.33, r: 140, g: 140, b: 80 },
      { stop: 0.66, r: 120, g: 80,  b: 40 },
      { stop: 1.00, r: 255, g: 255, b: 255 },
    ],
  },
};

/** Resolve a colormap by scheme name; falls back to the overlay's default. */
export function getColormap(scheme: string, defaultMap: ColorStop[]): ColorStop[] {
  if (scheme === 'default') return defaultMap;
  return COLORMAPS[scheme]?.stops || defaultMap;
}

/**
 * Map a legend scheme name to the GLSL colormap compiled into the GPU
 * primitives. Keeps the legend bar and the 3D rendering identical.
 */
export function schemeToCfa(scheme: string, fallback: CfaColormapName): CfaColormapName {
  switch (scheme) {
    case 'viridis': return 'viridis';
    case 'turbo': return 'turbo';
    case 'inferno': return 'inferno';
    case 'plasma': return 'plasma';
    case 'spectral': return 'spectral';
    case 'coolwarm': return 'coolwarm';
    case 'grayscale': return 'coolwarm'; // closest available ramp
    default: return fallback;
  }
}

export function interpolateColormap(colormap: ColorStop[], t: number): [number, number, number] {
  const ct = Math.max(0, Math.min(1, t));
  for (let i = 0; i < colormap.length - 1; i++) {
    const c0 = colormap[i];
    const c1 = colormap[i + 1];
    if (ct >= c0.stop && ct <= c1.stop) {
      const lt = (c1.stop - c0.stop) === 0 ? 0 : (ct - c0.stop) / (c1.stop - c0.stop);
      return [
        Math.round(c0.r + (c1.r - c0.r) * lt),
        Math.round(c0.g + (c1.g - c0.g) * lt),
        Math.round(c0.b + (c1.b - c0.b) * lt),
      ];
    }
  }
  const last = colormap[colormap.length - 1];
  return [last.r, last.g, last.b];
}

export interface GridData {
  shape: number[];
  values: number[];
  dtype?: string;
}

/**
 * Parse a numpy .npy binary blob client-side.
 *
 * We fetch with `?format=npy` (raw octet-stream) instead of `?format=json`
 * because the JSON path on the server expands every value to decimal text —
 * a 31×512×512 flood series is ~32 MB raw but ~150 MB of JSON text. Binary
 * is ~5× smaller on the wire and zero-copy into the client typed array.
 */
function parseNpyBuffer(buf: ArrayBuffer): GridData | null {
  try {
    const view = new DataView(buf);
    const magic = String.fromCharCode(
      view.getUint8(0), view.getUint8(1), view.getUint8(2),
      view.getUint8(3), view.getUint8(4), view.getUint8(5),
    );
    if (magic !== '\x93NUMPY') return null;
    const major = view.getUint8(6);
    const headerLen = major >= 2 ? view.getUint32(8, true) : view.getUint16(8, true);
    const headerStart = major >= 2 ? 12 : 10;
    const headerStr = new TextDecoder('latin1').decode(new Uint8Array(buf, headerStart, headerLen));
    const dtypeMatch = headerStr.match(/'descr':\s*'([^']+)'/);
    const shapeMatch = headerStr.match(/'shape':\s*\(([^)]+)\)/);
    if (!dtypeMatch || !shapeMatch) return null;
    const dtype = dtypeMatch[1];
    const shape = shapeMatch[1].split(',').filter(s => s.trim() !== '').map(Number);
    const dataStart = headerStart + headerLen;
    const dataBuf = buf.slice(dataStart);

    let values: number[] | Float32Array | Float64Array | Int32Array | Int16Array | Uint16Array;
    if (dtype === '<f4' || dtype === 'float32') {
      values = new Float32Array(dataBuf);
    } else if (dtype === '<f8' || dtype === 'float64') {
      values = new Float64Array(dataBuf);
    } else if (dtype === '<i4' || dtype === 'int32') {
      values = new Int32Array(dataBuf);
    } else if (dtype === '<i2' || dtype === 'int16') {
      values = new Int16Array(dataBuf);
    } else if (dtype === '<u2' || dtype === 'uint16') {
      values = new Uint16Array(dataBuf);
    } else {
      return null;
    }
    // Down-convert to number[] to match the GridData contract callers use.
    return { shape, values: Array.from(values), dtype };
  } catch {
    return null;
  }
}

export async function fetchGrid(jobId: string, name: string, signal?: AbortSignal): Promise<GridData | null> {
  const resp = await fetch(`/api/kaggle/simulate/${jobId}/grid/${name}`, { signal });
  if (!resp.ok) return null;
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    // Server sends JSON {shape, dtype, values} — convert to GridData.
    const json = await resp.json();
    return json as GridData;
  }
  const buf = await resp.arrayBuffer();
  return parseNpyBuffer(buf);
}

/** Fetch simulation metadata (metadata.json) so we can read cell_size_m. */
export async function fetchSimMeta(jobId: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const resp = await fetch(`/api/kaggle/simulate/${jobId}/results`, { signal });
  if (!resp.ok) return null;
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

/**
 * Resolve the physical grid cell size in meters.
 * Prefers the kernel's own value from metadata, falls back to the type map.
 */
export function resolveCellSizeM(type: string, meta: Record<string, unknown> | null): number {
  const params = (meta?.params ?? {}) as Record<string, unknown>;
  const m = Number(params.cell_size_m ?? meta?.cell_size_m ?? 0);
  if (m > 0) return m;
  return SIM_CELL_SIZE_M[type] ?? 20;
}

/** Domain extent in km for a grid with `size` cells at `cellSizeM` meters each. */
export function extentKm(size: number, cellSizeM: number): number {
  return (size * cellSizeM) / 1000;
}

/** Rectangle (lat/lon) for a square overlay centered at (lat, lon). */
export function computeGridRectangle(lat: number, lon: number, km: number): Cesium.Rectangle {
  const halfKm = km / 2;
  const latDelta = halfKm / 111.0;
  const lonDelta = halfKm / (111.0 * Math.cos(lat * Math.PI / 180));
  return Cesium.Rectangle.fromDegrees(
    lon - lonDelta,
    lat - latDelta,
    lon + lonDelta,
    lat + latDelta,
  );
}

export interface BuildCanvasOptions {
  size: number;
  values: number[];
  colormap: ColorStop[];
  /** Below this value pixels are transparent (no-data). Default 0.01. */
  nodata?: number;
  /** Fixed max value for normalization; defaults to computed max. */
  maxValue?: number;
  /** Ignore values above maxValue when computing the auto max. */
  clampMax?: boolean;
  alphaMin?: number;
  alphaMax?: number;
}

/** Rasterize a value grid into a colored canvas using a colormap. */
export function buildColoredCanvas(opts: BuildCanvasOptions): HTMLCanvasElement {
  const {
    size,
    values,
    colormap,
    nodata = 0.01,
    alphaMin = 80,
    alphaMax = 220,
  } = opts;

  let maxValue = opts.maxValue ?? 0;
  if (!opts.maxValue) {
    for (let i = 0; i < values.length; i++) {
      const v = isFinite(values[i]) ? values[i] : 0;
      if (v > maxValue) maxValue = v;
    }
    if (opts.clampMax && opts.maxValue && maxValue > opts.maxValue) maxValue = opts.maxValue;
  }
  if (maxValue === 0) maxValue = 1;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);

  for (let idx = 0; idx < size * size; idx++) {
    const v = isFinite(values[idx]) ? values[idx] : 0;
    const pi = idx * 4;
    if (v < nodata) {
      image.data[pi] = 0;
      image.data[pi + 1] = 0;
      image.data[pi + 2] = 0;
      image.data[pi + 3] = 0;
      continue;
    }
    const t = Math.min(v / maxValue, 1.0);
    const [r, g, b] = interpolateColormap(colormap, t);
    image.data[pi] = r;
    image.data[pi + 1] = g;
    image.data[pi + 2] = b;
    image.data[pi + 3] = Math.round(alphaMin + t * (alphaMax - alphaMin));
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Add a colored canvas as a SingleTileImageryProvider layer and return it. */
export function addCanvasLayer(
  viewer: Cesium.Viewer,
  canvas: HTMLCanvasElement,
  rect: Cesium.Rectangle,
  layerOpacity: number,
  name: string,
): Cesium.ImageryLayer {
  const url = canvas.toDataURL('image/png');
  const provider = new Cesium.SingleTileImageryProvider({
    url,
    rectangle: rect,
    tileWidth: canvas.width,
    tileHeight: canvas.height,
  });
  const layer = viewer.scene.imageryLayers.addImageryProvider(provider);
  layer.alpha = layerOpacity;
  (layer as unknown as { name: string }).name = name;
  return layer;
}

// ═════════════════════════════════════════════════════════════════
// SNAPSHOT ANIMATION HELPERS
// ═════════════════════════════════════════════════════════════════

export interface FrameSeries {
  /** [frames, rows, cols] */
  shape: number[];
  values: number[];
  times: number[];
  frames: number;
  rows: number;
  cols: number;
}

/** Extract the flat 2D slice (rows*cols) for a given frame from a 3D snapshot array. */
export function sliceFrame(series: GridData, frame: number): number[] {
  const [frames, rows, cols] = series.shape;
  const perFrame = rows * cols;
  const f = Math.max(0, Math.min(frames - 1, frame));
  return series.values.slice(f * perFrame, (f + 1) * perFrame);
}

/** Normalize a GridData series into a usable FrameSeries. */
export function toFrameSeries(
  series: GridData | null,
  times: number[],
  _fallbackRows: number,
  _fallbackCols: number,
): FrameSeries | null {
  if (!series || series.shape.length < 3) return null;
  const [frames, rows, cols] = series.shape;
  return {
    shape: series.shape,
    values: series.values,
    times: times.length === frames ? times : times.map((_, i) => i),
    frames,
    rows,
    cols,
  };
}

export interface ArrowOptions {
  gs: number;
  vx: number[];
  vy: number[];
  /** Optional per-cell magnitude override (defaults to sqrt(vx²+vy²)). */
  mag?: number[];
  maxMag?: number;
  stride?: number;
  minMag?: number;
  maxLenPx?: number;
}

/** Rasterize velocity vectors into an arrow canvas sized gs×gs. */
export function buildArrowsCanvas(opts: ArrowOptions): HTMLCanvasElement {
  const {
    gs, vx, vy, mag,
    stride = Math.max(2, Math.floor(gs / 32)),
    minMag = 0.05,
    maxLenPx = 20,
  } = opts;

  let maxVel = opts.maxMag ?? 0;
  for (let i = 0; i < gs * gs; i++) {
    const m = isFinite(mag ? mag[i] : 0) ? (mag ? mag[i] : 0) : 0;
    const vm = m > 0 ? m : Math.sqrt((isFinite(vx[i]) ? vx[i] : 0) ** 2 + (isFinite(vy[i]) ? vy[i] : 0) ** 2);
    if (vm > maxVel) maxVel = vm;
  }
  if (maxVel === 0) maxVel = 1;

  const canvas = document.createElement('canvas');
  canvas.width = gs;
  canvas.height = gs;
  const ctx = canvas.getContext('2d')!;

  for (let row = 0; row < gs; row += stride) {
    for (let col = 0; col < gs; col += stride) {
      const idx = row * gs + col;
      const vxCell = isFinite(vx[idx]) ? vx[idx] : 0;
      const vyCell = isFinite(vy[idx]) ? vy[idx] : 0;
      const velMag = Math.sqrt(vxCell * vxCell + vyCell * vyCell);
      if (velMag < minMag) continue;

      const dirX = vxCell / velMag;
      const dirY = vyCell / velMag;
      const arrowLen = Math.min(maxLenPx, 4 + (velMag / maxVel) * 16);

      const t = Math.min(velMag / maxVel, 1);
      ctx.strokeStyle = `rgba(255, ${Math.round(220 - t * 120)}, ${Math.round(120 - t * 60)}, 0.85)`;
      ctx.lineWidth = Math.max(1, 2 - t);
      ctx.lineCap = 'round';

      const cx = col + 0.5;
      const cy = row + 0.5;
      const ex = cx + dirX * arrowLen;
      const ey = cy + dirY * arrowLen;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      const headLen = 3;
      const angle = Math.atan2(dirY, dirX);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - headLen * Math.cos(angle - 0.4), ey - headLen * Math.sin(angle - 0.4));
      ctx.lineTo(ex - headLen * Math.cos(angle + 0.4), ey - headLen * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fillStyle = `rgba(255, ${Math.round(220 - t * 120)}, ${Math.round(120 - t * 60)}, 0.85)`;
      ctx.fill();
    }
  }
  return canvas;
}

/** Draw a boundary outline rectangle for the simulation domain. */
export function addDomainBoundary(
  viewer: Cesium.Viewer,
  rect: Cesium.Rectangle,
  color: Cesium.Color = Cesium.Color.fromCssColorString('rgba(255,180,60,1.0)'),
): Cesium.Entity {
  return viewer.entities.add({
    rectangle: {
      coordinates: rect,
      material: Cesium.Color.WHITE.withAlpha(0.0),
      outline: true,
      outlineColor: color,
      outlineWidth: 2,
      height: 0,
    },
  });
}
