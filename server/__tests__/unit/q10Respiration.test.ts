import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 46 — Q₁₀ Soil Respiration (van't Hoff 1898) ────────────────
// R_s = R_base · Q₁₀^((T−T_base)/10).
// Worked example (frontend-cited): R_base=2, Q₁₀=2, T=20 °C, T_base=10 °C
//   → R_s = 2·2^1 = 4 µmol CO₂/m²/s.
// Activation energy E_a = ln(Q₁₀)·R·T²/10; annual flux = R_s·12.01·86400·365/1e6.

describe('Tool 46 — Q₁₀ Soil Respiration', () => {
  it('worked example: R_base=2, Q₁₀=2, T=20, T_base=10 → R_s=4 µmol/m²/s', () => {
    const res = computeEquation(46, { Rbase: 2, Q10: 2, T: 20, Tbase: 10 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(4, 9);
    expect(res!.unit).toBe('µmol CO₂/m²/s');
  });

  it('respiration doubles per 10 °C when Q₁₀=2', () => {
    const t10 = computeEquation(46, { Rbase: 2, Q10: 2, T: 10, Tbase: 10 });
    const t20 = computeEquation(46, { Rbase: 2, Q10: 2, T: 20, Tbase: 10 });
    const t30 = computeEquation(46, { Rbase: 2, Q10: 2, T: 30, Tbase: 10 });
    expect(t10!.result).toBeCloseTo(2, 9);
    expect(t20!.result).toBeCloseTo(4, 9);
    expect(t30!.result).toBeCloseTo(8, 9);
  });

  it('higher Q₁₀ → stronger temperature response', () => {
    const q15 = computeEquation(46, { Rbase: 2, Q10: 1.5, T: 30, Tbase: 10 });
    const q25 = computeEquation(46, { Rbase: 2, Q10: 2.5, T: 30, Tbase: 10 });
    expect(q25!.result).toBeGreaterThan(q15!.result);
  });

  it('exposes activation_energy and annual_carbon_flux as secondary', () => {
    const res = computeEquation(46, { Rbase: 2, Q10: 2, T: 20, Tbase: 10 });
    const sec = res!.secondary ?? [];
    const Ea = sec.find((s) => s.key === 'activation_energy');
    const flux = sec.find((s) => s.key === 'annual_carbon_flux');
    // E_a = ln(2)·8.314e-3·293.15²/10 ≈ 49.5 kJ/mol
    expect(Ea?.value).toBeCloseTo(Math.log(2) * 8.314e-3 * 293.15 * 293.15 / 10, 1);
    expect(Ea?.unit).toBe('kJ/mol');
    // F_C = 4·12.01·86400·365/1e6 ≈ 1516 gC/m²/yr
    expect(flux?.value).toBeCloseTo(4 * 12.01 * 86400 * 365 / 1e6, 0);
    expect(flux?.unit).toBe('gC/m²/yr');
  });

  it('emits the R_s(T) series (timeseries tool)', () => {
    const res = computeEquation(46, { Rbase: 2, Q10: 2, T: 20, Tbase: 10 });
    expect(res!.series).toBeDefined();
    expect(res!.series!.length).toBe(1);
    expect(res!.series![0].points.length).toBeGreaterThan(10);
    for (const p of res!.series![0].points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('does NOT throw when inputs arrive as strings (numeric coercion)', () => {
    const res = computeEquation(46, { Rbase: '2', Q10: '2', T: '20', Tbase: '10' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(4, 9);
  });

  it('returns honest NaN when a genuine input is missing (no fabricated R_s)', () => {
    const res = computeEquation(46, { Rbase: Number.NaN, Q10: Number.NaN, T: Number.NaN, Tbase: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('param alias: Q₁₀→Q10 via normalizeInputs', () => {
    const normalized = normalizeInputs(46, { 'Q₁₀': 2 } as unknown as Record<string, number>);
    expect(normalized['Q10']).toBe(2);
  });
});
