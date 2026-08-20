import { describe, expect, it } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// Munk (1950) "On the wind-driven ocean circulation", J. Meteorology 7(2):79–93.
// Verified anchors from the paper:
//  - k = (β/A_H)^(1/3) = 0.016 km⁻¹ for A = 5×10⁷ cm²/s, β = 1.9×10⁻¹³ s⁻¹cm⁻¹ (35°N)
//  - Table 1: X_w extrema 0.45 / 1.17 / 1.09 / 0.97 at x/L_w = 1/6, 3/6, 4/6, 1,
//    with X'_w/k = 0.55 / 0.00 / −0.09 / 0.00 (L_w = 4π/(√3k), eq 24)
//  - Countercurrent = exp(−π/√3) ≈ 17% of the main current (paper: 17%, observed 19%)

function Xw(x: number, k: number): number {
  const u = (Math.sqrt(3) * k * x) / 2;
  return 1 - Math.exp(-(k * x) / 2) * (Math.cos(u) + (1 / Math.sqrt(3)) * Math.sin(u));
}

function XwPrime(x: number, k: number): number {
  const u = (Math.sqrt(3) * k * x) / 2;
  return (2 * k / Math.sqrt(3)) * Math.exp(-(k * x) / 2) * Math.sin(u);
}

describe('Tool 68 — Munk viscous boundary layer (Munk 1950)', () => {
  it('k = (β/A_H)^(1/3) matches the paper\'s 0.016 km⁻¹ (A = 5e7 cm²/s, β = 1.9e-13 s⁻¹cm⁻¹)', () => {
    // paper's own numbers in cgs: β = 1.9e-13 s⁻¹cm⁻¹, A = 5e7 cm²/s
    const k_cgs = Math.cbrt(1.9e-13 / 5e7); // cm⁻¹
    expect(k_cgs * 1e5).toBeCloseTo(0.016, 1); // 1 cm⁻¹ = 1e5 km⁻¹
    // SI check: A = 5e3 m²/s, β = 2e-11 s⁻¹m⁻¹ → k = 1.587e-5 m⁻¹ = 0.0159 km⁻¹
    const k_si = Math.cbrt(2e-11 / 5e3);
    expect(k_si).toBeCloseTo(1.587e-5, 8);
    expect(k_si * 1e3).toBeCloseTo(0.0159, 2);
  });

  it('Table 1 extrema of X_w at x/L_w = 1/6, 3/6, 4/6, 1', () => {
    const k = Math.cbrt(2e-11 / 5e3);
    const Lw = (4 * Math.PI) / (Math.sqrt(3) * k);
    const xs = [Lw / 6, (3 * Lw) / 6, (4 * Lw) / 6, Lw];
    const expectedX = [0.45, 1.17, 1.09, 0.97];
    const expectedXp = [0.55, 0.0, -0.09, 0.0];
    xs.forEach((x, i) => {
      expect(Xw(x, k)).toBeCloseTo(expectedX[i], 1);
      expect(XwPrime(x, k) / k).toBeCloseTo(expectedXp[i], 1);
    });
  });

  it('countercurrent = exp(−π/√3) ≈ 17% of the main current (paper: 17%, Wüst observed 19%)', () => {
    const ratio = Math.exp(-Math.PI / Math.sqrt(3));
    expect(ratio).toBeCloseTo(0.163, 3);
    // paper rounds to 17%; the exact value is 16.3%
    expect(ratio * 100).toBeCloseTo(16.3, 1);
  });

  it('engine: paper example with explicit inputs (A=5e3, β=2e-11, curl=1e-6, x=Lw/6, r=6e6)', () => {
    const k = Math.cbrt(2e-11 / 5e3);
    const Lw = (4 * Math.PI) / (Math.sqrt(3) * k);
    const xAxis = Lw / 6;
    const r = 6e6;
    const res = computeEquation(68, { AH: 5e3, beta: 2e-11, curlTau: 1e-6, x: xAxis, r });
    expect(res).not.toBeNull();
    const psi = res!.result as number;
    // ψ = curl·r·X_w·(1−x/r)/β ; X_w(axis) = 0.454, x/r ≈ 0.019
    const X = Xw(xAxis, k) * (1 - xAxis / r);
    const expectPsi = (1e-6 / 2e-11) * r * X;
    expect(psi).toBeCloseTo(expectPsi, 6);
    expect(psi).toBeGreaterThan(0);
    const sec = Object.fromEntries((res!.secondary ?? []).map((s) => [s.key, s.value]));
    expect(sec.munk_width).toBeCloseTo(1 / k, 6);
    expect(sec.wavelength).toBeCloseTo(Lw, 6);
    expect(sec.countercurrent_ratio).toBeCloseTo(Math.exp(-Math.PI / Math.sqrt(3)), 6);
  });

  it('engine: western current transport scale = 1.17·r·curl (paper eq 26), A_H-independent', () => {
    // at the western current limit x = 3Lw/6 = Lw/2, X_w = 1.163 (≈1.17 per Table 1)
    const k = Math.cbrt(2e-11 / 5e3);
    const Lw = (4 * Math.PI) / (Math.sqrt(3) * k);
    const r = 6e6;
    const curl = 1e-6;
    const res = computeEquation(68, { AH: 5e3, beta: 2e-11, curlTau: curl, x: Lw / 2, r });
    const psi = res!.result as number;
    const expected = (curl / 2e-11) * r * 1.163;
    // x/r ≈ 0.019 reduces slightly; allow the paper's rounding
    expect(psi / expected).toBeGreaterThan(0.95);
    expect(psi / expected).toBeLessThan(1.01);
  });

  it('engine: honest NaN when curl is missing (spatial derivative, no genuine point source)', () => {
    const res = computeEquation(68, { AH: 5e3, beta: 2e-11, curlTau: Number.NaN, x: 1e5, r: 6e6 });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
    const steps = res!.steps.join(' ');
    expect(steps).toMatch(/SPATIAL DERIVATIVE/);
  });

  it('engine: β ≤ 0 (pole) → honest NaN, not an absurd number', () => {
    const res = computeEquation(68, { AH: 5e3, beta: 0, curlTau: 1e-6, x: 1e5, r: 6e6 });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
  });
});
