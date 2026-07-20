/* ═════════════════════════════════════════════════════════════════
   ANALYTICAL MODELS DATA — 150 analytical earth system equations
   26 domains · 7 parts · All non-ML, peer-reviewed, DOI-verified
   ═════════════════════════════════════════════════════════════════ */

export interface AnalysisToolParameter {
  symbol: string;
  label: string;
  unit?: string;
  default: number | string | boolean;
  min?: number;
  max?: number;
  options?: string[];
  group?: string;
}

export type EquationComputeFn = (inputs: Record<string, number>) => {
  result: number;
  unit?: string;
  steps: string[];
};

export interface ToolOutput {
  id: string;
  label: string;
  type: 'scalar' | 'raster' | 'vector' | 'table';
  unit?: string;
  description?: string;
}

export interface AnalysisTool {
  id: number;
  name: string;
  toolName?: string;
  equation: string;
  shortDescription?: string;
  keywords?: string[];
  reference: string;
  appliesTo: string;
  inputs?: AnalysisToolParameter[];
  outputs?: ToolOutput[];
  analysisMeta?: AnalysisMeta;
}

/* ── Analytical Tool Metadata ── */

export type StudyAreaMode = 'point' | 'bbox' | 'two-points';
export type TimeGranularity = 'instant' | 'range' | 'multi-year' | null;
export type CategoryFilterId =
  | 'elevation' | 'data-source' | 'magnitude-range'
  | 'land-cover' | 'soil-texture' | 'ocean-depth'
  | 'climate-scenario' | 'spatial-resolution';
export type AutoDataSourceId =
  | 'dem-elevation' | 'land-cover' | 'soil-grids'
  | 'open-meteo' | 'usgs-earthquakes' | 'firms'
  | 'ndbc-buoys' | 'openaq' | 'era5'
  | 'worldpop' | 'gebco-bathymetry' | 'modis-ndvi'
  | 'tectonic-context' | 'water-table-depth' | 'sea-surface-temperature' | 'wave-climate';

export interface AnalysisMeta {
  needsTime: boolean;
  timeGranularity: TimeGranularity;
  studyAreaMode: StudyAreaMode;
  categoryFilters: CategoryFilterId[];
  autoDataSources: AutoDataSourceId[];
}

export const STUDY_AREA_MODE_LABELS: Record<StudyAreaMode, string> = {
  'point': 'Single Point',
  'bbox': 'Bounding Box',
  'two-points': 'Two Points',
};

export const TIME_GRANULARITY_LABELS: Record<Exclude<TimeGranularity, null>, string> = {
  'instant': 'Single Date',
  'range': 'Date Range',
  'multi-year': 'Multi-Year Range',
};

export const CATEGORY_FILTER_META: Record<CategoryFilterId, {
  label: string; unit?: string;
  options?: string[]; min?: number; max?: number;
}> = {
  'elevation': { label: 'Elevation / Altitude', unit: 'm', min: 0, max: 50000 },
  'data-source': { label: 'Data Source / Sensor', options: ['Landsat 8/9', 'Sentinel-2', 'MODIS', 'ERA5', 'NDBC buoys'] },
  'magnitude-range': { label: 'Magnitude Range', min: 2.5, max: 9.0 },
  'land-cover': { label: 'Land Cover / Vegetation', options: ['Forest', 'Cropland', 'Grassland', 'Urban', 'Water', 'Wetland'] },
  'soil-texture': { label: 'Soil Texture', options: ['Sand', 'Silt', 'Clay', 'Loam', 'Sandy loam'] },
  'ocean-depth': { label: 'Ocean Depth', unit: 'm', min: 0, max: 6000 },
  'climate-scenario': { label: 'Climate Scenario', options: ['SSP1-2.6', 'SSP2-4.5', 'SSP3-7.0', 'SSP5-8.5'] },
  'spatial-resolution': { label: 'Spatial Resolution', options: ['10m', '30m', '250m', '1km'] },
};

export const AUTO_DATA_SOURCE_LABELS: Record<AutoDataSourceId, string> = {
  'dem-elevation': 'Elevation (DEM / SRTM)',
  'land-cover': 'Land Cover (ESA WorldCover)',
  'soil-grids': 'Soil Type (ISRIC SoilGrids)',
  'open-meteo': 'Weather (Open-Meteo)',
  'usgs-earthquakes': 'Seismicity (USGS catalog)',
  'firms': 'Fire History (NASA FIRMS)',
  'ndbc-buoys': 'Buoys (NDBC)',
  'openaq': 'Air Quality (OpenAQ)',
  'era5': 'Climate Normals (ERA5)',
  'worldpop': 'Population (WorldPop)',
  'gebco-bathymetry': 'Bathymetry (GEBCO)',
  'modis-ndvi': 'NDVI Baseline (MODIS)',
  'tectonic-context': 'Tectonic Context (USGS faults)',
  'water-table-depth': 'Water Table (GLDAS/GRACE)',
  'sea-surface-temperature': 'SST (NOAA OISST)',
  'wave-climate': 'Wave Climate (ERA5)',
};

export interface Domain {
  id: string;
  number: number;
  name: string;
  tools: AnalysisTool[];
  color: string;
}

export type PartIconId = 'atom' | 'treePine' | 'waves' | 'mountain' | 'cloud' | 'satellite' | 'wrench';

export const EQUATION_NAME_MAP: Partial<Record<number, string>> = {};

export interface Part {
  id: string;
  number: number;
  label: string;
  title: string;
  domains: Domain[];
  color: string;
  iconId: PartIconId;
}

export const TOTAL_EQUATIONS = 150;
export const TOTAL_DOMAINS = 26;
export const TOTAL_PARTS = 7;

/* ── Analytical-tool metadata derivation (per EARTH_SYSTEM_EQUATIONS_REFERENCES.md §1–4) ── */

const inRange = (id: number, lo: number, hi: number) => id >= lo && id <= hi;
const anyRange = (id: number, ranges: [number, number][]) => ranges.some(([a, b]) => inRange(id, a, b));

const BBOX: [number, number][] = [[1, 1], [26, 35], [37, 38], [40, 42], [66, 80]];
// Eq 148 (Hohmann) is listed in both single- and two-point lists in the spec;
// resolved to two-points since it is orbital mechanics, not an Earth location.
const TWO_POINTS = new Set([36, 125, 127, 145, 148]);

const INSTANT: [number, number][] = [[1, 9], [26, 35], [64, 65], [116, 130]];
const RANGE: [number, number][] = [[19, 25], [40, 41], [66, 80], [88, 90], [96, 110], [131, 144]];
const MULTIYEAR: [number, number][] = [[96, 101], [138, 139]];
const NO_TIME_IDS = (() => {
  const s = new Set<number>();
  for (let i = 36; i <= 38; i++) s.add(i);
  for (let i = 42; i <= 50; i++) s.add(i);
  for (let i = 148; i <= 150; i++) s.add(i);
  return s;
})();

function deriveStudyAreaMode(id: number): StudyAreaMode {
  if (TWO_POINTS.has(id)) return 'two-points';
  if (anyRange(id, BBOX)) return 'bbox';
  return 'point';
}

function deriveTimeGranularity(id: number): TimeGranularity {
  if (NO_TIME_IDS.has(id)) return null;
  if (anyRange(id, MULTIYEAR)) return 'multi-year';
  if (anyRange(id, RANGE)) return 'range';
  if (anyRange(id, INSTANT)) return 'instant';
  return null;
}

function deriveCategoryFilters(domainNumber: number): CategoryFilterId[] {
  switch (domainNumber) {
    case 1: return ['elevation'];
    case 2: return ['elevation', 'soil-texture', 'data-source'];
    case 3: return ['magnitude-range'];
    case 4: return ['data-source', 'spatial-resolution'];
    case 5: return ['spatial-resolution'];
    case 6: return ['land-cover', 'soil-texture'];
    case 7: return ['land-cover'];
    case 8: return ['land-cover'];
    case 9: return ['data-source'];
    case 10: return ['data-source', 'ocean-depth'];
    case 11: return ['ocean-depth'];
    case 15: return ['climate-scenario'];
    case 18: case 19: case 20: case 21: return ['elevation'];
    case 23: return ['magnitude-range'];
    default: return [];
  }
}

function deriveAutoDataSources(domainNumber: number): AutoDataSourceId[] {
  switch (domainNumber) {
    case 1: return ['dem-elevation', 'open-meteo', 'openaq'];
    case 2: return ['dem-elevation', 'soil-grids', 'open-meteo'];
    case 3: return ['usgs-earthquakes', 'tectonic-context'];
    case 4: return ['land-cover', 'modis-ndvi', 'firms', 'dem-elevation'];
    case 5: return ['dem-elevation'];
    case 6: return ['land-cover', 'soil-grids', 'dem-elevation'];
    case 7: return ['land-cover', 'modis-ndvi', 'era5'];
    case 8: return ['land-cover', 'era5', 'dem-elevation'];
    case 9: return ['openaq'];
    case 10: return ['gebco-bathymetry', 'sea-surface-temperature', 'ndbc-buoys', 'wave-climate'];
    case 11: return ['gebco-bathymetry', 'wave-climate', 'ndbc-buoys'];
    case 12: case 13: case 14: return ['dem-elevation'];
    case 15: return ['era5', 'dem-elevation'];
    case 16: return ['open-meteo', 'era5'];
    case 17: return ['open-meteo'];
    case 18: case 19: case 20: case 21: return ['dem-elevation'];
    case 22: return ['water-table-depth', 'soil-grids'];
    case 23: return ['worldpop', 'dem-elevation', 'usgs-earthquakes'];
    case 24: return ['era5'];
    default: return [];
  }
}

function autoKeywords(domainName: string, name: string, appliesTo: string): string[] {
  const fromApplies = appliesTo.split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean);
  const fromDomain = domainName.toLowerCase();
  return [...new Set([fromDomain, name.toLowerCase(), ...fromApplies])];
}

function autoDescription(appliesTo: string): string {
  return appliesTo;
}

function autoOutputs(id: number): ToolOutput[] {
  return [{ id: 'primary', label: 'Result', type: 'scalar', description: 'Computed output value' }];
}

export function attachAnalysisMetadata(): void {
  PARTS.forEach(part =>
    part.domains.forEach(domain =>
      domain.tools.forEach(tool => {
        const tg = deriveTimeGranularity(tool.id);
        tool.analysisMeta = {
          needsTime: tg !== null,
          timeGranularity: tg,
          studyAreaMode: deriveStudyAreaMode(tool.id),
          categoryFilters: deriveCategoryFilters(domain.number),
          autoDataSources: deriveAutoDataSources(domain.number),
        };
        tool.shortDescription = tool.shortDescription || autoDescription(tool.appliesTo);
        tool.keywords = tool.keywords || autoKeywords(domain.name, tool.name, tool.appliesTo);
        tool.outputs = tool.outputs || autoOutputs(tool.id);
      })
    )
  );
}

export const PARTS: Part[] = [
  {
    id: 'part1', number: 1, label: 'I', title: 'Earth System Core',
    color: '#3b82f6', iconId: 'atom',
    domains: [
      {
        id: 'atmo', number: 1, name: 'Atmospheric Science', color: '#60a5fa',
        tools: [
          { id: 1, toolName: 'Land Surface Temperature Retrieval', name: 'Split-Window Algorithm', equation: 'Ts = A₀ + A₁·T₁₀ − A₂·T₁₁', reference: 'Rozenstein, O., Qin, Z., Derimian, Y. & Karnieli, A. (2014) Derivation of Land Surface Temperature for Landsat-8 TIRS Using a Split Window Algorithm. Sensors, 14(4), 5768–5780', appliesTo: 'Satellite thermal infrared → surface temperature map',
            inputs: [
              { symbol: 'T₁₀', label: 'Band 10 Brightness Temp', unit: 'K', default: 300, min: 260, max: 330 },
              { symbol: 'T₁₁', label: 'Band 11 Brightness Temp', unit: 'K', default: 298, min: 260, max: 330 },
              { symbol: 'ε₁₀', label: 'Band 10 Emissivity', unit: '—', default: 0.97, min: 0.9, max: 1.0 },
              { symbol: 'ε₁₁', label: 'Band 11 Emissivity', unit: '—', default: 0.98, min: 0.9, max: 1.0 },
              { symbol: 'w', label: 'Column Water Vapor', unit: 'g/cm²', default: 1.5, min: 0, max: 6.3 },
            ],
            outputs: [
              { id: 'primary', label: 'Surface Temperature', type: 'scalar', unit: '°C', description: 'Land surface temperature in Celsius' }
            ]
          },
          { id: 2, toolName: 'Brightness Temperature Retrieval', name: 'Planck Radiation Law', equation: 'B_λ(T) = 2hc²/λ⁵ × 1/(exp(hc/λkT) - 1)', reference: 'Planck, M. (1900)', appliesTo: 'Satellite thermal radiance → brightness temperature',
            inputs: [
              { symbol: 'λ', label: 'Wavelength', unit: 'µm', default: 10, min: 0.1, max: 100 },
              { symbol: 'T', label: 'Temperature', unit: 'K', default: 300, min: 100, max: 2000 }
            ]
          },
          { id: 3, name: 'Saturation Vapor Pressure', equation: 'e_s(T) = 6.1094 × exp(17.625T/(T + 243.04)) hPa', reference: 'Tetens, O. (1930)', appliesTo: 'Saturation vapor pressure, dew point, humidity',
            inputs: [
              { symbol: 'T', label: 'Air Temperature', unit: '°C', default: 20, min: -50, max: 50 }
            ]
          },
          { id: 4, toolName: 'Atmospheric Pressure Profile', name: 'Hydrostatic Equation', equation: 'P(z) = P₀ × exp(-gz/RT)', reference: 'Standard atmospheric physics', appliesTo: 'Pressure at altitude, 3D atmospheric structure',
            inputs: [
              { symbol: 'P0', label: 'Surface Pressure', unit: 'hPa', default: 1013.25, min: 500, max: 1100 },
              { symbol: 'z', label: 'Altitude', unit: 'm', default: 1000, min: 0, max: 20000 },
              { symbol: 'T', label: 'Temperature', unit: 'K', default: 288, min: 200, max: 320 }
            ]
          },
          { id: 5, toolName: 'Geostrophic Wind Analysis', name: 'Geostrophic Wind', equation: 'V_g = (1/fρ) × (∂P/∂y, -∂P/∂x), f = 2Ωsinφ', reference: 'Holton & Hakim (2012)', appliesTo: 'Jet stream analysis, frontal zone detection',
            inputs: [
              { symbol: 'f', label: 'Coriolis Parameter', unit: '/s', default: 0.0001, min: 0, max: 0.0002 },
              { symbol: 'ρ', label: 'Air Density', unit: 'kg/m³', default: 1.2, min: 0.5, max: 1.5 },
              { symbol: 'dP/dx', label: 'Pressure Gradient (x)', unit: 'Pa/m', default: 0.001, min: -10, max: 10 },
              { symbol: 'dP/dy', label: 'Pressure Gradient (y)', unit: 'Pa/m', default: 0.001, min: -10, max: 10 }
            ]
          },
          { id: 6, toolName: 'Pollutant Transport Modeling', name: 'Advection-Diffusion Equation', equation: '∂C/∂t + u·∇C = D∇²C + S', reference: 'Standard transport physics', appliesTo: 'Pollutant transport, smoke/ash dispersion',
            inputs: [
              { symbol: 'u', label: 'Wind Speed', unit: 'm/s', default: 5, min: 0, max: 50 },
              { symbol: 'D', label: 'Diffusivity', unit: 'm²/s', default: 100, min: 0.1, max: 10000 },
              { symbol: 'C₀', label: 'Initial Concentration', unit: 'µg/m³', default: 100, min: 0, max: 10000 },
              { symbol: 't', label: 'Time', unit: 's', default: 3600, min: 0, max: 86400 }
            ]
          },
          { id: 7, toolName: 'Atmospheric Stability Index', name: 'Bulk Richardson Number', equation: 'Ri_b = g(z-z_s)(θ_v(z)-θ_vs) / (θ_vs|u(z)-u_s|²)', reference: 'Standard boundary layer meteorology', appliesTo: 'Atmospheric stability, turbulence onset',
            inputs: [
              { symbol: 'z_g', label: 'Upper Height', unit: 'm', default: 100, min: 0, max: 1000 },
              { symbol: 'z_s', label: 'Surface Height', unit: 'm', default: 2, min: 0, max: 100 },
              { symbol: 'θᵥ(z)', label: 'Upper Virtual Pot. Temp.', unit: 'K', default: 305, min: 250, max: 350 },
              { symbol: 'θᵥ(s)', label: 'Surface Virtual Pot. Temp.', unit: 'K', default: 300, min: 250, max: 350 },
              { symbol: 'u(z)', label: 'Upper Wind Speed', unit: 'm/s', default: 10, min: 0, max: 50 },
              { symbol: 'u(s)', label: 'Surface Wind Speed', unit: 'm/s', default: 2, min: 0, max: 30 }
            ]
          },
          { id: 8, toolName: 'Turbulent Energy Spectrum', name: 'Kolmogorov Energy Cascade', equation: 'E(k) = C_ε^(2/3) × k^(-5/3)', reference: 'Kolmogorov, A.N. (1941)', appliesTo: 'Turbulent energy spectrum, LES closure',
            inputs: [
              { symbol: 'C', label: 'Kolmogorov Constant', unit: '—', default: 1.5, min: 1, max: 2 },
              { symbol: 'ε', label: 'TKE Dissipation Rate', unit: 'm²/s³', default: 0.001, min: 1e-10, max: 100 },
              { symbol: 'k', label: 'Wavenumber', unit: '1/m', default: 0.01, min: 1e-06, max: 1000 }
            ]
          },
        ],
      },
      {
        id: 'hydro', number: 2, name: 'Hydrology & Oceanography', color: '#06b6d4',
        tools: [
          { id: 9, toolName: 'Reference Evapotranspiration', name: 'FAO-56 Penman-Monteith', equation: 'ET₀ = [0.408Δ(R_n-G) + γ(900/(T+273))u₂(e_s-e_a)] / [Δ+γ(1+0.34u₂)]', reference: 'Allen et al. (1998)', appliesTo: 'Evapotranspiration, drought monitoring',
            inputs: [
              { symbol: 'Rₙ', label: 'Net Radiation', unit: 'W/m²', default: 150, min: -100, max: 1000 },
              { symbol: 'G', label: 'Soil Heat Flux', unit: 'W/m²', default: 10, min: -100, max: 500 },
              { symbol: 'T', label: 'Air Temperature', unit: '°C', default: 25, min: -10, max: 50 },
              { symbol: 'u₂', label: 'Wind Speed at 2m', unit: 'm/s', default: 2, min: 0, max: 20 },
              { symbol: 'eₛ', label: 'Saturation Vapor Pressure', unit: 'kPa', default: 3.17, min: 0, max: 10 },
              { symbol: 'eₐ', label: 'Actual Vapor Pressure', unit: 'kPa', default: 1.5, min: 0, max: 10 },
              { symbol: 'Δ', label: 'Slope Vapor Pressure Curve', unit: 'kPa/°C', default: 0.15, min: 0, max: 1 },
              { symbol: 'γ', label: 'Psychrometric Constant', unit: 'kPa/°C', default: 0.067, min: 0.04, max: 0.1 }
            ]
          },
          { id: 10, toolName: 'Runoff Estimation (SCS-CN)', name: 'SCS Curve Number', equation: 'Q = (P-I_a)²/(P-I_a+S), I_a = 0.2S', reference: 'USDA SCS (1954)', appliesTo: 'Runoff estimation, flash flood potential',
            inputs: [
              { symbol: 'P', label: 'Precipitation', unit: 'mm', default: 50, min: 0, max: 500 },
              { symbol: 'Iₐ', label: 'Initial Abstraction', unit: 'mm', default: 10, min: 0, max: 100 },
              { symbol: 'S', label: 'Potential Retention', unit: 'mm', default: 100, min: 0, max: 500 }
            ]
          },
          { id: 11, toolName: 'Open Channel Flow Analysis', name: "Manning's Equation", equation: 'v = (1/n) × R^(2/3) × S^(1/2)', reference: 'Manning, R. (1891)', appliesTo: 'Open channel flow, river discharge, flood routing',
            inputs: [
              { symbol: 'n', label: 'Manning Roughness', unit: '—', default: 0.03, min: 0.001, max: 1 },
              { symbol: 'R', label: 'Hydraulic Radius', unit: 'm', default: 1.5, min: 0.01, max: 100 },
              { symbol: 'S', label: 'Channel Slope', unit: 'm/m', default: 0.001, min: 0, max: 1 }
            ]
          },
          { id: 12, toolName: 'Peak Discharge Estimation', name: 'Rational Method', equation: 'Q = C × i × A', reference: 'Mulvaney, T.J. (1851)', appliesTo: 'Peak discharge from small watersheds',
            inputs: [
              { symbol: 'C', label: 'Runoff Coefficient', unit: '—', default: 0.5, min: 0, max: 1 },
              { symbol: 'i', label: 'Rainfall Intensity', unit: 'mm/h', default: 10, min: 0, max: 200 },
              { symbol: 'A', label: 'Catchment Area', unit: 'km²', default: 10, min: 0.1, max: 10000 }
            ]
          },
          { id: 13, toolName: 'Flood Wave Routing', name: 'Muskingum Routing', equation: 'S = K[XI_t + (1-X)O_t]', reference: 'McCarthy, G.T. (1938)', appliesTo: 'Flood wave attenuation in river reaches',
            inputs: [
              { symbol: 'K', label: 'Storage Constant', unit: 'h', default: 6, min: 0.1, max: 48 },
              { symbol: 'X', label: 'Weighting Factor', unit: '—', default: 0.2, min: 0, max: 0.5 },
              { symbol: 'Iₜ', label: 'Inflow at Time t', unit: 'm³/s', default: 100, min: 0, max: 10000 },
              { symbol: 'Oₜ', label: 'Outflow at Time t', unit: 'm³/s', default: 80, min: 0, max: 10000 }
            ]
          },
          { id: 14, toolName: 'Tide Prediction', name: 'Tidal Harmonic Analysis', equation: 'h(t) = H₀ + Σ Aᵢcos(ωᵢt + φᵢ)', reference: 'Pugh & Woodworth (2014)', appliesTo: 'Tide prediction, storm surge detection',
            inputs: [
              { symbol: 'H₀', label: 'Mean Tidal Height', unit: 'm', default: 2, min: -5, max: 10 }
            ]
          },
          { id: 15, toolName: 'Wind-Driven Current Analysis', name: 'Ekman Spiral', equation: 'V₀ = τ/√(ρfA_v), direction 45° to wind', reference: 'Ekman, V.W. (1905)', appliesTo: 'Wind-driven currents, upwelling detection',
            inputs: [
              { symbol: 'τ', label: 'Wind Stress', unit: 'N/m²', default: 0.1, min: 0, max: 10 },
              { symbol: 'ρ', label: 'Seawater Density', unit: 'kg/m³', default: 1025, min: 1000, max: 1050 },
              { symbol: 'f', label: 'Coriolis Parameter', unit: '/s', default: 0.0001, min: 0, max: 0.0002 },
              { symbol: 'Aᵥ', label: 'Vertical Eddy Viscosity', unit: 'm²/s', default: 0.1, min: 0.001, max: 1 }
            ]
          },
          { id: 16, toolName: 'Ocean Current Analysis', name: 'Geostrophic Current', equation: 'f×v_g = (1/ρ)×∂p/∂x', reference: 'Standard physical oceanography', appliesTo: 'Major ocean current computation',
            inputs: [
              { symbol: 'f', label: 'Coriolis Parameter', unit: '/s', default: 0.0001, min: 0, max: 0.0002 },
              { symbol: 'ρ', label: 'Seawater Density', unit: 'kg/m³', default: 1025, min: 1000, max: 1050 },
              { symbol: '∂p/∂x', label: 'Pressure Gradient', unit: 'Pa/m', default: 1e-05, min: -0.01, max: 0.01 }
            ]
          },
          { id: 17, toolName: 'Marine Heat Budget', name: 'Ocean Surface Heat Budget', equation: 'Q_net = Q_s - Q_b - Q_h - Q_e', reference: 'Standard ocean-atmosphere interaction', appliesTo: 'Marine heat wave detection',
            inputs: [
              { symbol: 'Qₛ', label: 'Incoming Shortwave', unit: 'W/m²', default: 200, min: 0, max: 1500 },
              { symbol: 'Q_b', label: 'Outgoing Longwave', unit: 'W/m²', default: 50, min: 0, max: 500 },
              { symbol: 'Q_h', label: 'Sensible Heat Flux', unit: 'W/m²', default: 20, min: -200, max: 500 },
              { symbol: 'Q_e', label: 'Latent Heat Flux', unit: 'W/m²', default: 80, min: -200, max: 500 }
            ]
          },
          { id: 18, toolName: 'Infiltration Analysis', name: 'Green-Ampt Infiltration', equation: 'f(t) = K_s × (1 + (ψ_w-ψ₀)Δθ/F(t))', reference: 'Green & Ampt (1911)', appliesTo: 'Infiltration rate, flood forecasting',
            inputs: [
              { symbol: 'Kₛ', label: 'Saturated Hydraulic Conductivity', unit: 'm/s', default: 1e-05, min: 1e-10, max: 1 },
              { symbol: 'ψ_w', label: 'Wetting Front Potential', unit: 'm', default: 0.2, min: 0, max: 10 },
              { symbol: 'ψ₀', label: 'Initial Matric Potential', unit: 'm', default: 0.5, min: 0, max: 10 },
              { symbol: 'Δθ', label: 'Moisture Deficit', unit: '—', default: 0.2, min: 0, max: 0.5 },
              { symbol: 'F(t)', label: 'Cumulative Infiltration', unit: 'm', default: 0.1, min: 0, max: 5 }
            ]
          },
        ],
      },
      {
        id: 'seismo', number: 3, name: 'Geophysics & Seismology', color: '#f97316',
        tools: [
          { id: 19, toolName: 'Earthquake Frequency Analysis', name: 'Gutenberg-Richter Law', equation: 'log₁₀(N) = a - bM', reference: 'Gutenberg & Richter (1944)', appliesTo: 'Earthquake frequency-magnitude, seismic hazard',
            inputs: [
              { symbol: 'a', label: 'Seismic Activity (a-value)', unit: '—', default: 4, min: 0, max: 10 },
              { symbol: 'b', label: 'Gutenberg-Richter b-value', unit: '—', default: 1, min: 0.5, max: 2 },
              { symbol: 'M', label: 'Earthquake Magnitude', unit: 'M_w', default: 5, min: 0, max: 10 }
            ]
          },
          { id: 20, toolName: 'Aftershock Decay Analysis', name: 'Omori Law', equation: 'n(t) = K/(c+t)^p', reference: 'Omori, F. (1894)', appliesTo: 'Aftershock decay, post-earthquake hazard',
            inputs: [
              { symbol: 'K', label: 'Aftershock Productivity', unit: 'events/day', default: 100, min: 0, max: 10000 },
              { symbol: 'c', label: 'Time Offset', unit: 'days', default: 0.1, min: 0, max: 10 },
              { symbol: 't', label: 'Time Since Main Shock', unit: 'days', default: 1, min: 0, max: 1000 },
              { symbol: 'p', label: 'Omori Decay Exponent', unit: '—', default: 1.1, min: 0.5, max: 2 }
            ]
          },
          { id: 21, toolName: 'Ground Motion Prediction', name: 'Campbell-Bozorgnia GMPE', equation: 'ln(Y) = f_mag + f_dist + f_site + f_fault + f_hanging_wall', reference: 'Campbell & Bozorgnia (2014)', appliesTo: 'Ground motion prediction, ShakeMap',
            inputs: [
              { symbol: 'M_ag', label: 'Magnitude Term', unit: '—', default: 1, min: 0, max: 10 },
              { symbol: 'D_st', label: 'Distance Term', unit: '—', default: -1, min: -10, max: 0 },
              { symbol: 'S_te', label: 'Site Term', unit: '—', default: 0, min: -2, max: 2 },
              { symbol: 'F_lt', label: 'Fault Term', unit: '—', default: 0, min: -1, max: 1 },
              { symbol: 'H_w', label: 'Hanging Wall Term', unit: '—', default: 0, min: 0, max: 1 }
            ]
          },
          { id: 22, toolName: 'Slope Stability Analysis', name: 'Mohr-Coulomb Failure', equation: 'τ = c + σ_n × tanφ', reference: 'Coulomb (1776); Mohr (1900)', appliesTo: 'Fault stability, landslide susceptibility',
            inputs: [
              { symbol: 'c', label: 'Cohesion', unit: 'kPa', default: 10, min: 0, max: 100 },
              { symbol: 'σₙ', label: 'Normal Stress', unit: 'kPa', default: 100, min: 0, max: 1000 },
              { symbol: 'tan φ', label: 'Friction Coefficient', unit: '—', default: 0.6, min: 0.1, max: 1.5 }
            ]
          },
          { id: 23, name: 'Earthquake Magnitude from Moment', equation: 'M_w = (2/3)log₁₀(M₀) - 6.07', reference: 'Hanks & Kanamori (1979)', appliesTo: 'Earthquake magnitude from seismic moment',
            inputs: [
              { symbol: 'M₀', label: 'Seismic Moment', unit: 'N·m', default: 1e+18, min: 10000000000.0, max: 1e+24 }
            ]
          },
          { id: 24, toolName: 'Earthquake Stress Drop Analysis', name: 'Brune Stress Drop', equation: 'Δσ = (7/16)(M₀/r³)', reference: 'Brune, J.N. (1970)', appliesTo: 'Earthquake source characterization',
            inputs: [
              { symbol: 'M₀', label: 'Seismic Moment', unit: 'N·m', default: 1e+18, min: 10000000000.0, max: 1e+24 },
              { symbol: 'r', label: 'Source Radius', unit: 'm', default: 1000, min: 10, max: 50000 }
            ]
          },
          { id: 25, toolName: 'Fault Rupture Scaling', name: 'Wells-Coppersmith Scaling', equation: 'log₁₀(A) = -3.49 + 0.91×M_w', reference: 'Wells & Coppersmith (1994)', appliesTo: 'Magnitude-area relationships',
            inputs: [
              { symbol: 'M_w', label: 'Moment Magnitude', unit: 'M_w', default: 6, min: 3, max: 10 }
            ]
          },
        ],
      },
      {
        id: 'remote', number: 4, name: 'Remote Sensing & Cryosphere', color: '#a855f7',
        tools: [
          { id: 26, name: 'NDVI', equation: 'NDVI = (NIR - Red)/(NIR + Red)', reference: 'Rouse et al. (1974)', appliesTo: 'Vegetation health, drought stress, deforestation',
            inputs: [
              { symbol: 'NIR', label: 'Near-Infrared Band', unit: 'reflectance', default: 0.3, min: 0, max: 1 },
              { symbol: 'Red', label: 'Red Band', unit: 'reflectance', default: 0.1, min: 0, max: 1 }
            ]
          },
          { id: 27, name: 'NDWI (McFeeters)', equation: 'NDWI = (Green - NIR)/(Green + NIR)', reference: 'McFeeters, S.K. (1996)', appliesTo: 'Surface water detection, flood mapping',
            inputs: [
              { symbol: 'Green', label: 'Green Band', unit: 'reflectance', default: 0.2, min: 0, max: 1 },
              { symbol: 'NIR', label: 'Near-Infrared Band', unit: 'reflectance', default: 0.3, min: 0, max: 1 }
            ]
          },
          { id: 28, name: 'NDWI (Gao)', equation: 'NDWI = (NIR - SWIR)/(NIR + SWIR)', reference: 'Gao, B.C. (1996)', appliesTo: 'Vegetation water content',
            inputs: [
              { symbol: 'NIR', label: 'Near-Infrared Band', unit: 'reflectance', default: 0.3, min: 0, max: 1 },
              { symbol: 'SWIR', label: 'Shortwave-Infrared Band', unit: 'reflectance', default: 0.1, min: 0, max: 1 }
            ]
          },
          { id: 29, name: 'EVI', equation: 'EVI = 2.5(NIR-Red)/(NIR+6Red-7.5Blue+1)', reference: 'Huete et al. (2002)', appliesTo: 'Dense vegetation monitoring, MODIS',
            inputs: [
              { symbol: 'NIR', label: 'Near-Infrared Band', unit: 'reflectance', default: 0.3, min: 0, max: 1 },
              { symbol: 'Red', label: 'Red Band', unit: 'reflectance', default: 0.1, min: 0, max: 1 },
              { symbol: 'Blue', label: 'Blue Band', unit: 'reflectance', default: 0.05, min: 0, max: 1 }
            ]
          },
          { id: 30, toolName: 'Snow Cover Index', name: 'NDSI', equation: 'NDSI = (Green - SWIR)/(Green + SWIR)', reference: 'Hall et al. (1995)', appliesTo: 'Snow cover detection, cryosphere monitoring',
            inputs: [
              { symbol: 'Green', label: 'Green Band', unit: 'reflectance', default: 0.2, min: 0, max: 1 },
              { symbol: 'SWIR', label: 'Shortwave-Infrared Band', unit: 'reflectance', default: 0.1, min: 0, max: 1 }
            ]
          },
          { id: 31, toolName: 'Burn Severity Index', name: 'NBR', equation: 'NBR = (NIR - SWIR)/(NIR + SWIR)', reference: 'Key & Benson (1999)', appliesTo: 'Burn severity, post-fire recovery',
            inputs: [
              { symbol: 'NIR', label: 'Near-Infrared Band', unit: 'reflectance', default: 0.3, min: 0, max: 1 },
              { symbol: 'SWIR', label: 'Shortwave-Infrared Band', unit: 'reflectance', default: 0.1, min: 0, max: 1 }
            ]
          },
          { id: 32, toolName: 'Fire Intensity Analysis', name: 'Fire Radiative Power', equation: 'FRP = A × σ × ε × (T_fire⁴ - T_bg⁴)', reference: 'Giglio et al. (2006)', appliesTo: 'Fire intensity, smoke emission estimation',
            inputs: [
              { symbol: 'A', label: 'Pixel Area', unit: 'm²', default: 10000, min: 0, max: 100000000.0 },
              { symbol: 'ε', label: 'Fire Emissivity', unit: '—', default: 0.98, min: 0, max: 1 },
              { symbol: 'T_fire', label: 'Fire Temperature', unit: 'K', default: 800, min: 400, max: 2000 },
              { symbol: 'T_bg', label: 'Background Temperature', unit: 'K', default: 300, min: 200, max: 400 }
            ]
          },
          { id: 33, name: 'Crop Water Stress Analysis', equation: 'CWSI = (T_c - T_wet)/(T_dry - T_wet)', reference: 'Idso et al. (1981)', appliesTo: 'Agricultural drought, irrigation management',
            inputs: [
              { symbol: 'T_c', label: 'Canopy Temperature', unit: '°C', default: 35, min: 0, max: 60 },
              { symbol: 'T_wet', label: 'Wet Reference Temperature', unit: '°C', default: 25, min: 0, max: 50 },
              { symbol: 'T_dry', label: 'Dry Reference Temperature', unit: '°C', default: 40, min: 0, max: 60 }
            ]
          },
          { id: 34, toolName: 'Snowmelt Estimation', name: 'Degree-Day Snowmelt', equation: 'M = DDF × (T_air - T_base)', reference: 'Standard glaciology', appliesTo: 'Snowmelt runoff forecasting',
            inputs: [
              { symbol: 'DDF', label: 'Degree-Day Factor', unit: 'mm/°C·day', default: 5, min: 0.5, max: 20 },
              { symbol: 'T_air', label: 'Air Temperature', unit: '°C', default: 5, min: -20, max: 40 },
              { symbol: 'T_base', label: 'Base Temperature', unit: '°C', default: 0, min: -5, max: 5 }
            ]
          },
          { id: 35, toolName: 'Sea Ice Analysis', name: 'Sea Ice Concentration', equation: 'T_B = (1-C)T_water + C×T_ice', reference: 'Comiso, J.C. (1986)', appliesTo: 'Passive microwave sea ice retrieval',
            inputs: [
              { symbol: 'C', label: 'Ice Concentration', unit: 'fraction', default: 0.5, min: 0, max: 1 },
              { symbol: 'T_water', label: 'Water Temperature', unit: '°C', default: 0, min: -2, max: 10 },
              { symbol: 'T_ice', label: 'Ice Temperature', unit: '°C', default: -5, min: -50, max: 0 }
            ]
          },
        ],
      },
      {
        id: 'spatial', number: 5, name: 'Spatial Analysis & Extreme Events', color: '#ef4444',
        tools: [
          { id: 36, toolName: 'Great Circle Distance', name: 'Haversine Distance', equation: 'd = 2r×arcsin(√(sin²(Δφ/2)+cosφ₁cosφ₂sin²(Δλ/2)))', reference: 'Standard geodesy', appliesTo: 'Great circle distance, disaster impact radius',
            inputs: [
              { symbol: 'lat₁', label: 'Latitude 1', unit: '°', default: 40, min: -90, max: 90 },
              { symbol: 'lon₁', label: 'Longitude 1', unit: '°', default: -100, min: -180, max: 180 },
              { symbol: 'lat₂', label: 'Latitude 2', unit: '°', default: 41, min: -90, max: 90 },
              { symbol: 'lon₂', label: 'Longitude 2', unit: '°', default: -99, min: -180, max: 180 }
            ]
          },
          { id: 37, toolName: 'Spatial Interpolation (Kriging)', name: 'Ordinary Kriging', equation: 'ŷ(s₀) = Σλᵢz(sᵢ), weights solve Aλ = b', reference: 'Matheron, G. (1963)', appliesTo: 'Optimal spatial interpolation with uncertainty',
            inputs: [
              { symbol: 'z', label: 'Observed Values', unit: '—', default: 1 },
              { symbol: 'λᵢ', label: 'Kriging Weights', unit: '—', default: 1 }
            ]
          },
          { id: 38, toolName: 'Spatial Interpolation (IDW)', name: 'Inverse Distance Weighting', equation: 'ŷ = Σ(wᵢz)/Σwᵢ, wᵢ = 1/d^p', reference: 'Shepard, D. (1968)', appliesTo: 'Rapid spatial interpolation',
            inputs: [
              { symbol: 'z', label: 'Sampled Values', unit: '—', default: 1 },
              { symbol: 'wᵢ', label: 'IDW Weights', unit: '—', default: 1 }
            ]
          },
          { id: 39, toolName: 'Air Dispersion Modeling', name: 'Gaussian Plume Dispersion', equation: 'C(x,y,z) = Q/(2πuσ_yσ_z)×exp(-y²/2σ_y²)×[...]', reference: 'Pasquill, F. (1976)', appliesTo: 'Air quality, smoke/ash dispersion',
            inputs: [
              { symbol: 'Q', label: 'Source Emission Rate', unit: 'µg/s', default: 1000, min: 0, max: 1000000000.0 },
              { symbol: 'u', label: 'Wind Speed', unit: 'm/s', default: 5, min: 0, max: 50 },
              { symbol: 'σ_y', label: 'Horizontal Dispersion', unit: 'm', default: 50, min: 1, max: 1000 },
              { symbol: 'σ_z', label: 'Vertical Dispersion', unit: 'm', default: 30, min: 1, max: 1000 },
              { symbol: 'y', label: 'Crosswind Distance', unit: 'm', default: 0, min: -5000, max: 5000 }
            ]
          },
          { id: 40, toolName: 'Extreme Value Analysis (Gumbel)', name: 'Gumbel Distribution', equation: 'F(x) = exp(-exp(-(x-μ)/β))', reference: 'Gumbel, E.J. (1958)', appliesTo: 'Return period for floods, wind, temperature extremes',
            inputs: [
              { symbol: 'μ', label: 'Location Parameter', unit: '—', default: 100, min: -1000000.0, max: 1000000.0 },
              { symbol: 'β', label: 'Scale Parameter', unit: '—', default: 20, min: 0.1, max: 1000000.0 },
              { symbol: 'x', label: 'Value', unit: '—', default: 100, min: -1000000.0, max: 1000000.0 }
            ]
          },
          { id: 41, toolName: 'Extreme Value Analysis (Pareto)', name: 'Generalized Pareto Distribution', equation: 'G(x) = 1 - (1 + ξx/β)^(-1/ξ)', reference: 'Pickands, J. (1975)', appliesTo: 'Peaks-over-threshold extreme analysis',
            inputs: [
              { symbol: 'ξ', label: 'Shape Parameter', unit: '—', default: 0.1, min: -0.5, max: 1 },
              { symbol: 'β', label: 'Scale Parameter', unit: '—', default: 20, min: 0.1, max: 1000000.0 },
              { symbol: 'x', label: 'Exceedance Threshold', unit: '—', default: 100, min: -1000000.0, max: 1000000.0 }
            ]
          },
          { id: 42, toolName: 'Spatial Autocorrelation Analysis', name: 'Semivariogram', equation: 'γ(h) = (1/2N(h))×Σ[z(x)-z(x+h)]²', reference: 'Matheron, G. (1963)', appliesTo: 'Spatial autocorrelation modeling',
            inputs: [
              { symbol: 'z', label: 'Observed Values', unit: '—', default: 1 },
              { symbol: 'h', label: 'Lag Distance', unit: '—', default: 1 }
            ]
          },
        ],
      },
      {
        id: 'soil', number: 6, name: 'Soil Science & Land Surface', color: '#84cc16',
        tools: [
          { id: 43, toolName: 'Soil Water Retention Curve', name: 'Van Genuchten', equation: 'θ(ψ) = θ_r + (θ_s-θ_r)/[1+(α|ψ|)^n]^m', reference: 'van Genuchten (1980)', appliesTo: 'Soil water retention, unsaturated flow',
            inputs: [
              { symbol: 'θ_r', label: 'Residual Water Content', unit: 'm³/m³', default: 0.05, min: 0, max: 0.2 },
              { symbol: 'θ_s', label: 'Saturated Water Content', unit: 'm³/m³', default: 0.4, min: 0.2, max: 0.6 },
              { symbol: 'α', label: 'Inverse Air-Entry Height', unit: '1/m', default: 0.01, min: 0.001, max: 1 },
              { symbol: 'n', label: 'Pore Size Distribution Index', unit: '—', default: 1.5, min: 1.1, max: 5 },
              { symbol: 'ψ', label: 'Matric Potential', unit: 'm', default: -10, min: -100, max: -0.01 }
            ]
          },
          { id: 44, toolName: 'Soil Hydraulic Properties', name: 'Brooks-Corey', equation: 'S_e = (ψ_b/ψ)^λ', reference: 'Brooks & Corey (1964)', appliesTo: 'Soil hydraulic properties, drainage',
            inputs: [
              { symbol: 'ψ_b', label: 'Bubbling Pressure', unit: 'm', default: -0.3, min: -10, max: -0.01 },
              { symbol: 'ψ', label: 'Matric Potential', unit: 'm', default: -1, min: -100, max: -0.01 }
            ]
          },
          { id: 45, toolName: 'Soil Erosion Risk Assessment', name: 'USLE/RUSLE', equation: 'A = R × K × LS × C × P', reference: 'Wischmeier & Smith (1978)', appliesTo: 'Soil erosion prediction, land management',
            inputs: [
              { symbol: 'R', label: 'Rainfall Erosivity', unit: 'MJ·mm/ha·h·yr', default: 5000, min: 0, max: 50000 },
              { symbol: 'K', label: 'Soil Erodibility', unit: 't·ha·h/ha·MJ·mm', default: 0.03, min: 0, max: 1 },
              { symbol: 'LS', label: 'Slope Length-Steepness', unit: '—', default: 2, min: 0, max: 20 },
              { symbol: 'C', label: 'Cover Management', unit: '—', default: 0.2, min: 0, max: 1 },
              { symbol: 'P', label: 'Support Practice', unit: '—', default: 1, min: 0, max: 1 }
            ]
          },
          { id: 46, toolName: 'Soil Respiration Analysis', name: 'Q₁₀ Soil Respiration', equation: 'R_s = R_base × Q₁₀^((T-T_base)/10)', reference: 'Raich & Schlesinger (1992)', appliesTo: 'Soil carbon flux, carbon cycle feedback',
            inputs: [
              { symbol: 'R_base', label: 'Base Respiration Rate', unit: 'µmol/m²s', default: 2, min: 0, max: 50 },
              { symbol: 'Q₁₀', label: 'Temperature Sensitivity', unit: '—', default: 2, min: 1, max: 5 },
              { symbol: 'T', label: 'Soil Temperature', unit: '°C', default: 20, min: -10, max: 50 },
              { symbol: 'T_base', label: 'Base Temperature', unit: '°C', default: 10, min: -10, max: 30 }
            ]
          },
          { id: 47, name: 'de Vries Thermal Conductivity', equation: 'λ_soil = Σ(k_if_iλ_i)/Σ(k_if_i)', reference: 'de Vries, D.A. (1963)', appliesTo: 'Soil heat transfer, frost depth',
            inputs: [
              { symbol: 'kᵢ', label: 'Thermal Conductivity Ratios', unit: '—', default: 1 },
              { symbol: 'fᵢ', label: 'Volume Fractions', unit: '—', default: 1 }
            ]
          },
          { id: 48, name: 'Monin-Obukhov Similarity', equation: 'φ_m(ζ) = κz/u_* × ∂ū/∂z, ζ = z/L', reference: 'Monin & Obukhov (1954)', appliesTo: 'Surface layer flux-profile relationships',
            inputs: [
              { symbol: 'κ', label: 'von Kármán Constant', unit: '—', default: 0.4, min: 0.3, max: 0.5 },
              { symbol: 'u_*', label: 'Friction Velocity', unit: 'm/s', default: 0.3, min: 0, max: 5 },
              { symbol: 'z', label: 'Height', unit: 'm', default: 10, min: 0, max: 1000 },
              { symbol: 'L', label: 'Obukhov Length', unit: 'm', default: -50, min: -1000, max: 1000 }
            ]
          },
          { id: 49, name: 'Logarithmic Wind Profile', equation: 'u(z) = (u_*/κ)×ln(z/z₀), κ ≈ 0.4', reference: 'Standard boundary layer meteorology', appliesTo: 'Near-surface wind estimation, wind energy',
            inputs: [
              { symbol: 'u_*', label: 'Friction Velocity', unit: 'm/s', default: 0.3, min: 0, max: 5 },
              { symbol: 'z', label: 'Height', unit: 'm', default: 10, min: 0, max: 1000 },
              { symbol: 'z₀', label: 'Roughness Length', unit: 'm', default: 0.1, min: 1e-05, max: 10 }
            ]
          },
          { id: 50, toolName: 'Stomatal Conductance Analysis', name: 'Ball-Berry Stomatal Conductance', equation: 'g_s = g₀ + a₁×A×h_s/c_s', reference: 'Ball et al. (1987)', appliesTo: 'Land surface modeling, transpiration',
            inputs: [
              { symbol: 'g₀', label: 'Residual Stomatal Conductance', unit: 'mmol/m²s', default: 10, min: 0, max: 100 },
              { symbol: 'a₁', label: 'Ball-Berry Slope', unit: '—', default: 9, min: 0, max: 20 },
              { symbol: 'A', label: 'Photosynthesis Rate', unit: 'µmol/m²s', default: 15, min: 0, max: 50 },
              { symbol: 'hₛ', label: 'Surface Relative Humidity', unit: '—', default: 0.7, min: 0, max: 1 },
              { symbol: 'cₛ', label: 'Surface CO₂ Concentration', unit: 'µmol/mol', default: 380, min: 100, max: 1000 }
            ]
          },
        ],
      },
    ],
  },
  {
    id: 'part2', number: 2, label: 'II', title: 'Biosphere, Agriculture & Chemistry',
    color: '#22c55e', iconId: 'treePine',
    domains: [
      {
        id: 'bio', number: 7, name: 'Biosphere & Carbon Cycle', color: '#22c55e',
        tools: [
          { id: 51, toolName: 'Gross Primary Production', name: 'Light Use Efficiency (GPP)', equation: 'GPP = ε × fPAR × PAR', reference: 'Monteith, J.L. (1977)', appliesTo: 'Global vegetation productivity, MODIS MOD17',
            inputs: [
              { symbol: 'ε', label: 'Light Use Efficiency', unit: 'gC/MJ', default: 1.2, min: 0, max: 5 },
              { symbol: 'fPAR', label: 'Fraction of PAR Absorbed', unit: 'fraction', default: 0.5, min: 0, max: 1 },
              { symbol: 'PAR', label: 'Photosynthetically Active Radiation', unit: 'MJ/m²/yr', default: 2000, min: 0, max: 10000 }
            ]
          },
          { id: 52, name: 'Beer-Lambert Canopy Extinction', equation: 'I(z) = I₀ × exp(-k×LAI)', reference: 'Monsi & Saeki (1953)', appliesTo: 'Canopy light environment, photosynthesis',
            inputs: [
              { symbol: 'I₀', label: 'Incident Radiation', unit: 'µmol/m²s', default: 1500, min: 0, max: 3000 },
              { symbol: 'k', label: 'Extinction Coefficient', unit: '—', default: 0.5, min: 0.1, max: 1 },
              { symbol: 'LAI', label: 'Leaf Area Index', unit: '—', default: 4, min: 0, max: 12 }
            ]
          },
          { id: 53, name: 'Net Ecosystem Exchange', equation: 'NEE = R_eco - GPP', reference: 'Wofsy et al. (1993)', appliesTo: 'Carbon flux monitoring, ecosystem carbon balance',
            inputs: [
              { symbol: 'R_eco', label: 'Ecosystem Respiration', unit: 'gC/m²/yr', default: 800, min: 0, max: 5000 },
              { symbol: 'GPP', label: 'Gross Primary Production', unit: 'gC/m²/yr', default: 1200, min: 0, max: 5000 }
            ]
          },
          { id: 54, name: 'FvCB Photosynthesis (Simplified)', equation: 'A_c = V_cmax × (c_i - Γ*) / (c_i + K_c(1+O/K_o))', reference: 'Farquhar et al. (1980)', appliesTo: 'C3 photosynthesis, carbon cycle modeling',
            inputs: [
              { symbol: 'V_cmax', label: 'Max Carboxylation Rate', unit: 'µmol/m²s', default: 80, min: 0, max: 300 },
              { symbol: 'cᵢ', label: 'Intercellular CO₂', unit: 'µmol/mol', default: 250, min: 0, max: 500 },
              { symbol: 'Γ*', label: 'CO₂ Compensation Point', unit: 'µmol/mol', default: 40, min: 0, max: 100 },
              { symbol: 'K_c', label: 'Michaelis Constant for CO₂', unit: 'µmol/mol', default: 300, min: 50, max: 1000 },
              { symbol: 'K_o', label: 'Michaelis Constant for O₂', unit: 'µmol/mol', default: 300000, min: 100000, max: 500000 },
              { symbol: 'O', label: 'Intercellular O₂', unit: 'µmol/mol', default: 210000, min: 150000, max: 250000 }
            ]
          },
          { id: 55, name: 'Allometric Biomass', equation: 'B = a × DBH^b', reference: 'Chave et al. (2014)', appliesTo: 'Forest biomass, carbon stock estimation',
            inputs: [
              { symbol: 'a', label: 'Allometric Coefficient', unit: 'kg/cm²', default: 0.05, min: 0.001, max: 1 },
              { symbol: 'DBH', label: 'Diameter at Breast Height', unit: 'cm', default: 30, min: 0, max: 300 }
            ]
          },
          { id: 56, name: 'Ocean CO₂ Uptake (Wanninkhof)', equation: 'F = k×K₀×ΔpCO₂, k = 0.31×u²×(Sc/660)^(-0.5)', reference: 'Wanninkhof, R. (1992)', appliesTo: 'Air-sea CO₂ exchange, ocean carbon sink',
            inputs: [
              { symbol: 'k', label: 'Gas Transfer Velocity', unit: 'm/yr', default: 1000, min: 0, max: 5000 },
              { symbol: 'K₀', label: 'CO₂ Solubility', unit: 'mol/m³·atm', default: 30, min: 0, max: 100 },
              { symbol: 'ΔpCO₂', label: 'Partial Pressure Difference', unit: 'µatm', default: 10, min: -100, max: 100 }
            ]
          },
          { id: 57, toolName: 'Ocean Nutrient Ratios', name: 'Redfield Ratio', equation: 'C:N:P = 106:16:1', reference: 'Redfield, A.C. (1934)', appliesTo: 'Ocean nutrient cycling, biogeochemical modeling',
            inputs: [
              { symbol: 'C', label: 'Carbon Content', unit: 'µmol/L', default: 106, min: 0, max: 1000 },
              { symbol: 'N', label: 'Nitrogen Content', unit: 'µmol/L', default: 16, min: 0, max: 100 },
              { symbol: 'P', label: 'Phosphorus Content', unit: 'µmol/L', default: 1, min: 0, max: 10 }
            ]
          },
        ],
      },
      {
        id: 'agri', number: 8, name: 'Agriculture & Crop Science', color: '#f59e0b',
        tools: [
          { id: 58, toolName: 'Crop Growing Degree Days', name: 'Growing Degree Days', equation: 'GDD = Σ max(min(T_avg, T_upper) - T_base, 0)', reference: 'Standard agronomy', appliesTo: 'Crop phenology, planting/harvest timing',
            inputs: [
              { symbol: 'T_avg', label: 'Average Daily Temperature', unit: '°C', default: 20, min: -10, max: 50 },
              { symbol: 'T_base', label: 'Base Temperature', unit: '°C', default: 10, min: 0, max: 20 },
              { symbol: 'T_upper', label: 'Upper Threshold Temperature', unit: '°C', default: 30, min: 20, max: 50 }
            ]
          },
          { id: 59, name: 'Priestley-Taylor ET', equation: 'ET_p = α × (Δ/(Δ+γ)) × (R_n - G)', reference: 'Priestley & Taylor (1972)', appliesTo: 'Radiation-driven ET estimation',
            inputs: [
              { symbol: 'α', label: 'Priestley-Taylor Coefficient', unit: '—', default: 1.26, min: 1, max: 2 },
              { symbol: 'Δ', label: 'Slope Vapor Pressure Curve', unit: 'kPa/°C', default: 0.15, min: 0, max: 1 },
              { symbol: 'γ', label: 'Psychrometric Constant', unit: 'kPa/°C', default: 0.067, min: 0.04, max: 0.1 },
              { symbol: 'Rₙ', label: 'Net Radiation', unit: 'W/m²', default: 150, min: -100, max: 1000 },
              { symbol: 'G', label: 'Soil Heat Flux', unit: 'W/m²', default: 10, min: -100, max: 500 }
            ]
          },
          { id: 60, name: 'Hargreaves-Samani ET', equation: 'ET₀ = 0.0023×R_a×(T_avg+17.8)×√(T_max-T_min)×0.408', reference: 'Hargreaves & Samani (1985)', appliesTo: 'Temperature-only ET estimation',
            inputs: [
              { symbol: 'Rₐ', label: 'Extraterrestrial Radiation', unit: 'MJ/m²day', default: 25, min: 0, max: 50 },
              { symbol: 'T_max', label: 'Maximum Temperature', unit: '°C', default: 30, min: -10, max: 50 },
              { symbol: 'T_min', label: 'Minimum Temperature', unit: '°C', default: 15, min: -30, max: 40 }
            ]
          },
          { id: 61, name: 'FAO Yield Response to Water', equation: '(1-Y_a/Y_m) = K_y × (1-ET_a/ET_m)', reference: 'FAO-56 (1998)', appliesTo: 'Crop yield loss from drought',
            inputs: [
              { symbol: 'Yₐ', label: 'Actual Yield', unit: 't/ha', default: 5, min: 0, max: 20 },
              { symbol: 'Yₘ', label: 'Maximum Yield', unit: 't/ha', default: 8, min: 0, max: 20 },
              { symbol: 'K_y', label: 'Yield Response Factor', unit: '—', default: 1.1, min: 0, max: 2 },
              { symbol: 'ETₐ', label: 'Actual Evapotranspiration', unit: 'mm', default: 400, min: 0, max: 2000 },
              { symbol: 'ETₘ', label: 'Maximum Evapotranspiration', unit: 'mm', default: 600, min: 0, max: 2000 }
            ]
          },
          { id: 62, name: 'Eppley Temperature-Growth', equation: 'μ_max = μ₂₀ × 1.066^(T-20)', reference: 'Eppley, R.W. (1972)', appliesTo: 'Phytoplankton growth rate',
            inputs: [
              { symbol: 'μ₂₀', label: 'Growth Rate at 20°C', unit: '/day', default: 0.8, min: 0, max: 5 },
              { symbol: 'T', label: 'Temperature', unit: '°C', default: 20, min: 0, max: 40 }
            ]
          },
          { id: 63, name: 'Bigleaf Model', equation: 'H = ρc_p(T_s-T_a)/r_a, LE = ρL_v(e_s-e_a)/(r_a+r_s)', reference: 'Sellers et al. (1986)', appliesTo: 'Land surface modeling, evapotranspiration',
            inputs: [
              { symbol: 'ρ', label: 'Air Density', unit: 'kg/m³', default: 1.2, min: 0.5, max: 1.5 },
              { symbol: 'c_p', label: 'Specific Heat at Constant Pressure', unit: 'J/kgK', default: 1005, min: 800, max: 1200 },
              { symbol: 'T_s', label: 'Surface Temperature', unit: '°C', default: 30, min: -10, max: 60 },
              { symbol: 'T_a', label: 'Air Temperature', unit: '°C', default: 25, min: -20, max: 50 },
              { symbol: 'r_a', label: 'Aerodynamic Resistance', unit: 's/m', default: 50, min: 1, max: 500 },
              { symbol: 'r_s', label: 'Surface Resistance', unit: 's/m', default: 100, min: 10, max: 1000 },
              { symbol: 'e_s', label: 'Saturation Vapor Pressure', unit: 'hPa', default: 30, min: 0, max: 100 },
              { symbol: 'e_a', label: 'Actual Vapor Pressure', unit: 'hPa', default: 15, min: 0, max: 100 }
            ]
          },
        ],
      },
      {
        id: 'chem', number: 9, name: 'Atmospheric Chemistry & Aerosols', color: '#ec4899',
        tools: [
          { id: 64, name: 'Chapman Ozone Cycle', equation: 'O₂ + hν → 2O; O + O₂ + M → O₃ + M; O₃ + hν → O₂ + O; O + O₃ → 2O₂', reference: 'Chapman, S. (1930)', appliesTo: 'Stratospheric ozone, UV radiation modeling',
            inputs: [
              { symbol: 'O₂', label: 'Oxygen Concentration', unit: 'mol/m³', default: 8, min: 0, max: 20 },
              { symbol: 'hν', label: 'Solar Irradiance Factor', unit: '—', default: 1, min: 0, max: 2 }
            ]
          },
          { id: 65, name: 'Pollutant Lifetime', equation: 'τ = 1/(k×[OH])', reference: 'Standard atmospheric chemistry', appliesTo: 'Atmospheric residence time, pollutant transport',
            inputs: [
              { symbol: 'k', label: 'Reaction Rate Constant', unit: 'cm³/s', default: 1e-12, min: 1e-20, max: 1e-05 },
              { symbol: '[OH]', label: 'Hydroxyl Radical Concentration', unit: 'mol/cm³', default: 1e-06, min: 1e-10, max: 0.001 }
            ]
          },
        ],
      },
    ],
  },
  {
    id: 'part3', number: 3, label: 'III', title: 'Ocean & Coastal Advanced',
    color: '#0ea5e9', iconId: 'waves',
    domains: [
      {
        id: 'ocean', number: 10, name: 'Ocean Dynamics & Circulation', color: '#0ea5e9',
        tools: [
          { id: 66, name: 'Sverdrup Balance', equation: 'βv = (1/ρ₀)(∇×τ)_z', reference: 'Sverdrup, H.U. (1947)', appliesTo: 'Wind-driven ocean interior transport',
            inputs: [
              { symbol: 'β', label: 'Rossby Parameter', unit: '/m·s', default: 2e-11, min: 0, max: 1e-10 },
              { symbol: 'ρ₀', label: 'Reference Seawater Density', unit: 'kg/m³', default: 1025, min: 1000, max: 1050 },
              { symbol: '(∇×τ)_z', label: 'Wind Stress Curl (z)', unit: 'N/m³', default: 1e-06, min: -0.001, max: 0.001 }
            ]
          },
          { id: 67, name: 'Stommel Western Boundary Current', equation: 'β×∂ψ/∂x = curlτ - R∇²ψ', reference: 'Stommel, H. (1948)', appliesTo: 'Gulf Stream, Kuroshio — westward intensification',
            inputs: [
              { symbol: 'β', label: 'Rossby Parameter', unit: '/m·s', default: 2e-11, min: 0, max: 1e-10 },
              { symbol: 'ψ', label: 'Streamfunction', unit: 'm²/s', default: 100000.0, min: -1000000000.0, max: 1000000000.0 },
              { symbol: 'curlτ', label: 'Wind Stress Curl', unit: 'N/m³', default: 1e-06, min: -0.001, max: 0.001 },
              { symbol: 'R', label: 'Friction Coefficient', unit: '/s', default: 1e-06, min: 1e-10, max: 1 },
              { symbol: 'ν', label: 'Viscosity', unit: 'm²/s', default: 0.0001, min: 0, max: 1 }
            ]
          },
          { id: 68, name: 'Munk Viscous Boundary Layer', equation: 'A_H∇⁴ψ - β×∂ψ/∂x = curlτ', reference: 'Munk, W.H. (1950)', appliesTo: 'Lateral viscosity-driven boundary current width',
            inputs: [
              { symbol: 'A_H', label: 'Lateral Eddy Viscosity', unit: 'm²/s', default: 10000.0, min: 0, max: 10000000.0 },
              { symbol: 'β', label: 'Rossby Parameter', unit: '/m·s', default: 2e-11, min: 0, max: 1e-10 },
              { symbol: 'ψ', label: 'Streamfunction', unit: 'm²/s', default: 100000.0, min: -1000000000.0, max: 1000000000.0 },
              { symbol: 'curlτ', label: 'Wind Stress Curl', unit: 'N/m³', default: 1e-06, min: -0.001, max: 0.001 }
            ]
          },
          { id: 69, name: 'Stommel Box Model (Thermohaline)', equation: 'dT/dt = λ(T*-T) - q(T-T_p)', reference: 'Stommel, H. (1961)', appliesTo: 'Thermohaline circulation stability, AMOC collapse',
            inputs: [
              { symbol: 'λ', label: 'Relaxation Rate', unit: '/yr', default: 0.1, min: 0, max: 1 },
              { symbol: 'T*', label: 'Equilibrium Temperature', unit: '°C', default: 15, min: -5, max: 40 },
              { symbol: 'T', label: 'Box Temperature', unit: '°C', default: 10, min: -5, max: 40 },
              { symbol: 'q', label: 'Overturning Strength', unit: '/yr', default: 0.5, min: 0, max: 5 }
            ]
          },
          { id: 70, name: 'TEOS-10 Seawater Density', equation: 'ρ = ρ(S_A, Θ, p)', reference: 'IOC, SCOR & IAPSO (2010)', appliesTo: 'Ocean density, buoyancy, sound speed',
            inputs: [
              { symbol: 'S', label: 'Salinity', unit: 'PSU', default: 35, min: 0, max: 42 },
              { symbol: 'Θ', label: 'Potential Temperature', unit: '°C', default: 10, min: -5, max: 40 },
              { symbol: 'p', label: 'Pressure', unit: 'dbar', default: 0, min: 0, max: 10000 }
            ]
          },
          { id: 71, name: 'Osborn-Cox Turbulent Diffusivity', equation: 'K_ρ = γ×ε/N²', reference: 'Osborn & Cox (1972)', appliesTo: 'Ocean mixing, vertical diffusivity',
            inputs: [
              { symbol: 'γ', label: 'Mixing Efficiency', unit: '—', default: 0.2, min: 0, max: 0.5 },
              { symbol: 'ε', label: 'TKE Dissipation Rate', unit: 'W/kg', default: 1e-08, min: 1e-12, max: 0.0001 },
              { symbol: 'N²', label: 'Buoyancy Frequency Squared', unit: '/s²', default: 1e-05, min: 0, max: 1 }
            ]
          },
          { id: 72, name: 'Price-Weller-Pinkel Mixed Layer', equation: 'Deepening when bulk Richardson number > 0.65', reference: 'Price et al. (1986)', appliesTo: 'Ocean mixed layer depth evolution',
            inputs: [
              { symbol: 'Ri', label: 'Bulk Richardson Number', unit: '—', default: 0.5, min: 0, max: 10 }
            ]
          },
          { id: 73, name: 'Pierson-Moskowitz Sea State', equation: 'S(f) = αg²f⁻⁵×exp[-5/4(f_m/f)⁴]', reference: 'Pierson & Moskowitz (1964)', appliesTo: 'Fully developed sea state, wave forecasting',
            inputs: [
              { symbol: 'α', label: 'Phillips Constant', unit: '—', default: 0.0081, min: 0, max: 1 },
              { symbol: 'g', label: 'Gravity', unit: 'm/s²', default: 9.81, min: 9.8, max: 9.82 },
              { symbol: 'f_m', label: 'Peak Frequency', unit: 'Hz', default: 0.1, min: 0.01, max: 10 }
            ]
          },
        ],
      },
      {
        id: 'coast', number: 11, name: 'Coastal & Wave Mechanics', color: '#14b8a6',
        tools: [
          { id: 74, name: 'Wave Runup (Stockdon et al.)', equation: 'R₂ = 1.1 × (η_u + 0.5√(S_w² + S_ig²))', reference: 'Stockdon et al. (2006)', appliesTo: 'Coastal flooding, storm surge',
            inputs: [
              { symbol: 'η_u', label: 'Wave Setup', unit: 'm', default: 0.5, min: 0, max: 5 },
              { symbol: 'S_w', label: 'Sea-Swell Height', unit: 'm', default: 2, min: 0, max: 20 },
              { symbol: 'S_ig', label: 'Infragravity Wave Height', unit: 'm', default: 0.5, min: 0, max: 5 }
            ]
          },
          { id: 75, name: 'Bruun Rule', equation: 'R = (L*×S)/(B+h*)', reference: 'Bruun, P. (1962)', appliesTo: 'Sea level rise-driven coastal retreat',
            inputs: [
              { symbol: 'L*', label: 'Berm Width Scaling', unit: '—', default: 100, min: 0, max: 1000 },
              { symbol: 'S', label: 'Sea Level Rise Rate', unit: 'm/yr', default: 0.005, min: 0, max: 0.5 },
              { symbol: 'B', label: 'Berm Height', unit: 'm', default: 2, min: 0, max: 20 },
              { symbol: 'h*', label: 'Closure Depth', unit: 'm', default: 10, min: 0, max: 50 }
            ]
          },
          { id: 76, name: 'McCowan Wave Breaking', equation: 'H_b = 0.78×d_b', reference: 'McCowan, J. (1894)', appliesTo: 'Breaking zone identification',
            inputs: [
              { symbol: 'd_b', label: 'Breaking Water Depth', unit: 'm', default: 5, min: 0, max: 50 }
            ]
          },
          { id: 77, name: 'CERC Longshore Sediment Transport', equation: 'Q_l = K×H_sb^(5/2)×sin(2θ_b)', reference: 'USACE (1984)', appliesTo: 'Coastal sediment transport rate',
            inputs: [
              { symbol: 'K', label: 'CERC Coefficient', unit: '—', default: 0.001, min: 0, max: 0.1 },
              { symbol: 'H_sb', label: 'Breaking Wave Height', unit: 'm', default: 2, min: 0, max: 20 },
              { symbol: 'θ_b', label: 'Wave Breaking Angle', unit: 'rad', default: 0.3, min: 0, max: 1.57 }
            ]
          },
          { id: 78, name: 'Airy Wave Theory', equation: 'ω² = gk×tanh(kh)', reference: 'Airy, G.B. (1845)', appliesTo: 'Wave speed, dispersion, shallow/deep water',
            inputs: [
              { symbol: 'g', label: 'Gravity', unit: 'm/s²', default: 9.81, min: 9.8, max: 9.82 },
              { symbol: 'k', label: 'Wavenumber', unit: 'rad/m', default: 0.1, min: 0.001, max: 100 },
              { symbol: 'h', label: 'Water Depth', unit: 'm', default: 20, min: 0, max: 5000 }
            ]
          },
          { id: 79, name: 'Stokes Drift', equation: 'u_s = (ωka²/2)×exp(2kz)', reference: 'Stokes, G.G. (1847)', appliesTo: 'Wave-induced mass transport, surface current',
            inputs: [
              { symbol: 'ω', label: 'Angular Wave Frequency', unit: 'rad/s', default: 1, min: 0.01, max: 10 },
              { symbol: 'a', label: 'Wave Amplitude', unit: 'm', default: 1, min: 0, max: 20 },
              { symbol: 'k', label: 'Wavenumber', unit: 'rad/m', default: 0.1, min: 0.001, max: 100 },
              { symbol: 'z', label: 'Depth Below Surface', unit: 'm', default: -5, min: -1000, max: 0 }
            ]
          },
          { id: 80, name: 'JONSWAP Wave Spectrum', equation: 'S(f) = αg²f⁻⁵×exp[-1.25(f/f_m)⁻⁴]×γ^exp(...)', reference: 'Hasselmann et al. (1973)', appliesTo: 'Developing sea state, wave forecasting',
            inputs: [
              { symbol: 'α', label: 'Phillips Constant', unit: '—', default: 0.0081, min: 0, max: 1 },
              { symbol: 'g', label: 'Gravity', unit: 'm/s²', default: 9.81, min: 9.8, max: 9.82 },
              { symbol: 'f_m', label: 'Peak Frequency', unit: 'Hz', default: 0.1, min: 0.01, max: 10 },
              { symbol: 'γ', label: 'Peak Enhancement Factor', unit: '—', default: 3.3, min: 1, max: 10 }
            ]
          },
        ],
      },
    ],
  },
  {
    id: 'part4', number: 4, label: 'IV', title: 'Geomorphology, Limnology & Cryosphere',
    color: '#8b5cf6', iconId: 'mountain',
    domains: [
      {
        id: 'geomorph', number: 12, name: 'Geomorphology & Mass Wasting', color: '#a78bfa',
        tools: [
          { id: 81, name: 'Stream Power Law', equation: 'E = K×A^m×S^n', reference: 'Howard & Kerby (1983)', appliesTo: 'Bedrock erosion rate, landscape evolution',
            inputs: [
              { symbol: 'K', label: 'Erodibility Coefficient', unit: '—', default: 0.001, min: 0, max: 1 },
              { symbol: 'A', label: 'Upstream Drainage Area', unit: 'm²', default: 1000000.0, min: 0, max: 1000000000000.0 },
              { symbol: 'm', label: 'Area Exponent', unit: '—', default: 0.5, min: 0, max: 2 },
              { symbol: 'S', label: 'Channel Slope', unit: 'm/m', default: 0.01, min: 0, max: 1 }
            ]
          },
          { id: 82, toolName: 'River Network Scaling', name: "Hack's Law", equation: 'L = c×A^h (h ≈ 0.6)', reference: 'Hack, J.T. (1957)', appliesTo: 'River network scaling',
            inputs: [
              { symbol: 'c', label: 'Scaling Coefficient', unit: '—', default: 1.5, min: 0, max: 100 },
              { symbol: 'A', label: 'Drainage Area', unit: 'km²', default: 100, min: 0.01, max: 100000 },
              { symbol: 'h', label: 'Scaling Exponent', unit: '—', default: 0.6, min: 0.4, max: 0.8 }
            ]
          },
          { id: 83, name: 'Richardson Fractal Dimension', equation: 'L(s) ∝ s^(1-D)', reference: 'Richardson, L.F. (1961)', appliesTo: 'Coastline complexity measurement',
            inputs: [
              { symbol: 'L', label: 'Coastline Length', unit: 'km', default: 100, min: 0, max: 10000 },
              { symbol: 's', label: 'Measurement Scale', unit: 'km', default: 10, min: 0.1, max: 1000 }
            ]
          },
          { id: 84, toolName: 'Slope Stability Analysis', name: 'Infinite Slope Stability', equation: "FS = [c' + (γzcos²β - u)tanφ'] / (γz sinβ cosβ)", reference: 'Standard geotechnical engineering', appliesTo: 'Landslide factor of safety',
            inputs: [
              { symbol: 'c\'', label: 'Effective Cohesion', unit: 'kPa', default: 10, min: 0, max: 100 },
              { symbol: 'γz', label: 'Unit Weight × Depth', unit: 'kPa', default: 100, min: 0, max: 500 },
              { symbol: 'cosβ', label: 'Cos of Slope Angle', unit: '—', default: 0.866, min: 0, max: 1 },
              { symbol: 'u', label: 'Pore Water Pressure', unit: 'kPa', default: 20, min: 0, max: 200 },
              { symbol: 'φ\'', label: 'Tan of Friction Angle', unit: '—', default: 0.6, min: 0.1, max: 1.5 },
              { symbol: 'sinβ', label: 'Sin of Slope Angle', unit: '—', default: 0.5, min: 0, max: 1 },
              { symbol: 'cos²β', label: 'Cos² of Slope Angle', unit: '—', default: 0.75, min: 0, max: 1 }
            ]
          },
          { id: 85, name: 'Voellmy Friction Model', equation: 'τ = μσ_n + ρgu²/ξ', reference: 'Voellmy, A. (1955)', appliesTo: 'Debris flow/runout distance estimation',
            inputs: [
              { symbol: 'μ', label: 'Friction Coefficient', unit: '—', default: 0.3, min: 0, max: 1 },
              { symbol: 'σₙ', label: 'Normal Stress', unit: 'kPa', default: 100, min: 0, max: 1000 },
              { symbol: 'ξ', label: 'Turbulence Coefficient', unit: 'm/s²', default: 100, min: 0, max: 10000 }
            ]
          },
          { id: 86, name: 'Stream Power Index', equation: 'SPI = ln(A_s × tanβ)', reference: 'Moore et al. (1991)', appliesTo: 'Erosion potential from DEM',
            inputs: [
              { symbol: 'Aₛ', label: 'Specific Contributing Area', unit: 'm²/m', default: 100, min: 0, max: 1000000.0 },
              { symbol: 'tan β', label: 'Slope', unit: '—', default: 0.1, min: 0, max: 10 }
            ]
          },
          { id: 87, name: 'Topographic Wetness Index', equation: 'TWI = ln(A_s/tanβ)', reference: 'Beven & Kirkby (1979)', appliesTo: 'Soil moisture estimation, saturation zones',
            inputs: [
              { symbol: 'Aₛ', label: 'Specific Contributing Area', unit: 'm²/m', default: 100, min: 0, max: 1000000.0 },
              { symbol: 'tan β', label: 'Slope', unit: '—', default: 0.1, min: 0, max: 10 }
            ]
          },
        ],
      },
      {
        id: 'limno', number: 13, name: 'Limnology & Freshwater', color: '#2dd4bf',
        tools: [
          { id: 88, toolName: 'Lake Evaporation Estimation', name: "Lake Evaporation (Meyer's)", equation: 'E = K_M×(e_w - e_a)×(1 + u₉/16)', reference: 'Meyer, A.F. (1915)', appliesTo: 'Lake water loss estimation',
            inputs: [
              { symbol: 'K_m', label: 'Pan Coefficient', unit: '—', default: 0.7, min: 0.1, max: 1.5 },
              { symbol: 'e_w', label: 'Saturation Vapor Pressure', unit: 'hPa', default: 25, min: 0, max: 100 },
              { symbol: 'e_a', label: 'Actual Vapor Pressure', unit: 'hPa', default: 15, min: 0, max: 100 },
              { symbol: 'u₉', label: 'Wind Speed at 9m', unit: 'km/h', default: 10, min: 0, max: 100 }
            ]
          },
          { id: 89, name: 'Schmidt Stability Number', equation: 'S = (1/A₀)∫A(z)(ρ_z - ρ_m)(z - z_v)dz', reference: 'Schmidt, W. (1928)', appliesTo: 'Lake thermal stratification strength',
            inputs: [
              { symbol: 'A', label: 'Surface Area', unit: 'm²', default: 1000000.0, min: 0, max: 10000000000.0 },
              { symbol: 'z', label: 'Depth', unit: 'm', default: 50, min: 0, max: 1000 }
            ]
          },
          { id: 90, name: 'Nash Cascade (Linear Reservoirs)', equation: 'q(t) = (t^(n-1)/(K^(n-1)×(n-1)!))×(1/K)×exp(-t/K)×Q₀', reference: 'Nash, J.E. (1957)', appliesTo: 'Watershed response, unit hydrograph',
            inputs: [
              { symbol: 'n', label: 'Number of Reservoirs', unit: '—', default: 3, min: 1, max: 10 },
              { symbol: 'K', label: 'Storage Coefficient', unit: 'h', default: 6, min: 0.1, max: 48 },
              { symbol: 't', label: 'Time', unit: 'h', default: 12, min: 0, max: 1000 },
              { symbol: 'Q₀', label: 'Initial Discharge', unit: 'm³/s', default: 100, min: 0, max: 10000 }
            ]
          },
        ],
      },
      {
        id: 'cryo', number: 14, name: 'Cryosphere Advanced & Volcanology', color: '#c084fc',
        tools: [
          { id: 91, name: 'Glacier Mass Balance (PDD)', equation: 'B_n = Accumulation - Σ(DDF × T_positive)', reference: 'Braithwaite & Olesen (1989)', appliesTo: 'Glacier health monitoring',
            inputs: [
              { symbol: 'Accum', label: 'Annual Accumulation', unit: 'm w.e.', default: 0.5, min: 0, max: 10 },
              { symbol: 'DDF', label: 'Degree-Day Factor', unit: 'm w.e./°C·day', default: 0.005, min: 0, max: 0.1 },
              { symbol: 'T_pos', label: 'Positive Degree-Days', unit: '°C·day', default: 800, min: 0, max: 5000 }
            ]
          },
          { id: 92, name: 'Stefan Permafrost Active Layer', equation: 'ALT ≈ √(2K×DIFI/L)', reference: 'Stefan, J. (1891)', appliesTo: 'Permafrost depth, climate change monitoring',
            inputs: [
              { symbol: 'K', label: 'Thermal Conductivity', unit: 'W/mK', default: 2, min: 0.1, max: 10 },
              { symbol: 'DDF', label: 'Degree-Day Factor', unit: '°C·day', default: 1000, min: 0, max: 10000 },
              { symbol: 'L', label: 'Latent Heat of Fusion', unit: 'J/m³', default: 300000000.0, min: 0, max: 500000000.0 }
            ]
          },
          { id: 93, name: 'Herron-Langway Firn Densification', equation: 'dρ/dt = k×b×(ρ_i - ρ_f)', reference: 'Herron & Langway (1980)', appliesTo: 'Ice core age-depth, snowpack evolution',
            inputs: [
              { symbol: 'k', label: 'Densification Rate Constant', unit: '/kg', default: 0.01, min: 0, max: 1 },
              { symbol: 'b', label: 'Accumulation Rate', unit: 'kg/m²yr', default: 100, min: 0, max: 10000 },
              { symbol: 'ρᵢ', label: 'Ice Density', unit: 'kg/m³', default: 917, min: 800, max: 950 },
              { symbol: 'ρ_f', label: 'Firn Density', unit: 'kg/m³', default: 550, min: 300, max: 850 }
            ]
          },
          { id: 94, name: 'VEI Volume Relationship', equation: 'log₁₀(V_km³) = -4.42 + 0.75×VEI', reference: 'Newhall & Self (1982)', appliesTo: 'Volcanic eruption classification',
            inputs: [
              { symbol: 'VEI', label: 'Volcanic Explosivity Index', unit: '—', default: 4, min: 0, max: 8 }
            ]
          },
          { id: 95, name: 'Morton-Taylor-Turner Buoyant Plume', equation: 'dz/dt = f(Ṁ, ρ_air, buoyancy), α ≈ 0.1', reference: 'Morton et al. (1956)', appliesTo: 'Volcanic plume rise, ash cloud height',
            inputs: [
              { symbol: 'Q̇', label: 'Heat Output', unit: 'MW', default: 100, min: 0, max: 100000 },
              { symbol: 'ρ_air', label: 'Ambient Air Density', unit: 'kg/m³', default: 1.2, min: 0.5, max: 1.5 },
              { symbol: 'α', label: 'Entrainment Coefficient', unit: '—', default: 0.1, min: 0.05, max: 0.2 }
            ]
          },
        ],
      },
    ],
  },
  {
    id: 'part5', number: 5, label: 'V', title: 'Climate & Atmosphere Advanced',
    color: '#f43f5e', iconId: 'cloud',
    domains: [
      {
        id: 'climate', number: 15, name: 'Climate Dynamics & Feedback', color: '#fb7185',
        tools: [
          { id: 96, name: 'Budyko-Sellers Energy Balance', equation: 'C×∂T/∂t = Q(1-α(T)) - I(T) + div(D∇T)', reference: 'Budyko (1969); Sellers (1969)', appliesTo: 'Climate sensitivity, ice-line stability',
            inputs: [
              { symbol: 'C', label: 'Heat Capacity', unit: 'J/m²K', default: 100000000.0, min: 1000000.0, max: 10000000000.0 },
              { symbol: 'Q', label: 'Incoming Solar Radiation', unit: 'W/m²', default: 340, min: 0, max: 500 },
              { symbol: 'α', label: 'Albedo', unit: '—', default: 0.3, min: 0, max: 1 },
              { symbol: 'I', label: 'Outgoing Longwave', unit: 'W/m²', default: 240, min: 0, max: 400 },
              { symbol: 'D', label: 'Diffusion Coefficient', unit: 'W/mK', default: 1, min: 0, max: 100 },
              { symbol: '∇²T', label: 'Temperature Laplacian', unit: 'K/m²', default: 0, min: -1, max: 1 }
            ]
          },
          { id: 97, name: 'Climate Sensitivity', equation: 'ΔT = λ × ΔF, where λ = (λ₀⁻¹ - f)⁻¹', reference: 'Standard climate science', appliesTo: 'Global warming projection from CO₂ forcing',
            inputs: [
              { symbol: 'ΔF', label: 'Radiative Forcing', unit: 'W/m²', default: 4, min: 0, max: 20 },
              { symbol: 'λ₀', label: 'Planck Feedback', unit: 'W/m²K', default: 3.2, min: 1, max: 5 },
              { symbol: 'f', label: 'Net Feedback Factor', unit: 'W/m²K', default: 1.5, min: -5, max: 5 }
            ]
          },
          { id: 98, name: 'Planck Feedback Parameter', equation: 'λ_P = ∂R/∂T ≈ 3.2 W m⁻² K⁻¹', reference: 'Standard radiation physics', appliesTo: 'Climate feedback decomposition',
            inputs: [
              { symbol: '∂R/∂T', label: 'Planck Feedback Parameter', unit: 'W/m²K', default: 3.2, min: 1, max: 5 }
            ]
          },
          { id: 99, name: 'Rossby Wave Dispersion', equation: 'ω = ūk - βk/(k²+l²)', reference: 'Rossby et al. (1939)', appliesTo: 'Large-scale atmospheric wave dynamics',
            inputs: [
              { symbol: 'β', label: 'Rossby Parameter', unit: '/m·s', default: 2e-11, min: 0, max: 1e-10 },
              { symbol: 'k_x', label: 'Zonal Wavenumber', unit: 'rad/m', default: 1e-06, min: 0, max: 1 },
              { symbol: 'k_y', label: 'Meridional Wavenumber', unit: 'rad/m', default: 1e-06, min: 0, max: 1 }
            ]
          },
          { id: 100, name: 'Charney-Stern Theorem', equation: 'Baroclinic instability requires ∂q/∂y < 0', reference: 'Charney & Stern (1962)', appliesTo: 'Mid-latitude storm generation conditions',
            inputs: [
              { symbol: '∂q/∂y', label: 'Meridional PV Gradient', unit: '/m·s', default: -1e-11, min: -1e-09, max: 1e-09 }
            ]
          },
          { id: 101, name: 'Eady Growth Rate', equation: 'σ_Eady ≈ 0.31 × (f/N) × |∂u/∂z|', reference: 'Eady, E.T. (1949)', appliesTo: 'Baroclinic instability, storm track intensity',
            inputs: [
              { symbol: 'f', label: 'Coriolis Parameter', unit: '/s', default: 0.0001, min: 0, max: 0.0002 },
              { symbol: 'N', label: 'Brunt-Väisälä Frequency', unit: '/s', default: 0.01, min: 0.001, max: 0.1 },
              { symbol: '∂u/∂z', label: 'Vertical Wind Shear', unit: '/s', default: 0.005, min: 0, max: 1 }
            ]
          },
        ],
      },
      {
        id: 'atmo-dyn', number: 16, name: 'Atmospheric Dynamics & Turbulence', color: '#f472b6',
        tools: [
          { id: 102, name: 'Quasi-Geostrophic Potential Vorticity', equation: 'q = ∇²ψ + f + (∂/∂p)[(f²/N²)(∂ψ/∂p)]', reference: 'Charney, J.G. (1948)', appliesTo: 'Conserved tracer for large-scale dynamics',
            inputs: [
              { symbol: 'ψ', label: 'Streamfunction', unit: 'm²/s', default: 1000000.0, min: -1000000000.0, max: 1000000000.0 },
              { symbol: 'f', label: 'Coriolis Parameter', unit: '/s', default: 0.0001, min: 0, max: 0.0002 },
              { symbol: '∂²ψ/∂p²', label: 'Vertical Curvature', unit: '—', default: 1e-06, min: -1, max: 1 }
            ]
          },
          { id: 103, toolName: 'Reynolds Decomposition', name: 'Reynolds Decomposition', equation: "u = ū + u'", reference: 'Reynolds, O. (1895)', appliesTo: 'Turbulent flow separation, Navier-Stokes averaging',
            inputs: [
              { symbol: 'u_bar', label: 'Mean Flow Velocity', unit: 'm/s', default: 10, min: 0, max: 100 },
              { symbol: 'u_prime', label: 'Turbulent Fluctuation', unit: 'm/s', default: 2, min: -50, max: 50 }
            ]
          },
          { id: 104, name: 'Ekman Layer Depth', equation: 'D_E = π√(2K_m/f)', reference: 'Ekman, V.W. (1905)', appliesTo: 'Frictional boundary layer, ocean/atmosphere',
            inputs: [
              { symbol: 'K_m', label: 'Eddy Viscosity', unit: 'm²/s', default: 10, min: 0.001, max: 1000 },
              { symbol: 'f', label: 'Coriolis Parameter', unit: '/s', default: 0.0001, min: 0, max: 0.0002 }
            ]
          },
          { id: 105, toolName: 'Convective Velocity Scale', name: 'Deardorff Convective Velocity Scale', equation: "w_* = (g/θ̄_v × (w'θ'_v)₀ × z_i)^(1/3)", reference: 'Deardorff, J.W. (1970)', appliesTo: 'Convective boundary layer scaling',
            inputs: [
              { symbol: 'g', label: 'Gravitational Acceleration', unit: 'm/s²', default: 9.81, min: 0, max: 20 },
              { symbol: 'θ̄_v', label: 'Mean Virtual Potential Temperature', unit: 'K', default: 300, min: 200, max: 400 },
              { symbol: "w'θ'_v₀", label: 'Surface Virtual Heat Flux', unit: 'K·m/s', default: 0.1, min: 0, max: 10 },
              { symbol: 'z_i', label: 'Boundary Layer Height', unit: 'm', default: 1000, min: 10, max: 5000 }
            ]
          },
          { id: 106, name: 'Petterssen Frontogenesis', equation: 'F = d|∇θ|/dt = |∇θ|(D·cos2β - δ) + cosβ|∂u/∂s||∇θ|', reference: 'Petterssen, S. (1936)', appliesTo: 'Weather front intensification rate',
            inputs: [
              { symbol: '|∇θ|', label: 'Potential Temperature Gradient', unit: 'K/m', default: 0.01, min: 0, max: 1 },
              { symbol: 'D', label: 'Divergence', unit: '/s', default: 1e-05, min: -1, max: 1 },
              { symbol: 'β', label: 'Isentropic Angle', unit: 'rad', default: 0.5, min: 0, max: 1.57 },
              { symbol: 'δ', label: 'Deformation', unit: '/s', default: 1e-05, min: 0, max: 1 }
            ]
          },
          { id: 107, name: 'Vorticity Equation', equation: 'Dζ/Dt = -(ζ+f)(∇·V) + (curl F)_z + tilting', reference: 'Standard dynamic meteorology', appliesTo: 'Storm dynamics, cyclone development',
            inputs: [
              { symbol: 'ζ', label: 'Relative Vorticity', unit: '/s', default: 1e-05, min: -1, max: 1 },
              { symbol: 'f', label: 'Coriolis Parameter', unit: '/s', default: 0.0001, min: 0, max: 0.0002 },
              { symbol: '∇·V', label: 'Horizontal Divergence', unit: '/s', default: 1e-05, min: -1, max: 1 }
            ]
          },
        ],
      },
      {
        id: 'cloud', number: 17, name: 'Cloud Physics & Precipitation', color: '#e879f9',
        tools: [
          { id: 108, name: 'Köhler Equation (Cloud Activation)', equation: 'S ≈ a/r - b/r³', reference: 'Köhler, H. (1936)', appliesTo: 'Cloud droplet activation, aerosol-cloud interaction',
            inputs: [
              { symbol: 'a', label: 'Curvature Term', unit: '—', default: 1e-09, min: 0, max: 1e-06 },
              { symbol: 'r', label: 'Droplet Radius', unit: 'm', default: 1e-05, min: 1e-08, max: 0.001 },
              { symbol: 'b', label: 'Solute Term', unit: '—', default: 1e-15, min: 0, max: 1e-10 }
            ]
          },
          { id: 109, name: 'Marshall-Palmer Drop Size Distribution', equation: 'N(D) = N₀ × exp(-ΛD)', reference: 'Marshall & Palmer (1948)', appliesTo: 'Precipitation microphysics, radar reflectivity',
            inputs: [
              { symbol: 'N₀', label: 'Intercept Parameter', unit: 'm⁻⁴', default: 8000000.0, min: 0, max: 1000000000.0 },
              { symbol: 'Λ', label: 'Slope Parameter', unit: '1/m', default: 4000, min: 0, max: 50000 },
              { symbol: 'D', label: 'Drop Diameter', unit: 'm', default: 0.001, min: 0, max: 0.01 }
            ]
          },
          { id: 110, name: 'Z-R Relationship', equation: 'Z = aR^b (e.g., Z = 200R^1.6)', reference: 'Marshall & Palmer (1948)', appliesTo: 'Weather radar rainfall estimation',
            inputs: [
              { symbol: 'a', label: 'Z-R Coefficient', unit: '—', default: 200, min: 0, max: 1000 },
              { symbol: 'R', label: 'Rainfall Rate', unit: 'mm/h', default: 10, min: 0, max: 500 }
            ]
          },
        ],
      },
    ],
  },
  {
    id: 'part6', number: 6, label: 'VI', title: 'Space Environment & Satellite',
    color: '#06b6d4', iconId: 'satellite',
    domains: [
      {
        id: 'geodesy', number: 18, name: 'Geodesy & Reference Frames', color: '#22d3ee',
        tools: [
          { id: 111, name: 'IERS Earth Rotation Matrix', equation: 'R(t) = P(t)·N(t)·R(t)·W(t)', reference: 'IERS Conventions (2010)', appliesTo: 'Satellite position correction, GPS accuracy',
            inputs: [
              { symbol: 'P', label: 'Precession Matrix', unit: '—', default: 1 },
              { symbol: 'N', label: 'Nutation Matrix', unit: '—', default: 1 },
              { symbol: 'R', label: 'Rotation Matrix', unit: '—', default: 1 },
              { symbol: 'W', label: 'Polar Motion Matrix', unit: '—', default: 1 }
            ]
          },
          { id: 112, name: 'Earth Tides (Love Numbers)', equation: 'u_r = Σ h_n × V_n / g', reference: 'Wahr, J. (1981)', appliesTo: 'Sub-meter satellite/GPS correction',
            inputs: [
              { symbol: 'hₙ', label: 'Love Numbers', unit: '—', default: 0.6, min: 0, max: 1 },
              { symbol: 'Vₙ', label: 'Tidal Potential', unit: 'm²/s²', default: 1, min: 0, max: 10 },
              { symbol: 'g', label: 'Gravity', unit: 'm/s²', default: 9.81, min: 9.8, max: 9.82 }
            ]
          },
          { id: 113, name: 'EGM2008 Gravity Field', equation: 'V(r,φ,λ) = (GM/r)ΣΣ(R/r)^n(C_nmcos(mλ)+S_nmsin(mλ))P_nm(sinφ)', reference: 'Pavlis et al. (2008)', appliesTo: 'Global geoid, precise orbit determination',
            inputs: [
              { symbol: 'GM', label: 'Earth Gravitational Constant', unit: 'm³/s²', default: 398600000000000.0, min: 0, max: 1000000000000000.0 },
              { symbol: 'r', label: 'Radial Distance', unit: 'm', default: 7000000.0, min: 6000000.0, max: 10000000.0 },
              { symbol: 'C_nm', label: 'Cosine Coefficient', unit: '—', default: 1e-06, min: -1, max: 1 },
              { symbol: 'S_nm', label: 'Sine Coefficient', unit: '—', default: 1e-06, min: -1, max: 1 },
              { symbol: 'P_nm', label: 'Legendre Polynomial', unit: '—', default: 1, min: -1, max: 1 }
            ]
          },
          { id: 114, name: 'Helmert 7-Parameter Transformation', equation: 'X_t = S·R·X + T', reference: 'Heiskanen & Moritz (1967)', appliesTo: 'Datum conversion WGS84/ITRF',
            inputs: [
              { symbol: 'S', label: 'Scale Factor', unit: '—', default: 1, min: 0, max: 2 },
              { symbol: 'R', label: 'Rotation Matrix', unit: '—', default: 1 },
              { symbol: 'T', label: 'Translation Vector', unit: 'm', default: 0, min: -1000, max: 1000 }
            ]
          },
          { id: 115, name: 'Geoid Height', equation: 'H ≈ h - N (N = geoid undulation)', reference: 'Standard geodesy', appliesTo: 'Height reference frame transformation',
            inputs: [
              { symbol: 'h', label: 'Ellipsoidal Height', unit: 'm', default: 100, min: -500, max: 10000 },
              { symbol: 'N', label: 'Geoid Undulation', unit: 'm', default: 30, min: -200, max: 200 }
            ]
          },
        ],
      },
      {
        id: 'iono', number: 19, name: 'Thermosphere, Ionosphere & Magnetosphere', color: '#38bdf8',
        tools: [
          { id: 116, name: 'NRLMSISE-00 Thermosphere', equation: 'ρ = Σ n_i × m_i', reference: 'Picone et al. (2002)', appliesTo: 'Satellite drag density, orbital decay',
            inputs: [
              { symbol: 'nᵢ', label: 'Number Densities', unit: 'm⁻³', default: 1000000000000.0 },
              { symbol: 'mᵢ', label: 'Particle Masses', unit: 'kg', default: 1 }
            ]
          },
          { id: 117, name: 'IRI-2016 Ionosphere', equation: 'Empirical electron density profiles', reference: 'Bilitza et al. (2017)', appliesTo: 'GPS accuracy, radio propagation',
            inputs: [
              { symbol: 'N_e', label: 'Electron Density', unit: 'm⁻³', default: 100000000000.0, min: 100000000.0, max: 10000000000000.0 }
            ]
          },
          { id: 118, name: 'Joule Heating', equation: 'Q_J = J·E = σ×E²', reference: 'Standard space physics', appliesTo: 'Storm-time thermospheric density spike',
            inputs: [
              { symbol: 'J', label: 'Current Density', unit: 'A/m²', default: 1e-06, min: 0, max: 1 },
              { symbol: 'E', label: 'Electric Field', unit: 'V/m', default: 0.01, min: 0, max: 1 }
            ]
          },
          { id: 119, name: 'Ionospheric Scintillation (S4)', equation: 'S4 = √((⟨I²⟩ - ⟨I⟩²) / ⟨I⟩²)', reference: 'Standard GNSS quality metric', appliesTo: 'GPS reliability assessment',
            inputs: [
              { symbol: '⟨I⟩', label: 'Mean Intensity', unit: '—', default: 1, min: 0, max: 100 },
              { symbol: 'σ_I', label: 'Intensity Std Dev', unit: '—', default: 0.2, min: 0, max: 10 }
            ]
          },
          { id: 120, name: 'Magnetopause Standoff (Shue)', equation: 'R_mp = 107.4×P_dyn^(-1/6.6)×[1+0.013×exp(0.19×Bz)] R_E', reference: 'Shue et al. (1998)', appliesTo: 'Magnetopause location, solar wind compression',
            inputs: [
              { symbol: 'P_dyn', label: 'Solar Wind Dynamic Pressure', unit: 'nPa', default: 2, min: 0, max: 100 },
              { symbol: 'B_z', label: 'IMF B_z Component', unit: 'nT', default: 0, min: -30, max: 30 }
            ]
          },
          { id: 121, name: 'Dst Ring Current Index', equation: 'Dst* = Dst - b√(P_dyn) + c', reference: 'Sugiura, M. (1964)', appliesTo: 'Geomagnetic storm severity',
            inputs: [
              { symbol: 'Dst', label: 'Dst Index', unit: 'nT', default: -50, min: -500, max: 100 },
              { symbol: 'P_dyn', label: 'Solar Wind Dynamic Pressure', unit: 'nPa', default: 2, min: 0, max: 100 }
            ]
          },
          { id: 122, name: 'Debye Length (Space Plasma)', equation: 'λ_D = √(ε₀k_BT_e / n_ee²)', reference: 'Debye & Hückel (1923)', appliesTo: 'Space plasma shielding distance',
            inputs: [
              { symbol: 'ε₀', label: 'Vacuum Permittivity', unit: 'F/m', default: 8.854e-12 },
              { symbol: 'k_B', label: 'Boltzmann Constant', unit: 'J/K', default: 1.381e-23 },
              { symbol: 'T_e', label: 'Electron Temperature', unit: 'K', default: 100000.0, min: 1000.0, max: 10000000.0 },
              { symbol: 'n_e', label: 'Electron Density', unit: 'm⁻³', default: 100000000000.0, min: 1000000.0, max: 1000000000000000.0 }
            ]
          },
        ],
      },
      {
        id: 'satdyn', number: 20, name: 'Satellite Dynamics & Space Debris', color: '#818cf8',
        tools: [
          { id: 123, name: 'Satellite Drag Force', equation: 'F_D = -½ρC_D(A/m)v_rel²v̂', reference: 'Standard orbital mechanics', appliesTo: 'Orbital decay prediction',
            inputs: [
              { symbol: 'ρ', label: 'Atmospheric Density', unit: 'kg/m³', default: 1e-12, min: 1e-20, max: 1e-05 },
              { symbol: 'C_D', label: 'Drag Coefficient', unit: '—', default: 2.2, min: 1, max: 4 },
              { symbol: 'A', label: 'Cross-Sectional Area', unit: 'm²', default: 10, min: 0.01, max: 1000 },
              { symbol: 'm', label: 'Satellite Mass', unit: 'kg', default: 1000, min: 1, max: 100000 },
              { symbol: 'v', label: 'Velocity', unit: 'm/s', default: 7500, min: 0, max: 15000 }
            ]
          },
          { id: 124, name: 'Orbital Decay Rate', equation: 'da/dt = -(ρ×C_D×A×v)/m', reference: 'King-Hele, D. (1987)', appliesTo: 'Re-entry timeline estimation',
            inputs: [
              { symbol: 'ρ', label: 'Atmospheric Density', unit: 'kg/m³', default: 1e-12, min: 1e-20, max: 1e-05 },
              { symbol: 'C_D', label: 'Drag Coefficient', unit: '—', default: 2.2, min: 1, max: 4 },
              { symbol: 'A', label: 'Cross-Sectional Area', unit: 'm²', default: 10, min: 0.01, max: 1000 },
              { symbol: 'v', label: 'Velocity', unit: 'm/s', default: 7500, min: 0, max: 15000 },
              { symbol: 'm', label: 'Satellite Mass', unit: 'kg', default: 1000, min: 1, max: 100000 }
            ]
          },
          { id: 125, name: 'Collision Probability', equation: 'P_c ≈ (A₁+A₂)/(2πσ_xσ_y) × exp(-d²/2σ²)', reference: 'Foster, J.L. (1992)', appliesTo: 'Conjunction assessment, collision avoidance',
            inputs: [
              { symbol: 'A₁', label: 'Object 1 Area', unit: 'm²', default: 10, min: 0, max: 1000 },
              { symbol: 'A₂', label: 'Object 2 Area', unit: 'm²', default: 10, min: 0, max: 1000 },
              { symbol: 'σ_x', label: 'Position Uncertainty (x)', unit: 'm', default: 10, min: 0, max: 10000 },
              { symbol: 'σ_y', label: 'Position Uncertainty (y)', unit: 'm', default: 10, min: 0, max: 10000 },
              { symbol: 'd', label: 'Miss Distance', unit: 'm', default: 100, min: 0, max: 10000 }
            ]
          },
          { id: 126, name: 'Kessler Syndrome Debris Growth', equation: 'dN/dt = ½ρ²σvN² + L - βN³ - γN', reference: 'Kessler, D.J. (1991)', appliesTo: 'Long-term debris environment projection',
            inputs: [
              { symbol: 'ρ', label: 'Spatial Density', unit: 'km⁻³', default: 1e-06, min: 0, max: 1 },
              { symbol: 'σ', label: 'Collision Cross-Section', unit: 'km²', default: 10, min: 0, max: 1000 },
              { symbol: 'v', label: 'Relative Velocity', unit: 'km/s', default: 10, min: 0, max: 20 },
              { symbol: 'N', label: 'Debris Population', unit: '—', default: 10000, min: 0, max: 1000000000.0 },
              { symbol: 'L', label: 'Launch Source', unit: 'km⁻³/yr', default: 0, min: 0, max: 1000 },
              { symbol: 'β', label: 'Breakup Coefficient', unit: '/yr', default: 1e-09, min: 0, max: 1 },
              { symbol: 'γ', label: 'Decay Coefficient', unit: '/yr', default: 0.0001, min: 0, max: 1 }
            ]
          },
          { id: 127, name: 'Hill-Clohessy-Wiltshire', equation: 'ẍ-2nẏ-3n²x=a_x; ÿ+2nẋ=a_y; z̈+n²z=a_z', reference: 'Hill (1878); Clohessy & Wiltshire (1960)', appliesTo: 'Satellite rendezvous, proximity operations',
            inputs: [
              { symbol: 'n', label: 'Mean Motion', unit: 'rad/s', default: 0.001, min: 0, max: 0.01 },
              { symbol: 'a_x', label: 'Radial Acceleration', unit: 'm/s²', default: 0, min: -10, max: 10 },
              { symbol: 'a_y', label: 'Along-Track Acceleration', unit: 'm/s²', default: 0, min: -10, max: 10 },
              { symbol: 'a_z', label: 'Cross-Track Acceleration', unit: 'm/s²', default: 0, min: -10, max: 10 }
            ]
          },
        ],
      },
      {
        id: 'solar', number: 21, name: 'Solar-Terrestrial & GNSS', color: '#a78bfa',
        tools: [
          { id: 128, name: 'Kp Geomagnetic Index', equation: 'Kp = Σ(w_i×K_i)/Σ(w_i)', reference: 'Bartels, J. (1949)', appliesTo: 'Primary space weather severity metric',
            inputs: [
              { symbol: 'wᵢ', label: 'Station Weights', unit: '—', default: 1 },
              { symbol: 'Kᵢ', label: 'Station K Indices', unit: '—', default: 3, min: 0, max: 9 }
            ]
          },
          { id: 129, name: 'DOP (Dilution of Precision)', equation: 'GDOP = √(trace(H^TH)^(-1))', reference: 'Standard GNSS theory', appliesTo: 'GPS accuracy visualization',
            inputs: [
              { symbol: 'tr(H)', label: 'Trace of Design Matrix', unit: '—', default: 4, min: 1, max: 100 }
            ]
          },
          { id: 130, name: 'Saastamoinen Tropospheric Delay', equation: 'Δτ = (0.002277/sinθ)×[P+(1255/T+0.05)×e]', reference: 'Saastamoinen, J. (1972)', appliesTo: 'GPS signal correction',
            inputs: [
              { symbol: 'θ', label: 'Elevation Angle', unit: 'rad', default: 0.5, min: 0.05, max: 1.57 },
              { symbol: 'P', label: 'Surface Pressure', unit: 'hPa', default: 1013.25, min: 500, max: 1100 },
              { symbol: 'T', label: 'Surface Temperature', unit: 'K', default: 288, min: 200, max: 320 },
              { symbol: 'e', label: 'Water Vapor Pressure', unit: 'hPa', default: 10, min: 0, max: 50 }
            ]
          },
        ],
      },
    ],
  },
  {
    id: 'part7', number: 7, label: 'VII', title: 'Advanced Engineering & Risk',
    color: '#f59e0b', iconId: 'wrench',
    domains: [
      {
        id: 'ground', number: 22, name: 'Groundwater & Subsurface', color: '#fbbf24',
        tools: [
          { id: 131, name: 'Thiem Equation (Steady Radial Flow)', equation: 'Q = 2πT(h₂-h₁)/ln(r₂/r₁)', reference: 'Thiem, G. (1906)', appliesTo: 'Aquifer transmissivity from well tests',
            inputs: [
              { symbol: 'T', label: 'Transmissivity', unit: 'm²/day', default: 500, min: 0.1, max: 50000 },
              { symbol: 'h₁', label: 'Head at Well 1', unit: 'm', default: 50, min: 0, max: 500 },
              { symbol: 'h₂', label: 'Head at Well 2', unit: 'm', default: 60, min: 0, max: 500 },
              { symbol: 'r₁', label: 'Distance to Well 1', unit: 'm', default: 10, min: 0, max: 10000 },
              { symbol: 'r₂', label: 'Distance to Well 2', unit: 'm', default: 100, min: 0, max: 100000 }
            ]
          },
          { id: 132, name: 'Theis Transient Drawdown', equation: 's = (Q/4πT)×W(u), u = r²S/4Tt', reference: 'Theis, C.V. (1935)', appliesTo: 'Transient aquifer response',
            inputs: [
              { symbol: 'Q', label: 'Pumping Rate', unit: 'm³/day', default: 1000, min: 0, max: 100000 },
              { symbol: 'T', label: 'Transmissivity', unit: 'm²/day', default: 500, min: 0.1, max: 50000 },
              { symbol: 't', label: 'Time', unit: 'days', default: 1, min: 0, max: 10000 },
              { symbol: 'r', label: 'Distance from Well', unit: 'm', default: 100, min: 0, max: 10000 },
              { symbol: 'S', label: 'Storativity', unit: '—', default: 0.0001, min: 1e-08, max: 0.1 }
            ]
          },
          { id: 133, name: 'Cooper-Jacob Approximation', equation: 's = (2.3Q/4πT)×log₁₀(2.25Tt/r²S)', reference: 'Cooper & Jacob (1946)', appliesTo: 'Simplified well-test analysis',
            inputs: [
              { symbol: 'Q', label: 'Pumping Rate', unit: 'm³/day', default: 1000, min: 0, max: 100000 },
              { symbol: 'T', label: 'Transmissivity', unit: 'm²/day', default: 500, min: 0.1, max: 50000 },
              { symbol: 't', label: 'Time', unit: 'days', default: 1, min: 0, max: 10000 },
              { symbol: 'r', label: 'Distance from Well', unit: 'm', default: 100, min: 0, max: 10000 },
              { symbol: 'S', label: 'Storativity', unit: '—', default: 0.0001, min: 1e-08, max: 0.1 }
            ]
          },
          { id: 134, name: 'Horton Infiltration', equation: 'f(t) = f_c + (f₀-f_c)×e^(-kt)', reference: 'Horton, R.E. (1939)', appliesTo: 'Empirical infiltration capacity',
            inputs: [
              { symbol: 'f_c', label: 'Final Infiltration Rate', unit: 'mm/h', default: 5, min: 0, max: 50 },
              { symbol: 'f₀', label: 'Initial Infiltration Rate', unit: 'mm/h', default: 50, min: 0, max: 500 },
              { symbol: 'k', label: 'Decay Constant', unit: '/h', default: 2, min: 0.01, max: 20 },
              { symbol: 't', label: 'Time', unit: 'h', default: 1, min: 0, max: 100 }
            ]
          },
        ],
      },
      {
        id: 'hazard', number: 23, name: 'Hazard, Risk & Disaster Engineering', color: '#ef4444',
        tools: [
          { id: 135, name: 'Risk = Hazard × Vulnerability × Exposure', equation: 'R = H × V × E', reference: 'UNISDR (2004)', appliesTo: 'Universal risk framework',
            inputs: [
              { symbol: 'H', label: 'Hazard', unit: '—', default: 0.5, min: 0, max: 1 },
              { symbol: 'V', label: 'Vulnerability', unit: '—', default: 0.3, min: 0, max: 1 },
              { symbol: 'E', label: 'Exposure', unit: '—', default: 0.8, min: 0, max: 1 }
            ]
          },
          { id: 136, name: 'Expected Annual Damage', equation: 'EAD = ∫₀¹ D(P)dP', reference: 'Standard risk assessment', appliesTo: 'Dam safety, flood risk, infrastructure planning',
            inputs: [
              { symbol: 'D(P)', label: 'Damage at Exceedance P', unit: '$', default: 1 }
            ]
          },
          { id: 137, name: 'AQI Breakpoint', equation: 'AQI = [(IHi-ILo)/(BPHi-BPLo)]×(Cp-BPLo)+ILo', reference: 'US EPA 40 CFR Part 58', appliesTo: 'Air quality standardization',
            inputs: [
              { symbol: 'I_Hi', label: 'Concentration (Upper)', unit: 'µg/m³', default: 100, min: 0, max: 10000 },
              { symbol: 'I_Lo', label: 'Concentration (Lower)', unit: 'µg/m³', default: 50, min: 0, max: 10000 },
              { symbol: 'BP_Hi', label: 'Breakpoint Upper', unit: 'µg/m³', default: 100, min: 0, max: 10000 },
              { symbol: 'BP_Lo', label: 'Breakpoint Lower', unit: 'µg/m³', default: 50, min: 0, max: 10000 },
              { symbol: 'C_p', label: 'Pollutant Concentration', unit: 'µg/m³', default: 75, min: 0, max: 10000 }
            ]
          },
          { id: 138, name: 'Probable Maximum Precipitation', equation: 'PMP = X̄ + K_p×σ_x', reference: 'Chow, V.T. (1964)', appliesTo: 'Dam safety, extreme rainfall',
            inputs: [
              { symbol: 'X̄', label: 'Mean Precipitation', unit: 'mm', default: 100, min: 0, max: 10000 },
              { symbol: 'K_p', label: 'Frequency Factor', unit: '—', default: 5, min: 0, max: 20 },
              { symbol: 'σ_x', label: 'Precipitation Std Dev', unit: 'mm', default: 30, min: 0, max: 1000 }
            ]
          },
          { id: 139, name: 'Palmer Drought Severity Index', equation: 'X_i = 0.897×X_{i-1} + Z/3', reference: 'Palmer, W.C. (1965)', appliesTo: 'Drought monitoring',
            inputs: [
              { symbol: 'X_{i-1}', label: 'Previous PDSI', unit: '—', default: 0, min: -10, max: 10 },
              { symbol: 'Z', label: 'Moisture Anomaly Index', unit: '—', default: 0, min: -10, max: 10 }
            ]
          },
          { id: 140, name: 'Froehlich Dam Breach', equation: 'B_avg = 0.1803×K₀×V_res^0.32×h_b^0.19', reference: 'Froehlich, D.C. (2008)', appliesTo: 'Dam breach outflow estimation',
            inputs: [
              { symbol: 'K₀', label: 'Breach Correction Factor', unit: '—', default: 1.3, min: 0.5, max: 3 },
              { symbol: 'V_res', label: 'Reservoir Volume', unit: 'm³', default: 1000000.0, min: 0, max: 100000000000.0 },
              { symbol: 'h_b', label: 'Breach Height', unit: 'm', default: 30, min: 1, max: 300 }
            ]
          },
        ],
      },
      {
        id: 'dataassim', number: 24, name: 'Data Assimilation & State Estimation', color: '#10b981',
        tools: [
          { id: 141, name: 'Ensemble Kalman Filter', equation: 'x_a = x_f + K(y-Hx_f); K = P_fH^T(HP_fH^T+R)^(-1)', reference: 'Evensen, G. (1994)', appliesTo: 'THE equation that makes a Digital Twin',
            inputs: [
              { symbol: 'x_f', label: 'Forecast State', unit: '—', default: 0 },
              { symbol: 'P_f', label: 'Forecast Error Covariance', unit: '—', default: 1 },
              { symbol: 'y', label: 'Observation', unit: '—', default: 1 },
              { symbol: 'R', label: 'Observation Error Covariance', unit: '—', default: 1 },
              { symbol: 'x_b', label: 'Background State', unit: '—', default: 0 }
            ]
          },
          { id: 142, name: 'Optimal Interpolation', equation: 'x_a = x_b + BH^T(HBH^T+R)^(-1)(y-Hx_b)', reference: 'Lorenz, E. (1969)', appliesTo: 'Spatial analysis of observations',
            inputs: [
              { symbol: 'x_b', label: 'Background State', unit: '—', default: 0 },
              { symbol: 'y', label: 'Observation', unit: '—', default: 1 },
              { symbol: 'B', label: 'Background Error Covariance', unit: '—', default: 1 },
              { symbol: 'R', label: 'Observation Error Covariance', unit: '—', default: 1 }
            ]
          },
          { id: 143, name: '4D-Var Cost Function', equation: 'J(x) = ½(x-x_b)^TB^(-1)(x-x_b) + ½Σ(yᵢ-Hᵢ(x))^TRᵢ^(-1)(yᵢ-Hᵢ(x))', reference: 'Le Dimet & Talagrand (1986)', appliesTo: 'Weather analysis gold standard (ECMWF)',
            inputs: [
              { symbol: 'x', label: 'Analysis State', unit: '—', default: 0 },
              { symbol: 'x_b', label: 'Background State', unit: '—', default: 0 },
              { symbol: 'B', label: 'Background Error Covariance', unit: '—', default: 1 },
              { symbol: 'y', label: 'Observation', unit: '—', default: 1 },
              { symbol: 'R', label: 'Observation Error Covariance', unit: '—', default: 1 }
            ]
          },
          { id: 144, name: 'Shannon Information Entropy', equation: 'H(X) = -Σp(x)×log₂p(x)', reference: 'Shannon, C.E. (1948)', appliesTo: 'Data source value assessment for DT-Earth',
            inputs: [
              { symbol: 'p(x)', label: 'Probability of X', unit: '—', default: 0.5, min: 0, max: 1 },
              { symbol: 'p(y)', label: 'Probability of Y', unit: '—', default: 0.5, min: 0, max: 1 },
              { symbol: 'p(x,y)', label: 'Joint Probability', unit: '—', default: 0.25, min: 0, max: 1 }
            ]
          },
        ],
      },
      {
        id: 'signal', number: 25, name: 'Signal Processing & Communications', color: '#6366f1',
        tools: [
          { id: 145, name: 'Free-Space Path Loss', equation: 'FSPL(dB) = 32.45 + 20log₁₀(d_km) + 20log₁₀(f_GHz)', reference: 'Fundamental electromagnetics', appliesTo: 'Satellite link budget',
            inputs: [
              { symbol: 'd_km', label: 'Distance', unit: 'km', default: 100, min: 0, max: 100000 },
              { symbol: 'f_GHz', label: 'Frequency', unit: 'GHz', default: 2, min: 0, max: 100 }
            ]
          },
          { id: 146, name: 'Klobuchar Ionospheric Delay', equation: 'Delay = [5×10⁻⁹ + A×(1-x²/2+x⁴/24)] s', reference: 'Klobuchar, J.A. (1987)', appliesTo: 'Single-frequency GPS correction',
            inputs: [
              { symbol: 'A', label: 'Amplitude', unit: 's', default: 5e-09, min: 0, max: 1e-06 },
              { symbol: 'x', label: 'Local Time Factor', unit: '—', default: 0.5, min: 0, max: 2 }
            ]
          },
          { id: 147, name: 'Doppler Shift', equation: 'Δf = f₀×v_rel/c', reference: 'Doppler, C.J. (1842)', appliesTo: 'Satellite tracking, GNSS',
            inputs: [
              { symbol: 'f₀', label: 'Transmitted Frequency', unit: 'Hz', default: 1600000000.0, min: 0, max: 1000000000000.0 },
              { symbol: 'v_rel', label: 'Relative Velocity', unit: 'm/s', default: 1000, min: -30000, max: 30000 }
            ]
          },
        ],
      },
      {
        id: 'math', number: 26, name: 'Mathematical Frameworks', color: '#8b5cf6',
        tools: [
          { id: 148, name: 'Hohmann Transfer', equation: 'Δv₁ = √(GM/r₁)×[√(2r₂/(r₁+r₂))-1]', reference: 'Hohmann, W. (1925)', appliesTo: 'Optimal orbit transfer planning',
            inputs: [
              { symbol: 'GM', label: 'Gravitational Parameter', unit: 'm³/s²', default: 398600000000000.0, min: 0, max: 1000000000000000.0 },
              { symbol: 'r₁', label: 'Initial Orbit Radius', unit: 'm', default: 7000000.0, min: 6000000.0, max: 10000000.0 },
              { symbol: 'r₂', label: 'Target Orbit Radius', unit: 'm', default: 42000000.0, min: 6000000.0, max: 100000000.0 }
            ]
          },
          { id: 149, name: 'Lagrange Points (L1-L5)', equation: '5th-order polynomial for collinear points', reference: 'Lagrange, J.L. (1772)', appliesTo: 'Mission planning (JWST at L2, solar observatories)',
            inputs: [
              { symbol: 'γ', label: 'Mass Ratio Parameter', unit: '—', default: 0.5, min: 0, max: 1 }
            ]
          },
          { id: 150, name: 'Mutual Information', equation: 'I(X;Y) = Σp(x,y)×log(p(x,y)/(p(x)×p(y)))', reference: 'Shannon, C.E. (1948)', appliesTo: 'Quantifying data source value for model improvement',
            inputs: [
              { symbol: 'p(x)', label: 'Probability of X', unit: '—', default: 0.5, min: 0, max: 1 },
              { symbol: 'p(y)', label: 'Probability of Y', unit: '—', default: 0.5, min: 0, max: 1 },
              { symbol: 'p(x,y)', label: 'Joint Probability', unit: '—', default: 0.25, min: 0, max: 1 }
            ]
          },
        ],
      },
    ],
  },
];

// Derive + attach analytical-tool metadata (study area / time / filters / auto-fill)
// once the PARTS tree above is fully initialized.
attachAnalysisMetadata();
