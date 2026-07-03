import type { ScenarioParams, ScenarioTimeSeries, TimeStep, ShapeData, Point3D } from '../templates';
import { SeededRNG, scenarioSeed } from './rng';

const KM_TO_DEG = 1 / 111;

function geoToSphere(lat: number, lon: number, height: number): Point3D {
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const r = 1 - height * 0.0000001;
  return {
    x: r * Math.cos(latRad) * Math.cos(lonRad),
    y: r * Math.cos(latRad) * Math.sin(lonRad),
    z: r * Math.sin(latRad),
  };
}

function manningQ(rainfall: number, area: number, saturation: number, slope: number, roughness: number): number {
  const runoffCoeff = 0.3 + saturation * 0.5;
  const Q = runoffCoeff * rainfall * (area / 1000);
  const slopeBoost = 1 + slope * 0.5;
  const roughnessPenalty = 1 / (1 + roughness * 0.3);
  return Q * slopeBoost * roughnessPenalty;
}

function hydrograph(tNorm: number, tp: number): number {
  if (tNorm <= 0) return 0;
  const alpha = 3.0;
  const beta = 3.0;
  const tRatio = tNorm / tp;
  return Math.pow(tRatio, alpha) * Math.exp(-beta * (tRatio - 1));
}

export function simulateFlood(params: ScenarioParams): ScenarioTimeSeries {
  const p = params as { lat: number; lon: number; rainfall: number; catchmentArea: number; soilSaturation: number; duration: number };
  const rng = new SeededRNG(scenarioSeed('flood_inundation', p));
  const steps: TimeStep[] = [];
  const durationH = p.duration;
  const dt = Math.max(0.25, durationH / 60);
  const slope = 0.02;
  const roughness = 0.035;
  const peakQ = manningQ(p.rainfall, p.catchmentArea, p.soilSaturation, slope, roughness);
  const channelWidth = 20 + Math.sqrt(p.catchmentArea) * 0.5;
  const maxFloodExtentKm = Math.sqrt(p.catchmentArea / Math.PI) * 0.8;
  const waveCelerity = 2.5 + peakQ * 0.002;
  const tp = durationH * 0.3;
  const numGridPoints = Math.min(Math.floor(p.catchmentArea / 30), 1200);

  for (let t = 0; t <= durationH; t += dt) {
    const tNorm = t;
    const q = peakQ * hydrograph(tNorm, tp);
    const waterLevel = q * 0.01;
    const floodRadiusKm = Math.min(maxFloodExtentKm, waveCelerity * t * 0.15);
    const floodRadiusDeg = floodRadiusKm * KM_TO_DEG;
    const points: Point3D[] = [];
    const intensities: number[] = [];
    const shapes: ShapeData[] = [];

    if (q > peakQ * 0.01) {
      // Generate flood grid points with depth data
      const floodPoints: { lat: number; lon: number; depth: number }[] = [];
      for (let i = 0; i < numGridPoints; i++) {
        const frac = i / numGridPoints;
        const r = floodRadiusDeg * Math.sqrt(frac);
        const angle = (rng.next() - 0.5) * Math.PI * 0.8;
        const lat = p.lat + r * Math.cos(angle) * 0.7;
        const lon = p.lon + r * Math.sin(angle);
        const depth = waterLevel * (1 - frac * 0.6);
        floodPoints.push({ lat, lon, depth });
        points.push(geoToSphere(lat, lon, depth * 5));
        intensities.push(depth);
      }

      // Create flood surface polygon with depth data for realistic water rendering
      const floodEdge: { lat: number; lon: number }[] = [];
      const edgeDepths: number[] = [];
      const edgePoints = 48;
      for (let i = 0; i <= edgePoints; i++) {
        const a = (i / edgePoints) * 2 * Math.PI;
        const r = floodRadiusDeg * (1 + 0.15 * Math.sin(a * 3));
        const lat = p.lat + r * Math.cos(a) * 0.7;
        const lon = p.lon + r * Math.sin(a);
        floodEdge.push({ lat, lon });
        // Depth decreases toward edges (Priority-Flood logic)
        const distFromCenter = r / floodRadiusDeg;
        edgeDepths.push(waterLevel * (1 - distFromCenter * 0.8));
      }
      shapes.push({
        type: 'flood_surface',
        color: '#3b82f6',
        opacity: 0.6,
        positions: floodEdge,
        depths: edgeDepths,
        maxDepth: waterLevel,
        // Client-side terrain sampling (sampleTerrainMostDetailed) handles base elevation
        waterElevation: 0,
      });

      const riverLenDeg = floodRadiusKm * 1.5 * KM_TO_DEG;
      const riverPos: { lat: number; lon: number }[] = [];
      for (let i = 0; i <= 20; i++) {
        const frac = i / 20;
        riverPos.push({
          lat: p.lat - riverLenDeg * 0.5 + riverLenDeg * frac,
          lon: p.lon + Math.sin(frac * Math.PI * 2) * 0.01,
        });
      }
      shapes.push({
        type: 'corridor',
        color: '#1d4ed8',
        opacity: 0.5,
        positions: riverPos,
        width: channelWidth * (1 + q / peakQ),
      });

      if (q > peakQ * 0.5) {
        const frontDistDeg = floodRadiusDeg * 0.9;
        const frontPos: { lat: number; lon: number }[] = [];
        for (let i = 0; i <= 32; i++) {
          const a = -Math.PI * 0.4 + (i / 32) * Math.PI * 0.8;
          frontPos.push({
            lat: p.lat + frontDistDeg * Math.cos(a) * 0.7,
            lon: p.lon + frontDistDeg * Math.sin(a),
          });
        }
        shapes.push({
          type: 'polyline',
          color: '#60a5fa',
          opacity: 0.7,
          positions: frontPos,
          width: 2.5,
        });
      }
    }

    const qStr = q.toFixed(0);
    const depthStr = waterLevel.toFixed(2);
    const label = `t=${t.toFixed(1)}h — Q=${qStr} m³/s — depth ${depthStr}m — extent ${floodRadiusKm.toFixed(1)}km`;
    steps.push({ time: t * 3600, points, shapes, intensity: intensities, label });
  }

  return {
    steps,
    metadata: { duration: durationH * 3600, dt: dt * 3600, type: 'flood_inundation', params: p as Record<string, unknown> },
  };
}
