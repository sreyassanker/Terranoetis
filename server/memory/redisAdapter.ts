import { getRedis } from '../infrastructure/redis';
import { tryJsonParse } from '../utils/jsonParse';
import type Redis from 'ioredis';

export interface RedisMemoryItem {
  id: string;
  timestamp: number;
  content: unknown;
  importance: number;
  accessCount: number;
}

export class RedisMemoryAdapter {
  private readonly redis: Redis.Redis;
  private readonly keyPrefix: string;

  constructor(tierName: string) {
    this.redis = getRedis();
    this.keyPrefix = `terra:memory:${tierName}`;
  }

  async write(id: string, content: unknown, importance: number, ttlSeconds: number): Promise<void> {
    const item: RedisMemoryItem = {
      id,
      timestamp: Date.now(),
      content,
      importance,
      accessCount: 1,
    };
    const key = `${this.keyPrefix}:${id}`;
    await this.redis.setex(key, ttlSeconds, JSON.stringify(item));
  }

  async read(id: string): Promise<RedisMemoryItem | null> {
    const key = `${this.keyPrefix}:${id}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;

    const item = tryJsonParse<RedisMemoryItem>(raw);
    if (!item) return null;
    item.accessCount++;
    await this.redis.setex(key, this.getTtlForTier(), JSON.stringify(item));
    return item;
  }

  async query(sinceMs: number): Promise<Array<{ id: string; timestamp: number; content: unknown }>> {
    const pattern = `${this.keyPrefix}:*`;
    const keys: string[] = [];
    let cursor = '0';
    do {
      const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');

    const items: RedisMemoryItem[] = [];
    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (raw) {
        const item = tryJsonParse<RedisMemoryItem>(raw);
        if (item && item.timestamp >= sinceMs) {
          items.push(item);
        }
      }
    }

    return items
      .sort((a, b) => b.importance - a.importance)
      .map(i => ({ id: i.id, timestamp: i.timestamp, content: i.content }));
  }

  async getStats(): Promise<{ count: number; oldest: number; newest: number }> {
    const pattern = `${this.keyPrefix}:*`;
    const keys: string[] = [];
    let cursor = '0';
    do {
      const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');

    if (keys.length === 0) {
      return { count: 0, oldest: 0, newest: 0 };
    }

    let oldest = Infinity;
    let newest = 0;
    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (raw) {
        const item = tryJsonParse<RedisMemoryItem>(raw);
        if (item) {
          oldest = Math.min(oldest, item.timestamp);
          newest = Math.max(newest, item.timestamp);
        }
      }
    }

    return { count: keys.length, oldest, newest };
  }

  private getTtlForTier(): number {
    if (this.keyPrefix.includes('sensory')) return 60;
    if (this.keyPrefix.includes('working')) return 3600;
    return 3600;
  }
}
