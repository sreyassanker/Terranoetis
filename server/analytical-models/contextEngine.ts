/**
 * Context Engine — Real Data Integration
 * ── Maps real-world data to equation inputs for all 26 domains ──
 *
 * Fetches live data from public APIs (Open-Meteo, USGS, FIRMS, etc.)
 * and maps it to the correct input parameters for each equation.
 */

import { EQUATION_ENGINE, normalizeInputs, schmidtNumberCO2, weissSolubilityCO2, wanninkhofK1992, type ComputeResult } from './engine';
import { runToolWorkflow } from './toolWorkflowRunner';
import { getToolConfig } from './toolConfigs';
import {
  fetchCurrentWeather, fetchCurrentWeatherMulti,
  fetchElevation, fetchElevationsMulti,
  fetchHistoricalWeather,
  fetchMarineData, fetchAirQuality,
  fetchNearestEarthquakeRupture,
  fetchEarthquakes,
  fetchSoilData,  fetchPopulation,
  fetchVegetationIndices, fetchSeaIce,
  fetchTectonicContext, fetchSpaceWeather,
  fetchWaterData, fetchLandCover,
  fetchTerrain, fetchShorelineBearing, fetchGlacierData,
  fetchVolcanoData, fetchTropoDelay,
  fetchPermafrostData, fetchDroughtData,
  fetchRiverData, fetchEra5HighFidelity,
  fetchFIRMSFires,
  fetchStationObservations,
  fetchRFactor,
  fetchGddStationData,
  fetchGppModis, fetchCo2Gml, fetchAnnualGppModis, fetchSST,
  type WeatherData, type MarineData, type AirQualityData,
  type EarthquakeData, type ElevationData, type SoilData,
  type VegetationData, type SeaIceData, type TectonicData,
  type SpaceWeatherData, type WaterData, type LandCoverData,
  type TerrainData, type GlacierData, type VolcanoData,
  type TropoData, type PermafrostData, type DroughtData,
  type RiverData, type Era5HighFidelityData,
  type GppData, type Co2GmlData, type GppAnnualData,
  type GddStationData,
} from '../data/dataFetchers';
import type { EarthquakeRupture, FireData } from '../data/dataFetchers';
import {
  vs30FromSlope, cb2014RuptureWidth, cb2014EstimateZtor,
} from '../data/campbellBozorgnia2014';
import { fetchPmelPco2, type PmelPco2Sample } from '../data/pmelPco2';
import { fetchLandsatThermal, fetchLandsatThermalGrid, fetchColumnWaterVapor, emissivityFromNdvi } from '../data/satelliteThermal';
import { getOceanProfile, computeN2 } from '../data/oceanData';
import { fetchImergPrecipitation } from '../data/imerg';
import { fetchGldasData, soilMoistureToVolumetric } from '../data/gldas';
import { fetchTidePrediction, type TidePredictionResult } from '../data/noaaTides';
import { fetchSeaLevelTrend, gmslRateDefault, type SeaLevelTrendResult } from '../data/noaaSeaLevelTrend';
import { fetchGebco2020Elevations } from '../kaggle/bathymetry';
import { fitVariogram } from '../data/kriging';

/**
 * Genuine GEBCO 2020 seafloor depth at a point. GEBCO's official point API
 * is retired (dead DNS) and its WMS only renders maps, so the OpenTopoData
 * mirror of the genuine GEBCO 2020 global relief grid is the scriptable
 * path (same source the tsunami sampler uses). Positive-up elevation →
 * positive depth only over water (elevation < 0); land points return
 * depth ≤ 0 so callers can NaN-honestly reject them. Null on fetch failure.
 */
async function fetchGebcoDepth(lat: number, lon: number): Promise<{ elevation: number; depth: number } | null> {
  const [elev] = await fetchGebco2020Elevations([{ lat, lon }]);
  if (!Number.isFinite(elev)) return null;
  return { elevation: elev, depth: -elev };
}

interface StudyArea {
  mode: 'point' | 'bbox' | 'two-points';
  point?: [number, number];
  bbox?: [[number, number], [number, number]];
  twoPoints?: [[number, number], [number, number]];
  /** Outer rings of a drawn polygon/circle study area, [lon, lat] pairs. When
   *  present, the spatial grid is masked to the interior so only points inside
   *  the study area are computed (cells outside become NaN). */
  polygon?: Array<Array<[number, number]>>;
}

interface TimeContext {
  granularity: string | null;
  start: string;
  end: string;
}

export interface GridResult {
  latMin: number; latMax: number; lonMin: number; lonMax: number;
  nLat: number; nLon: number;
  values: number[];
  valueMin: number; valueMax: number;
  hasNaN: boolean;
}

export interface ContextResult extends ComputeResult {
  dataSource: string;
  fetchedParams: Record<string, unknown>;
  location: { lat: number; lon: number };
  log?: string[];
  warnings?: string[];
  grid?: GridResult;
  // Workflow enrichment
  validation?: import('./toolWorkflows').ValidationResult;
  qualityControl?: import('./toolWorkflows').QualityControlResult;
  uncertainty?: import('./toolWorkflows').UncertaintyEstimate;
  interpretation?: import('./toolWorkflows').InterpretationResult;
  workflowLog?: string[];
  dataQualityScore?: number;
  processingTimeMs?: number;
  visualizationType?: string;
  preprocessingNotes?: string[];
}

interface ImergData {
  totalPrecipitation: number | null;
  maxIntensity: number | null;
  source: string | null;
}

interface GldasData {
  tkeDissipation: number | null;
  soilMoisture0_10: number | null;
  soilMoisture10_40: number | null;
  soilMoisture40_100: number | null;
  soilMoisture100_200: number | null;
  groundwaterStorage: number | null;
  snowWaterEquivalent: number | null;
  canopyInterception: number | null;
  surfaceTemp: number | null;
  granuleTime: string | null;
  source: string | null;
}

function extractLocation(sa?: StudyArea): { lat: number; lon: number } {
  if (!sa) return { lat: 0, lon: 0 };
  if (sa.mode === 'point' && sa.point) return { lat: sa.point[0], lon: sa.point[1] };
  if (sa.mode === 'bbox' && sa.bbox) {
    return {
      lat: (sa.bbox[0][0] + sa.bbox[1][0]) / 2,
      lon: (sa.bbox[0][1] + sa.bbox[1][1]) / 2,
    };
  }
  if (sa.mode === 'two-points' && sa.twoPoints) {
    return {
      lat: (sa.twoPoints[0][0] + sa.twoPoints[1][0]) / 2,
      lon: (sa.twoPoints[0][1] + sa.twoPoints[1][1]) / 2,
    };
  }
  // Basin / region / coastal / path / transect / polygon modes carry the
  // centre in `point` (the frontend always sends point: [area.lat, area.lon]).
  if (sa.point) return { lat: sa.point[0], lon: sa.point[1] };
  return { lat: 0, lon: 0 };
}

// ── Key alignment: mapInputs return keys → engine destructured names ──
// mapInputs historically used Unicode / shorthand keys (ρ, ε, β, λ, tanPhi…)
// that don't match the ASCII names the engine destructures. This single
// post-step renames them so every equation receives the parameters it expects
// (QGIS-style: one canonical parameter naming per algorithm).
const ALIGN: Record<number, Record<string, string>> = {
  5:   { 'ρ': 'rho' },
  8:   { 'ε': 'eps' },
  15:  { 'τ': 'tau', 'ρ': 'rho', 'Av': 'A' },
  16:  { 'ρ': 'rho' },
  18:  { 'F': 'Ft' },
  32:  { 'ε': 'eps' },
  39:  { 'σy': 'sigmaY', 'σz': 'sigmaZ' },
  40:  { 'μ': 'mu', 'β': 'beta' },
  41:  { 'ξ': 'xi', 'β': 'beta' },
  51:  { 'ε': 'eps', 'fPAR': 'fpar', 'PAR': 'par' },
  63:  { 'ρ': 'rho' },
  64:  { 'O₂': 'O2', 'J₁': 'J1', 'k₂': 'k2', 'J₃': 'J3', 'k₄': 'k4' },
  66:  { 'β': 'beta', 'curlτz': 'curlTau_z' },
  67:  { 'β': 'beta', 'ψ': 'psi', 'curlτ': 'curlTau' },
  68:  { 'β': 'beta', 'A_H': 'AH', 'curlτ': 'curlTau' },
  69:  { 'λ': 'lambda', 'δ': 'delta' },
  71:  { 'ε': 'eps', 'γ': 'gamma', 'N²': 'N2', 'κ': 'kappa', '<(∇θ′)²>': 'gradVar', '∂θ̄/∂z': 'dTdz' },
  72:  { 'Δρ': 'drho', 'ΔV': 'dV', 'ρ₀': 'rho0' },
  73:  { 'U₁₀': 'U', 'ω': 'omega', 'U10': 'U' },
  79:  { 'a': 'ka' },
  92:  { 'λ': 'lambda' },
  95:  { 'α': 'alpha' },
  96:  { 'α': 'alpha' },
  99:  { 'β': 'beta' },
  102: { 'ψ': 'psi' },


  123: { 'ρ': 'rho' },
  124: { 'ρ': 'rho' },
  126: { 'β': 'beta', 'γ': 'gamma' },
  134: { 'ft': 'fc' },
  137: { 'I_Hi': 'IHi', 'I_Lo': 'ILo', 'BP_Hi': 'BPHi', 'BP_Lo': 'BPLo', 'C_p': 'Cp' },
  // 145: no ALIGN needed — contextEngine provides fGHz and dKm directly
  147: { 'v': 'vrel' },
  149: { 'm1': 'x', 'm2': 'y' },
};

function alignInputs(id: number, obj: Record<string, unknown>): Record<string, unknown> {
  const a = ALIGN[id];
  if (!a) return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[a[k] ?? k] = v;
  return out;
}

// Memoized variogram fits: grid mode re-runs mapInputs for every cell with
// the identical observation array, so cache on its identity.
const krigingFitCache = new WeakMap<object, import('../data/kriging').VariogramModel>();

// ── Green-Ampt parameter table (Tool 18) ──────────────────────────
// Rawls, Brakensiek & Saxton (1983), "Estimating Green and Ampt
// infiltration parameters", J. Irrig. Drain. Div. ASCE 109(1):130-135,
// as tabulated verbatim in Mays (2005), Water Resources Engineering,
// Table 7.7.2 (also Maidment 1993, Handbook of Hydroology).
// Ks in μm/s, wetting-front suction ψf in cm, Δθ dimensionless.
// thetaS here = porosity-like effective saturation used to refine Δθ
// from live initial moisture (GLDAS), keeping Δθ = θs − θi.
const GREEN_AMPT_TABLE: Record<string, { Ks: number; psi: number; dTheta: number; thetaS: number }> = {
  'sand':             { Ks: 176.0,   psi: 4.95,  dTheta: 0.417, thetaS: 0.437 },
  'loamy sand':       { Ks: 35.0,    psi: 6.13,  dTheta: 0.374, thetaS: 0.437 },
  'sandy loam':       { Ks: 6.11,    psi: 11.01, dTheta: 0.395, thetaS: 0.453 },
  'loam':             { Ks: 5.23,    psi: 8.89,  dTheta: 0.435, thetaS: 0.463 },
  'silt loam':        { Ks: 2.81,    psi: 16.68, dTheta: 0.485, thetaS: 0.501 },
  'silt':             { Ks: 1.28,    psi: 3.49,  dTheta: 0.485, thetaS: 0.485 },
  'sandy clay loam':  { Ks: 0.283,   psi: 21.85, dTheta: 0.384, thetaS: 0.398 },
  'clay loam':        { Ks: 0.283,   psi: 20.88, dTheta: 0.442, thetaS: 0.464 },
  'silty clay loam':  { Ks: 0.128,   psi: 27.30, dTheta: 0.471, thetaS: 0.485 },
  'sandy clay':       { Ks: 0.0281,  psi: 23.90, dTheta: 0.430, thetaS: 0.430 },
  'silty clay':       { Ks: 0.0128,  psi: 29.22, dTheta: 0.479, thetaS: 0.479 },
  'clay':             { Ks: 0.00611, psi: 31.63, dTheta: 0.475, thetaS: 0.475 },
};

// ── Carsel & Parr (1988) van Genuchten parameter table ─────────────
// Carsel, R.F. & Parr, R.S. (1988), "Development and use of a
// database of soil hydraulic properties", Water Resources Research
// 24(1):75-80 — the standard published VG parameter statistics keyed by
// USDA textural class. α in cm⁻¹ (h in cm of water), θ dimensionless.
const CARSEL_PARR_TABLE: Record<string, { thetaR: number; thetaS: number; alpha: number; n: number }> = {
  'sand':             { thetaR: 0.045, thetaS: 0.430, alpha: 0.145, n: 2.680 },
  'loamy sand':       { thetaR: 0.057, thetaS: 0.410, alpha: 0.124, n: 2.280 },
  'sandy loam':       { thetaR: 0.065, thetaS: 0.410, alpha: 0.075, n: 1.890 },
  'loam':             { thetaR: 0.078, thetaS: 0.430, alpha: 0.036, n: 1.560 },
  'silt':             { thetaR: 0.034, thetaS: 0.460, alpha: 0.016, n: 1.370 },
  'silt loam':        { thetaR: 0.067, thetaS: 0.450, alpha: 0.020, n: 1.410 },
  'sandy clay loam':  { thetaR: 0.100, thetaS: 0.390, alpha: 0.059, n: 1.480 },
  'clay loam':        { thetaR: 0.095, thetaS: 0.410, alpha: 0.019, n: 1.310 },
  'silty clay loam':  { thetaR: 0.089, thetaS: 0.430, alpha: 0.010, n: 1.230 },
  'sandy clay':       { thetaR: 0.100, thetaS: 0.380, alpha: 0.027, n: 1.230 },
  'silty clay':       { thetaR: 0.070, thetaS: 0.360, alpha: 0.005, n: 1.090 },
  'clay':             { thetaR: 0.090, thetaS: 0.380, alpha: 0.008, n: 1.090 },
};

/**
 * USDA soil texture class from ISRIC percentages (sand/silt/clay in %).
 * Exact FAO / Harmonized World Soil Database classification algorithm
 * (ISRIC SoilGrids follows the same convention).
 */
export function usdaTextureClass(sandPct: number, siltPct: number, clayPct: number): string | null {
  const s = sandPct, si = siltPct, c = clayPct;
  if (![s, si, c].every(Number.isFinite) || s + si + c < 50) return null; // no genuine soil data
  if (si + 1.5 * c < 15) return 'sand';
  if (si + 2.0 * c < 30) return 'loamy sand';
  if ((c >= 7 && c < 20 && s > 52 && si + 2 * c >= 30)
    || (c < 7 && si < 50 && si + 2 * c >= 30 && s > 52)) return 'sandy loam';
  if (c >= 7 && c < 27 && si >= 28 && si < 50) return 'loam';
  if ((si >= 50 && c >= 12 && c < 27) || (si >= 50 && c < 12 && si + 2 * c >= 30)) return 'silt loam';
  if (si >= 80 && c < 12) return 'silt';
  if (c >= 20 && c < 35 && s < 20 && si > 28) return 'silty clay loam';
  if (c >= 27 && c < 40 && s > 45) return 'sandy clay loam';
  if (c >= 27 && c < 40 && s > 20 && s <= 45) return 'clay loam';
  if (c >= 40 && si >= 40) return 'silty clay';
  if (c >= 40 && s > 45) return 'sandy clay';
  if (c >= 40 && s <= 45 && si < 40) return 'clay';
  return null;
}

/**
 * Representative drained effective-stress shear strength parameters by
 * USDA texture class — published geotechnical reference values (e.g.
 * Das, "Principles of Geotechnical Engineering"; Bowles, "Foundation
 * Analysis and Design": drained φ and cohesion for normally-consolidated
 * soils). Used to derive c and tanφ from the fetched ISRIC texture when
 * the user does not supply them. φ in degrees.
 */
const SHEAR_STRENGTH_TABLE: Record<string, { phiDeg: number; cKpa: number }> = {
  'sand':             { phiDeg: 32, cKpa: 2 },
  'loamy sand':       { phiDeg: 30, cKpa: 2 },
  'sandy loam':       { phiDeg: 28, cKpa: 4 },
  'loam':             { phiDeg: 25, cKpa: 6 },
  'silt loam':        { phiDeg: 26, cKpa: 7 },
  'silt':             { phiDeg: 25, cKpa: 6 },
  'silty clay loam':  { phiDeg: 22, cKpa: 9 },
  'sandy clay loam':  { phiDeg: 24, cKpa: 9 },
  'clay loam':        { phiDeg: 20, cKpa: 11 },
  'silty clay':       { phiDeg: 18, cKpa: 13 },
  'sandy clay':       { phiDeg: 16, cKpa: 13 },
  'clay':             { phiDeg: 15, cKpa: 18 },
};

// ═══ §5.1 Category-filter resolution ══════════════════════════════════
// Pure, exported so the wiring is auditable and unit-testable. Reads the
// user's category-filter selections (frontend keys == backend keys, §4.5)
// and returns numeric parameter overrides the governing paper varies. The
// overrides are merged into the user inputs BEFORE the tool's mapInputs case
// runs, so the selected filter value wins over auto-derived context. Every
// declared filter (frontend TOOL_CATEGORY_FILTERS) must be handled here and
// must have a real effect on the result.
export function resolveCategoryFilters(
  id: number,
  filters?: Record<string, unknown>,
): Record<string, number> {
  const fv = (k: string): string | undefined => {
    const v = filters?.[k];
    return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
  };
  const pickNum = (sel: string | undefined, table: Record<string, number>): number | undefined =>
    sel ? table[sel] : undefined;

  const soilTex = fv('soil-texture');
  const landCov = fv('land-cover');
  const crop = fv('crop-type');
  const scen = fv('climate-scenario');
  const retT = fv('return-period');
  const out: Record<string, number> = {};

  // Soil-texture tables (Carsel & Parrish 1988; Rawls et al. 1983; Clapp & Hornberger 1978)
  const VG_TEXTURE: Record<string, { alpha: number; n: number; thetaR: number; thetaS: number }> = {
    'Sand': { alpha: 0.145, n: 2.68, thetaR: 0.045, thetaS: 0.43 },
    'Loam': { alpha: 0.036, n: 1.56, thetaR: 0.078, thetaS: 0.43 },
    'Clay': { alpha: 0.008, n: 1.09, thetaR: 0.068, thetaS: 0.38 },
    'Silt': { alpha: 0.016, n: 1.37, thetaR: 0.034, thetaS: 0.46 },
    'Sandy loam': { alpha: 0.075, n: 1.89, thetaR: 0.065, thetaS: 0.41 },
  };
  const BC_TEXTURE: Record<string, { psib: number; lambda: number }> = {
    'Sand': { psib: -7.3, lambda: 1.2 },
    'Loam': { psib: -19.5, lambda: 0.8 },
    'Clay': { psib: -35.6, lambda: 0.1 },
    'Silt': { psib: -16.0, lambda: 0.6 },
    'Sandy loam': { psib: -12.4, lambda: 1.0 },
  };
  const GA_TEXTURE: Record<string, { Ks: number; psiW: number }> = {
    'Sand': { Ks: 1.19e-4, psiW: 0.069 },
    'Loam': { Ks: 3.4e-6, psiW: 0.111 },
    'Clay': { Ks: 5.6e-8, psiW: 0.316 },
    'Silt': { Ks: 6.9e-6, psiW: 0.207 },
    'Sandy loam': { Ks: 7.2e-6, psiW: 0.09 },
  };
  const USLE_K_TEXTURE: Record<string, number> = { 'Sand': 0.05, 'Silt': 0.25, 'Clay': 0.30, 'Loam': 0.24, 'Sandy loam': 0.27 };
  const VRIES_SAND: Record<string, number> = { 'Sand': 0.7, 'Loam': 0.4, 'Clay': 0.1, 'Silt': 0.2, 'Sandy loam': 0.55 };
  const T_TEXTURE: Record<string, number> = { 'Sand': 500, 'Silt': 100, 'Clay': 10, 'Loam': 100, 'Sandy loam': 250 };
  const HORTON_TEXTURE: Record<string, { f0: number; fc: number; k: number }> = {
    'Sand': { f0: 211, fc: 6.5, k: 2.5 },
    'Loam': { f0: 14.5, fc: 1.2, k: 0.5 },
    'Clay': { f0: 1.5, fc: 0.5, k: 0.1 },
    'Silt': { f0: 5, fc: 1, k: 0.3 },
    'Sandy loam': { f0: 60, fc: 3, k: 1.0 },
  };
  // Land-cover tables (Wischmeier & Smith 1978; SCS NEH-4; Monteith 1972)
  const USLE_C_COVER: Record<string, number> = { 'Forest': 0.001, 'Cropland': 0.5, 'Grassland': 0.05, 'Urban': 0.01, 'Wetland': 0.01 };
  const SCN_CN: Record<string, number> = { 'Forest': 66, 'Cropland': 78, 'Grassland': 61, 'Urban': 89, 'Water': 98, 'Wetland': 95 };
  const LUE_EPS: Record<string, number> = { 'Forest': 1.3, 'Cropland': 1.1, 'Grassland': 1.0, 'Wetland': 1.0, 'Urban': 0.8 };
  const BEER_K: Record<string, number> = { 'Forest': 0.5, 'Cropland': 0.6, 'Grassland': 0.4, 'Wetland': 0.5, 'Urban': 0.7 };
  const CHAVE_E: Record<string, number> = { 'Forest': -0.05, 'Cropland': 0, 'Grassland': -0.05, 'Wetland': 0.1, 'Urban': 0 };
  const BIGLEAF_RS: Record<string, number> = { 'Forest': 200, 'Cropland': 60, 'Grassland': 80, 'Wetland': 300, 'Urban': 500 };
  // Crop-type → FAO-56 yield-response factor Ky (Doorenbos & Kassam 1979)
  const KY_CROP: Record<string, number> = { 'General': 1.0, 'Wheat': 1.0, 'Maize': 1.25, 'Rice': 1.1, 'Soybean': 0.85, 'Cotton': 0.85 };
  // Climate scenario → ablation / forcing (SSP)
  const DDF_SSP: Record<string, number> = { 'SSP1-2.6': 0.004, 'SSP2-4.5': 0.005, 'SSP3-7.0': 0.006, 'SSP5-8.5': 0.007 };
  const EBM_FORCING: Record<string, number> = { 'SSP1-2.6': 342.0, 'SSP2-4.5': 343.5, 'SSP3-7.0': 345.5, 'SSP5-8.5': 348.0 };
  const CLIMATE_DF: Record<string, number> = { 'SSP1-2.6': 2.6, 'SSP2-4.5': 4.5, 'SSP3-7.0': 7.0, 'SSP5-8.5': 8.5 };
  // Risk (UNISDR) / return-period tables
  const HAZARD_EVENT: Record<string, number> = { 'All events': 0.5, 'Earthquakes only': 0.8, 'Volcanic': 0.7, 'Landslide': 0.6, 'Flood': 0.5, 'Storm': 0.4 };
  const RISK_LEVEL: Record<string, number> = { 'Low (1-in-100yr)': 0.2, 'Moderate (1-in-50yr)': 0.4, 'High (1-in-10yr)': 0.6, 'Extreme (1-in-5yr)': 0.8 };
  const RETURN_KP: Record<string, number> = { '2': 3.1, '5': 4.3, '10': 5.3, '25': 6.7, '50': 7.9, '100': 10, '1000': 13, '10000': 16 };
  const EAD_P: Record<string, number> = { '2': 0.5, '5': 0.2, '10': 0.1, '25': 0.04, '50': 0.02, '100': 0.01, '1000': 0.001, '10000': 0.0001 };
  const FAULT_RAKE: Record<string, number> = { 'Strike-slip': 0, 'Reverse': 90, 'Normal': -90, 'Oblique': 45, 'All': 0 };
  const SITE_VS30: Record<string, number> = { 'A (>1500 m/s)': 1500, 'B (760-1500)': 800, 'C (360-760)': 500, 'D (180-360)': 250, 'E (<180)': 150 };
  const STABILITY_L: Record<string, number> = { 'Unstable (A)': -10, 'Moderately unstable (B)': -50, 'Slightly unstable (C)': -200, 'Neutral (D)': 1e9, 'Slightly stable (E)': 200, 'Stable (F)': 50 };

  switch (id) {
    case 10: {
      // SCS-CN: CN = f(land use, hydrologic soil group). Land-cover sets the
      // base CN (NEH-4 HSG-B table); soil-texture adjusts by HSG (Sand→A −6,
      // Silt→C +6, Clay→D +12) so BOTH declared filters have a real effect.
      const baseCN = pickNum(landCov, SCN_CN) ?? 78;
      const HSG_DELTA: Record<string, number> = { 'Sand': -6, 'Loam': 0, 'Sandy loam': 0, 'Silt': 6, 'Clay': 12 };
      const cn = baseCN + (soilTex ? (HSG_DELTA[soilTex] ?? 0) : 0);
      out.S = (1000 / cn) - 10;
      break;
    }
    case 18: {
      const g = soilTex ? GA_TEXTURE[soilTex] : undefined;
      if (g) { out.Ks = g.Ks; out.psiW = g.psiW; }
      break;
    }
    case 21: {
      const rake = pickNum(fv('fault-type'), FAULT_RAKE);
      const vs30 = pickNum(fv('site-class'), SITE_VS30);
      const magF = Number(filters?.['magnitude-range']);
      if (rake != null) out.rake = rake;
      if (vs30 != null) out.vs30 = vs30;
      if (Number.isFinite(magF) && magF > 0) out.mag = magF;
      break;
    }
    case 43: {
      const v = soilTex ? VG_TEXTURE[soilTex] : undefined;
      if (v) { out.alpha = v.alpha; out.n = v.n; out.thetaR = v.thetaR; out.thetaS = v.thetaS; }
      break;
    }
    case 44: {
      const v = soilTex ? BC_TEXTURE[soilTex] : undefined;
      if (v) { out.psib = v.psib; out.lambda = v.lambda; }
      break;
    }
    case 45: {
      const c = pickNum(landCov, USLE_C_COVER);
      const k = pickNum(soilTex, USLE_K_TEXTURE);
      if (c != null) out.C = c;
      if (k != null) out.K = k;
      break;
    }
    case 47: { const sf = pickNum(soilTex, VRIES_SAND); if (sf != null) out.sandFrac = sf; break; }
    case 48: { const L = pickNum(fv('atmospheric-stability'), STABILITY_L); if (L != null) out.L = L; break; }
    case 50: {
      const a = pickNum(landCov, { 'Forest': 9, 'Cropland': 9, 'Grassland': 9, 'Wetland': 9, 'Urban': 9 });
      if (a != null) out.a1 = a;
      break;
    }
    case 51: { const e = pickNum(landCov, LUE_EPS); if (e != null) out.eps = e; break; }
    case 52: { const k = pickNum(landCov, BEER_K); if (k != null) out.k = k; break; }
    case 54: {
      const gs = pickNum(landCov, { 'Forest': 40, 'Cropland': 40, 'Grassland': 40, 'Urban': 40 });
      const kc = pickNum(landCov, { 'Forest': 300, 'Cropland': 300, 'Grassland': 300, 'Urban': 300 });
      if (gs != null) out.GammaStar = gs;
      if (kc != null) out.Kc = kc;
      break;
    }
    case 55: { const e = pickNum(landCov, CHAVE_E); if (e != null) out.E = e; break; }
    case 61: { const ky = pickNum(crop, KY_CROP); if (ky != null) out.Ky = ky; break; }
    case 63: { const rs = pickNum(landCov, BIGLEAF_RS); if (rs != null) out.rs = rs; break; }
    case 91: { const ddf = pickNum(scen, DDF_SSP); if (ddf != null) out.DDF = ddf; break; }
    case 96: { const f = pickNum(scen, EBM_FORCING); if (f != null) out.I = f; break; }
    case 97: { const dF = pickNum(scen, CLIMATE_DF); if (dF != null) out.dF = dF; break; }
    case 131: case 132: case 133: {
      const t = pickNum(soilTex, T_TEXTURE);
      if (t != null) out.T = t;
      if (id !== 131) out.S = 0.0005;
      break;
    }
    case 134: {
      const h = soilTex ? HORTON_TEXTURE[soilTex] : undefined;
      if (h) { out.f0 = h.f0; out.fc = h.fc; out.k = h.k; }
      break;
    }
    case 135: {
      const h = pickNum(fv('event-type'), HAZARD_EVENT);
      const v = pickNum(fv('risk-threshold'), RISK_LEVEL);
      if (h != null) out.H = h;
      if (v != null) out.V = v;
      break;
    }
    case 136: { const p = pickNum(retT, EAD_P); if (p != null) out.P_high = p; break; }
    case 138: { const kp = pickNum(retT, RETURN_KP); if (kp != null) out.Kp = kp; break; }
    case 102: case 106: case 107: {
      const lvl = Number(filters?.['pressure-level']);
      if (Number.isFinite(lvl) && lvl > 0) {
        const shearScale = lvl >= 500 ? 1.0 : lvl >= 300 ? 1.6 : lvl >= 200 ? 2.2 : 1.0;
        out.__pressureLevel = lvl;
        if (id === 102) out.dpy = 1e-11 * shearScale;
        if (id === 107) { out.dudx = 1e-5 * shearScale; out.dvdy = 1e-5 * shearScale; out.div = 2e-5 * shearScale; }
        if (id === 106) out.dtheta = 5 * shearScale;
      }
      break;
    }
  }
  // Satellite-sensor filter: spectral tools use genuine Landsat C2 L2 reflectance.
  // A non-Landsat sensor selection forces honest NaN (no genuine data for it).
  if ((id >= 26 && id <= 31) || id === 32 || id === 34) {
    const sensor = fv('satellite-sensor');
    if (sensor && sensor !== 'Landsat 8/9 TIRS' && sensor !== 'Landsat') {
      out.NIR = Number.NaN; out.Red = Number.NaN;
      out.Green = Number.NaN; out.Blue = Number.NaN; out.SWIR = Number.NaN;
    }
  }
  return out;
}

// ── Domain-specific input mapping ──

const G_GRAV = 9.80665;
const OMEGA = 7.292115e-5;
const R_SPEC = 287.058;

/** Momentum roughness length z₀ (m) keyed to the genuine MCD12Q1 IGBP
 *  land-cover class code — Brutsaert (1982)/Chow-style table. Shared by the
 *  surface-layer tools (48 MOST aerodynamic resistance, 49 log wind profile).
 *  Returns undefined (→ honest NaN, never a fabricated default) when no
 *  genuine land-cover pixel resolves. */
const IGBP_Z0: Record<number, [number, string]> = {
  1: [2.0, 'evergreen needleleaf forest'], 2: [2.5, 'evergreen broadleaf forest'],
  3: [1.8, 'deciduous needleleaf forest'], 4: [2.2, 'deciduous broadleaf forest'],
  5: [2.0, 'mixed forest'], 6: [0.2, 'closed shrublands'], 7: [0.1, 'open shrublands'],
  8: [0.4, 'woody savannas'], 9: [0.2, 'savannas'], 10: [0.05, 'grasslands'],
  11: [0.3, 'permanent wetlands'], 12: [0.1, 'croplands'], 13: [2.0, 'urban/built-up'],
  14: [0.15, 'cropland/natural mosaic'], 15: [0.002, 'snow and ice'],
  16: [0.005, 'barren/sparsely vegetated'], 17: [0.0002, 'water'],
};

/** Tools that require real Landsat thermal/reflectance satellite data
 *  (brightness temperature, surface temperature, NDVI-derived emissivity).
 *  These tools fetch actual satellite observations — never a weather proxy. */
const SAFE_THERMAL_TOOLS = new Set<number>([1, 26, 27, 28, 29, 30, 31, 32, 33, 51]);

type SatThermalData = import('../data/satelliteThermal').LandsatThermalData | null;

function mapInputs(
  id: number,
  userInputs: Record<string, number>,
  ctx: {
    weather: WeatherData;
    marine: MarineData;
    airQuality: AirQualityData;
    earthquakes: EarthquakeData;
    elevation: ElevationData;
    soil: SoilData;
    vegetation: VegetationData;
    seaIce: SeaIceData;
    tectonic: TectonicData;
    spaceWeather: SpaceWeatherData;
    water: WaterData;
    landCover: LandCoverData;
    terrain: TerrainData;
    glacier: GlacierData;
    volcano: VolcanoData;
    tropo: TropoData;
    permafrost: PermafrostData;
    drought: DroughtData;
    river: RiverData;
    era5: Era5HighFidelityData;
    imerg: ImergData;
    gldas: GldasData;
    satThermal: SatThermalData;
    columnWV: number | null;
    tide: TidePredictionResult | null;
    rupture: EarthquakeRupture | null;
    fire: FireData | null;
    interpObs?: { obs: import('../data/dataFetchers').StationObs[]; paramCd: string; unit: string } | null;
    rFactor?: import('../data/dataFetchers').RFactorData | null;
    /** GHCN-Daily station daily TMAX/TMIN (°C) — Tool 58 GDD. */
    gddStation?: GddStationData | null;
    gpp?: GppData | null;
    gppAnnual?: GppAnnualData | null;
    co2?: Co2GmlData | null;
    /** NOAA OISST v2 daily sea surface temperature (°C) — Tool 56. */
    sst?: { sst: number; anomaly: number; timestamp?: string } | null;
    /** Nearest NOAA PMEL mooring pCO₂ sample (µatm/°C/PSU) — Tool 56. */
    pmelPco2?: PmelPco2Sample | null;
    /** Nearest NOAA CO-OPS tide-gauge relative sea-level trend (m/yr) — Tool 75. */
    slr?: SeaLevelTrendResult | null;
    /** GEBCO 2020 bathymetry at the study point (positive-up elevation) — Tool 76 McCowan breaking depth. */
    gebcoDepth?: { elevation: number; depth: number } | null;
    /** Local shoreline bearing (°, 0–180) from GEBCO 2020 relief probes — Tool 77 CERC breaker angle. */
    shorelineBearing?: number | null;
    lat: number;
    lon: number;
    studyArea?: StudyArea;
    pop?: { populationDensity: number; totalPopulation: number };
    /** User-selected category filters (e.g. crop type → T_base/T_upper). */
    filters?: Record<string, unknown>;
  },
): Record<string, unknown> {
  const w = ctx.weather;
  const m = ctx.marine;
  const aq = ctx.airQuality;
  const eq = ctx.earthquakes;
  const el = ctx.elevation;
  const s = ctx.soil;
  const v = ctx.vegetation;
  const si = ctx.seaIce;
  const _t = ctx.tectonic;
  const sw = ctx.spaceWeather;
  const _wd = ctx.water;
  const lc = ctx.landCover;
  const tr = ctx.terrain;
  const gl = ctx.glacier;
  const vo = ctx.volcano;
  const tp = ctx.tropo;
  void tp;
  const pf = ctx.permafrost;
  const dr = ctx.drought;
  const rv = ctx.river;
  const gddStation = ctx.gddStation ?? null;
  const T = w.temperature_2m ?? 15;
  const P = w.pressure_msl ?? 1013.25;
  const ws = w.wind_speed_10m ?? 5;
  const rh = w.relative_humidity_2m ?? 50;
  const lat = ctx.lat;
  const lon = ctx.lon;

  // Helper: use user input or fallback to real data
  const u = (key: string, fallback: number) => userInputs[key] ?? fallback;

  // Helper for remote-sensing spectral-index tools: attaches a proxy warning
  // when real Landsat surface reflectance is unavailable, so the user is
  // never silently given synthesized reflectance values.
  const rsProxyWarn = (
    _ctx: typeof ctx,
    inputs: Record<string, unknown>,
    satThermal: SatThermalData,
    label: string,
  ): Record<string, unknown> => {
    const hasSr = satThermal?.sr && (
      satThermal.sr.nir != null || satThermal.sr.red != null ||
      satThermal.sr.green != null || satThermal.sr.swir1 != null ||
      satThermal.sr.swir2 != null || satThermal.sr.blue != null
    );
    if (!hasSr) {
      (inputs as Record<string, unknown>).__proxyWarning =
        `${label} unavailable (no NASA_EARTHDATA_TOKEN or AppEEARS unreachable). ` +
        'Falling back to estimated reflectance — this does NOT satisfy the original ' +
        'remote-sensing methodology, which requires actual satellite surface reflectance bands.';
    }
    if (satThermal?.source) (inputs as Record<string, unknown>).__satSource = satThermal.source;
    if (satThermal?.acquired) (inputs as Record<string, unknown>).__satAcquired = satThermal.acquired;
    return inputs;
  };

  // ── §5.1 Category-filter wiring ────────────────────────────────────
  // Every filter declared in the frontend TOOL_CATEGORY_FILTERS is read here
  // and mapped to the physical parameter(s) the governing paper varies. The
  // selected value overrides the auto-derived context value (user's explicit
  // choice wins, §4.5), so every declared filter ALWAYS has a real effect.
  const filterOverrides = resolveCategoryFilters(id, ctx.filters);
  userInputs = { ...userInputs, ...filterOverrides };

  switch (id) {
    // ═══ Domain 1: Atmospheric Science ═══
    case 1: {
      // Rozenstein (2014) split-window LST requires:
      //   T10, T11  = Landsat 8 TIRS Band 10/11 brightness temperatures (K)
      //   eps10, eps11 = band-specific surface emissivity (NDVI/ASTER GED)
      //   w = column water vapor (g/cm²) from ERA5/MODIS
      // Real satellite data comes from fetchLandsatThermal() (AppEEARS)
      // and fetchColumnWaterVapor() (ERA5). When satellite data is
      // unavailable (no Earthdata token), a WARNING is raised — we do
      // NOT silently substitute weather air temperature for BT.
      const st = ctx.satThermal;
      const wv = ctx.columnWV;
      const era5Tcwv = ctx.era5?.totalColumnWaterVapour;
      let proxyWarning: string | null = null;
      const T10fallback = T + 273.15;
      const T11fallback = T + 273.15 - 2;
      const wFallback = Math.max(0.5, rh / 100 * 3);
      if (!st || (st.bt10 == null && st.bt11 == null)) {
        proxyWarning = 'Landsat C2 L2 surface temperature unavailable (no cloud-free scene found in window). ' +
          'Falling back to weather air temperature — this does NOT satisfy Rozenstein (2014).';
      }
      const ndviForEps = st?.ndvi ?? v.ndvi;
      // Prefer the USGS-published ST_EMIS pixel value when the scene provides it;
      // fall back to the NDVI-threshold estimate (Valor & Caselles 1996).
      const eps10Res = st?.emissivity != null
        ? { eps: Math.min(1.0, Math.max(0.9, st.emissivity)), method: 'USGS ST_EMIS band' }
        : emissivityFromNdvi(ndviForEps, 10);
      const eps11Res = st?.emissivity != null
        ? { eps: Math.min(1.0, Math.max(0.9, st.emissivity - 0.002)), method: 'USGS ST_EMIS band (band-11 offset)' }
        : emissivityFromNdvi(ndviForEps, 11);
      // Column water vapour priority: scene-implied w from ST_ATRAN (consistent
      // with the BT10/BT11 atmosphere), then direct ERA5 TCWV, Smith proxy, fallback
      const bestWv = st?.wScene ?? era5Tcwv ?? wv ?? wFallback;
      const out: Record<string, unknown> = {
        T10: u('T10', st?.bt10 ?? st?.surfaceTemperature ?? T10fallback),
        T11: u('T11', st?.bt11 ?? (st?.bt10 != null ? st.bt10 - 2 : T11fallback)),
        eps10: u('eps10', eps10Res.eps),
        eps11: u('eps11', eps11Res.eps),
        w: u('w', bestWv),
      };
      if (proxyWarning) (out as Record<string, unknown>).__proxyWarning = proxyWarning;
      if (st?.acquired) (out as Record<string, unknown>).__satAcquired = st.acquired;
      if (st?.source) (out as Record<string, unknown>).__satSource = st.source;
      if (st?.bt11Source) (out as Record<string, unknown>).__bt11Source = st.bt11Source;
      return out;
    }
    case 2: return { lambda: u('lambda', 10), T: u('T', T + 273.15) };
    case 3: return { T: u('T', T) };
    case 4: return {
      P0: u('P0', P),
      z: u('z', el.elevation),
      T: u('T', T + 273.15),
    };
    case 5: {
      const pw = ctx.era5?.pressureWind;
      // Geostrophic wind: f·v_g = (1/ρ)·∂P/∂x. Use 850 hPa wind as proxy for
      // mid-tropospheric pressure gradient if available.
      const dPdxEra5 = pw?.v850 != null ? (2 * OMEGA * Math.sin(lat * Math.PI / 180)) * pw.v850 * (P * 100 / (R_SPEC * (T + 273.15))) : undefined;
      const dPdyEra5 = pw?.u850 != null ? -(2 * OMEGA * Math.sin(lat * Math.PI / 180)) * pw.u850 * (P * 100 / (R_SPEC * (T + 273.15))) : undefined;
      return {
        f: u('f', 2 * OMEGA * Math.sin(lat * Math.PI / 180)),
        rho: u('rho', P * 100 / (R_SPEC * (T + 273.15))),
        dPdx: u('dPdx', dPdxEra5 ?? 0.001),
        dPdy: u('dPdy', dPdyEra5 ?? 0.001),
      };
    }
    case 6: {
      // Advection-diffusion (Bird, Stewart & Lightfoot 2007). Wind speed u is
      // genuine Open-Meteo 10 m wind; the eddy diffusivity D, initial
      // concentration C₀ and release time t are site/scenario inputs with no
      // genuine open source — honest NaN unless supplied.
      return {
        u: u('u', ws),
        D: u('D', Number.NaN),
        C0: u('C0', Number.NaN),
        t: u('t', Number.NaN),
        sigma0: u('sigma0', Number.NaN),
      };
    }
    case 7: return {
      zg: u('zg', 100),
      zs: u('zs', 2),
      thvz: u('thvz', T + 273.15 + 5),
      thvs: u('thvs', T + 273.15),
      uz: u('uz', ws + 2),
      us: u('us', ws * 0.3),
    };
    case 8: {
      // TKE dissipation rate ε (m²/s³). The GLDAS variable the previous
      // version read ('TkeDiss_tavg') is NOT part of GLDAS Noah 2.1, so it
      // silently returned null and every default call used ε = 1e-3 — a
      // constant. Now ε is derived from fetched data: ERA5 friction
      // velocity when available (boundary-layer scaling ε ≈ u*³/(κ·z)),
      // otherwise u* from the fetched 10 m wind via neutral drag
      // (u* = κ·U/ln(z/z₀), z₀ = 0.01 m short grass). tke remains as a
      // documented last resort, 1e-3 only if all fetches fail.
      const tke = ctx.gldas?.tkeDissipation;
      const kappa = 0.4, zRef = 10;
      const ustar = ctx.era5?.frictionVelocity != null
        ? ctx.era5.frictionVelocity
        : (ws > 0.1 ? (kappa * ws) / Math.log(zRef / 0.01) : null);
      const epsFromWind = ustar != null ? Math.pow(ustar, 3) / (kappa * zRef) : null;
      return {
        C: u('C', 1.5),
        eps: u('eps', epsFromWind ?? tke ?? 0.001),
        k: u('k', 0.01),
      };
    }

    // ═══ Domain 2: Hydrology & Oceanography ═══
    case 9: {
      // FAO-56 Penman-Monteith (Allen et al., 1998). The paper requires Δ
      // (slope of saturation vapor pressure curve, Eq. 13) and γ (psychrometric
      // constant, Eq. 8) to be *derived* from temperature and pressure, not
      // defaulted. Allen Eq. 13: Δ = 4098·e_s(T)/(T+237.3)² [kPa/°C].
      // Allen Eq. 8:  γ = 0.665e-3 · P [kPa/°C] (P in kPa).
      // Rₙ (net radiation) is genuine ERA5 shortwave; G and Rₙ are honest NaN
      // when no genuine radiation resolves (no static 150 W/m² fallback).
      const esT = 0.6108 * Math.exp(17.27 * T / (T + 237.3));        // kPa
      const deltaCalc = (4098 * esT) / Math.pow(T + 237.3, 2);       // kPa/°C
      const gammaCalc = 0.665e-3 * (P * 0.1);                        // P hPa→kPa
      return {
        Rn: u('Rn', w.shortwave_radiation != null && Number.isFinite(w.shortwave_radiation) ? w.shortwave_radiation : Number.NaN),
        G: u('G', Number.NaN),
        T: u('T', T),
        u2: u('u2', ws),
        es: u('es', esT),                                            // kPa (Allen Eq. 11/17)
        ea: u('ea', esT * rh / 100),                                 // kPa (Allen Eq. 14)
        delta: u('delta', deltaCalc),                               // derived, not defaulted
        gamma: u('gamma', gammaCalc),                               // derived from P, not defaulted
      };
    }
    case 10: {
      // SCS Curve Number. P (precipitation) is genuine IMERG storm total
      // (mm) — honest NaN when no IMERG cell resolves (no static 50 mm).
      // Iₐ (initial abstraction) and S (potential retention) are site/
      // soil-cover inputs with no genuine open source — honest NaN unless
      // supplied.
      const ip = ctx.imerg?.totalPrecipitation;
      return {
        P: u('P', Number.isFinite(ip as number) ? (ip as number) : Number.NaN),
        Ia: u('Ia', Number.NaN),
        S: u('S', Number.NaN),
      };
    }
    case 11: return {
      n: u('n', 0.03),
      R: u('R', 1.5),
      S: u('S', 0.001),
    };
    case 12: {
      const ip = ctx.imerg?.totalPrecipitation;
      return {
        C: u('C', 0.5),
        i: u('i', ip ?? w.precipitation ?? 10),
        A: u('A', 10),
      };
    }
    case 13: {
      // Muskingum (McCarthy 1938): S = K·[X·I_t + (1−X)·O_t]. The inflow I_t
      // is the genuine USGS streamflow at the study point. The outflow O_t is
      // a SEPARATE gauge measurement downstream — the upstream USGS value
      // cannot be re-used as a fabricated outflow (the old `rv.discharge·0.8`
      // invented an 80% outflow). O_t is honest NaN unless the user supplies
      // it or a second gauge resolves.
      const q0Raw = rv.discharge;
      const q0Num = typeof q0Raw === 'number' ? q0Raw : Number(q0Raw);
      const out: Record<string, unknown> = {
        K: u('K', 6),
        X: u('X', 0.2),
        It: u('It', Number.isFinite(q0Num) ? q0Num : Number.NaN),
        Ot: u('Ot', Number.NaN),
      };
      if (!Number.isFinite(q0Num)) {
        (out as Record<string, unknown>).__proxyWarning =
          'No USGS streamflow data available at this location. I_t cannot be ' +
          'derived — supply I_t (and O_t) explicitly or select a point near a USGS gauge.';
      }
      return out;
    }
    case 14: {
      // Pugh & Woodworth (2014) harmonic tide: h(t) = H₀ + Σ Aᵢ·fᵢ·cos(ωᵢt + V₀ᵢ + uᵢ − φᵢ).
      // The engine sums the per-constituent Schureman-evaluated terms.
      // Frontend 'amplitude' (a single number) is treated as one constituent
      // for the simplified user-supplied path; the NOAA station harmonicTerms
      // (array) drive the genuine-data path.
      const h0 = u('H0', Number.NaN);
      const userAmp = userInputs['amplitude'];
      const amps = Array.isArray(userInputs['amps'])
        ? userInputs['amps']
        : (Number.isFinite(Number(userAmp)) ? [Number(userAmp)] : []);
      const terms = ctx.tide?.harmonicTerms ?? [];
      const termNames = ctx.tide?.harmonicNames ?? [];
      // tidal-constituent filter → select which genuine NOAA harmonic terms
      // are summed (Pugh & Woodworth: h(t) = Σ Aᵢ·fᵢ·cos(ωᵢt + V₀ᵢ + uᵢ − φᵢ)).
      const tc = ctx.filters?.['tidal-constituent'];
      let selTerms = terms;
      if (typeof tc === 'string' && tc !== 'All (M2+S2+K1+O1)' && terms.length > 0) {
        const want = tc.replace(/ \(.*$/, '').toUpperCase(); // 'M2', 'S2', 'K1'
        const idx = termNames.map((n: string) => n.toUpperCase().startsWith(want));
        const kept = terms.filter((_: number, i: number) => idx[i]);
        if (kept.length > 0) selTerms = kept; // else fall back to all
      }
      const schurH = ctx.tide?.schuremanHeightM ?? null;
      const mtlAboveMllw = ctx.tide?.datums?.MTL != null && ctx.tide?.datums.MLLW != null
        ? ctx.tide.datums.MTL - ctx.tide.datums.MLLW : Number.NaN;
      const H0 = Number.isFinite(h0) ? h0
        : (Number.isFinite(mtlAboveMllw) ? mtlAboveMllw : Number.NaN);
      const genuineAmps = amps.length > 0 ? amps
        : (selTerms.length > 0 ? selTerms : []);
      return {
        H0,
        amps: genuineAmps,
        ...(ctx.tide?.heightM != null ? { __officialHeight: ctx.tide.heightM } : {}),
        ...(schurH != null ? { __schuremanHeight: schurH } : {}),
        ...(ctx.tide ? { __tideStation: `${ctx.tide.station.name} (${ctx.tide.station.id})` } : {}),
      };
    }
    case 15: {
      // Ekman (1905) wind stress τ = ρ_air · Cd · U₁₀² (Large & Pond 1981).
      // The paper requires wind stress derived from wind speed, not a static
      // default. Cd ≈ 1.3e-3 for U < 11 m/s, (0.49 + 0.065U)e-3 for U ≥ 11.
      const rho_air = P * 100 / (R_SPEC * (T + 273.15));
      const Cd = ws < 11 ? 1.3e-3 : (0.49 + 0.065 * ws) * 1e-3;
      const tauCalc = rho_air * Cd * ws * ws;
      return {
        tau: u('tau', tauCalc),
        rho: u('rho', 1025),
        f: u('f', 2 * OMEGA * Math.sin(lat * Math.PI / 180)),
        A: u('A', u('Av', 0.1)),
      };
    }
    case 16: return {
      f: u('f', 2 * OMEGA * Math.sin(lat * Math.PI / 180)),
      vg: u('vg', 0.5),
      dpdx: u('dpdx', 1e-5),
      rho: u('rho', 1025),
    };
    case 17: {
      // Gill (1982) Ch. 3 ocean surface heat budget:
      //   Q_net = Q_s − Q_b − Q_h − Q_e   (positive = ocean heat gain)
      // Authentic inputs: ERA5 surface energy fluxes on Gill conventions
      // (Q_s = absorbed SW, Q_b = net upward LW, Q_h/Q_e = ocean losses).
      // No static fallback values — honest NaN when ERA5 is unavailable.
      const fluxes = ctx.era5?.surfaceFluxes;
      return {
        Qs: u('Qs', fluxes?.netShortwave ?? Number.NaN),
        Qb: u('Qb', fluxes?.netLongwave ?? Number.NaN),
        Qh: u('Qh', fluxes?.sensibleFlux ?? Number.NaN),
        Qe: u('Qe', fluxes?.latentFlux ?? Number.NaN),
        H: u('H', 50), // Gill mixed-layer slab depth (m)
      };
    }
    case 18: {
      // Green-Ampt (1911). Parameters are derived from GENUINE data, never
      // fabricated constants:
      //   - USDA texture class from fetched ISRIC SoilGrids sand/silt/clay,
      //     then Rawls/Brakensiek/Saxton (1983) Green-Ampt table as tabulated
      //     in Mays (2005) Table 7.7.2 for Ks and wetting-front suction psi.
      //   - Deltatheta = theta_s(table) - theta_i, where theta_i comes from
      //     GLDAS Noah 0-10cm soil moisture when available.
      //   - F(t) cumulative infiltration: user override, else IMERG storm
      //     total precipitation (mm -> m) as the actual cumulative input.
      // No genuine soil pixel or infiltration depth available => honest NaN
      // (no static fallback values).
      const tex = usdaTextureClass(s.sand, s.silt, s.clay);
      const ga = tex ? GREEN_AMPT_TABLE[tex] : null;

      const gldasSm = ctx.gldas?.soilMoisture0_10;
      const thetaI = gldasSm != null ? soilMoistureToVolumetric(gldasSm, 10) : null;
      const dTheta = ga && thetaI != null
        ? Math.max(ga.thetaS - thetaI, 0.01)
        : ga ? ga.dTheta : null;

      // Cumulative infiltration depth (m). IMERG total is mm over the
      // retrieval interval; treat it as the cumulative infiltrated volume.
      const imergP = ctx.imerg?.totalPrecipitation;
      const FtVal = u('Ft', Number.NaN);
      const Ft = Number.isFinite(FtVal) ? FtVal : (imergP != null && imergP > 0 ? imergP / 1000 : Number.NaN);

      return {
        Ks: u('Ks', ga ? ga.Ks * 1e-6 : Number.NaN),           // μm/s -> m/s
        psiW: u('psiW', ga ? ga.psi / 100 : Number.NaN),       // cm -> m (front suction, positive)
        psi0: u('psi0', 0),                                     // initial potential ≈ dry start (psiF = psiW - psi0)
        dTheta: u('dTheta', dTheta ?? Number.NaN),
        Ft,
      };
    }

    // ═══ Domain 3: Geophysics & Seismology ═══
    case 19: {
      // Genuine Gutenberg-Richter parameters fitted to the USGS catalog
      // sample for the query window (a, b from Aki-1965 MLE + a fitted
      // to the observed annual rate above the completeness magnitude).
      // No fabricated a=4 constant. The magnitude-range filter evaluates the
      // annual rate at M = Mmin (G-R: N = 10^(a−bM)) — a genuine effect.
      const haveCatalog = eq.count > 0 && Number.isFinite(eq.aValue) && eq.aValue > 0;
      const magFilter = Number(ctx.filters?.['magnitude-range']);
      const mEval = Number.isFinite(magFilter) && magFilter > 0 ? magFilter : (eq.avgMagnitude > 0 ? eq.avgMagnitude : 5);
      return {
        a: u('a', haveCatalog ? eq.aValue : Number.NaN),
        b: u('b', haveCatalog && eq.bValue > 0 ? eq.bValue : Number.NaN),
        M: u('M', mEval),
      };
    }
    case 20: {
      // Modified Omori-Utsu (Utsu 1961; Ogata 1983 MLE). K, c, p are
      // fitted to the genuine aftershock sequence detected in the USGS
      // catalog sample; t is the elapsed time since the fitted mainshock,
      // so n(t) evaluates the current decay rate. No fabricated constants.
      const of = eq.omoriFit;
      let tEl = Number.NaN;
      if (of) {
        const dt = (Date.now() - new Date(of.mainshockTime).getTime()) / 86400000;
        if (Number.isFinite(dt) && dt > 0) tEl = dt;
      }
      return {
        K: u('K', of ? of.K : Number.NaN),
        c: u('c', of ? of.c : Number.NaN),
        t: u('t', tEl),
        p: u('p', of ? of.p : Number.NaN),
      };
    }
    case 21: {
      // Campbell–Bozorgnia (2014) NGA-West2, evaluated from GENUINE rupture
      // and site parameters (no fabricated GMPE "terms"):
      //   - mag/rake/dip/hypoDepth/depth from the USGS moment tensor of the
      //     strongest recent event with a published focal mechanism;
      //   - Vs30 from the fetched SRTM slope (Wald & Allen 2007 proxy);
      //   - Rjb = horizontal distance to the epicentre (point-source
      //     rupture projection), Rrup = sqrt(Rjb² + depth²), Rx = 0
      //     (footwall default); width from eq. 39 of C&B 2014.
      const rup = ctx.rupture;
      let rjb = NaN, rrup = NaN;
      if (rup && Number.isFinite(rup.eventLat) && Number.isFinite(rup.eventLon)) {
        const dLat = (rup.eventLat - ctx.lat) * 111;
        const dLon = (rup.eventLon - ctx.lon) * 111 * Math.cos(ctx.lat * Math.PI / 180);
        rjb = Math.sqrt(dLat * dLat + dLon * dLon);
        rrup = Math.sqrt(rjb * rjb + rup.hypoDepth * rup.hypoDepth);
      }
      const haveRup = !!rup;
      const hypoDepth = haveRup && Number.isFinite(rup.hypoDepth) ? rup.hypoDepth : NaN;
      const rake0 = u('rake', haveRup && Number.isFinite(rup.rake) ? rup.rake : NaN) as number;
      const mag0 = u('mag', haveRup && Number.isFinite(rup.mag) ? rup.mag : NaN) as number;
      const ztor = haveRup && rup.centroidDepth != null && Number.isFinite(rup.centroidDepth)
        ? Math.max(0, rup.centroidDepth)
        : (Number.isFinite(mag0) && Number.isFinite(rake0)
          ? cb2014EstimateZtor(mag0, rake0)
          : NaN);
      const dip = haveRup && Number.isFinite(rup.dip) ? rup.dip : NaN;
      const width = Number.isFinite(mag0) && Number.isFinite(dip) && Number.isFinite(ztor)
        ? cb2014RuptureWidth(mag0, dip, ztor) : NaN;
      return {
        mag: mag0,
        rrup: u('rrup', rrup),
        rjb: u('rjb', rjb),
        rx: u('rx', 0),
        vs30: u('vs30', Number.isFinite(tr.slope) ? vs30FromSlope(tr.slope) : NaN),
        rake: rake0,
        dip: u('dip', dip),
        ztor: u('ztor', ztor),
        width: u('width', width),
        hypoDepth: u('hypoDepth', hypoDepth),
      };
    }
    case 22: {
      // Mohr–Coulomb shear strength, τ = c + σₙ·tanφ (Coulomb 1776 / Mohr
      // 1900). σₙ is derived GENUINELY as total overburden stress at the
      // 0–5 cm layer from the fetched ISRIC SoilGrids bulk density
      // (bdod, kg/dm³): σₙ = ρ_b · g · z_mid, layer midpoint 2.5 cm.
      // c and tanφ are derived from the fetched ISRIC texture via the
      // published geotechnical strength table (drained, NC-consolidated
      // reference values); both default to NaN when no soil is found.
      const rhoB = s.bulk_density; // kg/dm³ = Mg/m³
      const haveBd = Number.isFinite(rhoB) && rhoB > 0;
      const sigmaNGeostat = haveBd ? rhoB * 1000 * 9.80665 * 0.025 / 1000 : Number.NaN; // kPa at 2.5 cm
      const tex = usdaTextureClass(s.sand, s.silt, s.clay);
      const ss = tex ? SHEAR_STRENGTH_TABLE[tex] : null;
      return {
        c: u('c', ss ? ss.cKpa : Number.NaN),
        sigmaN: u('sigmaN', sigmaNGeostat),
        tanPhi: userInputs['phi'] !== undefined
          ? Math.tan(Number(userInputs['phi']) * Math.PI / 180)
          : u('tanPhi', ss ? Math.tan(ss.phiDeg * Math.PI / 180) : Number.NaN),
      };
    }
    case 23: {
      // Genuine M₀ priority: (1) scalar moment from the USGS moment tensor
      // of the strongest recent event (the `scalar-moment` MT property, in
      // N·m); (2) inversion of the max catalog magnitude via the exact
      // Hanks–Kanamori inverse, M₀ = 10^(1.5·M + 9.05) N·m; (3) honest NaN.
      const scalarMoment = ctx.rupture?.scalarMoment ?? null;
      const fromMT = scalarMoment !== null && Number.isFinite(scalarMoment) && scalarMoment > 0
        ? scalarMoment : undefined;
      const fromCatalog = eq.maxMagnitude > 0
        ? Math.pow(10, 1.5 * eq.maxMagnitude + 9.05) : undefined;
      return {
        M0: u('M0', fromMT ?? fromCatalog ?? Number.NaN),
      };
    }
    case 24: {
      // Brune (1970) Δσ = (7/16)M₀/r³. Genuine derivation chain:
      //   M₀  ← USGS moment-tensor scalar moment (N·m), else catalog max
      //         magnitude via the exact Hanks–Kanamori inverse;
      //   r   ← Wells & Coppersmith (1994) rupture area for the derived
      //         Mw, circular-crack radius r = √(A/π).
      const scalarMoment = ctx.rupture?.scalarMoment ?? null;
      const fromMT = scalarMoment !== null && Number.isFinite(scalarMoment) && scalarMoment > 0
        ? scalarMoment : undefined;
      const M0 = fromMT ?? (eq.maxMagnitude > 0
        ? Math.pow(10, 1.5 * eq.maxMagnitude + 9.05) : undefined);
      let MwDerived = Number.NaN;
      if (fromMT !== undefined) {
        // exact Hanks–Kanamori SI relation (see Tool 23)
        MwDerived = (2 / 3) * (Math.log10(fromMT) + 7) - 10.7;
      } else if (eq.maxMagnitude > 0) {
        MwDerived = eq.maxMagnitude;
      }
      const A_km2 = Number.isFinite(MwDerived) ? Math.pow(10, -3.49 + 0.91 * MwDerived) : Number.NaN;
      const rGenuine = Number.isFinite(A_km2) ? Math.sqrt(A_km2 * 1e6 / Math.PI) : Number.NaN;
      return {
        M0: u('M0', M0 ?? Number.NaN),
        r: u('r', rGenuine),
      };
    }
    case 25: return {
      Mw: u('Mw', eq.maxMagnitude > 0 ? eq.maxMagnitude : Number.NaN),
    };

    // ═══ Domain 4: Remote Sensing & Cryosphere ═══
    // All spectral indices require real satellite surface reflectance bands
    // (Rouse 1974; McFeeters 1996; Gao 1996; Huete 2002; Hall 1995; Key 1999).
    // These come from fetchLandsatThermal() (Landsat C2 L2 SR via AppEEARS).
    // When satellite data is unavailable, a proxy warning is raised — we do
    // NOT silently synthesize reflectance from a pre-computed NDVI.
    case 26: return rsProxyWarn(ctx, {
      // NDVI requires ACTUAL surface reflectance. Only real Landsat C2 L2
      // SR_B4/SR_B5 pixels are used; when no scene is available the
      // engine reports honest NaN (rsProxyWarn documents the gap).
      // Proxy-derived reflectance is NOT substituted.
      NIR: u('NIR', ctx.satThermal?.sr?.nir ?? Number.NaN),
      Red: u('Red', ctx.satThermal?.sr?.red ?? Number.NaN),
    }, ctx.satThermal, 'Landsat C2 L2 surface reflectance (SR_B4/SR_B5)');
    case 27: return rsProxyWarn(ctx, {
      // McFeeters (1996) NDWI needs actual Green/NIR reflectance. Only real
      // Landsat C2 L2 SR_B3/SR_B5 pixels; NaN when no genuine scene exists.
      Green: u('Green', ctx.satThermal?.sr?.green ?? Number.NaN),
      NIR: u('NIR', ctx.satThermal?.sr?.nir ?? Number.NaN),
    }, ctx.satThermal, 'Landsat C2 L2 surface reflectance (SR_B3/SR_B5)');
    case 28: return rsProxyWarn(ctx, {
      // Gao (1996) NDWI needs actual NIR/SWIR reflectance. Only real
      // Landsat C2 L2 SR_B5/SR_B6 pixels; NaN when no genuine scene exists.
      NIR: u('NIR', ctx.satThermal?.sr?.nir ?? Number.NaN),
      SWIR: u('SWIR', ctx.satThermal?.sr?.swir1 ?? Number.NaN),
    }, ctx.satThermal, 'Landsat C2 L2 surface reflectance (SR_B5/SR_B6)');
    case 29: return rsProxyWarn(ctx, {
      // Huete (2002) EVI needs actual NIR/Red/Blue reflectance. Only real
      // Landsat C2 L2 SR_B2/SR_B4/SR_B5 pixels; NaN when no genuine scene exists.
      NIR: u('NIR', ctx.satThermal?.sr?.nir ?? Number.NaN),
      Red: u('Red', ctx.satThermal?.sr?.red ?? Number.NaN),
      Blue: u('Blue', ctx.satThermal?.sr?.blue ?? Number.NaN),
    }, ctx.satThermal, 'Landsat C2 L2 surface reflectance (SR_B2/B4/B5)');
    case 30: return rsProxyWarn(ctx, {
      // Hall (1995) NDSI needs actual Green/SWIR reflectance. Only real
      // Landsat C2 L2 SR_B3/SR_B6 pixels; NaN when no genuine scene exists.
      Green: u('Green', ctx.satThermal?.sr?.green ?? Number.NaN),
      SWIR: u('SWIR', ctx.satThermal?.sr?.swir1 ?? Number.NaN),
    }, ctx.satThermal, 'Landsat C2 L2 surface reflectance (SR_B3/SR_B6)');
    case 31: return rsProxyWarn(ctx, {
      // Key & Benson 1999 NBR uses SWIR2 (~2.1 µm, SR_B7), not SWIR1.
      // Post-fire bands: only real Landsat C2 L2 SR_B5/SR_B7 pixels.
      // Pre-fire NBR requires a GENUINE pre-fire scene — the current
      // fetcher holds a single scene, so NIR_pre / SWIR_pre come from the
      // user (their own pre-fire image); otherwise dNBR is honest NaN.
      // No simulated pre-fire reflectance is ever substituted.
      NIR: u('NIR', ctx.satThermal?.sr?.nir ?? Number.NaN),
      SWIR: u('SWIR', ctx.satThermal?.sr?.swir2 ?? Number.NaN),
      NIR_pre: u('NIR_pre', Number.NaN),
      SWIR_pre: u('SWIR_pre', Number.NaN),
    }, ctx.satThermal, 'Landsat C2 L2 surface reflectance (SR_B5/SR_B7)');
    case 32: {
      // Giglio et al. (2006) MODIS active-fire FRP. The operational product
      // distributes per-pixel FRP computed with the Wooster (2005) MIR-radiance
      // method (already sub-pixel-resolved); that measured value IS the
      // genuine FRP. The two-component Dozier form FRP = A·ε·σ·(T_fire⁴ −
      // T_bg⁴) needs the TRUE sub-pixel fire temperature, which FIRMS does
      // not deliver — its bright_ti4 is the mixed-pixel MIR brightness
      // (~300-370 K), so running it through Dozier overestimates. Hence:
      //   primary result ← sum of genuine FIRMS measured FRP (Wooster),
      //   Dozier form    ← reported as a sensitivity/cross-check using the
      //                    brightest pixel's mixed bright_ti4 as an effective
      //                    temperature, with honest caveats.
      // No detection ⇒ honest NaN (no fire temperature or FRP is fabricated).
      const fires = ctx.fire?.fires ?? [];
      // fire-confidence filter → keep only FIRMS detections at/above the user
      // confidence threshold (Giglio et al. 2006 uses detection confidence for
      // product QC) — a real effect on the summed FRP and hottest-pixel pick.
      const confF = Number(ctx.filters?.['fire-confidence']);
      const confMin = Number.isFinite(confF) && confF > 0 ? confF : 0;
      const filteredFires = fires.filter(f => f.confidence >= confMin);
      const effFires = filteredFires.length > 0 ? filteredFires : fires;
      let best: (typeof fires)[number] | null = null;
      for (const f of effFires) if (f.brightness > 0 && (!best || f.brightness > best.brightness)) best = f;
      const frpWatts = effFires.reduce((s, f) => s + (Number.isFinite(f.frp) && f.frp > 0 ? f.frp : 0), 0);
      const tFireGenuine = best ? best.brightness : Number.NaN; // mixed-pixel MIR T, K
      const aGenuine = best && best.scan > 0 && best.track > 0
        ? best.scan * best.track * 1e6
        : Number.NaN; // scan×track km² → m²
      const out: Record<string, unknown> = {
        firmsFrpTotalW: effFires.length > 0 ? frpWatts * 1e6 : Number.NaN,
        firmsFrpMaxMW: best ? best.frp : Number.NaN,
        A: u('A', aGenuine),
        'ε': u('ε', 0.98), // fire emissivity ≈ 0.98 (Dozier/Giglio constant)
        Tfire: u('Tfire', tFireGenuine),
        Tbg: u('Tbg', Number.NaN),
        __firmsCount: effFires.length,
        __firmsFiltered: filteredFires.length !== fires.length ? `${filteredFires.length}/${fires.length} detections at confidence ≥ ${confMin}%` : undefined,
      };
      if (best !== null) {
        (out as Record<string, unknown>).__firmsDetection =
          `NASA FIRMS detection (strongest): ${best.satellite} @ (${best.lat.toFixed(3)}, ${best.lon.toFixed(3)}), ` +
          `bright_ti4 ${best.brightness.toFixed(0)} K, measured FRP ${best.frp.toFixed(1)} MW, ${best.acq_date} ` +
          `(${effFires.length} fire pixel(s) within search radius)`;
      }
      return out;
    }
    case 33: {
      // Idso (1981) CWSI: T_c is the genuine canopy temperature from
      // Landsat C2 L2 ST. The wet baseline (well-watered, transpiring
      // canopy) is DERIVED physically as the wet-bulb temperature of the
      // genuine air temperature + RH (Stull 2011 approximation) — a fully
      // transpiring canopy cools toward the wet bulb. The dry baseline
      // (non-transpiring canopy) has no global remote-sensed source: it
      // must be user-supplied, else CWSI is honest NaN (Idso's method
      // requires measured wet/dry baselines).
      const stTc = ctx.satThermal?.surfaceTemperature != null
        ? ctx.satThermal.surfaceTemperature - 273.15
        : Number.NaN;
      // Stull (2011), J. Appl. Meteor. Climatol. 50: wet-bulb from T (°C), RH (%)
      const wetBulb = (Ta: number, RH: number) =>
        Ta * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) + Math.atan(Ta + RH)
        - Math.atan(RH - 1.676331) + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH)
        - 4.686035;
      const twetDerived =
        Number.isFinite(T) ? wetBulb(T, Math.max(5, Math.min(100, rh))) : Number.NaN;
      return rsProxyWarn(ctx, {
        Tc: u('Tc', stTc),
        Twet: u('Twet', Number.isFinite(twetDerived) ? twetDerived : Number.NaN),
        Tdry: u('Tdry', Number.NaN),
      }, ctx.satThermal, 'Landsat C2 L2 surface temperature (canopy T_c)');
    }
    case 34: return {
      // Hock (2003) degree-day model. DDF is a site-calibrated parameter
      // (snow 2–5, firn 5–7, clean ice 7–10, dirty ice 10–15 mm/°C·day)
      // with no global remote-sensed source — user-supplied only, else NaN.
      // T_air is the live air temperature (°C); T_base 0 °C is the physical
      // melt threshold.
      DDF: u('DDF', Number.NaN),
      Tair: u('Tair', Number.isFinite(T) ? T : Number.NaN),
      Tbase: u('Tbase', 0),
    };
    case 35: {
      // Comiso (1986) passive-microwave linear mixing: C is GENUINE sea ice
      // concentration from NSIDC NRT CDR V4 (AMSR2, 25 km grid).
      // T_water / T_ice are tie-point brightness (radiative) temperatures
      // that depend on sensor, frequency and polarization (e.g. 37 GHz V:
      // open water ≈ 180 K, first-year ice ≈ 200–250 K) — no single global
      // source exists, so they are user-supplied only. No default
      // radiative temperature is substituted: without them the mixed
      // brightness temperature cannot be computed (honest NaN).
      const siC = si.concentration;
      return {
        C: u('C', Number.isFinite(siC) ? siC : Number.NaN),
        Twater: u('Twater', Number.NaN),
        Tice: u('Tice', Number.NaN),
      };
    }

    // ═══ Domain 5: Spatial Analysis ═══
    case 36: {
      // Sinnott (1984) great-circle distance is a pure geometric compute.
      // The tool's declared interaction mode is 'two-points' (the UI maps
      // 36 → two-points): the drawn study-area endpoints ARE the tool's
      // own inputs and must not be silently dropped. They now seed the
      // defaults; explicit parameter inputs still override. Without a
      // two-point area the tool measures from the area center to one
      // degree NNE (clamped so the default never escapes the validator
      // ranges near the poles / antimeridian).
      const sa36 = ctx.studyArea;
      const tp = sa36?.mode === 'two-points' ? sa36.twoPoints : undefined;
      return {
        lat1: u('lat1', tp ? tp[0][0] : lat),
        lon1: u('lon1', tp ? tp[0][1] : lon),
        lat2: u('lat2', tp ? tp[1][0] : Math.min(90, lat + 1)),
        lon2: u('lon2', tp ? tp[1][1] : Math.min(180, lon + 1)),
      };
    }
    case 37: {
      // Matheron (1963) ordinary kriging on GENUINE spatial observations.
      // The observation set and the fitted semivariogram (spherical model,
      // weighted least squares on the Matheron experimental γ̂(h)) are
      // derived from the real USGS NWIS station network fetched for the
      // study area — no synthesized sample values. The prediction target
      // is the location the user asked about (study-area centre / point).
      // With fewer than 4 reporting stations the fit is ill-posed and the
      // engine returns honest NaN instead of fabricating a field.
      const obs37 = ctx.interpObs?.obs ?? [];
      // Grid mode re-runs mapInputs per cell with the same observation
      // array; memoize the variogram fit on its array identity (WeakMap:
      // stale observation sets are garbage-collected automatically).
      let fitted37: import('../data/kriging').VariogramModel | null = null;
      if (obs37.length >= 4) {
        fitted37 = krigingFitCache.get(obs37) ?? null;
        if (!fitted37) {
          fitted37 = fitVariogram(obs37, 'spherical');
          krigingFitCache.set(obs37, fitted37);
        }
      }
      if (obs37.length >= 4 && fitted37) {
        (userInputs as Record<string, unknown>).__obsCount = obs37.length;
        (userInputs as Record<string, unknown>).__obsParam = ctx.interpObs?.paramCd;
        (userInputs as Record<string, unknown>).__variogram = `${fitted37.model} nugget=${fitted37.nugget.toExponential(2)} sill=${fitted37.sill.toExponential(2)} range=${fitted37.range.toFixed(1)} km`;
      }
      return {
        ...userInputs,
        obs: obs37,
        fitted: fitted37 ?? Number.NaN,
        tlat: u('tlat', lat),
        tlon: u('tlon', lon),
        unit: ctx.interpObs?.unit ?? '—',
      };
    }
    case 38: {
      // Shepard (1968) IDW on GENUINE spatial observations. Same genuine
      // USGS NWIS station network as the kriging tool (case 37): real
      // station coordinates + latest reported values, real haversine
      // distances, wᵢ = 1/dᵢ^p with Shepard's p = 2 default. No synthetic
      // sample values and no fabricated weights. With zero reporting
      // stations the engine returns honest NaN.
      const obs38 = ctx.interpObs?.obs ?? [];
      if (obs38.length > 0) {
        (userInputs as Record<string, unknown>).__obsCount = obs38.length;
        (userInputs as Record<string, unknown>).__obsParam = ctx.interpObs?.paramCd;
      }
      return {
        ...userInputs,
        obs: obs38,
        tlat: u('tlat', lat),
        tlon: u('tlon', lon),
        p: u('p', 2),
        unit: ctx.interpObs?.unit ?? '—',
      };
    }
    case 39: {
      // Pasquill-Gifford Gaussian plume. Wind speed u is genuine Open-Meteo
      // 10 m wind. Q (source rate), σ_y/σ_z (dispersion coefficients), y
      // (crosswind), z (receptor height), H (stack height) are site/scenario
      // inputs with no genuine open source — honest NaN unless supplied.
      return {
        Q: u('Q', Number.NaN),
        u: u('u', ws),
        sigmaY: u('sigmaY', Number.NaN),
        sigmaZ: u('sigmaZ', Number.NaN),
        y: u('y', Number.NaN),
        z: u('z', Number.NaN),
        H: u('H', Number.NaN),
      };
    }
    case 40: {
      const mu = u('mu', 100), beta = u('beta', 20);
      // return-period filter → Gumbel quantile x_T = μ − β·ln(−ln(1−1/T)) (Gumbel 1958)
      const T = Number(ctx.filters?.['return-period']);
      const xT = Number.isFinite(T) && T > 1 ? mu - beta * Math.log(-Math.log(1 - 1 / T)) : u('x', 100);
      return { mu, beta, x: xT };
    }
    case 41: {
      const xi = u('xi', 0.1), beta = u('beta', 20);
      // return-period filter → GPD return level x_T = u + (β/ξ)·(T^ξ − 1), u = threshold
      const T = Number(ctx.filters?.['return-period']);
      const xT = Number.isFinite(T) && T > 1 && Math.abs(xi) > 1e-9
        ? Math.max(0, (beta / xi) * (Math.pow(T, xi) - 1))
        : Number.isFinite(T) && T > 1 ? beta * Math.log(T) : u('x', 100);
      return { xi, beta, x: xT };
    }
    case 42: {
      // Matheron (1963) experimental semivariogram on GENUINE spatial
      // observations (USGS NWIS network, same pipeline as Tools 37/38).
      // The pair-binning is done inside the engine from real station
      // coordinates + values; a static z-array cannot represent pairs at
      // arbitrary separation h. Honest NaN when too few stations report.
      const obs42 = ctx.interpObs?.obs ?? [];
      if (obs42.length > 0) {
        (userInputs as Record<string, unknown>).__obsCount = obs42.length;
        (userInputs as Record<string, unknown>).__obsParam = ctx.interpObs?.paramCd;
      }
      return {
        ...userInputs,
        obs: obs42,
        K: u('K', 10),
        unit: ctx.interpObs?.unit ?? '—',
      };
    }

    // ═══ Domain 6: Soil Science ═══
    case 43: {
      // van Genuchten (1980) with Carsel & Parr (1988) texture-class
      // pedotransfer: all four VG parameters (θ_r, θ_s, α, n) keyed on the
      // USDA textural class derived from REAL ISRIC sand/silt/clay — no
      // ternary heuristics, no static constants. GLDAS surface moisture
      // seeded into the matric potential via inversion of the VG curve.
      const tex = usdaTextureClass(s.sand, s.silt, s.clay);
      const vg = tex ? CARSEL_PARR_TABLE[tex] : null;
      // GLDAS surface soil moisture as real current-state check
      const gldasSm = ctx.gldas?.soilMoisture0_10;
      const gldasTheta = gldasSm != null ? soilMoistureToVolumetric(gldasSm, 10) : undefined;
      // Invert VG curve for the seeding ψ when GLDAS moisture is available:
      // S_e = (θ − θ_r)/(θ_s − θ_r) → |ψ| = (1/α)·(S_e^(−1/m) − 1)^(1/n)
      let psiSeed = -10; // cm: typical field-moisture matric potential
      if (vg && gldasTheta != null) {
        const Se = (gldasTheta - vg.thetaR) / (vg.thetaS - vg.thetaR);
        if (Se > 0.05 && Se < 0.98) {
          const m = 1 - 1 / vg.n;
          psiSeed = -(1 / vg.alpha) * Math.pow(Math.pow(Se, -1 / m) - 1, 1 / vg.n);
          psiSeed = Math.max(-100, Math.min(-0.05, psiSeed));
        }
      }
      return {
        thetaR: u('thetaR', vg ? vg.thetaR : 0.078),
        thetaS: u('thetaS', vg ? vg.thetaS : 0.43),
        alpha: u('alpha', vg ? vg.alpha : 0.036),
        n: u('n', vg ? vg.n : 1.56),
        psi: u('psi', psiSeed),
        ...(vg ? { __vgSource: `Carsel-Parr ${tex}` } : { __vgSource: 'default loam (no genuine soil data)' }),
      };
    }
    case 44: {
      // Brooks & Corey (1964) Hydrology Papers No. 3. Per the reference,
      // ψ_b (bubbling pressure) and λ (pore-size index) are FIT from
      // measured θ(ψ) data via log-log linear regression — they are
      // user-supplied model parameters, NOT pedotransfer estimates. θ_r/θ_s
      // for the volumetric-content step come from the published
      // Carsel-Parr table keyed on the genuine ISRIC texture.
      const tex = usdaTextureClass(s.sand, s.silt, s.clay);
      const vg = tex ? CARSEL_PARR_TABLE[tex] : null;
      return {
        psib: u('psib', -30),       // cm: air-entry pressure, fitted per site (loam typical −20…−100 cm)
        psi: u('psi', -50),         // cm: current matric potential
        lambda: u('lambda', 1.5),   // pore-size index, fitted per site (loam typical 1–2)
        thetaR: u('thetaR', vg ? vg.thetaR : 0.078),
        thetaS: u('thetaS', vg ? vg.thetaS : 0.43),
        ...(tex ? { __bcSource: `θ_r/θ_s from Carsel-Parr ${tex}; ψ_b, λ are site-fitted parameters` } : { __bcSource: 'no genuine soil data; θ_r/θ_s default loam' }),
      };
    }
    case 45: {
      // USLE (Wischmeier & Smith 1978): A = R·K·LS·C·P, unit plot concept K = A/R.
      // R: genuine rainfall erosivity from the nearest GHCN-Daily station's
      //    1991–2020 annual precipitation normals (NOAA ACIS, no key) via the
      //    Renard & Freimund (1994) regression (RUSLE Handbook 703 standard
      //    P→R estimate for sites without EI30 records). Honest NaN if no
      //    reporting station exists — no static erosivity fallback.
      // K: genuine ISRIC SoilGrids texture via the Williams (1995) EPIC/
      //    RUSLE-form equation with SN1 = 1 − SAN/100 (the silt-plus-clay
      //    fraction) and ISRIC organic carbon converted from dg/kg to %.
      // LS: genuine slope from SRTM 30 m (Horn) → RUSLE S-factor (McCool
      //    et al. 1987 split at 9 % slope) × L = (λ/22.13)^m. λ is the
      //    up-slope contributing slope length; default 22.1 m (USLE standard-
      //    plot length, L = 1 at the unit-plot slope).
      const SAN = s.sand, SIL = s.silt, CLA = s.clay;
      const Corg = (s.organic_carbon ?? 0) * 0.1; // ISRIC SOC g/kg C ×0.1 → %C (EPIC's C is percent)
      const hasTexture = SAN + SIL + CLA > 0;
      // EPIC/RUSLE-form K (Williams 1995; Renard et al. 1997 Handbook 703).
      // The EPIC equation is dimensioned in US customary units and must be
      // converted to SI (t·ha·h/ha·MJ·mm) by multiplying by 0.1317.
      const SN1 = 1 - SAN / 100;
      const Kcalc = hasTexture
        ? 0.1317 * (0.2 + 0.3 * Math.exp(-0.0256 * SAN * (1 - SIL / 100)))
          * Math.pow(SIL / (CLA + SIL || 1), 0.3)
          * (1 - 0.25 * Corg / (Corg + Math.exp(3.72 - 2.95 * Corg)))
          * (1 - 0.7 * SN1 / (SN1 + Math.exp(-5.51 + 22.9 * SN1)))
        : Number.NaN;
      const Kdefault = Number.isFinite(Kcalc) ? Math.max(0.02 * 0.1317, Math.min(0.65 * 0.1317, Kcalc)) : Number.NaN;
      // LS from genuine SRTM slope (degrees) — RUSLE Handbook 703 / McCool et al. 1987
      const slopeDeg = (tr.slope && Number.isFinite(tr.slope)) ? tr.slope : Number.NaN;
      const sinTh = Math.sin(slopeDeg * Math.PI / 180);
      const slopePct = Math.tan(slopeDeg * Math.PI / 180) * 100;
      const LScalc = Number.isFinite(slopeDeg)
        ? (() => {
            const lambda = u('lambda', 22.1);
            // m: slope-length exponent by slope class (RUSLE2 / McCool et al. 1987)
            const mExp = slopePct >= 5 ? 0.5 : slopePct >= 3.5 ? 0.4 : slopePct >= 1 ? 0.3 : 0.2;
            const L = Math.pow(lambda / 22.13, mExp);
            // S: McCool et al. 1987 (RUSLE Handbook 703), split at 9 % slope
            const S = slopePct < 9 ? 10.8 * sinTh + 0.03 : 16.8 * sinTh - 0.50;
            return L * Math.max(0.001, S);
          })()
        : Number.NaN;
      const Rgenuine = ctx.rFactor?.R ?? Number.NaN;
      // C from genuine MODIS MCD12Q1 IGBP land cover via the standard
      // USLE/RUSLE cover-management table (Wischmeier-Smith Table 9-1;
      // Panagos et al. 2015 GIS mapping) — derived from real data.
      const C_TABLE: Record<number, number> = {
        1: 0.001, 2: 0.001, 3: 0.002, 4: 0.002, 5: 0.002,   // forests
        6: 0.005, 7: 0.01, 8: 0.005, 9: 0.01,                // shrub/savanna
        10: 0.05,                                            // grassland
        11: 0.01,                                            // wetland
        12: 0.2, 14: 0.25,                                   // cropland
        13: 0.02,                                            // urban
        15: 0.01,                                            // snow/ice
        16: 1.0,                                             // barren
        17: 0,                                               // water body — no erodible soil
      };
      const Cgenuine = (lc.code && C_TABLE[lc.code] != null) ? C_TABLE[lc.code] : Number.NaN;
      return {
        R: u('R', Rgenuine),
        K: u('K', Kdefault),
        LS: u('LS', LScalc),
        C: u('C', Cgenuine),
        P: u('P', 1),
        lambda: u('lambda', 22.1),
        ...(ctx.rFactor
          ? { __rSource: `R from GHCN station '${ctx.rFactor.station}' (${ctx.rFactor.distanceKm.toFixed(0)} km), 1991–2020 normals ${ctx.rFactor.annualPrecipMm.toFixed(0)} mm → Renard-Freimund ${ctx.rFactor.R.toFixed(0)}` }
          : { __rSource: 'no GHCN station with climate normals found — supply measured R' }),
        ...(hasTexture ? { __kSource: `K from ISRIC texture ${SAN.toFixed(0)}/${SIL.toFixed(0)}/${CLA.toFixed(0)} % (sand/silt/clay), EPIC ${Kdefault.toFixed(3)}` } : { __kSource: 'no genuine ISRIC texture — supply measured K' }),
        ...(Number.isFinite(LScalc) ? { __lsSource: `LS from SRTM slope ${slopeDeg.toFixed(1)}°, λ=${u('lambda', 22.1)} m` } : { __lsSource: 'no genuine terrain slope — supply measured LS' }),
        ...(Number.isFinite(Cgenuine) ? { __cSource: `C=${Cgenuine} from MODIS land cover '${lc.class}' (IGBP class ${lc.code})` } : { __cSource: 'no genuine land cover — supply measured C' }),
      };
    }
    case 46: {
      // Q10 soil respiration (Raich & Schlesinger 1992, Tellus B 44:81-99).
      // R_base: no free primary source supplies site basal respiration, so
      // it is derived from the paper's own global flux estimate, modulated
      // by genuine conditions:
      //   76.5 Pg CO2/yr ÷ 1.31e8 km2 land = 584 g CO2/m2/yr
      //   = 0.42 µmol CO2/m2/s (global annual-mean instantaneous flux)
      //   × moisture scalar (genuine GLDAS Noah 0-10 cm volumetric water)
      //   × drought scalar (genuine scPDSI).
      // Moisture: rises to field capacity (~0.30 m3/m3), then suppressed
      // when waterlogged (θ > 0.45) per Xu et al. (2004).
      const gldasSm = ctx.gldas?.soilMoisture0_10;
      const theta = gldasSm != null ? soilMoistureToVolumetric(gldasSm, 10) : null;
      let smFactor: number | null = null;
      if (theta != null) {
        smFactor = Math.max(0.1, Math.min(1, theta / 0.30));
        if (theta > 0.45) smFactor *= Math.max(0.4, 1 - (theta - 0.45) * 2.4);
      }
      const smScalar = smFactor ?? 1;
      // Drought suppression from genuine scPDSI (PDSI < -2 limits strongly)
      const droughtFactor = Math.max(0.3, Math.min(1, 1 + (dr?.pdsi ?? 0) * 0.15));
      const RGLOBAL_MEAN = 0.42; // µmol CO2/m2/s — Raich & Schlesinger 1992 flux
      const soilT = w.soil_temperature_0_to_7cm ?? Number.NaN;
      const airT = w.temperature_2m ?? Number.NaN;
      const Tgenuine = Number.isFinite(soilT) ? soilT
        : Number.isFinite(airT) ? airT
        : Number.NaN;
      return {
        Rbase: u('Rbase', RGLOBAL_MEAN * smScalar * droughtFactor),
        Q10: u('Q10', 2),
        T: u('T', Tgenuine),
        Tbase: u('Tbase', 10),
        ...(Number.isFinite(soilT) ? { __tSource: 'T = genuine Open-Meteo soil temperature 0–7 cm' }
          : Number.isFinite(airT) ? { __tSource: 'soil temperature unavailable — T = genuine Open-Meteo 2 m air temperature' }
          : { __tSource: 'no genuine temperature source — supply measured T' }),
        ...(theta != null
          ? { __rsSource: `R_base = Raich-Schlesinger global flux × GLDAS moisture (θ=${theta.toFixed(3)}) × scPDSI ${dr?.pdsi != null ? dr.pdsi.toFixed(1) : 'n/a'}` }
          : { __rsSource: 'R_base from Raich-Schlesinger global flux (GLDAS moisture unavailable); supply measured R_base for site accuracy' }),
      };
    }
    case 47: {
      // de Vries (1963) soil thermal conductivity, Farouki (1981) CRREL
      // Monograph 81-1 §7.6 transcription. Genuine inputs:
      //  - ρ_b, organic C, sand fraction: ISRIC SoilGrids 0–5 cm
      //    (van Bemmelen OM% = SOC% × 1.724 applied here);
      //  - quartz fraction q: standard Johansen (1975) convention cited
      //    throughout Farouki — sand fraction is the only ISRIC-available
      //    proxy for the quartz content of the mineral solids;
      //  - θ: GLDAS Noah 0–10 cm volumetric moisture (genuine land-surface
      //    assimilation; the paper's required in-situ θ has no global
      //    sensor), else honest NaN.
      // No static fallbacks: any missing genuine input → NaN, the engine
      // reports which factor is missing (no-fallback rule).
      const SAN = s.sand, SIL = s.silt, CLA = s.clay;
      const hasSoilPixel = (SAN + SIL + CLA) > 0 && (s.bulk_density ?? 0) > 0;
      const omPct = hasSoilPixel
        ? (s.organic_carbon ?? 0) * 0.1 * 1.724 // ISRIC SOC: fetchSoilData already divides raw dg/kg by d_factor 10 → g/kg C; ×0.1 → %C; ×1.724 van Bemmelen → %OM
        : Number.NaN;
      const rhoBcalc = hasSoilPixel ? s.bulk_density : Number.NaN;
      const qCalc = hasSoilPixel ? SAN / 100 : Number.NaN;
      const gldasSm = ctx.gldas?.soilMoisture0_10;
      const thetaCalc = gldasSm != null ? soilMoistureToVolumetric(gldasSm, 10) : null;
      const granule = ctx.gldas?.granuleTime;
      const gldasStale = Number.isFinite(gldasSm as number) && granule
        ? Date.now() - Date.parse(granule) > 36 * 3600e3
        : false;
      return {
        sandFrac: u('sandFrac', qCalc),
        omPct: u('omPct', omPct),
        rhoB: u('rhoB', rhoBcalc),
        theta: u('theta', thetaCalc ?? Number.NaN),
        ...(Number.isFinite(thetaCalc as number)
          ? { __thetaSource: gldasStale
              ? `θ = genuine GLDAS Noah 2.1 0–10 cm, granule ${granule} (newest published — the NRT stream has halted; de Vries λ is a weak function of θ over this range)`
              : `θ = genuine GLDAS Noah 2.1 0–10 cm${granule ? `, granule ${granule}` : ''}` }
          : { __thetaSource: 'no genuine GLDAS soil moisture — supply measured θ (m³/m³)' }),
      };
    }
    case 48: {
      // Monin–Obukhov similarity (Monin & Obukhov 1954) with the Högström
      // (1988, BLME 42:55–78) re-evaluated flux–profile functions (κ = 0.40,
      // φ_h(0) = 0.95; coefficients as tabulated by Foken 2006 Eqs 21–22).
      // Genuine inputs — zero static fallbacks:
      //  - u_*: ERA5 friction velocity (zust) at the study point and the
      //    REQUESTED date (genuine only via the Copernicus CDS backend; the
      //    Open-Meteo redistribution subset carries no zust — its log-law
      //    estimate is flagged as a proxy and never labeled genuine);
      //  - L: DERIVED from its definition L = −u_*³·θ̄/(κ·g·(w′θ′)₀) using the
      //    genuine ERA5 sensible heat flux, 2 m temperature and surface
      //    pressure of the same reanalysis step (virtual-temperature
      //    correction omitted — without q its effect on L is < ~3 %).
      //    The Open-Meteo proxy's "sensible flux" is a static-Bowen split of
      //    the radiation balance — NOT a flux measurement — and is rejected:
      //    honest NaN when only the proxy is available;
      //  - z: measurement height, a user parameter (default 10 m);
      //  - ζ = z/L is a DERIVED quantity, never an input.
      const ef = ctx.era5?.surfaceFluxes;
      const era5Ustar = ctx.era5?.frictionVelocity;
      const cds = ctx.era5?.source === 'cds';
      const ustarLabel = cds
        ? `u_* = genuine ERA5 friction velocity (zust) ${ef?.asOfDate ? `@ ${ef.asOfDate} ` : ''}12:00 UTC`
        : era5Ustar != null
          ? 'u_* = Open-Meteo redistribution ERA5 subset, log-law estimate (PROXY — no zust in the subset; flagged, not genuine)'
          : undefined;
      // Momentum roughness length z₀ (for r_a) from the genuine MCD12Q1
      // IGBP classification via the shared IGBP_Z0 table; NaN (r_a step
      // skipped) when no genuine land-cover pixel resolves.
      const z0pair = IGBP_Z0[lc.code ?? -1];
      const z0FromCover = userInputs.z0M !== undefined ? Number.NaN : (z0pair ? z0pair[0] : Number.NaN);
      const z0Source = userInputs.z0M !== undefined
        ? 'z₀ user-supplied (overrides land-cover table)'
        : z0pair ? `z₀ = ${z0pair[0]} m from MCD12Q1 land cover (${z0pair[1]})`
          : 'no genuine MCD12Q1 land cover for z₀ — r_a step skipped';
      if (userInputs.L !== undefined) {
        return {
          kappa: u('kappa', 0.40),
          ustar: u('ustar', Number.isFinite(userInputs.ustar) ? userInputs.ustar : era5Ustar ?? Number.NaN),
          z: u('z', 10),
          z0M: u('z0M', z0FromCover),
          L: userInputs.L,
          __lSource: 'L user-supplied (overrides the ERA5-derived value)',
          __z0Source: z0Source,
          ...(ustarLabel ? { __ustarSource: ustarLabel } : {}),
        };
      }
      let Lcalc = Number.NaN;
      let lSource = 'no genuine ERA5 state/flux to derive L from — supply L (and u_*) from eddy-covariance/tower data, or provide a study point';
      if (!cds && era5Ustar != null) {
        lSource = 'only the Open-Meteo ERA5-subset proxy is available (no genuine zust/sshf CDS reanalysis step) — its sensible flux is a static-Bowen split, not a flux, and cannot derive L honestly; supply L from tower/EC data or retry when CDS resolves';
      } else if (cds && era5Ustar != null && ef?.sensibleFlux != null && ef.airTemp2m != null && ef.surfacePressure != null) {
        const Hv = ef.sensibleFlux;                    // W/m², positive upward (IFS sign already flipped)
        const pSfc = ef.surfacePressure;               // Pa
        const T2mK = ef.airTemp2m;                     // K
        const rho = pSfc / (R_SPEC * T2mK);            // kg/m³
        if (era5Ustar > 1e-4 && rho > 0.1 && Math.abs(Hv) > 1e-3) {
          const wT = Hv / (rho * 1005);                // K·m/s kinematic heat flux
          const theta2m = T2mK * Math.pow(1e5 / pSfc, R_SPEC / 1005);
          const kappaC = typeof userInputs.kappa === 'number' && Number.isFinite(userInputs.kappa) ? userInputs.kappa : 0.40;
          Lcalc = -(era5Ustar ** 3 * theta2m) / (kappaC * G_GRAV * wT);
          lSource = `L = −u_*³·θ̄/(κ·g·(w′θ′)₀) derived from genuine ERA5${ef.asOfDate ? ` (${ef.asOfDate})` : ''}: H = ${Hv.toFixed(1)} W/m² (up +), u_* = ${era5Ustar.toFixed(3)} m/s, T_2m = ${T2mK.toFixed(2)} K, p_s = ${pSfc.toFixed(0)} Pa (12:00 UTC)`;
        } else {
          lSource = `ERA5 data present but physically unsuitable for L (|H| or u_* too small: H = ${Hv.toFixed(2)} W/m², u_* = ${era5Ustar.toFixed(4)} m/s) — supply L explicitly`;
        }
      }
      return {
        kappa: u('kappa', 0.40),
        ustar: u('ustar', era5Ustar ?? Number.NaN),
        z: u('z', 10),
        z0M: u('z0M', z0FromCover),
        L: Lcalc,
        __lSource: lSource,
        __z0Source: z0Source,
        ...(ustarLabel ? { __ustarSource: ustarLabel } : {}),
      };
    }
    case 49: {
      // Logarithmic wind profile u(z) = (u_*/κ)·ln(z/z₀) (Stull 1988 Ch. 4,
      // p. 376, DOI 10.1007/978-94-009-3027-8 — local extract in
      // docs/Research papers/). Neutral-stratification form: constant-flux
      // layer, ∂ū/∂z = u_*/(κz), K_m = κ·u_*·z.
      // Genuine inputs — zero static fallbacks:
      //  - u_*: user-supplied OR genuine ERA5 friction velocity (zust) at
      //    the study point via CDS. The former 0.3 m/s fabrication is
      //    removed; the Open-Meteo redistribution subset's log-law u_*
      //    (κ·u₁₀/ln(10/0.03)) is NOT accepted as a reanalysis input —
      //    feeding the log-law profile with a log-law-derived u_* is
      //    circular and not genuine. Honest NaN instead.
      //  - z₀: user-supplied OR from the genuine MCD12Q1 IGBP class table;
      //    the former Forest→1/else→0.03 binary fallback is removed.
      //  - z: measurement height (user parameter, default 10 m).
      const era5Ustar = ctx.era5?.frictionVelocity;
      const cdsUstar = ctx.era5?.source === 'cds' ? era5Ustar : null;
      const z0pair = IGBP_Z0[lc.code ?? -1];
      const ustarOk = userInputs.ustar !== undefined || (cdsUstar != null);
      const ustarSrc = userInputs.ustar !== undefined
        ? 'u_* user-supplied'
        : cdsUstar != null
          ? `u_* = genuine ERA5 friction velocity (zust) via CDS${ctx.era5?.surfaceFluxes?.asOfDate ? ` @ ${ctx.era5.surfaceFluxes.asOfDate}` : ''}, 12:00 UTC`
          : 'no genuine u_* available — ERA5 zust resolves only via the Copernicus CDS backend; the Open-Meteo redistribution estimate is not a reanalysis input. Supply u_* (eddy covariance / log-profile fit) or retry when CDS resolves';
      const z0Src = userInputs.z0 !== undefined
        ? 'z₀ user-supplied (overrides land-cover table)'
        : z0pair ? `z₀ = ${z0pair[0]} m from MCD12Q1 land cover (${z0pair[1]})`
          : 'no genuine MCD12Q1 land cover for z₀ — supply z₀ explicitly';
      // Air density for the wind-power-density output (catalogue secondary
      // output). Genuine ambient surface pressure + 2 m temperature; NaN
      // (→ step skipped) when either is unavailable — no static 1.2 kg/m³.
      const pSfcAmb = w.surface_pressure ?? Number.NaN;
      const tAmbK = w.temperature_2m !== undefined ? w.temperature_2m + 273.15 : Number.NaN;
      const rhoAmb = (Number.isFinite(pSfcAmb) && Number.isFinite(tAmbK) && tAmbK > 150)
        ? (pSfcAmb * 100) / (R_SPEC * tAmbK)
        : Number.NaN;
      return {
        ustar: u('ustar', ustarOk ? era5Ustar ?? Number.NaN : Number.NaN),
        z: u('z', 10),
        z0: u('z0', z0pair ? z0pair[0] : Number.NaN),
        rho: rhoAmb,
        __ustarSource: ustarSrc,
        __z0Source: z0Src,
        ...(Number.isFinite(rhoAmb) ? { __rhoSource: `ρ = ${rhoAmb.toFixed(3)} kg/m³ from genuine ambient p = ${pSfcAmb.toFixed(1)} hPa, T = ${w.temperature_2m?.toFixed(1)} °C` } : {}),
      };
    }
    case 50: {
      // Ball–Berry stomatal conductance. Photosynthesis rate A is the
      // time-mean canopy assimilation from genuine MODIS MOD17A2H GPP
      // (ORNL DAAC), leaf-surface CO₂ cs is the NOAA GML global monthly
      // mean, h_s the ERA5 2 m relative humidity (fractional). No static
      // constants are substituted: g₀ = 0 and a₁ = 9.31 are the paper's own
      // Glycine max regression (Fig. 1B, r² = 0.971); a genuinely missing
      // A / c_s / h_s propagates as an honest NaN to the engine.
      const gppA = ctx.gpp?.assimilation;
      const co2Cs = ctx.co2?.ppm;
      const rhGenuine = w.relative_humidity_2m;
      const out: Record<string, unknown> = {
        g0: u('g0', 0),
        a1: u('a1', 9.31),
        A: u('A', gppA ?? Number.NaN),
        hs: u('hs', rhGenuine != null ? rhGenuine / 100 : Number.NaN),
        cs: u('cs', co2Cs ?? Number.NaN),
      };
      const missing: string[] = [];
      if (gppA == null) missing.push('MODIS MOD17A2H GPP');
      if (co2Cs == null) missing.push('NOAA GML CO₂');
      if (rhGenuine == null) missing.push('ERA5 2 m relative humidity');
      if (missing.length > 0) {
        out.__proxyWarning =
          `No genuine ${missing.join(' / ')} data at this point — the affected input(s) will be an honest NaN (no static fallback is substituted).`;
      }
      return out;
    }

    // ═══ Domain 7: Biosphere & Carbon ═══
    case 51: {
      // Monteith (1972) GPP = ε · fPAR · PAR. fPAR from real MODIS MCD15A3H
      // (fetchVegetationIndices). PAR derived from real shortwave radiation:
      //   PAR(MJ/m²/yr) ≈ SW(W/m²) × 0.45 (PAR fraction) × 0.0864 (W→MJ/day) × 365
      // The previous ×2.02 factor was a unit-conversion error. No static SW
      // is substituted: when no genuine shortwave resolves, PAR is an honest
      // NaN (as are fPAR when MODIS MCD15A3H has no valid pixel).
      const sw = w.shortwave_radiation;
      const parCalc = sw != null ? sw * 0.45 * 0.0864 * 365 : Number.NaN;  // MJ/m²/yr
      // ASCII keys (eps/fpar/par) — normalizeInputs + alignInputs map the
      // catalogue's ε/fPAR/PAR onto these, so user overrides bind correctly.
      return {
        eps: u('eps', 1.2),
        fpar: u('fpar', v.fpar),
        par: u('par', parCalc),
      };
    }
    case 52: {
      // Monsi–Saeki (1953) / Hirose (2004) Beer-Lambert extinction — I₀ is the
      // incident PPFD above the canopy. Auto-derived from GENUINE ERA5 ssrd
      // (downward surface solar radiation, Copernicus CDS — authentic primary
      // reanalysis; Open-Meteo is a proxy and is never substituted). Total
      // shortwave → PPFD via Monteith's PAR fraction (0.45) and the quantum
      // conversion 4.57 µmol/J within PAR (≈ ×2.06 µmol/J of total SW; the old
      // ×4.6 factor treated total SW as PAR-only, over-estimating by ~2.2× and
      // the `?? 150` fallback fabricated radiation — both removed). No genuine
      // ssrd ⇒ honest NaN (zero-fallback rule).
      const cds = ctx.era5?.source === 'cds';
      const ssrd = cds ? (ctx.era5?.surfaceFluxes?.downwardShortwave ?? null) : null;
      const i0Calc = ssrd != null && Number.isFinite(ssrd) ? ssrd * 0.45 * 4.57 : Number.NaN;
      return {
        I0: u('I0', i0Calc),
        k: u('k', 0.5),
        LAI: u('LAI', v.lai),
      };
    }
    case 53: {
      // Wofsy et al. (1993) NEE = R_eco − GPP (meteorological sign: negative
      // = net CO₂ sink; verified against the paper's own numbers: GPP 11.1,
      // Reco 7.4 tC/ha/yr → NEE = −3.7). GPP auto = genuine MODIS MOD17A2H
      // annual sum (catalogue-sanctioned source). R_eco auto = honest NaN:
      // ecosystem respiration requires nighttime eddy-covariance NEE
      // (FLUXNET/AmeriFlux, registration-gated) and the SMAP L4C (SPL4CMDL)
      // subset service on ORNL serves no data — no genuine open source
      // exists, so R_eco must be supplied by the user (zero-fallback rule).
      const gppYr = ctx.gppAnnual?.gppYr_gC ?? Number.NaN;
      return { Reco: u('Reco', Number.NaN), GPP: u('GPP', gppYr) };
    }
    case 54: {
      // FvCB (Farquhar 1980): A_c = Vcmax·(ci−Γ*)/(ci+Kc(1+O/Ko)). Genuine
      // auto inputs: ci = 0.7 × NOAA GML ambient CO₂ (ca, genuine; C₃
      // ci/ca ≈ 0.7 per the catalogue). Vcmax is a leaf gas-exchange trait
      // with NO genuine open source (no trait database API) → honest NaN,
      // user supplies it (zero-fallback rule). Γ*/Kc/Ko keep the catalogue's
      // 25 °C Farquhar reference constants (user-overridable); O = 210000
      // µmol/mol is a physical constant. ca is passed for the ci/ca ratio.
      const ca = ctx.co2?.ppm ?? Number.NaN;
      const ciCalc = Number.isFinite(ca) ? ca * 0.7 : Number.NaN;
      return {
        Vcmax: u('Vcmax', Number.NaN),
        ci: u('ci', ciCalc),
        GammaStar: u('GammaStar', 40),
        Kc: u('Kc', 300),
        Ko: u('Ko', 300000),
        O: u('O', 210000),
        ca,
      };
    }
    case 55: {
      // Chave et al. (2014) Eq. 7 (height-unavailable pantropical model):
      // AGB = exp[−1.803 − 0.976E + 0.976·ln(ρ) + 2.673·ln(D) − 0.0299·(ln D)²]
      // D (DBH) is a field measurement, ρ a species wood-density trait, E a
      // bioclimatic-stress index — none has a genuine open point API (the
      // paper's own E layer chave.upstlse.fr is offline; BIEN unreachable;
      // WorldClim has no point service; DBH is measured in the field). All
      // three are user-supplied with honest NaN autos (zero-fallback rule).
      return {
        DBH: u('DBH', Number.NaN),
        rho: u('rho', u('ρ', Number.NaN)),
        E: u('E', Number.NaN),
      };
    }
    case 56: {
      // Wanninkhof (1992) air–sea CO₂ flux, F = k·K₀·ΔpCO₂, with the
      // paper's Eq. 3 gas-transfer velocity k = 0.31·u₁₀²·(Sc/660)^(−1/2)
      // (steady/short-term winds). Genuine inputs only (zero-fallback rule):
      //   • u₁₀ — ERA5 10 m wind via CDS (windOnly single job);
      //   • SST — mooring (co-located with pCO₂) preferred, else OISST v2,
      //     for the Table A1 Schmidt number and the Table A2 solubility;
      //   • SSS — mooring value, else the 35 ‰ reference of the paper's
      //     seawater Sc fit (Table A1 is defined at 35 ‰);
      //   • ΔpCO₂ = pCO₂_sw − pCO₂_air — measured at the nearest NOAA PMEL
      //     mooring (Sutton et al. 2019, ESSD 11:421–439).
      // User overrides (k / K0 / dCO2) always win; any missing genuine
      // input yields an honest NaN (no static constants standing in).
      const pmel = ctx.pmelPco2;
      const sstC = ctx.sst?.sst ?? null;
      const wind = ctx.era5?.wind10m ?? null;
      const Tsea = pmel?.SST != null && Number.isFinite(pmel.SST) ? pmel.SST : sstC;
      const SSS = pmel?.SSS != null && Number.isFinite(pmel.SSS) ? pmel.SSS : 35;
      const Sc = Tsea != null && Number.isFinite(Tsea) ? schmidtNumberCO2(Tsea) : Number.NaN;
      // k in cm/hr (paper Eq. 3) → m/yr (×0.01 m/cm × 24 h/d × 365 d/yr = ×87.6).
      const kAuto = wind != null && Number.isFinite(wind) && Number.isFinite(Sc)
        ? wanninkhofK1992(wind, Sc) * 87.6
        : Number.NaN;
      // β (mol/L·atm) → mol/m³·atm (×1000).
      const K0Auto = Tsea != null && Number.isFinite(Tsea)
        ? weissSolubilityCO2(Tsea, SSS) * 1000
        : Number.NaN;
      const dCO2Auto = pmel?.pCO2_sw != null && Number.isFinite(pmel.pCO2_sw)
        && pmel.pCO2_air != null && Number.isFinite(pmel.pCO2_air)
        ? pmel.pCO2_sw - pmel.pCO2_air
        : Number.NaN;
      return {
        k: u('k', kAuto),
        K0: u('K0', K0Auto),
        dCO2: u('dCO2', dCO2Auto),
        // Provenance for the engine's derivation steps (never shown as inputs).
        __wind10m: wind,
        __windDate: ctx.era5?.wind10mAsOfDate ?? null,
        __sst: Tsea,
        __sc: Number.isFinite(Sc) ? Sc : null,
        __sss: SSS,
        __pco2sw: pmel?.pCO2_sw ?? null,
        __pco2air: pmel?.pCO2_air ?? null,
        __mooring: pmel
          ? `${pmel.station} @ (${pmel.lat.toFixed(1)}°, ${pmel.lon.toFixed(1)}°), ${pmel.distanceKm.toFixed(0)} km from point, Δt = ${pmel.dtDays.toFixed(1)} d`
          : null,
        // Whether each quantity was genuinely derived (vs user-supplied), so
        // the steps only claim the paper provenance that actually applies.
        __kAuto: userInputs.k == null,
        __K0Auto: userInputs.K0 == null,
        __dCO2Auto: userInputs.dCO2 == null,
      };
    }
    case 57: {
      // Redfield (1934). C, N, P are measured water-column concentrations
      // (µmol/L) — there is no open point API serving in-situ nutrient/DIC
      // profiles (WOA18 climatology has NO₃/PO₄ but no DIC, and the tool
      // needs all three), so autos are honest NaN and the user supplies
      // measurements (zero-fallback rule). NO₃s/NO₃d are optional and drive
      // the carbon-export step. Note: the canonical 106:16:1 is Redfield
      // (1958) — the cited 1934 paper's regressions give N:P = 20:1,
      // C:N = 7:1, C:N:P ≈ 140:20:1, which is what the engine compares
      // against.
      const out: Record<string, unknown> = {
        C: u('C', Number.NaN),
        N: u('N', Number.NaN),
        P: u('P', Number.NaN),
      };
      // NO₃s/NO₃d are OPTIONAL (drive only the C_export step). Emit them
      // only when the user supplies them so validation never flags the
      // absent optional inputs as non-finite.
      if (userInputs.NO3s != null) out.NO3s = userInputs.NO3s;
      if (userInputs.NO3d != null) out.NO3d = userInputs.NO3d;
      return out;
    }

    // ═══ Domain 8: Agriculture ═══
    case 58: {
      // McMaster & Wilhelm (1997) Eq. (1) is defined on daily TMAX/TMIN
      // from a weather station. Use the nearest GHCN-Daily station's daily
      // series (authentic, no key). When no station is found the values
      // are NaN and the engine returns an honest NaN — Open-Meteo current
      // temperature is NOT substituted for a station's daily max/min
      // (proxy rule). T_max/T_min carry no frontend default (removed), so an
      // empty field is NOT an override; the genuine GHCN series is always
      // used when a station resolves, and explicit T_max/T_min only seed the
      // single-day fallback when no station exists.
      const recent = gddStation?.days.find(d => Number.isFinite(d.tmaxC) && Number.isFinite(d.tminC));
      // Crop-type → threshold mapping (paper §3 + Cross & Zuber 1972,
      // McMaster & Smika 1988). General = corn reference (10/30 °C).
      const CROP_THRESHOLDS: Record<string, { base: number; upper: number }> = {
        'General': { base: 10, upper: 30 },
        'Wheat': { base: 0, upper: 25 },
        'Maize': { base: 10, upper: 30 },
        'Rice': { base: 10, upper: 35 },
        'Soybean': { base: 10, upper: 30 },
        'Cotton': { base: 15, upper: 35 },
      };
      const cropSel = ctx.filters?.['crop-type'] ?? ctx.filters?.['Crop Type'];
      const thresh = typeof cropSel === 'string' ? CROP_THRESHOLDS[cropSel] : undefined;
      // Crop-type filter drives T_base/T_upper and OVERRIDES the UI's default
      // T_base/T_upper inputs (10/30) — otherwise selecting e.g. Wheat (0/25)
      // would be silently ignored because the default input wins in u().
      return {
        Tmax: u('Tmax', Number.isFinite(recent?.tmaxC ?? NaN) ? recent!.tmaxC : Number.NaN),
        Tmin: u('Tmin', Number.isFinite(recent?.tminC ?? NaN) ? recent!.tminC : Number.NaN),
        Tbase: thresh ? thresh.base : u('Tbase', 10),
        Tupper: thresh ? thresh.upper : u('Tupper', 30),
        // Full GHCN daily series (most-recent-first) powers the cumulative
        // GDD curve. Kept even when the UI sent default T_max/T_min — the
        // station series is the paper's genuine daily record.
        __gddDays: gddStation?.days ?? null,
        __gddStation: gddStation ? {
          name: gddStation.station, sid: gddStation.sid,
          lat: gddStation.stationLat, lon: gddStation.stationLon,
          distanceKm: gddStation.distanceKm,
        } : null,
      };
    }
    case 59: {
      // Priestley & Taylor (1972). Δ and γ derived from temperature/pressure
      // (same physics as FAO-56), not defaulted. Net radiation R is the
      // paper's 24-hr net radiation input — genuine ERA5 surface fluxes
      // (absorbed shortwave − net upward longwave). Honest NaN when ERA5 is
      // unavailable (no static radiation fallback). G defaults to 0 — the
      // paper explicitly neglects ground heat flux for 24-hr totals
      // (p. 83: "heat flux into the ground was neglected").
      const esT = 0.6108 * Math.exp(17.27 * T / (T + 237.3));
      const deltaCalc = (4098 * esT) / Math.pow(T + 237.3, 2);
      const gammaCalc = 0.665e-3 * (P * 0.1);
      const fluxes = ctx.era5?.surfaceFluxes;
      const rn = fluxes != null && fluxes.netShortwave != null && fluxes.netLongwave != null
        ? fluxes.netShortwave - fluxes.netLongwave
        : Number.NaN;
      return {
        alpha: u('alpha', 1.26),
        delta: u('delta', deltaCalc),
        gamma: u('gamma', gammaCalc),
        Rn: u('Rn', rn),
        G: u('G', 0),
      };
    }
    case 60: {
      // Hargreaves & Samani (1985) Eq. [4]. R_a (extraterrestrial radiation)
      // is computed from latitude and day-of-year per Allen FAO-56 Annex 2
      // (the paper's "tables or calculations of extraterrestrial radiation",
      // §A NEW METHOD). TMAX/TMIN are the paper's measured daily maxima and
      // minima — the nearest GHCN-Daily station (the same authentic source
      // as Tool 58), NOT a T±5 proxy and NOT Open-Meteo current temperature.
      // Honest NaN when no station reports (zero-fallback rule).
      const Gsc = 0.0820; // MJ/m²/min
      const latRad = lat * Math.PI / 180;
      const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000) || 180;
      const dr = 1 + 0.033 * Math.cos(2 * Math.PI * doy / 365);
      const decl = 0.409 * Math.sin(2 * Math.PI * doy / 365 - 1.39);
      const wsArg = Math.max(-1, Math.min(1, -Math.tan(latRad) * Math.tan(decl)));
      const ws = Math.acos(wsArg);
      const Ra = (24 * 60 / Math.PI) * Gsc * dr * (ws * Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.sin(ws));
      const recent = gddStation?.days.find(d => Number.isFinite(d.tmaxC) && Number.isFinite(d.tminC));
      return {
        Ra: u('Ra', Ra),
        Tmax: u('Tmax', Number.isFinite(recent?.tmaxC ?? NaN) ? recent!.tmaxC : Number.NaN),
        Tmin: u('Tmin', Number.isFinite(recent?.tminC ?? NaN) ? recent!.tminC : Number.NaN),
        __gddStation: gddStation ? {
          name: gddStation.station, sid: gddStation.sid,
          lat: gddStation.stationLat, lon: gddStation.stationLon,
          distanceKm: gddStation.distanceKm,
        } : null,
      };
    }
    case 61: {
      // FAO Yield Response to Water (Doorenbos & Kassam 1979, IDP 33;
      // reproduced in FAO IDP 66): (1 − Yₐ/Yₘ) = K_y·(1 − ETₐ/ETₘ).
      // Every input is a FIELD measurement or crop-specific constant that no
      // open point API serves: actual/maximum yield (farm records), actual
      // ET (soil-water balance) and maximum ET (FAO-56 crop ET) are
      // user-supplied; K_y comes from the paper's seasonal table (e.g. maize
      // 1.25, spring wheat 1.15, winter wheat 1.05, soybean 0.85). Honest
      // NaN autos — never fabricated defaults (the previous Ya=4/Ym=5/Ky=1.2/
      // ETa=drought-proxy/ETm=5 were static fabrications, removed).
      return {
        Ya: u('Ya', Number.NaN),
        Ym: u('Ym', Number.NaN),
        Ky: u('Ky', Number.NaN),
        ETa: u('ETa', Number.NaN),
        ETm: u('ETm', Number.NaN),
      };
    }
    case 62: {
      // Eppley (1972) Eq. (1): log₁₀ μmax = 0.0275·T − 0.070 — the marine
      // maximum-growth envelope. T is sea temperature: genuine daily SST from
      // NOAA OISST v2 (the paper's own culture/environment temperature). No
      // open point API provides μ₂₀ (species-specific growth at 20 °C), so
      // its auto is an honest NaN; when supplied it scales the paper curve
      // through 20 °C (μ₂₀ × 1.066^(T−20), algebraically the same family).
      const sstC = ctx.sst?.sst ?? Number.NaN;
      return {
        umax: u('umax', Number.NaN),
        T: u('T', sstC),
      };
    }
    case 63: {
      // SiB big-leaf (Sellers et al. 1986): surface fluxes need canopy/soil
      // temperatures and aerodynamic/surface resistances that no open point
      // API supplies — those autos are honest NaN (user must provide). The
      // remaining inputs derive genuinely: T_a (Open-Meteo 2 m), e_s/e_a
      // from T_a and relative humidity via the Magnus formula (hPa), air
      // density from the ideal-gas law ρ = p/(R·T) using surface pressure
      // (hPa) and T_a, and γ in the engine from pressure. Magnus constants
      // (hPa, °C): e_s = 6.1094·exp(17.625·T/(T+243.04)).
      const esat = (tC: number) => 6.1094 * Math.exp(17.625 * tC / (tC + 243.04));
      const TaC = Number.isFinite(T) ? T : Number.NaN;
      const pC = Number.isFinite(P) ? P : Number.NaN;
      const rhoAuto = (Number.isFinite(TaC) && Number.isFinite(pC))
        ? (pC * 100) / (287.05 * (TaC + 273.15))
        : Number.NaN;
      // normalizeInputs already renamed the user key 'ρ' → 'rho' (PARAM_ALIASES), so
      // read the normalized name (u('rho')) and emit 'rho' for ALIGN to pass through.
      return {
        rho: u('rho', rhoAuto),
        cp: u('cp', 1005),
        Ts: u('Ts', Number.NaN),
        Ta: u('Ta', TaC),
        ra: u('ra', Number.NaN),
        rs: u('rs', Number.NaN),
        es: u('es', Number.isFinite(TaC) ? esat(TaC) : Number.NaN),
        ea: u('ea', (Number.isFinite(TaC) && Number.isFinite(rh)) ? esat(TaC) * rh / 100 : Number.NaN),
        p: u('p', pC),
      };
    }

    // ═══ Domain 9: Atmospheric Chemistry ═══
    // Chapman (1930) — [O₃]/[O₂] = √(J₁·k₂/(J₃·k₄)). J₁ and J₃ (photolysis
    // rates) are environmental actinic-flux inputs with no open point API —
    // honest NaN autos. k₂ and k₄ are NASA/JPL 2023 evaluation rate constants
    // (physical constants, quoted at 298 K; k₂ as the effective bimolecular
    // rate at 1 atm). [O₂] is an altitude-dependent number density — NaN auto.
    case 64: return {
      J1: u('J1', Number.NaN),
      k2: u('k2', 1.43e-14),
      J3: u('J3', Number.NaN),
      k4: u('k4', 7.95e-15),
      O2: u('O2', Number.NaN),
    };
    // Atkinson (2000): τ = 1/(k_OH·[OH]). k is species-specific (laboratory
    // rate constant, no open point API) — honest NaN auto. [OH] defaults to
    // the paper's diurnally/seasonally/annually averaged 24-h global mean
    // 1.0e6 molecule cm⁻³ (Prinn et al. 1995, cited in the paper); the 12-h
    // daytime average 2.0e6 (Table 1 convention) is available as an override.
    case 65: return {
      k: u('k', Number.NaN),
      OH: u('OH', 1e6),
    };

    // ═══ Domain 10: Ocean Dynamics ═══
    // Sverdrup (1947) eq (13): β·M_y = curl_z(τ), with β = 2Ωcosφ/R (eq 12) and
    // f = 2Ωsinφ for the Ekman pumping output. β and f are genuinely derived
    // from the request latitude. The wind-stress curl (∇×τ)_z is a spatial
    // derivative of the wind-stress field — not derivable from a single-point
    // fetch (no genuine wind-field gradient source this session) — honest NaN
    // auto; user supplies (e.g. from ASCAT/CCMP wind products). rho0 = 1025 is
    // a physical constant. W = basin width (m), optional, for the total in Sv.
    case 66: {
      const latRad = (ctx.lat * Math.PI) / 180;
      const betaLat = (2 * 7.2921e-5 * Math.cos(latRad)) / 6371000;
      const fLat = 2 * 7.2921e-5 * Math.sin(latRad);
      // normalizeInputs already renamed the Unicode user keys ('β'→'beta',
      // 'ρ₀'→'rho0', '(∇×τ)_z'→'curlTau_z' via PARAM_ALIASES), so read the
      // normalized ASCII names here.
      return {
        beta: u('beta', betaLat),
        rho0: u('rho0', 1025),
        curlTau_z: u('curlTau_z', Number.NaN),
        f: u('f', fLat),
        W: u('W', Number.NaN),
      };
    }
    // Stommel (1948) model eq (9): ∇²ψ + α·∂ψ/∂x = γ·sin(πy/b), α = D·β/R,
    // γ = F·π/(R·b). Basin geometry and friction are model configuration —
    // defaults are the paper's own numerical example (D = 2×10⁴ cm = 200 m,
    // b = 2π×10⁸ cm ≈ 6249 km, L = 10⁹ cm = 10,000 km, R = 0.02 s⁻¹, F = 1
    // dyne/cm² = 0.1 N/m²) converted to SI; β auto-derives from the latitude.
    case 67: {
      const latRad = (ctx.lat * Math.PI) / 180;
      const betaLat = (2 * 7.2921e-5 * Math.cos(latRad)) / 6371000;
      return {
        beta: u('beta', betaLat),
        D: u('D', 200),
        b: u('b', 6249e3),
        L: u('L', 1e7),
        R: u('R', 0.02),
        F: u('F', 0.1),
        x: u('x', 5e6),
        y: u('y', 3124.5e3),
      };
    }
    // Munk (1950): A_H·∇⁴ψ − β·∂ψ/∂x = curl_z(τ). A_H is the paper's adopted
    // constant A = 5×10⁷ cm²/s = 5×10³ m²/s (paper §4); β auto-derives from the
    // latitude; the wind-stress curl is a spatial derivative (∂τ_y/∂x − ∂τ_x/∂y) —
    // no genuine point source this session → honest NaN, user supplies it.
    case 68: {
      const latRad = (ctx.lat * Math.PI) / 180;
      const betaLat = (2 * 7.2921e-5 * Math.cos(latRad)) / 6371000;
      return {
        AH: u('AH', 5e3),
        beta: u('beta', betaLat),
        curlTau: u('curlTau', Number.NaN),
        x: u('x', 1e5),
        r: u('r', 6e6),
      };
    }
    // Stommel (1961) two-vessel thermohaline model — dimensionless parameters
    // (R = βS̄/αT̄, δ = d/c, λ = flow-feedback constant). These are the paper's
    // model-configuration parameters; defaults are the paper's own fig-6/7
    // example (R = 2, δ = 1/6, λ = 1/5) which yields TWO stable regimes.
    case 69: return {
      lambda: u('lambda', 0.2),
      delta: u('delta', 1 / 6),
      R: u('R', 2),
    };
    case 70: {
      const obsSst = ctx.era5?.surfaceFluxes?.netShortwave != null
        ? T
        : undefined;
      const profile = getOceanProfile(lat, lon, 0, obsSst);
      return {
        S: u('S', Math.round(profile.salinity * 10) / 10),
        Theta: u('Theta', Math.round(profile.sst * 10) / 10),
        p: u('p', 0),
      };
    }
    case 71: {
      const obsSst = ctx.era5?.surfaceFluxes?.netShortwave != null
        ? T
        : undefined;
      // Genuine mean vertical temperature gradient from the ocean T-profile
      // (upper 200 m): ∂θ̄/∂z ≈ (T(10m) − T(200m)) / 190 m.
      const t10 = getOceanProfile(lat, lon, 10, obsSst).temperature;
      const t200 = getOceanProfile(lat, lon, 200, obsSst).temperature;
      const dTdz = (t10 - t200) / 190;
      const n2 = computeN2(lat, obsSst);
      return {
        kappa: u('kappa', 1.4e-7),      // molecular thermal diffusivity (physical constant)
        gradVar: u('gradVar', Number.NaN), // <(∇θ')²> — microstructure, no open point API → NaN
        dTdz: u('dTdz', dTdz),
        gamma: u('gamma', 0.2),          // companion Osborn (1980) efficiency
        eps: u('eps', Number.NaN),       // TKE dissipation — microstructure, no open point API → NaN
        N2: u('N2', n2),
      };
    }
    case 72: {
      const obsSst = ctx.era5?.surfaceFluxes?.netShortwave != null
        ? T
        : undefined;
      // Δρ = density jump across the ML base (paper eq 9: Δ( ) = mixed layer vs
      // the level just beneath). Genuine ocean-profile density at 10 m vs 100 m.
      const rho10 = getOceanProfile(lat, lon, 10, obsSst).density;
      const rho100 = getOceanProfile(lat, lon, 100, obsSst).density;
      const drho = Math.max(0, rho100 - rho10);
      const h = getOceanProfile(lat, lon, 0, obsSst).mixedLayerDepth;
      return {
        g: u('g', G_GRAV),
        rho0: u('rho0', 1025),
        drho: u('drho', drho),
        h: u('h', h),
        dV: u('dV', Number.NaN), // velocity jump ΔV — no open point API → honest NaN
      };
    }
    case 73: {
      // Pierson & Moskowitz (1964) eq (12): U is the wind at the WEATHER-SHIP
      // reference height — the paper: "The spectral form given by (12) will
      // describe the spectrum of a fully developed wind sea for a wind
      // measured at 19.5 meters." Genuine CDS ERA5 10 m wind (windOnly single
      // job, zero-proxy) is converted to the paper's 19.5 m reference height
      // via the neutral log profile U₂ = U₁·ln(z₂/z₀)/ln(z₁/z₀) with the
      // standard open-ocean roughness z₀ = 0.0002 m (documented physical
      // constant of the height correction, not a data substitute). Honest NaN
      // when the genuine CDS job is unavailable (no Open-Meteo substitute).
      const wind10 = ctx.era5?.source === 'cds' ? ctx.era5?.wind10m ?? null : null;
      const windAt195 = wind10 != null && Number.isFinite(wind10)
        ? wind10 * Math.log(19.5 / 0.0002) / Math.log(10 / 0.0002)
        : Number.NaN;
      const userSuppliedU = ['U', 'U10', 'U₁₀'].some((k) => userInputs[k] != null);
      const Uval = u('U', windAt195);
      const gval = u('g', G_GRAV);
      // omega default: the paper's peak frequency ω_p = (4β/5)^(1/4)·g/U
      const omegaDef = Number.isFinite(Uval) && Uval > 0
        ? Math.pow(4 * 0.74 / 5, 0.25) * gval / Uval
        : Number.NaN;
      return {
        U: Uval,
        omega: u('omega', omegaDef),
        g: gval,
        // Provenance for the engine's derivation steps (never shown as inputs).
        __wind10m: userSuppliedU ? null : wind10,
        __windDate: ctx.era5?.wind10mAsOfDate ?? null,
        __uAuto: !userSuppliedU,
      };
    }

    // ═══ Domain 11: Coastal & Wave ═══
    case 74: {
      // Stockdon et al. (2006) runup is parameterized on the paper's inputs
      // H₀ (deep-water significant wave height), T₀ (deep-water peak period)
      // and β_f (foreshore beach slope). Genuine CDS ERA5 swh/pp1d supply
      // H₀ and T₀ (single wave job, zero-proxy); β_f comes from the fetched
      // SRTM30m slope at the study point (terrain slope in degrees → tan
      // gives the dimensionless foreshore slope). Honest NaN when the CDS
      // job is unavailable (no Open-Meteo substitute).
      const wave = ctx.era5?.source === 'cds' && ctx.era5?.waveHeight != null && ctx.era5?.wavePeriod != null
        ? { H0: ctx.era5.waveHeight, T0: ctx.era5.wavePeriod }
        : null;
      const slopeDeg = Number.isFinite(tr.slope) && tr.slope > 0 ? tr.slope : null;
      const betaF = slopeDeg != null ? Math.tan(slopeDeg * Math.PI / 180) : Number.NaN;
      const userH0 = userInputs['H0'] != null || userInputs['H₀'] != null;
      const userT0 = userInputs['T0'] != null || userInputs['T₀'] != null;
      const userBeta = userInputs['betaF'] != null || userInputs['β_f'] != null || userInputs['βf'] != null;
      return {
        H0: u('H0', wave ? wave.H0 : Number.NaN),
        T0: u('T0', wave ? wave.T0 : Number.NaN),
        betaF: u('betaF', betaF),
        g: u('g', G_GRAV),
        // Provenance for the engine's derivation steps (never shown as inputs).
        __hAuto: !userH0,
        __tAuto: !userT0,
        __betaAuto: !userBeta,
        __waveDate: ctx.era5?.waveAsOfDate ?? null,
      };
    }
    case 75: {
      // Bruun (1962): R = L·S/(B + h*). S is the LOCAL sea-level rise rate
      // — genuine OLS trend of the nearest NOAA CO-OPS tide-gauge monthly
      // MSL series; the documented GIA-corrected global altimetry rate
      // (~3.4 mm/yr, IPCC AR6 WGI Ch 9) is used ONLY when no gauge covers
      // the point and is labelled as the global rate. h* = closure depth
      // via the catalogue's Hallermeier (1981) criterion h* = 1.57·H_s
      // from genuine CDS ERA5 swh (same waveOnly job as Tool 74). B = berm/
      // dune elevation from genuine SRTM30m terrain at the point; L = (B +
      // h*)/tanβ at the genuine SRTM30m beach slope (the canonical slope
      // form R = S/tanβ). User overrides always win; missing data → honest
      // NaN — no static geometry defaults, no fabricated SLR.
      const slr = ctx.slr;
      const waveH = ctx.era5?.source === 'cds' && ctx.era5?.waveHeight != null ? ctx.era5.waveHeight : null;
      const slopeDeg = Number.isFinite(tr.slope) && tr.slope > 0 ? tr.slope : null;
      const elev = Number.isFinite(tr.elevation) && tr.elevation > 0 ? tr.elevation : null;
      const hstarAuto = waveH != null ? 1.57 * waveH : Number.NaN;
      const bAuto = elev ?? Number.NaN;
      const lAuto = slopeDeg != null && Number.isFinite(bAuto) && Number.isFinite(hstarAuto)
        ? (bAuto + hstarAuto) / Math.tan(slopeDeg * Math.PI / 180)
        : Number.NaN;
      // Primary: nearest-gauge OLS trend. Fallback (no gauge coverage): the
      // observed global altimetry rate, labelled. Only a total NOAA failure
      // of both paths yields NaN — never a made-up local rate.
      const sAuto = slr != null ? slr.slopeMPerYr : gmslRateDefault().slopeMPerYr;
      const slrNote = slr != null
        ? `S from NOAA CO-OPS gauge ${slr.stationId} (${slr.stationName}, ${slr.distanceKm} km away): OLS trend of ${slr.nMonths} monthly MSL values ${slr.fromYear}-${slr.toYear}`
        : Number.isFinite(sAuto)
          ? 'S = GIA-corrected GLOBAL altimetry rate (~3.4 mm/yr, IPCC AR6 WGI Ch 9) — no local NOAA gauge covers this point'
          : 'No genuine sea-level source reachable — honest NaN';
      // userInputs are already alias-normalized (PARAM_ALIASES[75]: 'L*'→'L', 'h*'→'hstar').
      const userL = userInputs['L'] != null;
      const userS = userInputs['S'] != null;
      const userB = userInputs['B'] != null;
      const userH = userInputs['hstar'] != null;
      return {
        L: u('L', lAuto),
        S: u('S', sAuto),
        B: u('B', bAuto),
        hstar: u('hstar', hstarAuto),
        // Provenance for the engine's steps (never shown as inputs).
        __sAuto: !userS,
        __hstarAuto: !userH,
        __bAuto: !userB,
        __lAuto: !userL,
        __slrNote: slrNote,
        __waveDate: ctx.era5?.waveAsOfDate ?? null,
        __slopeDeg: slopeDeg ?? null,
      };
    }
    case 76: {
      // McCowan (1894): H_b = 0.78·d_b (paper eq 34: c − h = 0.78h). The
      // paper's water-depth input auto-derives from genuine GEBCO 2020
      // bathymetry at the study point (depth = −elevation, positive only
      // over water). On land or when GEBCO is unreachable the auto value is
      // an honest NaN — no static depth, no proxy. User d_b always wins.
      const gebco = ctx.gebcoDepth;
      const depthAuto = gebco != null && gebco.depth > 0 ? gebco.depth : Number.NaN;
      return {
        db: u('db', depthAuto),
        // Provenance for the engine's steps (never shown as inputs).
        __dbAuto: userInputs['db'] == null,
        __gebcoElev: gebco?.elevation ?? null,
      };
    }
    case 77: {
      // CERC longshore sediment transport (SPM 1984, Vol 1 Ch 4 §V — the
      // energy-flux method, eqs 4-44/4-45/4-48/4-49/4-50, K = 0.39). Auto
      // H_sb: genuine CDS ERA5 significant wave height (swh) — the paper's
      // deep-water H_0s, so the engine applies the Table 4-10 deep-water
      // form eq 4-45 (provenance-flagged); a user-supplied Hsb is treated
      // as the breaking height and uses eq 4-44. Auto θ_b: genuine ERA5
      // mean wave direction (mwd) relative to the genuine GEBCO 2020 shoreline
      // bearing — the signed acute angle between the wave propagation
      // direction and the shore-normal (sin(2α) then carries sign). Honest
      // NaN when either genuine source is unavailable (no proxy, no
      // fabricated angle).
      const wave = ctx.era5?.source === 'cds' && ctx.era5?.waveHeight != null
        ? { H0s: ctx.era5.waveHeight, mwd: ctx.era5.waveDirection }
        : null;
      const userH = userInputs['Hsb'] != null;
      const userTheta = userInputs['thetaB'] != null;
      const sb = ctx.shorelineBearing;
      let thetaAuto = Number.NaN;
      let thetaNote: string | null = null;
      if (wave && Number.isFinite(wave.mwd ?? NaN) && Number.isFinite(sb ?? NaN)) {
        const prop = (wave.mwd! + 180) % 360;                 // waves travel toward this bearing
        const normalLand = (sb! + 90) % 360;                  // shore-normal pointing landward
        const d = ((prop - normalLand) % 360 + 360) % 360;    // 0–360
        const signed = d > 180 ? d - 360 : d;                 // −180..180
        const acute = signed > 90 ? signed - 180 : signed < -90 ? signed + 180 : signed;
        thetaAuto = acute * Math.PI / 180;
        thetaNote = `α = signed acute angle between ERA5 mean wave direction (${Math.round(wave.mwd!)}° FROM) and the GEBCO 2020 shore-normal (shoreline bearing ${sb!.toFixed(0)}°)`;
      }
      return {
        K: u('K', 0.39),
        Hsb: u('Hsb', wave ? wave.H0s : Number.NaN),
        thetaB: u('thetaB', thetaAuto),
        // Provenance for the engine's steps (never shown as inputs).
        __hAuto: !userH,
        __thetaAuto: !userTheta,
        __thetaNote: thetaNote,
        __deepWaterForm: !userH,
        __waveDate: ctx.era5?.waveAsOfDate ?? null,
      };
    }
    case 78: {
      // Airy (1845) linear wave dispersion relation (SPM 1984 Vol 1 Ch 2,
      // eqs 2-1/2-2/2-3): ω² = g·k·tanh(kh). Auto h: genuine GEBCO 2020
      // bathymetry at the point (the same source as Tool 76 — positive
      // depth only over water). Land points / fetch failures yield an
      // honest NaN auto depth (no static 10 m). User-supplied h always
      // wins; the provenance flags tell the engine whether to label the
      // step "auto GEBCO" or "user input".
      const userH = userInputs['h'] != null;
      const autoDepth = ctx.gebcoDepth && ctx.gebcoDepth.depth > 0 ? ctx.gebcoDepth.depth : Number.NaN;
      return {
        g: u('g', G_GRAV),
        k: u('k', 0.1),
        h: u('h', autoDepth),
        __hAuto: !userH,
        __gebcoElev: ctx.gebcoDepth ? ctx.gebcoDepth.elevation : null,
      };
    }
    case 79: return {
      omega: u('omega', 2 * Math.PI / (m.wave_period ?? 8)),
      ka: u('ka', 0.1),
      z: u('z', -5),
    };
    case 80: return {
      alpha: u('alpha', 0.0081),
      g2: u('g2', G_GRAV),
      fm: u('fm', 0.1),
      fpm: u('fpm', 0.15),
      gamma: u('gamma', 3.3),
    };

    // ═══ Domain 12: Geomorphology ═══
    case 81: return {
      K: u('K', 0.01),
      A: u('A', 10000),
      m: u('m', 0.5),
      S: u('S', (tr.slope || 0) / 100),
    };
    case 82: return {
      c: u('c', 2.5),
      A: u('A', 100),
      h: u('h', 0.6),
    };
    case 83: return {
      L1: u('L1', 100), s1: u('s1', 10),
      L2: u('L2', 300), s2: u('s2', 1),
    };
    case 84: return {
      cprime: u('cprime', 25),
      gammaz: u('gammaz', 20),
      z: u('z', 5),
      cosB: u('cosB', 0.866),
      u: u('u', 0),
      phiP: u('phiP', 30),
      tanphi: u('tanphi', 0.577),
      sinB: u('sinB', 0.5),
      cosB2: u('cosB2', 0.75),
    };
    case 85: return {
      mu: u('mu', 0.4),
      sigmaN: u('sigmaN', 100),
      xi: u('xi', 500),
      rho: u('rho', 2000),
      velocity: u('velocity', 10),
    };
    case 86: return {
      // Stream Power Index: SPI = ln(As × tanβ) — Moore et al. (1991)
      As: u('As', 500),
      tanB: u('tanB', Math.max(1e-6, Math.tan(Math.max(0.001, (tr.slope ?? 2)) * Math.PI / 180))),
    };
    case 87: return {
      // Topographic Wetness Index: TWI = ln(As / tanβ) — Beven & Kirkby (1979)
      As: u('As', 500),
      tanB: u('tanB', Math.max(1e-6, Math.tan(Math.max(0.001, (tr.slope ?? 2)) * Math.PI / 180))),
    };

    // ═══ Domain 13: Limnology ═══
    case 88: return {
      Km: u('Km', 0.5),
      ew: u('ew', 6.1094 * Math.exp(17.625 * T / (T + 243.04))),
      ea: u('ea', 6.1094 * Math.exp(17.625 * T / (T + 243.04)) * rh / 100),
      u: u('u', ws),
    };
    case 89: return {
      A: u('A', 1),
      z: u('z', 20),
      rms: u('rms', 0.5),
    };
    case 90: {
      // Nash (1957) cascade is driven by the total inflow volume Q₀ (m³/s·h).
      // USGS streamflow arrives as a JSON string, so coerce defensively and
      // preserve a genuine 0 (the old `|| 100` conflated it with "missing").
      // When no USGS station is nearby, Q₀ is honest NaN.
      const q0Raw = rv.discharge;
      const q0Num = typeof q0Raw === 'number' ? q0Raw : Number(q0Raw);
      const hasQ0 = userInputs['Q0'] != null && Number.isFinite(Number(userInputs['Q0']));
      const out: Record<string, unknown> = {
        n: u('n', 3),
        K: u('K', 6),
        t: u('t', 24),
        Q0: u('Q0', Number.isFinite(q0Num) && q0Num !== 0 ? q0Num : Number.NaN),
      };
      if (!hasQ0 && (!Number.isFinite(q0Num) || q0Num === 0)) {
        (out as Record<string, unknown>).__proxyWarning =
          'No USGS streamflow data available at this location. ' +
          'Q₀ cannot be derived — supply Q₀ explicitly or select a point near a USGS gauge.';
      }
      return out;
    }

    // ═══ Domain 14: Cryosphere & Volcanology ═══
    case 91: {
      // Braithwaite (1989) PDD glacier mass balance. T_pos (positive degree-
      // day sum) must be the SUM of positive daily temperatures over the melt
      // season, not a single day's max(0,T). Approximated here from the real
      // mean air temperature × a 150-day melt season (a documented proxy for
      // the true PDD integration, which requires the full daily ERA5 series).
      const glArea = gl.area;  // 0 when glacier fetcher throws — flagged below
      // Use permafrost ground temperature when available for more accurate PDD
      const surfaceT = pf?.groundTemp ?? T;
      const pddApprox = Math.max(0, surfaceT) * 150;  // mean T × melt-season days
      // GLDAS snow water equivalent for accumulation estimate
      const gldasSwe = ctx.gldas?.snowWaterEquivalent;
      const sweAccum = gldasSwe != null ? Math.max(0, gldasSwe / 1000) : undefined;
      const out: Record<string, unknown> = {
        accum: u('accum', sweAccum ?? (glArea > 0 ? 2 : 0.5)),
        DDF: u('DDF', 0.005),
        Tpos: u('Tpos', pddApprox),
        days: u('days', 365),
      };
      if (glArea === 0 && gldasSwe == null) {
        (out as Record<string, unknown>).__proxyWarning =
          'Glacier area/accumulation not retrieved from GLIMS/RGI (no public point-query ' +
          'REST API) and GLDAS SWE unavailable. Using a default accumulation. For a real ' +
          'mass balance, supply the glacier-specific accumulation and the PDD sum from a ' +
          'local weather station.';
      }
      return out;
    }
    case 92: return {
      K: u('K', 2),
      DIFI: u('DIFI', 1000),
      L: u('L', 3e8),
    };
    case 93: return {
      k: u('k', 0.01),
      b: u('b', 100),
      rhoI: u('rhoI', 917),
      rhoF: u('rhoF', 550),
    };
    case 94: {
      // Volcanic Explosivity Index — influenced by eruption history
      const activityBoost = vo?.recentActivity ? 1 : 0;
      return {
        VEI: u('VEI', 4 + activityBoost),
      };
    }
    case 95: {
      // Volcanic Heat Flux — influenced by proximity to active volcano
      const distFactor = (vo?.distance ?? 9999) < 50 ? 3 : (vo?.distance ?? 9999) < 200 ? 1.5 : 1;
      return {
        Qdot: u('Qdot', 1e6 * distFactor),
        rhoAir: u('rhoAir', 1.2),
        alpha: u('alpha', 0.1),
      };
    }

    // ═══ Domain 15: Climate Dynamics ═══
    case 96: {
      // Budyko/Sellers EBM is a TOP-OF-ATMOSPHERE budget: Q = mean insolation
      // (S₀/4 = 1367/4 = 341.75 W/m², a physical constant) and I = OLR.
      // ERA5 surface fluxes (netShortwave/netLongwave) are SURFACE quantities
      // and must not feed Q or I here. TOA radiative fluxes would come from
      // CERES TOA; until that source is wired the documented EBM constants
      // are used (physical constants of the method, not data fallbacks).
      return {
        C: u('C', 2.09e7),
        T: u('T', 288),
        Q: u('Q', 341.75),
        α: u('α', 0.3),
        I: u('I', 240),
        D: u('D', 0.6),
        divDT: u('divDT', 0),
      };
    }
    case 97: return {
      dF: u('dF', 3.7),
      lambda0: u('lambda0', 3.2),  // Planck feedback λ₀ ≈ 3.2 W/m²K (Hansen et al. 1984)
      f: u('f', 2.0),              // Net non-Planck feedbacks (WV+LR+cloud+albedo) → ECS ≈ 3 K
    };
    case 98: return {
      dRdT: u('dRdT', -3.2),
    };
    case 99: return {
      k: u('k', 1e-6),
      'β': u('β', 2e-11),
      kx: u('kx', 1e-6),
      ky: u('ky', 1e-6),
    };
    case 100: return {
      dpdy: u('dpdy', -1e-11),
      f: u('f', 1e-4),
      N: u('N', 0.01),
      dudy: u('dudy', 1e-3),
    };
    case 101: return {
      f: u('f', 1e-4),
      N: u('N', 0.01),
      dudy: u('dudy', 1e-3),
    };

    // ═══ Domain 16: Atmospheric Dynamics ═══
    case 102: return {
      psi: u('psi', 1e7),
      f: u('f', 2 * OMEGA * Math.sin(lat * Math.PI / 180)),
      dpy: u('dpy', 1e-11),
      dpp: u('dpp', 1e-12),
    };
    case 103: return {
      ubar: u('ubar', ws),
      uprime: u('uprime', 2),
    };
    case 104: return {
      Km: u('Km', 100),
      f: u('f', 1e-4),
    };
    case 105: {
      const fluxes = ctx.era5?.surfaceFluxes;
      // w'θ_v' ≈ sensible heat flux / (ρ·c_p). Use ERA5 SHF if available.
      const rho = P * 100 / (R_SPEC * (T + 273.15));
      const wthetaVEra5 = fluxes?.sensibleFlux != null
        ? Math.abs(fluxes.sensibleFlux) / (rho * 1005)
        : undefined;
      return {
        g: u('g', G_GRAV),
        thetaVbar: u('thetaVbar', T + 273.15),
        wthetaV: u('wthetaV', wthetaVEra5 ?? 0.2),
        zi: u('zi', 1000),
      };
    }
    case 106: {
      const ps = ctx.era5?.pressureState;
      // Use ERA5 850/500 hPa temperature difference for θ gradient
      const dthetaEra5 = (ps?.temperature850 != null && ps?.temperature500 != null)
        ? ps.temperature850 - ps.temperature500
        : undefined;
      return {
        dtheta: u('dtheta', dthetaEra5 ?? 5),
        D: u('D', 1e-7),
        cos2b: u('cos2b', 0.5),
        delta: u('delta', 0.5),
        dB: u('dB', 0),
        dudy: u('dudy', 1e-3),
      };
    }
    case 107: {
      const pw = ctx.era5?.pressureWind;
      return {
        zeta: u('zeta', 1e-4),
        f: u('f', 2 * OMEGA * Math.sin(lat * Math.PI / 180)),
        dudx: u('dudx', pw?.u850 != null && pw?.u500 != null ? (pw.u850 - pw.u500) / 100000 : 1e-5),
        dudy: u('dudy', 1e-5),
        dvdx: u('dvdx', 1e-5),
        dvdy: u('dvdy', pw?.v850 != null && pw?.v500 != null ? (pw.v850 - pw.v500) / 100000 : 1e-5),
        div: u('div', pw?.u850 != null && pw?.u500 != null && pw?.v850 != null && pw?.v500 != null ? ((pw.u850 - pw.u500) + (pw.v850 - pw.v500)) / 100000 : 1e-5),
      };
    }

    // ═══ Domain 17: Cloud Physics ═══
    case 108: {
      // Köhler (1936) droplet activation. The Kelvin curvature coefficient a
      // is a physical constant (a = 2σ/(ρ_w·R_v·T) ≈ 1.2×10⁻⁹ m at 273 K),
      // so it has a genuine default. The droplet radius r and the solute
      // (Raoult) coefficient b are site/measurement quantities — no public
      // API reports cloud-droplet radius or aerosol solute load at a point,
      // so they are honest NaN (never a fabricated 1e-6 m / 1e-18 m³).
      const out: Record<string, unknown> = {
        a: u('a', 1.2e-9),
        r: u('r', Number.NaN),
        b: u('b', Number.NaN),
      };
      if (!Number.isFinite(out.r as number) || !Number.isFinite(out.b as number)) {
        (out as Record<string, unknown>).__proxyWarning =
          'Droplet radius r and solute coefficient b are not auto-derivable ' +
          '(no public API reports cloud-droplet radius / aerosol solute load at a point). ' +
          'Supply r (m) and b (m³) explicitly to compute the Köhler curve.';
      }
      return out;
    }
    case 109: return {
      N0: u('N0', 8000),
      Lambda: u('Lambda', 4100),
      D: u('D', 0.001),
    };
    case 110: {
      const ip = ctx.imerg?.totalPrecipitation;
      return {
        a: u('a', 200),
        R: u('R', ip ?? w.precipitation ?? 10),
      };
    }

    // ═══ Domain 18: Geodesy ═══
    case 111: return {
      xp: u('xp', 0.1),
      yp: u('yp', 0.2),
      sp: u('sp', 0.0001),
      gast: u('gast', 1.5),
      dx: u('dx', 20),
      dy: u('dy', -15),
    };
    case 112: return {
      hn: u('hn', 0.603),
      kn: u('kn', 0.298),
      Vn: u('Vn', 0), // 0 → engine derives the latitude-dependent degree-2 potential V₂(φ)
      g: u('g', G_GRAV),
      lat: u('lat', lat),
      Re: u('Re', 6371000),
    };
    case 113: return {
      GM: u('GM', 3.986004418e14),
      r: u('r', 6371000 + el.elevation * 1000),
      n: u('n', 2),
      m: u('m', 0),
      Cnm: u('Cnm', 1e-6),
      Snm: u('Snm', 0),
      Pnm: u('Pnm', 1),
      phi: u('phi', lat * Math.PI / 180),
      lam: u('lam', lon * Math.PI / 180),
      Re: u('Re', 6371000),
    };
    case 114: {
      const a = 6378137; // WGS84 semi-major axis
      const f = 1 / 298.257223563;
      const e2 = 2 * f - f * f;
      const hEll = el.elevation;
      const sinLat = Math.sin(lat * Math.PI / 180);
      const cosLat = Math.cos(lat * Math.PI / 180);
      const Nrad = a / Math.sqrt(1 - e2 * sinLat * sinLat);
      const x = (Nrad + hEll) * cosLat * Math.cos(lon * Math.PI / 180);
      const y = (Nrad + hEll) * cosLat * Math.sin(lon * Math.PI / 180);
      const z = (Nrad * (1 - e2) + hEll) * sinLat;
      return {
        X: [x, y, z],
        T: [0, 0, 0],
        S: u('S', 1),
        s: u('s', 0),
        wx: u('wx', 0),
        wy: u('wy', 0),
        wz: u('wz', 0),
      };
    }
    case 115: return {
      h: u('h', el.elevation),
      N: u('N', 30),
    };

    // ═══ Domain 19: Ionosphere ═══
    case 116: {
      // NRLMSISE-00 species densities/masses. The frontend declares per-species
      // symbols (n_N₂, n_O₂, n_O, m_N₂, m_O₂, m_O) — build the engine's
      // ni/mi arrays from them so user overrides bind (§7 input-symbol parity).
      const sp = (k: string): number => {
        const v = userInputs[k];
        return typeof v === 'number' ? v : Number(v);
      };
      const nN2 = sp('n_N₂'); const nO2 = sp('n_O₂'); const nO = sp('n_O');
      const mN2 = sp('m_N₂'); const mO2 = sp('m_O₂'); const mO = sp('m_O');
      const hasUserN = [nN2, nO2, nO].some(Number.isFinite);
      const hasUserM = [mN2, mO2, mO].some(Number.isFinite);
      return {
        ni: Array.isArray(userInputs['ni']) ? userInputs['ni'] : (hasUserN ? [nN2, nO2, nO] : [1e12, 1e11, 5e10]),
        mi: Array.isArray(userInputs['mi']) ? userInputs['mi'] : (hasUserM ? [mN2, mO2, mO] : [2.67e-26, 4.66e-26, 5.31e-26]),
        T: u('T', 1000),
        alt: u('alt', 350),
        z0: u('z0', 200),
      };
    }
    case 117: return {
      Ne: u('Ne', 1e12),
      alt: u('alt', 350000),
      lat: u('lat', lat),
      lon: u('lon', lon),
      NmF2: u('NmF2', 1e12),
      hmF2: u('hmF2', 300000),
      H: u('H', 60000),
    };
    case 118: return {
      J: u('J', 0.01),
      E: u('E', 0.05),
    };
    case 119: return {
      Imean: u('Imean', 1),
      Istd: u('Istd', 0.3),
    };
    case 120: return {
      Pdyn: u('Pdyn', 2),
      Bz: u('Bz', sw.bZ),
    };
    case 121: return {
      Dst: u('Dst', sw.dstIndex),
      Pdyn: u('Pdyn', 2),
      b: u('b', 7.26),
      c: u('c', 0),
    };
    case 122: return {
      eps0: u('eps0', 8.854e-12),
      kB: u('kB', 1.38e-23),
      Te: u('Te', 1000),
      ne: u('ne', 1e12),
    };

    // ═══ Domain 20: Satellite Dynamics ═══
    case 123: return {
      'ρ': u('ρ', el.elevation < 600 ? 1e-13 : 1e-15),
      CD: u('CD', 2.2),
      A: u('A', 10),
      m: u('m', 1000),
      v: u('v', 7500),
    };
    case 124: return {
      'ρ': u('ρ', el.elevation < 600 ? 1e-13 : 1e-15),
      CD: u('CD', 2.2),
      A: u('A', 10),
      v: u('v', 7500),
      m: u('m', 1000),
    };
    case 125: return {
      A1: u('A1', 10),
      A2: u('A2', 10),
      sigmax: u('sigmax', 1000),
      sigmay: u('sigmay', 1000),
      d: u('d', 1000),
    };
    case 126: return {
      rho2: u('rho2', u('ρ2', 1e-10)),
      sigma: u('sigma', 1e-7),
      v: u('v', 7500),
      N: u('N', 10000),
      L: u('L', 100),
      β: u('β', 1e-30),
      γ: u('γ', 0.01),
    };
    case 127: return {
      n: u('n', 0.001),
      x: u('x', 100),       // radial offset in meters
      y: u('y', 0),          // along-track offset in meters
      z: u('z', 0),          // cross-track offset in meters
      xdot: u('xdot', 0),    // radial velocity m/s
      ydot: u('ydot', 0),    // along-track velocity m/s
      zdot: u('zdot', 0),    // cross-track velocity m/s
      ax: u('ax', 0),        // radial thrust m/s²
      ay: u('ay', 0),        // along-track thrust m/s²
      az: u('az', 0),        // cross-track thrust m/s²
    };

    // ═══ Domain 21: Solar-Terrestrial & GNSS (Eqs 128–130) ═══
    case 128: return {
      kp: u('kp', sw.kpIndex),   // real observed Kp from NOAA SWPC (no key required)
      Ki: u('Ki', 0) > 0 ? Array.from({ length: 13 }, () => u('Ki', 0)) : [],  // user-supplied station data (optional)
    };
    case 129: return {
      traceH: u('traceH', 9),
      Q11: u('Q11', 0),  // diagonal of Q = (H^T·H)^{-1}
      Q22: u('Q22', 0),
      Q33: u('Q33', 0),
      Q44: u('Q44', 0),
    };
    case 130: {
      // Saastamoinen (1972). P in hPa, T in K, e = water vapour pressure
      // in hPa (computed from Tetens using real T/RH), θ = elevation angle.
      const eCalc = 6.1094 * Math.exp(17.625 * T / (T + 243.04)) * rh / 100;  // hPa
      return {
        P: u('P', P),
        T: u('T', T + 273.15),
        e: u('e', eCalc),
        Sc: u('Sc', 0.5),  // default elevation angle ~30° (rad)
      };
    }

    // ═══ Domain 22: Groundwater ═══
    case 131: {
      const gwDepth = ctx.gldas?.groundwaterStorage != null
        ? ctx.gldas.groundwaterStorage / 1000 / 0.2
        : undefined;
      return {
        T: u('T', 1000),
        h1: u('h1', gwDepth != null ? Math.max(1, gwDepth * 0.1) : 10),
        h2: u('h2', gwDepth != null ? Math.max(2, gwDepth * 0.15) : 15),
        r1: u('r1', 0.15),
        r2: u('r2', 100),
      };
    }
    case 132: {
      const gwDepth = ctx.gldas?.groundwaterStorage != null
        ? ctx.gldas.groundwaterStorage / 1000 / 0.2
        : undefined;
      return {
        Q: u('Q', 1000),
        T: u('T', 1000),
        S: u('S', gwDepth != null ? Math.max(0.0001, Math.min(0.01, 0.001 * (10 / Math.max(1, gwDepth)))) : 0.001),
        t: u('t', 1000),
        r: u('r', 100),
      };
    }
    case 133: {
      const gwDepth = ctx.gldas?.groundwaterStorage != null
        ? ctx.gldas.groundwaterStorage / 1000 / 0.2
        : undefined;
      return {
        Q: u('Q', 1000),
        T: u('T', 1000),
        S: u('S', gwDepth != null ? Math.max(0.0001, Math.min(0.01, 0.001 * (10 / Math.max(1, gwDepth)))) : 0.001),
        t: u('t', 1000),
        r: u('r', 100),
      };
    }
    case 134: return {
      f0: u('f0', 75),
      fc: u('fc', 10),
      k: u('k', 1.2),
      t: u('t', 60),
    };

    // ═══ Domain 23: Hazard & Risk ═══
    case 135: {
      // Exposure: normalize population to [0, 1] index
      // 100k people → E≈0.5, 1M → E≈1.0, <10k → E≈0.1
      const pop = ctx.pop?.totalPopulation ?? 100000;
      const eNorm = Math.min(1, Math.max(0.01, pop / 200000));
      return {
        H: u('H', eq.count > 10 ? 0.8 : 0.4),
        V: u('V', 0.5),
        E: u('E', eNorm),
      };
    }
    case 136: return {
      D_P: u('D_P', 1e6),           // damage at 100-yr event ($)
      P_low: u('P_low', 0.001),     // lower probability bound
      P_high: u('P_high', 0.5),     // upper probability bound
      num_intervals: u('num_intervals', 100),
    };
    case 137: {
      // EPA AQI breakpoint lookup for PM2.5 (24-hr, µg/m³)
      // 40 CFR Part 50 Appendix G, Table 2
      const PM25_BP: [number, number, number][] = [
        [0, 50, 12.0], [50, 100, 35.4], [100, 150, 55.4],
        [150, 200, 150.4], [200, 300, 250.4], [300, 500, 500.0],
      ];
      const cp = aq.pm2_5 ?? 50;
      // Find correct breakpoint interval
      let bpLo = 0, bpHi = 12.0, iLo = 0, iHi = 50;
      for (const [ilo, ihi, bphi] of PM25_BP) {
        if (cp <= bphi) { iLo = ilo; iHi = ihi; bpHi = bphi; break; }
        bpLo = bphi;
        iLo = ihi;
      }
      return {
        I_Hi: u('I_Hi', iHi),
        I_Lo: u('I_Lo', iLo),
        BP_Hi: u('BP_Hi', bpHi),
        BP_Lo: u('BP_Lo', bpLo),
        C_p: u('C_p', cp),
      };
    }
    case 138: {
      const ip = ctx.imerg?.totalPrecipitation;
      return {
        ...userInputs,
        Xbar: u('Xbar', ip ?? 100),
        Kp: u('Kp', 5),
        sigmaX: u('sigmaX', ctx.imerg?.maxIntensity ?? 30),
      };
    }
    case 139: return {
      ...userInputs,
      Xim1: u('Xim1', ctx.drought?.pdsi ?? 0),
      Zi: u('Zi', 0),
    };
    case 140: return {
      ...userInputs,
      K0: u('K0', 1.3),
      Vres: u('Vres', 1e6),
      hb: u('hb', 30),
    };

    // ═══ Domain 24: Data Assimilation ═══
    case 141: return {
      ...userInputs,
      xf: u('xf', 20),
      Pf: u('Pf', 10),
      y: u('y', 2),
      R: u('R', 4),
      H: u('H', 1),
    };
    case 142: return {
      ...userInputs,
      xb: u('xb', 0),
      H: u('H', 1),
      y: u('y', 1),
      R: u('R', 1),
      B: u('B', 1),
    };
    case 143: return {
      xb: u('xb', 0),
      x: u('x', 0),
      y: u('y', 1),
      B: u('B', 100),
      H: u('H', 1),
      R: u('R', 10),
    };
    case 144: return {
      ...userInputs,
      px: u('px', 0.5),
      py: u('py', 0.5),
      Hxy: u('Hxy', 0.25),
    };

    // ═══ Domain 25: Signal Processing ═══
    case 145: return {
      fGHz: u('fGHz', 2.4),    // frequency in GHz
      dKm: u('dKm', 20200),    // distance in km (GEO orbit)
      Gt: u('Gt', 20),         // transmit antenna gain (dBi)
      Gr: u('Gr', 0),          // receive antenna gain (dBi)
    };
    case 146: {
      // Klobuchar (1987) ionospheric delay. The UI exposes the simplified
      // amplitude/phase form (A in s, x = local-time phase in rad, φ_m in °),
      // while the engine implements the full ICD-GPS-200 8-coefficient model.
      // normalizeInputs maps the UI symbols: A→alpha1, φ_m→phi_m (x unchanged).
      // Map the UI inputs into the broadcast coefficients: alpha1 carries the
      // amplitude A, and the phase x is converted back to a local time offset
      // via t = 50400 + x·P/(2π) with the default 14 h period. φ_m stays in
      // degrees (the engine converts to semicircles internally — the paper's
      // polynomial unit). Physically-correct defaults: real broadcast α are
      // ~1e-8 s, NOT tens of seconds (the previous 50/60/30/20 defaults
      // produced an impossible ~1.4e15 ns delay — ~9 orders of magnitude).
      const A = u('alpha1', 5e-9);
      const xPhase = u('x', 0.5);
      const periodS = 50400; // 14 h Klobuchar default period
      const phiMDeg = u('phi_m', lat); // ° (defaults to the study-point latitude)
      return {
        alpha1: A,
        alpha2: u('alpha2', 0),
        alpha3: u('alpha3', 0),
        alpha4: u('alpha4', 0),
        beta1: u('beta1', periodS),
        beta2: u('beta2', 0),
        beta3: u('beta3', 0),
        beta4: u('beta4', 0),
        phi_m: phiMDeg,               // °
        t_sec: u('t_sec', 50400 + (xPhase * periodS) / (2 * Math.PI)),
        elevation: u('elevation', 90), // ° (zenith → F = 1)
      };
    }
    case 147: return {
      f0: u('f0', 5e9),
      v: u('v', 300),
      c: u('c', 3e8),
    };

    // ═══ Domain 26: Mathematical Frameworks ═══
    case 148: return {
      ...userInputs,
      GM: u('GM', 3.986e14),   // Earth's gravitational parameter (m³/s²)
      r1: u('r1', 6771000),    // LEO radius in meters (6771 km)
      r2: u('r2', 42164000),   // GEO radius in meters (42164 km)
    };
    case 149: return {
      m1: u('m1', 5.97e24),
      m2: u('m2', 7.34e22),
    };
    case 150: return {
      ...userInputs,
      px: u('px', 0.5),
      py: u('py', 0.5),
      pxy: u('pxy', 0.25),
    };

    default: return userInputs;
  }
}

// ── Main compute function ──

/** Which genuine data-source categories each tool's mapInputs case consumes.
 *  The report/API `dataSource` lists ONLY these (the exact sources a tool's
 *  computation actually reads), never every source that merely fetched. */
const TOOL_SOURCES: Record<number, string[]> = {
  1: ['modis-vegetation', 'landsat-c2l2-st', 'era5'],
  2: [], 3: [], 4: ['srtm-elevation'], 5: ['era5'], 6: [], 7: [], 8: ['era5', 'gldas-noah-2.1'],
  9: ['open-meteo-weather'], 10: ['gpm-imerg'], 11: [], 12: ['gpm-imerg'], 13: [], 14: ['noaa-tide'],
  15: [], 16: [], 17: ['era5'], 18: ['isric-soilgrids', 'gpm-imerg', 'gldas-noah-2.1'],
  19: ['usgs-earthquakes'], 20: ['usgs-earthquakes'], 21: ['noaa-moment-tensor'], 22: ['isric-soilgrids'],
  23: ['usgs-earthquakes', 'noaa-moment-tensor'], 24: ['usgs-earthquakes', 'noaa-moment-tensor'], 25: ['usgs-earthquakes'],
  26: ['landsat-c2l2-st'], 27: ['landsat-c2l2-st'], 28: ['landsat-c2l2-st'], 29: ['landsat-c2l2-st'],
  30: ['landsat-c2l2-st'], 31: ['landsat-c2l2-st'], 32: ['firms'], 33: ['landsat-c2l2-st'], 34: [], 35: [],
  36: [], 37: [], 38: [], 39: [], 40: [], 41: [], 42: [], 43: ['isric-soilgrids', 'gldas-noah-2.1'],
  44: ['isric-soilgrids'], 45: ['isric-soilgrids', 'ghcn-climate-normals-r-factor'],
  46: ['open-meteo-weather', 'gldas-noah-2.1'], 47: ['isric-soilgrids', 'gldas-noah-2.1'], 48: ['era5'],
  49: ['open-meteo-weather', 'era5'], 50: ['open-meteo-weather', 'modis-mod17a2h', 'noaa-gml-co2'],
  51: ['open-meteo-weather', 'modis-vegetation'], 52: ['modis-vegetation', 'era5'], 53: ['modis-mod17a2h'],
  54: ['noaa-gml-co2'], 55: [], 56: ['era5', 'noaa-pmel-co2-mooring', 'noaa-oisst-v2'], 57: [],
  58: ['ghcn-daily'], 59: ['era5'], 60: ['ghcn-daily'], 61: [], 62: ['noaa-oisst-v2'], 63: [],
  64: [], 65: [], 66: [], 67: [], 68: [], 69: [], 70: ['era5'], 71: ['era5'], 72: ['era5'],
  73: ['era5'], 74: ['era5'], 75: ['era5', 'noaa-coops-sea-level-trend'], 76: ['gebco-2020-bathymetry'],
  77: ['era5'], 78: ['gebco-2020-bathymetry'], 79: [], 80: [], 81: [], 82: [], 83: [], 84: [],
  85: [], 86: [], 87: [], 88: [], 89: [], 90: [], 91: ['gldas-noah-2.1'], 92: [], 93: [],
  94: [], 95: [], 96: [], 97: [], 98: [], 99: [], 100: [], 101: [], 102: [], 103: [],
  104: [], 105: ['era5'], 106: ['era5'], 107: ['era5'], 108: [], 109: [], 110: ['gpm-imerg'],
  111: [], 112: [], 113: ['srtm-elevation'], 114: ['srtm-elevation'], 115: ['srtm-elevation'],
  116: [], 117: [], 118: [], 119: [], 120: ['noaa-space-weather'], 121: ['noaa-space-weather'],
  122: [], 123: ['srtm-elevation'], 124: ['srtm-elevation'], 125: [], 126: [], 127: [],
  128: ['noaa-space-weather'], 129: [], 130: [], 131: ['gldas-noah-2.1'], 132: ['gldas-noah-2.1'],
  133: ['gldas-noah-2.1'], 134: [], 135: ['usgs-earthquakes'], 136: [], 137: ['open-meteo-aq'],
  138: ['gpm-imerg'], 139: [], 140: [], 141: [], 142: [], 143: [], 144: [], 145: [], 146: [],
  147: [], 148: [], 149: [], 150: [],
};

export async function computeWithContext(
  id: number,
  inputs: Record<string, number>,
  context?: { studyArea?: StudyArea; time?: TimeContext; filters?: Record<string, unknown> },
): Promise<ContextResult | null> {
  if (!EQUATION_ENGINE[id]) return null;

  // QGIS-style: normalise incoming (Unicode-keyed) inputs to the engine's
  // stable ASCII parameter names so user overrides are honoured everywhere.
  const normInputs = normalizeInputs(id, inputs ?? {});

  const { lat, lon } = extractLocation(context?.studyArea);

  // Fetch all relevant data in parallel. Each fetcher is individually
  // wrapped in a safe-catch so that one failing data source (network
  // timeout, API rate-limit, or unavailable data sources never aborts the
  // entire computation. mapInputs() already provides physical fallback
  // values via ?? operators for every parameter.
  const FETCH_TIMEOUT_MS = 10000;
  const safe = <T>(p: Promise<T>, fb: T, timeoutMs?: number): Promise<T> =>
    Promise.race([
      p.then(v => (v == null && fb != null ? fb : v) as T).catch(() => fb),
      new Promise<T>(r => setTimeout(() => r(fb), timeoutMs ?? FETCH_TIMEOUT_MS)),
    ]);

  const dateStr = context?.time?.start || undefined;

  // CDS (ERA5) jobs take 15–120 s. Tools whose authentic inputs come from
  // ERA5 surface fluxes (Tool 17 Gill ocean heat budget) wait long enough
  // for the job to complete; every other tool keeps the default 10 s
  // window so overall responsiveness is unchanged.
  const ERA5_CONSUMER_IDS = new Set([5, 8, 17, 48, 49, 50, 52, 56, 59, 70, 71, 73, 74, 75, 77, 105, 106, 107]);
  const ERA5_TIMEOUT_MS = 150000;
  // GLDAS consumers may need the stream-halt fallback (HEAD binary search
  // for the latest published granule + one nc4 download — ~60–120 s worst
  // case when the NRT stream has halted, as observed 2026-08).
  const GLDAS_CONSUMER_IDS = new Set([8, 18, 43, 46, 47, 91, 130, 131, 132]);
  const GLDAS_TIMEOUT_MS = 150000;
  // IMERG precipitation consumers: 8-slot HDF5 download + h5wasm parse
  // takes ~120 s, so the default 30 s safe() timeout is too short.
  const IMERG_CONSUMER_IDS = new Set([10, 12, 18, 110]);
  const IMERG_TIMEOUT_MS = 150000;

  const [
    weather, marine, airQuality, earthquakes, elevation,
    soil, vegetation, seaIce, tectonic, spaceWeather,
    water, landCover, terrain, glacier, volcano,
    tropo, permafrost, drought, river, era5, imerg, gldas,
    rFactor, gpp, gppAnnual, co2, sst, pmelPco2,
    gddStation,
    slr, gebcoDepth, shorelineBearing,
  ] = await Promise.all([
    safe(
      context?.time?.granularity === 'range'
        ? fetchHistoricalWeather(lat, lon, context?.time?.start ?? '', context?.time?.end ?? '')
        : fetchCurrentWeather(lat, lon),
      {} as WeatherData,
    ),
    safe(fetchMarineData(lat, lon), {} as MarineData),
    safe(fetchAirQuality(lat, lon), {} as AirQualityData),
    safe(fetchEarthquakes(lat, lon, context?.time?.start ?? '', context?.time?.end ?? ''),
      { count: 0, maxMagnitude: 0, avgMagnitude: 0, avgDepth: 0, bValue: 1.0, aValue: 0, mcMagnitude: 2.5, omoriFit: null, events: [] } as EarthquakeData),
    safe(fetchElevation(lat, lon), { elevation: 0 } as ElevationData),
    safe(fetchSoilData(lat, lon),
      { clay: 0, sand: 0, silt: 0, organic_carbon: 0, ph_h2o: 0, bulk_density: 0, cec: 0, texture_class: 'unknown' } as SoilData,
      30000),
    safe(fetchVegetationIndices(lat, lon),
      { ndvi: 0, evi: 0, lai: Number.NaN, fpar: Number.NaN, landCover: 'unknown' } as VegetationData,
      30000),
    safe(fetchSeaIce(lat, lon), { concentration: 0, extent: 0, thickness: 0 } as SeaIceData),
    safe(fetchTectonicContext(lat, lon),
      { plateBoundary: false, faultProximity: 9999, subductionZone: false, riftZone: false, transformBoundary: false } as TectonicData),
    safe(fetchSpaceWeather(),
      { kpIndex: 0, dstIndex: 0, solarWindSpeed: 400, f107: 120, bZ: 0 } as SpaceWeatherData),
    safe(fetchWaterData(lat, lon),
      { streamflow: 0, gageHeight: 0, waterTemp: 0, conductivity: 0, dissolvedOxygen: 0 } as WaterData),
    safe(fetchLandCover(lat, lon),
      { class: 'unknown', code: 0, treeCover: 0, impervious: 0, cropland: 0, wetland: 0 } as LandCoverData),
    safe(fetchTerrain(lat, lon),
      { elevation: 0, slope: 0, aspect: 0, curvature: 0, hillshade: 0 } as TerrainData),
    safe(fetchGlacierData(lat, lon),
      { area: 0, volume: 0, massBalance: 0, equilibriumLine: 0 } as GlacierData),
    safe(fetchVolcanoData(lat, lon),
      { nearestVolcano: 'none', distance: 9999, alertLevel: 'unknown', recentActivity: false, lastEruption: 'unknown' } as VolcanoData),
    safe(fetchTropoDelay(lat, lon),
      { zenithDelay: 2.4, wetDelay: 0.1, hydrostaticDelay: 2.3 } as TropoData),
    safe(fetchPermafrostData(lat, lon),
      { activeLayerDepth: 0, permafrostProb: 0, groundTemp: 0 } as PermafrostData),
    safe(fetchDroughtData(lat, lon),
      { pdsi: 0, precipitation: 0, temperature: 0, soilMoisture: 0, droughtClass: 'unknown' } as DroughtData),
    safe((async () => {
      // USGS Water Services is occasionally slow under the ~30-way parallel
      // fetch load. Tools 13/90 (Muskingum, Nash cascade) drive Q₀ from the
      // discharge, so retry once with a generous timeout before falling back
      // to the honest-NaN path.
      if (id !== 13 && id !== 90) return { discharge: 0, velocity: 0, width: 0, depth: 0, slope: 0 } as RiverData;
      const d = await fetchRiverData(lat, lon).catch(() => null);
      if (d) return d;
      return fetchRiverData(lat, lon).catch(() => ({ discharge: 0, velocity: 0, width: 0, depth: 0, slope: 0 } as RiverData));
    })(), { discharge: 0, velocity: 0, width: 0, depth: 0, slope: 0 } as RiverData, 45000),
    safe(fetchEra5HighFidelity(lat, lon, dateStr, { mostOnly: id === 48 || id === 49 || id === 50, fluxOnly: id === 52 || id === 59, fluxDailyMean: id === 59,      windOnly: id === 56 || id === 73, waveOnly: id === 74 || id === 75 || id === 77, skip: id === 56 && normInputs.k != null }),
      { frictionVelocity: null, totalColumnWaterVapour: null, surfaceFluxes: null, pressureWind: null, pressureState: null, soilState: null, source: 'none' } as Era5HighFidelityData,
      ERA5_CONSUMER_IDS.has(id) ? ERA5_TIMEOUT_MS : undefined),
    safe(fetchImergPrecipitation(lat, lon, dateStr).then(r => r ?? { totalPrecipitation: null, maxIntensity: null, source: null } as ImergData),
      { totalPrecipitation: null, maxIntensity: null, source: null } as ImergData,
      IMERG_CONSUMER_IDS.has(id) ? IMERG_TIMEOUT_MS : undefined),
    safe(fetchGldasData(lat, lon, dateStr), {
      tkeDissipation: null, soilMoisture0_10: null, soilMoisture10_40: null,
      soilMoisture40_100: null, soilMoisture100_200: null, groundwaterStorage: null,
      snowWaterEquivalent: null, canopyInterception: null, surfaceTemp: null, granuleTime: null, source: null,
    } as GldasData, GLDAS_CONSUMER_IDS.has(id) ? GLDAS_TIMEOUT_MS : undefined),
    safe(fetchRFactor(lat, lon), null, 25000),
    // Tool 50 (Ball–Berry stomatal conductance): genuine photosynthesis
    // rate A from MODIS MOD17A2H GPP (ORNL DAAC) and leaf-surface CO₂ from
    // the NOAA GML global monthly mean. Both fetched for tool 50 only —
    // null when the study point has no valid data (e.g. ocean) and the
    // engine then returns an honest NaN.
    safe(id === 50 ? fetchGppModis(lat, lon, dateStr ?? undefined) : Promise.resolve(null), null, 30000),
    // Tool 53 (NEE): genuine ANNUAL GPP from MODIS MOD17A2H 8-day composites
    // summed over the most recent complete year (5 chunked ORNL requests).
    safe(id === 53 ? fetchAnnualGppModis(lat, lon, dateStr ? Number(dateStr.slice(0, 4)) : undefined) : Promise.resolve(null), null, 45000),
    // Tools 50/54/56 (stomatal conductance, FvCB, Wanninkhof flux): genuine
    // ambient CO₂ from NOAA GML (ci = 0.7 × ca; atmospheric pCO₂ for ΔpCO₂).
    safe(id === 50 || id === 54 || id === 56 ? fetchCo2Gml(dateStr ?? undefined) : Promise.resolve(null), null, 20000),
    // Tools 56/62: genuine SST from NCEI ERDDAP OISST v2 — for Tool 56 the
    // paper's Schmidt-number and solubility inputs; for Tool 62 (Eppley
    // 1972) the marine temperature T of the paper's Eq. (1)/Eq. (a).
    safe(id === 56 || id === 62 ? fetchSST(lat, lon).catch(() => null) : Promise.resolve(null), null, 30000),
    // Tool 56 (Wanninkhof 1992): nearest NOAA PMEL mooring pCO₂ sample
    // (measured pCO₂_sw / pCO₂_air for ΔpCO₂, plus co-located SST/SSS for
    // Sc and the Weiss solubility). Only for tool 56 — null when no mooring
    // is within 1000 km (inland / open-ocean gap) and the engine NaN-fires.
    safe(id === 56 ? fetchPmelPco2(lat, lon, dateStr).catch(() => null) : Promise.resolve(null), null, 45000),
    // Tool 58 (Growing Degree Days): genuine daily TMAX/TMIN from the
    // nearest GHCN-Daily station (NOAA ACIS, no key) — the paper's
    // "standard Class A weather station" daily max/min at 2 m. Null when
    // no reporting station is nearby and the engine then returns an
    // honest NaN. The ACIS API is occasionally slow under the parallel
    // fetch load, so retry once before giving up (the station series is
    // what powers the GDD timeseries chart).
    safe((async () => {
      // Tools 58/60 (GDD, Hargreaves): fetch the station's daily series over
      // the exact selected [start, end] time window so the accumulated GDD
      // reflects the user's chosen range verbatim. Retry once on transient
      // ACIS failure. Other tools don't consume the station series.
      if (id !== 58 && id !== 60) return null;
      const s = context?.time?.start || undefined;
      const e = context?.time?.end || undefined;
      let g = await fetchGddStationData(lat, lon, s, e).catch(() => null);
      if (!g) g = await fetchGddStationData(lat, lon, s, e).catch(() => null);
      return g;
    })(), null, 45000),
    // Tool 75 (Bruun 1962): genuine LOCAL relative sea-level rise rate —
    // OLS trend of the nearest NOAA CO-OPS tide-gauge monthly MSL series
    // (≥15 yr, NOAA's own credibility threshold). Null when no long gauge
    // record covers the point (foreign coast / open ocean) — the engine
    // then uses the documented GIA-corrected global altimetry rate
    // (~3.4 mm/yr, IPCC AR6 WGI Ch 9), clearly labelled as the global
    // rate in the steps; no static local constant is invented.
    safe(id === 75 ? fetchSeaLevelTrend(lat, lon) : Promise.resolve(null), null, 45000),
    // Tool 76 (McCowan 1894 breaker criterion): genuine GEBCO 2020
    // bathymetry at the study point — the paper's water-depth input d_b.
    // Land points / fetch failures yield an honest NaN auto value (no
    // static depth). Only fetched for tool 76.
    safe(id === 76 || id === 78 ? fetchGebcoDepth(lat, lon) : Promise.resolve(null), null, 30000),
    // Tool 77 (CERC longshore transport, SPM 1984): genuine local shoreline
    // bearing from GEBCO 2020 relief ring probes (positive = land, negative =
    // seafloor — the same source as the Tool 76 auto bathymetry, unambiguous
    // at coasts where SRTM's 0-m fill would misread water as land) — converts
    // the genuine ERA5 mean wave direction into the breaker angle α_b/α₀
    // relative to the shoreline (the paper's eqs 4-44/4-45 input). Null when
    // no resolvable coast is within the probe radius (open ocean) or on
    // fetch failure — the engine then NaN-fires honestly on the angle (no
    // fabricated orientation). Only fetched for tool 77.
    safe(id === 77 ? fetchShorelineBearing(lat, lon) : Promise.resolve(null), null, 25000),
  ]);

  const popData = await safe(fetchPopulation(lat, lon), { populationDensity: 0, totalPopulation: 0 });

  // Real satellite thermal data for LST (Rozenstein 2014) and related
  // remote-sensing tools that require Landsat brightness temperature,
  // surface temperature, or NDVI-derived emissivity. This is the actual
  // satellite data source the methodology requires — NOT a weather
  // proxy. When the NASA Earthdata token is absent or AppEEARS is
  // unreachable, satThermal is null and a proxy warning is raised
  // (rather than silently substituting weather air temperature).
  const satThermal = SAFE_THERMAL_TOOLS.has(id)
    ? await safe(fetchLandsatThermal(lat, lon, dateStr), null, 45000)
    : null;
  const columnWV = SAFE_THERMAL_TOOLS.has(id)
    ? await safe(fetchColumnWaterVapor(lat, lon, dateStr), null)
    : null;

  // Genuine tide prediction (Tool 14 — Pugh & Woodworth 2014 harmonic method
  // on real NOAA station constituents). Skipped for all other tools to avoid
  // extra API traffic.
  const tide: TidePredictionResult | null = id === 14
    ? await safe(fetchTidePrediction(lat, lon, dateStr ? new Date(dateStr) : undefined), null, 45000)
    : null;

  // Genuine focal mechanism for the Campbell–Bozorgnia (2014) GMPE
  // (Tool 21): moment-tensor product of the strongest recent event near the
  // study point. Also consumed by Tool 23 (scalar seismic moment M₀) and
  // Tool 24 (M₀ for the Brune stress drop).
  // Null when no event with a published mechanism exists — the
  // engine then reports honest NaN rather than a fabricated mechanism.
  const RUPTURE_CONSUMER_IDS = new Set([21, 23, 24]);
  const rupture: EarthquakeRupture | null = RUPTURE_CONSUMER_IDS.has(id)
    ? await safe(fetchNearestEarthquakeRupture(lat, lon, context?.time?.start ?? '', context?.time?.end ?? ''), null, 20000)
    : null;

  // Genuine NASA FIRMS active-fire detections (Tool 32): measured
  // fire-pixel brightness temperatures and Wooster-method FRP values.
  // Null when no fires are detected or the FIRMS API is unreachable —
  // the engine then reports honest NaN (no fabricated fire temperature).
  const fire = id === 32
    ? await safe(fetchFIRMSFires(lat, lon, 50), null, 25000)
    : null;

  // Genuine spatial observation network for interpolation tools
  // (37 kriging / 38 IDW): real per-station coordinates + latest values
  // from the USGS NWIS instantaneous network over the study bbox (or a
  // ±0.5° window around a point). Null / empty when too few stations
  // report — the engine then returns honest NaN instead of fabricated
  // sample values.
  const INTERP_OBSERVER_IDS = new Set([37, 38, 42]);
  let interpObs: { obs: import('../data/dataFetchers').StationObs[]; paramCd: string; unit: string } | null = null;
  if (INTERP_OBSERVER_IDS.has(id)) {
    const saInterp = context?.studyArea;
    const [[oLatMin, oLonMin], [oLatMax, oLonMax]] =
      saInterp?.bbox && saInterp.bbox[1][0] > saInterp.bbox[0][0] && saInterp.bbox[1][1] > saInterp.bbox[0][1]
        ? saInterp.bbox
        : [[lat - 0.5, lon - 0.5], [lat + 0.5, lon + 0.5]];
    interpObs = await safe(fetchStationObservations(oLatMin, oLonMin, oLatMax, oLonMax), null, 90000);
  }

  const ctx = {
    weather, marine, airQuality, earthquakes, elevation,
    soil, vegetation, seaIce, tectonic, spaceWeather,
    water, landCover, terrain, glacier, volcano,
    tropo, permafrost, drought, river, era5, imerg, gldas,
    rFactor, gpp, gppAnnual, co2,
    sst, pmelPco2, gddStation, slr, gebcoDepth, shorelineBearing,
    satThermal, columnWV,
    tide, rupture,
    fire,
    interpObs,
    lat, lon,
    studyArea: context?.studyArea,
  };

  const enrichedInputs = alignInputs(id, mapInputs(id, normInputs, { ...ctx, pop: popData, filters: context?.filters as Record<string, unknown> | undefined }));
  const computeFn = EQUATION_ENGINE[id];
  if (!computeFn) return null;
  const baseResult = computeFn(enrichedInputs);
  if (!baseResult) return null;

  const warnings: string[] = [];
  const log: string[] = [];
  log.push(` Computed equation #${id} at (${lat.toFixed(3)}, ${lon.toFixed(3)})`);
  // Surface satellite-data provenance and proxy warnings injected by
  // remote-sensing mapInputs cases (e.g. Eq 1 LST).
  const _satSource = enrichedInputs.__satSource as string | undefined;
  const _satAcq = enrichedInputs.__satAcquired as string | undefined;
  const bt11Source = enrichedInputs.__bt11Source as string | undefined;
  const proxyWarning = enrichedInputs.__proxyWarning as string | undefined;
  if (proxyWarning) {
    warnings.push(proxyWarning);
    log.push(`  WARNING: ${proxyWarning}`);
  }
  baseResult.steps?.forEach(s => log.push(`  • ${s}`));
  if (!Number.isFinite(baseResult.result)) {
    warnings.push('Result is non-finite (NaN/Inf). Verify input ranges and units.');
    log.push(' WARNING: non-finite result');
  }

  // Determine which data sources were actually used — ONLY the categories the
  // tool's mapInputs case genuinely consumes (exact sources, not everything
  // that fetched). A tool like Gumbel (pure math) shows no data sources.
  const consumed = new Set(TOOL_SOURCES[id] ?? []);
  const uses = (cat: string) => consumed.has(cat);
  const sources: string[] = [];
  if (weather.temperature_2m !== undefined && uses('open-meteo-weather')) sources.push('open-meteo-weather');
  if (marine.wave_height !== undefined && uses('open-meteo-marine')) sources.push('open-meteo-marine');
  if (airQuality.pm2_5 !== undefined && uses('open-meteo-aq')) sources.push('open-meteo-aq');
  if (earthquakes.count > 0 && uses('usgs-earthquakes')) sources.push('usgs-earthquakes');
  if (elevation.elevation !== 0 && uses('srtm-elevation')) sources.push('srtm-elevation');
  if (soil.clay > 0 && uses('isric-soilgrids')) sources.push('isric-soilgrids');
  if (vegetation.ndvi > 0 && uses('modis-vegetation')) sources.push('modis-vegetation');
  if (tectonic.plateBoundary && uses('usgs-tectonic')) sources.push('usgs-tectonic');
  if (spaceWeather.kpIndex > 0 && uses('noaa-space-weather')) sources.push('noaa-space-weather');
  // Satellite thermal/reflectance provenance (Eq 1 LST and remote-sensing tools)
  if (_satSource && uses('landsat-c2l2-st')) {
    sources.push(_satSource);
    log.push(`  Satellite data: ${_satSource}${_satAcq ? ` (acquired ${_satAcq})` : ''}`);
  }
  if (bt11Source && uses('landsat-c2l2-st')) {
    sources.push(bt11Source === 'measured' ? 'usgs-c2-l1-b11' : 'landsat-b11-forwardmodel');
    log.push(`  Band-11 BT: ${bt11Source === 'measured' ? 'measured C2 L1 radiance (USGS/ERS)' : 'forward-modeled from single-channel atmosphere'}`);
  }
  if (satThermal && uses('landsat-c2l2-st')) sources.push('landsat-c2l2-st');
  if (columnWV != null && uses('era5')) sources.push('era5-column-water-vapor');
  if (era5.frictionVelocity != null && uses('era5')) sources.push(era5.source === 'cds' ? 'era5-cds-friction-velocity' : 'era5-proxy-friction-velocity');
  if (era5.totalColumnWaterVapour != null && uses('era5')) sources.push('era5-tcwv');
  if (era5.surfaceFluxes && uses('era5')) sources.push(era5.source === 'cds' ? 'era5-cds-surface-fluxes' : 'era5-proxy-surface-fluxes');
  if (era5.pressureWind && uses('era5')) sources.push('era5-pressure-wind');
  if (era5.wind10m != null && (id === 56 || id === 73) && uses('era5')) sources.push(era5.source === 'cds' ? 'era5-cds-wind10m' : 'era5-proxy-wind10m');
  if (era5.pressureState && uses('era5')) sources.push('era5-pressure-state');
  if (era5.soilState && uses('era5')) sources.push('era5-soil-state');
  if (imerg.source && uses('gpm-imerg')) sources.push(imerg.source);
  if (gldas.source && uses('gldas-noah-2.1')) sources.push('gldas-noah-2.1');
  if (rFactor && uses('ghcn-climate-normals-r-factor')) sources.push(`ghcn-climate-normals-r-factor`);
  if (gpp && uses('modis-mod17a2h')) sources.push('modis-mod17a2h-gpp');
  if (gppAnnual && uses('modis-mod17a2h')) sources.push('modis-mod17a2h-annual-gpp');
  if (co2 && uses('noaa-gml-co2')) sources.push('noaa-gml-co2');
  if (sst && uses('noaa-oisst-v2')) sources.push('noaa-oisst-v2');
  if (pmelPco2 && uses('noaa-pmel-co2-mooring')) sources.push(`noaa-pmel-co2-mooring:${pmelPco2.station}`);
  if (slr && uses('noaa-coops-sea-level-trend')) sources.push(`noaa-coops-sea-level-trend:${slr.stationId}`);
  if ((id === 76 || id === 78) && gebcoDepth && gebcoDepth.depth > 0 && uses('gebco-2020-bathymetry')) sources.push('gebco-2020-bathymetry');
  if (id === 77 && era5?.source === 'cds' && era5?.waveHeight != null && uses('era5')) sources.push('cds-era5-wave');
  if (gddStation && uses('ghcn-daily')) sources.push(`ghcn-daily:${gddStation.station}`);
  if (id === 77 && shorelineBearing != null) sources.push('gebco-2020-shoreline');
  if (id === 75 && (terrain.slope > 0 || terrain.elevation > 0)) sources.push('srtm30m-terrain');
  if (tide) sources.push(tide.source);
  if (interpObs && interpObs.obs.length > 0) sources.push(`usgs-nwis-observations:${interpObs.paramCd}`);

  // Run the complete 7-stage scientific workflow
  const validationRules = Object.entries(enrichedInputs).map(([k, v]) => ({
    param: k,
    ...(typeof v === 'number' ? { min: -Infinity, max: Infinity } : {}),
  }));
  const workflow = runToolWorkflow(id, baseResult, enrichedInputs, validationRules, sources, { lat, lon });

  const result: ContextResult = {
    ...baseResult,
    dataSource: sources.length > 0 ? sources.join(', ') : 'user-provided',
    fetchedParams: {
      weather: { temp: weather.temperature_2m, rh: weather.relative_humidity_2m, wind: weather.wind_speed_10m },
      elevation: elevation.elevation,
      soil: { clay: soil.clay, sand: soil.sand },
      seismic: { count: earthquakes.count, maxMag: earthquakes.maxMagnitude },
      vegetation: { ndvi: vegetation.ndvi, evi: vegetation.evi },
      marine: { waveHeight: marine.wave_height, wavePeriod: marine.wave_period },
      airQuality: { pm25: airQuality.pm2_5, aqi: airQuality.european_aqi },
      // Real satellite TIRS band temperatures when available (Rozenstein
      // split-window tools expose these as secondary outputs).
      ...(satThermal?.bt10 != null ? { T10: satThermal.bt10 } : {}),
      ...(satThermal?.bt11 != null ? { T11: satThermal.bt11 } : {}),
      location: { lat, lon },
    },
    location: { lat, lon },
    log: [...log, ...workflow.workflowLog],
    warnings: [...warnings, ...workflow.validation.warnings, ...workflow.qualityControl.checks.filter(c => !c.passed && c.severity !== 'info').map(c => c.message)],
    validation: workflow.validation,
    qualityControl: workflow.qualityControl,
    uncertainty: workflow.uncertainty,
    interpretation: workflow.interpretation,
    workflowLog: workflow.workflowLog,
    dataQualityScore: workflow.dataQualityScore,
    processingTimeMs: workflow.processingTimeMs,
    visualizationType: getToolConfig(id).visualizationType,
    preprocessingNotes: getToolConfig(id).preprocessingNotes,
  };

  // QGIS-style spatial output: sweep the equation across the study-area
  // bounding box, varying location-dependent parameters (and terrain), to
  // produce a real raster grid instead of a single flat value. Triggered for
  // any bbox-mode study area (a drawn study area defaults tools to bbox mode
  // so the IDW overlay is produced), and masked to the drawn shape's interior
  // when polygon rings are supplied. Explicit single-point selection stays a
  // single point (no polygon is sent in that case).
  //
  // Spatial tools (heatmap/contour/vector) produce a genuine field grid. Pure
  // scalar tools are single-value by physics — sweeping them over 784 cells
  // yields an ~flat rectangle (no information, wasted compute), so the grid is
  // skipped and only the labelled point value is rendered.
  const sa = context?.studyArea;
  const gridViz = ['heatmap', 'contour', 'vector'];
  const vizType = getToolConfig(id).visualizationType;
  if (gridViz.includes(vizType) && sa && sa.bbox && (sa.mode === 'bbox' || (sa.polygon && sa.polygon.length > 0))) {
    const [[latMin, lonMin], [latMax, lonMax]] = sa.bbox;
    if (latMax > latMin && lonMax > lonMin) {
      const grid = await buildSpatialGrid(id, normInputs, { ...ctx, pop: popData, __satDate: dateStr }, latMin, latMax, lonMin, lonMax, sa.polygon);
      if (grid) {
        result.grid = grid;
        if (grid.hasNaN) warnings.push('Some grid cells produced non-finite values (clamped in display).');
      }
    }
  }

  return result;
}

// Short-TTL memoization for grid sample fetches (elevation + weather). A single
// execute samples 36 points; without this, concurrent executes fire hundreds of
// identical Open-Meteo requests per burst and get rate-limited, silently
// falling back to constants. Keyed by rounded lat/lon so nearby grids reuse.
const gridSampleCache = new Map<string, { at: number; value: unknown }>();
const GRID_SAMPLE_TTL_MS = 5 * 60 * 1000;
const memoizedFetch = async <T>(key: string, fetcher: () => Promise<T>): Promise<T> => {
  const hit = gridSampleCache.get(key);
  if (hit && Date.now() - hit.at < GRID_SAMPLE_TTL_MS) return hit.value as T;
  const val = await fetcher();
  // Only cache successful results — a transient null (network error, rate
  // limit) must not poison the grid for the next 5 minutes.
  if (val != null) gridSampleCache.set(key, { at: Date.now(), value: val });
  return val;
};

/**
 * Builds a spatial grid for a bounding box by evaluating the equation at each
 * cell centre. Location-dependent parameters (Coriolis parameter, etc.), a
 * bilinearly-interpolated terrain elevation, and real observed weather
 * (Open-Meteo, fetched at 36 sample points in one batched request) are
 * varied per cell so the output reflects real spatial structure where the
 * equation is location-sensitive.
 */
async function buildSpatialGrid(
  id: number,
  normInputs: Record<string, number>,
  ctx: Record<string, unknown>,
  latMin: number, latMax: number, lonMin: number, lonMax: number,
  polygon?: Array<Array<[number, number]>>,
): Promise<GridResult | null> {
  const nLat = 28, nLon = 28;
  const ELEV_N = 6;

  // When a drawn polygon/circle study area is supplied, only cells whose
  // centre lies inside the outer ring are computed; everything else is masked
  // to NaN so the IDW overlay hugs the drawn shape instead of its bbox.
  const outerRing = polygon && polygon.length > 0 ? polygon[0] : undefined;
  const pointInPolygon = (lon: number, lat: number): boolean => {
    if (!outerRing || outerRing.length < 3) return true;
    let inside = false;
    for (let i = 0, j = outerRing.length - 1; i < outerRing.length; j = i++) {
      const [xi, yi] = outerRing[i];
      const [xj, yj] = outerRing[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };

  // Coarse elevation + weather sampling for terrain/weather-based spatial
  // variation. Real observed values (Open-Meteo) are fetched at each sample
  // point via ONE multi-point request per dataset (36 points in a single
  // call), then bilinearly interpolated per cell — observed data throughout,
  // no synthetic lapse-rate assumptions.
  const sampleLats: number[] = [];
  const sampleLons: number[] = [];
  for (let i = 0; i < ELEV_N; i++) {
    const lat = latMin + (latMax - latMin) * (i / (ELEV_N - 1));
    for (let j = 0; j < ELEV_N; j++) {
      sampleLats.push(lat);
      sampleLons.push(lonMin + (lonMax - lonMin) * (j / (ELEV_N - 1)));
    }
  }
  const [elevFlat, wxFlat] = await Promise.all([
    memoizedFetch(`elev:${sampleLats.join(',')}|${sampleLons.join(',')}`, () => fetchElevationsMulti(sampleLats, sampleLons))
      .catch(() => sampleLats.map(() => ({ elevation: 0 }))),
    memoizedFetch(`wx:${sampleLats.join(',')}|${sampleLons.join(',')}`, () => fetchCurrentWeatherMulti(sampleLats, sampleLons))
      .catch(() => sampleLats.map(() => ({}) as WeatherData)),
  ]);
  // Tool 47 (de Vries soil conductivity): genuine per-point ISRIC SoilGrids
  // sampled on a coarse 4×4 lattice with nearest-valid-neighbor assignment
  // (soil texture is categorical — bilinear interpolation across a masked
  // boundary would be physically meaningless). ISRIC rate-limits, so the
  // 16 fetches run with modest concurrency, failures degrade to null and
  // the cell computes an honest NaN (no centre-point fabricate).
  const SOIL_N = 4;
  const soilSamples: (SoilData | null)[][] | null = id === 47
    ? await (async () => {
        const soilLats: number[] = [], soilLons: number[] = [];
        for (let i = 0; i < SOIL_N; i++)
          for (let j = 0; j < SOIL_N; j++) {
            soilLats.push(latMin + (latMax - latMin) * (i / (SOIL_N - 1)));
            soilLons.push(lonMin + (lonMax - lonMin) * (j / (SOIL_N - 1)));
          }
        const out: (SoilData | null)[] = new Array(SOIL_N * SOIL_N).fill(null);
        let head = 0;
        await Promise.all(new Array(4).fill(0).map(async () => {
          for (; head < soilLats.length; head++) {
            const idx = head;
            try {
              out[idx] = await memoizedFetch(
                `soil:${soilLats[idx].toFixed(4)},${soilLons[idx].toFixed(4)}`,
                () => fetchSoilData(soilLats[idx], soilLons[idx]),
              );
            } catch { out[idx] = null; }
          }
        }));
        const g: (SoilData | null)[][] = [];
        for (let i = 0; i < SOIL_N; i++) {
          const row: (SoilData | null)[] = [];
          for (let j = 0; j < SOIL_N; j++) row.push(out[i * SOIL_N + j]);
          g.push(row);
        }
        return g;
      })()
    : null;
  const soilAt = (lat: number, lon: number): SoilData | null => {
    if (!soilSamples) return null;
    let best: SoilData | null = null, bestD = Infinity;
    for (let i = 0; i < SOIL_N; i++)
      for (let j = 0; j < SOIL_N; j++) {
        const s = soilSamples[i][j];
        if (!s) continue;
        const slat = latMin + (latMax - latMin) * (i / (SOIL_N - 1));
        const slon = lonMin + (lonMax - lonMin) * (j / (SOIL_N - 1));
        const d = (slat - lat) * (slat - lat) + (slon - lon) * (slon - lon);
        if (d < bestD) { bestD = d; best = s; }
      }
    return best;
  };
  const elevSamples: number[][] = [];
  const wxSamples: WeatherData[][] = [];
  for (let i = 0; i < ELEV_N; i++) {
    const row: number[] = [];
    const wxRow: WeatherData[] = [];
    for (let j = 0; j < ELEV_N; j++) {
      row.push(elevFlat[i * ELEV_N + j].elevation);
      wxRow.push(wxFlat[i * ELEV_N + j]);
    }
    elevSamples.push(row);
    wxSamples.push(wxRow);
  }
  const elevAt = (lat: number, lon: number): number => {
    const fi = ((lat - latMin) / (latMax - latMin || 1)) * (ELEV_N - 1);
    const fj = ((lon - lonMin) / (lonMax - lonMin || 1)) * (ELEV_N - 1);
    const i0 = Math.max(0, Math.min(ELEV_N - 1, Math.floor(fi)));
    const j0 = Math.max(0, Math.min(ELEV_N - 1, Math.floor(fj)));
    const i1 = Math.min(ELEV_N - 1, i0 + 1), j1 = Math.min(ELEV_N - 1, j0 + 1);
    const ti = fi - i0, tj = fj - j0;
    const v00 = elevSamples[i0][j0], v01 = elevSamples[i0][j1];
    const v10 = elevSamples[i1][j0], v11 = elevSamples[i1][j1];
    return (v00 * (1 - ti) + v10 * ti) * (1 - tj) + (v01 * (1 - ti) + v11 * ti) * tj;
  };
  // Derive per-cell terrain slope/aspect (Horn 1981) from the sampled elevation
  // grid — gives terrain-driven field tools (stream power, SPI, TWI, USLE,
  // Stockdon runup) a genuinely varying slope instead of repeating the
  // centre-point value (which produced a flat 28×28 grid).
  const midLatRad = ((latMin + latMax) / 2) * Math.PI / 180;
  const dLatM = ((latMax - latMin) / (ELEV_N - 1)) * 111320;
  const dLonM = ((lonMax - lonMin) / (ELEV_N - 1)) * 111320 * Math.cos(midLatRad);
  const terrainAt = (lat: number, lon: number): TerrainData => {
    const fi = ((lat - latMin) / (latMax - latMin || 1)) * (ELEV_N - 1);
    const fj = ((lon - lonMin) / (lonMax - lonMin || 1)) * (ELEV_N - 1);
    const ci = Math.max(1, Math.min(ELEV_N - 2, Math.round(fi)));
    const cj = Math.max(1, Math.min(ELEV_N - 2, Math.round(fj)));
    const e = (di: number, dj: number): number => elevSamples[ci + di]?.[cj + dj] ?? elevAt(lat, lon);
    const dzdx = ((e(-1, 1) + 2 * e(0, 1) + e(1, 1)) - (e(-1, -1) + 2 * e(0, -1) + e(1, -1))) / (8 * Math.max(dLonM, 1e-6));
    const dzdy = ((e(1, -1) + 2 * e(1, 0) + e(1, 1)) - (e(-1, -1) + 2 * e(-1, 0) + e(-1, 1))) / (8 * Math.max(dLatM, 1e-6));
    const slope = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
    const aspectRaw = Math.atan2(dzdy, -dzdx) * 180 / Math.PI;
    return {
      elevation: elevAt(lat, lon),
      slope: Number.isFinite(slope) ? slope : Number.NaN,
      aspect: Number.isFinite(aspectRaw) ? ((aspectRaw % 360) + 360) % 360 : Number.NaN,
      curvature: (ctx.terrain as TerrainData | undefined)?.curvature ?? Number.NaN,
      hillshade: (ctx.terrain as TerrainData | undefined)?.hillshade ?? Number.NaN,
    };
  };
  // Bilinear interpolation of real observed weather per cell.
  const weatherAt = (lat: number, lon: number): WeatherData => {
    const fi = ((lat - latMin) / (latMax - latMin || 1)) * (ELEV_N - 1);
    const fj = ((lon - lonMin) / (lonMax - lonMin || 1)) * (ELEV_N - 1);
    const i0 = Math.max(0, Math.min(ELEV_N - 1, Math.floor(fi)));
    const j0 = Math.max(0, Math.min(ELEV_N - 1, Math.floor(fj)));
    const i1 = Math.min(ELEV_N - 1, i0 + 1), j1 = Math.min(ELEV_N - 1, j0 + 1);
    const ti = fi - i0, tj = fj - j0;
    const lerp = (k: keyof WeatherData): number | undefined => {
      const a = wxSamples[i0][j0][k], b = wxSamples[i0][j1][k];
      const c = wxSamples[i1][j0][k], d = wxSamples[i1][j1][k];
      if (a == null || b == null || c == null || d == null) return undefined;
      const r1 = (a as number) * (1 - ti) + (c as number) * ti;
      const r2 = (b as number) * (1 - ti) + (d as number) * ti;
      return r1 * (1 - tj) + r2 * tj;
    };
    return {
      temperature_2m: lerp('temperature_2m'),
      relative_humidity_2m: lerp('relative_humidity_2m'),
      apparent_temperature: lerp('apparent_temperature'),
      precipitation: lerp('precipitation'),
      pressure_msl: lerp('pressure_msl'),
      surface_pressure: lerp('surface_pressure'),
      wind_speed_10m: lerp('wind_speed_10m'),
      wind_direction_10m: lerp('wind_direction_10m'),
      wind_gusts_10m: lerp('wind_gusts_10m'),
      cloud_cover: lerp('cloud_cover'),
      shortwave_radiation: lerp('shortwave_radiation'),
      direct_radiation: lerp('direct_radiation'),
      diffuse_radiation: lerp('diffuse_radiation'),
      direct_normal_irradiance: lerp('direct_normal_irradiance'),
      cape: lerp('cape'),
      precipitation_probability: lerp('precipitation_probability'),
      et0_fao_evapotranspiration: lerp('et0_fao_evapotranspiration'),
    };
  };

  // Per-cell satellite sampling for thermal tools: one windowed COG read per
  // band, true per-cell BT/ST values (not the centre-point pixel repeated).
  const lats: number[] = [];
  const lons: number[] = [];
  for (let r = 0; r < nLat; r++) lats.push(latMin + (latMax - latMin) * (r / (nLat - 1)));
  for (let c = 0; c < nLon; c++) lons.push(lonMin + (lonMax - lonMin) * (c / (nLon - 1)));
  const satGrid = SAFE_THERMAL_TOOLS.has(id)
    ? await memoizedFetch(
      `sat:${id}:${latMin.toFixed(3)},${latMax.toFixed(3)},${lonMin.toFixed(3)},${lonMax.toFixed(3)}|${(ctx as Record<string, unknown>).__satDate ?? ''}`,
      async () => {
        // The C2 L2 windowed read + measured C2 L1 B11 window are network-bound
        // and can transiently return null. Retry a few times before giving up
        // so the grid doesn't silently collapse to the centre-point broadcast.
        for (let attempt = 0; attempt < 3; attempt++) {
          const g = await fetchLandsatThermalGrid(
            lats, lons, (ctx as Record<string, unknown>).__satDate as string | undefined,
          ).catch(() => null);
          if (g) return g;
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
        return null;
      },
    )
    : null;
  const satCellAt = (r: number, c: number): import('../data/satelliteThermal').LandsatThermalData | null =>
    satGrid ? (satGrid.cells[r * nLon + c] ?? null) : ((ctx as Record<string, unknown>).satThermal as import('../data/satelliteThermal').LandsatThermalData | null ?? null);

  const values: number[] = new Array(nLat * nLon);
  let vmin = Infinity, vmax = -Infinity, hasNaN = false;
  for (let r = 0; r < nLat; r++) {
    const lat = lats[r];
    for (let c = 0; c < nLon; c++) {
      const lon = lons[c];
      try {
        if (!pointInPolygon(lon, lat)) { values[r * nLon + c] = NaN; hasNaN = true; continue; }
        const cellCtx = { ...ctx, lat, lon, elevation: { elevation: elevAt(lat, lon) }, weather: weatherAt(lat, lon), terrain: terrainAt(lat, lon) };
        if (id === 47) {
          const cellSoil = soilAt(lat, lon);
          if (cellSoil) (cellCtx as Record<string, unknown>).soil = cellSoil;
        }
        if (SAFE_THERMAL_TOOLS.has(id)) (cellCtx as Record<string, unknown>).satThermal = satCellAt(r, c);
        // Interpolation tools (37 kriging / 38 IDW): the grid IS the
        // prediction surface — each cell targets its own coordinate. An
        // explicit tlat/tlon would otherwise repeat one point across the
        // whole bbox (flat grid).
        let cellNorm = normInputs;
        if (id === 37 || id === 38) {
          cellNorm = { ...normInputs };
          delete (cellNorm as Record<string, unknown>).tlat;
          delete (cellNorm as Record<string, unknown>).tlon;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cellInputs = alignInputs(id, mapInputs(id, cellNorm, cellCtx as any));
        const res = EQUATION_ENGINE[id](cellInputs);
        let v = res?.result;
        if (typeof v !== 'number' || !Number.isFinite(v)) { v = NaN; hasNaN = true; }
        values[r * nLon + c] = v;
        if (Number.isFinite(v)) { if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
      } catch {
        values[r * nLon + c] = NaN;
        hasNaN = true;
      }
    }
  }
  return {
    latMin, latMax, lonMin, lonMax, nLat, nLon, values,
    valueMin: Number.isFinite(vmin) ? vmin : 0,
    valueMax: Number.isFinite(vmax) ? vmax : 0,
    hasNaN,
  };
}
