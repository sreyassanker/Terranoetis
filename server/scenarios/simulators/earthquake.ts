import type { ScenarioParams, ScenarioTimeSeries, TimeStep, ShapeData, Point3D } from '../templates';
import { SeededRNG, scenarioSeed } from './rng';

function geoToSphere(lat: number, lon: number, depth: number): Point3D {
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const r = 1 - depth * 0.0001;
  return {
    x: r * Math.cos(latRad) * Math.cos(lonRad),
    y: r * Math.cos(latRad) * Math.sin(lonRad),
    z: r * Math.sin(latRad),
  };
}

function gutenbergRichter(mMin: number, mMax: number, rng: SeededRNG, b = 1.0): number {
  const u = rng.next();
  return mMin - (1 / b) * Math.log10(1 - u * (1 - 10 ** (-b * (mMax - mMin))));
}

function omoriTime(index: number, total: number, windowHours: number, decayModel: string, rng: SeededRNG): number {
  const u = rng.next();
  if (decayModel === 'omori') {
    const c = 0.1;
    const p = 0.95;
    return windowHours * (Math.pow(c + u * (Math.pow(c + windowHours, 1 - p) - c), 1 / (1 - p)) - c);
  }
  if (decayModel === 'exponential') {
    const lambda = 0.05;
    return -Math.log(1 - u * (1 - Math.exp(-lambda * windowHours))) / lambda;
  }
  return u * windowHours;
}

function magToDepth(mag: number, dMin: number, dMax: number, mMax: number): number {
  return dMin + (dMax - dMin) * (1 - mag / mMax);
}

/** Wave speeds in km/s — based on real crustal velocity models */
function pWaveSpeed(depthKm: number): number { return 5.8 + 0.04 * depthKm; }
function sWaveSpeed(depthKm: number): number { return 3.5 + 0.02 * depthKm; }
function rayleighSpeed(depthKm: number): number { return 3.0 + 0.015 * depthKm; }
function loveSpeed(depthKm: number): number { return 3.2 + 0.018 * depthKm; }

/** Ground Motion Prediction Equation (simplified Boore-Atkinson 2008) */
function computePGA(mag: number, distanceKm: number, depthKm: number): number {
  const r = Math.sqrt(distanceKm * distanceKm + depthKm * depthKm);
  if (r < 1) return mag * 0.5;
  return Math.pow(10, 0.3 * mag - 1.5 * Math.log10(r) - 0.002 * r + 0.2);
}

/** MMI intensity from PGA (Modified Mercalli, Worden et al. 2012) */
function pgaToMMI(pga: number): number {
  if (pga < 0.0017) return 1;
  if (pga < 0.014) return 2;
  if (pga < 0.039) return 3;
  if (pga < 0.092) return 4;
  if (pga < 0.18) return 5;
  if (pga < 0.34) return 6;
  if (pga < 0.65) return 7;
  if (pga < 1.25) return 8;
  if (pga < 2.5) return 9;
  if (pga < 5.0) return 10;
  return 11;
}

/** USGS ShakeMap MMI color palette */
function mmiToColor(mmi: number): string {
  if (mmi <= 2) return '#ccffcc';
  if (mmi <= 3) return '#99ff99';
  if (mmi <= 4) return '#ffff00';
  if (mmi <= 5) return '#ffcc00';
  if (mmi <= 6) return '#ff9900';
  if (mmi <= 7) return '#ff6600';
  if (mmi <= 8) return '#ff3300';
  if (mmi <= 9) return '#cc0000';
  if (mmi <= 10) return '#990000';
  return '#660000';
}

/** Building damage probability from MMI (Fragility curve approximation) */
function mmiToDamage(mmi: number): number {
  if (mmi <= 4) return 0;
  if (mmi <= 5) return 5;
  if (mmi <= 6) return 15;
  if (mmi <= 7) return 35;
  if (mmi <= 8) return 60;
  if (mmi <= 9) return 80;
  if (mmi <= 10) return 95;
  return 100;
}

/** Liquefaction susceptibility from MMI + simplified soil model */
function mmiToLiquefaction(mmi: number, rng: SeededRNG): number {
  if (mmi <= 5) return 0;
  const baseProb = (mmi - 5) * 0.15;
  return Math.min(1, baseProb * (0.7 + rng.next() * 0.6));
}

/** Generate polygon points for MMI intensity zone around epicenter */
function mmiZonePolygon(
  lat: number, lon: number, mmiRadiusKm: number, rng: SeededRNG,
): { lat: number; lon: number }[] {
  const kmToDeg = 1 / 111;
  const points: { lat: number; lon: number }[] = [];
  const numPoints = 16;
  for (let i = 0; i <= numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    const jitter = 1 + (rng.next() - 0.5) * 0.15;
    const r = mmiRadiusKm * jitter * kmToDeg;
    points.push({
      lat: lat + r * Math.cos(angle),
      lon: lon + r * Math.sin(angle) / Math.cos(lat * Math.PI / 180),
    });
  }
  return points;
}

function faultPlanePolygon(
  lat: number, lon: number, depth: number,
  strike: number, dip: number, lengthKm: number, widthKm: number,
): { lat: number; lon: number }[] {
  const strikeRad = strike * Math.PI / 180;
  const dipRad = dip * Math.PI / 180;
  const corners: { lat: number; lon: number }[] = [];
  const halfLen = lengthKm / 2;
  const halfWid = widthKm / 2;
  const kmToDeg = 1 / 111;
  for (const dx of [-halfLen, halfLen]) {
    for (const dy of [-halfWid, halfWid]) {
      const along = dx;
      const down = dy * Math.cos(dipRad);
      const dLat = (along * Math.cos(strikeRad) + down * Math.sin(strikeRad)) * kmToDeg;
      const dLon = (-along * Math.sin(strikeRad) + down * Math.cos(strikeRad)) * kmToDeg / Math.cos(lat * Math.PI / 180);
      corners.push({ lat: lat + dLat, lon: lon + dLon });
    }
  }
  return [corners[0], corners[1], corners[3], corners[2], corners[0]];
}

export function simulateEarthquake(params: ScenarioParams): ScenarioTimeSeries {
  const p = params as { lat: number; lon: number; depthRange: [number, number]; magnitudeRange: [number, number]; numEvents: number; timeWindow: number; decayModel: string };
  const rng = new SeededRNG(scenarioSeed('earthquake_swarm', p));
  const steps: TimeStep[] = [];
  const dt = Math.max(1, p.timeWindow / 60);
  const [dMin, dMax] = p.depthRange;
  const [mMin, mMax] = p.magnitudeRange;

  const strike = 225 + (rng.next() - 0.5) * 60;
  const dip = 30 + rng.next() * 30;
  const faultLength = Math.max(5, 10 * Math.pow(10, 0.5 * (mMax - 4)));
  const faultWidth = faultLength * 0.5;

  const mainMag = mMax - 0.3;
  const mainDepth = magToDepth(mainMag, dMin, dMax, mMax);
  const mainTime = 0;
  const mainPoint = geoToSphere(p.lat, p.lon, mainDepth);
  const mainShape: ShapeData = {
    type: 'polygon',
    color: '#ef4444',
    opacity: 0.25,
    positions: faultPlanePolygon(p.lat, p.lon, mainDepth, strike, dip, faultLength, faultWidth),
    extrudedHeight: 2000,
  };

  // Build event list
  const events: Array<{ time: number; lat: number; lon: number; depth: number; mag: number; point: Point3D }> = [];
  events.push({ time: mainTime, lat: p.lat, lon: p.lon, depth: mainDepth, mag: mainMag, point: mainPoint });

  const numAftershocks = Math.max(0, p.numEvents - 1);
  const aftershockTimes: number[] = [];
  for (let i = 0; i < numAftershocks; i++) {
    aftershockTimes.push(omoriTime(i, numAftershocks, p.timeWindow, p.decayModel, rng));
  }
  aftershockTimes.sort((a, b) => a - b);

  for (const t of aftershockTimes) {
    const mag = gutenbergRichter(mMin, Math.min(mMax - 1.2, mainMag), rng, 1.0);
    const depth = magToDepth(mag, dMin, dMax, mMax);
    const offsetKm = mag * 2 + rng.next() * faultLength * 0.3;
    const angle = rng.next() * 2 * Math.PI;
    const kmToDeg = 1 / 111;
    const lat = p.lat + offsetKm * Math.cos(angle) * kmToDeg;
    const lon = p.lon + offsetKm * Math.sin(angle) * Math.cos(p.lat * Math.PI / 180) * kmToDeg;
    const point = geoToSphere(lat, lon, depth);
    events.push({ time: t, lat, lon, depth, mag, point });
  }
  events.sort((a, b) => a.time - b.time);

  // Time steps
  const stepIndices: number[] = [];
  for (let t = 0; t <= p.timeWindow; t += dt) {
    stepIndices.push(t);
  }
  if (stepIndices[stepIndices.length - 1] < p.timeWindow) {
    stepIndices.push(p.timeWindow);
  }

  const avgDepth = (dMin + dMax) / 2;
  const pSpeed = pWaveSpeed(avgDepth);
  const sSpeed = sWaveSpeed(avgDepth);
  const rSpeed = rayleighSpeed(avgDepth);
  const lSpeed = loveSpeed(avgDepth);

  for (const stepTime of stepIndices) {
    const visibleEvents = events.filter(e => e.time <= stepTime);
    const points: Point3D[] = visibleEvents.map(e => e.point);
    const intensities: number[] = visibleEvents.map(e => e.mag);
    const shapes: ShapeData[] = [];

    // Fault plane (always visible)
    shapes.push(mainShape);

    for (const evt of visibleEvents) {
      const elapsed = stepTime - evt.time;
      if (elapsed <= 0) continue;
      const elapsedHours = elapsed;
      const elapsedSec = elapsed * 3600;

      // ─── 1. P-Wave (compressional, blue) ───────────────────
      const pRadius = elapsedSec * pSpeed;
      if (pRadius > 0 && pRadius < 800) {
        shapes.push({
          type: 'ring',
          color: '#60a5fa',
          opacity: Math.max(0.03, 0.25 - elapsedHours * 0.003),
          center: { lat: evt.lat, lon: evt.lon },
          radius: pRadius,
          waveType: 'P',
          waveSpeed: pSpeed,
          startTime: evt.time,
          epicenter: { lat: evt.lat, lon: evt.lon },
          magnitude: evt.mag,
        });
      }

      // ─── 2. S-Wave (shear, orange) ────────────────────────
      const sRadius = elapsedSec * sSpeed;
      if (sRadius > 0 && sRadius < 600) {
        shapes.push({
          type: 'ring',
          color: '#f97316',
          opacity: Math.max(0.03, 0.22 - elapsedHours * 0.003),
          center: { lat: evt.lat, lon: evt.lon },
          radius: sRadius,
          waveType: 'S',
          waveSpeed: sSpeed,
          startTime: evt.time,
          epicenter: { lat: evt.lat, lon: evt.lon },
          magnitude: evt.mag,
        });
      }

      // ─── 3. Rayleigh Wave (surface, purple, slower) ────────
      const rayleighRadius = elapsedSec * rSpeed;
      if (rayleighRadius > 0 && rayleighRadius < 500) {
        shapes.push({
          type: 'ring',
          color: '#a855f7',
          opacity: Math.max(0.02, 0.18 - elapsedHours * 0.004),
          center: { lat: evt.lat, lon: evt.lon },
          radius: rayleighRadius,
          waveType: 'Rayleigh',
          waveSpeed: rSpeed,
          startTime: evt.time,
          epicenter: { lat: evt.lat, lon: evt.lon },
          magnitude: evt.mag,
        });
      }

      // ─── 4. Love Wave (surface, green, slowest) ────────────
      const loveRadius = elapsedSec * lSpeed * 0.9;
      if (loveRadius > 0 && loveRadius < 450) {
        shapes.push({
          type: 'ring',
          color: '#22c55e',
          opacity: Math.max(0.02, 0.15 - elapsedHours * 0.003),
          center: { lat: evt.lat, lon: evt.lon },
          radius: loveRadius,
          waveType: 'Love',
          waveSpeed: lSpeed,
          startTime: evt.time,
          epicenter: { lat: evt.lat, lon: evt.lon },
          magnitude: evt.mag,
        });
      }

      // ─── 5. MMI Intensity Zones (ShakeMap colors) ──────────
      if (evt.mag >= 4.0 && elapsedHours < p.timeWindow * 0.3) {
        const pga = computePGA(evt.mag, 0, evt.depth);
        const maxMMI = pgaToMMI(pga);
        // Generate concentric intensity zones
        for (let mmi = Math.min(maxMMI, 10); mmi >= 4; mmi -= 1) {
          const intensityKm = Math.pow(10, (0.3 * evt.mag - (mmi - 1) * 0.3 - 0.002) / 1.5);
          if (intensityKm < 1000) {
            shapes.push({
              type: 'intensity_zone',
              color: mmiToColor(mmi),
              opacity: 0.12 + (mmi / 10) * 0.08,
              center: { lat: evt.lat, lon: evt.lon },
              radius: intensityKm,
              mmi,
              positions: mmiZonePolygon(evt.lat, evt.lon, intensityKm, rng),
            });
          }
        }
      }

      // ─── 6. Building Damage Zones ─────────────────────────
      if (evt.mag >= 5.0 && elapsedHours < p.timeWindow * 0.25) {
        const pga0 = computePGA(evt.mag, 0, evt.depth);
        const maxMMI = pgaToMMI(pga0);
        if (maxMMI >= 6) {
          const damageKm = Math.pow(10, (0.3 * evt.mag - 1.0) / 1.5);
          shapes.push({
            type: 'damage_zone',
            color: '#dc2626',
            opacity: 0.15,
            center: { lat: evt.lat, lon: evt.lon },
            radius: Math.min(damageKm, 300),
            damagePercent: mmiToDamage(maxMMI),
            positions: mmiZonePolygon(evt.lat, evt.lon, Math.min(damageKm, 300), rng),
          });
        }
      }

      // ─── 7. Liquefaction Zones ────────────────────────────
      if (evt.mag >= 5.5 && elapsedHours < p.timeWindow * 0.2) {
        const pga0 = computePGA(evt.mag, 0, evt.depth);
        const maxMMI = pgaToMMI(pga0);
        if (maxMMI >= 6) {
          const liqProb = mmiToLiquefaction(maxMMI, rng);
          if (liqProb > 0.1) {
            const liqKm = Math.pow(10, (0.3 * evt.mag - 1.5) / 1.5);
            shapes.push({
              type: 'liquefaction_zone',
              color: '#eab308',
              opacity: 0.12,
              center: { lat: evt.lat, lon: evt.lon },
              radius: Math.min(liqKm, 150),
              liquefactionProb: liqProb,
              positions: mmiZonePolygon(evt.lat, evt.lon, Math.min(liqKm, 150), rng),
            });
          }
        }
      }
    }

    const latestEvt = visibleEvents[visibleEvents.length - 1];
    const maxMagVisible = visibleEvents.reduce((max, e) => Math.max(max, e.mag), 0);
    const label = latestEvt
      ? `M${maxMagVisible.toFixed(1)} — ${visibleEvents.length} events — P/S/Rayleigh/Love waves`
      : 'Awaiting mainshock';

    steps.push({ time: stepTime, points, shapes, intensity: intensities, label });
  }

  return {
    steps,
    metadata: { duration: p.timeWindow * 3600, dt: dt * 3600, type: 'earthquake_swarm', params: p as Record<string, unknown> },
  };
}
