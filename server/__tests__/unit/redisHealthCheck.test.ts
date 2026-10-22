import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPing = vi.fn();
const mockOn = vi.fn();

vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      on = mockOn;
      ping = mockPing;
      quit = vi.fn();
    },
  };
});

import { redisHealthCheck } from '../../infrastructure/redis';

describe('redisHealthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true and clears timeout when redis ping succeeds', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    mockPing.mockResolvedValueOnce('PONG');

    const result = await redisHealthCheck();
    expect(result).toBe(true);
    expect(mockPing).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('returns false and clears timeout when redis ping rejects', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    mockPing.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await redisHealthCheck();
    expect(result).toBe(false);
    expect(mockPing).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('returns false and times out when redis ping hangs past 500ms', async () => {
    vi.useFakeTimers();
    try {
      mockPing.mockReturnValueOnce(new Promise(() => {})); // Hangs past timeout

      const checkPromise = redisHealthCheck();
      await vi.advanceTimersByTimeAsync(500);

      const result = await checkPromise;
      expect(result).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
