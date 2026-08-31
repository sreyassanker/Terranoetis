import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 53 — Net Ecosystem Exchange (Wofsy et al. 1993) ─────────────
// NEE = R_eco − GPP. Negative = net CO₂ sink.
// Paper verified: GPP 11.1, Reco 7.4 tC/ha/yr → NEE = −3.7 tC/ha/yr.

describe('Tool 53 — Net Ecosystem Exchange', () => {
  it('worked example: R_eco=7.4, GPP=11.1 → NEE=−3.7 gC/m²/yr (sink)', () => {
    const res = computeEquation(53, { Reco: 7.4, GPP: 11.1 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(-3.7, 6);
    expect(res!.unit).toBe('gC/m²/yr');
  });

  it('positive NEE = carbon source', () => {
    const res = computeEquation(53, { Reco: 1200, GPP: 800 });
    expect(res!.result).toBeGreaterThan(0);
  });

  it('exposes NEP as secondary', () => {
    const res = computeEquation(53, { Reco: 7.4, GPP: 11.1 });
    const sec = res!.secondary ?? [];
    const nep = sec.find((s) => s.key === 'nep');
    expect(nep?.value).toBeCloseTo(3.7, 6); // −NEE = 3.7
    expect(nep?.unit).toBe('gC/m²/yr');
  });

  it('emits the NEE vs GPP series', () => {
    const res = computeEquation(53, { Reco: 800, GPP: 1200 });
    expect(res!.series).toBeDefined();
    expect(res!.series!.length).toBe(1);
    expect(res!.series![0].points.length).toBeGreaterThan(10);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(53, { Reco: '800', GPP: '1200' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when a genuine input is missing', () => {
    const res = computeEquation(53, { Reco: Number.NaN, GPP: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});