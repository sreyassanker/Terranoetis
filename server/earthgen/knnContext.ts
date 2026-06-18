import { type Point3D, type PointCloud } from './flowMatching';

interface KDNode {
  point: Point3D;
  index: number;
  left: KDNode | null;
  right: KDNode | null;
  axis: number;
}

function buildKDTree(points: PointCloud, depth = 0): KDNode | null {
  if (points.length === 0) return null;
  const axis = depth % 3;
  const sorted = points
    .map((p, i) => ({ point: p, index: i }))
    .sort((a, b) => {
      const va = axis === 0 ? a.point.x : axis === 1 ? a.point.y : a.point.z;
      const vb = axis === 0 ? b.point.x : axis === 1 ? b.point.y : b.point.z;
      return va - vb;
    });
  const mid = Math.floor(sorted.length / 2);
  const node: KDNode = {
    point: sorted[mid].point,
    index: sorted[mid].index,
    axis,
    left: buildKDTree(sorted.slice(0, mid), depth + 1),
    right: buildKDTree(sorted.slice(mid + 1), depth + 1),
  };
  return node;
}

function sqDist(a: Point3D, b: Point3D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function knnSearch(
  node: KDNode | null,
  query: Point3D,
  k: number,
  heap: Array<{ dist: number; index: number; point: Point3D }>,
  depth = 0,
): void {
  if (!node) return;

  const axis = depth % 3;
  const d = sqDist(query, node.point);

  if (heap.length < k) {
    heap.push({ dist: d, index: node.index, point: node.point });
    heap.sort((a, b) => b.dist - a.dist);
  } else if (d < heap[0].dist) {
    heap[0] = { dist: d, index: node.index, point: node.point };
    heap.sort((a, b) => b.dist - a.dist);
  }

  const diff = axis === 0
    ? query.x - node.point.x
    : axis === 1
      ? query.y - node.point.y
      : query.z - node.point.z;

  const first = diff <= 0 ? node.left : node.right;
  const second = diff <= 0 ? node.right : node.left;

  knnSearch(first, query, k, heap, depth + 1);

  const maxDist = heap.length === k ? heap[0].dist : Infinity;
  if (diff * diff < maxDist) {
    knnSearch(second, query, k, heap, depth + 1);
  }
}

export interface PointWithContext {
  point: Point3D;
  context: number[];
}

export interface KNNConfig {
  k: number;
}

const DEFAULT_KNN_CONFIG: KNNConfig = { k: 8 };

export function computeKNNContext(
  cloud: PointCloud,
  cfg?: Partial<KNNConfig>,
): PointWithContext[] {
  const config = { ...DEFAULT_KNN_CONFIG, ...cfg };
  const k = Math.min(config.k, cloud.length - 1);
  if (k < 1) {
    return cloud.map(p => ({ point: p, context: [] }));
  }

  const tree = buildKDTree(cloud);
  if (!tree) return [];

  const results: PointWithContext[] = [];

  for (let i = 0; i < cloud.length; i++) {
    const query = cloud[i];
    const heap: Array<{ dist: number; index: number; point: Point3D }> = [];
    knnSearch(tree, query, k + 1, heap);
    heap.sort((a, b) => a.dist - b.dist);

    const neighbors = heap.filter(h => h.index !== i).slice(0, k);
    const context: number[] = [];
    for (const n of neighbors) {
      context.push(n.point.x - query.x);
      context.push(n.point.y - query.y);
      context.push(n.point.z - query.z);
    }
    while (context.length < k * 3) {
      context.push(0);
    }

    results.push({ point: query, context });
  }

  return results;
}
