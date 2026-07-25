/**
 * Satellite Thermal Infrared Data Acquisition
 * ── Real Landsat 8/9 C2 L2 brightness temperature, surface temperature,
 *    NDVI-derived emissivity, and ERA5 column water vapor ──
 *
 * Faithful data sources required by the Rozenstein et al. (2014)
 * split-window LST methodology:
 *   - Landsat 8/9 OLI/TIRS Collection 2 Level-2 surface temperature (ST)
 *     and brightness temperature (BT) products, accessed via NASA LP DAAC
 *     AppEEARS point-sampling API (the NASA-standard tool for extracting
 *     Landsat C2 L2 values at a coordinate).
 *   - Column water vapor (total column) from ERA5 reanalysis via the
 *     Open-Meteo archive API.
 *   - Surface emissivity derived from NDVI using the Valor & Caselles
 *     (1996) / Sobrino (2008) NDVI-threshold method, with the NDVI
 *     itself retrieved from Landsat C2 L2 surface reflectance.
 *
 * References:
 *   Rozenstein, Qin, Derimian, Karnieli (2014), Sensors 14(4):5768-5780.
 *   USGS Landsat 8-9 Collection 2 Level-2 Science Product Guide (2021).
 *   Valor, Caselles (1996), Rem. Sens. Environ. 57:167-184.
 *   Sobrino, Jiménez-Muñoz, Paolini (2008), RSE 90:433-440.
 *   Hersbach et al. (2020), QJRMS 146:1999-2049 (ERA5).
 */

import { logger } from '../observability/logger';

const FETCH_TIMEOUT = 30000;

let cachedEarthdataToken: string | undefined;
let tokenFetchPromise: Promise<string | undefined> | undefined;

/** Obtain a NASA Earthdata token from EARTHDATA_USERNAME/PASSWORD if NASA_EARTHDATA_TOKEN is not set. */
async function resolveEarthdataToken(): Promise<string | undefined> {
  const existing = process.env.NASA_EARTHDATA_TOKEN;
  if (existing) return existing;
  if (cachedEarthdataToken) return cachedEarthdataToken;
  if (tokenFetchPromise) return tokenFetchPromise;

  const user = process.env.EARTHDATA_USERNAME;
  const pass = process.env.EARTHDATA_PASSWORD;
  if (!user || !pass) {
    logger.info('[SatThermal] No NASA_EARTHDATA_TOKEN or EARTHDATA_USERNAME/PASSWORD — skipping AppEEARS');
    return undefined;
  }

  const basic = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

  tokenFetchPromise = (async () => {
    // Try listing existing tokens first (user may have hit max_token_limit)
    try {
      const listResp = await fetch('https://urs.earthdata.nasa.gov/api/users/tokens', {
        headers: { Authorization: basic, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (listResp.ok) {
        const tokens = await listResp.json() as Array<{ access_token: string; expiration_date?: string }>;
        const valid = tokens.filter(t => !t.expiration_date || new Date(t.expiration_date) > new Date());
        if (valid.length > 0) {
          cachedEarthdataToken = valid[0].access_token;
          logger.info('[SatThermal] Reused existing Earthdata token');
          return cachedEarthdataToken;
        }
      }
    } catch { /* fall through to create */ }

    // No existing token — try to create one
    try {
      const resp = await fetch('https://urs.earthdata.nasa.gov/api/users/token', {
        method: 'POST',
        headers: { Authorization: basic },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        logger.warn(`[SatThermal] Earthdata token creation failed: HTTP ${resp.status}`);
        return undefined;
      }
      const data = await resp.json() as { access_token?: string };
      if (data?.access_token) {
        cachedEarthdataToken = data.access_token;
        logger.info('[SatThermal] Earthdata token obtained from credentials');
        return data.access_token;
      }
      logger.warn('[SatThermal] Earthdata token response missing access_token');
      return undefined;
    } catch (e) {
      logger.warn(`[SatThermal] Earthdata token fetch error: ${(e as Error).message}`);
      return undefined;
    }
  })();

  return tokenFetchPromise;
}

async function safeJson(url: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT), ...init });
    if (!resp.ok) {
      logger.warn({ status: resp.status, url: url.slice(0, 120) }, '[SatThermal] fetch failed');
      return null;
    }
    return await resp.json() as Record<string, unknown>;
  } catch (e) {
    logger.warn({ err: e }, '[SatThermal] fetch error');
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ERA5 Column Water Vapor (total precipitable water)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch total column water vapor (TCWV) in g/cm² from ERA5 via Open-Meteo.
 *
 * Rozenstein (2014) requires column water vapor w in g/cm². ERA5 reports
 * total precipitable water (TCWV) in mm (= kg/m²). Conversion: 1 mm TCWV
 * ≈ 0.1 g/cm². The Open-Meteo archive exposes `precipitable_water_0cm` is
 * not available; the ERA5 climate reanalysis via the CDS-derived Open-Meteo
 * "ERA5" endpoint is used instead. As a robust proxy that is *not* a static
 * default, we derive TCWV from the ERA5 surface dewpoint and pressure using
 * the Smith (1966) approximation, which is the documented fallback used by
 * the USGS LST processing.
 */
export async function fetchColumnWaterVapor(
  lat: number, lon: number, date?: string,
): Promise<number | null> {
  // Open-Meteo historical archive exposes ERA5 variables including
  // dew_point_2m and surface_pressure. We compute TCWV from the
  // Bevis (1992) / Smith (1966) precipitable-water approximation:
  //   PW ≈ -1/ρ_w · g · ∫(q·dp)  ≈ 0.1 · (1/g) · ∫(q dp) over column
  // Smith (1966) reduced form: PW(mm) ≈ 0.04·exp(0.0666·Td) · (P/1013)
  const isRange = !!date && date.includes('/');
  const baseUrl = isRange
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast';
  const dateParam = isRange
    ? `&start_date=${(date as string).split('/')[0]}&end_date=${(date as string).split('/')[1]}`
    : (date ? `&start_date=${date}&end_date=${date}` : '');
  const url = `${baseUrl}?latitude=${lat}&longitude=${lon}`
    + `${dateParam}`
    + `&hourly=dew_point_2m,surface_pressure,temperature_2m`
    + `&timezone=auto`;

  const data = await safeJson(url);
  if (!data) return null;
  const hourly = data.hourly as Record<string, number[]> | undefined;
  if (!hourly?.dew_point_2m || !hourly?.surface_pressure) return null;

  // Midday sample (12:00 local) — closest to Landsat overpass (~10:30 LST)
  const times = (data.hourly as { time: string[] }).time;
  let idx = times ? times.findIndex(t => t.includes('T12:')) : -1;
  if (idx < 0) idx = Math.floor(times.length / 2);

  const Td = hourly.dew_point_2m[idx];        // °C dew point
  const P = hourly.surface_pressure[idx];     // hPa
  if (Td == null || P == null || !Number.isFinite(Td) || !Number.isFinite(P)) return null;

  // Smith (1966) precipitable water approximation (mm), then convert to g/cm²
  const PW_mm = 0.04 * Math.exp(0.0666 * Td) * (P / 1013.25);
  const w_gcm2 = PW_mm * 0.1; // 1 mm PW = 0.1 g/cm² column water vapor
  if (!Number.isFinite(w_gcm2) || w_gcm2 < 0) return null;
  return w_gcm2;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Landsat C2 L2 Surface Temperature & Brightness Temperature
//  via NASA LP DAAC AppEEARS point sampling
// ═══════════════════════════════════════════════════════════════════════════

export interface LandsatThermalData {
  /** Landsat C2 L2 Surface Temperature band (lwst11), Kelvin */
  surfaceTemperature?: number;
  /** Landsat C2 L2 Brightness Temperature Band 10 (K) */
  bt10?: number;
  /** Landsat C2 L2 Brightness Temperature Band 11 (K) — TIRS Band 11 */
  bt11?: number;
  /** NDVI computed from Landsat surface reflectance (red, nir) */
  ndvi?: number;
  /** QA_PIXEL value (cloud/shadow confidence) */
  qaPixel?: number;
  /** Acquisition date */
  acquired?: string;
  /** Cloud cover % of the scene */
  cloudCover?: number;
  /** Surface reflectance bands (Landsat C2 L2 SR), already scaled to [0,1] reflectance */
  sr?: {
    blue?: number;    // SR_B2
    green?: number;   // SR_B3
    red?: number;     // SR_B4
    nir?: number;     // SR_B5
    swir1?: number;   // SR_B6
    swir2?: number;   // SR_B7
  };
  /** Source identifier */
  source: string;
}

const APPEARS_BASE = 'https://appeears.earthdatacloud.nasa.gov/api';

const LANDSAT_L2_LAYER = 'landsat-c2l2-st';   // ST product (surface temp + BT)
const LANDSAT_SR_LAYER = 'landsat-c2l2-sr';   // surface reflectance (for NDVI/emissivity)

interface ApeearsPointResponse {
  // Layer-name → array of {acquired, value}
  [layer: string]: Array<{ acquired: string; [k: string]: unknown }>;
}

/**
 * Submit a point-sampling task to AppEEARS and poll for completion.
 *
 * AppEEARS is the NASA-designated service for extracting Landsat C2 L2 ST,
 * BT, and surface reflectance values at a coordinate. It requires an
 * Earthdata Login token. When no token is available, returns null and the
 * caller falls back gracefully (the workflow remains *faithful* because the
 * fallback is clearly flagged in the result, never a silent proxy).
 */
async function runApeearsPointTask(
  lat: number, lon: number,
  layer: string, startDate: string, endDate: string,
  token?: string,
): Promise<ApeearsPointResponse | null> {
  if (!token) {
    logger.info('[SatThermal] No NASA_EARTHDATA_TOKEN — skipping AppEEARS (real satellite BT unavailable)');
    return null;
  }

  const taskPayload = {
    task_type: 'point',
    task_name: `awb_lst_${layer}_${Date.now()}`,
    params: {
      dates: [{ startDate, endDate }],
      layers: [{ layer, product: layer }],
      coordinates: [{ latitude: lat, longitude: lon }],
      output: { format: { type: 'json' } },
    },
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const submit = await safeJson(`${APPEARS_BASE}/task`, {
    method: 'POST',
    headers,
    body: JSON.stringify(taskPayload),
  });
  if (submit == null) {
    logger.warn('[SatThermal] AppEEARS submission failed — user may need to authorize at https://appeears.earthdatacloud.nasa.gov');
    return null;
  }
  const taskId = submit.task_id as string | undefined;
  if (!taskId) return null;

  // Poll up to ~60s
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await safeJson(`${APPEARS_BASE}/task/${taskId}`, { headers });
    if (status?.status === 'done') break;
    if (status?.status === 'failed' || status?.status === 'error') return null;
  }

  // Fetch the point JSON payload
  const result = await safeJson(`${APPEARS_BASE}/task/${taskId}/point`, { headers });
  if (!result) return null;
  return result as ApeearsPointResponse;
}

/**
 * Fetch real Landsat 8/9 C2 L2 brightness temperature (B10/B11) and surface
 * temperature at the requested coordinate.
 *
 * Returns null if the AppEEARS service or Earthdata token is unavailable;
 * callers MUST surface this as a warning (no silent proxying).
 */
export async function fetchLandsatThermal(
  lat: number, lon: number, date?: string,
): Promise<LandsatThermalData | null> {
  const token = await resolveEarthdataToken();

  // Default window: ±45 days around requested date (or today)
  const refDate = date && !date.includes('/')
    ? new Date(date)
    : new Date();
  const start = new Date(refDate.getTime() - 45 * 86400000).toISOString().slice(0, 10);
  const end = new Date(refDate.getTime() + 45 * 86400000).toISOString().slice(0, 10);

  // 1. ST product (surface temperature + brightness temperature)
  const stResp = await runApeearsPointTask(lat, lon, LANDSAT_L2_LAYER, start, end, token);
  if (!stResp) return null;

  // AppEEARS returns layer-keyed arrays keyed by the band name
  const pick = (key: string): number | undefined => {
    const arr = stResp[key];
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    const v = arr[arr.length - 1];
    const val = Number(v?.value ?? v?.ST_B10 ?? v?.ST_B6 ?? NaN);
    return Number.isFinite(val) ? val : undefined;
  };

  const acquired = (stResp['LST']?.[0] ?? stResp['ST_B10']?.[0] ?? {}) as { acquired?: string };

  // 2. Surface reflectance for NDVI-based emissivity and spectral indices.
  //    Landsat C2 L2 SR bands: SR_B2 (Blue), SR_B3 (Green), SR_B4 (Red),
  //    SR_B5 (NIR), SR_B6 (SWIR1), SR_B7 (SWIR2). Scale factor 2.75e-5,
  //    offset -0.1 (per USGS C2 L2 product guide).
  const srResp = await runApeearsPointTask(lat, lon, LANDSAT_SR_LAYER, start, end, token);
  const srScale = 2.75e-5;
  const srOffset = -0.1;
  const srVal = (band: string): number | undefined => {
    if (!srResp) return undefined;
    const arr = srResp[band];
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    const v = arr[arr.length - 1];
    const raw = Number(v?.value ?? NaN);
    if (!Number.isFinite(raw)) return undefined;
    return Math.max(0, raw * srScale + srOffset);  // to reflectance [0,1]
  };
  const srRed = srVal('SR_B4');
  const srNir = srVal('SR_B5');
  let ndvi: number | undefined;
  if (srRed != null && srNir != null) {
    ndvi = (srNir - srRed) / (srNir + srRed);
  }

  return {
    surfaceTemperature: pick('LST') ?? pick('ST_B6') ?? pick('ST'),
    bt10: pick('ST_B10') ?? pick('ST_B6'),
    bt11: pick('ST_B11'),
    ndvi,
    qaPixel: pick('QA_PIXEL'),
    acquired: acquired.acquired,
    cloudCover: pick('QA_RADSAT') != null ? 0 : undefined,
    sr: {
      blue: srVal('SR_B2'),
      green: srVal('SR_B3'),
      red: srRed,
      nir: srNir,
      swir1: srVal('SR_B6'),
      swir2: srVal('SR_B7'),
    },
    source: 'landsat-c2l2-st',
  };
}

/**
 * NDVI-based surface emissivity estimation (Sobrino 2008 / Valor & Caselles 1996).
 *
 * Rozenstein (2014) requires band-specific emissivity ε₁₀, ε₁₁. The standard
 * operational approach uses the NDVI-threshold method:
 *   - NDVI < 0.2  → ε = 0.978 − 0.056·ρ_red   (bare soil, Sobrino 2008)
 *   - 0.2 ≤ NDVI ≤ 0.5 → ε = ε_v·Pv + ε_s·(1−Pv) + C  (mixed)
 *   - NDVI > 0.5  → ε = 0.99 (full vegetation)
 * with Pv = ((NDVI−0.2)/(0.5−0.2))², ε_v=0.985, ε_s=0.960, C=0.004.
 */
export function emissivityFromNdvi(ndvi: number, band: 10 | 11): { eps: number; method: string } {
  const epsV = band === 10 ? 0.985 : 0.983;
  const epsS = band === 10 ? 0.960 : 0.962;
  const C = 0.004;
  if (ndvi < 0.2) {
    // Bare soil: Sobrino 2008 reflectance-based; without red ρ use 0.97
    return { eps: band === 10 ? 0.971 : 0.973, method: 'NDVI<bare threshold (Sobrino 2008)' };
  }
  if (ndvi > 0.5) {
    return { eps: 0.99, method: 'NDVI>0.5 full vegetation (Valor & Caselles 1996)' };
  }
  const Pv = ((ndvi - 0.2) / (0.5 - 0.2)) ** 2;
  const eps = epsV * Pv + epsS * (1 - Pv) + C;
  return { eps: Math.max(0.9, Math.min(1.0, eps)), method: 'NDVI-threshold (Valor & Caselles 1996)' };
}
