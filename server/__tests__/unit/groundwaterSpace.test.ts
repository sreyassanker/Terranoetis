import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 96 — Budyko-Sellers EBM (1969) ──────────────────────────────
// ∂T/∂t = [Q(1−α) − I + div(D∇T)] / C × s/yr.
// Worked example: C=2.09e7, Q=341.75, α=0.3, I=240, D=0.6, divDT=0
//   → absorbed = 341.75×0.7 = 239.2 W/m²; net = −0.775 W/m²
//   → dT = −0.775/2.09e7 × 3.156e7 = −1.17 K/yr (cooling)

describe('Tool 96 — Budyko-Sellers EBM', () => {
  it('worked example: net imbalance −0.775 W/m² → dT ≈ −1.17 K/yr', () => {
    const res = computeEquation(96, { C: 2.09e7, Q: 341.75, alpha: 0.3, I: 240, D: 0.6, divDT: 0 });
    expect(res).not.toBeNull();
    const net = 341.75 * 0.7 - 240;
    const expected = net / 2.09e7 * 3.15576e7;
    expect(res!.result).toBeCloseTo(expected, 6);
    expect(res!.unit).toBe('K/yr');
  });

  it('steady state when absorbed = OLR', () => {
    const res = computeEquation(96, { C: 2.09e7, Q: 341.75, alpha: 0.3, I: 239.225, D: 0.6, divDT: 0 });
    expect(Math.abs(res!.result)).toBeLessThan(0.01);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(96, { C: '2.09e7', Q: '341.75', alpha: '0.3', I: '240', D: '0.6', divDT: '0' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('returns honest NaN when inputs are missing', () => {
    const res = computeEquation(96, { C: Number.NaN, Q: Number.NaN, alpha: Number.NaN, I: Number.NaN, D: Number.NaN, divDT: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});

// ── Tool 124 — Orbital Decay (King-Hele 1987) ────────────────────────
// da/dt = −B*·ρ·v·a, B* = C_D·A/m, a = GM/v².

describe('Tool 124 — Orbital Decay Rate', () => {
  it('decay is negative (orbit shrinking) and scales with density', () => {
    const res = computeEquation(124, { rho: 2e-12, CD: 2.2, A: 10, v: 7500, m: 1000 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeLessThan(0);
    expect(res!.unit).toBe('m/s');
    // higher density → faster decay
    const res2 = computeEquation(124, { rho: 2e-11, CD: 2.2, A: 10, v: 7500, m: 1000 });
    expect(res2!.result).toBeLessThan(res!.result);
  });

  it('exposes ballistic_coefficient as secondary', () => {
    const res = computeEquation(124, { rho: 2e-12, CD: 2.2, A: 10, v: 7500, m: 1000 });
    const sec = res!.secondary ?? [];
    const bstar = sec.find((s) => s.key === 'ballistic_coefficient');
    expect(bstar?.value).toBeCloseTo(2.2 * 10 / 1000, 6); // 0.022
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(124, { rho: '2e-12', CD: '2.2', A: '10', v: '7500', m: '1000' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });
});

// ── Tool 126 — Kessler Syndrome (1991) ───────────────────────────────
// dρ/dt = ½ρ²σv + L − βρ³ − γρ.

describe('Tool 126 — Kessler Syndrome', () => {
  it('fragmentation source grows with density', () => {
    const res = computeEquation(126, { rho2: 1e-10, sigma: 1e-7, v: 10, N: 0, L: 0, beta: 0, gamma: 0 });
    expect(res).not.toBeNull();
    // only fragmentation: ½·(1e-10)²·1e-7·10·3.156e7
    const expected = 0.5 * 1e-10 * 1e-10 * 1e-7 * 10 * 3.15576e7;
    expect(res!.result).toBeCloseTo(expected, 6);
    expect(res!.unit).toBe('km⁻³/yr');
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(126, { rho2: '1e-10', sigma: '1e-7', v: '10', N: '0', L: '0', beta: '0', gamma: '0' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });
});

// ── Tool 132 — Theis Transient Drawdown (1935) ───────────────────────
// s = (Q/4πT)·W(u), u = r²S/(4Tt).

describe('Tool 132 — Theis Transient Drawdown', () => {
  it('worked example: Q=1000, T=500, S=1e-4, r=100, t=1 → s≈0.75 m', () => {
    const res = computeEquation(132, { Q: 1000, T: 500, t: 1, r: 100, S: 0.0001 });
    expect(res).not.toBeNull();
    const u = 100 * 100 * 0.0001 / (4 * 500 * 1); // 0.0005
    const gamma = 0.5772156649;
    const Wu = -gamma - Math.log(u) + u - u*u/4 + u*u*u/18 - u*u*u*u/96; // ≈ 7.024
    const expected = (1000 / (4 * Math.PI * 500)) * Wu;
    expect(res!.result).toBeCloseTo(expected, 4);
    expect(res!.unit).toBe('m');
  });

  it('exposes well_function as secondary', () => {
    const res = computeEquation(132, { Q: 1000, T: 500, t: 1, r: 100, S: 0.0001 });
    const sec = res!.secondary ?? [];
    const wu = sec.find((s) => s.key === 'well_function');
    expect(wu?.value).toBeGreaterThan(6);
    expect(wu?.value).toBeLessThan(8);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(132, { Q: '1000', T: '500', t: '1', r: '100', S: '0.0001' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });
});

// ── Tool 133 — Cooper-Jacob (1946) ───────────────────────────────────
// s = (2.3Q/4πT)·log₁₀(2.25/u), valid u < 0.01.

describe('Tool 133 — Cooper-Jacob Straight-Line', () => {
  it('approximates Theis when u < 0.01', () => {
    const cj = computeEquation(133, { Q: 1000, T: 500, t: 1, r: 100, S: 0.0001 });
    const theis = computeEquation(132, { Q: 1000, T: 500, t: 1, r: 100, S: 0.0001 });
    expect(cj).not.toBeNull();
    // u = 0.005 < 0.01 → CJ error < 1% vs Theis
    expect(Math.abs(cj!.result - theis!.result) / theis!.result).toBeLessThan(0.01);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(133, { Q: '1000', T: '500', t: '1', r: '100', S: '0.0001' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });
});

// ── Tool 134 — Horton Infiltration (1939) ────────────────────────────
// f(t) = f_c + (f₀−f_c)·e^(−kt). Worked example: f₀=50, f_c=5, k=2, t=1
//   → f = 5 + 45·e^(−2) = 5 + 6.09 = 11.09 mm/h.

describe('Tool 134 — Horton Infiltration', () => {
  it('worked example: f₀=50, f_c=5, k=2, t=1 → f≈11.09 mm/h', () => {
    const res = computeEquation(134, { fc: 5, f0: 50, k: 2, t: 1 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(5 + 45 * Math.exp(-2), 6);
    expect(res!.unit).toBe('mm/h');
  });

  it('decays toward f_c at long times', () => {
    const res = computeEquation(134, { fc: 5, f0: 50, k: 2, t: 100 });
    expect(res!.result).toBeCloseTo(5, 1);
  });

  it('exposes cumulative_infiltration as secondary', () => {
    const res = computeEquation(134, { fc: 5, f0: 50, k: 2, t: 1 });
    const sec = res!.secondary ?? [];
    const cum = sec.find((s) => s.key === 'cumulative_infiltration');
    const expected = 5 * 1 + (45 / 2) * (1 - Math.exp(-2));
    expect(cum?.value).toBeCloseTo(expected, 6);
  });

  it('does NOT throw when inputs arrive as strings', () => {
    const res = computeEquation(134, { fc: '5', f0: '50', k: '2', t: '1' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
  });
});
