import NodeCache from 'node-cache';
import { getRedis } from '../infrastructure/redis';

export const cache = new NodeCache({ stdTTL: 60, checkperiod: 120, maxKeys: 100 });
const CACHE_PREFIX = 'terra:cache:';
const timestamps = new Map<string, number>();

/** Get a value from the local node-cache (synchronous, fast path). */
export function getLocal<T>(key: string): T | undefined {
  return cache.get<T>(key);
}

/** Get a value from the local cache or fall back to Redis. Returns the value and source. */
export async function getCached<T>(key: string): Promise<{ value: T | undefined; source: 'local' | 'redis' | 'miss' }> {
  const local = cache.get<T>(key);
  if (local !== undefined) return { value: local, source: 'local' };
  try {
    const redis = getRedis();
    const raw = await redis.get(CACHE_PREFIX + key);
    if (raw) {
      const parsed = JSON.parse(raw) as T;
      cache.set(key, parsed, 60);
      return { value: parsed, source: 'redis' };
    }
  } catch { /* Redis unavailable — fall back to local only */ }
  return { value: undefined, source: 'miss' };
}

/** Set a value in both local cache and Redis. */
export async function setCached(key: string, value: unknown, ttl = 60): Promise<void> {
  cache.set(key, value, ttl);
  timestamps.set(key, Date.now());
  try {
    const redis = getRedis();
    await redis.set(CACHE_PREFIX + key, JSON.stringify(value), 'EX', ttl);
  } catch { /* Redis unavailable — local cache still holds it */ }
}

/** Set a value in local cache only (no Redis). For ephemeral or single-instance data. */
export function setLocal(key: string, value: unknown, ttl = 60): void {
  cache.set(key, value, ttl);
  timestamps.set(key, Date.now());
}

/** Get the timestamp when a key was cached. */
export function getCachedAt(key: string): number | undefined {
  return timestamps.get(key);
}