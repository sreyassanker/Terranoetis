import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ForkManager } from '../../fork/manager';

vi.mock('../../pubsub', () => ({
  pubsub: {
    publish: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock('../../db', () => ({
  getDb: () => ({
    prepare: () => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    }),
  }),
}));

describe('ForkManager', () => {
  let manager: ForkManager;

  beforeEach(() => {
    manager = new ForkManager();
  });

  afterEach(() => {
    manager.stop();
  });

  it('createFork returns valid fork definition', () => {
    const fork = manager.createFork({
      name: 'Test Fork',
      lat: 35.7,
      lon: 139.7,
      deltas: [{ type: 'INJECT_EVENT', targetId: 'test', parameters: {}, effectiveTimeOffsetHours: 0 }],
    }, 'test-user');

    expect(fork.forkId).toMatch(/^fork_\d+_[a-z0-9]+$/);
    expect(fork.name).toBe('Test Fork');
    expect(fork.status).toBe('running');
    expect(fork.divergenceScore).toBe(0);
  });

  it('getAllForks returns created forks', () => {
    manager.createFork({ name: 'Fork A', lat: 0, lon: 0, deltas: [] }, 'user');
    manager.createFork({ name: 'Fork B', lat: 0, lon: 0, deltas: [] }, 'user');
    expect(manager.getAllForks().length).toBe(2);
  });

  it('terminateFork sets terminated status', () => {
    const fork = manager.createFork({ name: 'To Terminate', lat: 0, lon: 0, deltas: [] }, 'user');
    manager.terminateFork(fork.forkId, 'test');
    const gotten = manager.getFork(fork.forkId);
    expect(gotten).toBeDefined();
    expect(gotten!.status).toBe('terminated');
  });

  it('pauseFork and resumeFork toggle status', () => {
    const fork = manager.createFork({ name: 'Toggle', lat: 0, lon: 0, deltas: [] }, 'user');
    manager.pauseFork(fork.forkId);
    expect(manager.getFork(fork.forkId)?.status).toBe('paused');
    manager.resumeFork(fork.forkId);
    expect(manager.getFork(fork.forkId)?.status).toBe('running');
  });

  it('max concurrent forks limit', () => {
    for (let i = 0; i < 50; i++) {
      manager.createFork({ name: `Fork ${i}`, lat: 0, lon: 0, deltas: [] }, 'user');
    }
    expect(() => {
      manager.createFork({ name: 'Over Limit', lat: 0, lon: 0, deltas: [] }, 'user');
    }).toThrow(/Maximum concurrent forks reached/);
  });
});
