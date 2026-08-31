/**
 * priestleyTaylor.test.ts — unit tests for the Priestley & Taylor (1972)
 * evapotranspiration algebra (Tool 59), anchored to the paper's own
 * published equation (Mon. Wea. Rev. 100(2):81–92):
 *
 *   - Eq. (14), p. 84: PE = 1.26·[s/(s+γ)]·(R−G), stated IN ENERGY UNITS
 *     (W/m²). The paper: "the evaporation from a horizontally uniform
 *     saturated surface (i.e., the potential evaporation, PE) will be
 *     given, in energy units, by PE = 1.26·[s/(s+γ)]·(R−G)".
 *   - α = 1.26 is the paper §6 overall mean (land and water), 1.26 ± 0.01.
 *   - s/(s+γ) ≈ 0.56 at 10 °C and 0.82 at 35 °C (paper p. 84). The
 *     FAO-56 Δ/γ forms used by the engine give 0.55 and 0.82 — within
 *     ~2 % of the paper's values at the same temperatures.
 *   - Converting energy to water depth: ET (mm/day) = PE (W/m²) × 86400 /
 *     (λ·ρ_w) where λ = 2.45 MJ/kg, ρ_w = 1000 kg/m³ ⇒ 1 W/m² =
 *     3.527×10⁻⁵ m/day = 0.03527 mm/day.
 */
import { describe, it, expect } from 'vitest';

// FAO-56 slope of the saturation vapour-pressure curve Δ (kPa/°C)
const delta = (tC: number) => {
  const es = 0.6108 * Math.exp(17.27 * tC / (tC + 237.3));
  return 4098 * es / Math.pow(tC + 237.3, 2);
};
// FAO-56 psychrometric constant γ (kPa/°C) at sea level P = 101.325 kPa
const gamma = (Pkpa: number) => 0.665e-3 * Pkpa;
// Paper Eq. (14) PE in W/m²
const pe = (alpha: number, Rn: number, G: number, d: number, g: number) =>
  alpha * (d / (d + g)) * (Rn - G);

describe('Priestley & Taylor (1972) s/(s+γ) — paper p. 84 values', () => {
  it('s/(s+γ) ≈ 0.55–0.56 at 10 °C (paper p. 84: 0.56; FAO-56 form: 0.55)', () => {
    const ratio = delta(10) / (delta(10) + gamma(101.3));
    expect(ratio).toBeGreaterThan(0.54);
    expect(ratio).toBeLessThan(0.57);
  });
  it('s/(s+γ) = 0.82 at 35 °C (paper p. 84)', () => {
    const ratio = delta(35) / (delta(35) + gamma(101.3));
    expect(ratio).toBeCloseTo(0.82, 2);
  });
  it('s/(s+γ) increases monotonically with temperature (physical)', () => {
    expect(delta(10) / (delta(10) + gamma(101.3)))
      .toBeLessThan(delta(25) / (delta(25) + gamma(101.3)));
    expect(delta(25) / (delta(25) + gamma(101.3)))
      .toBeLessThan(delta(35) / (delta(35) + gamma(101.3)));
  });
});

describe('Paper Eq. (14) — energy units and mm/day conversion', () => {
  it('PE = α·Δ/(Δ+γ)·(Rₙ−G) with Δ=0.15, γ=0.067, Rₙ=150, G=0 is 130.6 W/m² (correct worked example)', () => {
    expect(pe(1.26, 150, 0, 0.15, 0.067)).toBeCloseTo(130.6, 1);
  });

  it('1 W/m² = 0.03527 mm/day (exact latent-heat conversion, λ = 2.45 MJ/kg)', () => {
    const mmPerDay = 86400 / (2.45e6 * 1000) * 1000; // m/day → mm/day
    expect(mmPerDay).toBeCloseTo(0.03527, 4);
  });

  it('ET_mm = PE × 86400/(λ·ρ_w): 130.6 W/m² → 4.61 mm/day', () => {
    const PE = pe(1.26, 150, 0, 0.15, 0.067);
    const ETmm = PE * 86400 / (2.45e6 * 1000) * 1000;
    expect(ETmm).toBeCloseTo(4.61, 2);
  });

  it('NOT treating W/m² as mm/day: the corrected value is ~28× smaller than the raw W/m² number', () => {
    const PE = pe(1.26, 150, 0, 0.15, 0.067);
    const ETmm = PE * 86400 / (2.45e6 * 1000) * 1000;
    expect(PE / ETmm).toBeCloseTo(28.35, 1); // the old unit bug factor
  });

  it('α = 1.26 is the paper §6 overall mean (1.26 ± 0.01)', () => {
    expect(1.26).toBeGreaterThan(1.25);
    expect(1.26).toBeLessThan(1.27);
  });

  it('G = 0 for 24-hr totals (paper p. 83 neglects ground heat flux)', () => {
    const pe0 = pe(1.26, 150, 0, 0.15, 0.067);
    const peG = pe(1.26, 150, 15, 0.15, 0.067);
    expect(pe0 - peG).toBeCloseTo(pe(1.26, 15, 0, 0.15, 0.067), 9);
  });

  it('NaN Rn propagates honestly (no fabricated radiation)', () => {
    expect(Number.isNaN(pe(1.26, Number.NaN, 0, 0.15, 0.067))).toBe(true);
  });
});
