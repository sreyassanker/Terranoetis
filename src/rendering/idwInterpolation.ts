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

export function renderGridToCanvas(grid: InterpGrid, colorStops: { stop: number; r: number; g: number; b: number }[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(grid.width, grid.height);
  const range = grid.valueMax - grid.valueMin || 1;

  for (let i = 0; i < grid.data.length; i++) {
    const t = (grid.data[i] - grid.valueMin) / range;
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
    const idx = i * 4;
    imgData.data[idx] = r;
    imgData.data[idx + 1] = g;
    imgData.data[idx + 2] = b;
    imgData.data[idx + 3] = 200;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}
