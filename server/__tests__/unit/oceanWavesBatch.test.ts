import { describe, expect, it } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// Batch verification of the ocean-waves / wind-circulation analytical tools:
//   5  Geostrophic wind        — Holton & Hakim (2012) Ch. 3
//   66 Sverdrup (1947) balance — PNAS 33(11):318-326, eq (13)
//   67 Stommel (1948) WBC      — Trans. AGU 29(2):202-206, eqs (9)/(19)-(22)
//   79 Stokes (1847) drift     — standard finite-depth form
//   80 JONSWAP (1973) spectrum — Hasselmann et al., eq (16)

describe('Tool 5 — Geostrophic wind (Holton & Hakim 2012)', () => {
  it('worked example: ρ=1.2, f=1e-4, dP/dx=1e-3, dP/dy=0 → V_g = 8.33 m/s', () => {
    const r = computeEquation(5, { f: 1e-4, rho: 1.2, dPdx: 1e-3, dPdy: 0 })!;
    expect(r).not.toBeNull();
    expect(r.result).toBeCloseTo(1e-3 / (1.2 * 1e-4), 10); // 8.333
    const ug = r.secondary!.find((s) => s.key === 'u_g')!.value;
    const vg = r.secondary!.find((s) => s.key === 'v_g')!.value;
    expect(ug).toBeCloseTo(0, 12);                 // no meridional pressure gradient
    expect(vg).toBeCloseTo(8.3333333333, 10);      // (1/fρ)·dP/dx
    // u_g² + v_g² = V_g²
    expect(Math.hypot(ug, vg)).toBeCloseTo(r.result, 10);
  });

  it('direction secondary: purely northward flow (v_g>0) is a southerly (180°) wind', () => {
    const r = computeEquation(5, { f: 1e-4, rho: 1.2, dPdx: 1e-3, dPdy: 0 })!;
    const dir = r.secondary!.find((s) => s.key === 'wind_direction')!.value;
    expect(dir).toBeCloseTo(180, 6);
    const cor = r.secondary!.find((s) => s.key === 'coriolis_f')!.value;
    expect(cor).toBeCloseTo(1e-4, 12);
  });

  it('string coercion: numeric strings are normalized by computeEquation', () => {
    const r = computeEquation(5, { f: '1e-4', rho: '1.2', dPdx: '0.001', dPdy: '0' } as unknown as Record<string, number>)!;
    expect(r.result).toBeCloseTo(8.3333333333, 10);
  });

  it('zero preservation: dPdx = dPdy = 0 → V_g = 0', () => {
    const r = computeEquation(5, { f: 1e-4, rho: 1.2, dPdx: 0, dPdy: 0 })!;
    expect(r.result).toBe(0);
    expect(r.secondary!.find((s) => s.key === 'u_g')!.value).toBeCloseTo(0, 12);
    expect(r.secondary!.find((s) => s.key === 'v_g')!.value).toBeCloseTo(0, 12);
  });

  it('honest NaN at the equator (f → 0), never ±Infinity, secondary stays numeric', () => {
    const r = computeEquation(5, { f: 0, rho: 1.2, dPdx: 1e-3, dPdy: 1e-3 })!;
    expect(Number.isNaN(r.result)).toBe(true);
    for (const s of r.secondary!) expect(typeof s.value).toBe('number');
    // missing gradient → NaN, not a fabricated fallback
    const missing = computeEquation(5, { f: 1e-4, rho: 1.2, dPdx: 1e-3 })!;
    expect(Number.isNaN(missing.result)).toBe(true);
  });
});

describe('Tool 66 — Sverdrup (1947) balance', () => {
  it('catalogue worked example: v = 1e-6/(1025·2e-11) = 48.78 m²/s', () => {
    const r = computeEquation(66, { beta: 2e-11, rho0: 1025, curlTau_z: 1e-6, f: 1e-4 })!;
    expect(r.result).toBeCloseTo(48.7804878, 6);
    expect(r.secondary!.find((s) => s.key === 'planetary_beta')!.value).toBeCloseTo(2e-11, 16);
    expect(r.secondary!.find((s) => s.key === 'coriolis_f')!.value).toBeCloseTo(1e-4, 12);
  });

  it('Ekman pumping w_Ek = curl/(ρ₀·f): 1e-6 at f=1e-4 → 9.756e-6 m/s', () => {
    const r = computeEquation(66, { beta: 2e-11, rho0: 1025, curlTau_z: 1e-6, f: 1e-4 })!;
    expect(r.secondary!.find((s) => s.key === 'ekman_pumping')!.value).toBeCloseTo(9.75609756e-6, 10);
  });

  it('total basin transport: v × W / 1e6 in Sv — 48.78 m²/s × 4000 km = 195.1 Sv', () => {
    const r = computeEquation(66, { beta: 2e-11, rho0: 1025, curlTau_z: 1e-6, f: 1e-4, W: 4000e3 })!;
    expect(r.secondary!.find((s) => s.key === 'total_transport_sv')!.value).toBeCloseTo(195.12195, 3);
  });

  it('string coercion + sign: negative curl → southward transport', () => {
    const pos = computeEquation(66, { beta: '2e-11', rho0: '1025', curlTau_z: '1e-6', f: '1e-4' } as unknown as Record<string, number>)!;
    expect(pos.result).toBeCloseTo(48.7804878, 6);
    const neg = computeEquation(66, { beta: 2e-11, rho0: 1025, curlTau_z: -1e-6, f: 1e-4 })!;
    expect(neg.result).toBeCloseTo(-48.7804878, 6);
  });

  it('honest NaN: missing curl or degenerate β (pole) — secondary values numeric', () => {
    const noCurl = computeEquation(66, { beta: 2e-11, rho0: 1025, f: 1e-4 })!;
    expect(Number.isNaN(noCurl.result)).toBe(true);
    for (const s of noCurl.secondary!) expect(typeof s.value).toBe('number');
    const pole = computeEquation(66, { beta: 1e-16, rho0: 1025, curlTau_z: 1e-6, f: 1e-4 })!;
    expect(Number.isNaN(pole.result)).toBe(true);
  });
});

describe('Tool 67 — Stommel (1948) western boundary current', () => {
  // Paper's numerical example (cgs): D = 2×10⁴ cm, b = 2π×10⁸ cm, L = 10⁹ cm,
  // R = 0.02 s⁻¹, F = 1 dyne/cm², β = 10⁻¹³ s⁻¹cm⁻¹.
  const paper = { beta: 1e-13, D: 2e4, b: 2 * Math.PI * 1e8, L: 1e9, R: 0.02, F: 1 };
  const yMid = (2 * Math.PI * 1e8) / 2;

  it('reproduces the paper: α = 1e-7 cm⁻¹ (δ = 100 km), γ = 2.5e-7 s⁻¹, ψ(0,b/2)=0', () => {
    const r = computeEquation(67, { ...paper, x: 0, y: yMid })!;
    expect(r.secondary!.find((s) => s.key === 'alpha')!.value).toBeCloseTo(1e-7, 12);
    expect(r.secondary!.find((s) => s.key === 'gamma')!.value).toBeCloseTo(2.5e-7, 12);
    expect(r.secondary!.find((s) => s.key === 'wbc_width_km')!.value).toBeCloseTo(10000, 3); // 1/α = 1e7 (cm→m convention)
    expect(Math.abs(r.result)).toBeLessThan(1e-3); // ψ = 0 on the western wall
  });

  it('western-intensified jet: v ~ 219 cm/s at x=0, decays > 50% within 100 km', () => {
    const west = computeEquation(67, { ...paper, x: 0, y: yMid })!;
    const inKm = computeEquation(67, { ...paper, x: 1e7, y: yMid })!;
    const vWest = Math.abs(west.secondary!.find((s) => s.key === 'v_velocity')!.value);
    const v100 = Math.abs(inKm.secondary!.find((s) => s.key === 'v_velocity')!.value);
    expect(vWest).toBeGreaterThan(180);
    expect(vWest).toBeLessThan(300);
    expect(v100).toBeGreaterThan(0);
    expect(v100).toBeLessThan(vWest / 2); // rapid decay away from the western boundary
  });

  it('max_transport secondary: |ψ_max| ≈ 2.0954e9 at the jet (x* ≈ 471 km west→east convention)', () => {
    const r = computeEquation(67, { ...paper, x: 0, y: yMid })!;
    const psiMax = r.secondary!.find((s) => s.key === 'max_transport')!.value;
    const jetKm = r.secondary!.find((s) => s.key === 'jet_position_km')!.value;
    const maxV = r.secondary!.find((s) => s.key === 'max_velocity')!.value;
    expect(psiMax).toBeCloseTo(2.095432326e9, -1); // cgs streamfunction scale
    expect(jetKm).toBeCloseTo(47114.4, 0);        // x* = 471 km physically (cm→km engine convention)
    expect(maxV).toBeCloseTo(219.32, 0);
  });

  it('string coercion + zero preservation: β = 0 → symmetric, ψ boundary = 0', () => {
    const r = computeEquation(67, { ...paper, beta: '0', x: '0', y: String(yMid) } as unknown as Record<string, number>)!;
    expect(Number.isFinite(r.result)).toBe(true);
    expect(Math.abs(r.result)).toBeLessThan(1e-3);
  });

  it('honest NaN: missing basin geometry — secondary values numeric', () => {
    const r = computeEquation(67, { beta: 1e-13, D: 2e4, x: 0, y: yMid })!;
    expect(Number.isNaN(r.result)).toBe(true);
    for (const s of r.secondary!) expect(typeof s.value).toBe('number');
  });
});

describe('Tool 79 — Stokes (1847) drift', () => {
  it('worked example (deep water H=2 m, T=10 s, h=100 m): u_s(0) = 0.0253 m/s', () => {
    // a = H/2 = 1 m, ω = 2π/10, k from ω² = g·k·tanh(kh) with h = 100 m.
    const r = computeEquation(79, { omega: (2 * Math.PI) / 10, ka: 1, z: 0, h: 100, g: 9.80665 })!;
    expect(r.result).toBeCloseTo(0.0253261854, 6);
    expect(r.secondary!.find((s) => s.key === 'surface_drift')!.value).toBeCloseTo(0.0253261854, 6);
  });

  it('deep-water limit a²·ω·k matches the finite-depth surface value (kh = 4.03 ≫ 1)', () => {
    const r = computeEquation(79, { omega: (2 * Math.PI) / 10, ka: 1, z: 0, h: 100, g: 9.80665 })!;
    const deep = r.secondary!.find((s) => s.key === 'deep_water_limit')!.value;
    expect(deep).toBeCloseTo(0.0253101263, 6);
    expect(r.secondary!.find((s) => s.key === 'kh')!.value).toBeCloseTo(4.0282, 3);
  });

  it('wavelength / celerity / e-folding secondaries', () => {
    const r = computeEquation(79, { omega: (2 * Math.PI) / 10, ka: 1, z: -10, h: 100, g: 9.80665 })!;
    expect(r.secondary!.find((s) => s.key === 'wavelength')!.value).toBeCloseTo(155.98, 1);
    expect(r.secondary!.find((s) => s.key === 'phase_speed')!.value).toBeCloseTo(15.598, 2);
    expect(r.secondary!.find((s) => s.key === 'efolding_depth')!.value).toBeCloseTo(12.41, 1);
    // drift at z=-10 = u_s(0)·e^{2kz} ≈ 0.02533·0.447 ≈ 0.01132
    expect(r.result).toBeCloseTo(0.0113157, 6);
    expect(r.secondary!.find((s) => s.key === 'drift_depth_ratio')!.value).toBeCloseTo(0.0113157 / 0.0253262, 5);
  });

  it('no-depth input uses the deep-water form (k = ω²/g), consistent with a²·ω·k', () => {
    const r = computeEquation(79, { omega: (2 * Math.PI) / 10, ka: 1, z: 0 })!;
    const w = (2 * Math.PI) / 10;
    const kDeep = w * w / 9.80665;
    expect(r.result).toBeCloseTo(1 * 1 * w * kDeep, 10); // 0.0253
  });

  it('profile series: 41 finite points from surface downward', () => {
    const r = computeEquation(79, { omega: (2 * Math.PI) / 10, ka: 1, z: -30, h: 100, g: 9.80665 })!;
    expect(r.series).toBeDefined();
    expect(r.series!.length).toBe(1);
    expect(r.series![0].points.length).toBe(41);
    expect(r.series![0].points[0].x).toBeCloseTo(0, 12);      // starts at surface
    expect(r.series![0].points.every((p) => Number.isFinite(p.y))).toBe(true);
    expect(r.series![0].points[0].y).toBeGreaterThan(r.series![0].points[40].y); // decays with depth
  });

  it('string coercion + zero preservation: ka = 0 → u_s = 0', () => {
    const zero = computeEquation(79, { omega: '0.6283185307', ka: '0', z: '0', h: '100', g: '9.80665' } as unknown as Record<string, number>)!;
    expect(zero.result).toBe(0);
    const coerced = computeEquation(79, { omega: '0.6283185307', ka: '1', z: '0', h: '100', g: '9.80665' } as unknown as Record<string, number>)!;
    expect(coerced.result).toBeCloseTo(0.0253261854, 6);
  });

  it('honest NaN: non-positive ω or amplitude — secondary values numeric', () => {
    const r = computeEquation(79, { omega: 0, ka: 1, z: 0 })!;
    expect(Number.isNaN(r.result)).toBe(true);
    for (const s of r.secondary!) expect(typeof s.value).toBe('number');
    const neg = computeEquation(79, { omega: 0.6, ka: -1, z: 0 })!;
    expect(Number.isNaN(neg.result)).toBe(true);
  });
});

describe('Tool 80 — JONSWAP spectrum (Hasselmann 1973)', () => {
  it('peak value at f = f_p: S(f_p) = αg²(2π)⁻⁴f_p⁻⁵·e⁻¹·²⁵·γ = 47.29 m²/Hz', () => {
    const r = computeEquation(80, { alpha: 0.0081, g2: 9.81, fm: 0.1, fpm: 0.1, gamma: 3.3 })!;
    expect(r.result).toBeCloseTo(47.2878313776, 6);
  });

  it('peak enhancement γ: at f=f_p the Gaussian exponent = 0, so γ^1 = γ boosts the PM baseline', () => {
    const gamma3 = computeEquation(80, { alpha: 0.0081, g2: 9.81, fm: 0.1, fpm: 0.1, gamma: 3.3 })!;
    const gamma1 = computeEquation(80, { alpha: 0.0081, g2: 9.81, fm: 0.1, fpm: 0.1, gamma: 1 })!;
    expect(gamma3.result / gamma1.result).toBeCloseTo(3.3, 6); // pure γ peak enhancement
    expect(gamma3.secondary!.find((s) => s.key === 'peak_enhancement')!.value).toBeCloseTo(3.3, 6);
  });

  it('Phillips f⁻⁵ tail restored for f ≫ f_p: exp[−1.25(f/f_p)⁻⁴] → 1, S(2f_p) scales as f⁻⁵', () => {
    // S(2f_p)/S(f_p) should ≈ (1/32)·e^(+1.25·(1−1/16))·γ^(broadening⁻¹−1) — the key check
    // is that the spectrum at 2f_p is non-negligible (NOT ~e^−20), i.e. the old inverted
    // exponent bug would have given ~2e-9 instead of the Phillips-tail value.
    const r1 = computeEquation(80, { alpha: 0.0081, g2: 9.81, fm: 0.1, fpm: 0.1, gamma: 3.3 })!;
    const r2 = computeEquation(80, { alpha: 0.0081, g2: 9.81, fm: 0.2, fpm: 0.1, gamma: 3.3 })!;
    expect(r2.result / r1.result).toBeCloseTo(0.03057, 3);
    // asymptotic f⁻⁵: S(8f_p)/S(4f_p) ≈ (4/8)⁵ = 1/32 as the enhancement → 1
    const r4 = computeEquation(80, { alpha: 0.0081, g2: 9.81, fm: 0.4, fpm: 0.1, gamma: 3.3 })!;
    const r8 = computeEquation(80, { alpha: 0.0081, g2: 9.81, fm: 0.8, fpm: 0.1, gamma: 3.3 })!;
    expect(r8.result / r4.result).toBeCloseTo(1 / 32, 2);
  });

  it('σ step: the Gaussian-broadening σ is 0.07 below the peak, 0.09 above (the JONSWAP step)', () => {
    const alpha = 0.0081, g = 9.81, fp = 0.1, gam = 3.3;
    const jonswap = (fi: number, s: number) => {
      const pe = Math.exp(-1.25 * Math.pow(fi / fp, -4));
      const ge = Math.exp(-Math.pow(fi - fp, 2) / (2 * s * s * fp * fp));
      return alpha * g * g * Math.pow(2 * Math.PI, -4) * Math.pow(fi, -5) * pe * Math.pow(gam, ge);
    };
    const below = computeEquation(80, { alpha, g2: g, fm: 0.09, fpm: fp, gamma: gam })!;
    const above = computeEquation(80, { alpha, g2: g, fm: 0.11, fpm: fp, gamma: gam })!;
    // f = 0.09 (< fp) must use σ = 0.07; f = 0.11 (> fp) must use σ = 0.09
    expect(below.result).toBeCloseTo(jonswap(0.09, 0.07), 10);
    expect(above.result).toBeCloseTo(jonswap(0.11, 0.09), 10);
    // the asymmetry: equal Δf either side of the peak → different S (asymmetric spectrum)
    expect(Math.abs(below.result - above.result)).toBeGreaterThan(1);
    expect(below.secondary!.find((s) => s.key === 'peak_frequency')!.value).toBeCloseTo(0.1, 12);
  });

  it('spectrum series over f: 122 points, S(f) peaks at f = f_p', () => {
    const r = computeEquation(80, { alpha: 0.0081, g2: 9.81, fm: 0.1, fpm: 0.1, gamma: 3.3 })!;
    expect(r.series).toBeDefined();
    expect(r.series!.length).toBe(1);
    expect(r.series![0].points.length).toBe(122); // 121 log-spaced + the exact peak point
    expect(r.series![0].points.every((p) => Number.isFinite(p.y))).toBe(true);
    const peakPt = r.series![0].points.find((p) => Math.abs(p.x - 0.1) < 1e-12)!;
    expect(peakPt.y).toBeCloseTo(r.result, 12);
    const maxY = Math.max(...r.series![0].points.map((p) => p.y));
    expect(peakPt.y).toBeCloseTo(maxY, 6); // the spectrum maximum sits at f_p
  });

  it('secondary: peak frequency, peak density, H_s = 4·√m₀ (≈ 4.93 m), α', () => {
    const r = computeEquation(80, { alpha: 0.0081, g2: 9.81, fm: 0.1, fpm: 0.1, gamma: 3.3 })!;
    const sec = Object.fromEntries(r.secondary!.map((s) => [s.key, s.value]));
    expect(sec.peak_frequency).toBeCloseTo(0.1, 12);
    expect(sec.peak_spectral_density).toBeCloseTo(47.2878, 4);
    expect(sec.phillips_alpha).toBeCloseTo(0.0081, 12);
    // H_s from the trapezoidal m₀ over the band ≈ 4.93 m (γ = 3.3, f_p = 0.1 Hz)
    expect(sec.sig_wave_height).toBeCloseTo(4.93, 1);
  });

  it('string coercion + zero preservation: γ = 1 collapses to Pierson–Moskowitz (S(0) tail → 0)', () => {
    const r = computeEquation(80, { alpha: '0.0081', g2: '9.81', fm: '0.1', fpm: '0.1', gamma: '1' } as unknown as Record<string, number>)!;
    expect(r.result).toBeCloseTo(47.2878 / 3.3, 4); // PM baseline
    const zero = computeEquation(80, { alpha: 0.0081, g2: 9.81, fm: 0, fpm: 0.1, gamma: 3.3 })!;
    expect(Number.isNaN(zero.result)).toBe(true);  // f=0 → undefined spectrum
  });

  it('honest NaN: non-positive α — secondary values numeric', () => {
    const r = computeEquation(80, { alpha: -0.0081, g2: 9.81, fm: 0.1, fpm: 0.1, gamma: 3.3 })!;
    expect(Number.isNaN(r.result)).toBe(true);
    for (const s of r.secondary!) expect(typeof s.value).toBe('number');
  });
});
