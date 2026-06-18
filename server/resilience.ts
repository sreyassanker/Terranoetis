export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failures = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly windowMs: number;

  constructor(failureThreshold = 5, windowMs = 60000, resetTimeoutMs = 30000) {
    this.failureThreshold = failureThreshold;
    this.windowMs = windowMs;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failures = 0;
      }
      return result;
    } catch (e) {
      this.failures++;
      this.lastFailureTime = Date.now();
      if (this.failures >= this.failureThreshold) {
        this.state = 'OPEN';
      }
      throw e;
    }
  }

  getState(): string {
    return this.state;
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
  }
}

export function jitter(delay: number): number {
  return delay * (0.5 + Math.random());
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, jitter(baseDelayMs * Math.pow(2, attempt))));
      }
    }
  }
  throw lastError!;
}

export async function withCircuitBreak<T>(
  breaker: CircuitBreaker,
  fn: () => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  return withRetry(() => breaker.call(fn), maxRetries, 1000);
}
