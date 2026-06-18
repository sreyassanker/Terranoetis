import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { getRecentEvals, getAvgScoresByIntent } from '../ml/evals';
import type { EvalScores } from '../ml/evals';

// ── Types ───────────────────────────────────────────────────────

export interface IntentPerformance {
  intentType: string;
  accuracy: number;
  avgLatency: number;
  satisfaction: number;
  sampleCount: number;
  trend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
  driftDetected: boolean;
  recentScore: number;
  baselineScore: number;
}

export interface DriftReport {
  intentType: string;
  driftMagnitude: number;
  direction: 'drop' | 'rise';
  possibleCauses: string[];
  firstDetected: number;
  confirmed: boolean;
}

export interface RootCause {
  intentType: string;
  primaryCause: 'data_quality' | 'model_degradation' | 'prompt_staleness' | 'user_pattern_shift' | 'unknown';
  confidence: number;
  evidence: string[];
  recommendation: string;
}

// ── PerformanceAnalyzer ─────────────────────────────────────────

export class PerformanceAnalyzer {
  private baselines: Map<string, { accuracy: number; satisfaction: number; latency: number; sampledAt: number }> = new Map();
  private driftFlags: Map<string, DriftReport> = new Map();
  private latencyWindow: Map<string, number[]> = new Map();

  init(): void {
    this.loadBaselines();
    logger.info('PerformanceAnalyzer initialized');
  }

  recordLatency(intentType: string, latencyMs: number): void {
    if (!this.latencyWindow.has(intentType)) {
      this.latencyWindow.set(intentType, []);
    }
    const window = this.latencyWindow.get(intentType)!;
    window.push(latencyMs);
    if (window.length > 100) window.shift();
  }

  /** Analyze performance across all intents, detect drift */
  analyze(): IntentPerformance[] {
    const byIntent = getAvgScoresByIntent();
    const evals = getRecentEvals(200);
    const recentEvals = getRecentEvals(50);

    return Object.entries(byIntent).map(([intentType, stats]) => {
      const intentEvals = evals.filter(e => {
        try {
          const meta = JSON.parse((e as any).metadata_json || '{}');
          return meta.intentType === intentType;
        } catch { return false; }
      });

      const intentRecent = recentEvals.filter(e => {
        try {
          const meta = JSON.parse((e as any).metadata_json || '{}');
          return meta.intentType === intentType;
        } catch { return false; }
      });

      const recentScore = intentRecent.length > 0
        ? intentRecent.reduce((s, e) => s + e.overall, 0) / intentRecent.length
        : stats.avgOverall;

      const baseline = this.baselines.get(intentType);
      const baselineScore = baseline?.accuracy ?? stats.avgOverall;

      const drift = baseline && Math.abs(recentScore - baseline.accuracy) > 0.1;
      const trend = !baseline ? 'insufficient_data' as const
        : recentScore > baseline.accuracy + 0.05 ? 'improving' as const
        : recentScore < baseline.accuracy - 0.05 ? 'declining' as const
        : 'stable' as const;

      if (drift && baseline) {
        this.detectDrift(intentType, recentScore, baseline.accuracy);
      }

      const latencies = this.latencyWindow.get(intentType) || [];
      const avgLatency = latencies.length > 0
        ? latencies.reduce((s, v) => s + v, 0) / latencies.length
        : 0;

      return {
        intentType,
        accuracy: recentScore,
        avgLatency,
        satisfaction: stats.avgOverall,
        sampleCount: stats.count,
        trend,
        driftDetected: drift,
        recentScore,
        baselineScore,
      };
    });
  }

  /** Root cause analysis for a declining intent */
  analyzeRootCause(intentType: string): RootCause {
    const drift = this.driftFlags.get(intentType);
    const evals = getRecentEvals(200);
    const intentEvals = evals.filter(e => this.matchesIntent(e, intentType));
    const recent = intentEvals.slice(0, 50);
    const older = intentEvals.slice(50);

    const evidence: string[] = [];
    let cause: RootCause['primaryCause'] = 'unknown';
    let confidence = 0.3;

    // Check for prompt staleness: score declining but eval quality scores (relevance) still high
    if (recent.length >= 5) {
      const recentRelevance = recent.reduce((s, e) => s + e.relevance, 0) / recent.length;
      const olderRelevance = older.length > 0 ? older.reduce((s, e) => s + e.relevance, 0) / older.length : recentRelevance;

      if (recentRelevance > 0.7 && olderRelevance > 0.7) {
        // Relevance still high but overall dropping → model or prompt issue
        const recentFactual = recent.reduce((s, e) => s + e.factualAccuracy, 0) / recent.length;
        if (recentFactual < 0.5) {
          cause = 'model_degradation';
          confidence = 0.7;
          evidence.push(`Factual accuracy dropped to ${(recentFactual * 100).toFixed(0)}%`);
        } else {
          cause = 'prompt_staleness';
          confidence = 0.6;
          evidence.push('Relevance stable but overall declining — prompt may need updating');
        }
      }
    }

    // Check for data quality issues
    if (intentEvals.length >= 20) {
      const variance = this.computeVariance(intentEvals.map(e => e.overall));
      if (variance > 0.15) {
        if (cause === 'unknown') cause = 'data_quality';
        confidence = Math.max(confidence, 0.5);
        evidence.push(`High score variance (${(variance * 100).toFixed(0)}%) — inconsistent data quality`);
      }
    }

    // Check for user pattern shift
    if (drift && Date.now() - drift.firstDetected > 86400000) {
      cause = 'user_pattern_shift';
      confidence = 0.8;
      evidence.push(`Drift sustained for ${Math.round((Date.now() - drift.firstDetected) / 3600000)}h`);
    }

    return {
      intentType,
      primaryCause: cause,
      confidence: Math.round(confidence * 100) / 100,
      evidence: evidence.slice(0, 3),
      recommendation: this.getRecommendation(cause),
    };
  }

  getDriftedIntents(): DriftReport[] {
    return Array.from(this.driftFlags.values()).filter(d => d.confirmed);
  }

  /** Update baseline snapshot for next comparison */
  updateBaseline(): void {
    const byIntent = getAvgScoresByIntent();
    for (const [intentType, stats] of Object.entries(byIntent)) {
      this.baselines.set(intentType, {
        accuracy: stats.avgOverall,
        satisfaction: stats.avgOverall,
        latency: 0,
        sampledAt: Date.now(),
      });
    }
    this.persistBaselines();
  }

  // ── Private ─────────────────────────────────────────────────

  private detectDrift(intentType: string, current: number, baseline: number): void {
    const existing = this.driftFlags.get(intentType);
    const magnitude = Math.abs(current - baseline);
    const direction = current > baseline ? 'rise' : 'drop';

    if (!existing) {
      this.driftFlags.set(intentType, {
        intentType,
        driftMagnitude: Math.round(magnitude * 100) / 100,
        direction,
        possibleCauses: [],
        firstDetected: Date.now(),
        confirmed: false,
      });
    } else if (!existing.confirmed && Date.now() - existing.firstDetected > 3600000) {
      existing.confirmed = true;
      existing.driftMagnitude = Math.max(existing.driftMagnitude, Math.round(magnitude * 100) / 100);
      existing.possibleCauses = this.hypothesizeCauses(intentType);
      logger.warn({ intentType, magnitude, direction }, 'Performance drift confirmed');
    }
  }

  private hypothesizeCauses(intentType: string): string[] {
    const causes: string[] = [];
    const evals = getRecentEvals(100);
    const intentEvals = evals.filter(e => this.matchesIntent(e, intentType));

    if (intentEvals.length >= 10) {
      const avgFactual = intentEvals.reduce((s, e) => s + e.factualAccuracy, 0) / intentEvals.length;
      if (avgFactual < 0.5) causes.push('Possible model degradation — factual accuracy low');
      if (intentEvals.length > 50) {
        const firstHalf = intentEvals.slice(intentEvals.length / 2).reduce((s, e) => s + e.overall, 0) / (intentEvals.length / 2);
        const secondHalf = intentEvals.slice(0, intentEvals.length / 2).reduce((s, e) => s + e.overall, 0) / (intentEvals.length / 2);
        if (secondHalf < firstHalf - 0.1) causes.push('Gradual decline over time — prompt may be stale');
      }
    }
    return causes;
  }

  private getRecommendation(cause: RootCause['primaryCause']): string {
    switch (cause) {
      case 'prompt_staleness':
        return 'Run prompt evolution: test new prompt variants against this intent type';
      case 'model_degradation':
        return 'Switch model tier or retry with different provider via Omninet fallback';
      case 'data_quality':
        return 'Review training/evaluation data sources for this intent type';
      case 'user_pattern_shift':
        return 'User query patterns have shifted — consider retraining intent classifier';
      default:
        return 'Monitor for additional data before recommending action';
    }
  }

  private computeVariance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  }

  private matchesIntent(evalEntry: EvalScores & Record<string, unknown>, intentType: string): boolean {
    try {
      const meta = JSON.parse((evalEntry as any).metadata_json || '{}');
      return meta.intentType === intentType;
    } catch { return false; }
  }

  private loadBaselines(): void {
    try {
      const db = getDb();
      const row = db.prepare("SELECT value FROM config WHERE key = 'perf_baselines'").get() as { value: string } | undefined;
      if (row) {
        const data = JSON.parse(row.value) as Array<[string, { accuracy: number; satisfaction: number; latency: number; sampledAt: number }]>;
        for (const [key, val] of data) {
          this.baselines.set(key, val);
        }
      }
    } catch { /* start empty */ }
  }

  private persistBaselines(): void {
    try {
      const db = getDb();
      const data = JSON.stringify(Array.from(this.baselines.entries()));
      db.prepare("INSERT INTO config (key, value) VALUES ('perf_baselines', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(data);
    } catch { /* skip */ }
  }
}

export const performanceAnalyzer = new PerformanceAnalyzer();
