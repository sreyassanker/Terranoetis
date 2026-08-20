/**
 * bathymetry.test.ts — unit tests for the GEBCO 2020 bathymetry sampler.
 *
 * All fetch paths are exercised offline via the injected `fetchElevations`
 * seam, so the suite never touches the network. Real values (Mariana −10654 m,
 * Tokyo Bay −26 m, LA coast +1000 m land) were verified live against
 * api.opentopodata.org/v1/gebco2020 while building the module.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  sampleBathymetryGrid,
  compactBathymetry,
  fetchGebco2020Elevations,
} from '../../kaggle/bathymetry';

/** Fake positive-up elevations (m) for any requested location. */
function fakeFetch(elevations: number[]) {
  return vi.fn(async (_locs: Array<{ lat: number; lon: number }>) => elevations);
}

describe('compactBathymetry', () => {
  it('round-trips a uniform-depth grid losslessly-ish', () => {
    const depth = new Float32Array(4 * 4).fill(-3500);
    const compact = compactBathymetry(depth)!;
    expect(compact).not.toBeNull();
    expect(compact.bathy_gs).toBe(4);
    // Decode back the way the kernel does.
    const buf = Buffer.from(compact.bathy_b64, 'base64');
    const u16 = new Uint16Array(buf.buffer, buf.byteOffset, 16);
    const decoded = Array.from(u16, (q) => compact.bathy_min + (q / 65534) * compact.bathy_span);
    expect(Math.round(decoded[0])).toBe(-3500);
    expect(Math.round(decoded[15])).toBe(-3500);
  });

  it('preserves min/span so the kernel can reconstruct depth', () => {
    const depth = Float32Array.from([-6000, -3000, 0, 500]);
    const compact = compactBathymetry(depth)!;
    expect(compact.bathy_gs).toBe(2);
    expect(compact.bathy_min).toBe(-6000);
    expect(compact.bathy_span).toBe(6500);
    const buf = Buffer.from(compact.bathy_b64, 'base64');
    const u16 = new Uint16Array(buf.buffer, buf.byteOffset, 4);
    // min → q=0 → -6000; max → q=65534 → 500
    expect(u16[0]).toBe(0);
    expect(u16[3]).toBe(65534);
  });

  it('returns null on empty input', () => {
    expect(compactBathymetry([])).toBeNull();
  });

  it('returns null on non-square grid', () => {
    expect(compactBathymetry(new Float32Array(5))).toBeNull();
  });

  it('clamps NaN cells to the min depth (deepest), not 0/coastline', () => {
    const depth = Float32Array.from([-4000, NaN, -2000, -1000]);
    const compact = compactBathymetry(depth)!;
    const buf = Buffer.from(compact.bathy_b64, 'base64');
    const u16 = new Uint16Array(buf.buffer, buf.byteOffset, 4);
    // NaN cell is encoded as q=0 → bathy_min (−4000), so the kernel reads it
    // as deep water rather than dry land.
    expect(u16[1]).toBe(0);
  });
});

describe('sampleBathymetryGrid', () => {
  it('converts positive-up GEBCO elevation to positive-down depth', async () => {
    // Simulate a tile of ocean: elevation −4000 → depth +4000.
    const grid = await sampleBathymetryGrid({
      lat: 35,
      lon: 140,
      extentKm: 300,
      gs: 8,
      sampleGs: 4,
      fetchElevations: fakeFetch(new Array(16).fill(-4000)),
    });
    expect(grid).not.toBeNull();
    expect(grid!.sampleGs).toBe(4);
    expect(grid!.coveragePct).toBe(100);
    // Depth is negative elevation (positive-down).
    expect(grid!.depth[0]).toBe(4000);
    expect(grid!.depth[15]).toBe(4000);
  });

  it('carries land as negative depth (elevation above sea level)', async () => {
    const grid = await sampleBathymetryGrid({
      lat: -10,
      lon: -75,
      extentKm: 200,
      gs: 4,
      sampleGs: 4,
      fetchElevations: fakeFetch(new Array(16).fill(260)), // Andes foothills
    });
    expect(grid!.depth[0]).toBe(-260);
  });

  it('splits a large grid into ≤100-location batches', async () => {
    const fetchSpy = fakeFetch(new Array(16 * 16).fill(-1000));
    await sampleBathymetryGrid({
      lat: 35,
      lon: 140,
      extentKm: 300,
      gs: 16,
      sampleGs: 16, // 256 points → 3 batches
      fetchElevations: fetchSpy,
    });
    const calls = fetchSpy.mock.calls;
    expect(calls.length).toBe(3);
    expect(calls[0][0].length).toBe(100);
    expect(calls[1][0].length).toBe(100);
    expect(calls[2][0].length).toBe(56);
  });

  it('returns null when every point fails (no finite depths)', async () => {
    const grid = await sampleBathymetryGrid({
      lat: 0,
      lon: 0,
      extentKm: 100,
      gs: 4,
      sampleGs: 4,
      fetchElevations: fakeFetch(new Array(16).fill(NaN)),
    });
    expect(grid).toBeNull();
  });

  it('caps sampleGs at gs', async () => {
    const grid = await sampleBathymetryGrid({
      lat: 35,
      lon: 140,
      extentKm: 300,
      gs: 4,
      sampleGs: 64, // wants 64 but gs=4
      fetchElevations: fakeFetch(new Array(4 * 4).fill(-1000)),
    });
    expect(grid!.sampleGs).toBe(4);
    expect(grid!.gs).toBe(4);
  });

  it('respects a partial failure (some NaN) with partial coverage', async () => {
    const elevs = new Array(16).fill(-2000);
    elevs[0] = NaN;
    elevs[3] = NaN;
    const grid = await sampleBathymetryGrid({
      lat: 35,
      lon: 140,
      extentKm: 200,
      gs: 4,
      sampleGs: 4,
      fetchElevations: fakeFetch(elevs),
    });
    expect(grid!.coveragePct).toBeCloseTo(87.5, 1);
    expect(Number.isNaN(grid!.depth[0])).toBe(true);
    expect(grid!.depth[1]).toBe(2000);
  });
});

describe('fetchGebco2020Elevations', () => {
  it('builds the OpenTopoData URL with lat,lon pairs', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'OK',
        results: [
          { dataset: 'gebco2020', elevation: -26, location: { lat: 35, lng: 140 } },
          { dataset: 'gebco2020', elevation: -10654, location: { lat: 11.35, lng: 142.2 } },
        ],
      }),
    } as Response);
    try {
      const out = await fetchGebco2020Elevations([
        { lat: 35, lon: 140 },
        { lat: 11.35, lon: 142.2 },
      ]);
      expect(out).toEqual([-26, -10654]);
      const url = spy.mock.calls[0][0] as string;
      expect(url).toContain('gebco2020');
      expect(url).toContain('35.00000,140.00000|11.35000,142.20000');
    } finally {
      spy.mockRestore();
    }
  });

  it('throws when the response is short', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'OK', results: [{ dataset: 'gebco2020', elevation: 0 }] }),
    } as Response);
    await expect(
      fetchGebco2020Elevations([{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }]),
    ).rejects.toThrow(/returned 1\/2 elevations/);
    vi.restoreAllMocks();
  });
});
