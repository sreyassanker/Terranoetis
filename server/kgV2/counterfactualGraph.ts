import { logger } from '../observability/logger';
import { EarthGenModel } from '../earthgen/earthGen';
import { type ConditioningVector } from '../earthgen/conditioning';
import { type PointCloud } from '../earthgen/flowMatching';

export interface CounterfactualChange {
  field: string;
  originalValue: number | string;
  newValue: number | string;
  description: string;
}

export interface CounterfactualEvent {
  type: string;
  magnitude?: number;
  location: { lat: number; lon: number };
  depth?: number;
  timestamp: string;
}

export interface CounterfactualDelta {
  field: string;
  original: number | string;
  modified: number | string;
  impact: 'increased_risk' | 'decreased_risk' | 'changed_behavior' | 'new_hazard' | 'unchanged';
  magnitude: number;
}

export interface CounterfactualResult {
  originalEvent: CounterfactualEvent;
  change: CounterfactualChange;
  originalGraph: CounterfactualGraphSnapshot;
  counterfactualGraph: CounterfactualGraphSnapshot;
  deltas: CounterfactualDelta[];
  summary: string;
}

interface CounterfactualGraphSnapshot {
  entities: Array<{ name: string; type: string; probability: number; severity: string }>;
  edges: Array<{ source: string; target: string; relation: string; probability: number }>;
  pointCloud: PointCloud;
  conditioning: Partial<ConditioningVector>;
}

const CHANGE_TEMPLATES: Array<{ field: string; description: string; min: number; max: number; step: number }> = [
  { field: 'magnitude', description: 'Change earthquake magnitude', min: 3, max: 9.5, step: 0.1 },
  { field: 'depth', description: 'Change hypocenter depth (km)', min: 1, max: 100, step: 1 },
  { field: 'location.lat', description: 'Shift latitude', min: -90, max: 90, step: 0.5 },
  { field: 'location.lon', description: 'Shift longitude', min: -180, max: 180, step: 0.5 },
];

export class CounterfactualGraph {
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
      logger.info('CounterfactualGraph initialized');
    } catch (e) {
      logger.warn({ err: e }, 'CounterfactualGraph init warning');
    }
  }

  generateCounterfactual(event: CounterfactualEvent, change: CounterfactualChange): CounterfactualResult {
    const originalSnapshot = this.buildSnapshot(event);

    const modifiedEvent = this.applyChange(event, change);
    const counterfactualSnapshot = this.buildSnapshot(modifiedEvent);

    const deltas = this.computeDeltas(originalSnapshot, counterfactualSnapshot);

    const summary = this.buildSummary(event, change, deltas);

    return {
      originalEvent: event,
      change,
      originalGraph: originalSnapshot,
      counterfactualGraph: counterfactualSnapshot,
      deltas,
      summary,
    };
  }

  getChangeTemplates(): Array<{ field: string; description: string; min: number; max: number; step: number }> {
    return CHANGE_TEMPLATES;
  }

  private applyChange(event: CounterfactualEvent, change: CounterfactualChange): CounterfactualEvent {
    const modified = { ...event };
    if (change.field === 'magnitude') {
      modified.magnitude = Number(change.newValue);
    } else if (change.field === 'depth') {
      modified.depth = Number(change.newValue);
    } else if (change.field === 'location.lat') {
      modified.location = { ...modified.location, lat: Number(change.newValue) };
    } else if (change.field === 'location.lon') {
      modified.location = { ...modified.location, lon: Number(change.newValue) };
    }
    return modified;
  }

  private buildSnapshot(event: CounterfactualEvent): CounterfactualGraphSnapshot {
    const entities = this.generateEntities(event);
    const edges = this.generateEdges(entities);
    const conditioning = this.buildConditioning(event);
    const pointCloud = this.synthesizeCloud(conditioning);

    return { entities, edges, pointCloud, conditioning };
  }

  private generateEntities(event: CounterfactualEvent): CounterfactualGraphSnapshot['entities'] {
    const types = [
      { name: 'shaking_intensity', type: 'seismic_event', mult: 0.1 },
      { name: 'aftershocks', type: 'seismic_event', mult: 0.08 },
      { name: 'structural_damage', type: 'damage_assessment', mult: 0.12 },
      { name: 'liquefaction', type: 'geological_hazard', mult: 0.06 },
    ];

    return types.map(t => ({
      name: t.name,
      type: t.type,
      probability: Math.min(0.95, Math.max(0.05, (event.magnitude || 5) * t.mult)),
      severity: (event.magnitude || 5) >= 7 ? 'high' : (event.magnitude || 5) >= 5 ? 'medium' : 'low',
    }));
  }

  private generateEdges(entities: CounterfactualGraphSnapshot['entities']): CounterfactualGraphSnapshot['edges'] {
    const edges: CounterfactualGraphSnapshot['edges'] = [];
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const prob = (entities[i].probability + entities[j].probability) / 2;
        edges.push({
          source: entities[i].name,
          target: entities[j].name,
          relation: 'causes',
          probability: prob,
        });
      }
    }
    return edges;
  }

  private buildConditioning(event: CounterfactualEvent): Partial<ConditioningVector> {
    const severity = (event.magnitude || 5) >= 8 ? 'extreme' : (event.magnitude || 5) >= 6 ? 'high' : (event.magnitude || 5) >= 4 ? 'medium' : 'low';
    return {
      lat: event.location.lat / 90,
      lon: event.location.lon / 180,
      magnitude: (event.magnitude || 5) / 10,
      severity: ['low', 'medium', 'high', 'extreme'].indexOf(severity) / 3,
      intensity: Math.min(1, (event.magnitude || 5) / 9),
      time: Date.now() / 1e13,
      elevation: (event.depth || 10) / 100,
      hazardType: 'seismic',
      spreadX: 0.1,
      spreadY: 0.1,
      spreadZ: 0.05,
      mask: 0,
    };
  }

  private synthesizeCloud(conditioning: Partial<ConditioningVector>): PointCloud {
    if (this.initialized && process.env.EARTHGEN_CHECKPOINT) {
      try {
        return this.earthGen.generate(conditioning as ConditioningVector, 256);
      } catch { /* fall through */ }
    }
    return [];
  }

  private computeDeltas(original: CounterfactualGraphSnapshot, counterfactual: CounterfactualGraphSnapshot): CounterfactualDelta[] {
    const deltas: CounterfactualDelta[] = [];

    for (const origEntity of original.entities) {
      const cfEntity = counterfactual.entities.find(e => e.name === origEntity.name);
      if (!cfEntity) {
        deltas.push({
          field: `entity.${origEntity.name}`,
          original: origEntity.probability,
          modified: 0,
          impact: 'new_hazard',
          magnitude: origEntity.probability,
        });
        continue;
      }

      const diff = cfEntity.probability - origEntity.probability;
      if (Math.abs(diff) > 0.05) {
        deltas.push({
          field: `entity.${origEntity.name}.probability`,
          original: origEntity.probability,
          modified: cfEntity.probability,
          impact: diff > 0 ? 'increased_risk' : 'decreased_risk',
          magnitude: Math.abs(diff),
        });
      }
    }

    for (const origEdge of original.edges) {
      const cfEdge = counterfactual.edges.find(e => e.source === origEdge.source && e.target === origEdge.target);
      if (!cfEdge) {
        deltas.push({
          field: `edge.${origEdge.source}→${origEdge.target}`,
          original: origEdge.probability,
          modified: 0,
          impact: 'new_hazard',
          magnitude: origEdge.probability,
        });
      } else {
        const diff = cfEdge.probability - origEdge.probability;
        if (Math.abs(diff) > 0.05) {
          deltas.push({
            field: `edge.${origEdge.source}→${origEdge.target}.probability`,
            original: origEdge.probability,
            modified: cfEdge.probability,
            impact: diff > 0 ? 'increased_risk' : 'decreased_risk',
            magnitude: Math.abs(diff),
          });
        }
      }
    }

    return deltas;
  }

  private buildSummary(event: CounterfactualEvent, change: CounterfactualChange, deltas: CounterfactualDelta[]): string {
    const inc = deltas.filter(d => d.impact === 'increased_risk');
    const dec = deltas.filter(d => d.impact === 'decreased_risk');
    const newH = deltas.filter(d => d.impact === 'new_hazard');

    const parts: string[] = [];
    parts.push(`If ${change.description}:`);

    if (inc.length > 0) {
      parts.push(`Increased risk: ${inc.map(d => `${d.field} (+${(d.magnitude * 100).toFixed(0)}%)`).join(', ')}`);
    }
    if (dec.length > 0) {
      parts.push(`Decreased risk: ${dec.map(d => `${d.field} (-${(d.magnitude * 100).toFixed(0)}%)`).join(', ')}`);
    }
    if (newH.length > 0) {
      parts.push(`New hazards: ${newH.map(d => d.field).join(', ')}`);
    }

    return parts.join('. ');
  }
}

export const counterfactualGraph = new CounterfactualGraph();
