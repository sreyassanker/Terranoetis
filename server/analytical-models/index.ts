import express from 'express';
import { EQUATION_ENGINE } from './engine';
import { computeWithContext } from './contextEngine';

export function registerAnalyticalModelsRoutes(app: express.Express): void {
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
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Computation failed' });
    }
  });

  app.get('/api/analytical-models', (_req: express.Request, res: express.Response) => {
    res.json({ implemented: Object.keys(EQUATION_ENGINE).map(Number) });
  });
}
