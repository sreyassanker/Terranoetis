import { latLngToCell, cellToLatLng, gridDisk, gridDistance, cellToParent } from 'h3-js';

export function coordsToH3(lat: number, lon: number, res: number = 6): string {
  return latLngToCell(lat, lon, res);
}

export function h3ToCoords(h3Index: string): { lat: number; lon: number } {
  const [lat, lon] = cellToLatLng(h3Index);
  return { lat, lon };
}

export function getNeighbors(h3Index: string, k: number = 1): string[] {
  return gridDisk(h3Index, k);
}

export function getParent(h3Index: string, res: number): string {
  return cellToParent(h3Index, res);
}

export function h3Distance(a: string, b: string): number {
  return gridDistance(a, b);
}

export function spatialJoin(h3SetA: string[], h3SetB: string[]): string[] {
  const setB = new Set(h3SetB);
  return h3SetA.filter(h3 => setB.has(h3));
}

export function expandToResolution(
  h3Indices: string[],
  targetRes: number,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const h3 of h3Indices) {
    const res = h3.length;
    if (res >= targetRes) {
      if (!seen.has(h3)) { seen.add(h3); result.push(h3); }
    } else {
      const diff = targetRes - res;
      const expanded = expandByChildren(h3, diff);
      for (const child of expanded) {
        if (!seen.has(child)) { seen.add(child); result.push(child); }
      }
    }
  }
  return result;
}

function expandByChildren(h3: string, levels: number): string[] {
  let current = [h3];
  for (let i = 0; i < levels; i++) {
    const next: string[] = [];
    for (const c of current) {
      const children = gridDisk(c, 0);
      next.push(...children);
    }
    current = next;
  }
  return current;
}

export function compactIndices(h3Indices: string[]): string[] {
  const seen = new Set<string>();
  for (const h3 of h3Indices) {
    const parent = h3.slice(0, -1);
    if (seen.has(parent)) continue;
    if (h3Indices.some(x => x !== h3 && x.startsWith(h3))) continue;
    seen.add(h3);
  }
  return Array.from(seen);
}

export function h3ToBbox(h3Index: string): { minLat: number; minLon: number; maxLat: number; maxLon: number } {
  const neighbors = getNeighbors(h3Index, 1);
  const coords = neighbors.map(h3ToCoords);
  const lats = coords.map(c => c.lat);
  const lons = coords.map(c => c.lon);
  return {
    minLat: Math.min(...lats),
    minLon: Math.min(...lons),
    maxLat: Math.max(...lats),
    maxLon: Math.max(...lons),
  };
}

export function kRingLookup(
  center: string,
  k: number,
  pointFilter: (h3: string) => boolean,
): string[] {
  const ring = getNeighbors(center, k);
  return ring.filter(pointFilter);
}

export function distanceKm(h3IndexA: string, h3IndexB: string): number {
  const a = h3ToCoords(h3IndexA);
  const b = h3ToCoords(h3IndexB);
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const sLat = Math.sin(dLat / 2);
  const sLon = Math.sin(dLon / 2);
  const h = sLat * sLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sLon * sLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function resolutionToAreaKm2(res: number): number {
  const areas: Record<number, number> = {
    0: 4250546.848, 1: 607220.978, 2: 86774.711, 3: 12393.530,
    4: 1770.504, 5: 252.929, 6: 36.129, 7: 5.161,
    8: 0.737, 9: 0.105, 10: 0.015, 11: 0.002, 12: 0.0003,
    13: 0.00005, 14: 0.000007, 15: 0.000001,
  };
  return areas[res] || 0;
}

export function samplePointsInH3(h3Index: string, n: number = 10): Array<{ lat: number; lon: number }> {
  const center = h3ToCoords(h3Index);
  const neighbors = getNeighbors(h3Index, 1);
  const allCoords = [center, ...neighbors.map(h3ToCoords)];
  const points: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * allCoords.length);
    const c = allCoords[idx];
    const jitter = (Math.random() - 0.5) * 0.01;
    points.push({ lat: c.lat + jitter, lon: c.lon + jitter });
  }
  return points;
}

export function filterByBbox(
  h3Indices: string[],
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number },
): string[] {
  return h3Indices.filter(h3 => {
    const c = h3ToCoords(h3);
    return c.lat >= bbox.minLat && c.lat <= bbox.maxLat &&
           c.lon >= bbox.minLon && c.lon <= bbox.maxLon;
  });
}

export function computePolygonCenter(h3Indices: string[]): { lat: number; lon: number } {
  let lat = 0, lon = 0;
  for (const h3 of h3Indices) {
    const c = h3ToCoords(h3);
    lat += c.lat;
    lon += c.lon;
  }
  return { lat: lat / h3Indices.length, lon: lon / h3Indices.length };
}

export function h3ToGeoJSON(h3Index: string): Record<string, unknown> {
  const center = h3ToCoords(h3Index);
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [center.lon, center.lat] },
    properties: { h3Index, resolution: h3Index.length },
  };
}

export function h3ToGeoJSONCollection(h3Indices: string[]): Record<string, unknown> {
  return {
    type: 'FeatureCollection',
    features: h3Indices.map(h3 => h3ToGeoJSON(h3)),
  };
}
