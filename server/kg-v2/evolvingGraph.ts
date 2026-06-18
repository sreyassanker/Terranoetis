import { getDb } from '../db/index';
import { logger } from '../observability/logger';

export interface EvolutionConfig {
  decayTimeConstantHours: number;
  pruneConfidenceThreshold: number;
  boostNewEvidence: number;
  maxHistoryDays: number;
}

export interface EvolutionLogEntry {
  timestamp: string;
  operation: 'decay' | 'boost' | 'prune' | 'edge_added' | 'edge_removed' | 'entity_added';
  detail: string;
  affectedEdgeCount: number;
  affectedEntityCount: number;
}

export interface GraphState {
  totalEntities: number;
  totalEdges: number;
  averageWeight: number;
  staleEdgeCount: number;
  recentEdgeCount: number;
}

const DEFAULT_CONFIG: EvolutionConfig = {
  decayTimeConstantHours: 72,
  pruneConfidenceThreshold: 0.15,
  boostNewEvidence: 0.2,
  maxHistoryDays: 365,
};

export class EvolvingGraph {
  private config: EvolutionConfig;
  private evolutionLog: EvolutionLogEntry[] = [];
  private maxLogEntries = 1000;
  private lastDecayTimestamp: number = Date.now();

  constructor(cfg?: Partial<EvolutionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...cfg };
  }

  init(): void {
    this.lastDecayTimestamp = Date.now();
    try {
      const db = getDb();
      const existing = db.prepare("SELECT value FROM meta WHERE key = 'evolving_graph_last_decay'").get() as { value: string } | undefined;
      if (existing) {
        this.lastDecayTimestamp = parseInt(existing.value) || Date.now();
      }
      logger.info('EvolvingGraph initialized');
    } catch {
      logger.warn('EvolvingGraph init: meta table unavailable');
    }
  }

  tick(): EvolutionLogEntry[] {
    const entries: EvolutionLogEntry[] = [];

    const decayEntry = this.applyDecay();
    if (decayEntry) entries.push(decayEntry);

    const pruneEntry = this.applyPruning();
    if (pruneEntry) entries.push(pruneEntry);

    if (entries.length > 0) {
      this.persistDecayTimestamp();
      this.logEntries(entries);
    }

    return entries;
  }

  addEdgeWithBoost(sourceName: string, targetName: string, relationType: string, evidenceStrength = 1.0): void {
    try {
      const db = getDb();
      const source = db.prepare('SELECT id FROM knowledge_entities WHERE name = ?').get(sourceName) as { id: number } | undefined;
      const target = db.prepare('SELECT id FROM knowledge_entities WHERE name = ?').get(targetName) as { id: number } | undefined;
      if (!source || !target) return;

      const boost = this.config.boostNewEvidence * evidenceStrength;
      db.prepare(`
        INSERT INTO knowledge_relations (source_id, target_id, relation_type, weight, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(source_id, target_id, relation_type) DO UPDATE SET
          weight = MIN(1.0, weight + ?)
      `).run(source.id, target.id, relationType, boost, boost);

      this.logEntries([{
        timestamp: new Date().toISOString(),
        operation: 'boost',
        detail: `Edge boosted: ${sourceName} → ${targetName} (${relationType}, +${boost.toFixed(2)})`,
        affectedEdgeCount: 1,
        affectedEntityCount: 2,
      }]);
    } catch (e) {
      logger.error({ err: e }, 'EvolvingGraph addEdgeWithBoost failed');
    }
  }

  getGraphState(): GraphState {
    try {
      const db = getDb();
      const entityCount = (db.prepare('SELECT COUNT(*) as c FROM knowledge_entities').get() as { c: number }).c;
      const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM knowledge_relations').get() as { c: number }).c;
      const avgWeight = (db.prepare('SELECT COALESCE(AVG(weight), 0) as a FROM knowledge_relations').get() as { a: number }).a;

      const decayThreshold = Math.max(0.05, this.config.pruneConfidenceThreshold * 1.5);
      const staleCount = (db.prepare('SELECT COUNT(*) as c FROM knowledge_relations WHERE weight < ?').get(decayThreshold) as { c: number }).c;

      const recentThreshold = 0.7;
      const recentCount = (db.prepare('SELECT COUNT(*) as c FROM knowledge_relations WHERE weight > ?').get(recentThreshold) as { c: number }).c;

      return {
        totalEntities: entityCount,
        totalEdges: edgeCount,
        averageWeight: avgWeight,
        staleEdgeCount: staleCount,
        recentEdgeCount: recentCount,
      };
    } catch {
      return { totalEntities: 0, totalEdges: 0, averageWeight: 0, staleEdgeCount: 0, recentEdgeCount: 0 };
    }
  }

  getEvolutionLog(limit = 50): EvolutionLogEntry[] {
    return this.evolutionLog.slice(-limit);
  }

  getConfig(): EvolutionConfig {
    return { ...this.config };
  }

  updateConfig(cfg: Partial<EvolutionConfig>): void {
    this.config = { ...this.config, ...cfg };
    logger.info({ config: this.config }, 'EvolvingGraph config updated');
  }

  private applyDecay(): EvolutionLogEntry | null {
    const now = Date.now();
    const elapsedHours = (now - this.lastDecayTimestamp) / (1000 * 60 * 60);
    if (elapsedHours < 0.5) return null;

    const decayFactor = Math.exp(-elapsedHours / this.config.decayTimeConstantHours);

    try {
      const db = getDb();
      const result = db.prepare('UPDATE knowledge_relations SET weight = weight * ? WHERE weight > 0').run(decayFactor);
      this.lastDecayTimestamp = now;

      if (result.changes > 0) {
        return {
          timestamp: new Date().toISOString(),
          operation: 'decay',
          detail: `Applied decay factor ${decayFactor.toFixed(4)} to ${result.changes} edges (τ=${this.config.decayTimeConstantHours}h)`,
          affectedEdgeCount: result.changes,
          affectedEntityCount: 0,
        };
      }
    } catch (e) {
      logger.error({ err: e }, 'EvolvingGraph decay failed');
    }

    return null;
  }

  private applyPruning(): EvolutionLogEntry | null {
    try {
      const db = getDb();
      const result = db.prepare('DELETE FROM knowledge_relations WHERE weight < ?').run(this.config.pruneConfidenceThreshold);

      if (result.changes > 0) {
        return {
          timestamp: new Date().toISOString(),
          operation: 'prune',
          detail: `Pruned ${result.changes} edges below threshold ${this.config.pruneConfidenceThreshold}`,
          affectedEdgeCount: result.changes,
          affectedEntityCount: 0,
        };
      }
    } catch (e) {
      logger.error({ err: e }, 'EvolvingGraph pruning failed');
    }

    return null;
  }

  private persistDecayTimestamp(): void {
    try {
      const db = getDb();
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('evolving_graph_last_decay', ?)").run(String(this.lastDecayTimestamp));
    } catch { /* best-effort */ }
  }

  private logEntries(entries: EvolutionLogEntry[]): void {
    this.evolutionLog.push(...entries);
    if (this.evolutionLog.length > this.maxLogEntries) {
      this.evolutionLog = this.evolutionLog.slice(-this.maxLogEntries);
    }
  }
}

export const evolvingGraph = new EvolvingGraph();
