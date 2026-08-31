import { describe, it, expect } from 'vitest';
import { computeEquation, normalizeInputs } from '../../analytical-models/engine';

// ── Tool 13 — Muskingum Routing (McCarthy 1938) ──────────────────────
// S = K·[X·I_t + (1−X)·O_t]; X = weighting on INFLOW (0–0.5).
// Worked example (frontend-cited): K=6 h, X=0.2, I=100, O=80:
//   S = 6 × (0.2×100 + 0.8×80) = 6 × (20 + 64) = 504 m³/s·h
// Routing coefficients (Δt = K/2 = 3 h):
//   C₀ = (−KX + 0.5Δt)/D, C₁ = (KX + 0.5Δt)/D, C₂ = (K(1−X) − 0.5Δt)/D,
//   D = K(1−X) + 0.5Δt = 4.8 + 1.5 = 6.3
//   C₀ = (−1.2 + 1.5)/6.3 = 0.0476, C₁ = (1.2+1.5)/6.3 = 0.4286,
//   C₂ = (4.8 − 1.5)/6.3 = 0.5238

describe('Tool 13 — Muskingum Routing', () => {
  it('worked example: K=6, X=0.2, I=100, O=80 → S=504 m³/s·h', () => {
    const res = computeEquation(13, { K: 6, X: 0.2, It: 100, Ot: 80 });
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(504, 6);
    expect(res!.unit).toBe('m³/s·h');
  });

  it('X=0 (reservoir) gives maximum attenuation weighting', () => {
    const res = computeEquation(13, { K: 6, X: 0, It: 100, Ot: 80 });
    // S = 6 × (0×100 + 1×80) = 480
    expect(res!.result).toBeCloseTo(480, 6);
  });

  it('emits the routed outflow series (timeseries tool)', () => {
    const res = computeEquation(13, { K: 6, X: 0.2, It: 100, Ot: 80 });
    expect(res!.series).toBeDefined();
    expect(res!.series!.length).toBe(1);
    expect(res!.series![0].points.length).toBeGreaterThan(10);
    for (const p of res!.series![0].points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('exposes outflow_next and routing coefficients as secondary', () => {
    const res = computeEquation(13, { K: 6, X: 0.2, It: 100, Ot: 80 });
    const sec = res!.secondary ?? [];
    const outNext = sec.find((s) => s.key === 'outflow_next');
    const c0 = sec.find((s) => s.key === 'coeff_c0');
    const c1 = sec.find((s) => s.key === 'coeff_c1');
    const c2 = sec.find((s) => s.key === 'coeff_c2');
    // C₀ + C₁ + C₂ = 1 (mass conservation)
    expect(c0!.value + c1!.value + c2!.value).toBeCloseTo(1, 6);
    // O(t+1) = C₀I(t+1) + C₁I(t) + C₂O(t) = 0.0476·100 + 0.4286·100 + 0.5238·80
    const expected = (c0!.value + c1!.value) * 100 + c2!.value * 80;
    expect(outNext!.value).toBeCloseTo(expected, 6);
  });

  it('does NOT throw when inputs arrive as strings (numeric coercion)', () => {
    const res = computeEquation(13, { K: '6', X: '0.2', It: '100', Ot: '80' } as unknown as Record<string, number>);
    expect(res).not.toBeNull();
    expect(res!.result).toBeCloseTo(504, 6);
  });

  it('returns honest NaN when genuine streamflow is missing (no fabricated I_t)', () => {
    const res = computeEquation(13, { K: 6, X: 0.2, It: Number.NaN, Ot: Number.NaN });
    expect(res).not.toBeNull();
    expect(Number.isNaN(res!.result)).toBe(true);
    // no fabricated series
    expect(res!.series).toBeUndefined();
  });

  it('param alias: Iₜ→It, Oₜ→Ot via normalizeInputs', () => {
    const normalized = normalizeInputs(13, { Iₜ: 100, Oₜ: 80 } as unknown as Record<string, number>);
    expect(normalized['It']).toBe(100);
    expect(normalized['Ot']).toBe(80);
  });
});
