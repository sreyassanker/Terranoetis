import { getDb } from '../db/index';
import { logger } from '../observability/logger';

// ── Types ───────────────────────────────────────────────────────

export interface PerceptualEvent {
  id: string;
  timestamp: number;
  type: 'api_call' | 'user_query' | 'system_event' | 'error' | 'feedback' | 'data_update';
  source: string;
  data: string;
  importanceScore: number;
  metadata?: Record<string, unknown>;
}

export interface SensoryBufferOptions {
  maxEvents: number;
  windowHours: number;
  pruneIntervalMs: number;
  topFraction: number;
}

const DEFAULT_OPTIONS: SensoryBufferOptions = {
  maxEvents: 1000,
  windowHours: 24,
  pruneIntervalMs: 3600000,
  topFraction: 0.2,
};

// ── SensoryBuffer ───────────────────────────────────────────────

export class SensoryBuffer {
  private options: SensoryBufferOptions;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: Partial<SensoryBufferOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  init(): void {
    this.ensureTable();
    this.startAutoPrune();
    logger.info('SensoryBuffer initialized');
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS sensory_buffer (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        data TEXT NOT NULL,
        importance_score REAL NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_sensory_timestamp ON sensory_buffer(timestamp)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_sensory_importance ON sensory_buffer(importance_score DESC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_sensory_type ON sensory_buffer(type)`);
    } catch { /* tables exist */ }
  }

  async push(event: Omit<PerceptualEvent, 'id' | 'timestamp'> & { timestamp?: number }): Promise<string> {
    const id = `sev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ts = event.timestamp ?? Date.now();
    const importance = event.importanceScore ?? this.computeImportance(event);

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO sensory_buffer (id, timestamp, type, source, data, importance_score, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, ts, event.type, event.source, event.data.slice(0, 2000), importance,
        event.metadata ? JSON.stringify(event.metadata) : null);
    } catch { /* silent */ }

    const count = this.count();
    if (count > this.options.maxEvents) {
      await this.prune();
    }

    return id;
  }

  async pushMany(events: Array<Omit<PerceptualEvent, 'id' | 'timestamp'> & { timestamp?: number }>): Promise<string[]> {
    const ids: string[] = [];
    for (const ev of events) {
      ids.push(await this.push(ev));
    }
    return ids;
  }

  recent(limit = 50): PerceptualEvent[] {
    try {
      const db = getDb();
      const cutoff = Date.now() - this.options.windowHours * 3600000;
      const rows = db.prepare(
        'SELECT * FROM sensory_buffer WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?'
      ).all(cutoff, limit) as Array<Record<string, unknown>>;
      return rows.map(r => this.rowToEvent(r));
    } catch {
      return [];
    }
  }

  topByImportance(limit = 20): PerceptualEvent[] {
    try {
      const db = getDb();
      const cutoff = Date.now() - this.options.windowHours * 3600000;
      const rows = db.prepare(
        'SELECT * FROM sensory_buffer WHERE timestamp >= ? ORDER BY importance_score DESC LIMIT ?'
      ).all(cutoff, limit) as Array<Record<string, unknown>>;
      return rows.map(r => this.rowToEvent(r));
    } catch {
      return [];
    }
  }

  searchByType(type: PerceptualEvent['type'], limit = 50): PerceptualEvent[] {
    try {
      const db = getDb();
      const cutoff = Date.now() - this.options.windowHours * 3600000;
      const rows = db.prepare(
        'SELECT * FROM sensory_buffer WHERE type = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT ?'
      ).all(type, cutoff, limit) as Array<Record<string, unknown>>;
      return rows.map(r => this.rowToEvent(r));
    } catch {
      return [];
    }
  }

  async prune(): Promise<void> {
    try {
      const db = getDb();
      const cutoff = Date.now() - this.options.windowHours * 3600000;

      const total = db.prepare(
        'SELECT COUNT(*) as cnt FROM sensory_buffer WHERE timestamp >= ?'
      ).get(cutoff) as { cnt: number };

      if (total.cnt <= this.options.maxEvents) return;

      const keepCount = Math.ceil(total.cnt * this.options.topFraction);
      const deleteCount = total.cnt - keepCount;

      db.prepare(`
        DELETE FROM sensory_buffer WHERE id IN (
          SELECT id FROM sensory_buffer WHERE timestamp >= ?
          ORDER BY importance_score ASC LIMIT ?
        )
      `).run(cutoff, deleteCount);

      logger.info({ deleted: deleteCount, kept: keepCount }, 'SensoryBuffer pruned');
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'SensoryBuffer prune failed');
    }
  }

  clear(): void {
    try {
      const db = getDb();
      db.prepare('DELETE FROM sensory_buffer').run();
    } catch { /* silent */ }
  }

  count(): number {
    try {
      const db = getDb();
      const cutoff = Date.now() - this.options.windowHours * 3600000;
      const row = db.prepare('SELECT COUNT(*) as cnt FROM sensory_buffer WHERE timestamp >= ?').get(cutoff) as { cnt: number };
      return row.cnt;
    } catch {
      return 0;
    }
  }

  shutdown(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  private startAutoPrune(): void {
    this.pruneTimer = setInterval(() => {
      this.prune().catch(() => {});
    }, this.options.pruneIntervalMs);
  }

  private computeImportance(event: { type: string; source: string; data?: string }): number {
    let score = 0.5;

    const highImportanceTypes = new Set(['error', 'feedback', 'data_update']);
    const mediumImportanceTypes = new Set(['user_query']);

    if (highImportanceTypes.has(event.type)) score += 0.3;
    else if (mediumImportanceTypes.has(event.type)) score += 0.2;

    if (event.type === 'error') score += 0.2;
    if (event.source === 'user') score += 0.1;

    if (event.data) {
      const lower = event.data.toLowerCase();
      if (lower.includes('earthquake') || lower.includes('hazard') || lower.includes('tsunami')) score += 0.2;
      if (lower.includes('warning') || lower.includes('alert') || lower.includes('critical')) score += 0.15;
    }

    return Math.min(1, Math.round(score * 100) / 100);
  }

  private rowToEvent(row: Record<string, unknown>): PerceptualEvent {
    return {
      id: row.id as string,
      timestamp: row.timestamp as number,
      type: row.type as PerceptualEvent['type'],
      source: row.source as string,
      data: row.data as string,
      importanceScore: row.importance_score as number,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json as string) : undefined,
    };
  }
}

export const sensoryBuffer = new SensoryBuffer();
