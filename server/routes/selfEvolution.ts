import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireRole } from '../middleware/auth';
import { perUserRateLimiter } from '../middleware/rateLimiter';
import type { IntentDiscoveryV2 } from '../self-evolution/intentDiscoveryV2';
import type { BanditRouter } from '../self-evolution/banditRouter';
import type { PerfMonitor } from '../self-evolution/perfMonitor';
import type { GitIntegration } from '../self-evolution/gitIntegration';

export function createSelfEvolutionRouter(deps: {
  intentDiscovery: IntentDiscoveryV2;
  banditRouter: BanditRouter;
  perfMonitor: PerfMonitor;
  gitIntegration: GitIntegration;
}): Router {
  const router = Router();
  const selfEvoUserRateLimit = perUserRateLimiter(10, 60000);

  router.get('/status', selfEvoUserRateLimit, async (_req: Request, res: Response) => {
    try {
      const banditStats = deps.banditRouter.getStats();
      const drifts = deps.perfMonitor.detectDrift();
      const hasUncommitted = await deps.gitIntegration.hasUncommittedChanges();
      const currentBranch = await deps.gitIntegration.getCurrentBranch();
      res.json({
        banditStats,
        drifts,
        git: { currentBranch, hasUncommitted },
        perf: { totalRequests: deps.perfMonitor.getTotalRequests(), intents: deps.perfMonitor.getIntents() },
        proposals: deps.intentDiscovery.getAllProposals().length,
        pendingProposals: deps.intentDiscovery.getPendingProposals().length,
      });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get('/proposals', selfEvoUserRateLimit, (_req: Request, res: Response) => {
    try {
      const proposals = deps.intentDiscovery.getAllProposals();
      res.json({ proposals, count: proposals.length });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.post('/approve', selfEvoUserRateLimit, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const { proposalId, approve } = req.body;
      if (!proposalId) return res.status(400).json({ error: 'proposalId required' });
      const result = await deps.intentDiscovery.humanApproval(proposalId, approve);
      res.json({ approved: result, proposalId });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  router.get('/bandit-stats', selfEvoUserRateLimit, (_req: Request, res: Response) => {
    try {
      const stats = deps.banditRouter.getStats();
      res.json({ arms: stats, totalPulls: stats.reduce((s, a) => s + a.pulls, 0) });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  return router;
}
