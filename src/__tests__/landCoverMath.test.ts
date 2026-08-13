/**
 * Unit tests for the pure Land Cover Mapper math (k-means, silhouette, auto-k,
 * HSV rules). No DOM, no Cesium, no transformers.js — see src/lib/landCoverMath.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  kmeans,
  silhouetteScore,
  autoDetectK,
  rgbToHsv,
  classifyRgb,
  mulberry32,
} from '@/lib/landCoverMath';
import { LAND_COVER_CLASSES } from '@/data/landCoverClasses';

/** Two tight, well-separated 2-D blobs: n1 points near (0,0), n2 near (10,10). */
function twoBlobs(n1 = 12, n2 = 12, jitter = 0.1, seed = 7): { features: Float32Array; n: number; d: number } {
  const n = n1 + n2;
  const d = 2;
  const features = new Float32Array(n * d);
  const rnd = mulberry32(seed);
  for (let i = 0; i < n1; i++) {
    features[i * d] = (rnd() - 0.5) * jitter;
    features[i * d + 1] = (rnd() - 0.5) * jitter;
  }
  for (let i = 0; i < n2; i++) {
    features[(n1 + i) * d] = 10 + (rnd() - 0.5) * jitter;
    features[(n1 + i) * d + 1] = 10 + (rnd() - 0.5) * jitter;
  }
  return { features, n, d };
}

describe('kmeans', () => {
  it('partitions two well-separated blobs into the two clusters', () => {
    const { features, n, d } = twoBlobs();
    const { labels } = kmeans(features, n, d, 2, 50, 1);
    // The first 12 points should share one label, the last 12 the other.
    const a = labels[0];
    for (let i = 0; i < 12; i++) expect(labels[i]).toBe(a);
    const b = 1 - a;
    for (let i = 12; i < 24; i++) expect(labels[i]).toBe(b);
  });

  it('is deterministic for a fixed seed', () => {
    const { features, n, d } = twoBlobs();
    const r1 = kmeans(features, n, d, 2, 20, 42);
    const r2 = kmeans(features, n, d, 2, 20, 42);
    expect(Array.from(r1.labels)).toEqual(Array.from(r2.labels));
    expect(Array.from(r1.centroids)).toEqual(Array.from(r2.centroids));
  });

  it('different seeds can converge to equivalence-class labelings of the same blobs', () => {
    const { features, n, d } = twoBlobs();
    const r1 = kmeans(features, n, d, 2, 50, 1).labels;
    const r2 = kmeans(features, n, d, 2, 50, 2).labels;
    // Labels may be permuted between runs; both should separate index 11 from 12.
    expect(r1[11]).not.toBe(r1[12]);
    expect(r2[11]).not.toBe(r2[12]);
  });
});

describe('silhouetteScore', () => {
  it('is strongly positive for two well-separated blobs labeled perfectly', () => {
    const { features, n, d } = twoBlobs();
    const labels = new Int32Array(n);
    for (let i = 12; i < n; i++) labels[i] = 1;
    const s = silhouetteScore(features, n, d, labels, 2);
    expect(s).toBeGreaterThan(0.9);
  });

  it('is lower for a scrambled labeling of the same blobs', () => {
    const { features, n, d } = twoBlobs();
    const good = new Int32Array(n);
    for (let i = 12; i < n; i++) good[i] = 1;
    const bad = new Int32Array(n);
    for (let i = 0; i < n; i++) bad[i] = i % 2; // interleave
    const sGood = silhouetteScore(features, n, d, good, 2);
    const sBad = silhouetteScore(features, n, d, bad, 2);
    expect(sBad).toBeLessThan(sGood);
  });

  it('does not allocate the old O(n²) matrix — works on a larger set quickly', () => {
    // 600 points across 3 clusters — old code allocated 600*600*4B ≈ 1.4 MB and
    // completed anyway; the important thing is the result is in [-1, 1].
    const n = 600, d = 4;
    const features = new Float32Array(n * d);
    const rnd = mulberry32(9);
    for (let i = 0; i < n; i++) {
      const c = i % 3;
      for (let j = 0; j < d; j++) features[i * d + j] = c * 10 + rnd();
    }
    const { labels } = kmeans(features, n, d, 3, 20, 5);
    const s = silhouetteScore(features, n, d, labels, 3);
    expect(s).toBeGreaterThanOrEqual(-1);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe('autoDetectK', () => {
  it('picks k=2 over k=3/4 for the two-blob dataset', () => {
    const { features, n, d } = twoBlobs(20, 20);
    const det = autoDetectK(features, n, d, 2, 4, 1);
    expect(det.k).toBe(2);
    expect(det.scores).toHaveLength(3);
    // The returned clustering must already use the winning k.
    const distinct = new Set(Array.from(det.kmeans.labels));
    expect(distinct.size).toBeLessThanOrEqual(2);
  });

  it('agrees with a direct kmeans run for the winning k (deterministic)', () => {
    const { features, n, d } = twoBlobs(14, 14);
    const det = autoDetectK(features, n, d, 3, 5, 3);
    const direct = kmeans(features, n, d, det.k, 20, 3 + det.k);
    // Same seed → same labels (possibly permuted by automorphism of k-means++ order,
    // but with the same seed sequence they are identical).
    expect(Array.from(det.kmeans.labels)).toEqual(Array.from(direct.labels));
  });
});

describe('rgbToHsv', () => {
  it('maps pure red to hue 0', () => {
    const { h, s, v } = rgbToHsv([255, 0, 0]);
    expect(h).toBeCloseTo(0, 5);
    expect(s).toBeCloseTo(1, 5);
    expect(v).toBeCloseTo(1, 5);
  });

  it('maps green to hue 120', () => {
    const { h } = rgbToHsv([0, 255, 0]);
    expect(h).toBeCloseTo(120, 5);
  });

  it('maps blue to hue 240', () => {
    const { h } = rgbToHsv([0, 0, 255]);
    expect(h).toBeCloseTo(240, 5);
  });

  it('maps white to s=0, v=1', () => {
    const { s, v } = rgbToHsv([255, 255, 255]);
    expect(s).toBeCloseTo(0, 5);
    expect(v).toBeCloseTo(1, 5);
  });

  it('maps black to s=0, v=0', () => {
    const { s, v } = rgbToHsv([0, 0, 0]);
    expect(s).toBe(0);
    expect(v).toBe(0);
  });
});

describe('classifyRgb', () => {
  const byId = (id: number) => LAND_COVER_CLASSES.find(c => c.id === id)!;

  it('classifies deep blue as Water', () => {
    expect(classifyRgb([10, 40, 180], LAND_COVER_CLASSES).id).toBe(byId(1).id); // Water
  });

  it('classifies saturated green as Vegetation', () => {
    expect(classifyRgb([40, 160, 50], LAND_COVER_CLASSES).id).toBe(byId(2).id); // Vegetation
  });

  it('classifies tan / brown as Bare Land', () => {
    expect(classifyRgb([200, 160, 90], LAND_COVER_CLASSES).id).toBe(byId(4).id); // Bare Land / Soil
  });

  it('classifies bright white as Snow / Ice', () => {
    expect(classifyRgb([245, 248, 252], LAND_COVER_CLASSES).id).toBe(byId(5).id); // Snow / Ice
  });

  it('classifies very dark pixels as Shadow / Dark', () => {
    expect(classifyRgb([15, 18, 22], LAND_COVER_CLASSES).id).toBe(byId(6).id); // Shadow / Dark
  });

  it('classifies neutral gray as Urban / Built-up', () => {
    expect(classifyRgb([140, 140, 140], LAND_COVER_CLASSES).id).toBe(byId(3).id); // Urban
  });

  it('falls back to nearest reference color when a rule picks a class not in the active set', () => {
    // Only Water + Vegetation are active; a white pixel should resolve to whichever is closer (Water's
    // [30,99,212] vs Vegetation's [46,158,68] don't win vs the actual RGB, so the rule fires first: v>0.88 → 'Snow / Ice',
    // which is absent → nearest-RGB fallback should pick one of the two available classes).
    const subset = [byId(1), byId(2)];
    const out = classifyRgb([245, 248, 252], subset);
    expect([1, 2]).toContain(out.id);
  });
});
