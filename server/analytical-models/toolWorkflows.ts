/**
 * Tool Workflow Framework
 * Transforms 150 equations into complete scientific analytical tools.
 *
 * Each tool passes through a 7-stage pipeline:
 *  1. Input Validation     — range, type, physical-plausibility checks
 *  2. Preprocessing         — unit conversion, derived-parameter computation
 *  3. Computation           — the peer-reviewed equation (engine.ts)
 *  4. Post-processing        — classification, unit normalisation
 *  5. Quality Control       — result sanity checks, outlier detection
 *  6. Uncertainty Estimation — error propagation / empirical RMSE
 *  7. Interpretation        — contextual analysis + scientific recommendations
 */

import type { ComputeResult } from './engine';

// ══════════════════════════════════════════════════════════════════
//  Types
// ══════════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  validatedParams: Record<string, number>;
}

export interface ClassificationBand {
  min: number;
  max: number;
  label: string;
  color: string;
  description: string;
}

export interface UncertaintyEstimate {
  method: 'analytical' | 'empirical' | 'qualitative';
  rmse?: number;
  rmseUnit?: string;
  confidenceInterval?: { lower: number; upper: number; level: number };
  contributingFactors: Array<{ factor: string; contribution: string }>;
  overallAssessment: string;
}

export interface QualityControlResult {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; message: string; severity: 'info' | 'warning' | 'error' }>;
}

export interface InterpretationResult {
  classification?: { label: string; color: string; description: string };
  contextualAnalysis: string;
  recommendations: string[];
  comparisonBaseline?: { label: string; value: number; unit: string; deviation: string };
}

export interface WorkflowResult extends ComputeResult {
  validation: ValidationResult;
  qualityControl: QualityControlResult;
  uncertainty: UncertaintyEstimate;
  interpretation: InterpretationResult;
  workflowLog: string[];
  dataQualityScore: number;
  processingTimeMs: number;
}

// ══════════════════════════════════════════════════════════════════
//  Domain-level templates
// ══════════════════════════════════════════════════════════════════

interface DomainTemplate {
  classificationBands: ClassificationBand[];
  uncertainty: UncertaintyEstimate;
  qcValidRange: [number, number];
  qcChecks: Array<{ name: string; test: (r: number) => boolean; message: string; severity: 'info' | 'warning' | 'error' }>;
  recommendations: (result: number) => string[];
  contextualAnalysis: (result: number) => string;
}

/** A generic template for domains without a specific definition. */
const GENERIC_TEMPLATE: DomainTemplate = {
  classificationBands: [
    { min: -Infinity, max: 0, label: 'Low', color: '#3b82f6', description: 'Low value' },
    { min: 0, max: 1, label: 'Normal', color: '#22c55e', description: 'Normal range' },
    { min: 1, max: Infinity, label: 'High', color: '#eab308', description: 'Elevated value' },
  ],
  uncertainty: {
    method: 'qualitative',
    contributingFactors: [
      { factor: 'Input data quality', contribution: 'Depends on source data accuracy' },
      { factor: 'Model assumptions', contribution: 'See assumptions section' },
    ],
    overallAssessment: 'Uncertainty assessment requires domain-specific validation data.',
  },
  qcValidRange: [-Infinity, Infinity],
  qcChecks: [
    { name: 'Non-finite check', test: (r) => Number.isFinite(r), message: 'Result is NaN or Infinity', severity: 'error' },
  ],
  recommendations: () => ['Cross-validate with authoritative data sources for this domain.'],
  contextualAnalysis: (r) => `Result value: ${r.toFixed(4)}. Interpret within the context of the specific equation and its assumptions.`,
};

const DOMAIN_TEMPLATES: Record<number, DomainTemplate> = {};

// ── Domain 1: Atmospheric Science ──
DOMAIN_TEMPLATES[1] = {
  classificationBands: [
    { min: -Infinity, max: 0, label: 'Freezing', color: '#3b82f6', description: 'Below freezing' },
    { min: 0, max: 10, label: 'Cold', color: '#60a5fa', description: 'Cool conditions' },
    { min: 10, max: 25, label: 'Temperate', color: '#22c55e', description: 'Moderate temperature' },
    { min: 25, max: 35, label: 'Warm', color: '#eab308', description: 'Warm conditions' },
    { min: 35, max: 50, label: 'Hot', color: '#f97316', description: 'Hot surface' },
    { min: 50, max: Infinity, label: 'Extreme', color: '#ef4444', description: 'Extreme heat' },
  ],
  uncertainty: {
    method: 'empirical', rmse: 0.93, rmseUnit: 'deg C',
    confidenceInterval: { lower: -0.93, upper: 0.93, level: 0.68 },
    contributingFactors: [
      { factor: 'Emissivity uncertainty', contribution: '+/- 0.5-1.5 C per 1% error' },
      { factor: 'Water vapor estimation', contribution: '+/- 0.2-0.5 C' },
      { factor: 'Atmospheric profile', contribution: '+/- 0.3 C' },
    ],
    overallAssessment: 'RMSE of 0.93 C under standard conditions; increases for heterogeneous surfaces.',
  },
  qcValidRange: [-80, 80],
  qcChecks: [
    { name: 'Physical range', test: (r) => r > -80 && r < 80, message: 'Result outside physical temperature range', severity: 'error' },
    { name: 'Non-finite check', test: (r) => Number.isFinite(r), message: 'Result is NaN or Infinity', severity: 'error' },
  ],
  recommendations: (r) => {
    const recs: string[] = [];
    if (r > 35) recs.push('Heat stress conditions detected. Consider urban heat island mitigation or irrigation.');
    if (r < 0) recs.push('Freezing surface. Verify against MODIS LST. Snow/ice presence likely.');
    recs.push('For operational use, validate against USGS Collection-2 Level-2 ST product.');
    return recs;
  },
  contextualAnalysis: (r) => {
    if (r > 45) return `Surface temperature of ${r.toFixed(1)}C indicates very hot conditions (desert, urban rooftops, intense solar heating). Vegetation stress likely.`;
    if (r > 25) return `Surface temperature of ${r.toFixed(1)}C reflects warm daytime conditions typical for mid-latitude surfaces under clear sky.`;
    if (r > 10) return `Surface temperature of ${r.toFixed(1)}C indicates temperate conditions. Vegetation likely actively transpiring.`;
    if (r > 0) return `Surface temperature of ${r.toFixed(1)}C is cool, suggesting early morning, high latitude, or elevated terrain.`;
    return `Surface temperature of ${r.toFixed(1)}C is below freezing, indicating snow/ice cover or nighttime winter conditions.`;
  },
};

// ── Domain 2: Hydrology & Oceanography ──
DOMAIN_TEMPLATES[2] = {
  classificationBands: [
    { min: -Infinity, max: 0, label: 'Negligible', color: '#64748b', description: 'No significant flux' },
    { min: 0, max: 1, label: 'Very Low', color: '#3b82f6', description: 'Minimal water flux' },
    { min: 1, max: 5, label: 'Low', color: '#60a5fa', description: 'Below-average flux' },
    { min: 5, max: 10, label: 'Moderate', color: '#22c55e', description: 'Typical conditions' },
    { min: 10, max: 15, label: 'High', color: '#eab308', description: 'Elevated water flux' },
    { min: 15, max: Infinity, label: 'Very High', color: '#ef4444', description: 'Extreme flux' },
  ],
  uncertainty: {
    method: 'empirical', rmse: 15, rmseUnit: '%',
    contributingFactors: [
      { factor: 'Net radiation estimation', contribution: '+/- 10-20%' },
      { factor: 'Wind speed measurement', contribution: '+/- 5-15%' },
      { factor: 'Humidity/VPD', contribution: '+/- 5-10%' },
    ],
    overallAssessment: 'FAO-56 has reported errors of -9% to +40% vs lysimeters; remains the international standard.',
  },
  qcValidRange: [-100, 1000],
  qcChecks: [
    { name: 'Non-negative flux', test: (r) => r >= 0, message: 'Negative water flux — check input parameters', severity: 'warning' },
    { name: 'Physical range', test: (r) => r < 500, message: 'Result exceeds physical maximum', severity: 'error' },
    { name: 'Non-finite check', test: (r) => Number.isFinite(r), message: 'Result is NaN or Infinity', severity: 'error' },
  ],
  recommendations: (r) => {
    const recs: string[] = [];
    if (r > 10) recs.push('High evaporative demand. Schedule irrigation more frequently. Monitor soil moisture.');
    recs.push('Apply crop coefficient Kc to compute actual crop ET from reference ET.');
    recs.push('Cross-validate with Open-Meteo et0_fao_evapotranspiration product.');
    return recs;
  },
  contextualAnalysis: (r) => {
    if (r > 10) return `Water flux of ${r.toFixed(2)} indicates high evaporative demand. Soil moisture depletion will be rapid.`;
    if (r > 5) return `Water flux of ${r.toFixed(2)} represents moderate conditions typical of growing season.`;
    if (r > 1) return `Water flux of ${r.toFixed(2)} is low, suggesting cool/humid/low-radiation conditions.`;
    return `Water flux of ${r.toFixed(2)} is negligible — check for winter conditions or data quality.`;
  },
};

// ── Domain 3: Geophysics & Seismology ──
DOMAIN_TEMPLATES[3] = {
  classificationBands: [
    { min: -Infinity, max: 0, label: 'None', color: '#64748b', description: 'No seismic activity' },
    { min: 0, max: 1, label: 'Micro', color: '#22c55e', description: 'Micro-earthquake' },
    { min: 1, max: 10, label: 'Minor', color: '#84cc16', description: 'Minor activity' },
    { min: 10, max: 100, label: 'Moderate', color: '#eab308', description: 'Moderate seismicity' },
    { min: 100, max: 1000, label: 'High', color: '#f97316', description: 'High seismicity' },
    { min: 1000, max: Infinity, label: 'Very High', color: '#ef4444', description: 'Very high seismicity' },
  ],
  uncertainty: {
    method: 'empirical', rmse: 0.1, rmseUnit: 'magnitude units',
    contributingFactors: [
      { factor: 'Magnitude determination', contribution: '+/- 0.1-0.3 magnitude' },
      { factor: 'Catalog completeness', contribution: 'Varies with threshold/region' },
      { factor: 'b-value estimation', contribution: '+/- 0.1 regional variability' },
    ],
    overallAssessment: 'USGS moment magnitudes have typical uncertainties of +/- 0.1-0.3. b-value has regional variability of +/- 0.1.',
  },
  qcValidRange: [0, Infinity],
  qcChecks: [
    { name: 'Non-negative', test: (r) => r >= 0, message: 'Negative seismic parameter', severity: 'error' },
    { name: 'Non-finite check', test: (r) => Number.isFinite(r), message: 'Result is NaN or Infinity', severity: 'error' },
  ],
  recommendations: (r) => {
    const recs: string[] = [];
    if (r > 100) recs.push('High seismicity detected. Review USGS ShakeMap for ground motion estimates.');
    recs.push('Cross-reference with USGS FDSN catalog. Validate b-value against regional data.');
    recs.push('For deformation analysis, consider InSAR (Sentinel-1) as complementary to seismic catalogs.');
    return recs;
  },
  contextualAnalysis: (r) => {
    if (r > 100) return `Seismic parameter of ${r.toFixed(1)} indicates high seismic activity. Hazard assessment warranted.`;
    if (r > 10) return `Seismic parameter of ${r.toFixed(1)} indicates moderate seismicity, typical of active tectonic margins.`;
    if (r > 0) return `Seismic parameter of ${r.toFixed(1)} indicates low-level seismic activity, consistent with background seismicity.`;
    return 'No significant seismic activity detected.';
  },
};

// ── Domain 4: Remote Sensing & Cryosphere ──
DOMAIN_TEMPLATES[4] = {
  classificationBands: [
    { min: -1, max: -0.2, label: 'Water/Snow', color: '#3b82f6', description: 'Water bodies or snow' },
    { min: -0.2, max: 0.1, label: 'Bare/Sparse', color: '#a8a29e', description: 'Bare soil, rock, built-up' },
    { min: 0.1, max: 0.3, label: 'Sparse Veg', color: '#eab308', description: 'Sparse vegetation' },
    { min: 0.3, max: 0.6, label: 'Moderate Veg', color: '#84cc16', description: 'Moderate vegetation' },
    { min: 0.6, max: 0.8, label: 'Dense Veg', color: '#22c55e', description: 'Dense vegetation, forest' },
    { min: 0.8, max: 1, label: 'Very Dense', color: '#15803d', description: 'Very dense (saturation likely)' },
  ],
  uncertainty: {
    method: 'empirical', rmse: 0.05, rmseUnit: 'index units',
    contributingFactors: [
      { factor: 'Atmospheric correction', contribution: '+/- 0.02-0.05' },
      { factor: 'Bidirectional effects', contribution: '+/- 0.03' },
      { factor: 'Sensor calibration', contribution: '+/- 0.01' },
    ],
    overallAssessment: 'Remote sensing indices have typical uncertainties of +/- 0.02-0.05. Pre-computed MODIS products reduce noise.',
  },
  qcValidRange: [-1, 1],
  qcChecks: [
    { name: 'Index range', test: (r) => r >= -1 && r <= 1, message: 'Index outside [-1, +1] valid range', severity: 'error' },
    { name: 'Non-finite check', test: (r) => Number.isFinite(r), message: 'Result is NaN or Infinity', severity: 'error' },
  ],
  recommendations: (r) => {
    const recs: string[] = [];
    if (r > 0.7) recs.push('Index saturation detected. Use EVI for high-biomass canopies.');
    if (r < 0) recs.push('Negative value — verify water body or cloud contamination. Use NDWI for confirmation.');
    recs.push('For time-series, use MODIS MOD13 16-day composites for cloud-free continuity.');
    recs.push('For 10m resolution, compute from raw Sentinel-2 L2A bands via the Prithvi engine.');
    return recs;
  },
  contextualAnalysis: (r) => {
    if (r > 0.6) return `Index of ${r.toFixed(3)} indicates dense, healthy vegetation. NDVI saturates above 0.8 — EVI may be better.`;
    if (r > 0.3) return `Index of ${r.toFixed(3)} indicates moderate vegetation cover (croplands, savannas, regenerating forests).`;
    if (r > 0.1) return `Index of ${r.toFixed(3)} indicates sparse vegetation (shrubland, grassland, stressed crops).`;
    if (r >= 0) return `Index of ${r.toFixed(3)} indicates bare soil, rock, or built-up surfaces.`;
    return `Index of ${r.toFixed(3)} is negative, indicating water bodies, snow, or cloud cover.`;
  },
};

// ══════════════════════════════════════════════════════════════════
//  Per-Tool Workflow Definitions
// ══════════════════════════════════════════════════════════════════

export type VizType =
  | 'scalar' | 'heatmap' | 'profile' | 'timeseries' | 'contour'
  | 'vector' | 'histogram' | 'scatter' | 'spectrum' | 'rose'
  | 'gauge' | 'bar' | 'distribution' | 'cross-section' | 'table';

export interface ToolContext {
  lat: number;
  lon: number;
  dataSources: string[];
  fetchedParams: Record<string, unknown>;
  studyAreaMode?: string;
  timeGranularity?: string | null;
  startDate?: string;
  endDate?: string;
}

export interface WorkflowOutput {
  primary: { value: number; unit?: string; label: string };
  secondary?: Array<{ key: string; value: number; unit?: string; label: string }>;
  classification?: { label: string; color: string; description: string };
  qualityControl: QualityControlResult;
  uncertainty: UncertaintyEstimate;
  interpretation: InterpretationResult;
  visualization: {
    type: VizType;
    data?: Record<string, unknown>;
    metadata?: Record<string, string>;
  };
  metadata: {
    methodology: string;
    assumptions: string[];
    limitations: string[];
    references: string[];
    preprocessingNotes: string[];
  };
  workflowLog: string[];
  dataQualityScore: number;
  processingTimeMs: number;
}

export interface ToolWorkflowDef {
  toolId: number;
  name: string;
  vizType: VizType;
  classificationBands: ClassificationBand[];
  validate: (inputs: Record<string, unknown>, ctx: ToolContext) => ValidationResult;
  preprocess: (inputs: Record<string, unknown>, ctx: ToolContext, log: string[]) => Record<string, unknown>;
  postProcess: (result: number, baseResult: ComputeResult, ctx: ToolContext, log: string[]) => {
    classification?: { label: string; color: string; description: string };
    secondary?: Array<{ key: string; value: number; unit?: string; label: string }>;
    vizData?: Record<string, unknown>;
  };
  qualityCheck: (result: number, ctx: ToolContext) => QualityControlResult;
  estimateUncertainty: (result: number, inputs: Record<string, unknown>, ctx: ToolContext) => UncertaintyEstimate;
  interpret: (result: number, ctx: ToolContext) => InterpretationResult;
  metadata: {
    methodology: string;
    assumptions: string[];
    limitations: string[];
    references: string[];
    preprocessingNotes: string[];
  };
  dependencies?: number[];
}

// ══════════════════════════════════════════════════════════════════
//  Helper utilities for building per-tool definitions
// ══════════════════════════════════════════════════════════════════

function makeQC(checks: Array<{ name: string; passed: boolean; message: string; severity: 'info' | 'warning' | 'error' }>): QualityControlResult {
  return {
    passed: checks.every(c => c.passed || c.severity === 'info'),
    checks,
  };
}

function rangeQC(result: number, min: number, max: number, label: string): { name: string; passed: boolean; message: string; severity: 'info' | 'warning' | 'error' } {
  const passed = Number.isFinite(result) && result >= min && result <= max;
  return {
    name: label,
    passed,
    message: passed ? `${label}: within valid range [${min}, ${max}]` : `${label}: ${result} outside range [${min}, ${max}]`,
    severity: passed ? 'info' : (Number.isFinite(result) ? 'warning' : 'error'),
  };
}

function classify(result: number, bands: ClassificationBand[]): { label: string; color: string; description: string } | undefined {
  for (const band of bands) {
    if (result >= band.min && result < band.max) {
      return { label: band.label, color: band.color, description: band.description };
    }
  }
  return undefined;
}

function qualityScore(dataSources: number[], warnings: number, errors: number): number {
  let score = 0.5;
  score += Math.min(0.3, dataSources.length * 0.06);
  score -= Math.min(0.2, warnings * 0.03);
  score -= Math.min(0.2, errors * 0.1);
  return Math.max(0, Math.min(1, score));
}

export { GENERIC_TEMPLATE, DOMAIN_TEMPLATES, makeQC, rangeQC, classify, qualityScore, type DomainTemplate };
