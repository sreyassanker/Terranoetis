import { getDb } from '../db';
import type { CausalNode, CausalEdge, Discovery } from './types';

export class CausalKnowledgeGraph {
  private db: ReturnType<typeof getDb>;

  constructor() {
    this.db = getDb();
  }

  upsertNode(node: CausalNode): void {
    try {
      const metadata: Record<string, unknown> = { ...node.properties };
      if (node.lat != null) metadata._lat = node.lat;
      if (node.lon != null) metadata._lon = node.lon;
      const embeddingBlob = node.embedding ? Buffer.from(JSON.stringify(node.embedding)) : null;

      this.db.prepare(`
        INSERT INTO causal_nodes (name, type, prior, embedding, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          type = excluded.type,
          embedding = excluded.embedding,
          metadata_json = excluded.metadata_json
      `).run(
        node.name,
        node.type,
        0.5,
        embeddingBlob,
        JSON.stringify(metadata),
        new Date(node.createdAt).toISOString()
      );
    } catch (e) {
      console.error('[KG] upsertNode failed:', e);
    }
  }

  upsertEdge(edge: CausalEdge): void {
    try {
      const sourceRow = this.db.prepare('SELECT id FROM causal_nodes WHERE name = ?').get(edge.sourceId) as { id: number } | undefined;
      const targetRow = this.db.prepare('SELECT id FROM causal_nodes WHERE name = ?').get(edge.targetId) as { id: number } | undefined;
      if (!sourceRow || !targetRow) {
        console.warn('[KG] upsertEdge: source or target node not found');
        return;
      }
      // Average the relevant metrics into weight
      const weight = (edge.correlation + edge.causalStrength + edge.confidence) / 3;

      this.db.prepare(`
        INSERT INTO causal_edges (source_id, target_id, relation, weight, evidence_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id, target_id) DO UPDATE SET
          relation = excluded.relation,
          weight = (weight + excluded.weight) / 2,
          evidence_count = evidence_count + 1
      `).run(
        sourceRow.id,
        targetRow.id,
        edge.relation,
        Math.min(1.0, Math.max(0, weight)),
        edge.evidenceCount,
        new Date(edge.lastUpdated).toISOString()
      );
    } catch (e) {
      console.error('[KG] upsertEdge failed:', e);
    }
  }

  getOutgoingEdges(nodeName: string): CausalEdge[] {
    try {
      const rows = this.db.prepare(`
        SELECT e.id, e.relation, e.weight, e.evidence_count, e.created_at,
               s.name as source_name, t.name as target_name
        FROM causal_edges e
        JOIN causal_nodes s ON e.source_id = s.id
        JOIN causal_nodes t ON e.target_id = t.id
        WHERE s.name = ?
        ORDER BY e.weight DESC
      `).all(nodeName);
      return rows.map(r => this.rowToEdge(r as Record<string, unknown>));
    } catch (e) {
      console.error('[KG] getOutgoingEdges failed:', e);
      return [];
    }
  }

  getIncomingEdges(nodeName: string): CausalEdge[] {
    try {
      const rows = this.db.prepare(`
        SELECT e.id, e.relation, e.weight, e.evidence_count, e.created_at,
               s.name as source_name, t.name as target_name
        FROM causal_edges e
        JOIN causal_nodes s ON e.source_id = s.id
        JOIN causal_nodes t ON e.target_id = t.id
        WHERE t.name = ?
        ORDER BY e.weight DESC
      `).all(nodeName);
      return rows.map(r => this.rowToEdge(r as Record<string, unknown>));
    } catch (e) {
      console.error('[KG] getIncomingEdges failed:', e);
      return [];
    }
  }

  findCausalPath(sourceName: string, targetName: string, minConfidence: number = 0.5): CausalEdge[] | null {
    const visited = new Set<string>();
    const queue: Array<{ node: string; path: CausalEdge[] }> = [{ node: sourceName, path: [] }];

    while (queue.length > 0) {
      const { node, path } = queue.shift()!;
      if (node === targetName && path.length > 0) return path;
      if (visited.has(node)) continue;
      visited.add(node);

      const edges = this.getOutgoingEdges(node).filter(e => e.confidence >= minConfidence);
      for (const edge of edges) {
        queue.push({ node: edge.targetId, path: [...path, edge] });
      }
    }
    return null;
  }

  getPendingDiscoveries(): Discovery[] {
    try {
      const rows = this.db.prepare(`
        SELECT d.*, e.id as edge_id, e.relation, e.weight, e.evidence_count, e.created_at,
               s.name as source_name, t.name as target_name
        FROM discoveries d
        JOIN causal_edges e ON d.edge_rowid = e.id
        JOIN causal_nodes s ON e.source_id = s.id
        JOIN causal_nodes t ON e.target_id = t.id
        WHERE d.validation_status = 'pending'
        ORDER BY d.discovered_at DESC
      `).all();
      return rows.map(r => this.rowToDiscovery(r as Record<string, unknown>));
    } catch (e) {
      console.error('[KG] getPendingDiscoveries failed:', e);
      return [];
    }
  }

  private rowToEdge(row: Record<string, unknown>): CausalEdge {
    return {
      edgeId: String(row.id || row.edge_id),
      sourceId: row.source_name as string,
      targetId: row.target_name as string,
      relation: row.relation as CausalEdge['relation'],
      correlation: row.weight as number,
      causalStrength: row.weight as number,
      timeLagHours: 0,
      confidence: row.weight as number,
      evidenceCount: row.evidence_count as number,
      lastUpdated: new Date(row.created_at as string).getTime(),
      isSynthetic: false,
    };
  }

  private rowToDiscovery(row: Record<string, unknown>): Discovery {
    return {
      discoveryId: String(row.discovery_id),
      edge: this.rowToEdge(row),
      summary: row.summary as string,
      discoveredAt: new Date(row.discovered_at as string).getTime(),
      validatedBy: row.validated_by as string | null,
      validationStatus: row.validation_status as Discovery['validationStatus'],
      forkId: row.fork_id as string | undefined,
    };
  }
}
