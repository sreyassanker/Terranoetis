import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Unit tests for the simRunner polling state machine. The Kaggle CLI is mocked
 * so we can drive arbitrary status sequences (stale-error races, genuine
 * failures, clean completions) deterministically and fast — real timings are
 * shrunk via KAGGLE_* env vars read at module load.
 */

const { mockLogger, mockPowerSaver, execFileMock, captured } = vi.hoisted(() => {
  const execFileMock = vi.fn(
    (
      _bin: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (args.includes('kernels') && args.includes('push')) {
        cb(null, 'Successfully pushed', '');
      } else if (args.includes('kernels') && args.includes('status')) {
        const s = captured.statusQueue.length > 0
          ? captured.statusQueue.shift()!
          : (captured.statusFallback ?? 'complete');
        captured.statusCalls.push(s.toLowerCase());
        cb(null, `sreyassanker/terranoetis-flood-swe-simulation has status "KernelWorkerStatus.${s.toUpperCase()}"`, '');
      } else if (args.includes('kernels') && args.includes('output')) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { join } = require('path') as typeof import('path');
        const idx = args.indexOf('-p');
        const outDir = idx >= 0 ? args[idx + 1] : undefined;
        if (outDir && captured.errorTrace) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('fs').writeFileSync(join(outDir, 'error.log'), captured.errorTrace);
          } catch { /* dir may not exist yet — ignore */ }
        }
        captured.outputCalls.push(outDir ?? '');
        cb(null, '', '');
      } else {
        cb(null, '', '');
      }
    },
  );

  return {
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    mockPowerSaver: {
      pauseBackgroundEngines: vi.fn(),
      resumeBackgroundEngines: vi.fn(),
    },
    execFileMock,
    captured: {
      statusQueue: [] as string[],
      statusFallback: 'complete' as string | null,
      statusCalls: [] as string[],
      outputCalls: [] as string[],
      errorTrace: '' as string,
    },
  };
});

vi.mock('../../observability/logger', () => ({ logger: mockLogger }));
vi.mock('child_process', () => ({ execFile: execFileMock }));
vi.mock('../../kaggle/powerSaver', () => mockPowerSaver);
vi.mock('../../kaggle/landCover', () => ({
  sampleLandCoverGrid: async () => null,
  compactLandCover: () => null as unknown,
}));

interface JobStatus {
  getJobStatus: (id: string) => { status: string; error?: string } | undefined;
  getAllJobs: () => Array<{ id: string; status: string }>;
}

let simRunner: JobStatus;

const RESULTS_DIR = path.resolve(process.cwd(), 'kaggle-kernels', 'results');

// Sample traceback exactly as the kernel's main() writes to error.log.
const SAMPLE_TRACEBACK = [
  'Traceback (most recent call last):',
  '  File "/kaggle/working/main.py", line 900, in run_flood_simulation',
  '    raise ValueError("boom")',
  'ValueError: boom',
].join('\n');

describe('simRunner stale-error polling state machine', () => {
  beforeAll(async () => {
    vi.stubEnv('KAGGLE_POLL_INTERVAL_MS', '15');
    vi.stubEnv('KAGGLE_POST_PUSH_SETTLE_MS', '10');
    vi.stubEnv('KAGGLE_STALE_ERROR_GRACE_MS', '60');
    const mod = await import('../../kaggle/simRunner');
    simRunner = mod as unknown as JobStatus;
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    captured.statusQueue.length = 0;
    captured.statusCalls.length = 0;
    captured.outputCalls.length = 0;
    captured.statusFallback = 'complete';
    captured.errorTrace = '';
  });

  afterEach(() => {
    // Remove any results dirs written by the (mocked) completion path.
    for (const dir of fs.readdirSync(RESULTS_DIR)) {
      fs.rmSync(path.join(RESULTS_DIR, dir), { recursive: true, force: true });
    }
  });

  async function startAndWait(
    statuses: string[],
    fallback?: string,
    errorTrace = '',
  ): Promise<{ status: string; error?: string }> {
    captured.statusQueue.push(...statuses);
    if (fallback) captured.statusFallback = fallback;
    captured.errorTrace = errorTrace;

    const job = await (simRunner as unknown as {
      startSimulation: (p: Record<string, unknown>) => { id: string };
    }).startSimulation({
      type: 'flood_inundation',
      lat: 37.77,
      lon: -122.42,
      grid_size: 64,
      duration_hours: 1,
    });

    let done: { status: string; error?: string } | undefined;
    await vi.waitFor(
      () => {
        const j = simRunner.getJobStatus(job.id);
        expect(j).toBeDefined();
        expect(j!.status === 'complete' || j!.status === 'error').toBe(true);
        done = j as { status: string; error?: string };
      },
      { timeout: 8_000, interval: 20 },
    );
    return done!;
  }

  it('tolerates a stale "error" (previous run) and completes once the new run starts', async () => {
    const done = await startAndWait(['ERROR', 'ERROR', 'RUNNING', 'COMPLETE']);

    expect(done.status).toBe('complete');
    // We must have polled multiple times and seen the error before the run started.
    expect(captured.statusCalls.filter(s => s === 'error').length).toBe(2);
  });

  it('keeps waiting when "error" persists for a while, then succeeds', async () => {
    const done = await startAndWait(['ERROR', 'RUNNING', 'COMPLETE']);

    expect(done.status).toBe('complete');
    expect(captured.statusCalls).toContain('error');
  });

  it('fails with an explanatory message only after the stale-error grace is exhausted', async () => {
    const done = await startAndWait([], 'error');

    expect(done.status).toBe('error');
    expect(done.error).toContain('no run start detected after');
    expect(done.error).toContain('stale status or early crash');
    // Should have polled several times before giving up, not failed instantly.
    expect(captured.statusCalls.every(s => s === 'error')).toBe(true);
    expect(captured.statusCalls.length).toBeGreaterThan(3);
  });

  it('harvests the real Python traceback from error.log on a genuine post-start failure', async () => {
    const done = await startAndWait(['RUNNING', 'ERROR'], undefined, SAMPLE_TRACEBACK);

    expect(done.status).toBe('error');
    expect(done.error).toContain('kernel crashed');
    expect(done.error).toContain('ValueError: boom');
    // We must have attempted to download the kernel output to harvest it.
    expect(captured.outputCalls.length).toBe(1);
  });

  it('still completes cleanly on a normal run (regression)', async () => {
    const done = await startAndWait(['RUNNING', 'COMPLETE']);

    expect(done.status).toBe('complete');
    expect(captured.statusCalls).toEqual(['running', 'complete']);
  });
});