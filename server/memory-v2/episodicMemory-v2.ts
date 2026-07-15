import { getDb } from '../db/index';
import { EmbeddingEngine, cosineSimilarity, embeddingToBuffer, bufferToEmbedding } from '../embedding';
import { logger } from '../observability/logger';

// ── Types ───────────────────────────────────────────────────────

export interface EpisodeV2 {
  id: string;
  userId: string;
  query: string;
  response: string;
  intentType: string;
  tags: string[];
  location?: { lat: number; lon: number; label?: string };
  layersToggled: string[];
  emotionalValence: number;
  outcome: 'success' | 'partial' | 'failure' | 'unknown';
  tokensUsed: number;
  latencyMs: number;
  modelTier: string;
  embedding: Float32Array | null;
  timestamp: number;
  consolidated: boolean;
}

export interface EpisodeSearchOptions {
  vectorWeight?: number;
  timeDecayDays?: number;
  userRelevanceWeight?: number;
  limit?: number;
  minScore?: number;
}

const DEFAULT_SEARCH_OPTIONS: EpisodeSearchOptions = {
  vectorWeight: 0.5,
  timeDecayDays: 30,
  userRelevanceWeight: 0.2,
  limit: 10,
  minScore: 0.2,
};

// ── Auto-tagging ────────────────────────────────────────────────

const LOCATION_KEYWORDS: Array<{ pattern: RegExp; label: string; coords?: [number, number] }> = [
  { pattern: /\b(tokyo|japan)\b/i, label: 'japan', coords: [35.68, 139.65] },
  { pattern: /\b(california|san francisco|los angeles)\b/i, label: 'california' },
  { pattern: /\b(indonesia|jakarta)\b/i, label: 'indonesia' },
  { pattern: /\b(pacific|ring of fire)\b/i, label: 'pacific_rim' },
  { pattern: /\b(atlantic|hurricane)\b/i, label: 'atlantic_basin' },
  { pattern: /\b(europe|mediterranean)\b/i, label: 'europe_med' },
];

const INTENT_TAGS: Record<string, string[]> = {
  weather_check: ['weather', 'meteorology', 'forecast'],
  earthquake_check: ['seismic', 'geohazard', 'tectonic'],
  deep_analysis: ['research', 'analysis', 'investigation'],
  quick_scan: ['monitoring', 'surveillance', 'hazard_scan'],
  compute: ['computation', 'statistics', 'ml'],
  fly_to: ['navigation', 'exploration'],
  toggle_layer: ['visualization', 'data_layer'],
};

function autoTag(episode: { query: string; response: string; intentType: string }): string[] {
  const tags = new Set<string>();
  tags.add(episode.intentType);

  const intentTags = INTENT_TAGS[episode.intentType];
  if (intentTags) intentTags.forEach(t => tags.add(t));

  for (const loc of LOCATION_KEYWORDS) {
    if (loc.pattern.test(episode.query) || loc.pattern.test(episode.response)) {
      tags.add(loc.label);
    }
  }

  const text = `${episode.query} ${episode.response}`.toLowerCase();
  if (text.includes('earthquake') || text.includes('magnitude')) tags.add('earthquake');
  if (text.includes('tsunami')) tags.add('tsunami');
  if (text.includes('volcano') || text.includes('eruption')) tags.add('volcano');
  if (text.includes('hurricane') || text.includes('typhoon') || text.includes('cyclone')) tags.add('storm');
  if (text.includes('wildfire') || text.includes('fire')) tags.add('wildfire');
  if (text.includes('flood')) tags.add('flood');
  if (text.includes('air quality') || text.includes('pollution')) tags.add('air_quality');
  if (text.includes('satellite') || text.includes('orbit')) tags.add('space');
  if (text.includes('flight') || text.includes('aircraft')) tags.add('aviation');

  return Array.from(tags).slice(0, 10);
}

// ── EpisodicMemoryV2 ────────────────────────────────────────────

export class EpisodicMemoryV2 {
  private embedder: EmbeddingEngine;
  private consolidationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(embedder: EmbeddingEngine) {
    this.embedder = embedder;
  }

  init(): void {
    this.ensureTable();
    this.startConsolidation();
    logger.info('EpisodicMemoryV2 initialized');
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS episodic_v2 (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        query TEXT NOT NULL,
        response TEXT NOT NULL DEFAULT '',
        intent_type TEXT NOT NULL DEFAULT 'unknown',
        tags_json TEXT NOT NULL DEFAULT '[]',
        location_lat REAL,
        location_lon REAL,
        location_label TEXT,
        layers_toggled TEXT NOT NULL DEFAULT '[]',
        emotional_valence REAL NOT NULL DEFAULT 0,
        outcome TEXT NOT NULL DEFAULT 'unknown',
        tokens_used INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        model_tier TEXT NOT NULL DEFAULT 'flash',
        embedding BLOB,
        consolidated INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_episodic_v2_user ON episodic_v2(user_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_episodic_v2_intent ON episodic_v2(intent_type)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_episodic_v2_created ON episodic_v2(created_at DESC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_episodic_v2_outcome ON episodic_v2(outcome)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_episodic_v2_consolidated ON episodic_v2(consolidated)`);
    } catch (e) { logger.warn({ err: (e as Error).message }, 'EpisodicMemory tables may already exist'); }
  }

  async add(episode: Omit<EpisodeV2, 'id' | 'timestamp' | 'tags' | 'consolidated' | 'embedding'>): Promise<string> {
    const id = `ep2_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tags = autoTag({ query: episode.query, response: episode.response, intentType: episode.intentType });

    let emb: Float32Array | null = null;
    try {
      emb = await this.embedder.embed(`${episode.query} ${episode.response.slice(0, 500)}`);
    } catch (e) { logger.debug({ err: (e as Error).message }, 'Episode embedding optional (non-critical)'); }

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO episodic_v2 (id, user_id, query, response, intent_type, tags_json, location_lat, location_lon, location_label,
          layers_toggled, emotional_valence, outcome, tokens_used, latency_ms, model_tier, embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, episode.userId ?? '', episode.query, episode.response, episode.intentType,
        JSON.stringify(tags),
        episode.location?.lat ?? null, episode.location?.lon ?? null, episode.location?.label ?? null,
        JSON.stringify(episode.layersToggled ?? []),
        episode.emotionalValence ?? 0,
        episode.outcome ?? 'unknown',
        episode.tokensUsed ?? 0, episode.latencyMs ?? 0, episode.modelTier ?? 'flash',
        emb ? embeddingToBuffer(emb) : null,
      );
    } catch (e) { logger.error({ err: (e as Error).message }, 'Failed in episodic memory operation'); }

    return id;
  }

  async search(
    query: string,
    userId?: string,
    options?: EpisodeSearchOptions,
  ): Promise<EpisodeV2[]> {
    const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };

    try {
      const queryEmb = await this.embedder.embed(query);
      const db = getDb();

      let sql = 'SELECT * FROM episodic_v2 WHERE 1=1';
      const params: unknown[] = [];
      if (userId) { sql += ' AND user_id = ?'; params.push(userId); }
      sql += ' ORDER BY created_at DESC LIMIT 200';

      const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

      const now = Date.now();
      const scored: Array<{ ep: EpisodeV2; score: number }> = [];

      for (const row of rows) {
        const ep = this.rowToEpisode(row);
        let score = 0;

        // Vector similarity
        if (queryEmb && ep.embedding) {
          const sim = cosineSimilarity(queryEmb, ep.embedding);
          score += sim * (opts.vectorWeight ?? 0.5);
        }

        // Time decay
        const daysOld = (now - ep.timestamp) / 86400000;
        const timeWeight = Math.exp(-daysOld / (opts.timeDecayDays ?? 30));
        score += timeWeight * (opts.userRelevanceWeight ?? 0.2);

        // Tag overlap
        const queryLower = query.toLowerCase();
        const tagOverlap = ep.tags.filter(t => queryLower.includes(t)).length / Math.max(ep.tags.length, 1);
        score += tagOverlap * 0.15;

        // Outcome bonus
        if (ep.outcome === 'success') score += 0.1;
        if (ep.outcome === 'failure') score -= 0.05;

        scored.push({ ep, score });
      }

      return scored
        .filter(s => s.score >= (opts.minScore ?? 0.2))
        .sort((a, b) => b.score - a.score)
        .slice(0, opts.limit ?? 10)
        .map(s => s.ep);
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Failed to search episodic memory');
      return [];
    }
  }

  async findSimilar(query: string, userId?: string): Promise<EpisodeV2 | null> {
    const results = await this.search(query, userId, { limit: 1 });
    return results[0] || null;
  }

  recent(userId: string, count = 10): EpisodeV2[] {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM episodic_v2 WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
      ).all(userId, count) as Array<Record<string, unknown>>;
      return rows.map(r => this.rowToEpisode(r));
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Failed to get recent episodes');
      return [];
    }
  }

  count(userId?: string): number {
    try {
      const db = getDb();
      if (userId) {
        const row = db.prepare('SELECT COUNT(*) as cnt FROM episodic_v2 WHERE user_id = ?').get(userId) as { cnt: number };
        return row.cnt;
      }
      const row = db.prepare('SELECT COUNT(*) as cnt FROM episodic_v2').get() as { cnt: number };
      return row.cnt;
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Failed to count episodes');
      return 0;
    }
  }

  // ── Consolidation ─────────────────────────────────────────────

  private startConsolidation(): void {
    this.consolidationTimer = setInterval(() => {
      this.consolidate().catch(() => {});
    }, 6 * 3600000);
  }

  async consolidate(limit = 50): Promise<string[]> {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM episodic_v2 WHERE consolidated = 0 AND outcome = 'success'
        ORDER BY emotional_valence DESC, created_at DESC LIMIT ?
      `).all(limit) as Array<Record<string, unknown>>;

      if (rows.length === 0) return [];

      const facts: string[] = [];
      for (const row of rows) {
        const ep = this.rowToEpisode(row);
        const fact = this.extractKeyFact(ep);
        if (fact) facts.push(fact);

        db.prepare('UPDATE episodic_v2 SET consolidated = 1 WHERE id = ?').run(ep.id);
      }

      logger.info({ consolidated: rows.length, facts: facts.length }, 'Episodic memory consolidated');
      return facts;
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Consolidation failed');
      return [];
    }
  }

  private extractKeyFact(episode: EpisodeV2): string | null {
    if (!episode.query) return null;
    const q = episode.query.toLowerCase();

    if (q.includes('earthquake') || q.includes('magnitude')) {
      const match = episode.query.match(/\b(M\d+(\.\d+)?|magnitude\s+\d+\.?\d*)\b/i);
      if (match) return `${episode.location?.label || 'Region'} experienced ${match[1]} seismic event`;
    }
    if (q.includes('weather') || q.includes('temperature')) {
      const match = episode.response.match(/(-?\d+\.?\d*)\s*°?C/i);
      if (match && episode.location) {
        return `${episode.location.label} temperature: ${match[1]}°C`;
      }
    }
    if (episode.response.length > 20) {
      return episode.response.slice(0, 120).replace(/[\n\r]+/g, ' ').trim();
    }

    return null;
  }

  updateValence(episodeId: string, valence: number): void {
    try {
      const db = getDb();
      db.prepare('UPDATE episodic_v2 SET emotional_valence = ? WHERE id = ?').run(valence, episodeId);
    } catch (e) { logger.error({ err: (e as Error).message }, 'Failed in episodic memory operation'); }
  }

  updateOutcome(episodeId: string, outcome: EpisodeV2['outcome']): void {
    try {
      const db = getDb();
      db.prepare('UPDATE episodic_v2 SET outcome = ? WHERE id = ?').run(outcome, episodeId);
    } catch (e) { logger.error({ err: (e as Error).message }, 'Failed in episodic memory operation'); }
  }

  shutdown(): void {
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = null;
    }
  }

  private rowToEpisode(row: Record<string, unknown>): EpisodeV2 {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      query: row.query as string,
      response: row.response as string,
      intentType: row.intent_type as string,
      tags: JSON.parse(row.tags_json as string || '[]'),
      location: row.location_lat != null
        ? { lat: row.location_lat as number, lon: row.location_lon as number, label: (row.location_label as string) || undefined }
        : undefined,
      layersToggled: JSON.parse(row.layers_toggled as string || '[]'),
      emotionalValence: row.emotional_valence as number || 0,
      outcome: (row.outcome as EpisodeV2['outcome']) || 'unknown',
      tokensUsed: row.tokens_used as number || 0,
      latencyMs: row.latency_ms as number || 0,
      modelTier: row.model_tier as string || 'flash',
      embedding: row.embedding ? bufferToEmbedding(row.embedding as Buffer) : null,
      timestamp: new Date(row.created_at as string).getTime(),
      consolidated: (row.consolidated as number) === 1,
    };
  }
}
