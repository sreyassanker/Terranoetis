import { describe, it, expect } from 'vitest';
import { interpolateIDW, medianNearestNeighborDistanceM } from '../rendering/idwInterpolation';
import type { InterpPoint } from '../rendering/idwInterpolation';

// 1°x1° bbox ≈ 111 km per side. Grid of cell centres at 0.1° spacing.
const bbox = { latMin: 35, latMax: 36, lonMin: 139, lonMax: 140 };

/** Regular grid of "measured pixels" over [latMin+0.05, latMax-0.05],
 *  optionally punching an all-NaN cloud gap in the middle. */
function pixelGrid(): InterpPoint[] {
  const pts: InterpPoint[] = [];
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      pts.push({ lat: 35.05 + i * 0.1, lon: 139.05 + j * 0.1, value: i + j });
    }
  }
  return pts;
}

describe('IDW from measured pixels (LST heatmap replacement)', () => {
  it('reproduces measured values at the sample cells (exact interpolator)', () => {
    const pts = pixelGrid();
    const nn = medianNearestNeighborDistanceM(pts);
    const grid = interpolateIDW(pts, bbox, 40, 40, 2, 12, nn * 0.75);
    // Sample at (35.45, 139.45) has i=4, j=4 → value 8. In the 40×40 output
    // grid its cell centre sits at row/col 18 ((35.45-35)*40-0.5 ≈ 17.5→18).
    const row = 18;
    const col = 18;
    const v = grid.data[row * 40 + col];
    expect(Number.isFinite(v)).toBe(true);
    expect(Math.abs(v - 8)).toBeLessThan(0.5);
  });

  it('medianNearestNeighborDistanceM recovers the 0.1° (~11 km) pixel spacing', () => {
    const pts = pixelGrid();
    const nn = medianNearestNeighborDistanceM(pts);
    // 0.1 deg lat ≈ 11132 m; 0.1 deg lon at 35.5°N ≈ 9065 m. Median NN is one of these.
    expect(nn).toBeGreaterThan(8000);
    expect(nn).toBeLessThan(12000);
  });

  it('covers the fully-measured region but leaves a cloud gap transparent (NaN)', () => {
    const pts = pixelGrid();
    const nn = medianNearestNeighborDistanceM(pts);
    const reach = nn * 0.75;
    const grid = interpolateIDW(pts, bbox, 40, 40, 2, 12, reach);

    // Interior point far from all samples: centre of the grid.
    const centre = grid.data[20 * 40 + 20];
    expect(Number.isFinite(centre)).toBe(true);

    // Cloud void: remove every pixel with 4 <= i <= 6 AND 4 <= j <= 6,
    // then the hole centre (35.55, 139.55) is > reach from any sample.
    const cloudy = pixelGrid().filter(p => !(p.lat > 35.35 && p.lat < 35.75 && p.lon > 139.35 && p.lon < 139.75));
    const nn2 = medianNearestNeighborDistanceM(cloudy);
    const grid2 = interpolateIDW(cloudy, bbox, 40, 40, 2, 12, nn2 * 0.75);
    // Hole centre cell should now be NaN (no measurement within reach).
    const hole = grid2.data[Math.round((35.55 - 35) * 40) * 40 + Math.round((139.55 - 139) * 40)];
    expect(Number.isNaN(hole)).toBe(true);
    // But measured areas still render.
    const valid = Array.from(grid2.data).filter(v => Number.isFinite(v)).length;
    expect(valid).toBeGreaterThan(grid2.data.length * 0.5);
  });

  it('never invents values outside the samples: NaN cells are truly no-data', () => {
    // A single tight cluster far from the bbox corner → corner stays NaN.
    // Points sit exactly on 40×40 cell centres (35.2125, 139.2125) etc.
    const pts: InterpPoint[] = [
      { lat: 35.2125, lon: 139.2125, value: 30 },
      { lat: 35.2375, lon: 139.2125, value: 31 },
      { lat: 35.2125, lon: 139.2375, value: 29 },
    ];
    const nn = medianNearestNeighborDistanceM(pts);
    const grid = interpolateIDW(pts, bbox, 40, 40, 2, 12, nn * 0.75);
    const farCorner = grid.data[39 * 40 + 39]; // (≈36°N, 140°E) — no data nearby
    expect(Number.isNaN(farCorner)).toBe(true);
    const atCluster = grid.data[8 * 40 + 8]; // cell centre = first sample
    expect(Number.isFinite(atCluster)).toBe(true);
    expect(atCluster).toBeGreaterThanOrEqual(29);
    expect(atCluster).toBeLessThanOrEqual(31);
  });

  it('backward-compatible: no reach limit interpolates the whole bbox', () => {
    const pts = pixelGrid();
    const grid = interpolateIDW(pts, bbox, 20, 20);
    expect(Array.from(grid.data).every(Number.isFinite)).toBe(true);
  });
});
