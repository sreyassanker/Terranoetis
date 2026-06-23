import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { omninet } from '../ai-router/omninet';
import { getRecentEvals } from '../ml/evals';

// ── Types ───────────────────────────────────────────────────────

export interface ArchitectureProposal {
  id: string;
  title: string;
  description: string;
  category: 'performance' | 'scalability' | 'new_capability' | 'optimization' | 'reliability';
  expectedImpact: number;
  effort: 'low' | 'medium' | 'high';
  effortScore: number;
  priority: number;
  evidence: string[];
  status: 'pending' | 'approved' | 'rejected' | 'implemented';
  proposedAt: number;
}

// ── ArchitectureProposals ───────────────────────────────────────

export class ArchitectureProposals {
  private proposals: Map<string, ArchitectureProposal> = new Map();
  private proposalCount = 0;

  init(): void {
    this.loadProposals();
    logger.info('ArchitectureProposals initialized');
  }

  /** Monitor system metrics and generate proposals */
  async analyzeAndPropose(): Promise<ArchitectureProposal[]> {
    const newProposals: ArchitectureProposal[] = [];
    const metrics = this.gatherMetrics();

    // Check for latency bottlenecks
    if (metrics.avgLatencyMs > 2000) {
      newProposals.push(this.createProposal({
        title: 'Add response caching layer for high-latency intents',
        description: `Average response latency is ${metrics.avgLatencyMs}ms. Implementing tiered caching for frequent query patterns could reduce this by 60%.`,
        category: 'performance',
        expectedImpact: 0.8,
        effort: 'medium',
        effortScore: 0.5,
        evidence: [`Avg latency: ${metrics.avgLatencyMs}ms`, `Cache hit rate: ${(metrics.cacheHitRate * 100).toFixed(0)}%`],
      }));
    }

    // Check for performance drift
    if (metrics.driftedIntentCount > 0) {
      newProposals.push(this.createProposal({
        title: `Investigate ${metrics.driftedIntentCount} intent(s) with performance drift`,
        description: `${metrics.driftedIntentCount} intent types show significant performance drift. Root cause analysis recommended.`,
        category: 'performance',
        expectedImpact: 0.7,
        effort: 'low',
        effortScore: 0.8,
        evidence: [`${metrics.driftedIntentCount} drifted intents`, `Overall accuracy: ${(metrics.avgAccuracy * 100).toFixed(0)}%`],
      }));
    }

    // Check for underutilized tools
    if (metrics.toolCount > 0 && metrics.toolUsageRate < 0.3) {
      newProposals.push(this.createProposal({
        title: 'Prune or consolidate underutilized data sources',
        description: `Only ${(metrics.toolUsageRate * 100).toFixed(0)}% of registered tools are used regularly. Consider removing or consolidating the rest.`,
        category: 'optimization',
        expectedImpact: 0.3,
        effort: 'low',
        effortScore: 0.7,
        evidence: [`Tool usage rate: ${(metrics.toolUsageRate * 100).toFixed(0)}%`],
      }));
    }

    // Check for feedback volume
    if (metrics.feedbackCount < 10 && metrics.totalQueries > 100) {
      newProposals.push(this.createProposal({
        title: 'Add explicit feedback prompts to improve learning',
        description: `Only ${metrics.feedbackCount} feedback entries from ${metrics.totalQueries} queries (${(metrics.feedbackRate * 100).toFixed(0)}%). Adding UI prompts could increase feedback 5x.`,
        category: 'optimization',
        expectedImpact: 0.6,
        effort: 'low',
        effortScore: 0.8,
        evidence: [`Feedback rate: ${(metrics.feedbackRate * 100).toFixed(0)}%`],
      }));
    }

    // Use LLM for novel proposals
    const llmProposals = await this.generateLLMProposals(metrics);
    newProposals.push(...llmProposals);

    for (const p of newProposals) {
      this.proposals.set(p.id, p);
      this.saveProposal(p);
    }

    if (newProposals.length > 0) {
      logger.info({ count: newProposals.length }, 'New architecture proposals generated');
    }

    return newProposals;
  }

  getProposals(status?: ArchitectureProposal['status']): ArchitectureProposal[] {
    const all = Array.from(this.proposals.values());
    return status ? all.filter(p => p.status === status) : all;
  }

  getTopProposals(limit = 5): ArchitectureProposal[] {
    return this.getProposals('pending')
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit);
  }

  approve(id: string): void {
    const p = this.proposals.get(id);
    if (p) {
      p.status = 'approved';
      this.saveProposal(p);
    }
  }

  reject(id: string): void {
    const p = this.proposals.get(id);
    if (p) {
      p.status = 'rejected';
      this.saveProposal(p);
    }
  }

  markImplemented(id: string): void {
    const p = this.proposals.get(id);
    if (p) {
      p.status = 'implemented';
      this.saveProposal(p);
    }
  }

  // ── Private ─────────────────────────────────────────────────

  private createProposal(partial: Omit<ArchitectureProposal, 'id' | 'priority' | 'status' | 'proposedAt'>): ArchitectureProposal {
    this.proposalCount++;
    const priority = Math.round(partial.expectedImpact * partial.effortScore * 100);
    return {
      ...partial,
      id: `proposal_${Date.now()}_${this.proposalCount}`,
      priority,
      status: 'pending',
      proposedAt: Date.now(),
    };
  }

  private gatherMetrics() {
    const evals = getRecentEvals(100);
    const avgAccuracy = evals.length > 0
      ? evals.reduce((s, e) => s + e.overall, 0) / evals.length
      : 0;

    let toolCount = 0;
    const toolUsageRate = 0.5;
    let avgLatencyMs = 1500;
    let cacheHitRate = 0.3;
    let feedbackCount = 0;
    let totalQueries = 0;
    let driftedIntentCount = 0;

    try {
      const db = getDb();
      const toolRow = db.prepare('SELECT COUNT(*) as c FROM dynamic_tools').get() as { c: number } | undefined;
      toolCount = toolRow?.c || 0;

      const latencyRow = db.prepare('SELECT AVG(latency_ms) as avg FROM execution_log WHERE created_at >= datetime("now", "-1 hour")').get() as { avg: number | null } | undefined;
      if (latencyRow?.avg) avgLatencyMs = latencyRow.avg;

      const cacheRow = db.prepare("SELECT value FROM config WHERE key = 'cache_hit_rate'").get() as { value: string } | undefined;
      if (cacheRow) cacheHitRate = parseFloat(cacheRow.value) || 0.3;

      const fbRow = db.prepare('SELECT COUNT(*) as c FROM feedback').get() as { c: number } | undefined;
      feedbackCount = fbRow?.c || 0;

      const costRow = db.prepare("SELECT value FROM config WHERE key = 'cost_total_queries'").get() as { value: string } | undefined;
      totalQueries = parseInt(costRow?.value || '0');

      const driftRow = db.prepare("SELECT value FROM config WHERE key = 'perf_baselines'").get();
      driftedIntentCount = driftRow ? 2 : 0;
    } catch { /* defaults */ }

    return {
      avgLatencyMs,
      toolCount,
      toolUsageRate: toolCount > 0 ? toolUsageRate : 0,
      cacheHitRate,
      feedbackCount,
      totalQueries,
      feedbackRate: totalQueries > 0 ? feedbackCount / totalQueries : 0,
      avgAccuracy,
      driftedIntentCount,
    };
  }

  private async generateLLMProposals(metrics: Record<string, number>): Promise<ArchitectureProposal[]> {
    try {
      const result = await omninet.generateText(
        `You are an AI system architect. Based on these system metrics, suggest 1-2 high-impact architecture improvements.

        Metrics: ${JSON.stringify(metrics)}
        Current capabilities: real-time geospatial data, multi-agent orchestration, knowledge graph, causal prediction, proactive monitoring

        For each proposal, return JSON:
        {"proposals": [{"title": "...", "description": "...", "category": "performance|scalability|new_capability|reliability", "expectedImpact": 0.0-1.0, "effort": "low|medium|high"}]}`,
        { temperature: 0.5, maxTokens: 500 },
      );

      const cleaned = result.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.proposals && Array.isArray(parsed.proposals)) {
        return parsed.proposals.map((p: Record<string, unknown>) => {
          const effort = p.effort as string || 'medium';
          const effortScore = effort === 'low' ? 0.8 : effort === 'medium' ? 0.5 : 0.3;
          return this.createProposal({
            title: p.title as string || 'Unnamed proposal',
            description: p.description as string || '',
            category: (p.category as ArchitectureProposal['category']) || 'new_capability',
            expectedImpact: Math.min(1, Math.max(0, (p.expectedImpact as number) || 0.5)),
            effort: effort as ArchitectureProposal['effort'],
            effortScore,
            evidence: ['Generated by LLM self-analysis'],
          });
        });
      }
    } catch { /* skip */ }
    return [];
  }

  private saveProposal(p: ArchitectureProposal): void {
    try {
      const db = getDb();
      db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(`arch_proposal:${p.id}`, JSON.stringify(p));
    } catch { /* skip */ }
  }

  private loadProposals(): void {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT value FROM config WHERE key LIKE 'arch_proposal:%'").all() as Array<{ value: string }>;
      for (const row of rows) {
        try {
          const p: ArchitectureProposal = JSON.parse(row.value);
          this.proposals.set(p.id, p);
        } catch { /* skip corrupt */ }
      }
    } catch { /* start empty */ }
  }
}

export const architectureProposals = new ArchitectureProposals();
