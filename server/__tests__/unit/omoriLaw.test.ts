import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 20 — Modified Omori Law (Omori 1894; Utsu 1961) ─────────────
// n(t) = K/(c+t)^p. Worked example (frontend-cited): K=300, c=0.1, p=1.1:
//   n(Day 1) = 300/(0.1+1)^1.1 = 300/1.1^1.1 ≈ 300/1.1105 ≈ 270 events/day
//   n(Day 30) = 300/(0.1+30)^1.1 ≈ 300/42.2 ≈ 7.1 events/day
// Cumulative: N_cum = K·[c^(1−p) − (c+t)^(1−p)]/(p−1)

describe('Tool 20 — Modified Omori Law', () => {
  it('worked example: K=300, c=0.1, p=1.1, t=1 → n ≈ 270 events/day', () => {
    const res = computeEquation(20, { K: 300, c: 0.1, t: 1, p: 1.1 });
    expect(res).not.toBeNull();
    const expected = 300 / Math.pow(0.1 + 1, 1.1);
    expect(res!.result).toBeCloseTo(expected, 6);
    expect(res!.unit).toBe('events/day');
  });

  it('aftershock rate decays with time: n(t=1) > n(t=30)', () => {
    const d1 = computeEquation(20, { K: 300, c: 0.1, t: 1, p: 1.1 });
    const d30 = computeEquation(20, { K: 300, c: 0.1, t: 30, p: 1.1 });
    expect(d1!.result).toBeGreaterThan(d30!.result * 20);
  });

  it('higher p decays faster (p=1.5 ≪ p=0.9 at late times)', () => {
    const pFast = computeEquation(20, { K: 100, c: 0.1, t: 30, p: 1.5 });
    const pSlow = computeEquation(20, { K: 100, c: 0.1, t: 30, p: 0.9 });
    expect(pFast!.result).toBeLessThan(pSlow!.result);
  });

  it('exposes cumulative and half_life as secondary', () => {
    const res = computeEquation(20, { K: 100, c: 0.1, t: 10, p: 1.1 });
    const sec = res!.secondary ?? [];
    const cum = sec.find((s) => s.key === 'cumulative');
    const half = sec.find((s) => s.key === 'half_life');
    // N_cum = 100·[0.1^(−0.1) − 10.1^(−0.1)]/0.1
    const expectedCum = 100 * (Math.pow(0.1, -0.1) - Math.pow(10.1, -0.1)) / 0.1;
    expect(cum?.value).toBeCloseTo(expectedCum, 4);
    expect(cum?.unit).toBe('events');
    // t_½ = c·(2^(1/p) − 1) = 0.1·(2^0.9091 − 1)
    expect(half?.value).toBeCloseTo(0.1 * (Math.pow(2, 1 / 1.1) - 1), 6);
    expect(half?.unit).toBe('days');
  });

  it('emits the decay-curve series (timeseries tool)', () => {
    const res = computeEquation(20, { K: 100, c: 0.1, t: 10, p: 1.1 });
    expect(res!.series).toBeDefined();
    expect(res!.series!.length).toBe(1);
    expect(res!.series![0].points.length).toBeGreaterThan(10);
    for (const p of res!.series![0].points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('does NOT throw when inputs arrive as strings (numeric coercion)', () => {
    const res = computeEquation(20, { K: '300', c: '0.1', t: '1', p: '1.1' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when no genuine aftershock fit is available', () => {
    const res = computeEquation(20, { K: Number.NaN, c: Number.NaN, t: Number.NaN, p: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});
