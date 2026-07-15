import { getDb } from '../db/index';
import { logger } from '../observability/logger';

export interface PartialGraph {
  entities: Array<{ id?: number; name: string; type: string; metadata?: Record<string, unknown> }>;
  edges: Array<{ source: string; target: string; relationType: string; weight: number }>;
}

export interface CompletedEdge {
  source: string;
  target: string;
  relationType: string;
  confidence: number;
  physicalPlausibility: number;
  evidence: string[];
  sourceMetadata?: Record<string, unknown>;
  targetMetadata?: Record<string, unknown>;
}

export interface CompletionResult {
  completedEdges: CompletedEdge[];
  totalCandidates: number;
  acceptedCount: number;
  rejectionReasons: string[];
}

const RELATION_TYPES = ['causes', 'triggers', 'leads_to', 'exacerbates', 'damages', 'correlates_with'];

export class GraphCompletion {
  private entityEmbeddings: Map<string, Float64Array> = new Map();
  private maxEmbeddingDim = 64;

  init(): void {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, name, type FROM knowledge_entities LIMIT 1000').all() as Array<{ id: number; name: string; type: string }>;
      for (const row of rows) {
        this.entityEmbeddings.set(row.name, this.computeEmbedding(row.name, row.type));
      }
      logger.info({ entities: this.entityEmbeddings.size }, 'GraphCompletion initialized');
    } catch (e) {
      logger.warn({ err: e }, 'GraphCompletion init failed');
    }
  }

  complete(graph: PartialGraph): CompletionResult {
    const candidates = this.generateCandidates(graph);
    const validated = this.validateCandidates(candidates, graph);
    const accepted: CompletedEdge[] = [];
    const rejected: string[] = [];

    for (const edge of validated) {
      if (edge.confidence >= 0.3 && edge.physicalPlausibility >= 0.2) {
        accepted.push(edge);
      } else {
        rejected.push(`${edge.source}→${edge.target} (${edge.relationType}): conf=${edge.confidence.toFixed(2)}, plaus=${edge.physicalPlausibility.toFixed(2)}`);
      }
    }

    return {
      completedEdges: accepted.sort((a, b) => b.confidence - a.confidence),
      totalCandidates: candidates.length,
      acceptedCount: accepted.length,
      rejectionReasons: rejected.slice(0, 20),
    };
  }

  private generateCandidates(graph: PartialGraph): Array<{ source: string; target: string; relationType: string }> {
    const candidates: Array<{ source: string; target: string; relationType: string }> = [];

    const entityNames = new Set(graph.entities.map(e => e.name));
    const existingEdges = new Set(graph.edges.map(e => `${e.source}:${e.target}:${e.relationType}`));

    const nameList = Array.from(entityNames);
    for (let i = 0; i < nameList.length; i++) {
      for (let j = 0; j < nameList.length; j++) {
        if (i === j) continue;
        for (const relationType of RELATION_TYPES) {
          const key = `${nameList[i]}:${nameList[j]}:${relationType}`;
          if (!existingEdges.has(key)) {
            candidates.push({ source: nameList[i], target: nameList[j], relationType });
          }
        }
      }
    }

    return candidates;
  }

  private validateCandidates(
    candidates: Array<{ source: string; target: string; relationType: string }>,
    graph: PartialGraph,
  ): CompletedEdge[] {
    const completed: CompletedEdge[] = [];
    const sourceMap = new Map(graph.entities.map(e => [e.name, e]));

    for (const cand of candidates) {
      const source = sourceMap.get(cand.source);
      const target = sourceMap.get(cand.target);
      if (!source || !target) continue;

      const linkScore = this.predictLinkScore(source, target, cand.relationType);
      const plausibility = this.checkPhysicalPlausibility(source, target, cand.relationType);
      const evidence = this.gatherEvidence(source, target, cand.relationType);

      const confidence = linkScore * 0.6 + plausibility * 0.4;

      completed.push({
        source: cand.source,
        target: cand.target,
        relationType: cand.relationType,
        confidence,
        physicalPlausibility: plausibility,
        evidence,
        sourceMetadata: source.metadata,
        targetMetadata: target.metadata,
      });
    }

    return completed;
  }

  private predictLinkScore(
    source: { name: string; type: string },
    target: { name: string; type: string },
    relationType: string,
  ): number {
    const sourceEmb = this.entityEmbeddings.get(source.name) || this.computeEmbedding(source.name, source.type);
    const targetEmb = this.entityEmbeddings.get(target.name) || this.computeEmbedding(target.name, target.type);
    const similarity = this.cosineSimilarity(sourceEmb, targetEmb);

    const typeCompatibility = this.typeCompatibility(source.type, target.type, relationType);

    const dbBoost = this.checkDatabaseCoOccurrence(source.name, target.name);

    return similarity * 0.3 + typeCompatibility * 0.4 + dbBoost * 0.3;
  }

  private computeEmbedding(name: string, type: string): Float64Array {
    const emb = new Float64Array(this.maxEmbeddingDim);
    const combined = (name + ':' + type).toLowerCase();
    
    // Character frequency-based embedding (captures semantic content)
    const charFreq = new Map<string, number>();
    for (const ch of combined) {
      charFreq.set(ch, (charFreq.get(ch) || 0) + 1);
    }
    
    // N-gram features (bigrams capture word structure)
    const bigrams = new Map<string, number>();
    for (let i = 0; i < combined.length - 1; i++) {
      const bg = combined.slice(i, i + 2);
      bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
    }
    
    // Type-specific bias
    const typeBias = type.length * 0.01;
    
    // Fill embedding with meaningful features
    let idx = 0;
    for (const [ch, count] of charFreq) {
      if (idx >= emb.length) break;
      emb[idx] = count / combined.length;
      idx++;
    }
    for (const [, count] of bigrams) {
      if (idx >= emb.length) break;
      emb[idx] = count / Math.max(1, combined.length - 1);
      idx++;
    }
    // Fill remaining with type/name length features
    while (idx < emb.length) {
      emb[idx] = Math.sin(idx * typeBias + name.length * 0.1) * 0.5;
      idx++;
    }
    
    return emb;
  }

  private cosineSimilarity(a: Float64Array, b: Float64Array): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : (dot / denom + 1) / 2;
  }

  private typeCompatibility(sourceType: string, targetType: string, _relationType: string): number {
    const compatMap: Record<string, Record<string, number>> = {
      'seismic_event': { 'marine_hazard': 0.7, 'geological_hazard': 0.8, 'damage_assessment': 0.9, 'human_impact': 0.7, 'fire_hazard': 0.5, 'infrastructure': 0.8 },
      'marine_hazard': { 'damage_assessment': 0.9, 'human_impact': 0.8, 'infrastructure': 0.7, 'environmental': 0.3 },
      'fire_hazard': { 'environmental': 0.9, 'damage_assessment': 0.8, 'human_impact': 0.7, 'infrastructure': 0.6 },
      'geological_hazard': { 'infrastructure': 0.8, 'damage_assessment': 0.7, 'human_impact': 0.5 },
      'flood_hazard': { 'damage_assessment': 0.9, 'human_impact': 0.8, 'environmental': 0.7, 'infrastructure': 0.8 },
      'damage_assessment': { 'human_impact': 0.7, 'infrastructure': 0.5 },
      'infrastructure': { 'human_impact': 0.6 },
      'environmental': { 'human_impact': 0.5 },
      'human_impact': {},
      'volcanic': { 'environmental': 0.9, 'marine_hazard': 0.4, 'damage_assessment': 0.8, 'human_impact': 0.7 },
    };
    return compatMap[sourceType]?.[targetType] ?? 0.1;
  }

  private checkPhysicalPlausibility(
    source: { name: string; type: string },
    target: { name: string; type: string },
    _relationType: string,
  ): number {
    const causalPairs: Array<[string, string, number]> = [
      ['earthquake', 'tsunami', 0.3], ['earthquake', 'landslide', 0.6], ['earthquake', 'liquefaction', 0.7],
      ['earthquake', 'aftershock', 0.9], ['earthquake', 'tsunami', 0.3],
      ['tsunami', 'flooding', 0.8], ['tsunami', 'coastal_erosion', 0.7],
      ['hurricane', 'flooding', 0.9], ['hurricane', 'storm_surge', 0.9],
      ['wildfire', 'air_quality', 0.9], ['wildfire', 'landslide', 0.3],
      ['volcanic_eruption', 'ash_fall', 0.9], ['volcanic_eruption', 'lava_flow', 0.8],
      ['flooding', 'landslide', 0.5], ['flooding', 'water_contamination', 0.7],
    ];

    const sourceName = source.name.toLowerCase().replace(/_/g, ' ');
    const targetName = target.name.toLowerCase().replace(/_/g, ' ');

    for (const [s, t, prob] of causalPairs) {
      if (sourceName.includes(s) && targetName.includes(t)) {
        return prob;
      }
    }

    return 0.15;
  }

  private checkDatabaseCoOccurrence(sourceName: string, targetName: string): number {
    try {
      const db = getDb();
      const row = db.prepare(`
        SELECT COUNT(*) as c FROM knowledge_relations r
        JOIN knowledge_entities e1 ON r.source_id = e1.id
        JOIN knowledge_entities e2 ON r.target_id = e2.id
        WHERE e1.name = ? AND e2.name = ?
      `).get(sourceName, targetName) as { c: number } | undefined;
      return row ? Math.min(1, row.c * 0.2) : 0;
    } catch {
      return 0;
    }
  }

  private gatherEvidence(source: { name: string; type: string }, target: { name: string; type: string }, relationType: string): string[] {
    const evidence: string[] = [];
    evidence.push(`Link prediction score: ${this.predictLinkScore(source, target, relationType).toFixed(2)}`);

    const compat = this.typeCompatibility(source.type, target.type, relationType);
    if (compat > 0.5) evidence.push(`Type compatibility: ${source.type} → ${target.type}`);

    const plaus = this.checkPhysicalPlausibility(source, target, relationType);
    if (plaus > 0.5) evidence.push(`Physically plausible (${source.name} → ${target.name})`);

    const dbHit = this.checkDatabaseCoOccurrence(source.name, target.name);
    if (dbHit > 0) evidence.push(`Co-occurrence in knowledge base`);

    return evidence;
  }
}

export const graphCompletion = new GraphCompletion();
