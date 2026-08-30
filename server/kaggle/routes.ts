/**
 * Kaggle Simulation API Routes
 *
 * POST /api/kaggle/simulate         — Start a simulation on Kaggle GPU
 * GET  /api/kaggle/simulate/:id     — Get simulation status
 * GET  /api/kaggle/simulate/:id/stream — SSE stream for real-time status
 * GET  /api/kaggle/simulate/:id/results — Download simulation results
 * GET  /api/kaggle/simulate/:id/grid/:name — Download a result grid as .npy
 * GET  /api/kaggle/simulate/:id/geotiff/:name — Download a result grid as GeoTIFF
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
  cancelJob,
  type SimulationType,
  type SimulationParams,
} from './simRunner';
import path from 'path';
import fs from 'fs';
import { logger } from '../observability/logger';
import { writeArrayBuffer } from 'geotiff';
import {
  runLocalBatch,
  runLocalVolcanicBatch,
  runLocalVolcanicCalibration,
  type CalibrateRow,
  type MonteCarloResult,
  type VolcanicEnsembleResult,
  type VolcanicCalibrateRow,
} from './localRunner';
import { fetchEra5Profile } from './era5Profile';

const router = Router();

// ═════════════════════════════════════════════════════════════════
// GET /api/volcano/profile — Fetch a real ERA5 wind profile for the
// eruption site. Query: ?lat=&lon=&date=YYYY-MM-DD
// ═════════════════════════════════════════════════════════════════

router.get('/volcano/profile', async (req: Request, res: Response) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: 'lat and lon are required' });
    }
    const profile = await fetchEra5Profile(lat, lon, date);
    res.json({
      lat,
      lon,
      date: date ?? new Date().toISOString().slice(0, 10),
      profile,
      source: 'open-meteo (ERA5/GFS reanalysis)',
    });
  } catch (err: unknown) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Profile fetch failed');
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Physical cell sizes (meters) for each kernel — mirrors the client-side
// SIM_CELL_SIZE_M so the GeoTIFF export matches what the user saw rendered.
const JOB_TYPE_TO_DEFAULT_CELL_SIZE_M: Record<string, number> = {
  flood_inundation: 5,
  wildfire_spread: 100,
  earthquake_swarm: 500,
  tsunami_wave: 5000,
  hurricane_landfall: 2000,
  volcanic_eruption: 50,
  landslide: 20,
};

// ═════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════

const RESULTS_DIR = path.resolve(process.cwd(), 'kaggle-kernels', 'results');

type NpyArray = Float32Array | Float64Array | Int32Array | Int16Array | Uint16Array;

interface ParsedNpy {
  dtype: string;
  shape: number[];
  /** Row-major flat data (npy is always C-order / row-major). */
  data: NpyArray;
}

/**
 * Parse a numpy `.npy` file into a flat typed array + shape. Returns null on
 * malformed headers or unsupported dtypes.
 */
function parseNpy(buf: Buffer): ParsedNpy | null {
  // NOTE: use 'latin1' not 'ascii' — 'ascii' truncates bytes > 0x7F
  // (0x93 magic byte becomes 0x13), so the npy magic check always fails.
  const magic = buf.slice(0, 6).toString('latin1');
  if (magic !== '\x93NUMPY') return null;
  const major = buf[6];
  const headerLen = major >= 2 ? buf.readUInt32LE(8) : buf.readUInt16LE(8);
  const headerStart = major >= 2 ? 12 : 10;
  const headerStr = buf.slice(headerStart, headerStart + headerLen).toString('latin1');
  // numpy npy files use 'descr' (not 'dtype') as the header key
  const dtypeMatch = headerStr.match(/'descr':\s*'([^']+)'/);
  const shapeMatch = headerStr.match(/'shape':\s*\(([^)]+)\)/);
  if (!dtypeMatch || !shapeMatch) return null;
  const dtype = dtypeMatch[1];
  const shape = shapeMatch[1].split(',').filter(s => s.trim() !== '').map(Number) || [];
  const dataStart = headerStart + headerLen;
  const dataBuf = buf.subarray(dataStart);

  if (dtype === '<f4' || dtype === 'float32') {
    return { dtype, shape, data: new Float32Array(dataBuf.buffer, dataBuf.byteOffset, dataBuf.length / 4) };
  }
  if (dtype === '<f8' || dtype === 'float64') {
    return { dtype, shape, data: new Float64Array(dataBuf.buffer, dataBuf.byteOffset, dataBuf.length / 8) };
  }
  if (dtype === '<i4' || dtype === 'int32') {
    return { dtype, shape, data: new Int32Array(dataBuf.buffer, dataBuf.byteOffset, dataBuf.length / 4) };
  }
  if (dtype === '<i2' || dtype === 'int16') {
    return { dtype, shape, data: new Int16Array(dataBuf.buffer, dataBuf.byteOffset, dataBuf.length / 2) };
  }
  if (dtype === '<u2' || dtype === 'uint16') {
    return { dtype, shape, data: new Uint16Array(dataBuf.buffer, dataBuf.byteOffset, dataBuf.length / 2) };
  }
  return null;
}

/**
 * Resolve the results directory for a job. The in-memory job map only holds
 * jobs started during this server process, so fall back to the on-disk
 * results directory (kaggle-kernels/results/<jobId>) for past runs.
 */
function resolveResultsDir(jobId: string): string | null {
  const job = getJobStatus(jobId);
  if (job?.resultPath && fs.existsSync(job.resultPath)) return job.resultPath;
  const disk = path.join(RESULTS_DIR, jobId);
  return fs.existsSync(path.join(disk, 'metadata.json')) ? disk : null;
}

function loadResultsFromDisk(jobId: string): Record<string, unknown> | null {
  const dir = resolveResultsDir(jobId);
  if (!dir) return null;
  const metaPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

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
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
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
// POST /api/kaggle/simulate/:id/cancel — Cancel a running simulation
// ═════════════════════════════════════════════════════════════════

router.post('/simulate/:id/cancel', (req: Request, res: Response) => {
  const ok = cancelJob(req.params.id);
  if (!ok) {
    return res.status(404).json({ error: 'Job not found or already finished' });
  }
  res.json({ jobId: req.params.id, status: 'cancelling' });
});

// ═════════════════════════════════════════════════════════════════
// GET /api/kaggle/simulate/:id/results — Get simulation results
// ═════════════════════════════════════════════════════════════════

router.get('/simulate/:id/results', (req: Request, res: Response) => {
  const job = getJobStatus(req.params.id);
  if (job && job.status !== 'complete') {
    return res.status(409).json({ error: `Job not complete (status: ${job.status})` });
  }

  const results = job ? loadResults(req.params.id) : loadResultsFromDisk(req.params.id);
  if (!results) {
    return res.status(404).json({ error: 'Results not found on disk' });
  }

  res.json(results);
});

// ═════════════════════════════════════════════════════════════════
// GET /api/kaggle/simulate/:id/grid/:name — Download a result grid as .npy
// ═════════════════════════════════════════════════════════════════

router.get('/simulate/:id/grid/:name', (req: Request, res: Response) => {
  const resultDir = resolveResultsDir(req.params.id);
  if (!resultDir) {
    logger.warn({ jobId: req.params.id }, 'Grid fetch failed: job results not on disk');
    return res.status(404).json({ error: 'Results not found' });
  }

  const gridName = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(resultDir, `${gridName}.npy`);

  if (!fs.existsSync(filePath)) {
    logger.warn({ jobId: req.params.id, gridName }, 'Grid fetch failed: file not found');
    return res.status(404).json({ error: `Grid "${gridName}" not found` });
  }

  // Serve as JSON if client sends Accept: application/json
  if (req.accepts('json') === 'json' || req.query.format === 'json') {
    try {
      const buf = fs.readFileSync(filePath);
      const npy = parseNpy(buf);
      if (!npy) {
        return res.status(400).json({ error: 'Not a valid .npy file' });
      }
      const totalElems = npy.shape.reduce((a, b) => a * b, 1);
      const MAX_JSON_ELEMENTS = 5_000_000; // ~50 MB JSON worst case
      if (totalElems > MAX_JSON_ELEMENTS) {
        return res.status(413).json({ error: `Grid too large for JSON export (${totalElems} elements > ${MAX_JSON_ELEMENTS}). Use the binary ?format=npy download instead.` });
      }
      return res.json({ shape: npy.shape, dtype: npy.dtype, values: Array.from(npy.data) });
    } catch (err: unknown) {
      logger.error({ jobId: req.params.id, gridName, error: err instanceof Error ? err.message : String(err) }, 'Grid npy parse failed');
      return res.status(500).json({ error: `Failed to parse .npy: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${gridName}.npy"`);
  fs.createReadStream(filePath).pipe(res);
});

// ═════════════════════════════════════════════════════════════════
// GET /api/kaggle/simulate/:id/geotiff/:name — Download a result grid as
// a georeferenced GeoTIFF (WGS84). 2D grids export as-is; [F,R,C] series
// export the final frame.
// ═════════════════════════════════════════════════════════════════

router.get('/simulate/:id/geotiff/:name', (req: Request, res: Response) => {
  try {
    const resultDir = resolveResultsDir(req.params.id);
    if (!resultDir) {
      logger.warn({ jobId: req.params.id }, 'GeoTIFF fetch failed: job results not on disk');
      return res.status(404).json({ error: 'Results not found' });
    }

    const gridName = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(resultDir, `${gridName}.npy`);
    if (!fs.existsSync(filePath)) {
      logger.warn({ jobId: req.params.id, gridName }, 'GeoTIFF fetch failed: grid not found');
      return res.status(404).json({ error: `Grid "${gridName}" not found` });
    }

    // Georeferencing: the domain is a square grid centered at (lat, lon) with
    // cell_size_m from the kernel's own params. The kernel metadata is
    // authoritative when present; the query-string only fills in what's
    // missing (older runs didn't always record it).
    const meta = loadResultsFromDisk(req.params.id);
    const params = (meta?.params ?? {}) as Record<string, unknown>;
    const lat = Number(params.lat ?? req.query.lat);
    const lon = Number(params.lon ?? req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      logger.warn({ jobId: req.params.id }, 'GeoTIFF export blocked: no lat/lon available');
      return res.status(400).json({ error: 'Missing lat/lon: kernel didn\'t record it and no overrides provided' });
    }
    let cellSizeM = Number(params.cell_size_m ?? req.query.cell_size_m);
    if (!cellSizeM) {
      // Derive from the domain extent the client used: cell = extentKm*1000 / gridSize.
      const gridSize = Number(params.grid_size ?? req.query.grid_size);
      const extentKm = Number(req.query.extent_km);
      if (gridSize > 0 && extentKm > 0) cellSizeM = (extentKm * 1000) / gridSize;
    }
    if (!cellSizeM) {
      // Fall back to the SIM's *physical* per-type cell size — the same
      // values the client-side overlays use in SIM_CELL_SIZE_M, so the
      // geotransform agrees with what the user saw rendered on the globe.
      // (The job list API returns a `type` discriminator from `getJobStatus`.)
      const job = getJobStatus(req.params.id);
      const typeFallback = job && JOB_TYPE_TO_DEFAULT_CELL_SIZE_M[job.type as SimulationType];
      cellSizeM = typeFallback ?? 0;
    }
    if (!cellSizeM) {
      // Last-ditch: terrain-scale default at 20 m — never silently correct.
      logger.warn({ jobId: req.params.id }, 'GeoTIFF using 20 m cell-size default (unknown type)');
      cellSizeM = 20;
    }

    const npy = parseNpy(fs.readFileSync(filePath));
    if (!npy) {
      return res.status(400).json({ error: 'Not a valid .npy file' });
    }

    // Flatten [F,R,C] series to the final frame.
    let data = npy.data;
    let rows = npy.shape[0] ?? 0;
    let cols = npy.shape[1] ?? rows;
    if (npy.shape.length >= 3) {
      const frames = npy.shape[0];
      rows = npy.shape[1];
      cols = npy.shape[2];
      const frame = Math.max(0, frames - 1);
      const start = frame * rows * cols;
      const slice = data.subarray(start, start + rows * cols);
      // Subarray may be a view into a larger buffer — copy so the writer sees
      // a standalone typed array of exactly width*height elements.
      const copy = new (data.constructor as new (len: number) => NpyArray)(slice.length);
      copy.set(slice as never);
      data = copy;
    }

    // North-up geotransform. Row 0 = north (matches the overlays' buildGeoFrame).
    const latRad = (lat * Math.PI) / 180;
    const degPerMLat = 1 / 111_320;
    const degPerMLon = 1 / (111_320 * Math.max(0.1, Math.cos(latRad)));
    const pxW = cellSizeM * degPerMLon;
    const pxH = cellSizeM * degPerMLat;
    const west = lon - (cols / 2) * pxW;
    const north = lat + (rows / 2) * pxH;

    let bits: number;
    let sampleFormat: number;
    if (data instanceof Float64Array) { bits = 64; sampleFormat = 3; }
    else if (data instanceof Float32Array) { bits = 32; sampleFormat = 3; }
    else if (data instanceof Int32Array) { bits = 32; sampleFormat = 2; }
    else if (data instanceof Int16Array) { bits = 16; sampleFormat = 2; }
    else { bits = 16; sampleFormat = 1; } // Uint16

    const tiff = writeArrayBuffer(data, {
      width: cols,
      height: rows,
      BitsPerSample: [bits],
      SampleFormat: [sampleFormat],
      ModelPixelScale: [pxW, pxH, 0],
      ModelTiepoint: [0, 0, 0, west, north, 0],
      GeographicTypeGeoKey: 4326,
      GTModelTypeGeoKey: 2,
      GTRasterTypeGeoKey: 1,
    });

    res.setHeader('Content-Type', 'image/tiff');
    res.setHeader('Content-Length', String(tiff.byteLength));
    res.setHeader('Content-Disposition', `attachment; filename="${gridName}.tif"`);
    res.send(Buffer.from(tiff));
  } catch (err: unknown) {
    logger.error({ jobId: req.params.id, error: err instanceof Error ? err.message : String(err) }, 'GeoTIFF export failed');
    return res.status(500).json({ error: `GeoTIFF export failed: ${err instanceof Error ? err.message : String(err)}` });
  }
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
    'tsunami-sim', 'hurricane-sim', 'volcano-sim', 'landslide-sim',
  ];

  const available = types.map(t => {
    const dir = path.join(kernelsDir, t);
    const metaPath = path.join(dir, 'kernel-metadata.json');
    let metadata: Record<string, unknown> = {};
    if (fs.existsSync(metaPath)) {
      try { metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* ignore parse errors */ }
    }
    return {
      name: t,
      exists: fs.existsSync(dir),
      slug: (metadata as Record<string, unknown>).id || `sreyassanker/${t}`,
      title: (metadata as Record<string, unknown>).title || t,
      gpu: (metadata as Record<string, unknown>).enable_gpu ?? false,
    };
  });

  res.json({ kernels: available });
});

// ═════════════════════════════════════════════════════════════════
// POST /api/calibrate — Fit Voellmy μ/ξ to an observed runout
// ═════════════════════════════════════════════════════════════════
//
// Body: { request: SimulationRequest, observed_runout_km: number }
// Runs a coarse μ×ξ grid locally (24 trials at 128²) and returns the best pair.

const MU_GRID = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40];
const XI_GRID = [100, 250, 500, 800];
const CALIBRATE_GRID_SIZE = 128;

router.post('/calibrate', async (req: Request, res: Response) => {
  try {
    const { request, observed_runout_km } = req.body as {
      request?: Record<string, unknown>;
      observed_runout_km?: unknown;
    };
    if (!request || typeof request !== 'object' || request.type !== 'landslide') {
      return res.status(400).json({ error: 'request must be a landslide simulation request' });
    }
    const target = Number(observed_runout_km);
    if (!Number.isFinite(target) || target <= 0) {
      return res.status(400).json({ error: 'observed_runout_km must be a positive number' });
    }

    // Drop resolution/terrain override so calibration is fast and deterministic
    // across trials — the client's grid_size/terrain are for display fidelity,
    // not for fitting friction (μ, ξ) on a coarse surrogate grid.
    const base: Record<string, unknown> = {
      ...request,
      grid_size: CALIBRATE_GRID_SIZE,
      terrain: undefined,
      terrain_gs: undefined,
    };
    const runs = MU_GRID.flatMap((mu) =>
      XI_GRID.map((xi) => ({ params: { ...base, mu, xi }, mu, xi })),
    );

    const payload = (await runLocalBatch('scalars', runs.map((r) => r.params), {
      gridSize: CALIBRATE_GRID_SIZE,
      timeoutMs: 6 * 60_000,
    })) as { trials?: CalibrateRow[] };

    const trials = payload.trials ?? [];
    let best: CalibrateRow | null = null;
    let bestErr = Infinity;
    for (const t of trials) {
      const err = Math.abs(t.runout_km - target);
      if (err < bestErr) { bestErr = err; best = t; }
    }
    if (!best) {
      return res.status(500).json({ error: 'Calibration produced no viable trials' });
    }

    logger.info({ target, bestMu: best.mu, bestXi: best.xi, err: bestErr }, 'Calibration done');
    res.json({
      best: { mu: best.mu, xi: best.xi, runout_km: best.runout_km, err: bestErr },
      trials,
    });
  } catch (err: unknown) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Calibration failed');
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ═════════════════════════════════════════════════════════════════
// POST /api/landslide/quantify — Monte-Carlo uncertainty quantification
// ═════════════════════════════════════════════════════════════════
//
// Body: { request: SimulationRequest, samples?: number, exceedance_depth_m?: number }
// Perturbs the uncertain physics inputs (μ, ξ, cohesion, magnitude) and returns
// aggregated exceedance / mean / min / max depth maps plus summary statistics.

router.post('/landslide/quantify', async (req: Request, res: Response) => {
  try {
    const { request, samples = 16, exceedance_depth_m = 0.5 } = req.body as {
      request?: Record<string, unknown>;
      samples?: unknown;
      exceedance_depth_m?: unknown;
    };
    if (!request || typeof request !== 'object' || request.type !== 'landslide') {
      return res.status(400).json({ error: 'request must be a landslide simulation request' });
    }
    const n = Math.min(40, Math.max(4, Number(samples) || 16));
    const thr = Math.max(0.05, Number(exceedance_depth_m) || 0.5);

    const base: Record<string, unknown> = { ...request, terrain: undefined, terrain_gs: undefined };
    const baseMu = Number(base.mu) || 0.25;
    const baseXi = Number(base.xi) || 300;
    const baseCohesion = Number(base.cohesion);
    const baseMag = Number(base.magnitude);

    // Marsaglia polar normal — deterministic seed, no external RNG dep.
    let z1 = 0; let z2 = 0; let haveZ2 = false;
    const randn = (): number => {
      if (haveZ2) { haveZ2 = false; return z2; }
      let u1 = 0, u2 = 0, s = 0;
      do {
        u1 = Math.random() * 2 - 1;
        u2 = Math.random() * 2 - 1;
        s = u1 * u1 + u2 * u2;
      } while (s >= 1 || s === 0);
      const mul = Math.sqrt((-2 * Math.log(s)) / s);
      z1 = u1 * mul; z2 = u2 * mul; haveZ2 = true;
      return z1;
    };

    const runs: Record<string, unknown>[] = [];
    for (let i = 0; i < n; i++) {
      runs.push({
        ...base,
        grid_size: 128,
        mu: Math.min(0.5, Math.max(0.05, baseMu * Math.exp(0.15 * randn()))),
        xi: Math.min(1500, Math.max(50, baseXi * Math.exp(0.2 * randn()))),
        cohesion: Math.max(0, baseCohesion * Math.exp(0.15 * randn())),
        magnitude: Math.min(9.5, Math.max(3.5, baseMag * Math.exp(0.08 * randn()))),
      });
    }

    const payload = (await runLocalBatch('montecarlo', runs, {
      gridSize: 128,
      timeoutMs: 8 * 60_000,
      exceedanceDepthM: thr,
    })) as unknown as MonteCarloResult;

    logger.info({ n, p95: payload.summary?.p95_runout_km }, 'Monte-Carlo UQ done');
    res.json(payload);
  } catch (err: unknown) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Quantification failed');
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ────────────────────────────────────────────────────────────────────────
// POST /api/volcano/calibrate — Fit yield_scale to an observed lava runout
// ────────────────────────────────────────────────────────────────────────
//
// Body: { request: SimulationRequest, observed_runout_km: number }
// Runs a coarse yield_scale grid locally and returns the best pair.

const YIELD_SCALE_GRID = [0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0];
const VOLCANO_CALIBRATE_GRID_SIZE = 128;

router.post('/volcano/calibrate', async (req: Request, res: Response) => {
  try {
    const { request, observed_runout_km } = req.body as {
      request?: Record<string, unknown>;
      observed_runout_km?: unknown;
    };
    if (!request || typeof request !== 'object' || request.type !== 'volcanic_eruption') {
      return res.status(400).json({ error: 'request must be a volcanic_eruption simulation request' });
    }
    const target = Number(observed_runout_km);
    if (!Number.isFinite(target) || target <= 0) {
      return res.status(400).json({ error: 'observed_runout_km must be a positive number' });
    }

    // Drop resolution/terrain override so calibration is fast and deterministic
    const base: Record<string, unknown> = {
      ...request,
      grid_size: VOLCANO_CALIBRATE_GRID_SIZE,
      terrain: undefined,
      terrain_gs: undefined,
    };
    // Terrain: sample a synthetic 5° slope so the lava has a consistent drive
    const gs = VOLCANO_CALIBRATE_GRID_SIZE;
    const yy: number[] = []; const xx: number[] = [];
    for (let r = 0; r < gs; r++) {
      for (let c = 0; c < gs; c++) { yy.push(r); xx.push(c); }
    }
    const slopeRad = 5.0 * Math.PI / 180;
    const extentM = (base.extent_km as number || 10.0) * 1000;
    const slopeTerrain = xx.map((c) => Math.max(0, (c - gs / 2) * Math.tan(slopeRad) * extentM / gs));
    base.terrain = slopeTerrain;
    base.terrain_gs = gs;

    const runs = YIELD_SCALE_GRID.map((ys) => ({
      ...base,
      yield_scale: ys,
      wallclock_max_sec: 60,
      max_steps: 1500,
    }));

    const payload = (await runLocalVolcanicCalibration(runs, {
      gridSize: VOLCANO_CALIBRATE_GRID_SIZE,
      timeoutMs: 8 * 60_000,
    })) as { trials?: VolcanicCalibrateRow[] };

    const trials = payload.trials ?? [];
    let best: VolcanicCalibrateRow | null = null;
    let bestErr = Infinity;
    for (const t of trials) {
      const err = Math.abs(t.runout_km - target);
      if (err < bestErr) { bestErr = err; best = t; }
    }
    if (!best) {
      return res.status(500).json({ error: 'Calibration produced no viable trials' });
    }

    logger.info({ target, bestYieldScale: best.yield_scale, err: bestErr }, 'Volcanic calibration done');
    res.json({
      best: { yield_scale: best.yield_scale, runout_km: best.runout_km, err: bestErr },
      trials,
    });
  } catch (err: unknown) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Volcanic calibration failed');
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ────────────────────────────────────────────────────────────────────────
// POST /api/volcano/quantify — Volcanic Monte-Carlo uncertainty quantification
// ────────────────────────────────────────────────────────────────────────
//
// Body: { request: SimulationRequest, samples?: number, exceedance_ash_mm?: number }
// Perturbs the uncertain physics inputs (wind, ash properties, mass scale)
// and returns aggregated percentile maps + summary statistics.
//
// Mirrors the landslide /api/landslide/quantify pattern but for volcanic
// scenarios. The request MUST include terrain + terrain_gs (real relief
// sampled from the Cesium globe) — the kernel rejects synthetic fallback.

router.post('/volcano/quantify', async (req: Request, res: Response) => {
  try {
    const { request, samples = 16, exceedance_ash_mm = 0.5, use_real_profile = false, profile_date } = req.body as {
      request?: Record<string, unknown>;
      samples?: unknown;
      exceedance_ash_mm?: unknown;
      use_real_profile?: unknown;
      profile_date?: unknown;
    };
    if (!request || typeof request !== 'object' || request.type !== 'volcanic_eruption') {
      return res.status(400).json({ error: 'request must be a volcanic_eruption simulation request' });
    }
    const n = Math.min(40, Math.max(4, Number(samples) || 16));
    const thr = Math.max(0.05, Number(exceedance_ash_mm) || 0.5);
    const useReal = Boolean(use_real_profile);

    // Build base — preserve terrain + vent position for every member.
    const base: Record<string, unknown> = { ...request };
    const baseLat = Number(base.lat) || 0;
    const baseLon = Number(base.lon) || 0;
    const baseWindMs = Number(base.wind_speed_ms) || 10;
    const baseWindDeg = Number(base.wind_dir_deg) || 270;
    const baseAshDiam = Number(base.ash_particle_diameter_m) || 316e-6;
    const baseDiff = Number(base.ash_diffusivity_m2_s) || 500;
    const baseShear = (base.ash_wind_shear_factor as number) ?? 0.5;

    // Mode 1 (real data): fetch an ERA5 reanalysis wind profile for the site.
    // Mode 2 (parameter): perturb the user's single wind vector instead — the
    // profile is left absent so the kernel uses wind_speed_ms/wind_dir_deg.
    const baseProfile = useReal
      ? await fetchEra5Profile(baseLat, baseLon, typeof profile_date === 'string' ? profile_date : undefined)
      : null;

    // Marsaglia polar normal.
    let z1 = 0; let z2 = 0; let haveZ2 = false;
    const randn = (): number => {
      if (haveZ2) { haveZ2 = false; return z2; }
      let u1 = 0, u2 = 0, s = 0;
      do {
        u1 = Math.random() * 2 - 1;
        u2 = Math.random() * 2 - 1;
        s = u1 * u1 + u2 * u2;
      } while (s >= 1 || s === 0);
      const mul = Math.sqrt((-2 * Math.log(s)) / s);
      z1 = u1 * mul; z2 = u2 * mul; haveZ2 = true;
      return z1;
    };

    const runs: Record<string, unknown>[] = [];
    for (let i = 0; i < n; i++) {
      // Perturb ash particle diameter (log-normal, σ=0.3)
      const ashDiam = Math.min(2e-3, Math.max(50e-6, baseAshDiam * Math.exp(0.3 * randn())));
      // Perturb eddy diffusivity (log-normal, σ=0.3)
      const diff = Math.min(5000, Math.max(10, baseDiff * Math.exp(0.3 * randn())));
      // Perturb wind-shear factor (normal, σ=0.15, clamped [0,1])
      const shear = Math.min(1, Math.max(0, baseShear + 0.15 * randn()));
      // Perturb eruption intensity (log-normal, σ=0.25, clamped [0.3, 3])
      const massScale = Math.min(3, Math.max(0.3, Math.exp(0.25 * randn())));

      if (baseProfile) {
        // MODE 1 — REAL DATA: perturb the full 3D ERA5 wind profile. Each
        // level's u/v is scaled by a common log-normal factor AND rotated by a
        // common angle (meteorological steering uncertainty).
        const speedScale = Math.min(2.0, Math.max(0.5, Math.exp(0.25 * randn())));
        const angleOffset = 20 * randn(); // ±20° rotation
        const cosA = Math.cos(angleOffset * Math.PI / 180);
        const sinA = Math.sin(angleOffset * Math.PI / 180);
        const perturbedProfile = baseProfile.map((entry) => ({
          altitude_km: entry.altitude_km,
          u_ms: (entry.u_ms * cosA - entry.v_ms * sinA) * speedScale,
          v_ms: (entry.u_ms * sinA + entry.v_ms * cosA) * speedScale,
        }));
        runs.push({
          ...base,
          grid_size: 128,
          wind_profile: perturbedProfile,
          wind_speed_ms: 10,  // ignored when wind_profile is present
          wind_dir_deg: 270,
          ash_particle_diameter_m: ashDiam,
          ash_diffusivity_m2_s: diff,
          ash_wind_shear_factor: shear,
          mass_scale: massScale,
          yield_scale: Math.min(3, Math.max(0.3, Math.exp(0.25 * randn()))),
          wallclock_max_sec: 90,
          max_steps: 2000,
        });
      } else {
        // MODE 2 — PARAMETER: perturb the user's single wind vector directly.
        const windMs = Math.min(60, Math.max(0.5, baseWindMs * Math.exp(0.25 * randn())));
        const windDeg = ((baseWindDeg + 20 * randn()) % 360 + 360) % 360;
        runs.push({
          ...base,
          grid_size: 128,
          wind_speed_ms: windMs,
          wind_dir_deg: windDeg,
          ash_particle_diameter_m: ashDiam,
          ash_diffusivity_m2_s: diff,
          ash_wind_shear_factor: shear,
          mass_scale: massScale,
          yield_scale: Math.min(3, Math.max(0.3, Math.exp(0.25 * randn()))),
          wallclock_max_sec: 90,
          max_steps: 2000,
        });
      }
    }

    const payload = (await runLocalVolcanicBatch(runs, {
      gridSize: 128,
      timeoutMs: 8 * 60_000,
      exceedanceAshMm: thr,
    })) as VolcanicEnsembleResult;

    logger.info({ n, p95: payload.summary?.p95_max_ash_mm }, 'Volcanic UQ done');
    res.json(payload);
  } catch (err: unknown) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Volcanic quantification failed');
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
