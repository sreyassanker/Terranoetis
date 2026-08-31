import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 63 — SiB Big-Leaf Fluxes (Sellers et al. 1986) ──────────────
// H = ρ·c_p·(T_s−T_a)/r_a; LE = (e_s−e_a)·ρ·c_p/(γ·(r_a+r_s)), γ = c_p·p/(0.622·L_v).
// Worked example: ρ=1.2, c_p=1005, T_s=25, T_a=20, r_a=50, r_s=100,
// e_s=31.7, e_a=15, p=1013.25, L_v=2.45e6:
//   γ = 1005·1013.25/(0.622·2.45e6) = 0.668 hPa/K
//   H = 1.2·1005·5/50 = 120.6 W/m²
//   LE = (31.7−15)·1.2·1005/(0.668·150) = 16.7·1206/100.2 = 201 W/m²

describe('Tool 63 — SiB Big-Leaf Fluxes', () => {
  it('worked example computes H and LE from the paper forms', () => {
    const res = computeEquation(63, { rho: 1.2, cp: 1005, Ts: 25, Ta: 20, ra: 50, rs: 100, es: 31.7, ea: 15, p: 1013.25 });
    expect(res).not.toBeNull();
    const gamma = 1005 * 1013.25 / (0.622 * 2.45e6);
    const H = 1.2 * 1005 * 5 / 50;
    const LE = (31.7 - 15) * 1.2 * 1005 / (gamma * 150);
    expect(res!.result).toBeCloseTo(LE, 4);
    const sec = res!.secondary ?? [];
    const Hsec = sec.find((s) => s.key === 'sensible_heat');
    expect(Hsec?.value).toBeCloseTo(H, 4);
    expect(Hsec?.unit).toBe('W/m²');
  });

  it('exposes bowen_ratio as secondary', () => {
    const res = computeEquation(63, { rho: 1.2, cp: 1005, Ts: 25, Ta: 20, ra: 50, rs: 100, es: 31.7, ea: 15, p: 1013.25 });
    const sec = res!.secondary ?? [];
    const bowen = sec.find((s) => s.key === 'bowen_ratio');
    expect(bowen?.value).toBeGreaterThan(0);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(63, { rho: '1.2', cp: '1005', Ts: '25', Ta: '20', ra: '50', rs: '100', es: '31.7', ea: '15', p: '1013.25' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when canopy temperatures/resistances are missing', () => {
    const res = computeEquation(63, { rho: 1.2, cp: 1005, Ts: Number.NaN, Ta: Number.NaN, ra: Number.NaN, rs: Number.NaN, es: Number.NaN, ea: Number.NaN, p: 1013.25 });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});

// ── Tool 64 — Chapman Ozone Photochemistry (1930) ────────────────────
// [O₃]/[O₂] = √(J₁·k₂/(J₃·k₄)). Worked example: J₁=2.4e-6, k₂=1.43e-14,
// J₃=1e-3, k₄=8e-13 → R = √(2.4e-6·1.43e-14/(1e-3·8e-13)) = √(3.43e-20/8e-16)
// = √(4.29e-5) = 6.55e-3 → ~6550 ppmv.

describe('Tool 64 — Chapman Ozone Photochemistry', () => {
  it('worked example: J₁=2.4e-6, k₂=1.43e-14, J₃=1e-3, k₄=8e-13 → R=6.55e-3', () => {
    const res = computeEquation(64, { J1: 2.4e-6, k2: 1.43e-14, J3: 1e-3, k4: 8e-13, O2: 5.4e18 });
    expect(res).not.toBeNull();
    const R = Math.sqrt(2.4e-6 * 1.43e-14 / (1e-3 * 8e-13));
    expect(res!.result).toBeCloseTo(R, 12);
    const sec = res!.secondary ?? [];
    const mix = sec.find((s) => s.key === 'o3_mixing_ratio');
    expect(mix?.value).toBeCloseTo(R * 1e6, 6);
    expect(mix?.unit).toBe('ppmv');
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(64, { J1: '2.4e-6', k2: '1.43e-14', J3: '1e-3', k4: '8e-13', O2: '5.4e18' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when photolysis rates are missing', () => {
    const res = computeEquation(64, { J1: Number.NaN, k2: Number.NaN, J3: Number.NaN, k4: Number.NaN, O2: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});
