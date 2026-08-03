/**
 * fieldData.ts — pure data layer for all GPU-animated hazard primitives.
 *
 * Zero Cesium imports, zero WebGL. Everything here is unit-testable under Vitest.
 * Provides: WGS84 geodesy, GPU texture packing (scalar atlas, vector atlas),
 * CPU bilinear sampling (particles), and bilinear upsampling (terrain).
 */

import type { GridData } from '../shared';

// ── WGS84 geodesy ─────────────────────────────────────────────────────────────

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export interface Vec3 { x: number; y: number; z: number }

export interface GeoFrame {
  centerLat: number;
  centerLon: number;
  cellSizeM: number;
  gs: number;
  domainM: number;
  east: Vec3;
  north: Vec3;
  up: Vec3;
  centerECEF: Vec3;
}

/** Geodetic lat/lon (degrees) + height above ellipsoid (m) → ECEF. */
export function geodeticToECEF(latDeg: number, lonDeg: number, h = 0): Vec3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (N + h) * cosLat * Math.cos(lon),
    y: (N + h) * cosLat * Math.sin(lon),
    z: (N * (1 - WGS84_E2) + h) * sinLat,
  };
}

/** Build the ENU basis + ECEF origin of a square domain. */
export function buildGeoFrame(
  centerLat: number,
  centerLon: number,
  gs: number,
  cellSizeM: number,
): GeoFrame {
  const lat = (centerLat * Math.PI) / 180;
  const lon = (centerLon * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  return {
    centerLat,
    centerLon,
    gs,
    cellSizeM,
    domainM: gs * cellSizeM,
    east: { x: -sinLon, y: cosLon, z: 0 },
    north: { x: -sinLat * cosLon, y: -sinLat * sinLon, z: cosLat },
    up: { x: cosLat * cosLon, y: cosLat * sinLon, z: sinLat },
    centerECEF: geodeticToECEF(centerLat, centerLon, 0),
  };
}

/** Local east/north/up meters → world ECEF. */
export function localToECEF(frame: GeoFrame, e: number, n: number, u: number): Vec3 {
  return {
    x: frame.centerECEF.x + frame.east.x * e + frame.north.x * n + frame.up.x * u,
    y: frame.centerECEF.y + frame.east.y * e + frame.north.y * n + frame.up.y * u,
    z: frame.centerECEF.z + frame.east.z * e + frame.north.z * n + frame.up.z * u,
  };
}

/** Grid cell (col,row), row 0 = north edge, + local height → ECEF. */
export function cellToWorld(frame: GeoFrame, col: number, row: number, h = 0): Vec3 {
  const e = (col - frame.gs / 2 + 0.5) * frame.cellSizeM;
  const n = (frame.gs / 2 - row - 0.5) * frame.cellSizeM;
  return localToECEF(frame, e, n, h);
}

/** Approximate lat/lon of a cell center (for terrain sampling). */
export function cellToLatLon(
  frame: GeoFrame,
  col: number,
  row: number,
): { lat: number; lon: number } {
  const e = (col - frame.gs / 2 + 0.5) * frame.cellSizeM;
  const n = (frame.gs / 2 - row - 0.5) * frame.cellSizeM;
  const degN = n / 111132.0;
  const degE = e / (111320.0 * Math.max(0.01, Math.cos((frame.centerLat * Math.PI) / 180)));
  return { lat: frame.centerLat + degN, lon: frame.centerLon + degE };
}

/**
 * Compute per-vertex normals of a heightfield via central differences.
 * `elevation` is meters at [r*gs+c]; returns Float32Array of 3*gs*gs.
 */
export function heightfieldNormals(
  elevation: ArrayLike<number>,
  gs: number,
  cellSizeM: number,
): Float32Array {
  const out = new Float32Array(gs * gs * 3);
  const e = (r: number, c: number) => {
    const v = elevation[Math.max(0, Math.min(gs - 1, r)) * gs + Math.max(0, Math.min(gs - 1, c))];
    return Number.isFinite(v) ? v : 0;
  };
  for (let r = 0; r < gs; r++) {
    for (let c = 0; c < gs; c++) {
      const dX = (e(r, c + 1) - e(r, c - 1)) / (2 * cellSizeM);
      const dY = (e(r + 1, c) - e(r - 1, c)) / (2 * cellSizeM);
      // Normal = normalize(-dX, dY, 1) — y flipped because row+ is south.
      let nx = -dX, ny = dY, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (r * gs + c) * 3;
      out[i] = nx / len;
      out[i + 1] = ny / len;
      out[i + 2] = nz / len;
    }
  }
  return out;
}

// ── GPU texture atlas packing ─────────────────────────────────────────────────

export interface TextureAtlasBase {
  width: number;
  height: number;
  tilesX: number;
  tilesY: number;
  frames: number;
  data: Uint8Array; // RGBA8, LINEAR-filterable everywhere
}

export interface ScalarAtlas extends TextureAtlasBase {
  min: number;
  max: number;
}

/**
 * Pack a [F,R,C] scalar series → one RGBA8 atlas tile sheet.
 * Red channel carries (v-min)/(max-min), G/B unused, A=255.
 *
 * `packScalarAtlas` is the generic name. `packSeries` is kept as a backwards-
 * compatible alias for the earlier draft API.
 */
export function packScalarAtlas(series: GridData): ScalarAtlas {
  const [F, R, C] = series.shape;
  const N = R * C;
  const tilesX = Math.ceil(Math.sqrt(F));
  const tilesY = Math.ceil(F / tilesX);
  const width = tilesX * C;
  const height = tilesY * R;
  const data = new Uint8Array(width * height * 4);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < series.values.length; i++) {
    const v = series.values[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max) || max === min) max = min + 1;
  const inv = 1 / (max - min);

  for (let f = 0; f < F; f++) {
    const offX = (f % tilesX) * C;
    const offY = Math.floor(f / tilesX) * R;
    const base = f * N;
    for (let r = 0; r < R; r++) {
      let ptr = ((offY + r) * width + offX) * 4;
      for (let c = 0; c < C; c++) {
        const v = series.values[base + r * C + c];
        const t = Number.isFinite(v) ? (v - min) * inv : 0;
        data[ptr] = Math.round(Math.max(0, Math.min(1, t)) * 255);
        data[ptr + 3] = 255;
        ptr += 4;
      }
    }
  }
  return { width, height, tilesX, tilesY, frames: F, data, min, max };
}

/** Alias kept for compatibility with existing draft usage. */
export function packSeries(series: GridData, channels = 1): ScalarAtlas {
  void channels;
  return packScalarAtlas(series);
}

export interface VelocityAtlas extends TextureAtlasBase {
  maxSpeed: number;
}

/**
 * Pack [F,R,C] vx + vy series → one RGBA8 atlas tile sheet.
 * R = vx/maxSpeed*0.5+0.5, G = vy/maxSpeed*0.5+0.5, B = |v|/maxSpeed.
 */
export function packVelocityAtlas(vx: GridData, vy: GridData): VelocityAtlas {
  const [F, R, C] = vx.shape;
  const N = R * C;
  const tilesX = Math.ceil(Math.sqrt(F));
  const tilesY = Math.ceil(F / tilesX);
  const width = tilesX * C;
  const height = tilesY * R;
  const data = new Uint8Array(width * height * 4);

  let maxSpeed = 0;
  for (let i = 0; i < F * N; i++) {
    const x = vx.values[i];
    const y = vy.values[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const m = Math.hypot(x, y);
    if (m > maxSpeed) maxSpeed = m;
  }
  if (maxSpeed === 0) maxSpeed = 1;
  const inv = 1 / maxSpeed;

  for (let f = 0; f < F; f++) {
    const offX = (f % tilesX) * C;
    const offY = Math.floor(f / tilesX) * R;
    const base = f * N;
    for (let r = 0; r < R; r++) {
      let ptr = ((offY + r) * width + offX) * 4;
      for (let c = 0; c < C; c++) {
        const i = base + r * C + c;
        const x = vx.values[i];
        const y = vy.values[i];
        if (Number.isFinite(x) && Number.isFinite(y)) {
          data[ptr] = Math.round((x * inv * 0.5 + 0.5) * 255);
          data[ptr + 1] = Math.round((y * inv * 0.5 + 0.5) * 255);
          data[ptr + 2] = Math.round(Math.min(1, Math.hypot(x, y) * inv) * 255);
        }
        data[ptr + 3] = 255;
        ptr += 4;
      }
    }
  }
  return { width, height, tilesX, tilesY, frames: F, data, maxSpeed };
}

// ── CPU bilinear sampling (particles + stats) ────────────────────────────────

/**
 * Bilinear interpolation of a [rows,cols] grid at fractional (row, col).
 * Out-of-range returns 0; non-finite texels are treated as 0.
 */
export function sampleBilinear(
  grid: ArrayLike<number>,
  rows: number,
  cols: number,
  row: number,
  col: number,
): number {
  if (row < 0 || col < 0 || row > rows - 1 || col > cols - 1) return 0;
  const r0 = Math.floor(row);
  const c0 = Math.floor(col);
  const r1 = Math.min(rows - 1, r0 + 1);
  const c1 = Math.min(cols - 1, c0 + 1);
  const fr = row - r0;
  const fc = col - c0;
  const g00 = numberOr(grid[r0 * cols + c0], 0);
  const g01 = numberOr(grid[r0 * cols + c1], 0);
  const g10 = numberOr(grid[r1 * cols + c0], 0);
  const g11 = numberOr(grid[r1 * cols + c1], 0);
  return (
    g00 * (1 - fr) * (1 - fc) +
    g01 * (1 - fr) * fc +
    g10 * fr * (1 - fc) +
    g11 * fr * fc
  );
}

function numberOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Bilinear upsample a coarse [rows,cols] grid to [outRows,outCols].
 * Used to refine low-resolution terrain samples to render resolution.
 */
export function bilinearUpsample(
  src: ArrayLike<number>,
  rows: number,
  cols: number,
  outRows: number,
  outCols: number,
): Float32Array {
  if (rows === outRows && cols === outCols) {
    const out = new Float32Array(rows * cols);
    for (let i = 0; i < src.length; i++) out[i] = numberOr(src[i], 0);
    return out;
  }
  const out = new Float32Array(outRows * outCols);
  const rScale = (rows - 1) / Math.max(1, outRows - 1);
  const cScale = (cols - 1) / Math.max(1, outCols - 1);
  for (let r = 0; r < outRows; r++) {
    for (let c = 0; c < outCols; c++) {
      out[r * outCols + c] = sampleBilinear(src, rows, cols, r * rScale, c * cScale);
    }
  }
  return out;
}

/** Extract frame f from a [F,R,C] series as a flat Float32Array of length R*C. */
export function extractFrame(series: GridData, f: number): Float32Array {
  const [F, R, C] = series.shape;
  const N = R * C;
  const idx = Math.max(0, Math.min(F - 1, f));
  const src = series.values;
  const out = new Float32Array(N);
  const base = idx * N;
  for (let i = 0; i < N; i++) out[i] = numberOr(src[base + i], 0);
  return out;
}

// ── GLSL atlas helper shared by every shader ────────────────────────────────

/** GLSL: compute atlas UV from tile coords + cell-local st. */
export const ATLAS_UV_GLSL = /* glsl */ `
  vec2 kaggleAtlasUV(float frame, vec2 tiles, vec2 st) {
    float f = floor(frame + 0.5);
    float col = mod(f, tiles.x);
    float row = floor(f / tiles.x);
    return (vec2(col, row) + st) / tiles;
  }
`;
