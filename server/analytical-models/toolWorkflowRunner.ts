/**
 * Tool Workflow Runner — orchestrates the 7-stage scientific pipeline.
 * Imports domain templates from toolWorkflows.ts and adds remaining
 * domains (5-26) + the runToolWorkflow function.
 */

import type { ComputeResult } from './engine';
import {
  GENERIC_TEMPLATE, DOMAIN_TEMPLATES, type DomainTemplate,
  type ValidationResult, type QualityControlResult, type UncertaintyEstimate,
  type InterpretationResult, type WorkflowResult, type ClassificationBand,
} from './toolWorkflows';
import { getToolConfig } from './toolConfigs';
import { getPerToolWorkflow } from './perToolRegistry';

// ══════════════════════════════════════════════════════════════════
//  Compact template helper for domains 5-26
// ══════════════════════════════════════════════════════════════════

function compactTemplate(
  bands: ClassificationBand[],
  uncertainty: UncertaintyEstimate,
  qcRange: [number, number],
  recs: string[],
  analysis: (r: number) => string,
): DomainTemplate {
  return {
    classificationBands: bands,
    uncertainty,
    qcValidRange: qcRange,
    qcChecks: [
      { name: 'Non-finite check', test: (r) => Number.isFinite(r), message: 'Result is NaN or Infinity', severity: 'error' as const },
      { name: 'Physical range', test: (r) => r >= qcRange[0] && r <= qcRange[1], message: 'Result outside physical range', severity: 'warning' as const },
    ],
    recommendations: () => recs,
    contextualAnalysis: analysis,
  };
}

const RISK_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0, label: 'Stable', color: '#22c55e', description: 'Stable/low risk' },
  { min: 0, max: 1, label: 'Low Risk', color: '#84cc16', description: 'Low risk' },
  { min: 1, max: 5, label: 'Moderate', color: '#eab308', description: 'Moderate risk' },
  { min: 5, max: 10, label: 'High', color: '#f97316', description: 'High risk' },
  { min: 10, max: Infinity, label: 'Critical', color: '#ef4444', description: 'Critical risk' },
];

const SPACE_BANDS: ClassificationBand[] = [
  { min: -Infinity, max: 0, label: 'Quiet', color: '#22c55e', description: 'Quiet conditions' },
  { min: 0, max: 1, label: 'Normal', color: '#84cc16', description: 'Normal levels' },
  { min: 1, max: 5, label: 'Active', color: '#eab308', description: 'Elevated activity' },
  { min: 5, max: 10, label: 'Storm', color: '#f97316', description: 'Storm conditions' },
  { min: 10, max: Infinity, label: 'Severe', color: '#ef4444', description: 'Severe storm' },
];

// Populate domains 5-26
DOMAIN_TEMPLATES[5] = compactTemplate(
  [
    { min: -Infinity, max: 0, label: 'Negligible', color: '#64748b', description: 'No significant risk' },
    { min: 0, max: 10, label: 'Low', color: '#22c55e', description: 'Low probability' },
    { min: 10, max: 50, label: 'Moderate', color: '#eab308', description: 'Moderate risk' },
    { min: 50, max: 100, label: 'High', color: '#f97316', description: 'High risk' },
    { min: 100, max: Infinity, label: 'Extreme', color: '#ef4444', description: 'Extreme event' },
  ],
  { method: 'qualitative', contributingFactors: [{ factor: 'Sample size', contribution: 'Decreases with longer records' }, { factor: 'Distribution fit', contribution: 'Varies with data' }], overallAssessment: 'Use >30 years for reliable return periods.' },
  [-Infinity, Infinity],
  ['Use >= 30 years for reliable estimation.', 'Compare Gumbel and GEV with AIC/BIC.', 'Cross-reference USGS stream gauge records.'],
  (r) => `Spatial/extreme analysis result: ${r.toFixed(4)}. Interpret in context of statistical distribution and sample size.`,
);

DOMAIN_TEMPLATES[6] = compactTemplate(
  [
    { min: -Infinity, max: 0.1, label: 'Very Low', color: '#a8a29e', description: 'Very low conductivity' },
    { min: 0.1, max: 1, label: 'Low', color: '#eab308', description: 'Low permeability' },
    { min: 1, max: 10, label: 'Moderate', color: '#22c55e', description: 'Moderate permeability' },
    { min: 10, max: 100, label: 'High', color: '#60a5fa', description: 'High permeability' },
    { min: 100, max: Infinity, label: 'Very High', color: '#3b82f6', description: 'Very high permeability' },
  ],
  { method: 'empirical', rmse: 0.5, rmseUnit: 'log10(K)', contributingFactors: [{ factor: 'Pedotransfer function', contribution: '+/- 0.5 log10(K)' }, { factor: 'Soil texture variability', contribution: '+/- 10-30%' }], overallAssessment: 'Pedotransfer parameters have order-of-magnitude uncertainty.' },
  [0, Infinity],
  ['Validate with ROSETTA pedotransfer functions.', 'Use in-situ measurements for field-scale.', 'Use ISRIC SoilGrids 250m for spatial variability.'],
  (r) => `Soil parameter of ${r.toFixed(4)} reflects hydraulic/thermal properties from soil texture.`,
);

DOMAIN_TEMPLATES[7] = compactTemplate(
  [
    { min: -Infinity, max: 0, label: 'No Flux', color: '#64748b', description: 'No carbon flux' },
    { min: 0, max: 5, label: 'Low', color: '#84cc16', description: 'Low productivity' },
    { min: 5, max: 15, label: 'Moderate', color: '#22c55e', description: 'Moderate productivity' },
    { min: 15, max: 30, label: 'High', color: '#15803d', description: 'High productivity' },
    { min: 30, max: Infinity, label: 'Very High', color: '#059669', description: 'Tropical forest' },
  ],
  { method: 'empirical', rmse: 20, rmseUnit: '%', contributingFactors: [{ factor: 'Light use efficiency', contribution: '+/- 20-30%' }, { factor: 'fPAR retrieval', contribution: '+/- 5-10%' }, { factor: 'PAR estimation', contribution: '+/- 10%' }], overallAssessment: 'Monteith LUE GPP has +/- 20-30% uncertainty. MODIS MOD17 provides validated estimates.' },
  [0, Infinity],
  ['Compare with MODIS MOD17 GPP product.', 'Use FLUXNET towers for ground-truth.', 'PAR = SW x 2.02 is approximate (+/- 10%).'],
  (r) => `Carbon flux of ${r.toFixed(2)} gC/m2/day. Values >15 indicate highly productive ecosystems.`,
);

DOMAIN_TEMPLATES[8] = compactTemplate(
  [
    { min: -Infinity, max: 0, label: 'No Growth', color: '#64748b', description: 'Below base temperature' },
    { min: 0, max: 5, label: 'Slow', color: '#3b82f6', description: 'Slow development' },
    { min: 5, max: 15, label: 'Normal', color: '#22c55e', description: 'Normal development' },
    { min: 15, max: 25, label: 'Rapid', color: '#eab308', description: 'Rapid development' },
    { min: 25, max: Infinity, label: 'Optimal+', color: '#f97316', description: 'Optimal or above' },
  ],
  { method: 'empirical', rmse: 10, rmseUnit: '%', contributingFactors: [{ factor: 'Temperature data', contribution: '+/- 0.5-1.5 C' }, { factor: 'Crop thresholds', contribution: 'Varies by cultivar' }], overallAssessment: 'Agricultural indices have +/- 10% typical uncertainty.' },
  [0, Infinity],
  ['Apply crop coefficients (Kc) for crop ET.', 'Monitor soil moisture for verification.', 'Use USDA crop progress for phenological validation.'],
  (r) => `Agricultural parameter of ${r.toFixed(2)} indicates crop development status.`,
);

DOMAIN_TEMPLATES[9] = compactTemplate(
  [
    { min: -Infinity, max: 0, label: 'None', color: '#64748b', description: 'No concentration' },
    { min: 0, max: 50, label: 'Good', color: '#22c55e', description: 'Good air quality' },
    { min: 50, max: 100, label: 'Moderate', color: '#eab308', description: 'Moderate AQ' },
    { min: 100, max: 150, label: 'Unhealthy (SG)', color: '#f97316', description: 'Unhealthy for sensitive groups' },
    { min: 150, max: Infinity, label: 'Unhealthy', color: '#ef4444', description: 'Unhealthy' },
  ],
  { method: 'empirical', rmse: 15, rmseUnit: '%', contributingFactors: [{ factor: 'OH concentration', contribution: '[OH] ~ 1e6 mol/cm3' }, { factor: 'Rate constants', contribution: 'Temperature dependent' }], overallAssessment: 'Atmospheric chemistry uncertainties of +/- 15% typical.' },
  [0, Infinity],
  ['Cross-validate with OpenAQ API.', 'Use CAMS for global atmospheric composition.', 'Consider multi-species interactions.'],
  (r) => `Atmospheric chemistry result of ${r.toFixed(4)}. Compare with WHO/EPA air quality standards.`,
);

for (const d of [10, 11]) {
  DOMAIN_TEMPLATES[d] = compactTemplate(
    [
      { min: -Infinity, max: 0.1, label: 'Calm', color: '#22c55e', description: 'Calm conditions' },
      { min: 0.1, max: 1, label: 'Low', color: '#84cc16', description: 'Low energy' },
      { min: 1, max: 5, label: 'Moderate', color: '#eab308', description: 'Moderate energy' },
      { min: 5, max: 10, label: 'High', color: '#f97316', description: 'High energy' },
      { min: 10, max: Infinity, label: 'Extreme', color: '#ef4444', description: 'Storm conditions' },
    ],
    { method: 'empirical', rmse: 15, rmseUnit: '%', contributingFactors: [{ factor: 'Wind forcing', contribution: '+/- 10-20%' }, { factor: 'Satellite altimetry', contribution: '+/- 2-3 cm SSH' }], overallAssessment: 'Ocean dynamics uncertainties of +/- 15%.' },
    [-Infinity, Infinity],
    ['Use CMEMS/AVISO satellite altimetry for ocean currents.', 'Validate wave models against NDBC buoy data.', 'Use high-resolution regional models for coastal areas.'],
    (r) => `Ocean parameter of ${r.toFixed(4)} reflects circulation/wave dynamics.`,
  );
}

for (const d of [12, 13, 14]) {
  DOMAIN_TEMPLATES[d] = compactTemplate(
    RISK_BANDS,
    { method: 'qualitative', contributingFactors: [{ factor: 'Topographic data', contribution: 'SRTM +/- 5-10 m' }, { factor: 'Geotechnical parameters', contribution: 'High spatial variability' }], overallAssessment: 'Geomorphological hazard assessments have high uncertainty.' },
    [-Infinity, Infinity],
    ['Use high-resolution DEM (LiDAR where available).', 'Validate with field geotechnical investigations.', 'Consider probabilistic hazard assessment.'],
    (r) => `Geomorphological result of ${r.toFixed(4)}. Factor of safety >1.5 indicates stable conditions.`,
  );
}

for (const d of [15, 16, 17]) {
  DOMAIN_TEMPLATES[d] = compactTemplate(
    [
      { min: -Infinity, max: 0, label: 'Negative', color: '#3b82f6', description: 'Cooling effect' },
      { min: 0, max: 1, label: 'Neutral', color: '#64748b', description: 'Near-zero feedback' },
      { min: 1, max: 5, label: 'Positive', color: '#eab308', description: 'Warming feedback' },
      { min: 5, max: Infinity, label: 'Strong Positive', color: '#ef4444', description: 'Strong warming' },
    ],
    { method: 'qualitative', contributingFactors: [{ factor: 'Cloud feedback', contribution: 'Largest uncertainty source' }, { factor: 'Model resolution', contribution: 'Parameterized processes' }], overallAssessment: 'Climate parameters have significant model spread. IPCC AR6 provides best estimates.' },
    [-Infinity, Infinity],
    ['Compare with IPCC AR6 ECS estimates (~3C).', 'Use ERA5 for atmospheric dynamics validation.', 'Cross-reference CERES satellite radiation budget.'],
    (r) => `Climate parameter of ${r.toFixed(4)}. Positive = warming feedback; negative = cooling.`,
  );
}

for (const d of [18, 19, 20, 21]) {
  DOMAIN_TEMPLATES[d] = compactTemplate(
    SPACE_BANDS,
    { method: 'empirical', rmse: 10, rmseUnit: '%', contributingFactors: [{ factor: 'Solar wind input', contribution: '+/- 10-15%' }, { factor: 'Model coefficients', contribution: 'Empirically calibrated' }], overallAssessment: 'Space environment models have +/- 10% typical uncertainty.' },
    [-Infinity, Infinity],
    ['Use NOAA SWPC for real-time space weather data.', 'Use NRLMSIS 2.0 for thermosphere density.', 'Validate against CelesTrak orbital tracking data.'],
    (r) => `Space environment parameter of ${r.toFixed(4)}. Kp >5 indicates geomagnetic storm conditions.`,
  );
}

for (const d of [22, 23, 24, 25, 26]) {
  DOMAIN_TEMPLATES[d] = compactTemplate(
    RISK_BANDS,
    { method: 'qualitative', contributingFactors: [{ factor: 'Engineering parameters', contribution: 'Site-specific variability' }, { factor: 'Historical data', contribution: 'Limited record length' }], overallAssessment: 'Engineering/risk parameters require site-specific calibration.' },
    [-Infinity, Infinity],
    ['Use USGS/NOAA authoritative data sources.', 'Apply site-specific calibration where possible.', 'Consider probabilistic risk assessment frameworks.'],
    (r) => `Engineering/risk parameter of ${r.toFixed(4)}. Interpret within regulatory and engineering context.`,
  );
}

// ══════════════════════════════════════════════════════════════════
//  Tool ID -> Domain number mapping
// ══════════════════════════════════════════════════════════════════

const TOOL_DOMAIN: Record<number, number> = {};
(function populateToolDomain(): void {
  const ranges: Array<[number, number, number]> = [
    [1, 8, 1], [9, 18, 2], [19, 25, 3], [26, 35, 4], [36, 42, 5],
    [43, 50, 6], [51, 57, 7], [58, 63, 8], [64, 65, 9],
    [66, 73, 10], [74, 80, 11], [81, 87, 12], [88, 90, 13],
    [91, 95, 14], [96, 101, 15], [102, 107, 16], [108, 110, 17],
    [111, 115, 18], [116, 122, 19], [123, 127, 20], [128, 130, 21],
    [131, 134, 22], [135, 140, 23], [141, 144, 24], [145, 147, 25], [148, 150, 26],
  ];
  for (const [lo, hi, dom] of ranges) {
    for (let id = lo; id <= hi; id++) TOOL_DOMAIN[id] = dom;
  }
})();

function _getDomainTemplate(toolId: number): DomainTemplate {
  const dom = TOOL_DOMAIN[toolId] ?? 0;
  return DOMAIN_TEMPLATES[dom] ?? GENERIC_TEMPLATE;
}

// ══════════════════════════════════════════════════════════════════
//  Workflow pipeline stages
// ══════════════════════════════════════════════════════════════════

function validateInputs(
  inputs: Record<string, unknown>,
  rules: Array<{ param: string; min?: number; max?: number; unit?: string }>,
): ValidationResult {
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
    if (!Number.isFinite(num)) {
      errors.push(`Parameter '${rule.param}' is not a finite number (got: ${String(val)}).`);
      continue;
    }
    if (rule.min !== undefined && num < rule.min) {
      errors.push(`Parameter '${rule.param}' = ${num} is below minimum ${rule.min}${rule.unit ? ' ' + rule.unit : ''}.`);
    }
    if (rule.max !== undefined && num > rule.max) {
      errors.push(`Parameter '${rule.param}' = ${num} exceeds maximum ${rule.max}${rule.unit ? ' ' + rule.unit : ''}.`);
    }
    validated[rule.param] = num;
  }
  return { valid: errors.length === 0, errors, warnings, validatedParams: validated };
}

function runQualityControl(
  result: number,
  template: DomainTemplate,
): QualityControlResult {
  const checks = template.qcChecks.map((qc) => ({
    name: qc.name,
    passed: qc.test(result),
    message: qc.message,
    severity: qc.severity,
  }));
  return {
    passed: checks.every((c) => c.passed || c.severity === 'info'),
    checks,
  };
}

function classifyResult(
  result: number,
  template: DomainTemplate,
): { label: string; color: string; description: string } | undefined {
  for (const band of template.classificationBands) {
    if (result >= band.min && result < band.max) {
      return { label: band.label, color: band.color, description: band.description };
    }
  }
  return undefined;
}

function estimateUncertainty(
  result: number,
  template: DomainTemplate,
): UncertaintyEstimate {
  const u = template.uncertainty;
  if (u.rmse !== undefined && u.confidenceInterval) {
    const absRmse = Math.abs(u.rmse);
    const isPercent = u.rmseUnit === '%';
    const margin = isPercent ? Math.abs(result) * absRmse / 100 : absRmse;
    return {
      ...u,
      confidenceInterval: {
        lower: result - margin,
        upper: result + margin,
        level: u.confidenceInterval.level,
      },
    };
  }
  return u;
}

function interpretResult(
  result: number,
  template: DomainTemplate,
): InterpretationResult {
  const classification = classifyResult(result, template);
  const contextualAnalysis = template.contextualAnalysis(result);
  const recommendations = template.recommendations(result);
  return { classification, contextualAnalysis, recommendations };
}

/** Compute a data quality score (0-1) based on how many live sources contributed. */
function computeQualityScore(dataSources: string[], validationWarnings: number, qcErrors: number): number {
  let score = 0.5;
  score += Math.min(0.3, dataSources.length * 0.06);
  score -= Math.min(0.2, validationWarnings * 0.03);
  score -= Math.min(0.2, qcErrors * 0.1);
  return Math.max(0, Math.min(1, score));
}

// ══════════════════════════════════════════════════════════════════
//  Main workflow runner
// ══════════════════════════════════════════════════════════════════

/**
 * Runs the complete 7-stage scientific workflow for a tool.
 * Wraps the existing ComputeResult with validation, QC, uncertainty,
 * interpretation, and a detailed processing log.
 */
export function runToolWorkflow(
  toolId: number,
  baseResult: ComputeResult,
  inputs: Record<string, unknown>,
  validationRules: Array<{ param: string; min?: number; max?: number; unit?: string }>,
  dataSources: string[],
): WorkflowResult {
  const t0 = Date.now();
  const perTool = getPerToolWorkflow(toolId);
  const toolConfig = getToolConfig(toolId);
  const workflowLog: string[] = [];

  // Stage 1: Validation — use per-tool validator if available
  workflowLog.push('[1/7] Input Validation');
  let validation: ValidationResult;
  const ctx = { dataSources, lat: 0, lon: 0, fetchedParams: {} };
  if (perTool) {
    validation = perTool.validate(inputs, ctx);
  } else {
    validation = validateInputs(inputs, validationRules);
  }
  validation.errors.forEach((e) => workflowLog.push(`  ERROR: ${e}`));
  validation.warnings.forEach((w) => workflowLog.push(`  WARN: ${w}`));
  if (validation.valid) workflowLog.push('  All parameters within valid ranges.');

  // Stage 2: Preprocessing — use per-tool preprocessor
  workflowLog.push('[2/7] Preprocessing');
  let processedInputs = inputs;
  if (perTool) {
    processedInputs = perTool.preprocess(inputs, ctx, workflowLog);
  } else {
    toolConfig.preprocessingNotes.forEach((n) => workflowLog.push(`  ${n}`));
  }
  workflowLog.push(`  Data sources used: ${dataSources.length > 0 ? dataSources.join(', ') : 'user-provided only'}`);
  workflowLog.push(`  Visualization type: ${perTool?.vizType ?? toolConfig.visualizationType}`);

  // Stage 3: Computation
  workflowLog.push('[3/7] Scientific Computation');
  workflowLog.push(`  Equation #${toolId} computed. Result: ${Number.isFinite(baseResult.result) ? baseResult.result.toExponential(4) : 'NaN'} ${baseResult.unit || ''}`);
  baseResult.steps?.forEach((s) => workflowLog.push(`  ${s}`));

  // Stage 4: Post-processing & Classification
  workflowLog.push('[4/7] Post-processing & Classification');
  let classification: { label: string; color: string; description: string } | undefined;
  if (perTool) {
    const pp = perTool.postProcess(baseResult.result, baseResult, ctx, workflowLog);
    classification = pp.classification;
  } else {
    const template = {
      classificationBands: toolConfig.classificationBands,
      uncertainty: toolConfig.uncertainty,
      qcValidRange: toolConfig.qcValidRange,
      qcChecks: toolConfig.qcChecks,
      recommendations: toolConfig.recommendations,
      contextualAnalysis: toolConfig.contextualAnalysis,
    };
    classification = classifyResult(baseResult.result, template);
    if (classification) workflowLog.push(`  Classification: ${classification.label} — ${classification.description}`);
  }

  // Stage 5: Quality Control
  workflowLog.push('[5/7] Quality Control');
  let qualityControl: QualityControlResult;
  if (perTool) {
    qualityControl = perTool.qualityCheck(baseResult.result, ctx);
  } else {
    const template = {
      classificationBands: toolConfig.classificationBands,
      uncertainty: toolConfig.uncertainty,
      qcValidRange: toolConfig.qcValidRange,
      qcChecks: toolConfig.qcChecks,
      recommendations: toolConfig.recommendations,
      contextualAnalysis: toolConfig.contextualAnalysis,
    };
    qualityControl = runQualityControl(baseResult.result, template);
  }
  qualityControl.checks.forEach((c) => {
    workflowLog.push(`  ${c.passed ? 'PASS' : c.severity.toUpperCase()}: ${c.name} — ${c.message}`);
  });

  // Stage 6: Uncertainty
  workflowLog.push('[6/7] Uncertainty Estimation');
  let uncertainty: UncertaintyEstimate;
  if (perTool) {
    uncertainty = perTool.estimateUncertainty(baseResult.result, processedInputs, ctx);
  } else {
    const template = {
      classificationBands: toolConfig.classificationBands,
      uncertainty: toolConfig.uncertainty,
      qcValidRange: toolConfig.qcValidRange,
      qcChecks: toolConfig.qcChecks,
      recommendations: toolConfig.recommendations,
      contextualAnalysis: toolConfig.contextualAnalysis,
    };
    uncertainty = estimateUncertainty(baseResult.result, template);
  }
  workflowLog.push(`  Method: ${uncertainty.method}`);
  if (uncertainty.rmse !== undefined) workflowLog.push(`  RMSE: ${uncertainty.rmse} ${uncertainty.rmseUnit || ''}`);
  if (uncertainty.confidenceInterval) {
    workflowLog.push(`  ${(uncertainty.confidenceInterval.level * 100).toFixed(0)}% CI: [${uncertainty.confidenceInterval.lower.toFixed(4)}, ${uncertainty.confidenceInterval.upper.toFixed(4)}]`);
  }
  uncertainty.contributingFactors.forEach((f) => {
    workflowLog.push(`  Factor: ${f.factor} — ${f.contribution}`);
  });

  // Stage 7: Interpretation
  workflowLog.push('[7/7] Interpretation & Recommendations');
  let interpretation: InterpretationResult;
  if (perTool) {
    interpretation = perTool.interpret(baseResult.result, ctx);
    if (!interpretation.classification) interpretation.classification = classification;
  } else {
    const template = {
      classificationBands: toolConfig.classificationBands,
      uncertainty: toolConfig.uncertainty,
      qcValidRange: toolConfig.qcValidRange,
      qcChecks: toolConfig.qcChecks,
      recommendations: toolConfig.recommendations,
      contextualAnalysis: toolConfig.contextualAnalysis,
    };
    interpretation = interpretResult(baseResult.result, template);
  }
  workflowLog.push(`  Analysis: ${interpretation.contextualAnalysis}`);
  interpretation.recommendations.forEach((rec) => {
    workflowLog.push(`  Recommendation: ${rec}`);
  });

  // Add per-tool metadata to log
  if (perTool) {
    workflowLog.push('  --- Tool Metadata ---');
    workflowLog.push(`  Methodology: ${perTool.metadata.methodology}`);
    perTool.metadata.assumptions.forEach(a => workflowLog.push(`  Assumption: ${a}`));
    perTool.metadata.limitations.forEach(l => workflowLog.push(`  Limitation: ${l}`));
    perTool.metadata.references.forEach(r => workflowLog.push(`  Reference: ${r}`));
    if (perTool.dependencies && perTool.dependencies.length > 0) {
      workflowLog.push(`  Dependencies: ${perTool.dependencies.join(', ')}`);
    }
  }

  const qcErrors = qualityControl.checks.filter((c) => !c.passed && c.severity === 'error').length;
  const dataQualityScore = computeQualityScore(
    dataSources,
    validation.warnings.length,
    qcErrors,
  );
  workflowLog.push(`  Data Quality Score: ${(dataQualityScore * 100).toFixed(0)}%`);

  const processingTimeMs = Date.now() - t0;

  const result: WorkflowResult = {
    ...baseResult,
    validation,
    qualityControl,
    uncertainty,
    interpretation,
    workflowLog,
    dataQualityScore,
    processingTimeMs,
  };

  return result;
}
