import type { ScenarioParams, ScenarioTimeSeries, TimeStep, ShapeData, Point3D } from '../templates';

const G = 9.81;

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

function shallowWaterSpeed(depthM: number): number {
  return Math.sqrt(G * Math.max(1, depthM));
}

function isLikelyOcean(lat: number, lon: number): boolean {
  if (lat < -70 || lat > 80) return true;
  if (lon >= 100 && lon <= 180 && lat >= -60 && lat <= 20) return true;
  if (lon >= -180 && lon <= -100 && lat >= -60 && lat <= 0) return true;
  if (lon >= 120 && lon <= 180 && lat >= 20 && lat <= 65) return true;
  if (lon >= -180 && lon <= -60 && lat >= 20 && lat <= 65) return true;
  if (lon >= -80 && lon <= -10 && lat >= -60 && lat <= 0) return true;
  if (lon >= 20 && lon <= 120 && lat >= -50 && lat <= 25) return true;
  if (lon >= 95 && lon <= 155 && lat >= -10 && lat <= 25) return true;
  if (lon >= 155 && lon <= 180 && lat >= -50 && lat <= -10) return true;
  if (lon >= -180 && lon <= -155 && lat >= -50 && lat <= -10) return true;
  if (lon >= 140 && lon <= 180 && lat >= 65 && lat <= 80) return true;
  if (lon >= -180 && lon <= 180 && lat >= 80) return true;
  return false;
}

export function simulateTsunami(params: ScenarioParams): ScenarioTimeSeries {
  const p = params as { epicenterLat: number; epicenterLon: number; magnitude: number; depth: number; waveHeight: number; arrivalTimes: number[] };
  const steps: TimeStep[] = [];
  const oceanDepth = p.depth * 1000;
  const c = shallowWaterSpeed(oceanDepth);
  const cKmh = c * 3.6;
  const totalDurationH = Math.max(3, p.arrivalTimes[p.arrivalTimes.length - 1] * 1.5);
  const dt = Math.max(0.5, totalDurationH / 60);
  const numRings = Math.min(p.arrivalTimes.length + 2, 8);
  const maxRadiusKm = cKmh * totalDurationH / 60;

  for (let t = 0; t <= totalDurationH; t += dt) {
    const points: Point3D[] = [];
    const intensities: number[] = [];
    const shapes: ShapeData[] = [];
    const tMin = t;

    for (let ring = 0; ring < numRings; ring++) {
      const arrivalMin = p.arrivalTimes[ring] || (ring + 1) * 15;
      if (tMin < arrivalMin) continue;

      const elapsedMin = tMin - arrivalMin;
      const waveRadiusKm = elapsedMin * cKmh / 60;
      if (waveRadiusKm > maxRadiusKm * 1.2) continue;

      const waveAmplitude = p.waveHeight * Math.exp(-waveRadiusKm * 0.003) * Math.exp(-elapsedMin * 0.01);
      const numWavePts = 48;
      for (let i = 0; i < numWavePts; i++) {
        const angle = (i / numWavePts) * 2 * Math.PI;
        const rJitter = 1 + 0.05 * Math.sin(angle * 5 + ring);
        const lat = p.epicenterLat + waveRadiusKm * rJitter * Math.cos(angle) / 111;
        const lon = p.epicenterLon + waveRadiusKm * rJitter * Math.sin(angle) / (111 * Math.cos(p.epicenterLat * Math.PI / 180));
        if (!isLikelyOcean(lat, lon)) continue;
        points.push(geoToSphere(lat, lon, waveAmplitude * 5));
        intensities.push(waveAmplitude / p.waveHeight);
      }

      if (waveRadiusKm > 1 && waveRadiusKm < maxRadiusKm) {
        const ringPositions: { lat: number; lon: number }[] = [];
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * 2 * Math.PI;
          const lat = p.epicenterLat + waveRadiusKm * Math.cos(a) / 111;
          const lon = p.epicenterLon + waveRadiusKm * Math.sin(a) / (111 * Math.cos(p.epicenterLat * Math.PI / 180));
          if (isLikelyOcean(lat, lon)) {
            ringPositions.push({ lat, lon });
          }
        }
        if (ringPositions.length >= 4) {
          const opacity = Math.max(0.1, 0.6 - waveRadiusKm / maxRadiusKm * 0.5);
          shapes.push({
            type: 'ring',
            color: ring === 0 ? '#06b6d4' : ring < 3 ? '#0ea5e9' : '#38bdf8',
            opacity,
            center: { lat: p.epicenterLat, lon: p.epicenterLon },
            radius: waveRadiusKm,
            width: ring === 0 ? 3 : 1.5,
          });
        }
      }
    }

    shapes.push({
      type: 'cylinder',
      color: '#ef4444',
      opacity: 0.7,
      center: { lat: p.epicenterLat, lon: p.epicenterLon },
      radius: 2000,
      height: 3000,
    });

    // Coastal inundation flood surface — rendered as 3D water polygon
    // Elongated in the directivity direction (perpendicular to fault)
    if (tMin > 0) {
      const inundEdge: { lat: number; lon: number }[] = [];
      const inundDepths: number[] = [];
      const numInundPts = 36;
      const inlandKm = 2 + p.waveHeight * 0.3;
      for (let i = 0; i < numInundPts; i++) {
        const a = (i / numInundPts) * 2 * Math.PI;
        // Directivity: elongate in the direction perpendicular to fault
        // Use cos^2 weighting to create an elliptical shape biased toward directivity
        const directivityFactor = 0.5 + 0.5 * Math.pow(Math.cos(a), 2);
        const shoreR = (5 + inlandKm * directivityFactor) / 111;
        const lat = p.epicenterLat + shoreR * Math.cos(a);
        const lon = p.epicenterLon + shoreR * Math.sin(a) / Math.cos(p.epicenterLat * Math.PI / 180);
        inundEdge.push({ lat, lon });
        const depthFactor = directivityFactor * Math.exp(-tMin * 0.05);
        inundDepths.push(p.waveHeight * Math.max(0.1, depthFactor));
      }
      if (inundEdge.length >= 3) {
        shapes.push({
          type: 'flood_surface',
          color: '#06b6d4',
          opacity: 0.5,
          positions: inundEdge,
          depths: inundDepths,
          maxDepth: p.waveHeight,
          // Client-side terrain sampling handles base coastal elevation
          waterElevation: 0,
        });
      }
    }

    const latestWave = points.length > 0 ? ` — wave ${p.waveHeight.toFixed(1)}m` : '';
    const label = `t=${t.toFixed(1)}h — ${points.length} wave points${latestWave} — c=${cKmh.toFixed(0)} km/h`;
    steps.push({ time: t * 3600, points, shapes, intensity: intensities, label });
  }

  return {
    steps,
    metadata: { duration: totalDurationH * 3600, dt: dt * 3600, type: 'tsunami_wave', params: p as Record<string, unknown> },
  };
}
