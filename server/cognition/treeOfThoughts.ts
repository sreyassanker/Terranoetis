import { ReasoningTree, type ReasoningNode, type ReasoningState } from './reasoningTree';
import { logger } from '../observability/logger';

export interface ToTConfig {
  beamWidth: number;
  maxDepth: number;
  pruneThreshold: number;
  /** Wall-clock budget (ms). The search stops expanding when exceeded — ToT
   *  must never hang the chat. Defaults to 35s; the caller can tighten it. */
  timeoutMs: number;
  /** Max LLM calls allowed across the whole search (another anti-hang cap). */
  maxLlmCalls: number;
}

const DEFAULT_CONFIG: ToTConfig = {
  beamWidth: 3,
  maxDepth: 6,
  pruneThreshold: 0.3,
  timeoutMs: 35000,
  maxLlmCalls: 40,
};

interface LLMRouter {
  generateText: (prompt: string, opts?: { temperature?: number; maxTokens?: number }) => Promise<string>;
}

interface ToolRegistry {
  executeTool: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; output: unknown }>;
  listTools: () => string[];
}

export interface ToTSolveResult {
  path: ReasoningNode[];
  answer: string;
  confidence: number;
}

export class TreeOfThoughts {
  private llmRouter: LLMRouter;
  private toolRegistry: ToolRegistry;
  private config: ToTConfig;

  constructor(llmRouter: LLMRouter, toolRegistry: ToolRegistry, cfg?: Partial<ToTConfig>) {
    this.llmRouter = llmRouter;
    this.toolRegistry = toolRegistry;
    this.config = { ...DEFAULT_CONFIG, ...cfg };
  }

  async generateThoughts(state: ReasoningState, k: number): Promise<string[]> {
    const thoughts: string[] = [];
    const tools = this.toolRegistry.listTools();
    const temperatures = [0.5, 0.7, 0.9, 1.0, 1.2];

    for (let i = 0; i < k; i++) {
      const temp = temperatures[i % temperatures.length];
      const prompt = `You are generating diverse reasoning thoughts for Earth Intelligence.

Current query: "${state.query}"
Tools available: ${tools.join(', ')}
Previous actions: ${state.toolsCalled.join(' -> ') || 'none'}
Results so far: ${JSON.stringify(state.results).slice(0, 300)}
Confidence: ${state.confidence}

Generate a specific, actionable next thought. Be creative and diverse.
The thought should be one of:
1. "TOOL: <toolName> with <args>" — call a specific tool
2. "HYPOTHESIS: <statement>" — form a testable hypothesis
3. "ANALYZE: <approach>" — analyze existing results
4. "QUERY: <question>" — ask for more data

Return ONLY a single line starting with TOOL:, HYPOTHESIS:, ANALYZE:, or QUERY:`;

      try {
        const raw = await this.llmRouter.generateText(prompt, { temperature: temp, maxTokens: 256 });
        const line = raw.trim().split('\n')[0].trim();
        if (line) thoughts.push(line);
      } catch {
        thoughts.push(`FALLBACK: explore_alternative_${i}`);
      }
    }

    return thoughts;
  }

  async evaluateThought(state: ReasoningState, thought: string): Promise<number> {
    const prompt = `You are a thought evaluator for Tree-of-Thoughts reasoning. Rate the quality of this thought.

Query: "${state.query}"
Thought: "${thought}"
Previous confidence: ${state.confidence}
Tools called: ${state.toolsCalled.join(', ') || 'none'}

Rate this thought 0.0 to 1.0 on:
- Relevance to the query
- Potential for new information gain
- Feasibility with available tools
- Diversity from previous thoughts

Return ONLY a number between 0 and 1.`;

    try {
      const raw = await this.llmRouter.generateText(prompt, { temperature: 0.1, maxTokens: 64 });
      const numMatch = raw.match(/(\d+\.?\d*)/);
      if (numMatch) {
        return Math.max(0, Math.min(1, parseFloat(numMatch[1])));
      }
    } catch {
      // fallback
    }

    return 0.5;
  }

  async search(rootQuery: string, context: Record<string, unknown>): Promise<ReasoningNode[]> {
    const tree = new ReasoningTree(rootQuery, context);

    let currentLayer: ReasoningNode[] = [tree.getRoot()];
    let depth = 0;
    const start = Date.now();
    let llmCalls = 0;

    const overBudget = () => {
      const elapsed = Date.now() - start;
      if (elapsed >= this.config.timeoutMs) {
        logger.warn({ elapsed, maxDepth: depth }, 'ToT wall-clock budget exhausted — stopping search');
        return true;
      }
      if (llmCalls >= this.config.maxLlmCalls) {
        logger.warn({ llmCalls, maxLlmCalls: this.config.maxLlmCalls }, 'ToT LLM-call budget exhausted — stopping search');
        return true;
      }
      return false;
    };

    while (depth < this.config.maxDepth && currentLayer.length > 0 && !overBudget()) {
      logger.info({ depth, nodeCount: currentLayer.length }, 'ToT search layer');

      const nextCandidates: ReasoningNode[] = [];

      for (const node of currentLayer) {
        if (overBudget()) break;
        if (node.state.status === 'complete') {
          nextCandidates.push(node);
          continue;
        }

        const k = Math.min(3, this.config.beamWidth);
        const thoughts = await this.generateThoughts(node.state, k);
        llmCalls += thoughts.length;

        for (const thought of thoughts) {
          const state: ReasoningState = {
            query: node.state.query,
            context: { ...node.state.context },
            toolsCalled: [...node.state.toolsCalled, thought],
            results: [...node.state.results],
            hypotheses: [...node.state.hypotheses],
            confidence: node.state.confidence,
            status: 'active',
          };

          const childId = tree.addNode(node.id, thought, state);
          const child = tree.getNode(childId);
          if (child) {
            const score = await this.evaluateThought(node.state, thought);
            llmCalls++;
            child.value = score;
            child.visits = 1;
            child.prior = score;
            nextCandidates.push(child);
          }
        }
      }

      if (nextCandidates.length === 0) break;
      currentLayer = this.pruneLayer(nextCandidates, this.config.pruneThreshold);
      depth++;
    }

    return tree.getBestPath();
  }

  pruneLayer(nodes: ReasoningNode[], threshold: number): ReasoningNode[] {
    const scored = nodes
      .map(n => ({ node: n, score: n.visits > 0 ? n.value / n.visits : n.prior }))
      .sort((a, b) => b.score - a.score);

    const aboveThreshold = scored.filter(s => s.score >= threshold);
    const kept = aboveThreshold.length > 0 ? aboveThreshold : scored.slice(0, 1);

    return kept.slice(0, this.config.beamWidth).map(s => s.node);
  }

  async solve(rootQuery: string, context?: Record<string, unknown>): Promise<ToTSolveResult> {
    const ctx = context || {};
    logger.info({ query: rootQuery }, 'ToT solve started');

    const path = await this.search(rootQuery, ctx);

    const lastNode = path[path.length - 1];
    const answer = lastNode?.action || 'No answer found';
    const confidence = lastNode
      ? lastNode.visits > 0
        ? lastNode.value / lastNode.visits
        : lastNode.prior
      : 0;

    const synthesisPrompt = `Synthesize the following reasoning path into a concise answer.

Query: "${rootQuery}"
Reasoning trace:
${path.map((n, i) => `  Step ${i}: ${n.action}`).join('\n')}

Provide a final answer synthesizing all reasoning steps.`;

    let finalAnswer = answer;
    let synthesisFailed = false;
    try {
      finalAnswer = await this.llmRouter.generateText(synthesisPrompt, { temperature: 0.2, maxTokens: 1024 });
    } catch {
      synthesisFailed = true;
      finalAnswer = '';
    }

    // Detect when all thoughts are fallbacks (LLM calls all failed)
    const hasOnlyFallbacks = path.length > 0 &&
      path.every(n => n.action.startsWith('FALLBACK:') || n.action === 'root');

    const effectiveConfidence = (hasOnlyFallbacks || synthesisFailed || !finalAnswer) ? 0 : confidence;

    logger.info({ pathLength: path.length, confidence: effectiveConfidence, synthesisFailed, hasOnlyFallbacks }, 'ToT solve complete');
    return { path, answer: finalAnswer, confidence: effectiveConfidence };
  }
}
