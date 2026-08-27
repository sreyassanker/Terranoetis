/**
 * Inverse Distance Weighting (IDW) Interpolation
 *
 * Projects geographic coordinates to a local tangent plane before
 * computing distances, ensuring correct Euclidean distance in meters
 * rather than distorted degree-based distances.
 *
 * Uses KD-tree for O(log n) neighbor queries.
 */

export interface InterpPoint {
  lat: number;
  lon: number;
  value: number;
}

export interface InterpGrid {
  data: Float32Array;
  variance: Float32Array;
  width: number;
  height: number;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  valueMin: number;
  valueMax: number;
}

/* ═════════════════════════════════════════════════════════════════
   LOCAL TANGENT PLANE PROJECTION
   ═════════════════════════════════════════════════════════════════ */

const EARTH_RADIUS_M = 6371000;

/**
 * Project lat/lon (degrees) to local tangent plane (meters).
 * Uses equirectangular projection centered on (centerLat, centerLon).
 * Accurate to <1% for bbox sizes up to ~5 degrees.
 */
function projectToLocal(
  lat: number,
  lon: number,
  centerLat: number,
  centerLon: number,
): { x: number; y: number } {
  const latR = lat * Math.PI / 180;
  const lonR = lon * Math.PI / 180;
  const cLatR = centerLat * Math.PI / 180;
  const cLonR = centerLon * Math.PI / 180;
  return {
    x: (lonR - cLonR) * Math.cos(cLatR) * EARTH_RADIUS_M,
    y: (latR - cLatR) * EARTH_RADIUS_M,
  };
}

/* ═════════════════════════════════════════════════════════════════
   KD-TREE (operates in projected coordinates)
   ═════════════════════════════════════════════════════════════════ */

interface KDPoint {
  x: number;
  y: number;
  value: number;
}

interface KDNode {
  point: KDPoint;
  left: KDNode | null;
  right: KDNode | null;
  axis: number;
}

function buildKDTree(points: KDPoint[], depth: number = 0): KDNode | null {
  if (points.length === 0) return null;
  const axis = depth % 2;
  points.sort((a, b) => axis === 0 ? a.x - b.x : a.y - b.y);
  const mid = Math.floor(points.length / 2);
  return {
    point: points[mid],
    left: buildKDTree(points.slice(0, mid), depth + 1),
    right: buildKDTree(points.slice(mid + 1), depth + 1),
    axis,
  };
}

function distSq(a: KDPoint, x: number, y: number): number {
  const dx = a.x - x;
  const dy = a.y - y;
  return dx * dx + dy * dy;
}

function nearestK(tree: KDNode | null, x: number, y: number, k: number, depth: number = 0, heap: { dist: number; point: KDPoint }[] = []): { dist: number; point: KDPoint }[] {
  if (!tree) return heap;
  const d = distSq(tree.point, x, y);
  if (heap.length < k) {
    heap.push({ dist: d, point: tree.point });
    heap.sort((a, b) => b.dist - a.dist);
  } else if (d < heap[0].dist) {
    heap[0] = { dist: d, point: tree.point };
    heap.sort((a, b) => b.dist - a.dist);
  }

  const axis = depth % 2;
  const diff = axis === 0 ? x - tree.point.x : y - tree.point.y;
  const first = diff < 0 ? tree.left : tree.right;
  const second = diff < 0 ? tree.right : tree.left;

  nearestK(first, x, y, k, depth + 1, heap);
  if (heap.length < k || diff * diff < heap[0].dist) {
    nearestK(second, x, y, k, depth + 1, heap);
  }
  return heap;
}

/* ═════════════════════════════════════════════════════════════════
   IDW INTERPOLATION
   ═════════════════════════════════════════════════════════════════ */

export function interpolateIDW(
  points: InterpPoint[],
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number },
  gridWidth: number,
  gridHeight: number,
  power: number = 2,
  neighbors: number = 12,
): InterpGrid {
  const centerLat = (bbox.latMin + bbox.latMax) / 2;
  const centerLon = (bbox.lonMin + bbox.lonMax) / 2;

  // Project all points to local tangent plane
  const projectedPoints: KDPoint[] = points.map(p => {
    const { x, y } = projectToLocal(p.lat, p.lon, centerLat, centerLon);
    return { x, y, value: p.value };
  });

  // Build KD-tree in projected coordinates
  const tree = buildKDTree(projectedPoints);

  // Project bbox corners to local coordinates
  const bboxMin = projectToLocal(bbox.latMin, bbox.lonMin, centerLat, centerLon);
  const bboxMax = projectToLocal(bbox.latMax, bbox.lonMax, centerLat, centerLon);

  const data = new Float32Array(gridWidth * gridHeight);
  const variance = new Float32Array(gridWidth * gridHeight);
  let valueMin = Infinity;
  let valueMax = -Infinity;

  const xStep = (bboxMax.x - bboxMin.x) / (gridWidth - 1);
  const yStep = (bboxMax.y - bboxMin.y) / (gridHeight - 1);

  for (let row = 0; row < gridHeight; row++) {
    const y = bboxMin.y + row * yStep;
    for (let col = 0; col < gridWidth; col++) {
      const x = bboxMin.x + col * xStep;
      const nbrs = nearestK(tree, x, y, Math.min(neighbors, projectedPoints.length));
      let weightSum = 0;
      let valueSum = 0;
      let closestDist = Infinity;
      for (const n of nbrs) {
        if (n.dist < 1e-12) {
          valueSum = n.point.value;
          weightSum = 1;
          variance[row * gridWidth + col] = 0;
          closestDist = 0;
          break;
        }
        const w = 1 / Math.pow(n.dist, power / 2);
        weightSum += w;
        valueSum += w * n.point.value;
        if (n.dist < closestDist) closestDist = n.dist;
      }
      const val = weightSum > 0 ? valueSum / weightSum : 0;
      data[row * gridWidth + col] = val;
      const nCount = nbrs.length;
      let varEst = 0;
      if (nCount > 1 && weightSum > 0) {
        for (const n of nbrs) {
          const w = 1 / Math.pow(n.dist, power / 2);
          const diff = n.point.value - val;
          varEst += w * diff * diff;
        }
        varEst /= weightSum * (nCount - 1) / nCount;
      } else if (nCount === 1) {
        varEst = 0.1;
      }
      variance[row * gridWidth + col] = Math.sqrt(varEst);
      if (val < valueMin) valueMin = val;
      if (val > valueMax) valueMax = val;
    }
  }

  return { data, variance, width: gridWidth, height: gridHeight, latMin: bbox.latMin, latMax: bbox.latMax, lonMin: bbox.lonMin, lonMax: bbox.lonMax, valueMin, valueMax };
}

/** Ray-casting point-in-ring test (lon/lat in degrees). Rings use [lon, lat]
 *  ordering, matching getStudyAreaOuterRings. */
export function pointInRing(lon: number, lat: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Bilinear-interpolate the grid at continuous cell coordinates (gx, gy),
 *  where integer indices are cell centres (cell (r,c) centre = (r+0.5, c+0.5)
 *  in the sampling convention used by the server). Falls back to the nearest
 *  finite cell when a corner is NaN so the mask boundary stays honest. */
function bilinearAt(grid: InterpGrid, gx: number, gy: number): number {
  const r0 = Math.max(0, Math.min(grid.height - 1, Math.floor(gy)));
  const c0 = Math.max(0, Math.min(grid.width - 1, Math.floor(gx)));
  const r1 = Math.min(grid.height - 1, r0 + 1);
  const c1 = Math.min(grid.width - 1, c0 + 1);
  const fx = Math.max(0, Math.min(1, gx - c0));
  const fy = Math.max(0, Math.min(1, gy - r0));

  const v00 = grid.data[r0 * grid.width + c0];
  const v01 = grid.data[r0 * grid.width + c1];
  const v10 = grid.data[r1 * grid.width + c0];
  const v11 = grid.data[r1 * grid.width + c1];

  const finite = [v00, v01, v10, v11].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (finite.length === 0) return NaN;

  // If any corner is NaN, drop to the nearest finite cell (no invented values).
  if (!Number.isFinite(v00) || !Number.isFinite(v01) || !Number.isFinite(v10) || !Number.isFinite(v11)) {
    const corners = [
      { d: fx * fx + fy * fy, v: v00 },
      { d: (1 - fx) * (1 - fx) + fy * fy, v: v01 },
      { d: fx * fx + (1 - fy) * (1 - fy), v: v10 },
      { d: (1 - fx) * (1 - fx) + (1 - fy) * (1 - fy), v: v11 },
    ].filter(c => Number.isFinite(c.v));
    if (corners.length === 0) return NaN;
    corners.sort((a, b) => a.d - b.d);
    return corners[0].v as number;
  }

  const top = v00 + (v01 - v00) * fx;
  const bottom = v10 + (v11 - v10) * fx;
  return top + (bottom - top) * fy;
}

export function renderGridToCanvas(
  grid: InterpGrid,
  colorStops: { stop: number; r: number; g: number; b: number }[],
  maskPolygon?: Array<Array<[number, number]>>,
): HTMLCanvasElement {
  // Raster convention: grid row 0 = latMin (south), row height-1 = latMax
  // (north); canvas row 0 = top = north. We flip Y so south data renders at
  // the bottom and the field is north-up and exactly fills [latMin,latMax].
  const outerRing = maskPolygon && maskPolygon.length > 0 ? maskPolygon[0] : undefined;
  // Render at a smooth sub-cell resolution so the field shows continuous
  // gradients (QGIS-style bilinear display) instead of blocky cell pixels,
  // and so a polygon mask hugs the drawn shape precisely. 4× on a 28×28 grid
  // = 112×112 — cheap and visibly smooth. For very large grids (e.g. the IDW
  // fallback up to 200×200) we cap the canvas at ~512px/side so the
  // alpha-blended texture stays GPU-cheap instead of growing to 1600×1600.
  const UPSCALE = Math.min(4, Math.max(1, Math.floor(512 / Math.max(grid.width, grid.height))));
  const W = grid.width * UPSCALE;
  const H = grid.height * UPSCALE;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(W, H);
  const range = grid.valueMax - grid.valueMin || 1;
  const dLon = (grid.lonMax - grid.lonMin) / grid.width;
  const dLat = (grid.latMax - grid.latMin) / grid.height;

  for (let py = 0; py < H; py++) {
    // Output pixel row 0 = top = north; latitude decreases downward.
    const lat = grid.latMax - (py + 0.5) * dLat / UPSCALE;
    // Continuous cell coordinate: cell (r,c) centre sits at (r+0.5, c+0.5) in
    // the sampling convention, so gx/gy go from -0.5 (south/west edge) to
    // n-0.5 (north/east edge). Bilinear gives smooth IDW-style gradients.
    const gy = (lat - grid.latMin) / (grid.latMax - grid.latMin || 1) * grid.height - 0.5;
    for (let px = 0; px < W; px++) {
      const lon = grid.lonMin + (px + 0.5) * dLon / UPSCALE;
      const gx = (lon - grid.lonMin) / (grid.lonMax - grid.lonMin || 1) * grid.width - 0.5;
      const idx = (py * W + px) * 4;
      // Render-time polygon mask: cells outside the drawn study-area shape are
      // transparent, so the overlay hugs the polygon (nothing more, nothing
      // less) rather than painting its bounding box.
      if (outerRing && !pointInRing(lon, lat, outerRing)) {
        imgData.data[idx + 3] = 0;
        continue;
      }
      const v = bilinearAt(grid, gx, gy);
      if (!Number.isFinite(v)) {
        imgData.data[idx] = 0;
        imgData.data[idx + 1] = 0;
        imgData.data[idx + 2] = 0;
        imgData.data[idx + 3] = 0;
        continue;
      }
      const t = (v - grid.valueMin) / range;
      let r = 0, g = 0, b = 0;
      for (let s = 0; s < colorStops.length - 1; s++) {
        if (t >= colorStops[s].stop && t <= colorStops[s + 1].stop) {
          const seg = (t - colorStops[s].stop) / (colorStops[s + 1].stop - colorStops[s].stop);
          r = Math.round(colorStops[s].r + (colorStops[s + 1].r - colorStops[s].r) * seg);
          g = Math.round(colorStops[s].g + (colorStops[s + 1].g - colorStops[s].g) * seg);
          b = Math.round(colorStops[s].b + (colorStops[s + 1].b - colorStops[s].b) * seg);
          break;
        }
      }
      if (t > colorStops[colorStops.length - 1].stop) {
        r = colorStops[colorStops.length - 1].r;
        g = colorStops[colorStops.length - 1].g;
        b = colorStops[colorStops.length - 1].b;
      }
      imgData.data[idx] = r;
      imgData.data[idx + 1] = g;
      imgData.data[idx + 2] = b;
      imgData.data[idx + 3] = 200;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}
