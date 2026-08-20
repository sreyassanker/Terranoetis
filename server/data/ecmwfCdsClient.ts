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

// CDS limits concurrent jobs per account (~2 running; extras queue server-side
// or are rejected). fetchEra5HighFidelity fires up to 8 parallel requests, so
// we serialize job submission/polling client-side to keep every job inside
// the account's running limit instead of starving each other.
let cdsInFlight = 0;
const CDS_MAX_CONCURRENT = 2;
const cdsQueue: Array<() => void> = [];

async function runCdsJob<T>(fn: () => Promise<T>): Promise<T> {
  if (cdsInFlight >= CDS_MAX_CONCURRENT) {
    await new Promise<void>(resolve => cdsQueue.push(resolve));
  }
  cdsInFlight++;
  try {
    return await fn();
  } finally {
    cdsInFlight--;
    const next = cdsQueue.shift();
    if (next) next();
  }
}

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

  return runCdsJob(async () => {
    const cachedAgain = cache.get<ArrayBuffer>(ck);
    if (cachedAgain) return cachedAgain;
    return fetchCdsNetCdfInner(params, ck);
  });
}

async function fetchCdsNetCdfInner(
  params: CdsRequestParams,
  ck: string,
): Promise<ArrayBuffer | null> {
  const body: Record<string, unknown> = {
    inputs: {
      variable: params.variables,
      product_type: [params.product_type ?? 'reanalysis'],
      year: params.years,
      month: params.months,
      day: params.days,
      time: params.times,
      // CDS v1 API: `format` selects the output format for ERA5 datasets
      // (`download_format` is silently ignored and yields GRIB). `area`
      // must be the array [north, west, south, east] — the legacy
      // "N/S/E/W" string form is rejected and fails the job.
      format: params.format === 'netcdf' ? 'netcdf' : 'grib',
      ...(params.area ? {
        area: [params.area.north, params.area.west, params.area.south, params.area.east],
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
    if (jobStatus === 'failed' || jobStatus === 'rejected' || jobStatus === 'cancelled') {
      console.warn(`[CDS] job ${jobUrl} ${jobStatus}`);
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
  let buffer: ArrayBuffer | ArrayBuffer[];

  // Detect ZIP (PK\003\004) and unpack if needed — ERA5-Land returns ZIP'd NetCDF.
  // A single CDS job that mixes accumulated and instant variables yields a ZIP
  // with MULTIPLE NetCDF files (one per stepType), so return every .nc file and
  // let the reader probe each one for the requested variable.
  const header = new Uint8Array(raw.slice(0, 4));
  if (header[0] === 0x50 && header[1] === 0x4B) {
    try {
      const zip = new AdmZip(Buffer.from(raw));
      const entries = zip.getEntries();
      const ncs = entries.filter((e: { entryName: string }) => e.entryName.endsWith('.nc'));
      if (ncs.length === 0) {
        console.warn('[CDS] ZIP has no .nc file');
        cache.set(ck, raw);
        return raw;
      }
      const buffers = ncs.map((nc) => {
        const buf = nc.getData() as Buffer;
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      });
      buffer = buffers.length === 1 ? buffers[0] : buffers;
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
 * The buffer may be an array of NetCDFs (mixed stepType ZIP) — probe each file.
 */
async function readVariable(buffer: ArrayBuffer | ArrayBuffer[], varName: string): Promise<Float32Array | null> {
  if (Array.isArray(buffer)) {
    for (const b of buffer) {
      const val = await readVariable(b, varName);
      if (val !== null) return val;
    }
    return null;
  }
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

/**
 * Resolve the effective ERA5 query date. A caller-supplied date (YYYY-MM-DD)
 * is honoured when it is a valid past/present date; otherwise (missing,
 * malformed, or future — ERA5 has ~5 day publication latency) the
 * documented 6-months-ago window is used. The resolved date is returned as
 * an ISO string so fetchers can include it in cache keys and provenance.
 */
function resolveCdsDate(dateStr?: string): { year: string; month: string; day: string; iso: string } {
  if (dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
    if (m) {
      const isoToday = todayStr();
      // Reject future dates (ERA5 cannot contain them) — fall back honestly.
      if (dateStr.slice(0, 10) <= isoToday) {
        return { year: m[1], month: m[2], day: m[3], iso: dateStr.slice(0, 10) };
      }
    }
  }
  const w = recentDateWindow();
  return { ...w, iso: `${w.year}-${w.month}-${w.day}` };
}

const ERA5_SINGLE = 'reanalysis-era5-single-levels';

/**
 * Fetch ERA5 friction velocity (zust) at a point.
 * Units: m/s. Used by Monin-Obukhov wind profile (Eqs 48-49).
 * The requested date is honoured (input-filter rule); future/missing dates
 * resolve to the documented 6-months-ago window (ERA5 publication latency).
 */
export async function fetchEra5FrictionVelocity(
  lat: number, lon: number, dateStr?: string,
): Promise<number | null> {
  const { year, month, day, iso } = resolveCdsDate(dateStr);
  const cacheKey = `era5:ustar:${lat.toFixed(3)}:${lon.toFixed(3)}:${iso}`;
  const cached = cache.get<number>(cacheKey);
  if (cached !== undefined) return cached;

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
 * Fetch ERA5 10 m wind speed at a point (genuine reanalysis, single job).
 * Units: m/s. Reads the 10m_u_component_of_wind / 10m_v_component_of_wind
 * variables and returns the scalar speed √(u²+v²). Used by Tool 56
 * (Wanninkhof 1992) for k = 0.31·u₁₀²·(Sc/660)^(−1/2). The requested date is
 * honoured (input-filter rule); future/missing dates resolve to the
 * documented 6-months-ago window (ERA5 publication latency).
 */
export async function fetchEra5Wind10m(
  lat: number, lon: number, dateStr?: string,
): Promise<number | null> {
  const { year, month, day, iso } = resolveCdsDate(dateStr);
  const cacheKey = `era5:wind10:${lat.toFixed(3)}:${lon.toFixed(3)}:${iso}`;
  const cached = cache.get<number>(cacheKey);
  if (cached !== undefined) return cached;

  const buffer = await fetchCdsNetCdf({
    dataset: ERA5_SINGLE,
    variables: ['10m_u_component_of_wind', '10m_v_component_of_wind'],
    area: pointArea(lat, lon),
    years: [year],
    months: [month],
    days: [day],
    times: ['12:00'],
    format: 'netcdf',
  });
  if (!buffer) return null;

  const u = await readPoint(buffer, 'u10');
  const v = await readPoint(buffer, 'v10');
  const result = u !== null && v !== null && Number.isFinite(u) && Number.isFinite(v)
    ? Math.sqrt(u * u + v * v)
    : null;
  if (result !== null) cache.set(cacheKey, result);
  return result;
}

/**
 * Fetch ERA5 significant wave height (swh), peak wave period (pp1d) and mean
 * wave direction (mwd) at a point — the paper's deep-water H₀/T₀ for
 * Stockdon et al. (2006) runup (Tool 74) and the CERC longshore-transport
 * inputs H₀s/α₀ (Tool 77, Shore Protection Manual 1984 eqs 4-44/4-45). ONE
 * CDS single-levels job (swh + pp1d + mwd together); units m, s and degrees
 * (mwd = direction FROM which waves come, meteorological convention, °
 * clockwise from north). Genuine reanalysis — never proxied. The requested
 * date is honoured (input-filter rule); future/missing dates resolve to the
 * documented 6-months-ago window (ERA5 publication latency). Returns null
 * when the job fails so consumers can NaN-fire honestly (zero-fallback rule).
 */
export async function fetchEra5WaveClimate(
  lat: number, lon: number, dateStr?: string,
): Promise<{ swh: number; pp1d: number; mwd: number | null; asOfDate: string } | null> {
  const { year, month, day, iso } = resolveCdsDate(dateStr);
  const cacheKey = `era5:wave:${lat.toFixed(3)}:${lon.toFixed(3)}:${iso}`;
  const cached = cache.get<{ swh: number; pp1d: number; mwd: number | null; asOfDate: string }>(cacheKey);
  if (cached !== undefined) return cached;

  const buffer = await fetchCdsNetCdf({
    dataset: ERA5_SINGLE,
    variables: [
      'significant_height_of_combined_wind_waves_and_swell',
      'peak_wave_period',
      'mean_wave_direction',
    ],
    area: pointArea(lat, lon),
    years: [year],
    months: [month],
    days: [day],
    times: ['12:00'],
    format: 'netcdf',
  });
  if (!buffer) return null;

  const swh = await readPoint(buffer, 'swh');
  const pp1d = await readPoint(buffer, 'pp1d');
  if (swh === null || pp1d === null || !Number.isFinite(swh) || !Number.isFinite(pp1d)
    || swh <= 0 || pp1d <= 0) return null;
  const mwd = await readPoint(buffer, 'mwd');
  const result = {
    swh,
    pp1d,
    mwd: mwd !== null && Number.isFinite(mwd) && mwd >= 0 && mwd <= 360 ? mwd : null,
    asOfDate: iso,
  };
  cache.set(cacheKey, result);
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
 *
 * Conventions (verified empirically against raw ERA5 output, N. Atlantic
 * 42.5°N 44°W, 2024-06-15 12Z):
 *   - Gill (1982) budget: Q_net = Q_s − Q_b − Q_h − Q_e, positive = ocean
 *     heat gain.
 *   - Q_s  = absorbed shortwave          = ERA5 `ssr` (net solar rad.)
 *   - Q_b  = net upward longwave         = − ERA5 `str` (net thermal rad.)
 *          — `str` is negative-upward by IFS convention, so Q_b = −str
 *          (empirically: skin SST 295 K, LW↓=361.6 → Q_b = +69.7 W/m²,
 *           and −str = +69.65 ✓)
 *   - Q_h  = sensible heat lost by ocean = − ERA5 `sshf` (sensible flux,
 *            positive downward by IFS convention)
 *   - Q_e  = latent heat lost by ocean   = − ERA5 `slhf` (latent flux,
 *            positive downward by IFS convention)
 *
 * ERA5 stores fluxes as accumulated J/m² since the start of the forecast
 * step (hourly steps in this request) — divide by 3600 to get W/m².
 */
export interface Era5SurfaceFluxes {
  netShortwave: number | null;  // W/m², Gill Q_s (absorbed SW)
  netLongwave: number | null;   // W/m², Gill Q_b (net upward LW)
  sensibleFlux: number | null;  // W/m², Gill Q_h (ocean loss, +up)
  latentFlux: number | null;    // W/m², Gill Q_e (ocean loss, +up)
  airTemp2m: number | null;     // K, genuine ERA5 2 m temperature (same step as fluxes)
  surfacePressure: number | null; // Pa, genuine ERA5 surface pressure (same step as fluxes)
  /** Downward surface solar radiation `ssrd` (W/m², ERA5 accumulated ÷3600).
   *  Incident irradiance at the surface / canopy top — authentic source for
   *  Tool 52 (Monsi–Saeki Beer-Lambert I₀), never substituted by a proxy. */
  downwardShortwave: number | null;
  asOfDate?: string;            // ISO date the fluxes were resolved for (provenance)
}

export async function fetchEra5SurfaceFluxes(
  lat: number, lon: number, dateStr?: string,
  opts?: { dailyMean?: boolean },
): Promise<Era5SurfaceFluxes | null> {
  const { year, month, day, iso } = resolveCdsDate(dateStr);
  const cacheKey = `era5:flux:${lat.toFixed(3)}:${lon.toFixed(3)}:${iso}:${opts?.dailyMean ? 'dm' : 'snap'}`;
  const cached = cache.get<Era5SurfaceFluxes>(cacheKey);
  if (cached) return cached;

  const buffer = await fetchCdsNetCdf({
    dataset: ERA5_SINGLE,
    variables: [
      'surface_net_solar_radiation',
      'surface_net_thermal_radiation',
      'surface_sensible_heat_flux',
      'surface_latent_heat_flux',
      'surface_solar_radiation_downwards',
      '2m_temperature',
      'surface_pressure',
    ],
    area: pointArea(lat, lon),
    years: [year],
    months: [month],
    days: [day],
    // Tool 59 (Priestley–Taylor) needs the paper's 24-hr MEAN net
    // radiation, not a noon snapshot (a single 12:00 UTC hour is before
    // dawn in the Americas and gives a negative net-radiation artefact).
    // Requesting all 24 hourly steps and averaging in readPoint() yields
    // the genuine daily mean — one CDS job, no extra latency. Tool 52
    // (Gill ocean budget) keeps the 12:00 UTC snapshot via default false.
    times: opts?.dailyMean
      ? Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
      : ['12:00'],
    format: 'netcdf',
  });
  if (!buffer) return null;

  const ssr = await readPoint(buffer, 'ssr');   // J/m² accumulated, net solar
  const str = await readPoint(buffer, 'str');   // J/m² accumulated, net thermal (neg-upward)
  const sshf = await readPoint(buffer, 'sshf'); // J/m² accumulated, sensible (pos-downward)
  const slhf = await readPoint(buffer, 'slhf'); // J/m² accumulated, latent   (pos-downward)
  const ssrd = await readPoint(buffer, 'ssrd'); // J/m² accumulated, downward solar (incident)
  const t2m = await readPoint(buffer, 't2m');   // K, instantaneous
  const sp = await readPoint(buffer, 'sp');     // Pa, instantaneous

  const result: Era5SurfaceFluxes = {
    netShortwave: ssr !== null && Number.isFinite(ssr) ? ssr / 3600 : null,
    netLongwave: str !== null && Number.isFinite(str) ? -str / 3600 : null,
    sensibleFlux: sshf !== null && Number.isFinite(sshf) ? -sshf / 3600 : null,
    latentFlux: slhf !== null && Number.isFinite(slhf) ? -slhf / 3600 : null,
    downwardShortwave: ssrd !== null && Number.isFinite(ssrd) ? ssrd / 3600 : null,
    airTemp2m: t2m !== null && Number.isFinite(t2m) ? t2m : null,
    surfacePressure: sp !== null && Number.isFinite(sp) ? sp : null,
    asOfDate: iso,
  };
  cache.set(cacheKey, result);
  return result;
}

/**
 * Fetch the complete Monin-Obukhov Similarity Theory input set (Tool 48)
 * in ONE CDS job: friction velocity `zust`, accumulated sensible heat flux
 * `sshf`, 2 m temperature `t2m` and surface pressure `sp` of the same
 * single-level reanalysis step at the requested date (input-filter rule).
 * A single job keeps the fetch inside the consumer budget (the full
 * 8-job parallel batch serializes at concurrency 2 and can exceed it).
 */
export interface Era5MostInput {
  ustar: number | null;          // m/s (zust)
  sensibleFlux: number | null;   // W/m², positive upward = −sshf/3600
  airTemp2m: number | null;      // K
  surfacePressure: number | null; // Pa
  rh2m: number | null;           // %, genuine 2 m relative humidity (tool 50)
  asOfDate: string;              // ISO date resolved
}

export async function fetchEra5MostInput(
  lat: number, lon: number, dateStr?: string,
): Promise<Era5MostInput | null> {
  const { year, month, day, iso } = resolveCdsDate(dateStr);
  const cacheKey = `era5:most:${lat.toFixed(3)}:${lon.toFixed(3)}:${iso}`;
  const cached = cache.get<Era5MostInput>(cacheKey);
  if (cached) return cached;

  const buffer = await fetchCdsNetCdf({
    dataset: ERA5_SINGLE,
    variables: [
      'friction_velocity',
      'surface_sensible_heat_flux',
      '2m_temperature',
      'surface_pressure',
      '2m_relative_humidity',
    ],
    area: pointArea(lat, lon),
    years: [year],
    months: [month],
    days: [day],
    times: ['12:00'],
    format: 'netcdf',
  });
  if (!buffer) return null;

  const zust = await readPoint(buffer, 'zust');
  const sshf = await readPoint(buffer, 'sshf'); // J/m² accumulated, pos-downward (IFS)
  const t2m = await readPoint(buffer, 't2m');
  const sp = await readPoint(buffer, 'sp');
  const rh = await readPoint(buffer, 'r');

  const result: Era5MostInput = {
    ustar: zust !== null && Number.isFinite(zust) ? zust : null,
    sensibleFlux: sshf !== null && Number.isFinite(sshf) ? -sshf / 3600 : null,
    airTemp2m: t2m !== null && Number.isFinite(t2m) ? t2m : null,
    surfacePressure: sp !== null && Number.isFinite(sp) ? sp : null,
    rh2m: rh !== null && Number.isFinite(rh) ? rh : null,
    asOfDate: iso,
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
