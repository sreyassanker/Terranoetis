import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 51 — Gross Primary Production (Monteith 1972) ───────────────
// GPP = ε · fPAR · PAR. Worked example (frontend-cited): ε=1.2, fPAR=0.5,
// PAR=2000 → GPP=1200 gC/m²/yr.

describe('Tool 51 — Monteith Light Use Efficiency', () => {
  it('worked example: ε=1.2, fPAR=0.5, PAR=2000 → GPP=1200 gC/m²/yr', () => {
    const res = computeEquation(51, { eps: 1.2, fpar: 0.5, par: 2000 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(1200, 6);
    expect(res!.unit).toBe('gC/m²/yr');
  });

  it('GPP scales with fPAR (linear in APAR)', () => {
    const f05 = computeEquation(51, { eps: 1.2, fpar: 0.5, par: 2000 });
    const f08 = computeEquation(51, { eps: 1.2, fpar: 0.8, par: 2000 });
    expect(f08!.result / f05!.result).toBeCloseTo(1.6, 6);
  });

  it('exposes npp_estimate and apar as secondary', () => {
    const res = computeEquation(51, { eps: 1.2, fpar: 0.5, par: 2000 });
    const sec = res!.secondary ?? [];
    const npp = sec.find((s) => s.key === 'npp_estimate');
    const apar = sec.find((s) => s.key === 'apar');
    expect(npp?.value).toBeCloseTo(600, 6); // 0.5 × 1200
    expect(apar?.value).toBeCloseTo(1000, 6); // 0.5 × 2000
  });

  it('emits the GPP(ε) series (timeseries tool)', () => {
    const res = computeEquation(51, { eps: 1.2, fpar: 0.5, par: 2000 });
    expect(res!.series).toBeDefined();
    expect(res!.series!.length).toBe(1);
    expect(res!.series![0].points.length).toBeGreaterThan(10);
    for (const p of res!.series![0].points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(51, { eps: '1.2', fpar: '0.5', par: '2000' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(1200, 6);
  });

  it('returns honest NaN when a genuine input is missing', () => {
    const res = computeEquation(51, { eps: Number.NaN, fpar: Number.NaN, par: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('param aliases: ε→eps, fPAR→fpar, PAR→par', () => {
    const normalized = normalizeInputs(51, { ε: 1.2, fPAR: 0.5, PAR: 2000 } as unknown as Record<string, number>);
    expect(normalized['eps']).toBe(1.2);
    expect(normalized['fpar']).toBe(0.5);
    expect(normalized['par']).toBe(2000);
  });
});
