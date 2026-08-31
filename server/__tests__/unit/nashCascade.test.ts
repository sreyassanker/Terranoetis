import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 90 — Nash Cascade (Nash, 1957) ──────────────────────────────
// Paper: Nash, J.E. (1957) The form of the instantaneous unit hydrograph.
// International Association of Scientific Hydrology 3, 114-121.
// doi:10.1080/02626665709493274
//
//   q(t) = t^(n−1) / (K^(n−1)·Γ(n)) · (1/K) · e^(−t/K) · Q₀
//
// Regression guard: the USGS Water Services API returns streamflow (which
// becomes Q₀) as a JSON *string* ("1.4"), and the old engine called
// Q0.toFixed() directly — throwing "Q0.toFixed is not a function" and
// 500-ing the /execute endpoint. The engine must coerce string inputs.

describe('Tool 90 — Nash Cascade', () => {
  // Hand-check: q(24) = 24²/(6²·2!) · (1/6) · e^(−24/6) · 1.4
  //   = (576/72)·(1/6)·e⁻⁴·1.4 = 8·0.16667·0.018316·1.4 = 0.034189 m³/s
  const EXPECTED = 0.03418919259;
  it('worked example: n=3, K=6, t=24, Q₀=1.4 → q ≈ 0.03419 m³/s', () => {
    const res = computeEquation(90, { n: 3, K: 6, t: 24, Q0: 1.4 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(EXPECTED, 6);
    expect(res!.unit).toBe('m³/s');
  });

  it('does NOT throw when Q₀ arrives as a string (USGS raw value) — regression test', () => {
    const res = computeEquation(90, { n: 3, K: 6, t: 24, Q0: '1.4' as unknown as number });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(EXPECTED, 6);
    expect(Number.isFinite(res!.result)).toBe(true);
  });

  it('does NOT throw when every input is string-typed (normalizeInputs path)', () => {
    const normalized = normalizeInputs(90, { n: '3', K: '6', t: '24', Q0: '1.4' } as unknown as Record<string, number>);
    const res = computeEquation(90, normalized);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(EXPECTED, 6);
  });

  it('time to peak t_p = (n−1)·K = 12 h is reported in the steps', () => {
    const res = computeEquation(90, { n: 3, K: 6, t: 24, Q0: 1.4 });
    const step = (res!.steps ?? []).find((s) => s.includes('Time to peak'));
    expect(step).toContain('12.0 h');
  });

  it('Q₀ = 0 is preserved (not treated as missing → 100)', () => {
    const res = computeEquation(90, { n: 3, K: 6, t: 24, Q0: 0 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(0, 10);
  });

  // ── Series (full IUH hydrograph) ──
  it('emits a genuine series of the IUH hydrograph over time', () => {
    const res = computeEquation(90, { n: 3, K: 6, t: 24, Q0: 1.4 });
    expect(res!.series).toBeDefined();
    expect(res!.series!.length).toBe(1);
    const pts = res!.series![0].points;
    expect(pts.length).toBeGreaterThan(10);
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // q(t=0) = 0 (no outflow at the instant of rainfall excess onset)
    expect(pts[0].y).toBeCloseTo(0, 9);
    // Peak at t_p = 12 h — the maximum of the series
    const peak = pts.reduce((m, p) => (p.y > m.y ? p : m), pts[0]);
    expect(peak.x).toBeCloseTo(12, 0);
  });

  // ── Secondary outputs ──
  it('exposes time_to_peak, peak_outflow and peak_factor as secondary', () => {
    const res = computeEquation(90, { n: 3, K: 6, t: 24, Q0: 100 });
    const sec = res!.secondary ?? [];
    const tp = sec.find((s) => s.key === 'time_to_peak');
    const qp = sec.find((s) => s.key === 'peak_outflow');
    const pf = sec.find((s) => s.key === 'peak_factor');
    expect(tp?.value).toBeCloseTo(12, 6);
    // q_p = Q0 · (2/e)² / (2! · K) = 100 · 0.27067 / 6 = 4.511
    expect(qp?.value).toBeCloseTo(100 * Math.pow(2 / Math.E, 2) / (2 * 6), 6);
    // dimensionless peak factor for n=3: (2/e)²/2! = 0.2707
    expect(pf?.value).toBeCloseTo(Math.pow(2 / Math.E, 2) / 2, 6);
  });

  it('handles non-integer n via the Lanczos gamma function (n=2.5)', () => {
    const res = computeEquation(90, { n: 2.5, K: 6, t: 12, Q0: 100 });
    expect(res).not.toBeNull();
    expect(Number.isFinite(res!.result)).toBe(true);
    expect(res!.result).toBeGreaterThan(0);
    const sec = res!.secondary ?? [];
    const tp = sec.find((s) => s.key === 'time_to_peak');
    // t_p = (n−1)·K = 1.5 × 6 = 9 h
    expect(tp?.value).toBeCloseTo(9, 6);
  });

  it('frontend-canonical worked example: n=3, K=6, t=12, Q₀=100 → q ≈ 4.51 m³/s', () => {
    // q = 12²/(6²·2!) · (1/6) · e^(−12/6) · 100 = 2·(1/6)·e⁻²·100 = 4.511
    const res = computeEquation(90, { n: 3, K: 6, t: 12, Q0: 100 });
    expect(res!.result).toBeCloseTo(2 * (1 / 6) * Math.exp(-2) * 100, 6);
    // peak outflow at t_p = 12 h
    const qp = res!.secondary!.find((s) => s.key === 'peak_outflow');
    expect(qp!.value).toBeCloseTo(100 * Math.pow(2 / Math.E, 2) / (2 * 6), 6);
    // peak factor = (2/e)²/2! = 0.2707
    const pf = res!.secondary!.find((s) => s.key === 'peak_factor');
    expect(pf!.value).toBeCloseTo(Math.pow(2 / Math.E, 2) / 2, 6);
  });

  // ── Honest NaN ──
  it('returns honest NaN (not a fabricated value) when Q₀ is missing', () => {
    const res = computeEquation(90, { n: 3, K: 6, t: 24, Q0: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
    // no fabricated series
    expect(res!.series).toBeUndefined();
    // secondary is honest NaN too
    for (const s of res!.secondary ?? []) expect(Number.isNaN(s.value)).toBe(true);
  });
});
