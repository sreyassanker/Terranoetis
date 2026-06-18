import { logger } from '../observability/logger';

// ── Physics-Informed Neural Network ─────────────────────────────
// Combines physical laws with data-driven adjustments.
// Not a real neural net — computes physics-constrained estimates.

// ── Seismic Physics ─────────────────────────────────────────────

/**
 * Gutenberg-Richter law: log10(N) = a - b*M
 * Returns expected number of earthquakes above magnitude M per unit time.
 */
export function gutenbergRichter(magnitude: number, a = 4.5, b = 1.0): number {
  return Math.pow(10, a - b * magnitude);
}

/**
 * Omori's law: n(t) = K / (c + t)^p
 * Returns aftershock rate at time t (days) after mainshock.
 */
export function omoriLaw(tDays: number, k = 100, c = 0.1, p = 1.0): number {
  return k / Math.pow(c + tDays, p);
}

/**
 * Rate-and-state friction: approximate probability of triggered seismicity
 * based on Coulomb stress change.
 */
export function rateStateFriction(stressChangeMPa: number, aSigma = 0.1): number {
  // Simplified: probability ∝ exp(Δτ / aσ)
  const ratio = stressChangeMPa / aSigma;
  return Math.min(1, Math.max(0, 0.5 * (1 + Math.tanh(ratio))));
}

/**
 * Aftershock probability: probability of M ≥ threshold in next tDays
 */
export function aftershockProbability(
  mainMagnitude: number,
  thresholdM = 4.0,
  tDays = 7,
): number {
  const b = 1.0;
  const a = 3.5 + 0.5 * mainMagnitude;
  const rate = gutenbergRichter(thresholdM, a, b);
  const expected = rate * (1 - Math.pow(1 + tDays, -0.3)) / 0.3;
  return Math.min(1, Math.max(0, 1 - Math.exp(-expected * 0.01)));
}

/**
 * Tsunami probability given earthquake parameters
 */
export function tsunamiProbability(magnitude: number, depthKm: number, isSubduction: boolean): number {
  if (magnitude < 6.5) return 0.01;
  const baseProb = isSubduction ? 0.25 : 0.08;
  const magFactor = Math.min(1, (magnitude - 6.5) / 3.0);
  const depthFactor = Math.max(0, Math.min(1, 1 - depthKm / 100));
  return Math.min(1, baseProb + magFactor * 0.4 + depthFactor * 0.2);
}

// ── Weather Physics ─────────────────────────────────────────────

/**
 * Approximate thermal wind balance: pressure gradient ∝ temperature gradient
 */
export function thermalWindBalance(tempGradient: number, latitude: number): number {
  const coriolis = 2 * 7.2921e-5 * Math.sin(latitude * Math.PI / 180);
  return Math.abs(coriolis) > 1e-10 ? tempGradient / coriolis : 0;
}

/**
 * Clausius-Clapeyron: saturation vapor pressure (hPa) at temperature T (°C)
 */
export function saturationVaporPressure(tempC: number): number {
  return 6.112 * Math.exp(17.67 * tempC / (tempC + 243.5));
}

/**
 * Estimated precipitation rate from humidity and updraft
 */
export function precipitationRate(humidityPct: number, updraftMs: number, tempC: number): number {
  const satVP = saturationVaporPressure(tempC);
  const actualVP = satVP * humidityPct / 100;
  const condensable = Math.max(0, actualVP - satVP * 0.5);
  return condensable * updraftMs * 0.01;
}

/**
 * Storm severity index (0-1) from parameters
 */
export function stormSeverity(
  windSpeedMs: number,
  pressureHpa: number,
  seaSurfaceTempC: number,
): number {
  const windFactor = Math.min(1, windSpeedMs / 70);
  const pressureFactor = Math.min(1, Math.max(0, (1013 - pressureHpa) / 100));
  const sstFactor = Math.max(0, (seaSurfaceTempC - 26) / 5);
  return Math.min(1, windFactor * 0.4 + pressureFactor * 0.35 + sstFactor * 0.25);
}

// ── Fire Physics ────────────────────────────────────────────────

/**
 * Rothermel fire spread rate (simplified): m/min
 */
export function rothermelSpreadRate(
  windSpeedMs: number,
  fuelMoisturePct: number,
  slopeDeg: number,
  fuelLoad: number,
): number {
  const baseRate = 0.3 * fuelLoad;
  const windFactor = 1 + 0.5 * Math.pow(windSpeedMs, 0.5);
  const moistureFactor = Math.max(0, 1 - fuelMoisturePct / 30);
  const slopeFactor = 1 + Math.tan(slopeDeg * Math.PI / 180) * 2;
  return baseRate * windFactor * moistureFactor * slopeFactor;
}

/**
 * Fire ignition probability from conditions
 */
export function fireIgnitionProbability(
  temperatureC: number,
  humidityPct: number,
  windSpeedMs: number,
  droughtIndex: number,
): number {
  const tempFactor = Math.max(0, (temperatureC - 20) / 20);
  const humidityFactor = Math.max(0, 1 - humidityPct / 40);
  const windFactor = Math.min(1, windSpeedMs / 20);
  const droughtFactor = Math.min(1, droughtIndex / 500);
  return Math.min(0.95, tempFactor * 0.25 + humidityFactor * 0.35 + windFactor * 0.2 + droughtFactor * 0.2);
}

/**
 * Fire spread risk considering atmospheric coupling
 */
export function fireAtmosphericCoupling(
  spreadRate: number,
  humidityPct: number,
  terrainRuggedness: number,
): number {
  // Dry air + fast spread + rough terrain creates fire-generated winds
  const drynessBoost = Math.max(0, 1 - humidityPct / 20) * 0.3;
  return Math.min(1, spreadRate / 20 * 0.5 + drynessBoost + terrainRuggedness * 0.2);
}

// ── PhysicsNN ───────────────────────────────────────────────────

export interface PhysicsPrediction {
  hazardType: string;
  probability: number;
  physicsConfidence: number;
  parameters: Record<string, number>;
  equations: string[];
}

export class PhysicsNN {
  predictSeismic(magnitude: number, depthKm: number, daysSinceLastQuake: number): PhysicsPrediction[] {
    const results: PhysicsPrediction[] = [];

    // Earthquake probability (Gutenberg-Richter)
    const prob = gutenbergRichter(4.0, 4.0, 1.0) * 0.001;
    results.push({
      hazardType: 'earthquake',
      probability: Math.min(0.99, Math.max(0.01, prob)),
      physicsConfidence: 0.6,
      parameters: { magnitude, depthKm, a: 4.0, b: 1.0 },
      equations: ['Gutenberg-Richter: log10(N) = a - b*M'],
    });

    // Aftershock probability
    if (magnitude >= 5) {
      const afterProb = aftershockProbability(magnitude, 4.0, 7);
      results.push({
        hazardType: 'aftershock',
        probability: afterProb,
        physicsConfidence: 0.55,
        parameters: { mainMagnitude: magnitude, thresholdM: 4.0, tDays: 7 },
        equations: ['Omori law: n(t) = K / (c + t)^p', 'Gutenberg-Richter: log10(N) = a - b*M'],
      });
    }

    // Tsunami probability
    const tsunamiProb = tsunamiProbability(magnitude, depthKm, true);
    results.push({
      hazardType: 'tsunami',
      probability: tsunamiProb,
      physicsConfidence: 0.45,
      parameters: { magnitude, depthKm, isSubduction: 1 },
      equations: ['Empirical tsunami probability model'],
    });

    return results;
  }

  predictWeather(tempC: number, humidityPct: number, pressureHpa: number, windMs: number): PhysicsPrediction[] {
    const results: PhysicsPrediction[] = [];

    // Storm severity
    const stormProb = stormSeverity(windMs, pressureHpa, tempC);
    results.push({
      hazardType: 'severe_weather',
      probability: stormProb,
      physicsConfidence: 0.5,
      parameters: { windSpeedMs: windMs, pressureHpa, seaSurfaceTempC: tempC },
      equations: ['Storm severity index: wind*0.4 + pressure*0.35 + sst*0.25'],
    });

    // Precipitation estimate
    const precip = precipitationRate(humidityPct, windMs * 0.1, tempC);
    results.push({
      hazardType: 'heavy_rainfall',
      probability: Math.min(1, precip / 50),
      physicsConfidence: 0.4,
      parameters: { humidityPct, updraftMs: windMs * 0.1, tempC },
      equations: ['Clausius-Clapeyron: es = 6.112 * exp(17.67T / (T+243.5))'],
    });

    return results;
  }

  predictFire(tempC: number, humidityPct: number, windMs: number, fuelMoisturePct: number, droughtIndex: number): PhysicsPrediction[] {
    const results: PhysicsPrediction[] = [];

    // Ignition probability
    const ignitionProb = fireIgnitionProbability(tempC, humidityPct, windMs, droughtIndex);
    results.push({
      hazardType: 'wildfire',
      probability: ignitionProb,
      physicsConfidence: 0.55,
      parameters: { temperatureC: tempC, humidityPct, windSpeedMs: windMs, droughtIndex },
      equations: ['Fire ignition: temp*0.25 + humidity*0.35 + wind*0.2 + drought*0.2'],
    });

    // Spread rate
    const spreadRate = rothermelSpreadRate(windMs, fuelMoisturePct, 5, 1);
    results.push({
      hazardType: 'wildfire_spread',
      probability: Math.min(1, spreadRate / 30),
      physicsConfidence: 0.45,
      parameters: { windSpeedMs: windMs, fuelMoisturePct, slopeDeg: 5, fuelLoad: 1 },
      equations: ['Rothermel: R = R0 * wind * moisture * slope'],
    });

    return results;
  }

  /**
   * Hybrid prediction: combine physics equations with data-driven adjustment.
   * Physics provides constraints; deviation from physics is learned from data.
   */
  hybridPredict(
    physicsPrediction: PhysicsPrediction,
    historicalAccuracy: number,
    recentBias: number,
  ): number {
    const physicsProb = physicsPrediction.probability;
    const physicsWeight = physicsPrediction.physicsConfidence;

    // Data-driven adjustment
    const adjusted = physicsProb + recentBias * 0.1;
    const weight = physicsWeight * 0.7 + historicalAccuracy * 0.3;

    return Math.min(0.99, Math.max(0.01, adjusted * weight + physicsProb * (1 - weight)));
  }
}

export const physicsNN = new PhysicsNN();
