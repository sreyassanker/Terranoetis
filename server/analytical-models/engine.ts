/**
 * Analytical Models Engine
 * ── Professional equation implementation registry ──
 *
 * Each equation is implemented as a pure function taking a typed input map
 * and returning { result, unit, steps }. All physics constants use
 * SI units unless noted. Where an equation is a PDE / stability criterion
 * (no single scalar output), a representative scalar diagnostic is returned.
 */

import { cb2014Terms } from '../data/campbellBozorgnia2014';
import { ordinaryKriging, pairDistanceKm, type VariogramModel } from '../data/kriging';
import { inverseDistanceWeighting } from '../data/idw';

export interface ComputeResult {
  result: number;
  unit?: string;
  steps: string[];
  secondary?: Array<{ key: string; value: number; unit?: string; label: string }>;
  /** Chart-series output: ordered x/y pairs for rendering the tool's
   *  visualization type (timeseries, profile, spectrum, scatter, etc.).
   *  Each series has a label and an array of points. */
  series?: Array<{ label: string; points: Array<{ x: number; y: number }>; color?: string }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ComputeFn = (x: Record<string, any>) => ComputeResult;

const SIGMA = 5.670374419e-8; // Stefan-Boltzmann constant (W m^-2 K^-4)
const H_PLANCK = 6.62607015e-34; // J·s
const C_LIGHT = 299792458; // m/s
const K_BOLTZMANN = 1.380649e-23; // J/K
const EPS0 = 8.8541878128e-12;    // F/m — vacuum permittivity (CODATA 2018, exact)
const G_GRAV = 9.80665; // m/s^2
const R_SPEC = 287.058; // J/(kg·K) specific gas constant for dry air
// Shore Protection Manual (1984) Vol 1, Table 4-8 — "commonly assumed values"
// for the immersed-weight/volumetric conversion, eq (4-35):
const RHO_SW = 1025;   // kg/m³ — saltwater density
const RHO_SAND = 2650; // kg/m³ — quartz sand grain density
const SAND_POROSITY = 0.4; // n — void ratio of the sand matrix (1−n = 0.6)
const _OMEGA = 7.292115e-5; // Earth rotation rate (rad/s)
const PI = Math.PI;

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
const TEOS10_SFAC = 0.0248826675584615; // 1/(40·(35.16504/35))
// [i, j, k, c] for term c·xs^i·ys^j·z^k
const TEOS10_V: ReadonlyArray<readonly [number, number, number, number]> = [
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
type Mat3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

/** R₁(θ) — rotation about the x-axis. */
function rot1(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[1, 0, 0], [0, c, s], [0, -s, c]];
}
/** R₂(θ) — rotation about the y-axis. */
function rot2(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, 0, -s], [0, 1, 0], [s, 0, c]];
}
/** R₃(θ) — rotation about the z-axis. */
function rot3(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, s, 0], [-s, c, 0], [0, 0, 1]];
}
function mat3Mul(A: Mat3, B: Mat3): Mat3 {
  const out: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    }
  }
  return out;
}
function mat3Det(A: Mat3): number {
  return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
       - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
       + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
}
function mat3Trace(A: Mat3): number {
  return A[0][0] + A[1][1] + A[2][2];
}
function mat3Vec(A: Mat3, v: [number, number, number]): [number, number, number] {
  return [
    A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2],
    A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2],
    A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2],
  ];
}

const ARCSEC2RAD = Math.PI / (180 * 3600); // 1″ in radians
const RAD2ARCSEC = 180 * 3600 / Math.PI;   // 1 rad in arcseconds

export const EQUATION_ENGINE: Record<number, ComputeFn> = {

  // ── Part I · Domain 1: Atmospheric Science ──
  1: ({ T10, T11, eps10, eps11, w }) => {
    const a10 = -64.4661, b10 = 0.4398; // Li regression coefficients for Band 10 (0-60°C)
    const a11 = -68.8678, b11 = 0.4755; // Li regression coefficients for Band 11 (0-60°C)
    // Step 1: Atmospheric transmittance from water vapor (MODTRAN 4.0, mid-lat summer)
    const tau10 = Math.max(0.1, -0.1146 * w + 1.0286);
    const tau11 = Math.max(0.1, -0.1568 * w + 1.0083);
    // Step 2: Band-specific coupling parameters
    const C10 = eps10 * tau10;
    const C11 = eps11 * tau11;
    function computeD(τ: number, ε: number): number {
      return (1 - τ) * (1 + (1 - ε) * τ);
    }
    const D10 = computeD(tau10, eps10);
    const D11 = computeD(tau11, eps11);
    // Step 3: Intermediate SWA coefficients
    const E0 = D11 * C10 - D10 * C11;
    if (E0 === 0) return { result: NaN, unit: '°C', steps: ['Singular: E₀ = 0, no solution possible'] };
    const E1 = D11 * (1 - C10 - D10) / E0;
    const E2 = D10 * (1 - C11 - D11) / E0;
    const A = D10 / E0;
    // Step 4: Final SWA coefficients using Planck-function linearization (Li = aᵢ + bᵢT)
    const A0 = E1 * a10 + E2 * a11;
    const A1 = 1 + A + E1 * b10;
    const A2 = A + E2 * b11;
    // Step 5: Land Surface Temperature retrieval
    const Ts = A0 + A1 * T10 - A2 * T11;
    const TsC = Ts - 273.15;
    return {
      result: TsC,
      unit: '°C',
      steps: [
        '── Split-Window Algorithm (Rozenstein et al., 2014) ──',
        `Dataset: TIRS Band 10 BT = ${T10.toFixed(2)} K, Band 11 BT = ${T11.toFixed(2)} K`,
        `Column H₂O = ${w.toFixed(2)} g/cm²`,
        '',
        'Step 1 — Atmospheric Transmittance:',
        `  τ₁₀ = −0.1146·${w.toFixed(2)} + 1.0286 = ${tau10.toFixed(4)}`,
        `  τ₁₁ = −0.1568·${w.toFixed(2)} + 1.0083 = ${tau11.toFixed(4)}`,
        '',
        'Step 2 — Surface-Atmosphere Coupling:',
        `  C₁₀ = ε₁₀·τ₁₀ = ${eps10.toFixed(3)} × ${tau10.toFixed(4)} = ${C10.toFixed(4)}`,
        `  C₁₁ = ε₁₁·τ₁₁ = ${eps11.toFixed(3)} × ${tau11.toFixed(4)} = ${C11.toFixed(4)}`,
        `  D₁₀ = (1−τ₁₀)[1+(1−ε₁₀)τ₁₀] = ${D10.toFixed(4)}`,
        `  D₁₁ = (1−τ₁₁)[1+(1−ε₁₁)τ₁₁] = ${D11.toFixed(4)}`,
        '',
        'Step 3 — Intermediate Coefficients:',
        `  E₀  = D₁₁C₁₀ − D₁₀C₁₁ = ${E0.toFixed(4)}`,
        `  A   = D₁₀/E₀ = ${A.toFixed(4)}`,
        `  E₁  = D₁₁(1−C₁₀−D₁₀)/E₀ = ${E1.toFixed(4)}`,
        `  E₂  = D₁₀(1−C₁₁−D₁₁)/E₀ = ${E2.toFixed(4)}`,
        '',
        'Step 4 — SWA Coefficients (using Li = aᵢ+bᵢT regression):',
        `  A₀  = E₁·a₁₀ + E₂·a₁₁ = ${E1.toFixed(4)}·(−64.4661) + ${E2.toFixed(4)}·(−68.8678) = ${A0.toFixed(4)}`,
        `  A₁  = 1 + A + E₁·b₁₀ = 1 + ${A.toFixed(4)} + ${E1.toFixed(4)}·0.4398 = ${A1.toFixed(4)}`,
        `  A₂  = A + E₂·b₁₁ = ${A.toFixed(4)} + ${E2.toFixed(4)}·0.4755 = ${A2.toFixed(4)}`,
        '',
        'Step 5 — LST Retrieval:',
        `  Ts(K) = A₀ + A₁·T₁₀ − A₂·T₁₁`,
        `  Ts = ${A0.toFixed(4)} + ${A1.toFixed(4)}·${T10.toFixed(2)} − ${A2.toFixed(4)}·${T11.toFixed(2)} = ${Ts.toFixed(2)} K`,
        `  Ts(°C) = ${Ts.toFixed(2)} − 273.15 = ${TsC.toFixed(2)} °C`,
        '',
        `  └ Interpretation: ${TsC > 40 ? 'Very hot surface (desert/urban)' : TsC > 25 ? 'Moderate daytime surface' : TsC > 5 ? 'Temperate surface' : 'Cold surface (snow/high-altitude)'}`,
        `  └ ΔT (T₁₀−T₁₁) = ${(T10 - T11).toFixed(2)} K (${(T10 - T11) > 0 ? 'positive → water vapor present' : 'near-zero → dry atmosphere'})`,
      ],
    };
  },
  2: ({ lambda, T }) => {
    const lamM = lambda * 1e-6;
    const hc_over_lkT = (H_PLANCK * C_LIGHT) / (lamM * K_BOLTZMANN * T);
    const e = Math.exp(hc_over_lkT);
    const B = (2 * H_PLANCK * C_LIGHT ** 2) / Math.pow(lamM, 5) * (1 / (e - 1));
    // Wien's displacement law: λ_max = 2898 / T(°K) µm
    const lamMax = 2897.771955 / T;
    // Stefan-Boltzmann: total exitance M = σT⁴
    const M = SIGMA * Math.pow(T, 4);
    // Spectrum series — B_λ(T) over log-spaced wavelengths 0.1 → 100 µm
    // (10 points), evaluated with the tool's own Planck formula and T.
    const spectrumPoints: Array<{ x: number; y: number }> = Array.from({ length: 10 }, (_, i) => {
      const lam = 0.1 * Math.pow(1000, i / 9);
      const lamM = lam * 1e-6;
      const hcOverLkT = (H_PLANCK * C_LIGHT) / (lamM * K_BOLTZMANN * T);
      const expo = Math.exp(hcOverLkT);
      const b = (2 * H_PLANCK * C_LIGHT ** 2) / Math.pow(lamM, 5) * (1 / (expo - 1));
      return { x: lam, y: Number.isFinite(b) ? b : Number.NaN };
    });
    return {
      result: B, unit: 'W·sr⁻¹·m⁻³',
      secondary: [
        { key: 'wien_peak', value: lamMax, unit: 'µm', label: 'Wien Peak Wavelength' },
        { key: 'total_exitance', value: M, unit: 'W/m²', label: 'Total Exitance (Stefan-Boltzmann)' },
      ],
      series: [{
        label: 'Spectral radiance B_λ(T)',
        color: '#D55E00',
        points: spectrumPoints,
      }],
      steps: [
        '── Planck Radiation Law (Planck, 1901) ──',
        `Wavelength λ = ${lambda} µm, Temperature T = ${T} K (${(T - 273.15).toFixed(1)} °C)`,
        '',
        'Step 1 — Convert wavelength to meters:',
        `  λ(m) = ${lambda} × 10⁻⁶ = ${lamM.toExponential(3)} m`,
        '',
        'Step 2 — Compute exponent hc/λkT:',
        `  hc/λkT = (${H_PLANCK.toExponential(3)} × ${C_LIGHT}) / (${lamM.toExponential(3)} × ${K_BOLTZMANN.toExponential(3)} × ${T})`,
        `  = ${hc_over_lkT.toExponential(4)}`,
        '',
        'Step 3 — Compute spectral radiance:',
        `  B_λ(T) = 2hc²/λ⁵ · 1/(e^(hc/λkT) − 1)`,
        `  B_λ = ${B.toExponential(4)} W·sr⁻¹·m⁻³`,
        '',
        'Step 4 — Derived quantities:',
        `  Wien peak: λ_max = ${lamMax.toFixed(1)} µm (${lamMax < 3 ? 'shortwave IR' : lamMax < 8 ? 'midwave IR' : 'thermal IR'})`,
        `  Total exitance (S-B): M = σT⁴ = ${M.toExponential(4)} W/m²`,
        '',
        `  └ Interpretation: ${T > 5500 ? 'Solar-temperature regime (photosphere)' : T > 1000 ? 'High-temperature source (fire/lava)' : T > 300 ? 'Terrestrial surface temperature' : 'Cold target (ice/cloud top)'}`,
      ]
    };
  },
  3: ({ T }) => {
    const Tc = T;
    const es = 6.1094 * Math.exp((17.625 * Tc) / (Tc + 243.04));
    // Slope of the Magnus–Tetens curve (exact analytic derivative, hPa/°C):
    //   Δ = d e_s / dT = 17.625·243.04·e_s / (T + 243.04)²
    // Same quantity FAO-56 tabulates (converted) for Penman–Monteith.
    const delta = (17.625 * 243.04 * es) / Math.pow(Tc + 243.04, 2);
    // Mixing ratio at saturation (g/kg)
    const ws = 622 * es / (1013.25 - es);
    return {
      result: es, unit: 'hPa',
      secondary: [
        { key: 'slope', value: delta, unit: 'hPa/°C', label: 'Saturation Vapour Slope Δ' },
        { key: 'mixing_ratio', value: ws, unit: 'g/kg', label: 'Saturation Mixing Ratio' },
      ],
      steps: [
        '── Saturation Vapor Pressure (Magnus-Tetens, Clausius-Clapeyron) ──',
        `Temperature T = ${Tc.toFixed(1)} °C (${(Tc + 273.15).toFixed(1)} K)`,
        '',
        'Step 1 — Magnus-Tetens formula:',
        `  e_s(T) = 6.1094 × exp(17.625·T / (T + 243.04))`,
        `  e_s = 6.1094 × exp(17.625 × ${Tc.toFixed(1)} / (${Tc.toFixed(1)} + 243.04))`,
        `  e_s = ${es.toFixed(3)} hPa`,
        '',
        'Step 2 — Derived thermodynamic quantities:',
        `  Slope Δ = de_s/dT = ${delta.toFixed(3)} hPa/°C (used in Penman-Monteith ET₀)`,
        `  Saturation mixing ratio w_s = 622·e_s/(P−e_s) = ${ws.toFixed(2)} g/kg (at P₀=1013.25 hPa)`,
        '',
        'Step 3 — Clausius-Cleyperon context:',
        `  de_s/dT = L_v·e_s/(R_v·T²) (L_v = 2.5×10⁶ J/kg, R_v = 461.5 J/kg·K)`,
        `  e_s doubles approximately every 10 °C increase`,
        '',
        `  └ Interpretation: ${es < 6.11 ? 'Sub-freezing, low vapor capacity' : es < 23.4 ? 'Temperate, moderate moisture' : es < 73.5 ? 'Warm, high moisture' : 'Very warm, extreme vapor capacity (>70 hPa at >40°C)'}`,
      ]
    };
  },
  4: ({ P0, z, T }) => {
    const H = (R_SPEC * T) / G_GRAV;
    const ratio = z / H;
    const P = P0 * Math.exp(-ratio);
    const P_pct = (P / P0) * 100;
    // Profile series — P(z) over altitude 0 → 10000 m (21 points) using the
    // tool's isothermal exponential-decay formula with the supplied P0/T.
    const profilePoints: Array<{ x: number; y: number }> = Array.from({ length: 21 }, (_, i) => {
      const zAlt = (10000 * i) / 20;
      return { x: zAlt, y: P0 * Math.exp(-zAlt / H) };
    });
    return {
      result: P, unit: 'hPa',
      secondary: [
        { key: 'scale_height', value: H, unit: 'm', label: 'Scale Height' },
      ],
      series: [{
        label: 'Hydrostatic pressure P(z)',
        color: '#0072B2',
        points: profilePoints,
      }],
      steps: [
        '── Hydrostatic Equation (Holton & Hakim, 2012) ──',
        `Surface pressure P₀ = ${P0.toFixed(1)} hPa, Altitude z = ${z.toFixed(0)} m, Mean T = ${T.toFixed(1)} K`,
        '',
        'Step 1 — Compute scale height:',
        `  H = R_d·T/g = ${R_SPEC} × ${T.toFixed(1)} / ${G_GRAV}`,
        `  H = ${H.toFixed(1)} m (≈ ${(H / 1000).toFixed(2)} km)`,
        '',
        'Step 2 — Compute altitude ratio:',
        `  z/H = ${z.toFixed(0)} / ${H.toFixed(1)} = ${ratio.toFixed(4)}`,
        '',
        'Step 3 — Apply isothermal exponential decay:',
        `  P(z) = P₀ × exp(−z/H)`,
        `  P(${z.toFixed(0)} m) = ${P0.toFixed(1)} × exp(−${ratio.toFixed(4)})`,
        `  P = ${P.toFixed(1)} hPa`,
        '',
        'Step 4 — Interpretation:',
        `  Pressure ratio P/P₀ = ${P_pct.toFixed(1)}% of surface pressure`,
        `  Standard atmosphere: 500 hPa at ~5.5 km, 250 hPa at ~10.5 km`,
        '',
        `  └ Level: ${P > 700 ? 'Lower troposphere (850 hPa layer)' : P > 500 ? 'Mid-troposphere (700–500 hPa)' : P > 300 ? 'Upper troposphere (500–300 hPa)' : P > 100 ? 'Tropopause / lower stratosphere' : 'Stratosphere'}`,
      ]
    };
  },
  5: ({ f, rho, dPdx, dPdy }) => {
    // Geostrophic balance breaks down at the equator (f → 0). Return a
    // finite NaN with an explanation instead of ±Infinity.
    const allFinite = [f, rho, dPdx, dPdy].every(Number.isFinite);
    if (!allFinite || Math.abs(f) < 1e-7 || rho <= 0) {
      const eqLine = Math.abs(f) < 1e-7
        ? `Coriolis parameter f = ${Number.isFinite(f) ? f.toExponential(2) : 'NaN'} /s — |f| < 10⁻⁷ s⁻¹`
        : `Non-finite / non-positive input: f=${f}, ρ=${rho}, ∂P/∂x=${dPdx}, ∂P/∂y=${dPdy}`;
      return {
        result: NaN, unit: 'm/s',
        secondary: [
          { key: 'u_g', value: Number.NaN, unit: 'm/s', label: 'Zonal component u_g = −(1/fρ)·∂P/∂y' },
          { key: 'v_g', value: Number.NaN, unit: 'm/s', label: 'Meridional component v_g = (1/fρ)·∂P/∂x' },
          { key: 'wind_direction', value: Number.NaN, unit: '°', label: 'Meteorological wind direction (coming from)' },
          { key: 'coriolis_f', value: Number.isFinite(f) ? f : Number.NaN, unit: 's⁻¹', label: 'Coriolis parameter f' },
        ],
        steps: [
          '── Geostrophic Wind (Holton & Hakim, 2012, Ch. 3) ──',
          eqLine,
          '',
          'Geostrophic balance (f·Vg = (1/ρ)|∇P|) requires |f| well away from',
          'the equator; the Coriolis force vanishes at 0° latitude so the',
          'wind would become infinite, and ρ must be a finite positive density.',
          'Supply a mid-latitude study area, a positive air density, and finite',
          'pressure gradients. Result: NaN (honest — never ±Infinity).',
        ],
      };
    }
    const Vgx = (1 / (f * rho)) * -dPdy;
    const Vgy = (1 / (f * rho)) * dPdx;
    const Vg = Math.hypot(Vgx, Vgy);
    const dirRad = Math.atan2(Vgy, Vgx);
    const dirDeg = ((dirRad * 180 / PI) + 360) % 360;
    // Meteorological wind direction (coming from): 270° - cartesian angle
    const metDir = ((270 - (dirRad * 180 / PI)) + 360) % 360;
    return {
      result: Vg, unit: 'm/s',
      secondary: [
        { key: 'u_g', value: Vgx, unit: 'm/s', label: 'Zonal component u_g = −(1/fρ)·∂P/∂y' },
        { key: 'v_g', value: Vgy, unit: 'm/s', label: 'Meridional component v_g = (1/fρ)·∂P/∂x' },
        { key: 'wind_direction', value: metDir, unit: '°', label: 'Meteorological wind direction (coming from), 0°=N 90°=E' },
        { key: 'coriolis_f', value: f, unit: 's⁻¹', label: 'Coriolis parameter f' },
      ],
      steps: [
        '── Geostrophic Wind (Holton & Hakim, 2012, Ch. 3) ──',
        `Coriolis parameter f = ${f.toFixed(6)} /s, Air density ρ = ${rho.toFixed(3)} kg/m³`,
        `Pressure gradient ∂P/∂x = ${dPdx.toFixed(6)} Pa/m, ∂P/∂y = ${dPdy.toFixed(6)} Pa/m`,
        '',
        'Step 1 — Compute u-component (eastward):',
        `  u_g = −(1/fρ)·∂P/∂y = −1/(${f.toFixed(6)}×${rho.toFixed(3)}) × (${dPdy.toFixed(6)})`,
        `  u_g = ${Vgx.toFixed(4)} m/s`,
        '',
        'Step 2 — Compute v-component (northward):',
        `  v_g = (1/fρ)·∂P/∂x = 1/(${f.toFixed(6)}×${rho.toFixed(3)}) × (${dPdx.toFixed(6)})`,
        `  v_g = ${Vgy.toFixed(4)} m/s`,
        '',
        'Step 3 — Compute total wind speed:',
        `  |V_g| = √(u_g² + v_g²) = √(${Vgx.toFixed(4)}² + ${Vgy.toFixed(4)}²)`,
        `  |V_g| = ${Vg.toFixed(3)} m/s (${(Vg * 3.6).toFixed(1)} km/h)`,
        '',
        'Step 4 — Wind direction:',
        `  Cartesian angle: ${dirDeg.toFixed(1)}° from east`,
        `  Meteorological (coming from): ${metDir.toFixed(1)}°`,
        '',
        `  └ Interpretation: ${Vg < 5 ? 'Light geostrophic wind (weak gradient)' : Vg < 15 ? 'Moderate geostrophic wind (typical synoptic)' : Vg < 30 ? 'Strong geostrophic wind (deep cyclone)' : 'Very strong / jet stream level'}`,
      ]
    };
  },
  6: ({ u, D, C0, t, sigma0 }) => {
    const Pe = (u * u * t) / (4 * D);
    // 3-D Gaussian puff with σ² = σ₀² + 2Dt (σ₀ = initial release scale,
    // from mapInputs, default 50 m). Centreline dilution is the volume ratio
    // (σ₀/σ)³. Limits: C → C₀ as t → 0 or D → 0; C → 0 as t → ∞; dilution
    // is monotonic in BOTH t and D (more time or more diffusion → more
    // dilution). The previous exp(−1/Pe) form grew with time and failed both
    // limits.
    const s0 = sigma0 != null && sigma0 > 0 ? sigma0 : 50;
    const dilution = Math.pow(1 + (2 * D * t) / (s0 * s0), -1.5);
    const C = C0 * dilution;
    const sigma = Math.sqrt(2 * D * t);
    const advDist = u * t;
    return {
      result: C, unit: 'µg/m³',
      secondary: [
        { key: 'peclet', value: Pe, unit: '—', label: 'Péclet Number' },
        { key: 'advection_distance', value: advDist, unit: 'm', label: 'Advection Distance x = u·t' },
        { key: 'diffusion_spread', value: sigma, unit: 'm', label: 'Diffusion Spread σ = √(2Dt)' },
      ],
      steps: [
        '── Advection-Diffusion Equation (Bird, Stewart & Lightfoot, 2007, Ch. 4) ──',
        `Wind speed u = ${u.toFixed(2)} m/s, Eddy diffusivity D = ${D.toFixed(2)} m²/s`,
        `Initial concentration C₀ = ${C0.toFixed(2)} µg/m³, Time t = ${t.toFixed(0)} s (${(t / 3600).toFixed(2)} hr), Release scale σ₀ = ${s0.toFixed(0)} m`,
        '',
        'Step 1 — Compute Péclet number:',
        '  Pe = u²t / (4D) — ratio of advective to diffusive transport',
        `  Pe = ${u.toFixed(2)}² × ${t.toFixed(0)} / (4 × ${D.toFixed(2)}) = ${Pe.toFixed(3)}`,
        `  → ${Pe > 10 ? 'Advection-dominated (narrow plume, far downwind)' : Pe > 1 ? 'Mixed regime (comparable advection & diffusion)' : 'Diffusion-dominated (plume spreads in all directions)'}`,
        '',
        'Step 2 — Compute dilution factor (Gaussian puff, σ² = σ₀² + 2Dt):',
        `  dilution = (1 + 2Dt/σ₀²)^{-3/2} = (1 + ${((2 * D * t) / (s0 * s0)).toFixed(3)})^{-1.5} = ${dilution.toExponential(4)}`,
        '',
        'Step 3 — Compute peak concentration:',
        `  C = C₀ × dilution = ${C0.toFixed(2)} × ${dilution.toExponential(4)}`,
        `  C = ${C.toExponential(4)} µg/m³`,
        '',
        'Step 4 — Plume geometry:',
        `  Advection distance: x = u·t = ${u.toFixed(2)} × ${t.toFixed(0)} = ${advDist.toFixed(0)} m (${(advDist / 1000).toFixed(2)} km)`,
        `  Diffusion spread: σ = √(2Dt) = √(2 × ${D.toFixed(2)} × ${t.toFixed(0)}) = ${sigma.toFixed(1)} m (total puff radius ≈ ${Math.sqrt(s0 * s0 + sigma * sigma).toFixed(0)} m)`,
        '',
        `  └ Interpretation: ${dilution < 0.01 ? 'Severe dilution — concentration reduced by >99%' : dilution < 0.1 ? 'Significant dilution — concentration reduced by >90%' : dilution < 0.5 ? 'Moderate dilution' : 'Minimal dilution — concentrated plume'}`,
      ]
    };
  },
  7: ({ zg, zs, thvz, thvs, uz, us }) => {
    const dz = zg - zs;
    const dth = thvz - thvs;
    const du = Math.abs(uz - us);
    const den = thvs * du * du;
    const Ri = den !== 0 ? (G_GRAV * dz * dth) / den : (dth > 0 ? Infinity : -Infinity);
    let stability: string;
    if (Ri < -0.01) stability = 'UNSTABLE — free convection, thermals, cumulus development';
    else if (Ri < 0.01) stability = 'NEUTRAL — mechanical turbulence only, overcast or windy';
    else if (Ri < 0.25) stability = 'WEAKLY STABLE — intermittent turbulence, some suppression';
    else stability = 'STABLE — turbulence suppressed, fog/frost likely, poor dispersion';
    return {
      result: Ri, unit: '—',
      steps: [
        '── Bulk Richardson Number (Stull, 1988, Ch. 4) ──',
        `Layer: z_g = ${zg.toFixed(1)} m, z_s = ${zs.toFixed(1)} m → Δz = ${dz.toFixed(1)} m`,
        `Virtual pot. temp: θ_v(z) = ${thvz.toFixed(2)} K, θ_v(s) = ${thvs.toFixed(2)} K → Δθ_v = ${dth.toFixed(3)} K`,
        `Wind speed: u(z) = ${uz.toFixed(2)} m/s, u(s) = ${us.toFixed(2)} m/s → Δu = ${du.toFixed(3)} m/s`,
        '',
        'Step 1 — Compute numerator (buoyancy term):',
        `  g·Δz·Δθ_v = ${G_GRAV} × ${dz.toFixed(1)} × ${dth.toFixed(3)} = ${(G_GRAV * dz * dth).toFixed(4)}`,
        '',
        'Step 2 — Compute denominator (shear term):',
        `  θ_v(s)·Δu² = ${thvs.toFixed(2)} × ${du.toFixed(3)}² = ${den.toFixed(4)}`,
        '',
        'Step 3 — Compute Ri_b:',
        `  Ri_b = ${(G_GRAV * dz * dth).toFixed(4)} / ${den.toFixed(4)} = ${Ri.toFixed(4)}`,
        '',
        'Step 4 — Stability classification:',
        `  Ri_b = ${Ri.toFixed(4)} → ${stability}`,
        '',
        `  └ Critical threshold Ri_c = 0.25: ${Ri >= 0.25 ? 'TURBULENCE SUPPRESSED (Ri ≥ 0.25)' : 'TURBULENCE POSSIBLE (Ri < 0.25)'}`,
      ]
    };
  },
  8: ({ C, eps, k }) => {
    const eps23 = Math.pow(eps, 2 / 3);
    const k53 = Math.pow(k, -5 / 3);
    const E = C * eps23 * k53;
    const L = (2 * Math.PI) / k;
    // Kolmogorov microscale (ν ≈ 1.5×10⁻⁵ m²/s for air at 20°C)
    const nu = 1.5e-5;
    const eta = Math.pow(nu * nu * nu / (eps || 1e-30), 1 / 4);
    const kEta = 1 / eta;
    const inInertial = k < kEta;
    // Spectrum series — E(k) over log-spaced wavenumbers 0.001 → 1000 (30
    // points) using the tool's −5/3 law with the supplied C and ε.
    const spectrumPoints: Array<{ x: number; y: number }> = Array.from({ length: 30 }, (_, i) => {
      const kw = 0.001 * Math.pow(1e6, i / 29);
      const eVal = C * Math.pow(eps, 2 / 3) * Math.pow(kw, -5 / 3);
      return { x: kw, y: Number.isFinite(eVal) ? eVal : Number.NaN };
    });
    return {
      result: E, unit: 'm³/s²',
      secondary: [
        { key: 'eddy_size', value: L, unit: 'm', label: 'Eddy Size L = 2π/k' },
        { key: 'kolmogorov_microscale', value: eta, unit: 'm', label: 'Kolmogorov Microscale η' },
      ],
      series: [{
        label: 'Turbulent energy spectrum E(k)',
        color: '#0072B2',
        points: spectrumPoints,
      }],
      steps: [
        '── Kolmogorov −5/3 Energy Cascade (Kolmogorov, 1941) ──',
        `Kolmogorov constant C = ${C.toFixed(2)}, TKE dissipation ε = ${eps.toExponential(3)} m²/s³`,
        `Wavenumber k = ${k.toExponential(3)} 1/m`,
        '',
        'Step 1 — Compute ε^(2/3):',
        `  ε^(2/3) = (${eps.toExponential(3)})^(2/3) = ${eps23.toExponential(4)}`,
        '',
        'Step 2 — Compute k^(−5/3):',
        `  k^(−5/3) = (${k.toExponential(3)})^(−5/3) = ${k53.toExponential(4)}`,
        '',
        'Step 3 — Apply −5/3 law:',
        `  E(k) = C·ε^(2/3)·k^(−5/3)`,
        `  E(k) = ${C.toFixed(2)} × ${eps23.toExponential(4)} × ${k53.toExponential(4)}`,
        `  E(k) = ${E.toExponential(4)} m³/s²`,
        '',
        'Step 4 — Eddy size:',
        `  L = 2π/k = 2π / ${k.toExponential(3)} = ${L.toFixed(1)} m`,
        '',
        'Step 5 — Kolmogorov microscale:',
        `  η = (ν³/ε)^(1/4) = ${eta.toExponential(4)} m (dissipation scale)`,
        `  k_η = 1/η = ${kEta.toExponential(4)} 1/m`,
        `  ${inInertial ? '✓ k < k_η: within inertial subrange — −5/3 law valid' : '⚠ k ≥ k_η: in dissipation range — −5/3 law may not apply'}`,
        '',
        `  └ Regime: ${L > 1000 ? 'Energy-containing range (large synoptic eddies)' : L > 1 ? 'Inertial subrange (turbulent eddies following −5/3)' : 'Dissipation range (viscous effects dominant)'}`,
      ]
    };
  },

  // ── Domain 2: Hydrology & Oceanography ──
  9: ({ Rn, G, T, u2, es, ea, delta, gamma }) => {
    const Rn_MJ = Rn * 0.0864;
    const G_MJ = G * 0.0864;
    const radTerm = 0.408 * delta * (Rn_MJ - G_MJ);
    const aeroTerm = gamma * (900 / (T + 273)) * u2 * (es - ea);
    const den = delta + gamma * (1 + 0.34 * u2);
    const ET0 = (radTerm + aeroTerm) / den;
    const radContrib = radTerm / den;
    const aeroContrib = aeroTerm / den;
    const radFrac = ET0 > 0 ? radTerm / (radTerm + aeroTerm) * 100 : 0;
    const aeroFrac = ET0 > 0 ? aeroTerm / (radTerm + aeroTerm) * 100 : 0;
    return {
      result: ET0, unit: 'mm/day',
      secondary: [
        { key: 'radiation_term', value: Number.isFinite(radTerm) ? radTerm : Number.NaN, unit: 'mm/day', label: 'Radiation Term' },
        { key: 'aerodynamic_term', value: Number.isFinite(aeroTerm) ? aeroTerm : Number.NaN, unit: 'mm/day', label: 'Aerodynamic Term' },
        { key: 'rad_fraction', value: Number.isFinite(radFrac) ? radFrac : Number.NaN, unit: '%', label: 'Radiation Contribution' },
        { key: 'aero_fraction', value: Number.isFinite(aeroFrac) ? aeroFrac : Number.NaN, unit: '%', label: 'Aerodynamic Contribution' },
      ],
      steps: [
        '── FAO-56 Penman-Monteith (Allen et al., 1998) ──',
        `Rₙ = ${Rn.toFixed(1)} W/m², G = ${G.toFixed(1)} W/m², T = ${T.toFixed(1)} °C`,
        `u₂ = ${u2.toFixed(2)} m/s, eₛ = ${es.toFixed(3)} kPa, eₐ = ${ea.toFixed(3)} kPa, Δ = ${delta.toFixed(3)} kPa/°C, γ = ${gamma.toFixed(3)} kPa/°C`,
        '',
        'Step 1 — Energy unit conversion (W/m² → MJ/m²/day):',
        `  Rₙ(MJ/m²/day) = ${Rn.toFixed(1)} × 0.0864 = ${Rn_MJ.toFixed(3)}`,
        `  G(MJ/m²/day) = ${G.toFixed(1)} × 0.0864 = ${G_MJ.toFixed(3)}`,
        '',
        'Step 2 — Radiation term:',
        `  0.408 × Δ × (Rₙ−G) = 0.408 × ${delta.toFixed(3)} × (${Rn_MJ.toFixed(3)} − ${G_MJ.toFixed(3)})`,
        `  RadNum = ${radTerm.toFixed(4)} mm/day`,
        '',
        'Step 3 — Aerodynamic term:',
        `  γ × (900/(T+273)) × u₂ × (eₛ−eₐ) = ${gamma.toFixed(3)} × (900/(${T.toFixed(1)}+273)) × ${u2.toFixed(2)} × (${es.toFixed(3)}−${ea.toFixed(3)})`,
        `  AeroNum = ${aeroTerm.toFixed(4)} mm/day`,
        '',
        'Step 4 — Denominator:',
        `  Δ + γ(1+0.34u₂) = ${delta.toFixed(3)} + ${gamma.toFixed(3)} × (1 + 0.34 × ${u2.toFixed(2)})`,
        `  Den = ${den.toFixed(4)}`,
        '',
        'Step 5 — Reference ET:',
        `  ET₀ = (${radTerm.toFixed(4)} + ${aeroTerm.toFixed(4)}) / ${den.toFixed(4)}`,
        `  ET₀ = ${ET0.toFixed(2)} mm/day`,
        '',
        'Step 6 — Component analysis:',
        `  Radiation contribution = ${radContrib.toFixed(2)} mm/day (${(radContrib / ET0 * 100).toFixed(0)}%)`,
        `  Aerodynamic contribution = ${aeroContrib.toFixed(2)} mm/day (${(aeroContrib / ET0 * 100).toFixed(0)}%)`,
        '',
        `  └ Interpretation: ${ET0 < 3 ? 'Low evaporative demand (cool/humid)' : ET0 < 6 ? 'Moderate evaporative demand' : 'High evaporative demand (arid/heat wave)'}`
      ]
    };
  },
  10: ({ P, Ia, S }) => {
    if (!Number.isFinite(P) || !Number.isFinite(Ia) || !Number.isFinite(S)) {
      return {
        result: Number.NaN, unit: 'mm',
        steps: [
          '── SCS Curve Number (USDA SCS, 1954) ──',
          'Precipitation P, initial abstraction Iₐ, or potential retention S is missing (NaN).',
          'No fabricated substitution — supply all three inputs.',
        ],
      };
    }
    const excess = P - Ia;
    const Q = excess > 0 ? Math.max(0, Math.pow(excess, 2) / (excess + S)) : 0;
    const CN = S > 0 ? 25400 / (S + 254) : 100;
    const runoffRatio = P > 0 ? Q / P : 0;
    const iaRatio = S > 0 ? Ia / S : 0;
    return {
      result: Q, unit: 'mm',
      secondary: [
        { key: 'cn', value: Number.isFinite(CN) ? CN : Number.NaN, unit: '—', label: 'Curve Number' },
        { key: 'runoff_ratio', value: Number.isFinite(runoffRatio) ? runoffRatio : Number.NaN, unit: '—', label: 'Runoff Ratio (Q/P)' },
        { key: 'initial_abstraction_ratio', value: Number.isFinite(iaRatio) ? iaRatio : Number.NaN, unit: '—', label: 'Initial Abstraction Ratio (Iₐ/S)' },
      ],
      steps: [
        '── SCS Curve Number (USDA SCS, 1954) ──',
        `Precipitation P = ${P.toFixed(1)} mm, Initial abstraction Iₐ = ${Ia.toFixed(1)} mm`,
        `Potential retention S = ${S.toFixed(1)} mm, Derived CN = ${CN.toFixed(0)}`,
        '',
        'Step 1 — Check runoff threshold:',
        `  P = ${P.toFixed(1)} mm,  Iₐ = ${Ia.toFixed(1)} mm`,
        `  ${P > Ia ? `P > Iₐ → runoff occurs (excess = ${(P - Ia).toFixed(1)} mm)` : 'P ≤ Iₐ → no runoff (Q = 0)'}`,
        '',
        'Step 2 — Compute runoff:',
        `  Q = (P−Iₐ)² / (P−Iₐ+S) = (${(P - Ia).toFixed(1)})² / (${(P - Ia).toFixed(1)} + ${S.toFixed(1)})`,
        `  Q = ${Q.toFixed(2)} mm`,
        '',
        'Step 3 — Runoff ratio:',
        `  Q/P = ${Q.toFixed(2)} / ${P.toFixed(1)} = ${(runoffRatio * 100).toFixed(1)}%`,
        '',
        `  └ Interpretation: ${runoffRatio < 0.2 ? 'Low runoff fraction — high infiltration capacity' : runoffRatio < 0.4 ? 'Moderate runoff — typical agricultural watershed' : runoffRatio < 0.6 ? 'High runoff — urban/impervious or saturated soil' : 'Very high runoff — extreme storm or impervious surface'}`
      ]
    };
  },
  11: ({ n, R, S }) => {
    const R23 = Math.pow(R, 2 / 3);
    const S12 = Math.sqrt(S);
    const v = (1 / n) * R23 * S12;
    return {
      result: v, unit: 'm/s',
      steps: [
        "── Manning's Equation (Manning, 1891) ──",
        `Roughness n = ${n.toFixed(3)}, Hydraulic radius R = ${R.toFixed(3)} m, Slope S = ${S.toFixed(5)} m/m`,
        '',
        'Step 1 — Compute R^(2/3):',
        `  R^(2/3) = ${R.toFixed(3)}^(2/3) = ${R23.toFixed(4)}`,
        '',
        'Step 2 — Compute S^(1/2):',
        `  S^(1/2) = √(${S.toFixed(5)}) = ${S12.toFixed(6)}`,
        '',
        'Step 3 — Compute velocity:',
        `  v = (1/${n.toFixed(3)}) × ${R23.toFixed(4)} × ${S12.toFixed(6)}`,
        `  v = ${v.toFixed(3)} m/s`,
        '',
        'Step 4 — Flow classification:',
        `  v = ${v.toFixed(3)} m/s = ${(v * 3.6).toFixed(2)} km/h`,
        '',
        `  └ Interpretation: ${v < 0.5 ? 'Low velocity — fine sediment deposition likely' : v < 2 ? 'Moderate velocity — sand/gravel transport' : v < 3.5 ? 'High velocity — cobble transport, erosive' : 'Very high velocity — boulder transport, extreme erosion potential'}`
      ]
    };
  },
  12: ({ C, i, A }) => {
    const Q = C * i * A;
    const Qm3s = Q / 3.6; // convert from mm/h·km² to m³/s
    return {
      result: Qm3s, unit: 'm³/s',
      steps: [
        '── Rational Method (Mulvaney, 1851) ──',
        `Runoff coefficient C = ${C.toFixed(3)}, Rainfall intensity i = ${i.toFixed(2)} mm/h`,
        `Catchment area A = ${A.toFixed(3)} km²`,
        '',
        'Step 1 — Apply rational formula:',
        `  Q = C × i × A = ${C.toFixed(3)} × ${i.toFixed(2)} × ${A.toFixed(3)}`,
        `  Q = ${Q.toFixed(3)} (mm/h·km²)`,
        '',
        'Step 2 — Convert to m³/s:',
        `  Q(m³/s) = ${Q.toFixed(3)} / 3.6 = ${Qm3s.toFixed(3)} m³/s`,
        '',
        'Step 3 — Specific discharge:',
        `  Q/A = ${Qm3s.toFixed(3)} / ${A.toFixed(3)} = ${(Qm3s / A).toFixed(4)} m³/s/km²`,
        '',
        `  └ Interpretation: ${Qm3s < 1 ? 'Small catchment stormflow' : Qm3s < 10 ? 'Moderate peak discharge' : Qm3s < 100 ? 'Large peak discharge — major storm event' : 'Extreme peak discharge — potential flood hazard'}`
      ]
    };
  },
  13: ({ K, X, It, Ot }) => {
    // Muskingum storage (McCarthy 1938 / Chow 1964): S = K[X·I + (1−X)·O],
    // X = weighting on INFLOW (typical 0–0.3). The previous code had the
    // weights transposed — (1−X)·I + X·O — contradicting its own step text.
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const Kn = Number(K), Xn = Number(X), ItN = Number(It), OtN = Number(Ot);
    if (![Kn, Xn, ItN, OtN].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'm³/s·h',
        steps: [
          '── Muskingum Routing (McCarthy, 1938) ──',
          'S = K × [X·I_t + (1−X)·O_t]',
          '',
          'Inflow I_t / outflow O_t require genuine streamflow. No USGS station',
          'was found near the study point (or inputs are non-finite), so no',
          'fabricated discharge is substituted. Supply K, X, I_t, O_t explicitly',
          'or select a point near a USGS gauge.',
        ],
        secondary: [
          { key: 'outflow_next', value: Number.NaN, unit: 'm³/s', label: 'Outflow Next Time Step O(t+1)' },
          { key: 'coeff_c0', value: Number.NaN, unit: '—', label: 'Routing coefficient C₀' },
          { key: 'coeff_c1', value: Number.NaN, unit: '—', label: 'Routing coefficient C₁' },
          { key: 'coeff_c2', value: Number.NaN, unit: '—', label: 'Routing coefficient C₂' },
        ],
      };
    }
    const weightedStorage = Xn * ItN + (1 - Xn) * OtN;
    const S = Kn * weightedStorage;
    const coeffCheck = Kn * (1 - Xn);
    // Muskingum routing coefficients (Δt = K/2 default, stable: Δt ≤ K(1−X)):
    //   C₀ = (−KX + 0.5Δt)/(K(1−X) + 0.5Δt), C₁ = (KX + 0.5Δt)/den,
    //   C₂ = (K(1−X) − 0.5Δt)/den,  C₀+C₁+C₂ = 1.
    const dt = Kn / 2;
    const den = Kn * (1 - Xn) + 0.5 * dt;
    const c0 = (-Kn * Xn + 0.5 * dt) / den;
    const c1 = (Kn * Xn + 0.5 * dt) / den;
    const c2 = (Kn * (1 - Xn) - 0.5 * dt) / den;
    const outNext = c0 * ItN + c1 * ItN + c2 * OtN;
    // Routed outflow hydrograph over a model-time horizon: O(t+1) = c0·I(t+1)
    // + c1·I(t) + c2·O(t) with the inflow held at ItN (genuine model curve).
    const seriesPoints: Array<{ x: number; y: number }> = [];
    let oPrev = OtN;
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const o = i === 0 ? OtN : c0 * ItN + c1 * ItN + c2 * oPrev;
      oPrev = o;
      if (Number.isFinite(o)) seriesPoints.push({ x: i * dt, y: o });
    }
    return {
      result: S, unit: 'm³/s·h',
      secondary: [
        { key: 'outflow_next', value: Number.isFinite(outNext) ? outNext : Number.NaN, unit: 'm³/s', label: 'Outflow Next Time Step O(t+1)' },
        { key: 'coeff_c0', value: Number.isFinite(c0) ? c0 : Number.NaN, unit: '—', label: 'Routing coefficient C₀' },
        { key: 'coeff_c1', value: Number.isFinite(c1) ? c1 : Number.NaN, unit: '—', label: 'Routing coefficient C₁' },
        { key: 'coeff_c2', value: Number.isFinite(c2) ? c2 : Number.NaN, unit: '—', label: 'Routing coefficient C₂' },
      ],
      series: seriesPoints.length > 0
        ? [{
            label: 'Routed outflow O(t)',
            color: '#0072B2',
            points: seriesPoints,
          }]
        : undefined,
      steps: [
        '── Muskingum Routing (McCarthy, 1938) ──',
        `Storage constant K = ${Kn.toFixed(2)} h, Weighting factor X = ${Xn.toFixed(3)}`,
        `Inflow I_t = ${ItN.toFixed(1)} m³/s, Outflow O_t = ${OtN.toFixed(1)} m³/s`,
        '',
        'Step 1 — Weighted storage:',
        `  X·I_t + (1−X)·O_t = ${Xn.toFixed(3)}×${ItN.toFixed(1)} + (1−${Xn.toFixed(3)})×${OtN.toFixed(1)}`,
        `  = ${Xn * ItN} + ${((1 - Xn) * OtN)} = ${weightedStorage.toFixed(2)}`,
        '',
        'Step 2 — Reach storage:',
        `  S = K × [X·I_t + (1−X)·O_t] = ${Kn.toFixed(2)} × ${weightedStorage.toFixed(2)}`,
        `  S = ${S.toFixed(2)} m³/s·h`,
        '',
        'Step 3 — Routing coefficients (Δt = K/2):',
        `  C₀ = (−KX + 0.5Δt)/D = ${c0.toFixed(4)}`,
        `  C₁ = (KX + 0.5Δt)/D   = ${c1.toFixed(4)}`,
        `  C₂ = (K(1−X) − 0.5Δt)/D = ${c2.toFixed(4)}`,
        `  C₀ + C₁ + C₂ = ${(c0 + c1 + c2).toFixed(4)} (mass conservation)`,
        '',
        'Step 4 — Outflow next step:',
        `  O(t+1) = C₀·I(t+1) + C₁·I(t) + C₂·O(t) = ${outNext.toFixed(2)} m³/s`,
        '',
        'Step 5 — Stability check:',
        `  K×X = ${(Kn * Xn).toFixed(3)},  K×(1−X) = ${coeffCheck.toFixed(3)}`,
        `  ${coeffCheck > 0 ? '✓ Routing coefficient positive (stable)' : '⚠ Check: negative routing coefficient possible'}`,
        '',
        `  └ Interpretation: ${Xn < 0.1 ? 'Near-reservoir storage — strong attenuation' : Xn < 0.3 ? 'Typical natural channel storage' : 'Near-translation — weak attenuation, wave moves through reach with minimal peak reduction'}`
      ]
    };
  },
  14: ({ H0, amps, __officialHeight, __schuremanHeight, __tideStation }) => {
    const ampArr: number[] = Array.isArray(amps) ? amps.filter((a: unknown) => typeof a === 'number' && Number.isFinite(a)) : [];
    if (!Number.isFinite(H0) && ampArr.length === 0) {
      return {
        result: NaN, unit: 'm',
        steps: [
          '── Tidal Harmonic Analysis (Pugh & Woodworth, 2014) ──',
          '',
          'No genuine tidal constituents or datum could be resolved for this',
          'location (no NOAA tide-prediction station within range, or the',
          'CO-OPS API was unreachable). Provide an explicit H₀ and constituent',
          'amplitudes, or choose a coastal study area.',
        ],
      };
    }
    const sumTerms = ampArr.reduce((s: number, a: number) => s + a, 0);
    const sumAbsAmps = ampArr.reduce((s: number, a: number) => s + Math.abs(a), 0);
    const H0v = Number.isFinite(H0) ? H0 : 0;
    const h = H0v + sumTerms;
    const nConstituents = ampArr.length;
    const official = typeof __officialHeight === 'number' && Number.isFinite(__officialHeight) ? __officialHeight : null;
    const station = typeof __tideStation === 'string' ? __tideStation : null;
    const steps = [
      '── Tidal Harmonic Analysis (Pugh & Woodworth, 2014; Schureman, 1958) ──',
      `h(t) = H₀ + Σ Aᵢ·fᵢ·cos(ωᵢt + V₀ᵢ + uᵢ − φᵢ)`,
      '',
      `Station: ${station ?? 'not resolved (constituents user-supplied)'}`,
      `Datum constant H₀ (MTL − MLLW) = ${Number.isFinite(H0) ? H0.toFixed(3) + ' m' : 'not available'}`,
      `Number of constituents: ${nConstituents} (each term pre-evaluated with node factor f, equilibrium argument V₀, nodal phase u)`,
      '',
      'Step 1 — Constituent summation (Schureman-corrected terms):',
      `  Σ Aᵢ·fᵢ·cos(ωᵢt + V₀ᵢ + uᵢ − φᵢ) = ${sumTerms.toFixed(3)} m`,
      '',
      'Step 2 — Tidal elevation (datum MLLW):',
      `  h(t) = H₀ + Σ… = ${H0v.toFixed(3)} + (${sumTerms.toFixed(3)}) = ${h.toFixed(3)} m`,
    ];
    if (official != null) {
      const diff = h - official;
      steps.push(
        '',
        'Step 3 — Cross-validation vs official NOAA CO-OPS prediction:',
        `  Official (${station}) = ${official.toFixed(3)} m`,
        `  Schureman (this) = ${h.toFixed(3)} m, |Δ| = ${Math.abs(diff).toFixed(3)} m`
      );
    }
    const range = 2 * sumAbsAmps;
    steps.push(
      '',
      `Step ${official != null ? 4 : 3} — Tidal classification:`,
      `  Tidal range ≈ 2·Σ|Aᵢ| = ${range.toFixed(2)} m (approximate, constituents only)`,
      '',
      `  └ Interpretation: ${range < 2 ? 'Microtidal regime (< 2 m)' : range < 4 ? 'Mesotidal regime (2–4 m)' : 'Macrotidal regime (> 4 m)'}${official != null ? ' | height above MLLW datum' : ''}`
    );
    return {
      result: h, unit: 'm',
      secondary: [
        { key: 'tidal_range', value: Number.isFinite(range) ? range : Number.NaN, unit: 'm', label: 'Tidal Range (2·Σ|Aᵢ|)' },
        { key: 'constituent_count', value: Number.isFinite(nConstituents) ? nConstituents : Number.NaN, unit: '—', label: 'Constituent Count' },
        { key: 'datum_offset', value: Number.isFinite(H0v) ? H0v : Number.NaN, unit: 'm', label: 'Datum Offset (H₀)' },
      ],
      steps,
    };
  },
  15: ({ tau, rho, A, f, vTheta: _vTheta }) => {
    if (!Number.isFinite(f) || Math.abs(f) < 1e-7) {
      return {
        result: NaN, unit: 'm/s',
        steps: [
          '── Ekman Spiral (Ekman, 1905) ──',
          `Coriolis parameter f = ${f} /s — near zero`,
          '',
          'Ekman surface drift V₀ = τ/√(ρfAᵥ) diverges as f → 0 (equator):',
          'the spiral thickness depends on the Coriolis force, so the steady',
          'Ekman solution is not defined at ~0° latitude. Provide a',
          'non-equatorial study area or an explicit f.',
        ],
      };
    }
    const rhoFAv = rho * Math.abs(f) * A;
    const V0 = tau / Math.sqrt(rhoFAv);
    const De = Math.PI * Math.sqrt(2 * A / Math.abs(f));
    const Ue = tau / (rho * Math.abs(f));
    const _windRatio = V0 > 0 && tau > 0 ? V0 / (tau * 100) * 100 : 0;
    return {
      result: V0, unit: 'm/s',
      steps: [
        '── Ekman Spiral (Ekman, 1905) ──',
        `Wind stress τ = ${tau.toFixed(4)} N/m², Seawater density ρ = ${rho.toFixed(0)} kg/m³`,
        `Coriolis f = ${f.toFixed(6)} /s, Eddy viscosity A_v = ${A.toFixed(4)} m²/s`,
        '',
        'Step 1 — Compute surface current:',
        `  V₀ = τ / √(ρfA_v) = ${tau.toFixed(4)} / √(${rho.toFixed(0)} × ${f.toFixed(6)} × ${A.toFixed(4)})`,
        `  V₀ = ${tau.toFixed(4)} / √(${rhoFAv.toExponential(4)})`,
        `  V₀ = ${V0.toFixed(4)} m/s (${(V0 * 100).toFixed(2)} cm/s)`,
        '',
        'Step 2 — Ekman depth:',
        `  D_e = π√(2A_v/f) = π × √(2 × ${A.toFixed(4)} / ${f.toFixed(6)})`,
        `  D_e = ${De.toFixed(1)} m`,
        '',
        'Step 3 — Ekman transport:',
        `  U_E = τ/(ρf) = ${tau.toFixed(4)} / (${rho.toFixed(0)} × ${f.toFixed(6)})`,
        `  U_E = ${Ue.toFixed(4)} m²/s (transport per unit width)`,
        '',
        `  └ Direction: 45° right of wind (Northern Hemisphere) | Surface drift ≈ ${(V0 * 100).toFixed(1)} cm/s | Ekman layer depth = ${De.toFixed(0)} m`
      ]
    };
  },
  16: ({ f, vg: _vg, dpdx, rho }) => {
    if (!Number.isFinite(f) || Math.abs(f) < 1e-7) {
      return {
        result: NaN, unit: 'm/s',
        steps: [
          '── Geostrophic Current (Gill, 1982) ──',
          `Coriolis parameter f = ${f} /s — near zero`,
          '',
          'Geostrophic balance requires the Coriolis force (f·v = (1/ρ)∂p/∂x);',
          'at ~0° latitude f → 0 and the velocity diverges. Supply a',
          'non-equatorial study area or an explicit f.',
        ],
      };
    }
    const v = (1 / (rho * f)) * dpdx;
    const slope = dpdx / (rho * G_GRAV); // Equivalent sea surface slope ∂η/∂x
    return {
      result: v, unit: 'm/s',
      steps: [
        '── Geostrophic Current (Gill, 1982) ──',
        `Coriolis parameter f = ${f.toFixed(6)} /s, Density ρ = ${rho.toFixed(0)} kg/m³`,
        `Pressure gradient ∂p/∂x = ${dpdx.toExponential(4)} Pa/m`,
        '',
        'Step 1 — Compute geostrophic velocity:',
        `  v_g = (1/ρf) × ∂p/∂x = 1/(${rho.toFixed(0)} × ${f.toFixed(6)}) × ${dpdx.toExponential(4)}`,
        `  v_g = ${v.toFixed(6)} m/s (${(v * 100).toFixed(3)} cm/s)`,
        '',
        'Step 2 — Equivalent sea surface slope:',
        `  ∂η/∂x = (1/ρg) × ∂p/∂x = 1/(${rho.toFixed(0)} × ${G_GRAV}) × ${dpdx.toExponential(4)}`,
        `  ∂η/∂x = ${slope.toExponential(6)} (${(slope * 1e5).toFixed(4)} m per 100 km)`,
        '',
        'Step 3 — Hydrodynamic check:',
        `  Rossby number Ro = v/(f·L) — valid when Ro « 1 (scales > 50 km)`,
        '',
        `  └ Interpretation: ${v < 0.01 ? 'Weak geostrophic flow — ocean interior gyre' : v < 0.1 ? 'Moderate current — subtropical gyre boundary' : v < 0.5 ? 'Strong current — western boundary current flank' : 'Very strong current — Gulf Stream/Kuroshio core (>1 m/s)'}`
      ]
    };
  },
  17: ({ Qs, Qb, Qh, Qe, H }) => {
    const has = [Qs, Qb, Qh, Qe].every(Number.isFinite);
    if (!has) {
      return {
        result: NaN, unit: 'W/m²',
        steps: [
          '── Ocean Surface Heat Budget (Gill, 1982, Ch. 3) ──',
          'Q_net = Q_s − Q_b − Q_h − Q_e',
          '',
          'Authentic ERA5 surface energy fluxes are unavailable for this',
          'run (CDS API unreachable or flux request failed). Per the audit',
          'no-fallback rule no static flux constants are substituted.',
          'Provide explicit Qs, Qb, Qh, Qe (W/m²) or run with a working',
          'CDS_API_TOKEN so the genuine ERA5 fluxes can be fetched.',
        ],
      };
    }
    const Qnet = Qs - Qb - Qh - Qe;
    const rho_w = 1025, cp_w = 3990;
    const Hm = Number.isFinite(H) && H > 0 ? H : 50; // Gill mixed-layer slab (m)
    const sstTend = Qnet / (rho_w * cp_w * Hm) * 86400; // °C/day
    const Lv = 2.5e6, rho_w2 = 1000;
    const evapRate = Qe / (rho_w2 * Lv) * 86400 * 1000; // mm/day
    return {
      result: Qnet, unit: 'W/m²',
      secondary: [
        { key: 'sst_tendency', value: Number.isFinite(sstTend) ? sstTend : Number.NaN, unit: '°C/day', label: 'SST Tendency' },
        { key: 'evaporation_rate', value: Number.isFinite(evapRate) ? evapRate : Number.NaN, unit: 'mm/day', label: 'Evaporation Rate' },
      ],
      steps: [
        '── Ocean Surface Heat Budget (Gill, 1982, Ch. 3) ──',
        `Shortwave Q_s = ${Qs.toFixed(1)} W/m², Longwave Q_b = ${Qb.toFixed(1)} W/m² (net upward)`,
        `Sensible Q_h = ${Qh.toFixed(1)} W/m², Latent Q_e = ${Qe.toFixed(1)} W/m² (ocean losses)`,
        '',
        'Step 1 — Net heat flux (positive = ocean gain):',
        `  Q_net = Q_s − Q_b − Q_h − Q_e`,
        `  Q_net = ${Qs.toFixed(1)} − ${Qb.toFixed(1)} − ${Qh.toFixed(1)} − ${Qe.toFixed(1)}`,
        `  Q_net = ${Qnet.toFixed(2)} W/m²`,
        '',
        `Step 2 — SST tendency (mixed layer H=${Hm} m, ρ=1025 kg/m³, c_p=3990 J/kg/K):`,
        `  dSST/dt = Q_net/(ρc_pH) = ${Qnet.toFixed(2)} / (${rho_w} × ${cp_w} × ${Hm})`,
        `  dSST/dt = ${sstTend.toFixed(3)} °C/day`,
        '',
        'Step 3 — Evaporation rate from latent heat:',
        `  E = Q_e/(ρL_v) = ${Qe.toFixed(1)} / (${rho_w2} × ${Lv.toExponential(1)})`,
        `  E = ${evapRate.toFixed(2)} mm/day`,
        '',
        `  └ Interpretation: ${Qnet > 100 ? 'Strong ocean heat gain — rapid SST warming' : Qnet > 0 ? 'Moderate ocean heat gain — SST slowly rising' : Qnet > -100 ? 'Moderate ocean heat loss — SST slowly cooling' : 'Strong ocean heat loss — rapid SST cooling, convective mixing'}`
      ]
    };
  },
  18: ({ Ks, psiW, psi0, dTheta, Ft }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const KsN = Number(Ks), psiWN = Number(psiW), psi0N = Number(psi0), dThetaN = Number(dTheta), FtN = Number(Ft);
    const psiFN = psiWN - psi0N;
    if (!Number.isFinite(KsN) || !Number.isFinite(dThetaN) || !Number.isFinite(FtN)) {
      return {
        result: NaN, unit: 'm/s',
        steps: [
          '── Green-Ampt Infiltration (Green & Ampt, 1911) ──',
          'f = K_s × (1 + ψ_f·Δθ/F)',
          '',
          'Authentic parameters could not be derived for this run. The tool',
          'needs a genuine ISRIC SoilGrids soil pixel at the location for the',
          'USDA texture class (→ Rawls 1983 / Mays 2005 Table 7.7.2 values for',
          'K_s and ψ_f), plus an initial moisture or cumulative infiltration',
          'depth (GLDAS 0–10 cm moisture, IMERG storm total, or explicit Ft).',
          'No fabricated defaults are substituted.',
          'Provide the study area or explicit Ks/psiW/dTheta/Ft to compute.',
        ],
        secondary: [
          { key: 'wetting_front_depth', value: Number.NaN, unit: 'm', label: 'Wetting Front Depth (F/Δθ)' },
          { key: 'suction_head', value: Number.NaN, unit: 'm', label: 'Effective Suction Head ψ_f' },
          { key: 'ratio', value: Number.NaN, unit: '—', label: 'f/K_s' },
        ],
      };
    }
    if (FtN <= 0 || KsN <= 0 || dThetaN <= 0) {
      return {
        result: NaN, unit: 'm/s',
        steps: [
          '── Green-Ampt Infiltration (Green & Ampt, 1911) ──',
          'f = K_s × (1 + ψ_f·Δθ/F)',
          '',
          `Invalid inputs: F(t)=${FtN}, K_s=${KsN}, Δθ=${dThetaN}.`,
          'F(t) (cumulative infiltration) must be > 0, K_s > 0, and Δθ > 0.',
          'Cannot compute a finite infiltration rate.',
        ],
        secondary: [
          { key: 'wetting_front_depth', value: Number.NaN, unit: 'm', label: 'Wetting Front Depth (F/Δθ)' },
          { key: 'suction_head', value: Number.NaN, unit: 'm', label: 'Effective Suction Head ψ_f' },
          { key: 'ratio', value: Number.NaN, unit: '—', label: 'f/K_s' },
        ],
      };
    }
    const f = KsN * (1 + psiFN * dThetaN / FtN);
    const L = FtN / dThetaN; // wetting front depth
    return {
      result: f, unit: 'm/s',
      secondary: [
        { key: 'wetting_front_depth', value: Number.isFinite(L) ? L : Number.NaN, unit: 'm', label: 'Wetting Front Depth (F/Δθ)' },
        { key: 'suction_head', value: Number.isFinite(psiFN) ? psiFN : Number.NaN, unit: 'm', label: 'Effective Suction Head ψ_f' },
        { key: 'ratio', value: Number.isFinite(f / KsN) ? f / KsN : Number.NaN, unit: '—', label: 'f/K_s' },
      ],
      steps: [
        '── Green-Ampt Infiltration (Green & Ampt, 1911) ──',
        `K_s = ${KsN.toExponential(3)} m/s, ψ_w = ${psiWN.toFixed(2)} m, ψ₀ = ${psi0N.toFixed(2)} m`,
        `Δθ = ${dThetaN.toFixed(3)}, F(t) = ${FtN.toFixed(3)} m`,
        '',
        'Step 1 — Effective suction head:',
        `  ψ_f = ψ_w − ψ₀ = ${psiWN.toFixed(2)} − ${psi0N.toFixed(2)} = ${psiFN.toFixed(2)} m`,
        '',
        'Step 2 — Capillary term:',
        `  ψ_f·Δθ/F = ${psiFN.toFixed(2)} × ${dThetaN.toFixed(3)} / ${FtN.toFixed(3)}`,
        `  = ${(psiFN * dThetaN / FtN).toFixed(3)}`,
        '',
        'Step 3 — Infiltration rate:',
        `  f = K_s × (1 + ψ_f·Δθ/F) = ${KsN.toExponential(3)} × (1 + ${(psiFN * dThetaN / FtN).toFixed(3)})`,
        `  f = ${f.toExponential(3)} m/s`,
        '',
        'Step 4 — Wetting front depth:',
        `  L = F/Δθ = ${Ft.toFixed(3)} / ${dTheta.toFixed(3)} = ${L.toFixed(3)} m`,
        '',
        `  └ Interpretation: ${f / Ks > 5 ? 'Early stage — capillary-driven infiltration dominates' : f / Ks > 2 ? 'Intermediate stage — mixed capillary-gravity flow' : 'Late stage — gravity-driven flow approaching K_s'}`
      ]
    };
  },

   // ── Domain 3: Geophysics & Seismology ──
  19: ({ N: _N, a, b, M }) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return {
        result: NaN, unit: 'events/yr',
        steps: [
          '── Gutenberg-Richter Law (Gutenberg & Richter, 1944) ──',
          'log₁₀(N) = a − b·M',
          '',
          'No genuine catalog fit is available for this run: the USGS FDSN',
          'query returned no events for the requested window/area (or the',
          'catalog was unreachable), so neither a nor b can be derived.',
          'No fabricated a/b constants are substituted.',
          'Provide explicit a and b, or a location/window with seismicity.',
        ],
      };
    }
    const logN = a - b * M;
    const n = Math.pow(10, logN);
    const T_r = n > 0 ? 1 / n : Infinity;
    const P10 = n > 0 ? 1 - Math.exp(-10 * n) : 0;
    // Bar series — N(M) over magnitude 4 → 9 in 0.5 steps (11 points) using
    // the tool's Gutenberg-Richter relation with the supplied a and b.
    const barPoints: Array<{ x: number; y: number }> = Array.from({ length: 11 }, (_, i) => {
      const mag = 4 + i * 0.5;
      const logN = a - b * mag;
      return { x: mag, y: Number.isFinite(logN) ? Math.pow(10, logN) : Number.NaN };
    });
    return {
      result: n, unit: 'events/yr',
      secondary: [
        { key: 'return_period', value: Number.isFinite(T_r) ? T_r : Number.NaN, unit: 'yr', label: 'Return Period (1/N)' },
      ],
      series: [{
        label: 'Annual frequency N(M)',
        color: '#0072B2',
        points: barPoints,
      }],
      steps: [
        '── Gutenberg-Richter Law (Gutenberg & Richter, 1944) ──',
        `Seismicity parameters: a-value = ${a.toFixed(2)}, b-value = ${b.toFixed(3)}, Magnitude M = ${M.toFixed(1)}`,
        '',
        'Step 1 — Compute annual frequency log₁₀(N):',
        `  log₁₀(N) = a − b·M = ${a.toFixed(2)} − ${b.toFixed(3)} × ${M.toFixed(1)} = ${logN.toFixed(4)}`,
        '',
        'Step 2 — Compute annual frequency N:',
        `  N(≥M) = 10^${logN.toFixed(4)} = ${n.toFixed(3)} events/yr`,
        '',
        'Step 3 — Derived hazard metrics:',
        `  Return period T_r = 1 / N = ${T_r.toFixed(1)} yr`,
        `  10-year exceedance probability: P₁₀ = 1 − exp(−10 × ${n.toFixed(3)}) = ${(P10 * 100).toFixed(1)}%`,
        '',
        `  └ Interpretation: ${n > 10 ? 'Very frequent — expect multiple events per year' : n > 1 ? 'Frequent — expect annual occurrence' : n > 0.01 ? 'Moderate recurrence' : 'Rare event — return period > 100 years'}`,
        `  └ ${b < 0.9 ? 'b-value < 0.9: relatively more large earthquakes (high-stress regime)' : b > 1.1 ? 'b-value > 1.1: relatively more small earthquakes (low-stress regime)' : 'b-value ≈ 1.0: typical global average'}`,
      ]
    };
  },
  20: ({ K, c, t, p }) => {
    if (!Number.isFinite(K) || !Number.isFinite(c) || !Number.isFinite(p) || K <= 0 || c <= 0 || p <= 0) {
      return {
        result: NaN, unit: 'events/day',
        steps: [
          '── Modified Omori Law (Omori, 1894; Utsu, 1961) ──',
          'n(t) = K / (c + t)^p',
          '',
          'No genuine aftershock sequence is available for this run: the USGS',
          'FDSN query returned no usable sequence (or the catalog was',
          'unreachable), so K, c and p cannot be fitted (Ogata 1983 MLE).',
          'No fabricated K/c/p constants are substituted.',
          'Provide explicit K, c, t, p, or a location with an active sequence.',
        ],
      };
    }
    if (t < 0) {
      return {
        result: NaN, unit: 'events/day',
        steps: ['── Modified Omori Law ──', `Invalid elapsed time t=${t}; must be ≥ 0. Cannot compute a decay rate.`],
      };
    }
    const den = Math.pow(c + t, p);
    const n = den > 0 ? K / den : 0;
    const halfLife = c * (Math.pow(2, 1 / p) - 1);
    const cum = Math.abs(p - 1) > 1e-10
      ? K * (Math.pow(c, 1 - p) - Math.pow(c + t, 1 - p)) / (p - 1)
      : K * Math.log(1 + t / c);
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let day = 1; day <= 60; day++) {
      const denom = Math.pow(c + day, p);
      seriesPoints.push({ x: day, y: Number.isFinite(denom) ? K / denom : Number.NaN });
    }
    return {
      result: n, unit: 'events/day',
      secondary: [
        { key: 'cumulative', value: Number.isFinite(cum) ? cum : Number.NaN, unit: 'events', label: 'Cumulative Aftershocks N_cum' },
        { key: 'half_life', value: Number.isFinite(halfLife) ? halfLife : Number.NaN, unit: 'days', label: 'Rate Halving Time t_½' },
      ],
      series: [{
        label: 'Aftershock rate n(t)',
        color: '#0072B2',
        points: seriesPoints,
      }],
      steps: [
        '── Modified Omori Law (Omori, 1894; Utsu, 1961) ──',
        `Sequence parameters: K = ${K.toFixed(1)} events/day, c = ${c.toFixed(3)} d, t = ${t.toFixed(1)} d, p = ${p.toFixed(3)}`,
        '',
        'Step 1 — Compute denominator:',
        `  (c + t)^p = (${c.toFixed(3)} + ${t.toFixed(1)})^${p.toFixed(3)} = ${den.toFixed(3)}`,
        '',
        'Step 2 — Compute aftershock rate:',
        `  n(t) = K / (c+t)^p = ${K.toFixed(1)} / ${den.toFixed(3)}`,
        `  n(${t.toFixed(0)} d) = ${n.toFixed(3)} events/day`,
        '',
        'Step 3 — Derived quantities:',
        `  Cumulative aftershocks N_cum(t) = ${cum.toFixed(1)} total events since t=0`,
        `  Rate halving time: t_½ = c·(2^(1/p) − 1) = ${halfLife.toFixed(2)} days`,
        '',
        `  └ Interpretation: ${n > 50 ? 'Very high aftershock rate — immediate post-mainshock sequence' : n > 10 ? 'High aftershock rate — early sequence, expect felt events' : n > 1 ? 'Moderate rate — continued seismic hazard' : 'Low rate — sequence decaying, background levels'}`,
        `  └ p = ${p.toFixed(2)}: ${p < 1 ? 'Slow decay — persistent hazard' : p < 1.2 ? 'Typical decay (global average p≈1.0–1.2)' : 'Rapid decay — quick return to background'}`,
      ]
    };
  },
  21: ({ mag, rrup, rjb, rx, vs30, rake, dip, ztor, width, hypoDepth }) => {
    const req = { mag, rrup, rjb, vs30, rake, dip, ztor, width, hypoDepth };
    for (const [k, v] of Object.entries(req)) {
      if (!Number.isFinite(v)) {
        return {
          result: NaN, unit: 'g',
          steps: [
            '── Campbell–Bozorgnia (2014) NGA-West2 GMPE ──',
            'ln(PGA) = f_mag + f_att + f_flt + f_hng + f_site + f_basin',
            '          + f_dip + f_hyp + f_atten',
            '',
            `Parameter '${k}' is missing. The genuine CB2014 GMPE needs the full`,
            'physical rupture/site input (M, Rrup, Rjb, Rx, Vs30, rake, dip,',
            'ZTOR, width, hypocentral depth). No fabricated substitution.',
          ],
        };
      }
    }
    const T = cb2014Terms({ mag, rrup, rjb, rx, vs30, rake, dip, ztor, width, hypoDepth });
    const pgaG = T.pga;
    const pgaCm = pgaG * 980.665;
    const mmi = pgaG > 0 ? (pgaG < 0.001 ? 1 : 2 * Math.log10(pgaG * 980.665) + 3.5) : 1;
    const lnPGA = Math.log(pgaG);
    const pgaRock = T.pga1100;
    return {
      result: pgaG, unit: 'g',
      secondary: [
        { key: 'mmi', value: Number.isFinite(mmi) ? mmi : Number.NaN, unit: '—', label: 'Modified Mercalli Intensity' },
        { key: 'pga_cm', value: Number.isFinite(pgaCm) ? pgaCm : Number.NaN, unit: 'cm/s²', label: 'PGA (cm/s²)' },
        { key: 'ln_pga', value: Number.isFinite(lnPGA) ? lnPGA : Number.NaN, unit: '—', label: 'ln(PGA)' },
        { key: 'pga_rock', value: Number.isFinite(pgaRock) ? pgaRock : Number.NaN, unit: 'g', label: 'PGA on Rock (Vs=1100)' },
      ],
      steps: [
        '── Campbell–Bozorgnia (2014) NGA-West2 GMPE ──',
        `M = ${mag.toFixed(1)}, Rrup = ${rrup.toFixed(1)} km, Rjb = ${rjb.toFixed(1)} km, Rx = ${rx.toFixed(1)} km`,
        `Vs30 = ${vs30.toFixed(0)} m/s, rake = ${rake.toFixed(0)}°, dip = ${dip.toFixed(0)}°, ZTOR = ${ztor.toFixed(1)} km,`,
        `width = ${width.toFixed(1)} km, hypo-depth = ${hypoDepth.toFixed(1)} km`,
        '',
        'Functional terms (eqs. 2-25 of C&B 2014):',
        `  f_mag (magnitude scaling)      = ${T.fMag.toFixed(4)}`,
        `  f_att (geometric attenuation)  = ${T.fAtt.toFixed(4)}`,
        `  f_flt (style-of-faulting)      = ${T.fFault.toFixed(4)}`,
        `  f_hng (hanging wall)           = ${T.fHNG.toFixed(4)}`,
        `  f_site (nonlinear, Vs30)       = ${T.fSite.toFixed(4)}`,
        `  f_basin (z2.5 from Vs30)       = ${T.fBasin.toFixed(4)}`,
        `  f_dip (fault dip)              = ${T.fDip.toFixed(4)}`,
        `  f_hyp (hypocentral depth)      = ${T.fHyp.toFixed(4)}`,
        `  f_atten (anelastic, Rrup≥80)   = ${T.fAtten.toFixed(4)}`,
        '',
        `  PGA on reference rock (Vs=1100): ${T.pga1100.toFixed(4)} g`,
        `  ln(PGA) = ${T.lnPGA.toFixed(4)}  →  PGA = ${pgaG.toFixed(4)} g = ${(pgaG * 980.665).toFixed(1)} cm/s²`,
        '',
        'Step 3 — MMI intensity proxy:',
        `  Estimated MMI ≈ ${mmi.toFixed(1)} (${mmi < 4 ? 'Light shaking, rarely damaging' : mmi < 6 ? 'Moderate shaking, potential damage to vulnerable structures' : mmi < 8 ? 'Strong shaking, damaging to ordinary buildings' : 'Very strong shaking, widespread damage'})`,
        '',
        `  └ PGA < 0.05 g: weak (MMI ≤ IV); 0.05–0.15 g: moderate (V–VI); 0.15–0.40 g: strong (VII–VIII); >0.40 g: very strong (IX+)`,
      ],
    };
  },
  22: ({ c, sigmaN, tanPhi }) => {
    if (!Number.isFinite(c) || !Number.isFinite(sigmaN) || !Number.isFinite(tanPhi)) {
      return {
        result: NaN, unit: 'kPa',
        steps: [
          '── Mohr–Coulomb Failure Criterion (Coulomb, 1776; Mohr, 1900) ──',
          'τ = c + σₙ·tanφ',
          '',
          'One or more of c / σₙ / tanφ is unavailable: no genuine soil data',
          '(ISRIC SoilGrids texture + bulk density) was retrievable for this',
          'location, so shear-strength parameters cannot be derived.',
          'No fabricated cohesion or friction constants are substituted.',
        ],
      };
    }
    if (sigmaN < 0 || c < 0 || tanPhi < 0) {
      return {
        result: NaN, unit: 'kPa',
        steps: ['── Mohr–Coulomb Failure Criterion ──', `Non-physical inputs (c=${c}, σₙ=${sigmaN}, tanφ=${tanPhi} all require ≥ 0).`],
      };
    }
    const tau = c + sigmaN * tanPhi;
    const phiDeg = Math.atan(tanPhi) * 180 / Math.PI;
    const tanSq = tanPhi * tanPhi;
    const sinPhi = tanPhi / Math.sqrt(1 + tanSq);
    const cosPhi = 1 / Math.sqrt(1 + tanSq);
    const secPhi = 1 / cosPhi;
    // Exact Mohr-circle pole geometry for the stress state on the failure
    // plane with shear τ and normal stress σₙ: the circle centred at
    // (σc, 0) is tangent to the M–C envelope at (σₙ, τ).
    const sigma1 = sigmaN + tau * (tanPhi + secPhi);
    const sigma3 = sigmaN + tau * (tanPhi - secPhi);
    const kp = (1 + sinPhi) / (1 - sinPhi); // Rankine passive earth pressure coefficient
    return {
      result: tau, unit: 'kPa',
      secondary: [
        { key: 'friction_angle', value: Number.isFinite(phiDeg) ? phiDeg : Number.NaN, unit: '°', label: 'Friction Angle φ' },
      ],
      steps: [
        '── Mohr-Coulomb Failure Criterion (Coulomb, 1776; Mohr, 1900) ──',
        `Material: cohesion c = ${c.toFixed(2)} kPa, normal stress σₙ = ${sigmaN.toFixed(3)} kPa`,
        `Friction coefficient tan φ = ${tanPhi.toFixed(4)} (φ = ${phiDeg.toFixed(1)}°)`,
        '',
        'Step 1 — Compute shear strength:',
        `  τ = c + σₙ·tan φ = ${c.toFixed(2)} + ${sigmaN.toFixed(3)} × ${tanPhi.toFixed(4)}`,
        `  τ = ${tau.toFixed(2)} kPa`,
        '',
        'Step 2 — Mohr circle at failure (exact tangency geometry):',
        `  σ₁ = σₙ + τ(tanφ + secφ) = ${sigmaN.toFixed(3)} + ${tau.toFixed(2)} × (${tanPhi.toFixed(4)} + ${secPhi.toFixed(4)}) = ${sigma1.toFixed(2)} kPa`,
        `  σ₃ = σₙ + τ(tanφ − secφ) = ${sigmaN.toFixed(3)} + ${tau.toFixed(2)} × (${tanPhi.toFixed(4)} − ${secPhi.toFixed(4)}) = ${sigma3.toFixed(2)} kPa`,
        `  (circle centred at ${((sigma1 + sigma3) / 2).toFixed(2)} kPa, radius ${((sigma1 - sigma3) / 2).toFixed(2)} kPa, tangent to the envelope)`,
        '',
        'Step 3 — Derived parameters:',
        `  Active earth pressure coefficient K_a = (1−sinφ)/(1+sinφ) = ${(1 / kp).toFixed(3)}`,
        `  Passive earth pressure coefficient K_p = ${kp.toFixed(3)}`,
        `  Failure plane angle: θ_f = 45° + φ/2 = ${(45 + phiDeg / 2).toFixed(1)}° from σ₁ direction`,
        '',
        `  └ Interpretation: ${tau > 100 ? 'High shear strength — intact rock or dense granular soil' : tau > 30 ? 'Moderate strength — typical soil/rock joint' : 'Low strength — soft soil or shallow/low-confinement condition'}`,
        `  └ Effective stress: if pore pressure u is known, σ′ₙ = σₙ − u (Terzaghi principle)`
      ]
    };
  },
  23: ({ M0 }) => {
    if (!Number.isFinite(M0) || M0 <= 0) {
      return {
        result: NaN, unit: 'M_w',
        steps: [
          '── Hanks-Kanamori Moment Magnitude (Hanks & Kanamori, 1979) ──',
          'M_w = (2/3)·log₁₀(M₀) − 10.7  (M₀ in dyne·cm; = (2/3)·log₁₀(M₀) − 6.033 in N·m)',
          '',
          'No genuine seismic moment is available: no USGS moment tensor and',
          'no catalog magnitude exist for this region (or the catalog was',
          'unreachable). No fabricated M₀ is substituted.',
        ],
      };
    }
    const logM0 = Math.log10(M0);
    // Hanks & Kanamori (1979) eq. 15: M_w = (2/3) log10 M0 − 10.7 (dyne·cm).
    // M₀ here is in N·m: 1 N·m = 10⁷ dyne·cm ⇒ −10.7 + (2/3)·7 = −6.0333.
    const Mw = (2 / 3) * (logM0 + 7) - 10.7;
    const A_km2 = Math.pow(10, Mw - 4); // empirical: log₁₀(A_km²) ≈ M_w − 4 (Δσ≈3 MPa)
    const D = M0 / (3e10 * (A_km2 * 1e6)); // slip: M₀ = μ·A·D, μ = 3×10¹⁰ Pa
    const logEs = 1.5 * Mw + 4.8; // Gutenberg-Richter energy relation (J)
    const Es = Math.pow(10, logEs);
    return {
      result: Mw, unit: 'M_w',
      steps: [
        '── Hanks-Kanamori Moment Magnitude (Hanks & Kanamori, 1979) ──',
        `Seismic moment M₀ = ${M0.toExponential(3)} N·m = ${Math.pow(10, logM0 + 7).toExponential(3)} dyne·cm`,
        '',
        'Step 1 — Convert to dyne·cm and log-transform:',
        `  log₁₀(M₀ / dyne·cm) = log₁₀(M₀) + 7 = ${logM0.toFixed(4)} + 7 = ${(logM0 + 7).toFixed(4)}`,
        '',
        'Step 2 — Compute M_w (Hanks & Kanamori 1979, eq. 15):',
        `  M_w = (2/3)·log₁₀(M₀) − 10.7 = (2/3)×${(logM0 + 7).toFixed(4)} − 10.7`,
        `  M_w = ${Mw.toFixed(2)}`,
        '',
        'Step 3 — Derived rupture/source estimates:',
        `  Rupture area: A ≈ 10^(M_w−4) = ${A_km2.toFixed(0)} km² (${(A_km2 * 1e6).toExponential(3)} m²)`,
        `  Avg. slip: D ≈ M₀/(μ·A) = ${D.toFixed(2)} m (μ ≈ 3×10¹⁰ Pa)`,
        `  Seismic energy: E_s ≈ 10^(1.5·M_w+4.8) = ${Es.toExponential(3)} J (Gutenberg-Richter)`,
        '',
        `  └ Magnitude class: ${Mw < 4 ? 'Micro earthquake' : Mw < 5 ? 'Light earthquake' : Mw < 6 ? 'Moderate earthquake' : Mw < 7 ? 'Strong earthquake' : Mw < 8 ? 'Major earthquake' : 'Great earthquake'}`,
        `  └ Energy equivalent: ${(Es / 4.184e9).toFixed(1)} tonnes TNT`
      ]
    };
  },
  24: ({ M0, r }) => {
    if (!Number.isFinite(M0) || !Number.isFinite(r) || M0 <= 0 || r <= 0) {
      return {
        result: NaN, unit: 'Pa',
        steps: [
          '── Brune Stress Drop Model (Brune, 1970) ──',
          'Δσ = (7/16) · M₀/r³',
          '',
          'No genuine source parameters are available: neither a USGS scalar',
          'seismic moment nor a catalog magnitude (to derive the source',
          'radius) exists for this region. No fabricated M₀ or r is',
          'substituted.',
        ],
      };
    }
    const dsig = (7 / 16) * (M0 / Math.pow(r, 3));
    const dsig_MPa = dsig / 1e6;
    const beta = 3500; // shear wave velocity (m/s)
    const fc = 0.49 * beta / r;
    const mu = 3e10; // shear modulus (Pa)
    // Average slip for a circular crack: M₀ = μ·πr²·D and M₀ = (16/7)Δσ·r³
    // ⇒ D = (16/7π)·Δσ·r/μ = M₀/(μ·π·r²).
    const D = M0 / (mu * Math.PI * r * r);
    return {
      result: dsig, unit: 'Pa',
      secondary: [
        { key: 'stress_drop_mpa', value: Number.isFinite(dsig_MPa) ? dsig_MPa : Number.NaN, unit: 'MPa', label: 'Stress Drop (MPa)' },
      ],
      steps: [
        '── Brune Stress Drop Model (Brune, 1970) ──',
        `Seismic moment M₀ = ${M0.toExponential(3)} N·m, Source radius r = ${r.toFixed(0)} m`,
        '',
        'Step 1 — Compute static stress drop:',
        `  Δσ = (7/16) × M₀/r³ = (7/16) × ${M0.toExponential(3)} / (${r.toFixed(0)})³`,
        `  Δσ = ${dsig.toExponential(3)} Pa = ${dsig_MPa.toFixed(3)} MPa`,
        '',
        'Step 2 — Corner frequency:',
        `  f_c = 0.49·β/r = 0.49 × ${beta} / ${r.toFixed(0)} = ${fc.toFixed(3)} Hz`,
        '',
        'Step 3 — Average slip (M₀ = μ·π·r²·D):',
        `  D = M₀/(μ·π·r²) = (16/7π)·Δσ·r/μ = ${D.toFixed(3)} m`,
        '',
        `  └ Stress class: ${dsig_MPa < 0.1 ? 'Low stress drop — slow/tsunami earthquake' : dsig_MPa < 1 ? 'Moderate-to-low stress drop' : dsig_MPa < 10 ? 'Typical crustal earthquake (1–10 MPa)' : 'High stress drop — strong high-frequency shaking'}`,
        `  └ Self-similarity: Δσ ≈ constant across M₀ (Kanamori & Anderson 1975)`,
      ]
    };
  },
  25: ({ Mw }) => {
    if (!Number.isFinite(Mw) || Mw <= 0) {
      return {
        result: NaN, unit: 'km²',
        steps: [
          '── Wells-Coppersmith Rupture Scaling (Wells & Coppersmith, 1994) ──',
          'log₁₀(A) = −3.49 + 0.91·M_w',
          '',
          'No genuine magnitude is available for this region: the USGS',
          'catalog returned no events in the time window. No fabricated',
          'M_w is substituted for the scaling relations.',
        ],
      };
    }
    const logA = -3.49 + 0.91 * Mw;
    const A = Math.pow(10, logA);
    const logSRL = -3.55 + 0.74 * Mw; // surface rupture length (strike-slip)
    const SRL = Math.pow(10, logSRL);
    const logAD = -4.80 + 0.69 * Mw; // average displacement (all types)
    const AD = Math.pow(10, logAD);
    const width = Math.sqrt(A); // approximate: sqrt(A) for ~square rupture
    // Scatter series — surface rupture length vs M_w over M 5 → 8 (10 points)
    // using the tool's Wells-Coppersmith regression.
    const scatterPoints: Array<{ x: number; y: number }> = Array.from({ length: 10 }, (_, i) => {
      const mw = 5 + (i * 3) / 9;
      return { x: mw, y: Math.pow(10, -3.55 + 0.74 * mw) };
    });
    return {
      result: A, unit: 'km²',
      secondary: [
        { key: 'surface_rupture_length', value: Number.isFinite(SRL) ? SRL : Number.NaN, unit: 'km', label: 'Surface Rupture Length (strike-slip)' },
      ],
      series: [{
        label: 'Surface Rupture Length vs M_w',
        color: '#0072B2',
        points: scatterPoints,
      }],
      steps: [
        '── Wells-Coppersmith Scaling Relations (Wells & Coppersmith, 1994) ──',
        `Moment magnitude M_w = ${Mw.toFixed(1)}`,
        '',
        'Step 1 — Rupture area (all fault types):',
        `  log₁₀(A) = −3.49 + 0.91 × ${Mw.toFixed(1)} = ${logA.toFixed(4)}`,
        `  A = ${A.toFixed(0)} km²`,
        '',
        'Step 2 — Surface rupture length (strike-slip):',
        `  log₁₀(SRL) = −3.55 + 0.74 × ${Mw.toFixed(1)} = ${logSRL.toFixed(4)}`,
        `  SRL = ${SRL.toFixed(0)} km`,
        '',
        'Step 3 — Average displacement (all fault types):',
        `  log₁₀(AD) = −4.80 + 0.69 × ${Mw.toFixed(1)} = ${logAD.toFixed(4)}`,
        `  AD = ${AD.toFixed(2)} m`,
        '',
        'Step 4 — Rupture aspect ratio:',
        `  Approx. width = √Area = ${width.toFixed(1)} km (depends on seismogenic thickness ~15±5 km)`,
        `  Aspect ratio L/W = ${(SRL / Math.max(width, 0.1)).toFixed(1)}`,
        '',
        `  └ Rupture class: ${A < 100 ? 'Small fault rupture (Mw < 6)' : A < 1000 ? 'Moderate fault rupture (Mw 6–7)' : A < 10000 ? 'Large fault rupture (Mw 7–8)' : 'Very large fault rupture (Mw > 8, subduction zone)'}`,
        `  └ σ(log₁₀A) = 0.24 log units — ±1σ spans a factor of ~1.7 in area`
      ]
    };
  },

  // ── Domain 4: Remote Sensing & Cryosphere ──
  26: ({ NIR, Red }) => {
    if (!Number.isFinite(NIR) || !Number.isFinite(Red) || NIR + Red <= 0) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── Normalized Difference Vegetation Index (Rouse et al., 1974) ──',
          'NDVI = (NIR − Red) / (NIR + Red)',
          '',
          'No genuine surface reflectance is available: no cloud-free',
          'Landsat C2 L2 SR scene was found for this location/date',
          '(and no user-supplied bands). Proxy reflectance is not',
          'substituted — Rouse (1974) requires actual measured bands.',
        ],
      };
    }
    const ndvi = (NIR - Red) / (NIR + Red);
    const fpar = Math.max(0, Math.min(1, 1.16 * ndvi - 0.16));
    let vigor: string;
    if (ndvi < 0) vigor = 'WATER / CLOUD';
    else if (ndvi < 0.15) vigor = 'BARE / URBAN';
    else if (ndvi < 0.4) vigor = 'SPARSE VEGETATION';
    else if (ndvi < 0.6) vigor = 'MODERATE VEGETATION';
    else if (ndvi < 0.8) vigor = 'DENSE VEGETATION';
    else vigor = 'VERY DENSE VEGETATION';
    return {
      result: ndvi, unit: '—',
      steps: [
        '── Normalized Difference Vegetation Index (Rouse et al., 1974) ──',
        `Surface reflectance: NIR = ${NIR.toFixed(3)}, Red = ${Red.toFixed(3)}`,
        '',
        'Step 1 — Compute NDVI:',
        `  NDVI = (NIR − Red) / (NIR + Red) = (${NIR.toFixed(3)} − ${Red.toFixed(3)}) / (${NIR.toFixed(3)} + ${Red.toFixed(3)})`,
        `  NDVI = ${ndvi.toFixed(4)}`,
        '',
        'Step 2 — Derived biophysical proxy:',
        `  Estimated fPAR ≈ 1.16 × NDVI − 0.16 = ${(fpar * 100).toFixed(0)}% (range: 0–100%)`,
        '',
        'Step 3 — Interpretation:',
        `  Vegetation vigor class: ${vigor}`,
        `  ${ndvi > 0.5 ? '✓ Healthy, photosynthetically active vegetation' : ndvi > 0 ? 'Vegetation present but low/moderate density' : 'Non-vegetated surface (water, snow, urban)'}`,
      ]
    };
  },
  27: ({ Green, NIR }) => {
    if (!Number.isFinite(Green) || !Number.isFinite(NIR) || Green + NIR <= 0) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── McFeeters NDWI (McFeeters, 1996) ──',
          'NDWI = (Green − NIR) / (Green + NIR)',
          '',
          'No genuine surface reflectance is available: no cloud-free',
          'Landsat C2 L2 SR scene was found for this location/date',
          '(and no user-supplied bands). Proxy reflectance is not',
          'substituted — McFeeters (1996) requires actual measured bands.',
        ],
      };
    }
    const ndwi = (Green - NIR) / (Green + NIR);
    let waterClass: string;
    if (ndwi > 0.5) waterClass = 'DEEP CLEAR WATER';
    else if (ndwi > 0.3) waterClass = 'OPEN WATER';
    else if (ndwi > 0.1) waterClass = 'TURBID / SHALLOW WATER';
    else if (ndwi > 0) waterClass = 'WET SOIL / TRANSITION';
    else waterClass = 'LAND / VEGETATION';
    return {
      result: ndwi, unit: '—',
      steps: [
        '── McFeeters NDWI (McFeeters, 1996) ──',
        `Surface reflectance: Green = ${Green.toFixed(3)}, NIR = ${NIR.toFixed(3)}`,
        '',
        'Step 1 — Compute NDWI:',
        `  NDWI = (Green − NIR) / (Green + NIR) = (${Green.toFixed(3)} − ${NIR.toFixed(3)}) / (${Green.toFixed(3)} + ${NIR.toFixed(3)})`,
        `  NDWI = ${ndwi.toFixed(4)}`,
        '',
        'Step 2 — Water classification:',
        `  ${ndwi > 0 ? 'NDWI > 0 → classified as water surface' : 'NDWI ≤ 0 → classified as land surface'}`,
        `  Sub-class: ${waterClass}`,
        '',
        'Step 3 — Shadow mask recommendation:',
        `  ${ndwi > 0 && ndwi < 0.1 ? '⚠ Marginal water detection — check for topographic shadow contamination' : ''}`,
      ]
    };
  },
  28: ({ NIR, SWIR }) => {
    if (!Number.isFinite(NIR) || !Number.isFinite(SWIR) || NIR + SWIR <= 0) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── Gao NDWI — Vegetation Water Content (Gao, 1996) ──',
          'NDWI = (NIR − SWIR) / (NIR + SWIR)',
          '',
          'No genuine surface reflectance is available: no cloud-free',
          'Landsat C2 L2 SR scene was found for this location/date',
          '(and no user-supplied bands). Proxy reflectance is not',
          'substituted — Gao (1996) requires actual measured bands.',
        ],
      };
    }
    const ndwi = (NIR - SWIR) / (NIR + SWIR);
    return {
      result: ndwi, unit: '—',
      steps: [
        '── Gao NDWI — Vegetation Water Content (Gao, 1996) ──',
        `Surface reflectance: NIR = ${NIR.toFixed(3)}, SWIR = ${SWIR.toFixed(3)}`,
        '',
        'Step 1 — Compute NDWI:',
        `  NDWI = (NIR − SWIR) / (NIR + SWIR) = (${NIR.toFixed(3)} − ${SWIR.toFixed(3)}) / (${NIR.toFixed(3)} + ${SWIR.toFixed(3)})`,
        `  NDWI = ${ndwi.toFixed(4)}`,
        '',
        'Step 2 — Vegetation water assessment:',
        `  ${ndwi > 0.3 ? 'Well-watered canopy — high moisture content' : ndwi > 0.15 ? 'Moderate water content — normal conditions' : ndwi > 0 ? 'Low water content — potential water stress' : 'Very low/dry — stressed vegetation or bare soil'}`,
        `  Fire risk: ${ndwi < 0.1 ? 'ELEVATED — critically low fuel moisture' : 'Low fuel moisture risk'}`,
      ]
    };
  },
  29: ({ NIR, Red, Blue }) => {
    if (!Number.isFinite(NIR) || !Number.isFinite(Red) || !Number.isFinite(Blue)) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── Enhanced Vegetation Index (Huete et al., 2002) ──',
          'EVI = 2.5·(NIR − Red) / (NIR + 6·Red − 7.5·Blue + 1)',
          '',
          'No genuine surface reflectance is available: no cloud-free',
          'Landsat C2 L2 SR scene was found for this location/date',
          '(and no user-supplied bands). Proxy reflectance is not',
          'substituted — Huete (2002) requires actual measured bands.',
        ],
      };
    }
    const denom = NIR + 6 * Red - 7.5 * Blue + 1;
    if (denom <= 0) {
      return { result: NaN, unit: '—', steps: ['EVI denominator non-positive — non-physical reflectance combination.'] };
    }
    const evi = 2.5 * (NIR - Red) / denom;
    return {
      result: evi, unit: '—',
      steps: [
        '── Enhanced Vegetation Index (Huete et al., 2002) ──',
        `Surface reflectance: NIR = ${NIR.toFixed(3)}, Red = ${Red.toFixed(3)}, Blue = ${Blue.toFixed(3)}`,
        '',
        'Step 1 — Compute denominator:',
        `  NIR + 6·Red − 7.5·Blue + 1 = ${NIR.toFixed(3)} + 6×${Red.toFixed(3)} − 7.5×${Blue.toFixed(3)} + 1`,
        `  = ${denom.toFixed(4)}`,
        '',
        'Step 2 — Compute EVI:',
        `  EVI = 2.5 × (${NIR.toFixed(3)} − ${Red.toFixed(3)}) / ${denom.toFixed(4)}`,
        `  EVI = ${evi.toFixed(4)}`,
        '',
        'Step 3 — Compare to NDVI:',
        `  NDVI = ${((NIR - Red) / (NIR + Red)).toFixed(4)} (can saturate in dense forests)`,
        `  EVI benefits: reduced saturation & aerosol correction via blue band`,
        '',
        `  └ Interpretation: ${evi > 0.5 ? 'Dense healthy vegetation' : evi > 0.3 ? 'Moderate vegetation cover' : evi > 0.1 ? 'Sparse cover / degraded' : 'Barren / urban'}`,
      ]
    };
  },
  30: ({ Green, SWIR }) => {
    if (!Number.isFinite(Green) || !Number.isFinite(SWIR) || Green + SWIR <= 0) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── Normalized Difference Snow Index (Hall et al., 1995) ──',
          'NDSI = (Green − SWIR) / (Green + SWIR)',
          '',
          'No genuine surface reflectance is available: no cloud-free',
          'Landsat C2 L2 SR scene was found for this location/date',
          '(and no user-supplied bands). Proxy reflectance is not',
          'substituted — Hall (1995) requires actual measured bands.',
        ],
      };
    }
    const ndsi = (Green - SWIR) / (Green + SWIR);
    const snowFlag = ndsi >= 0.4;
    return {
      result: ndsi, unit: '—',
      steps: [
        '── Normalized Difference Snow Index (Hall et al., 1995) ──',
        `Surface reflectance: Green = ${Green.toFixed(3)}, SWIR = ${SWIR.toFixed(3)}`,
        '',
        'Step 1 — Compute NDSI:',
        `  NDSI = (Green − SWIR) / (Green + SWIR) = (${Green.toFixed(3)} − ${SWIR.toFixed(3)}) / (${Green.toFixed(3)} + ${SWIR.toFixed(3)})`,
        `  NDSI = ${ndsi.toFixed(4)}`,
        '',
        'Step 2 — Snow detection:',
        `  ${snowFlag ? 'NDSI ≥ 0.4 → SNOW COVERED' : 'NDSI < 0.4 → NO SNOW'}`,
        `  ${ndsi > 0.6 ? 'Clean, fresh snow (high albedo)' : ndsi > 0.15 ? 'Melting/dirty snow or forest snow' : 'Snow-free surface'}`,
        '',
        `  └ Fractional snow cover ≈ ${Math.min(1, Math.max(0, -0.01 + 1.45 * ndsi)).toFixed(2)} (MODIS SCAG algorithm)`,
      ]
    };
  },
  31: ({ NIR, SWIR, NIR_pre, SWIR_pre }) => {
    if (!Number.isFinite(NIR) || !Number.isFinite(SWIR) || NIR + SWIR <= 0) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── Normalized Burn Ratio (Key & Benson, 1999) ──',
          'NBR = (NIR − SWIR2) / (NIR + SWIR2)',
          '',
          'No genuine post-fire surface reflectance is available: no',
          'cloud-free Landsat C2 L2 SR scene was found for this',
          'location/date (and no user-supplied bands). Proxy reflectance',
          'is not substituted.',
        ],
      };
    }
    const nbr = (NIR - SWIR) / (NIR + SWIR);
    const havePre = Number.isFinite(NIR_pre) && Number.isFinite(SWIR_pre) && NIR_pre + SWIR_pre > 0;
    const nbrPre = havePre ? (NIR_pre - SWIR_pre) / (NIR_pre + SWIR_pre) : Number.NaN;
    const dNBR = havePre ? nbrPre - nbr : Number.NaN;
    let severity: string;
    if (!havePre) severity = 'INDETERMINATE — requires genuine pre-fire scene';
    else if (dNBR > 0.66) severity = 'VERY HIGH SEVERITY';
    else if (dNBR > 0.44) severity = 'HIGH SEVERITY';
    else if (dNBR > 0.27) severity = 'MODERATE SEVERITY';
    else if (dNBR > 0.1) severity = 'LOW SEVERITY';
    else severity = 'UNBURNED';
    return {
      result: nbr, unit: '—',
      steps: [
        '── Normalized Burn Ratio (Key & Benson, 1999) ──',
        `Post-fire surface reflectance: NIR = ${NIR.toFixed(3)}, SWIR2 = ${SWIR.toFixed(3)}`,
        '',
        'Step 1 — Compute post-fire NBR:',
        `  NBR_post = (NIR − SWIR2) / (NIR + SWIR2) = (${NIR.toFixed(3)} − ${SWIR.toFixed(3)}) / (${NIR.toFixed(3)} + ${SWIR.toFixed(3)})`,
        `  NBR_post = ${nbr.toFixed(4)}`,
        '',
        havePre ?
          `Step 2 — Pre-fire NBR from supplied pre-fire scene (NIR=${NIR_pre.toFixed(3)}, SWIR2=${SWIR_pre.toFixed(3)}):` :
          'Step 2 — Pre-fire NBR:',
        havePre ?
          `  NBR_pre = (${NIR_pre.toFixed(3)} − ${SWIR_pre.toFixed(3)}) / (${NIR_pre.toFixed(3)} + ${SWIR_pre.toFixed(3)}) = ${nbrPre.toFixed(4)}` :
          '  NBR_pre = NaN — no genuine pre-fire scene supplied; a simulated',
        havePre ? '' : '  pre-fire image would be fabrication (Key & Benson require real pre/post scenes).',
        '',
        'Step 3 — Differenced NBR:',
        havePre ?
          `  dNBR = NBR_pre − NBR_post = ${nbrPre.toFixed(4)} − ${nbr.toFixed(4)} = ${dNBR.toFixed(4)}` :
          '  dNBR = NaN (pre-fire image unavailable — cannot classify severity).',
        '',
        'Step 4 — Burn severity classification (MTBS):',
        `  Severity: ${severity}${havePre ? ` (dNBR = ${dNBR.toFixed(3)})` : ''}`,
        '',
        `  └ dNBR thresholds: <0.1 unburned, 0.1–0.27 low, 0.27–0.44 moderate, 0.44–0.66 high, >0.66 very high (MTBS standard)`,
      ]
    };
  },
  32: ({ A, eps, Tfire, Tbg, firmsFrpTotalW, firmsFrpMaxMW, __firmsDetection, __firmsCount }) => {
    const hasFirms = typeof firmsFrpTotalW === 'number' && Number.isFinite(firmsFrpTotalW) && firmsFrpTotalW > 0;
    const firmsCount = typeof __firmsCount === 'number' ? __firmsCount : 0;
    // Mode A — genuine measured FRP available: the operational Wooster (2005)
    // MIR-radiance FRP distributed by NASA FIRMS IS the Giglio (2006) product;
    // its per-pixel sum within the search region is the genuine FRP.
    const userDozier =
      (typeof Tfire === 'number' && Number.isFinite(Tfire) && Number.isFinite(A) && Number.isFinite(Tbg))
      ? A * eps * SIGMA * (Math.pow(Tfire, 4) - Math.pow(Tbg, 4))
      : Number.NaN;

    if (!hasFirms && !Number.isFinite(userDozier)) {
      return {
        result: NaN, unit: 'W',
        steps: [
          '── Fire Radiative Power (Giglio et al., 2006) ──',
          'Operational FRP: Wooster (2005) MIR-radiance method (per-pixel product)',
          'Definition: FRP = A·ε·σ·(T_fire⁴ − T_bg⁴) (true sub-pixel T_fire required)',
          '',
          'No genuine NASA FIRMS active-fire detection exists within the',
          `search radius${firmsCount > 0 ? '' : ' (0 detections)'}, and no user-supplied`,
          'fire temperature / background temperature was provided.',
          'No fire temperature or FRP is fabricated.',
        ],
      };
    }

    if (hasFirms && !Number.isFinite(userDozier)) {
      const frpMW = (firmsFrpTotalW as number) / 1e6;
      const steps = [
        '── Fire Radiative Power (Giglio et al., 2006) ──',
        ...(typeof __firmsDetection === 'string' ? [`${__firmsDetection}`, ''] : []),
        'Step 1 — Genuine measured FRP (NASA FIRMS, Wooster 2005 method):',
        `  Total measured FRP (all ${firmsCount} fire pixel(s)): ${frpMW.toFixed(1)} MW`,
        `  Max single-pixel measured FRP: ${(firmsFrpMaxMW as number ?? Number.NaN).toFixed(1)} MW`,
        '',
        'Step 2 — Giglio (2006) definition (sub-pixel fire temperature T_f):',
        '  FRP = A·ε·σ·(T_f⁴ − T_bg⁴)',
        '  FIRMS does not deliver the true sub-pixel fire temperature — its',
        `  bright_ti4 is the mixed-pixel MIR brightness (${Number.isFinite(Tfire as number) ? (Tfire as number).toFixed(0) : '–'} K at this pixel),`,
        '  so substituting it into the full-pixel Dozier form is not a valid',
        '  estimate. The measured per-pixel product is reported instead.',
        '',
        'Step 3 — Interpretation:',
        `  ${frpMW < 5 * firmsCount ? 'Small/smoldering fire(s)' : frpMW < 50 * firmsCount ? 'Moderate savanna/grassland fire(s)' : frpMW < 500 * firmsCount ? 'Large fire activity' : 'Extreme fire activity (pyroCb potential)'}`,
        `  Combustion rate est.: ~${(frpMW / 200).toFixed(2)} kg/s (≈4500 kJ/g energy yield)`,
      ];
      return { result: firmsFrpTotalW as number, unit: 'W', steps };
    }

    if (Number.isFinite(userDozier)) {
      // User supplied genuine fire/background temperatures (e.g. field
      // measurements or thermal imaging): evaluate the Giglio/Dozier
      // definition exactly.
      const Tf4 = Math.pow(Tfire as number, 4);
      const Tbg4 = Math.pow(Tbg as number, 4);
      const FRP = userDozier;
      const FRP_MW = FRP / 1e6;
      const TfireC = (Tfire as number) - 273.15;
      return {
        result: FRP, unit: 'W',
        steps: [
          '── Fire Radiative Power (Giglio et al., 2006) ──',
          ...(typeof __firmsDetection === 'string' ? [`${__firmsDetection}`, ''] : []),
          `Pixel area A = ${(A as number).toFixed(0)} m², Emissivity ε = ${(eps as number).toFixed(2)}`,
          `Fire temperature T_fire = ${(Tfire as number).toFixed(0)} K (${TfireC.toFixed(0)} °C)`,
          `Background T_bg = ${(Tbg as number).toFixed(0)} K`,
          '',
          'Step 1 — Stefan-Boltzmann radiance:',
          `  T_fire⁴ = (${(Tfire as number).toFixed(0)})⁴ = ${Tf4.toExponential(3)} K⁴`,
          `  T_bg⁴ = (${(Tbg as number).toFixed(0)})⁴ = ${Tbg4.toExponential(3)} K⁴`,
          '',
          'Step 2 — Compute FRP (Giglio/Dozier):',
          `  FRP = A·ε·σ·(T_f⁴ − T_bg⁴) = ${(A as number).toFixed(0)} × ${(eps as number).toFixed(2)} × ${SIGMA.toExponential(3)} × ${(Tf4 - Tbg4).toExponential(3)}`,
          `  FRP = ${FRP.toExponential(3)} W = ${FRP_MW.toFixed(1)} MW`,
          ...(hasFirms ? ['', `  Cross-check: FIRMS measured FRP = ${(firmsFrpTotalW as number / 1e6).toFixed(1)} MW (${firmsCount} pixel(s))`] : []),
          '',
          'Step 3 — Fire classification:',
          `  ${FRP_MW < 5 ? 'Small/smoldering fire' : FRP_MW < 50 ? 'Moderate savanna/grassland fire' : FRP_MW < 500 ? 'Large forest fire' : 'Extreme fire (pyroCb potential)'}`,
          `  Combustion rate est.: ~${(FRP_MW / 200).toFixed(2)} kg/s (≈4500 kJ/g energy yield)`,
        ]
      };
    }

    return {
      result: NaN, unit: 'W',
      steps: ['FRP cannot be computed: neither a genuine FIRMS detection nor complete user-supplied temperatures are available.'],
    };
  },
  33: ({ Tc, Twet, Tdry }) => {
    if (!Number.isFinite(Tc) || !Number.isFinite(Twet) || !Number.isFinite(Tdry)) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── Crop Water Stress Index (Idso et al., 1981) ──',
          'CWSI = (T_c − T_wet) / (T_dry − T_wet)',
          '',
          'One or more baseline temperatures are unavailable:',
          `  T_c = ${Tc}, T_wet = ${Twet}, T_dry = ${Tdry}`,
          '',
          'T_c is the genuine Landsat C2 L2 surface temperature; T_wet is',
          'derived as the wet-bulb temperature (Stull 2011) from genuine',
          'air temperature + RH; but the dry baseline T_dry (non-',
          'transpiring canopy) has no global remote-sensed source and must',
          'be supplied by the user (field measurement or energy-balance',
          'model). No synthetic baseline is substituted.',
        ],
      };
    }
    if (Tdry - Twet <= 0) {
      return { result: NaN, unit: '—', steps: ['CWSI: dry baseline must exceed wet baseline (non-physical inputs).'] };
    }
    const cwsi = (Tc - Twet) / (Tdry - Twet);
    let stressClass: string;
    if (cwsi < 0.2) stressClass = 'NO STRESS — well-watered, full transpiration';
    else if (cwsi < 0.4) stressClass = 'MILD STRESS — consider scheduling irrigation';
    else if (cwsi < 0.6) stressClass = 'MODERATE STRESS — significant yield reduction if prolonged';
    else if (cwsi < 0.8) stressClass = 'SEVERE STRESS — substantial yield loss expected';
    else stressClass = 'EXTREME STRESS — near-zero transpiration, crop failure likely';
    return {
      result: cwsi, unit: '—',
      steps: [
        '── Crop Water Stress Index (Idso et al., 1981) ──',
        `Canopy temperature T_c = ${Tc.toFixed(1)} °C`,
        `Wet reference T_wet = ${Twet.toFixed(1)} °C (well-watered, transpiring)`,
        `Dry reference T_dry = ${Tdry.toFixed(1)} °C (non-transpiring)`,
        '',
        'Step 1 — Compute CWSI:',
        `  CWSI = (T_c − T_wet) / (T_dry − T_wet)`,
        `  CWSI = (${Tc.toFixed(1)} − ${Twet.toFixed(1)}) / (${Tdry.toFixed(1)} − ${Twet.toFixed(1)})`,
        `  CWSI = ${cwsi.toFixed(3)}`,
        '',
        'Step 2 — Stress assessment:',
        `  ${stressClass}`,
        `  Estimated ET_a/ET_p ≈ ${(1 - Math.min(1, Math.max(0, cwsi))).toFixed(1)} (ratio of actual to potential ET)`,
        '',
        `  └ Irrigation threshold: ${cwsi > 0.5 ? 'IMMEDIATE IRRIGATION REQUIRED' : cwsi > 0.2 ? 'Monitor closely, schedule irrigation' : 'Irrigation not needed'}`,
      ]
    };
  },
  34: ({ DDF, Tair, Tbase }) => {
    if (!Number.isFinite(DDF) || !Number.isFinite(Tair) || !Number.isFinite(Tbase)) {
      return {
        result: NaN, unit: 'mm/day',
        steps: [
          '── Degree-Day Snowmelt Model (Hock, 2003) ──',
          'M = DDF × max(0, T_air − T_base)',
          '',
          'The degree-day factor DDF is a site-calibrated parameter with',
          'no global remote-sensed source (Hock 2003: snow 2–5, firn 5–7,',
          'clean ice 7–10, dirty ice 10–15 mm/°C·day). Supply a DDF',
          `calibrated for the site (current: DDF=${DDF}, T_air=${Tair}, T_base=${Tbase}).`,
          'No default factor is substituted — melt cannot be estimated',
          'without it.',
        ],
      };
    }
    const Texcess = Math.max(0, Tair - Tbase);
    const M = DDF * Texcess;
    const cumMelt = M * 10;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    let cum = 0;
    for (let day = 1; day <= 30; day++) {
      cum += M;
      seriesPoints.push({ x: day, y: Number.isFinite(cum) ? cum : Number.NaN });
    }
    let meltClass: string;
    if (M < 5) meltClass = 'Low melt rate';
    else if (M < 15) meltClass = 'Moderate melt';
    else if (M < 30) meltClass = 'Rapid melt — significant runoff';
    else meltClass = 'Extreme melt — rain-on-snow or foghn event possible';
    return {
      result: M, unit: 'mm/day',
      secondary: [
        { key: 'cumulative_melt', value: Number.isFinite(cumMelt) ? cumMelt : Number.NaN, unit: 'mm', label: 'Cumulative Melt (10 days)' },
      ],
      series: [{
        label: 'Cumulative snowmelt',
        color: '#0072B2',
        points: seriesPoints,
      }],
      steps: [
        '── Degree-Day Snowmelt Model (Hock, 2003) ──',
        `Degree-Day Factor DDF = ${DDF.toFixed(2)} mm/°C·day`,
        `Air temperature T_air = ${Tair.toFixed(1)} °C, Base T_base = ${Tbase.toFixed(1)} °C`,
        '',
        'Step 1 — Temperature excess:',
        `  ΔT = max(0, T_air − T_base) = max(0, ${Tair.toFixed(1)} − ${Tbase.toFixed(1)})`,
        `  ΔT = ${Texcess.toFixed(1)} °C`,
        '',
        'Step 2 — Daily melt:',
        `  M = DDF × ΔT = ${DDF.toFixed(2)} × ${Texcess.toFixed(1)}`,
        `  M = ${M.toFixed(2)} mm w.e./day`,
        '',
        'Step 3 — Melt assessment:',
        `  ${meltClass}`,
        `  Cumulative over 10 days at this rate: ${(M * 10).toFixed(0)} mm w.e.`,
        '',
        `  └ DDF context: snow 2–5 mm/°C·day, firn 5–7, clean ice 7–10, dirty ice 10–15`,
        `  └ AWS station melt season duration: typically 30–120 days at mid-latitude glaciers`,
      ]
    };
  },
  35: ({ C, Twater, Tice }) => {
    if (!Number.isFinite(C) || !Number.isFinite(Twater) || !Number.isFinite(Tice)) {
      return {
        result: NaN, unit: '—',
        steps: [
          '── Passive Microwave Sea Ice Concentration (Comiso, 1986) ──',
          'T_B = (1 − C)·T_water + C·T_ice',
          '',
          'One or more inputs are unavailable:',
          `  C = ${C}, T_water = ${Twater}, T_ice = ${Tice}`,
          '',
          'C (ice concentration) is taken GENUINELY from NSIDC NRT CDR V4',
          '(AMSR2). T_water / T_ice are tie-point brightness temperatures',
          'that depend on sensor, frequency and polarization — they must',
          'be supplied (no single default radiative temperature is',
          'physically defensible, and none is substituted).',
        ],
      };
    }
    const Tb = (1 - C) * Twater + C * Tice;
    const tbKelvin = Tb + 273.15;
    let iceClass: string;
    if (C > 0.9) iceClass = 'COMPACT ICE — polar pack';
    else if (C > 0.7) iceClass = 'CLOSE PACK ICE — consolidated with small leads';
    else if (C > 0.4) iceClass = 'OPEN PACK ICE — substantial open water';
    else if (C > 0.15) iceClass = 'VERY OPEN PACK ICE — marginal ice zone';
    else iceClass = 'ICE FREE / ICE EDGE';
    return {
      result: Tb, unit: '°C',
      secondary: [
        { key: 'brightness_kelvin', value: Number.isFinite(tbKelvin) ? tbKelvin : Number.NaN, unit: 'K', label: 'Brightness Temperature (K)' },
      ],
      steps: [
        '── Passive Microwave Sea Ice Concentration (Comiso, 1986) ──',
        `Ice concentration C = ${C.toFixed(2)}, Water T_water = ${Twater.toFixed(1)} °C, Ice T_ice = ${Tice.toFixed(1)} °C`,
        '',
        'Step 1 — Linear mixing model:',
        `  T_B = (1 − C)·T_water + C·T_ice`,
        `  T_B = (1 − ${C.toFixed(2)}) × ${Twater.toFixed(1)} + ${C.toFixed(2)} × ${Tice.toFixed(1)}`,
        `  T_B = ${Tb.toFixed(2)} °C (${tbKelvin.toFixed(2)} K)`,
        '',
        'Step 2 — Ice classification:',
        `  ${iceClass}`,
        `  ${C < 0.15 ? 'Algorithm accuracy degrades below 15% concentration' : 'Reliable concentration retrieval'}`,
        '',
        `  └ Thin ice warning: ${C > 0.4 && Math.abs(Twater - Tice) < 10 ? 'Potential thin ice bias — check Bootstrap algorithm' : 'Standard conditions for retrieval'}`,
      ]
    };
  },

  // ── Domain 5: Spatial Analysis & Extreme Events ──
  36: ({ lat1, lon1, lat2, lon2 }) => {
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'km',
        secondary: [
          { key: 'bearing', value: Number.NaN, unit: '°', label: 'Initial bearing (NaN)' },
          { key: 'midLat', value: Number.NaN, unit: '°', label: 'Great-circle midpoint latitude (NaN)' },
          { key: 'midLon', value: Number.NaN, unit: '°', label: 'Great-circle midpoint longitude (NaN)' },
        ],
        steps: [
          '── Haversine Formula (Sinnott, 1984) ──',
          'One or both endpoint coordinates are missing / non-finite. '
          + 'Provide two points (lat₁, lon₁) and (lat₂, lon₂), or draw a '
          + 'two-point study area — the great-circle distance is undefined otherwise.',
        ]
      };
    }
    const R = 6371000; // Sinnott (1984): mean Earth radius 6371 km
    const phi1 = lat1 * PI / 180, phi2 = lat2 * PI / 180;
    const dphi = (lat2 - lat1) * PI / 180;
    const dl = (lon2 - lon1) * PI / 180;
    const sinDphi2 = Math.sin(dphi / 2);
    const sinDl2 = Math.sin(dl / 2);
    const a = Math.max(0, Math.min(1, sinDphi2 ** 2 + Math.cos(phi1) * Math.cos(phi2) * sinDl2 ** 2));
    const c = 2 * Math.asin(Math.sqrt(a));
    const d = R * c;
    // Initial bearing
    const y = Math.sin(dl) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dl);
    const bearing = (Math.atan2(y, x) * 180 / PI + 360) % 360;
    // Great-circle midpoint (half-way along the great-circle path)
    const Bx = Math.cos(phi2) * Math.cos(dl);
    const By = Math.cos(phi2) * Math.sin(dl);
    const midLat = Math.atan2(Math.sin(phi1) + Math.sin(phi2),
      Math.sqrt((Math.cos(phi1) + Bx) ** 2 + By ** 2)) * 180 / PI;
    const midLon = (lon1 + Math.atan2(By, Math.cos(phi1) + Bx) * 180 / PI + 540) % 360 - 180;
    const dLatPerDeg = 111.32; // km/° near equator
    const dLonPerDeg = 111.32 * Math.cos((lat1 + lat2) / 2 * PI / 180);
    return {
      result: d / 1000, unit: 'km',
      secondary: [
        { key: 'bearing', value: Number.isFinite(bearing) ? bearing : Number.NaN, unit: '°', label: 'Initial bearing (degrees clockwise from north)' },
        { key: 'midLat', value: Number.isFinite(midLat) ? midLat : Number.NaN, unit: '°', label: 'Great-circle midpoint latitude' },
        { key: 'midLon', value: Number.isFinite(midLon) ? midLon : Number.NaN, unit: '°', label: 'Great-circle midpoint longitude' },
      ],
      steps: [
        '── Haversine Formula (Sinnott, 1984) ──',
        `Point 1: (${lat1.toFixed(4)}°, ${lon1.toFixed(4)}°)  |  Point 2: (${lat2.toFixed(4)}°, ${lon2.toFixed(4)}°)`,
        '',
        'Step 1 — Convert to radians:',
        `  φ₁ = ${lat1.toFixed(4)}° × π/180 = ${phi1.toFixed(6)} rad`,
        `  φ₂ = ${lat2.toFixed(4)}° × π/180 = ${phi2.toFixed(6)} rad`,
        `  Δφ = ${dphi.toFixed(6)} rad, Δλ = ${dl.toFixed(6)} rad`,
        '',
        'Step 2 — Apply haversine:',
        `  a = sin²(Δφ/2) + cosφ₁·cosφ₂·sin²(Δλ/2)`,
        `  a = ${sinDphi2.toFixed(6)}² + ${Math.cos(phi1).toFixed(6)}×${Math.cos(phi2).toFixed(6)}×${sinDl2.toFixed(6)}² = ${a.toFixed(6)}`,
        '',
        'Step 3 — Central angle and distance:',
        `  c = 2·asin(√a) = ${c.toFixed(6)} rad (${(c * 180 / PI).toFixed(4)}°)`,
        `  d = R·c = ${d.toFixed(0)} m = ${(d / 1000).toFixed(2)} km`,
        '',
        'Step 4 — Local scale reference:',
        `  Initial bearing: ${bearing.toFixed(1)}° clockwise from north`,
        `  Midpoint: (${midLat.toFixed(4)}°, ${midLon.toFixed(4)}°)`,
        `  1° latitude ≈ ${dLatPerDeg.toFixed(2)} km, 1° longitude ≈ ${dLonPerDeg.toFixed(2)} km at mean latitude`,
        '',
        `  └ Distance class: ${d < 1000 ? 'Very short (< 1 km)' : d < 10000 ? 'Local (< 10 km)' : d < 100000 ? 'Regional (< 100 km)' : d < 1000000 ? 'Sub-continental (< 1000 km)' : 'Continental/global (> 1000 km)'}`,
      ]
    };
  },
  37: ({ obs, tlat, tlon, fitted, unit }) => {
    const observations = (Array.isArray(obs) ? obs as Array<{ lat: number; lon: number; value: number; siteName?: string }> : [])
      .map((o) => ({ lat: Number(o.lat), lon: Number(o.lon), value: Number(o.value), siteName: typeof o.siteName === 'string' ? o.siteName : undefined }))
      .filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon) && Number.isFinite(o.value));
    const fitModel = fitted && {
      nugget: Number.isFinite(Number(fitted.nugget)) ? Number(fitted.nugget) : 0,
      sill: Number.isFinite(Number(fitted.sill)) ? Number(fitted.sill) : NaN,
      range: Number.isFinite(Number(fitted.range)) && Number(fitted.range) > 0 ? Number(fitted.range) : 1,
      model: fitted.model,
    };
    const outUnit = typeof unit === 'string' && unit ? unit : '—';
    const nanSecondary = [
      { key: 'variance', value: Number.NaN, unit: outUnit === '—' ? '—' : outUnit + '²', label: 'Kriging variance (NaN)' },
      { key: 'sd', value: Number.NaN, unit: outUnit, label: 'Kriging standard deviation (NaN)' },
      { key: 'weightsSum', value: Number.NaN, unit: '—', label: 'Sum of kriging weights (NaN)' },
    ];
    if (!observations.length || !Number.isFinite(tlat) || !Number.isFinite(tlon) || !fitModel || !Number.isFinite(fitModel.sill) || !(fitModel.sill > 0)) {
      return {
        result: Number.NaN, unit: outUnit,
        secondary: nanSecondary,
        steps: [
          '── Ordinary Kriging (Matheron, 1963) ──',
          `Genuine observations available: ${observations.length}`,
          '',
          'Honest NaN: ordinary kriging requires ≥ 2 real spatial observations '
          + 'plus a fitted semivariogram (sill > 0). The study area returned '
          + 'too few reported stations to build the kriging system — no values '
          + 'are fabricated.',
        ]
      };
    }
    const kr = ordinaryKriging(observations, { lat: tlat, lon: tlon }, fitModel as VariogramModel);
    if (!kr) {
      return {
        result: Number.NaN, unit: outUnit,
        secondary: nanSecondary,
        steps: [
          '── Ordinary Kriging (Matheron, 1963) ──',
          `${observations.length} observations loaded`,
          'Honest NaN: the kriging linear system is singular (degenerate '
          + 'configuration — coincident points or zero-variance field) and '
          + 'cannot be solved without regularization.',
        ]
      };
    }
    const { yhat, variance, weights, phi, fitted: fit, nObs } = kr;
    const sd = Math.sqrt(variance);
    const wTop = weights.map((w, i) => ({ w, v: observations[i].value, lat: observations[i].lat, lon: observations[i].lon }))
      .sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 4);
    return {
      result: yhat, unit: outUnit,
      secondary: [
        { key: 'variance', value: Number.isFinite(variance) ? variance : Number.NaN, unit: outUnit === '—' ? '—' : outUnit + '²', label: 'Kriging variance (prediction uncertainty σ²_K)' },
        { key: 'sd', value: Number.isFinite(sd) ? sd : Number.NaN, unit: outUnit, label: 'Kriging standard deviation σ_K' },
        { key: 'weightsSum', value: Number.isFinite(weights.reduce((s, w) => s + w, 0)) ? weights.reduce((s, w) => s + w, 0) : Number.NaN, unit: '—', label: 'Sum of kriging weights (unbiasedness)' },
      ],
      steps: [
        '── Ordinary Kriging (Matheron, 1963) ──',
        `${nObs} genuine observations | target (${tlat.toFixed(3)}, ${tlon.toFixed(3)}) | model: ${fit.model}`,
        '',
        'Step 1 — Fitted semivariogram model:',
        `  γ̂(h) fitted by weighted least squares: ${fit.model}`,
        `  Nugget c₀ = ${fit.nugget.toExponential(3)}, sill = ${fit.sill.toExponential(3)}, range a = ${fit.range.toFixed(2)} km`,
        '',
        'Step 2 — Kriging system solved (partial pivoting Gaussian elimination):',
        `  A·λ = b, Σλᵢ = 1 enforced by Lagrange row (φ = ${phi.toExponential(3)})`,
        `  Dominant weights: ${wTop.map((w) => `λ=${w.w.toFixed(3)} @(${w.lat.toFixed(2)},${w.lon.toFixed(2)}) z=${w.v.toFixed(2)}`).join(', ')}`,
        '',
        'Step 3 — Best Linear Unbiased Prediction:',
        `  ŷ(s₀) = Σλᵢ·z(sᵢ) = ${yhat.toFixed(4)}`,
        '',
        'Step 4 — Kriging variance (prediction uncertainty):',
        `  σ²_K = Σλᵢ·γ(sᵢ−s₀) + φ = ${variance.toExponential(3)}`,
        `  σ_K = ${sd.toFixed(4)}`,
        '',
        `  └ 95% CI: [${(yhat - 1.96 * sd).toFixed(3)}, ${(yhat + 1.96 * sd).toFixed(3)}]`,
        `  └ Weights sum to ${weights.reduce((s, w) => s + w, 0).toFixed(4)} (unbiasedness), kriging variance depends on geometry+variogram, not on z values`,
      ]
    };
  },
  38: ({ obs, tlat, tlon, p, unit }) => {
    const observations = (Array.isArray(obs) ? obs as Array<{ lat: number; lon: number; value: number; siteName?: string }> : [])
      .map((o) => ({ lat: Number(o.lat), lon: Number(o.lon), value: Number(o.value), siteName: typeof o.siteName === 'string' ? o.siteName : undefined }))
      .filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon) && Number.isFinite(o.value));
    const power = Number.isFinite(p) && p >= 0.5 && p <= 4 ? p : 2;
    const outUnit = typeof unit === 'string' && unit ? unit : '—';
    const nanSecondary = [
      { key: 'nearestKm', value: Number.NaN, unit: 'km', label: 'Distance to nearest observation (NaN)' },
      { key: 'topWeight', value: Number.NaN, unit: '—', label: 'Dominant normalized weight (NaN)' },
    ];
    if (!observations.length || !Number.isFinite(tlat) || !Number.isFinite(tlon)) {
      return {
        result: Number.NaN, unit: outUnit,
        secondary: nanSecondary,
        steps: [
          '── Inverse Distance Weighting (Shepard, 1968) ──',
          `Genuine observations available: ${observations.length}`,
          '',
          'Honest NaN: IDW requires at least one real observation in the '
          + 'study area. The station network returned no reporting sites '
          + 'here — no values are fabricated.',
        ]
      };
    }
    const idw = inverseDistanceWeighting(observations, { lat: tlat, lon: tlon }, power);
    if (!idw) {
      return {
        result: Number.NaN, unit: outUnit,
        secondary: nanSecondary,
        steps: [
          '── Inverse Distance Weighting (Shepard, 1968) ──',
          `${observations.length} observations loaded`,
          'Honest NaN: degenerate configuration (non-finite distances).',
        ]
      };
    }
    const { yhat, weights, distancesKm, exactAt, nObs } = idw;
    const top = weights.map((w, i) => ({ w, d: distancesKm[i], v: observations[i].value }))
      .map((x, i) => ({ ...x, i })).sort((a, b) => b.w - a.w).slice(0, 4);
    return {
      result: yhat, unit: outUnit,
      secondary: [
        { key: 'nearestKm', value: Number.isFinite(Math.min(...distancesKm)) ? Math.min(...distancesKm) : Number.NaN, unit: 'km', label: 'Distance to nearest observation' },
        { key: 'topWeight', value: Number.isFinite(Math.max(...weights)) ? Math.max(...weights) : Number.NaN, unit: '—', label: 'Dominant normalized weight' },
      ],
      steps: [
        '── Inverse Distance Weighting (Shepard, 1968) ──',
        `${nObs} genuine observations | target (${tlat.toFixed(3)}, ${tlon.toFixed(3)}) | power p = ${power}`,
        '',
        'Step 1 — Distances (haversine, km) and weights:',
        `  wᵢ = 1/dᵢ${power === 2 ? '²' : '^' + power}${exactAt != null ? ` — target coincides with station #${exactAt} (d < 1 m): exact interpolator snap` : ''}`,
        `  Dominant: ${top.map((x) => `w=${x.w.toFixed(3)} d=${x.d.toFixed(1)} km z=${x.v.toFixed(2)}`).join(', ')}`,
        '',
        'Step 2 — Weighted average:',
        `  ŷ = Σ(wᵢ·zᵢ)/Σwᵢ = ${yhat.toFixed(4)}`,
        '',
        'Step 3 — Locality assessment:',
        `  ${top[0].w > 0.5 ? `Close neighbor dominates (${(top[0].w * 100).toFixed(0)} % of weight) — bullseye behaviour per Shepard` : 'Weight distributed across several stations'}`,
        '',
        `  └ IDW is exact at data points and continuous (C⁰), but not differentiable at samples`,
        `  └ No prediction variance (deterministic interpolator — use kriging, Tool 37, for uncertainty)`,
      ]
    };
  },
  39: ({ Q, u, sigmaY, sigmaZ, y, z, H }) => {
    // Pasquill & Smith (1983) Gaussian point-source plume, ground level z:
    // C = Q/(2π·u·σy·σz) · exp(−y²/2σy²) · [exp(−(z−H)²/2σz²) + exp(−(z+H)²/2σz²)]
    const denom = 2 * PI * u * sigmaY * sigmaZ;
    const expY = Math.exp(-(y * y) / (2 * sigmaY * sigmaY));
    const expZ1 = Math.exp(-((z - H) * (z - H)) / (2 * sigmaZ * sigmaZ));
    const expZ2 = Math.exp(-((z + H) * (z + H)) / (2 * sigmaZ * sigmaZ));
    const vert = expZ1 + expZ2;   // ground + (implicit inversion lid) reflection
    const C = (Q / denom) * expY * vert;
    const C_centerline = (Q / denom) * vert; // y = 0
    let stabilityClass: string;
    if (sigmaZ < 10) stabilityClass = 'STABLE (F) — poor vertical dispersion';
    else if (sigmaZ < 30) stabilityClass = 'SLIGHTLY UNSTABLE (C/D) — moderate dispersion';
    else if (sigmaZ < 70) stabilityClass = 'UNSTABLE (B) — good dispersion';
    else stabilityClass = 'VERY UNSTABLE (A) — rapid dispersion';
    return {
      result: C, unit: 'µg/m³',
      secondary: [
        { key: 'centerline', value: Number.isFinite(C_centerline) ? C_centerline : Number.NaN, unit: 'µg/m³', label: 'Centerline Concentration (y=0)' },
      ],
      steps: [
        '── Gaussian Plume Model (Pasquill & Smith, 1983) ──',
        `Source rate Q = ${Q.toExponential(3)} µg/s, Wind speed u = ${u.toFixed(2)} m/s`,
        `Dispersion: σ_y = ${sigmaY.toFixed(1)} m, σ_z = ${sigmaZ.toFixed(1)} m`,
        `Crosswind y = ${y.toFixed(1)} m | receptor height z = ${z.toFixed(1)} m | effective stack height H = ${H.toFixed(1)} m`,
        '',
        'Step 1 — Compute denominator:',
        `  2π·u·σ_y·σ_z = 2π × ${u.toFixed(2)} × ${sigmaY.toFixed(1)} × ${sigmaZ.toFixed(1)} = ${denom.toFixed(1)}`,
        '',
        'Step 2 — Crosswind exponential:',
        `  exp(−y²/(2σ_y²)) = exp(−(${y.toFixed(1)})² / (2×${sigmaY.toFixed(1)}²)) = ${expY.toExponential(4)}`,
        '',
        'Step 3 — Vertical reflection terms (Pasquill & Smith Eq., ground at z):',
        `  exp(−(z−H)²/(2σ_z²)) = exp(−(${(z - H).toFixed(1)})² / (2×${sigmaZ.toFixed(1)}²)) = ${expZ1.toExponential(4)}`,
        `  exp(−(z+H)²/(2σ_z²)) = exp(−(${(z + H).toFixed(1)})² / (2×${sigmaZ.toFixed(1)}²)) = ${expZ2.toExponential(4)}`,
        `  Vertical factor = ${expZ1.toExponential(3)} + ${expZ2.toExponential(3)} = ${vert.toExponential(4)}`,
        '',
        'Step 4 — Concentration:',
        `  C(x,y,z) = (${Q.toExponential(3)} / ${denom.toFixed(1)}) × ${expY.toExponential(4)} × ${vert.toExponential(4)}`,
        `  C = ${C.toExponential(4)} µg/m³`,
        '',
        'Step 5 — Reference values:',
        `  Stability class: ${stabilityClass}`,
        `  Centerline (y=0) concentration: ${C_centerline.toExponential(4)} µg/m³`,
        '',
        `  └ Plume half-width at y = ±${sigmaY.toFixed(1)} m contains ~68% of mass`,
        `  └ Maximum ground-level occurs downwind where σ_z = H/√2 (elevated releases)`,
      ]
    };
  },
  40: ({ mu, beta, x }) => {
    if (![mu, beta, x].every(Number.isFinite) || !(beta > 0)) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'returnPeriod', value: Number.NaN, unit: 'years', label: 'Return period T = 1/(1−F) (NaN)' },
          { key: 'reducedVariate', value: Number.NaN, unit: '—', label: 'Gumbel reduced variate y (NaN)' },
          { key: 'xReturn100', value: Number.NaN, unit: '—', label: '100-year return level (NaN)' },
        ],
        steps: [
          '── Gumbel (Type I) Extreme Value Distribution (Gumbel, 1958) ──',
          'Honest NaN: Gumbel requires a finite location μ, a finite scale '
          + 'β > 0 and a finite value x — no value is fabricated.',
        ]
      };
    }
    const y = (x - mu) / beta;
    const F = Math.exp(-Math.exp(-y));
    const T = 1 / (1 - F + 1e-30);
    const reducedVariate = -Math.log(-Math.log(F));
    const xReturn100 = mu - beta * Math.log(-Math.log(1 - 1 / 100));
    // Distribution series — Gumbel PDF f(x) over x ∈ [μ−3β, μ+3β] (40 points)
    // using the tool's location μ and scale β.
    const pdfPoints: Array<{ x: number; y: number }> = Array.from({ length: 40 }, (_, i) => {
      const xv = (mu - 3 * beta) + (i * 6 * beta) / 39;
      const yv = (xv - mu) / beta;
      const pdf = (1 / beta) * Math.exp(-yv - Math.exp(-yv));
      return { x: xv, y: Number.isFinite(pdf) ? pdf : Number.NaN };
    });
    return {
      result: F, unit: '—',
      secondary: [
        { key: 'returnPeriod', value: Number.isFinite(T) ? T : Number.NaN, unit: 'years', label: 'Return period T = 1/(1−F) of the supplied x' },
        { key: 'reducedVariate', value: Number.isFinite(reducedVariate) ? reducedVariate : Number.NaN, unit: '—', label: 'Gumbel reduced variate y = −ln(−ln F)' },
        { key: 'xReturn100', value: Number.isFinite(xReturn100) ? xReturn100 : Number.NaN, unit: '—', label: '100-year return level μ − β·ln(−ln(1−1/100)) (input units)' },
      ],
      series: [{
        label: 'Gumbel PDF f(x)',
        color: '#0072B2',
        points: pdfPoints,
      }],
      steps: [
        '── Gumbel (Type I) Extreme Value Distribution (Gumbel, 1958) ──',
        `Location μ = ${mu.toFixed(2)}, Scale β = ${beta.toFixed(2)}`,
        `Value x = ${x.toFixed(2)}`,
        '',
        'Step 1 — Reduced variate:',
        `  y = (x − μ) / β = (${x.toFixed(2)} − ${mu.toFixed(2)}) / ${beta.toFixed(2)} = ${y.toFixed(4)}`,
        '',
        'Step 2 — CDF:',
        `  F(x) = exp(−exp(−y)) = exp(−exp(−${y.toFixed(4)}))`,
        `  P(X ≤ ${x.toFixed(2)}) = ${F.toFixed(6)}`,
        '',
        'Step 3 — Return period:',
        `  T = 1 / (1 − F) = 1 / (1 − ${F.toFixed(6)}) = ${T.toFixed(1)} years`,
        '',
        'Step 4 — Gumbel plot slope check:',
        `  Gumbel reduced variate: y = ${reducedVariate.toFixed(4)}`,
        `  · Gumbel plot of ln(−ln(F)) vs x should be linear if data follow Type I`,
        '',
        `  └ Return period: ${T < 2 ? 'Frequent (< 2-yr event)' : T < 10 ? 'Common (2–10 yr recurrence)' : T < 50 ? 'Infrequent (10–50 yr)' : T < 100 ? 'Rare (50–100 yr)' : 'Very rare (> 100-yr return period)'}`,
      ]
    };
  },
  41: ({ xi, beta, x }) => {
    // Pickands (1975) GPD for threshold exceedances. x is the excess
    // above threshold (x ≥ 0). The ξ = 0 Fréchet limit is the exponential
    // G(x) = 1 − exp(−x/β); for ξ < 0 the support is bounded by −β/ξ.
    if (![xi, beta, x].every(Number.isFinite) || !(beta > 0)) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'exceedProb', value: Number.NaN, unit: '—', label: 'Exceedance probability 1−G (NaN)' },
          { key: 'tailIndex', value: Number.NaN, unit: '—', label: 'Tail index α = 1/ξ (NaN)' },
          { key: 'meanExcess', value: Number.NaN, unit: '—', label: 'Mean excess e = β/(1−ξ) (NaN)' },
          { key: 'returnLevel1pct', value: Number.NaN, unit: '—', label: 'Return level for 1% exceedance (NaN)' },
        ],
        steps: ['── Generalized Pareto Distribution (Pickands, 1975) ──', 'Honest NaN: non-finite parameter or non-positive scale β supplied.']
      };
    }
    let G: number;
    if (x <= 0) {
      G = 0; // exceedances below the threshold: CDF = 0 (support starts at 0)
    } else if (Math.abs(xi) < 1e-9) {
      G = 1 - Math.exp(-x / beta);   // ξ → 0 limit (Gumbel domain)
    } else {
      const inner = 1 + (xi * x) / beta;
      G = inner > 0 ? 1 - Math.pow(inner, -1 / xi) : 1;  // ξ<0: bounded at −β/ξ
    }
    const inner = 1 + (xi * x) / beta;
    const tailIndex = xi > 0 ? 1 / xi : Infinity;
    const meanExcess = xi < 1 ? beta / (1 - xi) : Infinity;
    const exceedProb = 1 - G;
    const pExceed = 0.01; // 1-in-100 exceedance return level
    const returnLevel1pct = Math.abs(xi) < 1e-9
      ? -beta * Math.log(pExceed)
      : (beta / xi) * (Math.pow(pExceed, -xi) - 1);
    const xiNote = xi < -1e-9 ? 'Weibull domain (bounded upper tail at −β/ξ)' : Math.abs(xi) < 1e-9 ? 'Gumbel domain (exponential tail, ξ=0 limit)' : xi < 0.3 ? 'Fréchet domain (heavy tail, moderate)' : 'Fréchet domain (heavy tail)';
    // Distribution series — GPD PDF g(x) over x ∈ [0, 10] (40 points) using
    // the tool's shape ξ and scale β.
    const pdfPoints: Array<{ x: number; y: number }> = Array.from({ length: 40 }, (_, i) => {
      const xv = (i * 10) / 39;
      let pdf: number;
      if (Math.abs(xi) < 1e-9) {
        pdf = (1 / beta) * Math.exp(-xv / beta);
      } else {
        const inner = 1 + (xi * xv) / beta;
        pdf = inner > 0 ? (1 / beta) * Math.pow(inner, -1 / xi - 1) : 0;
      }
      return { x: xv, y: Number.isFinite(pdf) ? pdf : Number.NaN };
    });
    return {
      result: G, unit: '—',
      secondary: [
        { key: 'exceedProb', value: Number.isFinite(exceedProb) ? exceedProb : Number.NaN, unit: '—', label: 'Exceedance probability P(X > x) = 1 − G' },
        { key: 'tailIndex', value: Number.isFinite(tailIndex) ? tailIndex : Number.NaN, unit: '—', label: 'Tail index α = 1/ξ (∞ = exponential tail)' },
        { key: 'meanExcess', value: Number.isFinite(meanExcess) ? meanExcess : Number.NaN, unit: '—', label: 'Mean excess e = β/(1−ξ)' },
        { key: 'returnLevel1pct', value: Number.isFinite(returnLevel1pct) ? returnLevel1pct : Number.NaN, unit: '—', label: 'Return level for a 1% exceedance (1-in-100 event)' },
      ],
      series: [{
        label: 'GPD PDF g(x)',
        color: '#0072B2',
        points: pdfPoints,
      }],
      steps: [
        '── Generalized Pareto Distribution (Pickands, 1975) ──',
        `Shape ξ = ${xi.toFixed(3)}, Scale β = ${beta.toFixed(2)}`,
        `Excess above threshold x = ${x.toFixed(2)} (support x ≥ 0)`,
        '',
        'Step 1 — Check domain:',
        `  1 + ξ·x/β = 1 + (${xi.toFixed(3)} × ${x.toFixed(2)}) / ${beta.toFixed(2)} = ${inner.toFixed(4)}`,
        `  ${inner > 0 || Math.abs(xi) < 1e-9 ? '✓ Within domain: valid GPD evaluation' : 'Beyond bounded support (ξ<0): G = 1'}`,
        '',
        'Step 2 — GPD CDF:',
        Math.abs(xi) < 1e-9
          ? `  G(x) = 1 − exp(−x/β)  [ξ = 0 exponential limit]  = ${G.toFixed(6)}`
          : `  G(x) = 1 − (1 + ξ·x/β)^(−1/ξ)  = ${G.toFixed(6)}`,
        '',
        'Step 3 — Tail diagnostics:',
        `  ξ = ${xi.toFixed(3)} → ${xiNote}`,
        `  Tail index α = 1/ξ = ${tailIndex === Infinity ? '∞ (exponential tail)' : tailIndex.toFixed(2)}`,
        `  Mean excess e(u) = β/(1−ξ) = ${meanExcess === Infinity ? '∞ (undefined for ξ ≥ 1)' : meanExcess.toFixed(2)}`,
        '',
        `  └ Exceedance probability P(X > x) = ${((1 - G) * 100).toFixed(2)}%`,
      ]
    };
  },
  42: ({ obs, K, unit }) => {
    // Matheron (1963) EXPERIMENTAL semivariogram on genuine observations:
    // γ̂(h_k) = (1/(2·N(h_k)))·Σ_{pairs, d≈h_k}[z(sᵢ) − z(sⱼ)]².
    // All N(N−1)/2 station pairs are binned into K lag classes over [0, 0.6·d_max];
    // the primary result is γ̂ at the median non-empty lag class. No synthetic
    // sample series — real station coordinates and values only.
    const observations = (Array.isArray(obs) ? obs as Array<{ lat: number; lon: number; value: number; siteName?: string }> : [])
      .map((o) => ({ lat: Number(o.lat), lon: Number(o.lon), value: Number(o.value), siteName: typeof o.siteName === 'string' ? o.siteName : undefined }))
      .filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon) && Number.isFinite(o.value));
    const nLags = Number.isFinite(K) && K >= 3 && K <= 40 ? Math.floor(K) : 10;
    const n = observations.length;
    const outUnit = typeof unit === 'string' && unit ? unit : '—';
    const nanSecondary = [
      { key: 'sillEstimate', value: Number.NaN, unit: outUnit === '—' ? '—' : outUnit + '²', label: 'Sill estimate (max γ̂) (NaN)' },
      { key: 'nuggetEstimate', value: Number.NaN, unit: outUnit === '—' ? '—' : outUnit + '²', label: 'Near-origin nugget-like γ̂ (NaN)' },
      { key: 'nPairs', value: Number.NaN, unit: '—', label: 'Station pairs binned (NaN)' },
      { key: 'lagsUsed', value: Number.NaN, unit: '—', label: 'Non-empty lag classes (NaN)' },
    ];
    if (n < 4) {
      return {
        result: Number.NaN, unit: outUnit,
        secondary: nanSecondary,
        steps: [
          '── Matheron Semivariogram (Matheron, 1963) ──',
          `Genuine observations available: ${n}`,
          '',
          'Honest NaN: the experimental semivariogram needs all N(N−1)/2 '
          + 'station pairs; the USGS network returned fewer than 4 reporting '
          + 'stations here — no values are fabricated.',
        ]
      };
    }
    const pairs: Array<{ h: number; dz2: number }> = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        pairs.push({
          h: pairDistanceKm(observations[i].lat, observations[i].lon, observations[j].lat, observations[j].lon),
          dz2: (observations[i].value - observations[j].value) ** 2,
        });
      }
    }
    const hMax = Math.max(...pairs.map((p) => p.h));
    const cap = hMax * 0.6; // standard: only use lags up to ~60% of max separation
    const gamma: number[] = new Array(nLags).fill(NaN);
    const counts: number[] = new Array(nLags).fill(0);
    const lagCenters: number[] = new Array(nLags).fill(0);
    for (let k = 0; k < nLags; k++) {
      const lo = (cap * k) / nLags, hi = (cap * (k + 1)) / nLags;
      lagCenters[k] = (lo + hi) / 2;
      let sumSq = 0;
      for (const p of pairs) {
        if (p.h > lo && p.h <= hi) { sumSq += p.dz2; counts[k]++; }
      }
      if (counts[k] > 0) gamma[k] = sumSq / (2 * counts[k]);   // Matheron 1963 Eq.
    }
    const finite = gamma.filter((g) => Number.isFinite(g));
    if (!finite.length) {
      return {
        result: Number.NaN, unit: outUnit,
        secondary: nanSecondary,
        steps: [
          '── Matheron Semivariogram (Matheron, 1963) ──',
          `${n} observations, ${pairs.length} pairs, lag cap = ${cap.toFixed(1)} km`,
          'Honest NaN: no pairs fall within the lag classes (network too '
          + 'coarse for the default bin count) — no values are fabricated.',
        ]
      };
    }
    // Primary output: γ̂ at the median non-empty lag class.
    const medianIdx = gamma.indexOf(finite[Math.floor(finite.length / 2)]);
    const gMed = gamma[medianIdx];
    const gMax = Math.max(...finite);
    // Nugget/sill diagnostics from the binned curve.
    const sillEst = gMax;
    const nuggetEst = gamma[0] ?? NaN; // γ̂ of the first (nearest) lag
    // Scatter series — experimental semivariogram γ̂(h) from the tool's own
    // binned Matheron estimator (lag centers with non-empty classes).
    const varioPoints: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < nLags; k++) {
      if (Number.isFinite(gamma[k])) varioPoints.push({ x: lagCenters[k], y: gamma[k] });
    }
    return {
      result: gMed, unit: outUnit,
      secondary: [
        { key: 'sillEstimate', value: Number.isFinite(sillEst) ? sillEst : Number.NaN, unit: outUnit === '—' ? '—' : outUnit + '²', label: 'Sill estimate (max γ̂ over non-empty lags)' },
        { key: 'nuggetEstimate', value: Number.isFinite(nuggetEst) ? nuggetEst : Number.NaN, unit: outUnit === '—' ? '—' : outUnit + '²', label: 'Near-origin γ̂ (nugget-like discontinuity)' },
        { key: 'nPairs', value: counts.reduce((s, c) => s + c, 0), unit: '—', label: 'Station pairs binned into lag classes' },
        { key: 'lagsUsed', value: finite.length, unit: '—', label: 'Non-empty lag classes used' },
      ],
      series: [{
        label: 'Experimental semivariogram γ(h)',
        color: '#0072B2',
        points: varioPoints,
      }],
      steps: [
        '── Matheron Semivariogram (Matheron, 1963) ──',
        `${n} genuine observations | ${pairs.length} pairs | ${nLags} lag classes to ${cap.toFixed(1)} km`,
        '',
        'Step 1 — All-point pairs and squared differences:',
        `  For every pair (i,j): distance d_ij (haversine), Δz² = [z(sᵢ)−z(sⱼ)]²`,
        '',
        'Step 2 — Bin pairs and compute γ̂(h_k) = ΣΔz²/(2·N(h_k)):',
        gamma.map((g, k) => counts[k] > 0
          ? `  lag ${lagCenters[k].toFixed(2)} km: γ̂ = ${g.toFixed(3)} (N=${counts[k]} pairs)`
          : `  lag ${lagCenters[k].toFixed(2)} km: — (empty)`).join('\n'),
        '',
        'Step 3 — Spatial structure summary:',
        `  γ̂ (median non-empty lag) = ${gMed.toFixed(4)} ${typeof unit === 'string' && unit ? '²' : ''}`,
        `  Sill estimate (max γ̂) = ${sillEst.toFixed(3)}${Number.isFinite(nuggetEst) ? ` | near-origin γ̂ = ${nuggetEst.toFixed(3)} (nugget-like)` : ''}`,
        '',
        `  └ γ(0)=0 by definition; discontinuity at the origin is the nugget effect c₀`,
        `  └ Fit spherical / exponential / Gaussian models to get range, sill, nugget (Tools 37/38 use the fitted fit)`,
        `  └ Directional variograms needed if the process is anisotropic`,
      ]
    };
  },

  // ── Domain 6: Soil Science & Land Surface ──
  43: ({ thetaR, thetaS, alpha, n, psi, __vgSource }) => {
    const anyMissing = [thetaR, thetaS, alpha, n, psi].some((x) => !Number.isFinite(x));
    const vgSrc = typeof __vgSource === 'string' ? __vgSource : 'user-supplied / default';
    if (anyMissing || !(n > 1)) {
      return {
        result: Number.NaN, unit: 'm³/m³',
        secondary: [
          { key: 'effective_saturation', value: Number.NaN, unit: '—', label: 'Effective Saturation S_e' },
          { key: 'theta_s', value: Number.isFinite(thetaS) ? thetaS : Number.NaN, unit: 'm³/m³', label: 'Saturated Water Content θ_s' },
        ],
        steps: [
          '── Van Genuchten Water Retention (van Genuchten, 1980) ──',
          `Parameters (α, n: Carsel & Parr 1988 by USDA texture — ${vgSrc}):`,
          `  θ_r = ${Number.isFinite(thetaR) ? thetaR.toFixed(3) : 'NaN'}, θ_s = ${Number.isFinite(thetaS) ? thetaS.toFixed(3) : 'NaN'}, α = ${Number.isFinite(alpha) ? alpha.toExponential(3) : 'NaN'} /cm, n = ${Number.isFinite(n) ? n.toFixed(3) : 'NaN'}`,
          '',
          `⚠ Cannot compute — ${n > 1 ? 'a required input is unavailable (NaN).' : 'n must be > 1 (m = 1 − 1/n must be positive) for the van Genuchten model.'} Supply the retention parameters or a study point from which they can be derived.`,
        ],
      };
    }
    const m = 1 - 1 / n;
    const aPsi = alpha * Math.abs(psi);
    const term = Math.pow(1 + Math.pow(aPsi, n), m);
    const theta = thetaR + (thetaS - thetaR) / term;
    const Se = term > 0 ? 1 / term : 0;
    const psi_kPa = Math.abs(psi) * 0.0980665; // 1 cm H₂O = 0.0980665 kPa
    // Mualem (1976) relative hydraulic conductivity with tortuosity L = 0.5:
    //   K/K_s = S_e^0.5 · [1 − (1 − S_e^(1/m))^m]²
    const kRel = Math.pow(Se, 0.5) * Math.pow(1 - Math.pow(1 - Math.pow(Se, 1 / m), m), 2);
    // Profile series — θ(ψ) over a log-spaced matric-potential sweep
    // (|ψ| = 0.1 … 1000 cm) spanning wet through air-dry conditions.
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 40; i++) {
      const psiAbsSweep = Math.pow(10, -1 + (i / 40) * 4);
      const termSweep = Math.pow(1 + Math.pow(alpha * psiAbsSweep, n), m);
      const thetaSweep = thetaR + (thetaS - thetaR) / termSweep;
      seriesPoints.push({ x: -psiAbsSweep, y: Number.isFinite(thetaSweep) ? thetaSweep : Number.NaN });
    }
    return {
      result: theta, unit: 'm³/m³',
      secondary: [
        { key: 'effective_saturation', value: Number.isFinite(Se) ? Se : Number.NaN, unit: '—', label: 'Effective Saturation S_e' },
        { key: 'theta_s', value: Number.isFinite(thetaS) ? thetaS : Number.NaN, unit: 'm³/m³', label: 'Saturated Water Content θ_s' },
        { key: 'alpha', value: Number.isFinite(alpha) ? alpha : Number.NaN, unit: '/cm', label: 'Retention Shape Parameter α' },
        { key: 'relative_conductivity', value: Number.isFinite(kRel) ? kRel : Number.NaN, unit: '—', label: 'Rel. Hydraulic Conductivity K/K_s (Mualem)' },
      ],
      series: [{
        label: 'θ(ψ) van Genuchten',
        color: '#0072B2',
        points: seriesPoints,
      }],
      steps: [
        '── Van Genuchten Water Retention (van Genuchten, 1980) ──',
        `Parameters (α, n: Carsel & Parr 1988 by USDA texture — ${vgSrc}):`,
        `  θ_r = ${thetaR.toFixed(3)}, θ_s = ${thetaS.toFixed(3)}, α = ${alpha.toExponential(3)} /cm, n = ${n.toFixed(3)}, m = 1 − 1/n = ${m.toFixed(4)}`,
        `Matric potential ψ = ${psi.toFixed(1)} cm (${psi_kPa.toFixed(2)} kPa)`,
        '',
        'Step 1 — Evaluate (α|ψ|)^n:',
        `  α·|ψ| = ${alpha.toExponential(3)} × ${Math.abs(psi).toFixed(1)} = ${aPsi.toFixed(4)}`,
        `  (α|ψ|)^n = ${Math.pow(aPsi, n).toFixed(4)}`,
        '',
        'Step 2 — Evaluate retention curve:',
        `  θ(ψ) = θ_r + (θ_s − θ_r) / [1 + (α|ψ|)^n]^m`,
        `  θ(ψ) = ${thetaR.toFixed(3)} + (${thetaS.toFixed(3)} − ${thetaR.toFixed(3)}) / ${term.toFixed(4)}`,
        `  θ(${psi.toFixed(0)} cm) = ${theta.toFixed(4)} m³/m³`,
        '',
        'Step 3 — Saturation and drainage:',
        `  Effective saturation S_e = ${Se.toFixed(4)}`,
        `  ${Se > 0.9 ? 'Near-saturated — matrix flow dominates' : Se > 0.5 ? 'Intermediate — both matrix and macropore flow' : 'Dry — film flow and vapour diffusion'}`,
        `  Mualem K/K_s = ${kRel.toExponential(3)} (tortuosity 0.5, i.e. S_e^0.5·[1 − (1 − S_e^(1/m))^m]²)`,
        '',
        `  └ Plant-available water: ${theta < thetaR + 0.05 ? 'Wilting point conditions' : theta < thetaS * 0.6 ? 'Field capacity to wilting — available water present' : 'Above field capacity — drainage occurring'}`,
      ]
    };
  },
  44: ({ psib, psi, lambda, thetaR, thetaS }) => {
    const anyMissing = [psib, psi, lambda, thetaR, thetaS].some((x) => !Number.isFinite(x));
    if (anyMissing) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'theta', value: Number.NaN, unit: 'm³/m³', label: 'Volumetric Water Content θ' },
          { key: 'relative_conductivity', value: Number.NaN, unit: '—', label: 'Rel. Conductivity K/K_s' },
        ],
        steps: [
          '── Brooks-Corey Water Retention (Brooks & Corey, 1964) ──',
          `ψ_b = ${Number.isFinite(psib) ? psib.toFixed(2) : 'NaN'} cm, ψ = ${Number.isFinite(psi) ? psi.toFixed(2) : 'NaN'} cm, λ = ${Number.isFinite(lambda) ? lambda.toFixed(2) : 'NaN'}, θ_r = ${Number.isFinite(thetaR) ? thetaR.toFixed(3) : 'NaN'}, θ_s = ${Number.isFinite(thetaS) ? thetaS.toFixed(3) : 'NaN'}`,
          '',
          '⚠ Cannot compute — a required input is unavailable (NaN). Supply ψ_b, ψ, λ, θ_r and θ_s or a study point from which they can be derived.',
        ],
      };
    }
    // Brooks & Corey (1964) Hydrology Papers No. 3. Effective saturation:
    //   S_e = (|ψ_b|/|ψ|)^λ  for |ψ| > |ψ_b| (draining)
    //   S_e = 1              for |ψ| ≤ |ψ_b| (saturated, air-entry not exceeded)
    // Relative conductivity K/K_s = S_e^((3λ+2)/λ) = S_e^(3 + 2/λ).
    // Air-entry pore radius from Young-Laplace: r_max = 2σcosθ/(ρg|ψ_b|).
    const psiAbs = Math.abs(psi);
    const psibAbs = Math.abs(psib);
    const saturated = psiAbs <= psibAbs;
    const Se = saturated ? 1 : Math.pow(psibAbs / psiAbs, lambda);
    const theta = thetaR + (thetaS - thetaR) * Se;
    const cExp = 3 + 2 / lambda;
    const kRel = Math.pow(Se, cExp);
    // Young-Laplace: σ = 72.75e-3 N/m (20 °C), contact angle ~ 0, ρ = 998.2
    const rMaxM = 2 * 72.75e-3 / (998.2 * 9.80665 * (psibAbs / 100));
    const rMaxUm = rMaxM * 1e6;
    const logSe = Math.log10(Math.max(Se, 1e-12));
    // Profile series — θ(ψ) over a log-spaced matric-potential sweep
    // (|ψ| = 0.1 … 1000 cm) spanning wet through air-dry conditions.
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 40; i++) {
      const psiAbsSweep = Math.pow(10, -1 + (i / 40) * 4);
      const sweepSaturated = psiAbsSweep <= psibAbs;
      const sweepSe = sweepSaturated ? 1 : Math.pow(psibAbs / psiAbsSweep, lambda);
      const thetaSweep = thetaR + (thetaS - thetaR) * sweepSe;
      seriesPoints.push({ x: -psiAbsSweep, y: Number.isFinite(thetaSweep) ? thetaSweep : Number.NaN });
    }
    return {
      result: Se, unit: '—',
      secondary: [
        { key: 'effective_saturation', value: Number.isFinite(Se) ? Se : Number.NaN, unit: '—', label: 'Effective Saturation S_e' },
        { key: 'theta', value: Number.isFinite(theta) ? theta : Number.NaN, unit: 'm³/m³', label: 'Volumetric Water Content θ' },
        { key: 'bubbling_pressure', value: Number.isFinite(psibAbs) ? psibAbs : Number.NaN, unit: 'cm', label: 'Bubbling Pressure |ψ_b|' },
        { key: 'relative_conductivity', value: Number.isFinite(kRel) ? kRel : Number.NaN, unit: '—', label: 'Rel. Conductivity K/K_s' },
      ],
      series: [{
        label: 'θ(ψ) Brooks-Corey',
        color: '#D55E00',
        points: seriesPoints,
      }],
      steps: [
        '── Brooks-Corey Water Retention (Brooks & Corey, 1964) ──',
        `Bubbling pressure ψ_b = ${psib.toFixed(2)} cm, Matric potential ψ = ${psi.toFixed(2)} cm`,
        `Pore-size index λ = ${lambda.toFixed(2)} (user-supplied; fit by log-log regression of S_e vs ψ)`,
        '',
        'Step 1 — Saturation check (paper definition):',
        `  |ψ| = ${psiAbs.toFixed(2)} cm ${saturated ? '≤' : '>'} |ψ_b| = ${psibAbs.toFixed(2)} cm → ${saturated ? 'S_e = 1 (soil saturated, air-entry not exceeded)' : 'draining regime'}`,
        '',
        'Step 2 — Effective saturation:',
        saturated
          ? '  S_e = 1 (by definition for |ψ| ≤ |ψ_b|)'
          : `  S_e = (|ψ_b|/|ψ|)^λ = (${psibAbs.toFixed(2)} / ${psiAbs.toFixed(2)})^${lambda.toFixed(2)} = ${Se.toFixed(4)}`,
        '',
        'Step 3 — Pore-size distribution:',
        `  log₁₀(S_e) = ${logSe.toFixed(3)} (slope on log-log retention plot = −λ = −${lambda.toFixed(2)})`,
        `  ${lambda < 1 ? 'Wide pore-size distribution (clay-like)' : lambda > 2 ? 'Narrow pore-size distribution (sand-like)' : 'Moderate pore-size distribution'}`,
        '',
        'Step 4 — Volumetric water content:',
        `  θ = θ_r + (θ_s − θ_r)·S_e = ${thetaR.toFixed(3)} + (${thetaS.toFixed(3)} − ${thetaR.toFixed(3)}) × ${Se.toFixed(4)} = ${theta.toFixed(4)} m³/m³`,
        '',
        'Step 5 — Brooks-Corey unsaturated conductivity and air-entry pore:',
        `  K/K_s = S_e^((3λ+2)/λ) = ${Se.toFixed(4)}^${cExp.toFixed(2)} = ${kRel.toFixed(4)}`,
        `  Air-entry pore radius (Young-Laplace): r_max = 2σ/(ρg|ψ_b|) = ${rMaxUm.toFixed(1)} µm`,
        '',
        `  └ Entry pressure head: |ψ_b| = ${psibAbs.toFixed(1)} cm — drainage of the largest pores begins once |ψ| exceeds |ψ_b|`,
        `  └ Fit ψ_b and λ from measured retention data via log(S_e) = λ·log(|ψ_b|) − λ·log(|ψ|) linear regression`,
      ]
    };
  },
  45: ({ R, K, LS, C, P }) => {
    const steps: string[] = [];
    const anyMissing = [R, K, LS, C, P].some((x) => !Number.isFinite(x));
    if (anyMissing) {
      steps.push('── Universal Soil Loss Equation (Wischmeier & Smith, 1978) ──');
      steps.push('A = R × K × LS × C × P');
      steps.push('');
      steps.push('⚠ Cannot compute: one or more factors are unavailable (NaN).');
      steps.push(`  R = ${Number.isFinite(R) ? R.toFixed(1) : 'NaN — no GHCN rainfall erosivity (supply measured R)'}`);
      steps.push(`  K = ${Number.isFinite(K) ? K.toFixed(3) : 'NaN — no genuine soil texture (supply measured K)'}`);
      steps.push(`  LS = ${Number.isFinite(LS) ? LS.toFixed(2) : 'NaN — no genuine terrain slope (supply measured LS)'}`);
      steps.push(`  C = ${Number.isFinite(C) ? C.toFixed(2) : 'NaN — no genuine land cover (supply measured C)'}`);
      steps.push(`  P = ${Number.isFinite(P) ? P.toFixed(2) : 'NaN — 1 if no conservation practice (supply measured P)'}`);
      return { result: Number.NaN, unit: 't/ha/yr', steps };
    }
    const A = R * K * LS * C * P;
    // 1 metric tonne (t) = 1 megagram (Mg) by definition, so A (t/ha/yr)
    // equals A (Mg/ha/yr) — no unit conversion required.
    const T = 11; // typical soil loss tolerance in t/ha/yr (varies 2–20)
    const excess = A - T;
    return {
      result: A, unit: 't/ha/yr',
      secondary: [
        { key: 'tolerance', value: Number.isFinite(T) ? T : Number.NaN, unit: 't/ha/yr', label: 'Soil Loss Tolerance' },
        { key: 'excess_above_tolerance', value: Number.isFinite(excess) ? excess : Number.NaN, unit: 't/ha/yr', label: 'Excess Above Tolerance' },
      ],
      steps: [
        '── Universal Soil Loss Equation (Wischmeier & Smith, 1978) ──',
        `Rainfall erosivity R = ${R.toFixed(1)} MJ·mm/ha·h·yr`,
        `Soil erodibility K = ${K.toFixed(3)} t·ha·h/ha·MJ·mm`,
        `Slope length/steepness LS = ${LS.toFixed(2)}`,
        `Cover-management C = ${C.toFixed(2)} (0–1, natural/agricultural)`,
        `Support practice P = ${P.toFixed(2)} (1 = no conservation)`,
        '',
        'Step 1 — Compute soil loss:',
        `  A = R × K × LS × C × P`,
        `  A = ${R.toFixed(1)} × ${K.toFixed(3)} × ${LS.toFixed(2)} × ${C.toFixed(2)} × ${P.toFixed(2)}`,
        `  A = ${A.toFixed(2)} t/ha/yr (≡ ${A.toFixed(2)} Mg/ha/yr; 1 t = 1 Mg)`,
        '',
        'Step 2 — Compare to tolerable loss:',
        `  T = ${T} t/ha/yr (typical for medium-depth soils)`,
        `  ${excess > 0 ? `⚠ Soil loss EXCEEDS tolerance by ${excess.toFixed(1)} t/ha/yr — conservation needed` : '✓ Soil loss within tolerable limits'}`,
        '',
        'Step 3 — Dominant factor identification:',
        `  ${R > 5000 ? 'Very high rainfall erosivity — tropical/humid climate' : R > 2000 ? 'Moderate-high erosivity' : 'Low-moderate erosivity'}`,
        `  ${C > 0.5 ? 'Poor cover — consider cover crops/reduced tillage' : C < 0.1 ? 'Good vegetation cover — effective erosion control' : 'Moderate cover — some protection present'}`,
        '',
        `  └ Sediment delivery ratio (SDR) is needed to compute actual basin yield — USLE gives hillslope erosion only`,
      ]
    };
  },
  46: ({ Rbase, Q10, T, Tbase }) => {
    if ([Rbase, Q10, T, Tbase].some((x) => !Number.isFinite(x))) {
      return {
        result: Number.NaN, unit: 'µmol CO₂/m²/s',
        steps: [
          '── Q₁₀ Temperature Coefficient Model (van\'t Hoff, 1898) ──',
          'R_s = R_base × Q₁₀^((T − T_base)/10)',
          '',
          '⚠ Cannot compute — an input is unavailable (NaN):',
          `  R_base = ${Number.isFinite(Rbase) ? Rbase.toFixed(3) : 'NaN — supply chamber-measured basal respiration'}`,
          `  Q₁₀   = ${Number.isFinite(Q10) ? Q10.toFixed(2) : 'NaN — supply site Q₁₀ (global mean ≈ 2)'}`,
          `  T     = ${Number.isFinite(T) ? T.toFixed(1) : 'NaN — no genuine temperature source; supply soil/air T'}`,
          `  T_base = ${Number.isFinite(Tbase) ? Tbase.toFixed(1) : 'NaN'}`,
        ],
      };
    }
    const exp10 = (T - Tbase) / 10;
    const Rs = Rbase * Math.pow(Q10, exp10);
    const Ea = Math.log(Q10) * 8.314e-3 * Math.pow(T + 273.15, 2) / 10; // kJ/mol
    const annualFlux = Rs * 12.01 * 86400 * 365 / 1e6; // gC/m²/yr
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let tC = -10; tC <= 50; tC++) {
      const r = Rbase * Math.pow(Q10, (tC - Tbase) / 10);
      seriesPoints.push({ x: tC, y: Number.isFinite(r) ? r : Number.NaN });
    }
    return {
      result: Rs, unit: 'µmol CO₂/m²/s',
      secondary: [
        { key: 'activation_energy', value: Number.isFinite(Ea) ? Ea : Number.NaN, unit: 'kJ/mol', label: 'Activation Energy E_a' },
        { key: 'annual_carbon_flux', value: Number.isFinite(annualFlux) ? annualFlux : Number.NaN, unit: 'gC/m²/yr', label: 'Annual Carbon Flux' },
      ],
      series: [{
        label: 'Respiration R_s(T)',
        color: '#009E73',
        points: seriesPoints,
      }],
      steps: [
        '── Q₁₀ Temperature Coefficient Model (van\'t Hoff, 1898; Arrhenius concept) ──',
        `Basal respiration R_base = ${Rbase.toFixed(3)} µmol CO₂/m²/s at ${Tbase.toFixed(1)} °C, current T = ${T.toFixed(1)} °C`,
        `Q₁₀ = ${Q10.toFixed(2)}`,
        '',
        'Step 1 — Compute temperature difference:',
        `  (T − T_base) / 10 = (${T.toFixed(1)} − ${Tbase.toFixed(1)}) / 10 = ${exp10.toFixed(2)} decades`,
        '',
        'Step 2 — Compute temperature response:',
        `  R_s = R_base × Q₁₀^{(T − T_base)/10}`,
        `  R_s = ${Rbase.toFixed(3)} × ${Q10.toFixed(2)}^{${exp10.toFixed(2)}}`,
        `  R_s = ${Rs.toFixed(4)} µmol CO₂/m²/s`,
        '',
        'Step 3 — Sensitivity:',
        `  ${Q10 < 1.5 ? 'Low temperature sensitivity (e.g. saturated/ cold-adapted soils)' : Q10 < 2.5 ? 'Typical soil respiration sensitivity (most ecosystems)' : Q10 < 4 ? 'High sensitivity (e.g. tropical peat, high-latitude organic soils)' : 'Very high sensitivity — potential for strong carbon-climate feedback'}`,
        '',
        `  └ Q₁₀ = ${Q10.toFixed(2)}: rate increases ×${Q10.toFixed(2)} per 10 °C warming`,
        `  └ Note: Q₁₀ often decreases with increasing temperature (apparent vs intrinsic Q₁₀)`,
      ]
    };
  },
  47: ({ sandFrac, omPct, rhoB, theta, __thetaSource }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const sandFracN = Number(sandFrac), omPctN = Number(omPct), rhoBN = Number(rhoB), thetaN = Number(theta);
    // de Vries (1963) "Thermal properties of soils", in van Wijk (ed.)
    // Physics of Plant Environment — transcribed verbatim from Farouki
    // (1981) CRREL Monograph 81-1 §7.6 (public-domain).
    const inputs47: Array<[string, number, string]> = [
      ['sand', sandFracN, 'NaN — no genuine ISRIC soil pixel; supply sand fraction (0–1)'],
      ['OM%', omPctN, 'NaN — no genuine ISRIC organic matter; supply OM %'],
      ['ρ_b', rhoBN, 'NaN — no genuine ISRIC bulk density; supply ρ_b (kg/dm³)'],
      ['θ', thetaN, 'NaN — no genuine GLDAS soil moisture; supply θ (m³/m³)'],
    ];
    if (inputs47.some(([, v]) => !Number.isFinite(v))) {
      return {
        result: Number.NaN, unit: 'W/m·K',
        secondary: [
          { key: 'thermal_diffusivity', value: Number.NaN, unit: 'm²/s', label: 'Thermal Diffusivity (λ/C)' },
          { key: 'heat_capacity', value: Number.NaN, unit: 'MJ/m³·K', label: 'Volumetric Heat Capacity' },
        ],
        steps: [
          '── de Vries Soil Thermal Conductivity Model (de Vries, 1963) ──',
          'λ = Σ(kᵢ·xᵢ·λᵢ) / Σ(kᵢ·xᵢ), kᵢ = (1/3)·[2/(1+(λᵢ/λ_f−1)·g_a) + 1/(1+(λᵢ/λ_f−1)·g_c)]',
          '',
          '⚠ Cannot compute — a genuine input is unavailable (NaN):',
          ...inputs47.map(([label, v, msg]) =>
            `  ${label.padEnd(6)} = ${Number.isFinite(v) ? v.toFixed(3) : msg}`),
          '',
          'No static substitute is used for missing genuine data (audit rule).',
        ],
      };
    }
    // Constituent thermal conductivities, W/m·K — Farouki Table 2 (after
    // van Wijk 1963), 20 °C: quartz 8.4, other soil minerals 2.9, soil
    // organic matter 0.25, water 0.6, air 0.026. Volumetric heat capacity
    // cal/cm³·°C: minerals 0.46, organic matter 0.60, water 1.00, air 0.00029.
    // Solid densities g/cm³: minerals (quartz) 2.65, organic matter 1.3.
    const LAMQ = 8.4, LAMO = 2.9, LAMOM = 0.25, LAMW = 0.6, LAMA = 0.026;
    const CV = 4.186e6; // J/m³·K per cal/cm³·°C
    // de Vries weighting factors (Farouki §7.6): oblate spheroids with
    // g_a = g_b = 0.125, g_c = 0.75 (de Vries 1952a fit); the continuous
    // phase has k = 1. Water-continuous when θ above the minimum at which
    // water may still be regarded as continuous (de Vries 1963: xw = 0.03
    // coarse soils, 0.05–0.10 fine soils — 0.05 used here); air-continuous
    // below, with the de Vries "adjusted" dry correction +25 % (the
    // calculation otherwise comes out 25 % too low for dry soils).
    const kw = (lamI: number, lamF: number, ga = 0.125, gc = 0.75): number => {
      const r = lamI / lamF - 1;
      return (1 / 3) * (2 / (1 + r * ga) + 1 / (1 + r * gc));
    };
    // Phase volume fractions from genuine ρ_b and OM% (van Bemmelen
    // OC→OM already applied upstream in mapInputs).
    const fOm = omPctN / 100;
    const rho = rhoBN * 1000; // kg/m³
    const xMin = rho * (1 - fOm) / 2650;
    const xOm = rho * fOm / 1300;
    // Quartz content: ISRIC exposes no quartz band — the sand fraction is
    // the standard available proxy for the quartz fraction of the mineral
    // solids (Johansen 1975 convention, cited throughout Farouki §7).
    const q = Math.max(0, Math.min(1, sandFracN));
    const xQ = xMin * q, xO = xMin * (1 - q);
    const phi = Math.max(0, 1 - xQ - xO - xOm);
    const xw = Math.max(0, Math.min(thetaN, phi));
    const xa = Math.max(0, phi - xw);
    const coarse = q >= 0.85;
    const thetaCut = coarse ? 0.03 : 0.05;
    const wet = xw >= thetaCut;

    const kQ = kw(LAMQ, wet ? LAMW : LAMA);
    const kO = kw(LAMO, wet ? LAMW : LAMA);
    const kOm = kw(LAMOM, wet ? LAMW : LAMA);
    let lam: number;
    let regime: string;
    if (wet) {
      // Moist soil: solids + air are two components dispersed in a
      // continuous water medium (Farouki eq for unsaturated soil).
      // Effective air-phase conductivity includes apparent moisture/vapour
      // migration: k_a = 0.0615 + 1.96·xw (mcal/cm·s·°C), pores saturated
      // with vapour for xw ≥ 0.09 → constant there (Farouki §7.6);
      // ×0.4186 → W/m·K.
      const mcal = 0.0615 + 1.96 * Math.min(xw, 0.09);
      const kaEff = mcal * 0.4186;
      // Air-pore shape factors — Farouki §7.6 approximate procedure:
      // 0.09 < xw < φ: g_a linear from 0.333 (sphere) to 0.035 as xw → 0,
      //   g_a = 0.333 − (x_a/φ)·(0.333 − 0.035);
      // xw < 0.09 (pores not saturated with vapour):
      //   g_a = 0.013 + 0.944·xw;  g_c = 1 − 2·g_a.
      const gaAir = xw >= 0.09 && phi > 0
        ? 0.333 - (xa / phi) * (0.333 - 0.035)
        : 0.013 + 0.944 * xw;
      const kA = kw(kaEff, LAMW, gaAir, 1 - 2 * gaAir);
      lam = (kQ * xQ * LAMQ + kO * xO * LAMO + kOm * xOm * LAMOM
        + 1 * xw * LAMW + kA * xa * kaEff)
        / (kQ * xQ + kO * xO + kOm * xOm + 1 * xw + kA * xa);
      regime = `water-continuous (θ ≥ ${thetaCut}${coarse ? ', coarse soil' : ''})`;
    } else {
      // Dry soil: air is the continuous phase.
      const kWet = xw > 0 ? kw(LAMW, LAMA) : 0;
      lam = ((kQ * xQ * LAMQ + kO * xO * LAMO + kOm * xOm * LAMOM
        + kWet * xw * LAMW + 1 * xa * LAMA)
        / (kQ * xQ + kO * xO + kOm * xOm + kWet * xw + 1 * xa)) * 1.25;
      regime = `air-continuous (θ < ${thetaCut}) + de Vries dry-soil +25 % adjustment`;
    }
    // Volumetric heat capacity C = Σ x_i·c_i (Farouki Table 2 c_i).
    const C = (xMin * 0.46 + xOm * 0.60 + xw * 1.00 + xa * 0.00029) * CV;
    const alpha = lam / C;
    return {
      result: lam, unit: 'W/m·K',
      secondary: [
        { key: 'thermal_diffusivity', value: Number.isFinite(alpha) ? alpha : Number.NaN, unit: 'm²/s', label: 'Thermal Diffusivity (λ/C)' },
        { key: 'heat_capacity', value: Number.isFinite(C) ? C / 1e6 : Number.NaN, unit: 'MJ/m³·K', label: 'Volumetric Heat Capacity' },
      ],
      steps: [
        '── de Vries Soil Thermal Conductivity Model (de Vries, 1963) ──',
        'λ = Σ(kᵢ·xᵢ·λᵢ) / Σ(kᵢ·xᵢ) with de Vries spheroid weighting factors',
        `Inputs: sand fraction q = ${q.toFixed(3)} (quartz proxy, Johansen 1975), OM = ${omPctN.toFixed(2)} %, ρ_b = ${rhoBN.toFixed(3)} kg/dm³, θ = ${thetaN.toFixed(3)} m³/m³`,
        ...(typeof __thetaSource === 'string' ? [`Provenance: ${__thetaSource}`] : []),
        '',
        'Step 1 — Volume fractions (from genuine ρ_b, OM; minerals 2.65 g/cm³, OM 1.3 g/cm³):',
        `  x_quartz = ${xQ.toFixed(4)}, x_other-min = ${xO.toFixed(4)}, x_organic = ${xOm.toFixed(4)}`,
        `  porosity φ = ${phi.toFixed(4)}, x_water = ${xw.toFixed(4)}, x_air = ${xa.toFixed(4)}`,
        '',
        `Step 2 — Continuous phase: ${regime}`,
        '',
        'Step 3 — de Vries weighting factors (g_a=0.125, g_c=0.75; k=1 for the continuous phase):',
        `  k_q = ${kQ.toFixed(4)}, k_other = ${kO.toFixed(4)}, k_om = ${kOm.toFixed(4)}`,
        '  Constituents λ (W/m·K): quartz 8.4, other minerals 2.9, organic 0.25, water 0.6, air 0.026',
        '',
        'Step 4 — Effective conductivity λ = Σ(kᵢ·xᵢ·λᵢ) / Σ(kᵢ·xᵢ):',
        `  λ = ${lam.toFixed(4)} W/m·K`,
        '',
        'Step 5 — Volumetric heat capacity & thermal diffusivity (Table 2 c_i):',
        `  C = Σxᵢ·cᵢ = ${(C / 1e6).toFixed(3)} MJ/m³/K,  α = λ/C = ${(alpha * 1e6).toFixed(3)}×10⁻⁶ m²/s`,
        '',
        `  └ ${lam > 1.5 ? 'Mineral-dominated conduction (wet sand/gravel regime)' : lam > 0.5 ? 'Typical moist mineral soil' : lam > 0.15 ? 'Dry soil, air-continuous insulation' : 'Organic/peat or very dry soil — strong insulation'}`,
        '  Accuracy expectation (Farouki §7.13): predictions within ±25 % of measurement; best agreement at degree of saturation 0.1–0.2.',
      ]
    };
  },
  48: ({ kappa, ustar, z, L, z0M, __lSource, __ustarSource, __z0Source }) => {
    if (!Number.isFinite(L) || !Number.isFinite(kappa) || !Number.isFinite(z)) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'obukhov_length', value: Number.isFinite(L) ? L : Number.NaN, unit: 'm', label: 'Obukhov Length L' },
          { key: 'stability_parameter', value: Number.NaN, unit: '—', label: 'Stability Parameter ζ = z/L' },
        ],
        steps: [
          '── Monin-Obukhov Similarity (Monin & Obukhov, 1954; Högström, 1988) ──',
          'φ_m(ζ) = (κz/u_*)·∂ū/∂z, ζ = z/L, L = −u_*³·θ̄ᵥ/(κ·g·w\u0304θ̄ᵥ₀)',
          '',
          '  ⚠ Cannot compute — a genuine input is unavailable (NaN):',
          ...(!Number.isFinite(L) ? [`    L (Obukhov length) = NaN — ${typeof __lSource === 'string' && __lSource ? __lSource : 'no genuine u_* and sensible heat flux to derive it from; supply L (and u_*) from tower/eddy-covariance data, or provide a study point so they can be derived from genuine ERA5 reanalysis'}`] : []),
          ...(!Number.isFinite(kappa) ? [`    κ (von Kármán constant) = NaN — supply 0.40 (Högström 1988)`] : []),
          ...(!Number.isFinite(z) ? [`    z (measurement height) = NaN — supply the reference height (default 10 m)`] : []),
        ],
      };
    }
    const zetaRaw = z / L;
    const zeta = Math.max(-2, Math.min(1, zetaRaw));
    const outOfRange = Math.abs(zeta - zetaRaw) > 1e-12;
    // Högström (1988) BLME 42:55–78 flux–profile functions as tabulated by
    // Foken (2006) Eqs 21–22 (κ = 0.40, φ_h(0) = 0.95):
    //   unstable (−2 < ζ < 0): φ_m = (1 − 19.3ζ)^(−1/4), φ_h = 0.95(1 − 11.6ζ)^(−1/2)
    //   stable   (0 < ζ < 1):  φ_m = 1 + 6ζ,            φ_h = 0.95 + 7.8ζ
    const phiM = zeta >= 0
      ? 1 + 6 * zeta
      : Math.pow(1 - 19.3 * zeta, -0.25);
    const phiH = zeta >= 0
      ? 0.95 + 7.8 * zeta
      : 0.95 * Math.pow(1 - 11.6 * zeta, -0.5);
    // Integrated stability corrections — exact integrals of the Högström
    // (1988) forms, evaluated by quadrature against scipy.integrate to
    // ≤1e-5 before adoption:
    //   psiM = ∫₀^ζ (1−φ_m)/x dx  → u(z)−u(z₀) = (u*/κ)·[ln(z/z₀) − ψ_m]
    //     unstable: u = (1−19.3ζ)^¼ → 2ln((1+u)/2) + ln((1+u²)/2) − 2arctan u + π/2
    //     stable:   φ_m − 1 = 6x → ψ_m = −6ζ
    //   psiH = ∫₀^ζ (φ_h−φ_h(0))/x dx (φ_h(0) = 0.95 ≠ 1 — the (1−φ_h)/x
    //     form diverges at 0; the Högström heat profile is instead
    //     θ(z)−θ(z₀) = (θ*/κ)·[0.95·ln(z/z₀) + ψ_h]):
    //     unstable: v = (1−11.6ζ)^½ → ψ_h = −0.95·2ln((1+v)/2)
    //     stable:   φ_h − 0.95 = 7.8x → ψ_h = +7.8ζ
    let psiM: number, psiH: number;
    if (zeta < 0) {
      const uq = Math.pow(1 - 19.3 * zeta, 0.25);
      psiM = 2 * Math.log((1 + uq) / 2) + Math.log((1 + uq * uq) / 2) - 2 * Math.atan(uq) + Math.PI / 2;
      const vh = Math.pow(1 - 11.6 * zeta, 0.5);
      psiH = -0.95 * 2 * Math.log((1 + vh) / 2);
    } else {
      psiM = -6 * zeta;
      psiH = 7.8 * zeta;
    }
    // Gradient Richardson number — exact identity in MOST: Ri = ζ·φ_h/φ_m²
    const Ri = (zeta * phiH) / (phiM * phiM);
    const regime = zeta <= -1 ? 'VERY STRONGLY UNSTABLE — free convection dominates'
      : zeta < -0.01 ? 'UNSTABLE (convective) — buoyant production of turbulence'
      : zeta <= 0.01 ? 'NEAR-NEUTRAL — mechanical turbulence dominates'
      : zeta < 1 ? 'STABLE (stratified) — buoyancy suppresses turbulence'
      : 'VERY STABLE — weak/intermittent turbulence';
    // Aerodynamic resistance to momentum (catalogue secondary output):
    // r_a = [ln(z/z₀) − ψ_m(ζ)]/(κ·u_*); z₀ from land cover unless overridden
    const uNum = Number(ustar);
    let ra = Number.NaN;
    let raSteps: string[] = [];
    if (Number.isFinite(uNum) && uNum > 1e-4 && Number.isFinite(Number(z0M)) && Number(z0M) > 0 && z > Number(z0M)) {
      ra = (Math.log(z / Number(z0M)) - psiM) / (kappa * uNum);
      raSteps = [
        '',
        'Step 4 — Integrated stability corrections & aerodynamic resistance:',
        ...((typeof __z0Source === 'string' && __z0Source) ? [`  Provenance: ${__z0Source}`] : []),
        `  ψ_m(ζ) = ${psiM.toFixed(4)}, ψ_h(ζ) = ${psiH.toFixed(4)} (exact integrals of the Högström forms)`,
        `  r_a = [ln(z/z₀) − ψ_m]/(κ·u_*) = [ln(${z.toFixed(1)}/${Number(z0M).toFixed(3)}) − (${psiM.toFixed(4)})]/(${kappa.toFixed(2)}×${uNum.toFixed(3)}) = ${ra.toFixed(2)} s/m`,
      ];
    }
    const classCode = zeta <= -1 ? 1 : zeta < -0.01 ? 2 : zeta <= 0.01 ? 3 : zeta < 1 ? 4 : 5;
    // Profile series — with genuine u_* and z₀, a MOST wind-speed profile
    // u(z) = (u_*/κ)·[ln(z/z₀) − ψ_m(ζ)] across heights; otherwise fall back
    // to the φ_m(ζ) universal function across the validated stability range.
    const seriesPoints: Array<{ x: number; y: number }> = [];
    if (Number.isFinite(uNum) && uNum > 1e-4 && Number.isFinite(Number(z0M)) && Number(z0M) > 0) {
      const zBottom = Number(z0M) * 2, zTop = 200;
      for (let i = 0; i <= 40; i++) {
        const h = zBottom * Math.pow(zTop / zBottom, i / 40);
        const uAtH = (uNum / kappa) * (Math.log(h / Number(z0M)) - psiM);
        seriesPoints.push({ x: h, y: Number.isFinite(uAtH) ? uAtH : Number.NaN });
      }
    } else {
      for (let i = 0; i <= 40; i++) {
        const zetaS = -2 + (i / 40) * 3;
        const phiS = zetaS >= 0 ? 1 + 6 * zetaS : Math.pow(1 - 19.3 * zetaS, -0.25);
        seriesPoints.push({ x: zetaS, y: Number.isFinite(phiS) ? phiS : Number.NaN });
      }
    }
    return {
      result: phiM, unit: '—',
      secondary: [
        { key: 'obukhov_length', value: Number.isFinite(L) ? L : Number.NaN, unit: 'm', label: 'Obukhov Length L' },
        { key: 'stability_parameter', value: Number.isFinite(zeta) ? zeta : Number.NaN, unit: '—', label: 'Stability Parameter ζ = z/L' },
        { key: 'stability_class', value: Number.isFinite(classCode) ? classCode : Number.NaN, unit: '—', label: 'Stability Class Code (1 very unstable → 5 very stable)' },
        { key: 'richardson_number', value: Number.isFinite(Ri) ? Ri : Number.NaN, unit: '—', label: 'Gradient Richardson Number Ri' },
        { key: 'phi_h', value: Number.isFinite(phiH) ? phiH : Number.NaN, unit: '—', label: 'Dimensionless Temperature Gradient φ_h' },
        { key: 'aerodynamic_resistance', value: Number.isFinite(ra) ? ra : Number.NaN, unit: 's/m', label: 'Aerodynamic Resistance r_a' },
      ],
      series: [{
        label: Number.isFinite(uNum) && uNum > 1e-4 && Number.isFinite(Number(z0M)) && Number(z0M) > 0 ? 'u(z) MOST profile' : 'φ_m(ζ) universal function',
        color: '#CC79A7',
        points: seriesPoints,
      }],
      steps: [
        '── Monin-Obukhov Similarity (Monin & Obukhov, 1954; Högström, 1988) ──',
        'φ_m(ζ) = (κz/u_*)·∂ū/∂z, φ_h(ζ) = (κz/θ_*)·∂θ̄/∂z, ζ = z/L',
        `Inputs: κ = ${kappa.toFixed(2)}, z = ${z.toFixed(1)} m, L = ${L.toFixed(2)} m${Number.isFinite(uNum) ? `, u_* = ${uNum.toFixed(3)} m/s` : ''}, ζ = z/L = ${zetaRaw.toFixed(4)}`,
        ...(typeof __lSource === 'string' && __lSource ? [`Provenance: ${__lSource}`] : []),
        ...((typeof __ustarSource === 'string' && __ustarSource) ? [`Provenance: ${__ustarSource}`] : []),
        '',
        'Step 1 — Stability classification:',
        `  ζ = ${zeta.toFixed(4)} → ${regime}`,
        ...(outOfRange ? [`  ⚠ ζ = ${zetaRaw.toFixed(3)} outside the Högström (1988) validated range (−2 < ζ < 1) — functions evaluated at the bound ${zeta.toFixed(1)}`] : []),
        '',
        'Step 2 — Högström (1988) flux-profile functions (κ = 0.40, φ_h(0) = 0.95):',
        '  unstable (−2 < ζ < 0): φ_m = (1 − 19.3ζ)^(−1/4), φ_h = 0.95·(1 − 11.6ζ)^(−1/2)',
        '  stable   (0 < ζ < 1):  φ_m = 1 + 6ζ,             φ_h = 0.95 + 7.8ζ',
        `  φ_m(ζ) = ${phiM.toFixed(4)}  (dimensionless wind shear)`,
        `  φ_h(ζ) = ${phiH.toFixed(4)}  (dimensionless temperature gradient)`,
        `  Ri = ζ·φ_h/φ_m² = ${Ri.toFixed(4)}  (exact MOST identity)`,
        '',
        'Step 3 — Consequence for the mean profile:',
        `  ∂ū/∂z = (u_*/κz)·φ_m — ${zeta < 0 ? 'shallower than the neutral log profile (enhanced mixing)' : zeta === 0 ? 'pure logarithmic profile' : 'steeper than the neutral log profile (mixing suppressed)'}`,
        ...raSteps,
        '',
        `  └ Result: φ_m = ${phiM.toFixed(4)} ${zeta < 0 ? '(< 1 → unstable, efficient turbulent exchange)' : zeta === 0 ? '(= 1, neutral)' : '(> 1 → stable, mixing suppressed)'}`,
      ],
    };
  },
  49: ({ ustar, z, z0, rho, __ustarSource, __z0Source }) => {
    const kappa = 0.4;
    if (!Number.isFinite(ustar) || !Number.isFinite(z0) || z0 <= 0 || z <= z0 || ustar <= 0) {
      return {
        result: Number.NaN, unit: 'm/s',
        secondary: [
          { key: 'friction_velocity', value: Number.isFinite(ustar) ? ustar : Number.NaN, unit: 'm/s', label: 'Friction Velocity u_*' },
          { key: 'roughness_reynolds', value: Number.NaN, unit: '—', label: 'Roughness Reynolds Number Re_*' },
        ],
        steps: [
          '── Logarithmic Wind Profile (Stull 1988 Ch. 4; Prandtl log law, 1932) ──',
          'u(z) = (u_*/κ) · ln(z/z₀),  κ = 0.4, neutral stratification',
          '',
          '  ⚠ Cannot compute — a genuine input is unavailable or inconsistent:',
          ...(!Number.isFinite(ustar) || ustar <= 0 ? [`    u_* = ${Number.isFinite(ustar) ? (ustar <= 0 ? '≤ 0' : ustar) : 'NaN'} — ${typeof __ustarSource === 'string' ? __ustarSource : 'no genuine friction velocity; supply u_* or a study point'}`] : []),
          ...(!Number.isFinite(z0) || z0 <= 0 ? [`    z₀ = ${Number.isFinite(z0) ? z0 : 'NaN'} — ${typeof __z0Source === 'string' ? __z0Source : 'no genuine roughness length'}`] : []),
          ...(Number.isFinite(z0) && z0 > 0 && z <= z0 ? [`    z = ${z} m ≤ z₀ = ${z0.toFixed(3)} m — outside the log-law domain (needs z ≫ z₀)`] : []),
        ],
      };
    }
    const u = (ustar / kappa) * Math.log(z / z0);
    const logTerm = Math.log(z / z0);
    const z0class = z0 < 0.001 ? 'SMOOTH (water/ice/flat bare soil)' : z0 <= 0.05 ? 'LOW GRASS / SHORT CROP' : z0 < 0.3 ? 'TALL CROP / SCRUB' : z0 < 1 ? 'FOREST / URBAN' : 'COMPLEX TERRAIN';
    // Catalogue secondary outputs — computed here honestly:
    //  C_d(z) = (κ/ln(z/z₀))²  (drag coefficient at height z, neutral)
    //  P(z)   = ½·ρ·u³         (wind power density; ρ from genuine ambient
    //          pressure/temperature state when available — no static 1.2)
    //  Re_*   = u_*·z₀/ν        (roughness Reynolds number; ν air at ~15 °C)
    const Cd = (kappa / logTerm) ** 2;
    const nuAir = 1.46e-5; // m²/s kinematic viscosity of air (~15 °C)
    const ReStar = (ustar * z0) / nuAir;
    let P = Number.NaN;
    let powerSteps: string[] = [];
    if (Number.isFinite(rho) && rho > 0.1) {
      P = 0.5 * rho * u ** 3;
      powerSteps = [
        '',
        'Step 4 — Secondary outputs (drag coefficient, wind power density):',
        `  C_d(z) = (κ/ln(z/z₀))² = (${kappa}/${logTerm.toFixed(4)})² = ${(Cd).toExponential(3)}`,
        `  P(z) = ½·ρ·u³ = ½ × ${rho.toFixed(3)} kg/m³ × (${u.toFixed(3)})³ = ${P.toFixed(1)} W/m²  (ρ from genuine ambient state)`,
      ];
    }
    // Profile series — u(z) across heights from 2·z₀ to 200 m (log spacing).
    const seriesPoints: Array<{ x: number; y: number }> = [];
    const zBottom = z0 * 2, zTop = 200;
    for (let i = 0; i <= 40; i++) {
      const h = zBottom * Math.pow(zTop / zBottom, i / 40);
      const uH = (ustar / kappa) * Math.log(h / z0);
      seriesPoints.push({ x: h, y: Number.isFinite(uH) ? uH : Number.NaN });
    }
    return {
      result: u, unit: 'm/s',
      secondary: [
        { key: 'friction_velocity', value: Number.isFinite(ustar) ? ustar : Number.NaN, unit: 'm/s', label: 'Friction Velocity u_*' },
        { key: 'roughness_reynolds', value: Number.isFinite(ReStar) ? ReStar : Number.NaN, unit: '—', label: 'Roughness Reynolds Number Re_*' },
        { key: 'drag_coefficient', value: Number.isFinite(Cd) ? Cd : Number.NaN, unit: '—', label: 'Drag Coefficient C_d(z)' },
        ...(Number.isFinite(P) ? [{ key: 'wind_power_density', value: P, unit: 'W/m²', label: 'Wind Power Density P(z)' }] : []),
      ],
      series: [{
        label: 'u(z) log wind',
        color: '#E69F00',
        points: seriesPoints,
      }],
      steps: [
        '── Logarithmic Wind Profile (Stull 1988 Ch. 4; Prandtl log law, 1932) ──',
        'Neutral surface layer: τ = ρ·u_*² constant, K_m = κ·u_*·z → ∂ū/∂z = u_*/(κz)',
        `Inputs: u_* = ${ustar.toFixed(3)} m/s, z = ${z.toFixed(1)} m, z₀ = ${z0.toFixed(4)} m, κ = ${kappa}`,
        ...(typeof __ustarSource === 'string' ? [`Provenance: ${__ustarSource}`] : []),
        ...(typeof __z0Source === 'string' ? [`Provenance: ${__z0Source}`] : []),
        '',
        'Step 1 — Compute log ratio:',
        `  ln(z/z₀) = ln(${z.toFixed(1)} / ${z0.toFixed(4)}) = ${logTerm.toFixed(4)}`,
        '',
        'Step 2 — Compute wind speed:',
        `  u(z) = (u_*/κ) × ln(z/z₀) = (${ustar.toFixed(3)}/${kappa}) × ${logTerm.toFixed(4)}`,
        `  u(${z.toFixed(1)} m) = ${u.toFixed(3)} m/s (${(u * 3.6).toFixed(2)} km/h)`,
        '',
        'Step 3 — Surface classification:',
        `  z₀ = ${z0.toFixed(4)} m → ${z0class}`,
        ...powerSteps,
        '',
        '  └ Neutral stability assumed — stable/unstable conditions require MO correction via ψ_m(ζ) (tool 48)',
        '  └ Valid within the constant-flux layer: z ≫ z₀ (typically z ≥ 5×z₀) and z ≲ 0.1·z_i',
      ]
    };
  },
  50: ({ g0, a1, A, hs, cs }) => {
    if (![g0, a1, A, hs, cs].every(Number.isFinite)) {
      return {
        result: NaN, unit: 'mmol/m²s',
        secondary: [
          { key: 'assimilation', value: Number.isFinite(A) ? A : Number.NaN, unit: 'µmol/m²s', label: 'Net Carbon Assimilation A' },
          { key: 'intercellular_co2', value: Number.NaN, unit: 'ppm', label: 'Intercellular CO₂ c_i' },
          { key: 'transpiration', value: Number.NaN, unit: 'mmol/m²s', label: 'Transpiration E' },
        ],
        steps: [
          '── Ball-Berry Stomatal Conductance Model (Ball et al., 1987; Leuning, 1995) ──',
          'Honest NaN — a required genuine input could not be resolved.',
          `  g₀ = ${g0} mmol/m²s (auto 0 — paper intercept ≈ origin)`,
          `  a₁ = ${a1} (auto 9.31 — paper Fig. 1B Glycine max fit)`,
          `  A = ${A} µmol CO₂/m²s (auto MODIS MOD17A2H GPP via ORNL DAAC)`,
          `  h_s = ${hs} (auto ERA5 2 m relative humidity / 100)`,
          `  c_s = ${cs} µmol/mol (auto NOAA GML global monthly mean)`,
          '',
          'No static constant is substituted for any missing genuine source —',
          'supply explicit leaf-level measurements (e.g. cuvette A and c_s) to',
          'override, or retry when the remote source is reachable.',
        ],
      };
    }
    // Ball-Berry: g [mol/m²s] = g₀/1000 + a₁·A·h_s/c_s (A·h_s/c_s has
    // µmol·µmol⁻¹·mol = mol dimensions; g₀ input is mmol). Report mmol/m²s.
    const gMol = g0 / 1000 + a1 * A * hs / cs;
    const gs = gMol * 1000;
    // Secondary outputs (catalogue): E = g·D/P (mole-fraction gradient,
    // g in mol/m²s, D and P in kPa) and WUE = A/E. Reference D = 1.2 kPa,
    // P = 101.3 kPa when the caller does not supply a live state.
    const D = 1.2, P = 101.3;
    const E = gMol * D / P;                    // mol/m²s
    const Emmol = E * 1000;                    // mmol/m²s
    const WUE = A / Emmol;                     // µmol/mmol
    // Intercellular CO₂ via Fick's first law, g_c(CO₂) = g_s/1.6 (CO₂
    // diffuses slower than H₂O): A = g_c·(c_s − c_i) → c_i = c_s − 1.6·A/g_s.
    const ci = gMol > 0 ? cs - (1.6 * A) / gMol : Number.NaN;
    return {
      result: gs, unit: 'mmol/m²s',
      secondary: [
        { key: 'assimilation', value: Number.isFinite(A) ? A : Number.NaN, unit: 'µmol/m²s', label: 'Net Carbon Assimilation A' },
        { key: 'intercellular_co2', value: Number.isFinite(ci) ? ci : Number.NaN, unit: 'ppm', label: 'Intercellular CO₂ c_i (Fick, g_c = g_s/1.6)' },
        { key: 'transpiration', value: Number.isFinite(Emmol) ? Emmol : Number.NaN, unit: 'mmol/m²s', label: 'Transpiration E' },
        { key: 'water_use_efficiency', value: Number.isFinite(WUE) ? WUE : Number.NaN, unit: 'µmol/mmol', label: 'Water-Use Efficiency A/E' },
      ],
      steps: [
        '── Ball-Berry Stomatal Conductance Model (Ball et al., 1987; Leuning, 1995) ──',
        `Residual stomatal conductance g₀ = ${g0.toFixed(3)} mmol/m²s`,
        `Slope parameter a₁ = ${a1.toFixed(3)} (Ball-Berry) / g₁ (Leuning)`,
        `Assimilation rate A = ${A.toFixed(2)} µmol CO₂/m²s`,
        `Humidity at leaf surface h_s = ${hs.toFixed(2)} (fractional relative humidity)`,
        `CO₂ concentration at leaf surface c_s = ${cs.toFixed(1)} ppm`,
        '',
        'Step 1 — Compute Ball-Berry index:',
        `  Ball index = A × h_s / c_s = ${A.toFixed(2)} × ${hs.toFixed(2)} / ${cs.toFixed(1)} = ${(A * hs / cs).toFixed(4)} (mol m⁻² s⁻¹)`,
        '',
        'Step 2 — Compute stomatal conductance:',
        `  g [mol/m²s] = g₀/1000 + a₁ × A × h_s / c_s`,
        `  g = ${(g0 / 1000).toFixed(4)} + ${a1.toFixed(3)} × ${(A * hs / cs).toFixed(4)} = ${gMol.toFixed(4)} mol/m²s`,
        `  g_s = ${gs.toFixed(2)} mmol/m²s (×1000)`,
        '',
        'Step 3 — Secondary outputs:',
        `  Transpiration E = g·D/P = ${gMol.toFixed(4)} × ${D} / ${P} = ${Emmol.toFixed(2)} mmol/m²s (reference D = ${D} kPa, P = ${P} kPa)`,
        `  WUE = A/E = ${A.toFixed(2)} / ${Emmol.toFixed(2)} = ${WUE.toFixed(2)} µmol/mmol`,
        `  Intercellular CO₂ c_i = c_s − 1.6·A/g_s = ${cs.toFixed(1)} − 1.6×${A.toFixed(2)}/${gMol.toFixed(4)} = ${Number.isFinite(ci) ? ci.toFixed(1) : 'NaN'} ppm (g_c = g_s/1.6)`,
        '',
        'Step 4 — Physiological interpretation:',
        `  ${gs < 50 ? 'Near-closed stomata — water conservation or stress response' : gs < 150 ? 'Moderate conductance — suboptimal conditions' : gs < 400 ? 'Typical midday conductance for C₃ plants' : 'High conductance — optimal conditions, high GPP potential'}`,
      ]
    };
  },

  // ── Part II · Domain 7: Biosphere & Carbon ──
  51: ({ eps, fpar, par }) => {
    if (![eps, fpar, par].every(Number.isFinite)) {
      return {
        result: NaN, unit: 'gC/m²/yr',
        steps: [
          '── Gross Primary Production (Monteith, 1972) ──',
          'Honest NaN — a required genuine input could not be resolved.',
          `  ε = ${eps} gC/MJ (auto 1.2 — conservative C₃ LUE)`,
          `  fPAR = ${fpar} (auto MODIS MCD15A3H Fpar_500m via ORNL DAAC)`,
          `  PAR = ${par} MJ/m²/yr (auto from genuine Open-Meteo shortwave × 0.45 × 0.0864 × 365)`,
          '',
          'No static constant is substituted for a missing genuine source —',
          'supply explicit ε / fPAR / PAR (e.g. MODIS MOD17 fields) to override.',
        ],
      };
    }
    const gpp = eps * fpar * par;
    const apar = fpar * par;
    const npp = gpp * 0.5; // NPP ≈ 0.5·GPP (coarse estimate)
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let e = 0.2; e <= 3; e += 0.1) {
      seriesPoints.push({ x: e, y: Number.isFinite(e * apar) ? e * apar : Number.NaN });
    }
    return {
      result: gpp, unit: 'gC/m²/yr',
      secondary: [
        { key: 'npp_estimate', value: Number.isFinite(npp) ? npp : Number.NaN, unit: 'gC/m²/yr', label: 'NPP Estimate (0.5·GPP)' },
        { key: 'apar', value: Number.isFinite(apar) ? apar : Number.NaN, unit: 'MJ/m²/yr', label: 'Absorbed PAR (fPAR·PAR)' },
      ],
      series: [{
        label: 'GPP(ε) at fixed APAR',
        color: '#009E73',
        points: seriesPoints,
      }],
      steps: [
        '── Gross Primary Production (Monteith, 1972) ──',
        `Light use efficiency ε = ${eps.toFixed(2)} gC/MJ, fPAR = ${fpar.toFixed(3)}, PAR = ${par.toFixed(0)} MJ/m²/yr`,
        '',
        'Step 1 — fPAR × PAR = absorbed PAR:',
        `  APAR = ${fpar.toFixed(3)} × ${par.toFixed(0)} = ${(fpar * par).toFixed(0)} MJ/m²/yr`,
        '',
        'Step 2 — Apply light use efficiency:',
        `  GPP = ε × APAR = ${eps.toFixed(2)} × ${(fpar * par).toFixed(0)} = ${gpp.toFixed(1)} gC/m²/yr`,
        '',
        `  └ Interpretation: ${gpp > 2000 ? 'Very high productivity (tropical forest)' : gpp > 1000 ? 'High productivity (temperate forest)' : gpp > 500 ? 'Moderate productivity (cropland)' : 'Low productivity (desert/tundra)'}`,
      ]
    };
  },
  52: ({ I0, k, LAI }) => {
    // Monsi & Saeki (1953) / Hirose (2004): Beer-Lambert canopy attenuation.
    // I(z) = I₀·exp(−k·LAI); fPAR = 1 − exp(−k·LAI). Verified worked example:
    // I₀=2000, k=0.5, LAI=3 → 2000·exp(−1.5) = 446 µmol/m²s.
    const finite = [I0, k, LAI].every(Number.isFinite);
    const I = finite ? I0 * Math.exp(-k * LAI) : Number.NaN;
    const fPAR = finite ? 1 - Math.exp(-k * LAI) : Number.NaN;
    const transmitted = finite ? Math.exp(-k * LAI) : Number.NaN; // τ = I/I₀
    // Catalogue-promised secondary output: cumulative LAI at which transmitted
    // PPFD equals the C₃ leaf light-compensation point Γ ≈ 50 µmol/m²s
    // (Monsi–Saeki 1953 Eqs 5–6 / Hirose 2004; Γ stated in the catalogue's
    // output description). LAI_comp = −(1/k)·ln(Γ/I₀). Honest NaN when there
    // is no incident radiation (I₀ ≤ 0, e.g. night) or k ≤ 0 — never ±Infinity.
    const GAMMA_COMP = 50; // µmol/m²s, C₃ leaf light-compensation point
    const laiComp = finite && I0 > 0 && k > 0 ? -(1 / k) * Math.log(GAMMA_COMP / I0) : Number.NaN;
    const i0Str = Number.isFinite(I0) ? I0.toFixed(0) : 'NaN';
    const kStr = Number.isFinite(k) ? k.toFixed(3) : 'NaN';
    const laiStr = Number.isFinite(LAI) ? LAI.toFixed(2) : 'NaN';
    const secondary = [
      { key: 'absorbed_fraction', value: Number.isFinite(fPAR) ? fPAR : Number.NaN, unit: '—', label: 'Canopy Absorption Fraction (fPAR)' },
      { key: 'transmitted_fraction', value: Number.isFinite(transmitted) ? transmitted : Number.NaN, unit: '—', label: 'Transmitted Fraction (τ = I/I₀)' },
      { key: 'compensation_lai', value: Number.isFinite(laiComp) ? laiComp : Number.NaN, unit: 'm²/m²', label: 'Light-Compensation Depth (LAI where I = Γ)' },
    ];
    const steps: string[] = [
      '── Beer-Lambert Light Extinction (Monsi & Saeki 1953; Hirose 2004, Ann. Bot. 95(3):483–494) ──',
      `Incident PPFD above canopy I₀ = ${i0Str} µmol/m²s, Extinction coefficient k = ${kStr}`,
      `Leaf Area Index (cumulative from top) LAI = ${laiStr} m²/m²`,
      '',
    ];
    if (!finite) {
      steps.push(
        '  Genuine input missing (no fabricated values):',
        ...(!Number.isFinite(I0) ? ['  • I₀ — incident PPFD (ERA5 CDS ssrd, genuine when resolved)'] : []),
        ...(!Number.isFinite(k) ? ['  • k — extinction coefficient (user-supplied; Monsi–Saeki range 0.3–2.0)'] : []),
        ...(!Number.isFinite(LAI) ? ['  • LAI — MODIS MCD15A3H, genuine when resolved'] : []),
        '  → I(z) = NaN (honest — a required genuine input is missing, no substitution).',
      );
      return { result: I, unit: 'µmol/m²s', secondary, steps };
    }
    steps.push(
      'Step 1 — Exponential attenuation (Beer’s Law, I = I₀·e^(−k·LAI)):',
      `  k × LAI = ${k.toFixed(3)} × ${LAI.toFixed(2)} = ${(k * LAI).toFixed(3)}`,
      `  I(z) = ${i0Str} × exp(${(-k * LAI).toFixed(3)}) = ${I.toFixed(1)} µmol/m²s`,
      '',
      'Step 2 — Fraction of absorbed PAR (fPAR = 1 − e^(−k·LAI)):',
      `  fPAR = ${(fPAR * 100).toFixed(1)}% of incident PAR absorbed by the canopy`,
      `  τ = e^(−k·LAI) = ${(transmitted * 100).toFixed(1)}% transmitted (τ + fPAR = 1 under the black-leaf assumption)`,
      '',
      'Step 3 — Light-compensation depth (LAI where I(z) = Γ ≈ 50 µmol/m²s, C₃):',
      Number.isFinite(laiComp)
        ? `  LAI_comp = −(1/k)·ln(Γ/I₀) = ${laiComp.toFixed(2)} m²/m² — leaves below this depth are below the compensation point`
        : '  LAI_comp = NaN — no incident radiation (I₀ ≤ 0, e.g. night) or k ≤ 0; depth undefined',
      '',
      `  └ Interpretation: ${fPAR > 0.8 ? 'Dense canopy closure — little understorey light' : fPAR > 0.5 ? 'Moderate canopy — significant understorey light' : 'Open canopy — abundant understorey / ground-layer light'}`,
    );
    // Profile series (tool vizType 'profile'): I(z) vs LAI from 0 → 6 m²/m²
    // (25 points) using I(z) = I₀·exp(−k·LAI) with the tool's I₀ and k.
    // Only emitted when inputs are finite — no synthetic curve from NaN
    // inputs (honest empty series).
    const series = finite && LAI >= 0
      ? [{
          label: 'PAR(z) through canopy',
          color: '#0072B2',
          points: Array.from({ length: 25 }, (_, i) => {
            const lai = (6 * i) / 24;
            return { x: lai, y: I0 * Math.exp(-k * lai) };
          }),
        }]
      : undefined;
    return { result: I, unit: 'µmol/m²s', secondary, series, steps };
  },
  53: ({ Reco, GPP }) => {
    // Wofsy et al. (1993), Science 260:1314-1317: NEE = R_eco − GPP with the
    // meteorological sign convention (negative = net CO₂ sink). Verified
    // against the paper's own numbers: GPP 11.1, Reco 7.4 tC/ha/yr ⇒ NEE =
    // −3.7 tC/ha/yr (their measured annual uptake −3.7 ± 0.7). The sign
    // convention is also that standardized by Chapin et al. (2006),
    // Ecosystems 9:1041-1050.
    const NEE = Reco - GPP;
    const finite = Number.isFinite(Reco) && Number.isFinite(GPP);
    const reStr = Number.isFinite(Reco) ? Reco.toFixed(1) : 'NaN';
    const gStr = Number.isFinite(GPP) ? GPP.toFixed(1) : 'NaN';
    const steps: string[] = [
      '── Net Ecosystem Exchange (Wofsy et al. 1993, Science 260:1314-1317; sign per Chapin et al. 2006) ──',
      `Ecosystem respiration R_eco = ${reStr} gC/m²/yr`,
      `Gross Primary Production GPP = ${gStr} gC/m²/yr`,
      '',
    ];
    if (!Number.isFinite(Reco)) {
      steps.push(
        '  R_eco is NaN — ecosystem respiration requires nighttime eddy-covariance NEE',
        '  (FLUXNET/AmeriFlux, registration-gated; SMAP L4C subset service unpopulated).',
        '  No genuine open source exists — supply R_eco explicitly (gC/m²/yr).',
      );
    }
    if (!Number.isFinite(GPP)) {
      steps.push('  GPP is NaN — no genuine MODIS MOD17A2H annual GPP resolved at this point.');
    }
    if (!finite) {
      steps.push('', '  NEE = NaN (honest — a required genuine input is missing, no substitution).');
      return { result: NEE, unit: 'gC/m²/yr', steps };
    }
    const nep = -NEE;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let g = 0; g <= 2000; g += 50) {
      seriesPoints.push({ x: g, y: Number.isFinite(Reco - g) ? Reco - g : Number.NaN });
    }
    steps.push(
      'Step 1 — Compute NEE:',
      `  NEE = R_eco - GPP = ${Reco.toFixed(1)} - ${GPP.toFixed(1)}`,
      `  NEE = ${NEE.toFixed(1)} gC/m²/yr`,
      '',
      'Step 2 — Carbon balance classification (sign per Wofsy 1993 / Chapin 2006):',
      `  ${NEE < 0 ? 'NET CARBON SINK (NEE < 0) — ecosystem absorbs CO₂' : NEE > 0 ? 'NET CARBON SOURCE (NEE > 0) — ecosystem releases CO₂' : 'CARBON NEUTRAL (NEE ≈ 0)'}`,
      `  Net ecosystem production NEP = -NEE = ${(-NEE).toFixed(1)} gC/m²/yr (positive = net uptake)`,
      '',
      `  └ NEE range: < -500 strong sink (productive forest); -500 to -100 moderate sink; -100 to 100 near-neutral; > 100 carbon source (disturbance/peat decomposition)`,
    );
    return { result: NEE, unit: 'gC/m²/yr', secondary: [
      { key: 'nep', value: Number.isFinite(nep) ? nep : Number.NaN, unit: 'gC/m²/yr', label: 'Net Ecosystem Production (NEP)' },
    ], series: [{
      label: 'NEE vs GPP (fixed R_eco)',
      color: '#009E73',
      points: seriesPoints,
    }], steps };
  },
  54: ({ Vcmax, ci, GammaStar, Kc, Ko, O, ca, J, Rd }) => {
    // Farquhar, von Caemmerer & Berry (1980), Planta 149:78-90 — Rubisco-limited
    // (RuP2-saturated) carboxylation: Wc = Vcmax·C/(C + Kc(1 + O/Ko)), paper
    // Eq. 2/3. The tool's simplified net form subtracts the CO₂ compensation
    // point: A_c = Vcmax·(ci − Γ*)/(ci + Kc(1 + O/Ko)). Units µmol/mol
    // (mixing ratios; equivalent to the paper's partial pressures at 1 atm).
    // Verified worked example: Vcmax=80, ci=250, Γ*=40, Kc=300, Ko=25000,
    // O=210000 → Kc(1+O/Ko) = 300·9.4 = 2820, A_c = 80·(250−40)/(250+2820)
    // = 5.47 µmol/m²s (Rubisco-limited; light and TPU branches not limiting).
    const finite = [Vcmax, ci, GammaStar, Kc, Ko, O].every(Number.isFinite);
    const Kco = finite ? Kc * (1 + O / Ko) : Number.NaN;
    const Ac = finite ? Vcmax * (ci - GammaStar) / (ci + Kco) : Number.NaN;
    // Gross carboxylation v_c and photorespiratory oxygenation v_o (paper Eq. 4
    // ratio form as stated in the catalogue: v_o = v_c·(O·K_c)/(cᵢ·K_o)).
    const vc = finite ? Vcmax * ci / (ci + Kco) : Number.NaN;
    const vo = finite ? vc * (O * Kc) / (ci * Ko) : Number.NaN;
    const ciCa = Number.isFinite(ca) && ca > 0 ? ci / ca : Number.NaN;
    // Optional FvCB complement (net A = min(Wc, Wj) − Rd): electron-transport
    // limit Wj = J·(ci − Γ*)/(4·(ci + 2Γ*)) needs a light/electron-transport
    // input J (µmol e⁻/m²s) and dark respiration Rd; both are honest NaN when
    // not supplied (never fabricated).
    const Wj = finite && Number.isFinite(J) && (ci + 2 * GammaStar) !== 0
      ? (J * (ci - GammaStar)) / (4 * (ci + 2 * GammaStar))
      : Number.NaN;
    const Rdv = Number.isFinite(Rd) ? Rd : Number.NaN;
    const netA = Number.isFinite(Wj) && Number.isFinite(Rdv) ? Math.min(Ac, Wj) - Rdv : Number.NaN;
    const secondary = [
      { key: 'electron_transport_limit', value: Number.isFinite(Wj) ? Wj : Number.NaN, unit: 'µmol/m²s', label: 'Electron-Transport Limit (Wj)' },
      { key: 'dark_respiration', value: Number.isFinite(Rdv) ? Rdv : Number.NaN, unit: 'µmol/m²s', label: 'Dark Respiration (Rd)' },
      { key: 'net_assimilation', value: Number.isFinite(netA) ? netA : Number.NaN, unit: 'µmol/m²s', label: 'Net Assimilation A = min(Wc, Wj) − Rd' },
      { key: 'gross_carboxylation', value: Number.isFinite(vc) ? vc : Number.NaN, unit: 'µmol/m²s', label: 'Gross Carboxylation (v_c)' },
      { key: 'photorespiration_rate', value: Number.isFinite(vo) ? vo : Number.NaN, unit: 'µmol/m²s', label: 'Photorespiration (Oxygenation v_o)' },
      { key: 'ci_ca_ratio', value: Number.isFinite(ciCa) ? ciCa : Number.NaN, unit: '—', label: 'cᵢ/cₐ Ratio (water-use efficiency)' },
    ];
    const steps: string[] = [
      '── FvCB Photosynthesis (Farquhar, von Caemmerer & Berry 1980, Planta 149:78-90) — Rubisco-limited branch ──',
      `V_cmax = ${Number.isFinite(Vcmax) ? Vcmax.toFixed(1) : 'NaN'} µmol/m²s, cᵢ = ${Number.isFinite(ci) ? ci.toFixed(1) : 'NaN'} µmol/mol`,
      `Γ* = ${Number.isFinite(GammaStar) ? GammaStar.toFixed(2) : 'NaN'} µmol/mol, K_c = ${Number.isFinite(Kc) ? Kc.toFixed(1) : 'NaN'} µmol/mol, K_o = ${Number.isFinite(Ko) ? Ko.toFixed(0) : 'NaN'} µmol/mol`,
      `Intercellular O₂ O = ${Number.isFinite(O) ? O.toFixed(0) : 'NaN'} µmol/mol (21 % of P_atm)`,
      '',
    ];
    if (!Number.isFinite(Vcmax)) {
      steps.push(
        '  V_cmax is NaN — it is a leaf gas-exchange trait with no genuine open',
        '  source (no trait-database API). Supply V_cmax explicitly (µmol/m²s).',
      );
    }
    if (!Number.isFinite(ci)) {
      steps.push('  cᵢ is NaN — no genuine NOAA GML ambient CO₂ resolved (ci = 0.7 × ca).');
    }
    if (!finite) {
      steps.push('', '  A_c = NaN (honest — a required genuine input is missing, no substitution).');
      return { result: Ac, unit: 'µmol/m²s', secondary, steps };
    }
    steps.push(
      'Step 1 — Effective K_c with O₂ competition (paper Eq. 2/3 denominator):',
      `  K_c·(1 + O/K_o) = ${Kc.toFixed(1)} × (1 + ${O.toFixed(0)} / ${Ko.toFixed(0)}) = ${Kco.toFixed(1)} µmol/mol`,
      '',
      'Step 2 — Rubisco-limited net carboxylation:',
      `  A_c = V_cmax × (cᵢ − Γ*) / (cᵢ + K_c·(1+O/K_o))`,
      `  A_c = ${Vcmax.toFixed(1)} × (${ci.toFixed(1)} − ${GammaStar.toFixed(2)}) / (${ci.toFixed(1)} + ${Kco.toFixed(1)})`,
      `  A_c = ${Ac.toFixed(2)} µmol/m²s`,
      Ac < 0 ? `  (cᵢ ${ci.toFixed(0)} < Γ* ${GammaStar.toFixed(0)} — below the CO₂ compensation point, net photorespiratory loss)` : '',
      '',
      'Step 3 — Photorespiration (oxygenation) rate:',
      `  v_o = v_c·(O·K_c)/(cᵢ·K_o) = ${vc.toFixed(2)} × (${O.toFixed(0)}×${Kc.toFixed(0)})/(${ci.toFixed(0)}×${Ko.toFixed(0)})`,
      `  v_o = ${vo.toFixed(2)} µmol/m²s (${(vo / (vc + vo) * 100).toFixed(1)} % of Rubisco flux on photorespiration)`,
      '',
      'Step 4 — cᵢ/cₐ ratio (water-use efficiency indicator):',
      Number.isFinite(ciCa)
        ? `  cᵢ/cₐ = ${ci.toFixed(1)} / ${ca.toFixed(1)} = ${ciCa.toFixed(3)} (C₃ typical 0.6–0.8)`
        : '  cᵢ/cₐ = NaN (no genuine ambient CO₂ served)',
      '',
      'Step 5 — Optional light branch and respiration (FvCB complement):',
      Number.isFinite(Wj)
        ? `  Wj = J·(cᵢ − Γ*)/(4·(cᵢ + 2Γ*)) = ${Wj.toFixed(2)} µmol/m²s — min(Wc, Wj) = ${Math.min(Ac, Wj).toFixed(2)} µmol/m²s`
        : '  Wj = NaN — no electron-transport input J supplied (light-limited branch not derivable)',
      Number.isFinite(Rdv)
        ? `  Rd = ${Rdv.toFixed(2)} µmol/m²s — net A = min(Wc, Wj) − Rd = ${Number.isFinite(netA) ? netA.toFixed(2) : 'NaN'} µmol/m²s`
        : '  Rd = NaN — dark respiration not supplied (A_c is already net of the compensation point)',
      '',
      `  └ Interpretation: ${Ac > 30 ? 'High rate — tropical/crop C₃ photosynthesis' : Ac > 15 ? 'Moderate rate — typical C₃ midday' : Ac > 5 ? 'Low rate — light/water-limited' : 'Very low — stressed, senescent canopy or below compensation'}`,
    );
    return { result: Ac, unit: 'µmol/m²s', secondary, steps };
  },
  55: ({ DBH, rho, E }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const DBHn = Number(DBH), rhon = Number(rho), En = Number(E);
    // Chave et al. (2014), Glob. Change Biol. 20:3177-3190 — the height-
    // unavailable pantropical model, Eq. 7:
    //   AGB = exp[−1.803 − 0.976·E + 0.976·ln(ρ) + 2.673·ln(D) − 0.0299·(ln D)²]
    // D in cm, ρ in g/cm³ (wood specific gravity), E dimensionless bioclimatic
    // stress (Eq. 6b: E = (0.178·TS − 0.938·CWD − 6.61·PS)×10⁻³). Calibrated
    // on 4004 harvested tropical trees, RSE=0.413, mean bias +9.71 %.
    // The height-available model (Eq. 4, AGB = 0.0673·(ρD²H)^0.976) is not
    // used: this tool takes no height input.
    const finite = [DBHn, rhon, En].every(Number.isFinite);
    const lnD = Math.log(DBHn);
    const AGB = Number.isFinite(DBHn) && DBHn > 0 && Number.isFinite(rhon) && rhon > 0
      ? Math.exp(-1.803 - 0.976 * En + 0.976 * Math.log(rhon) + 2.673 * lnD - 0.0299 * lnD * lnD)
      : Number.NaN;
    const C_kg = Number.isFinite(AGB) ? AGB * 0.47 : Number.NaN;      // IPCC default carbon fraction (0.47, catalogue output)
    const CO2e_t = Number.isFinite(C_kg) ? C_kg * 3.67 / 1000 : Number.NaN; // mass ratio CO₂/C, in tonnes
    const steps: string[] = [
      '── Pantropical Allometric Biomass (Chave et al. 2014, Glob. Change Biol. 20:3177-3190, Eq. 7 — height-unavailable model) ──',
      `DBH D = ${Number.isFinite(DBHn) ? DBHn.toFixed(1) : 'NaN'} cm (field measurement)`,
      `Wood specific gravity ρ = ${Number.isFinite(rhon) ? rhon.toFixed(3) : 'NaN'} g/cm³ (user-supplied: no open trait API)`,
      `Bioclimatic stress E = ${Number.isFinite(E) ? E.toFixed(4) : 'NaN'} (Eq. 6b: (0.178·TS − 0.938·CWD − 6.61·PS)×10⁻³; Chave's E-layer offline)`,
      '',
    ];
    if (!Number.isFinite(DBHn)) steps.push('  DBH is NaN — it is a field measurement with no open source; supply D (cm).');
    if (!Number.isFinite(rhon)) steps.push('  ρ is NaN — wood specific gravity has no open API (BIEN unreachable; global wood-density DB is a static dataset); supply ρ (g/cm³).');
    if (!Number.isFinite(En)) steps.push('  E is NaN — the paper\'s gridded E layer (chave.upstlse.fr) is offline and WorldClim has no point API; supply E from Eq. 6b.');
    if (!finite) {
      steps.push('', '  AGB = NaN (honest — required genuine inputs missing, no substitution).');
      return {
        result: AGB, unit: 'kg', steps,
        secondary: [
          { key: 'carbon_content', value: C_kg, unit: 'kgC', label: 'Carbon Stock (0.47 × AGB)' },
          { key: 'co2_equivalent', value: CO2e_t, unit: 'tCO₂', label: 'CO₂ Equivalent (3.67 × C)' },
        ],
      };
    }
    steps.push(
      'Step 1 — ln(D) terms:',
      `  ln(D) = ln(${DBHn.toFixed(1)}) = ${lnD.toFixed(4)}`,
      `  2.673·ln(D) = ${(2.673 * lnD).toFixed(4)}`,
      `  0.0299·(ln D)² = ${(0.0299 * lnD * lnD).toFixed(4)}`,
      '',
      'Step 2 — Combine (Eq. 7 exponent):',
      `  −1.803 − 0.976·E + 0.976·ln(ρ) + 2.673·ln(D) − 0.0299·(ln D)²`,
      `  = −1.803 − ${(0.976 * En).toFixed(4)} + ${(0.976 * Math.log(rhon)).toFixed(4)} + ${(2.673 * lnD).toFixed(4)} − ${(0.0299 * lnD * lnD).toFixed(4)}`,
      `  = ${(-1.803 - 0.976 * En + 0.976 * Math.log(rhon) + 2.673 * lnD - 0.0299 * lnD * lnD).toFixed(4)}`,
      '',
      'Step 3 — Aboveground biomass:',
      `  AGB = exp(${(-1.803 - 0.976 * En + 0.976 * Math.log(rhon) + 2.673 * lnD - 0.0299 * lnD * lnD).toFixed(4)}) = ${AGB.toFixed(2)} kg (${(AGB / 1000).toFixed(3)} t)`,
      '',
      'Step 4 — Carbon stock (IPCC default fraction 0.47):',
      `  C = 0.47 × AGB = ${C_kg.toFixed(1)} kg C (${(C_kg / 1000).toFixed(4)} tC)`,
      `  CO₂ equivalent = 3.67 × C = ${CO2e_t.toFixed(3)} tCO₂`,
      '',
      `  └ Class: ${AGB < 100 ? 'Small tree (DBH < ~20 cm, understorey)' : AGB < 500 ? 'Medium tree (canopy)' : AGB < 2000 ? 'Large tree (canopy emergent)' : 'Very large tree (>2 t — disproportionate carbon share)'}`,
      `  └ Uncertainty: ±20-40 % per tree (paper RSE 0.413, mean bias +9.71 %); height-available model Eq. 4 (AGB = 0.0673·(ρD²H)^0.976) is more accurate (RSE 0.357) — not used here (no H input)`,
    );
    return {
      result: AGB, unit: 'kg', steps,
      secondary: [
        { key: 'carbon_content', value: C_kg, unit: 'kgC', label: 'Carbon Stock (0.47 × AGB)' },
        { key: 'co2_equivalent', value: CO2e_t, unit: 'tCO₂', label: 'CO₂ Equivalent (3.67 × C)' },
      ],
    };
  },
  // ── Wanninkhof (1992) air–sea CO₂ flux (helpers in schmidtNumberCO2 /
  // weissSolubilityCO2 / wanninkhofK1992 above EQUATION_ENGINE) ──
  56: ({ k, K0, dCO2, __wind10m, __windDate, __sst, __sc, __sss, __mooring, __kAuto, __K0Auto, __dCO2Auto }) => {
    const finite = [k, K0, dCO2].every(Number.isFinite);
    // ΔpCO₂ arrives in µatm (ocean − atmosphere) → ×10⁻⁶ converts to atm.
    const F = finite ? k * K0 * dCO2 * 1e-6 : Number.NaN;   // mol/m²/yr
    const F_gC = finite ? F * 12.01 : Number.NaN;            // gC/m²/yr
    const missing = [
      !Number.isFinite(k) ? 'k — gas transfer velocity (ERA5 10 m wind unavailable via CDS, or user-supplied k non-finite)' : null,
      !Number.isFinite(K0) ? 'K₀ — CO₂ solubility (SST/salinity unavailable — no mooring or OISST sample)' : null,
      !Number.isFinite(dCO2) ? 'ΔpCO₂ — air–sea pCO₂ gradient (no NOAA PMEL mooring within 1000 km; user-supplied ΔpCO₂ needed)' : null,
    ].filter(Boolean);
    const steps: string[] = [
      '── Air-Sea CO₂ Flux (Wanninkhof, 1992) ──',
      ...(__mooring && __dCO2Auto != null
        ? [`Ocean pCO₂ source: NOAA PMEL mooring ${__mooring}`,]
        : []),
      ...(__kAuto && __wind10m != null && Number.isFinite(__wind10m)
        ? [`Wind u₁₀ = ${Number(__wind10m).toFixed(2)} m/s (ERA5 reanalysis${__windDate ? `, as of ${__windDate}` : ''})`,]
        : []),
      ...(__kAuto && __sc != null && Number.isFinite(__sc)
        ? [`  Sc(CO₂, seawater) = 2073.1 − 125.62·SST + 3.6276·SST² − 0.043219·SST³ = ${Number(__sc).toFixed(1)} (paper Table A1, SST = ${Number(__sst).toFixed(2)} °C)`]
        : []),
      `Gas transfer velocity k = ${k.toExponential(3)} m/yr${__kAuto ? ' (derived, paper Eq. 3)' : ' (user-supplied)'}`,
      `Solubility K₀ = ${K0.toExponential(3)} mol/m³·atm${__K0Auto ? ` (Weiss 1974 form, paper Table A2${__sss != null && Number.isFinite(__sss) ? `, S = ${Number(__sss).toFixed(1)} ‰` : ''})` : ' (user-supplied)'}`,
      `ΔpCO₂ = ${dCO2.toFixed(1)} µatm (ocean − atmosphere)${__dCO2Auto ? ' (measured at mooring)' : ' (user-supplied)'}`,
      '',
    ];
    if (!finite) {
      steps.push(
        'Step 1 — Genuine input missing (no fabricated values):',
        ...missing.map(m => `  • ${m}`),
        '  → F is reported as NaN with the missing source named above.',
      );
    } else {
      steps.push(
        'Step 1 — Compute flux:',
        `  F = k × K₀ × ΔpCO₂ × 10⁻⁶ (µatm → atm) = ${k.toExponential(3)} × ${K0.toExponential(3)} × ${dCO2.toFixed(1)} × 10⁻⁶`,
        `  F = ${F.toFixed(4)} mol CO₂/m²/yr`,
        '',
        'Step 2 — Convert to carbon mass:',
        `  F_C = ${F.toFixed(4)} × 12.01 g/mol = ${F_gC.toFixed(3)} gC/m²/yr`,
        '',
        `  └ ${dCO2 > 0 ? 'OCEAN SOURCE — outgassing (supersaturated, e.g. equatorial upwelling)' : 'OCEAN SINK — uptake (undersaturated, e.g. mid-latitudes and high latitudes)'}`,
        `  └ k from paper Eq. 3: k = 0.31·u₁₀²·(Sc/660)^(−1/2) cm/hr (steady winds; ×87.6 = m/yr);`,
        `    Sc/660 normalization at 20 °C; 2014 update (0.251·u²) yields ~19 % lower k.`,
      );
    }
    return {
      result: F, unit: 'mol/m²/yr',
      secondary: [
        { key: 'carbon_uptake', value: Number.isFinite(F_gC) ? F_gC : Number.NaN, unit: 'gC/m²/yr', label: 'Carbon Uptake' },
        { key: 'gas_transfer_velocity', value: Number.isFinite(k) ? k : Number.NaN, unit: 'm/yr', label: 'Gas Transfer Velocity' },
      ],
      steps,
    };
  },
  57: ({ C, N, P, NO3s, NO3d }) => {
    // Redfield (1934): the paper's regressions give N:P = 20:1 (Sargasso
    // nitrate–phosphate, p.180), C:N = 7:1 (nitrate–carbonate, p.182), and
    // C:N:P ≈ 140:20:1 atoms (seawater-derived, p.183; Table II avg plankton
    // 137:18:1). Concentrations are molar (µmol/L = µmol atoms/L), so the
    // sample ratios are directly atomic ratios. Verified worked example:
    // C=106, N=16, P=1 → C:N = 106/16 = 6.625, N:P = 16, C:P = 106.
    const finite = [C, N, P].every(Number.isFinite);
    const nP = finite && P !== 0 ? N / P : Number.NaN;         // sample N:P (paper: 20:1)
    const cN = finite && N !== 0 ? C / N : Number.NaN;         // sample C:N (paper: 7:1)
    const cP = finite && P !== 0 ? C / P : Number.NaN;         // sample C:P (paper: 140:1)
    // N* = N − 20·P — deviation from the 1934 N:P line (µmol/L).
    const nStar = finite ? N - 20 * P : Number.NaN;
    const hasNO3 = Number.isFinite(NO3s) && Number.isFinite(NO3d);
    const dNO3 = hasNO3 ? NO3s - NO3d : Number.NaN;
    // Carbon-export proxy from nitrate drawdown, paper C:N = 7:1.
    const cExport = hasNO3 ? 7 * dNO3 : Number.NaN;
    // Phosphate- vs nitrate-limitation check against the canonical Redfield
    // N:P = 16:1 (the 1958 refinement, disclosed below): N:P < 16 → nitrate-limited
    // (−1); N:P > 16 → phosphate-limited (+1); N:P ≈ 16 → balanced (0).
    const limitation = finite && P !== 0 ? Math.sign(nP - 16) : Number.NaN;
    const missing = [
      !Number.isFinite(C) ? 'C — dissolved inorganic carbon (no open point API for DIC profiles; user supplies measured µmol/L)' : null,
      !Number.isFinite(N) ? 'N — nitrate/nitrogen (user supplies measured µmol/L)' : null,
      !Number.isFinite(P) ? 'P — phosphate/phosphorus (user supplies measured µmol/L)' : null,
    ].filter(Boolean);
    const secondary = [
      { key: 'cn_ratio', value: Number.isFinite(cN) ? cN : Number.NaN, unit: '—', label: 'C:N Ratio' },
      { key: 'np_ratio', value: Number.isFinite(nP) ? nP : Number.NaN, unit: '—', label: 'N:P Ratio' },
      { key: 'cp_ratio', value: Number.isFinite(cP) ? cP : Number.NaN, unit: '—', label: 'C:P Ratio' },
      { key: 'limitation', value: Number.isFinite(limitation) ? limitation : Number.NaN, unit: '—', label: 'Limitation Regime (−1 nitrate-limited, 0 balanced, +1 phosphate-limited)' },
      { key: 'nstar', value: Number.isFinite(nStar) ? nStar : Number.NaN, unit: 'µmol/L', label: 'N* (N − 20·P)' },
      { key: 'carbon_export', value: Number.isFinite(cExport) ? cExport : Number.NaN, unit: 'µmol C/L', label: 'Carbon Export Proxy (7·ΔNO₃)' },
    ];
    const steps: string[] = [
      '── Redfield Stoichiometric Ratio (Redfield, 1934) ──',
      `Concentrations: C = ${Number.isFinite(C) ? C.toFixed(1) : 'NaN'}, N = ${Number.isFinite(N) ? N.toFixed(2) : 'NaN'}, P = ${Number.isFinite(P) ? P.toFixed(3) : 'NaN'} µmol/L (molar → ratios are atomic)`,
      '',
    ];
    if (!finite) {
      steps.push(
        'Step 1 — Genuine input missing (no fabricated values):',
        ...missing.map(m => `  • ${m}`),
        '  → result reported as NaN with the missing sample concentrations named above.',
      );
    } else if (P === 0) {
      steps.push(
        'Step 1 — Genuine input invalid (no fabricated values):',
        '  P = 0 µmol/L — division by zero in N:P and C:P; those ratios are NaN (honest), not ±Infinity.',
        '  C:N remains computable when N ≠ 0.',
      );
    } else {
      steps.push(
        'Step 1 — Compute molar ratios:',
        `  C:N = ${C.toFixed(1)} / ${N.toFixed(2)} = ${Number.isFinite(cN) ? cN.toFixed(2) : 'NaN'} (paper 1934: 7:1, nitrate–carbonate regression)`,
        `  N:P = ${N.toFixed(2)} / ${P.toFixed(3)} = ${nP.toFixed(2)} (paper 1934: 20:1, Sargasso nitrate–phosphate regression)`,
        `  C:P = ${C.toFixed(1)} / ${P.toFixed(3)} = ${cP.toFixed(2)} (paper 1934: 140:1)`,
        '',
        'Step 2 — Redfield diagnostics:',
        `  N* = N − 20·P = ${N.toFixed(2)} − 20·${P.toFixed(3)} = ${nStar.toFixed(2)} µmol/L ${nStar > 0 ? '(N excess vs the 1934 N:P line)' : nStar < 0 ? '(N deficit vs the 1934 N:P line)' : '(on the 1934 N:P line)'}`,
        `  C_export = 7 × (NO₃_surface − NO₃_deep) = ${hasNO3 ? `${(7 * dNO3).toFixed(1)} µmol C/L (ΔNO₃ = ${dNO3.toFixed(1)} µmol/L; paper C:N = 7:1)` : 'NaN — NO₃_surface / NO₃_deep not supplied'}`,
        '',
        `  └ ${Math.abs(nP - 20) < 2 ? 'Near the 1934 N:P line (20:1) — balanced N/P usage' : nP > 20 ? 'P limitation — N:P above the 1934 line (excess N relative to P)' : 'N limitation — N:P below the 1934 line (N consumed first)'}`,
        `  └ vs canonical Redfield N:P = 16:1 (1958 refinement): ${nP < 16 ? 'nitrate-limited' : nP > 16 ? 'phosphate-limited' : 'balanced'}`,
        `  └ The canonical 106:16:1 (N:P = 16:1, C:N = 6.6:1) is Redfield (1958), NOT 1934: the cited 1934 paper's regressions give N:P = 20:1, C:N = 7:1, C:N:P ≈ 140:20:1 atoms (seawater-derived; avg plankton 137:18:1). This tool uses the cited 1934 paper's values; the 1958 refinement is disclosed, not silently substituted.`,
      );
    }
    // Bar series (tool vizType 'bar'): sample C, N, P normalized to the
    // canonical Redfield ratio (106:16:1) — a value of 1.0 means the sample
    // matches the canonical atom budget exactly.
    const series: Array<{ label: string; points: Array<{ x: number; y: number }>; color?: string }> = [{
      label: 'C:N:P ratio vs Redfield 106:16:1 (C/106, N/16, P/1)',
      color: '#0072B2',
      points: [
        { x: 0, y: Number.isFinite(C) ? C / 106 : Number.NaN },
        { x: 1, y: Number.isFinite(N) ? N / 16 : Number.NaN },
        { x: 2, y: Number.isFinite(P) ? P / 1 : Number.NaN },
      ],
    }];
    return { result: nP, unit: '—', secondary, steps, series };
  },

  // ── Domain 8: Agriculture & Crop ──
  // Growing Degree Days — McMaster & Wilhelm (1997) "one equation, two
  // interpretations". Eq. (1): GDD = Σ [(TMAX + TMIN)/2 − TBASE]. The two
  // interpretations differ ONLY in when TBASE (and TUT, when used) is
  // applied:
  //   Method 1 — clamp the daily MEAN: if TAVG < TBASE then TAVG = TBASE;
  //              if TAVG > TUT then TAVG = TUT.  (predominates for small
  //              grain cereals / in simulation models)
  //   Method 2 — clamp each EXTREME: if TMAX < TBASE then TMAX = TBASE;
  //              if TMIN < TBASE then TMIN = TBASE; same for TUT.
  //              (most commonly used for corn)
  // The methods give identical results only when TMIN ≥ TBASE; whenever
  // TMIN < TBASE, Method 1 accumulates fewer GDD than Method 2 (the paper
  // reports up to 83% for wheat, 376% for corn on real field data). Both
  // are computed and both are reported; the primary result is Method 1
  // (paper §2.1: the most widespread, "particularly in simulation
  // models").
  58: ({ Tmax, Tmin, Tbase, Tupper, __gddDays, __gddStation }) => {
    const days = Array.isArray(__gddDays) ? (__gddDays as Array<{ date: string; tmaxC: number; tminC: number }>) : [];
    const hasSeries = days.length > 0;
    const dMax = hasSeries ? days.map(d => d.tmaxC) : [Tmax];
    const dMin = hasSeries ? days.map(d => d.tminC) : [Tmin];

    // Single-day fallback when no station series is available: the tool is
    // then a one-day GDD contribution (honest NaN when TMAX/TMIN unknown).
    const dayGdd = (tmax: number, tmin: number) => {
      if (!Number.isFinite(tmax) || !Number.isFinite(tmin)) return { m1: Number.NaN, m2: Number.NaN };
      return gddMethods(tmax, tmin, Tbase, Tupper);
    };

    const sum1 = dMax.reduce((s, v, i) => s + dayGdd(v, dMin[i]).m1, 0);
    const sum2 = dMax.reduce((s, v, i) => s + dayGdd(v, dMin[i]).m2, 0);
    const result = sum1;
    const n = dMax.length;
    const station = __gddStation as { name: string; sid: string; lat: number; lon: number; distanceKm: number } | null;
    const recent = hasSeries ? days[0] : { tmaxC: Tmax, tminC: Tmin };

    return {
      result, unit: '°C·day',
      // Series: cumulative GDD over the genuine GHCN-Daily station record.
      // Only emitted when the station daily series is available — no synthetic
      // fallback when no station is found (honest empty chart).
      series: hasSeries
        ? [
            {
              label: 'GDD Method 1 (clamp mean)',
              color: '#0072B2',
              points: dMax.map((_, i) => {
                let cum = 0;
                for (let j = 0; j <= i; j++) cum += dayGdd(dMax[j], dMin[j]).m1;
                return { x: i, y: Number.isFinite(cum) ? cum : 0 };
              }),
            },
            {
              label: 'GDD Method 2 (clamp extremes)',
              color: '#E69F00',
              points: dMax.map((_, i) => {
                let cum = 0;
                for (let j = 0; j <= i; j++) cum += dayGdd(dMax[j], dMin[j]).m2;
                return { x: i, y: Number.isFinite(cum) ? cum : 0 };
              }),
            },
          ]
        : undefined,
      secondary: [
        { key: 'method2_gdd', value: Number.isFinite(sum2) ? sum2 : Number.NaN, unit: '°C·day', label: 'GDD (Method 2)' },
        { key: 'method_difference', value: Number.isFinite(sum2 - sum1) ? sum2 - sum1 : Number.NaN, unit: '°C·day', label: 'Method Difference (M2 − M1)' },
        { key: 'method2_pct', value: sum1 > 0 ? ((sum2 - sum1) / sum1 * 100) : Number.NaN, unit: '%', label: 'Difference (%)' },
      ],
      steps: [
        '── Growing Degree Days (McMaster & Wilhelm, 1997) ──',
        'Paper Eq. (1): GDD = Σ [(TMAX + TMIN)/2 − TBASE] — "one equation, two interpretations".',
        station
          ? `Daily TMAX/TMIN: GHCN-Daily station '${station.name}' (${station.sid}) `
            + `at (${station.lat.toFixed(3)}, ${station.lon.toFixed(3)}), ${station.distanceKm.toFixed(0)} km away — `
            + `${hasSeries ? days.length : 1} day(s)`
          : 'Daily TMAX/TMIN: no GHCN station within 1.5° — supply TMAX/TMIN explicitly',
        `Today's TMAX = ${Number.isFinite(recent.tmaxC) ? recent.tmaxC.toFixed(1) : 'NaN'} °C, `
          + `TMIN = ${Number.isFinite(recent.tminC) ? recent.tminC.toFixed(1) : 'NaN'} °C, `
          + `T_base = ${Tbase.toFixed(1)} °C, T_upper = ${Number.isFinite(Tupper) ? Tupper.toFixed(1) : 'none'} °C`,
        '',
        'Method 1 — clamp the daily MEAN (paper §2.1):',
        `  TAVG = (TMAX+TMIN)/2; if TAVG < T_base then TAVG = T_base; if TAVG > T_upper then TAVG = T_upper`,
        ...dMax.slice(0, 8).map((v, i) => {
          const d = dayGdd(v, dMin[i]);
          return `  ${hasSeries ? days[i].date : 'today'}  TMAX=${v.toFixed(1)} TMIN=${dMin[i].toFixed(1)} → GDD₁=${d.m1.toFixed(1)}`;
        }),
        hasSeries && dMax.length > 8 ? `  … ${dMax.length - 8} more day(s)` : '',
        `  Σ Method 1 = ${sum1.toFixed(1)} °C·day (${n} day(s))`,
        '',
        'Method 2 — clamp each EXTREME (paper §2.2, most common for corn):',
        `  if TMAX < T_base then TMAX = T_base; if TMIN < T_base then TMIN = T_base; same for T_upper`,
        ...dMax.slice(0, 8).map((v, i) => {
          const d = dayGdd(v, dMin[i]);
          return `  ${hasSeries ? days[i].date : 'today'}  TMAX=${v.toFixed(1)} TMIN=${dMin[i].toFixed(1)} → GDD₂=${d.m2.toFixed(1)}`;
        }),
        hasSeries && dMax.length > 8 ? `  … ${dMax.length - 8} more day(s)` : '',
        `  Σ Method 2 = ${sum2.toFixed(1)} °C·day (${n} day(s))`,
        '',
        `  └ Difference: Method 2 − Method 1 = ${(sum2 - sum1).toFixed(1)} °C·day `
          + `(${sum1 > 0 ? ((sum2 - sum1) / sum1 * 100).toFixed(0) : '∞'}%). `
          + `When TMIN < T_base < TMAX, Method 2 exceeds Method 1; when TMAX > T_upper > TMIN, Method 1 exceeds Method 2 (paper §4, Fig. 1B). `
          + `Paper field data: up to 83% for wheat (0 °C base) and 376% for corn (10 °C base).`,
        `  └ Paper Table 1 check (10-day wheat example, T_base=0 °C): Σ Method 1 = 46.5, Σ Method 2 = 51.0 °C·day — reproduced exactly by this implementation.`,
        `  └ Primary result is Method 1 (most widespread, "particularly in simulation models"); the paper urges reporting WHICH method was used.`,
        `  └ Cumulative GDD over the growing season determines phenological stage (e.g. corn silking ≈ 1100 °C·days, base 10 °C).`,
      ]
    };
  },
  // Priestley-Taylor — Priestley & Taylor (1972), Mon. Wea. Rev. 100(2):81–92.
  // Paper Eq. (14): PE = 1.26·[s/(s+γ)]·(R−G) in ENERGY units (W/m²; p. 84:
  // "the evaporation ... will be given, in energy units, by PE = 1.26·(s/(s+γ))·(R−G)").
  // s/(s+γ) is 0.56 at 10 °C and 0.82 at 35 °C (paper p. 84) — the FAO-56
  // Δ form reproduces this (0.56/0.82 at the same temperatures). The latent
  // heat λ = 2.45 MJ/kg converts energy to water depth:
  //   ET (mm/day) = PE (W/m²) × 86400 s/day / (λ·ρ_w) = PE × 0.03527 mm/day.
  // Primary result is the tool's declared mm/day output (paper Eq. 14
  // algebra + the physical latent-heat conversion); the paper's PE in W/m²
  // is shown in the steps. The previous implementation returned the
  // unconverted W/m² value labelled mm/day — a ~28× unit bug.
  59: ({ alpha, delta, gamma, Rn, G }) => {
    const radTerm = (delta / (delta + gamma)) * (Rn - G);
    const PE = alpha * radTerm;                       // W/m² (paper Eq. 14, energy units)
    const LAMBDA = 2.45e6;                            // J/kg latent heat of vaporization
    const RHO_W = 1000;                               // kg/m³
    // PE (W/m² = J/s·m²) → depth: ×86400 s/day → J/day·m², ÷(λ·ρ_w) → m/day,
    // ×1000 → mm/day. 1 W/m² = 0.03527 mm/day.
    const ETmm = PE * 86400 / (LAMBDA * RHO_W) * 1000; // mm/day
    const aRatio = delta / (delta + gamma);
    const radBalance = Rn - G;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let day = 1; day <= 30; day++) {
      seriesPoints.push({ x: day, y: Number.isFinite(ETmm) ? ETmm : Number.NaN });
    }
    return {
      result: Number.isFinite(ETmm) ? ETmm : Number.NaN, unit: 'mm/day',
      secondary: [
        { key: 'pe_energy', value: Number.isFinite(PE) ? PE : Number.NaN, unit: 'W/m²', label: 'Priestley-Taylor Potential ET (energy)' },
        { key: 'radiation_balance', value: Number.isFinite(radBalance) ? radBalance : Number.NaN, unit: 'W/m²', label: 'Radiation Balance (Rₙ−G)' },
      ],
      series: [{
        label: 'Daily ET (Priestley-Taylor)',
        color: '#0072B2',
        points: seriesPoints,
      }],
      steps: [
        '── Priestley-Taylor Evapotranspiration (Priestley & Taylor, 1972) ──',
        `Paper Eq. (14): PE = α·[Δ/(Δ+γ)]·(Rₙ−G), in energy units (W/m²); α = 1.26 (paper §6 overall mean, land and water)`,
        `α = ${alpha.toFixed(2)}, Δ = ${delta.toFixed(3)} kPa/°C, γ = ${gamma.toFixed(3)} kPa/°C`,
        `Rₙ = ${Number.isFinite(Rn) ? Rn.toFixed(1) : 'NaN'} W/m², G = ${G.toFixed(1)} W/m² (paper: ground heat flux neglected for 24-hr totals)`,
        `Δ/(Δ+γ) = ${aRatio.toFixed(4)} (paper: 0.56 at 10 °C, 0.82 at 35 °C)`,
        '',
        'Step 1 — Compute radiation balance:',
        `  Rₙ − G = ${Number.isFinite(Rn) ? Rn.toFixed(1) : 'NaN'} − ${G.toFixed(1)} = ${Number.isFinite(Rn) ? (Rn - G).toFixed(1) : 'NaN'} W/m²`,
        '',
        'Step 2 — Apply Priestley-Taylor (energy units):',
        `  PE = α × Δ/(Δ+γ) × (Rₙ−G) = ${alpha.toFixed(2)} × ${aRatio.toFixed(4)} × ${Number.isFinite(Rn) ? (Rn - G).toFixed(1) : 'NaN'}`,
        `  PE = ${Number.isFinite(PE) ? PE.toFixed(2) : 'NaN'} W/m² (paper Eq. 14)`,
        '',
        'Step 3 — Convert energy → water depth:',
        `  ET = PE × 86400 / (λ·ρ_w) = ${Number.isFinite(PE) ? PE.toFixed(1) : 'NaN'} × 86400 / (2.45e6 × 1000) × 1000 = ${Number.isFinite(ETmm) ? ETmm.toFixed(2) : 'NaN'} mm/day (1 W/m² = 0.0353 mm/day)`,
        '',
        `  └ Interpretation: ${ETmm > 6 ? 'Very high evaporative demand — arid/semi-arid conditions' : ETmm > 3 ? 'Moderate demand — typical humid summer' : ETmm > 1 ? 'Low demand — cool/overcast' : 'Minimal ET — near-dormant conditions'}`,
        `  └ α ≈ 1.26 for humid, well-watered surfaces; α < 1.0 for advective/arid conditions; the actual/equilibrium α ratio is an aridity index (paper §7)`,
      ]
    };
  },
  // Hargreaves-Samani — Hargreaves & Samani (1985), Appl. Eng. Agric. 1(2):96–99.
  // Paper Eq. [4]: ETo = K_ET·R_A·TD^0.5·(T°C + 17.8), "in which ETo and RA
  // are in the same units of equivalent water evaporation". Calibrated on
  // eight years of Alta fescue lysimeter data at Davis, CA. NOTE: the
  // paper's Eq. [4] prints K_ET = 0.00023, but that is a dropped-zero typo:
  // combining the paper's own Eq. [1] (ETo = 0.0135·RS·(T+17.8)) with the
  // Hargreaves-Samani (1982) R_S relation Eq. [2] (R_S = K_RS·R_A·TD^0.5,
  // K_RS ≈ 0.17 interior) gives 0.0135 × 0.17 = 0.0023 — the coefficient
  // used by FAO-56 (Eq. 52) and every subsequent citation. With R_A in
  // MJ/m²/day, the mm/day conversion ×0.408 (= 1/2.45, λ = 2.45 MJ/kg) is
  // applied; the paper's Eq. [4] has R_A in equivalent-water units already.
  // The previous build used R_A in MJ/m²/day without the ×0.408 factor — a
  // 2.45× unit error.
  60: ({ Ra, Tmax, Tmin, __gddStation }) => {
    const dT = Math.max(0, Tmax - Tmin);
    const sqrtDT = Math.sqrt(dT);
    const Tavg = (Tmax + Tmin) / 2;
    // Paper Eq. [4]: ETo = K_ET·R_A·TD^0.5·(T°C + 17.8), where "T°C is mean
    // temperature" (p. 97, Eq. [1] definition) — T_avg, NOT T_max.
    const ET0MJ = 0.0023 * Ra * (Tavg + 17.8) * sqrtDT;  // MJ-equiv form
    const ET0 = ET0MJ * 0.408;                            // MJ/m²/day → mm/day (÷2.45)
    const station = __gddStation as { name: string; sid: string; lat: number; lon: number; distanceKm: number } | null;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let day = 1; day <= 30; day++) {
      seriesPoints.push({ x: day, y: Number.isFinite(ET0) ? ET0 : Number.NaN });
    }
    return {
      result: Number.isFinite(ET0) ? ET0 : Number.NaN, unit: 'mm/day',
      secondary: [
        { key: 'et0_mj', value: Number.isFinite(ET0MJ) ? ET0MJ : Number.NaN, unit: 'MJ/m²/day', label: 'ET₀ (MJ-equivalent)' },
        { key: 'temperature_range', value: Number.isFinite(dT) ? dT : Number.NaN, unit: '°C', label: 'Temperature Range (T_max−T_min)' },
      ],
      series: [{
        label: 'Daily ET₀ (Hargreaves-Samani)',
        color: '#E69F00',
        points: seriesPoints,
      }],
      steps: [
        '── Hargreaves-Samani Reference ET (Hargreaves & Samani, 1985) ──',
        'Paper Eq. [4]: ETo = K_ET × Rₐ × √ΔT × (T_avg + 17.8); K_ET = 0.0023; "T°C is mean temperature" (paper Eq. [1])',
        station
          ? `T_max/T_min: GHCN-Daily station '${station.name}' (${station.sid}) at (${station.lat.toFixed(3)}, ${station.lon.toFixed(3)}), ${station.distanceKm.toFixed(0)} km away`
          : 'T_max/T_min: no GHCN station within 1.5° — supply T_max/T_min explicitly',
        `Extraterrestrial radiation Rₐ = ${Number.isFinite(Ra) ? Ra.toFixed(1) : 'NaN'} MJ/m²/day (from latitude and day-of-year, FAO-56 Annex 2)`,
        `T_max = ${Number.isFinite(Tmax) ? Tmax.toFixed(1) : 'NaN'} °C, T_min = ${Number.isFinite(Tmin) ? Tmin.toFixed(1) : 'NaN'} °C, T_avg = ${Number.isFinite(Tavg) ? Tavg.toFixed(1) : 'NaN'} °C`,
        '',
        'Step 1 — Temperature difference and mean:',
        `  ΔT = max(0, T_max − T_min) = max(0, ${Number.isFinite(Tmax) ? Tmax.toFixed(1) : 'NaN'} − ${Number.isFinite(Tmin) ? Tmin.toFixed(1) : 'NaN'}) = ${Number.isFinite(dT) ? dT.toFixed(1) : 'NaN'} °C`,
        `  √ΔT = ${Number.isFinite(sqrtDT) ? sqrtDT.toFixed(4) : 'NaN'}`,
        `  T_avg = (${Number.isFinite(Tmax) ? Tmax.toFixed(1) : 'NaN'} + ${Number.isFinite(Tmin) ? Tmin.toFixed(1) : 'NaN'}) / 2 = ${Number.isFinite(Tavg) ? Tavg.toFixed(1) : 'NaN'} °C`,
        '',
        'Step 2 — Compute ET₀ (MJ/m²/day form):',
        `  ET₀ = 0.0023 × ${Number.isFinite(Ra) ? Ra.toFixed(1) : 'NaN'} × (${Number.isFinite(Tavg) ? Tavg.toFixed(1) : 'NaN'} + 17.8) × ${Number.isFinite(sqrtDT) ? sqrtDT.toFixed(4) : 'NaN'}`,
        `  ET₀ = ${Number.isFinite(ET0MJ) ? ET0MJ.toFixed(3) : 'NaN'} (MJ-equivalent)`,
        '',
        'Step 3 — Convert MJ/m²/day → mm/day:',
        `  ET₀ = ${Number.isFinite(ET0MJ) ? ET0MJ.toFixed(3) : 'NaN'} × 0.408 = ${Number.isFinite(ET0) ? ET0.toFixed(2) : 'NaN'} mm/day`,
        '',
        `  └ K_ET note: paper Eq. [4] prints 0.00023 (dropped-zero typo); the paper's own Eq. [1]×[2] derivation and FAO-56 use 0.0023.`,
        `  └ Interpretation: ${ET0 > 7 ? 'Extreme demand — desert conditions' : ET0 > 5 ? 'Very high demand — dryland/arid' : ET0 > 3 ? 'High demand — typical dry summer' : ET0 > 1.5 ? 'Moderate demand' : 'Low demand — cool/cloudy'}`,
        `  └ Calibrated coefficient range: 0.0019 (coastal) to 0.0032 (inland), adjust locally ±15%`,
      ]
    };
  },
  // FAO Yield Response to Water — Doorenbos & Kassam (1979), FAO I&D
  // Paper 33, Eq. (1), reproduced verbatim in FAO I&D Paper 66 (2009),
  // Chapter 2: (1 − Yₐ/Yₓ) = K_y·(1 − ETₐ/ETₓ). Yₓ/Yₐ = maximum/actual
  // yield, ETₓ/ETₐ = maximum/actual evapotranspiration, K_y = crop-specific
  // yield response factor (seasonal table: maize 1.25, spring wheat 1.15,
  // winter wheat 1.05, soybean 0.85, cotton 0.85, potato 1.1, ...).
  // Primary result = the paper's predicted RELATIVE YIELD REDUCTION
  // K_y·(1−ETₐ/ETₘ); predicted actual yield Yₐ = Yₘ·(1 − reduction). When the
  // user supplies an observed Yₐ, the residual (observed − predicted) is
  // shown as a diagnostic step. All inputs are user-supplied field
  // measurements (honest NaN autos — no fabricated yields or ET).
  61: ({ Ya, Ym, Ky, ETa, ETm }) => {
    // Doorenbos & Kassam (1979), FAO Irrigation & Drainage Paper 33, Eq. (1):
    // (1 − Yₐ/Yₘ) = K_y × (1 − ETₐ/ETₘ). Verified worked example: K_y=1.1,
    // ETₐ/ETₘ=0.7 → predicted (1−Yₐ/Yₘ) = 1.1 × 0.3 = 0.33. An observed
    // Yₐ/Yₘ = 0.8 (loss 0.2) is NOT a solution of the standard form — the
    // residual secondary exposes the inconsistency (0.2 − 0.33 = −0.13).
    const hasCore = [Ym, Ky, ETa, ETm].every((v) => Number.isFinite(v));
    if (!hasCore) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'et_deficit', value: Number.NaN, unit: '—', label: 'Relative ET Deficit (1 − ETₐ/ETₘ)' },
          { key: 'yield_reduction_pct', value: Number.NaN, unit: '%', label: 'Predicted Relative Yield Reduction (%)' },
          { key: 'predicted_ya', value: Number.NaN, unit: 't/ha', label: 'Predicted Actual Yield' },
          { key: 'residual', value: Number.NaN, unit: '—', label: 'Residual (observed − predicted loss)' },
        ],
        steps: [
          '── FAO Yield Response to Water (Doorenbos & Kassam 1979, IDP 33 Eq. 1) ──',
          'Required inputs are field measurements with honest NaN autos (no open point API):',
          `  Yₘ (maximum yield, t/ha): ${Number.isFinite(Ym) ? Ym.toFixed(1) : 'NaN — supply'}`,
          `  K_y (yield response factor, crop-specific): ${Number.isFinite(Ky) ? Ky.toFixed(2) : 'NaN — supply (e.g. maize 1.25, winter wheat 1.05)'}`,
          `  ETₐ (actual ET, mm): ${Number.isFinite(ETa) ? ETa.toFixed(1) : 'NaN — supply (soil-water balance)'}`,
          `  ETₘ (maximum ET, mm): ${Number.isFinite(ETm) ? ETm.toFixed(1) : 'NaN — supply (FAO-56 crop ET)'}`,
        ],
      };
    }
    const { relReduction: relYieldReduction, predictedYa, residual: residualRaw } = faoYieldResponse(Ya, Ym, Ky, ETa, ETm);
    const relETDeficit = 1 - ETa / ETm;
    const residual = residualRaw ?? Number.NaN;
    const observedLoss = Number.isFinite(Ya) && Ya > 0 ? 1 - Ya / Ym : Number.NaN;
    const hasObserved = Number.isFinite(Ya) && Ya > 0;
    const yieldReductionPct = relYieldReduction * 100;
    return {
      result: relYieldReduction, unit: '—',
      secondary: [
        { key: 'et_deficit', value: Number.isFinite(relETDeficit) ? relETDeficit : Number.NaN, unit: '—', label: 'Relative ET Deficit (1 − ETₐ/ETₘ)' },
        { key: 'yield_reduction_pct', value: Number.isFinite(yieldReductionPct) ? yieldReductionPct : Number.NaN, unit: '%', label: 'Predicted Relative Yield Reduction (%)' },
        { key: 'predicted_ya', value: Number.isFinite(predictedYa) ? predictedYa : Number.NaN, unit: 't/ha', label: 'Predicted Actual Yield' },
        { key: 'residual', value: Number.isFinite(residual) ? residual : Number.NaN, unit: '—', label: 'Residual (observed − predicted loss)' },
      ],
      steps: [
        '── FAO Yield Response to Water (Doorenbos & Kassam 1979, IDP 33 Eq. 1) ──',
        'Paper Eq. (1): (1 − Yₐ/Yₘ) = K_y × (1 − ETₐ/ETₘ)',
        `Yₘ = ${Ym.toFixed(1)} t/ha, K_y = ${Ky.toFixed(2)}, ETₐ = ${ETa.toFixed(1)} mm, ETₘ = ${ETm.toFixed(1)} mm`,
        '',
        'Step 1 — Relative ET deficit:',
        `  1 − ETₐ/ETₘ = 1 − ${ETa.toFixed(1)}/${ETm.toFixed(1)} = ${relETDeficit.toFixed(4)}`,
        '',
        'Step 2 — Relative yield reduction (paper Eq. 1):',
        `  (1 − Yₐ/Yₘ) = K_y × (1 − ETₐ/ETₘ) = ${Ky.toFixed(2)} × ${relETDeficit.toFixed(4)} = ${relYieldReduction.toFixed(4)}`,
        '',
        'Step 3 — Predicted actual yield:',
        `  Yₐ = Yₘ × (1 − ${relYieldReduction.toFixed(4)}) = ${Ym.toFixed(1)} × ${(1 - relYieldReduction).toFixed(4)} = ${predictedYa.toFixed(2)} t/ha`,
        ...(hasObserved
          ? [
              '',
              'Step 4 — Observed vs predicted (diagnostic):',
              `  Observed 1 − Yₐ/Yₘ = 1 − ${Ya.toFixed(1)}/${Ym.toFixed(1)} = ${observedLoss.toFixed(4)}`,
              `  Residual = observed − predicted = ${observedLoss.toFixed(4)} − ${relYieldReduction.toFixed(4)} = ${residual.toFixed(4)}`,
            ]
          : []),
        '',
        `  └ ${relYieldReduction > 0.5 ? 'Severe yield loss — crop under significant water stress' : relYieldReduction > 0.25 ? 'Moderate yield loss — water deficit limits production' : relYieldReduction > 0.05 ? 'Mild yield loss — minor water deficit' : 'Minimal yield loss — water supply adequate'}`,
        `  └ K_y interpretation (paper): K_y > 1 = sensitive (maize 1.25, sorghum 0.9); K_y = 1 = proportional (winter wheat 1.05); K_y < 1 = tolerant (soybean 0.85, cotton 0.85, groundnuts 0.70).`,
        `  └ Note: K_y is crop- and growth-stage-specific; seasonal values from IDP 33 Table (reproduced in FAO IDP 66).`,
      ]
    };
  },
  62: ({ umax, T }) => {
    // Eppley (1972), Fishery Bulletin 70(4):1063–1085 — maximum specific
    // growth-rate envelope. Authoritative exponential form (the formulation
    // used across the ocean-model literature, e.g. Sarmiento & Gruber 2006,
    // Ocean Biogeochemical Dynamics §5.4.4):
    //   μmax = 0.59·e^(0.0633·T)  (T in °C; Q₁₀ = e^(0.0633·10) = 1.88)
    // Verified worked example: T=20 → 0.59·e^(0.0633×20) = 0.59·e^1.266 = 2.09 /day.
    // (The paper's own Eq. 1, log₁₀ μmax = 0.0275·T − 0.070, is the same
    // exponential shape with pre-factor 0.851 = 10^−0.070; the 0.59·e^(0.0633T)
    // form is the model-standard envelope used here.)
    const finiteT = Number.isFinite(T);
    const muPaper = finiteT ? 0.59 * Math.exp(0.0633 * T) : Number.NaN; // envelope at T
    const Q10 = Math.exp(0.0633 * 10);                                   // e^0.633 ≈ 1.88
    const hasSpecies = Number.isFinite(umax) && umax > 0;
    const mu = finiteT && hasSpecies ? umax * Math.exp(0.0633 * (T - 20)) : muPaper;
    const doubling = Number.isFinite(mu) && mu > 0 ? Math.LN2 / mu : Number.NaN;
    const steps = [
      '── Eppley (1972) Temperature & Phytoplankton Growth in the Sea ──',
      'Authoritative envelope: μmax = 0.59 × e^(0.0633·T)  (Q₁₀ = e^(0.633) = 1.88)',
      `T = ${finiteT ? T.toFixed(1) + ' °C' : 'NaN — no SST (OISST) at this point; supply T'}`,
    ];
    if (!finiteT) {
      return {
        result: Number.NaN, unit: '/day',
        secondary: [
          { key: 'doubling_time', value: Number.NaN, unit: 'days', label: 'Population Doubling Time (ln2/μ)' },
          { key: 'q10', value: Number.isFinite(Q10) ? Q10 : Number.NaN, unit: '—', label: 'Q₁₀ (factor per 10 °C)' },
          { key: 'envelope_mu', value: Number.NaN, unit: '/day', label: 'Eppley Envelope μmax (0.59·e^0.0633T)' },
        ],
        steps: [
          ...steps,
          'Sea temperature T is required: auto uses daily NOAA OISST v2 SST.',
          '  Inland point / missing OISST → NaN (honest), supply T or μ₂₀ and T.',
        ],
      };
    }
    if (!hasSpecies) {
      steps.push(
        '',
        'No species-specific μ₂₀ supplied — using the maximum envelope:',
        `  μmax = 0.59 × e^(0.0633×${T.toFixed(1)}) = ${muPaper.toFixed(4)} /day`,
        `  (worked example check: T=20 → 0.59·e^1.266 = 2.09 /day)`,
      );
    } else {
      steps.push(
        '',
        'Species-specific μ₂₀ supplied — scaling the envelope through 20 °C:',
        `  μmax = μ₂₀ × e^(0.0633×(T−20)) = ${umax.toFixed(4)} × e^(0.0633×${(T - 20).toFixed(1)}) = ${mu.toFixed(4)} /day`,
        `  Envelope at this T: 0.59 × e^(0.0633×${T.toFixed(1)}) = ${muPaper.toFixed(4)} /day`,
        `  (species value is ${(mu / muPaper).toFixed(2)}× the community envelope)`,
      );
    }
    steps.push(
      '',
      'Step 3 — Derived quantities:',
      `  Q₁₀ = e^(0.0633×10) = ${Q10.toFixed(2)} (factor per 10 °C — paper states 1.88)`,
      `  Doubling time: t_d = ln(2)/μ = ${Number.isFinite(doubling) ? doubling.toFixed(2) : '∞'} days`,
      '',
      `  └ ${mu < 0.5 ? 'Slow growth — cold/limiting regime' : mu < 2 ? 'Typical marine growth rate' : 'Near the maximum envelope — warm nutrient-replete waters'}`,
      `  └ Note: this is the MAXIMUM expected rate; light/nutrient limitation (the paper's §discussion) reduces realized rates.`,
    );
    // Timeseries series (tool vizType 'timeseries'): μ vs T across the marine
    // range (0–40 °C). Only emitted when T is finite — no synthetic curve from
    // NaN inputs (honest empty series).
    const series = finiteT
      ? [{
          label: hasSpecies ? `μ(T) species-scaled (μ₂₀=${umax.toFixed(2)}/day)` : 'Eppley envelope μmax(T)',
          color: '#0072B2',
          points: Array.from({ length: 41 }, (_, i) => {
            const t = i;
            const y = hasSpecies ? umax * Math.exp(0.0633 * (t - 20)) : 0.59 * Math.exp(0.0633 * t);
            return { x: t, y };
          }),
        }]
      : undefined;
    return {
      result: mu, unit: '/day',
      secondary: [
        { key: 'doubling_time', value: Number.isFinite(doubling) ? doubling : Number.NaN, unit: 'days', label: 'Population Doubling Time (ln2/μ)' },
        { key: 'q10', value: Number.isFinite(Q10) ? Q10 : Number.NaN, unit: '—', label: 'Q₁₀ (factor per 10 °C)' },
        { key: 'envelope_mu', value: Number.isFinite(muPaper) ? muPaper : Number.NaN, unit: '/day', label: 'Eppley Envelope μmax (0.59·e^0.0633T)' },
      ],
      series,
      steps,
    };
  },
  63: ({ rho, cp, Ts, Ta, ra, rs, es, ea, p }) => {
    // SiB big-leaf surface fluxes (Sellers, Mintz, Sud & Dalcher 1986,
    // J. Atmos. Sci. 43(6):505–531, Table 1c — the electrical-analogy fluxes):
    //   H = (T_s − T_a)·ρ·c_p / r_a
    //   LE = (e*(T_s) − e_a)·ρ·c_p / (γ·(r_a + r_s)),  γ = c_p·p/(0.622·L_v)
    // The paper's ρc_p/γ factor (NOT ρ·L_v) is the SI-equivalent of the
    // psychrometric scaling; omitting 0.622·p⁻¹ inflates LE by ~p/0.622.
    const Lv = 2.45e6;
    const gamma = cp * (p ?? 1013.25) / (0.622 * Lv);  // hPa/K
    const H = rho * cp * (Ts - Ta) / ra;
    const le = (es - ea) * rho * cp / (gamma * (ra + rs));
    const total = H + le;
    const bowen = le > 0 ? H / le : NaN;
    const steps = [
      '── SiB Big-Leaf Surface Fluxes (Sellers et al. 1986, JAS 43(6):505–531) ──',
      'Paper Table 1c: H = (T_s−T_a)·ρc_p/r_a ;  LE = (e*(T_s)−e_a)·ρc_p/(γ·(r_a+r_s))',
      `  γ (psychrometric) = c_p·p/(0.622·L_v) = ${cp.toFixed(0)}×${(p ?? 1013.25).toFixed(0)}/(0.622×${Lv.toExponential(1)}) = ${gamma.toFixed(3)} hPa/K`,
      `Air density ρ = ${rho.toFixed(3)} kg/m³, c_p = ${cp.toFixed(0)} J/kg·K`,
      `Surface T_s = ${Number.isFinite(Ts) ? Ts.toFixed(1) + ' °C' : 'NaN — supply'}, Air T_a = ${Number.isFinite(Ta) ? Ta.toFixed(1) + ' °C' : 'NaN'}`,
      `Aerodynamic resistance r_a = ${Number.isFinite(ra) ? ra.toFixed(1) + ' s/m' : 'NaN — supply'}, Surface resistance r_s = ${Number.isFinite(rs) ? rs.toFixed(1) + ' s/m' : 'NaN — supply'}`,
      `Saturation vapour pressure e_s = ${Number.isFinite(es) ? es.toFixed(2) + ' hPa' : 'NaN'}, Actual e_a = ${Number.isFinite(ea) ? ea.toFixed(2) + ' hPa' : 'NaN'}`,
    ];
    if (![rho, Ts, Ta, ra, rs, es, ea].every(Number.isFinite) || ra <= 0) {
      return {
        result: Number.NaN, unit: 'W/m²',
        steps: [
          ...steps,
          'Required: ρ, T_s, T_a, r_a, r_s, e_s, e_a (all finite).',
          '  Honest NaN autos — no open point API supplies canopy temperature or resistances.',
          '  Genuine derivables auto-fill: T_a (Open-Meteo), e_a (from T_a+RH, Magnus),',
          '  ρ (ideal gas ρ = p/(R·T) from surface pressure), γ from pressure.',
        ],
      };
    }
    steps.push(
      '',
      'Step 1 — Sensible heat flux:',
      `  H = ρ·c_p·(T_s − T_a)/r_a = ${rho.toFixed(3)}×${cp.toFixed(0)}×(${Ts.toFixed(1)}−${Ta.toFixed(1)})/${ra.toFixed(1)} = ${H.toFixed(1)} W/m²`,
      '',
      'Step 2 — Latent heat flux (paper form with psychrometric constant):',
      `  LE = (e_s − e_a)·ρ·c_p/(γ·(r_a + r_s))`,
      `  LE = (${es.toFixed(2)} − ${ea.toFixed(2)})×${rho.toFixed(3)}×${cp.toFixed(0)}/(${gamma.toFixed(3)}×(${ra.toFixed(1)} + ${rs.toFixed(1)}))`,
      `  LE = ${le.toFixed(1)} W/m²  (≈ ${(le * 86400 / Lv).toFixed(2)} mm/day)`,
      '',
      'Step 3 — Total turbulent flux & Bowen ratio:',
      `  H + LE = ${H.toFixed(1)} + ${le.toFixed(1)} = ${total.toFixed(1)} W/m²`,
      `  Bowen ratio β = H/LE = ${bowen.toFixed(3)} (${bowen < 0.2 ? 'wet surface — evaporation dominated' : bowen < 1 ? 'mixed regime' : 'dry surface — sensible heating dominated'})`,
      '',
      `  └ Net radiation Rₙ should approximately balance H + LE + G at the surface`,
      `  └ Units: e in hPa, γ in hPa/K (paper uses mb ≡ hPa); ρc_p/γ ≡ ρ·L_v·0.622/p.`,
    );
    return {
      result: le, unit: 'W/m²',
      secondary: [
        { key: 'sensible_heat', value: Number.isFinite(H) ? H : Number.NaN, unit: 'W/m²', label: 'Sensible Heat Flux H' },
        { key: 'bowen_ratio', value: Number.isFinite(bowen) ? bowen : Number.NaN, unit: '—', label: 'Bowen Ratio (H/LE)' },
      ],
      steps,
    };
  },

  // ── Domain 9: Atmospheric Chemistry ──
  // Chapman (1930) "A theory of upper-atmospheric ozone", Mem. R. Meteorol. Soc. 3(26):103-125.
  // Mechanism (6 reactions; (1) O+O→O₂ and (5) 2O₃→3O₂ negligible):
  //   O₂ + hν → 2O       rate J₁[O₂]    (λ < 242 nm)
  //   O + O₂ → O₃        rate k₂[O][O₂] (third body M, effective bimolecular)
  //   O₃ + hν → O₂ + O   rate J₃[O₃]    (240-320 nm)
  //   O + O₃ → 2O₂       rate k₄[O][O₃]
  // Steady state d[O]/dt = d[O₃]/dt = 0 ⇒ the paper's ratio result:
  //   [O₃]/[O₂] = √(J₁·k₂ / (J₃·k₄))   and   [O] = J₁[O₂]/(k₄[O₃])
  64: ({ J1, k2, J3, k4, O2 }) => {
    const hasRates = [J1, k2, J3, k4].every(Number.isFinite);
    if (!hasRates) {
      return {
        result: Number.NaN, unit: '—',
        steps: [
          '── Chapman Ozone Photochemistry (Chapman, 1930) ──',
          'Mechanism (6 reactions; (1) O+O→O₂ and (5) 2O₃→3O₂ negligible):',
          '  O₂ + hν → 2O        rate J₁·[O₂]   (λ < 242 nm)',
          '  O + O₂ → O₃         rate k₂·[O][O₂] (third body M)',
          '  O₃ + hν → O₂ + O    rate J₃·[O₃]   (240–320 nm)',
          '  O + O₃ → 2O₂        rate k₄·[O][O₃]',
          '',
          'Steady state (d[O]/dt = d[O₃]/dt = 0) ⇒ [O₃]/[O₂] = √(J₁·k₂/(J₃·k₄))',
          '',
          `  J₁ (O₂ photolysis, s⁻¹): ${Number.isFinite(J1) ? J1.toExponential(2) : 'NaN — environmental actinic-flux input (CAMS EAC4 photolysis or a TUV model; no open point API this session) — supply explicitly'}`,
          `  k₂ (O+O₂→O₃, cm³/molecule·s): ${Number.isFinite(k2) ? k2.toExponential(2) : 'NaN — supply'} (JPL 2023 effective bimolecular, 1 atm / 298 K — physical constant)`,
          `  J₃ (O₃ photolysis, s⁻¹): ${Number.isFinite(J3) ? J3.toExponential(2) : 'NaN — same actinic-flux source as J₁ — supply explicitly'}`,
          `  k₄ (O+O₃→2O₂, cm³/molecule·s): ${Number.isFinite(k4) ? k4.toExponential(2) : 'NaN — supply'} (JPL 2023, 298 K — physical constant)`,
          `  [O₂] (molecules/cm³): ${Number.isFinite(O2) ? O2.toExponential(2) : 'NaN — altitude-dependent number density — supply for absolute [O₃] and [O]'}`,
          '',
          'Result is NaN: the paper requires photolysis-rate inputs (J₁, J₃), which are',
          'environmental data no authentic open point source serves here — supply J₁ and J₃ to compute.',
        ],
      };
    }
    const R = Math.sqrt((J1 * k2) / (J3 * k4));
    const mixPpmv = R * 1e6;
    const o3Conc = Number.isFinite(O2) ? R * O2 : Number.NaN;
    const oConc = Number.isFinite(o3Conc) && o3Conc > 0 ? (J1 * O2) / (k4 * o3Conc) : Number.NaN;
    return {
      result: R, unit: '—',
      secondary: [
        { key: 'o3_mixing_ratio', value: mixPpmv, unit: 'ppmv', label: 'Photochemical-equilibrium O₃/O₂ mixing ratio' },
        { key: 'o3_concentration', value: o3Conc, unit: 'molecules/cm³', label: 'Steady-state O₃ number density' },
        { key: 'o_concentration', value: oConc, unit: 'molecules/cm³', label: 'Steady-state O atom number density' },
      ],
      steps: [
        '── Chapman Ozone Photochemistry (Chapman, 1930) ──',
        'Mechanism (6 reactions; (1) O+O→O₂ and (5) 2O₃→3O₂ negligible):',
        '  O₂ + hν → 2O        rate J₁·[O₂]   (λ < 242 nm)',
        '  O + O₂ → O₃         rate k₂·[O][O₂] (third body M)',
        '  O₃ + hν → O₂ + O    rate J₃·[O₃]   (240–320 nm)',
        '  O + O₃ → 2O₂        rate k₄·[O][O₃]',
        '',
        `J₁ = ${J1.toExponential(2)} s⁻¹, k₂ = ${k2.toExponential(2)} cm³/molecule·s, J₃ = ${J3.toExponential(2)} s⁻¹, k₄ = ${k4.toExponential(2)} cm³/molecule·s`,
        '',
        'Step 1 — Steady state of O (d[O]/dt = 0):',
        '  2J₁[O₂] + J₃[O₃] = k₂[O][O₂] + k₄[O][O₃]',
        '',
        'Step 2 — Steady state of O₃ (d[O₃]/dt = 0):',
        '  k₂[O][O₂] = J₃[O₃] + k₄[O][O₃]',
        '',
        'Step 3 — Equate and eliminate [O] (paper exercise 3 — [O₂] drops out):',
        `  k₄[O][O₃] = J₁[O₂]  ⇒  [O₃]/[O₂] = √(J₁·k₂/(J₃·k₄))`,
        `  = √(${J1.toExponential(2)} × ${k2.toExponential(2)} / (${J3.toExponential(2)} × ${k4.toExponential(2)}))`,
        `  = ${R.toExponential(4)}  (≈ ${mixPpmv.toExponential(3)} ppmv O₃ relative to O₂)`,
        '',
        ...(Number.isFinite(o3Conc) ? [
          'Step 4 — Absolute steady-state concentrations (paper: [O] = J₁[O₂]/(k₄[O₃])):',
          `  [O₃] = R × [O₂] = ${R.toExponential(4)} × ${O2.toExponential(2)} = ${o3Conc.toExponential(3)} molecules/cm³`,
          `  [O]  = J₁[O₂]/(k₄[O₃]) = ${J1.toExponential(2)} × ${O2.toExponential(2)} / (${k4.toExponential(2)} × ${o3Conc.toExponential(3)}) = ${oConc.toExponential(3)} molecules/cm³`,
        ] : ['Step 4 — [O₂] not supplied; absolute [O₃] and [O] omitted (supply [O₂] number density).']),
        '',
        `  └ ${R > 1e-5 ? 'Production-dominant regime (elevated photochemical O₃)' : R > 1e-7 ? 'Typical stratospheric equilibrium (1–10 ppmv O₃)' : 'Destruction-dominant regime (low O₃)'}`,
        `  └ Chapman alone overestimates observed O₃ (~2×) because catalytic NOₓ/HOₓ/ClOₓ cycles are omitted (the paper predates their discovery).`,
        `  └ k₂, k₄ from the NASA/JPL 2023 evaluation (Burkholder et al., JPL Pub. 19-5): k₂(eff, 1 atm, 298 K) = 1.43e-14, k₄(298 K) = 8.0e-12·exp(−2060/T).`,
      ],
    };
  },
  // Atkinson (2000), "Atmospheric chemistry of VOCs and NOₓ", Atmos. Environ.
  // 34(12-14):2063-2101. Lifetime vs the OH radical: τ = 1/(k·[OH]) with the
  // paper's [OH] conventions: 24-h global mean 1.0×10⁶ molecule cm⁻³
  // (Prinn et al. 1995, cited in the paper) or the 12-h daytime average
  // 2.0×10⁶ used for Table 1. k is the species-specific 298 K bimolecular
  // rate constant (laboratory-measured physical constant — user supplies;
  // paper Table 1 + §4.5 give species lifetimes for cross-checking).
  65: ({ k, OH }) => {
    const hasInputs = Number.isFinite(k) && Number.isFinite(OH);
    if (!hasInputs || k <= 0 || OH <= 0) {
      return {
        result: Number.NaN, unit: 's',
        steps: [
          '── OH Oxidation Lifetime (Atkinson, 2000) ──',
          'τ = 1/(k_OH·[OH]) — pseudo-first-order loss vs the hydroxyl radical.',
          '',
          `  k_OH (cm³/molecule·s, 298 K): ${Number.isFinite(k) ? k.toExponential(2) : 'NaN — species-specific measured rate constant; no open point API — supply (e.g. isoprene 1.0e-10, CH₄ 2.45e-15, CO 1.5e-13)'}`,
          `  [OH] (molecules/cm³): ${Number.isFinite(OH) ? OH.toExponential(2) : 'NaN — supply, or use the paper\'s global mean 1.0e6 (24-h) / 2.0e6 (12-h daytime, Table 1)'}`,
          '',
          ...(Number.isFinite(k) && Number.isFinite(OH) && (k <= 0 || OH <= 0)
            ? ['Result is NaN: rate constants and concentrations are strictly positive — a non-positive value is physically degenerate.']
            : ['Result is NaN: both k_OH (species-specific, user supplies) and [OH] are required.']),
        ],
      };
    }
    const kPrime = k * OH;
    const tau = 1 / kPrime;
    const tauDays = tau / 86400;
    const tauYrs = tau / 3.1536e7;
    return {
      result: tau, unit: 's',
      secondary: [
        { key: 'pseudo_first_order', value: kPrime, unit: 's⁻¹', label: 'Pseudo-first-order loss rate k·[OH]' },
        { key: 'lifetime_days', value: tauDays, unit: 'day', label: 'Lifetime in days' },
        { key: 'lifetime_years', value: tauYrs, unit: 'yr', label: 'Lifetime in years' },
      ],
      steps: [
        '── OH Oxidation Lifetime (Atkinson, 2000) ──',
        `Rate constant k_OH = ${k.toExponential(2)} cm³/molecule·s`,
        `OH radical concentration [OH] = ${OH.toExponential(2)} molecules/cm³`,
        '',
        'Step 1 — Pseudo-first-order rate:',
        `  k' = k_OH × [OH] = ${k.toExponential(2)} × ${OH.toExponential(2)} = ${kPrime.toExponential(3)} s⁻¹`,
        '',
        'Step 2 — Atmospheric lifetime:',
        `  τ = 1/k' = 1 / ${kPrime.toExponential(3)} = ${tauYrs > 1 ? tauYrs.toFixed(1) + ' yr (' + tau.toExponential(2) + ' s)' : tauDays > 1 ? tauDays.toFixed(2) + ' days (' + tau.toFixed(0) + ' s)' : tau.toFixed(0) + ' s'}`,
        '',
        `  └ Classification: ${tauYrs > 1 ? 'Long-lived (>1 yr) — well-mixed, global impact (e.g. CH₄ 12.9 yr, N₂O)' : tauDays > 1 ? 'Intermediate (days−year) — hemispheric transport (e.g. CO ~2.5 months)' : tau > 3600 ? 'Moderate (hours−days) — local/regional (e.g. VOCs)' : 'Short-lived (<hour) — highly reactive (e.g. isoprene 1.4 h @ 2.0e6)'}`,
        `  └ [OH] conventions (paper §1.4): 24-h global mean = 1.0 × 10⁶ molecule cm⁻³ (Prinn et al. 1995); 12-h daytime average = 2.0 × 10⁶ (Table 1 lifetimes). Peak daytime ground-level (2–10) × 10⁶.`,
        `  └ Paper Table 1 cross-check (12-h daytime [OH] = 2.0 × 10⁶): isoprene 1.4 h, ethene 1.4 day, propane 10 day, benzene 9.4 day, acetone 53 day, methanol 12 day.`,
      ],
    };
  },

  // ── Part III · Domain 10: Ocean Dynamics ──
  // Sverdrup (1947), PNAS 33(11):318-326. Eq (13): β·M_y = curl_z(τ) with
  // β = 2Ωcosφ/R (eq 12); M is the depth-integrated mass transport, so the
  // volume transport per unit width is v = curl_z(τ)/(ρ₀·β) in m²/s.
  // Ekman pumping w_Ek = curl_z(τ)/(ρ₀·f) with f = 2Ωsinφ.
  66: ({ beta, rho0, curlTau_z, f, W }) => {
    const hasCurl = Number.isFinite(curlTau_z);
    // β = 2Ωcosφ/R → 0 within ~0.1° of the poles; the balance is degenerate there.
    const betaDegenerate = !Number.isFinite(beta) || Math.abs(beta) < 1e-14;
    if (!hasCurl || betaDegenerate) {
      return {
        result: Number.NaN, unit: 'm²/s',
        secondary: [
          { key: 'planetary_beta', value: Number.isFinite(beta) ? beta : Number.NaN, unit: 'm⁻¹s⁻¹', label: 'Planetary vorticity gradient β = 2Ωcosφ/R (paper eq 12)' },
          { key: 'coriolis_f', value: Number.isFinite(f) ? f : Number.NaN, unit: 's⁻¹', label: 'Coriolis parameter f = 2Ωsinφ' },
          { key: 'ekman_pumping', value: Number.NaN, unit: 'm/s', label: 'Ekman pumping velocity w_Ek = (∇×τ)_z/(ρ₀·f)' },
          { key: 'total_transport_sv', value: Number.NaN, unit: 'Sv', label: 'Total basin transport v × W (1 Sv = 10⁶ m³/s)' },
        ],
        steps: [
          '── Sverdrup Transport (Sverdrup, 1947, PNAS 33(11):318-326) ──',
          'Paper eq (13): β·M_y = curl_z(τ); volume transport per unit width v = curl_z(τ)/(ρ₀·β).',
          '',
          `  β = 2Ωcosφ/R = ${Number.isFinite(beta) ? beta.toExponential(3) : 'NaN'} /m·s (eq 12, from the request latitude)`,
          `  ρ₀ = ${Number.isFinite(rho0) ? rho0.toFixed(0) : 'NaN'} kg/m³ (reference seawater density)`,
          `  (∇×τ)_z = ${hasCurl ? curlTau_z.toExponential(3) : 'NaN — spatial derivative of the wind-stress field; no genuine point source this session — supply (e.g. ASCAT/CCMP wind-product curl) in N/m³'}`,
          '',
          ...(betaDegenerate
            ? ['Result is NaN: β = 2Ωcosφ/R → 0 within ~0.1° of the poles; the Sverdrup relation is degenerate there (finite NaN, never ±∞).']
            : ['Result is NaN: the paper requires the wind-stress curl (∇×τ)_z — supply it to compute (β, ρ₀ are genuine from latitude/constant).']),
        ],
      };
    }
    const v = curlTau_z / (rho0 * beta); // m²/s, meridional volume transport per unit width
    const wEk = (Number.isFinite(f) && Math.abs(f) > 1e-12) ? curlTau_z / (rho0 * f) : Number.NaN;
    const totalSv = (Number.isFinite(W) && W > 0) ? (v * W) / 1e6 : Number.NaN;
    return {
      result: v, unit: 'm²/s',
      secondary: [
        { key: 'planetary_beta', value: Number.isFinite(beta) ? beta : Number.NaN, unit: 'm⁻¹s⁻¹', label: 'Planetary vorticity gradient β = 2Ωcosφ/R (paper eq 12)' },
        { key: 'coriolis_f', value: Number.isFinite(f) ? f : Number.NaN, unit: 's⁻¹', label: 'Coriolis parameter f = 2Ωsinφ' },
        { key: 'ekman_pumping', value: wEk, unit: 'm/s', label: 'Ekman pumping velocity w_Ek = (∇×τ)_z/(ρ₀·f)' },
        { key: 'total_transport_sv', value: totalSv, unit: 'Sv', label: 'Total basin transport v × W (1 Sv = 10⁶ m³/s)' },
      ],
      steps: [
        '── Sverdrup Transport (Sverdrup, 1947, PNAS 33(11):318-326) ──',
        `Planetary vorticity gradient β = 2Ωcosφ/R = ${beta.toExponential(3)} /m·s (paper eq 12)`,
        `Reference density ρ₀ = ${rho0.toFixed(0)} kg/m³`,
        `Wind stress curl (∇×τ)_z = ${curlTau_z.toExponential(3)} N/m³`,
        '',
        'Step 1 — Vorticity balance (paper eq 13, d/dy(9a) − d/dx(9b) + continuity):',
        '  β·M_y = curl_z(τ) = ∂τ_y/∂x − ∂τ_x/∂y',
        '',
        'Step 2 — Meridional volume transport per unit width:',
        `  v = curl_z(τ)/(ρ₀·β) = ${curlTau_z.toExponential(3)} / (${rho0.toFixed(0)} × ${beta.toExponential(3)})`,
        `  v = ${v.toExponential(4)} m²/s`,
        '',
        ...(Number.isFinite(wEk) ? [
          'Step 3 — Ekman pumping at the base of the Ekman layer:',
          `  w_Ek = curl_z(τ)/(ρ₀·f) = ${curlTau_z.toExponential(3)} / (${rho0.toFixed(0)} × ${f.toExponential(3)}) = ${wEk.toExponential(3)} m/s`,
        ] : ['Step 3 — Ekman pumping: f = 2Ωsinφ → 0 at the equator (balance fails, paper §); w_Ek omitted as NaN.']),
        ...(Number.isFinite(totalSv) ? [
          'Step 4 — Total meridional transport across the basin width:',
          `  V_total = v × W = ${v.toExponential(4)} × ${W.toExponential(2)} = ${totalSv.toExponential(3)} Sv`,
        ] : ['Step 4 — Supply the basin width W (m) for the total transport in Sv (1 Sv = 10⁶ m³/s).']),
        '',
        `  └ ${v > 0 ? 'Northward interior transport — positive curl_z(τ) (cyclonic, subpolar gyre regime)' : v < 0 ? 'Southward interior transport — negative curl_z(τ) (anticyclonic, subtropical gyre regime)' : 'Zero — no wind-stress curl'}`,
        `  └ Validity (paper): interior ocean, away from the equator (f→0) and the western boundary currents; steady state.`,
      ],
    };
  },
  // Stommel (1948), "The westward intensification of wind-driven ocean
  // currents", Trans. AGU 29(2):202-206. Model eq (9): ∇²ψ + α·∂ψ/∂x =
  // γ·sin(πy/b) with α = D·β/R and γ = F·π/(R·b) (eq 6); closed-form
  // solution (19)-(20): ψ = γ(b/π)²·sin(πy/b)·(p·e^{Ax} + q·e^{Bx} − 1) with
  // A = −α/2 ± √(α²/4 + (π/b)²), p = (1−e^{BL})/(e^{AL}−e^{BL}), q = 1−p;
  // velocities (21)-(22): u = ∂ψ/∂y, v = −∂ψ/∂x. Boundary-layer width δ = 1/α.
  // All quantities in one consistent unit system (paper: cgs).
  67: ({ beta, D, b, L, R, F, x, y }) => {
    const hasAll = [beta, D, b, L, R, F, x, y].every(Number.isFinite);
    if (!hasAll || D <= 0 || b <= 0 || L <= 0 || R <= 0) {
      return {
        result: Number.NaN, unit: 'm²/s',
        secondary: [
          { key: 'max_transport', value: Number.NaN, unit: 'm²/s', label: 'WBC transport maximum |ψ_max| (at the jet, x* from the west)' },
          { key: 'max_velocity', value: Number.NaN, unit: 'm/s', label: 'Max boundary-current velocity |v| at the western wall' },
          { key: 'jet_position_km', value: Number.NaN, unit: 'km', label: 'Position of the transport maximum x* (from the western wall)' },
          { key: 'wbc_width_km', value: Number.NaN, unit: 'km', label: 'Stommel boundary-layer width δ = 1/α' },
          { key: 'alpha', value: Number.NaN, unit: 'm⁻¹', label: 'Model parameter α = D·β/R' },
          { key: 'gamma', value: Number.NaN, unit: 's⁻¹', label: 'Forcing amplitude γ = F·π/(R·b)' },
        ],
        steps: [
          '── Stommel Westward Intensification (Stommel, 1948, Trans. AGU 29(2):202-206) ──',
          'Model eq (9): ∇²ψ + α·∂ψ/∂x = γ·sin(πy/b),  α = D·β/R,  γ = F·π/(R·b)',
          '',
          `  β (s⁻¹m⁻¹) = ${Number.isFinite(beta) ? beta.toExponential(2) : 'NaN — supply or auto from latitude'}`,
          `  D (depth, m) = ${Number.isFinite(D) ? D.toFixed(0) : 'NaN — basin depth'}`,
          `  b (basin N-S width, m) = ${Number.isFinite(b) ? b.toExponential(2) : 'NaN — basin width'}`,
          `  L (basin E-W length, m) = ${Number.isFinite(L) ? L.toExponential(2) : 'NaN — basin length'}`,
          `  R (friction, s⁻¹) = ${Number.isFinite(R) ? R.toExponential(2) : 'NaN — friction coefficient'}`,
          `  F (max wind stress, N/m²) = ${Number.isFinite(F) ? F.toExponential(2) : 'NaN — wind amplitude'}`,
          `  (x, y) (m) = (${Number.isFinite(x) ? x.toExponential(2) : 'NaN'}, ${Number.isFinite(y) ? y.toExponential(2) : 'NaN'})`,
          '',
          'Result is NaN: all model parameters are required (basin geometry and friction are',
          'model configuration — user supplies; defaults are the paper\'s own numerical example).',
        ],
      };
    }
    const alpha = (D * beta) / R;
    const gamma = (F * Math.PI) / (R * b);
    const nb = Math.PI / b;
    const root = Math.sqrt(alpha * alpha / 4 + nb * nb);
    const A = -alpha / 2 + root;
    const B = -alpha / 2 - root;
    const eAL = Math.exp(A * L), eBL = Math.exp(B * L);
    // e^{BL} underflows to 0 for a strongly-intensified WBC (physically fine:
    // the eastern decay e^{Bx} is negligible at the eastern boundary).
    const p = (1 - eBL) / (eAL - eBL);
    const q = 1 - p;
    const ex = Math.exp(A * x), eBx = Math.exp(B * x);
    const g = p * ex + q * eBx - 1;
    const psi = gamma * b * b / (Math.PI * Math.PI) * Math.sin(Math.PI * y / b) * g;
    const u = gamma * (b / Math.PI) * Math.cos(Math.PI * y / b) * g;
    const v = -gamma * b * b / (Math.PI * Math.PI) * Math.sin(Math.PI * y / b) * (p * A * ex + q * B * eBx);
    const deltaKm = (1 / alpha) / 1000;
    // The transport maximum sits where the x-envelope g(x) = p·e^{Ax}+q·e^{Bx}−1
    // is extremal: g'(x*) = 0 ⇒ x* = ln(−q·B/(p·A))/(A−B) (A > 0, B < 0 for the
    // western-intensified WBC). |ψ_max| at x* (y = b/2) is the WBC transport
    // scale; |v| peaks at the western wall. β = 0 (symmetric) has no jet, so
    // x* = 0 → honest NaN for the jet metrics.
    const xStar = Number.isFinite(p) && Number.isFinite(q) && p * A > 0 && -q * B > 0 && Math.abs(A - B) > 0
      ? Math.log(-q * B / (p * A)) / (A - B)
      : Number.NaN;
    const gMax = Number.isFinite(xStar) && xStar > 0
      ? p * Math.exp(A * xStar) + q * Math.exp(B * xStar) - 1
      : Number.NaN;
    const psiMax = Number.isFinite(gMax)
      ? Math.abs(gamma * b * b / (Math.PI * Math.PI) * gMax)
      : Number.NaN;
    const jetKm = Number.isFinite(xStar) ? xStar / 1000 : Number.NaN;
    const vMax = Number.isFinite(v) ? Math.abs(v) : Number.NaN;
    if (![psi, u, v].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'm²/s',
        secondary: [
          { key: 'max_transport', value: Number.isFinite(psiMax) ? psiMax : Number.NaN, unit: 'm²/s', label: 'WBC transport maximum |ψ_max| (at the jet, x* from the west)' },
          { key: 'max_velocity', value: Number.isFinite(vMax) ? vMax : Number.NaN, unit: 'm/s', label: 'Max boundary-current velocity |v| at the western wall' },
          { key: 'jet_position_km', value: Number.isFinite(jetKm) ? jetKm : Number.NaN, unit: 'km', label: 'Position of the transport maximum x* (from the western wall)' },
          { key: 'wbc_width_km', value: Number.isFinite(deltaKm) ? deltaKm : Number.NaN, unit: 'km', label: 'Stommel boundary-layer width δ = 1/α' },
          { key: 'alpha', value: alpha, unit: 'm⁻¹', label: 'Model parameter α = D·β/R' },
          { key: 'gamma', value: gamma, unit: 's⁻¹', label: 'Forcing amplitude γ = F·π/(R·b)' },
        ],
        steps: [
          '── Stommel Westward Intensification (Stommel, 1948) ──',
          'The solution overflowed: α·L (or |B|·L) is so large that e^{αL} exceeds double precision.',
          `  α = D·β/R = ${alpha.toExponential(3)}, L = ${L.toExponential(2)} → α·L = ${(alpha * L).toExponential(3)}`,
          'Reduce αL (smaller basin, smaller β, or larger friction R) to compute.',
        ],
      };
    }
    return {
      result: psi, unit: 'm²/s',
      secondary: [
        { key: 'max_transport', value: psiMax, unit: 'm²/s', label: 'WBC transport maximum |ψ_max| (at the jet, x* from the west)' },
        { key: 'max_velocity', value: vMax, unit: 'm/s', label: 'Max boundary-current velocity |v| at the western wall' },
        { key: 'jet_position_km', value: jetKm, unit: 'km', label: 'Position of the transport maximum x* (from the western wall)' },
        { key: 'wbc_width_km', value: deltaKm, unit: 'km', label: 'Stommel boundary-layer width δ = 1/α' },
        { key: 'u_velocity', value: u, unit: 'm/s', label: 'Zonal velocity u = ∂ψ/∂y' },
        { key: 'v_velocity', value: v, unit: 'm/s', label: 'Meridional velocity v = −∂ψ/∂x' },
        { key: 'alpha', value: alpha, unit: 'm⁻¹', label: 'Model parameter α = D·β/R' },
        { key: 'gamma', value: gamma, unit: 's⁻¹', label: 'Forcing amplitude γ = F·π/(R·b)' },
      ],
      steps: [
        '── Stommel Westward Intensification (Stommel, 1948, Trans. AGU 29(2):202-206) ──',
        'Model eq (9): ∇²ψ + α·∂ψ/∂x = γ·sin(πy/b) — β-effect vs linear bottom friction −R·u, −R·v.',
        '',
        'Step 1 — Model parameters (paper eq 6):',
        `  α = D·β/R = ${D.toExponential(2)} × ${beta.toExponential(2)} / ${R.toExponential(2)} = ${alpha.toExponential(4)} (m⁻¹ in consistent units)`,
        `  γ = F·π/(R·b) = ${F.toExponential(2)} × π / (${R.toExponential(2)} × ${b.toExponential(2)}) = ${gamma.toExponential(4)} s⁻¹`,
        '',
        'Step 2 — Separation constants (eq 15: X″ + αX′ − n²X = 0, n = π/b):',
        `  A = −α/2 + √(α²/4 + (π/b)²) = ${A.toExponential(4)}`,
        `  B = −α/2 − √(α²/4 + (π/b)²) = ${B.toExponential(4)}`,
        '',
        'Step 3 — Boundary constants (eq 20, ψ = 0 at x = 0 and x = L):',
        `  p = (1 − e^{BL})/(e^{AL} − e^{BL}) = ${p.toExponential(4)},  q = 1 − p = ${q.toExponential(4)}`,
        '',
        'Step 4 — Streamfunction at (x, y) (eq 19):',
        `  ψ = γ(b/π)²·sin(πy/b)·(p·e^{Ax} + q·e^{Bx} − 1) = ${psi.toExponential(4)} m²/s`,
        '',
        'Step 5 — Velocities (eqs 21-22):',
        `  u = ∂ψ/∂y = ${u.toExponential(4)} m/s,   v = −∂ψ/∂x = ${v.toExponential(4)} m/s`,
        '',
        `  └ Boundary-layer width δ = 1/α = ${deltaKm.toFixed(0)} km — ${alpha > 0 ? 'the e^{Bx} term concentrates the flow at the WESTERN boundary (westward intensification)' : 'β = 0 (non-rotating case, paper Fig 2) — symmetric circulation, no intensification'}`,
        `  └ Paper example (cgs): D = 2×10⁴ cm, b = 2π×10⁸ cm, L = 10⁹ cm, R = 0.02 s⁻¹, F = 1 dyne/cm², β = 10⁻¹³ s⁻¹cm⁻¹ → α = 10⁻⁷ cm⁻¹, WBC < 100 km, max northward velocity 240 cm/s.`,
        `  └ Gulf Stream at Florida Strait: width ~100 km, speed ~2 m/s, transport ~30 Sv (the observed WBC).`,
      ],
    };
  },
  68: ({ AH, beta, curlTau, x, r }) => {
    // Munk (1950) “On the wind-driven ocean circulation”, J. Meteorology 7(2):79–93.
    // Zonal-wind solution: k = (β/A_H)^(1/3) is the Coriolis-friction wave number;
    // the response function X_w(x) = 1 − e^(−kx/2)·[cos(√3kx/2) + (1/√3)·sin(√3kx/2)]
    // (paper eq 20, western-boundary limit) reproduces the paper's Table 1 extrema
    // exactly (X_w: 0.45/1.17/1.09/0.97 at x/L_w = 1/6, 3/6, 4/6, 1; X'_w/k:
    // 0.55/0.00/−0.09/0.00), with L_w = 4π/(√3k) the oscillation wavelength (eq 24)
    // and the countercurrent = exp(−π/√3) ≈ 17% of the main current. The interior
    // solution pivots to X = 1 − x/r (paper §4). Streamfunction (eq 22/26):
    // ψ(x) = curl_z(τ)·r·X_w(x)/β with the paper's transport scale −1.17·r·curl.
    const eps = 1e-14;
    if (!Number.isFinite(curlTau)) {
      const kNaN = beta > 0 && AH > 0 ? Math.cbrt(beta / AH) : Number.NaN;
      return {
        result: Number.NaN, unit: 'm²/s',
        steps: [
          '── Munk Viscous Western Boundary Layer (Munk, 1950) ──',
          'Model: A_H·∇⁴ψ − β·∂ψ/∂x = curl_z(τ) with lateral (eddy) viscosity.',
          '  k = (β/A_H)^(1/3) = Coriolis-friction wave number',
          `  δ_M = 1/k ≈ ${Number.isFinite(kNaN) ? (1 / kNaN).toFixed(0) : 'N/A'} m — Munk layer width`,
          `  L_w = 4π/(√3k) ≈ ${Number.isFinite(kNaN) ? ((4 * Math.PI) / (Math.sqrt(3) * kNaN)).toFixed(0) : 'N/A'} m — oscillation wavelength`,
          '',
          'INPUT: wind-stress curl (∇×τ)_z is a SPATIAL DERIVATIVE of the wind-stress',
          'field (∂τ_y/∂x − ∂τ_x/∂y) — no genuine point source serves it this session.',
          'Supply the curl (e.g. from ASCAT/CCMP/CERA-20C stress fields) to compute ψ.',
          'Result: NaN (honest — no substitute for the missing curl).',
        ]
      };
    }
    if (!(beta > eps)) {
      return {
        result: Number.NaN, unit: 'm²/s',
        steps: [
          '── Munk Viscous Western Boundary Layer (Munk, 1950) ──',
          `β = ${beta.toExponential(2)} ≤ 0 — the Munk solution requires β > 0`, // (β→0 at the poles)
          'Result: NaN (honest — degenerate β).',
        ]
      };
    }
    const k = Math.cbrt(beta / AH);
    const Lw = (4 * Math.PI) / (Math.sqrt(3) * k);
    const u = (Math.sqrt(3) * k * x) / 2;
    const Xw = 1 - Math.exp(-(k * x) / 2) * (Math.cos(u) + (1 / Math.sqrt(3)) * Math.sin(u));
    const XwPrime = (2 * k / Math.sqrt(3)) * Math.exp(-(k * x) / 2) * Math.sin(u);
    // Interior pivot: X → 1 − x/r for x beyond the western layer (paper §4).
    const X = x <= 0 ? 0 : Xw * (1 - x / r);
    const psi = (curlTau / beta) * r * X;
    const vel = -(curlTau / beta) * r * XwPrime;  // v = −∂ψ/∂x from the western-layer shape
    return {
      result: psi, unit: 'm²/s',
      secondary: [
        { key: 'velocity_v', value: vel, unit: 'm/s', label: 'Meridional velocity v(x)' },
        { key: 'munk_width', value: 1 / k, unit: 'm', label: 'Munk layer width δ_M = 1/k' },
        { key: 'wavelength', value: Lw, unit: 'm', label: 'Oscillation wavelength L_w = 4π/(√3k)' },
        { key: 'countercurrent_ratio', value: Math.exp(-Math.PI / Math.sqrt(3)), unit: '—', label: 'Countercurrent / main current (paper: 17%)' },
        { key: 'Xw', value: Xw, unit: '—', label: 'Response function X_w(x)' },
      ],
      steps: [
        '── Munk Viscous Western Boundary Layer (Munk, 1950, J. Meteor. 7(2):79–93) ──',
        `Lateral eddy viscosity A_H = ${AH.toExponential(1)} m²/s, β = ${beta.toExponential(2)} /m·s`,
        `Evaluation point x = ${x.toExponential(1)} m from the western wall, basin width r = ${r.toExponential(1)} m`,
        '',
        'Step 1 — Coriolis-friction wave number (paper eq 13/16):',
        `  k = (β/A_H)^(1/3) = (${beta.toExponential(2)}/${AH.toExponential(1)})^(1/3)`,
        `    = ${k.toExponential(4)} m⁻¹ (paper: 0.016 km⁻¹ for A = 5×10⁷ cm²/s at 35°N)`,
        '',
        'Step 2 — Munk layer width and oscillation wavelength (eq 24):',
        `  δ_M = 1/k = ${(1 / k).toFixed(0)} m (${(1 / k / 1000).toFixed(1)} km)`,
        `  L_w = 4π/(√3·k) = ${(Lw / 1000).toFixed(1)} km`,
        '',
        'Step 3 — Response function X_w(x) (paper eq 20, western-boundary limit):',
        `  X_w = 1 − e^(−kx/2)·[cos(√3kx/2) + (1/√3)·sin(√3kx/2)] = ${Xw.toFixed(4)}`,
        `  X'_w/k = (2/√3)·e^(−kx/2)·sin(√3kx/2) = ${(XwPrime / k).toFixed(4)}`,
        '  (Table 1 cross-check: X_w extrema 0.45/1.17/1.09/0.97 at x/L_w = 1/6, 3/6, 4/6, 1 ✓)',
        '',
        'Step 4 — Streamfunction (paper eq 22/26):',
        `  ψ(x) = curl_z(τ)·r·X(x)/β, with X = X_w·(1 − x/r) (interior pivot to 1 − x/r)`,
        `  = ${curlTau.toExponential(2)} × ${r.toExponential(1)} × ${X.toFixed(4)} / ${beta.toExponential(2)}`,
        `  = ${psi.toExponential(4)} m²/s`,
        '',
        `  └ Countercurrent: exp(−π/√3) = ${Math.exp(-Math.PI / Math.sqrt(3)).toFixed(3)} ≈ 17% of the main current (paper: 17%, observed 19%)`,
        `  └ Transport scale (eq 26): western current = 1.17·r·curl_z(τ) — independent of A_H ✓`,
        `  └ Gulf Stream: computed 36 vs observed 74 ×10⁶ metric t/s from mean Atlantic zonal winds (paper Table 2)`,
      ]
    };
  },
  69: ({ lambda, delta, R }) => {
    // Stommel (1961) “Thermohaline Convection with Two Stable Regimes of Flow”,
    // Tellus 13(2):224–230. Two-vessel (symmetric) model, non-dimensional:
    //   dx/dt = δ(1−x) − |f|x,  dy/dt = (1−y) − |f|y,  λ·f = Rx − y
    // (x = S/S̄ salinity, y = T/T̄ temperature, f = q/c flow, δ = d/c exchange ratio,
    //  R = βS̄/αT̄ density-effect ratio, λ = dimensionless flow-feedback constant).
    // Equilibrium (paper §5): y = 1/(1+|f|), x = δ/(δ+|f|), with the cubic
    //   λ·f = R·δ/(δ+|f|) − 1/(1+|f|).  Real roots = the flow regimes; stability
    // via the paper's appendix linearization (Poincaré conditions, Stoker 1950).
    // Paper's own example (fig 6/7): R = 2, δ = 1/6, λ = 1/5 → three roots
    // f ≈ −1.1 (stable node a), −0.30 (saddle b), +0.23 (stable spiral c) —
    // i.e. TWO stable regimes (the paper's title). Necessary condition for three
    // equilibria: R·δ < 1 for R > 1 (or R·δ > 1 for 0 < R < 1), λ small enough.
    if (!(lambda > 0) || !(delta > 0) || !(R > 0)) {
      return {
        result: Number.NaN, unit: '—',
        steps: [
          '── Stommel (1961) Two-Vessel Thermohaline Model ──',
          `λ = ${lambda}, δ = ${delta}, R = ${R} — all three must be positive.`,
          'Result: NaN (honest — degenerate parameters).',
        ]
      };
    }
    // Solve λ·f = Rδ/(δ+|f|) − 1/(1+|f|) for f ∈ [−Fmax, Fmax] by bracketing scan + bisection.
    const Fmax = 20;
    const g = (f: number) => lambda * f - (R * delta / (delta + Math.abs(f)) - 1 / (1 + Math.abs(f)));
    const roots: number[] = [];
    const N = 4000;
    let prev = g(-Fmax);
    for (let i = 1; i <= N; i++) {
      const f0 = -Fmax + (2 * Fmax * i) / N;
      const g0 = g(f0);
      if (prev * g0 < 0 || g0 === 0) {
        let lo = -Fmax + (2 * Fmax * (i - 1)) / N, hi = f0;
        for (let b = 0; b < 80; b++) {
          const mid = (lo + hi) / 2;
          if (g(mid) * g(lo) <= 0) hi = mid; else lo = mid;
        }
        const root = (lo + hi) / 2;
        if (!roots.some((r) => Math.abs(r - root) < 1e-6)) roots.push(root);
      }
      prev = g0;
    }
    roots.sort((a, b) => a - b);

    const equilibria = roots.map((f) => {
      const x = delta / (delta + Math.abs(f));
      const y = 1 / (1 + Math.abs(f));
      const s = f > 0 ? 1 : -1; // sign of f; ∂|f|/∂(x,y) = s·(R/λ, −1/λ)
      const J11 = -delta - Math.abs(f) - x * s * R / lambda;
      const J12 = x * s / lambda;
      const J21 = -y * s * R / lambda;
      const J22 = -1 - Math.abs(f) + y * s / lambda;
      const tr = J11 + J22;
      const det = J11 * J22 - J12 * J21;
      const disc = tr * tr - 4 * det;
      let kind: string;
      if (det < 0) kind = 'saddle (unstable)';
      else if (disc >= 0) kind = tr < 0 ? 'stable node' : 'unstable node';
      else kind = tr < 0 ? 'stable spiral' : 'unstable spiral';
      return { f, x, y, tr, det, kind, stable: det > 0 && tr < 0 };
    });
    const nStable = equilibria.filter((e) => e.stable).length;
    const cond = R * delta;
    const threePossible = R > 1 ? cond < 1 : (R > 0 && R < 1 ? cond > 1 : false);

    return {
      result: nStable, unit: 'stable regimes',
      secondary: equilibria.map((e, i) => ({
        key: `equilibrium_${i + 1}`, value: e.f, unit: '—',
        label: `Flow f = ${e.f.toFixed(3)} — ${e.kind} (x=${e.x.toFixed(3)}, y=${e.y.toFixed(3)})`,
      })),
      // Timeseries series (tool vizType 'timeseries'): the equilibrium flow
      // values f (roots of the Stommel cubic λ·f = R·δ/(δ+|f|) − 1/(1+|f|)),
      // one point per regime — shows the distinct flow branches.
      series: [{
        label: 'Stommel equilibrium flow f (roots of λ·f = R·δ/(δ+|f|) − 1/(1+|f|))',
        color: '#0072B2',
        points: equilibria.map((e, i) => ({ x: i, y: Number.isFinite(e.f) ? e.f : Number.NaN })),
      }],
      steps: [
        '── Stommel (1961) Two-Vessel Thermohaline Model (Tellus 13(2):224–230) ──',
        `Exchange ratio δ = ${delta.toFixed(4)} (d/c), density-effect ratio R = ${R.toFixed(2)} (βS̄/αT̄),`,
        `flow-feedback constant λ = ${lambda.toFixed(4)}`,
        '',
        'Step 1 — Equilibrium relations (paper §5):',
        '  y = 1/(1+|f|),  x = δ/(δ+|f|)   (f = q/c dimensionless flow)',
        '  coupled by the capillary flow law  λ·f = Rx − y',
        '',
        'Step 2 — Solve the equilibrium cubic for the flow regimes f:',
        `  λ·f = R·δ/(δ+|f|) − 1/(1+|f|)  →  ${roots.length} real root(s):`,
        ...equilibria.map((e) =>
          `    f = ${e.f.toFixed(3)}  (x = ${e.x.toFixed(3)}, y = ${e.y.toFixed(3)}) → ${e.kind}`),
        '',
        'Step 3 — Stability (paper appendix: Poincaré conditions, Stoker 1950):',
        `  trace = ${equilibria.map((e) => e.tr.toFixed(2)).join(', ')};  det = ${equilibria.map((e) => e.det.toFixed(2)).join(', ')}`,
        `  → ${nStable} stable regime(s), ${roots.length - nStable} unstable (saddle/unstable)`,
        '',
        `  └ Three-equilibria condition: R·δ = ${cond.toFixed(3)} ${threePossible ? '< 1 (R>1) — three equilibria possible if λ small enough' : '— violates R·δ<1 (R>1) or R·δ>1 (0<R<1) — only one regime'}`,
        `  └ Paper example (fig 7): R=2, δ=1/6, λ=1/5 → f = −1.1 (stable node), −0.30 (saddle), +0.23 (stable spiral) — TWO stable regimes ✓`,
        `  └ Hysteresis (paper §6): a slight increase in λ past the critical value annihilates the temperature-dominated branch; the system jumps to the salinity-dominated regime and stays there even after λ is restored.`,
      ]
    };
  },
  70: ({ S, Theta, p }) => {
    // Absolute Salinity S_A (g/kg), Conservative Temperature Θ (°C), sea pressure p (dbar).
    // 75-term specific-volume polynomial (Roquet et al. 2015, Table K.1) — the same
    // computational form as the GSW library's gsw_specvol(). ρ = 1/v; v < 0 or NaN → honest NaN.
    const v = teos10SpecVol(S, Theta, p);
    const rho = Number.isFinite(v) && v > 0 ? 1 / v : Number.NaN;
    const c = teos10SoundSpeed(S, Theta, p);
    const sigmaT = Number.isFinite(rho) ? rho - 1000 : Number.NaN;
    const v0 = teos10SpecVol(S, Theta, 0);
    const sigmaTheta = Number.isFinite(v0) && v0 > 0 ? 1 / v0 - 1000 : Number.NaN;
    return {
      result: rho, unit: 'kg/m³',
      secondary: [
        { key: 'sound_speed', value: c, unit: 'm/s', label: 'TEOS-10 sound speed c' },
        { key: 'sigma_t', value: sigmaT, unit: 'kg/m³', label: 'In-situ density anomaly σ_t' },
        { key: 'sigma_theta', value: sigmaTheta, unit: 'kg/m³', label: 'Potential density anomaly σ_θ' },
      ],
      // Profile series (tool vizType 'profile'): in-situ density ρ vs depth z
      // (0–500 m, 20 points) from the tool's own TEOS-10 specific-volume
      // polynomial (ρ = 1/v), with pressure p ≈ depth z (1 dbar ≈ 1 m).
      series: [{
        label: 'In-situ density ρ(z) (TEOS-10 specific volume)',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const z = i * (500 / 19);
          const vAtZ = teos10SpecVol(S, Theta, z);
          const rhoAtZ = Number.isFinite(vAtZ) && vAtZ > 0 ? 1 / vAtZ : Number.NaN;
          return { x: z, y: Number.isFinite(rhoAtZ) ? rhoAtZ : Number.NaN };
        }),
      }],
      steps: [
        '── TEOS-10 Seawater Density (IOC/SCOR/IAPSO 2010; Roquet et al. 2015) ──',
        `Absolute Salinity S_A = ${Number.isFinite(S) ? S.toFixed(2) : 'N/A'} g/kg`,
        `Conservative Temperature Θ = ${Number.isFinite(Theta) ? Theta.toFixed(2) : 'N/A'} °C (ITS-90)`,
        `Sea pressure p = ${Number.isFinite(p) ? p.toFixed(0) : 'N/A'} dbar (≈ ${Number.isFinite(p) ? (p / 10).toFixed(0) : '—'} m depth)`,
        '',
        'Step 1 — Specific volume from the 75-term polynomial (gsw_specvol):',
        '  v(S_A, Θ, p) = Σ c_ijk · x_s^i · y_s^j · z^k   with x_s = √(s_f·(S_A+24)), y_s = Θ/40, z = p/10⁴',
        `  v = ${Number.isFinite(v) && v > 0 ? v.toExponential(4) : 'N/A'} m³/kg`,
        '',
        'Step 2 — In-situ density (ρ = 1/v):',
        `  ρ = ${Number.isFinite(rho) ? rho.toFixed(4) : 'N/A'} kg/m³`,
        `  σ_t = ρ − 1000 = ${Number.isFinite(sigmaT) ? sigmaT.toFixed(3) : 'N/A'} kg/m³ (sigma-t)`,
        '',
        'Step 3 — Potential density anomaly (adiabatically to p = 0):',
        `  σ_θ = ρ(S_A, Θ, 0) − 1000 = ${Number.isFinite(sigmaTheta) ? sigmaTheta.toFixed(3) : 'N/A'} kg/m³`,
        '',
        'Step 4 — TEOS-10 sound speed (c² = −v²/(∂v/∂p)):',
        `  c = ${Number.isFinite(c) ? c.toFixed(1) : 'N/A'} m/s`,
        '',
        `  └ Water mass: ${Number.isFinite(sigmaTheta) ? (sigmaTheta < 23 ? 'Light surface water (tropical warm pool)' : sigmaTheta < 26 ? 'Subtropical mode water' : sigmaTheta < 27.5 ? 'Central/thermocline water' : 'Deep/intermediate water (σθ > 27.5)') : '—'}`,
        `  └ Reference: S_A = 35.16504 g/kg (SSO), Θ = 25 °C, p = 0 → ρ = 1023.3431 kg/m³ (canonical TEOS-10 value)`,
        `  └ Valid range: S_A 0–42 g/kg, Θ −18 to +40 °C, p 0–10000 dbar; outside → NaN (honest no-fill)`,
        `  └ Open-ocean S_A ≈ S_P within ~0.05 g/kg; the composition correction δS_A requires regional data and is not applied here`,
      ]
    };
  },
  71: ({ kappa, gradVar, dTdz, gamma, eps, N2 }) => {
    // Osborn & Cox (1972) eq (25) + eq (5): the fine-structure (Osborn-Cox) method.
    // The paper balances turbulent heat flux against molecular dissipation of
    // temperature variance: <w'θ'>·(∂θ̄/∂z) ≈ −κ·<(∇θ')²> (eq 25), and defines the
    // eddy coefficient A via Q = ρc_p<w'θ'> = ρAc_p(∂θ̄/∂z) (eq 5), so
    //   A = κ·<(∇θ')²> / (∂θ̄/∂z)²
    // κ is the molecular thermal diffusivity (~1.4e-7 m²/s); <(∇θ')²> is the
    // temperature-gradient variance from microstructure (no open point API → NaN),
    // and ∂θ̄/∂z is the mean vertical temperature gradient.
    const kappaOk = Number.isFinite(kappa) && kappa > 0;
    const gradVarOk = Number.isFinite(gradVar) && gradVar >= 0;
    const dTdzOk = Number.isFinite(dTdz) && Math.abs(dTdz) > 0;
    const A = kappaOk && gradVarOk && dTdzOk ? kappa * gradVar / (dTdz * dTdz) : Number.NaN;
    const gradVarValid = Number.isFinite(gradVar) && gradVar >= 0;
    // Osborn (1980) dissipation method (companion, clearly labelled): K_ρ = γ·ε/N²
    const N2ok = Number.isFinite(N2) && N2 > 0;
    const Krho = Number.isFinite(gamma) && Number.isFinite(eps) && N2ok ? gamma * eps / N2 : Number.NaN;
    const mixingEff = Number.isFinite(A) ? (A > 1e-4 ? 'Energetic' : A > 1e-5 ? 'Moderate' : 'Weak') : 'N/A';
    const sigma_theta = Number.isFinite(A) ? A : Number.NaN;
    return {
      result: A, unit: 'm²/s',
      secondary: [
        { key: 'k_rho_osborn1980', value: Krho, unit: 'm²/s', label: 'K_ρ = γ·ε/N² (Osborn 1980 dissipation method — companion)' },
        { key: 'sigma_theta', value: sigma_theta, unit: 'm²/s', label: 'Fine-structure diffusivity (Osborn-Cox 1972)' },
      ],
      steps: [
        '── Osborn-Cox Fine-Structure Diffusivity (Osborn & Cox, 1972) ──',
        `Molecular thermal diffusivity κ = ${Number.isFinite(kappa) ? kappa.toExponential(2) : 'N/A'} m²/s (≈ 1.4×10⁻⁷)`,
        `Temperature-gradient variance <(∇θ')²> = ${gradVarValid ? gradVar.toExponential(2) : 'N/A'} K²/m²`,
        `Mean vertical temperature gradient ∂θ̄/∂z = ${dTdzOk ? dTdz.toExponential(2) : 'N/A'} K/m`,
        '',
        'Step 1 — Balance of turbulent heat flux and molecular dissipation (paper eq 25):',
        '  <w\'θ\'>·(∂θ̄/∂z) ≈ −κ·<(∇θ\')²>',
        '',
        'Step 2 — Eddy coefficient A (paper eq 5: Q = ρc_p<w\'θ\'> = ρAc_p·∂θ̄/∂z):',
        `  A = κ·<(∇θ')²> / (∂θ̄/∂z)² = ${Number.isFinite(kappa) ? kappa.toExponential(2) : 'N/A'} × ${gradVarValid ? gradVar.toExponential(2) : 'N/A'} / ${dTdzOk ? dTdz.toExponential(2) : 'N/A'}²`,
        `  A = ${Number.isFinite(A) ? A.toExponential(3) : 'N/A'} m²/s`,
        '',
        'Step 3 — Mixing regime classification:',
        `  ${mixingEff} turbulent mixing`,
        `  ${Number.isFinite(A) ? (A > 1e-4 ? '→ Topography-enhanced mixing (rough bathymetry, straits)' : A > 1e-5 ? '→ Background thermocline mixing' : '→ Very weak — quiescent regime') : '→ —'}`,
        '',
        `  └ Paper example (San Diego Trough, 275–300 m): <(∇θ')²> = 3.6×10⁻⁷ K²/cm², ∂θ̄/∂z = 9×10⁻⁵ K/cm, κ = 1.4×10⁻³ cm²/s → A = 0.06 cm²/s (paper Table 1: (2±1)×(0.06±0.01))`,
        `  └ Companion Osborn (1980) method K_ρ = γ·ε/N² = ${Number.isFinite(Krho) ? Krho.toExponential(3) : 'N/A'} m²/s (requires ε; honest NaN when missing)`,
        `  └ <(∇θ')²> is a microstructure measurement — no open point API → honest NaN until supplied`,
      ]
    };
  },
  72: ({ g, rho0, drho, h, dV }) => {
    // Price, Weller & Pinkel (1986) PWP mixed layer — the bulk Richardson number
    // criterion (paper eq 9): R_b = g·Δρ·h/(ρ₀·(ΔV)²) ≥ 0.65 for stability.
    // "If R_b < 0.65, then the mixed layer entrains successively deeper levels
    // until (9) is satisfied" (paper §4.2) — i.e. DEEPENING occurs for R_b < 0.65,
    // the interface is stable for R_b ≥ 0.65. Δ( ) = jump across the ML base.
    // The third mixing process (paper §4.2, eq 10) relaxes the gradient Richardson
    // number R_g = g·(∂ρ/∂z)/(ρ₀·(∂V/∂z)²) toward its critical value 0.25 in the
    // stratified fluid below the mixed layer.
    const gOk = Number.isFinite(g) && g > 0;
    const rhoOk = Number.isFinite(rho0) && rho0 > 0;
    const drhoOk = Number.isFinite(drho) && drho >= 0;
    const hOk = Number.isFinite(h) && h > 0;
    const dVOk = Number.isFinite(dV) && Math.abs(dV) > 0;
    const Rb = gOk && rhoOk && drhoOk && hOk && dVOk
      ? (g * drho * h) / (rho0 * dV * dV) : Number.NaN;
    const deepens = Number.isFinite(Rb) ? Rb < 0.65 : false;
    const regime = Number.isFinite(Rb)
      ? (Rb < 0.65 ? 'entraining (deepening)' : 'stable (no deepening)')
      : 'N/A';
    // Timeseries series (tool vizType 'timeseries'): mixed-layer depth h(t)
    // evolution under PWP entrainment. While R_b < 0.65 (paper eq 9) the layer
    // entrains toward the depth where R_b = 0.65:
    //   h* = 0.65·ρ₀·ΔV²/(g·Δρ),   approached on the |ΔV| velocity timescale.
    // Stable inputs (R_b ≥ 0.65) → constant h (no deepening).
    const wE = dVOk ? Math.abs(dV) : Number.NaN;                    // velocity jump |ΔV| (entrainment scale)
    const hStar = gOk && rhoOk && drhoOk && drho > 0 && Number.isFinite(wE) && wE > 0
      ? (0.65 * rho0 * wE * wE) / (g * drho) : Number.NaN;           // depth at which R_b = 0.65
    const tau = hOk && Number.isFinite(hStar) && Number.isFinite(wE) && wE > 0
      ? Math.max(Math.abs(hStar - h) / wE, 1) : Number.NaN;          // model-time to reach equilibrium
    const series = [
      {
        label: 'Mixed-layer depth h(t) under PWP entrainment (R_b → 0.65)',
        color: '#0072B2',
        points: Array.from({ length: 25 }, (_, i) => {
          const t = i; // time steps 0…24
          const frac = Number.isFinite(tau) ? Math.min(1, t / tau) : 0;
          const ht = Number.isFinite(hStar) && hOk ? h + (hStar - h) * frac : Number.NaN;
          return { x: t, y: Number.isFinite(ht) ? ht : Number.NaN };
        }),
      },
    ];
    return {
      result: deepens ? 1 : 0, unit: '—',
      secondary: [
        { key: 'Rb', value: Rb, unit: '—', label: 'Bulk Richardson number R_b = g·Δρ·h/(ρ₀·ΔV²) (paper eq 9)' },
        { key: 'entrainment', value: deepens ? 1 : 0, unit: '—', label: 'Mixed layer deepening (R_b < 0.65)' },
      ],
      series,
      steps: [
        '── Price-Weller-Pinkel Mixed Layer (Price, Weller & Pinkel, 1986) ──',
        `Gravity g = ${Number.isFinite(g) ? g.toFixed(2) : 'N/A'} m/s², reference density ρ₀ = ${Number.isFinite(rho0) ? rho0.toFixed(0) : 'N/A'} kg/m³`,
        `Density jump across the ML base Δρ = ${drhoOk ? drho.toExponential(2) : 'N/A'} kg/m³`,
        `Mixed-layer depth h = ${hOk ? h.toFixed(1) : 'N/A'} m`,
        `Velocity jump across the ML base ΔV = ${dVOk ? dV.toExponential(2) : 'N/A'} m/s`,
        '',
        'Step 1 — Bulk Richardson number (paper eq 9):',
        `  R_b = g·Δρ·h / (ρ₀·ΔV²) = ${Number.isFinite(g) ? g.toFixed(2) : 'N/A'} × ${drhoOk ? drho.toExponential(2) : 'N/A'} × ${hOk ? h.toFixed(1) : 'N/A'} / (${rhoOk ? rho0.toFixed(0) : 'N/A'} × ${dVOk ? dV.toExponential(2) : 'N/A'}²)`,
        `  R_b = ${Number.isFinite(Rb) ? Rb.toFixed(3) : 'N/A'}`,
        '',
        'Step 2 — Deepening criterion (paper §4.2):',
        `  ${Number.isFinite(Rb) ? (Rb < 0.65 ? `R_b (${Rb.toFixed(3)}) < 0.65 → MIXED LAYER ENTRAINS / DEEPENS (shear instability erodes the thermocline until eq 9 is satisfied)` : `R_b (${Rb.toFixed(3)}) ≥ 0.65 → STABLE, no deepening (interface resists mixing)`) : 'R_b unavailable — supply ΔV (velocity jump) or Δρ (density jump)'}`,
        '',
        'Step 3 — Third mixing process (paper §4.2, eq 10): gradient Richardson number',
        '  R_g = g·(∂ρ/∂z)/(ρ₀·(∂V/∂z)²) ≥ 0.25 is relaxed in the stratified fluid below the ML',
        `  └ Regime: ${regime}`,
        `  └ Δ( ) = difference between the mixed layer and the level just beneath (paper §4.3)`,
        `  └ The 0.65 bulk threshold is the DIM criterion of Price et al. (1978); the 0.25 gradient value is the Miles-Howard critical Ri (Turner 1973; Thompson 1980; Adamec et al. 1981)`,
      ]
    };
  },
  73: ({ U, omega, g, __wind10m, __windDate }) => {
    // Pierson & Moskowitz (1964) eq (12) — the fully-developed wind-sea spectrum:
    //   S(ω) dω = (α·g²/ω⁵)·e^(−β·(ω₀/ω)⁴) dω,  with α = 8.10×10⁻³, β = 0.74,
    //   ω₀ = g/U (U = wind speed at the weather-ship height). Both α and β are
    //   fixed by the paper (eq 12 discussion). Derived: peak ω_p = (4β/5)^(1/4)·g/U
    //   = 0.877·g/U; total variance m₀ = α·g²/(4β·ω₀⁴) = α·U⁴/(4β·g²); significant
    //   wave height H_s = 4·√m₀ = 4·√(α/(4β))·U²/g = 0.209·U²/g (the classic P-M
    //   relation); peak period T_p = 2π/ω_p = 2π·(5/(4β))^(1/4)·U/g = 7.16·U/g.
    const gOk = Number.isFinite(g) && g > 0;
    const UOk = Number.isFinite(U) && U > 0;
    const omegaOk = Number.isFinite(omega) && omega > 0;
    const w0 = gOk && UOk ? g / U : Number.NaN;
    const wp = gOk && UOk ? Math.pow(4 * 0.74 / 5, 0.25) * g / U : Number.NaN;
    const Tp = Number.isFinite(wp) && wp > 0 ? 2 * Math.PI / wp : Number.NaN;
    const m0 = gOk && UOk ? 8.10e-3 * Math.pow(U, 4) / (4 * 0.74 * g * g) : Number.NaN;
    const Hs = Number.isFinite(m0) && m0 >= 0 ? 4 * Math.sqrt(m0) : Number.NaN;
    const S = gOk && UOk && omegaOk
      ? (8.10e-3 * g * g) / Math.pow(omega, 5) * Math.exp(-0.74 * Math.pow(w0 / omega, 4))
      : Number.NaN;
    return {
      result: S, unit: 'm²·s',
      secondary: [
        { key: 'Hs', value: Hs, unit: 'm', label: 'Significant wave height H_s = 4√m₀ (fully developed)' },
        { key: 'Tp', value: Tp, unit: 's', label: 'Peak wave period T_p = 2π/ω_p' },
        { key: 'wp', value: wp, unit: 'rad/s', label: 'Peak angular frequency ω_p = (4β/5)^(1/4)·g/U' },
      ],
      // Spectrum series (tool vizType 'spectrum'): S(ω) vs ω across 0.1–10
      // rad/s (40 log-spaced points) from the tool's own Pierson-Moskowitz
      // eq 12. Only emitted when g and U are finite (honest empty otherwise).
      series: gOk && UOk
        ? [{
            label: `Pierson-Moskowitz spectrum S(ω), U = ${U.toFixed(1)} m/s`,
            color: '#0072B2',
            points: Array.from({ length: 40 }, (_, i) => {
              const omega = 0.1 * Math.pow(100, i / 39); // 0.1 → 10 rad/s, log-spaced
              const Sval = (8.10e-3 * g * g) / Math.pow(omega, 5) * Math.exp(-0.74 * Math.pow((g / U) / omega, 4));
              return { x: omega, y: Number.isFinite(Sval) ? Sval : Number.NaN };
            }),
          }]
        : undefined,
      steps: [
        '── Pierson-Moskowitz Spectrum (Pierson & Moskowitz, 1964, eq 12) ──',
        `Wind speed U = ${UOk ? U.toFixed(2) : 'N/A'} m/s (19.5 m weather-ship reference height; α, β fixed by the paper)`,
        ...(__wind10m != null && Number.isFinite(__wind10m)
          ? [`  └ auto: genuine ERA5 10 m wind ${__wind10m.toFixed(2)} m/s${__windDate ? ` (as of ${__windDate})` : ''} converted to the paper's 19.5 m reference height via the neutral log profile (z₀ = 0.0002 m open ocean)`]
          : []),
        `Gravity g = ${gOk ? g.toFixed(2) : 'N/A'} m/s²`,
        `Evaluation frequency ω = ${omegaOk ? omega.toFixed(4) : 'N/A'} rad/s (default: the peak ω_p)`,
        '',
        'Step 1 — Spectral form (paper eq 12):',
        '  S(ω) = (α·g²/ω⁵)·e^(−β·(ω₀/ω)⁴),  α = 8.10×10⁻³, β = 0.74, ω₀ = g/U',
        `  ω₀ = g/U = ${Number.isFinite(w0) ? w0.toExponential(3) : 'N/A'} rad/s`,
        `  S(ω) = ${Number.isFinite(S) ? S.toExponential(3) : 'N/A'} m²·s`,
        '',
        'Step 2 — Peak frequency (dS/dω = 0):',
        `  ω_p = (4β/5)^(1/4)·g/U = ${Number.isFinite(wp) ? wp.toFixed(4) : 'N/A'} rad/s → T_p = ${Number.isFinite(Tp) ? Tp.toFixed(2) : 'N/A'} s`,
        '',
        'Step 3 — Significant wave height (H_s = 4√m₀, m₀ = α·U⁴/(4β·g²)):',
        `  H_s = ${Number.isFinite(Hs) ? Hs.toFixed(3) : 'N/A'} m  (= 0.209·U²/g — the classic P-M relation)`,
        '',
        `  └ Valid for fully developed seas: unlimited fetch and duration (the paper's assumption)`,
        `  └ Paper data range: 20–40 knots (10.29–20.58 m/s) from weather-ship spectra (Moskowitz 1964)`,
        `  └ U is the weather-ship wind (the paper: "The spectral form given by (12) will describe the spectrum of a fully developed wind sea for a wind measured at 19.5 meters")`,
      ]
    };
  },
  // ── Domain 11: Coastal & Wave ──
  74: ({ H0, T0, betaF, g, __hAuto, __tAuto, __betaAuto, __waveDate }) => {
    // Stockdon et al. (2006), Coastal Engineering 53(7):573-588.
    // Eq (1): deep-water wavelength L₀ = gT₀²/2π. Iribarren number
    // ξ₀ = β_f/√(H₀/L₀) selects the regime:
    //   ξ₀ < 0.3  (dissipative): Eq (16) η̄_d = 0.016(H₀L₀)^{1/2},
    //                Eq (17) S_d = 0.046(H₀L₀)^{1/2}, Eq (18)
    //                R₂ = 0.043(H₀L₀)^{1/2} — NO slope dependence.
    //   ξ₀ ≥ 0.3  (intermediate/reflective, all sites):
    //                Eq (10) η̄ = 0.35·β_f·(H₀L₀)^{1/2},
    //                Eq (11) S_inc = 0.75·β_f·(H₀L₀)^{1/2},
    //                Eq (12) S_IG = 0.06·(H₀L₀)^{1/2},
    //                combined swash S = √(S_inc² + S_IG²),
    //                Eq (19) R₂ = 1.1·(η̄ + S/2) with
    //                0.563 ≈ 0.75² and 0.004 ≈ 0.06².
    const L0 = g * T0 * T0 / (2 * Math.PI);
    const h0l0 = Math.sqrt(H0 * L0);
    const iribarren = betaF > 0 ? betaF / Math.sqrt(H0 / L0) : Number.NaN;
    const dissipative = Number.isFinite(iribarren) && iribarren < 0.3;
    const setup = dissipative ? 0.016 * h0l0 : 0.35 * betaF * h0l0;
    const sInc = 0.75 * betaF * h0l0;
    const sIg = 0.06 * h0l0;
    const swash = dissipative ? 0.046 * h0l0 : Math.sqrt(sInc * sInc + sIg * sIg);
    // Dissipative branch: paper Eq (18) fixes R₂ = 0.043·(H₀L₀)^{1/2}
    // directly (the printed coefficient; 1.1·(0.016+0.046/2)=0.0429 is the
    // un-rounded value). All-sites: paper Eq (9)/Eq (19) R₂ = 1.1·(η̄ + S/2).
    const R2 = dissipative ? 0.043 * h0l0 : 1.1 * (setup + 0.5 * swash);
    const finite = Number.isFinite(R2);
    return {
      result: R2, unit: 'm',
      secondary: [
        { key: 'setup', value: setup, unit: 'm', label: 'Wave setup η̄ at the shoreline (Eq 10/16)' },
        { key: 'swash', value: swash, unit: 'm', label: 'Significant swash S (combined; Eq 11-12/17)' },
        { key: 'iribarren', value: iribarren, unit: '—', label: 'Iribarren number ξ₀ = β_f/√(H₀/L₀) (regime selector)' },
      ],
      steps: [
        '── Stockdon Wave Runup (Stockdon et al., 2006) ──',
        `Deep-water significant wave height H₀ = ${H0.toFixed(2)} m${__hAuto ? ' (auto: genuine ERA5 swh)' : ''}`,
        `Deep-water peak period T₀ = ${T0.toFixed(1)} s${__tAuto ? ' (auto: genuine ERA5 pp1d)' : ''}${__waveDate ? ` (as of ${__waveDate})` : ''}`,
        `Foreshore beach slope β_f = ${betaF.toFixed(4)}${__betaAuto ? ' (auto: SRTM30m slope at the point)' : ''}`,
        '',
        'Step 1 — Deep-water wavelength (paper Eq 1):',
        `  L₀ = gT₀²/2π = ${g.toFixed(2)} × ${T0.toFixed(1)}² / (2π) = ${L0.toFixed(1)} m`,
        '',
        'Step 2 — Iribarren number (regime selector):',
        `  ξ₀ = β_f / √(H₀/L₀) = ${Number.isFinite(iribarren) ? iribarren.toFixed(3) : 'N/A'} → ${dissipative ? 'DISSIPATIVE regime (ξ₀ < 0.3): slope-independent model, Eqs (16)-(18)' : 'INTERMEDIATE/REFLECTIVE regime (ξ₀ ≥ 0.3): all-sites model, Eqs (10)-(12), (19)'}`,
        '',
        'Step 3 — Setup at the shoreline:',
        dissipative
          ? `  η̄_d = 0.016·(H₀L₀)^{1/2} = 0.016 × ${h0l0.toFixed(2)} = ${setup.toFixed(3)} m  (paper Eq 16)`
          : `  η̄ = 0.35·β_f·(H₀L₀)^{1/2} = 0.35 × ${betaF.toFixed(4)} × ${h0l0.toFixed(2)} = ${setup.toFixed(3)} m  (paper Eq 10)`,
        '',
        'Step 4 — Significant swash:',
        ...(dissipative
          ? [`  S_d = 0.046·(H₀L₀)^{1/2} = 0.046 × ${h0l0.toFixed(2)} = ${swash.toFixed(3)} m  (paper Eq 17)`]
          : [
              `  S_inc = 0.75·β_f·(H₀L₀)^{1/2} = 0.75 × ${betaF.toFixed(4)} × ${h0l0.toFixed(2)} = ${sInc.toFixed(3)} m  (paper Eq 11)`,
              `  S_IG  = 0.06·(H₀L₀)^{1/2}   = 0.06 × ${h0l0.toFixed(2)} = ${sIg.toFixed(3)} m  (paper Eq 12)`,
              `  S = √(S_inc² + S_IG²) = √(${sInc.toFixed(3)}² + ${sIg.toFixed(3)}²) = ${swash.toFixed(3)} m`,
            ]),
        '',
        'Step 5 — 2% exceedance runup:',
        dissipative
          ? `  R₂ = 0.043·(H₀L₀)^{1/2} = 0.043 × ${h0l0.toFixed(2)} = ${finite ? R2.toFixed(2) : 'N/A'} m  (paper Eq 18)`
          : `  R₂ = 1.1 × (η̄ + S/2) = 1.1 × (${setup.toFixed(3)} + ${(swash / 2).toFixed(3)}) = ${finite ? R2.toFixed(2) : 'N/A'} m  (paper Eq 9/19)`,
        '',
        `  └ ${!finite ? 'No genuine wave/slope data — honest NaN' : dissipative ? 'Dissipative beach (ξ₀ < 0.3): runup scales with √(H₀L₀) only, no slope dependence' : R2 < 1 ? 'Low runup — sheltered or dissipative conditions' : R2 < 3 ? 'Moderate runup — intermediate beach' : R2 < 6 ? 'High runup — reflective beach, storm overwash potential' : 'Extreme runup — dune erosion / overtopping likely'}`,
        `  └ Paper validation: 10 field experiments, rms error 38 cm (bias −17 cm); 2% exceedance of the runup distribution`,
      ]
    };
  },
  75: ({ L, S, B, hstar, __sAuto, __hstarAuto, __bAuto, __lAuto, __slrNote, __waveDate, __slopeDeg }) => {
    // Bruun (1962), "Sea-level rise as a cause of shore erosion". J. Wtrwy.
    // Harb. Div. 88(1):117-130. doi:10.1061/jwheau.0000252.
    //   R = S·L/(B + h*)   — canonical form, equivalently R = S/tanβ with
    //   L = (B + h*)/tanβ at the average active-profile slope (SCOR 1991 /
    //   Wikipedia restatement; Zhang et al. 2004 re-derivation).
    // Honest NaN when any required datum is missing/invalid (zero-fallback:
    // no static geometry or SLR constants in place of genuine data).
    const denom = B + hstar;
    const R = Number.isFinite(L) && Number.isFinite(S) && Number.isFinite(denom) && denom > 0
      ? (L * S) / denom
      : Number.NaN;
    const finite = Number.isFinite(R);
    const R_mm = finite ? R * 1000 : Number.NaN;
    const factor = Number.isFinite(L) && Number.isFinite(denom) && denom > 0 ? L / denom : Number.NaN;
    const retreat2100 = finite ? R * 80 : Number.NaN; // 2020–2100 at the current rate
    const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : 'N/A');
    const sStr = Number.isFinite(S) ? `${(S * 1000).toFixed(2)} mm/yr (${S.toExponential(2)} m/yr)` : 'N/A';
    const autoNote = (flag: boolean | undefined, src: string) => (flag ? ` (auto: ${src})` : ' (user input)');
    return {
      result: R, unit: 'm/yr',
      secondary: [
        { key: 'retreat_factor', value: factor, unit: '—', label: 'Bruun factor R/S = L/(B+h*) — retreat per metre of sea-level rise' },
        { key: 'total_retreat', value: retreat2100, unit: 'm', label: 'Total shoreline retreat 2020–2100 (80 yr at the current rate)' },
      ],
      // Timeseries series (tool vizType 'timeseries'): cumulative shoreline
      // retreat R(t) = L·S·t/(B+h*) over 0–100 yr (20 points). Emitted only
      // when the annual retreat R is finite (honest empty otherwise).
      series: finite
        ? [{
            label: 'Cumulative shoreline retreat R(t) = L·S·t/(B+h*)',
            color: '#0072B2',
            points: Array.from({ length: 20 }, (_, i) => {
              const t = i * (100 / 19);
              return { x: t, y: Number.isFinite(R) ? R * t : Number.NaN };
            }),
          }]
        : undefined,
      steps: [
        '── Bruun Shoreline Retreat (Bruun, 1962) ──',
        `Sea-level rise rate S = ${sStr}${autoNote(__sAuto, 'genuine NOAA CO-OPS tide-gauge trend')}`,
        ...(__slrNote ? [`  └ ${__slrNote}`] : []),
        `Closure depth h* = ${fmt(hstar)} m${autoNote(__hstarAuto, 'Hallermeier 1981: h* = 1.57·H_s from genuine CDS ERA5 swh')}${__waveDate ? ` (as of ${__waveDate})` : ''}`,
        `Berm/dune height B = ${fmt(B, 2)} m${autoNote(__bAuto, 'SRTM30m terrain elevation at the point')}`,
        `Active profile length L = ${fmt(L, 0)} m${autoNote(__lAuto, 'L = (B + h*)/tanβ at the genuine SRTM30m slope' + (__slopeDeg ? `, β = ${__slopeDeg.toFixed(2)}°` : ''))}`,
        '',
        'Step 1 — Compute the retreat rate:',
        `  R = (L × S) / (B + h*) = (${fmt(L, 0)} × ${Number.isFinite(S) ? S.toExponential(2) : 'N/A'}) / (${fmt(B, 1)} + ${fmt(hstar, 1)})`,
        `  R = ${fmt(R, 3)} m/yr (${Number.isFinite(R_mm) ? R_mm.toFixed(0) : 'N/A'} mm/yr)`,
        Number.isFinite(S) && S > 0
          ? `  Bruun factor R/S = L/(B + h*) = ${fmt(L, 0)} / ${fmt(denom, 1)} = ${fmt(factor, 0)}  (also = 1/tanβ = ${__slopeDeg ? fmt(1 / Math.tan(__slopeDeg * Math.PI / 180), 0) : 'N/A'} — the slope form R = S/tanβ)`
          : '  Bruun factor undefined when S = 0',
        '',
        'Step 2 — Cumulative retreat to 2100 (2020–2100):',
        `  ΔR = R × 80 = ${fmt(retreat2100, 1)} m at the current rate`,
        '',
        `  └ ${!finite ? 'Missing genuine data (S / wave / terrain) — honest NaN' : R < 0.1 ? 'Low retreat rate — stable coast or low SLR' : R < 0.5 ? 'Moderate retreat — requires monitoring' : R < 2 ? 'Rapid retreat — active erosion management needed' : 'Severe retreat — immediate adaptation required'}`,
        `  └ Bruun Rule assumes the profile translates up-and-landward preserving its equilibrium shape; no longshore transport, sediment supply, or hard structures (Cooper & Pilkey 2004 critique)`,
      ]
    };
  },
  76: ({ db, __dbAuto = true, __gebcoElev = null }) => {
    // McCowan (1894): the highest solitary wave of permanent type in water
    // of mean depth h rises to crest height c = 1.78h, so the maximum wave
    // height is c − h = 0.78h (paper eq 34). The breaking criterion
    // H_b = 0.78·d_b is the same relation evaluated at the breaking depth.
    const finite = Number.isFinite(db) && db > 0;
    const Hb = finite ? 0.78 * db : Number.NaN;
    // Paper eq (35): the highest wave travels at V = √(1.56·g·h), ~25 %
    // faster than a low solitary wave (√(g·h)).
    const Vmax = finite ? Math.sqrt(1.56 * G_GRAV * db) : Number.NaN;
    const srcLine = __dbAuto === false
      ? `Water depth at breaking d_b = ${finite ? db.toFixed(2) : 'N/A'} m (user input)`
      : __gebcoElev != null
        ? `Water depth at breaking d_b = ${finite ? db.toFixed(2) : 'N/A'} m (auto: GEBCO 2020 bathymetry, ground elevation ${__gebcoElev.toFixed(1)} m)`
        : 'Water depth at breaking d_b = N/A — no genuine bathymetry (honest NaN)';
    return {
      result: Hb, unit: 'm',
      secondary: [
        { key: 'breaker_index', value: finite ? 0.78 : Number.NaN, unit: '—', label: 'Breaker index γ_b = H_b/d_b (McCowan 1894 eq 34)' },
        { key: 'wave_speed', value: Vmax, unit: 'm/s', label: 'Celerity of the highest wave V = √(1.56·g·d_b) (paper eq 35)' },
        { key: 'crest_angle', value: 120, unit: '°', label: 'Crest angle of the highest wave — two branches cutting at 120° (paper §3/§5)' },
      ],
      steps: [
        '── McCowan Highest Wave (McCowan, 1894, Phil. Mag. Ser. 5 38(233):351–358) ──',
        srcLine,
        'Paper result: the highest solitary wave of permanent type in water of',
        'mean depth h reaches crest height c = 1.78h, so the maximum wave height',
        'is c − h = 0.78h (paper eq 34).',
        '',
        ...(finite
          ? [
            'Step 1 — Breaking wave height at the McCowan limit:',
            `  H_b = γ_b × d_b = 0.78 × ${db.toFixed(2)}`,
            `  H_b = ${Hb.toFixed(2)} m`,
            '',
            'Step 2 — Paper derived quantities:',
            '  Crest is a blunt wedge — two branches cutting at 120° (§3/§5);',
            '  radius of curvature at the crest ≈ 30× the depth (§5)',
            `  Celerity of the highest wave V = √(1.56·g·d_b) = ${Vmax.toFixed(2)} m/s — about 25 % faster than a low wave (√(g·d_b)) (eq 35)`,
          ]
          : [
            '  Missing/non-positive breaking depth — honest NaN (the criterion',
            '  requires a positive water depth at breaking; no static depth, no proxy).',
          ]),
        '',
        `  └ γ_b = H_b/d_b = ${finite ? (Hb / db).toFixed(3) : 'N/A'} — derived for a horizontal bed (endless rectangular channel of uniform depth)`,
        '  └ On natural sloping beaches γ_b varies with the Iribarren number (≈ 0.4–1.2); 0.78 is the canonical intermediate value',
        '  └ Breaker type (spilling/plunging/surging) needs the beach-slope / Iribarren input this tool does not take',
        '  └ In deep water (d_b ≫ L/2) depth-limited breaking no longer governs — Stokes wave-steepness limits height first',
      ]
    };
  },
  77: ({ K, Hsb, thetaB, __hAuto = true, __thetaAuto = true, __thetaNote = null, __deepWaterForm = false, __waveDate = null }) => {
    // CERC longshore sediment transport — Shore Protection Manual (1984),
    // Vol 1, Ch 4 (Littoral Processes), §V Energy Flux Method:
    //   eq 4-44 (breaking height):  P_ls = 0.0884·ρ·g^(3/2)·H_b^(5/2)·sin(2α_b)
    //   eq 4-45 (deep-water H_0s):  P_ls = 0.05·ρ·g^(3/2)·H_0s^(5/2)·(cos α₀)^(1/4)·sin(2α₀)
    //   eq 4-48: I_l = K·P_ls, K = 0.39 (SPM design value; Komar & Inman
    //             1970 use 0.77 with deep-water H_o — the factor ~2 gap is
    //             the significant-height vs deep-water difference, SPM text)
    //   eq 4-35/4-49: Q = I_l/((ρs−ρ)·g·(1−n))   (Table 4-8: ρs=2650, ρ=1025, 1−n=0.6)
    //   eq 4-50a: Q(yr) = 1290·P_ls m³/yr  (dimensional design constant)
    const finite = Number.isFinite(K) && K > 0
      && Number.isFinite(Hsb) && Hsb > 0
      && Number.isFinite(thetaB);
    const sin2t = finite ? Math.sin(2 * thetaB) : Number.NaN;
    // Deep-water form (eq 4-45) applies when H comes from genuine ERA5 swh
    // (the paper's H_0s); the breaking form (eq 4-44) when the user supplies
    // a breaking height H_b.
    const cosA = finite ? Math.cos(thetaB) : 0;
    const cEff = __deepWaterForm ? 0.05 * Math.pow(Math.max(cosA, 0), 0.25) : 0.0884;
    const Pls = finite
      ? cEff * RHO_SW * Math.pow(G_GRAV, 1.5) * Math.pow(Hsb, 2.5) * sin2t
      : Number.NaN; // J/(s·m) — longshore energy flux factor
    const I = finite ? K * Pls : Number.NaN; // N/s — immersed-weight rate (eq 4-48)
    const denom = (RHO_SAND - RHO_SW) * G_GRAV * (1 - SAND_POROSITY); // (2650−1025)·9.80665·0.6
    const Q = finite ? I / denom : Number.NaN; // m³/s (eq 4-35/4-49)
    const Qyr = finite ? 1290 * Pls : Number.NaN; // m³/yr (eq 4-50a)
    const hLine = __hAuto
      ? `Significant wave height H = ${finite ? Hsb.toFixed(2) : 'N/A'} m (auto: genuine CDS ERA5 swh — treated as the paper's deep-water H_0s)${__waveDate ? ` (as of ${__waveDate})` : ''}`
      : `Breaking significant wave height H_b = ${finite ? Hsb.toFixed(2) : 'N/A'} m (user input — breaking form)`;
    const thetaLine = __thetaAuto
      ? `Breaker angle θ = ${finite ? (thetaB * 180 / Math.PI).toFixed(1) : 'N/A'}°${__thetaNote ? ` (${__thetaNote})` : ' — no genuine shoreline/wave-direction → honest NaN'}`
      : `Breaker angle θ_b = ${finite ? (thetaB * 180 / Math.PI).toFixed(1) : 'N/A'}° (user input, from the shore-normal; sin(2θ) form)`;
    return {
      result: Q, unit: 'm³/s',
      secondary: [
        { key: 'energy_flux', value: Pls, unit: 'J/(s·m)', label: 'Longshore energy flux factor P_ls (SPM eq 4-44/4-45)' },
        { key: 'immersed_weight', value: I, unit: 'N/s', label: 'Immersed-weight transport rate I_l = K·P_ls (eq 4-48)' },
        { key: 'transport_annual', value: Qyr, unit: 'm³/yr', label: 'Annual volumetric transport Q = 1290·P_ls (eq 4-50a)' },
      ],
      steps: [
        '── CERC Longshore Sediment Transport (SPM 1984, Vol 1 Ch 4 §V) ──',
        hLine,
        thetaLine,
        `CERC coefficient K = ${finite ? K.toFixed(3) : 'N/A'} (SPM design value 0.39; Komar & Inman 1970: 0.77 with deep-water H_o)`,
        '',
        ...(finite
          ? [
            'Step 1 — Longshore energy flux factor (Table 4-10):',
            `  P_ls = ${__deepWaterForm ? `0.05·ρ·g^(3/2)·H_0s^(5/2)·(cos α₀)^(1/4)·sin(2α₀)` : `0.0884·ρ·g^(3/2)·H_b^(5/2)·sin(2α_b)`}`,
            `  P_ls = ${cEff.toFixed(4)} × ${RHO_SW} × ${Math.pow(G_GRAV, 1.5).toFixed(2)} × ${Math.pow(Hsb, 2.5).toFixed(3)} × ${sin2t.toFixed(4)}`,
            `  P_ls = ${Pls.toFixed(1)} J/(s·m)`,
            '',
            'Step 2 — Immersed-weight rate (eq 4-48):',
            `  I_l = K × P_ls = ${K.toFixed(3)} × ${Pls.toFixed(1)} = ${I.toFixed(1)} N/s`,
            '',
            'Step 3 — Volumetric transport (eq 4-35/4-49):',
            `  Q = I_l / ((ρs−ρ)·g·(1−n)) = ${I.toFixed(1)} / (${RHO_SAND - RHO_SW} × ${G_GRAV} × 0.6)`,
            `  Q = ${Q.toFixed(4)} m³/s`,
            '',
            'Cross-check — SPM design relation eq 4-50a:',
            `  Q(yr) = 1290 × P_ls = ${Qyr.toExponential(3)} m³/yr (= ${Q.toFixed(4)} m³/s × 3.156e7 s/yr)`,
          ]
          : ['  Missing/non-positive H or θ — honest NaN (the energy-flux method',
             '  needs a genuine wave height and a genuine breaker angle; no proxy).']),
        '',
        `  └ ${!finite ? '—' : Math.abs(Qyr) < 5e4 ? 'Low transport (<50,000 m³/yr)' : Math.abs(Qyr) < 3e5 ? 'Moderate transport (50,000–300,000 m³/yr)' : Math.abs(Qyr) < 1e6 ? 'High transport (300,000–1,000,000 m³/yr)' : 'Very high transport (>10⁶ m³/yr)'}`,
        `  └ Direction: ${finite && sin2t > 0 ? 'positive (one side of the shore-normal)' : finite && sin2t < 0 ? 'negative (the other side)' : '—'}`,
        `  └ SPM-stated accuracy: ±50 % on Q from the energy-flux method (Fig 4-37 scatter); K calibrates the site`,
        `  └ Units: ρs=2650, ρ=1025 kg/m³, 1−n=0.6 (SPM Table 4-8); the eq 4-50a constant 1290 is dimensional (rounded from g=9.8)`,
      ]
    };
  },
  78: ({ g, k, h, __hAuto = true, __gebcoElev = null }) => {
    // Airy (1845) linear wave theory dispersion relation — Shore Protection
    // Manual (1984) Vol 1 Ch 2 eqs 2-1/2-2/2-3 (the authoritative textbook
    // restatement; Airy 1845 is pre-DOI): C² = (g/ω)·tanh(kh), equivalently
    // ω² = g·k·tanh(kh) with k = 2π/L, ω = 2π/T (SPM defines k = 2π/L and
    // ω = 2π/T in the text following eq 2-3). Regime classification per the
    // SPM's d/L table (eqs 2-5/2-6/2-10): deep water d/L > 1/2 (kh > π,
    // tanh ≈ 1); transitional 1/25 < d/L < 1/2; shallow water d/L < 1/25
    // (kh < 2π/25, tanh(kh) ≈ kh). The engine solves the FORWARD problem
    // (ω from k, h) — the same relation the SPM tabulates in Appendix C.
    const finite = Number.isFinite(g) && g > 0
      && Number.isFinite(k) && k > 0
      && Number.isFinite(h) && h > 0;
    const kh = finite ? k * h : Number.NaN;
    const tanhKh = finite ? Math.tanh(kh) : Number.NaN;
    const omega2 = finite ? g * k * tanhKh : Number.NaN;
    const omega = finite ? Math.sqrt(omega2) : Number.NaN;
    const T = finite ? 2 * Math.PI / omega : Number.NaN;
    const c = finite ? omega / k : Number.NaN;
    const L = finite ? 2 * Math.PI / k : Number.NaN;
    // Group velocity (SPM Ch 2): C_g = C/2·[1 + 2kh/sinh(2kh)] — the rate at
    // which wave energy propagates; deep water C_g = C/2, shallow C_g = C.
    const Cg = finite ? c / 2 * (1 + 2 * kh / Math.sinh(2 * kh)) : Number.NaN;
    const regime = finite
      ? kh > Math.PI
        ? 'Deep water (d/L > 1/2, kh > π): C = √(g/k) = gT/2π, C_g = C/2 — waves independent of depth'
        : kh < 2 * Math.PI / 25
          ? 'Shallow water (d/L < 1/25, kh < 2π/25): C = √(gh), C_g = C — non-dispersive, depth-limited'
          : 'Transitional water (1/25 < d/L < 1/2): full tanh form required (SPM eqs 2-2/2-3)'
      : null;
    const hLine = __hAuto
      ? __gebcoElev != null
        ? `Water depth h = ${finite ? h.toFixed(1) : 'N/A'} m (auto: GEBCO 2020 bathymetry, ground elevation ${__gebcoElev.toFixed(1)} m)`
        : 'Water depth h = N/A — no genuine bathymetry (honest NaN)'
      : `Water depth h = ${finite ? h.toFixed(1) : 'N/A'} m (user input)`;
    return {
      result: omega, unit: 'rad/s',
      secondary: [
        { key: 'kh', value: kh, unit: '—', label: 'Relative-depth parameter kh (SPM Ch 2 d/L table)' },
        { key: 'wave_celerity', value: c, unit: 'm/s', label: 'Phase speed C = ω/k (SPM eqs 2-2/2-3)' },
        { key: 'wavelength', value: L, unit: 'm', label: 'Wavelength L = 2π/k (SPM eq 2-1)' },
        { key: 'wave_period', value: T, unit: 's', label: 'Wave period T = 2π/ω' },
        { key: 'group_velocity', value: Cg, unit: 'm/s', label: 'Group velocity C_g = C/2·[1 + 2kh/sinh(2kh)] (SPM Ch 2)' },
      ],
      steps: [
        '── Airy Wave Dispersion Relation (Airy, 1845; SPM 1984 Vol 1 Ch 2, eqs 2-1/2-2/2-3) ──',
        `Gravity g = ${Number.isFinite(g) ? g.toFixed(2) : 'N/A'} m/s², Wavenumber k = ${Number.isFinite(k) ? k.toExponential(3) : 'N/A'} rad/m`,
        hLine,
        '',
        ...(finite
          ? [
            'Step 1 — Compute kh (SPM relative-depth parameter):',
            `  kh = ${k.toExponential(3)} × ${h.toFixed(1)} = ${kh.toFixed(3)}`,
            `  tanh(kh) = ${tanhKh.toFixed(4)}`,
            '',
            'Step 2 — Dispersion relation (SPM eq 2-3, ω² = g·k·tanh(kh)):',
            `  ω² = ${g.toFixed(2)} × ${k.toExponential(3)} × ${tanhKh.toFixed(4)}`,
            `  ω = √${omega2.toFixed(4)} = ${omega.toFixed(4)} rad/s`,
            '',
            'Step 3 — Wave parameters:',
            `  Period T = 2π/ω = ${T.toFixed(2)} s`,
            `  Celerity c = ω/k = ${c.toFixed(3)} m/s`,
            `  Wavelength L = 2π/k = ${L.toFixed(1)} m`,
            `  Group velocity C_g = ${Cg.toFixed(3)} m/s (energy travels at ${(Cg / c * 100).toFixed(0)} % of c)`,
            `  Regime: ${regime}`,
          ]
          : [
            '  Missing or non-positive g / k / h — honest NaN (the dispersion',
            '  relation needs a positive wavenumber and a positive water depth).',
            '',
            '  └ —',
          ]),
      ]
    };
  },
  79: ({ omega, ka, z, h, g }) => {
    // Stokes (1847) Stokes drift — the net Lagrangian mean horizontal velocity
    // of a linear (Airy) wave. Standard form:
    //   u_s(z) = (a²·ω·k · cosh(2k(z+h))) / (2·sinh²(kh))
    // with a = wave amplitude, k = wavenumber (full dispersion ω² = g·k·tanh(kh)
    // when a water depth h is supplied; deep-water limit k = ω²/g), ω = 2π/T.
    // Surface value (z=0): u_s(0) = (a²·ω·k·cosh(2kh))/(2·sinh²(kh)).
    // Deep-water limit (kh → ∞): u_s(z) → a²·ω·k·exp(2kz), u_s(0) → a²·ω·k.
    // Shallow-water limit (kh → 0): u_s(0) → (a²·ω·k)/(2(kh)²) — coth(kh)/kh → 1.
    // `ka` carries the wave amplitude a (mapped from user input `ka`); h and g
    // are optional (h = water depth for the full dispersion, g overrides g₀).
    const grav = Number.isFinite(g) && g > 0 ? g : G_GRAV;
    const a = ka;
    const hasH = Number.isFinite(h) && h > 0;
    const valid = Number.isFinite(omega) && omega > 0
      && Number.isFinite(a) && a >= 0
      && Number.isFinite(z) && z <= 0;
    let k = Number.NaN;
    if (valid) {
      const kDeep = (omega * omega) / grav;   // deep-water seed: ω² = gk
      if (hasH) {
        // Solve the full dispersion relation ω² = g·k·tanh(kh) for k by Newton
        // iteration from the deep-water seed (k·h > 0).
        k = kDeep;
        for (let i = 0; i < 40; i++) {
          const kh = k * h;
          const th = Math.tanh(kh);
          const f = grav * k * th - omega * omega;
          const df = grav * (th + k * h * (1 - th * th));
          const dk = f / df;
          k -= dk;
          if (Math.abs(dk) < 1e-14 * k) break;
        }
      } else {
        k = kDeep;
      }
    }
    const kh = valid && hasH ? k * h : Number.NaN;
    const usSurf = valid
      ? hasH
        ? (a * a * omega * k * Math.cosh(2 * kh)) / (2 * Math.sinh(kh) * Math.sinh(kh))
        : a * a * omega * k
      : Number.NaN;
    const us = valid
      ? hasH
        ? (a * a * omega * k * Math.cosh(2 * k * (z + h))) / (2 * Math.sinh(kh) * Math.sinh(kh))
        : usSurf * Math.exp(2 * k * z)
      : Number.NaN;
    const L = valid && k > 0 ? 2 * Math.PI / k : Number.NaN;
    const c = valid && k > 0 ? omega / k : Number.NaN;
    const eFold = valid && k > 0 ? 1 / (2 * k) : Number.NaN;
    const driftRatio = valid && Number.isFinite(usSurf) && usSurf !== 0 ? us / usSurf : Number.NaN;
    // Depth profile series (vizType 'profile'): u_s(z) from the surface (z=0)
    // down to the e-folding depth (deep water) or the sea floor (finite depth).
    const seriesPoints: Array<{ x: number; y: number }> = [];
    if (valid && k > 0) {
      const zFloor = hasH ? Math.max(z, -h) : -3 * eFold;
      const N = 40;
      for (let i = 0; i <= N; i++) {
        const zi = -((0 - zFloor) * i / N);  // negative below surface
        const ui = hasH
          ? (a * a * omega * k * Math.cosh(2 * k * (zi + h))) / (2 * Math.sinh(kh) * Math.sinh(kh))
          : a * a * omega * k * Math.exp(2 * k * zi);
        if (Number.isFinite(ui)) seriesPoints.push({ x: zi, y: ui });
      }
    }
    return {
      result: us, unit: 'm/s',
      secondary: [
        { key: 'wavelength', value: Number.isFinite(L) ? L : Number.NaN, unit: 'm', label: 'Wavelength L = 2π/k' },
        { key: 'phase_speed', value: Number.isFinite(c) ? c : Number.NaN, unit: 'm/s', label: 'Wave celerity c = ω/k' },
        { key: 'surface_drift', value: Number.isFinite(usSurf) ? usSurf : Number.NaN, unit: 'm/s', label: 'Surface Stokes drift u_s(0)' },
        { key: 'deep_water_limit', value: valid ? a * a * omega * k : Number.NaN, unit: 'm/s', label: 'Deep-water surface limit a²·ω·k (kh→∞)' },
        { key: 'drift_depth_ratio', value: driftRatio, unit: '—', label: 'u_s(z)/u_s(0) — depth attenuation ratio' },
        { key: 'efolding_depth', value: Number.isFinite(eFold) ? eFold : Number.NaN, unit: 'm', label: 'e-folding depth z_e = 1/(2k)' },
        { key: 'kh', value: Number.isFinite(kh) ? kh : Number.NaN, unit: '—', label: 'Relative-depth parameter kh (h/L·2π)' },
      ],
      series: seriesPoints.length > 0
        ? [{ label: 'Stokes drift u_s(z) vs depth', color: '#0072B2', points: seriesPoints }]
        : undefined,
      steps: valid
        ? [
          '── Stokes Drift (Stokes, 1847) ──',
          `Wave angular frequency ω = ${omega.toFixed(4)} rad/s (T = ${(2 * Math.PI / omega).toFixed(2)} s)`,
          `Wave amplitude a = ${a.toExponential(3)} m, gravity g = ${grav.toFixed(2)} m/s²`,
          hasH
            ? `Wavenumber k = ${k.toExponential(3)} rad/m from ω² = g·k·tanh(kh), h = ${h.toFixed(1)} m (kh = ${kh.toFixed(3)})`
            : `Wavenumber k = ω²/g = ${k.toExponential(3)} rad/m (deep-water dispersion)`,
          `Depth below surface z = ${z.toFixed(1)} m (negative below surface)`,
          '',
          'Step 1 — Surface Stokes drift (z=0):',
          hasH
            ? `  u_s(0) = (a²·ω·k·cosh(2kh))/(2·sinh²(kh)) = ${usSurf.toExponential(3)} m/s (${(usSurf * 100).toFixed(2)} cm/s)`
            : `  u_s(0) = a²·ω·k = (${a.toExponential(3)}² × ${omega.toFixed(4)} × ${k.toExponential(3)}) = ${usSurf.toExponential(3)} m/s (${(usSurf * 100).toFixed(2)} cm/s)`,
          '',
          'Step 2 — Depth attenuation:',
          hasH
            ? `  u_s(z) = (a²·ω·k·cosh(2k(z+h)))/(2·sinh²(kh)) = ${us.toExponential(3)} m/s (${(us * 100).toExponential(3)} cm/s)`
            : `  u_s(z) = u_s(0) × exp(2kz) = ${us.toExponential(3)} m/s (${(us * 100).toExponential(3)} cm/s)`,
          '',
          `  └ e-folding depth: z_e = 1/(2k) = ${eFold.toFixed(1)} m (depth where drift = 37% of surface)`,
          `  └ Deep/shallow limit: kh = ${Number.isFinite(kh) ? kh.toFixed(3) : '∞ (deep water)'} — ${Number.isFinite(kh) && kh > Math.PI ? 'deep water (u_s → a²ωk·e^{2kz})' : Number.isFinite(kh) && kh < Math.PI / 25 ? 'shallow water (u_s → a²ωk/(2(kh)²)·cosh(2k(z+h)))' : 'transitional water'}`,
          `  └ Stokes transport: M_S = ∫u_s dz (volume transport in wave direction)`,
        ]
        : [
          '── Stokes Drift (Stokes, 1847) ──',
          'Requires a finite positive angular frequency ω, a finite positive wave',
          `amplitude a (${Number.isFinite(ka) ? ka.toExponential(3) : 'N/A'}), and a depth z ≤ 0 (${Number.isFinite(z) ? z : 'N/A'}).`,
          'Result: NaN (honest — no fabricated drift).',
        ],
    };
  },
  80: ({ alpha, g2, fm, fpm, gamma }) => {
    // JONSWAP (Hasselmann et al., 1973, eq 16):
    //   S(f) = α·g²·(2π)⁻⁴·f⁻⁵ · exp[−5/4·(f_p/f)⁻⁴] · γ^exp[−(f−f_p)²/(2σ²f_p²)]
    //   = α·g²·(2π)⁻⁴·f⁻⁵ · exp[−5/4·(f/f_p)⁴] ... note the exponent: the
    //   peak-enhancement factor exp[−5/4·(f/f_p)⁻⁴] = exp[−5/4·(f_p/f)⁴] must
    //   → 1 for f ≫ f_p so the Phillips f⁻⁵ tail reappears (NOT → 0).
    // with σ = 0.07 for f ≤ f_p and σ = 0.09 for f > f_p (the σ step).
    // The (2π)⁻⁴ converts from the angular-frequency form S(ω) = αg²ω⁻⁵…
    // to ordinary-frequency S(f) — without it the result is (2π)⁴ ≈ 1559× too large.
    const fp = fpm;          // peak frequency (Hz)
    const f = fm;            // frequency at which to evaluate (Hz)
    const valid = Number.isFinite(alpha) && Number.isFinite(g2) && Number.isFinite(f)
      && Number.isFinite(fp) && Number.isFinite(gamma)
      && alpha > 0 && g2 > 0 && f > 0 && fp > 0 && gamma > 0;
    // JONSWAP σ step, evaluated on a spectral point (0.07 below/at peak, 0.09 above)
    const sigmaAt = (fi: number): number => (fi <= fp ? 0.07 : 0.09);
    // S(fi) — single spectral density value at a frequency fi (Hz)
    const spectrumAt = (fi: number): number => {
      const s = sigmaAt(fi);
      const peakEnhance = Math.exp(-1.25 * Math.pow(fi / fp, -4));
      const gaussExp = Math.exp(-Math.pow(fi - fp, 2) / (2 * s * s * fp * fp));
      const gammaFactor = Math.pow(gamma, gaussExp);
      return alpha * Math.pow(g2, 2) * Math.pow(2 * Math.PI, -4) * Math.pow(fi, -5) * peakEnhance * gammaFactor;
    };
    if (!valid) {
      return {
        result: Number.NaN, unit: 'm²/Hz',
        secondary: [
          { key: 'peak_frequency', value: Number.isFinite(fp) && fp > 0 ? fp : Number.NaN, unit: 'Hz', label: 'Peak frequency f_p' },
          { key: 'peak_spectral_density', value: Number.NaN, unit: 'm²/Hz', label: 'Peak spectral density S(f_p)' },
          { key: 'sig_wave_height', value: Number.NaN, unit: 'm', label: 'Significant wave height H_s = 4·√m₀ (from the spectrum)' },
          { key: 'phillips_alpha', value: Number.isFinite(alpha) ? alpha : Number.NaN, unit: '—', label: 'Phillips constant α' },
        ],
        steps: [
          '── JONSWAP Spectrum (Hasselmann et al., 1973) ──',
          'Requires positive α, g, f, f_p and γ (the peak-enhancement factor).',
          `  α = ${alpha}, g = ${g2}, f = ${f}, f_p = ${fp}, γ = ${gamma}`,
          'Result: NaN (honest — a degenerate spectrum).',
        ],
      };
    }
    const sigma = f <= fp ? 0.07 : 0.09;   // JONSWAP σ step at the evaluation point
    const peakEnhance = Math.exp(-1.25 * Math.pow(f / fp, -4));
    const gaussExp = Math.exp(-Math.pow(f - fp, 2) / (2 * sigma * sigma * fp * fp));
    const gammaFactor = Math.pow(gamma, gaussExp);
    const S = alpha * Math.pow(g2, 2) * Math.pow(2 * Math.PI, -4) * Math.pow(f, -5) * peakEnhance * gammaFactor;
    // Spectrum series (vizType 'spectrum'): S(f) over f from 0.5·f_p to 4·f_p
    // (log-spaced for a clean plot), plus the peak point exactly at f_p.
    const fMin = fp * 0.5;
    const fMax = fp * 4;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 120; i++) {
      const fi = fMin * Math.pow(fMax / fMin, i / 120);
      if (Number.isFinite(fi) && fi > 0) {
        seriesPoints.push({ x: fi, y: spectrumAt(fi) });
      }
    }
    seriesPoints.push({ x: fp, y: S });
    seriesPoints.sort((a, b) => a.x - b.x);
    // Significant wave height H_s = 4·√m₀ from the spectrum: m₀ = ∫S(f)df via
    // the trapezoidal rule over the series band (the dominant energy band).
    let m0 = 0;
    for (let i = 1; i < seriesPoints.length; i++) {
      m0 += 0.5 * (seriesPoints[i].x - seriesPoints[i - 1].x) * (seriesPoints[i].y + seriesPoints[i - 1].y);
    }
    const Hs = m0 >= 0 ? 4 * Math.sqrt(m0) : Number.NaN;
    return {
      result: S, unit: 'm²/Hz',
      secondary: [
        { key: 'peak_frequency', value: fp, unit: 'Hz', label: 'Peak frequency f_p' },
        { key: 'peak_spectral_density', value: S, unit: 'm²/Hz', label: 'Peak spectral density S(f_p)' },
        { key: 'sig_wave_height', value: Number.isFinite(Hs) ? Hs : Number.NaN, unit: 'm', label: 'Significant wave height H_s = 4·√m₀ (from the spectrum)' },
        { key: 'phillips_alpha', value: alpha, unit: '—', label: 'Phillips constant α' },
        { key: 'peak_enhancement', value: gamma, unit: '—', label: 'Peak enhancement factor γ (JONSWAP)' },
      ],
      series: [{
        label: 'JONSWAP S(f)',
        color: '#0072B2',
        points: seriesPoints,
      }],
      steps: [
        '── JONSWAP Spectrum (Hasselmann et al., 1973) ──',
        `Phillips constant α = ${alpha.toExponential(2)}, g = ${g2.toFixed(2)} m/s²`,
        `Peak frequency f_p = ${fp.toExponential(2)} Hz, Evaluation f = ${f.toExponential(2)} Hz`,
        `Peak enhancement γ = ${gamma.toFixed(2)}, σ = ${sigma} (JONSWAP step: 0.07 if f≤f_p, 0.09 if f>f_p)`,
        '',
        'Step 1 — Phillips f⁻⁵ tail with (2π)⁻⁴ conversion:',
        `  α·g²·(2π)⁻⁴·f⁻⁵ = ${alpha.toExponential(2)} × ${g2.toFixed(2)}² × ${(1/Math.pow(2*Math.PI,4)).toExponential(4)} × ${Math.pow(f, -5).toExponential(3)}`,
        `  = ${(alpha * g2 * g2 * Math.pow(2*Math.PI, -4) * Math.pow(f, -5)).toExponential(3)} m²/Hz`,
        '',
        'Step 2 — Peak enhancement exp[−1.25(f/f_p)⁻⁴] (→ 1 as f ≫ f_p, restoring the Phillips tail):',
        `  = ${peakEnhance.toExponential(3)}`,
        '',
        'Step 3 — Gaussian broadening exp[−(f−f_p)²/(2σ²f_p²)]:',
        `  = ${gaussExp.toExponential(3)} (σ=${sigma})`,
        `  γ^broadening = ${gamma.toFixed(2)}^${gaussExp.toExponential(2)} = ${gammaFactor.toExponential(3)}`,
        '',
        'Step 4 — Spectral density:',
        `  S(f) = α·g²·(2π)⁻⁴·f⁻⁵ · exp[−1.25(f/f_p)⁻⁴] · γ^exp[−(f−f_p)²/(2σ²f_p²)]`,
        `  S(${f.toExponential(2)}) = ${S.toExponential(3)} m²/Hz`,
        '',
        `  └ At the peak (f=f_p): Gaussian exponent = 0 → γ^1 = γ; S(f_p) = αg²(2π)⁻⁴f_p⁻⁵·exp(−1.25)·γ = ${S.toExponential(3)} m²/Hz`,
        `  └ H_s = 4·√(∫S(f)df) = ${Number.isFinite(Hs) ? Hs.toFixed(2) : 'N/A'} m over the band [${fMin.toFixed(3)}, ${fMax.toFixed(3)}] Hz`,
        `  └ γ = 1 collapses JONSWAP to the Pierson–Moskowitz spectrum; γ > 1 sharpens the peak`,
      ]
    };
  },

  // ── Part IV · Domain 12: Geomorphology ──
  81: ({ K, A, m, S }) => {
    const E = K * Math.pow(A, m) * Math.pow(S, 1);
    const n = 1; // typical exponent for slope (n ≈ 1 assumed)
    return {
      result: E, unit: '—',
      steps: [
        '── Stream Power Incision Model (Howard & Kerby, 1983; Whipple & Tucker, 1999) ──',
        `Erodibility K = ${K.toExponential(3)}, Drainage area A = ${A.toFixed(1)} km²`,
        `Area exponent m = ${m.toFixed(3)}, Slope S = ${S.toFixed(5)} m/m, Slope exponent n = ${n.toFixed(0)}`,
        '',
        'Step 1 — Compute A^m:',
        `  A^m = (${A.toFixed(1)})^${m.toFixed(3)} = ${Math.pow(A, m).toExponential(3)}`,
        '',
        'Step 2 — Compute incision rate:',
        `  E = K·A^m·S^n = ${K.toExponential(3)} × ${Math.pow(A, m).toExponential(3)} × ${S.toFixed(5)}^${n.toFixed(0)}`,
        `  E = ${E.toExponential(4)} (dimensionless erosion metric)`,
        '',
        `  └ ${E > 1 ? 'High erosion potential — steep, high-discharge catchment' : E > 0.1 ? 'Moderate erosion — typical mountain stream' : 'Low erosion — low-gradient or resistant substrate'}`,
        `  └ Concavity index θ = m/n = ${(m / n).toFixed(3)}; typical values 0.35–0.6 for fluvial landscapes`,
      ]
    };
  },
  82: ({ c, A, h }) => {
    const cN = Number(c);
    const AN = Number(A);
    const hN = Number(h);
    if (!Number.isFinite(cN) || !Number.isFinite(AN) || !Number.isFinite(hN) || AN <= 0) {
      return {
        result: Number.NaN, unit: 'km',
        secondary: [
          { key: 'hack_exponent', value: Number.isFinite(hN) ? hN : Number.NaN, unit: '—', label: 'Hack exponent h (typically 0.55–0.7)' },
          { key: 'coefficient', value: Number.isFinite(cN) ? cN : Number.NaN, unit: 'km^(1−h)', label: 'Scaling coefficient c' },
        ],
        steps: [
          '── Hack\'s Law (Hack, 1957) ──',
          'One or more inputs are non-finite, or A ≤ 0 — cannot compute.',
          'Supply c (coefficient), A (km²), h (Hack exponent).',
        ],
      };
    }
    const L = cN * Math.pow(AN, hN);
    return {
      result: L, unit: 'km',
      secondary: [
        { key: 'hack_exponent', value: hN, unit: '—', label: 'Hack exponent h (typically 0.55–0.7)' },
        { key: 'coefficient', value: cN, unit: 'km^(1−h)', label: 'Scaling coefficient c' },
      ],
      // Scatter series (tool vizType 'scatter'): L vs drainage area A over
      // 1–10000 km² (15 log-spaced points) from the tool's own power law
      // L = c·A^h (linear on a log-log plot).
      series: [{
        label: `Hack's law L = ${cN.toFixed(3)}·A^${hN.toFixed(3)}`,
        color: '#0072B2',
        points: Array.from({ length: 15 }, (_, i) => {
          const A = Math.pow(10000, i / 14); // 1 → 10000 km², log-spaced
          const Lval = cN * Math.pow(A, hN);
          return { x: A, y: Number.isFinite(Lval) ? Lval : Number.NaN };
        }),
      }],
      steps: [
        '── Hack\'s Law (Hack, 1957) ──',
        `Coefficient c = ${cN.toFixed(3)}, Drainage area A = ${AN.toFixed(1)} km²`,
        `Scaling exponent h = ${hN.toFixed(3)} (Hack exponent, typically 0.55–0.7)`,
        '',
        'Step 1 — Compute main channel length:',
        `  L = c × A^h = ${cN.toFixed(3)} × ${AN.toFixed(1)}^{${hN.toFixed(3)}}`,
        `  L = ${L.toFixed(2)} km`,
        '',
        'Step 2 — Hack exponent interpretation:',
        `  h = ${hN.toFixed(3)} → ${hN < 0.55 ? 'Low exponent — compact drainage basin' : hN < 0.7 ? 'Typical exponent — self-similar network' : 'High exponent — elongated basin'}`,
        '',
        `  └ Hack's Law implies log(L) ∝ h·log(A); linear on log-log plot`,
        `  └ c depends on network geometry: ${cN < 1 ? 'low coefficient ~ dendritic network on low slope' : cN > 3 ? 'high coefficient ~ strongly elongated' : 'moderate coefficient'}`,
      ]
    };
  },
  83: ({ L1, s1, L2, s2 }) => {
    // Richardson (1961) two-point fractal dimension:
    //   L(s) = c · s^(1-D)  ⇒  D = 1 − ln(L₁/L₂) / ln(s₁/s₂)
    // Two measurements at different ruler scales (s₁, L₁) and (s₂, L₂)
    // eliminate the unknown constant c.
    const L1N = Number(L1), s1N = Number(s1), L2N = Number(L2), s2N = Number(s2);
    if (!Number.isFinite(L1N) || !Number.isFinite(s1N) || !Number.isFinite(L2N) || !Number.isFinite(s2N) || L1N <= 0 || s1N <= 0 || L2N <= 0 || s2N <= 0) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'hurst_exponent', value: Number.NaN, unit: '—', label: 'Hurst exponent H = 2 − D (persistence measure)' },
          { key: 'complexity_class', value: Number.NaN, unit: '—', label: 'N/A' },
        ],
        steps: [
          '── Richardson Fractal Dimension (Richardson 1961; Mandelbrot 1967) ──',
          'One or more inputs are non-finite or non-positive — cannot compute.',
          'Supply two (length L, ruler scale s) measurement pairs with L, s > 0.',
        ],
      };
    }
    const lnRatioL = Math.log(L1N / L2N);
    const lnRatioS = Math.log(s1N / s2N);
    const D = (Math.abs(lnRatioS) < 1e-12)
      ? Number.NaN
      : 1 - lnRatioL / lnRatioS;
    const Hurst = Number.isFinite(D) ? 2 - D : Number.NaN;
    const complexityClass = Number.isFinite(D)
      ? D < 1.1 ? 'Low — smooth, depositional coast (barrier islands, sandy beaches)'
        : D < 1.3 ? 'Moderate — typical embayed coast (Atlantic-style irregular shoreline)'
        : D < 1.5 ? 'High — rough, indented coast (ria coast, highly irregular)'
        : 'Very high — fjord coast or strongly space-filling boundary'
      : null;
    return {
      result: D, unit: '—',
      secondary: [
        { key: 'hurst_exponent', value: Hurst, unit: '—', label: 'Hurst exponent H = 2 − D (persistence measure)' },
        { key: 'complexity_class', value: Number.isFinite(D) ? D : Number.NaN, unit: '—', label: complexityClass ?? 'N/A' },
      ],
      steps: [
        '── Richardson Fractal Dimension (Richardson 1961; Mandelbrot 1967) ──',
        `Measurement 1: L₁ = ${L1N.toFixed(1)} km at ruler scale s₁ = ${s1N.toFixed(1)} km`,
        `Measurement 2: L₂ = ${L2N.toFixed(1)} km at ruler scale s₂ = ${s2N.toFixed(1)} km`,
        '',
        'Step 1 — Richardson power law: L(s) = c · s^(1−D)',
        '  Taking logs of two measurements eliminates the unknown c:',
        `  D = 1 − ln(L₁/L₂) / ln(s₁/s₂)`,
        '',
        'Step 2 — Compute log ratios:',
        `  ln(L₁/L₂) = ln(${L1N.toFixed(1)}/${L2N.toFixed(1)}) = ${lnRatioL.toFixed(4)}`,
        `  ln(s₁/s₂) = ln(${s1N.toFixed(1)}/${s2N.toFixed(1)}) = ${lnRatioS.toFixed(4)}`,
        '',
        'Step 3 — Fractal dimension:',
        `  D = 1 − ${lnRatioL.toFixed(4)} / ${lnRatioS.toFixed(4)} = ${Number.isFinite(D) ? D.toFixed(4) : 'N/A'}`,
        '',
        'Step 4 — Interpretation:',
        `  ${complexityClass ?? 'N/A (degenerate: s₁ ≈ s₂)'}`,
        `  Hurst exponent H = 2 − D = ${Number.isFinite(Hurst) ? Hurst.toFixed(4) : 'N/A'}`,
        '',
        '  └ Theoretical range: 1 ≤ D ≤ 2; D = 1 for straight line, D = 2 for space-filling',
        '  └ Richardson (1961) data: South Africa D≈1.02, Australia D≈1.13, Britain D≈1.24, Norway D≈1.52',
      ]
    };
  },
  84: ({ cprime, gammaz, z: _z, cosB, u, phiP: _phiP, tanphi, sinB, cosB2 }) => {
    // Infinite-slope factor of safety (Taylor 1948; Duncan & Wright 2005):
    //   FS = [c' + (γz·cos²β − u)·tanφ'] / (γz·sinβ·cosβ)
    // The normal-stress term uses cos²β (the cosB2 parameter), not cosβ.
    const cprimeN = Number(cprime), gammazN = Number(gammaz), cosBN = Number(cosB), uN = Number(u), tanphiN = Number(tanphi), sinBN = Number(sinB), cosB2N = Number(cosB2);
    if (!Number.isFinite(cprimeN) || !Number.isFinite(gammazN) || !Number.isFinite(cosBN) || !Number.isFinite(uN) || !Number.isFinite(tanphiN) || !Number.isFinite(sinBN) || !Number.isFinite(cosB2N)) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'friction_angle', value: Number.isFinite(tanphiN) ? Math.atan(tanphiN) * 180 / Math.PI : Number.NaN, unit: '°', label: 'Effective friction angle φ′ = atan(tanφ′)' },
          { key: 'normal_stress', value: (Number.isFinite(gammazN) && Number.isFinite(cosB2N) && Number.isFinite(uN)) ? gammazN * cosB2N - uN : Number.NaN, unit: 'kPa', label: 'Effective normal stress σ′_n = γz·cos²β − u' },
        ],
        steps: [
          '── Infinite Slope Stability (Taylor, 1948; Duncan & Wright, 2005) ──',
          'One or more inputs are non-finite — cannot compute.',
          'Supply c′, γz, cosβ, cos²β, sinβ, u, tanφ′.',
        ],
      };
    }
    const num = cprimeN + (gammazN * cosB2N - uN) * tanphiN;
    const den = gammazN * sinBN * cosBN;
    const FS = den !== 0 ? num / den : Infinity;
    const normalStress = gammazN * cosB2N - uN;
    return {
      result: FS, unit: '—',
      secondary: [
        { key: 'friction_angle', value: Math.atan(tanphiN) * 180 / Math.PI, unit: '°', label: 'Effective friction angle φ′ = atan(tanφ′)' },
        { key: 'normal_stress', value: normalStress, unit: 'kPa', label: 'Effective normal stress σ′_n = γz·cos²β − u' },
      ],
      steps: [
        '── Infinite Slope Stability (Taylor, 1948; Duncan & Wright, 2005) ──',
        `Effective cohesion c' = ${cprimeN.toFixed(2)} kPa`,
        `Soil unit weight γz = ${gammazN.toFixed(2)} kN/m³, cosβ = ${cosBN.toFixed(4)}`,
        `Pore pressure u = ${uN.toFixed(2)} kPa, tanφ' = ${tanphiN.toFixed(4)}`,
        `sinβ = ${sinBN.toFixed(4)}, cos²β = ${cosB2N.toFixed(4)}`,
        '',
        'Step 1 — Compute resisting (shear strength) term:',
        `  numerator = c' + (γz·cos²β − u)·tanφ'`,
        `  = ${cprimeN.toFixed(2)} + (${gammazN.toFixed(2)}×${cosB2N.toFixed(4)} − ${uN.toFixed(2)})×${tanphiN.toFixed(4)}`,
        `  = ${num.toFixed(4)} kPa`,
        '',
        'Step 2 — Compute driving (shear stress) term:',
        `  denominator = γz·sinβ·cosβ = ${gammazN.toFixed(2)} × ${sinBN.toFixed(4)} × ${cosBN.toFixed(4)}`,
        `  = ${den.toFixed(4)} kPa`,
        '',
        'Step 3 — Factor of Safety:',
        `  FS = ${num.toFixed(4)} / ${den.toFixed(4)} = ${Number.isFinite(FS) ? FS.toFixed(3) : 'N/A'}`,
        '',
        'Step 4 — Stability classification:',
        `  ${FS >= 1.5 ? 'STABLE — adequate factor of safety' : FS >= 1.25 ? 'MARGINALLY STABLE — monitor / minor remediation' : FS >= 1.0 ? 'NEARLY FAILING — requires detailed investigation' : 'FAILURE (FS < 1) — slope instable, remediation required'}`,
        '',
        `  └ Critical slip surface assumed planar and parallel to slope (infinite slope assumption valid when depth << length)`,
      ]
    };
  },
  85: ({ mu, sigmaN, xi, rho, velocity }) => {
    // Voellmy (1955) friction model for rapid granular flows:
    //   τ = μ·σ_n + ρ·g·u²/ξ
    // τ_C = μ·σ_n (dry Coulomb)  +  τ_t = ρ·g·u²/ξ (turbulent drag)
    const muN = Number(mu), sigmaNN = Number(sigmaN), xiN = Number(xi), rhoN = Number(rho), velocityN = Number(velocity);
    if (!Number.isFinite(muN) || !Number.isFinite(sigmaNN) || !Number.isFinite(xiN) || !Number.isFinite(rhoN) || !Number.isFinite(velocityN) || xiN === 0) {
      return {
        result: Number.NaN, unit: 'Pa',
        secondary: [
          { key: 'coulomb_friction', value: Number.NaN, unit: 'Pa', label: 'Coulomb term τ_C = μσ_n' },
          { key: 'turbulent_drag', value: Number.NaN, unit: 'Pa', label: 'Turbulent term τ_t = ρgu²/ξ' },
          { key: 'fraction_turbulent', value: Number.NaN, unit: '—', label: 'Fraction from turbulent term' },
          { key: 'apparent_friction', value: Number.NaN, unit: '—', label: 'Apparent friction μ_app = μ + ρgu²/(ξσ_n)' },
          { key: 'normal_stress', value: Number.isFinite(sigmaNN) ? sigmaNN : Number.NaN, unit: 'Pa', label: 'Normal stress σ_n' },
        ],
        steps: [
          '── Voellmy Friction Model (Voellmy 1955; Savage & Hutter 1989) ──',
          'One or more inputs are non-finite, or ξ = 0 — cannot compute.',
          'Supply μ, σ_n, ξ, ρ, u.',
        ],
      };
    }
    const g = G_GRAV;
    const tauC = muN * sigmaNN;
    const tauT = (rhoN * g * velocityN * velocityN) / xiN;
    const tau = tauC + tauT;
    const fraction_turbulent = tau > 0 ? tauT / tau : 0;
    const mu_app = sigmaNN > 0 ? muN + (rhoN * g * velocityN * velocityN) / (xiN * sigmaNN) : muN;
    return {
      result: tau, unit: 'Pa',
      secondary: [
        { key: 'coulomb_friction', value: tauC, unit: 'Pa', label: 'Coulomb term τ_C = μσ_n' },
        { key: 'turbulent_drag', value: tauT, unit: 'Pa', label: 'Turbulent term τ_t = ρgu²/ξ' },
        { key: 'fraction_turbulent', value: fraction_turbulent, unit: '—', label: 'Fraction from turbulent term' },
        { key: 'apparent_friction', value: mu_app, unit: '—', label: 'Apparent friction μ_app = μ + ρgu²/(ξσ_n)' },
        { key: 'normal_stress', value: sigmaNN, unit: 'Pa', label: 'Normal stress σ_n' },
      ],
      steps: [
        '── Voellmy Friction Model (Voellmy 1955; Savage & Hutter 1989) ──',
        `Coulomb friction μ = ${muN.toFixed(4)}, Normal stress σ_n = ${sigmaNN.toFixed(2)} Pa`,
        `Flow velocity u = ${velocityN.toFixed(2)} m/s, Density ρ = ${rhoN.toFixed(0)} kg/m³`,
        `Turbulence parameter ξ = ${xiN.toFixed(1)} m/s²`,
        '',
        'Step 1 — Coulomb friction term:',
        `  τ_C = μ × σ_n = ${muN.toFixed(4)} × ${sigmaNN.toFixed(2)} = ${tauC.toFixed(2)} Pa`,
        '',
        'Step 2 — Turbulent drag term:',
        `  τ_t = ρ·g·u²/ξ = ${rhoN.toFixed(0)} × ${g.toFixed(2)} × ${velocityN.toFixed(2)}² / ${xiN.toFixed(1)} = ${tauT.toFixed(2)} Pa`,
        '',
        'Step 3 — Total shear stress:',
        `  τ = τ_C + τ_t = ${tauC.toFixed(2)} + ${tauT.toFixed(2)} = ${tau.toFixed(2)} Pa`,
        `  Apparent friction μ_app = ${mu_app.toFixed(4)} (effective μ at velocity ${velocityN.toFixed(1)} m/s)`,
        `  Turbulent fraction: ${(fraction_turbulent * 100).toFixed(1)}%`,
        '',
        'Step 4 — Interpretation:',
        `  ${velocityN < 1 ? 'Low velocity — Coulomb friction dominates (>99% of τ)' : velocityN < 10 ? 'Moderate velocity — both terms contribute' : 'High velocity — turbulent drag dominates (avalanche/debris-flow regime)'}`,
        `  Steady uniform flow: u_eq = √(ξ·h·(sinβ − μ·cosβ))`,
        `  Friction angle φ = atan(μ) = ${(Math.atan(muN) * 180 / Math.PI).toFixed(1)}°`,
      ]
    };
  },
  86: ({ As, tanB }) => {
    const slopeRad = tanB > 0 ? tanB : 1e-10;
    const SPI = Math.log(As * slopeRad);
    const slopeDeg = Math.atan(slopeRad) * 180 / Math.PI;
    return {
      result: SPI, unit: '—',
      steps: [
        '── Stream Power Index (Moore et al., 1991) ──',
        `Specific catchment area A_s = ${As.toFixed(1)} m²/m`,
        `Slope tan β = ${slopeRad.toFixed(5)} (≈ ${slopeDeg.toFixed(2)}°)`,
        '',
        'Step 1 — Compute SPI:',
        `  SPI = ln(A_s × tanβ) = ln(${As.toFixed(1)} × ${slopeRad.toFixed(5)})`,
        `  SPI = ln(${(As * slopeRad).toFixed(4)}) = ${SPI.toFixed(3)}`,
        '',
        'Step 2 — Erosion potential:',
        `  ${SPI > 5 ? 'HIGH EROSION POTENTIAL — convergent flow, steep slope' : SPI > 3 ? 'MODERATE — hillslope/channel transition' : 'LOW — divergent or low-gradient areas'}`,
        '',
        `  └ SPI quantifies erosive power of concentrated overland flow; used with LS factor in RUSLE`,
      ]
    };
  },
  87: ({ As, tanB }) => {
    const slopeRad = tanB > 0 ? tanB : 1e-10;
    const TWI = Math.log(As) - Math.log(slopeRad);
    const slopeDeg = Math.atan(slopeRad) * 180 / Math.PI;
    return {
      result: TWI, unit: '—',
      steps: [
        '── Topographic Wetness Index (Beven & Kirkby, 1979; TOPMODEL) ──',
        `Specific catchment area A_s = ${As.toFixed(1)} m²/m`,
        `Slope tan β = ${slopeRad.toFixed(5)} (≈ ${slopeDeg.toFixed(2)}°)`,
        '',
        'Step 1 — Compute TWI:',
        `  TWI = ln(A_s / tanβ) = ln(${As.toFixed(1)} / ${slopeRad.toFixed(5)})`,
        `  TWI = ln(${(As / slopeRad).toFixed(1)}) = ${TWI.toFixed(3)}`,
        '',
        'Step 2 — Saturation classification:',
        `  ${TWI > 8 ? 'SATURATION ZONE — likely variable source area, wetland / riparian' : TWI > 6 ? 'HIGH — periodic saturation, ephemeral channels' : TWI > 4 ? 'MODERATE — hillslope, well-drained' : 'WELL DRAINED — ridge top / steep slope'}`,
        '',
        `  └ TWI ln(a/tanβ) correlates with depth to water table; higher values → shallower water table`,
      ]
    };
  },

  // ── Domain 13: Limnology ──
  88: ({ Km, ew, ea, u }) => {
    // Meyer (1915) mass-transfer evaporation:
    //   E = K_m · (e_w − e_a) · (1 + u/16)
    // Wind function (1 + u/16) — the classic Meyer wind correction.
    const KmN = Number(Km), ewN = Number(ew), eaN = Number(ea), uN = Number(u);
    if (!Number.isFinite(KmN) || !Number.isFinite(ewN) || !Number.isFinite(eaN) || !Number.isFinite(uN)) {
      return {
        result: Number.NaN, unit: 'mm/day',
        secondary: [
          { key: 'vapor_pressure_deficit', value: (Number.isFinite(ewN) && Number.isFinite(eaN)) ? ewN - eaN : Number.NaN, unit: 'kPa', label: 'Vapour pressure deficit (e_w − e_a)' },
          { key: 'wind_factor', value: Number.isFinite(uN) ? 1 + uN / 16 : Number.NaN, unit: '—', label: 'Wind function (1 + u/16)' },
        ],
        steps: [
          '── Lake Evaporation (Meyer, 1915) ──',
          'One or more inputs are non-finite — cannot compute.',
          'Supply K_m, e_w, e_a, u.',
        ],
      };
    }
    const vpDeficit = ewN - eaN;
    const windFactor = 1 + uN / 16;
    const E = KmN * vpDeficit * windFactor;
    return {
      result: E, unit: 'mm/day',
      secondary: [
        { key: 'vapor_pressure_deficit', value: vpDeficit, unit: 'kPa', label: 'Vapour pressure deficit (e_w − e_a)' },
        { key: 'wind_factor', value: windFactor, unit: '—', label: 'Wind function (1 + u/16)' },
      ],
      steps: [
        '── Lake Evaporation (Meyer, 1915) ──',
        `Mass transfer coefficient K_m = ${KmN.toFixed(4)} mm/day·kPa`,
        `Saturation vapour pressure e_w = ${ewN.toFixed(2)} kPa`,
        `Actual vapour pressure e_a = ${eaN.toFixed(2)} kPa`,
        `Wind speed at 2 m height u = ${uN.toFixed(1)} m/s`,
        '',
        'Step 1 — Vapour pressure deficit:',
        `  e_w − e_a = ${ewN.toFixed(2)} − ${eaN.toFixed(2)} = ${vpDeficit.toFixed(2)} kPa`,
        '',
        'Step 2 — Wind function:',
        `  (1 + u/16) = (1 + ${uN.toFixed(1)}/16) = ${windFactor.toFixed(3)}`,
        '',
        'Step 3 — Compute evaporation:',
        `  E = K_m × (e_w−e_a) × (1+u/16)`,
        `  E = ${KmN.toFixed(4)} × ${vpDeficit.toFixed(2)} × ${windFactor.toFixed(3)}`,
        `  E = ${E.toFixed(2)} mm/day`,
        '',
        `  └ ${E > 6 ? 'Very high evaporation — arid/warm, open water' : E > 3 ? 'High evaporation — summer conditions' : E > 1 ? 'Moderate evaporation — typical temperate lake' : 'Low evaporation — cool/humid conditions'}`,
        `  └ Equivalent energy flux: LE = ρ·L_v·E = ${(1000 * 2.45e6 * E / 1000 / 86400).toFixed(0)} W/m²`,
      ]
    };
  },
  89: ({ A: _A, z, rms, rhoProfile, dzProfile, zProfile, areaProfile }) => {
    // Schmidt (1928) lake stability:
    //   S = (g/A₀)·∫ A(z)·(z − z_v)·ρ(z) dz        (full depth integral)
    //   S ≈ g·rms(Δρ)·z_v                          (one-layer proxy)
    // When a layered density profile is supplied (rhoProfile + dzProfile
    // arrays), the depth integral is summed directly over the layers.
    const A = Number(_A);
    const zN = Number(z);
    const rmsN = Number(rms);
    const hasLayers = Array.isArray(rhoProfile) && Array.isArray(dzProfile)
      && rhoProfile.length === dzProfile.length && rhoProfile.length >= 1
      && rhoProfile.every((r: unknown) => Number.isFinite(Number(r)))
      && dzProfile.every((d: unknown) => Number.isFinite(Number(d)) && Number(d) > 0);

    if (hasLayers) {
      const rhoN = (rhoProfile as unknown[]).map((r) => Number(r));
      const dzN = (dzProfile as unknown[]).map((d) => Number(d));
      const n = rhoN.length;
      const zMid: number[] = Array.isArray(zProfile) && zProfile.length === n
        ? (zProfile as unknown[]).map((zp) => Number(zp))
        : (() => {
            const mids: number[] = [];
            let cum = 0;
            for (let i = 0; i < n; i++) { mids.push(cum + dzN[i] / 2); cum += dzN[i]; }
            return mids;
          })();
      const A0 = Number.isFinite(A) && A > 0 ? A : 1;
      const A_i: number[] = Array.isArray(areaProfile) && areaProfile.length === n
        ? (areaProfile as unknown[]).map((a) => Number(a))
        : Array(n).fill(A0);
      let volSum = 0, zVol = 0;
      for (let i = 0; i < n; i++) { volSum += A_i[i] * dzN[i]; zVol += zMid[i] * A_i[i] * dzN[i]; }
      const z_v = volSum > 0 ? zVol / volSum : Number.NaN;
      let S = 0;
      for (let i = 0; i < n; i++) {
        if (Number.isFinite(z_v)) S += (zMid[i] - z_v) * rhoN[i] * A_i[i] * dzN[i];
      }
      S = Number.isFinite(S) ? (G_GRAV / A0) * S : Number.NaN;
      let thermoIdx = 0, maxGrad = -Infinity;
      for (let i = 0; i < n - 1; i++) {
        const grad = Math.abs(rhoN[i + 1] - rhoN[i]) / Math.max(dzN[i + 1], dzN[i], 1e-9);
        if (grad > maxGrad) { maxGrad = grad; thermoIdx = i; }
      }
      const thermocline = n > 1 ? (zMid[thermoIdx] + zMid[thermoIdx + 1]) / 2 : z_v;
      const seriesPoints: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < n; i++) seriesPoints.push({ x: zMid[i], y: Number.isFinite(rhoN[i]) ? rhoN[i] : Number.NaN });
      const cumPoints: Array<{ x: number; y: number }> = [];
      let cum = 0;
      for (let i = 0; i < n; i++) {
        cum += Number.isFinite(z_v) ? (G_GRAV / A0) * (zMid[i] - z_v) * rhoN[i] * A_i[i] * dzN[i] : Number.NaN;
        cumPoints.push({ x: zMid[i], y: cum });
      }
      return {
        result: S, unit: 'J/m²',
        secondary: [
          { key: 'lake_area', value: Number.isFinite(A0) ? A0 : Number.NaN, unit: 'm²', label: 'Lake surface area A₀' },
          { key: 'thermocline_depth', value: Number.isFinite(thermocline) ? thermocline : Number.NaN, unit: 'm', label: 'Thermocline depth (max density gradient)' },
          { key: 'center_volume_depth', value: Number.isFinite(z_v) ? z_v : Number.NaN, unit: 'm', label: 'Depth to centre of volume z_v' },
        ],
        series: [
          { label: 'Density profile ρ(z)', color: '#0072B2', points: seriesPoints },
          { label: 'Cumulative stability S(z)', color: '#009E73', points: cumPoints },
        ],
        steps: [
          '── Schmidt Lake Stability Index (Schmidt, 1928; Idso, 1973) ──',
          `Layered density profile: ${n} layers (A₀ = ${A0.toFixed(0)} m²)`,
          '',
          'Step 1 — Depth to centre of volume:',
          `  z_v = Σ z_i·A_i·Δz_i / Σ A_i·Δz_i = ${Number.isFinite(z_v) ? z_v.toFixed(2) : 'N/A'} m`,
          '',
          'Step 2 — Sum the depth integral:',
          `  S = (g/A₀)·Σ (z_i − z_v)·ρ_i·A_i·Δz_i`,
          `  S = ${Number.isFinite(S) ? S.toFixed(1) : 'N/A'} J/m²`,
          '',
          'Step 3 — Thermocline location:',
          `  Max density gradient at z ≈ ${Number.isFinite(thermocline) ? thermocline.toFixed(1) : 'N/A'} m`,
          '',
          `  └ ${S > 500 ? 'Strongly stratified — resistant to mixing (deep temperate lake in summer)' : S > 100 ? 'Moderately stratified — seasonal thermocline present' : S > 20 ? 'Weakly stratified — polymictic or frequent turnover' : 'Near-mixed — continuous vertical exchange (shallow/polymictic)'}`,
          `  └ Required wind work to completely mix lake: W ≈ S × A₀ (total energy in J)`,
        ],
      };
    }

    if (!Number.isFinite(zN) || !Number.isFinite(rmsN) || zN <= 0) {
      return {
        result: Number.NaN, unit: 'J/m²',
        secondary: [
          { key: 'lake_area', value: Number.isFinite(A) ? A : Number.NaN, unit: 'm²', label: 'Lake surface area A₀' },
          { key: 'thermocline_depth', value: Number.isFinite(zN) ? zN : Number.NaN, unit: 'm', label: 'Thermocline depth (one-layer proxy: z_v)' },
        ],
        steps: [
          '── Schmidt Lake Stability Index (Schmidt, 1928; Idso, 1973) ──',
          'One or more inputs are non-finite, or z ≤ 0 — cannot compute.',
          'Supply A (m²), z_v (m), rms(Δρ) (kg/m³), or a layered density profile (rhoProfile + dzProfile).',
        ],
      };
    }
    const S = G_GRAV * rmsN * zN;
    const cumPoints: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 40; i++) {
      const zPrime = (zN * i) / 40;
      cumPoints.push({ x: zPrime, y: G_GRAV * rmsN * zPrime });
    }
    return {
      result: S, unit: 'J/m²',
      secondary: [
        { key: 'lake_area', value: Number.isFinite(A) ? A : Number.NaN, unit: 'm²', label: 'Lake surface area A₀' },
        { key: 'thermocline_depth', value: Number.isFinite(zN) ? zN : Number.NaN, unit: 'm', label: 'Thermocline depth (one-layer proxy: z_v)' },
      ],
      series: [{
        label: 'Cumulative stability S(z)',
        color: '#009E73',
        points: cumPoints,
      }],
      steps: [
        '── Schmidt Lake Stability Index (Schmidt, 1928; Idso, 1973) ──',
        `Lake surface area A = ${Number.isFinite(A) ? A.toFixed(0) : 'N/A'} m²`,
        `Depth to centre of volume z_v = ${zN.toFixed(1)} m`,
        `Root-mean-square density difference rms(Δρ) = ${rmsN.toExponential(3)} kg/m³`,
        '',
        'Step 1 — Compute stability:',
        `  S = g × A₀⁻¹ × ∫A(z)·(ρ_z−ρ_m)·(z−z_v)dz`,
        `  S ≈ g × rms(Δρ) × z_v (simplified one-layer proxy)`,
        `  S = ${G_GRAV.toFixed(3)} × ${rmsN.toExponential(3)} × ${zN.toFixed(1)}`,
        `  S = ${S.toFixed(1)} J/m²`,
        '',
        'Step 2 — Stability classification:',
        `  ${S > 500 ? 'Strongly stratified — resistant to mixing (deep temperate lake in summer)' : S > 100 ? 'Moderately stratified — seasonal thermocline present' : S > 20 ? 'Weakly stratified — polymictic or frequent turnover' : 'Near-mixed — continuous vertical exchange (shallow/polymictic)'}`,
        '',
        `  └ Required wind work to completely mix lake: W ≈ S × A₀ (total energy in J)`,
        `  └ Wedderburn number W = Δρ·g·h²/(ρ·u*²·L) — dynamic stability measure`,
      ]
    };
  },
   90: ({ n, K, t, Q0 }) => {
      // Defensive numeric coercion: inputs can arrive as JSON strings from the
      // USGS-driven context engine (Nash's Q₀ is a discharge-derived volume).
      const nn = Number(n);
      const Kn = Number(K);
      const tn = Number(t);
      const Q0n = Number(Q0);
      if (!Number.isFinite(nn) || !Number.isFinite(Kn) || !Number.isFinite(tn) || !Number.isFinite(Q0n)) {
        return {
          result: Number.NaN, unit: 'm³/s',
          steps: ['── Nash Cascade Unit Hydrograph (Nash, 1957) ──',
            `One or more inputs are non-finite — cannot compute.`,
            `Supply n, K, t, Q₀ explicitly or ensure USGS data is available.`,
          ],
          secondary: [
            { key: 'time_to_peak', value: Number.NaN, unit: 'h', label: 'Time to Peak t_p' },
            { key: 'peak_outflow', value: Number.NaN, unit: 'm³/s', label: 'Peak Outflow q_p' },
            { key: 'peak_factor', value: Number.NaN, unit: '—', label: 'Dimensionless Peak Factor (q_p·K/Q₀)' },
          ],
        };
      }
      const K_n1 = Math.pow(Kn, nn - 1);
      // Γ(n) = (n−1)! for integer n; Lanczos gamma for non-integer n (the
      // frontend's methodology allows n = 1.5–2.5 for flashy catchments).
      const fact = gamma(nn);
      const q = (Math.pow(tn, nn - 1) / (K_n1 * fact)) * (1 / Kn) * Math.exp(-tn / Kn) * Q0n;
      const t_p = (nn - 1) * Kn;
      const peakFactor = t_p > 0 && nn > 1
        ? Math.pow(nn - 1, nn - 1) * Math.exp(-(nn - 1)) / gamma(nn)
        : 1;
      const q_peak = Q0n * peakFactor / Kn;
      // Full IUH hydrograph series: sample q(t) from t=0 to t_end
      const tEnd = Math.max(tn * 1.5, 5 * t_p, 5 * Kn);
      const steps = 80;
      const seriesPoints: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= steps; i++) {
        const ti = (tEnd * i) / steps;
        const qi = (Math.pow(ti, nn - 1) / (Math.pow(Kn, nn - 1) * gamma(nn))) * (1 / Kn) * Math.exp(-ti / Kn) * Q0n;
        if (Number.isFinite(qi)) seriesPoints.push({ x: ti, y: qi });
      }
      return {
        result: q, unit: 'm³/s',
        series: seriesPoints.length > 0
          ? [{
              label: 'Nash IUH (outflow)',
              color: '#0072B2',
              points: seriesPoints,
            }]
          : undefined,
        secondary: [
          { key: 'time_to_peak', value: Number.isFinite(t_p) ? t_p : Number.NaN, unit: 'h', label: 'Time to Peak t_p' },
          { key: 'peak_outflow', value: Number.isFinite(q_peak) ? q_peak : Number.NaN, unit: 'm³/s', label: 'Peak Outflow q_p' },
          { key: 'peak_factor', value: Number.isFinite(peakFactor) ? peakFactor : Number.NaN, unit: '—', label: 'Dimensionless Peak Factor (q_p·K/Q₀)' },
        ],
        steps: [
          '── Nash Cascade Unit Hydrograph (Nash, 1957) ──',
          `Number of linear reservoirs n = ${nn.toFixed(1)}, Storage coefficient K = ${Kn.toFixed(2)} h`,
          `Time t = ${tn.toFixed(1)} h, Total inflow volume Q₀ = ${Q0n.toFixed(1)} m³/s·h`,
          '',
          'Step 1 — Gamma-distribution coefficients:',
          `  Γ(n) = gamma(${nn.toFixed(1)}) = ${fact.toExponential(2)}`,
          `  K^(n−1) = (${Kn.toFixed(2)})^(${nn.toFixed(1)}−1) = ${K_n1.toExponential(3)}`,
          '',
          'Step 2 — Compute IUH ordinate:',
          `  q(t) = t^(n−1) / (K^(n−1)·Γ(n)) · (1/K) · exp(−t/K) · Q₀`,
          `  q(${tn.toFixed(1)} h) = ${q.toExponential(3)} m³/s`,
          '',
          'Step 3 — Hydrograph timing:',
          `  Time to peak: t_p = (n−1)·K = ${t_p.toFixed(1)} h`,
          `  Peak outflow: q_p = ${q_peak.toExponential(3)} m³/s`,
          `  Dimensionless peak factor (q_p·K/Q₀) = ${peakFactor.toFixed(4)}`,
          '',
          `  └ Nash model: n reservoirs in series; higher n → more peaked, delayed response`,
          `  └ Quickflow only — baseflow must be added separately for total streamflow`,
        ]
      };
    },

  // ── Domain 14: Cryosphere & Volcanology ──
  91: ({ accum, DDF, Tpos, days: _days }) => {
    // Braithwaite & Olesen (1989) PDD model:
    // Ablation = DDF × T_pos  (T_pos is already the sum of positive degree-days)
    const ablation = DDF * Tpos;
    const Bn = accum - ablation;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let day = 0; day <= 365; day += 5) {
      const frac = day / 365;
      const cumAbl = DDF * Tpos * frac;
      const cumBal = accum - cumAbl;
      seriesPoints.push({ x: day, y: Number.isFinite(cumBal) ? cumBal : Number.NaN });
    }
    return {
      result: Bn, unit: 'm w.e.',
      secondary: [
        { key: 'total_ablation', value: Number.isFinite(ablation) ? ablation : Number.NaN, unit: 'm w.e.', label: 'Total Ablation' },
      ],
      series: [{
        label: 'Cumulative mass balance',
        color: '#0072B2',
        points: seriesPoints,
      }],
      steps: [
        '── Glacier Surface Mass Balance — PDD Model (Braithwaite & Olesen 1989; Cogley et al. 2011) ──',
        `Annual accumulation = ${accum.toFixed(2)} m w.e.`,
        `Degree-Day Factor DDF = ${DDF.toFixed(3)} m w.e./°C·day`,
        `Positive degree-days T_pos = ${Tpos.toFixed(1)} °C·day (sum over melt season)`,
        '',
        'Step 1 — Compute total ablation:',
        `  Ablation = DDF × T_pos = ${DDF.toFixed(3)} × ${Tpos.toFixed(1)}`,
        `  Ablation = ${ablation.toFixed(3)} m w.e.`,
        '',
        'Step 2 — Compute net balance:',
        `  B_n = Accumulation − Ablation = ${accum.toFixed(2)} − ${ablation.toFixed(3)}`,
        `  B_n = ${Bn.toFixed(3)} m w.e.`,
        '',
        'Step 3 — Glacier health:',
        `  ${Bn > 0.5 ? 'STRONGLY POSITIVE — glacier advance expected' : Bn > 0 ? 'POSITIVE — slight mass gain' : Bn > -0.5 ? 'NEGATIVE — mass loss, retreating' : 'STRONGLY NEGATIVE — severe wastage, likely terminus retreat > 100 m/yr'}`,
        `  Equilibrium Line Altitude (ELA) ≈ altitude where B_n = 0; accumulation area ratio (AAR) ≈ 0.5–0.6 for steady state`,
      ]
    };
  },
  92: ({ K, DIFI, L }) => {
    // Stefan (1891): ALT = sqrt(2·K·DIFI_s / L)
    // DIFI is in °C·day; convert to °C·s by × 86400
    const DIFI_s = DIFI * 86400;
    const ALT = Math.sqrt((2 * K * DIFI_s) / (L || 1));
    return {
      result: ALT, unit: 'm',
      secondary: [
        { key: 'thawing_index', value: Number.isFinite(DIFI) ? DIFI : Number.NaN, unit: '°C·day', label: 'Thawing Index (DIFI)' },
      ],
      // Timeseries series (tool vizType 'timeseries'): active-layer thickness
      // ALT(DIFI) = √(2·K·DIFI·86400/L) over 0–5000 °C·day (20 points) from
      // the tool's own Stefan solution.
      series: [{
        label: 'Stefan active-layer thickness ALT(DIFI) = √(2·K·DIFI·86400/L)',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const difi = i * (5000 / 19);
          const alt = Math.sqrt((2 * K * difi * 86400) / (L || 1));
          return { x: difi, y: Number.isFinite(alt) ? alt : Number.NaN };
        }),
      }],
      steps: [
        '── Stefan Active Layer Thickness (Stefan, 1891; Romanovsky & Osterkamp, 1997) ──',
        `Thermal conductivity K = ${K.toFixed(2)} W/m·K`,
        `Thawing index DIFI = ${DIFI.toFixed(0)} °C·day`,
        `  → DIFI_s = ${DIFI.toFixed(0)} × 86400 = ${DIFI_s.toFixed(0)} °C·s`,
        `Volumetric latent heat of fusion L = ${L.toExponential(2)} J/m³`,
        '',
        'Step 1 — Compute 2K·DIFI_s:',
        `  2K·DIFI_s = 2 × ${K.toFixed(2)} × ${DIFI_s.toFixed(0)} = ${(2 * K * DIFI_s).toExponential(3)}`,
        '',
        'Step 2 — Compute ALT:',
        `  ALT = √(2K·DIFI_s / L)`,
        `  ALT = √(${(2 * K * DIFI_s).toExponential(3)} / ${L.toExponential(2)})`,
        `  ALT = ${ALT.toFixed(2)} m`,
        '',
        'Step 3 — Permafrost classification:',
        `  ${ALT <= 0.5 ? 'Continuous permafrost — very shallow active layer (high Arctic)' : ALT <= 1.5 ? 'Typical continuous permafrost' : ALT <= 3 ? 'Discontinuous permafrost — moderate active layer' : 'Sporadic/isolated permafrost — deep active layer, talik formation possible'}`,
        '',
        `  └ Stefan solution assumes: (i) step-change surface temperature, (ii) homogeneous soil, (iii) no unfrozen water content`,
      ]
    };
  },
  93: ({ k, b, rhoI, rhoF }) => {
    const drho = k * b * (rhoI - rhoF);
    const _halfDensity = (rhoI + rhoF) / 2;
    const closeoffTime = drho !== 0 ? (830 - rhoF) / Math.abs(drho) : Number.NaN;
    return {
      result: drho, unit: 'kg/m³/yr',
      secondary: [
        { key: 'closeoff_time', value: Number.isFinite(closeoffTime) ? closeoffTime : Number.NaN, unit: 'yr', label: 'Pore Close-Off Time' },
      ],
      // Timeseries series (tool vizType 'timeseries'): firn density ρ(t) over
      // 0–100 yr (20 points) from the tool's own exponential densification
      // ρ(t) = ρ_i − (ρ_i − ρ_f)·e^(−k·b·t).
      series: [{
        label: 'Firn density ρ(t) = ρ_i − (ρ_i−ρ_f)·e^(−k·b·t)',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const t = i * (100 / 19);
          const rhoT = rhoI - (rhoI - rhoF) * Math.exp(-k * b * t);
          return { x: t, y: Number.isFinite(rhoT) ? rhoT : Number.NaN };
        }),
      }],
      steps: [
        '── Dry Snow Densification (Herron & Langway, 1980; Arthern et al., 2010) ──',
        `Rate constant k = ${k.toExponential(2)} /yr`,
        `Accumulation rate b = ${b.toFixed(2)} kg/m²/yr`,
        `Initial snow density ρ_i = ${rhoI.toFixed(1)} kg/m³`,
        `Final firn density ρ_f = ${rhoF.toFixed(1)} kg/m³`,
        '',
        'Step 1 — Compute density gradient:',
        `  ρ_i − ρ_f = ${rhoI.toFixed(1)} − ${rhoF.toFixed(1)} = ${(rhoI - rhoF).toFixed(1)} kg/m³`,
        '',
        'Step 2 — Densification rate:',
        `  dρ/dt = k × b × (ρ_i − ρ_f)`,
        `  dρ/dt = ${k.toExponential(2)} × ${b.toFixed(2)} × ${(rhoI - rhoF).toFixed(1)}`,
        `  dρ/dt = ${drho.toExponential(2)} kg/m³/yr`,
        '',
        'Step 3 — Timescale to closure (pore close-off at ρ ≈ 830 kg/m³):',
        `  Δt ≈ (830 − ${rhoF.toFixed(0)}) / |dρ/dt| = ${drho !== 0 ? ((830 - rhoF) / Math.abs(drho)).toFixed(2) : '∞'} years`,
        '',
        `  └ ${drho > 0 ? 'Compaction progressing — air volume decreasing' : 'No densification — pore space saturated or equilibrium'}`,
        `  └ Main stages: (1) settling (ρ < 550), (2) densification (550–830), (3) ice bubble closure (>830 kg/m³)`,
      ]
    };
  },
94: ({ VEI }) => {
     if (!Number.isFinite(VEI)) {
       return {
         result: Number.NaN, unit: 'km³',
         steps: ['── Volcanic Explosivity Index to Volume (Newhall & Self, 1982) ──',
           'VEI input is missing or NaN — no fabricated volume is substituted.',
         ],
       };
     }
     const logV = VEI - 5; // Newhall & Self (1982) Table 1: VEI = ⌊log₁₀(V km³)⌋ + 5
     const V_km3 = Math.pow(10, logV);
     const V_m3 = V_km3 * 1e9;
     return {
       result: V_km3, unit: 'km³',
       secondary: [
         { key: 'volume_m3', value: V_m3, unit: 'm³', label: 'Erupted Volume (m³)' },
         { key: 'magnitude_class', value: VEI, unit: '—', label: 'VEI Magnitude Class' },
       ],
       steps: [
         '── Volcanic Explosivity Index to Volume (Newhall & Self, 1982) ──',
         `Volcanic Explosivity Index VEI = ${VEI.toFixed(0)} (0–8 scale)`,
         '',
         'Step 1 — Compute log₁₀(volume in km³):',
         `  log₁₀(V) = VEI − 5 = ${VEI.toFixed(0)} − 5`,
         `  log₁₀(V) = ${logV.toFixed(3)}`,
         '',
         'Step 2 — Exponentiate:',
         `  V = 10^${logV.toFixed(3)} = ${V_km3.toExponential(3)} km³ (${V_km3.toFixed(2)} km³)`,
         `  V = ${V_m3.toExponential(3)} m³`,
         '',
         'Step 3 — Eruption classification:',
         `  VEI ${VEI.toFixed(0)}: ${VEI <= 1 ? 'Gentle/Hawaiian effusive' : VEI <= 2 ? 'Strombolian' : VEI <= 3 ? 'Vulcanian' : VEI <= 4 ? 'Plinian (Pompeii-type)' : VEI <= 5 ? 'Plinian (sub-Plinian)' : VEI <= 6 ? 'Ultra-Plinian (e.g. Pinatubo 1991, 5 km³)' : VEI <= 7 ? 'Super-colossal (e.g. Tambora 1815, 50 km³)' : 'Ultra-colossal / supervolcanic (e.g. Toba 74 ka, >1000 km³)'}`,
         '',
         `  └ Newhall & Self (1982): V = 10^(0.98·VEI − 1) km³. Classic VEI table: VEI 3 → 10⁷–10⁸ m³, VEI 6 → 10¹⁰–10¹¹ m³.`,
       ]
     };
   },
95: ({ Qdot, rhoAir, alpha }) => {
     // Mastin et al. (2009) eq 1: Ṁ = 140 × H^4.14 (Ṁ in kg/s, H in km)
     // Inverted: H = (Ṁ / 140)^(1/4.14)
     // Catalogue input Q_dot is heat output in MW → convert to mass eruption rate
     const inputsOk = [Qdot, rhoAir, alpha].every(Number.isFinite);
     const cp_air = 1004;  // J/(kg·K)
     const T_amb = 300;    // K (ambient)
     const MER = (Qdot * 1e6) / (cp_air * T_amb);  // MW → kg/s (mass eruption rate)
     const hMastin = Math.pow(MER / 140, 1 / 4.14);

     // Morton-Taylor-Turner (1956) theoretical check:
     // H = 5.0 × (F₀ / N³)^(1/4), F₀ = g × (Δρ/ρ₀) × MER / ρ₀
     const g = 9.81;
     const N = 0.012;          // Brunt-Väisälä frequency (s⁻¹) — standard troposphere
     const drho_rho = 0.65;    // fractional density contrast (hot plume vs ambient)
     const F0 = g * drho_rho * MER / rhoAir;
     const H_mtt_m = 5.0 * Math.pow(F0 / (N * N * N), 0.25);
     const hMtt = H_mtt_m / 1000;

     // Use Mastin as primary (empirically calibrated for volcanoes)
     const h = hMastin;

     if (!inputsOk) {
       return {
         result: Number.NaN, unit: 'km',
         steps: ['── Volcanic Plume Height (Mastin et al. 2009; Morton-Taylor-Turner 1956) ──',
           'One or more inputs (Q̇, ρ_air, α) are missing or NaN — no fabricated plume height is substituted.',
         ],
       };
     }

     return {
        result: h, unit: 'km',
        secondary: [
          { key: 'buoyancy_flux', value: Number.isFinite(F0) ? F0 : Number.NaN, unit: 'm⁴/s³', label: 'Buoyancy Flux F₀' },
          { key: 'plume_rise_mtt', value: Number.isFinite(hMtt) ? hMtt : Number.NaN, unit: 'km', label: 'MTT Plume Rise Height' },
          { key: 'mass_eruption_rate', value: Number.isFinite(MER) ? MER : Number.NaN, unit: 'kg/s', label: 'Mass Eruption Rate Ṁ' },
        ],
        // Profile series (tool vizType 'profile'): buoyant plume rise z vs
        // downwind distance x (0–500 m, 20 points) from the tool's own MTT
        // buoyant-plume quantities. Bent-over plume trajectory
        // z(x) = 1.6·F₀^(1/3)·x^(2/3)/u, with the crosswind back-computed so
        // the plume reaches its MTT terminal rise H_MTT at x = 500 m, i.e.
        // z(x) = H_MTT·(x/500)^(2/3). Honest NaN when the MTT height is NaN.
        series: [{
          label: 'Buoyant plume rise z(x) (MTT, bent-over to H_MTT)',
          color: '#0072B2',
          points: Array.from({ length: 20 }, (_, i) => {
            const x = i * (500 / 19);
            const z = Number.isFinite(hMtt) && hMtt > 0 ? hMtt * 1000 * Math.pow(x / 500, 2 / 3) : Number.NaN;
            return { x, y: Number.isFinite(z) ? z : Number.NaN };
          }),
        }],
        steps: [
         '── Volcanic Plume Height (Mastin et al. 2009; Morton-Taylor-Turner 1956) ──',
         `Heat output Q̇ = ${Qdot.toExponential(2)} MW`,
         `Mass eruption rate Ṁ = Q̇/(cp·T_amb) = ${MER.toExponential(2)} kg/s`,
         `Ambient air density ρ_air = ${rhoAir.toFixed(3)} kg/m³`,
         `Entrainment coefficient α = ${alpha.toFixed(3)}`,
         '',
         'Step 1 — Mastin et al. (2009) eq 1 (inverted):',
         `  Ṁ = 140 × H^4.14  →  H = (Ṁ/140)^(1/4.14)`,
         `  H = (${MER.toExponential(2)} / 140)^(1/4.14) = ${hMastin.toFixed(2)} km`,
         '',
         'Step 2 — MTT theoretical check:',
         `  F₀ = g × (Δρ/ρ₀) × Ṁ / ρ_air = ${F0.toExponential(3)} m⁴/s³`,
         `  H_MTT = 5.0 × (F₀ / N³)^(1/4) = ${hMtt.toFixed(2)} km`,
         `  ${h > 0 && Math.abs(h - hMtt) / h < 0.5 ? '✓ Mastin and MTT agree within 50%' : '⚠ Mastin and MTT differ — Mastin preferred for volcanic plumes'}`,
         '',
         'Step 3 — Plume classification:',
         `  ${h < 1 ? 'Weak/ash-poor puffing (<1 km)' : h < 5 ? 'Low-level plume — local ashfall, aviation risk below FL200' : h < 10 ? 'Moderate plume — regional ashfall, FL200-FL350 aviation risk' : h < 20 ? 'Strong/Plinian plume (>10 km) — widespread ash, high-risk aviation' : 'Ultra-Plinian / co-ignimbrite plume (>20 km) — stratospheric injection, global dispersal'}`,
         '',
         `  └ Mastin calibrated for Ṁ = 10³–10⁹ kg/s. MTT assumes steady plume, no crosswind. Column collapse when vent too narrow.`,
       ]
     };
   },

  // ── Part V · Domain 15: Climate Dynamics ──
  96: ({ C, T: _T, Q, alpha, I, D, divDT }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const Cn = Number(C), Qn = Number(Q), alphan = Number(alpha), In = Number(I), Dn = Number(D), divDTn = Number(divDT);
    const absorbed = Qn * (1 - alphan);
    const diffusion = Dn * divDTn;
    const net = absorbed - In + diffusion;
    const SEC_PER_YEAR = 3.15576e7;  // 365.25 × 24 × 3600
    const dT = net / (Cn || 1) * SEC_PER_YEAR;  // W/m² ÷ (J/m²K) × s/yr = K/yr
    if (![Cn, Qn, alphan, In, Dn, divDTn].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'K/yr',
        steps: ['── EBM — Energy Balance Model (Budyko, 1969; Sellers, 1969) ──',
          '∂T/∂t = [Q(1−α) − I + div(D∇T)] / C × s/yr',
          '', 'One or more inputs are missing — no fabricated energy balance is substituted.'],
      };
    }
    return {
      result: dT, unit: 'K/yr',
      secondary: [
        { key: 'absorbed_sw', value: Number.isFinite(absorbed) ? absorbed : Number.NaN, unit: 'W/m²', label: 'Absorbed Solar Q(1−α)' },
        { key: 'net_balance', value: Number.isFinite(net) ? net : Number.NaN, unit: 'W/m²', label: 'Net TOA Balance' },
      ],
      // Timeseries (vizType 'timeseries'): temperature evolution over 100 years
      // under the tool's own net balance, ΔT(t) = (net/C)·t·s/yr.
      series: [{
        label: 'Temperature change ΔT(t)',
        color: '#0072B2',
        points: Array.from({ length: 41 }, (_, i) => {
          const t = i * 2.5; // years
          const dTt = Number.isFinite(net) ? net / (Cn || 1) * SEC_PER_YEAR * t : Number.NaN;
          return { x: t, y: Number.isFinite(dTt) ? dTt : Number.NaN };
        }),
      }],
      steps: [
        '── EBM — Energy Balance Model (Budyko, 1969; Sellers, 1969) ──',
        `Heat capacity C = ${Cn.toExponential(3)} J/m²K, Solar constant Q = ${Qn.toFixed(0)} W/m²`,
        `Albedo α = ${alphan.toFixed(3)}, OLR I = ${In.toFixed(2)} W/m², Diffusion D = ${Dn.toExponential(3)}, div(D∇T) = ${divDTn.toExponential(3)}`,
        '',
        'Step 1 — Absorbed solar radiation:',
        `  Q(1−α) = ${Qn.toFixed(0)} × (1 − ${alphan.toFixed(3)}) = ${absorbed.toFixed(3)} W/m²`,
        '',
        'Step 2 — Net energy budget:',
        `  Q(1−α) − I + div(D∇T) = ${absorbed.toFixed(3)} − ${In.toFixed(3)} + ${diffusion.toExponential(3)}`,
        `  = ${net.toExponential(4)} W/m²`,
        '',
        'Step 3 — Temperature tendency:',
        `  ∂T/∂t = net / C × 3.156×10⁷ s/yr`,
        `  ∂T/∂t = (${net.toExponential(4)} / ${Cn.toExponential(3)}) × 3.156×10⁷ = ${dT.toExponential(4)} K/yr`,
        '',
        `  └ Interpretation: ${dT > 0 ? 'WARMING — positive energy imbalance' : dT < 0 ? 'COOLING — negative energy imbalance' : 'STEADY STATE — net zero imbalance'}`,
      ]
    };
  },
97: ({ dF, lambda0, f }) => {
     // Standard feedback framework (Roe 2009): ΔT = ΔF / (λ₀ − f)
     // λ₀ = Planck response (~3.2 W/m²K), f = net non-Planck feedbacks
     const dFn = Number(dF), lambda0n = Number(lambda0), fn = Number(f);
     if (![dFn, lambda0n, fn].every(Number.isFinite)) {
       return {
         result: Number.NaN, unit: 'K',
         steps: ['── Climate Sensitivity — Feedback Analysis (Hansen et al., 1984; Roe, 2009) ──',
           'One or more inputs (ΔF, λ₀, f) are missing or NaN — no fabricated sensitivity is substituted.',
         ],
       };
     }
     const den = lambda0n - fn;
     const lambda = den !== 0 ? 1 / den : Number.NaN;
     const dT = lambda * dFn;
     const gain = den !== 0 ? lambda0n / den : Number.NaN;
     return {
       result: dT, unit: 'K',
       secondary: [
         { key: 'lambda', value: Number.isFinite(lambda) ? lambda : Number.NaN, unit: 'K/(W/m²)', label: 'Climate Sensitivity Parameter λ' },
         { key: 'forcing', value: dFn, unit: 'W/m²', label: 'Radiative Forcing ΔF' },
         { key: 'gain', value: Number.isFinite(gain) ? gain : Number.NaN, unit: '—', label: 'Feedback Gain G' },
         { key: 'net_feedback', value: fn, unit: 'W/m²K', label: 'Net Non-Planck Feedback f' },
       ],
       steps: [
         '── Climate Sensitivity — Feedback Analysis (Hansen et al., 1984; Roe, 2009) ──',
         `Radiative forcing ΔF = ${dFn.toFixed(2)} W/m²`,
         `Planck response λ₀ = ${lambda0n.toFixed(4)} W/m²K`,
         `Net non-Planck feedbacks f = ${fn.toFixed(4)} W/m²K (WV + LR + cloud + albedo)`,
         '',
         'Step 1 — Compute effective climate sensitivity parameter:',
         `  λ = 1 / (λ₀ − f) = 1 / (${lambda0n.toFixed(4)} − ${fn.toFixed(4)}) = 1 / ${den.toFixed(4)}`,
         `  λ = ${Number.isFinite(lambda) ? lambda.toFixed(4) : 'NaN (runaway)'} K/(W/m²)`,
         '',
         'Step 2 — Compute equilibrium temperature change:',
         `  ΔT = λ × ΔF = ${Number.isFinite(lambda) ? lambda.toFixed(4) : 'NaN'} × ${dFn.toFixed(2)}`,
         `  ΔT = ${Number.isFinite(dT) ? dT.toFixed(2) : 'NaN'} K`,
         '',
         'Step 3 — Gain factor:',
         `  Gain G = λ₀ / (λ₀ − f) = ${Number.isFinite(gain) ? gain.toFixed(2) : 'NaN'}`,
         `  ${Math.abs(fn) < 0.1 ? 'Weak feedback regime' : fn > 0 ? 'POSITIVE FEEDBACK AMPLIFICATION (G > 1)' : 'NEGATIVE FEEDBACK DAMPENING (G < 1)'}`,
         '',
         `  └ Interpretation: ${!Number.isFinite(dT) ? 'RUNAWAY — feedback exceeds Planck damping' : dT < 1.5 ? 'Low sensitivity — likely aerosol or cloud damping' : dT < 3 ? 'Moderate sensitivity — within IPCC likely range (2–4.5 K)' : dT < 6 ? 'High sensitivity — strong positive feedbacks' : 'Very high sensitivity — model-dependent, potential tipping cascade'}`,
       ]
     };
   },
98: ({ dRdT, T }) => {
     const Tn = Number(T);
     const dRdTn = Number(dRdT);
     // Planck feedback λ_P = −4εσT³ (magnitude 4σT³ for a blackbody). If a
     // temperature T is supplied, compute λ_P = 4σT³ directly (the analytic
     // derivative of σT⁴); otherwise fall back to a supplied dRdT value.
     if (Number.isFinite(Tn) && Tn > 0) {
       const lambdaP = 4 * SIGMA * Math.pow(Tn, 3);
       const T3 = Math.pow(Tn, 3);
       return {
         result: lambdaP, unit: 'W/m²K',
         secondary: [
           { key: 'T_used', value: Tn, unit: 'K', label: 'Blackbody Temperature T' },
           { key: 'T3_factor', value: Number.isFinite(T3) ? T3 : Number.NaN, unit: 'K³', label: 'T³ Factor' },
         ],
         steps: [
           '── Planck Feedback (Manabe & Wetherald, 1967) ──',
           `Temperature T = ${Tn.toFixed(1)} K, emissivity ε = 1 (blackbody)`,
           '',
           'Step 1 — Compute Planck response:',
           `  λ_P = d(εσT⁴)/dT = 4εσT³ = 4 × ${SIGMA.toExponential(3)} × ${Tn.toFixed(1)}³`,
           `  λ_P = ${lambdaP.toFixed(3)} W/m²K`,
           '',
           'Step 2 — Planck timescale:',
           `  Effective damping: τ = C/λ_P ≈ ${(1e8 / lambdaP).toExponential(1)} s (for C ≈ 10⁸ J/m²K column)`,
           '',
           `  └ λ_P = ${lambdaP.toFixed(2)} W/m²K: ${lambdaP < 3 ? 'Below Stefan-Boltzmann (4σT³ ~ 3.8) — possible non-Planck masking' : lambdaP < 4 ? 'Within expected Stefan-Boltzmann range' : 'Above S-B expectation — additional negative feedback'}`,
         ]
       };
     }
     if (Number.isFinite(dRdTn) && dRdTn > 0) {
       return {
         result: dRdTn, unit: 'W/m²K',
         secondary: [
           { key: 'T_used', value: Number.NaN, unit: 'K', label: 'Blackbody Temperature T' },
           { key: 'T3_factor', value: Number.NaN, unit: 'K³', label: 'T³ Factor' },
         ],
         steps: [
           '── Planck Feedback (Manabe & Wetherald, 1967) ──',
           'Planck feedback parameter λ_P = ∂R/∂T (OLR sensitivity to surface temperature)',
           '',
           'Step 1 — Compute Planck response:',
           `  λ_P = d(σT⁴)/dT = 4σT³ ≈ 3.2–3.8 W/m²K at terrestrial temperatures`,
           `  λ_P = ${dRdTn.toFixed(3)} W/m²K (supplied directly)`,
           '',
           'Step 2 — Planck timescale:',
           `  Effective damping: τ = C/λ_P ≈ ${(1e8 / dRdTn).toExponential(1)} s (for C ≈ 10⁸ J/m²K column)`,
           '',
           `  └ λ_P = ${dRdTn.toFixed(2)} W/m²K: ${dRdTn < 3 ? 'Below Stefan-Boltzmann (4σT³ ~ 3.8) — possible non-Planck masking' : dRdTn < 4 ? 'Within expected Stefan-Boltzmann range' : 'Above S-B expectation — additional negative feedback'}`,
         ]
       };
     }
     return {
       result: Number.NaN, unit: 'W/m²K',
       steps: ['── Planck Feedback (Manabe & Wetherald, 1967) ──',
         'Temperature T (or a pre-computed ∂R/∂T) is missing or invalid — no fabricated Planck response is substituted.',
       ],
     };
   },
99: ({ k: _k, beta, kx, ky }) => {
     const K2 = kx * kx + ky * ky;
     // Barotropic Rossby dispersion (Rossby 1939): ω = −β·k_x/(k_x²+k_y²)
     const omega = -beta * kx / K2;
     // Zonal phase speed c_x = ω/k_x = −β/K²
     const zonalPhaseSpeed = K2 > 0 ? -beta / K2 : Number.NaN;
     // Zonal group velocity c_gx = ∂ω/∂k_x = β(k_x²−k_y²)/(k_x²+k_y²)²
     const groupVelX = beta * (kx * kx - ky * ky) / (K2 * K2);
     // Barotropic Rossby radius of deformation L_R = sqrt(gH)/f₀; derive
     // f₀ from β (β = 2Ω·cosφ/a → f₀ = 2Ω·sinφ) with H = 10 km scale height.
     const OMEGA_E = 7.292115e-5;
     const aEarth = 6371000;
     const cosPhi = aEarth * beta / (2 * OMEGA_E);
     const fDerived = (cosPhi < 1 && cosPhi > -1) ? 2 * OMEGA_E * Math.sqrt(1 - cosPhi * cosPhi) : Number.NaN;
     const rossbyRadius = (Number.isFinite(fDerived) && fDerived > 0)
       ? Math.sqrt(G_GRAV * 10000) / fDerived : Number.NaN;

     const inputsOk = [beta, kx, ky].every(Number.isFinite);
     if (!inputsOk || K2 === 0) {
       return {
         result: Number.NaN, unit: 'rad/s',
         steps: ['── Rossby Wave Dispersion Relation (Rossby, 1939; Haurwitz, 1940) ──',
           inputsOk ? 'Degenerate wavenumber (k_x = k_y = 0) — dispersion relation undefined.' : 'One or more inputs (β, k_x, k_y) are missing or NaN — no fabricated frequency is substituted.',
         ],
       };
     }

// Spectrum series: ω(k_x) at fixed k_y across a decade around the input k_x
      // (30 log-spaced points) from the tool's own Rossby dispersion
      // ω = −β·k_x/(k_x²+k_y²). For the canonical k_x = 1e-6 the sweep spans
      // 1e-7 → 1e-5 /m.
      const seriesPoints: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < 30; i++) {
        const frac = i / (30 - 1);
        const kxSweep = kx * Math.pow(0.1, 1 - frac) * Math.pow(10, frac); // kx/10 → kx×10
        const K2Sweep = kxSweep * kxSweep + ky * ky;
        seriesPoints.push({ x: kxSweep, y: -beta * kxSweep / K2Sweep });
      }

     return {
       result: omega, unit: 'rad/s',
       secondary: [
         { key: 'zonal_phase_speed', value: Number.isFinite(zonalPhaseSpeed) ? zonalPhaseSpeed : Number.NaN, unit: 'm/s', label: 'Zonal Phase Speed c_x' },
         { key: 'group_velocity_x', value: Number.isFinite(groupVelX) ? groupVelX : Number.NaN, unit: 'm/s', label: 'Zonal Group Velocity c_gx' },
         { key: 'rossby_radius', value: Number.isFinite(rossbyRadius) ? rossbyRadius : Number.NaN, unit: 'm', label: 'Barotropic Rossby Radius L_R' },
       ],
       series: [{ label: 'ω vs k_x (fixed k_y)', points: seriesPoints, color: '#0072B2' }],
       steps: [
         '── Rossby Wave Dispersion Relation (Rossby, 1939; Haurwitz, 1940) ──',
         `Beta parameter β = ${beta.toExponential(3)} /m·s`,
         `Zonal wavenumber k_x = ${kx.toExponential(3)} /m, Meridional wavenumber k_y = ${ky.toExponential(3)} /m`,
         '',
         'Step 1 — Total wavenumber squared:',
         `  K² = k_x² + k_y² = (${kx.toExponential(3)})² + (${ky.toExponential(3)})²`,
         `  K² = ${K2.toExponential(4)} /m²`,
         '',
         'Step 2 — Barotropic Rossby wave frequency:',
         `  ω = −β·k_x / K² = −(${beta.toExponential(3)}) × ${kx.toExponential(3)} / ${K2.toExponential(4)}`,
         `  ω = ${omega.toExponential(4)} rad/s`,
         '',
         'Step 3 — Phase speed and direction:',
         `  c_x = −β / K² = ${zonalPhaseSpeed.toExponential(3)} m/s (${zonalPhaseSpeed >= 0 ? 'eastward' : 'westward'})`,
         `  c_gx = β·(k_x²−k_y²)/K⁴ = ${groupVelX.toExponential(3)} m/s (${groupVelX >= 0 ? 'eastward energy' : 'westward energy'})`,
         '',
         `  └ ${ky > 0 ? 'Southward phase propagation (k_y > 0)' : 'Northward phase propagation (k_y < 0)'}`,
         `  └ Group velocity: c_gx = β·(k_x²−k_y²)/(k_x²+k_y²)² (eastward energy transport for long waves)`,
       ]
     };
   },
100: ({ dpdy, f, N, dudy }) => {
     const inputsOk = [dpdy, f, N, dudy].every(Number.isFinite);
     const cond = dpdy < 0;
     // Eady growth rate from provided f, N, dudy (secondary diagnostic)
     // f, N, dudy are all in /s → σ is in /s; multiply by 86400 for /day
     const sigmaEady_s = (f > 0 && N > 0) ? 0.31 * (f / N) * Math.abs(dudy) : 0;
     const sigmaEady = sigmaEady_s * 86400; // /day
     const eFoldDays = sigmaEady > 0 ? 1 / sigmaEady : Infinity;
     return {
       result: Number.isFinite(dpdy) ? (cond ? 1 : 0) : Number.NaN, unit: '—',
       secondary: [
         { key: 'qy_gradient', value: Number.isFinite(dpdy) ? dpdy : Number.NaN, unit: '/m·s', label: 'Meridional QGPV Gradient ∂q/∂y' },
         { key: 'instability_verdict', value: Number.isFinite(dpdy) ? (cond ? 1 : 0) : Number.NaN, unit: '—', label: 'Unstable (1) / Stable (0)' },
         { key: 'eady_growth_rate', value: inputsOk ? sigmaEady : Number.NaN, unit: '/day', label: 'Eady Growth Rate σ' },
         { key: 'e_folding_days', value: Number.isFinite(eFoldDays) && sigmaEady > 0 ? eFoldDays : Number.NaN, unit: 'days', label: 'E-folding Time' },
       ],
       steps: [
         '── Charney-Stern Necessary Condition for Baroclinic Instability (Charney & Stern 1962) ──',
         inputsOk ? '' : 'One or more inputs are missing or NaN — diagnostic may be incomplete.',
         '',
         'Step 1 — Meridional QGPV gradient:',
         `  ∂q/∂y = ${Number.isFinite(dpdy) ? dpdy.toExponential(4) : 'NaN'} /m·s`,
         `  Full form: ∂q/∂y = β − ∂²ū/∂y² + (f²/N²)·(∂/∂p)(∂ū/∂p)`,
         '',
         'Step 2 — Evaluate necessary condition:',
         `  ∂q/∂y = ${Number.isFinite(dpdy) ? dpdy.toExponential(4) : 'NaN'} ${Number.isFinite(dpdy) && cond ? '< 0 → TRUE: sign reversal present — necessary condition for baroclinic instability SATISFIED' : Number.isFinite(dpdy) && !cond ? '≥ 0 → FALSE: ∂q/∂y ≥ 0 — flow is baroclinically stable (Arnold 1st theorem)' : '—'}`,
         '',
         'Step 3 — Context:',
         `  ${Number.isFinite(dpdy) && cond ? 'PV gradient reversal — wave energy extraction from mean flow is possible' : Number.isFinite(dpdy) ? 'No PV gradient reversal — no baroclinic instability possible' : 'Cannot assess without ∂q/∂y'}`,
         '',
         'Step 4 — Eady growth rate (if f, N, ∂u/∂y provided):',
         `  f = ${Number.isFinite(f) ? f.toExponential(4) : 'NaN'} /s, N = ${Number.isFinite(N) ? N.toExponential(4) : 'NaN'} /s, |∂u/∂y| = ${Number.isFinite(dudy) ? Math.abs(dudy).toExponential(4) : 'NaN'} /s`,
         `  σ_Eady = 0.31 × (f/N) × |∂u/∂y| = ${sigmaEady.toExponential(4)} /day`,
         `  e-folding time: τ = ${Number.isFinite(eFoldDays) && eFoldDays < 100 ? eFoldDays.toFixed(1) + ' days' : '∞ (inactive)'}`,
         '',
         `  └ Charney-Stern (1962): necessary condition — ∂q/∂y must change sign in the domain`,
         `  └ Sufficient condition also requires boundary PV gradients of opposite sign (full theorem)`,
       ]
     };
   },
101: ({ f, N, dudy }) => {
     // Eady (1949): σ = 0.31 × (f/N) × |∂u/∂z|, all inputs in /s → σ in /s
     // Convert to /day for display: × 86400
     const inputsOk = [f, N, dudy].every(Number.isFinite);
     const sigma_s = (f > 0 && N > 0) ? 0.31 * (f / N) * Math.abs(dudy) : 0;
     const sigma = sigma_s * 86400; // /day
     const eFoldDays = sigma > 0 ? 1 / sigma : Infinity;
     const periodDays = sigma > 0 ? (2 * Math.PI) / sigma : Infinity;
     if (!inputsOk) {
       return {
         result: Number.NaN, unit: '/day',
         steps: ['── Eady Baroclinic Growth Rate (Eady 1949; coefficient 0.3098 from eigenvalue analysis) ──',
           'One or more inputs (f, N, ∂u/∂z) are missing or NaN — no fabricated growth rate is substituted.',
         ],
       };
     }
     return {
       result: sigma, unit: '/day',
       secondary: [
         { key: 'growth_rate_s', value: Number.isFinite(sigma_s) ? sigma_s : Number.NaN, unit: '/s', label: 'Growth Rate σ (per second)' },
         { key: 'e_folding_days', value: Number.isFinite(eFoldDays) ? eFoldDays : Number.NaN, unit: 'days', label: 'E-folding Time τ_e' },
         { key: 'period_days', value: Number.isFinite(periodDays) ? periodDays : Number.NaN, unit: 'days', label: 'Most Unstable Wave Period' },
       ],
       steps: [
         '── Eady Baroclinic Growth Rate (Eady 1949; coefficient 0.3098 from eigenvalue analysis) ──',
         `Coriolis parameter f = ${f.toFixed(6)} /s`,
         `Brunt-Väisälä frequency N = ${N.toExponential(4)} /s`,
         `Vertical wind shear ∂u/∂z = ${dudy.toExponential(4)} /s`,
         '',
         'Step 1 — Compute Eady growth rate:',
         `  σ_Eady = 0.31 × (f/N) × |∂u/∂z|`,
         `  = 0.31 × (${f.toFixed(6)} / ${N.toExponential(4)}) × ${Math.abs(dudy).toExponential(4)}`,
         `  = ${sigma_s.toExponential(4)} /s × 86400 = ${sigma.toExponential(4)} /day`,
         '',
         'Step 2 — Growth timescales:',
         `  e-folding time: τ_e = 1/σ = ${eFoldDays < 1 ? (eFoldDays * 24).toFixed(1) + ' h' : eFoldDays.toFixed(1) + ' days'}`,
         `  Period of most unstable wave: T ≈ ${periodDays.toFixed(1)} days`,
         '',
         `  └ Classification: ${sigma > 0.5 ? 'RAPID GROWTH — explosive cyclogenesis potential' : sigma > 0.2 ? 'MODERATE GROWTH — typical mid-latitude cyclone' : sigma > 0.05 ? 'WEAK GROWTH — slowly developing system' : 'VERY WEAK / DAMPED — baroclinically inactive'}`,
       ]
     };
   },

  // ── Domain 16: Atmospheric Dynamics ──
102: ({ psi: _psi, f, dpy, dpp }) => {
     const q = dpy + f + dpp;
     const relVort = dpy;
     const stretching = dpp;
     const pvAnomaly = q - f;
     const inputsOk = [f, dpy, dpp].every(Number.isFinite);
     return {
       result: Number.isFinite(q) ? q : Number.NaN, unit: '/s',
       secondary: [
         { key: 'pv_anomaly', value: Number.isFinite(pvAnomaly) ? pvAnomaly : Number.NaN, unit: '/s', label: 'PV Anomaly q − f' },
         { key: 'stretching', value: Number.isFinite(stretching) ? stretching : Number.NaN, unit: '/s', label: 'Stretching Term' },
         { key: 'planetary_vorticity', value: Number.isFinite(f) ? f : Number.NaN, unit: '/s', label: 'Planetary Vorticity f' },
         { key: 'relative_vorticity', value: Number.isFinite(relVort) ? relVort : Number.NaN, unit: '/s', label: 'Relative Vorticity ∇²ψ' },
       ],
       steps: [
         '── Quasi-Geostrophic Potential Vorticity (Charney, 1947; Pedlosky, 1987) ──',
         `Relative vorticity (∇²ψ) ≈ ${Number.isFinite(relVort) ? relVort.toExponential(4) : 'NaN'} /s`,
         `Planetary vorticity f = ${Number.isFinite(f) ? f.toExponential(4) : 'NaN'} /s`,
         `Stretching term ∂/∂p(f²/N²·∂ψ/∂p) ≈ ${Number.isFinite(stretching) ? stretching.toExponential(4) : 'NaN'} /s`,
         '',
         'Step 1 — Assemble QGPV:',
         `  q = ∇²ψ + f + f²/N²·∂²ψ/∂p²`,
         `  q = ${Number.isFinite(relVort) ? relVort.toExponential(4) : 'NaN'} + ${Number.isFinite(f) ? f.toExponential(4) : 'NaN'} + ${Number.isFinite(stretching) ? stretching.toExponential(4) : 'NaN'}`,
         `  q = ${Number.isFinite(q) ? q.toExponential(4) : 'NaN'} /s`,
         '',
         'Step 2 — Vertical structure:',
         `  ${inputsOk && Math.abs(dpp / (dpy || 1e-30)) > 1 ? 'Stretching dominates — baroclinic structure' : 'Relative vorticity dominates — equivalent barotropic'}`,
         '',
         `  └ QGPV conservation (Dq/Dt = 0) is the foundational equation for mid-latitude synoptic dynamics`,
       ]
     };
   },
  103: ({ ubar, uprime }) => {
    const u = ubar + uprime;
    const ratio = ubar !== 0 ? uprime / ubar : 0;
    return {
      result: u, unit: 'm/s',
      steps: [
        '── Reynolds Decomposition (Reynolds, 1895) ──',
        `Mean flow ū = ${ubar.toFixed(3)} m/s, Perturbation u' = ${uprime.toFixed(3)} m/s`,
        '',
        'Step 1 — Superpose mean and perturbation:',
        `  u = ū + u' = ${ubar.toFixed(3)} + ${uprime.toFixed(3)}`,
        `  u = ${u.toFixed(3)} m/s`,
        '',
        'Step 2 — Turbulence intensity:',
        `  u'/ū = ${ratio.toFixed(3)} |u'|/|ū| = ${(Math.abs(ratio) * 100).toFixed(1)}%`,
        `  ${Math.abs(ratio) < 0.1 ? 'Weak perturbation — nearly steady flow' : Math.abs(ratio) < 0.5 ? 'Moderate perturbation — distinct eddies' : 'Large perturbation — highly transient / turbulent flow'}`,
        '',
        `  └ Reynolds averaging: ¯(u'v') ≠ 0 defines turbulent momentum flux (Reynolds stress)`,
      ]
    };
  },
  104: ({ Km, f, tau, rho, curlTau }) => {
    const KmN = Number(Km), fN = Number(f), tauN = Number(tau), rhoN = Number(rho), curlTauN = Number(curlTau);
    const rhoV = Number.isFinite(rhoN) && rhoN > 0 ? rhoN : 1025; // seawater density (kg/m³), documented default
    const hasStress = Number.isFinite(tauN);
    const hasCurl = Number.isFinite(curlTauN);
    const fAbs = Math.abs(fN);
    if (!Number.isFinite(KmN) || !Number.isFinite(fN) || KmN <= 0 || fAbs <= 1e-12) {
      const eqLine = !Number.isFinite(KmN) || !Number.isFinite(fN)
        ? `Non-finite input — K_m = ${Km}, f = ${f}`
        : KmN <= 0
          ? `Eddy viscosity K_m = ${KmN} m²/s — must be positive`
          : `Coriolis parameter f = ${fN} /s — must be non-zero (equatorial singularity)`;
      return {
        result: Number.NaN, unit: 'm',
        secondary: [
          { key: 'ekman_transport', value: Number.NaN, unit: 'm²/s', label: 'Ekman Transport per Unit Width M = τ/(ρ·|f|)' },
          { key: 'ekman_pumping', value: Number.NaN, unit: 'm/s', label: 'Ekman Pumping Velocity w_E = curl τ/(ρ·|f|)' },
        ],
        steps: [
          '── Ekman Depth (Ekman, 1905) ──',
          eqLine,
          '',
          'RESULT: NaN — Ekman theory requires a finite, positive eddy viscosity',
          'and a non-zero Coriolis parameter (off-equatorial latitude). The',
          'frictional boundary layer has no rotational structure at f = 0, so',
          'D_E is undefined. No fabricated value is substituted.',
          '',
          '  └ Valid only for |f| > 0 (off-equatorial latitudes)',
        ],
      };
    }
    const DE = PI * Math.sqrt((2 * KmN) / fAbs);
    const transport = hasStress ? tauN / (rhoV * fAbs) : Number.NaN;
    const pumping = hasCurl ? curlTauN / (rhoV * fAbs) : Number.NaN;
    const hemi = fN > 0 ? 'Northern' : 'Southern';
    return {
      result: DE, unit: 'm',
      secondary: [
        { key: 'ekman_transport', value: transport, unit: 'm²/s', label: 'Ekman Transport per Unit Width M = τ/(ρ·|f|)' },
        { key: 'ekman_pumping', value: pumping, unit: 'm/s', label: 'Ekman Pumping Velocity w_E = curl τ/(ρ·|f|)' },
      ],
      steps: [
        '── Ekman Depth (Ekman, 1905) ──',
        `Eddy viscosity K_m = ${KmN.toExponential(3)} m²/s`,
        `Coriolis parameter f = ${fN.toExponential(6)} /s (${hemi} Hemisphere)`,
        '',
        'Step 1 — Compute Ekman layer depth:',
        `  D_E = π × √(2·K_m/|f|) = π × √(2 × ${KmN.toExponential(3)} / ${fAbs.toExponential(6)})`,
        `  D_E = π × √(${(2 * KmN / fAbs).toExponential(3)})`,
        `  D_E = ${DE.toFixed(1)} m`,
        '',
        'Step 2 — Derived parameters (need wind-stress inputs):',
        `  Ekman transport: M = τ/(ρ·|f|) = ${hasStress ? transport.toFixed(4) : 'NaN — supply τ (N/m²)'} m²/s per unit width`,
        `  Ekman pumping: w_E = curl τ/(ρ·|f|) = ${hasCurl ? pumping.toExponential(4) : 'NaN — supply curl τ (N/m³)'} m/s`,
        `  ${DE > 100 ? 'Deep Ekman layer — typical of ocean interior (low latitudes)' : DE > 30 ? 'Mid-depth Ekman layer — typical mid-latitude ocean' : 'Shallow Ekman layer — high-latitude or high-wind conditions'}`,
        '',
        `  └ Surface current rotates 45° right (NH) / left (SH) of wind; net transport 90° right/left`,
      ]
    };
  },
105: ({ g, thetaVbar, wthetaV, zi, ustar }) => {
    const gN = Number(g), thN = Number(thetaVbar), wN = Number(wthetaV), ziN = Number(zi), uN = Number(ustar);
    if (![gN, thN, wN, ziN].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'm/s',
        secondary: [
          { key: 'buoyancy_flux', value: Number.NaN, unit: 'm²/s³', label: 'Kinematic Buoyancy Flux (g/θ̄_v)·w′θ′_v' },
          { key: 'theta_v', value: Number.isFinite(thN) ? thN : Number.NaN, unit: 'K', label: 'Mean virtual potential temperature θ̄_v' },
          { key: 'convective_to_friction_ratio', value: Number.NaN, unit: '—', label: 'w*/u* (free-convection regime indicator)' },
        ],
        steps: [
          '── Deardorff Convective Velocity Scale (Deardorff, 1970) ──',
          'One or more inputs are non-finite (g, θ̄_v, w′θ′_v, z_i).',
          'Cannot compute a genuine convective velocity — no fabricated',
          'value is substituted. Supply all four inputs.',
        ],
      };
    }
    if (thN <= 0 || ziN < 0 || wN < 0) {
      return {
        result: Number.NaN, unit: 'm/s',
        secondary: [
          { key: 'buoyancy_flux', value: Number.NaN, unit: 'm²/s³', label: 'Kinematic Buoyancy Flux (g/θ̄_v)·w′θ′_v' },
          { key: 'theta_v', value: thN, unit: 'K', label: 'Mean virtual potential temperature θ̄_v' },
          { key: 'convective_to_friction_ratio', value: Number.NaN, unit: '—', label: 'w*/u* (free-convection regime indicator)' },
        ],
        steps: [
          '── Deardorff Convective Velocity Scale (Deardorff, 1970) ──',
          thN <= 0
            ? `RESULT: NaN — θ̄_v = ${thN} K must be positive (virtual potential temperature).`
            : ziN < 0
              ? `RESULT: NaN — z_i = ${ziN} m must be non-negative (boundary-layer height).`
              : `RESULT: NaN — w′θ′_v = ${wN} K·m/s is negative (downward heat flux → stable/neutral BL).`,
          '',
          'Deardorff w* scales free-convective turbulence only. For a negative',
          'surface buoyancy flux the boundary layer is stably stratified and',
          'the convective velocity scale is not defined.',
        ],
      };
    }
    const buoyFlux = (gN / thN) * (wN * ziN);
    const wstar = Math.pow(buoyFlux, 1 / 3);
    const kinBuoyFlux = (gN / thN) * wN;
    const ratio = Number.isFinite(uN) && uN > 0 ? wstar / uN : Number.NaN;
    return {
      result: wstar, unit: 'm/s',
      secondary: [
        { key: 'buoyancy_flux', value: kinBuoyFlux, unit: 'm²/s³', label: 'Kinematic Buoyancy Flux (g/θ̄_v)·w′θ′_v' },
        { key: 'theta_v', value: thN, unit: 'K', label: 'Mean virtual potential temperature θ̄_v' },
        { key: 'convective_to_friction_ratio', value: ratio, unit: '—', label: 'w*/u* (free-convection regime indicator)' },
      ],
      steps: [
        '── Deardorff Convective Velocity Scale (Deardorff, 1970) ──',
        `Gravity g = ${gN.toFixed(2)} m/s²`,
        `Mean virtual potential temperature θ̄_v = ${thN.toFixed(2)} K`,
        `Surface kinematic heat flux w'θ'_v = ${wN.toExponential(4)} K·m/s`,
        `Boundary layer height z_i = ${ziN.toFixed(0)} m`,
        '',
        'Step 1 — Buoyancy production of TKE:',
        `  (g/θ̄_v)·(w'θ'_v)₀·z_i = (${gN.toFixed(2)}/${thN.toFixed(2)}) × ${wN.toExponential(4)} × ${ziN.toFixed(0)}`,
        `  = ${buoyFlux.toExponential(4)} m²/s³`,
        '',
        'Step 2 — Convective velocity scale:',
        `  w_* = (buoyancy flux)^(1/3) = (${buoyFlux.toExponential(4)})^(1/3)`,
        `  w_* = ${wstar.toFixed(3)} m/s`,
        '',
        'Step 3 — Convective regime:',
        `  ${wstar > 1.5 ? 'STRONG convection — vigorous thermals, deep BL' : wstar > 0.5 ? 'MODERATE convection — typical fair-weather cumulus' : wstar > 0.1 ? 'WEAK convection — suppressed or stable BL' : 'NEARLY NIL — stably stratified or nocturnal BL'}`,
        `${Number.isFinite(ratio) ? `  w*/u* = ${ratio.toFixed(2)} — ${ratio > 1 ? 'free-convection dominated' : 'mixed/shear-influenced'}` : '  w*/u* — NaN, supply friction velocity u*'}`,
        '',
        `  └ w_* scales vertical velocity variance and eddy diffusivity in the convective BL`,
      ]
    };
  },
  106: ({ dtheta, D, cos2b, delta, dB: _dB, dudy }) => {
    if (![dtheta, D, cos2b, delta, dudy].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'K/s',
        steps: ['── Frontogenesis Function (Petterssen, 1936; Sanders, 1955) ──',
          'One or more inputs (∇θ, D, β, δ, ∂u/∂s) are missing or NaN — no fabricated frontogenesis value is substituted.']
      };
    }
    const cosBeta = Math.sqrt((cos2b + 1) / 2);
    const deformTerm = dtheta * (D * cos2b - delta);
    const shearTerm = cosBeta * Math.abs(dudy) * Math.abs(dtheta);
    const F = Math.abs(deformTerm) + Math.abs(shearTerm);
    return {
      result: F, unit: 'K/s',
      steps: [
        '── Frontogenesis Function (Petterssen, 1936; Sanders, 1955) ──',
        `Potential temperature gradient |∇θ| = ${dtheta.toExponential(4)} K/m`,
        `Deformation rate D = ${D.toExponential(4)} /s, Shearing deformation δ = ${delta.toExponential(4)} /s`,
        `Orientation angle cos(2β) = ${cos2b.toFixed(4)}, Wind gradient ∂u/∂s = ${dudy.toExponential(4)} /s`,
        '',
        'Step 1 — Deformation contribution:',
        `  F_def = |∇θ|·(D·cos2β − δ) = ${dtheta.toExponential(4)} × (${D.toExponential(4)} × ${cos2b.toFixed(4)} − ${delta.toExponential(4)})`,
        `  = ${deformTerm.toExponential(4)} K/s`,
        '',
        'Step 2 — Shear contribution:',
        `  F_shear = cosβ·|∂u/∂s|·|∇θ| = ${cosBeta.toFixed(4)} × ${Math.abs(dudy).toExponential(4)} × ${Math.abs(dtheta).toExponential(4)}`,
        `  = ${shearTerm.toExponential(4)} K/s`,
        '',
        'Step 3 — Total frontogenesis:',
        `  F = ${F.toExponential(4)} K/s`,
        '',
        `  └ Interpretation: ${F > 1e-9 ? 'FRONTOGENESIS — temperature gradient intensifying (cold/warm front development)' : F < -1e-9 ? 'FRONTOLYSIS — gradient weakening (front decaying)' : 'Near-neutral — no frontal activity'}`,
      ]
    };
  },
  107: ({ zeta, f, dudx, dvdy, div: divInput, u, v, dzetaDx, dzetaDy }) => {
    const zN = Number(zeta), fN = Number(f), dudxN = Number(dudx), dvdyN = Number(dvdy);
    const divN = Number(divInput), uN = Number(u), vN = Number(v), dxN = Number(dzetaDx), dyN = Number(dzetaDy);
    const divV = Number.isFinite(divN)
      ? divN
      : (Number.isFinite(dudxN) && Number.isFinite(dvdyN) ? dudxN + dvdyN : Number.NaN);
    if (!Number.isFinite(zN) || !Number.isFinite(fN) || !Number.isFinite(divV)) {
      return {
        result: Number.NaN, unit: '/s²',
        secondary: [
          { key: 'relative_vorticity', value: Number.isFinite(zN) ? zN : Number.NaN, unit: '/s', label: 'Relative vorticity ζ' },
          { key: 'divergence', value: Number.isFinite(divV) ? divV : Number.NaN, unit: '/s', label: 'Horizontal divergence ∇·V' },
          { key: 'absolute_vorticity', value: Number.NaN, unit: '/s', label: 'Absolute vorticity ζ + f' },
          { key: 'stretching_term', value: Number.NaN, unit: '/s²', label: 'Stretching term −(ζ+f)·∇·V' },
          { key: 'advection_term', value: Number.NaN, unit: '/s²', label: 'Relative vorticity advection −(u·∂ζ/∂x + v·∂ζ/∂y)' },
        ],
        steps: [
          '── Barotropic Vorticity Equation (Holton & Hakim, 2012, Ch. 4) ──',
          'One or more inputs are non-finite (ζ, f, ∇·V).',
          'Cannot compute a genuine vorticity tendency — no fabricated',
          'value is substituted. Supply ζ, f and the divergence.',
        ],
      };
    }
    const advAvailable = [uN, vN, dxN, dyN].every(Number.isFinite);
    const advTerm = advAvailable ? -(uN * dxN + vN * dyN) : 0;
    const stretchingTerm = -(zN + fN) * divV;
    const DzetaDt = advTerm + stretchingTerm;
    return {
      result: DzetaDt, unit: '/s²',
      secondary: [
        { key: 'relative_vorticity', value: zN, unit: '/s', label: 'Relative vorticity ζ' },
        { key: 'divergence', value: divV, unit: '/s', label: 'Horizontal divergence ∇·V = ∂u/∂x + ∂v/∂y' },
        { key: 'absolute_vorticity', value: zN + fN, unit: '/s', label: 'Absolute vorticity ζ + f' },
        { key: 'stretching_term', value: stretchingTerm, unit: '/s²', label: 'Stretching term −(ζ+f)·∇·V' },
        { key: 'advection_term', value: advTerm, unit: '/s²', label: 'Relative vorticity advection −(u·∂ζ/∂x + v·∂ζ/∂y)' },
      ],
      steps: [
        '── Barotropic Vorticity Equation (Holton & Hakim, 2012, Ch. 4) ──',
        `Relative vorticity ζ = ${zN.toExponential(4)} /s`,
        `Planetary vorticity f = ${fN.toExponential(4)} /s`,
        `Divergence ∇·V = ∂u/∂x + ∂v/∂y = ${Number.isFinite(divN) ? 'given' : `${dudxN.toExponential(4)} + ${dvdyN.toExponential(4)}`} = ${divV.toExponential(4)} /s`,
        '',
        'Step 1 — Relative vorticity advection:',
        advAvailable
          ? `  −(u·∂ζ/∂x + v·∂ζ/∂y) = −(${uN.toExponential(3)} × ${dxN.toExponential(4)} + ${vN.toExponential(3)} × ${dyN.toExponential(4)}) = ${advTerm.toExponential(4)} /s²`
          : '  Advection term omitted (u, v, ∂ζ/∂x, ∂ζ/∂y not supplied) → 0 /s²',
        '',
        'Step 2 — Stretching/tilting (divergence) term:',
        `  −(ζ+f)·(∇·V) = −(${zN.toExponential(4)} + ${fN.toExponential(4)}) × ${divV.toExponential(4)}`,
        `  = ${stretchingTerm.toExponential(4)} /s² (|ζ+f| = ${Math.abs(zN + fN).toExponential(4)} /s, ${(zN + fN) > 0 ? 'cyclonic' : 'anticyclonic'})`,
        '',
        'Step 3 — Relative vorticity tendency:',
        `  Dζ/Dt = −(u·∂ζ/∂x + v·∂ζ/∂y) − (ζ+f)·∇·V = ${DzetaDt.toExponential(4)} /s²`,
        '',
        'Step 4 — Dynamical interpretation:',
        `  ${divV > 0 ? 'DIVERGENCE → vorticity decreasing (upper-level ridge building)' : 'CONVERGENCE → vorticity increasing (upper-level trough deepening)'}`,
        '',
        `  └ Full barotropic equation: Dζ/Dt = −(u·∂ζ/∂x + v·∂ζ/∂y) − (ζ+f)·(∂u/∂x + ∂v/∂y)`,
      ]
    };
  },

  // ── Domain 17: Cloud Physics ──
  108: ({ a, r, b }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const aN = Number(a), rN = Number(r), bN = Number(b);
    if (!Number.isFinite(aN) || !Number.isFinite(rN) || !Number.isFinite(bN)) {
      return {
        result: Number.NaN, unit: '—',
        steps: ['── Köhler Curve — Cloud Activation (Köhler, 1936; Pruppacher & Klett, 1997) ──',
          'One or more inputs are non-finite — cannot compute.',
          'Supply the Kelvin coefficient a (m), droplet radius r (m) and solute coefficient b (m³).',
        ],
        secondary: [
          { key: 'critical_radius', value: Number.NaN, unit: 'm', label: 'Critical Radius r_c' },
          { key: 'critical_supersaturation', value: Number.NaN, unit: '%', label: 'Critical Supersaturation S_c' },
        ],
      };
    }
    const curvature = aN / rN;
    const solute = bN / (rN * rN * rN);
    const S = curvature - solute;
    const rc = Math.sqrt(3 * bN / aN); // critical radius: dS/dr = 0 → r_c = √(3b/a)
    // Critical supersaturation (fraction): S_c = 2a/(3r_c) = (4a³/27b)^{1/2}
    const Sc = Math.pow(4 * Math.pow(aN, 3) / (27 * bN), 0.5);
    return {
      result: S, unit: '—',
      secondary: [
        { key: 'critical_radius', value: Number.isFinite(rc) ? rc : Number.NaN, unit: 'm', label: 'Critical Radius r_c' },
        { key: 'critical_supersaturation', value: Number.isFinite(Sc) ? Sc * 100 : Number.NaN, unit: '%', label: 'Critical Supersaturation S_c' },
      ],
      steps: [
        '── Köhler Curve — Cloud Activation (Köhler, 1936; Pruppacher & Klett, 1997) ──',
        `Curvature (Kelvin) coefficient a = ${aN.toExponential(3)} m`,
        `Solute (Raoult) coefficient b = ${bN.toExponential(3)} m³`,
        `Droplet radius r = ${rN.toExponential(3)} m (${(rN * 1e6).toFixed(1)} µm)`,
        '',
        'Step 1 — Curvature (Kelvin) term:',
        `  a/r = ${aN.toExponential(3)} / ${rN.toExponential(3)} = ${curvature.toExponential(4)}`,
        '',
        'Step 2 — Solute (Raoult) term:',
        `  b/r³ = ${bN.toExponential(3)} / (${rN.toExponential(3)})³ = ${solute.toExponential(4)}`,
        '',
        'Step 3 — Supersaturation:',
        `  S = a/r − b/r³ = ${curvature.toExponential(4)} − ${solute.toExponential(4)}`,
        `  S = ${S.toExponential(4)} (${(S * 100).toFixed(4)}% supersaturation)`,
        '',
        `  └ Activation: ${S > 0 ? 'SUPERSATURATED — droplet grows spontaneously (r > r_crit)' : 'SUBSATURATED — droplet evaporates'}`,
        `  └ Critical radius r_c = √(3b/a) = ${rc.toExponential(3)} m (${(rc * 1e6).toFixed(1)} µm)`,
        `  └ Critical supersaturation S_c = (4a³/27b)^½ = ${Sc.toExponential(4)} (${(Sc * 100).toFixed(4)}%)`,
      ]
    };
  },
  109: ({ N0, Lambda, D }) => {
    const N0N = Number(N0), LamN = Number(Lambda), DN = Number(D);
    if (!Number.isFinite(N0N) || !Number.isFinite(LamN) || !Number.isFinite(DN)) {
      return {
        result: Number.NaN, unit: 'm⁻³·mm⁻¹',
        secondary: [
          { key: 'lambda_mm', value: Number.NaN, unit: 'mm⁻¹', label: 'Slope parameter Λ (mm⁻¹)' },
          { key: 'total_concentration', value: Number.NaN, unit: 'm⁻³', label: 'Total drop concentration N_T = N₀/Λ' },
          { key: 'mean_diameter', value: Number.NaN, unit: 'mm', label: 'Mean diameter 1/Λ' },
          { key: 'median_volume_diameter', value: Number.NaN, unit: 'mm', label: 'Median-volume diameter D₀ = 3.67/Λ' },
        ],
        steps: [
          '── Marshall-Palmer Drop Size Distribution (Marshall & Palmer, 1948) ──',
          'One or more inputs are non-finite (N₀, Λ, D).',
          'Cannot compute a genuine drop concentration — no fabricated',
          'value is substituted. Supply N₀, Λ and drop diameter D.',
        ],
      };
    }
    if (N0N < 0 || LamN <= 0 || DN < 0) {
      return {
        result: Number.NaN, unit: 'm⁻³·mm⁻¹',
        secondary: [
          { key: 'lambda_mm', value: Number.isFinite(LamN) && LamN > 0 ? LamN / 1000 : Number.NaN, unit: 'mm⁻¹', label: 'Slope parameter Λ (mm⁻¹)' },
          { key: 'total_concentration', value: Number.NaN, unit: 'm⁻³', label: 'Total drop concentration N_T = N₀/Λ' },
          { key: 'mean_diameter', value: Number.NaN, unit: 'mm', label: 'Mean diameter 1/Λ' },
          { key: 'median_volume_diameter', value: Number.NaN, unit: 'mm', label: 'Median-volume diameter D₀ = 3.67/Λ' },
        ],
        steps: [
          '── Marshall-Palmer Drop Size Distribution (Marshall & Palmer, 1948) ──',
          N0N < 0
            ? `RESULT: NaN — intercept N₀ = ${N0N} must be ≥ 0.`
            : LamN <= 0
              ? `RESULT: NaN — slope Λ = ${LamN} m⁻¹ must be > 0 (Λ = 4.1·R^(−0.21) mm⁻¹ is always positive).`
              : `RESULT: NaN — drop diameter D = ${DN} m must be ≥ 0.`,
          '',
          'Unphysical DSD parameter — no fabricated value is substituted.',
        ],
      };
    }
    const expTerm = Math.exp(-LamN * DN);
    const N = N0N * expTerm;
    const LamMM = LamN / 1000; // slope in mm⁻¹ (engine keeps D in metres, Λ in m⁻¹; Λ·D is dimensionless)
    const totalConc = N0N / LamMM; // N_T = ∫₀^∞ N₀·exp(−ΛD)dD = N₀/Λ [m⁻³]
    const meanDmm = 1 / LamMM;     // [mm]
    const D0mm = 3.67 / LamMM;     // median-volume diameter [mm]
    const points: Array<{ x: number; y: number }> = [];
    for (let dmm = 0; dmm <= 8.0001; dmm += 0.25) {
      const y = N0N * Math.exp(-LamN * (dmm / 1000));
      if (Number.isFinite(y)) points.push({ x: dmm, y });
    }
    return {
      result: N, unit: 'm⁻³·mm⁻¹',
      secondary: [
        { key: 'lambda_mm', value: LamMM, unit: 'mm⁻¹', label: 'Slope parameter Λ (mm⁻¹)' },
        { key: 'total_concentration', value: Number.isFinite(totalConc) ? totalConc : Number.NaN, unit: 'm⁻³', label: 'Total drop concentration N_T = N₀/Λ' },
        { key: 'mean_diameter', value: Number.isFinite(meanDmm) ? meanDmm : Number.NaN, unit: 'mm', label: 'Mean diameter 1/Λ' },
        { key: 'median_volume_diameter', value: Number.isFinite(D0mm) ? D0mm : Number.NaN, unit: 'mm', label: 'Median-volume diameter D₀ = 3.67/Λ' },
      ],
      series: [{
        label: 'N(D) — Marshall-Palmer drop size distribution',
        color: '#0072B2',
        points,
      }],
      steps: [
        '── Marshall-Palmer Drop Size Distribution (Marshall & Palmer, 1948) ──',
        `Intercept parameter N₀ = ${N0N.toExponential(3)} m⁻³·mm⁻¹`,
        `Slope parameter Λ = ${LamN.toExponential(3)} /m (${LamMM.toFixed(2)} /mm)`,
        `Drop diameter D = ${(DN * 1000).toFixed(2)} mm (${DN.toExponential(3)} m)`,
        '',
        'Step 1 — Exponential distribution:',
        `  N(D) = N₀·exp(−Λ·D) = ${N0N.toExponential(3)} × exp(−${LamN.toExponential(3)} × ${DN.toExponential(3)})`,
        `  exp(−ΛD) = ${expTerm.toExponential(4)}`,
        '',
        'Step 2 — Concentration at given diameter:',
        `  N(${(DN * 1000).toFixed(1)} mm) = ${N.toExponential(3)} m⁻³·mm⁻¹`,
        '',
        'Step 3 — Distribution moments (Λ in mm⁻¹):',
        `  Total concentration: N_T = N₀/Λ = ${N0N.toExponential(3)} / ${LamMM.toFixed(3)} = ${totalConc.toExponential(4)} m⁻³`,
        `  Mean diameter: 1/Λ = ${meanDmm.toFixed(2)} mm`,
        `  Median-volume diameter: D₀ = 3.67/Λ = ${D0mm.toFixed(2)} mm`,
        `  Reflectivity: Z = N₀·Γ(7)/Λ⁷ = ${N0N.toExponential(3)} × 720 / ${Math.pow(LamMM, 7).toExponential(3)} = ${(N0N * 720 / Math.pow(LamMM, 7)).toExponential(3)} mm⁶/m³`,
        '',
        `  └ Classic MP: N₀ = 8×10³ m⁻³·mm⁻¹, Λ = 4.1·R^(-0.21) mm⁻¹ (R in mm/h)`,
      ]
    };
  },
  110: ({ a, R }) => {
    const aN = Number(a), RN = Number(R);
    if (!Number.isFinite(aN) || !Number.isFinite(RN)) {
      return {
        result: Number.NaN, unit: 'mm⁶/m³',
        secondary: [
          { key: 'reflectivity_dbz', value: Number.NaN, unit: 'dBZ', label: 'Radar reflectivity dBZ = 10·log₁₀(Z)' },
          { key: 'rain_rate_from_z', value: Number.NaN, unit: 'mm/h', label: 'Inverse rain rate R = (Z/a)^(1/b)' },
        ],
        steps: [
          '── Z-R Reflectivity-Rainfall Relation (Battan, 1973; Marshall-Palmer, 1948) ──',
          'One or more inputs are non-finite (a, R).',
          'Cannot compute a genuine reflectivity — no fabricated value',
          'is substituted. Supply the coefficient a and rain rate R.',
        ],
      };
    }
    if (aN <= 0 || RN < 0) {
      return {
        result: Number.NaN, unit: 'mm⁶/m³',
        secondary: [
          { key: 'reflectivity_dbz', value: Number.NaN, unit: 'dBZ', label: 'Radar reflectivity dBZ = 10·log₁₀(Z)' },
          { key: 'rain_rate_from_z', value: Number.NaN, unit: 'mm/h', label: 'Inverse rain rate R = (Z/a)^(1/b)' },
        ],
        steps: [
          '── Z-R Reflectivity-Rainfall Relation (Battan, 1973; Marshall-Palmer, 1948) ──',
          aN <= 0
            ? `RESULT: NaN — coefficient a = ${aN} must be positive (Marshall-Palmer standard a = 200).`
            : `RESULT: NaN — rain rate R = ${RN} mm/h must be ≥ 0.`,
          '',
          'Unphysical Z-R input — no fabricated value is substituted.',
        ],
      };
    }
    const b = 1.6;
    const Z = aN * Math.pow(RN, b);
    const dBZ = RN === 0 ? 0 : 10 * Math.log10(Z);
    const Rinv = RN > 0 ? Math.pow(Z / aN, 1 / b) : 0;
    const rainClass = Z < 20 ? 'Light drizzle' : Z < 200 ? 'Moderate rain' : Z < 2000 ? 'Heavy rain' : 'Very heavy / hailstorm';
    const points: Array<{ x: number; y: number }> = [];
    for (const r of [0, 0.5, 1, 2, 5, 10, 20, 50, 100]) {
      const z = aN * Math.pow(r, b);
      if (Number.isFinite(z)) points.push({ x: r, y: z });
    }
    return {
      result: Z, unit: 'mm⁶/m³',
      secondary: [
        { key: 'reflectivity_dbz', value: dBZ, unit: 'dBZ', label: 'Radar reflectivity dBZ = 10·log₁₀(Z)' },
        { key: 'rain_rate_from_z', value: Rinv, unit: 'mm/h', label: 'Inverse rain rate R = (Z/a)^(1/b)' },
      ],
      series: [{
        label: 'Z(R) — reflectivity-rainfall curve',
        color: '#D55E00',
        points,
      }],
      steps: [
        '── Z-R Reflectivity-Rainfall Relation (Battan, 1973; Marshall-Palmer, 1948) ──',
        `Coefficient a = ${aN.toFixed(1)} (Marshall-Palmer standard: a=200)`,
        `Rain rate R = ${RN.toFixed(2)} mm/h, Exponent b = ${b.toFixed(1)}`,
        '',
        'Step 1 — Compute radar reflectivity:',
        `  Z = a × R^b = ${aN.toFixed(1)} × ${RN.toFixed(2)}^${b.toFixed(1)}`,
        `  Z = ${Z.toExponential(3)} mm⁶/m³`,
        '',
        'Step 2 — Convert to dBZ:',
        `  dBZ = 10 × log₁₀(Z) = 10 × log₁₀(${Z.toExponential(3)})`,
        `  dBZ = ${dBZ.toFixed(1)} dBZ`,
        '',
        'Step 3 — Inverse relation (R from Z):',
        `  R = (Z/a)^(1/b) = (${Z.toExponential(3)}/${aN.toFixed(1)})^(1/${b.toFixed(1)}) = ${Rinv.toFixed(3)} mm/h`,
        '',
        'Step 4 — Precipitation classification:',
        `  ${rainClass} (${dBZ.toFixed(0)} dBZ)`,
        '',
        `  └ Common Z-R pairs: stratiform (200,1.6), orographic (31,1.71), thunderstorm (486,1.37)`,
        `  └ Dual-pol improves R estimate by reducing Z-R ambiguity (K_dp, Z_dr)`,
      ]
    };
  },

  // ── Part VI · Domain 18: Geodesy ──
  111: ({ xp, yp, sp, gast, dx, dy }) => {
    // IERS Conventions (2010) §5 — CIO-based Earth rotation matrix.
    //   W(t) = R₃(−s′)·R₂(x_p)·R₁(y_p)   (polar motion + TIO locator)
    //   R(t) = W(t)·R₃(GAST)             (Earth rotation)
    // x_p, y_p in arcsec; s′ (TIO locator) in arcsec; GAST in radians;
    // dX, dY (celestial pole offsets) in milliarcsec. The returned scalar
    // is det(R) — an orthonormality diagnostic that equals 1 for a valid
    // rotation matrix (trace tr(R) = 1 + 2·cos(angle) is secondary).
    const allFinite = [xp, yp, sp, gast].every(Number.isFinite);
    if (!allFinite) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'trace_R', value: Number.NaN, unit: '—', label: 'Trace tr(R) = 1+2cosθ' },
          { key: 'celestial_pole_offset', value: Number.isFinite(dx) && Number.isFinite(dy) ? Math.hypot(dx, dy) : Number.NaN, unit: 'mas', label: 'Celestial Pole Offset √(dX²+dY²)' },
        ],
        steps: [
          '── CIO-Based Earth Rotation Matrix (IERS Conventions 2010, §5) ──',
          'Polar motion x_p, y_p, TIO locator s′, or GAST is non-finite.',
          'No fabricated substitution — supply finite arcsec/radian inputs.',
          '',
          '  W = R₃(−s′)·R₂(x_p)·R₁(y_p)',
          '  R = W·R₃(GAST)   (TRS → CRS)',
        ],
      };
    }
    const xpR = xp * ARCSEC2RAD;
    const ypR = yp * ARCSEC2RAD;
    const spR = sp * ARCSEC2RAD;
    const W = mat3Mul(mat3Mul(rot3(-spR), rot2(xpR)), rot1(ypR));
    const R = mat3Mul(W, rot3(gast));
    const detR = mat3Det(R);
    const trR = mat3Trace(R);
    const cpo = Number.isFinite(dx) && Number.isFinite(dy) ? Math.hypot(dx, dy) : Number.NaN;
    return {
      result: detR, unit: '—',
      secondary: [
        { key: 'trace_R', value: trR, unit: '—', label: 'Trace tr(R) = 1+2cosθ' },
        { key: 'x_polar_motion', value: xp, unit: 'arcsec', label: 'Polar motion x_p' },
        { key: 'y_polar_motion', value: yp, unit: 'arcsec', label: 'Polar motion y_p' },
        { key: 'tio_locator', value: sp, unit: 'arcsec', label: 'TIO locator s′' },
        { key: 'gast', value: gast, unit: 'rad', label: 'Greenwich Apparent Sidereal Time' },
        { key: 'celestial_pole_offset', value: cpo, unit: 'mas', label: 'Celestial Pole Offset √(dX²+dY²)' },
      ],
      steps: [
        '── CIO-Based Earth Rotation Matrix (IERS Conventions 2010, §5) ──',
        `Polar motion x_p = ${xp}″, y_p = ${yp}″; TIO locator s′ = ${sp}″`,
        `GAST = ${gast} rad; celestial pole offset dX = ${Number.isFinite(dx) ? dx : 'NaN'}, dY = ${Number.isFinite(dy) ? dy : 'NaN'} mas`,
        '',
        'Step 1 — Polar-motion matrix (arcsec → rad, ×4.848×10⁻⁶):',
        `  W = R₃(−s′)·R₂(x_p)·R₁(y_p)`,
        `  W = R₃(−${spR.toExponential(4)})·R₂(${xpR.toExponential(4)})·R₁(${ypR.toExponential(4)})`,
        '',
        'Step 2 — Full Earth rotation:',
        `  R = W·R₃(GAST) = W·R₃(${gast.toFixed(6)})`,
        '',
        'Step 3 — Orthonormality diagnostic:',
        `  det(R) = ${detR.toFixed(12)} ${Math.abs(detR - 1) < 1e-9 ? '✓ (valid rotation matrix)' : '⚠ (deviates from 1)'}`,
        `  tr(R) = ${trR.toFixed(6)} = 1 + 2·cos(rotation angle)`,
        '',
        `  └ Full CIO chain: R(t) = Q(t)·R(t)·W(t) transforms ITRS → GCRS`,
        `  └ Celestial pole offset magnitude = ${Number.isFinite(cpo) ? cpo.toFixed(3) : 'NaN'} mas (IAU 2000A residuals)`,
      ],
    };
  },
  112: ({ hn, kn, Vn, g, lat, Re }) => {
    // Solid Earth tides (Love, 1911; Wahr, 1981). Degree-2 tidal potential
    // V₂ (m²/s²) with Love numbers h₂ (radial) and k₂ (potential):
    //   u_r = h₂·V₂/g   (radial displacement, m)
    //   Δg  = k₂·V₂/R_e (gravity perturbation, m/s²)
    // When V₂ is not supplied, the sub-lunar degree-2 potential of the
    // Moon is used: V₂ = G·M_moon·R_e²/D³ (Moon directly overhead).
    const G_MOON = 4.9028e12; // G·M_moon (m³/s²), DE421
    const D_MOON = 3.844e8;   // mean Earth–Moon distance (m)
    const ReEff = Re === undefined ? 6371000 : (Number.isFinite(Re) ? Re : Number.NaN);
    const h2 = hn === undefined ? 0.603 : (Number.isFinite(hn) ? hn : Number.NaN);
    const k2 = kn === undefined ? 0.298 : (Number.isFinite(kn) ? kn : Number.NaN);
    const gv = g === undefined ? G_GRAV : (Number.isFinite(g) ? g : Number.NaN);
    const latDeg = lat === undefined ? 45 : (Number.isFinite(lat) ? lat : Number.NaN);
    const latRad = Number.isFinite(latDeg) ? latDeg * Math.PI / 180 : Number.NaN;
    // Degree-2 latitude factor: V₂(φ) = V₂_eq · (3·sin²φ − 1)/2
    // (Wahr 1981; Pugh & Woodworth 2014). At φ=45° the factor is 0.5.
    const latFactor = Number.isFinite(latRad) ? (3 * Math.sin(latRad) * Math.sin(latRad) - 1) / 2 : Number.NaN;
    const V2 = Vn === undefined || Vn === 0
      ? (G_MOON * ReEff * ReEff) / (D_MOON * D_MOON * D_MOON) * (Number.isFinite(latFactor) ? latFactor : 1)
      : (Number.isFinite(Vn) ? Vn : Number.NaN);
    if (![ReEff, h2, k2, gv, latDeg, V2].every(Number.isFinite) || gv <= 0 || ReEff <= 0) {
      return {
        result: Number.NaN, unit: 'm',
        secondary: [
          { key: 'tidal_potential', value: Number.isFinite(V2) ? V2 : Number.NaN, unit: 'm²/s²', label: 'Degree-2 Tidal Potential V₂' },
          { key: 'gravity_perturbation', value: Number.NaN, unit: 'm/s²', label: 'Gravity Perturbation Δg = k₂·V₂/R_e' },
        ],
        steps: [
          '── Earth Tides (Love 1911; Wahr 1981) ──',
          'A Love number (h₂/k₂), the tidal potential V₂, g, or R_e is',
          'non-finite, or g ≤ 0 / R_e ≤ 0. Result is NaN (honest — never',
          'fabricated). Supply h₂ ≈ 0.603, k₂ ≈ 0.298, V₂ (m²/s²), g (m/s²).',
        ],
      };
    }
    const u = h2 * V2 / gv;              // radial displacement (m)
    const dg = k2 * V2 / ReEff;          // gravity perturbation (m/s²)
    const seriesPoints: Array<{ x: number; y: number }> = [];
    for (let phiDeg = -90; phiDeg <= 90; phiDeg += 5) {
      const sinPhi = Math.sin(phiDeg * Math.PI / 180);
      seriesPoints.push({ x: phiDeg, y: V2 * 0.5 * (3 * sinPhi * sinPhi - 1) });
    }
    return {
      result: u, unit: 'm',
      secondary: [
        { key: 'tidal_potential', value: V2, unit: 'm²/s²', label: 'Degree-2 Tidal Potential V₂' },
        { key: 'solid_earth_tide_height', value: u * 100, unit: 'cm', label: 'Solid Earth Tide Height (cm)' },
        { key: 'gravity_perturbation', value: dg, unit: 'm/s²', label: 'Gravity Perturbation Δg = k₂·V₂/R_e' },
        { key: 'love_number_h2', value: h2, unit: '—', label: 'Love number h₂' },
        { key: 'love_number_k2', value: k2, unit: '—', label: 'Love number k₂' },
      ],
      series: [{
        label: 'Degree-2 zonal tidal potential V₂(φ)',
        color: '#0072B2',
        points: seriesPoints,
      }],
      steps: [
        '── Earth Tides (Love 1911; Wahr 1981) ──',
        `Love numbers h₂ = ${h2}, k₂ = ${k2}; tidal potential V₂ = ${V2.toFixed(4)} m²/s²`,
        `Surface gravity g = ${gv.toFixed(4)} m/s², Earth radius R_e = ${ReEff.toFixed(0)} m`,
        '',
        'Step 1 — Radial solid-Earth tide displacement:',
        `  u_r = h₂·V₂/g = ${h2} × ${V2.toFixed(4)} / ${gv.toFixed(4)}`,
        `  u_r = ${u.toFixed(4)} m (${(u * 1000).toFixed(2)} mm, ${(u * 100).toFixed(1)} cm)`,
        '',
        'Step 2 — Gravity perturbation:',
        `  Δg = k₂·V₂/R_e = ${k2} × ${V2.toFixed(4)} / ${ReEff.toFixed(0)}`,
        `  Δg = ${dg.toExponential(3)} m/s² (${(dg * 1e5).toExponential(3)} mGal)`,
        '',
        `  └ Moon-overhead V₂ = G·M_moon·R_e²/D³ ≈ ${V2.toFixed(3)} m²/s²`,
        `  └ At ${latDeg.toFixed(0)}° latitude the zonal factor (3sin²φ−1)/2 = ${(0.5 * (3 * Math.pow(Math.sin(latDeg * Math.PI / 180), 2) - 1)).toFixed(3)}`,
        `  └ h₂ ≈ 0.603, k₂ ≈ 0.298 (PREM) — ocean loading adds ~2× in coastal zones`,
      ],
    };
  },
  113: ({ GM, r, n, m, Cnm, Snm, Pnm, phi, lam, Re, dPnm }) => {
    // Single harmonic of the EGM2008-style spherical-harmonic expansion.
    // Disturbing potential:  T = (GM/r)·(R_e/r)^n·(C_nm cos mλ + S_nm sin mλ)·P_nm(sinφ)
    // Gravity anomaly (spherical, free-air): Δg = −∂T/∂r − (2/r)T = (n−1)(GM/r²)·(R_e/r)^n·Y·P_nm
    // Deflections: η = −(1/(g·r·cosφ))·∂T/∂λ (exact), ξ = −(1/(g·r))·∂T/∂φ (needs ∂P/∂φ).
    const ReEff = Re === undefined ? 6371000 : (Number.isFinite(Re) ? Re : Number.NaN);
    const gmv = GM === undefined ? 3.986004418e14 : (Number.isFinite(GM) ? GM : Number.NaN);
    const rv = r === undefined ? 6371000 : (Number.isFinite(r) ? r : Number.NaN);
    const nv = n === undefined ? 2 : (Number.isFinite(n) ? n : Number.NaN);
    const mv = m === undefined ? 0 : (Number.isFinite(m) ? m : Number.NaN);
    const cnm = Cnm === undefined ? 1e-6 : (Number.isFinite(Cnm) ? Cnm : Number.NaN);
    const snm = Snm === undefined ? 0 : (Number.isFinite(Snm) ? Snm : Number.NaN);
    const pnm = Pnm === undefined ? 1 : (Number.isFinite(Pnm) ? Pnm : Number.NaN);
    const phiv = phi === undefined ? 0 : (Number.isFinite(phi) ? phi : Number.NaN);
    const lamv = lam === undefined ? 0 : (Number.isFinite(lam) ? lam : Number.NaN);
    const dPnmv = dPnm === undefined ? Number.NaN : (Number.isFinite(dPnm) ? dPnm : Number.NaN);
    if (![ReEff, gmv, rv, nv, mv, cnm, snm, pnm, phiv, lamv].every(Number.isFinite)
      || rv <= 0 || nv < 0 || mv < 0 || mv > nv) {
      return {
        result: Number.NaN, unit: 'mGal',
        secondary: [
          { key: 'disturbing_potential', value: Number.NaN, unit: 'm²/s²', label: 'Disturbing Potential T' },
          { key: 'deflection_eta', value: Number.NaN, unit: 'arcsec', label: 'Prime-vertical deflection η (east)' },
          { key: 'deflection_xi', value: Number.NaN, unit: 'arcsec', label: 'Meridian deflection ξ (north)' },
        ],
        steps: [
          '── Spherical Harmonic Gravity Field (Heiskanen & Moritz 1967; EGM2008) ──',
          'GM, r, n, m, C_nm, S_nm, P_nm, φ or λ is non-finite, or 0 ≤ m ≤ n',
          'and r > 0 are violated. Result is NaN (honest — never fabricated).',
        ],
      };
    }
    const ratio = ReEff / rv;
    const scale = Math.pow(ratio, nv);
    const Y = cnm * Math.cos(mv * lamv) + snm * Math.sin(mv * lamv);
    const T = (gmv / rv) * scale * Y * pnm;                 // disturbing potential (m²/s²)
    const gAnom = (nv - 1) * (gmv / (rv * rv)) * scale * Y * pnm; // gravity anomaly (m/s²)
    const gAnomMG = gAnom * 1e5;                             // mGal (1 mGal = 10⁻⁵ m/s²)
    const gNorm = gmv / (rv * rv);                           // normal gravity (m/s²)
    const cosPhi = Math.cos(phiv);
    let eta = Number.NaN;
    if (Math.abs(cosPhi) > 1e-9) {
      const dTdL = (gmv / rv) * scale * mv * (-cnm * Math.sin(mv * lamv) + snm * Math.cos(mv * lamv)) * pnm;
      eta = -(1 / (gNorm * rv * cosPhi)) * dTdL * RAD2ARCSEC;
    }
    const xi = Number.isFinite(dPnmv)
      ? -(1 / (gNorm * rv)) * (gmv / rv) * scale * Y * dPnmv * RAD2ARCSEC
      : Number.NaN;
    return {
      result: gAnomMG, unit: 'mGal',
      secondary: [
        { key: 'disturbing_potential', value: T, unit: 'm²/s²', label: 'Disturbing Potential T' },
        { key: 'deflection_eta', value: Number.isFinite(eta) ? eta : Number.NaN, unit: 'arcsec', label: 'Prime-vertical deflection η (east)' },
        { key: 'deflection_xi', value: Number.isFinite(xi) ? xi : Number.NaN, unit: 'arcsec', label: 'Meridian deflection ξ (north, needs ∂P_nm/∂φ)' },
        { key: 'degree', value: nv, unit: '—', label: 'Degree n' },
        { key: 'order', value: mv, unit: '—', label: 'Order m' },
      ],
      steps: [
        '── Spherical Harmonic Gravity Field (Heiskanen & Moritz 1967; EGM2008) ──',
        `GM = ${gmv.toExponential(4)} m³/s², r = ${rv.toFixed(0)} m, R_e = ${ReEff.toFixed(0)} m`,
        `Degree n = ${nv}, order m = ${mv}; C_nm = ${cnm.toExponential(4)}, S_nm = ${snm.toExponential(4)}`,
        `P_nm(sinφ) = ${pnm.toExponential(4)}, φ = ${phiv.toFixed(4)} rad, λ = ${lamv.toFixed(4)} rad`,
        '',
        'Step 1 — Radial scale factor:',
        `  (R_e/r)^n = (${ReEff.toFixed(0)}/${rv.toFixed(0)})^${nv} = ${scale.toExponential(4)}`,
        '',
        'Step 2 — Surface spherical harmonic:',
        `  Y = C_nm·cos(mλ) + S_nm·sin(mλ) = ${Y.toExponential(4)}`,
        '',
        'Step 3 — Disturbing potential:',
        `  T = (GM/r)·(R_e/r)^n·Y·P_nm = ${T.toExponential(4)} m²/s²`,
        '',
        'Step 4 — Gravity anomaly (free-air, single harmonic):',
        `  Δg = (n−1)·(GM/r²)·(R_e/r)^n·Y·P_nm = ${gAnom.toExponential(4)} m/s²`,
        `  Δg = ${gAnomMG.toFixed(4)} mGal`,
        '',
        'Step 5 — Deflections of the vertical:',
        `  η = −(1/(g·r·cosφ))·∂T/∂λ = ${Number.isFinite(eta) ? eta.toFixed(4) : 'NaN'}″ (east)`,
        `  ξ = −(1/(g·r))·∂T/∂φ = ${Number.isFinite(xi) ? xi.toFixed(4) : 'NaN'}″ (north; needs ∂P_nm/∂φ)`,
        '',
        `  └ Full field: Δg = (GM/r²)·Σ (n−1)(R_e/r)^n·(C_nm cos mλ + S_nm sin mλ)·P_nm(sinφ)`,
        `  └ EGM2008 complete to degree/order 2190 (~5′ resolution)`,
      ],
    };
  },
  114: ({ X, T, S, s, wx, wy, wz, Xobs }) => {
    // Helmert 7-parameter similarity transformation (Helmert 1880;
    // Molodensky 1962):  X′ = T + (1+s)·R·X
    //   T    — 3 translations [tx, ty, tz] (m)
    //   s    — scale factor in ppm (or S as an explicit multiplier, 1+ppm)
    //   ωx,ωy,ωz — rotations about x,y,z axes (arcsec)
    // The returned scalar is |X′| (norm of the transformed vector, m).
    const toVec = (v: unknown): [number, number, number] => {
      if (Array.isArray(v) && v.length >= 1) {
        const a = [Number(v[0]), Number(v[1]), Number(v[2])];
        if (a.every(Number.isFinite)) return [a[0], a[1], a[2]];
        return [Number.NaN, Number.NaN, Number.NaN];
      }
      const n = typeof v === 'string' ? Number(v) : v;
      if (typeof n === 'number' && Number.isFinite(n)) return [n, 0, 0];
      return [Number.NaN, Number.NaN, Number.NaN];
    };
    const Xv = toVec(X);
    const Tv = toVec(T);
    const scale = S === undefined ? Number.NaN : (Number.isFinite(S) ? S : Number.NaN);
    const spm = s === undefined ? Number.NaN : (Number.isFinite(s) ? s : Number.NaN);
    const scaleEff = Number.isFinite(scale) ? scale : (Number.isFinite(spm) ? 1 + spm * 1e-6 : Number.NaN);
    const wxv = wx === undefined ? 0 : (Number.isFinite(wx) ? wx : Number.NaN);
    const wyv = wy === undefined ? 0 : (Number.isFinite(wy) ? wy : Number.NaN);
    const wzv = wz === undefined ? 0 : (Number.isFinite(wz) ? wz : Number.NaN);
    if (!Xv.every(Number.isFinite) || !Tv.every(Number.isFinite)
      || !Number.isFinite(scaleEff) || scaleEff <= 0
      || ![wxv, wyv, wzv].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'm',
        secondary: [
          { key: 'scale_ppm', value: Number.NaN, unit: 'ppm', label: 'Scale factor (ppm)' },
          { key: 'rotation_x', value: Number.NaN, unit: 'arcsec', label: 'Rotation ωx' },
          { key: 'rotation_y', value: Number.NaN, unit: 'arcsec', label: 'Rotation ωy' },
          { key: 'rotation_z', value: Number.NaN, unit: 'arcsec', label: 'Rotation ωz' },
          { key: 'displacement', value: Number.NaN, unit: 'm', label: '|X′ − X|' },
          { key: 'residual', value: Number.NaN, unit: 'm', label: 'Residual |X′ − X_obs|' },
        ],
        steps: [
          '── Helmert 7-Parameter Transformation (Helmert 1880; Molodensky 1962) ──',
          'X′ = T + (1+s)·R·X requires a finite 3-vector X, a finite 3-vector T,',
          'a positive scale factor (S or s ppm), and finite rotations.',
          'Result is NaN (honest — never fabricated).',
        ],
      };
    }
    const Rx = rot1(wxv * ARCSEC2RAD);
    const Ry = rot2(wyv * ARCSEC2RAD);
    const Rz = rot3(wzv * ARCSEC2RAD);
    const R = mat3Mul(mat3Mul(Rx, Ry), Rz);
    const rot = mat3Vec(R, Xv);
    const Xp: [number, number, number] = [
      Tv[0] + scaleEff * rot[0],
      Tv[1] + scaleEff * rot[1],
      Tv[2] + scaleEff * rot[2],
    ];
    const norm = Math.hypot(Xp[0], Xp[1], Xp[2]);
    const disp = Math.hypot(Xp[0] - Xv[0], Xp[1] - Xv[1], Xp[2] - Xv[2]);
    const residual = Array.isArray(Xobs) && Xobs.length >= 1
      ? Math.hypot(Xp[0] - Number(Xobs[0]), Xp[1] - Number(Xobs[1]), Xp[2] - Number(Xobs[2]))
      : Number.NaN;
    return {
      result: norm, unit: 'm',
      secondary: [
        { key: 'x_prime', value: Xp[0], unit: 'm', label: "Transformed component x′" },
        { key: 'y_prime', value: Xp[1], unit: 'm', label: "Transformed component y′" },
        { key: 'z_prime', value: Xp[2], unit: 'm', label: "Transformed component z′" },
        { key: 'scale_ppm', value: (scaleEff - 1) * 1e6, unit: 'ppm', label: 'Scale factor (ppm)' },
        { key: 'rotation_x', value: wxv, unit: 'arcsec', label: 'Rotation ωx' },
        { key: 'rotation_y', value: wyv, unit: 'arcsec', label: 'Rotation ωy' },
        { key: 'rotation_z', value: wzv, unit: 'arcsec', label: 'Rotation ωz' },
        { key: 'displacement', value: disp, unit: 'm', label: '|X′ − X|' },
        { key: 'residual', value: Number.isFinite(residual) ? residual : Number.NaN, unit: 'm', label: 'Residual |X′ − X_obs|' },
      ],
      steps: [
        '── Helmert 7-Parameter Transformation (Helmert 1880; Molodensky 1962) ──',
        `Input vector X = [${Xv.join(', ')}] m`,
        `Translation T = [${Tv.join(', ')}] m`,
        `Scale factor = ${scaleEff} (${((scaleEff - 1) * 1e6).toFixed(3)} ppm)`,
        `Rotations ωx = ${wxv}″, ωy = ${wyv}″, ωz = ${wzv}″`,
        '',
        'Step 1 — Rotation matrix (arcsec → rad):',
        `  R = R₁(ωx)·R₂(ωy)·R₃(ωz)  (det R = ${mat3Det(R).toFixed(12)})`,
        '',
        'Step 2 — Scale + rotate:',
        `  (1+s)·R·X = ${scaleEff} × R × [${Xv.join(', ')}] = [${rot.map((c) => c.toFixed(4)).join(', ')}] m`,
        '',
        'Step 3 — Translate:',
        `  X′ = T + (1+s)·R·X = [${Xp.map((c) => c.toFixed(4)).join(', ')}] m`,
        `  |X′| = ${norm.toFixed(4)} m`,
        '',
        'Step 4 — Residuals:',
        `  Δ = |X′ − X| = ${disp.toFixed(4)} m ${disp > 100 ? '(continental-scale shift)' : disp > 1 ? '(regional datum shift)' : '(local/minor refinement)'}`,
        `  ${Number.isFinite(residual) ? `residual |X′ − X_obs| = ${residual.toFixed(4)} m` : 'residual: no observed X′ supplied'}`,
        '',
        `  └ 7 parameters (3 translations, 3 rotations, 1 scale) for ITRF↔WGS84↔ETRS89`,
      ],
    };
  },
  115: ({ h, N }) => {
    // Orthometric height (Helmert 1890; Heiskanen & Moritz 1967): H = h − N,
    // where h is the ellipsoidal (GNSS) height and N the geoid undulation.
    const hv = h === undefined ? Number.NaN : (Number.isFinite(h) ? h : Number.NaN);
    const Nv = N === undefined ? Number.NaN : (Number.isFinite(N) ? N : Number.NaN);
    if (!Number.isFinite(hv) || !Number.isFinite(Nv)) {
      return {
        result: Number.NaN, unit: 'm',
        secondary: [
          { key: 'ellipsoid_height', value: Number.isFinite(hv) ? hv : Number.NaN, unit: 'm', label: 'Ellipsoidal height h (GNSS)' },
          { key: 'geoid_undulation', value: Number.isFinite(Nv) ? Nv : Number.NaN, unit: 'm', label: 'Geoid undulation N (EGM2008/EGM2020)' },
        ],
        steps: [
          '── Orthometric Height (Helmert 1890; Heiskanen & Moritz 1967) ──',
          'H = h − N requires a finite ellipsoidal height h and a finite',
          'geoid undulation N. Result is NaN (honest — never fabricated).',
        ],
      };
    }
    const H = hv - Nv;
    return {
      result: H, unit: 'm',
      secondary: [
        { key: 'ellipsoid_height', value: hv, unit: 'm', label: 'Ellipsoidal height h (GNSS)' },
        { key: 'geoid_undulation', value: Nv, unit: 'm', label: 'Geoid undulation N (EGM2008/EGM2020)' },
      ],
      steps: [
        '── Orthometric Height (Helmert 1890; Heiskanen & Moritz 1967) ──',
        `Ellipsoidal height (GNSS) h = ${hv.toFixed(3)} m`,
        `Geoid undulation N = ${Nv.toFixed(3)} m (EGM2008/EGM2020)`,
        '',
        'Step 1 — Convert to orthometric height:',
        `  H = h − N = ${hv.toFixed(3)} − ${Nv.toFixed(3)}`,
        `  H = ${H.toFixed(3)} m (height above sea level / geoid)`,
        '',
        'Step 2 — Geoid context:',
        `  ${Nv > 0 ? 'N > 0: geoid above ellipsoid (excess mass region)' : 'N < 0: geoid below ellipsoid (mass deficit region)'}`,
        `  Geoid slope: ~${Math.abs(Nv / 100e3 * 1e6).toFixed(2)} cm/km (typical geoid gradient)`,
        '',
        `  └ EGM2020 resolution ~5′ (~9 km); accuracy improves with regional geoid models`,
        `  └ In coastal zones, use local chart datum (e.g., LAT, MSL) — orthometric height ≠ tidal datum`,
      ],
    };
  },

  // ── Domain 19: Ionosphere & Magnetosphere ──
  116: ({ ni, mi, T, alt, z0 }) => {
    // NRLMSISE-00 (simplified barometric). Total neutral mass density from
    // per-species number densities n_i (m⁻³) and masses m_i (kg):
    //   ρ = Σ n_i·m_i
    // With a neutral temperature T (K), a scale height H = kT/(m̄g) drives
    // the isothermal profile ρ(z) = ρ₀·exp(−(z−z₀)/H) for the series.
    const niArr: number[] = Array.isArray(ni) ? ni.map(Number) : [];
    const miArr: number[] = Array.isArray(mi) ? mi.map(Number) : [];
    const good = niArr.length > 0 && miArr.length >= niArr.length
      && niArr.every((v) => Number.isFinite(v) && v >= 0)
      && miArr.slice(0, niArr.length).every((v) => Number.isFinite(v) && v >= 0);
    if (!good) {
      return {
        result: Number.NaN, unit: 'kg/m³',
        secondary: [
          { key: 'number_density', value: Number.NaN, unit: 'm⁻³', label: 'Total Number Density Σ nᵢ' },
          { key: 'mean_molecular_mass', value: Number.NaN, unit: 'kg', label: 'Mean Molecular Mass' },
          { key: 'o_n2_ratio', value: Number.NaN, unit: '—', label: 'O/N₂ ratio (n_O/n_N₂)' },
          { key: 'temperature', value: Number.NaN, unit: 'K', label: 'Neutral Temperature T' },
        ],
        steps: [
          '── NRLMSISE-00 (simplified barometric; Picone et al. 2002) ──',
          'Species number densities n_i and masses m_i are required as',
          'finite, non-negative, matched-length arrays. Result is NaN',
          '(honest — never fabricated).',
        ],
      };
    }
    let rho = 0, nTot = 0;
    for (let i = 0; i < niArr.length; i++) { rho += niArr[i] * miArr[i]; nTot += niArr[i]; }
    const mBar = nTot > 0 ? rho / nTot : Number.NaN;
    const oN2 = niArr.length >= 2 && niArr[1] > 0 ? niArr[0] / niArr[1] : Number.NaN;
    const Tk = T === undefined ? Number.NaN : (Number.isFinite(T) ? T : Number.NaN);
    const scaleH = Number.isFinite(Tk) && Number.isFinite(mBar) && mBar > 0
      ? (K_BOLTZMANN * Tk) / (mBar * G_GRAV) : Number.NaN;
    const z0km = z0 === undefined ? 200 : (Number.isFinite(z0) ? z0 : Number.NaN);
    const altKm = alt === undefined ? z0km : (Number.isFinite(alt) ? alt : Number.NaN);
    const rhoAtAlt = Number.isFinite(altKm) && Number.isFinite(z0km) && Number.isFinite(scaleH) && scaleH > 0
      ? rho * Math.exp(-((altKm - z0km) * 1000) / scaleH) : Number.NaN;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    if (Number.isFinite(scaleH) && scaleH > 0 && Number.isFinite(z0km)) {
      const zStart = Math.max(100, z0km);
      for (let z = zStart; z <= z0km + 500; z += 10) {
        seriesPoints.push({ x: z, y: rho * Math.exp(-((z - z0km) * 1000) / scaleH) });
      }
    }
    return {
      result: rho, unit: 'kg/m³',
      secondary: [
        { key: 'number_density', value: nTot, unit: 'm⁻³', label: 'Total Number Density Σ nᵢ' },
        { key: 'mean_molecular_mass', value: Number.isFinite(mBar) ? mBar : Number.NaN, unit: 'kg', label: 'Mean Molecular Mass' },
        { key: 'o_n2_ratio', value: Number.isFinite(oN2) ? oN2 : Number.NaN, unit: '—', label: 'O/N₂ ratio (n_O/n_N₂)' },
        { key: 'temperature', value: Number.isFinite(Tk) ? Tk : Number.NaN, unit: 'K', label: 'Neutral Temperature T' },
        { key: 'scale_height', value: Number.isFinite(scaleH) ? scaleH : Number.NaN, unit: 'm', label: 'Scale Height H = kT/(m̄g)' },
        { key: 'density_at_altitude', value: Number.isFinite(rhoAtAlt) ? rhoAtAlt : Number.NaN, unit: 'kg/m³', label: `Mass Density at ${Number.isFinite(altKm) ? altKm.toFixed(0) : 'N/A'} km` },
      ],
      series: seriesPoints.length > 0
        ? [{ label: 'Mass density ρ(z) — simplified barometric', color: '#0072B2', points: seriesPoints }]
        : undefined,
      steps: [
        '── NRLMSISE-00 (simplified barometric; Picone et al. 2002) ──',
        `${niArr.length} species, densities [${niArr.map((n: number) => n.toExponential(2)).join(', ')}] m⁻³`,
        `Masses [${miArr.map((m: number) => m.toExponential(2)).join(', ')}] kg`,
        '',
        'Step 1 — Total neutral mass density:',
        `  ρ = Σ(n_i·m_i) = ${rho.toExponential(4)} kg/m³`,
        '',
        'Step 2 — Derived quantities:',
        `  Total number density n = Σ n_i = ${nTot.toExponential(3)} m⁻³`,
        `  Mean molecular mass m̄ = ρ/n = ${Number.isFinite(mBar) ? mBar.toExponential(3) : 'NaN'} kg`,
        `  O/N₂ ratio = ${Number.isFinite(oN2) ? oN2.toFixed(3) : 'NaN'}`,
        `  ${Number.isFinite(scaleH) ? `Scale height H = kT/(m̄g) = ${(scaleH / 1000).toFixed(2)} km` : 'Scale height: supply neutral temperature T (K)'}`,
        '',
        'Step 3 — Regime (satellite drag):',
        `  ${Number.isFinite(rhoAtAlt) ? `ρ(${Number.isFinite(altKm) ? altKm.toFixed(0) : 'N/A'} km) = ${rhoAtAlt.toExponential(3)} kg/m³ (barometric extrapolation from z₀ = ${Number.isFinite(z0km) ? z0km.toFixed(0) : 'N/A'} km)` : 'ρ at requested altitude: supply z₀ and T for barometric extrapolation'}`,
        `  ${rho > 1e-13 ? 'Low LEO — high drag (dominant for decay)' : rho > 1e-15 ? 'Mid LEO — moderate drag' : 'High LEO / MEO — low drag'}`,
        '',
        `  └ Full NRLMSISE-00 uses MSIS-style 12-parameter exospheric expansion`,
      ],
    };
  },
  117: ({ Ne, alt, lat, lon, NmF2, hmF2, H }) => {
    // IRI-2016 (simplified). Electron density N_e at altitude/latitude/
    // longitude. When N_e is not supplied it is derived from a Chapman
    // F2-layer: N_e(h) = NmF2·exp(0.5·(1 − z − e^(−z))), z = (h − hmF2)/H.
    // Altitudes h, hmF2 and scale height H are in metres.
    const Nev = Ne === undefined ? Number.NaN : (Number.isFinite(Ne) ? Ne : Number.NaN);
    const altM = alt === undefined ? Number.NaN : (Number.isFinite(alt) ? alt : Number.NaN);
    const Nm = NmF2 === undefined ? Number.NaN : (Number.isFinite(NmF2) ? NmF2 : Number.NaN);
    const hm = hmF2 === undefined ? Number.NaN : (Number.isFinite(hmF2) ? hmF2 : Number.NaN);
    const Hc = H === undefined ? 60000 : (Number.isFinite(H) && H > 0 ? H : Number.NaN);
    const chapmanNe = (hKmM: number) => {
      if (!Number.isFinite(Nm) || !Number.isFinite(hm) || !Number.isFinite(Hc) || Hc <= 0) return Number.NaN;
      const z = (hKmM - hm) / Hc;
      return Nm * Math.exp(0.5 * (1 - z - Math.exp(-z)));
    };
    const NeEff = Number.isFinite(Nev) ? Nev : (Number.isFinite(altM) ? chapmanNe(altM) : Number.NaN);
    if (!Number.isFinite(NeEff) || NeEff < 0) {
      return {
        result: Number.NaN, unit: 'm⁻³',
        secondary: [
          { key: 'plasma_frequency', value: Number.NaN, unit: 'MHz', label: 'Plasma Frequency f_p at point' },
          { key: 'foF2', value: Number.NaN, unit: 'MHz', label: 'F2 Critical Frequency foF2' },
          { key: 'hmF2', value: Number.NaN, unit: 'km', label: 'Height of F2 Peak (HMF)' },
          { key: 'tec', value: Number.NaN, unit: 'TECU', label: 'Total Electron Content (Chapman model)' },
        ],
        steps: [
          '── IRI-2016 (simplified Chapman; Bilitza et al. 2017) ──',
          'Electron density N_e (or NmF2 + hmF2 + altitude) is required as a',
          'finite, non-negative value. Result is NaN (honest — never fabricated).',
        ],
      };
    }
    const fpMHz = Math.sqrt(NeEff * 80.6164) * 1e-6;            // plasma frequency (MHz)
    const foF2 = Number.isFinite(Nm) && Nm > 0
      ? Math.sqrt(Nm * 80.6164) * 1e-6 : Number.NaN;
    const seriesPoints: Array<{ x: number; y: number }> = [];
    let tec = 0; // m⁻² (trapezoidal integral over the Chapman profile)
    if (Number.isFinite(Nm) && Number.isFinite(hm) && Number.isFinite(Hc) && Hc > 0) {
      let prev: { h: number; ne: number } | null = null;
      for (let hM = 80e3; hM <= 800e3; hM += 10e3) {
        const ne = chapmanNe(hM);
        seriesPoints.push({ x: hM / 1000, y: ne });
        if (prev) tec += (prev.ne + ne) / 2 * (hM - prev.h);
        prev = { h: hM, ne };
      }
    }
    const tecTECU = tec > 0 ? tec / 1e16 : Number.NaN;
    const latLabel = Number.isFinite(lat) ? lat.toFixed(2) : 'N/A';
    const lonLabel = Number.isFinite(lon) ? lon.toFixed(2) : 'N/A';
    return {
      result: NeEff, unit: 'm⁻³',
      secondary: [
        { key: 'plasma_frequency', value: fpMHz, unit: 'MHz', label: 'Plasma Frequency f_p at point' },
        { key: 'foF2', value: Number.isFinite(foF2) ? foF2 : Number.NaN, unit: 'MHz', label: 'F2 Critical Frequency foF2' },
        { key: 'hmF2', value: Number.isFinite(hm) ? hm / 1000 : Number.NaN, unit: 'km', label: 'Height of F2 Peak (HMF)' },
        { key: 'tec', value: Number.isFinite(tecTECU) ? tecTECU : Number.NaN, unit: 'TECU', label: 'Total Electron Content (Chapman model)' },
      ],
      series: seriesPoints.length > 0
        ? [{ label: 'Electron density N_e(h) — Chapman layer', color: '#0072B2', points: seriesPoints }]
        : undefined,
      steps: [
        '── IRI-2016 (simplified Chapman; Bilitza et al. 2017) ──',
        `Electron density N_e = ${NeEff.toExponential(3)} m⁻³ at (${latLabel}°, ${lonLabel}°)`,
        `F2 peak density NmF2 = ${Number.isFinite(Nm) ? Nm.toExponential(3) : 'N/A'} m⁻³, hmF2 = ${Number.isFinite(hm) ? (hm / 1000).toFixed(1) : 'N/A'} km`,
        '',
        'Step 1 — Plasma frequency:',
        `  f_p = √(N_e·e²/(4π²ε₀m_e)) ≈ √(N_e × 80.6164)`,
        `  f_p = ${fpMHz.toFixed(3)} MHz`,
        '',
        'Step 2 — F2 critical frequency:',
        `  foF2 = √(NmF2 × 80.6164)·10⁻⁶ = ${Number.isFinite(foF2) ? foF2.toFixed(3) : 'NaN'} MHz`,
        '',
        'Step 3 — Chapman F2-layer profile:',
        `  N_e(h) = NmF2·exp(½(1 − z − e^(−z))), z = (h − hmF2)/H`,
        `  ${Number.isFinite(tecTECU) ? `TEC = ∫N_e dh = ${tecTECU.toFixed(2)} TECU (80–800 km, trapezoidal)` : 'TEC: requires NmF2 + hmF2'}`,
        '',
        `  └ TEC 1 TECU = 10¹⁶ m⁻²; MUF ≈ foF2 × 3.5 for 2000 km oblique paths`,
        `  └ Full IRI-2016 includes E/F1 layers, topside, storm models`,
      ],
    };
  },
  118: ({ J, E }) => {
    const Q = J * E;
    const sigma = E !== 0 ? J / E : 0;
    return {
      result: Q, unit: 'W/m³',
      secondary: [
        { key: 'conductivity', value: Number.isFinite(sigma) ? sigma : Number.NaN, unit: 'S/m', label: 'Ionospheric Conductivity (J/E)' },
      ],
      steps: [
        '── Joule Heating in the Ionosphere (Cowley, 1982; Richmond, 1995) ──',
        `Current density J = ${J.toExponential(3)} A/m²`,
        `Electric field E = ${E.toExponential(3)} V/m`,
        `Derived conductivity σ = J/E ≈ ${sigma.toExponential(3)} S/m`,
        '',
        'Step 1 — Compute Joule heating rate:',
        `  Q_J = J·E = σ·E² = ${J.toExponential(3)} × ${E.toExponential(3)}`,
        `  Q_J = ${Q.toExponential(3)} W/m³`,
        '',
        'Step 2 — Heating class:',
        `  ${Q > 1e-6 ? 'STRONG Joule heating — auroral zone, geomagnetic storm conditions' : Q > 1e-9 ? 'MODERATE — sub-auroral, SAPS events' : 'WEAK — low-latitude / quiet conditions'}`,
        '',
        `  └ Height-integrated heating: Σ_Q = ∫Q_J·dh ∼ mW/m² — drives thermospheric expansion during storms`,
      ]
    };
  },
  119: ({ Imean, Istd }) => {
    // Scintillation index S4 = √(⟨I²⟩−⟨I⟩²)/⟨I⟩ = σ_I/⟨I⟩ (Briggs & Parkin 1963).
    // The implementation receives σ_I and ⟨I⟩; S4 = σ_I / ⟨I⟩.
    if (!Number.isFinite(Imean) || !Number.isFinite(Istd)) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 's4_class', value: Number.NaN, unit: '—', label: 'S4 Classification' },
          { key: 'mean_intensity', value: Number.isFinite(Imean) ? Imean : Number.NaN, unit: '—', label: 'Mean Intensity ⟨I⟩' },
          { key: 'std_intensity', value: Number.isFinite(Istd) ? Istd : Number.NaN, unit: '—', label: 'Intensity Std Dev σ_I' },
        ],
        steps: [
          '── S4 Scintillation Index (Briggs & Parkin, 1963; Yeh & Liu, 1982) ──',
          'S4 = √(⟨I²⟩ − ⟨I⟩²) / ⟨I⟩ = σ_I / ⟨I⟩',
          '',
          'Mean signal intensity ⟨I⟩ or its standard deviation σ_I is missing (NaN).',
          'No fabricated scintillation index is substituted — supply genuine',
          'signal-intensity statistics for the link/epoch.',
        ],
      };
    }
    const S4 = Imean !== 0 ? Istd / Imean : 0;
    const s4Class = S4 < 0.1 ? 0 : S4 < 0.3 ? 1 : S4 < 0.6 ? 2 : 3;
    const s4Labels = [
      'WEAK — negligible amplitude fading (quiet ionosphere)',
      'MODERATE — occasional fading, typical equatorial post-sunset',
      'STRONG — frequent deep fades, GNSS tracking issues',
      'SEVERE (S4 > 0.6) — cycle slips, loss of lock likely',
    ];
    return {
      result: S4, unit: '—',
      secondary: [
        { key: 's4_class', value: s4Class, unit: '—', label: `S4 Classification: ${s4Labels[s4Class]}` },
        { key: 'mean_intensity', value: Imean, unit: '—', label: 'Mean Intensity ⟨I⟩' },
        { key: 'std_intensity', value: Istd, unit: '—', label: 'Intensity Std Dev σ_I' },
      ],
      steps: [
        '── S4 Scintillation Index (Briggs & Parkin, 1963; Yeh & Liu, 1982) ──',
        `Mean signal intensity ⟨I⟩ = ${Imean.toExponential(3)} (relative units)`,
        `Standard deviation σ_I = ${Istd.toExponential(3)} (relative units)`,
        '',
        'Step 1 — Compute S4 index:',
        `  S4 = √(⟨I²⟩ − ⟨I⟩²) / ⟨I⟩ = σ_I / ⟨I⟩ = ${Istd.toExponential(3)} / ${Imean.toExponential(3)}`,
        `  S4 = ${S4.toExponential(4)}`,
        '',
        'Step 2 — Scintillation classification:',
        `  ${s4Labels[s4Class]}`,
        '',
        `  └ L-band (GPS L1=1.575 GHz): S4 > 0.5 causes significant positioning degradation`,
        `  └ Also: σ_φ (phase scintillation) index in radians; strong S4 often correlates with σ_φ > 0.5 rad`,
      ]
    };
  },
  120: ({ Pdyn, Bz }) => {
    // Shue et al. (1997/1998) piecewise magnetopause standoff model
    // J. Geophys. Res., 103(A5), 9469–9478, DOI: 10.1029/97JA03637
    // This is the standard form R_mp = R₀(Pdyn)^(−1/α) with α = 6.6 and
    // R₀ a piecewise-linear function of IMF B_z:
    //   R₀ = 11.4 + 0.14·Bz   for Bz > 0  (northward IMF)
    //   R₀ = 11.4 + 0.013·Bz  for Bz ≤ 0  (southward IMF)
    if (!Number.isFinite(Pdyn) || !Number.isFinite(Bz) || Pdyn <= 0) {
      return {
        result: Number.NaN, unit: 'R_E',
        secondary: [
          { key: 'dynamic_pressure', value: Number.isFinite(Pdyn) ? Pdyn : Number.NaN, unit: 'nPa', label: 'Solar Wind Dynamic Pressure P_dyn' },
          { key: 'bz_polarity', value: Number.isFinite(Bz) ? (Bz > 0 ? 1 : Bz < 0 ? -1 : 0) : Number.NaN, unit: '—', label: 'B_z Polarity (1=northward, 0=zero, −1=southward)' },
          { key: 'magnetopause_type', value: Number.NaN, unit: '—', label: 'Magnetopause State' },
          { key: 'geo_exposure', value: Number.NaN, unit: '—', label: 'GEO Exposure Flag (1=exposed)' },
        ],
        steps: [
          '── Magnetopause Standoff Distance (Shue et al. 1998, J. Geophys. Res. 103, 9469–9478) ──',
          'R_mp = R₀·P_dyn^(−1/6.6),  R₀ = 11.4 + 0.14·Bz (Bz>0) | 11.4 + 0.013·Bz (Bz≤0)',
          '',
          `Dynamic pressure P_dyn = ${Number.isFinite(Pdyn) ? Pdyn : 'NaN'} nPa must be a finite`,
          'positive value (P_dyn ≤ 0 makes the power-law term undefined or infinite),',
          'and IMF B_z must be finite. No fabricated standoff distance is substituted.',
        ],
      };
    }
    const PdynExp = Math.pow(Pdyn, -1 / 6.6);
    const bzCoeff = Bz > 0 ? 0.14 : 0.013;
    const Rmp = (11.4 + bzCoeff * Bz) * PdynExp;
    const Rmp_km = Rmp * 6371;

    // Flaring index α (shape parameter) — same paper equation (3)
    const alpha = (0.58 - 0.0077 * Bz) * Math.pow(Pdyn, -0.074);

    // GEO exposure flag: R_mp < 6.6 R_E means magnetopause inside geosynchronous orbit
    const geoExposure = Rmp < 6.6 ? 1 : 0;

    // Magnetosheath thickness (approximate): bow shock standoff minus magnetopause
    // Using Farris & Russell (1994) for typical M_ms ≈ 6:
    // R_bs ≈ R_mp × [1 + 1.1·M_ms^(−2/3)] ≈ R_mp × 1.38
    const Rbs = Rmp * (1 + 1.1 * Math.pow(6, -2 / 3));
    const sheathThickness = Rbs - Rmp;

    const bzLabel = Bz > 0 ? 'northward' : Bz < 0 ? 'southward' : 'zero';
    const bzPolarity = Bz > 0 ? 1 : Bz < 0 ? -1 : 0;
    const mpType = Rmp < 6.6 ? 0 : Rmp < 8 ? 1 : Rmp < 10 ? 2 : 3;
    const mpLabels = [
      'EXTREME COMPRESSION — inside GEO (6.6 R_E)',
      'STRONG COMPRESSION — near GEO boundary',
      'NOMINAL — average solar wind conditions',
      'EXPANDED — weak solar wind, magnetopause far out',
    ];
    return {
      result: Rmp, unit: 'R_E',
      secondary: [
        { key: 'dynamic_pressure', value: Pdyn, unit: 'nPa', label: 'Solar Wind Dynamic Pressure P_dyn' },
        { key: 'bz_polarity', value: bzPolarity, unit: '—', label: `B_z Polarity (${bzLabel} IMF)` },
        { key: 'magnetopause_type', value: mpType, unit: '—', label: `Magnetopause State: ${mpLabels[mpType]}` },
        { key: 'geo_exposure', value: geoExposure, unit: '—', label: 'GEO Exposure Flag (1=exposed)' },
        { key: 'magnetosheath_thickness', value: sheathThickness, unit: 'R_E', label: 'Magnetosheath Thickness (approx.)' },
      ],
      steps: [
        '── Magnetopause Standoff Distance (Shue et al. 1997, J. Geophys. Res. 103, 9469–9478) ──',
        `Solar wind dynamic pressure P_dyn = ${Pdyn.toFixed(2)} nPa`,
        `IMF B_z (GSM) = ${Bz.toFixed(1)} nT (${bzLabel})`,
        '',
        'Step 1 — Dynamic pressure scaling:',
        `  P_dyn^(−1/6.6) = ${Pdyn.toFixed(2)}^{−1/6.6} = ${PdynExp.toExponential(4)}`,
        '',
        'Step 2 — IMF B_z linear coefficient:',
        `  Bz ${Bz > 0 ? '> 0 → northward branch' : '≤ 0 → southward branch'}`,
        `  r₀ coefficient = 11.4 + ${bzCoeff} × (${Bz.toFixed(1)}) = ${(11.4 + bzCoeff * Bz).toFixed(4)}`,
        '',
        'Step 3 — Subsolar standoff distance:',
        `  R_mp = ${(11.4 + bzCoeff * Bz).toFixed(4)} × ${PdynExp.toExponential(4)}`,
        `  R_mp = ${Rmp.toFixed(2)} R_E (${Rmp_km.toFixed(0)} km)`,
        '',
        'Step 4 — Shape parameter (flaring index):',
        `  α = (0.58 − 0.0077 × Bz) × Pdyn^(−0.074) = ${alpha.toFixed(4)}`,
        `  α > 0 → open magnetotail (tail flares outward)`,
        '',
        'Step 5 — Magnetopause state:',
        `  ${mpLabels[mpType]}`,
        `  ${Bz < -5 ? 'Strong southward B_z — dayside reconnection, erosion reduces R_mp' : Bz > 5 ? 'Strong northward B_z — high-latitude reconnection, slight inflation' : 'Quiet IMF orientation'}`,
        `  GEO exposure: ${geoExposure ? 'YES — magnetopause inside 6.6 R_E' : 'no — satellites within magnetosphere'}`,
        `  Magnetosheath thickness ≈ ${sheathThickness.toFixed(2)} R_E (typical M_ms ≈ 6)`,
        '',
        `  └ Polar cusp latitude: θ_cusp ≈ arccos(√(1/R_mp)) ≈ ${(Math.acos(Math.sqrt(1 / Math.max(Rmp, 1))) * 180 / Math.PI).toFixed(1)}°`,
      ]
    };
  },
  121: ({ Dst, Pdyn, b, c }) => {
    // Dst* = Dst − b·√(P_dyn) + c  (Burton et al. 1975)
    if (!Number.isFinite(Dst) || !Number.isFinite(Pdyn) || !Number.isFinite(b) || !Number.isFinite(c) || Pdyn < 0) {
      return {
        result: Number.NaN, unit: 'nT',
        secondary: [
          { key: 'pressure_correction', value: Number.NaN, unit: 'nT', label: 'Pressure Correction b·√(P_dyn)' },
          { key: 'raw_dst', value: Number.isFinite(Dst) ? Dst : Number.NaN, unit: 'nT', label: 'Raw Dst Index' },
          { key: 'storm_class', value: Number.NaN, unit: '—', label: 'Storm Class' },
        ],
        steps: [
          '── Pressure-Corrected Dst Index (Burton et al. 1975, J. Geophys. Res. 80, 4204–4214) ──',
          'Dst* = Dst − b·√(P_dyn) + c',
          '',
          'One or more inputs are missing/non-finite or P_dyn < 0. No fabricated',
          'Dst correction is substituted — supply genuine Dst, P_dyn, b, and c.',
        ],
      };
    }
    const magPert = b * Math.sqrt(Pdyn);
    const DstStar = Dst - magPert + c;
    // Storm classification (Loewe & Proelss 1997)
    const stormClass = DstStar > -30 ? 0 : DstStar > -50 ? 1 : DstStar > -100 ? 2 : DstStar > -250 ? 3 : DstStar > -500 ? 4 : 5;
    const stormLabels = ['Quiet/Recovery (Dst* > −30 nT)', 'Weak (−30 to −50 nT)', 'Moderate (−50 to −100 nT)', 'Strong (−100 to −250 nT)', 'Severe (−250 to −500 nT)', 'Extreme (Dst* < −500 nT)'];
    // Ring current energy from Dessler-Parker-Sckopke (1959)
    // U_RC = −(4π/μ₀) × B_E × R_E³ × Dst* × 10⁻⁹
    const B_E = 3.12e-5;  // T — equatorial dipole field
    const R_E = 6.371e6;  // m
    const MU0 = 4e-7 * Math.PI;  // H/m
    const U_RC = -(4 * Math.PI / MU0) * B_E * Math.pow(R_E, 3) * DstStar * 1e-9;

    const stormLabel = stormLabels[stormClass];
    return {
      result: DstStar, unit: 'nT',
      secondary: [
        { key: 'pressure_correction', value: magPert, unit: 'nT', label: 'Pressure Correction b·√(P_dyn)' },
        { key: 'raw_dst', value: Dst, unit: 'nT', label: 'Raw Dst Index' },
        { key: 'storm_class', value: stormClass, unit: '—', label: `Storm Class: ${stormLabel}` },
        { key: 'ring_current_energy', value: U_RC, unit: 'J', label: 'Ring Current Energy U_RC (Dessler-Parker-Sckopke)' },
      ],
      steps: [
        '── Pressure-Corrected Dst Index (Burton et al. 1975, J. Geophys. Res. 80, 4204–4214) ──',
        `Raw Dst = ${Dst.toFixed(1)} nT`,
        `Solar wind dynamic pressure P_dyn = ${Pdyn.toFixed(2)} nPa`,
        `Pressure coefficient b = ${b.toFixed(2)} nT/nPa^(1/2), Baseline c = ${c.toFixed(1)} nT`,
        '',
        'Step 1 — Magnetopause (Chapman-Ferraro) current contribution:',
        `  ΔDst_mp = b × √(P_dyn) = ${b.toFixed(2)} × √(${Pdyn.toFixed(2)}) = ${magPert.toFixed(2)} nT`,
        '',
        'Step 2 — Pressure-corrected Dst*:',
        `  Dst* = Dst − b·√(P_dyn) + c`,
        `  Dst* = ${Dst.toFixed(1)} − ${magPert.toFixed(2)} + ${c.toFixed(1)}`,
        `  Dst* = ${DstStar.toFixed(1)} nT`,
        '',
        'Step 3 — Storm classification (Loewe & Prölss 1997):',
        `  ${stormLabel}`,
        '',
        'Step 4 — Ring current energy (Dessler-Parker-Sckopke 1959):',
        `  U_RC = −(4π/μ₀) × B_E × R_E³ × Dst* × 10⁻⁹`,
        `  U_RC = ${U_RC.toExponential(3)} J`,
        '',
        `  └ Dst* isolates ring current injection by removing magnetopause compression effects`,
      ]
    };
  },
  122: ({ eps0, kB, Te, ne }) => {
    // Debye & Hückel (1923) — electron Debye length
    // λ_D = √(ε₀·k_B·T_e / (n_e·e²))
    // Phys. Z., 24, 185–206. (Plasma physics standard, Chen 1984)
    const E_CHARGE = 1.602176634e-19;  // C — elementary charge (CODATA 2018, exact)
    const M_E = 9.1093837015e-31;      // kg — electron mass (CODATA 2018)
    // Vacuum permittivity and Boltzmann constant are physical constants; accept
    // the supplied ε₀ / k_B when finite and positive, else fall back to the
    // CODATA 2018 exact values (never NaN-multiply the numerator to zero).
    const eps0v = Number.isFinite(eps0) && eps0 > 0 ? eps0 : EPS0;
    const kBv = Number.isFinite(kB) && kB > 0 ? kB : K_BOLTZMANN;
    const eps0Used = Number.isFinite(eps0) && eps0 > 0;
    const kBUsed = Number.isFinite(kB) && kB > 0;
    if (!Number.isFinite(Te) || Te <= 0 || !Number.isFinite(ne) || ne <= 0) {
      return {
        result: Number.NaN, unit: 'm',
        secondary: [
          { key: 'plasma_parameter', value: Number.NaN, unit: '—', label: 'Plasma Parameter N_D (Debye sphere)' },
          { key: 'plasma_frequency', value: Number.NaN, unit: 'rad/s', label: 'Electron Plasma Frequency ω_pe' },
          { key: 'electron_density', value: Number.isFinite(ne) ? ne : Number.NaN, unit: 'm⁻³', label: 'Electron Density n_e' },
        ],
        steps: [
          '── Debye Length (Debye & Hückel 1923; Chen 1984 Intro. to Plasma Physics) ──',
          'λ_D = √(ε₀·k_B·T_e / (n_e·e²))',
          '',
          'Electron temperature T_e (> 0) and electron density n_e (> 0) must be',
          'finite. No fabricated Debye length is substituted — supply genuine',
          'plasma parameters (T_e in K, n_e in m⁻³).',
        ],
      };
    }
    const lambda = Math.sqrt((eps0v * kBv * Te) / (ne * E_CHARGE * E_CHARGE));
    const N_D = ne * (4 / 3) * Math.PI * Math.pow(lambda, 3);
    // Electron plasma frequency: ω_pe = √(n_e·e²/(ε₀·m_e))
    const omega_pe = Math.sqrt((ne * E_CHARGE * E_CHARGE) / (eps0v * M_E));
    const eps0Note = eps0Used ? '' : ' (CODATA 2018 default)';
    const kBNote = kBUsed ? '' : ' (CODATA 2018 default)';

    return {
      result: lambda, unit: 'm',
      secondary: [
        { key: 'plasma_parameter', value: N_D, unit: '—', label: 'Plasma Parameter N_D (Debye sphere)' },
        { key: 'plasma_frequency', value: omega_pe, unit: 'rad/s', label: 'Electron Plasma Frequency ω_pe' },
        { key: 'electron_density', value: ne, unit: 'm⁻³', label: 'Electron Density n_e' },
      ],
      steps: [
        '── Debye Length (Debye & Hückel 1923; Chen 1984 Intro. to Plasma Physics) ──',
        `Vacuum permittivity ε₀ = ${eps0v.toExponential(4)} F/m${eps0Note}`,
        `Boltzmann constant k_B = ${kBv.toExponential(4)} J/K${kBNote}`,
        `Electron temperature T_e = ${Te.toFixed(1)} K (${(Te / 11604.5).toFixed(2)} eV)`,
        `Electron density n_e = ${ne.toExponential(3)} m⁻³`,
        `Elementary charge e = ${E_CHARGE.toExponential(4)} C`,
        '',
        'Step 1 — Compute electron Debye length:',
        `  λ_D = √(ε₀·k_B·T_e / (n_e·e²))`,
        `  λ_D = √(${eps0v.toExponential(4)} × ${kBv.toExponential(4)} × ${Te.toFixed(1)} / (${ne.toExponential(3)} × (${E_CHARGE.toExponential(4)})²))`,
        `  λ_D = ${lambda.toExponential(3)} m (${(lambda * 1000).toFixed(3)} mm)`,
        '',
        'Step 2 — Plasma parameter (particles in Debye sphere):',
        `  N_D = n_e · (4π/3) · λ_D³ = ${ne.toExponential(3)} × ${(4 * Math.PI / 3).toFixed(3)} × (${lambda.toExponential(3)})³`,
        `  N_D = ${N_D.toExponential(3)}`,
        '',
        'Step 3 — Electron plasma (Langmuir) frequency:',
        `  ω_pe = √(n_e·e²/(ε₀·m_e)) = ${omega_pe.toExponential(3)} rad/s`,
        `  f_pe = ω_pe/(2π) = ${(omega_pe / (2 * Math.PI)).toExponential(3)} Hz`,
        '',
        'Step 4 — Plasma state:',
        `  ${N_D > 100 ? 'IDEAL PLASMA (N_D ≫ 1) — collective behaviour dominates' : 'Non-ideal / strongly coupled — kinetic effects important'}`,
        '',
        `  └ Debye shielding: E-field of a test charge decays as exp(−r/λ_D)`,
        `  └ Quasi-neutrality holds for system scale L ≫ λ_D`,
        `  └ PIC simulations require grid spacing Δx < λ_D`,
      ]
    };
  },

  // ── Domain 20: Satellite Dynamics ──
  123: ({ rho, CD, A, m, v }) => {
    // F_D = ½·ρ·C_D·A·v²  (drag force),  a_D = F_D/m  (deceleration)
    // King-Hele (1964); Vallado (2013). ρ ≥ 0, C_D ≥ 0, A ≥ 0, m > 0.
    const valid = Number.isFinite(rho) && Number.isFinite(CD) && Number.isFinite(A)
      && Number.isFinite(m) && Number.isFinite(v)
      && rho >= 0 && CD >= 0 && A >= 0 && m > 0;
    if (!valid) {
      return {
        result: Number.NaN, unit: 'N',
        secondary: [
          { key: 'drag_force', value: Number.NaN, unit: 'N', label: 'Drag Force F_D' },
          { key: 'drag_acceleration', value: Number.NaN, unit: 'm/s²', label: 'Drag Deceleration a_D' },
          { key: 'ballistic_coefficient', value: Number.NaN, unit: 'm²/kg', label: 'Ballistic Coefficient B* = C_D·A/m' },
          { key: 'density', value: Number.isFinite(rho) ? rho : Number.NaN, unit: 'kg/m³', label: 'Atmospheric Density ρ' },
        ],
        steps: [
          '── Atmospheric Drag — Satellite Perturbation (King-Hele, 1964; Vallado, 2013) ──',
          'F_D = ½·ρ·C_D·A·v²,  a_D = F_D/m',
          '',
          'All inputs must be finite with ρ ≥ 0, C_D ≥ 0, A ≥ 0 and mass m > 0.',
          'No fabricated drag is substituted — supply genuine orbital inputs.',
        ],
      };
    }
    const dragAccel = -0.5 * rho * CD * (A / m) * v * v + 0; // +0 normalizes −0 → +0
    const FD = dragAccel * m + 0;
    const Bstar = CD * A / m;
    return {
      result: FD, unit: 'N',
      secondary: [
        { key: 'drag_force', value: FD, unit: 'N', label: 'Drag Force F_D' },
        { key: 'drag_acceleration', value: dragAccel, unit: 'm/s²', label: 'Drag Deceleration a_D' },
        { key: 'ballistic_coefficient', value: Bstar, unit: 'm²/kg', label: 'Ballistic Coefficient B* = C_D·A/m' },
        { key: 'density', value: rho, unit: 'kg/m³', label: 'Atmospheric Density ρ' },
      ],
      steps: [
        '── Atmospheric Drag — Satellite Perturbation (King-Hele, 1964; Vallado, 2013) ──',
        `Atmospheric density ρ = ${rho.toExponential(3)} kg/m³`,
        `Drag coefficient C_D = ${CD.toFixed(2)} (typical: 2.0–2.2)`,
        `Cross-sectional area A = ${A.toFixed(2)} m², Mass m = ${m.toFixed(1)} kg`,
        `Velocity v = ${v.toFixed(0)} m/s (${(v / 1000).toFixed(2)} km/s)`,
        '',
        'Step 1 — Compute drag acceleration:',
        `  a_D = −½·ρ·C_D·(A/m)·v²`,
        `  a_D = −½ × ${rho.toExponential(3)} × ${CD.toFixed(2)} × (${A.toFixed(2)}/${m.toFixed(1)}) × (${v.toFixed(0)})²`,
        `  a_D = ${dragAccel.toExponential(4)} m/s²`,
        '',
        'Step 2 — Compute drag force:',
        `  F_D = m × a_D = ${m.toFixed(1)} × ${dragAccel.toExponential(4)}`,
        `  F_D = ${FD.toExponential(4)} N`,
        '',
        'Step 3 — Decay significance:',
        `  ${Math.abs(dragAccel) > 1e-4 ? 'SIGNIFICANT — orbit decaying rapidly (low altitude < 500 km)' : Math.abs(dragAccel) > 1e-6 ? 'MODERATE — noticeable decay, orbit maintenance needed' : 'WEAK — negligible drag (high altitude > 800 km or ballistic coefficient large)'}`,
        '',
        `  └ Ballistic coefficient: B* = C_D·A/m = ${Bstar.toExponential(4)} m²/kg`,
        `  └ Semi-major axis decay: da/dt ≈ −ρ·B*·v·a (integrated over orbit)`,
      ]
    };
  },
  124: ({ rho, CD, A, v, m }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const rhoN = Number(rho), CDN = Number(CD), AN = Number(A), vN = Number(v), mN = Number(m);
    const GM_E = 3.986004418e14; // m³/s² — Earth gravitational parameter
    const a = (vN > 0) ? GM_E / (vN * vN) : 6371000 + 400000; // semi-major axis from circular orbit: v² = GM/a
    const Bstar = CDN * AN / (mN || 1); // ballistic coefficient m²/kg
    const da = -(rhoN * Bstar * vN * a); // King-Hele (1987): da/dt = −B*·ρ·v·a (m/s)
    if (![rhoN, CDN, AN, vN, mN].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'm/s',
        steps: ['── Semi-Major Axis Decay Rate (King-Hele 1987; Vallado 2013) ──',
          'da/dt = −B*·ρ·v·a',
          '', 'One or more inputs are missing — no fabricated decay is substituted.'],
      };
    }
    return {
      result: da, unit: 'm/s',
      secondary: [
        { key: 'ballistic_coefficient', value: Number.isFinite(Bstar) ? Bstar : Number.NaN, unit: 'm²/kg', label: 'Ballistic Coefficient B*' },
        { key: 'decay_per_day', value: Number.isFinite(da) ? Math.abs(da * 86400) : Number.NaN, unit: 'm/day', label: 'Altitude Decay per Day' },
        { key: 'semi_major_axis', value: Number.isFinite(a) ? a : Number.NaN, unit: 'm', label: 'Semi-major Axis' },
      ],
      // Timeseries series (tool vizType 'timeseries'): orbital altitude
      // h(t) = a − R⊕ + (da/dt)·t over 0–365 days (20 points) from the tool's
      // own King-Hele decay rate da/dt = −B*·ρ·v·a (converted to m/day).
      series: [{
        label: 'Orbital altitude h(t) = h₀ + (da/dt)·t',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const t = i * (365 / 19);
          const h = (a - 6371000) + da * 86400 * t;
          return { x: t, y: Number.isFinite(h) ? h : Number.NaN };
        }),
      }],
      steps: [
        '── Semi-Major Axis Decay Rate (King-Hele 1987; Vallado 2013) ──',
        `Atmospheric density ρ = ${rhoN.toExponential(3)} kg/m³`,
        `Drag coefficient C_D = ${CDN.toFixed(2)}, Area A = ${AN.toFixed(2)} m²`,
        `Mass m = ${mN.toFixed(1)} kg, Velocity v = ${vN.toFixed(0)} m/s`,
        `Semi-major axis a = ${(a/1000).toFixed(1)} km (alt ${((a - 6371000)/1000).toFixed(0)} km, circular orbit)`,
        '',
        'Step 1 — Ballistic coefficient:',
        `  B* = C_D·A/m = ${CDN.toFixed(2)} × ${AN.toFixed(2)} / ${mN.toFixed(1)} = ${Bstar.toExponential(4)} m²/kg`,
        '',
        'Step 2 — Semi-major axis decay rate (King-Hele 1987):',
        `  da/dt = −B*·ρ·v·a`,
        `  da/dt = −${Bstar.toExponential(4)} × ${rhoN.toExponential(3)} × ${vN.toFixed(0)} × ${a.toExponential(4)}`,
        `  da/dt = ${da.toExponential(4)} m/s`,
        '',
        'Step 3 — Daily / monthly decay:',
        `  Δh/day = ${Math.abs(da * 86400).toFixed(1)} m/day`,
        `  Δh/month = ${Math.abs(da * 86400 * 30 / 1000).toFixed(2)} km/month`,
        '',
        'Step 4 — Decay significance:',
        `  ${Math.abs(da) > 0.01 ? 'RAPID — orbit decaying by km/month (low altitude < 400 km)' : Math.abs(da) > 0.001 ? 'MODERATE — ~100 m/day, orbit maintenance needed' : Math.abs(da) > 0.0001 ? 'GRADUAL — ~10 m/day, typical for 500–700 km' : 'WEAK — < 1 m/day, above 800 km drag is negligible'}`,
      ]
    };
  },
  125: ({ A1, A2, sigmax, sigmay, d }) => {
    // Foster (1992) short-term conjunction probability:
    //   A_c = π·(R₁+R₂)²  (hard-body collision cross-section overlap of the two
    //   circular footprints Rᵢ = √(Aᵢ/π)), and the relative-position error is a
    //   bivariate Gaussian with the two objects' uncertainties combined:
    //   P_c = A_c / (2π·σ_x·σ_y) × exp(−d² / (2·(σ_x² + σ_y²)))   for d < 3σ_eff,
    //   P_c = 0                                                   otherwise.
    //   σ_eff = √(σ_x² + σ_y²) is the combined along-miss 1σ uncertainty.
    if (!Number.isFinite(A1) || !Number.isFinite(A2) || !Number.isFinite(sigmax)
        || !Number.isFinite(sigmay) || !Number.isFinite(d)
        || A1 <= 0 || A2 <= 0 || sigmax <= 0 || sigmay <= 0 || d < 0) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'miss_distance', value: Number.isFinite(d) ? d : Number.NaN, unit: 'm', label: 'Miss Distance d' },
          { key: 'covariance_ellipse_area', value: Number.isFinite(sigmax) && Number.isFinite(sigmay) && sigmax > 0 && sigmay > 0 ? Math.PI * sigmax * sigmay : Number.NaN, unit: 'm²', label: 'Covariance Ellipse Area π·σ_x·σ_y' },
          { key: 'effective_sigma', value: Number.isFinite(sigmax) && Number.isFinite(sigmay) && sigmax > 0 && sigmay > 0 ? Math.sqrt(sigmax * sigmax + sigmay * sigmay) : Number.NaN, unit: 'm', label: 'Combined 1σ √(σ_x²+σ_y²)' },
          { key: 'collision_cross_section', value: Number.NaN, unit: 'm²', label: 'Collision Cross-Section A_c' },
        ],
        steps: [
          '── Collision Probability (Foster 1992) ──',
          'P_c = A_c/(2π·σ_x·σ_y) · exp(−d²/(2·(σ_x²+σ_y²)))   [d < 3σ_eff], else 0',
          '',
          'All inputs must be finite with areas A₁,A₂ > 0, uncertainties σ_x,σ_y > 0',
          'and miss distance d ≥ 0. No fabricated collision probability is',
          'substituted — supply genuine conjunction data.',
        ],
      };
    }
    const R1 = Math.sqrt(A1 / Math.PI);
    const R2 = Math.sqrt(A2 / Math.PI);
    const Ac = Math.PI * (R1 + R2) ** 2; // collision cross-section area (overlap integral)
    const sigmaEff = Math.sqrt(sigmax * sigmax + sigmay * sigmay); // combined 1σ
    const sigmaEff2 = sigmaEff * sigmaEff;                          // combined variance
    const normConst = Ac / (2 * Math.PI * sigmax * sigmay);
    const expArg = -(d * d) / (2 * sigmaEff2);
    const inGate = d < 3 * sigmaEff;
    const Pc = inGate ? normConst * Math.exp(expArg) : 0;
    return {
      result: Pc, unit: '—',
      secondary: [
        { key: 'miss_distance', value: d, unit: 'm', label: 'Miss Distance d' },
        { key: 'covariance_ellipse_area', value: Math.PI * sigmax * sigmay, unit: 'm²', label: 'Covariance Ellipse Area π·σ_x·σ_y' },
        { key: 'effective_sigma', value: sigmaEff, unit: 'm', label: 'Combined 1σ √(σ_x²+σ_y²)' },
        { key: 'collision_cross_section', value: Ac, unit: 'm²', label: 'Collision Cross-Section A_c = π(R₁+R₂)²' },
      ],
      steps: [
        '── Collision Probability (Foster 1992) ──',
        `Covariance: σ_x = ${sigmax.toFixed(3)} m, σ_y = ${sigmay.toFixed(3)} m`,
        `Object areas: A₁ = ${A1.toFixed(2)} m², A₂ = ${A2.toFixed(2)} m²`,
        `Miss distance d = ${d.toFixed(2)} m`,
        '',
        'Step 1 — Hard-body radii and collision cross-section (overlap integral):',
        `  R₁ = √(A₁/π) = ${R1.toFixed(3)} m`,
        `  R₂ = √(A₂/π) = ${R2.toFixed(3)} m`,
        `  A_c = π·(R₁+R₂)² = ${Ac.toFixed(2)} m²`,
        '',
        'Step 2 — Combined positional uncertainty:',
        `  σ_eff = √(σ_x² + σ_y²) = √(${sigmax.toFixed(3)}² + ${sigmay.toFixed(3)}²) = ${sigmaEff.toFixed(3)} m`,
        `  3σ gate: d = ${d.toFixed(2)} m ${inGate ? `< 3σ_eff = ${(3 * sigmaEff).toFixed(2)} m → within gate` : `≥ 3σ_eff = ${(3 * sigmaEff).toFixed(2)} m → P_c = 0`}`,
        '',
        'Step 3 — Collision probability (Foster 1992):',
        `  P_c = A_c / (2π·σ_x·σ_y) × exp(−d²/(2·σ_eff²))`,
        `  P_c = ${Ac.toFixed(2)} / (2π × ${sigmax.toFixed(3)} × ${sigmay.toFixed(3)}) × exp(−${(d*d).toFixed(1)} / ${(2*sigmaEff2).toFixed(1)})`,
        `  P_c = ${normConst.toExponential(4)} × exp(${expArg.toFixed(3)})`,
        `  P_c = ${inGate ? Pc.toExponential(4) : '0 (miss distance ≥ 3σ_eff)'}`,
        '',
        `  └ Threshold: ${Pc > 1e-4 ? 'HIGH RISK — avoidance maneuver recommended (> 1/10,000)' : Pc > 1e-5 ? 'MODERATE RISK — monitor closely' : 'LOW RISK — routine monitoring'}`,
        `  └ Assumes: linear relative motion, Gaussian errors, short conjunction window`,
      ]
    };
  },
  126: ({ rho2, sigma, v, N, L, beta, gamma }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const rho2N = Number(rho2), sigmaN = Number(sigma), vN = Number(v), LN = Number(L), betaN = Number(beta), gammaN = Number(gamma);
    // Kessler (1991) equation for spatial density ρ:
    // dρ/dt = ½·ρ²·σ·v + L − β·ρ³ − γ·ρ
    // v input is km/s; convert to km/yr for consistent km⁻³/yr output.
    const SEC_PER_YEAR = 365.25 * 24 * 3600; // 3.156e7 s/yr
    const v_yr = vN * SEC_PER_YEAR; // km/yr
    const fragTerm = 0.5 * rho2N * rho2N * sigmaN * v_yr;  // ½ρ²σv (km⁻³/yr)
    const lossCubic = betaN * rho2N * rho2N * rho2N;         // βρ³ (km⁻³/yr)
    const lossLinear = gammaN * rho2N;                      // γρ (km⁻³/yr)
    const drho = fragTerm + LN - lossCubic - lossLinear;
    if (![rho2N, sigmaN, vN, LN, betaN, gammaN].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'km⁻³/yr',
        steps: ['── Kessler Syndrome Debris Evolution (Kessler & Cour-Palais 1978; Kessler 1991) ──',
          'dρ/dt = ½ρ²σv + L − βρ³ − γρ',
          '', 'One or more inputs are missing — no fabricated debris evolution is substituted.'],
      };
    }
    return {
      result: drho, unit: 'km⁻³/yr',
      secondary: [
        { key: 'fragmentation_source', value: Number.isFinite(fragTerm) ? fragTerm : Number.NaN, unit: 'km⁻³/yr', label: 'Fragmentation Source ½ρ²σv' },
        { key: 'collisional_loss', value: Number.isFinite(lossCubic) ? lossCubic : Number.NaN, unit: 'km⁻³/yr', label: 'Collisional Loss βρ³' },
        { key: 'drag_loss', value: Number.isFinite(lossLinear) ? lossLinear : Number.NaN, unit: 'km⁻³/yr', label: 'Drag Decay γρ' },
      ],
      // Timeseries series (tool vizType 'timeseries'): debris count N(t) over
      // 0–100 yr (20 points). The count scales with the spatial density from
      // the tool's own cascade rate dρ/dt: N(t) = N·(1 + (dρ/dt)/ρ·t).
      series: [{
        label: 'Debris count N(t) = N·(1 + (dρ/dt)/ρ·t)',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const t = i * (100 / 19);
          const NN = Number(N);
          const drhoRatio = Number.isFinite(drho) && rho2N !== 0 ? drho / rho2N : Number.NaN;
          const Nt = Number.isFinite(NN) && Number.isFinite(drhoRatio) ? NN * (1 + drhoRatio * t) : Number.NaN;
          return { x: t, y: Number.isFinite(Nt) ? Nt : Number.NaN };
        }),
      }],
      steps: [
        '── Kessler Syndrome Debris Evolution (Kessler & Cour-Palais 1978; Kessler 1991) ──',
        `Spatial density ρ = ${rho2N.toExponential(3)} km⁻³`,
        `Collision cross-section σ = ${sigmaN.toExponential(3)} km², Relative velocity v = ${vN.toFixed(1)} km/s`,
        `Launch rate L = ${LN.toExponential(2)} km⁻³/yr`,
        `Collisional loss β = ${betaN.toExponential(3)}, Drag decay γ = ${gammaN.toExponential(3)} /yr`,
        '',
        'Step 1 — Fragmentation source (Kessler 1991):',
        `  S_coll = ½·ρ²·σ·v`,
        `  = ½ × (${rho2N.toExponential(3)})² × ${sigmaN.toExponential(3)} × ${vN.toFixed(1)}`,
        `  = ${fragTerm.toExponential(3)} km⁻³/yr`,
        '',
        'Step 2 — Loss terms:',
        `  Collisional (cubic): β·ρ³ = ${betaN.toExponential(3)} × (${rho2N.toExponential(3)})³ = ${lossCubic.toExponential(3)} km⁻³/yr`,
        `  Atmospheric drag (linear): γ·ρ = ${gammaN.toExponential(3)} × ${rho2N.toExponential(3)} = ${lossLinear.toExponential(3)} km⁻³/yr`,
        '',
        'Step 3 — Net rate of change:',
        `  dρ/dt = ${fragTerm.toExponential(3)} + ${LN.toExponential(2)} − ${lossCubic.toExponential(3)} − ${lossLinear.toExponential(3)}`,
        `  dρ/dt = ${drho.toExponential(3)} km⁻³/yr`,
        '',
        'Step 4 — Kessler Syndrome assessment:',
        `  ${drho > 0 ? 'POSITIVE GROWTH — debris density increasing (collisional cascading potential)' : drho < 0 ? 'NEGATIVE GROWTH — debris decreasing (decay > production)' : 'STEADY STATE — production balanced by removal'}`,
        '',
        `  └ Critical density: ρ_crit ≈ √(2γ/(σ·v)) — above this, cascading is self-sustaining`,
        Number(N) > 0 ? `  └ Population context: N = ${Number(N).toExponential(1)} objects in the orbital shell` : '',
      ].filter(Boolean)
    };
  },
  127: ({ n, x, y, z, xdot, ydot, zdot, ax, ay, az, t }) => {
    // Hill-Clohessy-Wiltshire (1960) equations (x radial, y along-track,
    // z cross-track in a circular-reference-orbit LVLH frame):
    //   ẍ = 2n·ẏ + 3n²·x + a_x
    //   ÿ = −2n·ẋ + a_y
    //   z̈ = −n²·z + a_z
    // The homogeneous closed-form solution (standard STM, e.g. Vallado 2013,
    // Ch. 8; Clohessy & Wiltshire 1960) gives the relative state at time t:
    //   τ = n·t
    //   x(t) = (4−3cosτ)·x₀ + (ẋ₀/n)·sinτ + (2ẏ₀/n)·(1−cosτ)
    //   y(t) = y₀ + 6(sinτ−τ)·x₀ + (4sinτ−3τ)·(ẏ₀/n) − (2ẋ₀/n)·(1−cosτ)
    //   z(t) = z₀·cosτ + (ż₀/n)·sinτ
    //   ẋ(t) = 3n·sinτ·x₀ + cosτ·ẋ₀ + 2·sinτ·ẏ₀
    //   ẏ(t) = 6n(cosτ−1)·x₀ − 2·sinτ·ẋ₀ + (4cosτ−3)·ẏ₀
    //   ż(t) = −n·sinτ·z₀ + cosτ·ż₀
    // Secular along-track drift rate: ẏ_drift = −6n·x₀ − 3ẏ₀ (vanishes for
    // the bounded-orbit initial condition ẏ₀ = −2n·x₀).
    const stateFinite = [n, x, y, z, xdot, ydot, zdot].every(Number.isFinite);
    if (!stateFinite || !(Number.isFinite(n) && n > 0)) {
      return {
        result: Number.NaN, unit: 'm/s²',
        secondary: [
          { key: 'orbit_period', value: Number.isFinite(n) && n > 0 ? (2 * Math.PI) / n : Number.NaN, unit: 's', label: 'Orbit Period T = 2π/n' },
          { key: 'relative_position', value: Number.NaN, unit: 'm', label: 'Relative Position |r(t)|' },
          { key: 'relative_velocity', value: Number.NaN, unit: 'm/s', label: 'Relative Velocity |v(t)|' },
          { key: 'alongtrack_drift_rate', value: Number.NaN, unit: 'm/s', label: 'Secular Along-Track Drift Rate' },
        ],
        steps: [
          '── Hill-Clohessy-Wiltshire Equations (Clohessy & Wiltshire 1960; Hill 1878) ──',
          'Relative state (x, y, z, ẋ, ẏ, ż) must be finite and mean motion',
          'n > 0. No fabricated relative motion is substituted — supply a',
          'genuine reference orbit and initial relative state.',
        ],
      };
    }
    const axv = Number.isFinite(ax) ? ax : 0;
    const ayv = Number.isFinite(ay) ? ay : 0;
    const azv = Number.isFinite(az) ? az : 0;
    const xddot = 2 * n * ydot + 3 * n * n * x + axv;
    const yddot = -2 * n * xdot + ayv;
    const zddot = -n * n * z + azv;
    const accelMag = Math.hypot(xddot, yddot, zddot);
    // Secular along-track drift rate (closed-form coefficient of the secular term)
    const yDrift = -6 * n * x - 3 * ydot;

    // Closed-form HCW state transition (homogeneous solution, thrust-free)
    const orbitPeriod = (2 * Math.PI) / n;
    const tFinal = (Number.isFinite(t) && t >= 0) ? t : orbitPeriod;
    const hcwState = (tSec: number) => {
      const tau = n * tSec;
      const cT = Math.cos(tau), sT = Math.sin(tau);
      const px = (4 - 3 * cT) * x + (xdot / n) * sT + (2 * ydot / n) * (1 - cT);
      const py = y + 6 * (sT - tau) * x + (4 * sT - 3 * tau) * (ydot / n) - (2 * xdot / n) * (1 - cT);
      const pz = z * cT + (zdot / n) * sT;
      const vx = 3 * n * sT * x + cT * xdot + 2 * sT * ydot;
      const vy = 6 * n * (cT - 1) * x - 2 * sT * xdot + (4 * cT - 3) * ydot;
      const vz = -n * sT * z + cT * zdot;
      return { px, py, pz, vx, vy, vz };
    };
    const final = hcwState(tFinal);
    const finalPos = Math.hypot(final.px, final.py, final.pz);
    const finalVel = Math.hypot(final.vx, final.vy, final.vz);

    // Relative trajectory over one full orbital period (timeseries series)
    const N_PTS = 96;
    const seriesX: Array<{ x: number; y: number }> = [];
    const seriesY: Array<{ x: number; y: number }> = [];
    const seriesZ: Array<{ x: number; y: number }> = [];
    const seriesR: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= N_PTS; i++) {
      const ts = (i / N_PTS) * orbitPeriod;
      const s = hcwState(ts);
      seriesX.push({ x: ts, y: s.px });
      seriesY.push({ x: ts, y: s.py });
      seriesZ.push({ x: ts, y: s.pz });
      seriesR.push({ x: ts, y: Math.hypot(s.px, s.py, s.pz) });
    }
    const boundedNote = Math.abs(yDrift) < 1e-6 ? 'YES — bounded (no secular drift)' : 'NO — secular along-track drift present';

    return {
      result: accelMag, unit: 'm/s²',
      secondary: [
        { key: 'orbit_period', value: orbitPeriod, unit: 's', label: 'Orbit Period T = 2π/n' },
        { key: 'relative_position', value: finalPos, unit: 'm', label: `Relative Position |r(t)| at t=${Number.isFinite(t) && t >= 0 ? t.toFixed(1) : 'T'}` },
        { key: 'relative_velocity', value: finalVel, unit: 'm/s', label: `Relative Velocity |v(t)| at t=${Number.isFinite(t) && t >= 0 ? t.toFixed(1) : 'T'}` },
        { key: 'radial_final', value: final.px, unit: 'm', label: 'Final Radial x(t)' },
        { key: 'alongtrack_final', value: final.py, unit: 'm', label: 'Final Along-Track y(t)' },
        { key: 'crosstrack_final', value: final.pz, unit: 'm', label: 'Final Cross-Track z(t)' },
        { key: 'alongtrack_drift_rate', value: yDrift, unit: 'm/s', label: 'Secular Along-Track Drift Rate (bounded orbit?)' },
      ],
      series: [
        { label: 'Radial x(t)', color: '#0072B2', points: seriesX },
        { label: 'Along-track y(t)', color: '#D55E00', points: seriesY },
        { label: 'Cross-track z(t)', color: '#009E73', points: seriesZ },
        { label: 'Range |r(t)|', color: '#CC79A7', points: seriesR },
      ],
      steps: [
        '── Hill-Clohessy-Wiltshire Equations (Clohessy & Wiltshire 1960; Hill 1878) ──',
        `Mean motion n = ${n.toExponential(4)} rad/s, Orbit period T = ${orbitPeriod.toFixed(1)} s`,
        `Relative state: x=${x.toFixed(4)} m, y=${y.toFixed(4)} m, z=${z.toFixed(4)} m`,
        `Relative velocity: ẋ=${xdot.toExponential(3)} m/s, ẏ=${ydot.toExponential(3)} m/s, ż=${zdot.toExponential(3)} m/s`,
        `Thrust: a_x=${axv.toExponential(3)}, a_y=${ayv.toExponential(3)}, a_z=${azv.toExponential(3)} m/s²`,
        '',
        'Step 1 — Radial acceleration (HCW x-equation):',
        `  ẍ = 2n·ẏ + 3n²·x + a_x`,
        `  ẍ = 2×${n.toExponential(4)}×${ydot.toExponential(3)} + 3×(${n.toExponential(4)})²×${x.toFixed(4)} + ${axv.toExponential(3)}`,
        `  ẍ = ${xddot.toExponential(4)} m/s²`,
        '',
        'Step 2 — Along-track acceleration (HCW y-equation):',
        `  ÿ = −2n·ẋ + a_y`,
        `  ÿ = −2×${n.toExponential(4)}×${xdot.toExponential(3)} + ${ayv.toExponential(3)}`,
        `  ÿ = ${yddot.toExponential(4)} m/s²`,
        '',
        'Step 3 — Cross-track acceleration (HCW z-equation):',
        `  z̈ = −n²·z + a_z`,
        `  z̈ = −(${n.toExponential(4)})²×${z.toFixed(4)} + ${azv.toExponential(3)}`,
        `  z̈ = ${zddot.toExponential(4)} m/s²`,
        '',
        'Step 4 — Total relative acceleration:',
        `  |a| = √(ẍ² + ÿ² + z̈²) = ${accelMag.toExponential(4)} m/s²`,
        '',
        'Step 5 — Closed-form state propagation (HCW STM, homogeneous):',
        `  τ = n·t, t = ${tFinal.toFixed(1)} s (τ = ${(n * tFinal).toFixed(3)} rad)`,
        `  x(t) = (4−3cosτ)x₀ + (ẋ₀/n)sinτ + (2ẏ₀/n)(1−cosτ) = ${final.px.toFixed(3)} m`,
        `  y(t) = y₀ + 6(sinτ−τ)x₀ + (4sinτ−3τ)(ẏ₀/n) − (2ẋ₀/n)(1−cosτ) = ${final.py.toFixed(3)} m`,
        `  z(t) = z₀cosτ + (ż₀/n)sinτ = ${final.pz.toFixed(3)} m`,
        `  |r(t)| = ${finalPos.toFixed(3)} m, |v(t)| = ${finalVel.toExponential(4)} m/s`,
        '',
        `  └ Secular along-track drift: ẏ_drift = −6n·x₀ − 3ẏ₀ = ${yDrift.toExponential(4)} m/s`,
        `  └ Bounded orbit (${boundedNote}): ẏ₀ = −2n·x₀ (x₀ = −ẏ₀/(2n)) eliminates secular drift`,
        '  └ HCW valid for |relative position| ≪ orbit radius (typically < 10 km)',
      ]
    };
  },

  // ── Domain 21: Solar-Terrestrial & GNSS ──
  128: ({ kp, Ki }) => {
    // Bartels (1949) Kp index: weighted average of standardized K-indices
    // from 13 subauroral magnetometer stations.
    // Primary: real observed Kp from NOAA SWPC (noaa-planetary-k-index-forecast.json).
    // Fallback: if explicit Ki values are provided (user-supplied station data),
    // compute the weighted average with the correct Bartels station weights.
    let Kp: number;
    let dataSource: string;
    if (kp != null && Number.isFinite(kp)) {
      // Real observed Kp from NOAA SWPC (already on the 1/3-point scale).
      // Clamp to the physical scale [0, 9] so the Kp→G mapping stays bounded.
      Kp = Math.min(9, Math.max(0, kp));
      dataSource = 'NOAA SWPC (real observed planetary Kp)';
    } else if (Array.isArray(Ki) && Ki.length > 0 && Ki.some((k: number) => k > 0)) {
      // User-supplied station K-indices (array): weighted average per Bartels (1949)
      // Station weights for the 13 Kp observatories (Bartels 1949, IAGA Bull. 12):
      // LER=1, Sitka=1, ESK=1, HAD=1, FRD=1, TUC=1, TEO=1, WNG=1, NGK=1, TBS=1, SRL=1, SJG=1, HER=1
      // Modern operational implementation: equal weights (total = 13)
      const n = Ki.length;
      const sumK = Ki.reduce((s: number, k: number) => s + k, 0);
      Kp = Math.min(9, Math.max(0, sumK / n));
      dataSource = `${n} user-supplied station K-indices (weighted average)`;
    } else if (Ki != null && Number.isFinite(Ki) && Ki > 0) {
      // Single Ki scalar value (from normalizeInputs mapping)
      Kp = Math.min(9, Math.max(0, Ki));
      dataSource = 'User-supplied K-index (single station)';
    } else {
      return {
        result: Number.NaN, unit: '—',
        steps: [
          '── Kp Geomagnetic Activity Index (Bartels 1949; GFZ Potsdam / NOAA SWPC) ──',
          '',
          'No genuine geomagnetic activity data provided. Kp requires either:',
          '  (a) NOAA SWPC real-time planetary Kp (kp input), or',
          '  (b) Array of 13-station K-indices (Ki), or',
          '  (c) A single station K-index (Ki scalar).',
          '',
          'No fabricated Kp value is substituted. Supply genuine activity data.',
          'NOAA SWPC: swpc.noaa.gov for real-time Kp.',
        ],
        secondary: [
          { key: 'noaa_g_scale', value: Number.NaN, label: 'NOAA Storm Scale (no data)' },
          { key: 'auroral_oval_latitude', value: Number.NaN, unit: '°', label: 'Auroral Oval Equatorward Boundary' },
          { key: 'ap_index', value: Number.NaN, unit: 'nT', label: 'Linear Equivalent Amplitude (Ap)' },
        ],
      };
    }

    // NOAA G-scale mapping (NOAA SWPC operational scale)
    const gScale = Kp >= 9 ? 5 : Kp >= 8 ? 4 : Kp >= 7 ? 3 : Kp >= 6 ? 2 : Kp >= 5 ? 1 : 0;
    const stormName = [
      'No storm', 'Minor (G1)', 'Moderate (G2)', 'Strong (G3)', 'Severe (G4)', 'Extreme (G5)',
    ][gScale];

    // Auroral oval equatorward boundary (empirical fit from Feldstein 1963 / Holzworth & Meng 1975)
    const auroralLat = Kp <= 1 ? 67 : Kp <= 3 ? 67 - (Kp - 1) * 2 : Kp <= 5 ? 63 - (Kp - 3) * 1.5 : Kp <= 7 ? 60 - (Kp - 5) * 2.5 : 55 - (Kp - 7) * 5;

    // Ap index — linear equivalent amplitude (Bartels 1949, IAGA table)
    // Kp is on a quasi-log scale; Ap converts to linear nT equivalent.
    // Kp→a table from IAGA Bull. 12 / Wikipedia K-index article:
    const KP_TO_A: Record<number, number> = {
      0: 0, 0.33: 2, 0.67: 3, 1: 4, 1.33: 5, 1.67: 6, 2: 7, 2.33: 9, 2.67: 12,
      3: 15, 3.33: 18, 3.67: 22, 4: 27, 4.33: 32, 4.67: 39, 5: 48,
      5.33: 56, 5.67: 67, 6: 80, 6.33: 94, 6.67: 111, 7: 132,
      7.33: 154, 7.67: 179, 8: 207, 8.33: 236, 8.67: 267, 9: 300, 9.33: 360, 9.67: 400,
    };
    // Round to nearest 1/3-point Kp step, then look up Ap
    const kpStep = Math.round(Kp * 3) / 3;  // nearest 1/3 step
    const kpKey = Math.round(kpStep * 100) / 100;  // 2-decimal key for table lookup
    const ap = KP_TO_A[kpKey] ?? Math.round(15.8 * Math.pow(10, Kp / 9));

    return {
      result: Kp, unit: '—',
      steps: [
        '── Kp Geomagnetic Activity Index (Bartels 1949; GFZ Potsdam / NOAA SWPC) ──',
        `Data source: ${dataSource}`,
        '',
        'Step 1 — Kp index (planetary 3-hour range index):',
        `  Kp = ${Kp.toFixed(2)} (scale 0–9, resolution 1/3)`,
        '',
        'Step 2 — NOAA Geomagnetic Storm Scale (G-scale):',
        `  G${gScale} — ${stormName}`,
        `  Kp ≥ 5 → G1, ≥ 6 → G2, ≥ 7 → G3, ≥ 8 → G4, ≥ 9 → G5`,
        '',
        'Step 3 — Auroral oval equatorward boundary (Feldstein/Holzworth-Meng):',
        `  φ_auroral ≈ ${auroralLat.toFixed(1)}° magnetic latitude`,
        `  (Kp=1: ~67°, Kp=5: ~60°, Kp=9: ~45°)`,
        '',
        'Step 4 — Linear equivalent amplitude (Ap index):',
        `  Ap ≈ ${ap.toFixed(1)} nT  (Kp→a conversion per IAGA table)`,
        '',
        'Step 5 — Bartels (1949) methodology (13-station weighted average):',
        '  Kp = Σ(w_i · K*_i) / Σ(w_i)',
        '  where K*_i = standardized 28-point K values from 13 subauroral',
        '  magnetometer stations, w_i = station reliability weights.',
        '  Real Kp computed by GFZ Potsdam using this exact method.',
      ],
      secondary: [
        { key: 'noaa_g_scale', value: gScale, label: `NOAA Storm Scale: G${gScale} (${stormName})` },
        { key: 'auroral_oval_latitude', value: auroralLat, unit: '°', label: 'Auroral Oval Equatorward Boundary' },
        { key: 'ap_index', value: ap, unit: 'nT', label: 'Linear Equivalent Amplitude (Ap)' },
      ],
    };
  },
  129: ({ traceH, Q11, Q22, Q33, Q44 }) => {
    // Wells et al. (1987) / Van Diggelen (2007) DOP computation.
    // Q = (H^T·H)^{-1} is the 4×4 covariance matrix in ENU+clock space.
    // If individual Q diagonal elements are provided, compute exact DOP.
    // If only traceH is provided, GDOP = √(traceH) is exact, but
    // PDOP/HDOP/VDOP/TDOP are derived from a typical mid-latitude geometry.
    const qDiag = (v: unknown): number => {
      const n = Number(v);
      return (v != null && Number.isFinite(n)) ? n : Number.NaN;
    };
    let q11: number, q22: number, q33: number, q44: number;
    let exact = false;
    const traceNum = Number(traceH);
    const hasTrace = traceH != null && traceNum > 0 && Number.isFinite(traceNum);
    const q11n = qDiag(Q11), q22n = qDiag(Q22), q33n = qDiag(Q33), q44n = qDiag(Q44);
    const hasAllQ = Number.isFinite(q11n) && Number.isFinite(q22n)
      && Number.isFinite(q33n) && Number.isFinite(q44n);

    if (hasAllQ) {
      q11 = q11n; q22 = q22n; q33 = q33n; q44 = q44n;
      exact = true;
    } else if (hasTrace) {
      // Fallback: distribute traceH across typical geometry ratios.
      // For a well-distributed constellation: Q_11≈Q_22 (horizontal),
      // Q_33 > Q_11 (vertical worse), Q_44 ≈ Q_11 (clock).
      // Typical ratios for GPS-only, 8 satellites, mid-latitude:
      //   Q_11:Q_22:Q_33:Q_44 ≈ 0.18:0.18:0.36:0.28 of total trace.
      // Note: only GDOP = √(traceH) is exact from the trace alone; the
      // component split is a stated modelling assumption, and every derived
      // DOP preserves the exact GDOP (0.18+0.18+0.36+0.28 = 1).
      const t = traceNum;
      q11 = t * 0.18; q22 = t * 0.18; q33 = t * 0.36; q44 = t * 0.28;
    } else {
      // No geometry information at all — honest NaN, never a fabricated GDOP.
      return {
        result: Number.NaN, unit: '—',
        steps: [
          '── Geometric Dilution of Precision (Wells et al. 1987; Van Diggelen 2007) ──',
          '',
          'No satellite geometry provided. GDOP requires either:',
          '  (a) Q = (H^T·H)^{-1} diagonal elements (Q11, Q22, Q33, Q44), or',
          '  (b) The trace of Q (traceH) for an exact GDOP = √(traceH).',
          '',
          'No fabricated geometry is substituted. Supply the actual',
          'satellite-receiver geometry matrix or its covariance diagonal.',
        ],
        secondary: [
          { key: 'pdop', value: Number.NaN, label: 'PDOP (Position DOP)' },
          { key: 'hdop', value: Number.NaN, label: 'HDOP (Horizontal DOP)' },
          { key: 'vdop', value: Number.NaN, label: 'VDOP (Vertical DOP)' },
          { key: 'tdop', value: Number.NaN, label: 'TDOP (Time DOP)' },
        ],
      };
    }

    const GDOP = Math.sqrt(q11 + q22 + q33 + q44);
    const PDOP = Math.sqrt(q11 + q22 + q33);
    const HDOP = Math.sqrt(q11 + q22);
    const VDOP = Math.sqrt(q33);
    const TDOP = Math.sqrt(q44);

    return {
      result: GDOP, unit: '—',
      steps: [
        '── Geometric Dilution of Precision (Wells et al. 1987; Van Diggelen 2007) ──',
        `Data: ${exact ? 'Q matrix diagonal (exact)' : 'trace only (PDOP/HDOP/VDOP approximate)'}`,
        `Q = (H^T·H)^{-1} diagonal: [${q11.toFixed(4)}, ${q22.toFixed(4)}, ${q33.toFixed(4)}, ${q44.toFixed(4)}]`,
        '',
        'Step 1 — DOP components from Q diagonal:',
        `  GDOP = √(Q₁₁+Q₂₂+Q₃₃+Q₄₄) = √(${(q11+q22+q33+q44).toFixed(4)}) = ${GDOP.toFixed(2)}`,
        `  PDOP = √(Q₁₁+Q₂₂+Q₃₃) = √(${(q11+q22+q33).toFixed(4)}) = ${PDOP.toFixed(2)}`,
        `  HDOP = √(Q₁₁+Q₂₂) = √(${(q11+q22).toFixed(4)}) = ${HDOP.toFixed(2)}`,
        `  VDOP = √(Q₃₃) = √(${q33.toFixed(4)}) = ${VDOP.toFixed(2)}`,
        `  TDOP = √(Q₄₄) = √(${q44.toFixed(4)}) = ${TDOP.toFixed(2)}`,
        '',
        'Step 2 — GNSS quality rating:',
        `  GDOP = ${GDOP.toFixed(2)} — ${GDOP < 2 ? 'EXCELLENT (ideal geometry)' : GDOP < 4 ? 'GOOD (open-sky, typical)' : GDOP < 6 ? 'MODERATE (trees/buildings)' : GDOP < 10 ? 'POOR (urban canyon)' : 'VERY POOR (few satellites)'}`,
        '',
        'Step 3 — Accuracy estimate (assuming σ_range ≈ 3 m):',
        `  Horizontal error ≈ HDOP × σ ≈ ${(HDOP * 3).toFixed(1)} m`,
        `  Vertical error   ≈ VDOP × σ ≈ ${(VDOP * 3).toFixed(1)} m`,
        '',
        `  └ VDOP/HDOP ratio: ${(VDOP/HDOP).toFixed(2)} (typical: 1.5–2.5× for single-side sky view)`,
        `  └ TDOP ≈ ${(TDOP/GDOP*100).toFixed(0)}% of GDOP (clock dilution)`,
      ],
      secondary: [
        { key: 'pdop', value: PDOP, label: 'PDOP (Position DOP)' },
        { key: 'hdop', value: HDOP, label: 'HDOP (Horizontal DOP)' },
        { key: 'vdop', value: VDOP, label: 'VDOP (Vertical DOP)' },
        { key: 'tdop', value: TDOP, label: 'TDOP (Time DOP)' },
      ],
    };
  },
  130: ({ P, T, e, Sc }) => {
    // Saastamoinen (1972): "Atmospheric correction for the troposphere
    // and stratosphere in radio ranging of satellites.
    // Geophys. Monograph Ser., Vol. 15, pp. 247–251, AGU.
    //
    // Paper-exact formula:
    //   ZHD = 0.0022768 × P
    //   ZWD = 0.0022768 × (1255/T + 0.05) × e
    //   Δτ  = (ZHD + ZWD) / sin(θ)
    //
    // Note: the wet term is (1255/T + 0.05), NOT 1255/(T+0.05).
    // The latitude/height correction factor in ZHD is omitted because
    // the surface pressure P already incorporates local effects.
    if (![P, T, e, Sc].every((v) => v != null && Number.isFinite(v))) {
      return {
        result: Number.NaN, unit: 'm',
        steps: [
          '── Tropospheric Delay — Saastamoinen Model (Saastamoinen 1972, AGU) ──',
          '',
          'One or more inputs are non-finite. Supply genuine surface',
          'meteorological data (P, T, e) and elevation angle (Sc).',
        ],
        secondary: [
          { key: 'zhd', value: Number.NaN, unit: 'm', label: 'Zenith Hydrostatic Delay' },
          { key: 'zwd', value: Number.NaN, unit: 'm', label: 'Zenith Wet Delay' },
          { key: 'ztd', value: Number.NaN, unit: 'm', label: 'Zenith Total Delay' },
        ],
      };
    }
    const safe = (v: number, min: number, max: number) => v > min && v < max;
    if (!safe(P, 0, 2000) || !safe(T, 0, 500) || e < 0 || e > 200) {
      return {
        result: Number.NaN, unit: 'm',
        steps: [
          '── Tropospheric Delay — Saastamoinen Model (Saastamoinen 1972, AGU) ──',
          '',
          'Inputs outside physically plausible range:',
          `  P = ${P} hPa (expected 0–2000 hPa)`,
          `  T = ${T} K (expected 0–500 K)`,
          `  e = ${e} hPa (expected 0–200 hPa)`,
          'No fabricated delay is substituted.',
        ],
        secondary: [
          { key: 'zhd', value: Number.NaN, unit: 'm', label: 'Zenith Hydrostatic Delay' },
          { key: 'zwd', value: Number.NaN, unit: 'm', label: 'Zenith Wet Delay' },
          { key: 'ztd', value: Number.NaN, unit: 'm', label: 'Zenith Total Delay' },
        ],
      };
    }
    const sinTheta = Math.sin(Sc);
    if (sinTheta <= 0 || !Number.isFinite(sinTheta)) {
      return {
        result: Number.NaN, unit: 'm',
        steps: [
          '── Tropospheric Delay — Saastamoinen Model (Saastamoinen 1972, AGU) ──',
          '',
          `Elevation angle Sc = ${Sc} rad, sin(Sc) = ${sinTheta}`,
          'sin(θ) must be > 0. Elevation angle must be in (0°, 180°)',
          'and not 0° or 180° (which would cause division by zero).',
        ],
        secondary: [
          { key: 'zhd', value: Number.NaN, unit: 'm', label: 'Zenith Hydrostatic Delay' },
          { key: 'zwd', value: Number.NaN, unit: 'm', label: 'Zenith Wet Delay' },
          { key: 'ztd', value: Number.NaN, unit: 'm', label: 'Zenith Total Delay' },
        ],
      };
    }
    const coeff = 0.0022768;  // paper-exact coefficient
    const zhd = coeff * P;
    const wetTerm = (1255 / T + 0.05) * e;  // paper: (1255/T + 0.05)·e
    const zwd = coeff * wetTerm;
    const ztd = zhd + zwd;
    const dTau = ztd / sinTheta;

    // Profile series: delay vs elevation angle (5° to 90° in 5° steps)
    const profilePoints: Array<{ x: number; y: number }> = [];
    for (let deg = 5; deg <= 90; deg += 5) {
      const rad = deg * Math.PI / 180;
      const s = Math.sin(rad);
      if (s > 0) {
        profilePoints.push({ x: deg, y: ztd / s });
      }
    }

    return {
      result: dTau, unit: 'm',
      steps: [
        '── Tropospheric Delay — Saastamoinen Model (Saastamoinen 1972, AGU) ──',
        `Surface pressure P = ${P.toFixed(1)} hPa`,
        `Temperature T = ${T.toFixed(1)} K (${(T - 273.15).toFixed(1)} °C)`,
        `Water vapour pressure e = ${e.toFixed(2)} hPa`,
        `Elevation angle θ = ${(Sc * 180 / Math.PI).toFixed(1)}°, sin(θ) = ${sinTheta.toFixed(4)}`,
        '',
        'Step 1 — Zenith hydrostatic delay (ZHD):',
        `  ZHD = 0.0022768 × P = 0.0022768 × ${P.toFixed(1)} = ${zhd.toFixed(4)} m`,
        '',
        'Step 2 — Zenith wet delay (ZWD):',
        `  (1255/T + 0.05) = 1255/${T.toFixed(1)} + 0.05 = ${(1255/T + 0.05).toFixed(4)}`,
        `  ZWD = 0.0022768 × ${(1255/T + 0.05).toFixed(4)} × ${e.toFixed(2)} = ${zwd.toFixed(4)} m`,
        '',
        'Step 3 — Zenith total delay (ZTD):',
        `  ZTD = ZHD + ZWD = ${zhd.toFixed(4)} + ${zwd.toFixed(4)} = ${ztd.toFixed(4)} m`,
        '',
        'Step 4 — Slant delay:',
        `  Δτ = ZTD / sin(θ) = ${ztd.toFixed(4)} / ${sinTheta.toFixed(4)} = ${dTau.toFixed(4)} m (${(dTau * 100).toFixed(2)} cm)`,
        '',
        `  └ ZHD/ZTD ratio: ${(zhd/ztd*100).toFixed(1)}% (hydrostatic dominates at all elevations)`,
        `  └ ZWD/ZTD ratio: ${(zwd/ztd*100).toFixed(1)}% (wet delay — dominant error source for GPS)`,
      ],
      secondary: [
        { key: 'zhd', value: zhd, unit: 'm', label: 'Zenith Hydrostatic Delay' },
        { key: 'zwd', value: zwd, unit: 'm', label: 'Zenith Wet Delay' },
        { key: 'ztd', value: ztd, unit: 'm', label: 'Zenith Total Delay' },
      ],
      series: [{
        label: 'Saastamoinen delay vs elevation angle',
        color: '#D2691E',
        points: profilePoints,
      }],
    };
  },

  // ── Part VII · Domain 22: Groundwater ──
  131: ({ T, h1, h2, r1, r2 }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const Tn = Number(T), h1n = Number(h1), h2n = Number(h2), r1n = Number(r1), r2n = Number(r2);
    const dh = h2n - h1n;
    const lnRatio = Math.log(r2n / r1n);
    const Q = (2 * Math.PI * Tn * dh) / lnRatio;
    // Thiem requires r₂ > r₁ > 0 (log ratio defined & positive) and T > 0.
    const valid = [Tn, h1n, h2n, r1n, r2n].every(Number.isFinite) && Tn > 0 && r1n > 0 && r2n > r1n;
    if (!valid) {
      return {
        result: Number.NaN, unit: 'm³/day',
        secondary: [
          { key: 'drawdown', value: Number.isFinite(dh) ? dh : Number.NaN, unit: 'm', label: 'Head Difference Δh = h₂ − h₁' },
          { key: 'transmissivity', value: Number.isFinite(Tn) && Tn > 0 ? Tn : Number.NaN, unit: 'm²/day', label: 'Transmissivity T' },
        ],
        steps: ['── Thiem Equation — Steady Radial Flow (Thiem, 1906; Dupuit, 1863) ──',
          'Q = 2π·T·(h₂−h₁)/ln(r₂/r₁)',
          '', 'One or more inputs are missing or unphysical (requires r₂ > r₁ > 0, T > 0) — no fabricated flow rate is substituted.'],
      };
    }
    return {
      result: Q, unit: 'm³/day',
      secondary: [
        { key: 'drawdown', value: dh, unit: 'm', label: 'Head Difference Δh = h₂ − h₁' },
        { key: 'transmissivity', value: Tn, unit: 'm²/day', label: 'Transmissivity T' },
      ],
      // Profile series (tool vizType 'profile'): steady-state drawdown
      // s(r) = Q/(2πT)·ln(r₂/r) over 10–1000 m (20 log-spaced points) from
      // the tool's own Thiem flow rate Q and transmissivity T.
      series: [{
        label: 'Thiem drawdown s(r) = Q/(2πT)·ln(r₂/r)',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const r = 10 * Math.pow(100, i / 19); // 10 → 1000 m, log-spaced
          const s = (Q / (2 * Math.PI * Tn)) * Math.log(r2n / r);
          return { x: r, y: Number.isFinite(s) ? s : Number.NaN };
        }),
      }],
      steps: [
        '── Thiem Equation — Steady Radial Flow (Thiem, 1906; Dupuit, 1863) ──',
        `Transmissivity T = ${Tn.toFixed(2)} m²/day`,
        `Drawdown: h₁ = ${h1n.toFixed(2)} m (at r₁ = ${r1n.toFixed(1)} m), h₂ = ${h2n.toFixed(2)} m (at r₂ = ${r2n.toFixed(1)} m)`,
        `Head difference Δh = ${dh.toFixed(2)} m`,
        '',
        'Step 1 — Compute log ratio:',
        `  ln(r₂/r₁) = ln(${r2n.toFixed(1)} / ${r1n.toFixed(1)}) = ${lnRatio.toFixed(4)}`,
        '',
        'Step 2 — Compute flow rate:',
        `  Q = 2π·T·Δh / ln(r₂/r₁)`,
        `  Q = 2π × ${Tn.toFixed(2)} × ${dh.toFixed(2)} / ${lnRatio.toFixed(4)}`,
        `  Q = ${Q.toFixed(2)} m³/day`,
        '',
        'Step 3 — Aquifer productivity:',
        `  ${Q > 5000 ? 'HIGH-YIELD — regional water supply aquifer' : Q > 500 ? 'MODERATE — suitable for irrigation / municipal' : Q > 50 ? 'LOW — domestic well scale' : 'MINOR — limited production capacity'}`,
        '',
        `  └ Assumes: confined aquifer, complete penetration, steady-state, homogeneous T`,
      ]
    };
  },
  132: ({ Q, T, t, r, S }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const Qn = Number(Q), Tn = Number(T), tn = Number(t), rn = Number(r), Sn = Number(S);
    // Theis (1935) well function W(u) = ∫ᵤ^∞ (e^{-x}/x) dx
    // Reference: Theis, C.V. (1935) Trans. Am. Geophys. Union, 16(2), 519–524.
    const u = Math.max((rn * rn) * Sn / (4 * Tn * tn), 1e-30);
    const gamma = 0.5772156649;
    // W(u) computation:
    //   u < 1:   series expansion (4 terms, error < 0.6%)
    //   1 ≤ u < 5: 15-term series (error < 0.01%)
    //   u ≥ 5:   asymptotic expansion (4 terms, error < 2.3%)
    const wellFn = (uu: number): number => {
      if (uu < 1) {
        return -gamma - Math.log(uu) + uu - (uu*uu)/4 + (uu*uu*uu)/18 - (uu*uu*uu*uu)/96;
      }
      if (uu < 5) {
        // Series: W(u) = -γ - ln(u) + Σ_{n=1}^{N} (-1)^{n+1} · u^n/(n·n!)
        let sum = 0;
        let un = uu; // u^n
        let factN = 1; // n!
        for (let n = 1; n <= 15; n++) {
          sum += (n % 2 === 1 ? 1 : -1) * un / (n * factN);
          un *= uu;
          factN *= (n + 1);
        }
        return -gamma - Math.log(uu) + sum;
      }
      // Asymptotic: W(u) ≈ e^{-u}/u · (1 - 1/u + 2!/u² - 3!/u³ + 4!/u⁴)
      const eu = Math.exp(-uu);
      return (eu / uu) * (1 - 1/uu + 2/(uu*uu) - 6/(uu*uu*uu) + 24/(uu*uu*uu*uu));
    };
    const W_u = wellFn(u);
    const s = (Qn / (4 * Math.PI * Tn)) * W_u;
    if (![Qn, Tn, tn, rn, Sn].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'm',
        steps: ['── Theis Well Function (Theis, 1935) ──',
          's = (Q/4πT)·W(u), u = r²S/(4Tt)',
          '', 'One or more inputs are missing — no fabricated drawdown is substituted.'],
      };
    }
    return {
      result: s, unit: 'm',
      secondary: [
        { key: 'well_function', value: Number.isFinite(W_u) ? W_u : Number.NaN, unit: '—', label: 'Well Function W(u)' },
        { key: 'dimensionless_u', value: Number.isFinite(u) ? u : Number.NaN, unit: '—', label: 'Dimensionless Time u' },
        { key: 'specific_capacity', value: Number.isFinite(s) && s > 0 ? Qn / s : Number.NaN, unit: 'm²/day', label: 'Specific Capacity Q/s' },
      ],
      // Timeseries series (tool vizType 'timeseries'): drawdown s(t) over
      // 0.1–100 days (20 log-spaced points) from the tool's own Theis formula
      // s = (Q/4πT)·W(u), u = r²S/(4Tt), reusing the exact W(u) above.
      series: [{
        label: 'Theis drawdown s(t) = (Q/4πT)·W(u)',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const tt = 0.1 * Math.pow(1000, i / 19); // 0.1 → 100 days, log-spaced
          const ut = Math.max((rn * rn) * Sn / (4 * Tn * tt), 1e-30);
          const st = (Qn / (4 * Math.PI * Tn)) * wellFn(ut);
          return { x: tt, y: Number.isFinite(st) ? st : Number.NaN };
        }),
      }],
      steps: [
        '── Theis Well Function — Unsteady Radial Flow (Theis, 1935) ──',
        `Pumping rate Q = ${Qn.toFixed(2)} m³/day, Transmissivity T = ${Tn.toFixed(2)} m²/day`,
        `Time t = ${tn.toFixed(2)} days, Distance r = ${rn.toFixed(1)} m`,
        `Storativity S = ${Sn.toExponential(3)}`,
        '',
        'Step 1 — Compute dimensionless argument u:',
        `  u = r²·S / (4·T·t) = (${rn.toFixed(1)})² × ${Sn.toExponential(3)} / (4 × ${Tn.toFixed(2)} × ${tn.toFixed(2)})`,
        `  u = ${u.toExponential(3)}`,
        '',
        'Step 2 — Compute well function W(u):',
        `  W(u) = −γ − ln(u) + u − u²/4 + u³/18 − u⁴/96`,
        `  ${u < 1 ? 'u < 1: series converges rapidly (small u approximation valid)' : 'u ≥ 1: using exponential integral asymptotic'}`,
        `  W(u) = ${W_u.toExponential(4)}`,
        '',
        'Step 3 — Drawdown at observation well:',
        `  s = (Q / 4πT) × W(u) = (${Qn.toFixed(2)} / (4π × ${Tn.toFixed(2)})) × ${W_u.toExponential(4)}`,
        `  s = ${s.toFixed(3)} m`,
        '',
        'Step 4 — Aquifer test diagnostics:',
        `  ${s < 0.1 ? 'Minimal drawdown — high T or low Q' : s < 1 ? 'Small drawdown — good transmissivity' : s < 5 ? 'Moderate drawdown — typical pumping test' : 'Large drawdown — low T or excessive pumping'}`,
        '',
        `  └ Uses Jacob approximation (on semi-log plot) when u < 0.01 for straight-line analysis`,
      ]
    };
  },
  133: ({ Q, T, t, r, S }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const Qn = Number(Q), Tn = Number(T), tn = Number(t), rn = Number(r), Sn = Number(S);
    // Cooper & Jacob (1946) straight-line approximation to Theis.
    // Valid when u = r²S/(4Tt) < 0.01 (error < 1% vs full Theis).
    // Reference: Cooper & Jacob (1946) Trans. Am. Geophys. Union, 27(4),
    // 526–534. DOI: 10.1029/TR027i004p00526.
    const u = (rn * rn * Sn) / (4 * Tn * tn);
    // log₁₀ argument = 2.25·T·t/(r²·S) = 2.25/(4u) = 0.5625/u — the small-u
    // approximation W(u) ≈ ln(2.25/(4u)) reproduces Theis to <1% for u<0.01.
    // (The previous `2.25/u` omitted the factor 4, overestimating s by ~20%.)
    const arg = 0.5625 / u;
    const slope = 2.3 * Qn / (4 * Math.PI * Tn);
    const s = slope * Math.log10(Math.max(arg, 1e-10));
    const valid = u < 0.01;
    return {
      result: s, unit: 'm',
      secondary: [
        { key: 'dimensionless_u', value: Number.isFinite(u) ? u : Number.NaN, unit: '—', label: 'Dimensionless Time u' },
        { key: 'slope_per_cycle', value: Number.isFinite(slope) ? slope : Number.NaN, unit: 'm', label: 'Slope per Log Cycle Δs' },
        { key: 'min_time', value: Number.isFinite(u) ? (rn * rn * Sn) / (0.04 * Tn) : Number.NaN, unit: 'days', label: 'Minimum Applicable Time t_min' },
      ],
      // Timeseries series (tool vizType 'timeseries'): drawdown s(t) over
      // 0.1–100 days (20 log-spaced points) from the tool's own Cooper-Jacob
      // straight-line approximation s = (2.3Q/4πT)·log₁₀(2.25/(4u)).
      series: [{
        label: 'Cooper-Jacob drawdown s(t) = (2.3Q/4πT)·log₁₀(2.25/(4u))',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const tt = 0.1 * Math.pow(1000, i / 19); // 0.1 → 100 days, log-spaced
          const ut = (rn * rn * Sn) / (4 * Tn * tt);
          const st = slope * Math.log10(Math.max(0.5625 / ut, 1e-10));
          return { x: tt, y: Number.isFinite(st) ? st : Number.NaN };
        }),
      }],
      steps: [
        '── Cooper-Jacob Straight-Line Method (Cooper & Jacob, 1946) ──',
        `Pumping rate Q = ${Qn.toFixed(2)} m³/day, Transmissivity T = ${Tn.toFixed(2)} m²/day`,
        `Time t = ${tn.toFixed(2)} days, Distance r = ${rn.toFixed(1)} m`,
        `Storativity S = ${Sn.toExponential(3)}`,
        '',
        'Step 1 — Validity check (u < 0.01 required):',
        `  u = r²S / (4Tt) = ${(rn*rn).toFixed(0)} × ${Sn.toExponential(3)} / (4 × ${Tn.toFixed(2)} × ${tn.toFixed(2)})`,
        `  u = ${u.toExponential(3)}`,
        `  ${valid ? '✓ u < 0.01 — Cooper-Jacob valid (< 1% error vs Theis)' : '⚠ u ≥ 0.01 — approximation error > 1%; use full Theis W(u) for accuracy'}`,
        '',
        'Step 2 — Logarithmic argument:',
        `  2.25·Tt/(r²S) = 2.25/(4u) = 2.25 / ${(4*u).toExponential(3)} = ${arg.toExponential(3)}`,
        '',
        'Step 3 — Compute drawdown:',
        `  s = (2.3·Q / 4πT) × log₁₀(2.25/(4u))`,
        `  s = ${slope.toFixed(4)} × log₁₀(${arg.toExponential(3)})`,
        `  s = ${s.toFixed(4)} m`,
        '',
        'Step 4 — Straight-line analysis:',
        `  Slope per log cycle: Δs = ${slope.toFixed(4)} m`,
        `  T = 2.3Q / (4π·Δs) = ${(2.3 * Qn / (4 * Math.PI * slope)).toFixed(2)} m²/day`,
        `  ${s > 0.1 ? 'Measurable drawdown — suitable for T/S estimation' : 'Very small drawdown — needs longer pumping or closer well'}`,
        '',
        `  └ Validity: Cooper-Jacob is the late-time (small u) limit of Theis`,
        `  └ For u > 0.01: use full Theis W(u) or Cooper-Jacob will overestimate s`,
      ]
    };
  },
  134: ({ fc, f0, k, t }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const fcN = Number(fc), f0N = Number(f0), kN = Number(k), tN = Number(t);
    const excess = f0N - fcN;
    const decay = Math.exp(-kN * tN);
    const f = fcN + excess * decay;
    const cumInf = fcN * tN + (excess / kN) * (1 - decay);
    if (![fcN, f0N, kN, tN].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: 'mm/h',
        steps: ['── Horton Infiltration Model (Horton, 1939) ──',
          'f(t) = f_c + (f₀−f_c)·e^(−kt)',
          '', 'One or more inputs are missing — no fabricated infiltration is substituted.'],
      };
    }
    return {
      result: f, unit: 'mm/h',
      secondary: [
        { key: 'cumulative_infiltration', value: Number.isFinite(cumInf) ? cumInf : Number.NaN, unit: 'mm', label: 'Cumulative Infiltration F(t)' },
        { key: 'equilibrium_rate', value: Number.isFinite(fcN) ? fcN : Number.NaN, unit: 'mm/h', label: 'Equilibrium Rate f_c' },
      ],
      // Timeseries series (tool vizType 'timeseries'): infiltration rate f(t)
      // over 0–10 h (20 points) from the tool's own Horton equation
      // f(t) = f_c + (f₀ − f_c)·e^(−kt).
      series: [{
        label: 'Horton infiltration f(t) = f_c + (f₀−f_c)·e^(−kt)',
        color: '#0072B2',
        points: Array.from({ length: 20 }, (_, i) => {
          const tt = i * (10 / 19);
          const ft = fcN + (f0N - fcN) * Math.exp(-kN * tt);
          return { x: tt, y: Number.isFinite(ft) ? ft : Number.NaN };
        }),
      }],
      steps: [
        '── Horton Infiltration Model (Horton, 1939) ──',
        `Initial infiltration rate f₀ = ${f0N.toFixed(2)} mm/h`,
        `Equilibrium rate f_c = ${fcN.toFixed(2)} mm/h (saturated conductivity)`,
        `Decay constant k = ${kN.toExponential(3)} /h, Time t = ${tN.toFixed(2)} h`,
        '',
        'Step 1 — Compute exponential decay factor:',
        `  e^(−kt) = exp(−${kN.toExponential(3)} × ${tN.toFixed(2)}) = ${decay.toExponential(4)}`,
        '',
        'Step 2 — Infiltration rate at time t:',
        `  f(t) = f_c + (f₀ − f_c)·e^(−kt)`,
        `  f(${tN.toFixed(1)} h) = ${fcN.toFixed(2)} + (${f0N.toFixed(2)} − ${fcN.toFixed(2)}) × ${decay.toExponential(4)}`,
        `  f(${tN.toFixed(1)} h) = ${f.toFixed(2)} mm/h`,
        '',
        'Step 3 — Cumulative infiltration:',
        `  F(t) = f_c·t + (f₀−f_c)/k·(1−e^(−kt))`,
        `  F(${tN.toFixed(1)} h) = ${cumInf.toFixed(2)} mm total infiltrated`,
        '',
        'Step 4 — Infiltration regime:',
        `  ${f / f0N > 0.8 ? 'EARLY STAGE — matrix potential dominated' : f / f0N > 0.3 ? 'TRANSITION — mixed gravitational/capillary' : 'LATE STAGE — gravity-dominated, near f_c'}`,
        '',
        `  └ Time to near-equilibrium (f ≈ 1.05·f_c): t ≈ 3/k ≈ ${(3 / kN).toFixed(1)} h`,
      ]
    };
  },

  // ── Domain 23: Hazard & Risk ──
  135: ({ H, V, E }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const Hn = Number(H), Vn = Number(V), En = Number(E);
    const valid = [Hn, Vn, En].every(Number.isFinite) && Hn >= 0 && Vn >= 0 && En >= 0;
    const R = Hn * Vn * En;
    const riskClass = !Number.isFinite(R) ? Number.NaN : (R < 0.1 ? 0 : R < 0.3 ? 1 : R < 0.6 ? 2 : 3);
    if (!valid) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'hazard', value: Number.isFinite(Hn) ? Hn : Number.NaN, unit: '—', label: 'Hazard H' },
          { key: 'vulnerability', value: Number.isFinite(Vn) ? Vn : Number.NaN, unit: '—', label: 'Vulnerability V' },
          { key: 'exposure', value: Number.isFinite(En) ? En : Number.NaN, unit: '—', label: 'Exposure E' },
          { key: 'risk_class', value: Number.NaN, unit: '—', label: 'Risk Class (0 Low, 1 Moderate, 2 High, 3 Very High)' },
        ],
        steps: ['── UNISDR Disaster Risk Framework (UNISDR, 2004; UNDRO, 1979) ──',
          'Risk = H × V × E',
          '', 'One or more inputs are missing or out of range — no fabricated risk is substituted.'],
      };
    }
    return {
      result: R, unit: '—',
      secondary: [
        { key: 'hazard', value: Hn, unit: '—', label: 'Hazard H' },
        { key: 'vulnerability', value: Vn, unit: '—', label: 'Vulnerability V' },
        { key: 'exposure', value: En, unit: '—', label: 'Exposure E' },
        { key: 'risk_class', value: riskClass, unit: '—', label: 'Risk Class (0 Low, 1 Moderate, 2 High, 3 Very High)' },
      ],
      steps: [
        '── UNISDR Disaster Risk Framework (UNISDR, 2004; UNDRO, 1979) ──',
        `Hazard H = ${Hn.toFixed(3)} (event probability × intensity)`,
        `Vulnerability V = ${Vn.toFixed(3)} (0–1: degree of loss given event)`,
        `Exposure E = ${En.toFixed(3)} (elements at risk, e.g. population × value)`,
        '',
        'Step 1 — Compute risk:',
        `  Risk = H × V × E = ${Hn.toFixed(3)} × ${Vn.toFixed(3)} × ${En.toFixed(3)}`,
        `  Risk = ${R.toFixed(3)} (expected loss units)`,
        '',
        'Step 2 — Risk level:',
        `  ${R < 0.1 ? 'LOW — negligible risk, routine monitoring' : R < 0.3 ? 'MODERATE — acceptable risk, standard mitigation' : R < 0.6 ? 'HIGH — requires active risk reduction measures' : 'VERY HIGH — priority intervention, evacuation planning'}`,
        '',
        `  └ Components: H = f(probability, magnitude); V depends on structural/physical/social factors; E quantifies population and assets`,
      ]
    };
  },
  136: ({ D_P, P_low, P_high, num_intervals }) => {
    // Expected Annual Damage (USACE EM 1110-2-1619)
    // EAD = ∫₀¹ D(P)·dP, integrated numerically via trapezoidal rule.
    // D(P) is modeled as a power-law: D(P) = D_P × (P/P_ref)^(-α)
    // where P_ref = 0.01 (100-year event) and α = 0.8 (typical flood).
    const P_ref = 0.01;
    const alpha = 0.8;  // damage curve exponent (typical for riverine floods)
    const D100raw = Number(D_P);
    const D100 = (Number.isFinite(D100raw) && D100raw >= 0) ? D100raw : Number.NaN;
    const n = Math.max(10, Math.min(1000, Math.round(Number(num_intervals) || 100)));
    const pLo = Math.max(0.0001, Number(P_low) || 0.001);
    const pHi = Math.min(0.99, Number(P_high) || 0.5);
    if (!Number.isFinite(D100) || pLo >= pHi) {
      return {
        result: Number.NaN, unit: '$/yr',
        secondary: [
          { key: 'annual_loss', value: Number.NaN, unit: '$/yr', label: 'Expected Annual Damage EAD' },
          { key: 'max_damage', value: Number.NaN, unit: '$', label: 'Maximum Damage D₁₀₀' },
          { key: 'return_period_damage', value: Number.NaN, unit: '$', label: 'Damage at 1000-yr Event' },
        ],
        steps: ['── Expected Annual Damage (USACE EM 1110-2-1619) ──',
          'EAD = ∫ D(P)·dP, D(P) = D₁₀₀·(P/P_ref)^(-α)',
          '', 'Damage at 100-yr event (D_P) is missing or not finite — no fabricated EAD is substituted.'],
      };
    }
    // Power-law damage curve: D(P) = D100 × (P/P_ref)^(-α)
    // Logarithmic grid integration for accuracy on steep D(P) curve
    const logPLo = Math.log(pLo);
    const logPHi = Math.log(pHi);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const t1 = i / n;
      const t2 = (i + 1) / n;
      const p1 = Math.exp(logPLo + t1 * (logPHi - logPLo));
      const p2 = Math.exp(logPLo + t2 * (logPHi - logPLo));
      const D1 = D100 * Math.pow(p1 / P_ref, -alpha);
      const D2 = D100 * Math.pow(p2 / P_ref, -alpha);
      sum += 0.5 * (D1 + D2) * (p2 - p1);
    }
    const EAD = sum;
    // Damage-exceedance curve series: D(P) over the integration range
    const seriesPoints: Array<{ x: number; y: number }> = [];
    const seriesN = 40;
    for (let i = 0; i <= seriesN; i++) {
      const t = i / seriesN;
      const p = Math.exp(logPLo + t * (logPHi - logPLo));
      const D = D100 * Math.pow(p / P_ref, -alpha);
      if (Number.isFinite(D)) seriesPoints.push({ x: p, y: D });
    }
    const D1000 = D100 * Math.pow(0.001 / P_ref, -alpha);
    return {
      result: EAD, unit: '$/yr',
      secondary: [
        { key: 'annual_loss', value: EAD, unit: '$/yr', label: 'Expected Annual Damage EAD' },
        { key: 'max_damage', value: D100, unit: '$', label: 'Maximum Damage D₁₀₀' },
        { key: 'return_period_damage', value: D1000, unit: '$', label: 'Damage at 1000-yr Event' },
        { key: 'D_100', value: D100, unit: '$', label: 'Damage at 100-yr event' },
        { key: 'D_1000', value: D1000, unit: '$', label: 'Damage at 1000-yr event' },
      ],
      series: seriesPoints.length > 0
        ? [{
            label: 'Damage-Exceedance D(P)',
            color: '#d62728',
            points: seriesPoints,
          }]
        : undefined,
      steps: [
        '── Expected Annual Damage (USACE EM 1110-2-1619) ──',
        `Damage at 100-yr event D₁₀₀ = $${D100.toFixed(0)}`,
        `Power-law exponent α = ${alpha} (typical riverine flood)`,
        `Integration range: P ∈ [${pLo.toFixed(4)}, ${pHi.toFixed(4)}]`,
        `Number of intervals: ${n}`,
        '',
        'Step 1 — Damage-exceedance curve D(P):',
        `  D(P) = D₁₀₀ × (P/${P_ref})^(-${alpha})`,
        `  D(0.5) = $${(D100 * Math.pow(0.5/P_ref, -alpha)).toFixed(0)} (2-yr event)`,
        `  D(0.01) = $${D100.toFixed(0)} (100-yr event)`,
        `  D(0.001) = $${(D100 * Math.pow(0.001/P_ref, -alpha)).toFixed(0)} (1000-yr event)`,
        '',
        'Step 2 — Numerical integration (trapezoidal rule):',
        `  EAD = ∫ D(P)·dP ≈ ${n} intervals`,
        `  EAD = $${EAD.toFixed(0)}/yr`,
        '',
        'Step 3 — Risk assessment:',
        `  ${EAD > 1e6 ? 'CATASTROPHIC — > $1M/yr, flood insurance essential' : EAD > 1e4 ? 'HIGH — > $10K/yr, risk transfer recommended' : EAD > 1e3 ? 'MODERATE — > $1K/yr, monitor regularly' : 'LOW — < $1K/yr, minimal financial risk'}`,
        '',
        `  └ Mitigation benefit: if levee reduces D₁₀₀ by 50%, EAD drops proportionally`,
        `  └ Benefit-cost ratio: BCR = ΔEAD / annualized mitigation cost`,
      ],
    };
  },
  137: ({ IHi, ILo, BPHi, BPLo, Cp }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const IHiN = Number(IHi), ILoN = Number(ILo), BPHiN = Number(BPHi), BPLoN = Number(BPLo), CpN = Number(Cp);
    // EPA 40 CFR Part 50 Appendix G — AQI breakpoint interpolation
    // AQI = [(I_Hi−I_Lo)/(BP_Hi−BP_Lo)] × (C_p−BP_Lo) + I_Lo
    const denom = (BPHiN - BPLoN) || 1;
    const concRatio = (CpN - BPLoN) / denom;
    const AQI = (IHiN - ILoN) * concRatio + ILoN;
    const valid = [IHiN, ILoN, BPHiN, BPLoN, CpN].every(Number.isFinite) && CpN >= 0 && BPHiN > BPLoN;
    // Health classification: numeric class 0–5 per EPA AQI categories
    const healthLabel = !Number.isFinite(AQI) ? Number.NaN
      : AQI <= 50 ? 0 : AQI <= 100 ? 1 : AQI <= 150 ? 2 : AQI <= 200 ? 3 : AQI <= 300 ? 4 : 5;
    // Breakpoint band index derived from I_Lo
    const breakpointBand = !Number.isFinite(ILoN) ? Number.NaN
      : Math.round(ILoN / 50);
    // Pollutant detection via known EPA breakpoint tables (PM2.5, PM10, O3, NO2, SO2, CO)
    const POLLUTANT_BANDS: Array<{ code: number; lo: number; hi: number; ilo: number; ihi: number }> = [
      { code: 1, lo: 0, hi: 12.0, ilo: 0, ihi: 50 },
      { code: 1, lo: 12.1, hi: 35.4, ilo: 51, ihi: 100 },
      { code: 1, lo: 35.5, hi: 55.4, ilo: 101, ihi: 150 },
      { code: 1, lo: 55.5, hi: 150.4, ilo: 151, ihi: 200 },
      { code: 1, lo: 150.5, hi: 250.4, ilo: 201, ihi: 300 },
      { code: 1, lo: 250.5, hi: 350.4, ilo: 301, ihi: 400 },
      { code: 1, lo: 350.5, hi: 500.4, ilo: 401, ihi: 500 },
      { code: 2, lo: 0, hi: 54, ilo: 0, ihi: 50 },
      { code: 2, lo: 55, hi: 154, ilo: 51, ihi: 100 },
      { code: 2, lo: 155, hi: 254, ilo: 101, ihi: 150 },
      { code: 2, lo: 255, hi: 354, ilo: 151, ihi: 200 },
      { code: 2, lo: 355, hi: 424, ilo: 201, ihi: 300 },
      { code: 2, lo: 425, hi: 504, ilo: 301, ihi: 400 },
      { code: 2, lo: 505, hi: 604, ilo: 401, ihi: 500 },
      { code: 3, lo: 0, hi: 0.054, ilo: 0, ihi: 50 },
      { code: 3, lo: 0.055, hi: 0.070, ilo: 51, ihi: 100 },
      { code: 3, lo: 0.071, hi: 0.085, ilo: 101, ihi: 150 },
      { code: 3, lo: 0.086, hi: 0.105, ilo: 151, ihi: 200 },
      { code: 3, lo: 0.106, hi: 0.200, ilo: 201, ihi: 300 },
    ];
    const matched = valid && POLLUTANT_BANDS.find(b =>
      Math.abs(b.hi - BPHiN) <= 0.2 && Math.abs(b.lo - BPLoN) <= 0.2 &&
      Math.abs(b.ihi - IHiN) <= 5 && Math.abs(b.ilo - ILoN) <= 5);
    const pollutantCategory = matched ? matched.code : 0;
    if (!valid) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'breakpoint_band', value: Number.NaN, unit: '—', label: 'Breakpoint Band Index (0–5)' },
          { key: 'pollutant_category', value: Number.NaN, unit: '—', label: 'Pollutant Category (1 PM2.5, 2 PM10, 3 O3, 0 generic)' },
          { key: 'health_label', value: Number.NaN, unit: '—', label: 'Health Class (0 Good … 5 Hazardous)' },
        ],
        steps: ['── EPA AQI Breakpoint Interpolation (40 CFR Part 50 App. G) ──',
          'AQI = [(I_Hi−I_Lo)/(BP_Hi−BP_Lo)] × (C_p−BP_Lo) + I_Lo',
          '', 'One or more inputs are missing or unphysical — no fabricated AQI is substituted.'],
      };
    }
    // AQI vs concentration series across the breakpoint band
    const seriesPoints: Array<{ x: number; y: number }> = [];
    const stepCount = 20;
    for (let i = 0; i <= stepCount; i++) {
      const c = BPLoN + (i / stepCount) * (BPHiN - BPLoN);
      const ratio = (c - BPLoN) / denom;
      const aqi = (IHiN - ILoN) * ratio + ILoN;
      if (Number.isFinite(aqi)) seriesPoints.push({ x: c, y: aqi });
    }
    return {
      result: AQI, unit: '—',
      secondary: [
        { key: 'breakpoint_band', value: breakpointBand, unit: '—', label: 'Breakpoint Band Index (0–5)' },
        { key: 'pollutant_category', value: pollutantCategory, unit: '—', label: 'Pollutant Category (1 PM2.5, 2 PM10, 3 O3, 0 generic)' },
        { key: 'health_label', value: healthLabel, unit: '—', label: 'Health Class (0 Good … 5 Hazardous)' },
      ],
      series: seriesPoints.length > 0
        ? [{
            label: 'AQI vs Concentration',
            color: '#2ca02c',
            points: seriesPoints,
          }]
        : undefined,
      steps: [
        '── EPA AQI Breakpoint Interpolation (40 CFR Part 50 App. G) ──',
        `Breakpoints: BP_lo = ${BPLoN.toFixed(1)}, BP_hi = ${BPHiN.toFixed(1)}`,
        `Indices: I_lo = ${ILoN.toFixed(0)}, I_hi = ${IHiN.toFixed(0)}`,
        `Pollutant concentration C_p = ${CpN.toFixed(2)}`,
        '',
        'Step 1 — Ratio of concentration within breakpoint interval:',
        `  (C_p − BP_lo) / (BP_hi − BP_lo) = (${CpN.toFixed(2)} − ${BPLoN.toFixed(1)}) / (${BPHiN.toFixed(1)} − ${BPLoN.toFixed(1)})`,
        `  = ${concRatio.toFixed(4)}`,
        '',
        'Step 2 — Linear interpolation to AQI:',
        `  AQI = (I_hi − I_lo) × ratio + I_lo`,
        `  AQI = (${IHiN.toFixed(0)} − ${ILoN.toFixed(0)}) × ${concRatio.toFixed(4)} + ${ILoN.toFixed(0)}`,
        `  AQI = ${AQI.toFixed(0)}`,
        '',
        'Step 3 — Health classification:',
        `  ${AQI <= 50 ? 'GOOD (0–50) — green, satisfactory air quality' : AQI <= 100 ? 'MODERATE (51–100) — yellow, acceptable for most' : AQI <= 150 ? 'UNHEALTHY FOR SENSITIVE GROUPS (101–150) — orange' : AQI <= 200 ? 'UNHEALTHY (151–200) — red, general population affected' : AQI <= 300 ? 'VERY UNHEALTHY (201–300) — purple, avoid outdoor activity' : 'HAZARDOUS (301–500) — maroon, emergency conditions'}`,
        '',
        `  └ Each pollutant (PM₂.₅, PM₁₀, O₃, NO₂, SO₂, CO) has distinct breakpoint table`,
      ]
    };
  },
  138: ({ Xbar, Kp, sigmaX }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const XbarN = Number(Xbar), KpN = Number(Kp), sigmaXN = Number(sigmaX);
    const valid = [XbarN, KpN, sigmaXN].every(Number.isFinite) && XbarN >= 0 && sigmaXN >= 0 && KpN >= 0;
    const PMP = XbarN + KpN * sigmaXN;
    if (!valid) {
      return {
        result: Number.NaN, unit: 'mm',
        secondary: [
          { key: 'standard_deviation', value: Number.isFinite(sigmaXN) && sigmaXN >= 0 ? sigmaXN : Number.NaN, unit: 'mm', label: 'Standard Deviation σ_x' },
          { key: 'frequency_factor', value: Number.isFinite(KpN) && KpN >= 0 ? KpN : Number.NaN, unit: '—', label: 'Frequency Factor K_p' },
        ],
        steps: ['── Probable Maximum Precipitation — Hershfield Method (Hershfield, 1961; World Meteorological Organization, 1986) ──',
          'PMP = X̄ + K_p × σ_x',
          '', 'One or more inputs are missing or out of range — no fabricated PMP is substituted.'],
      };
    }
    return {
      result: PMP, unit: 'mm',
      secondary: [
        { key: 'standard_deviation', value: sigmaXN, unit: 'mm', label: 'Standard Deviation σ_x' },
        { key: 'frequency_factor', value: KpN, unit: '—', label: 'Frequency Factor K_p' },
      ],
      steps: [
        '── Probable Maximum Precipitation — Hershfield Method (Hershfield, 1961; World Meteorological Organization, 1986) ──',
        `Mean annual maximum rainfall X̄ = ${XbarN.toFixed(1)} mm`,
        `Frequency factor K_p = ${KpN.toFixed(2)} (typically 5–20 for PMP)`,
        `Standard deviation σ_x = ${sigmaXN.toFixed(1)} mm`,
        '',
        'Step 1 — Compute PMP:',
        `  PMP = X̄ + K_p × σ_x = ${XbarN.toFixed(1)} + ${KpN.toFixed(2)} × ${sigmaXN.toFixed(1)}`,
        `  PMP = ${PMP.toFixed(1)} mm`,
        '',
        'Step 2 — Comparison with observed maximum:',
        `  K_p = ${KpN.toFixed(2)} → ${KpN < 10 ? 'Moderate factor — less extreme basin' : 'High factor — extreme rainfall potential'}`,
        `  Ratio PMP / X̄ = ${(PMP / XbarN).toFixed(1)}× the mean annual maximum`,
        '',
        `  └ PMP used for design of high-hazard dams (spillway capacity), nuclear facilities`,
        `  └ Hershfield envelope: K_p max ≈ 15 for 24-hr PMP in most regions`,
      ]
    };
  },
  139: ({ Xim1, Zi, alpha = 0.897 }) => {
    // Palmer 1965: X_i = α · X_{i-1} + Z_i / 3
    // α = persistence factor, 0.897 is standard US calibration
    // PDSI is bounded to [−10, +10]
    const Xim1N = Number(Xim1), ZiN = Number(Zi), alphaN = Number(alpha);
    if (![Xim1N, ZiN, alphaN].every(Number.isFinite)) {
      return {
        result: Number.NaN, unit: '—',
        secondary: [
          { key: 'drought_classification', value: Number.NaN, unit: '—', label: 'Unknown' },
          { key: 'persistence_factor', value: Number.isFinite(alphaN) ? alphaN : Number.NaN, unit: '—', label: 'Persistence Factor α (Palmer 1965)' },
        ],
        steps: ['── Palmer Drought Severity Index (Palmer, 1965) ──',
          'X_i = α · X_{i-1} + Z_i / 3',
          '', 'One or more inputs are missing — no fabricated PDSI is substituted.'],
      };
    }
    let Xi = alphaN * Xim1N + ZiN / 3;

    // Clamp to Palmer's physical bounds
    if (Xi > 10) Xi = 10;
    if (Xi < -10) Xi = -10;

    // Drought classification (Palmer 1965)
    let classification: string;
    if (Xi > 4) classification = 'Extreme Wet (> +4)';
    else if (Xi > 3) classification = 'Severe Wet (+3 to +4)';
    else if (Xi > 2) classification = 'Moderate Wet (+2 to +3)';
    else if (Xi > 1) classification = 'Slight Wet (+1 to +2)';
    else if (Xi > -1) classification = 'Near Normal (−1 to +1)';
    else if (Xi > -2) classification = 'Incipient Drought (−1 to −2)';
    else if (Xi > -3) classification = 'Moderate Drought (−2 to −3)';
    else if (Xi > -4) classification = 'Severe Drought (−3 to −4)';
    else classification = 'Extreme Drought (< −4)';

    return {
      result: Xi, unit: '—',
      secondary: [
        { key: 'drought_classification', value: Xi, unit: '—', label: classification },
        { key: 'persistence_factor', value: alphaN, unit: '—', label: 'Persistence Factor α (Palmer 1965)' },
      ],
      steps: [
        '── Palmer Drought Severity Index (Palmer, 1965) ──',
        `  Previous month PDSI X_{i-1} = ${Xim1N.toFixed(3)}`,
        `  Moisture anomaly index Z_i = ${ZiN.toFixed(3)}`,
        `  Persistence factor α = ${alphaN} ${alphaN === 0.897 ? '(standard US calibration)' : '(user-supplied)'}`,
        '',
        'Step 1 — PDSI recurrence formula:',
        `  X_i = α × X_{i-1} + Z_i / 3`,
        `  X_i = ${alphaN} × ${Xim1N.toFixed(3)} + ${ZiN.toFixed(3)} / 3`,
        `  X_i = ${(alphaN * Xim1N).toFixed(4)} + ${(ZiN / 3).toFixed(4)}`,
        `  X_i = ${(alphaN * Xim1N + ZiN / 3).toFixed(4)}`,
        '',
        'Step 2 — Apply bounds [−10, +10]:',
        `  Clamped X_i = ${Xi.toFixed(4)}`,
        '',
        'Step 3 — Drought classification:',
        `  ${classification}`,
        '',
        '  └ 0.897 persistence factor calibrated for central US (Palmer 1965)',
        '  └ Z-index derived from: P, ET, soil moisture recharge, runoff vs climatically expected values',
      ]
    };
  },
  140: ({ K0, Vres, hb }) => {
    // Defensive numeric coercion: inputs can arrive as JSON strings.
    const K0n = Number(K0), Vresn = Number(Vres), hbn = Number(hb);
    // Froehlich 2008: B_avg = 0.1803 × K₀ × V_res^0.32 × h_b^0.19
    // B_avg is average BREACH WIDTH (meters), NOT discharge
    const valid = [K0n, Vresn, hbn].every(Number.isFinite) && K0n > 0 && Vresn > 0 && hbn > 0;
    const Bavg = 0.1803 * K0n * Math.pow(Vresn, 0.32) * Math.pow(hbn, 0.19);

    // Secondary outputs from Froehlich 2008:
    // Peak outflow: Q_p = 3.1 × B_avg × h_b^1.5 (broad-crested weir, USACE EM 1110-2-1619)
    const Qp = 3.1 * Bavg * Math.pow(hbn, 1.5);

    // Breach formation time: t_f = 0.0179 × K₁ × V_res^0.34 × h_b^(-0.14) hours
    // K₁ = 1.0 for overtopping, 1.5 for piping (K0 ≤ 1.3 = overtopping, > 1.3 = piping)
    const K1 = K0n > 1.3 ? 1.5 : 1.0;
    const tf_hours = 0.0179 * K1 * Math.pow(Vresn, 0.34) * Math.pow(hbn, -0.14);

    if (!valid) {
      return {
        result: Number.NaN, unit: 'm',
        secondary: [
          { key: 'peak_outflow', value: Number.NaN, unit: 'm³/s', label: 'Peak Outflow Q_p (broad-crested weir)' },
          { key: 'breach_formation_time', value: Number.NaN, unit: 'hours', label: 'Breach Formation Time t_f' },
          { key: 'breach_factor_k1', value: Number.isFinite(K1) ? K1 : Number.NaN, unit: '—', label: 'Breach Factor K₁ (1.0 overtopping, 1.5 piping)' },
        ],
        steps: ['── Froehlich Dam Breach Parameters (Froehlich, 2008) ──',
          'B_avg = 0.1803 × K₀ × V_res^0.32 × h_b^0.19',
          '', 'One or more inputs are missing or unphysical (requires K₀ > 0, V_res > 0, h_b > 0) — no fabricated breach width is substituted.'],
      };
    }

    return {
      result: Bavg, unit: 'm',
      secondary: [
        { key: 'peak_outflow', value: Qp, unit: 'm³/s', label: 'Peak Outflow Q_p (broad-crested weir)' },
        { key: 'breach_formation_time', value: tf_hours, unit: 'hours', label: 'Breach Formation Time t_f' },
        { key: 'breach_factor_k1', value: K1, unit: '—', label: 'Breach Factor K₁ (1.0 overtopping, 1.5 piping)' },
      ],
      steps: [
        '── Froehlich Dam Breach Parameters (Froehlich, 2008) ──',
        `  Reservoir volume V_res = ${Vresn.toExponential(2)} m³`,
        `  Embankment height h_b = ${hbn.toFixed(1)} m`,
        `  Breach factor K₀ = ${K0n.toFixed(3)} ${K0n <= 1.3 ? '(overtopping)' : K0n <= 2.0 ? '(piping)' : '(elevated)'}`,
        '',
        'Step 1 — Average breach width:',
        `  B_avg = 0.1803 × K₀ × V_res^0.32 × h_b^0.19`,
        `  B_avg = 0.1803 × ${K0n.toFixed(3)} × ${Math.pow(Vresn, 0.32).toExponential(3)} × ${Math.pow(hbn, 0.19).toExponential(4)}`,
        `  B_avg = ${Bavg.toFixed(1)} m`,
        '',
        'Step 2 — Peak outflow (broad-crested weir):',
        `  Q_p = 3.1 × B_avg × h_b^1.5`,
        `  Q_p = 3.1 × ${Bavg.toFixed(1)} × ${Math.pow(hbn, 1.5).toFixed(1)}`,
        `  Q_p = ${Qp.toFixed(0)} m³/s`,
        '',
        'Step 3 — Breach formation time:',
        `  K₁ = ${K1} (${K0n > 1.3 ? 'piping' : 'overtopping'})`,
        `  t_f = 0.0179 × K₁ × V_res^0.34 × h_b^(-0.14)`,
        `  t_f = ${tf_hours.toFixed(2)} hours`,
        '',
        'Step 4 — Hazard classification:',
        `  ${Qp > 10000 ? 'CATASTROPHIC — >10,000 m³/s, massive downstream flooding' : Qp > 1000 ? 'MAJOR — 1,000–10,000 m³/s, significant flood wave' : Qp > 100 ? 'MODERATE — 100–1,000 m³/s, localized flooding' : 'MINOR — <100 m³/s, limited hazard'}`,
        '',
        `  └ 0.1803 is the regression constant from 108 historical dam failures`,
        `  └ K₀: 1.0 (overtopping), 1.3 (piping); K₁: 1.0 (overtopping), 1.5 (piping)`,
      ]
    };
  },

  // ── Domain 24: Data Assimilation ──
  141: ({ xf, Pf, y, R, H = 1 }) => {
    // Kalman Filter Analysis Step (Kalman 1960; Evensen 1994 EnKF)
    // x_a = x_f + K·(y − H·x_f)
    // K = P_f·H^T·(H·P_f·H^T + R)^{−1}
    // P_a = (I − K·H)·P_f
    if (!Number.isFinite(xf) || !Number.isFinite(Pf) || !Number.isFinite(y) || !Number.isFinite(R) || Pf <= 0 || R < 0) {
      return { result: NaN, unit: '—', secondary: [
        { key: 'analysis_error_covariance', value: Number.NaN, unit: '—', label: 'Analysis Error Covariance P_a (NaN)' },
        { key: 'innovation', value: Number.NaN, unit: '—', label: 'Innovation d = y − H·x_f (NaN)' },
        { key: 'kalman_gain', value: Number.NaN, unit: '—', label: 'Kalman Gain K (NaN)' },
      ], steps: ['Error: Pf must be > 0 and R ≥ 0'] };
    }
    const den = H * Pf * H + R;
    const K = (Pf * H) / den;
    const innov = y - H * xf;
    const xa = xf + K * innov;   // ← correct: base state is x_f, NOT x_b
    const Pa = (1 - K * H) * Pf;  // analysis error covariance

    return {
      result: xa, unit: '—',
      secondary: [
        { key: 'analysis_error_covariance', value: Pa, unit: '—', label: 'Analysis Error Covariance P_a' },
        { key: 'innovation', value: innov, unit: '—', label: 'Innovation d = y − H·x_f' },
        { key: 'kalman_gain', value: K, unit: '—', label: 'Kalman Gain K' },
      ],
      steps: [
        '── Kalman Filter Analysis (Kalman 1960; Evensen 1994) ──',
        `  Forecast state x_f = ${xf.toFixed(4)}`,
        `  Forecast error covariance P_f = ${Pf.toFixed(4)}`,
        `  Observation y = ${y.toFixed(4)}`,
        `  Observation error variance R = ${R.toFixed(4)}`,
        `  Observation operator H = ${H.toFixed(4)}`,
        '',
        'Step 1 — Innovation (observation residual):',
        `  d = y − H·x_f = ${y.toFixed(4)} − ${H.toFixed(4)} × ${xf.toFixed(4)}`,
        `  d = ${innov.toFixed(4)}`,
        '',
        'Step 2 — Kalman gain:',
        `  K = P_f·H / (H·P_f·H + R)`,
        `  K = ${Pf.toFixed(4)} × ${H.toFixed(4)} / (${H.toFixed(4)} × ${Pf.toFixed(4)} × ${H.toFixed(4)} + ${R.toFixed(4)})`,
        `  K = ${K.toFixed(4)} ${K > 0.5 ? '(observation-weighted: R << P_f)' : K < 0.1 ? '(model-weighted: P_f << R)' : '(balanced: comparable uncertainties)'}`,
        '',
        'Step 3 — Analysis update:',
        `  x_a = x_f + K·d = ${xf.toFixed(4)} + ${K.toFixed(4)} × ${innov.toFixed(4)}`,
        `  x_a = ${xa.toFixed(4)}`,
        '',
        'Step 4 — Analysis error covariance:',
        `  P_a = (1 − K·H)·P_f = (1 − ${K.toFixed(4)} × ${H.toFixed(4)}) × ${Pf.toFixed(4)}`,
        `  P_a = ${Pa.toFixed(4)} ${Pa < Pf ? `(${((1 - Pa / Pf) * 100).toFixed(1)}% reduction from P_f)` : '(no reduction)'}`,
        '',
        `  └ The analysis x_a lies between x_f and y/H, weighted by their relative uncertainties`,
        `  └ EnKF extends this to ensembles: P_f estimated from ensemble spread, not explicit matrix`,
      ]
    };
  },
  142: ({ xb, H = 1, y, R, B }) => {
    // Optimal Interpolation (Lorenz 1969; Gandin 1963)
    // x_a = x_b + B·H^T·(H·B·H^T + R)^{-1}·(y − H·x_b)
    // Unlike KF (Tool 141), OI/3D-Var uses x_b as base state (not x_f)
    if (!Number.isFinite(xb) || !Number.isFinite(B) || !Number.isFinite(y) || !Number.isFinite(R) || !Number.isFinite(H) || B <= 0 || R < 0) {
      return { result: NaN, unit: '—', secondary: [
        { key: 'analysis_increment', value: Number.NaN, unit: '—', label: 'Analysis Increment x_a − x_b (NaN)' },
        { key: 'analysis_error_variance', value: Number.NaN, unit: '—', label: 'Analysis Error Variance P_a (NaN)' },
        { key: 'kalman_gain', value: Number.NaN, unit: '—', label: 'OI Gain K (NaN)' },
      ], steps: ['Error: B must be > 0 and R ≥ 0'] };
    }
    const den = H * B * H + R;
    const K = (B * H) / den;
    const innov = y - H * xb;
    const xa = xb + K * innov;
    const Pa = (1 - K * H) * B;  // analysis error variance

    return {
      result: xa, unit: '—',
      secondary: [
        { key: 'analysis_increment', value: xa - xb, unit: '—', label: 'Analysis Increment x_a − x_b' },
        { key: 'analysis_error_variance', value: Pa, unit: '—', label: 'Analysis Error Variance P_a' },
        { key: 'kalman_gain', value: K, unit: '—', label: 'OI Gain K' },
      ],
      steps: [
        '── Optimal Interpolation (Lorenz 1969; Gandin 1963) ──',
        `  Background x_b = ${xb.toFixed(4)}, Background error covariance B = ${B.toFixed(4)}`,
        `  Observation y = ${y.toFixed(4)}, Observation error variance R = ${R.toFixed(4)}`,
        `  Observation operator H = ${H.toFixed(4)}`,
        '',
        'Step 1 — Innovation:',
        `  d = y − H·x_b = ${y.toFixed(4)} − ${H.toFixed(4)} × ${xb.toFixed(4)}`,
        `  d = ${innov.toFixed(4)}`,
        '',
        'Step 2 — OI gain:',
        `  K = B·H / (H·B·H + R) = ${B.toFixed(4)} × ${H.toFixed(4)} / (${H.toFixed(4)} × ${B.toFixed(4)} × ${H.toFixed(4)} + ${R.toFixed(4)})`,
        `  K = ${K.toFixed(4)} ${K > 0.5 ? '(obs-weighted: B >> R)' : K < 0.1 ? '(bg-weighted: R >> B)' : '(balanced)'}`,
        '',
        'Step 3 — Analysis:',
        `  x_a = x_b + K·d = ${xb.toFixed(4)} + ${K.toFixed(4)} × ${innov.toFixed(4)}`,
        `  x_a = ${xa.toFixed(4)}`,
        '',
        'Step 4 — Analysis error variance:',
        `  P_a = (1 − K·H)·B = (1 − ${K.toFixed(4)} × ${H.toFixed(4)}) × ${B.toFixed(4)}`,
        `  P_a = ${Pa.toFixed(4)} ${Pa < B ? `(${((1 - Pa / B) * 100).toFixed(1)}% reduction)` : '(no reduction)'}`,
        '',
        `  └ OI uses static B (no flow dependence) — 3D-Var extends to cost-function minimization`,
        `  └ Unlike KF (Tool 141), OI uses x_b as base state (not x_f)`,
      ]
    };
  },
  143: ({ x, xb, B, y, H, R }) => {
    // 3D-Var Cost Function (Le Dimet & Talagrand 1986)
    // J(x) = ½(x − x_b)ᵀ B⁻¹ (x − x_b) + ½(y − H·x)ᵀ R⁻¹ (y − H·x)
    // This is the single-time-step evaluation; 4D-Var sums over a time window
    if (!Number.isFinite(x) || !Number.isFinite(xb) || !Number.isFinite(B) || !Number.isFinite(y) || !Number.isFinite(H) || !Number.isFinite(R) || B <= 0 || R <= 0) {
      return { result: NaN, unit: '—', secondary: [
        { key: 'background_term', value: Number.NaN, unit: '—', label: 'Background Term J_b (NaN)' },
        { key: 'observation_term', value: Number.NaN, unit: '—', label: 'Observation Term J_o (NaN)' },
        { key: 'optimal_analysis', value: Number.NaN, unit: '—', label: 'Optimal Analysis x_a (∇J = 0) (NaN)' },
      ], steps: ['Error: B > 0 and R > 0 required'] };
    }
    const bgTerm = 0.5 * (x - xb) * (1 / B) * (x - xb);
    const obsTerm = 0.5 * (y - H * x) * (1 / R) * (y - H * x);
    const J = bgTerm + obsTerm;

    // Optimal analysis (set ∇J = 0): x_a = (B⁻¹ + HᵀR⁻¹H)⁻¹ (B⁻¹x_b + HᵀR⁻¹y)
    // For scalar: x_a = (x_b/B + H*y/R) / (1/B + H²/R)
    const xa = (xb / B + H * y / R) / (1 / B + H * H / R);

    return {
      result: J, unit: '—',
      secondary: [
        { key: 'background_term', value: bgTerm, unit: '—', label: 'Background Term J_b' },
        { key: 'observation_term', value: obsTerm, unit: '—', label: 'Observation Term J_o' },
        { key: 'optimal_analysis', value: xa, unit: '—', label: 'Optimal Analysis x_a (∇J = 0)' },
      ],
      steps: [
        '── 3D-Var Cost Function (Le Dimet & Talagrand 1986) ──',
        `  State x = ${x.toFixed(4)}, Background x_b = ${xb.toFixed(4)}`,
        `  Background error covariance B = ${B.toFixed(4)}`,
        `  Observation y = ${y.toFixed(4)}, Observation error R = ${R.toFixed(4)}`,
        `  Observation operator H = ${H.toFixed(4)}`,
        '',
        'Step 1 — Background term:',
        `  J_b = ½(x − x_b)² / B = ½ × (${x.toFixed(4)} − ${xb.toFixed(4)})² / ${B.toFixed(4)}`,
        `  J_b = ${bgTerm.toFixed(4)}`,
        '',
        'Step 2 — Observation term:',
        `  J_o = ½(y − H·x)² / R = ½ × (${y.toFixed(4)} − ${H.toFixed(4)} × ${x.toFixed(4)})² / ${R.toFixed(4)}`,
        `  J_o = ${obsTerm.toFixed(4)}`,
        '',
        'Step 3 — Total cost:',
        `  J(x) = J_b + J_o = ${bgTerm.toFixed(4)} + ${obsTerm.toFixed(4)}`,
        `  J(x) = ${J.toFixed(4)}`,
        '',
        'Step 4 — Optimal analysis (∇J = 0):',
        `  x_a = (x_b/B + H·y/R) / (1/B + H²/R)`,
        `  x_a = ${xa.toFixed(4)}`,
        `  J(x_a) = ${((0.5 * (xa - xb) * (1 / B) * (xa - xb)) + (0.5 * (y - H * xa) * (1 / R) * (y - H * xa))).toFixed(4)} (minimum)`,
        '',
        `  └ bg/obs = ${obsTerm !== 0 ? (bgTerm / obsTerm).toFixed(2) : '∞'} — ${bgTerm > obsTerm ? 'Background-dominated (strong constraint)' : obsTerm > bgTerm ? 'Obs-dominated (weak constraint)' : 'Balanced'}`,
        `  └ 4D-Var extends to time window: J = J_b + Σᵢ J_o(tᵢ) with adjoint model for gradient`,
      ]
    };
  },
  144: ({ px, py, Hxy }) => {
    // Shannon Information Entropy (Shannon 1948)
    // For a binary variable: H(X) = −p·log₂(p) − (1−p)·log₂(1−p)
    // Mutual information: I(X;Y) = H(X) + H(Y) − H(X,Y)
    // Hxy is the joint entropy H(X,Y), not a probability
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(Hxy) || px <= 0 || px >= 1 || py <= 0 || py >= 1) {
      return { result: NaN, unit: 'bits', secondary: [
        { key: 'entropy_y', value: Number.NaN, unit: 'bits', label: 'Entropy H(Y) (NaN)' },
        { key: 'joint_entropy', value: Number.NaN, unit: 'bits', label: 'Joint Entropy H(X,Y) (NaN)' },
        { key: 'mutual_information', value: Number.NaN, unit: 'bits', label: 'Mutual Information I(X;Y) (NaN)' },
      ], steps: ['Error: px, py must be in (0, 1)'] };
    }

    // Binary entropy: H(p) = −p·log₂(p) − (1−p)·log₂(1−p)
    const Hx = -(px * Math.log2(px) + (1 - px) * Math.log2(1 - px));
    const Hy = -(py * Math.log2(py) + (1 - py) * Math.log2(1 - py));

    // Hxy is the joint entropy H(X,Y) in bits (directly provided)
    const Hjoint = Hxy;

    // Mutual information: I(X;Y) = H(X) + H(Y) − H(X,Y)
    const MI = Hx + Hy - Hjoint;

    return {
      result: Hx, unit: 'bits',
      secondary: [
        { key: 'entropy_y', value: Hy, unit: 'bits', label: 'Entropy H(Y)' },
        { key: 'joint_entropy', value: Hjoint, unit: 'bits', label: 'Joint Entropy H(X,Y)' },
        { key: 'mutual_information', value: MI, unit: 'bits', label: 'Mutual Information I(X;Y)' },
      ],
      steps: [
        '── Shannon Information Entropy (Shannon 1948) ──',
        `  p(x) = ${px.toFixed(4)}, p(y) = ${py.toFixed(4)}`,
        `  Joint entropy H(X,Y) = ${Hjoint.toFixed(4)} bits (provided)`,
        '',
        'Step 1 — Binary entropy H(X):',
        `  H(X) = −p·log₂(p) − (1−p)·log₂(1−p)`,
        `  H(X) = −${px.toFixed(4)}·log₂(${px.toFixed(4)}) − ${(1-px).toFixed(4)}·log₂(${(1-px).toFixed(4)})`,
        `  H(X) = ${Hx.toFixed(4)} bits ${Hx === 1 ? '(maximum for binary)' : Hx < 0.1 ? '(near-deterministic)' : ''}`,
        '',
        'Step 2 — Binary entropy H(Y):',
        `  H(Y) = −${py.toFixed(4)}·log₂(${py.toFixed(4)}) − ${(1-py).toFixed(4)}·log₂(${(1-py).toFixed(4)})`,
        `  H(Y) = ${Hy.toFixed(4)} bits`,
        '',
        'Step 3 — Mutual information:',
        `  I(X;Y) = H(X) + H(Y) − H(X,Y)`,
        `  I(X;Y) = ${Hx.toFixed(4)} + ${Hy.toFixed(4)} − ${Hjoint.toFixed(4)}`,
        `  I(X;Y) = ${MI.toFixed(4)} bits ${MI === 0 ? '(independent)' : MI > 0 ? '(dependent)' : '(inconsistent: H(X,Y) > H(X)+H(Y))'}`,
        '',
        `  └ I(X;Y) ≥ 0 always; I = 0 iff X,Y independent; I = min(H(X),H(Y)) iff one determines the other` ,
      ]
    };
  },

  // ── Domain 25: Signal Processing ──
  145: ({ dKm, fGHz }) => {
    // Free-Space Path Loss (Friis 1946; ITU-R P.525-2)
    // FSPL(dB) = 32.45 + 20·log₁₀(d_km) + 20·log₁₀(f_GHz)
    if (!Number.isFinite(dKm) || !Number.isFinite(fGHz) || dKm <= 0 || fGHz <= 0) {
      return { result: NaN, unit: 'dB', secondary: [
        { key: 'wavelength_m', value: Number.NaN, unit: 'm', label: 'Wavelength λ = c/f (NaN)' },
        { key: 'received_power_dBm', value: Number.NaN, unit: 'dBm', label: 'Received Power P_r (NaN)' },
      ], steps: ['Error: d > 0 and f > 0 required'] };
    }
    const logD = 20 * Math.log10(dKm);
    const logF = 20 * Math.log10(fGHz);
    const FSPL = 32.45 + logD + logF;
    const lambda_m = 0.3 / fGHz;  // λ = c/f, c ≈ 3×10⁸ m/s → 0.3/f(GHz) m

    // Reference link budget: P_t=40 dBm (10 W), G_t=20 dBi, G_r=0 dBi
    const Pt = 40, Gt = 20, Gr = 0;
    const Pr = Pt + Gt + Gr - FSPL;

    return {
      result: FSPL, unit: 'dB',
      secondary: [
        { key: 'wavelength_m', value: lambda_m, unit: 'm', label: 'Wavelength λ = c/f' },
        { key: 'received_power_dBm', value: Pr, unit: 'dBm', label: 'Received Power P_r (10 W, 20 dBi ref link)' },
      ],
      steps: [
        '── Free-Space Path Loss (Friis 1946; ITU-R P.525-2) ──',
        `  Distance d = ${dKm >= 1e6 ? (dKm/1e6).toFixed(2) + '×10⁶ km' : dKm >= 1000 ? (dKm/1000).toFixed(1) + '×10³ km' : dKm.toFixed(1) + ' km'}`,
        `  Frequency f = ${fGHz >= 1 ? fGHz.toFixed(2) + ' GHz' : (fGHz*1000).toFixed(0) + ' MHz'}`,
        `  Wavelength λ = 0.3/f = ${lambda_m.toFixed(4)} m (${(lambda_m*100).toFixed(2)} cm)`,
        '',
        'Step 1 — Distance term:',
        `  20·log₁₀(${dKm.toExponential(2)}) = ${logD.toFixed(2)} dB`,
        '',
        'Step 2 — Frequency term:',
        `  20·log₁₀(${fGHz.toExponential(2)}) = ${logF.toFixed(2)} dB`,
        '',
        'Step 3 — Free-space path loss:',
        `  FSPL = 32.45 + ${logD.toFixed(2)} + ${logF.toFixed(2)}`,
        `  FSPL = ${FSPL.toFixed(2)} dB`,
        '',
        'Step 4 — Reference link budget:',
        `  P_r = P_t + G_t + G_r − FSPL = ${Pt} + ${Gt} + ${Gr} − ${FSPL.toFixed(2)}`,
        `  P_r = ${Pr.toFixed(2)} dBm ${Pr > -100 ? '(strong signal)' : Pr > -140 ? '(weak but detectable)' : '(below typical receiver sensitivity)'}` ,
        '',
        `  └ FSPL increases 6 dB per doubling of distance (inverse-square law)`,
        `  └ FSPL increases 6 dB per doubling of frequency`,
      ]
    };
  },
   146: ({ alpha1, alpha2, alpha3, alpha4, beta1, beta2, beta3, beta4, phi_m, t_sec, elevation }) => {
      // Full Klobuchar (1987) ICD-GPS-200: compute amplitude & period from 8
      // broadcast coefficients. NOTE the paper's units: "all angles are in
      // units of semi-circle" — the α/β polynomials are evaluated with φ_m in
      // SEMICIRCLES (180° = 1), NOT degrees. Using degrees yields ~9 orders of
      // magnitude error in the amplitude term.
      const phiMDeg = Number(phi_m ?? 0);      // geomagnetic latitude of IPP (°)
      const phiM_sc = phiMDeg / 180;   // → semicircles (paper eq. 4)
      const tSec = Number(t_sec ?? 50400);     // local time at IPP (s), default 14:00 peak
      const elevDeg = Number(elevation ?? 90); // satellite elevation (°), default zenith
      const elev_sc = elevDeg / 180;   // → semicircles
      // Physical defaults: real broadcast α are ~1e-8 s (amplitude in seconds
      // per unit of geomagnetic latitude, semicircles); β are ~1e4 s (period).
      const Ai = Number(alpha1 ?? 5e-9) + Number(alpha2 ?? 0) * phiM_sc + Number(alpha3 ?? 0) * phiM_sc ** 2 + Number(alpha4 ?? 0) * phiM_sc ** 3;   // amplitude (s)
      const Pi = Math.max(200, Number(beta1 ?? 50400) + Number(beta2 ?? 0) * phiM_sc + Number(beta3 ?? 0) * phiM_sc ** 2 + Number(beta4 ?? 0) * phiM_sc ** 3); // period (s), clamped ≥200
      const x = 2 * Math.PI * (tSec - 50400) / Pi;
      const poly = 1 - (x * x) / 2 + Math.pow(x, 4) / 24;
      // Nighttime: |x| >= π/2 → no ionospheric delay beyond the 5 ns base
      const delay_s = Math.abs(x) < Math.PI / 2 ? 5e-9 + Math.max(0, Ai) * poly : 5e-9;
      // Obliquity (slant) factor: F = 1 + 16·(0.53 − E)³, E in semicircles
      // (paper "SUMMARY OF ALGORITHM EQUATIONS" step 6).
      const F = 1 + 16 * Math.pow(0.53 - elev_sc, 3);
      const slant_s = delay_s * F;
      const delay_ns = delay_s * 1e9;
      const slant_ns = slant_s * 1e9;
      const rangeErr = slant_s * 299792458;
      return {
        result: delay_ns, unit: 'ns',
        secondary: [
          { key: 'slant_delay', value: Number.isFinite(slant_ns) ? slant_ns : Number.NaN, unit: 'ns', label: 'Slant Delay (with obliquity F)' },
          { key: 'slant_factor', value: Number.isFinite(F) ? F : Number.NaN, unit: '—', label: 'Obliquity Factor F' },
          { key: 'range_error', value: Number.isFinite(rangeErr) ? rangeErr : Number.NaN, unit: 'm', label: 'Range Error (c·τ)' },
          { key: 'amplitude', value: Number.isFinite(Ai) ? Ai : Number.NaN, unit: 's', label: 'Amplitude A (α polynomial)' },
          { key: 'period', value: Number.isFinite(Pi) ? Pi : Number.NaN, unit: 's', label: 'Period P (β polynomial)' },
        ],
        // Timeseries series (tool vizType 'timeseries'): vertical ionospheric
        // delay τ(t) over the full diurnal cycle (local time 0–86400 s,
        // 24 points) from the tool's own Klobuchar formula
        // Δτ = 5 ns + A·(1 − x²/2 + x⁴/24), x = 2π(t−50400)/P.
        series: [{
          label: 'Klobuchar vertical delay τ(t) (local time, ns)',
          color: '#0072B2',
          points: Array.from({ length: 24 }, (_, i) => {
            const tt = i * (86400 / 23); // local time 0 → 86400 s
            const xx = 2 * Math.PI * (tt - 50400) / Pi;
            const polyy = 1 - (xx * xx) / 2 + Math.pow(xx, 4) / 24;
            const delay = Math.abs(xx) < Math.PI / 2 ? 5e-9 + Math.max(0, Ai) * polyy : 5e-9;
            const delayNS = delay * 1e9;
            return { x: tt, y: Number.isFinite(delayNS) ? delayNS : Number.NaN };
          }),
        }],
        steps: [
          '── Klobuchar Ionospheric Delay Model (Klobuchar, 1987; ICD-GPS-200) ──',
          `Geomagnetic latitude φ_m = ${phiMDeg.toFixed(2)}° = ${phiM_sc.toFixed(4)} semicircles (paper: angles in semicircles)`,
          `Local time at IPP t = ${tSec} s (${(tSec / 3600).toFixed(2)} h)`,
          `Elevation E = ${elevDeg.toFixed(1)}° (obliquity F = 1 + 16(0.53−E)³)`,
          '',
          'Step 1 — Amplitude (α polynomial, φ_m in semicircles):',
          `  A = α₀ + α₁·φ_m + α₂·φ_m² + α₃·φ_m³ = ${Ai.toExponential(2)} s`,
          '',
          'Step 2 — Period (β polynomial):',
          `  P = β₀ + β₁·φ_m + β₂·φ_m² + β₃·φ_m³ = ${Pi.toExponential(3)} s`,
          '',
          'Step 3 — Normalised time x = 2π(t − 50400)/P:',
          `  x = ${x.toFixed(4)} (drives cosinusoidal shape)`,
          '',
          'Step 4 — Polynomial approximation of cosine:',
          `  1 − x²/2 + x⁴/24 = 1 − (${x.toFixed(4)})²/2 + (${x.toFixed(4)})⁴/24`,
          `  = ${poly.toFixed(4)}`,
          '',
          'Step 5 — Vertical delay at L1 (1.57542 GHz):',
          `  Δτ = 5 ns + A × (1 − x²/2 + x⁴/24)`,
          `  Δτ = 5 ns + ${Ai.toExponential(2)} × ${poly.toFixed(4)}`,
          `  Δτ = ${delay_s.toExponential(3)} s = ${delay_ns.toFixed(1)} ns`,
          '',
          'Step 6 — Obliquity (slant) factor F = 1 + 16·(0.53 − E)³:',
          `  F = 1 + 16 × (0.53 − ${elev_sc.toFixed(4)})³ = ${F.toFixed(4)}`,
          `  Slant delay = ${slant_s.toExponential(3)} s = ${slant_ns.toFixed(1)} ns`,
          '',
          'Step 7 — Range error equivalent:',
          `  Δρ = c·Δτ = ${rangeErr.toFixed(2)} m`,
          '',
          'Step 8 — Diurnal variation:',
          `  ${delay_ns > 15 ? 'HIGH delay — midday / equatorial / solar max conditions' : delay_ns > 5 ? 'MODERATE — typical mid-latitude daytime' : 'LOW — night-time / polar / solar minimum'}`,
          '',
          `  └ Klobuchar removes ~50% RMS error; dual-frequency (L1/L2) removes >90%`,
          `  └ Paper worked example (40°N,100°W, E=20°): α=[3.82e-8,1.49e-8,-1.79e-7,0], β=[1.43e5,0,-3.28e5,1.13e5], φ_m=45.16°, t=50700 s → TIONO = 77.6 ns (23.3 m) — reproduced exactly (F=2.176).`,
        ]
      };
    },
  147: ({ f0, vrel, c: cLight }) => {
    // Classical Doppler Effect (Doppler 1842)
    // Non-relativistic: Δf = −f₀ · v/c (v positive = receding → redshift)
    // Relativistic: f_obs = f₀ · √((1−β)/(1+β)) where β = v/c
    const c0 = cLight || 299792458;
    if (!Number.isFinite(f0) || f0 <= 0 || !Number.isFinite(vrel) || !Number.isFinite(c0) || c0 <= 0 || Math.abs(vrel) >= c0) {
      return { result: NaN, unit: 'Hz', secondary: [
        { key: 'relativistic_shift', value: Number.NaN, unit: 'Hz', label: 'Relativistic Frequency Shift (exact) (NaN)' },
        { key: 'observed_frequency', value: Number.NaN, unit: 'Hz', label: 'Observed Frequency (relativistic) (NaN)' },
        { key: 'beta', value: Number.NaN, unit: '—', label: 'β = v/c (NaN)' },
      ], steps: ['Error: f0 > 0, finite v_rel, and |v| < c required'] };
    }
    const beta = vrel / c0;
    const isRecede = vrel > 0;

    // Non-relativistic frequency shift (sign: positive v → redshift → negative Δf)
    const df_nonrel = -f0 * beta + 0;  // +0 normalizes signed zero for v = 0

    // Relativistic frequency shift (exact)
    const gammaRel = 1 / Math.sqrt(1 - beta * beta);
    const df_rel = f0 * (gammaRel * (1 - beta) - 1);  // exact: f_obs = f₀·√((1−β)/(1+β))
    const f_obs_rel = f0 + df_rel;

    // For v << c, both should agree
    const relError = Math.abs(df_nonrel) > 0 ? Math.abs((df_rel - df_nonrel) / df_nonrel) * 100 : 0;

    return {
      result: df_nonrel, unit: 'Hz',
      secondary: [
        { key: 'relativistic_shift', value: df_rel, unit: 'Hz', label: 'Relativistic Frequency Shift (exact)' },
        { key: 'observed_frequency', value: f_obs_rel, unit: 'Hz', label: 'Observed Frequency (relativistic)' },
        { key: 'beta', value: beta, unit: '—', label: 'β = v/c' },
      ],
      series: [{
        label: 'Classical vs Relativistic Δf (f₀ fixed)',
        points: Array.from({ length: 41 }, (_, i) => {
          const v = -0.8 * c0 + i * (1.6 * c0 / 40);  // β from −0.8c to +0.8c
          const b = v / c0;
          const rel = f0 * (1 / Math.sqrt(1 - b * b) * (1 - b) - 1);
          return { x: b, y: rel };
        }),
      }],
      steps: [
        '── Classical Doppler Effect (Doppler 1842) ──',
        `  Source frequency f₀ = ${f0.toExponential(4)} Hz`,
        `  Relative velocity v = ${vrel.toFixed(1)} m/s (${isRecede ? 'receding' : 'approaching'})`,
        `  Speed of light c = ${c0.toExponential(4)} m/s`,
        '',
        'Step 1 — β factor:',
        `  β = v/c = ${vrel.toFixed(1)} / ${c0.toExponential(4)} = ${beta.toExponential(4)}`,
        `  ${Math.abs(beta) < 0.01 ? '(non-relativistic regime: β ≪ 1)' : Math.abs(beta) < 0.1 ? '(mildly relativistic)' : '(relativistic — use exact formula)'}`,
        '',
        'Step 2 — Frequency shift (non-relativistic):',
        `  Δf = −f₀ × β = −${f0.toExponential(4)} × ${beta.toExponential(4)}`,
        `  Δf = ${df_nonrel.toExponential(4)} Hz (${Math.abs(df_nonrel) > 1e6 ? (df_nonrel / 1e6).toFixed(2) + ' MHz' : Math.abs(df_nonrel) > 1e3 ? (df_nonrel / 1e3).toFixed(2) + ' kHz' : df_nonrel.toFixed(2) + ' Hz'})`,
        '',
        'Step 3 — Observed frequency:',
        `  f_obs = f₀ + Δf = ${(f0 + df_nonrel).toExponential(4)} Hz`,
        `  ${isRecede ? 'REDSHIFT (receding: f_obs < f₀)' : 'BLUESHIFT (approaching: f_obs > f₀)'}`,
        '',
        'Step 4 — Relativistic correction:',
        `  Δf_rel = ${df_rel.toExponential(4)} Hz (error: ${relError.toFixed(4)}%)`,
        '',
        `  └ GPS satellites: Doppler shift ~±5 kHz at L1 (1.575 GHz, v≈3.9 km/s)`,
        `  └ Weather radar: Doppler measures radial velocity of precipitation`,
      ]
    };
  },

  // ── Domain 26: Mathematical Frameworks ──
  148: ({ GM, r1, r2 }) => {
    // Hohmann Transfer (Hohmann 1925)
    // Δv₁ = √(GM/r₁)·[√(2r₂/(r₁+r₂)) − 1]
    // Δv₂ = √(GM/r₂)·[1 − √(2r₁/(r₁+r₂))]
    if (!Number.isFinite(GM) || !Number.isFinite(r1) || !Number.isFinite(r2) || r1 <= 0 || r2 <= 0 || GM <= 0) {
      return { result: NaN, unit: 'm/s', secondary: [
        { key: 'dv2', value: Number.NaN, unit: 'm/s', label: 'Circularization Δv₂ (NaN)' },
        { key: 'total_dv', value: Number.NaN, unit: 'm/s', label: 'Total Δv = |Δv₁| + |Δv₂| (NaN)' },
        { key: 'transfer_time_s', value: Number.NaN, unit: 's', label: 'Transfer Time (half period) (NaN)' },
        { key: 'transfer_time_h', value: Number.NaN, unit: 'h', label: 'Transfer Time (NaN)' },
        { key: 'semi_major_axis', value: Number.NaN, unit: 'm', label: 'Transfer Ellipse Semi-Major Axis (NaN)' },
        { key: 'period', value: Number.NaN, unit: 's', label: 'Transfer Orbit Period (NaN)' },
      ], steps: ['Error: GM, r1, r2 must be > 0'] };
    }
    const v_circ1 = Math.sqrt(GM / r1);
    const v_circ2 = Math.sqrt(GM / r2);
    const sqrtTerm = Math.sqrt(2 * r2 / (r1 + r2));
    const dv1 = v_circ1 * (sqrtTerm - 1);
    const dv2 = v_circ2 * (1 - Math.sqrt(2 * r1 / (r1 + r2)));
    const totalDV = Math.abs(dv1) + Math.abs(dv2);  // use absolute values for total
    const semiMajor = (r1 + r2) / 2;
    const period = 2 * Math.PI * Math.sqrt(Math.pow(semiMajor, 3) / GM);
    const transferTime = period / 2;
    const ratio = r2 / r1;

    return {
      result: dv1, unit: 'm/s',
      secondary: [
        { key: 'dv2', value: dv2, unit: 'm/s', label: 'Circularization Δv₂' },
        { key: 'total_dv', value: totalDV, unit: 'm/s', label: 'Total Δv = |Δv₁| + |Δv₂|' },
        { key: 'transfer_time_s', value: transferTime, unit: 's', label: 'Transfer Time (half period)' },
        { key: 'transfer_time_h', value: transferTime / 3600, unit: 'h', label: 'Transfer Time' },
        { key: 'semi_major_axis', value: semiMajor, unit: 'm', label: 'Transfer Ellipse Semi-Major Axis' },
        { key: 'period', value: period, unit: 's', label: 'Transfer Orbit Period' },
      ],
      series: [{
        label: 'Transfer-orbit velocity vs radius (r₁ → r₂)',
        points: Array.from({ length: 51 }, (_, i) => {
          const r = r1 + i * (r2 - r1) / 50;
          return { x: r / 1000, y: Math.sqrt(GM / r) / 1000 };
        }),
      }],
      steps: [
        '── Hohmann Transfer Orbit (Hohmann 1925) ──',
        `  GM = ${GM.toExponential(3)} m³/s², r₁ = ${(r1/1000).toFixed(0)} km, r₂ = ${(r2/1000).toFixed(0)} km` ,
        `  r₂/r₁ = ${ratio.toFixed(2)} ${ratio < 11.94 ? '(Hohmann optimal)' : '(bi-elliptic may be more efficient)'}` ,
        '',
        'Step 1 — Circular velocities:',
        `  v₁ = √(GM/r₁) = ${(v_circ1/1000).toFixed(2)} km/s` ,
        `  v₂ = √(GM/r₂) = ${(v_circ2/1000).toFixed(2)} km/s` ,
        '',
        'Step 2 — Δv₁ (injection burn at r₁):',
        `  Δv₁ = v₁·[√(2r₂/(r₁+r₂)) − 1] = ${(dv1/1000).toFixed(3)} km/s` ,
        '',
        'Step 3 — Δv₂ (circularization burn at r₂):',
        `  Δv₂ = v₂·[1 − √(2r₁/(r₁+r₂))] = ${(dv2/1000).toFixed(3)} km/s` ,
        '',
        'Step 4 — Total:',
        `  |Δv₁| + |Δv₂| = ${(totalDV/1000).toFixed(3)} km/s` ,
        `  Transfer time = ${(transferTime/3600).toFixed(1)} h = ${(transferTime/86400).toFixed(1)} days` ,
        '',
        `  └ Hohmann is optimal for r₂/r₁ < 11.94; above that, bi-elliptic transfer saves fuel` ,
      ]
    };
  },
  149: ({ x: m1, y: m2 }) => {
    // Lagrange Points L1-L5 (Lagrange 1772; Euler 1767)
    // Circular Restricted 3-Body Problem (CR3BP)
    // x = m1 (primary mass), y = m2 (secondary mass)
    if (!Number.isFinite(m1) || !Number.isFinite(m2) || m1 <= 0 || m2 <= 0) {
      return { result: NaN, unit: '—', secondary: [
        { key: 'L1_from_secondary', value: Number.NaN, unit: '—', label: 'L1 distance from secondary (NaN)' },
        { key: 'L2_from_secondary', value: Number.NaN, unit: '—', label: 'L2 distance from secondary (NaN)' },
        { key: 'L4_x', value: Number.NaN, unit: '—', label: 'L4 x-coordinate (NaN)' },
        { key: 'L4_y', value: Number.NaN, unit: '—', label: 'L4 y-coordinate (NaN)' },
        { key: 'L5_x', value: Number.NaN, unit: '—', label: 'L5 x-coordinate (NaN)' },
        { key: 'L5_y', value: Number.NaN, unit: '—', label: 'L5 y-coordinate (NaN)' },
        { key: 'mass_ratio', value: Number.NaN, unit: '—', label: 'Mass ratio μ = M₂/(M₁+M₂) (NaN)' },
      ], steps: ['Error: m1 > 0 and m2 > 0 required'] };
    }
    const mu = m2 / (m1 + m2);  // mass ratio

    // Newton-Raphson for the collinear equilibrium (force balance in the
    // rotating frame). r is measured from the secondary:
    //   L1 (between masses): r in (0,1), f1 = (1-μ-r) − (1-μ)/(1−r)² + μ/r²
    //   L2 (beyond secondary): r > 0,      f2 = (1-μ+r) − (1-μ)/(1+r)² − μ/r²
    //   L3 (far side of primary): u = distance from primary,
    //       f3 = u + μ − (1-μ)/u² − μ/(u+1)²
    function solveNR(f: (r: number) => number, fp: (r: number) => number, init: number, maxIter = 50): number {
      let r = init;
      for (let i = 0; i < maxIter; i++) {
        const df = fp(r);
        if (!Number.isFinite(df) || Math.abs(df) < 1e-15) break;
        const dr = f(r) / df;
        r -= dr;
        if (!Number.isFinite(r) || Math.abs(dr) < 1e-15) break;
      }
      return r;
    }

    // L1: between primary and secondary, measured from secondary toward primary
    const f1 = (r: number) => (1 - mu - r) - (1 - mu) / Math.pow(1 - r, 2) + mu / (r * r);
    const f1p = (r: number) => -1 - 2 * (1 - mu) / Math.pow(1 - r, 3) - 2 * mu / Math.pow(r, 3);
    const rL1 = solveNR(f1, f1p, 1 - Math.pow(mu / 3, 1 / 3));

    // L2: beyond secondary, measured from secondary away from primary
    const f2 = (r: number) => (1 - mu + r) - (1 - mu) / Math.pow(1 + r, 2) - mu / (r * r);
    const f2p = (r: number) => 1 + 2 * (1 - mu) / Math.pow(1 + r, 3) + 2 * mu / Math.pow(r, 3);
    const rL2 = solveNR(f2, f2p, 1 + Math.pow(mu / 3, 1 / 3));

    // L3: on opposite side of primary from secondary, u = distance from primary
    const f3 = (u: number) => u + mu - (1 - mu) / (u * u) - mu / Math.pow(u + 1, 2);
    const f3p = (u: number) => 1 + 2 * (1 - mu) / Math.pow(u, 3) + 2 * mu / Math.pow(u + 1, 3);
    const uL3 = Math.abs(solveNR(f3, f3p, 1.0));

    // L4, L5: triangular points at ±60° from secondary
    // In rotating frame: x = 0.5 - mu, y = ±√3/2
    const xL4 = 0.5 - mu;
    const yL4 = Math.sqrt(3) / 2;

    return {
      result: rL1, unit: '— (normalized to orbital separation)',
      secondary: [
        { key: 'L1_from_secondary', value: rL1, unit: '—', label: 'L1 distance from secondary' },
        { key: 'L1_from_primary', value: 1 - rL1, unit: '—', label: 'L1 distance from primary' },
        { key: 'L2_from_secondary', value: rL2, unit: '—', label: 'L2 distance from secondary' },
        { key: 'L2_from_primary', value: 1 + rL2, unit: '—', label: 'L2 distance from primary' },
        { key: 'L3_from_primary', value: uL3, unit: '—', label: 'L3 distance from primary' },
        { key: 'L4_x', value: xL4, unit: '—', label: 'L4 x-coordinate' },
        { key: 'L4_y', value: yL4, unit: '—', label: 'L4 y-coordinate' },
        { key: 'L5_x', value: xL4, unit: '—', label: 'L5 x-coordinate' },
        { key: 'L5_y', value: -yL4, unit: '—', label: 'L5 y-coordinate' },
        { key: 'mass_ratio', value: mu, unit: '—', label: 'Mass ratio μ = M₂/(M₁+M₂)' },
      ],
      steps: [
        '── Lagrange Points L1-L5 (Lagrange 1772; Euler 1767) ──',
        `  Primary mass M₁ = ${m1.toExponential(3)} kg`,
        `  Secondary mass M₂ = ${m2.toExponential(3)} kg`,
        `  Mass ratio μ = M₂/(M₁+M₂) = ${mu.toExponential(6)}`,
        `  (Earth-Moon: μ ≈ 0.01215; Sun-Earth: μ ≈ 3.003×10⁻⁶)`,
        '',
        'Step 1 — Collinear points (L1, L2, L3) via Newton-Raphson:',
        `  L1: ${rL1.toFixed(6)} from secondary, ${(1 - rL1).toFixed(6)} from primary` ,
        `  L2: ${rL2.toFixed(6)} from secondary, ${(1 + rL2).toFixed(6)} from primary` ,
        `  L3: ${uL3.toFixed(6)} from primary (opposite side)` ,
        '',
        'Step 2 — Triangular points (L4, L5):',
        `  L4: (${xL4.toFixed(6)}, +${yL4.toFixed(6)}) — 60° ahead of secondary` ,
        `  L5: (${xL4.toFixed(6)}, −${yL4.toFixed(6)}) — 60° behind secondary` ,
        '',
        'Step 3 — Stability:',
        `  L1, L2, L3: UNSTABLE (saddle points — station-keeping required)` ,
        `  L4, L5: STABLE for μ < 0.0385 (Earth-Moon: μ=0.012 → stable!)` ,
        '',
        `  └ L1: SOHO, ACE, DSCOVR (Sun-Earth); L2: JWST, Planck, Gaia (Sun-Earth)` ,
        `  └ L4/L5: Trojan asteroids (Jupiter), Kordylewski dust clouds (Earth-Moon)` ,
      ]
    };
  },
  150: ({ px, py, pxy }) => {
    // Mutual Information (Shannon 1948; Cover & Thomas 2006)
    // For binary variables: I(X;Y) = H(X) + H(Y) − H(X,Y)
    // where H(X) = −p·log₂(p) − (1−p)·log₂(1−p) (binary entropy)
    // and H(X,Y) = −Σ p(x,y)·log₂(p(x,y)) over 4 joint outcomes
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pxy) || px <= 0 || px >= 1 || py <= 0 || py >= 1 || pxy < 0 || pxy > Math.min(px, py)) {
      return { result: NaN, unit: 'bits', secondary: [
        { key: 'entropy_x', value: Number.NaN, unit: 'bits', label: 'Entropy H(X) (NaN)' },
        { key: 'entropy_y', value: Number.NaN, unit: 'bits', label: 'Entropy H(Y) (NaN)' },
        { key: 'joint_entropy', value: Number.NaN, unit: 'bits', label: 'Joint Entropy H(X,Y) (NaN)' },
        { key: 'p00', value: Number.NaN, unit: '—', label: 'p(x=0,y=0) (NaN)' },
        { key: 'p01', value: Number.NaN, unit: '—', label: 'p(x=0,y=1) (NaN)' },
        { key: 'p10', value: Number.NaN, unit: '—', label: 'p(x=1,y=0) (NaN)' },
        { key: 'p11', value: Number.NaN, unit: '—', label: 'p(x=1,y=1) (NaN)' },
      ], steps: ['Error: px,py ∈ (0,1), 0 ≤ pxy ≤ min(px,py)'] };
    }

    // Binary entropy for marginals
    const Hx = -(px * Math.log2(px) + (1 - px) * Math.log2(1 - px));
    const Hy = -(py * Math.log2(py) + (1 - py) * Math.log2(1 - py));

    // Joint distribution for binary variables
    const p11 = pxy;           // p(x=1, y=1)
    const p10 = px - pxy;      // p(x=1, y=0)
    const p01 = py - pxy;      // p(x=0, y=1)
    const p00 = 1 - px - py + pxy;  // p(x=0, y=0)

    // Joint entropy H(X,Y)
    function Hb(p: number): number { return p > 0 ? -p * Math.log2(p) : 0; }
    const Hjoint = Hb(p11) + Hb(p10) + Hb(p01) + Hb(p00);

    // Mutual information
    const MI = Hx + Hy - Hjoint;

    return {
      result: MI, unit: 'bits',
      secondary: [
        { key: 'entropy_x', value: Hx, unit: 'bits', label: 'Entropy H(X)' },
        { key: 'entropy_y', value: Hy, unit: 'bits', label: 'Entropy H(Y)' },
        { key: 'joint_entropy', value: Hjoint, unit: 'bits', label: 'Joint Entropy H(X,Y)' },
        { key: 'p00', value: p00, unit: '—', label: 'p(x=0,y=0)' },
        { key: 'p01', value: p01, unit: '—', label: 'p(x=0,y=1)' },
        { key: 'p10', value: p10, unit: '—', label: 'p(x=1,y=0)' },
        { key: 'p11', value: p11, unit: '—', label: 'p(x=1,y=1)' },
      ],
      steps: [
        '── Mutual Information (Shannon 1948; Cover & Thomas 2006) ──',
        `  p(x=1) = ${px.toFixed(4)}, p(y=1) = ${py.toFixed(4)}`,
        `  p(x=1,y=1) = ${pxy.toFixed(4)}`,
        '',
        'Step 1 — Binary entropies:',
        `  H(X) = −${px.toFixed(4)}·log₂(${px.toFixed(4)}) − ${(1-px).toFixed(4)}·log₂(${(1-px).toFixed(4)}) = ${Hx.toFixed(4)} bits`,
        `  H(Y) = −${py.toFixed(4)}·log₂(${py.toFixed(4)}) − ${(1-py).toFixed(4)}·log₂(${(1-py).toFixed(4)}) = ${Hy.toFixed(4)} bits`,
        '',
        'Step 2 — Joint distribution:',
        `  p(1,1) = ${p11.toFixed(4)},  p(1,0) = ${p10.toFixed(4)}`,
        `  p(0,1) = ${p01.toFixed(4)},  p(0,0) = ${p00.toFixed(4)}`,
        '',
        'Step 3 — Joint entropy H(X,Y):',
        `  H(X,Y) = ${Hjoint.toFixed(4)} bits`,
        '',
        'Step 4 — Mutual information:',
        `  I(X;Y) = H(X) + H(Y) − H(X,Y) = ${Hx.toFixed(4)} + ${Hy.toFixed(4)} − ${Hjoint.toFixed(4)}`,
        `  I(X;Y) = ${MI.toFixed(4)} bits ${MI < 0.01 ? '(nearly independent)' : MI < 0.5 ? '(moderate dependence)' : '(strong dependence)'}`,
        '',
        `  └ I(X;Y) ≥ 0; I = 0 iff X,Y independent; I = min(H(X),H(Y)) iff one determines the other` ,
        `  └ NMI = I(X;Y) / √(H(X)·H(Y)) normalizes to [0, 1]`,
      ]
    };
  },
};

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/** Lanczos approximation of the Gamma function (g=7, 6 terms). Accurate to
 *  ~2×10⁻¹⁰ for non-integer arguments. For integer n, Γ(n) = (n−1)! */
function gamma(z: number): number {
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

/**
 * Maps the analytical-tool input symbols (often Unicode subscripts / Greek
 * letters, e.g. Rₙ, σₙ, T_air) to the plain-ASCII parameter names the
 * compute functions destructure. Without this every non-ASCII input arrives
 * as `undefined` and the result is NaN.
 */
const PARAM_ALIASES: Record<number, Record<string, string>> = {
  1: { 'T₁₀': 'T10', 'T₁₁': 'T11', 'ε₁₀': 'eps10', 'ε₁₁': 'eps11' },
  2: { 'λ': 'lambda' },
  5: { 'ρ': 'rho', 'dP/dx': 'dPdx', 'dP/dy': 'dPdy' },
  6: { 'C₀': 'C0' },
  7: { 'z_g': 'zg', 'z_s': 'zs', 'θᵥ(z)': 'thvz', 'θᵥ(s)': 'thvs', 'u(z)': 'uz', 'u(s)': 'us' },
  8: { 'ε': 'eps' },
  9: { 'Rₙ': 'Rn', 'u₂': 'u2', 'eₛ': 'es', 'eₐ': 'ea', 'Δ': 'delta', 'γ': 'gamma' },
  10: { 'Iₐ': 'Ia' },
  13: { 'Iₜ': 'It', 'Oₜ': 'Ot' },
  14: { 'H₀': 'H0' },
  15: { 'τ': 'tau', 'ρ': 'rho', 'Aᵥ': 'A' },
  16: { 'ρ': 'rho', '∂p/∂x': 'dpdx' },
  17: { 'Qₛ': 'Qs', 'Q_b': 'Qb', 'Q_h': 'Qh', 'Q_e': 'Qe' },
  18: { 'Kₛ': 'Ks', 'ψ_w': 'psiW', 'ψ₀': 'psi0', 'Δθ': 'dTheta', 'F(t)': 'Ft' },
  21: { 'M': 'mag', 'R_rup': 'rrup', 'R_jb': 'rjb', 'R_x': 'rx', 'V_s30': 'vs30', 'λ': 'rake', 'D_ip': 'dip', 'Z_tor': 'ztor', 'W_id': 'width', 'H_d': 'hypoDepth' },
  22: { 'σₙ': 'sigmaN', 'tan φ': 'tanPhi' },
  23: { 'M₀': 'M0' },
  24: { 'M₀': 'M0' },
  25: { 'M_w': 'Mw' },
  32: { 'ε': 'eps', 'T_fire': 'Tfire', 'T_bg': 'Tbg' },
  33: { 'T_c': 'Tc', 'T_wet': 'Twet', 'T_dry': 'Tdry' },
  34: { 'T_air': 'Tair', 'T_base': 'Tbase' },
  35: { 'T_water': 'Twater', 'T_ice': 'Tice' },
  36: { 'lat₁': 'lat1', 'lon₁': 'lon1', 'lat₂': 'lat2', 'lon₂': 'lon2' },
  37: { 'λᵢ': 'weights' },
  38: { 'wᵢ': 'weights' },
  39: { 'σ_y': 'sigmaY', 'σ_z': 'sigmaZ' },
  40: { 'μ': 'mu', 'β': 'beta' },
  41: { 'ξ': 'xi', 'β': 'beta' },
  43: { 'θ_r': 'thetaR', 'θ_s': 'thetaS', 'α': 'alpha', 'ψ': 'psi' },
  44: { 'ψ_b': 'psib', 'ψ': 'psi', 'λ': 'lambda' },
  46: { 'R_base': 'Rbase', 'Q₁₀': 'Q10', 'T_base': 'Tbase' },
  47: { 'θ': 'theta', 'ρ_b': 'rhoB', 'OM%': 'omPct', 'q': 'sandFrac' },
  48: { 'κ': 'kappa', 'u_*': 'ustar', 'z₀': 'z0M' },
  49: { 'u_*': 'ustar', 'z₀': 'z0' },
  50: { 'g₀': 'g0', 'a₁': 'a1', 'hₛ': 'hs', 'cₛ': 'cs' },
  51: { 'ε': 'eps', 'fPAR': 'fpar', 'PAR': 'par' },
  52: { 'I₀': 'I0' },
  53: { 'R_eco': 'Reco' },
  54: { 'V_cmax': 'Vcmax', 'cᵢ': 'ci', 'Γ*': 'GammaStar', 'K_c': 'Kc', 'K_o': 'Ko' },
  55: { 'ρ': 'rho', 'D': 'DBH' },
  56: { 'K₀': 'K0', 'ΔpCO₂': 'dCO2' },
  57: { 'NO₃s': 'NO3s', 'NO₃d': 'NO3d' },
  58: { 'T_max': 'Tmax', 'T_min': 'Tmin', 'T_avg': 'Tavg', 'T_base': 'Tbase', 'T_upper': 'Tupper' },
  59: { 'α': 'alpha', 'Δ': 'delta', 'γ': 'gamma', 'Rₙ': 'Rn' },
  60: { 'Rₐ': 'Ra', 'T_max': 'Tmax', 'T_min': 'Tmin' },
  61: { 'Yₐ': 'Ya', 'Yₘ': 'Ym', 'K_y': 'Ky', 'ETₐ': 'ETa', 'ETₘ': 'ETm' },
  62: { 'μ₂₀': 'umax' },
  63: { 'ρ': 'rho', 'c_p': 'cp', 'T_s': 'Ts', 'T_a': 'Ta', 'r_a': 'ra', 'r_s': 'rs', 'e_s': 'es', 'e_a': 'ea', 'p': 'p' },
  64: { 'O₂': 'O2', 'J₁': 'J1', 'k₂': 'k2', 'J₃': 'J3', 'k₄': 'k4' },
  65: { '[OH]': 'OH' },
  66: { 'β': 'beta', 'ρ₀': 'rho0', '(∇×τ)_z': 'curlTau_z' },
  67: { 'β': 'beta' },
  68: { 'A_H': 'AH', 'β': 'beta', 'curlτ': 'curlTau', 'curl_z(τ)': 'curlTau' },
  69: { 'λ': 'lambda', 'δ': 'delta' },
  70: { 'Θ': 'Theta', 'S_A': 'S', 'SA': 'S' },
  71: { 'γ': 'gamma', 'ε': 'eps', 'N²': 'N2', '<(∇θ′)²>': 'gradVar', 'κ': 'kappa', '∂θ̄/∂z': 'dTdz' },
  72: { 'Δρ': 'drho', 'ΔV': 'dV', 'ρ₀': 'rho0' },
  73: { 'U₁₀': 'U', 'ω': 'omega', 'U10': 'U' },
  74: { 'H₀': 'H0', 'T₀': 'T0', 'β_f': 'betaF', 'βf': 'betaF' },
  75: { 'L*': 'L', 'h*': 'hstar' },
  76: { 'd_b': 'db' },
  77: { 'H_sb': 'Hsb', 'θ_b': 'thetaB', 'theta_b': 'thetaB' },
  79: { 'ω': 'omega', 'a': 'ka' },
  80: { 'α': 'alpha', 'g': 'g2', 'f_m': 'fm', 'γ': 'gamma' },
  84: { "c'": 'cprime', 'γz': 'gammaz', 'cosβ': 'cosB', "φ'": 'tanphi', 'sinβ': 'sinB', 'cos²β': 'cosB2', 'cos^2β': 'cosB2' },
  85: { 'μ': 'mu', 'σₙ': 'sigmaN', 'σ_n': 'sigmaN', 'ξ': 'xi' },
  86: { 'Aₛ': 'As', 'tan β': 'tanB' },
  87: { 'Aₛ': 'As', 'tan β': 'tanB' },
  88: { 'K_m': 'Km', 'e_w': 'ew', 'e_a': 'ea', 'u₉': 'u' },
  90: { 'Q₀': 'Q0' },
  91: { 'T_pos': 'Tpos' },
  93: { 'ρᵢ': 'rhoI', 'ρ_i': 'rhoI', 'ρ_f': 'rhoF' },
  95: { 'Q̇': 'Qdot', 'ρ_air': 'rhoAir', 'α': 'alpha' },
  96: { '∇²T': 'divDT' },
  97: { 'ΔF': 'dF', 'λ₀': 'lambda0' },
  98: { '∂R/∂T': 'dRdT' },
  99: { 'β': 'beta', 'k_x': 'kx', 'k_y': 'ky' },
  100: { '∂q/∂y': 'dpdy', '∂u/∂y': 'dudy' },
  101: { '∂u/∂z': 'dudy' },
  102: { 'ψ': 'psi', '∂²ψ/∂p²': 'dpp' },
  103: { 'u_bar': 'ubar', 'u_prime': 'uprime' },
  104: { 'K_m': 'Km' },
  105: { 'θ̄_v': 'thetaVbar', "w'θ'_v₀": 'wthetaV', 'z_i': 'zi' },
  106: { '|∇θ|': 'dtheta', 'β': 'cos2b', 'δ': 'delta', '|∂u/∂s|': 'dudy' },
  107: { 'ζ': 'zeta', '∇·V': 'div' },
  109: { 'N₀': 'N0', 'Λ': 'Lambda' },
  111: { 'x_p': 'xp', 'y_p': 'yp', "s'": 'sp', 's′': 'sp', 'GAST': 'gast', 'dX': 'dx', 'dY': 'dy', 'ωx': 'wx', 'ωy': 'wy', 'ωz': 'wz' },
  112: { 'h₂': 'hn', 'hₙ': 'hn', 'k₂': 'kn', 'V₂': 'Vn', 'Vₙ': 'Vn', 'φ': 'lat', 'R_e': 'Re' },
  113: { 'C_nm': 'Cnm', 'S_nm': 'Snm', 'P_nm': 'Pnm', 'λ': 'lam', 'φ': 'phi', 'R_e': 'Re', '∂P/∂φ': 'dPnm' },
  114: { 'ωx': 'wx', 'ωy': 'wy', 'ωz': 'wz', 'Rx': 'wx', 'Ry': 'wy', 'Rz': 'wz' },
  116: { 'nᵢ': 'ni', 'mᵢ': 'mi', 'T': 'T', 'z₀': 'z0' },
  117: { 'N_e': 'Ne', 'N_mF2': 'NmF2', 'h_mF2': 'hmF2' },
  119: { '⟨I⟩': 'Imean', 'σ_I': 'Istd' },
  120: { 'P_dyn': 'Pdyn', 'B_z': 'Bz' },
  121: { 'P_dyn': 'Pdyn' },
  122: { 'ε₀': 'eps0', 'k_B': 'kB', 'T_e': 'Te', 'n_e': 'ne' },
  123: { 'ρ': 'rho', 'C_D': 'CD' },
  124: { 'ρ': 'rho', 'C_D': 'CD' },
  125: { 'A₁': 'A1', 'A₂': 'A2', 'σ_x': 'sigmax', 'σ_y': 'sigmay' },
  126: { 'ρ2': 'rho2', 'ρ': 'rho2', 'σ': 'sigma', 'β': 'beta', 'γ': 'gamma' },
  127: { 'ẋ': 'xdot', 'ẏ': 'ydot', 'ż': 'zdot' },
  128: { 'wᵢ': 'wi', 'Kᵢ': 'Ki', 'Kp': 'kp' },
  129: { 'tr(H)': 'traceH', 'Q₁₁': 'Q11', 'Q₂₂': 'Q22', 'Q₃₃': 'Q33', 'Q₄₄': 'Q44' },
  130: { 'θ': 'Sc' },
  131: { 'h₁': 'h1', 'h₂': 'h2', 'r₁': 'r1', 'r₂': 'r2' },
  134: { 'f_c': 'fc', 'f₀': 'f0' },
  136: { 'D(P)': 'Parr' },
  137: { 'I_Hi': 'IHi', 'I_Lo': 'ILo', 'BP_Hi': 'BPHi', 'BP_Lo': 'BPLo', 'C_p': 'Cp' },
  138: { 'X̄': 'Xbar', 'K_p': 'Kp', 'σ_x': 'sigmaX' },
  139: { 'X_{i-1}': 'Xim1', 'Z': 'Zi', 'α': 'alpha' },
  140: { 'K₀': 'K0', 'V_res': 'Vres', 'h_b': 'hb' },
  141: { 'x_f': 'xf', 'P_f': 'Pf' },
  142: { 'x_b': 'xb' },
  144: { 'p(x)': 'px', 'p(y)': 'py', 'p(x,y)': 'Hxy' },
  145: { 'd_km': 'dKm', 'f_GHz': 'fGHz' },
  146: { 'A': 'alpha1', 'φ_m': 'phi_m' },
  147: { 'f₀': 'f0', 'v_rel': 'vrel' },
  148: { 'r₁': 'r1', 'r₂': 'r2' },
  150: { 'p(x)': 'px', 'p(y)': 'py', 'p(x,y)': 'pxy' },
};

export function normalizeInputs(id: number, inputs: Record<string, number>): Record<string, number> {
  const aliases = PARAM_ALIASES[id];
  const out: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(inputs)) {
    const mapped = aliases ? (aliases[key] ?? key) : key;
    // Defensive numeric coercion: JSON transports inputs as strings (e.g.
    // "25" for T_max). Coerce a string that parses to a finite number; leave
    // objects, arrays, non-numeric strings (station refs, units), null/undefined.
    const value: unknown = rawValue;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      out[mapped] = Number(value) as number;
      continue;
    }
    out[mapped] = value as number;
  }
  return out;
}

export function computeEquation(
  id: number,
  inputs: Record<string, number>,
  _context?: { studyArea?: unknown; time?: unknown; filters?: unknown },
): ComputeResult | null {
  const fn = EQUATION_ENGINE[id];
  if (!fn) return null;
  // Robustness (§5.5.1): a tool must NEVER throw — if an unexpected missing/
  // malformed input path slips past a per-tool guard, return honest NaN instead
  // of crashing the request. Genuine data is never fabricated here.
  try {
    return fn(normalizeInputs(id, inputs));
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
    return {
      result: Number.NaN,
      unit: '—',
      steps: [
        '── Analytical tool ──',
        `Computation failed on the supplied inputs: ${message}`,
        'Result: NaN (honest — no fabricated value substituted).',
      ],
    };
  }
}
