import { latLngToCell, cellToLatLng, gridDisk, gridDistance } from 'h3-js';

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









export function h3ToGeoJSON(h3Index: string): Record<string, unknown> {
  const center = h3ToCoords(h3Index);
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [center.lon, center.lat] },
    properties: { h3Index, resolution: h3Index.length },
  };
}

