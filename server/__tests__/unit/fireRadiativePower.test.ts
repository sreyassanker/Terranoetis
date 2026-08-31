import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 32 — Fire Radiative Power (Giglio et al. 2006) ──────────────
// Operational FRP: Wooster (2005) MIR-radiance method (NASA FIRMS product).
// Dozier form: FRP = A·ε·σ·(T_fire⁴ − T_bg⁴).
// Worked example: A=1e6 m², ε=0.98, σ=5.67e-8, T_fire=850 K, T_bg=300 K:
//   FRP = 1e6·0.98·5.67e-8·(850⁴−300⁴) = 5.557e-2·(5.22e11−8.1e9) ≈ 2.85e10 W = 28.5 GW.

describe('Tool 32 — Fire Radiative Power', () => {
  it('Dozier form: A=1e6, ε=0.98, T_fire=850, T_bg=300 → FRP ≈ 2.86e10 W', () => {
    const res = computeEquation(32, { A: 1e6, eps: 0.98, Tfire: 850, Tbg: 300 });
    expect(res).not.toBeNull();
    const expected = 1e6 * 0.98 * 5.670374419e-8 * (Math.pow(850, 4) - Math.pow(300, 4));
    expect(res!.result).toBeCloseTo(expected, 4);
    expect(res!.unit).toBe('W');
  });

  it('higher fire temperature → much higher FRP (T⁴ law)', () => {
    const t600 = computeEquation(32, { A: 1e6, eps: 0.98, Tfire: 600, Tbg: 300 });
    const t850 = computeEquation(32, { A: 1e6, eps: 0.98, Tfire: 850, Tbg: 300 });
    // (850/600)⁴ ≈ 4.03
    expect(t850!.result / t600!.result).toBeGreaterThan(3.5);
  });

  it('returns genuine FIRMS FRP when measured data is available (no user Dozier temps)', () => {
    const res = computeEquation(32, {
      A: 1e6, eps: 0.98, Tfire: Number.NaN, Tbg: Number.NaN,
      firmsFrpTotalW: 15e6, firmsFrpMaxMW: 15,
      __firmsDetection: 'FIRMS detection: 1 fire pixel', __firmsCount: 1,
    } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBe(15e6); // measured FRP wins
    expect(res!.unit).toBe('W');
    const joined = (res!.steps ?? []).join('\n');
    expect(joined).toContain('Genuine measured FRP');
  });

  it('returns honest NaN when no FIRMS detection and no user temperatures', () => {
    const res = computeEquation(32, { A: Number.NaN, eps: Number.NaN, Tfire: Number.NaN, Tbg: Number.NaN, firmsFrpTotalW: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
    const joined = (res!.steps ?? []).join('\n');
    expect(joined).toContain('No fire temperature or FRP is fabricated');
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(32, { A: '1e6', eps: '0.98', Tfire: '850', Tbg: '300' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('param aliases: T_fire→Tfire, T_bg→Tbg, ε→eps via normalizeInputs', () => {
    const normalized = normalizeInputs(32, { T_fire: 850, T_bg: 300, ε: 0.98 } as unknown as Record<string, number>);
    expect(normalized['Tfire']).toBe(850);
    expect(normalized['Tbg']).toBe(300);
    expect(normalized['eps']).toBe(0.98);
  });
});
