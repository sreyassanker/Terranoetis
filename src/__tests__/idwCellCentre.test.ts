import { describe, it, expect } from 'vitest';
import { interpolateIDW } from '../rendering/idwInterpolation';

const bbox = { latMin: 35, latMax: 36, lonMin: 139, lonMax: 140 };

describe('interpolateIDW cell-centre convention', () => {
  it('places the field peak at the cell whose centre holds the data point', () => {
    // Two points with different values so the field actually varies.
    // A sits exactly at cell (5,5)'s centre, B at cell (0,0)'s centre.
    const points = [
      { lat: 35.55, lon: 139.55, value: 1.0 },
      { lat: 35.05, lon: 139.05, value: 0.0 },
    ];
    const grid = interpolateIDW(points, bbox, 10, 10);
    const v = (r: number, c: number) => grid.data[r * 10 + c];

    // Peak at the cell containing A, decaying monotonically away from it.
    expect(v(5, 5)).toBeGreaterThan(v(5, 4));
    expect(v(5, 4)).toBeGreaterThan(v(5, 3));
    expect(v(5, 5)).toBeGreaterThan(0.99);
    // Trough near the cell containing B.
    expect(v(0, 0)).toBeLessThan(0.05);
  });

  it('variance at the data-point cell is far lower than at distant cells', () => {
    const points = [
      { lat: 35.55, lon: 139.55, value: 1.0 },
      { lat: 35.05, lon: 139.05, value: 0.0 },
    ];
    const grid = interpolateIDW(points, bbox, 10, 10);
    expect(grid.variance[5 * 10 + 5]).toBeLessThan(grid.variance[9 * 10 + 9]);
  });

  it('grid dims and extent are preserved', () => {
    const points = [{ lat: 35.5, lon: 139.5, value: 1.0 }];
    const grid = interpolateIDW(points, bbox, 10, 10);
    expect(grid.width).toBe(10);
    expect(grid.height).toBe(10);
    expect(grid.latMin).toBe(35);
    expect(grid.latMax).toBe(36);
    expect(grid.lonMin).toBe(139);
    expect(grid.lonMax).toBe(140);
  });
});
