import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { DynamicToolRegistry } from './toolGenerator';

// ── Types ───────────────────────────────────────────────────────

export interface ToolChainStep {
  toolName: string;
  input: Record<string, unknown>;
  outputVar: string;
  dependsOn: string[];
}

export interface ToolChain {
  id?: string;
  name: string;
  steps: ToolChainStep[];
  description: string;
  createdAt?: string;
  usageCount?: number;
}

interface ExecNode {
  step: ToolChainStep;
  ready: boolean;
  result: unknown;
  error: string | null;
}

// ── ToolComposer ────────────────────────────────────────────────

export class ToolComposer {
  private registry: DynamicToolRegistry;
  private chainCache = new Map<string, { chain: ToolChain; optimized: ExecNode[] }>();

  constructor(registry: DynamicToolRegistry) {
    this.registry = registry;
  }

  init(): void {
    this.ensureTable();
    logger.info('ToolComposer initialized');
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS tool_chains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        steps_json TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    } catch { /* table exists */ }
  }

  compose(name: string, steps: ToolChainStep[], description: string): ToolChain {
    this.validateChain(steps);
    const chain: ToolChain = { name, steps, description };

    // Auto-optimize: parallelize independent steps
    const optimized = this.optimize(chain);

    this.chainCache.set(name, { chain, optimized });

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO tool_chains (name, steps_json, description)
        VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET steps_json = excluded.steps_json, description = excluded.description
      `).run(name, JSON.stringify(steps), description);
    } catch { /* silent */ }

    logger.info({ name, stepCount: steps.length }, 'Tool chain composed');
    return chain;
  }

  async execute(name: string, initialInput: Record<string, unknown>): Promise<Record<string, unknown>> {
    const cached = this.chainCache.get(name);
    if (!cached) throw new Error(`Chain "${name}" not found`);

    const { chain, optimized } = cached;
    const outputs: Record<string, unknown> = { ...initialInput };
    const start = Date.now();

    // Build execution DAG
    const nodes = optimized.map((n, i) => ({
      ...n,
      remaining: chain.steps.filter(s => s.outputVar === n.step.outputVar).length > 0,
    }));

    const completed = new Set<string>();
    let errors = 0;

    while (completed.size < nodes.length) {
      const ready = nodes.filter(n =>
        !completed.has(n.step.outputVar) &&
        n.step.dependsOn.every(d => completed.has(d))
      );

      if (ready.length === 0) {
        throw new Error('Chain deadlock detected');
      }

      const results = await Promise.all(ready.map(async (node) => {
        try {
          const mergedInput = { ...initialInput };
          for (const dep of node.step.dependsOn) {
            Object.assign(mergedInput, outputs[dep] as Record<string, unknown> ?? {});
          }
          Object.assign(mergedInput, node.step.input);

          const tool = this.registry.get(node.step.toolName);
          if (!tool) throw new Error(`Tool "${node.step.toolName}" not found`);

          const result = await this.registry.execute(tool.name, mergedInput);
          outputs[node.step.outputVar] = result;
          node.result = result;
          node.error = null;
          completed.add(node.step.outputVar);
          return { outputVar: node.step.outputVar, success: true };
        } catch (e) {
          errors++;
          node.error = (e as Error).message;
          logger.warn({ tool: node.step.toolName, err: node.error }, 'Chain step failed');

          // If all deps of any remaining node depend on this, error out
          const blocksOthers = nodes.some(n =>
            !completed.has(n.step.outputVar) &&
            n.step.dependsOn.includes(node.step.outputVar)
          );

          if (blocksOthers) {
            throw new Error(`Chain aborted: ${node.step.toolName} failed (${node.error}). Downstream steps blocked.`);
          }

          completed.add(node.step.outputVar);
          return { outputVar: node.step.outputVar, success: false };
        }
      }));
    }

    // Update usage count
    try {
      const db = getDb();
      db.prepare('UPDATE tool_chains SET usage_count = usage_count + 1 WHERE name = ?').run(name);
    } catch { /* silent */ }

    logger.info({ name, duration: Date.now() - start, errors }, 'Tool chain executed');
    return outputs;
  }

  getChain(name: string): ToolChain | null {
    const cached = this.chainCache.get(name);
    if (cached) return cached.chain;

    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM tool_chains WHERE name = ?').get(name) as Record<string, unknown> | undefined;
      if (!row) return null;

      const chain: ToolChain = {
        id: String(row.id),
        name: row.name as string,
        steps: JSON.parse(row.steps_json as string),
        description: row.description as string,
        createdAt: row.created_at as string,
        usageCount: row.usage_count as number,
      };

      const optimized = this.optimize(chain);
      this.chainCache.set(name, { chain, optimized });
      return chain;
    } catch {
      return null;
    }
  }

  listChains(): ToolChain[] {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM tool_chains ORDER BY usage_count DESC').all() as Array<Record<string, unknown>>;
      return rows.map(r => ({
        id: String(r.id),
        name: r.name as string,
        steps: JSON.parse(r.steps_json as string),
        description: r.description as string,
        createdAt: r.created_at as string,
        usageCount: r.usage_count as number,
      }));
    } catch {
      return [];
    }
  }

  /* ── Chain validation ────────────────────────────────────── */

  private validateChain(steps: ToolChainStep[]): void {
    const declaredVars = new Set<string>();
    for (const step of steps) {
      for (const dep of step.dependsOn) {
        if (!declaredVars.has(dep)) {
          throw new Error(`Step "${step.outputVar}" depends on "${dep}" which is not declared`);
        }
      }
      if (declaredVars.has(step.outputVar)) {
        throw new Error(`Duplicate output variable "${step.outputVar}"`);
      }
      declaredVars.add(step.outputVar);
    }
  }

  /* ── DAG optimization ────────────────────────────────────── */

  private optimize(chain: ToolChain): ExecNode[] {
    const deps = new Map<string, string[]>();

    for (const step of chain.steps) {
      deps.set(step.outputVar, step.dependsOn);
    }

    const levels = this.topologicalSort(chain.steps, deps);

    const optimized: ExecNode[] = [];
    for (const level of levels) {
      const parallelSteps = level.map(step => ({
        step,
        ready: true,
        result: null,
        error: null,
      }));
      optimized.push(...parallelSteps);
    }

    return optimized;
  }

  private topologicalSort(
    steps: ToolChainStep[],
    deps: Map<string, string[]>,
  ): ToolChainStep[][] {
    const visited = new Set<string>();
    const levels: ToolChainStep[][] = [];

    const remaining = new Set(steps.map(s => s.outputVar));

    while (remaining.size > 0) {
      const level: ToolChainStep[] = [];

      for (const step of steps) {
        if (!remaining.has(step.outputVar)) continue;
        const stepDeps = deps.get(step.outputVar) ?? [];
        if (stepDeps.every(d => !remaining.has(d) || visited.has(d))) {
          level.push(step);
        }
      }

      if (level.length === 0) break;

      for (const step of level) {
        remaining.delete(step.outputVar);
        visited.add(step.outputVar);
      }

      levels.push(level);
    }

    return levels;
  }
}
