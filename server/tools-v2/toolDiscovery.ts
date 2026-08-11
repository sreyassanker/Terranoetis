import { getDb } from '../db/index';
import { omninet } from '../ai-router/omninet';
import { logger } from '../observability/logger';
import { dynamicTools, resolveToolUrl, type DynamicTool } from './toolGenerator';

// ── Types ───────────────────────────────────────────────────────

interface OpenApiSpec {
  info: { title: string; description?: string; version?: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  servers?: Array<{ url: string }>;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: 'query' | 'path' | 'header';
    required?: boolean;
    schema: { type: string; [key: string]: unknown };
    description?: string;
  }>;
  responses: Record<string, {
    description?: string;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  }>;
}

interface DiscoveredSource {
  name: string;
  url: string;
  type: 'openapi' | 'rss' | 'api';
  status: 'active' | 'disabled';
  lastHealthCheck: number;
}

// ── ToolDiscovery ───────────────────────────────────────────────

const API_DIRECTORIES = [
  'https://raw.githubusercontent.com/public-apis/public-apis/master/README.md',
  'https://api.nasa.gov/api.html',
  'https://earthquake.usgs.gov/fdsnws/event/1/',
];

export class ToolDiscovery {
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private sources: DiscoveredSource[] = [];
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  init(): void {
    this.ensureTable();
    this.loadSources();
    this.startHealthChecks();
    this.startPeriodicScan();
    logger.info('ToolDiscovery initialized');
  }

  private ensureTable(): void {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS discovered_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        url TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        last_health_check INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    } catch (e) { logger.warn({ err: e }, 'ToolDiscovery table creation'); }
  }

  /* ── OpenAPI spec scanning ───────────────────────────────── */

  async scanOpenApiSpec(url: string): Promise<DynamicTool[]> {
    const tools: DynamicTool[] = [];

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const spec = await resp.json() as OpenApiSpec;

      const baseUrl = spec.servers?.[0]?.url || '';
      const apiTitle = spec.info?.title || 'unknown';

      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, operation] of Object.entries(methods)) {
          try {
            const tool = this.openApiToTool(apiTitle, path, method as string, operation, baseUrl);
            if (tool) {
              dynamicTools.register(tool);
              tools.push(dynamicTools.get(tool.name)!);
            }
          } catch (e) { logger.warn({ err: e }, 'OpenAPI endpoint conversion failed'); }
        }
      }

      logger.info({ api: apiTitle, toolsGenerated: tools.length }, 'OpenAPI spec scanned');
    } catch (e) {
      logger.warn({ url, err: (e as Error).message }, 'OpenAPI scan failed');
    }

    return tools;
  }

  private openApiToTool(
    apiTitle: string,
    path: string,
    method: string,
    operation: OpenApiOperation,
    baseUrl: string,
  ): Omit<DynamicTool, 'id' | 'version' | 'status' | 'healthStatus' | 'createdAt' | 'updatedAt'> | null {
    const name = this.sanitizeName(
      operation.operationId || `${apiTitle}_${path.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]/g, '_')}`,
    );

    const params: Record<string, string> = {};
    for (const param of operation.parameters || []) {
      if (param.in === 'query' || param.in === 'path') {
        params[param.name] = param.schema?.type || 'string';
      }
    }

    const fullUrl = `${baseUrl}${path}`;

    return {
      name: `${apiTitle.toLowerCase().replace(/\s+/g, '_')}_${name}`.slice(0, 64),
      description: operation.summary || operation.description || `Endpoint ${method.toUpperCase()} ${path}`,
      category: apiTitle.toLowerCase(),
      exampleQueries: [operation.summary || path].filter(Boolean),
      schema: {
        type: 'api',
        endpoint: fullUrl,
        method: method.toUpperCase(),
        params: Object.keys(params).length > 0 ? params : undefined,
        outputFormat: operation.responses?.['200']?.content?.['application/json'] ? 'JSON' : 'unknown',
      },
      code: null,
      source: 'discovered',
    };
  }

  /* ── RSS feed scanning ───────────────────────────────────── */

  async scanRssFeed(url: string): Promise<DynamicTool | null> {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return null;
      const text = await resp.text();
      const title = text.match(/<title>([^<]*)<\/title>/)?.[1] || 'RSS Feed';

      const tool: Omit<DynamicTool, 'id' | 'version' | 'status' | 'healthStatus' | 'createdAt' | 'updatedAt'> = {
        name: this.sanitizeName(`rss_${title}`),
        description: `RSS feed: ${title}`,
        category: 'rss',
        exampleQueries: [title],
        schema: {
          type: 'api',
          endpoint: url,
          method: 'GET',
          outputFormat: 'XML',
        },
        code: null,
        source: 'discovered',
      };

      dynamicTools.register(tool);
      logger.info({ name: tool.name, url }, 'RSS feed registered as tool');
      return dynamicTools.get(tool.name);
    } catch (e) {
      logger.warn({ url, err: (e as Error).message }, 'RSS scan failed');
      return null;
    }
  }

  /* ── Public API directory scanning ───────────────────────── */

  async scanApiDirectories(): Promise<DynamicTool[]> {
    const allTools: DynamicTool[] = [];

    for (const dirUrl of API_DIRECTORIES) {
      try {
        const resp = await fetch(dirUrl, { signal: AbortSignal.timeout(10000) });
        if (!resp.ok) continue;
        const text = await resp.text();

        const prompt = `Extract API endpoints from this README. Return a JSON array of {name, description, url} for each notable free geospatial or weather API. Maximum 5.
        
        ${text.slice(0, 8000)}
        
        Return ONLY valid JSON array.`;

        const raw = await omninet.generateText(prompt, { temperature: 0.1, maxTokens: 1024 });
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (!jsonMatch) continue;

        const apis = JSON.parse(jsonMatch[0]) as Array<{ name: string; description: string; url: string }>;
        for (const api of apis.slice(0, 5)) {
          try {
            const resp = await fetch(api.url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
            if (!resp.ok) continue;

            const tool: Omit<DynamicTool, 'id' | 'version' | 'status' | 'healthStatus' | 'createdAt' | 'updatedAt'> = {
              name: this.sanitizeName(api.name),
              description: api.description.slice(0, 200),
              category: 'discovered',
              exampleQueries: [api.name],
              schema: { type: 'api', endpoint: api.url, method: 'GET' },
              code: null,
              source: 'discovered',
            };

            dynamicTools.register(tool);
            const registered = dynamicTools.get(tool.name);
            if (registered) allTools.push(registered);
          } catch (e) { logger.warn({ err: e }, 'Discovered API unreachable'); }
        }
      } catch (e) { logger.warn({ err: e }, 'API directory scan failed'); }
    }

    return allTools;
  }

  /* ── Test discovered tools ───────────────────────────────── */

  async testTool(name: string): Promise<boolean> {
    const tool = dynamicTools.get(name);
    if (!tool) return false;

    try {
      if (tool.schema.type === 'api' && tool.schema.endpoint) {
        const resp = await fetch(resolveToolUrl(tool.schema.endpoint), {
          method: tool.schema.method || 'GET',
          signal: AbortSignal.timeout(10000),
        });

        if (resp.ok) {
          dynamicTools.updateHealth(name, 'healthy');
          const source = this.sources.find(s => s.name === name);
          if (source) source.lastHealthCheck = Date.now();
          return true;
        } else {
          dynamicTools.updateHealth(name, 'degraded');
          return false;
        }
      }
      return true;
    } catch (e) {
      logger.warn({ err: e }, 'Tool health test failed');
      dynamicTools.updateHealth(name, 'degraded');
      return false;
    }
  }

  /* ── Registration ────────────────────────────────────────── */

  registerSource(name: string, url: string, type: DiscoveredSource['type']): void {
    this.sources.push({ name, url, type, status: 'active', lastHealthCheck: 0 });
    try {
      const db = getDb();
      db.prepare(`
        INSERT OR IGNORE INTO discovered_sources (name, url, type) VALUES (?, ?, ?)
      `).run(name, url, type);
    } catch (e) { logger.warn({ err: e }, 'ToolDiscovery registerSource failed'); }
  }

  /* ── Health monitoring ───────────────────────────────────── */

  private startHealthChecks(): void {
    this.healthTimer = setInterval(async () => {
      const tools = dynamicTools.list();
      for (const tool of tools.slice(0, 10)) {
        try {
          const healthy = await this.testTool(tool.name);
          if (!healthy) {
            logger.warn({ tool: tool.name }, 'Tool health check failed');
          }
        } catch (e) { logger.warn({ err: e }, 'Health check iteration failed'); }
      }
    }, 3600000);
  }

  private startPeriodicScan(): void {
    this.scanTimer = setInterval(() => {
      for (const source of this.sources) {
        if (source.type === 'openapi') {
          this.scanOpenApiSpec(source.url).catch(() => {});
        } else if (source.type === 'rss') {
          this.scanRssFeed(source.url).catch(() => {});
        }
      }
    }, 86400000);
  }

  /* ── Source management ───────────────────────────────────── */

  private loadSources(): void {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT * FROM discovered_sources WHERE status = 'active'")
        .all() as Array<Record<string, unknown>>;
      this.sources = rows.map(r => ({
        name: r.name as string,
        url: r.url as string,
        type: r.type as DiscoveredSource['type'],
        status: r.status as DiscoveredSource['status'],
        lastHealthCheck: r.last_health_check as number || 0,
      }));
    } catch (e) { logger.warn({ err: e }, 'ToolDiscovery loadSources failed'); }
  }

  getSources(): DiscoveredSource[] {
    return [...this.sources];
  }

  shutdown(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.scanTimer) clearInterval(this.scanTimer);
  }

  private sanitizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 64);
  }
}

export const toolDiscovery = new ToolDiscovery();
