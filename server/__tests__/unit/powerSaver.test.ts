import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

  it('handles desktop standby idempotently and tracks engine inventory', async () => {
    const powerSaver = await import('../../kaggle/powerSaver');
    const { registerPowerEngine: reg, setDesktopStandby: setStandby, getPowerEngineInventory: getInventory } = powerSaver;

    const engine = { pause: vi.fn(), resume: vi.fn() };
    reg('deskEngine', () => engine.pause(), () => engine.resume());

    expect(powerSaver.isDesktopStandby()).toBe(false);
    expect(powerSaver.isPowerSaverPaused()).toBe(false);

    // Enter standby
    setStandby(true);
    expect(powerSaver.isDesktopStandby()).toBe(true);
    expect(powerSaver.isPowerSaverPaused()).toBe(true);
    expect(engine.pause).toHaveBeenCalledTimes(1);

    // Repeated standby calls are idempotent
    setStandby(true);
    expect(engine.pause).toHaveBeenCalledTimes(1);

    // Inventory check
    const inventory = getInventory();
    expect(inventory).toEqual([{ name: 'deskEngine', paused: true }]);

    // Return to active
    setStandby(false);
    expect(powerSaver.isDesktopStandby()).toBe(false);
    expect(powerSaver.isPowerSaverPaused()).toBe(false);
    expect(engine.resume).toHaveBeenCalledTimes(1);

    // Repeated active calls are idempotent
    setStandby(false);
    expect(engine.resume).toHaveBeenCalledTimes(1);
  });

  it('keeps engines paused if Kaggle simulation finishes while desktop is in standby', async () => {
    const powerSaver = await import('../../kaggle/powerSaver');
    const { registerPowerEngine: reg, setDesktopStandby: setStandby, pauseBackgroundEngines: pause, resumeBackgroundEngines: resume } = powerSaver;

    const engine = { pause: vi.fn(), resume: vi.fn() };
    reg('hybridEngine', () => engine.pause(), () => engine.resume());

    pause(); // Kaggle starts
    expect(powerSaver.isPowerSaverPaused()).toBe(true);
    expect(engine.pause).toHaveBeenCalledTimes(1);

    setStandby(true); // User minimizes desktop
    expect(engine.pause).toHaveBeenCalledTimes(1); // Already paused, no redundant call

    resume(); // Kaggle finishes, but desktop is still minimized
    expect(powerSaver.isPowerSaverPaused()).toBe(true); // MUST stay paused!
    expect(engine.resume).not.toHaveBeenCalled();

    setStandby(false); // User restores desktop
    expect(powerSaver.isPowerSaverPaused()).toBe(false);
    expect(engine.resume).toHaveBeenCalledTimes(1);
  });

  it('verifies safe lifecycle across rapid minimize/restore bursts', async () => {
    const powerSaver = await import('../../kaggle/powerSaver');
    const { registerPowerEngine: reg, setDesktopStandby: setStandby } = powerSaver;

    let activeIntervalCount = 0;
    const testEngine = {
      interval: null as ReturnType<typeof setInterval> | null,
      start() {
        if (this.interval) this.stop();
        this.interval = setInterval(() => {}, 1000);
        activeIntervalCount++;
      },
      stop() {
        if (this.interval) {
          clearInterval(this.interval);
          this.interval = null;
          activeIntervalCount--;
        }
      },
    };

    testEngine.start();
    expect(activeIntervalCount).toBe(1);

    reg('rapidBurstEngine', () => testEngine.stop(), () => testEngine.start());

    // Rapid minimize/restore toggling (10 bursts)
    for (let i = 0; i < 10; i++) {
      setStandby(true);
      expect(activeIntervalCount).toBe(0);
      setStandby(false);
      expect(activeIntervalCount).toBe(1);
    }

    // Clean up
    testEngine.stop();
    expect(activeIntervalCount).toBe(0);
  });
});
