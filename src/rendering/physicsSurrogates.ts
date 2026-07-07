/**
 * Physics-Informed Surrogates for Multi-Hazard Risk Assessment
 *
 * Lightweight, CPU-friendly implementations of canonical physical models.
 * These replace full PDE solvers with analytically-derived surrogates
 * that run in <1ms per evaluation.
 *
 * Models implemented:
 * 1. Seed-Idriss Liquefaction (NCEER 1997)
 * 2. Gaussian Plume Atmospheric Dispersion (Pasquill-Gifford)
 * 3. Simplified Wildfire Spread Rate (FBP/Rothermel-inspired)
 * 4. Kinematic Wave Flood Routing (Manning's equation)
 *
 * All formulas follow peer-reviewed literature with simplified constants
 * appropriate for rapid screening (not engineering design).
 */

/* ═════════════════════════════════════════════════════════════════
   TYPES
   ═════════════════════════════════════════════════════════════════ */

export interface LiquefactionResult {
  /** Cyclic Stress Ratio — seismic demand on soil */
  csr: number;
  /** Cyclic Resistance Ratio — soil's capacity to resist liquefaction */
  crr: number;
  /** Factor of Safety against liquefaction */
  fs: number;
  /** Probability of liquefaction (empirical, from Idriss 1999) */
  probLiquefaction: number;
  /** Liquefaction Severity Index */
  lsi: number;
  /** Whether liquefaction is predicted */
  triggered: boolean;
}

export interface DispersionResult {
  /** Ground-level concentration at (x, y) [μg/m³] */
  concentration: number;
  /** Maximum ground-level concentration [μg/m³] */
  maxConcentration: number;
  /** Distance to maximum ground-level concentration [m] */
  xMax: number;
  /** Effective plume height [m] */
  effectiveHeight: number;
  /** Pasquill-Gifford stability class */
  stabilityClass: string;
}

export interface WildfireSpreadResult {
  /** Rate of spread [m/min] */
  ros: number;
  /** Fireline intensity [kW/m] */
  intensity: number;
  /** Flame length [m] */
  flameLength: number;
  /** Spotting distance [m] */
  spottingDistance: number;
  /** Fire danger level */
  dangerLevel: 'low' | 'moderate' | 'high' | 'extreme';
}

export interface FloodRoutingResult {
  /** Peak discharge [m³/s] */
  peakDischarge: number;
  /** Wave celerity [m/s] */
  celerity: number;
  /** Water depth [m] */
  depth: number;
  /** Flow velocity [m/s] */
  velocity: number;
  /** Froude number (flow regime) */
  froudeNumber: number;
  /** Flow regime classification */
  regime: 'subcritical' | 'supercritical' | 'critical';
}

/* ═════════════════════════════════════════════════════════════════
   1. SEED-IDRISS LIQUEFACTION (NCEER 1997)
   ═════════════════════════════════════════════════════════════════ */

/**
 * Seed-Idriss simplified liquefaction assessment.
 *
 * Cyclic Stress Ratio (CSR):
 *   CSR = 0.65 · (a_max / g) · (σ_vo / σ'_vo) · r_d
 *
 * Cyclic Resistance Ratio (CRR) — based on (N1)60:
 *   For (N1)60 ≤ 30:
 *     CRR = 1 / (34 - (N1)60) + (N1)60 / 135 + ((N1)60 / 160)² - 1 / 200
 *   For (N1)60 > 30: CRR = 0.5 (non-liquefiable dense sand)
 *
 * Stress reduction coefficient:
 *   r_d = 1.0 - 0.00765·z  for z ≤ 9.15 m
 *   r_d = 1.174 - 0.0267·z  for 9.15 < z ≤ 23 m
 *   r_d = 0.744 - 0.008·z   for 23 < z ≤ 30 m
 *
 * Probability of liquefaction (Idriss 1999):
 *   P_L = 1 / (1 + exp(-(FS - 1.0) / 0.13))
 *
 * References:
 *   Seed & Idriss (1971) Simplified procedure for evaluating soil liquefaction
 *   NCEER (1997) Proceedings of the NCEER Workshop on Liquefaction
 *   Idriss & Boulanger (2008) Soil Liquefaction during Earthquakes
 */
export function computeLiquefaction(params: {
  peakGroundAccel: number;  // a_max in g (e.g., 0.3 for 0.3g)
  totalStress: number;      // σ_vo in kPa (overburden)
  effectiveStress: number;  // σ'_vo in kPa
  depth: number;            // z in meters
  sptBlowCount: number;     // (N1)60 SPT blow count
  finesContent?: number;    // FC% fines content (optional, 0-100)
}): LiquefactionResult {
  const {
    peakGroundAccel,
    totalStress,
    effectiveStress,
    depth,
    sptBlowCount,
    finesContent = 0,
  } = params;

  // Stress reduction coefficient r_d (Liao & Whitman 1986)
  let rd: number;
  if (depth <= 9.15) {
    rd = 1.0 - 0.00765 * depth;
  } else if (depth <= 23) {
    rd = 1.174 - 0.0267 * depth;
  } else {
    rd = Math.max(0.5, 0.744 - 0.008 * depth);
  }

  // Cyclic Stress Ratio
  const csr = 0.65 * peakGroundAccel * (totalStress / Math.max(1, effectiveStress)) * rd;

  // Corrected SPT blow count for fines content (Seed et al. 2003)
  const n1_60cs = sptBlowCount + Math.min(15, 0.5 * (finesContent - 5));

  // Cyclic Resistance Ratio (Seed & Idriss 1985 simplified)
  let crr: number;
  if (n1_60cs <= 30) {
    crr = 1 / (34 - n1_60cs) + n1_60cs / 135 + Math.pow(n1_60cs / 160, 2) - 1 / 200;
    crr = Math.max(0, crr);
  } else {
    crr = 0.5; // Dense sand is non-liquefiable
  }

  // Factor of Safety
  const fs = crr / Math.max(0.001, csr);

  // Probability of liquefaction (Idriss 1999 logistic model)
  const probLiquefaction = 1 / (1 + Math.exp(-(1.0 - fs) / 0.13));

  // Liquefaction Severity Index (Sonmez & Goktan 2007)
  const lsi = fs < 1 ? Math.max(0, 100 * Math.pow(1 - fs, 2.5)) : 0;

  return {
    csr: Math.round(csr * 1000) / 1000,
    crr: Math.round(crr * 1000) / 1000,
    fs: Math.round(fs * 100) / 100,
    probLiquefaction: Math.round(probLiquefaction * 1000) / 1000,
    lsi: Math.round(lsi * 10) / 10,
    triggered: fs < 1,
  };
}

/* ═════════════════════════════════════════════════════════════════
   2. GAUSSIAN PLUME ATMOSPHERIC DISPERSION (Pasquill-Gifford)
   ═════════════════════════════════════════════════════════════════ */

/**
 * Pasquill-Gifford dispersion coefficients.
 * σ_y and σ_z as functions of downwind distance x [km].
 * Form: σ = a · x^b (power law fit, EPA AERMOD reference)
 *
 * Stability classes:
 *   A = Very unstable (strong insolation, light wind)
 *   B = Moderately unstable
 *   C = Slightly unstable
 *   D = Neutral
 *   E = Slightly stable
 *   F = Moderately stable
 */
const P_G_COEFFICIENTS: Record<string, { ay: number; by: number; az: number; bz: number }> = {
  A: { ay: 0.3658, by: 0.9031, az: 0.192, bz: 1.202 },
  B: { ay: 0.2751, by: 0.9031, az: 0.156, bz: 1.068 },
  C: { ay: 0.2090, by: 0.9031, az: 0.116, bz: 0.920 },
  D: { ay: 0.1471, by: 0.9031, az: 0.079, bz: 0.780 },
  E: { ay: 0.1046, by: 0.9031, az: 0.063, bz: 0.660 },
  F: { ay: 0.0723, by: 0.9031, az: 0.054, bz: 0.540 },
};

/**
 * Estimate Pasquill-Gifford stability class from meteorological conditions.
 * Based on Turner (1970) nomogram simplified rules.
 */
function estimateStabilityClass(
  windSpeed: number,      // m/s
  solarRadiation: number, // W/m² (0 = night, >600 = strong sun)
  cloudCover: number,     // 0-10 oktas
): string {
  const isDaytime = solarRadiation > 0;
  const strongInsolation = solarRadiation > 500;
  const moderateInsolation = solarRadiation > 200;

  if (isDaytime) {
    if (windSpeed < 2) return strongInsolation ? 'A' : 'B';
    if (windSpeed < 3) return strongInsolation ? 'B' : 'C';
    if (windSpeed < 5) return moderateInsolation ? 'C' : 'D';
    return 'D';
  } else {
    // Nighttime
    const isCloudy = cloudCover > 6;
    if (windSpeed < 2) return isCloudy ? 'E' : 'F';
    if (windSpeed < 3) return 'E';
    return 'D';
  }
}

/**
 * Gaussian Plume ground-level concentration.
 *
 * C(x,y,0) = Q / (2π·u·σ_y·σ_z) · exp(-y²/(2σ_y²)) · [exp(-(H)²/(2σ_z²)) + exp(-(H)²/(2σ_z²))]
 *
 * For ground-level receptors (z=0) with effective stack height H:
 *   C(x,y,0) = Q / (π·u·σ_y·σ_z) · exp(-y²/(2σ_y²)) · exp(-H²/(2σ_z²))
 *
 * References:
 *   Pasquill (1976) Atmospheric Diffusion
 *   Gifford (1976) Turbulent Diffusion in the Atmosphere
 *   EPA AERMOD technical documentation
 */
export function computeDispersion(params: {
  emissionRate: number;       // Q in μg/s (source strength)
  windSpeed: number;          // u in m/s (at effective stack height)
  windDirection: number;      // degrees (meteorological, from)
  stackHeight: number;        // physical stack height [m]
  plumeRise: number;          // buoyant plume rise [m]
  downwindDist: number;       // x in meters
  crosswindDist: number;      // y in meters
  solarRadiation: number;     // W/m²
  cloudCover: number;         // 0-10 oktas
}): DispersionResult {
  const {
    emissionRate, windSpeed, windDirection: _windDir,
    stackHeight, plumeRise,
    downwindDist: xMeters, crosswindDist: yMeters,
    solarRadiation, cloudCover,
  } = params;

  // Effective height = stack height + plume rise
  const H = stackHeight + plumeRise;
  const x = xMeters / 1000; // Convert to km for P-G coefficients

  // Estimate stability class
  const stabilityClass = estimateStabilityClass(windSpeed, solarRadiation, cloudCover);
  const pg = P_G_COEFFICIENTS[stabilityClass];

  // Compute dispersion coefficients
  const sigmaY = pg.ay * Math.pow(Math.max(0.01, x), pg.by); // km
  const sigmaZ = pg.az * Math.pow(Math.max(0.01, x), pg.bz); // km

  // Convert to meters
  const sigmaYM = sigmaY * 1000;
  const sigmaZM = sigmaZ * 1000;

  // Guard against zero wind
  const u = Math.max(0.5, windSpeed);

  // Gaussian plume equation (ground-level, y=0 for centerline)
  const centerlineConc = emissionRate / (Math.PI * u * sigmaYM * sigmaZM)
    * Math.exp(-H * H / (2 * sigmaZM * sigmaZM));

  // Full equation with crosswind component
  const concentration = centerlineConc * Math.exp(-yMeters * yMeters / (2 * sigmaYM * sigmaYM));

  // Distance to maximum ground-level concentration
  // For σ_z = A_z · x^b_z, the max occurs when dC/dx = 0
  // Approximate: x_max ≈ (H / (A_z · b_z))^(1/b_z) · constant
  const xMaxMeters = Math.pow(H / (pg.az * pg.bz), 1 / pg.bz) * 1000 * 0.8;

  return {
    concentration: Math.round(concentration * 1000) / 1000,
    maxConcentration: Math.round(centerlineConc * 1000) / 1000,
    xMax: Math.round(xMaxMeters),
    effectiveHeight: H,
    stabilityClass,
  };
}

/* ═════════════════════════════════════════════════════════════════
   3. WILDFIRE SPREAD RATE (Simplified FBP/Rothermel)
   ═════════════════════════════════════════════════════════════════ */

/**
 * Simplified Fire Behavior Prediction system.
 * Uses the Canadian FBP system approach with fuel-type-specific
 * polynomial regressions derived from the full Rothermel model.
 *
 * Rate of Spread (ROS) for a standard timber fuel type:
 *   ROS = R_0 · (1 + φ_w + φ_s)
 *
 * Where:
 *   R_0  = base ROS from fuel moisture (exponential decay)
 *   φ_w  = wind contribution factor
 *   φ_s  = slope contribution factor
 *
 * Fire Intensity:
 *   I = ROS · H · w (where H = heat of combustion, w = fuel consumption)
 *
 * Flame Length (Byram 1959):
 *   L = 0.0775 · I^0.46
 *
 * Spotting Distance (Albini 1979 simplified):
 *   D = 0.0047 · w^1.1 · u^2.5 · H^{-0.8}
 *
 * References:
 *   Rothermel (1972) A mathematical model for predicting fire spread
 *   Van Wagner (1987) The Canadian Forest Fire Danger Index
 *   Byram (1959) Combustion of forest fuels
 *   Albini (1979) Spot fire dynamics
 */
export function computeWildfireSpread(params: {
  windSpeed: number;           // u in m/s
  windDirection: number;       // degrees
  slope: number;               // slope in degrees (0-45)
  fuelMoisture: number;        // live fuel moisture content % (5-300)
  deadFuelMoisture: number;    // dead fuel moisture % (1-30)
  relativeHumidity: number;    // % (0-100)
  temperature: number;         // °C
  fuelType?: string;           // 'timber' | 'grass' | 'shrub' | 'slash'
}): WildfireSpreadResult {
  const {
    windSpeed,
    slope: slopeDeg,
    fuelMoisture,
    deadFuelMoisture,
    fuelType = 'timber',
  } = params;
  // relativeHumidity and temperature available for future model refinements

  // Fuel type coefficients (simplified FBP system)
  const fuelCoeffs: Record<string, { base: number; windAlpha: number; slopeAlpha: number; intensityFactor: number }> = {
    timber: { base: 1.0, windAlpha: 0.08, slopeAlpha: 0.05, intensityFactor: 2000 },
    grass:  { base: 2.5, windAlpha: 0.12, slopeAlpha: 0.08, intensityFactor: 800 },
    shrub:  { base: 1.5, windAlpha: 0.10, slopeAlpha: 0.06, intensityFactor: 1200 },
    slash:  { base: 1.2, windAlpha: 0.09, slopeAlpha: 0.07, intensityFactor: 1500 },
  };
  const fc = fuelCoeffs[fuelType] ?? fuelCoeffs.timber;

  // Base ROS from dead fuel moisture (exponential decay)
  // At 5% moisture → base × 2.0, at 30% → base × 0.1
  const moistureFactor = fc.base * Math.exp(-0.08 * (deadFuelMoisture - 5));

  // Wind factor: φ_w = windSpeed^α_w (Van Wagner 1987)
  const phiWind = fc.windAlpha * Math.pow(Math.max(0, windSpeed), 1.5);

  // Slope factor: φ_s = tan(slope) (Rothermel 1972)
  const phiSlope = fc.slopeAlpha * Math.tan(slopeDeg * Math.PI / 180);

  // Rate of Spread [m/min]
  const ros = Math.max(0.1, moistureFactor * (1 + phiWind + phiSlope));

  // Fireline intensity [kW/m] (Byram 1959)
  // I = ROS × H × w, where H ≈ 18000 kJ/kg, w ≈ fuel consumed
  const fuelConsumption = Math.max(0.5, 3.0 - 0.03 * fuelMoisture); // kg/m²
  const intensity = ros * fc.intensityFactor * fuelConsumption / 60; // convert to kW/m

  // Flame length [m] (Byram 1959: L = 0.0775 × I^0.46)
  const flameLength = 0.0775 * Math.pow(Math.max(1, intensity), 0.46);

  // Spotting distance [m] (Albini 1979 simplified)
  // D ∝ w^1.1 × u^2.5 × H^{-0.8}
  const spottingDistance = 0.0047 * Math.pow(fuelConsumption, 1.1)
    * Math.pow(Math.max(0, windSpeed), 2.5)
    * Math.pow(Math.max(100, fc.intensityFactor), -0.8)
    * 1000;

  // Fire danger level
  let dangerLevel: WildfireSpreadResult['dangerLevel'];
  if (ros < 2) dangerLevel = 'low';
  else if (ros < 10) dangerLevel = 'moderate';
  else if (ros < 30) dangerLevel = 'high';
  else dangerLevel = 'extreme';

  return {
    ros: Math.round(ros * 100) / 100,
    intensity: Math.round(intensity),
    flameLength: Math.round(flameLength * 100) / 100,
    spottingDistance: Math.round(spottingDistance),
    dangerLevel,
  };
}

/* ═════════════════════════════════════════════════════════════════
   4. KINEMATIC WAVE FLOOD ROUTING (Manning's Equation)
   ═════════════════════════════════════════════════════════════════ */

/**
 * 1D kinematic wave flood routing using Manning's equation.
 *
 * Manning's equation for uniform flow:
 *   Q = (1/n) · A · R^{2/3} · S^{1/2}
 *
 * Where:
 *   Q = discharge [m³/s]
 *   n = Manning's roughness coefficient
 *   A = cross-sectional area [m²]
 *   R = hydraulic radius = A / P [m]
 *   P = wetted perimeter [m]
 *   S = channel slope [m/m]
 *
 * For a rectangular channel of width B and depth y:
 *   A = B · y
 *   P = B + 2y
 *   R = By / (B + 2y)
 *
 * Wave celerity (kinematic wave):
 *   c = dQ/dA = (5/3) · Q / A  (for Manning's with constant n, S)
 *
 * Froude number:
 *   Fr = v / √(g·D_h)  where D_h = A/T (hydraulic depth, T = top width)
 *
 * References:
 *   Chow (1959) Open-Channel Hydraulics
 *   Manning (1891) On the flow of water in open channels
 *   Ponce (1989) Engineering Hydrology
 */
export function computeFloodRouting(params: {
  discharge: number;          // Q in m³/s (upstream discharge)
  channelWidth: number;       // B in meters (channel bottom width)
  channelSlope: number;       // S in m/m (typically 0.001-0.01)
  manningRoughness: number;   // n (0.03 for natural channel, 0.013 for concrete)
  channelLength?: number;     // routing reach length in km (default 5)
}): FloodRoutingResult {
  const {
    discharge: Q,
    channelWidth: B,
    channelSlope: S,
    manningRoughness: n,
    channelLength: Lkm = 5,
  } = params;

  const g = 9.81; // gravitational acceleration [m/s²]

  // Solve for normal depth y using Manning's equation iteratively
  // Q = (1/n) · By · (By/(B+2y))^{2/3} · S^{1/2}
  let y = 0.5; // initial guess [m]
  for (let iter = 0; iter < 20; iter++) {
    const A = B * y;
    const P = B + 2 * y;
    const R = A / Math.max(0.01, P);
    const Qcalc = (1 / n) * A * Math.pow(R, 2 / 3) * Math.sqrt(S);
    const dQdy = (1 / n) * B * Math.pow(R, 2 / 3) * Math.sqrt(S)
      + (1 / n) * A * (2 / 3) * Math.pow(R, -1 / 3) * (B * P - A * 2) / (P * P) * Math.sqrt(S);
    const correction = (Qcalc - Q) / Math.max(0.001, dQdy);
    y = Math.max(0.01, y - correction);
    if (Math.abs(correction) < 0.0001) break;
  }

  const A = B * y;
  const velocity = A > 0 ? Q / A : 0;
  const celerity = A > 0 ? (5 / 3) * velocity : 0;

  // Froude number
  const hydraulicDepth = A / Math.max(0.01, B);
  const froudeNumber = velocity / Math.sqrt(g * Math.max(0.01, hydraulicDepth));

  // Flow regime
  let regime: FloodRoutingResult['regime'];
  if (froudeNumber < 0.95) regime = 'subcritical';
  else if (froudeNumber > 1.05) regime = 'supercritical';
  else regime = 'critical';

  // Travel time for routing reach
  const _travelTimeHours = celerity > 0 ? (Lkm * 1000) / (celerity * 3600) : 0;

  return {
    peakDischarge: Math.round(Q * 100) / 100,
    celerity: Math.round(celerity * 100) / 100,
    depth: Math.round(y * 100) / 100,
    velocity: Math.round(velocity * 100) / 100,
    froudeNumber: Math.round(froudeNumber * 1000) / 1000,
    regime,
  };
}

/* ═════════════════════════════════════════════════════════════════
   UNIFIED RISK COMPOSITOR
   Combines all surrogate outputs into a unified risk probability.
   ═════════════════════════════════════════════════════════════════ */

/**
 * Compute composite risk from multiple physics surrogate results.
 * Uses a weighted Bayesian combination:
 *   P(risk) = Σ(w_i · P_i) / Σ(w_i)
 *
 * Where w_i = confidence weight for each hazard type.
 */
export function computeCompositeRisk(params: {
  liquefaction?: LiquefactionResult;
  dispersion?: DispersionResult;
  wildfire?: WildfireSpreadResult;
  flood?: FloodRoutingResult;
  weights?: Record<string, number>;
}): { risk: number; breakdown: Record<string, number> } {
  const defaultWeights = {
    liquefaction: 1.0,
    dispersion: 0.8,
    wildfire: 1.0,
    flood: 1.0,
  };
  const w = { ...defaultWeights, ...params.weights };

  const breakdown: Record<string, number> = {};
  let totalWeight = 0;
  let weightedSum = 0;

  if (params.liquefaction) {
    const p = params.liquefaction.probLiquefaction;
    const conf = 1 - params.liquefaction.fs / 2; // higher weight when FS < 1
    breakdown.liquefaction = p;
    weightedSum += w.liquefaction * conf * p;
    totalWeight += w.liquefaction * conf;
  }

  if (params.dispersion) {
    // Normalize concentration to [0,1] using log scale (10 μg/m³ = 0.1, 1000 = 1.0)
    const p = Math.min(1, Math.max(0, (Math.log10(Math.max(1, params.dispersion.concentration)) - 1) / 3));
    breakdown.dispersion = p;
    weightedSum += w.dispersion * p;
    totalWeight += w.dispersion;
  }

  if (params.wildfire) {
    const pMap = { low: 0.1, moderate: 0.35, high: 0.7, extreme: 0.95 };
    const p = pMap[params.wildfire.dangerLevel] ?? 0.5;
    breakdown.wildfire = p;
    weightedSum += w.wildfire * p;
    totalWeight += w.wildfire;
  }

  if (params.flood) {
    // Risk based on Froude number and velocity
    const p = Math.min(1, params.flood.velocity / 5 + params.flood.froudeNumber / 3);
    breakdown.flood = p;
    weightedSum += w.flood * p;
    totalWeight += w.flood;
  }

  const risk = totalWeight > 0 ? weightedSum / totalWeight : 0;

  return {
    risk: Math.round(risk * 1000) / 1000,
    breakdown,
  };
}
