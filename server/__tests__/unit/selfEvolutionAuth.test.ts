import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import express from 'express';
import http from 'http';

process.env.JWT_SECRET = 'test-secret-key-at-least-32-characters-long';

describe('self-evolution approve RBAC', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    const { authGuard } = await import('../../middleware/auth');
    const { createSelfEvolutionRouter } = await import('../../routes/selfEvolution');
    const intentDiscovery = {
      humanApproval: vi.fn().mockResolvedValue(false),
      getAllProposals: () => [],
      getPendingProposals: () => [],
    };
    const banditRouter = { getStats: () => [] };
    const perfMonitor = {
      detectDrift: () => [],
      getTotalRequests: () => 0,
      getIntents: () => [],
    };
    const gitIntegration = {
      hasUncommittedChanges: async () => false,
      getCurrentBranch: async () => 'main',
    };

    const app = express();
    app.use(express.json());
    app.use('/api', (req, res, next) => authGuard(req, res, next));
    app.use(
      '/api/self-evolution',
      createSelfEvolutionRouter({ intentDiscovery, banditRouter, perfMonitor, gitIntegration } as never),
    );

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns 403 for non-admin role', async () => {
    const token = jwt.sign({ sub: 'user1', role: 'user' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
    const res = await fetch(`${base}/api/self-evolution/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId: 'p1', approve: false }),
    });
    expect(res.status).toBe(403);
  });

  it('allows admin role', async () => {
    const token = jwt.sign({ sub: 'admin', role: 'admin' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
    const res = await fetch(`${base}/api/self-evolution/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId: 'p1', approve: false }),
    });
    expect(res.status).toBe(200);
  });
});
