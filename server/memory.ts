import NodeCache from 'node-cache';
import { getDb } from './db/index';
import { logger } from './observability/logger';
import { EmbeddingEngine, cosineSimilarity, embeddingToBuffer, bufferToEmbedding } from './embedding';
import { omninet } from './ai-router/omninet';

// ═══════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════

export interface UserProfile {
  userId: string;
  favoriteLayers: string[];
  frequentLocations: Array<{ lat: number; lon: number; label: string; count: number }>;
  recentQueries: string[];
  preferredModel: 'gemini' | 'anthropic' | 'local';
  alertThresholds: Record<string, number>;
  layerToggleCount: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export interface Episode {
  id: string;
  userId: string;
  query: string;
  response: string;
  intentType: string;
  location?: { lat: number; lon: number; label?: string };
  layersToggled: string[];
  timestamp: number;
}

export interface Fact {
  id: number;
  userId: string;
  factText: string;
  sourceEpisodeId: string | null;
  confidence: number;
  createdAt: string;
}


export interface ProceduralPattern {
  id: number;
  userId: string;
  intentType: string;
  pattern: Record<string, unknown>;
  successCount: number;
  lastUsedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 4.1: UserProfileManager (unchanged)
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_PROFILE: Omit<UserProfile, 'userId' | 'createdAt' | 'updatedAt'> = {
  favoriteLayers: ['earthquakes'],
  frequentLocations: [],
  recentQueries: [],
  preferredModel: 'gemini',
  alertThresholds: { earthquake: 6, storm: 80, fire: 200 },
  layerToggleCount: {},
};

export class UserProfileManager {
  private cache = new NodeCache({ stdTTL: 3600 });

  get(userId: string): UserProfile {
    const cached = this.cache.get<UserProfile>(userId);
    if (cached) return cached;

    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined;

      if (row) {
        const profile: UserProfile = {
          userId: row.user_id as string,
          favoriteLayers: JSON.parse(row.favorite_layers as string || '[]'),
          frequentLocations: JSON.parse(row.frequent_locations as string || '[]'),
          recentQueries: JSON.parse(row.recent_queries as string || '[]'),
          preferredModel: (row.model_preference as UserProfile['preferredModel']) || 'gemini',
          alertThresholds: JSON.parse(row.alert_thresholds as string || '{}'),
          layerToggleCount: JSON.parse(row.layer_toggle_count as string || '{}'),
          createdAt: new Date(row.created_at as string).getTime(),
          updatedAt: new Date(row.updated_at as string).getTime(),
        };
        this.cache.set(userId, profile);
        return profile;
      }
    } catch (e) {
      logger.warn({ err: e }, 'Profile DB load failed, using default');
    }

    const profile: UserProfile = {
      userId,
      ...DEFAULT_PROFILE,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.save(profile);
    return profile;
  }

  save(profile: UserProfile): void {
    profile.updatedAt = Date.now();
    this.cache.set(profile.userId, profile);
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO profiles (user_id, favorite_layers, frequent_locations, recent_queries, model_preference, alert_thresholds, layer_toggle_count, json_data, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          favorite_layers = excluded.favorite_layers,
          frequent_locations = excluded.frequent_locations,
          recent_queries = excluded.recent_queries,
          model_preference = excluded.model_preference,
          alert_thresholds = excluded.alert_thresholds,
          layer_toggle_count = excluded.layer_toggle_count,
          updated_at = excluded.updated_at
      `).run(
        profile.userId,
        JSON.stringify(profile.favoriteLayers),
        JSON.stringify(profile.frequentLocations),
        JSON.stringify(profile.recentQueries),
        profile.preferredModel,
        JSON.stringify(profile.alertThresholds),
        JSON.stringify(profile.layerToggleCount),
        '{}',
      );
    } catch (e) {
      logger.warn({ err: e }, 'Profile DB persist failed');
    }
  }

  update(userId: string, updater: (profile: UserProfile) => void): UserProfile {
    const profile = this.get(userId);
    updater(profile);
    this.save(profile);
    return profile;
  }

  recordQuery(userId: string, query: string): void {
    this.update(userId, (p) => {
      p.recentQueries = [query, ...p.recentQueries.filter(q => q !== query)].slice(0, 20);
    });
  }

  recordLayerToggle(userId: string, layerId: string): void {
    this.update(userId, (p) => {
      p.layerToggleCount[layerId] = (p.layerToggleCount[layerId] || 0) + 1;
      p.favoriteLayers = Object.entries(p.layerToggleCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id);
    });
  }

  recordLocation(userId: string, lat: number, lon: number, label?: string): void {
    this.update(userId, (p) => {
      const existing = p.frequentLocations.find(
        l => Math.abs(l.lat - lat) < 1 && Math.abs(l.lon - lon) < 1
      );
      if (existing) {
        existing.count++;
        existing.label = label || existing.label;
      } else {
        p.frequentLocations.push({ lat, lon, label: label || `${lat.toFixed(2)}, ${lon.toFixed(2)}`, count: 1 });
      }
      p.frequentLocations.sort((a, b) => b.count - a.count);
      if (p.frequentLocations.length > 10) p.frequentLocations = p.frequentLocations.slice(0, 10);
    });
  }

  setPreferredModel(userId: string, model: UserProfile['preferredModel']): void {
    this.update(userId, (p) => { p.preferredModel = model; });
  }

  delete(userId: string): void {
    this.cache.del(userId);
    try {
      const db = getDb();
      db.prepare('DELETE FROM profiles WHERE user_id = ?').run(userId);
    } catch (e) {
      logger.warn({ err: e }, 'Profile DB delete failed');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 4.2: EpisodicMemory (unchanged)
// ═══════════════════════════════════════════════════════════════════════

export class EpisodicMemory {
  private userId: string;
  private maxEpisodes = 200;

  constructor(userId: string) {
    this.userId = userId;
  }

  add(episode: Omit<Episode, 'id' | 'timestamp'>): void {
    try {
      const db = getDb();
      const epId = `ep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      db.prepare(`
        INSERT INTO episodes (user_id, episode_id, query, response, intent_type, location_lat, location_lon, location_label, layers_toggled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        episode.userId,
        epId,
        episode.query,
        episode.response,
        episode.intentType,
        episode.location?.lat ?? null,
        episode.location?.lon ?? null,
        episode.location?.label ?? null,
        JSON.stringify(episode.layersToggled || []),
      );

      const count = db.prepare('SELECT COUNT(*) as cnt FROM episodes WHERE user_id = ?').get(episode.userId) as { cnt: number };
      if (count.cnt > this.maxEpisodes) {
        db.prepare(`
          DELETE FROM episodes WHERE user_id = ? AND id NOT IN (
            SELECT id FROM episodes WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
          )
        `).run(episode.userId, episode.userId, this.maxEpisodes);
      }
    } catch (e) {
      logger.warn({ err: e }, 'Episode pruning failed');
    }
  }

  search(query: string, limit = 5): Episode[] {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM episodes WHERE user_id = ? ORDER BY created_at DESC LIMIT 200'
      ).all(this.userId) as Array<Record<string, unknown>>;

      const lower = query.toLowerCase();
      const terms = lower.split(/\s+/).filter(t => t.length > 2);

      const scored = rows.map(row => {
        const text = `${row.query} ${row.response}`.toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (text.includes(term)) score += term.length;
        }
        const ts = new Date(row.created_at as string).getTime();
        score += (ts - Date.now() + 86400000 * 7) / 86400000;
        return { row, score };
      });

      return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(s => this.rowToEpisode(s.row));
    } catch (e) {
      logger.warn({ err: e }, 'Episode search failed');
      return [];
    }
  }

  findSimilar(query: string): Episode | null {
    const results = this.search(query, 1);
    return results[0] || null;
  }

  recent(count = 10): Episode[] {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM episodes WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
      ).all(this.userId, count) as Array<Record<string, unknown>>;
      return rows.map(r => this.rowToEpisode(r));
    } catch (e) {
      logger.warn({ err: e }, 'Recent episodes query failed');
      return [];
    }
  }

  count(): number {
    try {
      const db = getDb();
      const row = db.prepare('SELECT COUNT(*) as cnt FROM episodes WHERE user_id = ?').get(this.userId) as { cnt: number };
      return row.cnt;
    } catch (e) {
      logger.warn({ err: e }, 'Episode count failed');
      return 0;
    }
  }

  private rowToEpisode(row: Record<string, unknown>): Episode {
    return {
      id: row.episode_id as string,
      userId: row.user_id as string,
      query: row.query as string,
      response: row.response as string,
      intentType: row.intent_type as string,
      location: row.location_lat != null
        ? { lat: row.location_lat as number, lon: row.location_lon as number, label: (row.location_label as string) || undefined }
        : undefined,
      layersToggled: JSON.parse(row.layers_toggled as string || '[]'),
      timestamp: new Date(row.created_at as string).getTime(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 4.4: SemanticCache with real embeddings
// ═══════════════════════════════════════════════════════════════════════

export class SemanticCache {
  private nodeCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
  private readonly CACHE_TTL_SECONDS = 3600;
  private readonly SIMILARITY_THRESHOLD = 0.7;
  private embedder: EmbeddingEngine;

  constructor(embedder: EmbeddingEngine) {
    this.embedder = embedder;
  }

  async get(query: string): Promise<string | undefined> {
    const normalized = this.normalize(query);

    const ncResult = this.nodeCache.get<string>(normalized);
    if (ncResult !== undefined) return ncResult;

    try {
      const queryEmb = await this.embedder.embed(normalized);

      const db = getDb();
      const rows = db.prepare(
        `SELECT v.content, v.embedding, c.response_json
         FROM vec_store v
         JOIN cache_entries c ON c.query_hash = v.entity_id
         WHERE v.entity_type = 'cache' AND v.embedding IS NOT NULL
         ORDER BY v.created_at DESC
         LIMIT 100`
      ).all() as Array<Record<string, unknown>>;

      for (const row of rows) {
        const embBuf = row.embedding as Buffer;
        if (!embBuf) continue;
        const storedEmb = bufferToEmbedding(embBuf);
        const sim = cosineSimilarity(queryEmb, storedEmb);
        if (sim > this.SIMILARITY_THRESHOLD) {
          const response = row.response_json as string;
          this.nodeCache.set(normalized, response);
          try {
            const db2 = getDb();
            db2.prepare('UPDATE cache_entries SET hit_count = hit_count + 1 WHERE query_hash = ?').run(row.content as string);
          } catch (e) { logger.warn({ err: e }, 'Semantic cache hit count update failed'); }
          return response;
        }
      }
    } catch (e) {
      logger.warn({ err: e }, 'Semantic cache lookup failed');
    }

    return undefined;
  }

  async set(query: string, response: string): Promise<void> {
    const normalized = this.normalize(query);
    this.nodeCache.set(normalized, response);

    try {
      const db = getDb();
      const expiresAt = new Date(Date.now() + this.CACHE_TTL_SECONDS * 1000).toISOString();
      db.prepare(`
        INSERT INTO cache_entries (query_hash, query, response_json, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(query_hash) DO UPDATE SET
          response_json = excluded.response_json,
          hit_count = hit_count + 1,
          expires_at = excluded.expires_at
      `).run(normalized, normalized, response, expiresAt);

      const emb = await this.embedder.embed(normalized + ' ' + response.slice(0, 200));
      db.prepare(`
        INSERT INTO vec_store (user_id, entity_type, entity_id, content, embedding)
        VALUES ('', 'cache', ?, ?, ?)
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
          content = excluded.content,
          embedding = excluded.embedding
        -- sqlite doesn't support ON CONFLICT on non-unique — skip silently
      `).run(normalized, normalized, embeddingToBuffer(emb));
    } catch (e) {
      logger.warn({ err: e }, 'Semantic cache set failed');
    }
  }

  clear(): void {
    this.nodeCache.flushAll();
    try {
      const db = getDb();
      db.prepare('DELETE FROM cache_entries').run();
      db.prepare("DELETE FROM vec_store WHERE entity_type = 'cache'").run();
    } catch (e) {
      logger.warn({ err: e }, 'Semantic cache clear failed');
    }
  }

  size(): number {
    try {
      const db = getDb();
      const row = db.prepare('SELECT COUNT(*) as cnt FROM cache_entries').get() as { cnt: number };
      return row.cnt;
    } catch (e) {
      logger.warn({ err: e }, 'Semantic cache size query failed');
      return 0;
    }
  }

  private normalize(text: string): string {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 4.5: FactManager — extract, store, and retrieve facts
// ═══════════════════════════════════════════════════════════════════════

export class FactManager {
  private embedder: EmbeddingEngine;
  private cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

  constructor(embedder: EmbeddingEngine) {
    this.embedder = embedder;
  }

  async extractFacts(text: string, _apiKey: string): Promise<string[]> {
    const cacheKey = `extract:${text.slice(0, 100)}`;
    const cached = this.cache.get<string[]>(cacheKey);
    if (cached) return cached;

    try {
      const prompt = `Extract 3-5 objective, factual statements from the following text. Each fact must be a single sentence that is objectively verifiable. Return ONLY a JSON array of strings. No markdown, no explanation.

Text: "${text.replace(/"/g, '\\"')}"`;

      const raw = await omninet.generateText(prompt, { temperature: 0.1, maxTokens: 512 });
      if (!raw) return [];

      const arrMatch = raw.match(/\[[\s\S]*?\]/);
      if (!arrMatch) return [];
      const facts: string[] = JSON.parse(arrMatch[0]);
      const valid = facts.filter(f => typeof f === 'string' && f.length > 5).slice(0, 5);
      if (valid.length > 0) {
        this.cache.set(cacheKey, valid, 300);
      }
      return valid;
    } catch (e) {
      logger.warn({ err: e }, 'Fact extraction LLM call failed');
      return [];
    }
  }

  async storeFact(userId: string, factText: string, sourceEpisodeId: string | null): Promise<void> {
    try {
      const db = getDb();
      const emb = await this.embedder.embed(factText);
      const embBuf = embeddingToBuffer(emb);

      db.prepare(`
        INSERT INTO facts (user_id, fact_text, embedding, source_episode_id, confidence)
        VALUES (?, ?, ?, ?, 1.0)
      `).run(userId, factText, embBuf, sourceEpisodeId);

      const rowId = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
      db.prepare(`
        INSERT INTO vec_store (user_id, entity_type, entity_id, content, embedding)
        VALUES (?, 'fact', ?, ?, ?)
      `).run(userId, String(rowId), factText, embBuf);
    } catch (e) {
      logger.warn({ err: e }, 'Fact store failed');
    }
  }

  async searchFacts(query: string, userId: string, limit = 5): Promise<Fact[]> {
    try {
      const queryEmb = await this.embedder.embed(query);
      const db = getDb();

      const rows = db.prepare(
        'SELECT f.* FROM facts f WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT 200'
      ).all(userId) as Array<Record<string, unknown>>;

      const scored: Array<{ fact: Fact; score: number }> = [];
      for (const row of rows) {
        const embBuf = row.embedding as Buffer | null;
        if (!embBuf) continue;
        const storedEmb = bufferToEmbedding(embBuf);
        const sim = cosineSimilarity(queryEmb, storedEmb);
        const daysOld = (Date.now() - new Date(row.created_at as string).getTime()) / 86400000;
        const timeWeight = Math.exp(-daysOld / 30);
        scored.push({
          fact: {
            id: row.id as number,
            userId: row.user_id as string,
            factText: row.fact_text as string,
            sourceEpisodeId: row.source_episode_id as string | null,
            confidence: (row.confidence as number) * timeWeight,
            createdAt: row.created_at as string,
          },
          score: sim * timeWeight,
        });
      }

      return scored
        .filter(s => s.score > 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(s => s.fact);
    } catch (e) {
      logger.warn({ err: e }, 'Fact search failed');
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 4.6: ProceduralMemory — successful tool call patterns
// ═══════════════════════════════════════════════════════════════════════

export class ProceduralMemory {
  private cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

  recordPattern(userId: string, intentType: string, pattern: Record<string, unknown>): void {
    try {
      const db = getDb();
      const existing = db.prepare(
        'SELECT id, pattern_json, success_count FROM procedural_patterns WHERE user_id = ? AND intent_type = ? ORDER BY last_used_at DESC LIMIT 1'
      ).get(userId, intentType) as { id: number; pattern_json: string; success_count: number } | undefined;

      if (existing) {
        db.prepare(`
          UPDATE procedural_patterns SET success_count = success_count + 1, last_used_at = datetime('now')
          WHERE id = ?
        `).run(existing.id);
      } else {
        db.prepare(`
          INSERT INTO procedural_patterns (user_id, intent_type, pattern_json)
          VALUES (?, ?, ?)
        `).run(userId, intentType, JSON.stringify(pattern));
      }
      this.cache.del(`patterns:${userId}:${intentType}`);
    } catch (e) {
      logger.warn({ err: e }, 'Procedural pattern store failed');
    }
  }

  getPatterns(userId: string, intentType: string): ProceduralPattern[] {
    const cacheKey = `patterns:${userId}:${intentType}`;
    const cached = this.cache.get<ProceduralPattern[]>(cacheKey);
    if (cached) return cached;

    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM procedural_patterns WHERE user_id = ? AND intent_type = ? ORDER BY success_count DESC, last_used_at DESC LIMIT 5'
      ).all(userId, intentType) as Array<Record<string, unknown>>;

      const patterns = rows.map(r => ({
        id: r.id as number,
        userId: r.user_id as string,
        intentType: r.intent_type as string,
        pattern: JSON.parse(r.pattern_json as string) as Record<string, unknown>,
        successCount: r.success_count as number,
        lastUsedAt: r.last_used_at as string,
      }));
      this.cache.set(cacheKey, patterns, 600);
      return patterns;
    } catch (e) {
      logger.warn({ err: e }, 'Pattern query failed');
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MemoryManager — top-level facade with XML context builder
// ═══════════════════════════════════════════════════════════════════════

export class MemoryManager {
  profiles: UserProfileManager;
  semanticCache: SemanticCache;
  factManager: FactManager;
  proceduralMemory: ProceduralMemory;
  private memories = new Map<string, EpisodicMemory>();
  private embedder: EmbeddingEngine;

  constructor(embedder: EmbeddingEngine) {
    this.embedder = embedder;
    this.profiles = new UserProfileManager();
    this.semanticCache = new SemanticCache(embedder);
    this.factManager = new FactManager(embedder);
    this.proceduralMemory = new ProceduralMemory();
  }

  getEpisodic(userId: string): EpisodicMemory {
    let mem = this.memories.get(userId);
    if (!mem) {
      mem = new EpisodicMemory(userId);
      this.memories.set(userId, mem);
    }
    return mem;
  }

  async buildContext(
    userId: string,
    currentQuery: string,
    recentMessages: Array<{ role: string; content: string }>,
    _apiKey?: string,
  ): Promise<string> {
    const profile = this.profiles.get(userId);
    const episodic = this.getEpisodic(userId);
    const recentEps = episodic.recent(5);
    const similarPast = episodic.findSimilar(currentQuery);

    let facts: Fact[] = [];
    try {
      facts = await this.factManager.searchFacts(currentQuery, userId, 5);
    } catch (e) { logger.warn({ err: e }, 'Fact search in context build failed'); }

    const parts: string[] = ['<context>'];

    if (profile.favoriteLayers.length > 0 || profile.frequentLocations.length > 0) {
      parts.push('  <profile>');
      if (profile.favoriteLayers.length > 0) {
        parts.push(`    <favoriteLayers>${profile.favoriteLayers.join(', ')}</favoriteLayers>`);
      }
      if (profile.frequentLocations.length > 0) {
        const top = profile.frequentLocations.slice(0, 3);
        parts.push(`    <frequentLocations>${top.map(l => `${l.label} (${l.count}x)`).join(', ')}</frequentLocations>`);
      }
      parts.push(`    <preferredModel>${profile.preferredModel}</preferredModel>`);
      parts.push('  </profile>');
    }

    if (facts.length > 0) {
      parts.push('  <facts>');
      for (const f of facts) {
        parts.push(`    <fact confidence="${f.confidence.toFixed(2)}">${this.escapeXml(f.factText)}</fact>`);
      }
      parts.push('  </facts>');
    }

    if (recentEps.length > 0) {
      parts.push('  <episodes>');
      for (const e of recentEps.slice(0, 5)) {
        parts.push(`    <episode id="${e.id}" timestamp="${new Date(e.timestamp).toISOString()}">`);
        parts.push(`      <query>${this.escapeXml(e.query)}</query>`);
        parts.push(`      <response>${this.escapeXml(e.response.slice(0, 200))}</response>`);
        parts.push(`      <intent>${e.intentType}</intent>`);
        parts.push('    </episode>');
      }
      parts.push('  </episodes>');
    }

    if (similarPast) {
      parts.push('  <similar>');
      parts.push(`    <query>${this.escapeXml(similarPast.query)}</query>`);
      parts.push(`    <response>${this.escapeXml(similarPast.response.slice(0, 300))}</response>`);
      parts.push('  </similar>');
    }

    const recent = recentMessages.slice(-6);
    if (recent.length > 1) {
      parts.push('  <conversation>');
      for (const msg of recent.slice(0, -1)) {
        const role = msg.role === 'user' ? 'user' : 'assistant';
        parts.push(`    <message role="${role}">${this.escapeXml(msg.content.slice(0, 200))}</message>`);
      }
      parts.push('  </conversation>');
    }

    parts.push('</context>');

    const procedural = this.proceduralMemory.getPatterns(userId, '');
    if (procedural.length > 0) {
      const patternsXml = procedural.slice(0, 3).map(p =>
        `<pattern intent="${p.intentType}" successCount="${p.successCount}">${this.escapeXml(JSON.stringify(p.pattern))}</pattern>`
      ).join('\n');
      parts.splice(parts.length - 1, 0, `  <procedural>\n${patternsXml}\n  </procedural>`);
    }

    return parts.join('\n');
  }

  async recordInteraction(
    userId: string,
    query: string,
    response: string,
    intentType: string,
    apiKey: string,
    location?: { lat: number; lon: number; label?: string },
    layersToggled?: string[],
  ): Promise<void> {
    this.profiles.recordQuery(userId, query);
    this.getEpisodic(userId).add({ userId, query, response, intentType, location, layersToggled: layersToggled || [] });
    if (location) this.profiles.recordLocation(userId, location.lat, location.lon, location.label);
    await this.semanticCache.set(query, response);

    if (apiKey) {
      const facts = await this.factManager.extractFacts(query + ' ' + response, apiKey);
      const epId = `ep_${Date.now()}`;
      for (const fact of facts) {
        await this.factManager.storeFact(userId, fact, epId);
      }

      this.proceduralMemory.recordPattern(userId, intentType, {
        query: query.slice(0, 100),
        response: response.slice(0, 100),
        intentType,
      });
    }
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async buildWorkingMemoryContext(userId: string, currentQuery: string, recentMessages: Array<{ role: string; content: string }>): Promise<string> {
    try {
      return await this.buildContext(userId, currentQuery, recentMessages);
    } catch (e) {
      logger.warn({ err: e }, 'Working memory context build failed');
      return '';
    }
  }
}
