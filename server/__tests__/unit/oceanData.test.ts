import { describe, expect, it } from 'vitest';
import {
  getOceanProfile,
  computeN2,
  computeWindStress,
  computeWindStressCurl,
  getOceanSurface,
} from '../../data/oceanData';

describe('getOceanProfile', () => {
  it('returns realistic tropical profile at surface', () => {
    const p = getOceanProfile(0, 0, 0);
    expect(p.temperature).toBeCloseTo(27.5, 0);
    expect(p.salinity).toBeCloseTo(35.0, 0);
    expect(p.sst).toBeCloseTo(27.5, 0);
  });

  it('returns colder temperature at 500m depth', () => {
    const p = getOceanProfile(0, 0, 500);
    expect(p.temperature).toBeLessThan(15);
    expect(p.temperature).toBeGreaterThan(2);
  });

  it('adjusts profile when SST is observed', () => {
    const p = getOceanProfile(35, 0, 0, 25);
    expect(p.sst).toBe(25);
    expect(p.temperature).toBeCloseTo(25, 0);
  });

  it('returns different profiles by latitude band', () => {
    const tropical = getOceanProfile(0, 0, 0);
    const polar = getOceanProfile(80, 0, 0);
    expect(tropical.temperature).toBeGreaterThan(polar.temperature + 10);
  });

  it('returns valid density in oceanographic range', () => {
    const p = getOceanProfile(30, 0, 100);
    expect(p.density).toBeGreaterThan(1020);
    expect(p.density).toBeLessThan(1030);
  });

  it('interpolates at intermediate depth', () => {
    // At 37.5m between 30m and 50m points
    const p = getOceanProfile(10, 0, 37.5);
    expect(p.temperature).toBeGreaterThan(20);
    expect(p.temperature).toBeLessThan(28);
  });

  it('handles depth below 2000m', () => {
    const p = getOceanProfile(0, 0, 3000);
    expect(Number.isFinite(p.temperature)).toBe(true);
    expect(Number.isFinite(p.salinity)).toBe(true);
  });
});

describe('computeN2', () => {
  it('returns positive Brunt-Vaisala frequency', () => {
    const n2 = computeN2(30);
    expect(n2).toBeGreaterThan(0);
    expect(n2).toBeLessThan(1);
  });

  it('returns higher or equal stratification in tropics vs polar', () => {
    const tropN2 = computeN2(0);
    const polarN2 = computeN2(80);
    expect(tropN2).toBeGreaterThanOrEqual(polarN2);
  });
});

describe('computeWindStress', () => {
  it('increases with wind speed', () => {
    const low = computeWindStress(5);
    const high = computeWindStress(15);
    expect(high).toBeGreaterThan(low * 2);
  });

  it('returns physically reasonable values (Pa)', () => {
    const tau = computeWindStress(10);
    expect(tau).toBeGreaterThan(0.01);
    expect(tau).toBeLessThan(1);
  });

  it('handles calm winds', () => {
    expect(computeWindStress(0)).toBe(0);
  });
});

describe('computeWindStressCurl', () => {
  it('returns small positive value for typical gradients', () => {
    const curl = computeWindStressCurl(5, 3);
    expect(curl).toBeGreaterThan(0);
  });
});

describe('getOceanSurface', () => {
  it('returns sst, wind stress, and curl', () => {
    const s = getOceanSurface(10, 5, 3, 22);
    expect(s.sst).toBe(22);
    expect(s.windStress).toBeGreaterThan(0.05);
    expect(s.windStressCurl).toBeGreaterThan(0);
  });

  it('defaults SST when not provided', () => {
    const s = getOceanSurface(5, 2, 1);
    expect(s.sst).toBe(15);
  });
});
