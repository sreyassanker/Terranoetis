import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

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
});

// ── Tool 146 — Klobuchar Ionospheric Delay (Klobuchar 1987) ──────────
// Fix regression: contextEngine defaulted α coefficients to 50/60/30/20 s
// (≈9 orders of magnitude too large), producing 1.4×10¹⁵ ns delay.
// Real broadcast α are ~10⁻⁸ s; paper example yields 77.6 ns (23.3 m).
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
});