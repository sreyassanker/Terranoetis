import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, withRetry } from '../../resilience';

describe('CircuitBreaker', () => {
  it('constructor creates closed circuit', () => {
    const cb = new CircuitBreaker(5, 60000, 30000);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('5 failures opens circuit', async () => {
    const cb = new CircuitBreaker(3, 60000, 30000);
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(fn)).rejects.toThrow('fail');
    }
    expect(cb.getState()).toBe('OPEN');
  });

  it('OPEN state rejects immediately', async () => {
    const cb = new CircuitBreaker(1, 60000, 30000);
    await expect(cb.call(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    await expect(cb.call(() => Promise.resolve('ok'))).rejects.toThrow('Circuit breaker is OPEN');
  });

  it('after reset timeout, enters HALF_OPEN and allows one call', async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker(1, 60000, 10000);
    await expect(cb.call(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    expect(cb.getState()).toBe('OPEN');
    vi.advanceTimersByTime(10001);
    const result = await cb.call(() => Promise.resolve('success'));
    expect(result).toBe('success');
    expect(cb.getState()).toBe('CLOSED');
    vi.useRealTimers();
  });
});

describe('withRetry', () => {
  it('succeeds on first try', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn, 3, 100);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds on 3rd try after 2 failures', async () => {
    let attempts = 0;
    const fn = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      return 'success';
    });
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('fails after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent'));
    await expect(withRetry(fn, 2, 10)).rejects.toThrow('persistent');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
