import { type PointWithContext } from './knnContext';
import { type PointCloud } from './flowMatching';

export interface LatentTransformerConfig {
  latentDim: number;
  numLatentTokens: number;
  numHeads: number;
  numLayers: number;
  hiddenDim: number;
}

interface AttentionHead {
  wQ: number[][];
  wK: number[][];
  wV: number[][];
  wO: number[][];
}

interface FFLayer {
  w1: number[][];
  b1: number[];
  w2: number[][];
  b2: number[];
}

interface TransformerLayer {
  selfAttn: AttentionHead;
  crossAttn: AttentionHead;
  ff: FFLayer;
  norm1: number[];
  norm2: number[];
  norm3: number[];
}

interface TimestepEmbedding {
  w: number[];
  b: number[];
}

export interface LatentTransformerState {
  config: LatentTransformerConfig;
  latentTokens: number[][];
  layers: TransformerLayer[];
  timestepEmbed: TimestepEmbedding;
  inputProj: { w: number[][]; b: number[] };
  outputProj: { w: number[][]; b: number[] };
  condProj: { w: number[][]; b: number[] };
}

const DEFAULT_CONFIG: LatentTransformerConfig = {
  latentDim: 128,
  numLatentTokens: 512,
  numHeads: 4,
  numLayers: 6,
  hiddenDim: 256,
};

function scaledDotProductAttention(q: number[][], k: number[][], v: number[][]): number[][] {
  const dk = q[0]?.length || 1;
  const scale = 1 / Math.sqrt(dk);
  const scores = matMul(q, transpose(k));
  for (const row of scores) {
    for (let j = 0; j < row.length; j++) {
      row[j] *= scale;
    }
  }
  const weights = softmax2D(scores);
  return matMul(weights, v);
}

function multiHeadAttention(
  x: number[][],
  context: number[][],
  head: AttentionHead,
  numHeads: number,
): number[][] {
  const d = (x[0]?.length || 1) / numHeads;
  const batch = x.length;
  const q = matMul(x, head.wQ);
  const k = matMul(context, head.wK);
  const v = matMul(context, head.wV);

  const headsOut: number[][] = [];
  for (let h = 0; h < numHeads; h++) {
    const start = Math.floor(h * d);
    const end = Math.floor((h + 1) * d);
    const qh = q.map(row => row.slice(start, end));
    const kh = k.map(row => row.slice(start, end));
    const vh = v.map(row => row.slice(start, end));
    const attnOut = scaledDotProductAttention(qh, kh, vh);
    headsOut.push(...attnOut);
  }

  const concat: number[][] = [];
  for (let i = 0; i < batch; i++) {
    const row: number[] = [];
    for (let h = 0; h < numHeads; h++) {
      row.push(...(headsOut[h * batch + i] || []));
    }
    concat.push(row);
  }

  return matMul(concat, head.wO);
}

function feedForward(x: number[][], ff: FFLayer): number[][] {
  const h = addBias2D(matMul(x, ff.w1), ff.b1);
  const activated = h.map(row => row.map(v => Math.max(0, v)));
  return addBias2D(matMul(activated, ff.w2), ff.b2);
}

function layerNorm(x: number[][], gamma: number[]): number[][] {
  return x.map(row => {
    const mean = row.reduce((s, v) => s + v, 0) / row.length;
    const var_ = row.reduce((s, v) => s + (v - mean) ** 2, 0) / row.length;
    const std = Math.sqrt(var_ + 1e-6);
    return row.map((v, i) => ((v - mean) / std) * (gamma[i] || 1));
  });
}

function transformerBlock(
  x: number[][],
  latent: number[][],
  t: number[],
  layer: TransformerLayer,
  numHeads: number,
): { x: number[][]; latent: number[][] } {
  const tEmb = latent.map(() => t);
  const latentNorm = layerNorm(latent, layer.norm1);
  const latentT = addMat(latentNorm, tEmb);
  const attnOut = multiHeadAttention(latentT, latentT, layer.selfAttn, numHeads);
  const latent2 = addMat(latent, attnOut);

  const latentNorm2 = layerNorm(latent2, layer.norm2);
  const crossOut = multiHeadAttention(x, latentNorm2, layer.crossAttn, numHeads);
  const x2 = addMat(x, crossOut);

  const xNorm = layerNorm(x2, layer.norm3);
  const ffOut = feedForward(xNorm, layer.ff);
  const x3 = addMat(x2, ffOut);

  return { x: x3, latent: latent2 };
}

function timestepEmbed(t: number, embed: TimestepEmbedding): number[] {
  return embed.w.map((w, i) => Math.sin(w * t + (embed.b[i] || 0)));
}

function addMat(a: number[][], b: number[][]): number[][] {
  return a.map((row, i) => row.map((v, j) => v + (b[i]?.[j] || 0)));
}

function addBias2D(m: number[][], b: number[]): number[][] {
  return m.map(row => row.map((v, j) => v + (b[j] || 0)));
}

function mulMat(a: number[][], b: number[][]): number[][] {
  const result: number[][] = [];
  for (let i = 0; i < a.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < (b[0]?.length || 0); j++) {
      let sum = 0;
      for (let k = 0; k < (a[0]?.length || 0); k++) {
        sum += a[i][k] * (b[k]?.[j] || 0);
      }
      row.push(sum);
    }
    result.push(row);
  }
  return result;
}

function matMul(a: number[][], b: number[][]): number[][] {
  return mulMat(a, b);
}

function transpose(m: number[][]): number[][] {
  if (m.length === 0) return [];
  const cols = m[0]?.length || 0;
  const result: number[][] = [];
  for (let j = 0; j < cols; j++) {
    const row: number[] = [];
    for (let i = 0; i < m.length; i++) {
      row.push(m[i][j]);
    }
    result.push(row);
  }
  return result;
}

function softmax2D(m: number[][]): number[][] {
  return m.map(row => {
    const maxVal = Math.max(...row);
    const exp = row.map(v => Math.exp(v - maxVal));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(v => v / sum);
  });
}

function randMat(rows: number, cols: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      row.push((Math.random() - 0.5) * 0.02);
    }
    m.push(row);
  }
  return m;
}

function randVec(n: number): number[] {
  return Array.from({ length: n }, () => (Math.random() - 0.5) * 0.02);
}

function randLatentTokens(num: number, dim: number): number[][] {
  const tokens: number[][] = [];
  for (let i = 0; i < num; i++) {
    const row: number[] = [];
    for (let j = 0; j < dim; j++) {
      row.push((Math.random() - 0.5) * 0.1);
    }
    tokens.push(row);
  }
  return tokens;
}

function createAttentionHead(dim: number, headDim: number): AttentionHead {
  return {
    wQ: randMat(dim, headDim),
    wK: randMat(dim, headDim),
    wV: randMat(dim, headDim),
    wO: randMat(headDim, dim),
  };
}

function createFFLayer(dim: number, hiddenDim: number): FFLayer {
  return {
    w1: randMat(dim, hiddenDim),
    b1: randVec(hiddenDim),
    w2: randMat(hiddenDim, dim),
    b2: randVec(dim),
  };
}

export class LatentTransformer {
  state: LatentTransformerState;

  constructor(cfg?: Partial<LatentTransformerConfig>) {
    const config = { ...DEFAULT_CONFIG, ...cfg };
    const headDim = config.latentDim;

    this.state = {
      config,
      latentTokens: randLatentTokens(config.numLatentTokens, config.latentDim),
      layers: Array.from({ length: config.numLayers }, () => ({
        selfAttn: createAttentionHead(config.latentDim, headDim),
        crossAttn: createAttentionHead(config.latentDim, headDim),
        ff: createFFLayer(config.latentDim, config.hiddenDim),
        norm1: randVec(config.latentDim).map(() => 1),
        norm2: randVec(config.latentDim).map(() => 1),
        norm3: randVec(config.latentDim).map(() => 1),
      })),
      timestepEmbed: { w: randVec(config.latentDim), b: randVec(config.latentDim) },
      inputProj: { w: randMat(config.latentDim, config.latentDim), b: randVec(config.latentDim) },
      outputProj: { w: randMat(config.latentDim, config.latentDim), b: randVec(config.latentDim) },
      condProj: { w: randMat(config.latentDim, config.latentDim), b: randVec(config.latentDim) },
    };
  }

  forward(
    points: PointWithContext[],
    t: number,
    conditioning: number[],
  ): PointCloud {
    const cfg = this.state.config;
    const featureDim = 3 + (points[0]?.context.length || 0);

    const projIn = randMat(featureDim, cfg.latentDim);
    const pointTokens = points.map(p => {
      const raw = [p.point.x, p.point.y, p.point.z, ...p.context];
      return addBias(mulMatVec(raw, projIn), this.state.inputProj.b);
    });

    const tEmb = timestepEmbed(t, this.state.timestepEmbed);
    const condEmb = addBias(mulMatVec(conditioning, this.state.condProj.w), this.state.condProj.b);

    let latent = this.state.latentTokens.map(row => [
      ...row.map((v, j) => v + (tEmb[j] || 0) + (condEmb[j] || 0)),
    ]);

    let x = pointTokens;

    for (const layer of this.state.layers) {
      const result = transformerBlock(x, latent, tEmb, layer, cfg.numHeads);
      x = result.x;
      latent = result.latent;
    }

    const out = addBias2D(matMul(x, this.state.outputProj.w), this.state.outputProj.b);
    return out.map(row => ({ x: row[0] || 0, y: row[1] || 0, z: row[2] || 0 }));
  }

  getParams(): LatentTransformerState {
    return this.state;
  }

  setParams(state: LatentTransformerState): void {
    this.state = state;
  }
}

function mulMatVec(v: number[], m: number[][]): number[] {
  const result: number[] = [];
  for (let j = 0; j < (m[0]?.length || 0); j++) {
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
