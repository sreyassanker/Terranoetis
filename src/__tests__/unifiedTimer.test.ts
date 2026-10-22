import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createUnifiedTimer } from '../lib/unifiedTimer';

describe('UnifiedTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs registered task and schedules next execution via setTimeout', () => {
    const timer = createUnifiedTimer();
    const fn = vi.fn();

    timer.register('task1', fn, 1000);
    timer.start();

    // First tick runs immediately on 0ms
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // After 999ms, shouldn't run again
    vi.advanceTimersByTime(999);
    expect(fn).toHaveBeenCalledTimes(1);

    // At 1000ms, runs second time
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);

    timer.stop();
  });

  it('handles multiple tasks with different intervals without spinning', () => {
    const timer = createUnifiedTimer();
    const fastFn = vi.fn();
    const slowFn = vi.fn();

    timer.register('fast', fastFn, 1000);
    timer.register('slow', slowFn, 5000);
    timer.start();

    vi.advanceTimersByTime(0);
    expect(fastFn).toHaveBeenCalledTimes(1);
    expect(slowFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(fastFn).toHaveBeenCalledTimes(2);
    expect(slowFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4000);
    expect(fastFn).toHaveBeenCalledTimes(6);
    expect(slowFn).toHaveBeenCalledTimes(2);

    timer.stop();
  });

  it('respects setEnabled and unregister', () => {
    const timer = createUnifiedTimer();
    const fn = vi.fn();

    timer.register('task', fn, 1000);
    timer.start();
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledTimes(1);

    timer.setEnabled('task', false);
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1);

    timer.setEnabled('task', true);
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledTimes(2);

    timer.unregister('task');
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(2);

    timer.stop();
  });

  it('uses requestAnimationFrame for high-frequency animation tasks when visible', () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const rafMock = vi.fn((cb: FrameRequestCallback) => {
      return setTimeout(() => cb(Date.now()), 16) as unknown as number;
    });
    globalThis.requestAnimationFrame = rafMock as unknown as typeof requestAnimationFrame;

    try {
      const timer = createUnifiedTimer();
      const animFn = vi.fn();
      timer.register('anim', animFn, 16);
      timer.start();

      vi.advanceTimersByTime(16);
      expect(animFn).toHaveBeenCalled();
      timer.stop();
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
    }
  });

  it('attaches visibilitychange listener on start, removes on stop, and stays clean across repeated cycles', () => {
    const originalDoc = (globalThis as unknown as { document?: unknown }).document;
    const addListenerMock = vi.fn();
    const removeListenerMock = vi.fn();

    (globalThis as unknown as { document?: unknown }).document = {
      addEventListener: addListenerMock,
      removeEventListener: removeListenerMock,
      hidden: false,
    };

    try {
      const timer = createUnifiedTimer();
      // Before start: no listener attached
      expect(addListenerMock).not.toHaveBeenCalled();

      // First start: attaches visibilitychange
      timer.start();
      expect(addListenerMock).toHaveBeenCalledTimes(1);
      expect(addListenerMock).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
      const attachedHandler = addListenerMock.mock.calls[0][1];

      // Second start while already running: idempotent, no duplicate listener
      timer.start();
      expect(addListenerMock).toHaveBeenCalledTimes(1);

      // Stop: removes the exact same callback reference
      timer.stop();
      expect(removeListenerMock).toHaveBeenCalledTimes(1);
      expect(removeListenerMock).toHaveBeenCalledWith('visibilitychange', attachedHandler);

      // Second stop while already stopped: idempotent, no redundant removal
      timer.stop();
      expect(removeListenerMock).toHaveBeenCalledTimes(1);

      // Repeat cycle: cleanly re-attaches and re-removes
      timer.start();
      expect(addListenerMock).toHaveBeenCalledTimes(2);
      timer.stop();
      expect(removeListenerMock).toHaveBeenCalledTimes(2);
    } finally {
      (globalThis as unknown as { document?: unknown }).document = originalDoc;
    }
  });
});
