import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { EarthGenModel } from '../earthgen/earthGen';
import { type ConditioningVector } from '../earthgen/conditioning';
import { type PointCloud } from '../earthgen/flowMatching';

export interface TriggerEvent {
  type: string;
  magnitude?: number;
  location: { lat: number; lon: number };
  timestamp: string;
  depth?: number;
  metadata?: Record<string, unknown>;
}

export interface GeneratedEntity {
  name: string;
  type: string;
  probability: number;
  severity: 'low' | 'medium' | 'high' | 'extreme';
  expectedImpact: string;
  pointCloud: PointCloud;
  conditioningVector: Partial<ConditioningVector>;
  metadata: Record<string, unknown>;
}

interface EntityTemplate {
  name: string;
  type: string;
  applicableEvents: string[];
  probabilityFn: (event: TriggerEvent) => number;
  severityFn: (event: TriggerEvent) => 'low' | 'medium' | 'high' | 'extreme';
  impactFn: (event: TriggerEvent) => string;
  hazardType: string;
  conditioningModifiers: Partial<ConditioningVector>;
  metadataFn: (event: TriggerEvent) => Record<string, unknown>;
}

const ENTITY_TEMPLATES: EntityTemplate[] = [
  {
    name: 'aftershocks',
    type: 'seismic_event',
    applicableEvents: ['earthquake'],
    probabilityFn: (e) => Math.min(0.95, (e.magnitude || 5) / 10),
    severityFn: (e) => (e.magnitude || 0) >= 6 ? 'high' : (e.magnitude || 0) >= 4 ? 'medium' : 'low',
    impactFn: (e) => `M${(e.magnitude! - 0.5).toFixed(1)}–M${(e.magnitude! + 0.3).toFixed(1)} aftershocks within 48h`,
    hazardType: 'seismic',
    conditioningModifiers: { spreadX: 0.08, spreadY: 0.08, spreadZ: 0.04, hazardType: 'seismic' },
    metadataFn: (e) => ({ parentMagnitude: e.magnitude, depth: e.depth, expectedCount: Math.round(10 ** (0.8 * (e.magnitude || 5) - 3)) }),
  },
  {
    name: 'tsunami',
    type: 'marine_hazard',
    applicableEvents: ['earthquake', 'volcanic_eruption', 'landslide'],
    probabilityFn: (e) => (e.magnitude || 0) >= 8 ? 0.8 : (e.magnitude || 0) >= 7 ? 0.3 : (e.magnitude || 0) >= 6 ? 0.05 : 0,
    severityFn: (e) => (e.magnitude || 0) >= 8 ? 'extreme' : (e.magnitude || 0) >= 7 ? 'high' : 'medium',
    impactFn: (e) => `Tsunami waves of ${((e.magnitude || 7) - 5) * 2}m height within 30min`,
    hazardType: 'seismic',
    conditioningModifiers: { spreadX: 0.4, spreadY: 0.4, spreadZ: 0.01, hazardType: 'seismic' },
    metadataFn: (e) => ({ waveHeight: ((e.magnitude || 7) - 5) * 2, arrivalTimeMin: 30 / ((e.magnitude || 7) / 7) }),
  },
  {
    name: 'landslides',
    type: 'geological_hazard',
    applicableEvents: ['earthquake', 'flood', 'wildfire'],
    probabilityFn: (e) => (e.magnitude || 0) >= 6 ? 0.6 : (e.magnitude || 0) >= 4 ? 0.2 : 0.05,
    severityFn: (e) => (e.magnitude || 0) >= 7 ? 'high' : (e.magnitude || 0) >= 5 ? 'medium' : 'low',
    impactFn: (e) => `Landslides in ${(e.magnitude! * 5).toFixed(0)}km radius, risk to roads and structures`,
    hazardType: 'seismic',
    conditioningModifiers: { spreadX: 0.06, spreadY: 0.06, spreadZ: 0.08, hazardType: 'seismic' },
    metadataFn: (e) => ({ affectedRadiusKm: (e.magnitude || 5) * 5, trigger: e.type }),
  },
  {
    name: 'infrastructure_damage',
    type: 'damage_assessment',
    applicableEvents: ['earthquake', 'hurricane', 'wildfire', 'flood', 'tsunami'],
    probabilityFn: (e) => Math.min(0.95, ((e.magnitude || 5) - 4) / 5),
    severityFn: (e) => (e.magnitude || 0) >= 7 ? 'extreme' : (e.magnitude || 0) >= 5 ? 'high' : 'medium',
    impactFn: (e) => `Structural damage to ${Math.round(((e.magnitude || 5) - 3) * 1000)}+ buildings, power/water disruption`,
    hazardType: 'seismic',
    conditioningModifiers: { spreadX: 0.1, spreadY: 0.1, spreadZ: 0.03, hazardType: 'seismic' },
    metadataFn: (e) => ({ estimatedDamagedBuildings: Math.round(((e.magnitude || 5) - 3) * 1000), infrastructureLoss: `${((e.magnitude || 5) * 10).toFixed(0)}M USD` }),
  },
  {
    name: 'casualties',
    type: 'human_impact',
    applicableEvents: ['earthquake', 'tsunami', 'hurricane', 'flood', 'wildfire'],
    probabilityFn: (e) => Math.min(0.9, ((e.magnitude || 5) - 4.5) / 5.5),
    severityFn: (e) => (e.magnitude || 0) >= 7 ? 'extreme' : (e.magnitude || 0) >= 5.5 ? 'high' : 'medium',
    impactFn: (e) => `Estimated ${Math.round(10 ** (1.5 * (e.magnitude || 5) - 5))} casualties in affected zone`,
    hazardType: 'seismic',
    conditioningModifiers: { spreadX: 0.12, spreadY: 0.12, spreadZ: 0.02, hazardType: 'seismic' },
    metadataFn: (e) => ({ estimatedCasualties: Math.round(10 ** (1.5 * (e.magnitude || 5) - 5)), populationExposure: `${Math.round((e.magnitude || 5) * 50000)}` }),
  },
  {
    name: 'fires',
    type: 'fire_hazard',
    applicableEvents: ['earthquake', 'wildfire'],
    probabilityFn: (e) => e.type === 'wildfire' ? 1.0 : Math.min(0.4, (e.magnitude || 5) / 15),
    severityFn: (e) => (e.magnitude || 0) >= 6 ? 'high' : 'medium',
    impactFn: (_e) => `Secondary fires from gas line breaks and electrical damage`,
    hazardType: 'fire',
    conditioningModifiers: { spreadX: 0.04, spreadY: 0.04, spreadZ: 0.01, hazardType: 'fire' },
    metadataFn: () => ({ secondaryFireRisk: 'elevated' }),
  },
  {
    name: 'flooding',
    type: 'flood_hazard',
    applicableEvents: ['hurricane', 'tsunami', 'flood'],
    probabilityFn: (e) => Math.min(0.95, (e.magnitude || 1) / 6),
    severityFn: (e) => (e.magnitude || 0) >= 7 ? 'extreme' : (e.magnitude || 0) >= 5 ? 'high' : 'medium',
    impactFn: (e) => `Coastal and lowland flooding to ${Math.round((e.magnitude || 5) * 2)}m depth`,
    hazardType: 'flood',
    conditioningModifiers: { spreadX: 0.15, spreadY: 0.15, spreadZ: 0.01, hazardType: 'flood' },
    metadataFn: (e) => ({ floodDepthM: (e.magnitude || 5) * 2, affectedAreaKm2: Math.round((e.magnitude || 5) * 100) }),
  },
  {
    name: 'power_outage',
    type: 'infrastructure',
    applicableEvents: ['earthquake', 'hurricane', 'wildfire', 'flood', 'tsunami'],
    probabilityFn: (e) => Math.min(0.9, (e.magnitude || 4) / 10),
    severityFn: (e) => (e.magnitude || 0) >= 6 ? 'high' : 'medium',
    impactFn: (e) => `Power outage affecting ${Math.round((e.magnitude || 5) * 10000)} customers for ${Math.round((e.magnitude || 5) * 6)}h`,
    hazardType: 'seismic',
    conditioningModifiers: { spreadX: 0.08, spreadY: 0.08, spreadZ: 0.02, hazardType: 'seismic' },
    metadataFn: (e) => ({ affectedCustomers: Math.round((e.magnitude || 5) * 10000), estimatedDurationH: Math.round((e.magnitude || 5) * 6) }),
  },
  {
    name: 'air_quality_degradation',
    type: 'environmental',
    applicableEvents: ['wildfire', 'volcanic_eruption'],
    probabilityFn: (e) => Math.min(0.95, (e.magnitude || 3) / 8),
    severityFn: (e) => (e.magnitude || 0) >= 6 ? 'extreme' : (e.magnitude || 0) >= 4 ? 'high' : 'medium',
    impactFn: (e) => `AQI ${(e.magnitude! * 100).toFixed(0)}+ in downwind areas for ${Math.round((e.magnitude || 4) * 24)}h`,
    hazardType: 'weather',
    conditioningModifiers: { spreadX: 0.25, spreadY: 0.25, spreadZ: 0.15, hazardType: 'weather' },
    metadataFn: (e) => ({ maxAQI: Math.round((e.magnitude || 4) * 100), durationH: Math.round((e.magnitude || 4) * 24) }),
  },
  {
    name: 'displacement',
    type: 'human_impact',
    applicableEvents: ['earthquake', 'tsunami', 'hurricane', 'flood', 'wildfire', 'volcanic_eruption'],
    probabilityFn: (e) => Math.min(0.85, (e.magnitude || 5) / 10),
    severityFn: (e) => (e.magnitude || 0) >= 7 ? 'extreme' : (e.magnitude || 0) >= 5 ? 'high' : 'medium',
    impactFn: (e) => `${Math.round(10 ** ((e.magnitude || 5) - 4))}+ people displaced, shelter capacity ${Math.round(10 ** ((e.magnitude || 5) - 5) * 1000)}`,
    hazardType: 'seismic',
    conditioningModifiers: { spreadX: 0.15, spreadY: 0.15, spreadZ: 0.02, hazardType: 'seismic' },
    metadataFn: (e) => ({ displacedPopulation: Math.round(10 ** ((e.magnitude || 5) - 4)), shelterNeeded: Math.round(10 ** ((e.magnitude || 5) - 5) * 1000) }),
  },
];

export class EntityGenerator {
  private earthGen: EarthGenModel;
  private initialized = false;

  constructor() {
    this.earthGen = new EarthGenModel();
  }

  init(): void {
    try {
      const ckpt = process.env.EARTHGEN_CHECKPOINT;
      if (ckpt) this.earthGen.load(ckpt);
      this.initialized = true;
      logger.info('EntityGenerator initialized');
    } catch (e) {
      logger.warn({ err: e }, 'EntityGenerator init failed, using fallback');
    }
  }

  generate(event: TriggerEvent): GeneratedEntity[] {
    const entities: GeneratedEntity[] = [];

    for (const template of ENTITY_TEMPLATES) {
      if (!template.applicableEvents.includes(event.type)) continue;

      const probability = template.probabilityFn(event);
      if (probability < 0.05) continue;

      const severity = template.severityFn(event);
      const pointCloud = this.synthesizeCloud(template, event);
      const conditioningVector: Partial<ConditioningVector> = {
        ...template.conditioningModifiers,
        lat: event.location.lat / 90,
        lon: event.location.lon / 180,
        magnitude: (event.magnitude || 5) / 10,
        severity: ['low', 'medium', 'high', 'extreme'].indexOf(severity) / 3,
        intensity: probability,
        time: Date.now() / 1e13,
        elevation: (event.depth || 0) / 100,
      };

      entities.push({
        name: template.name,
        type: template.type,
        probability,
        severity,
        expectedImpact: template.impactFn(event),
        pointCloud,
        conditioningVector,
        metadata: {
          ...template.metadataFn(event),
          parentEvent: event.type,
          triggerTime: event.timestamp,
        },
      });
    }

    const historicalLikelihoods = this.checkHistoricalLikelihoods(event);
    for (const entity of entities) {
      const hist = historicalLikelihoods.find(h => h.name === entity.name);
      if (hist) {
        entity.probability = (entity.probability + hist.likelihood) / 2;
      }
    }

    return entities.sort((a, b) => b.probability - a.probability);
  }

  private synthesizeCloud(template: EntityTemplate, event: TriggerEvent): PointCloud {
    if (this.initialized && process.env.EARTHGEN_CHECKPOINT) {
      try {
        const c: Partial<ConditioningVector> = {
          ...template.conditioningModifiers,
          lat: event.location.lat / 90,
          lon: event.location.lon / 180,
          magnitude: (event.magnitude || 5) / 10,
          severity: 0.5,
          intensity: 0.5,
          time: Date.now() / 1e13,
          elevation: 0,
          mask: 0,
        };
        return this.earthGen.generate(c as ConditioningVector, 256);
      } catch {
        return this.fallbackCloud(template, event);
      }
    }
    return this.fallbackCloud(template, event);
  }

  private fallbackCloud(template: EntityTemplate, _event: TriggerEvent): PointCloud {
    const n = 64;
    const cloud: PointCloud = [];
    const spreadX = template.conditioningModifiers.spreadX || 0.1;
    const spreadY = template.conditioningModifiers.spreadY || 0.1;
    const spreadZ = template.conditioningModifiers.spreadZ || 0.05;
    for (let i = 0; i < n; i++) {
      cloud.push({
        x: (Math.random() - 0.5) * spreadX * 2,
        y: (Math.random() - 0.5) * spreadY * 2,
        z: (Math.random() - 0.5) * spreadZ * 2,
      });
    }
    return cloud;
  }

  private checkHistoricalLikelihoods(event: TriggerEvent): Array<{ name: string; likelihood: number }> {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT e.name as entity_name, COUNT(r.id) as co_occurrences
        FROM knowledge_entities e
        JOIN knowledge_relations r ON e.id = r.target_id
        JOIN knowledge_entities e2 ON r.source_id = e2.id
        WHERE e2.name = ? AND r.relation_type = 'generates'
        GROUP BY e.name
      `).all(event.type) as Array<{ entity_name: string; co_occurrences: number }>;

      const total = rows.reduce((s, r) => s + r.co_occurrences, 0);
      if (total === 0) return [];

      return rows.map(r => ({
        name: r.entity_name,
        likelihood: r.co_occurrences / total,
      }));
    } catch {
      return [];
    }
  }

  getStats(): { templateCount: number; initialized: boolean } {
    return { templateCount: ENTITY_TEMPLATES.length, initialized: this.initialized };
  }
}

export const entityGenerator = new EntityGenerator();
