import type { ScenarioParams, ScenarioTimeSeries, TimeStep, ShapeData, Point3D } from '../templates';
import { SeededRNG, scenarioSeed } from './rng';

/** Fuel model factors — based on Scott & Burgan 40 fuel models */
const FUEL_MODELS: Record<string, { load: number; sav: number; moistureExt: number; heatContent: number; crownBase: number }> = {
  grass: { load: 0.5, sav: 1500, moistureExt: 25, heatContent: 18608, crownBase: 0 },
  shrub: { load: 1.5, sav: 800, moistureExt: 30, heatContent: 20000, crownBase: 1.5 },
  forest: { load: 3.0, sav: 500, moistureExt: 35, heatContent: 18608, crownBase: 6 },
  urban: { load: 0.3, sav: 2000, moistureExt: 20, heatContent: 15000, crownBase: 0 },
};

/** dNBR burn severity classification thresholds (USGS/MTBS) */
const SEVERITY_THRESHOLDS = [
  { min: -0.1, label: 'Enhanced Regrowth', color: '#22c55e', code: 0 },
  { min: 0.1, label: 'Unburned', color: '#86efac', code: 1 },
  { min: 0.27, label: 'Low Severity', color: '#facc15', code: 2 },
  { min: 0.44, label: 'Moderate Severity', color: '#f97316', code: 3 },
  { min: 0.66, label: 'High Severity', color: '#dc2626', code: 4 },
];

function getSeverityColor(dnbr: number): { color: string; label: string } {
  for (let i = SEVERITY_THRESHOLDS.length - 1; i >= 0; i--) {
    if (dnbr >= SEVERITY_THRESHOLDS[i].min) {
      return { color: SEVERITY_THRESHOLDS[i].color, label: SEVERITY_THRESHOLDS[i].label };
    }
  }
  return { color: '#86efac', label: 'Unburned' };
}

function geoToSphere(lat: number, lon: number, height: number): Point3D {
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const r = 1 - height * 0.0000001;
  return { x: r * Math.cos(latRad) * Math.cos(lonRad), y: r * Math.cos(latRad) * Math.sin(lonRad), z: r * Math.sin(latRad) };
}

/**
 * Rothermel surface fire spread model
 * ROS = IR * (1 + wind + slope) / (fuel bed bulk density * heat content * moisture deficit)
 */
function rothermelROS(
  windSpeed: number, humidity: number, fuelType: string,
  slopeDeg: number, windDir: number, spreadDir: number,
): number {
  const fuel = FUEL_MODELS[fuelType] || FUEL_MODELS.forest;
  const windFactor = 0.3 * Math.pow(Math.max(0, windSpeed), 0.84);
  const moistureDeficit = Math.max(0, (fuel.moistureExt - humidity * 0.4)) / fuel.moistureExt;
  const slopeFactor = Math.pow(Math.max(0, Math.tan(slopeDeg * Math.PI / 180)), 2);
  // Wind directional bias — spread is faster in wind direction
  const angleDiff = Math.abs(((spreadDir - windDir + 180) % 360) - 180);
  const directionBias = 1 + 1.5 * Math.cos(angleDiff * Math.PI / 180);
  // Realistic ROS caps by fuel type (km/h)
  const rosMax = fuelType === 'grass' ? 60 : fuelType === 'shrub' ? 30 : fuelType === 'urban' ? 10 : 15;
  const baseROS = Math.min(rosMax, fuel.load * 0.5 * moistureDeficit * 3.6);
  return Math.max(0.01, baseROS * windFactor * directionBias * (1 + slopeFactor));
}

/**
 * Huygens principle — elliptical fire growth from a point
 * Each point on the fire front acts as a source for an elliptical wavelet
 */
function huygensEllipse(
  lat: number, lon: number,
  ros: number, windSpeed: number, windDir: number,
  dt: number, rng: SeededRNG,
): { lat: number; lon: number }[] {
  const kmToDeg = 1 / 111;
  // Length-to-width ratio from Rothermel — wind makes ellipse more elongated
  const lengthWidthRatio = 1 + windSpeed * 0.04; // 1.0 no wind, 2.4 at 35 km/h
  const a = ros * dt * 0.5; // semi-major (downwind)
  const b = a / lengthWidthRatio; // semi-minor (crosswind)
  const windRad = windDir * Math.PI / 180;
  const points: { lat: number; lon: number }[] = [];
  const numPts = 12;
  for (let i = 0; i <= numPts; i++) {
    const angle = (i / numPts) * 2 * Math.PI;
    const r = a * b / Math.sqrt(Math.pow(b * Math.cos(angle), 2) + Math.pow(a * Math.sin(angle), 2));
    const jitter = (rng.next() - 0.5) * 0.1;
    const lat2 = lat + (r * kmToDeg) * Math.cos(angle + windRad + jitter);
    const lon2 = lon + (r * kmToDeg) * Math.sin(angle + windRad + jitter) / Math.cos(lat * Math.PI / 180);
    points.push({ lat: lat2, lon: lon2 });
  }
  return points;
}

/** Check if fire reaches canopy — Van Wagner criteria */
function isCrownFire(
  flameLength: number, canopyBaseHeight: number, foliarMoisture: number,
): boolean {
  if (canopyBaseHeight <= 0) return false;
  const threshold = 0.1 * foliarMoisture * Math.pow(canopyBaseHeight, 1.5);
  return flameLength * flameLength > threshold;
}

/** Generate spotting (ember) landing points */
function generateSpots(
  lat: number, lon: number, windSpeed: number, windDir: number,
  intensity: number, rng: SeededRNG,
): { lat: number; lon: number }[] {
  const spots: { lat: number; lon: number }[] = [];
  const numSpots = Math.floor(intensity * 5);
  const kmToDeg = 1 / 111;
  for (let i = 0; i < numSpots; i++) {
    const loftHeight = intensity * 100 + rng.next() * 500;
    const transportDist = loftHeight * windSpeed * 0.001; // simplified
    const angle = windDir * Math.PI / 180 + (rng.next() - 0.5) * 0.5;
    spots.push({
      lat: lat + (transportDist * kmToDeg) * Math.cos(angle),
      lon: lon + (transportDist * kmToDeg) * Math.sin(angle) / Math.cos(lat * Math.PI / 180),
    });
  }
  return spots;
}

/** Generate evacuation route from fire origin to safety */
function evacuationRoute(
  lat: number, lon: number, windDir: number, rng: SeededRNG,
): { lat: number; lon: number }[] {
  const kmToDeg = 1 / 111;
  const route: { lat: number; lon: number }[] = [];
  const escapeAngle = (windDir + 180) * Math.PI / 180; // opposite to wind
  const numWaypoints = 8;
  for (let i = 0; i <= numWaypoints; i++) {
    const t = i / numWaypoints;
    const dist = t * 15; // 15km route
    const jitter = (rng.next() - 0.5) * 0.3;
    route.push({
      lat: lat + (dist * kmToDeg) * Math.cos(escapeAngle + jitter),
      lon: lon + (dist * kmToDeg) * Math.sin(escapeAngle + jitter) / Math.cos(lat * Math.PI / 180),
    });
  }
  return route;
}

export function simulateWildfire(params: ScenarioParams): ScenarioTimeSeries {
  const p = params as { lat: number; lon: number; area: number; windSpeed: number; windDir: number; humidity: number; fuelType: string; duration: number };
  const rng = new SeededRNG(scenarioSeed('wildfire_spread', p));
  const steps: TimeStep[] = [];
  const durationH = p.duration;
  const dt = Math.max(0.25, durationH / 60);
  const fuel = FUEL_MODELS[p.fuelType] || FUEL_MODELS.forest;
  const windDir = p.windDir;
  const KM_TO_DEG = 1 / 111;

  // Generate evacuation route (fixed throughout simulation)
  const evacRoute = evacuationRoute(p.lat, p.lon, p.windDir, rng);

  // Fire front points — start from origin, grow via Huygens principle
  let frontPoints: { lat: number; lon: number }[] = [{ lat: p.lat, lon: p.lon }];
  let spotIgnitions: { lat: number; lon: number; time: number }[] = [];
  const numParticles = Math.min(Math.floor(p.area / 8), 1500);

  for (let t = 0; t <= durationH; t += dt) {
    const points: Point3D[] = [];
    const intensities: number[] = [];
    const shapes: ShapeData[] = [];

    // Spread fire front via Huygens principle
    const newFront: { lat: number; lon: number }[] = [];
    for (const fp of frontPoints) {
      const slope = 5 + rng.next() * 10;
      const ros = rothermelROS(p.windSpeed, p.humidity, p.fuelType, slope, windDir, windDir);
      const ellipse = huygensEllipse(fp.lat, fp.lon, ros, p.windSpeed, windDir, dt, rng);
      newFront.push(...ellipse);

      // Spotting — embers jump ahead
      if (t > 1 && rng.next() < 0.15) {
        const spots = generateSpots(fp.lat, fp.lon, p.windSpeed, windDir, ros, rng);
        for (const sp of spots) {
          if (rng.next() < 0.3) { // 30% chance of ignition
            spotIgnitions.push({ lat: sp.lat, lon: sp.lon, time: t + dt });
          }
        }
      }
    }    // Add spot ignitions to front (fires that have matured)
    for (const si of spotIgnitions) {
      if (si.time <= t) {
        newFront.push({ lat: si.lat, lon: si.lon });
      }
    }
    spotIgnitions = spotIgnitions.filter(si => si.time > t);

    // Keep front points manageable
    if (newFront.length > 120) {
      frontPoints = newFront.filter((_, i) => i % Math.ceil(newFront.length / 120) === 0);
    } else {
      frontPoints = newFront;
    }

    // ─── 1. Fire Front Perimeter (animated) ──────────────────
    if (frontPoints.length > 2) {
      shapes.push({
        type: 'polyline',
        color: '#ef4444',
        opacity: 0.85,
        positions: frontPoints,
        width: 4,
      });
    }

    // ─── 2. Burn Severity Zones (dNBR-based) ─────────────────
    // Three nested zones: high, moderate, low severity
    const maxDist = Math.max(0.01, t * 0.02 * p.windSpeed);
    const severityZones = [
      { dist: maxDist * 0.4, dnbr: 0.75, label: 'High Severity' },   // inner — most burned
      { dist: maxDist * 0.65, dnbr: 0.50, label: 'Moderate Severity' }, // middle
      { dist: maxDist * 0.9, dnbr: 0.30, label: 'Low Severity' },     // outer edge
    ];

    for (const zone of severityZones) {
      if (zone.dist > 0.005) {
        const sevColor = getSeverityColor(zone.dnbr);
        const zonePts: { lat: number; lon: number }[] = [];
        const numPts = 32;
        for (let i = 0; i <= numPts; i++) {
          const angle = (i / numPts) * 2 * Math.PI;
          const r = zone.dist * (1 + 0.25 * Math.cos(angle - windDir * Math.PI / 180));
          zonePts.push({
            lat: p.lat + (r * KM_TO_DEG) * Math.cos(angle + (rng.next() - 0.5) * 0.1),
            lon: p.lon + (r * KM_TO_DEG) * Math.sin(angle + (rng.next() - 0.5) * 0.1) / Math.cos(p.lat * Math.PI / 180),
          });
        }
        shapes.push({
          type: 'intensity_zone',
          color: sevColor.color,
          opacity: 0.15 + (zone.dnbr / 0.75) * 0.15,
          positions: zonePts,
          center: { lat: p.lat, lon: p.lon },
          radius: zone.dist,
          mmi: Math.round(zone.dnbr * 10),
        });
      }
    }

    // ─── 3. Crown Fire Indicators ────────────────────────────
    const flameLength = 0.5 + t * 0.3 * (p.windSpeed / 20);
    if (isCrownFire(flameLength, fuel.crownBase, 120)) {
      shapes.push({
        type: 'damage_zone',
        color: '#ff0000',
        opacity: 0.12,
        positions: frontPoints.slice(0, 16),
        center: { lat: p.lat, lon: p.lon },
        radius: maxDist * 0.3,
        damagePercent: Math.min(100, Math.floor(t * 5)),
      });
    }

    // ─── 4. Spot Fires (ember ignition points) ───────────────
    for (const si of spotIgnitions) {
      const spotDist = Math.sqrt(
        Math.pow((si.lat - p.lat) * 111, 2) + Math.pow((si.lon - p.lon) * 111 * Math.cos(p.lat * Math.PI / 180), 2),
      );
      if (spotDist > maxDist * 0.5) {
        shapes.push({
          type: 'ring',
          color: '#ff6600',
          opacity: 0.6,
          center: { lat: si.lat, lon: si.lon },
          radius: 500 + rng.next() * 1000,
          waveType: 'spot',
        });
      }
    }

    // ─── 5. Smoke Plume (Gaussian puff model) ─────────────────
    if (t > 0.5 && t % 1 < dt) {
      const plumeHeight = 1000 + t * 200 * Math.sqrt(p.windSpeed);
      const plumeDist = t * p.windSpeed * 0.05;
      const smokeLat = p.lat + (plumeDist * 0.5 * KM_TO_DEG) * Math.cos(windDir * Math.PI / 180);
      const smokeLon = p.lon + (plumeDist * 0.5 * KM_TO_DEG) * Math.sin(windDir * Math.PI / 180) / Math.cos(p.lat * Math.PI / 180);
      shapes.push({
        type: 'cylinder',
        color: '#6b7280',
        opacity: 0.12,
        center: { lat: smokeLat, lon: smokeLon },
        radius: plumeDist * 150,
        height: plumeHeight,
      });
    }

    // ─── 6. Evacuation Route ──────────────────────────────────
    const routeAccessible = t < durationH * 0.7; // route closes when fire is too close
    if (routeAccessible) {
      shapes.push({
        type: 'polyline',
        color: '#22c55e',
        opacity: 0.7,
        positions: evacRoute,
        width: 3,
      });
    } else {
      shapes.push({
        type: 'polyline',
        color: '#ef4444',
        opacity: 0.5,
        positions: evacRoute,
        width: 3,
      });
    }

    // ─── 7. Fire Particles (hotspots) ────────────────────────
    for (let i = 0; i < Math.min(numParticles, 200); i++) {
      const frac = i / Math.min(numParticles, 200);
      const dist = maxDist * Math.sqrt(frac) * 0.8;
      const angle = windDir * Math.PI / 180 + (rng.next() - 0.5) * Math.PI * 0.8;
      const lat = p.lat + (dist * KM_TO_DEG) * Math.cos(angle);
      const lon = p.lon + (dist * KM_TO_DEG) * Math.sin(angle) / Math.cos(p.lat * Math.PI / 180);
      const intensity = Math.max(0, 1 - dist / maxDist);
      points.push(geoToSphere(lat, lon, intensity * 300));
      intensities.push(intensity);
    }

    const areaKm2 = Math.PI * maxDist * maxDist;
    const label = `[FIRE] ${t.toFixed(1)}h — ${maxDist.toFixed(1)}km spread — ${areaKm2.toFixed(0)} km² — ROS: ${(rothermelROS(p.windSpeed, p.humidity, p.fuelType, 5, windDir, windDir) * 3.6).toFixed(0)} km/h`;
    steps.push({ time: t * 3600, points, shapes, intensity: intensities, label });
  }

  return {
    steps,
    metadata: { duration: durationH * 3600, dt: dt * 3600, type: 'wildfire_spread', params: p as Record<string, unknown> },
  };
}
