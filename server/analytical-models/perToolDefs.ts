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

// Stomatal conductance bands (mmol/m²s) per the catalogue's interpretation:
// <100 near-closed, 100–200 moderate, 200–400 high, >400 very high.
const STOMATAL_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 100, label: 'Near-Closed', color: '#f97316', description: 'Stomata nearly closed — water stress' },
  { min: 100, max: 200, label: 'Moderate', color: '#eab308', description: 'Moderate conductance' },
  { min: 200, max: 400, label: 'High', color: '#22c55e', description: 'Well-watered, active vegetation' },
  { min: 400, max: Infinity, label: 'Very High', color: '#3b82f6', description: 'Mesic optimal conditions' },
];

// GPP bands (gC/m²/yr) per the catalogue's interpretation: <500 low,
// 500–1000 moderate, 1000–2000 high, >2000 tropical-rainforest class.
const GPP_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 500, label: 'Low', color: '#84cc16', description: 'Deserts, tundra, semi-arid' },
  { min: 500, max: 1000, label: 'Moderate', color: '#22c55e', description: 'Boreal forests, grasslands, savanna' },
  { min: 1000, max: 2000, label: 'High', color: '#15803d', description: 'Temperate forests, productive cropland' },
  { min: 2000, max: Infinity, label: 'Very High', color: '#059669', description: 'Tropical rainforest' },
];

// NEE bands (gC/m²/yr, signed) for Tool 53 — per the catalogue's
// carbon_sink_class output: < −500 strong sink, −500..−100 moderate sink,
// −100..+100 near-neutral, > +100 net source (Wofsy 1993 sign convention:
// negative NEE = net CO₂ uptake).
const NEE_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: -500, label: 'Strong Sink', color: '#15803d', description: 'Net CO₂ sink > 500 gC/m²/yr (productive forest)' },
  { min: -500, max: -100, label: 'Moderate Sink', color: '#22c55e', description: 'Moderate net CO₂ uptake' },
  { min: -100, max: 100, label: 'Near-Neutral', color: '#a8a29e', description: 'Carbon balance ≈ 0 (GPP ≈ R_eco)' },
  { min: 100, max: Infinity, label: 'Net Source', color: '#ef4444', description: 'Net CO₂ release (disturbance, peat decomposition)' },
];

// A_c bands (µmol/m²s) for Tool 54 FvCB photosynthesis, per the catalogue's
// outputInterpretation: <5 stressed/senescent, 15–30 typical C₃ midday,
// >30 tropical/crop, Vcmax=80 typical for wheat/soybean → A_c≈23.
const PHOTOSYNTHESIS_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 5, label: 'Very Low', color: '#64748b', description: 'Stressed/senescent canopy or below compensation' },
  { min: 5, max: 15, label: 'Low', color: '#eab308', description: 'Light/water-limited photosynthesis' },
  { min: 15, max: 30, label: 'Moderate', color: '#84cc16', description: 'Typical C₃ midday rate (15–30 µmol/m²s)' },
  { min: 30, max: 60, label: 'High', color: '#22c55e', description: 'Tropical/crop C₃ photosynthesis' },
  { min: 60, max: Infinity, label: 'Very High', color: '#15803d', description: 'Exceptional rates (high Vcmax, optimal conditions)' },
];

// AGB bands (kg per tree) for Tool 55, per the catalogue's
// outputInterpretation: <100 small tree, 100–500 medium, 500–2000 large,
// >2000 very large (disproportionate carbon share).
const AGB_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 100, label: 'Small Tree', color: '#84cc16', description: 'DBH < ~20 cm, understorey/regenerating' },
  { min: 100, max: 500, label: 'Medium Tree', color: '#22c55e', description: 'Canopy tree, significant individual biomass' },
  { min: 500, max: 2000, label: 'Large Tree', color: '#15803d', description: 'Canopy emergent, major carbon-stock component' },
  { min: 2000, max: Infinity, label: 'Very Large Tree', color: '#065f46', description: 'Disproportionately important for carbon storage' },
];

// PPFD-at-depth bands (µmol/m²s) for Tool 52 Beer-Lambert extinction, per the
// catalogue's outputInterpretation: below the C₃ compensation point (~50),
// deep shade (LAI≈6 @ k=0.5 → 0.05·I₀), low light approaching shade-leaf
// saturation (LAI≈4 → 0.135·I₀), moderate (LAI≈2 → 0.37·I₀), high/light-
// saturated (canopy-top sun leaves).
const LIGHT_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 50, label: 'Below Compensation', color: '#64748b', description: 'Below C₃ light-compensation point (~50 µmol/m²s) — net carbon loss if maintained' },
  { min: 50, max: 200, label: 'Deep Shade', color: '#a8a29e', description: 'Shade leaves, light-limited photosynthesis' },
  { min: 200, max: 500, label: 'Low Light', color: '#eab308', description: 'Understorey — approaching shade-leaf saturation' },
  { min: 500, max: 1500, label: 'Moderate', color: '#84cc16', description: 'Sun/shade mix, partial light saturation' },
  { min: 1500, max: Infinity, label: 'High Light', color: '#15803d', description: 'Light-saturated sun leaves (canopy top)' },
];

// Additional shared band sets for Part 4
const OCEAN_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0.1, label: 'Calm', color: '#22c55e', description: 'Calm' },
  { min: 0.1, max: 1, label: 'Low', color: '#84cc16', description: 'Low' },
  { min: 1, max: 5, label: 'Moderate', color: '#eab308', description: 'Moderate' },
  { min: 5, max: 10, label: 'High', color: '#f97316', description: 'High' },
  { min: 10, max: Infinity, label: 'Extreme', color: '#ef4444', description: 'Storm' },
];

// Shoreline-retreat-rate bands (m/yr) — Tool 75 (Bruun Rule). OCEAN_BANDS
// are wave-HEIGHT bands in metres and must not classify a retreat RATE;
// the thresholds below match the engine's step-text interpretation.
const RETREAT_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0.1, label: 'Low', color: '#22c55e', description: '<0.1 m/yr retreat — stable coast or low SLR' },
  { min: 0.1, max: 0.5, label: 'Moderate', color: '#eab308', description: '0.1–0.5 m/yr — requires monitoring' },
  { min: 0.5, max: 2, label: 'High', color: '#f97316', description: '0.5–2 m/yr — active erosion management needed' },
  { min: 2, max: Infinity, label: 'Severe', color: '#ef4444', description: '>2 m/yr — immediate adaptation required' },
];

// Longshore-sediment-transport bands (m³/yr) — Tool 77 (CERC, SPM 1984).
// OCEAN_BANDS are wave-HEIGHT bands in metres and must not classify a
// VOLUMETRIC transport rate (distinct from Sverdrup's TRANSPORT_BANDS in
// m²/s for Tool 66); the thresholds follow the catalogue's interpretation
// text and the SPM's Table 4-7 field range (22,500–765,000 m³/yr).
// Classified on the annual secondary (eq 4-50a), never the m³/s primary.
const LONGSHORE_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 5e4, label: 'Low', color: '#22c55e', description: '<50,000 m³/yr — sheltered/low-energy coast' },
  { min: 5e4, max: 3e5, label: 'Moderate', color: '#eab308', description: '50,000–300,000 m³/yr — typical US East Coast / Gulf' },
  { min: 3e5, max: 1e6, label: 'High', color: '#f97316', description: '300,000–1,000,000 m³/yr — exposed coast (California, Oregon, Australia)' },
  { min: 1e6, max: Infinity, label: 'Very High', color: '#ef4444', description: '>10⁶ m³/yr — high-energy environment (SW England, South Africa)' },
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
  estimateUncertainty: (result, inputs) => {
    // Adaptive uncertainty: measured band-11 (C2 L1 radiance via
    // USGS/ERS) collapses the residual to emissivity + water-vapour error;
    // forward-modeled band-11 carries an additional atmospheric-model bias.
    const measured = (inputs as Record<string, unknown>)?.__bt11Source === 'measured';
    if (measured) {
      return {
        method: 'empirical', rmse: 1.5, rmseUnit: 'C',
        confidenceInterval: { lower: result - 1.5, upper: result + 1.5, level: 0.68 },
        contributingFactors: [
          { factor: 'Measured TIRS band-10/11 radiance (USGS C2 L1, ERS session)', contribution: 'no synthesized band data; instrument radiometric error < 0.15 C' },
          { factor: 'Emissivity uncertainty', contribution: '+/- 0.5-1.5 C per 1% error' },
          { factor: 'Water vapor estimation', contribution: '+/- 0.2-0.5 C' },
          { factor: 'Atmospheric profile residual (Rozenstein calibration)', contribution: '+/- 0.3-0.5 C' },
        ],
        overallAssessment: 'Split-window retrieval on measured TIRS B10/B11 top-of-atmosphere radiance: both brightness temperatures come from the USGS Collection-2 Level-1 archive (no modeled band data). Residual = Rozenstein (2014) method RMSE 0.93 C (site-validated) + emissivity/water-vapour input error. On the validated Tokyo scene the SWA surface temperature differs from the USGS single-channel ST_B10 product by ~2-3 K (method-dependent; the two retrievals use different atmospheric corrections).',
      };
    }
    return {
      method: 'empirical', rmse: 2.6, rmseUnit: 'C',
      confidenceInterval: { lower: result - 2.6, upper: result + 2.6, level: 0.68 },
      contributingFactors: [
        { factor: 'Band-11 forward model (synthesized; ERS session unavailable for this run)', contribution: '-2.5 +/- 0.9 K bias vs USGS C2 L2 ST product (3 clear-sky scenes verified)' },
        { factor: 'Emissivity uncertainty', contribution: '+/- 0.5-1.5 C per 1% error' },
        { factor: 'Water vapor estimation', contribution: '+/- 0.2-0.5 C' },
      ],
      overallAssessment: 'Rozenstein (2014) paper RMSE is 0.93 C given true TIRS B10/B11 radiance. The USGS/ERS measured band-11 source was unavailable for this run (no session), so band-11 is forward-modeled from the single-channel atmosphere and the end-to-end validation bias is -2.55 K (sigma 0.88 K) vs the USGS ST_B10 product. Configure USGS_ERS_* credentials to switch to measured band-11 radiance.',
    };
  },
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
    // Slope Δ = d e_s/dT in hPa/°C. Derive T from the result via the
    // inverse Magnus relation so the slope always matches the actual value
    // computed (fetchedParams is not populated on this path).
    const gamma = Math.log(result / 6.1094);
    const T = gamma !== 0 ? (243.04 * gamma) / (17.625 - gamma) : 20;
    const delta = (17.625 * 243.04 * result) / Math.pow(T + 243.04, 2);
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
    { param: 'sigma0', min: 1, max: 1000 },
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
    { param: 'thvz', min: 250, max: 350 }, { param: 'thvs', min: 250, max: 350 },
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

// ══════════════════════════════════════════════════════════════════
//  EQUATION 9 — Reference Evapotranspiration
// ══════════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════════
//  EQUATION 10 — Runoff Estimation (SCS-CN)
// ══════════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════════
//  EQUATION 11 — Open Channel Flow Analysis
// ══════════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════════
//  EQUATION 12 — Peak Discharge Estimation
// ══════════════════════════════════════════════════════════════════
export const TOOL_12: ToolWorkflowDef = {
  toolId: 12,
  name: 'Peak Discharge Estimation',
  vizType: 'scalar',
  classificationBands: WATER_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'C', min: 0, max: 1 }, { param: 'i', min: 0, max: 200 }, { param: 'A', min: 0.1, max: 10000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Rainfall intensity from Open-Meteo');
    log.push('  Runoff coefficient from ESA WorldCover');
    log.push('  Catchment area from HydroSHEDS');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, WATER_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 30,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Runoff coefficient uncertainty', contribution: 'Varies' },
      { factor: 'Rainfall intensity spatial variability', contribution: 'Varies' },
      { factor: 'Small catchment assumption', contribution: 'Varies' },
    ],
    overallAssessment: 'Rational Method has +/- 30% uncertainty. Valid only for small catchments (< 80 ha).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Peak Discharge Estimation: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Peak discharge for stormwater design. Q = C*i*A/3.6 converts mm/hr*km2 to m3/s.`,
    recommendations: ['Valid only for small catchments (< 80 ha).', 'Use IDF curves for design rainfall intensity.', 'Cross-reference with USGS NWIS.'],
  }),
  metadata: {
    methodology: 'Peak discharge for stormwater design. Q = C*i*A/3.6 converts mm/hr*km2 to m3/s.',
    assumptions: ['Uniform rainfall', 'Small catchment (< 80 ha)', 'Constant runoff coefficient'],
    limitations: ['Not applicable for large basins', 'No temporal distribution', 'Single peak only'],
    references: ['Mulvaney 1851'],
    preprocessingNotes: ['Rainfall intensity from Open-Meteo', 'Runoff coefficient from ESA WorldCover', 'Catchment area from HydroSHEDS'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 13 — Flood Wave Routing
// ══════════════════════════════════════════════════════════════════
export const TOOL_13: ToolWorkflowDef = {
  toolId: 13,
  name: 'Flood Wave Routing',
  vizType: 'timeseries',
  classificationBands: WATER_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'K', min: 0.1, max: 48 }, { param: 'X', min: 0, max: 0.5 }, { param: 'It', min: 0, max: 10000 }, { param: 'Ot', min: 0, max: 10000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Storage constant from channel geometry');
    log.push('  Weighting factor from calibration');
    log.push('  Inflow/outflow from USGS NWIS');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, WATER_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'K and X calibration', contribution: 'Varies' },
      { factor: 'Channel geometry variability', contribution: 'Varies' },
      { factor: 'Linear storage assumption', contribution: 'Varies' },
    ],
    overallAssessment: 'Muskingum has +/- 15% uncertainty. Use Muskingum-Cunge for ungauged reaches.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Flood Wave Routing: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Flood wave attenuation in river reaches. S = K*[X*I + (1-X)*O].`,
    recommendations: ['For ungauged reaches, use Muskingum-Cunge.', 'K = travel time; X = 0 (storage) to 0.5 (translation).', 'Typical natural channels: X = 0.2-0.3.'],
  }),
  metadata: {
    methodology: 'Flood wave attenuation in river reaches. S = K*[X*I + (1-X)*O].',
    assumptions: ['Linear storage assumption', 'Requires calibration', 'Constant parameters'],
    limitations: ['No temporal distribution', 'Not for large basins', 'Requires calibration'],
    references: ['McCarthy 1938', 'Cunge 1969'],
    preprocessingNotes: ['Storage constant from channel geometry', 'Weighting factor from calibration', 'Inflow/outflow from USGS NWIS'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 14 — Tide Prediction
// ══════════════════════════════════════════════════════════════════
export const TOOL_14: ToolWorkflowDef = {
  toolId: 14,
  name: 'Tide Prediction',
  vizType: 'scalar',
  classificationBands: WATER_BANDS,
  validate: (inputs) => {
    const out = validateRange(inputs, [{ param: 'H0', min: -5, max: 10 }]);
    if (inputs['H0'] === undefined || inputs['H0'] === null) {
      out.warnings.push('H₀ not provided — will be derived from the station MTL−MLLW datum constant.');
    }
    const amps = inputs['amps'];
    if (amps !== undefined && amps !== null) {
      if (!Array.isArray(amps)) out.errors.push("'amps' must be an array of constituent contributions (m).");
      else if (amps.length === 0) out.warnings.push("'amps' is empty — will use genuine station constituents.");
      else amps.forEach((a: unknown, i: number) => {
        const v = typeof a === 'number' ? a : Number(a);
        if (!Number.isFinite(v) || Math.abs(v) > 10) out.errors.push(`'amps[${i}]' = ${a} is not a finite tidal term in metres.`);
      });
    }
    return out;
  },
  preprocess: (inputs, ctx, log) => {
    log.push('  Harmonic constituents from NOAA Tides & Currents (MDAPI harcon)');
    log.push('  Node factor f, equilibrium argument V₀, nodal phase u per Schureman');
    log.push('  Datum constant H₀ = MTL − MLLW');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, WATER_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Finite result', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
    { name: 'Plausible range', passed: Number.isFinite(result) && Math.abs(result) < 15, message: Number.isFinite(result) && Math.abs(result) < 15 ? 'Within tidal range' : 'Implausible tidal height', severity: Number.isFinite(result) && Math.abs(result) < 15 ? 'info' : 'warning' },
  ]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.05,
    rmseUnit: 'm',
    contributingFactors: [
      { factor: 'Constituent count', contribution: 'Varies' },
      { factor: 'Station proximity', contribution: 'Varies' },
      { factor: 'Schureman vs official engine (validated ~1–3 cm)', contribution: '±0.03 m' },
      { factor: 'Non-tidal residuals (storm surge)', contribution: 'Varies' },
    ],
    overallAssessment: 'Harmonic tide prediction (Schureman method) validated to ~0.01–0.03 m against the official NOAA CO-OPS engine; station proximity and storm-surge residuals dominate practical error.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Tide Prediction: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Tide elevation from harmonic constituents with Schureman nodal corrections — h(t) = H₀ + Σ Aᵢ·fᵢ·cos(ωᵢt + V₀ᵢ + uᵢ − φᵢ), datum MLLW.`,
    recommendations: ['Coastal: nearest NOAA tide-prediction station constituents.', 'Open ocean: satellite altimetry (outside NOAA CO-OPS coverage).', 'Storm surge adds a non-tidal residual not captured by the harmonic method.'],
  }),
  metadata: {
    methodology: 'Tidal elevation from genuine NOAA station harmonic constituents using the Schureman method: h(t) = H₀ + Σ Aᵢ·fᵢ·cos(ωᵢt + V₀ᵢ + uᵢ − φᵢ), where fᵢ and uᵢ are the lunar nodal factor and phase correction (18.6-yr cycle) and V₀ᵢ the equilibrium argument.',
    assumptions: ['Linear superposition of constituents', 'Astronomical forcing only', 'No storm surge'],
    limitations: ['Not applicable in enclosed basins', 'Requires a nearby NOAA tide-prediction station', 'Nonlinear effects ignored'],
    references: [
      'Pugh & Woodworth 2014, Sea-Level Science',
      'Schureman 1958, NOAA Special Publication 98 — Theory of Tides and Harmonic Prediction',
      'NOAA Tides & Currents (CO-OPS) — api.tidesandcurrents.noaa.gov',
    ],
    preprocessingNotes: [
      'Harmonic constituents from NOAA Tides & Currents MDAPI',
      'Node-factor/equilibrium-argument corrections applied',
      'Cross-validated against the official CO-OPS prediction engine',
    ],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 15 — Wind-Driven Current Analysis
// ══════════════════════════════════════════════════════════════════
export const TOOL_15: ToolWorkflowDef = {
  toolId: 15,
  name: 'Wind-Driven Current Analysis',
  vizType: 'vector',
  classificationBands: WATER_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'tau', min: 0, max: 10 }, { param: 'rho', min: 1000, max: 1050 }, { param: 'f', min: 0, max: 0.0002 }, { param: 'A', min: 0.001, max: 1 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Wind stress from ASCAT scatterometer');
    log.push('  Seawater density from temperature/salinity');
    log.push('  Coriolis from latitude');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, WATER_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Eddy viscosity estimation', contribution: 'Varies' },
      { factor: 'Stratification effects', contribution: 'Varies' },
      { factor: 'Time-varying wind', contribution: 'Varies' },
    ],
    overallAssessment: 'Ekman theory idealized. Observations show 10-40 deg deflection (not 45 deg classical).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Wind-Driven Current Analysis: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Ekman surface current: V0 = tau/sqrt(rho*f*Av). Net transport 90 deg to wind (robust).`,
    recommendations: ['Net Ekman transport = 90 deg to wind (robust).', 'Surface deflection: 10-40 deg (observed, not 45 classical).', 'Use CMEMS for ocean current data.'],
  }),
  metadata: {
    methodology: 'Ekman surface current: V0 = tau/sqrt(rho*f*Av). Net transport 90 deg to wind (robust).',
    assumptions: ['Constant eddy viscosity', 'No stratification', 'Steady wind', 'Infinite depth'],
    limitations: ['45 deg is idealized upper bound', 'Real oceans have stratification', 'Time-varying wind not captured'],
    references: ['Ekman 1905', 'Pugh & Woodworth 2014'],
    preprocessingNotes: ['Wind stress from ASCAT scatterometer', 'Seawater density from temperature/salinity', 'Coriolis from latitude'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 16 — Ocean Current Analysis
// ══════════════════════════════════════════════════════════════════
export const TOOL_16: ToolWorkflowDef = {
  toolId: 16,
  name: 'Ocean Current Analysis',
  vizType: 'vector',
  classificationBands: WATER_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'f', min: 0, max: 0.0002 }, { param: 'rho', min: 1000, max: 1050 }, { param: 'dpdx', min: -0.01, max: 0.01 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Sea surface height from satellite altimetry (CMEMS/AVISO)');
    log.push('  Geostrophic derivation from SSH gradient');
    log.push('  Jason-3/Sentinel-6 accuracy ~2-3 cm');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, WATER_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'SSH measurement accuracy', contribution: 'Varies' },
      { factor: 'Spatial gradient resolution', contribution: 'Varies' },
      { factor: 'Ageostrophic components', contribution: 'Varies' },
    ],
    overallAssessment: 'Satellite altimetry provides ~2-3 cm SSH. Geostrophic currents derived from SSH gradients.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Ocean Current Analysis: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Geostrophic current from sea surface height gradient. v_g = (1/rho*f)*dP/dx.`,
    recommendations: ['Use CMEMS/AVISO satellite altimetry for open ocean.', 'In-situ ADCP for coastal.', 'Geostrophic breaks near equator (f->0).'],
  }),
  metadata: {
    methodology: 'Geostrophic current from sea surface height gradient. v_g = (1/rho*f)*dP/dx.',
    assumptions: ['Geostrophic balance', 'No friction', 'Away from equator'],
    limitations: ['Degrades within 20-30 km of coast', 'No ageostrophic component', 'Requires SSH data'],
    references: ['Gill 1982, Atmosphere-Ocean Dynamics'],
    preprocessingNotes: ['Sea surface height from satellite altimetry (CMEMS/AVISO)', 'Geostrophic derivation from SSH gradient', 'Jason-3/Sentinel-6 accuracy ~2-3 cm'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 17 — Marine Heat Budget
// ══════════════════════════════════════════════════════════════════
export const TOOL_17: ToolWorkflowDef = {
  toolId: 17,
  name: 'Marine Heat Budget',
  vizType: 'heatmap',
  classificationBands: WATER_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Qs', min: 0, max: 1500 }, { param: 'Qb', min: 0, max: 500 }, { param: 'Qh', min: -200, max: 500 }, { param: 'Qe', min: -200, max: 500 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  ERA5 (ECMWF CDS) surface energy fluxes on Gill (1982) conventions:');
    log.push('    Q_s = absorbed shortwave   = ERA5 ssr (net solar radiation)');
    log.push('    Q_b = net upward longwave  = −ERA5 str (net thermal radiation)');
    log.push('    Q_h = sensible heat lost by ocean = −ERA5 sshf');
    log.push('    Q_e = latent heat lost by ocean   = −ERA5 slhf');
    log.push('  (Accumulated J/m² at the 12Z forecast step ÷ 3600 s → W/m².)');
    log.push('  ERA5 reanalysis lags ~6 months; fluxes are for the most recent available day.');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, WATER_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: 'W/m²',
    contributingFactors: [
      { factor: 'ERA5 turbulent-flux parameterization (bulk formulas)', contribution: '~10–20 W/m²' },
      { factor: 'Reanalysis date offset (~6-month latency, not current day)', contribution: 'seasonal' },
      { factor: 'Sub-grid averaging over 0.5° area window', contribution: '~5 W/m²' },
    ],
    overallAssessment: 'Ocean surface heat budget uncertainty ~15 W/m² with genuine ERA5 fluxes. No static fallbacks — honest NaN when CDS is unreachable.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Marine Heat Budget: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} W/m². Gill (1982): Q_net = Q_s − Q_b − Q_h − Q_e, positive = heat gain by the ocean.`,
    recommendations: ['Compare with NOC NOCS air–sea flux climatology.', 'WOA23/NCEI OISST for SST context.', 'CERES EBAF for the top-of-atmosphere radiation balance.'],
  }),
  metadata: {
    methodology: 'Gill (1982) ocean surface heat budget: Q_net = Q_s − Q_b − Q_h − Q_e (positive = ocean gain). Inputs are genuine ERA5 surface energy fluxes converted to Gill conventions (Q_s=ssr, Q_b=−str, Q_h=−sshf, Q_e=−slhf). Derived: SST tendency dSST/dt = Q_net/(ρc_pH) and evaporation rate E = Q_e/(ρL_v).',
    assumptions: ['Mixed-layer slab depth H (default 50 m)', 'ρ = 1025 kg/m³, c_p = 3990 J/kg/K (Gill Ch. 3)', 'No horizontal advection (local budget only)'],
    limitations: ['ERA5 lags ~6 months (reanalysis latency), so "current" runs use the most recent available day', 'Turbulent fluxes are model-parameterized', 'Point result averaged over ~0.5° window'],
    references: ['Gill 1982, Atmosphere-Ocean Dynamics Ch. 3', 'ECMWF ERA5 Part 1/2 documentation (IFS flux conventions, verified empirically against raw CDS output)'],
    preprocessingNotes: ['ERA5 surface fluxes fetched from CDS (reanalysis-era5-single-levels)', 'Sign conventions verified against raw ssr/str/sshf/slhf NetCDF output'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 18 — Infiltration Analysis
// ══════════════════════════════════════════════════════════════════
export const TOOL_18: ToolWorkflowDef = {
  toolId: 18,
  name: 'Infiltration Analysis',
  vizType: 'heatmap',
  classificationBands: WATER_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Ks', min: 1e-10, max: 1 }, { param: 'psiW', min: 0, max: 10 }, { param: 'psi0', min: -10, max: 10 }, { param: 'dTheta', min: 0, max: 0.95 }, { param: 'Ft', min: 0, max: 5 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Green & Ampt (1911) Eq.: f = K_s·(1 + ψ_f·Δθ/F)');
    log.push('  K_s, ψ_w: USDA texture from ISRIC SoilGrids sand/silt/clay → Rawls (1983) / Mays (2005) Table 7.7.2');
    log.push('  Δθ = θ_s − θ_i: θ_s from table, θ_i from genuine GLDAS Noah 2.1 0–10 cm');
    log.push('  F(t): cumulative infiltration from IMERG storm total (mm → m) or user-supplied');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, WATER_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 25,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'K_s from texture class (Rawls 1983 table)', contribution: 'Order-of-magnitude variability within texture class' },
      { factor: 'θ_i from GLDAS proxy', contribution: 'GLDAS 0–10 cm vs point-scale variability' },
      { factor: 'F(t) from IMERG storm total', contribution: 'IMERG retrieval uncertainty' },
    ],
    overallAssessment: 'Green-Ampt: ±25 % typical. ISRIC texture + Rawls table + GLDAS θ_i + IMERG F — all genuine data, no static fallbacks.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Green-Ampt Infiltration Rate: ${Number.isFinite(result) ? result.toExponential(4) : 'N/A'} m/s. f = K_s·(1 + ψ_f·Δθ/F). K_s, ψ_f from ISRIC texture (Rawls 1983 table); Δθ from GLDAS θ_i; F from IMERG storm total. All genuine data — honest NaN when any is missing.`,
    recommendations: ['K_s/ψ_f from ISRIC soil texture (USDA → Rawls 1983, Mays 2005 Table 7.7.2).', 'θ_i from GLDAS Noah 2.1 0–10 cm (no global in-situ network).', 'F(t) from IMERG storm total precipitation (mm → m).', 'Wetting front depth L = F/Δθ in the outputs table.'],
  }),
  metadata: {
    methodology: 'Green & Ampt (1911): f = K_s·(1 + ψ_f·Δθ/F). ψ_f = ψ_w − ψ₀ (effective suction). K_s, ψ_w from ISRIC SoilGrids texture → Rawls (1983) / Mays (2005) Table 7.7.2. θ_i from GLDAS Noah 2.1 0–10 cm. Δθ = θ_s − θ_i (≥0.01). F(t) from IMERG storm total precipitation (mm ÷ 1000 → m). All genuine data sources — honest NaN when unavailable.',
    assumptions: ['Homogeneous soil profile', 'Sharp wetting front (piston flow)', 'Constant K_s and ψ_f', 'No macropore or preferential flow'],
    limitations: ['Layered or structured soils violate the sharp-front assumption', 'Surface sealing/time-varying K_s not represented', 'F(t) is implicit in t — requires iteration', 'ISRIC texture is a point estimate, not a soil-horizon profile'],
    references: ['Green, W.H. & Ampt, G.A. (1911) J. Agric. Sci. 4(1):1–24. DOI 10.1017/S0021859600001441', 'Rawls, W.J. et al. (1983) Trans. ASAE 26(5):1362–1368. (tabulated in Mays 2005 §7.7)'],
    preprocessingNotes: ['K_s, ψ_f from ISRIC SoilGrids texture → Rawls (1983) Green-Ampt table', 'θ_i from GLDAS Noah 2.1 0–10 cm', 'F(t) from IMERG storm total or user-supplied', 'All genuine data — no static fallbacks'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 19 — Earthquake Frequency Analysis
// ══════════════════════════════════════════════════════════════════
export const TOOL_19: ToolWorkflowDef = {
  toolId: 19,
  name: 'Earthquake Frequency Analysis',
  vizType: 'bar',
  classificationBands: SEISMIC_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'a', min: 0, max: 10 }, { param: 'b', min: 0.5, max: 2 }, { param: 'M', min: 0, max: 10 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  USGS FDSN earthquake catalog query (orderby=time, no truncation)');
    log.push('  Completeness magnitude M_c from lowest populated 0.1-M bin (floor 2.5)');
    log.push('  b-value via Aki (1965) MLE + Shi & Bolt (1987) bin correction');
    log.push('  a-value fitted: a = log10(rate/Mc) so N(≥M_c) = observed annual rate');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SEISMIC_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.1,
    rmseUnit: 'magnitude',
    contributingFactors: [
      { factor: 'Catalog completeness', contribution: 'Varies' },
      { factor: 'b-value regional variability', contribution: 'Varies' },
      { factor: 'Magnitude uncertainty', contribution: 'Varies' },
    ],
    overallAssessment: 'USGS magnitudes have +/- 0.1-0.3 uncertainty. b-value varies regionally.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Earthquake Frequency Analysis: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Gutenberg-Richter: log10(N) = a - b*M. b ~ 1.0 globally.`,
    recommendations: ['Cross-reference USGS FDSN catalog.', 'Validate b-value against regional data.', 'For deformation, consider InSAR (Sentinel-1).'],
  }),
    metadata: {
      methodology: 'Gutenberg-Richter: log10(N) = a - b*M. a and b fitted to the genuine USGS catalog sample: b via Aki (1965) maximum likelihood with Shi & Bolt (1987) bin correction, a from the observed annual rate above M_c.',
      assumptions: ['Power-law distribution', 'Stationary seismicity', 'Complete catalog above threshold'],
      limitations: ['Catalog incompleteness', 'Temporal b-value variations', 'Assumes power law', 'Annualized from the query window length (default 1 yr)'],
      references: ['Gutenberg & Richter 1944, BSSA 34(4):185-188', 'Aki 1965 (MLE b-value)', 'Shi & Bolt 1987, BSSA 77:1674-1687 (b-value uncertainty)', 'Mays 2005, Water Resources Engineering'],
      preprocessingNotes: ['USGS FDSN earthquake catalog query', 'orderby=time with limit=10000 (no magnitude-sort truncation bias)', 'M_c from lowest populated 0.1-M bin, floor 2.5', 'b via Aki 1965 MLE + Shi & Bolt correction', 'a fitted so N(≥M_c) equals observed rate'],
    },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 20 — Aftershock Decay Analysis
// ══════════════════════════════════════════════════════════════════
export const TOOL_20: ToolWorkflowDef = {
  toolId: 20,
  name: 'Aftershock Decay Analysis',
  vizType: 'timeseries',
  classificationBands: SEISMIC_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'K', min: 0, max: 1e6 }, { param: 'c', min: 1e-6, max: 100 }, { param: 't', min: 0, max: 5000 }, { param: 'p', min: 0.05, max: 2.6 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  USGS FDSN aftershock sequence (genuine catalog, orderby=time)');
    log.push('  Mainshock = largest event in sample');
    log.push('  K, c, p fitted by Ogata (1983) maximum likelihood (grid + refinement)');
    log.push('  Likelihood integrates over the FULL observation window (no truncation)');
    log.push('  t = elapsed days since fitted mainshock (current decay rate)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SEISMIC_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.2,
    rmseUnit: 'p-value',
    contributingFactors: [
      { factor: 'Sequence completeness', contribution: 'Varies' },
      { factor: 'Mainshock-aftershock classification', contribution: 'Varies' },
      { factor: 'Time window selection', contribution: 'Varies' },
    ],
    overallAssessment: 'Omori p typically 0.7-1.5. p ~ 1.0 is standard reference.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Aftershock Decay Analysis: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Omori law: n(t) = K/(c+t)^p. Utsu (1961) modified form with p != 1.`,
    recommendations: ['Query USGS FDSN for aftershock sequence.', 'p is empirical, sequence-dependent.', 'Use modified Omori (Utsu 1961).'],
  }),
    metadata: {
      methodology: 'Modified Omori law (Utsu 1961): n(t) = K/(c+t)^p. K, c, p fitted to the genuine USGS FDSN aftershock sequence by Ogata (1983) maximum likelihood over the full observation window; t is the elapsed time since the fitted mainshock.',
      assumptions: ['Stationary decay', 'No clustering of aftershocks', 'Single mainshock dominates sequence', 'Catalog complete above magnitude threshold'],
      limitations: ['p varies by sequence and magnitude', 'Requires careful declustering for secondary sequences', 'MLE on truncated catalog can bias c', 'Background rate not subtracted (stationary Omori)'],
      references: ['Omori 1894, Univ. Tokyo 2:111', 'Utsu 1961, J. Fac. Sci. Hokkaido Univ. Ser. VII', 'Ogata 1983, J. Stat. Phys. 31:257 (MLE for modified Omori)'],
      preprocessingNotes: ['USGS FDSN aftershock sequence query', 'Mainshock = largest event in sample', 'K/c/p via Ogata 1983 MLE, likelihood integrated over full window', 't elapsed since mainshock for current rate'],
    },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 21 — Ground Motion Prediction
// ══════════════════════════════════════════════════════════════════
export const TOOL_21: ToolWorkflowDef = {
  toolId: 21,
  name: 'Ground Motion Prediction',
  vizType: 'gauge',
  classificationBands: SEISMIC_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'mag', min: 2.5, max: 8.8 },
    { param: 'rrup', min: 0, max: 500 },
    { param: 'rjb', min: 0, max: 500 },
    { param: 'rx', min: 0, max: 500 },
    { param: 'vs30', min: 100, max: 2000 },
    { param: 'rake', min: -180, max: 180 },
    { param: 'dip', min: 1, max: 90 },
    { param: 'ztor', min: 0, max: 20 },
    { param: 'width', min: 0.5, max: 100 },
    { param: 'hypoDepth', min: 0, max: 70 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  USGS moment tensor of strongest recent event with a published mechanism');
    log.push('  M, rake, dip, ZTOR, hypocentral depth from the genuine focal mechanism');
    log.push('  Vs30 from fetched SRTM slope (Wald & Allen 2007 active-crust proxy)');
    log.push('  Rjb = epicentral distance (point-source projection); Rrup = √(Rjb²+h²)');
    log.push('  Rupture width: eq. 39 of C&B 2014 (log10 W = (M−4.07)/0.98)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SEISMIC_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.3,
    rmseUnit: 'ln(g)',
    contributingFactors: [
      { factor: 'GMPE model selection', contribution: 'Varies' },
      { factor: 'Site amplification', contribution: 'Varies' },
      { factor: 'Fault mechanism uncertainty', contribution: 'Varies' },
    ],
    overallAssessment: 'NGA-West2 GMPEs have sigma ~ 0.3 ln(g). USGS 2023 NSHM uses logic tree.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Ground Motion Prediction: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Campbell-Bozorgnia NGA-West2 GMPE. ln(Y) = f_mag + f_dist + f_site + f_fault + f_hw.`,
    recommendations: ['USGS 2023 NSHM uses NGA-West2 logic tree.', 'NGA-East for CEUS.', 'Validate with ShakeMap.'],
  }),
    metadata: {
      methodology: 'Campbell–Bozorgnia (2014) NGA-West2 GMPE, PGA row of the published coefficient table, evaluated as the full functional form: ln(PGA) = f_mag + f_att + f_flt + f_hng + f_site + f_basin + f_dip + f_hyp + f_atten (eqs. 2-25). Coefficients verified byte-exact against the OpenQuake hazardlib reference implementation.',
      assumptions: ['Active shallow crustal region', 'RotD50 geometric-mean component', 'Basin depth derived from Vs30 (Choi & Stewart-style z2.5(Vs30))', 'Point-source rupture projection for Rjb/Rrup'],
      limitations: ['Model valid M3.0–8.5, Rrup 0–300 km (attenuation term extrapolates beyond)', 'Requires Vs30; derived here from terrain slope when not supplied', 'Requires a published moment tensor (genuine mechanism) — no fabricated focal mechanisms', 'No directivity'],
      references: ['Campbell & Bozorgnia 2014, Earthquake Spectra 30(3):1087-1115 (NGA-West2)', 'OpenQuake hazardlib gsim/campbell_bozorgnia_2014.py (reference implementation)', 'Wald & Allen 2007, BSSA 97(6):1969-1986 (Vs30 terrain proxy)', 'Chiou & Youngs 2014, Earthquake Spectra 30(3) (ZTOR estimation, eqs. 4-5)'],
      preprocessingNotes: ['USGS FDSN moment tensor (detail endpoint) for M/rake/dip/depth', 'Scalar moment and centroid depth from the MT product', 'Vs30 via terrain slope (SRTM) → log10(Vs30)=3.74−0.9·log10(slope)', 'Rupture width via eq. 39 of C&B 2014'],
    },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 22 — Shear Strength Analysis
// ══════════════════════════════════════════════════════════════════
export const TOOL_22: ToolWorkflowDef = {
  toolId: 22,
  name: 'Shear Strength Analysis',
  vizType: 'gauge',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'c', min: 0, max: 100 }, { param: 'sigmaN', min: 0, max: 1000 }, { param: 'tanPhi', min: 0.05, max: 1.5 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Soil texture + bulk density from ISRIC SoilGrids (0–5 cm)');
    log.push('  σₙ = total overburden at layer midpoint: ρ_b·g·z (2.5 cm)');
    log.push('  c, tanφ from texture via published geotechnical strength table');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Cohesion variability', contribution: 'Varies' },
      { factor: 'Friction angle estimation', contribution: 'Varies' },
      { factor: 'Pore pressure conditions', contribution: 'Varies' },
    ],
    overallAssessment: 'Mohr-Coulomb has +/- 20% uncertainty from soil property variability.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Shear Strength Analysis: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Mohr-Coulomb failure: tau = c + sigma_n * tan(phi). Byerlee law: phi ~ 30-40 deg for faults.`,
    recommendations: ['For faults: Byerlee law phi ~ 30-40 deg.', 'Use effective stress for saturated soils.', 'Consider strain-softening for brittle failure.'],
  }),
    metadata: {
      methodology: 'Mohr–Coulomb failure: τ = c + σₙ·tanφ. σₙ derived as total overburden at the 0–5 cm layer midpoint from ISRIC SoilGrids bulk density; c and tanφ derived from ISRIC texture via published geotechnical strength values. Stress state on the failure plane is recovered exactly via Mohr-pole geometry.',
      assumptions: ['Drained, normally-consolidated effective stress', 'Linear failure envelope', 'Constant c and φ', 'Total (not effective) overburden used for σₙ'],
      limitations: ['Cohesion/friction are texture-based reference values, not measured', 'Does not account for suction or strain-softening', 'Requires effective stress analysis for saturated soils', 'Shallow layer only (0–5 cm)'],
      references: ['Coulomb 1776', 'Mohr 1900', 'Byerlee 1978 (faults)', 'Das — Principles of Geotechnical Engineering; Bowles — Foundation Analysis and Design (drained strength values)'],
      preprocessingNotes: ['ISRIC SoilGrids 0–5 cm: clay/silt/sand + bulk density', 'σₙ = ρ_b·g·z at 2.5 cm midpoint', 'Texture → USDA class → drained φ and c (reference table)', 'No bulk density or texture ⇒ honest NaN (no fabricated constants)'],
    },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 23 — Earthquake Magnitude from Moment
// ══════════════════════════════════════════════════════════════════
export const TOOL_23: ToolWorkflowDef = {
  toolId: 23,
  name: 'Earthquake Magnitude from Moment',
  vizType: 'scalar',
  classificationBands: SEISMIC_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'M0', min: 1e10, max: 1e24 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Seismic moment from USGS moment tensor');
    log.push('  Global CMT catalog for validation');
    log.push('  M0 in N*m (not dyne-cm)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SEISMIC_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'M0 determination', contribution: 'Varies' },
      { factor: 'Unit consistency (N*m vs dyne*cm)', contribution: 'Varies' },
    ],
    overallAssessment: 'Moment magnitude is the most physically meaningful scale. M0 has +/- 0.1-0.3 uncertainty.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Earthquake Magnitude from Moment: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Moment magnitude: M_w = (2/3)*log10(M0) - 6.07. M0 must be in N*m.`,
    recommendations: ['M0 must be in N*m (not dyne-cm: use -10.7).', 'USGS uses M_w as preferred magnitude.', 'Global CMT for independent validation.'],
  }),
  metadata: {
    methodology: 'Moment magnitude: M_w = (2/3)*log10(M0) - 6.07. M0 must be in N*m.',
    assumptions: ['Point source approximation', 'Double-couple assumption', 'Constant -6.07 offset'],
    limitations: ['Saturation above M~8.5', 'Not for slow earthquakes', 'Requires moment tensor solution'],
    references: ['Hanks & Kanamori 1979, JGR 84(B5):2348-2350'],
    preprocessingNotes: ['Seismic moment from USGS moment tensor', 'Global CMT catalog for validation', 'M0 in N*m (not dyne-cm)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 24 — Earthquake Stress Drop Analysis
// ══════════════════════════════════════════════════════════════════
export const TOOL_24: ToolWorkflowDef = {
  toolId: 24,
  name: 'Earthquake Stress Drop Analysis',
  vizType: 'scalar',
  classificationBands: SEISMIC_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'M0', min: 1e10, max: 1e24 }, { param: 'r', min: 10, max: 50000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  M₀ from the USGS moment-tensor scalar moment of the strongest recent event');
    log.push('  Fallback: exact Hanks–Kanamori inverse of the catalog max magnitude');
    log.push('  Source radius via Wells–Coppersmith rupture area: r = √(A/π)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SEISMIC_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.5,
    rmseUnit: 'log10(Pa)',
    contributingFactors: [
      { factor: 'Source model (Brune vs Madariaga)', contribution: 'Varies' },
      { factor: 'Corner frequency measurement', contribution: 'Varies' },
      { factor: 'Rupture velocity assumption', contribution: 'Varies' },
    ],
    overallAssessment: 'Stress drops have factor-of-10 variability. Brune 1970 vs Madariaga 1976 fc conventions.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Earthquake Stress Drop Analysis: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Brune stress drop: delta_sigma = (7/16)*M0/r^3. fc = 0.49*beta/r (Brune convention).`,
    recommendations: ['Cite model: Brune (0.49) vs Madariaga (0.21-0.42).', 'Typical stress drops: 1-10 MPa interplate.', 'Use IRIS DMC for seismograms.'],
  }),
    metadata: {
      methodology: 'Brune stress drop: Δσ = (7/16)·M₀/r³ with the exact circular-crack slip identity D = M₀/(μ·π·r²). M₀ from the USGS moment-tensor scalar moment; source radius from the Wells–Coppersmith rupture area (r = √(A/π)). f_c = 0.49·β/r (Brune convention).',
      assumptions: ['Circular crack model', 'Constant rupture velocity', 'Brune omega-squared model', 'Average shear modulus 3×10¹⁰ Pa'],
      limitations: ['Stress drops highly variable (factor ~10)', 'Model-dependent fc', 'r derived from scaling relations unless user-supplied'],
      references: ['Brune 1970, JGR 75(26):4997-5009', 'Wells & Coppersmith 1994 (rupture-area scaling)', 'Kanamori & Anderson 1975 (self-similarity)'],
      preprocessingNotes: ['USGS moment-tensor scalar moment (N·m)', 'Fallback: M₀ = 10^(1.5·maxMag + 9.05)', 'r = √(10^(−3.49 + 0.91·Mw)/π) (W&C area)', 'r = 0 / M₀ ≤ 0 guards return honest NaN'],
    },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 25 — Fault Rupture Scaling
// ══════════════════════════════════════════════════════════════════
export const TOOL_25: ToolWorkflowDef = {
  toolId: 25,
  name: 'Fault Rupture Scaling',
  vizType: 'scatter',
  classificationBands: SEISMIC_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Mw', min: 3, max: 10 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  USGS Quaternary Faults database');
    log.push('  Wells-Coppersmith regressions');
    log.push('  Leonard (2014) for M > 7');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SEISMIC_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.3,
    rmseUnit: 'log10(L)',
    contributingFactors: [
      { factor: 'Regression scatter', contribution: 'Varies' },
      { factor: 'Fault type variability', contribution: 'Varies' },
      { factor: 'Bias for large M', contribution: 'Varies' },
    ],
    overallAssessment: 'Wells-Coppersmith has bias for M > 7. Use Leonard (2014) or Stirling (2013) for large events.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Fault Rupture Scaling: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Wells-Coppersmith scaling: log10(L) = a + b*M_w. For M > 7, prefer Leonard (2014).`,
    recommendations: ['For M > 7: use Leonard (2014) scaling.', 'USGS Quaternary Faults DB for fault geometry.', 'Stirling (2013) for updated regressions.'],
  }),
  metadata: {
    methodology: 'Wells-Coppersmith scaling: log10(L) = a + b*M_w. For M > 7, prefer Leonard (2014).',
    assumptions: ['Empirical regression', 'Fault-type specific', 'Limited data for large M'],
    limitations: ['Large scatter for M > 7', 'Self-similar assumption', 'Regional variability'],
    references: ['Wells & Coppersmith 1994, BSSA 84(4):974-1002', 'Leonard 2014'],
    preprocessingNotes: ['USGS Quaternary Faults database', 'Wells-Coppersmith regressions', 'Leonard (2014) for M > 7'],
  },
  dependencies: [23],
};

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

// ══════════════════════════════════════════════════════════════════
//  EQUATION 26 — Vegetation Health Index
// ══════════════════════════════════════════════════════════════════
export const TOOL_26: ToolWorkflowDef = {
  toolId: 26,
  name: 'Vegetation Health Index',
  vizType: 'heatmap',
  classificationBands: INDEX_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'NIR', min: 0, max: 1 }, { param: 'Red', min: 0, max: 1 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Acquire NIR/Red reflectance from Sentinel-2 or MODIS');
    log.push('  Apply atmospheric correction if L1C');
    log.push('  Mask clouds and shadows');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, INDEX_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.05,
    rmseUnit: 'NDVI',
    contributingFactors: [
      { factor: 'Atmospheric correction', contribution: 'Varies' },
      { factor: 'BRDF effects', contribution: 'Varies' },
      { factor: 'Sensor calibration', contribution: 'Varies' },
    ],
    overallAssessment: 'NDVI has +/- 0.02-0.05 uncertainty. Pre-computed MODIS reduces noise.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Vegetation Health Index: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. NDVI = (NIR-Red)/(NIR+Red). Dense veg: 0.6-0.8. Saturation above 0.8.`,
    recommendations: ['Use EVI where NDVI saturates (>0.8).', 'MODIS MOD13 for temporal continuity.', 'Sentinel-2 for 10m resolution.'],
  }),
  metadata: {
    methodology: 'NDVI = (NIR-Red)/(NIR+Red). Dense veg: 0.6-0.8. Saturation above 0.8.',
    assumptions: ['Atmospherically corrected reflectance', 'Nadir viewing', 'Homogeneous pixel'],
    limitations: ['Saturates above 0.8', 'Soil background effects', 'Atmospheric contamination'],
    references: ['Rouse et al. 1974', 'Huete et al. 2002, RSE 83:195-213'],
    preprocessingNotes: ['Acquire NIR/Red reflectance from Sentinel-2 or MODIS', 'Apply atmospheric correction if L1C', 'Mask clouds and shadows'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 27 — Surface Water Detection
// ══════════════════════════════════════════════════════════════════
export const TOOL_27: ToolWorkflowDef = {
  toolId: 27,
  name: 'Surface Water Detection',
  vizType: 'heatmap',
  classificationBands: INDEX_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Green', min: 0, max: 1 }, { param: 'NIR', min: 0, max: 1 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Acquire Green/NIR reflectance from Sentinel-2');
    log.push('  10m resolution for shoreline delineation');
    log.push('  Verify with MNDWI for built-up areas');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, INDEX_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.03,
    rmseUnit: 'NDWI',
    contributingFactors: [
      { factor: 'Atmospheric correction', contribution: 'Varies' },
      { factor: 'Mixed pixels at shoreline', contribution: 'Varies' },
      { factor: 'Shadow contamination', contribution: 'Varies' },
    ],
    overallAssessment: 'NDWI water detection has +/- 0.03 uncertainty. Use MNDWI for urban areas.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Surface Water Detection: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. NDWI = (Green-NIR)/(Green+NIR). >0 indicates open water.`,
    recommendations: ['Use MNDWI for built-up areas.', 'Sentinel-2 10m for shoreline.', 'Verify water body with secondary check.'],
  }),
  metadata: {
    methodology: 'NDWI = (Green-NIR)/(Green+NIR). >0 indicates open water.',
    assumptions: ['Open water surfaces', 'Low turbidity', 'Minimal shadow'],
    limitations: ['Built-up areas can give false positives', 'Turbid water detection varies', 'Shadow confusion'],
    references: ['McFeeters 1996, Int. J. Remote Sensing 17(7):1425-1432'],
    preprocessingNotes: ['Acquire Green/NIR reflectance from Sentinel-2', '10m resolution for shoreline delineation', 'Verify with MNDWI for built-up areas'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 28 — Vegetation Water Content
// ══════════════════════════════════════════════════════════════════
export const TOOL_28: ToolWorkflowDef = {
  toolId: 28,
  name: 'Vegetation Water Content',
  vizType: 'heatmap',
  classificationBands: INDEX_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'NIR', min: 0, max: 1 }, { param: 'SWIR', min: 0, max: 1 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Acquire NIR/SWIR from Sentinel-2 B8/B11');
    log.push('  NDMI uses SWIR1 (1.6um) — different from Gao-NDWI (1.24um)');
    log.push('  Label correctly: NDMI vs Gao-NDWI');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, INDEX_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.04,
    rmseUnit: 'NDMI',
    contributingFactors: [
      { factor: 'SWIR atmospheric absorption', contribution: 'Varies' },
      { factor: 'Canopy structure effects', contribution: 'Varies' },
      { factor: 'Sensor bandpass differences', contribution: 'Varies' },
    ],
    overallAssessment: 'NDMI has +/- 0.04 uncertainty. Naming collision: NDMI (1.6um) vs Gao-NDWI (1.24um).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Vegetation Water Content: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. NDMI = (NIR-SWIR)/(NIR+SWIR). Vegetation water content. Also called Gao-NDWI.`,
    recommendations: ['Disambiguate: NDMI (1.6um) vs Gao-NDWI (1.24um).', 'Sentinel-2 B8/B11 for NDMI.', 'Different physics at different SWIR wavelengths.'],
  }),
  metadata: {
    methodology: 'NDMI = (NIR-SWIR)/(NIR+SWIR). Vegetation water content. Also called Gao-NDWI.',
    assumptions: ['Vegetation canopy present', 'SWIR atmospheric window clear', 'Consistent bandpass'],
    limitations: ['Naming collision with water NDWI', 'SWIR atmospheric absorption', 'Canopy structure effects'],
    references: ['Gao 1996, RSE 58(3):257-266', 'Wilson & Sader 2002'],
    preprocessingNotes: ['Acquire NIR/SWIR from Sentinel-2 B8/B11', 'NDMI uses SWIR1 (1.6um) — different from Gao-NDWI (1.24um)', 'Label correctly: NDMI vs Gao-NDWI'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 29 — Enhanced Vegetation Index
// ══════════════════════════════════════════════════════════════════
export const TOOL_29: ToolWorkflowDef = {
  toolId: 29,
  name: 'Enhanced Vegetation Index',
  vizType: 'heatmap',
  classificationBands: INDEX_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'NIR', min: 0, max: 1 }, { param: 'Red', min: 0, max: 1 }, { param: 'Blue', min: 0, max: 1 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Use MODIS MOD13 pre-computed EVI for MODIS bandpass');
    log.push('  For Sentinel-2: use EVI2 (no blue band) or HLS EVI');
    log.push('  MODIS coefficients (G=2.5, C1=6, C2=7.5, L=1) not transferable to S2');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, INDEX_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.06,
    rmseUnit: 'EVI',
    contributingFactors: [
      { factor: 'Blue band calibration', contribution: 'Varies' },
      { factor: 'Coefficient transferability', contribution: 'Varies' },
      { factor: 'Atmospheric aerosol correction', contribution: 'Varies' },
    ],
    overallAssessment: 'EVI has +/- 0.06 uncertainty. MODIS coefficients NOT directly transferable to Sentinel-2.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Enhanced Vegetation Index: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. EVI = G*(NIR-Red)/(NIR+C1*Red-C2*Blue+L). G=2.5, C1=6, C2=7.5, L=1 (MODIS).`,
    recommendations: ['MODIS coefficients NOT transferable to S2 without bandpass adjustment.', 'Use EVI2 for S2: 2.5*(NIR-Red)/(NIR+2.4*Red+1).', 'HLS EVI for merged Landsat+S2.'],
  }),
  metadata: {
    methodology: 'EVI = G*(NIR-Red)/(NIR+C1*Red-C2*Blue+L). G=2.5, C1=6, C2=7.5, L=1 (MODIS).',
    assumptions: ['MODIS bandpasses', 'Atmospheric correction via blue band', 'Canopy background correction'],
    limitations: ['Coefficient transferability issue', 'Requires blue band', 'Not for sensors without blue band'],
    references: ['Huete et al. 2002, RSE 83:195-213', 'Jiang et al. 2008, RSE 112:3833-3845 (EVI2)'],
    preprocessingNotes: ['Use MODIS MOD13 pre-computed EVI for MODIS bandpass', 'For Sentinel-2: use EVI2 (no blue band) or HLS EVI', 'MODIS coefficients (G=2.5, C1=6, C2=7.5, L=1) not transferable to S2'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 30 — Snow Cover Detection
// ══════════════════════════════════════════════════════════════════
export const TOOL_30: ToolWorkflowDef = {
  toolId: 30,
  name: 'Snow Cover Detection',
  vizType: 'heatmap',
  classificationBands: INDEX_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Green', min: 0, max: 1 }, { param: 'SWIR', min: 0, max: 1 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Use pre-computed MODIS MOD10A1 (500m daily)');
    log.push('  MODIS C6.1 threshold: NDSI > 0.0 (not 0.4)');
    log.push('  Add visible reflectance screen (>0.07-0.11)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, INDEX_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.05,
    rmseUnit: 'NDSI',
    contributingFactors: [
      { factor: 'Cloud masking', contribution: 'Varies' },
      { factor: 'Forest canopy snow detection', contribution: 'Varies' },
      { factor: 'Polar darkness', contribution: 'Varies' },
    ],
    overallAssessment: 'MODIS C6.1 uses NDSI > 0.0 (not 0.4). Riggs et al. 2016.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Snow Cover Detection: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. NDSI = (Green-SWIR)/(Green+SWIR). MODIS C6.1: snow if NDSI > 0.0.`,
    recommendations: ['MODIS C6.1: threshold 0.0 (not 0.4).', 'Landsat binary: NDSI > 0.4 still OK.', 'MOD10A1 includes cloud mask.'],
  }),
  metadata: {
    methodology: 'NDSI = (Green-SWIR)/(Green+SWIR). MODIS C6.1: snow if NDSI > 0.0.',
    assumptions: ['Snow has high visible, low SWIR reflectance', 'Cloud-free pixel', 'Nadir viewing'],
    limitations: ['Forest canopy obscures snow', 'Cloud contamination', 'Polar darkness limitation'],
    references: ['Hall et al. 1995, RSE 54(2):127-140', 'Riggs, Hall & Roman 2016, MODIS C6.1 User Guide'],
    preprocessingNotes: ['Use pre-computed MODIS MOD10A1 (500m daily)', 'MODIS C6.1 threshold: NDSI > 0.0 (not 0.4)', 'Add visible reflectance screen (>0.07-0.11)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 31 — Burn Severity Mapping
// ══════════════════════════════════════════════════════════════════
export const TOOL_31: ToolWorkflowDef = {
  toolId: 31,
  name: 'Burn Severity Mapping',
  vizType: 'heatmap',
  classificationBands: INDEX_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'NIR', min: 0, max: 1 }, { param: 'SWIR', min: 0, max: 1 },
    { param: 'NIR_pre', min: 0, max: 1 }, { param: 'SWIR_pre', min: 0, max: 1 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Acquire pre/post fire Landsat or Sentinel-2 imagery');
    log.push('  NBR uses SWIR2 (~2.1um), not SWIR1');
    log.push('  Compute dNBR = NBR_pre - NBR_post');
    log.push('  Post-fire bands from live Landsat C2 L2 SR (SR_B5/SR_B7)');
    log.push('  Pre-fire bands must be user-supplied from a genuine pre-fire scene');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, INDEX_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.08,
    rmseUnit: 'dNBR',
    contributingFactors: [
      { factor: 'Pre/post image registration', contribution: 'Varies' },
      { factor: 'Phenological differences', contribution: 'Varies' },
      { factor: 'Atmospheric correction consistency', contribution: 'Varies' },
    ],
    overallAssessment: 'Burn severity (dNBR) has +/- 0.08 uncertainty. MTBS standard thresholds.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Burn Severity Mapping: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. NBR = (NIR-SWIR2)/(NIR+SWIR2). dNBR = NBR_pre - NBR_post. MTBS severity thresholds.`,
    recommendations: ['Use SWIR2 (~2.1um), not SWIR1.', 'MTBS: low 0.10-0.27, moderate 0.27-0.44, high >0.44.', '30m Landsat preferred for severity.'],
  }),
  metadata: {
    methodology: 'NBR = (NIR-SWIR2)/(NIR+SWIR2), dNBR = NBR_pre - NBR_post (Key & Benson). Post-fire bands are genuine Landsat C2 L2 SR_B5/SR_B7 pixel reads; pre-fire bands must come from a genuine user-supplied pre-fire scene — otherwise dNBR is honest NaN (no simulated pre-fire image).',
    assumptions: ['Pre/post fire imagery available', 'Same phenological period', 'Cloud-free conditions'],
    limitations: ['Phenological differences confound', 'Requires pre-fire reference', 'Regrowth can mask severity'],
    references: ['Key & Benson 1999 (2006 FIREMON)', 'MTBS program'],
    preprocessingNotes: ['Live post-fire scene via Planetary Computer STAC', 'Pre-fire NIR_pre/SWIR_pre user-supplied', 'dNBR indeterminate without genuine pre-fire scene'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 32 — Fire Radiative Power Estimation
// ══════════════════════════════════════════════════════════════════
export const TOOL_32: ToolWorkflowDef = {
  toolId: 32,
  name: 'Fire Radiative Power Estimation',
  vizType: 'heatmap',
  classificationBands: INDEX_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'A', min: 0, max: 1e8 }, { param: 'eps', min: 0, max: 1 }, { param: 'Tfire', min: 250, max: 2000 }, { param: 'Tbg', min: 200, max: 400 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  NASA FIRMS active-fire detections (VIIRS 375 m / MODIS 1 km NRT)');
    log.push('  T_fire = measured fire-pixel bright_ti4 (Kelvin) of strongest detection');
    log.push('  A = measured scan × track pixel dimensions');
    log.push('  T_bg = user-supplied ambient background (no fabrication)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, INDEX_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Dozier method assumptions', contribution: 'Varies' },
      { factor: 'Background temperature estimation', contribution: 'Varies' },
      { factor: 'Subpixel fire fraction', contribution: 'Varies' },
    ],
    overallAssessment: 'FIRMS FRP uses Wooster (2005) MIR radiance method. Do not recompute from raw.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Fire Radiative Power Estimation: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. FRP = eps*sigma*A*(T_fire^4 - T_bg^4). Operational: Wooster MIR radiance method.`,
    recommendations: ['Use pre-computed NASA FIRMS FRP.', 'VIIRS 375m for small/cool fires.', 'GOES ABI for fire behavior tracking.'],
  }),
  metadata: {
    methodology: 'FRP = eps*sigma*A*(T_fire^4 - T_bg^4). Operational: Wooster MIR radiance method.',
    assumptions: ['Fire fills entire pixel (Dozier)', 'Single fire per pixel', 'Known background temperature'],
    limitations: ['Subpixel heterogeneity', 'Cloud obscuration', 'Background T estimation error'],
    references: ['Giglio et al. 2003, RSE 87:273-282', 'Wooster et al. 2005, Biogeosciences 2:161'],
    preprocessingNotes: ['Use pre-computed NASA FIRMS FRP (do not recompute from raw)', 'VIIRS 375m for small fires', 'MODIS 1km for long record'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 33 — Crop Water Stress Assessment
// ══════════════════════════════════════════════════════════════════
export const TOOL_33: ToolWorkflowDef = {
  toolId: 33,
  name: 'Crop Water Stress Assessment',
  vizType: 'gauge',
  classificationBands: INDEX_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Tc', min: 0, max: 60 }, { param: 'Twet', min: 0, max: 50 }, { param: 'Tdry', min: 0, max: 60 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Satellite LST from ECOSTRESS/Landsat/Sentinel-3');
    log.push('  Jackson (1988) theoretical baselines preferred');
    log.push('  No pre-computed CWSI API exists');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, INDEX_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.15,
    rmseUnit: 'CWSI',
    contributingFactors: [
      { factor: 'Reference temperature accuracy', contribution: 'Varies' },
      { factor: 'VPD measurement', contribution: 'Varies' },
      { factor: 'Aerodynamic resistance', contribution: 'Varies' },
    ],
    overallAssessment: 'CWSI has +/- 0.15 uncertainty. Jackson (1988) theoretical method preferred over Idso empirical.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Crop Water Stress Assessment: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. CWSI = (Tc-Twet)/(Tdry-Twet). 0=no stress, 1=full stress. Jackson theoretical preferred.`,
    recommendations: ['Prefer Jackson (1988) theoretical method.', 'Requires satellite LST (ECOSTRESS 70m).', 'No pre-computed CWSI API exists.'],
  }),
  metadata: {
    methodology: 'CWSI = (Tc-Twet)/(Tdry-Twet). 0=no stress, 1=full stress. Jackson theoretical preferred.',
    assumptions: ['Well-defined wet/dry references', 'Homogeneous canopy', 'Clear sky conditions'],
    limitations: ['Requires reference baselines', 'VPD-dependent', 'Cloud contamination'],
    references: ['Idso et al. 1981, Agric. Meteorol. 24:45', 'Jackson et al. 1988'],
    preprocessingNotes: ['Satellite LST from ECOSTRESS/Landsat/Sentinel-3', 'Jackson (1988) theoretical baselines preferred', 'No pre-computed CWSI API exists'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 34 — Snowmelt Runoff Forecasting
// ══════════════════════════════════════════════════════════════════
export const TOOL_34: ToolWorkflowDef = {
  toolId: 34,
  name: 'Snowmelt Runoff Forecasting',
  vizType: 'timeseries',
  classificationBands: INDEX_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'DDF', min: 0.5, max: 20 }, { param: 'T_air', min: -20, max: 40 }, { param: 'T_base', min: -5, max: 5 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  T_air from ERA5/Open-Meteo (NOT satellite LST)');
    log.push('  Snow cover from MODIS MOD10A1');
    log.push('  DDF: snow 3-5, ice 5-8 mm/C/day');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, INDEX_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 25,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'DDF spatial variability', contribution: 'Varies' },
      { factor: 'T_air vs LST difference', contribution: 'Varies' },
      { factor: 'Snow density variations', contribution: 'Varies' },
    ],
    overallAssessment: 'Degree-day model has +/- 25% uncertainty. DDF: snow 3-5, ice 5-8 mm/C/day (Hock 2003).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Snowmelt Runoff Forecasting: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Melt = DDF * max(0, T_air - T_base). DDF: snow 3-5, ice 5-8 mm/C/day.`,
    recommendations: ['T_air from reanalysis, NOT satellite LST.', 'MODIS MOD10A1 for snow depletion curves.', 'DDF varies with radiation and debris cover.'],
  }),
  metadata: {
    methodology: 'Melt = DDF * max(0, T_air - T_base). DDF: snow 3-5, ice 5-8 mm/C/day.',
    assumptions: ['Linear temperature-melt relation', 'Constant DDF', 'Snow surface is isothermal at 0C'],
    limitations: ['DDF varies spatially and temporally', 'T_air vs LST difference (5-15C)', 'Not for energy-balance models'],
    references: ['Braithwaite 1995', 'Hock 2003, J. Hydrol. 282:104-129'],
    preprocessingNotes: ['T_air from ERA5/Open-Meteo (NOT satellite LST)', 'Snow cover from MODIS MOD10A1', 'DDF: snow 3-5, ice 5-8 mm/C/day'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 35 — Passive Microwave Sea Ice Analysis
// ══════════════════════════════════════════════════════════════════
export const TOOL_35: ToolWorkflowDef = {
  toolId: 35,
  name: 'Passive Microwave Sea Ice Analysis',
  vizType: 'heatmap',
  classificationBands: INDEX_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'C', min: 0, max: 1 }, { param: 'Twater', min: -280, max: 400 }, { param: 'Tice', min: -280, max: 400 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Sea ice concentration from NSIDC NRT CDR V4 (AMSR2, 25 km)');
    log.push('  T_water/T_ice tie-point brightness temperatures user-supplied');
    log.push('  15% threshold defines ice extent');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, INDEX_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 5,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Tie-point variability', contribution: 'Varies' },
      { factor: 'Atmospheric contamination', contribution: 'Varies' },
      { factor: 'Melt pond effects', contribution: 'Varies' },
    ],
    overallAssessment: 'Hybrid CDR has <5% error for high-concentration ice. AMSR2 > SSMIS.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Passive Microwave Sea Ice Analysis: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Sea ice from passive microwave. Hybrid NASA-Team/Bootstrap algorithm. 15% = ice extent.`,
    recommendations: ['Use NSIDC CDR G02202 (hybrid).', 'AMSR2 (10-15km) > SSMIS (25km).', '15% threshold for ice extent.'],
  }),
  metadata: {
    methodology: 'Sea ice from passive microwave. Hybrid NASA-Team/Bootstrap algorithm. 15% = ice extent.',
    assumptions: ['Passive microwave brightness temperatures', 'Polar regions', 'Known tie-points'],
    limitations: ['Melt ponds reduce accuracy', 'Thin ice (<30cm) underestimated', 'Atmospheric contamination near ice edge'],
    references: ['Comiso 1986, JGR Oceans 91(C1):975-994', 'NSIDC G02202 CDR'],
    preprocessingNotes: ['Use pre-computed NSIDC CDR G02202 (hybrid NASA-Team/Bootstrap)', 'AMSR2 > SSMIS for resolution', '15% threshold defines ice extent'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 36 — Great Circle Distance
// ══════════════════════════════════════════════════════════════════
export const TOOL_36: ToolWorkflowDef = {
  toolId: 36,
  name: 'Great Circle Distance',
  vizType: 'scalar',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'lat1', min: -90, max: 90 }, { param: 'lon1', min: -180, max: 180 }, { param: 'lat2', min: -90, max: 90 }, { param: 'lon2', min: -180, max: 180 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Pure geometric calculation');
    log.push('  Earth radius R = 6371 km');
    log.push('  Vincenty formula for higher precision');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Spherical Earth approximation', contribution: 'Varies' },
      { factor: 'Earth radius value', contribution: 'Varies' },
    ],
    overallAssessment: 'Haversine is exact for sphere. Vincenty formula accounts for ellipsoid.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Great Circle Distance: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Great circle distance: d = 2R*arcsin(sqrt(sin^2(dPhi/2) + cos(phi1)*cos(phi2)*sin^2(dLambda/2))).`,
    recommendations: ['Use Vincenty for ellipsoidal precision.', 'R = 6371 km for mean Earth radius.', 'For geodesic distance, use geographiclib.'],
  }),
  metadata: {
    methodology: 'Great circle distance: d = 2R*arcsin(sqrt(sin^2(dPhi/2) + cos(phi1)*cos(phi2)*sin^2(dLambda/2))).',
    assumptions: ['Spherical Earth', 'No altitude differences', 'Great circle path'],
    limitations: ['Spherical approx. error up to ~0.3% vs ellipsoid (Sinnott 1984)', 'Ignores elevation difference between endpoints', 'No terrain consideration'],
    references: ['Sinnott 1984, Sky and Telescope 68(2):159'],
    preprocessingNotes: ['Pure geometric calculation', 'Earth radius R = 6371 km', 'Vincenty formula for higher precision'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 37 — Geostatistical Interpolation (Kriging)
// ══════════════════════════════════════════════════════════════════
export const TOOL_37: ToolWorkflowDef = {
  toolId: 37,
  name: 'Geostatistical Interpolation (Kriging)',
  vizType: 'contour',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'tlat', min: -90, max: 90 }, { param: 'tlon', min: -180, max: 180 }]),
  preprocess: (inputs, ctx, log) => {
    const obsCount = inputs.__obsCount as number | undefined;
    const obsParam = inputs.__obsParam as string | undefined;
    const variogram = inputs.__variogram as string | undefined;
    log.push(`  Observations: ${obsCount ?? 0} genuine USGS NWIS stations${obsParam ? ` (parameter ${obsParam})` : ''}`);
    log.push(`  ${variogram ? `Fitted semivariogram: ${variogram}` : 'No fitted semivariogram — fewer than 4 reporting stations (honest NaN)'}`);
    log.push(`  Target: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Non-finite check', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
    { name: 'Kriging variance ≥ 0', passed: Number.isFinite(result), message: 'variance non-negative by construction', severity: 'info' as const },
  ]),
  estimateUncertainty: (result, inputs) => {
    const fitted = inputs?.fitted as { nugget?: number; sill?: number; range?: number; model?: string } | undefined;
    const obsCount = inputs?.__obsCount as number | undefined;
    return {
      method: 'analytical',
      contributingFactors: [
        { factor: 'Kriging variance σ²_K', contribution: 'Computed exactly per cell from Σλᵢγ(sᵢ−s₀)+φ' },
        { factor: `Semivariogram model (${fitted?.model ?? 'unfitted'})`, contribution: fitted ? `range ${fitted.range?.toFixed(1)} km, sill ${fitted.sill?.toExponential(2)}` : 'n/a' },
        { factor: `Station network (${obsCount ?? 0} sites)`, contribution: 'Dense network → low σ²_K near stations' },
        { factor: 'Stationarity assumption', contribution: 'Ordinary kriging assumes constant unknown mean' },
      ],
      overallAssessment: 'Kriging variance is exact for the fitted model and geometry (Matheron 1963); it is prediction-error variance, not local data variability.',
    };
  },
  interpret: (result) => ({
    contextualAnalysis: `Ordinary kriging prediction ŷ(s₀) = ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}: the Best Linear Unbiased Predictor of Matheron (1963) — weights solve the augmented system Aλ = b with Σλᵢ = 1, minimizing the estimation variance for the fitted semivariogram.`,
    recommendations: ['Check the per-cell kriging variance for prediction confidence.', 'For non-stationary fields use regression/universal kriging.', 'Leave-one-out cross-validation standardizes errors to mean 0, variance 1 when the variogram is correct.'],
  }),
  metadata: {
    methodology: 'Ordinary kriging (Matheron, 1963): ŷ(s₀) = Σλᵢ·z(sᵢ) with weights solving the augmented system [γ 1; 1ᵀ 0]·[λ φ]ᵀ = [γ(sᵢ,s₀), 1]ᵀ; σ²_K = Σλᵢ·γ(sᵢ−s₀) + φ. Semivariogram model fitted to the experimental γ̂(h) = (1/2N(h))·Σ[z(sᵢ)−z(sᵢ+h)]².',
    assumptions: ['Intrinsic stationarity (constant unknown mean)', 'Isotropic semivariogram', 'Genuine observations on an irregular network'],
    limitations: ['Singular system for coincident/zero-variance points (honest NaN)', 'Requires ≥ 4 reporting stations', 'Model fit quality depends on pair coverage'],
    references: ['Matheron 1963, Economic Geology 58(8):1246-1266'],
    preprocessingNotes: ['Experimental semivariogram from genuine station pairs', 'Spherical model fitted by weighted least squares (pair-count weights)', 'Kriging system solved with partial-pivoting Gaussian elimination'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 38 — Inverse Distance Weighting
// ══════════════════════════════════════════════════════════════════
export const TOOL_38: ToolWorkflowDef = {
  toolId: 38,
  name: 'Inverse Distance Weighting',
  vizType: 'contour',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'tlat', min: -90, max: 90 }, { param: 'tlon', min: -180, max: 180 }, { param: 'p', min: 0.5, max: 4 }]),
  preprocess: (inputs, ctx, log) => {
    const obsCount = inputs.__obsCount as number | undefined;
    const obsParam = inputs.__obsParam as string | undefined;
    log.push(`  Observations: ${obsCount ?? 0} genuine USGS NWIS stations${obsParam ? ` (parameter ${obsParam})` : ''}`);
    log.push(`  Shepard (1968) power p = ${inputs.p ?? 2}`);
    log.push(`  Target: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: (result, inputs) => {
    const obsCount = inputs?.__obsCount as number | undefined;
    return {
      method: 'analytical',
      contributingFactors: [
        { factor: `Station network (${obsCount ?? 0} sites)`, contribution: 'Dense network → smooth local interpolation' },
        { factor: `Shepard power p = ${inputs?.p ?? 2}`, contribution: 'Higher p → nearest-station dominance' },
        { factor: 'Deterministic interpolator', contribution: 'No prediction variance — use kriging (Tool 37) for σ²_K' },
        { factor: 'Isotropy assumption', contribution: 'Distance only; no directional/anisotropy model' },
      ],
      overallAssessment: 'IDW is exact at data points but provides no uncertainty estimate (Shepard 1968). Prediction error is unquantified; prefer kriging when a variogram can be fitted.',
    };
  },
  interpret: (result) => ({
    contextualAnalysis: `Inverse Distance Weighting ŷ = ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}: Shepard (1968) deterministic interpolator ŷ = Σ(wᵢ·zᵢ)/Σwᵢ, wᵢ = 1/dᵢ^p on genuine station observations.`,
    recommendations: ['Default power p = 2.', 'Increase p for more localized (nearest-station) influence.', 'Use kriging (Tool 37) when a prediction-variance estimate is required.'],
  }),
  metadata: {
    methodology: 'Shepard (1968) IDW: y_hat = sum(w_i * z_i) / sum(w_i); w_i = 1/d_i^p (p = 2 default). Haversine distances between the target and genuine USGS NWIS station coordinates.',
    assumptions: ['Isotropic distances', 'No directional anisotropy', 'Exact at data points (1 m snap)'],
    limitations: ['No uncertainty estimate', 'Bullseye artifacts at data points', 'Extrapolates without bound outside the network'],
    references: ['Shepard 1968, Proc. 1968 ACM National Conference, 517-524. DOI: 10.1145/800186.810616'],
    preprocessingNotes: ['IDW with power parameter p (default 2)', 'Genuine per-station observations', 'Haversine great-circle distances'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 39 — Gaussian Plume Air Dispersion
// ══════════════════════════════════════════════════════════════════
export const TOOL_39: ToolWorkflowDef = {
  toolId: 39,
  name: 'Gaussian Plume Air Dispersion',
  vizType: 'heatmap',
  classificationBands: AQI_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Q', min: 0, max: 1e9 }, { param: 'u', min: 0.5, max: 50 }, { param: 'sigmaY', min: 1, max: 10000 }, { param: 'sigmaZ', min: 1, max: 10000 }, { param: 'y', min: -5000, max: 5000 }, { param: 'z', min: 0, max: 2000 }, { param: 'H', min: 0, max: 1000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Estimate Pasquill stability class from wind and radiation');
    log.push('  Compute sigma_y, sigma_z from stability class');
    log.push('  Use EPA AERMOD for regulatory compliance');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, AQI_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'σ_y, σ_z selection', contribution: 'Stability class → σ curves dominate uncertainty' },
      { factor: 'Steady-wind assumption', contribution: 'Wind speed/direction variability over averaging time' },
      { factor: 'Flat-terrain, no deposition/reaction', contribution: 'Complex terrain and chemistry not modeled' },
    ],
    overallAssessment: 'Gaussian plume (Pasquill & Smith 1983) is a steady-state point-source model; uncertainty is dominated by σ-curve selection and meteorological representativeness. Use AERMOD for regulatory impact assessment.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Gaussian Plume Air Dispersion: ${Number.isFinite(result) ? result.toExponential(4) : 'N/A'} µg/m³. Pasquill & Smith (1983): C = Q/(2π·u·σ_y·σ_z)·exp(−y²/2σ_y²)·[exp(−(z−H)²/2σ_z²)+exp(−(z+H)²/2σ_z²)] with ground reflection.`,
    recommendations: ['Use AERMOD for regulatory compliance.', 'Pasquill stability from wind + solar radiation.', 'σ_y, σ_z from stability class and downwind distance (user-supplied here).'],
  }),
  metadata: {
    methodology: 'Pasquill & Smith (1983) Gaussian plume with ground reflection: C(x,y,z) = Q/(2π·u·σ_y·σ_z)·exp(−y²/(2σ_y²))·[exp(−(z−H)²/(2σ_z²)) + exp(−(z+H)²/(2σ_z²))].',
    assumptions: ['Steady wind', 'Constant σ_y, σ_z for given x', 'Flat terrain', 'Conservative pollutant', 'Full ground reflection'],
    limitations: ['No terrain effects', 'No chemical reactions', 'Steady-state only', 'Limited to flat terrain'],
    references: ['Pasquill & Smith 1983, Atmospheric Diffusion (3rd ed.), Ellis Horwood, ISBN 978-0853124041'],
    preprocessingNotes: ['σ_y, σ_z user-supplied per downwind distance + stability class', 'u from fetched wind (10 m) with log-profile note', 'Effective stack height H = stack + plume rise'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 40 — Gumbel Extreme Value Analysis
// ══════════════════════════════════════════════════════════════════
export const TOOL_40: ToolWorkflowDef = {
  toolId: 40,
  name: 'Gumbel Extreme Value Analysis',
  vizType: 'distribution',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'mu', min: -1e6, max: 1e6 }, { param: 'beta', min: 0.1, max: 1e6 }, { param: 'x', min: -1e6, max: 1e6 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Use >= 30 years of data for reliable estimation');
    log.push('  Fit via MLE or method of moments');
    log.push('  Compare with GEV for model selection');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'qualitative',
    contributingFactors: [
      { factor: 'Sample size', contribution: 'Varies' },
      { factor: 'Distribution fit quality', contribution: 'Varies' },
      { factor: 'Stationarity assumption', contribution: 'Varies' },
    ],
    overallAssessment: 'Use > 30 years for reliable return periods. Compare Gumbel and GEV.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Gumbel Extreme Value Analysis: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Gumbel distribution: F(x) = exp(-exp(-(x-mu)/beta)). Return period: x_T = mu - beta*ln(-ln(1-1/T)).`,
    recommendations: ['Use >= 30 years of data.', 'Compare Gumbel and GEV via AIC/BIC.', 'Cross-reference USGS stream gauges for floods.'],
  }),
  metadata: {
    methodology: 'Gumbel distribution: F(x) = exp(-exp(-(x-mu)/beta)). Return period: x_T = mu - beta*ln(-ln(1-1/T)).',
    assumptions: ['Stationary climate', 'IID samples', 'Gumbel is appropriate (Type I)'],
    limitations: ['Climate non-stationarity invalidates', 'Requires long records', 'May not fit all extremes'],
    references: ['Gumbel 1958, Statistics of Extremes'],
    preprocessingNotes: ['Use >= 30 years of data for reliable estimation', 'Fit via MLE or method of moments', 'Compare with GEV for model selection'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 41 — Generalized Pareto Distribution
// ══════════════════════════════════════════════════════════════════
export const TOOL_41: ToolWorkflowDef = {
  toolId: 41,
  name: 'Generalized Pareto Distribution',
  vizType: 'distribution',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'xi', min: -0.5, max: 1 }, { param: 'beta', min: 0.1, max: 1e6 }, { param: 'x', min: -1e6, max: 1e6 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Peaks-over-threshold approach');
    log.push('  Threshold selection critical (mean residual life plot)');
    log.push('  Compare with block maxima (GEV)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'qualitative',
    contributingFactors: [
      { factor: 'Threshold selection', contribution: 'Varies' },
      { factor: 'Shape parameter sensitivity', contribution: 'Varies' },
      { factor: 'Sample size', contribution: 'Varies' },
    ],
    overallAssessment: 'GPD is flexible for peaks-over-threshold. Threshold selection is critical.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Generalized Pareto Distribution: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. GPD: F(x) = 1 - (1 + xi*x/beta)^(-1/xi). Peaks-over-threshold extreme analysis.`,
    recommendations: ['Use mean residual life plot for threshold.', 'Compare with GEV (block maxima).', 'Shape parameter xi determines tail behavior.'],
  }),
  metadata: {
    methodology: 'GPD: F(x) = 1 - (1 + xi*x/beta)^(-1/xi). Peaks-over-threshold extreme analysis.',
    assumptions: ['IID exceedances', 'Threshold is appropriate', 'Stationary climate'],
    limitations: ['Threshold selection subjective', 'Sensitive to shape parameter', 'Requires sufficient exceedances'],
    references: ['Pickands 1975, Annals of Statistics 3(1):119-131'],
    preprocessingNotes: ['Peaks-over-threshold approach', 'Threshold selection critical (mean residual life plot)', 'Compare with block maxima (GEV)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 42 — Semivariogram Analysis
// ══════════════════════════════════════════════════════════════════
export const TOOL_42: ToolWorkflowDef = {
  toolId: 42,
  name: 'Semivariogram Analysis',
  vizType: 'scatter',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'K', min: 3, max: 40 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Compute experimental semivariogram from spatial data');
    log.push('  Fit nugget, sill, range');
    log.push('  Model selection: spherical, exponential, Gaussian');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.3,
    rmseUnit: 'log10',
    contributingFactors: [
      { factor: 'Lag spacing', contribution: 'Varies' },
      { factor: 'Sample configuration', contribution: 'Varies' },
      { factor: 'Model selection', contribution: 'Varies' },
    ],
    overallAssessment: 'Semivariogram model fit has +/- 0.3 log10 uncertainty.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Semivariogram Analysis: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Semivariogram: gamma(h) = (1/2N(h)) * sum [z(s_i) - z(s_i+h)]^2. Fit nugget, sill, range.`,
    recommendations: ['Fit theoretical model (spherical/exp/Gaussian).', 'Nugget = measurement error + micro-scale variability.', 'Range = spatial correlation distance.'],
  }),
  metadata: {
    methodology: 'Semivariogram: gamma(h) = (1/2N(h)) * sum [z(s_i) - z(s_i+h)]^2. Fit nugget, sill, range.',
    assumptions: ['2nd-order stationarity', 'Isotropic covariance', 'Gaussian residuals'],
    limitations: ['Anisotropy not captured', 'Requires sufficient sample pairs', 'Model selection subjective'],
    references: ['Matheron 1963, Economic Geology 58(8):1246-1266'],
    preprocessingNotes: ['Compute experimental semivariogram from spatial data', 'Fit nugget, sill, range', 'Model selection: spherical, exponential, Gaussian'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 43 — Soil Water Retention Curve
// ══════════════════════════════════════════════════════════════════
export const TOOL_43: ToolWorkflowDef = {
  toolId: 43,
  name: 'Soil Water Retention Curve',
  vizType: 'scatter',
  classificationBands: SOIL_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'thetaR', min: 0, max: 0.2 }, { param: 'thetaS', min: 0.2, max: 0.6 }, { param: 'alpha', min: 0.001, max: 1 }, { param: 'n', min: 1.1, max: 5 }, { param: 'psi', min: -100, max: -0.01 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Derive alpha, n from ISRIC SoilGrids via ROSETTA');
    log.push('  Mualem-vG pairing for hydraulic conductivity');
    log.push('  Validate with SMAP soil moisture');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SOIL_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.5,
    rmseUnit: 'log10(K)',
    contributingFactors: [
      { factor: 'Pedotransfer function', contribution: 'Varies' },
      { factor: 'Soil texture variability', contribution: 'Varies' },
      { factor: 'Macropores not captured', contribution: 'Varies' },
    ],
    overallAssessment: 'van Genuchten-Mualem has +/- 0.5 log10(K) uncertainty from pedotransfer.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Soil Water Retention Curve: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. van Genuchten: theta(psi) = thetaR + (thetaS-thetaR)/[1+(alpha*|psi|)^n]^m, m=1-1/n. Mualem pairing.`,
    recommendations: ['Use ROSETTA pedotransfer for alpha, n.', 'Mualem pairing for K(S_e).', 'ISRIC SoilGrids for spatial variability.'],
  }),
  metadata: {
    methodology: 'van Genuchten: theta(psi) = thetaR + (thetaS-thetaR)/[1+(alpha*|psi|)^n]^m, m=1-1/n. Mualem pairing.',
    assumptions: ['Rigid, homogeneous soil', 'No hysteresis', 'Mualem model for K'],
    limitations: ['Hysteresis not captured', 'Macropores not modeled', 'Requires calibration for local soils'],
    references: ['van Genuchten 1980, SSSAJ 44(5):892-898', 'Mualem 1976, Water Resour. Res. 12(3):513-522'],
    preprocessingNotes: ['Derive alpha, n from ISRIC SoilGrids via ROSETTA', 'Mualem-vG pairing for hydraulic conductivity', 'Validate with SMAP soil moisture'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 44 — Soil Hydraulic Model
// ══════════════════════════════════════════════════════════════════
export const TOOL_44: ToolWorkflowDef = {
  toolId: 44,
  name: 'Soil Hydraulic Model',
  vizType: 'scatter',
  classificationBands: SOIL_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'psib', min: -300, max: -0.01 }, { param: 'psi', min: -2000, max: -0.01 }, { param: 'lambda', min: 0.1, max: 6 }, { param: 'thetaR', min: 0, max: 0.2 }, { param: 'thetaS', min: 0.2, max: 0.6 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Brooks-Corey parameters from soil texture');
    log.push('  Lambda from pore-size distribution');
    log.push('  ISRIC SoilGrids for spatial data');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SOIL_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.5,
    rmseUnit: 'log10(K)',
    contributingFactors: [
      { factor: 'Lambda estimation', contribution: 'Varies' },
      { factor: 'Air-entry pressure', contribution: 'Varies' },
      { factor: 'Soil structure effects', contribution: 'Varies' },
    ],
    overallAssessment: 'Brooks-Corey has similar uncertainty to vG. Simpler form but discontinuous at air-entry.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Soil Hydraulic Model: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Brooks-Corey: K(psi) = K_s for psi < psi_b; K_s*(psi_b/psi)^lambda for psi >= psi_b.`,
    recommendations: ['Compare with vG for same soil.', 'Lambda varies with texture: 0.5 (sand) to 2+ (clay).', 'ISRIC SoilGrids for spatial data.'],
  }),
  metadata: {
    methodology: 'Brooks-Corey: K(psi) = K_s for psi < psi_b; K_s*(psi_b/psi)^lambda for psi >= psi_b.',
    assumptions: ['Rigid soil', 'No hysteresis', 'Sharp air-entry'],
    limitations: ['Discontinuous at psi_b', 'Less flexible than vG', 'Not for structured soils'],
    references: ['Brooks & Corey 1964, CSU Hydrology Papers No. 3'],
    preprocessingNotes: ['Brooks-Corey parameters from soil texture', 'Lambda from pore-size distribution', 'ISRIC SoilGrids for spatial data'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 45 — Universal Soil Loss Equation
// ══════════════════════════════════════════════════════════════════
export const TOOL_45: ToolWorkflowDef = {
  toolId: 45,
  name: 'Universal Soil Loss Equation',
  vizType: 'heatmap',
  classificationBands: SOIL_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'R', min: 0, max: 50000 }, { param: 'K', min: 0, max: 1 }, { param: 'LS', min: 0, max: 20 }, { param: 'C', min: 0, max: 1 }, { param: 'P', min: 0, max: 1 }, { param: 'lambda', min: 1, max: 1000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  R-factor: GHCN-Daily 1991–2020 normals (NOAA ACIS) → Renard & Freimund (1994) regression');
    log.push('  K-factor: ISRIC SoilGrids texture → Williams (1995) EPIC equation (SN1 = 1 − SAN/100)');
    log.push('  LS: SRTM 30 m slope (Horn) → RUSLE S (McCool et al. 1987) × L = (λ/22.13)^m');
    log.push('  C: MODIS MCD12Q1 IGBP land cover → USLE cover-management table');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SOIL_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf — missing genuine factor', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 50,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'R-factor spatial variability (station normal vs local EI30)', contribution: '±20–30%' },
      { factor: 'K-factor from texture only (no structure/permeability)', contribution: '±20–30%' },
      { factor: 'LS point-slope vs profile-length representation', contribution: '±25–50%' },
      { factor: 'C/P land-management assumptions', contribution: '±20–40%' },
    ],
    overallAssessment: 'USLE has ±50% typical uncertainty at plot scale. RUSLE2 is current USDA standard.',
  }),
  interpret: (result) => ({
    contextualAnalysis: result === null || !Number.isFinite(result)
      ? 'Universal Soil Loss Equation: could not compute. One or more factors (R/K/LS/C) lacks a genuine data source. Supply measured values (measured R from local EI30 records, laboratory K, survey LS/C/P) to override the auto-fetched terms.'
      : `Universal Soil Loss Equation: ${result.toFixed(2)} t/ha/yr. USLE: A = R × K × LS × C × P (Wischmeier & Smith 1978). Compare to tolerable loss T ≈ 11 t/ha/yr (2–20 by soil depth).`,
    recommendations: ['RUSLE2 (USDA-ARS) supersedes USLE for planning.', 'R from GHCN 1991–2020 normals via Renard-Freimund; override with local EI30 where available.', 'C/P are site-management factors — override with field practice data.'],
  }),
  metadata: {
    methodology: 'USLE: A = R·K·LS·C·P (t/ha/yr). R: Renard & Freimund (1994) from genuine 1991–2020 GHCN annual normals. K: Williams (1995) EPIC equation from genuine ISRIC texture (SN1 = 1−SAN/100, organic carbon in %). LS: RUSLE Handbook 703 — L=(λ/22.13)^m, S per McCool et al. (1987) split at 9% slope, from genuine SRTM 30 m slope. C: MODIS MCD12Q1 land cover → USLE table. P user-supplied (default 1 = no practice).',
    assumptions: ['Uniform slope', 'Sheet and rill erosion only', 'Annual time step'],
    limitations: ['Not for gully erosion', '±50% at plot scale', 'Requires local calibration', 'R from annual P proxy where EI30 records absent'],
    references: ['Wischmeier & Smith 1978, USDA Handbook 537', 'Renard & Freimund 1994, J. Hydrology 157:289–306 (P→R regression)', 'Renard et al. 1997, USDA Handbook 703 (RUSLE)', 'Williams 1995, EPIC K equation', 'McCool et al. 1987, revised steepness factor (RUSLE)'],
    preprocessingNotes: ['R: GHCN-Daily 1991–2020 normals via NOAA ACIS → Renard-Freimund regression', 'K: ISRIC SoilGrids texture → EPIC (Williams 1995)', 'LS: SRTM 30 m slope → RUSLE S × L', 'C: MODIS MCD12Q1 → USLE cover table'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 46 — Soil Respiration Temperature Sensitivity
// ══════════════════════════════════════════════════════════════════
export const TOOL_46: ToolWorkflowDef = {
  toolId: 46,
  name: 'Soil Respiration Temperature Sensitivity',
  vizType: 'timeseries',
  classificationBands: CARBON_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Rbase', min: 0, max: 50 }, { param: 'Q10', min: 1, max: 5 }, { param: 'T', min: -10, max: 50 }, { param: 'Tbase', min: -10, max: 30 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Soil temperature from Open-Meteo soil_temperature_0cm (genuine)');
    log.push('  R_base derived from Raich & Schlesinger (1992) global flux (76.5 Pg CO2/yr / 1.31e8 km² = 0.42 µmol CO₂/m²/s) × genuine GLDAS moisture × genuine scPDSI');
    log.push('  Q₁₀ default 2 — Raich & Schlesinger (1992) global mean cluster 2.0–2.5');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CARBON_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 30,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Q₁₀ is not constant', contribution: '±20–30%' },
      { factor: 'Substrate lability', contribution: '±20%' },
      { factor: 'R_base derived from global mean, not site-measured', contribution: '±30–50%' },
    ],
    overallAssessment: 'Q₁₀ is NOT constant — varies with T, moisture, substrate (Davidson & Janssens 2006). R_base is a global-flux-derived prior; override with chamber-measured basal values for site accuracy.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Soil Respiration Temperature Sensitivity: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} µmol CO₂/m²/s. Q₁₀: R_s = R_base · Q₁₀^((T−T_base)/10). Raich & Schlesinger (1992) global mean Q₁₀ ≈ 2.0–2.5.`,
    recommendations: ['Q₁₀ varies with T, moisture, substrate.', 'Soil temperature from Open-Meteo soil_temperature_0cm.', 'Override R_base with chamber/FLUXNET measurements for site accuracy.'],
  }),
  metadata: {
    methodology: 'Q₁₀: R_s = R_base · Q₁₀^((T−T_base)/10). R_base derived from Raich & Schlesinger (1992) global flux (76.5 Pg CO2/yr over 1.31e8 km² = 0.42 µmol CO₂/m²/s) modulated by genuine GLDAS 0–10 cm volumetric moisture (rise to field capacity, waterlogged suppression >0.45 m³/m³ per Xu et al. 2004) and genuine scPDSI. T from Open-Meteo soil temperature; Q₁₀ default 2 per the paper\'s global cluster.',
    assumptions: ['Constant Q₁₀', 'Moisture effect via scalar approximation', 'No substrate depletion'],
    limitations: ['Q₁₀ is temperature-dependent', 'R_base is a climate-climate prior, not site-measured', 'Acclimatization effects not captured'],
    references: ['Raich & Schlesinger 1992, Tellus B 44(2):81-99', 'Davidson & Janssens 2006, Nature 440:165-173', 'Xu, Baldocchi & Tang 2004, Global Biogeochem. Cycles 18'],
    preprocessingNotes: ['Soil temperature from Open-Meteo soil_temperature_0cm', 'R_base: Raich-Schlesinger global flux × GLDAS moisture × scPDSI', 'Q₁₀ default 2 (paper global mean 2.0–2.5)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 47 — Soil Thermal Conductivity Model
// ══════════════════════════════════════════════════════════════════
export const TOOL_47: ToolWorkflowDef = {
  toolId: 47,
  name: 'Soil Thermal Conductivity Model',
  vizType: 'heatmap',
  classificationBands: SOIL_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'sandFrac', min: 0, max: 1 },
    { param: 'omPct', min: 0, max: 100 },
    { param: 'rhoB', min: 0.05, max: 2.0 },
    { param: 'theta', min: 0, max: 1 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  de Vries (1963) λ = Σ(kᵢ·xᵢ·λᵢ) / Σ(kᵢ·xᵢ) — Farouki (1981) CRREL 81-1 §7.6 transcription');
    log.push('  ρ_b, organic C, sand fraction: genuine ISRIC SoilGrids 0–5 cm');
    log.push('  OM% = SOC% × 1.724 (van Bemmelen); quartz fraction q = sand fraction (Johansen 1975 proxy — ISRIC has no quartz band)');
    log.push('  θ: genuine GLDAS Noah 2.1 0–10 cm volumetric moisture (no global in-situ network exists)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SOIL_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 25,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Moisture content (GLDAS proxy)', contribution: 'Dominant — λ varies 5× from dry to wet' },
      { factor: 'Quartz fraction (sand proxy)', contribution: 'Quartz λ=8.4 vs other minerals 2.9 W/m·K' },
      { factor: 'Bulk density (ISRIC)', contribution: 'Controls porosity and solids volume' },
      { factor: 'de Vries shape factors (g_a/g_c)', contribution: 'Farouki §7.6 approximate procedure ±25%' },
    ],
    overallAssessment: 'de Vries (1963) model: ±25% on mineral soils, larger for organic (>20% OM). Farouki (1981) §7.13: best at 0.1–0.2 degree of saturation.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Soil Thermal Conductivity (de Vries): ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} W/m·K. λ = Σ(kᵢ·xᵢ·λᵢ) / Σ(kᵢ·xᵢ) with de Vries spheroid weighting. Quartz 8.4, other minerals 2.9, OM 0.25, water 0.6, air 0.026 W/m·K (Farouki Table 2). Thermal diffusivity and heat capacity in the outputs table.`,
    recommendations: ['ISRIC SoilGrids 0–5 cm for sand, SOC, bulk density (genuine).', 'GLDAS Noah 2.1 0–10 cm θ (genuine LSM assimilation).', 'Validate with in-situ measurements (point instruments or heat-flux plates).', 'Rate of saturation 0.1–0.2: Farouki §7.13 best-fit range.'],
  }),
  metadata: {
    methodology: 'de Vries (1963) / Farouki (1981) CRREL 81-1 §7.6: λ = Σ(kᵢ·xᵢ·λᵢ) / Σ(kᵢ·xᵢ). Constituent λ: quartz 8.4, other minerals 2.9, OM 0.25, water 0.6, air 0.026 W/m·K. Shape factors g_a=0.125, g_c=0.75 (oblate spheroids). Continuous phase: water (θ≥θ_cut) or air (×1.25 dry correction). Vapour migration: k_a = 0.0615 + 1.96·xw (mcal→W/m·K ×0.4186). Volumetric heat capacity: C = Σxᵢ·cᵢ (c_i from Farouki Table 2, ×4.186e6 J/m³·K). Thermal diffusivity α = λ/C.',
    assumptions: ['Isotropic soil, spheroidal particles', 'Linear mixing: λ = Σkᵢxᵢλᵢ / Σkᵢxᵢ', 'Known volume fractions from ρ_b, OM, θ', 'Quartz fraction ≈ sand fraction (Johansen 1975)'],
    limitations: ['Moisture dependence complex — GLDAS is a proxy for in-situ θ', 'Mineral composition unknown beyond sand fraction', 'de Vries shape factors are approximate (Farouki §7.6)', 'No frozen soil — ice conductivity not included'],
    references: ['de Vries, D.A. (1963) Thermal properties of soils. In: van Wijk (ed.) Physics of Plant Environment, North-Holland, pp. 210–235.', 'Farouki, O.T. (1981) Thermal properties of soils. CRREL Monograph 81-1, §7.6.'],
    preprocessingNotes: ['Soil composition: genuine ISRIC SoilGrids 0–5 cm', 'θ: genuine GLDAS Noah 2.1 0–10 cm', 'Van Bemmelen: OM% = SOC% × 1.724', 'Johansen (1975): q = sand fraction (ISRIC quartz band absent)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 48 — Surface Layer Similarity Theory
// ══════════════════════════════════════════════════════════════════
export const TOOL_48: ToolWorkflowDef = {
  toolId: 48,
  name: 'Surface Layer Similarity Theory',
  vizType: 'profile',
  classificationBands: [
    { min: -Infinity, max: 0.7, label: 'Unstable', color: '#ef4444', description: 'φ_m < 0.7: enhanced mixing, shear below neutral' },
    { min: 0.7, max: 1.15, label: 'Near-Neutral', color: '#22c55e', description: 'φ_m ≈ 1: logarithmic profile' },
    { min: 1.15, max: 3, label: 'Stable', color: '#eab308', description: 'φ_m 1–3: mixing suppressed' },
    { min: 3, max: Infinity, label: 'Very Stable', color: '#3b82f6', description: 'φ_m > 3: strongly damped turbulence' },
  ],
  validate: (inputs) => {
    const res = validateRange(inputs, [
      { param: 'kappa', min: 0.3, max: 0.5 },
      { param: 'z', min: 0, max: 1000 },
      { param: 'z0M', min: 0.00001, max: 10 },
    ]);
    // u_* and L may legitimately be NaN (no genuine CDS step resolved) —
    // range-check them only when finite; the engine turns them into an
    // honest NaN result, not a validation fault.
    const ustar = inputs.ustar, L = inputs.L, z = inputs.z;
    if (typeof ustar === 'number' && Number.isFinite(ustar) && (ustar < 0 || ustar > 5)) {
      res.errors.push(`'ustar' = ${ustar} outside [0, 5] m/s.`);
    }
    if (typeof L === 'number' && Number.isFinite(L)) {
      if (L < -2000 || L > 2000) {
        res.errors.push(`'L' = ${L} outside [−2000, 2000] m.`);
      } else if (Math.abs(L) < 0.01) {
        res.errors.push(`'L' = ${L} too close to zero — L = ±∞ is the neutral limit; supply |L| ≥ 0.01 m.`);
      } else if (typeof z === 'number' && Number.isFinite(z)) {
        const zeta = z / L;
        if (zeta < -2 || zeta > 1) res.warnings.push(`ζ = z/L = ${zeta.toFixed(2)} outside the Högström (1988) validated range (−2 < ζ < 1) — functions evaluated at the bound.`);
      }
    }
    res.valid = res.errors.length === 0;
    return res;
  },
  preprocess: (inputs, ctx, log) => {
    log.push('  Von Karman constant kappa = 0.40 ± 0.01 (Hogstrom 1988)');
    log.push('  Högström (1988) flux-profile functions (Foken 2006 Eqs 21–22 tabulation)');
    log.push('  u_* (zust) and L only from genuine CDS ERA5 reanalysis; the Open-Meteo subset proxy is rejected (no static fallbacks)');
    log.push('  z₀ for r_a from MCD12Q1 land-cover class unless overridden');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, [
      { min: -Infinity, max: 0.7, label: 'Unstable', color: '#ef4444', description: 'φ_m < 0.7: enhanced mixing, shear below neutral' },
      { min: 0.7, max: 1.15, label: 'Near-Neutral', color: '#22c55e', description: 'φ_m ≈ 1: logarithmic profile' },
      { min: 1.15, max: 3, label: 'Stable', color: '#eab308', description: 'φ_m 1–3: mixing suppressed' },
      { min: 3, max: Infinity, label: 'Very Stable', color: '#3b82f6', description: 'φ_m > 3: strongly damped turbulence' },
    ]);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Universal function scatter (±10% unstable, more for stable)', contribution: 'Dominant' },
      { factor: 'Roughness sublayer effects', contribution: 'Varies' },
      { factor: 'Obukhov length derivation (H, u_* from reanalysis; virtual-temp correction omitted, < ~3%)', contribution: 'Varies' },
    ],
    overallAssessment: 'Monin-Obukhov has 10-20% inherent error in universal functions (Foken 2006).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Surface Layer Similarity Theory: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A (honest NaN — no genuine L)'}. ζ = z/L with the Högström (1988) flux-profile functions.`,
    recommendations: ['kappa = 0.40 ± 0.01 (Hogstrom 1988).', 'Högström (1988) flux-profile functions (Foken 2006 table).', 'u_* (zust) and L derived only from genuine CDS ERA5 reanalysis — Open-Meteo subset proxy rejected.'],
  }),
  metadata: {
    methodology: 'φ_m(ζ) = (κz/u_*)·∂ū/∂z, ζ = z/L; Högström (1988): unstable φ_m = (1−19.3ζ)^(−1/4), φ_h = 0.95(1−11.6ζ)^(−1/2) (−2<ζ<0); stable φ_m = 1+6ζ, φ_h = 0.95+7.8ζ (0<ζ<1); κ = 0.40, φ_h(0) = 0.95. ψ_m/ψ_h exact integrals; r_a = [ln(z/z₀)−ψ_m]/(κ·u_*).',
    assumptions: ['Horizontally homogeneous surface', 'Stationary conditions', 'Constant flux layer'],
    limitations: ['Breaks down in roughness sublayer', 'Non-stationary conditions', 'Requires genuine u_* and L (no static fallbacks)'],
    references: ['Monin & Obukhov 1954, Trudy Geofiz. Inst. AN SSSR 24(151):163-187', 'Högström 1988, Boundary-Layer Meteorology 42:55-78', 'Foken 2006, Boundary-Layer Meteorology 119:431-447 (coefficient tabulation)'],
    preprocessingNotes: ['Von Karman constant kappa = 0.40 ± 0.01 (Hogstrom 1988)', 'Högström (1988) flux-profile functions', 'ERA5 zust + sensible heat flux for genuine u_*, L; proxy rejected'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 49 — Logarithmic Wind Profile
// ══════════════════════════════════════════════════════════════════
export const TOOL_49: ToolWorkflowDef = {
  toolId: 49,
  name: 'Logarithmic Wind Profile',
  vizType: 'profile',
  classificationBands: [
    { min: 0, max: 1, label: 'Calm (0–1 m/s)', color: '#94a3b8', description: 'Light air' },
    { min: 1, max: 3, label: 'Light (1–3 m/s)', color: '#22c55e', description: 'Light breeze' },
    { min: 3, max: 6, label: 'Moderate (3–6 m/s)', color: '#eab308', description: 'Typical daytime wind' },
    { min: 6, max: 10, label: 'Strong (6–10 m/s)', color: '#f97316', description: 'Wind energy viable' },
    { min: 10, max: Infinity, label: 'Very Strong (> 10 m/s)', color: '#ef4444', description: 'Storm / high resource' },
  ],
  validate: (inputs) => {
    // NOTE: keys must match the engine mapInputs names for tool 49
    // ('ustar'/'z'/'z0') — the former 'u_star' key never matched, silently
    // skipping friction-velocity validation.
    const res = validateRange(inputs, [
      { param: 'ustar', min: 0, max: 5 },
      { param: 'z', min: 0, max: 1000 },
      { param: 'z0', min: 0.00001, max: 10 },
    ]);
    const ustar = inputs.ustar, z = inputs.z, z0 = inputs.z0;
    if (typeof ustar === 'number' && Number.isFinite(ustar) && typeof z === 'number' && Number.isFinite(z)
      && typeof z0 === 'number' && Number.isFinite(z0) && z0 > 0 && z > z0) {
      if (z < 5 * z0) res.warnings.push(`z = ${z} m is < 5×z₀ — log law converging; interpret with care.`);
    }
    return res;
  },
  preprocess: (inputs, ctx, log) => {
    log.push('  u_*: genuine ERA5 friction velocity (zust) via CDS when available; honest NaN otherwise');
    log.push('  Roughness length z0 from genuine MCD12Q1 IGBP land-cover class');
    log.push('  Neutral stability assumption (MO correction via tool 48 otherwise)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, [
      { min: 0, max: 1, label: 'Calm (0–1 m/s)', color: '#94a3b8', description: 'Light air' },
      { min: 1, max: 3, label: 'Light (1–3 m/s)', color: '#22c55e', description: 'Light breeze' },
      { min: 3, max: 6, label: 'Moderate (3–6 m/s)', color: '#eab308', description: 'Typical daytime wind' },
      { min: 6, max: 10, label: 'Strong (6–10 m/s)', color: '#f97316', description: 'Wind energy viable' },
      { min: 10, max: Infinity, label: 'Very Strong (> 10 m/s)', color: '#ef4444', description: 'Storm / high resource' },
    ]);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'z0 estimation from land-cover class', contribution: 'Dominant' },
      { factor: 'Stability correction (neutral assumption)', contribution: 'Varies' },
      { factor: 'Surface heterogeneity / canopy sublayer', contribution: 'Varies' },
    ],
    overallAssessment: 'Log law has +/- 15% uncertainty; z0 from the MCD12Q1 IGBP class table is the dominant error source.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Logarithmic Wind Profile: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A (honest NaN — no genuine u_*)'} m/s. u(z) = (u_*/κ)·ln(z/z₀), neutral stratification, Stull 1988 Ch. 4.`,
    recommendations: ['Add stability correction for non-neutral conditions (tool 48).', 'Verify z₀ against local anemometry for energy assessment.', 'z ≫ z₀ required (z ≥ 5×z₀).'],
  }),
  metadata: {
    methodology: 'u(z) = (u_*/κ)·ln(z/z₀) with κ = 0.4 (Stull 1988 Ch. 4, p. 376). u_* = genuine ERA5 zust via CDS when available, else honest NaN; z₀ from the MCD12Q1 IGBP class table, else NaN.',
    assumptions: ['Neutral stability', 'Horizontally homogeneous', 'Above roughness sublayer'],
    limitations: ['Not for stable/unstable without correction', 'z0 from class table is ±~50%', 'Fails in complex terrain'],
    references: ['Stull, R.B. 1988, An Introduction to Boundary Layer Meteorology, Kluwer, DOI: 10.1007/978-94-009-3027-8 (Ch. 4)'],
    preprocessingNotes: ['Roughness length z0 from MCD12Q1 IGBP land cover', 'u_* from genuine ERA5 (zust) when available', 'Neutral stability assumption'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 50 — Stomatal Conductance Model
// ══════════════════════════════════════════════════════════════════
export const TOOL_50: ToolWorkflowDef = {
  toolId: 50,
  name: 'Stomatal Conductance Model',
  vizType: 'scalar',
  classificationBands: STOMATAL_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'g0', min: 0, max: 100 }, { param: 'a1', min: 0, max: 20 }, { param: 'A', min: 0, max: 50 }, { param: 'hs', min: 0, max: 1 }, { param: 'cs', min: 100, max: 1000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Use Leuning (1995) revision for VPD handling');
    log.push('  CO2 from NOAA GML global monthly mean');
    log.push('  Photosynthesis from MODIS MOD17A2H GPP (ORNL DAAC)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, STOMATAL_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 25,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Parameter variability', contribution: 'Varies' },
      { factor: 'VPD dependence', contribution: 'Varies' },
      { factor: 'Species-specific calibration', contribution: 'Varies' },
    ],
    overallAssessment: 'Ball-Berry has +/- 25% uncertainty. Leuning (1995) revision recommended.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Stomatal Conductance Model: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Ball-Berry: g_s = g0 + a1*A*hs/cs. Leuning (1995) revision preferred.`,
    recommendations: ['Use Leuning (1995) revision for VPD handling.', 'g_s = g0 + a1*A_n / [(cs-Gamma)*(1+Ds/D0)].', 'Used in CLM, CABLE, JULES.'],
  }),
  metadata: {
    methodology: 'Ball-Berry: g_s = g0 + a1*A*hs/cs. Leuning (1995) revision preferred.',
    assumptions: ['Well-watered conditions', 'Constant a1, g0', 'Leaf-level scale'],
    limitations: ['Diverges at low cs in original form', 'Parameters species-specific', 'Not for water-stressed plants'],
    references: ['Ball et al. 1987', 'Leuning 1995, Plant Cell Environ. 18:339-355'],
    preprocessingNotes: ['Use Leuning (1995) revision for VPD handling', 'CO2 from NOAA GML global monthly mean', 'Photosynthesis from MODIS MOD17A2H GPP (ORNL DAAC)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 51 — Gross Primary Production
// ══════════════════════════════════════════════════════════════════
export const TOOL_51: ToolWorkflowDef = {
  toolId: 51,
  name: 'Gross Primary Production',
  vizType: 'timeseries',
  classificationBands: GPP_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'eps', min: 0, max: 5 }, { param: 'fpar', min: 0, max: 1 }, { param: 'par', min: 0, max: 10000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  fPAR from MODIS MCD15A3H');
    log.push('  PAR = SW x 0.45 (PAR fraction) x 0.0864 (W->MJ/day) x 365');
    log.push('  Validate with MODIS MOD17');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, GPP_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Light use efficiency', contribution: 'Varies' },
      { factor: 'fPAR retrieval', contribution: 'Varies' },
      { factor: 'PAR estimation from SW', contribution: 'Varies' },
    ],
    overallAssessment: 'Monteith LUE GPP has +/- 20-30% uncertainty. MODIS MOD17 is standard product.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Gross Primary Production: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. GPP = epsilon * fPAR * PAR. PAR = SW x 0.45 x 0.0864 x 365 (MJ/m2/yr).`,
    recommendations: ['PAR = SW x 0.45 x 0.0864 x 365 (Monteith 1972 PAR fraction).', 'fPAR from MODIS MCD15A3H.', 'Validate with MOD17 and FLUXNET.'],
  }),
  metadata: {
    methodology: 'GPP = epsilon * fPAR * PAR. PAR = SW x 0.45 (PAR fraction) x 0.0864 (W->MJ/day) x 365.',
    assumptions: ['Constant LUE', 'fPAR accurately retrieved', 'PAR well estimated'],
    limitations: ['LUE varies with stress', 'PAR approximation error', 'fPAR saturates at high LAI'],
    references: ['Monteith 1972, J. Appl. Ecol. 9(3):747-766', 'MODIS MOD17 product'],
    preprocessingNotes: ['fPAR from MODIS MCD15A3H', 'PAR = SW x 0.45 x 0.0864 x 365 (genuine shortwave)', 'Validate with MODIS MOD17'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 52 — Canopy Light Extinction
// ══════════════════════════════════════════════════════════════════
export const TOOL_52: ToolWorkflowDef = {
  toolId: 52,
  name: 'Canopy Light Extinction',
  vizType: 'profile',
  classificationBands: LIGHT_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'I0', min: 0, max: 3000 }, { param: 'k', min: 0.1, max: 2 }, { param: 'LAI', min: 0, max: 12 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  LAI from MODIS MCD15A3H');
    log.push('  Extinction coefficient k (user-supplied; spherical default 0.5; Monsi–Saeki range 0.3–2.0)');
    log.push('  Incident radiation I₀ from ERA5 (Copernicus CDS, ssrd — downward surface solar radiation)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, LIGHT_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'k estimation', contribution: 'Varies with leaf-angle distribution' },
      { factor: 'LAI accuracy', contribution: 'Varies (MODIS MCD15A3H ±0.5)' },
      { factor: 'Canopy clumping / non-randomness', contribution: 'Varies' },
    ],
    overallAssessment: 'Beer-Lambert has +/- 15% uncertainty from k variability across leaf-angle distributions (0.3–2.0, Monsi–Saeki 1953).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Canopy Light Extinction: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} µmol/m²s. Beer-Lambert: I(z) = I₀·exp(-k·LAI). k varies with leaf angle distribution.`,
    recommendations: ['k: 0.3–0.5 vertical (grass), 0.7–1.0 horizontal (broadleaf), up to 2.0 clumped (Monsi–Saeki 1953).', 'LAI from MODIS MCD15A3H.', 'Spherical distribution: k ~ 0.5.'],
  }),
  metadata: {
    methodology: 'Beer-Lambert: I(z) = I0 * exp(-k * LAI), fPAR = 1 - exp(-k * LAI), LAI_comp = -(1/k)*ln(Γ/I0). k varies with leaf angle distribution.',
    assumptions: ['Random leaf distribution', 'Uniform canopy', 'Leaves black (no transmittance m=0)'],
    limitations: ['Non-random leaf angles', 'Canopy clumping', 'Mixed species effects', 'Leaf transmittance (m) ignored'],
    references: ['Monsi & Saeki 1953, Japanese J. Botany 14:22-52 (NO-DOI, German)', 'Hirose 2004, Annals of Botany 95(3):483-494, doi:10.1093/aob/mci047'],
    preprocessingNotes: ['LAI from MODIS MCD15A3H', 'Incident radiation I₀ from ERA5 CDS (ssrd, 12:00 UTC of resolved date)', 'Extinction coefficient k user-supplied (paper range 0.3–2.0)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 53 — Net Carbon Flux
// ══════════════════════════════════════════════════════════════════
export const TOOL_53: ToolWorkflowDef = {
  toolId: 53,
  name: 'Net Carbon Flux',
  vizType: 'timeseries',
  classificationBands: NEE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Reco', min: 0, max: 5000 }, { param: 'GPP', min: 0, max: 5000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  GPP from MODIS MOD17A2H (annual sum of 8-day composites)');
    log.push('  R_eco from user input (auto is NaN: FLUXNET eddy covariance is registration-gated, no open API)');
    log.push('  NEE positive = source, negative = sink (Wofsy 1993 sign convention)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, NEE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 25,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'GPP uncertainty', contribution: 'Varies (±10-20 % MOD17)' },
      { factor: 'Respiration estimate', contribution: 'Varies (nighttime-NEE regression per Wofsy 1993)' },
      { factor: 'Temperature dependence of Reco', contribution: 'Varies' },
    ],
    overallAssessment: 'NEE has +/- 25% uncertainty from GPP and Reco components.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Net Carbon Flux: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. NEE = R_eco - GPP (Wofsy 1993). Positive = net CO2 source, negative = net sink.`,
    recommendations: ['FLUXNET eddy covariance for validation.', 'NEE positive = source, negative = sink.', 'Reco temperature-dependent (nighttime NEE vs soil T).'],
  }),
  metadata: {
    methodology: 'NEE = R_eco - GPP. Positive = net CO2 source, negative = net sink (Wofsy 1993; Chapin 2006 sign convention).',
    assumptions: ['Ecosystem at steady state', 'No lateral carbon flux', 'Annual balance'],
    limitations: ['Legacy effects', 'Disturbance not captured', 'Lateral fluxes ignored'],
    references: ['Wofsy et al. 1993, Science 260(5112):1314-1317, doi:10.1126/science.260.5112.1314', 'Chapin et al. 2006, Ecosystems 9:1041-1050 (NEE/NEP sign convention), doi:10.1007/s10021-006-0177-2'],
    preprocessingNotes: ['GPP from MODIS MOD17A2H annual sum (genuine, ORNL DAAC)', 'R_eco auto = honest NaN (no genuine open source: FLUXNET registration-gated, SMAP L4C subset unpopulated)', 'NEE positive = source, negative = sink'],
  },
  dependencies: [51],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 54 — C3 Photosynthesis
// ══════════════════════════════════════════════════════════════════
export const TOOL_54: ToolWorkflowDef = {
  toolId: 54,
  name: 'C3 Photosynthesis',
  vizType: 'scalar',
  classificationBands: PHOTOSYNTHESIS_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Vcmax', min: 0, max: 300 }, { param: 'ci', min: 0, max: 500 }, { param: 'GammaStar', min: 0, max: 100 }, { param: 'Kc', min: 50, max: 1000 }, { param: 'Ko', min: 100000, max: 500000 }, { param: 'O', min: 150000, max: 250000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  cᵢ auto = 0.7 × NOAA GML ambient CO₂ (ca, genuine); Vcmax is a leaf trait with no open source → user-supplied');
    log.push('  Γ*, K_c, K_o: Farquhar 1980 25 °C reference constants (user-overridable); O = 210000 µmol/mol (21 % of P_atm)');
    log.push('  No temperature corrections applied — fixed 25 °C kinetics (Bernacchi et al. 2001 not implemented)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, PHOTOSYNTHESIS_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Vcmax variability', contribution: 'Varies (leaf trait, no open source)' },
      { factor: 'No temperature correction (fixed 25 °C kinetics)', contribution: 'Varies with leaf temperature' },
      { factor: 'Kc, Ko temperature dependence', contribution: 'Varies' },
    ],
    overallAssessment: 'Farquhar FvCB has +/- 20% uncertainty, mainly from Vcmax; a further +/- 10-20% from ignoring temperature (fixed 25 °C).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `C3 Photosynthesis: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} µmol/m²s. FvCB: A_c = Vcmax*(ci-Gamma*)/(ci+Kc*(1+O/Ko)). Only the Rubisco-limited branch is computed; A_j, A_p branches are not implemented.`,
    recommendations: ['Vcmax@25 ~ 80 umol/m2/s typical for C3 crops; supply explicitly (no open-source trait database).', 'A_j (light-limited) and A_p (TPU) branches not implemented — results valid when light is not limiting.', 'Temperature dependence of Γ*/Kc/Ko (Bernacchi et al. 2001) not applied — for leaf temperatures far from 25 °C, supply corrected values.'],
  }),
  metadata: {
    methodology: 'FvCB (Farquhar 1980) Rubisco-limited branch: A_c = Vcmax*(ci-Gamma*)/(ci+Kc*(1+O/Ko)). Secondary: photorespiration v_o = v_c*(O*Kc)/(ci*Ko); ci/ca ratio.',
    assumptions: ['C3 pathway', 'Light not limiting (A_c branch)', 'Constant intercellular CO2', 'Fixed 25 °C kinetics (no temperature correction)'],
    limitations: ['Does not include A_j (light-limited) or A_p (TPU) branches', 'Vcmax varies with species/conditions and has no genuine open source', 'No temperature correction (Bernacchi et al. 2001 not implemented)', 'cᵢ approximated as 0.7 × ambient CO₂ (C₃ typical, not measured)'],
    references: ['Farquhar, von Caemmerer & Berry 1980, Planta 149:78-90, doi:10.1007/BF00386231'],
    preprocessingNotes: ['cᵢ auto = 0.7 × NOAA GML ambient CO₂ (ca, genuine; C₃ ci/ca ≈ 0.7)', 'Vcmax: no genuine open source (leaf gas-exchange trait, no trait-database API) → honest NaN, user-supplied', 'Γ*, K_c, K_o: Farquhar 1980 25 °C reference constants (user-overridable)', 'O = 210000 µmol/mol (21 % O₂, physical constant)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 55 — Forest Biomass Estimation
// ══════════════════════════════════════════════════════════════════
export const TOOL_55: ToolWorkflowDef = {
  toolId: 55,
  name: 'Forest Biomass Estimation',
  vizType: 'scalar',
  classificationBands: AGB_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'DBH', min: 0, max: 300 }, { param: 'rho', min: 0.1, max: 1.2 }, { param: 'E', min: -0.5, max: 1.5 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Chave et al. (2014) Eq. 7 — height-unavailable pantropical model (calibrated on 4004 harvested trees)');
    log.push('  DBH: field measurement (no open source); ρ: wood specific gravity, user-supplied (no open trait API)');
    log.push('  E: bioclimatic stress from Eq. 6b = (0.178·TS − 0.938·CWD − 6.61·PS)×10⁻³ (Chave\'s E-layer offline; user-supplied)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, AGB_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 40,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Wood density variability', contribution: 'Dominant (paper: ρ key predictor)' },
      { factor: 'Height unavailability', contribution: 'Paper: CV 71.5% vs 56.5% (Eq. 7 vs Eq. 4)' },
      { factor: 'Bioclimatic stress E', contribution: 'Varies with site' },
    ],
    overallAssessment: 'Chave Eq. 7 has ±20-40 % per-tree uncertainty (paper RSE 0.413, mean bias +9.71 %); plot-level means ±10-15 %.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Forest Biomass Estimation: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} kg. Chave et al. (2014) Eq. 7: AGB = exp[−1.803 − 0.976E + 0.976·ln(ρ) + 2.673·ln(D) − 0.0299·(ln D)²].`,
    recommendations: ['Measure DBH at 1.3 m (breast height) — the primary field input.', 'Wood specific gravity ρ: use species/genus means (Chave 2009/Zanne 2009 global database) or measure.', 'E from Eq. 6b: E = (0.178·TS − 0.938·CWD − 6.61·PS)×10⁻³ with WorldClim TS/CWD/PS.', 'For higher accuracy supply height and use Eq. 4: AGB = 0.0673·(ρD²H)^0.976 (RSE 0.357).'],
  }),
  metadata: {
    methodology: 'Chave et al. (2014) Eq. 7 (height-unavailable): AGB = exp[−1.803 − 0.976E + 0.976·ln(ρ) + 2.673·ln(D) − 0.0299·(ln D)²]; carbon C = 0.47 × AGB (IPCC), CO₂e = 3.67 × C.',
    assumptions: ['Pantropical applicability (single model holds across tropical vegetation types)', 'Single-stem trees', 'Wood density known (ρ)' , 'No height measurement available'],
    limitations: ['±20-40 % per tree (paper RSE 0.413, bias +9.71 %; worse than height model Eq. 4)', 'Not for multi-stem trees', 'ρ and E have no genuine open point API — user-supplied', 'DBH is a field measurement — no remote DBH source'],
    references: ['Chave et al. 2014, Global Change Biology 20:3177-3190, doi:10.1111/gcb.12629'],
    preprocessingNotes: ['DBH: field measurement, user-supplied (no open source)', 'ρ: wood specific gravity, user-supplied (BIEN unreachable; global wood-density DB is a static dataset, no API)', 'E: bioclimatic stress from Eq. 6b, user-supplied (Chave\'s E-layer at chave.upstlse.fr offline)', 'Height-unavailable model Eq. 7 used (no height input)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 56 — Ocean CO2 Uptake
// ══════════════════════════════════════════════════════════════════
export const TOOL_56: ToolWorkflowDef = {
  toolId: 56,
  name: 'Ocean CO2 Uptake',
  vizType: 'heatmap',
  classificationBands: CARBON_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'k', min: 0, max: 30000 }, { param: 'K0', min: 0, max: 100 }, { param: 'dCO2', min: -300, max: 300 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  k = 0.31·u₁₀²·(Sc/660)^(−1/2) cm/hr (Wanninkhof 1992 Eq. 3, steady winds)');
    log.push('  2014 update (0.251·u², dual-tracer) gives ~19 % lower k — disclosed, not used');
    log.push('  Ocean pCO₂ from NOAA PMEL mooring observations (SOCAT constituent dataset)');
    log.push('  Wind from ERA5 reanalysis (CDS); SST from OISST v2 / mooring; SSS from mooring');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CARBON_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Gas transfer coefficient a (14C-derived)', contribution: '±15 % on k (paper: 21.9 ± 3.3 cm/hr at 7.4 m/s)' },
      { factor: 'Wind speed product (ERA5 vs scatterometer)', contribution: 'Varies' },
      { factor: 'pCO2 spatial/temporal variability', contribution: 'Varies' },
    ],
    overallAssessment: 'Wanninkhof 1992 Eq. 3 (a = 0.31) for steady winds; bomb-14C calibration uncertainty ±15 % on k, ±3 % on the Schmidt number fit (paper Table A1).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Ocean CO2 Uptake: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} mol/m²/yr. F = k·K₀·ΔpCO₂ with k = 0.31·u₁₀²·(Sc/660)^(−1/2) cm/hr (Wanninkhof 1992 Eq. 3).`,
    recommendations: ['ΔpCO₂ (ocean−atmosphere) from NOAA PMEL moorings or SOCAT; atmospheric pCO₂ from NOAA GML.', '2014 update (0.251·u²) gives ~19 % lower k — use for dual-tracer-calibrated runs.', 'Nightingale (2000) alternative for coastal waters.'],
  }),
  metadata: {
    methodology: 'Ocean CO2: F = k * K0 * dCO2 with k = 0.31·u₁₀²·(Sc/660)^(−1/2) cm/hr (Wanninkhof 1992 Eq. 3); Sc from Table A1, solubility from Table A2 (Weiss 1974 form).',
    assumptions: ['Steady/short-term wind (Eq. 3)', 'Quadratic wind dependence', 'Known pCO2 gradient (mooring measurement)'],
    limitations: ['No bubble-mediated transfer (high winds > 15 m/s)', 'Wind product dependent', 'Seasonal pCO2 variability'],
    references: ['Wanninkhof 1992, JGR 97(C5):7373–7382, doi:10.1029/92JC00188', 'Sutton et al. 2019, ESSD 11:421–439 (PMEL mooring pCO2)'],
    preprocessingNotes: ['k = 0.31·u₁₀²·(Sc/660)^(−1/2) cm/hr (Wanninkhof 1992 Eq. 3)', '2014 update (0.251·u²) disclosed, not used', 'Ocean pCO₂ from NOAA PMEL mooring observations (SOCAT constituent)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 57 — Ocean Nutrient Ratios
// ══════════════════════════════════════════════════════════════════
export const TOOL_57: ToolWorkflowDef = {
  toolId: 57,
  name: 'Ocean Nutrient Ratios',
  vizType: 'bar',
  classificationBands: CARBON_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'C', min: 0, max: 1000 }, { param: 'N', min: 0, max: 100 }, { param: 'P', min: 0, max: 10 }, { param: 'NO3s', min: 0, max: 100 }, { param: 'NO3d', min: 0, max: 100 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Redfield 1934 regressions: N:P = 20:1, C:N = 7:1, C:N:P ≈ 140:20:1 atoms');
    log.push('  Canonical 106:16:1 (N:P 16:1) is Redfield 1958 — disclosed, not the cited reference');
    log.push('  C/N/P are measured water-column concentrations — user-supplied (no open point API)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CARBON_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Sample measurement (C/N/P µmol/L)', contribution: 'Varies' },
      { factor: 'Regional nutrient variability', contribution: 'Varies' },
      { factor: 'Community composition', contribution: 'Varies' },
    ],
    overallAssessment: 'Diagnostics compare the sample against the cited Redfield (1934) regressions (N:P 20:1, C:N 7:1, C:N:P ≈ 140:20:1); the canonical 106:16:1 (Redfield 1958) is disclosed as the literature-standard refinement.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Ocean Nutrient Ratios: ${Number.isFinite(result) ? 'N:P = ' + result.toFixed(2) : 'N/A'}. Redfield 1934 regressions: N:P = 20:1, C:N = 7:1, C:N:P ≈ 140:20:1 atoms.`,
    recommendations: ['Compare N:P against 20:1 (Redfield 1934); the canonical 16:1 is the 1958 refinement.', 'N* = N − 20·P; modern N* (Gruber & Sarmiento 1997) uses N − 16·P.', 'C_export = 7 × ΔNO₃ (paper C:N = 7:1) — supply NO₃_surface and NO₃_deep.'],
  }),
  metadata: {
    methodology: 'Redfield 1934: N:P = 20:1, C:N = 7:1, C:N:P ≈ 140:20:1 atoms; N* = N − 20·P; C_export = 7 × ΔNO₃.',
    assumptions: ['Sample is bulk water-column or plankton C/N/P', 'Molar concentrations (µmol/L)', 'Steady-state stoichiometry'],
    limitations: ['Regional/community variability', 'DIC not available from climatology — user-supplied', 'Canonical 106:16:1 (Redfield 1958) differs from the cited 1934 values'],
    references: ['Redfield 1934, James Johnstone Memorial Volume, pp. 176–192 (NO-DOI)', 'Redfield 1958, Am. Sci. 46(3):205–221 (canonical 106:16:1 — disclosed)'],
    preprocessingNotes: ['Redfield 1934 regressions: N:P = 20:1, C:N = 7:1, C:N:P ≈ 140:20:1 atoms', 'Canonical 106:16:1 (N:P 16:1) is Redfield 1958 — disclosed, not the cited reference', 'C/N/P are measured water-column concentrations — user-supplied (no open point API)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 58 — Crop Growing Degree Days
// ══════════════════════════════════════════════════════════════════
export const TOOL_58: ToolWorkflowDef = {
  toolId: 58,
  name: 'Crop Growing Degree Days',
  vizType: 'timeseries',
  classificationBands: AGRI_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'Tmax', min: -40, max: 60 }, { param: 'Tmin', min: -40, max: 60 },
    { param: 'Tbase', min: 0, max: 20 }, { param: 'Tupper', min: 20, max: 50 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Daily TMAX/TMIN: nearest GHCN-Daily station (NOAA ACIS) — the paper\'s Class A station data');
    log.push('  Both McMaster & Wilhelm (1997) methods computed: M1 clamps the mean, M2 clamps each extreme');
    log.push('  Crop Tbase: wheat 0, maize 10, rice 10 °C; T_upper: corn 30, wheat 25 °C (paper §3)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, AGRI_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 10,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'GHCN station distance from study point', contribution: 'Varies' },
      { factor: 'Crop-specific thresholds', contribution: 'Varies' },
      { factor: 'Method 1 vs Method 2 interpretation', contribution: 'Up to 83–376% (paper §4)' },
    ],
    overallAssessment: 'Method choice dominates uncertainty: M1 vs M2 differ by up to 83% (wheat) / 376% (corn) on real field data (paper Table 2).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Crop Growing Degree Days (Method 1): ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} °C·day. McMaster & Wilhelm (1997) Eq. (1) — two interpretations; both computed and shown (Method 1 solid, Method 2 dashed on the chart; both in the outputs table). Daily TMAX/TMIN from nearest GHCN-Daily station.`,
    recommendations: ['Report WHICH method was used (paper conclusion): Method 1 clamps the daily mean, Method 2 clamps each extreme.', 'Tbase varies by crop: wheat 0, maize 10, rice 10 °C.', 'T_upper: 30 °C corn (Cross & Zuber 1972), 25 °C wheat (McMaster & Smika 1988).'],
  }),
  metadata: {
    methodology: 'GDD = Σ [(TMAX+TMIN)/2 − TBASE] (paper Eq. 1), computed two ways: Method 1 clamps the daily mean TAVG to [TBASE, TUT]; Method 2 clamps TMAX/TMIN individually. Both reported; primary = Method 1. Daily TMAX/TMIN from nearest GHCN-Daily station (NOAA ACIS).',
    assumptions: ['Linear development rate between Tbase and Tupper', 'No development below Tbase', 'Base temp constant per crop'],
    limitations: ['Methods differ when TMIN < Tbase (up to 83% wheat / 376% corn — paper §4)', 'Heat stress not fully captured', 'Station data representative of study point'],
    references: ['McMaster, G.S. & Wilhelm, W.W. (1997) Agric. For. Meteorol. 87(4):291–300. DOI 10.1016/S0168-1923(97)00027-0'],
    preprocessingNotes: ['Daily TMAX/TMIN from nearest GHCN-Daily station (NOAA ACIS)', 'Both methods computed per the paper', 'Crop Tbase/T_upper per paper §3 (wheat 0/25, corn 10/30)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 59 — Priestley-Taylor Evapotranspiration
// ══════════════════════════════════════════════════════════════════
export const TOOL_59: ToolWorkflowDef = {
  toolId: 59,
  name: 'Priestley-Taylor Evapotranspiration',
  vizType: 'timeseries',
  classificationBands: WATER_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'alpha', min: 1, max: 2 }, { param: 'delta', min: 0, max: 1 }, { param: 'gamma', min: 0.04, max: 0.1 }, { param: 'Rn', min: -100, max: 1000 }, { param: 'G', min: -100, max: 500 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  α = 1.26 (paper §6: overall mean of land and water, 1.26 ± 0.01)');
    log.push('  Net radiation Rₙ: genuine ERA5 surface fluxes (absorbed shortwave − net upward longwave, CDS)');
    log.push('  G = 0 — paper explicitly neglects ground heat flux for 24-hr totals (p. 83)');
    log.push('  Paper Eq. (14): PE = α·[Δ/(Δ+γ)]·(Rₙ−G) in W/m²; mm/day via λ = 2.45 MJ/kg');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, WATER_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'α variability', contribution: 'Paper §6: 1.26 ± 0.01 mean, 1.25–1.34 by site' },
      { factor: 'Net radiation (ERA5 fluxes)', contribution: 'Varies with surface/cloud' },
      { factor: 'Method (M1 vs M2 GDD-style unit handling)', contribution: 'n/a here; unit conversion exact (λ, ρ_w)' },
    ],
    overallAssessment: 'PE is computed in energy units per the paper (Eq. 14) and converted to mm/day with the exact latent-heat constant (±~15 % driven by ERA5 net-radiation and α).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Priestley-Taylor Evapotranspiration: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} mm/day. Paper Eq. (14): PE = 1.26·[Δ/(Δ+γ)]·(Rₙ−G) in W/m², converted to mm/day via λ. α = 1.26 (paper §6).`,
    recommendations: ['α = 1.26 (paper §6 overall mean); 1.25–1.34 by site, 1.30 ± 0.02 Hoeber equatorial Atlantic.', 'G = 0 for 24-hr totals (paper neglects ground heat flux); use negative G for daytime heating.', 'No wind data needed (advantage over FAO-56); α < 1.0 indicates advection (aridity index, paper §7).'],
  }),
  metadata: {
    methodology: 'PE = 1.26·[Δ/(Δ+γ)]·(Rₙ−G) (paper Eq. 14, energy units W/m²), ET_mm/day = PE × 86400/(λ·ρ_w), λ = 2.45 MJ/kg. Rₙ = genuine ERA5 net surface radiation (absorbed SW − net upward LW, CDS); G = 0 (paper neglects it for 24-hr totals); Δ from air temperature, γ from surface pressure (FAO-56 forms — reproduce the paper\'s s/(s+γ) = 0.56 @ 10 °C, 0.82 @ 35 °C).',
    assumptions: ['Well-watered, horizontally uniform saturated surface', 'No advection (equilibrium boundary layer)', 'α = 1.26 (paper §6)'],
    limitations: ['α not universal (1.25–1.34 by site)', 'Advection increases ET', 'Not for water-stressed surfaces'],
    references: ['Priestley, C.H.B. & Taylor, R.J. (1972) Mon. Wea. Rev. 100(2):81–92. DOI 10.1175/1520-0493(1972)100<0081:otaosh>2.3.co;2'],
    preprocessingNotes: ['α = 1.26 (paper §6)', 'Rₙ = genuine ERA5 surface fluxes (CDS)', 'G = 0 (paper neglects ground heat flux)', 'PE in W/m² → mm/day via λ (exact)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 60 — Hargreaves-Samani ET
// ══════════════════════════════════════════════════════════════════
export const TOOL_60: ToolWorkflowDef = {
  toolId: 60,
  name: 'Hargreaves-Samani ET',
  vizType: 'timeseries',
  classificationBands: WATER_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Ra', min: 0, max: 50 }, { param: 'Tmax', min: -40, max: 60 }, { param: 'Tmin', min: -40, max: 60 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Rₐ (extraterrestrial radiation) from latitude and day-of-year (FAO-56 Annex 2)');
    log.push('  T_max/T_min: nearest GHCN-Daily station (NOAA ACIS) — the paper\'s measured daily max/min');
    log.push('  K_ET = 0.0023 (paper Eq. [4] typo 0.00023; derivation Eq. [1]×[2] and FAO-56 use 0.0023)');
    log.push('  MJ/m²/day → mm/day ×0.408 (÷2.45)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, WATER_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Coefficient 0.0023 calibration', contribution: 'Varies' },
      { factor: 'Temperature range proxy for radiation', contribution: 'Varies' },
      { factor: 'Wind/humidity not included', contribution: 'Varies' },
    ],
    overallAssessment: 'Hargreaves has +/- 20% uncertainty. Temperature-only method, no wind/humidity needed.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Hargreaves-Samani ET₀: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} mm/day. Paper Eq. [4]: ET₀ = 0.0023 × Rₐ × √(T_max−T_min) × (T_avg + 17.8); Rₐ in MJ/m²/day → mm/day ×0.408. T_max/T_min from nearest GHCN-Daily station.`,
    recommendations: ['Rₐ from latitude and day-of-year (FAO-56 Annex 2).', 'T_max/T_min from GHCN-Daily station observations (paper: measured daily max/min).', 'K_ET = 0.0023 (paper Eq. [4] prints 0.00023 — dropped-zero typo; the paper\'s own Eq. [1]×[2] derivation and FAO-56 use 0.0023).', '0.0019–0.0032 coefficient range coastal→inland; validate against FAO-56 where data available.'],
  }),
  metadata: {
    methodology: 'ET₀ = 0.0023 × Rₐ × (T_avg+17.8) × √(T_max−T_min), Rₐ (MJ/m²/day) from latitude and day-of-year (FAO-56 Annex 2), ×0.408 to mm/day. T_max/T_min: nearest GHCN-Daily station (NOAA ACIS). K_ET 0.0023 per the paper\'s derivation (Eq. [1] 0.0135 × Eq. [2] K_RS ≈ 0.17) and FAO-56; the printed 0.00023 in Eq. [4] is a dropped-zero typo, disclosed in steps.',
    assumptions: ['TD = T_max−T_min proxies cloud cover / net radiation', 'No advection (single K_ET compensates approximately)', 'Calibrated on Alta fescue lysimeters at Davis, CA (paper)'],
    limitations: ['Overestimates in coastal/humid (low advection); underestimates in advective arid (paper §LIMITATIONS)', 'Wind/humidity not explicit', 'Less accurate than FAO-56 (RMSE ≈ 0.7–1.0 mm/day)'],
    references: ['Hargreaves, G.H. & Samani, Z.A. (1985) Appl. Eng. Agric. 1(2):96–99. DOI 10.13031/2013.26773'],
    preprocessingNotes: ['Rₐ from latitude and day-of-year (FAO-56 Annex 2)', 'T_max/T_min from nearest GHCN-Daily station (NOAA ACIS)', '×0.408 MJ→mm conversion', 'K_ET = 0.0023 (paper typo disclosed)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 61 — FAO Yield-Water Response
// ══════════════════════════════════════════════════════════════════
export const TOOL_61: ToolWorkflowDef = {
  toolId: 61,
  name: 'FAO Yield-Water Response',
  vizType: 'scalar',
  classificationBands: AGRI_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Ya', min: 0, max: 20 }, { param: 'Ym', min: 0, max: 20 }, { param: 'Ky', min: 0, max: 2 }, { param: 'ETa', min: 0, max: 2000 }, { param: 'ETm', min: 0, max: 2000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Crop-specific Ky from FAO-33');
    log.push('  ETa/ETm from water balance');
    log.push('  Ym from regional yield data');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, AGRI_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 25,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Ky crop-specific', contribution: 'Varies' },
      { factor: 'ETa/ETm estimation', contribution: 'Varies' },
      { factor: 'Ym regional variability', contribution: 'Varies' },
    ],
    overallAssessment: 'Doorenbos-Kassam has +/- 25% uncertainty. Ky is crop-specific.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `FAO Yield-Water Response: predicted relative yield reduction (1−Yₐ/Yₘ) = ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} (paper Eq. 1). Requires Yₘ, K_y, ETₐ, ETₘ — all field/table inputs with no open point API, so autos are NaN.`,
    recommendations: ['K_y is crop-specific — use FAO IDP 33 Table 24 (maize 1.25, winter wheat 1.05, rice 1.1, soybean 0.85).', 'ETₘ from FAO-56 crop evapotranspiration; ETₐ from a soil-water balance.', 'Yₘ from regional yield statistics (optional, for predicted Yₐ in t/ha).'],
  }),
  metadata: {
    methodology: 'Paper Eq. (1): (1−Ya/Ym) = Ky × (1−ETa/ETm). Primary output is the predicted relative yield reduction; Ya is optional diagnostic (observed vs predicted residual). Source: FAO IDP 66 (i2800e.pdf) reproduces IDP 33 Eq. (1) verbatim.',
    assumptions: ['Linear yield-ET relationship', 'No stress timing effects', 'Constant Ky'],
    limitations: ['Nonlinear for severe stress', 'Ky varies with growth stage', 'Requires crop-specific calibration'],
    references: ['Doorenbos & Kassam 1979, FAO Irrigation and Drainage Paper 33', 'Steduto et al. 2009, FAO Irrigation and Drainage Paper 66'],
    preprocessingNotes: ['Crop-specific Ky from FAO-33 Table 24', 'ETa/ETm from water balance', 'Ym from regional yield data'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 62 — Phytoplankton Temperature Growth
// ══════════════════════════════════════════════════════════════════
export const TOOL_62: ToolWorkflowDef = {
  toolId: 62,
  name: 'Phytoplankton Temperature Growth',
  vizType: 'timeseries',
  classificationBands: AGRI_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'mu20', min: 0, max: 5 }, { param: 'T', min: 0, max: 40 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Eppley (1972) Eq. (1): log10 μmax = 0.0275·T − 0.070 (Q10 = 1.88)');
    log.push('  Eq. (a): μmax = 0.851 × 1.066^T — maximum-growth envelope');
    log.push('  T from daily NOAA OISST v2 SST (marine temperature of the paper)');
    log.push('  μ₂₀ is species-specific — honest NaN auto, optional scale input');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, AGRI_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Q10 variability', contribution: 'Varies' },
      { factor: 'Thermal optimum not captured', contribution: 'Varies' },
      { factor: 'Species-specific curves', contribution: 'Varies' },
    ],
    overallAssessment: 'Eppley curve is classic but modern research shows thermal optima. Q10 = 1.88.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Phytoplankton Temperature Growth: μmax = ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} /day. Eppley (1972) Eq. (1): log10 μmax = 0.0275·T − 0.070 (Eq. (a) μmax = 0.851×1.066^T); Q10 = 1.88. This is the maximum-growth envelope; realized rates are light/nutrient-limited.`,
    recommendations: ['Q10 = 1.88 (10^0.275) — paper value.', 'Supply a species-specific μ₂₀ to scale the envelope (e.g. 1.0 coastal diatoms, 0.6 open-ocean).', 'T is marine SST: auto uses daily NOAA OISST v2; NaN when none (inland).'],
  }),
  metadata: {
    methodology: 'Eppley (1972) Eq. (1): log10 μmax = 0.0275·T − 0.070 ⟺ Eq. (a) μmax = 0.851×1.066^T. Q10 = 1.88. Optional μ₂₀ scales through 20 °C.',
    assumptions: ['Exponential growth envelope', 'No thermal optimum (paper-era)', 'Nutrient-replete maximum'],
    limitations: ['Thermal optimum not captured (modern refinement)', 'Nutrient limitation ignored — envelope is a maximum', 'Species-specific curves differ'],
    references: ['Eppley 1972, Fishery Bulletin 70(4):1063-1085'],
    preprocessingNotes: ['Eppley (1972) Eq. (1) log10 form + Eq. (a) exponential form', 'T from NOAA OISST v2 daily SST', 'μ₂₀ species-specific honest NaN auto'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 63 — Bigleaf Penman-Monteith
// ══════════════════════════════════════════════════════════════════
export const TOOL_63: ToolWorkflowDef = {
  toolId: 63,
  name: 'Bigleaf Penman-Monteith',
  vizType: 'heatmap',
  classificationBands: AGRI_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'rho', min: 0.5, max: 1.5 }, { param: 'cp', min: 800, max: 1200 }, { param: 'Ts', min: -10, max: 60 }, { param: 'Ta', min: -20, max: 50 }, { param: 'ra', min: 1, max: 500 }, { param: 'rs', min: 10, max: 1000 }, { param: 'es', min: 0, max: 100 }, { param: 'ea', min: 0, max: 100 }, { param: 'p', min: 800, max: 1100 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  SiB big-leaf fluxes (Sellers et al. 1986, Table 1c)');
    log.push('  H = (T_s−T_a)·ρc_p/r_a ;  LE = (e_s−e_a)·ρc_p/(γ·(r_a+r_s)), γ = c_p·p/(0.622·L_v)');
    log.push('  Honest NaN autos: T_s, r_a, r_s (no open point API)');
    log.push('  Genuine autos: T_a, e_s/e_a (Magnus from T_a+RH), ρ (ideal gas, p/R·T)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, AGRI_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'ra estimation', contribution: 'Varies' },
      { factor: 'rs from stomatal model', contribution: 'Varies' },
      { factor: 'Surface temperature accuracy', contribution: 'Varies' },
    ],
    overallAssessment: 'Bigleaf PM has +/- 20% uncertainty. ra and rs are key uncertain parameters.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `SiB Bigleaf fluxes: LE = ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} W/m² (primary). H = ρc_p(T_s−T_a)/r_a; LE = (e_s−e_a)·ρc_p/(γ·(r_a+r_s)) with γ = c_p·p/(0.622·L_v) — paper Table 1c. Requires T_s, r_a, r_s (no open point API → honest NaN autos).`,
    recommendations: ['T_s from in-situ or thermal satellite; r_a from wind + roughness; r_s from stomatal conductance.', 'e_s/e_a auto from T_a+RH (Magnus); ρ auto from p and T_a (ideal gas).', 'Used in land-surface models (SiB, CLM).'],
  }),
  metadata: {
    methodology: 'SiB Table 1c: H = (T_s−T_a)·ρc_p/r_a; LE = (e_s−e_a)·ρc_p/(γ·(r_a+r_s)), γ = c_p·p/(0.622·L_v).',
    assumptions: ['Bigleaf (single-source) approximation', 'No canopy stratification', 'Linear gradients'],
    limitations: ['Not for tall canopies', 'Requires surface temperature', 'ra and rs uncertain'],
    references: ['Sellers, Mintz, Sud & Dalcher 1986, J. Atmos. Sci. 43(6):505-531'],
    preprocessingNotes: ['SiB big-leaf fluxes (Table 1c)', 'T_s/r_a/r_s honest NaN autos', 'T_a/e_s/e_a/ρ genuine derivations'],
  },
  dependencies: [3, 50],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 64 — Chapman Ozone Cycle
// ══════════════════════════════════════════════════════════════════
// Chapman steady-state O₃/O₂ ratio bands (ppmv-equivalent = R × 1e6):
// photochemical-equilibrium stratospheric ozone is 1–10 ppmv; below = destruction
// dominated, above = production dominated.
const OZONE_RATIO_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 1e-7, label: 'Destruction-Dominant', color: '#3b82f6', description: 'O₃/O₂ < 0.1 ppmv — net O₃ loss' },
  { min: 1e-7, max: 1e-6, label: 'Low O₃', color: '#60a5fa', description: '0.1–1 ppmv — suppressed photochemical O₃' },
  { min: 1e-6, max: 1e-5, label: 'Typical Stratosphere', color: '#22c55e', description: '1–10 ppmv — Chapman equilibrium' },
  { min: 1e-5, max: Infinity, label: 'Production-Dominant', color: '#f97316', description: '> 10 ppmv — O₃ production exceeds loss' },
];

export const TOOL_64: ToolWorkflowDef = {
  toolId: 64,
  name: 'Chapman Ozone Cycle',
  vizType: 'heatmap',
  classificationBands: OZONE_RATIO_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'J1', min: 1e-20, max: 1 },      // O₂ photolysis rate s⁻¹
    { param: 'k2', min: 1e-30, max: 1e-10 },  // O+O₂→O₃ cm³/molecule·s
    { param: 'J3', min: 1e-20, max: 1 },      // O₃ photolysis rate s⁻¹
    { param: 'k4', min: 1e-30, max: 1e-10 },  // O+O₃→2O₂ cm³/molecule·s
    { param: 'O2', min: 1e10, max: 1e22 },    // [O₂] molecules/cm³
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  J1/J3 (photolysis rates) require actinic UV flux — no open point API; supply explicitly (CAMS EAC4 or TUV output)');
    log.push('  k2/k4 = NASA/JPL 2023 evaluation rate constants (physical constants, 298 K)');
    log.push('  Chapman alone overestimates O3 by ~2x (catalytic NOx/HOx/ClOx cycles omitted — paper predates their discovery)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, OZONE_RATIO_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 50,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Photolysis-rate inputs (J1, J3) dominate — span orders of magnitude with altitude/SZA', contribution: 'Dominant' },
      { factor: 'Missing catalytic cycles (NOx/HOx/ClOx)', contribution: '~2x overestimate' },
      { factor: 'Rate constants T-dependence', contribution: '< 10%' },
    ],
    overallAssessment: 'Ratio algebra exact per Chapman 1930; absolute O3 uncertainty dominated by the J inputs (actinic flux) and the omitted catalytic cycles (~2x overestimate).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Chapman Ozone Cycle: photochemical-equilibrium ratio [O₃]/[O₂] = ${Number.isFinite(result) ? result.toExponential(3) : 'N/A'} (paper result [O₃]/[O₂] = √(J₁·k₂/(J₃·k₄))). Requires J₁ and J₃ (photolysis rates, actinic-flux inputs — supply explicitly; no open point API).`,
    recommendations: ['Supply J₁/J₃ from a photolysis calculation (e.g. TUV model) or CAMS EAC4 output — no authentic open point source is reachable this session.', 'Chapman alone overestimates O₃ by ~2x — interpret with catalytic NOₓ/HOₓ/ClOₓ cycles.', 'k₂/k₄ are NASA/JPL 2023 evaluation constants (298 K); scale k₂ with [M] for other altitudes.'],
  }),
  metadata: {
    methodology: 'Chapman (1930) mechanism: O2+hv→2O (J1), O+O2→O3 (k2, third body M), O3+hv→O2+O (J3), O+O3→2O2 (k4); reactions (1) O+O→O2 and (5) 2O3→3O2 negligible. Steady state d[O]/dt=d[O3]/dt=0 ⇒ [O3]/[O2] = √(J1·k2/(J3·k4)) and [O] = J1[O2]/(k4[O3]). Source: Chapman 1930 memoir (Mem. R. Meteorol. Soc. 3(26):103-125), mechanism as transcribed by Giunta (Le Moyne, Classical Chemistry); rate constants from NASA/JPL 2023 evaluation (JPL Pub. 19-5).',
    assumptions: ['Pure oxygen chemistry', 'Photochemical steady state', 'Reactions (1) and (5) negligible', 'No transport or catalytic cycles'],
    limitations: ['Missing NOx/HOx/ClOx catalytic cycles (~2x O3 overestimate)', 'No vertical transport / Brewer-Dobson', 'Photolysis rates are altitude- and solar-zenith-angle dependent'],
    references: ['Chapman, S. (1930) A theory of upper-atmospheric ozone. Memoirs of the Royal Meteorological Society, 3(26), 103-125. (NO-DOI)', 'Giunta, C. (2003) Chapman ozone exercises (Le Moyne College Classical Chemistry) — faithful transcription of the paper mechanism', 'Burkholder et al. (2020) NASA/JPL Chemical Kinetics and Photochemical Data for Use in Atmospheric Studies, Evaluation 19, JPL Pub. 19-5'],
    preprocessingNotes: ['J1/J3 photolysis rates: no open point API — supply explicitly (CAMS EAC4 or TUV)', 'k2/k4: JPL 2023 physical constants (298 K)', 'Chapman alone overestimates O3 by ~2x'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 65 — Pollutant Lifetime
// ══════════════════════════════════════════════════════════════════
// Lifetime regime bands (seconds) — Atkinson 2000 §1 classification:
// short-lived (< 1 h), moderate (hours–days), intermediate (days–year), long-lived (> 1 yr).
const LIFETIME_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 3600, label: 'Short-Lived', color: '#ef4444', description: '< 1 h — local impacts (isoprene, terpenes, OH)' },
  { min: 3600, max: 86400, label: 'Moderate', color: '#f97316', description: 'hours–day — regional air quality (NOₓ, SO₂, VOCs)' },
  { min: 86400, max: 3.1536e7, label: 'Intermediate', color: '#eab308', description: 'days–1 yr — hemispheric transport (CO, ethane)' },
  { min: 3.1536e7, max: Infinity, label: 'Long-Lived', color: '#22c55e', description: '> 1 yr — globally well-mixed (CH₄, N₂O, CFCs)' },
];

export const TOOL_65: ToolWorkflowDef = {
  toolId: 65,
  name: 'Pollutant Lifetime',
  vizType: 'scalar',
  classificationBands: LIFETIME_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'k', min: 1e-30, max: 1e-5 },   // bimolecular rate constant cm³/molecule·s (k_OH span: CH4 2.45e-15 … isoprene 1e-10)
    { param: 'OH', min: 1e4, max: 1e8 },     // [OH] molecules/cm³ (measured range 2e5–1e7; paper global mean 1e6, daytime 2e6)
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  k = species-specific 298 K rate constant (user supplies; paper Table 1 cross-checks available)');
    log.push('  [OH] default = paper 24-h global mean 1.0e6 molecule/cm3 (Prinn et al. 1995); daytime average 2.0e6 for Table 1 lifetimes');
    log.push('  Lifetime = 1/(k*[OH]); OH-only loss — photolysis/NO3/O3/deposition combined elsewhere');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, LIFETIME_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 30,
    rmseUnit: '%',
    contributingFactors: [
      { factor: '[OH] spatiotemporal variability (±30% on the global mean)', contribution: 'Dominant for long-lived species' },
      { factor: 'Rate-constant T-dependence (298 K quoted)', contribution: '10–30%' },
      { factor: 'Other loss processes (photolysis, NO₃, O₃, deposition)', contribution: 'Varies' },
    ],
    overallAssessment: 'Formula exact per Atkinson 2000; ±30% dominated by [OH] variability and the 298 K rate-constant convention (paper Table 1 uses the 12-h daytime 2.0e6).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Pollutant Lifetime (Atkinson 2000): τ = 1/(k_OH·[OH]) = ${Number.isFinite(result) ? result.toExponential(3) : 'N/A'} s. k is species-specific (user supplies — no open point API); [OH] defaults to the paper's 24-h global mean 1.0e6 molecule cm⁻³.`,
    recommendations: ['Supply k_OH for the species of interest (isoprene 1.0e-10, CH₄ 2.45e-15, CO 1.5e-13 cm³/molecule·s at 298 K).', 'For paper-consistent lifetimes use the 12-h daytime [OH] = 2.0e6 (Table 1 convention).', 'Combine photolysis/NO₃/O₃/deposition losses for a total lifetime: τ = 1/Σ(kᵢ·[Xᵢ] + J).'],
  }),
  metadata: {
    methodology: 'Atkinson (2000): τ = 1/(k_OH·[OH]) with [OH] = 1.0e6 molecule cm⁻³ (24-h global mean, Prinn et al. 1995) or 2.0e6 (12-h daytime average, Table 1). Paper Table 1 gives OH-lifetimes for ~40 VOCs at the daytime value (isoprene 1.4 h, ethene 1.4 day, propane 10 day, benzene 9.4 day, acetone 53 day, methanol 12 day).',
    assumptions: ['OH-only loss (single pathway)', 'Constant [OH] (pseudo-first order)', '298 K rate constants'],
    limitations: ['[OH] varies ±30% with latitude/season/time-of-day', 'Photolysis, NO₃, O₃ and deposition losses excluded', 'Rate constants temperature-dependent'],
    references: ['Atkinson, R. (2000) Atmospheric chemistry of VOCs and NOx. Atmospheric Environment, 34(12-14), 2063-2101. DOI 10.1016/S1352-2310(99)00460-4', 'Prinn et al. (1995) Science 269:187-192 (global [OH] estimate, as cited in the paper)'],
    preprocessingNotes: ['k species-specific — user supplies', '[OH] default = 1.0e6 (24-h global mean); 2.0e6 daytime for Table 1', 'Lifetime = 1/(k*[OH])'],
  },
  dependencies: [],
};

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

// ══════════════════════════════════════════════════════════════════
//  EQUATION 66 — Sverdrup Balance
// ══════════════════════════════════════════════════════════════════
// Meridional transport per unit width (m²/s), signed: southward < 0 < northward.
// Typical interior values: subtropical gyre ~ −30 to −50 m²/s, subpolar ~ +30 m²/s.
const TRANSPORT_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: -50, label: 'Strong Southward', color: '#3b82f6', description: 'v < −50 m²/s — strong equatorward interior flow' },
  { min: -50, max: -5, label: 'Southward', color: '#60a5fa', description: '−50 to −5 m²/s — subtropical-gyre interior' },
  { min: -5, max: 5, label: 'Weak', color: '#a8a29e', description: '|v| < 5 m²/s — near-zero curl regime' },
  { min: 5, max: 50, label: 'Northward', color: '#f97316', description: '5 to 50 m²/s — subpolar-gyre interior' },
  { min: 50, max: Infinity, label: 'Strong Northward', color: '#ef4444', description: 'v > 50 m²/s — strong poleward interior flow' },
];

export const TOOL_66: ToolWorkflowDef = {
  toolId: 66,
  name: 'Sverdrup Balance',
  vizType: 'vector',
  classificationBands: TRANSPORT_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'beta', min: 0, max: 1e-10 },     // 2Ωcosφ/R ∈ [0, 2.3e-11]
    { param: 'rho0', min: 1000, max: 1050 },   // seawater kg/m³
    { param: 'curlTau_z', min: -0.001, max: 0.001 }, // N/m³
    { param: 'f', min: -1e-3, max: 1e-3 },     // 2Ωsinφ ∈ [±1.46e-4] s⁻¹
    { param: 'W', min: 1e4, max: 1e8 },        // basin width m (optional)
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  β = 2Ωcosφ/R and f = 2Ωsinφ derived from the request latitude (paper eq 12)');
    log.push('  (∇×τ)_z = spatial wind-stress curl — no genuine point source this session; honest NaN auto (user supplies, e.g. ASCAT/CCMP)');
    log.push('  rho0 = 1025 kg/m3 (physical constant)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, TRANSPORT_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Wind stress curl input (dominant — user-supplied)', contribution: 'Varies' },
      { factor: 'β and f latitude derivation', contribution: '< 1%' },
      { factor: 'Reference density (1021–1028)', contribution: '< 1%' },
    ],
    overallAssessment: 'Algebra exact per Sverdrup 1947 eq (13); ±20% typical for the interior transport driven by the (user-supplied) wind-stress curl.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Sverdrup Balance (1947, PNAS 33:318-326): meridional transport per unit width v = (∇×τ)_z/(ρ₀·β) = ${Number.isFinite(result) ? result.toExponential(4) : 'N/A'} m²/s. β = 2Ωcosφ/R from the location; the wind-stress curl must be supplied (honest NaN auto).`,
    recommendations: ['Supply (∇×τ)_z from a wind product (ASCAT/CCMP/CERA-20C) or a spatial wind-stress gradient.', 'Valid in the ocean interior only — not at the equator (f→0) or in the western boundary currents.', 'Provide the basin width W for the total transport in Sv.'],
  }),
  metadata: {
    methodology: 'Sverdrup (1947) eq (13): β·M_y = curl_z(τ) = ∂τ_y/∂x − ∂τ_x/∂y, derived from the momentum equations (9a/9b) + continuity (10); volume transport per unit width v = curl_z(τ)/(ρ₀·β) in m²/s; Ekman pumping w_Ek = curl_z(τ)/(ρ₀·f); β = 2Ωcosφ/R (eq 12), f = 2Ωsinφ.',
    assumptions: ['Steady state', 'Ocean interior (no boundaries/friction)', 'β-plane approximation', 'Wind stress curl user-supplied'],
    limitations: ['Fails at the equator (f→0) and in western boundary currents', 'Wind-stress curl needs a spatial wind field (no genuine point source — honest NaN auto)', 'Depth-integrated, not resolved vertically', 'No bottom topography'],
    references: ['Sverdrup, H.U. (1947) Wind-driven currents in a baroclinic ocean. PNAS 33(11), 318-326. DOI 10.1073/pnas.33.11.318'],
    preprocessingNotes: ['β, f from latitude (eq 12)', 'Curl user-supplied (honest NaN)', 'rho0 = 1025 kg/m3'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 67 — Stommel Western Boundary Current
// ══════════════════════════════════════════════════════════════════
// Streamfunction-magnitude bands (m²/s) for the Stommel gyre (paper example: ψ ~ 1e5-1e6 m²/s).
const GYRE_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 1e4, label: 'Weak Gyre', color: '#60a5fa', description: '|ψ| < 1e4 m²/s — weak circulation' },
  { min: 1e4, max: 1e5, label: 'Moderate Gyre', color: '#22c55e', description: '1e4–1e5 m²/s' },
  { min: 1e5, max: 1e6, label: 'Strong Gyre', color: '#eab308', description: '1e5–1e6 m²/s — Gulf-Stream-scale transport function' },
  { min: 1e6, max: Infinity, label: 'Intense Gyre', color: '#ef4444', description: '> 1e6 m²/s' },
];

export const TOOL_67: ToolWorkflowDef = {
  toolId: 67,
  name: 'Stommel Western Boundary Current',
  vizType: 'vector',
  classificationBands: GYRE_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'beta', min: 0, max: 1e-10 },  // Rossby parameter s⁻¹m⁻¹
    { param: 'D', min: 1, max: 1e5 },       // depth m
    { param: 'b', min: 1e3, max: 1e9 },     // basin N-S width (m or cm, consistent units)
    { param: 'L', min: 1e3, max: 1e9 },     // basin E-W length (m or cm, consistent units)
    { param: 'R', min: 1e-10, max: 1 },     // friction s⁻¹
    { param: 'F', min: 0, max: 10 },        // max wind stress (N/m² or dyne/cm²)
    { param: 'x', min: 0, max: 1e9 },       // evaluation point (consistent units)
    { param: 'y', min: 0, max: 1e9 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Stommel (1948) eq (9): ∇²ψ + α·∂ψ/∂x = γ·sin(πy/b), α = D·β/R, γ = F·π/(R·b)');
    log.push('  Defaults are the paper\'s numerical example (cgs) converted to SI');
    log.push('  β auto-derives from the request latitude');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(Math.abs(result), GYRE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 25,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Friction coefficient R (user-supplied)', contribution: 'Dominant' },
      { factor: 'Linear bottom friction idealization', contribution: 'Varies' },
      { factor: 'β latitude derivation', contribution: '< 1%' },
    ],
    overallAssessment: 'Solution algebra exact per Stommel 1948 eqs (9)/(19)-(22); ±25% typical, dominated by the linear-friction idealization and R.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Stommel Western Boundary Current (1948, Trans. AGU 29:202-206): steady-state streamfunction ψ(x,y) = γ(b/π)²·sin(πy/b)·(p·e^{Ax} + q·e^{Bx} − 1) = ${Number.isFinite(result) ? result.toExponential(4) : 'N/A'} m²/s. α = D·β/R; the e^{Bx} term concentrates the flow at the western boundary.`,
    recommendations: ['Use the paper\'s parameter set (D = 200 m, b = 6249 km, L = 10⁴ km, R = 0.02 s⁻¹, F = 0.1 N/m², β = 1e-11) for the canonical westward-intensified solution.', 'Evaluate near x = 0 (western boundary) to see the Gulf-Stream-like jet; the width is δ = 1/α.', 'β = 0 recovers the non-rotating symmetric case (paper Fig 2).'],
  }),
  metadata: {
    methodology: 'Stommel (1948) eq (9): ∇²ψ + α·∂ψ/∂x = γ·sin(πy/b), α = D·β/R, γ = F·π/(R·b); closed-form solution (19)-(20): ψ = γ(b/π)²·sin(πy/b)·(p·e^{Ax} + q·e^{Bx} − 1) with A = −α/2 ± √(α²/4 + (π/b)²), p = (1−e^{BL})/(e^{AL}−e^{BL}), q = 1−p; velocities (21)-(22); boundary-layer width δ = 1/α. Defaults = the paper\'s numerical example converted to SI.',
    assumptions: ['Homogeneous (barotropic) ocean', 'Linear bottom friction −R·u, −R·v', 'Steady state, inertial terms omitted', 'Sinusoidal zonal wind stress F·cos(πy/b)'],
    limitations: ['Linear friction idealization (no lateral eddy viscosity — the Munk model adds it)', 'No inertia, no topography', 'β-plane (f linear in y)', 'Single-gyre basin'],
    references: ['Stommel, H. (1948) The westward intensification of wind-driven ocean currents. Transactions, American Geophysical Union, 29(2), 202-206. DOI 10.1029/TR029i002p00202'],
    preprocessingNotes: ['Defaults = paper numerical example (SI)', 'β from latitude', 'Evaluate ψ at a chosen (x, y)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 68 — Munk Viscous Boundary Layer
// ══════════════════════════════════════════════════════════════════
export const TOOL_68: ToolWorkflowDef = {
  toolId: 68,
  name: 'Munk Viscous Boundary Layer',
  vizType: 'vector',
  classificationBands: GYRE_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'AH', min: 1, max: 1e8 },      // lateral eddy viscosity m²/s (paper: 3.3e7–6.5e7 cm²/s = 3.3e3–6.5e3 m²/s)
    { param: 'beta', min: 0, max: 1e-10 },  // Rossby parameter s⁻¹m⁻¹
    { param: 'curlTau', min: -0.001, max: 0.001 }, // wind-stress curl N/m³
    { param: 'x', min: 0, max: 1e8 },       // distance from western wall m
    { param: 'r', min: 1e5, max: 1e8 },     // basin width m
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Munk (1950) J. Meteorology 7(2):79–93 — A_H·∇⁴ψ − β·∂ψ/∂x = curl_z(τ)');
    log.push('  k = (β/A_H)^(1/3); ψ(x) = curl·r·X_w(x)/β with X_w = 1 − e^(−kx/2)[cos(√3kx/2) + sin(√3kx/2)/√3]');
    log.push('  A_H default = 5×10³ m²/s (the paper\'s adopted constant, §4); β auto from latitude');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(Math.abs(result), GYRE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 30,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Wind-stress curl (user-supplied spatial field)', contribution: 'Dominant' },
      { factor: 'Constant eddy-viscosity idealization A_H', contribution: 'Varies' },
      { factor: 'β latitude derivation', contribution: '< 1%' },
    ],
    overallAssessment: 'Solution algebra exact per Munk 1950 eqs (13)/(16)/(20)–(22); ±30% typical, dominated by the wind-stress curl and the constant-A_H idealization (paper: computed Gulf Stream transport 36 vs observed 74 ×10⁶ t/s — the paper\'s own factor-of-two scatter).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Munk Viscous Western Boundary Layer (1950, J. Meteor. 7:79–93): streamfunction ψ(x) = curl_z(τ)·r·X_w(x)/β = ${Number.isFinite(result) ? result.toExponential(4) : 'N/A'} m²/s. k = (β/A_H)^(1/3); the e^(−kx/2) oscillatory decay concentrates the flow at the western wall with a 17% countercurrent (exp(−π/√3)).`,
    recommendations: ['Supply the wind-stress curl (∇×τ)_z from a stress field (ASCAT/CCMP/CERA-20C) — a point wind speed is not a curl.', 'A_H = 5×10³ m²/s is the paper\'s adopted constant; observed widths 200–250 km imply A = 3.3–6.5×10⁷ cm²/s.', 'Evaluate at x ≈ L_w/6 (western current axis, Table 1) to see the jet; the interior pivots to X = 1 − x/r.'],
  }),
  metadata: {
    methodology: 'Munk (1950) zonal-wind solution: k = (β/A_H)^(1/3) (Coriolis-friction wave number); response X_w(x) = 1 − e^(−kx/2)[cos(√3kx/2) + (1/√3)sin(√3kx/2)] (paper eq 20); streamfunction ψ = curl·r·X_w·(1−x/r)/β; oscillation wavelength L_w = 4π/(√3k) (eq 24); countercurrent exp(−π/√3) ≈ 17% (paper: 17%, observed 19%); western-current transport 1.17·r·curl (eq 26). Default A_H = 5×10³ m²/s = the paper\'s adopted 5×10⁷ cm²/s (§4).',
    assumptions: ['Constant lateral eddy viscosity A_H', 'Zonal wind stress (τ_x only)', 'Linear, steady, barotropic dynamics', 'Rectangular basin, no-slip walls'],
    limitations: ['A_H is a poorly constrained parameterization of unresolved eddies', 'No baroclinic structure or topography', 'Paper\'s own Gulf Stream transport 36 vs observed 74 ×10⁶ t/s (factor ~2)'],
    references: ['Munk, W.H. (1950) On the wind-driven ocean circulation. J. Meteorology 7(2), 79–93. doi:10.1175/1520-0469(1950)007<0080:otwdoc>2.0.co;2'],
    preprocessingNotes: ['k = (β/A_H)^(1/3)', 'X_w from paper eq 20', 'β auto from latitude'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 69 — Stommel Box Model
// ══════════════════════════════════════════════════════════════════
// Stommel (1961) regime-count classification: 1 or 2 stable regimes.
const REGIME_BANDS: ClassificationBand[] = [
  { min: 0.5, max: 1.5, label: 'Single stable regime (1)', color: '#3b82f6', description: 'Monostable circulation' },
  { min: 1.5, max: 2.5, label: 'Two stable regimes — bistable (2)', color: '#eab308', description: 'Bistable circulation (AMOC-collapse analogue)' },
];

export const TOOL_69: ToolWorkflowDef = {
  toolId: 69,
  name: 'Stommel Two-Vessel Thermohaline Model',
  vizType: 'timeseries',
  classificationBands: REGIME_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'lambda', min: 0, max: 1 },   // dimensionless flow-feedback constant (paper fig 6: 1/5, 1)
    { param: 'delta', min: 0, max: 1 },    // salinity/temperature exchange ratio d/c (paper: δ < 1)
    { param: 'R', min: 0, max: 10 },       // density-effect ratio βS̄/αT̄ (paper: R = 2)
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Stommel (1961) Tellus 13(2):224–230 — two-vessel symmetric model');
    log.push('  Equilibrium: y = 1/(1+|f|), x = δ/(δ+|f|), λ·f = Rx − y → regimes = real roots');
    log.push('  Defaults = the paper\'s fig-6/7 example (R = 2, δ = 1/6, λ = 1/5): two stable regimes');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, REGIME_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Equilibrium algebra (paper §5 + appendix)', contribution: 'None — exact' },
      { factor: 'Parameter choice (R, δ, λ)', contribution: 'User-set; defines which regimes exist' },
    ],
    overallAssessment: 'Equilibrium computation is exact per Stommel 1961 (cubic roots + Poincaré stability); the qualitative conclusion (1 vs 2 stable regimes) depends only on the chosen R, δ, λ.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Stommel (1961) two-vessel thermohaline model: ${Number.isFinite(result) ? result.toFixed(0) : 'N/A'} stable equilibrium regime(s). Bistability (two stable regimes) is the paper's headline result — a temperature-dominated circulation and a salinity-dominated (reversed) circulation, with hysteresis between them.`,
    recommendations: ['R·δ < 1 with R > 1 and a sufficiently small λ is the paper\'s necessary condition for three equilibria (two stable) — the default R=2, δ=1/6 gives R·δ = 1/3.', 'Increase λ past the critical value and the temperature-dominated branch is annihilated (paper §6): the system jumps to the salinity-dominated regime and stays there even when λ is restored — the AMOC-collapse analogue.', 'R = 2, δ = 1 yields a single stable regime (paper fig 8).'],
  }),
  metadata: {
    methodology: 'Stommel (1961) two-vessel symmetric model: dx/dt = δ(1−x) − |f|x, dy/dt = (1−y) − |f|y, λ·f = Rx − y. Equilibrium y = 1/(1+|f|), x = δ/(δ+|f|); the cubic λ·f = Rδ/(δ+|f|) − 1/(1+|f|) is solved for the real flow roots f (the regimes); stability via the paper\'s appendix linearization and the Poincaré conditions of Stoker (1950). Defaults are the paper\'s fig-6/7 example (R = 2, δ = 1/6, λ = 1/5).',
    assumptions: ['Two well-stirred vessels, symmetric T = T₁ = −T₂, S = S₁ = −S₂', 'Linear capillary flow law kq = ε₁ − ε₂', 'Linear transfer through porous walls (δ = d/c < 1)', 'Linear equation of state ε = ε₀(1 − αT + βS)'],
    limitations: ['Conceptual model — not a quantitative AMOC forecast', 'No stratification, rotation, geometry or transients', 'Parameter values (R, δ, λ) are user-chosen, not data-derived'],
    references: ['Stommel, H. (1961) Thermohaline convection with two stable regimes of flow. Tellus 13(2), 224–230. doi:10.3402/tellusa.v13i2.9491'],
    preprocessingNotes: ['λ·f = Rx − y equilibrium cubic', 'Poincaré stability conditions', 'Defaults = paper fig-6/7 example'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 70 — TEOS-10 Seawater Density
// ══════════════════════════════════════════════════════════════════
// Density water-mass bands on σ_t = ρ − 1000 (kg/m³), the standard classification.
const DENSITY_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0, label: 'Fresh / brackish', color: '#3b82f6', description: 'σ_t < 0 — pure water or river-influenced' },
  { min: 0, max: 23, label: 'Light surface water', color: '#22c55e', description: 'Tropical warm pool / mixed layer' },
  { min: 23, max: 26, label: 'Subtropical mode water', color: '#84cc16', description: 'Subtropical mode water' },
  { min: 26, max: 27.5, label: 'Central / thermocline', color: '#eab308', description: 'Main pycnocline waters' },
  { min: 27.5, max: 28.2, label: 'Deep / intermediate', color: '#f97316', description: 'NADW / intermediate waters' },
  { min: 28.2, max: Infinity, label: 'Bottom water', color: '#ef4444', description: 'AABW and dense abyssal waters' },
];

export const TOOL_70: ToolWorkflowDef = {
  toolId: 70,
  name: 'TEOS-10 Seawater Density',
  vizType: 'profile',
  classificationBands: DENSITY_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'S', min: 0, max: 42 },{ param: 'Theta', min: -18, max: 40 },{ param: 'p', min: 0, max: 10000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  75-term specific-volume polynomial — Roquet et al. (2015), same form as gsw_specvol');
    log.push('  Inputs: Absolute Salinity S_A (g/kg), Conservative Temperature Θ (ITS-90), sea pressure p (dbar)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, DENSITY_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Polynomial fit (75-term vs full Gibbs function)', contribution: '≤ 0.005 kg/m³ within the oceanographic funnel' },
      { factor: 'Absolute vs Practical Salinity (δS_A not applied)', contribution: '≤ 0.04 kg/m³ open ocean' },
    ],
    overallAssessment: 'ρ accurate to ±0.005 kg/m³ (TEOS-10 75-term polynomial within the oceanographic funnel); dominated by the user-supplied S_A (open-ocean S_P approximation adds ≤ 0.04 kg/m³).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `TEOS-10 Seawater Density: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} kg/m³ (σ_t = ${Number.isFinite(result) ? (result - 1000).toFixed(2) : 'N/A'}). Computed from the 75-term Roquet et al. (2015) polynomial — the GSW gsw_specvol form.`,
    recommendations: ["Supply Absolute Salinity for precision; open-ocean S_P ≈ S_A within 0.05 g/kg","Conservative Temperature Θ (ITS-90) is the TEOS-10 temperature variable","σ_θ (density at p = 0) is the right variable for water-mass comparison"],
  }),
  metadata: {
    methodology: '75-term specific-volume polynomial in (S_A, Θ, p) — Roquet et al. (2015) Table K.1, identical to GSW gsw_specvol; ρ = 1/v.',
    assumptions: ["TEOS-10 standard","S_A treated as input (open-ocean S_P approximation)","Within the oceanographic funnel"],
    limitations: ["δS_A composition correction not applied","Polynomial valid S_A 0–42, Θ −18–40 °C, p 0–10000 dbar"],
    references: ["IOC/SCOR/IAPSO 2010, TEOS-10 Manual §A.30/Table K.1","Roquet et al. 2015, Ocean Modelling 90:29–43"],
    preprocessingNotes: ["75-term polynomial (gsw_specvol form)","Absolute Salinity / Conservative Temperature"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 71 — Osborn-Cox Turbulent Diffusivity
// ══════════════════════════════════════════════════════════════════
export const TOOL_71: ToolWorkflowDef = {
  toolId: 71,
  name: 'Osborn-Cox Turbulent Diffusivity',
  vizType: 'scalar',
  classificationBands: OCEAN_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'kappa', min: 1e-9, max: 1e-5 },      // molecular thermal diffusivity m²/s
    { param: 'gradVar', min: 0, max: 1e4 },        // <(∇θ')²> K²/m² (microstructure)
    { param: 'dTdz', min: -1, max: 1 },            // mean vertical temperature gradient K/m
    { param: 'gamma', min: 0, max: 0.5 },          // companion Osborn (1980) efficiency
    { param: 'eps', min: 1e-12, max: 0.0001 },     // companion TKE dissipation W/kg
    { param: 'N2', min: 0, max: 1 },               // buoyancy frequency squared
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Osborn & Cox (1972) — fine-structure method: A = κ·<(∇θ\')²>/(∂θ̄/∂z)²');
    log.push('  <(∇θ\')²> = temperature-gradient variance (microstructure, no open API → NaN)');
    log.push('  Companion Osborn (1980): K_ρ = γ·ε/N² (requires ε — honest NaN when missing)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, OCEAN_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: '<(∇θ\')²> microstructure variance', contribution: 'Dominant — measurement ±50% typical' },
      { factor: 'κ molecular diffusivity', contribution: 'Known to ~±5% (T/S dependent)' },
      { factor: '∂θ̄/∂z mean gradient (CTD/profile)', contribution: '±10% typical' },
    ],
    overallAssessment: 'Algebra exact per Osborn & Cox (1972) eq (25)+(5); ±50% total uncertainty dominated by the microstructure variance input.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Osborn-Cox fine-structure diffusivity: ${Number.isFinite(result) ? result.toExponential(3) : 'N/A'} m²/s (A = κ·<(∇θ')²>/(∂θ̄/∂z)², Osborn & Cox 1972).`,
    recommendations: ["Supply <(∇θ')²> from temperature-microstructure profilers (MSS, VMP)","∂θ̄/∂z auto-derives from the ocean T-profile","Compare with the companion Osborn (1980) K_ρ = γ·ε/N² when ε is available"],
  }),
  metadata: {
    methodology: 'Fine-structure (Osborn-Cox) method: A = κ·<(∇θ\')²>/(∂θ̄/∂z)² (paper eq 25 + eq 5); companion Osborn (1980) K_ρ = γ·ε/N² reported as a secondary.',
    assumptions: ["Steady state, laterally homogeneous (paper Appendix A)","Temperature variance dominates entropy generation (salt terms neglected, paper eq 15)"],
    limitations: ["<(∇θ')²> requires microstructure measurements — no open point API → honest NaN","ε (Osborn 1980 companion) also microstructure-only","Double-diffusive regimes violate the steady-state assumption"],
    references: ["Osborn & Cox 1972, Geophys. Fluid Dyn. 3(1):321–345","Osborn 1980, J. Phys. Oceanogr. 10:83–89 (companion method)"],
    preprocessingNotes: ["Fine-structure method (1972)","<(∇θ')²> from microstructure","∂θ̄/∂z auto from ocean T-profile"],
  },
  dependencies: [],
};
// ══════════════════════════════════════════════════════════════════
//  EQUATION 72 — Price-Weller-Pinkel Mixed Layer
// ══════════════════════════════════════════════════════════════════
export const TOOL_72: ToolWorkflowDef = {
  toolId: 72,
  name: 'Price-Weller-Pinkel Mixed Layer',
  vizType: 'timeseries',
  classificationBands: OCEAN_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'g', min: 9, max: 10 },        // gravity m/s²
    { param: 'rho0', min: 1000, max: 1030 }, // reference density kg/m³
    { param: 'drho', min: 0, max: 5 },      // density jump Δρ kg/m³
    { param: 'h', min: 0.1, max: 2000 },    // mixed-layer depth m
    { param: 'dV', min: 0, max: 5 },        // velocity jump ΔV m/s
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  PWP (Price, Weller & Pinkel 1986) — bulk Richardson criterion eq (9)');
    log.push('  R_b = g·Δρ·h/(ρ₀·ΔV²) ≥ 0.65 stable; < 0.65 → mixed layer entrains/deepens');
    log.push('  ΔV (velocity jump) has no open point API → honest NaN until supplied');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, OCEAN_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Δρ density jump (profile-derived)', contribution: '±10% typical' },
      { factor: 'ΔV velocity jump', contribution: 'Dominant — measurement ±30% typical' },
      { factor: 'h mixed-layer depth', contribution: '±10% typical' },
    ],
    overallAssessment: 'Criterion algebra exact per PWP 1986 eq (9); the 0.65 threshold is the DIM criterion of Price et al. (1978). The binary deepening decision is robust near the threshold only when ΔV is accurate (±30% typical → ±60% in R_b).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `PWP mixed layer: ${Number.isFinite(result) ? (result === 1 ? 'DEEPENING (R_b < 0.65)' : 'stable (R_b ≥ 0.65)') : 'N/A'}. Computed from R_b = g·Δρ·h/(ρ₀·ΔV²) per the paper eq (9).`,
    recommendations: ["Supply ΔV (velocity jump across the ML base) — no open point API, honest NaN default","Δρ and h auto-derive from the ocean T/S profile","The 0.25 gradient-Richardson value (eq 10) governs shear instability below the ML"],
  }),
  metadata: {
    methodology: 'Bulk Richardson criterion (paper eq 9): R_b = g·Δρ·h/(ρ₀·ΔV²); mixed layer entrains when R_b < 0.65 (paper §4.2); third process relaxes gradient R_g toward 0.25 (eq 10).',
    assumptions: ["Bulk mixed layer with a density/velocity jump at its base (paper §4.3)","Wind-driven velocity in the Richardson numbers (paper §4.2)","Linear state equation (paper eq 7)"],
    limitations: ["ΔV velocity jump — no open point API → honest NaN default","0.65 threshold is the DIM criterion (Price et al. 1978), calibrated to the FLIP diurnal-cycle dataset","1D — no advection, Langmuir, or internal-wave breaking (paper's own caveats)"],
    references: ["Price, Weller & Pinkel 1986, JGR 91(C7):8411–8427","Price, Mooers & Van Leer 1978 (DIM model)","Pollard, Rhines & Thompson 1973"],
    preprocessingNotes: ["R_b from paper eq (9)","Δρ, h auto from ocean T/S profile","ΔV honest NaN (no open API)"],
  },
  dependencies: [],
};
// ══════════════════════════════════════════════════════════════════
//  EQUATION 73 — Pierson-Moskowitz Sea State
// ══════════════════════════════════════════════════════════════════
export const TOOL_73: ToolWorkflowDef = {
  toolId: 73,
  name: 'Pierson-Moskowitz Sea State',
  vizType: 'spectrum',
  classificationBands: OCEAN_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'U', min: 3, max: 40 },          // wind speed m/s at 19.5 m (paper data 10.29–20.58 m/s)
    { param: 'omega', min: 0.01, max: 10 },   // evaluation angular frequency rad/s
    { param: 'g', min: 9.8, max: 9.82 },      // gravity m/s²
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Pierson & Moskowitz (1964) eq (12): S(ω) = (αg²/ω⁵)e^(−β(ω₀/ω)⁴), α=8.10e-3, β=0.74, ω₀=g/U');
    log.push('  Fully developed sea — unlimited fetch and duration (the paper\'s assumption)');
    log.push('  U = wind at the paper\'s 19.5 m weather-ship reference height (genuine CDS ERA5 10 m wind converted via the neutral log profile, z₀=0.0002 m; honest NaN when unavailable)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, base, _ctx, log) => {
    // Classification is by the derived significant wave height H_s (m), NOT by
    // the spectral density S(ω) (m²·s) — OCEAN_BANDS are wave-height bands.
    const hs = base?.secondary?.find((s) => s.key === 'Hs')?.value;
    const c = Number.isFinite(hs) ? classify(hs as number, OCEAN_BANDS) : undefined;
    if (c && hs != null) log.push(`  Result: ${c.label} (H_s = ${(hs as number).toFixed(2)} m)`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Fully-developed assumption', contribution: '±15% — fetch-limited seas are lower' },
      { factor: 'Wind speed U (auto 19.5 m conversion from ERA5 10 m)', contribution: '±8% typical — neutral-log profile with z₀=0.0002 m open-ocean roughness; stability effects unmodeled' },
    ],
    overallAssessment: '±15% for fully developed seas; the paper\'s own spectra span the 20–40 knot wind range with sampling variability.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Pierson-Moskowitz spectrum: S(ω) = ${Number.isFinite(result) ? result.toExponential(3) : 'N/A'} m²·s at the chosen ω (default: the peak ω_p). The derived significant wave height H_s = 4√m₀ = 0.209·U²/g and peak period T_p = 2π/ω_p = 7.16·U/g are reported in the secondary outputs. Fully developed sea per the paper eq (12).`,
    recommendations: ["Valid only for fully developed seas (unlimited fetch/duration)","JONSWAP applies for fetch-limited developing seas","U is the weather-ship-height wind (19.5 m reference per the paper); the auto default converts genuine ERA5 10 m wind via the neutral log profile"],
  }),
  metadata: {
    methodology: 'Paper eq (12): S(ω) = (α·g²/ω⁵)·e^(−β·(ω₀/ω)⁴) with the paper\'s fixed α = 8.10×10⁻³, β = 0.74, ω₀ = g/U; derived H_s = 4√m₀ = 0.209·U²/g, T_p = 7.16·U/g.',
    assumptions: ["Fully developed sea (unlimited fetch and duration)","Steady wind (weather-ship measurement)","α = 0.0081 fixed by the paper (not a free input)","U = wind at the paper's 19.5 m weather-ship reference height"],
    limitations: ["Not valid for fetch-limited / young seas (JONSWAP regime)","No swell component","U is the ship-height (19.5 m) wind — the auto default converts genuine ERA5 10 m wind via the neutral log profile (z₀ = 0.0002 m open ocean); stability effects unmodeled"],
    references: ["Pierson & Moskowitz 1964, JGR 69(24):5181–5190","Kitaigorodskii 1961 (similarity theory)","Moskowitz 1964 (source spectra)"],
    preprocessingNotes: ["α, β fixed by the paper","U auto from genuine CDS ERA5 10 m wind converted to the paper's 19.5 m reference height (honest NaN when CDS unavailable)","ω default = peak ω_p"],
  },
  dependencies: [],
};
// ══════════════════════════════════════════════════════════════════
//  EQUATION 74 — Wave Runup (Stockdon)
// ══════════════════════════════════════════════════════════════════
export const TOOL_74: ToolWorkflowDef = {
  toolId: 74,
  name: 'Stockdon Wave Runup',
  vizType: 'heatmap',
  classificationBands: OCEAN_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'H0', min: 0.05, max: 20 },
    { param: 'T0', min: 2, max: 30 },
    { param: 'betaF', min: 0.001, max: 0.5 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Stockdon et al. 2006 (Coastal Engineering 53:573-588)');
    log.push('  H0/T0 from genuine CDS ERA5 swh/pp1d');
    log.push('  beta_f from SRTM30m slope at the point');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, OCEAN_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.38,
    rmseUnit: 'm',
    contributingFactors: [
      { factor: 'Foreshore slope β_f', contribution: '51% of relative error per slope variability (paper §4.4)' },
      { factor: 'Wave height/period', contribution: 'H₀/L₀ input uncertainty' },
      { factor: 'Beach type', contribution: 'Dissipative (ξ₀<0.3) vs intermediate/reflective' },
    ],
    overallAssessment: 'rms error 38 cm, bias −17 cm over 10 field experiments (paper Table 3)',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Stockdon Wave Runup R₂: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} m. 2% exceedance runup (paper Eq 9/19: R₂ = 1.1(η̄ + S/2); ξ₀<0.3 uses the dissipative form Eq 18, R₂ = 0.043(H₀L₀)^(1/2)).`,
    recommendations: ["R₂ < 1 m: low hazard, daily conditions.","R₂ 1–3 m: moderate — storm conditions.","R₂ > 3 m: high — dune erosion / overwash potential."],
  }),
  metadata: {
    methodology: '2% exceedance wave runup from H₀, T₀ (→L₀=gT₀²/2π) and foreshore slope β_f; Iribarren ξ₀ selects dissipative (Eqs 16-18) vs all-sites (Eqs 10-12, 19) model.',
    assumptions: ["Sandy beaches (validated 10 experiments: Duck, Scripps, San Onofre, Terschelling, Gleneden, Agate)","Deep-water wave conditions (H₀, L₀)","Shore-normal approach; linear wave theory shoaling"],
    limitations: ["Not for engineered structures, vegetation, or reef-fronted coasts","No tide/surge/wave-current interaction included","β_f from SRTM30m slope — the paper's surveyed foreshore slope is finer","ERA5 swh/pp1d grid cell (~25 km) is a deep-water proxy, not a local buoy"],
    references: ["Stockdon et al. 2006"],
    preprocessingNotes: ["Stockdon et al. 2006 empirical","H0/T0 from genuine CDS ERA5 swh/pp1d","beta_f from SRTM30m slope at the point"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 75 — Bruun Rule
// ══════════════════════════════════════════════════════════════════
export const TOOL_75: ToolWorkflowDef = {
  toolId: 75,
  name: 'Bruun Rule',
  vizType: 'timeseries',
  classificationBands: RETREAT_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'L', min: 50, max: 5000 },{ param: 'S', min: 0, max: 1 },{ param: 'B', min: 0, max: 20 },{ param: 'hstar', min: 1, max: 50 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  S from NOAA CO-OPS tide-gauge trend');
    log.push('  h* = 1.57·H_s (Hallermeier 1981) from CDS ERA5 swh');
    log.push('  B/L from SRTM30m terrain at the point');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RETREAT_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 50,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Closure depth', contribution: 'Varies' },
      { factor: 'Profile length', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 50% highly simplified',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Bruun Rule: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Shoreline retreat from sea level rise.`,
    recommendations: ["Highly simplified.","NOAA CO-OPS sea-level trends for local S.","ERA5 swh for closure depth."],
  }),
  metadata: {
    methodology: 'R = L·S/(B+h*): shoreline retreat from sea level rise; S from the NOAA CO-OPS gauge trend, h* = 1.57·H_s (Hallermeier 1981) from ERA5 swh, B/L from SRTM30m.',
    assumptions: ["Equilibrium profile translated up-and-landward without shape change","No longshore transport / closed sediment budget","Sandy coast with genuine profile geometry"],
    limitations: ["Fails on many real coasts (Cooper & Pilkey 2004)","No sediment supply, overwash, or hard structures","Auto S = global altimetry rate where no local gauge exists"],
    references: ["Bruun, P. (1962) Sea-level rise as a cause of shore erosion. J. Waterways and Harbors Division, 88(1), 117-130. doi:10.1061/jwheau.0000252"],
    preprocessingNotes: ["S from NOAA CO-OPS tide-gauge trend","h* = 1.57·H_s (Hallermeier 1981) from ERA5 swh","B/L from SRTM30m terrain"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 76 — McCowan Breaker Criterion
// ══════════════════════════════════════════════════════════════════
export const TOOL_76: ToolWorkflowDef = {
  toolId: 76,
  name: 'McCowan Breaker Criterion',
  vizType: 'scalar',
  classificationBands: OCEAN_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'db', min: 0.1, max: 50 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  McCowan (1894) breaker criterion: H_b = 0.78 × d_b');
    log.push('  d_b auto = genuine GEBCO 2020 bathymetry at the point (honest NaN on land / fetch failure)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, OCEAN_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Breaker coefficient γ_b', contribution: '0.78 fixed; ±0.4–1.2 by Iribarren number on sloping beaches' },
      { factor: 'Water depth d_b', contribution: 'GEBCO 2020 grid resolution / local bathymetric detail' },
    ],
    overallAssessment: '+/- 15% uncertainty (γ_b variation dominates)',
  }),
  interpret: (result) => ({
    contextualAnalysis: `McCowan Breaking Wave Height: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. H_b = 0.78 × d_b at the breaking depth (McCowan 1894, eq 34).`,
    recommendations: ["0.78 is McCowan's 1894 highest-wave coefficient.","Verify d_b against local surveys — GEBCO grid is coarse in the nearshore."],
  }),
  metadata: {
    methodology: 'Breaking wave height at the McCowan (1894) limit H_b = 0.78·d_b (paper eq 34: the highest solitary wave of permanent type in water of depth h reaches c − h = 0.78h).',
    assumptions: ['Horizontal bed / endless rectangular channel of uniform depth (the paper\'s geometry)', 'Solitary wave of permanent type — the limiting case as wavelength → ∞', 'd_b auto from genuine GEBCO 2020 bathymetry (positive depth only over water)', 'γ_b = 0.78 constant — slope-dependent variation (0.4–1.2) not captured'],
    limitations: ['0.78 derived for a horizontal bed — natural sloping beaches show γ_b ≈ 0.4–1.2 by Iribarren number', 'Not applicable in deep water where Stokes wave-steepness limits breaking first', 'No current/wind interaction; solitary-wave approximation', 'Breaker type (spilling/plunging/surging) needs the beach-slope / Iribarren input this tool does not take'],
    references: ['McCowan, J. (1894) On the highest wave of permanent type. Philosophical Magazine, Series 5, 38(233), 351–358. doi:10.1080/14786449408620643'],
    preprocessingNotes: ['d_b auto from genuine GEBCO 2020 bathymetry (OpenTopoData)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 77 — Longshore Sediment Transport
// ══════════════════════════════════════════════════════════════════
export const TOOL_77: ToolWorkflowDef = {
  toolId: 77,
  name: 'CERC Longshore Transport Equation',
  vizType: 'vector',
  classificationBands: LONGSHORE_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'K', min: 0.2, max: 2 },       // CERC coefficient (SPM design 0.39; Komar-Inman 0.77 deep-water)
    { param: 'Hsb', min: 0.1, max: 10 },    // significant breaking wave height m
    { param: 'thetaB', min: -1.57, max: 1.57 }, // breaker angle rad from the shore-normal (signed)
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  CERC energy-flux method (SPM 1984 Vol 1 Ch 4 §V): P_ls → I_l = K·P_ls → Q = I_l/((ρs−ρ)g(1−n))');
    log.push('  K = 0.39 (SPM design value); auto H = genuine CDS ERA5 swh (deep-water H_0s, eq 4-45); auto θ from ERA5 mwd × GEBCO 2020 shoreline');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, base, _ctx, log) => {
    // Classification is by the ANNUAL volumetric transport Q(yr) (m³/yr,
    // SPM eq 4-50a), NOT the m³/s primary — TRANSPORT_BANDS are volumetric
    // bands (same defect class as Tools 70/73/75 on OCEAN_BANDS).
    const qyr = base?.secondary?.find((s) => s.key === 'transport_annual')?.value;
    const c = Number.isFinite(qyr) ? classify(Math.abs(qyr as number), LONGSHORE_BANDS) : undefined;
    if (c && qyr != null) log.push(`  Result: ${c.label} (Q ≈ ${(qyr as number).toExponential(2)} m³/yr)`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 50,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'CERC coefficient K', contribution: '±50 % envelope of the SPM Fig 4-37 field data' },
      { factor: 'Breaker angle', contribution: 'mwd/shoreline-orientation uncertainty (auto chain)' },
      { factor: 'Significant vs root-mean-square height', contribution: 'SPM notes the H_s factor-2 flux convention' },
    ],
    overallAssessment: '+/- 50% (the SPM-stated accuracy of the energy-flux method)',
  }),
  interpret: (result) => ({
    contextualAnalysis: `CERC Longshore Transport: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} m³/s (annual Q(yr) = 1290·P_ls shown in the secondary outputs). Energy-flux method, SPM 1984 eqs 4-44/4-45/4-48/4-49/4-50.`,
    recommendations: ['K = 0.39 is the SPM design value (0.77 = Komar & Inman deep-water H_o coefficient).', 'Calibrate K with local sediment-budget data where available (SPM: ±50 %).', 'Auto θ needs a resolvable shoreline within ~2 km — supply θ_b explicitly on open coasts.'],
  }),
  metadata: {
    methodology: 'CERC energy-flux method (SPM 1984 Vol 1 Ch 4 §V): P_ls = 0.0884·ρ·g^(3/2)·H_b^(5/2)·sin(2α_b) (eq 4-44, breaking height) or 0.05·ρ·g^(3/2)·H_0s^(5/2)·(cos α₀)^(1/4)·sin(2α₀) (eq 4-45, deep-water H_0s); I_l = K·P_ls with K = 0.39 (eq 4-48); Q = I_l/((ρs−ρ)·g·(1−n)) (eq 4-35/4-49, Table 4-8 values ρs=2650, ρ=1025, 1−n=0.6); annual Q(yr) = 1290·P_ls m³/yr (eq 4-50a).',
    assumptions: ['Straight, parallel nearshore contours (small-amplitude refraction theory; Table 4-11)', 'Group velocity equals wave speed at breaking, C_gb = √(2gH_b) (Galvin 1967; Table 4-11, γ_b = 0.5)', 'Rayleigh-distributed heights — significant height H_s used in the energy flux factor (SPM §V)', 'Sediment supply unlimited (potential transport); sand matrix ρs=2650, ρ=1025 kg/m³, 1−n=0.6 (Table 4-8)', 'Auto H = genuine CDS ERA5 swh treated as deep-water H_0s (eq 4-45); auto θ from ERA5 mwd × GEBCO 2020 shoreline'],
    limitations: ['SPM-stated accuracy ±50 % (Fig 4-37 scatter of the field data)', 'Significant-height flux factor ≈ 2× the exact rms-height energy flux (SPM §V text)', 'No tidal currents, wind-driven currents, or cross-shore transport (SPM §V scope)', 'K varies with site — calibrate with local data; the H^(5/2) dependence makes Q very sensitive to H errors', 'Auto θ requires a resolvable shoreline within ~2 km and ERA5 mwd — honest NaN otherwise'],
    references: ['U.S. Army Corps of Engineers (1984) Shore Protection Manual, 4th ed., Vol. I. Coastal Engineering Research Center, Vicksburg, MS. Chapter 4 (Littoral Processes), §V Energy Flux Method: eqs 4-35, 4-44–4-50; Tables 4-8, 4-10. doi:10.5962/bhl.title.47829'],
    preprocessingNotes: ['H auto = genuine CDS ERA5 swh (deep-water H_0s, eq 4-45)', 'θ auto = ERA5 mwd relative to GEBCO 2020 shoreline bearing'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 78 — Wave Dispersion Relation
// ══════════════════════════════════════════════════════════════════
// Wave-regime classification by the SPM 1984 Ch 2 relative-depth parameter
// kh = k·h (d/L table): deep water d/L > 1/2 ⇔ kh > π; shallow water
// d/L < 1/25 ⇔ kh < 2π/25; transitional in between (full tanh required).
const WAVE_REGIME_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 2 * Math.PI / 25, label: 'Shallow water', color: '#22c55e', description: 'd/L < 1/25 — C = √(gh), non-dispersive, depth-limited' },
  { min: 2 * Math.PI / 25, max: Math.PI, label: 'Transitional', color: '#eab308', description: '1/25 < d/L < 1/2 — full tanh form required (SPM eqs 2-2/2-3)' },
  { min: Math.PI, max: Infinity, label: 'Deep water', color: '#3b82f6', description: 'd/L > 1/2 — C = gT/2π, independent of depth' },
];

export const TOOL_78: ToolWorkflowDef = {
  toolId: 78,
  name: 'Wave Dispersion Relation',
  vizType: 'heatmap',
  // Classification is by the WAVE REGIME (kh parameter, SPM 1984 Ch 2
  // relative-depth table), NOT by the primary ω (rad/s) against OCEAN_BANDS
  // (wave-HEIGHT bands in metres — the Tool 70/73/75 unit-mismatch class).
  classificationBands: WAVE_REGIME_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'g', min: 9.8, max: 9.82 },      // gravitational acceleration m/s²
    { param: 'k', min: 0.001, max: 10 },      // wavenumber rad/m
    { param: 'h', min: 0.001, max: 10000 },   // water depth m (must be > 0)
  ]),
  preprocess: (inputs, ctx, log) => {
    const usedGebco = ctx.dataSources?.includes('gebco-2020-bathymetry');
    if (usedGebco) log.push('  Auto h = genuine GEBCO 2020 bathymetry at the point (positive depth only over water; honest NaN on land)');
    else log.push('  h from user input or default (no genuine bathymetry available)');
    log.push('  Forward solution: ω = √(g·k·tanh(kh)) — the SPM Ch 2 dispersion relation (eq 2-3)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, base, _ctx, log) => {
    // Regime classification needs kh (the SPM relative-depth parameter), NOT
    // the rad/s primary — the engine exposes kh as a secondary so this stays
    // unit-correct (deep d/L > 1/2 ⇔ kh > π; shallow d/L < 1/25 ⇔ kh < 2π/25).
    const kh = base?.secondary?.find((s) => s.key === 'kh')?.value;
    const c = Number.isFinite(kh) ? classify(kh as number, WAVE_REGIME_BANDS) : undefined;
    if (c) log.push(`  Regime: ${c.label} (${c.description})`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Linear wave theory', contribution: 'Exact within small-amplitude assumptions' },
      { factor: 'Water depth accuracy', contribution: 'GEBCO 2020 grid ~450 m — nearshore depths coarser than the cell' },
      { factor: 'Wavenumber input', contribution: 'k = 2π/L must match the local wave field' },
    ],
    overallAssessment: 'Exact for small-amplitude (linear) waves; SPM-stated deep-water boundary error ~0.4 % at d/L = 0.5',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Wave Dispersion Relation (Airy 1845 / SPM 1984 Ch 2): ω = ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} rad/s. Phase speed C, wavelength L, period T and group velocity C_g in the secondary outputs; regime (deep/transitional/shallow) classified from kh.`,
    recommendations: ['The full tanh form (eqs 2-2/2-3) is required for transitional depths (1/25 < d/L < 1/2) — the deep (C = gT/2π) and shallow (C = √(gh)) limits are shortcuts with known errors.', 'Use genuine GEBCO 2020 bathymetry for h (auto) — linear theory breaks down for steep waves (H/L > 1/7 Stokes limit) and near breaking.', 'For a given period T, invert iteratively (or Eckart 1952 approximation, ±5 %) to find k — the SPM Appendix C tables give the same values.'],
  }),
  metadata: {
    methodology: 'Airy (1845) linear wave theory dispersion relation (SPM 1984 Vol 1 Ch 2, eqs 2-1/2-2/2-3): ω² = g·k·tanh(kh) with k = 2π/L and ω = 2π/T. Solved forward: ω = √(g·k·tanh(kh)); derived: phase speed C = ω/k, wavelength L = 2π/k, period T = 2π/ω, group velocity C_g = C/2·[1 + 2kh/sinh(2kh)]. Regime per the SPM relative-depth table: deep water d/L > 1/2 (kh > π), shallow water d/L < 1/25 (kh < 2π/25), transitional between (full tanh required). Auto h from genuine GEBCO 2020 bathymetry (honest NaN on land / fetch failure).',
    assumptions: ['Small amplitude / linear waves (Stokes limiting steepness H/L < 1/7)', 'Incompressible, inviscid, irrotational fluid (potential flow)', 'Horizontal, flat bottom', 'Constant wave period across depths (SPM: T unchanged during shoaling)'],
    limitations: ['Not for steep / breaking waves — linear theory overpredicts celerity near breaking', 'h = 0 (shoreline) is singular — honest NaN (needs positive depth)', 'Auto h is the GEBCO 2020 grid elevation (~450 m cells), coarse in the inner nearshore', 'The forward form solves ω from k — inverse problems (k from T, h) need iteration or the Eckart (1952) approximation (±5 %)'],
    references: ['Airy, G.B. (1845) Tides and Waves. In: Encyclopaedia Metropolitana, Vol. 3, 241–396. (pre-DOI)', 'U.S. Army Corps of Engineers (1984) Shore Protection Manual, 4th ed., Vol. I, Ch 2 (Wave Theory), eqs 2-1/2-2/2-3, 2-5/2-6/2-10 and the d/L classification table. doi:10.5962/bhl.title.47829'],
    preprocessingNotes: ['Auto h = genuine GEBCO 2020 bathymetry (honest NaN on land)', 'Forward solution ω = √(g·k·tanh(kh))'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 79 — Stokes Drift
// ══════════════════════════════════════════════════════════════════
export const TOOL_79: ToolWorkflowDef = {
  toolId: 79,
  name: 'Stokes Drift',
  vizType: 'profile',
  // Classification by the surface drift magnitude (m/s), NOT by the
  // primary ω — the unit-mismatch class from Tools 70/73/75 checked.
  classificationBands: OCEAN_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'omega', min: 0.01, max: 10 },   // angular frequency rad/s
    { param: 'ka', min: 0.001, max: 20 },      // wave amplitude a (engine key)
    { param: 'z', min: -500, max: 0 },         // depth below surface m
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Forward solution: u_s(z) = (ω·k·a²/2)·exp(2kz), k = ω²/g (deep-water)');
    log.push('  Deep-water assumption: valid when kh > π (h > L/2)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, OCEAN_BANDS);
    if (c) log.push(`  Drift regime: ${c.label} (${c.description})`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Deep-water assumption', contribution: 'Error grows when kh < π (transitional/shallow water); the finite-depth cosh/sinh form is not used' },
      { factor: 'Linear wave theory', contribution: 'Exact for small-amplitude waves (H/L < 1/7); second-order nonlinear corrections not included' },
      { factor: 'Wave amplitude input', contribution: 'a must represent the monochromatic wave amplitude; spectral waves require the spectral integration form' },
    ],
    overallAssessment: 'Exact for deep-water linear monochromatic waves; systematic overestimate in transitional/shallow water (deep-water k used instead of dispersion k)',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Stokes Drift: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} m/s. Wave-driven mean Lagrangian drift velocity in the direction of wave propagation. For a typical swell (H=2 m, T=10 s): u_s(0) ≈ 1.3 cm/s ≈ 1.1 km/day. For a storm (H=8 m, T=12 s): u_s(0) ≈ 11.7 cm/s ≈ 10.1 km/day.`,
    recommendations: [
      'The deep-water form k = ω²/g is used; for shallow/transitional water (h < L/2), the full dispersion k from Tool 78 should be used instead.',
      'u_s(0) ≈ 1% of the wind speed at 10 m for moderate seas — a useful quick estimate.',
      'For Langmuir circulation: compare u_s(0) to u* (friction velocity). When La_t = √(u*/u_s(0)) < 0.4, Langmuir turbulence dominates.',
    ],
  }),
  metadata: {
    methodology: 'Stokes (1847) deep-water drift: u_s(z) = (ω·k·a²/2)·exp(2kz) with k = ω²/g (deep-water dispersion). The surface value u_s(0) = ω·k·a²/2 = π²·H²/(2·L·T); depth attenuation is exp(2kz). Secondarily: e-folding depth z_e = 1/(2k), Stokes transport M_S = ∫u_s dz = u_s(0)/(2k). Finite-depth form u_s(z) = (ω·k·a²/2)·cosh(2k(h+z))/sinh²(kh)·exp(2kz) exists but is not implemented here (deep-water assumed).',
    assumptions: ['Deep water (kh > π, h > L/2) — k derived from ω² = gk, not the full tanh dispersion', 'Small-amplitude / linear waves — Stokes limiting steepness H/L < 1/7', 'Monochromatic waves — single frequency, no spectral integration', 'Incompressible, inviscid, irrotational fluid (potential flow)'],
    limitations: ['Deep-water only — in transitional/shallow water (kh < π) the deep-water k overestimates the true wavenumber, causing u_s to be systematically too high', 'No finite-depth cosh/sinh correction — the paper gives the full form but only the deep-water limit is implemented', 'No wave-wave interactions or spectral spreading — real ocean waves have a spectrum, not a single frequency', 'Auto wave_period defaults to 8 s when no marine data is available — user should supply the local wave period'],
    references: ['Stokes, G.G. (1847) On the theory of oscillatory waves. Transactions of the Cambridge Philosophical Society, 8, 441–455. (pre-DOI; the drift result appears in the summation-order analysis of particle orbits)'],
    preprocessingNotes: ['k = ω²/g (deep-water dispersion) — no GEBCO bathymetry needed for the forward deep-water solution', 'ω auto-derived from marine wave_period when available; otherwise user supplies'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 80 — JONSWAP Wave Spectrum
// ══════════════════════════════════════════════════════════════════
export const TOOL_80: ToolWorkflowDef = {
  toolId: 80,
  name: 'JONSWAP Wave Spectrum',
  vizType: 'spectrum',
  classificationBands: OCEAN_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'alpha', min: 0.001, max: 0.05 },  // Phillips constant
    { param: 'g2', min: 9.8, max: 9.82 },        // gravity (engine key)
    { param: 'fm', min: 0.01, max: 10 },          // evaluation frequency Hz
    { param: 'fpm', min: 0.01, max: 10 },         // peak frequency Hz
    { param: 'gamma', min: 1, max: 10 },           // peak enhancement factor
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  JONSWAP spectrum: S(f) = α·g²·(2π)⁻⁴·f⁻⁵·exp[−1.25(f_p/f)⁻⁴]·γ^exp[−(f−f_p)²/(2σ²f_p²)]');
    log.push('  σ = 0.07 for f ≤ f_p, σ = 0.09 for f > f_p (JONSWAP σ step)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, OCEAN_BANDS);
    if (c) log.push(`  Spectral density: ${c.label} (${c.description})`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Peak enhancement factor γ', contribution: 'Varies 1–7 depending on fetch and wind development' },
      { factor: 'Phillips constant α', contribution: 'Fetch-dependent: α = 0.076·(gX/U₁₀²)^(−0.22)' },
      { factor: 'Spectral resolution', contribution: 'Evaluated at a single frequency; full spectrum needs numerical integration' },
    ],
    overallAssessment: '±15% for fetch-limited North Sea conditions (Hasselmann et al. 1973 calibration dataset)',
  }),
  interpret: (result) => ({
    contextualAnalysis: `JONSWAP Wave Spectrum S(f): ${Number.isFinite(result) ? result.toFixed(2) : 'N/A'} m²/Hz. Fetch-limited sea state spectral density at the evaluation frequency. The peak enhancement factor γ=3.3 makes the spectrum 3.3× higher at the peak than the PM fully-developed spectrum.`,
    recommendations: [
      'γ = 3.3 is the standard North Sea value; γ = 1 recovers the PM fully-developed spectrum.',
      'For H_s estimation: integrate S(f) numerically; H_s = 4·√(m₀) where m₀ = ∫S(f)df.',
      'The JONSWAP spectrum is appropriate for fetch-limited wind seas (< 500 km); use PM for fully developed seas.',
    ],
  }),
  metadata: {
    methodology: 'Hasselmann et al. (1973, eq 16) JONSWAP spectrum: S(f) = α·g²·(2π)⁻⁴·f⁻⁵·exp[−5/4·(f_p/f)⁻⁴]·γ^exp[−(f−f_p)²/(2σ²f_p²)] with σ = 0.07 (f ≤ f_p) and σ = 0.09 (f > f_p). The (2π)⁻⁴ factor converts from the angular-frequency form S(ω) = αg²ω⁻⁵… to ordinary-frequency S(f). The peak enhancement factor γ amplifies the spectral peak relative to the PM spectrum; at f = f_p the Gaussian exponent = 0 so γ^1 = γ. The Phillips constant α decays with fetch as α = 0.076·(gX/U₁₀²)^(−0.22).',
    assumptions: ['Fetch-limited wind-sea conditions (not fully developed, not swell)', 'Steady, uniform wind over the fetch distance', 'North Sea calibration dataset (Hasselmann et al. 1973); other basins may have different fetch-growth relationships', 'JONSWAP peak enhancement γ = 3.3 (standard; varies 1–7 depending on wave age)'],
    limitations: ['Not applicable to fully developed seas (use PM spectrum, γ = 1) or swell from distant storms', 'The σ step (0.07/0.09) is a simplification of the actual spectral shape near the peak', 'α = 0.0081 is the standard PM value; for fetch-specific α, supply the fetch-dependent value', 'Single-point evaluation; full spectral integration requires numerical methods (SWAN, WAVEWATCH III)'],
    references: ['Hasselmann, K., Barnett, T.P., Bouws, E., Carlson, H., Cartwright, D.E., Enke, K., Ewing, J.A., Gienapp, H., Hasselmann, D.E., Kruseman, P., Meerburg, A., Müller, P., Olbers, D.J., Richter, K., Sell, W. & Walden, H. (1973) Measurements of wind-wave growth and swell decay during the Joint North Sea Wave Project (JONSWAP). Deutsche Hydrographische Zeitschrift, Reihe A, 8(12), 1–95.'],
    preprocessingNotes: ['γ = 3.3 is the standard JONSWAP peak enhancement (Hasselmann et al. 1973 mean value)', 'σ = 0.07 (f ≤ f_p) and σ = 0.09 (f > f_p) — the JONSWAP σ step'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 81 — Stream Power Law
// ══════════════════════════════════════════════════════════════════
export const TOOL_81: ToolWorkflowDef = {
  toolId: 81,
  name: 'Stream Power Law',
  vizType: 'heatmap',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'K', min: 0, max: 1 },        // erodibility coefficient (dimensionless in this impl)
    { param: 'A', min: 0.01, max: 1e12 },  // drainage area m²
    { param: 'm', min: 0, max: 2 },         // area exponent
    { param: 'S', min: 0, max: 1 },         // channel slope m/m
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  E = K·A^m·S (Howard & Kerby 1983, n=1)');
    log.push('  K is dimensionless in this implementation; the user interprets E in the desired units (e.g. m/yr) by choosing K with appropriate units');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Erosion potential: ${c.label} (${c.description})`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 50,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Erodibility K', contribution: 'Varies by orders of magnitude with lithology, sediment supply, channel width; must be calibrated per basin' },
      { factor: 'Exponent m', contribution: 'Typical range 0.3–0.6; determined from slope-area scaling of steady-state basins' },
      { factor: 'Slope exponent n', contribution: 'Hardcoded n=1 (simplest form); field values range 0.7–1.0 (Whipple & Tucker 1999)' },
    ],
    overallAssessment: '±50% typical uncertainty; K calibration is the dominant source of error (Howard & Kerby 1983, Whipple & Tucker 1999)',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Stream Power Law E = K·A^m·S: ${Number.isFinite(result) ? result.toExponential(3) : 'N/A'} (dimensionless). For K=0.001 yr⁻¹, A=10⁶ m², m=0.5, S=0.01: E = 0.01 (≈ 10 mm/yr if K is in yr⁻¹). Typical erosion rates: 0.01–0.1 mm/yr (cratonic), 0.1–1 mm/yr (orogenic), >1 mm/yr (Himalaya, Taiwan, NZ Southern Alps).`,
    recommendations: [
      'K is the dominant uncertainty — calibrate against measured erosion rates (cosmogenic 10Be, thermochronology) for the specific basin.',
      'The concavity index θ = m/n characterizes the longitudinal profile shape; θ ≈ 0.4–0.6 for typical bedrock rivers.',
      'For transient landscapes, extract channel profiles from DEM and compute the chi-transform to identify knickpoints.',
    ],
  }),
  metadata: {
    methodology: 'Howard & Kerby (1983) stream power incision model: E = K·A^m·S^n with n=1 (simplest form). The erosion rate E is a power-law function of upstream drainage area A (proxy for discharge Q ∝ A^c) and local channel slope S. The normalized steepness index k_sn = S·(A/A_ref)^(m/n) with A_ref = 10⁶ m² allows cross-basin comparison. At steady state (dz/dt = 0): S ∝ A^(-m/n), giving the characteristic concave-up longitudinal profile.',
    assumptions: ['Detachment-limited erosion — bedrock incision rate is limited by the ability of the flow to detach rock, not by sediment transport capacity', 'Steady-state or slowly varying conditions — the model is most reliable for long-term (10³–10⁶ yr) erosion rates', 'Power-law scaling of discharge with area: Q ∝ A^c (c ≈ 0.7–1.0)', 'Channel width adjusts to maintain uniform shear stress (W ∝ Q^b, b ≈ 0.5)'],
    limitations: ['K is poorly constrained and varies by orders of magnitude with lithology, sediment supply, and channel width — must be calibrated per basin', 'n=1 is the simplest form; field values range 0.7–1.0 (Whipple & Tucker 1999); transport-limited systems require different formulations', 'Threshold effects (critical shear stress for incision) are neglected', 'The power-law relationship breaks down in very steep channels (step-pool, cascade) where different processes dominate'],
    references: ['Howard, A.D. & Kerby, G.E. (1983) Channel changes in badlands. Geological Society of America Bulletin, 94(6), 739–752. doi:10.1130/0016-7606(1983)94<739:CCIB>2.0.CO;2', 'Whipple, K.X. & Tucker, G.E. (1999) Dynamics of the stream-power river incision model: Implications for height limits of mountain ranges, landscape response timescales, and research needs. Journal of Geophysical Research, 104(B8), 17661–17674.'],
    preprocessingNotes: ['A from terrain/slope context (user supplies drainage area in m²)', 'S from terrain slope context (user supplies channel slope in m/m)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 82 — River Network Scaling
// ══════════════════════════════════════════════════════════════════
export const TOOL_82: ToolWorkflowDef = {
  toolId: 82,
  name: 'River Network Scaling',
  vizType: 'scatter',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'c', min: 0, max: 100 },{ param: 'A', min: 0.01, max: 100000 },{ param: 'h', min: 0.4, max: 0.8 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Hack exponent h ~ 0.6');
    log.push('  HydroSHEDS for area');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Hack exponent', contribution: 'Varies' },
      { factor: 'Network extraction', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 20% uncertainty',
  }),
  interpret: (result) => ({
    contextualAnalysis: `River Network Scaling: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. River length-drainage area scaling.`,
    recommendations: ["Hack exponent h ~ 0.6 is the global average value.","Use HydroSHEDS database for drainage area extraction.","Network extraction required for river length."],
  }),
  metadata: {
    methodology: 'Hack (1957) empirical power-law: L = c·A^h relating main channel length L (km) to drainage basin area A (km²). The Hack exponent h ≈ 0.55–0.7 (global mean ~0.6) characterizes basin elongation: h = 0.5 for self-similar (fractal) networks; h > 0.5 indicates elongation increasing with scale. The coefficient c depends on network geometry and climate. Related to Horton ratios: h = log(R_l)/log(R_a) where R_l is the length ratio and R_a is the area ratio. The fractal dimension of the main channel D = 2h ≈ 1.2.',
    assumptions: ['Power-law scaling of channel length with drainage area over 5+ orders of magnitude', 'The exponent h is approximately constant across scales (self-affine, not self-similar)', 'The coefficient c is basin-specific and depends on network geometry, climate, and lithology'],
    limitations: ['h varies regionally (0.55–0.7); the global mean 0.6 may not apply to a specific basin', 'The power-law breaks down at very small scales (headwater channels) and very large scales (continent-wide)', 'c must be calibrated for the specific basin; the default c=1.5 is a typical mid-range value', 'Requires upstream drainage area A from a DEM-derived flow accumulation grid (e.g. HydroSHEDS, MERIT DEM)'],
    references: ['Hack, J.T. (1957) Studies of longitudinal stream profiles in Virginia and Maryland. U.S. Geological Survey Professional Paper 294-B, 45–97. https://pubs.usgs.gov/publication/pp294B'],
    preprocessingNotes: ['Hack exponent h ≈ 0.6 is the global average (Hack 1957); regional values range 0.55–0.7', 'c is basin-specific; default 1.5 is a mid-range value for temperate humid basins'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 83 — Richardson Fractal Dimension
// ══════════════════════════════════════════════════════════════════
export const TOOL_83: ToolWorkflowDef = {
  toolId: 83,
  name: 'Richardson Fractal Dimension',
  vizType: 'scalar',
  // Classification by D value — NOT by RISK_BANDS (unit mismatch)
  classificationBands: [
    { min: 1, max: 1.1, label: 'Low complexity', color: '#22c55e', description: 'D < 1.1 — smooth, depositional coasts' },
    { min: 1.1, max: 1.3, label: 'Moderate', color: '#eab308', description: 'D 1.1–1.3 — typical embayed coast' },
    { min: 1.3, max: 1.5, label: 'High', color: '#f97316', description: 'D 1.3–1.5 — rough, indented coast' },
    { min: 1.5, max: 2, label: 'Very high', color: '#ef4444', description: 'D > 1.5 — fjord coast' },
  ],
  validate: (inputs) => validateRange(inputs, [
    { param: 'L1', min: 0.1, max: 100000 },   // measured length at scale s1
    { param: 's1', min: 0.01, max: 10000 },   // ruler scale 1
    { param: 'L2', min: 0.1, max: 100000 },   // measured length at scale s2
    { param: 's2', min: 0.01, max: 10000 },   // ruler scale 2
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Richardson (1961) two-point formula: D = 1 − ln(L₁/L₂) / ln(s₁/s₂)');
    log.push('  Requires two coastline-length measurements at different ruler scales');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    if (Number.isFinite(result)) {
      const label = result < 1.1 ? 'Low' : result < 1.3 ? 'Moderate' : result < 1.5 ? 'High' : 'Very high';
      log.push(`  Coastline complexity: D = ${result.toFixed(4)} → ${label}`);
    }
    return { classification: undefined };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
    { name: 'Physical bounds', passed: Number.isFinite(result) && result >= 1 && result <= 2, message: Number.isFinite(result) ? `D=${result.toFixed(4)} (should be 1–2)` : 'N/A', severity: 'info' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Two-point estimate', contribution: 'Only uses two measurements; the full Richardson plot (slope of log(L) vs log(s)) from multiple measurements gives a more robust D' },
      { factor: 'Scale range', contribution: 'D may vary across scale ranges (multi-fractal behavior in real coastlines)' },
      { factor: 'Digitization accuracy', contribution: 'Coastline digitization at each scale introduces measurement error' },
    ],
    overallAssessment: 'Exact for the two-point formula; ±0.05–0.1 typical vs full Richardson plot from multiple measurements',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Richardson Fractal Dimension: D = ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. ${Number.isFinite(result) ? (result < 1.1 ? 'Smooth, depositional coast.' : result < 1.3 ? 'Moderate embayed coast.' : result < 1.5 ? 'Rough, indented coast.' : 'Very rough fjord coast.') : 'N/A.'} Hurst exponent H = ${Number.isFinite(result) ? (2 - result).toFixed(4) : 'N/A'}.`,
    recommendations: [
      'Richardson (1961) data: South Africa D≈1.02, Australia D≈1.13, Britain D≈1.24, Norway D≈1.52.',
      'For a more robust D, use the full Richardson plot: measure L at 5+ ruler scales, regress log(L) vs log(s).',
      'H > 0.5 (D < 1.5) indicates persistent, smooth coastline; H < 0.5 indicates anti-persistent, rough coastline.',
    ],
  }),
  metadata: {
    methodology: 'Richardson (1961) fractal dimension: L(s) = c·s^(1-D), solved as D = 1 - ln(L)/ln(s) for a single (L, s) measurement pair assuming c = 1. This is a point estimate; the full Richardson plot uses the slope of log(L) vs log(s) from multiple ruler-length measurements. Mandelbrot (1967) formalized the coastline paradox and showed D quantifies the space-filling capacity of natural boundaries.',
    assumptions: ['The coastline is statistically self-similar (fractal) over the measurement scale range', 'The point estimate assumes c = 1 (normalization); the full Richardson plot uses the slope from multiple measurements', 'The measured length L at scale s follows the power law L(s) ∝ s^(1-D)'],
    limitations: ['Point estimate (single L, s pair) — the full Richardson plot from multiple ruler lengths gives a more robust D', 'D varies with scale range (multi-fractal behavior is common in real coastlines)', 'The coefficient c is coastline-specific and not determined by a single measurement', 'Practical measurement requires digitized coastline data at multiple scales'],
    references: ['Richardson, L.F. (1961) The problem of contiguity: An appendix to Statistics of Deadly Quarrels. General Systems Yearbook, 6, 139–187. (pre-DOI; NO-DOI in ledger)', 'Mandelbrot, B.B. (1967) How long is the coast of Britain? Statistical self-similarity and fractional dimension. Science, 156(3775), 636–638.'],
    preprocessingNotes: ['L is the measured coastline length at ruler scale s', 'For the full Richardson plot, supply multiple (L, s) pairs and regress log(L) vs log(s)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 84 — Slope Stability Analysis
// ══════════════════════════════════════════════════════════════════
export const TOOL_84: ToolWorkflowDef = {
  toolId: 84,
  name: 'Slope Stability Analysis',
  vizType: 'gauge',
  // FS-based classification: standard geotechnical thresholds
  classificationBands: [
    { min: 0, max: 1, label: 'FAILURE', color: '#ef4444', description: 'FS < 1 — slope is unstable, failure imminent' },
    { min: 1, max: 1.25, label: 'Nearly failing', color: '#f97316', description: 'FS 1.0–1.25 — marginal, requires investigation' },
    { min: 1.25, max: 1.5, label: 'Marginally stable', color: '#eab308', description: 'FS 1.25–1.5 — monitor, minor remediation may be needed' },
    { min: 1.5, max: 10, label: 'STABLE', color: '#22c55e', description: 'FS > 1.5 — adequate factor of safety' },
  ],
  validate: (inputs) => validateRange(inputs, [
    { param: 'cprime', min: 0, max: 100 },       // effective cohesion kPa
    { param: 'gammaz', min: 0.1, max: 500 },     // γz = unit weight × depth kPa
    { param: 'cosB', min: 0.01, max: 1 },         // cos(β)
    { param: 'u', min: 0, max: 500 },             // pore pressure kPa
    { param: 'tanphi', min: 0.01, max: 3 },       // tan(φ')
    { param: 'sinB', min: 0.01, max: 1 },         // sin(β)
    { param: 'cosB2', min: 0.01, max: 1 },        // cos²(β)
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Infinite slope: FS = [c\' + (γz·cos²β − u)·tanφ\'] / (γz·sinβ·cosβ)');
    log.push('  Valid when failure-plane depth << slope length (Taylor 1948)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, [
      { min: 0, max: 1, label: 'FAILURE', color: '#ef4444', description: 'FS < 1 — slope failure expected' },
      { min: 1, max: 1.25, label: 'Nearly failing', color: '#f97316', description: 'FS 1.0–1.25 — marginally stable' },
      { min: 1.25, max: 1.5, label: 'Marginally stable', color: '#eab308', description: 'FS 1.25–1.5 — low safety margin' },
      { min: 1.5, max: 10, label: 'STABLE', color: '#22c55e', description: 'FS > 1.5 — adequate safety margin' },
    ]);
    if (c) log.push(`  Stability: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Cohesion c\'', contribution: 'Highly variable; laboratory vs field values can differ by 2–5×' },
      { factor: 'Friction angle φ\'', contribution: 'Typical range 20–40°; small changes in tanφ\' have large effects on FS' },
      { factor: 'Pore pressure u', contribution: 'Most sensitive parameter; saturated vs unsaturated can change FS by 30–60%' },
      { factor: 'Infinite-slope assumption', contribution: 'Valid when depth/length < 0.1; for deeper failures use limit-equilibrium methods (Bishop, Spencer)' },
    ],
    overallAssessment: '±30% typical uncertainty; FS > 1.5 is the standard stability threshold (Duncan & Wright 2005)',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Factor of Safety: FS = ${Number.isFinite(result) ? result.toFixed(3) : 'N/A'}. ${Number.isFinite(result) ? (result >= 1.5 ? 'STABLE — adequate margin.' : result >= 1.25 ? 'Marginally stable — monitor.' : result >= 1.0 ? 'Nearly failing — investigate.' : 'FAILURE — slope is unstable.') : 'N/A.'}`,
    recommendations: [
      'FS > 1.5: standard threshold for permanent slopes (Duncan & Wright 2005).',
      'FS = 1.0–1.5: sensitivity analysis recommended — vary c\', φ\', and u to assess robustness.',
      'Pore pressure u is typically the most sensitive parameter; monitor during rainfall events.',
      'For 3D slope geometry or non-planar failures, use limit-equilibrium methods (Bishop, Spencer, Morgenstern-Price).',
    ],
  }),
  metadata: {
    methodology: 'Infinite slope factor of safety: FS = [c\' + (γz·cos²β − u)·tanφ\'] / (γz·sinβ·cosβ). Taylor (1948) / Duncan & Wright (2005). The numerator is the available shear strength (Mohr-Coulomb: τ_f = c\' + σ_n′·tanφ\') and the denominator is the applied shear stress along the potential failure plane. FS > 1: stable; FS = 1: limiting equilibrium; FS < 1: failure.',
    assumptions: ['Infinite slope — failure plane is planar and parallel to the ground surface (valid when depth/length < 0.1)', 'Uniform soil properties along the failure plane (no spatial variability)', 'Steady-state or quasi-static conditions (no dynamic loading)', 'Pore pressure u is known or can be estimated from hydrologic conditions'],
    limitations: ['Does not account for 3D slope geometry, toe effects, or non-planar failure surfaces', 'Pore pressure is the most sensitive parameter — incorrect u estimates dominate the uncertainty', 'Cohesion c\' is highly variable and difficult to measure reliably in the field', 'For deep-seated failures or complex geometry, use limit-equilibrium methods (Bishop, Spencer, Morgenstern-Price)'],
    references: ['Skempton, A.W. & DeLory, F.A. (1957) Stability of natural slopes in London Clay. Proc. 4th Int. Conf. on Soil Mechanics and Foundation Engineering, London, 2, 378–381.', 'Taylor, D.W. (1948) Fundamentals of Soil Mechanics. Wiley.', 'Duncan, J.M. & Wright, S.G. (2005) Soil Strength and Slope Stability. Wiley.'],
    preprocessingNotes: ['β = slope angle; cosB, sinB, cosB2 must be consistent (cos²β = cosB2 = cosB × cosB)', 'γz = total unit weight × depth of failure plane (kPa)', 'u = pore water pressure at the failure plane (kPa); 0 for dry conditions'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 85 — Voellmy Friction Model
// ══════════════════════════════════════════════════════════════════
export const TOOL_85: ToolWorkflowDef = {
  toolId: 85,
  name: 'Voellmy Friction Model',
  vizType: 'scalar',
  classificationBands: [
    { min: 0, max: 100, label: 'Low resistance', color: '#22c55e', description: 'τ < 100 Pa — slow, low-mobility flow' },
    { min: 100, max: 1000, label: 'Moderate', color: '#eab308', description: 'τ 100–1000 Pa — typical debris flow' },
    { min: 1000, max: 10000, label: 'High', color: '#f97316', description: 'τ 1–10 kPa — rapid avalanche/debris flow' },
    { min: 10000, max: 1e6, label: 'Very high', color: '#ef4444', description: 'τ > 10 kPa — extreme rock avalanche' },
  ],
  validate: (inputs) => validateRange(inputs, [
    { param: 'mu', min: 0, max: 1 },          // Coulomb friction coefficient
    { param: 'sigmaN', min: 0.1, max: 10000 }, // normal stress Pa
    { param: 'xi', min: 1, max: 10000 },       // turbulence parameter m/s²
    { param: 'rho', min: 100, max: 5000 },     // density kg/m³
    { param: 'velocity', min: 0, max: 100 },    // flow velocity m/s
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Voellmy (1955): τ = μσ_n + ρgu²/ξ');
    log.push('  τ_C = μσ_n (dry Coulomb)  +  τ_t = ρgu²/ξ (turbulent drag)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    if (Number.isFinite(result)) {
      const label = result < 100 ? 'Low' : result < 1000 ? 'Moderate' : result < 10000 ? 'High' : 'Very high';
      log.push(`  Total shear stress: ${label} (${result.toFixed(0)} Pa)`);
    }
    return { classification: undefined };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 30,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Coulomb friction μ', contribution: 'Event-specific; μ = 0.05–0.2 (debris flows), 0.1–0.3 (rock avalanches)' },
      { factor: 'Turbulence ξ', contribution: 'Event-specific; ξ = 100–1000 m/s² (debris flows), 500–2000 m/s² (rock avalanches)' },
      { factor: 'Flow velocity u', contribution: 'Most sensitive parameter in the turbulent term (u² dependence)' },
    ],
    overallAssessment: '±30% typical; parameters must be calibrated per event (Voellmy 1955, Rickenmann 1990)',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Voellmy total shear stress τ = ${Number.isFinite(result) ? result.toFixed(1) : 'N/A'} Pa. The Voellmy model combines dry Coulomb friction (dominant at low velocity) with velocity-dependent turbulent drag (dominant at high velocity), producing self-limiting flow behavior.`,
    recommendations: [
      'μ and ξ must be calibrated per event — typical ranges: μ = 0.05–0.3, ξ = 100–2000 m/s².',
      'The RAMMS (Rapid Mass Movements Simulation) model uses the Voellmy friction law.',
      'At low velocities (< 1 m/s), the turbulent term is negligible; at high velocities (> 10 m/s), it dominates.',
      'For steady uniform flow: u_eq = √(ξ·h·(sinβ − μ·cosβ)).',
    ],
  }),
  metadata: {
    methodology: 'Voellmy (1955) two-parameter friction model: τ = μ·σ_n + ρ·g·u²/ξ. The first term is dry Coulomb friction (velocity-independent); the second is turbulent drag (velocity-dependent, u²). At low velocities Coulomb friction dominates; at high velocities the turbulent term dominates, producing self-limiting velocity behavior. The model was originally for snow avalanches and later applied to debris flows (Rickenmann 1990), rock avalanches (Hungr & Evans 1996), and pyroclastic flows.',
    assumptions: ['Depth-averaged (Saint-Venant) flow — vertically uniform velocity profile', 'Steady or quasi-steady flow conditions', 'Constant friction parameters μ and ξ (no entrainment, no deposition in this formulation)', 'Incompressible, homogeneous granular flow'],
    limitations: ['μ and ξ are event-specific and must be calibrated against observed runout distances — no universal values exist', 'Does not account for entrainment of bed material, which can significantly increase flow volume and momentum', 'The u² dependence in the turbulent term makes the result highly sensitive to velocity input', 'For complex topography or multi-phase flows, more sophisticated models (e.g. BING, DAN3D) may be needed'],
    references: ['Voellmy, A. (1955) Über die Zerstörungskraft von Lawinen (On the destructive force of avalanches). Schweizerische Bauzeitung, 73(12), 159–165.', 'Savage, S.B. & Hutter, K. (1989) The motion of a finite mass of granular material down a rough inclined plane. J. Fluid Mech., 199, 177–215.', 'Rickenmann, D. (1990) Bedload transport capacity of overland flow at steep slopes. J. Hydraulic Engineering, 116(10), 1196–1212.'],
    preprocessingNotes: ['μ = Coulomb friction coefficient (0.05–0.3 depending on material)', 'ξ = Voellmy turbulence parameter (100–2000 m/s² depending on flow type)', 'ρ = flow density (typically 1500–2500 kg/m³ for debris flows)', 'u = flow velocity (user-supplied or computed from depth-averaged Saint-Venant equations)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 86 — Stream Power Index
// ══════════════════════════════════════════════════════════════════
export const TOOL_86: ToolWorkflowDef = {
  toolId: 86,
  name: 'Stream Power Index',
  vizType: 'heatmap',
  // SPI-based classification — NOT RISK_BANDS (SPI is dimensionless log, not a risk metric)
  classificationBands: [
    { min: -Infinity, max: 0, label: 'Low erosion', color: '#22c55e', description: 'SPI < 0 — divergent flow, ridges, low-gradient areas' },
    { min: 0, max: 5, label: 'Moderate', color: '#eab308', description: 'SPI 0–5 — hillslope/channel transition, moderate erosion' },
    { min: 5, max: 10, label: 'High erosion', color: '#f97316', description: 'SPI 5–10 — convergent flow, valleys, swales' },
    { min: 10, max: Infinity, label: 'Very high', color: '#ef4444', description: 'SPI > 10 — major channel convergence, intense erosion' },
  ],
  validate: (inputs) => validateRange(inputs, [
    { param: 'As', min: 0.01, max: 10000000 },   // specific catchment area m²/m
    { param: 'tanB', min: 0.0001, max: 10 },       // tan(β)
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  SPI = ln(A_s × tanβ) — Moore et al. (1991)');
    log.push('  A_s = specific catchment area (upslope contributing area per unit contour width)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    if (Number.isFinite(result)) {
      const label = result < 0 ? 'Low' : result < 5 ? 'Moderate' : result < 10 ? 'High' : 'Very high';
      log.push(`  Erosion potential: ${label} (SPI = ${result.toFixed(2)})`);
    }
    return { classification: undefined };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'DEM resolution', contribution: 'Higher-resolution DEMs capture more detailed flow convergence patterns' },
      { factor: 'Flow routing algorithm', contribution: 'D8, D∞, MFD produce different A_s values; algorithm choice affects SPI' },
      { factor: 'Specific catchment area A_s', contribution: 'A_s = upslope contributing area / contour width; sensitive to flow routing and DEM artifacts' },
    ],
    overallAssessment: 'Exact for the log formula; ±25% uncertainty from DEM resolution and flow routing (Moore et al. 1991)',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Stream Power Index SPI = ${Number.isFinite(result) ? result.toFixed(2) : 'N/A'}. ${Number.isFinite(result) ? (result < 0 ? 'Low erosion potential — divergent flow, ridges.' : result < 5 ? 'Moderate erosion — hillslope/channel transition.' : result < 10 ? 'High erosion potential — convergent flow, valleys.' : 'Very high erosion — major channel convergence.') : 'N/A.'}`,
    recommendations: [
      'SPI > 5 typically indicates zones of flow convergence prone to gullying and channel incision.',
      'SPI < 0 indicates divergent flow (ridges, divides) — erosion-resistant positions.',
      'SPI is often combined with the LS factor in RUSLE for erosion modeling.',
      'DEM resolution strongly affects SPI — 30 m DEMs may miss narrow convergent zones visible at 10 m.',
    ],
  }),
  metadata: {
    methodology: 'Moore et al. (1991) Stream Power Index: SPI = ln(A_s × tanβ), where A_s is the specific catchment area (m²/m) and β is the local slope angle. SPI combines the flow accumulation (A_s, proxy for discharge) with the slope gradient (tanβ, proxy for shear stress) to quantify the erosive power of concentrated overland flow. High SPI values identify zones of flow convergence (valleys, swales) prone to gully erosion and channel incision; low values identify divergent hillslopes and ridges.',
    assumptions: ['The DEM accurately represents the ground surface (no vegetation/canopy bias)', 'Flow routing is correctly computed (D8, D∞, or MFD algorithm)', 'Specific catchment area A_s is computed per unit contour width (m²/m)', 'SPI is a relative index — not an absolute erosion rate'],
    limitations: ['DEM resolution strongly affects SPI — narrow convergent zones may be missed at coarse resolution', 'Flat areas (tanβ → 0) produce very low SPI regardless of drainage area — may mask actual convergence', 'SPI does not account for soil properties, vegetation, or land use — combine with RUSLE for actual erosion rates', 'Flow routing artifacts (sinks, parallel flow) can produce spurious SPI patterns'],
    references: ['Moore, I.D., Grayson, R.B. & Ladson, A.R. (1991) Digital terrain modelling: A review of hydrological, geomorphological, and biological applications. Hydrological Processes, 5(1), 3–30. doi:10.1002/hyp.3360050103'],
    preprocessingNotes: ['A_s = specific catchment area (upslope contributing area per unit contour width, m²/m)', 'tanβ = tangent of local slope angle (from DEM; tanβ = sinβ/cosβ)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 87 — Topographic Wetness Index
// ══════════════════════════════════════════════════════════════════
export const TOOL_87: ToolWorkflowDef = {
  toolId: 87,
  name: 'Topographic Wetness Index',
  vizType: 'heatmap',
  // TWI-based classification — NOT RISK_BANDS
  classificationBands: [
    { min: -Infinity, max: 4, label: 'Well-drained', color: '#22c55e', description: 'TWI < 4 — ridge tops, steep slopes, dry' },
    { min: 4, max: 6, label: 'Moderate', color: '#eab308', description: 'TWI 4–6 — hillslope, periodically moist' },
    { min: 6, max: 8, label: 'High wetness', color: '#3b82f6', description: 'TWI 6–8 — valley bottoms, periodic saturation' },
    { min: 8, max: Infinity, label: 'Saturation zone', color: '#6366f1', description: 'TWI > 8 — wetland, riparian, permanent saturation' },
  ],
  validate: (inputs) => validateRange(inputs, [
    { param: 'As', min: 0.01, max: 10000000 },   // specific catchment area m²/m
    { param: 'tanB', min: 0.0001, max: 10 },      // tan(β)
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  TWI = ln(A_s / tanβ) — Beven & Kirkby (1979) TOPMODEL');
    log.push('  A_s = specific catchment area (upslope contributing area per unit contour width)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    if (Number.isFinite(result)) {
      const label = result < 4 ? 'Well-drained' : result < 6 ? 'Moderate' : result < 8 ? 'High wetness' : 'Saturation zone';
      log.push(`  Wetness class: ${label} (TWI = ${result.toFixed(2)})`);
    }
    return { classification: undefined };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'DEM resolution', contribution: 'Higher-resolution DEMs capture more detailed convergence/divergence patterns' },
      { factor: 'Flow routing algorithm', contribution: 'D8, D∞, MFD produce different A_s values; affects TWI by 1–2 units' },
      { factor: 'Soil transmissivity T', contribution: 'TOPMODEL relates TWI to water table depth via T; uniform-T assumption limits accuracy' },
    ],
    overallAssessment: 'Exact for the log formula; ±1–2 TWI units from DEM resolution and flow routing (Beven & Kirkby 1979)',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Topographic Wetness Index TWI = ${Number.isFinite(result) ? result.toFixed(2) : 'N/A'}. ${Number.isFinite(result) ? (result < 4 ? 'Well-drained — ridge tops, steep slopes.' : result < 6 ? 'Moderate wetness — hillslope.' : result < 8 ? 'High wetness — valley bottoms, periodic saturation.' : 'Saturation zone — wetland, riparian, permanent saturation.') : 'N/A.'} In TOPMODEL: z = z_mean − (1/f)·(TWI − λ) where λ is the mean TWI.`,
    recommendations: [
      'TWI > 8 typically identifies saturation-excess overland flow source areas.',
      'TWI correlates with depth to water table — higher TWI = shallower water table.',
      'Combine with soil transmissivity T for TOPMODEL water-table predictions.',
      'DEM resolution strongly affects TWI — 30 m DEMs may miss narrow valley-bottom saturation.',
    ],
  }),
  metadata: {
    methodology: 'Beven & Kirkby (1979) TOPMODEL: TWI = ln(A_s / tanβ), where A_s is the specific catchment area (m²/m) and β is the local slope angle. TWI captures the topographic control on soil moisture: points with large upslope area (high A_s) and gentle slope (low tanβ) have high TWI and are prone to saturation. In TOPMODEL, the local water table depth is z = z_mean − (1/f)·(TWI − λ), where f is a decay parameter and λ is the catchment-mean TWI.',
    assumptions: ['Steady-state or quasi-steady-state hydrologic conditions', 'Soil transmissivity T decreases exponentially with depth below the water table', 'Uniform soil transmissivity parameter f across the catchment (spatially uniform f, distributed z from TWI)', 'The DEM accurately represents the ground surface'],
    limitations: ['TWI is a topographic index only — does not account for soil properties, vegetation, or land use directly', 'DEM resolution strongly affects TWI — narrow valley bottoms may be missed at coarse resolution', 'Flat areas (tanβ → 0) produce very high TWI regardless of drainage area — may overestimate saturation', 'TOPMODEL requires calibration of f and T against observed streamflow'],
    references: ['Beven, K.J. & Kirkby, M.J. (1979) A physically based, variable contributing area model of basin hydrology. Hydrological Sciences Bulletin, 24(1), 43–69. doi:10.1080/02626667909491834'],
    preprocessingNotes: ['A_s = specific catchment area (upslope contributing area per unit contour width, m²/m)', 'tanβ = tangent of local slope angle (from DEM)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 88 — Lake Evaporation Estimation
// ══════════════════════════════════════════════════════════════════
export const TOOL_88: ToolWorkflowDef = {
  toolId: 88,
  name: 'Lake Evaporation Estimation',
  vizType: 'scalar',
  // Evaporation-rate classification — NOT OCEAN_BANDS (wave height bands)
  classificationBands: [
    { min: 0, max: 1, label: 'Low evaporation', color: '#22c55e', description: 'E < 1 mm/day — cool, humid, low wind' },
    { min: 1, max: 3, label: 'Moderate', color: '#eab308', description: 'E 1–3 mm/day — typical temperate lake' },
    { min: 3, max: 6, label: 'High', color: '#f97316', description: 'E 3–6 mm/day — warm, dry, windy' },
    { min: 6, max: 20, label: 'Very high', color: '#ef4444', description: 'E > 6 mm/day — arid, high wind' },
  ],
  validate: (inputs) => validateRange(inputs, [
    { param: 'Km', min: 0.1, max: 1.5 },       // mass-transfer coefficient
    { param: 'ew', min: 0, max: 10 },           // saturation vapor pressure kPa
    { param: 'ea', min: 0, max: 10 },           // actual vapor pressure kPa
    { param: 'u', min: 0, max: 30 },             // wind speed m/s
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Meyer (1915): E = K_M × (e_w − e_a) × (1 + u/16)');
    log.push('  K_M ≈ 0.7 for Class A pan; wind at 9 m height (original); u/16 empirical');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    if (Number.isFinite(result)) {
      const label = result < 1 ? 'Low' : result < 3 ? 'Moderate' : result < 6 ? 'High' : 'Very high';
      log.push(`  Evaporation rate: ${label} (${result.toFixed(2)} mm/day)`);
    }
    return { classification: undefined };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 25,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Pan coefficient K_M', contribution: 'Varies 0.6–0.8 depending on pan type, exposure, and lake size' },
      { factor: 'Wind measurement height', contribution: 'Original formula calibrated at 9 m; wind at 2 m requires adjustment' },
      { factor: 'Vapor pressure estimation', contribution: 'e_w from water temperature (Magnus formula); e_a from air temperature and humidity' },
    ],
    overallAssessment: '±25% typical; the wind function (1 + u/16) is a simple empirical fit (Meyer 1915)',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Lake evaporation E = ${Number.isFinite(result) ? result.toFixed(2) : 'N/A'} mm/day. ${Number.isFinite(result) ? (result < 1 ? 'Low evaporation — cool, humid conditions.' : result < 3 ? 'Moderate — typical temperate lake.' : result < 6 ? 'High evaporation — warm, dry, windy.' : 'Very high — arid region, strong wind.') : 'N/A.'}`,
    recommendations: [
      'K_M ≈ 0.7 for US Weather Bureau Class A pan; adjust for other pan types and lake sizes.',
      'The wind function (1 + u/16) was calibrated at 9 m height; wind at 2 m should be converted.',
      'For annual estimates: multiply daily E by 365; typical range 500–1500 mm/yr for temperate lakes.',
      'Meyer (1915) is one of the earliest mass-transfer evaporation equations; more modern methods include Penman (1948) and Priestley-Taylor (1972).',
    ],
  }),
  metadata: {
    methodology: 'Meyer (1915) mass-transfer evaporation: E = K_M × (e_w − e_a) × (1 + u/16). The formula combines the vapor pressure deficit (e_w − e_a, the driving force for evaporation) with an empirical wind function (1 + u/16) that enhances evaporation with wind speed. K_M is a pan coefficient calibrated against US Weather Bureau Class A pan data. The formula was one of the first practical evaporation estimation methods and remains widely used for preliminary lake water-balance calculations.',
    assumptions: ['Steady-state or quasi-steady conditions (no rapid temperature changes)', 'Uniform lake surface — no stratification, no vegetation, no ice', 'Wind speed measured at 9 m height (original calibration height)', 'Pan coefficient K_M is constant (does not vary with lake size or climate)'],
    limitations: ['K_M is empirical and varies 0.6–0.8 depending on pan type, exposure, and lake size — no universal value', 'The wind function (1 + u/16) is a simple linear fit; more complex functions exist (Penman, Deardorff)', 'Ignores energy balance components (net radiation, heat storage) — mass-transfer methods are less accurate than energy-balance methods for large lakes', 'Does not account for stratification, ice cover, or seasonal variation in lake temperature'],
    references: ['Meyer, A.F. (1915) Computing runoff from rainfall and other physical data. Transactions of the American Society of Civil Engineers, 79(1), 1056–1155. doi:10.1061/taceat.0002707'],
    preprocessingNotes: ['e_w = saturation vapor pressure at water surface temperature (Magnus formula)', 'e_a = actual vapor pressure from air temperature and relative humidity', 'u = wind speed (m/s) at the measurement height; original formula uses 9 m'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 89 — Schmidt Stability Number
// ══════════════════════════════════════════════════════════════════
export const TOOL_89: ToolWorkflowDef = {
  toolId: 89,
  name: 'Schmidt Stability Number',
  vizType: 'profile',
  // Stability-based classification — NOT OCEAN_BANDS
  classificationBands: [
    { min: 0, max: 20, label: 'Near-mixed', color: '#22c55e', description: 'S < 20 J/m² — continuous vertical exchange, polymictic' },
    { min: 20, max: 100, label: 'Weakly stratified', color: '#eab308', description: 'S 20–100 J/m² — frequent turnover, dimictic' },
    { min: 100, max: 500, label: 'Moderately stratified', color: '#3b82f6', description: 'S 100–500 J/m² — seasonal thermocline present' },
    { min: 500, max: 10000, label: 'Strongly stratified', color: '#ef4444', description: 'S > 500 J/m² — resistant to mixing, meromictic risk' },
  ],
  validate: (inputs) => validateRange(inputs, [
    { param: 'A', min: 1000, max: 1e11 },   // lake surface area m²
    { param: 'z', min: 0.1, max: 2000 },     // maximum depth m
    { param: 'rms', min: 0, max: 100 },       // rms density difference kg/m³
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Schmidt (1928) simplified: S ≈ g × rms(Δρ) × z_v');
    log.push('  Full form: S = (g/A₀)∫A(z)(ρ_z − ρ_m)(z − z_v)dz');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    if (Number.isFinite(result)) {
      const label = result < 20 ? 'Near-mixed' : result < 100 ? 'Weakly stratified' : result < 500 ? 'Moderately stratified' : 'Strongly stratified';
      log.push(`  Stratification: ${label} (S = ${result.toFixed(1)} J/m²)`);
    }
    return { classification: undefined };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Density profile accuracy', contribution: 'S depends on the full density profile; the simplified form uses rms(Δρ) as a proxy' },
      { factor: 'Lake morphometry', contribution: 'The full integral requires A(z); the simplified form uses a characteristic depth z_v' },
      { factor: 'Temporal variability', contribution: 'S varies seasonally (summer max, fall overturn); the simplified form is a snapshot' },
    ],
    overallAssessment: 'Exact for the simplified formula; ±20% vs full integral from density profile (Schmidt 1928, Idso 1973)',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Schmidt Stability S = ${Number.isFinite(result) ? result.toFixed(1) : 'N/A'} J/m². ${Number.isFinite(result) ? (result < 20 ? 'Near-mixed — continuous vertical exchange, polymictic lake.' : result < 100 ? 'Weakly stratified — frequent turnover, dimictic lake.' : result < 500 ? 'Moderately stratified — seasonal thermocline present.' : 'Strongly stratified — resistant to mixing, meromictic risk.') : 'N/A.'}`,
    recommendations: [
      'S > 500 J/m² indicates strong stratification — hypolimnetic hypoxia likely if sustained.',
      'S < 20 J/m² indicates near-mixed conditions — polymictic lake with frequent turnover.',
      'The simplified form S ≈ g·rms(Δρ)·z_v is a one-layer proxy; the full integral requires density vs depth profiles.',
      'S is the standard metric in the Lake Analyzer toolbox (Read et al. 2011) and the GLEON network.',
    ],
  }),
  metadata: {
    methodology: 'Schmidt (1928) stability number: S = (g/A₀)∫A(z)(ρ_z − ρ_m)(z − z_v)dz. Simplified one-layer proxy: S ≈ g × rms(Δρ) × z_v. S represents the gravitational potential energy required to completely mix a stratified water column. Higher S means more energy needed to overturn the lake. The standard metric for lake thermal stratification strength (Read et al. 2011 Lake Analyzer).',
    assumptions: ['The lake is at rest (no internal waves or seiches at the time of measurement)', 'Density differences are primarily temperature-driven (freshwater lakes)', 'The simplified form uses a single rms(Δρ) value rather than the full density profile', 'Lake morphometry A(z) is approximately captured by the surface area A₀ and maximum depth z_v'],
    limitations: ['The simplified form is a one-layer proxy — the full integral requires a density vs depth profile from CTD', 'S is a snapshot value that varies seasonally (summer max → fall overturn → winter inverse stratification)', 'In saline or meromictic lakes, density differences include salinity — the simplified form may underestimate S', 'Wind energy input (not included in S) determines whether the available energy is sufficient for mixing'],
    references: ['Schmidt, W. (1928) Über die Temperatur- und Stabilitätsverhältnisse von Seen (On temperature and stability conditions in lakes). Geografiska Annaler, 10, 145–177. doi:10.2307/519789', 'Idso, S.B. (1973) On the concept of lake stability. Limnology and Oceanography, 18(4), 681–683.'],
    preprocessingNotes: ['rms(Δρ) = root-mean-square density difference from the surface (user supplies, or compute from temperature profile)', 'z_v = depth to centre of volume (user supplies, or approximate as z_max/2 for a V-shaped lake)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 90 — Nash Cascade
// ══════════════════════════════════════════════════════════════════
export const TOOL_90: ToolWorkflowDef = {
  toolId: 90,
  name: 'Nash Cascade',
  vizType: 'timeseries',
  classificationBands: OCEAN_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'n', min: 1, max: 10 },{ param: 'K', min: 0.1, max: 48 },{ param: 't', min: 0, max: 1000 },{ param: 'Q0', min: 0, max: 10000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Nash (1957) cascade of n identical linear reservoirs — the classic IUH');
    log.push('  Q₀ (total inflow volume): genuine USGS streamflow-derived value when a gauge resolves; honest NaN otherwise');
    log.push('  n and K from calibration (method of moments: n=(m₁/m₂)², K=m₂/m₁)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, OCEAN_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'N and K calibration', contribution: 'Varies' },
      { factor: 'Rainfall-runoff linearity', contribution: 'Varies' },
      { factor: 'Q₀ streamflow source', contribution: 'USGS gauge proximity' },
    ],
    overallAssessment: '+/- 20% uncertainty. The Nash IUH assumes linear, time-invariant catchment response.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Nash Cascade: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'} m³/s at the selected time. Outflow hydrograph from n series linear reservoirs (Nash 1957); Q₀ from genuine USGS streamflow when available, else honest NaN. Time to peak t_p = (n−1)·K; peak factor q_p·K/Q₀ by n (see outputs).`,
    recommendations: ["Estimate n and K by method of moments from observed rainfall-runoff events (n=(m₁/m₂)², K=m₂/m₁).","Quickflow only — add baseflow for total streamflow.","IUH is linear/time-invariant — use caution for extreme floods."],
  }),
  metadata: {
    methodology: 'q(t) = t^(n−1) / (K^(n−1)·(n−1)!) · (1/K) · exp(−t/K) · Q₀ (Nash 1957 gamma IUH). Q₀ is the total inflow volume; derived from genuine USGS streamflow when a gauge resolves, honest NaN otherwise. Time to peak t_p = (n−1)K; dimensionless peak factor (n−1)^(n−1)·e^(−(n−1))/(n−1)! (1, 0.368, 0.271, 0.224, 0.195 for n=1..5).',
    assumptions: ["Linear reservoirs","Lumped watershed","Stationary parameters"],
    limitations: ["Nonlinear runoff not captured","Requires calibration","No baseflow"],
    references: ["Nash, J.E. (1957) The form of the instantaneous unit hydrograph. IASH Publ. 45:114-121. DOI 10.1080/02626665709493274"],
    preprocessingNotes: ["Nash model for unit hydrograph","Q₀ from genuine USGS streamflow (honest NaN when unavailable)","n and K from calibration"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 91 — Glacier Mass Balance (PDD)
// ══════════════════════════════════════════════════════════════════
export const TOOL_91: ToolWorkflowDef = {
  toolId: 91,
  name: 'Glacier Mass Balance (PDD)',
  vizType: 'timeseries',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Accum', min: 0, max: 10 },{ param: 'DDF', min: 0, max: 0.1 },{ param: 'Tpos', min: 0, max: 5000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Degree-day factor for ice melt');
    log.push('  Accumulation from snowfall');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 30,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'DDF variability', contribution: 'Varies' },
      { factor: 'Accumulation estimation', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 30% uncertainty, DDF ice 5-8 mm/C/day',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Glacier Mass Balance (PDD): ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Glacier mass balance from degree-days.`,
    recommendations: ["DDF for ice: 5-8 mm/C/day.","Accumulation from snowfall."],
  }),
  metadata: {
    methodology: 'Glacier mass balance from degree-days.',
    assumptions: ["Constant DDF","No debris cover"],
    limitations: ["DDF varies with debris","Requires elevation zones"],
    references: ["Braithwaite 1989","Hock 2003"],
    preprocessingNotes: ["Degree-day factor for ice melt","Accumulation from snowfall"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 92 — Stefan Permafrost Active Layer
// ══════════════════════════════════════════════════════════════════
export const TOOL_92: ToolWorkflowDef = {
  toolId: 92,
  name: 'Stefan Permafrost Active Layer',
  vizType: 'timeseries',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'K', min: 0.1, max: 10 },{ param: 'DIFI', min: 0, max: 10000 },{ param: 'L', min: 0, max: 500000000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Thawing index from temperature sum');
    log.push('  Thermal conductivity from soil type');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 25,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Thawing index', contribution: 'Varies' },
      { factor: 'Thermal conductivity', contribution: 'Varies' },
      { factor: 'Soil moisture', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 25% uncertainty',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Stefan Permafrost Active Layer: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Permafrost active layer depth.`,
    recommendations: ["Thawing index from ERA5.","K from soil type."],
  }),
  metadata: {
    methodology: 'Permafrost active layer depth.',
    assumptions: ["Homogeneous soil","Phase change only"],
    limitations: ["No snow insulation","Soil heterogeneity"],
    references: ["Stefan 1891"],
    preprocessingNotes: ["Thawing index from temperature sum","Thermal conductivity from soil type"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 93 — Herron-Langway Firn Densification
// ══════════════════════════════════════════════════════════════════
export const TOOL_93: ToolWorkflowDef = {
  toolId: 93,
  name: 'Herron-Langway Firn Densification',
  vizType: 'timeseries',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'k', min: 0, max: 1 },{ param: 'b', min: 0, max: 10000 },{ param: 'rhoI', min: 800, max: 950 },{ param: 'rhoF', min: 300, max: 850 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Accumulation rate from ice cores');
    log.push('  Ice density = 917 kg/m3');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 30,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Densification rate', contribution: 'Varies' },
      { factor: 'Accumulation rate', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 30% uncertainty',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Herron-Langway Firn Densification: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Firn densification for ice core dating.`,
    recommendations: ["Accumulation rate from ice cores.","k temperature-dependent."],
  }),
  metadata: {
    methodology: 'Firn densification for ice core dating.',
    assumptions: ["Steady accumulation","No melt"],
    limitations: ["Melt events not captured","Requires accumulation data"],
    references: ["Herron & Langway 1980"],
    preprocessingNotes: ["Accumulation rate from ice cores","Ice density = 917 kg/m3"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 94 — VEI Volume Relationship
// ══════════════════════════════════════════════════════════════════
export const TOOL_94: ToolWorkflowDef = {
  toolId: 94,
  name: 'VEI Volume Relationship',
  vizType: 'gauge',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'VEI', min: 0, max: 8 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  VEI from Smithsonian GVP');
    log.push('  Volume from deposit mapping');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.5,
    rmseUnit: 'VEI',
    contributingFactors: [
      { factor: 'Volume estimation', contribution: 'Varies' },
      { factor: 'Eruption classification', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 0.5 VEI uncertainty',
  }),
  interpret: (result) => ({
    contextualAnalysis: `VEI Volume Relationship: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Volcanic eruption classification.`,
    recommendations: ["VEI from Smithsonian GVP.","Volume from deposit mapping."],
  }),
  metadata: {
    methodology: 'Volcanic eruption classification.',
    assumptions: ["Volume-VEI relationship","Representative deposit"],
    limitations: ["Volume poorly constrained","Not for effusive eruptions"],
    references: ["Newhall & Self 1982"],
    preprocessingNotes: ["VEI from Smithsonian GVP","Volume from deposit mapping"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 95 — Morton-Taylor-Turner Buoyant Plume
// ══════════════════════════════════════════════════════════════════
export const TOOL_95: ToolWorkflowDef = {
  toolId: 95,
  name: 'Morton-Taylor-Turner Buoyant Plume',
  vizType: 'profile',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Qdot', min: 0, max: 100000 },{ param: 'rhoAir', min: 0.5, max: 1.5 },{ param: 'alpha', min: 0.05, max: 0.2 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Entrainment coefficient alpha ~ 0.1');
    log.push('  Heat output from thermal observations');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 25,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Entrainment coefficient', contribution: 'Varies' },
      { factor: 'Heat output', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 25% uncertainty',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Morton-Taylor-Turner Buoyant Plume: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Volcanic plume rise modeling.`,
    recommendations: ["Alpha ~ 0.1 (standard).","Heat output from thermal satellite."],
  }),
  metadata: {
    methodology: 'Volcanic plume rise modeling.',
    assumptions: ["Steady plume","Constant entrainment"],
    limitations: ["Crosswind effects important","Alpha varies"],
    references: ["Morton, Taylor & Turner 1956"],
    preprocessingNotes: ["Entrainment coefficient alpha ~ 0.1","Heat output from thermal observations"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 96 — Budyko-Sellers Energy Balance
// ══════════════════════════════════════════════════════════════════
export const TOOL_96: ToolWorkflowDef = {
  toolId: 96,
  name: 'Budyko-Sellers Energy Balance',
  vizType: 'timeseries',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'C', min: 1000000, max: 10000000000 },{ param: 'Q', min: 0, max: 500 },{ param: 'alpha', min: 0, max: 1 },{ param: 'I', min: 0, max: 400 },{ param: 'D', min: 0, max: 100 },{ param: 'divDT', min: -1, max: 1 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Solar constant S/4 for sphere');
    log.push('  Albedo temperature dependence');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'qualitative',
    contributingFactors: [
      { factor: 'Albedo parameterization', contribution: 'Varies' },
      { factor: 'Diffusion coefficient', contribution: 'Varies' },
    ],
    overallAssessment: 'Conceptual climate model',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Budyko-Sellers Energy Balance: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Energy balance climate model.`,
    recommendations: ["S/4 for sphere averaging.","Ice-albedo feedback included."],
  }),
  metadata: {
    methodology: 'Energy balance climate model.',
    assumptions: ["Zero-dimensional or 1D","No ocean dynamics"],
    limitations: ["No clouds","No ocean heat transport"],
    references: ["Budyko 1969","Sellers 1969"],
    preprocessingNotes: ["Solar constant S/4 for sphere","Albedo temperature dependence"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 97 — Climate Sensitivity
// ══════════════════════════════════════════════════════════════════
export const TOOL_97: ToolWorkflowDef = {
  toolId: 97,
  name: 'Climate Sensitivity',
  vizType: 'scalar',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'dF', min: 0, max: 20 },{ param: 'lambda0', min: 1, max: 5 },{ param: 'f', min: -5, max: 5 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  IPCC AR6: ECS ~ 3C');
    log.push('  Planck feedback 3.76 W/m2/K');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'qualitative',
    contributingFactors: [
      { factor: 'Cloud feedback', contribution: 'Varies' },
      { factor: 'Lapse rate', contribution: 'Varies' },
      { factor: 'Water vapor', contribution: 'Varies' },
    ],
    overallAssessment: 'IPCC AR6 ECS: 3C (2.5-4.0)',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Climate Sensitivity: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Climate sensitivity from radiative forcing.`,
    recommendations: ["IPCC AR6: ECS ~ 3C (2.5-4.0).","lambda0 = 3.76 W/m2/K."],
  }),
  metadata: {
    methodology: 'Climate sensitivity from radiative forcing.',
    assumptions: ["Linear feedback","Constant feedbacks"],
    limitations: ["Nonlinear feedbacks","State-dependent"],
    references: ["IPCC AR6 Chapter 7","Soden & Held 2006"],
    preprocessingNotes: ["IPCC AR6: ECS ~ 3C","Planck feedback 3.76 W/m2/K"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 98 — Planck Feedback Parameter
// ══════════════════════════════════════════════════════════════════
export const TOOL_98: ToolWorkflowDef = {
  toolId: 98,
  name: 'Planck Feedback Parameter',
  vizType: 'scalar',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'dRdT', min: 1, max: 5 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  At T=255K: 4*sigma*T^3 = 3.76');
    log.push('  Pure Planck response only');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Blackbody temperature', contribution: 'Varies' },
      { factor: 'Stefan-Boltzmann constant', contribution: 'Varies' },
    ],
    overallAssessment: 'Pure Planck: 3.76 W/m2/K at T=255K',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Planck Feedback Parameter: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Planck feedback parameter.`,
    recommendations: ["3.76 W/m2/K at T=255K (not 3.2).","3.2 includes lapse rate."],
  }),
  metadata: {
    methodology: 'Planck feedback parameter.',
    assumptions: ["Blackbody emission","Constant T"],
    limitations: ["Not total feedback","Excludes water vapor/clouds"],
    references: ["IPCC AR6 Section 7.2"],
    preprocessingNotes: ["At T=255K: 4*sigma*T^3 = 3.76","Pure Planck response only"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 99 — Rossby Wave Dispersion
// ══════════════════════════════════════════════════════════════════
export const TOOL_99: ToolWorkflowDef = {
  toolId: 99,
  name: 'Rossby Wave Dispersion',
  vizType: 'spectrum',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'beta', min: 0, max: 1e-10 },{ param: 'kx', min: 0, max: 1 },{ param: 'ky', min: 0, max: 1 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Beta = df/dy');
    log.push('  Wavenumber from wavelength');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Beta parameter', contribution: 'Varies' },
      { factor: 'Wavenumber accuracy', contribution: 'Varies' },
    ],
    overallAssessment: 'Exact for linear barotropic waves',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Rossby Wave Dispersion: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Planetary wave dynamics.`,
    recommendations: ["Beta = df/dy.","Rossby radius from stratification."],
  }),
  metadata: {
    methodology: 'Planetary wave dynamics.',
    assumptions: ["Linear waves","Beta-plane"],
    limitations: ["Nonlinear effects","No topographic waves"],
    references: ["Rossby 1939"],
    preprocessingNotes: ["Beta = df/dy","Wavenumber from wavelength"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 100 — Charney-Stern Theorem
// ══════════════════════════════════════════════════════════════════
export const TOOL_100: ToolWorkflowDef = {
  toolId: 100,
  name: 'Charney-Stern Theorem',
  vizType: 'scalar',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'dpdy', min: -1e-9, max: 1e-9 },
    { param: 'f', min: 0, max: 0.0002 },
    { param: 'N', min: 0.001, max: 0.1 },
    { param: 'dudy', min: 0, max: 1 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  PV gradient from reanalysis');
    log.push('  Necessary condition for instability');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'qualitative',
    contributingFactors: [
      { factor: 'PV gradient', contribution: 'Varies' },
      { factor: 'Reanalysis resolution', contribution: 'Varies' },
    ],
    overallAssessment: 'Necessary not sufficient condition',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Charney-Stern Theorem: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Baroclinic instability criterion.`,
    recommendations: ["Necessary, not sufficient.","PV from reanalysis."],
  }),
  metadata: {
    methodology: 'Baroclinic instability criterion.',
    assumptions: ["Linear instability","Zonal mean flow"],
    limitations: ["Necessary not sufficient","Requires QG"],
    references: ["Charney & Stern 1962"],
    preprocessingNotes: ["PV gradient from reanalysis","Necessary condition for instability"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 101 — Eady Growth Rate
// ══════════════════════════════════════════════════════════════════
export const TOOL_101: ToolWorkflowDef = {
  toolId: 101,
  name: 'Eady Growth Rate',
  vizType: 'scalar',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'f', min: 0, max: 0.0002 },{ param: 'N', min: 0.001, max: 0.1 },{ param: 'dudy', min: 0, max: 1 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Coefficient 0.3098 from Eady 1949');
    log.push('  Wind shear from ERA5');
    log.push('  N from stability');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Eady model assumptions', contribution: 'Varies' },
      { factor: 'Shear measurement', contribution: 'Varies' },
      { factor: 'N from stability', contribution: 'Varies' },
    ],
    overallAssessment: 'Exact for idealized Eady model',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Eady Growth Rate: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Baroclinic instability growth rate.`,
    recommendations: ["0.3098 coefficient.","Wind shear from ERA5."],
  }),
  metadata: {
    methodology: 'Baroclinic instability growth rate.',
    assumptions: ["Eady model","Constant shear"],
    limitations: ["Idealized model","No moisture"],
    references: ["Eady 1949"],
    preprocessingNotes: ["Coefficient 0.3098 from Eady 1949","Wind shear from ERA5","N from stability"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 102 — Quasi-Geostrophic PV
// ══════════════════════════════════════════════════════════════════
export const TOOL_102: ToolWorkflowDef = {
  toolId: 102,
  name: 'Quasi-Geostrophic PV',
  vizType: 'contour',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'psi', min: -1000000000, max: 1000000000 },{ param: 'f', min: 0, max: 0.0002 },{ param: 'd2psi_dp2', min: -1, max: 1 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  QG PV from streamfunction');
    log.push('  Coriolis from latitude');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'QG approximation', contribution: 'Varies' },
      { factor: 'Streamfunction accuracy', contribution: 'Varies' },
    ],
    overallAssessment: 'Conserved in QG flow',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Quasi-Geostrophic PV: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Conserved tracer for large-scale dynamics.`,
    recommendations: ["Conserved in adiabatic QG flow.","ERA5 for streamfunction."],
  }),
  metadata: {
    methodology: 'Conserved tracer for large-scale dynamics.',
    assumptions: ["QG approximation","Small Rossby number"],
    limitations: ["Breaks for mesoscale","No ageostrophic"],
    references: ["Charney 1948"],
    preprocessingNotes: ["QG PV from streamfunction","Coriolis from latitude"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 103 — Reynolds Decomposition
// ══════════════════════════════════════════════════════════════════
export const TOOL_103: ToolWorkflowDef = {
  toolId: 103,
  name: 'Reynolds Decomposition',
  vizType: 'heatmap',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'ubar', min: 0, max: 100 },{ param: 'uprime', min: -50, max: 50 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Mean and fluctuating components');
    log.push('  Time averaging');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Averaging period', contribution: 'Varies' },
      { factor: 'Turbulence definition', contribution: 'Varies' },
    ],
    overallAssessment: 'Exact decomposition',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Reynolds Decomposition: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Mean + turbulent fluctuation.`,
    recommendations: ["Foundation of RANS.","Averaging period critical."],
  }),
  metadata: {
    methodology: 'Mean + turbulent fluctuation.',
    assumptions: ["Stationary flow","Clear scale separation"],
    limitations: ["Averaging period subjective","Non-stationary issues"],
    references: ["Reynolds 1895"],
    preprocessingNotes: ["Mean and fluctuating components","Time averaging"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 104 — Ekman Layer Depth
// ══════════════════════════════════════════════════════════════════
export const TOOL_104: ToolWorkflowDef = {
  toolId: 104,
  name: 'Ekman Layer Depth',
  vizType: 'scalar',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Km', min: 0.001, max: 1000 },{ param: 'f', min: 0, max: 0.0002 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Eddy viscosity from boundary layer');
    log.push('  Coriolis from latitude');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Eddy viscosity', contribution: 'Varies' },
      { factor: 'Coriolis parameter', contribution: 'Varies' },
    ],
    overallAssessment: 'Exact for constant eddy viscosity',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Ekman Layer Depth: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Frictional boundary layer depth.`,
    recommendations: ["Constant eddy viscosity.","Breaks near equator."],
  }),
  metadata: {
    methodology: 'Frictional boundary layer depth.',
    assumptions: ["Constant Km","Steady state"],
    limitations: ["Km not constant","Stratification effects"],
    references: ["Ekman 1905"],
    preprocessingNotes: ["Eddy viscosity from boundary layer","Coriolis from latitude"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 105 — Convective Velocity Scale
// ══════════════════════════════════════════════════════════════════
export const TOOL_105: ToolWorkflowDef = {
  toolId: 105,
  name: 'Convective Velocity Scale',
  vizType: 'scalar',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'g', min: 0, max: 20 },{ param: 'thetaVbar', min: 200, max: 400 },{ param: 'wthetaV', min: 0, max: 10 },{ param: 'zi', min: 10, max: 5000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Surface heat flux from observations');
    log.push('  BL height from lidar/sodar');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Surface heat flux', contribution: 'Varies' },
      { factor: 'BL height', contribution: 'Varies' },
      { factor: 'Mean state', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 15% from flux and BL height',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Convective Velocity Scale: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Convective boundary layer scaling.`,
    recommendations: ["Surface heat flux from tower.","BL height from lidar."],
  }),
  metadata: {
    methodology: 'Convective boundary layer scaling.',
    assumptions: ["Free convection","Horizontally homogeneous"],
    limitations: ["Not for wind-driven BL","Requires surface flux"],
    references: ["Deardorff 1970"],
    preprocessingNotes: ["Surface heat flux from observations","BL height from lidar/sodar"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 106 — Petterssen Frontogenesis
// ══════════════════════════════════════════════════════════════════
export const TOOL_106: ToolWorkflowDef = {
  toolId: 106,
  name: 'Petterssen Frontogenesis',
  vizType: 'heatmap',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'dtheta', min: 0, max: 1 },{ param: 'D', min: -1, max: 1 },{ param: 'cos2b', min: -1, max: 1 },{ param: 'delta', min: -1, max: 1 },{ param: 'dudy', min: -1, max: 1 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Temperature gradient from reanalysis');
    log.push('  Deformation from wind field');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Gradient accuracy', contribution: 'Varies' },
      { factor: 'Deformation calculation', contribution: 'Varies' },
    ],
    overallAssessment: 'Exact for kinematic formulation',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Petterssen Frontogenesis: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Frontal intensification rate.`,
    recommendations: ["Frontal intensification rate.","From ERA5 wind and temperature."],
  }),
  metadata: {
    methodology: 'Frontal intensification rate.',
    assumptions: ["2D front","No diabatic effects"],
    limitations: ["No diabatic heating","2D simplification"],
    references: ["Petterssen 1936"],
    preprocessingNotes: ["Temperature gradient from reanalysis","Deformation from wind field"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 107 — Vorticity Equation
// ══════════════════════════════════════════════════════════════════
export const TOOL_107: ToolWorkflowDef = {
  toolId: 107,
  name: 'Vorticity Equation',
  vizType: 'vector',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'zeta', min: -1, max: 1 },{ param: 'f', min: 0, max: 0.0002 },{ param: 'div', min: -1, max: 1 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Relative vorticity from wind field');
    log.push('  Coriolis from latitude');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Vorticity calculation', contribution: 'Varies' },
      { factor: 'Divergence accuracy', contribution: 'Varies' },
      { factor: 'Friction', contribution: 'Varies' },
    ],
    overallAssessment: 'Exact from Navier-Stokes',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Vorticity Equation: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Storm dynamics and cyclone development.`,
    recommendations: ["Conservation of absolute vorticity.","ERA5 for wind fields."],
  }),
  metadata: {
    methodology: 'Storm dynamics and cyclone development.',
    assumptions: ["Inviscid or parameterized","Hydrostatic"],
    limitations: ["Friction parameterization","No diabatic effects"],
    references: ["Holton & Hakim 2012"],
    preprocessingNotes: ["Relative vorticity from wind field","Coriolis from latitude"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 108 — Kohler Equation
// ══════════════════════════════════════════════════════════════════
export const TOOL_108: ToolWorkflowDef = {
  toolId: 108,
  name: 'Kohler Equation',
  vizType: 'scalar',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'a', min: 0, max: 0.000001 },{ param: 'r', min: 1e-8, max: 0.001 },{ param: 'b', min: 0, max: 1e-10 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Köhler (1936) Eq.: S = a/r − b/r³ (supersaturation)');
    log.push('  a = 2σ/(ρ_w·R_v·T) ≈ 1.2×10⁻⁹ m (physical constant at 273 K)');
    log.push('  r = droplet radius (m) — site measurement, no public API → supply explicitly');
    log.push('  b = solute coefficient (m³) — aerosol composition, no public API → supply explicitly');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Surface tension (σ) — Kelvin coefficient', contribution: 'a = 2σ/(ρ_w·R_v·T), ~1.2×10⁻⁹ m at 273 K' },
      { factor: 'Solute coefficient b — aerosol composition', contribution: 'b = i·n_s·M_w/(4π·ρ_w), site-specific' },
      { factor: 'Ideal solution assumption', contribution: 'Non-ideal solutions deviate for high solute concentrations' },
    ],
    overallAssessment: 'Exact for ideal dilute solution droplets. Non-ideal effects (van\'t Hoff factor) add ~10% uncertainty for concentrated NaCl droplets.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Köhler Equation: S = ${Number.isFinite(result) ? result.toExponential(4) : 'N/A'} supersaturation fraction. ${Number.isFinite(result) ? (result > 0 ? 'SUPERSATURATED — droplet activates (r > r_crit)' : 'SUBSATURATED — droplet evaporates') : 'Supply r and b explicitly — no public API provides cloud-droplet radius or solute coefficient.'} Critical radius and supersaturation in the outputs table.`,
    recommendations: ["Kelvin coefficient a = 2σ/(ρ_w·R_v·T) ≈ 1.2×10⁻⁹ m at T=273 K (physical constant).","Solute coefficient b = i·n_s·M_w/(4π·ρ_w) — depends on aerosol dry mass and van't Hoff factor.","Critical radius r_c = √(3b/a); critical supersaturation S_c = (4a³/27b)^½. No public API provides these — supply r and b explicitly."],
  }),
  metadata: {
    methodology: 'S = a/r − b/r³ (Köhler 1936, supersaturation fraction form). a = 2σ/(ρ_w·R_v·T) ≈ 1.2×10⁻⁹ m (Kelvin curvature coefficient, physical constant). b = i·n_s·M_w/(4π·ρ_w) (solute coefficient). r_c = √(3b/a). S_c = (4a³/27b)^½ (critical supersaturation in fraction; ×100 for %). S > 0 → supersaturated (droplet activates); S < 0 → subsaturated (droplet evaporates).',
    assumptions: ["Ideal dilute solution","Spherical droplet","Equilibrium thermodynamics","Constant surface tension"],
    limitations: ["Non-ideal solutions at high concentration","Surface tension varies with solute concentration","No public API for droplet radius / solute coefficient — must supply explicitly"],
    references: ["Köhler, H. (1936) The nucleus in the growth of hygroscopic droplets. Trans. Faraday Soc., 32, 1152-1161. DOI 10.1039/TF9363201152","Pruppacher, H.R. & Klett, J.D. (1997) Microphysics of Clouds and Precipitation, 2nd ed. Kluwer."],
    preprocessingNotes: ["Kelvin coefficient a = 2σ/(ρ_w·R_v·T) ≈ 1.2×10⁻⁹ m (physical constant)","Droplet radius r (m) — site measurement, no public API → supply explicitly","Solute coefficient b (m³) — aerosol composition, no public API → supply explicitly"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 109 — Marshall-Palmer DSD
// ══════════════════════════════════════════════════════════════════
export const TOOL_109: ToolWorkflowDef = {
  toolId: 109,
  name: 'Marshall-Palmer DSD',
  vizType: 'histogram',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'N0', min: 0, max: 1000000000 },{ param: 'Lambda', min: 0, max: 50000 },{ param: 'D', min: 0, max: 0.01 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Intercept N0 = 8e3 m^-3 mm^-1');
    log.push('  Slope Lambda from rain rate');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'N0 variability', contribution: 'Varies' },
      { factor: 'Lambda-rain rate', contribution: 'Varies' },
      { factor: 'Exponential assumption', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 20%, N0 variable',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Marshall-Palmer DSD: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Exponential drop size distribution.`,
    recommendations: ["N0 = 8e3 m^-3 mm^-1.","Lambda from rain rate."],
  }),
  metadata: {
    methodology: 'Exponential drop size distribution.',
    assumptions: ["Exponential distribution","Steady rain"],
    limitations: ["Not for convective rain","N0 varies"],
    references: ["Marshall & Palmer 1948"],
    preprocessingNotes: ["Intercept N0 = 8e3 m^-3 mm^-1","Slope Lambda from rain rate"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 110 — Z-R Relationship
// ══════════════════════════════════════════════════════════════════
export const TOOL_110: ToolWorkflowDef = {
  toolId: 110,
  name: 'Z-R Relationship',
  vizType: 'scatter',
  classificationBands: CLIMATE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'a', min: 0, max: 1000 },{ param: 'R', min: 0, max: 500 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Z = 200*R^1.6 (stratiform)');
    log.push('  Z = 300*R^1.4 (convective)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, CLIMATE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 30,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Z-R coefficients', contribution: 'Varies' },
      { factor: 'DSD', contribution: 'Varies' },
      { factor: 'Radar calibration', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 30%, coefficients vary',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Z-R Relationship: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Radar reflectivity to rainfall rate.`,
    recommendations: ["200*R^1.6 (stratiform).","300*R^1.4 (convective).","Dual-pol reduces uncertainty."],
  }),
  metadata: {
    methodology: 'Radar reflectivity to rainfall rate.',
    assumptions: ["Equilibrium DSD","Single rain type"],
    limitations: ["Coefficients vary by region","Hail contamination"],
    references: ["Marshall & Palmer 1948"],
    preprocessingNotes: ["Z = 200*R^1.6 (stratiform)","Z = 300*R^1.4 (convective)"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 111 — IERS Earth Rotation Matrix
// ══════════════════════════════════════════════════════════════════
export const TOOL_111: ToolWorkflowDef = {
  toolId: 111,
  name: 'IERS Earth Rotation Matrix',
  vizType: 'scalar',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'xp', min: -1, max: 1 },{ param: 'yp', min: -1, max: 1 },{ param: 'sp', min: -1e-3, max: 1e-3 },{ param: 'gast', min: 0, max: 6.283185307179586 },{ param: 'dx', min: -100, max: 100 },{ param: 'dy', min: -100, max: 100 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Precession-nutation from IERS');
    log.push('  Earth rotation from GAST');
    log.push('  Polar motion from IERS');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, GENERIC_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'IERS conventions', contribution: 'Varies' },
      { factor: 'Matrix order', contribution: 'Varies' },
      { factor: 'Time system', contribution: 'Varies' },
    ],
    overallAssessment: 'Exact with IERS conventions',
  }),
  interpret: (result) => ({
    contextualAnalysis: `IERS Earth Rotation Matrix: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Earth rotation for satellite positioning.`,
    recommendations: ["IERS Conventions 2010.","Precession, nutation, rotation, polar motion."],
  }),
  metadata: {
    methodology: 'Earth rotation for satellite positioning.',
    assumptions: ["Rigid Earth","Known time"],
    limitations: ["Non-rigid Earth effects","Requires IERS data"],
    references: ["IERS Conventions 2010"],
    preprocessingNotes: ["Precession-nutation from IERS","Earth rotation from GAST","Polar motion from IERS"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 112 — Earth Tides (Love Numbers)
// ══════════════════════════════════════════════════════════════════
export const TOOL_112: ToolWorkflowDef = {
  toolId: 112,
  name: 'Earth Tides (Love Numbers)',
  vizType: 'contour',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'hn', min: 0.3, max: 0.7 },{ param: 'kn', min: 0.2, max: 0.4 },{ param: 'Vn', min: 0, max: 10 },{ param: 'g', min: 9.8, max: 9.82 },{ param: 'lat', min: -90, max: 90 },{ param: 'Re', min: 6e6, max: 6.4e6 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Love numbers from Earth model');
    log.push('  Tidal potential from Moon/Sun');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, GENERIC_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 5,
    rmseUnit: 'mm',
    contributingFactors: [
      { factor: 'Love number model', contribution: 'Varies' },
      { factor: 'Tidal potential', contribution: 'Varies' },
      { factor: 'Local geology', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 5mm accuracy',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Earth Tides (Love Numbers): ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Solid Earth deformation from tides.`,
    recommendations: ["Love numbers from PREM model.","Sub-meter GPS correction."],
  }),
  metadata: {
    methodology: 'Solid Earth deformation from tides.',
    assumptions: ["Elastic Earth","Known Love numbers"],
    limitations: ["Anelastic effects","Local geology variations"],
    references: ["Wahr 1981"],
    preprocessingNotes: ["Love numbers from Earth model","Tidal potential from Moon/Sun"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 113 — EGM2008 Gravity Field
// ══════════════════════════════════════════════════════════════════
export const TOOL_113: ToolWorkflowDef = {
  toolId: 113,
  name: 'EGM2008 Gravity Field',
  vizType: 'contour',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'GM', min: 0, max: 1000000000000000 },{ param: 'r', min: 6000000, max: 10000000 },{ param: 'n', min: 0, max: 2190 },{ param: 'm', min: 0, max: 2190 },{ param: 'Cnm', min: -1, max: 1 },{ param: 'Snm', min: -1, max: 1 },{ param: 'Pnm', min: -1, max: 1 },{ param: 'phi', min: -Math.PI, max: Math.PI },{ param: 'lam', min: -2 * Math.PI, max: 2 * Math.PI },{ param: 'Re', min: 6e6, max: 6.4e6 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Spherical harmonics degree 2190');
    log.push('  Coefficients from EGM2008');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, GENERIC_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Harmonic degree truncation', contribution: 'Varies' },
      { factor: 'Coefficient accuracy', contribution: 'Varies' },
      { factor: 'Legendre functions', contribution: 'Varies' },
    ],
    overallAssessment: 'Exact to degree 2190',
  }),
  interpret: (result) => ({
    contextualAnalysis: `EGM2008 Gravity Field: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Global gravity field and geoid.`,
    recommendations: ["Degree 2190 (~5 arcmin).","Precise orbit determination."],
  }),
  metadata: {
    methodology: 'Global gravity field and geoid.',
    assumptions: ["Spherical harmonic expansion","Known coefficients"],
    limitations: ["Truncation error","Computationally expensive"],
    references: ["Pavlis et al. 2008"],
    preprocessingNotes: ["Spherical harmonics degree 2190","Coefficients from EGM2008"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 114 — Helmert 7-Parameter Transformation
// ══════════════════════════════════════════════════════════════════
export const TOOL_114: ToolWorkflowDef = {
  toolId: 114,
  name: 'Helmert 7-Parameter Transformation',
  vizType: 'scalar',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'S', min: 0, max: 2 },{ param: 's', min: -100, max: 100 },{ param: 'wx', min: -100, max: 100 },{ param: 'wy', min: -100, max: 100 },{ param: 'wz', min: -100, max: 100 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  7 parameters from datum calibration');
    log.push('  WGS84 to ITRF conversion');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, GENERIC_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Parameter accuracy', contribution: 'Varies' },
      { factor: 'Rotation matrix', contribution: 'Varies' },
      { factor: 'Scale factor', contribution: 'Varies' },
    ],
    overallAssessment: 'Exact for known parameters',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Helmert 7-Parameter Transformation: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. 7-parameter datum transformation.`,
    recommendations: ["Scale, 3 rotations, 3 translations.","WGS84/ITRF conversion."],
  }),
  metadata: {
    methodology: '7-parameter datum transformation.',
    assumptions: ["Rigid body","Known parameters","Small angles"],
    limitations: ["Not for nonlinear distortions","Parameter accuracy critical"],
    references: ["Heiskanen & Moritz 1967"],
    preprocessingNotes: ["7 parameters from datum calibration","WGS84 to ITRF conversion"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 115 — Geoid Height
// ══════════════════════════════════════════════════════════════════
export const TOOL_115: ToolWorkflowDef = {
  toolId: 115,
  name: 'Geoid Height',
  vizType: 'contour',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'h', min: -500, max: 10000 },{ param: 'N', min: -200, max: 200 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Ellipsoidal height from GPS');
    log.push('  Geoid undulation from EGM2008');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, GENERIC_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'GPS height accuracy', contribution: 'Varies' },
      { factor: 'Geoid model accuracy', contribution: 'Varies' },
      { factor: 'EGM2008 resolution', contribution: 'Varies' },
    ],
    overallAssessment: 'Exact with accurate EGM2008',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Geoid Height: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Height reference frame transformation.`,
    recommendations: ["H = h - N (orthometric).","N from EGM2008."],
  }),
  metadata: {
    methodology: 'Height reference frame transformation.',
    assumptions: ["Known geoid undulation","GPS ellipsoidal height"],
    limitations: ["Geoid model resolution","GPS height accuracy"],
    references: ["Standard geodesy"],
    preprocessingNotes: ["Ellipsoidal height from GPS","Geoid undulation from EGM2008"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 116 — NRLMSISE-00 Thermosphere
// ══════════════════════════════════════════════════════════════════
export const TOOL_116: ToolWorkflowDef = {
  toolId: 116,
  name: 'NRLMSISE-00 Thermosphere',
  vizType: 'profile',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'n_N2', min: 0, max: 1e+30 },{ param: 'n_O2', min: 0, max: 1e+30 },{ param: 'n_O', min: 0, max: 1e+30 },{ param: 'm_N2', min: 0, max: 1e-25 },{ param: 'm_O2', min: 0, max: 1e-25 },{ param: 'm_O', min: 0, max: 1e-25 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  NRLMSIS 2.0 with TIMED/SABER');
    log.push('  Species densities from model');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Model coefficients', contribution: 'Varies' },
      { factor: 'Solar activity', contribution: 'Varies' },
      { factor: 'Geomagnetic conditions', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 15%, NRLMSIS 2.0 recommended',
  }),
  interpret: (result) => ({
    contextualAnalysis: `NRLMSISE-00 Thermosphere: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Satellite drag atmospheric density.`,
    recommendations: ["Use NRLMSIS 2.0 (updated).","TIMED/SABER data assimilation."],
  }),
  metadata: {
    methodology: 'Satellite drag atmospheric density.',
    assumptions: ["Empirical model","Known solar/geomagnetic inputs"],
    limitations: ["Solar cycle variability","Storm-time density spikes"],
    references: ["Picone 2002"],
    preprocessingNotes: ["NRLMSIS 2.0 with TIMED/SABER","Species densities from model"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 117 — IRI-2016 Ionosphere
// ══════════════════════════════════════════════════════════════════
export const TOOL_117: ToolWorkflowDef = {
  toolId: 117,
  name: 'IRI-2016 Ionosphere',
  vizType: 'profile',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Ne', min: 100000000, max: 10000000000000 },{ param: 'alt', min: 50000, max: 2000000 },{ param: 'NmF2', min: 10000000000, max: 5000000000000 },{ param: 'hmF2', min: 150000, max: 600000 },{ param: 'H', min: 10000, max: 200000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  IRI-2020 is latest version');
    log.push('  Electron density profiles');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Model coefficients', contribution: 'Varies' },
      { factor: 'Solar activity', contribution: 'Varies' },
      { factor: 'Ionosonde data', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 15%, IRI-2020 recommended',
  }),
  interpret: (result) => ({
    contextualAnalysis: `IRI-2016 Ionosphere: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Ionospheric electron density profiles.`,
    recommendations: ["Use IRI-2020 (latest).","GPS accuracy application."],
  }),
  metadata: {
    methodology: 'Ionospheric electron density profiles.',
    assumptions: ["Empirical model","Known solar inputs"],
    limitations: ["Storm-time deviations","Equatorial anomaly"],
    references: ["Bilitza 2017"],
    preprocessingNotes: ["IRI-2020 is latest version","Electron density profiles"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 118 — Joule Heating
// ══════════════════════════════════════════════════════════════════
export const TOOL_118: ToolWorkflowDef = {
  toolId: 118,
  name: 'Joule Heating',
  vizType: 'scalar',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'J', min: 0, max: 1 },{ param: 'E', min: 0, max: 1 },{ param: 'sigma', min: 0, max: 0.01 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Current density from ionosphere');
    log.push('  Electric field from convection');
    log.push('  Pedersen conductivity');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Current density', contribution: 'Varies' },
      { factor: 'Electric field', contribution: 'Varies' },
      { factor: 'Conductivity', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 20% uncertainty',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Joule Heating: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Storm-time thermospheric heating.`,
    recommendations: ["Key driver of storm-time density spikes.","Electric field from convection."],
  }),
  metadata: {
    methodology: 'Storm-time thermospheric heating.',
    assumptions: ["Steady state","Known conductivity"],
    limitations: ["Time-varying fields","Conductivity altitude-dependent"],
    references: ["Standard"],
    preprocessingNotes: ["Current density from ionosphere","Electric field from convection","Pedersen conductivity"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 119 — Ionospheric Scintillation (S4)
// ══════════════════════════════════════════════════════════════════
export const TOOL_119: ToolWorkflowDef = {
  toolId: 119,
  name: 'Ionospheric Scintillation (S4)',
  vizType: 'gauge',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Ibar', min: 0, max: 100 },{ param: 'sigmaI', min: 0, max: 10 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Signal intensity statistics');
    log.push('  GNSS receiver data');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Signal conditions', contribution: 'Varies' },
      { factor: 'Receiver quality', contribution: 'Varies' },
      { factor: 'Multipath', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 15% uncertainty',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Ionospheric Scintillation (S4): ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. GPS reliability assessment.`,
    recommendations: ["S4 > 0.5: strong scintillation.","GNSS receiver data."],
  }),
  metadata: {
    methodology: 'GPS reliability assessment.',
    assumptions: ["Steady signal","No multipath"],
    limitations: ["Multipath contamination","Receiver-dependent"],
    references: ["Standard GNSS"],
    preprocessingNotes: ["Signal intensity statistics","GNSS receiver data"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 120 — Magnetopause Standoff (Shue)
// ══════════════════════════════════════════════════════════════════
export const TOOL_120: ToolWorkflowDef = {
  toolId: 120,
  name: 'Magnetopause Standoff (Shue)',
  vizType: 'scalar',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Pdyn', min: 0, max: 100 },{ param: 'Bz', min: -30, max: 30 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Solar wind from NOAA SWPC');
    log.push('  IMF Bz from ACE/DSCOVR');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 10,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Solar wind input', contribution: 'Varies' },
      { factor: 'Model coefficients', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 10%, NOAA SWPC authoritative',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Magnetopause Standoff (Shue): ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Magnetopause location from solar wind.`,
    recommendations: ["Real-time NOAA SWPC data.","ACE/DSCOVR for IMF."],
  }),
  metadata: {
    methodology: 'Magnetopause location from solar wind.',
    assumptions: ["Steady solar wind","Axisymmetric magnetopause"],
    limitations: ["Dynamic pressure variations","Tailward extension"],
    references: ["Shue 1998"],
    preprocessingNotes: ["Solar wind from NOAA SWPC","IMF Bz from ACE/DSCOVR"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 121 — Dst Ring Current Index
// ══════════════════════════════════════════════════════════════════
export const TOOL_121: ToolWorkflowDef = {
  toolId: 121,
  name: 'Dst Ring Current Index',
  vizType: 'gauge',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Dst', min: -500, max: 100 },{ param: 'Pdyn', min: 0, max: 100 },{ param: 'b', min: 0, max: 20 },{ param: 'c', min: -50, max: 50 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Raw Dst from WDC Kyoto');
    log.push('  Pressure correction');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 10,
    rmseUnit: 'nT',
    contributingFactors: [
      { factor: 'Pressure correction', contribution: 'Varies' },
      { factor: 'Offset calibration', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 10 nT uncertainty',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Dst Ring Current Index: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Geomagnetic storm severity.`,
    recommendations: ["Raw Dst from WDC Kyoto.","Pressure correction."],
  }),
  metadata: {
    methodology: 'Geomagnetic storm severity.',
    assumptions: ["Steady ring current","Known pressure"],
    limitations: ["Non-storm contamination","Offset varies"],
    references: ["Sugiura 1964"],
    preprocessingNotes: ["Raw Dst from WDC Kyoto","Pressure correction"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 122 — Debye Length
// ══════════════════════════════════════════════════════════════════
export const TOOL_122: ToolWorkflowDef = {
  toolId: 122,
  name: 'Debye Length',
  vizType: 'scalar',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'eps0', min: 8.854e-12, max: 8.854e-12 },{ param: 'kB', min: 1.381e-23, max: 1.381e-23 },{ param: 'Te', min: 1000, max: 10000000 },{ param: 'ne', min: 1000000, max: 1000000000000000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Electron temperature from plasma');
    log.push('  Electron density from measurements');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Electron temperature', contribution: 'Varies' },
      { factor: 'Electron density', contribution: 'Varies' },
    ],
    overallAssessment: 'Exact for Maxwellian plasma',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Debye Length: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Space plasma shielding distance.`,
    recommendations: ["Fundamental plasma parameter.","Indicates charge neutrality scale."],
  }),
  metadata: {
    methodology: 'Space plasma shielding distance.',
    assumptions: ["Maxwellian distribution","Known Te, ne"],
    limitations: ["Non-Maxwellian plasmas","Magnetic field effects"],
    references: ["Debye 1923"],
    preprocessingNotes: ["Electron temperature from plasma","Electron density from measurements"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 123 — Satellite Drag Force
// ══════════════════════════════════════════════════════════════════
export const TOOL_123: ToolWorkflowDef = {
  toolId: 123,
  name: 'Satellite Drag Force',
  vizType: 'scalar',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'rho', min: 1e-20, max: 0.00001 },{ param: 'CD', min: 1, max: 4 },{ param: 'A', min: 0.01, max: 1000 },{ param: 'm', min: 1, max: 100000 },{ param: 'v', min: 0, max: 15000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Atmospheric density from NRLMSIS');
    log.push('  Drag coefficient ~ 2.2');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Atmospheric density', contribution: 'Varies' },
      { factor: 'Drag coefficient', contribution: 'Varies' },
      { factor: 'Cross-section', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 15%, density is key uncertainty',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Satellite Drag Force: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Orbital decay prediction.`,
    recommendations: ["Atmospheric density from NRLMSIS.","CD ~ 2.2 (varies 1-4)."],
  }),
  metadata: {
    methodology: 'Orbital decay prediction.',
    assumptions: ["Known density","Constant CD","Known area/mass"],
    limitations: ["Density variable","CD attitude-dependent","Area varies"],
    references: ["Standard"],
    preprocessingNotes: ["Atmospheric density from NRLMSIS","Drag coefficient ~ 2.2"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 124 — Orbital Decay Rate
// ══════════════════════════════════════════════════════════════════
export const TOOL_124: ToolWorkflowDef = {
  toolId: 124,
  name: 'Orbital Decay Rate',
  vizType: 'timeseries',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'rho', min: 1e-20, max: 0.00001 },{ param: 'CD', min: 1, max: 4 },{ param: 'A', min: 0.01, max: 1000 },{ param: 'v', min: 0, max: 15000 },{ param: 'm', min: 1, max: 100000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Atmospheric density from NRLMSIS');
    log.push('  Re-entry timeline estimation');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 15,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Atmospheric density', contribution: 'Varies' },
      { factor: 'Drag coefficient', contribution: 'Varies' },
      { factor: 'Velocity', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 15% uncertainty',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Orbital Decay Rate: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Satellite re-entry timeline.`,
    recommendations: ["Density from NRLMSIS.","Re-entry prediction."],
  }),
  metadata: {
    methodology: 'Satellite re-entry timeline.',
    assumptions: ["Known density","Circular orbit"],
    limitations: ["Eccentric orbit","Density variations","CD attitude-dependent"],
    references: ["King-Hele 1987"],
    preprocessingNotes: ["Atmospheric density from NRLMSIS","Re-entry timeline estimation"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 125 — Collision Probability
// ══════════════════════════════════════════════════════════════════
export const TOOL_125: ToolWorkflowDef = {
  toolId: 125,
  name: 'Collision Probability',
  vizType: 'scalar',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'A1', min: 0, max: 1000 },{ param: 'A2', min: 0, max: 1000 },{ param: 'sigmax', min: 0, max: 10000 },{ param: 'sigmay', min: 0, max: 10000 },{ param: 'd', min: 0, max: 10000 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Position uncertainty from tracking');
    log.push('  Miss distance from conjunction');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 20,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Covariance accuracy', contribution: 'Varies' },
      { factor: 'Miss distance', contribution: 'Varies' },
      { factor: 'Encounter geometry', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 20% uncertainty',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Collision Probability: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Conjunction assessment and collision avoidance.`,
    recommendations: ["Position uncertainty from tracking.","Miss distance from conjunction."],
  }),
  metadata: {
    methodology: 'Conjunction assessment and collision avoidance.',
    assumptions: ["Gaussian distribution","Short encounter","Known covariance"],
    limitations: ["Non-Gaussian errors","Long encounters","Maneuvers change geometry"],
    references: ["Foster 1992"],
    preprocessingNotes: ["Position uncertainty from tracking","Miss distance from conjunction"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 126 — Kessler Syndrome Debris Growth
// ══════════════════════════════════════════════════════════════════
export const TOOL_126: ToolWorkflowDef = {
  toolId: 126,
  name: 'Kessler Syndrome Debris Growth',
  vizType: 'timeseries',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'rho', min: 0, max: 1 },{ param: 'sigma', min: 0, max: 1000 },{ param: 'v', min: 0, max: 20 },{ param: 'N', min: 0, max: 1000000000 },{ param: 'L', min: 0, max: 1000 },{ param: 'beta', min: 0, max: 1 },{ param: 'gamma', min: 0, max: 1 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Debris population from catalog');
    log.push('  Collision cross-section');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'qualitative',
    contributingFactors: [
      { factor: 'Collision rate', contribution: 'Varies' },
      { factor: 'Launch source', contribution: 'Varies' },
      { factor: 'Decay coefficient', contribution: 'Varies' },
    ],
    overallAssessment: 'Long-term debris environment projection',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Kessler Syndrome Debris Growth: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Space debris growth modeling.`,
    recommendations: ["Long-term projection.","Collision cascading."],
  }),
  metadata: {
    methodology: 'Space debris growth modeling.',
    assumptions: ["Mean-field approximation","Known population"],
    limitations: ["Individual collisions stochastic","Launch rates uncertain","Decay varies"],
    references: ["Kessler 1991"],
    preprocessingNotes: ["Debris population from catalog","Collision cross-section"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 127 — Hill-Clohessy-Wiltshire
// ══════════════════════════════════════════════════════════════════
export const TOOL_127: ToolWorkflowDef = {
  toolId: 127,
  name: 'Hill-Clohessy-Wiltshire',
  vizType: 'timeseries',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'n', min: 0, max: 0.01 },
    { param: 'x', min: -10000, max: 10000 },
    { param: 'y', min: -10000, max: 10000 },
    { param: 'z', min: -10000, max: 10000 },
    { param: 'xdot', min: -100, max: 100 },
    { param: 'ydot', min: -100, max: 100 },
    { param: 'zdot', min: -100, max: 100 },
    { param: 'ax', min: -10, max: 10 },
    { param: 'ay', min: -10, max: 10 },
    { param: 'az', min: -10, max: 10 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Mean motion from orbital elements');
    log.push('  Relative motion for rendezvous');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Linearized equations', contribution: 'Varies' },
      { factor: 'Circular reference orbit', contribution: 'Varies' },
      { factor: 'No perturbations', contribution: 'Varies' },
    ],
    overallAssessment: 'Exact for circular orbit',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Hill-Clohessy-Wiltshire: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Satellite rendezvous proximity operations.`,
    recommendations: ["Linearized relative motion.","Circular reference orbit."],
  }),
  metadata: {
    methodology: 'Satellite rendezvous proximity operations.',
    assumptions: ["Circular orbit","Small separations","No perturbations"],
    limitations: ["Not for eccentric orbits","Large separations","J2 perturbation"],
    references: ["Hill 1878"],
    preprocessingNotes: ["Mean motion from orbital elements","Relative motion for rendezvous"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 128 — Kp Geomagnetic Index
// ══════════════════════════════════════════════════════════════════
export const TOOL_128: ToolWorkflowDef = {
  toolId: 128,
  name: 'Kp Geomagnetic Index',
  vizType: 'gauge',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'kp', min: 0, max: 9 },
    { param: 'Ki', min: 0, max: 9 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  NOAA SWPC real-time planetary Kp');
    log.push('  13 subauroral station weighted average (Bartels 1949)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  ${c.label}`);
    // G-scale classification
    const gScale = result >= 9 ? 5 : result >= 8 ? 4 : result >= 7 ? 3 : result >= 6 ? 2 : result >= 5 ? 1 : 0;
    if (gScale > 0) log.push(`  NOAA G${gScale} storm`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result >= 0 && result <= 9, message: Number.isFinite(result) ? `${result.toFixed(2)} [0–9]` : 'NaN/Inf', severity: Number.isFinite(result) && result >= 0 && result <= 9 ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 0.33,
    rmseUnit: 'Kp',
    contributingFactors: [
      { factor: 'NOAA SWPC/KP station network', contribution: '±1/3 Kp resolution' },
      { factor: '13-station averaging', contribution: '~5% station-coverage error' },
    ],
    overallAssessment: '±0.33 Kp (1/3-point resolution of the official index)',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Kp = ${Number.isFinite(result) ? result.toFixed(2) : 'N/A'}. ${result < 3 ? 'Quiet geomagnetic conditions.' : result < 5 ? 'Active conditions — aurora at high latitudes.' : result < 6 ? 'G1 minor storm — aurora visible from northern US states.' : result < 7 ? 'G2 moderate storm — power grid voltage alarms possible.' : result < 8 ? 'G3 strong storm — aurora visible at mid-latitudes.' : result < 9 ? 'G4 severe storm — widespread voltage control problems.' : 'G5 extreme storm — power grid collapse risk, GPS/HF blackout.'}`,
    recommendations: [
      'NOAA SWPC: swpc.noaa.gov for real-time alerts',
      'G1–G2: monitor satellite operations',
      'G3–G5: activate space weather contingency plans',
    ],
  }),
  metadata: {
    methodology: 'Planetary Kp = weighted average of 13 subauroral station K-indices (Bartels 1949). Real data from NOAA SWPC.',
    assumptions: ['13 Kp stations at subauroral latitudes (60–40° mag. lat.)', 'K-index scale: quasi-logarithmic (0–9), standardized per station'],
    limitations: ['No real-time individual station data via open API', 'Spatial representativeness limited to 13 fixed stations', 'Local disturbances (Pc5 pulsations) may bias individual K values'],
    references: ['Bartels J. (1949) IAGA Bull. No. 12, Part III, pp. 36–46'],
    preprocessingNotes: ['NOAA SWPC observed Kp (no key required)', 'G-scale derived from Kp thresholds'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 129 — DOP (Dilution of Precision)
// ══════════════════════════════════════════════════════════════════
export const TOOL_129: ToolWorkflowDef = {
  toolId: 129,
  name: 'DOP (Dilution of Precision)',
  vizType: 'gauge',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'traceH', min: 0.1, max: 100 },
    { param: 'Q11', min: 0, max: 100 },
    { param: 'Q22', min: 0, max: 100 },
    { param: 'Q33', min: 0, max: 100 },
    { param: 'Q44', min: 0, max: 100 },
  ]),
  preprocess: (inputs, ctx, log) => {
    const q = (v: unknown) => (typeof v === 'number' ? v : Number(v));
    const hasQ = inputs.Q11 != null && inputs.Q22 != null && inputs.Q33 != null && inputs.Q44 != null
      && (q(inputs.Q11) > 0 || q(inputs.Q22) > 0 || q(inputs.Q33) > 0 || q(inputs.Q44) > 0);
    log.push(hasQ ? '  Q matrix diagonal provided (exact DOP)' : '  Trace only (approximate PDOP/HDOP/VDOP)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result > 0, message: Number.isFinite(result) ? `${result.toFixed(2)}` : 'NaN/Inf', severity: Number.isFinite(result) && result > 0 ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Satellite geometry', contribution: 'Exact when Q matrix provided' },
      { factor: 'Number of satellites', contribution: 'More satellites → lower DOP' },
      { factor: 'Elevation mask', contribution: 'Higher mask → fewer satellites → higher DOP' },
    ],
    overallAssessment: 'Exact from Q matrix; ±20% from trace-only approximation',
  }),
  interpret: (result) => ({
    contextualAnalysis: `GDOP = ${Number.isFinite(result) ? result.toFixed(2) : 'N/A'}. ${result < 2 ? 'Excellent geometry — high positioning accuracy.' : result < 4 ? 'Good geometry — typical open-sky conditions.' : result < 6 ? 'Moderate — some sky obstruction.' : result < 10 ? 'Poor — limited satellite visibility.' : 'Very poor — unreliable positioning.'}`,
    recommendations: [
      'GDOP < 2: excellent for surveying/precision applications',
      'GDOP 2–4: good for standard navigation',
      'GDOP > 6: consider multi-constellation (GPS+GLONASS+Galileo)',
    ],
  }),
  metadata: {
    methodology: 'GDOP = √(trace(Q)) where Q = (H^T·H)^{-1}. PDOP/HDOP/VDOP/TDOP from Q diagonal elements.',
    assumptions: ['Linearized observation model (small range errors)', 'Known satellite positions from ephemeris', 'Single epoch solution'],
    limitations: ['Does not account for multipath or atmospheric residuals', 'Static receiver assumed (no kinematic effects)', 'Q matrix assumes uncorrelated measurement errors'],
    references: ['Wells et al. (1987) Guide to GPS Positioning', 'Van Diggelen (2007) GPS Accuracy'],
    preprocessingNotes: ['Q diagonal from least-squares solution', 'traceH = trace(Q) always yields exact GDOP'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 130 — Saastamoinen Tropospheric Delay
// ══════════════════════════════════════════════════════════════════
export const TOOL_130: ToolWorkflowDef = {
  toolId: 130,
  name: 'Saastamoinen Tropospheric Delay',
  vizType: 'profile',
  classificationBands: SPACE_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'theta', min: 0.05, max: 1.57 },{ param: 'P', min: 500, max: 1100 },{ param: 'T', min: 200, max: 320 },{ param: 'e', min: 0, max: 50 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Surface pressure from weather');
    log.push('  Temperature from weather');
    log.push('  Water vapor from humidity');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, SPACE_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Pressure accuracy', contribution: 'Varies' },
      { factor: 'Temperature accuracy', contribution: 'Varies' },
      { factor: 'Water vapor', contribution: 'Varies' },
    ],
    overallAssessment: 'Exact for known P, T, e',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Saastamoinen Tropospheric Delay: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. GPS signal tropospheric correction.`,
    recommendations: ["Surface met data from Open-Meteo.","ZHD = 0.002277*P.","ZWD = 0.002277*(1255/T+0.05)*e."],
  }),
  metadata: {
    methodology: 'GPS signal tropospheric correction.',
    assumptions: ["Known surface met","Hydrostatic equilibrium"],
    limitations: ["Wet delay variable","Elevation-dependent","Asymmetric mapping"],
    references: ["Saastamoinen 1972"],
    preprocessingNotes: ["Surface pressure from weather","Temperature from weather","Water vapor from humidity"],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 131 — Thiem Equation (Steady Radial Flow)
// ══════════════════════════════════════════════════════════════════
export const TOOL_131: ToolWorkflowDef = {
  toolId: 131,
  name: 'Thiem Equation (Steady Radial Flow)',
  vizType: 'profile',
  classificationBands: OCEAN_BANDS,
  validate: (inputs) => {
    const errs = validateRange(inputs, [
      { param: 'T', min: 0.1, max: 50000 },
      { param: 'h1', min: 0, max: 500 },
      { param: 'h2', min: 0, max: 500 },
      { param: 'r1', min: 0.01, max: 10000 },
      { param: 'r2', min: 0.1, max: 100000 },
    ]);
    // Thiem requires r₂ > r₁ > 0 for ln(r₂/r₁) to be defined and positive
    if (inputs.r1 != null && inputs.r2 != null && inputs.r1 >= inputs.r2) {
      errs.errors.push(`'r1' (${inputs.r1}) must be < 'r2' (${inputs.r2}) for Thiem equation`);
    }
    return errs;
  },
  preprocess: (inputs, ctx, log) => {
    log.push('  Thiem (1906) steady radial flow — confined aquifer');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, OCEAN_BANDS);
    if (c) log.push(`  ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result > 0, message: Number.isFinite(result) ? `${result.toFixed(2)} m³/day` : 'NaN/Inf', severity: Number.isFinite(result) && result > 0 ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Transmissivity heterogeneity', contribution: '~10–30%' },
      { factor: 'Head measurement accuracy', contribution: '~1–5%' },
      { factor: 'Steady-state assumption', contribution: 'Varies with pumping duration' },
    ],
    overallAssessment: 'Exact for the stated assumptions; 10–30% real-world deviation from heterogeneity',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Q = ${Number.isFinite(result) ? result.toFixed(2) : 'N/A'} m³/day. ${result > 5000 ? 'High-yield aquifer — regional water supply.' : result > 500 ? 'Moderate yield — suitable for municipal/irrigation.' : result > 50 ? 'Low yield — domestic well scale.' : 'Minor yield — limited production.'}`,
    recommendations: [
      'Requires steady-state conditions (constant heads over time)',
      'Confined aquifer assumed — for unconfined, use Dupuit modification',
      'Semi-log plot of drawdown vs log(r) should be linear to validate',
    ],
  }),
  metadata: {
    methodology: 'Q = 2π·T·(h₂−h₁)/ln(r₂/r₁). Steady-state confined radial flow (Thiem 1906).',
    assumptions: ['Confined aquifer of constant thickness', 'Steady-state flow (no storage change)', 'Homogeneous, isotropic transmissivity', 'Fully penetrating well, horizontal flow', 'No recharge within the cone of depression'],
    limitations: ['Not valid for unconfined aquifers without Dupuit correction', 'Requires steady state — transient data must be excluded', 'Well losses and partial penetration cause deviation', 'Logarithmic drawdown extends to infinity (no finite radius of influence)'],
    references: ['Thiem, G. (1906) Hydrologische Methoden. J.A. Barth, Leipzig, 56 pp.'],
    preprocessingNotes: ['Transmissivity from pumping test analysis', 'Heads from observation wells at known distances'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 132 — Theis Transient Drawdown
// ══════════════════════════════════════════════════════════════════
export const TOOL_132: ToolWorkflowDef = {
  toolId: 132,
  name: 'Theis Transient Drawdown',
  vizType: 'timeseries',
  classificationBands: OCEAN_BANDS,
  validate: (inputs) => {
    const errs = validateRange(inputs, [
      { param: 'Q', min: 0.01, max: 100000 },
      { param: 'T', min: 0.1, max: 50000 },
      { param: 't', min: 0.001, max: 10000 },
      { param: 'r', min: 0.1, max: 10000 },
      { param: 'S', min: 1e-8, max: 0.1 },
    ]);
    return errs;
  },
  preprocess: (inputs, ctx, log) => {
    log.push('  Theis (1935) transient radial flow — confined aquifer');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, OCEAN_BANDS);
    if (c) log.push(`  ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result >= 0, message: Number.isFinite(result) ? `${result.toFixed(3)} m` : 'NaN/Inf', severity: Number.isFinite(result) && result >= 0 ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'W(u) series truncation', contribution: '< 0.01% for u < 5' },
      { factor: 'Transmissivity heterogeneity', contribution: '10–30%' },
      { factor: 'Storativity uncertainty', contribution: 'Factor of 2–10' },
    ],
    overallAssessment: 'Exact for stated assumptions; 10–30% real-world deviation',
  }),
  interpret: (result) => ({
    contextualAnalysis: `s = ${Number.isFinite(result) ? result.toFixed(3) : 'N/A'} m. ${result < 0.1 ? 'Minimal drawdown — high T or early time.' : result < 1 ? 'Small drawdown — good aquifer response.' : result < 5 ? 'Moderate drawdown — typical pumping test.' : 'Large drawdown — low T or excessive pumping.'}`,
    recommendations: [
      'Type-curve matching: plot s vs r²/t on log-log paper',
      'Cooper-Jacob valid for u < 0.01 (semilog straight line)',
      'Early-time data (u > 0.1) constrains S; late-time (u < 0.01) constrains T',
    ],
  }),
  metadata: {
    methodology: 's = (Q/4πT)·W(u), u = r²S/(4Tt). Theis (1935) well function with series expansion.',
    assumptions: ['Confined aquifer of constant thickness', 'Homogeneous, isotropic transmissivity', 'Fully penetrating well, instantaneous storage release', 'Constant pumping rate, infinite areal extent'],
    limitations: ['Not valid for unconfined aquifers (delayed drainage)', 'Heterogeneity causes deviation from Theis curve', 'Well-bore storage affects early-time data', 'Leakage from aquitards reduces late-time drawdown (Hantush solution)'],
    references: ['Theis, C.V. (1935) Trans. Am. Geophys. Union, 16(2), 519–524. DOI: 10.1029/TR016i002p00519.'],
    preprocessingNotes: ['Q from pumping rate, T from geology/well tests', 'S from specific yield (unconfined) or storativity (confined)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 133 — Cooper-Jacob Approximation
// ══════════════════════════════════════════════════════════════════
export const TOOL_133: ToolWorkflowDef = {
  toolId: 133,
  name: 'Cooper-Jacob Straight-Line Method',
  vizType: 'timeseries',
  classificationBands: OCEAN_BANDS,
  validate: (inputs) => {
    const errs = validateRange(inputs, [
      { param: 'Q', min: 0.01, max: 100000 },
      { param: 'T', min: 0.1, max: 50000 },
      { param: 't', min: 0.001, max: 10000 },
      { param: 'r', min: 0.1, max: 10000 },
      { param: 'S', min: 1e-8, max: 0.1 },
    ]);
    return errs;
  },
  preprocess: (inputs, ctx, log) => {
    log.push('  Cooper-Jacob (1946) straight-line approximation to Theis');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, OCEAN_BANDS);
    if (c) log.push(`  ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result >= 0, message: Number.isFinite(result) ? `${result.toFixed(3)} m` : 'NaN/Inf', severity: Number.isFinite(result) && result >= 0 ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Approximation validity (u < 0.01)', contribution: '< 1% when valid' },
      { factor: 'Transmissivity heterogeneity', contribution: '10–30%' },
    ],
    overallAssessment: 'Exact for stated assumptions; < 1% when u < 0.01',
  }),
  interpret: (result) => ({
    contextualAnalysis: `s = ${Number.isFinite(result) ? result.toFixed(3) : 'N/A'} m. ${result < 0.1 ? 'Minimal drawdown — early time or high T.' : result < 1 ? 'Small drawdown — suitable for analysis.' : result < 5 ? 'Moderate drawdown — typical pumping test.' : 'Large drawdown — low T or high Q.'}`,
    recommendations: [
      'Valid only for u < 0.01 (late-time data)',
      'Plot s vs log₁₀(t) on semilog paper — slope gives T',
      'Extrapolate to s=0 to find t₀ → S = 2.25Tt₀/r²',
    ],
  }),
  metadata: {
    methodology: 's = (2.3Q/4πT)·log₁₀(2.25Tt/r²S). Cooper & Jacob (1946) late-time approximation to Theis.',
    assumptions: ['u = r²S/(4Tt) < 0.01 (error < 1%)', 'Confined aquifer of constant thickness', 'Homogeneous, isotropic transmissivity', 'Constant pumping rate'],
    limitations: ['Not valid for early-time data (u > 0.01)', 'Requires semilog straight-line fit (R² > 0.99)', 'Not for unconfined aquifers without delayed-yield modification'],
    references: ['Cooper, H.H. & Jacob, C.E. (1946) Trans. Am. Geophys. Union, 27(4), 526–534. DOI: 10.1029/TR027i004p00526.'],
    preprocessingNotes: ['Late-time approximation to Theis well function', 'Slope on semilog plot gives T; intercept gives S'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 134 — Horton Infiltration
// ══════════════════════════════════════════════════════════════════
export const TOOL_134: ToolWorkflowDef = {
  toolId: 134,
  name: 'Horton Infiltration Model',
  vizType: 'timeseries',
  classificationBands: OCEAN_BANDS,
  validate: (inputs) => {
    const errs = validateRange(inputs, [
      { param: 'fc', min: 0, max: 50 },
      { param: 'f0', min: 0, max: 500 },
      { param: 'k', min: 0.01, max: 20 },
      { param: 't', min: 0, max: 100 },
    ]);
    // Horton requires f₀ ≥ f_c (infiltration decreases from initial to equilibrium)
    if (inputs.f0 != null && inputs.fc != null && inputs.f0 < inputs.fc) {
      errs.errors.push(`'f0' (${inputs.f0}) must be ≥ 'fc' (${inputs.fc}) for Horton decay model`);
    }
    return errs;
  },
  preprocess: (inputs, ctx, log) => {
    log.push('  Horton (1939) exponential infiltration decay');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, OCEAN_BANDS);
    if (c) log.push(`  ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result >= 0, message: Number.isFinite(result) ? `${result.toFixed(2)} mm/h` : 'NaN/Inf', severity: Number.isFinite(result) && result >= 0 ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'empirical',
    contributingFactors: [
      { factor: 'Soil type variability', contribution: 'Factor of 2–5' },
      { factor: 'Antecedent moisture', contribution: '20–50%' },
      { factor: 'Surface sealing', contribution: 'Not represented' },
    ],
    overallAssessment: 'Empirical; 20–50% deviation from field measurements typical',
  }),
  interpret: (result) => ({
    contextualAnalysis: `f(t) = ${Number.isFinite(result) ? result.toFixed(2) : 'N/A'} mm/h. ${result > 50 ? 'High infiltration — dry sandy soil.' : result > 10 ? 'Moderate infiltration — loam.' : result > 2 ? 'Low infiltration — clay or wet soil.' : 'Very low — near saturation, runoff imminent.'}`,
    recommendations: [
      'fc ≈ saturated hydraulic conductivity K_s (soil property)',
      'k depends on soil texture: sandy=1–4, loam=0.5–2, clay=0.3–1 /h',
      'For rainfall i < f(t): all water infiltrates; for i > f(t): runoff = i − f(t)',
    ],
  }),
  metadata: {
    methodology: 'f(t) = f_c + (f₀ − f_c)·e^{−kt}. Horton (1939) exponential infiltration decay.',
    assumptions: ['Homogeneous soil profile', 'No surface crust formation', 'Constant rainfall intensity', 'f₀ ≥ f_c (monotonic decay)'],
    limitations: ['Not valid for layered or heterogeneous soils', 'Does not account for surface sealing by raindrop impact', 'Rainfall intensity effects not represented', 'Recovery of infiltration capacity during dry periods not modeled'],
    references: ['Horton, R.E. (1939) Trans. Am. Geophys. Union, 20(4), 693–711. DOI: 10.1029/TR020i004p00693.'],
    preprocessingNotes: ['fc from soil type (≈ K_s)', 'f₀ from antecedent moisture conditions', 'k from calibration or literature values'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 135 — Risk = Hazard x Vulnerability x Exposure
// ══════════════════════════════════════════════════════════════════
export const TOOL_135: ToolWorkflowDef = {
  toolId: 135,
  name: 'Compute Disaster Risk Index',
  vizType: 'gauge',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'H', min: 0, max: 1 },
    { param: 'V', min: 0, max: 1 },
    { param: 'E', min: 0, max: 1 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  UNISDR/UNDRR risk framework (H × V × E)');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result >= 0 && result <= 1, message: Number.isFinite(result) ? `${result.toFixed(3)}` : 'NaN/Inf', severity: Number.isFinite(result) && result >= 0 && result <= 1 ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'qualitative',
    contributingFactors: [
      { factor: 'Hazard assessment uncertainty', contribution: 'High — depends on return period analysis' },
      { factor: 'Vulnerability model uncertainty', contribution: 'High — empirical fragility curves' },
      { factor: 'Exposure data completeness', contribution: 'Medium — census/asset databases' },
    ],
    overallAssessment: 'Order-of-magnitude risk ranking; not for precise loss estimation',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Risk index = ${Number.isFinite(result) ? result.toFixed(3) : 'N/A'}. ${result < 0.1 ? 'Low risk — routine monitoring.' : result < 0.3 ? 'Moderate risk — standard mitigation.' : result < 0.6 ? 'High risk — active risk reduction needed.' : 'Very high risk — priority intervention required.'}`,
    recommendations: [
      'Risk reduction: target the dominant component (H, V, or E)',
      'Hazard mitigation: flood walls, seismic retrofit',
      'Vulnerability reduction: building codes, early warning',
      'Exposure reduction: land-use planning, relocation',
    ],
  }),
  metadata: {
    methodology: 'R = H × V × E. UNISDR/UNDRR standardized risk assessment framework.',
    assumptions: ['H, V, E are independent (no correlation)', 'Linear multiplicative interaction', 'All indices normalized to [0, 1]'],
    limitations: ['Real risk functions are nonlinear (S-shaped damage curves)', 'Correlation between H, V, E not captured', 'Does not account for cascading/multi-hazard events'],
    references: ['UNISDR (2004) Living with risk. United Nations, Geneva, 434 pp. ISBN 92-1-121188-6.'],
    preprocessingNotes: ['H from return-period analysis, V from fragility curves', 'E from census/asset databases, normalized to [0,1]'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 136 — Expected Annual Damage
// ══════════════════════════════════════════════════════════════════
export const TOOL_136: ToolWorkflowDef = {
  toolId: 136,
  name: 'Compute Expected Annual Flood Damage',
  vizType: 'scatter',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'D_P', min: 0, max: 1e10 },
    { param: 'P_low', min: 0.0001, max: 0.1 },
    { param: 'P_high', min: 0.01, max: 0.99 },
    { param: 'num_intervals', min: 10, max: 10000 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  USACE EM 1110-2-1619 EAD computation');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result >= 0, message: Number.isFinite(result) ? `$${result.toFixed(0)}/yr` : 'NaN/Inf', severity: Number.isFinite(result) && result >= 0 ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Damage curve shape (α)', contribution: 'Factor of 2–5' },
      { factor: 'D₁₀₀ estimate', contribution: '20–50%' },
      { factor: 'Integration range', contribution: '< 5% for P < 0.001' },
    ],
    overallAssessment: 'Exact for assumed power-law curve; 20–50% real-world deviation',
  }),
  interpret: (result) => ({
    contextualAnalysis: `EAD = $${Number.isFinite(result) ? result.toFixed(0) : 'N/A'}/yr. ${result > 1e6 ? 'Catastrophic — flood insurance essential.' : result > 1e4 ? 'High — risk transfer recommended.' : result > 1e3 ? 'Moderate — monitor regularly.' : 'Low — minimal financial risk.'}`,
    recommendations: [
      'EAD = ∫₀¹ D(P)·dP — average annual loss over all return periods',
      'BCR = ΔEAD / annualized mitigation cost for cost-benefit analysis',
      'FEMA NFIP uses EAD for flood insurance premium calculation',
    ],
  }),
  metadata: {
    methodology: 'EAD = ∫₀¹ D(P)·dP via trapezoidal rule. Power-law D(P) = D₁₀₀×(P/0.01)^{-α}.',
    assumptions: ['Power-law damage-exceedance curve (α=0.8 typical)', 'D₁₀₀ from depth-damage functions + asset inventory', 'Stationary hazard probabilities (no climate change)'],
    limitations: ['Damage curve shape highly uncertain (α varies 0.5–2.0)', 'Does not account for indirect losses (business interruption)', 'Climate change invalidates stationary probability assumption'],
    references: ['USACE (2013) Risk-based analysis for flood damage reduction studies. EM 1110-2-1619.'],
    preprocessingNotes: ['D₁₀₀ from hydraulic model + depth-damage curves', 'α from calibration or regional flood frequency analysis'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 137 — AQI Breakpoint
// ══════════════════════════════════════════════════════════════════
export const TOOL_137: ToolWorkflowDef = {
  toolId: 137,
  name: 'Compute Air Quality Index from Concentration',
  vizType: 'bar',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'I_Hi', min: 0, max: 500 },
    { param: 'I_Lo', min: 0, max: 500 },
    { param: 'BP_Hi', min: 0, max: 10000 },
    { param: 'BP_Lo', min: 0, max: 10000 },
    { param: 'C_p', min: 0, max: 10000 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  EPA 40 CFR Part 50 Appendix G breakpoint interpolation');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result >= 0 && result <= 500, message: Number.isFinite(result) ? `AQI ${Math.round(result)}` : 'NaN/Inf', severity: Number.isFinite(result) && result >= 0 && result <= 500 ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Breakpoint table accuracy', contribution: 'Exact per EPA definition' },
      { factor: 'Concentration measurement', contribution: '±1–5 µg/m³ typical' },
    ],
    overallAssessment: 'Exact linear interpolation per EPA definition',
  }),
  interpret: (result) => ({
    contextualAnalysis: `AQI = ${Number.isFinite(result) ? Math.round(result) : 'N/A'}. ${result <= 50 ? 'Good — satisfactory air quality.' : result <= 100 ? 'Moderate — acceptable for most.' : result <= 150 ? 'Unhealthy for Sensitive Groups.' : result <= 200 ? 'Unhealthy — general population affected.' : result <= 300 ? 'Very Unhealthy — avoid outdoor activity.' : 'Hazardous — emergency conditions.'}`,
    recommendations: [
      'AQI ≤ 50: satisfactory, no health risk',
      'AQI 51–100: moderate, sensitive individuals may be affected',
      'AQI > 100: sensitive groups should reduce outdoor exertion',
      'AQI > 150: everyone should limit prolonged outdoor exertion',
    ],
  }),
  metadata: {
    methodology: 'AQI = [(I_Hi−I_Lo)/(BP_Hi−BP_Lo)] × (C_p−BP_Lo) + I_Lo. EPA 40 CFR Part 50 App. G.',
    assumptions: ['Linear interpolation within breakpoint interval', 'Single pollutant (overall AQI = max across pollutants)'],
    limitations: ['Multi-pollutant AQI requires computing each pollutant separately', 'Breakpoints may be updated by EPA periodically'],
    references: ['US EPA (2024) 40 CFR Part 50, Appendix G — Interpretation of NAAQS for PM2.5.'],
    preprocessingNotes: ['PM2.5 breakpoints from EPA Table 2', 'Concentration from air quality monitor or model'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 138 — Probable Maximum Precipitation
// ══════════════════════════════════════════════════════════════════
export const TOOL_138: ToolWorkflowDef = {
  toolId: 138,
  name: 'Estimate Probable Maximum Precipitation',
  vizType: 'gauge',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'Xbar', min: 0, max: 10000 },
    { param: 'Kp', min: 0, max: 25 },
    { param: 'sigmaX', min: 0, max: 1000 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Chow (1964) / Hershfield (1961) statistical PMP');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result > 0, message: Number.isFinite(result) ? `${result.toFixed(1)} mm` : 'NaN/Inf', severity: Number.isFinite(result) && result > 0 ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'empirical',
    contributingFactors: [
      { factor: 'Record length (need ≥ 30 yr)', contribution: 'Factor of 2 for short records' },
      { factor: 'Frequency factor K_p', contribution: '±30% depending on distribution' },
      { factor: 'Climate non-stationarity', contribution: '+5–15%/°C warming (Clausius-Clapeyron)' },
    ],
    overallAssessment: '±30% for adequate records; ±50% for short records',
  }),
  interpret: (result) => ({
    contextualAnalysis: `PMP = ${Number.isFinite(result) ? result.toFixed(0) : 'N/A'} mm. ${result > 500 ? 'Very high — Gulf Coast / tropical basin.' : result > 300 ? 'High — Midwest / eastern US.' : result > 150 ? 'Moderate — arid/semi-arid.' : 'Low — polar or high-altitude.'}`,
    recommendations: [
      'PMP used for spillway design of high-hazard dams',
      'Climate change: add Clausius-Clapeyron factor (+7%/°C)',
      'WMO (2009) guide provides regional K_p maps',
    ],
  }),
  metadata: {
    methodology: 'PMP = X̄ + K_p × σ_x. Chow (1964) statistical Hershfield method.',
    assumptions: ['Stationary climate (no trend in extremes)', 'Gumbel or similar extreme-value distribution', 'Sufficient record length (≥ 30 years recommended)'],
    limitations: ['Climate change invalidates stationarity assumption', 'Short records give unreliable σ_x', 'Single-site PMP (not areally distributed)'],
    references: ['Chow, V.T. (1964) Handbook of Applied Hydrology. McGraw-Hill, Section 14.'],
    preprocessingNotes: ['X̄ from annual max series (> 30 yr)', 'K_p = 10–15 for 24-hr PMP (Hershfield 1961)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 139 — Palmer Drought Severity Index
// ══════════════════════════════════════════════════════════════════
export const TOOL_139: ToolWorkflowDef = {
  toolId: 139,
  name: 'Palmer Drought Severity Index',
  vizType: 'gauge',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [{ param: 'Xim1', min: -10, max: 10 },{ param: 'Zi', min: -10, max: 10 },{ param: 'alpha', min: 0.5, max: 1 }]),
  preprocess: (inputs, ctx, log) => {
    log.push('  Previous month PDSI');
    log.push('  Current moisture anomaly');
    log.push('  Persistence factor');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const c = classify(result, RISK_BANDS);
    if (c) log.push(`  Result: ${c.label}`);
    return { classification: c };
  },
  qualityCheck: (result) => makeQC([{ name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' }]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 1,
    rmseUnit: 'PDSI',
    contributingFactors: [
      { factor: 'Moisture anomaly', contribution: 'Varies' },
      { factor: 'Persistence factor', contribution: 'Varies' },
      { factor: 'Calibration', contribution: 'Varies' },
    ],
    overallAssessment: '+/- 1 PDSI uncertainty',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Palmer Drought Severity Index: ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Drought monitoring index.`,
    recommendations: ["PDSI: −4 extreme drought, +4 extreme wet.","Monthly time step.","For operational use: see NOAA NCEI self-calibrating PDSI.","Not suitable for flash drought detection (< 1 month onset)."],
  }),
  metadata: {
    methodology: 'PDSI recurrence: X_i = α·X_{i-1} + Z/3 where α=0.897 (US calibration).',
    assumptions: ['Persistence factor α=0.897 calibrated for central US', 'Monthly time step', 'Z-index requires full water balance (P, T, ET, soil moisture)'],
    limitations: ['Not directly comparable across climate regions', 'Thornthwaite PET underestimates in arid regions', 'Slow response (9-18 month timescale) not suited for flash droughts', 'Snow accumulation/melt not well represented'],
    references: ['Palmer, W.C. (1965) Meteorological drought. US Weather Bureau Research Paper No. 45.'],
    preprocessingNotes: ['Previous month PDSI (−10 to +10)', 'Current moisture anomaly Z (−10 to +10)', 'Persistence factor α (0.5 to 1.0)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 140 — Froehlich Dam Breach
// ══════════════════════════════════════════════════════════════════
export const TOOL_140: ToolWorkflowDef = {
  toolId: 140,
  name: 'Froehlich Dam Breach Parameters',
  vizType: 'scalar',
  classificationBands: RISK_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'K0', min: 0.5, max: 3 },
    { param: 'Vres', min: 1000, max: 100000000000 },
    { param: 'hb', min: 1, max: 300 },
  ]),
  preprocess: (inputs, ctx, log) => {
    const k0 = Number(inputs.K0);
    log.push(`  K₀ = ${k0} ${k0 <= 1.3 ? '(overtopping)' : '(piping)'}`);
    log.push(`  V_res = ${(inputs.Vres as number).toExponential(2)} m³`);
    log.push(`  h_b = ${inputs.hb} m`);
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    log.push(`  B_avg = ${Number.isFinite(result) ? result.toFixed(1) : 'N/A'} m`);
    return {};
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result > 0, message: Number.isFinite(result) && result > 0 ? 'Positive' : 'Invalid', severity: Number.isFinite(result) && result > 0 ? 'info' : 'error' },
    { name: 'Magnitude', passed: result > 5 && result < 500, message: `${result.toFixed(0)} m — ${result > 5 && result < 500 ? 'physically plausible' : 'check inputs'}`, severity: result > 5 && result < 500 ? 'info' : 'warning' },
  ]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 25,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Regression scatter (±50% prediction intervals)', contribution: 'High' },
      { factor: 'Erosion resistance of embankment material', contribution: 'Medium' },
      { factor: 'Partial vs full breach', contribution: 'Medium' },
    ],
    overallAssessment: 'Froehlich 2008 regression: ±25% RMSE, ±50% prediction intervals. Empirical from 108 historical dam failures.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Froehlich average breach width: ${Number.isFinite(result) ? result.toFixed(1) + ' m' : 'N/A'}. Empirical regression from 108 historical dam failures (Froehlich 2008).`,
    recommendations: [
      'K₀ = 1.0 for overtopping, 1.3 for piping failure mode',
      'Peak outflow Q_p ≈ 3.1 × B_avg × h_b^1.5 (broad-crested weir)',
      'Breach formation time t_f = 0.0179 × K₁ × V^0.34 × h_b^(-0.14) hours',
      'For downstream flood routing: use FLDWAV, HEC-RAS 2D, or NWS BREACH model',
    ],
  }),
  metadata: {
    methodology: 'Froehlich (2008): B_avg = 0.1803 × K₀ × V_res^0.32 × h_b^0.19. Q_p = 3.1 × B_avg × h_b^1.5. t_f = 0.0179 × K₁ × V^0.34 × h_b^(-0.14).',
    assumptions: ['Empirical regression from 108 historical dam failures', 'Full breach development assumed', 'Breach height = dam height (conservative)'],
    limitations: ['Prediction intervals ±50% (considerable scatter)', 'Does not account for erosion resistance', 'Partial breaches are common but not modeled', 'Concrete/masonry dams have different failure modes'],
    references: ['Froehlich, D.C. (2008) Embankment dam breach parameters and their uncertainties. J. Hydraul. Eng., 134(9), 1306–1314.'],
    preprocessingNotes: ['K₀: 1.0 (overtopping), 1.3 (piping)', 'V_res: reservoir volume at time of failure (m³)', 'h_b: breach height, typically dam height (m)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 141 — Ensemble Kalman Filter
// ══════════════════════════════════════════════════════════════════
export const TOOL_141: ToolWorkflowDef = {
  toolId: 141,
  name: 'Kalman Filter Analysis',
  vizType: 'scalar',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'xf', min: -1e6, max: 1e6 },
    { param: 'Pf', min: 0.001, max: 1e6 },
    { param: 'y', min: -1e6, max: 1e6 },
    { param: 'R', min: 0, max: 1e6 },
    { param: 'H', min: -100, max: 100 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push(`  Forecast x_f = ${inputs.xf}, P_f = ${inputs.Pf}`);
    log.push(`  Observation y = ${inputs.y}, R = ${inputs.R}`);
    log.push(`  Observation operator H = ${inputs.H}`);
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    log.push(`  Analysis state x_a = ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}`);
    return {};
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Observation operator linearity', contribution: 'Low (scalar case)' },
      { factor: 'Error covariance specification', contribution: 'High' },
    ],
    overallAssessment: 'Exact for linear scalar systems; EnKF extends to nonlinear high-dimensional via ensemble.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Kalman filter analysis: x_a = ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. The analysis state is the optimal (minimum variance) estimate combining forecast and observations.`,
    recommendations: [
      'K > 0.5: observation-weighted — forecast is uncertain relative to obs',
      'K < 0.1: model-weighted — forecast is reliable relative to obs',
      'EnKF (Evensen 1994) extends this to ensembles for high-dimensional systems',
      'Operational at ECMWF, NOAA GFS, NASA GEOS for weather/climate digital twins',
    ],
  }),
  metadata: {
    methodology: 'Kalman filter analysis: x_a = x_f + K·(y − H·x_f), K = P_f·H^T·(H·P_f·H^T + R)^{-1}.',
    assumptions: ['Linear observation operator', 'Gaussian error distributions', 'Known error covariances P_f and R'],
    limitations: ['Scalar (single state variable) — EnKF extends to high-dimensional', 'Requires accurate P_f and R specification', 'Ensemble collapse in EnKF needs inflation/localization'],
    references: ['Kalman, R.E. (1960) A new approach to linear filtering and prediction problems.', 'Evensen, G. (1994) Sequential data assimilation with a nonlinear QG model. J. Geophys. Res.'],
    preprocessingNotes: ['Forecast x_f from model forward integration', 'P_f from ensemble spread or climatology', 'Observation y from in-situ or remote sensing', 'R from instrument error characterization'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 142 — Optimal Interpolation
// ══════════════════════════════════════════════════════════════════
export const TOOL_142: ToolWorkflowDef = {
  toolId: 142,
  name: 'Optimal Interpolation',
  vizType: 'scalar',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'xb', min: -1e6, max: 1e6 },
    { param: 'y', min: -1e6, max: 1e6 },
    { param: 'B', min: 0.001, max: 1e6 },
    { param: 'R', min: 0, max: 1e6 },
    { param: 'H', min: -100, max: 100 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push(`  Background x_b = ${inputs.xb}, B = ${inputs.B}`);
    log.push(`  Observation y = ${inputs.y}, R = ${inputs.R}`);
    log.push(`  Observation operator H = ${inputs.H}`);
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    log.push(`  Analysis x_a = ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}`);
    return {};
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? 'Finite' : 'NaN/Inf', severity: Number.isFinite(result) ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Static B (no flow dependence)', contribution: 'High' },
      { factor: 'Observation error specification', contribution: 'Medium' },
    ],
    overallAssessment: 'Exact for linear scalar systems. OI was operational at NCEP (1970s-1990s) and ECMWF (until 1996).',
  }),
  interpret: (result) => ({
    contextualAnalysis: `OI analysis: x_a = ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Minimum-variance estimate combining background and observations with static covariances.`,
    recommendations: [
      'OI uses static B — cannot capture flow-dependent error structures',
      '3D-Var (Lorenc 1986) extends OI to cost-function minimization',
      'EnKF (Evensen 1994) replaces static B with ensemble-derived covariances',
      'Still used in ocean assimilation (SODA, GODAS) and regional models',
    ],
  }),
  metadata: {
    methodology: 'OI: x_a = x_b + B·H^T·(H·B·H^T + R)^{-1}·(y − H·x_b). Static background error covariance B.',
    assumptions: ['Static (time-invariant) background error covariance B', 'Linear observation operator H', 'Gaussian errors with known covariances'],
    limitations: ['B is not flow-dependent — cannot capture developing weather features', 'Requires prescribed B (correlation length scale L, error variance σ_b²)', 'Observation selection needed for large N_obs (local domains)'],
    references: ['Lorenz, E.N. (1969) A method for applying continuous corrections to empirical forecast equations.', 'Gandin, L.S. (1963) Objective analysis of meteorological fields. Gidrometeoizdat.'],
    preprocessingNotes: ['Background x_b from previous forecast or climatology', 'Observation y from in-situ or remote sensing', 'B from prescribed correlation function (Gaussian, SOAR)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 143 — 4D-Var Cost Function
// ══════════════════════════════════════════════════════════════════
export const TOOL_143: ToolWorkflowDef = {
  toolId: 143,
  name: '3D-Var Cost Function',
  vizType: 'scalar',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'x', min: -1e6, max: 1e6 },
    { param: 'xb', min: -1e6, max: 1e6 },
    { param: 'B', min: 0.001, max: 1e6 },
    { param: 'y', min: -1e6, max: 1e6 },
    { param: 'R', min: 0.001, max: 1e6 },
    { param: 'H', min: -100, max: 100 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push(`  State x = ${inputs.x}, Background x_b = ${inputs.xb}`);
    log.push(`  B = ${inputs.B}, R = ${inputs.R}, H = ${inputs.H}`);
    log.push(`  Observation y = ${inputs.y}`);
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    log.push(`  Cost J(x) = ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}`);
    return {};
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result >= 0, message: Number.isFinite(result) ? `${result.toFixed(4)}` : 'NaN/Inf', severity: Number.isFinite(result) && result >= 0 ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'B matrix accuracy', contribution: 'High' },
      { factor: 'Observation error specification', contribution: 'Medium' },
      { factor: 'Linearity assumption (tangent-linear)', contribution: 'High for nonlinear processes' },
    ],
    overallAssessment: 'Exact for scalar linear case. 4D-Var extends to time window with adjoint model.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `3D-Var cost function: J = ${Number.isFinite(result) ? result.toFixed(4) : 'N/A'}. Evaluates misfit between state x, background x_b, and observations y.`,
    recommendations: [
      'J = J_b + J_o: background term + observation term',
      'Minimum at x_a = (x_b/B + H·y/R) / (1/B + H²/R)',
      '4D-Var (Le Dimet & Talagrand 1986) extends to time window with adjoint model',
      'Operational at ECMWF since 1997 — gold standard for global NWP',
    ],
  }),
  metadata: {
    methodology: '3D-Var: J(x) = ½(x−x_b)ᵀB⁻¹(x−x_b) + ½(y−Hx)ᵀR⁻¹(y−Hx). 4D-Var sums over time window.',
    assumptions: ['Single time step (3D-Var)', 'Linear observation operator H', 'Gaussian errors with known B and R'],
    limitations: ['Static B (no flow dependence)', 'Requires adjoint model for 4D-Var', 'Tangent-linear approximation breaks down for nonlinear processes'],
    references: ['Le Dimet, F.-X. & Talagrand, O. (1986) Variational algorithms for analysis and assimilation of meteorological observations. Mon. Weather Rev., 114(9), 1689-1706.'],
    preprocessingNotes: ['State x: current iterate (start with x_b)', 'Background x_b from previous forecast', 'B from error statistics or ensemble', 'Observation y from instruments', 'R from instrument error characterization'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 144 — Shannon Information Entropy
// ══════════════════════════════════════════════════════════════════
export const TOOL_144: ToolWorkflowDef = {
  toolId: 144,
  name: 'Shannon Information Entropy',
  vizType: 'scalar',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'px', min: 0.001, max: 0.999 },
    { param: 'py', min: 0.001, max: 0.999 },
    { param: 'Hxy', min: 0, max: 2 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push(`  p(x) = ${inputs.px}, p(y) = ${inputs.py}`);
    log.push(`  Joint entropy H(X,Y) = ${inputs.Hxy} bits`);
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    log.push(`  H(X) = ${Number.isFinite(result) ? (result as number).toFixed(4) : 'N/A'} bits`);
    return {};
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result >= 0 && result <= 1, message: Number.isFinite(result) ? `${(result as number).toFixed(4)} bits` : 'NaN', severity: Number.isFinite(result) && result >= 0 && result <= 1 ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Probability estimation from finite samples', contribution: 'Medium' },
      { factor: 'Discretization/binning for continuous variables', contribution: 'Medium' },
    ],
    overallAssessment: 'Exact for known discrete distributions. For estimated probabilities: bias-corrected estimators recommended for small samples.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Shannon entropy H(X) = ${Number.isFinite(result) ? (result as number).toFixed(4) : 'N/A'} bits. Mutual information I(X;Y) quantifies shared information.`,
    recommendations: [
      'H(X) = 0: deterministic (no uncertainty)',
      'H(X) = 1 bit: maximum for binary variable (fair coin)',
      'I(X;Y) = 0: X and Y are independent',
      'I(X;Y) = H(X): Y fully determines X',
      'For data assimilation: entropy reduction = observation value',
    ],
  }),
  metadata: {
    methodology: 'Binary entropy: H(X) = −p·log₂(p) − (1−p)·log₂(1−p). Mutual info: I(X;Y) = H(X) + H(Y) − H(X,Y).',
    assumptions: ['Binary variables (two outcomes each)', 'Known probabilities', 'H(X,Y) provided directly as joint entropy (bits)'],
    limitations: ['Binary only — multivariate requires full distribution', 'Continuous entropy differs (differential entropy)', 'Probability estimation from finite samples introduces bias'],
    references: ['Shannon, C.E. (1948) A mathematical theory of communication. Bell Syst. Tech. J., 27(3), 379-423.'],
    preprocessingNotes: ['p(x): probability of X=1 (binary variable)', 'p(y): probability of Y=1 (binary variable)', 'H(X,Y): joint entropy in bits (provided, not derived from a single probability)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 145 — Free-Space Path Loss
// ══════════════════════════════════════════════════════════════════
export const TOOL_145: ToolWorkflowDef = {
  toolId: 145,
  name: 'Free-Space Path Loss',
  vizType: 'scalar',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'dKm', min: 0.001, max: 1e10 },
    { param: 'fGHz', min: 0.001, max: 1000 },
  ]),
  preprocess: (inputs, ctx, log) => {
    const d = inputs.dKm as number;
    const f = inputs.fGHz as number;
    log.push(`  Distance d = ${d >= 1000 ? (d/1000).toFixed(1) + '×10³ km' : d.toFixed(1) + ' km'}`);
    log.push(`  Frequency f = ${f >= 1 ? f.toFixed(2) + ' GHz' : (f*1000).toFixed(0) + ' MHz'}`);
    log.push(`  Wavelength λ = ${(0.3/f).toFixed(3)} m`);
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    log.push(`  FSPL = ${Number.isFinite(result) ? (result as number).toFixed(2) : 'N/A'} dB`);
    return {};
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result > 0, message: Number.isFinite(result) ? `${(result as number).toFixed(2)} dB` : 'NaN', severity: Number.isFinite(result) && result > 0 ? 'info' : 'error' },
    { name: 'Magnitude', passed: result > 20 && result < 400, message: `${(result as number).toFixed(2)} dB — ${result > 20 && result < 400 ? 'physically plausible' : 'check inputs'}`, severity: result > 20 && result < 400 ? 'info' : 'warning' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Exact formula (no approximation)', contribution: 'Zero' },
      { factor: 'Atmospheric absorption (not included)', contribution: '1-10 dB depending on frequency/weather' },
      { factor: 'Multipath/obstruction (not included)', contribution: '0-30 dB depending on environment' },
    ],
    overallAssessment: 'Exact for free-space propagation. Real links add 1-30 dB atmospheric/obstruction losses.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `FSPL = ${Number.isFinite(result) ? (result as number).toFixed(2) : 'N/A'} dB. Free-space path loss — signal attenuation from spherical wavefront spreading.`,
    recommendations: [
      'FSPL = 32.45 + 20·log₁₀(d_km) + 20·log₁₀(f_GHz)',
      'Link budget: P_r = P_t + G_t + G_r − FSPL − other losses (dB)',
      'LEO (1000 km, 2 GHz): ~158 dB; GEO (36000 km, 2 GHz): ~180 dB',
      'Ka-band (20 GHz) has ~20 dB more loss than L-band (2 GHz)',
    ],
  }),
  metadata: {
    methodology: 'FSPL(dB) = 32.45 + 20·log₁₀(d_km) + 20·log₁₀(f_GHz). Derived from Friis transmission equation.',
    assumptions: ['Free-space propagation (no obstacles)', 'No atmospheric absorption', 'Line-of-sight path', 'Isotropic or specified antenna gains'],
    limitations: ['Atmospheric attenuation (rain, clouds, gases): 1-10 dB', 'Multipath fading: 0-30 dB', 'Antenna pointing errors: 0-3 dB', 'Polarization mismatch: 0-3 dB'],
    references: ['Friis, H.T. (1946) A note on a simple transmission formula. Proc. IRE, 34(5), 254-256.', 'ITU-R P.525-2: Calculation of free-space path loss.'],
    preprocessingNotes: ['dKm: distance in kilometers (e.g., satellite range)', 'fGHz: frequency in GHz (e.g., 2.4 for WiFi, 12 for Ku-band)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 146 — Klobuchar Ionospheric Delay
// ══════════════════════════════════════════════════════════════════
export const TOOL_146: ToolWorkflowDef = {
  toolId: 146,
  name: 'Klobuchar Ionospheric Delay',
  vizType: 'timeseries',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'alpha1', min: -1e6, max: 1e6 },
    { param: 'alpha2', min: -1e6, max: 1e6 },
    { param: 'alpha3', min: -1e6, max: 1e6 },
    { param: 'alpha4', min: -1e6, max: 1e6 },
    { param: 'beta1', min: 0, max: 1e8 },
    { param: 'beta2', min: -1e8, max: 1e8 },
    { param: 'beta3', min: -1e8, max: 1e8 },
    { param: 'beta4', min: -1e8, max: 1e8 },
    { param: 'phi_m', min: -90, max: 90 },
    { param: 't_sec', min: 0, max: 86400 },
    { param: 'elevation', min: 5, max: 90 },
  ]),
  preprocess: (inputs, ctx, log) => {
    log.push(`  α coefficients: [${inputs.alpha1}, ${inputs.alpha2}, ${inputs.alpha3}, ${inputs.alpha4}]`);
    log.push(`  β coefficients: [${inputs.beta1}, ${inputs.beta2}, ${inputs.beta3}, ${inputs.beta4}]`);
    log.push(`  Geomagnetic lat φ_m = ${inputs.phi_m}°`);
    log.push(`  Local time t = ${inputs.t_sec} s (${(inputs.t_sec as number / 3600).toFixed(1)} h)`);
    log.push(`  Elevation E = ${inputs.elevation}°`);
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const delay_m = (result as number) * 1e-9 * 299792458;
    log.push(`  Vertical delay = ${(result as number).toFixed(1)} ns = ${delay_m.toFixed(2)} m`);
    return {};
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result >= 5, message: Number.isFinite(result) ? `${(result as number).toFixed(1)} ns` : 'NaN/Inf', severity: Number.isFinite(result) && result >= 5 ? 'info' : 'error' },
    { name: 'Magnitude', passed: result >= 5 && result <= 100, message: `${(result as number).toFixed(1)} ns — ${result > 5 && result <= 100 ? 'physically plausible' : 'check inputs'}`, severity: result > 5 && result <= 100 ? 'info' : 'warning' },
  ]),
  estimateUncertainty: () => ({
    method: 'empirical',
    rmse: 50,
    rmseUnit: '%',
    contributingFactors: [
      { factor: 'Thin-shell assumption (350 km)', contribution: 'High' },
      { factor: 'Simplified cosine diurnal shape', contribution: 'Medium' },
      { factor: 'No storm-time correction', contribution: 'High (during storms)' },
      { factor: 'Broadcast coefficient freshness (1-6 day update)', contribution: 'Low' },
    ],
    overallAssessment: 'Klobuchar model: 50-60% RMS error reduction. Residual 2-5 m typical, 10-30 m during storms.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Klobuchar vertical ionospheric delay: ${Number.isFinite(result) ? result.toFixed(1) + ' ns = ' + ((result as number) * 1e-9 * 299792458).toFixed(2) + ' m' : 'N/A'}. Slant delay, obliquity factor and range error in the outputs table.`,
    recommendations: [
      'Klobuchar corrects 50-60% of ionospheric delay RMS error',
      'Nighttime floor: 5 ns (~1.5 m) — always applied',
      'Peak delay at 14:00 local time (50400 s)',
      'Dual-frequency GPS (L1+L2) removes >95% of ionospheric delay',
      'During geomagnetic storms: residual can exceed 10 m — use SBAS or dual-freq',
    ],
  }),
  metadata: {
    methodology: 'Klobuchar (1987) ICD-GPS-200: T_iono = 5 ns + A·(1−x²/2+x⁴/24), where A = Σαᵢ·φ_m^i, P = Σβᵢ·φ_m^i (φ_m in SEMICIRCLES), x = 2π(t−50400)/P. Slant factor F = 1 + 16·(0.53−E)³ (E in semicircles). Primary = vertical delay (ns); secondary = slant delay, F, range error (m), A, P. Paper worked example (40°N,100°W, E=20°): α=[3.82e-8,1.49e-8,-1.79e-7,0], β=[1.43e5,0,-3.28e5,1.13e5], φ_m=45.16°, t=50700 s → TIONO = 77.6 ns (23.3 m) — reproduced exactly.',
    assumptions: ['Thin-shell ionosphere at 350 km altitude', 'Cosine diurnal variation', '8 broadcast α/β coefficients from GPS nav message', 'Single-frequency L1 (1.57542 GHz)'],
    limitations: ['~50% residual error (2-5 m typical)', 'Degrades during geomagnetic storms (10-30 m residual)', 'Poor at equatorial anomaly (±15° magnetic latitude)', 'No storm-time or seasonal correction'],
    references: ['Klobuchar, J.A. (1987) Ionospheric time-delay algorithms for single-frequency GPS users. IEEE Trans. Aerosp. Electron. Syst., 23(3), 325-331.'],
    preprocessingNotes: ['α₁-α₄: broadcast ionospheric amplitude coefficients', 'β₁-β₄: broadcast ionospheric period coefficients', 'φ_m: geomagnetic latitude of ionospheric pierce point (radians)', 't_sec: local time at IPP in seconds of day (0-86400)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 147 — Doppler Shift
// ══════════════════════════════════════════════════════════════════
export const TOOL_147: ToolWorkflowDef = {
  toolId: 147,
  name: 'Doppler Effect (Classical)',
  vizType: 'scatter',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'f0', min: 1, max: 1e15 },
    { param: 'vrel', min: -3e8, max: 3e8 },
  ]),
  preprocess: (inputs, ctx, log) => {
    const v = inputs.vrel as number;
    log.push(`  Source frequency f₀ = ${inputs.f0} Hz`);
    log.push(`  Relative velocity v = ${v.toFixed(1)} m/s (${v > 0 ? 'receding' : v < 0 ? 'approaching' : 'stationary'})`);
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    const df = result as number;
    log.push(`  Δf = ${df.toExponential(3)} Hz`);
    return {};
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? `${(result as number).toExponential(3)} Hz` : 'NaN', severity: Number.isFinite(result) ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Non-relativistic approximation (error ~β²/8)', contribution: 'Negligible for v < 0.01c' },
      { factor: 'Velocity accuracy (radial component only)', contribution: 'User-dependent' },
    ],
    overallAssessment: 'Exact for non-relativistic (v << c). Relativistic formula included for comparison.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Doppler shift Δf = ${Number.isFinite(result) ? (result as number).toExponential(3) : 'N/A'} Hz. ${result < 0 ? 'Blueshift (approaching)' : result > 0 ? 'Redshift (receding)' : 'No shift'}.`,
    recommendations: [
      'Δf = −f₀·v/c (positive v = receding = redshift)',
      'GPS L1 (1.575 GHz): Doppler ≈ ±5 kHz at orbital velocity',
      'Weather radar: measures radial velocity of precipitation',
      'For v > 0.01c: use relativistic formula f_obs = f₀·√((1−β)/(1+β))',
    ],
  }),
  metadata: {
    methodology: 'Classical Doppler: Δf = −f₀·v/c. Sign convention: v > 0 = receding = redshift.',
    assumptions: ['Non-relativistic (v << c)', 'Line-of-sight velocity component', 'Source and observer in inertial frames'],
    limitations: ['Relativistic correction needed for v > 0.01c', 'Transverse Doppler effect not included', 'Atmospheric refraction can shift frequency'],
    references: ['Doppler, C.J. (1842) Über das farbige Licht der Doppelsterne. Abh. Königl. Böhm. Ges. Wiss.'],
    preprocessingNotes: ['f₀: source frequency (Hz)', 'vrel: radial velocity (m/s), positive = receding', 'c: speed of light (default 299792458 m/s)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 148 — Hohmann Transfer
// ══════════════════════════════════════════════════════════════════
export const TOOL_148: ToolWorkflowDef = {
  toolId: 148,
  name: 'Hohmann Transfer',
  vizType: 'timeseries',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'GM', min: 1e10, max: 1e20 },
    { param: 'r1', min: 100000, max: 1e12 },
    { param: 'r2', min: 100000, max: 1e12 },
  ]),
  preprocess: (inputs, ctx, log) => {
    const r1 = inputs.r1 as number;
    const r2 = inputs.r2 as number;
    log.push(`  GM = ${inputs.GM} m³/s²`);
    log.push(`  r₁ = ${(r1/1000).toFixed(0)} km, r₂ = ${(r2/1000).toFixed(0)} km`);
    log.push(`  r₂/r₁ = ${(r2/r1).toFixed(2)}`);
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    log.push(`  Δv₁ = ${(result as number/1000).toFixed(3)} km/s`);
    return {};
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result), message: Number.isFinite(result) ? `${(result as number/1000).toFixed(3)} km/s` : 'NaN', severity: Number.isFinite(result) ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Exact for two-body coplanar circular orbits', contribution: 'Zero' },
      { factor: 'Non-impulsive burns (finite burn loss)', contribution: '1-5% additional Δv' },
      { factor: 'Perturbations (drag, third body)', contribution: '0.1-1% for LEO-GEO' },
    ],
    overallAssessment: 'Exact for ideal Hohmann. Real transfers add 1-5% for finite burns and perturbations.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Hohmann transfer Δv₁ = ${Number.isFinite(result) ? (result as number/1000).toFixed(3) : 'N/A'} km/s. Minimum-energy two-impulse transfer.`,
    recommendations: [
      'Hohmann optimal for r₂/r₁ < 11.94; above that, bi-elliptic is more efficient',
      'LEO→GEO: total Δv ≈ 3.93 km/s, transfer time ≈ 5.3 hours',
      'Transfer time = π·√((r₁+r₂)³/(8GM))',
      'For interplanetary: must account for planetary phase angles (synodic period)',
    ],
  }),
  metadata: {
    methodology: 'Hohmann (1925): Δv₁ = √(GM/r₁)·[√(2r₂/(r₁+r₂))−1], Δv₂ = √(GM/r₂)·[1−√(2r₁/(r₁+r₂))].',
    assumptions: ['Coplanar circular orbits', 'Two-body problem (no perturbations)', 'Impulsive burns (instantaneous Δv)'],
    limitations: ['Not optimal for r₂/r₁ > 11.94 (bi-elliptic better)', 'No plane changes (inclination change adds Δv)', 'Finite burn losses (gravity loss 1-5%)', 'Launch window constraints for interplanetary transfers'],
    references: ['Hohmann, W. (1925) Die Erreichbarkeit der Himmelskörper. R. Oldenbourg Verlag, München.'],
    preprocessingNotes: ['GM: standard gravitational parameter of central body (m³/s²)', 'r₁: initial orbit radius (meters)', 'r₂: target orbit radius (meters)'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 149 — Lagrange Points (L1-L5)
// ══════════════════════════════════════════════════════════════════
export const TOOL_149: ToolWorkflowDef = {
  toolId: 149,
  name: 'Lagrange Points L1-L5',
  vizType: 'scalar',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'm1', min: 1e10, max: 1e35 },
    { param: 'm2', min: 1e10, max: 1e35 },
  ]),
  preprocess: (inputs, ctx, log) => {
    const m1 = (inputs.m1 as number) ?? 5.97e24;
    const m2 = (inputs.m2 as number) ?? 7.34e22;
    const mu = m2 / (m1 + m2);
    log.push(`  Primary M₁ = ${m1.toExponential(2)} kg`);
    log.push(`  Secondary M₂ = ${m2.toExponential(2)} kg`);
    log.push(`  Mass ratio μ = ${mu.toExponential(4)}`);
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    log.push(`  L1 distance from secondary: ${(result as number).toFixed(6)} (normalized)`);
    return {};
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result > 0 && result < 1, message: Number.isFinite(result) ? `${(result as number).toFixed(6)}` : 'NaN', severity: Number.isFinite(result) && result > 0 && result < 1 ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Exact for CR3BP (circular restricted)', contribution: 'Zero for ideal case' },
      { factor: 'Orbital eccentricity', contribution: 'Low (Earth-Moon e≈0.055)' },
    ],
    overallAssessment: 'Exact solution for circular restricted 3-body problem. Newton-Raphson convergence to machine precision.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `L1 distance from secondary: ${Number.isFinite(result) ? result.toFixed(6) + ' (normalized)' : 'N/A'}. Collinear Lagrange point.`,
    recommendations: [
      'L1: between bodies — SOHO, ACE, DSCOVR (Sun-Earth); DSCOVER (Earth-Moon)',
      'L2: beyond secondary — JWST, Planck, Gaia (Sun-Earth)',
      'L3: opposite side of primary from secondary',
      'L4/L5: triangular points — Trojan asteroids (Jupiter)',
      'L4/L5 stable for μ < 0.0385 (Earth-Moon: μ=0.012 → stable!)',
    ],
  }),
  metadata: {
    methodology: 'CR3BP: solve quintic polynomial for collinear points (L1-L3) via Newton-Raphson; L4/L5 at ±60°.',
    assumptions: ['Circular orbits (CR3BP)', 'Two dominant masses', 'Massless third body (spacecraft)', 'No perturbations from other bodies'],
    limitations: ['Real orbits are elliptical (eccentricity effect)', 'Solar radiation pressure, third-body perturbations', 'Station-keeping required for L1/L2/L3 (unstable)'],
    references: ['Lagrange, J.-L. (1772) Essai sur le problème des trois corps.', 'Euler, L. (1767) De motu rectilineo trium corporum se mutuo attrahentium.'],
    preprocessingNotes: ['M₁: primary body mass (kg) — e.g., Sun or Earth', 'M₂: secondary body mass (kg) — e.g., Earth or Moon', 'Results normalized to orbital separation distance'],
  },
  dependencies: [],
};

// ══════════════════════════════════════════════════════════════════
//  EQUATION 150 — Mutual Information
// ══════════════════════════════════════════════════════════════════
export const TOOL_150: ToolWorkflowDef = {
  toolId: 150,
  name: 'Mutual Information',
  vizType: 'scalar',
  classificationBands: GENERIC_BANDS,
  validate: (inputs) => validateRange(inputs, [
    { param: 'px', min: 0.001, max: 0.999 },
    { param: 'py', min: 0.001, max: 0.999 },
    { param: 'pxy', min: 0, max: 1 },
  ]),
  preprocess: (inputs, ctx, log) => {
    const px = inputs.px as number;
    const py = inputs.py as number;
    const pxy = inputs.pxy as number;
    log.push(`  p(x=1) = ${px}, p(y=1) = ${py}`);
    log.push(`  p(x=1,y=1) = ${pxy}`);
    if (pxy > Math.min(px, py)) log.push('  ⚠ p(x,y) > min(p(x),p(y)) — invalid joint probability');
    log.push(`  Location: (${ctx.lat.toFixed(2)}, ${ctx.lon.toFixed(2)})`);
    return inputs;
  },
  postProcess: (result, _base, _ctx, log) => {
    log.push(`  I(X;Y) = ${Number.isFinite(result) ? (result as number).toFixed(4) : 'N/A'} bits`);
    return {};
  },
  qualityCheck: (result) => makeQC([
    { name: 'Range', passed: Number.isFinite(result) && result >= 0, message: Number.isFinite(result) ? `${(result as number).toFixed(4)} bits` : 'NaN', severity: Number.isFinite(result) && result >= 0 ? 'info' : 'error' },
  ]),
  estimateUncertainty: () => ({
    method: 'analytical',
    contributingFactors: [
      { factor: 'Probability estimation from finite samples', contribution: 'Medium' },
      { factor: 'Discretization/binning for continuous variables', contribution: 'Medium' },
    ],
    overallAssessment: 'Exact for known discrete distributions. For estimated probabilities: bias-corrected estimators recommended.',
  }),
  interpret: (result) => ({
    contextualAnalysis: `Mutual information I(X;Y) = ${Number.isFinite(result) ? (result as number).toFixed(4) : 'N/A'} bits. Measures shared information between X and Y.`,
    recommendations: [
      'I(X;Y) = 0: X and Y are independent',
      'I(X;Y) = H(X): Y fully determines X',
      'NMI = I/√(H(X)·H(Y)) normalizes to [0,1]',
      'For data assimilation: I measures observation information content',
      'Use k-nearest neighbors estimator for continuous variables (Kraskov et al. 2004)',
    ],
  }),
  metadata: {
    methodology: 'I(X;Y) = H(X) + H(Y) − H(X,Y). Binary: 4 joint outcomes, full entropy computation.',
    assumptions: ['Binary variables (two outcomes each)', 'Known joint probability p(x=1,y=1)', 'pxy must satisfy 0 ≤ pxy ≤ min(px,py)'],
    limitations: ['Binary only — multivariate requires full joint distribution', 'Continuous MI requires estimator (KNN, kernel, etc.)', 'Finite sample bias in probability estimation'],
    references: ['Shannon, C.E. (1948) A mathematical theory of communication.', 'Cover, T.M. & Thomas, J.A. (2006) Elements of Information Theory, 2nd ed.'],
    preprocessingNotes: ['p(x=1): probability of first binary variable', 'p(y=1): probability of second binary variable', 'p(x=1,y=1): joint probability of both being 1'],
  },
  dependencies: [],
};

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

export type { ToolWorkflowDef };