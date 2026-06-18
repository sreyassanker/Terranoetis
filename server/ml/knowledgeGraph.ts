import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { EmbeddingEngine, cosineSimilarity, embeddingToBuffer, bufferToEmbedding } from '../embedding';

interface Entity {
  id?: number;
  name: string;
  type: string;
  embedding?: Float32Array;
  metadata?: Record<string, unknown>;
}

const SIMILARITY_THRESHOLD = 0.85;

export class KnowledgeGraph {
  private embeddingEngine: EmbeddingEngine | null = null;

  setEmbeddingEngine(ee: EmbeddingEngine): void {
    this.embeddingEngine = ee;
  }

  async ensureEntity(name: string, type: string, metadata?: Record<string, unknown>): Promise<number> {
    const existing = this.findEntityByName(name);
    if (existing) return existing.id!;

    if (this.embeddingEngine) {
      try {
        const embedding = await this.embeddingEngine.embed(name);
        const similar = this.findSimilarEntities(embedding, type);
        if (similar.length > 0 && similar[0].similarity >= SIMILARITY_THRESHOLD) {
          return similar[0].id;
        }
        const db = getDb();
        const result = db.prepare(`
          INSERT INTO knowledge_entities (name, type, embedding, metadata_json) VALUES (?, ?, ?, ?)
        `).run(name, type, embeddingToBuffer(embedding), metadata ? JSON.stringify(metadata) : null);
        return result.lastInsertRowid as number;
      } catch {
        // fall through to insert without embedding
      }
    }

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO knowledge_entities (name, type, metadata_json) VALUES (?, ?, ?)
    `).run(name, type, metadata ? JSON.stringify(metadata) : null);
    return result.lastInsertRowid as number;
  }

  addRelation(sourceName: string, targetName: string, relationType: string, weight = 1.0): void {
    const source = this.findEntityByName(sourceName);
    const target = this.findEntityByName(targetName);
    if (!source || !target) return;

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO knowledge_relations (source_id, target_id, relation_type, weight)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(source_id, target_id, relation_type) DO UPDATE SET weight = weight + excluded.weight
      `).run(source.id, target.id, relationType, weight);
    } catch (e) {
      logger.error({ err: e }, 'failed to add relation');
    }
  }

  findEntityByName(name: string): Entity | null {
    try {
      const db = getDb();
      const row = db.prepare('SELECT id, name, type, metadata_json FROM knowledge_entities WHERE name = ?').get(name) as
        { id: number; name: string; type: string; metadata_json: string | null } | undefined;
      if (!row) return null;
      return { id: row.id, name: row.name, type: row.type, metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined };
    } catch {
      return null;
    }
  }

  findSimilarEntities(embedding: Float32Array, type?: string, limit = 5): Array<{ id: number; name: string; similarity: number }> {
    try {
      const db = getDb();
      let sql = 'SELECT id, name, embedding FROM knowledge_entities WHERE embedding IS NOT NULL';
      const params: unknown[] = [];
      if (type) {
        sql += ' AND type = ?';
        params.push(type);
      }
      const rows = db.prepare(sql).all(...params) as Array<{ id: number; name: string; embedding: Buffer }>;
      const results = rows.map(r => ({
        id: r.id,
        name: r.name,
        similarity: cosineSimilarity(embedding, bufferToEmbedding(r.embedding)),
      }));
      results.sort((a, b) => b.similarity - a.similarity);
      return results.slice(0, limit);
    } catch {
      return [];
    }
  }

  getRelations(entityName: string): Array<{ source: string; target: string; relationType: string; weight: number }> {
    const entity = this.findEntityByName(entityName);
    if (!entity) return [];

    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT e1.name as source, e2.name as target, r.relation_type, r.weight
        FROM knowledge_relations r
        JOIN knowledge_entities e1 ON r.source_id = e1.id
        JOIN knowledge_entities e2 ON r.target_id = e2.id
        WHERE r.source_id = ? OR r.target_id = ?
        ORDER BY r.weight DESC
      `).all(entity.id, entity.id) as Array<{ source: string; target: string; relation_type: string; weight: number }>;
      return rows.map(r => ({ source: r.source, target: r.target, relationType: r.relation_type, weight: r.weight }));
    } catch {
      return [];
    }
  }

  async queryAsync(query: string, type?: string, limit = 5): Promise<Array<{ id: number; name: string; type: string; similarity: number; relations: string[] }>> {
    if (!this.embeddingEngine) return [];
    const embedding = await this.embeddingEngine.embed(query);
    const similar = this.findSimilarEntities(embedding, type, limit);
    return similar.map(s => {
      const rels = this.getRelations(s.name);
      return {
        id: s.id,
        name: s.name,
        type: type || 'entity',
        similarity: s.similarity,
        relations: rels.map(r => r.relationType),
      };
    });
  }

  getStats(): { entityCount: number; relationCount: number } {
    try {
      const db = getDb();
      const entityCount = (db.prepare('SELECT COUNT(*) as c FROM knowledge_entities').get() as { c: number }).c;
      const relationCount = (db.prepare('SELECT COUNT(*) as c FROM knowledge_relations').get() as { c: number }).c;
      return { entityCount, relationCount };
    } catch {
      return { entityCount: 0, relationCount: 0 };
    }
  }
}

export const knowledgeGraph = new KnowledgeGraph();
