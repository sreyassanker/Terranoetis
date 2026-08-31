import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 72 — Price-Weller-Pinkel Mixed Layer (1986) ────────────────
// Bulk Richardson number R_b = g·Δρ·h/(ρ₀·ΔV²); deepening if R_b < 0.65.
// Worked example: g=9.81, ρ₀=1025, Δρ=1, h=50, ΔV=0.5
//   → R_b = 9.81·1·50/(1025·0.25) = 490.5/256.25 = 1.91 ≥ 0.65 → stable.

describe('Tool 72 — PWP Mixed Layer', () => {
  it('stable when R_b ≥ 0.65: g=9.81, ρ₀=1025, Δρ=1, h=50, ΔV=0.5', () => {
    const res = computeEquation(72, { g: 9.81, rho0: 1025, drho: 1, h: 50, dV: 0.5 });
    expect(res).not.toBeNull();
    const Rb = 9.81 * 1 * 50 / (1025 * 0.5 * 0.5);
    expect(res!.result).toBe(0); // stable → no deepening
    const sec = res!.secondary ?? [];
    const rb = sec.find((s) => s.key === 'Rb');
    expect(rb?.value).toBeCloseTo(Rb, 6);
  });

  it('deepens when R_b < 0.65 (large velocity jump)', () => {
    const res = computeEquation(72, { g: 9.81, rho0: 1025, drho: 0.1, h: 20, dV: 1.5 });
    expect(res!.result).toBe(1); // deepening
  });

  it('exposes Rb and entrainment as secondary', () => {
    const res = computeEquation(72, { g: 9.81, rho0: 1025, drho: 1, h: 50, dV: 0.5 });
    const sec = res!.secondary ?? [];
    const ent = sec.find((s) => s.key === 'entrainment');
    expect(ent?.value).toBe(0);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(72, { g: '9.81', rho0: '1025', drho: '1', h: '50', dV: '0.5' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when a genuine input is missing', () => {
    const res = computeEquation(72, { g: Number.NaN, rho0: Number.NaN, drho: Number.NaN, h: Number.NaN, dV: Number.NaN });
    expect(res).not.toBeNull();
    // result is 0/1 flag; Rb secondary is NaN
    const sec = res!.secondary ?? [];
    const rb = sec.find((s) => s.key === 'Rb');
    expect(Number.isNaN(rb?.value)).toBe(true);
  });
});

// ── Tool 75 — Bruun Rule (1962) ─────────────────────────────────────
// R = L·S/(B+h*). Worked example (frontend-cited): L=500, S=3mm/yr,
// B=2, h*=8 → R = 500×0.003/10 = 0.15 m/yr.

describe('Tool 75 — Bruun Rule', () => {
  it('worked example: L=500, S=0.003, B=2, h*=8 → R=0.15 m/yr', () => {
    const res = computeEquation(75, { L: 500, S: 0.003, B: 2, hstar: 8 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(500 * 0.003 / 10, 6);
    expect(res!.unit).toBe('m/yr');
  });

  it('retreat scales linearly with SLR rate', () => {
    const slow = computeEquation(75, { L: 500, S: 0.003, B: 2, hstar: 8 });
    const fast = computeEquation(75, { L: 500, S: 0.01, B: 2, hstar: 8 });
    expect(fast!.result / slow!.result).toBeCloseTo(0.01 / 0.003, 6);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(75, { L: '500', S: '0.003', B: '2', hstar: '8' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when S is missing', () => {
    const res = computeEquation(75, { L: 500, S: Number.NaN, B: 2, hstar: 8 });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});
