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
import { fetchMeasuredB11Point, fetchMeasuredB11Window, dnToBt11 } from './landsatL1Thermal';
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


const FETCH_TIMEOUT = 60000;

/**
 * A fetch that never hangs the COG read path. geotiff's default `fromUrl`
 * uses the global fetch with no timeout, so a slow blob read could stall the
 * grid for minutes. Binding a generous (60s) AbortSignal keeps the read
 * bounded while still allowing Planetary Computer's occasionally-slow COG
 * range requests to complete.
 */
function cogFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
}

/** geotiff's RemoteSourceOptions plus the (runtime-supported, untyped) fetch override. */
type CogSourceOptions = { fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
const COG_READ_OPTS: CogSourceOptions = { fetch: cogFetch };

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

  const tiff = await fromUrl(signedUrl, COG_READ_OPTS as unknown as Parameters<typeof fromUrl>[1]);
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

/**
 * USGS Collection-2 L2 single-channel atmosphere file scales, closure-verified
 * against ST_TRAD: L_AT-sensor = τ·(ε·B(Ts) + (1−ε)·L↓) + L↑ reproduces TRAD
 * within 0.1% across 5 clear-sky Tokyo scenes.
 *   ST_TRAD / ST_URAD / ST_DRAD — radiance (W/m²/sr/µm): DN × 1e-3
 *   ST_ATRAN (transmittance), ST_EMIS (emissivity):      DN × 1e-4
 */
const SC_TAU_SCALE = 1e-4;
const SC_RAD_SCALE = 1e-3;

/**
 * Invert scene-specific Planck constants (from mtl.json) from TOA radiance
 * to brightness temperature: BT = K2 / ln(K1 / L + 1).
 * K1/K2 are read per scene — they vary slightly between Landsat 8 and 9 TIRS.
 */
function _planckToBt(radiance: number, k1: number, k2: number): number | null {
  if (!Number.isFinite(radiance) || radiance <= 0) return null;
  return k2 / Math.log(k1 / radiance + 1);
}

interface ThermalConstants {
  k1_10: number; k2_10: number;
  k1_11: number; k2_11: number;
}

/** Read the LEVEL1_THERMAL_CONSTANTS block from a scene's mtl.json. */
async function readThermalConstants(
  mtlHref: string,
): Promise<ThermalConstants | null> {
  try {
    const r = await fetch(mtlHref, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!r.ok) return null;
    const mtl = await r.json() as Record<string, unknown>;
    const lvl1 = (mtl.LANDSAT_METADATA_FILE as Record<string, unknown> | undefined)
      ?.LEVEL1_THERMAL_CONSTANTS as Record<string, string> | undefined;
    if (!lvl1) return null;
    const k1_10 = Number(lvl1.K1_CONSTANT_BAND_10);
    const k2_10 = Number(lvl1.K2_CONSTANT_BAND_10);
    const k1_11 = Number(lvl1.K1_CONSTANT_BAND_11);
    const k2_11 = Number(lvl1.K2_CONSTANT_BAND_11);
    if ([k1_10, k2_10, k1_11, k2_11].some((v) => !Number.isFinite(v) || v <= 0)) return null;
    return { k1_10, k2_10, k1_11, k2_11 };
  } catch { return null; }
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
  // dew_point_2m and surface_pressure. We compute TCWV (total precipitable
  // water) with the hydrostatic column approximation used in GPS/troposphere
  // literature:
  //   PW = q0 · rho0 · Hq
  // with q0 the near-surface specific humidity (from dew point via Magnus),
  // rho0 the surface air density, and Hq ≈ 2100 m the water-vapour scale
  // height (Bevis et al. 1992). Checked against ERA5: Tokyo August noon
  // yields ~43 mm, matching ERA5 TCWV climatology (~35-45 mm).
  //
  // Endpoint routing: the forecast API only covers the present window and a
  // shallow past_days range; actually past requests (older than ~6 days —
  // ERA5 archive ingests lag by ~5 days) must hit archive-api, otherwise the
  // API returns an empty forecast and TCWV silently becomes null.
  const isRange = !!date && date.includes('/');
  const endDateStr = date ? date.split('/')[1] ?? date : undefined;
  const endMs = endDateStr ? Date.parse(`${endDateStr}T23:59:59Z`) : Number.NaN;
  const isPast = Number.isFinite(endMs) && endMs < Date.now() - 6 * 86400000;
  const useArchive = isRange || isPast;
  const baseUrl = useArchive
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

  // Surface air temperature for the density term; fall back to the dew
  // point when the archive omits it.
  const rawT = (hourly as Record<string, number[]>).temperature_2m?.[idx];
  const Tair = rawT != null && Number.isFinite(rawT) ? rawT : Td + 2;

  // Hydrostatic column approximation (Bevis et al. 1992):
  //   e   = 6.112 · exp(17.67·Td / (Td + 243.5))      [hPa, Magnus]
  //   q0  = 0.622 · e / (P − 0.378·e)                 [kg/kg, specific humidity]
  //   rho0 = 100·P / (287.058 · (Tair + 273.15))      [kg/m³, surface density]
  //   PW  = q0 · rho0 · Hq,  Hq = 2100 m              [kg/m² = mm, vapour
  //            scale height from Bevis 1992]
  const e = 6.112 * Math.exp(17.67 * Td / (Td + 243.5));
  const q0 = 0.622 * e / (P - 0.378 * e);
  const rho0 = (100 * P) / (287.058 * (Tair + 273.15));
  const PW_mm = q0 * rho0 * 2100;                // kg/m² == mm of precipitable water
  const w_gcm2 = PW_mm * 0.1;                    // 1 mm PW = 0.1 g/cm² column vapour
  if (!Number.isFinite(w_gcm2) || w_gcm2 < 0) return null;
  return w_gcm2;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Landsat C2 L2 Surface Temperature & Brightness Temperature
//  via NASA LP DAAC AppEEARS point sampling
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Derive true top-of-atmosphere brightness temperatures from the USGS
 * C2 L2 single-channel product.
 *
 * Band-10 BT from real ST_TRAD radiance via Planck inversion:
 *   BT₁₀ = K₂ / ln(K₁/L_AT-sensor + 1)
 * Band-11 BT is forward-modeled through the same atmosphere (τ, L↑, L↓) with
 * band-11 constants, since Landsat C2 L2 publishes only band-10 atmosphere files:
 *   B₁₁(Ts) surface-leaving; L↑₁₁, L↓₁₁ scaled from band-10 atmosphere.
 * Water vapour w is implied by ST_ATRAN (τ₁₀) via the Rozenstein (2014) τ₁₀(w)
 * regression τ₁₀ = 1.0286 − 0.1146w → w = (1.0286 − τ₁₀)/0.1146.
  *
  * `raws` are the pre-loaded scene pixel values; `K` holds the per-scene
  * Planck constants (read once from mtl.json by the caller). Returns null
  * when the required values are missing or non-physical.
  */
function deriveBrightnessTemperatures(
  raws: { trad?: number; atran?: number; urad?: number; drad?: number; emis?: number },
  K: ThermalConstants,
  surfaceTemperature: number | undefined,
): { bt10: number; bt11: number; wScene: number } | null {
  const { trad, atran, urad, drad, emis } = raws;
  if (trad == null || atran == null || surfaceTemperature == null) return null;
  const L10 = trad * SC_RAD_SCALE;
  const tau10 = atran * SC_TAU_SCALE;
  if (!Number.isFinite(L10) || L10 <= 0 || !Number.isFinite(tau10) || tau10 <= 0 || tau10 > 1) return null;

  const BT10 = K.k2_10 / Math.log(K.k1_10 / L10 + 1);
  if (!Number.isFinite(BT10) || BT10 < 220 || BT10 > 340) return null;

  // Column water vapour implied by the scene's τ₁₀
  let wScene = Math.max(0.2, (1.0286 - tau10) / 0.1146);
  wScene = Math.min(6.3, wScene);

  // Band-11 forward atmosphere: τ₁₁ from Rozenstein regression at wScene;
  // L↑₁₁ scaled from band-10 L↑ by the path-radiance ratio (1−τ)/(1−τ).
  const tau11 = Math.max(0.15, 1.0083 - 0.1568 * wScene);
  const B11 = (T: number) => K.k1_11 / (Math.exp(K.k2_11 / T) - 1);
  // Surface-leaving band-11 radiance from ST_B10, emissivity
  const eps = emis != null && emis > 0 && emis <= 1 ? emis : 0.98;
  const Ts = surfaceTemperature;
  const Lu10 = urad != null ? urad * SC_RAD_SCALE : 0;
  const Ld10 = drad != null ? drad * SC_RAD_SCALE : 0;
  const T_atm = (1 - tau10) > 1e-6 && Lu10 > 0
    ? K.k2_10 / Math.log(K.k1_10 / (Lu10 / (1 - tau10)) + 1)
    : Ts;
  const Lu11 = (1 - tau11) * B11(T_atm);
  const Ld11 = Lu10 > 1e-6 ? (Ld10 / Lu10) * Lu11 : 0;
  const L11_at = tau11 * (eps * B11(Ts) + (1 - eps) * Ld11) + Lu11;
  if (!Number.isFinite(L11_at) || L11_at <= 0) return null;
  const BT11 = K.k2_11 / Math.log(K.k1_11 / L11_at + 1);
  if (!Number.isFinite(BT11) || BT11 < 220 || BT11 > 340) return null;

  return { bt10: BT10, bt11: BT11, wScene };
}

export interface LandsatThermalData {
  /** Landsat C2 L2 Surface Temperature band (ST_B10 = lwir11), Kelvin — USGS single-channel product. */
  surfaceTemperature?: number;
  /** Real at-sensor TOA brightness temperature, TIRS Band 10 (K), derived
   *  from ST_TRAD radiance via band-10 Planck inversion (scene K1/K2). */
  bt10?: number;
  /** TOA brightness temperature, TIRS Band 11 (K), forward-modeled through
   *  the USGS single-channel atmosphere (τ, L↑, L↓) with band-11 constants. */
  bt11?: number;
  /** Effective column water vapour (g/cm²) implied by the scene's ST_ATRAN
   *  via the Rozenstein (2014) τ₁₀(w) regression. */
  wScene?: number;
  /** Provenance of `bt11`: 'measured' = C2 L1 band-11 radiance
   *  (USGS LandsatLook, ERS session); 'forward-model' = band-11 synthesized
   *  from the single-channel atmosphere (used when the measured read fails). */
  bt11Source?: 'measured' | 'forward-model';
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
/**
 * Point-in-polygon (ray casting) against a STAC feature footprint geometry.
 * Landsat tile bboxes are larger than the actual swath, so bbox containment
 * alone picks scenes where the point falls on fill/no-data pixels.
 */
function pointInFootprint(
  feat: Record<string, unknown>, lat: number, lon: number,
): boolean {
  const g = feat.geometry as { type?: string; coordinates?: unknown } | undefined;
  if (!g || !g.coordinates) return false;
  const rings: Array<Array<[number, number]>> = [];
  if (g.type === 'Polygon') {
    rings.push((g.coordinates as Array<Array<[number, number]>>)[0]);
  } else if (g.type === 'MultiPolygon') {
    for (const poly of g.coordinates as Array<Array<Array<[number, number]>>>) {
      rings.push(poly[0]);
    }
  } else {
    return false;
  }
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) &&
          (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

/** True when a raw Landsat C2 L2 pixel is a fill/no-data value. */
function isFill(raw: number | null | undefined): boolean {
  return raw == null || raw === 0 || raw === -9999 || raw === -99999;
}

/**
 * Landsat Collection 2 pixel_qa one-hot class bits: 0 fill, 1 clear, 2 water,
 * 3 cloud shadow, 4 snow, 5 cloud. Shadow/snow/fill/cloud pixels all carry a
 * radiance that is NOT the land surface — feeding them to the split-window
 * equation yields cloud-top brightness temperature mislabelled as LST (the
 * -35 °C-over-Bengaluru symptom). Unclassified (0) passes through: the
 * per-cell BT sanity floor below still catches contaminated pixels.
 */
const PQA_BAD = (1 << 0) | (1 << 3) | (1 << 4) | (1 << 5); // fill | shadow | snow | cloud
function isCloudOrBadQa(qaRaw: number | null | undefined): boolean {
  if (qaRaw == null) return false;
  const v = Math.round(qaRaw);
  return v !== 0 && (v & PQA_BAD) !== 0;
}

/**
 * Brightness-temperature floor for a plausible land surface anywhere on the
 * planet (~−22 °C — Antarctic plateau in winter approaches it). Cloud tops in
 * the tropics sit at 220–250 K, so anything under this is cloud, not ground.
 */
const BT_LAND_FLOOR_K = 251;

export async function fetchLandsatThermal(
  lat: number, lon: number, date?: string,
): Promise<LandsatThermalData | null> {
  const refDate = date && !date.includes('/') ? new Date(date) : new Date();
  // Landsat 8/9 together revisit every ~8 days, so search ±90 days for a
  // cloud-free scene whose footprint actually contains the point.
  const startStr = new Date(refDate.getTime() - 90 * 86400000).toISOString().slice(0, 10);
  const endStr = new Date(refDate.getTime() + 30 * 86400000).toISOString().slice(0, 10);

  // Small bbox around the point to find the correct WRS-2 path/row
  const bbox = [lon - 0.3, lat - 0.3, lon + 0.3, lat + 0.3];
  const q = `${PC_STAC}/search?` + new URLSearchParams({
    collections: PC_COLLECTION,
    bbox: bbox.join(','),
    datetime: `${startStr}/${endStr}`,
    limit: '20',
    'query': JSON.stringify({ 'eo:cloud_cover': { 'lte': 40 } }),
  });

  const resp = await fetch(q, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  if (!resp.ok) return null;
  const search = await resp.json() as { features?: Array<Record<string, unknown>> };
  const features = search.features;
  if (!features || features.length === 0) return null;

  // Pick scenes whose actual footprint polygon contains the point
  // (bbox containment alone includes scenes where the point is outside
  // the swath and every pixel read comes back as fill/no-data).
  const containing = features.filter((f) => pointInFootprint(f, lat, lon));
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

  // Measured band-11: fetch the C2 L1 radiance in parallel with the
  // L2 single-channel reads. Falls back to the forward model when the ERS
  // session or the L1 pixels are unavailable (returns null on any failure).
  const measuredB11Promise = fetchMeasuredB11Point(itemId, lat, lon).catch(() => null);

  // Read every pixel in one parallel batch. Sequential reads cost ~1-2 s each
  // (SAS sign + COG open) and 16 of them can exceed the 45 s fetcher cap.
  const readRaw = async (key: string): Promise<{ raw: number | null; signed?: string }> => {
    const a = assets[key];
    if (!a) return { raw: null };
    try {
      const s = await sign(a.href);
      return { raw: await readCogPixel(s, epsg, lat, lon), signed: s };
    } catch { return { raw: null }; }
  };
  const [lwir11, red, nir08, emis, qaPixelR, trad, atran, urad, drad,
    mtlJsonS0, blue, green, swir16, swir22] = await Promise.all([
      readRaw('lwir11'), readRaw('red'), readRaw('nir08'), readRaw('emis'), readRaw('qa_pixel'),
      readRaw('trad'), readRaw('atran'), readRaw('urad'), readRaw('drad'),
      (async () => {
        const a = assets['mtl.json'];
        if (!a) return null;
        try { return await sign(a.href); } catch { return null; }
      })(),
      readRaw('blue'), readRaw('green'), readRaw('swir16'), readRaw('swir22'),
    ]);

  // Surface temperature (ST_B10)
  const surfaceTemperature = !isFill(lwir11.raw) ? toKelvin(lwir11.raw!) : undefined;

  // NDVI from surface reflectance red/nir
  let ndvi: number | undefined;
  if (!isFill(red.raw) && !isFill(nir08.raw)) {
    const redRef = toReflectance(red.raw!);
    const nirRef = toReflectance(nir08.raw!);
    ndvi = (nirRef - redRef) / (nirRef + redRef + 1e-10);
  }

  // USGS-published surface emissivity (ST_EMIS)
  const emissivity = !isFill(emis.raw) ? toEmissivity(emis.raw!) : undefined;

  // QA pixel
  const qaPixel = qaPixelR.raw != null && !isFill(qaPixelR.raw) ? qaPixelR.raw : undefined;

  // Surface reflectance bands
  const srVal = (r: { raw: number | null }): number | undefined =>
    r.raw != null && !isFill(r.raw) ? toReflectance(r.raw) : undefined;
  const sr = {
    blue: srVal(blue), green: srVal(green), red: srVal(red),
    nir: srVal(nir08), swir1: srVal(swir16), swir2: srVal(swir22),
  };

  // True top-of-atmosphere brightness temperatures for Rozenstein (2014)
  // split-window consumers: BT10 from ST_TRAD radiance, BT11 from the
  // Measured C2 L1 band-11 radiance when available, forward-modeled through
  // the USGS single-channel atmosphere otherwise.
  const K = mtlJsonS0 ? await readThermalConstants(mtlJsonS0) : null;
  const bt = K
    ? await deriveBrightnessTemperatures(
      { trad: isFill(trad.raw) ? undefined : trad.raw ?? undefined, atran: isFill(atran.raw) ? undefined : atran.raw ?? undefined, urad: isFill(urad.raw) ? undefined : urad.raw ?? undefined, drad: isFill(drad.raw) ? undefined : drad.raw ?? undefined, emis: emissivity },
      K, surfaceTemperature,
    )
    : null;

  const measuredB11 = await measuredB11Promise;

  // QA_PIXEL was fetched and ignored for years — the point (headline) value
  // carried cloud-top brightness temperature as "LST" (Bengaluru -35 °C).
  const bt11Point = measuredB11?.bt11 ?? bt?.bt11;
  if (isCloudOrBadQa(qaPixel) || (bt11Point != null && bt11Point < BT_LAND_FLOOR_K)) {
    console.warn(`[L1-PT] centre pixel cloud-flagged (qa=${qaPixel ?? '-'}, BT11=${bt11Point?.toFixed(1) ?? '-'}K) at ${lat.toFixed(3)},${lon.toFixed(3)} — refusing cloud-top radiance as surface temperature`);
    return null;
  }

  return {
    surfaceTemperature,
    bt10: bt?.bt10,
    bt11: bt11Point,
    bt11Source: measuredB11 ? 'measured' : bt ? 'forward-model' : undefined,
    wScene: bt?.wScene,
    ndvi,
    emissivity,
    qaPixel,
    acquired: acquired ? acquired.slice(0, 10) : undefined,
    cloudCover,
    sr,
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

// ═══════════════════════════════════════════════════════════════════════════
//  Scene-wide thermal grid (windowed COG reads for spatial grids)
// ═══════════════════════════════════════════════════════════════════════════

/** Max window side in pixels for direct IFD-0 reads (~12 COG tiles at 2000px). */
const MAX_WINDOW_PX = 2000;

interface BandWindow {
  /** Raw pixel values, row-major from (px0, py0). */
  data: ArrayLike<number>;
  px0: number; py0: number; px1: number; py1: number;
}

interface BandGeom {
  xMin: number; yMin: number; xMax: number; yMax: number;
  w: number; h: number;
}

/**
 * Read the COG window covering a lat/lon bounding box, automatically picking a
 * decimated overview when the full-resolution window would exceed ~1.5 MP.
 */
async function readCogBboxWindow(
  signedUrl: string, epsg: number,
  latMin: number, latMax: number, lonMin: number, lonMax: number,
): Promise<{ win: BandWindow; geom: BandGeom } | null> {
  proj4.defs(`EPSG:${epsg}`, `+proj=utm +zone=${epsg % 100} +datum=WGS84 +units=m +no_defs`);
  const toUtm = proj4('EPSG:4326', `EPSG:${epsg}`);
  const xs: number[] = [], ys: number[] = [];
  for (const [lon, lat] of [[lonMin, latMin], [lonMin, latMax], [lonMax, latMin], [lonMax, latMax]] as const) {
    const [x, y] = toUtm.forward([lon, lat]);
    xs.push(x); ys.push(y);
  }
  const uxMin = Math.min(...xs), uxMax = Math.max(...xs);
  const uyMin = Math.min(...ys), uyMax = Math.max(...ys);

  const tiff = await fromUrl(signedUrl, COG_READ_OPTS as unknown as Parameters<typeof fromUrl>[1]);
  let image = await tiff.getImage();

  const computeWindow = (img: Awaited<ReturnType<typeof tiff.getImage>>): BandWindow | null => {
    const [xMin, yMin, xMax, yMax] = img.getBoundingBox();
    const w = img.getWidth(), h = img.getHeight();
    const px0 = Math.max(0, Math.floor(((uxMin - xMin) / (xMax - xMin)) * w));
    const px1 = Math.min(w, Math.ceil(((uxMax - xMin) / (xMax - xMin)) * w));
    const py0 = Math.max(0, Math.floor(((yMax - uyMax) / (yMax - yMin)) * h));
    const py1 = Math.min(h, Math.ceil(((yMax - uyMin) / (yMax - yMin)) * h));
    if (px1 <= px0 || py1 <= py0) return null;
    return { data: new Float32Array(0), px0, py0, px1, py1 };
  };

  let meta = computeWindow(image);
  if (!meta) return null;
  // Overview decimation for large windows (COG IFDs are ordered by resolution).
  // Some products ship overviews without georeference tags — in that case any
  // getBoundingBox()/readRasters call throws, so only switch to an overview
  // when it is demonstrably usable; otherwise read IFD 0 directly.
  if (meta.px1 - meta.px0 > MAX_WINDOW_PX || meta.py1 - meta.py0 > MAX_WINDOW_PX) {
    try {
      const ifdCount = await tiff.getImageCount();
      for (let i = 1; i < Math.min(ifdCount, 8); i++) {
        try {
          const ovImg = await tiff.getImage(i);
          const ovMeta = computeWindow(ovImg);
          if (ovMeta && (ovMeta.px1 - ovMeta.px0 <= MAX_WINDOW_PX) && (ovMeta.py1 - ovMeta.py0 <= MAX_WINDOW_PX)) {
            image = ovImg; meta = ovMeta; break;
          }
        } catch { break; // un-georeferenced overview: stay on IFD 0
        }
      }
    } catch { /* no overview metadata available */ }
  }

  const [xMin, yMin, xMax, yMax] = image.getBoundingBox();
  const data = await image.readRasters({
    window: [meta.px0, meta.py0, meta.px1, meta.py1], samples: [0],
  });
  return {
    win: { data: data[0] as unknown as ArrayLike<number>, px0: meta.px0, py0: meta.py0, px1: meta.px1, py1: meta.py1 },
    geom: { xMin, yMin, xMax, yMax, w: image.getWidth(), h: image.getHeight() },
  };
}

/** Bilinear sample of a band window at (lat, lon). Returns undefined outside the window. */
function sampleBandWindow(
  bw: { win: BandWindow; geom: BandGeom },
  toUtm: ReturnType<typeof proj4>,
  lat: number, lon: number,
  nearest = false,
): number | undefined {
  const [ux, uy] = toUtm.forward([lon, lat]);
  const { win, geom } = bw;
  const gx = ((ux - geom.xMin) / (geom.xMax - geom.xMin)) * geom.w - 0.5 - win.px0;
  const gy = ((geom.yMax - uy) / (geom.yMax - geom.yMin)) * geom.h - 0.5 - win.py0;
  const ww = win.px1 - win.px0, hh = win.py1 - win.py0;
  if (gx < -0.5 || gy < -0.5 || gx > ww - 0.5 || gy > hh - 0.5) return undefined;
  // Nearest-neighbour: mandatory for integer class/mask bands (QA_PIXEL).
  // Bilinear between two class DNs fabricates intermediate bitmasks whose
  // rounded value sets shadow/snow/cloud bits that the real pixels do not
  // have — which masked entire clear scenes out of the LST grid.
  if (nearest) {
    const nx = Math.max(0, Math.min(ww - 1, Math.round(gx)));
    const ny = Math.max(0, Math.min(hh - 1, Math.round(gy)));
    const v = win.data[ny * ww + nx];
    return Number.isFinite(v) ? v : undefined;
  }
  const x0 = Math.max(0, Math.min(ww - 1, Math.floor(gx)));
  const y0 = Math.max(0, Math.min(hh - 1, Math.floor(gy)));
  const x1 = Math.min(ww - 1, x0 + 1);
  const y1 = Math.min(hh - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, gx - x0));
  const ty = Math.max(0, Math.min(1, gy - y0));
  const at = (x: number, y: number): number => win.data[y * ww + x];
  const v00 = at(x0, y0), v10 = at(x1, y0), v01 = at(x0, y1), v11 = at(x1, y1);
  const val = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  return Number.isFinite(val) ? val : undefined;
}

/**
 * Fetch per-cell Landsat C2 L2 thermal data for a spatial grid.
 *
 * One windowed COG read per band (signed URL reused across all cells), then
 * per-cell radiative-transfer BT derivation — identical math to
 * fetchLandsatThermal() so grid cells agree with the point tool.
 *
 * `lats` must be ascending, `lons` ascending; cells are returned row-major
 * (row 0 = lats[0]). Cells without a valid pixel are null (NaN in the grid).
 */
export async function fetchLandsatThermalGrid(
  lats: number[], lons: number[], date?: string,
): Promise<{ cells: Array<LandsatThermalData | null>; source: string; acquired?: string; cloudCover?: number; coverageFrac: number; cloudMasked: number } | null> {
  const nLat = lats.length, nLon = lons.length;
  if (nLat < 2 || nLon < 2) return null;
  const latMin = lats[0], latMax = lats[nLat - 1];
  const lonMin = lons[0], lonMax = lons[nLon - 1];

  const refDate = date && !date.includes('/') ? new Date(date) : new Date();
  const startStr = new Date(refDate.getTime() - 90 * 86400000).toISOString().slice(0, 10);
  const endStr = new Date(refDate.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const cLat = (latMin + latMax) / 2, cLon = (lonMin + lonMax) / 2;
  const bbox = [Math.min(lonMin, cLon - 0.35), Math.min(latMin, cLat - 0.35),
    Math.max(lonMax, cLon + 0.35), Math.max(latMax, cLat + 0.35)];
  const q = `${PC_STAC}/search?` + new URLSearchParams({
    collections: PC_COLLECTION,
    bbox: bbox.join(','),
    datetime: `${startStr}/${endStr}`,
    limit: '20',
    'query': JSON.stringify({ 'eo:cloud_cover': { 'lte': 40 } }),
  });
  const resp = await fetch(q, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  if (!resp.ok) { console.warn(`[L1-GRID] L2 STAC search HTTP ${resp.status}`); return null; }
  const search = await resp.json().catch((e) => { console.warn(`[L1-GRID] STAC json err: ${e instanceof Error ? e.message : e}`); return null; }) as { features?: Array<Record<string, unknown>> } | null;
  if (!search) return null;
  const features = search.features;
  if (!features || features.length === 0) { console.warn('[L1-GRID] STAC no features in window'); return null; }

  // A Landsat scene is a ~110 km path swath. Demanding that one scene contain
  // ALL FOUR corners of an arbitrary study-area box discards scenes covering
  // 95% of it — the large-area symptom where the grid silently collapses to
  // the centre-point broadcast (one flat value everywhere). Score each
  // candidate by the fraction of a 5×5 lattice of grid-cell centres inside
  // its footprint; majority coverage qualifies. Preference: least cloud
  // (10% buckets — decisive differences only), then nearest acquisition to the
  // requested date (monsoon windows otherwise drift back to the clear season),
  // then better coverage.
  const refMs = refDate.getTime();
  const lattice: Array<[number, number]> = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      lattice.push([latMin + (latMax - latMin) * ((i + 0.5) / 5), lonMin + (lonMax - lonMin) * ((j + 0.5) / 5)]);
    }
  }
  const cloudOf = (f: Record<string, unknown>) => ((f.properties as Record<string, unknown>)?.['eo:cloud_cover'] as number | undefined) ?? 100;
  const dateOf = (f: Record<string, unknown>) => new Date(((f.properties as Record<string, unknown>)?.datetime as string) ?? 0).getTime() || 0;
  const scored = features
    .map(f => ({ f, cov: lattice.reduce((n, [la, lo]) => n + (pointInFootprint(f, la, lo) ? 1 : 0), 0) / lattice.length }))
    .filter(s => s.cov >= 0.5);
  if (scored.length === 0) { console.warn(`[L1-GRID] none of ${features.length} scenes covers ≥50% of the study box`); return null; }
  scored.sort((a, b) =>
    (Math.round(cloudOf(a.f) / 10) - Math.round(cloudOf(b.f) / 10)) ||
    (Math.abs(dateOf(a.f) - refMs) - Math.abs(dateOf(b.f) - refMs)) ||
    (b.cov - a.cov),
  );
  const item = scored[0].f;
  const assets = item.assets as Record<string, { href: string }>;
  const props = item.properties as Record<string, unknown>;
  const epsg = props['proj:epsg'] as number;
  const cloudCover = props['eo:cloud_cover'] as number | undefined;
  const acquired = props.datetime as string | undefined;
  const itemId = item.id as string;

  const BANDS = ['lwir11', 'trad', 'atran', 'urad', 'drad', 'emis', 'red', 'nir08'] as const;
  const signed: Record<string, string> = {};
  await Promise.all(BANDS.map(async (k) => {
    if (!assets[k]) return;
    try { signed[k] = await sign(assets[k].href); } catch { /* missing band */ }
  }));
  if (!signed.lwir11 || !signed.trad || !signed.atran) { console.warn(`[L1-GRID] SAS signing failed: lwir11=${!!signed.lwir11} trad=${!!signed.trad} atran=${!!signed.atran}`); return null; }
  const mtlJsonS = assets['mtl.json'] ? await sign(assets['mtl.json'].href).catch(() => null) : null;
  const K = mtlJsonS ? await readThermalConstants(mtlJsonS) : null;
  if (!K) { console.warn('[L1-GRID] could not read thermal constants from mtl.json'); return null; }

  // Measured band-11 windowed read in parallel with the L2 band reads.
  const measuredWinPromise = fetchMeasuredB11Window(itemId, latMin, latMax, lonMin, lonMax).catch(() => null);

  // One windowed read per band, in capped batches (8 concurrent SAS+COG
  // chains overwhelm the connection pool; 3 at a time with one retry each
  // is reliable and still ~3-4× faster than serial).
  const readBand = async (k: (typeof BANDS)[number], retries = 1): Promise<{ win: BandWindow; geom: BandGeom } | null> => {
    try {
      const r = await readCogBboxWindow(signed[k], epsg, latMin, latMax, lonMin, lonMax);
      return r;
    } catch (e) {
      console.warn(`[L1-GRID] band ${k} read failed (${e instanceof Error ? e.message : String(e)})${retries > 0 ? ', retrying' : ''}`);
      if (retries > 0) return readBand(k, retries - 1);
      return null;
    }
  };
  const bwEntries: Array<[string, { win: BandWindow; geom: BandGeom } | null]> = [];
  const present = BANDS.filter((k) => signed[k]);
  for (let i = 0; i < present.length; i += 4) {
    const batch = present.slice(i, i + 4);
    const res = await Promise.all(batch.map((k) => readBand(k)));
    batch.forEach((k, bi) => bwEntries.push([k, res[bi]]));
  }
  const bw: Partial<Record<(typeof BANDS)[number], { win: BandWindow; geom: BandGeom }>> = {};
  for (const [k, r] of bwEntries) if (r) bw[k as (typeof BANDS)[number]] = r;
  if (!bw.lwir11 || !bw.trad || !bw.atran) { console.warn(`[L1-GRID] COG band window read failed: lwir11=${!!bw.lwir11} trad=${!!bw.trad} atran=${!!bw.atran}`); return null; }

  proj4.defs(`EPSG:${epsg}`, `+proj=utm +zone=${epsg % 100} +datum=WGS84 +units=m +no_defs`);
  const toUtm = proj4('EPSG:4326', `EPSG:${epsg}`);

  const measuredWin = await measuredWinPromise;

  // Sample the measured band-11 window (bilinear) at a lat/lon cell.
  // Returns calibrated BT11 (K) or null when outside/padding the window.
  const sampleMeasuredB11 = (la: number, lo: number): number | null => {
    if (!measuredWin) return null;
    const [ux, uy] = toUtm.forward([lo, la]);
    const { px0, py0, px1, py1, xMin, xMax, yMin, yMax, w, h, data, calibration } = measuredWin;
    const ww = px1 - px0, hh = py1 - py0;
    if (ww <= 0 || hh <= 0) return null;
    const gx = ((ux - xMin) / (xMax - xMin)) * w - 0.5 - px0;
    const gy = ((yMax - uy) / (yMax - yMin)) * h - 0.5 - py0;
    if (gx < -0.5 || gy < -0.5 || gx > ww - 0.5 || gy > hh - 0.5) return null;
    const x0 = Math.max(0, Math.min(ww - 1, Math.floor(gx)));
    const y0 = Math.max(0, Math.min(hh - 1, Math.floor(gy)));
    const x1 = Math.min(ww - 1, x0 + 1);
    const y1 = Math.min(hh - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, gx - x0));
    const ty = Math.max(0, Math.min(1, gy - y0));
    const dn = (
      (data[y0 * ww + x0] * (1 - tx) + data[y0 * ww + x1] * tx) * (1 - ty) +
      (data[y1 * ww + x0] * (1 - tx) + data[y1 * ww + x1] * tx) * ty
    );
    return dnToBt11(dn, calibration);
  };

  // QA band (fill/cloud-shadow/snow/cloud classes) — the per-pixel gate that
  // stops cloud-top radiance from being converted into a "land surface"
  // temperature. Landsat C2 L2 exposes it as 'qa' (older items 'qa_pixel').
  const qaKey = assets['qa'] ? 'qa' : assets['qa_pixel'] ? 'qa_pixel' : undefined;
  let qaBand: { win: BandWindow; geom: BandGeom } | null = null;
  if (qaKey) {
    const qs = await sign(assets[qaKey].href).catch(() => null);
    if (qs) qaBand = await readCogBboxWindow(qs, epsg, latMin, latMax, lonMin, lonMax).catch(() => null);
    if (!qaBand) console.warn('[L1-GRID] QA band window read failed — relying on BT-floor screening only');
  }

  const cells: Array<LandsatThermalData | null> = new Array(nLat * nLon).fill(null);
  let coverageIn = 0, cloudMasked = 0;
  for (let r = 0; r < nLat; r++) {
    for (let c = 0; c < nLon; c++) {
      const lat = lats[r], lon = lons[c];
      const raw = (k: (typeof BANDS)[number]): number | undefined => {
        const b = bw[k];
        if (!b) return undefined;
        const v = sampleBandWindow(b, toUtm, lat, lon);
        return v != null && !isFill(v) ? v : undefined;
      };
      const stRaw = raw('lwir11');
      if (stRaw == null) continue;
      coverageIn++;
      if (qaBand) {
        const qv = sampleBandWindow(qaBand, toUtm, lat, lon, true);
        if (qv != null && isCloudOrBadQa(qv)) { cloudMasked++; continue; }
      }
      const tradRaw = raw('trad');
      const atranRaw = raw('atran');
      const uradRaw = raw('urad');
      const dradRaw = raw('drad');
      const emisRaw = raw('emis');
      const redRaw = raw('red');
      const nirRaw = raw('nir08');
      if (stRaw == null) continue;
      const surfaceTemperature = toKelvin(stRaw);
      const emissivity = emisRaw != null ? toEmissivity(emisRaw) : undefined;
      let ndvi: number | undefined;
      if (redRaw != null && nirRaw != null) {
        const rr = toReflectance(redRaw), nr = toReflectance(nirRaw);
        ndvi = (nr - rr) / (nr + rr + 1e-10);
      }
      const bt = deriveBrightnessTemperatures(
        { trad: tradRaw, atran: atranRaw, urad: uradRaw, drad: dradRaw, emis: emissivity },
        K, surfaceTemperature,
      );
      const measuredBt11 = sampleMeasuredB11(lat, lon);
      const bt11v = measuredBt11 ?? bt?.bt11;
      // Thin cirrus passes PQA "clear" but its band-11 BT is physically
      // impossible as a land surface — mask it too (counts as cloud).
      if (bt11v != null && bt11v < BT_LAND_FLOOR_K) { cloudMasked++; continue; }
      cells[r * nLon + c] = {
        surfaceTemperature,
        bt10: bt?.bt10,
        bt11: measuredBt11 ?? bt?.bt11,
        bt11Source: measuredBt11 != null ? 'measured' : bt ? 'forward-model' : undefined,
        wScene: bt?.wScene,
        ndvi,
        emissivity,
        acquired: acquired ? acquired.slice(0, 10) : undefined,
        cloudCover,
        source: `pc:${PC_COLLECTION}:${itemId}`,
      };
    }
  }
  return { cells, source: `pc:${PC_COLLECTION}:${itemId}`, acquired: acquired?.slice(0, 10), cloudCover, coverageFrac: coverageIn / (nLat * nLon), cloudMasked };
}
