import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

describe('Eq 65 — Atmospheric OH Oxidation Lifetime (Atkinson, 2000)', () => {
  it('computes correct pseudo-first-order lifetime for isoprene', () => {
    // Isoprene: k_OH = 1.0e-10 cm³/molecule·s, [OH] = 2.0e6 molecule/cm³ (12-h daytime mean)
    // tau = 1 / (1.0e-10 * 2.0e6) = 1 / 2.0e-4 = 5000 s (~1.39 hours)
    const res = computeEquation(65, { k: 1.0e-10, OH: 2.0e6 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(5000, 1);
    expect(res!.unit).toBe('s');

    const lifetimeDays = res!.secondary?.find(s => s.key === 'lifetime_days')?.value;
    expect(lifetimeDays).toBeCloseTo(5000 / 86400, 3);
  });

  it('supports [OH] symbol alias in input', () => {
    const res = computeEquation(65, { k: 1.0e-10, '[OH]': 2.0e6 } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(5000, 1);
  });

  it('computes methane lifetime order of magnitude at global mean [OH]', () => {
    // CH4: k_OH ~ 2.45e-15 cm³/molecule·s at 298 K, [OH] ~ 1.0e6 molecule/cm³ (24-h global mean)
    // tau = 1 / (2.45e-15 * 1.0e6) ~ 4.08e8 s (~12.9 yr)
    const res = computeEquation(65, { k: 2.45e-15, OH: 1.0e6 });
    expect(res).not.toBeNull();
    const lifetimeYrs = res!.secondary?.find(s => s.key === 'lifetime_years')?.value;
    expect(lifetimeYrs).toBeGreaterThan(10);
    expect(lifetimeYrs).toBeLessThan(15);
  });

  it('returns honest NaN on non-positive or missing inputs', () => {
    const resZero = computeEquation(65, { k: 0, OH: 2.0e6 });
    expect(Number.isNaN(resZero!.result)).toBe(true);

    const resNeg = computeEquation(65, { k: 1.0e-10, OH: -100 });
    expect(Number.isNaN(resNeg!.result)).toBe(true);

    const resMissing = computeEquation(65, {});
    expect(Number.isNaN(resMissing!.result)).toBe(true);
  });
});
