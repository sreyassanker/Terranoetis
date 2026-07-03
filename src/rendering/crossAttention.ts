export interface AttentionHead {
  query: Float32Array;
  key: Float32Array;
  value: Float32Array;
}

export interface FusedResult {
  risk: Float32Array;
  attention_weights: Float32Array;
  width: number;
  height: number;
}

function softmax(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  let max = -Infinity;
  for (let i = 0; i < x.length; i++) if (x[i] > max) max = x[i];
  let sum = 0;
  for (let i = 0; i < x.length; i++) { out[i] = Math.exp(x[i] - max); sum += out[i]; }
  for (let i = 0; i < x.length; i++) out[i] /= sum;
  return out;
}

function layerNorm(x: Float32Array): Float32Array {
  let mean = 0, varSum = 0;
  for (let i = 0; i < x.length; i++) mean += x[i];
  mean /= x.length;
  for (let i = 0; i < x.length; i++) varSum += (x[i] - mean) ** 2;
  const std = Math.sqrt(varSum / x.length + 1e-8);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = (x[i] - mean) / std;
  return out;
}

function feedForward(x: Float32Array, w1: Float32Array, w2: Float32Array): Float32Array {
  const hidden = new Float32Array(w1.length);
  for (let i = 0; i < w1.length; i++) hidden[i] = Math.max(0, x[i % x.length] * w1[i]);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let j = 0; j < w2.length; j++) s += hidden[j] * w2[j * x.length + i];
    out[i] = s;
  }
  return out;
}

export function fuseModalities(
  grids: Float32Array[],
  width: number,
  height: number,
  weights: { query: Float32Array; key: Float32Array; value: Float32Array; ffw1: Float32Array; ffw2: Float32Array }[] = [],
): FusedResult {
  const nModalities = grids.length;
  const nCells = width * height;
  const dModel = 32;

  if (weights.length === 0) {
    for (let l = 0; l < 2; l++) {
      const wq = new Float32Array(dModel * nModalities);
      const wk = new Float32Array(dModel * nModalities);
      const wv = new Float32Array(dModel * nModalities);
      for (let i = 0; i < dModel * nModalities; i++) {
        wq[i] = (Math.random() - 0.5) * 0.1;
        wk[i] = (Math.random() - 0.5) * 0.1;
        wv[i] = (Math.random() - 0.5) * 0.1;
      }
      const ffw1 = new Float32Array(dModel * dModel);
      const ffw2 = new Float32Array(dModel * dModel);
      for (let i = 0; i < dModel * dModel; i++) {
        ffw1[i] = (Math.random() - 0.5) * 0.1;
        ffw2[i] = (Math.random() - 0.5) * 0.1;
      }
      weights.push({ query: wq, key: wk, value: wv, ffw1, ffw2 });
    }
  }

  const embeddings: Float32Array[] = grids.map(g => {
    const emb = new Float32Array(dModel);
    let sum = 0;
    for (let i = 0; i < g.length; i++) sum += g[i];
    const mean = sum / g.length;
    for (let i = 0; i < dModel; i++) emb[i] = mean + (Math.random() - 0.5) * 0.01;
    return emb;
  });

  let tokens: Float32Array[] = embeddings.map(e => new Float32Array(e));

  for (let layer = 0; layer < 2; layer++) {
    const w = weights[layer];
    const qs = tokens.map(t => {
      const q = new Float32Array(dModel);
      for (let i = 0; i < dModel; i++) { let s = 0; for (let j = 0; j < nModalities; j++) s += t[j] * w.query[i * nModalities + j]; q[i] = s; }
      return q;
    });
    const ks = tokens.map(t => {
      const k = new Float32Array(dModel);
      for (let i = 0; i < dModel; i++) { let s = 0; for (let j = 0; j < nModalities; j++) s += t[j] * w.key[i * nModalities + j]; k[i] = s; }
      return k;
    });
    const vs = tokens.map(t => {
      const v = new Float32Array(dModel);
      for (let i = 0; i < dModel; i++) { let s = 0; for (let j = 0; j < nModalities; j++) s += t[j] * w.value[i * nModalities + j]; v[i] = s; }
      return v;
    });

    const attnScores = new Float32Array(nModalities * nModalities);
    for (let i = 0; i < nModalities; i++) {
      for (let j = 0; j < nModalities; j++) {
        let s = 0;
        for (let d = 0; d < dModel; d++) s += qs[i][d] * ks[j][d];
        attnScores[i * nModalities + j] = s / Math.sqrt(dModel);
      }
    }

    const newTokens: Float32Array[] = [];
    for (let i = 0; i < nModalities; i++) {
      const row = attnScores.subarray(i * nModalities, (i + 1) * nModalities);
      const attnW = softmax(row);
      const out = new Float32Array(dModel);
      for (let j = 0; j < nModalities; j++) {
        for (let d = 0; d < dModel; d++) out[d] += attnW[j] * vs[j][d];
      }
      const ln1 = layerNorm(out);
      const ff = feedForward(ln1, w.ffw1, w.ffw2);
      const residual = new Float32Array(dModel);
      for (let d = 0; d < dModel; d++) residual[d] = ln1[d] + ff[d];
      newTokens.push(layerNorm(residual));
    }
    tokens = newTokens as Float32Array[];
  }

  const fused = new Float32Array(nCells);
  const attnWeights = new Float32Array(nCells);

  for (let cell = 0; cell < nCells; cell++) {
    const values = grids.map(g => g[cell]);
    let weighted = 0;
    let wSum = 0;

    for (let m = 0; m < nModalities; m++) {
      const contrib = tokens[m][0] ?? 0;
      const weight = 1 / (1 + Math.exp(-contrib));
      weighted += weight * (values[m] ?? 0);
      wSum += weight;
      attnWeights[cell] += weight;
    }
    fused[cell] = wSum > 0 ? weighted / wSum : 0;
    attnWeights[cell] /= nModalities;
  }

  return { risk: fused, attention_weights: attnWeights, width, height };
}
