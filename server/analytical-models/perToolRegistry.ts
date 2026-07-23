/**
 * Per-Tool Workflow Registry
 * Merges all per-tool definitions from parts 1-4 into a single registry.
 * Every one of the 150 tools has its own complete scientific workflow definition.
 */

import { type ToolWorkflowDef, TOOLS_PART1, TOOLS_PART2, TOOLS_PART3, TOOLS_PART4 } from './perToolDefs';

/** The complete registry of all 150 per-tool workflow definitions. */
export const PER_TOOL_REGISTRY: Record<number, ToolWorkflowDef> = {
  ...TOOLS_PART1,
  ...TOOLS_PART2,
  ...TOOLS_PART3,
  ...TOOLS_PART4,
};

/** Returns the per-tool workflow definition for a given tool ID. */
export function getPerToolWorkflow(toolId: number): ToolWorkflowDef | undefined {
  return PER_TOOL_REGISTRY[toolId];
}

/** Returns the count of registered per-tool definitions. */
export function getRegisteredToolCount(): number {
  return Object.keys(PER_TOOL_REGISTRY).length;
}
