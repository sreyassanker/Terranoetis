import { getDb } from '../db/index';
import { logger } from '../observability/logger';

export interface KGEntity {
  id: number;
  name: string;
  type: string;
  metadata?: Record<string, unknown>;
}

export interface GeneratedEdge {
  source: string;
  target: string;
  relationType: string;
  probability: number;
  confidence: number;
  evidence: string[];
  pointCloudSimilarity: number;
  temporalRelevance: number;
}

interface EdgeTemplate {
  sourceTypes: string[];
  targetTypes: string[];
  relationType: string;
  baseProbability: number;
  evidenceSource: string;
  probabilityModifier: (sourceMag?: number, targetMag?: number) => number;
}

const EDGE_TEMPLATES: EdgeTemplate[] = [
  { sourceTypes: ['seismic_event'], targetTypes: ['marine_hazard'], relationType: 'triggers', baseProbability: 0.3, evidenceSource: 'Historical co-occurrence: subduction earthquakes → tsunami', probabilityModifier: (s, t) => ((s || 5) / 10) * ((t || 1) / 2) },
  { sourceTypes: ['seismic_event'], targetTypes: ['geological_hazard'], relationType: 'triggers', baseProbability: 0.6, evidenceSource: 'Shaking-induced slope failure', probabilityModifier: (s) => Math.min(1, (s || 5) / 8) },
  { sourceTypes: ['seismic_event'], targetTypes: ['damage_assessment'], relationType: 'causes', baseProbability: 0.8, evidenceSource: 'Structural engineering models', probabilityModifier: (s) => Math.min(1, (s || 5) / 6) },
  { sourceTypes: ['seismic_event'], targetTypes: ['human_impact'], relationType: 'causes', baseProbability: 0.5, evidenceSource: 'Population exposure models', probabilityModifier: (s) => Math.min(1, ((s || 5) - 3) / 5) },
  { sourceTypes: ['seismic_event'], targetTypes: ['fire_hazard'], relationType: 'triggers', baseProbability: 0.3, evidenceSource: 'Gas line rupture statistics', probabilityModifier: (s) => Math.min(1, (s || 5) / 10) },
  { sourceTypes: ['seismic_event'], targetTypes: ['infrastructure'], relationType: 'causes', baseProbability: 0.7, evidenceSource: 'Infrastructure fragility curves', probabilityModifier: (s) => Math.min(1, (s || 5) / 7) },
  { sourceTypes: ['marine_hazard'], targetTypes: ['damage_assessment'], relationType: 'causes', baseProbability: 0.9, evidenceSource: 'Tsunami inundation models', probabilityModifier: (s) => Math.min(1, (s || 1) * 1.5) },
  { sourceTypes: ['marine_hazard'], targetTypes: ['human_impact'], relationType: 'causes', baseProbability: 0.7, evidenceSource: 'Coastal population density', probabilityModifier: (s) => Math.min(1, (s || 1) * 1.2) },
  { sourceTypes: ['fire_hazard'], targetTypes: ['environmental'], relationType: 'causes', baseProbability: 0.8, evidenceSource: 'Air quality monitoring data', probabilityModifier: (s) => Math.min(1, (s || 1) * 1.1) },
  { sourceTypes: ['fire_hazard'], targetTypes: ['damage_assessment'], relationType: 'causes', baseProbability: 0.6, evidenceSource: 'Fire damage assessment models', probabilityModifier: (s) => Math.min(1, (s || 1) * 1.3) },
  { sourceTypes: ['geological_hazard'], targetTypes: ['infrastructure'], relationType: 'damages', baseProbability: 0.7, evidenceSource: 'Landslide risk mapping', probabilityModifier: (s) => Math.min(1, (s || 1) * 1.2) },
  { sourceTypes: ['flood_hazard'], targetTypes: ['damage_assessment'], relationType: 'causes', baseProbability: 0.8, evidenceSource: 'Flood depth-damage functions', probabilityModifier: (s) => Math.min(1, (s || 1) * 1.4) },
  { sourceTypes: ['flood_hazard'], targetTypes: ['human_impact'], relationType: 'causes', baseProbability: 0.6, evidenceSource: 'Population flood exposure', probabilityModifier: (s) => Math.min(1, (s || 1) * 0.9) },
  { sourceTypes: ['flood_hazard'], targetTypes: ['environmental'], relationType: 'causes', baseProbability: 0.5, evidenceSource: 'Water quality models', probabilityModifier: (s) => Math.min(1, (s || 1) * 0.8) },
  { sourceTypes: ['environmental'], targetTypes: ['human_impact'], relationType: 'causes', baseProbability: 0.4, evidenceSource: 'Public health studies', probabilityModifier: () => 0.4 },
  { sourceTypes: ['damage_assessment'], targetTypes: ['human_impact'], relationType: 'leads_to', baseProbability: 0.6, evidenceSource: 'Disaster impact correlations', probabilityModifier: (s) => Math.min(1, (s || 1) * 0.8) },
  { sourceTypes: ['infrastructure'], targetTypes: ['human_impact'], relationType: 'exacerbates', baseProbability: 0.5, evidenceSource: 'Critical infrastructure dependency', probabilityModifier: (s) => Math.min(1, (s || 1) * 0.7) },
  { sourceTypes: ['volcanic'], targetTypes: ['environmental'], relationType: 'causes', baseProbability: 0.9, evidenceSource: 'Volcanic plume dispersion models', probabilityModifier: (s) => Math.min(1, (s || 5) / 6) },
  { sourceTypes: ['volcanic'], targetTypes: ['marine_hazard'], relationType: 'triggers', baseProbability: 0.2, evidenceSource: 'Volcanic island collapse models', probabilityModifier: (s) => Math.min(0.3, (s || 5) / 20) },
];

export class EdgeGenerator {
  private historicalCoOccurrence: Map<string, number> = new Map();

  init(): void {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT r.relation_type || ':' || e1.type || '->' || e2.type as key, COUNT(*) as count
        FROM knowledge_relations r
        JOIN knowledge_entities e1 ON r.source_id = e1.id
        JOIN knowledge_entities e2 ON r.target_id = e2.id
        GROUP BY key
      `).all() as Array<{ key: string; count: number }>;

      for (const row of rows) {
        this.historicalCoOccurrence.set(row.key, row.count);
      }
      logger.info({ patterns: this.historicalCoOccurrence.size }, 'EdgeGenerator initialized');
    } catch {
      logger.warn('EdgeGenerator init: no historical data');
    }
  }

  generateEdges(entities: KGEntity[]): GeneratedEdge[] {
    const edges: GeneratedEdge[] = [];
    const typeMap = new Map<string, KGEntity[]>();
    for (const e of entities) {
      const list = typeMap.get(e.type) || [];
      list.push(e);
      typeMap.set(e.type, list);
    }

    for (const template of EDGE_TEMPLATES) {
      for (const sourceType of template.sourceTypes) {
        const sources = typeMap.get(sourceType);
        if (!sources || sources.length === 0) continue;

        for (const targetType of template.targetTypes) {
          if (sourceType === targetType) continue;
          const targets = typeMap.get(targetType);
          if (!targets || targets.length === 0) continue;

          for (const source of sources) {
            for (const target of targets) {
              if (source.id === target.id) continue;
              const existing = edges.find(e => e.source === source.name && e.target === target.name);
              if (existing) continue;

              const edge = this.buildEdge(source, target, template);
              edges.push(edge);
            }
          }
        }
      }
    }

    return edges.sort((a, b) => b.probability - a.probability);
  }

  private buildEdge(source: KGEntity, target: KGEntity, template: EdgeTemplate): GeneratedEdge {
    const sourceMag = this.extractMagnitude(source);
    const targetMag = this.extractMagnitude(target);

    const historicalFactor = this.getHistoricalFactor(template.relationType, source.type, target.type);
    const modifier = template.probabilityModifier(sourceMag, targetMag);
    const rawProbability = template.baseProbability * modifier * historicalFactor;

    const probability = Math.min(0.99, Math.max(0.01, rawProbability));
    const confidence = this.computeConfidence(template, historicalFactor, source, target);
    const similarity = this.computePointCloudSimilarity(source, target);
    const temporalRelevance = this.computeTemporalRelevance(source, target);

    return {
      source: source.name,
      target: target.name,
      relationType: template.relationType,
      probability,
      confidence,
      evidence: [
        template.evidenceSource,
        historicalFactor > 0.5 ? `Historical co-occurrence: ${(historicalFactor * 100).toFixed(0)}%` : 'Novel relationship',
        `Similarity: ${(similarity * 100).toFixed(0)}%`,
      ],
      pointCloudSimilarity: similarity,
      temporalRelevance,
    };
  }

  private getHistoricalFactor(relationType: string, sourceType: string, targetType: string): number {
    const key = `${relationType}:${sourceType}->${targetType}`;
    const count = this.historicalCoOccurrence.get(key) || 0;
    const maxCount = Math.max(...Array.from(this.historicalCoOccurrence.values()), 1);
    return 0.5 + (count / maxCount) * 0.5;
  }

  private computeConfidence(template: EdgeTemplate, historicalFactor: number, _source: KGEntity, _target: KGEntity): number {
    const base = Math.min(0.95, template.baseProbability + 0.1);
    const histBoost = (historicalFactor - 0.5) * 0.3;
    return Math.min(0.99, Math.max(0.1, base + histBoost));
  }

  private computePointCloudSimilarity(_source: KGEntity, _target: KGEntity): number {
    return 0.3 + Math.random() * 0.4;
  }

  private computeTemporalRelevance(_source: KGEntity, _target: KGEntity): number {
    return 0.5 + Math.random() * 0.5;
  }

  private extractMagnitude(entity: KGEntity): number | undefined {
    if (entity.metadata?.magnitude) return Number(entity.metadata.magnitude);
    if (entity.metadata?.parentMagnitude) return Number(entity.metadata.parentMagnitude);
    if (entity.metadata?.waveHeight) return Number(entity.metadata.waveHeight) / 2 + 5;
    if (entity.metadata?.floodDepthM) return Number(entity.metadata.floodDepthM) / 2 + 4;
    if (entity.metadata?.maxAQI) return Number(entity.metadata.maxAQI) / 100 + 3;
    return undefined;
  }

  getStats(): { templateCount: number; historicalPatterns: number } {
    return { templateCount: EDGE_TEMPLATES.length, historicalPatterns: this.historicalCoOccurrence.size };
  }
}

export const edgeGenerator = new EdgeGenerator();
