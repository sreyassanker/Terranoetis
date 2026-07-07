import type { ScenarioParams, ScenarioTimeSeries, TimeStep, ShapeData, Point3D } from '../templates';
import { validateTsunami } from '../geographicValidator';
import { SeededRNG, scenarioSeed } from './rng';

const G = 9.81; // gravitational acceleration

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

/**
 * Shallow water wave speed: c = sqrt(g * d)
 * where d = water depth in meters
 */
function shallowWaterSpeed(depthM: number): number {
  return Math.sqrt(G * Math.max(1, depthM));
}

/**
 * Improved ocean detection with major seas and bays
 */
function isLikelyOcean(lat: number, lon: number): boolean {
  // Major oceans
  if (lat < -70 || lat > 80) return true;
  
  // Pacific Ocean
  if (lat > -60 && lat < 65 && lon > 120 && lon < 180) return true;
  if (lat > -60 && lat < 65 && lon > -180 && lon < -100) return true;
  
  // Atlantic Ocean
  if (lat > -60 && lat < 70 && lon > -60 && lon < 0) return true;
  if (lat > -60 && lat < 10 && lon > -80 && lon < -30) return true;
  
  // Indian Ocean
  if (lat > -50 && lat < 30 && lon > 20 && lon < 120) return true;
  
  // Mediterranean Sea
  if (lat > 30 && lat < 46 && lon > -6 && lon < 36) return true;
  
  // Caribbean Sea
  if (lat > 10 && lat < 25 && lon > -90 && lon < -60) return true;
  
  // Gulf of Mexico
  if (lat > 18 && lat < 31 && lon > -98 && lon < -80) return true;
  
  // South China Sea
  if (lat > 0 && lat < 23 && lon > 100 && lon < 120) return true;
  
  // Sea of Japan
  if (lat > 33 && lat < 52 && lon > 127 && lon < 145) return true;
  
  // Bay of Bengal
  if (lat > 0 && lat < 22 && lon > 80 && lon < 100) return true;
  
  // Arabian Sea
  if (lat > 0 && lat < 25 && lon > 50 && lon < 80) return true;
  
  // Red Sea
  if (lat > 12 && lat < 30 && lon > 32 && lon < 44) return true;
  
  // Persian Gulf
  if (lat > 24 && lat < 30 && lon > 47 && lon < 56) return true;
  
  return false;
}

/**
 * Find nearest coast point and distance
 */
function findNearestCoast(
  lat: number,
  lon: number,
  maxSearchKm: number = 500,
): { distance: number; lat: number; lon: number; isCoastal: boolean } {
  const kmToDeg = 1 / 111;
  const searchDeg = maxSearchKm * kmToDeg;
  const stepDeg = 0.5 * kmToDeg; // 50km steps
  
  let nearestDist = Infinity;
  let nearestLat = lat;
  let nearestLon = lon;
  let foundCoast = false;
  
  // Search in expanding rings
  for (let dist = stepDeg; dist <= searchDeg; dist += stepDeg) {
    const numPoints = Math.floor(2 * Math.PI * dist / stepDeg);
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      const testLat = lat + dist * Math.cos(angle);
      const testLon = lon + dist * Math.sin(angle) / Math.cos(lat * Math.PI / 180);
      
      if (isLikelyOcean(testLat, testLon)) {
        const oceanDist = Math.sqrt(
          Math.pow((testLat - lat) * 111, 2) +
          Math.pow((testLon - lon) * 111 * Math.cos(lat * Math.PI / 180), 2)
        );
        
        if (oceanDist < nearestDist) {
          nearestDist = oceanDist;
          nearestLat = testLat;
          nearestLon = testLon;
          foundCoast = true;
        }
      }
    }
    
    if (foundCoast) break;
  }
  
  return {
    distance: nearestDist,
    lat: nearestLat,
    lon: nearestLon,
    isCoastal: foundCoast && nearestDist < 100, // within 100km
  };
}

/**
 * Compute wave shoaling coefficient
 * As waves approach shore, they slow down and increase in height
 */
function shoalingCoefficient(depth: number, deepWaterDepth: number): number {
  // Green's law: H_shore = H_deep * (d_deep/d_shore)^(1/4)
  if (depth <= 0 || deepWaterDepth <= 0) return 1;
  return Math.pow(deepWaterDepth / Math.max(depth, 1), 0.25);
}



/**
 * Generate coastal inundation polygon
 */
function generateInundationPolygon(
  epicenterLat: number,
  epicenterLon: number,
  waveHeight: number,
  time: number,
  directivityAngle: number,
): { lat: number; lon: number; depth: number }[] {
  const kmToDeg = 1 / 111;
  const inlandKm = 2 + waveHeight * 0.5 * Math.min(1, time / 30); // increases over time
  const numPoints = 48;
  
  const points: { lat: number; lon: number; depth: number }[] = [];
  
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    
    // Directivity: elongate in the direction perpendicular to fault
    const angleDiff = Math.abs(angle - directivityAngle);
    const directivityFactor = 0.3 + 0.7 * Math.pow(Math.cos(angleDiff), 2);
    
    const distKm = 5 + inlandKm * directivityFactor;
    const distDeg = distKm * kmToDeg;
    
    const lat = epicenterLat + distDeg * Math.cos(angle);
    const lon = epicenterLon + distDeg * Math.sin(angle) / Math.cos(epicenterLat * Math.PI / 180);
    
    // Depth decreases inland
    const depth = waveHeight * directivityFactor * Math.exp(-distKm / (inlandKm + 5));
    
    points.push({ lat, lon, depth });
  }
  
  return points;
}

/**
 * Generate wave crest positions with proper physics
 */
function generateWaveCrests(
  epicenterLat: number,
  epicenterLon: number,
  waveHeight: number,
  time: number,
  oceanDepth: number,
  directivityAngle: number,
): { points: Point3D[]; intensities: number[] } {
  const kmToDeg = 1 / 111;
  const c = shallowWaterSpeed(oceanDepth);
  const cKmh = c * 3.6;
  
  const points: Point3D[] = [];
  const intensities: number[] = [];
  
  // Multiple wave crests
  const numCrests = Math.min(5, Math.floor(time / 15) + 1);
  
  for (let crest = 0; crest < numCrests; crest++) {
    const crestTime = time - crest * 15; // 15 min apart
    if (crestTime <= 0) continue;
    
    const radiusKm = crestTime * cKmh / 60;
    const numPoints = 64;
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      
      // Directivity
      const angleDiff = Math.abs(angle - directivityAngle);
      const directivity = 0.4 + 0.6 * Math.pow(Math.cos(angleDiff), 2);
      
      // Only propagate in ocean
      const testLat = epicenterLat + radiusKm * Math.cos(angle) * kmToDeg;
      const testLon = epicenterLon + radiusKm * Math.sin(angle) * kmToDeg / Math.cos(epicenterLat * Math.PI / 180);
      
      if (!isLikelyOcean(testLat, testLon)) continue;
      
      // Shoaling: wave height increases as water gets shallower near coast
      const approxDepthAtPoint = oceanDepth * Math.max(0.1, 1 - Math.min(1, radiusKm / 200));
      const shoaling = shoalingCoefficient(approxDepthAtPoint, oceanDepth);
      
      // Wave amplitude with decay and shoaling boost
      const amplitude = waveHeight * directivity * shoaling * Math.exp(-radiusKm * 0.002);
      
      const lat = epicenterLat + radiusKm * Math.cos(angle) * kmToDeg;
      const lon = epicenterLon + radiusKm * Math.sin(angle) * kmToDeg / Math.cos(epicenterLat * Math.PI / 180);
      
      points.push(geoToSphere(lat, lon, amplitude * 3));
      intensities.push(amplitude / waveHeight);
    }
  }
  
  return { points, intensities };
}

export function simulateTsunami(params: ScenarioParams): ScenarioTimeSeries {
  const p = params as { 
    epicenterLat: number; 
    epicenterLon: number; 
    magnitude: number; 
    depth: number; 
    waveHeight: number; 
    arrivalTimes: number[] 
  };
  
  // Validate location
  const validation = validateTsunami(p.epicenterLat, p.epicenterLon);
  if (!validation.valid) {
    console.warn(`Tsunami validation failed: ${validation.reason}`);
    // Still simulate but with reduced parameters
  }
  
  const steps: TimeStep[] = [];
  const oceanDepth = p.depth * 1000;
  const c = shallowWaterSpeed(oceanDepth);
  const cKmh = c * 3.6;
  
  // Total simulation duration (hours)
  const totalDurationH = Math.max(6, (p.arrivalTimes[p.arrivalTimes.length - 1] || 60) * 2);
  const dt = Math.max(0.5, totalDurationH / 80);
  
  // Seeded RNG for reproducible simulations
  const rng = new SeededRNG(scenarioSeed('tsunami_wave', p));

  // Compute directivity angle (perpendicular to fault) — seeded for reproducibility
  const directivityAngle = rng.next() * 2 * Math.PI;
  
  // Pre-compute coast info once (expensive operation)
  const coastInfo = findNearestCoast(p.epicenterLat, p.epicenterLon, 500);
  
  for (let t = 0; t <= totalDurationH; t += dt) {
    const points: Point3D[] = [];
    const intensities: number[] = [];
    const shapes: ShapeData[] = [];
    
    // Generate wave crests
    const { points: wavePoints, intensities: waveIntensities } = generateWaveCrests(
      p.epicenterLat,
      p.epicenterLon,
      p.waveHeight,
      t,
      oceanDepth,
      directivityAngle,
    );
    points.push(...wavePoints);
    intensities.push(...waveIntensities);
    
    // Epicenter marker — always visible
    shapes.push({
      type: 'cylinder',
      color: '#ef4444',
      opacity: 0.7,
      center: { lat: p.epicenterLat, lon: p.epicenterLon },
      radius: 2000,
      height: 3000,
    });
    
    // At t=0: add initial seismic source ring and source points so user sees activity
    if (t === 0) {
      // Initial seismic ring at the source (small, tight)
      shapes.push({
        type: 'ring',
        color: '#f59e0b',
        opacity: 0.6,
        center: { lat: p.epicenterLat, lon: p.epicenterLon },
        radius: 5,
        width: 2.5,
      });

      // Source scatter points radiating outward from epicenter
      const numSourcePts = 48;
      for (let i = 0; i < numSourcePts; i++) {
        const angle = (i / numSourcePts) * 2 * Math.PI;
        const r = 0.05 + rng.next() * 0.15; // 5-22 km
        const lat = p.epicenterLat + r * Math.cos(angle);
        const lon = p.epicenterLon + r * Math.sin(angle) / Math.cos(p.epicenterLat * Math.PI / 180);
        const amplitude = p.waveHeight * 0.8 * Math.exp(-r * 2);
        points.push(geoToSphere(lat, lon, amplitude * 2));
        intensities.push(amplitude / p.waveHeight);
      }
    }
    
    // Coastal inundation (after wave arrival)
    if (t > 0 && coastInfo.isCoastal) {
      const inundationPoints = generateInundationPolygon(
        p.epicenterLat,
        p.epicenterLon,
        p.waveHeight,
        t,
        directivityAngle,
      );
      
      if (inundationPoints.length >= 3) {
        const positions = inundationPoints.map(pt => ({ lat: pt.lat, lon: pt.lon }));
        const depths = inundationPoints.map(pt => pt.depth);
        
        shapes.push({
          type: 'flood_surface',
          color: '#06b6d4',
          opacity: 0.5,
          positions,
          depths,
          maxDepth: p.waveHeight,
          waterElevation: 0,
        });
      }
    }
    
    // Wave rings
    if (t > 0) {
      const numRings = Math.min(3, Math.floor(t / 10) + 1);
      for (let ring = 0; ring < numRings; ring++) {
        const ringTime = t - ring * 10;
        if (ringTime <= 0) continue;
        
        const ringRadiusKm = ringTime * cKmh / 60;
        const ringPositions: { lat: number; lon: number }[] = [];
        
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * 2 * Math.PI;
          const lat = p.epicenterLat + ringRadiusKm * Math.cos(a) / 111;
          const lon = p.epicenterLon + ringRadiusKm * Math.sin(a) / (111 * Math.cos(p.epicenterLat * Math.PI / 180));
          
          if (isLikelyOcean(lat, lon)) {
            ringPositions.push({ lat, lon });
          }
        }
        
        if (ringPositions.length >= 4) {
          const opacity = Math.max(0.1, 0.5 - ring * 0.15);
          shapes.push({
            type: 'ring',
            color: ring === 0 ? '#06b6d4' : ring === 1 ? '#0ea5e9' : '#38bdf8',
            opacity,
            center: { lat: p.epicenterLat, lon: p.epicenterLon },
            radius: ringRadiusKm,
            width: ring === 0 ? 3 : 1.5,
          });
        }
      }
    }
    
    // Label
    const coastDist = coastInfo.isCoastal ? ` — coast: ${coastInfo.distance.toFixed(0)}km` : '';
    const label = `t=${t.toFixed(1)}h — ${points.length} wave points — c=${cKmh.toFixed(0)} km/h${coastDist}`;
    
    steps.push({ time: t * 3600, points, shapes, intensity: intensities, label });
  }
  
  return {
    steps,
    metadata: {
      duration: totalDurationH * 3600,
      dt: dt * 3600,
      type: 'tsunami_wave',
      params: p as Record<string, unknown>,
    },
  };
}
