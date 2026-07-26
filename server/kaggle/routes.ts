/**
 * Kaggle Simulation API Routes
 *
 * POST /api/kaggle/simulate         — Start a simulation on Kaggle GPU
 * GET  /api/kaggle/simulate/:id     — Get simulation status
 * GET  /api/kaggle/simulate/:id/stream — SSE stream for real-time status
 * GET  /api/kaggle/simulate/:id/results — Download simulation results
 * GET  /api/kaggle/jobs             — List all active jobs
 * GET  /api/kaggle/kernels          — List available kernel types
 */

import { Router, type Request, type Response } from 'express';
import {
  startSimulation,
  getJobStatus,
  getAllJobs,
  loadResults,
  streamJobStatus,
  type SimulationType,
  type SimulationParams,
} from './simRunner';
import path from 'path';
import fs from 'fs';

const router = Router();

// ═════════════════════════════════════════════════════════════════
// POST /api/kaggle/simulate — Start a new simulation
// ═════════════════════════════════════════════════════════════════

router.post('/simulate', async (req: Request, res: Response) => {
  try {
    const params: SimulationParams = req.body;

    if (!params.type) {
      return res.status(400).json({ error: 'Missing required field: type' });
    }
    if (params.lat === undefined || params.lon === undefined) {
      return res.status(400).json({ error: 'Missing required fields: lat, lon' });
    }

    const validTypes: SimulationType[] = [
      'flood_inundation', 'wildfire_spread', 'earthquake_swarm',
      'tsunami_wave', 'hurricane_landfall', 'volcanic_eruption',
      'landslide',
    ];
    if (!validTypes.includes(params.type)) {
      return res.status(400).json({
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
      });
    }

    const job = await startSimulation(params);

    res.json({
      jobId: job.id,
      status: job.status,
      type: job.type,
      streamUrl: `/api/kaggle/simulate/${job.id}/stream`,
      createdAt: job.createdAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════
// GET /api/kaggle/simulate/:id — Get job status
// ═════════════════════════════════════════════════════════════════

router.get('/simulate/:id', (req: Request, res: Response) => {
  const job = getJobStatus(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    jobId: job.id,
    type: job.type,
    status: job.status,
    params: job.params,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    error: job.error,
  });
});

// ═════════════════════════════════════════════════════════════════
// GET /api/kaggle/simulate/:id/stream — SSE real-time status
// ═════════════════════════════════════════════════════════════════

router.get('/simulate/:id/stream', (req: Request, res: Response) => {
  streamJobStatus(req.params.id, res);
});

// ═════════════════════════════════════════════════════════════════
// GET /api/kaggle/simulate/:id/results — Get simulation results
// ═════════════════════════════════════════════════════════════════

router.get('/simulate/:id/results', (req: Request, res: Response) => {
  const job = getJobStatus(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (job.status !== 'complete') {
    return res.status(409).json({ error: `Job not complete (status: ${job.status})` });
  }

  const results = loadResults(req.params.id);
  if (!results) {
    return res.status(404).json({ error: 'Results not found on disk' });
  }

  res.json(results);
});

// ═════════════════════════════════════════════════════════════════
// GET /api/kaggle/simulate/:id/grid/:name — Download a result grid as .npy
// ═════════════════════════════════════════════════════════════════

router.get('/simulate/:id/grid/:name', (req: Request, res: Response) => {
  const job = getJobStatus(req.params.id);
  if (!job?.resultPath) {
    return res.status(404).json({ error: 'Results not found' });
  }

  const gridName = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(job.resultPath, `${gridName}.npy`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `Grid "${gridName}" not found` });
  }

  // Serve as JSON if client sends Accept: application/json
  if (req.accepts('json') === 'json' || req.query.format === 'json') {
    try {
      const buf = fs.readFileSync(filePath);
      // Parse .npy header
      const magic = buf.slice(0, 6).toString('ascii');
      if (magic !== '\x93NUMPY') {
        return res.status(400).json({ error: 'Not a valid .npy file' });
      }
      const major = buf[6];
      const headerLen = major >= 2
        ? buf.readUInt32LE(8)
        : buf.readUInt16LE(8);
      const headerStart = major >= 2 ? 12 : 10; // v2: 4-byte length; v1: 2-byte length
      const headerStr = buf.slice(headerStart, headerStart + headerLen).toString('ascii');
      const dtypeMatch = headerStr.match(/'dtype':\s*'([^']+)'/);
      const shapeMatch = headerStr.match(/'shape':\s*\(([^)]+)\)/);
      const dtype = dtypeMatch?.[1] || '<f4';
      const shape = shapeMatch?.[1].split(',').map(Number).filter(n => !isNaN(n)) || [];
      const dataStart = headerStart + headerLen;
      const dataBuf = buf.slice(dataStart);

      let values: number[];
      if (dtype === '<f4' || dtype === 'float32') {
        const count = dataBuf.length / 4;
        values = new Array(count);
        for (let i = 0; i < count; i++) values[i] = dataBuf.readFloatLE(i * 4);
      } else if (dtype === '<f8' || dtype === 'float64') {
        const count = dataBuf.length / 8;
        values = new Array(count);
        for (let i = 0; i < count; i++) values[i] = dataBuf.readDoubleLE(i * 8);
      } else if (dtype === '<i4' || dtype === 'int32') {
        const count = dataBuf.length / 4;
        values = new Array(count);
        for (let i = 0; i < count; i++) values[i] = dataBuf.readInt32LE(i * 4);
      } else {
        return res.status(400).json({ error: `Unsupported dtype: ${dtype}` });
      }

      return res.json({ shape, dtype, values });
    } catch (err: any) {
      return res.status(500).json({ error: `Failed to parse .npy: ${err.message}` });
    }
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${gridName}.npy"`);
  fs.createReadStream(filePath).pipe(res);
});

// ═════════════════════════════════════════════════════════════════
// GET /api/kaggle/jobs — List all active jobs
// ═════════════════════════════════════════════════════════════════

router.get('/jobs', (_req: Request, res: Response) => {
  const jobs = getAllJobs();
  res.json({
    jobs: jobs.map(j => ({
      jobId: j.id,
      type: j.type,
      status: j.status,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
    })),
    total: jobs.length,
  });
});

// ═════════════════════════════════════════════════════════════════
// GET /api/kaggle/kernels — List available kernel types
// ═════════════════════════════════════════════════════════════════

router.get('/kernels', (_req: Request, res: Response) => {
  const kernelsDir = path.resolve(process.cwd(), 'kaggle-kernels');
  const types = [
    'flood-sim', 'fire-sim', 'earthquake-sim',
    'tsunami-sim', 'hurricane-sim', 'volcano-sim',
  ];

  const available = types.map(t => {
    const dir = path.join(kernelsDir, t);
    const metaPath = path.join(dir, 'kernel-metadata.json');
    let metadata: Record<string, unknown> = {};
    if (fs.existsSync(metaPath)) {
      try { metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}
    }
    return {
      name: t,
      exists: fs.existsSync(dir),
      slug: (metadata as any).id || `sreyassanker/${t}`,
      title: (metadata as any).title || t,
      gpu: (metadata as any).enable_gpu ?? false,
    };
  });

  res.json({ kernels: available });
});

export default router;
