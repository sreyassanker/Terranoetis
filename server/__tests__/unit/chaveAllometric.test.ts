import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 55 — Allometric Biomass (Chave et al. 2014) ──────────────────
// Paper: Chave, J. et al. (2014) Improved allometric models to estimate
// the aboveground biomass of tropical trees. Global Change Biology
// 20(10):3177-3190. doi:10.1111/gcb.12629.
//
//   Eq. 7 (height-unavailable): AGB = exp[−1.803 − 0.976·E + 0.976·ln(ρ)
//      + 2.673·ln(D) − 0.0299·(ln D)²], D in cm, ρ in g/cm³
//   Eq. 6b: E = (0.178·TS − 0.938·CWD − 6.61·PS)×10⁻³
//   Carbon fraction 0.47 (IPCC default); CO₂/C mass ratio 3.67.
//   Calibrated on 4004 harvested tropical trees, RSE = 0.413, bias +9.71 %.

describe('Tool 55 — Allometric Biomass', () => {
  // Frontend-cited worked example: D=30 cm, ρ=0.58 g/cm³, E=−0.05 → AGB ≈ 639 kg
  it('worked example: D=30, ρ=0.58, E=−0.05 → AGB ≈ 638.8 kg', () => {
    const res = computeEquation(55, { DBH: 30, rho: 0.58, E: -0.05 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(638.8, 1);
    expect(res!.unit).toBe('kg');
  });

  it('D=50 cm → ~2238 kg (frontend-cited ~2240)', () => {
    const res = computeEquation(55, { DBH: 50, rho: 0.58, E: -0.05 });
    expect(res!.result).toBeCloseTo(2238, 0);
  });

  it('D=100 cm → ~11964 kg (frontend-cited ~12000)', () => {
    const res = computeEquation(55, { DBH: 100, rho: 0.58, E: -0.05 });
    expect(res!.result).toBeCloseTo(11964, 0);
  });

  // Secondary outputs: carbon content (0.47) and CO₂ equivalent (3.67×C, in tonnes)
  it('exposes carbon_content and co2_equivalent as secondary', () => {
    const res = computeEquation(55, { DBH: 30, rho: 0.58, E: -0.05 });
    const sec = res!.secondary ?? [];
    const c = sec.find((s) => s.key === 'carbon_content');
    const co2 = sec.find((s) => s.key === 'co2_equivalent');
    expect(c?.value).toBeCloseTo(638.8 * 0.47, 1);
    expect(c?.unit).toBe('kgC');
    // CO₂ equivalent in tonnes: (C_kg × 3.67) / 1000
    expect(co2?.value).toBeCloseTo(638.8 * 0.47 * 3.67 / 1000, 3);
    expect(co2?.unit).toBe('tCO₂');
  });

  // Wood density drives biomass: dense wood (0.9) ≫ light wood (0.4)
  it('dense wood (ρ=0.9) has ~2× biomass of light wood (ρ=0.4)', () => {
    const dense = computeEquation(55, { DBH: 50, rho: 0.9, E: -0.05 });
    const light = computeEquation(55, { DBH: 50, rho: 0.4, E: -0.05 });
    expect(dense!.result / light!.result).toBeGreaterThan(2);
    expect(dense!.result / light!.result).toBeLessThan(3);
  });

  // Bioclimatic stress: higher E → less biomass (negative coefficient)
  it('higher bioclimatic stress E reduces AGB', () => {
    const eLow = computeEquation(55, { DBH: 30, rho: 0.58, E: -0.1 });
    const eHigh = computeEquation(55, { DBH: 30, rho: 0.58, E: 0.2 });
    expect(eLow!.result).toBeGreaterThan(eHigh!.result);
  });

  // String-input regression (numeric coercion)
  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(55, { DBH: '30', rho: '0.58', E: '-0.05' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(638.8, 1);
  });

  // Honest NaN: all inputs are field measurements with no open API
  it('returns honest NaN when inputs are missing (no fabricated AGB)', () => {
    const res = computeEquation(55, { DBH: Number.NaN, rho: Number.NaN, E: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
    for (const s of res!.secondary ?? []) expect(Number.isNaN(s.value)).toBe(true);
  });

  // Zero / non-positive DBH must not produce a plausible-looking number
  it('DBH ≤ 0 yields NaN (honest)', () => {
    const res = computeEquation(55, { DBH: 0, rho: 0.58, E: -0.05 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  // Param alias: frontend uses D (symbol) — engine reads DBH
  it('param alias D→DBH works via normalizeInputs', () => {
    const normalized = normalizeInputs(55, { D: 30 } as unknown as Record<string, number>);
    expect(normalized['DBH']).toBe(30);
  });
});
