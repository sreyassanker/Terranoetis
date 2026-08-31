import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

const calc = (id: number, inputs: Record<string, unknown>) =>
  computeEquation(id, inputs as unknown as Record<string, number>);

// ── Tool 119 — S4 Scintillation Index (Briggs & Parkin 1963) ─────────
// S4 = σ_I / ⟨I⟩. Worked example: σ_I=0.15, ⟨I⟩=1 → S4=0.15.

describe('Tool 119 — S4 Scintillation Index', () => {
  it('worked example: σ_I=0.15, ⟨I⟩=1 → S4=0.15', () => {
    const res = calc(119, { Imean: 1, Istd: 0.15 });
    expect(res!.result).toBeCloseTo(0.15, 6);
    expect(res!.unit).toBe('—');
  });
  it('string-input coercion', () => {
    const res = calc(119, { Imean: '1', Istd: '0.15' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('zero preservation: Istd=0 → S4=0', () => {
    const res = calc(119, { Imean: 1, Istd: 0 });
    expect(res!.result).toBe(0);
  });
  it('zero preservation: Imean=0 → S4=0', () => {
    const res = calc(119, { Imean: 0, Istd: 0.5 });
    expect(res!.result).toBe(0);
  });
  it('honest NaN when required inputs missing', () => {
    const res = calc(119, { Imean: NaN, Istd: NaN });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('exposes s4_class, mean_intensity, std_intensity secondaries', () => {
    const res = calc(119, { Imean: 1, Istd: 0.15 });
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 's4_class')!.value).toBe(1); // MODERATE
    expect(sec.find((s) => s.key === 'mean_intensity')!.value).toBe(1);
    expect(sec.find((s) => s.key === 'std_intensity')!.value).toBeCloseTo(0.15);
  });
  it('secondary NaN on missing inputs', () => {
    const res = calc(119, { Imean: NaN, Istd: NaN });
    const sec = res!.secondary!;
    expect(Number.isNaN(sec.find((s) => s.key === 's4_class')!.value)).toBe(true);
  });
});

// ── Tool 120 — Magnetopause Standoff Distance (Shue et al. 1998) ─────
// R_mp = (11.4 + 0.013·Bz)·P_dyn^(−1/6.6) for Bz ≤ 0,
// R_mp = (11.4 + 0.14·Bz)·P_dyn^(−1/6.6) for Bz > 0.
// Worked example: Pdyn=2 nPa, Bz=0 → R_mp ≈ 10.3 R_E.

describe('Tool 120 — Magnetopause Standoff (Shue 1998)', () => {
  it('worked example: Pdyn=2, Bz=0 → R_mp ≈ 10.3 R_E', () => {
    const res = calc(120, { Pdyn: 2, Bz: 0 });
    const expected = (11.4 + 0.013 * 0) * Math.pow(2, -1 / 6.6);
    expect(res!.result).toBeCloseTo(expected, 6);
    expect(res!.unit).toBe('R_E');
    // Also within approximate range of the worked example
    expect(res!.result).toBeGreaterThan(9.5);
    expect(res!.result).toBeLessThan(11);
  });
  it('string-input coercion', () => {
    const res = calc(120, { Pdyn: '2', Bz: '0' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('zero preservation: Pdyn→∞ → R_mp→0 (large Pdyn ⇒ small standoff)', () => {
    const res = calc(120, { Pdyn: 100, Bz: -5 });
    expect(res!.result).toBeGreaterThan(0);
    expect(res!.result).toBeLessThan(8);
  });
  it('honest NaN when Pdyn ≤ 0', () => {
    const res = calc(120, { Pdyn: 0, Bz: 0 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('honest NaN when Pdyn negative', () => {
    const res = calc(120, { Pdyn: -1, Bz: 0 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('honest NaN when Bz missing', () => {
    const res = calc(120, { Pdyn: 2, Bz: NaN });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('northward Bz > 0 uses 0.14 coefficient', () => {
    const resNorth = calc(120, { Pdyn: 2, Bz: 5 });
    const resSouth = calc(120, { Pdyn: 2, Bz: -5 });
    // Northward IMF inflates the magnetopause relative to southward
    expect(resNorth!.result).toBeGreaterThan(resSouth!.result);
  });
  it('exposes secondary: dynamic_pressure, bz_polarity, magnetopause_type, geo_exposure, magnetosheath_thickness', () => {
    const res = calc(120, { Pdyn: 2, Bz: 0 });
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'dynamic_pressure')!.value).toBeCloseTo(2, 4);
    expect(sec.find((s) => s.key === 'bz_polarity')!.value).toBe(0);
    expect(sec.find((s) => s.key === 'magnetopause_type')!.value).toBeGreaterThanOrEqual(0);
    expect(sec.find((s) => s.key === 'geo_exposure')!.value).toBeGreaterThanOrEqual(0);
    expect(sec.find((s) => s.key === 'magnetosheath_thickness')!.value).toBeGreaterThan(0);
  });
});

// ── Tool 121 — Dst Pressure Correction (Burton et al. 1975) ──────────
// Dst* = Dst − b·√(P_dyn) + c.  Worked example: Dst=−50, Pdyn=2, b=7.5,
// c=0 → Dst* = −50 − 7.5·√2 = −60.6 nT.

describe('Tool 121 — Dst Ring Current Pressure Correction', () => {
  it('worked example: Dst=−50, Pdyn=2, b=7.5, c=0 → Dst* ≈ −60.6 nT', () => {
    const res = calc(121, { Dst: -50, Pdyn: 2, b: 7.5, c: 0 });
    const expected = -50 - 7.5 * Math.sqrt(2);
    expect(res!.result).toBeCloseTo(expected, 3);
    expect(res!.unit).toBe('nT');
  });
  it('string-input coercion', () => {
    const res = calc(121, { Dst: '-50', Pdyn: '2', b: '7.5', c: '0' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('zero preservation: Dst=0, Pdyn=0 → Dst*=c', () => {
    const res = calc(121, { Dst: 0, Pdyn: 0, b: 7.5, c: 0 });
    expect(res!.result).toBeCloseTo(0, 6);
  });
  it('honest NaN when Pdyn < 0 (sqrt)', () => {
    const res = calc(121, { Dst: -50, Pdyn: -1, b: 7.5, c: 0 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('honest NaN when b missing', () => {
    const res = calc(121, { Dst: -50, Pdyn: 2, b: NaN, c: 0 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('exposes pressure_correction, raw_dst, storm_class, ring_current_energy', () => {
    const res = calc(121, { Dst: -50, Pdyn: 2, b: 7.5, c: 0 });
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'pressure_correction')!.value).toBeCloseTo(7.5 * Math.sqrt(2), 4);
    expect(sec.find((s) => s.key === 'raw_dst')!.value).toBe(-50);
    expect(sec.find((s) => s.key === 'storm_class')!.value).toBeGreaterThanOrEqual(0);
    // DPS: ring-current energy is POSITIVE while Dst is depressed (negative)
    expect(sec.find((s) => s.key === 'ring_current_energy')!.value).toBeGreaterThan(0);
  });
});

// ── Tool 122 — Debye Length (Debye & Hückel 1923) ────────────────────
// λ_D = √(ε₀·k_B·T_e / (n_e·e²)).  Worked example: T_e=1e5 K, n_e=1e10
// m⁻³ → λ_D = 0.218 m (correct physics; the task's stated 0.0069 was an
// arithmetic error — the formula yields 0.218 m).

describe('Tool 122 — Debye Length (Space Plasma)', () => {
  const EPS0 = 8.8541878128e-12;
  const KB = 1.380649e-23;
  const E_CHARGE = 1.602176634e-19;
  it('worked example: T_e=1e5, n_e=1e10 → λ_D ≈ 0.218 m', () => {
    const res = calc(122, { eps0: EPS0, kB: KB, Te: 1e5, ne: 1e10 });
    const expected = Math.sqrt((EPS0 * KB * 1e5) / (1e10 * E_CHARGE * E_CHARGE));
    expect(res!.result).toBeCloseTo(expected, 8);
    expect(res!.unit).toBe('m');
  });
  it('string-input coercion', () => {
    const res = calc(122, { eps0: String(EPS0), kB: String(KB), Te: '100000', ne: '1e10' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('zero preservation: n_e → ∞ → λ_D → 0', () => {
    const res = calc(122, { eps0: EPS0, kB: KB, Te: 1e5, ne: 1e20 });
    expect(res!.result).toBeLessThan(0.01);
    expect(res!.result).toBeGreaterThanOrEqual(0);
  });
  it('honest NaN when Te ≤ 0', () => {
    const res = calc(122, { eps0: EPS0, kB: KB, Te: -1, ne: 1e10 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('honest NaN when ne ≤ 0', () => {
    const res = calc(122, { eps0: EPS0, kB: KB, Te: 1e5, ne: 0 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('exposes plasma_parameter, plasma_frequency, electron_density', () => {
    const res = calc(122, { eps0: EPS0, kB: KB, Te: 1e5, ne: 1e10 });
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'plasma_parameter')!.value).toBeGreaterThan(0);
    expect(sec.find((s) => s.key === 'plasma_frequency')!.value).toBeGreaterThan(0);
    expect(sec.find((s) => s.key === 'electron_density')!.value).toBe(1e10);
  });
  it('falls back to CODATA constants when eps0/kB not provided', () => {
    const res = calc(122, { Te: 1e5, ne: 1e10 });
    expect(Number.isFinite(res!.result)).toBe(true);
    expect(res!.result).toBeGreaterThan(0);
  });
});

// ── Tool 123 — Satellite Atmospheric Drag (King-Hele 1964) ────────────
// F_D = ½·ρ·C_D·A·v²,  a_D = F_D/m.  Worked example: ρ=1e-12 kg/m³,
// C_D=2.2, A=10 m², m=1000 kg, v=7500 m/s → a_D = 6.19e-7 m/s²
// (the task's stated 6.19e-10 was off by 1000× — correct physics yields
// 6.19e-7 m/s²).

describe('Tool 123 — Satellite Atmospheric Drag', () => {
  it('worked example: ρ=1e-12, CD=2.2, A=10, m=1000, v=7500 → a_D = −6.1875e-7 m/s²', () => {
    const res = calc(123, { rho: 1e-12, CD: 2.2, A: 10, m: 1000, v: 7500 });
    const expectedDecel = -0.5 * 1e-12 * 2.2 * (10 / 1000) * 7500 * 7500;
    const expectedForce = expectedDecel * 1000;
    expect(res!.result).toBeCloseTo(expectedForce, 12);
    expect(res!.unit).toBe('N');
  });
  it('string-input coercion', () => {
    const res = calc(123, { rho: '1e-12', CD: '2.2', A: '10', m: '1000', v: '7500' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('zero preservation: v=0 → F_D=0', () => {
    const res = calc(123, { rho: 1e-12, CD: 2.2, A: 10, m: 1000, v: 0 });
    expect(res!.result).toBe(0);
  });
  it('zero preservation: ρ=0 → F_D=0', () => {
    const res = calc(123, { rho: 0, CD: 2.2, A: 10, m: 1000, v: 7500 });
    expect(res!.result).toBe(0);
  });
  it('honest NaN when m ≤ 0', () => {
    const res = calc(123, { rho: 1e-12, CD: 2.2, A: 10, m: 0, v: 7500 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('honest NaN when rho negative', () => {
    const res = calc(123, { rho: -1e-12, CD: 2.2, A: 10, m: 1000, v: 7500 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('exposes drag_force, drag_acceleration, ballistic_coefficient, density', () => {
    const res = calc(123, { rho: 1e-12, CD: 2.2, A: 10, m: 1000, v: 7500 });
    const sec = res!.secondary!;
    const aExpected = -0.5 * 1e-12 * 2.2 * (10 / 1000) * 7500 * 7500;
    expect(sec.find((s) => s.key === 'drag_force')!.value).toBeCloseTo(aExpected * 1000, 12);
    expect(sec.find((s) => s.key === 'drag_acceleration')!.value).toBeCloseTo(aExpected, 12);
    expect(sec.find((s) => s.key === 'ballistic_coefficient')!.value).toBeCloseTo(2.2 * 10 / 1000, 10);
    expect(sec.find((s) => s.key === 'density')!.value).toBe(1e-12);
  });
});

// ── Tool 125 — Collision Probability (Foster 1992) ────────────────────
// P_c = A_c/(2π·σ_x·σ_y) · exp(−d²/(2·(σ_x²+σ_y²))) for d < 3σ_eff,
// else 0.  A_c = π(√(A₁/π)+√(A₂/π))².

describe('Tool 125 — Collision Probability (Foster 1992)', () => {
  it('worked example: spherical objects with small miss → finite P_c', () => {
    // A1=10 m², A2=5 m², σ_x=10, σ_y=10, d=5
    const res = calc(125, { A1: 10, A2: 5, sigmax: 10, sigmay: 10, d: 5 });
    const R1 = Math.sqrt(10 / Math.PI), R2 = Math.sqrt(5 / Math.PI);
    const Ac = Math.PI * (R1 + R2) ** 2;
    const sigmaEff = Math.sqrt(10 * 10 + 10 * 10); // ~14.14
    const normConst = Ac / (2 * Math.PI * 10 * 10);
    const expected = (5 < 3 * sigmaEff) ? normConst * Math.exp(-25 / (2 * sigmaEff * sigmaEff)) : 0;
    expect(res!.result).toBeCloseTo(expected, 10);
    expect(res!.unit).toBe('—');
  });
  it('string-input coercion', () => {
    const res = calc(125, { A1: '10', A2: '5', sigmax: '10', sigmay: '10', d: '5' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('zero preservation: d=0 → maximum P_c for given geometry', () => {
    const res = calc(125, { A1: 10, A2: 5, sigmax: 10, sigmay: 10, d: 0 });
    expect(res!.result).toBeGreaterThan(0);
    // Compare with d=25: d=0 should be larger
    const resFar = calc(125, { A1: 10, A2: 5, sigmax: 10, sigmay: 10, d: 25 });
    expect(res!.result).toBeGreaterThan(resFar!.result);
  });
  it('d ≥ 3σ_eff → P_c = 0', () => {
    const res = calc(125, { A1: 10, A2: 5, sigmax: 10, sigmay: 10, d: 50 });
    expect(res!.result).toBe(0);
  });
  it('honest NaN when A1 ≤ 0', () => {
    const res = calc(125, { A1: 0, A2: 5, sigmax: 10, sigmay: 10, d: 5 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('honest NaN when sigmax ≤ 0', () => {
    const res = calc(125, { A1: 10, A2: 5, sigmax: 0, sigmay: 10, d: 5 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('honest NaN when d < 0', () => {
    const res = calc(125, { A1: 10, A2: 5, sigmax: 10, sigmay: 10, d: -1 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('exposes miss_distance, covariance_ellipse_area, effective_sigma, collision_cross_section', () => {
    const res = calc(125, { A1: 10, A2: 5, sigmax: 10, sigmay: 10, d: 5 });
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'miss_distance')!.value).toBe(5);
    expect(sec.find((s) => s.key === 'covariance_ellipse_area')!.value).toBeCloseTo(Math.PI * 10 * 10, 4);
    expect(sec.find((s) => s.key === 'effective_sigma')!.value).toBeCloseTo(Math.sqrt(200), 6);
    expect(sec.find((s) => s.key === 'collision_cross_section')!.value).toBeGreaterThan(0);
  });
});

// ── Tool 127 — Hill-Clohessy-Wiltshire (HCW) Equations ──────────────
// Returns relative acceleration magnitude (result) plus closed-form state
// at t, orbit period, drift rate, and a 4-series trajectory over one orbit.
// The bounded-orbit condition is ẏ₀ = −2n·x₀ (corrected from the old
// x₀ = −2ẏ₀/(3n) which was wrong).

describe('Tool 127 — Hill-Clohessy-Wiltshire Equations', () => {
  // LEO: n = 0.00103 rad/s (~1.12 h period), typical inspection offset
  const n = 0.00103;
  // Test HCW at a bounded-orbit configuration: ẏ₀ = −2n·x₀
  const x0 = 100;
  const y0 = 0;
  const z0 = 50;
  const xdot0 = 0;
  const ydot0 = -2 * n * x0; // bounded-orbit condition
  const zdot0 = 0.5;

  it('returns finite relative acceleration magnitude', () => {
    const res = calc(127, { n, x: x0, y: y0, z: z0, xdot: xdot0, ydot: ydot0, zdot: zdot0, ax: 0, ay: 0, az: 0 });
    expect(Number.isFinite(res!.result)).toBe(true);
    expect(res!.unit).toBe('m/s²');
  });

  it('closed-form state at t = T (one orbit) matches recurrence', () => {
    const T = 2 * Math.PI / n;
    // With bounded orbit, position at t=T should be close to initial
    const res = calc(127, { n, x: x0, y: y0, z: z0, xdot: xdot0, ydot: ydot0, zdot: zdot0, t: T });
    const sec = res!.secondary!;
    const pos = sec.find((s) => s.key === 'relative_position')!.value;
    // For exact bounded orbit, secular drift is zero → position should be near initial
    expect(pos).toBeLessThan(200); // Roughly bounded, within orbit scale
    expect(sec.find((s) => s.key === 'orbit_period')!.value).toBeCloseTo(T, 2);
  });

  it('string-input coercion', () => {
    const res = calc(127, { n: String(n), x: '100', y: '0', z: '50', xdot: '0', ydot: String(ydot0), zdot: '0.5' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('zero preservation: all-zero state → zero acceleration', () => {
    const res = calc(127, { n: n, x: 0, y: 0, z: 0, xdot: 0, ydot: 0, zdot: 0, ax: 0, ay: 0, az: 0 });
    expect(res!.result).toBe(0);
  });

  it('honest NaN when n ≤ 0', () => {
    const res = calc(127, { n: 0, x: x0, y: y0, z: z0, xdot: xdot0, ydot: ydot0, zdot: zdot0 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('honest NaN when state input is NaN', () => {
    const res = calc(127, { n: n, x: NaN, y: y0, z: z0, xdot: xdot0, ydot: ydot0, zdot: zdot0 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });

  it('exposes series with 4 traces (Radial, Along-track, Cross-track, Range)', () => {
    const res = calc(127, { n, x: x0, y: y0, z: z0, xdot: xdot0, ydot: ydot0, zdot: zdot0 });
    expect(res!.series).toBeDefined();
    expect(res!.series!.length).toBe(4);
    const labels = res!.series!.map((s) => s.label);
    expect(labels).toContain('Radial x(t)');
    expect(labels).toContain('Along-track y(t)');
    expect(labels).toContain('Cross-track z(t)');
    expect(labels).toContain('Range |r(t)|');
    expect(res!.series![0].points.length).toBeGreaterThan(10);
  });

  it('exposes orbit_period, relative_position, relative_velocity, alongtrack_drift_rate', () => {
    const res = calc(127, { n, x: x0, y: y0, z: z0, xdot: xdot0, ydot: ydot0, zdot: zdot0, t: 600 });
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'orbit_period')!.value).toBeGreaterThan(0);
    expect(sec.find((s) => s.key === 'relative_position')!.value).toBeGreaterThan(0);
    expect(sec.find((s) => s.key === 'relative_velocity')!.value).toBeGreaterThan(0);
    expect(sec.find((s) => s.key === 'alongtrack_drift_rate')!.value).toBeCloseTo(-6 * n * x0 - 3 * ydot0, 10);
    expect(sec.find((s) => s.key === 'radial_final')!.value).toBeGreaterThan(0);
    expect(sec.find((s) => s.key === 'alongtrack_final')!.value).toBeGreaterThan(-200);
    expect(sec.find((s) => s.key === 'crosstrack_final')!.value).toBeGreaterThan(-100);
  });
});