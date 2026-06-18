import { createFlowMatching, type FlowMatching, type PointCloud, type Point3D } from './flowMatching';
import { computeKNNContext } from './knnContext';
import { type ConditioningVector, ConditionProjector, conditioningToArray } from './conditioning';
import { LatentTransformer } from './latentTransformer';
import { EarthGenDataset, type DatasetExample } from './dataset';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface EarthGenConfig {
  latentDim: number;
  numLatentTokens: number;
  numHeads: number;
  numLayers: number;
  hiddenDim: number;
  knn: number;
  numTimesteps: number;
  learningRate: number;
}

const DEFAULT_CONFIG: EarthGenConfig = {
  latentDim: 128,
  numLatentTokens: 512,
  numHeads: 4,
  numLayers: 6,
  hiddenDim: 256,
  knn: 8,
  numTimesteps: 1000,
  learningRate: 1e-3,
};

export interface Checkpoint {
  config: EarthGenConfig;
  transformerState: ReturnType<LatentTransformer['getParams']>;
  conditionProjector: ReturnType<ConditionProjector['getParams']>;
  epoch: number;
  loss: number;
}

export class EarthGenModel {
  config: EarthGenConfig;
  flow: FlowMatching;
  transformer: LatentTransformer;
  conditionProjector: ConditionProjector;
  dataset: EarthGenDataset;

  private velocityFn: (xt: PointCloud, t: number, c: number[]) => PointCloud;
  private optimizerStep: number;

  constructor(cfg?: Partial<EarthGenConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...cfg };
    this.flow = createFlowMatching({ numTimesteps: this.config.numTimesteps });
    this.transformer = new LatentTransformer({
      latentDim: this.config.latentDim,
      numLatentTokens: this.config.numLatentTokens,
      numHeads: this.config.numHeads,
      numLayers: this.config.numLayers,
      hiddenDim: this.config.hiddenDim,
    });
    this.conditionProjector = new ConditionProjector(64, this.config.latentDim);
    this.dataset = new EarthGenDataset({ numPoints: this.config.numLatentTokens });
    this.optimizerStep = 0;

    this.velocityFn = (xt: PointCloud, t: number, c: number[]) => {
      const withContext = computeKNNContext(xt, { k: this.config.knn });
      return this.transformer.forward(withContext, t, c);
    };
  }

  async train(
    dataset: DatasetExample[],
    epochs: number,
    onEpoch?: (epoch: number, loss: number, valLoss: number) => void,
  ): Promise<void> {
    this.dataset.addExamples(dataset);
    const split = this.dataset.getSplit(0.8);
    const lr = this.config.learningRate;

    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalLoss = 0;
      for (const ex of split.train) {
        const loss = this.trainStep(ex);
        totalLoss += loss;
      }
      const avgLoss = totalLoss / Math.max(1, split.train.length);

      let valLoss = 0;
      for (const ex of split.val) {
        valLoss += this.computeLoss(ex);
      }
      valLoss /= Math.max(1, split.val.length);

      if (onEpoch) onEpoch(epoch, avgLoss, valLoss);
    }
  }

  private trainStep(example: DatasetExample): number {
    const x0 = this.flow.samplePrior(example.cloud.length);
    const x1 = example.cloud;
    const tArr = this.flow.sampleTimestep();
    const t = tArr[0] || 0.5;

    const { xt, velocity: targetVel } = this.flow.computeVelocity(x0, x1, t);

    const c = example.conditioning;
    const condProjected = this.conditionProjector.forward({
      lat: c[0] * 90,
      lon: c[1] * 180,
      elevation: c[2] * 10,
      time: c[3],
      intensity: c[4] * 10,
      magnitude: c[5] * 10,
      severity: c[6],
      hazardType: 'seismic',
      spreadX: c[8] || 0.1,
      spreadY: c[9] || 0.1,
      spreadZ: c[10] || 0.05,
      mask: c[11] || 0,
    });

    const withContext = computeKNNContext(xt, { k: this.config.knn });
    const predictedVel = this.transformer.forward(withContext, t, condProjected);

    const loss = this.flow.computeLoss(predictedVel, x0, x1);

    this.optimizerStep++;

    return loss;
  }

  private computeLoss(example: DatasetExample): number {
    const x0 = this.flow.samplePrior(example.cloud.length);
    const x1 = example.cloud;
    const tArr = this.flow.sampleTimestep();
    const t = tArr[0] || 0.5;
    const { xt, velocity: targetVel } = this.flow.computeVelocity(x0, x1, t);
    const predictedVel = this.velocityFn(xt, t, example.conditioning);
    return this.flow.computeLoss(predictedVel, x0, x1);
  }

  generate(c: ConditioningVector, numPoints: number): PointCloud {
    const condArray = conditioningToArray(c);
    const condProjected = this.conditionProjector.forward(c);

    const velocityFn = (xt: PointCloud, t: number, _c: number[]): PointCloud => {
      const withContext = computeKNNContext(xt, { k: this.config.knn });
      return this.transformer.forward(withContext, t, condProjected);
    };

    return this.flow.generate(velocityFn, condArray, numPoints, 100);
  }

  interpolate(cloudA: PointCloud, cloudB: PointCloud, steps: number): PointCloud[] {
    const result: PointCloud[] = [];
    const maxN = Math.max(cloudA.length, cloudB.length);
    const a = cloudA.length >= maxN ? cloudA : padCloud(cloudA, maxN);
    const b = cloudB.length >= maxN ? cloudB : padCloud(cloudB, maxN);

    for (let i = 0; i <= steps; i++) {
      const alpha = i / steps;
      const interp: PointCloud = [];
      for (let j = 0; j < maxN; j++) {
        interp.push({
          x: (1 - alpha) * a[j].x + alpha * b[j].x,
          y: (1 - alpha) * a[j].y + alpha * b[j].y,
          z: (1 - alpha) * a[j].z + alpha * b[j].z,
        });
      }
      result.push(interp);
    }
    return result;
  }

  save(filePath: string): void {
    const checkpoint: Checkpoint = {
      config: this.config,
      transformerState: this.transformer.getParams(),
      conditionProjector: this.conditionProjector.getParams(),
      epoch: 0,
      loss: 0,
    };
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
  }

  load(filePath: string): void {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Checkpoint;
    this.transformer.setParams(data.transformerState);
    this.conditionProjector.setParams(data.conditionProjector);
  }
}

function padCloud(cloud: PointCloud, n: number): PointCloud {
  const result = [...cloud];
  while (result.length < n) {
    result.push({ ...result[result.length % result.length] });
  }
  return result;
}
