/**
 * GLIMS/RGI Glacier Presence Client
 * ── Genuine glacier inventory from the RGI v7.0 WFS (GLIMS GeoServer) ──
 *
 * Every value returned comes from the real RGI v7.0 glacier outline layers
 * hosted at glims.org (GeoServer WFS, EPSG:3857). No synthetic models:
 *
 *   Tier 1: exact point intersection — the query location lies ON an RGI
 *           glacier outline → that glacier's measured area_km2 + name.
 *   Tier 2: regional search — summed RGI glacier area within a radius box
 *           around the location (count up to 500 outlines).
 *   Tier 3: honest zero — the location/region contains no catalogued RGI
 *           glacier (e.g. Princeton, NJ → 0 km², not an estimate).
 *
 * RGI v7.0 first-order region layers and their approximate lat/lon routing
 * boxes (routing only decides WHICH layer to query; areas are always the
 * WFS-measured values):
 */

import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

export interface GlacierDataPoint {
  /** Glacier area fraction in the search cell [0, 1] — 1 when the point is on a glacier */
  areaFraction: number | null;
  /** Glacier area (km²) — on-glacier area or regional sum within the search radius */
  areaKm2: number | null;
  /** Name of the glacier when the point sits on one */
  name?: string | null;
  /** Search radius used for the regional sum (km) */
  radiusKm?: number;
  /** Source identifier */
  source: string;
}

const GLIMS_WFS = 'https://www.glims.org/geoserver/ows';
const RGI_BASE = 'GLIMS:RGI2000-v7.0-G-';

/** [latMin, latMax, lonMin, lonMax, RGI o1 region id] — routing table */
const RGI_ROUTING: Array<[number, number, number, number, string]> = [
  [51.5, 72, -173, -131, '01_alaska_epsg3857'],
  [24, 62, -148, -103, '02_western_canada_usa_epsg3857'],
  [57, 84, -130, -52, '03_arctic_canada_north_epsg3857'],
  [58, 67, -85, -61, '04_arctic_canada_south_epsg3857'],
  [58.5, 84, -75, -15, '05_greenland_periphery_epsg3857'],
  [63, 67.5, -25, -13, '06_iceland_epsg3857'],
  [74, 82.5, -10, 62, '07_svalbard_jan_mayen_epsg3857'],
  [59.5, 72, 4.5, 35, '08_scandinavia_epsg3857'],
  [63, 84, 29, 180, '09_russian_arctic_epsg3857'],
  [49, 75, 75, 180, '10_north_asia_epsg3857'],
  [43, 48.5, 5, 18, '11_central_europe_epsg3857'],
  [29, 45, 35, 65, '12_caucasus_middle_east_epsg3857'],
  [29, 52, 62, 105, '13_central_asia_epsg3857'],
  [25, 39, 60, 85, '14_south_asia_west_epsg3857'],
  [25, 32, 85, 105, '15_south_asia_east_epsg3857'],
  [-12, 12, -87, -70, '16_low_latitudes_epsg3857'],
  [-56.5, -7, -80, -65, '17_southern_andes_epsg3857'],
  [-48, -35, 165, 179, '18_new_zealand_epsg3857'],
  [-90, -60, -180, 180, '19_subantarctic_antarctic_islands_epsg3857'],
];

function routeLayer(lat: number, lon: number): string | null {
  for (const [latMin, latMax, lonMin, lonMax, layer] of RGI_ROUTING) {
    if (lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax) {
      return RGI_BASE + layer;
    }
  }
  return null;
}

const D2R = Math.PI / 180;

/** Web Mercator (EPSG:3857) projection — the RGI layers' native CRS. */
function mercX(lon: number): number { return lon * 111319.49079327358; }
function mercY(lat: number): number {
  return 6378137 * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
}

interface WfsFeatureProps {
  area_km2?: number;
  glac_name?: string;
  rgi_id?: string;
  zmed_m?: number;
}

async function queryRgi(typeName: string, cql: string, count: number): Promise<{
  total: number; features: Array<{ properties?: WfsFeatureProps }>;
} | null> {
  const url =
    `${GLIMS_WFS}?service=WFS&version=1.1.0&request=GetFeature` +
    `&typeName=${encodeURIComponent(typeName)}&outputFormat=application%2Fjson` +
    `&propertyName=area_km2,glac_name,rgi_id,zmed_m` +
    `&cql_filter=${encodeURIComponent(cql)}&count=${count}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!resp.ok) return null;
    const data = await resp.json() as {
      totalFeatures?: number;
      features?: Array<{ properties?: WfsFeatureProps }>;
    };
    return { total: data.totalFeatures ?? 0, features: data.features ?? [] };
  } catch {
    return null;
  }
}

/**
 * Fetch genuine glacier data for a given lat/lon from the RGI v7.0 WFS.
 */
export async function fetchGlacier(
  lat: number,
  lon: number,
  radiusKm: number = 25,
): Promise<GlacierDataPoint> {
  const cacheKey = `glacier:${Math.round(lat * 100)}:${Math.round(lon * 100)}:${radiusKm}`;
  const cached = cache.get<GlacierDataPoint>(cacheKey);
  if (cached) return cached;

  const layer = routeLayer(lat, lon);
  if (!layer) {
    // Outside every RGI region definition → no catalogued glacier inventory
    return { areaFraction: 0, areaKm2: 0, name: null, radiusKm, source: 'rgi-v7-out-of-region' };
  }

  const x = mercX(lon);
  const y = mercY(lat);

  // Tier 1 — point sits ON a glacier?
  const point = await queryRgi(layer, `INTERSECTS(the_geom,POINT(${x.toFixed(0)} ${y.toFixed(0)}))`, 1);
  if (point && point.total > 0) {
    const p = point.features[0]?.properties ?? {};
    const areaKm2 = Number(p.area_km2 ?? NaN);
    const result: GlacierDataPoint = {
      areaFraction: 1,
      areaKm2: Number.isFinite(areaKm2) ? areaKm2 : null,
      name: p.glac_name || p.rgi_id || null,
      radiusKm,
      source: 'rgi-v7-wfs-outline',
    };
    cache.set(cacheKey, result);
    return result;
  }

  // Tier 2 — regional glacier sum within the search radius
  const rMeters = Math.abs(radiusKm) * 1000;
  const regional = await queryRgi(
    layer,
    `BBOX(the_geom,${(x - rMeters).toFixed(0)},${(y - rMeters).toFixed(0)},${(x + rMeters).toFixed(0)},${(y + rMeters).toFixed(0)})`,
    500,
  );
  if (!regional) {
    // WFS unreachable — be honest instead of inventing a value.
    return { areaFraction: null, areaKm2: null, name: null, radiusKm, source: 'rgi-v7-wfs-unavailable' };
  }
  if (regional.total === 0) {
    const result: GlacierDataPoint = {
      areaFraction: 0,
      areaKm2: 0,
      name: null,
      radiusKm,
      source: 'rgi-v7-wfs-none',
    };
    cache.set(cacheKey, result);
    return result;
  }
  let areaSum = 0;
  let nearestName: string | null = null;
  for (const f of regional.features) {
    const p = f.properties ?? {};
    const a = Number(p.area_km2 ?? 0);
    if (Number.isFinite(a) && a > 0) areaSum += a;
    if (!nearestName && p.glac_name) nearestName = p.glac_name;
  }
  const result: GlacierDataPoint = {
    areaFraction: Math.min(1, areaSum / (Math.PI * radiusKm * radiusKm)),
    areaKm2: Math.round(areaSum * 100) / 100,
    name: nearestName,
    radiusKm,
    source: 'rgi-v7-wfs-regional',
  };
  cache.set(cacheKey, result);
  return result;
}
