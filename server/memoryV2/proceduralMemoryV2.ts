import { getDb } from '../db/index';
import { logger } from '../observability/logger';

// ── Types ───────────────────────────────────────────────────────

export interface ProcedureTemplate {
  id: number;
  triggerCondition: string;
  toolChain: string[];
  successRate: number;
  avgLatency: number;
  lastUsed: string;
  usageCount: number;
  abstracted: boolean;
}

export interface ToolStep {
  action: string;
  params: Record<string, string>;
  description: string;
}

// ── ProceduralMemoryV2 ─────────────────────────────────────────

export class ProceduralMemoryV2 {
  init(): void {
    this.ensureTable();
    logger.info('ProceduralMemoryV2 initialized');
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS procedural_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger_condition TEXT NOT NULL,
        tool_chain_json TEXT NOT NULL,
        success_rate REAL NOT NULL DEFAULT 1.0,
        avg_latency REAL NOT NULL DEFAULT 0,
        last_used TEXT NOT NULL DEFAULT (datetime('now')),
        usage_count INTEGER NOT NULL DEFAULT 1,
        abstracted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_procedural_v2_trigger ON procedural_v2(trigger_condition)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_procedural_v2_success ON procedural_v2(success_rate DESC)`);
    } catch (e) { logger.warn({ err: (e as Error).message }, 'ProceduralMemory tables may already exist'); }
  }

  record(toolChain: ToolStep[], success: boolean, latencyMs: number): number | null {
    try {
      const trigger = this.buildTriggerCondition(toolChain);
      const chainJson = JSON.stringify(toolChain.map(s => s.action));
      const db = getDb();

      const existing = db.prepare(
        'SELECT id, success_rate, usage_count, avg_latency FROM procedural_v2 WHERE trigger_condition = ? AND tool_chain_json = ?'
      ).get(trigger, chainJson) as { id: number; success_rate: number; usage_count: number; avg_latency: number } | undefined;

      if (existing) {
        const newCount = existing.usage_count + 1;
        const newRate = ((existing.success_rate * existing.usage_count) + (success ? 1 : 0)) / newCount;
        const newLatency = ((existing.avg_latency * existing.usage_count) + latencyMs) / newCount;

        db.prepare(`
          UPDATE procedural_v2 SET
            success_rate = ?, avg_latency = ?, usage_count = ?, last_used = datetime('now')
          WHERE id = ?
        `).run(newRate, newLatency, newCount, existing.id);

        // Auto-abstract if used 3+ times
        if (newCount >= 3 && !this.isAbstracted(existing.id)) {
          this.abstract(existing.id);
        }

        return existing.id;
      } else {
        const result = db.prepare(`
          INSERT INTO procedural_v2 (trigger_condition, tool_chain_json, success_rate, avg_latency, usage_count)
          VALUES (?, ?, ?, ?, ?)
        `).run(trigger, chainJson, success ? 1.0 : 0.0, latencyMs, 1);

        return result.lastInsertRowid as number;
      }
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Failed to record procedure');
      return null;
    }
  }

  find(intentType: string, limit = 5): ProcedureTemplate[] {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM procedural_v2
        WHERE trigger_condition LIKE ? AND success_rate >= 0.5
        ORDER BY success_rate DESC, usage_count DESC, last_used DESC
        LIMIT ?
      `).run(`%${intentType}%`, limit) as unknown as Array<Record<string, unknown>>;

      return rows.map(r => this.rowToProcedure(r));
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Failed to query procedures');
      return [];
    }
  }

  findByTrigger(trigger: string, limit = 3): ProcedureTemplate[] {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM procedural_v2
        WHERE trigger_condition LIKE ? AND success_rate >= 0.5
        ORDER BY usage_count DESC, last_used DESC
        LIMIT ?
      `).run(`%${trigger}%`, limit) as unknown as Array<Record<string, unknown>>;

      return rows.map(r => this.rowToProcedure(r));
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Failed to query procedures');
      return [];
    }
  }

  topProcedures(limit = 10): ProcedureTemplate[] {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM procedural_v2
        ORDER BY success_rate DESC, usage_count DESC
        LIMIT ?
      `).all(limit) as Array<Record<string, unknown>>;

      return rows.map(r => this.rowToProcedure(r));
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Failed to query procedures');
      return [];
    }
  }

  recordFailure(id: number): void {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT success_rate, usage_count FROM procedural_v2 WHERE id = ?')
        .get(id) as { success_rate: number; usage_count: number } | undefined;

      if (existing) {
        const newCount = existing.usage_count + 1;
        const newRate = (existing.success_rate * existing.usage_count) / newCount;
        db.prepare('UPDATE procedural_v2 SET success_rate = ?, usage_count = ? WHERE id = ?')
          .run(newRate, newCount, id);
      }
    } catch (e) { logger.error({ err: (e as Error).message }, 'Failed in procedural memory operation'); }
  }

  private abstract(procedureId: number): void {
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM procedural_v2 WHERE id = ?').get(procedureId) as Record<string, unknown> | undefined;
      if (!row) return;

      const chain = JSON.parse(row.tool_chain_json as string) as string[];
      const abstractedChain = chain.map(step =>
        step.replace(/\b(tokyo|paris|london|new york|mumbai)\b/gi, '{location}')
            .replace(/M\d+(\.\d+)?/gi, '{magnitude}')
            .replace(/-?\d+\.?\d*/g, '{value}')
      );

      db.prepare(`
        INSERT INTO procedural_v2 (trigger_condition, tool_chain_json, success_rate, avg_latency, usage_count, abstracted)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(
        `${(row.trigger_condition as string)} (abstracted)`,
        JSON.stringify(abstractedChain),
        row.success_rate,
        row.avg_latency,
        row.usage_count,
      );

      db.prepare('UPDATE procedural_v2 SET abstracted = 1 WHERE id = ?').run(procedureId);
      logger.info({ id: procedureId }, 'Procedure abstracted to variable form');
    } catch (e) { logger.error({ err: (e as Error).message }, 'Failed in procedural memory operation'); }
  }

  private isAbstracted(id: number): boolean {
    try {
      const db = getDb();
      const row = db.prepare('SELECT abstracted FROM procedural_v2 WHERE id = ?').get(id) as { abstracted: number } | undefined;
      return row?.abstracted === 1;
    } catch (e) {
      logger.error({ err: (e as Error).message, id }, 'Failed to check if procedure is abstracted');
      return false;
    }
  }

  private buildTriggerCondition(toolChain: ToolStep[]): string {
    if (toolChain.length === 0) return 'unknown';
    const first = toolChain[0];
    const last = toolChain[toolChain.length - 1];
    const descriptors = toolChain.map(t => t.action).join('_');
    return `${first.description}_to_${last.description}_${descriptors}`.toLowerCase().replace(/\s+/g, '_').slice(0, 200);
  }

  private rowToProcedure(row: Record<string, unknown>): ProcedureTemplate {
    return {
      id: row.id as number,
      triggerCondition: row.trigger_condition as string,
      toolChain: JSON.parse(row.tool_chain_json as string || '[]') as string[],
      successRate: row.success_rate as number,
      avgLatency: row.avg_latency as number,
      lastUsed: row.last_used as string,
      usageCount: row.usage_count as number,
      abstracted: (row.abstracted as number) === 1,
    };
  }
}

export const proceduralMemoryV2 = new ProceduralMemoryV2();
