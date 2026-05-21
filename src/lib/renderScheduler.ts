export interface BatchTask {
  id: string;
  execute: () => void;
}

export function createRenderScheduler(frameBudgetMs = 8) {
  let queue: BatchTask[] = [];
  let running = false;
  let onProgress: ((done: number, total: number) => void) | null = null;
  let totalQueued = 0;
  let completed = 0;

  function processBatch() {
    const start = performance.now();

    while (queue.length > 0) {
      const task = queue[0];
      task.execute();
      queue.shift();
      completed++;

      if (performance.now() - start > frameBudgetMs) break;
    }

    onProgress?.(completed, totalQueued);

    if (queue.length > 0) {
      requestAnimationFrame(processBatch);
    } else {
      running = false;
      onProgress?.(completed, totalQueued);
    }
  }

  return {
    enqueue(task: BatchTask) {
      queue.push(task);
      totalQueued++;
      if (!running) {
        running = true;
        requestAnimationFrame(processBatch);
      }
    },

    enqueueAll(tasks: BatchTask[]) {
      queue.push(...tasks);
      totalQueued += tasks.length;
      if (!running) {
        running = true;
        requestAnimationFrame(processBatch);
      }
    },

    clear() {
      queue = [];
      completed = totalQueued;
      running = false;
    },

    flush() {
      while (queue.length > 0) {
        const task = queue.shift()!;
        task.execute();
        completed++;
      }
      running = false;
      onProgress?.(completed, totalQueued);
    },

    get hasPending() {
      return queue.length > 0;
    },

    get pending() {
      return queue.length;
    },

    onProgress(cb: ((done: number, total: number) => void) | null) {
      onProgress = cb;
    },

    reset() {
      queue = [];
      totalQueued = 0;
      completed = 0;
      running = false;
    },

    get isRunning() {
      return running;
    },
  };
}

export type RenderScheduler = ReturnType<typeof createRenderScheduler>;
