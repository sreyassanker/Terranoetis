// Shared geographic lookup types used by both server and frontend
// Maps string keys (ISO2/ISO3 country codes, WHO region codes) to [latitude, longitude]

/** Geographic coordinate tuple [latitude, longitude] */
export type GeoCoordinates = [latitude: number, longitude: number];

/** Geographic lookup table mapping codes to coordinates */
export type GeoLookup = Record<string, GeoCoordinates>;

/** Helper to safely look up coordinates with fallback to [0, 0] */
export function getCoordinates(lookup: GeoLookup, code: string): GeoCoordinates {
  return lookup[code] || lookup[code.toUpperCase()] || [0, 0];
}

/** Check if coordinates are valid (non-zero) */
export function isValidCoordinates(coords: GeoCoordinates): boolean {
  return !(coords[0] === 0 && coords[1] === 0);
}
