import Redis from 'ioredis';
import { logger } from '../observability/logger';

let redisClient: Redis | null = null;
let redisWarned = false;

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    redisClient.on('error', (err) => {
      if (!redisWarned) {
        redisWarned = true;
        logger.warn({ err: err.message }, 'Redis unavailable — falling back to SQLite');
      }
    });

    redisClient.on('connect', () => {
      redisWarned = false;
      logger.info('Redis connected');
    });
  }
  return redisClient;
}

export async function redisHealthCheck(): Promise<boolean> {
  try {
    const redis = getRedis();
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
