export type HazardType = 'seismic' | 'weather' | 'fire' | 'flood' | 'volcanic';

const HAZARD_MAP: Record<HazardType, number> = {
  seismic: 0,
  weather: 1,
  fire: 2,
  flood: 3,
  volcanic: 4,
};

export interface ConditioningVector {
  lat: number;
  lon: number;
  elevation: number;
  time: number;
  intensity: number;
  magnitude: number;
  severity: number;
  hazardType: HazardType;
  spreadX: number;
  spreadY: number;
  spreadZ: number;
  mask: number;
}

export function conditioningToArray(c: ConditioningVector): number[] {
  return [
    c.lat,
    c.lon,
    c.elevation,
    c.time,
    c.intensity,
    c.magnitude,
    c.severity,
    HAZARD_MAP[c.hazardType] / 4,
    c.spreadX,
    c.spreadY,
    c.spreadZ,
    c.mask,
  ];
}

export function arrayToConditioning(arr: number[]): ConditioningVector {
  const hazardIdx = Math.round(arr[7] * 4);
  const hazardMap: Record<number, HazardType> = { 0: 'seismic', 1: 'weather', 2: 'fire', 3: 'flood', 4: 'volcanic' };
  return {
    lat: arr[0],
    lon: arr[1],
    elevation: arr[2],
    time: arr[3],
    intensity: arr[4],
    magnitude: arr[5],
    severity: arr[6],
    hazardType: hazardMap[hazardIdx] || 'seismic',
    spreadX: arr[8],
    spreadY: arr[9],
    spreadZ: arr[10],
    mask: arr[11],
  };
}

export class ConditionProjector {
  private inputDim = 12;
  private hiddenDim: number;
  private outputDim: number;

  private w1: number[][];
  private b1: number[];
  private w2: number[][];
  private b2: number[];

  constructor(hiddenDim = 64, outputDim = 128) {
    this.hiddenDim = hiddenDim;
    this.outputDim = outputDim;
    this.w1 = randMat(this.inputDim, hiddenDim);
    this.b1 = randVec(hiddenDim);
    this.w2 = randMat(hiddenDim, outputDim);
    this.b2 = randVec(outputDim);
  }

  forward(c: ConditioningVector): number[] {
    const x = conditioningToArray(c);
    const h = relu(addBias(mulMatVec(x, this.w1), this.b1));
    return addBias(mulMatVec(h, this.w2), this.b2);
  }

  /** Collect all trainable weights into a flat vector */
  collectWeights(): number[] {
    const weights: number[] = [];
    for (const row of this.w1) for (const v of row) weights.push(v);
    for (const v of this.b1) weights.push(v);
    for (const row of this.w2) for (const v of row) weights.push(v);
    for (const v of this.b2) weights.push(v);
    return weights;
  }

  /** Restore weights from a flat vector */
  restoreWeights(flat: number[]): void {
    let idx = 0;
    for (let i = 0; i < this.w1.length; i++)
      for (let j = 0; j < this.w1[i].length; j++)
        this.w1[i][j] = flat[idx++];
    for (let i = 0; i < this.b1.length; i++)
      this.b1[i] = flat[idx++];
    for (let i = 0; i < this.w2.length; i++)
      for (let j = 0; j < this.w2[i].length; j++)
        this.w2[i][j] = flat[idx++];
    for (let i = 0; i < this.b2.length; i++)
      this.b2[i] = flat[idx++];
  }

  /** Generate a random perturbation direction */
  sampleRandomDirection(size: number): number[] {
    const dir: number[] = [];
    for (let i = 0; i < size; i++) {
      dir.push(Math.random() < 0.5 ? 1 : -1);
    }
    return dir;
  }

  /** Apply a scaled direction to all weights: w += scale * direction */
  applyDirection(scale: number, direction: number[]): void {
    const weights = this.collectWeights();
    for (let i = 0; i < weights.length; i++) {
      weights[i] += scale * direction[i];
    }
    this.restoreWeights(weights);
  }

  getParams(): { w1: number[][]; b1: number[]; w2: number[][]; b2: number[] } {
    return { w1: this.w1, b1: this.b1, w2: this.w2, b2: this.b2 };
  }

  setParams(params: { w1: number[][]; b1: number[]; w2: number[][]; b2: number[] }): void {
    this.w1 = params.w1;
    this.b1 = params.b1;
    this.w2 = params.w2;
    this.b2 = params.b2;
  }
}

function randMat(rows: number, cols: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < rows; i++) {
    m.push(randVec(cols));
  }
  return m;
}

function randVec(n: number): number[] {
  const v: number[] = [];
  for (let i = 0; i < n; i++) {
    v.push((Math.random() - 0.5) * 0.1);
  }
  return v;
}

function mulMatVec(v: number[], m: number[][]): number[] {
  const result: number[] = [];
  for (let j = 0; j < m[0].length; j++) {
    let sum = 0;
    for (let i = 0; i < v.length; i++) {
      sum += v[i] * (m[i]?.[j] || 0);
    }
    result.push(sum);
  }
  return result;
}

function addBias(v: number[], b: number[]): number[] {
  return v.map((x, i) => x + (b[i] || 0));
}

function relu(v: number[]): number[] {
  return v.map(x => Math.max(0, x));
}
