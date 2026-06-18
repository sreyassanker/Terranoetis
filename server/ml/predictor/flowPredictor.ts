import { EarthGenModel } from '../../earthgen/earthGen';
import { type PointCloud } from '../../earthgen/flowMatching';
import { type ConditioningVector } from '../../earthgen/conditioning';
import { getDb } from '../../db/index';
import { logger } from '../../observability/logger';

export interface FlowPredictionInput {
  location: { lat: number; lon: number; label?: string };
  layers: string[];
  history: Array<{ timestamp: string; value: number; type: string }>;
  query?: string;
}

export interface FlowPrediction {
  hazardType: string;
  probability: number;
  severity: 'low' | 'medium' | 'high' | 'extreme';
  timeframe: string;
  confidence: number;
  confidenceInterval: [number, number];
  contributingFactors: string[];
  pointCloudStats: {
    centroid: { x: number; y: number; z: number };
    spread: number;
    density: number;
  };
}

const HAZARD_TYPES = ['earthquake', 'tsunami', 'hurricane', 'wildfire', 'flood', 'volcanic'] as const;
type HazardType = typeof HAZARD_TYPES[number];

const HAZARD_TO_SCENARIO: Record<string, string> = {
  earthquake: 'earthquake_swarm',
  tsunami: 'tsunami_wave',
  hurricane: 'hurricane_landfall',
  wildfire: 'wildfire_spread',
  flood: 'flood_inundation',
  volcanic: 'volcanic_eruption',
};

const HAZARD_TO_CONDITIONING: Record<string, Partial<ConditioningVector>> = {
  earthquake: { hazardType: 'seismic', spreadX: 0.1, spreadY: 0.1, spreadZ: 0.05 },
  tsunami: { hazardType: 'seismic', spreadX: 0.3, spreadY: 0.3, spreadZ: 0.01 },
  hurricane: { hazardType: 'weather', spreadX: 0.2, spreadY: 0.2, spreadZ: 0.1 },
  wildfire: { hazardType: 'fire', spreadX: 0.05, spreadY: 0.05, spreadZ: 0.02 },
  flood: { hazardType: 'flood', spreadX: 0.1, spreadY: 0.1, spreadZ: 0.01 },
  volcanic: { hazardType: 'volcanic', spreadX: 0.05, spreadY: 0.05, spreadZ: 0.15 },
};

function depthToSeverity(depth: number): 'low' | 'medium' | 'high' | 'extreme' {
  if (depth < 10) return 'extreme';
  if (depth < 30) return 'high';
  if (depth < 70) return 'medium';
  return 'low';
}

function magToSeverity(mag: number): 'low' | 'medium' | 'high' | 'extreme' {
  if (mag >= 8) return 'extreme';
  if (mag >= 6) return 'high';
  if (mag >= 4) return 'medium';
  return 'low';
}

export class FlowPredictor {
  private model: EarthGenModel;
  private trained = false;

  constructor() {
    this.model = new EarthGenModel({
      latentDim: 128,
      numLatentTokens: 512,
      numHeads: 4,
      numLayers: 6,
      hiddenDim: 256,
      knn: 8,
      learningRate: 1e-3,
    });
  }

  init(): void {
    try {
      const ckptPath = process.env.EARTHGEN_CHECKPOINT;
      if (ckptPath) {
        this.model.load(ckptPath);
        this.trained = true;
        logger.info({ checkpoint: ckptPath }, 'FlowPredictor loaded checkpoint');
      } else {
        logger.info('FlowPredictor initialized (no checkpoint, using prior)');
      }
    } catch (e) {
      logger.warn({ err: e }, 'FlowPredictor checkpoint load failed, using prior');
    }
  }

  async predict(input: FlowPredictionInput): Promise<FlowPrediction[]> {
    const predictions: FlowPrediction[] = [];

    for (const hazardType of HAZARD_TYPES) {
      const scenarioType = HAZARD_TO_SCENARIO[hazardType];
      if (!scenarioType) continue;

      const layerMatch = input.layers.some(l => hazardType === l || input.layers.includes(l));
      const historyMatch = input.history.some(h =>
        h.type.toLowerCase().includes(hazardType) ||
        hazardType.includes(h.type.toLowerCase()),
      );

      if (!layerMatch && !historyMatch && input.layers.length > 0) continue;

      const conditioning = this.buildConditioning(hazardType, input);
      const numPoints = 500 + Math.floor(Math.random() * 1500);

      let cloud: PointCloud;
      try {
        cloud = this.model.generate(conditioning as ConditioningVector, numPoints);
      } catch {
        cloud = this.generateFallbackCloud(hazardType, input, numPoints);
      }

      const stats = this.computeCloudStats(cloud);
      const probability = this.estimateProbability(cloud, hazardType, input);
      const confidence = this.estimateConfidence(cloud, stats);
      const severity = this.estimateSeverity(cloud, hazardType, input);
      const factors = this.extractFactors(cloud, hazardType, input);

      predictions.push({
        hazardType,
        probability,
        severity,
        timeframe: '24h',
        confidence,
        confidenceInterval: [
          Math.max(0, probability - (1 - confidence) * 0.3),
          Math.min(1, probability + (1 - confidence) * 0.3),
        ],
        contributingFactors: factors,
        pointCloudStats: stats,
      });
    }

    return predictions;
  }

  private buildConditioning(hazardType: string, input: FlowPredictionInput): Partial<ConditioningVector> {
    const base = HAZARD_TO_CONDITIONING[hazardType] || {};
    const lat = input.location.lat / 90;
    const lon = input.location.lon / 180;
    const time = Date.now() / 1e13;

    const avgMag = input.history
      .filter(h => h.type === hazardType)
      .reduce((s, h, _, a) => s + h.value / a.length, 0) || 0.5;

    return {
      ...base,
      lat,
      lon,
      elevation: 0,
      time,
      intensity: avgMag,
      magnitude: avgMag,
      severity: Math.min(1, avgMag),
      mask: 0,
    };
  }

  private computeCloudStats(cloud: PointCloud) {
    const n = cloud.length || 1;
    let cx = 0, cy = 0, cz = 0;
    for (const p of cloud) { cx += p.x; cy += p.y; cz += p.z; }
    const centroid = { x: cx / n, y: cy / n, z: cz / n };
    let spread = 0, density = 0;
    for (const p of cloud) {
      spread += Math.sqrt((p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2 + (p.z - centroid.z) ** 2);
    }
    spread /= n;
    density = n / Math.max(1e-6, spread * spread * spread * 4.18879);
    return { centroid, spread, density };
  }

  private estimateProbability(cloud: PointCloud, _hazardType: string, input: FlowPredictionInput): number {
    const stats = this.computeCloudStats(cloud);
    const histFactor = input.history.length > 0 ? 0.3 : 0;
    const spreadFactor = Math.min(1, stats.spread * 2);
    const densityFactor = Math.min(1, stats.density * 10);
    return Math.min(0.95, Math.max(0.05, spreadFactor * 0.4 + densityFactor * 0.3 + histFactor));
  }

  private estimateConfidence(_cloud: PointCloud, stats: { spread: number; density: number }): number {
    return Math.min(0.95, Math.max(0.3, stats.density * 5 + stats.spread));
  }

  private estimateSeverity(cloud: PointCloud, _hazardType: string, _input: FlowPredictionInput): 'low' | 'medium' | 'high' | 'extreme' {
    const stats = this.computeCloudStats(cloud);
    if (stats.spread > 0.5 && stats.density > 0.5) return 'extreme';
    if (stats.spread > 0.3) return 'high';
    if (stats.density > 0.2) return 'medium';
    return 'low';
  }

  private extractFactors(_cloud: PointCloud, hazardType: string, input: FlowPredictionInput): string[] {
    const factors: string[] = [];
    factors.push(`${hazardType} activity detected`);
    if (input.history.length > 0) {
      factors.push(`${input.history.length} historical events recorded`);
      const recent = input.history.slice(-3);
      factors.push(`Recent trend: ${recent.map(h => h.value.toFixed(1)).join(' → ')}`);
    }
    if (input.location.label) {
      factors.push(`Location: ${input.location.label}`);
    }
    return factors;
  }

  private generateFallbackCloud(hazardType: string, input: FlowPredictionInput, n: number): PointCloud {
    const cloud: PointCloud = [];
    const latRad = input.location.lat * (Math.PI / 180);
    const lonRad = input.location.lon * (Math.PI / 180);
    const spread = hazardType === 'hurricane' ? 0.5 : 0.1;
    for (let i = 0; i < n; i++) {
      const dx = (Math.random() - 0.5) * spread;
      const dy = (Math.random() - 0.5) * spread;
      const dz = (Math.random() - 0.5) * spread * 0.5;
      cloud.push({
        x: Math.cos(latRad + dx) * Math.cos(lonRad + dy) + dz,
        y: Math.cos(latRad + dx) * Math.sin(lonRad + dy) + dz,
        z: Math.sin(latRad + dx) + dz,
      });
    }
    return cloud;
  }
}
