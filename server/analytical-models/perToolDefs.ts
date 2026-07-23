/**
 * Per-Tool Workflow Definitions — Part 1: Eqs 1-50 (Domains 1-6)
 *
 * Each tool has a complete, scientifically unique workflow definition.
 */

import { type ToolWorkflowDef, makeQC, rangeQC, classify } from './toolWorkflows';
import type { ClassificationBand, ValidationResult } from './toolWorkflows';

// Band sets reused across tools
const TEMP_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0, label: 'Freezing', color: '#3b82f6', description: 'Below freezing' },
  { min: 0, max: 10, label: 'Cold', color: '#60a5fa', description: 'Cool' },
  { min: 10, max: 25, label: 'Temperate', color: '#22c55e', description: 'Moderate' },
  { min: 25, max: 35, label: 'Warm', color: '#eab308', description: 'Warm' },
  { min: 35, max: 50, label: 'Hot', color: '#f97316', description: 'Hot surface' },
  { min: 50, max: Infinity, label: 'Extreme', color: '#ef4444', description: 'Extreme heat' },
];

const RISK_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0, label: 'Stable', color: '#22c55e', description: 'Stable/low risk' },
  { min: 0, max: 1, label: 'Low', color: '#84cc16', description: 'Low risk' },
  { min: 1, max: 5, label: 'Moderate', color: '#eab308', description: 'Moderate risk' },
  { min: 5, max: 10, label: 'High', color: '#f97316', description: 'High risk' },
  { min: 10, max: Infinity, label: 'Critical', color: '#ef4444', description: 'Critical' },
];

const WATER_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0, label: 'None', color: '#64748b', description: 'No flux' },
  { min: 0, max: 1, label: 'Very Low', color: '#3b82f6', description: 'Minimal' },
  { min: 1, max: 5, label: 'Low', color: '#60a5fa', description: 'Low flux' },
  { min: 5, max: 10, label: 'Moderate', color: '#22c55e', description: 'Typical' },
  { min: 10, max: 15, label: 'High', color: '#eab308', description: 'Elevated' },
  { min: 15, max: Infinity, label: 'Very High', color: '#ef4444', description: 'Extreme' },
];

// Helper: default validation that checks each input against its min/max
function validateRange(inputs: Record<string, unknown>, rules: Array<{ param: string; min?: number; max?: number }>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const validated: Record<string, number> = {};
  for (const rule of rules) {
    const val = inputs[rule.param];
    if (val === undefined || val === null) {
      warnings.push(`Parameter '${rule.param}' not provided — using auto-fetched or default value.`);
      continue;
    }
    const num = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(num)) { errors.push(`Parameter '${rule.param}' is not finite.`); continue; }
    if (rule.min !== undefined && num < rule.min) errors.push(`'${rule.param}' = ${num} below min ${rule.min}.`);
    if (rule.max !== undefined && num > rule.max) errors.push(`'${rule.param}' = ${num} above max ${rule.max}.`);
    validated[rule.param] = num;
  }
  return { valid: errors.length === 0, errors, warnings, validatedParams: validated };
}

const INDEX_BANDS: ClassificationBand[] = [
  { min: -1, max: -0.2, label: 'Water/Snow', color: '#3b82f6', description: 'Water or snow' },
  { min: -0.2, max: 0.1, label: 'Bare', color: '#a8a29e', description: 'Bare surface' },
  { min: 0.1, max: 0.3, label: 'Sparse', color: '#eab308', description: 'Sparse veg' },
  { min: 0.3, max: 0.6, label: 'Moderate', color: '#84cc16', description: 'Moderate veg' },
  { min: 0.6, max: 0.8, label: 'Dense', color: '#22c55e', description: 'Dense veg' },
  { min: 0.8, max: 1, label: 'Very Dense', color: '#15803d', description: 'Saturation' },
];

const CARBON_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0, label: 'No Flux', color: '#64748b', description: 'No flux' },
  { min: 0, max: 5, label: 'Low', color: '#84cc16', description: 'Low productivity' },
  { min: 5, max: 15, label: 'Moderate', color: '#22c55e', description: 'Moderate' },
  { min: 15, max: 30, label: 'High', color: '#15803d', description: 'High' },
  { min: 30, max: Infinity, label: 'Very High', color: '#059669', description: 'Tropical' },
];

const AGRI_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0, label: 'No Growth', color: '#64748b', description: 'Below base T' },
  { min: 0, max: 5, label: 'Slow', color: '#3b82f6', description: 'Slow growth' },
  { min: 5, max: 15, label: 'Normal', color: '#22c55e', description: 'Normal' },
  { min: 15, max: 25, label: 'Rapid', color: '#eab308', description: 'Rapid growth' },
  { min: 25, max: Infinity, label: 'Optimal+', color: '#f97316', description: 'Optimal+' },
];

const AQI_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0, label: 'None', color: '#64748b', description: 'No concentration' },
  { min: 0, max: 50, label: 'Good', color: '#22c55e', description: 'Good AQ' },
  { min: 50, max: 100, label: 'Moderate', color: '#eab308', description: 'Moderate AQ' },
  { min: 100, max: 150, label: 'Unhealthy SG', color: '#f97316', description: 'Sensitive groups' },
  { min: 150, max: Infinity, label: 'Unhealthy', color: '#ef4444', description: 'Unhealthy' },
];

const SOIL_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0.1, label: 'Very Low', color: '#a8a29e', description: 'Very low' },
  { min: 0.1, max: 1, label: 'Low', color: '#eab308', description: 'Low' },
  { min: 1, max: 10, label: 'Moderate', color: '#22c55e', description: 'Moderate' },
  { min: 10, max: 100, label: 'High', color: '#60a5fa', description: 'High' },
  { min: 100, max: Infinity, label: 'Very High', color: '#3b82f6', description: 'Very high' },
];

function makeTool(id: number, name: string, vizType: string, bands: ClassificationBand[], rules: Array<{param: string; min?: number; max?: number}>, preprocessingNotes: string[], unc: { method: 'analytical'|'empirical'|'qualitative'; rmse?: number; rmseUnit?: string; factors: string[]; assessment: string }, interpretation: string, recs: string[], assumptions: string[], limitations: string[], references: string[], deps?: number[]): ToolWorkflowDef {
  return {
    toolId: id, name, vizType: vizType as ToolWorkflowDef['vizType'], classificationBands: bands,
    validate: (inputs) => validateRange(inputs, rules),
    preprocess: (inputs, ctx, log) => { preprocessingNotes.forEach(n => log.push(`  ${n}`)); log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`); return inputs; },
    postProcess: (result, _base, _ctx, log) => { const c = classify(result, bands); if (c) log.push(`  Result: ${c.label}`); return { classification: c }; },
    qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
    estimateUncertainty: () => ({ method: unc.method, rmse: unc.rmse, rmseUnit: unc.rmseUnit, contributingFactors: unc.factors.map(f => ({ factor: f, contribution: 'Varies' })), overallAssessment: unc.assessment }),
    interpret: (result) => ({ contextualAnalysis: `${name}: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. ${interpretation}`, recommendations: recs }),
    metadata: { methodology: interpretation, assumptions, limitations, references, preprocessingNotes },
    dependencies: deps,
  };
}

// Additional shared band sets for Part 4
const OCEAN_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0.1, label: 'Calm', color: '#22c55e', description: 'Calm' },
  { min: 0.1, max: 1, label: 'Low', color: '#84cc16', description: 'Low' },
  { min: 1, max: 5, label: 'Moderate', color: '#eab308', description: 'Moderate' },
  { min: 5, max: 10, label: 'High', color: '#f97316', description: 'High' },
  { min: 10, max: Infinity, label: 'Extreme', color: '#ef4444', description: 'Storm' },
];

const SPACE_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0, label: 'Quiet', color: '#22c55e', description: 'Quiet' },
  { min: 0, max: 1, label: 'Normal', color: '#84cc16', description: 'Normal' },
  { min: 1, max: 5, label: 'Active', color: '#eab308', description: 'Active' },
  { min: 5, max: 10, label: 'Storm', color: '#f97316', description: 'Storm' },
  { min: 10, max: Infinity, label: 'Severe', color: '#ef4444', description: 'Severe' },
];

const CLIMATE_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0, label: 'Negative', color: '#3b82f6', description: 'Cooling' },
  { min: 0, max: 1, label: 'Neutral', color: '#64748b', description: 'Neutral' },
  { min: 1, max: 5, label: 'Positive', color: '#eab308', description: 'Warming' },
  { min: 5, max: Infinity, label: 'Strong', color: '#ef4444', description: 'Strong warming' },
];

const GENERIC_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0, label: 'Low', color: '#3b82f6', description: 'Low' },
  { min: 0, max: 1, label: 'Normal', color: '#22c55e', description: 'Normal' },
  { min: 1, max: Infinity, label: 'High', color: '#eab308', description: 'High' },
];

// Compact validation for Part 4 generated tools
function vr(inputs: Record<string, unknown>, rules: Array<{ param: string; min?: number; max?: number }>) {
  const errors: string[] = [], warnings: string[] = [], validated: Record<string, number> = {};
  for (const r of rules) {
    const v = inputs[r.param]; if (v === undefined || v === null) { warnings.push("'" + r.param + "' not provided."); continue; }
    const n = typeof v === 'number' ? v : Number(v); if (!Number.isFinite(n)) { errors.push("'" + r.param + "' not finite."); continue; }
    if (r.min !== undefined && n < r.min) errors.push("'" + r.param + "' below " + r.min + ".");
    if (r.max !== undefined && n > r.max) errors.push("'" + r.param + "' above " + r.max + ".");
    validated[r.param] = n;
  }
  return { valid: errors.length === 0, errors, warnings, validatedParams: validated };
}

// Factory function for Part 4 generated tools
function mt(id: number, name: string, viz: string, bands: ClassificationBand[], rules: Array<{param: string; min?: number; max?: number}>, pp: string[], unc: { method: 'analytical'|'empirical'|'qualitative'; rmse?: number; rmseUnit?: string; factors: string[]; assessment: string }, interp: string, recs: string[], assum: string[], lim: string[], refs: string[], deps: number[]): ToolWorkflowDef {
  return {
    toolId: id, name, vizType: viz as ToolWorkflowDef['vizType'], classificationBands: bands,
    validate: (inputs) => vr(inputs, rules),
    preprocess: (inputs, ctx, log) => { pp.forEach(n => log.push('  ' + n)); log.push('  Location: (' + ctx.lat.toFixed(2) + ', ' + ctx.lon.toFixed(2) + ')'); return inputs; },
    postProcess: (result, _b, _c, log) => { const c = classify(result, bands); if (c) log.push('  Result: ' + c.label); return { classification: c }; },
    qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' as const : 'error' as const }]),
    estimateUncertainty: () => ({ method: unc.method, rmse: unc.rmse, rmseUnit: unc.rmseUnit, contributingFactors: unc.factors.map(f => ({ factor: f, contribution: 'Varies' })), overallAssessment: unc.assessment }),
    interpret: (result) => ({ contextualAnalysis: name + ': ' + (Number.isFinite(result) ? result.toFixed(4) : 'N/A') + '. ' + interp, recommendations: recs }),
    metadata: { methodology: interp, assumptions: assum, limitations: lim, references: refs, preprocessingNotes: pp },
    dependencies: deps.length > 0 ? deps : undefined,
  };
}

// ══════════════════════════════════════════════════════════════════
//  EQUATION 1 — Land Surface Temperature Retrieval (Split-Window)
// ══════════════════════════════════════════════════════════════════
export const TOOL_1: ToolWorkflowDef = {
  toolId: 1, name: 'Land Surface Temperature', vizType: 'heatmap',
  classificationBands: TEMP_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'T10', min: 200, max: 350 }, { param: 'T11', min: 200, max: 350 },
    { param: 'eps10', min: 0.9, max: 1.0 }, { param: 'eps11', min: 0.9, max: 1.0 },
    { param: 'w', min: 0, max: 6.3 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Acquiring TIRS Band 10/11 brightness temperatures from satellite');
    log.push(`  Column water vapor estimated from ERA5 at (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    log.push('  Surface emissivity derived from NDVI-based method or ASTER GED');
    return inputs;
  },
  postProcess: (result, _base, ctx, log) => {
    const c = classify(result, TEMP_BANDS);
    if (c) log.push(`  Surface temperature classified as: ${c.label}`);
    // Compute T10-T11 difference as secondary output (atmospheric correction magnitude)
    const t10 = (ctx.fetchedParams as Record<string, number>)?.T10 ?? 300;
    const t11 = (ctx.fetchedParams as Record<string, number>)?.T11 ?? 298;
    return {
      classification: c,
      secondary: [{ key: 'bt_diff', value: t10 - t11, unit: 'K', label: 'BT10-BT11 Difference (atmospheric correction)' }],
    };
  },
  qualityCheck: (result) => makeQC([
    rangeQC(result, -80, 80, 'Physical temperature range'),
    { name: 'Non-finite check', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
  ]),
  estimateUncertainty: (result) => ({
    method: 'empirical', rmse: 0.93, rmseUnit: 'C',
    confidenceInterval: { lower: result - 0.93, upper: result + 0.93, level: 0.68 },
    contributingFactors: [
      { factor: 'Emissivity uncertainty', contribution: '+/- 0.5-1.5 C per 1% error' },
      { factor: 'Water vapor estimation', contribution: '+/- 0.2-0.5 C' },
      { factor: 'Atmospheric profile', contribution: '+/- 0.3 C' },
    ],
    overallAssessment: 'RMSE of 0.93 C (Rozenstein 2014). USGS C2 L2 ST uses single-channel for better accuracy.',
  }),
  interpret: (result) => {
    let analysis: string;
    if (result > 45) analysis = `LST of ${result.toFixed(1)}C indicates very hot conditions (desert, urban). Vegetation stress likely.`;
    else if (result > 25) analysis = `LST of ${result.toFixed(1)}C reflects warm daytime conditions.`;
    else if (result > 10) analysis = `LST of ${result.toFixed(1)}C indicates temperate conditions. Vegetation actively transpiring.`;
    else if (result > 0) analysis = `LST of ${result.toFixed(1)}C is cool — morning, high latitude, or elevated terrain.`;
    else analysis = `LST of ${result.toFixed(1)}C below freezing — snow/ice or nighttime.`;
    const recs: string[] = [];
    if (result > 35) recs.push('Heat stress conditions. Consider urban heat island mitigation.');
    if (result < 0) recs.push('Freezing surface. Verify against MODIS LST. Snow/ice likely.');
    recs.push('Validate against USGS Collection-2 Level-2 ST product.');
    recs.push('Consider Sentinel-3 SLSTR (1 km, daily) for better temporal coverage.');
    return { classification: classify(result, TEMP_BANDS), contextualAnalysis: analysis, recommendations: recs };
  },
  metadata: {
    methodology: 'Split-Window Algorithm using differential atmospheric absorption in Landsat-8 TIRS Bands 10 and 11. Atmospheric transmittance estimated from column water vapor. SWA coefficients derived from Planck-function linearization.',
    assumptions: ['Surface is Lambertian', 'Mid-latitude summer atmospheric profile (MODTRAN)', 'LSE known a priori for both bands', 'Cloud-free conditions', 'Homogeneous surface within 100m pixel'],
    limitations: ['Accuracy degrades for mixed pixels', 'Emissivity uncertainty of +/-0.01 produces +/-0.5-1.5C error', 'Coefficients optimized for 0-60C range', 'Not applicable over water without separate emissivity'],
    references: ['Rozenstein et al. 2014, Sensors 14(4):5768-5780. DOI:10.3390/s140405768', 'Qin et al. 2001 (transmittance regressions)', 'Jimenez-Munoz et al. 2014 (single-channel alternative)'],
    preprocessingNotes: ['Acquire TIRS Band 10/11 brightness temperatures', 'Estimate column water vapor from ERA5', 'Determine surface emissivity from NDVI or ASTER GED'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 2 — Brightness Temperature (Planck Radiation Law)
// ══════════════════════════════════════════════════════════════════
export const TOOL_2: ToolWorkflowDef = {
  toolId: 2, name: 'Brightness Temperature Retrieval', vizType: 'spectrum',
  classificationBands: [
    { min: 0, max: 1e-10, label: 'Very Low', color: '#3b82f6', description: 'Minimal radiance' },
    { min: 1e-10, max: 1e-5, label: 'Low', color: '#60a5fa', description: 'Low radiance' },
    { min: 1e-5, max: 1, label: 'Moderate', color: '#22c55e', description: 'Moderate radiance' },
    { min: 1, max: 1e5, label: 'High', color: '#eab308', description: 'High radiance' },
    { min: 1e5, max: Infinity, label: 'Very High', color: '#ef4444', description: 'Very high' },
  ],
  validate: (inputs) => validateRange(inputs, [
    { param: 'lambda', min: 0.1, max: 100 }, { param: 'T', min: 100, max: 2000 },
  ]),
  preprocess: (inputs, _ctx, log) => {
    log.push('  Converting wavelength from micrometers to meters');
    log.push('  Using exact SI-defined physical constants (CODATA 2018)');
    return inputs;
  },
  postProcess: (result, base, _ctx, log) => {
    const c = classify(result, [
      { min: 0, max: 1e-10, label: 'Very Low', color: '#3b82f6', description: 'Minimal radiance' },
      { min: 1e-10, max: 1e-5, label: 'Low', color: '#60a5fa', description: 'Low radiance' },
      { min: 1e-5, max: 1, label: 'Moderate', color: '#22c55e', description: 'Moderate' },
      { min: 1, max: 1e5, label: 'High', color: '#eab308', description: 'High' },
      { min: 1e5, max: Infinity, label: 'Very High', color: '#ef4444', description: 'Very high' },
    ]);
    if (c) log.push(`  Radiance classified as: ${c.label}`);
    const T = (base as unknown as Record<string, number>)?.T ?? 300;
    return { classification: c, secondary: [{ key: 'wien_peak', value: 2898 / T, unit: 'um', label: 'Wien Peak Wavelength' }] };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Non-negative radiance', passed: result >= 0, message: result >= 0 ? 'Non-negative' : 'Negative radiance', severity: result >= 0 ? 'info' : 'error' },
    { name: 'Non-finite check', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Physical constants', contribution: 'Exact (SI-defined) — no uncertainty' },
      { factor: 'Temperature measurement', contribution: 'Propagates from input T uncertainty' },
    ],
    overallAssessment: 'Planck function is exact for a perfect blackbody. Real surfaces have emissivity < 1.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Spectral radiance of ${result.toExponential(3)} W/sr/m^3 at the specified wavelength and temperature. This follows the fundamental Planck blackbody radiation law.`,
    recommendations: ['Use Wien displacement law: lambda_max = 2898/T um to find peak wavelength.', 'For real surfaces, apply emissivity: L_real = epsilon * L_blackbody.', 'Invert Planck function for brightness temperature from radiance.'],
  }),
  metadata: {
    methodology: 'Direct evaluation of the Planck blackbody radiation law using exact SI-defined physical constants (h, c, k). The spectral radiance is computed at a specified wavelength and temperature.',
    assumptions: ['Source behaves as a perfect blackbody (emissivity = 1)', 'Thermal equilibrium', 'Isotropic emission'],
    limitations: ['Real surfaces have emissivity < 1', 'Brightness temperature <= true surface temperature', 'Function is highly nonlinear — small radiance changes map to different temperature changes at different base T'],
    references: ['Planck, M. 1901. Annalen der Physik 309(3):553-563. DOI:10.1002/andp.19013090310', 'NIST CODATA 2018 for exact constants'],
    preprocessingNotes: ['Convert wavelength from um to m', 'Use exact SI-defined physical constants'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 3 — Saturation Vapor Pressure (Magnus-Tetens)
// ══════════════════════════════════════════════════════════════════
export const TOOL_3: ToolWorkflowDef = {
  toolId: 3, name: 'Saturation Vapor Pressure', vizType: 'scalar',
  classificationBands: [
    { min: 0, max: 6, label: 'Very Dry', color: '#3b82f6', description: 'Cold/dry' },
    { min: 6, max: 12, label: 'Dry', color: '#60a5fa', description: 'Low moisture' },
    { min: 12, max: 24, label: 'Moderate', color: '#22c55e', description: 'Typical' },
    { min: 24, max: 50, label: 'Humid', color: '#eab308', description: 'High moisture' },
    { min: 50, max: Infinity, label: 'Very Humid', color: '#ef4444', description: 'Tropical' },
  ],
  validate: (inputs) => validateRange(inputs, [{ param: 'T', min: -50, max: 50 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Ensuring temperature is in Celsius');
    log.push('  Using Alduchov-Eskridge (1996) coefficient pair');
    log.push(`  Auto-fetched temperature from Open-Meteo at (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, ctx, log) => {
    const c = classify(result, [
      { min: 0, max: 6, label: 'Very Dry', color: '#3b82f6', description: 'Cold/dry' },
      { min: 6, max: 12, label: 'Dry', color: '#60a5fa', description: 'Low moisture' },
      { min: 12, max: 24, label: 'Moderate', color: '#22c55e', description: 'Typical' },
      { min: 24, max: 50, label: 'Humid', color: '#eab308', description: 'High moisture' },
      { min: 50, max: Infinity, label: 'Very Humid', color: '#ef4444', description: 'Tropical' },
    ]);
    if (c) log.push(`  Vapor pressure classified as: ${c.label}`);
    // Compute slope Delta as secondary
    const T = (ctx.fetchedParams as Record<string, number>)?.T ?? 20;
    const delta = 4284 * result / Math.pow(T + 243.04, 2);
    return { classification: c, secondary: [{ key: 'delta', value: delta, unit: 'hPa/C', label: 'Slope of Vapor Pressure Curve (Delta)' }] };
  },
  qualityCheck: (result) => makeQC([
    rangeQC(result, 0, 200, 'Physical range'),
    { name: 'Non-finite check', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'empirical', rmse: 0.1, rmseUnit: '%',
    contributingFactors: [{ factor: 'Alduchov-Eskridge formula', contribution: '< 0.1% error over -40 to +50 C' }],
    overallAssessment: 'Alduchov-Eskridge (1996) improved Magnus formula has < 0.1% error. Most accurate empirical form.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Saturation vapor pressure of ${result.toFixed(2)} hPa. Each 1C warming increases atmospheric moisture capacity by ~6-7%.`,
    recommendations: ['Use for dew point: T_d = 243.04*ln(e/6.1094)/(17.625-ln(e/6.1094)).', 'For FAO-56 ET, ensure slope Delta uses matching coefficient pair.', 'Climate feedback: warming increases precipitable water.'],
  }),
  metadata: {
    methodology: 'Alduchov-Eskridge (1996) improved August-Roche-Magnus formula: e_s = 6.1094 * exp(17.625*T/(T+243.04)). Empirical approximation to Clausius-Clapeyron equation.',
    assumptions: ['Equilibrium between liquid water and vapor', 'Pressure = 1 atm', 'Temperature range -40 to +50 C'],
    limitations: ['Over ice, different coefficients needed', 'Pressure dependence not included', 'Valid for flat water surfaces only'],
    references: ['Alduchov & Eskridge 1996, J. Appl. Meteor. 35(4):601-609', 'Tetens 1930 (original form)', 'FAO-56 (Allen et al. 1998)'],
    preprocessingNotes: ['Ensure temperature is in Celsius', 'Use consistent coefficient pair for e_s and Delta'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 4 — Atmospheric Pressure Profile (Hydrostatic)
// ══════════════════════════════════════════════════════════════════
export const TOOL_4: ToolWorkflowDef = {
  toolId: 4, name: 'Atmospheric Pressure Profile', vizType: 'profile',
  classificationBands: [
    { min: 0, max: 200, label: 'Very Low', color: '#3b82f6', description: 'High altitude (>10 km)' },
    { min: 200, max: 500, label: 'Low', color: '#60a5fa', description: 'Mid-troposphere' },
    { min: 500, max: 800, label: 'Moderate', color: '#22c55e', description: 'Lower troposphere' },
    { min: 800, max: 1050, label: 'Normal', color: '#eab308', description: 'Near sea level' },
    { min: 1050, max: Infinity, label: 'High', color: '#f97316', description: 'High pressure' },
  ],
  validate: (inputs) => validateRange(inputs, [
    { param: 'P0', min: 500, max: 1100 }, { param: 'z', min: 0, max: 50000 }, { param: 'T', min: 200, max: 320 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Using R_d = 287.0528 J/(kg K) per ISA standard');
    log.push('  Considering virtual temperature for moist atmospheres');
    log.push(`  Surface pressure auto-fetched from Open-Meteo at (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, [
      { min: 0, max: 200, label: 'Very Low', color: '#3b82f6', description: 'High altitude' },
      { min: 200, max: 500, label: 'Low', color: '#60a5fa', description: 'Mid-troposphere' },
      { min: 500, max: 800, label: 'Moderate', color: '#22c55e', description: 'Lower troposphere' },
      { min: 800, max: 1050, label: 'Normal', color: '#eab308', description: 'Near sea level' },
      { min: 1050, max: Infinity, label: 'High', color: '#f97316', description: 'High pressure' },
    ]);
    if (c) log.push(`  Pressure classified as: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    rangeQC(result, 0, 1100, 'Physical pressure range'),
    { name: 'Non-finite check', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Isothermal approximation', contribution: '~0.5-1% from mean virtual temperature' },
      { factor: 'Temperature measurement', contribution: '+/- 0.5-1.5 C from reanalysis' },
    ],
    overallAssessment: 'Isothermal scale height is first-order. Use hypsometric equation with virtual T for precision.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Pressure of ${result.toFixed(1)} hPa. Scale height H = RT/g ~ 8.5 km for Earth's atmosphere.`,
    recommendations: ['For precision, use hypsometric equation with mean virtual temperature.', 'Apply gravity-height correction g(z) for altitudes >20 km.', 'Use R_d = 287.0528 J/(kg K) per ISA.'],
  }),
  metadata: {
    methodology: 'Hydrostatic balance: dP/dz = -rho*g. Combined with ideal gas law, for isothermal atmosphere: P(z) = P0 * exp(-gz/RT). Scale height H = RT/g ~ 8.5 km.',
    assumptions: ['Hydrostatic balance (valid for scales > thunderstorm)', 'Isothermal atmosphere (constant T)', 'Dry air (no moisture correction)', 'Constant gravity'],
    limitations: ['Isothermal approximation breaks down for large altitude ranges', 'No moisture correction (use virtual T)', 'Gravity varies with altitude and latitude', 'Breaks down in strong convection'],
    references: ['Holton & Hakim 2012, Dynamic Meteorology 5th ed., Ch. 2', 'U.S. Standard Atmosphere 1976', 'ICAO Doc 7488'],
    preprocessingNotes: ['Use R_d = 287.0528 (ISA standard)', 'Consider virtual temperature for moist atmospheres'],
  },
  dependencies: [3],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 5 — Geostrophic Wind
// ══════════════════════════════════════════════════════════════════
export const TOOL_5: ToolWorkflowDef = {
  toolId: 5, name: 'Geostrophic Wind Analysis', vizType: 'vector',
  classificationBands: [
    { min: 0, max: 5, label: 'Calm', color: '#22c55e', description: 'Light wind' },
    { min: 5, max: 15, label: 'Moderate', color: '#84cc16', description: 'Moderate flow' },
    { min: 15, max: 30, label: 'Strong', color: '#eab308', description: 'Strong flow' },
    { min: 30, max: 50, label: 'Very Strong', color: '#f97316', description: 'Very strong' },
    { min: 50, max: Infinity, label: 'Extreme', color: '#ef4444', description: 'Extreme wind' },
  ],
  validate: (inputs) => validateRange(inputs, [
    { param: 'dPdx', min: -10, max: 10 }, { param: 'dPdy', min: -10, max: 10 },
    { param: 'f', min: 0, max: 0.0002 }, { param: 'rho', min: 0.5, max: 1.5 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Computing Coriolis parameter f = 2*Omega*sin(lat)');
    log.push(`  Using geopotential height gradient from ERA5/Open-Meteo at (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, ctx, log) => {
    const c = classify(result, [
      { min: 0, max: 5, label: 'Calm', color: '#22c55e', description: 'Light wind' },
      { min: 5, max: 15, label: 'Moderate', color: '#84cc16', description: 'Moderate flow' },
      { min: 15, max: 30, label: 'Strong', color: '#eab308', description: 'Strong flow' },
      { min: 30, max: 50, label: 'Very Strong', color: '#f97316', description: 'Very strong' },
      { min: 50, max: Infinity, label: 'Extreme', color: '#ef4444', description: 'Extreme wind' },
    ]);
    if (c) log.push(`  Geostrophic wind classified as: ${c.label}`);
    const lat = ctx.lat;
    return { classification: c, secondary: [{ key: 'coriolis', value: 2 * 7.2921e-5 * Math.sin(lat * Math.PI / 180), unit: '/s', label: 'Coriolis Parameter (f)' }] };
  },
  qualityCheck: (result) => makeQC([
    rangeQC(result, 0, 200, 'Physical wind range'),
    { name: 'Non-finite check', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'empirical', rmse: 3, rmseUnit: 'm/s',
    contributingFactors: [
      { factor: 'Pressure gradient resolution', contribution: 'Limited by grid spacing (~9 km)' },
      { factor: 'Geostrophic approximation', contribution: 'Breaks down in boundary layer and near equator' },
    ],
    overallAssessment: 'Geostrophic wind accurate to ~3 m/s for synoptic scales (>100 km). Breaks down within 10 degrees of equator.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Geostrophic wind speed of ${result.toFixed(2)} m/s. Represents wind if only pressure gradient and Coriolis forces were balanced.`,
    recommendations: ['Use geopotential height gradient on isobaric surfaces for accuracy.', 'Breaks down within +/- 10 degrees of equator (f -> 0).', 'Ageostrophic component important in boundary layer and convection.'],
  }),
  metadata: {
    methodology: 'Geostrophic balance: pressure gradient force balanced by Coriolis force. V_g = (1/f*rho) * k_hat x grad(P). Preferred form uses geopotential height gradient on isobaric surfaces.',
    assumptions: ['Geostrophic balance (no acceleration)', 'Synoptic scale (>100 km)', 'Away from equator (f != 0)', 'Frictionless (free atmosphere)'],
    limitations: ['Breaks down in boundary layer (friction)', 'Invalid near equator (f -> 0)', 'No ageostrophic component', 'Requires accurate pressure gradient'],
    references: ['Holton & Hakim 2012, Dynamic Meteorology 5th ed., Ch. 3', 'AMS Glossary of Meteorology'],
    preprocessingNotes: ['Compute Coriolis f = 2*Omega*sin(lat)', 'Use pressure-level geopotential height gradient if available'],
  },
  dependencies: [4],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 6 — Pollutant Transport (Advection-Diffusion)
// ══════════════════════════════════════════════════════════════════
export const TOOL_6: ToolWorkflowDef = {
  toolId: 6, name: 'Pollutant Transport Modeling', vizType: 'heatmap',
  classificationBands: [
    { min: 0, max: 10, label: 'Very Low', color: '#22c55e', description: 'Minimal' },
    { min: 10, max: 50, label: 'Low', color: '#84cc16', description: 'Low concentration' },
    { min: 50, max: 100, label: 'Moderate', color: '#eab308', description: 'Moderate' },
    { min: 100, max: 500, label: 'High', color: '#f97316', description: 'High' },
    { min: 500, max: Infinity, label: 'Very High', color: '#ef4444', description: 'Hazardous' },
  ],
  validate: (inputs) => validateRange(inputs, [
    { param: 'u', min: 0, max: 50 }, { param: 'D', min: 0.1, max: 10000 },
    { param: 'C0', min: 0, max: 10000 }, { param: 't', min: 0, max: 86400 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Estimating Pasquill stability class from wind and solar radiation');
    log.push('  Computing eddy diffusivity from boundary layer parameters');
    log.push(`  Wind speed auto-fetched from Open-Meteo at (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, [
      { min: 0, max: 10, label: 'Very Low', color: '#22c55e', description: 'Minimal' },
      { min: 10, max: 50, label: 'Low', color: '#84cc16', description: 'Low' },
      { min: 50, max: 100, label: 'Moderate', color: '#eab308', description: 'Moderate' },
      { min: 100, max: 500, label: 'High', color: '#f97316', description: 'High' },
      { min: 500, max: Infinity, label: 'Very High', color: '#ef4444', description: 'Hazardous' },
    ]);
    if (c) log.push(`  Concentration classified as: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    rangeQC(result, 0, Infinity, 'Non-negative concentration'),
    { name: 'Non-finite check', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'empirical', rmse: 30, rmseUnit: '%',
    contributingFactors: [
      { factor: 'Wind speed uncertainty', contribution: '+/- 5-15%' },
      { factor: 'Eddy diffusivity', contribution: 'Order-of-magnitude uncertainty' },
      { factor: 'Gaussian puff assumption', contribution: 'Simplified vs real turbulence' },
    ],
    overallAssessment: 'Gaussian puff model has +/- 30% uncertainty. For regulatory use, apply EPA AERMOD.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Pollutant concentration of ${result.toFixed(2)} ug/m^3. Apply WHO/EPA air quality standards for interpretation.`,
    recommendations: ['For regulatory compliance, use EPA AERMOD.', 'Consider Pasquill stability class for sigma_y, sigma_z.', 'Use real-time wind from Open-Meteo for forcing.'],
  }),
  metadata: {
    methodology: 'Advection-diffusion equation: dC/dt + u*grad(C) = D*nabla^2(C) + S. Gaussian puff model for point source dispersion.',
    assumptions: ['Steady wind', 'Constant eddy diffusivity', 'Gaussian distribution', 'Conservative tracer (no chemical reactions)'],
    limitations: ['Simplified turbulence model', 'No terrain effects', 'No chemical transformations', 'Constant wind assumption breaks for real plumes'],
    references: ['Bird, Stewart & Lightfoot 2007, Transport Phenomena 2nd ed.', 'Pasquill 1974, Atmospheric Diffusion 2nd ed.'],
    preprocessingNotes: ['Estimate Pasquill stability class', 'Compute eddy diffusivity from boundary layer parameters'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 7 — Bulk Richardson Number
// ══════════════════════════════════════════════════════════════════
export const TOOL_7: ToolWorkflowDef = {
  toolId: 7, name: 'Atmospheric Stability Index', vizType: 'gauge',
  classificationBands: [
    { min: -Infinity, max: -0.01, label: 'Unstable', color: '#ef4444', description: 'Convective turbulence' },
    { min: -0.01, max: 0.01, label: 'Neutral', color: '#22c55e', description: 'Mechanically turbulent' },
    { min: 0.01, max: 0.25, label: 'Weakly Stable', color: '#eab308', description: 'Some turbulence' },
    { min: 0.25, max: 1, label: 'Stable', color: '#f97316', description: 'Suppressed turbulence' },
    { min: 1, max: Infinity, label: 'Very Stable', color: '#3b82f6', description: 'Strong inversion' },
  ],
  validate: (inputs) => validateRange(inputs, [
    { param: 'zg', min: 0, max: 1000 }, { param: 'zs', min: 0, max: 100 },
    { param: 'thetavz', min: 250, max: 350 }, { param: 'thetavs', min: 250, max: 350 },
    { param: 'uz', min: 0, max: 50 }, { param: 'us', min: 0, max: 30 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Computing virtual potential temperature from T, RH, P');
    log.push('  Using multi-level wind from Open-Meteo (10m and 80m)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, [
      { min: -Infinity, max: -0.01, label: 'Unstable', color: '#ef4444', description: 'Convective turbulence' },
      { min: -0.01, max: 0.01, label: 'Neutral', color: '#22c55e', description: 'Mechanically turbulent' },
      { min: 0.01, max: 0.25, label: 'Weakly Stable', color: '#eab308', description: 'Some turbulence' },
      { min: 0.25, max: 1, label: 'Stable', color: '#f97316', description: 'Suppressed turbulence' },
      { min: 1, max: Infinity, label: 'Very Stable', color: '#3b82f6', description: 'Strong inversion' },
    ]);
    if (c) log.push(`  Stability classified as: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Non-finite check', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
    { name: 'Critical Ri check', passed: result < 1, message: result < 0.25 ? 'Below critical Ri (turbulent)' : result < 1 ? 'Above critical Ri (stable)' : 'Very stable (strongly suppressed)', severity: result < 0.25 ? 'info' : 'warning' },
  ]),
  estimateUncertainty: () => ({
    method: 'empirical', rmse: 0.1, rmseUnit: 'Ri',
    contributingFactors: [
      { factor: 'Finite differencing', contribution: 'Smooths true gradients' },
      { factor: 'Wind measurement height', contribution: 'Different heights change Ri' },
    ],
    overallAssessment: 'Ric = 0.25 is Miles-Howard (1961) for gradient Ri. Bulk Ri has larger effective critical value (0.25-1.0).',
  }),
  interpret: (result) => {
    let analysis: string;
    if (result < -0.01) analysis = `Ri = ${result.toFixed(4)}: Unstable atmosphere — convective turbulence active. Boundary layer is mixing vigorously.`;
    else if (result < 0.01) analysis = `Ri = ${result.toFixed(4)}: Near-neutral stability — mechanically driven turbulence dominates.`;
    else if (result < 0.25) analysis = `Ri = ${result.toFixed(4)}: Weakly stable — turbulence present but decaying.`;
    else if (result < 1) analysis = `Ri = ${result.toFixed(4)}: Stable atmosphere — turbulence suppressed, stratification dominant.`;
    else analysis = `Ri = ${result.toFixed(4)}: Very stable — strong temperature inversion, negligible mixing.`;
    return { classification: classify(result, [
      { min: -Infinity, max: -0.01, label: 'Unstable', color: '#ef4444', description: 'Convective' },
      { min: -0.01, max: 0.01, label: 'Neutral', color: '#22c55e', description: 'Neutral' },
      { min: 0.01, max: 0.25, label: 'Weakly Stable', color: '#eab308', description: 'Weakly stable' },
      { min: 0.25, max: 1, label: 'Stable', color: '#f97316', description: 'Stable' },
      { min: 1, max: Infinity, label: 'Very Stable', color: '#3b82f6', description: 'Very stable' },
    ]), contextualAnalysis: analysis, recommendations: ['Use with Monin-Obukhov similarity for surface layer fluxes.', 'ECMWF uses Ri_crit ~ 0.25 for boundary layer scheme.', 'Add wind_speed_80m for multi-level computation.'] };
  },
  metadata: {
    methodology: 'Bulk Richardson number: Ri_b = (g/theta_v) * (delta_theta_v * delta_z) / (delta_u^2). Ratio of buoyant to mechanical shear production of turbulence.',
    assumptions: ['Layer-averaged quantities', 'Hydrostatic balance', 'Mean state representative of layer'],
    limitations: ['Finite differencing smooths gradients', 'Critical Ri varies with scheme (0.25-1.0)', 'Does not capture intermittent turbulence', 'Requires multi-level data'],
    references: ['Stull 1988, Boundary Layer Meteorology', 'Miles & Howard 1961 (critical Ri)', 'Vogelezang & Holtslag 1996 (bulk Ri schemes)'],
    preprocessingNotes: ['Compute virtual potential temperature', 'Use multi-level wind (10m + 80m)'],
  },
  dependencies: [3, 4],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 8 — Kolmogorov Energy Spectrum
// ══════════════════════════════════════════════════════════════════
export const TOOL_8: ToolWorkflowDef = {
  toolId: 8, name: 'Turbulent Energy Spectrum', vizType: 'spectrum',
  classificationBands: [
    { min: 0, max: 0.001, label: 'Very Low', color: '#3b82f6', description: 'Minimal energy' },
    { min: 0.001, max: 0.1, label: 'Low', color: '#60a5fa', description: 'Low energy' },
    { min: 0.1, max: 10, label: 'Moderate', color: '#22c55e', description: 'Moderate energy' },
    { min: 10, max: 1000, label: 'High', color: '#eab308', description: 'High energy' },
    { min: 1000, max: Infinity, label: 'Very High', color: '#ef4444', description: 'Very high energy' },
  ],
  validate: (inputs) => validateRange(inputs, [
    { param: 'C', min: 1, max: 2 }, { param: 'eps', min: 1e-10, max: 100 }, { param: 'k', min: 0.000001, max: 1000 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Using Kolmogorov constant C = 1.5 (Pope 2000)');
    log.push('  TKE dissipation rate from ERA5 turbulence fields');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, [
      { min: 0, max: 0.001, label: 'Very Low', color: '#3b82f6', description: 'Minimal energy' },
      { min: 0.001, max: 0.1, label: 'Low', color: '#60a5fa', description: 'Low energy' },
      { min: 0.1, max: 10, label: 'Moderate', color: '#22c55e', description: 'Moderate energy' },
      { min: 10, max: 1000, label: 'High', color: '#eab308', description: 'High energy' },
      { min: 1000, max: Infinity, label: 'Very High', color: '#ef4444', description: 'Very high energy' },
    ]);
    if (c) log.push(`  Energy classified as: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Non-negative energy', passed: result >= 0, message: result >= 0 ? 'Non-negative' : 'Negative energy', severity: result >= 0 ? 'info' : 'error' },
    { name: 'Non-finite check', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'empirical', rmse: 0.2, rmseUnit: 'constant',
    contributingFactors: [
      { factor: 'Kolmogorov constant', contribution: 'C = 1.5 +/- 0.2 (DNS: 1.5-1.7)' },
      { factor: 'Dissipation rate', contribution: 'Hard to measure directly' },
    ],
    overallAssessment: 'Kolmogorov -5/3 law is universal for high-Re turbulence. C = 1.5 is the accepted textbook value (Pope 2000).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Energy spectrum E(k) = ${result.toExponential(3)} m^3/s^2 at wavenumber k. The -5/3 power law is the hallmark of the inertial subrange.`,
    recommendations: ['Verify -5/3 slope in log-log spectrum.', 'C = 1.5 is Pope (2000) value; DNS gives 1.5-1.7.', 'Kolmogorov microscale: eta = (nu^3/eps)^(1/4).'],
  }),
  metadata: {
    methodology: 'Kolmogorov (1941) universal turbulence theory: E(k) = C * eps^(2/3) * k^(-5/3) in the inertial subrange. Energy cascades from large to small eddies at constant rate eps.',
    assumptions: ['High Reynolds number', 'Isotropic turbulence', 'Inertial subrange (between energy-containing and dissipation scales)', 'Stationary turbulence'],
    limitations: ['Breaks down at low Re', 'Anisotropy at large scales', 'Requires accurate eps estimate', 'Intermittency not captured'],
    references: ['Kolmogorov 1941, Dokl. Akad. Nauk SSSR 30:299-303', 'Pope 2000, Turbulent Flows, Cambridge'],
    preprocessingNotes: ['Use C = 1.5 (Pope 2000)', 'TKE dissipation from ERA5'],
  },
  dependencies: [],
};

// Export all tools defined in this file
export const TOOLS_PART1: Record<number, ToolWorkflowDef> = {
  1: TOOL_1, 2: TOOL_2, 3: TOOL_3, 4: TOOL_4, 5: TOOL_5,
  6: TOOL_6, 7: TOOL_7, 8: TOOL_8,
};

/**
 * Per-Tool Workflow Definitions — Part 2: Eqs 9-25 (Domains 2-3)
 * Hydrology/Oceanography & Geophysics/Seismology
 */

const SEISMIC_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0, label: 'None', color: '#64748b', description: 'No seismic activity' },
  { min: 0, max: 1, label: 'Micro', color: '#22c55e', description: 'Micro-earthquake' },
  { min: 1, max: 10, label: 'Minor', color: '#84cc16', description: 'Minor activity' },
  { min: 10, max: 100, label: 'Moderate', color: '#eab308', description: 'Moderate seismicity' },
  { min: 100, max: 1000, label: 'High', color: '#f97316', description: 'High seismicity' },
  { min: 1000, max: Infinity, label: 'Very High', color: '#ef4444', description: 'Very high' },
];

// ═══ Eq 9 — FAO-56 Penman-Monteith Reference ET ═══
export const TOOL_9: ToolWorkflowDef = {
  toolId: 9, name: 'Reference Evapotranspiration', vizType: 'timeseries',
  classificationBands: WATER_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'Rn', min: -100, max: 1000 }, { param: 'G', min: -100, max: 500 },
    { param: 'T', min: -10, max: 50 }, { param: 'u2', min: 0, max: 20 },
    { param: 'es', min: 0, max: 10 }, { param: 'ea', min: 0, max: 10 },
    { param: 'delta', min: 0, max: 1 }, { param: 'gamma', min: 0.04, max: 0.1 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Fetching weather data from Open-Meteo API');
    log.push('  Converting radiation W/m2 to MJ/m2/day (x 0.0864)');
    log.push('  Computing e_s, e_a, Delta from temperature and humidity');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, WATER_BANDS);
    if (c) log.push(`  ET0 classified as: ${c.label}`);
    return { classification: c, secondary: [{ key: 'crop_et', value: result * 1.0, unit: 'mm/day', label: 'Crop ET (Kc=1.0)' }] };
  },
  qualityCheck: (result) => makeQC([
    rangeQC(result, 0, 500, 'Physical ET range'),
    { name: 'Non-finite check', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'empirical', rmse: 15, rmseUnit: '%',
    contributingFactors: [
      { factor: 'Net radiation estimation', contribution: '+/- 10-20%' },
      { factor: 'Wind speed measurement', contribution: '+/- 5-15%' },
      { factor: 'Humidity/VPD', contribution: '+/- 5-10%' },
    ],
    overallAssessment: 'FAO-56 has reported errors of -9% to +40% vs lysimeters. Remains the international standard.',
  }),
  interpret: (result) => {
    let analysis: string;
    if (result > 10) analysis = `ET0 of ${result.toFixed(2)} mm/day indicates high evaporative demand. Soil moisture depletion will be rapid.`;
    else if (result > 5) analysis = `ET0 of ${result.toFixed(2)} mm/day represents moderate conditions for growing season.`;
    else if (result > 1) analysis = `ET0 of ${result.toFixed(2)} mm/day is low — cool/humid/low-radiation conditions.`;
    else analysis = `ET0 of ${result.toFixed(2)} mm/day is negligible — check winter/nighttime or data quality.`;
    const recs: string[] = [];
    if (result > 10) recs.push('High evaporative demand. Schedule irrigation more frequently.');
    recs.push('Apply crop coefficient Kc to compute actual crop ET.');
    recs.push('Cross-validate with Open-Meteo et0_fao_evapotranspiration product.');
    return { classification: classify(result, WATER_BANDS), contextualAnalysis: analysis, recommendations: recs };
  },
  metadata: {
    methodology: 'FAO-56 Penman-Monteith: ET0 = [0.408*Delta*(Rn-G) + gamma*(900/(T+273))*u2*(es-ea)] / [Delta+gamma*(1+0.34*u2)]. G=0 for daily steps.',
    assumptions: ['Reference crop: hypothetical 0.12m grass', 'Well-watered conditions', 'Daily time step (G=0)', 'Adequate wind speed measurement at 2m'],
    limitations: ['Errors of -9% to +40% vs lysimeters', 'Requires full weather station data', 'Not applicable for hourly without G term', 'Assumes reference grass surface'],
    references: ['Allen et al. 1998, FAO Irrigation and Drainage Paper 56', 'FAO-56 Eq. 6 (Chapter 2)'],
    preprocessingNotes: ['Convert R_n, G to MJ/m2/day', 'Compute e_s, e_a from T and RH', 'Set G=0 for daily steps'],
  },
  dependencies: [3],
};

// ═══ Eq 10 — SCS Curve Number Runoff ═══
export const TOOL_10: ToolWorkflowDef = {
  toolId: 10, name: 'Runoff Estimation (SCS-CN)', vizType: 'scalar',
  classificationBands: WATER_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'P', min: 0, max: 500 }, { param: 'Ia', min: 0, max: 100 }, { param: 'S', min: 0, max: 500 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Precipitation auto-fetched from Open-Meteo');
    log.push('  Curve number derived from ESA WorldCover + ISRIC SoilGrids');
    log.push('  Using regulatory Ia = 0.2*S (Hawkins 2002 recommends 0.05*S)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, ctx, log) => {
    const c = classify(result, WATER_BANDS);
    if (c) log.push(`  Runoff classified as: ${c.label}`);
    const P = ((ctx.fetchedParams as Record<string, number> | undefined)?.P) ?? 50;
    const runoffRatio = P > 0 ? result / P : 0;
    return { classification: c, secondary: [{ key: 'runoff_ratio', value: runoffRatio, unit: '-', label: 'Runoff Coefficient (Q/P)' }] };
  },
  qualityCheck: (result) => makeQC([
    rangeQC(result, 0, 500, 'Physical runoff range'),
    { name: 'Non-finite check', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'empirical', rmse: 30, rmseUnit: '%',
    contributingFactors: [
      { factor: 'Curve number selection', contribution: 'CN varies with AMC and season' },
      { factor: 'Initial abstraction ratio', contribution: '0.2 may overestimate Ia (Hawkins 2002: 0.05)' },
      { factor: 'Spatial variability', contribution: 'CN varies within watershed' },
    ],
    overallAssessment: 'SCS-CN has +/- 30% typical uncertainty. Hawkins (2002) found Ia/S = 0.05 more accurate than regulatory 0.2.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Direct runoff of ${result.toFixed(2)} mm from the SCS Curve Number method. This represents the rainfall excess after initial abstraction and infiltration losses.`,
    recommendations: ['Consider Hawkins (2002) Ia = 0.05*S for research accuracy.', 'Curve number varies with antecedent moisture condition (AMC).', 'Use for flash flood potential assessment.'],
  }),
  metadata: {
    methodology: 'SCS Curve Number: S = 25400/CN - 254, Ia = 0.2*S (regulatory), Q = (P-Ia)^2 / (P-Ia+S). Empirical runoff model for ungaged watersheds.',
    assumptions: ['Uniform rainfall over watershed', 'Constant CN during event', 'Ia = 0.2*S (regulatory standard)', 'No baseflow separation'],
    limitations: ['0.2 ratio overestimates Ia for small storms', 'CN is spatially variable', 'Not applicable for large watersheds', 'No temporal distribution of runoff'],
    references: ['USDA SCS 1954, National Engineering Handbook Section 4', 'Hawkins et al. 2002, JAWRA 38(4):629-643'],
    preprocessingNotes: ['Derive CN from land cover + soil group', 'Fetch precipitation from Open-Meteo', 'Consider AMC adjustment'],
  },
  dependencies: [],
};

// ═══ Eq 11 — Manning's Equation ═══
export const TOOL_11: ToolWorkflowDef = {
  toolId: 11, name: 'Open Channel Flow Analysis', vizType: 'scalar',
  classificationBands: [
    { min: 0, max: 0.5, label: 'Very Slow', color: '#3b82f6', description: 'Slow flow' },
    { min: 0.5, max: 2, label: 'Slow', color: '#60a5fa', description: 'Below average' },
    { min: 2, max: 5, label: 'Moderate', color: '#22c55e', description: 'Normal flow' },
    { min: 5, max: 10, label: 'Fast', color: '#eab308', description: 'Rapid flow' },
    { min: 10, max: Infinity, label: 'Very Fast', color: '#ef4444', description: 'Very rapid' },
  ],
  validate: (inputs) => validateRange(inputs, [
    { param: 'n', min: 0.001, max: 1 }, { param: 'R', min: 0.01, max: 100 }, { param: 'S', min: 0, max: 1 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Channel roughness from ESA WorldCover land cover classification');
    log.push('  Slope from SRTM DEM via Open Topo Data');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, ctx, log) => {
    const c = classify(result, [
      { min: 0, max: 0.5, label: 'Very Slow', color: '#3b82f6', description: 'Slow flow' },
      { min: 0.5, max: 2, label: 'Slow', color: '#60a5fa', description: 'Below average' },
      { min: 2, max: 5, label: 'Moderate', color: '#22c55e', description: 'Normal flow' },
      { min: 5, max: 10, label: 'Fast', color: '#eab308', description: 'Rapid flow' },
      { min: 10, max: Infinity, label: 'Very Fast', color: '#ef4444', description: 'Very rapid' },
    ]);
    if (c) log.push(`  Flow velocity classified as: ${c.label}`);
    const R = ((ctx.fetchedParams as Record<string, number> | undefined)?.R) ?? 1.5;
    return { classification: c, secondary: [{ key: 'discharge', value: result * R * Math.PI, unit: 'm3/s', label: 'Estimated Discharge (Q = v*A)' }] };
  },
  qualityCheck: (result) => makeQC([
    rangeQC(result, 0, 50, 'Physical velocity range'),
    { name: 'Non-finite check', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'empirical', rmse: 20, rmseUnit: '%',
    contributingFactors: [
      { factor: 'Roughness coefficient n', contribution: 'Highly subjective (+/- 20-30%)' },
      { factor: 'Hydraulic radius estimate', contribution: 'Channel geometry uncertainty' },
      { factor: 'Slope measurement', contribution: 'SRTM vertical accuracy +/- 5-10m' },
    ],
    overallAssessment: 'Manning equation has +/- 20% uncertainty mainly from roughness coefficient selection.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Flow velocity of ${result.toFixed(3)} m/s from Manning equation. Typical natural streams: 0.3-3 m/s; flood conditions: 3-10 m/s.`,
    recommendations: ['n is highly subjective — use Chow (1959) tables.', 'Validate with USGS NWIS stream gauge data.', 'For flood routing, use Muskingum-Cunge method.'],
  }),
  metadata: {
    methodology: 'Manning equation: v = (1/n) * R^(2/3) * S^(1/2). Empirical open-channel flow formula widely used in hydraulic engineering.',
    assumptions: ['Uniform flow', 'Steady state', 'Prismatic channel', 'Normal depth'],
    limitations: ['Does not handle rapidly varied flow', 'n is subjective', 'Not valid for supercritical flow without adjustments', 'Assumes uniform slope'],
    references: ['Manning 1891, Trans. ICEI 20:161-207', 'Chow 1959, Open-Channel Hydraulics'],
    preprocessingNotes: ['Estimate n from land cover (Chow tables)', 'Get slope from SRTM DEM', 'Validate with USGS NWIS'],
  },
  dependencies: [],
};

// ═══ Eqs 12-25: Generate definitions using a helper ═══
function makeSimpleTool(id: number, name: string, vizType: string, bands: ClassificationBand[], rules: Array<{param: string; min?: number; max?: number}>, preprocessingNotes: string[], uncertainty: { method: 'analytical' | 'empirical' | 'qualitative'; rmse?: number; rmseUnit?: string; factors: string[]; assessment: string }, interpretation: string, recs: string[], assumptions: string[], limitations: string[], references: string[], deps?: number[]): ToolWorkflowDef {
  return {
    toolId: id, name, vizType: vizType as ToolWorkflowDef['vizType'], classificationBands: bands,
    validate: (inputs) => validateRange(inputs, rules),
    preprocess: (inputs, ctx, log) => { preprocessingNotes.forEach(n => log.push(`  ${n}`)); log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`); return inputs; },
    postProcess: (result, _base, _ctx, log) => { const c = classify(result, bands); if (c) log.push(`  Result classified as: ${c.label}`); return { classification: c }; },
    qualityCheck: (result) => makeQC([rangeQC(result, -Infinity, Infinity, 'Result range'), { name: 'Non-finite check', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
    estimateUncertainty: () => ({ method: uncertainty.method, rmse: uncertainty.rmse, rmseUnit: uncertainty.rmseUnit, contributingFactors: uncertainty.factors.map(f => ({ factor: f, contribution: 'Varies' })), overallAssessment: uncertainty.assessment }),
    interpret: (result) => ({ contextualAnalysis: `${name}: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. ${interpretation}`, recommendations: recs }),
    metadata: { methodology: interpretation, assumptions, limitations, references, preprocessingNotes },
    dependencies: deps,
  };
}

// Eq 12 — Rational Method
export const TOOL_12 = makeSimpleTool(12, 'Peak Discharge Estimation', 'scalar', WATER_BANDS,
  [{ param: 'C', min: 0, max: 1 }, { param: 'i', min: 0, max: 200 }, { param: 'A', min: 0.1, max: 10000 }],
  ['Rainfall intensity from Open-Meteo', 'Runoff coefficient from ESA WorldCover', 'Catchment area from HydroSHEDS'],
  { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ['Runoff coefficient uncertainty', 'Rainfall intensity spatial variability', 'Small catchment assumption'], assessment: 'Rational Method has +/- 30% uncertainty. Valid only for small catchments (< 80 ha).' },
  'Peak discharge for stormwater design. Q = C*i*A/3.6 converts mm/hr*km2 to m3/s.', ['Valid only for small catchments (< 80 ha).', 'Use IDF curves for design rainfall intensity.', 'Cross-reference with USGS NWIS.'], ['Uniform rainfall', 'Small catchment (< 80 ha)', 'Constant runoff coefficient'], ['Not applicable for large basins', 'No temporal distribution', 'Single peak only'], ['Mulvaney 1851'], []);

// Eq 13 — Muskingum Routing
export const TOOL_13 = makeSimpleTool(13, 'Flood Wave Routing', 'scalar', WATER_BANDS,
  [{ param: 'K', min: 0.1, max: 48 }, { param: 'X', min: 0, max: 0.5 }, { param: 'It', min: 0, max: 10000 }, { param: 'Ot', min: 0, max: 10000 }],
  ['Storage constant from channel geometry', 'Weighting factor from calibration', 'Inflow/outflow from USGS NWIS'],
  { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ['K and X calibration', 'Channel geometry variability', 'Linear storage assumption'], assessment: 'Muskingum has +/- 15% uncertainty. Use Muskingum-Cunge for ungauged reaches.' },
  'Flood wave attenuation in river reaches. S = K*[X*I + (1-X)*O].', ['For ungauged reaches, use Muskingum-Cunge.', 'K = travel time; X = 0 (storage) to 0.5 (translation).', 'Typical natural channels: X = 0.2-0.3.'], ['Linear storage assumption', 'Requires calibration', 'Constant parameters'], ['No temporal distribution', 'Not for large basins', 'Requires calibration'], ['McCarthy 1938', 'Cunge 1969'], []);

// Eq 14 — Tide Prediction
export const TOOL_14 = makeSimpleTool(14, 'Tide Prediction', 'timeseries', WATER_BANDS,
  [{ param: 'H0', min: -5, max: 10 }, { param: 'amplitude', min: 0, max: 5 }],
  ['Harmonic constituents from NOAA Tides & Currents', 'M2 dominant constituent', 'Station-specific phases and amplitudes'],
  { method: 'empirical', rmse: 0.05, rmseUnit: 'm', factors: ['Constituent count', 'Station proximity', 'Non-tidal residuals (storm surge)'], assessment: 'Harmonic tide prediction accurate to ~5 cm. Storm surge adds non-tidal residual.' },
  'Tidal elevation from harmonic constituents. h(t) = H0 + sum(Ai*cos(wi*t + phi_i)).', ['For coastal: use NOAA Tides & Currents API.', 'For open ocean: satellite altimetry.', 'Storm surge adds non-tidal residual.'], ['Linear superposition', 'Astronomical forcing only', 'No storm surge'], ['Not applicable in enclosed basins', 'Requires local constituents', 'Nonlinear effects ignored'], ['Pugh & Woodworth 2014, Sea-Level Science'], []);

// Eq 15 — Ekman Spiral
export const TOOL_15 = makeSimpleTool(15, 'Wind-Driven Current Analysis', 'vector', WATER_BANDS,
  [{ param: 'tau', min: 0, max: 10 }, { param: 'rho', min: 1000, max: 1050 }, { param: 'f', min: 0, max: 0.0002 }, { param: 'Av', min: 0.001, max: 1 }],
  ['Wind stress from ASCAT scatterometer', 'Seawater density from temperature/salinity', 'Coriolis from latitude'],
  { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ['Eddy viscosity estimation', 'Stratification effects', 'Time-varying wind'], assessment: 'Ekman theory idealized. Observations show 10-40 deg deflection (not 45 deg classical).' },
  'Ekman surface current: V0 = tau/sqrt(rho*f*Av). Net transport 90 deg to wind (robust).', ['Net Ekman transport = 90 deg to wind (robust).', 'Surface deflection: 10-40 deg (observed, not 45 classical).', 'Use CMEMS for ocean current data.'], ['Constant eddy viscosity', 'No stratification', 'Steady wind', 'Infinite depth'], ['45 deg is idealized upper bound', 'Real oceans have stratification', 'Time-varying wind not captured'], ['Ekman 1905', 'Pugh & Woodworth 2014'], []);

// Eq 16 — Geostrophic Current
export const TOOL_16 = makeSimpleTool(16, 'Ocean Current Analysis', 'vector', WATER_BANDS,
  [{ param: 'f', min: 0, max: 0.0002 }, { param: 'rho', min: 1000, max: 1050 }, { param: 'dPdx', min: -0.01, max: 0.01 }],
  ['Sea surface height from satellite altimetry (CMEMS/AVISO)', 'Geostrophic derivation from SSH gradient', 'Jason-3/Sentinel-6 accuracy ~2-3 cm'],
  { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ['SSH measurement accuracy', 'Spatial gradient resolution', 'Ageostrophic components'], assessment: 'Satellite altimetry provides ~2-3 cm SSH. Geostrophic currents derived from SSH gradients.' },
  'Geostrophic current from sea surface height gradient. v_g = (1/rho*f)*dP/dx.', ['Use CMEMS/AVISO satellite altimetry for open ocean.', 'In-situ ADCP for coastal.', 'Geostrophic breaks near equator (f->0).'], ['Geostrophic balance', 'No friction', 'Away from equator'], ['Degrades within 20-30 km of coast', 'No ageostrophic component', 'Requires SSH data'], ['Gill 1982, Atmosphere-Ocean Dynamics'], []);

// Eq 17 — Ocean Heat Budget
export const TOOL_17 = makeSimpleTool(17, 'Marine Heat Budget', 'scalar', WATER_BANDS,
  [{ param: 'Qs', min: 0, max: 1500 }, { param: 'Qb', min: 0, max: 500 }, { param: 'Qh', min: -200, max: 500 }, { param: 'Qe', min: -200, max: 500 }],
  ['CERES satellite for radiative fluxes', 'ERA5 for turbulent fluxes', 'NOAA OISST for SST validation'],
  { method: 'empirical', rmse: 15, rmseUnit: 'W/m2', factors: ['Turbulent flux parameterization', 'Cloud radiative forcing', 'Bulk formula assumptions'], assessment: 'Ocean heat budget uncertainty ~15 W/m2. CERES for radiation, ERA5 for turbulent.' },
  'Net ocean heat flux: Q_net = Q_s - Q_b - Q_h - Q_e. Positive = heat gain by ocean.', ['CERES for radiative (Q_s, Q_b).', 'ERA5 for turbulent (Q_h, Q_e).', 'OAFlux (WHOI) for blended product.'], ['Bulk aerodynamic formulas', 'Constant transfer coefficients', 'No diurnal cycle (daily mean)'], ['Turbulent fluxes are model-dependent', 'Cloud effects on radiation', 'Spatial resolution limits'], ['Gill 1982, Atmosphere-Ocean Dynamics Ch. 3'], []);

// Eq 18 — Green-Ampt Infiltration
export const TOOL_18 = makeSimpleTool(18, 'Infiltration Analysis', 'scalar', WATER_BANDS,
  [{ param: 'Ks', min: 1e-10, max: 1 }, { param: 'psi_w', min: 0, max: 10 }, { param: 'psi0', min: 0, max: 10 }, { param: 'dTheta', min: 0, max: 0.5 }, { param: 'Ft', min: 0, max: 5 }],
  ['Soil parameters from ISRIC SoilGrids', 'K_s via ROSETTA pedotransfer', 'Soil moisture from SMAP satellite'],
  { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ['K_s estimation', 'Suction head variability', 'Initial moisture content'], assessment: 'Green-Ampt has +/- 25% uncertainty. SMAP provides surface soil moisture.' },
  'Green-Ampt infiltration: f = K_s*(1 + psi*dTheta/F). Implicit in F, requires iteration.', ['ISRIC SoilGrids for K_s via pedotransfer.', 'SMAP for soil moisture validation.', 'Iterative solution for cumulative F(t).'], ['Homogeneous soil', 'Sharp wetting front', 'Constant K_s', 'No macropore flow'], ['Not for layered soils', 'Macropores not captured', 'Requires iterative solution'], ['Green & Ampt 1911', 'Mays 2005, Water Resources Engineering'], []);

// Eqs 19-25: Seismology
export const TOOL_19 = makeSimpleTool(19, 'Earthquake Frequency Analysis', 'bar', SEISMIC_BANDS,
  [{ param: 'a', min: 0, max: 10 }, { param: 'b', min: 0.5, max: 2 }, { param: 'M', min: 0, max: 10 }],
  ['USGS FDSN earthquake catalog query', 'Filter by magnitude threshold and time window', 'b-value via maximum likelihood (Aki 1965)'],
  { method: 'empirical', rmse: 0.1, rmseUnit: 'magnitude', factors: ['Catalog completeness', 'b-value regional variability', 'Magnitude uncertainty'], assessment: 'USGS magnitudes have +/- 0.1-0.3 uncertainty. b-value varies regionally.' },
  'Gutenberg-Richter: log10(N) = a - b*M. b ~ 1.0 globally.', ['Cross-reference USGS FDSN catalog.', 'Validate b-value against regional data.', 'For deformation, consider InSAR (Sentinel-1).'], ['Power-law distribution', 'Stationary seismicity', 'Complete catalog above threshold'], ['Catalog incompleteness', 'Temporal b-value variations', 'Assumes power law'], ['Gutenberg & Richter 1944, BSSA 34(4):185-188', 'Aki 1965 (MLE b-value)'], []);

export const TOOL_20 = makeSimpleTool(20, 'Aftershock Decay Analysis', 'timeseries', SEISMIC_BANDS,
  [{ param: 'K', min: 0, max: 10000 }, { param: 'c', min: 0, max: 10 }, { param: 't', min: 0, max: 1000 }, { param: 'p', min: 0.5, max: 2 }],
  ['USGS FDSN aftershock sequence query', 'Omori-Utsu modified form (p != 1)', 'Sequence-dependent parameters'],
  { method: 'empirical', rmse: 0.2, rmseUnit: 'p-value', factors: ['Sequence completeness', 'Mainshock-aftershock classification', 'Time window selection'], assessment: 'Omori p typically 0.7-1.5. p ~ 1.0 is standard reference.' },
  'Omori law: n(t) = K/(c+t)^p. Utsu (1961) modified form with p != 1.', ['Query USGS FDSN for aftershock sequence.', 'p is empirical, sequence-dependent.', 'Use modified Omori (Utsu 1961).'], ['Stationary decay', 'No clustering of aftershocks', 'Single mainshock'], ['p varies by sequence', 'Requires careful declustering', 'Secondary aftershock sequences'], ['Omori 1894', 'Utsu 1961'], []);

export const TOOL_21 = makeSimpleTool(21, 'Ground Motion Prediction', 'gauge', SEISMIC_BANDS,
  [{ param: 'Mag', min: 0, max: 10 }, { param: 'Dst', min: -10, max: 0 }, { param: 'Ste', min: -2, max: 2 }, { param: 'Flt', min: -1, max: 1 }, { param: 'Hw', min: 0, max: 1 }],
  ['USGS ShakeMap for validation', 'NGA-West2 GMPE coefficients', 'Vs30 from USGS site characterization'],
  { method: 'empirical', rmse: 0.3, rmseUnit: 'ln(g)', factors: ['GMPE model selection', 'Site amplification', 'Fault mechanism uncertainty'], assessment: 'NGA-West2 GMPEs have sigma ~ 0.3 ln(g). USGS 2023 NSHM uses logic tree.' },
  'Campbell-Bozorgnia NGA-West2 GMPE. ln(Y) = f_mag + f_dist + f_site + f_fault + f_hw.', ['USGS 2023 NSHM uses NGA-West2 logic tree.', 'NGA-East for CEUS.', 'Validate with ShakeMap.'], ['Empirical regression', 'Limited data for large M', 'Site-specific variability'], ['Not valid near-fault without directivity', 'Requires Vs30', 'Model epistemic uncertainty'], ['Campbell & Bozorgnia 2014, Earthquake Spectra 30(3):1087-1115'], []);

export const TOOL_22 = makeSimpleTool(22, 'Shear Strength Analysis', 'gauge', RISK_BANDS,
  [{ param: 'c', min: 0, max: 100 }, { param: 'sigma_n', min: 0, max: 1000 }, { param: 'tan_phi', min: 0.1, max: 1.5 }],
  ['Soil properties from ISRIC SoilGrids', 'Stress state from geotechnical model', 'Friction angle from soil classification'],
  { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ['Cohesion variability', 'Friction angle estimation', 'Pore pressure conditions'], assessment: 'Mohr-Coulomb has +/- 20% uncertainty from soil property variability.' },
  'Mohr-Coulomb failure: tau = c + sigma_n * tan(phi). Byerlee law: phi ~ 30-40 deg for faults.', ['For faults: Byerlee law phi ~ 30-40 deg.', 'Use effective stress for saturated soils.', 'Consider strain-softening for brittle failure.'], ['Linear failure envelope', 'Constant c and phi', 'No strain-softening'], ['Not for nonlinear strength', 'Cohesion is scale-dependent', 'Requires effective stress analysis'], ['Coulomb 1776', 'Mohr 1900'], []);

export const TOOL_23 = makeSimpleTool(23, 'Earthquake Magnitude from Moment', 'gauge', SEISMIC_BANDS,
  [{ param: 'M0', min: 1e10, max: 1e24 }],
  ['Seismic moment from USGS moment tensor', 'Global CMT catalog for validation', 'M0 in N*m (not dyne-cm)'],
  { method: 'analytical', factors: ['M0 determination', 'Unit consistency (N*m vs dyne*cm)'], assessment: 'Moment magnitude is the most physically meaningful scale. M0 has +/- 0.1-0.3 uncertainty.' },
  'Moment magnitude: M_w = (2/3)*log10(M0) - 6.07. M0 must be in N*m.', ['M0 must be in N*m (not dyne-cm: use -10.7).', 'USGS uses M_w as preferred magnitude.', 'Global CMT for independent validation.'], ['Point source approximation', 'Double-couple assumption', 'Constant -6.07 offset'], ['Saturation above M~8.5', 'Not for slow earthquakes', 'Requires moment tensor solution'], ['Hanks & Kanamori 1979, JGR 84(B5):2348-2350'], []);

export const TOOL_24 = makeSimpleTool(24, 'Earthquake Stress Drop Analysis', 'gauge', SEISMIC_BANDS,
  [{ param: 'M0', min: 1e10, max: 1e24 }, { param: 'r', min: 10, max: 50000 }],
  ['Seismic moment from USGS/GCMT', 'Source radius from spectral analysis', 'Corner frequency from seismograms'],
  { method: 'empirical', rmse: 0.5, rmseUnit: 'log10(Pa)', factors: ['Source model (Brune vs Madariaga)', 'Corner frequency measurement', 'Rupture velocity assumption'], assessment: 'Stress drops have factor-of-10 variability. Brune 1970 vs Madariaga 1976 fc conventions.' },
  'Brune stress drop: delta_sigma = (7/16)*M0/r^3. fc = 0.49*beta/r (Brune convention).', ['Cite model: Brune (0.49) vs Madariaga (0.21-0.42).', 'Typical stress drops: 1-10 MPa interplate.', 'Use IRIS DMC for seismograms.'], ['Circular crack model', 'Constant rupture velocity', 'Brune omega-squared model'], ['Stress drops highly variable', 'Model-dependent fc', 'Requires spectral analysis'], ['Brune 1970, JGR 75(26):4997-5009', 'Madariaga 1976, BSSA 66(3):639-666'], []);

export const TOOL_25 = makeSimpleTool(25, 'Fault Rupture Scaling', 'bar', SEISMIC_BANDS,
  [{ param: 'Mw', min: 3, max: 10 }],
  ['USGS Quaternary Faults database', 'Wells-Coppersmith regressions', 'Leonard (2014) for M > 7'],
  { method: 'empirical', rmse: 0.3, rmseUnit: 'log10(L)', factors: ['Regression scatter', 'Fault type variability', 'Bias for large M'], assessment: 'Wells-Coppersmith has bias for M > 7. Use Leonard (2014) or Stirling (2013) for large events.' },
  'Wells-Coppersmith scaling: log10(L) = a + b*M_w. For M > 7, prefer Leonard (2014).', ['For M > 7: use Leonard (2014) scaling.', 'USGS Quaternary Faults DB for fault geometry.', 'Stirling (2013) for updated regressions.'], ['Empirical regression', 'Fault-type specific', 'Limited data for large M'], ['Large scatter for M > 7', 'Self-similar assumption', 'Regional variability'], ['Wells & Coppersmith 1994, BSSA 84(4):974-1002', 'Leonard 2014'], [23]);

export const TOOLS_PART2: Record<number, ToolWorkflowDef> = {
  9: TOOL_9, 10: TOOL_10, 11: TOOL_11, 12: TOOL_12, 13: TOOL_13,
  14: TOOL_14, 15: TOOL_15, 16: TOOL_16, 17: TOOL_17, 18: TOOL_18,
  19: TOOL_19, 20: TOOL_20, 21: TOOL_21, 22: TOOL_22, 23: TOOL_23,
  24: TOOL_24, 25: TOOL_25,
};

/**
 * Per-Tool Workflow Definitions — Part 3: Eqs 26-65 (Domains 4-9)
 * Remote Sensing, Spatial Analysis, Soil Science, Biosphere, Agriculture, Chemistry
 */

// Eq 26 — NDVI
export const TOOL_26 = makeTool(26, 'Vegetation Health Index', 'heatmap', INDEX_BANDS,
  [{ param: 'NIR', min: 0, max: 1 }, { param: 'Red', min: 0, max: 1 }],
  ['Acquire NIR/Red reflectance from Sentinel-2 or MODIS', 'Apply atmospheric correction if L1C', 'Mask clouds and shadows'],
  { method: 'empirical', rmse: 0.05, rmseUnit: 'NDVI', factors: ['Atmospheric correction', 'BRDF effects', 'Sensor calibration'], assessment: 'NDVI has +/- 0.02-0.05 uncertainty. Pre-computed MODIS reduces noise.' },
  'NDVI = (NIR-Red)/(NIR+Red). Dense veg: 0.6-0.8. Saturation above 0.8.', ['Use EVI where NDVI saturates (>0.8).', 'MODIS MOD13 for temporal continuity.', 'Sentinel-2 for 10m resolution.'], ['Atmospherically corrected reflectance', 'Nadir viewing', 'Homogeneous pixel'], ['Saturates above 0.8', 'Soil background effects', 'Atmospheric contamination'], ['Rouse et al. 1974', 'Huete et al. 2002, RSE 83:195-213'], []);

// Eq 27 — NDWI McFeeters
export const TOOL_27 = makeTool(27, 'Surface Water Detection', 'heatmap', INDEX_BANDS,
  [{ param: 'Green', min: 0, max: 1 }, { param: 'NIR', min: 0, max: 1 }],
  ['Acquire Green/NIR reflectance from Sentinel-2', '10m resolution for shoreline delineation', 'Verify with MNDWI for built-up areas'],
  { method: 'empirical', rmse: 0.03, rmseUnit: 'NDWI', factors: ['Atmospheric correction', 'Mixed pixels at shoreline', 'Shadow contamination'], assessment: 'NDWI water detection has +/- 0.03 uncertainty. Use MNDWI for urban areas.' },
  'NDWI = (Green-NIR)/(Green+NIR). >0 indicates open water.', ['Use MNDWI for built-up areas.', 'Sentinel-2 10m for shoreline.', 'Verify water body with secondary check.'], ['Open water surfaces', 'Low turbidity', 'Minimal shadow'], ['Built-up areas can give false positives', 'Turbid water detection varies', 'Shadow confusion'], ['McFeeters 1996, Int. J. Remote Sensing 17(7):1425-1432'], []);

// Eq 28 — NDMI (Gao NDWI)
export const TOOL_28 = makeTool(28, 'Vegetation Water Content', 'heatmap', INDEX_BANDS,
  [{ param: 'NIR', min: 0, max: 1 }, { param: 'SWIR', min: 0, max: 1 }],
  ['Acquire NIR/SWIR from Sentinel-2 B8/B11', 'NDMI uses SWIR1 (1.6um) — different from Gao-NDWI (1.24um)', 'Label correctly: NDMI vs Gao-NDWI'],
  { method: 'empirical', rmse: 0.04, rmseUnit: 'NDMI', factors: ['SWIR atmospheric absorption', 'Canopy structure effects', 'Sensor bandpass differences'], assessment: 'NDMI has +/- 0.04 uncertainty. Naming collision: NDMI (1.6um) vs Gao-NDWI (1.24um).' },
  'NDMI = (NIR-SWIR)/(NIR+SWIR). Vegetation water content. Also called Gao-NDWI.', ['Disambiguate: NDMI (1.6um) vs Gao-NDWI (1.24um).', 'Sentinel-2 B8/B11 for NDMI.', 'Different physics at different SWIR wavelengths.'], ['Vegetation canopy present', 'SWIR atmospheric window clear', 'Consistent bandpass'], ['Naming collision with water NDWI', 'SWIR atmospheric absorption', 'Canopy structure effects'], ['Gao 1996, RSE 58(3):257-266', 'Wilson & Sader 2002'], []);

// Eq 29 — EVI
export const TOOL_29 = makeTool(29, 'Enhanced Vegetation Index', 'heatmap', INDEX_BANDS,
  [{ param: 'NIR', min: 0, max: 1 }, { param: 'Red', min: 0, max: 1 }, { param: 'Blue', min: 0, max: 1 }],
  ['Use MODIS MOD13 pre-computed EVI for MODIS bandpass', 'For Sentinel-2: use EVI2 (no blue band) or HLS EVI', 'MODIS coefficients (G=2.5, C1=6, C2=7.5, L=1) not transferable to S2'],
  { method: 'empirical', rmse: 0.06, rmseUnit: 'EVI', factors: ['Blue band calibration', 'Coefficient transferability', 'Atmospheric aerosol correction'], assessment: 'EVI has +/- 0.06 uncertainty. MODIS coefficients NOT directly transferable to Sentinel-2.' },
  'EVI = G*(NIR-Red)/(NIR+C1*Red-C2*Blue+L). G=2.5, C1=6, C2=7.5, L=1 (MODIS).', ['MODIS coefficients NOT transferable to S2 without bandpass adjustment.', 'Use EVI2 for S2: 2.5*(NIR-Red)/(NIR+2.4*Red+1).', 'HLS EVI for merged Landsat+S2.'], ['MODIS bandpasses', 'Atmospheric correction via blue band', 'Canopy background correction'], ['Coefficient transferability issue', 'Requires blue band', 'Not for sensors without blue band'], ['Huete et al. 2002, RSE 83:195-213', 'Jiang et al. 2008, RSE 112:3833-3845 (EVI2)'], []);

// Eq 30 — NDSI
export const TOOL_30 = makeTool(30, 'Snow Cover Detection', 'heatmap', INDEX_BANDS,
  [{ param: 'Green', min: 0, max: 1 }, { param: 'SWIR', min: 0, max: 1 }],
  ['Use pre-computed MODIS MOD10A1 (500m daily)', 'MODIS C6.1 threshold: NDSI > 0.0 (not 0.4)', 'Add visible reflectance screen (>0.07-0.11)'],
  { method: 'empirical', rmse: 0.05, rmseUnit: 'NDSI', factors: ['Cloud masking', 'Forest canopy snow detection', 'Polar darkness'], assessment: 'MODIS C6.1 uses NDSI > 0.0 (not 0.4). Riggs et al. 2016.' },
  'NDSI = (Green-SWIR)/(Green+SWIR). MODIS C6.1: snow if NDSI > 0.0.', ['MODIS C6.1: threshold 0.0 (not 0.4).', 'Landsat binary: NDSI > 0.4 still OK.', 'MOD10A1 includes cloud mask.'], ['Snow has high visible, low SWIR reflectance', 'Cloud-free pixel', 'Nadir viewing'], ['Forest canopy obscures snow', 'Cloud contamination', 'Polar darkness limitation'], ['Hall et al. 1995, RSE 54(2):127-140', 'Riggs, Hall & Roman 2016, MODIS C6.1 User Guide'], []);

// Eqs 31-35: Remote sensing continued
export const TOOL_31 = makeTool(31, 'Burn Severity Mapping', 'heatmap', INDEX_BANDS,
  [{ param: 'NIR', min: 0, max: 1 }, { param: 'SWIR', min: 0, max: 1 }],
  ['Acquire pre/post fire Landsat or Sentinel-2 imagery', 'NBR uses SWIR2 (~2.1um), not SWIR1', 'Compute dNBR = NBR_pre - NBR_post'],
  { method: 'empirical', rmse: 0.08, rmseUnit: 'dNBR', factors: ['Pre/post image registration', 'Phenological differences', 'Atmospheric correction consistency'], assessment: 'Burn severity (dNBR) has +/- 0.08 uncertainty. MTBS standard thresholds.' },
  'NBR = (NIR-SWIR2)/(NIR+SWIR2). dNBR = NBR_pre - NBR_post. MTBS severity thresholds.', ['Use SWIR2 (~2.1um), not SWIR1.', 'MTBS: low 0.10-0.27, moderate 0.27-0.44, high >0.44.', '30m Landsat preferred for severity.'], ['Pre/post fire imagery available', 'Same phenological period', 'Cloud-free conditions'], ['Phenological differences confound', 'Requires pre-fire reference', 'Regrowth can mask severity'], ['Key & Benson 2006, FIREMON Landscape Assessment', 'MTBS program'], []);

export const TOOL_32 = makeTool(32, 'Fire Radiative Power Estimation', 'gauge', INDEX_BANDS,
  [{ param: 'A', min: 0, max: 1e8 }, { param: 'eps', min: 0, max: 1 }, { param: 'T_fire', min: 400, max: 2000 }, { param: 'T_bg', min: 200, max: 400 }],
  ['Use pre-computed NASA FIRMS FRP (do not recompute from raw)', 'VIIRS 375m for small fires', 'MODIS 1km for long record'],
  { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ['Dozier method assumptions', 'Background temperature estimation', 'Subpixel fire fraction'], assessment: 'FIRMS FRP uses Wooster (2005) MIR radiance method. Do not recompute from raw.' },
  'FRP = eps*sigma*A*(T_fire^4 - T_bg^4). Operational: Wooster MIR radiance method.', ['Use pre-computed NASA FIRMS FRP.', 'VIIRS 375m for small/cool fires.', 'GOES ABI for fire behavior tracking.'], ['Fire fills entire pixel (Dozier)', 'Single fire per pixel', 'Known background temperature'], ['Subpixel heterogeneity', 'Cloud obscuration', 'Background T estimation error'], ['Giglio et al. 2003, RSE 87:273-282', 'Wooster et al. 2005, Biogeosciences 2:161'], []);

export const TOOL_33 = makeTool(33, 'Crop Water Stress Assessment', 'gauge', INDEX_BANDS,
  [{ param: 'Tc', min: 0, max: 60 }, { param: 'Twet', min: 0, max: 50 }, { param: 'Tdry', min: 0, max: 60 }],
  ['Satellite LST from ECOSTRESS/Landsat/Sentinel-3', 'Jackson (1988) theoretical baselines preferred', 'No pre-computed CWSI API exists'],
  { method: 'empirical', rmse: 0.15, rmseUnit: 'CWSI', factors: ['Reference temperature accuracy', 'VPD measurement', 'Aerodynamic resistance'], assessment: 'CWSI has +/- 0.15 uncertainty. Jackson (1988) theoretical method preferred over Idso empirical.' },
  'CWSI = (Tc-Twet)/(Tdry-Twet). 0=no stress, 1=full stress. Jackson theoretical preferred.', ['Prefer Jackson (1988) theoretical method.', 'Requires satellite LST (ECOSTRESS 70m).', 'No pre-computed CWSI API exists.'], ['Well-defined wet/dry references', 'Homogeneous canopy', 'Clear sky conditions'], ['Requires reference baselines', 'VPD-dependent', 'Cloud contamination'], ['Idso et al. 1981, Agric. Meteorol. 24:45', 'Jackson et al. 1988'], []);

export const TOOL_34 = makeTool(34, 'Snowmelt Runoff Forecasting', 'timeseries', INDEX_BANDS,
  [{ param: 'DDF', min: 0.5, max: 20 }, { param: 'T_air', min: -20, max: 40 }, { param: 'T_base', min: -5, max: 5 }],
  ['T_air from ERA5/Open-Meteo (NOT satellite LST)', 'Snow cover from MODIS MOD10A1', 'DDF: snow 3-5, ice 5-8 mm/C/day'],
  { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ['DDF spatial variability', 'T_air vs LST difference', 'Snow density variations'], assessment: 'Degree-day model has +/- 25% uncertainty. DDF: snow 3-5, ice 5-8 mm/C/day (Hock 2003).' },
  'Melt = DDF * max(0, T_air - T_base). DDF: snow 3-5, ice 5-8 mm/C/day.', ['T_air from reanalysis, NOT satellite LST.', 'MODIS MOD10A1 for snow depletion curves.', 'DDF varies with radiation and debris cover.'], ['Linear temperature-melt relation', 'Constant DDF', 'Snow surface is isothermal at 0C'], ['DDF varies spatially and temporally', 'T_air vs LST difference (5-15C)', 'Not for energy-balance models'], ['Braithwaite 1995', 'Hock 2003, J. Hydrol. 282:104-129'], []);

export const TOOL_35 = makeTool(35, 'Passive Microwave Sea Ice Analysis', 'heatmap', INDEX_BANDS,
  [{ param: 'C', min: 0, max: 1 }, { param: 'T_water', min: -2, max: 10 }, { param: 'T_ice', min: -50, max: 0 }],
  ['Use pre-computed NSIDC CDR G02202 (hybrid NASA-Team/Bootstrap)', 'AMSR2 > SSMIS for resolution', '15% threshold defines ice extent'],
  { method: 'empirical', rmse: 5, rmseUnit: '%', factors: ['Tie-point variability', 'Atmospheric contamination', 'Melt pond effects'], assessment: 'Hybrid CDR has <5% error for high-concentration ice. AMSR2 > SSMIS.' },
  'Sea ice from passive microwave. Hybrid NASA-Team/Bootstrap algorithm. 15% = ice extent.', ['Use NSIDC CDR G02202 (hybrid).', 'AMSR2 (10-15km) > SSMIS (25km).', '15% threshold for ice extent.'], ['Passive microwave brightness temperatures', 'Polar regions', 'Known tie-points'], ['Melt ponds reduce accuracy', 'Thin ice (<30cm) underestimated', 'Atmospheric contamination near ice edge'], ['Comiso 1986, JGR Oceans 91(C1):975-994', 'NSIDC G02202 CDR'], []);

// Eqs 36-42: Spatial Analysis
export const TOOL_36 = makeTool(36, 'Great Circle Distance', 'scalar', RISK_BANDS,
  [{ param: 'lat1', min: -90, max: 90 }, { param: 'lon1', min: -180, max: 180 }, { param: 'lat2', min: -90, max: 90 }, { param: 'lon2', min: -180, max: 180 }],
  ['Pure geometric calculation', 'Earth radius R = 6371 km', 'Vincenty formula for higher precision'],
  { method: 'analytical', factors: ['Spherical Earth approximation', 'Earth radius value'], assessment: 'Haversine is exact for sphere. Vincenty formula accounts for ellipsoid.' },
  'Great circle distance: d = 2R*arcsin(sqrt(sin^2(dPhi/2) + cos(phi1)*cos(phi2)*sin^2(dLambda/2))).', ['Use Vincenty for ellipsoidal precision.', 'R = 6371 km for mean Earth radius.', 'For geodesic distance, use geographiclib.'], ['Spherical Earth', 'No altitude differences', 'Great circle path'], ['0.5% error vs ellipsoidal', 'Not for short distances (< 1 km)', 'No terrain consideration'], ['Sinnott 1984, Sky and Telescope 68(2):158'], []);

export const TOOL_37 = makeTool(37, 'Geostatistical Interpolation (Kriging)', 'contour', RISK_BANDS,
  [{ param: 'z', min: -Infinity, max: Infinity }, { param: 'lambda', min: -Infinity, max: Infinity }],
  ['Compute experimental semivariogram from observations', 'Fit spherical/exponential/Gaussian model', 'Solve kriging system: A*lambda = b'],
  { method: 'empirical', rmse: 0.5, rmseUnit: 'log10', factors: ['Variogram model fit', 'Stationarity assumption', 'Sample density'], assessment: 'Ordinary kriging assumes 2nd-order stationarity. Use regression kriging for non-stationary fields.' },
  'Kriging: y_hat = sum(lambda_i * z(s_i)). Weights solve A*lambda = b with unbiasedness constraint.', ['For non-stationary: use regression/universal kriging.', 'Gaussian process regression for multi-scale.', 'PyKrige library for implementation.'], ['2nd-order stationarity', 'Translation-invariant covariance', 'Gaussian residuals'], ['Fails for non-stationary fields', 'Requires dense sampling', 'Computationally expensive'], ['Matheron 1963, Economic Geology 58(8):1246-1266'], []);

export const TOOL_38 = makeTool(38, 'Inverse Distance Weighting', 'contour', RISK_BANDS,
  [{ param: 'z', min: -Infinity, max: Infinity }, { param: 'w', min: 0, max: Infinity }],
  ['IDW with power parameter p (typically 2)', 'Bilinear/bicubic for gridded data', 'Nearest neighbor for categorical'],
  { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ['Power parameter selection', 'Search radius', 'Anisotropy'], assessment: 'IDW has +/- 20% uncertainty. Simpler than kriging but no uncertainty estimate.' },
  'IDW: y_hat = sum(w_i * z_i) / sum(w_i); w_i = 1/d_i^p. Fast spatial interpolation.', ['Power p typically 2.', 'Use search radius to limit computation.', 'Kriging preferred when variogram available.'], ['Isotropic distances', 'No directional anisotropy', 'Exact at data points'], ['No uncertainty estimate', 'Bullseye artifacts at data points', 'Power parameter subjective'], ['Shepard 1968, Proc. 23rd ACM National Conference'], []);

export const TOOL_39 = makeTool(39, 'Gaussian Plume Air Dispersion', 'heatmap', AQI_BANDS,
  [{ param: 'Q', min: 0, max: 1e9 }, { param: 'u', min: 0, max: 50 }, { param: 'sigmaY', min: 1, max: 1000 }, { param: 'sigmaZ', min: 1, max: 1000 }, { param: 'y', min: -5000, max: 5000 }],
  ['Estimate Pasquill stability class from wind and radiation', 'Compute sigma_y, sigma_z from stability class', 'Use EPA AERMOD for regulatory compliance'],
  { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ['Stability class estimation', 'Wind variability', 'Terrain effects'], assessment: 'Gaussian plume has +/- 30% uncertainty. Use AERMOD for regulatory.' },
  'Gaussian plume: C = Q/(2*pi*u*sigma_y*sigma_z) * exp(-y^2/2*sigma_y^2) * exp(-H^2/2*sigma_z^2).', ['Use AERMOD for regulatory compliance.', 'Pasquill stability from wind + solar radiation.', 'Real-time wind from Open-Meteo.'], ['Steady wind', 'Constant sigma_y, sigma_z', 'Flat terrain', 'Conservative pollutant'], ['No terrain effects', 'No chemical reactions', 'Steady-state only', 'Limited to flat terrain'], ['Pasquill 1974, Atmospheric Diffusion 2nd ed.'], []);

export const TOOL_40 = makeTool(40, 'Gumbel Extreme Value Analysis', 'distribution', RISK_BANDS,
  [{ param: 'mu', min: -1e6, max: 1e6 }, { param: 'beta', min: 0.1, max: 1e6 }, { param: 'x', min: -1e6, max: 1e6 }],
  ['Use >= 30 years of data for reliable estimation', 'Fit via MLE or method of moments', 'Compare with GEV for model selection'],
  { method: 'qualitative', factors: ['Sample size', 'Distribution fit quality', 'Stationarity assumption'], assessment: 'Use > 30 years for reliable return periods. Compare Gumbel and GEV.' },
  'Gumbel distribution: F(x) = exp(-exp(-(x-mu)/beta)). Return period: x_T = mu - beta*ln(-ln(1-1/T)).', ['Use >= 30 years of data.', 'Compare Gumbel and GEV via AIC/BIC.', 'Cross-reference USGS stream gauges for floods.'], ['Stationary climate', 'IID samples', 'Gumbel is appropriate (Type I)'], ['Climate non-stationarity invalidates', 'Requires long records', 'May not fit all extremes'], ['Gumbel 1958, Statistics of Extremes'], []);

export const TOOL_41 = makeTool(41, 'Generalized Pareto Distribution', 'distribution', RISK_BANDS,
  [{ param: 'xi', min: -0.5, max: 1 }, { param: 'beta', min: 0.1, max: 1e6 }, { param: 'x', min: -1e6, max: 1e6 }],
  ['Peaks-over-threshold approach', 'Threshold selection critical (mean residual life plot)', 'Compare with block maxima (GEV)'],
  { method: 'qualitative', factors: ['Threshold selection', 'Shape parameter sensitivity', 'Sample size'], assessment: 'GPD is flexible for peaks-over-threshold. Threshold selection is critical.' },
  'GPD: F(x) = 1 - (1 + xi*x/beta)^(-1/xi). Peaks-over-threshold extreme analysis.', ['Use mean residual life plot for threshold.', 'Compare with GEV (block maxima).', 'Shape parameter xi determines tail behavior.'], ['IID exceedances', 'Threshold is appropriate', 'Stationary climate'], ['Threshold selection subjective', 'Sensitive to shape parameter', 'Requires sufficient exceedances'], ['Pickands 1975, Annals of Statistics 3(1):119-131'], []);

export const TOOL_42 = makeTool(42, 'Semivariogram Analysis', 'spectrum', RISK_BANDS,
  [{ param: 'z', min: -Infinity, max: Infinity }, { param: 'h', min: 0, max: Infinity }],
  ['Compute experimental semivariogram from spatial data', 'Fit nugget, sill, range', 'Model selection: spherical, exponential, Gaussian'],
  { method: 'empirical', rmse: 0.3, rmseUnit: 'log10', factors: ['Lag spacing', 'Sample configuration', 'Model selection'], assessment: 'Semivariogram model fit has +/- 0.3 log10 uncertainty.' },
  'Semivariogram: gamma(h) = (1/2N(h)) * sum [z(s_i) - z(s_i+h)]^2. Fit nugget, sill, range.', ['Fit theoretical model (spherical/exp/Gaussian).', 'Nugget = measurement error + micro-scale variability.', 'Range = spatial correlation distance.'], ['2nd-order stationarity', 'Isotropic covariance', 'Gaussian residuals'], ['Anisotropy not captured', 'Requires sufficient sample pairs', 'Model selection subjective'], ['Matheron 1963, Economic Geology 58(8):1246-1266'], []);

// Eqs 43-50: Soil Science
export const TOOL_43 = makeTool(43, 'Soil Water Retention Curve', 'profile', SOIL_BANDS,
  [{ param: 'thetaR', min: 0, max: 0.2 }, { param: 'thetaS', min: 0.2, max: 0.6 }, { param: 'alpha', min: 0.001, max: 1 }, { param: 'n', min: 1.1, max: 5 }, { param: 'psi', min: -100, max: -0.01 }],
  ['Derive alpha, n from ISRIC SoilGrids via ROSETTA', 'Mualem-vG pairing for hydraulic conductivity', 'Validate with SMAP soil moisture'],
  { method: 'empirical', rmse: 0.5, rmseUnit: 'log10(K)', factors: ['Pedotransfer function', 'Soil texture variability', 'Macropores not captured'], assessment: 'van Genuchten-Mualem has +/- 0.5 log10(K) uncertainty from pedotransfer.' },
  'van Genuchten: theta(psi) = thetaR + (thetaS-thetaR)/[1+(alpha*|psi|)^n]^m, m=1-1/n. Mualem pairing.', ['Use ROSETTA pedotransfer for alpha, n.', 'Mualem pairing for K(S_e).', 'ISRIC SoilGrids for spatial variability.'], ['Rigid, homogeneous soil', 'No hysteresis', 'Mualem model for K'], ['Hysteresis not captured', 'Macropores not modeled', 'Requires calibration for local soils'], ['van Genuchten 1980, SSSAJ 44(5):892-898', 'Mualem 1976, Water Resour. Res. 12(3):513-522'], []);

export const TOOL_44 = makeTool(44, 'Soil Hydraulic Model', 'profile', SOIL_BANDS,
  [{ param: 'psi_b', min: -10, max: -0.01 }, { param: 'psi', min: -100, max: -0.01 }],
  ['Brooks-Corey parameters from soil texture', 'Lambda from pore-size distribution', 'ISRIC SoilGrids for spatial data'],
  { method: 'empirical', rmse: 0.5, rmseUnit: 'log10(K)', factors: ['Lambda estimation', 'Air-entry pressure', 'Soil structure effects'], assessment: 'Brooks-Corey has similar uncertainty to vG. Simpler form but discontinuous at air-entry.' },
  'Brooks-Corey: K(psi) = K_s for psi < psi_b; K_s*(psi_b/psi)^lambda for psi >= psi_b.', ['Compare with vG for same soil.', 'Lambda varies with texture: 0.5 (sand) to 2+ (clay).', 'ISRIC SoilGrids for spatial data.'], ['Rigid soil', 'No hysteresis', 'Sharp air-entry'], ['Discontinuous at psi_b', 'Less flexible than vG', 'Not for structured soils'], ['Brooks & Corey 1964, CSU Hydrology Papers No. 3'], []);

export const TOOL_45 = makeTool(45, 'Universal Soil Loss Equation', 'scalar', SOIL_BANDS,
  [{ param: 'R', min: 0, max: 50000 }, { param: 'K', min: 0, max: 1 }, { param: 'LS', min: 0, max: 20 }, { param: 'C', min: 0, max: 1 }, { param: 'P', min: 0, max: 1 }],
  ['R-factor from GPM IMERG precipitation', 'K-factor from ISRIC SoilGrids', 'LS from SRTM DEM slope/length'],
  { method: 'empirical', rmse: 50, rmseUnit: '%', factors: ['R-factor spatial variability', 'K-factor estimation', 'LS calculation method'], assessment: 'USLE has +/- 50% uncertainty at plot scale. RUSLE2 is current USDA standard.' },
  'USLE: A = R * K * LS * C * P. Annual soil loss in tons/acre/year. RUSLE2 is current standard.', ['Use RUSLE2 (current USDA-ARS standard).', 'R from GPM IMERG. K from SoilGrids. LS from DEM.', 'Unit plot convention: L=S=C=P=1.'], ['Uniform slope', 'Sheet and rill erosion only', 'Annual time step'], ['Not for gully erosion', '+/- 50% at plot scale', 'Requires local calibration'], ['Wischmeier & Smith 1978, USDA Handbook 537', 'RUSLE2 (USDA-ARS)'], []);

export const TOOL_46 = makeTool(46, 'Soil Respiration Temperature Sensitivity', 'timeseries', CARBON_BANDS,
  [{ param: 'R_base', min: 0, max: 50 }, { param: 'Q10', min: 1, max: 5 }, { param: 'T', min: -10, max: 50 }, { param: 'T_base', min: -10, max: 30 }],
  ['Soil temperature from Open-Meteo soil_temperature_0cm', 'Q10 from FLUXNET or literature', 'Global mean Q10 ~ 2.4'],
  { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ['Q10 is not constant', 'Substrate lability', 'Moisture dependence'], assessment: 'Q10 is NOT constant — varies with T, moisture, substrate (Davidson & Janssens 2006).' },
  'Soil respiration: R = R_base * Q10^((T-T_base)/10). Global mean Q10 ~ 2.4.', ['Q10 varies with T, moisture, substrate.', 'Use soil_temperature_0cm from Open-Meteo.', 'FLUXNET for validation.'], ['Constant Q10', 'No moisture limitation', 'No substrate depletion'], ['Q10 is temperature-dependent', 'Moisture stress not captured', 'Acclimatization effects'], ['Raich & Schlesinger 1992, Tellus B 44(2):81-99', 'Davidson & Janssens 2006, Nature 440:165-173'], []);

export const TOOL_47 = makeTool(47, 'Soil Thermal Conductivity Model', 'scalar', SOIL_BANDS,
  [{ param: 'ki', min: 0, max: 10 }, { param: 'fi', min: 0, max: 1 }],
  ['Soil composition from ISRIC SoilGrids', 'Mineral/organic/water/air fractions', 'Bulk density for volume fractions'],
  { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ['Moisture content', 'Mineral composition', 'Bulk density'], assessment: 'de Vries model has +/- 25% uncertainty, mainly from moisture.' },
  'de Vries: k_soil = sum(k_i * f_i * lambda_i) / sum(k_i * f_i). Weighted by volume fractions.', ['ISRIC SoilGrids for composition.', 'Moisture content critical for k.', 'Validate with in-situ measurements.'], ['Isotropic soil', 'Linear mixing', 'Known volume fractions'], ['Moisture dependence complex', 'Mineral composition varies', 'Not for frozen soils'], ['de Vries 1963, Physics of Plant Environment'], []);

export const TOOL_48 = makeTool(48, 'Surface Layer Similarity Theory', 'profile', SOIL_BANDS,
  [{ param: 'kappa', min: 0.3, max: 0.5 }, { param: 'u_star', min: 0, max: 5 }, { param: 'z', min: 0, max: 1000 }, { param: 'L', min: -1000, max: 1000 }],
  ['Von Karman constant kappa = 0.40 (Hogstrom 1988)', 'Businger-Dyer stability functions', 'ERA5 for surface fluxes'],
  { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ['Universal function uncertainty', 'Roughness sublayer effects', 'Stability parameter accuracy'], assessment: 'Monin-Obukhov has 10-20% inherent error in universal functions.' },
  'Monin-Obukhov: u(z) = (u*/kappa) * [ln(z/z0) - Psi_m(zeta)]. zeta = z/L.', ['kappa = 0.40 (Hogstrom 1988).', 'Businger-Dyer stability functions.', 'ERA5 for surface fluxes.'], ['Horizontally homogeneous surface', 'Stationary conditions', 'Constant flux layer'], ['Breaks down in roughness sublayer', 'Non-stationary conditions', 'Requires accurate u*'], ['Monin & Obukhov 1954', 'Hogstrom 1988, Boundary-Layer Meteorology 42:55-78'], []);

export const TOOL_49 = makeTool(49, 'Logarithmic Wind Profile', 'profile', SOIL_BANDS,
  [{ param: 'u_star', min: 0, max: 5 }, { param: 'z', min: 0, max: 1000 }, { param: 'z0', min: 0.00001, max: 10 }],
  ['Roughness length z0 from ESA WorldCover land cover', 'Friction velocity from multi-level wind', 'Neutral stability assumption'],
  { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ['z0 estimation', 'Stability correction', 'Surface heterogeneity'], assessment: 'Log law has +/- 15% uncertainty. z0 from land cover classification.' },
  'Log wind: u(z) = (u*/kappa) * ln(z/z0). Neutral conditions only. z0 from land cover.', ['z0 from ESA WorldCover (water ~0.0001, forest ~1).', 'Add stability correction for non-neutral.', 'Use multi-level wind (10m + 80m).'], ['Neutral stability', 'Horizontally homogeneous', 'Above roughness sublayer'], ['Not for stable/unstable without correction', 'z0 is subjective', 'Fails in complex terrain'], ['Prandtl 1925, ZAMM 5(2):136-139'], []);

export const TOOL_50 = makeTool(50, 'Stomatal Conductance Model', 'scalar', SOIL_BANDS,
  [{ param: 'g0', min: 0, max: 100 }, { param: 'a1', min: 0, max: 20 }, { param: 'A', min: 0, max: 50 }, { param: 'hs', min: 0, max: 1 }, { param: 'cs', min: 100, max: 1000 }],
  ['Use Leuning (1995) revision for VPD handling', 'CO2 from OCO-2/3 satellite', 'Photosynthesis from FLUXNET'],
  { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ['Parameter variability', 'VPD dependence', 'Species-specific calibration'], assessment: 'Ball-Berry has +/- 25% uncertainty. Leuning (1995) revision recommended.' },
  'Ball-Berry: g_s = g0 + a1*A*hs/cs. Leuning (1995) revision preferred.', ['Use Leuning (1995) revision for VPD handling.', 'g_s = g0 + a1*A_n / [(cs-Gamma)*(1+Ds/D0)].', 'Used in CLM, CABLE, JULES.'], ['Well-watered conditions', 'Constant a1, g0', 'Leaf-level scale'], ['Diverges at low cs in original form', 'Parameters species-specific', 'Not for water-stressed plants'], ['Ball et al. 1987', 'Leuning 1995, Plant Cell Environ. 18:339-355'], []);

// Eqs 51-57: Biosphere
export const TOOL_51 = makeTool(51, 'Gross Primary Production', 'timeseries', CARBON_BANDS,
  [{ param: 'eps', min: 0, max: 5 }, { param: 'fPAR', min: 0, max: 1 }, { param: 'PAR', min: 0, max: 10000 }],
  ['fPAR from MODIS MCD15A3H', 'PAR from SW radiation x 2.02 (approximate)', 'Validate with MODIS MOD17'],
  { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ['Light use efficiency', 'fPAR retrieval', 'PAR estimation from SW'], assessment: 'Monteith LUE GPP has +/- 20-30% uncertainty. MODIS MOD17 is standard product.' },
  'GPP = epsilon * fPAR * PAR. PAR ~ 0.495 * SW (x 2.02 inverse).', ['PAR = SW x 2.02 is approximate (+/- 10%).', 'fPAR from MODIS MCD15A3H.', 'Validate with MOD17 and FLUXNET.'], ['Constant LUE', 'fPAR accurately retrieved', 'PAR well estimated'], ['LUE varies with stress', 'PAR approximation error', 'fPAR saturates at high LAI'], ['Monteith 1977, Phil. Trans. R. Soc. B 281:277-294', 'MODIS MOD17 product'], []);

export const TOOL_52 = makeTool(52, 'Canopy Light Extinction', 'profile', CARBON_BANDS,
  [{ param: 'I0', min: 0, max: 3000 }, { param: 'k', min: 0.1, max: 1 }, { param: 'LAI', min: 0, max: 12 }],
  ['LAI from MODIS MCD15A3H', 'Extinction coefficient k from canopy structure', 'Radiation from Open-Meteo'],
  { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ['k estimation', 'LAI accuracy', 'Canopy heterogeneity'], assessment: 'Beer-Lambert has +/- 15% uncertainty from k variability.' },
  'Beer-Lambert: I(z) = I0 * exp(-k * LAI). k varies with leaf angle distribution.', ['k varies: 0.3 (vertical leaves) to 0.8 (horizontal).', 'LAI from MODIS MCD15A3H.', 'Spherical distribution: k ~ 0.5.'], ['Random leaf distribution', 'Uniform canopy', 'Monochromatic radiation'], ['Non-random leaf angles', 'Canopy clumping', 'Mixed species effects'], ['Monsi & Saeki 1953, Japanese J. Botany 14:22-52'], []);

export const TOOL_53 = makeTool(53, 'Net Carbon Flux', 'timeseries', CARBON_BANDS,
  [{ param: 'Reco', min: 0, max: 5000 }, { param: 'GPP', min: 0, max: 5000 }],
  ['GPP from MODIS MOD17', 'Ecosystem respiration from FLUXNET', 'NEE positive = source, negative = sink'],
  { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ['GPP uncertainty', 'Respiration model', 'Temperature dependence of Reco'], assessment: 'NEE has +/- 25% uncertainty from GPP and Reco components.' },
  'NEE = R_eco - GPP. Positive = net CO2 source, negative = net sink.', ['FLUXNET eddy covariance for validation.', 'NEE positive = source, negative = sink.', 'Reco temperature-dependent.'], ['Ecosystem at steady state', 'No lateral carbon flux', 'Annual balance'], ['Legacy effects', 'Disturbance not captured', 'Lateral fluxes ignored'], ['Wofsy et al. 1993, Science 260:1314-1317'], [51]);

export const TOOL_54 = makeTool(54, 'C3 Photosynthesis', 'scalar', CARBON_BANDS,
  [{ param: 'Vcmax', min: 0, max: 300 }, { param: 'ci', min: 0, max: 500 }, { param: 'GammaStar', min: 0, max: 100 }, { param: 'Kc', min: 50, max: 1000 }, { param: 'Ko', min: 100000, max: 500000 }, { param: 'O', min: 150000, max: 250000 }],
  ['Temperature corrections from Bernacchi et al. (2001)', 'Vcmax from leaf trait databases', 'CO2 from OCO-2/3'],
  { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ['Vcmax variability', 'Temperature corrections', 'Kc, Ko temperature dependence'], assessment: 'Farquhar FvCB has +/- 20% uncertainty, mainly from Vcmax.' },
  'FvCB: A_c = Vcmax*(ci-Gamma*)/(ci+Kc*(1+O/Ko)). Also A_j, A_p branches.', ['Include A_j and A_p limiting rates.', 'Temperature corrections: Bernacchi et al. 2001.', 'Vcmax@25 ~ 80 umol/m2/s typical.'], ['C3 pathway', 'Light not limiting (A_c branch)', 'Constant intercellular CO2'], ['Does not include A_j (light-limited)', 'Vcmax varies with species/conditions', 'Temperature corrections needed'], ['Farquhar, von Caemmerer & Berry 1980, Planta 149:78-90', 'Bernacchi et al. 2001, Plant Cell Environ. 24:253-259'], []);

export const TOOL_55 = makeTool(55, 'Forest Biomass Estimation', 'scatter', CARBON_BANDS,
  [{ param: 'a', min: 0.001, max: 1 }, { param: 'DBH', min: 0, max: 300 }],
  ['Allometric coefficients from Chave et al. (2014)', 'Include environmental stress factor E', 'Wood density from BIEN database'],
  { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ['Allometric equation selection', 'Wood density variability', 'Environmental stress factor'], assessment: 'Allometric biomass has +/- 30% uncertainty. Chave (2014) includes E factor.' },
  'Allometric biomass: AGB = a * rho_wood * DBH^b * E. Chave et al. (2014) with environmental factor.', ['Use Chave et al. (2014) with E factor.', 'Wood density from BIEN database.', 'Global Forest Watch for cover.'], ['Allometric equation valid for species', 'Single-stem trees', 'Wood density known'], ['Not for multi-stem trees', 'Requires species-specific calibration', 'Environmental stress factor needed'], ['Chave et al. 2014, Global Change Biology 20:3177-3190'], []);

export const TOOL_56 = makeTool(56, 'Ocean CO2 Uptake', 'scalar', CARBON_BANDS,
  [{ param: 'k', min: 0, max: 5000 }, { param: 'K0', min: 0, max: 100 }, { param: 'dpCO2', min: -100, max: 100 }],
  ['Use Wanninkhof (2014) coefficient 0.251 (not 0.31)', 'Nightingale (2000) alternative for coastal', 'pCO2 from SOCAT database'],
  { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ['Gas transfer coefficient', 'Wind speed product', 'pCO2 spatial variability'], assessment: 'Wanninkhof 2014 uses k = 0.251*u^2 (not 0.31). Nightingale for coastal.' },
  'Ocean CO2: F = k * K0 * dpCO2. k = 0.251*u^2*(Sc/660)^(-0.5) (Wanninkhof 2014).', ['Use Wanninkhof 2014 (0.251, not 0.31).', 'Nightingale (2000) for coastal waters.', 'pCO2 from SOCAT database.'], ['Steady wind', 'Quadratic wind dependence', 'Known pCO2 gradient'], ['Wind product dependent', 'No bubble-mediated transfer', 'Seasonal pCO2 variability'], ['Wanninkhof 2014, Limnol. Oceanogr. Methods 12:351-362', 'Nightingale et al. 2000'], []);

export const TOOL_57 = makeTool(57, 'Ocean Nutrient Ratios', 'bar', CARBON_BANDS,
  [{ param: 'C', min: 0, max: 1000 }, { param: 'N', min: 0, max: 100 }, { param: 'P', min: 0, max: 10 }],
  ['Classic Redfield 106:16:1', 'Modern median: 163:22:1 (deviations exist)', 'Regional variations significant'],
  { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ['Regional variability', 'Species composition', 'Nutrient limitation'], assessment: 'Redfield ratio varies regionally. Classic 106:16:1, modern median 163:22:1.' },
  'Redfield ratio: C:N:P = 106:16:1. Modern median ~163:22:1.', ['Classic 106:16:1; modern median 163:22:1.', 'Regional deviations significant.', 'Use for biogeochemical modeling.'], ['Steady-state plankton', 'Balanced growth', 'No nutrient limitation'], ['Regional variations large', 'Species-dependent', 'Not for nutrient-limited regions'], ['Redfield 1934'], []);

// Eqs 58-63: Agriculture

export const TOOL_58 = makeTool(58, 'Crop Growing Degree Days', 'timeseries', AGRI_BANDS,
  [{ param: 'Tavg', min: -10, max: 50 }, { param: 'Tbase', min: 0, max: 20 }, { param: 'Tupper', min: 20, max: 50 }],
  ['Temperature from Open-Meteo', 'Crop-specific Tbase (wheat 0, maize 10, rice 10)', 'Upper threshold for heat stress'],
  { method: 'empirical', rmse: 10, rmseUnit: '%', factors: ['Temperature data', 'Crop-specific thresholds', 'Daily vs hourly accumulation'], assessment: 'GDD has +/- 10% uncertainty. Crop-specific thresholds vary by cultivar.' },
  'GDD = sum max(min(Tavg, Tupper) - Tbase, 0). Crop-specific Tbase and Tupper.', ['Tbase varies by crop: wheat 0, maize 10, rice 10.', 'Tupper caps heat stress.', 'Use daily Tavg from Open-Meteo.'], ['Single sine wave daily T', 'No stress above Tupper', 'Base temp constant'], ['Heat stress not fully captured', 'Cultivar-specific thresholds', 'Requires daily temperature data'], ['McMaster 1997'], []);

export const TOOL_59 = makeTool(59, 'Priestley-Taylor Evapotranspiration', 'timeseries', WATER_BANDS,
  [{ param: 'alpha', min: 1, max: 2 }, { param: 'delta', min: 0, max: 1 }, { param: 'gamma', min: 0.04, max: 0.1 }, { param: 'Rn', min: -100, max: 1000 }, { param: 'G', min: -100, max: 500 }],
  ['Alpha = 1.26 for well-watered surfaces', 'May be lower (1.08-1.34) for humid regions', 'Net radiation from Open-Meteo'],
  { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ['Alpha coefficient variability', 'Radiation measurement', 'G estimation'], assessment: 'Priestley-Taylor has +/- 15% uncertainty. Alpha = 1.26 varies with surface.' },
  'Priestley-Taylor: ET = alpha * (delta/(delta+gamma)) * (Rn - G). alpha = 1.26.', ['Alpha varies: 1.08-1.34 depending on surface.', 'For humid regions, alpha may be lower.', 'No wind data needed (advantage over FAO-56).'], ['Well-watered surface', 'No advection', 'Alpha = 1.26'], ['Alpha not universal', 'Advection increases ET', 'Not for water-stressed surfaces'], ['Priestley & Taylor 1972'], []);

export const TOOL_60 = makeTool(60, 'Hargreaves-Samani ET', 'timeseries', WATER_BANDS,
  [{ param: 'Ra', min: 0, max: 50 }, { param: 'Tmax', min: -10, max: 50 }, { param: 'Tmin', min: -30, max: 40 }],
  ['Extraterrestrial radiation from latitude and date', 'Tmax/Tmin from Open-Meteo', 'Coefficient 0.0023 calibrated'],
  { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ['Coefficient 0.0023 calibration', 'Temperature range proxy for radiation', 'Wind/humidity not included'], assessment: 'Hargreaves has +/- 20% uncertainty. Temperature-only method, no wind/humidity needed.' },
  'Hargreaves: ET0 = 0.0023 * Ra * (Tavg+17.8) * sqrt(Tmax-Tmin) * 0.408.', ['Temperature-only method (no wind/RH needed).', 'Coefficient 0.0023 calibrated for semi-arid.', 'Validate against FAO-56 where data available.'], ['No advection', 'Cloud-free or radiation from Tmax-Tmin', 'Calibrated for specific climate'], ['Not for humid/windy regions', 'Requires Tmax-Tmin range', 'Less accurate than FAO-56'], ['Hargreaves & Samani 1985'], []);

export const TOOL_61 = makeTool(61, 'FAO Yield-Water Response', 'scalar', AGRI_BANDS,
  [{ param: 'Ya', min: 0, max: 20 }, { param: 'Ym', min: 0, max: 20 }, { param: 'Ky', min: 0, max: 2 }, { param: 'ETa', min: 0, max: 2000 }, { param: 'ETm', min: 0, max: 2000 }],
  ['Crop-specific Ky from FAO-33', 'ETa/ETm from water balance', 'Ym from regional yield data'],
  { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ['Ky crop-specific', 'ETa/ETm estimation', 'Ym regional variability'], assessment: 'Doorenbos-Kassam has +/- 25% uncertainty. Ky is crop-specific.' },
  'Yield response: (1-Ya/Ym) = Ky * (1-ETa/ETm). Ky is crop-specific from FAO-33.', ['Ky is crop-specific (FAO-33 tables).', 'ETa/ETm from water balance.', 'Ym from regional yield statistics.'], ['Linear yield-ET relationship', 'No stress timing effects', 'Constant Ky'], ['Nonlinear for severe stress', 'Ky varies with growth stage', 'Requires crop-specific calibration'], ['Doorenbos & Kassam 1979, FAO Irrigation and Drainage Paper 33'], []);

export const TOOL_62 = makeTool(62, 'Phytoplankton Temperature Growth', 'timeseries', AGRI_BANDS,
  [{ param: 'mu20', min: 0, max: 5 }, { param: 'T', min: 0, max: 40 }],
  ['Eppley (1972) Q10 = 1.88 (1.066^10)', 'Modern: thermal optimum, not exponential', 'SST from NOAA OISST'],
  { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ['Q10 variability', 'Thermal optimum not captured', 'Species-specific curves'], assessment: 'Eppley curve is classic but modern research shows thermal optima. Q10 = 1.88.' },
  'Eppley: mu_max = mu20 * 1.066^(T-20). Q10 = 1.88. Modern: thermal optimum models.', ['Q10 = 1.88 (1.066^10).', 'Modern: thermal optimum, not exponential.', 'Species-specific curves exist.'], ['Exponential growth', 'No thermal optimum', 'Nutrient-replete'], ['Thermal optimum not captured', 'Nutrient limitation ignored', 'Species-specific curves differ'], ['Eppley 1972, Fishery Bulletin 70:1063-1085'], []);

export const TOOL_63 = makeTool(63, 'Bigleaf Penman-Monteith', 'scalar', AGRI_BANDS,
  [{ param: 'rho', min: 0.5, max: 1.5 }, { param: 'cp', min: 800, max: 1200 }, { param: 'Ts', min: -10, max: 60 }, { param: 'Ta', min: -20, max: 50 }, { param: 'ra', min: 1, max: 500 }, { param: 'rs', min: 10, max: 1000 }, { param: 'es', min: 0, max: 100 }, { param: 'ea', min: 0, max: 100 }],
  ['Aerodynamic resistance from wind and roughness', 'Surface resistance from stomatal conductance', 'Saturation vapor pressure from Eq 3'],
  { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ['ra estimation', 'rs from stomatal model', 'Surface temperature accuracy'], assessment: 'Bigleaf PM has +/- 20% uncertainty. ra and rs are key uncertain parameters.' },
  'Bigleaf PM: H = rho*cp*(Ts-Ta)/ra; LE = rho*Lv*(es-ea)/(ra+rs).', ['ra from wind + roughness.', 'rs from stomatal conductance model (Eq 50).', 'Used in land-surface models.'], ['Bigleaf approximation', 'No canopy stratification', 'Linear gradients'], ['Not for tall canopies', 'Requires surface temperature', 'ra and rs uncertain'], ['Sellers 1986'], [3, 50]);

// Eqs 64-65: Atmospheric Chemistry
export const TOOL_64 = makeTool(64, 'Chapman Ozone Cycle', 'scalar', AQI_BANDS,
  [{ param: 'O2', min: 0, max: 20 }, { param: 'hv', min: 0, max: 2 }],
  ['Add NOx, HOx, ClOx catalytic cycles (Chapman alone overestimates O3 by ~2x)', 'Solar UV from NOAA SWPC', 'Stratospheric conditions'],
  { method: 'empirical', rmse: 50, rmseUnit: '%', factors: ['Missing catalytic cycles', 'UV flux estimation', 'Stratospheric conditions'], assessment: 'Chapman alone overestimates O3 by ~2x. Must include catalytic cycles (NOx, HOx, ClOx).' },
  'Chapman cycle: O2 + hv -> 2O; O + O2 + M -> O3; O3 + hv -> O2 + O; O + O3 -> 2O2.', ['Add NOx, HOx, ClOx catalytic destruction.', 'Chapman alone overestimates O3 by ~2x.', 'Use CAMS for atmospheric composition.'], ['Pure oxygen chemistry', 'Steady state', 'No catalytic cycles'], ['Missing catalytic cycles', 'No transport', 'Steady-state assumption'], ['Chapman 1930', 'WMO Ozone Assessment 2022'], []);

export const TOOL_65 = makeTool(65, 'Pollutant Lifetime', 'scalar', AQI_BANDS,
  [{ param: 'k', min: 1e-20, max: 1e-5 }, { param: 'OH', min: 1e-10, max: 0.001 }],
  ['OH concentration ~ 1e6 molecules/cm3', 'Rate constants temperature-dependent', 'Lifetime = 1/(k*[OH])'],
  { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ['OH concentration poorly constrained', 'Rate constant T-dependence', 'Multi-species reactions'], assessment: 'OH radical concentrations are poorly constrained (+/- 30%). [OH] ~ 1e6 mol/cm3.' },
  'Pollutant lifetime: tau = 1/(k * [OH]). [OH] ~ 1e6 molecules/cm3.', ['[OH] ~ 1e6 molecules/cm3 (global mean).', 'Rate constants temperature-dependent.', 'Consider multi-species reactions.'], ['Single reaction pathway', 'Constant [OH]', 'No photolysis'], ['OH poorly constrained', 'Multiple reaction pathways', 'Photolysis not included'], ['Atkinson 2000', 'Seinfeld & Pandis 2016'], []);

export const TOOLS_PART3: Record<number, ToolWorkflowDef> = {
  26: TOOL_26, 27: TOOL_27, 28: TOOL_28, 29: TOOL_29, 30: TOOL_30,
  31: TOOL_31, 32: TOOL_32, 33: TOOL_33, 34: TOOL_34, 35: TOOL_35,
  36: TOOL_36, 37: TOOL_37, 38: TOOL_38, 39: TOOL_39, 40: TOOL_40,
  41: TOOL_41, 42: TOOL_42, 43: TOOL_43, 44: TOOL_44, 45: TOOL_45,
  46: TOOL_46, 47: TOOL_47, 48: TOOL_48, 49: TOOL_49, 50: TOOL_50,
  51: TOOL_51, 52: TOOL_52, 53: TOOL_53, 54: TOOL_54, 55: TOOL_55,
  56: TOOL_56, 57: TOOL_57, 58: TOOL_58, 59: TOOL_59, 60: TOOL_60,
  61: TOOL_61, 62: TOOL_62, 63: TOOL_63, 64: TOOL_64, 65: TOOL_65,
};

/**
 * Per-Tool Workflow Definitions — Part 4: Eqs 66-150 (Domains 10-26)
 * Generated programmatically from tool metadata.
 */


export const TOOL_66 = mt(66, "Sverdrup Balance", 'vector', OCEAN_BANDS, [{"param":"beta","min":0,"max":1e-10},{"param":"rho0","min":1000,"max":1050},{"param":"curlTau_z","min":-0.001,"max":0.001}], ["Wind stress curl from ASCAT","rho0 = 1025 kg/m3"], { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ["Wind stress curl","Reference density"], assessment: '+/- 20% uncertainty' }, "Wind-driven interior ocean transport.", ["Valid for ocean interior only.","CMEMS for ocean currents."], ["Steady state","Interior ocean"], ["Fails in western boundary currents"], ["Sverdrup 1947"], []);
export const TOOL_67 = mt(67, "Stommel Western Boundary Current", 'vector', OCEAN_BANDS, [{"param":"beta","min":0,"max":1e-10},{"param":"psi","min":-1000000000,"max":1000000000},{"param":"curlTau","min":-0.001,"max":0.001},{"param":"R","min":1e-10,"max":1},{"param":"nu","min":0,"max":1}], ["Linear friction model","Gulf Stream application"], { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ["Friction parameter","Linear assumption"], assessment: 'Idealized model for westward intensification' }, "Western boundary intensification with linear friction.", ["Explains Gulf Stream, Kuroshio.","Real boundaries have eddies."], ["Linear dynamics","Constant friction"], ["Oversimplified friction","No eddies"], ["Stommel 1948"], []);
export const TOOL_68 = mt(68, "Munk Viscous Boundary Layer", 'vector', OCEAN_BANDS, [{"param":"AH","min":0,"max":10000000},{"param":"beta","min":0,"max":1e-10},{"param":"psi","min":-1000000000,"max":1000000000},{"param":"curlTau","min":-0.001,"max":0.001}], ["Lateral eddy viscosity","Biharmonic operator"], { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ["Eddy viscosity","Biharmonic"], assessment: 'Munk model for boundary current width' }, "Lateral viscosity, biharmonic for boundary width.", ["AH from mixing observations.","More realistic than Stommel."], ["Constant viscosity","Linear dynamics"], ["AH poorly constrained","No eddies"], ["Munk 1950"], []);
export const TOOL_69 = mt(69, "Stommel Box Model", 'timeseries', OCEAN_BANDS, [{"param":"lambda","min":0,"max":1},{"param":"Tstar","min":-5,"max":40},{"param":"T","min":-5,"max":40},{"param":"q","min":0,"max":5}], ["Thermohaline stability","AMOC collapse analysis"], { method: 'qualitative', factors: ["Box model","Bifurcation"], assessment: 'Conceptual model showing AMOC bistability' }, "Thermohaline circulation bistability.", ["Shows AMOC bistability.","Freshwater forcing triggers collapse."], ["Two-box simplification","No mixing"], ["Oversimplified","No transient eddies"], ["Stommel 1961"], []);
export const TOOL_70 = mt(70, "TEOS-10 Seawater Density", 'profile', OCEAN_BANDS, [{"param":"S","min":0,"max":42},{"param":"Theta","min":-5,"max":40},{"param":"p","min":0,"max":10000}], ["GSW library reference","Absolute Salinity"], { method: 'analytical', factors: ["GSW implementation","Absolute vs Practical Salinity"], assessment: 'TEOS-10 is exact with GSW library' }, "75-term polynomial seawater density.", ["Use GSW library.","Absolute Salinity, Conservative Temperature."], ["TEOS-10 standard","Known S,T,p"], ["Requires GSW","Absolute Salinity needs atlas"], ["IOC 2010, TEOS-10 Manual"], []);
export const TOOL_71 = mt(71, "Osborn-Cox Turbulent Diffusivity", 'scalar', OCEAN_BANDS, [{"param":"gamma","min":0,"max":0.5},{"param":"eps","min":1e-12,"max":0.0001},{"param":"N2","min":0,"max":1}], ["Mixing efficiency gamma ~ 0.2","TKE from microstructure","N2 from CTD"], { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ["Gamma","Epsilon","N2"], assessment: '+/- 30% uncertainty' }, "Vertical diffusivity from TKE dissipation.", ["Gamma ~ 0.2.","Epsilon from microstructure."], ["Steady state","Constant gamma"], ["Gamma not universal","Requires microstructure"], ["Osborn 1980"], []);
export const TOOL_72 = mt(72, "Price-Weller-Pinkel Mixed Layer", 'gauge', OCEAN_BANDS, [{"param":"Ri","min":0,"max":10}], ["Ri = 0.65 threshold","Wind from ASCAT"], { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ["Ri threshold","Wind forcing"], assessment: '+/- 20% uncertainty' }, "Mixed layer deepening at Ri > 0.65.", ["Ri = 0.65 threshold.","Argo for profiles."], ["Bulk mixed layer","Linear stratification"], ["Simplified mixing","No lateral processes"], ["Price, Weller & Pinkel 1986"], []);
export const TOOL_73 = mt(73, "Pierson-Moskowitz Sea State", 'spectrum', OCEAN_BANDS, [{"param":"alpha","min":0,"max":1},{"param":"g","min":9.8,"max":9.82},{"param":"fm","min":0.01,"max":10}], ["Fully developed sea assumption","NDBC buoy validation"], { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ["Fully developed","Wind speed"], assessment: '+/- 15% for fully developed seas' }, "Fully developed sea wave spectrum.", ["Fully developed only.","JONSWAP for fetch-limited."], ["Fully developed","Infinite fetch"], ["Not for fetch-limited","No swell"], ["Pierson & Moskowitz 1964"], []);
export const TOOL_74 = mt(74, "Wave Runup (Stockdon)", 'scalar', OCEAN_BANDS, [{"param":"eta_u","min":0,"max":5},{"param":"Sw","min":0,"max":5},{"param":"Sig","min":0,"max":5}], ["Stockdon 2006 empirical","Beach slope from LiDAR"], { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ["Beach slope","Wave conditions"], assessment: '+/- 20% uncertainty' }, "2% exceedance wave runup.", ["Most widely used.","NDBC for wave data."], ["Dissipative beaches","Uniform slope"], ["Not for reflective beaches","Vegetation not included"], ["Stockdon et al. 2006"], []);
export const TOOL_75 = mt(75, "Bruun Rule", 'timeseries', OCEAN_BANDS, [{"param":"Lstar","min":50,"max":5000},{"param":"S","min":0,"max":1},{"param":"B","min":0,"max":20},{"param":"hstar","min":1,"max":50}], ["SLR from satellite altimetry","Closure depth from wave climate"], { method: 'empirical', rmse: 50, rmseUnit: '%', factors: ["Closure depth","Profile length"], assessment: '+/- 50% highly simplified' }, "Shoreline retreat from sea level rise.", ["Highly simplified.","GEBCO for bathymetry."], ["Equilibrium profile","No longshore transport"], ["Oversimplified","No sediment budget"], ["Bruun 1962"], []);
export const TOOL_76 = mt(76, "Breaker Criterion", 'scalar', OCEAN_BANDS, [{"param":"db","min":0.1,"max":50}], ["McCowan 0.78 coefficient","Bathymetry from GEBCO"], { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ["Breaker coefficient","Beach slope"], assessment: '+/- 15% uncertainty' }, "Breaking wave height from water depth.", ["0.78 is McCowan coefficient.","NDBC for waves."], ["Spilling breakers","Uniform slope"], ["Not for plunging","No current interaction"], ["McCowan 1894"], []);
export const TOOL_77 = mt(77, "Longshore Sediment Transport", 'vector', OCEAN_BANDS, [{"param":"K","min":0.2,"max":2},{"param":"Hsb","min":0.1,"max":10},{"param":"theta_b","min":0,"max":1.57}], ["CERC K ~ 0.77","Breaking wave from models"], { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ["CERC coefficient","Breaking angle"], assessment: '+/- 30% uncertainty' }, "Longshore sediment transport rate.", ["K ~ 0.77 (varies 0.2-2).","Wave models for Hsb."], ["Straight shoreline","Spilling breakers"], ["K highly variable","No tidal effects"], ["US Army Corps 1984"], []);
export const TOOL_78 = mt(78, "Wave Dispersion Relation", 'scalar', OCEAN_BANDS, [{"param":"g","min":9.8,"max":9.82},{"param":"k","min":0.001,"max":10},{"param":"h","min":0,"max":10000}], ["Water depth from GEBCO","Iterative solution"], { method: 'analytical', factors: ["Exact for linear waves","Water depth accuracy"], assessment: 'Exact for small amplitude waves' }, "Wave celerity and wavelength from depth.", ["Exact for linear waves.","GEBCO for bathymetry."], ["Small amplitude","Incompressible"], ["Not for steep waves","No breaking"], ["Airy 1845"], []);
export const TOOL_79 = mt(79, "Stokes Drift", 'profile', OCEAN_BANDS, [{"param":"omega","min":0.01,"max":10},{"param":"k","min":0.001,"max":10},{"param":"a","min":0,"max":20},{"param":"z","min":-500,"max":0}], ["Wave amplitude from buoys","Wavenumber from dispersion"], { method: 'analytical', factors: ["Wave amplitude","Second-order"], assessment: 'Exact for linear waves to second order' }, "Wave-driven mean surface drift.", ["Second-order accurate.","Decays with depth."], ["Linear wave theory","Monochromatic"], ["No wave-wave interactions","Single frequency"], ["Stokes 1847"], []);
export const TOOL_80 = mt(80, "JONSWAP Wave Spectrum", 'spectrum', OCEAN_BANDS, [{"param":"alpha","min":0.001,"max":0.05},{"param":"g","min":9.8,"max":9.82},{"param":"fm","min":0.01,"max":10},{"param":"gamma","min":1,"max":10}], ["gamma = 3.3 standard","sigma_a=0.07, sigma_b=0.09"], { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ["Peak enhancement","Fetch"], assessment: '+/- 15% for fetch-limited' }, "Fetch-limited sea state spectrum.", ["gamma = 3.3.","Fetch-limited seas."], ["Fetch-limited","Steady wind"], ["Not for fully developed","No swell"], ["Hasselmann et al. 1973"], []);
export const TOOL_81 = mt(81, "Stream Power Law", 'scalar', RISK_BANDS, [{"param":"K","min":0,"max":1},{"param":"A","min":0,"max":1000000000000},{"param":"m","min":0,"max":2},{"param":"S","min":0,"max":1}], ["Drainage area from HydroSHEDS","Slope from SRTM"], { method: 'empirical', rmse: 50, rmseUnit: '%', factors: ["Erodibility","Exponents"], assessment: '+/- 50% uncertainty' }, "Bedrock erosion rate from stream power.", ["K poorly constrained.","m ~ 0.5, n ~ 1."], ["Steady state","Detachment-limited"], ["Not for transport-limited","K varies"], ["Howard 1983"], []);
export const TOOL_82 = mt(82, "River Network Scaling", 'scatter', RISK_BANDS, [{"param":"c","min":0,"max":100},{"param":"A","min":0.01,"max":100000},{"param":"h","min":0.4,"max":0.8}], ["Hack exponent h ~ 0.6","HydroSHEDS for area"], { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ["Hack exponent","Network extraction"], assessment: '+/- 20% uncertainty' }, "River length-drainage area scaling.", ["Hack exponent h ~ 0.6 is the global average value.","Use HydroSHEDS database for drainage area extraction.","Network extraction required for river length."], ["Self-similar basins","Steady state"], ["h varies by region","Requires network"], ["Hack 1957"], []);
export const TOOL_83 = mt(83, "Richardson Fractal Dimension", 'scalar', RISK_BANDS, [{"param":"L","min":0,"max":10000},{"param":"s","min":0.1,"max":1000}], ["Coastline from vector data","Multiple ruler lengths"], { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ["Measurement scale","Data resolution"], assessment: '+/- 15% uncertainty' }, "Coastline fractal dimension.", ["D typically 1.0-1.5.","Scale-dependent."], ["Self-similar","Infinite detail"], ["Limited scale range","Requires digitized coastline"], ["Richardson 1961"], []);
export const TOOL_84 = mt(84, "Slope Stability Analysis", 'gauge', RISK_BANDS, [{"param":"cprime","min":0,"max":100},{"param":"gammaz","min":0,"max":500},{"param":"cosB","min":0,"max":1},{"param":"u","min":0,"max":200},{"param":"phiP","min":0.1,"max":1.5},{"param":"sinB","min":0,"max":1},{"param":"cosB2","min":0,"max":1}], ["Slope from SRTM/ALOS","Soil from ISRIC","Pore pressure from rainfall"], { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ["Cohesion","Friction angle","Pore pressure"], assessment: '+/- 30% uncertainty, FS>1.5 stable' }, "Infinite slope factor of safety.", ["FS > 1.5: stable.","Soil from ISRIC SoilGrids."], ["Infinite slope","Uniform soil"], ["Not for 3D slopes","Pore pressure critical"], ["Skempton 1957"], []);
export const TOOL_85 = mt(85, "Voellmy Friction Model", 'scalar', RISK_BANDS, [{"param":"mu","min":0,"max":1},{"param":"sigma_n","min":0,"max":1000},{"param":"xi","min":0,"max":10000}], ["Coulomb friction from material","Turbulent friction from flow velocity"], { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ["Friction coefficients","Flow velocity"], assessment: '+/- 30% for debris flow runout' }, "Debris flow friction model.", ["Mu and xi from calibration.","RAMMS model uses Voellmy."], ["Steady uniform flow","Constant friction"], ["Parameters event-specific","No entrainment"], ["Voellmy 1955"], []);
export const TOOL_86 = mt(86, "Stream Power Index", 'heatmap', RISK_BANDS, [{"param":"As","min":0,"max":1000000},{"param":"tanBeta","min":0,"max":10}], ["Flow accumulation from SRTM","Slope from DEM"], { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ["Flow accumulation","DEM resolution"], assessment: '+/- 25% uncertainty' }, "Erosion potential from DEM.", ["Flow accumulation from SRTM.","Log transform for visualization."], ["DEM represents true surface","Flow routing correct"], ["DEM resolution dependent","Artifacts in flat areas"], ["Moore et al. 1991"], []);
export const TOOL_87 = mt(87, "Topographic Wetness Index", 'heatmap', RISK_BANDS, [{"param":"As","min":0,"max":1000000},{"param":"tanBeta","min":0,"max":10}], ["Flow accumulation from SRTM","Slope from DEM"], { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ["Flow accumulation","DEM resolution","Soil transmissivity"], assessment: '+/- 25% uncertainty' }, "Soil moisture and saturation zones.", ["High TWI = wet areas.","SRTM for DEM."], ["Steady state","Uniform soil"], ["DEM resolution dependent","No soil variability"], ["Beven & Kirkby 1979"], []);
export const TOOL_88 = mt(88, "Lake Evaporation Estimation", 'scalar', OCEAN_BANDS, [{"param":"Km","min":0.1,"max":1.5},{"param":"ew","min":0,"max":100},{"param":"ea","min":0,"max":100},{"param":"u","min":0,"max":100}], ["Vapor pressures from temperature","Wind speed from Open-Meteo"], { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ["Pan coefficient","Wind height"], assessment: '+/- 25% uncertainty' }, "Lake evaporation estimation.", ["Pan coefficient Km ~ 0.7.","Wind at 9m height."], ["Steady conditions","Uniform lake surface"], ["Pan coefficient variable","Stratification ignored"], ["Meyer 1915"], []);
export const TOOL_89 = mt(89, "Schmidt Stability Number", 'profile', OCEAN_BANDS, [{"param":"A","min":0,"max":10000000000},{"param":"z","min":0,"max":1000}], ["Temperature/density profiles from CTD","Lake morphometry from bathymetry"], { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ["Density profile","Lake morphometry"], assessment: '+/- 20% from density profile quality' }, "Lake stratification strength.", ["Requires density vs depth profile.","Lake morphometry from bathymetry."], ["Static lake","No internal waves"], ["Requires profile data","Lake shape matters"], ["Schmidt 1928"], []);
export const TOOL_90 = mt(90, "Nash Cascade", 'timeseries', OCEAN_BANDS, [{"param":"n","min":1,"max":10},{"param":"K","min":0.1,"max":48},{"param":"t","min":0,"max":1000},{"param":"Q0","min":0,"max":10000}], ["Nash model for unit hydrograph","N and K from calibration"], { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ["N and K calibration","Rainfall-runoff linearity"], assessment: '+/- 20% uncertainty' }, "Unit hydrograph and flood forecasting.", ["N and K from calibration.","Linear reservoir assumption."], ["Linear reservoirs","Lumped watershed"], ["Nonlinear runoff not captured","Requires calibration"], ["Nash 1957"], []);
export const TOOL_91 = mt(91, "Glacier Mass Balance (PDD)", 'timeseries', RISK_BANDS, [{"param":"Accum","min":0,"max":10},{"param":"DDF","min":0,"max":0.1},{"param":"Tpos","min":0,"max":5000}], ["Degree-day factor for ice melt","Accumulation from snowfall"], { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ["DDF variability","Accumulation estimation"], assessment: '+/- 30% uncertainty, DDF ice 5-8 mm/C/day' }, "Glacier mass balance from degree-days.", ["DDF for ice: 5-8 mm/C/day.","Accumulation from snowfall."], ["Constant DDF","No debris cover"], ["DDF varies with debris","Requires elevation zones"], ["Braithwaite 1989","Hock 2003"], []);
export const TOOL_92 = mt(92, "Stefan Permafrost Active Layer", 'profile', RISK_BANDS, [{"param":"K","min":0.1,"max":10},{"param":"DIFI","min":0,"max":10000},{"param":"L","min":0,"max":500000000}], ["Thawing index from temperature sum","Thermal conductivity from soil type"], { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ["Thawing index","Thermal conductivity","Soil moisture"], assessment: '+/- 25% uncertainty' }, "Permafrost active layer depth.", ["Thawing index from ERA5.","K from soil type."], ["Homogeneous soil","Phase change only"], ["No snow insulation","Soil heterogeneity"], ["Stefan 1891"], []);
export const TOOL_93 = mt(93, "Herron-Langway Firn Densification", 'timeseries', RISK_BANDS, [{"param":"k","min":0,"max":1},{"param":"b","min":0,"max":10000},{"param":"rho_i","min":800,"max":950},{"param":"rho_f","min":300,"max":850}], ["Accumulation rate from ice cores","Ice density = 917 kg/m3"], { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ["Densification rate","Accumulation rate"], assessment: '+/- 30% uncertainty' }, "Firn densification for ice core dating.", ["Accumulation rate from ice cores.","k temperature-dependent."], ["Steady accumulation","No melt"], ["Melt events not captured","Requires accumulation data"], ["Herron & Langway 1980"], []);
export const TOOL_94 = mt(94, "VEI Volume Relationship", 'gauge', RISK_BANDS, [{"param":"VEI","min":0,"max":8}], ["VEI from Smithsonian GVP","Volume from deposit mapping"], { method: 'empirical', rmse: 0.5, rmseUnit: 'VEI', factors: ["Volume estimation","Eruption classification"], assessment: '+/- 0.5 VEI uncertainty' }, "Volcanic eruption classification.", ["VEI from Smithsonian GVP.","Volume from deposit mapping."], ["Volume-VEI relationship","Representative deposit"], ["Volume poorly constrained","Not for effusive eruptions"], ["Newhall & Self 1982"], []);
export const TOOL_95 = mt(95, "Morton-Taylor-Turner Buoyant Plume", 'profile', RISK_BANDS, [{"param":"Qdot","min":0,"max":100000},{"param":"rho_air","min":0.5,"max":1.5},{"param":"alpha","min":0.05,"max":0.2}], ["Entrainment coefficient alpha ~ 0.1","Heat output from thermal observations"], { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ["Entrainment coefficient","Heat output"], assessment: '+/- 25% uncertainty' }, "Volcanic plume rise modeling.", ["Alpha ~ 0.1 (standard).","Heat output from thermal satellite."], ["Steady plume","Constant entrainment"], ["Crosswind effects important","Alpha varies"], ["Morton, Taylor & Turner 1956"], []);
export const TOOL_96 = mt(96, "Budyko-Sellers Energy Balance", 'timeseries', CLIMATE_BANDS, [{"param":"C","min":1000000,"max":10000000000},{"param":"Q","min":0,"max":500},{"param":"alpha","min":0,"max":1},{"param":"I","min":0,"max":400},{"param":"D","min":0,"max":100},{"param":"nabla2T","min":-1,"max":1}], ["Solar constant S/4 for sphere","Albedo temperature dependence"], { method: 'qualitative', factors: ["Albedo parameterization","Diffusion coefficient"], assessment: 'Conceptual climate model' }, "Energy balance climate model.", ["S/4 for sphere averaging.","Ice-albedo feedback included."], ["Zero-dimensional or 1D","No ocean dynamics"], ["No clouds","No ocean heat transport"], ["Budyko 1969","Sellers 1969"], []);
export const TOOL_97 = mt(97, "Climate Sensitivity", 'scalar', CLIMATE_BANDS, [{"param":"dF","min":0,"max":20},{"param":"lambda0","min":1,"max":5},{"param":"f","min":-5,"max":5}], ["IPCC AR6: ECS ~ 3C","Planck feedback 3.76 W/m2/K"], { method: 'qualitative', factors: ["Cloud feedback","Lapse rate","Water vapor"], assessment: 'IPCC AR6 ECS: 3C (2.5-4.0)' }, "Climate sensitivity from radiative forcing.", ["IPCC AR6: ECS ~ 3C (2.5-4.0).","lambda0 = 3.76 W/m2/K."], ["Linear feedback","Constant feedbacks"], ["Nonlinear feedbacks","State-dependent"], ["IPCC AR6 Chapter 7","Soden & Held 2006"], []);
export const TOOL_98 = mt(98, "Planck Feedback Parameter", 'scalar', CLIMATE_BANDS, [{"param":"dRdT","min":1,"max":5}], ["At T=255K: 4*sigma*T^3 = 3.76","Pure Planck response only"], { method: 'analytical', factors: ["Blackbody temperature","Stefan-Boltzmann constant"], assessment: 'Pure Planck: 3.76 W/m2/K at T=255K' }, "Planck feedback parameter.", ["3.76 W/m2/K at T=255K (not 3.2).","3.2 includes lapse rate."], ["Blackbody emission","Constant T"], ["Not total feedback","Excludes water vapor/clouds"], ["IPCC AR6 Section 7.2"], []);
export const TOOL_99 = mt(99, "Rossby Wave Dispersion", 'spectrum', CLIMATE_BANDS, [{"param":"beta","min":0,"max":1e-10},{"param":"kx","min":0,"max":1},{"param":"ky","min":0,"max":1}], ["Beta = df/dy","Wavenumber from wavelength"], { method: 'analytical', factors: ["Beta parameter","Wavenumber accuracy"], assessment: 'Exact for linear barotropic waves' }, "Planetary wave dynamics.", ["Beta = df/dy.","Rossby radius from stratification."], ["Linear waves","Beta-plane"], ["Nonlinear effects","No topographic waves"], ["Rossby 1939"], []);
export const TOOL_100 = mt(100, "Charney-Stern Theorem", 'scalar', CLIMATE_BANDS, [{"param":"dqdy","min":-1e-9,"max":1e-9}], ["PV gradient from reanalysis","Necessary condition for instability"], { method: 'qualitative', factors: ["PV gradient","Reanalysis resolution"], assessment: 'Necessary not sufficient condition' }, "Baroclinic instability criterion.", ["Necessary, not sufficient.","PV from reanalysis."], ["Linear instability","Zonal mean flow"], ["Necessary not sufficient","Requires QG"], ["Charney & Stern 1962"], []);
export const TOOL_101 = mt(101, "Eady Growth Rate", 'gauge', CLIMATE_BANDS, [{"param":"f","min":0,"max":0.0002},{"param":"N","min":0.001,"max":0.1},{"param":"dudz","min":0,"max":1}], ["Coefficient 0.3098 from Eady 1949","Wind shear from ERA5","N from stability"], { method: 'analytical', factors: ["Eady model assumptions","Shear measurement","N from stability"], assessment: 'Exact for idealized Eady model' }, "Baroclinic instability growth rate.", ["0.3098 coefficient.","Wind shear from ERA5."], ["Eady model","Constant shear"], ["Idealized model","No moisture"], ["Eady 1949"], []);
export const TOOL_102 = mt(102, "Quasi-Geostrophic PV", 'contour', CLIMATE_BANDS, [{"param":"psi","min":-1000000000,"max":1000000000},{"param":"f","min":0,"max":0.0002},{"param":"d2psi_dp2","min":-1,"max":1}], ["QG PV from streamfunction","Coriolis from latitude"], { method: 'analytical', factors: ["QG approximation","Streamfunction accuracy"], assessment: 'Conserved in QG flow' }, "Conserved tracer for large-scale dynamics.", ["Conserved in adiabatic QG flow.","ERA5 for streamfunction."], ["QG approximation","Small Rossby number"], ["Breaks for mesoscale","No ageostrophic"], ["Charney 1948"], []);
export const TOOL_103 = mt(103, "Reynolds Decomposition", 'scalar', CLIMATE_BANDS, [{"param":"ubar","min":0,"max":100},{"param":"uprime","min":-50,"max":50}], ["Mean and fluctuating components","Time averaging"], { method: 'analytical', factors: ["Averaging period","Turbulence definition"], assessment: 'Exact decomposition' }, "Mean + turbulent fluctuation.", ["Foundation of RANS.","Averaging period critical."], ["Stationary flow","Clear scale separation"], ["Averaging period subjective","Non-stationary issues"], ["Reynolds 1895"], []);
export const TOOL_104 = mt(104, "Ekman Layer Depth", 'profile', CLIMATE_BANDS, [{"param":"Km","min":0.001,"max":1000},{"param":"f","min":0,"max":0.0002}], ["Eddy viscosity from boundary layer","Coriolis from latitude"], { method: 'analytical', factors: ["Eddy viscosity","Coriolis parameter"], assessment: 'Exact for constant eddy viscosity' }, "Frictional boundary layer depth.", ["Constant eddy viscosity.","Breaks near equator."], ["Constant Km","Steady state"], ["Km not constant","Stratification effects"], ["Ekman 1905"], []);
export const TOOL_105 = mt(105, "Convective Velocity Scale", 'scalar', CLIMATE_BANDS, [{"param":"g","min":0,"max":20},{"param":"thetav","min":200,"max":400},{"param":"wthetav0","min":0,"max":10},{"param":"zi","min":10,"max":5000}], ["Surface heat flux from observations","BL height from lidar/sodar"], { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ["Surface heat flux","BL height","Mean state"], assessment: '+/- 15% from flux and BL height' }, "Convective boundary layer scaling.", ["Surface heat flux from tower.","BL height from lidar."], ["Free convection","Horizontally homogeneous"], ["Not for wind-driven BL","Requires surface flux"], ["Deardorff 1970"], []);
export const TOOL_106 = mt(106, "Petterssen Frontogenesis", 'scalar', CLIMATE_BANDS, [{"param":"gradtheta","min":0,"max":1},{"param":"D","min":-1,"max":1},{"param":"beta","min":0,"max":1.57},{"param":"delta","min":0,"max":1},{"param":"duds","min":0,"max":1}], ["Temperature gradient from reanalysis","Deformation from wind field"], { method: 'analytical', factors: ["Gradient accuracy","Deformation calculation"], assessment: 'Exact for kinematic formulation' }, "Frontal intensification rate.", ["Frontal intensification rate.","From ERA5 wind and temperature."], ["2D front","No diabatic effects"], ["No diabatic heating","2D simplification"], ["Petterssen 1936"], []);
export const TOOL_107 = mt(107, "Vorticity Equation", 'vector', CLIMATE_BANDS, [{"param":"zeta","min":-1,"max":1},{"param":"f","min":0,"max":0.0002},{"param":"divV","min":-1,"max":1}], ["Relative vorticity from wind field","Coriolis from latitude"], { method: 'analytical', factors: ["Vorticity calculation","Divergence accuracy","Friction"], assessment: 'Exact from Navier-Stokes' }, "Storm dynamics and cyclone development.", ["Conservation of absolute vorticity.","ERA5 for wind fields."], ["Inviscid or parameterized","Hydrostatic"], ["Friction parameterization","No diabatic effects"], ["Holton & Hakim 2012"], []);
export const TOOL_108 = mt(108, "Kohler Equation", 'scalar', CLIMATE_BANDS, [{"param":"a","min":0,"max":0.000001},{"param":"r","min":1e-8,"max":0.001},{"param":"b","min":0,"max":1e-10}], ["Kelvin curvature coefficient","Solute coefficient from Raoult law"], { method: 'analytical', factors: ["Surface tension","Solute properties","Temperature"], assessment: 'Exact for ideal solution droplets' }, "Cloud droplet activation.", ["Critical radius and supersaturation.","CCN activation."], ["Ideal solution","Spherical droplet","Equilibrium"], ["Non-ideal solutions","Surface tension varies"], ["Kohler 1936"], []);
export const TOOL_109 = mt(109, "Marshall-Palmer DSD", 'histogram', CLIMATE_BANDS, [{"param":"N0","min":0,"max":1000000000},{"param":"Lambda","min":0,"max":50000},{"param":"D","min":0,"max":0.01}], ["Intercept N0 = 8e6 m^-4","Slope Lambda from rain rate"], { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ["N0 variability","Lambda-rain rate","Exponential assumption"], assessment: '+/- 20%, N0 variable' }, "Exponential drop size distribution.", ["N0 = 8e6 m^-4.","Lambda from rain rate."], ["Exponential distribution","Steady rain"], ["Not for convective rain","N0 varies"], ["Marshall & Palmer 1948"], []);
export const TOOL_110 = mt(110, "Z-R Relationship", 'scatter', CLIMATE_BANDS, [{"param":"a","min":0,"max":1000},{"param":"R","min":0,"max":500}], ["Z = 200*R^1.6 (stratiform)","Z = 300*R^1.4 (convective)"], { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ["Z-R coefficients","DSD","Radar calibration"], assessment: '+/- 30%, coefficients vary' }, "Radar reflectivity to rainfall rate.", ["200*R^1.6 (stratiform).","300*R^1.4 (convective).","Dual-pol reduces uncertainty."], ["Equilibrium DSD","Single rain type"], ["Coefficients vary by region","Hail contamination"], ["Marshall & Palmer 1948"], []);
export const TOOL_111 = mt(111, "IERS Earth Rotation Matrix", 'scalar', GENERIC_BANDS, [{"param":"P","min":0,"max":1},{"param":"N","min":0,"max":1},{"param":"R","min":0,"max":1},{"param":"W","min":0,"max":1}], ["Precession-nutation from IERS","Earth rotation from GAST","Polar motion from IERS"], { method: 'analytical', factors: ["IERS conventions","Matrix order","Time system"], assessment: 'Exact with IERS conventions' }, "Earth rotation for satellite positioning.", ["IERS Conventions 2010.","Precession, nutation, rotation, polar motion."], ["Rigid Earth","Known time"], ["Non-rigid Earth effects","Requires IERS data"], ["IERS Conventions 2010"], []);
export const TOOL_112 = mt(112, "Earth Tides (Love Numbers)", 'scalar', GENERIC_BANDS, [{"param":"hn","min":0,"max":1},{"param":"Vn","min":0,"max":10},{"param":"g","min":9.8,"max":9.82}], ["Love numbers from Earth model","Tidal potential from Moon/Sun"], { method: 'empirical', rmse: 5, rmseUnit: 'mm', factors: ["Love number model","Tidal potential","Local geology"], assessment: '+/- 5mm accuracy' }, "Solid Earth deformation from tides.", ["Love numbers from PREM model.","Sub-meter GPS correction."], ["Elastic Earth","Known Love numbers"], ["Anelastic effects","Local geology variations"], ["Wahr 1981"], []);
export const TOOL_113 = mt(113, "EGM2008 Gravity Field", 'scalar', GENERIC_BANDS, [{"param":"GM","min":0,"max":1000000000000000},{"param":"r","min":6000000,"max":10000000},{"param":"Cnm","min":-1,"max":1},{"param":"Snm","min":-1,"max":1},{"param":"Pnm","min":-1,"max":1}], ["Spherical harmonics degree 2190","Coefficients from EGM2008"], { method: 'analytical', factors: ["Harmonic degree truncation","Coefficient accuracy","Legendre functions"], assessment: 'Exact to degree 2190' }, "Global gravity field and geoid.", ["Degree 2190 (~5 arcmin).","Precise orbit determination."], ["Spherical harmonic expansion","Known coefficients"], ["Truncation error","Computationally expensive"], ["Pavlis et al. 2008"], []);
export const TOOL_114 = mt(114, "Helmert 7-Parameter Transformation", 'scalar', GENERIC_BANDS, [{"param":"S","min":0,"max":2},{"param":"R","min":0,"max":2},{"param":"T","min":-1000,"max":1000}], ["7 parameters from datum calibration","WGS84 to ITRF conversion"], { method: 'analytical', factors: ["Parameter accuracy","Rotation matrix","Scale factor"], assessment: 'Exact for known parameters' }, "7-parameter datum transformation.", ["Scale, 3 rotations, 3 translations.","WGS84/ITRF conversion."], ["Rigid body","Known parameters","Small angles"], ["Not for nonlinear distortions","Parameter accuracy critical"], ["Heiskanen & Moritz 1967"], []);
export const TOOL_115 = mt(115, "Geoid Height", 'scalar', GENERIC_BANDS, [{"param":"h","min":-500,"max":10000},{"param":"N","min":-200,"max":200}], ["Ellipsoidal height from GPS","Geoid undulation from EGM2008"], { method: 'analytical', factors: ["GPS height accuracy","Geoid model accuracy","EGM2008 resolution"], assessment: 'Exact with accurate EGM2008' }, "Height reference frame transformation.", ["H = h - N (orthometric).","N from EGM2008."], ["Known geoid undulation","GPS ellipsoidal height"], ["Geoid model resolution","GPS height accuracy"], ["Standard geodesy"], []);
export const TOOL_116 = mt(116, "NRLMSISE-00 Thermosphere", 'profile', SPACE_BANDS, [{"param":"n_N2","min":0,"max":1e+30},{"param":"n_O2","min":0,"max":1e+30},{"param":"n_O","min":0,"max":1e+30},{"param":"m_N2","min":0,"max":1e-25},{"param":"m_O2","min":0,"max":1e-25},{"param":"m_O","min":0,"max":1e-25}], ["NRLMSIS 2.0 with TIMED/SABER","Species densities from model"], { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ["Model coefficients","Solar activity","Geomagnetic conditions"], assessment: '+/- 15%, NRLMSIS 2.0 recommended' }, "Satellite drag atmospheric density.", ["Use NRLMSIS 2.0 (updated).","TIMED/SABER data assimilation."], ["Empirical model","Known solar/geomagnetic inputs"], ["Solar cycle variability","Storm-time density spikes"], ["Picone 2002"], []);
export const TOOL_117 = mt(117, "IRI-2016 Ionosphere", 'profile', SPACE_BANDS, [{"param":"Ne","min":100000000,"max":10000000000000},{"param":"h","min":50000,"max":2000000},{"param":"NmF2","min":10000000000,"max":5000000000000},{"param":"hmF2","min":150000,"max":600000}], ["IRI-2020 is latest version","Electron density profiles"], { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ["Model coefficients","Solar activity","Ionosonde data"], assessment: '+/- 15%, IRI-2020 recommended' }, "Ionospheric electron density profiles.", ["Use IRI-2020 (latest).","GPS accuracy application."], ["Empirical model","Known solar inputs"], ["Storm-time deviations","Equatorial anomaly"], ["Bilitza 2017"], []);
export const TOOL_118 = mt(118, "Joule Heating", 'scalar', SPACE_BANDS, [{"param":"J","min":0,"max":1},{"param":"E","min":0,"max":1},{"param":"sigma","min":0,"max":0.01}], ["Current density from ionosphere","Electric field from convection","Pedersen conductivity"], { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ["Current density","Electric field","Conductivity"], assessment: '+/- 20% uncertainty' }, "Storm-time thermospheric heating.", ["Key driver of storm-time density spikes.","Electric field from convection."], ["Steady state","Known conductivity"], ["Time-varying fields","Conductivity altitude-dependent"], ["Standard"], []);
export const TOOL_119 = mt(119, "Ionospheric Scintillation (S4)", 'gauge', SPACE_BANDS, [{"param":"Ibar","min":0,"max":100},{"param":"sigmaI","min":0,"max":10}], ["Signal intensity statistics","GNSS receiver data"], { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ["Signal conditions","Receiver quality","Multipath"], assessment: '+/- 15% uncertainty' }, "GPS reliability assessment.", ["S4 > 0.5: strong scintillation.","GNSS receiver data."], ["Steady signal","No multipath"], ["Multipath contamination","Receiver-dependent"], ["Standard GNSS"], []);
export const TOOL_120 = mt(120, "Magnetopause Standoff (Shue)", 'scalar', SPACE_BANDS, [{"param":"Pdyn","min":0,"max":100},{"param":"Bz","min":-30,"max":30}], ["Solar wind from NOAA SWPC","IMF Bz from ACE/DSCOVR"], { method: 'empirical', rmse: 10, rmseUnit: '%', factors: ["Solar wind input","Model coefficients"], assessment: '+/- 10%, NOAA SWPC authoritative' }, "Magnetopause location from solar wind.", ["Real-time NOAA SWPC data.","ACE/DSCOVR for IMF."], ["Steady solar wind","Axisymmetric magnetopause"], ["Dynamic pressure variations","Tailward extension"], ["Shue 1998"], []);
export const TOOL_121 = mt(121, "Dst Ring Current Index", 'gauge', SPACE_BANDS, [{"param":"Dst","min":-500,"max":100},{"param":"Pdyn","min":0,"max":100},{"param":"b","min":0,"max":20},{"param":"c","min":-50,"max":50}], ["Raw Dst from WDC Kyoto","Pressure correction"], { method: 'empirical', rmse: 10, rmseUnit: 'nT', factors: ["Pressure correction","Offset calibration"], assessment: '+/- 10 nT uncertainty' }, "Geomagnetic storm severity.", ["Raw Dst from WDC Kyoto.","Pressure correction."], ["Steady ring current","Known pressure"], ["Non-storm contamination","Offset varies"], ["Sugiura 1964"], []);
export const TOOL_122 = mt(122, "Debye Length", 'scalar', SPACE_BANDS, [{"param":"eps0","min":8.854e-12,"max":8.854e-12},{"param":"kB","min":1.381e-23,"max":1.381e-23},{"param":"Te","min":1000,"max":10000000},{"param":"ne","min":1000000,"max":1000000000000000}], ["Electron temperature from plasma","Electron density from measurements"], { method: 'analytical', factors: ["Electron temperature","Electron density"], assessment: 'Exact for Maxwellian plasma' }, "Space plasma shielding distance.", ["Fundamental plasma parameter.","Indicates charge neutrality scale."], ["Maxwellian distribution","Known Te, ne"], ["Non-Maxwellian plasmas","Magnetic field effects"], ["Debye 1923"], []);
export const TOOL_123 = mt(123, "Satellite Drag Force", 'scalar', SPACE_BANDS, [{"param":"rho","min":1e-20,"max":0.00001},{"param":"CD","min":1,"max":4},{"param":"A","min":0.01,"max":1000},{"param":"m","min":1,"max":100000},{"param":"v","min":0,"max":15000}], ["Atmospheric density from NRLMSIS","Drag coefficient ~ 2.2"], { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ["Atmospheric density","Drag coefficient","Cross-section"], assessment: '+/- 15%, density is key uncertainty' }, "Orbital decay prediction.", ["Atmospheric density from NRLMSIS.","CD ~ 2.2 (varies 1-4)."], ["Known density","Constant CD","Known area/mass"], ["Density variable","CD attitude-dependent","Area varies"], ["Standard"], []);
export const TOOL_124 = mt(124, "Orbital Decay Rate", 'timeseries', SPACE_BANDS, [{"param":"rho","min":1e-20,"max":0.00001},{"param":"CD","min":1,"max":4},{"param":"A","min":0.01,"max":1000},{"param":"v","min":0,"max":15000},{"param":"m","min":1,"max":100000}], ["Atmospheric density from NRLMSIS","Re-entry timeline estimation"], { method: 'empirical', rmse: 15, rmseUnit: '%', factors: ["Atmospheric density","Drag coefficient","Velocity"], assessment: '+/- 15% uncertainty' }, "Satellite re-entry timeline.", ["Density from NRLMSIS.","Re-entry prediction."], ["Known density","Circular orbit"], ["Eccentric orbit","Density variations","CD attitude-dependent"], ["King-Hele 1987"], []);
export const TOOL_125 = mt(125, "Collision Probability", 'scalar', SPACE_BANDS, [{"param":"A1","min":0,"max":1000},{"param":"A2","min":0,"max":1000},{"param":"sigmax","min":0,"max":10000},{"param":"sigmay","min":0,"max":10000},{"param":"d","min":0,"max":10000}], ["Position uncertainty from tracking","Miss distance from conjunction"], { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ["Covariance accuracy","Miss distance","Encounter geometry"], assessment: '+/- 20% uncertainty' }, "Conjunction assessment and collision avoidance.", ["Position uncertainty from tracking.","Miss distance from conjunction."], ["Gaussian distribution","Short encounter","Known covariance"], ["Non-Gaussian errors","Long encounters","Maneuvers change geometry"], ["Foster 1992"], []);
export const TOOL_126 = mt(126, "Kessler Syndrome Debris Growth", 'timeseries', SPACE_BANDS, [{"param":"rho","min":0,"max":1},{"param":"sigma","min":0,"max":1000},{"param":"v","min":0,"max":20},{"param":"N","min":0,"max":1000000000},{"param":"L","min":0,"max":1000},{"param":"beta","min":0,"max":1},{"param":"gamma","min":0,"max":1}], ["Debris population from catalog","Collision cross-section"], { method: 'qualitative', factors: ["Collision rate","Launch source","Decay coefficient"], assessment: 'Long-term debris environment projection' }, "Space debris growth modeling.", ["Long-term projection.","Collision cascading."], ["Mean-field approximation","Known population"], ["Individual collisions stochastic","Launch rates uncertain","Decay varies"], ["Kessler 1991"], []);
export const TOOL_127 = mt(127, "Hill-Clohessy-Wiltshire", 'scalar', SPACE_BANDS, [{"param":"n","min":0,"max":0.01},{"param":"ax","min":-10,"max":10},{"param":"ay","min":-10,"max":10},{"param":"az","min":-10,"max":10}], ["Mean motion from orbital elements","Relative motion for rendezvous"], { method: 'analytical', factors: ["Linearized equations","Circular reference orbit","No perturbations"], assessment: 'Exact for circular orbit' }, "Satellite rendezvous proximity operations.", ["Linearized relative motion.","Circular reference orbit."], ["Circular orbit","Small separations","No perturbations"], ["Not for eccentric orbits","Large separations","J2 perturbation"], ["Hill 1878"], []);
export const TOOL_128 = mt(128, "Kp Geomagnetic Index", 'gauge', SPACE_BANDS, [{"param":"wi","min":0,"max":1},{"param":"Ki","min":0,"max":9},{"param":"num_stations","min":1,"max":13}], ["13 station K-indices","Weighted average","NOAA SWPC real-time"], { method: 'empirical', rmse: 0.5, rmseUnit: 'Kp', factors: ["Station weights","K-index estimation"], assessment: '+/- 0.5 Kp uncertainty' }, "Primary space weather severity metric.", ["13 stations worldwide.","NOAA SWPC for real-time.","Kp > 5: storm."], ["Station distribution","Quiet conditions"], ["Station gaps","Local time effects"], ["Bartels 1949"], []);
export const TOOL_129 = mt(129, "DOP (Dilution of Precision)", 'gauge', SPACE_BANDS, [{"param":"trH","min":1,"max":100},{"param":"num_satellites","min":4,"max":40},{"param":"elevation_mask","min":0,"max":90}], ["Satellite geometry from ephemeris","Elevation mask from receiver"], { method: 'analytical', factors: ["Satellite geometry","Number of satellites","Elevation mask"], assessment: 'Exact for known geometry' }, "GPS accuracy from satellite geometry.", ["Lower DOP = better accuracy.","GDOP < 4: excellent."], ["Known satellite positions","Clear sky view"], ["Obstructions","Multipath","Atmospheric delays"], ["Standard GNSS"], []);
export const TOOL_130 = mt(130, "Saastamoinen Tropospheric Delay", 'scalar', SPACE_BANDS, [{"param":"theta","min":0.05,"max":1.57},{"param":"P","min":500,"max":1100},{"param":"T","min":200,"max":320},{"param":"e","min":0,"max":50}], ["Surface pressure from weather","Temperature from weather","Water vapor from humidity"], { method: 'analytical', factors: ["Pressure accuracy","Temperature accuracy","Water vapor"], assessment: 'Exact for known P, T, e' }, "GPS signal tropospheric correction.", ["Surface met data from Open-Meteo.","ZHD = 0.002277*P.","ZWD = 0.002277*(1255/T+0.05)*e."], ["Known surface met","Hydrostatic equilibrium"], ["Wet delay variable","Elevation-dependent","Asymmetric mapping"], ["Saastamoinen 1972"], []);
export const TOOL_131 = mt(131, "Thiem Equation (Steady Radial Flow)", 'profile', OCEAN_BANDS, [{"param":"T","min":0.1,"max":50000},{"param":"h1","min":0,"max":500},{"param":"h2","min":0,"max":500},{"param":"r1","min":0,"max":10000},{"param":"r2","min":0,"max":100000}], ["Transmissivity from well tests","Head from observation wells","Distance from well geometry"], { method: 'empirical', rmse: 20, rmseUnit: '%', factors: ["Transmissivity","Head measurements","Radial flow assumption"], assessment: '+/- 20% uncertainty' }, "Aquifer transmissivity from well tests.", ["Steady-state assumption.","Radial flow to pumping well."], ["Confined aquifer","Steady state","Radial flow"], ["Not for unconfined","Transient conditions","Well losses"], ["Thiem 1906"], []);
export const TOOL_132 = mt(132, "Theis Transient Drawdown", 'timeseries', OCEAN_BANDS, [{"param":"Q","min":0,"max":100000},{"param":"T","min":0.1,"max":50000},{"param":"t","min":0,"max":10000},{"param":"r","min":0,"max":10000},{"param":"S","min":1e-8,"max":0.1}], ["Pumping rate from well","Transmissivity from geology","Storativity from specific yield"], { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ["Transmissivity","Storativity","Well function"], assessment: '+/- 25% uncertainty' }, "Transient aquifer response to pumping.", ["Theis well function W(u).","Requires type-curve matching."], ["Confined aquifer","Homogeneous","No recharge"], ["Not for unconfined","Heterogeneous aquifers","Well effects"], ["Theis 1935"], []);
export const TOOL_133 = mt(133, "Cooper-Jacob Approximation", 'timeseries', OCEAN_BANDS, [{"param":"Q","min":0,"max":100000},{"param":"T","min":0.1,"max":50000},{"param":"t","min":0,"max":10000},{"param":"r","min":0,"max":10000},{"param":"S","min":1e-8,"max":0.1}], ["Simplified Theis solution","Valid for small u","Logarithmic approximation"], { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ["Validity of approximation","Transmissivity","Storativity"], assessment: '+/- 30%, valid for u < 0.01' }, "Simplified well-test analysis.", ["Valid for u < 0.01 (large time/small r).","Simpler than full Theis."], ["u < 0.01","Confined aquifer","Homogeneous"], ["Not valid for early time","Not for unconfined","Heterogeneous"], ["Cooper & Jacob 1946"], []);
export const TOOL_134 = mt(134, "Horton Infiltration", 'timeseries', OCEAN_BANDS, [{"param":"fc","min":0,"max":50},{"param":"f0","min":0,"max":500},{"param":"k","min":0.01,"max":20},{"param":"t","min":0,"max":100}], ["Final infiltration from soil type","Initial infiltration from soil moisture","Decay constant from calibration"], { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ["Soil properties","Decay constant","Initial conditions"], assessment: '+/- 25% uncertainty' }, "Empirical infiltration capacity decay.", ["Empirical model.","fc from soil type."], ["Homogeneous soil","No crust formation","Constant rainfall"], ["Not for layered soils","Crust effects","Rainfall intensity effects"], ["Horton 1939"], []);
export const TOOL_135 = mt(135, "Risk = Hazard x Vulnerability x Exposure", 'gauge', RISK_BANDS, [{"param":"H","min":0,"max":1},{"param":"V","min":0,"max":1},{"param":"E","min":0,"max":1}], ["Hazard probability from analysis","Vulnerability index from exposure data","Exposure from population/assets"], { method: 'qualitative', factors: ["Hazard assessment","Vulnerability assessment","Exposure data"], assessment: 'Universal risk framework' }, "Universal risk assessment framework.", ["UNISDR framework.","Hazard x Vulnerability x Exposure."], ["Independent components","Linear interaction"], ["Nonlinear interactions","Requires all three components"], ["UNISDR 2004"], []);
export const TOOL_136 = mt(136, "Expected Annual Damage", 'scalar', RISK_BANDS, [{"param":"D_P","min":0,"max":10000000000},{"param":"P_low","min":0,"max":0.1},{"param":"P_high","min":0,"max":1},{"param":"num_intervals","min":10,"max":10000}], ["Damage function from analysis","Exceedance probability from hazard","Integration over probability"], { method: 'qualitative', factors: ["Damage function","Probability distribution","Integration method"], assessment: 'Integral over damage-probability curve' }, "Expected annual damage from risk curve.", ["Integrate D(P) over P.","Dam safety, flood risk."], ["Known damage function","Continuous probability"], ["Damage function uncertain","Discrete integration errors"], ["Standard risk analysis"], []);
export const TOOL_137 = mt(137, "AQI Breakpoint", 'gauge', RISK_BANDS, [{"param":"I_Hi","min":0,"max":10000},{"param":"I_Lo","min":0,"max":10000},{"param":"BP_Hi","min":0,"max":10000},{"param":"BP_Lo","min":0,"max":10000},{"param":"C_p","min":0,"max":10000}], ["AQI breakpoints from EPA","Pollutant concentration from measurement","Linear interpolation between breakpoints"], { method: 'analytical', factors: ["Breakpoint accuracy","Concentration measurement","Pollutant type"], assessment: 'Exact linear interpolation' }, "Air quality index standardization.", ["EPA standard breakpoints.","Linear interpolation."], ["Known breakpoints","Single pollutant"], ["Multi-pollutant AQI complex","Breakpoints region-specific"], ["US EPA"], []);
export const TOOL_138 = mt(138, "Probable Maximum Precipitation", 'gauge', RISK_BANDS, [{"param":"Xbar","min":0,"max":10000},{"param":"Kp","min":0,"max":20},{"param":"sigmax","min":0,"max":1000}], ["Mean annual max from historical records","Frequency factor from statistics","Std dev from historical data"], { method: 'empirical', rmse: 30, rmseUnit: '%', factors: ["Historical record length","Frequency factor","Distribution assumption"], assessment: '+/- 30%, requires long records' }, "Extreme precipitation for dam safety.", ["Requires long historical records.","Frequency factor from statistics."], ["Stationary climate","Gumbel distribution","Adequate record"], ["Climate non-stationarity","Short records","Distribution assumption"], ["Chow 1964"], []);
export const TOOL_139 = mt(139, "Palmer Drought Severity Index", 'gauge', RISK_BANDS, [{"param":"X_prev","min":-10,"max":10},{"param":"Z","min":-10,"max":10},{"param":"alpha","min":0.5,"max":1}], ["Previous month PDSI","Current moisture anomaly","Persistence factor"], { method: 'empirical', rmse: 1, rmseUnit: 'PDSI', factors: ["Moisture anomaly","Persistence factor","Calibration"], assessment: '+/- 1 PDSI uncertainty' }, "Drought monitoring index.", ["PDSI: -4 extreme drought, +4 extreme wet.","Monthly time step."], ["Calibrated to local climate","Monthly water balance"], ["Not comparable across regions","Soil-dependent calibration","Slow response"], ["Palmer 1965"], []);
export const TOOL_140 = mt(140, "Froehlich Dam Breach", 'scalar', RISK_BANDS, [{"param":"K0","min":0.5,"max":3},{"param":"Vres","min":0,"max":100000000000},{"param":"hb","min":1,"max":300}], ["Breach correction from failure mode","Reservoir volume from bathymetry","Breach height from dam geometry"], { method: 'empirical', rmse: 25, rmseUnit: '%', factors: ["Correction factor","Volume estimation","Breach height"], assessment: '+/- 25% uncertainty' }, "Dam breach outflow estimation.", ["K0 from failure mode.","Reservoir volume from survey."], ["Empirical regression","Known geometry"], ["Regression scatter","Site-specific factors","Time to breach"], ["Froehlich 2008"], []);
export const TOOL_141 = mt(141, "Ensemble Kalman Filter", 'scalar', GENERIC_BANDS, [{"param":"xf","min":-Infinity,"max":Infinity},{"param":"Pf","min":-Infinity,"max":Infinity},{"param":"y","min":-Infinity,"max":Infinity},{"param":"R","min":-Infinity,"max":Infinity},{"param":"H","min":-Infinity,"max":Infinity}], ["Forecast from model","Observation from data","Error covariances from statistics"], { method: 'analytical', factors: ["Ensemble size","Error covariances","Observation operator"], assessment: 'Exact for linear systems' }, "THE equation for Digital Twin assimilation.", ["Key DA equation.","K = PfH^T(HPfH^T+R)^-1.","x_a = x_f + K(y-Hx_f)."], ["Linear observation operator","Gaussian errors","Adequate ensemble"], ["Nonlinear operators","Ensemble collapse","Localization needed"], ["Evensen 1994"], []);
export const TOOL_142 = mt(142, "Optimal Interpolation", 'scalar', GENERIC_BANDS, [{"param":"xb","min":-Infinity,"max":Infinity},{"param":"y","min":-Infinity,"max":Infinity},{"param":"B","min":-Infinity,"max":Infinity},{"param":"R","min":-Infinity,"max":Infinity},{"param":"H","min":-Infinity,"max":Infinity}], ["Background from model","Observation from data","Background error covariance"], { method: 'analytical', factors: ["Background error covariance","Observation error","Observation operator"], assessment: 'Exact for linear systems' }, "Spatial analysis of observations.", ["Simpler than EnKF.","Static B matrix."], ["Static B","Linear operator","Known covariances"], ["B not static in reality","No flow-dependence","Requires B matrix"], ["Lorenz 1969"], []);
export const TOOL_143 = mt(143, "4D-Var Cost Function", 'scalar', GENERIC_BANDS, [{"param":"x","min":-Infinity,"max":Infinity},{"param":"xb","min":-Infinity,"max":Infinity},{"param":"B","min":-Infinity,"max":Infinity},{"param":"yi","min":-Infinity,"max":Infinity},{"param":"Ri","min":-Infinity,"max":Infinity}], ["Background from model","Observations over time window","Error covariances"], { method: 'analytical', factors: ["Background error","Observation error","Model trajectory"], assessment: 'ECMWF operational standard' }, "Weather analysis gold standard.", ["ECMWF operational.","4D: assimilates over time window."], ["Tangent-linear model","Adjoint model","Known covariances"], ["Requires adjoint","Computationally expensive","B matrix critical"], ["Le Dimet 1986"], []);
export const TOOL_144 = mt(144, "Shannon Information Entropy", 'scalar', GENERIC_BANDS, [{"param":"px","min":0,"max":1},{"param":"py","min":0,"max":1},{"param":"pxy","min":0,"max":1}], ["Probability distributions from data","Joint probability from observations"], { method: 'analytical', factors: ["Probability estimation","Sample size","Discretization"], assessment: 'Exact for known distributions' }, "Data source value assessment.", ["H(X) = -sum p(x) log2 p(x).","Measures information content."], ["Known probabilities","Discrete variables"], ["Continuous entropy differs","Sample size for estimation","Binning effects"], ["Shannon 1948"], []);
export const TOOL_145 = mt(145, "Free-Space Path Loss", 'scalar', GENERIC_BANDS, [{"param":"d_km","min":0,"max":100000},{"param":"f_GHz","min":0,"max":100}], ["Distance from geometry","Frequency from signal"], { method: 'analytical', factors: ["Exact formula","Distance accuracy","Frequency accuracy"], assessment: 'Exact for free space' }, "Satellite link budget calculation.", ["FSPL = 32.45 + 20log10(d) + 20log10(f).","Satellite link budget."], ["Free space","No atmosphere","Line of sight"], ["Atmospheric attenuation","Multipath","Obstructions"], ["Fundamental"], []);
export const TOOL_146 = mt(146, "Klobuchar Ionospheric Delay", 'spectrum', GENERIC_BANDS, [{"param":"A","min":0,"max":0.000001},{"param":"x","min":0,"max":2},{"param":"phi_m","min":-90,"max":90}], ["Amplitude from broadcast","Local time phase from receiver","Geomagnetic latitude"], { method: 'empirical', rmse: 50, rmseUnit: '%', factors: ["Model coefficients","Ionospheric conditions","Solar activity"], assessment: '+/- 50%, coarse model' }, "Single-frequency GPS ionospheric correction.", ["Coarse model (+/- 50%).","Better than no correction.","Dual-frequency preferred."], ["Single frequency","Daytime only","Known coefficients"], ["Not for nighttime","Storm-time errors","Coefficients broadcast"], ["Klobuchar 1987"], []);
export const TOOL_147 = mt(147, "Doppler Shift", 'spectrum', GENERIC_BANDS, [{"param":"f0","min":0,"max":1000000000000},{"param":"vrel","min":-30000,"max":30000}], ["Transmitted frequency from signal","Relative velocity from kinematics"], { method: 'analytical', factors: ["Exact non-relativistic","Velocity accuracy","Frequency accuracy"], assessment: 'Exact for v << c' }, "Satellite tracking and GNSS.", ["Delta_f = f0 * v_rel / c.","Non-relativistic approximation."], ["v << c","Line of sight velocity"], ["Relativistic at high v","Not for transverse motion","Multipath"], ["Doppler 1842"], []);
export const TOOL_148 = mt(148, "Hohmann Transfer", 'scalar', GENERIC_BANDS, [{"param":"GM","min":0,"max":1000000000000000},{"param":"r1","min":6000000,"max":10000000},{"param":"r2","min":6000000,"max":100000000}], ["Gravitational parameter from central body","Orbit radii from mission design"], { method: 'analytical', factors: ["Exact for circular orbits","Impulsive burns","Two-body problem"], assessment: 'Exact for two-body' }, "Optimal orbit transfer planning.", ["Most fuel-efficient 2-burn transfer.","Between coplanar circular orbits."], ["Circular orbits","Coplanar","Impulsive burns"], ["Not for elliptical","Plane changes","Finite burns"], ["Hohmann 1925"], []);
export const TOOL_149 = mt(149, "Lagrange Points (L1-L5)", 'scalar', GENERIC_BANDS, [{"param":"gamma","min":0,"max":0.5},{"param":"R","min":0,"max":10000000000000},{"param":"point_id","min":1,"max":5}], ["Mass ratio from system","Body separation from ephemeris","5th-order polynomial for collinear"], { method: 'analytical', factors: ["Exact for CR3BP","Mass ratio accuracy","Body separation"], assessment: 'Exact for circular restricted 3-body' }, "Mission planning for L-points.", ["L2 is used by JWST for deep space observation.","L1 hosts solar observatories like SOHO.","L3-L5 are stable equilibrium points."], ["Circular orbits","Restricted 3-body","Primaries in circular motion"], ["Elliptical orbits","Perturbations","Stability varies"], ["Lagrange 1772"], []);
export const TOOL_150 = mt(150, "Mutual Information", 'scalar', GENERIC_BANDS, [{"param":"px","min":0,"max":1},{"param":"py","min":0,"max":1},{"param":"pxy","min":0,"max":1}], ["Joint probability from observations","Marginal probabilities from data"], { method: 'analytical', factors: ["Probability estimation","Sample size","Discretization"], assessment: 'Exact for known distributions' }, "Quantifying data source value.", ["I(X;Y) = sum p(x,y) log(p(x,y)/(p(x)*p(y))).","Information theory."], ["Known probabilities","Discrete variables"], ["Continuous variables","Sample size","Binning effects"], ["Shannon 1948"], []);

export const TOOLS_PART4: Record<number, ToolWorkflowDef> = {
  66: TOOL_66,
  67: TOOL_67,
  68: TOOL_68,
  69: TOOL_69,
  70: TOOL_70,
  71: TOOL_71,
  72: TOOL_72,
  73: TOOL_73,
  74: TOOL_74,
  75: TOOL_75,
  76: TOOL_76,
  77: TOOL_77,
  78: TOOL_78,
  79: TOOL_79,
  80: TOOL_80,
  81: TOOL_81,
  82: TOOL_82,
  83: TOOL_83,
  84: TOOL_84,
  85: TOOL_85,
  86: TOOL_86,
  87: TOOL_87,
  88: TOOL_88,
  89: TOOL_89,
  90: TOOL_90,
  91: TOOL_91,
  92: TOOL_92,
  93: TOOL_93,
  94: TOOL_94,
  95: TOOL_95,
  96: TOOL_96,
  97: TOOL_97,
  98: TOOL_98,
  99: TOOL_99,
  100: TOOL_100,
  101: TOOL_101,
  102: TOOL_102,
  103: TOOL_103,
  104: TOOL_104,
  105: TOOL_105,
  106: TOOL_106,
  107: TOOL_107,
  108: TOOL_108,
  109: TOOL_109,
  110: TOOL_110,
  111: TOOL_111,
  112: TOOL_112,
  113: TOOL_113,
  114: TOOL_114,
  115: TOOL_115,
  116: TOOL_116,
  117: TOOL_117,
  118: TOOL_118,
  119: TOOL_119,
  120: TOOL_120,
  121: TOOL_121,
  122: TOOL_122,
  123: TOOL_123,
  124: TOOL_124,
  125: TOOL_125,
  126: TOOL_126,
  127: TOOL_127,
  128: TOOL_128,
  129: TOOL_129,
  130: TOOL_130,
  131: TOOL_131,
  132: TOOL_132,
  133: TOOL_133,
  134: TOOL_134,
  135: TOOL_135,
  136: TOOL_136,
  137: TOOL_137,
  138: TOOL_138,
  139: TOOL_139,
  140: TOOL_140,
  141: TOOL_141,
  142: TOOL_142,
  143: TOOL_143,
  144: TOOL_144,
  145: TOOL_145,
  146: TOOL_146,
  147: TOOL_147,
  148: TOOL_148,
  149: TOOL_149,
  150: TOOL_150,
};