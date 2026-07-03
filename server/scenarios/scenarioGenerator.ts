import { randomUUID } from 'crypto';
import { type PointCloud } from '../earthgen/flowMatching';
import { type ScenarioType, type ScenarioBase, type EarthquakeSwarmParams, type HurricaneLandfallParams, type WildfireSpreadParams, type VolcanicEruptionParams, type FloodInundationParams, type TsunamiWaveParams, DEFAULT_PARAMS } from './templates';
import { validateScenario } from './scenarioValidator';
import { simulateScenario } from './simulators';

/* ═════════════════════════════════════════════════════════════════
   COMMON UTILITIES
   ═════════════════════════════════════════════════════════════════ */

function geoToSphere(lat: number, lon: number, depthOrHeight: number, mode: 'depth' | 'height' = 'depth'): [number, number, number] {
  const latRad = lat * (Math.PI / 180);
  const lonRad = lon * (Math.PI / 180);
  const r = mode === 'depth' ? 1 - depthOrHeight * 0.0001 : 1 + depthOrHeight * 0.0000001;
  return [
    r * Math.cos(latRad) * Math.cos(lonRad),
    r * Math.cos(latRad) * Math.sin(lonRad),
    r * Math.sin(latRad),
  ];
}

/** Seeded PRNG for reproducible scenarios */
class SeededRNG {
  private s: number;
  constructor(seed: number) { this.s = seed; }
  next(): number {
    this.s = (this.s * 16807 + 0) % 2147483647;
    return (this.s - 1) / 2147483646;
  }
  nextGaussian(): number {
    const u1 = this.next();
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
  }
}

/* ═════════════════════════════════════════════════════════════════
   MAIN GENERATOR
   ═════════════════════════════════════════════════════════════════ */

export async function generateScenario(
  type: ScenarioType,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<ScenarioBase> {
  const defaults = DEFAULT_PARAMS[type];
  const params = { ...defaults, ...overrides } as Record<string, unknown>;

  let pointCloud: PointCloud;

  switch (type) {
    case 'earthquake_swarm':
      pointCloud = generateEarthquakeSwarm(params as unknown as EarthquakeSwarmParams);
      break;
    case 'hurricane_landfall':
      pointCloud = generateHurricaneLandfall(params as unknown as HurricaneLandfallParams);
      break;
    case 'wildfire_spread':
      pointCloud = generateWildfireSpread(params as unknown as WildfireSpreadParams);
      break;
    case 'volcanic_eruption':
      pointCloud = generateVolcanicEruption(params as unknown as VolcanicEruptionParams);
      break;
    case 'flood_inundation':
      pointCloud = generateFloodInundation(params as unknown as FloodInundationParams);
      break;
    case 'tsunami_wave':
      pointCloud = generateTsunamiWave(params as unknown as TsunamiWaveParams);
      break;
    default:
      throw new Error(`Unknown scenario type: ${type}`);
  }

  const validation = validateScenario({ type, params, pointCloud } as Parameters<typeof validateScenario>[0]);
  const id = `scenario_${randomUUID().slice(0, 8)}`;
  const timeSeries = simulateScenario(type, params as unknown as EarthquakeSwarmParams | HurricaneLandfallParams | WildfireSpreadParams | VolcanicEruptionParams | FloodInundationParams | TsunamiWaveParams);

  return {
    id,
    type,
    params,
    pointCloud,
    validationScore: validation.confidence,
    createdAt: new Date().toISOString(),
    metadata: { validation },
    timeSeries,
  };
}

/* ═════════════════════════════════════════════════════════════════
   1. EARTHQUAKE SWARM — Fault-plane geometry + Wadati-Benioff zone
   
   Research basis:
   - Hypocenters cluster along a dipping fault plane (not random scatter)
   - Depth increases along the fault dip direction (Wadati-Benioff zone)
   - Aftershocks migrate along the fault via Coulomb stress transfer
   - Gutenberg-Richter magnitude distribution
   - Omori temporal decay for aftershock frequency
   ═════════════════════════════════════════════════════════════════ */

function generateEarthquakeSwarm(p: EarthquakeSwarmParams): PointCloud {
  const rng = new SeededRNG(hashParams('earthquake', p));
  const cloud: PointCloud = [];
  const [dMin, dMax] = p.depthRange;
  const [mMin, mMax] = p.magnitudeRange;

  // Fault plane parameters — strike determines along-strike direction,
  // dip determines the angle the fault plunges into the earth
  const strikeDeg = 225 + (rng.next() - 0.5) * 60; // fault strike direction
  const dipDeg = 30 + rng.next() * 30; // dip angle (30-60°)
  const faultLengthKm = Math.max(10, 20 * Math.pow(10, 0.4 * (mMax - 4)));
  const faultWidthKm = faultLengthKm * 0.4; // width along dip
  const kmToDeg = 1 / 111;

  // Mainshock at center of fault plane
  const mainMag = mMax - 0.3 + rng.next() * 0.3;
  const mainDepth = (dMin + dMax) / 2;
  const mainPoint = geoToSphere(p.lat, p.lon, mainDepth);
  cloud.push({ x: mainPoint[0], y: mainPoint[1], z: mainPoint[2] });

  // Generate aftershocks distributed along the fault plane
  const numAftershocks = Math.max(0, p.numEvents - 1);
  for (let i = 0; i < numAftershocks; i++) {
    // Temporal decay (Omori law) determines when each event occurs
    const decay = omoriDecay(i, numAftershocks, p.timeWindow, p.decayModel);

    // Spatial position on fault plane:
    // alongStrike = position along the fault length
    // alongDip = position along the fault width (determines depth)
    const alongStrike = (rng.next() - 0.5) * faultLengthKm; // km from center
    const alongDip = rng.next() * faultWidthKm; // km from surface trace

    // Project onto geographic coordinates using fault geometry
    const strikeRad = strikeDeg * Math.PI / 180;
    const dipRad = dipDeg * Math.PI / 180;
    const downDipOffset = alongDip * Math.cos(dipRad); // horizontal projection
    const depthKm = dMin + alongDip * Math.sin(dipRad) * (dMax - dMin) / (faultWidthKm * Math.sin(dipRad));

    // Map along-strike and cross-strike offsets to lat/lon
    const dLat = (alongStrike * Math.cos(strikeRad) + downDipOffset * Math.sin(strikeRad)) * kmToDeg;
    const dLon = (-alongStrike * Math.sin(strikeRad) + downDipOffset * Math.cos(strikeRad)) * kmToDeg / Math.cos(p.lat * Math.PI / 180);

    // Add scatter (off-fault seismicity) — larger scatter for smaller events
    const scatter = (rng.nextGaussian()) * (mMax - mainMag + 2) * 0.3;
    const lat = p.lat + dLat + scatter * kmToDeg * 0.5;
    const lon = p.lon + dLon + scatter * kmToDeg * 0.5;

    // Gutenberg-Richter magnitude distribution
    const mag = gutenbergRichter(mMin, Math.min(mMax - 1.2, mainMag), rng);
    const depth = Math.max(dMin, Math.min(dMax, depthKm));

    const pt = geoToSphere(lat, lon, depth);
    cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
  }

  // Add P-wave and S-wave propagation rings as surface points
  // (represented as very shallow points that expand outward)
  const avgDepth = (dMin + dMax) / 2;
  const numWavefronts = Math.min(5, Math.floor(p.numEvents / 10) + 1);
  for (let w = 0; w < numWavefronts; w++) {
    const waveRadiusKm = (w + 1) * faultLengthKm * 0.3;
    const waveRadiusDeg = waveRadiusKm * kmToDeg;
    const numPts = Math.floor(48 + w * 12);
    for (let i = 0; i < numPts; i++) {
      const angle = (i / numPts) * 2 * Math.PI;
      // Slight elliptical distortion due to anisotropy
      const rx = waveRadiusDeg * (1 + 0.15 * Math.cos(2 * angle - strikeDeg * Math.PI / 180));
      const ry = waveRadiusDeg * (1 - 0.1 * Math.cos(2 * angle - strikeDeg * Math.PI / 180));
      const lat = p.lat + ry * Math.cos(angle);
      const lon = p.lon + rx * Math.sin(angle) / Math.cos(p.lat * Math.PI / 180);
      // Shallow surface representation
      const pt = geoToSphere(lat, lon, 0.5, 'depth');
      cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
    }
  }

  return cloud;
}

function gutenbergRichter(mMin: number, mMax: number, rng: SeededRNG, b = 1.0): number {
  const u = rng.next();
  return mMin - (1 / b) * Math.log10(1 - u * (1 - 10 ** (-b * (mMax - mMin))));
}

function omoriDecay(index: number, total: number, windowHours: number, model: string): number {
  const t = (index / Math.max(1, total)) * windowHours;
  if (model === 'omori') return 1 / (1 + t * 0.1);
  if (model === 'exponential') return Math.exp(-t * 0.05);
  return 1 - t / windowHours;
}

/* ═════════════════════════════════════════════════════════════════
   2. HURRICANE LANDFALL — Rankine vortex + spiral rainbands
   
   Research basis:
   - Eye: calm center, 20-50km diameter
   - Eyewall: ring of maximum winds at RMW (radius of max winds)
   - Rainbands: logarithmic spiral arms curving inward
   - Wind profile: Rankine vortex (linear inner, 1/r outer decay)
   - Holland B parameter for pressure-wind relationship
   - Asymmetric wind field due to forward motion
   ═════════════════════════════════════════════════════════════════ */

function generateHurricaneLandfall(p: HurricaneLandfallParams): PointCloud {
  const rng = new SeededRNG(hashParams('hurricane', p));
  const cloud: PointCloud = [];
  const cat = Math.max(1, Math.min(5, p.category));
  const kmToDeg = 1 / 111;

  // Holland B parameter controls the "peakedness" of the wind profile
  // Higher B = more concentrated winds near eyewall
  const hollandB = 1.0 + 0.25 * cat;

  // Radius of maximum winds (RMW) — scales with category
  const rMaxKm = p.radius * (1 - cat * 0.05); // stronger storms = more compact
  const rOuterKm = rMaxKm * 5; // outer extent of gale-force winds

  // Maximum sustained wind from Saffir-Simpson
  const vMaxKt = [33, 43, 50, 58, 64, 70, 77][Math.min(cat, 6)] || 50;

  // === EYE ===
  // A few points at dead center with zero wind (calm eye)
  const eyeRadiusKm = rMaxKm * 0.15;
  const numEyePts = 8;
  for (let i = 0; i < numEyePts; i++) {
    const angle = (i / numEyePts) * 2 * Math.PI;
    const r = eyeRadiusKm * rng.next() * kmToDeg;
    const lat = p.lat + r * Math.cos(angle);
    const lon = p.lon + r * Math.sin(angle) / Math.cos(p.lat * Math.PI / 180);
    const pt = geoToSphere(lat, lon, 0, 'height');
    cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
  }

  // === EYEWALL ===
  // Dense ring of maximum winds at RMW
  const numEyewallPts = Math.floor(60 + cat * 10);
  for (let i = 0; i < numEyewallPts; i++) {
    const angle = (i / numEyewallPts) * 2 * Math.PI;
    const rJitter = rMaxKm + rng.nextGaussian() * rMaxKm * 0.08;
    const r = rJitter * kmToDeg;
    const lat = p.lat + r * Math.cos(angle);
    const lon = p.lon + r * Math.sin(angle) / Math.cos(p.lat * Math.PI / 180);
    // Height represents wind intensity — eyewall has towering convection
    const cloudTopH = 14000 + cat * 2000; // 14-24 km cloud tops
    const pt = geoToSphere(lat, lon, cloudTopH * (0.7 + rng.next() * 0.3), 'height');
    cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
  }

  // === SPIRAL RAINBANDS ===
  // Logarithmic spiral arms: r = a * e^(b*theta)
  // b controls how tightly wound the spiral is
  const numBands = 3 + Math.floor(cat / 2); // 3-5 bands
  const spiralTightness = 0.15 + cat * 0.02; // tighter for stronger storms

  for (let band = 0; band < numBands; band++) {
    const bandPhase = (band / numBands) * Math.PI * 2; // offset each band
    const numBandPts = Math.floor(40 + cat * 8);

    for (let i = 0; i < numBandPts; i++) {
      const theta = bandPhase + (i / numBandPts) * Math.PI * 3; // 1.5 full spirals per band
      // Logarithmic spiral: distance from center increases with angle
      // Bounded spiral: grows from eyewall outward but capped at outer radius
      const r = Math.min(
        rOuterKm,
        rMaxKm * (0.3 + (i / numBandPts) * 4.5) * Math.exp(Math.min(spiralTightness * theta * 0.1, 2.0))
      );
      if (r > rOuterKm) continue;

      const rDeg = r * kmToDeg;
      const lat = p.lat + rDeg * Math.cos(theta);
      const lon = p.lon + rDeg * Math.sin(theta) / Math.cos(p.lat * Math.PI / 180);

      // Rankine vortex: wind increases linearly to RMW, then decays as 1/r
      let windFraction: number;
      if (r <= rMaxKm) {
        windFraction = r / rMaxKm; // solid-body rotation inside eyewall
      } else {
        // Modified Rankine vortex with Holland B shape
        windFraction = Math.pow(rMaxKm / r, hollandB * 0.5);
      }

      // Add asymmetry: right side of storm (in Northern Hemisphere) is stronger
      // due to forward motion addition
      const asymmetry = 1 + 0.2 * Math.cos(theta - Math.PI / 4);
      windFraction *= asymmetry;

      const cloudH = windFraction * (12000 + cat * 1500);
      const jitter = rng.nextGaussian() * rMaxKm * 0.1 * kmToDeg;
      const pt = geoToSphere(lat + jitter, lon + jitter, cloudH * (0.5 + rng.next() * 0.5), 'height');
      cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
    }
  }

  // === OUTFLOW LAYER ===
  // Upper-level anticyclonic outflow (spreading outward at tropopause)
  const numOutflowPts = Math.floor(20 + cat * 5);
  for (let i = 0; i < numOutflowPts; i++) {
    const angle = (i / numOutflowPts) * 2 * Math.PI;
    const r = rOuterKm * (0.5 + rng.next() * 0.8) * kmToDeg;
    const lat = p.lat + r * Math.cos(angle);
    const lon = p.lon + r * Math.sin(angle) / Math.cos(p.lat * Math.PI / 180);
    // Outflow at ~15km altitude, anticyclonic (opposite rotation)
    const pt = geoToSphere(lat, lon, 15000 + rng.next() * 3000, 'height');
    cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
  }

  return cloud;
}

/* ═════════════════════════════════════════════════════════════════
   3. WILDFIRE SPREAD — Wind-driven ellipse + spotting + terrain
   
   Research basis (Rothermel model, FARSITE):
   - Fire spreads as an ellipse, elongated downwind
   - Head fire (downwind) spreads fastest
   - Flank fires spread slower, rear fire slowest
   - Slope steepens the ellipse in the uphill direction
   - Spot fires: burning embers lofted ahead of front
   - Fire intensity decreases from head to rear
   ═════════════════════════════════════════════════════════════════ */

function generateWildfireSpread(p: WildfireSpreadParams): PointCloud {
  const rng = new SeededRNG(hashParams('wildfire', p));
  const cloud: PointCloud = [];
  const windRad = p.windDir * Math.PI / 180;
  const kmToDeg = 1 / 111;

  // Fuel-type based spread characteristics
  const fuelFactors: Record<string, number> = { grass: 3.0, forest: 0.5, shrub: 1.2, urban: 0.2 };
  const baseROS = (fuelFactors[p.fuelType] || 1.0) * (1 + 0.5 * Math.sqrt(Math.max(0, p.windSpeed))) * Math.max(0.05, 1 - p.humidity / 100);

  // Maximum spread distance in km
  const maxSpreadKm = baseROS * p.duration * 0.001;

  // Ellipse parameters based on Rothermel/FARSITE
  // Eccentricity: how elongated the ellipse is (0=circle, 1=line)
  // Strong wind = high eccentricity (long narrow ellipse)
  const eccentricity = Math.min(0.85, 0.2 + p.windSpeed * 0.01);
  const semiMajorAxis = maxSpreadKm; // downwind length
  const semiMinorAxis = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity) * 0.6; // crosswind width

  // === FIRE FRONT (active burning edge) ===
  // FARSITE-style ellipse: ignition at rear focus, head at downwind end
  // The ellipse equation r = semiMinorAxis / (1 - e*cos(θ)) is centered
  // at the origin. To place ignition at the rear focus, shift by -ae
  // in the upwind direction (opposite to wind).
  const focalShift = eccentricity * semiMajorAxis; // distance from center to focus
  const upwindShiftLat = -focalShift * kmToDeg * Math.cos(windRad); // opposite to wind
  const upwindShiftLon = -focalShift * kmToDeg * Math.sin(windRad) / Math.cos(p.lat * Math.PI / 180);

  const numFrontPts = 80;
  for (let i = 0; i < numFrontPts; i++) {
    const angle = (i / numFrontPts) * 2 * Math.PI;

    // Standard polar ellipse centered at origin
    const r = semiMinorAxis / (1 - eccentricity * Math.cos(angle));
    const rDeg = r * kmToDeg;

    // Rotate ellipse so major axis aligns with wind direction
    // Then shift so ignition point (rear focus) is at p.lat/p.lon
    const lat = p.lat + rDeg * Math.cos(angle + windRad) - upwindShiftLat;
    const lon = p.lon + rDeg * Math.sin(angle + windRad) / Math.cos(p.lat * Math.PI / 180) - upwindShiftLon;

    // Intensity: highest at head (downwind), lowest at rear
    const angleFromWind = angle; // 0 = directly downwind
    const intensity = 0.3 + 0.7 * Math.max(0, Math.cos(angleFromWind));

    const pt = geoToSphere(lat, lon, intensity * 500, 'height');
    cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
  }

  // === BURNED AREA (interior points) ===
  const numInteriorPts = Math.floor(p.area / 15);
  for (let i = 0; i < numInteriorPts; i++) {
    const angle = rng.next() * 2 * Math.PI;
    const frac = Math.sqrt(rng.next()); // uniform distribution in ellipse
    const r = semiMinorAxis / (1 - eccentricity * Math.cos(angle)) * frac;
    const rDeg = r * kmToDeg;

    // Same shift as front: ignition at rear focus
    const lat = p.lat + rDeg * Math.cos(angle + windRad) - upwindShiftLat;
    const lon = p.lon + rDeg * Math.sin(angle + windRad) / Math.cos(p.lat * Math.PI / 180) - upwindShiftLon;

    // Intensity decreases from head to rear
    const angleFromWind = angle;
    const intensity = 0.1 + 0.4 * Math.max(0, Math.cos(angleFromWind));

    const pt = geoToSphere(lat, lon, intensity * 200, 'height');
    cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
  }

  // === SPOT FIRES ===
  // Burning embers lofted ahead of the main fire front
  const numSpots = Math.floor(5 + p.windSpeed * 0.3);
  for (let i = 0; i < numSpots; i++) {
    const spotDistKm = maxSpreadKm * (1 + 0.3 * rng.next()); // ahead of main front
    const spotAngle = windRad + rng.nextGaussian() * 0.4; // slight scatter
    const spotR = spotDistKm * kmToDeg;

    const lat = p.lat + spotR * Math.cos(spotAngle);
    const lon = p.lon + spotR * Math.sin(spotAngle) / Math.cos(p.lat * Math.PI / 180);

    // Spot fires are small, intense ignition points
    const pt = geoToSphere(lat, lon, 800 + rng.next() * 400, 'height');
    cloud.push({ x: pt[0], y: pt[1], z: pt[2] });

    // Small ellipse around each spot fire
    const spotRadiusKm = 0.5 + rng.next() * 1;
    const numSpotPts = 12;
    for (let j = 0; j < numSpotPts; j++) {
      const a = (j / numSpotPts) * 2 * Math.PI;
      const sr = spotRadiusKm * (0.5 + 0.5 * Math.cos(a - windRad)) * kmToDeg;
      const sLat = lat + sr * Math.cos(a);
      const sLon = lon + sr * Math.sin(a) / Math.cos(lat * Math.PI / 180);
      const spt = geoToSphere(sLat, sLon, 300 + rng.next() * 200, 'height');
      cloud.push({ x: spt[0], y: spt[1], z: spt[2] });
    }
  }

  return cloud;
}

/* ═════════════════════════════════════════════════════════════════
   4. VOLCANIC ERUPTION — Eruption column + ash fallout + lava flows
   
   Research basis:
   - Eruption column: gas thrust → convective thrust → umbrella cloud
   - Ash fallout: exponential decay with distance, elliptical downwind
   - Lava flows: gravity-driven, follow terrain depressions
   - Pyroclastic flows: ground-hugging, fast, slope-following
   - VEI controls column height and total ejecta volume
   ═════════════════════════════════════════════════════════════════ */

function generateVolcanicEruption(p: VolcanicEruptionParams): PointCloud {
  const rng = new SeededRNG(hashParams('volcanic', p));
  const cloud: PointCloud = [];
  const windRad = p.windDir * Math.PI / 180;
  const kmToDeg = 1 / 111;

  // VEI-based parameters
  const veiFactors = [
    { colHeight: 1000, ejectaVol: 1e4, lavaRange: 5 },   // VEI 0
    { colHeight: 3000, ejectaVol: 1e6, lavaRange: 10 },   // VEI 1
    { colHeight: 5000, ejectaVol: 1e7, lavaRange: 15 },   // VEI 2
    { colHeight: 10000, ejectaVol: 1e8, lavaRange: 20 },  // VEI 3
    { colHeight: 15000, ejectaVol: 1e9, lavaRange: 30 },  // VEI 4
    { colHeight: 20000, ejectaVol: 1e10, lavaRange: 40 }, // VEI 5
    { colHeight: 25000, ejectaVol: 1e11, lavaRange: 60 }, // VEI 6
  ];
  const veiData = veiFactors[Math.min(p.vei, 6)];
  const maxColHeight = p.ashHeight > 0 ? p.ashHeight : veiData.colHeight;

  // === VENT POINT (at ground level) ===
  const ventPt = geoToSphere(p.lat, p.lon, 0, 'height');
  cloud.push({ x: ventPt[0], y: ventPt[1], z: ventPt[2] });

  // === ERUPTION COLUMN ===
  // Three regions: gas thrust (0-2km), convective (2-10km), umbrella (>10km)
  const numColumnPts = Math.floor(100 + p.vei * 80);

  // Gas thrust region: dense, narrow column near vent (20% of points)
  const gasThrustCount = Math.round(numColumnPts * 0.2);
  for (let i = 0; i < gasThrustCount; i++) {
    const h = rng.next() * 2000; // 0-2 km
    const spread = h * 0.0003; // narrow column
    const lat = p.lat + rng.nextGaussian() * spread;
    const lon = p.lon + rng.nextGaussian() * spread;
    const pt = geoToSphere(lat, lon, h, 'height');
    cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
  }

  // Convective region: entrainment widens the column (30% of points)
  const convectiveCount = Math.round(numColumnPts * 0.3);
  for (let i = 0; i < convectiveCount; i++) {
    const h = 2000 + rng.next() * (maxColHeight * 0.5);
    const spread = 0.002 + (h / maxColHeight) * 0.02;
    const lat = p.lat + rng.nextGaussian() * spread;
    const lon = p.lon + rng.nextGaussian() * spread;
    const pt = geoToSphere(lat, lon, h, 'height');
    cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
  }

  // Umbrella cloud: spreads laterally at neutral buoyancy
  const umbrellaRadiusKm = 2 + p.vei * 3;
  const numUmbrellaPts = Math.floor(150 + p.vei * 60);
  for (let i = 0; i < numUmbrellaPts; i++) {
    const angle = rng.next() * 2 * Math.PI;
    const r = Math.sqrt(rng.next()) * umbrellaRadiusKm * kmToDeg;
    const lat = p.lat + r * Math.cos(angle);
    const lon = p.lon + r * Math.sin(angle) / Math.cos(p.lat * Math.PI / 180);
    const h = maxColHeight * (0.85 + rng.next() * 0.15); // near top of column
    const pt = geoToSphere(lat, lon, h, 'height');
    cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
  }

  // === ASH FALLOUT (downwind ellipse) ===
  // Gaussian plume model: concentration decreases exponentially with distance
  // Elliptical pattern due to wind transport
  const ashMaxRangeKm = veiData.ejectaVol > 1e8 ? 200 : veiData.ejectaVol > 1e6 ? 80 : 30;
  const numAshPts = Math.floor(200 + p.vei * 100);
  for (let i = 0; i < numAshPts; i++) {
    // Exponential decay with distance
    const distFrac = rng.next();
    const distKm = ashMaxRangeKm * distFrac * distFrac; // concentrated near source
    const distDeg = distKm * kmToDeg;

    // Elliptical distribution (wider perpendicular to wind)
    const crossWind = rng.nextGaussian() * distKm * 0.3 * kmToDeg;
    const alongWind = distDeg;

    const lat = p.lat + alongWind * Math.cos(windRad) + crossWind * Math.cos(windRad + Math.PI / 2);
    const lon = p.lon + (alongWind * Math.sin(windRad) + crossWind * Math.sin(windRad + Math.PI / 2)) / Math.cos(p.lat * Math.PI / 180);

    // Ash settles to ground level — represent as surface points
    // with decreasing "thickness" (encoded as height for visibility)
    const ashThickness = maxColHeight * 0.1 * Math.exp(-distKm / (ashMaxRangeKm * 0.3));
    const pt = geoToSphere(lat, lon, ashThickness * 0.01, 'height');
    cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
  }

  // === LAVA FLOWS ===
  // 2-4 flow lobes emanating from vent, following steepest descent
  if (p.vei <= 4) {
    const numLavaFlows = 2 + Math.floor(rng.next() * 3);
    for (let f = 0; f < numLavaFlows; f++) {
      const flowAngle = (f / numLavaFlows) * 2 * Math.PI + rng.nextGaussian() * 0.5;
      const flowLengthKm = veiData.lavaRange * (0.5 + rng.next() * 0.5);
      const numFlowPts = 30;

      for (let i = 0; i < numFlowPts; i++) {
        const frac = i / numFlowPts;
        const distKm = flowLengthKm * frac;
        const distDeg = distKm * kmToDeg;

        // Lava widens as it flows (like a real lava flow)
        const width = 0.1 + frac * 0.5; // km
        const lateralOffset = rng.nextGaussian() * width * kmToDeg;

        const lat = p.lat + distDeg * Math.cos(flowAngle) + lateralOffset * Math.cos(flowAngle + Math.PI / 2);
        const lon = p.lon + (distDeg * Math.sin(flowAngle) + lateralOffset * Math.sin(flowAngle + Math.PI / 2)) / Math.cos(p.lat * Math.PI / 180);

        // Temperature gradient: hot at vent, cooling with distance
        const temp = 1 - frac * 0.7;
        const pt = geoToSphere(lat, lon, temp * 100, 'height');
        cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
      }
    }
  }

  // === PYROCLASTIC FLOWS (VEI >= 3) ===
  // Ground-hugging density currents that follow slopes
  if (p.vei >= 3) {
    const numPDCFlows = 2 + Math.floor(rng.next() * 2);
    for (let f = 0; f < numPDCFlows; f++) {
      const flowAngle = (f / numPDCFlows) * 2 * Math.PI + rng.nextGaussian() * 0.8;
      const flowLengthKm = 5 + p.vei * 3;
      const numPDCPts = 20;

      for (let i = 0; i < numPDCPts; i++) {
        const frac = i / numPDCPts;
        const distKm = flowLengthKm * frac;
        const distDeg = distKm * kmToDeg;

        const lat = p.lat + distDeg * Math.cos(flowAngle);
        const lon = p.lon + distDeg * Math.sin(flowAngle) / Math.cos(p.lat * Math.PI / 180);

        // PDC hugs ground, hot and dense
        const pt = geoToSphere(lat, lon, 50 * (1 - frac), 'height');
        cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
      }
    }
  }

  return cloud;
}

/* ═════════════════════════════════════════════════════════════════
   5. FLOOD INUNDATION — Dendritic river network + terrain-following
   
   Research basis:
   - Water follows topographic lows (D8 flow direction algorithm)
   - Flood extent is determined by Water Surface Elevation vs DEM
   - Depth greatest near channel, decreases with distance
   - Priority-Flood algorithm determines which cells inundate
   - Manning's equation for discharge calculation
   - Hydrograph for temporal evolution
   ═════════════════════════════════════════════════════════════════ */

function generateFloodInundation(p: FloodInundationParams): PointCloud {
  const rng = new SeededRNG(hashParams('flood', p));
  const cloud: PointCloud = [];
  const kmToDeg = 1 / 111;

  // Manning's equation for peak discharge
  const slope = 0.02;
  const roughness = 0.035;
  const runoffCoeff = 0.3 + p.soilSaturation * 0.5;
  const peakQ = runoffCoeff * p.rainfall * (p.catchmentArea / 1000);

  // Flood extent based on peak discharge
  const channelWidthKm = 0.5 + Math.sqrt(p.catchmentArea) * 0.01;
  const maxFloodExtentKm = Math.sqrt(p.catchmentArea / Math.PI) * 0.8;
  const waveCelerity = 2.5 + peakQ * 0.002;

  // === MAIN RIVER CHANNEL ===
  // Generate a sinuous river channel with meanders
  const riverLengthKm = maxFloodExtentKm * 2;
  const numRiverPts = 40;
  const meanderAmplitude = 0.3 + rng.next() * 0.2; // km
  const meanderFreq = 2 + rng.next() * 3;

  const riverPath: Array<{ lat: number; lon: number; width: number }> = [];
  for (let i = 0; i <= numRiverPts; i++) {
    const frac = i / numRiverPts;
    const distKm = riverLengthKm * (frac - 0.5);
    const distDeg = distKm * kmToDeg;

    // Sinuous path with meanders
    const meander = Math.sin(frac * Math.PI * meanderFreq) * meanderAmplitude * kmToDeg;
    const lat = p.lat + distDeg + meander;
    const lon = p.lon + rng.nextGaussian() * 0.005;

    // Channel width varies (wider downstream)
    const width = channelWidthKm * (0.5 + frac * 1.5);
    riverPath.push({ lat, lon, width });
  }

  // Add river channel points
  for (const pt of riverPath) {
    const numWidthPts = 8;
    for (let w = 0; w < numWidthPts; w++) {
      const offset = (w / numWidthPts - 0.5) * pt.width * kmToDeg;
      const spt = geoToSphere(pt.lat + offset, pt.lon, 0.5, 'height');
      cloud.push({ x: spt[0], y: spt[1], z: spt[2] });
    }
  }

  // === FLOODPLAIN INUNDATION ===
  // Water spreads from river banks into low-lying areas
  // Uses dendritic branching pattern (not radial!)
  const numBranches = 4 + Math.floor(rng.next() * 4);
  const numFloodPts = Math.min(Math.floor(p.catchmentArea / 20), 1200);

  for (let i = 0; i < numFloodPts; i++) {
    // Pick a random point along the river
    const riverIdx = Math.floor(rng.next() * riverPath.length);
    const riverPt = riverPath[riverIdx];

    // Branch direction: perpendicular to river with some downstream bias
    const branchAngle = (rng.next() - 0.5) * Math.PI; // ±90° from river
    // Branch length: random with slight downstream bias (wider floodplain downstream)
    const branchLengthKm = maxFloodExtentKm * (0.3 + 0.7 * Math.pow(rng.next(), 0.7) * (0.5 + 0.5 * riverIdx / riverPath.length));
    const branchDistDeg = branchLengthKm * kmToDeg;

    // Dendritic sub-branches: water finds lowest path
    const numSubBranches = 2 + Math.floor(rng.next() * 3);
    for (let b = 0; b < numSubBranches; b++) {
      const subAngle = branchAngle + (rng.next() - 0.5) * 0.8;
      const subDist = branchDistDeg * (0.3 + rng.next() * 0.7);

      const lat = riverPt.lat + subDist * Math.cos(subAngle);
      const lon = riverPt.lon + subDist * Math.sin(subAngle) / Math.cos(p.lat * Math.PI / 180);

      // Depth decreases with distance from river (Priority-Flood logic)
      const distFromRiver = subDist / branchDistDeg;
      const depth = 1 - distFromRiver * 0.8;

      if (depth > 0.1) {
        const spt = geoToSphere(lat, lon, depth * 2, 'height');
        cloud.push({ x: spt[0], y: spt[1], z: spt[2] });
      }
    }
  }

  // === FLOOD EDGE (highest points, lowest depth) ===
  // Water fills lowest elevations first — simulate with concentric rings
  // that follow dendritic pattern
  const numEdgePts = 60;
  for (let i = 0; i < numEdgePts; i++) {
    const angle = (i / numEdgePts) * 2 * Math.PI;
    // Non-circular: elongated along river direction
    const r = maxFloodExtentKm * kmToDeg * (0.5 + 0.5 * Math.abs(Math.cos(angle - Math.PI / 4)));
    const lat = p.lat + r * Math.cos(angle);
    const lon = p.lon + r * Math.sin(angle) / Math.cos(p.lat * Math.PI / 180);
    const spt = geoToSphere(lat, lon, 0.1, 'height');
    cloud.push({ x: spt[0], y: spt[1], z: spt[2] });
  }

  return cloud;
}

/* ═════════════════════════════════════════════════════════════════
   6. TSUNAMI WAVE — Directional propagation + coastal inundation
   
   Research basis:
   - Source geometry determines directivity (fault line = elongated source)
   - Wave speed v = sqrt(g * d) where d = ocean depth
   - Refraction bends waves toward shallower water (focusing)
   - Shoaling increases wave height as depth decreases
   - Coastal inundation follows lowest-lying coastal terrain
   - Run-up height depends on slope and wave energy
   ═════════════════════════════════════════════════════════════════ */

function generateTsunamiWave(p: TsunamiWaveParams): PointCloud {
  const rng = new SeededRNG(hashParams('tsunami', p));
  const cloud: PointCloud = [];
  const kmToDeg = 1 / 111;

  // Shallow water wave speed: v = sqrt(g * d)
  const oceanDepthM = p.depth * 1000;
  const c = Math.sqrt(9.81 * oceanDepthM); // m/s
  const cKmh = c * 3.6;

  // Source directivity: energy is concentrated perpendicular to fault
  // For a subduction zone earthquake, the fault runs roughly parallel to the trench
  const faultStrikeDeg = rng.next() * 360; // random fault orientation
  const directivityAngle = faultStrikeDeg + 90; // perpendicular to fault = max energy

  // === EPICENTER POINT ===
  const epicPt = geoToSphere(p.epicenterLat, p.epicenterLon, 0, 'height');
  cloud.push({ x: epicPt[0], y: epicPt[1], z: epicPt[2] });

  // === WAVE PROPAGATION RINGS ===
  // Multiple wave crests radiating outward
  // Energy is concentrated in the directivity direction
  const numRings = Math.min(p.arrivalTimes.length + 2, 8);
  const maxRadiusKm = cKmh * 3; // 3 hours of propagation

  for (let ring = 0; ring < numRings; ring++) {
    const arrivalMin = p.arrivalTimes[ring] || (ring + 1) * 15;
    const waveRadiusKm = cKmh * (arrivalMin / 60);
    const waveRadiusDeg = waveRadiusKm * kmToDeg;

    // Wave amplitude decreases with distance (spherical spreading + friction)
    const amplitude = p.waveHeight * Math.exp(-waveRadiusKm * 0.003);

    // Directivity: amplitude varies with angle relative to fault
    const numWavePts = 72;
    for (let i = 0; i < numWavePts; i++) {
      const angle = (i / numWavePts) * 2 * Math.PI;

      // Energy directivity: stronger in directivity direction
      const angleDiff = Math.abs(angle - directivityAngle * Math.PI / 180);
      const directivity = 0.6 + 0.4 * Math.cos(angleDiff);

      // Refraction effect: waves bend toward shallow water
      // Simulate by slightly reducing radius in coastal directions
      const refraction = 1 - 0.1 * Math.sin(angle * 2 + faultStrikeDeg * Math.PI / 180);

      const r = waveRadiusDeg * refraction;
      const lat = p.epicenterLat + r * Math.cos(angle);
      const lon = p.epicenterLon + r * Math.sin(angle) / Math.cos(p.epicenterLat * Math.PI / 180);

      const pt = geoToSphere(lat, lon, amplitude * directivity * 3, 'height');
      cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
    }
  }

  // === COASTAL INUNDATION ===
  // Simulate wave run-up along nearby coastlines
  // Concentrate points in the directivity direction (energy-focused)
  const numCoastalPts = 100;
  const directivityRad = directivityAngle * Math.PI / 180;
  for (let i = 0; i < numCoastalPts; i++) {
    // Non-uniform angular distribution: more points near directivity direction
    // Use von Mises-like concentration
    const baseAngle = (i / numCoastalPts) * 2 * Math.PI;
    const angleDiff = baseAngle - directivityRad;
    const concentration = Math.max(0.1, 0.4 + 0.6 * Math.cos(angleDiff)); // clamped to 0.1-1.0
    const angle = directivityRad + angleDiff * concentration; // pull toward directivity

    // Inundation extent: strongly biased toward directivity direction
    const angleToDirectivity = Math.abs(angle - directivityRad);
    const inundationFactor = Math.pow(Math.max(0, Math.cos(angleToDirectivity)), 1.5); // sharper focus

    // Distance inland: typically 1-5 km for a major tsunami
    const inlandKm = (2 + p.waveHeight * 0.3) * inundationFactor;
    const distFromShore = 5 + rng.next() * 10; // km from epicenter to shore

    const shoreLat = p.epicenterLat + distFromShore * kmToDeg * Math.cos(angle);
    const shoreLon = p.epicenterLon + distFromShore * kmToDeg * Math.sin(angle) / Math.cos(p.epicenterLat * Math.PI / 180);

    // Points along the inundation path (from shore inland)
    const numInundPts = 6;
    for (let j = 0; j < numInundPts; j++) {
      const inlandFrac = j / numInundPts;
      const inlandDist = inlandKm * inlandFrac * kmToDeg;

      const lat = shoreLat + inlandDist * Math.cos(angle);
      const lon = shoreLon + inlandDist * Math.sin(angle) / Math.cos(p.epicenterLat * Math.PI / 180);

      // Water depth decreases inland (exponential decay)
      const depth = p.waveHeight * inundationFactor * Math.exp(-inlandFrac * 2);
      const pt = geoToSphere(lat, lon, depth * 2, 'height');
      cloud.push({ x: pt[0], y: pt[1], z: pt[2] });
    }
  }

  return cloud;
}

/* ═════════════════════════════════════════════════════════════════
   UTILITY
   ═════════════════════════════════════════════════════════════════ */

function hashParams(type: string, params: object): number {
  let hash = 0;
  const str = type + JSON.stringify(params);
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) + 1;
}
