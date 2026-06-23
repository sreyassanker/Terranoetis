import { EarthGenModel } from '../../earthgen/earthGen';
import { EarthGenDataset, type DatasetExample } from '../../earthgen/dataset';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../observability/logger';
import { getDb } from '../../db/index';

export interface RetrainingConfig {
  checkpointDir: string;
  minNewSamples: number;
  validationThreshold: number;
  maxEpochs: number;
  patience: number;
}

interface ExperienceReplaySample {
  example: DatasetExample;
  timestamp: string;
  source: string;
}

const DEFAULT_CONFIG: RetrainingConfig = {
  checkpointDir: './checkpoints/earthgen',
  minNewSamples: 50,
  validationThreshold: 0.1,
  maxEpochs: 50,
  patience: 10,
};

export class RetrainingPipeline {
  private config: RetrainingConfig;
  private replayBuffer: ExperienceReplaySample[] = [];
  private currentModel: EarthGenModel;
  private trainingCount = 0;

  constructor(cfg?: Partial<RetrainingConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...cfg };
    this.currentModel = new EarthGenModel();
  }

  init(): void {
    const dir = this.config.checkpointDir;
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();
      if (files.length > 0) {
        const latest = path.join(dir, files[0]);
        try {
          this.currentModel.load(latest);
          logger.info({ checkpoint: latest }, 'Retraining loaded latest checkpoint');
        } catch (e) {
          logger.warn({ err: e }, 'Failed to load checkpoint for retraining');
        }
      }
    }
    this.trainingCount = this.loadTrainingCount();
  }

  addExperience(
    cloud: Array<{ x: number; y: number; z: number }>,
    conditioning: number[],
    label: string,
    source: string,
  ): void {
    this.replayBuffer.push({
      example: { cloud, conditioning, label },
      timestamp: new Date().toISOString(),
      source,
    });
    logger.info({ bufferSize: this.replayBuffer.length, source }, 'Experience added for retraining');
  }

  async maybeRetrain(): Promise<boolean> {
    if (this.replayBuffer.length < this.config.minNewSamples) {
      logger.info({ need: this.config.minNewSamples - this.replayBuffer.length }, 'Not enough samples for retraining');
      return false;
    }

    const dataset = new EarthGenDataset({ numPoints: 4096 });
    const replayExamples = this.prepareReplayData();
    dataset.addExamples(replayExamples);
    const split = dataset.getSplit(0.8);

    const oldValLoss = this.evaluateOnValidation(split.val);
    logger.info({ oldValLoss, newSamples: this.replayBuffer.length }, 'Retraining: evaluating current model');

    let bestValLoss = oldValLoss;
    let epochsNoImprove = 0;

    for (let epoch = 0; epoch < this.config.maxEpochs; epoch++) {
      try {
        await this.currentModel.train(split.train, 1, (ep, loss, valLoss) => {
          if (epoch % 5 === 0) {
            logger.info({ epoch, trainLoss: loss, valLoss }, 'Retraining progress');
          }
          if (valLoss < bestValLoss) {
            bestValLoss = valLoss;
            epochsNoImprove = 0;
            this.saveCheckpoint(epoch);
          } else {
            epochsNoImprove++;
          }
        });
      } catch (e) {
        logger.error({ err: e, epoch }, 'Retraining epoch failed');
      }

      if (epochsNoImprove >= this.config.patience) {
        logger.info({ epochs: epoch }, 'Retraining early stopping');
        break;
      }
    }

    const improvement = oldValLoss - bestValLoss;
    if (improvement > this.config.validationThreshold) {
      this.trainingCount++;
      this.saveTrainingCount();
      this.replayBuffer = [];
      logger.info({ improvement, trainingCount: this.trainingCount }, 'Model retrained and deployed');
      return true;
    }

    logger.info({ improvement }, 'Retraining: insufficient improvement, keeping current model');
    return false;
  }

  private prepareReplayData(): DatasetExample[] {
    const samples: DatasetExample[] = [];
    const currentSize = this.replayBuffer.length;

    for (const sample of this.replayBuffer) {
      samples.push(sample.example);
    }

    if (currentSize > 0) {
      for (let _i = 0; _i < currentSize; _i++) {
        const oldIdx = Math.floor(Math.random() * currentSize);
        const oldSample = this.replayBuffer[oldIdx];
        if (oldSample) samples.push(oldSample.example);
      }
    }

    return samples;
  }

  private evaluateOnValidation(valSet: DatasetExample[]): number {
    if (valSet.length === 0) return 0;
    let totalLoss = 0;
    for (const ex of valSet) {
      const x0 = this.currentModel.flow.samplePrior(ex.cloud.length);
      const tArr = this.currentModel.flow.sampleTimestep();
      const t = tArr[0] || 0.5;
      const { xt } = this.currentModel.flow.computeVelocity(x0, ex.cloud, t);
      const predictedVel = this.currentModel.velocityFn(xt, t, ex.conditioning);
      totalLoss += this.currentModel.flow.computeLoss(predictedVel, x0, ex.cloud);
    }
    return totalLoss / valSet.length;
  }

  private saveCheckpoint(epoch: number): void {
    const dir = this.config.checkpointDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ckptPath = path.join(dir, `earthgen_retrain_epoch${epoch}.json`);
    this.currentModel.save(ckptPath);
  }

  private loadTrainingCount(): number {
    try {
      const db = getDb();
      const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('retraining_count') as { value: string } | undefined;
      return row ? parseInt(row.value) : 0;
    } catch {
      return 0;
    }
  }

  private saveTrainingCount(): void {
    try {
      const db = getDb();
      db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('retraining_count', String(this.trainingCount));
    } catch { /* best-effort */ }
  }

  getStatus(): { bufferSize: number; trainingCount: number; lastCheckpoint: string } {
    const files = fs.existsSync(this.config.checkpointDir)
      ? fs.readdirSync(this.config.checkpointDir).filter(f => f.endsWith('.json')).sort().reverse()
      : [];
    return {
      bufferSize: this.replayBuffer.length,
      trainingCount: this.trainingCount,
      lastCheckpoint: files[0] || 'none',
    };
  }
}

export const retrainingPipeline = new RetrainingPipeline();
