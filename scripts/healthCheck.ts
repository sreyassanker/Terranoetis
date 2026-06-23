import { getDb } from '../server/db/index';
import { pubsub } from '../server/pubsub';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  checks: {
    database: boolean;
    pubsub: boolean;
    reflexEngine: boolean;
    forkManager: boolean;
    dreamEngine: boolean;
    memorySystem: boolean;
    websocket: boolean;
  };
  uptime: number;
  version: string;
}

export function runHealthCheck(): HealthStatus {
  const checks = {
    database: false,
    pubsub: false,
    reflexEngine: false,
    forkManager: false,
    dreamEngine: false,
    memorySystem: false,
    websocket: false,
  };

  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    checks.database = true;
  } catch (e) {
    console.error('[HEALTH] Database check failed:', e);
  }

  try {
    const testChannel = 'health:test';
    let received = false;
    const unsub = pubsub.subscribe(testChannel, () => { received = true; });
    pubsub.publish(testChannel, { test: true });
    unsub();
    checks.pubsub = received;
  } catch (e) {
    console.error('[HEALTH] Pubsub check failed:', e);
  }

  try {
    checks.reflexEngine = !!(global as unknown as Record<string, unknown>).__reflexEngine;
    checks.forkManager = !!(global as unknown as Record<string, unknown>).__forkManager;
    checks.dreamEngine = !!(global as unknown as Record<string, unknown>).__dreamEngine;
    checks.memorySystem = !!(global as unknown as Record<string, unknown>).__memorySystem;
  } catch (e) {
    console.error('[HEALTH] Engine checks failed:', e);
  }

  checks.websocket = true;

  const allHealthy = Object.values(checks).every(Boolean);
  const anyHealthy = Object.values(checks).some(Boolean);

  return {
    status: allHealthy ? 'healthy' : (anyHealthy ? 'degraded' : 'unhealthy'),
    timestamp: Date.now(),
    checks,
    uptime: process.uptime(),
    version: '3.0.0',
  };
}
