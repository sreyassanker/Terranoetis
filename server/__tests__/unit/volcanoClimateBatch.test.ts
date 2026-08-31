import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

const calc = (id: number, inputs: Record<string, unknown>) =>
  computeEquation(id, inputs as unknown as Record<string, number>);

const asInputs = (o: Record<string, string>) => o as unknown as Record<string, number>;

const SIGMA = 5.670374419e-8;

// ── Tool 94 — VEI Volume Relationship (Newhall & Self 1982) ──────────
// V(km³) = 10^(VEI − 5). VEI = ⌊log₁₀(V km³)⌋ + 5. Worked example:
// VEI=3 → 10^(3−5) = 10^−2 = 0.01 km³; VEI=6 → 10^(6−5) = 10 km³.

describe('Tool 94 — VEI Volume Relationship', () => {
  it('worked example: VEI=3 → V = 0.01 km³, VEI=6 → V = 10 km³', () => {
    const v3 = calc(94, { VEI: 3 });
    expect(v3).not.toBeNull();
    expect(v3!.result).toBeCloseTo(0.01, 6);
    expect(v3!.unit).toBe('km³');
    const v6 = calc(94, { VEI: 6 });
    expect(v6!.result).toBeCloseTo(10, 6);
  });
  it('monotonic: larger VEI → larger volume', () => {
    const v2 = calc(94, { VEI: 2 })!.result;
    const v4 = calc(94, { VEI: 4 })!.result;
    expect(v4).toBeGreaterThan(v2);
  });
  it('exposes volume_m3 and magnitude_class as secondary', () => {
    const sec = calc(94, { VEI: 3 })!.secondary ?? [];
    const vol = sec.find((s) => s.key === 'volume_m3');
    const mag = sec.find((s) => s.key === 'magnitude_class');
    expect(vol?.value).toBeCloseTo(10 ** (3 - 5) * 1e9, 3);
    expect(vol?.unit).toBe('m³');
    expect(mag?.value).toBe(3);
    expect(Number.isFinite(vol!.value)).toBe(true);
  });
  it('does NOT throw on string input', () => {
    expect(Number.isFinite(calc(94, asInputs({ VEI: '3' }))!.result)).toBe(true);
  });
  it('honest NaN on missing VEI', () => {
    expect(Number.isNaN(calc(94, { VEI: NaN })!.result)).toBe(true);
  });
});

// ── Tool 95 — Morton-Taylor-Turner Buoyant Plume (1956) ─────────────
// H_MTT = 5.0·(F₀/N³)^(1/4), F₀ = g·(Δρ/ρ₀)·Ṁ/ρ_air. Worked example:
// Q̇=1000 MW, ρ_air=1.225 → Ṁ=3320 kg/s, F₀=1.728e4 m⁴/s³, H_MTT=1.58 km.

describe('Tool 95 — Morton-Taylor-Turner Buoyant Plume', () => {
  const inputs = { Qdot: 1000, rhoAir: 1.225, alpha: 0.1 };
  it('worked example: Mastin height ≈ 2.15 km, MTT check 1.58 km', () => {
    const res = calc(95, inputs);
    const MER = (1000 * 1e6) / (1004 * 300);
    const F0 = (9.81 * 0.65 * MER) / 1.225;
    const hMast = (MER / 140) ** (1 / 4.14);
    const hMtt = (5.0 * (F0 / 0.012 ** 3) ** 0.25) / 1000;
    expect(res!.result).toBeCloseTo(hMast, 4);
    expect(res!.unit).toBe('km');
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'buoyancy_flux')!.value).toBeCloseTo(F0, 3);
    expect(sec.find((s) => s.key === 'plume_rise_mtt')!.value).toBeCloseTo(hMtt, 4);
  });
  it('zero preservation: Q̇=0 → plume height 0', () => {
    expect(calc(95, { Qdot: 0, rhoAir: 1.225, alpha: 0.1 })!.result).toBeCloseTo(0, 6);
  });
  it('does NOT throw on string inputs', () => {
    const res = calc(95, asInputs({ Qdot: '1000', rhoAir: '1.225', alpha: '0.1' }));
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('honest NaN on missing inputs', () => {
    expect(Number.isNaN(calc(95, { Qdot: NaN, rhoAir: NaN, alpha: NaN })!.result)).toBe(true);
  });
});

// ── Tool 97 — Climate Sensitivity (Charney; Hansen 1984 / Roe 2009) ──
// ΔT = ΔF/(λ₀ − f). No-feedback: ΔF=3.7, λ₀=3.2, f=0 → ΔT=1.156 K.

describe('Tool 97 — Climate Sensitivity', () => {
  it('worked example: ΔF=3.7, λ₀=3.2, f=0 → ΔT ≈ 1.16 K', () => {
    const res = calc(97, { dF: 3.7, lambda0: 3.2, f: 0 });
    expect(res!.result).toBeCloseTo(3.7 / 3.2, 5);
    expect(res!.unit).toBe('K');
  });
  it('exposes lambda, forcing, gain as secondary', () => {
    const sec = calc(97, { dF: 3.7, lambda0: 3.2, f: 1.0 })!.secondary ?? [];
    expect(sec.find((s) => s.key === 'lambda')!.value).toBeCloseTo(1 / 2.2, 5);
    expect(sec.find((s) => s.key === 'forcing')!.value).toBe(3.7);
    expect(sec.find((s) => s.key === 'gain')!.value).toBeCloseTo(3.2 / 2.2, 5);
  });
  it('zero preservation: ΔF=0 → ΔT=0', () => {
    expect(calc(97, { dF: 0, lambda0: 3.2, f: 0 })!.result).toBe(0);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(calc(97, asInputs({ dF: '3.7', lambda0: '3.2', f: '0' }))!.result)).toBe(true);
  });
  it('honest NaN on missing inputs', () => {
    expect(Number.isNaN(calc(97, { dF: NaN, lambda0: NaN, f: NaN })!.result)).toBe(true);
  });
});

// ── Tool 98 — Planck Feedback Parameter ──────────────────────────────
// λ_P = 4εσT³. Worked example: T=288 K → 4·5.67e-8·288³ ≈ 5.42 W/m²K.

describe('Tool 98 — Planck Feedback Parameter', () => {
  it('worked example: T=288 → λ_P ≈ 5.42 W/m²K', () => {
    const res = calc(98, { T: 288 });
    expect(res!.result).toBeCloseTo(4 * SIGMA * 288 ** 3, 5);
    expect(res!.unit).toBe('W/m²K');
  });
  it('exposes T_used and T3_factor as secondary', () => {
    const sec = calc(98, { T: 288 })!.secondary ?? [];
    expect(sec.find((s) => s.key === 'T_used')!.value).toBe(288);
    expect(sec.find((s) => s.key === 'T3_factor')!.value).toBeCloseTo(288 ** 3, 3);
  });
  it('does NOT throw on string input', () => {
    expect(Number.isFinite(calc(98, asInputs({ T: '288' }))!.result)).toBe(true);
  });
  it('honest NaN when neither T nor dRdT supplied', () => {
    expect(Number.isNaN(calc(98, { T: NaN })!.result)).toBe(true);
  });
});

// ── Tool 99 — Rossby Wave Dispersion (Rossby 1939) ───────────────────
// ω = −β·k_x/(k_x²+k_y²), c_x = −β/K². Worked example: β=1.6e-11,
// k_x=1e-6, k_y=2e-6 → ω=−3.2e-6 rad/s, c_x=−3.2 m/s.

describe('Tool 99 — Rossby Wave Dispersion', () => {
  const inputs = { beta: 1.6e-11, kx: 1e-6, ky: 2e-6 };
  it('worked example: ω ≈ −3.2e-6 rad/s, c_x ≈ −3.2 m/s', () => {
    const res = calc(99, inputs);
    expect(res!.result).toBeCloseTo(-3.2e-6, 10);
    expect(res!.unit).toBe('rad/s');
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'zonal_phase_speed')!.value).toBeCloseTo(-3.2, 6);
    expect(sec.find((s) => s.key === 'group_velocity_x')!.value).toBeCloseTo(-1.92, 4);
  });
  it('exposes rossby_radius secondary as a positive number', () => {
    const sec = calc(99, inputs)!.secondary ?? [];
    const Lr = sec.find((s) => s.key === 'rossby_radius');
    expect(Number.isFinite(Lr!.value)).toBe(true);
    expect(Lr!.value).toBeGreaterThan(1e5);
    expect(Lr!.unit).toBe('m');
  });
  it('adds a spectrum series ω vs k_x with 30 finite points', () => {
    const res = calc(99, inputs)!;
    const s = res.series![0];
    expect(s.label).toBe('ω vs k_x (fixed k_y)');
    expect(s.points.length).toBe(30);
    expect(s.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(s.points[0].x).toBeCloseTo(1e-7, 12);
    expect(s.points[29].x).toBeCloseTo(1e-5, 12);
    expect(s.points.every((p) => p.y < 0)).toBe(true);
  });
  it('zero preservation: β=0 → ω=0', () => {
    expect(calc(99, { beta: 0, kx: 1e-6, ky: 2e-6 })!.result).toBeCloseTo(0, 12);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(calc(99, asInputs({ beta: '1.6e-11', kx: '1e-6', ky: '2e-6' }))!.result)).toBe(true);
  });
  it('honest NaN on missing inputs', () => {
    expect(Number.isNaN(calc(99, { beta: NaN, kx: NaN, ky: NaN })!.result)).toBe(true);
  });
});

// ── Tool 100 — Charney-Stern Theorem (1962) ──────────────────────────
// Necessary condition for baroclinic instability: ∂q/∂y changes sign.
// Worked example: ∂q/∂y=−2e-11 → unstable (verdict 1).

describe('Tool 100 — Charney-Stern Theorem', () => {
  const inputs = { dpdy: -2e-11, f: 1e-4, N: 1e-2, dudy: 3e-3 };
  it('negative ∂q/∂y → unstable verdict 1', () => {
    expect(calc(100, inputs)!.result).toBe(1);
  });
  it('positive ∂q/∂y → stable verdict 0', () => {
    expect(calc(100, { dpdy: 2e-11, f: 1e-4, N: 1e-2, dudy: 3e-3 })!.result).toBe(0);
  });
  it('exposes qy_gradient, verdict, eady_growth_rate as secondary', () => {
    const sec = calc(100, inputs)!.secondary ?? [];
    expect(sec.find((s) => s.key === 'qy_gradient')!.value).toBe(-2e-11);
    expect(sec.find((s) => s.key === 'instability_verdict')!.value).toBe(1);
    const sigma = 0.31 * (1e-4 / 1e-2) * 3e-3 * 86400;
    expect(sec.find((s) => s.key === 'eady_growth_rate')!.value).toBeCloseTo(sigma, 5);
    expect(sec.find((s) => s.key === 'e_folding_days')!.value).toBeCloseTo(1 / sigma, 4);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(calc(100, asInputs({ dpdy: '-2e-11', f: '1e-4', N: '1e-2', dudy: '3e-3' }))!.result)).toBe(true);
  });
  it('honest NaN on missing dpdy', () => {
    expect(Number.isNaN(calc(100, { dpdy: NaN, f: NaN, N: NaN, dudy: NaN })!.result)).toBe(true);
  });
});

// ── Tool 101 — Eady Growth Rate (1949) ───────────────────────────────
// σ = 0.31·(f/N)·|∂u/∂z|. Worked example: f=1e-4, N=1e-2, ∂u/∂z=3e-3
// → σ = 0.31·0.01·3e-3 = 9.3e-6 /s = 0.80 /day, e-folding ≈ 1.24 days.

describe('Tool 101 — Eady Growth Rate', () => {
  const inputs = { f: 1e-4, N: 1e-2, dudy: 3e-3 };
  it('worked example: σ ≈ 0.80 /day, e-folding ≈ 1.24 days', () => {
    const res = calc(101, inputs);
    const sigma = 0.31 * (1e-4 / 1e-2) * 3e-3 * 86400;
    expect(res!.result).toBeCloseTo(sigma, 6);
    expect(res!.unit).toBe('/day');
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'e_folding_days')!.value).toBeCloseTo(1 / sigma, 5);
    expect(sec.find((s) => s.key === 'period_days')!.value).toBeCloseTo((2 * Math.PI) / sigma, 5);
  });
  it('zero preservation: ∂u/∂z=0 → σ=0', () => {
    expect(calc(101, { f: 1e-4, N: 1e-2, dudy: 0 })!.result).toBe(0);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(calc(101, asInputs({ f: '1e-4', N: '1e-2', dudy: '3e-3' }))!.result)).toBe(true);
  });
  it('honest NaN on missing inputs', () => {
    expect(Number.isNaN(calc(101, { f: NaN, N: NaN, dudy: NaN })!.result)).toBe(true);
  });
});

// ── Tool 102 — Quasi-Geostrophic Potential Vorticity ─────────────────
// q = ∇²ψ + f + (f²/N²)∂²ψ/∂p². Worked example: ∇²ψ=1e-4, f=1e-4,
// stretching=5e-5 → q=2.5e-4 /s.

describe('Tool 102 — Quasi-Geostrophic Potential Vorticity', () => {
  const inputs = { psi: 1e6, f: 1e-4, dpy: 1e-4, dpp: 5e-5 };
  it('worked example: q ≈ 2.5e-4 /s', () => {
    const res = calc(102, inputs);
    expect(res!.result).toBeCloseTo(2.5e-4, 12);
    expect(res!.unit).toBe('/s');
  });
  it('exposes pv_anomaly, stretching, planetary_vorticity as secondary', () => {
    const sec = calc(102, inputs)!.secondary ?? [];
    expect(sec.find((s) => s.key === 'pv_anomaly')!.value).toBeCloseTo(1.5e-4, 12);
    expect(sec.find((s) => s.key === 'stretching')!.value).toBeCloseTo(5e-5, 12);
    expect(sec.find((s) => s.key === 'planetary_vorticity')!.value).toBeCloseTo(1e-4, 12);
  });
  it('zero preservation: all-zero inputs → q=0', () => {
    expect(calc(102, { psi: 0, f: 0, dpy: 0, dpp: 0 })!.result).toBe(0);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(calc(102, asInputs({ psi: '1e6', f: '1e-4', dpy: '1e-4', dpp: '5e-5' }))!.result)).toBe(true);
  });
  it('honest NaN on missing inputs', () => {
    expect(Number.isNaN(calc(102, { psi: NaN, f: NaN, dpy: NaN, dpp: NaN })!.result)).toBe(true);
  });
});