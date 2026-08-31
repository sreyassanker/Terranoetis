import { describe, it, expect } from 'vitest';
import { computeEquation } from '../../analytical-models/engine';

const calc = (id: number, inputs: Record<string, unknown>) =>
  computeEquation(id, inputs as unknown as Record<string, number>);

// ── Tool 36 — Haversine Distance (Sinnott, 1984) ─────────────────────
// d = 2R·asin(√(sin²(Δφ/2) + cosφ1·cosφ2·sin²(Δλ/2))), R = 6371 km
// Worked example: SF(37.7749,−122.4194) → NYC(40.7128,−74.0060) ≈ 4129 km

const PI = Math.PI;
const rd = (x: number) => (x * PI) / 180;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const p1 = rd(lat1), p2 = rd(lat2), dp = rd(lat2 - lat1), dl = rd(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

describe('Tool 36 — Haversine Distance', () => {
  it('worked example: SF→NYC ≈ 4129 km', () => {
    const res = calc(36, { lat1: 37.7749, lon1: -122.4194, lat2: 40.7128, lon2: -74.0060 });
    const expected = haversineKm(37.7749, -122.4194, 40.7128, -74.0060);
    expect(res!.result).toBeCloseTo(expected, 3);
    expect(res!.unit).toBe('km');
  });
  it('string-input coercion', () => {
    const res = calc(36, { lat1: '37.7749', lon1: '-122.4194', lat2: '40.7128', lon2: '-74.0060' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('zero preservation: identical points → 0 km', () => {
    const res = calc(36, { lat1: 0, lon1: 0, lat2: 0, lon2: 0 });
    expect(res!.result).toBeCloseTo(0, 6);
  });
  it('honest NaN when required inputs missing', () => {
    const res = calc(36, { lat1: NaN, lon1: NaN, lat2: NaN, lon2: NaN });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('exposes bearing secondary', () => {
    const res = calc(36, { lat1: 37.7749, lon1: -122.4194, lat2: 40.7128, lon2: -74.0060 });
    const sec = res!.secondary!;
    const bearing = sec.find((s) => s.key === 'bearing')!;
    const midLat = sec.find((s) => s.key === 'midLat')!;
    const midLon = sec.find((s) => s.key === 'midLon')!;
    expect(bearing.value).toBeCloseTo(69.908, 1);
    expect(bearing.unit).toBe('°');
    expect(midLat.value).toBeCloseTo(41.846, 1);
    expect(midLon.value).toBeCloseTo(-98.752, 1);
  });
});

// ── Tool 37 — Ordinary Kriging (Matheron, 1963) ──────────────────────
// ŷ(s₀) = Σλᵢ·z(sᵢ) with weights solving the augmented kriging system.
// Symmetric 2-point case: equidistant → λ₁=λ₂=0.5 → ŷ = mean.

describe('Tool 37 — Ordinary Kriging', () => {
  const fitted = { nugget: 0, sill: 2, range: 80, model: 'spherical' as const };
  it('worked example: symmetric 2-point → mean = 15', () => {
    const res = calc(37, {
      obs: [{ lat: 0, lon: 0, value: 10 }, { lat: 0, lon: 0.1, value: 20 }],
      tlat: 0, tlon: 0.05, fitted, unit: 'm',
    });
    expect(res!.result).toBeCloseTo(15, 3);
  });
  it('string-input coercion on tlat/tlon', () => {
    const res = calc(37, {
      obs: [{ lat: 0, lon: 0, value: 10 }, { lat: 0, lon: 0.1, value: 20 }],
      tlat: '0', tlon: '0.05', fitted, unit: 'm',
    });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('zero preservation: all-zero values → 0', () => {
    const res = calc(37, {
      obs: [{ lat: 0, lon: 0, value: 0 }, { lat: 0, lon: 0.1, value: 0 }, { lat: 0, lon: 0.2, value: 0 }],
      tlat: 0, tlon: 0.1, fitted: { nugget: 0.01, sill: 1, range: 50, model: 'spherical' }, unit: 'm',
    });
    expect(res!.result).toBeCloseTo(0, 6);
  });
  it('honest NaN when no observations', () => {
    const res = calc(37, { obs: [], tlat: 40, tlon: -74, fitted, unit: 'm' });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('exposes variance/sd/weightsSum secondaries', () => {
    const res = calc(37, {
      obs: [{ lat: 0, lon: 0, value: 10 }, { lat: 0, lon: 0.1, value: 20 }],
      tlat: 0, tlon: 0.05, fitted, unit: 'm',
    });
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'variance')!.value).toBeGreaterThan(0);
    expect(sec.find((s) => s.key === 'sd')!.value).toBeGreaterThan(0);
    expect(sec.find((s) => s.key === 'weightsSum')!.value).toBeCloseTo(1, 4);
  });
});

// ── Tool 38 — Inverse Distance Weighting / Shepard (1968) ────────────
// ŷ = Σ(wᵢ·zᵢ)/Σwᵢ,  wᵢ = 1/dᵢᵖ.  Two equidistant points → mean.

describe('Tool 38 — Shepard IDW', () => {
  it('worked example: equidistant 2-point → mean = 15', () => {
    const res = calc(38, {
      obs: [{ lat: 0, lon: 0, value: 10 }, { lat: 0, lon: 0.1, value: 20 }],
      tlat: 0, tlon: 0.05, p: 2, unit: 'm',
    });
    expect(res!.result).toBeCloseTo(15, 6);
  });
  it('string-input coercion on tlat/tlon/p', () => {
    const res = calc(38, {
      obs: [{ lat: 0, lon: 0, value: 10 }, { lat: 0, lon: 0.1, value: 20 }],
      tlat: '0', tlon: '0.05', p: '2', unit: 'm',
    });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('zero preservation: exactAt snap with value 0', () => {
    const res = calc(38, {
      obs: [{ lat: 0, lon: 0, value: 0 }, { lat: 0, lon: 0.1, value: 10 }],
      tlat: 0, tlon: 0, p: 2, unit: 'm',
    });
    expect(res!.result).toBeCloseTo(0, 6);
  });
  it('honest NaN when no observations', () => {
    const res = calc(38, { obs: [], tlat: 40, tlon: -74, p: 2, unit: 'm' });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('exposes nearestKm and topWeight secondaries', () => {
    const res = calc(38, {
      obs: [{ lat: 0, lon: 0, value: 10 }, { lat: 0, lon: 0.1, value: 20 }],
      tlat: 0, tlon: 0.05, p: 2, unit: 'm',
    });
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'nearestKm')!.value).toBeCloseTo(5.56, 0);
    expect(sec.find((s) => s.key === 'topWeight')!.value).toBeCloseTo(0.5, 4);
  });
});

// ── Tool 40 — Gumbel Type-I Extreme Value (Gumbel, 1958) ────────────
// F(x) = exp(−exp(−(x−μ)/β)).  At x = μ, F = 1/e ≈ 0.3679.

describe('Tool 40 — Gumbel Type-I EV', () => {
  it('worked example: at x=μ, F = 1/e ≈ 0.3679', () => {
    const res = calc(40, { mu: 0, beta: 1, x: 0 });
    expect(res!.result).toBeCloseTo(1 / Math.E, 6);
  });
  it('string-input coercion', () => {
    const res = calc(40, { mu: '0', beta: '1', x: '0' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('zero preservation: μ=0 treated as genuine location', () => {
    const res = calc(40, { mu: 0, beta: 1, x: 2 });
    expect(res!.result).toBeCloseTo(Math.exp(-Math.exp(-2)), 6);
  });
  it('honest NaN when β ≤ 0', () => {
    expect(Number.isNaN(calc(40, { mu: 0, beta: 0, x: 1 })!.result)).toBe(true);
    expect(Number.isNaN(calc(40, { mu: 0, beta: -1, x: 1 })!.result)).toBe(true);
  });
  it('honest NaN when inputs missing', () => {
    const res = calc(40, { mu: NaN, beta: NaN, x: NaN });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('exposes returnPeriod, reducedVariate, xReturn100', () => {
    const res = calc(40, { mu: 0, beta: 1, x: 0 });
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'returnPeriod')!.value).toBeCloseTo(1.5819, 2);
    expect(sec.find((s) => s.key === 'reducedVariate')!.value).toBeCloseTo(0, 4);
    expect(sec.find((s) => s.key === 'xReturn100')!.value).toBeCloseTo(4.600, 2);
  });
});

// ── Tool 41 — Generalized Pareto Distribution (Pickands, 1975) ──────
// G(x) = 1 − (1 + ξ·x/σ)^(−1/ξ), ξ ≠ 0.
// Worked example: u=0, σ=1, ξ=0.2, x=1 → G = 1 − 1.2^−5 ≈ 0.5981

describe('Tool 41 — GPD', () => {
  it('worked example: ξ=0.2, β=1, x=1 → G ≈ 0.5981', () => {
    const res = calc(41, { xi: 0.2, beta: 1, x: 1 });
    expect(res!.result).toBeCloseTo(1 - Math.pow(1.2, -5), 6);
  });
  it('string-input coercion', () => {
    const res = calc(41, { xi: '0.2', beta: '1', x: '1' });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('zero preservation: x=0 → G=0 (genuine zero)', () => {
    const res = calc(41, { xi: 0.2, beta: 1, x: 0 });
    expect(res!.result).toBeCloseTo(0, 10);
  });
  it('honest NaN when β ≤ 0', () => {
    expect(Number.isNaN(calc(41, { xi: 0.2, beta: 0, x: 1 })!.result)).toBe(true);
    expect(Number.isNaN(calc(41, { xi: 0.2, beta: -1, x: 1 })!.result)).toBe(true);
  });
  it('honest NaN when inputs missing', () => {
    expect(Number.isNaN(calc(41, { xi: NaN, beta: 1, x: 1 })!.result)).toBe(true);
  });
  it('exposes exceedProb, tailIndex, meanExcess, returnLevel1pct', () => {
    const res = calc(41, { xi: 0.2, beta: 1, x: 1 });
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'exceedProb')!.value).toBeCloseTo(0.401878, 4);
    expect(sec.find((s) => s.key === 'tailIndex')!.value).toBeCloseTo(5, 3);
    expect(sec.find((s) => s.key === 'meanExcess')!.value).toBeCloseTo(1.25, 4);
    expect(sec.find((s) => s.key === 'returnLevel1pct')!.value).toBeCloseTo(7.559, 2);
  });
});

// ── Tool 42 — Matheron Semivariogram (Matheron, 1963) ───────────────
// γ̂(h_k) = ΣΔz² / (2·N(h_k)).
// 4 equatorial points values 0,1,2,3 → 3 pairs at h≈111 km → γ̂ = 0.5

describe('Tool 42 — Matheron Semivariogram', () => {
  const obs = [
    { lat: 0, lon: 0, value: 0 },
    { lat: 0, lon: 1, value: 1 },
    { lat: 0, lon: 2, value: 2 },
    { lat: 0, lon: 3, value: 3 },
  ];
  it('worked example: 4 equatorial points → γ̂ = 0.5', () => {
    const res = calc(42, { obs, K: 10, unit: 'm' });
    expect(res!.result).toBeCloseTo(0.5, 4);
  });
  it('string-input coercion on K and obs values', () => {
    const res = calc(42, {
      obs: [
        { lat: '0', lon: '0', value: '0' },
        { lat: '0', lon: '1', value: '1' },
        { lat: '0', lon: '2', value: '2' },
        { lat: '0', lon: '3', value: '3' },
      ],
      K: '10', unit: 'm',
    });
    expect(Number.isFinite(res!.result)).toBe(true);
  });
  it('zero preservation: all-zero values → γ̂ = 0', () => {
    const res = calc(42, {
      obs: [
        { lat: 0, lon: 0, value: 0 },
        { lat: 0, lon: 1, value: 0 },
        { lat: 0, lon: 2, value: 0 },
        { lat: 0, lon: 3, value: 0 },
      ],
      K: 10, unit: 'm',
    });
    expect(res!.result).toBeCloseTo(0, 6);
  });
  it('honest NaN when fewer than 4 observations', () => {
    const res = calc(42, {
      obs: [{ lat: 0, lon: 0, value: 0 }, { lat: 0, lon: 1, value: 1 }, { lat: 0, lon: 2, value: 2 }],
      K: 10, unit: 'm',
    });
    expect(Number.isNaN(res!.result)).toBe(true);
  });
  it('exposes sillEstimate, nPairs, lagsUsed secondaries', () => {
    const res = calc(42, { obs, K: 10, unit: 'm' });
    const sec = res!.secondary!;
    expect(sec.find((s) => s.key === 'sillEstimate')!.value).toBeCloseTo(0.5, 4);
    expect(sec.find((s) => s.key === 'nPairs')!.value).toBe(3);
    expect(sec.find((s) => s.key === 'lagsUsed')!.value).toBe(1);
  });
});