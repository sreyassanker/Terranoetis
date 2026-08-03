import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const { mockLogger, mockPowerSaver } = vi.hoisted(() => ({
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
}));

vi.mock('../../observability/logger', () => ({ logger: mockLogger }));

vi.mock('child_process', () => ({
  exec: vi.fn((cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
    if (cmd.includes('kernels push')) {
      cb(new Error('Kaggle CLI not authenticated'), '');
    } else if (cmd.includes('kernels status')) {
      cb(null, 'complete');
    } else {
      cb(null, '');
    }
  }),
}));

vi.mock('../../kaggle/powerSaver', () => mockPowerSaver);

import { startSimulation, getAllJobs } from '../../kaggle/simRunner';

const KERNEL_ROOT = path.resolve(process.cwd(), 'kaggle-kernels');

describe('Kaggle simRunner × PowerSaver integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
