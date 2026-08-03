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

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { logger } from '../observability/logger';
import { pauseBackgroundEngines, resumeBackgroundEngines } from './powerSaver';

const execAsync = promisify(exec);

const KAGGLE_KERNELS_DIR = path.resolve(process.cwd(), 'kaggle-kernels');
const RESULTS_DIR = path.resolve(process.cwd(), 'kaggle-kernels', 'results');
const POLL_INTERVAL_MS = 15_000; // 15 seconds between status checks
const JOB_CLEANUP_AGE_MS = 3600_000; // 1 hour — remove completed jobs after this
const MAX_POLL_MS = 45 * 60_000; // 45 min hard cap on a Kaggle run
const MAX_CONSECUTIVE_POLL_ERRORS = 10; // give up polling after repeated transient failures

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
  cancelled?: boolean;
}

type StatusListener = (status: SimulationJob['status'], detail?: string, jobId?: string) => void;

// SSE listeners — fan-out, so multiple clients can subscribe to the same job.
const jobListeners = new Map<string, Set<StatusListener>>();

function notifyStatus(job: SimulationJob, status: SimulationJob['status'], detail?: string): void {
  const set = jobListeners.get(job.id);
  if (!set) return;
  for (const listener of set) {
    try { listener(status, detail, job.id); } catch { /* swallow client errors */ }
  }
}

function addJobListener(jobId: string, listener: StatusListener): () => void {
  let set = jobListeners.get(jobId);
  if (!set) {
    set = new Set();
    jobListeners.set(jobId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) jobListeners.delete(jobId);
  };
}

function updateJobStatus(job: SimulationJob, status: SimulationJob['status'], detail?: string) {
  job.status = status;
  notifyStatus(job, status, detail);
  logger.info({ jobId: job.id, type: job.type, status, detail }, 'Simulation job status');
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
  } catch (err: unknown) {
    logger.error({ cmd, error: err instanceof Error ? err.message : String(err) }, 'Kaggle CLI error');
    throw new Error(`Kaggle command failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function pushKernel(kernelDir: string): Promise<void> {
  await kaggleCommand(`kaggle kernels push -p "${kernelDir}"`);
}

/**
 * Kaggle's CLI only uploads the code file + kernel-metadata.json — sibling
 * files such as params.json never reach the runner. So we bake the run's
 * params directly into the code: replace the `EMBEDDED_PARAMS = None` marker
 * line in main.py, stage a temp kernel folder, and push from there.
 */
async function pushKernelWithParams(kernelDir: string, params: SimulationParams): Promise<void> {
  const metadataPath = path.join(kernelDir, 'kernel-metadata.json');
  const mainPyPath = path.join(kernelDir, 'main.py');
  if (!fs.existsSync(mainPyPath) || !fs.existsSync(metadataPath)) {
    throw new Error(`Kernel folder incomplete (missing main.py or kernel-metadata.json): ${kernelDir}`);
  }

  const code = fs.readFileSync(mainPyPath, 'utf-8');
  const marker = 'EMBEDDED_PARAMS = None';
  if (!code.includes(marker)) {
    throw new Error(`Kernel ${kernelDir} is missing the EMBEDDED_PARAMS marker`);
  }
  const injected = code.replace(marker, `EMBEDDED_PARAMS = ${JSON.stringify(params)}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaggle-push-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'main.py'), injected);
    fs.copyFileSync(metadataPath, path.join(tmpDir, 'kernel-metadata.json'));
    await pushKernel(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function getKernelStatus(ownerSlug: string): Promise<string> {
  const output = await kaggleCommand(`kaggle kernels status ${ownerSlug}`);
  // Kaggle CLI v2.x outputs: "owner/kernel has status \"KernelWorkerStatus.COMPLETE\""
  // Older versions output just: "complete"
  const match = output.match(/KernelWorkerStatus\.(\w+)/i);
  if (match) {
    return match[1].toLowerCase();
  }
  return output.toLowerCase().trim();
}

async function downloadOutput(ownerSlug: string, outputDir: string): Promise<void> {
  fs.mkdirSync(outputDir, { recursive: true });
  await kaggleCommand(`kaggle kernels output ${ownerSlug} -p "${outputDir}" --force`);
}

async function cancelKernel(ownerSlug: string): Promise<void> {
  try {
    await kaggleCommand(`kaggle kernels cancel ${ownerSlug}`);
  } catch {
    logger.warn({ ownerSlug }, 'Failed to cancel Kaggle kernel (may already be done)');
  }
}

// ═════════════════════════════════════════════════════════════════
// SIMULATION JOB MANAGEMENT
// ═════════════════════════════════════════════════════════════════

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

  // Suspend non-essential background engines so the local machine stays cool
  // while the GPU work runs on Kaggle.
  pauseBackgroundEngines();

  // Run the pipeline async (don't await — return job immediately)
  runPipeline(job, kernelDir, ownerSlug)
    .catch(err => {
      job.status = 'error';
      job.error = err.message;
      job.completedAt = new Date().toISOString();
      updateJobStatus(job, 'error', err.message);
    })
    .finally(() => {
      // Detach listeners after terminal state so SSE clients get the final write.
      resumeBackgroundEngines();
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
 * Cancel a running simulation: cancels the Kaggle kernel and stops polling.
 */
export function cancelJob(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  if (job.status === 'complete' || job.status === 'error') return false;
  job.cancelled = true;
  // Mark terminal right away — do NOT wait up to one full poll tick.
  // We stay truthful about the Kaggle-side cancellation (fire-and-forget)
  // by letting the poll loop's next iteration call cancelKernel().
  updateJobStatus(job, 'error', 'Simulation cancelled by user');
  return true;
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

  try {
    // ── Step 1: Push kernel with params embedded in the code file ──
    updateJobStatus(job, 'pushing', 'Uploading to Kaggle GPU...');
    await pushKernelWithParams(kernelDir, job.params);
    updateJobStatus(job, 'running', 'Kernel pushed. Kaggle GPU booting...');
    logger.info({ jobId: job.id, ownerSlug }, 'Kernel pushed to Kaggle');

    // ── Step 3: Poll for completion with a hard timeout so a hung kernel
    //    doesn't burn Kaggle GPU quota (and the local machine) forever. ──
    let lastStatus = '';
    let sawComplete = false;
    let consecutiveErrors = 0;
    while (true) {
      if (job.cancelled) {
        await cancelKernel(ownerSlug);
        updateJobStatus(job, 'error', 'Simulation cancelled by user');
        return;
      }
      if (Date.now() - startTime > MAX_POLL_MS) {
        await cancelKernel(ownerSlug);
        updateJobStatus(job, 'error', `Kaggle kernel timed out after ${MAX_POLL_MS / 60000} min — cancelled`);
        return;
      }

      await sleep(POLL_INTERVAL_MS);

      try {
        const status = await getKernelStatus(ownerSlug);
        consecutiveErrors = 0;
        if (status !== lastStatus) {
          updateJobStatus(job, 'running', `Kaggle status: ${status}`);
          lastStatus = status;
        }

        if (status === 'complete') {
          sawComplete = true;
          break;
        }
        if (status === 'error' || status === 'cancel') {
          // Terminal kernel state — fail fast. Do NOT count this as a
          // transient network error (the previous code let a failed kernel
          // be retried ~10 times, pointless and slow).
          updateJobStatus(job, 'error', `Kaggle kernel ${status}`);
          return;
        }
      } catch (err: unknown) {
        // Transient errors during polling — retry a bounded number of times
        consecutiveErrors++;
        logger.warn({ jobId: job.id, error: err instanceof Error ? err.message : String(err) }, 'Poll error, retrying...');
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          await cancelKernel(ownerSlug);
          updateJobStatus(job, 'error', 'Kaggle kernel polling failed repeatedly — cancelled');
          return;
        }
      }
    }

    if (!sawComplete) {
      updateJobStatus(job, 'error', 'Simulation ended without completion');
      return;
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
    // (no params.json cleanup needed — params are embedded in the pushed code)
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

  // Fan-out listener — multiple SSE clients can subscribe to the same job.
  const remove = addJobListener(jobId, (status, detail) => {
    try {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ status, detail: detail || '', jobId })}\n\n`);
      if (status === 'complete' || status === 'error') {
        setTimeout(() => { try { res.end(); } catch { /* ignore */ } }, 100);
      }
    } catch {
      // Client disconnected
    }
  });

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
    remove();
  });
}
