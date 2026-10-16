import { evaluateResponse, storeEval, getRecentEvals, type EvalScores } from './ml/evals';
import { promptLab } from './ml/promptLab';
import { logger } from './observability/logger';
import { MetaCognition } from './meta-cognition/index';
import { performanceAnalyzer } from './meta-cognition/performanceAnalyzer';
import { intentDiscovery } from './meta-cognition/intentDiscovery';
import { architectureProposals } from './meta-cognition/architectureProposals';
import type { FeedbackManager } from './selfImprover';
import type { BanditRouter } from './self-evolution/banditRouter';

// ── Types ───────────────────────────────────────────────────────

export interface SelfImprovementReport {
  timestamp: number;
  improvementsApplied: number;
  driftDetected: number;
  proposalsGenerated: number;
  promptsEvolved: number;
  promptGenerations: number;
  intentDiscoveryProcessed: boolean;
  learningStats: {
    totalFeedback: number;
    rewardModels: number;
    strategies: number;
  };
}

// ── SelfImproverV2 ──────────────────────────────────────────────

export class SelfImproverV2 {
  private metaCognition: MetaCognition;
  private feedbackManager: FeedbackManager | null = null;
  private banditRouter: BanditRouter | null = null;
  private cycleCount = 0;

  constructor() {
    this.metaCognition = new MetaCognition();
  }

  setFeedbackManager(fm: FeedbackManager): void {
    this.feedbackManager = fm;
  }

  setBanditRouter(router: BanditRouter): void {
    this.banditRouter = router;
  }

  init(): void {
    if (!this.feedbackManager) {
      logger.warn('SelfImproverV2: no FeedbackManager set — call setFeedbackManager()');
      return;
    }
    this.metaCognition.init(this.feedbackManager);
    logger.info('SelfImproverV2 initialized — central intelligence hub active');
  }

  start(): void {
    this.metaCognition.start();
    logger.info('SelfImproverV2 started — self-improvement cycles active');
  }

  stop(): void {
    this.metaCognition.stop();
    logger.info('SelfImproverV2 stopped');
  }

  /** Record feedback and update all learning systems */
  recordFeedback(
    userId: string,
    query: string,
    response: string,
    vote: 'up' | 'down',
    intentType: string,
    modelTier: string,
  ): void {
    if (!this.feedbackManager) return;

    // Record base feedback
    this.feedbackManager.record({ userId, query, response, vote, intentType, modelTier });

    // Update reward model
    this.metaCognition.feedbackLearning.learnFromVote(query, response, vote, intentType, modelTier);

    // Update multi-armed bandit arm
    if (this.banditRouter && modelTier) {
      this.banditRouter.updateReward(modelTier, vote === 'up' ? 1 : 0);
    }
  }

  /** Evaluate a response and feed results into all systems */
  async evaluateInteraction(
    query: string,
    response: string,
    context: { intentType?: string; location?: string; modelTier?: string },
    episodeId: string | null,
  ): Promise<EvalScores | null> {
    if (!response) return null;

    try {
      const scores = await evaluateResponse(query, response, context);
      storeEval(episodeId, query, scores, context as Record<string, unknown>);
      promptLab.recordResult(context.intentType || 'unknown', 'default', scores.overall);

      // Record latency in performance analyzer
      performanceAnalyzer.recordLatency(context.intentType || 'unknown', 0);

      // Update bandit arm reward from empirical evaluation
      if (this.banditRouter && context.modelTier) {
        this.banditRouter.updateReward(context.modelTier, scores.overall >= 0.7 ? 1 : 0);
      }

      // Record unmatched queries for intent discovery
      if (context.intentType === 'unknown') {
        intentDiscovery.recordUnmatched(query, 'default', context.location);
      }

      return scores;
    } catch (e) {
      logger.error({ err: e }, 'SelfImproverV2 evaluation failed');
      return null;
    }
  }

  /** Record tool usage for reinforcement learning */
  recordToolUsage(intentType: string, toolsUsed: string[], success: boolean): void {
    this.metaCognition.feedbackLearning.reinforceToolChain(intentType, toolsUsed, success);
  }

  /** Record latency for performance analysis */
  recordLatency(intentType: string, latencyMs: number): void {
    performanceAnalyzer.recordLatency(intentType, latencyMs);
  }

  /** Run one complete self-improvement cycle */
  async runCycle(): Promise<SelfImprovementReport> {
    this.cycleCount++;

    // Run meta-cognition cycle (performance analysis + drift detection)
    await this.metaCognition.runCycle();

    // Generate architecture proposals
    const proposals = await architectureProposals.analyzeAndPropose();

    // Evolve prompts
    const perfResults = performanceAnalyzer.analyze();
    const underperformers = perfResults.filter(p => p.sampleCount >= 20 && p.accuracy < 0.65);
    let promptsEvolved = 0;
    for (let i = 0; i < Math.min(underperformers.length, 3); i++) {
      await this.metaCognition.runCycle();
      promptsEvolved++;
    }

    // Calibrate bandit router against historical database evals if arms are unsampled
    if (this.banditRouter) {
      const stats = this.banditRouter.getStats();
      const totalPulls = stats.reduce((sum, s) => sum + s.pulls, 0);
      if (totalPulls === 0) {
        const dbEvals = getRecentEvals(200);
        for (const ev of dbEvals) {
          if (ev.metadata_json) {
            try {
              const meta = JSON.parse(ev.metadata_json);
              if (meta?.modelTier) {
                this.banditRouter.updateReward(meta.modelTier, (ev.overall ?? 0.5) >= 0.7 ? 1 : 0);
              }
            } catch { /* ignore parse error */ }
          }
        }
      }
    }

    // Update baselines
    performanceAnalyzer.updateBaseline();

    const learnerStats = this.metaCognition.feedbackLearning?.getStats();

    return {
      timestamp: Date.now(),
      improvementsApplied: proposals.length,
      driftDetected: performanceAnalyzer.getDriftedIntents().length,
      proposalsGenerated: proposals.length,
      promptsEvolved,
      promptGenerations: promptsEvolved,
      intentDiscoveryProcessed: true,
      learningStats: {
        totalFeedback: learnerStats?.totalFeedback || 0,
        rewardModels: learnerStats?.rewardModels || 0,
        strategies: learnerStats?.strategies || 0,
      },
    };
  }

  /** Get the comprehensive system status */
  getStatus() {
    return {
      cycleCount: this.cycleCount,
      metaCognition: this.metaCognition.getStatus(),
      performance: performanceAnalyzer.analyze(),
      drift: performanceAnalyzer.getDriftedIntents(),
      intentProposals: intentDiscovery.getPending(),
      architectureProposals: architectureProposals.getTopProposals(5),
      lastReport: this.metaCognition.reportGenerator?.getLastReport(),
    };
  }
}

export const selfImproverV2 = new SelfImproverV2();
