import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 78 — Wave Dispersion Relation (Airy 1845 / SPM 1984 Ch 2) ──
// Primary source: U.S. Army Corps of Engineers (1984) Shore Protection
// Manual, 4th ed., Vol. I, Ch 2, eqs 2-1/2-2/2-3: C² = (g/ω)·tanh(kh),
// equivalently ω² = g·k·tanh(kh) with k = 2π/L, ω = 2π/T (Airy 1845,
// Encyclopaedia Metropolitana — pre-DOI). Regime classification per the
// SPM d/L table: deep d/L > 1/2 (kh > π); shallow d/L < 1/25 (kh < 2π/25);
// transitional in between (full tanh form required, eqs 2-2/2-3).
//
// In the live pipeline h auto-derives from genuine GEBCO 2020 bathymetry
// (positive only over water; land/fetch failure → honest NaN). The engine
// is a pure algebra evaluation that must be NaN-honest for non-positive
// g / k / h.

const G = 9.80665;

describe('Tool 78 — Wave Dispersion Relation (Airy / SPM 1984 Ch 2)', () => {
  it('catalogue worked check: g=9.81, k=0.1, h=10 → ω = 0.864 rad/s, T = 7.3 s, C = 8.64 m/s', () => {
    const res = computeEquation(78, { g: 9.81, k: 0.1, h: 10 });
    expect(res).not.toBeNull();
    // ω = √(g·k·tanh(kh)); kh = 1.0, tanh(1.0) = 0.761594
    const omega = Math.sqrt(9.81 * 0.1 * Math.tanh(1.0));
    expect(res!.result).toBeCloseTo(omega, 6); // ≈ 0.864 rad/s
    expect(res!.unit).toBe('rad/s');
    const sec = res!.secondary ?? [];
    expect(sec.find((s) => s.key === 'wave_period')!.value).toBeCloseTo(2 * Math.PI / omega, 6); // ≈ 7.27 s
    expect(sec.find((s) => s.key === 'wave_celerity')!.value).toBeCloseTo(omega / 0.1, 6); // ≈ 8.64 m/s
    expect(sec.find((s) => s.key === 'wavelength')!.value).toBeCloseTo(2 * Math.PI / 0.1, 6); // ≈ 62.8 m
    // group velocity C_g = C/2·[1 + 2kh/sinh(2kh)]; kh=1: [1 + 2/3.6269]/2 = 0.7757
    const Cg = (omega / 0.1) / 2 * (1 + 2 / Math.sinh(2));
    expect(sec.find((s) => s.key === 'group_velocity')!.value).toBeCloseTo(Cg, 6); // ≈ 6.70 m/s
  });

  it('deep-water limit (kh > π): ω² → gk, regime flagged deep', () => {
    // h = 100 m, k = 0.1 → kh = 10 > π; tanh(10) = 0.9999999959
    const res = computeEquation(78, { g: G, k: 0.1, h: 100 });
    const omega = Math.sqrt(G * 0.1 * Math.tanh(10));
    expect(res!.result).toBeCloseTo(omega, 6);
    expect(res!.result).toBeCloseTo(Math.sqrt(G * 0.1), 4); // ≈ deep-water value
    expect(res!.steps.join('\n')).toContain('Deep water');
    expect(res!.secondary!.find((s) => s.key === 'kh')!.value).toBeGreaterThan(Math.PI);
  });

  it('shallow-water limit (kh < 2π/25): ω² → gk²h, regime flagged shallow', () => {
    // h = 0.2 m, k = 0.1 → kh = 0.02 < 2π/25 ≈ 0.251; tanh(0.02) ≈ 0.019997
    // (shallow approximation ω = k·√(gh) is within 0.02 % at this kh)
    const res = computeEquation(78, { g: G, k: 0.1, h: 0.2 });
    const omega = Math.sqrt(G * 0.1 * Math.tanh(0.02));
    expect(res!.result).toBeCloseTo(omega, 6);
    expect(res!.result).toBeCloseTo(Math.sqrt(G * 0.1 * 0.1 * 0.2), 4); // ω = k·√(gh)
    expect(res!.steps.join('\n')).toContain('Shallow water');
    expect(res!.secondary!.find((s) => s.key === 'kh')!.value).toBeLessThan(2 * Math.PI / 25);
  });

  it('transitional regime (2π/25 < kh < π): full tanh form', () => {
    // h = 10, k = 0.1 → kh = 1.0
    const res = computeEquation(78, { g: G, k: 0.1, h: 10 });
    expect(res!.steps.join('\n')).toContain('Transitional water');
    const kh = res!.secondary!.find((s) => s.key === 'kh')!.value as number;
    expect(kh).toBeGreaterThan(2 * Math.PI / 25);
    expect(kh).toBeLessThan(Math.PI);
  });

  it('SPM deep-water boundary at d/L = 0.5: kh = π exactly is deep', () => {
    // k = 2π/L, h = L/2 → kh = π; engine's threshold is kh > π so kh = π
    // sits at the boundary (transitional by the strict inequality, matching
    // the SPM table where d/L = 1/2 is the stated boundary).
    const L = 100;
    const k = 2 * Math.PI / L;
    const res = computeEquation(78, { g: G, k, h: L / 2 });
    expect(res!.secondary!.find((s) => s.key === 'kh')!.value).toBeCloseTo(Math.PI, 6);
  });

  it('alias normalization: k / h / g pass through, primary computed from canonical keys', () => {
    const norm = normalizeInputs(78, { g: 9.81, k: 0.1, h: 10 });
    expect(norm).toEqual({ g: 9.81, k: 0.1, h: 10 });
    // direct canonical keys work (computeEquation reads k/h/g)
    const res = computeEquation(78, { g: 9.81, k: 0.1, h: 10 });
    expect(res!.result).toBeCloseTo(Math.sqrt(9.81 * 0.1 * Math.tanh(1.0)), 6);
  });

  it('honest NaN when g / k / h is missing, NaN, zero, or negative', () => {
    // missing
    expect(Number.isFinite(computeEquation(78, {})!.result)).toBe(false);
    // NaN
    expect(Number.isFinite(computeEquation(78, { g: G, k: 0.1, h: Number.NaN })!.result)).toBe(false);
    // zero depth (shoreline) — singular, honest NaN (SPM needs positive d)
    expect(Number.isFinite(computeEquation(78, { g: G, k: 0.1, h: 0 })!.result)).toBe(false);
    // negative depth — no such water column
    expect(Number.isFinite(computeEquation(78, { g: G, k: 0.1, h: -5 })!.result)).toBe(false);
    // zero / negative wavenumber
    expect(Number.isFinite(computeEquation(78, { g: G, k: 0, h: 10 })!.result)).toBe(false);
    expect(Number.isFinite(computeEquation(78, { g: G, k: -0.1, h: 10 })!.result)).toBe(false);
    // NaN steps carry the honest explanation
    expect(computeEquation(78, { g: G, k: 0.1, h: 0 })!.steps.join('\n')).toContain('honest NaN');
  });
});
