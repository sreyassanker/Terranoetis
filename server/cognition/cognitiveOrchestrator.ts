import { getDb } from '../db/index';
import { ensureReasoningTracesTable } from '../db/reasoningTraces';
import { logger } from '../observability/logger';
import { system1, type System1Result } from './system1';
import { system2, type System2Result, type ReasoningStep } from './system2';
import { ExecutionOrchestrator, type FormattedTraceNode } from './executionOrchestrator';
import { MCTSEngine } from './mctsEngine';
import { TreeOfThoughts } from './treeOfThoughts';


// ── Types ───────────────────────────────────────────────────────

export type CognitionMode = 'system1_only' | 'system1_with_verification' | 'system2_full' | 'system2_timed_out';

export interface CognitionResult {
  finalOutput: string;
  mode: CognitionMode;
  system1Result: System1Result | null;
  system2Result: System2Result | null;
  criticScore: number | null;
  traceId: string | null;
  latencyMs: number;
  iterationCount: number;
  flagsForReview: boolean;
}

export interface CognitionTrace {
  traceId: string;
  query: string;
  systemUsed: string;
  traceJson: string;
  durationMs: number;
  finalConfidence: number | null;
  criticScore: number | null;
  iterationCount: number;
}

export type ProgressCallback = (event: string, data: Record<string, unknown>) => void;

// ── Timestamp ───────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function uuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── CognitiveOrchestrator ───────────────────────────────────────

export class CognitiveOrchestrator {
  private initialized = false;
  private executionOrchestrator: ExecutionOrchestrator | null = null;
  private llmRouter = {
    generateText: async (prompt: string, opts?: { temperature?: number; maxTokens?: number }) => {
      const { omninet } = await import('../ai-router/omninet');
      return omninet.generateText(prompt, opts || {});
    },
  };
  private toolRegistry = {
    executeTool: async (name: string, args: Record<string, unknown>) => {
      const { dynamicTools } = await import('../tools-v2/toolGenerator');
      return dynamicTools.execute(name, args) as unknown as { success: boolean; output: unknown };
    },
    listTools: () => {
      return ['earthquakes', 'weather', 'flights', 'sandbox', 'firms', 'eonet', 'tectonic',
        'cctv', 'space_debris', 'lightning', 'gdacs', 'vaac', 'submarine_cables',
        'electricity_grid', 'aurora', 'iss', 'openflights', 'adsb'];
    },
  };

  async init(): Promise<void> {
    if (this.initialized) return;
    await system1.init();
    this.ensureTables();
    this.executionOrchestrator = new ExecutionOrchestrator(
      null as unknown as MCTSEngine,
      null as unknown as TreeOfThoughts,
      this.llmRouter,
      this.toolRegistry,
    );
    this.initialized = true;
    logger.info('CognitiveOrchestrator initialized with MCTS/ToT');
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      ensureReasoningTracesTable(db);
    } catch { /* table exists */ }
  }

  async processQuery(
    query: string,
    context?: { location?: string; intent?: string },
    onProgress?: ProgressCallback,
  ): Promise<CognitionResult> {
    const start = Date.now();
    await this.ensureReady();

    // Phase 1: System 1 fast path
    onProgress?.('reasoning', { phase: 'system1', text: 'Checking fast intuition cache...' });
    const s1Result = await system1.classify(query);

    // Decision: which mode?
    const isHighConfidence = s1Result.match !== null && s1Result.match.similarity >= 0.92;
    const isMediumConfidence = s1Result.match !== null && s1Result.match.similarity >= 0.7 && s1Result.match.similarity < 0.92;

    if (isHighConfidence && !s1Result.isAnomaly) {
      onProgress?.('reasoning', { phase: 'system1', text: 'Fast match found (confidence > 0.92)' });

      const result: CognitionResult = {
        finalOutput: s1Result.match!.responseTemplate,
        mode: 'system1_only',
        system1Result: s1Result,
        system2Result: null,
        criticScore: null,
        traceId: null,
        latencyMs: Date.now() - start,
        iterationCount: 0,
        flagsForReview: false,
      };

      logger.info({ query: query.slice(0, 50), mode: 'system1_only', latency: result.latencyMs }, 'S1 fast path');
      return result;
    }

    // Phase 2: Determine if we need System 2
    const needsFullSystem2 = !s1Result.match || s1Result.isAnomaly || s1Result.match.similarity < 0.7;

    if (isMediumConfidence && !s1Result.isAnomaly) {
      // S1 response + S2 verification in parallel
      onProgress?.('reasoning', { phase: 'verification', text: 'Running deep verification in background...' });

      const s2Promise = this.runSystem2WithTimeout(query, context, 10000, onProgress);

      const s2Result = await s2Promise;

      const initialOutput = s1Result.match!.responseTemplate;

      if (s2Result.timeout) {
        // S2 took too long — return S1 response with indicator
        const result: CognitionResult = {
          finalOutput: `${initialOutput}\n\n---\n🤔 Thinking deeper... Analyzing relationships, running simulations, and cross-referencing data. Full results will appear shortly.`,
          mode: 'system1_with_verification',
          system1Result: s1Result,
          system2Result: s2Result.result,
          criticScore: null,
          traceId: null,
          latencyMs: Date.now() - start,
          iterationCount: 0,
          flagsForReview: false,
        };

        // Store the trace for later retrieval
        if (s2Result.result) {
          const traceId = await this.storeTrace(query, 'system2', s2Result.result.reasoningTrace, Date.now() - start, s2Result.result.finalConfidence, null, s2Result.result.reasoningTrace.length);
          result.traceId = traceId;
        }

        logger.info({ query: query.slice(0, 50), mode: 'system1_timeout', latency: result.latencyMs }, 'S1 with pending S2');
        return result;
      }

      if (!s2Result.result) {
        const result: CognitionResult = {
          finalOutput: initialOutput,
          mode: 'system1_only',
          system1Result: s1Result,
          system2Result: null,
          criticScore: null,
          traceId: null,
          latencyMs: Date.now() - start,
          iterationCount: 0,
          flagsForReview: false,
        };
        return result;
      }

      // S2 completed in time — verify and synthesize
      const { finalSynthesis, criticScore, iterations } = await system2.verifyAndRevise(
        s2Result.result.synthesis,
        query,
      );

      const traceId = await this.storeTrace(
        query, 'system1_with_verification', s2Result.result.reasoningTrace,
        Date.now() - start, s2Result.result.finalConfidence, criticScore, iterations,
      );

      const result: CognitionResult = {
        finalOutput: finalSynthesis,
        mode: 'system1_with_verification',
        system1Result: s1Result,
        system2Result: s2Result.result,
        criticScore,
        traceId,
        latencyMs: Date.now() - start,
        iterationCount: iterations,
        flagsForReview: criticScore < 0.7 && iterations >= 2,
      };

      logger.info({ query: query.slice(0, 50), mode: 'system1_verified', criticScore, latency: result.latencyMs }, 'S1+S2 verified');
      return result;
    }

    // Full System 2 reasoning
    onProgress?.('reasoning', { phase: 'system2', text: 'Running deep cognitive analysis...' });

    const s2FullResult = await this.runSystem2Full(query, context, onProgress);

    const { finalSynthesis, criticScore, iterations } = await system2.verifyAndRevise(
      s2FullResult.synthesis,
      query,
    );

    const traceId = await this.storeTrace(
      query, 'system2_full', s2FullResult.reasoningTrace,
      Date.now() - start, s2FullResult.finalConfidence, criticScore, iterations,
    );

    const result: CognitionResult = {
      finalOutput: finalSynthesis,
      mode: needsFullSystem2 ? 'system2_full' : 'system1_with_verification',
      system1Result: s1Result,
      system2Result: s2FullResult,
      criticScore,
      traceId,
      latencyMs: Date.now() - start,
      iterationCount: iterations,
      flagsForReview: criticScore < 0.7 && iterations >= 2,
    };

    if (result.flagsForReview) {
      logger.warn({ query: query.slice(0, 50), criticScore, traceId }, 'Response flagged for human review');
    }

    logger.info({ query: query.slice(0, 50), mode: result.mode, criticScore, latency: result.latencyMs }, 'Cognition complete');
    return result;
  }

  // ── System 2 with timeout ────────────────────────────────────

  private async runSystem2WithTimeout(
    query: string,
    context?: { location?: string; intent?: string },
    timeoutMs = 10000,
    onProgress?: ProgressCallback,
  ): Promise<{ result: System2Result | null; timeout: boolean }> {
    try {
      const result = await Promise.race([
        system2.plan(query, context),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);

      if (result === null) {
        // Background: continue S2 and store result for later push
        this.runSystem2Background(query, context, onProgress);
        return { result: null, timeout: true };
      }

      return { result, timeout: false };
    } catch {
      return { result: null, timeout: false };
    }
  }

  private async runSystem2Background(
    query: string,
    context?: { location?: string; intent?: string },
    onProgress?: ProgressCallback,
  ): Promise<void> {
    try {
      const fullResult = await system2.plan(query, context);
      const { finalSynthesis, criticScore } = await system2.verifyAndRevise(
        fullResult.synthesis,
        query,
      );

      const traceId = await this.storeTrace(
        query, 'system2_background', fullResult.reasoningTrace,
        0, fullResult.finalConfidence, criticScore, 2,
      );

      onProgress?.('system2_complete', {
        traceId,
        synthesis: finalSynthesis,
        confidence: fullResult.finalConfidence,
        criticScore,
      });

      logger.info({ query: query.slice(0, 50), traceId }, 'Background S2 complete — ready for push');
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Background S2 failed');
    }
  }

  // ── Full System 2 with MCTS/ToT ──────────────────────────────

  private async runSystem2Full(
    query: string,
    context?: { location?: string; intent?: string },
    onProgress?: ProgressCallback,
  ): Promise<System2Result> {
    const strategy = this.executionOrchestrator
      ? this.executionOrchestrator.selectStrategy(query)
      : 'tot';

    if (strategy === 'mcts' && this.executionOrchestrator) {
      onProgress?.('reasoning', { phase: 'mcts', text: 'Running MCTS deep search (multi-tool query)...' });
      try {
        const mctsResult = await this.executionOrchestrator.executeWithMCTS(
          query,
          { ...(context || {}), strategy: 'mcts' },
        );
        onProgress?.('reasoning', { phase: 'mcts', text: `MCTS complete: ${mctsResult.trace.length} steps explored` });

        return {
          plan: [],
          debate: null,
          causalGraph: null,
          counterfactuals: [],
          hypotheses: mctsResult.trace
            .filter(n => n.action.startsWith('HYPOTHESIS:'))
            .map((n, _i) => ({
              statement: n.action.replace('HYPOTHESIS:', '').trim(),
              probability: n.visits > 0 ? Math.round((n.value / n.visits) * 100) / 100 : 0.5,
              evidenceFor: [],
              evidenceAgainst: [],
              timeframe: 'current',
            })),
          reasoningTrace: mctsResult.trace.map((n, i) => ({
            step: i + 1,
            type: 'decomposition' as const,
            description: n.action,
            input: query,
            output: `value=${(n.visits > 0 ? n.value / n.visits : 0).toFixed(2)} visits=${n.visits}`,
            confidence: n.visits > 0 ? Math.min(1, n.value / n.visits) : 0.5,
          })),
          synthesis: mctsResult.result as string,
          finalConfidence: mctsResult.confidence,
        };
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'MCTS failed, falling back to System 2');
      }
    }

    if (strategy === 'tot' && this.executionOrchestrator) {
      onProgress?.('reasoning', { phase: 'tot', text: 'Running Tree-of-Thoughts reasoning (analytical query)...' });
      try {
        const totResult = await this.executionOrchestrator.executeWithToT(
          query,
          { ...(context || {}), strategy: 'tot' },
        );
        onProgress?.('reasoning', { phase: 'tot', text: `ToT complete: ${totResult.trace.length} reasoning steps` });

        return {
          plan: [],
          debate: null,
          causalGraph: null,
          counterfactuals: [],
          hypotheses: totResult.trace
            .filter(n => n.action.startsWith('HYPOTHESIS:'))
            .map((n, _i) => ({
              statement: n.action.replace('HYPOTHESIS:', '').trim(),
              probability: n.visits > 0 ? Math.round((n.value / n.visits) * 100) / 100 : 0.5,
              evidenceFor: [],
              evidenceAgainst: [],
              timeframe: 'current',
            })),
          reasoningTrace: totResult.trace.map((n, i) => ({
            step: i + 1,
            type: 'decomposition' as const,
            description: n.action,
            input: query,
            output: `confidence=${(n.visits > 0 ? n.value / n.visits : n.prior).toFixed(2)}`,
            confidence: n.visits > 0 ? Math.min(1, n.value / n.visits) : n.prior,
          })),
          synthesis: totResult.result as string,
          finalConfidence: totResult.confidence,
        };
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'ToT failed, falling back to System 2');
      }
    }

    onProgress?.('reasoning', { phase: 'system2', text: 'Running standard deep reasoning...' });
    return system2.plan(query, context);
  }

  // ── Trace Storage ─────────────────────────────────────────────

  private async storeTrace(
    query: string,
    systemUsed: string,
    steps: ReasoningStep[],
    durationMs: number,
    finalConfidence: number | null,
    criticScore: number | null,
    iterationCount: number,
  ): Promise<string> {
    const traceId = uuid();
    const needsReview = (criticScore !== null && criticScore < 0.7 && iterationCount >= 2) ? 1 : 0;

    try {
      const db = getDb();
      const visualSteps = steps.map((step, index) => ({
        type: this.toExplainabilityStepType(step.type),
        description: step.description || step.output || step.type,
        evidence: step.output || step.input,
        confidence: step.confidence,
        timestamp: Date.now() + index,
        metadata: {
          cognitiveType: step.type,
          input: step.input,
          output: step.output,
          step: step.step,
        },
      }));
      const confidence = finalConfidence ?? criticScore ?? 0;
      const traceJson = JSON.stringify(steps);
      const stepsJson = JSON.stringify(visualSteps);
      db.prepare(
        `INSERT OR REPLACE INTO reasoning_traces
         (trace_id, interaction_id, user_id, query, response, system_used, trace_json, steps_json,
          duration_ms, total_duration_ms, final_confidence, confidence, critic_score, iteration_count,
          needs_review, model_used, intent_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        traceId, traceId, 'system', query.slice(0, 500), '', systemUsed, traceJson, stepsJson,
        durationMs, durationMs, finalConfidence, confidence, criticScore, iterationCount,
        needsReview, systemUsed, systemUsed, now(),
      );
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Failed to store reasoning trace');
    }

    return traceId;
  }

  private toExplainabilityStepType(type: string): 'thought' | 'tool_call' | 'tool_result' | 'observation' | 'inference' | 'conclusion' {
    if (type === 'decomposition' || type === 'hypothesis') return 'thought';
    if (type === 'causal_analysis' || type === 'counterfactual') return 'inference';
    if (type === 'verification') return 'observation';
    if (type === 'synthesis' || type === 'debate') return 'conclusion';
    return 'inference';
  }

  // ── Trace Retrieval ───────────────────────────────────────────

  getTrace(traceId: string): CognitionTrace | null {
    try {
      const db = getDb();
      const row = db.prepare(
        'SELECT * FROM reasoning_traces WHERE trace_id = ?',
      ).get(traceId) as Record<string, unknown> | undefined;

      if (!row) return null;

      return {
        traceId: row.trace_id as string,
        query: row.query as string,
        systemUsed: row.system_used as string,
        traceJson: row.trace_json as string,
        durationMs: row.duration_ms as number,
        finalConfidence: row.final_confidence as number | null,
        criticScore: row.critic_score as number | null,
        iterationCount: row.iteration_count as number,
      };
    } catch {
      return null;
    }
  }

  getTracesForQuery(query: string, limit = 5): CognitionTrace[] {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM reasoning_traces WHERE query = ? ORDER BY created_at DESC LIMIT ?',
      ).all(query, limit) as Array<Record<string, unknown>>;

      return rows.map(row => ({
        traceId: row.trace_id as string,
        query: row.query as string,
        systemUsed: row.system_used as string,
        traceJson: row.trace_json as string,
        durationMs: row.duration_ms as number,
        finalConfidence: row.final_confidence as number | null,
        criticScore: row.critic_score as number | null,
        iterationCount: row.iteration_count as number,
      }));
    } catch {
      return [];
    }
  }

  getPendingReview(limit = 20): CognitionTrace[] {
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT * FROM reasoning_traces WHERE needs_review = 1 ORDER BY created_at DESC LIMIT ?',
      ).all(limit) as Array<Record<string, unknown>>;

      return rows.map(row => ({
        traceId: row.trace_id as string,
        query: row.query as string,
        systemUsed: row.system_used as string,
        traceJson: row.trace_json as string,
        durationMs: row.duration_ms as number,
        finalConfidence: row.final_confidence as number | null,
        criticScore: row.critic_score as number | null,
        iterationCount: row.iteration_count as number,
      }));
    } catch {
      return [];
    }
  }

  // ── MCTS/ToT Trace Visualization ─────────────────────────────

  getReasoningTree(traceId: string): { trace: FormattedTraceNode[]; summary: Record<string, unknown> } | null {
    const trace = this.getTrace(traceId);
    if (!trace) return null;

    try {
      const steps = JSON.parse(trace.traceJson) as ReasoningStep[];
      const nodes: FormattedTraceNode[] = steps.map((s, i) => ({
        id: `step_${i}`,
        action: s.description,
        depth: i,
        value: s.confidence,
        visits: 1,
        children: [],
      }));

      for (let i = 1; i < nodes.length; i++) {
        nodes[i - 1].children.push(nodes[i]);
      }

      const roots = nodes.length > 0 ? [nodes[0]] : [];

      return {
        trace: roots,
        summary: {
          query: trace.query,
          systemUsed: trace.systemUsed,
          durationMs: trace.durationMs,
          finalConfidence: trace.finalConfidence,
          criticScore: trace.criticScore,
          stepCount: steps.length,
        },
      };
    } catch {
      return null;
    }
  }

  getExecutionOrchestrator(): ExecutionOrchestrator | null {
    return this.executionOrchestrator;
  }

  private async ensureReady(): Promise<void> {
    if (!this.initialized) await this.init();
  }
}

export const cognitiveOrchestrator = new CognitiveOrchestrator();
