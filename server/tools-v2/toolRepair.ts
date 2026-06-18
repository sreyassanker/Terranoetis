import { getDb } from '../db/index';
import { omninet } from '../ai-router/omninet';
import { logger } from '../observability/logger';
import { dynamicTools } from './toolGenerator';

// ── Types ───────────────────────────────────────────────────────

interface SchemaDiff {
  field: string;
  expectedType: string;
  actualType: string;
  expectedValue?: unknown;
  actualValue?: unknown;
}

interface RepairResult {
  toolName: string;
  success: boolean;
  diffs: SchemaDiff[];
  repaired: boolean;
  newVersion: number | null;
  error?: string;
}

// ── ToolRepair ───────────────────────────────────────────────────

export class ToolRepair {
  private repairTimers = new Map<string, ReturnType<typeof setTimeout>>();

  init(): void {
    logger.info('ToolRepair initialized');
  }

  async detectSchemaDrift(toolName: string, sampleResponse: unknown): Promise<SchemaDiff[]> {
    const tool = dynamicTools.get(toolName);
    if (!tool) return [];

    const diffs: SchemaDiff[] = [];
    const expectedSchema = tool.schema.outputSchema;
    if (!expectedSchema) return [];

    this.compareValues(expectedSchema, sampleResponse as Record<string, unknown>, '', diffs);
    return diffs;
  }

  async autoRepair(toolName: string, sampleResponse: unknown): Promise<RepairResult> {
    const tool = dynamicTools.get(toolName);
    if (!tool) return { toolName, success: false, diffs: [], repaired: false, error: 'Tool not found' };

    const diffs = await this.detectSchemaDrift(toolName, sampleResponse);

    if (diffs.length === 0) {
      dynamicTools.updateHealth(toolName, 'healthy');
      return { toolName, success: true, diffs: [], repaired: false };
    }

    logger.warn({ tool: toolName, diffCount: diffs.length }, 'Schema drift detected, attempting repair');

    try {
      const newSchema = await this.generateFixedSchema(tool, diffs, sampleResponse);

      if (tool.code) {
        const fixedCode = await this.fixToolCode(tool, diffs, newSchema);
        if (fixedCode) {
          const newVersion = dynamicTools.register({
            name: tool.name,
            description: tool.description,
            category: tool.category,
            exampleQueries: tool.exampleQueries,
            schema: { ...tool.schema, outputSchema: newSchema },
            code: fixedCode,
            source: tool.source,
          });

          dynamicTools.updateHealth(toolName, 'healthy');
          logger.info({ tool: toolName, version: newVersion }, 'Tool auto-repaired');
          return { toolName, success: true, diffs, repaired: true, newVersion };
        }
      } else {
        const newVersion = dynamicTools.register({
          name: tool.name,
          description: tool.description,
          category: tool.category,
          exampleQueries: tool.exampleQueries,
          schema: { ...tool.schema, outputSchema: newSchema },
          code: null,
          source: tool.source,
        });

        dynamicTools.updateHealth(toolName, 'healthy');
        return { toolName, success: true, diffs, repaired: true, newVersion };
      }
    } catch (e) {
      logger.error({ tool: toolName, err: (e as Error).message }, 'Auto-repair failed');
      dynamicTools.updateHealth(toolName, 'degraded');
      return { toolName, success: false, diffs, repaired: false, error: (e as Error).message };
    }

    return { toolName, success: false, diffs, repaired: false, error: 'Unable to repair' };
  }

  // ── Schema comparison ──────────────────────────────────────

  private compareValues(
    expected: Record<string, unknown>,
    actual: Record<string, unknown>,
    prefix: string,
    diffs: SchemaDiff[],
  ): void {
    for (const [key, expVal] of Object.entries(expected)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      const actVal = actual[key];

      if (actVal === undefined) {
        diffs.push({
          field: fullPath,
          expectedType: typeof expVal,
          actualType: 'undefined',
          expectedValue: expVal,
          actualValue: undefined,
        });
        continue;
      }

      const expType = Array.isArray(expVal) ? 'array' : typeof expVal;
      const actType = Array.isArray(actVal) ? 'array' : typeof actVal;

      if (expType !== actType) {
        diffs.push({
          field: fullPath,
          expectedType: expType,
          actualType: actType,
          expectedValue: expVal,
          actualValue: actVal,
        });
      }

      if (expType === 'object' && actType === 'object' && expVal && actVal) {
        this.compareValues(
          expVal as Record<string, unknown>,
          actVal as Record<string, unknown>,
          fullPath,
          diffs,
        );
      }
    }
  }

  // ── LLM-based schema/code fix ──────────────────────────────

  private async generateFixedSchema(
    tool: { name: string; description: string; schema: { inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown> } },
    diffs: SchemaDiff[],
    sampleResponse: unknown,
  ): Promise<Record<string, unknown>> {
    const prompt = `You are a schema repair AI. Given a tool definition and a sample response that doesn't match the expected schema, generate the corrected output schema.

Tool name: ${tool.name}
Tool description: ${tool.description}
Expected output schema: ${JSON.stringify(tool.schema.outputSchema, null, 2)}
Schema diffs detected: ${JSON.stringify(diffs, null, 2)}
Actual sample response: ${JSON.stringify(sampleResponse, null, 2).slice(0, 2000)}

Return ONLY valid JSON representing the corrected output schema (a JSON object with field names and their expected types/structures).`;

    try {
      const raw = await omninet.generateText(prompt, { temperature: 0.1, maxTokens: 1024 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No valid JSON in LLM response');
      return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`Schema generation failed: ${(e as Error).message}`);
    }
  }

  private async fixToolCode(
    tool: { name: string; description: string; code: string },
    diffs: SchemaDiff[],
    newSchema: Record<string, unknown>,
  ): Promise<string | null> {
    const prompt = `You are a code repair AI. Fix the following tool code to match the new output schema.

Tool name: ${tool.name}
Tool description: ${tool.description}
Current code:
${tool.code}

Schema diffs:
${JSON.stringify(diffs, null, 2)}

New target output schema:
${JSON.stringify(newSchema, null, 2)}

Return ONLY valid JSON: {"fixedCode":"the corrected async function code"}.

Rules:
- Fix the return value structure to match the new schema
- Keep all external API calls identical
- Preserve error handling
- Only change what's necessary to match the schema`;

    try {
      const raw = await omninet.generateText(prompt, { temperature: 0.1, maxTokens: 2048 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]) as { fixedCode: string };
      return parsed.fixedCode || null;
    } catch {
      return null;
    }
  }
}

export const toolRepair = new ToolRepair();
