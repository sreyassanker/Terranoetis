export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export type PointCloud = Point3D[];

export interface FlowMatchingConfig {
  numTimesteps: number;
  sigmaMin: number;
  cosineS: number;
}

const DEFAULT_CONFIG: FlowMatchingConfig = {
  numTimesteps: 1000,
  sigmaMin: 1e-4,
  cosineS: 0.008,
};

function cosineSchedule(t: number, s: number): number {
  return (Math.cos(((t + s) / (1 + s)) * (Math.PI / 2))) ** 2;
}

function sampleTimestep(batchSize: number, config: FlowMatchingConfig): number[] {
  const steps: number[] = [];
  for (let i = 0; i < batchSize; i++) {
    const u = Math.random();
    const t = (1 + config.cosineS) * (1 - Math.acos(Math.sqrt(u)) / (Math.PI / 2)) - config.cosineS;
    steps.push(Math.max(0, Math.min(1, t)));
  }
  return steps;
}

function standardGaussian3D(n: number): PointCloud {
  const cloud: PointCloud = [];
  for (let i = 0; i < n; i++) {
    cloud.push({
      x: randn(),
      y: randn(),
      z: randn(),
    });
  }
  return cloud;
}

function randn(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function interpolatePointwise(x0: PointCloud, x1: PointCloud, t: number): PointCloud {
  const n = Math.min(x0.length, x1.length);
  const xt: PointCloud = [];
  for (let i = 0; i < n; i++) {
    xt.push({
      x: (1 - t) * x0[i].x + t * x1[i].x,
      y: (1 - t) * x0[i].y + t * x1[i].y,
      z: (1 - t) * x0[i].z + t * x1[i].z,
    });
  }
  return xt;
}

function computeVelocity(xt: PointCloud, x1: PointCloud): PointCloud {
  const n = Math.min(xt.length, x1.length);
  const vel: PointCloud = [];
  for (let i = 0; i < n; i++) {
    vel.push({
      x: x1[i].x - xt[i].x,
      y: x1[i].y - xt[i].y,
      z: x1[i].z - xt[i].z,
    });
  }
  return vel;
}

function mseLoss(predicted: PointCloud, target: PointCloud): number {
  const n = Math.min(predicted.length, target.length);
  let loss = 0;
  for (let i = 0; i < n; i++) {
    const dx = predicted[i].x - target[i].x;
    const dy = predicted[i].y - target[i].y;
    const dz = predicted[i].z - target[i].z;
    loss += (dx * dx + dy * dy + dz * dz) / 3;
  }
  return loss / n;
}

function midpointODEStep(
  xt: PointCloud,
  t: number,
  dt: number,
  velocityFn: (xt: PointCloud, t: number, c: number[]) => PointCloud,
  c: number[],
): PointCloud {
  const k1 = velocityFn(xt, t, c);
  const midpoint: PointCloud = [];
  for (let i = 0; i < xt.length; i++) {
    midpoint.push({
      x: xt[i].x + 0.5 * dt * k1[i].x,
      y: xt[i].y + 0.5 * dt * k1[i].y,
      z: xt[i].z + 0.5 * dt * k1[i].z,
    });
  }
  const k2 = velocityFn(midpoint, t + 0.5 * dt, c);
  const result: PointCloud = [];
  for (let i = 0; i < xt.length; i++) {
    result.push({
      x: xt[i].x + dt * k2[i].x,
      y: xt[i].y + dt * k2[i].y,
      z: xt[i].z + dt * k2[i].z,
    });
  }
  return result;
}

export interface FlowMatching {
  config: FlowMatchingConfig;
  sampleTimestep: () => number[];
  samplePrior: (n: number) => PointCloud;
  computeVelocity: (x0: PointCloud, x1: PointCloud, t: number) => { xt: PointCloud; velocity: PointCloud };
  computeLoss: (predictedVel: PointCloud, x0: PointCloud, x1: PointCloud) => number;
  generate: (
    velocityFn: (xt: PointCloud, t: number, c: number[]) => PointCloud,
    c: number[],
    numPoints: number,
    steps?: number,
  ) => PointCloud;
}

export function createFlowMatching(cfg?: Partial<FlowMatchingConfig>): FlowMatching {
  const config = { ...DEFAULT_CONFIG, ...cfg };

  return {
    config,

    sampleTimestep(): number[] {
      return sampleTimestep(1, config);
    },

    samplePrior(n: number): PointCloud {
      return standardGaussian3D(n);
    },

    computeVelocity(x0: PointCloud, x1: PointCloud, t: number) {
      const xt = interpolatePointwise(x0, x1, t);
      const velocity = computeVelocity(xt, x1);
      return { xt, velocity };
    },

    computeLoss(predictedVel: PointCloud, x0: PointCloud, x1: PointCloud): number {
      const trueVel = computeVelocity(x0, x1);
      return mseLoss(predictedVel, trueVel);
    },

    generate(
      velocityFn: (xt: PointCloud, t: number, c: number[]) => PointCloud,
      c: number[],
      numPoints: number,
      steps = 100,
    ): PointCloud {
      const dt = 1 / steps;
      let xt = standardGaussian3D(numPoints);

      for (let i = 0; i < steps; i++) {
        const t = i * dt;
        xt = midpointODEStep(xt, t, dt, velocityFn, c);
      }

      return xt;
    },
  };
}
