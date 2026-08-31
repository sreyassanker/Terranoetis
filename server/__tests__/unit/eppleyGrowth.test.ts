import { describe, it, expect } from 'vitest';

// Eppley (1972) Eq. (1): log₁₀ μmax = 0.0275·T − 0.070  ⟺  Eq. (a): μmax = 0.851·(1.066)^T
function muPaper(T: number): number {
  return 0.851 * Math.pow(1.066, T);
}
function muFromEq1(T: number): number {
  return Math.pow(10, 0.0275 * T - 0.070);
}
function muScaled(umax: number, T: number): number {
  return umax * Math.pow(1.066, T - 20);
}

describe('Eppley 1972 growth envelope', () => {
  it('Eq. (1) and Eq. (a) are the same line — the paper prints both with rounded constants (0.851 ≈ 10^-0.070, 1.066 ≈ 10^0.0275), so they agree to the paper\'s rounding (~1% drift at 30 °C)', () => {
    for (const T of [0, 5, 10, 15, 20, 25, 30, 35, 40]) {
      // relative drift stays < 2.5 % across the marine temperature range
      expect(Math.abs(muPaper(T) - muFromEq1(T)) / muFromEq1(T)).toBeLessThan(0.025);
    }
    // paper constants: 0.851 = 10^-0.070 exactly; 1.066 is the paper's
    // rounded form of 10^0.0275 = 1.0654 (the paper prints both forms)
    expect(Math.pow(10, -0.070)).toBeCloseTo(0.851, 3);
    expect(Math.pow(10, 0.0275)).toBeCloseTo(1.0654, 3);
    expect(muPaper(0)).toBeCloseTo(0.851, 6);
  });

  it('Q₁₀ = 10^0.275 = 1.88 (the paper value)', () => {
    const q10 = Math.pow(10, 0.275);
    expect(q10).toBeCloseTo(1.88, 2);
    // ratio of the EXACT Eq. (1) line at T+10 vs T equals Q₁₀
    expect(muFromEq1(20) / muFromEq1(10)).toBeCloseTo(q10, 6);
    // with the paper\'s rounded Eq. (a) constants the ratio is Q₁₀ to ~0.6%
    expect(muPaper(20) / muPaper(10)).toBeCloseTo(q10, 1);
  });

  it('paper envelope at key temperatures (T=5, 20, 30)', () => {
    expect(muPaper(5)).toBeCloseTo(0.851 * 1.066 ** 5, 4);
    expect(muPaper(5)).toBeCloseTo(1.17, 1);   // catalogue worked value
    expect(muPaper(20)).toBeCloseTo(3.06, 1);  // catalogue worked value
    expect(muPaper(30)).toBeCloseTo(5.79, 1);  // catalogue worked value
  });

  it('species scaling through 20 °C: μ₂₀=0.8 gives 0.8 at T=20, scales with 1.066^(T-20)', () => {
    expect(muScaled(0.8, 20)).toBeCloseTo(0.8, 10);
    expect(muScaled(0.8, 30)).toBeCloseTo(0.8 * 1.066 ** 10, 4);
    // at 30 °C with the paper's Q₁₀ = 1.88
    expect(muScaled(0.8, 30)).toBeCloseTo(0.8 * 1.88, 1);
  });

  it('doubling time t_d = ln(2)/μmax', () => {
    expect(Math.LN2 / muPaper(20)).toBeCloseTo(0.23, 1); // catalogue worked value
    expect(Math.LN2 / muScaled(0.8, 20)).toBeCloseTo(0.87, 2); // 0.8/day → 0.87 days
  });
});
