import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 14 — Tidal Harmonic Analysis (Pugh & Woodworth 2014) ────────
// h(t) = H₀ + Σ Aᵢ·fᵢ·cos(ωᵢt + V₀ᵢ + uᵢ − φᵢ). The engine sums the
// Schureman-corrected per-constituent terms (each already includes the
// node factor f, equilibrium argument V₀ and nodal phase u).
//
// Worked example: H₀ = 2 m, single constituent of amplitude 0.5 m at a
// time when cos = 1 (peak) → h = 2 + 0.5 = 2.5 m; range = 2×0.5 = 1 m
// (microtidal).

describe('Tool 14 — Tidal Harmonic Analysis', () => {
  it('worked example: H₀=2, amps=[0.5] → h = 2.5 m (peak constituent)', () => {
    const res = computeEquation(14, { H0: 2, amps: [0.5] } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(2.5, 6);
    expect(res!.unit).toBe('m');
  });

  it('constituents can be negative (out of phase) and reduce the height', () => {
    const res = computeEquation(14, { H0: 2, amps: [0.5, -0.3] } as unknown as Record<string, number>);
    expect(res!.result).toBeCloseTo(2.2, 6); // 2 + 0.5 − 0.3
  });

  it('exposes tidal_range, constituent_count and datum_offset as secondary', () => {
    const res = computeEquation(14, { H0: 2, amps: [0.5, 0.3] } as unknown as Record<string, number>);
    const sec = res!.secondary ?? [];
    const range = sec.find((s) => s.key === 'tidal_range');
    const count = sec.find((s) => s.key === 'constituent_count');
    const datum = sec.find((s) => s.key === 'datum_offset');
    expect(range?.value).toBeCloseTo(1.6, 6); // 2·(0.5+0.3)
    expect(count?.value).toBe(2);
    expect(datum?.value).toBeCloseTo(2, 6);
  });

  it('microtidal classification for small amplitudes (< 2 m)', () => {
    const res = computeEquation(14, { H0: 2, amps: [0.3] } as unknown as Record<string, number>);
    const joined = (res!.steps ?? []).join('\n');
    expect(joined).toContain('Microtidal');
  });

  it('returns honest NaN when no tide data resolves', () => {
    const res = computeEquation(14, { H0: Number.NaN, amps: [] as unknown as number[] } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});
