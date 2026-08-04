/**
 * Unit tests for the pure data layer in src/components/kaggle/gpu/fieldData.ts.
 * No Cesium required — tests stay strictly about math.
 */

import { describe, expect, it } from 'vitest';
import {
  buildGeoFrame,
  cellToWorld,
  cellToLatLon,
  geodeticToECEF,
  heightfieldNormals,
  packScalarAtlas,
  packVelocityAtlas,
  sampleBilinear,
  bilinearUpsample,
  extractFrame,
  type GeoFrame,
} from '../components/kaggle/gpu/fieldData';

describe('geo math', () => {
  const frame: GeoFrame = buildGeoFrame(29.76, -95.37, 64, 100);

  it('geodeticToECEF lies on WGS84 surface (|r| ≈ 6378137 at equator)', () => {
    const e = geodeticToECEF(0, 0);
    const r = Math.hypot(e.x, e.y, e.z);
    expect(r).toBeCloseTo(6378137.0, 4);
  });

  it('buildGeoFrame axes are orthonormal', () => {
    const dotEN = frame.east.x * frame.north.x + frame.east.y * frame.north.y + frame.east.z * frame.north.z;
    const dotEU = frame.east.x * frame.up.x + frame.east.y * frame.up.y + frame.east.z * frame.up.z;
    const dotNU = frame.north.x * frame.up.x + frame.north.y * frame.up.y + frame.north.z * frame.up.z;
    expect(Math.abs(dotEN)).toBeLessThan(1e-9);
    expect(Math.abs(dotEU)).toBeLessThan(1e-9);
    expect(Math.abs(dotNU)).toBeLessThan(1e-9);
  });

  it('cellToWorld reproduces degrees near center (δ < 0.01°/cell)', () => {
    const w = cellToWorld(frame, 32, 32);
    const carto = cellToLatLon(frame, 32, 32);
    expect(carto.lat).toBeCloseTo(29.76, 2);
    expect(carto.lon).toBeCloseTo(-95.37, 2);
    expect(w.x).not.toBe(0);
  });

  it('heightfieldNormals: plane returns vertical-ish normals', () => {
    const gs = 4;
    const elev = new Float32Array(gs * gs).fill(10);
    const n = heightfieldNormals(elev, gs, 100);
    for (let i = 0; i < gs * gs; i++) {
      const x = n[i * 3], y = n[i * 3 + 1], z = n[i * 3 + 2];
      const l = Math.hypot(x, y, z);
      expect(z / l).toBeCloseTo(1, 6);
      expect(Math.hypot(x, y)).toBeLessThan(0.001);
    }
  });
});

describe('GPU texture atlas packing', () => {
  const [F, R, C] = [12, 4, 4];
  const series = {
    shape: [F, R, C],
    values: Array.from({ length: F * R * C }, (_, i) => i * 0.1),
  } as const;

  it('packScalarAtlas normalizes correctly', () => {
    const atlas = packScalarAtlas(series as never);
    expect(atlas.frames).toBe(F);
    expect(atlas.max).toBeCloseTo((F * R * C - 1) * 0.1, 6);
    expect(atlas.min).toBeCloseTo(0, 6);
    expect(atlas.data.length).toBe(atlas.width * atlas.height * 4);

    // sanity: value index from frame 5 (col 1 row 0 for sqrt(12)=4 tiles)
    // The normalized value at index world_idx = 5*16+3 is (world_idx*0.1 - min)/(max - min)
    const val = (5 * 16 + 3) * 0.1;
    const nv = (val - atlas.min) / (atlas.max - atlas.min);
    const tileOffY = 1 * 4;
    const tileOffX = (5 % 4) * 4;
    const p = ((tileOffY + 0) * atlas.width + (tileOffX + 3)) * 4;
    expect(atlas.data[p]).toBeCloseTo(Math.round(nv * 255), 1);
  });

  it('packVelocityAtlas encodes vx,vy,magnitude in RGB', () => {
    const [vF, vR, vC] = [3, 2, 2];
    const vx = { shape: [vF, vR, vC], values: new Array(vF * vR * vC).fill(2) } as const;
    const vy = { shape: [vF, vR, vC], values: new Array(vF * vR * vC).fill(0) } as const;
    const atlas = packVelocityAtlas(vx as never, vy as never);
    expect(atlas.maxSpeed).toBeCloseTo(2, 6);
    // at frame 0 cell (0,0): R = 2/2*0.5+0.5 = 1 → 255, G = 0.5*255=128, B = |2|/2=1→255
    const p = 0;
    expect(atlas.data[p]).toBe(255);
    expect(atlas.data[p + 1]).toBe(128);
    expect(atlas.data[p + 2]).toBe(255);
  });
});

describe('CPU bilinear sampling', () => {
  const grid = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const rows = 3; const cols = 3;

  it('bilinear matches formula', () => {
    expect(sampleBilinear(grid, rows, cols, 0, 0)).toBe(0);
    expect(sampleBilinear(grid, rows, cols, 2, 2)).toBe(8);
    expect(sampleBilinear(grid, rows, cols, 1, 1)).toBe(4);
    expect(sampleBilinear(grid, rows, cols, 0.5, 0.5)).toBeCloseTo(2, 4);
    expect(sampleBilinear(grid, rows, cols, 1.5, 0.5)).toBeCloseTo(5, 4);
  });

  it('bilinearUpsample 2×2 → 3×3 matches corner-preserved grid', () => {
    const src = [0, 10, 20, 30];
    const out = bilinearUpsample(src, 2, 2, 3, 3);
    // 2x2 source is a simple bilinear gradient [[0,10],[20,30]]
    // 3x3 output should interpolate:
    // 0   5   10
    // 10  15  20
    // 20  25  30
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(5);
    expect(out[2]).toBeCloseTo(10);
    expect(out[3]).toBeCloseTo(10);
    expect(out[4]).toBeCloseTo(15);
    expect(out[5]).toBeCloseTo(20);
    expect(out[6]).toBeCloseTo(20);
    expect(out[7]).toBeCloseTo(25);
    expect(out[8]).toBeCloseTo(30);
  });

  it('extractFrame slices correctly', () => {
    const [f, rr, cc] = [2, 2, 2];
    const s = {
      shape: [f, rr, cc],
      values: [0, 1, 2, 3, 10, 11, 12, 13],
    };
    expect(extractFrame(s as never, 0)).toEqual(Float32Array.from([0, 1, 2, 3]));
    expect(extractFrame(s as never, 1)).toEqual(Float32Array.from([10, 11, 12, 13]));
  });
});
