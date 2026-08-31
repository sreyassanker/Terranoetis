import { describe, expect, it } from 'vitest';
import { buildIceUrl, findNearestCell } from '../../data/seaice';

describe('buildIceUrl', () => {
  it('builds correct NH URL', () => {
    const url = buildIceUrl('north', 2024, 3, 15);
    expect(url).toContain('/NOAA/G10016_V4/north/daily/2024/');
    expect(url).toContain('sic_psn25_20240315_am2_icdr_v04r00.nc');
  });

  it('builds correct SH URL', () => {
    const url = buildIceUrl('south', 2024, 1, 1);
    expect(url).toContain('/NOAA/G10016_V4/south/daily/2024/');
    expect(url).toContain('sic_pss25_20240101_am2_icdr_v04r00.nc');
  });

  it('pads single-digit month and day', () => {
    const url = buildIceUrl('north', 2024, 1, 5);
    expect(url).toContain('20240105');
  });

  it('handles december dates', () => {
    const url = buildIceUrl('north', 2024, 12, 31);
    expect(url).toContain('20241231');
  });
});

describe('findNearestCell', () => {
  const ny = 3;
  const nx = 4;
  const mkLats = (vals: number[]) => new Float64Array(vals);

  it('finds exact match', () => {
    const lats = mkLats([10, 10, 10, 10, 20, 20, 20, 20, 30, 30, 30, 30]);
    const lons = mkLats([0, 10, 20, 30, 0, 10, 20, 30, 0, 10, 20, 30]);
    const result = findNearestCell(lats, lons, ny, nx, 20, 10);
    expect(result).toEqual([1, 1]);
  });

  it('finds closest cell when no exact match', () => {
    const lats = mkLats([10, 10, 10, 20, 20, 20, 30, 30, 30]);
    const lons = mkLats([0, 10, 20, 0, 10, 20, 0, 10, 20]);
    const ny2 = 3;
    const nx2 = 3;
    const result = findNearestCell(lats, lons, ny2, nx2, 21, 11);
    expect(result).toEqual([1, 1]);
  });

  it('returns null when all cells are beyond maxDistDeg', () => {
    const lats = mkLats([10, 10, 20, 20]);
    const lons = mkLats([0, 10, 0, 10]);
    const result = findNearestCell(lats, lons, 2, 2, 0, 0, 5);
    expect(result).toBeNull();
  });

  it('skips NaN values', () => {
    const lats = mkLats([NaN, 10, 10, 20]);
    const lons = mkLats([NaN, 0, 10, 0]);
    const ny2 = 2;
    const nx2 = 2;
    const result = findNearestCell(lats, lons, ny2, nx2, 20, 0);
    expect(result).toEqual([1, 1]);
  });

  it('handles wrap-around longitude', () => {
    const lats = mkLats([0, 0, 0, 0]);
    const lons = mkLats([-175, 175, 0, 10]);
    const result = findNearestCell(lats, lons, 1, 4, 0, 180);
    expect(result).toEqual([0, 1]);
  });
});

describe('SeaIce module exports', () => {
  it('exports buildIceUrl and findNearestCell', () => {
    expect(typeof buildIceUrl).toBe('function');
    expect(typeof findNearestCell).toBe('function');
  });
});
