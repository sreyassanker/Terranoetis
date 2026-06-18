export { SimpleQueue } from './simple-queue';

let defaultQueue: SimpleQueue | null = null;

export function getQueue(maxConcurrent = 10): SimpleQueue {
  if (!defaultQueue) {
    defaultQueue = new SimpleQueue(maxConcurrent);
  }
  return defaultQueue;
}

export function resetQueue(): void {
  defaultQueue = null;
}
