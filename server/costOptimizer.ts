import NodeCache from 'node-cache';
import { logger } from './observability/logger';
import { getDb } from './db/index';

// ═══════════════════════════════════════════════════════════════════════
// PHASE 9: Cost Optimization — tiered model routing, caching, tracking
// ═══════════════════════════════════════════════════════════════════════

export type ModelTier = 'local' | 'flash' | 'pro' | 'pro-exp';

export interface ModelConfig {
  name: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
  description: string;
}

const TIERS: Record<ModelTier, ModelConfig> = {
  local:   { name: 'local',           inputPricePer1M: 0,    outputPricePer1M: 0,    description: 'Local keyword/rule matching — free' },
  flash:   { name: 'gemini-2.0-flash-lite', inputPricePer1M: 0.075, outputPricePer1M: 0.30, description: 'Gemini 2.0 Flash Lite — cheapest' },
  pro:     { name: 'gemini-2.0-flash', inputPricePer1M: 0.075, outputPricePer1M: 0.30, description: 'Gemini 2.0 Flash — fast & cheap' },
  'pro-exp': { name: 'gemini-2.0-pro-exp', inputPricePer1M: 2.50, outputPricePer1M: 10.00, description: 'Gemini 2.0 Pro — experimental best quality' },
};

// ── Helpers ──────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function countOutputTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ═══════════════════════════════════════════════════════════════════════
// ModelRouter — selects optimal model tier based on query complexity
// ═══════════════════════════════════════════════════════════════════════

export class ModelRouter {
  static route(
    intentType: string,
    confidence: number,
    queryLength: number,
    needsVision: boolean,
    needsCode: boolean,
  ): ModelTier {
    if (intentType === 'unknown' && confidence < 0.4 && queryLength < 20) return 'local';
    if (['toggle_layer', 'fly_to', 'quick_scan'].includes(intentType)) return 'flash';
    if (intentType === 'weather_check' && queryLength < 60) return 'flash';
    if (needsCode || intentType === 'compute') return 'pro';
    if (intentType === 'deep_analysis' && queryLength > 120) return 'pro';
    if (needsVision) return 'pro';
    return 'flash';
  }

  static getConfig(tier: ModelTier): ModelConfig {
    return TIERS[tier];
  }

  static listTiers(): Record<ModelTier, ModelConfig> {
    return { ...TIERS };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CostTracker — tracks token usage and estimates API costs via SQLite
// ═══════════════════════════════════════════════════════════════════════

export interface CostEntry {
  timestamp: number;
  tier: ModelTier;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  queryPreview: string;
  cached: boolean;
}

export interface CostStats {
  totalCost: number;
  totalQueries: number;
  todayCost: number;
  todayQueries: number;
  cachedHits: number;
  byTier: Record<string, { count: number; cost: number; inputTokens: number; outputTokens: number }>;
  recentEntries: CostEntry[];
}

export class CostTracker {
  record(
    tier: ModelTier,
    inputText: string,
    outputText: string,
    cached: boolean,
  ): CostEntry {
    const inputTokens = estimateTokens(inputText);
    const outputTokens = countOutputTokens(outputText);
    const config = TIERS[tier];
    const estimatedCost = cached ? 0 : (inputTokens / 1_000_000 * config.inputPricePer1M) +
      (outputTokens / 1_000_000 * config.outputPricePer1M);

    const entry: CostEntry = {
      timestamp: Date.now(),
      tier,
      inputTokens,
      outputTokens,
      estimatedCost: Math.round(estimatedCost * 1000000) / 1000000,
      queryPreview: inputText.slice(0, 80),
      cached,
    };

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO episodes (user_id, episode_id, query, response, intent_type, tokens_used, cost, cached, model_tier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        '_cost_tracker',
        `cost_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        inputText.slice(0, 200),
        outputText.slice(0, 200),
        'cost_entry',
        inputTokens + outputTokens,
        estimatedCost,
        cached ? 1 : 0,
        tier,
      );
    } catch (e) {
      logger.warn({ err: e }, 'Cost entry persist failed');
    }

    return entry;
  }

  getStats(): CostStats {
    try {
      const db = getDb();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const totalRow = db.prepare(`
        SELECT COUNT(*) as total, COALESCE(SUM(cost), 0) as total_cost,
               COALESCE(SUM(CASE WHEN cached = 1 THEN 1 ELSE 0 END), 0) as cached_hits
        FROM episodes WHERE user_id = '_cost_tracker'
      `).get() as { total: number; total_cost: number; cached_hits: number };

      const todayRow = db.prepare(`
        SELECT COUNT(*) as total, COALESCE(SUM(cost), 0) as total_cost
        FROM episodes WHERE user_id = '_cost_tracker' AND created_at >= ?
      `).get(todayStart.toISOString()) as { total: number; total_cost: number };

      const byTierRows = db.prepare(`
        SELECT model_tier as tier, COUNT(*) as count, COALESCE(SUM(cost), 0) as cost,
               COALESCE(SUM(tokens_used), 0) as total_tokens
        FROM episodes WHERE user_id = '_cost_tracker'
        GROUP BY model_tier
      `).all() as Array<{ tier: string; count: number; cost: number; total_tokens: number }>;

      const recentRows = db.prepare(`
        SELECT created_at, model_tier, tokens_used, cost, query, cached
        FROM episodes WHERE user_id = '_cost_tracker'
        ORDER BY created_at DESC LIMIT 20
      `).all() as Array<{ created_at: string; model_tier: string; tokens_used: number; cost: number; query: string; cached: number }>;

      const byTier: Record<string, { count: number; cost: number; inputTokens: number; outputTokens: number }> = {};
      for (const row of byTierRows) {
        byTier[row.tier] = {
          count: row.count,
          cost: Math.round(row.cost * 1000000) / 1000000,
          inputTokens: Math.round(row.total_tokens * 0.7),
          outputTokens: Math.round(row.total_tokens * 0.3),
        };
      }

      return {
        totalCost: Math.round(totalRow.total_cost * 1000000) / 1000000,
        totalQueries: totalRow.total,
        todayCost: Math.round(todayRow.total_cost * 1000000) / 1000000,
        todayQueries: todayRow.total,
        cachedHits: totalRow.cached_hits,
        byTier,
        recentEntries: recentRows.map(r => ({
          timestamp: new Date(r.created_at).getTime(),
          tier: r.model_tier as ModelTier,
          inputTokens: Math.round(r.tokens_used * 0.7),
          outputTokens: Math.round(r.tokens_used * 0.3),
          estimatedCost: Math.round(r.cost * 1000000) / 1000000,
          queryPreview: r.query.slice(0, 80),
          cached: r.cached === 1,
        })),
      };
    } catch (e) {
      logger.warn({ err: e }, 'Cost stats query failed');
      return { totalCost: 0, totalQueries: 0, todayCost: 0, todayQueries: 0, cachedHits: 0, byTier: {}, recentEntries: [] };
    }
  }

  clear(): void {
    try {
      const db = getDb();
      db.prepare("DELETE FROM episodes WHERE user_id = '_cost_tracker'").run();
    } catch (e) {
      logger.warn({ err: e }, 'Cost clear failed');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Enhanced SemanticCache — stats-aware, configurable threshold
// ═══════════════════════════════════════════════════════════════════════

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
  oldestEntry: number;
  newestEntry: number;
}

export class EnhancedCache {
  private cache: NodeCache;
  private hits = 0;
  private misses = 0;
  private timestamps = new Map<string, number>();

  private threshold: number;

  constructor(ttlSeconds = 3600, threshold = 0.6) {
    this.threshold = threshold;
    this.cache = new NodeCache({ stdTTL: ttlSeconds, checkperiod: Math.min(ttlSeconds / 10, 300) });
  }

  get(query: string): string | undefined {
    const normalized = this.normalize(query);
    const keys = this.cache.keys();
    let bestMatch: string | undefined;
    let bestScore = 0;

    for (const key of keys) {
      const score = this.similarity(normalized, key);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = key;
      }
    }

    if (bestMatch && bestScore > this.threshold) {
      this.hits++;
      return this.cache.get<string>(bestMatch);
    }

    this.misses++;
    return undefined;
  }

  set(query: string, response: string): void {
    const key = this.normalize(query);
    this.cache.set(key, response);
    this.timestamps.set(key, Date.now());
  }

  clear(): void {
    this.cache.flushAll();
    this.timestamps.clear();
    this.hits = 0;
    this.misses = 0;
  }

  size(): number { return this.cache.keys().length; }

  getStats(): CacheStats {
    const keys = this.cache.keys();
    const now = Date.now();
    let oldest = now;
    let newest = 0;
    for (const k of keys) {
      const ts = this.timestamps.get(k) || 0;
      if (ts < oldest) oldest = ts;
      if (ts > newest) newest = ts;
    }
    const total = this.hits + this.misses;
    return {
      size: keys.length,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Math.round(this.hits / total * 10000) / 100 : 0,
      oldestEntry: oldest,
      newestEntry: newest || Date.now(),
    };
  }

  setThreshold(t: number): void { this.threshold = t; }

  private normalize(text: string): string {
    return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  private similarity(a: string, b: string): number {
    const termsA = a.split(' ');
    const termsB = new Set(b.split(' '));
    if (termsA.length === 0 || termsB.size === 0) return 0;
    let matches = 0;
    for (const t of termsA) {
      if (t.length > 2 && termsB.has(t)) matches++;
    }
    return matches / Math.max(termsA.length, termsB.size);
  }
}
