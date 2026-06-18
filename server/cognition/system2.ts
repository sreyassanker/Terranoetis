import { omninet } from '../ai-router/omninet';
import { logger } from '../observability/logger';

// ── Types ───────────────────────────────────────────────────────

export interface HTNTask {
  id: string;
  description: string;
  type: 'primitive' | 'compound';
  subtasks?: HTNTask[];
  dependencies?: string[];
  code?: string;
  language?: 'python' | 'node' | 'bash';
}

export interface CausalLink {
  cause: string;
  effect: string;
  probability: number;
  evidence: string[];
}

export interface CausalGraph {
  nodes: string[];
  links: CausalLink[];
  rootCauses: string[];
}

export interface DebateProposal {
  agentName: string;
  solution: string;
  confidence: number;
  reasoning: string;
}

export interface Counterfactual {
  scenario: string;
  actualOutcome: string;
  counterfactualOutcome: string;
  keyDifference: string;
  confidence: number;
}

export interface Hypothesis {
  statement: string;
  probability: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  timeframe: string;
}

export interface ReasoningStep {
  step: number;
  type: 'decomposition' | 'debate' | 'causal_analysis' | 'counterfactual' | 'hypothesis' | 'synthesis' | 'verification';
  description: string;
  input: string;
  output: string;
  confidence: number;
}

export interface System2Result {
  plan: HTNTask[];
  debate: {
    proposals: DebateProposal[];
    selectedProposal: DebateProposal;
    judgeRationale: string;
  } | null;
  causalGraph: CausalGraph | null;
  counterfactuals: Counterfactual[];
  hypotheses: Hypothesis[];
  reasoningTrace: ReasoningStep[];
  synthesis: string;
  finalConfidence: number;
}

// ── Agent roles for debate ──────────────────────────────────────

const DEBATE_AGENTS = [
  { name: 'Data Analyst', perspective: 'Focus on statistical patterns, trends, and quantitative evidence. Use data-driven reasoning.' },
  { name: 'Domain Expert', perspective: 'Focus on domain-specific knowledge about geohazards, seismology, meteorology, and earth science.' },
  { name: 'Systems Thinker', perspective: 'Focus on interconnected systems, feedback loops, and emergent behavior in complex geospatial systems.' },
  { name: 'Risk Assessor', perspective: 'Focus on hazard probability, impact severity, mitigation strategies, and uncertainty quantification.' },
];

const CRITIC_NAME = 'Verifier';
const JUDGE_NAME = 'Synthesizer';

// ── System 2 ─────────────────────────────────────────────────────

export class System2 {
  async plan(query: string, context?: { location?: string; intent?: string }): Promise<System2Result> {
    const steps: ReasoningStep[] = [];

    // Phase 1: HTN Decomposition
    const plan = await this.htnDecompose(query, context);
    steps.push({
      step: 1,
      type: 'decomposition',
      description: 'Decomposed query into hierarchical task network',
      input: query,
      output: JSON.stringify(plan.slice(0, 5)),
      confidence: 0.85,
    });

    // Phase 2: Multi-agent debate
    const debate = await this.multiAgentDebate(query, context);
    steps.push({
      step: 2,
      type: 'debate',
      description: 'Four agents proposed solutions, critic evaluated, judge selected',
      input: query,
      output: `Selected: ${debate.selectedProposal.agentName} — ${debate.selectedProposal.solution.slice(0, 200)}`,
      confidence: debate.selectedProposal.confidence,
    });

    // Phase 3: Causal reasoning
    const causalGraph = await this.causalReasoning(query, debate.selectedProposal.solution);
    steps.push({
      step: 3,
      type: 'causal_analysis',
      description: 'Built causal graph of events and relationships',
      input: debate.selectedProposal.solution,
      output: `Identified ${causalGraph.nodes.length} causal nodes, ${causalGraph.links.length} relationships`,
      confidence: causalGraph.nodes.length > 0 ? 0.8 : 0.4,
    });

    // Phase 4: Counterfactual analysis
    const counterfactuals = await this.counterfactualAnalysis(query, causalGraph);
    steps.push({
      step: 4,
      type: 'counterfactual',
      description: 'Explored alternative scenarios',
      input: JSON.stringify(causalGraph),
      output: counterfactuals.map(c => c.scenario).join('; '),
      confidence: counterfactuals.length > 0 ? 0.75 : 0.5,
    });

    // Phase 5: Hypothesis generation
    const hypotheses = await this.generateHypotheses(query, causalGraph, debate.selectedProposal.solution);
    steps.push({
      step: 5,
      type: 'hypothesis',
      description: 'Generated predictive hypotheses based on patterns',
      input: debate.selectedProposal.solution,
      output: hypotheses.map(h => `${h.statement} (P=${h.probability})`).join('; '),
      confidence: hypotheses.length > 0 ? 0.7 : 0.4,
    });

    // Phase 6: Synthesis
    const synthesis = await this.synthesize(query, debate, causalGraph, counterfactuals, hypotheses);
    steps.push({
      step: 6,
      type: 'synthesis',
      description: 'Synthesized all reasoning into final response',
      input: query,
      output: synthesis.slice(0, 200),
      confidence: debate.selectedProposal.confidence,
    });

    const finalConfidence = this.computeFinalConfidence(steps);

    return {
      plan,
      debate,
      causalGraph,
      counterfactuals,
      hypotheses,
      reasoningTrace: steps,
      synthesis,
      finalConfidence,
    };
  }

  // ── HTN Planner ───────────────────────────────────────────────

  private async htnDecompose(query: string, context?: { location?: string; intent?: string }): Promise<HTNTask[]> {
    const locationContext = context?.location ? ` at ${context.location}` : '';
    const intentContext = context?.intent ? ` (intent: ${context.intent})` : '';

    const prompt = `You are an HTN (Hierarchical Task Network) planner for Earth Intelligence. Decompose the following user query into a hierarchy of tasks.

Rules:
- Output ONLY valid JSON array — no markdown, no explanation.
- Each task has: id (unique), description, type ("primitive" for atomic actions, "compound" for decomposable goals), dependencies (array of task ids this depends on)
- Compound tasks MUST have a "subtasks" array with their decomposition
- Primitive tasks may include "code" (working Python/bash) and "language" (python/node/bash)
- Maximum 15 total tasks across all decomposition levels
- Root tasks should be the highest-level decomposition

User query: "${query.replace(/"/g, '\\"')}"${locationContext}${intentContext}

Return: [{"id":"task1","description":"...","type":"compound","subtasks":[{"id":"task1a","description":"...","type":"primitive","dependencies":[],"code":"...","language":"bash"}]},...]`;

    try {
      const raw = await omninet.generateText(prompt, { temperature: 0.2, maxTokens: 2048 });
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]) as HTNTask[];
      if (!Array.isArray(parsed)) return [];

      return this.flattenTasks(parsed).slice(0, 15);
    } catch {
      return [];
    }
  }

  private flattenTasks(tasks: HTNTask[]): HTNTask[] {
    const result: HTNTask[] = [];
    for (const t of tasks) {
      result.push({ ...t, subtasks: undefined });
      if (t.subtasks) {
        result.push(...this.flattenTasks(t.subtasks));
      }
    }
    return result;
  }

  // ── Multi-Agent Debate ────────────────────────────────────────

  private async multiAgentDebate(
    query: string,
    context?: { location?: string; intent?: string },
  ): Promise<{
    proposals: DebateProposal[];
    selectedProposal: DebateProposal;
    judgeRationale: string;
  }> {
    const locationContext = context?.location ? ` at ${context.location}` : '';

    const proposals: DebateProposal[] = [];

    for (const agent of DEBATE_AGENTS) {
      const prompt = `You are ${agent.name}. ${agent.perspective}

User query: "${query.replace(/"/g, '\\"')}"${locationContext}

Propose a solution or analysis approach. Be specific and actionable.
Return ONLY valid JSON: {"solution":"...", "confidence":0.0-1.0, "reasoning":"..."}`;

      try {
        const raw = await omninet.generateText(prompt, { temperature: 0.3, maxTokens: 1024 });
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { solution: string; confidence: number; reasoning: string };
          proposals.push({
            agentName: agent.name,
            solution: parsed.solution || '',
            confidence: parsed.confidence ?? 0.5,
            reasoning: parsed.reasoning || '',
          });
        }
      } catch {
        // skip failed agent
      }
    }

    if (proposals.length === 0) {
      const fallback: DebateProposal = {
        agentName: 'Fallback',
        solution: 'Unable to generate proposals. Using default analysis approach.',
        confidence: 0.3,
        reasoning: 'All agents failed to respond.',
      };
      return { proposals: [fallback], selectedProposal: fallback, judgeRationale: 'Fallback — all agents unavailable' };
    }

    // Critic evaluates each proposal
    const criticPrompt = `You are ${CRITIC_NAME}, a rigorous evaluator. Evaluate the following proposals for the user's query.

User query: "${query.replace(/"/g, '\\"')}"${locationContext}

Proposals:
${proposals.map((p, i) => `[${i + 1}] ${p.agentName}: ${p.solution.slice(0, 300)} (confidence: ${p.confidence})`).join('\n\n')}

For each proposal, rate: factualAccuracy (0-1), logicalConsistency (0-1), completeness (0-1), overall (0-1).
Return ONLY valid JSON: {"ratings":[{"agentName":"...","factualAccuracy":0.0,"logicalConsistency":0.0,"completeness":0.0,"overall":0.0}],"recommendation":"...","recommendedIndex":0}`;

    let criticResult: { ratings: Array<{ agentName: string; factualAccuracy: number; logicalConsistency: number; completeness: number; overall: number }>; recommendation: string; recommendedIndex: number } | null = null;
    try {
      const raw = await omninet.generateText(criticPrompt, { temperature: 0.1, maxTokens: 1024 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        criticResult = JSON.parse(jsonMatch[0]);
      }
    } catch { /* critic failed */ }

    // Judge selects
    let selectedIndex = 0;
    let judgeRationale = criticResult?.recommendation || 'Selecting highest confidence proposal';

    if (criticResult && criticResult.recommendedIndex >= 0 && criticResult.recommendedIndex < proposals.length) {
      selectedIndex = criticResult.recommendedIndex;
    } else {
      selectedIndex = proposals.reduce((best, p, i) => p.confidence > proposals[best].confidence ? i : best, 0);
    }

    const selectedProposal: DebateProposal = {
      ...proposals[selectedIndex],
      confidence: criticResult?.ratings?.[selectedIndex]?.overall ?? proposals[selectedIndex].confidence,
    };

    return { proposals, selectedProposal, judgeRationale };
  }

  // ── Causal Reasoning ──────────────────────────────────────────

  private async causalReasoning(query: string, solution: string): Promise<CausalGraph> {
    const prompt = `You are a causal reasoning engine for geospatial events. Based on the user query and proposed solution, build a causal graph.

User query: "${query.replace(/"/g, '\\"')}"
Proposed solution: "${solution.slice(0, 500)}"

Return ONLY valid JSON: {
  "nodes": ["event1", "event2", ...],
  "links": [{"cause": "event1", "effect": "event2", "probability": 0.85, "evidence": ["evidence1", "evidence2"]}, ...],
  "rootCauses": ["root_cause1", ...]
}

Rules:
- Nodes are specific events, conditions, or states
- Links represent causal relationships with probability 0-1
- Root causes are nodes with no incoming causal links
- Include both direct and indirect causal chains
- Maximum 15 nodes`;

    try {
      const raw = await omninet.generateText(prompt, { temperature: 0.2, maxTokens: 2048 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { nodes: [], links: [], rootCauses: [] };
      const parsed = JSON.parse(jsonMatch[0]) as CausalGraph;
      return {
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes.slice(0, 15) : [],
        links: Array.isArray(parsed.links) ? parsed.links : [],
        rootCauses: Array.isArray(parsed.rootCauses) ? parsed.rootCauses : [],
      };
    } catch {
      return { nodes: [], links: [], rootCauses: [] };
    }
  }

  // ── Counterfactual Analysis ───────────────────────────────────

  private async counterfactualAnalysis(query: string, causalGraph: CausalGraph): Promise<Counterfactual[]> {
    if (causalGraph.nodes.length === 0) return [];

    const prompt = `You are a counterfactual reasoning engine. Based on the causal graph, explore alternative scenarios.

Original query: "${query.replace(/"/g, '\\"')}"

Causal graph:
- Events: ${causalGraph.nodes.join(', ')}
- Root causes: ${causalGraph.rootCauses.join(', ')}
- Key links: ${causalGraph.links.slice(0, 5).map(l => `${l.cause} → ${l.effect} (P=${l.probability})`).join('; ')}

Generate 2-3 counterfactual scenarios. For each:
- Change ONE key variable or event
- Describe the alternative outcome
- Explain what would be different

Return ONLY valid JSON: [{"scenario":"What if X instead of Y?","actualOutcome":"...","counterfactualOutcome":"...","keyDifference":"...","confidence":0.0},...]`;

    try {
      const raw = await omninet.generateText(prompt, { temperature: 0.3, maxTokens: 1024 });
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]) as Counterfactual[];
      return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
    } catch {
      return [];
    }
  }

  // ── Hypothesis Generation ─────────────────────────────────────

  private async generateHypotheses(query: string, causalGraph: CausalGraph, solution: string): Promise<Hypothesis[]> {
    const graphContext = causalGraph.nodes.length > 0
      ? `Causal graph suggests: ${causalGraph.nodes.slice(0, 5).join(', ')}`
      : 'No causal graph available';

    const prompt = `You are a predictive hypothesis generator for Earth Intelligence.

User query: "${query.replace(/"/g, '\\"')}"
${graphContext}
Proposed solution: "${solution.slice(0, 300)}"

Generate 2-3 predictive hypotheses. Each should be testable and specific.
For each: statement, probability (0-1), evidence for, evidence against, timeframe.

Return ONLY valid JSON: [{"statement":"...","probability":0.0,"evidenceFor":["..."],"evidenceAgainst":["..."],"timeframe":"..."},...]`;

    try {
      const raw = await omninet.generateText(prompt, { temperature: 0.3, maxTokens: 1024 });
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]) as Hypothesis[];
      return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
    } catch {
      return [];
    }
  }

  // ── Synthesis ─────────────────────────────────────────────────

  private async synthesize(
    query: string,
    debate: {
      proposals: DebateProposal[];
      selectedProposal: DebateProposal;
      judgeRationale: string;
    },
    causalGraph: CausalGraph,
    counterfactuals: Counterfactual[],
    hypotheses: Hypothesis[],
  ): Promise<string> {
    const prompt = `You are the Synthesis Judge. Combine all reasoning into a clear, actionable response.

User query: "${query.replace(/"/g, '\\"')}"

Selected solution: ${debate.selectedProposal.solution}
Selected by: ${debate.selectedProposal.agentName}
Confidence: ${debate.selectedProposal.confidence}
Judge rationale: ${debate.judgeRationale}

Causal analysis: ${JSON.stringify(causalGraph).slice(0, 500)}

Counterfactual scenarios: ${counterfactuals.map(c => c.scenario).join(' | ')}

Predictive hypotheses: ${hypotheses.map(h => `${h.statement} (P=${h.probability})`).join(' | ')}

Write a concise, well-organized response that:
1. Answers the query directly
2. Explains the key causal relationships
3. Notes alternative scenarios if relevant
4. States predictive hypotheses with confidence levels
5. Acknowledges uncertainty where appropriate`;

    try {
      return await omninet.generateText(prompt, { temperature: 0.2, maxTokens: 2048 });
    } catch {
      return 'Unable to synthesize analysis results.';
    }
  }

  // ── Verifier-Critic Loop ──────────────────────────────────────

  async verifyAndRevise(
    synthesis: string,
    query: string,
    maxIterations = 2,
  ): Promise<{ finalSynthesis: string; criticScore: number; iterations: number }> {
    let currentSynthesis = synthesis;
    let criticScore = 0;
    let iterations = 0;

    for (let i = 0; i < maxIterations; i++) {
      iterations++;
      const result = await this.runCritic(currentSynthesis, query);
      criticScore = result.score;

      if (criticScore >= 0.7) break;

      if (i < maxIterations - 1) {
        currentSynthesis = await this.reviseSynthesis(currentSynthesis, query, result.issues);
      }
    }

    return { finalSynthesis: currentSynthesis, criticScore, iterations };
  }

  private async runCritic(
    synthesis: string,
    query: string,
  ): Promise<{ score: number; issues: string[] }> {
    const prompt = `You are ${CRITIC_NAME}. Evaluate this response for factual accuracy, logical consistency, and completeness.

Original query: "${query.replace(/"/g, '\\"')}"
Response: "${synthesis.slice(0, 2000)}"

Rate each dimension 0-1, then recommend improvements.
Return ONLY valid JSON: {
  "factualAccuracy": 0.0,
  "logicalConsistency": 0.0,
  "completeness": 0.0,
  "overall": 0.0,
  "issues": ["issue1", "issue2"],
  "recommendations": ["rec1", "rec2"]
}`;

    try {
      const raw = await omninet.generateText(prompt, { temperature: 0.1, maxTokens: 1024 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { score: 0.5, issues: [] };
      const parsed = JSON.parse(jsonMatch[0]) as {
        factualAccuracy?: number;
        logicalConsistency?: number;
        completeness?: number;
        overall?: number;
        issues?: string[];
      };
      return {
        score: parsed.overall ?? parsed.factualAccuracy ?? 0.5,
        issues: parsed.issues ?? [],
      };
    } catch {
      return { score: 0.5, issues: [] };
    }
  }

  private async reviseSynthesis(
    synthesis: string,
    query: string,
    issues: string[],
  ): Promise<string> {
    const prompt = `Revise the following response to address these issues.

Original query: "${query.replace(/"/g, '\\"')}"
Previous response: "${synthesis.slice(0, 1500)}"
Issues to fix: ${issues.join('; ')}

Write an improved version that addresses all issues while maintaining accuracy and completeness.`;

    try {
      return await omninet.generateText(prompt, { temperature: 0.2, maxTokens: 2048 });
    } catch {
      return synthesis;
    }
  }

  // ── Shared helpers ────────────────────────────────────────────

  private computeFinalConfidence(steps: ReasoningStep[]): number {
    if (steps.length === 0) return 0;
    const avg = steps.reduce((s, st) => s + st.confidence, 0) / steps.length;
    return Math.round(avg * 100) / 100;
  }
}

export const system2 = new System2();
