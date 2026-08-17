/**
 * Ordinary Kriging — Best Linear Unbiased Predictor (Matheron 1963).
 *
 * ŷ(s₀) = Σλᵢ·z(sᵢ) with weights solving the augmented kriging system
 *   [γ(sᵢ,sⱼ)  1] [λ]   [γ(sᵢ,s₀)]
 *   [1ᵀ        0] [φ] = [1       ]
 * and kriging variance σ²_K = Σλᵢ·γ(sᵢ,s₀) + φ.
 *
 * Semivariogram models (isotropic, Cressie 1993 forms):
 *   spherical:  γ(h) = c₀ + c·(1.5·h/a − 0.5·(h/a)³)  for h ≤ a, c₀+c beyond
 *   exponential: γ(h) = c₀ + c·(1 − exp(−3h/a))         (practical range a)
 *   gaussian:   γ(h) = c₀ + c·(1 − exp(−3h²/a²))
 * where c₀ = nugget, c₀+c = sill, a = range.
 */

export interface KrigingObs {
  lat: number;
  lon: number;
  value: number;
}

export interface VariogramModel {
  nugget: number;
  sill: number;      // total sill c₀ + c (partial sill c = sill − nugget)
  range: number;     // km
  model: 'spherical' | 'exponential' | 'gaussian';
}

export interface KrigingResult {
  yhat: number;
  variance: number;          // σ²_K ≥ 0 (clamped: numerically ≥ −1e-10)
  weights: number[];         // λᵢ, Σλᵢ = 1 by construction
  phi: number;               // Lagrange multiplier
  fitted: VariogramModel;
  nObs: number;
}

/** Great-circle separation in km (haversine, R = 6371 km). */
export function pairDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const rd = (x: number) => (x * Math.PI) / 180;
  const p1 = rd(lat1), p2 = rd(lat2), dp = rd(lat2 - lat1), dl = rd(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function gammaAt(m: VariogramModel, hKm: number): number {
  if (hKm <= 0) return 0;
  const c = m.sill - m.nugget;
  const { nugget, range } = m;
  if (range <= 0) return m.sill;
  if (m.model === 'spherical') {
    if (hKm >= range) return m.sill;
    const hr = hKm / range;
    return nugget + c * (1.5 * hr - 0.5 * hr ** 3);
  }
  if (m.model === 'gaussian') {
    return nugget + c * (1 - Math.exp(-3 * (hKm / range) ** 2));
  }
  return nugget + c * (1 - Math.exp(-3 * hKm / range));
}

/**
 * Matheron (1963) experimental semivariogram:
 * γ̂(h) = (1/2·N(h))·Σ[z(sᵢ) − z(sᵢ+h)]² over pairs in the lag class.
 */
export function experimentalSemivariogram(
  obs: KrigingObs[], nBins = 10, maxLagKm?: number,
): { h: number[]; gamma: number[]; npairs: number[]; maxLag: number } {
  const maxD = maxLagKm ?? Math.max(1e-6, ...allPairDistances(obs)) * 0.6;
  const h: number[] = [], gam: number[] = [], np: number[] = [];
  for (let b = 0; b < nBins; b++) { h.push((b + 0.5) * maxD / nBins); gam.push(0); np.push(0); }
  for (let i = 0; i < obs.length; i++) {
    for (let j = i + 1; j < obs.length; j++) {
      const d = pairDistanceKm(obs[i].lat, obs[i].lon, obs[j].lat, obs[j].lon);
      if (d <= 0 || d > maxD) continue;
      const b = Math.min(nBins - 1, Math.floor(d / (maxD / nBins)));
      gam[b] += (obs[i].value - obs[j].value) ** 2;
      np[b] += 1;
    }
  }
  for (let b = 0; b < nBins; b++) gam[b] = np[b] > 0 ? gam[b] / (2 * np[b]) : NaN;
  return { h, gamma: gam, npairs: np, maxLag: maxD };
}

function allPairDistances(obs: KrigingObs[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < obs.length; i++) {
    for (let j = i + 1; j < obs.length; j++) {
      out.push(pairDistanceKm(obs[i].lat, obs[i].lon, obs[j].lat, obs[j].lon));
    }
  }
  return out;
}

/**
 * Weighted least-squares fit of a semivariogram model to the experimental
 * γ̂(h) (weights = pair counts). Grid search over (nugget, range) with the
 * sill initialised from the largest-lag experimental values.
 */
export function fitVariogram(obs: KrigingObs[], model: VariogramModel['model'] = 'spherical'): VariogramModel {
  const exp = experimentalSemivariogram(obs);
  const usable = exp.gamma.filter(Number.isFinite);
  const sillGuess = usable.length > 0
    ? usable.slice(Math.floor(usable.length / 2)).reduce((s, g) => s + g, 0) / Math.max(1, usable.length - Math.floor(usable.length / 2))
    : Math.max(...usable, 0) || 0;
  if (!(sillGuess > 0)) {
    return { nugget: 0, sill: 1e-12, range: exp.maxLag, model };
  }
  let best: VariogramModel = { nugget: 0, sill: sillGuess, range: exp.maxLag, model };
  let bestSSE = Infinity;
  for (const nugget of [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5].map((f) => f * sillGuess)) {
    for (let r = 1; r <= 40; r++) {
      const range = Math.max(1e-6, exp.maxLag * (r / 40));
      const cand: VariogramModel = { nugget, sill: sillGuess, range, model };
      let sse = 0;
      for (let b = 0; b < exp.gamma.length; b++) {
        if (!Number.isFinite(exp.gamma[b]) || exp.npairs[b] === 0) continue;
        sse += exp.npairs[b] * (exp.gamma[b] - gammaAt(cand, exp.h[b])) ** 2;
      }
      if (sse < bestSSE) { bestSSE = sse; best = cand; }
    }
  }
  return best;
}

/**
 * Solve the (N+1)×(N+1) ordinary-kriging system by Gaussian elimination
 * with partial pivoting. A is symmetric indefinite (the constraint row),
 * so direct elimination (not Cholesky) is used.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return [];
    if (piv !== col) [M[piv], M[col]] = [M[col], M[piv]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

/**
 * Ordinary kriging at target s₀ given observations and a variogram model.
 * Returns NaN fields when the system is singular / degenerate (fewer than
 * 2 distinct observations, zero-variance field with no nugget, or identical
 * coincident points).
 */
export function ordinaryKriging(
  obs: KrigingObs[],
  target: { lat: number; lon: number },
  model?: VariogramModel,
): KrigingResult | null {
  if (obs.length < 2) return null;
  const fitted = model ?? fitVariogram(obs);
  const n = obs.length;
  const A: number[][] = [];
  for (let i = 0; i < n + 1; i++) {
    const row = new Array(n + 1).fill(0);
    if (i < n) {
      for (let j = 0; j < n; j++) {
        row[j] = gammaAt(fitted, pairDistanceKm(obs[i].lat, obs[i].lon, obs[j].lat, obs[j].lon));
      }
      row[n] = 1;
    } else {
      for (let j = 0; j < n; j++) row[j] = 1;
    }
    A.push(row);
  }
  const b = [
    ...obs.map((o) => gammaAt(fitted, pairDistanceKm(o.lat, o.lon, target.lat, target.lon))),
    1,
  ];
  const sol = solveLinearSystem(A, b);
  if (sol.length === 0 || sol.some((v) => !Number.isFinite(v))) return null;
  const weights = sol.slice(0, n);
  const phi = sol[n];
  const yhat = weights.reduce((s, w, i) => s + w * obs[i].value, 0);
  const varianceRaw = weights.reduce((s, w, i) => s + w * b[i], 0) + phi;
  const variance = varianceRaw < 0 && varianceRaw > -1e-9 ? 0 : varianceRaw;
  if (!Number.isFinite(yhat) || !Number.isFinite(variance) || variance < 0) return null;
  return { yhat, variance, weights, phi, fitted, nObs: n };
}
