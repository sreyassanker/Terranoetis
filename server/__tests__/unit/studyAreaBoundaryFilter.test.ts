import { describe, it, expect } from 'vitest';

/**
 * Fast ray-casting point-in-polygon helper with bounding box early exit
 * (mirrored from server/index.ts for unit test verification).
 */
function isPointInPolygonRings(
  lon: number,
  lat: number,
  rings?: Array<Array<[number, number]>> | null,
  bbox?: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null
): boolean {
  if (bbox) {
    const eps = 0.0001;
    if (lat < bbox.latMin - eps || lat > bbox.latMax + eps || lon < bbox.lonMin - eps || lon > bbox.lonMax + eps) {
      return false;
    }
  }
  if (!rings || rings.length === 0) return true;

  for (const ring of rings) {
    if (!ring || ring.length < 3) continue;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

describe('Study Area Point-in-Polygon Boundary Filtering', () => {
  it('correctly filters points within a single polygon boundary', () => {
    // Triangular polygon around (10, 10), (20, 10), (15, 20)
    const ring: Array<[number, number]> = [[10, 10], [20, 10], [15, 20], [10, 10]];
    const rings = [ring];
    const bbox = { latMin: 10, latMax: 20, lonMin: 10, lonMax: 20 };

    // Point in center: (lon: 15, lat: 13) -> inside
    expect(isPointInPolygonRings(15, 13, rings, bbox)).toBe(true);

    // Point outside triangle but inside bbox: (lon: 11, lat: 18) -> outside
    expect(isPointInPolygonRings(11, 18, rings, bbox)).toBe(false);

    // Point completely outside bbox: (lon: 25, lat: 25) -> outside
    expect(isPointInPolygonRings(25, 25, rings, bbox)).toBe(false);
  });

  it('correctly filters points across MultiPolygon rings (e.g. mainland + islands)', () => {
    // Mainland polygon: lon [-125, -70], lat [49, 65]
    const mainland: Array<[number, number]> = [
      [-125, 49], [-70, 49], [-70, 65], [-125, 65], [-125, 49]
    ];
    // Island polygon (e.g. Vancouver Island): lon [-128, -123], lat [48.3, 50.8]
    const island: Array<[number, number]> = [
      [-128, 48.3], [-123, 48.3], [-123, 50.8], [-128, 50.8], [-128, 48.3]
    ];
    const multiRings = [mainland, island];
    const bbox = { latMin: 40, latMax: 70, lonMin: -150, lonMax: -50 };

    // Point in mainland (Calgary/Edmonton region): lon -114, lat 51 -> inside
    expect(isPointInPolygonRings(-114, 51, multiRings, bbox)).toBe(true);

    // Point on island (Victoria): lon -123.36, lat 48.42 -> inside
    expect(isPointInPolygonRings(-123.36, 48.42, multiRings, bbox)).toBe(true);

    // Point in Alaska (outside Canada rings): lon -145, lat 61 -> outside
    expect(isPointInPolygonRings(-145, 61, multiRings, bbox)).toBe(false);

    // Point in Montana / USA (south of 49th parallel): lon -110, lat 46 -> outside
    expect(isPointInPolygonRings(-110, 46, multiRings, bbox)).toBe(false);

    // Point in Atlantic ocean: lon -55, lat 43 -> outside
    expect(isPointInPolygonRings(-55, 43, multiRings, bbox)).toBe(false);
  });

  it('falls back cleanly to bbox filtering when polygon rings are not provided', () => {
    const bbox = { latMin: 8.4, latMax: 8.6, lonMin: 76.8, lonMax: 77.0 };

    // Point inside city bbox (Thiruvananthapuram center: 8.52, 76.93)
    expect(isPointInPolygonRings(76.93, 8.52, null, bbox)).toBe(true);

    // Point outside city bbox (Kollam: 8.89, 76.60)
    expect(isPointInPolygonRings(76.60, 8.89, null, bbox)).toBe(false);
  });
});
