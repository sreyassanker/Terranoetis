import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Field/Spectral tools — honest NaN + correctness after default de-fabrication ──

// Tool 26 — NDVI: (NIR−Red)/(NIR+Red)
describe('Tool 26 — NDVI', () => {
  it('worked example: NIR=0.3, Red=0.1 → NDVI = 0.5', () => {
    const res = computeEquation(26, { NIR: 0.3, Red: 0.1 });
    expect(res!.result).toBeCloseTo(0.5, 9);
  });
  it('returns honest NaN when genuine reflectance is missing', () => {
    const res = computeEquation(26, { NIR: Number.NaN, Red: Number.NaN });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});

// Tool 27 — McFeeters NDWI: (Green−NIR)/(Green+NIR)
describe('Tool 27 — McFeeters NDWI', () => {
  it('worked example: Green=0.2, NIR=0.3 → NDWI = −0.2', () => {
    const res = computeEquation(27, { Green: 0.2, NIR: 0.3 });
    expect(res!.result).toBeCloseTo(-0.2, 9);
  });
  it('returns honest NaN when reflectance is missing', () => {
    const res = computeEquation(27, { Green: Number.NaN, NIR: Number.NaN });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});

// Tool 28 — Gao NDWI (NIR−SWIR)/(NIR+SWIR)
describe('Tool 28 — Gao NDWI', () => {
  it('worked example: NIR=0.3, SWIR=0.1 → NDWI = 0.5', () => {
    const res = computeEquation(28, { NIR: 0.3, SWIR: 0.1 });
    expect(res!.result).toBeCloseTo(0.5, 9);
  });
});

// Tool 29 — EVI: 2.5·(NIR−Red)/(NIR+6·Red−7.5·Blue+1)
describe('Tool 29 — EVI', () => {
  it('worked example: NIR=0.3, Red=0.1, Blue=0.05 → EVI ≈ 0.447', () => {
    const res = computeEquation(29, { NIR: 0.3, Red: 0.1, Blue: 0.05 });
    const expected = 2.5 * (0.3 - 0.1) / (0.3 + 6 * 0.1 - 7.5 * 0.05 + 1);
    expect(res!.result).toBeCloseTo(expected, 6);
  });
});

// Tool 30 — NDSI (Green−SWIR)/(Green+SWIR)
describe('Tool 30 — NDSI', () => {
  it('worked example: Green=0.2, SWIR=0.1 → NDSI = 0.333', () => {
    const res = computeEquation(30, { Green: 0.2, SWIR: 0.1 });
    expect(res!.result).toBeCloseTo(0.333, 2);
  });
  it('returns honest NaN when reflectance is missing', () => {
    const res = computeEquation(30, { Green: Number.NaN, SWIR: Number.NaN });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});

// Tool 31 — NBR (NIR−SWIR)/(NIR+SWIR)
describe('Tool 31 — NBR', () => {
  it('worked example: NIR=0.3, SWIR=0.1 → NBR = 0.5', () => {
    const res = computeEquation(31, { NIR: 0.3, SWIR: 0.1 });
    expect(res!.result).toBeCloseTo(0.5, 9);
  });
});

// Tool 78 — Airy wave dispersion: ω² = g·k·tanh(kh)
describe('Tool 78 — Airy Wave Dispersion', () => {
  it('worked example: g=9.81, k=0.1, h=10 → ω ≈ 0.864', () => {
    const res = computeEquation(78, { g: 9.81, k: 0.1, h: 10 });
    expect(res!.result).toBeCloseTo(Math.sqrt(9.81 * 0.1 * Math.tanh(0.1 * 10)), 6);
  });
  it('shallow-water limit: ω → √(gh)·k', () => {
    const res = computeEquation(78, { g: 9.81, k: 0.01, h: 1 });
    const shallow = Math.sqrt(9.81 * 1) * 0.01;
    expect(res!.result).toBeCloseTo(shallow, 4);
  });
  it('returns honest NaN when depth is missing', () => {
    const res = computeEquation(78, { g: 9.81, k: 0.1, h: Number.NaN });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});
