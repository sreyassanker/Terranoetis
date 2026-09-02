import { MCTSEngine } from './mctsEngine';
import { TreeOfThoughts } from './treeOfThoughts';
import { ReasoningTree, type ReasoningNode } from './reasoningTree';
import { logger } from '../observability/logger';

export interface ExecutionConfig {
  maxParallel: number;
  timeoutMs: number;
  backtrackThreshold: number;
}

const DEFAULT_EXEC_CONFIG: ExecutionConfig = {
  maxParallel: 3,
  timeoutMs: 30000,
  backtrackThreshold: 0.3,
};

export interface ExecutionResult {
  result: unknown;
  trace: ReasoningNode[];
  confidence: number;
  method: 'mcts' | 'tot';
}

export interface FormattedTraceNode {
  id: string;
  action: string;
  depth: number;
  value: number;
  visits: number;
  children: FormattedTraceNode[];
}

interface LLMRouter {
  generateText: (prompt: string, opts?: { temperature?: number; maxTokens?: number }) => Promise<string>;
}

interface ToolRegistry {
  executeTool: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; output: unknown }>;
  listTools: () => string[];
}

export class ExecutionOrchestrator {
  private mcts: MCTSEngine;
  private tot: TreeOfThoughts;
  private config: ExecutionConfig;
  private llmRouter: LLMRouter;
  private toolRegistry: ToolRegistry;

  constructor(
    mcts: MCTSEngine,
    tot: TreeOfThoughts,
    llmRouter: LLMRouter,
    toolRegistry: ToolRegistry,
    cfg?: Partial<ExecutionConfig>,
  ) {
    this.mcts = mcts;
    this.tot = tot;
    this.llmRouter = llmRouter;
    this.toolRegistry = toolRegistry;
    this.config = { ...DEFAULT_EXEC_CONFIG, ...cfg };
  }

  async executeWithMCTS(query: string, context: Record<string, unknown>): Promise<ExecutionResult> {
    logger.info({ query: query.slice(0, 80) }, 'MCTS execution started');
    const start = Date.now();

    const tree = new ReasoningTree(query, context);
    const mctsEngine = new MCTSEngine(
      tree,
      { timeoutMs: this.config.timeoutMs },
      this.toolRegistry,
      this.llmRouter,
    );

    const bestPath = await mctsEngine.search();
    const lastNode = bestPath[bestPath.length - 1];
    const confidence = lastNode
      ? lastNode.visits > 0
        ? lastNode.value / lastNode.visits
        : 0
      : 0;

    const syntaxPrompt = `Synthesize the MCTS reasoning path into a final answer.

Query: "${query}"
Reasoning path:
${bestPath.map((n, i) => `  ${i}: ${n.action}`).join('\n')}

Provide a concise, complete answer based on this reasoning.`;

    let result: string;
    let synthesisFailed = false;
    try {
      result = await this.llmRouter.generateText(syntaxPrompt, { temperature: 0.2, maxTokens: 1024 });
    } catch {
      synthesisFailed = true;
      result = '';
    }

    // Detect when the path is entirely fallback thoughts (LLM calls all failed)
    const hasOnlyFallbacks = bestPath.length > 0 &&
      bestPath.every(n => n.action.startsWith('fallback_thought') || n.action === 'root');

    const elapsed = Date.now() - start;
    logger.info({ elapsed, confidence, pathLength: bestPath.length, synthesisFailed, hasOnlyFallbacks }, 'MCTS execution complete');

    return {
      result: hasOnlyFallbacks ? '' : result,
      trace: bestPath,
      // When all nodes are fallbacks or synthesis failed, confidence should be 0 so the flow falls through to Gemini
      confidence: (hasOnlyFallbacks || synthesisFailed || !result) ? 0 : confidence,
      method: 'mcts',
    };
  }

  async executeWithToT(query: string, context: Record<string, unknown>): Promise<ExecutionResult> {
    logger.info({ query: query.slice(0, 80) }, 'ToT execution started');
    const start = Date.now();

    const _tree = new ReasoningTree(query, context);
    const totEngine = new TreeOfThoughts(this.llmRouter, this.toolRegistry, { timeoutMs: this.config.timeoutMs });
    const solveResult = await totEngine.solve(query, context);
    const elapsed = Date.now() - start;

    logger.info({ elapsed, confidence: solveResult.confidence, pathLength: solveResult.path.length }, 'ToT execution complete');

    return {
      result: solveResult.answer,
      trace: solveResult.path,
      confidence: solveResult.confidence,
      method: 'tot',
    };
  }

  async executeParallel(paths: ReasoningNode[][]): Promise<unknown[]> {
    const topPaths = paths.slice(0, this.config.maxParallel);
    logger.info({ parallel: topPaths.length }, 'Executing paths in parallel');

    const results = await Promise.allSettled(
      topPaths.map(async (path, idx) => {
        const lastNode = path[path.length - 1];
        const actions = path.map(n => n.action).filter(a => a !== 'root');
        return { pathIndex: idx, actions, nodeCount: path.length, lastConfidence: lastNode?.value ?? 0 };
      }),
    );

    return results.map(r => (r.status === 'fulfilled' ? r.value : { error: 'path execution failed' }));
  }

  async backtrack(activePath: ReasoningNode[], failureNode: ReasoningNode): Promise<ReasoningNode[]> {
    logger.info({ failureAction: failureNode.action, depth: failureNode.depth }, 'Backtracking from failure');

    const failureIdx = activePath.findIndex(n => n.id === failureNode.id);
    if (failureIdx <= 0) return activePath;

    const parentNode = activePath[failureIdx - 1];
    const siblings = parentNode.children
      .map(_cId => failureNode)
      .filter(s => s.id !== failureNode.id);

    if (siblings.length === 0) {
      logger.info('No siblings to backtrack to, continuing from parent');
      return activePath.slice(0, failureIdx);
    }

    const bestSibling = siblings.reduce((best, s) =>
      s.visits > 0 && s.value / s.visits > (best.visits > 0 ? best.value / best.visits : -1)
        ? s
        : best,
    );

    const backtrackedPath = activePath.slice(0, failureIdx);
    backtrackedPath.push(bestSibling);

    logger.info({ siblingAction: bestSibling.action, siblingScore: bestSibling.visits > 0 ? bestSibling.value / bestSibling.visits : 0 }, 'Backtracked to sibling');

    return backtrackedPath;
  }

  selectStrategy(query: string): 'mcts' | 'tot' {
    const toolKeywords = ['run', 'execute', 'compute', 'analyze data', 'simulate', 'calculate', 'fetch', 'scrape', 'call api', 'tool'];
    const reasoningKeywords = ['why', 'explain', 'compare', 'contrast', 'evaluate', 'assess', 'theorize', 'hypothesize', 'imagine', 'what if'];

    const lowerQuery = query.toLowerCase();
    let toolScore = 0;
    let reasoningScore = 0;

    for (const kw of toolKeywords) {
      if (lowerQuery.includes(kw)) toolScore++;
    }
    for (const kw of reasoningKeywords) {
      if (lowerQuery.includes(kw)) reasoningScore++;
    }

    const strategy = toolScore >= reasoningScore ? 'mcts' : 'tot';
    logger.info({ query: query.slice(0, 60), toolScore, reasoningScore, strategy }, 'Strategy selected');

    return strategy;
  }

  formatTraceForFrontend(trace: ReasoningNode[]): FormattedTraceNode[] {
    const nodeMap = new Map<string, FormattedTraceNode>();
    const roots: FormattedTraceNode[] = [];

    for (const node of trace) {
      const formatted: FormattedTraceNode = {
        id: node.id,
        action: node.action,
        depth: node.depth,
        value: node.visits > 0 ? Math.round((node.value / node.visits) * 100) / 100 : 0,
        visits: node.visits,
        children: [],
      };
      nodeMap.set(node.id, formatted);
    }

    for (const node of trace) {
      const formatted = nodeMap.get(node.id);
      if (!formatted) continue;
      if (node.parent && nodeMap.has(node.parent)) {
        const parent = nodeMap.get(node.parent)!;
        parent.children.push(formatted);
      } else {
        roots.push(formatted);
      }
    }

    return roots;
  }

  getMCTSEngine(): MCTSEngine {
    return this.mcts;
  }

  getToT(): TreeOfThoughts {
    return this.tot;
  }
}
