import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 34 — Degree-Day Snowmelt (Hock 2003) ────────────────────────
// M = DDF × max(0, T_air − T_base). DDF is site-calibrated (no global source).
// Worked example: DDF=5, T_air=5, T_base=0 → M=25 mm/day.

describe('Tool 34 — Degree-Day Snowmelt', () => {
  it('worked example: DDF=5, T_air=5, T_base=0 → M=25 mm/day', () => {
    const res = computeEquation(34, { DDF: 5, Tair: 5, Tbase: 0 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(25, 9);
    expect(res!.unit).toBe('mm/day');
  });

  it('no melt when T_air ≤ T_base', () => {
    const res = computeEquation(34, { DDF: 5, Tair: -2, Tbase: 0 });
    expect(res!.result).toBeCloseTo(0, 9);
  });

  it('exposes cumulative_melt as secondary', () => {
    const res = computeEquation(34, { DDF: 5, Tair: 5, Tbase: 0 });
    const sec = res!.secondary ?? [];
    const cum = sec.find((s) => s.key === 'cumulative_melt');
    expect(cum?.value).toBeCloseTo(250, 6); // 25 × 10 days
    expect(cum?.unit).toBe('mm');
  });

  it('emits the cumulative melt series', () => {
    const res = computeEquation(34, { DDF: 5, Tair: 5, Tbase: 0 });
    expect(res!.series).toBeDefined();
    expect(res!.series!.length).toBe(1);
    expect(res!.series![0].points.length).toBe(30);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(34, { DDF: '5', Tair: '5', Tbase: '0' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(25, 9);
  });

  it('returns honest NaN when DDF or T_air is missing', () => {
    const res = computeEquation(34, { DDF: Number.NaN, Tair: Number.NaN, Tbase: 0 });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});