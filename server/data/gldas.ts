/**
 * GLDAS-Noah Land Surface Model Data Client
 * ── NASA GLDAS v2.1 (0.25°, 3-hourly) ──
 *
 * Provides TKE dissipation rate (Eq 8 ε), multi-layer soil moisture profile
 * (Eqs 43/46), groundwater storage (Eqs 131-133), and snow water equivalent
 * (Eq 91) — variables not available from Open-Meteo or ERA5 CDS.
 *
 * Access: NASA GES DISC HTTPS (requires EARTHDATA_USERNAME/PASSWORD in .env).
 *
 * Format: NetCDF4 (HDF5), parsed via h5wasm.
 */

import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 86400, checkperiod: 1800 });

const GES_DISC_BASE = 'https://hydro1.gesdisc.eosdis.nasa.gov/data/GLDAS/GLDAS_NOAH025_3H.2.1';

const GLDAS_RESOLUTION = 0.25;

const GLDAS_LATS = 720; // -89.875 to 89.875 at 0.25°
const GLDAS_LONS = 1440; // -179.875 to 179.875 at 0.25°

function getEarthdataToken(): string | null {
  const user = process.env.EARTHDATA_USERNAME;
  const pass = process.env.EARTHDATA_PASSWORD;
  if (!user || !pass) return null;
  return Buffer.from(`${user}:${pass}`).toString('base64');
}

function latToIndex(lat: number): number {
  return Math.round((lat + 89.875) / GLDAS_RESOLUTION);
}

function lonToIndex(lon: number): number {
  return Math.round(((lon + 179.875) % 360) / GLDAS_RESOLUTION);
}

function getNearestTimeSlot(hours: number): number {
  const slots = [0, 3, 6, 9, 12, 15, 18, 21];
  let nearest = 0;
  let minDist = Infinity;
  for (const s of slots) {
    const d = Math.abs(s - hours);
    if (d < minDist) { minDist = d; nearest = s; }
  }
  return nearest;
}

function buildGldasUrl(year: number, month: number, day: number, hour?: number): string | null {
  if (!getEarthdataToken()) return null;
  const doy = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000);
  const yyyymmdd = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  const hhmm = hour != null
    ? `${String(getNearestTimeSlot(hour)).padStart(2, '0')}00`
    : '1200';
  return `${GES_DISC_BASE}/${year}/${String(doy).padStart(3, '0')}/GLDAS_NOAH025_3H.A${yyyymmdd}.${hhmm}.021.nc4`;
}

export interface GldasPointData {
  tkeDissipation: number | null;          // m²/s³ → Eq 8 ε
  soilMoisture0_10: number | null;        // kg/m² → Eqs 43, 46
  soilMoisture10_40: number | null;
  soilMoisture40_100: number | null;
  soilMoisture100_200: number | null;
  groundwaterStorage: number | null;      // kg/m² → Eqs 131-133
  snowWaterEquivalent: number | null;     // kg/m² → Eq 91
  canopyInterception: number | null;      // kg/m² → Eqs 9-12
  surfaceTemp: number | null;             // K → Eq 43
  source: string | null;
}

const DEFAULT_FALLBACK: GldasPointData = {
  tkeDissipation: null,
  soilMoisture0_10: null,
  soilMoisture10_40: null,
  soilMoisture40_100: null,
  soilMoisture100_200: null,
  groundwaterStorage: null,
  snowWaterEquivalent: null,
  canopyInterception: null,
  surfaceTemp: null,
  source: null,
};

/**
 * Download a GLDAS NetCDF4 file from GES DISC.
 * Returns the raw bytes (HDF5/NetCDF4 format) or null on failure.
 */
async function downloadGldasFile(url: string): Promise<ArrayBuffer | null> {
  const cacheKey = `gldas:${url}`;
  const cached = cache.get<ArrayBuffer>(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Basic ${getEarthdataToken()!}` },
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) return null;
    const buffer = await resp.arrayBuffer();
    cache.set(cacheKey, buffer);
    return buffer;
  } catch {
    return null;
  }
}

/**
 * Read a scalar value from a GLDAS HDF5 grid variable at the given lat/lon.
 * The h5wasm File provides datasets with 3D shape [time, lat, lon].
 */
function readGridScalar(
  h5File: import('h5wasm').File,
  varName: string,
  latIdx: number,
  lonIdx: number,
): number | null {
  try {
    const dataset = h5File.get(varName) as { value: number[]; shape?: number[] } | null;
    if (!dataset) return null;
    const data = dataset.value;
    if (!data) return null;
    const shape = dataset.shape ?? [];

    // Handle 3D [time, lat, lon] or 2D [lat, lon]
    const tIdx = 0;
    if (shape.length === 3) {
      const strideLat = shape[2];
      const val = data[tIdx * shape[1] * shape[2] + latIdx * strideLat + lonIdx];
      return typeof val === 'number' && Number.isFinite(val) ? val : null;
    }
    if (shape.length === 2) {
      const val = data[latIdx * shape[1] + lonIdx];
      return typeof val === 'number' && Number.isFinite(val) ? val : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch GLDAS-Noah data for a given lat/lon and date.
 * Uses Earthdata authentication. Returns null if credentials are missing
 * or the download fails.
 */
export async function fetchGldasData(
  lat: number,
  lon: number,
  dateStr?: string,
  hour?: number,
): Promise<GldasPointData> {
  const token = getEarthdataToken();
  if (!token) return DEFAULT_FALLBACK;

  const refDate = dateStr ? new Date(dateStr) : new Date();
  const year = refDate.getUTCFullYear();
  const month = refDate.getUTCMonth() + 1;
  const day = refDate.getUTCDate();

  const url = buildGldasUrl(year, month, day, hour);
  if (!url) return DEFAULT_FALLBACK;

  const buffer = await downloadGldasFile(url);
  if (!buffer) return DEFAULT_FALLBACK;

  try {
    const h5 = await import('h5wasm');
    const tmpPath = `/tmp/gldas_${Date.now()}.h5`;
    h5.FS!.writeFile(tmpPath, new Uint8Array(buffer));
    const h5File = new h5.File(tmpPath, 'r');

    const latIdx = Math.max(0, Math.min(GLDAS_LATS - 1, latToIndex(lat)));
    const lonIdx = Math.max(0, Math.min(GLDAS_LONS - 1, lonToIndex(lon)));

    const result: GldasPointData = {
      tkeDissipation: readGridScalar(h5File, 'TkeDiss_tavg', latIdx, lonIdx),
      soilMoisture0_10: readGridScalar(h5File, 'SoilMoi0_10cm_inst', latIdx, lonIdx),
      soilMoisture10_40: readGridScalar(h5File, 'SoilMoi10_40cm_inst', latIdx, lonIdx),
      soilMoisture40_100: readGridScalar(h5File, 'SoilMoi40_100cm_inst', latIdx, lonIdx),
      soilMoisture100_200: readGridScalar(h5File, 'SoilMoi100_200cm_inst', latIdx, lonIdx),
      groundwaterStorage: readGridScalar(h5File, 'GWwb_inst', latIdx, lonIdx),
      snowWaterEquivalent: readGridScalar(h5File, 'SWE_inst', latIdx, lonIdx),
      canopyInterception: readGridScalar(h5File, 'CanopInt_inst', latIdx, lonIdx),
      surfaceTemp: readGridScalar(h5File, 'AvgSurfT_inst', latIdx, lonIdx),
      source: 'gldas-noah-2.1',
    };

    h5File.close?.();
    h5.FS!.unlink(tmpPath);
    return result;
  } catch {
    return DEFAULT_FALLBACK;
  }
}

/**
 * Pure conversion functions, testable without h5wasm.
 */

/** Convert GLDAS soil moisture (kg/m²) to volumetric fraction (m³/m³).
 *  GLDAS stores soil moisture as kg/m² which is equivalent to mm of water
 *  over a layer. Divide by layer thickness (in mm) for volumetric fraction. */
export function soilMoistureToVolumetric(
  moistKgM2: number | null,
  layerThicknessCm: number,
): number | null {
  if (moistKgM2 == null) return null;
  const thicknessMm = layerThicknessCm * 10;
  const vol = moistKgM2 / thicknessMm;
  return Math.max(0, Math.min(1, vol));
}

/** GLDAS variable names for each soil layer */
export const SOIL_LAYERS = [
  { name: 'soilMoisture0_10', thicknessCm: 10 },
  { name: 'soilMoisture10_40', thicknessCm: 30 },
  { name: 'soilMoisture40_100', thicknessCm: 60 },
  { name: 'soilMoisture100_200', thicknessCm: 100 },
] as const;

/** Compute a soil-moisture-weighted surface value (e.g. for soil respiration Eq 46) */
export function weightedSoilMoisture(
  data: GldasPointData,
  maxDepthCm: number = 100,
): number | null {
  let totalWeight = 0;
  let weightedSum = 0;
  for (const layer of SOIL_LAYERS) {
    if (layer.thicknessCm > maxDepthCm) break;
    const sm = data[layer.name as keyof GldasPointData] as number | null;
    if (sm == null) continue;
    totalWeight += layer.thicknessCm;
    weightedSum += sm * layer.thicknessCm;
  }
  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

/** Estimate groundwater depth (m) from GLDAS groundwater storage (kg/m²).
 *  GLDAS GWwb is the water content in the "aquifer" layer (a conceptual
 *  deeper storage, not a true water table depth). Conversion uses a simple
 *  specific-yield approximation. */
export function groundwaterStorageToDepth(
  gwStorage: number | null,
  specificYield: number = 0.2,
): number | null {
  if (gwStorage == null) return null;
  // kg/m² ≈ mm of water. Depth below surface = (storage_thickness / Sy)
  return Math.max(0, gwStorage / 1000 / specificYield);
}

export { buildGldasUrl, latToIndex };
