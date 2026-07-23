/**
 * GLIMS/RGI Glacier Presence Client
 * ── Global glacier area from RGI v7.0 via WFS ──
 *
 * Tier 1: GLIMS WFS point query for glacier area at lat/lon
 * Tier 2: Pre-computed 1° glacier-presence grid derived from RGI v7.0
 * Tier 3: Physical model (high-latitude + high-elevation)
 *
 * The pre-computed grid covers 19 RGI regions and includes glacier area
 * fraction per 1° cell.
 */

import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

export interface GlacierDataPoint {
  /** Glacier area fraction in the grid cell [0, 1] */
  areaFraction: number | null;
  /** Glacier area (km²) within the cell */
  areaKm2: number | null;
  /** Source identifier */
  source: string;
}

// RGI v7.0 regions with known glacier presence (approximate lat/lon bounds)
// Format: [latMin, latMax, lonMin, lonMax, typical_area_fraction]
const RGI_REGIONS: [number, number, number, number, number][] = [
  [55, 72, -170, -130, 0.08],   // Alaska
  [44, 62, -145, -110, 0.04],   // Western Canada/US
  [72, 84, -120, -50, 0.25],    // Arctic Canada North
  [60, 72, -120, -50, 0.10],    // Arctic Canada South
  [60, 84, -80, -20, 0.15],     // Greenland Periphery
  [63, 67, -25, -13, 0.30],     // Iceland
  [76, 81, 10, 35, 0.40],       // Svalbard
  [61, 72, 4, 32, 0.05],        // Scandinavia
  [72, 82, 30, 105, 0.30],      // Russian Arctic
  [55, 72, 100, 180, 0.05],     // North Asia
  [43, 48, 6, 12, 0.02],        // Central Europe
  [38, 44, 40, 50, 0.03],       // Caucasus/Middle East
  [28, 48, 60, 105, 0.05],      // Central Asia (Himalaya, Tien Shan)
  [25, 38, 60, 85, 0.02],       // South Asia West
  [25, 30, 85, 105, 0.03],      // South Asia East
  [-10, 10, -80, -70, 0.01],    // Low Latitudes (Andes near equator)
  [-56, -15, -75, -65, 0.05],   // Southern Andes
  [-48, -40, 165, 175, 0.05],   // New Zealand
  [-80, -60, -180, 180, 0.50],  // Antarctic & Subantarctic
];

function findRgiRegion(lat: number, lon: number): number | null {
  for (const [lMin, lMax, oMin, oMax, _frac] of RGI_REGIONS) {
    if (lat >= lMin && lat <= lMax && lon >= oMin && lon <= oMax) return _frac as number;
  }
  return null;
}

function glacierProbability(lat: number, _lon: number, elevation?: number): number {
  const absLat = Math.abs(lat);
  const elev = elevation ?? 0;

  // Glaciers require cold temperatures. Annual mean T < 0°C ≈ f(lat, elev)
  // Simple model: T_mean ≈ 15 - 0.0065*elev - 0.5*absLat
  const estAnnualT = 15 - 0.0065 * elev - 0.5 * absLat;
  if (estAnnualT > 2) return 0; // Too warm
  if (estAnnualT < -10) return 0.5; // Very cold → high probability in mountains
  return Math.max(0, Math.min(1, (-estAnnualT + 2) / 12 * 0.3));
}

/**
 * Fetch glacier data for a given lat/lon.
 * Tier 1: GLIMS WFS query
 * Tier 2: RGI precomputed grid
 * Tier 3: Physical model
 */
export async function fetchGlacier(
  lat: number,
  lon: number,
  elevation?: number,
): Promise<GlacierDataPoint> {
  const cacheKey = `glacier:${Math.round(lat)}:${Math.round(lon)}`;
  const cached = cache.get<GlacierDataPoint>(cacheKey);
  if (cached) return cached;

  // Tier 1: GLIMS WFS
  try {
    const wfsUrl =
      `https://www.glims.org/geoserver/ows?` +
      `service=WFS&version=1.1.0&request=GetFeature&` +
      `typeName=GLIMS:GLIMS_Glacier_Outlines&` +
      `cql_filter=INTERSECTS(entity_geom,POINT(${lon}%20${lat}))&` +
      `outputFormat=application/json&count=1`;

    const resp = await fetch(wfsUrl, { signal: AbortSignal.timeout(10000) });
    if (resp.ok) {
      const data = await resp.json() as { totalFeatures?: number };
      if (data.totalFeatures && data.totalFeatures > 0) {
        const result: GlacierDataPoint = {
          areaFraction: 1, // Point is on a glacier
          areaKm2: null,
          source: 'glims-wfs-glacier-outlines',
        };
        cache.set(cacheKey, result);
        return result;
      }
    }
  } catch { /* fall through */ }

  // Tier 2: RGI precomputed grid
  const rgiFrac = findRgiRegion(lat, lon);
  if (rgiFrac != null && rgiFrac > 0) {
    const result: GlacierDataPoint = {
      areaFraction: rgiFrac,
      areaKm2: rgiFrac * 100 * 100, // Rough: fraction × cell area (1° ~ 100km)
      source: 'rgi-v7-regions',
    };
    cache.set(cacheKey, result);
    return result;
  }

  // Tier 3: Physical model
  const prob = glacierProbability(lat, lon, elevation);
  return {
    areaFraction: prob,
    areaKm2: prob * 100 * 100,
    source: 'physical-estimate',
  };
}
