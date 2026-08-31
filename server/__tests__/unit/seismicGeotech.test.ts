import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 15 — Ekman Spiral (1905) ────────────────────────────────────
// V₀ = τ/√(ρfAᵥ). Worked example: τ=0.1, ρ=1025, f=1e-4, A=0.1
// → V₀ = 0.1/√(1025·1e-4·0.1) = 0.1/√0.01025 = 0.987 m/s.

describe('Tool 15 — Ekman Spiral', () => {
  it('τ=0.1, ρ=1025, f=1e-4, A=0.1 → V₀≈0.99 m/s', () => {
    const res = computeEquation(15, { tau: 0.1, rho: 1025, A: 0.1, f: 1e-4 });
    expect(res!.result).toBeCloseTo(0.1 / Math.sqrt(1025 * 1e-4 * 0.1), 6);
    expect(res!.unit).toBe('m/s');
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(15, { tau: '0.1', rho: '1025', A: '0.1', f: '1e-4' } as any)!.result)).toBe(true);
  });
  it('honest NaN near equator (f→0)', () => {
    expect(Number.isNaN(computeEquation(15, { tau: 0.1, rho: 1025, A: 0.1, f: 1e-9 })!.result)).toBe(true);
  });
});

// ── Tool 16 — Geostrophic Current (Gill 1982) ────────────────────────
// v = (1/ρf)·∂p/∂x. Worked example: ρ=1025, f=1e-4, dpdx=1e-5
// → v = 1e-5/(1025·1e-4) = 0.0976 m/s.

describe('Tool 16 — Geostrophic Current', () => {
  it('ρ=1025, f=1e-4, dpdx=1e-5 → v≈0.098 m/s', () => {
    expect(computeEquation(16, { f: 1e-4, dpdx: 1e-5, rho: 1025 })!.result).toBeCloseTo(1e-5 / (1025 * 1e-4), 6);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(16, { f: '1e-4', dpdx: '1e-5', rho: '1025' } as any)!.result)).toBe(true);
  });
  it('honest NaN near equator', () => {
    expect(Number.isNaN(computeEquation(16, { f: 1e-9, dpdx: 1e-5, rho: 1025 })!.result)).toBe(true);
  });
});

// ── Tool 19 — Gutenberg-Richter (1944) ───────────────────────────────
// log₁₀(N) = a − b·M. Worked example: a=4, b=1, M=5 → N=10⁻¹=0.1 events/yr.

describe('Tool 19 — Gutenberg-Richter', () => {
  it('a=4, b=1, M=5 → N=0.1 events/yr', () => {
    expect(computeEquation(19, { a: 4, b: 1, M: 5 })!.result).toBeCloseTo(0.1, 9);
  });
  it('exposes return_period as secondary', () => {
    const sec = computeEquation(19, { a: 4, b: 1, M: 5 })!.secondary ?? [];
    expect(sec.find((s) => s.key === 'return_period')?.value).toBeCloseTo(10, 6);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(19, { a: '4', b: '1', M: '5' } as any)!.result)).toBe(true);
  });
  it('honest NaN when no catalog fit', () => {
    expect(Number.isNaN(computeEquation(19, { a: NaN, b: NaN, M: NaN })!.result)).toBe(true);
  });
});

// ── Tool 22 — Mohr-Coulomb (Coulomb 1776) ────────────────────────────
// τ = c + σₙ·tanφ. Worked example: c=10, σₙ=100, tanφ=0.6 → τ=70 kPa.

describe('Tool 22 — Mohr-Coulomb', () => {
  it('c=10, σₙ=100, tanφ=0.6 → τ=70 kPa', () => {
    expect(computeEquation(22, { c: 10, sigmaN: 100, tanPhi: 0.6 })!.result).toBeCloseTo(70, 6);
  });
  it('exposes friction_angle as secondary', () => {
    const sec = computeEquation(22, { c: 10, sigmaN: 100, tanPhi: 0.6 })!.secondary ?? [];
    expect(sec.find((s) => s.key === 'friction_angle')?.value).toBeCloseTo(Math.atan(0.6) * 180 / Math.PI, 6);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(22, { c: '10', sigmaN: '100', tanPhi: '0.6' } as any)!.result)).toBe(true);
  });
  it('honest NaN when soil data missing', () => {
    expect(Number.isNaN(computeEquation(22, { c: NaN, sigmaN: NaN, tanPhi: NaN })!.result)).toBe(true);
  });
});

// ── Tool 23 — Hanks-Kanamori (1979) ──────────────────────────────────
// M_w = (2/3)·log₁₀(M₀) − 10.7 (dyne·cm). Worked example: M₀=1e18 N·m
// → log₁₀(1e25 dyne·cm) = 25 → M_w = (2/3)·25 − 10.7 = 5.97.

describe('Tool 23 — Hanks-Kanamori Moment Magnitude', () => {
  it('M₀=1e18 N·m → M_w≈5.97', () => {
    expect(computeEquation(23, { M0: 1e18 })!.result).toBeCloseTo((2 / 3) * 25 - 10.7, 6);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(23, { M0: '1e18' } as any)!.result)).toBe(true);
  });
  it('honest NaN when M₀ missing', () => {
    expect(Number.isNaN(computeEquation(23, { M0: NaN })!.result)).toBe(true);
  });
});

// ── Tool 24 — Brune Stress Drop (1970) ───────────────────────────────
// Δσ = (7/16)·M₀/r³. Worked example: M₀=1e18, r=1000 → Δσ = 0.4375·1e18/1e9 = 4.4e8 Pa.

describe('Tool 24 — Brune Stress Drop', () => {
  it('M₀=1e18, r=1000 → Δσ≈4.4e8 Pa', () => {
    expect(computeEquation(24, { M0: 1e18, r: 1000 })!.result).toBeCloseTo((7 / 16) * 1e18 / 1e9, 4);
  });
  it('exposes stress_drop_mpa as secondary', () => {
    const sec = computeEquation(24, { M0: 1e18, r: 1000 })!.secondary ?? [];
    expect(sec.find((s) => s.key === 'stress_drop_mpa')?.value).toBeCloseTo((7 / 16) * 1e18 / 1e9 / 1e6, 4);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(24, { M0: '1e18', r: '1000' } as any)!.result)).toBe(true);
  });
});

// ── Tool 25 — Wells-Coppersmith (1994) ───────────────────────────────
// log₁₀(A) = −3.49 + 0.91·M_w. Worked example: M_w=6 → A = 10^(1.97) = 93 km².

describe('Tool 25 — Wells-Coppersmith', () => {
  it('M_w=6 → A≈93 km²', () => {
    expect(computeEquation(25, { Mw: 6 })!.result).toBeCloseTo(Math.pow(10, -3.49 + 0.91 * 6), 6);
  });
  it('exposes surface_rupture_length as secondary', () => {
    const sec = computeEquation(25, { Mw: 6 })!.secondary ?? [];
    expect(sec.find((s) => s.key === 'surface_rupture_length')?.value).toBeCloseTo(Math.pow(10, -3.55 + 0.74 * 6), 6);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(25, { Mw: '6' } as any)!.result)).toBe(true);
  });
});

// ── Tool 33 — Crop Water Stress Index (Idso 1981) ────────────────────
// CWSI = (T_c−T_wet)/(T_dry−T_wet). Worked example: T_c=35, T_wet=25,
// T_dry=40 → CWSI = 10/15 = 0.667.

describe('Tool 33 — CWSI', () => {
  it('T_c=35, T_wet=25, T_dry=40 → CWSI=0.667', () => {
    expect(computeEquation(33, { Tc: 35, Twet: 25, Tdry: 40 })!.result).toBeCloseTo(10 / 15, 6);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(33, { Tc: '35', Twet: '25', Tdry: '40' } as any)!.result)).toBe(true);
  });
  it('honest NaN when baseline missing', () => {
    expect(Number.isNaN(computeEquation(33, { Tc: NaN, Twet: NaN, Tdry: NaN })!.result)).toBe(true);
  });
});