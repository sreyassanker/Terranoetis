import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 59 — Priestley-Taylor ET (Priestley & Taylor 1972) ──────────
// PE = α·[Δ/(Δ+γ)]·(Rₙ−G) W/m²; ET mm/day = PE·86400/(λ·ρ_w)·1000, λ=2.45 MJ/kg.
// Paper §6: α = 1.26. Paper p.84: Δ/(Δ+γ) = 0.56 @10 °C, 0.82 @35 °C.
// 1 W/m² = 0.03527 mm/day.

describe('Tool 59 — Priestley-Taylor ET', () => {
  it('worked example: α=1.26, Δ=0.82, γ=0.67, Rn=200, G=0 → ~7.2 mm/day', () => {
    const res = computeEquation(59, { alpha: 1.26, delta: 0.82, gamma: 0.67, Rn: 200, G: 0 });
    expect(res).not.toBeNull();
    const aRatio = 0.82 / (0.82 + 0.67);
    const PE = 1.26 * aRatio * 200;   // W/m²
    const ETmm = PE * 86400 / (2.45e6 * 1000) * 1000;
    expect(res!.result).toBeCloseTo(ETmm, 6);
    expect(res!.unit).toBe('mm/day');
  });

  it('ET scales with net radiation', () => {
    const r100 = computeEquation(59, { alpha: 1.26, delta: 0.82, gamma: 0.67, Rn: 100, G: 0 });
    const r200 = computeEquation(59, { alpha: 1.26, delta: 0.82, gamma: 0.67, Rn: 200, G: 0 });
    expect(r200!.result).toBeCloseTo(r100!.result * 2, 6);
  });

  it('G (ground heat flux) reduces ET', () => {
    const g0 = computeEquation(59, { alpha: 1.26, delta: 0.82, gamma: 0.67, Rn: 200, G: 0 });
    const g50 = computeEquation(59, { alpha: 1.26, delta: 0.82, gamma: 0.67, Rn: 200, G: 50 });
    expect(g50!.result).toBeLessThan(g0!.result);
  });

  it('exposes pe_energy and radiation_balance as secondary', () => {
    const res = computeEquation(59, { alpha: 1.26, delta: 0.82, gamma: 0.67, Rn: 200, G: 0 });
    const sec = res!.secondary ?? [];
    const pe = sec.find((s) => s.key === 'pe_energy');
    const rb = sec.find((s) => s.key === 'radiation_balance');
    expect(pe?.unit).toBe('W/m²');
    expect(pe?.value).toBeCloseTo(1.26 * (0.82 / (0.82 + 0.67)) * 200, 6);
    expect(rb?.value).toBeCloseTo(200, 6);
  });

  it('emits the daily ET series', () => {
    const res = computeEquation(59, { alpha: 1.26, delta: 0.82, gamma: 0.67, Rn: 200, G: 0 });
    expect(res!.series).toBeDefined();
    expect(res!.series!.length).toBe(1);
    expect(res!.series![0].points.length).toBe(30);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(59, { alpha: '1.26', delta: '0.82', gamma: '0.67', Rn: '200', G: '0' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when Rn is missing', () => {
    const res = computeEquation(59, { alpha: 1.26, delta: 0.82, gamma: 0.67, Rn: Number.NaN, G: 0 });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});

// ── Tool 60 — Hargreaves-Samani ET (1985) ───────────────────────────
// ETo = 0.0023·Rₐ·√(T_max−T_min)·(T_avg+17.8), Rₐ in MJ/m²/day, ×0.408 → mm/day.
// Worked example: Rₐ=40, T_max=30, T_min=15 → T_avg=22.5, ΔT=15, √ΔT=3.873
//   ETo = 0.0023·40·3.873·40.3 = 14.36 MJ-equiv → ×0.408 = 5.86 mm/day

describe('Tool 60 — Hargreaves-Samani ET', () => {
  it('worked example: Rₐ=40, T_max=30, T_min=15 → ~5.86 mm/day', () => {
    const res = computeEquation(60, { Ra: 40, Tmax: 30, Tmin: 15 });
    expect(res).not.toBeNull();
    const dT = Math.sqrt(15);
    const ET0MJ = 0.0023 * 40 * (22.5 + 17.8) * dT;
    expect(res!.result).toBeCloseTo(ET0MJ * 0.408, 6);
    expect(res!.unit).toBe('mm/day');
  });

  it('higher temperature range → higher ET', () => {
    const small = computeEquation(60, { Ra: 40, Tmax: 25, Tmin: 20 });
    const large = computeEquation(60, { Ra: 40, Tmax: 35, Tmin: 10 });
    expect(large!.result).toBeGreaterThan(small!.result);
  });

  it('exposes et0_mj and temperature_range as secondary', () => {
    const res = computeEquation(60, { Ra: 40, Tmax: 30, Tmin: 15 });
    const sec = res!.secondary ?? [];
    const mj = sec.find((s) => s.key === 'et0_mj');
    const tr = sec.find((s) => s.key === 'temperature_range');
    expect(mj?.unit).toBe('MJ/m²/day');
    expect(tr?.value).toBeCloseTo(15, 6);
  });

  it('emits the daily ET₀ series', () => {
    const res = computeEquation(60, { Ra: 40, Tmax: 30, Tmin: 15 });
    expect(res!.series).toBeDefined();
    expect(res!.series!.length).toBe(1);
    expect(res!.series![0].points.length).toBe(30);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(60, { Ra: '40', Tmax: '30', Tmin: '15' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when T_max/T_min are missing', () => {
    const res = computeEquation(60, { Ra: 40, Tmax: Number.NaN, Tmin: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});
