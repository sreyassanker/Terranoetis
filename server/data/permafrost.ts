/**
 * NSIDC Circum-Arctic Permafrost Client
 * ── Permafrost extent probability from NSIDC GGD318 v2 ──
 *
 * Uses the Circum-Arctic Map of Permafrost and Ground-Ice Conditions
 * (Brown et al. 1997). The 0.5° binary grid is downloaded from the
 * NSIDC DAAC (requires Earthdata auth) and cached permanently.
 *
 * When download fails, falls back to a latitude-zone model derived from
 * the NSIDC map boundaries:
 *   Continuous: 90-100%  — zonal mean latitude ~72°N
 *   Discontinuous: 50-90% — zonal mean latitude ~67°N
 *   Sporadic: 10-50%      — zonal mean latitude ~62°N
 *   Isolated: <10%        — zonal mean latitude ~55°N
 */

import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 86400 * 30, checkperiod: 86400 });

export interface PermafrostDataPoint {
  /** Permafrost extent probability [0, 1] */
  probability: number | null;
  /** Permafrost classification string */
  classification: string;
  /** Active layer thickness (m) — estimated from zone */
  activeLayerDepth: number | null;
  /** Ground temperature (°C) — estimated from zone mean */
  groundTemp: number | null;
  /** Source identifier */
  source: string;
}

// NSIDC Circum-Arctic permafrost zones with their extent ranges and typical parameters
const PERMAFROST_ZONES = [
  { minLat: 70, prob: 0.95, class: 'continuous', depth: 0.3, temp: -10 },
  { minLat: 65, prob: 0.70, class: 'discontinuous', depth: 0.8, temp: -4 },
  { minLat: 60, prob: 0.30, class: 'sporadic', depth: 1.5, temp: -1 },
  { minLat: 50, prob: 0.05, class: 'isolated', depth: 3.0, temp: 0.5 },
] as const;

const NO_PERMAFROST = { prob: 0, class: 'none', depth: 0, temp: 5 };

function getLatitudeFallback(lat: number): {
  prob: number; class: string; depth: number; temp: number;
} {
  const absLat = Math.abs(lat);
  for (const zone of PERMAFROST_ZONES) {
    if (absLat >= zone.minLat) {
      return { prob: zone.prob, class: zone.class, depth: zone.depth, temp: zone.temp };
    }
  }
  return NO_PERMAFROST;
}

const GRID_URL = 'https://daacdata.apps.nsidc.org/pub/DATASETS/ggd318/llipa.byte';

function getEarthdataToken(): string | null {
  const user = process.env.EARTHDATA_USERNAME;
  const pass = process.env.EARTHDATA_PASSWORD;
  if (!user || !pass) return null;
  return Buffer.from(`${user}:${pass}`).toString('base64');
}

/**
 * NSIDC 0.5° binary grid values and their interpretation (from GGD318 docs):
 *   0 = ocean/land ice
 *   1 = no permafrost
 *   2 = isolated (0-10%)
 *   3 = sporadic (10-50%)
 *   4 = discontinuous (50-90%)
 *   5 = continuous (90-100%)
 * 255 = fill
 */
const GRID_NLAT = 360; // 0.5°: 90°N to -90°N (row 0 = 90°N, row 359 = -90°N)
const GRID_NLON = 720; // 0.5°: -180°E to 180°E (col 0 = -180°E, col 719 = 179.5°E)

const VALUE_MAP: Record<number, { prob: number; class: string; depth: number; temp: number }> = {
  0: { prob: 0, class: 'ocean/ice', depth: 0, temp: 5 },
  1: { prob: 0, class: 'none', depth: 0, temp: 5 },
  2: { prob: 0.05, class: 'isolated', depth: 3.0, temp: 1 },
  3: { prob: 0.30, class: 'sporadic', depth: 1.5, temp: -1 },
  4: { prob: 0.70, class: 'discontinuous', depth: 0.8, temp: -4 },
  5: { prob: 0.95, class: 'continuous', depth: 0.3, temp: -10 },
};

function latLonToGridIndex(lat: number, lon: number): number {
  const row = Math.floor((90 - lat) / 0.5);
  const col = Math.floor((lon + 180) / 0.5);
  if (row < 0 || row >= GRID_NLAT || col < 0 || col >= GRID_NLON) return -1;
  return row * GRID_NLON + col;
}

/**
 * Fetch permafrost data for a given lat/lon.
 * Tries to download the NSIDC 0.5° binary grid (cached permanently),
 * falls back to latitude-zone model.
 */
export async function fetchPermafrost(
  lat: number,
  lon: number,
): Promise<PermafrostDataPoint> {
  const cacheKey = 'permafrost:grid';
  let grid: Uint8Array | null = cache.get<Uint8Array>(cacheKey) ?? null;

  if (!grid) {
    const token = getEarthdataToken();
    if (token) {
      try {
        const resp = await fetch(GRID_URL, {
          headers: { Authorization: `Basic ${token}` },
          signal: AbortSignal.timeout(15000),
        });
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          grid = new Uint8Array(buf);
          cache.set(cacheKey, grid);
        }
      } catch { /* fall through to latitude model */ }
    }
  }

  if (grid) {
    const idx = latLonToGridIndex(lat, lon);
    if (idx >= 0 && idx < grid.length) {
      const byteVal = grid[idx];
      const mapped = VALUE_MAP[byteVal];
      if (mapped) {
        return {
          probability: mapped.prob,
          classification: mapped.class,
          activeLayerDepth: mapped.depth,
          groundTemp: mapped.temp,
          source: `nsidc-ggd318-v2${byteVal >= 2 && byteVal <= 5 ? `-${mapped.class}` : ''}`,
        };
      }
    }
  }

  // Latitude-zone fallback
  const fb = getLatitudeFallback(lat);
  return {
    probability: fb.prob,
    classification: fb.class,
    activeLayerDepth: fb.depth,
    groundTemp: fb.temp,
    source: 'latitude-zone-model',
  };
}
