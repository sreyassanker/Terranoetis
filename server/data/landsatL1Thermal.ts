/**
 * Landsat Collection-2 Level-1 thermal radiance access.
 * ── EROS Registration System (ERS) session auth + LandsatLook STAC ──
 *
 * Background: Microsoft Planetary Computer publishes only the USGS
 * single-channel atmosphere auxiliary files (ST_TRAD, ST_ATRAN, …) for
 * band 10. The measured top-of-atmosphere radiance of TIRS band 11 is
 * not accessible from any unauthenticated source, so Tool 1's
 * split-window retrieval historically forward-modeled BT11. This module
 * fetches the actual measured band-11 radiance from the USGS Collection-2
 * Level-1 archive (landsatlook.usgs.gov) behind an authenticated ERS
 * session, removing forward-modeled band-11 data from the Rozenstein chain.
 *
 * Data flow (point):
 *   1. ERS form login (CSRF + credentials) → session cookies.
 *   2. LandsatLook STAC `landsat-c2l1` search matched to the L2 scene's
 *      platform / WRS path+row / acquisition date.
 *   3. L1 MTL.json: RADIANCE_MULT/ADD band 11 + K1/K2 thermal constants.
 *   4. B11 (asset key `lwir12`) COG pixel/window read via HTTP Range with
 *      the ERS cookie (landsatlook serves the TIF directly, no redirect).
 *   5. L11 = DN·MULT + ADD; BT11 = K2 / ln(K1/L11 + 1).
 *
 * Graceful degradation: with no USGS_ERS_* credentials or any network
 * error the functions return null and the caller keeps the forward-modeled
 * BT11 (documented in the tool's uncertainty statement).
 */

import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const { fromUrl } = _require('geotiff') as {
  fromUrl: (url: string, opts?: { headers?: Record<string, string> }) => Promise<{
    getImage(i?: number): Promise<{
      getBoundingBox(): [number, number, number, number];
      getWidth(): number;
      getHeight(): number;
      readRasters(o: { window: number[]; samples: number[] }): Promise<ArrayLike<number>[]>;
    }>;
    getImageCount(): Promise<number>;
  }>;
};
const proj4 = _require('proj4') as {
  defs(name: string, def: string): void;
  (from: string, to: string): {
    forward(coords: number[]): number[];
    inverse(coords: number[]): number[];
  };
};

const FETCH_TIMEOUT = 30000;
const LL_STAC = 'https://landsatlook.usgs.gov/stac-server';
const ERS_BASE = 'https://ers.cr.usgs.gov';

// ── ERS session management (cached, auto-refresh) ────────────────────

let ersCookie: string | null = null;
let ersCookieExpiry = 0;

/** Extract cookie pairs from fetch response headers into the jar map. */
function collectCookies(jar: Map<string, string>, headers: Headers): void {
  // Node fetch (undici): getSetCookie() returns all Set-Cookie headers.
  const sc: string[] = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of sc) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1));
  }
}

/**
 * Log in to the EROS Registration System via the CSRF-protected login form.
 * Returns the cookie string usable as a `Cookie` header, or null when
 * credentials are missing/unconfigured.
 */
export async function ersLogin(): Promise<string | null> {
  const user = process.env.USGS_ERS_USERNAME;
  const pass = process.env.USGS_ERS_PASSWORD;
  if (!user || !pass) return null;

  const jar = new Map<string, string>();
  try {
    const r1 = await fetch(`${ERS_BASE}/login`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    collectCookies(jar, r1.headers);
    const html = await r1.text();
    const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
    if (!csrf) return null;

    const body = new URLSearchParams({ username: user, password: pass, csrf });
    const cookieHeader = [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
    const r2 = await fetch(`${ERS_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader },
      body: body.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    collectCookies(jar, r2.headers);
    // Success = 30x redirect with EROS_SSO_production_secure cookie set.
    if (!jar.has('EROS_SSO_production_secure')) return null;
    return [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
  } catch {
    return null;
  }
}

/** Cached ERS session cookie (24 h TTL — the auth cookies live 14 days but
 *  the `fwb` fire-walking cookie is short-lived, so re-login daily). */
export async function ersSessionCookie(): Promise<string | null> {
  if (ersCookie && Date.now() < ersCookieExpiry) return ersCookie;
  const c = await ersLogin();
  if (c) {
    ersCookie = c;
    ersCookieExpiry = Date.now() + 24 * 3600000;
  }
  return c;
}

/** Invalidate the cached session (call after an auth-looking failure). */
export function ersInvalidate(): void {
  ersCookie = null;
  ersCookieExpiry = 0;
}

// ── LandsatLook Level-1 scene matching ───────────────────────────────

interface L1Scene {
  id: string;
  /** Band-11 COG url (asset key `lwir12` = B11). */
  b11Href: string;
  /** L1 MTL.json url with radiometric rescaling + thermal constants. */
  mtlHref: string;
  epsg: number;
  acquired?: string;
}

/** Derive L1 matcher components from a C2 L2 LandsatLook/PC scene id. */
function parseL2SceneId(l2Id: string): { platform: string; pathRow: string; acqDate: string } | null {
  const m = l2Id.match(/^(LC0[89])_L2[SG]..?_(\d{6})_(\d{8})/);
  if (!m) return null;
  return { platform: m[1], pathRow: m[2], acqDate: m[3] };
}

/**
 * Find the Collection-2 Level-1 scene matching an L2 product id.
 * Landsat L1 is processed 1:1 from L1 for L2 (same overpass), so WRS
 * path/row + acquisition date identify the exact L1 product.
 */
export async function fetchL1SceneForL2(
  l2Id: string, lat: number, lon: number, latSpan = 0.45, lonSpan = 0.45,
): Promise<L1Scene | null> {
  const parsed = parseL2SceneId(l2Id);
  if (!parsed) return null;
  const { platform, pathRow, acqDate } = parsed;
  const y = +acqDate.slice(0, 4), m = +acqDate.slice(4, 6), d = +acqDate.slice(6, 8);
  const day0 = new Date(Date.UTC(y, m - 1, d, 0, 0, 0)).toISOString().slice(0, 19) + 'Z';
  const day1 = new Date(Date.UTC(y, m - 1, d, 23, 59, 59)).toISOString().slice(0, 19) + 'Z';

  const q = `${LL_STAC}/search`;
  const body = {
    collections: ['landsat-c2l1'],
    bbox: [lon - lonSpan, lat - latSpan, lon + lonSpan, lat + latSpan],
    datetime: `${day0}/${day1}`,
    limit: 12,
  };
  try {
    const r = await fetch(q, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!r.ok) return null;
    const d0 = await r.json() as { features?: Array<Record<string, unknown>> };
    const feats = d0.features ?? [];
    // Match platform + path/row; accept T1/T2 quality tiers, T1 preferred.
    const re = new RegExp(`^${platform}_L1(TP|GT)_${pathRow}_`);
    const match = feats
      .filter((f) => re.test(String(f.id ?? '')))
      .sort((a, b) => (String(a.id).includes('_T1') ? -1 : 0) - (String(b.id).includes('_T1') ? -1 : 0))[0];
    if (!match) return null;
    const assets = match.assets as Record<string, { href?: string }>;
    const b11 = assets['lwir12']?.href;
    const mtl = assets['MTL.json']?.href;
    if (!b11 || !mtl) return null;
    const props = match.properties as Record<string, unknown> | undefined;
    return {
      id: String(match.id),
      b11Href: b11,
      mtlHref: mtl,
      epsg: (props?.['proj:epsg'] as number) ?? 0,
      acquired: (props?.datetime as string)?.slice(0, 10),
    };
  } catch {
    return null;
  }
}

// ── MTL calibration for band 11 ──────────────────────────────────────

interface B11Calibration {
  mult: number;
  add: number;
  k1: number;
  k2: number;
}

/** Read band-11 radiance rescaling + thermal constants from the L1 MTL. */
async function readB11Calibration(mtlUrl: string, cookie: string): Promise<B11Calibration | null> {
  try {
    const r = await fetch(mtlUrl, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!r.ok) return null;
    const j = await r.json() as
      { LANDSAT_METADATA_FILE?: { LEVEL1_RADIOMETRIC_RESCALING?: Record<string, string>; LEVEL1_THERMAL_CONSTANTS?: Record<string, string> } };
    const meta = j.LANDSAT_METADATA_FILE;
    if (!meta) return null;
    const rr = meta.LEVEL1_RADIOMETRIC_RESCALING;
    const tc = meta.LEVEL1_THERMAL_CONSTANTS;
    const mult = parseFloat(rr?.RADIANCE_MULT_BAND_11 ?? '');
    const add = parseFloat(rr?.RADIANCE_ADD_BAND_11 ?? '');
    const k1 = parseFloat(tc?.K1_CONSTANT_BAND_11 ?? '');
    const k2 = parseFloat(tc?.K2_CONSTANT_BAND_11 ?? '');
    if (!Number.isFinite(mult) || !Number.isFinite(add) || !Number.isFinite(k1) || !Number.isFinite(k2)) return null;
    return { mult, add, k1, k2 };
  } catch {
    return null;
  }
}

/** DN → TOA radiance → brightness temperature (scene K1/K2). */
export function dnToBt11(dn: number, cal: B11Calibration): number | null {
  if (!Number.isFinite(dn) || dn <= 0) return null;
  const l11 = dn * cal.mult + cal.add;
  if (l11 <= 0) return null;
  const bt = cal.k2 / Math.log(cal.k1 / l11 + 1);
  return Number.isFinite(bt) && bt > 220 && bt < 340 ? bt : null;
}

// ── Measured B11 pixel / window reads ────────────────────────────────

/** Whether an HTTP response is an auth redirect (login HTML) rather than data. */
function isAuthProblem(status: number, contentType: string | null): boolean {
  if (status === 401 || status === 403) return true;
  if (contentType == null) return false;
  return contentType.includes('text/html');
}

/**
 * Open a COG over an ERS-authenticated URL with a lightweight probe/retry.
 * A 401/403 or an HTML (login-page) body invalidates the cached session so a
 * subsequent call re-logs in; transient network errors simply retry once.
 * Returns the geotiff handle once HEAD confirms a readable object.
 */
async function openAuthedCog(url: string, cookie: string, attempts = 2): Promise<ReturnType<typeof fromUrl>> {
  let c = cookie;
  for (let i = 0; i < attempts; i++) {
    const probe = await fetch(url, { headers: { Cookie: c }, method: 'HEAD', signal: AbortSignal.timeout(FETCH_TIMEOUT) }).catch(() => null);
    if (probe && probe.ok) break;
    if (probe && isAuthProblem(probe.status, probe.headers.get('content-type'))) {
      ersInvalidate();
      const fresh = await ersSessionCookie();
      if (fresh) c = fresh;
    }
    await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }
  return fromUrl(url, { headers: { Cookie: c } });
}

export interface MeasuredB11Point {
  dn: number;
  radiance: number;
  bt11: number;
  l1SceneId: string;
  calibration: B11Calibration;
}

/**
 * Read the measured band-11 TOA radiance + brightness temperature at
 * (lat, lon) from the USGS C2 L1 archive.
 *
 * Returns null (→ caller falls back to the forward-modeled BT11) when no
 * ERS session is available or the scene/pixels cannot be read.
 *
 * Provenance: LandsatLook STAC `landsat-c2l1` (USGS) + ERS session. The
 * `bt11Source` field on the parent thermal record is set to 'measured' only
 * when this function returns a value.
 */
export async function fetchMeasuredB11Point(
  l2SceneId: string, lat: number, lon: number,
): Promise<MeasuredB11Point | null> {
  try {
    const out = await fetchMeasuredB11PointCore(l2SceneId, lat, lon);
    return out;
  } catch (e) {
    console.warn(`[L1-B11] unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function fetchMeasuredB11PointCore(
  l2SceneId: string, lat: number, lon: number,
): Promise<MeasuredB11Point | null> {
  const cookie = await ersSessionCookie();
  if (!cookie) return null;

  const scene = await fetchL1SceneForL2(l2SceneId, lat, lon);
  if (!scene || !scene.epsg) return null;

  const cal = await readB11Calibration(scene.mtlHref, cookie);
  if (!cal) return null;

  proj4.defs(`EPSG:${scene.epsg}`, `+proj=utm +zone=${scene.epsg % 100} +datum=WGS84 +units=m +no_defs`);
  const toUtm = proj4('EPSG:4326', `EPSG:${scene.epsg}`);
  const [ux, uy] = toUtm.forward([lon, lat]);

  try {
    const tiff = await openAuthedCog(scene.b11Href, cookie);
    const image = await tiff.getImage();
    const [xMin, yMin, xMax, yMax] = image.getBoundingBox();
    const w = image.getWidth(), h = image.getHeight();
    const px = Math.round(((ux - xMin) / (xMax - xMin)) * w);
    const py = Math.round(((yMax - uy) / (yMax - yMin)) * h);
    if (px < 0 || px >= w || py < 0 || py >= h) return null;
    const data = await image.readRasters({ window: [px, py, px + 1, py + 1], samples: [0] });
    const dn = data[0]?.[0] as number | undefined;
    if (dn == null || !Number.isFinite(dn) || dn <= 0) return null;
    const l11 = dn * cal.mult + cal.add;
    const bt11 = dnToBt11(dn, cal);
    if (bt11 == null) return null;
    return { dn, radiance: l11, bt11, l1SceneId: scene.id, calibration: cal };
  } catch (e) {
    console.warn(`[L1-B11] COG read failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export interface MeasuredB11Window {
  data: ArrayLike<number>;
  px0: number; py0: number; px1: number; py1: number;
  xMin: number; yMin: number; xMax: number; yMax: number;
  w: number; h: number;
  l1SceneId: string;
  calibration: B11Calibration;
  acquired?: string;
}

const MAX_WINDOW_PX = 2000;

/**
 * Windowed read of measured band-11 DNs covering a lat/lon bbox, for the
 * spatial-grid pipeline. Same overview-fallback logic as the L2 reader:
 * un-georeferenced overviews keep IFD 0 rather than crashing.
 */
export async function fetchMeasuredB11Window(
  l2SceneId: string, latMin: number, latMax: number, lonMin: number, lonMax: number,
): Promise<MeasuredB11Window | null> {
  const cookie = await ersSessionCookie();
  if (!cookie) return null;

  const cLat = (latMin + latMax) / 2, cLon = (lonMin + lonMax) / 2;
  const scene = await fetchL1SceneForL2(
    l2SceneId, cLat, cLon,
    (latMax - latMin) / 2 + 0.1, (lonMax - lonMin) / 2 + 0.1,
  );
  if (!scene || !scene.epsg) return null;

  const cal = await readB11Calibration(scene.mtlHref, cookie);
  if (!cal) return null;

  proj4.defs(`EPSG:${scene.epsg}`, `+proj=utm +zone=${scene.epsg % 100} +datum=WGS84 +units=m +no_defs`);
  const toUtm = proj4('EPSG:4326', `EPSG:${scene.epsg}`);
  const xs: number[] = [], ys: number[] = [];
  for (const [lo, la] of [[lonMin, latMin], [lonMin, latMax], [lonMax, latMin], [lonMax, latMax]] as const) {
    const [x, y] = toUtm.forward([lo, la]);
    xs.push(x); ys.push(y);
  }
  const uxMin = Math.min(...xs), uxMax = Math.max(...xs);
  const uyMin = Math.min(...ys), uyMax = Math.max(...ys);

  try {
    const tiff = await openAuthedCog(scene.b11Href, cookie);
    type TiffImage = Awaited<ReturnType<typeof tiff.getImage>>;
    let image: TiffImage = await tiff.getImage();
    const computeWindow = (img: TiffImage): { px0: number; py0: number; px1: number; py1: number } | null => {
      const [xMin, yMin, xMax, yMax] = img.getBoundingBox();
      const w = img.getWidth(), h = img.getHeight();
      const px0 = Math.max(0, Math.floor(((uxMin - xMin) / (xMax - xMin)) * w));
      const px1 = Math.min(w, Math.ceil(((uxMax - xMin) / (xMax - xMin)) * w));
      const py0 = Math.max(0, Math.floor(((yMax - uyMax) / (yMax - yMin)) * h));
      const py1 = Math.min(h, Math.ceil(((yMax - uyMin) / (yMax - yMin)) * h));
      if (px1 <= px0 || py1 <= py0) return null;
      return { px0, py0, px1, py1 };
    };
    let meta = computeWindow(image);
    if (!meta) return null;
    if (meta.px1 - meta.px0 > MAX_WINDOW_PX || meta.py1 - meta.py0 > MAX_WINDOW_PX) {
      try {
        const ifdCount = await tiff.getImageCount();
        for (let i = 1; i < Math.min(ifdCount, 8); i++) {
          try {
            const ov = await tiff.getImage(i);
            const ovMeta = computeWindow(ov);
            if (ovMeta && ovMeta.px1 - ovMeta.px0 <= MAX_WINDOW_PX && ovMeta.py1 - ovMeta.py0 <= MAX_WINDOW_PX) {
              image = ov; meta = ovMeta; break;
            }
          } catch { break; }
        }
      } catch { /* keep IFD 0 */ }
    }
    const [xMin, yMin, xMax, yMax] = image.getBoundingBox();
    const data = await image.readRasters({
      window: [meta.px0, meta.py0, meta.px1, meta.py1], samples: [0],
    });
    return {
      data: data[0] as ArrayLike<number>,
      px0: meta.px0, py0: meta.py0, px1: meta.px1, py1: meta.py1,
      xMin, yMin, xMax, yMax,
      w: image.getWidth(), h: image.getHeight(),
      l1SceneId: scene.id,
      calibration: cal,
      acquired: scene.acquired,
    };
  } catch {
    ersInvalidate();
    return null;
  }
}
