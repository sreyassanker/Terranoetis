import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 18 — Green-Ampt Infiltration (Green & Ampt 1911) ────────────
// f = K_s · (1 + ψ_f·Δθ/F), ψ_f = ψ_w − ψ₀.
// Paper: Green, W.H. & Ampt, G.A. (1911) Studies on Soil Physics.
// J. Agric. Sci. 4(1):1–24. doi:10.1017/S0021859600001441
//
// Worked check: K_s = 1e-5 m/s, ψ_w = 0.2 m, ψ₀ = 0, Δθ = 0.2, F = 0.1 m:
//   ψ_f = 0.2 m
//   f = 1e-5 · (1 + 0.2·0.2/0.1) = 1e-5 · (1 + 0.4) = 1.4e-5 m/s
//   L = F/Δθ = 0.1/0.2 = 0.5 m

describe('Tool 18 — Green-Ampt Infiltration', () => {
  it('worked example: K_s=1e-5, ψ_w=0.2, ψ₀=0, Δθ=0.2, F=0.1 → f=1.4e-5 m/s', () => {
    const res = computeEquation(18, { Ks: 1e-5, psiW: 0.2, psi0: 0, dTheta: 0.2, Ft: 0.1 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(1.4e-5, 10);
    expect(res!.unit).toBe('m/s');
  });

  it('as F → large, f → K_s (gravity-dominated)', () => {
    const smallF = computeEquation(18, { Ks: 1e-5, psiW: 0.2, psi0: 0, dTheta: 0.2, Ft: 0.01 });
    const largeF = computeEquation(18, { Ks: 1e-5, psiW: 0.2, psi0: 0, dTheta: 0.2, Ft: 5 });
    expect(smallF!.result).toBeGreaterThan(largeF!.result);
    // F=5: capillary term = 0.2·0.2/5 = 0.008 → f = 1e-5·1.008 = 1.008e-5
    expect(largeF!.result).toBeCloseTo(1e-5 * 1.008, 10);
  });

  it('higher suction head ψ_f increases the early infiltration rate', () => {
    const lowPsi = computeEquation(18, { Ks: 1e-5, psiW: 0.1, psi0: 0, dTheta: 0.2, Ft: 0.1 });
    const highPsi = computeEquation(18, { Ks: 1e-5, psiW: 0.5, psi0: 0, dTheta: 0.2, Ft: 0.1 });
    expect(highPsi!.result).toBeGreaterThan(lowPsi!.result);
  });

  it('exposes wetting_front_depth, suction_head and f/K_s as secondary', () => {
    const res = computeEquation(18, { Ks: 1e-5, psiW: 0.2, psi0: 0, dTheta: 0.2, Ft: 0.1 });
    const sec = res!.secondary ?? [];
    const L = sec.find((s) => s.key === 'wetting_front_depth');
    const psiF = sec.find((s) => s.key === 'suction_head');
    const ratio = sec.find((s) => s.key === 'ratio');
    expect(L?.value).toBeCloseTo(0.5, 6);       // F/Δθ = 0.1/0.2
    expect(L?.unit).toBe('m');
    expect(psiF?.value).toBeCloseTo(0.2, 6);    // ψ_w − ψ₀
    expect(ratio?.value).toBeCloseTo(1.4, 6);   // f/K_s
  });

  it('does NOT throw when inputs arrive as strings (numeric coercion)', () => {
    const res = computeEquation(18, { Ks: '1e-5', psiW: '0.2', psi0: '0', dTheta: '0.2', Ft: '0.1' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(1.4e-5, 10);
  });

  it('returns honest NaN when genuine soil data is missing (no fabricated f)', () => {
    const res = computeEquation(18, { Ks: Number.NaN, psiW: Number.NaN, psi0: Number.NaN, dTheta: Number.NaN, Ft: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('preserves a genuine zero ψ₀ (dry start)', () => {
    const res = computeEquation(18, { Ks: 1e-5, psiW: 0.2, psi0: 0, dTheta: 0.2, Ft: 0.1 });
    expect(Number.isFinite(res!.result)).toBe(true);
    expect(res!.result).toBeCloseTo(1.4e-5, 10);
  });

  it('F ≤ 0 gives honest NaN (division by zero / negative depth)', () => {
    const res = computeEquation(18, { Ks: 1e-5, psiW: 0.2, psi0: 0, dTheta: 0.2, Ft: 0 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('param alias: F(t)→Ft, Δθ→dTheta via normalizeInputs', () => {
    const normalized = normalizeInputs(18, { 'F(t)': 0.1, 'Δθ': 0.2 } as unknown as Record<string, number>);
    expect(normalized['Ft']).toBe(0.1);
    expect(normalized['dTheta']).toBe(0.2);
  });
});
