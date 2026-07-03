/**
 * UnifiedTimer — P0 Performance Optimization
 *
 * Replaces dozens of independent setInterval() calls with a single
 * requestAnimationFrame loop. This allows the browser to enter idle/sleep
 * states between frames instead of being woken every second by timers.
 *
 * Each registered task specifies its own interval (ms). The scheduler
 * checks all tasks once per animation frame and runs only those whose
 * interval has elapsed.
 */

export interface TimerTask {
  id: string;
  intervalMs: number;
  fn: () => void | Promise<void>;
  lastRun: number;
  enabled: boolean;
}

export function createUnifiedTimer() {
  let tasks: TimerTask[] = [];
  let rafId = 0;
  let running = false;

  function tick(now: number) {
    for (const task of tasks) {
      if (!task.enabled) continue;
      if (now - task.lastRun >= task.intervalMs) {
        task.lastRun = now;
        try {
          task.fn();
        } catch (err) {
          console.error(`[UnifiedTimer] task "${task.id}" threw:`, err);
        }
      }
    }
    if (running) {
      rafId = requestAnimationFrame(tick);
    }
  }

  return {
    /**
     * Register a task. If a task with the same id exists, it is replaced.
     */
    register(id: string, fn: () => void | Promise<void>, intervalMs: number) {
      const existing = tasks.findIndex(t => t.id === id);
      const task: TimerTask = { id, intervalMs, fn, lastRun: 0, enabled: true };
      if (existing >= 0) {
        tasks[existing] = task;
      } else {
        tasks.push(task);
      }
    },

    /**
     * Enable or disable a specific task without unregistering it.
     */
    setEnabled(id: string, enabled: boolean) {
      const task = tasks.find(t => t.id === id);
      if (task) task.enabled = enabled;
    },

    /**
     * Update the interval for an existing task.
     */
    setInterval(id: string, intervalMs: number) {
      const task = tasks.find(t => t.id === id);
      if (task) task.intervalMs = intervalMs;
    },

    /**
     * Remove a task.
     */
    unregister(id: string) {
      tasks = tasks.filter(t => t.id !== id);
    },

    /**
     * Start the unified scheduler loop.
     */
    start() {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(tick);
    },

    /**
     * Stop the scheduler entirely.
     */
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    },

    /**
     * Get diagnostic info about registered tasks.
     */
    getStats() {
      return {
        taskCount: tasks.length,
        enabledCount: tasks.filter(t => t.enabled).length,
        tasks: tasks.map(t => ({
          id: t.id,
          intervalMs: t.intervalMs,
          enabled: t.enabled,
          timeSinceLastRun: performance.now() - t.lastRun,
        })),
      };
    },
  };
}

export type UnifiedTimer = ReturnType<typeof createUnifiedTimer>;
