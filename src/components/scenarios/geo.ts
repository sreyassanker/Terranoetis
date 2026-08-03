/** Mean Earth radius (IUGG) in kilometres. */
export const EARTH_RADIUS_KM = 6371.0;

/** Local scale: kilometers per degree of latitude. */
export const KM_PER_DEG_LAT = (EARTH_RADIUS_KM * Math.PI) / 180; // ≈ 111.1949

/** Great-circle distance in kilometres (spherical haversine). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Convert a center + radius (km) to a lat/lon bounding box in **degrees**.
 * Latitude shrink is uniform; longitude shrink grows with cos(lat).
 * Near the poles (or when the radius crosses a pole) the longitude span is
 * clamped to [-180, 180] — the whole hemisphere is in view.
 */
export function circleBbox(
  center: { lat: number; lon: number },
  radiusKm: number,
): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const minLat = Math.max(-90, center.lat - dLat);
  const maxLat = Math.min(90, center.lat + dLat);
  // Circle crosses a pole → bbox must cover every longitude.
  if (minLat <= -90 || maxLat >= 90 || center.lat >= 90 || center.lat <= -90) {
    return { minLat, maxLat, minLon: -180, maxLon: 180 };
  }
  const cosLat = Math.cos(center.lat * (Math.PI / 180));
  const dLon = radiusKm / (KM_PER_DEG_LAT * Math.max(Math.abs(cosLat), 1e-6));
  return {
    minLat,
    maxLat,
    minLon: Math.max(-180, center.lon - dLon),
    maxLon: Math.min(180, center.lon + dLon),
  };
}
