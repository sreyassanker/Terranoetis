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
  const filename = `${prefix}.MS.MRG.3IMERG.${yyyymmdd}-S${startTime}-E${endTime}.0000.${IMERG_VERSION}.HDF5`;
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
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      console.warn(`[IMERG] download failed ${resp.status} (redirected: ${resp.redirected}) for ${url}`);
      const text = await resp.text().catch(() => '');
      console.warn(`[IMERG] body: ${text.slice(0, 200)}`);
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
  windowHours: number = 24,
): Promise<PrecipitationResult | null> {
  const token = getEarthdataToken();
  if (!token) return null;

  const refDate = dateStr ? new Date(dateStr) : new Date();
  const year = refDate.getUTCFullYear();
  const month = refDate.getUTCMonth() + 1;
  const day = refDate.getUTCDate();

  // Try Late product first, then Early
  const products: ImergProduct[] = ['late', 'early'];
  let lastError: string | null = null;

  for (const product of products) {
    let productSlots = 0;
    try {
      const h5 = await import('h5wasm');
      await h5.ready;
      let totalPrecip = 0;
      let maxIntensity = 0;

      const totalSlots = windowHours * 2;
      for (let slot = 0; slot < totalSlots; slot++) {
        const fileInfo = buildImergFilename(product, year, month, day, slot);
        const buffer = await downloadImergFile(fileInfo);
        if (!buffer) continue;

        const tmpPath = '/tmp/imerg.h5';
        h5.FS.writeFile(tmpPath, new Uint8Array(buffer));
        const file = new h5.File(tmpPath, 'r');
        const precipVar = file.get('Grid/precipitation');
        const latVar = file.get('Grid/lat');
        const lonVar = file.get('Grid/lon');
        file.close();
        h5.FS.unlink(tmpPath);

        if (!precipVar || !latVar || !lonVar) continue;

        const gridData: ImergGridData = {
          lat: new Float32Array(latVar.value as number[]),
          lon: new Float32Array(lonVar.value as number[]),
          precipitation: new Float32Array(precipVar.value as number[]),
        };

        const precipMmHr = extractPrecipitationAtPoint(gridData, lat, lon);
        if (precipMmHr > 0) {
          totalPrecip += precipMmHr;
          maxIntensity = Math.max(maxIntensity, precipMmHr);
        }
        productSlots++;
      }

      if (productSlots > 0) {
        return {
          totalPrecipitation: Math.round(totalPrecip * 100) / 100,
          slotsUsed: productSlots,
          source: product === 'late' ? 'imerg-late' : 'imerg-early',
          maxIntensity: Math.round(maxIntensity * 100) / 100,
        };
      }
      console.warn(`[IMERG] ${product}: 0/${totalSlots} slots downloaded`);
    } catch (e) {
      lastError = `product=${product} slots=${productSlots} err=${(e as Error).message}`;
    }
  }

  // If IMERG failed but we have a fallback, log the error
  if (lastError) {
    console.warn(`[IMERG] All products failed, last error: ${lastError}`);
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
