import { pubsub } from '../pubsub';
import { getDb } from '../db';
import type { ForkDefinition, ForkState, ForkCreateRequest, ForkStreamMessage } from './types';

export class ForkManager {
  private forks: Map<string, ForkDefinition>;
  private forkStates: Map<string, ForkState>;
  private tickInterval: NodeJS.Timeout | null = null;
  private readonly MAX_CONCURRENT_FORKS = 50;
  private readonly TICK_MS = 100;
  private readonly SIMULATION_SPEED = 1000;

  constructor() {
    this.forks = new Map();
    this.forkStates = new Map();
  }

  start(): void {
    this.tickInterval = setInterval(() => this.tickAll(), this.TICK_MS);
    console.log('[FORK] Manager started — tick interval:', this.TICK_MS, 'ms');
  }

  stop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    for (const [forkId] of this.forks) {
      this.terminateFork(forkId, 'manager_shutdown');
    }
    console.log('[FORK] Manager stopped');
  }

  createFork(request: ForkCreateRequest, userId: string): ForkDefinition {
    if (this.forks.size >= this.MAX_CONCURRENT_FORKS) {
      throw new Error(`Maximum concurrent forks reached (${this.MAX_CONCURRENT_FORKS})`);
    }

    const forkId = `fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fork: ForkDefinition = {
      forkId,
      name: request.name,
      createdAt: Date.now(),
      createdBy: userId,
      baselineSnapshot: '{}',
      deltas: request.deltas,
      status: 'running',
      divergenceScore: 0.0,
      simulatedTimeMs: 0,
      maxSimulationHours: request.maxSimulationHours ?? 72,
    };

    const state: ForkState = {
      forkId,
      entities: {},
      events: [],
      lastTick: Date.now(),
    };

    this.forks.set(forkId, fork);
    this.forkStates.set(forkId, state);

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO forks (fork_id, name, created_by, baseline_snapshot, deltas_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(forkId, request.name, userId, fork.baselineSnapshot, JSON.stringify(request.deltas), 'running', new Date(fork.createdAt).toISOString());
    } catch (e) {
      console.error('[FORK] Failed to persist fork:', e);
    }

    this.broadcast(forkId, { type: 'FORK_INIT', forkId, timestamp: Date.now(), payload: { fork, request } });
    this.applyDeltas(forkId);

    console.log(`[FORK] Created ${forkId}: "${request.name}" at ${request.lat},${request.lon}`);
    return fork;
  }

  private applyDeltas(forkId: string): void {
    const fork = this.forks.get(forkId);
    const state = this.forkStates.get(forkId);
    if (!fork || !state) return;

    for (const delta of fork.deltas) {
      const event = {
        type: delta.type,
        targetId: delta.targetId,
        parameters: delta.parameters,
        appliedAt: Date.now(),
        simulatedAt: delta.effectiveTimeOffsetHours,
      };
      state.events.push(event);

      if (delta.type === 'CLOSE_PORT') {
        state.entities[`port_${delta.targetId}`] = { status: 'closed', capacity: 0 };
      } else if (delta.type === 'BLOCK_ROUTE') {
        state.entities[`route_${delta.targetId}`] = { status: 'blocked', throughput: 0 };
      } else if (delta.type === 'INJECT_EVENT') {
        state.events.push({
          type: 'injected',
          ...delta.parameters,
          appliedAt: Date.now(),
        });
      }
    }

    this.broadcast(forkId, { type: 'FORK_EVENT', forkId, timestamp: Date.now(), payload: { events: state.events.slice(-5) } });
  }

  private tickAll(): void {
    for (const [forkId, fork] of this.forks) {
      if (fork.status !== 'running') continue;
      this.tickFork(forkId);
    }
  }

  private tickFork(forkId: string): void {
    const fork = this.forks.get(forkId);
    const state = this.forkStates.get(forkId);
    if (!fork || !state) return;

    const now = Date.now();
    const realElapsedMs = now - state.lastTick;
    const simulatedElapsedMs = realElapsedMs * this.SIMULATION_SPEED;
    fork.simulatedTimeMs += simulatedElapsedMs;
    state.lastTick = now;

    const hoursSimulated = fork.simulatedTimeMs / (3600 * 1000);
    const divergence = Math.min(0.99, hoursSimulated * 0.01 + state.events.length * 0.05);
    fork.divergenceScore = divergence;

    const maxSimulatedMs = fork.maxSimulationHours * 3600 * 1000;
    if (divergence > 0.9 || fork.simulatedTimeMs >= maxSimulatedMs) {
      this.terminateFork(forkId, divergence > 0.9 ? 'divergence_limit' : 'time_limit');
      return;
    }

    this.broadcast(forkId, {
      type: 'FORK_TICK',
      forkId,
      timestamp: now,
      payload: {
        simulatedTimeMs: fork.simulatedTimeMs,
        divergenceScore: fork.divergenceScore,
        entityCount: Object.keys(state.entities).length,
        eventCount: state.events.length,
      }
    });
  }

  terminateFork(forkId: string, reason: string): void {
    const fork = this.forks.get(forkId);
    if (!fork) return;

    fork.status = 'terminated';
    this.broadcast(forkId, { type: 'FORK_TERMINATED', forkId, timestamp: Date.now(), payload: { reason } });

    try {
      const db = getDb();
      db.prepare(`UPDATE forks SET status = ?, terminated_at = ?, termination_reason = ? WHERE fork_id = ?`)
        .run('terminated', new Date().toISOString(), reason, forkId);
    } catch (e) {
      console.error('[FORK] Failed to update fork status:', e);
    }

    setTimeout(() => {
      this.forks.delete(forkId);
      this.forkStates.delete(forkId);
      console.log(`[FORK] Cleaned up ${forkId}`);
    }, 30000);

    console.log(`[FORK] Terminated ${forkId}: ${reason}`);
  }

  pauseFork(forkId: string): void {
    const fork = this.forks.get(forkId);
    if (fork) { fork.status = 'paused'; console.log(`[FORK] Paused ${forkId}`); }
  }

  resumeFork(forkId: string): void {
    const fork = this.forks.get(forkId);
    if (fork) {
      fork.status = 'running';
      const state = this.forkStates.get(forkId);
      if (state) state.lastTick = Date.now();
      console.log(`[FORK] Resumed ${forkId}`);
    }
  }

  private broadcast(forkId: string, message: ForkStreamMessage): void {
    pubsub.publish(`fork:${forkId}`, message);
    pubsub.publish('fork:all', { ...message, forkId });
  }

  getFork(forkId: string): ForkDefinition | undefined { return this.forks.get(forkId); }
  getAllForks(): ForkDefinition[] { return Array.from(this.forks.values()); }
  getForkState(forkId: string): ForkState | undefined { return this.forkStates.get(forkId); }
}

export const forkManager = new ForkManager();
