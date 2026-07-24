import express from 'express';
import { EQUATION_ENGINE } from './engine';
import { computeWithContext } from './contextEngine';
import { TOOLS_PART1, TOOLS_PART2, TOOLS_PART3, TOOLS_PART4, type ToolWorkflowDef } from './perToolDefs';
import { getToolConfig } from './toolConfigs';

const ALL_TOOL_DEFS: Record<number, ToolWorkflowDef> = {
  ...TOOLS_PART1,
  ...TOOLS_PART2,
  ...TOOLS_PART3,
  ...TOOLS_PART4,
};

export function registerAnalyticalModelsRoutes(app: express.Express): void {
  app.get('/api/analytical-models', (_req: express.Request, res: express.Response) => {
    res.json({ implemented: Object.keys(EQUATION_ENGINE).map(Number) });
  });

  // Natural-language search for analytical model equation IDs
  app.get('/api/analytical-models/search', (req: express.Request, res: express.Response) => {
    const query = (req.query.q as string || '').toLowerCase().trim();
    if (!query) {
      const all = Object.entries(ALL_TOOL_DEFS).map(([id, def]) => ({
        id: Number(id),
        name: def.name,
        vizType: def.vizType,
      }));
      return res.json({ results: all, count: all.length });
    }
    const results = Object.entries(ALL_TOOL_DEFS)
      .filter(([, def]) => def.name.toLowerCase().includes(query))
      .map(([id, def]) => ({
        id: Number(id),
        name: def.name,
        vizType: def.vizType,
      }))
      .slice(0, 20);
    res.json({ results, count: results.length, query });
  });

  // Get detailed info about a specific analytical model
  app.get('/api/analytical-models/:id', (req: express.Request, res: express.Response) => {
    const id = Number(req.params.id);
    const def = ALL_TOOL_DEFS[id];
    if (!def) {
      return res.status(404).json({ error: `Analytical model ${id} not found` });
    }
    const config = getToolConfig(id);
    res.json({
      id,
      name: def.name,
      vizType: def.vizType,
      visualizationType: config?.visualizationType,
      qcValidRange: config?.qcValidRange,
      preprocessingNotes: config?.preprocessingNotes,
      dependencies: config?.dependencies,
    });
  });

  app.post('/api/analytical-models/:id/execute', async (req: express.Request, res: express.Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid equation id' });
    }
    const inputs: Record<string, number> = req.body?.inputs ?? {};
    const context = req.body?.context;
    try {
      const result = await computeWithContext(id, inputs, context);
      if (!result) {
        return res.status(404).json({ error: `Equation ${id} not implemented` });
      }
      return res.json({
        id,
        result: result.result,
        unit: result.unit,
        steps: result.steps,
        dataSource: result.dataSource,
        location: result.location,
        log: result.log,
        warnings: result.warnings,
        grid: result.grid,
        fetchedParams: result.fetchedParams,
        validation: result.validation,
        qualityControl: result.qualityControl,
        uncertainty: result.uncertainty,
        interpretation: result.interpretation,
        workflowLog: result.workflowLog,
        dataQualityScore: result.dataQualityScore,
        processingTimeMs: result.processingTimeMs,
        visualizationType: result.visualizationType,
        preprocessingNotes: result.preprocessingNotes,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Computation failed' });
    }
  });
}
