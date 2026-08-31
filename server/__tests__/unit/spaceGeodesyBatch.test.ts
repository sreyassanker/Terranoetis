import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

const calc = (id: number, inputs: Record<string, unknown>) =>
  computeEquation(id, inputs as unknown as Record<string, number>);

// ── Tool 111 — IERS CIO-based Earth Rotation Matrix ─────────────────
// IERS Conventions 2010 §5: W = R₃(−s′)·R₂(x_p)·R₁(y_p), R = W·R₃(GAST).
// det(R) must equal 1 for a valid rotation matrix (the returned scalar).

describe('Tool 111 — IERS Earth Rotation Matrix (CIO-based)', () => {
  it('worked example: det(R) = 1 for a valid rotation matrix', () => {
    const res = calc(111, { xp: 0.1, yp: 0.2, sp: 0.0001, gast: 0.5, dx: 20, dy: -15 });
    expect(res!.result).toBeCloseTo(1, 12);
    expect(res!.unit).toBe('—');
  });
  it('identity case (all angles 0) → det(R) = 1', () => {
    const res = calc(111, { xp: 0, yp: 0, sp: 0, gast: 0 });
    expect(res!.result).toBeCloseTo(1, 12);
  });
  it('string-input coercion', () => {
    const res = calc(111, { xp: '0.1', yp: '0.2', sp: '0.0001', gast: '0.5' });
    expect(res!.result).toBeCloseTo(1, 12);
  });
  it('honest NaN when a required angle is non-finite', () => {
    const res = calc(111, { xp: 0.1, yp: 0.2, sp: 0.0001, gast: NaN });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('secondary: polar motion, TIO locator, GAST and celestial pole offset', () => {
    const res = calc(111, { xp: 0.1, yp: 0.2, sp: 0.0001, gast: 0.5, dx: 20, dy: -15 });
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'x_polar_motion')!.value).toBeCloseTo(0.1, 6);
    expect(sec.find((s) => s.key === 'y_polar_motion')!.value).toBeCloseTo(0.2, 6);
    expect(sec.find((s) => s.key === 'tio_locator')!.value).toBeCloseTo(0.0001, 9);
    expect(sec.find((s) => s.key === 'gast')!.value).toBeCloseTo(0.5, 6);
    expect(sec.find((s) => s.key === 'celestial_pole_offset')!.value).toBeCloseTo(25, 6);
    const tr = sec.find((s) => s.key === 'trace_R')!.value;
    expect(tr).toBeGreaterThan(2.7); // tr(R) = 1 + 2·cos(0.5 rad)
  });
});

// ── Tool 112 — Earth Tides (Love Numbers) ───────────────────────────
// u_r = h₂·V₂/g, Δg = k₂·V₂/R_e. h₂ ≈ 0.603, k₂ ≈ 0.298 (PREM).
// Moon-overhead V₂ = G·M_moon·R_e²/D³ ≈ 3.50 m²/s².

describe('Tool 112 — Earth Tides (Love Numbers)', () => {
  it('worked example: V₂ = 3.5 m²/s² (moon overhead), h₂ = 0.603, k₂ = 0.298', () => {
    const res = calc(112, { hn: 0.603, kn: 0.298, Vn: 3.5, g: 9.80665, lat: 45, Re: 6371000 });
    expect(res!.result).toBeCloseTo(0.603 * 3.5 / 9.80665, 6);
    expect(res!.unit).toBe('m');
  });
  it('default: latitude-dependent degree-2 V₂ gives a finite tidal displacement', () => {
    // At 45° latitude the degree-2 factor (3sin²φ−1)/2 = 0.25 → u_r ≈ 0.054 m.
    const res = calc(112, {});
    expect(Number.isFinite(res!.result)).toBe(true);
    expect(res!.result).toBeGreaterThan(0.04);
    expect(res!.result).toBeLessThan(0.07);
  });
  it('tidal displacement grows toward lower latitudes (factor (3sin²φ−1)/2)', () => {
    const low = calc(112, { lat: 10 })!.result;
    const high = calc(112, { lat: 60 })!.result;
    expect(low).not.toBeCloseTo(high, 3);
  });
  it('secondary: gravity perturbation Δg = k₂·V₂/R_e', () => {
    const res = calc(112, { hn: 0.603, kn: 0.298, Vn: 3.5, g: 9.80665, Re: 6371000 });
    const dg = res!.secondary!.find((s) => s.key === 'gravity_perturbation')!.value;
    expect(dg).toBeCloseTo(0.298 * 3.5 / 6371000, 10);
    expect(dg).toBeGreaterThan(0);
  });
  it('series: degree-2 zonal tidal potential vs latitude (profile)', () => {
    const res = calc(112, { hn: 0.603, Vn: 3.5 });
    expect(res!.series).toBeDefined();
    expect(res!.series![0].points.length).toBe(37); // −90°..90° step 5°
    expect(res!.series![0].points[18].x).toBe(0); // 0° latitude present
  });
  it('string-input coercion', () => {
    const res = calc(112, { hn: '0.603', kn: '0.298', Vn: '3.5', g: '9.80665' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('honest NaN when g ≤ 0 or inputs non-finite', () => {
    expect(Number.isNaN(calc(112, { Vn: 3.5, g: 0 })!.result)).toBe(true);
    expect(Number.isNaN(calc(112, { Vn: NaN })!.result)).toBe(true);
  });
});

// ── Tool 113 — EGM2008 Gravity Field ────────────────────────────────
// Δg = (n−1)·(GM/r²)·(R_e/r)^n·(C_nm cos mλ + S_nm sin mλ)·P_nm(sinφ), mGal.

describe('Tool 113 — EGM2008 Gravity Field', () => {
  it('worked example: zonal C₂₀-like term → finite ~0.98 mGal anomaly', () => {
    const res = calc(113, {
      GM: 3.986004418e14, r: 6371000, n: 2, m: 0,
      Cnm: 1e-6, Snm: 0, Pnm: 1, phi: 0, lam: 0,
    });
    const gNorm = 3.986004418e14 / (6371000 * 6371000);
    expect(res!.result).toBeCloseTo((2 - 1) * gNorm * 1e-6 * 1e5, 2);
    expect(res!.unit).toBe('mGal');
  });
  it('zero preservation: C_nm = S_nm = 0 → Δg = 0', () => {
    const res = calc(113, { Cnm: 0, Snm: 0, n: 2, m: 0, Pnm: 1 });
    expect(res!.result).toBeCloseTo(0, 10);
  });
  it('secondary: disturbing potential and prime-vertical deflection η', () => {
    const res = calc(113, { GM: 3.986004418e14, r: 6371000, n: 2, m: 1, Cnm: 1e-6, Snm: 0, Pnm: 1, phi: 0, lam: 0.5 });
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'disturbing_potential')!.value).toBeCloseTo(
      3.986004418e14 / 6371000 * Math.cos(1 * 0.5) * 1e-6, 1,
    );
    expect(Number.isFinite(sec.find((s) => s.key === 'deflection_eta')!.value)).toBe(true);
  });
  it('honest NaN for meridian deflection when ∂P/∂φ not supplied', () => {
    const res = calc(113, { n: 2, m: 1, Cnm: 1e-6, Pnm: 1 });
    expect(Number.isNaN(res!.secondary!.find((s) => s.key === 'deflection_xi')!.value)).toBe(true);
  });
  it('string-input coercion', () => {
    const res = calc(113, { GM: '3.986004418e14', r: '6371000', n: '2', m: '0', Cnm: '1e-6', Pnm: '1' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('honest NaN when inputs are non-finite or invalid (m > n)', () => {
    expect(Number.isNaN(calc(113, { GM: NaN })!.result)).toBe(true);
    expect(Number.isNaN(calc(113, { n: 2, m: 5, Cnm: 1e-6, Pnm: 1 })!.result)).toBe(true);
  });
});

// ── Tool 114 — Helmert 7-Parameter Transformation ───────────────────
// X′ = T + (1+s)·R·X. Translation case: X = (0,0,0), T = (100,0,0) → X′ = (100,0,0).

describe('Tool 114 — Helmert 7-Parameter Transformation', () => {
  it('worked example: pure translation Tx = 100 → |X′| = 100', () => {
    const res = calc(114, { X: [0, 0, 0], T: [100, 0, 0], S: 1 });
    expect(res!.result).toBeCloseTo(100, 6);
    expect(res!.unit).toBe('m');
  });
  it('scale factor: s = 10 ppm on x = 1 000 000 m → 1 000 010 m', () => {
    const res = calc(114, { X: [1e6, 0, 0], T: [0, 0, 0], s: 10 });
    expect(res!.result).toBeCloseTo(1e6 * (1 + 10e-6), 2);
    expect(res!.secondary!.find((s) => s.key === 'scale_ppm')!.value).toBeCloseTo(10, 6);
  });
  it('rotation: ωz = 1″ shifts the y-component by ~4.848 m at x = 1e6 m', () => {
    // IERS frame-rotation convention (shared with tool 111): R₃(ωz)·[x,0,0]
    // = [x·cos ωz, −x·sin ωz, 0], so the magnitude is x·sin(ωz) ≈ 4.848 m.
    const res = calc(114, { X: [1e6, 0, 0], T: [0, 0, 0], S: 1, wz: 1 });
    expect(res!.result).toBeCloseTo(1e6, 2);
    const yp = res!.secondary!.find((s) => s.key === 'y_prime')!.value;
    expect(Math.abs(yp)).toBeCloseTo(1e6 * Math.sin(1 * Math.PI / (180 * 3600)), 2);
  });
  it('residual secondary: |X′ − X_obs| = 0 for consistent observation', () => {
    const res = calc(114, { X: [0, 0, 0], T: [100, 0, 0], S: 1, Xobs: [100, 0, 0] });
    expect(res!.secondary!.find((s) => s.key === 'residual')!.value).toBeCloseTo(0, 6);
  });
  it('string-input coercion (scalar X/T)', () => {
    const res = calc(114, { X: '5', T: '10', S: '1' });
    expect(res!.result).toBeCloseTo(15, 6);
  });
  it('zero preservation: no transform → |X′| = 0', () => {
    const res = calc(114, { X: [0, 0, 0], T: [0, 0, 0], S: 1 });
    expect(res!.result).toBeCloseTo(0, 10);
  });
  it('honest NaN when T missing or scale non-positive', () => {
    expect(Number.isNaN(calc(114, { X: [1, 0, 0], S: 1 })!.result)).toBe(true);
    expect(Number.isNaN(calc(114, { X: [1, 0, 0], T: [0, 0, 0], S: 0 })!.result)).toBe(true);
  });
});

// ── Tool 115 — Geoid Height (Helmert Orthometric) ───────────────────
// H = h − N.

describe('Tool 115 — Geoid Height (Helmert Orthometric)', () => {
  it('worked example: h = 100 m, N = 30 m → H = 70 m', () => {
    const res = calc(115, { h: 100, N: 30 });
    expect(res!.result).toBeCloseTo(70, 6);
    expect(res!.unit).toBe('m');
  });
  it('secondary: ellipsoid height and geoid undulation echoed', () => {
    const res = calc(115, { h: 120.5, N: -2.3 });
    expect(res!.secondary!.find((s) => s.key === 'ellipsoid_height')!.value).toBeCloseTo(120.5, 6);
    expect(res!.secondary!.find((s) => s.key === 'geoid_undulation')!.value).toBeCloseTo(-2.3, 6);
  });
  it('string-input coercion', () => {
    const res = calc(115, { h: '100', N: '30' });
    expect(res!.result).toBeCloseTo(70, 6);
  });
  it('zero preservation', () => {
    const res = calc(115, { h: 0, N: 0 });
    expect(res!.result).toBeCloseTo(0, 10);
  });
  it('honest NaN when h or N is missing', () => {
    expect(Number.isNaN(calc(115, { h: 100 })!.result)).toBe(true);
    expect(Number.isNaN(calc(115, {})!.result)).toBe(true);
  });
});

// ── Tool 116 — NRLMSISE-00 Thermosphere (simplified) ────────────────
// ρ = Σ n_i·m_i. Series: isothermal barometric ρ(z) = ρ₀·exp(−(z−z₀)/H).

describe('Tool 116 — NRLMSISE-00 Thermosphere (simplified)', () => {
  it('worked example: O/N₂/O₂ mixture → total mass density', () => {
    const res = calc(116, {
      ni: [1e12, 1e11, 5e10],
      mi: [2.67e-26, 4.66e-26, 5.31e-26],
      T: 1000, z0: 200,
    });
    expect(res!.result).toBeCloseTo(2.67e-14 + 4.66e-15 + 2.655e-15, 12);
    expect(res!.unit).toBe('kg/m³');
  });
  it('secondary: number density, O/N₂ ratio and temperature', () => {
    const res = calc(116, {
      ni: [1e12, 1e11, 5e10],
      mi: [2.67e-26, 4.66e-26, 5.31e-26],
      T: 1000,
    });
    expect(res!.secondary!.find((s) => s.key === 'number_density')!.value).toBeCloseTo(1.15e12, 0);
    expect(res!.secondary!.find((s) => s.key === 'o_n2_ratio')!.value).toBeCloseTo(10, 6);
    expect(res!.secondary!.find((s) => s.key === 'temperature')!.value).toBeCloseTo(1000, 6);
  });
  it('series: density vs altitude profile present when T supplied', () => {
    const res = calc(116, {
      ni: [1e12, 1e11, 5e10],
      mi: [2.67e-26, 4.66e-26, 5.31e-26],
      T: 1000, z0: 200,
    });
    expect(res!.series).toBeDefined();
    expect(res!.series![0].points.length).toBe(51); // 200..700 km step 10
    const first = res!.series![0].points[0];
    const last = res!.series![0].points[res!.series![0].points.length - 1];
    expect(first.y).toBeCloseTo(res!.result, 12); // ρ(z₀) = ρ₀
    expect(last.y).toBeLessThan(first.y);         // monotonic decay
  });
  it('string-input coercion on T', () => {
    const res = calc(116, { ni: [1e12], mi: [2.67e-26], T: '1000' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('honest NaN when species arrays are missing or non-finite', () => {
    expect(Number.isNaN(calc(116, {})!.result)).toBe(true);
    expect(Number.isNaN(calc(116, { ni: [NaN], mi: [2.67e-26] })!.result)).toBe(true);
  });
});

// ── Tool 117 — IRI-2016 Ionosphere (simplified Chapman) ─────────────
// N_e(h) = NmF2·exp(½(1 − z − e^(−z))), z = (h − hmF2)/H.

describe('Tool 117 — IRI-2016 Ionosphere (simplified)', () => {
  it('worked example: N_e = 1e12 m⁻³ → f_p ≈ 8.98 MHz', () => {
    const res = calc(117, { Ne: 1e12, alt: 350000, NmF2: 1e12, hmF2: 300000 });
    expect(res!.result).toBeCloseTo(1e12, 0);
    expect(res!.secondary!.find((s) => s.key === 'plasma_frequency')!.value).toBeCloseTo(
      Math.sqrt(1e12 * 80.6164) * 1e-6, 3,
    );
    expect(res!.unit).toBe('m⁻³');
  });
  it('Chapman fallback: at h = hmF2 the model returns NmF2', () => {
    const res = calc(117, { alt: 300000, NmF2: 1e12, hmF2: 300000, H: 60000 });
    expect(res!.result).toBeCloseTo(1e12, 0);
  });
  it('secondary: foF2, hmF2 (km) and finite TEC', () => {
    const res = calc(117, { Ne: 1e12, NmF2: 1e12, hmF2: 300000, H: 60000 });
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'foF2')!.value).toBeCloseTo(Math.sqrt(1e12 * 80.6164) * 1e-6, 3);
    expect(sec.find((s) => s.key === 'hmF2')!.value).toBeCloseTo(300, 6);
    const tec = sec.find((s) => s.key === 'tec')!.value;
    expect(Number.isFinite(tec)).toBe(true);
    expect(tec).toBeGreaterThan(0);
    expect(tec).toBeLessThan(100);
  });
  it('series: Chapman electron-density profile vs altitude', () => {
    const res = calc(117, { Ne: 1e12, NmF2: 1e12, hmF2: 300000, H: 60000 });
    expect(res!.series).toBeDefined();
    expect(res!.series![0].points.length).toBe(73); // 80..800 km step 10
    expect(res!.series![0].points[22].y).toBeCloseTo(1e12, 0); // 300 km = peak
  });
  it('string-input coercion', () => {
    const res = calc(117, { Ne: '1e12', NmF2: '1e12', hmF2: '300000', H: '60000' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('honest NaN when no electron density or Chapman anchors supplied', () => {
    expect(Number.isNaN(calc(117, {})!.result)).toBe(true);
    expect(Number.isNaN(calc(117, { Ne: NaN })!.result)).toBe(true);
  });
});
