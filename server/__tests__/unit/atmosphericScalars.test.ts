import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

describe('Tool 2 — Planck Radiation Law', () => {
  it('worked example: λ=10, T=300 → B ≈ 9.92e6', () => {
    const res = computeEquation(2, { lambda: 10, T: 300 });
    expect(res).not.toBeNull();
    const h = 6.62607015e-34, c = 299792458, k = 1.380649e-23;
    const lamM = 10e-6;
    const x = (h * c) / (lamM * k * 300);
    expect(res!.result).toBeCloseTo((2 * h * c ** 2) / lamM ** 5 * 1 / (Math.exp(x) - 1), 4);
    expect(res!.unit).toBe('W·sr⁻¹·m⁻³');
  });
  it('exposes wien_peak and total_exitance as secondary', () => {
    const sec = computeEquation(2, { lambda: 10, T: 300 })!.secondary ?? [];
    const wien = sec.find((s) => s.key === 'wien_peak');
    const exit = sec.find((s) => s.key === 'total_exitance');
    expect(wien?.value).toBeCloseTo(2897.771955 / 300, 6);
    expect(exit?.value).toBeCloseTo(5.670374419e-8 * 300 ** 4, 6);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(2, { lambda: '10', T: '300' } as any)!.result)).toBe(true);
  });
  it('honest NaN on missing', () => {
    expect(Number.isNaN(computeEquation(2, { lambda: NaN, T: NaN })!.result)).toBe(true);
  });
});

// ── Tool 3 — Saturation Vapor Pressure (Magnus-Tetens) ───────────────
// e_s(T) = 6.1094·exp(17.625·T/(T+243.04)). Worked example: T=20 → 23.33 hPa.

describe('Tool 3 — Saturation Vapor Pressure', () => {
  it('T=20 → e_s ≈ 23.33 hPa', () => {
    expect(computeEquation(3, { T: 20 })!.result).toBeCloseTo(6.1094 * Math.exp(17.625 * 20 / (20 + 243.04)), 6);
  });
  it('exposes slope and mixing_ratio as secondary', () => {
    const sec = computeEquation(3, { T: 20 })!.secondary ?? [];
    const slope = sec.find((s) => s.key === 'slope');
    const ws = sec.find((s) => s.key === 'mixing_ratio');
    expect(slope?.unit).toBe('hPa/°C');
    expect(ws?.unit).toBe('g/kg');
    expect(slope?.value).toBeGreaterThan(1);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(3, { T: '20' } as any)!.result)).toBe(true);
  });
  it('honest NaN on missing T', () => {
    expect(Number.isNaN(computeEquation(3, { T: NaN })!.result)).toBe(true);
  });
});

// ── Tool 4 — Hydrostatic Equation ────────────────────────────────────
// P(z) = P₀·exp(−z/H), H = R_d·T/g. Worked example: P₀=1013.25, z=1000,
// T=288 → P ≈ 899.9 hPa (H = 287.05·288/9.81 = 8428 m).

describe('Tool 4 — Hydrostatic Equation', () => {
  it('P₀=1013.25, z=1000, T=288 → P ≈ 899.9 hPa', () => {
    const H = (287.058 * 288) / 9.80665;
    expect(computeEquation(4, { P0: 1013.25, z: 1000, T: 288 })!.result).toBeCloseTo(1013.25 * Math.exp(-1000 / H), 4);
  });
  it('exposes scale_height as secondary', () => {
    const sec = computeEquation(4, { P0: 1013.25, z: 1000, T: 288 })!.secondary ?? [];
    expect(sec.find((s) => s.key === 'scale_height')?.unit).toBe('m');
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(4, { P0: '1013.25', z: '1000', T: '288' } as any)!.result)).toBe(true);
  });
  it('honest NaN on missing', () => {
    expect(Number.isNaN(computeEquation(4, { P0: NaN, z: NaN, T: NaN })!.result)).toBe(true);
  });
  it('P decreases with altitude', () => {
    const low = computeEquation(4, { P0: 1013.25, z: 0, T: 288 })!;
    const high = computeEquation(4, { P0: 1013.25, z: 5000, T: 288 })!;
    expect(high.result).toBeLessThan(low.result);
  });
});
