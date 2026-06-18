// ═══════════════════════════════════════════════════════════════════════
// PHASE 7.1: MCP Server — Model Context Protocol
// Exposes all Earth Intelligence tools via JSON-RPC over HTTP.
// Compatible with MCP clients (Claude Desktop, Cursor, etc.)
// ═══════════════════════════════════════════════════════════════════════

import { ToolRegistry } from './agent';
import { SandboxManager } from './sandboxManager';

const SERVER_INFO = {
  name: 'earth-intelligence-mcp',
  version: '1.0.0',
};

// ── Types ───────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

// ── MCP Server ──────────────────────────────────────────────────────

export class MCPServer {
  private registry: ToolRegistry;
  private sandbox: SandboxManager;

  constructor(registry: ToolRegistry, sandbox: SandboxManager) {
    this.registry = registry;
    this.sandbox = sandbox;
  }

  /**
   * Handle an incoming JSON-RPC request.
   */
  async handle(body: unknown): Promise<JsonRpcResponse> {
    const req = body as JsonRpcRequest;
    if (!req || req.jsonrpc !== '2.0' || !req.method) {
      return this.error(null, -32600, 'Invalid Request — must be valid JSON-RPC 2.0');
    }

    try {
      switch (req.method) {
        case 'initialize':
          return this.ok(req.id, {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              resources: {},
            },
            serverInfo: SERVER_INFO,
          });

        case 'tools/list':
          return this.ok(req.id, { tools: this.listTools() });

        case 'tools/call':
          return this.callTool(req.id, (req.params?.name as string) || '', (req.params?.arguments as Record<string, unknown>) || {});

        case 'resources/list':
          return this.ok(req.id, { resources: [] });

        case 'ping':
          return this.ok(req.id, 'pong');

        case 'notifications/initialized':
          return this.ok(req.id, true);

        default:
          return this.error(req.id, -32601, `Method not found: ${req.method}`);
      }
    } catch (e) {
      return this.error(req.id, -32603, `Internal error: ${(e as Error).message}`);
    }
  }

  /**
   * Convert AgentTool[] to MCP tool format.
   */
  private listTools() {
    return this.registry.list().map(tool => {
      // Build input schema from tool params
      const properties: Record<string, { type: string; description: string }> = {};
      if (tool.schema.params) {
        for (const [key, desc] of Object.entries(tool.schema.params)) {
          properties[key] = { type: 'string', description: desc };
        }
      }
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: 'object',
          properties,
          required: Object.keys(properties).length > 0 ? Object.keys(properties) : undefined,
        },
      };
    });
  }

  /**
   * Execute an MCP tool call.
   */
  private async callTool(id: number | string, name: string, args: Record<string, unknown>): Promise<JsonRpcResponse> {
    const tool = this.registry.get(name);
    if (!tool) {
      return this.error(id, -32602, `Unknown tool: ${name}. Available: ${this.registry.list().map(t => t.name).join(', ')}`);
    }

    try {
      switch (tool.schema.type) {
        case 'api': {
          const baseUrl = `http://127.0.0.1:${process.env.PROXY_PORT || 3001}`;
          let url = `${baseUrl}${tool.schema.endpoint || `/${name}`}`;
          // Substitute params into URL
          if (tool.schema.params && args) {
            for (const [key] of Object.entries(tool.schema.params)) {
              if (args[key]) url = url.replace(`{${key}}`, String(args[key])).replace(`${key}=X`, `${key}=${args[key]}`);
            }
          }
          const resp = await fetch(url, {
            method: tool.schema.method || 'GET',
            signal: AbortSignal.timeout(15000),
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            return this.error(id, -32000, `API error ${resp.status}: ${errText.slice(0, 500)}`);
          }
          const data = await resp.text();
          // Try to parse as JSON for cleaner output
          try {
            return this.ok(id, { content: [{ type: 'json', data: JSON.parse(data) }] });
          } catch {
            return this.ok(id, { content: [{ type: 'text', data: data.slice(0, 50000) }] });
          }
        }

        case 'sandbox': {
          const language = (args.language as string) || 'python';
          const code = (args.code as string);
          const cloud = args.cloud as boolean | undefined;
          if (!code) return this.error(id, -32602, 'code argument required for sandbox execution');
          const result = await this.sandbox.execute({ language: language as 'python' | 'node' | 'bash', code, cloud, timeout: 30000 });
          return this.ok(id, { content: [{ type: 'text', data: result.stdout || result.stderr }] });
        }

        case 'command': {
          // Return command info — the caller needs to know what commands are available
          return this.ok(id, { content: [{ type: 'text', data: `Command tool "${name}": ${tool.description}` }] });
        }

        default:
          return this.ok(id, { content: [{ type: 'text', data: tool.description }] });
      }
    } catch (e) {
      return this.error(id, -32000, `Tool execution failed: ${(e as Error).message}`);
    }
  }

  private ok(id: number | string | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private error(id: number | string | null, code: number, message: string, data?: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message, data } };
  }
}
