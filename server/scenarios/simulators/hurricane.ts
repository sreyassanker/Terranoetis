import type { ScenarioParams, ScenarioTimeSeries, TimeStep, ShapeData, Point3D } from '../templates';
import { SeededRNG, scenarioSeed } from './rng';

/** Saffir-Simpson max sustained wind (kt) by category */
const SAFFIR_SIMPSON_MAX_WIND = [33, 43, 50, 58, 64, 70, 77];
/** Saffir-Simpson category labels */
const CAT_LABELS = ['TD', 'TS', 'Cat 1', 'Cat 2', 'Cat 3', 'Cat 4', 'Cat 5'];
/** Saffir-Simpson colors */
const CAT_COLORS = ['#60a5fa', '#fbbf24', '#f59e0b', '#f97316', '#ef4444', '#dc2626', '#7c2d12'];

function geoToSphere(lat: number, lon: number, height: number): Point3D {
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const r = 1 - height * 0.0000001;
  return { x: r * Math.cos(latRad) * Math.cos(lonRad), y: r * Math.cos(latRad) * Math.sin(lonRad), z: r * Math.sin(latRad) };
}

/**
 * Holland (2010) parametric wind profile
 * V(r) = sqrt( (B/RHO) * (Rmax/R)^B * (Pn - Pc) * exp(-(Rmax/R)^B) + (f*R/2)^2 ) - f*R/2
 */
function hollandWindProfile(
  rKm: number, rMaxKm: number, centralPressure: number,
  category: number, latAbs: number,
): number {
  const B = 1.0 + 1.5 * Math.pow(centralPressure < 960 ? 960 - centralPressure : 0, 0.01) * 0.5;
  const pN = 1013; // ambient pressure hPa
  const pC = centralPressure;
  const rho = 1.15; // air density kg/m³
  const f = 2 * 7.2921e-5 * Math.sin(Math.abs(latAbs) * Math.PI / 180); // Coriolis
  const rM = Math.max(rKm, 1);
  const ratio = rMaxKm / rM;
  const vG = Math.sqrt((B / rho) * Math.pow(ratio, B) * (pN - pC) * Math.exp(-Math.pow(ratio, B)) + Math.pow(f * rM * 1000 / 2, 2));
  const vSurface = vG * 0.8; // reduction factor for surface friction
  return Math.max(0, vSurface / 0.5144); // convert m/s to kt
}

/** Storm surge height based on category, forward speed, and coastal proximity */
function stormSurgeHeight(category: number, forwardSpeedKmh: number, distFromCoastKm: number): number {
  const baseSurge = [0.5, 1.0, 1.5, 2.5, 3.5, 5.5, 8.5][Math.min(category, 6)];
  const speedFactor = Math.min(1.5, 0.7 + forwardSpeedKmh * 0.01);
  const coastalFactor = Math.max(0, 1 - distFromCoastKm / 50);
  return baseSurge * speedFactor * coastalFactor;
}

/** Rainfall rate (mm/hr) based on distance from eye and category */
function rainfallRate(rKm: number, rMaxKm: number, category: number): number {
  const baseRate = [5, 10, 20, 30, 40, 50, 60][Math.min(category, 6)];
  const ratio = rKm / rMaxKm;
  if (ratio < 0.8) return baseRate * 0.3; // eye — light rain
  if (ratio < 1.2) return baseRate; // eyewall — max rainfall
  if (ratio < 3) return baseRate * (1 - (ratio - 1.2) * 0.35); // rainbands
  return baseRate * 0.1; // outer circulation
}

/** Generate spiral rainband positions */
function generateRainbands(
  lat: number, lon: number, rMaxKm: number, numBands: number,
  rotation: number, rng: SeededRNG,
): { lat: number; lon: number }[][] {
  const bands: { lat: number; lon: number }[][] = [];
  const kmToDeg = 1 / 111;
  for (let b = 0; b < numBands; b++) {
    const points: { lat: number; lon: number }[] = [];
    const bandAngle = (b / numBands) * 2 * Math.PI;
    const numPts = 20;
    for (let i = 0; i <= numPts; i++) {
      const t = i / numPts;
      const r = rMaxKm * (0.5 + t * 2.5);
      const spiralAngle = bandAngle + rotation + t * 1.2; // spiral outward
      const jitter = (rng.next() - 0.5) * 0.1;
      points.push({
        lat: lat + (r * kmToDeg) * Math.cos(spiralAngle + jitter),
        lon: lon + (r * kmToDeg) * Math.sin(spiralAngle + jitter) / Math.cos(lat * Math.PI / 180),
      });
    }
    bands.push(points);
  }
  return bands;
}

/** Cone of uncertainty polygon (widens with forecast time) */
function coneOfUncertainty(
  track: { lat: number; lon: number }[],
  startIdx: number, endIdx: number,
): { lat: number; lon: number }[] {
  if (endIdx <= startIdx) return [];
  const kmToDeg = 1 / 111;
  const topPts: { lat: number; lon: number }[] = [];
  const botPts: { lat: number; lon: number }[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const progress = (i - startIdx) / Math.max(1, endIdx - startIdx);
    const coneWidthKm = 50 + progress * 400; // widens from 50km to 450km
    const pt = track[Math.min(i, track.length - 1)];
    // perpendicular offset for cone width
    const angle = i < track.length - 1
      ? Math.atan2(track[i + 1].lon - pt.lon, track[i + 1].lat - pt.lat)
      : Math.atan2(pt.lon - track[i - 1].lon, pt.lat - track[i - 1].lat);
    const perpAngle = angle + Math.PI / 2;
    topPts.push({
      lat: pt.lat + coneWidthKm * kmToDeg * Math.cos(perpAngle),
      lon: pt.lon + coneWidthKm * kmToDeg * Math.sin(perpAngle) / Math.cos(pt.lat * Math.PI / 180),
    });
    botPts.push({
      lat: pt.lat - coneWidthKm * kmToDeg * Math.cos(perpAngle),
      lon: pt.lon - coneWidthKm * kmToDeg * Math.sin(perpAngle) / Math.cos(pt.lat * Math.PI / 180),
    });
  }
  // close polygon: top forward, then bottom backward
  return [...topPts, ...botPts.reverse()];
}

export function simulateHurricane(params: ScenarioParams): ScenarioTimeSeries {
  const p = params as { lat: number; lon: number; category: number; forwardSpeed: number; pressure: number; radius: number; landfallTime: number };
  const rng = new SeededRNG(scenarioSeed('hurricane_landfall', p));
  const steps: TimeStep[] = [];
  const durationH = p.landfallTime + 12;
  const dt = Math.max(0.5, durationH / 80);
  const cat = Math.max(1, Math.min(5, p.category));
  const rMax = p.radius; // radius of maximum winds in km
  const numRings = Math.min(cat + 2, 7);

  const betaDriftLat = 0.15;
  const betaDriftLon = -0.08;
  let curLat = p.lat;
  let curLon = p.lon;
  const track: { lat: number; lon: number; time: number }[] = [];

  // Pre-compute full track for cone of uncertainty (separate RNG for determinism)
  const trackRng = new SeededRNG(scenarioSeed('hurricane_track', p));
  let tLat = p.lat;
  let tLon = p.lon;
  for (let t = 0; t <= durationH; t += dt) {
    track.push({ lat: tLat, lon: tLon, time: t });
    const heading = 315 + (trackRng.next() - 0.5) * 5;
    const headingRad = heading * Math.PI / 180;
    tLat += p.forwardSpeed * dt * Math.cos(headingRad) / 111 + betaDriftLat * dt;
    tLon += p.forwardSpeed * dt * Math.sin(headingRad) / (111 * Math.cos(tLat * Math.PI / 180)) + betaDriftLon * dt;
  }

  // Reset for main simulation
  curLat = p.lat;
  curLon = p.lon;

  for (let t = 0; t <= durationH; t += dt) {
    const stepIdx = Math.floor(t / dt);
    const heading = 315 + (rng.next() - 0.5) * 5;
    const headingRad = heading * Math.PI / 180;
    curLat += p.forwardSpeed * dt * Math.cos(headingRad) / 111 + betaDriftLat * dt;
    curLon += p.forwardSpeed * dt * Math.sin(headingRad) / (111 * Math.cos(curLat * Math.PI / 180)) + betaDriftLon * dt;

    const rotation = t * 0.3; // rotation angle for spiral bands
    const windMax = hollandWindProfile(1, rMax, p.pressure, cat, Math.abs(curLat));
    const distToLandfall = Math.max(0, (p.landfallTime - t) * p.forwardSpeed);
    const isPostLandfall = t > p.landfallTime;
    const decayFactor = isPostLandfall ? Math.max(0.3, 1 - (t - p.landfallTime) * 0.05) : 1;

    const points: Point3D[] = [];
    const intensities: number[] = [];
    const shapes: ShapeData[] = [];

    // ─── 1. Eye Wall (rotating cylinder) ─────────────────────
    shapes.push({
      type: 'cylinder',
      color: CAT_COLORS[Math.min(cat, 6)],
      opacity: 0.55 * decayFactor,
      center: { lat: curLat, lon: curLon },
      radius: rMax * 1.5 * 1000, // eye wall outer edge
      height: 14000 * decayFactor,
    });

    // ─── 2. Eye (calm center) ────────────────────────────────
    shapes.push({
      type: 'ring',
      color: '#ffffff',
      opacity: 0.3 * decayFactor,
      center: { lat: curLat, lon: curLon },
      radius: rMax * 0.15 * 1000,
      waveType: 'eye',
    });

    // ─── 3. Wind Field Rings (Holland profile) ────────────────
    for (let ring = 0; ring < numRings; ring++) {
      const ringRadius = rMax * (ring + 1) / numRings;
      const speed = hollandWindProfile(ringRadius, rMax, p.pressure, cat, Math.abs(curLat)) * decayFactor;
      const n = Math.max(12, Math.floor(36 + cat * 12 - ring * 4));

      for (let i = 0; i < n; i++) {
        const angle = (i / n) * 2 * Math.PI + (rng.next() - 0.5) * 0.2;
        const r = ringRadius + (rng.next() - 0.5) * (rMax / numRings) * 0.3;
        const lat = curLat + (r / 111) * Math.cos(angle);
        const lon = curLon + (r / 111) * Math.sin(angle) / Math.cos(curLat * Math.PI / 180);
        const height = speed * 60;
        points.push(geoToSphere(lat, lon, height));
        intensities.push(speed);
      }

      // Wind field ring outline
      if (ring === 0 || ring === numRings - 1) {
        const ringPts: { lat: number; lon: number }[] = [];
        for (let a = 0; a <= 64; a++) {
          const angle = (a / 64) * 2 * Math.PI;
          ringPts.push({
            lat: curLat + (ringRadius / 111) * Math.cos(angle),
            lon: curLon + (ringRadius / 111) * Math.sin(angle) / Math.cos(curLat * Math.PI / 180),
          });
        }
        shapes.push({
          type: 'polyline',
          color: ring === 0 ? '#ef4444' : '#f97316',
          opacity: (ring === 0 ? 0.7 : 0.3) * decayFactor,
          positions: ringPts,
          width: ring === 0 ? 3 : 1.5,
        });
      }
    }

    // ─── 4. Spiral Rainbands ──────────────────────────────────
    const numBands = Math.min(5, cat + 1);
    const rainbands = generateRainbands(curLat, curLon, rMax, numBands, rotation, rng);
    for (const band of rainbands) {
      shapes.push({
        type: 'polyline',
        color: '#22d3ee',
        opacity: 0.25 * decayFactor,
        positions: band,
        width: 2,
      });
    }

    // ─── 5. Storm Surge Zone (when near coast) ────────────────
    if (distToLandfall < 200 && distToLandfall > -200) {
      const surgeM = stormSurgeHeight(cat, p.forwardSpeed, distToLandfall);
      if (surgeM > 0.3) {
        // Surge zone: half-circle facing coast (simplified)
        const surgeRadius = surgeM * 8; // rough km scale
        const surgePts: { lat: number; lon: number }[] = [];
        for (let a = 0; a <= 32; a++) {
          const angle = (a / 32) * Math.PI; // half circle toward coast
          surgePts.push({
            lat: curLat + (surgeRadius / 111) * Math.cos(angle),
            lon: curLon + (surgeRadius / 111) * Math.sin(angle) / Math.cos(curLat * Math.PI / 180),
          });
        }
        shapes.push({
          type: 'intensity_zone',
          color: '#0ea5e9',
          opacity: 0.2,
          positions: surgePts,
          center: { lat: curLat, lon: curLon },
          radius: surgeRadius,
          mmi: Math.round(surgeM * 1.5), // repurpose mmi field for surge height display
          waveType: 'surge',
        });
      }
    }

    // ─── 6. Rainfall Accumulation Zone ────────────────────────
    const rainRadius = rMax * 3;
    const rainPts: { lat: number; lon: number }[] = [];
    for (let a = 0; a <= 32; a++) {
      const angle = (a / 32) * 2 * Math.PI;
      rainPts.push({
        lat: curLat + (rainRadius / 111) * Math.cos(angle),
        lon: curLon + (rainRadius / 111) * Math.sin(angle) / Math.cos(curLat * Math.PI / 180),
      });
    }
    shapes.push({
      type: 'intensity_zone',
      color: '#3b82f6',
      opacity: 0.08 * decayFactor,
      positions: rainPts,
      center: { lat: curLat, lon: curLon },
      radius: rainRadius,
      mmi: Math.min(10, Math.round(rainfallRate(rMax * 0.5, rMax, cat) / 5)),
    });

    // ─── 7. Cone of Uncertainty (future track) ────────────────
    const futureStart = stepIdx;
    const futureEnd = Math.min(track.length - 1, stepIdx + Math.floor(p.landfallTime / dt));
    if (futureStart < futureEnd && !isPostLandfall) {
      const conePts = coneOfUncertainty(track, futureStart, futureEnd);
      if (conePts.length > 2) {
        shapes.push({
          type: 'polygon',
          color: '#fbbf24',
          opacity: 0.08,
          positions: conePts,
        });
      }
    }

    const label = `${CAT_LABELS[Math.min(cat, 6)]} — ${windMax.toFixed(0)} kt — ${surgeMText(cat, distToLandfall, p.forwardSpeed)} surge — ${t.toFixed(1)}h`;
    steps.push({ time: t * 3600, points, shapes, intensity: intensities, label });
  }

  return {
    steps,
    metadata: { duration: durationH * 3600, dt: dt * 3600, type: 'hurricane_landfall', params: p as Record<string, unknown> },
  };
}

function surgeMText(cat: number, distKm: number, fwdSpeed: number): string {
  if (distKm > 200 || distKm < -200) return '0.0m';
  const s = stormSurgeHeight(cat, fwdSpeed, Math.max(0, distKm));
  return `${s.toFixed(1)}m`;
}
