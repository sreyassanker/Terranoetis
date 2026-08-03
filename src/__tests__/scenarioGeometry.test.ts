/**
 * Unit tests for the geometry helpers fixed in the scenario panel review.
 * Pure functions — no DOM/Cesium/React needed.
 */
import { describe, expect, it } from 'vitest';
import { haversineKm, circleBbox, KM_PER_DEG_LAT } from '@/components/scenarios/geo';

describe('SpatialSketching geometry helpers', () => {
  it('haversineKm returns kilometres, not degrees', () => {
    // 1° of latitude ≈ 111.19 km.
    const d = haversineKm(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112.5);
  });

  it('haversineKm: SF → LA ≈ reference distance', () => {
    const forward = haversineKm(37.7749, -122.4194, 34.0522, -118.2437);
    const backward = haversineKm(34.0522, -118.2437, 37.7749, -122.4194);
    expect(forward).toBeCloseTo(backward, 6);
    // Known spherical haversine SF→LA ≈ 559 km.
    expect(forward).toBeGreaterThan(540);
    expect(forward).toBeLessThan(580);
  });

  it('circleBbox converts km radius to degrees correctly at the equator', () => {
    const bb = circleBbox({ lat: 0, lon: 0 }, KM_PER_DEG_LAT);
    expect(bb.maxLat - bb.minLat).toBeCloseTo(2, 6); // ±1°
    expect(bb.maxLon - bb.minLon).toBeCloseTo(2, 6); // ±1° at equator
  });

  it('circleBbox expands longitude span at high latitude (cos-lat correction)', () => {
    // At 60° N, cos(lat)=0.5, so 1° lon ≈ 55.6 km; a KM_PER_DEG_LAT-km circle spans ~2° lon.
    const bb = circleBbox({ lat: 60, lon: 0 }, KM_PER_DEG_LAT);
    expect(bb.maxLat - bb.minLat).toBeCloseTo(2, 6);
    expect(bb.maxLon - bb.minLon).toBeCloseTo(4, 6);
  });

  it('circleBbox is symmetric about the centre', () => {
    const bb = circleBbox({ lat: 37, lon: -122 }, 50);
    expect(bb.minLat).toBeCloseTo(2 * 37 - bb.maxLat, 6);
    expect(bb.minLon).toBeCloseTo(2 * -122 - bb.maxLon, 6);
  });

  it('circleBbox clamps cos(lat) so polar circles do not blow up', () => {
    // At the pole every direction is south; guard against division-by-zero.
    const bb = circleBbox({ lat: 89.999, lon: 0 }, 100);
    expect(Number.isFinite(bb.minLon)).toBe(true);
    expect(Number.isFinite(bb.maxLon)).toBe(true);
    expect(bb.maxLon - bb.minLon).toBeLessThanOrEqual(360); // may cover all longitudes at pole
  });
});
