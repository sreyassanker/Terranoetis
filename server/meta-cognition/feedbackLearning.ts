import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { FeedbackManager } from '../selfImprover';

// ── Types ───────────────────────────────────────────────────────

export interface RewardModel {
  intentType: string;
  weights: {
    relevance: number;
    factualAccuracy: number;
    helpfulness: number;
    conciseness: number;
  };
  updatedAt: number;
}

export interface StrategyCombination {
  id: string;
  promptVariant: string;
  modelTier: string;
  toolSet: string[];
  reward: number;
  trials: number;
  lastTried: number;
}

// ── FeedbackLearning ────────────────────────────────────────────

export class FeedbackLearning {
  private rewardModels: Map<string, RewardModel> = new Map();
  private strategies: Map<string, StrategyCombination> = new Map();
  private explorationRate = 0.1;
  private totalFeedback = 0;

  constructor(private feedbackManager: FeedbackManager) {}

  init(): void {
    this.loadRewardModels();
    this.loadStrategies();
    logger.info('FeedbackLearning initialized');
  }

  /** Update reward model weights from a vote */
  learnFromVote(query: string, response: string, vote: 'up' | 'down', intentType: string, modelTier: string): void {
    this.totalFeedback++;

    // Update reward model for this intent
    let model = this.rewardModels.get(intentType);
    if (!model) {
      model = {
        intentType,
        weights: { relevance: 1, factualAccuracy: 1, helpfulness: 1, conciseness: 1 },
        updatedAt: Date.now(),
      };
    }

    // Simple update: downvote reduces all weights slightly; upvote increases
    const delta = vote === 'up' ? 0.01 : -0.02;
    for (const key of Object.keys(model.weights) as Array<keyof typeof model.weights>) {
      model.weights[key] = Math.max(0.1, Math.min(2, model.weights[key] + delta));
    }
    model.updatedAt = Date.now();
    this.rewardModels.set(intentType, model);
    this.saveRewardModel(model);

    // Update strategy combination
    const strategyKey = this.strategyKey(intentType, modelTier);
    let strategy = this.strategies.get(strategyKey);
    if (!strategy) {
      strategy = {
        id: strategyKey,
        promptVariant: 'default',
        modelTier,
        toolSet: [],
        reward: 0,
        trials: 0,
        lastTried: Date.now(),
      };
    }

    strategy.trials++;
    strategy.reward = (strategy.reward * (strategy.trials - 1) + (vote === 'up' ? 1 : -1)) / strategy.trials;
    strategy.lastTried = Date.now();
    this.strategies.set(strategyKey, strategy);
    this.saveStrategy(strategy);

    // Adjust exploration rate based on success
    if (this.totalFeedback % 10 === 0) {
      this.adjustExploration();
    }
  }

  /** Get best model tier for an intent type based on learned rewards */
  getBestModelTier(intentType: string): string {
    const candidates = Array.from(this.strategies.values())
      .filter(s => s.trials >= 3 && this.extractIntent(s.id) === intentType);

    if (candidates.length === 0) return 'flash';

    // Exploration: try random sometimes
    if (Math.random() < this.explorationRate) {
      const allTiers = ['flash', 'pro', 'local'];
      return allTiers[Math.floor(Math.random() * allTiers.length)];
    }

    // Exploitation: pick best
    const best = candidates.reduce((a, b) => a.reward > b.reward ? a : b);
    return best.modelTier;
  }

  /** Get the optimal prompt variant for an intent */
  getBestPrompt(intentType: string): string {
    const model = this.rewardModels.get(intentType);
    if (!model) return 'default';

    // Return prompt variant name based on learned weight distribution
    const totalWeight = Object.values(model.weights).reduce((s, w) => s + w, 0);
    return totalWeight > 4 ? 'detailed' : totalWeight > 3 ? 'balanced' : 'concise';
  }

  /** Compute weighted reward score for a response */
  computeReward(intentType: string, scores: Record<string, number>): number {
    const model = this.rewardModels.get(intentType);
    if (!model) {
      return Object.values(scores).reduce((s, v) => s + v, 0) / Object.keys(scores).length;
    }

    let weightedSum = 0;
    let totalWeight = 0;
    for (const [key, weight] of Object.entries(model.weights)) {
      if (scores[key] !== undefined) {
        weightedSum += scores[key] * weight;
        totalWeight += weight;
      }
    }
    return totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  }

  /** Record a successful tool chain for reinforcement */
  reinforceToolChain(intentType: string, toolsUsed: string[], success: boolean): void {
    for (const tool of toolsUsed) {
      const key = this.strategyKey(intentType, tool);
      let strategy = this.strategies.get(key);
      if (!strategy) {
        strategy = {
          id: key,
          promptVariant: 'default',
          modelTier: tool,
          toolSet: [tool],
          reward: 0,
          trials: 0,
          lastTried: Date.now(),
        };
      }
      strategy.trials++;
      strategy.reward = (strategy.reward * (strategy.trials - 1) + (success ? 1 : -0.5)) / strategy.trials;
      strategy.lastTried = Date.now();
      this.strategies.set(key, strategy);
      this.saveStrategy(strategy);
    }
  }

  /** Get all learned reward models */
  getRewardModels(): RewardModel[] {
    return Array.from(this.rewardModels.values());
  }

  /** Get top strategy combinations */
  getTopStrategies(limit = 10): StrategyCombination[] {
    return Array.from(this.strategies.values())
      .filter(s => s.trials >= 2)
      .sort((a, b) => b.reward - a.reward)
      .slice(0, limit);
  }

  getStats() {
    return {
      totalFeedback: this.totalFeedback,
      rewardModels: this.rewardModels.size,
      strategies: this.strategies.size,
      explorationRate: this.explorationRate,
    };
  }

  // ── Private ─────────────────────────────────────────────────

  private adjustExplorationRate(): void {
    const recentFeedback = this.feedbackManager.recent(50);
    const recentUp = recentFeedback.filter(f => f.vote === 'up').length;
    const rate = recentFeedback.length > 0 ? recentUp / recentFeedback.length : 0.5;

    // Decrease exploration when success rate is high
    this.explorationRate = rate > 0.8 ? 0.05 : rate > 0.5 ? 0.1 : 0.2;
  }

  private adjustExploration(): void {
    const stats = this.feedbackManager.getStats();
    this.explorationRate = stats.rate > 80 ? 0.05 : stats.rate > 60 ? 0.1 : 0.2;
  }

  private strategyKey(intentType: string, modelTier: string): string {
    return `${intentType}::${modelTier}`;
  }

  private extractIntent(key: string): string {
    return key.split('::')[0] || key;
  }

  private saveRewardModel(model: RewardModel): void {
    try {
      const db = getDb();
      db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(`reward_model:${model.intentType}`, JSON.stringify(model));
    } catch { /* skip */ }
  }

  private saveStrategy(strategy: StrategyCombination): void {
    try {
      const db = getDb();
      db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(`strategy:${strategy.id}`, JSON.stringify(strategy));
    } catch { /* skip */ }
  }

  private loadRewardModels(): void {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT value FROM config WHERE key LIKE 'reward_model:%'").all() as Array<{ value: string }>;
      for (const row of rows) {
        try {
          const m: RewardModel = JSON.parse(row.value);
          this.rewardModels.set(m.intentType, m);
        } catch { /* skip */ }
      }
    } catch { /* start empty */ }
  }

  private loadStrategies(): void {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT value FROM config WHERE key LIKE 'strategy:%'").all() as Array<{ value: string }>;
      for (const row of rows) {
        try {
          const s: StrategyCombination = JSON.parse(row.value);
          this.strategies.set(s.id, s);
        } catch { /* skip */ }
      }
    } catch { /* start empty */ }
  }
}

export function createFeedbackLearning(feedbackManager: FeedbackManager): FeedbackLearning {
  return new FeedbackLearning(feedbackManager);
}
