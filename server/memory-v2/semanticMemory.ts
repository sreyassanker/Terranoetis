import { getDb } from '../db/index';
import { EmbeddingEngine, cosineSimilarity, embeddingToBuffer, bufferToEmbedding } from '../embedding';
import { logger } from '../observability/logger';

// ── Types ───────────────────────────────────────────────────────

export interface SemanticEntity {
  id: number;
  name: string;
  type: string;
  metadata: Record<string, unknown>;
  embedding: Float32Array | null;
}

export interface SemanticRelation {
  id: number;
  sourceId: number;
  targetId: number;
  relationType: string;
  weight: number;
  sourceName: string;
  targetName: string;
}

export interface InferenceResult {
  path: Array<{ entity: string; relation: string; direction: 'forward' | 'reverse' }>;
  confidence: number;
  conclusion: string;
}

// ── Traversal directions ────────────────────────────────────────

const INFERENCE_RULES: Array<{
  fromType: string;
  relation: string;
  toType: string;
  conclusion: string;
  defaultConfidence: number;
}> = [
  { fromType: 'city', relation: 'located_in', toType: 'region', conclusion: '{source} is in {target}', defaultConfidence: 0.9 },
  { fromType: 'region', relation: 'related_to', toType: 'hazard_zone', conclusion: '{source} has {target}', defaultConfidence: 0.7 },
  { fromType: 'hazard_zone', relation: 'has_risk', toType: 'risk_level', conclusion: '{source} risk: {target}', defaultConfidence: 0.6 },
  { fromType: 'city', relation: 'near', toType: 'fault_line', conclusion: '{source} is near {target}', defaultConfidence: 0.8 },
  { fromType: 'fault_line', relation: 'associated_with', toType: 'seismic_zone', conclusion: '{target} crosses {source}', defaultConfidence: 0.85 },
  { fromType: 'city', relation: 'has_weather', toType: 'climate_zone', conclusion: '{source} has {target} climate', defaultConfidence: 0.75 },
  { fromType: 'event', relation: 'causes', toType: 'event', conclusion: '{source} can cause {target}', defaultConfidence: 0.6 },
  { fromType: 'volcano', relation: 'located_in', toType: 'region', conclusion: '{source} is in {target}', defaultConfidence: 0.9 },
  { fromType: 'volcano', relation: 'has_risk', toType: 'risk_level', conclusion: '{source} poses {target} risk', defaultConfidence: 0.7 },
  { fromType: 'data_source', relation: 'provides', toType: 'data_type', conclusion: '{source} provides {target}', defaultConfidence: 0.9 },
];

// ── SemanticMemory ──────────────────────────────────────────────

export class SemanticMemory {
  private embedder: EmbeddingEngine;

  constructor(embedder: EmbeddingEngine) {
    this.embedder = embedder;
  }

  init(): void {
    this.ensureTable();
    logger.info('SemanticMemory initialized');
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS semantic_entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'entity',
        embedding BLOB,
        metadata_json TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_semantic_entities_type ON semantic_entities(type)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_semantic_entities_name ON semantic_entities(name)`);

      db.exec(`CREATE TABLE IF NOT EXISTS semantic_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL REFERENCES semantic_entities(id),
        target_id INTEGER NOT NULL REFERENCES semantic_entities(id),
        relation_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(source_id, target_id, relation_type)
      )`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_semantic_rel_source ON semantic_relations(source_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_semantic_rel_target ON semantic_relations(target_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_semantic_rel_type ON semantic_relations(relation_type)`);
    } catch { /* tables exist */ }
  }

  async addEntity(name: string, type: string, metadata?: Record<string, unknown>): Promise<number> {
    let emb: Buffer | null = null;
    try {
      const vec = await this.embedder.embed(name);
      emb = embeddingToBuffer(vec);
    } catch { /* embedding optional */ }

    try {
      const db = getDb();
      const existing = db.prepare('SELECT id FROM semantic_entities WHERE name = ?').get(name) as { id: number } | undefined;
      if (existing) {
        if (emb) {
          db.prepare('UPDATE semantic_entities SET embedding = ?, metadata_json = ? WHERE id = ?')
            .run(emb, JSON.stringify(metadata ?? {}), existing.id);
        }
        return existing.id;
      }

      const result = db.prepare(`
        INSERT INTO semantic_entities (name, type, embedding, metadata_json)
        VALUES (?, ?, ?, ?)
      `).run(name, type, emb, JSON.stringify(metadata ?? {}));

      return result.lastInsertRowid as number;
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Failed to add semantic entity');
      return -1;
    }
  }

  addRelation(sourceId: number, targetId: number, relationType: string, weight = 1.0): void {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO semantic_relations (source_id, target_id, relation_type, weight)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(source_id, target_id, relation_type) DO UPDATE SET weight = excluded.weight
      `).run(sourceId, targetId, relationType, weight);
    } catch { /* silent */ }
  }

  async addFact(subject: string, relation: string, object: string, weight = 1.0): Promise<void> {
    const subjType = this.inferType(subject);
    const objType = this.inferType(object);

    const subjId = await this.addEntity(subject, subjType);
    const objId = await this.addEntity(object, objType);
    if (subjId > 0 && objId > 0) {
      this.addRelation(subjId, objId, relation, weight);
    }
  }

  getEntity(name: string): SemanticEntity | null {
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM semantic_entities WHERE name = ?').get(name) as Record<string, unknown> | undefined;
      if (!row) return null;
      return this.rowToEntity(row);
    } catch {
      return null;
    }
  }

  searchEntities(query: string, type?: string, limit = 10): SemanticEntity[] {
    try {
      const db = getDb();
      let sql = 'SELECT * FROM semantic_entities WHERE 1=1';
      const params: unknown[] = [];
      if (type) { sql += ' AND type = ?'; params.push(type); }
      sql += ' LIMIT ?'; params.push(limit);

      const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      return rows.map(r => this.rowToEntity(r));
    } catch {
      return [];
    }
  }

  async searchByVector(query: string, limit = 10): Promise<SemanticEntity[]> {
    try {
      const queryEmb = await this.embedder.embed(query);
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM semantic_entities WHERE embedding IS NOT NULL LIMIT 200'
      ).all() as Array<Record<string, unknown>>;

      const scored: Array<{ entity: SemanticEntity; score: number }> = [];
      for (const row of rows) {
        const entity = this.rowToEntity(row);
        if (!entity.embedding) continue;
        const sim = cosineSimilarity(queryEmb, entity.embedding);
        scored.push({ entity, score: sim });
      }

      return scored
        .filter(s => s.score > 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(s => s.entity);
    } catch {
      return [];
    }
  }

  getRelations(entityId: number): SemanticRelation[] {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT r.*, se.name as source_name, se2.name as target_name
        FROM semantic_relations r
        JOIN semantic_entities se ON se.id = r.source_id
        JOIN semantic_entities se2 ON se2.id = r.target_id
        WHERE r.source_id = ? OR r.target_id = ?
        ORDER BY r.weight DESC
      `).all(entityId, entityId) as Array<Record<string, unknown>>;

      return rows.map(r => ({
        id: r.id as number,
        sourceId: r.source_id as number,
        targetId: r.target_id as number,
        relationType: r.relation_type as string,
        weight: r.weight as number,
        sourceName: r.source_name as string,
        targetName: r.target_name as string,
      }));
    } catch {
      return [];
    }
  }

  async traverse(startEntity: string, maxDepth = 3): Promise<InferenceResult[]> {
    const entity = this.getEntity(startEntity);
    if (!entity) return [];

    const visited = new Set<number>();
    const results: InferenceResult[] = [];

    const dfs = (currentId: number, path: InferenceResult['path'], depth: number) => {
      if (depth > maxDepth || visited.has(currentId)) return;
      visited.add(currentId);

      const relations = this.getRelations(currentId);
      for (const rel of relations) {
        const isForward = rel.sourceId === currentId;
        const nextId = isForward ? rel.targetId : rel.sourceId;
        const nextEntity = this.getEntityById(nextId);
        if (!nextEntity) continue;

        const step: InferenceResult['path'][0] = {
          entity: nextEntity.name,
          relation: rel.relationType,
          direction: isForward ? 'forward' : 'reverse',
        };

        // Check if this path matches an inference rule
        for (const rule of INFERENCE_RULES) {
          if (isForward && rule.fromType === entity.type && rel.relationType === rule.relation && rule.toType === nextEntity.type) {
            const conclusion = rule.conclusion
              .replace('{source}', entity.name)
              .replace('{target}', nextEntity.name);
            results.push({ path: [...path, step], confidence: rule.defaultConfidence * rel.weight, conclusion });
          }
        }

        if (!visited.has(nextId)) {
          dfs(nextId, [...path, step], depth + 1);
        }
      }

      visited.delete(currentId);
    };

    dfs(entity.id, [{ entity: entity.name, relation: 'start', direction: 'forward' }], 0);
    return results;
  }

  async query(question: string): Promise<InferenceResult[]> {
    // Try direct entity lookup first
    const words = question.toLowerCase().split(/\s+/).filter(w => w.length > 3);

    for (const word of words) {
      const entity = this.getEntity(word);
      if (entity) {
        const results = await this.traverse(entity.name);
        if (results.length > 0) return results;
      }
    }

    // Try vector search for partial matches
    const vecResults = await this.searchByVector(question, 3);
    for (const vr of vecResults) {
      const results = await this.traverse(vr.name);
      if (results.length > 0) return results;
    }

    return [];
  }

  private getEntityById(id: number): SemanticEntity | null {
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM semantic_entities WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!row) return null;
      return this.rowToEntity(row);
    } catch {
      return null;
    }
  }

  private inferType(name: string): string {
    const n = name.toLowerCase();
    if (['tokyo', 'london', 'paris', 'new york', 'mumbai', 'shanghai', 'seoul', 'jakarta', 'istanbul'].includes(n)) return 'city';
    if (['japan', 'indonesia', 'california', 'iceland', 'chile', 'alaska', 'new zealand', 'philippines'].includes(n)) return 'region';
    if (n.includes('fault') || n.includes('trench') || n.includes('plate')) return 'fault_line';
    if (n.includes('risk') || n.includes('danger') || n.includes('zone')) return 'risk_level';
    if (n.includes('tropical') || n.includes('monsoon') || n.includes('arctic') || n.includes('desert')) return 'climate_zone';
    if (n.includes('seismic') || n.includes('tectonic') || n.includes('subduction')) return 'seismic_zone';
    if (n.includes('volcano') || n.includes('fuji') || n.includes('merapi')) return 'volcano';
    if (n.includes('earthquake') || n.includes('tsunami') || n.includes('storm')) return 'event';
    if (n.includes('api') || n.includes('endpoint') || n.includes('data') || n.includes('layer')) return 'data_source';
    if (n.includes('hazard') || n.includes('danger') || n.includes('warning')) return 'hazard_zone';
    return 'entity';
  }

  private rowToEntity(row: Record<string, unknown>): SemanticEntity {
    return {
      id: row.id as number,
      name: row.name as string,
      type: row.type as string,
      metadata: JSON.parse((row.metadata_json as string) || '{}'),
      embedding: row.embedding ? bufferToEmbedding(row.embedding as Buffer) : null,
    };
  }
}
