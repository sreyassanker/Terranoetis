/**
 * bathymetry.ts — GEBCO 2020 seafloor sampler for tsunami physics.
 *
 * The tsunami kernel used to fabricate its entire ocean floor (a smooth
 * parabolic bowl). This module samples the real GEBCO 2020 global relief grid
 * (~15 arc-sec ≈ 450 m, positive-up elevation) for the study box and ships a
 * positive-down depth grid to the kernel, which uses it instead of the bowl.
 *
 * Data source:
 *   https://api.opentopodata.org/v1/gebco2020
 *   Keyless, batched (≤100 locations/request), same API family the server
 *   already uses for SRTM30m (server/data/dataFetchers.ts). GEBCO's official
 *   point API (api.gebco.net) is retired (dead DNS) and its WMS only renders
 *   maps, so OpenTopoData's GEBCO 2020 grid is the scriptable path.
 *
 * Grid geometry mirrors the client's Cesium terrain sampler exactly — the same
 * cell-centre math as the land-cover module (studyCellCenterLatLon), so a
 * real-bathymetry run pairs with a real-terrain/coastline run on one aligned
 * grid. Cells are sampled at a capped sub-grid (tsunami cells are ~5 km, far
 * coarser than the 450 m source) and the kernel bilinearly upsamples.
 */

import { studyCellCenterLatLon } from './landCover';
import { logger } from '../observability/logger';

// ── OpenTopoData GEBCO 2020 point API ────────────────────────────────────────

const OPENTOPODATA_GEBCO_URL = 'https://api.opentopodata.org/v1/gebco2020';
/** OpenTopoData hard cap on locations per request. */
const MAX_LOCATIONS_PER_REQUEST = 100;
/** Total points requested in flight (concurrency * batch). */
const MAX_CONCURRENT_BATCHES = 6;
/** How many cells per side we actually query (kernel upsamples to full gs). */
const DEFAULT_SAMPLE_GS = 64;

export interface BathymetryGridOpts {
  lat: number;
  lon: number;
  extentKm: number;
  /** Number of cells per side (default 256; capped at 256 to bound fetch time). */
  gs?: number;
  /** Cells per side to actually sample (capped to keep request count sane). */
  sampleGs?: number;
  /**
   * Test seam: override the GEBCO point fetch. Receives an array of
   * {lat, lon} and must return elevations in meters, positive-up (the raw
   * OpenTopoData `elevation` field). Defaults to the live GEBCO 2020 fetch.
   */
  fetchElevations?: (locs: Array<{ lat: number; lon: number }>) => Promise<number[]>;
}

export interface BathymetryGrid {
  gs: number;
  /** Sampled cell count per side actually fetched (≤ gs). */
  sampleGs: number;
  /** Positive-down depth, row-major, row 0 = north, meters. NaN = unsampled. */
  depth: Float32Array;
  extentKm: number;
  source: 'gebco-2020-opentopodata';
  /** Fraction of the sampled grid that returned a finite depth. */
  coveragePct: number;
}

interface OpenTopoDataResult {
  elevation: number;
  dataset: string;
}

/**
 * Fetch GEBCO 2020 elevations (meters, positive-up; negative = seafloor depth)
 * for up to MAX_LOCATIONS_PER_REQUEST points in one batched HTTP call.
 */
export async function fetchGebco2020Elevations(
  locs: Array<{ lat: number; lon: number }>,
): Promise<number[]> {
  const query = locs
    .map((l) => `${l.lat.toFixed(5)},${l.lon.toFixed(5)}`)
    .join('|');
  const url = `${OPENTOPODATA_GEBCO_URL}?locations=${query}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`OpenTopoData GEBCO ${resp.status} for ${url.slice(0, 120)}`);
  const data = (await resp.json()) as { results?: OpenTopoDataResult[]; error?: string };
  if (data.error) throw new Error(`OpenTopoData GEBCO error: ${data.error}`);
  const results = data.results ?? [];
  if (results.length !== locs.length) {
    throw new Error(
      `OpenTopoData GEBCO returned ${results.length}/${locs.length} elevations`,
    );
  }
  return results.map((r) => r.elevation);
}

/** Run an async mapper over an array with bounded concurrency. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Sample real GEBCO 2020 seafloor depth for the study box.
 *
 * Returns null when nothing usable could be fetched (the kernel then falls
 * back to its synthetic bowl — the tsunami still runs, just coarser physics).
 */
export async function sampleBathymetryGrid(
  opts: BathymetryGridOpts,
): Promise<BathymetryGrid | null> {
  const gs = Math.max(2, Math.min(256, Math.round(opts.gs ?? 256)));
  const sampleGs = Math.max(2, Math.min(gs, Math.round(opts.sampleGs ?? DEFAULT_SAMPLE_GS)));
  const N = sampleGs * sampleGs;

  // Cell centres for the *sampled* sub-grid (same geometry math as land cover).
  const locs = new Array<{ lat: number; lon: number }>(N);
  for (let r = 0; r < sampleGs; r++) {
    for (let c = 0; c < sampleGs; c++) {
      const i = r * sampleGs + c;
      locs[i] = studyCellCenterLatLon(
        { lat: opts.lat, lon: opts.lon, extentKm: opts.extentKm, gs: sampleGs },
        r,
        c,
      );
    }
  }

  // Group into ≤100-location batches and fetch with bounded concurrency.
  const batches: Array<{ lat: number; lon: number }[]> = [];
  for (let i = 0; i < N; i += MAX_LOCATIONS_PER_REQUEST) {
    batches.push(locs.slice(i, i + MAX_LOCATIONS_PER_REQUEST));
  }

  const depth = new Float32Array(N).fill(NaN);
  let sampled = 0;
  const results = await mapWithConcurrency(batches, MAX_CONCURRENT_BATCHES, async (batch) => {
    const fetchFn = opts.fetchElevations ?? fetchGebco2020Elevations;
    return fetchFn(batch);
  });

  for (let b = 0; b < batches.length; b++) {
    const elevations = results[b];
    if (!elevations) continue;
    const offset = b * MAX_LOCATIONS_PER_REQUEST;
    for (let k = 0; k < elevations.length; k++) {
      const v = elevations[k];
      if (Number.isFinite(v)) {
        // GEBCO elevation is positive-up; the kernel wants positive-down depth.
        depth[offset + k] = -v;
        sampled++;
      }
    }
  }

  if (sampled === 0) return null;

  logger.info(
    { grid: `${sampleGs}x${sampleGs}`, extentKm: opts.extentKm,
      coveragePct: Number(((sampled / N) * 100).toFixed(1)) },
    '[bathymetry] GEBCO 2020 grid sampled',
  );

  return {
    gs,
    sampleGs,
    depth,
    extentKm: opts.extentKm,
    source: 'gebco-2020-opentopodata',
    coveragePct: (sampled / N) * 100,
  };
}

// ── Wire compaction (mirrors compactTerrain in simRunner) ────────────────────

/**
 * Compact a positive-down depth grid (meters) into the base64 payload shipped
 * inside the embedded kernel. Depths span roughly −(elevation) from ~−8000 m
 * (deep trenches) up to positive land elevations; a uint16 min/span-normalized
 * encoding gives sub-metre precision over the usual range. The kernel derives
 * the sampled grid size from the byte count and bilinearly upsamples to gs.
 * Returns null when nothing usable to ship.
 */
export function compactBathymetry(
  depth: ArrayLike<number>,
): { bathy_b64: string; bathy_gs: number; bathy_min: number; bathy_span: number } | null {
  if (!depth || depth.length === 0) return null;
  const n = Math.round(Math.sqrt(depth.length));
  if (n * n !== depth.length) return null;

  let min = Infinity;
  let max = -Infinity;
  let finite = 0;
  for (let i = 0; i < depth.length; i++) {
    const v = depth[i];
    if (Number.isFinite(v)) {
      finite++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (finite === 0) return null;

  const span = max - min || 1;
  const buf = Buffer.alloc(depth.length * 2);
  for (let i = 0; i < depth.length; i++) {
    const v = depth[i];
    // Clamp unsampled (NaN) cells to the minimum valid depth rather than 0
    // (0 would read as dry land / coastline on the kernel side).
    const q = Number.isFinite(v)
      ? Math.round(((v - min) / span) * 65534)
      : 0;
    buf.writeUInt16LE(q, i * 2);
  }

  return { bathy_b64: buf.toString('base64'), bathy_gs: n, bathy_min: min, bathy_span: span };
}
