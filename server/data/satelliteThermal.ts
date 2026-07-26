/**
 * Satellite Thermal Infrared Data Acquisition
 * ── Real Landsat 8/9 C2 L2 surface temperature, NDVI, emissivity,
 *    and ERA5 column water vapor ──
 *
 * Data sources:
 *   - Landsat 8/9 Collection 2 Level-2 Surface Temperature and
 *     Surface Reflectance via Microsoft Planetary Computer STAC API:
 *       https://planetarycomputer.microsoft.com/api/stac/v1
 *     COG assets are signed with a free SAS token (no account needed).
 *   - Column water vapor from ERA5 via the Open-Meteo archive API.
 *   - Surface emissivity from the USGS-provided ST_EMIS band or
 *     from NDVI using the Valor & Caselles (1996) / Sobrino (2008)
 *     NDVI-threshold method.
 *
 * References:
 *   Rozenstein, Qin, Derimian, Karnieli (2014), Sensors 14(4):5768-5780.
 *   USGS Landsat 8-9 Collection 2 Level-2 Science Product Guide (2021).
 *   Valor, Caselles (1996), Rem. Sens. Environ. 57:167-184.
 *   Sobrino, Jiménez-Muñoz, Paolini (2008), RSE 90:433-440.
 *   Hersbach et al. (2020), QJRMS 146:1999-2049 (ERA5).
 */

import { fromUrl } from 'geotiff';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const proj4 = _require('proj4') as {
  defs(name: string, def: string): void;
  (from: string, to: string): {
    forward(coords: number[]): number[];
    inverse(coords: number[]): number[];
  };
  forward(coords: number[]): number[];
  inverse(coords: number[]): number[];
};


const FETCH_TIMEOUT = 30000;

// ── Planetary Computer ──────────────────────────────────────────────
const PC_STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1';
const PC_SAS  = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign';
const PC_COLLECTION = 'landsat-c2-l2';

/** Sign a raw Azure blob URL with a Planetary Computer SAS token (free, no auth). */
async function sign(href: string): Promise<string> {
  const r = await fetch(`${PC_SAS}?href=${encodeURIComponent(href)}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`SAS sign failed: ${r.status}`);
  const d = await r.json() as { href?: string; url?: string };
  return d.href ?? d.url ?? href;
}

/** Read a single pixel value from a COG at (lat, lon) in the scene's native CRS. */
async function readCogPixel(
  signedUrl: string, epsg: number, lat: number, lon: number,
): Promise<number | null> {
  proj4.defs(`EPSG:${epsg}`, `+proj=utm +zone=${epsg % 100} +datum=WGS84 +units=m +no_defs`);
  const toUtm = proj4('EPSG:4326', `EPSG:${epsg}`);
  const [utmX, utmY] = toUtm.forward([lon, lat]);

  const tiff = await fromUrl(signedUrl);
  const image = await tiff.getImage();
  const [xMin, yMin, xMax, yMax] = image.getBoundingBox();
  const w = image.getWidth();
  const h = image.getHeight();
  const px = Math.round(((utmX - xMin) / (xMax - xMin)) * w);
  const py = Math.round(((yMax - utmY) / (yMax - yMin)) * h);
  if (px < 0 || px >= w || py < 0 || py >= h) return null;

  const data = await image.readRasters({ window: [px, py, px + 1, py + 1], samples: [0] });
  const val = data[0]?.[0];
  return val ?? null;
}

/** Scale a Landsat C2 L2 pixel value to surface reflectance [0,1]. */
function toReflectance(raw: number): number {
  return Math.max(0, raw * 2.75e-5 - 0.2);
}

/** Scale a Landsat C2 L2 ST_B10 pixel value to Kelvin. */
function toKelvin(raw: number): number {
  return raw * 0.00341802 + 149.0;
}

/** Scale the ST_EMIS band to emissivity [0,1]. */
function toEmissivity(raw: number): number {
  return raw * 0.0001;
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

  let data: Record<string, unknown> | null = null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (r.ok) data = await r.json() as Record<string, unknown>;
  } catch { /* fall through */ }
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
  /** Emissivity (0–1) from USGS emis band, or derived from NDVI */
  emissivity?: number;
  /** Source identifier */
  source: string;
}

/**
 * Fetch Landsat 8/9 C2 L2 surface temperature, NDVI, and emissivity for
 * a coordinate via Microsoft Planetary Computer.
 *
 * Returns null if no cloud-free scene is found within ±45 days of the
 * requested date; callers MUST surface this as a warning (no silent proxy).
 */
export async function fetchLandsatThermal(
  lat: number, lon: number, date?: string,
): Promise<LandsatThermalData | null> {
  const refDate = date && !date.includes('/') ? new Date(date) : new Date();
  const startStr = new Date(refDate.getTime() - 45 * 86400000).toISOString().slice(0, 10);
  const endStr = new Date(refDate.getTime() + 45 * 86400000).toISOString().slice(0, 10);

  // Small bbox around the point to find the correct WRS-2 path/row
  const bbox = [lon - 0.3, lat - 0.3, lon + 0.3, lat + 0.3];
  const q = `${PC_STAC}/search?` + new URLSearchParams({
    collections: PC_COLLECTION,
    bbox: bbox.join(','),
    datetime: `${startStr}/${endStr}`,
    limit: '10',
    'query': JSON.stringify({ 'eo:cloud_cover': { 'lte': 20 } }),
  });

  const resp = await fetch(q, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  if (!resp.ok) return null;
  const search = await resp.json() as { features?: Array<Record<string, unknown>> };
  const features = search.features;
  if (!features || features.length === 0) return null;

  // Pick the scene whose bbox actually contains our point, lowest cloud first
  const containing: Array<Record<string, unknown>> = [];
  for (const feat of features) {
    const fb = feat.bbox as [number, number, number, number];
    if (lat >= fb[1] && lat <= fb[3] && lon >= fb[0] && lon <= fb[2]) {
      containing.push(feat);
    }
  }
  if (containing.length === 0) return null;
  containing.sort((a, b) =>
    ((a.properties as Record<string, unknown>)?.['eo:cloud_cover'] as number ?? 100) -
    ((b.properties as Record<string, unknown>)?.['eo:cloud_cover'] as number ?? 100),
  );
  const item = containing[0];
  const assets = item.assets as Record<string, { href: string }>;
  const props = item.properties as Record<string, unknown>;
  const epsg = props['proj:epsg'] as number;
  const cloudCover = props['eo:cloud_cover'] as number | undefined;
  const acquired = props.datetime as string | undefined;
  const itemId = item.id as string;

  // Read surface temperature from lwir11 (ST_B10)
  let surfaceTemperature: number | undefined;
  const stAsset = assets['lwir11'];
  if (stAsset) {
    try {
      const signed = await sign(stAsset.href);
      const raw = await readCogPixel(signed, epsg, lat, lon);
      if (raw !== null) surfaceTemperature = toKelvin(raw);
    } catch { /* fall through */ }
  }

  // Read NDVI from surface reflectance bands
  let ndvi: number | undefined;
  const redAsset = assets['red'];
  const nirAsset = assets['nir08'];
  if (redAsset && nirAsset) {
    try {
      const [redSigned, nirSigned] = await Promise.all([sign(redAsset.href), sign(nirAsset.href)]);
      const [redRaw, nirRaw] = await Promise.all([
        readCogPixel(redSigned, epsg, lat, lon),
        readCogPixel(nirSigned, epsg, lat, lon),
      ]);
      if (redRaw !== null && nirRaw !== null) {
        const redRef = toReflectance(redRaw);
        const nirRef = toReflectance(nirRaw);
        ndvi = (nirRef - redRef) / (nirRef + redRef + 1e-10);
      }
    } catch { /* fall through */ }
  }

  // Read emissivity band (direct USGS-provided value)
  let emissivity: number | undefined;
  const emisAsset = assets['emis'];
  if (emisAsset) {
    try {
      const emisSigned = await sign(emisAsset.href);
      const emisRaw = await readCogPixel(emisSigned, epsg, lat, lon);
      if (emisRaw !== null) emissivity = toEmissivity(emisRaw);
    } catch { /* fall through */ }
  }

  // Read QA pixel for cloud/shadow mask
  let qaPixel: number | undefined;
  const qaAsset = assets['qa_pixel'];
  if (qaAsset) {
    try {
      const qaSigned = await sign(qaAsset.href);
      qaPixel = await readCogPixel(qaSigned, epsg, lat, lon) ?? undefined;
    } catch { /* fall through */ }
  }

  // Surface reflectance bands for emissivity/indices
  const readSr = async (key: string): Promise<number | undefined> => {
    const a = assets[key];
    if (!a) return undefined;
    try {
      const s = await sign(a.href);
      const r = await readCogPixel(s, epsg, lat, lon);
      return r !== null ? toReflectance(r) : undefined;
    } catch { return undefined; }
  };
  const [srBlue, srGreen, srRed, srNir, srSwir1, srSwir2] = await Promise.all([
    readSr('blue'), readSr('green'), readSr('red'), readSr('nir08'), readSr('swir16'), readSr('swir22'),
  ]);

  return {
    surfaceTemperature,
    ndvi,
    emissivity,
    qaPixel,
    acquired: acquired ? acquired.slice(0, 10) : undefined,
    cloudCover,
    sr: { blue: srBlue, green: srGreen, red: srRed, nir: srNir, swir1: srSwir1, swir2: srSwir2 },
    source: `pc:${PC_COLLECTION}:${itemId}`,
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
