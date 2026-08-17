/**
 * Shepard (1968) inverse distance weighting interpolation.
 *
 * ŷ(s₀) = Σ(wᵢ·zᵢ)/Σ(wᵢ),  wᵢ = 1/dᵢᵖ  (p = 2 in Shepard's original)
 *
 * Exact interpolator: as d → 0 the weight → ∞, so the prediction tends
 * to the sample value (implemented as a short-distance snap so the
 * d = 0 case never divides by zero).
 */

import { pairDistanceKm } from './kriging';

export interface IdwInput {
  lat: number;
  lon: number;
  value: number;
  siteName?: string;
}

export interface IdwResult {
  yhat: number;
  weights: number[];
  distancesKm: number[];
  exactAt: number | null;   // index when the target is exactly at a sample
  nObs: number;
}

export function inverseDistanceWeighting(
  obs: IdwInput[],
  target: { lat: number; lon: number },
  power: number = 2,
): IdwResult | null {
  if (obs.length === 0) return null;
  const distancesKm = obs.map((o) => pairDistanceKm(o.lat, o.lon, target.lat, target.lon));
  // Exact-interpolator snap: target within 1 m of a sample → its value.
  let exactAt: number | null = null;
  for (let i = 0; i < distancesKm.length; i++) {
    if (distancesKm[i] < 0.001) { exactAt = i; break; }
  }
  if (exactAt != null) {
    const weights = obs.map((_, i) => (i === exactAt ? 1 : 0));
    return { yhat: obs[exactAt].value, weights, distancesKm, exactAt, nObs: obs.length };
  }
  const weights = distancesKm.map((d) => 1 / Math.pow(d, power));
  const sumW = weights.reduce((s, w) => s + w, 0);
  if (!Number.isFinite(sumW) || sumW <= 0) return null;
  const norm = weights.map((w) => w / sumW);
  const yhat = obs.reduce((s, o, i) => s + norm[i] * o.value, 0);
  if (!Number.isFinite(yhat)) return null;
  return { yhat, weights: norm, distancesKm, exactAt: null, nObs: obs.length };
}
