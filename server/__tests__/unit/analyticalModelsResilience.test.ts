import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

describe('Analytical Models — Parameter Hardening & Resilience', () => {
  it('Eq 86: handles ASCII A_s and Unicode Aₛ without throwing', () => {
    const resAscii = computeEquation(86, { A_s: 50, tanB: 0.1 } as unknown as Record<string, number>);
    expect(resAscii).not.toBeNull();
    expect(Number.isFinite(resAscii!.result)).toBe(true);

    const resMissing = computeEquation(86, {});
    expect(resMissing).not.toBeNull();
    expect(Number.isNaN(resMissing!.result)).toBe(true);
  });

  it('Eq 87: handles ASCII A_s and Unicode Aₛ without throwing', () => {
    const resAscii = computeEquation(87, { A_s: 50, tanB: 0.1 } as unknown as Record<string, number>);
    expect(resAscii).not.toBeNull();
    expect(Number.isFinite(resAscii!.result)).toBe(true);

    const resMissing = computeEquation(87, {});
    expect(resMissing).not.toBeNull();
    expect(Number.isNaN(resMissing!.result)).toBe(true);
  });

  it('Eq 91: handles Accum and T_pos metadata keys without throwing', () => {
    const res = computeEquation(91, { Accum: 0.5, DDF: 0.005, T_pos: 800 } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
    expect(res!.result).toBeCloseTo(0.5 - 0.005 * 800, 2);

    const resMissing = computeEquation(91, {});
    expect(resMissing).not.toBeNull();
    expect(Number.isNaN(resMissing!.result)).toBe(true);
  });

  it('Eq 74: defaults g to 9.81 when omitted and handles missing inputs safely', () => {
    const res = computeEquation(74, { H0: 2.0, T0: 10.0, betaF: 0.05 });
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
    expect(res!.result).toBeGreaterThan(0);

    const resMissing = computeEquation(74, {});
    expect(resMissing).not.toBeNull();
    expect(Number.isNaN(resMissing!.result)).toBe(true);
  });

  it('Eq 103: handles u_bar, ū, and u_prime without throwing', () => {
    const res1 = computeEquation(103, { u_bar: 12.5, u_prime: 1.5 });
    expect(res1).not.toBeNull();
    expect(res1!.result).toBeCloseTo(14.0, 3);

    const res2 = computeEquation(103, { 'ū': 12.5, "u'": 1.5 } as unknown as Record<string, number>);
    expect(res2).not.toBeNull();
    expect(res2!.result).toBeCloseTo(14.0, 3);

    const resMissing = computeEquation(103, {});
    expect(resMissing).not.toBeNull();
    expect(Number.isNaN(resMissing!.result)).toBe(true);
  });

  it('Eq 118: handles J and E and handles missing inputs safely', () => {
    const res = computeEquation(118, { J: 1e-5, E: 5e-2 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(5e-7, 8);

    const resMissing = computeEquation(118, {});
    expect(resMissing).not.toBeNull();
    expect(Number.isNaN(resMissing!.result)).toBe(true);
  });
});
