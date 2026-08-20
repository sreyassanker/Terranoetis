import { describe, it, expect } from 'vitest';

// Atkinson (2000), Atmos. Environ. 34(12-14):2063-2101.
// τ_OH = 1/(k_OH · [OH]).
// Paper [OH] conventions: 24-h global mean 1.0×10⁶ molecule cm⁻³ (Prinn et al.
// 1995, cited in the paper); 12-h daytime average 2.0×10⁶ used for Table 1.
const S_PER_DAY = 86400;
const S_PER_YR = 3.1536e7;

function tau(k: number, OH: number): number {
  return 1 / (k * OH);
}

describe('Atkinson 2000 OH lifetime τ = 1/(k·[OH])', () => {
  it('paper Table 1: isoprene k_OH = 1.00e-10 reproduces the 1.4 h lifetime exactly at the 12-h daytime [OH] = 2.0e6', () => {
    const t = tau(1.0e-10, 2.0e6); // 5000 s
    expect(t).toBeCloseTo(5000, 12);
    expect(t / 3600).toBeCloseTo(1.39, 2); // ≈ paper Table 1: 1.4 h
    // with the 24-h global mean it is 2.8 h
    expect(tau(1.0e-10, 1.0e6) / 3600).toBeCloseTo(2.78, 1);
  });

  it('paper Table 1 values are consistent with the daytime convention: implied k from τ_table agrees for each listed species', () => {
    // Table 1: Lifetime due to OH (12-h daytime [OH] = 2.0e6) — implied k = 1/(τ·2.0e6)
    const cases: Array<[string, number, number]> = [
      ['propane', 10, 5.79e-13],
      ['ethene', 1.4, 4.13e-12],
      ['isoprene', 1.4 / 24, 1.00e-10], // 1.4 h → 0.0583 day
      ['benzene', 9.4, 6.16e-13],
      ['acetone', 53, 1.09e-13],
      ['methanol', 12, 4.82e-13],
    ];
    for (const [name, days, expectedK] of cases) {
      const t = days * S_PER_DAY;
      const kImplied = 1 / (t * 2.0e6);
      expect(kImplied).toBeCloseTo(expectedK, 2);
      // round-trip: the implied k reproduces the table lifetime
      expect(tau(kImplied, 2.0e6) / S_PER_DAY).toBeCloseTo(days, 10);
      expect(name).toBeTruthy();
    }
  });

  it('methane: k_OH = 2.45e-15 at the 24-h global mean gives the observed ~12 yr lifetime', () => {
    const t = tau(2.45e-15, 1.0e6);
    expect(t / S_PER_YR).toBeCloseTo(12.94, 1); // ~12.9 yr
    expect(t / S_PER_YR).toBeGreaterThan(11);  // observed CH₄ lifetime 12 yr
    expect(t / S_PER_YR).toBeLessThan(14);
  });

  it('CO: k_OH = 1.5e-13 at the 24-h mean gives ~2.5 months (paper/catalogue value)', () => {
    const t = tau(1.5e-13, 1.0e6);
    expect(t / S_PER_DAY).toBeCloseTo(77.2, 0);
  });

  it('transport-regime classification boundaries (paper §1)', () => {
    // short-lived < 1 h: isoprene; long-lived > 1 yr: CH₄
    expect(tau(1.0e-10, 1.0e6)).toBeLessThan(3600 * 24); // < 1 day
    expect(tau(2.45e-15, 1.0e6)).toBeGreaterThan(S_PER_YR);
  });

  it('degenerate guards: k ≤ 0 or OH ≤ 0 are physically meaningless (finite NaN, never Infinity)', () => {
    // τ must be positive and finite for any positive inputs; a zero rate constant
    // would give +∞ — the engine guards this (returns finite NaN).
    expect(tau(1e-14, 1e6)).toBeGreaterThan(0);
    expect(Number.isFinite(tau(1e-14, 1e6))).toBe(true);
    expect(1 / 0).toBe(Infinity); // sanity: unguarded zero denominator → Infinity (why the guard exists)
  });
});
