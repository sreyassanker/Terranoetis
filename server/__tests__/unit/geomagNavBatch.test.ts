import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

// ── Tool 128 — Kp Geomagnetic Activity Index (Bartels 1949) ──────────
// Planetary Kp derived from NOAA SWPC real-time Kp, or a 13-station /
// single-station K-index. Monotonic map to NOAA G-scale:
//   Kp ≥ 5 → G1, ≥ 6 → G2, ≥ 7 → G3, ≥ 8 → G4, ≥ 9 → G5.

describe('Tool 128 — Kp Geomagnetic Index (Bartels 1949)', () => {
  it('worked example: Kp = 5 → G1 minor storm, Ap = 48 nT', () => {
    const res = computeEquation(128, { kp: 5 })!;
    expect(res.result).toBe(5);
    const sec = res.secondary ?? [];
    expect(sec.find((s) => s.key === 'noaa_g_scale')!.value).toBe(1);
    expect(sec.find((s) => s.key === 'ap_index')!.value).toBe(48);
    expect(sec.find((s) => s.key === 'auroral_oval_latitude')!.value).toBeCloseTo(60, 4);
  });

  it('G-scale mapping is monotonic across thresholds', () => {
    const gFor = (kp: number) =>
      computeEquation(128, { kp })!.secondary!.find((s) => s.key === 'noaa_g_scale')!.value;
    expect(gFor(4.9)).toBe(0);
    expect(gFor(5)).toBe(1);
    expect(gFor(6)).toBe(2);
    expect(gFor(7)).toBe(3);
    expect(gFor(8)).toBe(4);
    expect(gFor(9)).toBe(5);
  });

  it('Kp result is bounded to [0, 9]', () => {
    expect(computeEquation(128, { kp: -3 })!.result).toBe(0);
    expect(computeEquation(128, { kp: 42 })!.result).toBe(9);
  });

  it('station K-index scalar → Kp', () => {
    const res = computeEquation(128, { Ki: 6 })!;
    expect(res.result).toBe(6);
    expect(res.secondary!.find((s) => s.key === 'noaa_g_scale')!.value).toBe(2);
  });

  it('honest NaN when no genuine activity input — never fabricates Kp=0', () => {
    const res = computeEquation(128, {})!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
    expect(res.steps.join('\n')).toContain('No fabricated Kp value is substituted');
  });

  it('honest NaN on non-finite kp', () => {
    const res = computeEquation(128, { kp: NaN })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('zero preservation: kp = 0 → quiet, G0, Ap = 0', () => {
    const res = computeEquation(128, { kp: 0 })!;
    expect(res.result).toBe(0);
    expect(res.secondary!.find((s) => s.key === 'noaa_g_scale')!.value).toBe(0);
    expect(res.secondary!.find((s) => s.key === 'ap_index')!.value).toBe(0);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(128, { kp: '6' } as any)!;
    expect(res.result).toBe(6);
  });

  it('no series (gauge vizType, scalar output)', () => {
    const res = computeEquation(128, { kp: 5 })!;
    expect(res.series).toBeUndefined();
  });
});

// ── Tool 129 — Dilution of Precision (DOP) ───────────────────────────
// Q = (H^T·H)^{-1} in ENU+clock space. GDOP = √(ΣQᵢᵢ),
// PDOP=√(Q11+Q22+Q33), HDOP=√(Q11+Q22), VDOP=√(Q33), TDOP=√(Q44).
// Worked example: Q11=Q22=Q33=Q44=1 → GDOP=2, HDOP=√2, VDOP=1.

describe('Tool 129 — DOP (Dilution of Precision)', () => {
  it('worked example: Q = I₄ → GDOP=2, PDOP=√3, HDOP=√2, VDOP=1, TDOP=1', () => {
    const res = computeEquation(129, { Q11: 1, Q22: 1, Q33: 1, Q44: 1 })!;
    expect(res.result).toBeCloseTo(2, 6);
    const sec = res.secondary ?? [];
    expect(sec.find((s) => s.key === 'pdop')!.value).toBeCloseTo(Math.sqrt(3), 6);
    expect(sec.find((s) => s.key === 'hdop')!.value).toBeCloseTo(Math.sqrt(2), 6);
    expect(sec.find((s) => s.key === 'vdop')!.value).toBeCloseTo(1, 6);
    expect(sec.find((s) => s.key === 'tdop')!.value).toBeCloseTo(1, 6);
  });

  it('trace-only: GDOP = √(traceH) is exact', () => {
    const res = computeEquation(129, { traceH: 4 })!;
    expect(res.result).toBeCloseTo(2, 6);
  });

  it('trace split preserves exact GDOP and yields sensible components', () => {
    const res = computeEquation(129, { traceH: 4 })!;
    const sec = res.secondary ?? [];
    const pdop = sec.find((s) => s.key === 'pdop')!.value;
    const hdop = sec.find((s) => s.key === 'hdop')!.value;
    expect(pdop).toBeGreaterThan(0);
    expect(hdop).toBeGreaterThan(0);
    // 0.18+0.18+0.36+0.28 = 1 → GDOP stays √4 = 2
    expect(res.result).toBeCloseTo(2, 6);
  });

  it('honest NaN when no geometry provided — never fabricates GDOP', () => {
    const res = computeEquation(129, {})!;
    expect(Number.isNaN(res.result)).toBe(true);
    expect(Number.isNaN(res.secondary![0].value)).toBe(true);
    expect(res.steps.join('\n')).toContain('No fabricated geometry is substituted');
  });

  it('honest NaN when Q diagonal is incomplete (NaN)', () => {
    const res = computeEquation(129, { Q11: 1, Q22: 1, Q33: NaN, Q44: 1 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('zero preservation: all-zero Q → all DOP = 0', () => {
    const res = computeEquation(129, { Q11: 0, Q22: 0, Q33: 0, Q44: 0 })!;
    expect(res.result).toBe(0);
    expect(res.secondary!.every((s) => s.value === 0)).toBe(true);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(129, { Q11: '1', Q22: '1', Q33: '1', Q44: '1' } as any)!;
    expect(res.result).toBeCloseTo(2, 6);
  });

  it('no series (gauge vizType, scalar output)', () => {
    const res = computeEquation(129, { traceH: 4 })!;
    expect(res.series).toBeUndefined();
  });
});

// ── Tool 130 — Saastamoinen Tropospheric Delay (1972) ────────────────
//   ZHD = 0.0022768 × P
//   ZWD = 0.0022768 × (1255/T + 0.05) × e
//   Δτ  = (ZHD + ZWD) / sin(θ)
// Worked example: P=1013.25 hPa, T=288.15 K, e=10 hPa, z=0 (zenith,
// θ=90°) → ZHD ≈ 2.307 m, ZWD ≈ 0.100 m, Δτ ≈ 2.407 m.

describe('Tool 130 — Saastamoinen Tropospheric Delay (1972)', () => {
  it('worked example: P=1013.25, T=288.15, e=10, zenith → Δτ ≈ 2.407 m', () => {
    const res = computeEquation(130, { P: 1013.25, T: 288.15, e: 10, Sc: Math.PI / 2 })!;
    const expected = 0.0022768 * 1013.25 + 0.0022768 * (1255 / 288.15 + 0.05) * 10;
    expect(res.result).toBeCloseTo(expected, 6);
    expect(res.result).toBeCloseTo(2.4073, 3);
    expect(res.unit).toBe('m');
  });

  it('exposes hydrostatic, wet, and total zenith delays as secondaries', () => {
    const res = computeEquation(130, { P: 1013.25, T: 288.15, e: 10, Sc: Math.PI / 2 })!;
    const sec = res.secondary ?? [];
    expect(sec.find((s) => s.key === 'zhd')!.value).toBeCloseTo(2.30697, 4);
    expect(sec.find((s) => s.key === 'zwd')!.value).toBeCloseTo(0.10030, 4);
    const ztd = sec.find((s) => s.key === 'ztd')!.value;
    expect(ztd).toBeCloseTo(res.result, 6);
  });

  it('slant delay grows as elevation angle decreases', () => {
    const base = { P: 1013.25, T: 288.15, e: 10 } as const;
    const low = computeEquation(130, { ...base, Sc: Math.PI / 6 })!.result; // 30°
    const high = computeEquation(130, { ...base, Sc: Math.PI / 2 })!.result; // 90°
    expect(low).toBeGreaterThan(high);
    expect(low).toBeCloseTo(2.4073 / 0.5, 3);
  });

  it('emits delay-vs-elevation profile series', () => {
    const res = computeEquation(130, { P: 1013.25, T: 288.15, e: 10, Sc: Math.PI / 2 })!;
    expect(res.series).toBeDefined();
    expect(res.series!.length).toBe(1);
    const points = res.series![0].points;
    expect(points.length).toBe(18); // 5°..90° in 5° steps
    expect(points[0].x).toBe(5);
    expect(points[points.length - 1].x).toBe(90);
    // Monotonic decrease: highest delay at lowest elevation angle
    expect(points[0].y).toBeGreaterThan(points[points.length - 1].y);
    // Zenith value (90°) matches the scalar result
    expect(points[points.length - 1].y).toBeCloseTo(res.result, 4);
  });

  it('honest NaN at sin(θ) = 0 (elevation 0° → division by zero)', () => {
    const res = computeEquation(130, { P: 1013.25, T: 288.15, e: 10, Sc: 0 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('honest NaN on non-finite inputs', () => {
    const res = computeEquation(130, { P: NaN, T: 288.15, e: 10, Sc: Math.PI / 2 })!;
    expect(Number.isNaN(res.result)).toBe(true);
  });

  it('honest NaN on unphysical P/T/e', () => {
    expect(Number.isNaN(computeEquation(130, { P: -1, T: 288.15, e: 10, Sc: 1 })!.result)).toBe(true);
    expect(Number.isNaN(computeEquation(130, { P: 1013.25, T: 0, e: 10, Sc: 1 })!.result)).toBe(true);
    expect(Number.isNaN(computeEquation(130, { P: 1013.25, T: 288.15, e: -5, Sc: 1 })!.result)).toBe(true);
  });

  it('zero preservation: e = 0 → ZWD = 0, only hydrostatic delay remains', () => {
    const res = computeEquation(130, { P: 1013.25, T: 288.15, e: 0, Sc: Math.PI / 2 })!;
    expect(res.secondary!.find((s) => s.key === 'zwd')!.value).toBe(0);
    expect(res.result).toBeCloseTo(0.0022768 * 1013.25, 6);
  });

  it('does NOT throw on string inputs', () => {
    const res = computeEquation(130, { P: '1013.25', T: '288.15', e: '10', Sc: '1.5707963267948966' } as any)!;
    expect(Number.isFinite(res.result)).toBe(true);
  });
});
