/**
 * OSRM Walking Route — street-following route from a free public API,
 * then fly it with a camera path. Uses the OSRM public demo server
 * (no API key required). Returns a real street-following route.
 * Based on the walking-profile routing endpoint.
 */

import * as Cesium from 'cesium';

const OSRM_BASE = 'https://router.project-osrm.org';

export interface RouteStep {
  lat: number;
  lon: number;
  distance: number;
  instruction: string;
  duration: number;
}

export interface OSRMResult {
  steps: RouteStep[];
  totalDistance: number;
  totalDuration: number;
  polyline: Array<[number, number]>;
  error?: string;
}

export function decodePolyline(encoded: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

export async function fetchWalkingRoute(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<OSRMResult> {
  const url = `${OSRM_BASE}/route/v1/walking/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=polyline&steps=true&alternatives=false`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return { steps: [], totalDistance: 0, totalDuration: 0, polyline: [], error: `HTTP ${resp.status}` };
    const data = await resp.json();
    if (!data.routes?.length) return { steps: [], totalDistance: 0, totalDuration: 0, polyline: [], error: 'No route found' };
    const route = data.routes[0];
    const polyline = decodePolyline(route.geometry);
    const steps: RouteStep[] = (route.legs?.[0]?.steps ?? []).map((s: {
      maneuver?: { location?: [number, number] | number[]; instruction?: string };
      distance?: number;
      duration?: number;
      name?: string;
    }) => ({
      lat: s.maneuver?.location?.[1] ?? 0,
      lon: s.maneuver?.location?.[0] ?? 0,
      distance: s.distance ?? 0,
      instruction: s.maneuver?.instruction ?? s.name ?? '',
      duration: s.duration ?? 0,
    }));
    return {
      steps,
      totalDistance: route.distance ?? 0,
      totalDuration: route.duration ?? 0,
      polyline,
    };
  } catch (err) {
    return { steps: [], totalDistance: 0, totalDuration: 0, polyline: [], error: String(err) };
  }
}

/**
 * Draw a route polyline on the globe and fly a camera along it.
 * Returns the entity so the caller can remove it later.
 */
export function drawRouteOnGlobe(
  viewer: Cesium.Viewer,
  polyline: Array<[number, number]>,
  color = Cesium.Color.CYAN,
): Cesium.Entity {
  const positions = polyline.map(([lat, lon]) => Cesium.Cartesian3.fromDegrees(lon, lat, 0));
  return viewer.entities.add({
    polyline: {
      positions,
      width: 3,
      material: color,
      clampToGround: true,
    },
  });
}

/**
 * Fly a camera along the route path with banked turns.
 * Uses a simple timed path that follows the route positions.
 */
export function flyRoute(
  viewer: Cesium.Viewer,
  polyline: Array<[number, number]>,
  _duration = 8,
): void {
  if (polyline.length < 2) return;
  // Sample the path at regular intervals
  const sampleCount = Math.min(polyline.length, 60);
  const step = Math.max(1, Math.floor(polyline.length / sampleCount));
  const sampled: Array<[number, number]> = [];
  for (let i = 0; i < polyline.length; i += step) sampled.push(polyline[i]);
  if (sampled[sampled.length - 1] !== polyline[polyline.length - 1]) sampled.push(polyline[polyline.length - 1]);

  // Create a camera path using sampled positions
  const positions = sampled.map(([lat, lon]) => {
    const carto = new Cesium.Cartographic(Cesium.Math.toRadians(lon), Cesium.Math.toRadians(lat), 500);
    return Cesium.Ellipsoid.WGS84.cartographicToCartesian(carto);
  });

  if (positions.length < 2) return;

  // Fly chronologically along the path using a simple callback
  let legIndex = 0;
  const flyNext = () => {
    if (legIndex >= positions.length - 1) return;
    const from = positions[legIndex];
    const to = positions[legIndex + 1];
    const heading = Cesium.Math.toRadians(
      Math.atan2(
        Cesium.Math.toDegrees(to.y) - Cesium.Math.toDegrees(from.y),
        Cesium.Math.toDegrees(to.x) - Cesium.Math.toDegrees(from.x),
      ) * (180 / Math.PI)
    );
    const pitch = Cesium.Math.toRadians(-20 + (legIndex % 2 === 0 ? 0 : -5));
    viewer.camera.flyTo({
      destination: to,
      orientation: { heading, pitch, roll: 0 },
      duration: 2.0,
      complete: () => {
        legIndex++;
        setTimeout(flyNext, 100);
      },
    });
  };
  flyNext();
}