import { EnhancedCache } from './costOptimizer';
import { getDb } from './db/index';
import { evaluateResponse, storeEval, getRecentEvals, getAvgScoresByIntent } from './ml/evals';
import { promptLab } from './ml/promptLab';
import { logger } from './observability/logger';
import { knowledgeGraph } from './ml/knowledgeGraph';

// ── Types ───────────────────────────────────────────────────────────

export interface FeedbackEntry {
  id: string;
  userId: string;
  query: string;
  response: string;
  vote: 'up' | 'down';
  intentType: string;
  modelTier: string;
  timestamp: number;
}

export interface Analytics {
  totalFeedback: number;
  satisfactionRate: number;
  totalUpvotes: number;
  totalDownvotes: number;
  recentFeedback: FeedbackEntry[];
  byIntent: Record<string, { up: number; down: number; rate: number }>;
  byModel: Record<string, { up: number; down: number; rate: number }>;
  cost: {
    totalCost: number;
    totalQueries: number;
    avgCostPerQuery: number;
    byModel: Record<string, { queries: number; cost: number }>;
  };
  cache: {
    hitRate: number;
    size: number;
  };
  ml: {
    avgOverallScore: number;
    recentEvalCount: number;
    byIntentScores: Record<string, { count: number; avgOverall: number }>;
    promptVariants: number;
    kgEntityCount: number;
    kgRelationCount: number;
    predictionPatterns: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════
// FeedbackManager
// ═══════════════════════════════════════════════════════════════════════

export class FeedbackManager {
  private readonly maxEntries = 5000;

  record(entry: Omit<FeedbackEntry, 'id' | 'timestamp'>): FeedbackEntry {
    const full: FeedbackEntry = {
      ...entry,
      id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO feedback (feedback_id, user_id, query, response, vote, intent_type, model_tier)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(full.id, full.userId, full.query, full.response, full.vote, full.intentType, full.modelTier);

      const count = db.prepare('SELECT COUNT(*) as cnt FROM feedback').get() as { cnt: number };
      if (count.cnt > this.maxEntries) {
        db.prepare(`
          DELETE FROM feedback WHERE id NOT IN (
            SELECT id FROM feedback ORDER BY created_at DESC LIMIT ?
          )
        `).run(this.maxEntries);
      }
    } catch {
      /* persist failed */
    }

    return full;
  }

  getStats(): { total: number; up: number; down: number; rate: number } {
    try {
      const db = getDb();
      const upRow = db.prepare("SELECT COUNT(*) as cnt FROM feedback WHERE vote = 'up'").get() as { cnt: number };
      const downRow = db.prepare("SELECT COUNT(*) as cnt FROM feedback WHERE vote = 'down'").get() as { cnt: number };
      const up = upRow.cnt;
      const down = downRow.cnt;
      const total = up + down;
      return { total, up, down, rate: total > 0 ? Math.round(up / total * 10000) / 100 : 0 };
    } catch {
      return { total: 0, up: 0, down: 0, rate: 0 };
    }
  }

  getByIntent(): Record<string, { up: number; down: number; rate: number }> {
    try {
      const db = getDb();
      const rows = db.prepare(
        "SELECT intent_type, vote, COUNT(*) as cnt FROM feedback GROUP BY intent_type, vote"
      ).all() as Array<{ intent_type: string; vote: string; cnt: number }>;

      const map: Record<string, { up: number; down: number }> = {};
      for (const row of rows) {
        if (!map[row.intent_type]) map[row.intent_type] = { up: 0, down: 0 };
        if (row.vote === 'up') map[row.intent_type].up = row.cnt;
        else map[row.intent_type].down = row.cnt;
      }

      const result: Record<string, { up: number; down: number; rate: number }> = {};
      for (const [k, v] of Object.entries(map)) {
        result[k] = { ...v, rate: (v.up + v.down) > 0 ? Math.round(v.up / (v.up + v.down) * 10000) / 100 : 0 };
      }
      return result;
    } catch {
      return {};
    }
  }

  getByModel(): Record<string, { up: number; down: number; rate: number }> {
    try {
      const db = getDb();
      const rows = db.prepare(
        "SELECT model_tier, vote, COUNT(*) as cnt FROM feedback GROUP BY model_tier, vote"
      ).all() as Array<{ model_tier: string; vote: string; cnt: number }>;

      const map: Record<string, { up: number; down: number }> = {};
      for (const row of rows) {
        if (!map[row.model_tier]) map[row.model_tier] = { up: 0, down: 0 };
        if (row.vote === 'up') map[row.model_tier].up = row.cnt;
        else map[row.model_tier].down = row.cnt;
      }

      const result: Record<string, { up: number; down: number; rate: number }> = {};
      for (const [k, v] of Object.entries(map)) {
        result[k] = { ...v, rate: (v.up + v.down) > 0 ? Math.round(v.up / (v.up + v.down) * 10000) / 100 : 0 };
      }
      return result;
    } catch {
      return {};
    }
  }

  recent(limit = 20): FeedbackEntry[] {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?'
      ).all(limit) as Array<Record<string, unknown>>;
      return rows.map(r => ({
        id: r.feedback_id as string,
        userId: r.user_id as string,
        query: r.query as string,
        response: r.response as string,
        vote: r.vote as 'up' | 'down',
        intentType: r.intent_type as string,
        modelTier: r.model_tier as string,
        timestamp: new Date(r.created_at as string).getTime(),
      }));
    } catch {
      return [];
    }
  }

  all(): FeedbackEntry[] {
    return this.recent(10000);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SelfImprover — auto-tunes parameters based on feedback + ML evals
// ═══════════════════════════════════════════════════════════════════════

export interface TuningParams {
  cacheThreshold: number;
  modelFlashThreshold: number;
  modelProThreshold: number;
  lastTuned: number;
  tuningCount: number;
  minEvalScoreForCache: number;
}

export class SelfImprover {
  private params: TuningParams;
  private feedbackManager: FeedbackManager;
  private cache: EnhancedCache | null = null;

  constructor(feedbackManager: FeedbackManager) {
    this.feedbackManager = feedbackManager;
    this.params = this.load();
    this.tune();
  }

  setCache(cache: EnhancedCache): void {
    this.cache = cache;
  }

  getParams(): TuningParams {
    return { ...this.params };
  }

  tune(): void {
    const stats = this.feedbackManager.getStats();
    const byIntent = this.feedbackManager.getByIntent();
    const byModel = this.feedbackManager.getByModel();
    let changed = false;

    if (stats.total >= 5) {
      const newThreshold = stats.rate > 80 ? 0.5 : stats.rate > 60 ? 0.6 : 0.7;
      if (Math.abs(newThreshold - this.params.cacheThreshold) > 0.05) {
        this.params.cacheThreshold = newThreshold;
        changed = true;
        if (this.cache) this.cache.setThreshold(newThreshold);
      }
    }

    if (byModel.flash && byModel.flash.up + byModel.flash.down >= 5) {
      if (byModel.flash.rate < 50) {
        this.params.modelFlashThreshold = Math.min(0.9, this.params.modelFlashThreshold + 0.1);
        changed = true;
      } else {
        this.params.modelFlashThreshold = Math.max(0.5, this.params.modelFlashThreshold - 0.05);
        changed = true;
      }
    }

    if (byIntent.deep_analysis && byIntent.deep_analysis.up + byIntent.deep_analysis.down >= 3) {
      if (byIntent.deep_analysis.rate < 50) {
        this.params.modelProThreshold = Math.min(0.9, this.params.modelProThreshold + 0.1);
        changed = true;
      }
    }

    // ML-driven tuning: if eval scores are consistently low, tighten cache threshold
    const evalScores = getRecentEvals(50);
    if (evalScores.length >= 10) {
      const avgOverall = evalScores.reduce((s, e) => s + e.overall, 0) / evalScores.length;
      const newMin = avgOverall > 0.7 ? 0.5 : avgOverall > 0.5 ? 0.6 : 0.7;
      if (Math.abs(newMin - this.params.minEvalScoreForCache) > 0.05) {
        this.params.minEvalScoreForCache = newMin;
        changed = true;
      }
    }

    if (changed) {
      this.params.lastTuned = Date.now();
      this.params.tuningCount++;
      this.save();
    }
  }

  async evaluateInteraction(query: string, response: string, context: { intentType?: string; location?: string; modelTier?: string }, episodeId: string | null): Promise<void> {
    if (!response) return;
    try {
      const scores = await evaluateResponse(query, response, context);
      storeEval(episodeId, query, scores, context);
      promptLab.recordResult(context.intentType || 'unknown', 'default', scores.overall);
      this.tune();
    } catch (e) {
      logger.error({ err: e }, 'evaluation failed');
    }
  }

  private load(): TuningParams {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT key, value FROM config WHERE key IN (?, ?, ?, ?, ?, ?)').all(
        'cacheThreshold', 'modelFlashThreshold', 'modelProThreshold', 'lastTuned', 'tuningCount', 'minEvalScoreForCache',
      ) as Array<{ key: string; value: string }>;

      const map: Record<string, string> = {};
      for (const row of rows) {
        map[row.key] = row.value;
      }

      if (map.cacheThreshold) {
        return {
          cacheThreshold: parseFloat(map.cacheThreshold),
          modelFlashThreshold: parseFloat(map.modelFlashThreshold || '0.7'),
          modelProThreshold: parseFloat(map.modelProThreshold || '0.7'),
          lastTuned: parseInt(map.lastTuned || String(Date.now())),
          tuningCount: parseInt(map.tuningCount || '0'),
          minEvalScoreForCache: parseFloat(map.minEvalScoreForCache || '0.5'),
        };
      }
    } catch {
      /* use defaults */
    }
    return { cacheThreshold: 0.6, modelFlashThreshold: 0.7, modelProThreshold: 0.7, lastTuned: Date.now(), tuningCount: 0, minEvalScoreForCache: 0.5 };
  }

  private save(): void {
    try {
      const db = getDb();
      const upsert = db.prepare(
        'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      );
      upsert.run('cacheThreshold', String(this.params.cacheThreshold));
      upsert.run('modelFlashThreshold', String(this.params.modelFlashThreshold));
      upsert.run('modelProThreshold', String(this.params.modelProThreshold));
      upsert.run('lastTuned', String(this.params.lastTuned));
      upsert.run('tuningCount', String(this.params.tuningCount));
      upsert.run('minEvalScoreForCache', String(this.params.minEvalScoreForCache));
    } catch {
      /* skip */
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Analytics aggregator
// ═══════════════════════════════════════════════════════════════════════

export function buildAnalytics(
  feedbackManager: FeedbackManager,
  costStats: { totalCost: number; totalQueries: number; byTier: Record<string, { count: number; cost: number; inputTokens: number; outputTokens: number }> },
  cacheStats: { size: number; hits: number; misses: number; hitRate: number },
): Analytics {
  const fbStats = feedbackManager.getStats();
  const byIntent = feedbackManager.getByIntent();
  const byModel = feedbackManager.getByModel();

  const costByModel: Record<string, { queries: number; cost: number }> = {};
  for (const [tier, data] of Object.entries(costStats.byTier)) {
    costByModel[tier] = { queries: data.count, cost: Math.round(data.cost * 100000) / 100000 };
  }

  const recentEvals = getRecentEvals(10);
  const byIntentScores = getAvgScoresByIntent();
  const promptVariants = promptLab.getVariants().length;

  let kgStats = { entityCount: 0, relationCount: 0 };
  let predictionPatterns = 0;
  try {
    kgStats = knowledgeGraph.getStats();
  } catch { /* not loaded */ }
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as c FROM historical_patterns').get() as { c: number };
    predictionPatterns = row.c;
  } catch { /* not available */ }

  return {
    totalFeedback: fbStats.total,
    satisfactionRate: fbStats.rate,
    totalUpvotes: fbStats.up,
    totalDownvotes: fbStats.down,
    recentFeedback: feedbackManager.recent(10),
    byIntent,
    byModel,
    cost: {
      totalCost: Math.round(costStats.totalCost * 100000) / 100000,
      totalQueries: costStats.totalQueries,
      avgCostPerQuery: costStats.totalQueries > 0
        ? Math.round(costStats.totalCost / costStats.totalQueries * 100000000) / 100000000
        : 0,
      byModel: costByModel,
    },
    cache: {
      hitRate: cacheStats.hitRate,
      size: cacheStats.size,
    },
    ml: {
      avgOverallScore: recentEvals.length > 0
        ? Math.round(recentEvals.reduce((s, e) => s + e.overall, 0) / recentEvals.length * 100) / 100
        : 0,
      recentEvalCount: recentEvals.length,
      byIntentScores,
      promptVariants,
      kgEntityCount: kgStats.entityCount,
      kgRelationCount: kgStats.relationCount,
      predictionPatterns,
    },
  };
}
