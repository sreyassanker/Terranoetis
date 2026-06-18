import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { omninet } from '../ai-router/omninet';
import { getRecentEvals, getAvgScoresByIntent } from '../ml/evals';
import { FeedbackManager } from '../selfImprover';
import type { PerformanceAnalyzer } from './performanceAnalyzer';
import type { PromptEvolution } from './promptEvolution';
import type { IntentDiscovery } from './intentDiscovery';
import type { ArchitectureProposals } from './architectureProposals';
import type { FeedbackLearning } from './feedbackLearning';

// ── Types ───────────────────────────────────────────────────────

export interface SelfReport {
  id: string;
  generatedAt: number;
  periodStart: number;
  periodEnd: number;
  summary: string;
  sections: ReportSection[];
  rawMetrics: RawMetrics;
}

interface ReportSection {
  title: string;
  body: string;
  metrics: Record<string, string | number>;
}

interface RawMetrics {
  totalQueries: number;
  avgAccuracy: number;
  satisfactionRate: number;
  newIntentsProposed: number;
  newIntentsApproved: number;
  promptVariants: number;
  promptGenerations: number;
  driftDetected: number;
  toolsCreated: number;
  predictionsValidated: number;
  improvements: number;
  challenges: string[];
}

// ── SelfReportGenerator ─────────────────────────────────────────

export class SelfReportGenerator {
  constructor(
    private feedbackManager: FeedbackManager,
    private perfAnalyzer: PerformanceAnalyzer,
    private promptEvolver: PromptEvolution,
    private intentDiscoverer: IntentDiscovery,
    private archProposer: ArchitectureProposals,
    private feedbackLearner: FeedbackLearning,
  ) {}

  async generate(): Promise<SelfReport> {
    const endTime = Date.now();
    const startTime = endTime - 7 * 86400000;

    const rawMetrics = await this.collectMetrics(startTime, endTime);

    // Generate report sections
    const sections: ReportSection[] = [
      this.performanceSection(rawMetrics),
      this.evolutionSection(rawMetrics),
      this.discoverySection(rawMetrics),
      this.learningSection(rawMetrics),
      this.challengesSection(rawMetrics),
    ];

    // Generate natural language summary
    const summary = await this.generateSummary(sections, rawMetrics);

    const report: SelfReport = {
      id: `report_${Date.now()}`,
      generatedAt: endTime,
      periodStart: startTime,
      periodEnd: endTime,
      summary,
      sections,
      rawMetrics,
    };

    // Store report
    try {
      const db = getDb();
      db.prepare("INSERT INTO config (key, value) VALUES ('last_self_report', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(JSON.stringify(report));
    } catch { /* skip */ }

    logger.info({ reportId: report.id }, 'Self-report generated');
    return report;
  }

  // ── Sections ─────────────────────────────────────────────────

  private performanceSection(m: RawMetrics): ReportSection {
    const byIntent = getAvgScoresByIntent();
    const topIntent = Object.entries(byIntent)
      .sort(([, a], [, b]) => b.avgOverall - a.avgOverall)
      .slice(0, 3);

    return {
      title: 'Performance & Accuracy',
      body: `Overall accuracy: ${(m.avgAccuracy * 100).toFixed(1)}%. Satisfaction rate: ${(m.satisfactionRate * 100).toFixed(1)}%. ` +
        `Best performing intents: ${topIntent.map(([name, s]) => `${name} (${(s.avgOverall * 100).toFixed(0)}%)`).join(', ')}. ` +
        `${m.driftDetected > 0 ? `${m.driftDetected} intent(s) flagged for performance drift.` : 'No significant drift detected.'}`,
      metrics: {
        avgAccuracy: Math.round(m.avgAccuracy * 100) / 100,
        satisfactionRate: Math.round(m.satisfactionRate * 100) / 100,
        totalQueries: m.totalQueries,
        driftDetected: m.driftDetected,
      },
    };
  }

  private evolutionSection(m: RawMetrics): ReportSection {
    return {
      title: 'Prompt Evolution',
      body: `Maintained ${m.promptVariants} prompt variants across ${m.promptGenerations} generations. ` +
        `${m.improvements > 0 ? `${m.improvements} prompt(s) automatically improved through genetic selection.` : 'Early stage — collecting baseline data.'}`,
      metrics: {
        promptVariants: m.promptVariants,
        promptGenerations: m.promptGenerations,
        improvements: m.improvements,
      },
    };
  }

  private discoverySection(m: RawMetrics): ReportSection {
    const pendingProposals = this.intentDiscoverer.getPending();
    return {
      title: 'Intent Discovery',
      body: `${m.newIntentsProposed} new intent(s) proposed, ${m.newIntentsApproved} approved. ` +
        `${pendingProposals.length > 0 ? `${pendingProposals.length} pending approval: ${pendingProposals.map(p => p.name).join(', ')}.` : 'No pending intent proposals.'}` +
        `${m.toolsCreated > 0 ? ` ${m.toolsCreated} new tool chain(s) auto-generated.` : ''}`,
      metrics: {
        newIntentsProposed: m.newIntentsProposed,
        newIntentsApproved: m.newIntentsApproved,
        pendingProposals: pendingProposals.length,
        toolsCreated: m.toolsCreated,
      },
    };
  }

  private learningSection(m: RawMetrics): ReportSection {
    const topStrategies = this.feedbackLearner.getTopStrategies(3);
    const learnerStats = this.feedbackLearner.getStats();
    return {
      title: 'Learning & Adaptation',
      body: `Reward model covers ${learnerStats.rewardModels} intent types across ${learnerStats.strategies} strategy combinations. ` +
        `Top strategies: ${topStrategies.map(s => `${s.modelTier} (reward: ${(s.reward * 100).toFixed(0)}%)`).join(', ') || 'building baseline'}. ` +
        `Exploration rate: ${(learnerStats.explorationRate * 100).toFixed(0)}%. ${m.predictionsValidated > 0 ? `${m.predictionsValidated} predictions validated.` : ''}`,
      metrics: {
        rewardModels: learnerStats.rewardModels,
        strategies: learnerStats.strategies,
        explorationRate: Math.round(learnerStats.explorationRate * 100) / 100,
        predictionsValidated: m.predictionsValidated,
      },
    };
  }

  private challengesSection(m: RawMetrics): ReportSection {
    const topProposals = this.archProposer.getTopProposals(3);
    return {
      title: 'Challenges & Opportunities',
      body: m.challenges.length > 0
        ? `Key challenges: ${m.challenges.slice(0, 3).map(c => `• ${c}`).join('\n')}`
        : 'No significant challenges detected.',
      metrics: {
        openProposals: topProposals.length,
        topProposal: topProposals[0]?.title || 'none',
        avgLatencyMs: 0,
      },
    };
  }

  // ── Metrics Collection ───────────────────────────────────────

  private async collectMetrics(startTime: number, endTime: number): Promise<RawMetrics> {
    const evals = getRecentEvals(200);
    const avgAccuracy = evals.length > 0
      ? evals.reduce((s, e) => s + e.overall, 0) / evals.length
      : 0;

    const fbStats = this.feedbackManager.getStats();
    const satisfactionRate = fbStats.total > 0 ? fbStats.rate / 100 : 0.5;

    const perfResults = this.perfAnalyzer.analyze();
    const driftDetected = perfResults.filter(p => p.driftDetected).length;

    const intentPerformanceCosts = this.intentDiscoverer.getProposed();
    const newIntentsProposed = intentPerformanceCosts.length;
    const newIntentsApproved = intentPerformanceCosts.filter(p => p.status === 'approved').length;

    const pop = this.promptEvolver.getPopulation();
    const promptVariants = pop.length;
    const promptGenerations = Math.max(...pop.map(g => g.generation), 0);
    const improvements = pop.filter(g => g.generation > 0).length;

    const learnerStats = this.feedbackLearner.getStats();

    let predictionsValidated = 0;
    try {
      const db = getDb();
      const pRow = db.prepare('SELECT COUNT(*) as c FROM validation_log').get() as { c: number } | undefined;
      predictionsValidated = pRow?.c || 0;
    } catch { /* skip */ }

    const archProposals = this.archProposer.getProposals();
    const toolsCreated = archProposals.filter(p => p.status === 'implemented').length;

    const challenges: string[] = [];
    if (driftDetected > 0) challenges.push(`${driftDetected} intent type(s) with performance drift`);
    if (fbStats.rate < 50) challenges.push('Low user satisfaction rate');
    if (learnerStats.strategies < 5) challenges.push('Insufficient strategy data for reinforcement learning');

    return {
      totalQueries: fbStats.total,
      avgAccuracy,
      satisfactionRate,
      newIntentsProposed,
      newIntentsApproved,
      promptVariants,
      promptGenerations,
      driftDetected,
      toolsCreated,
      predictionsValidated,
      improvements,
      challenges,
    };
  }

  // ── LLM Summary ──────────────────────────────────────────────

  private async generateSummary(sections: ReportSection[], metrics: RawMetrics): Promise<string> {
    try {
      const result = await omninet.generateText(
        `Generate a concise weekly self-report summary (2-3 paragraphs) for an AI system.

        System: Geospatial intelligence copilot with multi-agent orchestration, knowledge graph, causal prediction, and proactive monitoring.

        This week's metrics:
        - Accuracy: ${(metrics.avgAccuracy * 100).toFixed(1)}%
        - Satisfaction: ${(metrics.satisfactionRate * 100).toFixed(1)}%
        - Drift detected: ${metrics.driftDetected} intent(s)
        - New intents proposed: ${metrics.newIntentsProposed}
        - Prompt variants: ${metrics.promptVariants}
        - Predictions validated: ${metrics.predictionsValidated}

        Sections: ${sections.map(s => `- ${s.title}: ${s.body.slice(0, 100)}...`).join('\n')}

        Write in first person as the AI. Be honest about challenges and specific about improvements.`,
        { temperature: 0.4, maxTokens: 500 },
      );
      return result.trim();
    } catch {
      return `Weekly report: accuracy at ${(metrics.avgAccuracy * 100).toFixed(0)}%, satisfaction at ${(metrics.satisfactionRate * 100).toFixed(0)}%. ${metrics.driftDetected} drift issues detected. ${metrics.newIntentsProposed} new intents proposed.`;
    }
  }

  /** Retrieve the last generated report */
  getLastReport(): SelfReport | null {
    try {
      const db = getDb();
      const row = db.prepare("SELECT value FROM config WHERE key = 'last_self_report'").get() as { value: string } | undefined;
      if (row) return JSON.parse(row.value);
    } catch { /* not available */ }
    return null;
  }
}
