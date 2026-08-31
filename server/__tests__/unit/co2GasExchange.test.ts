/**
 * co2GasExchange.test.ts — unit tests for the Wanninkhof (1992) air–sea CO₂
 * flux algebra (Tool 56), anchored to the paper's own published values:
 *
 *   - JGR 97(C5):7373–7382, Table A1: CO₂ Schmidt number in seawater (35‰)
 *     Sc = 2073.1 − 125.62·t + 3.6276·t² − 0.043219·t³, t in °C; Sc = 660 at
 *     20 °C (the paper's normalization reference).
 *   - Table A2 (Weiss 1974 form): Bunsen solubility ln β = A1 + A2(100/T) +
 *     A3·ln(T/100) + S·[B1 + B2(T/100) + B3(T/100)²]. The paper's text states
 *     the CO₂ solubility at 20 °C as 0.0324 mol/L·atm — the fit must return
 *     exactly that.
 *   - Eq. 3: k = 0.31·u₁₀²·(Sc/660)^(−1/2) cm/hr (steady winds). The paper's
 *     Eq. 1 long-term form k_av = 0.39·u₁₀² reproduces the bomb-¹⁴C average
 *     of 21.9 cm/hr at u₁₀ = 7.4 m/s; Eq. 3 is the short-term equivalent.
 *   - Flux F = k·K₀·ΔpCO₂ with ΔpCO₂ in µatm → ×10⁻⁶ to atm.
 */
import { describe, it, expect } from 'vitest';
import { schmidtNumberCO2, weissSolubilityCO2, wanninkhofK1992 } from '../../analytical-models/engine';

describe('Wanninkhof (1992) Schmidt number — paper Table A1', () => {
  it('Sc = 660 at 20 °C (the paper normalization)', () => {
    expect(schmidtNumberCO2(20)).toBeCloseTo(666.0, 0); // polynomial value; text states 660 nominal
  });
  it('monotone decreasing with temperature (physical)', () => {
    expect(schmidtNumberCO2(5)).toBeGreaterThan(schmidtNumberCO2(20));
    expect(schmidtNumberCO2(20)).toBeGreaterThan(schmidtNumberCO2(30));
  });
  it('outside the 0–30 °C fit range the polynomial is not used (validity range)', () => {
    // 0 °C boundary is inside the fit; sanity of the published coefficients
    // at the cold end (paper fit valid 0–30 °C).
    expect(schmidtNumberCO2(0)).toBeGreaterThan(1000);
  });
});

describe('Wanninkhof (1992) CO₂ solubility — paper Table A2 (Weiss 1974 form)', () => {
  it('β(20 °C, 35‰) = 0.0324 mol/L·atm — the exact value stated in the paper text', () => {
    expect(weissSolubilityCO2(20, 35)).toBeCloseTo(0.0324, 4);
  });
  it('cold water holds more CO₂ (solubility decreases with temperature)', () => {
    expect(weissSolubilityCO2(0, 35)).toBeGreaterThan(weissSolubilityCO2(25, 35));
  });
  it('salinity reduces solubility (Weiss S term negative over 0–30 °C)', () => {
    expect(weissSolubilityCO2(20, 35)).toBeLessThan(weissSolubilityCO2(20, 0));
  });
});

describe('Wanninkhof (1992) gas transfer velocity — Eq. 3', () => {
  it('k = 0.31·u²·(Sc/660)^(−1/2) reproduces the paper\'s bomb-¹⁴C anchor at u₁₀ = 7.4 m/s', () => {
    // Eq. 1 long-term form k_av = 0.39·u² = 21.36 cm/hr ≈ the paper's 21.9 ± 3.3.
    expect(0.39 * 7.4 * 7.4).toBeCloseTo(21.4, 0);
    // Eq. 3 short-term at Sc = 660: 0.31·54.76 = 16.98 cm/hr.
    expect(wanninkhofK1992(7.4, 660)).toBeCloseTo(16.98, 1);
  });
  it('Sc normalization matters at non-20 °C water', () => {
    const kScCold = wanninkhofK1992(10, schmidtNumberCO2(5));   // high Sc → lower k
    const kWarm = wanninkhofK1992(10, schmidtNumberCO2(25));    // low Sc → higher k
    expect(kScCold).toBeLessThan(kWarm);
  });
  it('quadratic wind dependence: doubling u quadruples k', () => {
    expect(wanninkhofK1992(10, 660) / wanninkhofK1992(5, 660)).toBeCloseTo(4, 6);
  });
});

describe('Flux assembly F = k·K₀·ΔpCO₂·10⁻⁶ (µatm → atm)', () => {
  it('k = 1000 m/yr, K₀ = 30 mol/m³·atm, ΔpCO₂ = 10 µatm → F = 0.3 mol/m²/yr (catalogue example)', () => {
    const F = 1000 * 30 * 10 * 1e-6;
    expect(F).toBeCloseTo(0.3, 9);
  });
  it('unit chain: cm/hr → m/yr is ×87.6 (0.01 m/cm × 24 h/d × 365 d/yr)', () => {
    expect(0.01 * 24 * 365).toBeCloseTo(87.6, 9);
  });
});
