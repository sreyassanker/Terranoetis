/**
 * NOAA Storm Prediction Center (SPC) Convective Outlook Integration
 *
 * Provides official severe weather forecasts for the United States:
 * - Categorical outlooks (General Thunder → High Risk)
 * - Probabilistic forecasts (tornado, wind, hail percentages)
 * - Updated multiple times daily
 *
 * Data source: https://www.spc.noaa.gov/products/outlook/
 * GIS data: https://www.spc.noaa.gov/gis/
 */

import { logger } from '../observability/logger';

export interface SpcOutlook {
  day: number; // 1-8
  type: 'categorical' | 'tornado' | 'wind' | 'hail';
  timestamp: string;
  issued: string;
  expires: string;
  label: string;
  updateNumber: number;
}

export interface SpcPolygon {
  type: 'Feature';
  properties: {
    DN: number; // Day Number / probability / category value
    LABEL?: string;
    stroke?: string;
    'stroke-width'?: number;
    'stroke-opacity'?: number;
    fill?: string;
    'fill-opacity'?: number;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

export interface SpcGeoJson {
  type: 'FeatureCollection';
  features: SpcPolygon[];
  metadata?: {
    title?: string;
    product?: string;
    issued?: string;
    expires?: string;
  };
}

// Category labels for categorical outlooks
export const CATEGORICAL_LABELS: Record<number, { label: string; color: string; risk: string }> = {
  2: { label: 'General Thunder', color: '#33cc33', risk: 'general' },
  3: { label: 'Marginal Risk', color: '#009900', risk: 'marginal' },
  4: { label: 'Slight Risk', color: '#ffff00', risk: 'slight' },
  5: { label: 'Enhanced Risk', color: '#ff9900', risk: 'enhanced' },
  6: { label: 'Moderate Risk', color: '#ff0000', risk: 'moderate' },
  8: { label: 'High Risk', color: '#ff00ff', risk: 'high' },
};

// Probability labels for probabilistic outlooks
export function getProbabilityLabel(prob: number): string {
  if (prob >= 45) return '≥45%';
  if (prob >= 30) return '30-45%';
  if (prob >= 15) return '15-30%';
  if (prob >= 10) return '10-15%';
  if (prob >= 5) return '5-10%';
  if (prob >= 2) return '2-5%';
  return '<2%';
}

async function fetchOutlook(url: string): Promise<SpcGeoJson | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    return await resp.json() as SpcGeoJson;
  } catch (e) {
    logger.warn({ err: e, url }, 'SPC fetchOutlook failed');
    return null;
  }
}

function getBaseUrls(day: number): { cat: string; tornado: string; wind: string; hail: string } {
  if (day <= 3) {
    return {
      cat: `https://www.spc.noaa.gov/products/outlook/day${day}otlk_cat.nolyr.geojson`,
      tornado: `https://www.spc.noaa.gov/products/outlook/day${day}otlk_torn.nolyr.geojson`,
      wind: `https://www.spc.noaa.gov/products/outlook/day${day}otlk_wind.nolyr.geojson`,
      hail: `https://www.spc.noaa.gov/products/outlook/day${day}otlk_hail.nolyr.geojson`,
    };
  }
  // Days 4-8 use a different path
  return {
    cat: `https://www.spc.noaa.gov/products/exper/day4-8/day${day}otlk_cat.nolyr.geojson`,
    tornado: `https://www.spc.noaa.gov/products/exper/day4-8/day${day}otlk_torn.nolyr.geojson`,
    wind: `https://www.spc.noaa.gov/products/exper/day4-8/day${day}otlk_wind.nolyr.geojson`,
    hail: `https://www.spc.noaa.gov/products/exper/day4-8/day${day}otlk_hail.nolyr.geojson`,
  };
}

/**
 * Fetch all outlooks for a given day (1-8)
 */
export async function fetchDayOutlook(day: number): Promise<{
  categorical: SpcGeoJson | null;
  tornado: SpcGeoJson | null;
  wind: SpcGeoJson | null;
  hail: SpcGeoJson | null;
}> {
  day = Math.min(Math.max(day, 1), 8);
  const urls = getBaseUrls(day);

  const results = await Promise.allSettled([
    fetchOutlook(urls.cat),
    fetchOutlook(urls.tornado),
    fetchOutlook(urls.wind),
    fetchOutlook(urls.hail),
  ]);

  const [catRes, torRes, windRes, hailRes] = results;
  return {
    categorical: catRes.status === 'fulfilled' ? catRes.value : null,
    tornado: torRes.status === 'fulfilled' ? torRes.value : null,
    wind: windRes.status === 'fulfilled' ? windRes.value : null,
    hail: hailRes.status === 'fulfilled' ? hailRes.value : null,
  };
}

/**
 * Check if a point is within any SPC outlook polygon
 */
export function isPointInOutlook(
  lat: number,
  lon: number,
  geojson: SpcGeoJson,
): { inside: boolean; category?: number; label?: string } {
  if (!geojson?.features) return { inside: false };

  // Simple point-in-polygon check using ray casting
  for (const feature of geojson.features) {
    if (isPointInFeature(lat, lon, feature)) {
      const dn = feature.properties?.DN || 0;
      const catInfo = CATEGORICAL_LABELS[dn];
      return {
        inside: true,
        category: dn,
        label: catInfo?.label || `Level ${dn}`,
      };
    }
  }

  return { inside: false };
}

/**
 * Simple ray casting point-in-polygon test
 */
function isPointInFeature(lat: number, lon: number, feature: SpcPolygon): boolean {
  if (!feature.geometry) return false;

  const coords = feature.geometry.coordinates;
  if (!coords) return false;

  // Handle Polygon type
  if (feature.geometry.type === 'Polygon') {
    return isPointInPolygon(lat, lon, coords as number[][][]);
  }

  // Handle MultiPolygon type
  if (feature.geometry.type === 'MultiPolygon') {
    for (const polygon of coords as number[][][][]) {
      if (isPointInPolygon(lat, lon, polygon as number[][][])) return true;
    }
  }

  return false;
}

function isPointInPolygon(lat: number, lon: number, polygon: number[][][]): boolean {
  // GeoJSON coordinates are [lon, lat]
  const ring = polygon[0];
  if (!ring || ring.length < 3) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];

    // GeoJSON coordinates are [lon, lat], so yi/yj are lat, xi/xj are lon
    // We test if lon (our X) is to the left of the edge crossing lat (our Y)
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Get severe weather risk assessment for a location
 */
export async function getRiskForLocation(
  lat: number,
  lon: number,
): Promise<{
  day1: { categorical?: string; tornado?: number; wind?: number; hail?: number };
  day2: { categorical?: string; tornado?: number; wind?: number; hail?: number };
  day3: { categorical?: string; tornado?: number; wind?: number; hail?: number };
}> {
  const result = {
    day1: {} as { categorical?: string; tornado?: number; wind?: number; hail?: number },
    day2: {} as { categorical?: string; tornado?: number; wind?: number; hail?: number },
    day3: {} as { categorical?: string; tornado?: number; wind?: number; hail?: number },
  };

  // Fetch all 3 days
  const [day1Data, day2Data, day3Data] = await Promise.allSettled([
    fetchDayOutlook(1),
    fetchDayOutlook(2),
    fetchDayOutlook(3),
  ]);

  const days = [day1Data, day2Data, day3Data];
  const keys = ['day1', 'day2', 'day3'] as const;

  for (let i = 0; i < 3; i++) {
    const dayRes = days[i];
    const dayResult = dayRes.status === 'fulfilled' ? dayRes.value : null;
    if (!dayResult) continue;

    const dayKey = keys[i];

    // Check categorical
    if (dayResult.categorical) {
      const cat = isPointInOutlook(lat, lon, dayResult.categorical);
      if (cat.inside && cat.label) {
        result[dayKey].categorical = cat.label;
      }
    }

    // Check tornado
    if (dayResult.tornado) {
      const tor = isPointInOutlook(lat, lon, dayResult.tornado);
      if (tor.inside && tor.category) {
        result[dayKey].tornado = tor.category;
      }
    }

    // Check wind
    if (dayResult.wind) {
      const w = isPointInOutlook(lat, lon, dayResult.wind);
      if (w.inside && w.category) {
        result[dayKey].wind = w.category;
      }
    }

    // Check hail
    if (dayResult.hail) {
      const h = isPointInOutlook(lat, lon, dayResult.hail);
      if (h.inside && h.category) {
        result[dayKey].hail = h.category;
      }
    }
  }

  return result;
}

/**
 * Format for Sentinel engine consumption
 */
export function formatForSentinel(geojson: SpcGeoJson): {
  riskLevel: string;
  maxCategory: number;
  polygonCount: number;
  labels: string[];
} {
  if (!geojson?.features || geojson.features.length === 0) {
    return { riskLevel: 'none', maxCategory: 0, polygonCount: 0, labels: [] };
  }

  let maxCat = 0;
  const labels: string[] = [];

  for (const f of geojson.features) {
    const dn = f.properties?.DN || 0;
    if (dn > maxCat) maxCat = dn;
    const cat = CATEGORICAL_LABELS[dn];
    if (cat && !labels.includes(cat.label)) {
      labels.push(cat.label);
    }
  }

  const catInfo = CATEGORICAL_LABELS[maxCat];
  return {
    riskLevel: catInfo?.risk || 'general',
    maxCategory: maxCat,
    polygonCount: geojson.features.length,
    labels,
  };
}
