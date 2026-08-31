import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 43 — van Genuchten (1980) soil water retention ──────────────
// θ(ψ) = θr + (θs−θr)·[1+(α|ψ|)^n]^(−m), m = 1−1/n.
// Worked example: θr=0.05, θs=0.4, α=0.02, n=1.5, ψ=−100
// → term = [1+(0.02·100)^1.5]^0.3333, θ ≈ 0.2737 m³/m³.

describe('Tool 43 — van Genuchten water retention', () => {
  it('worked example → θ ≈ 0.27 m³/m³', () => {
    const res = computeEquation(43, { thetaR: 0.05, thetaS: 0.4, alpha: 0.02, n: 1.5, psi: -100 })!;
    const m = 1 - 1 / 1.5;
    const expected = 0.05 + (0.4 - 0.05) / Math.pow(1 + Math.pow(0.02 * 100, 1.5), m);
    expect(res.result).toBeCloseTo(expected, 6);
    expect(res.result).toBeGreaterThan(0.2);
    expect(res.result).toBeLessThan(0.3);
    expect(res.unit).toBe('m³/m³');
  });
  it('saturation limit: ψ→0⁻ → θ→θ_s', () => {
    const res = computeEquation(43, { thetaR: 0.05, thetaS: 0.4, alpha: 0.02, n: 1.5, psi: -0.001 })!;
    expect(res.result).toBeCloseTo(0.4, 6);
  });
  it('exposes effective saturation + Mualem K/K_s as secondaries', () => {
    const res = computeEquation(43, { thetaR: 0.05, thetaS: 0.4, alpha: 0.02, n: 1.5, psi: -100 })!;
    const sec = res.secondary ?? [];
    const Se = sec.find((s) => s.key === 'effective_saturation');
    const kRel = sec.find((s) => s.key === 'relative_conductivity');
    expect(Se).toBeDefined();
    expect(Se!.value).toBeCloseTo(0.63923, 4);
    expect(kRel).toBeDefined();
    expect(Number.isFinite(kRel!.value)).toBe(true);
    expect(kRel!.value).toBeLessThan(1);
  });
  it('honest NaN + NaN secondaries on missing inputs', () => {
    const res = computeEquation(43, { thetaR: NaN, thetaS: NaN, alpha: NaN, n: NaN, psi: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });
  it('honest NaN when n ≤ 1 (m = 1−1/n must be positive)', () => {
    const res = computeEquation(43, { thetaR: 0.05, thetaS: 0.4, alpha: 0.02, n: 1, psi: -100 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });
  it('does NOT throw on string inputs', () => {
    const res = computeEquation(43, { thetaR: '0.05', thetaS: '0.4', alpha: '0.02', n: '1.5', psi: '-100' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });
});

// ── Tool 44 — Brooks-Corey (1964) retention ──────────────────────────
// S_e = (|ψ_b|/|ψ|)^λ for |ψ|>|ψ_b|; θ = θr + (θs−θr)·S_e.
// Worked example: θr=0.05, θs=0.4, ψ_b=−50, λ=0.3, ψ=−100
// → S_e = 0.5^0.3 ≈ 0.8123, θ ≈ 0.3343 m³/m³.

describe('Tool 44 — Brooks-Corey retention', () => {
  it('worked example → S_e ≈ 0.8123, θ ≈ 0.3343', () => {
    const res = computeEquation(44, { psib: -50, psi: -100, lambda: 0.3, thetaR: 0.05, thetaS: 0.4 })!;
    expect(res.result).toBeCloseTo(Math.pow(0.5, 0.3), 6);
    const thetaSec = res.secondary!.find((s) => s.key === 'theta')!;
    expect(thetaSec.value).toBeCloseTo(0.05 + 0.35 * Math.pow(0.5, 0.3), 6);
  });
  it('saturated regime |ψ| ≤ |ψ_b| → S_e = 1, θ = θ_s', () => {
    const res = computeEquation(44, { psib: -50, psi: -20, lambda: 0.3, thetaR: 0.05, thetaS: 0.4 })!;
    expect(res.result).toBeCloseTo(1, 9);
    expect(res.secondary!.find((s) => s.key === 'theta')!.value).toBeCloseTo(0.4, 9);
  });
  it('exposes bubbling pressure + relative conductivity as secondaries', () => {
    const res = computeEquation(44, { psib: -50, psi: -100, lambda: 0.3, thetaR: 0.05, thetaS: 0.4 })!;
    const sec = res.secondary ?? [];
    expect(sec.find((s) => s.key === 'bubbling_pressure')!.value).toBeCloseTo(50, 9);
    const kRel = sec.find((s) => s.key === 'relative_conductivity');
    expect(kRel).toBeDefined();
    expect(kRel!.value).toBeCloseTo(Math.pow(0.81225, 3 + 2 / 0.3), 4);
  });
  it('honest NaN + NaN secondaries on missing inputs', () => {
    const res = computeEquation(44, { psib: NaN, psi: NaN, lambda: NaN, thetaR: NaN, thetaS: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });
  it('does NOT throw on string inputs', () => {
    const res = computeEquation(44, { psib: '-50', psi: '-100', lambda: '0.3', thetaR: '0.05', thetaS: '0.4' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });
});

// ── Tool 48 — Monin-Obukhov similarity ───────────────────────────────
// φ_m(ζ): unstable (1−19.3ζ)^(−1/4), stable 1+6ζ; ζ = z/L → 0 ⇒ φ_m → 1.

describe('Tool 48 — Monin-Obukhov similarity', () => {
  it('neutral limit: large |L| → φ_m ≈ 1', () => {
    const res = computeEquation(48, { kappa: 0.4, ustar: 0.3, z: 10, L: 1e6, z0M: 0.03 })!;
    expect(res.result).toBeCloseTo(1, 2);
  });
  it('stable: φ_m = 1 + 6ζ', () => {
    const res = computeEquation(48, { kappa: 0.4, ustar: 0.3, z: 10, L: 100, z0M: 0.03 })!;
    expect(res.result).toBeCloseTo(1 + 6 * 0.1, 6);
  });
  it('unstable: φ_m = (1 − 19.3ζ)^(−1/4)', () => {
    const res = computeEquation(48, { kappa: 0.4, ustar: 0.3, z: 10, L: -100, z0M: 0.03 })!;
    expect(res.result).toBeCloseTo(Math.pow(1 - 19.3 * -0.1, -0.25), 6);
  });
  it('exposes Obukhov length, stability parameter and class as secondaries', () => {
    const res = computeEquation(48, { kappa: 0.4, ustar: 0.3, z: 10, L: -100, z0M: 0.03 })!;
    const sec = res.secondary ?? [];
    expect(sec.find((s) => s.key === 'obukhov_length')!.value).toBeCloseTo(-100, 9);
    expect(sec.find((s) => s.key === 'stability_parameter')!.value).toBeCloseTo(-0.1, 9);
    expect(sec.find((s) => s.key === 'stability_class')!.value).toBe(2);
  });
  it('honest NaN + NaN secondaries when L is missing', () => {
    const res = computeEquation(48, { kappa: 0.4, ustar: 0.3, z: 10, L: NaN, z0M: 0.03 })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });
  it('does NOT throw on string inputs', () => {
    const res = computeEquation(48, { kappa: '0.4', ustar: '0.3', z: '10', L: '-100', z0M: '0.03' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });
});

// ── Tool 49 — Logarithmic wind profile ───────────────────────────────
// u(z) = (u_*/κ)·ln(z/z₀), κ = 0.4.
// Worked example: u_*=0.3, z=10, z₀=0.03 → u = 0.75·ln(333.33) ≈ 4.357 m/s.

describe('Tool 49 — logarithmic wind profile', () => {
  it('worked example → u ≈ 4.357 m/s', () => {
    const res = computeEquation(49, { ustar: 0.3, z: 10, z0: 0.03, rho: 1.225 })!;
    expect(res.result).toBeCloseTo((0.3 / 0.4) * Math.log(10 / 0.03), 6);
    expect(res.unit).toBe('m/s');
  });
  it('zero preservation: u→0 as z→z₀⁺', () => {
    const res = computeEquation(49, { ustar: 0.3, z: 0.03001, z0: 0.03, rho: 1.225 })!;
    expect(res.result).toBeLessThan(0.001);
    expect(res.result).toBeGreaterThan(0);
  });
  it('exposes friction velocity + roughness Reynolds as secondaries', () => {
    const res = computeEquation(49, { ustar: 0.3, z: 10, z0: 0.03, rho: 1.225 })!;
    const sec = res.secondary ?? [];
    expect(sec.find((s) => s.key === 'friction_velocity')!.value).toBeCloseTo(0.3, 9);
    const Re = sec.find((s) => s.key === 'roughness_reynolds');
    expect(Re).toBeDefined();
    expect(Re!.value).toBeCloseTo((0.3 * 0.03) / 1.46e-5, 4);
  });
  it('honest NaN + NaN secondaries on missing u_*', () => {
    const res = computeEquation(49, { ustar: NaN, z: 10, z0: 0.03, rho: 1.225 })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });
  it('honest NaN when z ≤ z₀ (outside log-law domain)', () => {
    const res = computeEquation(49, { ustar: 0.3, z: 0.02, z0: 0.03, rho: 1.225 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });
  it('does NOT throw on string inputs', () => {
    const res = computeEquation(49, { ustar: '0.3', z: '10', z0: '0.03', rho: '1.225' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });
});

// ── Tool 50 — Ball-Berry (1987) stomatal conductance ─────────────────
// g_s = g₀ + a₁·A·h_s/c_s  [mol/m²s], reported in mmol/m²s.
// Worked example: g₀=0.01 mmol, a₁=9, A=15 µmol/m²s, h=0.7, c_s=330 ppm
// → g = 0.00001 + 9·15·0.7/330 = 0.28637 mol/m²s ≈ 286.4 mmol/m²s.

describe('Tool 50 — Ball-Berry stomatal conductance', () => {
  it('worked example → g_s ≈ 286.4 mmol/m²s', () => {
    const res = computeEquation(50, { g0: 0.01, a1: 9, A: 15, hs: 0.7, cs: 330 })!;
    const expected = (0.01 / 1000 + (9 * 15 * 0.7) / 330) * 1000;
    expect(res.result).toBeCloseTo(expected, 6);
    expect(res.result).toBeGreaterThan(250);
    expect(res.result).toBeLessThan(320);
    expect(res.unit).toBe('mmol/m²s');
  });
  it('g₀-only limit: a₁=0 → g_s = g₀', () => {
    const res = computeEquation(50, { g0: 0.01, a1: 0, A: 15, hs: 0.7, cs: 330 })!;
    expect(res.result).toBeCloseTo(0.01, 9);
  });
  it('exposes assimilation, c_i and transpiration as secondaries', () => {
    const res = computeEquation(50, { g0: 0.01, a1: 9, A: 15, hs: 0.7, cs: 330 })!;
    const sec = res.secondary ?? [];
    expect(sec.find((s) => s.key === 'assimilation')!.value).toBeCloseTo(15, 9);
    const ci = sec.find((s) => s.key === 'intercellular_co2');
    expect(ci).toBeDefined();
    expect(ci!.value).toBeGreaterThan(0);
    expect(ci!.value).toBeLessThan(330);
    expect(sec.find((s) => s.key === 'transpiration')!.value).toBeGreaterThan(0);
  });
  it('honest NaN + NaN secondaries on missing inputs', () => {
    const res = computeEquation(50, { g0: NaN, a1: NaN, A: NaN, hs: NaN, cs: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });
  it('does NOT throw on string inputs', () => {
    const res = computeEquation(50, { g0: '0.01', a1: '9', A: '15', hs: '0.7', cs: '330' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });
});
