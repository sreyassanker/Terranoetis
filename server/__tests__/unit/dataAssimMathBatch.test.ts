import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 141 — Ensemble Kalman Filter analysis (Evensen 1994) ──────────
// x_a = x_f + K·(y − H·x_f); K = P_f·H/(H·P_f·H + R); P_a = (1−K·H)·P_f
// Worked example: x_f=10, P_f=4, H=1, y=12, R=1 → K=0.8, x_a=11.6, P_a=0.8.

describe('Tool 141 — Ensemble Kalman Filter analysis (Evensen 1994)', () => {
  it('worked example → x_a = 11.6, K = 0.8, P_a = 0.8', () => {
    const res = computeEquation(141, { xf: 10, Pf: 4, y: 12, R: 1, H: 1 })!;
    expect(res.result).toBeCloseTo(11.6, 12);
    expect(res.unit).toBe('—');
    const sec = res.secondary ?? [];
    expect(sec.find((s) => s.key === 'kalman_gain')!.value).toBeCloseTo(0.8, 12);
    expect(sec.find((s) => s.key === 'innovation')!.value).toBeCloseTo(2, 12);
    expect(sec.find((s) => s.key === 'analysis_error_covariance')!.value).toBeCloseTo(0.8, 12);
  });

  it('low-noise obs pulls x_a to y (K→1 when R→0)', () => {
    const res = computeEquation(141, { xf: 10, Pf: 4, y: 12, R: 1e-6, H: 1 })!;
    expect(res.result).toBeCloseTo(12, 4);
    expect(res.secondary!.find((s) => s.key === 'kalman_gain')!.value).toBeCloseTo(1, 4);
  });

  it('zero preservation: innovation = 0 → x_a = x_f', () => {
    const res = computeEquation(141, { xf: 10, Pf: 4, y: 10, R: 1, H: 1 })!;
    expect(res.result).toBe(10);
    expect(res.secondary!.find((s) => s.key === 'innovation')!.value).toBe(0);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(141, { xf: NaN, Pf: NaN, y: NaN, R: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });

  it('honest NaN when P_f ≤ 0 (early-return branch exposes NaN secondaries)', () => {
    const res = computeEquation(141, { xf: 10, Pf: 0, y: 12, R: 1 })!;
    expect(Number.isNaN(res.result)).toBe(true);
    const sec = res.secondary ?? [];
    expect(sec.length).toBeGreaterThan(0);
    expect(sec.every((s) => Number.isNaN(s.value))).toBe(true);
    expect(sec.map((s) => s.key)).toEqual(['analysis_error_covariance', 'innovation', 'kalman_gain']);
  });

  it('honest NaN when R < 0', () => {
    const res = computeEquation(141, { xf: 10, Pf: 4, y: 12, R: -1 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(141, { xf: '10', Pf: '4', y: '12', R: '1', H: '1' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });

  it('no series (scalar result)', () => {
    const res = computeEquation(141, { xf: 10, Pf: 4, y: 12, R: 1, H: 1 })!;
    expect(res.series).toBeUndefined();
  });
});

// ── Tool 142 — Optimal Interpolation (Lorenz 1969) ──────────────────────
// x_a = x_b + K·(y − H·x_b); K = B·H/(H·B·H + R); P_a = (1−K·H)·B
// Worked example: x_b=10, B=4, H=1, y=12, R=1 → x_a=11.6, K=0.8, P_a=0.8.
// NOTE: OI uses x_b as base state (not x_f) — unlike tool 141.

describe('Tool 142 — Optimal Interpolation (Lorenz 1969)', () => {
  it('worked example → x_a = 11.6 (base state is x_b, not x_f)', () => {
    const res = computeEquation(142, { xb: 10, B: 4, y: 12, R: 1, H: 1 })!;
    expect(res.result).toBeCloseTo(11.6, 12);
    const sec = res.secondary ?? [];
    expect(sec.find((s) => s.key === 'kalman_gain')!.value).toBeCloseTo(0.8, 12);
    expect(sec.find((s) => s.key === 'analysis_increment')!.value).toBeCloseTo(1.6, 12);
    expect(sec.find((s) => s.key === 'analysis_error_variance')!.value).toBeCloseTo(0.8, 12);
  });

  it('uses x_b as base state: same numbers as 141 but reads xb not xf', () => {
    const res = computeEquation(142, { xb: 10, B: 4, y: 12, R: 1, H: 1 })!;
    expect(res.result).toBeCloseTo(11.6, 12);
  });

  it('zero preservation: innovation = 0 → x_a = x_b', () => {
    const res = computeEquation(142, { xb: 10, B: 4, y: 10, R: 1, H: 1 })!;
    expect(res.result).toBe(10);
    expect(res.secondary!.find((s) => s.key === 'analysis_increment')!.value).toBe(0);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(142, { xb: NaN, B: NaN, y: NaN, R: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });

  it('honest NaN when B ≤ 0 (early-return exposes NaN secondaries)', () => {
    const res = computeEquation(142, { xb: 10, B: 0, y: 12, R: 1 })!;
    expect(Number.isNaN(res.result)).toBe(true);
    const sec = res.secondary ?? [];
    expect(sec.map((s) => s.key)).toEqual(['analysis_increment', 'analysis_error_variance', 'kalman_gain']);
    expect(sec.every((s) => Number.isNaN(s.value))).toBe(true);
  });

  it('honest NaN when R < 0', () => {
    const res = computeEquation(142, { xb: 10, B: 4, y: 12, R: -1 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(142, { xb: '10', B: '4', y: '12', R: '1', H: '1' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });

  it('no series (scalar result)', () => {
    const res = computeEquation(142, { xb: 10, B: 4, y: 12, R: 1, H: 1 })!;
    expect(res.series).toBeUndefined();
  });
});

// ── Tool 143 — 4D-Var / 3D-Var cost function (Le Dimet & Talagrand 1986) ─
// J(x) = ½(x−x_b)²/B + ½(y−H·x)²/R
// Worked example: x=11, x_b=10, B=4, y=12, H=1, R=1 → J = ½·1/4 + ½·1 = 0.625.
// Optimal analysis x_a = (x_b/B + H·y/R) / (1/B + H²/R).

describe('Tool 143 — 4D-Var cost function (Le Dimet & Talagrand 1986)', () => {
  it('worked example → J = 0.625 with J_b = 0.125, J_o = 0.5', () => {
    const res = computeEquation(143, { x: 11, xb: 10, B: 4, y: 12, H: 1, R: 1 })!;
    expect(res.result).toBeCloseTo(0.625, 12);
    const sec = res.secondary ?? [];
    expect(sec.find((s) => s.key === 'background_term')!.value).toBeCloseTo(0.125, 12);
    expect(sec.find((s) => s.key === 'observation_term')!.value).toBeCloseTo(0.5, 12);
  });

  it('exposes optimal analysis x_a (∇J = 0) = 11.6', () => {
    const res = computeEquation(143, { x: 11, xb: 10, B: 4, y: 12, H: 1, R: 1 })!;
    const xa = res.secondary!.find((s) => s.key === 'optimal_analysis')!;
    expect(xa.value).toBeCloseTo(11.6, 12);
  });

  it('zero preservation: x = x_b and y = H·x → J = 0', () => {
    const res = computeEquation(143, { x: 10, xb: 10, B: 4, y: 10, H: 1, R: 1 })!;
    expect(res.result).toBe(0);
    expect(res.secondary!.find((s) => s.key === 'background_term')!.value).toBe(0);
    expect(res.secondary!.find((s) => s.key === 'observation_term')!.value).toBe(0);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(143, { x: NaN, xb: NaN, B: NaN, y: NaN, R: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });

  it('honest NaN when B ≤ 0 or R ≤ 0 (early-return exposes NaN secondaries)', () => {
    const res = computeEquation(143, { x: 11, xb: 10, B: -1, y: 12, R: 1 })!;
    expect(Number.isNaN(res.result)).toBe(true);
    const sec = res.secondary ?? [];
    expect(sec.map((s) => s.key)).toEqual(['background_term', 'observation_term', 'optimal_analysis']);
    expect(sec.every((s) => Number.isNaN(s.value))).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(143, { x: '11', xb: '10', B: '4', y: '12', H: '1', R: '1' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });

  it('no series (scalar result)', () => {
    const res = computeEquation(143, { x: 11, xb: 10, B: 4, y: 12, H: 1, R: 1 })!;
    expect(res.series).toBeUndefined();
  });
});

// ── Tool 144 — Shannon information entropy (Shannon 1948) ───────────────
// H(X) = −p·log₂p − (1−p)·log₂(1−p). Also exposes H(Y), joint H(X,Y),
// and mutual information I = H(X) + H(Y) − H(X,Y).
// Worked example: p=0.5 → 1 bit; p=0.25 → ≈0.811 bits.

describe('Tool 144 — Shannon information entropy (Shannon 1948)', () => {
  it('worked example p = 0.5 → H = 1 bit', () => {
    const res = computeEquation(144, { px: 0.5, py: 0.5, Hxy: 0.25 })!;
    expect(res.result).toBeCloseTo(1, 12);
    expect(res.unit).toBe('bits');
  });

  it('worked example p = 0.25 → H ≈ 0.811 bits', () => {
    const res = computeEquation(144, { px: 0.25, py: 0.5, Hxy: 0.25 })!;
    const expected = -(0.25 * Math.log2(0.25) + 0.75 * Math.log2(0.75));
    expect(res.result).toBeCloseTo(expected, 12);
    expect(res.result).toBeCloseTo(0.8112781, 5);
  });

  it('exposes entropy_y, joint_entropy, mutual_information secondaries', () => {
    const res = computeEquation(144, { px: 0.5, py: 0.25, Hxy: 0.25 })!;
    const sec = res.secondary ?? [];
    const hy = sec.find((s) => s.key === 'entropy_y')!;
    expect(hy.value).toBeCloseTo(0.8112781, 5);
    expect(sec.find((s) => s.key === 'joint_entropy')!.value).toBeCloseTo(0.25, 12);
    const mi = sec.find((s) => s.key === 'mutual_information')!;
    expect(mi.value).toBeCloseTo(1 + 0.8112781 - 0.25, 5);
  });

  it('mutual information = 0 for independent X, Y (Hxy = Hx + Hy)', () => {
    const res = computeEquation(144, { px: 0.5, py: 0.5, Hxy: 2 })!;
    expect(res.secondary!.find((s) => s.key === 'mutual_information')!.value).toBeCloseTo(0, 12);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(144, { px: NaN, py: NaN, Hxy: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });

  it('honest NaN when p outside (0, 1) (early-return exposes NaN secondaries)', () => {
    const res = computeEquation(144, { px: 0, py: 0.5, Hxy: 0.25 })!;
    expect(Number.isNaN(res.result)).toBe(true);
    const sec = res.secondary ?? [];
    expect(sec.map((s) => s.key)).toEqual(['entropy_y', 'joint_entropy', 'mutual_information']);
    expect(sec.every((s) => Number.isNaN(s.value))).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(144, { px: '0.5', py: '0.5', Hxy: '0.25' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });

  it('no series (scalar result)', () => {
    const res = computeEquation(144, { px: 0.5, py: 0.5, Hxy: 0.25 })!;
    expect(res.series).toBeUndefined();
  });
});

// ── Tool 145 — Free-space path loss (Friis 1946; ITU-R P.525-2) ─────────
// FSPL = 32.45 + 20·log₁₀(d_km) + 20·log₁₀(f_GHz) dB
// Worked example: d=1 km, f=1 GHz → 32.45 dB.

describe('Tool 145 — Free-space path loss (Friis 1946)', () => {
  it('worked example d = 1 km, f = 1 GHz → 32.45 dB', () => {
    const res = computeEquation(145, { dKm: 1, fGHz: 1 })!;
    expect(res.result).toBeCloseTo(32.45, 12);
    expect(res.unit).toBe('dB');
  });

  it('exposes wavelength and reference received power secondaries', () => {
    const res = computeEquation(145, { dKm: 1, fGHz: 1 })!;
    const sec = res.secondary ?? [];
    expect(sec.find((s) => s.key === 'wavelength_m')!.value).toBeCloseTo(0.3, 12);
    expect(sec.find((s) => s.key === 'received_power_dBm')!.value).toBeCloseTo(40 + 20 + 0 - 32.45, 12);
  });

  it('FSPL scales 20 dB per decade of distance', () => {
    const d10 = computeEquation(145, { dKm: 10, fGHz: 1 })!;
    const d1 = computeEquation(145, { dKm: 1, fGHz: 1 })!;
    expect(d10.result - d1.result).toBeCloseTo(20, 10);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(145, { dKm: NaN, fGHz: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });

  it('honest NaN when d ≤ 0 or f ≤ 0 (early-return exposes NaN secondaries)', () => {
    const res = computeEquation(145, { dKm: 0, fGHz: 1 })!;
    expect(Number.isNaN(res.result)).toBe(true);
    const sec = res.secondary ?? [];
    expect(sec.map((s) => s.key)).toEqual(['wavelength_m', 'received_power_dBm']);
    expect(sec.every((s) => Number.isNaN(s.value))).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(145, { dKm: '1', fGHz: '1' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });

  it('no series (scalar result)', () => {
    const res = computeEquation(145, { dKm: 1, fGHz: 1 })!;
    expect(res.series).toBeUndefined();
  });
});

// ── Tool 147 — Doppler effect (Doppler 1842) ───────────────────────────
// Classical: Δf = −f₀·v/c. Relativistic: f_obs = f₀·√((1−β)/(1+β)).
// Worked example: f₀=1e9, v=1000 m/s, c=3e8 → Δf = −3333 Hz.

describe('Tool 147 — Doppler effect (Doppler 1842)', () => {
  it('worked example f₀=1e9, v=1000, c=3e8 → Δf ≈ −3333 Hz', () => {
    const res = computeEquation(147, { f0: 1e9, vrel: 1000, c: 3e8 })!;
    expect(res.result).toBeCloseTo(-3333.333333, 3);
    expect(res.unit).toBe('Hz');
  });

  it('exposes relativistic_shift, observed_frequency, beta secondaries', () => {
    const res = computeEquation(147, { f0: 1e9, vrel: 1000, c: 3e8 })!;
    const sec = res.secondary ?? [];
    const beta = 1000 / 3e8;
    expect(sec.find((s) => s.key === 'beta')!.value).toBeCloseTo(beta, 15);
    const fObs = 1e9 * Math.sqrt((1 - beta) / (1 + beta));
    expect(sec.find((s) => s.key === 'observed_frequency')!.value).toBeCloseTo(fObs, 3);
    expect(sec.find((s) => s.key === 'relativistic_shift')!.value).toBeCloseTo(fObs - 1e9, 3);
  });

  it('non-relativistic and relativistic agree to O(β) for v ≪ c', () => {
    const res = computeEquation(147, { f0: 1e9, vrel: 1000, c: 3e8 })!;
    const rel = res.secondary!.find((s) => s.key === 'relativistic_shift')!.value;
    expect(Math.abs(rel - res.result) / Math.abs(res.result)).toBeLessThan(1e-3);
  });

  it('approaching source → positive shift (blueshift)', () => {
    const res = computeEquation(147, { f0: 1e9, vrel: -1000, c: 3e8 })!;
    expect(res.result).toBeGreaterThan(0);
  });

  it('zero preservation: v = 0 → Δf = 0', () => {
    const res = computeEquation(147, { f0: 1e9, vrel: 0, c: 3e8 })!;
    expect(res.result).toBe(0);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(147, { f0: NaN, vrel: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });

  it('honest NaN when f₀ ≤ 0 or |v| ≥ c (early-return exposes NaN secondaries)', () => {
    const res = computeEquation(147, { f0: 0, vrel: 1000, c: 3e8 })!;
    expect(Number.isNaN(res.result)).toBe(true);
    const sec = res.secondary ?? [];
    expect(sec.map((s) => s.key)).toEqual(['relativistic_shift', 'observed_frequency', 'beta']);
    expect(sec.every((s) => Number.isNaN(s.value))).toBe(true);
  });

  it('honest NaN when |v| ≥ c (tachyonic invalid)', () => {
    const res = computeEquation(147, { f0: 1e9, vrel: 3.1e8, c: 3e8 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(147, { f0: '1e9', vrel: '1000', c: '3e8' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });

  it('returns Doppler-shift series across β (−0.8c → +0.8c)', () => {
    const res = computeEquation(147, { f0: 1e9, vrel: 1000, c: 3e8 })!;
    expect(res.series).toBeDefined();
    const s = res.series![0];
    expect(s.points.length).toBeGreaterThanOrEqual(20);
    expect(s.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(s.points[0].x).toBeCloseTo(-0.8, 3);
    const last = s.points[s.points.length - 1];
    expect(last.x).toBeCloseTo(0.8, 3);
  });
});

// ── Tool 148 — Hohmann transfer (Hohmann 1925) ─────────────────────────
// Δv₁ = √(GM/r₁)·(√(2r₂/(r₁+r₂)) − 1); Δv₂ = √(GM/r₂)·(1 − √(2r₁/(r₁+r₂)))
// Worked example: Earth GM=3.986e14, r₁=6771 km, r₂=42164 km → Δv₁≈2.40 km/s,
// total ≈ 3.86 km/s, transfer time ≈ 5.29 h.

describe('Tool 148 — Hohmann transfer (Hohmann 1925)', () => {
  const GM = 3.986e14, r1 = 6771000, r2 = 42164000;

  it('worked example → Δv₁ ≈ 2.40 km/s', () => {
    const res = computeEquation(148, { GM, r1, r2 })!;
    const expected = Math.sqrt(GM / r1) * (Math.sqrt(2 * r2 / (r1 + r2)) - 1);
    expect(res.result).toBeCloseTo(expected, 4);
    expect(res.result / 1000).toBeCloseTo(2.3995, 2);
    expect(res.unit).toBe('m/s');
  });

  it('exposes dv2, total_dv, transfer time, semi-major axis, period', () => {
    const res = computeEquation(148, { GM, r1, r2 })!;
    const sec = res.secondary ?? [];
    const vc2 = Math.sqrt(GM / r2);
    const dv2 = vc2 * (1 - Math.sqrt(2 * r1 / (r1 + r2)));
    expect(sec.find((s) => s.key === 'dv2')!.value).toBeCloseTo(dv2, 4);
    expect(sec.find((s) => s.key === 'total_dv')!.value).toBeCloseTo(Math.abs(res.result) + Math.abs(dv2), 4);
    expect(sec.find((s) => s.key === 'total_dv')!.value / 1000).toBeCloseTo(3.8567, 2);
    const a = (r1 + r2) / 2;
    const period = 2 * Math.PI * Math.sqrt(a * a * a / GM);
    expect(sec.find((s) => s.key === 'semi_major_axis')!.value).toBeCloseTo(a, 0);
    expect(sec.find((s) => s.key === 'period')!.value).toBeCloseTo(period, 4);
    expect(sec.find((s) => s.key === 'transfer_time_s')!.value).toBeCloseTo(period / 2, 4);
    expect(sec.find((s) => s.key === 'transfer_time_h')!.value).toBeCloseTo(period / 2 / 3600, 4);
  });

  it('circular-to-circular: r2 = r1 → Δv = 0', () => {
    const res = computeEquation(148, { GM, r1, r2: r1 })!;
    expect(res.result).toBeCloseTo(0, 10);
    expect(res.secondary!.find((s) => s.key === 'total_dv')!.value).toBeCloseTo(0, 10);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(148, { GM: NaN, r1: NaN, r2: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });

  it('honest NaN when GM ≤ 0 or r ≤ 0 (early-return exposes NaN secondaries)', () => {
    const res = computeEquation(148, { GM, r1: 0, r2 })!;
    expect(Number.isNaN(res.result)).toBe(true);
    const sec = res.secondary ?? [];
    expect(sec.map((s) => s.key)).toEqual(['dv2', 'total_dv', 'transfer_time_s', 'transfer_time_h', 'semi_major_axis', 'period']);
    expect(sec.every((s) => Number.isNaN(s.value))).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(148, { GM: String(GM), r1: String(r1), r2: String(r2) } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });

  it('returns transfer-orbit velocity series over radius (r₁ → r₂)', () => {
    const res = computeEquation(148, { GM, r1, r2 })!;
    expect(res.series).toBeDefined();
    const s = res.series![0];
    expect(s.points.length).toBeGreaterThanOrEqual(30);
    expect(s.points[0].x).toBeCloseTo(r1 / 1000, 3);
    expect(s.points[s.points.length - 1].x).toBeCloseTo(r2 / 1000, 0);
    expect(s.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(s.points[0].y).toBeCloseTo(Math.sqrt(GM / r1) / 1000, 3);
  });
});

// ── Tool 149 — Lagrange points (CR3BP; Lagrange 1772, Euler 1767) ─────
// L1, L2, L3 via Newton-Raphson on the collinear force balance; L4/L5 at
// (0.5−μ, ±√3/2). Worked example: m1=1, m2=0.01 (μ≈0.0099) →
// L1≈0.859 from primary, L2≈1.156 from primary, L3≈0.994 from primary.

describe('Tool 149 — Lagrange points L1–L5 (CR3BP)', () => {
  const mu = 0.01 / 1.01;

  it('worked example μ ≈ 0.0099 → L1 ≈ 0.859 from primary', () => {
    const res = computeEquation(149, { x: 1, y: 0.01 })!;
    expect(res.secondary!.find((s) => s.key === 'mass_ratio')!.value).toBeCloseTo(mu, 15);
    expect(res.secondary!.find((s) => s.key === 'L1_from_primary')!.value).toBeCloseTo(0.8585, 3);
    expect(res.result).toBeCloseTo(1 - 0.8585251, 5);
  });

  it('L2 and L3 are distinct from L1 (regression: L2 was aliasing L1)', () => {
    const res = computeEquation(149, { x: 1, y: 0.01 })!;
    const sec = res.secondary ?? [];
    const l1 = sec.find((s) => s.key === 'L1_from_secondary')!.value;
    const l2 = sec.find((s) => s.key === 'L2_from_secondary')!.value;
    const l3 = sec.find((s) => s.key === 'L3_from_primary')!.value;
    expect(l2).toBeCloseTo(0.1562207, 5);
    expect(l1).not.toBeCloseTo(l2, 3);
    expect(l3).toBeCloseTo(0.9942244, 5);
  });

  it('L4/L5 at (0.5−μ, ±√3/2)', () => {
    const res = computeEquation(149, { x: 1, y: 0.01 })!;
    const sec = res.secondary ?? [];
    const xL4 = 0.5 - mu;
    expect(sec.find((s) => s.key === 'L4_x')!.value).toBeCloseTo(xL4, 12);
    expect(sec.find((s) => s.key === 'L4_y')!.value).toBeCloseTo(Math.sqrt(3) / 2, 12);
    expect(sec.find((s) => s.key === 'L5_x')!.value).toBeCloseTo(xL4, 12);
    expect(sec.find((s) => s.key === 'L5_y')!.value).toBeCloseTo(-Math.sqrt(3) / 2, 12);
  });

  it('Earth-Moon μ ≈ 0.0122 gives L1 ≈ 0.849, L2 ≈ 1.168', () => {
    const res = computeEquation(149, { x: 5.972e24, y: 7.348e22 })!;
    const sec = res.secondary ?? [];
    expect(sec.find((s) => s.key === 'L1_from_primary')!.value).toBeCloseTo(0.849, 3);
    expect(sec.find((s) => s.key === 'L2_from_primary')!.value).toBeCloseTo(1.168, 3);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(149, { x: NaN, y: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });

  it('honest NaN when m ≤ 0 (early-return exposes NaN secondaries)', () => {
    const res = computeEquation(149, { x: 1, y: 0 })!;
    expect(Number.isNaN(res.result)).toBe(true);
    const sec = res.secondary ?? [];
    expect(sec.length).toBeGreaterThan(0);
    expect(sec.every((s) => Number.isNaN(s.value))).toBe(true);
  });

  it('does NOT throw on string inputs (m1/m2 aliased via context engine only)', () => {
    const res = computeEquation(149, { x: '1', y: '0.01' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });

  it('no series (scalar result)', () => {
    const res = computeEquation(149, { x: 1, y: 0.01 })!;
    expect(res.series).toBeUndefined();
  });
});

// ── Tool 150 — Mutual information (Shannon 1948; Cover & Thomas 2006) ───
// I(X;Y) = H(X) + H(Y) − H(X,Y) for binary variables.
// Worked example: px=py=0.5, pxy=0.25 (independent) → I=0;
// px=py=0.5, pxy=0.5 → I=1 bit.

describe('Tool 150 — Mutual information (binary)', () => {
  it('independent X, Y (px=py=0.5, pxy=0.25) → I = 0', () => {
    const res = computeEquation(150, { px: 0.5, py: 0.5, pxy: 0.25 })!;
    expect(res.result).toBeCloseTo(0, 12);
    expect(res.unit).toBe('bits');
  });

  it('fully dependent (px=py=pxy=0.5) → I = 1 bit', () => {
    const res = computeEquation(150, { px: 0.5, py: 0.5, pxy: 0.5 })!;
    expect(res.result).toBeCloseTo(1, 12);
  });

  it('exposes entropy_x, entropy_y, joint_entropy, and p00…p11', () => {
    const res = computeEquation(150, { px: 0.5, py: 0.5, pxy: 0.25 })!;
    const sec = res.secondary ?? [];
    expect(sec.find((s) => s.key === 'entropy_x')!.value).toBeCloseTo(1, 12);
    expect(sec.find((s) => s.key === 'entropy_y')!.value).toBeCloseTo(1, 12);
    expect(sec.find((s) => s.key === 'joint_entropy')!.value).toBeCloseTo(2, 12);
    expect(sec.find((s) => s.key === 'p11')!.value).toBeCloseTo(0.25, 12);
    expect(sec.find((s) => s.key === 'p10')!.value).toBeCloseTo(0.25, 12);
    expect(sec.find((s) => s.key === 'p01')!.value).toBeCloseTo(0.25, 12);
    expect(sec.find((s) => s.key === 'p00')!.value).toBeCloseTo(0.25, 12);
  });

  it('p joint distribution sums to 1', () => {
    const res = computeEquation(150, { px: 0.5, py: 0.5, pxy: 0.25 })!;
    const sec = res.secondary ?? [];
    const sum = ['p00', 'p01', 'p10', 'p11'].reduce((acc, k) => acc + sec.find((s) => s.key === k)!.value, 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(150, { px: NaN, py: NaN, pxy: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
  });

  it('honest NaN when pxy out of [0, min(px,py)] (early-return exposes NaN secondaries)', () => {
    const res = computeEquation(150, { px: 0.5, py: 0.5, pxy: 0.6 })!;
    expect(Number.isNaN(res.result)).toBe(true);
    const sec = res.secondary ?? [];
    expect(sec.map((s) => s.key)).toEqual(['entropy_x', 'entropy_y', 'joint_entropy', 'p00', 'p01', 'p10', 'p11']);
    expect(sec.every((s) => Number.isNaN(s.value))).toBe(true);
  });

  it('honest NaN when px or py outside (0, 1)', () => {
    const res = computeEquation(150, { px: 1, py: 0.5, pxy: 0.5 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(150, { px: '0.5', py: '0.5', pxy: '0.25' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });

  it('no series (scalar result)', () => {
    const res = computeEquation(150, { px: 0.5, py: 0.5, pxy: 0.25 })!;
    expect(res.series).toBeUndefined();
  });
});
