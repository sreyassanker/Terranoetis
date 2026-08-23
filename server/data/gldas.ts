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

/** URS OAuth bearer token, cached for its lifetime. Required for GES DISC
 *  file downloads: Basic auth works for listings, but file GETs 302-redirect
 *  to URS and Node strips the Authorization header on cross-origin hops, so
 *  we obtain an EDL bearer token (GET /api/users/tokens accepts Basic auth). */
let cachedBearer: { token: string; expiresAt: number } | null = null;

async function getEarthdataBearer(): Promise<string | null> {
  const basic = getEarthdataToken();
  if (!basic) return null;
  if (cachedBearer && cachedBearer.expiresAt > Date.now()) return cachedBearer.token;

  try {
    const resp = await fetch('https://urs.earthdata.nasa.gov/api/users/tokens', {
      headers: { Authorization: `Basic ${basic}`, 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return null;
    const tokens = await resp.json() as { access_token?: string; exp?: number }[];
    const token = tokens[0]?.access_token;
    if (token) {
      const expSec = tokens[0]?.exp;
      const expiresAt = typeof expSec === 'number'
        ? (expSec - 300) * 1000
        : Date.now() + 6 * 3600 * 1000;
      cachedBearer = { token, expiresAt };
      return token;
    }
  } catch {
    // URS token API unreachable — fall through to EDL env fallback
  }

  // Fallback: EDL JWT from .env (EARTHDATA_EDL_TOKEN). This token is
  // generated at https://urs.earthdata.nasa.gov/ — regenerate when it
  // expires (~60 days). Without it, GES DISC downloads that require a
  // bearer token (GLDAS, SOS, etc.) cannot authenticate.
  const edlToken = process.env.EARTHDATA_EDL_TOKEN;
  if (edlToken) {
    // JWT exp is the 3rd base64 segment; decode to find expiry.
    try {
      const payload = JSON.parse(Buffer.from(edlToken.split('.')[1], 'base64').toString());
      const expSec = payload.exp as number | undefined;
      cachedBearer = {
        token: edlToken,
        expiresAt: typeof expSec === 'number' ? (expSec - 300) * 1000 : Date.now() + 7 * 86400000,
      };
      return edlToken;
    } catch {
      return null;
    }
  }
  return null;
}

function latToIndex(lat: number): number {
  return Math.round((lat + 89.875) / GLDAS_RESOLUTION);
}

/**
 * GLDAS-Noah 0.25° data arrays are indexed in 0–360° longitude convention
 * (the netCDF `lon` coordinate is declared −179.875…179.875, but the data
 * storage is 0…359.875). Negative / western longitudes must therefore map
 * through `(lon + 360) % 360` — the previous `(lon + 179.875) % 360` form
 * returned the wrong pixel for every western-hemisphere point, which read
 * the GLDAS −9999 fill sentinel (Tool 47 audit, 2026-08).
 */
function lonToIndex(lon: number): number {
  return Math.round((((lon % 360) + 360) % 360) / GLDAS_RESOLUTION);
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
  granuleTime: string | null;             // ISO timestamp of the granule actually read
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
  granuleTime: null,
  source: null,
};

/**
 * Download a GLDAS NetCDF4 file from GES DISC.
 * Returns the raw bytes (HDF5/NetCDF4 format) or null on failure.
 *
 * Latency hardening (Tool 47 audit, 2026-08): the 2026 NRT stream is halted,
 * so pass-1 walk-back probes ~20 dead slots. A GET on a 404 slot costs ~5 s
 * (URS redirect + body), which pushed the whole fetch past the GLDAS timeout
 * budget (~20 dead GETs + binary search + a 22.5 MB download). HEADs are
 * fast (~1.7 s) and the dir-existence cache is shared, so probe-existence
 * first and only GET slots that answer 200.
 */
async function downloadGldasFile(url: string): Promise<ArrayBuffer | null> {
  const cacheKey = `gldas:${url}`;
  const cached = cache.get<ArrayBuffer>(cacheKey);
  if (cached) return cached;

  const bearer = await getEarthdataBearer();
  if (!bearer) return null;

  try {
    const head = await fetch(url, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${bearer}`, 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!head.ok) return null;
  } catch {
    return null;
  }

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${bearer}`, 'User-Agent': 'Mozilla/5.0' },
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
 *
 * GLDAS-Noah uses -9999 as the fill/missing-data sentinel. A -9999 at the
 * study pixel means "no valid geophysical value", so it is mapped to null
 * (honest NaN upstream) rather than passed through as a real reading.
 */
const GLDAS_FILL = -9999;
function readGridScalar(
  h5File: import('h5wasm').File,
  varName: string,
  latIdx: number,
  lonIdx: number,
): number | null {
  const clean = (val: number): number | null =>
    typeof val === 'number' && Number.isFinite(val) && Math.abs(val - GLDAS_FILL) > 1 ? val : null;
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
      return clean(val);
    }
    if (shape.length === 2) {
      const val = data[latIdx * shape[1] + lonIdx];
      return clean(val);
    }
    return null;
  } catch {
    return null;
  }
}

/** HEAD-probe whether a GLDAS day-directory exists (cheap existence check). */
async function gldasDayExists(year: number, doy: number): Promise<boolean> {
  const bearer = await getEarthdataBearer();
  if (!bearer) return false;
  const url = `${GES_DISC_BASE}/${year}/${String(doy).padStart(3, '0')}/`;
  const cacheKey = `gldas:dir:${url}`;
  const cached = cache.get<boolean>(cacheKey);
  if (cached != null) return cached;
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${bearer}`, 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(30000),
    });
    const exists = resp.ok;
    cache.set(cacheKey, exists, 21600); // 6 h
    return exists;
  } catch {
    return false;
  }
}

/** Binary-search the latest published day-of-year for the given year.
 *  GLDAS granules are published contiguously, so dir-existence is monotonic
 *  decreasing — binary search finds the newest published DOY in ~9 HEADs. */
async function latestPublishedDoy(year: number): Promise<number | null> {
  const startUTC = Date.UTC(year, 0, 1);
  if (startUTC > Date.now()) return null; // future year
  let hi = Math.floor((Date.now() - startUTC) / 86400000) + 1;
  hi = Math.min(hi, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365);
  let lo = 1;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (await gldasDayExists(year, mid)) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best;
}

/** Fetch the latest available granule for a given day (slot 21→00). */
async function fetchLatestSlotForDoy(year: number, doy: number): Promise<{ buffer: ArrayBuffer; url: string } | null> {
  const d = new Date(Date.UTC(year, 0, doy));
  for (const hour of [21, 18, 15, 12, 9, 6, 3, 0]) {
    const url = buildGldasUrl(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour);
    if (!url) continue;
    const buffer = await downloadGldasFile(url);
    if (buffer) return { buffer, url };
  }
  return null;
}

/**
 * Fetch GLDAS-Noah data for a given lat/lon and date.
 * Uses Earthdata authentication. Returns null if credentials are missing
 * or the download fails.
 *
 * Granule availability handling (Tool 47 audit, 2026-08):
 *  - Pass 1 (normal NRT latency): walk back at most `maxSlots` 3-hourly
 *    slots from the requested date/hour and download the first published
 *    granule. With an explicit date this stays within that day (8 slots).
 *  - Pass 2 (stream halt, "now" only): the Noah 2.1 NRT production stream
 *    can halt (2026-08 audit found data ended 2026-05-31). When the caller
 *    asked for "current" data (no dateStr) and pass 1 found nothing,
 *    binary-search the latest published DOY and use its newest slot —
 *    genuine measurements of the newest available state, never fabricated.
 *    The granule timestamp is recorded in `source` for provenance.
 */
export async function fetchGldasData(
  lat: number,
  lon: number,
  dateStr?: string,
  _hour?: number,
): Promise<GldasPointData> {
  const token = getEarthdataToken();
  if (!token) return DEFAULT_FALLBACK;

  const now = new Date();
  const refDate = dateStr ? new Date(dateStr) : now;
  if (!Number.isFinite(refDate.getTime())) return DEFAULT_FALLBACK;

  const SLOT_MS = 3 * 3600 * 1000;
  const snap = new Date(Math.floor(refDate.getTime() / SLOT_MS) * SLOT_MS);
  const maxSlots = dateStr ? 8 : 20; // 24 h / 2.5 days of walkback

  // Pass-1 gate (stream-halt fast path): if the entire day directories that
  // the walk-back would cover are unpublished, probing individual slots is
  // guaranteed to fail — skip straight to pass 2 (latest published DOY).
  let pass1Viable = true;
  if (!dateStr && maxSlots > 8) {
    const d0 = snap;
    const d1 = new Date(snap.getTime() - Math.floor((maxSlots - 1) / 8) * 86400000);
    const doyOf = (d: Date) =>
      Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
    pass1Viable =
      (await gldasDayExists(d0.getUTCFullYear(), doyOf(d0))) ||
      (await gldasDayExists(d1.getUTCFullYear(), doyOf(d1)));
  }

  let buffer: ArrayBuffer | null = null;
  let granuleUrl: string | null = null;
  for (let back = 0; back < maxSlots && !buffer && pass1Viable; back++) {
    const t = new Date(snap.getTime() - back * SLOT_MS);
    const url = buildGldasUrl(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours());
    if (!url) break;
    const buf = await downloadGldasFile(url);
    if (buf) { buffer = buf; granuleUrl = url; }
  }

  // Pass 2 — stream-halt fallback: only for "current" requests.
  if (!buffer && !dateStr) {
    let doy = await latestPublishedDoy(now.getUTCFullYear());
    let year = now.getUTCFullYear();
    if (doy == null && year > 2000) { // nothing this year — try Dec of prior year
      year -= 1;
      doy = await latestPublishedDoy(year);
    }
    if (doy != null) {
      const hit = await fetchLatestSlotForDoy(year, doy);
      if (hit) { buffer = hit.buffer; granuleUrl = hit.url; }
    }
  }
  if (!buffer) return DEFAULT_FALLBACK;

  // Granule timestamp for provenance (…A<yyyymmdd>.<hhmm>.021.nc4)
  const gm = granuleUrl?.match(/A(\d{8})\.(\d{4})\./);
  const granuleTag = gm ? `${gm[1].slice(0, 4)}-${gm[1].slice(4, 6)}-${gm[1].slice(6, 8)}T${gm[2].slice(0, 2)}:00Z` : '';

  try {
    const h5 = await import('h5wasm');
    await h5.ready;
    const tmpPath = `/tmp/gldas_${Date.now()}.h5`;
    h5.FS!.writeFile(tmpPath, new Uint8Array(buffer));
    const h5File = new h5.File(tmpPath, 'r');

    const latIdx = Math.max(0, Math.min(GLDAS_LATS - 1, latToIndex(lat)));
    const lonIdx = Math.max(0, Math.min(GLDAS_LONS - 1, lonToIndex(lon)));

    const result: GldasPointData = {
      // NOTE: 'TkeDiss_tavg' is not a native GLDAS Noah variable — the read
      // returns null for real files. A physically-grounded ε estimate from
      // fetched weather (u*, z₀, z_i) is applied in mapInputs case 8 below.
      tkeDissipation: readGridScalar(h5File, 'TkeDiss_tavg', latIdx, lonIdx),
      soilMoisture0_10: readGridScalar(h5File, 'SoilMoi0_10cm_inst', latIdx, lonIdx),
      soilMoisture10_40: readGridScalar(h5File, 'SoilMoi10_40cm_inst', latIdx, lonIdx),
      soilMoisture40_100: readGridScalar(h5File, 'SoilMoi40_100cm_inst', latIdx, lonIdx),
      soilMoisture100_200: readGridScalar(h5File, 'SoilMoi100_200cm_inst', latIdx, lonIdx),
      groundwaterStorage: readGridScalar(h5File, 'GWwb_inst', latIdx, lonIdx),
      snowWaterEquivalent: readGridScalar(h5File, 'SWE_inst', latIdx, lonIdx),
      canopyInterception: readGridScalar(h5File, 'CanopInt_inst', latIdx, lonIdx),
      surfaceTemp: readGridScalar(h5File, 'AvgSurfT_inst', latIdx, lonIdx),
      source: granuleTag ? `gldas-noah-2.1 (granule ${granuleTag})` : 'gldas-noah-2.1',
      granuleTime: granuleTag || null,
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
