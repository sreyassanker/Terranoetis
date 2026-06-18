import { type ScenarioBase, type EarthquakeSwarmParams, type HurricaneLandfallParams, type WildfireSpreadParams, type VolcanicEruptionParams, type FloodInundationParams, type TsunamiWaveParams } from './templates';

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  confidence: number;
}

export function validateScenario(scenario: Pick<ScenarioBase, 'type' | 'params' | 'pointCloud'>): ValidationResult {
  const issues: ValidationIssue[] = [];
  const params = scenario.params;

  switch (scenario.type) {
    case 'earthquake_swarm':
      validateEarthquakeSwarm(params as unknown as EarthquakeSwarmParams, issues);
      break;
    case 'hurricane_landfall':
      validateHurricaneLandfall(params as unknown as HurricaneLandfallParams, issues);
      break;
    case 'wildfire_spread':
      validateWildfireSpread(params as unknown as WildfireSpreadParams, issues);
      break;
    case 'volcanic_eruption':
      validateVolcanicEruption(params as unknown as VolcanicEruptionParams, issues);
      break;
    case 'flood_inundation':
      validateFloodInundation(params as unknown as FloodInundationParams, issues);
      break;
    case 'tsunami_wave':
      validateTsunamiWave(params as unknown as TsunamiWaveParams, issues);
      break;
  }

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const baseConfidence = 1 - (errors * 0.3 + warnings * 0.1);
  const confidence = Math.max(0, Math.min(1, baseConfidence - (1 - scenario.pointCloud.length / 2000) * 0.1));

  return { valid: errors === 0, issues, confidence };
}

function validateEarthquakeSwarm(p: EarthquakeSwarmParams, issues: ValidationIssue[]): void {
  if (Math.abs(p.lat) > 90) issues.push({ field: 'lat', message: 'Latitude out of range', severity: 'error' });
  if (p.depthRange[0] < 0) issues.push({ field: 'depthRange', message: 'Depth cannot be negative', severity: 'error' });
  if (p.magnitudeRange[0] < 1 || p.magnitudeRange[1] > 10) issues.push({ field: 'magnitudeRange', message: 'Magnitude range implausible', severity: 'warning' });
  if (p.depthRange[0] > p.depthRange[1]) issues.push({ field: 'depthRange', message: 'Min depth exceeds max depth', severity: 'error' });
  if (p.numEvents < 1 || p.numEvents > 10000) issues.push({ field: 'numEvents', message: 'Event count out of range', severity: 'warning' });
  if (p.magnitudeRange[1] > 6 && p.depthRange[1] < 10) issues.push({ field: 'magnitude', message: 'Large magnitude at shallow depth unlikely', severity: 'warning' });
}

function validateHurricaneLandfall(p: HurricaneLandfallParams, issues: ValidationIssue[]): void {
  if (p.category < 1 || p.category > 5) issues.push({ field: 'category', message: 'Category must be 1-5', severity: 'error' });
  if (p.pressure < 870 || p.pressure > 1020) issues.push({ field: 'pressure', message: 'Pressure outside plausible range', severity: 'error' });
  if (p.radius < 10 || p.radius > 300) issues.push({ field: 'radius', message: 'Radius outside plausible range', severity: 'warning' });
  if (p.forwardSpeed < 0 || p.forwardSpeed > 40) issues.push({ field: 'forwardSpeed', message: 'Forward speed implausible', severity: 'warning' });
  const expectedPressure = 1013 - p.category * 15;
  if (Math.abs(p.pressure - expectedPressure) > 40) issues.push({ field: 'pressure', message: 'Wind speed vs pressure mismatch', severity: 'warning' });
}

function validateWildfireSpread(p: WildfireSpreadParams, issues: ValidationIssue[]): void {
  if (p.windSpeed < 0 || p.windSpeed > 100) issues.push({ field: 'windSpeed', message: 'Wind speed implausible', severity: 'warning' });
  if (p.humidity < 0 || p.humidity > 100) issues.push({ field: 'humidity', message: 'Humidity out of range', severity: 'error' });
  if (p.area < 1) issues.push({ field: 'area', message: 'Area must be positive', severity: 'error' });
  const validFuels = ['grass', 'forest', 'shrub', 'urban'];
  if (!validFuels.includes(p.fuelType)) issues.push({ field: 'fuelType', message: 'Unknown fuel type', severity: 'error' });
  if (p.humidity > 50 && p.windSpeed > 30) issues.push({ field: 'humidity', message: 'High humidity with high wind is unlikely for fire spread', severity: 'warning' });
}

function validateVolcanicEruption(p: VolcanicEruptionParams, issues: ValidationIssue[]): void {
  if (p.vei < 0 || p.vei > 8) issues.push({ field: 'vei', message: 'VEI must be 0-8', severity: 'error' });
  if (p.ashHeight < 100 || p.ashHeight > 50000) issues.push({ field: 'ashHeight', message: 'Ash height outside plausible range', severity: 'warning' });
  const expectedHeight = [500, 3000, 5000, 10000, 15000, 20000, 25000, 35000, 45000][Math.min(p.vei, 8)] || 5000;
  if (Math.abs(p.ashHeight - expectedHeight) > expectedHeight * 0.8) issues.push({ field: 'ashHeight', message: 'VEI vs ash height mismatch', severity: 'warning' });
}

function validateFloodInundation(p: FloodInundationParams, issues: ValidationIssue[]): void {
  if (p.rainfall < 0 || p.rainfall > 2000) issues.push({ field: 'rainfall', message: 'Rainfall outside plausible range', severity: 'warning' });
  if (p.catchmentArea <= 0) issues.push({ field: 'catchmentArea', message: 'Catchment area must be positive', severity: 'error' });
  if (p.soilSaturation < 0 || p.soilSaturation > 1) issues.push({ field: 'soilSaturation', message: 'Soil saturation must be 0-1', severity: 'error' });
}

function validateTsunamiWave(p: TsunamiWaveParams, issues: ValidationIssue[]): void {
  if (p.magnitude < 6.5 || p.magnitude > 9.5) issues.push({ field: 'magnitude', message: 'Tsunami-generating quakes typically 6.5+', severity: 'warning' });
  if (p.waveHeight < 0.1 || p.waveHeight > 50) issues.push({ field: 'waveHeight', message: 'Wave height outside plausible range', severity: 'warning' });
  if (p.depth < 5 || p.depth > 100) issues.push({ field: 'depth', message: 'Depth outside typical tsunami range', severity: 'warning' });
  if (p.arrivalTimes.length < 2) issues.push({ field: 'arrivalTimes', message: 'At least 2 arrival times required', severity: 'error' });
}
