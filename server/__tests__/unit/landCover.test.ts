import { describe, expect, it } from 'vitest';
import type { GeoTIFFImage } from 'geotiff';
import {
  compactLandCover,
  DEFAULT_MANNING_N,
  manningsNForClass,
  sampleLandCoverGrid,
  studyCellCenterLatLon,
  WORLDCOVER_CLASSES,
  WORLDCOVER_MANNING_N,
  worldCoverTileKey,
  worldCoverTileUrl,
} from '../../kaggle/landCover';

describe('worldCoverTileKey', () => {
  it('builds the canonical tile name for a positive lat/lon', () => {
    expect(worldCoverTileKey(27.4, 84.2)).toBe('ESA_WorldCover_10m_2021_v200_N27E084_Map.tif');
  });

  it('handles negative hemispheres and zero-padding', () => {
    expect(worldCoverTileKey(-12.5, -45)).toBe('ESA_WorldCover_10m_2021_v200_S15W045_Map.tif');
    expect(worldCoverTileKey(0, 0)).toBe('ESA_WorldCover_10m_2021_v200_N00E000_Map.tif');
  });

  it('clamps to valid tile range at the poles and date line', () => {
    expect(worldCoverTileKey(89, 179.9)).toBe('ESA_WorldCover_10m_2021_v200_N87E177_Map.tif');
    expect(worldCoverTileKey(-89, -179.9)).toBe('ESA_WorldCover_10m_2021_v200_S90W180_Map.tif');
  });

  it('worldCoverTileUrl points at the S3 bucket', () => {
    expect(worldCoverTileUrl(27, 84)).toContain('https://esa-worldcover.s3.eu-central-1.amazonaws.com');
  });
});

describe('manningsNForClass', () => {
  it('maps every WorldCover class to a positive Manning n', () => {
    for (const code of Object.keys(WORLDCOVER_MANNING_N).map(Number)) {
      const n = manningsNForClass(code);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(1);
    }
  });

  it('dense forest (10) is rougher than paved built-up (50)', () => {
    expect(manningsNForClass(10)).toBeGreaterThan(manningsNForClass(50));
  });

  it('falls back to DEFAULT_MANNING_N for unknown / nodata classes', () => {
    expect(manningsNForClass(0)).toBe(DEFAULT_MANNING_N);
    expect(manningsNForClass(999)).toBe(DEFAULT_MANNING_N);
    expect(manningsNForClass(-1)).toBe(DEFAULT_MANNING_N);
  });

  it('every class code in the n table also has a display name', () => {
    for (const code of Object.keys(WORLDCOVER_MANNING_N).map(Number)) {
      expect(WORLDCOVER_CLASSES[code]).toBeTruthy();
    }
  });
});

describe('studyCellCenterLatLon — parity with client cellToLatLon', () => {
  // Mirrors src/components/kaggle/gpu/fieldData.ts cellToLatLon exactly.
  const clientCellToLatLon = (
    centerLat: number, centerLon: number, gs: number, cellSizeM: number,
    col: number, row: number,
  ) => {
    const e = (col - gs / 2 + 0.5) * cellSizeM;
    const n = (gs / 2 - row - 0.5) * cellSizeM;
    const degN = n / 111132.0;
    const degE = e / (111320.0 * Math.max(0.01, Math.cos((centerLat * Math.PI) / 180)));
    return { lat: centerLat + degN, lon: centerLon + degE };
  };

  it('produces identical cell centres to the client terrain sampler', () => {
    const opts = { lat: 28.1, lon: 84.7, extentKm: 8, gs: 64 };
    const cellSizeM = (opts.extentKm * 1000) / opts.gs;
    for (const [row, col] of [[0, 0], [0, 63], [63, 0], [31, 32], [63, 63]] as const) {
      const a = studyCellCenterLatLon(opts, row, col);
      const b = clientCellToLatLon(opts.lat, opts.lon, opts.gs, cellSizeM, col, row);
      expect(a.lat).toBeCloseTo(b.lat, 10);
      expect(a.lon).toBeCloseTo(b.lon, 10);
    }
  });

  it('north edge is at a higher latitude than the south edge', () => {
    const opts = { lat: 0, lon: 0, extentKm: 10, gs: 8 };
    const north = studyCellCenterLatLon(opts, 0, 0);
    const south = studyCellCenterLatLon(opts, 7, 0);
    expect(north.lat).toBeGreaterThan(south.lat);
  });
});

describe('compactLandCover', () => {
  it('round-trips a class grid through base64 losslessly', () => {
    const gs = 64;
    const classes = new Uint8Array(gs * gs);
    for (let i = 0; i < classes.length; i++) classes[i] = i % 101 === 0 ? 95 : (i % 11) * 10;
    const compact = compactLandCover(classes);
    expect(compact).not.toBeNull();
    expect(compact!.landcover_gs).toBe(gs);
    const decoded = new Uint8Array(Buffer.from(compact!.landcover_b64, 'base64'));
    expect(decoded.length).toBe(classes.length);
    expect(Array.from(decoded)).toEqual(Array.from(classes));
  });

  it('returns null for an empty or non-square grid', () => {
    expect(compactLandCover([])).toBeNull();
    expect(compactLandCover([1, 2, 3, 4, 5])).toBeNull();
  });

  it('returns null when every cell is nodata/zero', () => {
    expect(compactLandCover(new Array(64 * 64).fill(0))).toBeNull();
  });
});

describe('sampleLandCoverGrid — injected fake tile, no network', () => {
  /** Minimal GeoTIFFImage stand-in backed by a 2D class array. */
  function fakeTileImage(
    width: number,
    height: number,
    originWest: number,
    originNorth: number,
    res: number,
    classes2d: number[][],
  ) {
    return {
      getBoundingBox: () => [originWest, originNorth - res * height, originWest + res * width, originNorth],
      getResolution: () => [res, -res, 0],
      getWidth: () => width,
      getHeight: () => height,
      readRasters: async ({ window }: { window: number[] }) => {
        const [x0, y0, x1, y1] = window;
        const out: number[] = [];
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            out.push(classes2d[y]?.[x] ?? 0);
          }
        }
        return out;
      },
    } as unknown as GeoTIFFImage;
  }

  it('samples the WorldCover class at each cell centre', async () => {
    const res = 0.0001; // ≈11 m pixels
    const originWest = 1.4;
    const originNorth = 1.6;
    const w = 2000;
    const classes2d: number[][] = Array.from({ length: w }, () => Array(w).fill(40));
    // Marker class (built-up, 50) at the pixel nearest the study-box centre cell.
    classes2d[1003][1003] = 50;

    const opts = { lat: 1.5, lon: 1.5, extentKm: 1, gs: 16 };
    const result = await sampleLandCoverGrid({
      ...opts,
      fetchTile: () => Promise.resolve(fakeTileImage(w, w, originWest, originNorth, res, classes2d)),
    });

    expect(result).not.toBeNull();
    expect(result!.gs).toBe(16);
    // Centre cell (row 8, col 8) sits on the marker pixel.
    expect(result!.classes[8 * 16 + 8]).toBe(50);
    // Every other cell still falls inside the tile and returns cropland (40).
    const valid = Array.from(result!.classes).filter(c => c > 0);
    expect(valid).toHaveLength(16 * 16);
    expect(valid.every(c => c === 40 || c === 50)).toBe(true);
    expect(result!.coveragePct).toBe(100);
    expect(result!.histogram['Built-up']).toBeGreaterThan(0);
  });

  it('returns null when every tile fetch fails (graceful degradation)', async () => {
    const opts = { lat: 1.5, lon: 1.5, extentKm: 1, gs: 8 };
    const result = await sampleLandCoverGrid({
      ...opts,
      fetchTile: () => Promise.resolve(null),
    });
    expect(result).toBeNull();
  });
});
