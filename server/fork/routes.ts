import express from 'express';
import { forkManager } from './manager';
import type { ForkCreateRequest } from './types';

export const forkRouter = express.Router();

forkRouter.post('/create', (req, res) => {
  try {
    const body = req.body as ForkCreateRequest;
    if (!body.name || typeof body.lat !== 'number' || typeof body.lon !== 'number') {
      res.status(400).json({ error: 'Missing required fields: name, lat, lon' });
      return;
    }
    const userId = ((req as unknown as Record<string, unknown>).userId as string) || 'anonymous';
    const fork = forkManager.createFork(body, userId);
    res.status(201).json({
      forkId: fork.forkId,
      name: fork.name,
      status: fork.status,
      divergenceScore: fork.divergenceScore,
      bufferRadiusM: fork.bufferRadiusM,
    });
  } catch (err) {
    console.error('[FORK-API] Create failed:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

forkRouter.get('/list', (_req, res) => {
  try {
    const forks = forkManager.getAllForks().map(f => ({
      forkId: f.forkId,
      name: f.name,
      status: f.status,
      divergenceScore: f.divergenceScore,
      simulatedTimeMs: f.simulatedTimeMs,
      maxSimulationHours: f.maxSimulationHours,
      createdAt: f.createdAt,
    }));
    res.json({ forks, count: forks.length });
  } catch (err) {
    console.error('[FORK-API] List failed:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

forkRouter.get('/:forkId', (req, res) => {
  try {
    const fork = forkManager.getFork(req.params.forkId);
    if (!fork) { res.status(404).json({ error: 'Fork not found' }); return; }
    const state = forkManager.getForkState(req.params.forkId);
    res.json({ fork, state: { entityCount: Object.keys(state?.entities || {}).length, eventCount: state?.events?.length || 0 } });
  } catch (err) {
    console.error('[FORK-API] Get failed:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

forkRouter.post('/:forkId/pause', (req, res) => {
  try {
    forkManager.pauseFork(req.params.forkId);
    res.json({ forkId: req.params.forkId, status: 'paused' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

forkRouter.post('/:forkId/resume', (req, res) => {
  try {
    forkManager.resumeFork(req.params.forkId);
    res.json({ forkId: req.params.forkId, status: 'running' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

forkRouter.post('/:forkId/terminate', (req, res) => {
  try {
    forkManager.terminateFork(req.params.forkId, 'user_request');
    res.json({ forkId: req.params.forkId, status: 'terminated' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
