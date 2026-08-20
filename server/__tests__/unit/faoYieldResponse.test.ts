import { describe, it, expect } from 'vitest';
import { faoYieldResponse } from '../../analytical-models/engine';

describe('faoYieldResponse — FAO IDP 33 / IDP 66 Eq. (1): (1−Yₐ/Yₘ) = K_y × (1−ETₐ/ETₘ)', () => {
  it('reproduces the paper worked example (ETₐ=400, ETₘ=600, K_y=1.1)', () => {
    const r = faoYieldResponse(Number.NaN, 8, 1.1, 400, 600);
    // 1 − ETₐ/ETₘ = 1 − 400/600 = 0.3333…; × 1.1 = 0.3667
    expect(r.relReduction).toBeCloseTo(0.3667, 3);
    expect(r.predictedYa).toBeCloseTo(8 * (1 - 0.3667), 3);
    expect(r.residual).toBeNull(); // no observed Yₐ supplied
  });

  it('maize example from paper Table: K_y=1.25, 48% ET deficit → 60% yield reduction', () => {
    const r = faoYieldResponse(Number.NaN, 10, 1.25, 520, 1000);
    // 1 − 520/1000 = 0.48; × 1.25 = 0.60
    expect(r.relReduction).toBeCloseTo(0.6, 3);
    expect(r.predictedYa).toBeCloseTo(10 * 0.4, 3); // 4 t/ha
  });

  it('full-water supply → zero reduction regardless of K_y', () => {
    const r = faoYieldResponse(Number.NaN, 8, 1.5, 600, 600);
    expect(r.relReduction).toBeCloseTo(0, 10);
    expect(r.predictedYa).toBeCloseTo(8, 6);
  });

  it('computes the observed-vs-predicted residual when Yₐ is supplied', () => {
    // ETₐ=400, ETₘ=600 → deficit 1/3; K_y=1.1 → predicted reduction 0.3667.
    // Observed Yₐ=5 → observed loss 1−5/8 = 0.375; residual = +0.0083 (observed loss exceeds predicted).
    const r = faoYieldResponse(5, 8, 1.1, 400, 600);
    expect(r.relReduction).toBeCloseTo(0.3667, 3);
    expect(r.residual).toBeCloseTo(0.375 - 0.3667, 3);
  });

  it('severe stress stays inside the linear regime (K_y·(1−ETₐ/ETₘ) can exceed 1 → clamps only at interpretation)', () => {
    const r = faoYieldResponse(Number.NaN, 8, 1.25, 200, 1000); // deficit 0.8 × 1.25 = 1.0
    expect(r.relReduction).toBeCloseTo(1.0, 10);
    expect(r.predictedYa).toBeCloseTo(0, 6);
  });

  it('K_y < 1 means yield reduction is less than proportional', () => {
    const r = faoYieldResponse(Number.NaN, 8, 0.85, 400, 600); // deficit 1/3 × 0.85
    expect(r.relReduction).toBeCloseTo(0.85 * (1 / 3), 6);
    expect(r.relReduction).toBeLessThan(1 / 3);
  });
});
