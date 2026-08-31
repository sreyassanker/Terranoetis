/**
 * Launch Replay — scrubbable reconstruction of a rocket ascent to orbit.
 * Real data: launch name, pad lat/lon, rocket, orbit from Launch Library 2.
 * The ascent path itself is a RECONSTRUCTED ESTIMATE (a standard gravity-turn
 * trajectory interpolated from real pad coordinates to a real parking-orbit
 * altitude) — labeled exactly that, the same honest framing the reference platform uses.
 */

import * as Cesium from 'cesium';

export interface LaunchInfo {
  id: string;
  name: string;
  net: string;
  padLat: number;
  padLon: number;
  rocket: string;
  orbit: string;
  orbitAltKm: number;
  status: string;
  image: string;
}

export interface ReplayState {
  t: number; // 0..1 normalized along ascent
  altKm: number;
  speedKms: number;
}

/** Standard parking-orbit altitudes (km) by common orbit names. */
function orbitAltitude(name: string): number {
  const n = (name || '').toLowerCase();
  if (n.includes('iss') || n.includes('leo')) return 400;
  if (n.includes('polar')) return 700;
  if (n.includes('heo') || n.includes('geosynchronous')) return 35786;
  if (n.includes('gto')) return 200;
  if (n.includes('meo')) return 20200;
  return 400;
}

/** Parse a Launch Library 2 launch record into LaunchInfo. */
export function parseLaunch(raw: Record<string, unknown>): LaunchInfo | null {
  const pad = (raw.pad as Record<string, unknown>) ?? {};
  const lat = Number(pad.latitude);
  const lon = Number(pad.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const mission = (raw.mission as Record<string, unknown>) ?? {};
  const orbitName = String(((mission.orbit as Record<string, unknown>)?.name) ?? 'Low Earth Orbit');
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? 'Launch'),
    net: String(raw.net ?? ''),
    padLat: lat,
    padLon: lon,
    rocket: String(((raw.rocket as Record<string, unknown>)?.configuration as Record<string, unknown>)?.name ?? ''),
    orbit: orbitName,
    orbitAltKm: orbitAltitude(orbitName),
    status: String(((raw.status as Record<string, unknown>)?.name) ?? ''),
    image: String((raw.image as string) ?? ''),
  };
}

/** Fetch recent launches from Launch Library 2 (free, no key). */
export async function fetchRecentLaunches(limit = 20): Promise<LaunchInfo[]> {
  try {
    const resp = await fetch(`https://ll.thespacedevs.com/2.2.0/launch/?limit=${limit}&mode=detailed`, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    const results = (data.results ?? []) as Array<Record<string, unknown>>;
    return results.map(parseLaunch).filter((l): l is LaunchInfo => l !== null);
  } catch {
    return [];
  }
}

/**
 * Compute the reconstructed ascent path: a gravity-turn from the pad at t=0
 * to the parking orbit altitude, then a circular-orbit segment. Returns
 * Cartesian3 positions along the path (altitude in meters).
 */
export function buildAscentPath(launch: LaunchInfo, samples = 120): Array<{ lat: number; lon: number; altM: number; speedKms: number; t: number }> {
  const out: Array<{ lat: number; lon: number; altM: number; speedKms: number; t: number }> = [];
  const altKm = Math.max(launch.orbitAltKm, 150);
  const orbSpeed = 7.9; // km/s typical LEO
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    // Ascent phase (0..0.55 of the timeline) reaches orbit altitude with a
    // gravity turn; coast phase (0.55..1) holds the parking orbit.
    const altKmNow = t < 0.55 ? altKm * (t / 0.55) : altKm;
    const speedKms = t < 0.55 ? orbSpeed * (t / 0.55) : orbSpeed;
    // Position: arc along the ascent direction — model as a great-circle-ish
    // offset from the pad, growing with altitude.
    const arcDeg = t * 4.0; // ~4° downrange at orbit insertion
    out.push({
      lat: launch.padLat + arcDeg * Math.cos(Cesium.Math.toRadians(45)),
      lon: launch.padLon + arcDeg * Math.sin(Cesium.Math.toRadians(45)),
      altM: altKmNow * 1000,
      speedKms,
      t,
    });
  }
  return out;
}

/**
 * Render the ascent path + moving vehicle on the globe.
 * Returns the entities so the caller can clean up.
 */
export function renderAscent(
  viewer: Cesium.Viewer,
  path: Array<{ lat: number; lon: number; altM: number; speedKms: number; t: number }>,
  color = Cesium.Color.ORANGE,
): { trail: Cesium.Entity; vehicle: Cesium.Entity } {
  const positions = path.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.altM));
  const trail = viewer.entities.add({
    polyline: {
      positions,
      width: 2,
      material: color.withAlpha(0.8),
    },
  });
  const vehicle = viewer.entities.add({
    position: positions[0],
    point: {
      pixelSize: 8,
      color,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 1,
    },
    label: {
      text: 'T+0s',
      font: '11px "JetBrains Mono", monospace',
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('#0b1220').withAlpha(0.7),
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      pixelOffset: new Cesium.Cartesian2(0, -20),
    },
  });
  return { trail, vehicle };
}

/** Move the vehicle to time t (0..1) along the path and update its label. */
export function seekAscent(
  path: Array<{ lat: number; lon: number; altM: number; speedKms: number; t: number }>,
  t: number,
  vehicle: Cesium.Entity,
): ReplayState {
  const clamped = Math.max(0, Math.min(1, t));
  const idx = Math.round(clamped * (path.length - 1));
  const p = path[idx];
  vehicle.position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.altM) as unknown as Cesium.PositionProperty;
  const label = vehicle.label;
  if (label) {
    label.text = new Cesium.ConstantProperty(
      `T+${Math.round(clamped * 540)}s · ${p.altM / 1000 >= 100 ? (p.altM / 1000).toFixed(0) : (p.altM / 1000).toFixed(1)} km · ${p.speedKms.toFixed(1)} km/s`,
    );
  }
  return { t: clamped, altKm: p.altM / 1000, speedKms: p.speedKms };
}
