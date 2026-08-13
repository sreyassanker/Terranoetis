/**
 * Pure mathematical algorithms for Land Cover Mapper — k-means++, Silhouette analysis,
 * HSV color transforms, and spectral rule classification.
 *
 * Fully decoupled from DOM/Cesium/Transformers so it remains fast and unit-testable.
 */

import type { LandCoverClass } from '@/data/landCoverClasses';

/** Deterministic mulberry32 PRNG for reproducible k-means++ initialization. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface KMeansResult {
  labels: Int32Array;
  centroids: Float32Array;
}

/**
 * Optimized k-means clustering over [n, d] feature vectors with k-means++ seeding.
 */
export function kmeans(
  features: Float32Array,
  n: number,
  d: number,
  k: number,
  maxIter = 20,
  seed = 20240808,
): KMeansResult {
  if (n === 0 || k <= 0) {
    return { labels: new Int32Array(0), centroids: new Float32Array(0) };
  }

  const effectiveK = Math.min(k, n);
  const labels = new Int32Array(n);
  const centroids = new Float32Array(effectiveK * d);
  const dists = new Float32Array(n);
  const rnd = mulberry32(seed);

  // k-means++ seeding
  const first = Math.floor(rnd() * n);
  centroids.set(features.subarray(first * d, (first + 1) * d), 0);

  for (let c = 1; c < effectiveK; c++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      const iOffset = i * d;
      for (let pc = 0; pc < c; pc++) {
        let dd = 0;
        const pcOffset = pc * d;
        for (let j = 0; j < d; j++) {
          const diff = features[iOffset + j] - centroids[pcOffset + j];
          dd += diff * diff;
        }
        if (dd < best) best = dd;
      }
      dists[i] = best;
      sum += best;
    }

    let r = rnd() * sum;
    let pick = 0;
    if (sum > 0) {
      for (let i = 0; i < n; i++) {
        r -= dists[i];
        if (r <= 0) {
          pick = i;
          break;
        }
      }
    } else {
      pick = Math.floor(rnd() * n);
    }
    centroids.set(features.subarray(pick * d, (pick + 1) * d), c * d);
  }

  const sums = new Float32Array(effectiveK * d);
  const counts = new Int32Array(effectiveK);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = 0;
    for (let i = 0; i < n; i++) {
      let bestC = 0;
      let bestD = Infinity;
      const iOffset = i * d;

      for (let c = 0; c < effectiveK; c++) {
        let dd = 0;
        const cOffset = c * d;
        for (let j = 0; j < d; j++) {
          const diff = features[iOffset + j] - centroids[cOffset + j];
          dd += diff * diff;
        }
        if (dd < bestD) {
          bestD = dd;
          bestC = c;
        }
      }

      if (labels[i] !== bestC) {
        labels[i] = bestC;
        changed++;
      }
    }

    if (changed === 0) break;

    // Recompute centroids
    sums.fill(0);
    counts.fill(0);

    for (let i = 0; i < n; i++) {
      const c = labels[i];
      counts[c]++;
      const cOffset = c * d;
      const iOffset = i * d;
      for (let j = 0; j < d; j++) {
        sums[cOffset + j] += features[iOffset + j];
      }
    }

    for (let c = 0; c < effectiveK; c++) {
      if (counts[c] > 0) {
        const cOffset = c * d;
        const count = counts[c];
        for (let j = 0; j < d; j++) {
          centroids[cOffset + j] = sums[cOffset + j] / count;
        }
      }
    }
  }

  return { labels, centroids };
}

/**
 * Calculates mean silhouette score for cluster evaluation without allocating $O(N^2)$ matrices.
 */
export function silhouetteScore(
  features: Float32Array,
  n: number,
  d: number,
  labels: Int32Array,
  k: number,
): number {
  if (n <= k || k <= 1) return -1;

  const members: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) {
    const label = labels[i];
    if (label >= 0 && label < k) {
      members[label].push(i);
    }
  }

  const dist = (i: number, j: number): number => {
    let dd = 0;
    const iOff = i * d;
    const jOff = j * d;
    for (let t = 0; t < d; t++) {
      const diff = features[iOff + t] - features[jOff + t];
      dd += diff * diff;
    }
    return Math.sqrt(dd);
  };

  let sum = 0;
  let scored = 0;

  for (let i = 0; i < n; i++) {
    const own = members[labels[i]];
    if (!own || own.length < 2) continue;

    let aSum = 0;
    for (let idx = 0; idx < own.length; idx++) {
      const j = own[idx];
      if (j !== i) aSum += dist(i, j);
    }
    const a = aSum / (own.length - 1);

    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === labels[i]) continue;
      const others = members[c];
      if (!others || others.length === 0) continue;

      let bSum = 0;
      for (let idx = 0; idx < others.length; idx++) {
        bSum += dist(i, others[idx]);
      }
      const mb = bSum / others.length;
      if (mb < b) b = mb;
    }

    if (!Number.isFinite(b)) continue;
    const denom = Math.max(a, b);
    if (denom > 0) {
      sum += (b - a) / denom;
      scored++;
    }
  }

  return scored > 0 ? sum / scored : -1;
}

export interface AutoKResult {
  k: number;
  scores: number[];
  kmeans: KMeansResult;
}

/** Automatically picks the optimal cluster count $k$ using silhouette score maximization. */
export function autoDetectK(
  features: Float32Array,
  n: number,
  d: number,
  minK = 3,
  maxK = 6,
  seed = 20240808,
): AutoKResult {
  let bestK = minK;
  let bestScore = -Infinity;
  let bestKmeans: KMeansResult | null = null;
  const scores: number[] = [];

  for (let k = minK; k <= maxK; k++) {
    const km = kmeans(features, n, d, k, 20, seed + k);
    const s = silhouetteScore(features, n, d, km.labels, k);
    scores.push(Number(s.toFixed(3)));
    if (s > bestScore || !bestKmeans) {
      bestScore = s;
      bestK = k;
      bestKmeans = km;
    }
  }

  return {
    k: bestK,
    scores,
    kmeans: bestKmeans ?? kmeans(features, n, d, minK, 20, seed),
  };
}

export interface HSV {
  h: number;
  s: number;
  v: number;
}

export function rgbToHsv([r, g, b]: readonly [number, number, number]): HSV {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;

  if (s > 0) {
    if (max === R) h = 60 * (((G - B) / d) % 6);
    else if (max === G) h = 60 * ((B - R) / d + 2);
    else h = 60 * ((R - G) / d + 4);
    if (h < 0) h += 360;
  }

  return { h, s, v };
}

/** Classifies an RGB triplet into a target LandCoverClass based on satellite HSV rules. */
export function classifyRgb(
  rgb: readonly [number, number, number],
  classes: readonly LandCoverClass[],
): LandCoverClass {
  const { h, s, v } = rgbToHsv(rgb);
  let pick: string | null = null;

  if (v > 0.88 && s < 0.18) pick = 'Snow / Ice';
  else if (v < 0.16) pick = 'Shadow / Dark';
  else if (s > 0.08 && h >= 185 && h <= 260) pick = 'Water';
  else if (s > 0.08 && h >= 70 && h <= 170) pick = 'Vegetation';
  else if (s < 0.14 && v < 0.8) pick = 'Urban / Built-up';
  else if (s > 0.12 && h >= 20 && h <= 65) pick = 'Bare Land / Soil';
  else if (s < 0.3) pick = 'Urban / Built-up';
  else pick = 'Vegetation';

  const found = classes.find(c => c.name === pick);
  if (found) return found;

  // Fallback: nearest color match by Euclidean RGB distance
  let best = classes[0];
  let bestDist = Infinity;
  for (const c of classes) {
    const dr = rgb[0] - c.rgb[0];
    const dg = rgb[1] - c.rgb[1];
    const db = rgb[2] - c.rgb[2];
    const distSq = dr * dr + dg * dg + db * db;
    if (distSq < bestDist) {
      bestDist = distSq;
      best = c;
    }
  }

  return best;
}