import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlanetaryMemorySystem } from '../../memory/memorySystem';

vi.mock('../../db', () => ({
  getDb: () => ({
    prepare: () => ({
      run: vi.fn().mockReturnValue({ changes: 1 }),
      get: vi.fn(),
      all: vi.fn(() => []),
    }),
  }),
}));

vi.mock('../../pubsub', () => ({
  pubsub: {
    publish: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock('../../infrastructure/redis', () => ({
  redisHealthCheck: vi.fn().mockResolvedValue(false),
  closeRedis: vi.fn().mockResolvedValue(undefined),
  getRedis: vi.fn(() => ({
    ping: vi.fn().mockResolvedValue('PONG'),
    get: vi.fn(),
    setex: vi.fn(),
    scan: vi.fn().mockResolvedValue(['0', []]),
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('PlanetaryMemorySystem', () => {
  let mem: PlanetaryMemorySystem;

  beforeEach(() => {
    mem = new PlanetaryMemorySystem();
  });

  afterEach(async () => {
    await mem.close();
  });

  it('write and read sensory memory', async () => {
    const content = { type: 'sensor', value: 42 };
    await mem.write('sensory', 'sensor-001', content, 0.3);
    const result = await mem.read('sensory', 'sensor-001');
    expect(result).toEqual(content);
  });

  it('query memory returns recent entries', async () => {
    const now = Date.now();
    await mem.write('working', 'task-1', { action: 'evaluate' }, 0.8);
    const results = await mem.query('working', now - 1000);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('task-1');
  });

  it('capacity eviction for sensory tier', async () => {
    for (let i = 0; i < 10005; i++) {
      await mem.write('sensory', `sensor-${i}`, { value: i }, 0.1);
    }
    const stats = await mem.getStats();
    expect(stats.sensory.count).toBeLessThanOrEqual(10000);
  });

  it('getStats returns structure for all 5 tiers', async () => {
    const stats = await mem.getStats();
    const tiers = ['sensory', 'working', 'episodic', 'semantic', 'procedural'];
    for (const tier of tiers) {
      expect(stats[tier]).toBeDefined();
      expect(stats[tier]).toHaveProperty('count');
      expect(stats[tier]).toHaveProperty('oldest');
      expect(stats[tier]).toHaveProperty('newest');
    }
  });
});
