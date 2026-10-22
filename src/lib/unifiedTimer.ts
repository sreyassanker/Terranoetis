/**
 * UnifiedTimer — Battery & CPU Optimized Scheduler
 *
 * Replaces high-frequency polling and uncontrolled setInterval loops with
 * an adaptive, deadline-aware timer scheduler.
 *
 * Instead of spinning requestAnimationFrame at 60-120 Hz regardless of task deadlines,
 * UnifiedTimer computes the earliest due deadline across all enabled tasks:
 * - Tasks with standard intervals (>16ms) sleep via setTimeout until their exact deadline,
 *   allowing CPU cores to enter deep C-states (sleep) between executions.
 * - True animation tasks (<=16ms) use requestAnimationFrame only when visible.
 * - When document.hidden is true (app minimized or occluded), wakeups are throttled
 *   to preserve battery.
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
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let rafId = 0;
  let running = false;
  let visibilityListenerAttached = false;

  function clearPending() {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (rafId !== 0) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
      rafId = 0;
    }
  }

  function getNextDelay(now: number): number {
    let earliest = Infinity;
    for (const task of tasks) {
      if (!task.enabled) continue;
      if (!Number.isFinite(task.lastRun)) return 0; // Never run yet
      const dueIn = Math.max(0, (task.lastRun + task.intervalMs) - now);
      if (dueIn < earliest) earliest = dueIn;
    }
    return earliest;
  }

  function scheduleNext() {
    if (!running) return;
    clearPending();

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let minDelay = getNextDelay(now);
    if (!Number.isFinite(minDelay)) return; // No enabled tasks

    const isHidden = typeof document !== 'undefined' && document.hidden;
    if (isHidden && minDelay < 1000) {
      minDelay = 1000;
    }

    const hasAnimationTask = tasks.some(t => t.enabled && t.intervalMs <= 16);
    if (hasAnimationTask && !isHidden && minDelay <= 16) {
      if (typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(tick);
        return;
      }
    }

    timerId = setTimeout(tick, Math.max(0, Math.round(minDelay)));
  }

  function tick() {
    timerId = null;
    rafId = 0;
    if (!running) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const task of tasks) {
      if (!task.enabled) continue;
      const elapsed = now - task.lastRun;
      if (!Number.isFinite(task.lastRun) || elapsed >= task.intervalMs) {
        task.lastRun = now;
        try {
          task.fn();
        } catch (err) {
          console.error(`[UnifiedTimer] task "${task.id}" threw:`, err);
        }
      }
    }
    scheduleNext();
  }

  function onVisibilityChange() {
    if (running) scheduleNext();
  }

  return {
    /**
     * Register a task. If a task with the same id exists, it is replaced.
     */
    register(id: string, fn: () => void | Promise<void>, intervalMs: number) {
      const existing = tasks.findIndex(t => t.id === id);
      const task: TimerTask = { id, intervalMs, fn, lastRun: -Infinity, enabled: true };
      if (existing >= 0) {
        tasks[existing] = task;
      } else {
        tasks.push(task);
      }
      if (running) scheduleNext();
    },

    /**
     * Enable or disable a specific task without unregistering it.
     */
    setEnabled(id: string, enabled: boolean) {
      const task = tasks.find(t => t.id === id);
      if (task) {
        task.enabled = enabled;
        if (running) scheduleNext();
      }
    },

    /**
     * Update the interval for an existing task.
     */
    setInterval(id: string, intervalMs: number) {
      const task = tasks.find(t => t.id === id);
      if (task) {
        task.intervalMs = intervalMs;
        if (running) scheduleNext();
      }
    },

    /**
     * Remove a task.
     */
    unregister(id: string) {
      tasks = tasks.filter(t => t.id !== id);
      if (running) scheduleNext();
    },

    /**
     * Start the unified scheduler loop.
     */
    start() {
      if (running) return;
      running = true;
      if (typeof document !== 'undefined' && !visibilityListenerAttached) {
        document.addEventListener('visibilitychange', onVisibilityChange);
        visibilityListenerAttached = true;
      }
      scheduleNext();
    },

    /**
     * Stop the scheduler entirely.
     */
    stop() {
      running = false;
      clearPending();
      if (typeof document !== 'undefined' && visibilityListenerAttached) {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        visibilityListenerAttached = false;
      }
    },

    /**
     * Get diagnostic info about registered tasks.
     */
    getStats() {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return {
        taskCount: tasks.length,
        enabledCount: tasks.filter(t => t.enabled).length,
        tasks: tasks.map(t => ({
          id: t.id,
          intervalMs: t.intervalMs,
          enabled: t.enabled,
          timeSinceLastRun: Number.isFinite(t.lastRun) ? now - t.lastRun : 0,
        })),
      };
    },
  };
}
