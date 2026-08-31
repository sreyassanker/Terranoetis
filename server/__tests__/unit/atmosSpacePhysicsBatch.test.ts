import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 104 — Ekman Layer Depth ─────────────────────────────────────
// d = π·√(2K_m/|f|), K_m = eddy viscosity.
// Worked example: K_m=10, f=1e-4 → depth = π·√(20/1e-4) = 1405 m.

describe('Tool 104 — Ekman Layer Depth', () => {
  it('worked example → D_E ≈ 1405 m', () => {
    const res = computeEquation(104, { Km: 10, f: 1e-4 })!;
    const expected = Math.PI * Math.sqrt(2 * 10 / 1e-4);
    expect(res.result).toBeCloseTo(expected, 2);
    expect(res.unit).toBe('m');
  });

  it('exposes Ekman transport + pumping as secondaries', () => {
    const res = computeEquation(104, { Km: 10, f: 1e-4, tau: 0.1, rho: 1025, curlTau: 1e-6 })!;
    const sec = res.secondary ?? [];
    const transport = sec.find((s) => s.key === 'ekman_transport')!;
    const pumping = sec.find((s) => s.key === 'ekman_pumping')!;
    expect(transport).toBeDefined();
    expect(transport.value).toBeCloseTo(0.1 / (1025 * 1e-4), 4);
    expect(pumping).toBeDefined();
    expect(pumping.value).toBeCloseTo(1e-6 / (1025 * 1e-4), 8);
  });

  it('zero preservation: τ=0 → transport = 0', () => {
    const res = computeEquation(104, { Km: 10, f: 1e-4, tau: 0, rho: 1025 })!;
    const transport = res.secondary!.find((s) => s.key === 'ekman_transport')!;
    expect(transport.value).toBe(0);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(104, { Km: NaN, f: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });

  it('honest NaN at f = 0 (equator)', () => {
    const res = computeEquation(104, { Km: 10, f: 0 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('honest NaN when K_m ≤ 0', () => {
    const res = computeEquation(104, { Km: -1, f: 1e-4 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(104, { Km: '10', f: '0.0001' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });

  it('no series (scalar result)', () => {
    const res = computeEquation(104, { Km: 10, f: 1e-4 })!;
    expect(res.series).toBeUndefined();
  });
});

// ── Tool 105 — Deardorff Convective Velocity Scale ───────────────────
// w* = (g·z_i·wθ_v/θ_v)^(1/3).
// Worked example: g=9.81, θ̄_v=300, wθ_v=0.1, z_i=1000 → w* = 1.48 m/s.

describe('Tool 105 — Deardorff Convective Velocity', () => {
  it('worked example → w* ≈ 1.48 m/s', () => {
    const res = computeEquation(105, { g: 9.81, thetaVbar: 300, wthetaV: 0.1, zi: 1000 })!;
    const expected = Math.pow(9.81 * 1000 * 0.1 / 300, 1 / 3);
    expect(res.result).toBeCloseTo(expected, 6);
    expect(res.unit).toBe('m/s');
  });

  it('exposes buoyancy_flux, θ̄_v, and w*/u* ratio as secondaries', () => {
    const res = computeEquation(105, { g: 9.81, thetaVbar: 300, wthetaV: 0.1, zi: 1000, ustar: 0.5 })!;
    const sec = res.secondary ?? [];
    const bf = sec.find((s) => s.key === 'buoyancy_flux')!;
    expect(bf.value).toBeCloseTo((9.81 / 300) * 0.1, 6);
    const ratio = sec.find((s) => s.key === 'convective_to_friction_ratio')!;
    expect(ratio.value).toBeCloseTo(res.result / 0.5, 4);
    expect(sec.find((s) => s.key === 'theta_v')!.value).toBe(300);
  });

  it('w*/u* = NaN when ustar not supplied', () => {
    const res = computeEquation(105, { g: 9.81, thetaVbar: 300, wthetaV: 0.1, zi: 1000 })!;
    const ratio = res.secondary!.find((s) => s.key === 'convective_to_friction_ratio')!;
    expect(Number.isNaN(ratio.value)).toBe(true);
  });

  it('zero preservation: wθ_v = 0 → w* = 0', () => {
    const res = computeEquation(105, { g: 9.81, thetaVbar: 300, wthetaV: 0, zi: 1000 })!;
    expect(res.result).toBe(0);
    expect(res.secondary!.find((s) => s.key === 'buoyancy_flux')!.value).toBe(0);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(105, { g: NaN, thetaVbar: NaN, wthetaV: NaN, zi: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });

  it('honest NaN on negative heat flux (stable BL)', () => {
    const res = computeEquation(105, { g: 9.81, thetaVbar: 300, wthetaV: -0.1, zi: 1000 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('honest NaN on θ̄_v ≤ 0', () => {
    const res = computeEquation(105, { g: 9.81, thetaVbar: 0, wthetaV: 0.1, zi: 1000 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(105, { g: '9.81', thetaVbar: '300', wthetaV: '0.1', zi: '1000' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });

  it('no series (scalar result)', () => {
    const res = computeEquation(105, { g: 9.81, thetaVbar: 300, wthetaV: 0.1, zi: 1000 })!;
    expect(res.series).toBeUndefined();
  });
});

// ── Tool 107 — Barotropic Vorticity Equation ──────────────────────────
// ∂ζ/∂t = −(u·∂ζ/∂x + v·∂ζ/∂y) − (ζ+f)·(∂u/∂x + ∂v/∂y).
// Code returns the vorticity tendency diagnostic.

describe('Tool 107 — Barotropic Vorticity Equation', () => {
  it('returns stretching-only tendency when advection omitted', () => {
    const res = computeEquation(107, { zeta: 1e-4, f: 1e-4, div: 1e-5 })!;
    const expected = -(1e-4 + 1e-4) * 1e-5;
    expect(res.result).toBeCloseTo(expected, 15);
    expect(res.unit).toBe('/s²');
  });

  it('includes advection term when u, v, ∂ζ/∂x, ∂ζ/∂y supplied', () => {
    const res = computeEquation(107, {
      zeta: 1e-4, f: 1e-4, div: 1e-5,
      u: 10, v: 5, dzetaDx: 2e-7, dzetaDy: -1e-7,
    })!;
    const adv = -(10 * 2e-7 + 5 * (-1e-7));
    const stretch = -(1e-4 + 1e-4) * 1e-5;
    expect(res.result).toBeCloseTo(adv + stretch, 15);
  });

  it('divergence computed from dudx+dvdy when div not supplied', () => {
    const res = computeEquation(107, { zeta: 1e-4, f: 1e-4, dudx: 0.5e-5, dvdy: 0.5e-5 })!;
    const expected = -(1e-4 + 1e-4) * (0.5e-5 + 0.5e-5);
    expect(res.result).toBeCloseTo(expected, 15);
  });

  it('exposes relative_vorticity, divergence, absolute_vorticity, stretching_term, advection_term', () => {
    const res = computeEquation(107, { zeta: 1e-4, f: 1e-4, div: 1e-5 })!;
    const sec = res.secondary ?? [];
    expect(sec.find((s) => s.key === 'relative_vorticity')!.value).toBeCloseTo(1e-4, 12);
    expect(sec.find((s) => s.key === 'divergence')!.value).toBeCloseTo(1e-5, 12);
    expect(sec.find((s) => s.key === 'absolute_vorticity')!.value).toBeCloseTo(2e-4, 12);
    expect(sec.find((s) => s.key === 'stretching_term')!.value).toBeCloseTo(-2e-9, 15);
    expect(sec.find((s) => s.key === 'advection_term')!.value).toBe(0);
  });

  it('zero preservation: div = 0 → tendency = 0 (no advection)', () => {
    const res = computeEquation(107, { zeta: 1e-4, f: 1e-4, div: 0 })!;
    expect(res.result).toBe(0);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(107, { zeta: NaN, f: NaN, div: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });

  it('honest NaN when div omitted and dudx/dvdy missing', () => {
    const res = computeEquation(107, { zeta: 1e-4, f: 1e-4 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(107, {
      zeta: '1e-4', f: '1e-4', div: '1e-5',
      u: '10', v: '5', dzetaDx: '2e-7', dzetaDy: '-1e-7',
    } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });

  it('no series (scalar diagnostic)', () => {
    const res = computeEquation(107, { zeta: 1e-4, f: 1e-4, div: 1e-5 })!;
    expect(res.series).toBeUndefined();
  });
});

// ── Tool 109 — Marshall-Palmer Drop Size Distribution ─────────────────
// N(D) = N₀·exp(−Λ·D), Λ = 4.1·R^−0.21 mm⁻¹, N₀ = 8000 m⁻³·mm⁻¹.
// Worked example: R=10 mm/h → Λ=2.53 mm⁻¹; N(D) at D=1 mm = 637 m⁻³·mm⁻¹.
// Engine convention: D in metres, Λ in m⁻¹.  Λ·D still dimensionless.

describe('Tool 109 — Marshall-Palmer DSD', () => {
  const N0 = 8000;
  const LambdaPerM = 2.53 * 1000; // 2.53 mm⁻¹ → 2530 m⁻¹
  const Dm = 0.001; // 1 mm

  it('worked example → N ≈ 637 m⁻³·mm⁻¹', () => {
    const res = computeEquation(109, { N0, Lambda: LambdaPerM, D: Dm })!;
    const expected = N0 * Math.exp(-2.53);
    expect(res.result).toBeCloseTo(expected, 0);
    expect(res.unit).toBe('m⁻³·mm⁻¹');
  });

  it('exposes Λ_mm, total concentration, mean diameter, D₀ as secondaries', () => {
    const res = computeEquation(109, { N0, Lambda: LambdaPerM, D: Dm })!;
    const sec = res.secondary ?? [];
    const lamMM = sec.find((s) => s.key === 'lambda_mm')!;
    expect(lamMM.value).toBeCloseTo(2.53, 3);
    const totalConc = sec.find((s) => s.key === 'total_concentration')!;
    expect(totalConc.value).toBeCloseTo(N0 / 2.53, 0);
    const meanD = sec.find((s) => s.key === 'mean_diameter')!;
    expect(meanD.value).toBeCloseTo(1 / 2.53, 4);
    const d0 = sec.find((s) => s.key === 'median_volume_diameter')!;
    expect(d0.value).toBeCloseTo(3.67 / 2.53, 4);
  });

  it('zero preservation: D = 0 → N = N₀', () => {
    const res = computeEquation(109, { N0, Lambda: LambdaPerM, D: 0 })!;
    expect(res.result).toBe(N0);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(109, { N0: NaN, Lambda: NaN, D: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });

  it('honest NaN when Λ ≤ 0', () => {
    const res = computeEquation(109, { N0, Lambda: 0, D: 0.001 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('honest NaN when N₀ < 0', () => {
    const res = computeEquation(109, { N0: -1, Lambda: LambdaPerM, D: 0.001 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('honest NaN when D < 0', () => {
    const res = computeEquation(109, { N0, Lambda: LambdaPerM, D: -0.001 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(109, { N0: '8000', Lambda: '2530', D: '0.001' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });

  it('returns N(D) series over D (0–8 mm)', () => {
    const res = computeEquation(109, { N0, Lambda: LambdaPerM, D: Dm })!;
    expect(res.series).toBeDefined();
    expect(res.series!.length).toBeGreaterThanOrEqual(1);
    const s = res.series![0];
    expect(s.points.length).toBeGreaterThan(30);
    expect(s.points[0].x).toBeCloseTo(0, 6);
    expect(s.points[0].y).toBeCloseTo(N0, 0);
    expect(s.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});

// ── Tool 110 — Z-R Reflectivity-Rainfall Relation ─────────────────────
// Z = a·R^b, standard a=200, b=1.6.
// Worked example: R=10 → Z = 200·10^1.6 = 200·39.8 = 7960 mm⁶/m³.

describe('Tool 110 — Z-R Relationship', () => {
  it('worked example → Z ≈ 7960 mm⁶/m³, dBZ ≈ 39.0', () => {
    const res = computeEquation(110, { a: 200, R: 10 })!;
    const expectedZ = 200 * Math.pow(10, 1.6);
    expect(res.result).toBeCloseTo(expectedZ, 0);
    expect(res.unit).toBe('mm⁶/m³');
    const dbz = res.secondary!.find((s) => s.key === 'reflectivity_dbz')!;
    expect(dbz.value).toBeCloseTo(10 * Math.log10(expectedZ), 4);
  });

  it('exposes dBZ and inverse rain rate as secondaries', () => {
    const res = computeEquation(110, { a: 200, R: 10 })!;
    const sec = res.secondary ?? [];
    const dbz = sec.find((s) => s.key === 'reflectivity_dbz')!;
    expect(dbz.unit).toBe('dBZ');
    const rInv = sec.find((s) => s.key === 'rain_rate_from_z')!;
    expect(rInv.value).toBeCloseTo(10, 4);
  });

  it('zero preservation: R = 0 → Z = 0, dBZ = 0', () => {
    const res = computeEquation(110, { a: 200, R: 0 })!;
    expect(res.result).toBe(0);
    const dbz = res.secondary!.find((s) => s.key === 'reflectivity_dbz')!;
    expect(dbz.value).toBe(0);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(110, { a: NaN, R: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });

  it('honest NaN when a ≤ 0', () => {
    const res = computeEquation(110, { a: 0, R: 10 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('honest NaN when R < 0', () => {
    const res = computeEquation(110, { a: 200, R: -1 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(110, { a: '200', R: '10' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });

  it('returns Z(R) series over R (scatter vizType)', () => {
    const res = computeEquation(110, { a: 200, R: 10 })!;
    expect(res.series).toBeDefined();
    expect(res.series!.length).toBeGreaterThanOrEqual(1);
    const s = res.series![0];
    expect(s.points.length).toBeGreaterThanOrEqual(8);
    expect(s.points[0].x).toBe(0);
    expect(s.points[0].y).toBe(0);
    expect(s.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});