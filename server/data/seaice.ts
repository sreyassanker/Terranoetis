/**
 * NSIDC NRT Sea Ice Concentration Client
 * ── NOAA/NSIDC NRT Climate Data Record V4 (AMSR2, 25km) ──
 *
 * Fetches daily sea ice concentration at a lat/lon point from the
 * NSIDC HTTPS file server. Data files are NetCDF4 storing sea ice
 * concentration on a 25 km polar stereographic grid (EPSG 3413/3976)
 * with projected x/y coordinates, parsed via h5wasm. The target
 * lat/lon is mapped to the grid via inverse projection.
 *
 * Variables: cdr_seaice_conc (scale 0-1000, divide by 10 for %)
 * File naming: sic_psn25_YYYYMMDD_am2_icdr_v04r00.nc (NH)
 *              sic_pss25_YYYYMMDD_am2_icdr_v04r00.nc (SH)
 */

import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

const NSIDC_BASE = 'https://noaadata.apps.nsidc.org/NOAA/G10016_V4';

// The NSIDC NRT daily archive publishes files ~3 months behind "today".
// Older-than-this request dates 404 (archive is a rolling window).
const NSIDC_MAX_AGE_DAYS = 120;


function buildIceUrl(
  hemisphere: 'north' | 'south',
  year: number,
  month: number,
  day: number,
): string {
  const prefix = hemisphere === 'north' ? 'psn25' : 'pss25';
  const yyyymmdd = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  return `${NSIDC_BASE}/${hemisphere}/daily/${year}/sic_${prefix}_${yyyymmdd}_am2_icdr_v04r00.nc`;
}

export interface SeaIceDataPoint {
  /** Sea ice concentration as fraction [0, 1], or null if unavailable */
  concentration: number | null;
  /** Source identifier */
  source: string | null;
  /** Date of the data */
  date: string | null;
}

// ─────────────────────────────────────────────────────────────────
// NSIDC Polar Stereographic projection (EPSG 3413 north / 3976 south)
//
// The G10016_V4 files store cdr_seaice_conc on a 25 km polar
// stereographic grid with projected x/y (metres) coordinates — there
// are no embedded 2D lat/lon arrays. We invert the projection to map a
// target lat/lon to the nearest grid cell (row, col).
// ─────────────────────────────────────────────────────────────────
const WGS84_A = 6378137;                 // semi-major axis (m)
const WGS84_E = 0.081819190842622;       // first eccentricity
const NSIDC_K0 = 0.97276901289;          // NSIDC sea ice scale factor

// Standard parallel and central meridian per hemisphere.
function projectionParams(hemisphere: 'north' | 'south'): { k0: number; lon0: number } {
  // NSIDC uses the same scale factor for both; central meridian differs.
  return { k0: NSIDC_K0, lon0: hemisphere === 'north' ? -45 : 0 };
}

/** Forward polar stereographic: lat/lon (deg) → x/y (m). */
function lonLatToXY(latDeg: number, lonDeg: number, hemisphere: 'north' | 'south'): [number, number] {
  const { k0, lon0: lon0Deg } = projectionParams(hemisphere);
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  const lon0 = lon0Deg * Math.PI / 180;
  const e = WGS84_E;
  const phi = hemisphere === 'south' ? -lat : lat; // treat south as positive magnitude
  const t = Math.tan(Math.PI / 4 - phi / 2) /
    Math.pow((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi)), e / 2);
  const C = Math.sqrt(Math.pow(1 + e, 1 + e) * Math.pow(1 - e, 1 - e));
  const rho = 2 * WGS84_A * k0 * t / C;
  if (hemisphere === 'south') {
    return [rho * Math.sin(lon - lon0), rho * Math.cos(lon - lon0)];
  }
  return [rho * Math.sin(lon - lon0), -rho * Math.cos(lon - lon0)];
}

/**
 * Map target lat/lon to nearest (y, x) cell index on the 25 km grid.
 * Grid extents (x0/y0Top = centre of corner cell) are read from the
 * file's x/y arrays so both NH (304×448) and SH (316×332) work.
 */
function latLonToCell(
  lat: number,
  lon: number,
  x0: number,
  y0Top: number,
  ny: number,
  nx: number,
  hemisphere: 'north' | 'south',
): [number, number] | null {
  const [tx, ty] = lonLatToXY(lat, lon, hemisphere);
  const CELL = 25000;

  const col = Math.round((tx - x0) / CELL);
  const row = Math.round((y0Top - ty) / CELL);

  if (col < 0 || col >= nx || row < 0 || row >= ny) return null;
  return [row, col];
}

/**
 * Scan 2D lat/lon arrays to find the nearest grid cell index.
 * Returns [y, x] or null if no valid cell within threshold.
 *
 * NOTE: the G10016_V4 files do NOT embed lat/lon arrays — they use
 * projected x/y. This function is kept only for older formats that do.
 */
function findNearestCell(
  latitudes: Float32Array | Float64Array,
  longitudes: Float32Array | Float64Array,
  ny: number,
  nx: number,
  targetLat: number,
  targetLon: number,
  maxDistDeg: number = 50,
): [number, number] | null {
  let bestY = -1, bestX = -1;
  let bestDist = Infinity;

  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const idx = y * nx + x;
      const lat = latitudes[idx];
      const lon = longitudes[idx];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      // Haversine distance (simplified for grid search)
      const dLat = (lat - targetLat) * Math.PI / 180;
      const dLon = (lon - targetLon) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(targetLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                Math.sin(dLon / 2) ** 2;
      const dist = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * (180 / Math.PI);

      if (dist < bestDist) {
        bestDist = dist;
        bestY = y;
        bestX = x;
      }
    }
  }

  if (bestY < 0 || bestDist > maxDistDeg) return null;
  return [bestY, bestX];
}

/**
 * Fetch sea ice concentration at a lat/lon point for a given date.
 * Returns null if the data file is unavailable or parsing fails.
 */
export async function fetchSeaIce(
  lat: number,
  lon: number,
  dateStr?: string,
): Promise<SeaIceDataPoint> {
  const refDate = dateStr ? new Date(dateStr) : new Date();
  const year = refDate.getUTCFullYear();
  const month = refDate.getUTCMonth() + 1;
  const day = refDate.getUTCDate();

  const hemisphere: 'north' | 'south' = lat >= 0 ? 'north' : 'south';

  const url = buildIceUrl(hemisphere, year, month, day);
  const cacheKey = `seaice:${url}`;

  const cached = cache.get<SeaIceDataPoint>(cacheKey);
  if (cached) return cached;

  try {
    let resolvedUrl = url;
    let resolvedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    let resp = await fetch(url, { signal: AbortSignal.timeout(30000) });

    // The NSIDC NRT archive lags the requested date (files appear ~3 months
    // behind). Walk back up to NSIDC_MAX_AGE_DAYS to the most recent
    // available daily file rather than 404ing on every recent date.
    const maxAgeMs = NSIDC_MAX_AGE_DAYS * 86400000;
    if (!resp.ok && refDate.getTime() > Date.now() - maxAgeMs) {
      const candidates: string[] = [];
      for (let back = 1; back <= NSIDC_MAX_AGE_DAYS; back++) {
        const d = new Date(refDate.getTime() - back * 86400000);
        candidates.push(buildIceUrl(hemisphere, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
      }
      // Probe candidate files head-first in parallel batches; use the first
      // that exists (most recent wins).
      const batchSize = 5;
      for (let i = 0; i < candidates.length; i += batchSize) {
        const batch = candidates.slice(i, i + batchSize);
        const heads = await Promise.all(batch.map(u => fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(15000) })
          .then(r => (r.ok ? u : null)).catch(() => null)));
        const hit = heads.find((u): u is string => u !== null);
        if (hit) {
          resolvedUrl = hit;
          const ymd = hit.match(/sic_\w+_(\d{8})_/);
          if (ymd) {
            resolvedDate = `${ymd[1].slice(0, 4)}-${ymd[1].slice(4, 6)}-${ymd[1].slice(6, 8)}`;
          }
          resp = await fetch(hit, { signal: AbortSignal.timeout(30000) });
          break;
        }
      }
    }

    if (!resp.ok) return { concentration: null, source: null, date: null };
    const buffer = await resp.arrayBuffer();

    const h5 = await import('h5wasm');
    await h5.ready;
    const tmpPath = `/tmp/seaice_${Date.now()}.h5`;
    h5.FS!.writeFile(tmpPath, new Uint8Array(buffer));
    const h5File = new h5.File(tmpPath, 'r');

    const concVar = h5File.get('cdr_seaice_conc');
    if (!concVar) {
      h5File.close?.();
      h5.FS!.unlink(tmpPath);
      return { concentration: null, source: null, date: null };
    }

    const conc = (concVar as { value: number[] }).value;
    const shape = (concVar as { shape?: number[] }).shape ?? [1, 1, 1];
    const ny = shape[1];
    const nx = shape[2];

    // Read projected grid extents (centre of corner cell) from x/y.
    const xVar = h5File.get('x');
    const yVar = h5File.get('y');
    const xArr = (xVar as { value: ArrayLike<number> })?.value;
    const yArr = (yVar as { value: ArrayLike<number> })?.value;
    if (!xArr || !yArr || xArr.length < 1 || yArr.length < 1) {
      h5File.close?.();
      h5.FS!.unlink(tmpPath);
      return { concentration: null, source: null, date: null };
    }
    const x0 = xArr[0];
    const y0Top = yArr[0];

    // G10016_V4 stores projected x/y; project the target point onto the
    // same grid instead of scanning (absent) lat/lon arrays.
    const cell = latLonToCell(lat, lon, x0, y0Top, ny, nx, hemisphere);
    if (!cell) {
      h5File.close?.();
      h5.FS!.unlink(tmpPath);
      return { concentration: null, source: null, date: null };
    }

    const [y, x] = cell;
    const rawIdx = y * nx + x;
    const rawVal = conc[rawIdx];

    // cdr_seaice_conc is scaled: 0-1000 → 0-100%. Divide by 10 for %, then by 100 for fraction.
    const fraction = typeof rawVal === 'number' && Number.isFinite(rawVal)
      ? Math.max(0, Math.min(1, rawVal / 1000))
      : null;

    h5File.close?.();
    h5.FS!.unlink(tmpPath);

    const result: SeaIceDataPoint = {
      concentration: fraction,
      source: fraction != null ? 'nsidc-nrt-cdr-v4' : null,
      date: resolvedDate,
    };

    cache.set(cacheKey, result);
    return result;
  } catch {
    return { concentration: null, source: null, date: null };
  }
}

export { buildIceUrl, findNearestCell, lonLatToXY, latLonToCell };
