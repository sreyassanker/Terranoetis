import { getDb } from '../db/index';
import { ensureReasoningTracesTable } from '../db/reasoningTraces';
import { logger } from '../observability/logger';

export interface ReasoningStep {
  type: 'thought' | 'tool_call' | 'tool_result' | 'observation' | 'inference' | 'conclusion';
  description: string;
  evidence?: string;
  confidence?: number;
  timestamp: number;
  durationMs?: number;
  parentStepId?: string;
  metadata?: Record<string, unknown>;
}

export interface ReasoningTrace {
  interactionId: string;
  userId: string;
  query: string;
  response: string;
  steps: ReasoningStep[];
  totalDurationMs: number;
  confidence: number;
  modelUsed: string;
  intentType: string;
  createdAt: number;
}

export class ReasoningVisualizer {
  private traces = new Map<string, ReasoningTrace>();
  private maxTraces = 1000;

  init(): void {
    this.ensureTables();
    logger.info('ReasoningVisualizer initialized');
  }

  /** Record a new reasoning trace for an interaction */
  recordTrace(trace: ReasoningTrace): void {
    this.traces.set(trace.interactionId, trace);
    if (this.traces.size > this.maxTraces) {
      const oldest = [...this.traces.keys()].sort()[0];
      if (oldest) this.traces.delete(oldest);
    }
    this.persistTrace(trace);
  }

  /** Add a step to an existing trace */
  addStep(interactionId: string, step: ReasoningStep): void {
    const trace = this.traces.get(interactionId);
    if (trace) {
      trace.steps.push(step);
      this.persistTrace(trace);
    }
  }

  /** Get trace by interaction ID */
  getTrace(interactionId: string): ReasoningTrace | null {
    return this.traces.get(interactionId) || this.loadTrace(interactionId);
  }

  /** Get recent traces for a user */
  getRecentTraces(userId: string, limit = 20): ReasoningTrace[] {
    try {
      const db = getDb();
      return db.prepare(
        'SELECT * FROM reasoning_traces WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      ).all(userId, limit).map(r => this.parseTraceRow(r as Record<string, unknown>)).filter(Boolean) as ReasoningTrace[];
    } catch { return []; }
  }

  /** Export trace as JSON */
  toJson(interactionId: string): string | null {
    const trace = this.getTrace(interactionId);
    return trace ? JSON.stringify(trace, null, 2) : null;
  }

  /** Export trace as Markdown */
  toMarkdown(interactionId: string): string | null {
    const trace = this.getTrace(interactionId);
    if (!trace) return null;

    const lines: string[] = [
      `# Reasoning Trace: ${trace.interactionId}`,
      `**Query:** ${trace.query}`,
      `**Model:** ${trace.modelUsed}  **Confidence:** ${(trace.confidence * 100).toFixed(0)}%`,
      `**Duration:** ${trace.totalDurationMs}ms  **Intent:** ${trace.intentType}`,
      '',
      '## Steps',
      '',
    ];

    for (const step of trace.steps) {
      const icon = this.stepIcon(step.type);
      const dur = step.durationMs ? ` (${step.durationMs}ms)` : '';
      lines.push(`### ${icon} ${step.type}${dur}`);
      lines.push(`**${step.description}**`);
      if (step.evidence) lines.push(`> ${step.evidence}`);
      if (step.confidence !== undefined) lines.push(`- Confidence: ${(step.confidence * 100).toFixed(0)}%`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /** Export trace as Mermaid graph */
  toMermaid(interactionId: string): string | null {
    const trace = this.getTrace(interactionId);
    if (!trace || trace.steps.length === 0) return null;

    const lines = ['graph TD;'];
    for (let i = 0; i < trace.steps.length; i++) {
      const step = trace.steps[i];
      const nodeId = `step${i}`;
      const label = `${step.type}: ${step.description.slice(0, 40)}`;
      lines.push(`  ${nodeId}["${label}"];`);
      if (step.parentStepId) {
        const parentIdx = trace.steps.findIndex(s =>
          `${s.type}_${s.timestamp}` === step.parentStepId,
        );
        if (parentIdx >= 0) {
          lines.push(`  step${parentIdx} --> ${nodeId};`);
        }
      }
    }

    return lines.join('\n');
  }

  /** Compute aggregate confidence for a set of traces */
  aggregateConfidence(traces: ReasoningTrace[]): number {
    if (traces.length === 0) return 0;
    return traces.reduce((sum, t) => sum + t.confidence, 0) / traces.length;
  }

  getStats() {
    try {
      const db = getDb();
      const count = (db.prepare('SELECT COUNT(*) as c FROM reasoning_traces').get() as { c: number }).c;
      return { totalTraces: count, cachedTraces: this.traces.size };
    } catch { return { totalTraces: 0, cachedTraces: this.traces.size }; }
  }

  private stepIcon(type: string): string {
    const icons: Record<string, string> = {
      thought: '💭', tool_call: '🔧', tool_result: '📊',
      observation: '👁️', inference: '🧠', conclusion: '✅',
    };
    return icons[type] || '•';
  }

  private persistTrace(trace: ReasoningTrace): void {
    try {
      const db = getDb();
      db.prepare(
        `INSERT OR REPLACE INTO reasoning_traces
         (trace_id, interaction_id, user_id, query, response, system_used, trace_json, steps_json,
          duration_ms, total_duration_ms, final_confidence, confidence, critic_score, iteration_count,
          needs_review, model_used, intent_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        trace.interactionId, trace.interactionId, trace.userId, trace.query, trace.response,
        trace.modelUsed, JSON.stringify(trace.steps), JSON.stringify(trace.steps),
        trace.totalDurationMs, trace.totalDurationMs, trace.confidence, trace.confidence,
        null, trace.steps.length, 0, trace.modelUsed, trace.intentType, trace.createdAt,
      );
    } catch { /* ignore */ }
  }

  private loadTrace(interactionId: string): ReasoningTrace | null {
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM reasoning_traces WHERE interaction_id = ?').get(interactionId) as Record<string, unknown> | undefined;
      return row ? this.parseTraceRow(row) : null;
    } catch { return null; }
  }

  private parseTraceRow(row: Record<string, unknown>): ReasoningTrace | null {
    if (!row) return null;
    try {
      return {
        interactionId: row.interaction_id as string,
        userId: row.user_id as string,
        query: row.query as string,
        response: row.response as string,
        steps: JSON.parse(row.steps_json as string || '[]'),
        totalDurationMs: row.total_duration_ms as number,
        confidence: row.confidence as number,
        modelUsed: row.model_used as string,
        intentType: row.intent_type as string,
        createdAt: row.created_at as unknown as number,
      };
    } catch { return null; }
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      ensureReasoningTracesTable(db);
    } catch { /* tables exist */ }
  }
}

export const reasoningVisualizer = new ReasoningVisualizer();
