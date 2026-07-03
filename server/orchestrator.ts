import { z } from 'zod';
import { logger } from './observability/logger';
import { omninet } from './ai-router/omninet';

// ── DAG Types ────────────────────────────────────────────────────

interface DAGNode {
  id: string;
  role: 'plumber' | 'coder' | 'analyst' | 'visualizer' | 'critic' | 'reframer';
  prompt: string;
  dependencies: string[];
}

interface DAGPlan {
  nodes: DAGNode[];
  synthesisPrompt: string;
}

export interface AgentResult {
  output: string;
  commands?: Array<{ action: string; [key: string]: unknown }>;
}

interface SharedContext {
  query: string;
  location?: { lat: number; lon: number; label?: string };
  intent?: string;
  layers?: string[];
  agentOutputs: Map<string, unknown>;
}

// ── Agent prompt templates ──────────────────────────────────────

const AGENT_PROMPTS: Record<string, string> = {
  plumber: `You are **Plumber** — a data pipeline specialist. Your job is to:
- Design data pipelines and ETL workflows
- Suggest which APIs to call and how to transform data
- Identify data quality issues and cleaning strategies
- Recommend data storage and caching approaches
Respond with concrete, actionable pipeline designs. If lat/lon data is involved, suggest specific API endpoints.`,

  coder: `You are **Coder** — a code generation specialist. Your job is to:
- Write Python or JavaScript code for data processing and analysis
- Generate code snippets for specific computational tasks
- Suggest algorithms and implementation approaches
- Provide complete, runnable code when possible
Respond with clean, well-structured code blocks. Explain what the code does.`,

  analyst: `You are **Analyst** — a data analysis specialist. Your job is to:
- Perform statistical analysis and pattern detection
- Identify trends, anomalies, and correlations
- Compute meaningful metrics and summaries
- Provide data-backed insights and interpretations
Respond with specific numbers, percentages, and statistical findings.`,

  visualizer: `You are **Visualizer** — a geospatial visualization specialist. Your job is to:
- Recommend the best layers/views for the globe
- Suggest visualization parameters (colors, opacity, clustering)
- Design informative map layouts and overlays
- Translate data insights into visual representations
Respond with specific layer IDs, camera positions, and visual settings.`,

  critic: `You are **Critic** — a quality review specialist. Your job is to:
- Identify errors, gaps, and biases in analyses
- Suggest improvements and alternative approaches
- Validate data quality and methodology
- Ensure conclusions are supported by evidence
Respond with constructive criticism and specific improvement suggestions.`,

  reframer: `You are **Reframer** — a creative thinking specialist. Your job is to:
- Offer alternative interpretations of the data
- Suggest unexpected connections and patterns
- Propose novel approaches to the problem
- Think outside the box while staying grounded in data
Respond with creative but defensible alternative perspectives.`,
};

// ── Zod validation schemas per role ──────────────────────────────

const plumberSchema = z.object({
  pipeline: z.string().min(1),
  endpoints: z.array(z.string()).optional(),
  dataSources: z.array(z.string()).optional(),
  recommendations: z.array(z.string()).optional(),
});

const coderSchema = z.object({
  code: z.string().min(1),
  language: z.string().optional(),
  explanation: z.string().min(1),
  dependencies: z.array(z.string()).optional(),
});

const analystSchema = z.object({
  findings: z.array(z.string()).min(1),
  metrics: z.record(z.string(), z.number()).optional(),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

const visualizerSchema = z.object({
  layers: z.array(z.object({
    layerId: z.string(),
    enabled: z.boolean(),
  })).optional(),
  camera: z.object({
    lat: z.number(),
    lon: z.number(),
    zoom: z.number().optional(),
  }).optional(),
  pins: z.array(z.object({
    lat: z.number(),
    lon: z.number(),
    label: z.string().optional(),
  })).optional(),
  summary: z.string().min(1),
});

const criticSchema = z.object({
  issues: z.array(z.string()).min(1),
  improvements: z.array(z.string()).optional(),
  overallAssessment: z.string().min(1),
});

const reframerSchema = z.object({
  perspectives: z.array(z.string()).min(1),
  novelConnections: z.array(z.string()).optional(),
  summary: z.string().min(1),
});

const ROLE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  plumber: plumberSchema,
  coder: coderSchema,
  analyst: analystSchema,
  visualizer: visualizerSchema,
  critic: criticSchema,
  reframer: reframerSchema,
};

// ── Omninet helper ─────────────────────────────────────────────

async function omninetText(prompt: string, systemInstruction?: string, _apiKey?: string, signal?: AbortSignal): Promise<string> {
  try {
    const fullPrompt = systemInstruction
      ? `${systemInstruction}\n\n${prompt.slice(0, 16000)}`
      : prompt.slice(0, 16000);
    return await omninet.generateText(fullPrompt, { temperature: 0.2, maxTokens: 2048, signal });
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'Omninet error in orchestrator');
    throw e;
  }
}

// ── AgentOrchestrator ───────────────────────────────────────────

export class AgentOrchestrator {
  private apiKey: string;

  constructor(_apiKey?: string) {
    this.apiKey = _apiKey || '';
  }

  async orchestrate(
    query: string,
    context?: { location?: { lat: number; lon: number; label?: string }; intent?: string; layers?: string[]; cloud?: boolean },
  ): Promise<AgentResult> {
    const plan = await this.plan(query);

    if (!plan.nodes || plan.nodes.length === 0) {
      return { output: '' };
    }

    const sharedContext: SharedContext = {
      query,
      location: context?.location,
      intent: context?.intent,
      layers: context?.layers,
      agentOutputs: new Map(),
    };

    const results = await this.executeDag(plan.nodes, sharedContext);

    return this.synthesize(query, plan, results, sharedContext);
  }

  private async plan(query: string): Promise<DAGPlan> {
    const directorPrompt = `You are **Director** — a multi-agent orchestrator. Decompose the following user query into a DAG of specialized agents.

Available agents:
- **plumber**: Data pipeline design, ETL, API suggestions
- **coder**: Code generation, algorithms, computational solutions
- **analyst**: Statistical analysis, pattern detection, metrics
- **visualizer**: Geospatial visualization, map/globe layers
- **critic**: Quality review, error detection, improvement suggestions
- **reframer**: Alternative perspectives, creative approaches

Rules:
- Output ONLY valid JSON — no markdown, no code fences, no explanation.
- "nodes" array contains 1-4 tasks. Each node has:
  - "id": unique string
  - "role": one of the 6 agent types
  - "prompt": what this agent should do (include context from prior nodes via {nodeId} placeholders)
  - "dependencies": array of node IDs this node depends on (empty for root nodes)
- If the query is simple (greeting, toggle, fly-to), return {"nodes":[]}.
- "synthesisPrompt": instruction for combining all node outputs.

User query: "${query.replace(/"/g, '\\"')}"`;

    const raw = await omninetText(directorPrompt, 'You are a task planning AI. Only output valid JSON.', this.apiKey);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { nodes: [], synthesisPrompt: '' };

    try {
      const parsed = JSON.parse(jsonMatch[0]) as DAGPlan;
      if (!Array.isArray(parsed.nodes)) return { nodes: [], synthesisPrompt: '' };
      parsed.nodes = parsed.nodes.slice(0, 4).filter(n =>
        ['plumber', 'coder', 'analyst', 'visualizer', 'critic', 'reframer'].includes(n.role),
      );
      return parsed;
    } catch {
      return { nodes: [], synthesisPrompt: '' };
    }
  }

  private async executeDag(nodes: DAGNode[], context: SharedContext): Promise<Map<string, unknown>> {
    const results = new Map<string, unknown>();
    const completed = new Set<string>();
    const remaining = new Set(nodes.map(n => n.id));

    while (remaining.size > 0) {
      const ready = nodes.filter(n =>
        remaining.has(n.id) && n.dependencies.every(d => completed.has(d)),
      );

      if (ready.length === 0) {
        throw new Error('DAG cycle detected or unreachable nodes');
      }

      const outputs = await Promise.all(ready.map(async (node) => {
        const depsContext = node.dependencies.map(d => {
          const depResult = results.get(d);
          return `[${d} output]\n${JSON.stringify(depResult, null, 2).slice(0, 2000)}`;
        }).join('\n\n');

        const fullPrompt = depsContext
          ? `Original query: "${context.query}"\n\nPrior results:\n${depsContext}\n\nYour task (${node.id}): ${node.prompt}`
          : `Original query: "${context.query}"\n\nYour task (${node.id}): ${node.prompt}`;

        const schema = ROLE_SCHEMAS[node.role];
        let attemptCount = 0;
        const maxAttempts = 2;

        while (attemptCount < maxAttempts) {
          attemptCount++;
          const rawOutput = await omninetText(fullPrompt, AGENT_PROMPTS[node.role], this.apiKey);

          if (!schema) {
            context.agentOutputs.set(node.id, { text: rawOutput });
            return { id: node.id, output: rawOutput, structured: { text: rawOutput } };
          }

          const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            if (attemptCount < maxAttempts) continue;
            context.agentOutputs.set(node.id, { text: rawOutput });
            return { id: node.id, output: rawOutput, structured: { text: rawOutput } };
          }

          try {
            const parsed = JSON.parse(jsonMatch[0]);
            const validated = schema.parse(parsed);
            context.agentOutputs.set(node.id, validated);
            return { id: node.id, output: rawOutput, structured: validated };
          } catch {
            if (attemptCount < maxAttempts) continue;
            context.agentOutputs.set(node.id, { text: rawOutput });
            return { id: node.id, output: rawOutput, structured: { text: rawOutput } };
          }
        }

        return { id: node.id, output: '', structured: {} };
      }));

      for (const out of outputs) {
        results.set(out.id, out.structured);
        completed.add(out.id);
        remaining.delete(out.id);
      }
    }

    return results;
  }

  private async synthesize(
    query: string,
    plan: DAGPlan,
    results: Map<string, unknown>,
    _context: SharedContext,
  ): Promise<AgentResult> {
    const parts: string[] = [];
    const commands: Array<{ action: string; [key: string]: unknown }> = [];

    for (const node of plan.nodes) {
      const output = results.get(node.id);
      if (output) {
        parts.push(`## ${node.role.charAt(0).toUpperCase() + node.role.slice(1)} (${node.id})\n${JSON.stringify(output, null, 2)}`);
      }

      if (node.role === 'visualizer' && output) {
        const viz = output as Record<string, unknown>;
        if (viz.camera) {
          commands.push({ action: 'flyTo', ...(viz.camera as Record<string, unknown>) });
        }
        if (viz.layers) {
          for (const layer of (viz.layers as Array<Record<string, unknown>>)) {
            commands.push({ action: 'toggleLayer', layerId: layer.layerId, enabled: layer.enabled });
          }
        }
        if (viz.pins) {
          for (const pin of (viz.pins as Array<Record<string, unknown>>)) {
            commands.push({ action: 'addPin', ...pin });
          }
        }
      }
    }

    const combinePrompt = plan.synthesisPrompt
      ? `Synthesize the following multi-agent analysis results into a single coherent response to the user's query.

User query: "${query}"

${parts.join('\n\n')}

Synthesis instruction: ${plan.synthesisPrompt}

Write a concise, well-organized final answer that:
1. Answers the query directly and clearly
2. Highlights the most important findings
3. Organizes information logically
4. Uses a helpful, professional tone`
      : `Synthesize the following multi-agent analysis results into a single coherent response to the user's query.

User query: "${query}"

${parts.join('\n\n')}

Write a concise, well-organized final answer that:
1. Answers the query directly and clearly
2. Highlights the most important findings
3. Organizes information logically
4. Uses a helpful, professional tone
5. Suggests relevant visualizations or actions the user can take on the globe`;

    const combined = await omninetText(
      combinePrompt,
      'You are a synthesis AI that combines multi-agent analysis into clear, actionable responses.',
      this.apiKey,
    );

    return { output: combined, commands: commands.length > 0 ? commands : undefined };
  }
}
