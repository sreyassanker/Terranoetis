/**
 * ECMWF Climate Data Store (CDS) API v2 Client
 * ── High-fidelity ERA5 reanalysis data for the Analytical Workbench ──
 *
 * Provides variables NOT available through Open-Meteo's ERA5 subset:
 *   - Friction velocity (zust) — Monin-Obukhov wind profile (Eqs 48-49)
 *   - Total column water vapour (tcwv) — split-window LST (Eq 1)
 *   - Pressure-level variables (u, v, w, t, q, z) — dynamics (Eqs 99-107)
 *   - Surface energy fluxes (ssrd, strd, sshf, slhf) — energy budget (Eqs 17, 96)
 *
 * CDS API v2 workflow:
 *   1. POST request → task_id
 *   2. Poll task status until "completed"
 *   3. Download NetCDF → parse with netcdfjs
 *   4. Cache result to avoid redundant API calls
 *
 * The job-based nature means first request for a location is slow (~30-120s).
 * Subsequent requests hit the cache.
 * Falls back gracefully when no CDS_API_TOKEN is configured.
 */

import NodeCache from 'node-cache';
import AdmZip from 'adm-zip';

const CDS_API_BASE = 'https://cds.climate.copernicus.eu/api/retrieve/v1';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // 3 min max
const FETCH_TIMEOUT = 60000;  // 60s per HTTP call

const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 }); // 24h TTL

// Circuit breaker: skip CDS entirely after auth failure to avoid 60s timeouts per request
let cdsFailedOnce = false;
let cdsFailedAt = 0;

interface CdsRequestParams {
  [key: string]: unknown;
  dataset: string;
  variables: string[];
  area?: { north: number; west: number; south: number; east: number };
  years: string[];
  months: string[];
  days: string[];
  times: string[];
  product_type?: string;
  format: 'netcdf' | 'grib';
}

function getToken(): string | null {
  return process.env.CDS_API_TOKEN ?? null;
}

function headers(tokenOverride?: string): Record<string, string> {
  const token = tokenOverride ?? getToken();
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(token ? { 'PRIVATE-TOKEN': token } : {}),
  };
}

function cacheKey(dataset: string, params: Record<string, unknown>): string {
  return `cds:${dataset}:${JSON.stringify(params)}`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Submit a request to CDS v3 and poll until completion.
 * CDS v3 workflow:
 *   1. POST /api/retrieve/v1/processes/{dataset}/execute → 201 + Location header (job URL)
 *   2. Poll job URL until status "successful"
 *   3. GET {jobUrl}/results → download URL
 *   4. Download data
 */
export async function fetchCdsNetCdf(
  params: CdsRequestParams,
): Promise<ArrayBuffer | null> {
  // Auto-reset circuit breaker after 5 minutes for transient failures
  if (cdsFailedOnce && Date.now() - cdsFailedAt > 300000) {
    cdsFailedOnce = false;
    cdsFailedAt = 0;
  }
  if (cdsFailedOnce) return null;
  const token = getToken();
  if (!token) return null;

  const ck = cacheKey(params.dataset, params);
  const cached = cache.get<ArrayBuffer>(ck);
  if (cached) return cached;

  const body: Record<string, unknown> = {
    inputs: {
      variable: params.variables,
      product_type: [params.product_type ?? 'reanalysis'],
      year: params.years,
      month: params.months,
      day: params.days,
      time: params.times,
      format: params.format === 'netcdf' ? 'netcdf' : 'grib',
      ...(params.area ? {
        area: `${params.area.north}/${params.area.south}/${params.area.east}/${params.area.west}`,
      } : {}),
    },
  };

  const submitResp = await fetch(
    `${CDS_API_BASE}/processes/${params.dataset}/execute`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!submitResp.ok) {
    const errText = await submitResp.text().catch(() => 'unknown');
    console.warn(`[CDS] submit failed (${submitResp.status}): ${errText.slice(0, 200)}`);
    // Only circuit-break for auth errors, not transient 5xx
    if (submitResp.status === 401 || submitResp.status === 403) {
      cdsFailedOnce = true;
      cdsFailedAt = Date.now();
    }
    return null;
  }

  const submitBody = await submitResp.json() as { jobID?: string; status?: string; links?: Array<{ rel: string; href: string }> };
  const monitorLink = submitBody?.links?.find(l => l.rel === 'monitor');
  const jobUrl = monitorLink?.href ?? submitResp.headers.get('location');
  if (!jobUrl) {
    console.warn('[CDS] no job URL in submit response');
    return null;
  }

  // Poll job URL until successful
  let jobStatus: string = submitBody?.status ?? 'accepted';
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    if (jobStatus === 'successful') break;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const pollResp = await fetch(jobUrl, {
      headers: headers(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT / 2),
    });
    if (!pollResp.ok) {
      console.warn(`[CDS] poll failed (${pollResp.status}) for job ${jobUrl}`);
      continue;
    }
    const job = await pollResp.json() as { status: string };
    jobStatus = job.status;
    if (jobStatus === 'failed') {
      console.warn(`[CDS] job ${jobUrl} failed`);
      return null;
    }
  }

  if (jobStatus !== 'successful') {
    console.warn(`[CDS] job ${jobUrl} timed out with status ${jobStatus}`);
    return null;
  }

  // Get download URL
  const resultsResp = await fetch(`${jobUrl}/results`, {
    headers: headers(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT / 2),
  });
  if (!resultsResp.ok) {
    console.warn(`[CDS] results fetch failed (${resultsResp.status})`);
    return null;
  }
  const results = await resultsResp.json() as { asset?: { value?: { href?: string } } } | Array<{ href?: string }>;
  const downloadUrl = Array.isArray(results)
    ? results[0]?.href
    : results?.asset?.value?.href;
  if (!downloadUrl) {
    console.warn('[CDS] no download URL in results');
    return null;
  }

  // Download results (no auth needed for download URL)
  const downloadResp = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT * 2),
  });
  if (!downloadResp.ok) {
    console.warn(`[CDS] download failed (${downloadResp.status})`);
    return null;
  }

  const raw = await downloadResp.arrayBuffer();
  let buffer: ArrayBuffer;

  // Detect ZIP (PK\003\004) and unpack if needed — ERA5-Land returns ZIP'd NetCDF
  const header = new Uint8Array(raw.slice(0, 4));
  if (header[0] === 0x50 && header[1] === 0x4B) {
    try {
      const zip = new AdmZip(Buffer.from(raw));
      const entries = zip.getEntries();
      const nc = entries.find((e: { entryName: string }) => e.entryName.endsWith('.nc'));
      if (nc) {
        const buf = nc.getData() as Buffer;
        buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      } else {
        console.warn('[CDS] ZIP has no .nc file');
        cache.set(ck, raw);
        return raw;
      }
    } catch (e) {
      console.warn(`[CDS] ZIP extraction failed: ${(e as Error).message.slice(0, 100)}`);
      cache.set(ck, raw);
      return raw;
    }
  } else {
    buffer = raw;
  }

  cache.set(ck, buffer);
  return buffer;
}

// Lazy h5wasm singleton (same pattern as IMERG)
let _h5wasmCds: typeof import('h5wasm') | null = null;
async function getH5wasm() {
  if (!_h5wasmCds) {
    _h5wasmCds = await import('h5wasm');
    await _h5wasmCds.ready;
  }
  return _h5wasmCds;
}

let _readVarCounter = 0;

/**
 * Parse a NetCDF-4 (HDF5) buffer and extract a named variable as Float32Array.
 * Variables are stored at root level with ECMWF short names (e.g. tcwv, zust, u10).
 */
async function readVariable(buffer: ArrayBuffer, varName: string): Promise<Float32Array | null> {
  const tmpPath = `/tmp/cds_${_readVarCounter++}.h5`;
  try {
    const h5 = await getH5wasm();
    // Defensive copy — ensure buffer is not detached
    const copy = new Uint8Array(buffer.byteLength);
    copy.set(new Uint8Array(buffer));
    h5.FS!.writeFile(tmpPath, copy);
    const file = new h5.File(tmpPath, 'r');
    const item = file.get(varName) as { value: number[] } | null;
    const val = item?.value;
    file.close();
    h5.FS!.unlink(tmpPath);
    if (val === undefined || val === null) return null;
    if (val instanceof Float32Array) return val;
    if (val instanceof Float64Array) return new Float32Array(val);
    if (Array.isArray(val)) return new Float32Array(val);
    return null;
  } catch {
    try { (await getH5wasm())!.FS!.unlink(tmpPath); } catch { /* ignore cleanup errors */ }
    return null;
  }
}

/**
 * Get a single numeric value for a variable at a point.
 * Averages over all grid cells if area > single point.
 */
async function readPoint(buffer: ArrayBuffer, varName: string): Promise<number | null> {
  const data = await readVariable(buffer, varName);
  if (!data) return null;
  let sum = 0, n = 0;
  for (let i = 0; i < data.length; i++) {
    if (Number.isFinite(data[i])) { sum += data[i]; n++; }
  }
  return n > 0 ? sum / n : null;
}

// ══════════════════════════════════════════════════════════════════
//  Specific Data Fetchers
// ══════════════════════════════════════════════════════════════════

/** Default area window (0.5 deg around point — ~55 km, covers >1 ERA5 grid cell) */
function pointArea(lat: number, lon: number) {
  const d = 0.25;
  return { north: lat + d, west: lon - d, south: lat - d, east: lon + d };
}

function recentDateWindow(): { year: string; month: string; day: string } {
  // ERA5 reanalysis has ~3 month latency; use 6 months ago for safety
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return {
    year: String(d.getFullYear()),
    month: String(d.getMonth() + 1).padStart(2, '0'),
    day: String(d.getDate()).padStart(2, '0'),
  };
}

const ERA5_SINGLE = 'reanalysis-era5-single-levels';

/**
 * Fetch ERA5 friction velocity (zust) at a point.
 * Units: m/s. Used by Monin-Obukhov wind profile (Eqs 48-49).
 */
export async function fetchEra5FrictionVelocity(
  lat: number, lon: number,
): Promise<number | null> {
  const cacheKey = `era5:ustar:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  const cached = cache.get<number>(cacheKey);
  if (cached !== undefined) return cached;

  const { year, month, day } = recentDateWindow();
  const buffer = await fetchCdsNetCdf({
    dataset: ERA5_SINGLE,
    variables: ['friction_velocity'],
    area: pointArea(lat, lon),
    years: [year],
    months: [month],
    days: [day],
    times: ['12:00'],
    format: 'netcdf',
  });
  if (!buffer) return null;

  const val = await readPoint(buffer, 'zust');
  // Convert from m/s to standard units if needed
  const result = val !== null && Number.isFinite(val) ? val : null;
  if (result !== null) cache.set(cacheKey, result);
  return result;
}

/**
 * Fetch ERA5 total column water vapour (tcwv) at a point.
 * Units: kg/m² = mm → convert to g/cm² (/10).
 * Used by Rozenstein split-window LST (Eq 1).
 */
export async function fetchEra5Tcwv(
  lat: number, lon: number, dateStr?: string,
): Promise<number | null> {
  const date = dateStr ?? todayStr();
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return null;

  const cacheKey = `era5:tcwv:${lat.toFixed(3)}:${lon.toFixed(3)}:${date}`;
  const cached = cache.get<number>(cacheKey);
  if (cached !== undefined) return cached;

  const buffer = await fetchCdsNetCdf({
    dataset: ERA5_SINGLE,
    variables: ['total_column_water_vapour'],
    area: pointArea(lat, lon),
    years: [y],
    months: [m],
    days: [d],
    times: ['10:00', '11:00'], // Landsat overpass window
    format: 'netcdf',
  });
  if (!buffer) return null;

  const val = await readPoint(buffer, 'tcwv');
  // tcwv in kg/m² = mm → g/cm² (/10)
  const result = val !== null && Number.isFinite(val) ? val / 10 : null;
  if (result !== null) cache.set(cacheKey, result);
  return result;
}

/**
 * Fetch ERA5 surface energy fluxes at a point.
 * Returns net shortwave (ssrd), net longwave (strd), sensible (sshf),
 * and latent (slhf) heat fluxes in W/m² or J/m² (accumulated → convert).
 * Used by energy budget equations (Eqs 17, 96).
 *
 * ERA5 stores ssrd/strd as accumulated J/m² since forecast start.
 * Divide by 3600 to get W/m² for hourly data.
 */
export interface Era5SurfaceFluxes {
  netShortwave: number | null;  // W/m²
  netLongwave: number | null;   // W/m²  
  sensibleFlux: number | null;  // W/m²
  latentFlux: number | null;    // W/m²
}

export async function fetchEra5SurfaceFluxes(
  lat: number, lon: number,
): Promise<Era5SurfaceFluxes | null> {
  const { year, month, day } = recentDateWindow();
  const cacheKey = `era5:flux:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  const cached = cache.get<Era5SurfaceFluxes>(cacheKey);
  if (cached) return cached;

  const buffer = await fetchCdsNetCdf({
    dataset: ERA5_SINGLE,
    variables: [
      'surface_solar_radiation_downwards',
      'surface_thermal_radiation_downwards',
      'surface_sensible_heat_flux',
      'surface_latent_heat_flux',
    ],
    area: pointArea(lat, lon),
    years: [year],
    months: [month],
    days: [day],
    times: ['12:00'],
    format: 'netcdf',
  });
  if (!buffer) return null;

  const ssrd = await readPoint(buffer, 'ssrd');   // J/m² accumulated
  const strd = await readPoint(buffer, 'strd');   // J/m² accumulated
  const sshf = await readPoint(buffer, 'sshf');   // J/m² accumulated
  const slhf = await readPoint(buffer, 'slhf');   // J/m² accumulated

  const result: Era5SurfaceFluxes = {
    netShortwave: ssrd !== null && Number.isFinite(ssrd) ? ssrd / 3600 : null,
    netLongwave: strd !== null && Number.isFinite(strd) ? strd / 3600 : null,
    sensibleFlux: sshf !== null && Number.isFinite(sshf) ? sshf / 3600 : null,
    latentFlux: slhf !== null && Number.isFinite(slhf) ? slhf / 3600 : null,
  };
  cache.set(cacheKey, result);
  return result;
}

const ERA5_PRESSURE = 'reanalysis-era5-pressure-levels';


/**
 * Fetch ERA5 pressure-level wind at a point.
 * Returns u and v wind components (m/s) at a specified pressure level.
 * Used by geostrophic wind (Eq 5), vorticity (Eq 107).
 */
export interface Era5PressureWind {
  u: number | null;
  v: number | null;
}

export async function fetchEra5PressureWind(
  lat: number, lon: number,
  level: number = 850, // 850 hPa by default
): Promise<Era5PressureWind | null> {
  const { year, month, day } = recentDateWindow();
  const cacheKey = `era5:pwind:${level}:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  const cached = cache.get<Era5PressureWind>(cacheKey);
  if (cached) return cached;

  const buffer = await fetchCdsNetCdf({
    dataset: ERA5_PRESSURE,
    variables: ['u_component_of_wind', 'v_component_of_wind'],
    area: pointArea(lat, lon),
    years: [year],
    months: [month],
    days: [day],
    times: ['12:00'],
    format: 'netcdf',
    product_type: 'reanalysis',
  });
  if (!buffer) return null;

  const u = await readPoint(buffer, 'u');
  const v = await readPoint(buffer, 'v');

  const result: Era5PressureWind = {
    u: u !== null && Number.isFinite(u) ? u : null,
    v: v !== null && Number.isFinite(v) ? v : null,
  };
  cache.set(cacheKey, result);
  return result;
}

/**
 * Fetch ERA5 pressure-level temperature and geopotential at a point.
 * Used by atmospheric dynamics (Eqs 99-102, 106).
 */
export interface Era5PressureState {
  temperature: number | null;  // K
  geopotential: number | null; // m²/s² → divide by g for height
  specificHumidity: number | null; // kg/kg
  omega: number | null; // Pa/s (vertical velocity)
}

export async function fetchEra5PressureState(
  lat: number, lon: number,
  level: number = 500,
): Promise<Era5PressureState | null> {
  const { year, month, day } = recentDateWindow();
  const cacheKey = `era5:pstate:${level}:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  const cached = cache.get<Era5PressureState>(cacheKey);
  if (cached) return cached;

  const buffer = await fetchCdsNetCdf({
    dataset: ERA5_PRESSURE,
    variables: [
      'temperature',
      'geopotential',
      'specific_humidity',
      'vertical_velocity',
    ],
    area: pointArea(lat, lon),
    years: [year],
    months: [month],
    days: [day],
    times: ['12:00'],
    format: 'netcdf',
    product_type: 'reanalysis',
  });
  if (!buffer) return null;

  const t = await readPoint(buffer, 't');
  const z = await readPoint(buffer, 'z');
  const q = await readPoint(buffer, 'q');
  const w = await readPoint(buffer, 'w');

  const result: Era5PressureState = {
    temperature: t !== null && Number.isFinite(t) ? t : null,
    geopotential: z !== null && Number.isFinite(z) ? z : null,
    specificHumidity: q !== null && Number.isFinite(q) ? q : null,
    omega: w !== null && Number.isFinite(w) ? w : null,
  };
  cache.set(cacheKey, result);
  return result;
}

/**
 * Fetch ERA5 multi-level soil temperature and moisture.
 * Used by Eqs 43-47 (soil physics).
 */
export interface Era5SoilState {
  temperature0_7: number | null;   // K → C (-273.15)
  temperature7_28: number | null;
  temperature28_100: number | null;
  moisture0_7: number | null;      // m³/m³
  moisture7_28: number | null;
  moisture28_100: number | null;
}

const ERA5_SOIL = 'reanalysis-era5-land';

export async function fetchEra5SoilState(
  lat: number, lon: number,
): Promise<Era5SoilState | null> {
  const { year, month, day } = recentDateWindow();
  const cacheKey = `era5:soil:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  const cached = cache.get<Era5SoilState>(cacheKey);
  if (cached) return cached;

  const buffer = await fetchCdsNetCdf({
    dataset: ERA5_SOIL,
    variables: [
      'soil_temperature_level_1',
      'soil_temperature_level_2',
      'soil_temperature_level_3',
      'volumetric_soil_water_layer_1',
      'volumetric_soil_water_layer_2',
      'volumetric_soil_water_layer_3',
    ],
    area: pointArea(lat, lon),
    years: [year],
    months: [month],
    days: [day],
    times: ['12:00'],
    format: 'netcdf',
    product_type: 'reanalysis',
  });
  if (!buffer) return null;

  const result: Era5SoilState = {
    temperature0_7: await readPoint(buffer, 'stl1'),
    temperature7_28: await readPoint(buffer, 'stl2'),
    temperature28_100: await readPoint(buffer, 'stl3'),
    moisture0_7: await readPoint(buffer, 'swvl1'),
    moisture7_28: await readPoint(buffer, 'swvl2'),
    moisture28_100: await readPoint(buffer, 'swvl3'),
  };
  cache.set(cacheKey, result);
  return result;
}

/**
 * Fetch ERA5 geopotential at 500 hPa and 1000 hPa for thickness/steering.
 * Used by Rossby wave (Eq 99), QG PV (Eq 102).
 */
export interface Era5GeopotentialThickness {
  z500: number | null;   // m²/s²
  z1000: number | null;  // m²/s²
}

export async function fetchEra5GeopotentialThickness(
  lat: number, lon: number,
): Promise<Era5GeopotentialThickness | null> {
  const { year, month, day } = recentDateWindow();
  const cacheKey = `era5:geopot:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  const cached = cache.get<Era5GeopotentialThickness>(cacheKey);
  if (cached) return cached;

  const buffer = await fetchCdsNetCdf({
    dataset: ERA5_PRESSURE,
    variables: ['geopotential'],
    area: pointArea(lat, lon),
    years: [year],
    months: [month],
    days: [day],
    times: ['12:00'],
    format: 'netcdf',
    product_type: 'reanalysis',
  });
  if (!buffer) return null;

  const z500 = await readPoint(buffer, 'z');

  const result: Era5GeopotentialThickness = {
    z500: z500 !== null && Number.isFinite(z500) ? z500 : null,
    z1000: null, // would need separate request with pressure_level filter
  };
  cache.set(cacheKey, result);
  return result;
}

export function getCdsStatus(): { tokenConfigured: boolean; cacheSize: number } {
  return {
    tokenConfigured: !!getToken(),
    cacheSize: cache.getStats().ksize ?? 0,
  };
}
