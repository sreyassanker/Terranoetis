import { getDb } from '../db/index';
import { logger } from '../observability/logger';
import { dynamicTools } from './toolGenerator';
import { toolRepair } from './toolRepair';

// ── Types ───────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  data: unknown;
  error: string | null;
  fallbackUsed: boolean;
  fallbackType: 'retry' | 'fallback_tool' | 'synthetic_approximation' | 'graceful_error' | null;
  latencyMs: number;
  retryCount: number;
  syntheticConfidence?: number;
}

export interface ExecutionLog {
  id?: number;
  toolName: string;
  inputJson: string;
  outputJson: string;
  success: number;
  errorMsg: string | null;
  fallbackType: string | null;
  latencyMs: number;
  retryCount: number;
  createdAt?: string;
}

const RETRY_DELAYS = [1000, 3000, 7000];
const MAX_RETRIES = 3;

// ── Synthetic fallback data — REMOVED ──────────────────────────────
// Never generate fake data. Return error instead.

// ── SelfHealingExecutor ─────────────────────────────────────────

export class SelfHealingExecutor {
  private executionLog: ExecutionLog[] = [];

  init(): void {
    this.ensureTable();
    logger.info('SelfHealingExecutor initialized');
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS execution_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output_json TEXT NOT NULL DEFAULT '{}',
        success INTEGER NOT NULL DEFAULT 0,
        error_msg TEXT,
        fallback_type TEXT,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    } catch { /* table exists */ }
  }

  async execute(
    toolName: string,
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal; allowSynthetic?: boolean },
  ): Promise<ExecutionResult> {
    const start = Date.now();
    let lastError: string | null = null;
    let fallbackUsed = false;
    let fallbackType: ExecutionResult['fallbackType'] = null;
    let data: unknown = null;

    // Phase 1: Retry loop
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        fallbackUsed = true;
        fallbackType = 'retry';
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1] || 5000));
      }

      try {
        data = await dynamicTools.execute(toolName, input, options?.signal);
        const latencyMs = Date.now() - start;

        this.log({ toolName, input, data, success: true, error: null, fallbackType, latencyMs, retryCount: attempt });
        return { success: true, data, error: null, fallbackUsed, fallbackType: attempt > 0 ? 'retry' : null, latencyMs, retryCount: attempt };
      } catch (e) {
        lastError = (e as Error).message;
        logger.warn({ tool: toolName, attempt: attempt + 1, err: lastError }, 'Tool execution failed, retrying');
      }
    }

    // Phase 2: Fallback tool
    const fallbackTool = this.findFallback(toolName);
    if (fallbackTool) {
      try {
        data = await dynamicTools.execute(fallbackTool, input, options?.signal);
        const latencyMs = Date.now() - start;

        this.log({ toolName, input, data, success: true, error: null, fallbackType: 'fallback_tool', latencyMs, retryCount: MAX_RETRIES });
        logger.info({ tool: toolName, fallback: fallbackTool }, 'Fallback tool succeeded');
        return { success: true, data, error: null, fallbackUsed: true, fallbackType: 'fallback_tool', latencyMs, retryCount: MAX_RETRIES };
      } catch { /* fallback also failed */ }
    }

    // All retries and fallbacks exhausted — return error, NEVER fake data
    const latencyMs = Date.now() - start;
    this.log({ toolName, input, data: null, success: false, error: lastError, fallbackType: 'graceful_error', latencyMs, retryCount: MAX_RETRIES });
    logger.error({ tool: toolName, err: lastError }, 'All execution paths exhausted');
    return { success: false, data: null, error: lastError, fallbackUsed: false, fallbackType: 'graceful_error', latencyMs, retryCount: MAX_RETRIES };
  }

  /* ── Fallback resolution ─────────────────────────────────── */

  private findFallback(toolName: string): string | null {
    const tool = dynamicTools.get(toolName);
    if (!tool) return null;

    const lower = toolName.toLowerCase();
    const fallbackMap: Record<string, string[]> = {
      earthquakes: ['significant_quakes', 'gdacs'],
      significant_quakes: ['earthquakes'],
      weather_forecast: ['weather_alerts'],
      storms: ['weather_alerts'],
      aircraft: ['airports'],
      wildfires: ['floods', 'gdacs'],
      volcanoes: ['gdacs'],
      firms_fires: ['wildfires'],
    };

    const fallbacks = fallbackMap[lower];
    if (fallbacks) {
      for (const f of fallbacks) {
        const fbTool = dynamicTools.get(f);
        if (fbTool) return f;
      }
    }

    // Generic fallback: any tool in same category
    const sameCategory = dynamicTools.list(tool.category).filter(t => t.name !== toolName);
    if (sameCategory.length > 0) return sameCategory[0].name;

    return null;
  }

  /* ── Background repair ───────────────────────────────────── */

  private async attemptRepair(toolName: string): Promise<void> {
    try {
      const tool = dynamicTools.get(toolName);
      if (!tool || tool.source === 'core') return;

      // Test the tool with a simple call
      const testInput: Record<string, unknown> = {};
      if (tool.schema.params) {
        for (const key of Object.keys(tool.schema.params)) {
          testInput[key] = 'test';
        }
      }

      const resp = await fetch(tool.schema.endpoint || '', {
        method: tool.schema.method || 'GET',
        signal: AbortSignal.timeout(10000),
      });

      if (resp.ok) {
        const sampleResponse = await resp.json();
        await toolRepair.autoRepair(toolName, sampleResponse);
      }
    } catch (e) {
      logger.warn({ tool: toolName, err: (e as Error).message }, 'Background repair failed');
    }
  }

  /* ── Logging ─────────────────────────────────────────────── */

  private log(params: {
    toolName: string;
    input: Record<string, unknown>;
    data: unknown;
    success: boolean;
    error: string | null;
    fallbackType: string | null;
    latencyMs: number;
    retryCount: number;
  }): void {
    const log: ExecutionLog = {
      toolName: params.toolName,
      inputJson: JSON.stringify(params.input),
      outputJson: JSON.stringify(params.data ?? {}),
      success: params.success ? 1 : 0,
      errorMsg: params.error ? params.error.slice(0, 500) : null,
      fallbackType: params.fallbackType,
      latencyMs: params.latencyMs,
      retryCount: params.retryCount,
    };

    this.executionLog.push(log);
    if (this.executionLog.length > 1000) this.executionLog.shift();

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO execution_log (tool_name, input_json, output_json, success, error_msg, fallback_type, latency_ms, retry_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(log.toolName, log.inputJson, log.outputJson, log.success, log.errorMsg, log.fallbackType, log.latencyMs, log.retryCount);
    } catch { /* silent */ }
  }

  getLogs(toolName?: string, limit = 50): ExecutionLog[] {
    try {
      const db = getDb();
      let sql = 'SELECT * FROM execution_log';
      const params: unknown[] = [];
      if (toolName) { sql += ' WHERE tool_name = ?'; params.push(toolName); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      return db.prepare(sql).all(...params) as ExecutionLog[];
    } catch {
      return [];
    }
  }

  getStats(): Record<string, { total: number; success: number; failure: number; avgLatency: number }> {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT tool_name,
               COUNT(*) as total,
               SUM(success) as success_count,
               AVG(CASE WHEN success = 1 THEN latency_ms ELSE NULL END) as avg_latency
        FROM execution_log GROUP BY tool_name
      `).all() as Array<{ tool_name: string; total: number; success_count: number; avg_latency: number | null }>;

      const stats: Record<string, { total: number; success: number; failure: number; avgLatency: number }> = {};
      for (const row of rows) {
        stats[row.tool_name] = {
          total: row.total,
          success: row.success_count,
          failure: row.total - row.success_count,
          avgLatency: row.avg_latency || 0,
        };
      }
      return stats;
    } catch {
      return {};
    }
  }
}

export const executor = new SelfHealingExecutor();
