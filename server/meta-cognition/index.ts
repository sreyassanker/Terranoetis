import { logger } from '../observability/logger';
import { getDb } from '../db/index';
import { FeedbackManager } from '../selfImprover';
import { performanceAnalyzer } from './performanceAnalyzer';
import { promptEvolution } from './promptEvolution';
import { intentDiscovery } from './intentDiscovery';
import { architectureProposals } from './architectureProposals';
import { FeedbackLearning, createFeedbackLearning } from './feedbackLearning';
import { SelfReportGenerator } from './selfReport';
import { isAutonomousAiAllowed } from '../aiGate';

// ── MetaCognition ───────────────────────────────────────────────

export class MetaCognition {
  feedbackLearning!: FeedbackLearning;
  reportGenerator!: SelfReportGenerator;
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  init(feedbackManager: FeedbackManager): void {
    this.ensureTables();

    this.feedbackLearning = createFeedbackLearning(feedbackManager);

    performanceAnalyzer.init();
    promptEvolution.init();
    intentDiscovery.init();
    architectureProposals.init();
    this.feedbackLearning.init();

    this.reportGenerator = new SelfReportGenerator(
      feedbackManager,
      performanceAnalyzer,
      promptEvolution,
      intentDiscovery,
      architectureProposals,
      this.feedbackLearning,
    );

    logger.info('MetaCognition system initialized');
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Chat-only mode: background self-improvement cycles call the LLM —
    // disabled unless AUTONOMOUS_AI=1. On-demand endpoints remain available.
    if (!isAutonomousAiAllowed()) {
      logger.info('MetaCognition: autonomous AI disabled (chat-only mode) — skipping self-improvement cycles');
      return;
    }

    // Run self-analysis cycles
    this.runCycle().catch(() => {});

    // Every 30 minutes: performance analysis + drift detection
    this.cycleTimer = setInterval(() => this.runCycle(), 1800000);

    // Every hour: intent discovery clustering
    setInterval(() => {
      intentDiscovery.discover().catch(() => {});
    }, 3600000);

    // Every 6 hours: architecture proposals
    setInterval(() => {
      architectureProposals.analyzeAndPropose().catch(() => {});
    }, 21600000);

    // Every 24 hours: prompt evolution for underperforming intents
    setInterval(() => {
      this.evolveUnderperformingPrompts().catch(() => {});
    }, 86400000);

    // Every 7 days: full self-report
    setInterval(() => {
      this.reportGenerator.generate().catch(() => {});
    }, 604800000);

    logger.info('MetaCognition started — self-improvement cycles active');
  }

  stop(): void {
    this.running = false;
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
    logger.info('MetaCognition stopped');
  }

  async runCycle(): Promise<void> {
    // 1. Analyze performance
    performanceAnalyzer.analyze();

    // 2. Detect drift
    const drifted = performanceAnalyzer.getDriftedIntents();
    for (const drift of drifted) {
      const rootCause = performanceAnalyzer.analyzeRootCause(drift.intentType);
      logger.warn({ rootCause }, 'Root cause analysis complete');

      // 3. Auto-remediate drift
      if (rootCause.primaryCause === 'prompt_staleness') {
        await promptEvolution.evolve(drift.intentType);
      }
    }

    // 4. Update performance baselines
    performanceAnalyzer.updateBaseline();

    // 5. Check for new intent proposals
    const proposals = intentDiscovery.getPending();
    if (proposals.length > 0) {
      logger.info({ count: proposals.length }, 'Pending intent proposals awaiting review');
    }
  }

  private async evolveUnderperformingPrompts(): Promise<void> {
    const perfResults = performanceAnalyzer.analyze();
    const underperforming = perfResults
      .filter(p => p.sampleCount >= 20 && p.accuracy < 0.6)
      .sort((a, b) => a.accuracy - b.accuracy);

    for (const intent of underperforming.slice(0, 3)) {
      await promptEvolution.evolve(intent.intentType);
      logger.info({ intentType: intent.intentType }, 'Auto-evolved underperforming prompt');
    }
  }

  getStatus() {
    return {
      running: this.running,
      performance: performanceAnalyzer.analyze(),
      drifted: performanceAnalyzer.getDriftedIntents(),
      proposals: intentDiscovery.getPending(),
      archProposals: architectureProposals.getProposals('pending'),
      learning: this.feedbackLearning?.getStats(),
    };
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS unmatched_queries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          query TEXT NOT NULL,
          user_id TEXT,
          location TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_unmatched_created ON unmatched_queries(created_at DESC);

        CREATE TABLE IF NOT EXISTS custom_intents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          example_queries_json TEXT,
          tool_chains_json TEXT,
          eval_criteria_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    } catch (e) { logger.warn({ err: e }, 'Meta-cognition DB tables already exist'); }
  }
}
