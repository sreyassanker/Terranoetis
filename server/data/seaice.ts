/**
 * NSIDC NRT Sea Ice Concentration Client
 * ── NOAA/NSIDC NRT Climate Data Record V4 (AMSR2, 25km) ──
 *
 * Fetches daily sea ice concentration at a lat/lon point from the
 * NSIDC HTTPS file server. Data files are NetCDF4 with embedded
 * 2D lat/lon arrays, parsed via h5wasm.
 *
 * Variables: cdr_seaice_conc (scale 0-1000, divide by 10 for %)
 * File naming: sic_psn25_YYYYMMDD_am2_icdr_v04r00.nc (NH)
 *              sic_pss25_YYYYMMDD_am2_icdr_v04r00.nc (SH)
 */

import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

const NSIDC_BASE = 'https://noaadata.apps.nsidc.org/NOAA/G10016_V4';

const NH_GRID_SIZE_Y = 448;
const NH_GRID_SIZE_X = 304;
const SH_GRID_SIZE_Y = 332;
const SH_GRID_SIZE_X = 316;

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

/**
 * Scan 2D lat/lon arrays to find the nearest grid cell index.
 * Returns [y, x] or null if no valid cell within threshold.
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
    const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) return { concentration: null, source: null, date: null };
    const buffer = await resp.arrayBuffer();

    const { File } = await import('h5wasm');
    const h5File = new File(buffer, url.split('/').pop()!);

    const latVar = h5File.get('latitude');
    const lonVar = h5File.get('longitude');
    const concVar = h5File.get('cdr_seaice_conc');

    if (!latVar || !lonVar || !concVar) {
      h5File.close?.();
      return { concentration: null, source: null, date: null };
    }

    const lats = new Float64Array(latVar.value as number[]);
    const lons = new Float64Array(lonVar.value as number[]);
    const conc = concVar.value as number[];

    const shape = concVar.shape ?? [1, 1, 1];
    const ny = shape[1];
    const nx = shape[2];

    const cell = findNearestCell(lats, lons, ny, nx, lat, lon);
    if (!cell) {
      h5File.close?.();
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

    const result: SeaIceDataPoint = {
      concentration: fraction,
      source: fraction != null ? 'nsidc-nrt-cdr-v4' : null,
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    };

    cache.set(cacheKey, result);
    return result;
  } catch {
    return { concentration: null, source: null, date: null };
  }
}

export { buildIceUrl, findNearestCell };
