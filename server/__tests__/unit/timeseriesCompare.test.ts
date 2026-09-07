import { describe, it, expect } from 'vitest';
import {
  bucketQuakePeriods, quakeDelta, powerMean, annualMeansFromNsidc,
} from '../../data/timeseriesCompare';

const DAY = 86_400_000;
const SPLIT = Date.UTC(2026, 8, 1); // 2026-09-01

describe('bucketQuakePeriods', () => {
  const feats = [
    { properties: { time: SPLIT + 2 * DAY, mag: 4.2 } },   // current
    { properties: { time: SPLIT + 0.5 * DAY, mag: 5.1 } }, // current
    { properties: { time: SPLIT - 3 * DAY, mag: 3.0 } },   // previous
    { properties: { time: SPLIT - 40 * DAY, mag: 6.0 } },  // too old — ignored
    { properties: { time: '2026-08-25T00:00:00Z', mag: 3.6 } }, // ISO string handled
    { properties: { time: SPLIT - DAY, mag: null } },      // no mag — ignored
    { properties: {} },                                     // garbage — ignored
  ];

  it('splits into current/previous with honest stats', () => {
    const r = bucketQuakePeriods(feats, SPLIT, 30 * DAY);
    expect(r.current.count).toBe(2);
    expect(r.current.maxMag).toBe(5.1);
    expect(r.current.avgMag).toBeCloseTo(4.65, 2);
    expect(r.previous.count).toBe(2); // 3.0 + ISO 3.6
    expect(r.previous.maxMag).toBe(3.6);
  });

  it('empty input yields zeroed stats, not fabricated numbers', () => {
    const r = bucketQuakePeriods([], SPLIT, 30 * DAY);
    expect(r.current).toEqual({ count: 0, maxMag: null, avgMag: null });
  });
});

describe('quakeDelta', () => {
  it('computes count delta and pct change', () => {
    expect(quakeDelta({ count: 12, maxMag: 5, avgMag: 3 }, { count: 8, maxMag: 4, avgMag: 3 }))
      .toEqual({ deltaCount: 4, pctChange: 50 });
  });
  it('refuses a percentage without a baseline (no invented change)', () => {
    expect(quakeDelta({ count: 5, maxMag: 5, avgMag: 5 }, { count: 0, maxMag: null, avgMag: null }))
      .toEqual({ deltaCount: 5, pctChange: null });
  });
});

describe('powerMean', () => {
  it('averages valid values and drops -99/-999 missing sentinels', () => {
    const r = powerMean({ '20260901': 28.0, '20260902': 30.0, '20260903': -99, '20260904': -999 });
    expect(r).toEqual({ mean: 29.0, n: 2, min: 28.0, max: 30.0 });
  });
  it('all-missing returns nulls, never a fake mean', () => {
    expect(powerMean({ a: -99, b: -999 })).toEqual({ mean: null, n: 0, min: null, max: null });
    expect(powerMean(null)).toEqual({ mean: null, n: 0, min: null, max: null });
  });
});

describe('annualMeansFromNsidc', () => {
  const mk = (y: number, m: number, d: number, ext: number) => `${y},${m},${d},${ext},0,"1"`;
  const lines = [
    'year,mo,dy,extent,missing,source',
    ...Array.from({ length: 31 }, (_, i) => mk(2024, 1, i + 1, 15.0)),
    ...Array.from({ length: 31 }, (_, i) => mk(2025, 1, i + 1, 14.0)),
    ...Array.from({ length: 10 }, (_, i) => mk(2026, 1, i + 1, 13.0)), // <30 days → dropped
    'garbage,line',
  ];
  it('averages per year and drops partial years (<30 days)', () => {
    const r = annualMeansFromNsidc(lines);
    expect(r.map(x => x.year)).toEqual([2024, 2025]);
    expect(r[0].meanExtentMkm2).toBe(15.0);
    expect(r[1].days).toBe(31);
  });
});
