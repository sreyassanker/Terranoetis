/**
 * GPM IMERG Precipitation Data Client
 * ── High-resolution satellite precipitation (0.1°, 30-min) ──
 *
 * Uses NASA GPM IMERG Late Run (GPM_3IMERGHHL, ~14h latency) as primary
 * source for non-real-time analysis, and IMERG Early (GPM_3IMERGHHE, ~4h)
 * for NRT needs. Falls back to Open-Meteo ERA5 precipitation (1°) when
 * direct IMERG access is unavailable.
 *
 * Data access: NASA GES DISC HTTPS (requires Earthdata credentials,
 * already configured in .env as EARTHDATA_USERNAME/EARTHDATA_PASSWORD).
 *
 * File format: HDF5, 30-min global 0.1° x 0.1° grids.
 */

import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 7200, checkperiod: 600 });

const GES_DISC_BASE = 'https://gpm2.gesdisc.eosdis.nasa.gov/data';

const ACCUMULATED_30MIN_MM = 100; // scale factor for raw IMERG values

// IMERG V07 product version
const IMERG_VERSION = 'V07C';

type ImergProduct = 'early' | 'late' | 'final';

const PRODUCT_PATHS: Record<ImergProduct, string> = {
  early: 'GPM_L3/GPM_3IMERGHHE.07',
  late: 'GPM_L3/GPM_3IMERGHHL.07',
  final: 'GPM_L3/GPM_3IMERGHH.07',
};

let _h5wasm: any = null;
async function getH5wasm() {
  if (!_h5wasm) {
    _h5wasm = await import('h5wasm');
    await _h5wasm.ready;
  }
  return _h5wasm;
}

interface ImergFileInfo {
  productPath: string;
  filename: string;
  date: string;            // YYYYMMDD
  startTime: string;       // HHmmss
  endTime: string;         // HHmmss
}

/**
 * Build the IMERG HDF5 filename for a given date and 30-min time slot.
 * Half-hourly windows: 00, 01, ..., 47 (each covering 30 min).
 */
function buildImergFilename(
  product: ImergProduct,
  year: number,
  month: number,
  day: number,
  slot30: number, // 0–47
): ImergFileInfo {
  const yyyymmdd = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  const startMin = slot30 * 30;
  const endMin = startMin + 29;
  const startTime = `${String(Math.floor(startMin / 60)).padStart(2, '0')}${String(startMin % 60).padStart(2, '0')}00`;
  const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}${String(endMin % 60).padStart(2, '0')}59`;
  const prefix = product === 'early' ? '3B-HHR-E' : product === 'late' ? '3B-HHR-L' : '3B-HHR';
  const elapsed = String(slot30 * 30).padStart(4, '0');
  const filename = `${prefix}.MS.MRG.3IMERG.${yyyymmdd}-S${startTime}-E${endTime}.${elapsed}.${IMERG_VERSION}.HDF5`;
  return {
    productPath: PRODUCT_PATHS[product],
    filename,
    date: yyyymmdd,
    startTime,
    endTime,
  };
}

/**
 * Generate Earthdata token from username/password.
 * Uses BASIC auth to exchange credentials for a session token.
 */
function getEarthdataToken(): string | null {
  const user = process.env.EARTHDATA_USERNAME;
  const pass = process.env.EARTHDATA_PASSWORD;
  if (!user || !pass) return null;
  return Buffer.from(`${user}:${pass}`).toString('base64');
}

/**
 * Download an IMERG HDF5 file from GES DISC, returning the raw bytes.
 * Returns null if Earthdata credentials are missing or download fails.
 */
async function downloadImergFile(
  fileInfo: ImergFileInfo,
): Promise<ArrayBuffer | null> {
  const token = getEarthdataToken();
  if (!token) return null;

  const yyyy = fileInfo.date.slice(0, 4);
  const mm = fileInfo.date.slice(4, 6);
  const dd = fileInfo.date.slice(6, 8);
  const dt = new Date(+yyyy, +mm - 1, +dd);
  const doy = Math.floor((dt.getTime() - new Date(+yyyy, 0, 0).getTime()) / 86400000);
  const doyStr = String(doy).padStart(3, '0');
  const url = `${GES_DISC_BASE}/${fileInfo.productPath}/${yyyy}/${doyStr}/${fileInfo.filename}`;

  const cacheKey = `imerg:${fileInfo.filename}`;
  const cached = cache.get<ArrayBuffer>(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Basic ${token}`,
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/octet-stream,*/*',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      console.warn(`[IMERG] download failed ${resp.status} (redirected: ${resp.redirected}) for ${url}`);
      const text = await resp.text().catch(() => '');
      // Only log warning bodies for non-200 responses
      if (resp.status !== 404) console.warn(`[IMERG] body: ${text.slice(0, 200)}`);
      return null;
    }
    const buffer = await resp.arrayBuffer();
    cache.set(cacheKey, buffer);
    return buffer;
  } catch {
    return null;
  }
}

interface ImergGridData {
  lat: Float32Array;
  lon: Float32Array;
  precipitation: Float32Array; // 1D array, row-major (lat × lon)
}

// IMERG grid parameters
const IMERG_NLAT = 1800;  // 0.1° spacing: -89.95 to 89.95
const IMERG_NLON = 3600;  // 0.1° spacing: -179.95 to 179.95

/**
 * Parse IMERG HDF5 data to extract precipitation at a lat/lon point.
 * Since h5wasm reads HDF5 files, this handles the parsed structure.
 *
 * IMERG HDF5 internal structure:
 *   /Grid/precipitation    — 2D [lat][lon] float32 array
 *   /Grid/lat              — 1D float64 array (1800 values)
 *   /Grid/lon              — 1D float64 array (3600 values)
 *
 * Returns precipitation in mm/hr. Scale: raw value / scale_factor.
 */
export function extractPrecipitationAtPoint(
  gridData: ImergGridData,
  lat: number,
  lon: number,
): number {
  // Find nearest grid indices
  let latIdx = 0;
  let minLatDist = Infinity;
  for (let i = 0; i < gridData.lat.length; i++) {
    const d = Math.abs(gridData.lat[i] - lat);
    if (d < minLatDist) { minLatDist = d; latIdx = i; }
  }

  let lonIdx = 0;
  let minLonDist = Infinity;
  for (let j = 0; j < gridData.lon.length; j++) {
    const d = Math.abs(gridData.lon[j] - lon);
    if (d < minLonDist) { minLonDist = d; lonIdx = j; }
  }

  const idx = latIdx * gridData.lon.length + lonIdx;
  const raw = gridData.precipitation[idx];
  if (raw == null || !Number.isFinite(raw)) return 0;

  // IMERG V07 scale: stored in mm/hr with scale factor ~100
  return Math.max(0, raw / ACCUMULATED_30MIN_MM);
}

/**
 * Aggregate precipitation over a time range (in hours).
 * Sums 30-min slots for the given window.
 */
export function aggregatePrecipitation(
  hourlyValues: number[], // 48 values for a full day
  windowHours: number,
): number {
  const slots = Math.min(hourlyValues.length, windowHours * 2);
  return hourlyValues.slice(0, slots).reduce((s, v) => s + v, 0);
}

export interface PrecipitationResult {
  /** Precipitation in mm (total over requested window) */
  totalPrecipitation: number;
  /** Number of 30-min slots composited */
  slotsUsed: number;
  /** Source identifier */
  source: 'imerg-early' | 'imerg-late' | 'imerg-final' | 'open-meteo-fallback';
  /** Max intensity in any slot (mm/hr) */
  maxIntensity: number;
  /** Actual date used (may differ from requested date due to latency) */
  date?: string;
}

/**
 * Fetch IMERG precipitation at a point.
 *
 * Tier 1: IMERG Late Run (GES DISC HDF5, ~14h latency)
 * Tier 2: IMERG Early Run (GES DISC HDF5, ~4h latency)
 * Tier 3: Open-Meteo ERA5 (already available as `w.precipitation`)
 *
 * For practical reasons, the direct HDF5 parsing requires h5wasm.
 * The function signature accepts either raw parsed data or a grid callback.
 * When HDF5 access is unavailable, it returns null for upstream fallback.
 */
export async function fetchImergPrecipitation(
  lat: number,
  lon: number,
  dateStr?: string,
  windowHours: number = 6,
): Promise<PrecipitationResult | null> {
  const token = getEarthdataToken();
  if (!token) return null;

  const refDate = dateStr ? new Date(dateStr) : new Date();
  const products: ImergProduct[] = ['late', 'early'];
  let lastError: string | null = null;

  // Parse a single buffer for precip at point; cache lat/lon grids
  async function parseSlot(
    h5: any,
    buffer: ArrayBuffer,
    cachedLatLon: { lat: Float32Array; lon: Float32Array } | null,
  ): Promise<{ precip: number; latLon: { lat: Float32Array; lon: Float32Array } } | null> {
    const tmpPath = '/tmp/imerg_slot.h5';
    try {
      h5.FS.writeFile(tmpPath, new Uint8Array(buffer));
      const file = new h5.File(tmpPath, 'r');
      const precipVar = file.get('Grid/precipitation');
      if (!precipVar) { file.close(); return null; }
      const latVar = cachedLatLon ? null : file.get('Grid/lat');
      const lonVar = cachedLatLon ? null : file.get('Grid/lon');
      const lat = cachedLatLon?.lat ?? new Float32Array((latVar as any).value as number[]);
      const lon = cachedLatLon?.lon ?? new Float32Array((lonVar as any).value as number[]);
      const precipArr = new Float32Array(precipVar.value as number[]);
      file.close();

      const gridData: ImergGridData = { lat, lon, precipitation: precipArr };
      const mmHr = extractPrecipitationAtPoint(gridData, lat, lon);
      return { precip: mmHr, latLon: { lat, lon } };
    } catch {
      return null;
    } finally {
      try { h5.FS.unlink(tmpPath); } catch {}
    }
  }

  for (let lookback = 0; lookback <= 7; lookback++) {
    const attemptDate = new Date(refDate.getTime() - lookback * 86400000);
    const year = attemptDate.getUTCFullYear();
    const month = attemptDate.getUTCMonth() + 1;
    const day = attemptDate.getUTCDate();
    const dateStr2 = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    for (const product of products) {
      try {
        const h5 = await getH5wasm();
        const totalSlots = windowHours * 2;
        const fileInfos = Array.from({ length: totalSlots }, (_, s) =>
          buildImergFilename(product, year, month, day, s),
        );

        // Download in parallel batches
        let batchSize = 3;
        let totalPrecip = 0;
        let maxIntensity = 0;
        let productSlots = 0;
        let cachedLatLon: { lat: Float32Array; lon: Float32Array } | null = null;

        for (let i = 0; i < fileInfos.length; i += batchSize) {
          const batch = fileInfos.slice(i, i + batchSize);
          const buffers = await Promise.all(batch.map(fi => downloadImergFile(fi)));

          for (let b = 0; b < batch.length; b++) {
            const buffer = buffers[b];
            if (!buffer) continue;
            const result = await parseSlot(h5, buffer, cachedLatLon);
            if (!result) continue;
            if (!cachedLatLon) cachedLatLon = result.latLon;
            totalPrecip += result.precip;
            maxIntensity = Math.max(maxIntensity, result.precip);
            productSlots++;
          }

          // If most files in this batch failed, try next product/date
          const succ = buffers.filter(Boolean).length;
          if (succ < 2 && i === 0 && productSlots === 0) break;
        }

        if (productSlots > 0) {
          return {
            totalPrecipitation: Math.round(totalPrecip * 100) / 100,
            slotsUsed: productSlots,
            date: dateStr2,
            source: product === 'late' ? 'imerg-late' : 'imerg-early',
            maxIntensity: Math.round(maxIntensity * 100) / 100,
          };
        }
      } catch (e) {
        lastError = `product=${product} lookback=${lookback}d err=${(e as Error).message}`;
      }
    }
  }

  if (lastError) {
    console.warn(`[IMERG] All products/dates failed, last error: ${lastError}`);
  }

  return null;
}

/**
 * Pure version of extractPrecipitationAtPoint that takes explicit arrays.
 * Useful for testing without HDF5 parsing.
 */
export function extractPrecipitation(
  precipGrid: number[][],   // [latIdx][lonIdx]
  lats: number[],
  lons: number[],
  targetLat: number,
  targetLon: number,
): number {
  let latIdx = 0;
  let minLatDist = Infinity;
  for (let i = 0; i < lats.length; i++) {
    const d = Math.abs(lats[i] - targetLat);
    if (d < minLatDist) { minLatDist = d; latIdx = i; }
  }

  let lonIdx = 0;
  let minLonDist = Infinity;
  for (let j = 0; j < lons.length; j++) {
    const d = Math.abs(lons[j] - targetLon);
    if (d < minLonDist) { minLonDist = d; lonIdx = j; }
  }

  const val = precipGrid[latIdx]?.[lonIdx];
  if (val == null || !Number.isFinite(val)) return 0;
  return Math.max(0, val);
}

/**
 * Build the IMERG download URL for a given date.
 * Returns null if Earthdata credentials are not configured.
 */
export function getImergUrl(
  product: ImergProduct,
  year: number,
  month: number,
  day: number,
  slot30: number,
): string | null {
  if (!getEarthdataToken()) return null;
  const info = buildImergFilename(product, year, month, day, slot30);
  const yyyy = info.date.slice(0, 4);
  const mm = info.date.slice(4, 6);
  const dd = info.date.slice(6, 8);
  const dt = new Date(+yyyy, +mm - 1, +dd);
  const doy = Math.floor((dt.getTime() - new Date(+yyyy, 0, 0).getTime()) / 86400000);
  const doyStr = String(doy).padStart(3, '0');
  return `${GES_DISC_BASE}/${info.productPath}/${yyyy}/${doyStr}/${info.filename}`;
}
