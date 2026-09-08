import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

/**
 * Unit tests for the LOCAL simulation execution path (2D kernels run via
 * python3 instead of the Kaggle push→poll→download pipeline). The child
 * process is faked: spawn writes a metadata.json into TERRANOETIS_OUT_DIR
 * and exits 0 — enough to drive the job state machine deterministically.
 */

const { mockLogger, mockPowerSaver, spawnMock, execFileMock, captured } = vi.hoisted(() => {
  const captured = {
    spawnCalls: [] as Array<{ args: string[]; env: Record<string, unknown> }>,
    execFileArgs: [] as string[][],
  };
  return {
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    mockPowerSaver: { pauseBackgroundEngines: vi.fn(), resumeBackgroundEngines: vi.fn() },
    spawnMock: vi.fn(),
    execFileMock: vi.fn(
      (
        _bin: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        captured.execFileArgs.push(args);
        if (args.includes('push')) cb(null, 'Successfully pushed', '');
        else if (args.includes('status')) cb(null, 'has status "KernelWorkerStatus.COMPLETE"', '');
        else cb(null, '', '');
      },
    ),
    captured,
  };
});

vi.mock('../../observability/logger', () => ({ logger: mockLogger }));
vi.mock('child_process', () => ({ spawn: spawnMock, execFile: execFileMock }));
vi.mock('../../kaggle/powerSaver', () => mockPowerSaver);
vi.mock('../../kaggle/landCover', () => ({
  sampleLandCoverGrid: async () => null,
  compactLandCover: () => null as unknown,
}));

interface JobStatus {
  getJobStatus: (id: string) => { status: string; error?: string } | undefined;
}

let simRunner: JobStatus;
let startSimulation: (p: Record<string, unknown>) => Promise<{ id: string }>;

const RESULTS_DIR = path.resolve(process.cwd(), 'kaggle-kernels', 'results');

beforeAll(async () => {
  vi.stubEnv('KAGGLE_POLL_INTERVAL_MS', '15');
  vi.stubEnv('KAGGLE_POST_PUSH_SETTLE_MS', '10');
  const mod = await import('../../kaggle/simRunner');
  simRunner = mod as unknown as JobStatus;
  startSimulation = mod.startSimulation as unknown as typeof startSimulation;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  captured.spawnCalls.length = 0;
  captured.execFileArgs.length = 0;
  // Fake python3 child: write metadata.json into the out dir, exit 0.
  spawnMock.mockImplementation((bin: string, args: string[], opts: { env?: Record<string, unknown> }) => {
    captured.spawnCalls.push({ args: [bin, ...args], env: opts?.env ?? {} });
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter; stderr: EventEmitter; kill: (s?: string) => boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => true);
    setImmediate(() => {
      const outDir = (opts?.env ?? {}).TERRANOETIS_OUT_DIR as string | undefined;
      if (outDir) {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify({ completed: true }));
      }
      child.emit('close', 0, null);
    });
    return child;
  });
});

afterEach(() => {
  for (const dir of fs.readdirSync(RESULTS_DIR)) {
    fs.rmSync(path.join(RESULTS_DIR, dir), { recursive: true, force: true });
  }
});

describe('local simulation execution (earthquake_swarm)', () => {
  it('runs via python3 spawn, never touches the Kaggle CLI, and completes', async () => {
    const job = await startSimulation({
      type: 'earthquake_swarm',
      lat: 35.68, lon: 139.65,
      grid_size: 64, extent_km: 32,
      magnitude: 7.0, depth_km: 10,
    });

    await vi.waitFor(
      () => {
        const j = simRunner.getJobStatus(job.id);
        expect(j?.status).toBe('complete');
      },
      { timeout: 5_000, interval: 20 },
    );

    expect(captured.spawnCalls).toHaveLength(1);
    expect(captured.spawnCalls[0].args).toEqual(['python3', 'main.py']);
    expect(captured.spawnCalls[0].env.TERRANOETIS_OUT_DIR).toContain(job.id);
    // No Kaggle CLI calls at all for a local type.
    expect(captured.execFileArgs).toHaveLength(0);
    // No power-saver pause — local runs are sub-second.
    expect(mockPowerSaver.pauseBackgroundEngines).not.toHaveBeenCalled();
    // Results land where the grid/GeoTIFF endpoints look.
    expect(fs.existsSync(path.join(RESULTS_DIR, job.id, 'metadata.json'))).toBe(true);
  });

  it('reports an error when the local kernel exits non-zero', async () => {
    spawnMock.mockImplementation((_bin: string, _args: string[], _opts: { env?: Record<string, unknown> }) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter; stderr: EventEmitter; kill: (s?: string) => boolean;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => true);
      setImmediate(() => child.emit('close', 1, null));
      return child;
    });

    const job = await startSimulation({
      type: 'earthquake_swarm', lat: 0, lon: 0,
      grid_size: 64, extent_km: 32, magnitude: 7, depth_km: 10,
    });

    await vi.waitFor(
      () => {
        const j = simRunner.getJobStatus(job.id);
        expect(j?.status).toBe('error');
      },
      { timeout: 5_000, interval: 20 },
    );
    expect(simRunner.getJobStatus(job.id)?.error).toContain('Local kernel failed');
  });

  it('runs wildfire_spread locally too (2D Rothermel, CPU-scale)', async () => {
    const job = await startSimulation({
      type: 'wildfire_spread',
      lat: 38.5, lon: -121.5,
      grid_size: 64, extent_km: 10,
      wind_speed_ms: 10, wind_dir_deg: 270, humidity_pct: 15,
      duration_hours: 1, fuel_type: 'forest',
    });

    await vi.waitFor(
      () => { expect(simRunner.getJobStatus(job.id)?.status).toBe('complete'); },
      { timeout: 5_000, interval: 20 },
    );
    expect(captured.spawnCalls).toHaveLength(1);
    expect(captured.execFileArgs).toHaveLength(0);
  });

  it('runs hurricane_landfall locally (Holland+SWE, no Kaggle round-trip)', async () => {
    const job = await startSimulation({
      type: 'hurricane_landfall',
      lat: 29.3, lon: -94.8,
      grid_size: 64, extent_km: 240,
      category: 4, central_pressure_hpa: 946, radius_max_wind_km: 32,
      forward_speed_kmh: 30, duration_hours: 6,
    });

    await vi.waitFor(
      () => { expect(simRunner.getJobStatus(job.id)?.status).toBe('complete'); },
      { timeout: 5_000, interval: 20 },
    );
    expect(captured.spawnCalls).toHaveLength(1);
    expect(captured.spawnCalls[0].args).toEqual(['python3', 'main.py']);
    expect(captured.execFileArgs).toHaveLength(0);
    expect(mockPowerSaver.pauseBackgroundEngines).not.toHaveBeenCalled();
  });

  it('still routes Kaggle types (flood) through the CLI pipeline', async () => {
    const job = await startSimulation({
      type: 'flood_inundation', lat: 29.76, lon: -95.37,
      grid_size: 64, extent_km: 10, rainfall_mm: 500, duration_hours: 1,
      soil_saturation: 0.8, dam_breach: true,
    });

    await vi.waitFor(
      () => {
        const j = simRunner.getJobStatus(job.id);
        expect(j?.status).toBe('complete');
      },
      { timeout: 8_000, interval: 20 },
    );

    expect(captured.spawnCalls).toHaveLength(0);
    expect(captured.execFileArgs.some((a) => a.includes('push'))).toBe(true);
    expect(mockPowerSaver.pauseBackgroundEngines).toHaveBeenCalledTimes(1);
  });
});
