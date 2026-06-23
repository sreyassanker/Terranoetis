import { getDb } from '../db/index';
import { EmbeddingEngine, embeddingToBuffer, bufferToEmbedding } from '../embedding';
import { logger } from '../observability/logger';
import { safeJsonParse } from '../utils/jsonParse';

// ── Types ───────────────────────────────────────────────────────

export type CausalRelation = 'causes' | 'enables' | 'inhibits' | 'correlates';

export interface CausalNode {
  id: number;
  name: string;
  type: 'event' | 'condition' | 'hazard' | 'location';
  prior: number;
  embedding: Float32Array | null;
  metadata: Record<string, unknown>;
}

export interface CausalEdge {
  id: number;
  sourceId: number;
  targetId: number;
  relation: CausalRelation;
  weight: number;
  evidenceCount: number;
}

export interface InferenceEvidence {
  nodeName: string;
  observed: boolean;
  confidence: number;
}

export interface PosteriorResult {
  nodeName: string;
  posterior: number;
  confidence: number;
  contributingPaths: Array<{ path: string; strength: number }>;
}

// ── Domain knowledge priors ─────────────────────────────────────

const DOMAIN_EDGES: Array<{
  source: string; target: string; relation: CausalRelation; weight: number;
}> = [
  { source: 'plate_stress', target: 'earthquake', relation: 'causes', weight: 0.75 },
  { source: 'earthquake', target: 'tsunami', relation: 'causes', weight: 0.40 },
  { source: 'earthquake', target: 'landslide', relation: 'causes', weight: 0.35 },
  { source: 'earthquake', target: 'aftershock', relation: 'causes', weight: 0.80 },
  { source: 'tsunami', target: 'coastal_flooding', relation: 'causes', weight: 0.90 },
  { source: 'tsunami', target: 'infrastructure_damage', relation: 'causes', weight: 0.85 },
  { source: 'heavy_rainfall', target: 'flood', relation: 'causes', weight: 0.80 },
  { source: 'flood', target: 'landslide', relation: 'enables', weight: 0.50 },
  { source: 'high_temperature', target: 'wildfire', relation: 'enables', weight: 0.65 },
  { source: 'drought', target: 'wildfire', relation: 'enables', weight: 0.70 },
  { source: 'wildfire', target: 'air_quality_degradation', relation: 'causes', weight: 0.85 },
  { source: 'wildfire', target: 'infrastructure_damage', relation: 'causes', weight: 0.60 },
  { source: 'strong_wind', target: 'wildfire', relation: 'enables', weight: 0.55 },
  { source: 'strong_wind', target: 'storm_surge', relation: 'enables', weight: 0.60 },
  { source: 'low_pressure', target: 'storm', relation: 'enables', weight: 0.70 },
  { source: 'high_sea_surface_temp', target: 'storm', relation: 'enables', weight: 0.65 },
  { source: 'storm', target: 'flood', relation: 'causes', weight: 0.75 },
  { source: 'storm', target: 'storm_surge', relation: 'causes', weight: 0.80 },
  { source: 'storm', target: 'infrastructure_damage', relation: 'causes', weight: 0.70 },
  { source: 'volcanic_activity', target: 'earthquake', relation: 'causes', weight: 0.30 },
  { source: 'volcanic_activity', target: 'air_quality_degradation', relation: 'causes', weight: 0.75 },
  { source: 'volcanic_activity', target: 'tsunami', relation: 'causes', weight: 0.15 },
  { source: 'heavy_rainfall', target: 'landslide', relation: 'causes', weight: 0.60 },
  { source: 'earthquake', target: 'soil_liquefaction', relation: 'causes', weight: 0.45 },
  { source: 'soil_liquefaction', target: 'infrastructure_damage', relation: 'causes', weight: 0.80 },
  { source: 'high_temperature', target: 'drought', relation: 'causes', weight: 0.60 },
  { source: 'drought', target: 'water_shortage', relation: 'causes', weight: 0.75 },
  { source: 'sea_level_rise', target: 'coastal_flooding', relation: 'enables', weight: 0.50 },
  { source: 'land_subsidence', target: 'coastal_flooding', relation: 'enables', weight: 0.30 },
];

// ── CausalGraphEngine ───────────────────────────────────────────

export class CausalGraphEngine {
  private nodes = new Map<string, CausalNode>();
  private edges: CausalEdge[] = [];
  private adjacency = new Map<number, Array<{ targetId: number; relation: CausalRelation; weight: number }>>();
  private reverseAdj = new Map<number, Array<{ sourceId: number; relation: CausalRelation; weight: number }>>();
  private embedder: EmbeddingEngine | null = null;
  private initialized = false;

  setEmbeddingEngine(ee: EmbeddingEngine): void {
    this.embedder = ee;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.ensureTable();

    const loaded = this.loadFromDb();
    if (loaded === 0) {
      await this.seedDomainKnowledge();
    }

    this.buildAdjacency();
    this.initialized = true;
    logger.info({ nodes: this.nodes.size, edges: this.edges.length }, 'CausalGraphEngine initialized');
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS causal_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        prior REAL NOT NULL DEFAULT 0.5,
        embedding BLOB,
        metadata_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      db.exec(`CREATE TABLE IF NOT EXISTS causal_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL REFERENCES causal_nodes(id),
        target_id INTEGER NOT NULL REFERENCES causal_nodes(id),
        relation TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 0.5,
        evidence_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(source_id, target_id)
      )`);
    } catch { /* tables exist */ }
  }

  private async seedDomainKnowledge(): Promise<void> {
    for (const edgeDef of DOMAIN_EDGES) {
      const srcId = await this.ensureNode(edgeDef.source, 'condition', 0.1);
      const tgtId = this.ensureNode(edgeDef.target, 'event', 0.01);

      if (srcId && tgtId) {
        try {
          const db = getDb();
          db.prepare(`
            INSERT OR IGNORE INTO causal_edges (source_id, target_id, relation, weight)
            VALUES (?, ?, ?, ?)
          `).run(srcId, tgtId, edgeDef.relation, edgeDef.weight);
        } catch { /* silent */ }
      }
    }

    this.loadFromDb();
    logger.info({ edges: DOMAIN_EDGES.length }, 'Domain knowledge seeded');
  }

  private async ensureNode(name: string, type: string, prior: number): Promise<number | null> {
    const existing = this.getNodeByName(name);
    if (existing) return existing.id;

    let emb: Buffer | null = null;
    if (this.embedder) {
      try {
        const vec = await this.embedder.embed(name);
        emb = embeddingToBuffer(vec);
      } catch { /* optional */ }
    }

    try {
      const db = getDb();
      const result = db.prepare(`
        INSERT INTO causal_nodes (name, type, prior, embedding) VALUES (?, ?, ?, ?)
      `).run(name, type, prior, emb);
      return result.lastInsertRowid as number;
    } catch {
      return null;
    }
  }

  async addNode(name: string, type: CausalNode['type'], prior = 0.5, _metadata?: Record<string, unknown>): Promise<number | null> {
    return this.ensureNode(name, type, prior);
  }

  async addEdge(sourceName: string, targetName: string, relation: CausalRelation, weight: number): Promise<void> {
    const src = this.getNodeByName(sourceName);
    const tgt = this.getNodeByName(targetName);
    if (!src || !tgt) return;

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO causal_edges (source_id, target_id, relation, weight)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(source_id, target_id) DO UPDATE SET weight = excluded.weight, evidence_count = evidence_count + 1
      `).run(src.id, tgt.id, relation, weight);
    } catch { /* silent */ }

    this.loadFromDb();
    this.buildAdjacency();
  }

  infer(evidence: InferenceEvidence[]): PosteriorResult[] {
    const results: PosteriorResult[] = [];
    const evidenceNodes = new Set<string>();

    // Set observed nodes as evidence
    for (const ev of evidence) {
      const node = this.getNodeByName(ev.nodeName);
      if (node) {
        evidenceNodes.add(node.name);
      }
    }

    // BFS from evidence nodes through causal graph
    for (const ev of evidence) {
      const startNode = this.getNodeByName(ev.nodeName);
      if (!startNode) continue;

      const visited = new Set<number>();
      const queue: Array<{ nodeId: number; path: string[]; strength: number }> = [
        { nodeId: startNode.id, path: [startNode.name], strength: ev.confidence },
      ];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current.nodeId)) continue;
        visited.add(current.nodeId);

        const neighbors = this.adjacency.get(current.nodeId) || [];
        for (const neighbor of neighbors) {
          const neighborNode = this.getNodeById(neighbor.targetId);
          if (!neighborNode || visited.has(neighbor.targetId)) continue;

          const pathStrength = current.strength * neighbor.weight;
          const newPath = [...current.path, neighborNode.name];

          // Compute posterior using noisy-OR approximation
          const nodePrior = neighborNode.prior;
          const posterior = nodePrior + (1 - nodePrior) * pathStrength;

          const existing = results.find(r => r.nodeName === neighborNode.name);
          if (existing) {
            const combined = 1 - (1 - existing.posterior) * (1 - posterior);
            existing.posterior = Math.min(1, combined);
            existing.confidence = Math.max(existing.confidence, pathStrength);
            existing.contributingPaths.push({ path: newPath.join(' → '), strength: pathStrength });
          } else {
            results.push({
              nodeName: neighborNode.name,
              posterior: Math.min(1, posterior),
              confidence: pathStrength,
              contributingPaths: [{ path: newPath.join(' → '), strength: pathStrength }],
            });
          }

          if (pathStrength > 0.05) {
            queue.push({ nodeId: neighbor.targetId, path: newPath, strength: pathStrength * 0.5 });
          }
        }
      }
    }

    return results
      .filter(r => r.nodeName !== evidence[0]?.nodeName)
      .sort((a, b) => b.posterior - a.posterior)
      .slice(0, 10);
  }

  async learnFromOutcome(observedEvents: string[], _outcome: string): Promise<void> {
    // Update edge weights based on observed co-occurrence
    for (const cause of observedEvents) {
      for (const effect of observedEvents.filter(e => e !== cause)) {
        const src = this.getNodeByName(cause);
        const tgt = this.getNodeByName(effect);
        if (!src || !tgt) continue;

        const edge = this.edges.find(
          e => e.sourceId === src.id && e.targetId === tgt.id,
        );

        if (edge) {
          const newWeight = Math.min(1, edge.weight + 0.05);
          try {
            const db = getDb();
            db.prepare('UPDATE causal_edges SET weight = ?, evidence_count = evidence_count + 1 WHERE id = ?')
              .run(newWeight, edge.id);
          } catch { /* silent */ }
        } else {
          await this.addEdge(cause, effect, 'correlates', 0.3);
        }
      }
    }

    this.loadFromDb();
    this.buildAdjacency();
  }

  getNodeByName(name: string): CausalNode | undefined {
    return this.nodes.get(name.toLowerCase());
  }

  getNodeById(id: number): CausalNode | undefined {
    for (const node of this.nodes.values()) {
      if (node.id === id) return node;
    }
    return undefined;
  }

  getEdges(): CausalEdge[] {
    return [...this.edges];
  }

  getDownstream(nodeName: string, _depth = 2): PosteriorResult[] {
    const node = this.getNodeByName(nodeName);
    if (!node) return [];
    return this.infer([{ nodeName, observed: true, confidence: 0.8 }]).filter(
      r => r.confidence > 0.05,
    );
  }

  toDot(): string {
    const lines: string[] = ['digraph CausalGraph {'];
    for (const node of this.nodes.values()) {
      lines.push(`  "${node.name}" [label="${node.name}\\nprior=${node.prior}"];`);
    }
    for (const edge of this.edges) {
      const src = this.getNodeById(edge.sourceId);
      const tgt = this.getNodeById(edge.targetId);
      if (src && tgt) {
        const style = edge.relation === 'inhibits' ? 'dashed' : 'solid';
        const color = edge.relation === 'causes' ? 'red' : edge.relation === 'enables' ? 'orange' : edge.relation === 'inhibits' ? 'blue' : 'gray';
        lines.push(`  "${src.name}" -> "${tgt.name}" [label="${edge.relation}\\n${edge.weight.toFixed(2)}" style="${style}" color="${color}"];`);
      }
    }
    lines.push('}');
    return lines.join('\n');
  }

  private loadFromDb(): number {
    try {
      const db = getDb();
      const nodeRows = db.prepare('SELECT * FROM causal_nodes').all() as Array<Record<string, unknown>>;
      this.nodes.clear();
      for (const row of nodeRows) {
        this.nodes.set((row.name as string).toLowerCase(), {
          id: row.id as number,
          name: row.name as string,
          type: row.type as CausalNode['type'],
          prior: row.prior as number || 0.5,
          embedding: row.embedding ? bufferToEmbedding(row.embedding as Buffer) : null,
          metadata: safeJsonParse((row.metadata_json as string) || '{}', {}),
        });
      }

      const edgeRows = db.prepare('SELECT * FROM causal_edges').all() as Array<Record<string, unknown>>;
      this.edges = edgeRows.map(r => ({
        id: r.id as number,
        sourceId: r.source_id as number,
        targetId: r.target_id as number,
        relation: r.relation as CausalRelation,
        weight: r.weight as number || 0.5,
        evidenceCount: r.evidence_count as number || 1,
      }));

      return nodeRows.length;
    } catch {
      return 0;
    }
  }

  private buildAdjacency(): void {
    this.adjacency.clear();
    this.reverseAdj.clear();

    for (const edge of this.edges) {
      if (!this.adjacency.has(edge.sourceId)) {
        this.adjacency.set(edge.sourceId, []);
      }
      this.adjacency.get(edge.sourceId)!.push({
        targetId: edge.targetId,
        relation: edge.relation,
        weight: edge.relation === 'inhibits' ? 1 - edge.weight : edge.weight,
      });

      if (!this.reverseAdj.has(edge.targetId)) {
        this.reverseAdj.set(edge.targetId, []);
      }
      this.reverseAdj.get(edge.targetId)!.push({
        sourceId: edge.sourceId,
        relation: edge.relation,
        weight: edge.weight,
      });
    }
  }
}

export const causalGraph = new CausalGraphEngine();
