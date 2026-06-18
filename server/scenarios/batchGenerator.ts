import { type ScenarioType, type ScenarioBase } from './templates';
import { generateScenario } from './scenarioGenerator';
import { scenarioDb } from './scenarioDb';

export interface BatchConfig {
  types: ScenarioType[];
  countPerType: number;
  validationThreshold: number;
  parallel: number;
}

export interface BatchProgress {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  scenarios: ScenarioBase[];
  done: boolean;
}

const activeBatches = new Map<string, BatchProgress>();

export function generateBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export async function generateBatch(
  config: BatchConfig,
  onProgress?: (progress: BatchProgress) => void,
): Promise<BatchProgress> {
  const batchId = generateBatchId();
  const total = config.types.length * config.countPerType;
  const progress: BatchProgress = {
    batchId,
    total,
    completed: 0,
    failed: 0,
    scenarios: [],
    done: false,
  };
  activeBatches.set(batchId, progress);

  const tasks: Array<{ type: ScenarioType; idx: number }> = [];
  for (const type of config.types) {
    for (let i = 0; i < config.countPerType; i++) {
      tasks.push({ type, idx: i });
    }
  }

  const poolSize = Math.min(config.parallel, 8);

  async function worker(): Promise<void> {
    while (tasks.length > 0) {
      const task = tasks.shift();
      if (!task) break;
      try {
        const scenario = await generateScenario(task.type);
        if (scenario.validationScore >= config.validationThreshold) {
          scenarioDb.save(scenario);
          progress.scenarios.push(scenario);
          progress.completed++;
        } else {
          progress.failed++;
        }
      } catch {
        progress.failed++;
      }
      progress.done = tasks.length === 0;
      if (onProgress) onProgress({ ...progress });
    }
  }

  const workers = Array.from({ length: poolSize }, () => worker());
  await Promise.all(workers);
  progress.done = true;
  if (onProgress) onProgress({ ...progress });

  return progress;
}

export function getBatchProgress(batchId: string): BatchProgress | undefined {
  return activeBatches.get(batchId);
}
