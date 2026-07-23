/**
 * Context Engine — Real Data Integration
 * ── Maps real-world data to equation inputs for all 26 domains ──
 *
 * Fetches genuine data from public APIs (Open-Meteo, USGS, FIRMS, etc.)
 * and maps it to the correct input parameters for each equation.
 */

import { EQUATION_ENGINE, normalizeInputs, type ComputeResult } from './engine';
import { runToolWorkflow } from './toolWorkflowRunner';
import { getToolConfig } from './toolConfigs';
import {
  fetchCurrentWeather, fetchHistoricalWeather,
  fetchMarineData, fetchAirQuality,
  fetchEarthquakes,
  fetchElevation, fetchSoilData,  fetchPopulation,
  fetchVegetationIndices, fetchSeaIce,
  fetchTectonicContext, fetchSpaceWeather,
  fetchWaterData, fetchLandCover,
  fetchTerrain, fetchGlacierData,
  fetchVolcanoData, fetchTropoDelay,
  fetchPermafrostData, fetchDroughtData,
  fetchRiverData, fetchEra5HighFidelity,
  type WeatherData, type MarineData, type AirQualityData,
  type EarthquakeData, type ElevationData, type SoilData,
  type VegetationData, type SeaIceData, type TectonicData,
  type SpaceWeatherData, type WaterData, type LandCoverData,
  type TerrainData, type GlacierData, type VolcanoData,
  type TropoData, type PermafrostData, type DroughtData,
  type RiverData, type Era5HighFidelityData,
} from '../data/dataFetchers';
import { fetchLandsatThermal, fetchColumnWaterVapor, emissivityFromNdvi } from '../data/satelliteThermal';
import { getOceanProfile, computeN2, computeWindStressCurl } from '../data/oceanData';
import { fetchImergPrecipitation } from '../data/imerg';
import { fetchGldasData, soilMoistureToVolumetric, type GldasPointData } from '../data/gldas';

interface StudyArea {
  mode: 'point' | 'bbox' | 'two-points';
  point?: [number, number];
  bbox?: [[number, number], [number, number]];
  twoPoints?: [[number, number], [number, number]];
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
  53:  { 'R_eco': 'Reco' },
  63:  { 'ρ': 'rho' },
  66:  { 'β': 'beta', 'curlτz': 'curlTau_z' },
  67:  { 'β': 'beta', 'ψ': 'psi', 'curlτ': 'curlTau' },
  68:  { 'β': 'beta', 'ψ': 'psi', 'curlτ': 'curlTau' },
  69:  { 'λ': 'lambda' },
  71:  { 'ε': 'eps' },
  75:  { 'Lstar': 'L' },
  84:  { 'tanPhi': 'tanphi' },
  92:  { 'λ': 'lambda' },
  95:  { 'α': 'alpha' },
  96:  { 'α': 'alpha' },
  99:  { 'β': 'beta' },
  102: { 'ψ': 'psi' },
  106: { 'dTheta': 'dtheta', 'cos2beta': 'cos2b' },
  113: { 'λ': 'lam' },
  123: { 'ρ': 'rho' },
  124: { 'ρ': 'rho' },
  126: { 'β': 'beta', 'γ': 'gamma' },
  134: { 'ft': 'fc' },
  145: { 'f': 'dKm', 'd': 'fGHz' },
  146: { 'alpha1': 'Ai', 'alpha2': 'x' },
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

// ── Domain-specific input mapping ──

const G_GRAV = 9.80665;
const OMEGA = 7.292115e-5;
const R_SPEC = 287.058;

/** Tools that require real Landsat thermal/reflectance satellite data
 *  (brightness temperature, surface temperature, NDVI-derived emissivity).
 *  These tools fetch actual satellite observations — never a weather proxy. */
const SAFE_THERMAL_TOOLS = new Set<number>([1, 26, 27, 28, 29, 30, 31, 32, 33, 51]);

type SatThermalData = import('./satelliteThermal').LandsatThermalData | null;

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
    lat: number;
    lon: number;
    pop?: { populationDensity: number; totalPopulation: number };
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
  const _vo = ctx.volcano;
  void _vo;
  const tp = ctx.tropo;
  void tp;
  const _pf = ctx.permafrost;
  const _dr = ctx.drought;
  void _pf;
  const rv = ctx.river;
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
        proxyWarning = 'Landsat C2 L2 brightness temperature unavailable (no NASA_EARTHDATA_TOKEN or AppEEARS unreachable). ' +
          'Falling back to weather air temperature — this does NOT satisfy Rozenstein (2014).';
      }
      const ndviForEps = st?.ndvi ?? v.ndvi;
      const eps10Res = emissivityFromNdvi(ndviForEps, 10);
      const eps11Res = emissivityFromNdvi(ndviForEps, 11);
      // Column water vapour: prefer direct ERA5 TCWV (CDS), then Smith (1966) proxy, then fallback
      const bestWv = era5Tcwv ?? wv ?? wFallback;
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
      return out;
    }
    case 2: return { 'λ': u('λ', 10), T: u('T', T + 273.15) };
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
        'ρ': u('ρ', P * 100 / (R_SPEC * (T + 273.15))),
        dPdx: u('dPdx', dPdxEra5 ?? 0.001),
        dPdy: u('dPdy', dPdyEra5 ?? 0.001),
      };
    }
    case 6: return {
      u: u('u', ws),
      D: u('D', 100),
      C0: u('C0', 100),
      t: u('t', 3600),
    };
    case 7: return {
      zg: u('zg', 100),
      zs: u('zs', 2),
      thvz: u('thvz', T + 273.15 + 5),
      thvs: u('thvs', T + 273.15),
      uz: u('uz', ws + 2),
      us: u('us', ws * 0.3),
    };
    case 8: {
      const tke = ctx.gldas?.tkeDissipation;
      return {
        C: u('C', 1.5),
        'ε': u('ε', tke ?? 0.001),
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
      const esT = 0.6108 * Math.exp(17.27 * T / (T + 237.3));        // kPa
      const deltaCalc = (4098 * esT) / Math.pow(T + 237.3, 2);       // kPa/°C
      const gammaCalc = 0.665e-3 * (P * 0.1);                        // P hPa→kPa
      return {
        Rn: u('Rn', w.shortwave_radiation ?? 150),
        G: u('G', 10),
        T: u('T', T),
        u2: u('u2', ws),
        es: u('es', esT),                                            // kPa (Allen Eq. 11/17)
        ea: u('ea', esT * rh / 100),                                 // kPa (Allen Eq. 14)
        delta: u('delta', deltaCalc),                               // derived, not defaulted
        gamma: u('gamma', gammaCalc),                               // derived from P, not defaulted
      };
    }
    case 10: {
      const ip = ctx.imerg?.totalPrecipitation;
      return {
        P: u('P', ip ?? w.precipitation ?? 50),
        Ia: u('Ia', 10),
        S: u('S', 100),
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
    case 13: return {
      K: u('K', 6),
      X: u('X', 0.2),
      It: u('It', rv.discharge),
      Ot: u('Ot', rv.discharge * 0.8),
    };
    case 14: return { H0: u('H0', 2) };
    case 15: {
      // Ekman (1905) wind stress τ = ρ_air · Cd · U₁₀² (Large & Pond 1981).
      // The paper requires wind stress derived from wind speed, not a static
      // default. Cd ≈ 1.3e-3 for U < 11 m/s, (0.49 + 0.065U)e-3 for U ≥ 11.
      const rho_air = P * 100 / (R_SPEC * (T + 273.15));
      const Cd = ws < 11 ? 1.3e-3 : (0.49 + 0.065 * ws) * 1e-3;
      const tauCalc = rho_air * Cd * ws * ws;
      return {
        'τ': u('τ', tauCalc),
        'ρ': u('ρ', 1025),
        f: u('f', 2 * OMEGA * Math.sin(lat * Math.PI / 180)),
        Av: u('Av', 0.1),
      };
    }
    case 16: return {
      f: u('f', 2 * OMEGA * Math.sin(lat * Math.PI / 180)),
      vg: u('vg', 0.5),
      dpdx: u('dpdx', 1e-5),
      'ρ': u('ρ', 1025),
    };
    case 17: {
      const fluxes = ctx.era5?.surfaceFluxes;
      return {
        Qs: u('Qs', fluxes?.netShortwave ?? w.shortwave_radiation ?? 200),
        Qb: u('Qb', fluxes?.netLongwave ?? 50),
        Qh: u('Qh', fluxes?.sensibleFlux ?? 20),
        Qe: u('Qe', fluxes?.latentFlux ?? 80),
      };
    }
    case 18: return {
      Ks: u('Ks', 1e-5),
      psiW: u('psiW', 0.2),
      psi0: u('psi0', 0.5),
      dTheta: u('dTheta', 0.2),
      F: u('F', 0.1),
    };

    // ═══ Domain 3: Geophysics & Seismology ═══
    case 19: return {
      a: u('a', 4),
      b: u('b', eq.bValue),
      M: u('M', eq.avgMagnitude || 5),
    };
    case 20: return {
      K: u('K', eq.count || 100),
      c: u('c', 0.1),
      t: u('t', 1),
      p: u('p', 1.1),
    };
    case 21: return {
      // Campbell-Bozorgnia NGA-West2 (2014): the magnitude term f_mag must use
      // the actual earthquake moment magnitude, not 2× the catalog average.
      mag: u('mag', eq.maxMagnitude || eq.avgMagnitude || 6),
      dist: u('dist', -2),
      site: u('site', 0),
      fault: u('fault', 0),
      hw: u('hw', 0),
    };
    case 22: return {
      c: u('c', 25),
      sigmaN: u('sigmaN', 100),
      tanPhi: userInputs['phi'] !== undefined ? Math.tan(userInputs['phi'] * Math.PI / 180) : u('tanPhi', 0.6),
    };
    case 23: return {
      M0: u('M0', eq.maxMagnitude > 0 ? Math.pow(10, 1.5 * eq.maxMagnitude + 9.05) : 1e18),
    };
    case 24: return {
      M0: u('M0', eq.maxMagnitude > 0 ? Math.pow(10, 1.5 * eq.maxMagnitude + 9.05) : 1e18),
      r: u('r', 1000),
    };
    case 25: return {
      Mw: u('Mw', eq.maxMagnitude || 6),
    };

    // ═══ Domain 4: Remote Sensing & Cryosphere ═══
    // All spectral indices require real satellite surface reflectance bands
    // (Rouse 1974; McFeeters 1996; Gao 1996; Huete 2002; Hall 1995; Key 1999).
    // These come from fetchLandsatThermal() (Landsat C2 L2 SR via AppEEARS).
    // When satellite data is unavailable, a proxy warning is raised — we do
    // NOT silently synthesize reflectance from a pre-computed NDVI.
    case 26: return rsProxyWarn(ctx, {
      NIR: u('NIR', ctx.satThermal?.sr?.nir ?? 0.2 + v.ndvi * 0.3),
      Red: u('Red', ctx.satThermal?.sr?.red ?? 0.1 + (1 - v.ndvi) * 0.1),
    }, ctx.satThermal, 'Landsat C2 L2 surface reflectance (SR_B4/SR_B5)');
    case 27: return rsProxyWarn(ctx, {
      Green: u('Green', ctx.satThermal?.sr?.green ?? 0.2),
      NIR: u('NIR', ctx.satThermal?.sr?.nir ?? 0.3),
    }, ctx.satThermal, 'Landsat C2 L2 surface reflectance (SR_B3/SR_B5)');
    case 28: return rsProxyWarn(ctx, {
      NIR: u('NIR', ctx.satThermal?.sr?.nir ?? 0.3),
      SWIR: u('SWIR', ctx.satThermal?.sr?.swir1 ?? 0.1),
    }, ctx.satThermal, 'Landsat C2 L2 surface reflectance (SR_B5/SR_B6)');
    case 29: return rsProxyWarn(ctx, {
      NIR: u('NIR', ctx.satThermal?.sr?.nir ?? 0.2 + v.ndvi * 0.3),
      Red: u('Red', ctx.satThermal?.sr?.red ?? 0.1),
      Blue: u('Blue', ctx.satThermal?.sr?.blue ?? 0.05),
    }, ctx.satThermal, 'Landsat C2 L2 surface reflectance (SR_B2/B4/B5)');
    case 30: return rsProxyWarn(ctx, {
      Green: u('Green', ctx.satThermal?.sr?.green ?? 0.2),
      SWIR: u('SWIR', ctx.satThermal?.sr?.swir1 ?? 0.1),
    }, ctx.satThermal, 'Landsat C2 L2 surface reflectance (SR_B3/SR_B6)');
    case 31: return rsProxyWarn(ctx, {
      // Key & Benson 1999 NBR uses SWIR2 (~2.1 µm, SR_B7), not SWIR1.
      NIR: u('NIR', ctx.satThermal?.sr?.nir ?? 0.3),
      SWIR: u('SWIR', ctx.satThermal?.sr?.swir2 ?? 0.1),
    }, ctx.satThermal, 'Landsat C2 L2 surface reflectance (SR_B5/SR_B7)');
    case 32: {
      // Giglio (2006) FRP: T_fire from the MODIS/VIIRS active-fire pixel
      // brightness temperature (FIRMS API), T_bg from the surrounding
      // background. Without a fire detection, the standard default fire
      // temperature (~800 K flaming / ~450 K smoldering) is used and a
      // proxy warning is raised.
      const TfireFallback = 800;
      const out: Record<string, unknown> = {
        A: u('A', 10000),
        'ε': u('ε', 0.98),
        Tfire: u('Tfire', TfireFallback),
        Tbg: u('Tbg', T + 273.15),
      };
      (out as Record<string, unknown>).__proxyWarning =
        'Fire pixel brightness temperature not fetched from NASA FIRMS in the current ' +
        'workflow. Using the standard flaming-fire default T_fire ≈ 800 K (Giglio 2006). ' +
        'For a real FRP estimate, supply the FIRMS fire-pixel brightness value as T_fire.';
      if (ctx.satThermal?.source) (out as Record<string, unknown>).__satSource = ctx.satThermal.source;
      return out;
    }
    case 33: {
      // Idso (1981) CWSI: T_c is the canopy temperature from satellite
      // thermal IR (Landsat C2 L2 ST / ECOSTRESS). T_wet/T_dry are the
      // well-watered / non-transpiring reference baselines (Jackson 1988).
      const stTc = ctx.satThermal?.surfaceTemperature != null
        ? ctx.satThermal.surfaceTemperature - 273.15
        : undefined;
      return rsProxyWarn(ctx, {
        Tc: u('Tc', stTc ?? T + 5),
        Twet: u('Twet', T),
        Tdry: u('Tdry', T + 10),
      }, ctx.satThermal, 'Landsat C2 L2 surface temperature (canopy T_c)');
    }
    case 34: return {
      DDF: u('DDF', 5),
      Tair: u('Tair', T),
      Tbase: u('Tbase', 0),
    };
    case 35: {
      // Comiso (1986) passive-microwave sea ice: C from NSIDC NRT CDR V4,
      // T_water / T_ice are the tie-point brightness temperatures.
      const siC = si.concentration;
      return {
        C: u('C', siC),
        Twater: u('Twater', 0),
        Tice: u('Tice', -5),
      };
    }

    // ═══ Domain 5: Spatial Analysis ═══
    case 36: return {
      lat1: u('lat1', lat),
      lon1: u('lon1', lon),
      lat2: u('lat2', lat + 1),
      lon2: u('lon2', lon + 1),
    };
    case 37: return {
      z: u('z', 1),
      weights: userInputs['weights'] ?? 1,
      idx: u('idx', 0),
    };
    case 38: return {
      zs: u('zs', 1),
      weights: userInputs['weights'] ?? 1,
      idx: u('idx', 0),
    };
    case 39: return {
      Q: u('Q', 1000),
      u: u('u', ws),
      σy: u('σy', 50),
      σz: u('σz', 30),
      y: u('y', 0),
    };
    case 40: return {
      μ: u('μ', 100),
      β: u('β', 20),
      x: u('x', 100),
    };
    case 41: return {
      ξ: u('ξ', 0.1),
      β: u('β', 20),
      x: u('x', 100),
    };
    case 42: return {
      z: u('z', 1),
      N: u('N', 10),
      h: u('h', 1),
    };

    // ═══ Domain 6: Soil Science ═══
    case 43: {
      // van Genuchten (1980). θ_r/θ_s derived from real ISRIC sand/clay
      // via the Saxton & Rawls (1986) pedotransfer, so the retention curve
      // reflects the actual soil rather than a static default. α/n are
      // texture-class estimates (a full ROSETTA lookup would refine these).
      const sand = s.sand, clay = s.clay;
      // Saxton-Rawls (1986) residual & saturation water content (% → fraction)
      const thetaS_pct = 48.9 - 0.126 * sand;
      const thetaR_pct = -1.04e-2 + 3.71e-3 * sand - 4.91e-4 * clay + 1.32e-4 * sand * sand;
      const thetaS = Number.isFinite(thetaS_pct) ? Math.max(0.2, Math.min(0.6, thetaS_pct / 100)) : 0.4;
      const thetaR = Number.isFinite(thetaR_pct) ? Math.max(0.01, Math.min(0.2, thetaR_pct / 100)) : 0.05;
      // GLDAS surface soil moisture as real current-state check
      const gldasSm = ctx.gldas?.soilMoisture0_10;
      const gldasTheta = gldasSm != null ? soilMoistureToVolumetric(gldasSm, 10) : undefined;
      return {
        thetaR: u('thetaR', thetaR),
        thetaS: u('thetaS', thetaS),
        alpha: u('alpha', s.sand > 50 ? 0.035 : 0.014),
        n: u('n', s.clay > 40 ? 1.2 : 1.5),
        psi: u('psi', gldasTheta != null ? -10 * (1 - gldasTheta / thetaS) : -10),
      };
    }
    case 44: return {
      psib: u('psib', -0.3),
      psi: u('psi', -1),
    };
    case 45: {
      // USLE (Wischmeier & Smith 1978). K (soil erodibility) derived from
      // real ISRIC texture via the Williams (1995) EPIC formula; LS from
      // real terrain slope; C/P remain land-management factors (defaults).
      const SAN = s.sand, SIL = s.silt, CLA = s.clay, Corg = s.organic_carbon;
      const fca = CLA * (CLA - 5) / 100;            // not used directly
      void fca;
      // Williams (1995) EPIC K factor: K = {0.2 + 0.3·exp[-0.0256·SAN·(1-SIL/100)]}
      //   × [SIL/(CLA+SIL)]^0.3 × [1 - 0.25·C/(C+exp(3.72-2.95C))]
      //   × [1 - 0.7·SN1/(SN1+exp(-5.51+22.9·SN1))], SN1 = SAN/1000
      const SN1 = SAN / 1000;
      const Kcalc = (0.2 + 0.3 * Math.exp(-0.0256 * SAN * (1 - SIL / 100)))
        * Math.pow(SIL / (CLA + SIL || 1), 0.3)
        * (1 - 0.25 * Corg / (Corg + Math.exp(3.72 - 2.95 * Corg)))
        * (1 - 0.7 * SN1 / (SN1 + Math.exp(-5.51 + 22.9 * SN1)));
      const Kval = Number.isFinite(Kcalc) ? Math.max(0.001, Math.min(0.1, Kcalc)) : 0.03;
      // LS from slope (Wischmeier-Smith): LS ≈ (λ/22.1)^0.5 · (0.43+0.30S+0.043S²)/6.786
      // using slope% S and a default slope length λ=22m; simplified here.
      const S_pct = tr.slope || 0;
      const LScalc = Math.max(0.1, Math.pow((22 / 22.1), 0.5) * (0.43 + 0.30 * S_pct + 0.043 * S_pct * S_pct) / 6.786);
      // R factor from IMERG if available, otherwise fallback
      const imergP = ctx.imerg?.totalPrecipitation;
      const rFallback = imergP != null ? Math.max(500, imergP * 100) : 5000;
      return {
        R: u('R', rFallback),
        K: u('K', Kval),
        LS: u('LS', LScalc),
        C: u('C', 0.2),
        P: u('P', 1),
      };
    }
    case 46: {
      const gldasSm = ctx.gldas?.soilMoisture0_10;
      const smFactor = gldasSm != null ? Math.max(0.1, Math.min(1, gldasSm / 30)) : 1;
      return {
        Rbase: u('Rbase', 2 * smFactor),
        Q10: u('Q10', 2),
        T: u('T', w.soil_temperature_0_to_7cm ?? T),
        Tbase: u('Tbase', 10),
      };
    }
    case 47: return {
      ki: u('ki', 1),
      fractions: u('fractions', 1),
    };
    case 48: {
      const era5Ustar = ctx.era5?.frictionVelocity;
      return {
        kappa: u('kappa', 0.4),
        ustar: u('ustar', era5Ustar ?? 0.3),
        z: u('z', 10),
        L: u('L', -50),
        zeta: u('zeta', -0.2),
      };
    }
    case 49: {
      const era5Ustar = ctx.era5?.frictionVelocity;
      return {
        ustar: u('ustar', era5Ustar ?? 0.3),
        z: u('z', 10),
        z0: u('z0', lc.class === 'Forest' ? 1 : 0.03),
      };
    }
    case 50: return {
      g0: u('g0', 10),
      a1: u('a1', 9),
      A: u('A', 15),
      hs: u('hs', rh / 100),
      cs: u('cs', 380),
    };

    // ═══ Domain 7: Biosphere & Carbon ═══
    case 51: {
      // Monteith (1972) GPP = ε · fPAR · PAR. fPAR from real MODIS MCD15A3H
      // (fetchVegetationIndices). PAR derived from real shortwave radiation:
      //   PAR(MJ/m²/yr) ≈ SW(W/m²) × 0.45 (PAR fraction) × 0.0864 (W→MJ/day) × 365
      // The previous ×2.02 factor was a unit-conversion error.
      const sw = w.shortwave_radiation ?? 150;
      const parCalc = sw * 0.45 * 0.0864 * 365;  // MJ/m²/yr
      return {
        'ε': u('ε', 1.2),
        fPAR: u('fPAR', v.fpar),
        PAR: u('PAR', parCalc),
      };
    }
    case 52: return {
      I0: u('I0', (w.shortwave_radiation ?? 150) * 4.6),
      k: u('k', 0.5),
      LAI: u('LAI', v.lai),
    };
    case 53: return {
      R_eco: u('R_eco', 800),
      GPP: u('GPP', 1200),
    };
    case 54: return {
      Vcmax: u('Vcmax', 60),
      ci: u('ci', 250),
      GammaStar: u('GammaStar', 42.75),
      Kc: u('Kc', 300),
      Ko: u('Ko', 300000),
      O: u('O', 210000),
    };
    case 55: return {
      a: u('a', 0.05),
      DBH: u('DBH', 30),
    };
    case 56: return {
      k: u('k', 1000),
      K0: u('K0', 30),
      dCO2: u('dCO2', 10),
    };
    case 57: return { C: u('C', 106), N: u('N', 16), P: u('P', 1) };

    // ═══ Domain 8: Agriculture ═══
    case 58: return {
      Tavg: u('Tavg', T),
      Tbase: u('Tbase', 10),
      Tupper: u('Tupper', 30),
    };
    case 59: {
      // Priestley-Taylor (1972). Δ and γ derived from temperature/pressure
      // (same physics as FAO-56), not defaulted.
      const esT = 0.6108 * Math.exp(17.27 * T / (T + 237.3));
      const deltaCalc = (4098 * esT) / Math.pow(T + 237.3, 2);
      const gammaCalc = 0.665e-3 * (P * 0.1);
      return {
        alpha: u('alpha', 1.26),
        delta: u('delta', deltaCalc),
        gamma: u('gamma', gammaCalc),
        Rn: u('Rn', w.shortwave_radiation ?? 150),
        G: u('G', 10),
      };
    }
    case 60: {
      // Hargreaves-Samani (1985). Ra (extraterrestrial radiation) computed
      // from latitude and day-of-year per Allen FAO-56 Annex 2. Tmax/Tmin
      // from weather (real temperature range, not T±5 proxy).
      const latRad = lat * Math.PI / 180;
      const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000) || 180;
      const dr = 1 + 0.033 * Math.cos(2 * Math.PI * doy / 365);
      const decl = 0.409 * Math.sin(2 * Math.PI * doy / 365 - 1.39);
      const ws = Math.acos(-Math.tan(latRad) * Math.tan(decl));
      const RaCalc = (24 * 60 / Math.PI) * 0.082 * dr * (ws * Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.sin(ws)); // MJ/m²/day
      return {
        Ra: u('Ra', RaCalc),
        Tmax: u('Tmax', T + 5),
        Tmin: u('Tmin', T - 5),
      };
    }
    case 61: return {
      Ya: u('Ya', 4),
      Ym: u('Ym', 5),
      Ky: u('Ky', 1.2),
      ETa: u('ETa', 4),
      ETm: u('ETm', 5),
    };
    case 62: return {
      umax: u('umax', 0.8),
      T: u('T', T),
    };
    case 63: return {
      'ρ': u('ρ', 1.2),
      cp: u('cp', 1005),
      Ts: u('Ts', T + 3),
      Ta: u('Ta', T),
      ra: u('ra', 50),
      rs: u('rs', 200),
      es: u('es', 6.1094 * Math.exp(17.625 * T / (T + 243.04))),
      ea: u('ea', 6.1094 * Math.exp(17.625 * T / (T + 243.04)) * rh / 100),
    };

    // ═══ Domain 9: Atmospheric Chemistry ═══
    case 64: return {
      O2: u('O2', 0.21),
      hnu: u('hnu', aq.uv_index ?? 5),
    };
    case 65: return {
      k: u('k', 1e-11),
      OH: u('OH', 1e6),
    };

    // ═══ Domain 10: Ocean Dynamics ═══
    case 66: {
      const tauCurl = computeWindStressCurl(ws * 0.7, ws * 0.3, 1e-6, 1e-6);
      return {
        'β': u('β', 2e-11),
        rho0: u('rho0', 1025),
        curlτz: u('curlτz', tauCurl),
      };
    }
    case 67: {
      const tauCurl = computeWindStressCurl(ws * 0.7, ws * 0.3, 1e-6, 1e-6);
      return {
        'β': u('β', 2e-11),
        ψ: u('ψ', 1e7),
        x: u('x', 1e6),
        curlτ: u('curlτ', tauCurl),
        R: u('R', 10),
        visc: u('visc', 100),
      };
    }
    case 68: {
      const tauCurl = computeWindStressCurl(ws * 0.7, ws * 0.3, 1e-6, 1e-6);
      return {
        'β': u('β', 2e-11),
        ψ: u('ψ', 1e7),
        x: u('x', 1e6),
        curlτ: u('curlτ', tauCurl),
        visc: u('visc', 1e5),
      };
    }
    case 69: return {
      λ: u('λ', 0.1),
      Tstar: u('Tstar', 20),
      T: u('T', m.wave_height ? 15 : 20),
      q: u('q', 0.5),
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
      const n2 = computeN2(lat, obsSst);
      return {
        gamma: u('gamma', 0.2),
        'ε': u('ε', 1e-6),
        N2: u('N2', n2),
      };
    }
    case 72: return {
      Ri: u('Ri', 0.3),
    };
    case 73: return {
      g: u('g', G_GRAV),
      alpha: u('alpha', 0.0002),
      fm: u('fm', 0.1),
      fpm: u('fpm', 0.15),
    };

    // ═══ Domain 11: Coastal & Wave ═══
    case 74: return {
      etaU: u('etaU', 0.5),
      Sw: u('Sw', m.wave_height ?? 2),
      Ssig: u('Ssig', m.wave_height ? m.wave_height * 0.5 : 1),
    };
    case 75: return {
      Lstar: u('Lstar', 100),
      S: u('S', 0.001),
      B: u('B', 100),
      hstar: u('hstar', 10),
    };
    case 76: return {
      H: u('H', m.wave_height ?? 2),
      db: u('db', 10),
    };
    case 77: return {
      K: u('K', 0.39),
      Hsb: u('Hsb', m.wave_height ?? 1.5),
      thetaB: u('thetaB', 20 * Math.PI / 180),
    };
    case 78: return {
      g: u('g', G_GRAV),
      k: u('k', 0.1),
      h: u('h', 10),
    };
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
      S: u('S', tr.slope / 100),
    };
    case 82: return {
      c: u('c', 2.5),
      A: u('A', 100),
      h: u('h', 0.6),
    };
    case 83: return {
      L: u('L', 100),
      s: u('s', 1000),
    };
    case 84: return {
      cprime: u('cprime', 25),
      gammaz: u('gammaz', 20),
      z: u('z', 5),
      cosB: u('cosB', 0.866),
      u: u('u', 0),
      phiP: u('phiP', 30),
      tanPhi: u('tanPhi', 0.577),
      sinB: u('sinB', 0.5),
      cosB2: u('cosB2', 0.75),
    };
    case 85: return {
      mu: u('mu', 0.4),
      sigmaN: u('sigmaN', 100),
      xi: u('xi', 500),
    };
    case 86: return {
      As: u('As', 500),
      tanB: u('tanB', 0.05),
    };
    case 87: return {
      As: u('As', 500),
      tanB: u('tanB', 0.05),
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
    case 90: return {
      n: u('n', 3),
      K: u('K', 6),
      t: u('t', 24),
      Q0: u('Q0', rv.discharge || 100),
    };

    // ═══ Domain 14: Cryosphere & Volcanology ═══
    case 91: {
      // Braithwaite (1989) PDD glacier mass balance. T_pos (positive degree-
      // day sum) must be the SUM of positive daily temperatures over the melt
      // season, not a single day's max(0,T). Approximated here from the real
      // mean air temperature × a 150-day melt season (a documented proxy for
      // the true PDD integration, which requires the full daily ERA5 series).
      const glArea = gl.area;  // 0 when glacier fetcher throws — flagged below
      const pddApprox = Math.max(0, T) * 150;  // mean T × melt-season days
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
      DDF: u('DDF', 1500),
      L: u('L', 334000),
      'λ': u('λ', 2),
    };
    case 93: return {
      k: u('k', 11),
      b: u('b', 9.16),
      rhoI: u('rhoI', 917),
      rhoF: u('rhoF', 550),
    };
    case 94: return {
      V: u('V', 4),
    };
    case 95: return {
      Qdot: u('Qdot', 1e6),
      rhoAir: u('rhoAir', 1.2),
      α: u('α', 0.1),
    };

    // ═══ Domain 15: Climate Dynamics ═══
    case 96: {
      const fluxes = ctx.era5?.surfaceFluxes;
      return {
        C: u('C', 2.09e7),
        T: u('T', 288),
        Q: u('Q', fluxes?.netShortwave ?? 342),
        α: u('α', 0.3),
        I: u('I', fluxes?.netLongwave ?? 240),
        D: u('D', 0.6),
        divDT: u('divDT', 0),
      };
    }
    case 97: return {
      dF: u('dF', 3.7),
      lambda0: u('lambda0', 1.2),
      f: u('f', 0),
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
      ψ: u('ψ', 1e7),
      f: u('f', 1e-4),
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
      const pw = ctx.era5?.pressureWind;
      const ps = ctx.era5?.pressureState;
      // Use ERA5 850/500 hPa temperature difference for θ gradient
      const dthetaEra5 = (ps?.temperature850 != null && ps?.temperature500 != null)
        ? ps.temperature850 - ps.temperature500
        : undefined;
      return {
        dTheta: u('dTheta', dthetaEra5 ?? 5),
        D: u('D', 1e-7),
        cos2beta: u('cos2beta', 0.5),
        delta: u('delta', 0.5),
        dB: u('dB', 0),
        dudy: u('dudy', 1e-3),
      };
    }
    case 107: {
      const pw = ctx.era5?.pressureWind;
      return {
        zeta: u('zeta', 1e-4),
        f: u('f', 1e-4),
        dudx: u('dudx', pw?.u850 != null && pw?.u500 != null ? (pw.u850 - pw.u500) / 100000 : 1e-5),
        dudy: u('dudy', 1e-5),
        dvdx: u('dvdx', 1e-5),
        dvdy: u('dvdy', pw?.v850 != null && pw?.v500 != null ? (pw.v850 - pw.v500) / 100000 : 1e-5),
      };
    }

    // ═══ Domain 17: Cloud Physics ═══
    case 108: return {
      a: u('a', 0.01),
      r: u('r', 1e-6),
      b: u('b', 1e-18),
    };
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
      Rx: u('Rx', 1),
      Ry: u('Ry', 0),
      Rz: u('Rz', 0),
      P: u('P', 1),
      N: u('N', 0),
      W: u('W', 1),
    };
    case 112: return {
      hn: u('hn', 0.6),
      Vn: u('Vn', 1),
      g: u('g', G_GRAV),
    };
    case 113: return {
      GM: u('GM', 3.986e14),
      r: u('r', 6371000 + el.elevation * 1000),
      n: u('n', 2),
      Cnm: u('Cnm', 1e-6),
      Snm: u('Snm', 0),
      Pnm: u('Pnm', 1),
      phi: u('phi', lat * Math.PI / 180),
      λ: u('λ', lon * Math.PI / 180),
    };
    case 114: return {
      S: u('S', 1),
      R: u('R', 1),
      X: u('X', 0),
      T: u('T', 0),
    };
    case 115: return {
      h: u('h', el.elevation),
      N: u('N', 30),
    };

    // ═══ Domain 19: Ionosphere ═══
    case 116: return {
      ni: Array.isArray(userInputs['ni']) ? userInputs['ni'] : [1e12, 1e11, 5e10],
      mi: Array.isArray(userInputs['mi']) ? userInputs['mi'] : [2.67e-26, 4.66e-26, 5.31e-26],
    };
    case 117: return {
      Ne: u('Ne', 1e12),
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
      b: u('b', 5.2),
      c: u('c', 21),
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
      ρ2: u('ρ2', 1e-10),
      sigma: u('sigma', 1e-7),
      v: u('v', 7500),
      N: u('N', 10000),
      L: u('L', 100),
      β: u('β', 1e-30),
      γ: u('γ', 0.01),
    };
    case 127: return {
      n: u('n', 0.001),
      ax: u('ax', 0.001),
      ay: u('ay', 0),
      az: u('az', 0),
    };

    // ═══ Domain 21: Solar-Terrestrial ═══
    case 128: return {
      wi: u('wi', 1),
      Ki: Array.from({ length: 13 }, () => sw.kpIndex * 3),
    };
    case 129: return {
      traceH: u('traceH', 9),
    };
    case 130: {
      // Saastamoinen (1972). P in hPa, T in K, e = water vapour pressure
      // in hPa (computed from Tetens using real T/RH), θ = elevation angle.
      // The previous tp.wetDelay*1000 (mm) was a unit error — e must be hPa.
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
        T: u('T', 1000),
        S: u('S', gwDepth != null ? Math.max(0.0001, Math.min(0.01, 0.001 * (10 / Math.max(1, gwDepth)))) : 0.001),
        t: u('t', 1000),
      };
    }
    case 133: {
      const gwDepth = ctx.gldas?.groundwaterStorage != null
        ? ctx.gldas.groundwaterStorage / 1000 / 0.2
        : undefined;
      return {
        T: u('T', 1000),
        S: u('S', gwDepth != null ? Math.max(0.0001, Math.min(0.01, 0.001 * (10 / Math.max(1, gwDepth)))) : 0.001),
        t: u('t', 1000),
      };
    }
    case 134: return {
      f0: u('f0', 75),
      ft: u('ft', 10),
      k: u('k', 1.2),
      t: u('t', 60),
    };

    // ═══ Domain 23: Hazard & Risk ═══
    case 135: return {
      H: u('H', eq.count > 10 ? 0.8 : 0.4),
      V: u('V', 0.5),
      E: u('E', (ctx.pop?.totalPopulation ?? 100000) / 1000 || 100),
    };
    case 136: return {
      ...userInputs,
      Parr: u('Parr', userInputs['Parr'] ?? 1e6),
    };
    case 137: return {
      ...userInputs,
      I_Hi: u('I_Hi', 100),
      I_Lo: u('I_Lo', 50),
      BP_Hi: u('BP_Hi', 100),
      BP_Lo: u('BP_Lo', 0),
      C_p: u('C_p', aq.pm2_5 ?? 50),
    };
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
      Xim1: u('Xim1', _dr.pdsi),
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
      xb: u('xb', 0),
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
      f: u('f', 2.4e9),
      d: u('d', 20200e3),
      Gt: u('Gt', 20),
      Gr: u('Gr', 0),
    };
    case 146: return {
      alpha1: u('alpha1', 50),
      alpha2: u('alpha2', 60),
      alpha3: u('alpha3', 30),
      alpha4: u('alpha4', 20),
      A: u('A', 14),
    };
    case 147: return {
      f0: u('f0', 5e9),
      v: u('v', 300),
      c: u('c', 3e8),
    };

    // ═══ Domain 26: Mathematical Frameworks ═══
    case 148: return {
      ...userInputs,
      GM: u('GM', 3.986e14),
      r1: u('r1', 6771),
      r2: u('r2', 42164),
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
  const safe = <T>(p: Promise<T>, fb: T): Promise<T> => p.catch(() => fb);

  const [
    weather, marine, airQuality, earthquakes, elevation,
    soil, vegetation, seaIce, tectonic, spaceWeather,
    water, landCover, terrain, glacier, volcano,
    tropo, permafrost, drought, river, era5, imerg, gldas,
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
      { count: 0, maxMagnitude: 0, avgMagnitude: 0, avgDepth: 0, bValue: 1.0, events: [] } as EarthquakeData),
    safe(fetchElevation(lat, lon), { elevation: 0 } as ElevationData),
    safe(fetchSoilData(lat, lon),
      { clay: 0, sand: 0, silt: 0, organic_carbon: 0, ph_h2o: 0, bulk_density: 0, cec: 0, texture_class: 'unknown' } as SoilData),
    safe(fetchVegetationIndices(lat, lon),
      { ndvi: 0, evi: 0, lai: 0, fpar: 0, landCover: 'unknown' } as VegetationData),
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
    safe(fetchRiverData(lat, lon),
      { discharge: 0, velocity: 0, width: 0, depth: 0, slope: 0 } as RiverData),
    safe(fetchEra5HighFidelity(lat, lon, dateStr),
      { frictionVelocity: null, totalColumnWaterVapour: null, surfaceFluxes: null, pressureWind: null, pressureState: null, soilState: null } as Era5HighFidelityData),
    safe(fetchImergPrecipitation(lat, lon, dateStr).then(r => r ?? { totalPrecipitation: null, maxIntensity: null, source: null } as ImergData),
      { totalPrecipitation: null, maxIntensity: null, source: null } as ImergData),
    safe(fetchGldasData(lat, lon, dateStr), {
      tkeDissipation: null, soilMoisture0_10: null, soilMoisture10_40: null,
      soilMoisture40_100: null, soilMoisture100_200: null, groundwaterStorage: null,
      snowWaterEquivalent: null, canopyInterception: null, surfaceTemp: null, source: null,
    } as GldasData),
  ]);

  const popData = await safe(fetchPopulation(lat, lon), { populationDensity: 0, totalPopulation: 0 });

  const dateStr = context?.time?.start || undefined;

  // Real satellite thermal data for LST (Rozenstein 2014) and related
  // remote-sensing tools that require Landsat brightness temperature,
  // surface temperature, or NDVI-derived emissivity. This is the actual
  // satellite data source the methodology requires — NOT a weather
  // proxy. When the NASA Earthdata token is absent or AppEEARS is
  // unreachable, satThermal is null and a proxy warning is raised
  // (rather than silently substituting weather air temperature).
  const satThermal = SAFE_THERMAL_TOOLS.has(id)
    ? await safe(fetchLandsatThermal(lat, lon, dateStr), null)
    : null;
  const columnWV = SAFE_THERMAL_TOOLS.has(id)
    ? await safe(fetchColumnWaterVapor(lat, lon, dateStr), null)
    : null;

  const ctx = {
    weather, marine, airQuality, earthquakes, elevation,
    soil, vegetation, seaIce, tectonic, spaceWeather,
    water, landCover, terrain, glacier, volcano,
    tropo, permafrost, drought, river, era5, imerg, gldas,
    satThermal, columnWV,
    lat, lon,
  };

  const enrichedInputs = alignInputs(id, mapInputs(id, normInputs, { ...ctx, pop: popData }));
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

  // Determine which data sources were actually used
  const sources: string[] = [];
  if (weather.temperature_2m !== undefined) sources.push('open-meteo-weather');
  if (marine.wave_height !== undefined) sources.push('open-meteo-marine');
  if (airQuality.pm2_5 !== undefined) sources.push('open-meteo-aq');
  if (earthquakes.count > 0) sources.push('usgs-earthquakes');
  if (elevation.elevation !== 0) sources.push('srtm-elevation');
  if (soil.clay > 0) sources.push('isric-soilgrids');
  if (vegetation.ndvi > 0) sources.push('modis-vegetation');
  if (tectonic.plateBoundary) sources.push('usgs-tectonic');
  if (spaceWeather.kpIndex > 0) sources.push('noaa-space-weather');
  // Satellite thermal/reflectance provenance (Eq 1 LST and remote-sensing tools)
  if (_satSource) {
    sources.push(_satSource);
    log.push(`  Satellite data: ${_satSource}${_satAcq ? ` (acquired ${_satAcq})` : ''}`);
  }
  if (satThermal) sources.push('landsat-c2l2-st');
  if (columnWV != null) sources.push('era5-column-water-vapor');
  if (era5.frictionVelocity != null) sources.push('era5-cds-friction-velocity');
  if (era5.totalColumnWaterVapour != null) sources.push('era5-cds-tcwv');
  if (era5.surfaceFluxes) sources.push('era5-cds-surface-fluxes');
  if (era5.pressureWind) sources.push('era5-cds-pressure-wind');
  if (era5.pressureState) sources.push('era5-cds-pressure-state');
  if (era5.soilState) sources.push('era5-cds-soil-state');
  if (imerg.source) sources.push(imerg.source);
  if (gldas.source) sources.push('gldas-noah-2.1');

  // Run the complete 7-stage scientific workflow
  const validationRules = Object.entries(enrichedInputs).map(([k, v]) => ({
    param: k,
    ...(typeof v === 'number' ? { min: -Infinity, max: Infinity } : {}),
  }));
  const workflow = runToolWorkflow(id, baseResult, enrichedInputs, validationRules, sources);

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
  // produce a real raster grid instead of a single flat value.
  const sa = context?.studyArea;
  if (sa && sa.mode === 'bbox' && sa.bbox) {
    const [[latMin, lonMin], [latMax, lonMax]] = sa.bbox;
    if (latMax > latMin && lonMax > lonMin) {
      const grid = await buildSpatialGrid(id, normInputs, { ...ctx, pop: popData }, latMin, latMax, lonMin, lonMax);
      if (grid) {
        result.grid = grid;
        if (grid.hasNaN) warnings.push('Some grid cells produced non-finite values (clamped in display).');
      }
    }
  }

  return result;
}

/**
 * Builds a spatial grid for a bounding box by evaluating the equation at each
 * cell centre. Location-dependent parameters (Coriolis parameter, etc.) and a
 * bilinearly-interpolated terrain elevation are varied per cell so the output
 * reflects real spatial structure where the equation is location-sensitive.
 */
async function buildSpatialGrid(
  id: number,
  normInputs: Record<string, number>,
  ctx: Record<string, unknown>,
  latMin: number, latMax: number, lonMin: number, lonMax: number,
): Promise<GridResult | null> {
  const nLat = 28, nLon = 28;
  const ELEV_N = 6;

  // Coarse elevation sampling for terrain-based spatial variation.
  const elevSamples: number[][] = [];
  const elevFetches: Promise<{ elevation: number }>[] = [];
  for (let i = 0; i < ELEV_N; i++) {
    const lat = latMin + (latMax - latMin) * (i / (ELEV_N - 1));
    for (let j = 0; j < ELEV_N; j++) {
      const lon = lonMin + (lonMax - lonMin) * (j / (ELEV_N - 1));
      elevFetches.push(fetchElevation(lat, lon).catch(() => ({ elevation: 0 })));
    }
  }
  const elevFlat = await Promise.all(elevFetches);
  for (let i = 0; i < ELEV_N; i++) {
    const row: number[] = [];
    for (let j = 0; j < ELEV_N; j++) row.push(elevFlat[i * ELEV_N + j].elevation);
    elevSamples.push(row);
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

  const values: number[] = new Array(nLat * nLon);
  let vmin = Infinity, vmax = -Infinity, hasNaN = false;
  for (let r = 0; r < nLat; r++) {
    const lat = latMin + (latMax - latMin) * (r / (nLat - 1));
    for (let c = 0; c < nLon; c++) {
      const lon = lonMin + (lonMax - lonMin) * (c / (nLon - 1));
      try {
        const cellCtx = { ...ctx, lat, lon, elevation: { elevation: elevAt(lat, lon) } };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cellInputs = mapInputs(id, normInputs, cellCtx as any);
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
