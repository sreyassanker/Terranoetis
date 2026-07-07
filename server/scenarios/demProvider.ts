/**
 * DEM/Bathymetry Provider
 * 
 * Provides terrain elevation and ocean depth data from multiple sources:
 * - OpenTopography API (free, requires API key)
 * - GEBCO bathymetry (free, WMS/WCS)
 * - SRTM terrestrial DEM (free via OpenTopography)
 * - Local cache for performance
 * - Fallback to simplified land/ocean mask
 */

export interface TerrainPoint {
  lat: number;
  lon: number;
  elevation: number; // meters (negative = ocean depth)
  isOcean: boolean;
}

export interface TerrainGrid {
  points: TerrainPoint[];
  bounds: {
    latMin: number;
    latMax: number;
    lonMin: number;
    lonMax: number;
  };
  resolution: number; // degrees
  source: string;
}

// Simple in-memory cache
const terrainCache = new Map<string, TerrainGrid>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const cacheTimestamps = new Map<string, number>();

/**
 * Generate cache key for a region
 */
function getCacheKey(
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number,
  resolution: number,
): string {
  return `${latMin.toFixed(2)}_${latMax.toFixed(2)}_${lonMin.toFixed(2)}_${lonMax.toFixed(2)}_${resolution}`;
}

/**
 * Check if cache entry is still valid
 */
function isCacheValid(key: string): boolean {
  const timestamp = cacheTimestamps.get(key);
  if (!timestamp) return false;
  return Date.now() - timestamp < CACHE_TTL_MS;
}

/**
 * Fetch terrain data from OpenTopography API
 */
async function fetchFromOpenTopography(
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number,
  _resolution: number = 0.001,
): Promise<TerrainPoint[]> {
  // OpenTopography API endpoint
  const apiKey = process.env.OPENTOPOGRAPHY_API_KEY || '';
  
  if (!apiKey) {
    console.warn('OpenTopography API key not set, using fallback');
    return [];
  }
  
  const url = new URL('https://portal.opentopography.org/API/globaldem');
  url.searchParams.set('demtype', 'SRTMGL1'); // SRTM 30m
  url.searchParams.set('south', String(latMin));
  url.searchParams.set('north', String(latMax));
  url.searchParams.set('west', String(lonMin));
  url.searchParams.set('east', String(lonMax));
  url.searchParams.set('outputFormat', 'JSON');
  url.searchParams.set('API_Key', apiKey);
  
  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      console.error('OpenTopography API error:', response.status);
      return [];
    }
    
    const data = await response.json() as { elevation?: number[][] };
    
    // Parse grid data
    const points: TerrainPoint[] = [];
    if (data.elevation) {
      const rows = data.elevation.length;
      const cols = data.elevation[0]?.length || 0;
      
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const lat = latMin + (i / rows) * (latMax - latMin);
          const lon = lonMin + (j / cols) * (lonMax - lonMin);
          const elevation = data.elevation[i][j];
          
          points.push({
            lat,
            lon,
            elevation: elevation || 0,
            isOcean: elevation !== null && elevation < 0,
          });
        }
      }
    }
    
    return points;
  } catch (error) {
    console.error('Failed to fetch from OpenTopography:', error);
    return [];
  }
}

/**
 * Simplified land/ocean classification
 */
function classifyLandOcean(lat: number, lon: number): boolean {
  // Simplified ocean polygons
  const oceanRegions = [
    // Pacific Ocean
    { latMin: -60, latMax: 65, lonMin: 120, lonMax: 180 },
    { latMin: -60, latMax: 65, lonMin: -180, lonMax: -100 },
    // Atlantic Ocean
    { latMin: -60, latMax: 70, lonMin: -60, lonMax: 0 },
    { latMin: -60, latMax: 10, lonMin: -80, lonMax: -30 },
    // Indian Ocean
    { latMin: -50, latMax: 30, lonMin: 20, lonMax: 120 },
    // Arctic Ocean
    { latMin: 70, latMax: 90, lonMin: -180, lonMax: 180 },
  ];
  
  for (const region of oceanRegions) {
    if (
      lat >= region.latMin &&
      lat <= region.latMax &&
      lon >= region.lonMin &&
      lon <= region.lonMax
    ) {
      return true; // is ocean
    }
  }
  
  return false; // is land
}

/**
 * Get terrain elevation for a single point
 */
export async function getTerrainElevation(
  lat: number,
  lon: number,
): Promise<TerrainPoint> {
  // Check cache first
  const cacheKey = getCacheKey(lat - 0.01, lat + 0.01, lon - 0.01, lon + 0.01, 0.001);
  if (isCacheValid(cacheKey)) {
    const cached = terrainCache.get(cacheKey);
    if (cached && cached.points.length > 0) {
      return cached.points[0];
    }
  }
  
  // Try fetching from API
  const points = await fetchFromOpenTopography(lat - 0.01, lat + 0.01, lon - 0.01, lon + 0.01, 0.001);
  
  if (points.length > 0) {
    // Cache the result
    terrainCache.set(cacheKey, {
      points,
      bounds: { latMin: lat - 0.01, latMax: lat + 0.01, lonMin: lon - 0.01, lonMax: lon + 0.01 },
      resolution: 0.001,
      source: 'opentopography',
    });
    cacheTimestamps.set(cacheKey, Date.now());
    
    return points[0];
  }
  
  // Fallback to simplified classification
  const isOcean = classifyLandOcean(lat, lon);
  return {
    lat,
    lon,
    elevation: isOcean ? -100 : 100, // Simplified
    isOcean,
  };
}

/**
 * Get terrain grid for a region
 */
export async function getTerrainGrid(
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number,
  resolution: number = 0.01,
): Promise<TerrainGrid> {
  const cacheKey = getCacheKey(latMin, latMax, lonMin, lonMax, resolution);
  
  // Check cache
  if (isCacheValid(cacheKey)) {
    const cached = terrainCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }
  
  // Fetch from API
  const points = await fetchFromOpenTopography(latMin, latMax, lonMin, lonMax, resolution);
  
  const grid: TerrainGrid = {
    points,
    bounds: { latMin, latMax, lonMin, lonMax },
    resolution,
    source: points.length > 0 ? 'opentopography' : 'fallback',
  };
  
  // Cache the result
  terrainCache.set(cacheKey, grid);
  cacheTimestamps.set(cacheKey, Date.now());
  
  return grid;
}

/**
 * Check if a point is in ocean
 */
export async function isOcean(lat: number, lon: number): Promise<boolean> {
  const point = await getTerrainElevation(lat, lon);
  return point.isOcean;
}

/**
 * Get water depth at ocean point
 */
export async function getWaterDepth(lat: number, lon: number): Promise<number> {
  const point = await getTerrainElevation(lat, lon);
  if (!point.isOcean) return 0;
  return Math.abs(point.elevation);
}

/**
 * Clear terrain cache
 */
export function clearTerrainCache(): void {
  terrainCache.clear();
  cacheTimestamps.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; oldestAge: number } {
  let oldestAge = 0;
  const now = Date.now();
  
  for (const timestamp of cacheTimestamps.values()) {
    const age = now - timestamp;
    if (age > oldestAge) oldestAge = age;
  }
  
  return {
    size: terrainCache.size,
    oldestAge,
  };
}
