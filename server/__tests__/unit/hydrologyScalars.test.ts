import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 7 — Bulk Richardson Number (Stull 1988) ─────────────────────
// Ri_b = g·Δz·Δθ_v/(θ_v·Δu²). Worked example: z_g=100, z_s=2, θ_v(z)=305,
// θ_v(s)=300, u(z)=10, u(s)=2 → Δz=98, Δθ=5, Δu=8, den=300·64=19200,
// Ri = 9.81·98·5/19200 = 0.2504 (stable).

describe('Tool 7 — Bulk Richardson Number', () => {
  it('worked example: Ri ≈ 0.25 (stable threshold)', () => {
    const res = computeEquation(7, { zg: 100, zs: 2, thvz: 305, thvs: 300, uz: 10, us: 2 });
    const expected = 9.80665 * 98 * 5 / (300 * 8 * 8);
    expect(res!.result).toBeCloseTo(expected, 6);
  });
  it('unstable when θ_v(z) < θ_v(s)', () => {
    const res = computeEquation(7, { zg: 100, zs: 2, thvz: 295, thvs: 300, uz: 10, us: 2 });
    expect(res!.result).toBeLessThan(0);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(7, { zg: '100', zs: '2', thvz: '305', thvs: '300', uz: '10', us: '2' } as any)!.result)).toBe(true);
  });
  it('honest NaN on missing', () => {
    expect(Number.isNaN(computeEquation(7, { zg: NaN, zs: NaN, thvz: NaN, thvs: NaN, uz: NaN, us: NaN })!.result)).toBe(true);
  });
});

// ── Tool 8 — Kolmogorov −5/3 Spectrum (1941) ─────────────────────────
// E(k) = C·ε^(2/3)·k^(−5/3). Worked example: C=1.5, ε=0.001, k=0.01
// → E = 1.5·0.001^(2/3)·0.01^(−5/3) = 1.5·0.01·464.2 = 6.96.

describe('Tool 8 — Kolmogorov Energy Cascade', () => {
  it('C=1.5, ε=0.001, k=0.01 → E≈6.96', () => {
    const res = computeEquation(8, { C: 1.5, eps: 0.001, k: 0.01 });
    expect(res!.result).toBeCloseTo(1.5 * Math.pow(0.001, 2 / 3) * Math.pow(0.01, -5 / 3), 6);
    expect(res!.unit).toBe('m³/s²');
  });
  it('exposes eddy_size as secondary', () => {
    const sec = computeEquation(8, { C: 1.5, eps: 0.001, k: 0.01 })!.secondary ?? [];
    expect(sec.find((s) => s.key === 'eddy_size')?.value).toBeCloseTo(2 * Math.PI / 0.01, 6);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(8, { C: '1.5', eps: '0.001', k: '0.01' } as any)!.result)).toBe(true);
  });
  it('honest NaN on missing', () => {
    expect(Number.isNaN(computeEquation(8, { C: NaN, eps: NaN, k: NaN })!.result)).toBe(true);
  });
});

// ── Tool 11 — Manning's Equation (1891) ──────────────────────────────
// v = (1/n)·R^(2/3)·S^(1/2). Worked example: n=0.03, R=1.5, S=0.001
// → v = (1/0.03)·1.5^(2/3)·√0.001 = 33.3·1.31·0.0316 = 1.38 m/s.

describe('Tool 11 — Manning Equation', () => {
  it('n=0.03, R=1.5, S=0.001 → v≈1.38 m/s', () => {
    const res = computeEquation(11, { n: 0.03, R: 1.5, S: 0.001 });
    expect(res!.result).toBeCloseTo((1 / 0.03) * Math.pow(1.5, 2 / 3) * Math.sqrt(0.001), 6);
    expect(res!.unit).toBe('m/s');
  });
  it('higher roughness → lower velocity', () => {
    const low = computeEquation(11, { n: 0.03, R: 1.5, S: 0.001 })!;
    const high = computeEquation(11, { n: 0.06, R: 1.5, S: 0.001 })!;
    expect(low.result).toBeGreaterThan(high.result);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(11, { n: '0.03', R: '1.5', S: '0.001' } as any)!.result)).toBe(true);
  });
  it('honest NaN on missing', () => {
    expect(Number.isNaN(computeEquation(11, { n: NaN, R: NaN, S: NaN })!.result)).toBe(true);
  });
});

// ── Tool 12 — Rational Method (Mulvaney 1851) ────────────────────────
// Q = C·i·A (mm/h·km²) → m³/s ÷3.6. Worked example: C=0.5, i=10, A=10
// → Q = 0.5·10·10 = 50 mm/h·km² → 50/3.6 = 13.9 m³/s.

describe('Tool 12 — Rational Method', () => {
  it('C=0.5, i=10, A=10 → Q≈13.9 m³/s', () => {
    const res = computeEquation(12, { C: 0.5, i: 10, A: 10 });
    expect(res!.result).toBeCloseTo(50 / 3.6, 6);
    expect(res!.unit).toBe('m³/s');
  });
  it('higher rainfall intensity → higher discharge', () => {
    const low = computeEquation(12, { C: 0.5, i: 10, A: 10 })!;
    const high = computeEquation(12, { C: 0.5, i: 50, A: 10 })!;
    expect(high.result).toBeGreaterThan(low.result);
  });
  it('does NOT throw on string inputs', () => {
    expect(Number.isFinite(computeEquation(12, { C: '0.5', i: '10', A: '10' } as any)!.result)).toBe(true);
  });
  it('honest NaN on missing', () => {
    expect(Number.isNaN(computeEquation(12, { C: NaN, i: NaN, A: NaN })!.result)).toBe(true);
  });
});
