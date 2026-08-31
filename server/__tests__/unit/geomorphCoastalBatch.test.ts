import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

const calc = (id: number, inputs: Record<string, unknown>) =>
  computeEquation(id, inputs as unknown as Record<string, number>);

const G = 9.80665;

// ── Tool 82 — Hack's Law (Hack, 1957) ───────────────────────────────
// L = c·A^h  (main channel length km vs basin area km²)
// Worked example: c=1.4, A=100 km², h=0.6 → L = 1.4·100^0.6 = 22.19 km

describe('Tool 82 — Hack\'s Law', () => {
  it('worked example: c=1.4, A=100, h=0.6 → L = 22.19 km', () => {
    const res = calc(82, { c: 1.4, A: 100, h: 0.6 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(1.4 * Math.pow(100, 0.6), 3);
    expect(res!.unit).toBe('km');
  });
  it('string-input coercion', () => {
    const res = calc(82, { c: '1.4', A: '100', h: '0.6' });
    expect(Number.isFinite(res!.result)).toBe(true);
    expect(res!.result).toBeCloseTo(1.4 * Math.pow(100, 0.6), 6);
  });
  it('zero preservation: c=0 → L=0', () => {
    const res = calc(82, { c: 0, A: 100, h: 0.6 });
    expect(res!.result).toBe(0);
  });
  it('honest NaN when inputs missing/non-finite', () => {
    const res = calc(82, { c: Number.NaN, A: 100, h: 0.6 });
    expect(Number.isNaN(res!.result)).toBe(true);
    const res2 = calc(82, { A: 100, h: 0.6 });
    expect(Number.isNaN(res2!.result)).toBe(true);
  });
  it('exposes exponent + coefficient secondaries', () => {
    const res = calc(82, { c: 1.4, A: 100, h: 0.6 });
    const sec = res!.secondary!;
    const hackExp = sec.find((s) => s.key === 'hack_exponent')!;
    const coeff = sec.find((s) => s.key === 'coefficient')!;
    expect(hackExp.value).toBeCloseTo(0.6, 6);
    expect(coeff.value).toBeCloseTo(1.4, 6);
  });
});

// ── Tool 83 — Richardson Fractal Dimension (Richardson, 1961) ────────
// D = 1 − ln(L₁/L₂)/ln(s₁/s₂)
// Worked example: L₁=100, s₁=10, L₂=80, s₂=5 → D = 1 − ln(1.25)/ln(2) = 0.678

describe('Tool 83 — Richardson Fractal Dimension', () => {
  it('worked example: D = 1 − ln(1.25)/ln(2) = 0.678', () => {
    const res = calc(83, { L1: 100, s1: 10, L2: 80, s2: 5 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(0.67807, 3);
  });
  it('doc-convention case: increasing L at finer scale gives D between 1 and 2', () => {
    // L₂>L₁ at finer scale s₂<s₁ → ln(L₁/L₂)<0, ln(s₁/s₂)>0 → D > 1
    const res = calc(83, { L1: 80, s1: 5, L2: 100, s2: 2.5 });
    expect(res!.result).toBeGreaterThan(1);
    expect(res!.result).toBeLessThan(2);
  });
  it('string-input coercion', () => {
    const res = calc(83, { L1: '100', s1: '10', L2: '80', s2: '5' });
    expect(Number.isFinite(res!.result)).toBe(true);
    expect(res!.result).toBeCloseTo(0.6780719, 6);
  });
  it('zero preservation: L₁=L₂ → ln ratio 0 → D = 1', () => {
    const res = calc(83, { L1: 100, s1: 10, L2: 100, s2: 5 });
    expect(res!.result).toBeCloseTo(1, 6);
  });
  it('honest NaN when s₁≈s₂ (degenerate) or inputs non-finite', () => {
    const res = calc(83, { L1: 100, s1: 10, L2: 80, s2: 10 });
    expect(Number.isNaN(res!.result)).toBe(true);
    const res2 = calc(83, { L1: 100, s1: 10, L2: Number.NaN, s2: 5 });
    expect(Number.isNaN(res2!.result)).toBe(true);
  });
  it('exposes hurst_exponent + complexity_class secondaries', () => {
    const res = calc(83, { L1: 100, s1: 10, L2: 80, s2: 5 });
    const sec = res!.secondary!;
    const hurst = sec.find((s) => s.key === 'hurst_exponent')!;
    const cls = sec.find((s) => s.key === 'complexity_class')!;
    expect(hurst.value).toBeCloseTo(2 - 0.67807, 3);
    expect(Number.isFinite(cls.value)).toBe(true);
  });
});

// ── Tool 84 — Infinite Slope Stability (Taylor 1948 / Duncan & Wright 2005) ──
// FS = [c' + (γz·cos²β − u)·tanφ'] / (γz·sinβ·cosβ)
// Worked example: c'=10, γz=18, cos²β=0.75, u=0, tanφ'=0.5, sinβ·cosβ=0.433
//   → FS = (10 + 18·0.75·0.5)/(18·0.433) = (10+6.75)/7.794 = 2.15

describe('Tool 84 — Infinite Slope Stability', () => {
  it('worked example: FS = 2.15', () => {
    const cosB = Math.sqrt(0.75);
    const res = calc(84, { cprime: 10, gammaz: 18, cosB, cosB2: 0.75, u: 0, tanphi: 0.5, sinB: 0.5 });
    expect(res).not.toBeNull();
    const expected = (10 + (18 * 0.75 - 0) * 0.5) / (18 * 0.5 * cosB);
    expect(res!.result).toBeCloseTo(expected, 3);
    expect(res!.result).toBeCloseTo(2.1490, 3);
  });
  it('string-input coercion', () => {
    const cosB = Math.sqrt(0.75);
    const res = calc(84, { cprime: '10', gammaz: '18', cosB: String(cosB), cosB2: '0.75', u: '0', tanphi: '0.5', sinB: '0.5' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('zero preservation: u=0 → normal stress = γz·cos²β', () => {
    const res = calc(84, { cprime: 10, gammaz: 18, cosB: Math.sqrt(0.75), cosB2: 0.75, u: 0, tanphi: 0.5, sinB: 0.5 });
    const ns = res!.secondary!.find((s) => s.key === 'normal_stress')!;
    expect(ns.value).toBeCloseTo(18 * 0.75, 6);
  });
  it('honest NaN when inputs missing/non-finite', () => {
    const res = calc(84, { cprime: 10, gammaz: 18, cosB: Number.NaN, cosB2: 0.75, u: 0, tanphi: 0.5, sinB: 0.5 });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('exposes friction_angle + normal_stress secondaries', () => {
    const res = calc(84, { cprime: 10, gammaz: 18, cosB: Math.sqrt(0.75), cosB2: 0.75, u: 0, tanphi: 0.5, sinB: 0.5 });
    const sec = res!.secondary!;
    const phi = sec.find((s) => s.key === 'friction_angle')!;
    const ns = sec.find((s) => s.key === 'normal_stress')!;
    expect(phi.value).toBeCloseTo(Math.atan(0.5) * 180 / Math.PI, 4);
    expect(phi.unit).toBe('°');
    expect(ns.value).toBeCloseTo(13.5, 4);
    expect(ns.unit).toBe('kPa');
  });
});

// ── Tool 85 — Voellmy Friction (Voellmy, 1955) ───────────────────────
// τ = μ·σ + ρ·g·v²/ξ
// Worked example: μ=0.1, σ=1e5, ρ=900, g=9.81, v=10, ξ=1000 → τ = 10882.9 Pa
// (engine uses G_GRAV = 9.80665 → τ = 10882.60 Pa)

describe('Tool 85 — Voellmy Friction Model', () => {
  it('worked example: τ = μσ + ρgv²/ξ = 10882.60 Pa', () => {
    const res = calc(85, { mu: 0.1, sigmaN: 1e5, xi: 1000, rho: 900, velocity: 10 });
    expect(res).not.toBeNull();
    const expected = 0.1 * 1e5 + (900 * G * 100) / 1000;
    expect(res!.result).toBeCloseTo(expected, 3);
    expect(res!.result).toBeCloseTo(10882.60, 1);
    expect(res!.unit).toBe('Pa');
  });
  it('string-input coercion', () => {
    const res = calc(85, { mu: '0.1', sigmaN: '100000', xi: '1000', rho: '900', velocity: '10' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('zero preservation: v=0 → τ = μσ only', () => {
    const res = calc(85, { mu: 0.1, sigmaN: 1e5, xi: 1000, rho: 900, velocity: 0 });
    expect(res!.result).toBeCloseTo(10000, 6);
    const frac = res!.secondary!.find((s) => s.key === 'fraction_turbulent')!;
    expect(frac.value).toBe(0);
  });
  it('honest NaN when inputs missing/non-finite or ξ=0', () => {
    const res = calc(85, { mu: 0.1, sigmaN: 1e5, xi: 0, rho: 900, velocity: 10 });
    expect(Number.isNaN(res!.result)).toBe(true);
    const res2 = calc(85, { mu: 0.1, sigmaN: 1e5, xi: 1000, rho: 900 });
    expect(Number.isNaN(res2!.result)).toBe(true);
  });
  it('exposes Coulomb/turbulent split + normal stress secondaries', () => {
    const res = calc(85, { mu: 0.1, sigmaN: 1e5, xi: 1000, rho: 900, velocity: 10 });
    const sec = res!.secondary!;
    const coulomb = sec.find((s) => s.key === 'coulomb_friction')!;
    const turb = sec.find((s) => s.key === 'turbulent_drag')!;
    const frac = sec.find((s) => s.key === 'fraction_turbulent')!;
    const ns = sec.find((s) => s.key === 'normal_stress')!;
    expect(coulomb.value).toBeCloseTo(10000, 4);
    expect(turb.value).toBeCloseTo((900 * G * 100) / 1000, 4);
    expect(frac.value).toBeCloseTo(turb.value / res!.result, 4);
    expect(ns.value).toBeCloseTo(1e5, 6);
  });
});

// ── Tool 88 — Lake Evaporation (Meyer, 1915) ─────────────────────────
// E = K_m·(e_w − e_a)·(1 + u/16)
// Worked example: e_s=25, e_a=15 hPa, u=2 m/s, K_m=0.35 → E = 0.35·10·1.125 = 3.94 mm/day

describe('Tool 88 — Lake Evaporation (Meyer)', () => {
  it('worked example: E = K_m·(e_w−e_a)·(1+u/16) = 3.94 mm/day', () => {
    const res = calc(88, { Km: 0.35, ew: 25, ea: 15, u: 2 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(0.35 * 10 * 1.125, 4);
    expect(res!.result).toBeCloseTo(3.9375, 4);
    expect(res!.unit).toBe('mm/day');
  });
  it('string-input coercion', () => {
    const res = calc(88, { Km: '0.35', ew: '25', ea: '15', u: '2' });
    expect(Number.isFinite(res!.result)).toBe(true);
    expect(res!.result).toBeCloseTo(3.9375, 6);
  });
  it('zero preservation: e_w = e_a → E = 0', () => {
    const res = calc(88, { Km: 0.35, ew: 15, ea: 15, u: 2 });
    expect(res!.result).toBe(0);
  });
  it('honest NaN when inputs missing/non-finite', () => {
    const res = calc(88, { Km: 0.35, ew: 25, ea: Number.NaN, u: 2 });
    expect(Number.isNaN(res!.result)).toBe(true);
    const res2 = calc(88, { Km: 0.35, ew: 25, ea: 15 });
    expect(Number.isNaN(res2!.result)).toBe(true);
  });
  it('exposes vapor_pressure_deficit + wind_factor secondaries', () => {
    const res = calc(88, { Km: 0.35, ew: 25, ea: 15, u: 2 });
    const sec = res!.secondary!;
    const deficit = sec.find((s) => s.key === 'vapor_pressure_deficit')!;
    const wind = sec.find((s) => s.key === 'wind_factor')!;
    expect(deficit.value).toBeCloseTo(10, 6);
    expect(wind.value).toBeCloseTo(1.125, 6);
  });
});

// ── Tool 89 — Schmidt Lake Stability (Schmidt, 1928; Idso, 1973) ─────
// S = (g/A₀)·∫A(z)·(z − z_v)·ρ(z) dz  (full depth integral)
// S ≈ g·rms(Δρ)·z_v                   (one-layer proxy)
// Worked example (2 layers, dz=5 each, ρ=[998,1002], A₀=1e6):
//   z_v = 5 m, S = g·50 = 490.33 J/m²

describe('Tool 89 — Schmidt Lake Stability Number', () => {
  it('worked example (proxy): g·rms·z = 9.80665·2.5·20 = 490.33 J/m²', () => {
    const res = calc(89, { A: 1e6, z: 20, rms: 2.5 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(G * 2.5 * 20, 3);
    expect(res!.result).toBeCloseTo(490.33, 1);
    expect(res!.unit).toBe('J/m²');
  });
  it('sums the depth integral over a 2-layer density profile', () => {
    // Layers: midpoint z=[2.5, 7.5] m, ρ=[998, 1002] kg/m³, Δz=5 m, A₀=1e6 m²
    // z_v = (2.5+7.5)/2 = 5 m (equal thickness, constant area)
    // S = g·[(2.5−5)·998·5 + (7.5−5)·1002·5] = g·50 = 490.33 J/m²
    const res = calc(89, {
      A: 1e6, z: 10, rms: 4,
      rhoProfile: [998, 1002],
      dzProfile: [5, 5],
      zProfile: [2.5, 7.5],
    });
    expect(res).not.toBeNull();
    const expected = G * 50;
    expect(res!.result).toBeCloseTo(expected, 3);
    const sec = res!.secondary!;
    const z_v = sec.find((s) => s.key === 'center_volume_depth')!;
    expect(z_v.value).toBeCloseTo(5, 4);
  });
  it('string-input coercion (proxy path)', () => {
    const res = calc(89, { A: '1000000', z: '20', rms: '2.5' });
    expect(Number.isFinite(res!.result)).toBe(true);
    expect(res!.result).toBeCloseTo(G * 2.5 * 20, 6);
  });
  it('zero preservation: rms=0 → S=0', () => {
    const res = calc(89, { A: 1e6, z: 20, rms: 0 });
    expect(res!.result).toBe(0);
  });
  it('honest NaN when inputs missing/non-finite', () => {
    const res = calc(89, { A: 1e6, z: Number.NaN, rms: 2.5 });
    expect(Number.isNaN(res!.result)).toBe(true);
    const res2 = calc(89, { A: 1e6, z: 20 });
    expect(Number.isNaN(res2!.result)).toBe(true);
  });
  it('exposes lake_area + thermocline_depth secondaries', () => {
    const res = calc(89, { A: 1e6, z: 20, rms: 2.5 });
    const sec = res!.secondary!;
    const area = sec.find((s) => s.key === 'lake_area')!;
    const thermo = sec.find((s) => s.key === 'thermocline_depth')!;
    expect(area.value).toBeCloseTo(1e6, 3);
    expect(thermo.value).toBeCloseTo(20, 6);
  });
  it('emits profile series (profile vizType)', () => {
    const res = calc(89, { A: 1e6, z: 20, rms: 2.5 });
    expect(res!.series).toBeDefined();
    expect(res!.series!.length).toBeGreaterThan(0);
    const s = res!.series![0];
    expect(s.points.length).toBeGreaterThan(10);
    for (const p of s.points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    const resLayered = calc(89, {
      A: 1e6, z: 10, rms: 4,
      rhoProfile: [998, 1002],
      dzProfile: [5, 5],
      zProfile: [2.5, 7.5],
    });
    expect(resLayered!.series!.length).toBe(2);
  });
});
