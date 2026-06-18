import { ReasoningTree, type ReasoningNode, type ReasoningState } from './reasoningTree';
import { logger } from '../observability/logger';

export interface MCTSConfig {
  explorationConstant: number;
  maxIterations: number;
  simulationDepth: number;
  timeoutMs: number;
}

const DEFAULT_CONFIG: MCTSConfig = {
  explorationConstant: 1.41,
  maxIterations: 100,
  simulationDepth: 5,
  timeoutMs: 30000,
};

interface ToolRegistry {
  executeTool: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; output: unknown }>;
  listTools: () => string[];
}

interface LLMRouter {
  generateText: (prompt: string, opts?: { temperature?: number; maxTokens?: number }) => Promise<string>;
}

function computeFactualCoverage(state: ReasoningState): number {
  if (state.toolsCalled.length === 0) return 0;
  const verified = state.results.filter(r => r !== null && r !== undefined).length;
  return Math.min(1, verified / Math.max(1, state.toolsCalled.length));
}

function computeCodeValidity(state: ReasoningState): number {
  const codeResults = state.results.filter(r =>
    typeof r === 'object' && r !== null && 'exitCode' in (r as Record<string, unknown>),
  ) as Array<Record<string, unknown>>;
  if (codeResults.length === 0) return 0.5;
  const successes = codeResults.filter(r => r.exitCode === 0 || r.success === true).length;
  return successes / codeResults.length;
}

function computeInfoGain(state: ReasoningState): number {
  if (state.hypotheses.length === 0) return 0;
  const total = state.hypotheses.length;
  const completed = state.hypotheses.filter(h => h.length > 0).length;
  return completed / Math.max(1, total);
}

function computeConsistency(state: ReasoningState): number {
  if (state.results.length < 2) return 0.5;
  let agreements = 0;
  let comparisons = 0;
  for (let i = 0; i < state.results.length; i++) {
    for (let j = i + 1; j < state.results.length; j++) {
      comparisons++;
      const a = JSON.stringify(state.results[i]);
      const b = JSON.stringify(state.results[j]);
      if (a === b) agreements++;
    }
  }
  return comparisons > 0 ? agreements / comparisons : 0.5;
}

export class MCTSEngine {
  private tree: ReasoningTree;
  private config: MCTSConfig;
  private toolRegistry: ToolRegistry;
  private llmRouter: LLMRouter;
  private startTime: number = 0;
  private iterationsRun: number = 0;

  constructor(
    tree: ReasoningTree,
    config: Partial<MCTSConfig>,
    toolRegistry: ToolRegistry,
    llmRouter: LLMRouter,
  ) {
    this.tree = tree;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.toolRegistry = toolRegistry;
    this.llmRouter = llmRouter;
  }

  private ucbl(node: ReasoningNode, parentVisits: number): number {
    if (node.visits === 0) return Infinity;
    const exploitation = node.value / node.visits;
    const exploration = this.config.explorationConstant *
      Math.sqrt(Math.log(Math.max(1, parentVisits)) / node.visits);
    return exploitation + exploration + node.prior;
  }

  async select(): Promise<ReasoningNode> {
    let current = this.tree.getRoot();
    let path: ReasoningNode[] = [current];

    while (current.children.length > 0) {
      const parentVisits = current.visits;
      const scores = current.children.map(childId => {
        const child = this.tree.getNode(childId);
        if (!child) return { id: childId, score: -Infinity };
        return { id: childId, score: this.ucbl(child, parentVisits) };
      });
      scores.sort((a, b) => b.score - a.score);
      const bestId = scores[0].id;
      const bestNode = this.tree.getNode(bestId);
      if (!bestNode) break;
      current = bestNode;
      path.push(current);
    }

    return current;
  }

  async expand(node: ReasoningNode): Promise<ReasoningNode[]> {
    const temperatures = [0.3, 0.7, 1.0];
    const tools = this.toolRegistry.listTools();
    const generated: ReasoningNode[] = [];

    for (const temp of temperatures) {
      const prompt = `You are an MCTS expansion policy. Given the current reasoning state, propose the next best action.

Current query: "${node.state.query}"
Tools available: ${tools.join(', ')}
Hypotheses so far: ${node.state.hypotheses.join('; ') || 'none'}
Confidence: ${node.state.confidence}

Propose a single, specific next action. Choose one:
1. Call a tool with specific arguments
2. Form a new hypothesis to test
3. Analyze existing results for patterns
4. Request more data from a specific API

Return JSON: {"action": "tool_call|hypothesis|analysis|data_request", "description": "...", "toolName?": "...", "toolArgs?": {}, "expectedOutcome": "..."}`;

      let actionDesc = 'explore_alternative';
      try {
        const raw = await this.llmRouter.generateText(prompt, { temperature: temp, maxTokens: 512 });
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          actionDesc = (parsed.description as string) || `thought_${temp}`;
        }
      } catch {
        actionDesc = `fallback_thought_${Math.random().toString(36).slice(2, 6)}`;
      }

      const childState: ReasoningState = {
        query: node.state.query,
        context: { ...node.state.context, temperature: temp },
        toolsCalled: [...node.state.toolsCalled],
        results: [...node.state.results],
        hypotheses: [...node.state.hypotheses],
        confidence: node.state.confidence,
        status: 'active',
      };

      const childId = this.tree.addNode(node.id, actionDesc, childState);
      const child = this.tree.getNode(childId);
      if (child) generated.push(child);
    }

    return generated;
  }

  async simulate(node: ReasoningNode): Promise<number> {
    let currentState: ReasoningState = { ...node.state, status: 'active' };
    let score = 0;

    for (let d = 0; d < this.config.simulationDepth; d++) {
      const tools = this.toolRegistry.listTools();
      const prompt = `You are a fast MCTS roll-out policy. Continue reasoning from this state quickly.

Query: "${currentState.query}"
Tools: ${tools.join(', ')}

Pick the single most promising next tool to call or analysis to run.
Return JSON: {"action": "tool_call|hypothesis", "toolName?": "...", "description": "..."}`;

      let action = 'fallback_analysis';
      try {
        const raw = await this.llmRouter.generateText(prompt, { temperature: 0.8, maxTokens: 256 });
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          action = (parsed.toolName as string) || (parsed.description as string) || action;
        }
      } catch {
        action = `sim_rollout_${d}`;
      }

      currentState.toolsCalled.push(action);
      currentState.results.push({ simulation: true, depth: d, action });
      currentState.hypotheses.push(`rollout_hypothesis_${d}`);

      if (d === this.config.simulationDepth - 1) {
        currentState.status = 'complete';
      }
    }

    score = this.scoreFunction(currentState);
    return score;
  }

  backpropagate(node: ReasoningNode, score: number): void {
    let current: ReasoningNode | undefined = node;
    while (current) {
      current.visits++;
      current.value += score;
      current = current.parent ? this.tree.getNode(current.parent) : undefined;
    }
  }

  scoreFunction(state: ReasoningState): number {
    const factualCoverage = computeFactualCoverage(state);
    const codeValidity = computeCodeValidity(state);
    const infoGain = computeInfoGain(state);
    const consistency = computeConsistency(state);

    return (
      factualCoverage * 0.3 +
      codeValidity * 0.2 +
      infoGain * 0.3 +
      consistency * 0.2
    );
  }

  async search(): Promise<ReasoningNode[]> {
    this.startTime = Date.now();
    this.iterationsRun = 0;

    for (let i = 0; i < this.config.maxIterations; i++) {
      const elapsed = Date.now() - this.startTime;
      if (elapsed > this.config.timeoutMs) {
        logger.info({ iterations: i, elapsed }, 'MCTS timed out');
        break;
      }

      let selected: ReasoningNode;
      try {
        selected = await this.select();
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'MCTS select failed');
        break;
      }

      if (selected.state.status === 'complete') continue;

      let expanded: ReasoningNode[];
      try {
        expanded = await this.expand(selected);
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'MCTS expand failed');
        continue;
      }

      for (const child of expanded) {
        let score: number;
        try {
          score = await this.simulate(child);
        } catch (e) {
          logger.error({ err: (e as Error).message }, 'MCTS simulate failed');
          score = 0;
        }
        this.backpropagate(child, score);
      }

      this.iterationsRun = i + 1;
    }

    const bestPath = this.tree.getBestPath();
    logger.info({
      iterations: this.iterationsRun,
      treeSize: this.tree.getNodeCount(),
      bestPathLength: bestPath.length,
    }, 'MCTS search complete');

    return bestPath;
  }

  getIterationCount(): number {
    return this.iterationsRun;
  }

  getTree(): ReasoningTree {
    return this.tree;
  }
}
