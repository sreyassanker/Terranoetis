import { describe, expect, it } from 'vitest';
import { distanceKm } from '../../utils/geo';

describe('distanceKm', () => {
  it('returns zero for the same point', () => {
    expect(distanceKm(35.68, 139.76, 35.68, 139.76)).toBe(0);
  });

  it('computes a realistic great-circle distance', () => {
    expect(distanceKm(35.6762, 139.6503, 34.6937, 135.5023)).toBeCloseTo(396, -1);
  });
});
