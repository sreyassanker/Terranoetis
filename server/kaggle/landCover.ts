/**
 * landCover.ts — ESA WorldCover 10m land-cover sampler for flood physics.
 *
 * Flood routing speed depends on surface roughness (Manning's n). Instead of
 * hardcoding a single mixed-land-cover constant in the kernel, we sample the
 * real land cover for the study box from ESA WorldCover v200 (2021, 10 m,
 * Sentinel-1/2, 11 classes) and ship a per-cell class grid to the kernel,
 * which maps classes → Manning's n.
 *
 * Data source:
 *   https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/...
 *   3°×3° GeoTIFF tiles, EPSG:4326, COG with overviews. Range-requested via
 *   `geotiff` (already a server dependency), so a study box typically reads a
 *   few hundred KB, not the full ~13 MB tile.
 *
 * Grid geometry mirrors the client's Cesium terrain sampler exactly:
 *   row-major, row 0 = north edge, cell centres from `cellToLatLon`
 *   (src/components/kaggle/gpu/fieldData.ts). Keeping the two grids aligned
 *   is what lets the kernel pair real terrain with real roughness.
 */

import { fromUrl } from 'geotiff';
import type { GeoTIFFImage } from 'geotiff';
import { logger } from '../observability/logger';

// ── WorldCover v200 class codes (Product User Manual v200) ──────────────────

export const WORLDCOVER_CLASSES: Record<number, string> = {
  10: 'Tree cover',
  20: 'Shrubland',
  30: 'Grassland',
  40: 'Cropland',
  50: 'Built-up',
  60: 'Bare / sparse vegetation',
  70: 'Snow and ice',
  80: 'Permanent water',
  90: 'Herbaceous wetland',
  95: 'Mangroves',
  100: 'Moss and lichen',
};

/**
 * Manning's n per WorldCover class. Sources: Chow (1959) Open-Channel
 * Hydraulics table 5-6 plus modern flood-model lookup conventions
 * (LISFLOOD-FP / HEC-RAS land-cover n tables). These are cell-scale
 * roughness coefficients used by the kernel's semi-implicit friction term.
 */
export const WORLDCOVER_MANNING_N: Record<number, number> = {
  10: 0.100,  // dense forest floor
  20: 0.070,  // light brush / scrub
  30: 0.035,  // short grass pasture
  40: 0.040,  // cultivated row crops
  50: 0.015,  // paved / built-up
  60: 0.025,  // bare earth, sparse vegetation
  70: 0.025,  // snow / ice
  80: 0.030,  // open water surface
  90: 0.060,  // dense herbaceous marsh
  95: 0.150,  // mangrove swamp
  100: 0.050, // moss / lichen ground cover
};

/** Fallback used for nodata (0) or any unlisted class. */
export const DEFAULT_MANNING_N = 0.035;

/** Roughness coefficient for a WorldCover class code (unknown → fallback). */
export function manningsNForClass(code: number): number {
  return WORLDCOVER_MANNING_N[code] ?? DEFAULT_MANNING_N;
}

// ── Tile addressing ──────────────────────────────────────────────────────────

const TILE_BASE_URL =
  'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map';

/**
 * ESA WorldCover v200 tile name for a 3°×3° tile covering the given lat/lon.
 * E.g. (27.4, 84.2) → N27E084. Tiles span N00..N87 and S03..S90, W180..E177.
 */
export function worldCoverTileKey(lat: number, lon: number): string {
  const tileLat = Math.max(-90, Math.min(87, Math.floor(lat / 3) * 3));
  const tileLon = Math.max(-180, Math.min(177, Math.floor(lon / 3) * 3));
  const ns = tileLat >= 0 ? 'N' : 'S';
  const ew = tileLon >= 0 ? 'E' : 'W';
  return `ESA_WorldCover_10m_2021_v200_${ns}${String(Math.abs(tileLat)).padStart(2, '0')}${ew}${String(Math.abs(tileLon)).padStart(3, '0')}_Map.tif`;
}

export function worldCoverTileUrl(lat: number, lon: number): string {
  return `${TILE_BASE_URL}/${worldCoverTileKey(lat, lon)}`;
}

/** Full S3 URL for an already-built tile key (see `worldCoverTileKey`). */
export function worldCoverTileUrlFromKey(key: string): string {
  return `${TILE_BASE_URL}/${key}`;
}

// ── Study-box grid geometry (must match client cellToLatLon) ────────────────

export interface LandCoverGridOpts {
  lat: number;
  lon: number;
  extentKm: number;
  /** Number of cells per side (default 256; capped at 256 to bound fetch time). */
  gs?: number;
  /** Test seam: override the tile fetch (defaults to the live ESA WorldCover COG read). */
  fetchTile?: (key: string) => Promise<GeoTIFFImage | null>;
}

/** Approximate lat/lon of a cell centre — mirrors client `cellToLatLon`. */
export function studyCellCenterLatLon(
  opts: LandCoverGridOpts,
  row: number,
  col: number,
): { lat: number; lon: number } {
  const gs = Math.max(2, Math.min(256, Math.round(opts.gs ?? 256)));
  const cellSizeM = (opts.extentKm * 1000) / gs;
  const e = (col - gs / 2 + 0.5) * cellSizeM;
  const n = (gs / 2 - row - 0.5) * cellSizeM;
  const degN = n / 111132.0;
  const degE = e / (111320.0 * Math.max(0.01, Math.cos((opts.lat * Math.PI) / 180)));
  return { lat: opts.lat + degN, lon: opts.lon + degE };
}

// ── Tile image cache (metadata + COG handles are cheap; readRasters range-requests) ──

const TILE_CACHE_TTL_MS = 30 * 60_000;
const TILE_CACHE_MAX = 32;
const tileCache = new Map<string, { expires: number; image: GeoTIFFImage | null }>();

async function getTileImage(key: string): Promise<GeoTIFFImage | null> {
  const now = Date.now();
  const hit = tileCache.get(key);
  if (hit && hit.expires > now) return hit.image;
  try {
    const tiff = await fromUrl(worldCoverTileUrlFromKey(key), {});
    const image = await tiff.getImage();
    if (tileCache.size >= TILE_CACHE_MAX) {
      const oldest = tileCache.keys().next().value;
      if (oldest) tileCache.delete(oldest);
    }
    tileCache.set(key, { expires: now + TILE_CACHE_TTL_MS, image });
    return image;
  } catch (err) {
    // Negative cache briefly so a bad tile isn't hammered on every request.
    tileCache.set(key, { expires: now + 60_000, image: null });
    logger.warn(
      { tile: key, error: err instanceof Error ? err.message : String(err) },
      'ESA WorldCover tile fetch failed',
    );
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface LandCoverGrid {
  gs: number;
  /** WorldCover class codes, row-major, row 0 = north. 0 = nodata. */
  classes: Uint8Array;
  extentKm: number;
  source: 'esa-worldcover-v200-2021';
  /** Fraction of the grid covered by each class name (for logs/UI). */
  histogram: Record<string, number>;
  /** Fraction of cells with a valid (non-nodata) class. */
  coveragePct: number;
}

/**
 * Sample ESA WorldCover land-cover classes for the study box.
 * Returns null when nothing usable could be fetched (kernel then falls back
 * to its constant Manning's n — the flood still runs, just coarser physics).
 */
export async function sampleLandCoverGrid(
  opts: LandCoverGridOpts,
): Promise<LandCoverGrid | null> {
  const gs = Math.max(2, Math.min(256, Math.round(opts.gs ?? 256)));
  const N = gs * gs;
  const classes = new Uint8Array(N);
  const latArr = new Float64Array(N);
  const lonArr = new Float64Array(N);

  // Precompute cell centres once, group cells by tile.
  const byTile = new Map<string, number[]>();
  for (let r = 0; r < gs; r++) {
    for (let c = 0; c < gs; c++) {
      const i = r * gs + c;
      const { lat, lon } = studyCellCenterLatLon(opts, r, c);
      latArr[i] = lat;
      lonArr[i] = lon;
      const key = worldCoverTileKey(lat, lon);
      const list = byTile.get(key);
      if (list) list.push(i);
      else byTile.set(key, [i]);
    }
  }

  let sampled = 0;
  for (const [key, cells] of byTile) {
    const image = opts.fetchTile ? await opts.fetchTile(key) : await getTileImage(key);
    if (!image) continue;
    try {
      const bbox = image.getBoundingBox(); // [west, south, east, north]
      const [west, , , north] = bbox;
      const res = image.getResolution();
      const resX = Math.abs(res[0]);
      const resY = Math.abs(res[1]);
      const w = image.getWidth();
      const h = image.getHeight();

      // Nearest-neighbour pixel window covering all of this tile's cells.
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const px = new Int32Array(cells.length);
      const py = new Int32Array(cells.length);
      for (let i = 0; i < cells.length; i++) {
        const idx = cells[i];
        const x = Math.max(0, Math.min(w - 1, Math.round((lonArr[idx] - west) / resX)));
        const y = Math.max(0, Math.min(h - 1, Math.round((north - latArr[idx]) / resY)));
        px[i] = x;
        py[i] = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      const data = await image.readRasters({
        window: [minX, minY, maxX + 1, maxY + 1],
        interleave: true,
      });
      const winW = maxX - minX + 1;
      for (let i = 0; i < cells.length; i++) {
        const idx = cells[i];
        const v = data[(py[i] - minY) * winW + (px[i] - minX)];
        classes[idx] = Number.isFinite(v) && v >= 0 && v <= 255 ? v : 0;
        sampled++;
      }
    } catch (err) {
      logger.warn(
        { tile: key, error: err instanceof Error ? err.message : String(err) },
        'ESA WorldCover window read failed',
      );
    }
  }

  if (sampled === 0) return null;

  const histogram: Record<string, number> = {};
  let valid = 0;
  for (let i = 0; i < N; i++) {
    const code = classes[i];
    if (code > 0) valid++;
    const name = WORLDCOVER_CLASSES[code] ?? `Class ${code}`;
    histogram[name] = (histogram[name] ?? 0) + 1;
  }

  logger.info(
    { grid: `${gs}x${gs}`, tiles: byTile.size, coveragePct: Number(((valid / N) * 100).toFixed(1)) },
    '[landCover] ESA WorldCover grid sampled',
  );

  return {
    gs,
    classes,
    extentKm: opts.extentKm,
    source: 'esa-worldcover-v200-2021',
    histogram,
    coveragePct: (valid / N) * 100,
  };
}

// ── Wire compaction (mirrors compactTerrain in simRunner) ────────────────────

/**
 * Compact a class grid into the base64 payload shipped inside the embedded
 * kernel. Class codes are 0..255, so uint8 → base64 is lossless and ~64 KB
 * for a 256×256 grid (well under Kaggle's kernel size limit). The kernel
 * derives the grid size from the byte count. Returns null when nothing usable.
 */
export function compactLandCover(
  classes: ArrayLike<number>,
): { landcover_b64: string; landcover_gs: number } | null {
  if (!classes || classes.length === 0) return null;
  const n = Math.round(Math.sqrt(classes.length));
  if (n * n !== classes.length) return null;
  const buf = Buffer.alloc(classes.length);
  let valid = 0;
  for (let i = 0; i < classes.length; i++) {
    const v = Number(classes[i]);
    if (Number.isFinite(v) && v > 0) valid++;
    buf[i] = Number.isFinite(v) && v >= 0 && v <= 255 ? v : 0;
  }
  if (valid === 0) return null;
  return { landcover_b64: buf.toString('base64'), landcover_gs: n };
}
