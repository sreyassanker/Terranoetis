/**
 * Analytical Models Engine
 * ── Professional equation implementation registry ──
 *
 * Each equation is implemented as a pure function taking a typed input map
 * and returning { result, unit, steps }. All physics constants use
 * SI units unless noted. Where an equation is a PDE / stability criterion
 * (no single scalar output), a representative scalar diagnostic is returned.
 */

export interface ComputeResult {
  result: number;
  unit?: string;
  steps: string[];
  secondary?: Array<{ key: string; value: number; unit?: string; label: string }>;
  /** Chart-series output: ordered x/y pairs for rendering the tool's
   *  visualization type (timeseries, profile, spectrum, scatter, etc.).
   *  Each series has a label and an array of points. */
  series?: Array<{ label: string; points: Array<{ x: number; y: number }>; color?: string; xLabel?: string; logX?: boolean }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ComputeFn = (x: Record<string, any>) => ComputeResult;

export const SIGMA = 5.670374419e-8; // Stefan-Boltzmann constant (W m^-2 K^-4)
export const H_PLANCK = 6.62607015e-34; // J·s
export const C_LIGHT = 299792458; // m/s
export const K_BOLTZMANN = 1.380649e-23; // J/K
export const EPS0 = 8.8541878128e-12;    // F/m — vacuum permittivity (CODATA 2018, exact)
export const G_GRAV = 9.80665; // m/s^2
export const R_SPEC = 287.058; // J/(kg·K) specific gas constant for dry air
// Shore Protection Manual (1984) Vol 1, Table 4-8 — "commonly assumed values"
// for the immersed-weight/volumetric conversion, eq (4-35):
export const RHO_SW = 1025;   // kg/m³ — saltwater density
export const RHO_SAND = 2650; // kg/m³ — quartz sand grain density
export const SAND_POROSITY = 0.4; // n — void ratio of the sand matrix (1−n = 0.6)
export const _OMEGA = 7.292115e-5; // Earth rotation rate (rad/s)
export const PI = Math.PI;

// ── Wanninkhof (1992) air–sea CO₂ flux — paper-exact coefficients ──
// Table A1: Schmidt number of CO₂ in seawater (35‰), Sc = A − Bt + Ct² − Dt³
// (t in °C, valid 0–30 °C). A=2073.1, B=125.62, C=3.6276, D=0.043219;
// Sc = 660 at 20 °C (the paper's normalization).
export function schmidtNumberCO2(tC: number): number {
  return 2073.1 - 125.62 * tC + 3.6276 * tC * tC - 0.043219 * tC * tC * tC;
}
// Table A2: CO₂ Bunsen solubility β (mol/L·atm), Weiss (1974) form
// ln β = A1 + A2·(100/T) + A3·ln(T/100) + S·[B1 + B2·(T/100) + B3·(T/100)²]
// (T in K, S in ‰). A1=−60.2409, A2=93.4517, A3=23.3585,
// B1=0.023517, B2=−0.023656, B3=0.0047036. β(20 °C, 35‰) = 0.0324 mol/L·atm
// — matches the value the paper states in the text exactly.
export function weissSolubilityCO2(tC: number, sss: number): number {
  const T = tC + 273.15;
  const lnB = -60.2409 + 93.4517 * (100 / T) + 23.3585 * Math.log(T / 100)
    + sss * (0.023517 - 0.023656 * (T / 100) + 0.0047036 * Math.pow(T / 100, 2));
  return Math.exp(lnB);
}
// Eq. 3: gas transfer velocity k = 0.31·u₁₀²·(Sc/660)^(−1/2) (cm/hr), for
// steady/short-term winds (spot measurements, scatterometer winds).
export function wanninkhofK1992(u10: number, sc: number): number {
  return 0.31 * u10 * u10 * Math.pow(sc / 660, -0.5);
}

// ── TEOS-10 seawater specific volume (Tool 70) ──────────────────────
// The 75-term polynomial for specific volume in terms of Absolute
// Salinity S_A (g/kg), Conservative Temperature Θ (ITS-90 °C) and sea
// pressure p (dbar) — Roquet, Madec, McDougall & Barker (2015), Ocean
// Modelling 90:29–43, table of coefficients reproduced in the TEOS-10
// Manual (IOC/SCOR/IAPSO 2010, §A.30 / Table K.1). This is the exact
// computational form used by the GSW library's gsw_specvol(). Structural
// variables: xs = sqrt(sfac·S_A + 24·sfac), ys = Θ/40, z = p/10⁴.
export const TEOS10_SFAC = 0.0248826675584615; // 1/(40·(35.16504/35))
// [i, j, k, c] for term c·xs^i·ys^j·z^k
export const TEOS10_V: ReadonlyArray<readonly [number, number, number, number]> = [
  [0,0,0,1.0769995862e-3],[1,0,0,-3.1038981976e-4],[2,0,0,6.6928067038e-4],[3,0,0,-8.5047933937e-4],
  [4,0,0,5.8086069943e-4],[5,0,0,-2.1092370507e-4],[6,0,0,3.1932457305e-5],
  [0,1,0,-1.5649734675e-5],[1,1,0,3.5009599764e-5],[2,1,0,-4.3592678561e-5],[3,1,0,3.4532461828e-5],
  [4,1,0,-1.1959409788e-5],[5,1,0,1.3864594581e-6],
  [0,2,0,2.7762106484e-5],[1,2,0,-3.7435842344e-5],[2,2,0,3.5907822760e-5],[3,2,0,-1.8698584187e-5],
  [4,2,0,3.8595339244e-6],
  [0,3,0,-1.6521159259e-5],[1,3,0,2.4141479483e-5],[2,3,0,-1.4353633048e-5],[3,3,0,2.2863324556e-6],
  [0,4,0,6.9111322702e-6],[1,4,0,-8.7595873154e-6],[2,4,0,4.3703680598e-6],
  [0,5,0,-8.0539615540e-7],[1,5,0,-3.3052758900e-7],[0,6,0,2.0543094268e-7],
  [0,0,1,-6.0799143809e-5],[1,0,1,2.4262468747e-5],[2,0,1,-3.4792460974e-5],[3,0,1,3.7470777305e-5],
  [4,0,1,-1.7322218612e-5],[5,0,1,3.0927427253e-6],
  [0,1,1,1.8505765429e-5],[1,1,1,-9.5677088156e-6],[2,1,1,1.1100834765e-5],[3,1,1,-9.8447117844e-6],
  [4,1,1,2.5909225260e-6],
  [0,2,1,-1.1716606853e-5],[1,2,1,-2.3678308361e-7],[2,2,1,2.9283346295e-6],[3,2,1,-4.8826139200e-7],
  [0,3,1,7.9279656173e-6],[1,3,1,-3.4558773655e-6],[2,3,1,3.1655306078e-7],
  [0,4,1,-3.4102187482e-6],[1,4,1,1.2956717783e-6],[0,5,1,5.0736766814e-7],
  [0,0,2,9.9856169219e-6],[1,0,2,-5.8484432984e-7],[2,0,2,-4.8122251597e-6],[3,0,2,4.9263106998e-6],
  [4,0,2,-1.7811974727e-6],
  [0,1,2,-1.1736386731e-6],[1,1,2,-5.5699154557e-6],[2,1,2,5.4620748834e-6],[3,1,2,-1.3544185627e-6],
  [0,2,2,2.1305028740e-6],[1,2,2,3.9137387080e-7],[2,2,2,-6.5731104067e-7],
  [0,3,2,-4.6132540037e-7],[1,3,2,7.7618888092e-9],[0,4,2,-6.3352916514e-8],
  [0,0,3,-1.1309361437e-6],[1,0,3,3.6310188515e-7],[2,0,3,1.6746303780e-8],
  [0,1,3,-3.6527006553e-7],[1,1,3,-2.7295696237e-7],[0,2,3,2.8695905159e-7],
  [0,0,4,1.0531153080e-7],[1,0,4,-1.1147125423e-7],[0,1,4,3.1454099902e-7],
  [0,0,5,-1.2647261286e-8],[0,0,6,1.9613503930e-9],
];

/**
 * TEOS-10 specific volume (m³/kg) from Absolute Salinity (g/kg),
 * Conservative Temperature (°C) and sea pressure (dbar) — the
 * 75-term Roquet et al. (2015) polynomial, identical to gsw_specvol.
 * Returns NaN for any non-finite or out-of-range input (S_A < 0, CT < -18
 * or CT > 40 °C, p < 0 dbar), per the honest-NaN convention.
 */
export function teos10SpecVol(SA: number, CT: number, p: number): number {
  if (!Number.isFinite(SA) || !Number.isFinite(CT) || !Number.isFinite(p)) return Number.NaN;
  if (SA < 0 || CT < -18 || CT > 40 || p < 0) return Number.NaN;
  const xs = Math.sqrt(TEOS10_SFAC * SA + 24 * TEOS10_SFAC);
  const ys = CT * 0.025;
  const z = p * 1e-4;
  let v = 0;
  for (const [i, j, k, c] of TEOS10_V) v += c * Math.pow(xs, i) * Math.pow(ys, j) * Math.pow(z, k);
  return v;
}

/**
 * TEOS-10 sound speed c (m/s) from the polynomial specific volume:
 * c² = −v²/(∂v/∂p)|_{S_A,Θ}, with the dbar→Pa conversion (1 dbar = 10⁴ Pa).
 */
export function teos10SoundSpeed(SA: number, CT: number, p: number): number {
  const v = teos10SpecVol(SA, CT, p);
  if (!Number.isFinite(v)) return Number.NaN;
  const xs = Math.sqrt(TEOS10_SFAC * SA + 24 * TEOS10_SFAC);
  const ys = CT * 0.025;
  const z = p * 1e-4;
  let dv = 0; // ∂v/∂p in m³/(kg·dbar)
  for (const [i, j, k, c] of TEOS10_V) {
    if (k > 0) dv += k * c * Math.pow(xs, i) * Math.pow(ys, j) * Math.pow(z, k - 1) * 1e-4;
  }
  if (dv >= 0 || !Number.isFinite(dv)) return Number.NaN;
  return Math.sqrt((-v * v) / dv * 1e4); // 1 dbar = 10⁴ Pa
}

// ── Growing Degree Days (Tool 58) — McMaster & Wilhelm (1997) ──────
// "One equation, two interpretations" (paper Eq. 1: GDD = [(TMAX+TMIN)/2] −
// TBASE). The two interpretations differ ONLY in when TBASE / TUT is
// applied (paper §2):
//   Method 1 — clamp the daily MEAN: TAVG = max(min(TAVG, TUT), TBASE);
//              GDD₁ = max(0, TAVG − TBASE).  Predominates for small-grain
//              cereals and in simulation models (paper §2.1).
//   Method 2 — clamp each EXTREME: TMAX/TMIN each bounded to [TBASE, TUT];
//              GDD₂ = max(0, (TMAX+TMIN)/2 − TBASE).  Most common for corn
//              (paper §2.2).
// The methods agree only when TMIN ≥ TBASE; whenever TMIN < TBASE, Method 2
// exceeds Method 1 (paper Table 1: 10-day wheat example at TBASE = 0 °C
// sums to 46.5 vs 51.0 °C·day; field data show up to 83 % for wheat and
// 376 % for corn). Both are returned so a tool can report both sums and
// the difference, as the paper demands.
export function gddMethods(
  tmaxC: number, tminC: number, tbaseC: number, tutC?: number | null,
): { m1: number; m2: number } {
  const tut = (tutC != null && Number.isFinite(tutC)) ? tutC : Number.NaN;
  const tavg = (tmaxC + tminC) / 2;
  // Method 1: clamp the mean
  let m1avg = tavg;
  if (m1avg < tbaseC) m1avg = tbaseC;
  if (Number.isFinite(tut) && m1avg > tut) m1avg = tut;
  const m1 = Math.max(0, m1avg - tbaseC);
  // Method 2: clamp each extreme
  let m2max = tmaxC, m2min = tminC;
  if (m2max < tbaseC) m2max = tbaseC;
  if (m2min < tbaseC) m2min = tbaseC;
  if (Number.isFinite(tut)) {
    if (m2max > tut) m2max = tut;
    if (m2min > tut) m2min = tut;
  }
  const m2 = Math.max(0, (m2max + m2min) / 2 - tbaseC);
  return { m1, m2 };
}

// FAO IDP 33 / IDP 66 Eq. (1): (1 − Yₐ/Yₘ) = K_y × (1 − ETₐ/ETₘ)
// Returns the predicted relative yield reduction (primary) and, when Yₘ is
// finite, the predicted actual yield. Observed Yₐ is an optional diagnostic.
export function faoYieldResponse(
  ya: number, ym: number, ky: number, eta: number, etm: number,
): { relReduction: number; predictedYa: number; residual: number | null } {
  const relETDeficit = 1 - eta / etm;
  const relReduction = ky * relETDeficit;
  const predictedYa = ym * (1 - relReduction);
  const hasObserved = Number.isFinite(ya) && ya > 0;
  const residual = hasObserved ? (1 - ya / ym) - relReduction : null;
  return { relReduction, predictedYa, residual };
}

// ── Geodesy: 3×3 elementary rotation matrices ───────────────────────
// Used by Tool 111 (IERS CIO-based Earth rotation) and Tool 114 (Helmert
// 7-parameter transformation). Each elementary matrix is orthonormal with
// determinant +1; products of rotation matrices are rotation matrices.
export type Mat3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

/** R₁(θ) — rotation about the x-axis. */
export function rot1(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[1, 0, 0], [0, c, s], [0, -s, c]];
}
/** R₂(θ) — rotation about the y-axis. */
export function rot2(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, 0, -s], [0, 1, 0], [s, 0, c]];
}
/** R₃(θ) — rotation about the z-axis. */
export function rot3(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, s, 0], [-s, c, 0], [0, 0, 1]];
}
export function mat3Mul(A: Mat3, B: Mat3): Mat3 {
  const out: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    }
  }
  return out;
}
export function mat3Det(A: Mat3): number {
  return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
       - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
       + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
}
export function mat3Trace(A: Mat3): number {
  return A[0][0] + A[1][1] + A[2][2];
}
export function mat3Vec(A: Mat3, v: [number, number, number]): [number, number, number] {
  return [
    A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2],
    A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2],
    A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2],
  ];
}

export const ARCSEC2RAD = Math.PI / (180 * 3600); // 1″ in radians
export const RAD2ARCSEC = 180 * 3600 / Math.PI;   // 1 rad in arcseconds


// Re-export data-module symbols that equation parts reference (kept here so
// engine.ts and every part file share one import surface).
export { cb2014Terms } from '../data/campbellBozorgnia2014';
export { ordinaryKriging, pairDistanceKm, type VariogramModel } from '../data/kriging';
export { inverseDistanceWeighting } from '../data/idw';

/** n! — exact for integers (used by Lanczos gamma below). */
export function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/** Lanczos approximation of the Gamma function (g=7, 6 terms). Accurate to
 *  ~2×10⁻¹⁰ for non-integer arguments. For integer n, Γ(n) = (n−1)! */
export function gamma(z: number): number {
  if (Number.isInteger(z) && z >= 1) return factorial(z - 1);
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const g = 7;
  const p = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  const zp = z - 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) x += p[i] / (zp + i);
  const t = zp + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, zp + 0.5) * Math.exp(-t) * x;
}
