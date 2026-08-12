import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const { mockLogger, mockPowerSaver, captured } = vi.hoisted(() => ({
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
  captured: {
    pushFiles: [] as string[],
  },
}));

vi.mock('../../observability/logger', () => ({ logger: mockLogger }));

vi.mock('child_process', () => ({
  execFile: vi.fn(
    (bin: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      if (args.includes('kernels') && args.includes('push')) {
        // Snapshot the staged main.py while the temp folder still exists so we
        // can assert the terrain payload was compacted before Kaggle sees it.
        // (vi.mock factories are hoisted above imports, so require() is the
        // only way to reach fs/path here.)
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const mainPy = require('fs').readFileSync(
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('path').join(args[args.length - 1], 'main.py'),
            'utf-8',
          );
          captured.pushFiles.push(mainPy);
        } catch {
          captured.pushFiles.push('__missing__');
        }
        cb(new Error('Kaggle CLI not authenticated'), '');
      } else if (args.includes('kernels') && args.includes('status')) {
        cb(null, 'complete');
      } else {
        cb(null, '');
      }
    },
  ),
}));

vi.mock('../../kaggle/powerSaver', () => mockPowerSaver);

import { startSimulation, getAllJobs } from '../../kaggle/simRunner';

const KERNEL_ROOT = path.resolve(process.cwd(), 'kaggle-kernels');

describe('Kaggle simRunner × PowerSaver integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.pushFiles.length = 0;
  });

  afterEach(() => {
    // Clean up params.json written by the pipeline
    const paramsPath = path.join(KERNEL_ROOT, 'flood-sim', 'params.json');
    if (fs.existsSync(paramsPath)) fs.rmSync(paramsPath);
  });

  it('pauses background engines when a sim starts and resumes after it fails', async () => {
    const floodDir = path.join(KERNEL_ROOT, 'flood-sim');
    expect(fs.existsSync(floodDir)).toBe(true);

    const job = await startSimulation({
      type: 'flood_inundation',
      lat: 37.77,
      lon: -122.42,
      grid_size: 64,
      duration_hours: 1,
    });

    expect(job).toBeDefined();
    expect(job.id).toMatch(/^sim_/);
    expect(mockPowerSaver.pauseBackgroundEngines).toHaveBeenCalledTimes(1);

    // Wait for the (failing) pipeline to finish so .finally() runs
    await vi.waitFor(() => {
      const done = getAllJobs().find(j => j.id === job.id);
      expect(done).toBeDefined();
      expect(done!.status).toBe('error');
    }, { timeout: 30_000, interval: 200 });

    expect(mockPowerSaver.resumeBackgroundEngines).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('does not pause for an unknown simulation type', async () => {
    await expect(
      startSimulation({ type: 'bogus_type' as never, lat: 0, lon: 0 }),
    ).rejects.toThrow(/Unknown simulation type/);
    expect(mockPowerSaver.pauseBackgroundEngines).not.toHaveBeenCalled();
    expect(mockPowerSaver.resumeBackgroundEngines).not.toHaveBeenCalled();
  });

  it('compacts a 256x256 terrain grid so the kernel stays under Kaggle upload size', async () => {
    const terrain = Array.from({ length: 256 * 256 }, (_, i) => 1000 + Math.sin(i) * 500);
    const job = await startSimulation({
      type: 'landslide',
      lat: 36.17,
      lon: -115.81,
      grid_size: 256,
      extent_km: 10,
      trigger_type: 'earthquake',
      magnitude: 6.5,
      pga_threshold: 0.15,
      rainfall_mm: 200,
      friction_angle: 35,
      cohesion: 500,
      duration_hours: 2,
      terrain,
      terrain_gs: 256,
    });

    expect(job.id).toMatch(/^sim_/);

    await vi.waitFor(
      () => {
        expect(captured.pushFiles.length).toBeGreaterThan(0);
      },
      { timeout: 30_000, interval: 200 },
    );

    const mainPy = captured.pushFiles[captured.pushFiles.length - 1];
    expect(mainPy).not.toBe('__missing__');
    // Raw float grid must NOT be embedded (that bloated main.py to ~1.2 MB and
    // Kaggle rejected it with 400 Bad Request).
    expect(mainPy).not.toMatch(/"terrain"\s*:\s*\[/);
    // Compact form is embedded instead. Params ride inside a JSON *string*
    // literal (`json.loads("...")`), so keys carry escaped quotes.
    expect(mainPy).toContain('terrain_b64');
    expect(mainPy).toContain('terrain_span');
    expect(mainPy.length).toBeLessThan(300_000);
  }, 60_000);
});
