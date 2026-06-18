import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('perUserRateLimiter', () => {
  let perUserRateLimiter: any;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../middleware/rateLimiter');
    perUserRateLimiter = mod.perUserRateLimiter;
  });

  function mockReqRes(userId?: string, ip?: string) {
    const req: any = { userId, ip, socket: { remoteAddress: '127.0.0.1' } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis() };
    const next = vi.fn();
    return { req, res, next };
  }

  it('should allow requests up to limit', () => {
    const limiter = perUserRateLimiter(30, 60000);
    for (let i = 0; i < 30; i++) {
      const { req, res, next } = mockReqRes('user1');
      limiter(req, res, next);
      expect(next).toHaveBeenCalled();
      next.mockClear();
    }
  });

  it('should block the 31st request with 429', () => {
    const limiter = perUserRateLimiter(30, 60000);
    for (let i = 0; i < 30; i++) {
      const { req, res, next } = mockReqRes('user1');
      limiter(req, res, next);
      next.mockClear();
    }
    const { req, res, next } = mockReqRes('user1');
    limiter(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it('should reset after window expires', () => {
    vi.useFakeTimers();
    const limiter = perUserRateLimiter(1, 60000);
    const { req: req1, res: res1, next: next1 } = mockReqRes('user2');
    limiter(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    // Advance time past window
    vi.advanceTimersByTime(60001);

    const { req: req2, res: res2, next: next2 } = mockReqRes('user2');
    limiter(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('should fallback to IP when no userId', () => {
    const limiter = perUserRateLimiter(1, 60000);
    const { req, res, next } = mockReqRes(undefined, '10.0.0.1');
    limiter(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
