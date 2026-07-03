export interface BatchTask {
  id: string;
  execute: () => void;
}

export function createRenderScheduler(frameBudgetMs = 8) {
  let queue: BatchTask[] = [];
  let head = 0;
  let running = false;
  let onProgress: ((done: number, total: number) => void) | null = null;
  let totalQueued = 0;
  let completed = 0;

  function processBatch() {
    const start = performance.now();

    while (head < queue.length) {
      const task = queue[head];
      head++;
      task.execute();
      completed++;

      if (performance.now() - start > frameBudgetMs) break;
    }

    onProgress?.(completed, totalQueued);

    if (head < queue.length) {
      requestAnimationFrame(processBatch);
    } else {
      running = false;
      queue = [];
      head = 0;
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
      head = 0;
      completed = totalQueued;
      running = false;
    },

    flush() {
      while (head < queue.length) {
        const task = queue[head];
        head++;
        task.execute();
        completed++;
      }
      queue = [];
      head = 0;
      running = false;
      onProgress?.(completed, totalQueued);
    },

    get hasPending() {
      return head < queue.length;
    },

    get pending() {
      return queue.length - head;
    },

    onProgress(cb: ((done: number, total: number) => void) | null) {
      onProgress = cb;
    },

    reset() {
      queue = [];
      head = 0;
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
