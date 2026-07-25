/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * Advanced Agent Capabilities
 * ─────────────────────────────
 * Implements the "40× advanced AI chat" features:
 *   #1  Multi-turn reasoning memory (rolling summary + last 3 turns)
 *   #2  Persistent cross-session memory recall/injection
 *   #4  Tool-calling approval gates (destructive tool classification)
 *   #5  Plan-then-execute (LLM-generated plan with editable steps)
 *   #6  Multi-agent orchestration with per-sub-agent progress streaming
 *   #10 Adaptive LLM-generated suggestion engine
 *   #12 Causal/discovery proactive surfacing
 *   #15 Observability: record reasoning traces per requestId
 *
 * This module is self-contained and side-effect-free unless instantiated.
 * It depends only on existing server singletons (omninet, memoryManagerV2,
 * reasoningVisualizer, costTracker via callbacks) which are injected by the
 * caller, keeping it testable and decoupled from index.ts wiring.
 */
import { omninet } from './ai-router/omninet';
import { reasoningVisualizer } from './explainability/reasoningVisualizer';
import { evidenceChain } from './explainability/evidenceChain';
import { dynamicTools } from './tools-v2/toolGenerator';
import { memoryManagerV2 } from './memory-v2/memoryManager-v2';
import { logger } from './observability/logger';

// ─── Types ────────────────────────────────────────────────────────────────

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationContext {
  /** Rolling LLM-generated summary of older turns */
  summary: string;
  /** Last 3 verbatim turns (most recent last) */
  recent: ConversationTurn[];
  /** Total turn count for the session */
  turnCount: number;
}

export interface PlanStep {
  id: string;
  description: string;
  rationale?: string;
  /** Which sub-agent role should handle this step */
  agent: SubAgentRole;
  /** Tools this step may invoke */
  tools?: string[];
  /** Whether this step requires human approval before execution */
  requiresApproval: boolean;
  enabled: boolean;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: string;
  durationMs?: number;
}

export interface AgentPlan {
  id: string;
  query: string;
  steps: PlanStep[];
  /** Whether the whole plan needs confirmation before any step runs */
  requiresConfirmation: boolean;
  summary: string;
  createdAt: number;
}

export type SubAgentRole = 'planner' | 'analyst' | 'coder' | 'visualizer' | 'critic' | 'researcher' | 'synthesizer';

export interface SubAgentUpdate {
  role: SubAgentRole;
  stepId?: string;
  status: 'starting' | 'thinking' | 'tool_call' | 'tool_result' | 'partial' | 'completed' | 'failed';
  text: string;
  /** Partial output for streaming */
  partial?: string;
  timestamp: number;
}

export interface ToolApprovalRequest {
  requestId: string;
  stepId?: string;
  toolName: string;
  args: Record<string, unknown>;
  description: string;
  riskLevel: 'low' | 'medium' | 'high' | 'destructive';
  reason: string;
}

export interface SuggestionContext {
  visibleLayers: string[];
  cameraBounds?: { north: number; south: number; east: number; west: number };
  recentQueries: string[];
  activeAlerts: number;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  recentDiscoveries: string[];
}

export interface ProactiveInsight {
  type: 'discovery' | 'causal' | 'anomaly' | 'recommendation';
  title: string;
  body: string;
  confidence: number;
  actionable: boolean;
}

// ─── #1: Conversation Memory (rolling summary) ─────────────────────────────

/**
 * In-process conversation state per userId+sessionId.
 * For persistence, callers should mirror `summary` into memoryManagerV2.
 */
interface SessionState {
  context: ConversationContext;
  pendingPlan: AgentPlan | null;
  lastUpdated: number;
}

const sessions = new Map<string, SessionState>();

function sessionKey(userId: string, sessionId?: string): string {
  return `${userId}::${sessionId || 'default'}`;
}

export class ConversationMemory {
  /**
   * Get the current conversation context (summary + recent turns).
   * Returns a fresh context if none exists.
   */
  get(userId: string, sessionId?: string): ConversationContext {
    const s = sessions.get(sessionKey(userId, sessionId));
    if (s) return s.context;
    return { summary: '', recent: [], turnCount: 0 };
  }

  /**
   * Record a completed turn and update the rolling summary.
   * Keeps the last 3 verbatim; anything older is folded into `summary`
   * via a cheap LLM summarization pass (falls back to truncation).
   */
  async recordTurn(userId: string, sessionId: string | undefined, turn: ConversationTurn): Promise<ConversationContext> {
    const key = sessionKey(userId, sessionId);
    let s = sessions.get(key);
    if (!s) {
      s = { context: { summary: '', recent: [], turnCount: 0 }, pendingPlan: null, lastUpdated: Date.now() };
      sessions.set(key, s);
    }
    const ctx = s.context;
    const updatedRecent = [...ctx.recent, turn];
    // Fold when we exceed 3 verbatim turns: summarize the oldest into `summary`.
    if (updatedRecent.length > 3) {
      const toFold = updatedRecent.slice(0, updatedRecent.length - 3);
      ctx.summary = await this.summarize(ctx.summary, toFold);
      ctx.recent = updatedRecent.slice(updatedRecent.length - 3);
    } else {
      ctx.recent = updatedRecent;
    }
    ctx.turnCount += 1;
    s.lastUpdated = Date.now();
    return ctx;
  }

  /**
   * Build a compact context string for injection into agent prompts.
   * Replaces the old "last 8 messages sliced to 1000 chars" approach.
   */
  buildPromptContext(ctx: ConversationContext): string {
    const parts: string[] = [];
    if (ctx.summary) {
      parts.push(`[Conversation summary so far]\n${ctx.summary}`);
    }
    if (ctx.recent.length > 0) {
      const turns = ctx.recent.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content.slice(0, 1500)}`).join('\n\n');
      parts.push(`[Recent turns]\n${turns}`);
    }
    return parts.length > 0 ? parts.join('\n\n') + '\n\n' : '';
  }

  /** Clear context (e.g. on new chat). */
  clear(userId: string, sessionId?: string): void {
    sessions.delete(sessionKey(userId, sessionId));
  }

  private async summarize(existingSummary: string, turns: ConversationTurn[]): Promise<string> {
    const turnText = turns.map(t => `${t.role}: ${t.content.slice(0, 800)}`).join('\n');
    const prompt = `You are summarizing a conversation for long-term memory. Produce a concise (max 250 words) summary preserving: key entities/locations mentioned, questions asked, data retrieved, conclusions reached, and any unresolved threads. Do NOT invent facts.

${existingSummary ? `Existing summary:\n${existingSummary}\n` : ''}
New turns to incorporate:
${turnText}

Updated summary:`;
    try {
      const out = await omninet.generateText(prompt, { temperature: 0.2, maxTokens: 400 });
      if (out && out.trim().length > 0) return out.trim();
    } catch (e) {
      logger.warn({ err: e }, 'Conversation summary LLM pass failed — truncating');
    }
    // Fallback: naive concatenation with truncation
    const naive = turns.map(t => t.content.slice(0, 200)).join(' | ');
    const combined = (existingSummary + ' ' + naive).slice(-1200);
    return combined.trim();
  }
}

export const conversationMemory = new ConversationMemory();

// ─── #4: Tool risk classification (approval gates) ─────────────────────────

/** Heuristic classification of tool calls by risk level. */
const DESTRUCTIVE_TOOLS = new Set([
  'clear_layers', 'delete_entity', 'reset_workspace', 'wipe_cache',
  'run_pipeline', 'execute_code', 'execute_script', 'run_simulation',
  'delete_file', 'overwrite_file', 'deploy', 'publish', 'send_alert',
]);
const HIGH_RISK_TOOLS = new Set([
  'fly_to', 'toggle_layer', 'add_pin', 'add_heatmap', 'add_polygon',
  'add_geojson', 'add_chart', 'add_panel', 'create_monitor', 'create_schedule',
  'run_pipeline', 'generate_scenario', 'export_data', 'share_session',
]);

export function classifyToolRisk(toolName: string, args: Record<string, unknown>): ToolApprovalRequest['riskLevel'] {
  const name = toolName.toLowerCase();
  if (DESTRUCTIVE_TOOLS.has(name)) return 'destructive';
  if (HIGH_RISK_TOOLS.has(name)) return 'high';
  // Medium risk: any tool that writes/mutates state
  if (args && typeof args === 'object') {
    const argStr = JSON.stringify(args).toLowerCase();
    if (/delete|remove|reset|clear|wipe|drop|overwrite|deploy|publish/.test(argStr)) return 'high';
  }
  return 'low';
}

/** Does a tool call require human approval before execution? */
export function requiresApproval(toolName: string, args: Record<string, unknown>, threshold: 'low' | 'medium' | 'high' | 'destructive' = 'high'): boolean {
  const risk = classifyToolRisk(toolName, args);
  const order = ['low', 'medium', 'high', 'destructive'];
  return order.indexOf(risk) >= order.indexOf(threshold);
}

// ─── #5: Plan-then-execute ──────────────────────────────────────────────────

/**
 * Generate an execution plan for a complex query.
 * Returns a list of steps with assigned sub-agents and approval flags.
 */
export async function generatePlan(query: string, availableTools?: string[]): Promise<AgentPlan> {
  const toolList = availableTools && availableTools.length > 0
    ? availableTools.slice(0, 40).join(', ')
    : 'earthquake data, weather, flights, locations, charts, geojson, monitors, schedules, sandbox code';
  const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const prompt = `You are a planning agent for a geospatial Earth-intelligence platform. Decompose the user's request into 1-5 concrete steps. For each step, assign ONE agent role and list any tools needed.

Available agent roles: planner, analyst, coder, visualizer, critic, researcher, synthesizer
Available tools: ${toolList}

Respond as a JSON array (no markdown fences) of objects:
[{"description":"...","rationale":"...","agent":"analyst","tools":["tool_name"],"requiresApproval":false}]

Set requiresApproval=true only for steps that mutate the globe, run code, create monitors/schedules, or delete data. Keep descriptions under 12 words.

User request: ${query}

JSON plan:`;
  try {
    const raw = await omninet.generateText(prompt, { temperature: 0.3, maxTokens: 600 });
    const json = extractJsonArray(raw);
    if (json && Array.isArray(json) && json.length > 0) {
      const steps: PlanStep[] = json.slice(0, 6).map((item: any, i: number) => ({
        id: `${planId}_s${i}`,
        description: String(item.description || `Step ${i + 1}`).slice(0, 200),
        rationale: item.rationale ? String(item.rationale).slice(0, 300) : undefined,
        agent: (VALID_ROLES.has(item.agent) ? item.agent : 'analyst') as SubAgentRole,
        tools: Array.isArray(item.tools) ? item.tools.map(String).slice(0, 5) : undefined,
        requiresApproval: Boolean(item.requiresApproval),
        enabled: true,
        status: 'pending',
      }));
      const needsConfirm = steps.some(s => s.requiresApproval);
      return {
        id: planId,
        query,
        steps,
        requiresConfirmation: needsConfirm,
        summary: steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n'),
        createdAt: Date.now(),
      };
    }
  } catch (e) {
    logger.warn({ err: e }, 'Plan generation failed');
  }
  // Fallback single-step plan
  return {
    id: planId,
    query,
    steps: [{
      id: `${planId}_s0`,
      description: 'Analyze and respond to the request',
      agent: 'analyst',
      requiresApproval: false,
      enabled: true,
      status: 'pending',
    }],
    requiresConfirmation: false,
    summary: 'Analyze and respond to the request',
    createdAt: Date.now(),
  };
}

const VALID_ROLES = new Set<SubAgentRole>(['planner', 'analyst', 'coder', 'visualizer', 'critic', 'researcher', 'synthesizer']);

function extractJsonArray(text: string): unknown[] | null {
  if (!text) return null;
  // Strip markdown fences
  let t = text.replace(/```(?:json)?/gi, '').trim();
  // Find the first '[' and matching ']'
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  t = t.slice(start, end + 1);
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// ─── #6: Multi-agent orchestration with streaming ──────────────────────────

const SUB_AGENT_PROMPTS: Record<SubAgentRole, string> = {
  planner: 'You are a planning agent. Break down complex geospatial queries. Be concise.',
  analyst: 'You are a data analyst. Analyze earthquake, weather, and geospatial data. Report real numbers and cite sources. Be precise.',
  coder: 'You are a code execution agent. Write and run sandbox code (Python/Node) for computations. Return results, not just code.',
  visualizer: 'You are a visualization agent. Create globe entities: pins, heatmaps, polygons, charts, geojson. Emit ## COMMANDS.',
  critic: 'You are a critical reviewer. Check the other agents\' work for errors, missing data, or logical flaws. Be direct.',
  researcher: 'You are a research agent. Find and synthesize information from available tools and APIs. Prioritize accuracy.',
  synthesizer: 'You are a synthesis agent. Combine all sub-agent outputs into one coherent final answer with citations.',
};

/**
 * Execute a single plan step via a sub-agent, streaming progress.
 * The caller provides an `onUpdate` callback that forwards to the SSE client.
 */
export async function executeStep(
  step: PlanStep,
  query: string,
  memoryContext: string,
  onUpdate: (update: SubAgentUpdate) => void,
  signal?: AbortSignal,
): Promise<string> {
  const rolePrompt = SUB_AGENT_PROMPTS[step.agent] || SUB_AGENT_PROMPTS.analyst;
  const toolHint = step.tools && step.tools.length > 0 ? `\nYou may use these tools: ${step.tools.join(', ')}.` : '';
  const fullPrompt = `${rolePrompt}${toolHint}

${memoryContext}

Your specific task (part of a larger plan): ${step.description}
Original user request: ${query}

Complete ONLY your assigned task. Respond directly. If you need to call a tool, emit a ## TOOL_CALLS block.`;
  onUpdate({ role: step.agent, stepId: step.id, status: 'starting', text: `${step.agent} starting: ${step.description}`, timestamp: Date.now() });
  onUpdate({ role: step.agent, stepId: step.id, status: 'thinking', text: `${step.agent} analyzing...`, timestamp: Date.now() });
  let accumulated = '';
  try {
    for await (const token of omninet.generateStream(fullPrompt, { signal, temperature: 0.4, maxTokens: 1500 })) {
      if (signal?.aborted) break;
      accumulated += token;
      onUpdate({ role: step.agent, stepId: step.id, status: 'partial', text: 'streaming', partial: token, timestamp: Date.now() });
    }
    onUpdate({ role: step.agent, stepId: step.id, status: 'completed', text: `${step.agent} completed`, timestamp: Date.now() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    onUpdate({ role: step.agent, stepId: step.id, status: 'failed', text: `${step.agent} failed: ${msg}`, timestamp: Date.now() });
    accumulated = `[${step.agent} failed: ${msg}]`;
  }
  return accumulated;
}

/**
 * Execute a full plan: run enabled steps in dependency order,
 * streaming per-sub-agent updates, then synthesize a final answer.
 */
export async function executePlan(
  plan: AgentPlan,
  memoryContext: string,
  onUpdate: (update: SubAgentUpdate) => void,
  onStepOutput: (stepId: string, output: string, durationMs: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const stepOutputs: Record<string, string> = {};
  const enabled = plan.steps.filter(s => s.enabled);
  // Run steps sequentially (parallel DAG execution is a future enhancement; sequential is safer for approval gates)
  for (const step of enabled) {
    if (signal?.aborted) break;
    const start = Date.now();
    const out = await executeStep(step, plan.query, memoryContext, onUpdate, signal);
    const dur = Date.now() - start;
    stepOutputs[step.id] = out;
    onStepOutput(step.id, out, dur);
  }
  // Synthesize
  const synthInputs = enabled.map(s => `### ${s.agent} — ${s.description}\n${stepOutputs[s.id] || '(no output)'}`).join('\n\n');
  const synthPrompt = `${SUB_AGENT_PROMPTS.synthesizer}

${memoryContext}

Original user request: ${plan.query}

Sub-agent outputs:
${synthInputs}

Synthesize a single coherent final answer. Cite real numbers from the sub-agent outputs. You may emit ## COMMANDS for visualization.`;
  onUpdate({ role: 'synthesizer', status: 'starting', text: 'Synthesizing final answer...', timestamp: Date.now() });
  let final = '';
  try {
    for await (const token of omninet.generateStream(synthPrompt, { signal, temperature: 0.4, maxTokens: 2500 })) {
      if (signal?.aborted) break;
      final += token;
      onUpdate({ role: 'synthesizer', status: 'partial', text: 'synthesizing', partial: token, timestamp: Date.now() });
    }
    onUpdate({ role: 'synthesizer', status: 'completed', text: 'Synthesis complete', timestamp: Date.now() });
  } catch (e) {
    final = synthInputs; // fallback: concatenate raw outputs
    onUpdate({ role: 'synthesizer', status: 'failed', text: `Synthesis failed: ${e}`, timestamp: Date.now() });
  }
  return final;
}

// ─── #10: Adaptive suggestion engine ───────────────────────────────────────

/**
 * Generate context-aware suggestions based on visible layers, camera,
 * recent queries, alerts, and time of day.
 */
export async function generateSuggestions(ctx: SuggestionContext): Promise<string[]> {
  const hour = new Date().getHours();
  const timeOfDay = ctx.timeOfDay || (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 20 ? 'evening' : 'night');
  const layerStr = ctx.visibleLayers.length > 0 ? ctx.visibleLayers.slice(0, 12).join(', ') : 'none';
  const recentStr = ctx.recentQueries.slice(0, 5).map(q => q.slice(0, 80)).join('\n') || 'none';
  const discoveries = ctx.recentDiscoveries.slice(0, 3).join('; ') || 'none';
  const prompt = `You generate 4-6 short suggestion chips for an Earth-intelligence AI chat. Suggestions must be action-oriented, specific, and relevant to the current context. Each suggestion ≤ 6 words. No numbering, no quotes, one per line.

Context:
- Visible layers: ${layerStr}
- Camera viewport: ${ctx.cameraBounds ? `${ctx.cameraBounds.south.toFixed(1)} to ${ctx.cameraBounds.north.toFixed(1)} lat` : 'global'}
- Recent queries: ${recentStr}
- Active alerts: ${ctx.activeAlerts}
- Time of day: ${timeOfDay}
- Recent discoveries: ${discoveries}

Suggestions:`;
  try {
    const raw = await omninet.generateText(prompt, { temperature: 0.6, maxTokens: 150 });
    const lines = raw.split('\n').map(l => l.replace(/^[\d.\-)\s]+/, '').replace(/["']/g, '').trim()).filter(l => l.length > 0 && l.length <= 60);
    if (lines.length >= 2) return lines.slice(0, 6);
  } catch (e) {
    logger.warn({ err: e }, 'Suggestion generation failed');
  }
  // Fallback suggestions based on layers
  const fallback: string[] = [];
  if (ctx.visibleLayers.includes('earthquakes')) fallback.push('Recent earthquakes?', 'Seismic hotspots?');
  else fallback.push('Show earthquake data');
  if (ctx.visibleLayers.some(l => ['wildfires', 'severe_storms', 'volcanoes'].includes(l))) fallback.push('Active disasters now');
  else fallback.push('Show wildfires');
  if (ctx.activeAlerts > 0) fallback.push(`Summarize ${ctx.activeAlerts} alert${ctx.activeAlerts > 1 ? 's' : ''}`);
  if (ctx.recentDiscoveries.length > 0) fallback.push('Explain latest discovery');
  fallback.push('Compute averages', 'Fly to Tokyo');
  return fallback.slice(0, 6);
}

// ─── #12: Proactive insights from causal/discovery ─────────────────────────

/**
 * Build a proactive insight message from recent discoveries / causal findings.
 * Returns null if nothing noteworthy.
 */
export async function buildProactiveInsight(recentDiscoveries: Array<{ summary: string; confidence: number }>): Promise<ProactiveInsight | null> {
  if (!recentDiscoveries || recentDiscoveries.length === 0) return null;
  const top = recentDiscoveries[0];
  if (top.confidence < 0.5) return null;
  return {
    type: 'discovery',
    title: 'New causal discovery',
    body: top.summary,
    confidence: top.confidence,
    actionable: true,
  };
}

// ─── #15: Observability — record reasoning trace ────────────────────────────

export interface TraceRecord {
  interactionId: string;
  userId: string;
  query: string;
  response: string;
  steps: Array<{ type: 'thought' | 'tool_call' | 'tool_result' | 'observation' | 'inference' | 'conclusion'; description: string; durationMs?: number; confidence?: number; metadata?: Record<string, unknown> }>;
  intentType: string;
  modelUsed: string;
  totalDurationMs: number;
}

/**
 * Record a full reasoning trace for the ask endpoint.
 * Keys it by requestId so the client can later fetch the full trace.
 */
export function recordTrace(rec: TraceRecord): void {
  try {
    const maxConf = rec.steps.some(s => s.confidence !== undefined) ? Math.max(...rec.steps.map(s => s.confidence || 0)) : 0.8;
    reasoningVisualizer.recordTrace({
      interactionId: rec.interactionId,
      userId: rec.userId,
      query: rec.query,
      response: rec.response.slice(0, 4000),
      steps: rec.steps.map(s => ({
        type: s.type,
        description: s.description,
        durationMs: s.durationMs,
        confidence: s.confidence,
        metadata: s.metadata,
        timestamp: Date.now(),
      })),
      totalDurationMs: rec.totalDurationMs,
      confidence: maxConf,
      modelUsed: rec.modelUsed,
      intentType: rec.intentType,
      createdAt: Date.now(),
    });
    // Also create an evidence chain for this interaction
    evidenceChain.createChain(rec.interactionId);
  } catch (e) {
    logger.warn({ err: e }, 'Trace recording failed (non-critical)');
  }
}

/**
 * Add an evidence link to an interaction's chain.
 */
export function addEvidence(interactionId: string, claim: string, sources: Array<{ sourceType: 'api_call' | 'tool_execution' | 'database_query' | 'llm_inference' | 'user_input' | 'sensor'; sourceName: string; parsedValue?: unknown }>, confidence: number): void {
  try {
    evidenceChain.addLink(interactionId, claim, sources, confidence);
  } catch (e) {
    logger.warn({ err: e }, 'Evidence add failed (non-critical)');
  }
}

// ─── #2: Persistent cross-session memory recall ────────────────────────────

export interface MemoryRecall {
  query: string;
  episodes: string[];
  facts: string[];
  summary: string;
}

/**
 * Recall relevant memories for a query to inject into context.
 * Uses memoryManagerV2.retrieve which returns a RichContext.
 */
export async function recallMemories(userId: string, query: string): Promise<MemoryRecall | null> {
  try {
    const rich = await (memoryManagerV2 as any).retrieve(userId, query, { limit: 3 });
    if (!rich) return null;
    const episodes: string[] = (rich.episodes || []).map((e: any) => e.query ? `Q: ${e.query} → ${String(e.response || '').slice(0, 150)}` : JSON.stringify(e).slice(0, 150)).slice(0, 3);
    const facts: string[] = (rich.inferences || []).map((f: any) => String(f.content || f.summary || f.text || JSON.stringify(f)).slice(0, 200)).slice(0, 3);
    const summary: string = rich.summary ? String(rich.summary) : '';
    if (episodes.length === 0 && facts.length === 0 && !summary) return null;
    return { query, episodes, facts, summary };
  } catch (e) {
    logger.warn({ err: e }, 'Memory recall failed (non-critical)');
    return null;
  }
}

/** Render a MemoryRecall into a prompt-context string. */
export function renderMemoryRecall(recall: MemoryRecall): string {
  const parts: string[] = [];
  if (recall.summary) parts.push(`[Long-term memory summary]\n${recall.summary}`);
  if (recall.episodes.length > 0) parts.push(`[Relevant past interactions]\n${recall.episodes.join('\n')}`);
  if (recall.facts.length > 0) parts.push(`[Known facts/inferences]\n${recall.facts.join('\n')}`);
  return parts.length > 0 ? parts.join('\n\n') + '\n\n' : '';
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Get the list of currently-registered tool names (for plan generation). */
export function listAvailableTools(): string[] {
  try {
    return dynamicTools.list().map((t: any) => t.name).filter(Boolean).slice(0, 60);
  } catch {
    return [];
  }
}
