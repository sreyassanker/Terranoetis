import { getDb } from '../db/index';
import { pubsub } from '../pubsub';
import { RedisMemoryAdapter } from './redisAdapter';
import { redisHealthCheck, closeRedis } from '../infrastructure/redis';

export interface MemoryTier {
  tier: 'sensory' | 'working' | 'episodic' | 'semantic' | 'procedural';
  capacity: number;
  retentionMs: number;
  items: Array<{
    id: string;
    timestamp: number;
    content: any;
    importance: number;
    accessCount: number;
  }>;
}

export class PlanetaryMemorySystem {
  private tiers: Map<string, MemoryTier>;
  private decayInterval: ReturnType<typeof setInterval> | null = null;
  private readonly DECAY_INTERVAL_MS = 60000;
  private redisAdapters: Map<string, RedisMemoryAdapter>;
  private redisAvailable: boolean = false;

  constructor() {
    this.tiers = new Map();
    this.initializeTiers();
    this.redisAdapters = new Map();
    this.redisAdapters.set('sensory', new RedisMemoryAdapter('sensory'));
    this.redisAdapters.set('working', new RedisMemoryAdapter('working'));
  }

  private initializeTiers(): void {
    this.tiers.set('sensory', {
      tier: 'sensory',
      capacity: 10000,
      retentionMs: 60000,
      items: [],
    });
    this.tiers.set('working', {
      tier: 'working',
      capacity: 1000,
      retentionMs: 3600000,
      items: [],
    });
    this.tiers.set('episodic', {
      tier: 'episodic',
      capacity: 10000,
      retentionMs: 7 * 24 * 3600000,
      items: [],
    });
    this.tiers.set('semantic', {
      tier: 'semantic',
      capacity: Infinity,
      retentionMs: Infinity,
      items: [],
    });
    this.tiers.set('procedural', {
      tier: 'procedural',
      capacity: 1000,
      retentionMs: Infinity,
      items: [],
    });
  }

  async start(): Promise<void> {
    this.redisAvailable = await redisHealthCheck();
    if (this.redisAvailable) {
      console.log('[MEMORY] Redis hot state enabled for sensory/working tiers');
    } else {
      console.warn('[MEMORY] Redis unavailable — falling back to SQLite for all tiers');
    }
    this.decayInterval = setInterval(() => this.decay(), this.DECAY_INTERVAL_MS);
    console.log('[MEMORY] Planetary Memory System started');
  }

  stop(): void {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
    }
  }

  async write(tierName: string, id: string, content: any, importance: number = 0.5): Promise<void> {
    const redisAdapter = this.redisAdapters.get(tierName);
    if (redisAdapter && this.redisAvailable) {
      const ttl = tierName === 'sensory' ? 60 : 3600;
      await redisAdapter.write(id, content, importance, ttl);
      if (tierName === 'episodic' || tierName === 'procedural') {
        this.persistToDb(tierName, id, content, importance);
      }
      return;
    }

    const tier = this.tiers.get(tierName);
    if (!tier) {
      console.warn(`[MEMORY] Unknown tier: ${tierName}`);
      return;
    }

    tier.items = tier.items.filter(item => item.id !== id);

    tier.items.push({
      id,
      timestamp: Date.now(),
      content,
      importance: Math.max(0, Math.min(1, importance)),
      accessCount: 1,
    });

    if (tier.capacity !== Infinity && tier.items.length > tier.capacity) {
      tier.items.sort((a, b) => (a.importance * a.accessCount) - (b.importance * b.accessCount));
      const evicted = tier.items.splice(0, tier.items.length - tier.capacity);
      for (const item of evicted) {
        pubsub.publish('memory:evicted', { tier: tierName, id: item.id, reason: 'capacity' });
      }
    }

    if (tierName === 'episodic' || tierName === 'procedural') {
      this.persistToDb(tierName, id, content, importance);
    }
  }

  async read(tierName: string, id: string): Promise<any | null> {
    const redisAdapter = this.redisAdapters.get(tierName);
    if (redisAdapter && this.redisAvailable) {
      const item = await redisAdapter.read(id);
      if (item) return item.content;
    }

    const tier = this.tiers.get(tierName);
    if (!tier) return null;

    const item = tier.items.find(i => i.id === id);
    if (item) {
      item.accessCount++;
      return item.content;
    }

    if (['episodic', 'semantic', 'procedural'].includes(tierName)) {
      return this.readFromDb(tierName, id);
    }

    return null;
  }

  async query(tierName: string, sinceMs: number): Promise<Array<{ id: string; timestamp: number; content: any }>> {
    const redisAdapter = this.redisAdapters.get(tierName);
    if (redisAdapter && this.redisAvailable) {
      return redisAdapter.query(sinceMs);
    }

    const tier = this.tiers.get(tierName);
    if (!tier) return [];
    const cutoff = Date.now() - sinceMs;
    return tier.items
      .filter(i => i.timestamp >= cutoff)
      .sort((a, b) => b.importance - a.importance)
      .map(i => ({ id: i.id, timestamp: i.timestamp, content: i.content }));
  }

  async getStats(): Promise<Record<string, { count: number; oldest: number; newest: number }>> {
    const stats: Record<string, { count: number; oldest: number; newest: number }> = {};
    for (const [name, tier] of this.tiers) {
      const redisAdapter = this.redisAdapters.get(name);
      if (redisAdapter && this.redisAvailable) {
        stats[name] = await redisAdapter.getStats();
      } else {
        if (tier.items.length === 0) {
          stats[name] = { count: 0, oldest: 0, newest: 0 };
        } else {
          const timestamps = tier.items.map(i => i.timestamp);
          stats[name] = {
            count: tier.items.length,
            oldest: Math.min(...timestamps),
            newest: Math.max(...timestamps),
          };
        }
      }
    }
    return stats;
  }

  async close(): Promise<void> {
    this.stop();
    await closeRedis();
  }

  private decay(): void {
    const now = Date.now();
    for (const [name, tier] of this.tiers) {
      if (tier.retentionMs === Infinity) continue;

      const cutoff = now - tier.retentionMs;
      const before = tier.items.length;
      tier.items = tier.items.filter(item => {
        const keep = item.timestamp >= cutoff || item.importance > 0.8;
        if (!keep) {
          pubsub.publish('memory:decayed', { tier: name, id: item.id, age: now - item.timestamp });
        }
        return keep;
      });
      const after = tier.items.length;
      if (before !== after) {
        console.log(`[MEMORY] ${name}: decayed ${before - after} items, ${after} remaining`);
      }
    }
  }

  private persistToDb(tierName: string, id: string, content: any, importance: number): void {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO memory_store (tier, memory_id, content_json, importance, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(tier, memory_id) DO UPDATE SET
          content_json = excluded.content_json,
          importance = excluded.importance,
          updated_at = datetime('now')
      `).run(tierName, id, JSON.stringify(content), importance, new Date().toISOString());
    } catch (e) {
      console.error('[MEMORY] DB persist failed:', e);
    }
  }

  private readFromDb(tierName: string, id: string): any | null {
    try {
      const db = getDb();
      const row = db.prepare('SELECT content_json FROM memory_store WHERE tier = ? AND memory_id = ?').get(tierName, id) as { content_json: string } | undefined;
      return row ? JSON.parse(row.content_json) : null;
    } catch (e) {
      console.error('[MEMORY] DB read failed:', e);
      return null;
    }
  }
}
