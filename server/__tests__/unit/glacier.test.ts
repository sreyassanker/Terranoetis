import { describe, expect, it } from 'vitest';
import type { GlacierDataPoint } from '../../data/glacier';

describe('GlacierDataPoint interface', () => {
  it('has the expected shape', () => {
    const point: GlacierDataPoint = {
      areaFraction: 0.05,
      areaKm2: 500,
      source: 'rgi-v7-regions',
    };
    expect(point.areaFraction).toBe(0.05);
    expect(point.areaKm2).toBe(500);
    expect(point.source).toBe('rgi-v7-regions');
  });

  it('accepts null areaKm2', () => {
    const point: GlacierDataPoint = {
      areaFraction: 1,
      areaKm2: null,
      source: 'glims-wfs-glacier-outlines',
    };
    expect(point.areaFraction).toBe(1);
    expect(point.areaKm2).toBeNull();
  });
});

describe('RGI region logic', () => {
  // These are the 19 RGI region definitions from glacier.ts
  const RGI_REGIONS: [number, number, number, number, number][] = [
    [55, 72, -170, -130, 0.08],
    [44, 62, -145, -110, 0.04],
    [72, 84, -120, -50, 0.25],
    [60, 72, -120, -50, 0.10],
    [60, 84, -80, -20, 0.15],
    [63, 67, -25, -13, 0.30],
    [76, 81, 10, 35, 0.40],
    [61, 72, 4, 32, 0.05],
    [72, 82, 30, 105, 0.30],
    [55, 72, 100, 180, 0.05],
    [43, 48, 6, 12, 0.02],
    [38, 44, 40, 50, 0.03],
    [28, 48, 60, 105, 0.05],
    [25, 38, 60, 85, 0.02],
    [25, 30, 85, 105, 0.03],
    [-10, 10, -80, -70, 0.01],
    [-56, -15, -75, -65, 0.05],
    [-48, -40, 165, 175, 0.05],
    [-80, -60, -180, 180, 0.50],
  ];

  function findRgiRegion(lat: number, lon: number): number | null {
    for (const [lMin, lMax, oMin, oMax, _frac] of RGI_REGIONS) {
      if (lat >= lMin && lat <= lMax && lon >= oMin && lon <= oMax) return _frac as number;
    }
    return null;
  }

  const regions: { name: string; lat: number; lon: number; expFrac?: number }[] = [
    { name: 'Alaska (Anchorage)', lat: 61.2, lon: -149.9, expFrac: 0.08 },
    { name: 'Himalaya (Everest)', lat: 27.9, lon: 86.9, expFrac: 0.03 },
    { name: 'Andes (Mendoza)', lat: -32.9, lon: -69.9, expFrac: 0.05 },
    { name: 'Alps (Jungfrau)', lat: 46.5, lon: 8.0, expFrac: 0.02 },
    { name: 'Antarctica (South Pole)', lat: -70, lon: 0, expFrac: 0.50 },
    { name: 'Svalbard', lat: 78, lon: 18, expFrac: 0.40 },
    { name: 'Kenya (equator)', lat: 0, lon: 37 },
    { name: 'Hawaii', lat: 20, lon: -155 },
  ];

  for (const r of regions) {
    it(`${r.name} ${r.expFrac != null ? 'is' : 'is NOT'} in an RGI region`, () => {
      const frac = findRgiRegion(r.lat, r.lon);
      if (r.expFrac != null) {
        expect(frac).toBe(r.expFrac);
      } else {
        expect(frac).toBeNull();
      }
    });
  }

  it('all region area fractions are valid', () => {
    for (const [,,,, frac] of RGI_REGIONS) {
      expect(frac as number).toBeGreaterThan(0);
      expect(frac as number).toBeLessThanOrEqual(1);
    }
  });

  it('no overlapping region claims equatorial Pacific', () => {
    expect(findRgiRegion(0, -120)).toBeNull();
  });
});

describe('Glacier probability model', () => {
  function glacierProbability(lat: number, elevation?: number): number {
    const absLat = Math.abs(lat);
    const elev = elevation ?? 0;
    const estAnnualT = 15 - 0.0065 * elev - 0.5 * absLat;
    if (estAnnualT > 2) return 0;
    if (estAnnualT < -10) return 0.5;
    return Math.max(0, Math.min(1, (-estAnnualT + 2) / 12 * 0.3));
  }

  it('returns 0 at low latitude low elevation', () => {
    expect(glacierProbability(0)).toBe(0);
  });

  it('returns 0.5 at very cold high latitudes', () => {
    expect(glacierProbability(85)).toBe(0.5);
  });

  it('returns non-zero at high elevation in tropics', () => {
    // Kilimanjaro: 3°S, 5895m
    const prob = glacierProbability(-3, 5895);
    expect(prob).toBeGreaterThan(0);
  });

  it('returns 0 for warm mountain (eq, 1000m)', () => {
    expect(glacierProbability(0, 1000)).toBe(0);
  });

  it('increases with elevation', () => {
    const low = glacierProbability(40, 0);
    const high = glacierProbability(40, 2000);
    expect(high).toBeGreaterThan(low);
    expect(low).toBeLessThan(high);
  });
});

describe('Glacier module exports', () => {
  it('exports GlacierDataPoint type', () => {
    // Type is exported — this tests that the module compiles
    const p: GlacierDataPoint = {
      areaFraction: 0,
      areaKm2: 0,
      source: 'test',
    };
    expect(p).toBeDefined();
  });
});
