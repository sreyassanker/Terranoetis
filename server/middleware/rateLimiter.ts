import type { Request, Response, NextFunction } from 'express';

interface RateEntry {
  count: number;
  resetAt: number;
}

/** In-process limits. For multi-instance production, use Redis-backed store (see SECURITY.md). */
const limits = new Map<string, RateEntry>();

export function perUserRateLimiter(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = (req as any).userId || req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = limits.get(key);

    if (!entry || now > entry.resetAt) {
      limits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      res.set('X-RateLimit-Limit', String(maxRequests));
      res.set('X-RateLimit-Remaining', '0');
      res.set('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
      res.status(429).json({ error: `Rate limit exceeded. Try again in ${retryAfter}s.` });
      return;
    }

    entry.count++;
    res.set('X-RateLimit-Limit', String(maxRequests));
    res.set('X-RateLimit-Remaining', String(maxRequests - entry.count));
    next();
  };
}

/**
 * Rate limiter that keys on IP rather than userId.
 * Used for unauthenticated endpoints like /api/auth/login.
 */
export function perIpRateLimiter(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = limits.get(`ip:${key}`);

    if (!entry || now > entry.resetAt) {
      limits.set(`ip:${key}`, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      res.set('X-RateLimit-Limit', String(maxRequests));
      res.set('X-RateLimit-Remaining', '0');
      res.set('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
      res.status(429).json({ error: `Rate limit exceeded. Try again in ${retryAfter}s.` });
      return;
    }

    entry.count++;
    res.set('X-RateLimit-Limit', String(maxRequests));
    res.set('X-RateLimit-Remaining', String(maxRequests - entry.count));
    next();
  };
}

export function getRateLimitStats(): { size: number } {
  return { size: limits.size };
}

// Periodic cleanup of expired entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of limits) {
    if (now > entry.resetAt) limits.delete(key);
  }
}, 300_000);
