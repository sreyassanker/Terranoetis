import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 90 — Nash Cascade (Nash, 1957) ──────────────────────────────
// Paper: Nash, J.E. (1957) The form of the instantaneous unit hydrograph.
// International Association of Scientific Hydrology 3, 114-121.
// doi:10.1080/02626665709493274
//
//   q(t) = t^(n−1) / (K^(n−1)·(n−1)!) · (1/K) · e^(−t/K) · Q₀
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
});
