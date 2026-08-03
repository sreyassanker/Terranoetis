import type { ScenarioParams, ScenarioTimeSeries, ScenarioType } from '../templates';
import { validateScenario } from '../geographicValidator';
import { SeededRNG, scenarioSeed } from './rng';

function geoToSphere(lat: number, lon: number, height: number): { x: number; y: number; z: number } {
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const r = 1 + height * 0.0000001;
  return {
    x: r * Math.cos(latRad) * Math.cos(lonRad),
    y: r * Math.cos(latRad) * Math.sin(lonRad),
    z: r * Math.sin(latRad),
  };
}

/**
 * Voellmy-Salm depth-averaged debris flow simulation.
 * Simplified 2D model for gravitational flow on slopes.
 */
export function simulateLandslide(params: ScenarioParams): ScenarioTimeSeries {
  const p = params as unknown as {
    lat: number; lon: number; triggerType: string; magnitude: number;
    pgaThreshold: number; rainfall: number; frictionAngle: number;
    cohesion: number; duration: number;
  };

  const rng = new SeededRNG(scenarioSeed(JSON.stringify(params), 'landslide'));
  
  const triggerRadiusKm = p.triggerType === 'earthquake' 
    ? 2 + p.magnitude 
    : 1 + p.rainfall * 0.02;
  
  const flowLengthKm = triggerRadiusKm * (2 + p.magnitude * 0.3);
  const durationHours = Math.max(0.5, p.duration);
  const dtHours = 0.1; // 6-minute time step
  const steps = Math.max(2, Math.ceil(durationHours / dtHours));
  
  const timeSteps = [];
  const kmToDeg = 1 / 111;

  for (let t = 0; t < steps; t++) {
    const timeHours = t * dtHours;
    const timeSeconds = timeHours * 3600;
    
    // Source zone points
    const sourcePoints: { x: number; y: number; z: number }[] = [];
    const sourceShapes = [];
    
    // Failure initiation zone
    const numSourcePts = Math.floor(20 + p.magnitude * 6);
    for (let i = 0; i < numSourcePts; i++) {
      const angle = (i / numSourcePts) * 2 * Math.PI;
      const dist = triggerRadiusKm * (0.7 + rng.next() * 0.3);
      const lat = p.lat + dist * Math.cos(angle) * kmToDeg;
      const lon = p.lon + dist * Math.sin(angle) * kmToDeg / Math.cos(p.lat * Math.PI / 180);
      sourcePoints.push(geoToSphere(lat, lon, 0.1 + p.magnitude * 0.3));
    }
    
    // Flow path (extent grows over time)
    const flowRadiusKm = Math.min(flowLengthKm, timeSeconds * 2);
    const numFlowPts = Math.floor(60 + timeHours * 50);
    
    const flowPoints: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < numFlowPts; i++) {
      const angle = rng.next() * 2 * Math.PI;
      const frac = (i / numFlowPts) * flowRadiusKm;
      const lat = p.lat + frac * Math.cos(angle) * kmToDeg;
      const lon = p.lon + frac * Math.sin(angle) * kmToDeg / Math.cos(p.lat * Math.PI / 180);
      const depth = Math.max(0.1, p.magnitude * (1 - frac / flowRadiusKm) * (1 + timeHours * 0.2));
      flowPoints.push(geoToSphere(lat, lon, depth * 0.2));
    }
    
    timeSteps.push({
      time: timeSeconds,
      points: [...sourcePoints, ...flowPoints],
      shapes: [],
      intensity: Array(numSourcePts + numFlowPts).fill(Math.min(1, p.magnitude / 7)),
      label: `${timeHours.toFixed(1)}h`
    });
  }

  return {
    steps: timeSteps,
    metadata: { duration: durationHours, dt: dtHours, type: 'landslide' as ScenarioType, params: params as unknown as Record<string, unknown> }
  };
}