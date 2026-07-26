/**
 * Kaggle GPU Integration — Batch physics simulation backend
 *
 * Workflow:
 * 1. Write params.json to kernel folder
 * 2. `kaggle kernels push` (triggers run on GPU)
 * 3. Poll `kaggle kernels status` until complete
 * 4. `kaggle kernels output` to download results
 * 5. Load results into frontend
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../observability/logger';

const execAsync = promisify(exec);

const KAGGLE_KERNELS_DIR = path.resolve(process.cwd(), 'kaggle-kernels');
const RESULTS_DIR = path.resolve(process.cwd(), 'kaggle-kernels', 'results');
const POLL_INTERVAL_MS = 15_000; // 15 seconds between status checks
const MAX_WAIT_MS = 600_000;     // 10 minutes max wait
const JOB_CLEANUP_AGE_MS = 3600_000; // 1 hour — remove completed jobs after this

// ═════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════

export type SimulationType =
  | 'flood_inundation'
  | 'wildfire_spread'
  | 'earthquake_swarm'
  | 'tsunami_wave'
  | 'hurricane_landfall'
  | 'volcanic_eruption'
  | 'landslide';

export interface SimulationParams {
  type: SimulationType;
  lat: number;
  lon: number;
  /** Grid resolution (default 512) */
  grid_size?: number;
  /** Duration in hours */
  duration_hours?: number;
  /** Type-specific params */
  [key: string]: unknown;
}

export interface SimulationJob {
  id: string;
  type: SimulationType;
  status: 'pending' | 'pushing' | 'running' | 'downloading' | 'complete' | 'error';
  params: SimulationParams;
  createdAt: string;
  completedAt?: string;
  kernelSlug?: string;
  error?: string;
  resultPath?: string;
  /** SSE callback for streaming status updates */
  onStatus?: (status: SimulationJob['status'], detail?: string) => void;
}

// Map simulation types to kernel folders AND their actual Kaggle slugs
// The slug is auto-generated from the title in kernel-metadata.json
const KERNEL_REGISTRY: Record<SimulationType, { folder: string; slug: string }> = {
  flood_inundation:     { folder: 'flood-sim',     slug: 'terranoetis-flood-swe-simulation' },
  wildfire_spread:      { folder: 'fire-sim',       slug: 'terranoetis-wildfire-spread-simulation' },
  earthquake_swarm:     { folder: 'earthquake-sim',  slug: 'terranoetis-earthquake-shakemap-simulation' },
  tsunami_wave:         { folder: 'tsunami-sim',     slug: 'terranoetis-tsunami-wave-propagation-simulation' },
  hurricane_landfall:   { folder: 'hurricane-sim',   slug: 'terranoetis-hurricane-wind-surge-simulation' },
  volcanic_eruption:    { folder: 'volcano-sim',     slug: 'terranoetis-volcanic-eruption-simulation' },
  landslide:            { folder: 'landslide-sim',   slug: 'terranoetis-landslide-debris-flow-simulation' },
};

// In-memory job tracking (with automatic cleanup)
const activeJobs = new Map<string, SimulationJob>();

// ═════════════════════════════════════════════════════════════════
// UTILITIES
// ═════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Periodically clean up old completed/errored jobs to prevent memory leaks.
 */
function startJobCleanup(): void {
  setInterval(() => {
    const now = Date.now();
    for (const [id, job] of activeJobs) {
      if (job.status === 'complete' || job.status === 'error') {
        const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : now;
        if (now - completedAt > JOB_CLEANUP_AGE_MS) {
          activeJobs.delete(id);
          logger.debug({ jobId: id }, 'Cleaned up old job');
        }
      }
    }
  }, JOB_CLEANUP_AGE_MS);
}
if (process.env.NODE_ENV !== 'test') startJobCleanup();

// ═════════════════════════════════════════════════════════════════
// KAGGLE CLI WRAPPER
// ═════════════════════════════════════════════════════════════════

async function kaggleCommand(cmd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 120_000, // 2 min for push commands
      env: { ...process.env, KAGGLE_CONFIG_DIR: path.join(process.env.HOME || '~', '.kaggle') },
    });
    if (stderr && !stderr.includes('Warning')) {
      logger.warn({ cmd, stderr }, 'Kaggle CLI stderr');
    }
    return stdout.trim();
  } catch (err: any) {
    logger.error({ cmd, error: err.message }, 'Kaggle CLI error');
    throw new Error(`Kaggle command failed: ${err.message}`);
  }
}

async function pushKernel(kernelDir: string): Promise<void> {
  await kaggleCommand(`kaggle kernels push -p "${kernelDir}"`);
}

async function getKernelStatus(ownerSlug: string): Promise<string> {
  const output = await kaggleCommand(`kaggle kernels status ${ownerSlug}`);
  // Output is one of: "running", "complete", "error", "cancel"
  return output.toLowerCase().trim();
}

async function downloadOutput(ownerSlug: string, outputDir: string): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });
  await kaggleCommand(`kaggle kernels output ${ownerSlug} -p "${outputDir}" --force`);
}

// ═════════════════════════════════════════════════════════════════
// SIMULATION JOB MANAGEMENT
// ═════════════════════════════════════════════════════════════════

function updateJobStatus(job: SimulationJob, status: SimulationJob['status'], detail?: string) {
  job.status = status;
  job.onStatus?.(status, detail);
  logger.info({ jobId: job.id, type: job.type, status, detail }, 'Simulation job status');
}

/**
 * Start a simulation job on Kaggle GPU.
 * Returns the job ID immediately; results come asynchronously.
 */
export async function startSimulation(params: SimulationParams): Promise<SimulationJob> {
  const jobId = `sim_${randomUUID().slice(0, 8)}`;
  const registry = KERNEL_REGISTRY[params.type];

  if (!registry) {
    throw new Error(`Unknown simulation type: ${params.type}`);
  }

  const { folder: kernelFolder, slug: kernelSlug } = registry;
  const kernelDir = path.join(KAGGLE_KERNELS_DIR, kernelFolder);
  if (!fs.existsSync(kernelDir)) {
    throw new Error(`Kernel directory not found: ${kernelDir}`);
  }

  const ownerSlug = `sreyassanker/${kernelSlug}`;
  const job: SimulationJob = {
    id: jobId,
    type: params.type,
    status: 'pending',
    params,
    createdAt: new Date().toISOString(),
    kernelSlug: ownerSlug,
  };

  activeJobs.set(jobId, job);

  // Run the pipeline async (don't await — return job immediately)
  runPipeline(job, kernelDir, ownerSlug).catch(err => {
    job.status = 'error';
    job.error = err.message;
    job.completedAt = new Date().toISOString();
    updateJobStatus(job, 'error', err.message);
  }).finally(() => {
    // Clean up the onStatus callback to avoid holding references to SSE res objects
    job.onStatus = undefined;
  });

  return job;
}

/**
 * Get the status of a running simulation job.
 */
export function getJobStatus(jobId: string): SimulationJob | undefined {
  return activeJobs.get(jobId);
}

/**
 * Get all active jobs.
 */
export function getAllJobs(): SimulationJob[] {
  return Array.from(activeJobs.values());
}

/**
 * Load simulation results from disk.
 */
export function loadResults(jobId: string): Record<string, unknown> | null {
  const job = activeJobs.get(jobId);
  if (!job?.resultPath || !fs.existsSync(job.resultPath)) return null;

  const metaPath = path.join(job.resultPath, 'metadata.json');
  if (fs.existsSync(metaPath)) {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════
// PIPELINE: push → poll → download
// ═════════════════════════════════════════════════════════════════

async function runPipeline(
  job: SimulationJob,
  kernelDir: string,
  ownerSlug: string,
): Promise<void> {
  const startTime = Date.now();
  const paramsPath = path.join(kernelDir, 'params.json');

  try {
    // ── Step 1: Write params.json ──
    updateJobStatus(job, 'pushing', 'Writing parameters...');
    fs.writeFileSync(paramsPath, JSON.stringify(job.params, null, 2));
    logger.info({ jobId: job.id, paramsPath }, 'Wrote params.json');

    // ── Step 2: Push kernel (triggers Kaggle run) ──
    updateJobStatus(job, 'pushing', 'Uploading to Kaggle GPU...');
    await pushKernel(kernelDir);
    updateJobStatus(job, 'running', 'Kernel pushed. Kaggle GPU booting...');
    logger.info({ jobId: job.id, ownerSlug }, 'Kernel pushed to Kaggle');

    // ── Step 3: Poll for completion ──
    let lastStatus = '';
    let sawComplete = false;
    while (Date.now() - startTime < MAX_WAIT_MS) {
      await sleep(POLL_INTERVAL_MS);

      try {
        const status = await getKernelStatus(ownerSlug);
        if (status !== lastStatus) {
          updateJobStatus(job, 'running', `Kaggle status: ${status}`);
          lastStatus = status;
        }

        if (status === 'complete') {
          sawComplete = true;
          break;
        }
        if (status === 'error' || status === 'cancel') {
          throw new Error(`Kaggle kernel ${status}`);
        }
      } catch (err: any) {
        // Transient errors during polling — retry
        logger.warn({ jobId: job.id, error: err.message }, 'Poll error, retrying...');
      }
    }

    if (!sawComplete && Date.now() - startTime >= MAX_WAIT_MS) {
      throw new Error('Simulation timed out after 10 minutes');
    }

    // ── Step 4: Download results ──
    updateJobStatus(job, 'downloading', 'Downloading results from Kaggle...');
    const resultDir = path.join(RESULTS_DIR, job.id);
    await downloadOutput(ownerSlug, resultDir);

    job.resultPath = resultDir;
    job.status = 'complete';
    job.completedAt = new Date().toISOString();
    updateJobStatus(job, 'complete', `Done in ${((Date.now() - startTime) / 1000).toFixed(0)}s`);

    logger.info({ jobId: job.id, resultDir, elapsed: Date.now() - startTime }, 'Simulation complete');
  } finally {
    // Always clean up params.json
    try { fs.unlinkSync(paramsPath); } catch { /* ignore */ }
  }
}

// ═════════════════════════════════════════════════════════════════
// SSE STREAMING (Server-Sent Events for real-time status)
// ═════════════════════════════════════════════════════════════════

/**
 * Set up SSE stream for a job. The client receives status updates in real-time.
 */
export function streamJobStatus(jobId: string, res: import('express').Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const job = activeJobs.get(jobId);
  if (!job) {
    res.write(`data: ${JSON.stringify({ error: 'Job not found' })}\n\n`);
    res.end();
    return;
  }

  // Send current status immediately
  res.write(`data: ${JSON.stringify({ status: job.status, detail: '', jobId })}\n\n`);

  // If already done, close immediately
  if (job.status === 'complete' || job.status === 'error') {
    res.end();
    return;
  }

  // Set up callback for future updates
  job.onStatus = (status, detail) => {
    try {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ status, detail: detail || '', jobId })}\n\n`);
      if (status === 'complete' || status === 'error') {
        setTimeout(() => { try { res.end(); } catch { /* ignore */ } }, 100);
      }
    } catch {
      // Client disconnected
    }
  };

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      if (res.writableEnded) {
        clearInterval(heartbeat);
        return;
      }
      res.write(`:heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 30_000);

  res.on('close', () => {
    clearInterval(heartbeat);
  });
}
