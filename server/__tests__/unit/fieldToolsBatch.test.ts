import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

describe('Tool 81 — Stream Power', () => {
  it('worked example: K=0.001, A=1e6, m=0.5, S=0.01 → E=0.01', () => {
    const res = computeEquation(81, { K: 0.001, A: 1e6, m: 0.5, S: 0.01 });
    expect(res!.result).toBeCloseTo(0.001 * Math.pow(1e6, 0.5) * 0.01, 6);
  });
  it('higher slope → higher erosion', () => {
    const r1 = computeEquation(81, { K: 0.001, A: 1e6, m: 0.5, S: 0.01 });
    const r2 = computeEquation(81, { K: 0.001, A: 1e6, m: 0.5, S: 0.05 });
    expect(r2!.result).toBeGreaterThan(r1!.result);
  });
  it('return honest NaN when inputs are missing', () => {
    const res = computeEquation(81, { K: NaN, A: NaN, m: NaN, S: NaN });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('does NOT throw on string inputs', () => {
    const res = computeEquation(81, { K: '0.001', A: '1e6', m: '0.5', S: '0.01' } as any);
    expect(Number.isFinite(res!.result)).toBe(true);
  });
});

// ── Tool 86 — Stream Power Index (Moore et al. 1991) ─────────────────
// SPI = ln(A_s·tanβ). Worked example: A_s=100, tanβ=0.1 → SPI=ln(10)=2.30

describe('Tool 86 — SPI', () => {
  it('A_s=100, tanβ=0.1 → SPI=2.30', () => {
    expect(computeEquation(86, { As: 100, tanB: 0.1 })!.result).toBeCloseTo(Math.log(10), 6);
  });
  it('honest NaN on missing inputs', () => {
    expect(Number.isNaN(computeEquation(86, { As: NaN, tanB: NaN })!.result)).toBe(true);
  });
});

// ── Tool 87 — Topographic Wetness Index (Beven & Kirkby 1979) ────────
// TWI = ln(A_s/tanβ). Worked example: A_s=100, tanβ=0.1 → TWI=ln(1000)=6.91

describe('Tool 87 — TWI', () => {
  it('A_s=100, tanβ=0.1 → TWI=6.91', () => {
    expect(computeEquation(87, { As: 100, tanB: 0.1 })!.result).toBeCloseTo(Math.log(1000), 6);
  });
  it('honest NaN on missing inputs', () => {
    expect(Number.isNaN(computeEquation(87, { As: NaN, tanB: NaN })!.result)).toBe(true);
  });
});

// ── Tool 103 — Reynolds Decomposition (Reynolds 1895) ─────────────────
// u = ū + u'. Worked example: ū=10, u'=2 → u=12

describe('Tool 103 — Reynolds Decomposition', () => {
  it('ū=10, u\'=2 → u=12', () => {
    expect(computeEquation(103, { ubar: 10, uprime: 2 })!.result).toBeCloseTo(12, 9);
  });
  it('honest NaN on missing', () => {
    expect(Number.isNaN(computeEquation(103, { ubar: NaN, uprime: NaN })!.result)).toBe(true);
  });
});

// ── Tool 106 — Frontogenesis (Petterssen 1936) ───────────────────────
// F = |∇θ|·(D·cos2β−δ) + cosβ·|∂u/∂s|·|∇θ|.

describe('Tool 106 — Frontogenesis', () => {
  it('works with typical deformation values', () => {
    const res = computeEquation(106, { dtheta: 0.01, D: 1e-5, cos2b: 0.5, delta: 0.5, dB: 0, dudy: 1e-3 });
    expect(Number.isFinite(res!.result)).toBe(true);
    expect(res!.unit).toBe('K/s');
  });
  it('honest NaN on missing', () => {
    expect(Number.isNaN(computeEquation(106, { dtheta: NaN, D: NaN, cos2b: NaN, delta: NaN, dB: NaN, dudy: NaN })!.result)).toBe(true);
  });
});

// ── Tool 118 — Joule Heating (Cowley 1982) ───────────────────────────
// Q = J·E. Worked example: J=1e-6, E=0.01 → Q=1e-8 W/m³

describe('Tool 118 — Joule Heating', () => {
  it('J=1e-6, E=0.01 → Q=1e-8 W/m³', () => {
    expect(computeEquation(118, { J: 1e-6, E: 0.01 })!.result).toBeCloseTo(1e-8, 12);
  });
  it('exposes conductivity as secondary', () => {
    const sec = computeEquation(118, { J: 1e-6, E: 0.01 })!.secondary ?? [];
    expect(sec.find((s) => s.key === 'conductivity')?.value).toBeCloseTo(1e-4, 6);
  });
  it('honest NaN on missing', () => {
    expect(Number.isNaN(computeEquation(118, { J: NaN, E: NaN })!.result)).toBe(true);
  });
  it('string coercion works', () => {
    expect(Number.isFinite(computeEquation(118, { J: '1e-6', E: '0.01' } as any)!.result)).toBe(true);
  });
});