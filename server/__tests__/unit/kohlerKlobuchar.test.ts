import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 108 — Köhler Droplet (Köhler 1936) ──────────────────────────
// Fix regression: contextEngine defaulted a=0.01 m → S=9999 (stub).
// The physically correct Kelvin curvature coefficient is a ≈ 1.2×10⁻⁹ m.
// With a=1.2e-9, r=1e-6, b=1e-18: S = 1.2e-3 − 1 = −0.9988 (subsaturated).
// Critical radius: r_c = √(3b/a) = √(3·1e-18/1.2e-9) ≈ 5.0×10⁻⁵ m.
describe('Tool 108 — Köhler Droplet', () => {
  it('physically correct defaults: S ≈ −0.9988 (subsaturated at 1 µm)', () => {
    const res = computeEquation(108, { a: 1.2e-9, r: 1e-6, b: 1e-18 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(-0.9988, 3);
    expect(res!.unit).toBe('—');
  });

  it('does NOT produce the stub value 9999 (regression)', () => {
    const res = computeEquation(108, { a: 1.2e-9, r: 1e-6, b: 1e-18 });
    expect(res!.result).not.toBe(9999);
    expect(res!.result).not.toBeGreaterThan(10);
  });

  it('supersaturated at r > r_crit', () => {
    // r = 100 µm >> r_crit (5e-5 m) → supersaturated
    const res = computeEquation(108, { a: 1.2e-9, r: 1e-4, b: 1e-18 });
    expect(res!.result).toBeGreaterThan(0);
  });

  // ── Secondary outputs (critical radius / supersaturation) ──
  it('exposes critical radius r_c = √(3b/a) ≈ 5.0×10⁻⁵ m', () => {
    const res = computeEquation(108, { a: 1.2e-9, r: 1e-6, b: 1e-18 });
    const sec = res!.secondary ?? [];
    const rc = sec.find((s) => s.key === 'critical_radius');
    expect(rc?.value).toBeCloseTo(Math.sqrt(3 * 1e-18 / 1.2e-9), 6);
    expect(rc?.unit).toBe('m');
  });

  it('exposes critical supersaturation S_c = (4a³/27b)^½ = 1.6×10⁻³ %', () => {
    const res = computeEquation(108, { a: 1.2e-9, r: 1e-6, b: 1e-18 });
    const sec = res!.secondary ?? [];
    const sc = sec.find((s) => s.key === 'critical_supersaturation');
    const expected = Math.pow(4 * Math.pow(1.2e-9, 3) / (27 * 1e-18), 0.5) * 100;
    expect(sc?.value).toBeCloseTo(expected, 6);
    expect(sc?.unit).toBe('%');
  });

  // ── Honest NaN ──
  it('returns honest NaN when r or b is missing (no fabricated value)', () => {
    const res = computeEquation(108, { a: 1.2e-9, r: Number.NaN, b: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
    for (const s of res!.secondary ?? []) expect(Number.isNaN(s.value)).toBe(true);
  });
});

// ── Tool 146 — Klobuchar Ionospheric Delay (Klobuchar 1987) ──────────
// Fix regression: contextEngine defaulted α coefficients to 50/60/30/20 s
// (≈9 orders of magnitude too large), producing 1.4×10¹⁵ ns delay.
// Real broadcast α are ~10⁻⁸ s; paper example yields 77.6 ns (23.3 m).
// Paper worked example (pp. 328-329): station 40.00°N, 100.00°W, E=20°,
// A=210°. α = [3.82e-8, 1.49e-8, -1.79e-7, 0]; β = [1.43e5, 0, -3.28e5,
// 1.13e5]. φ_m = 0.2509 semicircles (45.16°), t = 50700 s.
//   A = 3.82e-8 + 1.49e-8·0.2509 − 1.79e-7·0.2509² = 3.067e-8 s
//   P = 1.43e5 − 3.28e5·0.2509² + 1.13e5·0.2509³ = 1.2414e5 s
//   x = 2π(50700−50400)/P = 0.01518 → poly ≈ 0.999885
//   vertical = 5e-9 + 3.067e-8·0.999885 = 3.5667e-8 s = 35.67 ns
//   F = 1 + 16·(0.53 − 20/180)³ = 2.176 → TIONO = 35.67 × 2.176 = 77.6 ns (23.3 m)
describe('Tool 146 — Klobuchar Ionospheric Delay', () => {
  it('default amplitude (A=5e-9) gives delay in the physically plausible range 5–50 ns', () => {
    const res = computeEquation(146, { alpha1: 5e-9, alpha2: 0, alpha3: 0, alpha4: 0 });
    expect(res).not.toBeNull();
    // With default period 50400s and t=50400 (noon), x=0, poly=1 → delay = 5 + 5 = 10 ns
    expect(res!.result).toBeGreaterThan(5);
    expect(res!.result).toBeLessThan(50);
  });

  it('does NOT produce the impossible 1.4e15 ns magnitude (regression)', () => {
    const res = computeEquation(146, { alpha1: 5e-9, alpha2: 0, alpha3: 0, alpha4: 0 });
    expect(res!.result).toBeLessThan(1e6); // < 1 ms = 1e6 ns is sensible
    expect(res!.result).toBeGreaterThan(0);
  });

  it('paper worked example: φ_m=45.16°, t=50700 s, paper α/β, E=20° → 77.6 ns', () => {
    const res = computeEquation(146, {
      alpha1: 3.82e-8, alpha2: 1.49e-8, alpha3: -1.79e-7, alpha4: 0,
      beta1: 1.43e5, beta2: 0, beta3: -3.28e5, beta4: 1.13e5,
      phi_m: 45.16, t_sec: 50700, elevation: 20,
    });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(35.67, 0);            // vertical delay ≈ 35.7 ns
    const sec = res!.secondary ?? [];
    const slant = sec.find((s) => s.key === 'slant_delay');
    const F = sec.find((s) => s.key === 'slant_factor');
    const rangeErr = sec.find((s) => s.key === 'range_error');
    expect(slant?.value).toBeCloseTo(77.6, 0);            // paper TIONO = 77.6 ns
    expect(F?.value).toBeCloseTo(2.176, 2);               // paper F = 2.176
    expect(rangeErr?.value).toBeCloseTo(23.3, 0);         // paper 23.3 m
  });

  it('zenith elevation (E=90°) gives F ≈ 1 (vertical ≈ slant)', () => {
    const res = computeEquation(146, {
      alpha1: 3.82e-8, alpha2: 1.49e-8, alpha3: -1.79e-7, alpha4: 0,
      beta1: 1.43e5, beta2: 0, beta3: -3.28e5, beta4: 1.13e5,
      phi_m: 45.16, t_sec: 50700, elevation: 90,
    });
    expect(res).not.toBeNull();
    const sec = res!.secondary ?? [];
    const F = sec.find((s) => s.key === 'slant_factor');
    const slant = sec.find((s) => s.key === 'slant_delay');
    // F = 1 + 16·(0.53 − 0.5)³ = 1 + 16·(0.03)³ = 1.000432 (paper approximation;
    // exact zenith obliquity would be 1)
    expect(F?.value).toBeCloseTo(1 + 16 * Math.pow(0.53 - 0.5, 3), 6);
    expect(slant?.value).toBeCloseTo(res!.result * F!.value, 6);
  });

  it('nighttime (|x| ≥ π/2) gives the 5 ns floor', () => {
    // t far from 50400 with small period → x large → floor
    const res = computeEquation(146, { alpha1: 5e-9, phi_m: 0, t_sec: 0, beta1: 50400 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(5, 6);
  });

  it('frontend input symbols wire correctly: A→alpha1, φ_m→phi_m (normalizeInputs)', () => {
    const normalized = normalizeInputs(146, { A: 5e-9, x: 0.5, φ_m: 45 } as unknown as Record<string, number>);
    expect(normalized['alpha1']).toBe(5e-9);
    expect(normalized['phi_m']).toBe(45);
  });
});