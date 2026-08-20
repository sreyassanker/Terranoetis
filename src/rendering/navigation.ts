import * as Cesium from 'cesium';

/* ─────────────────────────────────────────────────────────────
   Navigation / Spatial Safety toolkit
   - Road routing via the public OSRM demo server (no API key)
   - Safe-facility discovery via Overpass (OpenStreetMap, no key)
   - Isochrone approximation by sampling routes around a point
   These are data/network helpers only; drawing is done by the caller
   so entity lifecycle stays in the component.
   ───────────────────────────────────────────────────────────── */

export interface LatLon { lat: number; lon: number; }

export interface RouteResult {
  coords: [number, number][]; // [lon, lat]
  distanceM: number;
  durationS: number;
}

export interface SafeFacility extends LatLon {
  name: string;
  type: string;
  distM: number;
}

export interface SafestResult {
  best: SafeFacility | null;
  bestRoute: RouteResult | null;
  facilities: SafeFacility[];
  iso: [number, number][] | null;
  status: string;
}

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

function haversine(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function destinationPoint(lat: number, lon: number, distKm: number, bearing: number): LatLon {
  const R = 6371;
  const d = distKm / R;
  const brng = (bearing * Math.PI) / 180;
  const la1 = (lat * Math.PI) / 180;
  const lo1 = (lon * Math.PI) / 180;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brng));
  const lo2 =
    lo1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(la1),
      Math.cos(d) - Math.sin(la1) * Math.sin(la2),
    );
  return { lat: (la2 * 180) / Math.PI, lon: (lo2 * 180) / Math.PI };
}

/** Road route between two points. Falls back to a straight line if the service is unreachable. */
export async function routeBetween(a: LatLon, b: LatLon): Promise<RouteResult> {
  try {
    const url = `${OSRM_BASE}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const j = await res.json();
    if (j.code === 'Ok' && j.routes?.length) {
      const rt = j.routes[0];
      return { coords: rt.geometry.coordinates, distanceM: rt.distance, durationS: rt.duration };
    }
  } catch {
    /* fall through to straight-line */
  }
  const d = haversine(a, b);
  return {
    coords: [
      [a.lon, a.lat],
      [b.lon, b.lat],
    ],
    distanceM: d,
    durationS: d / 13.9, // assume ~50 km/h
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SAFE_AMENITIES = 'hospital|shelter|clinic|fire_station|police|school';

/** Query OSM (via Overpass) for safe/civil facilities near a point. */
export async function overpassSafeFacilities(center: LatLon, radiusM = 40000): Promise<SafeFacility[]> {
  const q = `[out:json][timeout:25];(
    node["amenity"~"^(hospital|shelter|clinic|fire_station|police|school)$"](around:${radiusM},${center.lat},${center.lon});
    way["amenity"~"^(hospital|shelter|clinic|fire_station|police|school)$"](around:${radiusM},${center.lat},${center.lon});
  );out center 60;`;
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(q),
  });
  const j = await res.json();
  const out: SafeFacility[] = [];
  for (const el of j.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const type = el.tags?.amenity ?? 'facility';
    out.push({
      lat,
      lon,
      type,
      name: el.tags?.name || type.replace('_', ' '),
      distM: haversine(center, { lat, lon }),
    });
  }
  return out;
}

/** Rank facilities by distance (shelters/hospitals preferred via a small boost). */
export function rankFacilities(hazard: LatLon, facilities: SafeFacility[]): SafeFacility[] {
  const priority: Record<string, number> = { shelter: 0.6, hospital: 0.75, clinic: 0.85, fire_station: 0.9, police: 0.95, school: 1 };
  return [...facilities]
    .map(f => ({ ...f, _k: f.distM * (priority[f.type] ?? 1) }))
    .sort((a, b) => a._k - b._k)
    .map(({ _k, ...rest }) => rest);
}

const FACILITY_LABEL: Record<string, string> = {
  shelter: 'Shelter',
  hospital: 'Hospital',
  clinic: 'Clinic',
  fire_station: 'Fire Station',
  police: 'Police',
  school: 'School',
};

export function facilityLabel(f: SafeFacility): string {
  return `${FACILITY_LABEL[f.type] ?? f.type} — ${f.name}`;
}

/** Approximate isochrone (reachable zone) by sampling routes to points on a ring. */
export async function computeIsochrone(center: LatLon, minutes: number, bearings = 10): Promise<[number, number][] | null> {
  const ringRadiusM = minutes * 700; // ~42 km/h average
  const pts: [number, number][] = [];
  for (let i = 0; i < bearings; i++) {
    const br = (i * 360) / bearings;
    const dest = destinationPoint(center.lat, center.lon, ringRadiusM / 1000, br);
    try {
      const r = await routeBetween(center, dest);
      const last = r.coords[r.coords.length - 1];
      pts.push(last ?? [dest.lon, dest.lat]);
    } catch {
      pts.push([dest.lon, dest.lat]);
    }
  }
  return pts.length >= 3 ? pts : null;
}

/** Full "safest location" computation for a hazard point. */
export async function computeSafestLocation(hazard: LatLon, opts?: { radiusM?: number; isoMinutes?: number }): Promise<SafestResult> {
  const radiusM = opts?.radiusM ?? 40000;
  const isoMinutes = opts?.isoMinutes ?? 15;
  try {
    const facilities = await overpassSafeFacilities(hazard, radiusM);
    const ranked = rankFacilities(hazard, facilities);
    if (ranked.length === 0) {
      return { best: null, bestRoute: null, facilities: [], iso: null, status: 'No safe facilities (shelter/hospital/police…) found within ' + Math.round(radiusM / 1000) + ' km in OpenStreetMap.' };
    }
    const best = ranked[0];
    const bestRoute = await routeBetween(hazard, best);
    const iso = await computeIsochrone(hazard, isoMinutes);
    return {
      best,
      bestRoute,
      facilities: ranked.slice(0, 5),
      iso,
      status: `Nearest safe: ${facilityLabel(best)} — ${(best.distM / 1000).toFixed(1)} km`,
    };
  } catch (e) {
    return { best: null, bestRoute: null, facilities: [], iso: null, status: 'Error finding safe locations: ' + (e instanceof Error ? e.message : String(e)) };
  }
}

/* ── Drawing helpers (entities are tracked by the caller for cleanup) ── */

export function drawNavPolyline(viewer: Cesium.Viewer, coords: [number, number][], color: string): Cesium.Entity {
  return viewer.entities.add({
    polyline: {
      positions: coords.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
      width: 4,
      material: Cesium.Color.fromCssColorString(color),
      clampToGround: true,
    },
  });
}

export function drawNavMarker(viewer: Cesium.Viewer, p: LatLon, color: string, label: string): Cesium.Entity {
  return viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
    point: { pixelSize: 11, color: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
    label: {
      text: label,
      font: '11px sans-serif',
      fillColor: Cesium.Color.WHITE,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -14),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
}

export function drawNavIso(viewer: Cesium.Viewer, coords: [number, number][], color: string): Cesium.Entity {
  return viewer.entities.add({
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(coords.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))),
      material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(color).withAlpha(0.12)),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString(color).withAlpha(0.5),
    },
  });
}
