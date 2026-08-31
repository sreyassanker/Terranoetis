import { describe, expect, it } from 'vitest';
import { haversineDistance } from '../../utils/geo';

describe('haversineDistance', () => {
  it('returns zero for the same point', () => {
    expect(haversineDistance(35.68, 139.76, 35.68, 139.76)).toBe(0);
  });

  it('computes a realistic great-circle distance (Tokyo → Osaka)', () => {
    // Tokyo Station to Osaka Station is ~396km
    expect(haversineDistance(35.6762, 139.6503, 34.6937, 135.5023)).toBeCloseTo(396, -1);
  });

  it('computes distance across the Atlantic (NYC → London)', () => {
    // ~5570km
    expect(haversineDistance(40.7128, -74.006, 51.5074, -0.1278)).toBeCloseTo(5570, -2);
  });

  it('computes distance across the Pacific (LA → Sydney)', () => {
    // ~12050km
    expect(haversineDistance(34.0522, -118.2437, -33.8688, 151.2093)).toBeCloseTo(12050, -2);
  });

  it('handles antipodal points', () => {
    // North Pole to South Pole ~20015km
    const dist = haversineDistance(90, 0, -90, 0);
    expect(dist).toBeCloseTo(20015, -2);
  });

  it('handles negative coordinates', () => {
    // São Paulo to Cape Town
    expect(haversineDistance(-23.5505, -46.6333, -33.9249, 18.4241)).toBeCloseTo(6345, -2);
  });

  it('returns positive distance regardless of argument order', () => {
    const d1 = haversineDistance(0, 0, 1, 1);
    const d2 = haversineDistance(1, 1, 0, 0);
    expect(d1).toBeCloseTo(d2, 10);
    expect(d1).toBeGreaterThan(0);
  });

  it('handles equator crossing', () => {
    // Quito, Ecuador (on equator) to Nairobi, Kenya (near equator)
    expect(haversineDistance(0, -78.4678, -1.2921, 36.8219)).toBeCloseTo(12819, -2);
  });
});
