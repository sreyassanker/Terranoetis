export const ENERGY_COST = {
  API_FETCH_CACHED: 0.001,
  API_FETCH_LIVE: 0.05,
  PCNO_FORWARD_PASS: 0.005,
  CBN_UPDATE_10K: 0.08,
  IDW_200_200: 0.012,
  IDW_WASM_200_200: 0.003,
  SURFACE_RENDER: 0.002,
  CROSS_ATTENTION: 0.015,
  SCENARIO_ROLLOUT: 0.005,
} as const;

interface BudgetEntry {
  operation: string;
  energyJ: number;
  timeMs: number;
  timestamp: number;
}

const log: BudgetEntry[] = [];
const MAX_LOG = 500;

export function track(operation: string, energyJ: number, timeMs: number): void {
  log.push({ operation, energyJ, timeMs, timestamp: Date.now() });
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
}

export function getBudgetLog(): BudgetEntry[] {
  return [...log];
}

export function getTotalEnergy(): number {
  return log.reduce((sum, e) => sum + e.energyJ, 0);
}

export function getSessionEnergy(): { totalJ: number; totalMs: number; operationCount: number } {
  const start = Date.now() - 3600000;
  const recent = log.filter(e => e.timestamp > start);
  return {
    totalJ: recent.reduce((s, e) => s + e.energyJ, 0),
    totalMs: recent.reduce((s, e) => s + e.timeMs, 0),
    operationCount: recent.length,
  };
}

export function getEnergyReport(): string {
  const s = getSessionEnergy();
  return [
    `Energy Budget (last 1h):`,
    `  Total: ${(s.totalJ * 1000).toFixed(2)} mJ`,
    `  CPU time: ${s.totalMs.toFixed(0)} ms`,
    `  Operations: ${s.operationCount}`,
    `  Avg per op: ${s.operationCount > 0 ? ((s.totalJ / s.operationCount) * 1000).toFixed(3) : 0} mJ`,
  ].join('\n');
}

export function trackOperation(operation: keyof typeof ENERGY_COST, timeMs: number): void {
  track(operation, ENERGY_COST[operation], timeMs);
}
