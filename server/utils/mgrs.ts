/**
 * MGRS (Military Grid Reference System) Coordinate Engine
 *
 * Converts between lat/lon and MGRS coordinate strings.
 * MGRS is the standard coordinate system used by NATO military forces.
 * Reference: NGA Standardization Document MGRS-ReferenceGuide
 *
 * Uses the `mgrs` npm package for core conversions.
 */

declare module 'mgrs' {
  function forward(lonlat: [number, number], accuracy?: number): string;
  function toPoint(mgrsString: string): [number, number];
}
import mgrs from 'mgrs';

export interface MgrsResult {
  mgrs: string;
  lat: number;
  lon: number;
  zone: number;
  band: string;
  precision: number;
}

export interface LatLonResult {
  lat: number;
  lon: number;
  mgrs: string;
}

/**
 * Convert lat/lon to MGRS string
 * @param lat Latitude (-90 to 90)
 * @param lon Longitude (-180 to 180)
 * @param precision MGRS precision (1-5, default 5 = 1m)
 * @returns MGRS result with zone/band info
 */
export function latLonToMgrs(lat: number, lon: number, precision: number = 5): MgrsResult | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (precision < 1 || precision > 5) precision = 5;

  try {
    const mgrsString = mgrs.forward([lon, lat], precision);
    // Parse zone and band from MGRS string (first 3 chars: zone number + band letter)
    const zone = parseInt(mgrsString.substring(0, 2), 10);
    const band = mgrsString.substring(2, 3);

    return {
      mgrs: mgrsString,
      lat,
      lon,
      zone,
      band,
      precision,
    };
  } catch {
    return null;
  }
}

/**
 * Convert MGRS string to lat/lon
 * @param mgrsString MGRS coordinate string (e.g., "33UXP0500045000")
 * @returns Lat/lon result
 */
export function mgrsToLatLon(mgrsString: string): LatLonResult | null {
  if (!mgrsString || typeof mgrsString !== 'string') return null;

  try {
    const cleaned = mgrsString.trim().toUpperCase();
    const point = mgrs.toPoint(cleaned);
    if (!point || !Array.isArray(point) || point.length < 2) return null;

    const [lon, lat] = point;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return { lat, lon, mgrs: cleaned };
  } catch {
    return null;
  }
}

/**
 * Parse MGRS string to extract components
 * @param mgrsString MGRS coordinate string
 * @returns Parsed components or null
 */
export function parseMgrs(mgrsString: string): {
  zone: number;
  band: string;
  easting: string;
  northing: string;
  raw: string;
} | null {
  if (!mgrsString) return null;

  const cleaned = mgrsString.trim().toUpperCase();
  // MGRS format: ZB (zone+band) + EE (easting) + NN (northing)
  // Zone: 2 digits, Band: 1 letter (C-X, excluding I and O), Easting/Northing: 2-5 digits each
  const match = cleaned.match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z]{1,5})(\d{1,5})$/i);
  if (!match) return null;

  const zone = parseInt(match[1], 10);
  const band = match[2].toUpperCase();
  const easting = match[3];
  const northing = match[4];

  return { zone, band, easting, northing, raw: cleaned };
}

/**
 * Get grid zone designation from lat/lon
 * Returns the UTM zone number and MGRS latitude band
 */
export function getGridZone(lat: number, lon: number): { zone: number; band: string } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -80 || lat > 84) return null;

  // UTM zone calculation
  const zone = Math.floor((lon + 180) / 6) + 1;

  // MGRS latitude band (C-X, 8° each, excluding I and O)
  const bands = 'CDEFGHJKLMNPQRSTUVWX';
  const bandIndex = Math.floor((lat + 80) / 8);
  const band = bands[Math.min(bandIndex, bands.length - 1)];

  return { zone, band };
}

/**
 * Get available MGRS precisions with their descriptions
 */
export function getPrecisionLevels(): Array<{ precision: number; label: string; resolution: string }> {
  return [
    { precision: 1, label: '100km', resolution: '100,000m' },
    { precision: 2, label: '10km', resolution: '10,000m' },
    { precision: 3, label: '1km', resolution: '1,000m' },
    { precision: 4, label: '100m', resolution: '100m' },
    { precision: 5, label: '10m', resolution: '10m' },
  ];
}
