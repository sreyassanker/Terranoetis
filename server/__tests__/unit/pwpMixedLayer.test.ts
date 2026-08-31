/**
 * Tool 72 — Price-Weller-Pinkel Mixed Layer (Price, Weller & Pinkel 1986)
 *
 * Paper eq (9): R_b = g·Δρ·h/(ρ₀·(ΔV)²) ≥ 0.65 for stability.
 * Paper §4.2: "If R_b < 0.65, then the mixed layer entrains successively
 * deeper levels until (9) is satisfied" — DEEPENING occurs for R_b < 0.65.
 * The previous build had this sign backwards (deepening for R_b > 0.65).
 */
import { describe, expect, it } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

const run72 = (inputs: Record<string, number>) =>
  computeEquation(72, inputs)!;

const G = 9.81, RHO0 = 1025;

describe('Tool 72 — PWP Mixed Layer (bulk Richardson criterion)', () => {
  it('deepens when R_b < 0.65 (paper §4.2 entrainment)', () => {
    // Δρ=0.5, h=50, ΔV=1.5 → R_b = 9.81*0.5*50/(1025*2.25) = 0.106 < 0.65 → deepens
    const r = run72({ g: G, rho0: RHO0, drho: 0.5, h: 50, dV: 1.5 });
    expect(r.result).toBe(1);
    const Rb = r.secondary?.find((s) => s.key === 'Rb')?.value;
    expect(Rb).toBeCloseTo(0.1064, 2);
  });

  it('is stable (no deepening) when R_b ≥ 0.65', () => {
    // Δρ=0.5, h=50, ΔV=0.3 → R_b = 9.81*0.5*50/(1025*0.09) = 2.66 ≥ 0.65 → stable
    const r = run72({ g: G, rho0: RHO0, drho: 0.5, h: 50, dV: 0.3 });
    expect(r.result).toBe(0);
    const Rb = r.secondary?.find((s) => s.key === 'Rb')?.value;
    expect(Rb).toBeCloseTo(2.659, 2);
  });

  it('is exactly at the boundary case R_b = 0.65 → stable (≥ 0.65)', () => {
    // solve ΔV² = g·Δρ·h/(ρ₀·0.65): with Δρ=0.5, h=50 → ΔV² = 9.81*25/(1025*0.65) = 0.368
    const dV = Math.sqrt((G * 0.5 * 50) / (RHO0 * 0.65));
    const r = run72({ g: G, rho0: RHO0, drho: 0.5, h: 50, dV });
    expect(r.result).toBe(0); // R_b = 0.65 exactly → not < 0.65
    const Rb = r.secondary?.find((s) => s.key === 'Rb')?.value;
    expect(Rb).toBeCloseTo(0.65, 6);
  });

  it('returns honest NaN for missing ΔV (no open velocity-jump API)', () => {
    const r = run72({ g: G, rho0: RHO0, drho: 0.5, h: 50, dV: Number.NaN });
    expect(Number.isNaN(r.secondary?.find((s) => s.key === 'Rb')?.value)).toBe(true);
    expect(r.result).toBe(0); // no false "deepening" claim
    expect(r.steps.join('\n')).toContain('R_b unavailable');
  });

  it('returns honest NaN for degenerate ΔV = 0 (never Infinity)', () => {
    const r = run72({ g: G, rho0: RHO0, drho: 0.5, h: 50, dV: 0 });
    expect(Number.isNaN(r.secondary?.find((s) => s.key === 'Rb')?.value)).toBe(true);
  });

  it('computes R_b from the paper eq (9) formula', () => {
    const r = run72({ g: G, rho0: RHO0, drho: 0.2, h: 20, dV: 0.1 });
    // R_b = 9.81*0.2*20/(1025*0.01) = 3.829 → stable
    const Rb = r.secondary?.find((s) => s.key === 'Rb')?.value;
    expect(Rb).toBeCloseTo(3.829, 2);
    expect(r.result).toBe(0);
  });

  it('narrates the paper method (eq 9, §4.2, R_g 0.25 third process) in the steps', () => {
    const r = run72({ g: G, rho0: RHO0, drho: 0.5, h: 50, dV: 1.5 });
    const steps = r.steps.join('\n');
    expect(steps).toContain('eq 9');
    expect(steps).toContain('0.65');
    expect(steps).toContain('0.25');
    expect(steps).toContain('Price, Weller & Pinkel, 1986');
  });
});
