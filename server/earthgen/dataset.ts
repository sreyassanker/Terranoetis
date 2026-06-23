import { type PointCloud, type Point3D } from './flowMatching';

export interface DatasetExample {
  cloud: PointCloud;
  conditioning: number[];
  label: string;
}

export interface DatasetConfig {
  numPoints: number;
  augmentRotate: boolean;
  normalize: boolean;
}

const DEFAULT_DATASET_CONFIG: DatasetConfig = {
  numPoints: 4096,
  augmentRotate: true,
  normalize: true,
};

function rotateZ(cloud: PointCloud, angle: number): PointCloud {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return cloud.map(p => ({
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
    z: p.z,
  }));
}

function normalizeToSphere(cloud: PointCloud): PointCloud {
  let maxDist = 0;
  for (const p of cloud) {
    const d = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    if (d > maxDist) maxDist = d;
  }
  if (maxDist === 0) return cloud;
  const scale = 1 / maxDist;
  return cloud.map(p => ({ x: p.x * scale, y: p.y * scale, z: p.z * scale }));
}

function centerAtOrigin(cloud: PointCloud): PointCloud {
  if (cloud.length === 0) return cloud;
  let mx = 0, my = 0, mz = 0;
  for (const p of cloud) { mx += p.x; my += p.y; mz += p.z; }
  mx /= cloud.length; my /= cloud.length; mz /= cloud.length;
  return cloud.map(p => ({ x: p.x - mx, y: p.y - my, z: p.z - mz }));
}

function farthestPointSampling(cloud: PointCloud, n: number): PointCloud {
  if (cloud.length <= n) return [...cloud];
  const result: PointCloud = [];
  const selected = new Set<number>();
  const first = Math.floor(Math.random() * cloud.length);
  result.push(cloud[first]);
  selected.add(first);

  const dists = cloud.map(() => 0);

  while (result.length < n) {
    let bestDist = -1;
    let bestIdx = -1;
    for (let i = 0; i < cloud.length; i++) {
      if (selected.has(i)) continue;
      const last = result[result.length - 1];
      const d = sqDist(cloud[i], last);
      if (d > dists[i]) dists[i] = d;
      if (dists[i] > bestDist) {
        bestDist = dists[i];
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    result.push(cloud[bestIdx]);
    selected.add(bestIdx);
  }

  return result;
}

function sqDist(a: Point3D, b: Point3D): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export interface DatasetSource {
  name: string;
  fetch: () => Promise<DatasetExample[]>;
}

export class EarthGenDataset {
  private examples: DatasetExample[] = [];
  private config: DatasetConfig;

  constructor(cfg?: Partial<DatasetConfig>) {
    this.config = { ...DEFAULT_DATASET_CONFIG, ...cfg };
  }

  addSource(source: DatasetSource, _weight = 1): void {
  }

  addExamples(examples: DatasetExample[]): void {
    for (const ex of examples) {
      let cloud = farthestPointSampling(ex.cloud, this.config.numPoints);
      cloud = centerAtOrigin(cloud);
      if (this.config.normalize) {
        cloud = normalizeToSphere(cloud);
      }
      if (this.config.augmentRotate) {
        cloud = rotateZ(cloud, Math.random() * 2 * Math.PI);
      }
      this.examples.push({ cloud, conditioning: ex.conditioning, label: ex.label });
    }
  }

  addSynthetic(
    numExamples: number,
    genExample: () => { cloud: PointCloud; conditioning: number[]; label: string },
  ): void {
    for (let i = 0; i < numExamples; i++) {
      const ex = genExample();
      let cloud = farthestPointSampling(ex.cloud, this.config.numPoints);
      cloud = centerAtOrigin(cloud);
      if (this.config.normalize) cloud = normalizeToSphere(cloud);
      if (this.config.augmentRotate) cloud = rotateZ(cloud, Math.random() * 2 * Math.PI);
      this.examples.push({ cloud, conditioning: ex.conditioning, label: ex.label });
    }
  }

  getSplit(trainRatio = 0.8): { train: DatasetExample[]; val: DatasetExample[] } {
    const shuffled = [...this.examples].sort(() => Math.random() - 0.5);
    const split = Math.floor(shuffled.length * trainRatio);
    return {
      train: shuffled.slice(0, split),
      val: shuffled.slice(split),
    };
  }

  size(): number {
    return this.examples.length;
  }

  clear(): void {
    this.examples = [];
  }

  generateSyntheticEarthquakeCloud(
    centerLat: number,
    centerLon: number,
    magnitude: number,
    count: number,
  ): PointCloud {
    const cloud: PointCloud = [];
    const r = magnitude * 0.5;
    for (let i = 0; i < count; i++) {
      const offsetLat = (Math.random() - 0.5) * r;
      const offsetLon = (Math.random() - 0.5) * r;
      const depth = Math.random() * 30;
      const lat = centerLat + offsetLat;
      const lon = centerLon + offsetLon;
      const latRad = lat * (Math.PI / 180);
      const lonRad = lon * (Math.PI / 180);
      const rSphere = 1 - depth * 0.001;
      cloud.push({
        x: rSphere * Math.cos(latRad) * Math.cos(lonRad),
        y: rSphere * Math.cos(latRad) * Math.sin(lonRad),
        z: rSphere * Math.sin(latRad),
      });
    }
    return farthestPointSampling(cloud, Math.min(count, this.config.numPoints));
  }

  syntheticEarthquakeDataset(numSamples = 100): DatasetExample[] {
    const examples: DatasetExample[] = [];
    for (let i = 0; i < numSamples; i++) {
      const lat = (Math.random() - 0.5) * 180;
      const lon = (Math.random() - 0.5) * 360;
      const mag = 1 + Math.random() * 8;
      const n = 500 + Math.floor(Math.random() * 4000);
      const cloud = this.generateSyntheticEarthquakeCloud(lat, lon, mag, n);
      examples.push({
        cloud,
        conditioning: [lat / 90, lon / 180, mag / 10, Math.random(), mag / 10, mag / 10, Math.random(), 0, 0.1, 0.1, 0.05, 0],
        label: `earthquake_M${mag.toFixed(1)}`,
      });
    }
    return examples;
  }

  syntheticStormCloud(
    centerLat: number,
    centerLon: number,
    intensity: number,
    count: number,
  ): PointCloud {
    const cloud: PointCloud = [];
    const r = intensity * 1.5;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * 2 * Math.PI;
      const radius = Math.random() * r;
      const lat = centerLat + radius * Math.cos(angle);
      const lon = centerLon + radius * Math.sin(angle);
      const zOffset = (Math.random() - 0.5) * intensity;
      const latRad = lat * (Math.PI / 180);
      const lonRad = lon * (Math.PI / 180);
      cloud.push({
        x: Math.cos(latRad) * Math.cos(lonRad) + zOffset * 0.01,
        y: Math.cos(latRad) * Math.sin(lonRad) + zOffset * 0.01,
        z: Math.sin(latRad) + zOffset * 0.01,
      });
    }
    return farthestPointSampling(cloud, Math.min(count, this.config.numPoints));
  }
}
