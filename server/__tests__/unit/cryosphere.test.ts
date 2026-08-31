import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 91 — Glacier PDD Mass Balance (Braithwaite & Olesen 1989) ──
// B_n = Accumulation − DDF·T_pos. Worked example (frontend-cited):
// Accum=0.5, DDF=0.005, T_pos=800 → B_n = 0.5 − 4.0 = −3.5 m w.e.

describe('Tool 91 — Glacier PDD Mass Balance', () => {
  it('worked example: Accum=0.5, DDF=0.005, T_pos=800 → B_n=−3.5 m w.e.', () => {
    const res = computeEquation(91, { accum: 0.5, DDF: 0.005, Tpos: 800, days: 365 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(-3.5, 6);
    expect(res!.unit).toBe('m w.e.');
  });

  it('strong ablation with high T_pos → strongly negative balance', () => {
    const res = computeEquation(91, { accum: 0.5, DDF: 0.008, Tpos: 1500, days: 365 });
    expect(res!.result).toBeLessThan(-5);
  });

  it('exposes total_ablation as secondary', () => {
    const res = computeEquation(91, { accum: 0.5, DDF: 0.005, Tpos: 800, days: 365 });
    const sec = res!.secondary ?? [];
    const abl = sec.find((s) => s.key === 'total_ablation');
    expect(abl?.value).toBeCloseTo(4.0, 6);
    expect(abl?.unit).toBe('m w.e.');
  });

  it('emits the mass-balance series', () => {
    const res = computeEquation(91, { accum: 0.5, DDF: 0.005, Tpos: 800, days: 365 });
    expect(res!.series).toBeDefined();
    expect(res!.series!.length).toBe(1);
    expect(res!.series![0].points.length).toBeGreaterThan(5);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(91, { accum: '0.5', DDF: '0.005', Tpos: '800', days: '365' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(-3.5, 6);
  });

  it('returns honest NaN when inputs are missing', () => {
    const res = computeEquation(91, { accum: Number.NaN, DDF: Number.NaN, Tpos: Number.NaN, days: 365 });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});

// ── Tool 92 — Stefan Active Layer (Stefan 1891) ──────────────────────
// ALT = √(2K·DIFI_s/L). Worked example (frontend-cited): K=2, DIFI=1000,
// L=3×10⁸ → ALT = √(2·2·1000·86400/3×10⁸) = √1.152 = 1.07 m.

describe('Tool 92 — Stefan Active Layer', () => {
  it('worked example: K=2, DIFI=1000, L=3e8 → ALT ≈ 1.07 m', () => {
    const res = computeEquation(92, { K: 2, DIFI: 1000, L: 3e8 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(Math.sqrt(2 * 2 * 1000 * 86400 / 3e8), 6);
    expect(res!.unit).toBe('m');
  });

  it('deeper active layer with warmer thawing index', () => {
    const cold = computeEquation(92, { K: 2, DIFI: 500, L: 3e8 });
    const warm = computeEquation(92, { K: 2, DIFI: 3000, L: 3e8 });
    expect(warm!.result).toBeGreaterThan(cold!.result * 2);
  });

  it('exposes thawing_index as secondary', () => {
    const res = computeEquation(92, { K: 2, DIFI: 1000, L: 3e8 });
    const sec = res!.secondary ?? [];
    const ti = sec.find((s) => s.key === 'thawing_index');
    expect(ti?.value).toBeCloseTo(1000, 6);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(92, { K: '2', DIFI: '1000', L: '3e8' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when inputs are missing', () => {
    const res = computeEquation(92, { K: Number.NaN, DIFI: Number.NaN, L: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});

// ── Tool 93 — Herron-Langway Firn Densification (1980) ───────────────
// dρ/dt = k·b·(ρ_i − ρ_f). Worked example: k=0.01, b=100, ρ_i=917, ρ_f=550
//   → dρ/dt = 0.01·100·367 = 367 kg/m³/yr.

describe('Tool 93 — Herron-Langway Firn Densification', () => {
  it('worked example: k=0.01, b=100, ρ_i=917, ρ_f=550 → 367 kg/m³/yr', () => {
    const res = computeEquation(93, { k: 0.01, b: 100, rhoI: 917, rhoF: 550 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(367, 6);
    expect(res!.unit).toBe('kg/m³/yr');
  });

  it('no densification when densities are equal', () => {
    const res = computeEquation(93, { k: 0.01, b: 100, rhoI: 550, rhoF: 550 });
    expect(res!.result).toBeCloseTo(0, 9);
  });

  it('exposes closeoff_time as secondary', () => {
    const res = computeEquation(93, { k: 0.01, b: 100, rhoI: 917, rhoF: 550 });
    const sec = res!.secondary ?? [];
    const co = sec.find((s) => s.key === 'closeoff_time');
    expect(co?.value).toBeCloseTo((830 - 550) / 367, 4); // ≈ 0.76 yr
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(93, { k: '0.01', b: '100', rhoI: '917', rhoF: '550' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(367, 6);
  });

  it('returns honest NaN when inputs are missing', () => {
    const res = computeEquation(93, { k: Number.NaN, b: Number.NaN, rhoI: Number.NaN, rhoF: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});
