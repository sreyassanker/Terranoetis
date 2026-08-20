/**
 * growingDegreeDays.test.ts — unit tests for the McMaster & Wilhelm (1997)
 * growing degree-day algebra (Tool 58), anchored to the paper's own
 * published example (Agric. For. Meteorol. 87(4):291–300):
 *
 *   - Eq. (1): GDD = [(TMAX + TMIN)/2] − TBASE, with two interpretations.
 *   - Method 1 (§2.1) clamps the daily MEAN: if TAVG < TBASE then TAVG =
 *     TBASE (and TAVG = TUT when above); the most widespread form,
 *     particularly in simulation models and for small-grain cereals.
 *   - Method 2 (§2.2) clamps each EXTREME: if TMAX < TBASE then TMAX =
 *     TBASE; if TMIN < TBASE then TMIN = TBASE (same for TUT); the most
 *     common form for corn.
 *   - Table 1 (wheat, TBASE = 0 °C, no TUT): the 10-day hypothetical
 *     example sums to 46.5 °C·day (Method 1) and 51.0 °C·day (Method 2) —
 *     a 4.5 °C·day (~10 %) difference arising only on the five days where
 *     TMIN < 0 °C. Field data in the paper reach 83 % (wheat) and 376 %
 *     (corn) differences.
 */
import { describe, it, expect } from 'vitest';
import { gddMethods } from '../../analytical-models/engine';

// Paper Table 1 day series (TMAX, TMIN °C) — wheat, TBASE = 0 °C.
const TABLE1_DAYS: Array<[number, number]> = [
  [20, 10], [10, 1], [8, -2], [6, 0], [10, 5],
  [5, -5], [-2, -7], [-5, -10], [10, -2], [15, 2],
];

describe('McMaster & Wilhelm (1997) GDD — paper Table 1 (wheat, T_base = 0 °C)', () => {
  it('Method 1 sums to the paper\'s 46.5 °C·day', () => {
    const sum = TABLE1_DAYS.reduce((s, [tmax, tmin]) => s + gddMethods(tmax, tmin, 0, null).m1, 0);
    expect(sum).toBeCloseTo(46.5, 6);
  });
  it('Method 2 sums to the paper\'s 51.0 °C·day', () => {
    const sum = TABLE1_DAYS.reduce((s, [tmax, tmin]) => s + gddMethods(tmax, tmin, 0, null).m2, 0);
    expect(sum).toBeCloseTo(51.0, 6);
  });
  it('the two methods differ by exactly 4.5 °C·day on the paper example', () => {
    const m1 = TABLE1_DAYS.reduce((s, [tmax, tmin]) => s + gddMethods(tmax, tmin, 0, null).m1, 0);
    const m2 = TABLE1_DAYS.reduce((s, [tmax, tmin]) => s + gddMethods(tmax, tmin, 0, null).m2, 0);
    expect(m2 - m1).toBeCloseTo(4.5, 6);
  });
});

describe('method equivalence and divergence conditions (paper §4)', () => {
  it('methods agree on every day where TMIN ≥ TBASE (Table 1 days 1,2,4,5,10)', () => {
    for (const [tmax, tmin] of [[20, 10], [10, 1], [6, 0], [10, 5], [15, 2]]) {
      const { m1, m2 } = gddMethods(tmax, tmin, 0, null);
      expect(m1).toBeCloseTo(m2, 9);
    }
  });
  it('Method 2 exceeds Method 1 on the Table 1 days where TMIN < TBASE but TAVG > TBASE (days 3,6,9)', () => {
    // Days 3,6,9: TMIN < 0 yet TAVG ≥ 0 → the methods diverge. (Days 7,8
    // have TAVG < 0 too, so both clamp to zero and agree.)
    for (const [tmax, tmin] of [[8, -2], [5, -5], [10, -2]]) {
      const { m1, m2 } = gddMethods(tmax, tmin, 0, null);
      expect(m2).toBeGreaterThan(m1);
    }
  });
  it('Method 1 clamps the mean: TAVG below TBASE contributes zero', () => {
    // TMAX = -2, TMIN = -7 → TAVG = -4.5 < 0 → both methods give 0.
    const { m1, m2 } = gddMethods(-2, -7, 0, null);
    expect(m1).toBe(0);
    expect(m2).toBe(0);
  });
  it('upper threshold (TUT) binds only above the threshold (paper §3)', () => {
    // Corn T_base = 10, TUT = 30. TMAX = 35, TMIN = 25:
    //   M1: TAVG = 30 → clamp to 30 → GDD = 20
    //   M2: TMAX 35 → 30, TMIN 25 → GDD = (30+25)/2 − 10 = 17.5
    const { m1, m2 } = gddMethods(35, 25, 10, 30);
    expect(m1).toBeCloseTo(20, 9);
    expect(m2).toBeCloseTo(17.5, 9);
  });
  it('no development below TBASE even with TUT set (wheat winter day)', () => {
    const { m1, m2 } = gddMethods(-5, -10, 0, 25);
    expect(m1).toBe(0);
    expect(m2).toBe(0);
  });
  it('NaN inputs propagate honestly (no fabricated value)', () => {
    const { m1, m2 } = gddMethods(Number.NaN, 10, 0, null);
    expect(Number.isNaN(m1)).toBe(true);
    expect(Number.isNaN(m2)).toBe(true);
  });
});
