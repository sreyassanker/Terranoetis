import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerPowerEngine,
  pauseBackgroundEngines,
  resumeBackgroundEngines,
  isPowerSaverPaused,
} from '../../kaggle/powerSaver';

vi.mock('../../observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('PowerSaver', () => {
  beforeEach(() => {
    // Reset module state between tests
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('pauses registered engines and resumes them', async () => {
    const powerSaver = await import('../../kaggle/powerSaver');
    const { registerPowerEngine: reg, pauseBackgroundEngines: pause, resumeBackgroundEngines: resume } = powerSaver;

    const engineA = { pause: vi.fn(), resume: vi.fn() };
    const engineB = { pause: vi.fn(), resume: vi.fn() };

    reg('A', () => engineA.pause(), () => engineA.resume());
    reg('B', () => engineB.pause(), () => engineB.resume());

    expect(powerSaver.isPowerSaverPaused()).toBe(false);

    pause();
    expect(powerSaver.isPowerSaverPaused()).toBe(true);
    expect(engineA.pause).toHaveBeenCalledTimes(1);
    expect(engineB.pause).toHaveBeenCalledTimes(1);
    expect(engineA.resume).not.toHaveBeenCalled();

    resume();
    expect(powerSaver.isPowerSaverPaused()).toBe(false);
    expect(engineA.resume).toHaveBeenCalledTimes(1);
    expect(engineB.resume).toHaveBeenCalledTimes(1);
  });

  it('only resumes after the last concurrent session finishes', async () => {
    const powerSaver = await import('../../kaggle/powerSaver');
    const { registerPowerEngine: reg, pauseBackgroundEngines: pause, resumeBackgroundEngines: resume } = powerSaver;

    const engine = { pause: vi.fn(), resume: vi.fn() };
    reg('engine', () => engine.pause(), () => engine.resume());

    pause(); // sim 1
    pause(); // sim 2 (concurrent)
    expect(engine.pause).toHaveBeenCalledTimes(1); // paused only once

    resume(); // sim 1 done — still paused for sim 2
    expect(powerSaver.isPowerSaverPaused()).toBe(true);
    expect(engine.resume).not.toHaveBeenCalled();

    resume(); // sim 2 done
    expect(powerSaver.isPowerSaverPaused()).toBe(false);
    expect(engine.resume).toHaveBeenCalledTimes(1);
  });

  it('ignores resume when nothing is paused', async () => {
    const powerSaver = await import('../../kaggle/powerSaver');
    const { registerPowerEngine: reg, resumeBackgroundEngines: resume } = powerSaver;
    const engine = { pause: vi.fn(), resume: vi.fn() };
    reg('engine', () => engine.pause(), () => engine.resume());

    resume();
    expect(engine.resume).not.toHaveBeenCalled();
  });

  it('isolates a failing engine without breaking the others', async () => {
    const powerSaver = await import('../../kaggle/powerSaver');
    const { registerPowerEngine: reg, pauseBackgroundEngines: pause, resumeBackgroundEngines: resume } = powerSaver;

    const goodEngine = { pause: vi.fn(), resume: vi.fn() };
    const badEngine = {
      pause: vi.fn(() => { throw new Error('boom'); }),
      resume: vi.fn(() => { throw new Error('boom2'); }),
    };

    reg('bad', () => badEngine.pause(), () => badEngine.resume());
    reg('good', () => goodEngine.pause(), () => goodEngine.resume());

    expect(() => pause()).not.toThrow();
    expect(goodEngine.pause).toHaveBeenCalledTimes(1);
    expect(goodEngine.resume).not.toHaveBeenCalled();

    expect(() => resume()).not.toThrow();
    expect(goodEngine.resume).toHaveBeenCalledTimes(1);
    expect(badEngine.pause).toHaveBeenCalledTimes(1);
    expect(badEngine.resume).toHaveBeenCalledTimes(1);
  });
});
