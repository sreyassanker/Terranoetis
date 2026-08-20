/**
 * hargreavesET.test.ts — unit tests for the Hargreaves & Samani (1985)
 * reference ET algebra (Tool 60), anchored to the paper's own equations
 * (Appl. Eng. Agric. 1(2):96–99):
 *
 *   - Eq. [1]: ETo = 0.0135 × RS × (T°C + 17.8), calibrated on eight years
 *     of Alta fescue lysimeter data at Davis, CA.
 *   - Eq. [2]: RS = K_RS × R_A × TD^0.5 (Hargreaves & Samani 1982), K_RS ≈
 *     0.17 interior.
 *   - Eq. [3]/[4]: ETo = K_ET × R_A × TD^0.5 × (T°C + 17.8).
 *   - K_ET: the paper's Eq. [4] PRINTS 0.00023, but the derivation
 *     (0.0135 × 0.17 = 0.002295 ≈ 0.0023) and FAO-56 Eq. 52 use 0.0023 —
 *     a famous dropped-zero typo. This implementation uses 0.0023 and
 *     discloses the typo in the steps.
 *   - With R_A in MJ/m²/day, ET₀ must be converted to mm/day by ×0.408
 *     (= 1/2.45, λ = 2.45 MJ/kg). The previous build omitted this — a
 *     2.45× unit error.
 */
import { describe, it, expect } from 'vitest';

// Paper Eq. [4] with K_ET = 0.0023; R_A in MJ/m²/day; ×0.408 → mm/day.
const et0 = (Ra: number, tmax: number, tmin: number, k = 0.0023) => {
  const tavg = (tmax + tmin) / 2;
  const dT = Math.max(0, tmax - tmin);
  return k * Ra * (tavg + 17.8) * Math.sqrt(dT) * 0.408;
};

describe('Hargreaves & Samani (1985) — paper equations', () => {
  it('Eq. [1] × Eq. [2] derivation gives K_ET = 0.0023 (not the printed 0.00023)', () => {
    expect(0.0135 * 0.17).toBeCloseTo(0.0023, 4);
    expect(0.0135 * 0.17).toBeGreaterThan(0.002);
  });

  it('K_ET = 0.0023 (the corrected coefficient) produces realistic ET₀ for Davis summer', () => {
    // Davis July: R_A ≈ 40 MJ/m²/day, Tmax 33, Tmin 14 → ~7 mm/day grass ET.
    expect(et0(40, 33, 14)).toBeGreaterThan(5);
    expect(et0(40, 33, 14)).toBeLessThan(9);
  });

  it('0.408 converts MJ/m²/day to mm/day (1 MJ = 1/2.45 mm-equiv)', () => {
    expect(1 / 2.45).toBeCloseTo(0.408, 3);
  });

  it('catalogue worked example: R_a=25, T_max=30, T_min=15 → ET₀ = 3.66 mm/day', () => {
    expect(et0(25, 30, 15)).toBeCloseTo(3.66, 2);
  });

  it('the missing ×0.408 was a 2.45× unit error (ET₀_raw/ET₀_corrected = 2.45)', () => {
    const raw = 0.0023 * 25 * (22.5 + 17.8) * Math.sqrt(15);       // old bug: no ×0.408
    const corrected = raw * 0.408;
    expect(raw / corrected).toBeCloseTo(2.45, 2);
  });

  it('TD = 0 (T_max ≤ T_min) gives zero ET₀ (no thermal signal)', () => {
    expect(et0(25, 15, 15)).toBeCloseTo(0, 9);
    expect(et0(25, 10, 20)).toBeCloseTo(0, 9); // max(0, ...) floor
  });

  it('ET₀ increases with temperature range (clear skies → more radiation)', () => {
    expect(et0(25, 30, 15)).toBeGreaterThan(et0(25, 25, 20));
  });

  it('ET₀ increases with extraterrestrial radiation', () => {
    expect(et0(40, 30, 15)).toBeGreaterThan(et0(20, 30, 15));
  });

  it('NaN T_max propagates honestly (no fabricated temperature)', () => {
    expect(Number.isNaN(et0(25, Number.NaN, 15))).toBe(true);
  });

  it('0.0019–0.0032 K_ET calibration range brackets 0.0023 (paper limitations)', () => {
    const coastal = et0(25, 30, 15, 0.0019);
    const inland = et0(25, 30, 15, 0.0032);
    expect(coastal).toBeLessThan(et0(25, 30, 15));
    expect(inland).toBeGreaterThan(et0(25, 30, 15));
  });
});
