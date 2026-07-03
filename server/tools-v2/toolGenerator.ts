import { getDb } from '../db/index';
import { omninet } from '../ai-router/omninet';
import { logger } from '../observability/logger';

// ── Types ───────────────────────────────────────────────────────

export type ToolType = 'api' | 'sandbox' | 'command' | 'function';

export interface ToolSchema {
  type: ToolType;
  endpoint?: string;
  method?: string;
  params?: Record<string, string>;
  outputFormat?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface DynamicTool {
  id?: number;
  name: string;
  description: string;
  category: string;
  exampleQueries: string[];
  schema: ToolSchema;
  code: string | null;
  version: number;
  status: 'active' | 'disabled' | 'testing';
  healthStatus: 'healthy' | 'degraded' | 'unknown';
  source: 'core' | 'generated' | 'discovered';
  createdAt: string;
  updatedAt: string;
}

// ── DynamicToolRegistry ─────────────────────────────────────────

export class DynamicToolRegistry {
  private tools = new Map<string, DynamicTool>();
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.ensureTable();
    this.loadFromDb();
    this.initialized = true;
    logger.info({ toolCount: this.tools.size }, 'DynamicToolRegistry initialized');
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS dynamic_tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        example_queries TEXT NOT NULL DEFAULT '[]',
        schema_json TEXT NOT NULL,
        code TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        health_status TEXT NOT NULL DEFAULT 'unknown',
        source TEXT NOT NULL DEFAULT 'core',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      db.exec(`CREATE TABLE IF NOT EXISTS tool_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name TEXT NOT NULL,
        version INTEGER NOT NULL,
        code TEXT,
        schema_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(tool_name, version)
      )`);
    } catch { /* tables exist */ }
  }

  register(tool: Omit<DynamicTool, 'id' | 'version' | 'status' | 'healthStatus' | 'createdAt' | 'updatedAt'>): number {
    const existing = this.tools.get(tool.name);
    const version = existing ? existing.version + 1 : 1;

    const fullTool: DynamicTool = {
      ...tool,
      version,
      status: 'active',
      healthStatus: 'unknown',
      source: tool.source ?? 'core',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.tools.set(tool.name, fullTool);

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO dynamic_tools (name, description, category, example_queries, schema_json, code, version, status, health_status, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          description = excluded.description, category = excluded.category,
          example_queries = excluded.example_queries, schema_json = excluded.schema_json,
          code = excluded.code, version = excluded.version,
          status = excluded.status, health_status = excluded.health_status,
          updated_at = datetime('now')
      `).run(
        tool.name, tool.description, tool.category,
        JSON.stringify(tool.exampleQueries), JSON.stringify(tool.schema),
        tool.code ?? null, version, 'active', 'unknown', tool.source ?? 'core',
      );

      // Archive previous version
      if (existing) {
        db.prepare(`
          INSERT OR IGNORE INTO tool_versions (tool_name, version, code, schema_json)
          VALUES (?, ?, ?, ?)
        `).run(existing.name, existing.version, existing.code, JSON.stringify(existing.schema));
      }
    } catch (e) {
      logger.error({ err: (e as Error).message, tool: tool.name }, 'Failed to persist tool');
    }

    return version;
  }

  async generateTool(
    description: string,
    inputSchema: Record<string, unknown>,
    outputSchema: Record<string, unknown>,
  ): Promise<DynamicTool | null> {
    const prompt = `You are a tool generator. Create a JavaScript async function that does the following:

Description: ${description}

Input schema: ${JSON.stringify(inputSchema)}
Output schema: ${JSON.stringify(outputSchema)}

Rules:
- Use only fetch() and standard JavaScript (no imports)
- The function receives a single object argument with the input fields
- Return an object matching the output schema
- Include error handling with try/catch
- Use AbortSignal.timeout(15000) for fetch calls
- Output ONLY valid JSON: {"name":"tool_name","code":"function code here","description":"brief description","category":"api|compute|transform"}

Example format:
{"name":"fetch_weather","code":"async function fetchWeather({lat, lon}) { const resp = await fetch('https://api.example.com/weather?lat='+lat+'&lon='+lon, {signal: AbortSignal.timeout(15000)}); if (!resp.ok) throw new Error('HTTP '+resp.status); const data = await resp.json(); return {temperature: data.main.temp, humidity: data.main.humidity}; }","description":"Fetch weather data for coordinates","category":"api"}`;

    try {
      const raw = await omninet.generateText(prompt, { temperature: 0.2, maxTokens: 2048 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as { name: string; code: string; description: string; category: string };

      const tool: Omit<DynamicTool, 'id' | 'version' | 'status' | 'healthStatus' | 'createdAt' | 'updatedAt'> = {
        name: this.sanitizeName(parsed.name),
        description: parsed.description,
        category: parsed.category || 'general',
        exampleQueries: [description.slice(0, 50)],
        schema: {
          type: 'function',
          inputSchema,
          outputSchema,
        },
        code: this.sanitizeCode(parsed.code),
        source: 'generated',
      };

      const version = this.register(tool);
      logger.info({ tool: tool.name, version }, 'New tool generated via LLM');
      return this.get(tool.name);
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'Tool generation failed');
      return null;
    }
  }

  async execute(toolName: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const tool = this.get(toolName);
    if (!tool) throw new Error(`Tool "${toolName}" not found`);

    if (tool.source === 'core') {
      return this.executeCoreTool(tool, input, signal);
    }

    if (tool.code && (tool.source === 'generated' || tool.source === 'discovered')) {
      return this.executeGeneratedCode(tool, input, signal);
    }

    if (tool.schema.type === 'api') {
      return this.executeApiCall(tool, input, signal);
    }

    throw new Error(`Cannot execute tool "${toolName}": no executable code or API endpoint`);
  }

  private async executeCoreTool(tool: DynamicTool, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (tool.schema.type === 'api' && tool.schema.endpoint) {
      const url = this.interpolateUrl(tool.schema.endpoint, input);
      const method = tool.schema.method || 'GET';

      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        signal: signal || AbortSignal.timeout(15000),
      });
      if (!resp.ok) throw new Error(`Tool "${tool.name}" HTTP ${resp.status}`);
      return resp.json();
    }

    if (tool.schema.type === 'command') {
      return { action: tool.name, ...input };
    }

    throw new Error(`Core tool "${tool.name}" has no executable path`);
  }

  private async executeGeneratedCode(tool: DynamicTool, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    try {
      const fn = this.compileFunction(tool.code!);
      const result = await fn(input, signal);
      return result;
    } catch (e) {
      logger.warn({ tool: tool.name, err: (e as Error).message }, 'Generated tool execution failed');
      throw e;
    }
  }

  private compileFunction(code: string): (input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown> {
    const asyncFn = new Function(
      'input', 'signal',
      `return (async () => { ${code} })()`,
    ) as (input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;

    return asyncFn;
  }

  private async executeApiCall(tool: DynamicTool, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const url = this.interpolateUrl(tool.schema.endpoint || '', input);
    const method = tool.schema.method || 'GET';

    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: signal || AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Tool "${tool.name}" HTTP ${resp.status}`);
    return resp.json();
  }

  get(name: string): DynamicTool | null {
    return this.tools.get(name) ?? null;
  }

  list(category?: string): DynamicTool[] {
    const all = Array.from(this.tools.values());
    if (category) return all.filter(t => t.category === category && t.status === 'active');
    return all.filter(t => t.status === 'active');
  }

  listByCategory(): Record<string, DynamicTool[]> {
    const grouped: Record<string, DynamicTool[]> = {};
    for (const tool of this.list()) {
      if (!grouped[tool.category]) grouped[tool.category] = [];
      grouped[tool.category].push(tool);
    }
    return grouped;
  }

  remove(name: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;
    if (tool.source === 'core') return false; // cannot delete core tools
    this.tools.delete(name);
    try {
      const db = getDb();
      db.prepare('UPDATE dynamic_tools SET status = ? WHERE name = ?').run('disabled', name);
    } catch { /* silent */ }
    return true;
  }

  disable(name: string): void {
    const tool = this.tools.get(name);
    if (!tool) return;
    tool.status = 'disabled';
    try {
      const db = getDb();
      db.prepare('UPDATE dynamic_tools SET status = ? WHERE name = ?').run('disabled', name);
    } catch { /* silent */ }
  }

  enable(name: string): void {
    const tool = this.tools.get(name);
    if (!tool) return;
    tool.status = 'active';
    try {
      const db = getDb();
      db.prepare('UPDATE dynamic_tools SET status = ? WHERE name = ?').run('active', name);
    } catch { /* silent */ }
  }

  rollback(name: string, targetVersion: number): DynamicTool | null {
    try {
      const db = getDb();
      const version = db.prepare(
        'SELECT * FROM tool_versions WHERE tool_name = ? AND version = ?'
      ).get(name, targetVersion) as Record<string, unknown> | undefined;

      if (!version) return null;

      const tool = this.tools.get(name);
      if (!tool) return null;

      tool.code = version.code as string | null;
      tool.schema = JSON.parse(version.schema_json as string);
      tool.version = targetVersion;
      tool.updatedAt = new Date().toISOString();

      db.prepare(`
        UPDATE dynamic_tools SET code = ?, schema_json = ?, version = ?, updated_at = datetime('now')
        WHERE name = ?
      `).run(tool.code, JSON.stringify(tool.schema), targetVersion, name);

      return tool;
    } catch {
      return null;
    }
  }

  updateHealth(name: string, status: 'healthy' | 'degraded' | 'unknown'): void {
    const tool = this.tools.get(name);
    if (!tool) return;
    tool.healthStatus = status;
    try {
      const db = getDb();
      db.prepare('UPDATE dynamic_tools SET health_status = ? WHERE name = ?').run(status, name);
    } catch { /* silent */ }
  }

  search(query: string): DynamicTool[] {
    const lower = query.toLowerCase();
    return this.list().filter(t =>
      t.name.toLowerCase().includes(lower) ||
      t.description.toLowerCase().includes(lower) ||
      t.exampleQueries.some(q => q.toLowerCase().includes(lower))
    );
  }

  private loadFromDb(): void {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT * FROM dynamic_tools WHERE status != 'disabled'")
        .all() as Array<Record<string, unknown>>;

      for (const row of rows) {
        const tool: DynamicTool = {
          id: row.id as number,
          name: row.name as string,
          description: row.description as string,
          category: row.category as string,
          exampleQueries: JSON.parse(row.example_queries as string || '[]'),
          schema: JSON.parse(row.schema_json as string),
          code: row.code as string | null,
          version: row.version as number,
          status: row.status as DynamicTool['status'],
          healthStatus: row.health_status as DynamicTool['healthStatus'],
          source: row.source as DynamicTool['source'],
          createdAt: row.created_at as string,
          updatedAt: row.updated_at as string,
        };
        this.tools.set(tool.name, tool);
      }
    } catch { /* silent */ }
  }

  private sanitizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 64);
  }

  private sanitizeCode(code: string): string {
    if (code.startsWith('async function') || code.startsWith('function')) {
      return code;
    }
    return `async function generatedTool(input, signal) { ${code} }`;
  }

  private interpolateUrl(endpoint: string, input: Record<string, unknown>): string {
    let url = endpoint;
    for (const [key, value] of Object.entries(input)) {
      url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
    }
    return url;
  }
}

export const dynamicTools = new DynamicToolRegistry();
