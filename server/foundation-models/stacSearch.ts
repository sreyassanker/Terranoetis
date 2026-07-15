/**
 * NASA CMR STAC API Search — Programmatic Discovery of NASA Data
 *
 * Enables single-query search across all 12 DAACs:
 * - Landsat, MODIS, GRACE, GEDI, SMAP, etc.
 * - 178+ petabytes of Earth observation data
 * - Spatial, temporal, and cloud-cover filtering
 *
 * CMR STAC API: https://cmr.earthdata.nasa.gov/stac
 * Docs: https://cmr.earthdata.nasa.gov/stac/docs/
 *
 * Set NASA_EARTHDATA_TOKEN in server/.env for authenticated access.
 */

import { logger } from '../observability/logger';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface StacCollection {
  id: string;
  title: string;
  description: string;
  providers: Array<{ name: string; roles: string[] }>;
  keywords: string[];
  'gee:type'?: string;
  extent: {
    spatial: { bbox: number[][] };
    temporal: { interval: string[][] };
  };
}

export interface StacItem {
  id: string;
  collection: string;
  geometry: GeoJSON.Geometry;
  properties: {
    datetime: string;
    'eo:cloud_cover'?: number;
    title?: string;
    description?: string;
    [key: string]: unknown;
  };
  assets: Record<string, {
    href: string;
    title?: string;
    type?: string;
    roles?: string[];
  }>;
  links: Array<{ rel: string; href: string }>;
}

export interface StacSearchParams {
  query?: string;
  collections?: string[];
  bbox?: number[];  // [west, south, east, north]
  datetime?: string;  // ISO 8601 interval
  limit?: number;
  cloudCover?: number;  // max cloud cover percentage
}

export interface StacSearchResult {
  items: StacItem[];
  numberMatched: number;
  numberReturned: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// API Configuration
// ═══════════════════════════════════════════════════════════════════════════

const CMR_STAC_BASE = 'https://cmr.earthdata.nasa.gov/stac';
const CMR_SEARCH_BASE = 'https://cmr.earthdata.nasa.gov/search';

// ═══════════════════════════════════════════════════════════════════════════
// Core API Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search STAC items using the CMR STAC API
 */
export async function searchStacItems(params: StacSearchParams): Promise<StacSearchResult> {
  const searchBody: Record<string, unknown> = {
    limit: params.limit || 20,
  };

  if (params.collections?.length) {
    searchBody.collections = params.collections;
  }

  if (params.bbox) {
    searchBody.bbox = params.bbox;
  }

  if (params.datetime) {
    searchBody.datetime = params.datetime;
  }

  if (params.query) {
    searchBody.query = params.query;
  }

  try {
    const response = await fetch(`${CMR_STAC_BASE}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/geo+json',
      },
      body: JSON.stringify(searchBody),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      throw new Error(`CMR STAC returned ${response.status}`);
    }

    const data = await response.json() as GeoJSON.FeatureCollection & {
      numberMatched: number;
      numberReturned: number;
    };

    const items = (data.features || []).map((f) => ({
      id: f.id as string,
      collection: f.properties?.collection as string || '',
      geometry: f.geometry as GeoJSON.Geometry,
      properties: (f.properties || {}) as StacItem['properties'],
      assets: {},
      links: [],
    })) as StacItem[];

    return {
      items,
      numberMatched: data.numberMatched || items.length,
      numberReturned: data.numberReturned || items.length,
    };
  } catch (e) {
    logger.error({ err: e }, '[STAC] Search failed');
    return { items: [], numberMatched: 0, numberReturned: 0 };
  }
}

/**
 * Search with cloud cover filter using CMR query syntax
 */
export async function searchWithCloudCover(params: StacSearchParams): Promise<StacSearchResult> {
  const searchBody: Record<string, unknown> = {
    limit: params.limit || 20,
    conditions: [] as Record<string, unknown>[],
  };

  if (params.collections?.length) {
    (searchBody.conditions as Record<string, unknown>[]).push({
      collection_short_name: { in: params.collections },
    });
  }

  if (params.bbox) {
    searchBody.bbox = params.bbox;
  }

  if (params.datetime) {
    searchBody.datetime = params.datetime;
  }

  if (params.cloudCover !== undefined) {
    (searchBody.conditions as Record<string, unknown>[]).push({
      'eo:cloud_cover': { lte: params.cloudCover },
    });
  }

  try {
    const response = await fetch(`${CMR_STAC_BASE}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/geo+json',
      },
      body: JSON.stringify(searchBody),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      throw new Error(`CMR STAC returned ${response.status}`);
    }

    const data = await response.json() as GeoJSON.FeatureCollection & {
      numberMatched: number;
      numberReturned: number;
    };

    const items = (data.features || []).map((f) => ({
      id: f.id as string,
      collection: f.properties?.collection as string || '',
      geometry: f.geometry as GeoJSON.Geometry,
      properties: (f.properties || {}) as StacItem['properties'],
      assets: {},
      links: [],
    })) as StacItem[];

    return {
      items,
      numberMatched: data.numberMatched || items.length,
      numberReturned: data.numberReturned || items.length,
    };
  } catch (e) {
    logger.error({ err: e }, '[STAC] Search with cloud cover failed');
    return { items: [], numberMatched: 0, numberReturned: 0 };
  }
}

/**
 * List available STAC collections from CMR
 */
export async function listStacCollections(limit: number = 50): Promise<StacCollection[]> {
  try {
    const response = await fetch(`${CMR_STAC_BASE}/collections?limit=${limit}`, {
      headers: { 'Accept': 'application/geo+json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`CMR STAC collections returned ${response.status}`);
    }

    const data = await response.json() as GeoJSON.FeatureCollection;
    return (data.features || []).map((f) => ({
      id: f.id as string,
      title: (f.properties?.title as string) || '',
      description: (f.properties?.description as string) || '',
      providers: (f.properties?.providers as StacCollection['providers']) || [],
      keywords: (f.properties?.keywords as string[]) || [],
      extent: (f.properties?.extent as StacCollection['extent']) || {
        spatial: { bbox: [[-180, -90, 180, 90]] },
        temporal: { interval: [['', '']] },
      },
    }));
  } catch (e) {
    logger.error({ err: e }, '[STAC] Failed to list collections');
    return [];
  }
}

/**
 * Get download links for a STAC item
 */
export function getItemDownloadLinks(item: StacItem): Array<{
  name: string;
  href: string;
  type?: string;
}> {
  return Object.entries(item.assets).map(([key, asset]) => ({
    name: asset.title || key,
    href: asset.href,
    type: asset.type,
  }));
}
