import { randomUUID } from 'crypto';
import { type PointCloud } from '../earthgen/flowMatching';
import { EarthGenModel } from '../earthgen/earthGen';
import { type ConditioningVector } from '../earthgen/conditioning';
import { type ScenarioType, type ScenarioParams, type ScenarioBase, type EarthquakeSwarmParams, type HurricaneLandfallParams, type WildfireSpreadParams, type VolcanicEruptionParams, type FloodInundationParams, type TsunamiWaveParams, DEFAULT_PARAMS } from './templates';
import { validateScenario } from './scenarioValidator';

const model = new EarthGenModel({
  latentDim: 128,
  numLatentTokens: 512,
  numHeads: 4,
  numLayers: 6,
  hiddenDim: 256,
  knn: 8,
  learningRate: 1e-3,
});

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

  const validation = validateScenario({ type, params, pointCloud } as any);
  const id = `scenario_${randomUUID().slice(0, 8)}`;

  return {
    id,
    type,
    params,
    pointCloud,
    validationScore: validation.confidence,
    createdAt: new Date().toISOString(),
    metadata: { validation },
  };
}

function generateEarthquakeSwarm(p: EarthquakeSwarmParams): PointCloud {
  const cloud: PointCloud = [];
  const [dMin, dMax] = p.depthRange;
  const [mMin, mMax] = p.magnitudeRange;

  for (let i = 0; i < p.numEvents; i++) {
    const mag = gutenbergRichter(mMin, mMax);
    const offsetDeg = mag * 0.08 + (Math.random() - 0.5) * 0.05;
    const angle = Math.random() * 2 * Math.PI;
    const lat = p.lat + offsetDeg * Math.cos(angle);
    const lon = p.lon + offsetDeg * Math.sin(angle);
    const depth = dMin + (dMax - dMin) * (1 - mag / mMax);
    const timeOffset = omoriDecay(i, p.numEvents, p.timeWindow, p.decayModel);

    const [x, y, z] = geoToSphere(lat, lon, depth);
    cloud.push({ x, y, z });
  }
  return cloud;
}

function gutenbergRichter(mMin: number, mMax: number): number {
  const b = 1.0;
  const u = Math.random();
  return mMin - (1 / b) * Math.log10(1 - u * (1 - 10 ** (-b * (mMax - mMin))));
}

function omoriDecay(index: number, total: number, windowHours: number, model: string): number {
  const t = (index / Math.max(1, total)) * windowHours;
  if (model === 'omori') return 1 / (1 + t * 0.1);
  if (model === 'exponential') return Math.exp(-t * 0.05);
  return 1 - t / windowHours;
}

function generateHurricaneLandfall(p: HurricaneLandfallParams): PointCloud {
  const cloud: PointCloud = [];
  const numRings = Math.min(p.category + 2, 7);
  const pointsPerRing = Math.min(36 + p.category * 12, 120);
  const rMax = p.radius * (1 + p.category * 0.15);

  for (let ring = 0; ring < numRings; ring++) {
    const ringRadius = rMax * (ring + 1) / numRings;
    const speed = saffirSimpsonWind(p.category, ringRadius / rMax);
    const n = Math.floor(pointsPerRing * (1 - ring * 0.1));

    for (let i = 0; i < n; i++) {
      const angle = (i / n) * 2 * Math.PI + (Math.random() - 0.5) * 0.2;
      const r = ringRadius + (Math.random() - 0.5) * (rMax / numRings) * 0.5;
      const lat = p.lat + r * 0.01 * Math.cos(angle);
      const lon = p.lon + r * 0.01 * Math.sin(angle);
      const z = speed / 200;

      const [x, y, zs] = geoToSphere(lat, lon, z * 10);
      cloud.push({ x, y, z: zs });
    }
  }
  return cloud;
}

function saffirSimpsonWind(category: number, rRatio: number): number {
  const maxWind = [33, 43, 50, 58, 64, 70, 77][Math.min(category, 6)] || 50;
  return maxWind * Math.exp(-rRatio * 0.5);
}

function generateWildfireSpread(p: WildfireSpreadParams): PointCloud {
  const cloud: PointCloud = [];
  const rate = rothermelSpreadRate(p.windSpeed, p.humidity, p.fuelType);
  const numPoints = Math.min(Math.floor(p.area / 10), 2000);
  const dt = p.duration / 100;

  for (let i = 0; i < numPoints; i++) {
    const t = i * dt + (Math.random() - 0.5) * dt;
    const spreadDist = rate * t * 0.001;
    const windRad = p.windDir * (Math.PI / 180);
    const angle = windRad + (Math.random() - 0.5) * Math.PI * 0.6;
    const lat = p.lat + spreadDist * Math.cos(angle);
    const lon = p.lon + spreadDist * Math.sin(angle);
    const intensity = 1 - spreadDist / (rate * p.duration * 0.001);

    const [x, y, z] = geoToSphere(lat, lon, intensity * 10);
    cloud.push({ x, y, z });
  }
  return cloud;
}

function rothermelSpreadRate(windSpeed: number, humidity: number, fuelType: string): number {
  const fuelFactors: Record<string, number> = { grass: 3.0, forest: 0.5, shrub: 1.2, urban: 0.2 };
  const base = fuelFactors[fuelType] || 1.0;
  const windFactor = 1 + windSpeed * 0.1;
  const humidityFactor = Math.max(0, 1 - humidity / 100);
  return base * windFactor * humidityFactor;
}

function generateVolcanicEruption(p: VolcanicEruptionParams): PointCloud {
  const cloud: PointCloud = [];
  const numPoints = Math.min(500 + p.vei * 300, 2000);
  const windRad = p.windDir * (Math.PI / 180);

  for (let i = 0; i < numPoints; i++) {
    const h = plumeriseHeight(p.vei, p.ashHeight) * (Math.random() * 0.5 + 0.5);
    const drift = (h / p.ashHeight) * 2 * (Math.random() - 0.5);
    const lat = p.lat + drift * Math.cos(windRad) * 0.01;
    const lon = p.lon + drift * Math.sin(windRad) * 0.01;
    const z = h * 0.001;

    const [x, y, zs] = geoToSphere(lat, lon, z);
    cloud.push({ x, y, z: zs });
  }
  return cloud;
}

function plumeriseHeight(vei: number, baseHeight: number): number {
  const veiFactor = [1000, 3000, 5000, 10000, 15000, 20000, 25000][Math.min(vei, 6)] || 5000;
  return baseHeight * (1 + Math.random() * 0.3) + veiFactor * (Math.random() + 0.5);
}

function generateFloodInundation(p: FloodInundationParams): PointCloud {
  const cloud: PointCloud = [];
  const numPoints = Math.min(Math.floor(p.catchmentArea / 50), 2000);
  const peakFlow = manningEquation(p.rainfall, p.catchmentArea, p.soilSaturation);

  for (let i = 0; i < numPoints; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const r = Math.sqrt(Math.random()) * Math.sqrt(p.catchmentArea / Math.PI) * 0.01;
    const lat = p.lat + r * Math.cos(angle);
    const lon = p.lon + r * Math.sin(angle);
    const t = i / numPoints;
    const depth = peakFlow * hydrograph(t, p.duration) * 0.01;

    const [x, y, z] = geoToSphere(lat, lon, depth);
    cloud.push({ x, y, z });
  }
  return cloud;
}

function manningEquation(rainfall: number, area: number, saturation: number): number {
  const runoffCoeff = 0.3 + saturation * 0.5;
  const Q = runoffCoeff * rainfall * (area / 1000);
  return Q;
}

function hydrograph(t: number, duration: number): number {
  return Math.sin((t * duration) / duration * Math.PI) * Math.exp(-t * 0.5);
}

function generateTsunamiWave(p: TsunamiWaveParams): PointCloud {
  const cloud: PointCloud = [];
  const numPoints = Math.min(500 + p.magnitude * 100, 2000);
  const g = 9.81;
  const c = Math.sqrt(g * p.depth * 1000);
  const shallowWaterSpeed = c * 3.6;

  for (let i = 0; i < numPoints; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const distKm = p.arrivalTimes[Math.floor(Math.random() * p.arrivalTimes.length)] * shallowWaterSpeed / 60;
    const offsetDeg = distKm / 111;
    const lat = p.epicenterLat + offsetDeg * Math.cos(angle);
    const lon = p.epicenterLon + offsetDeg * Math.sin(angle);
    const height = p.waveHeight * Math.exp(-offsetDeg * 0.05);

    const [x, y, z] = geoToSphere(lat, lon, height);
    cloud.push({ x, y, z });
  }
  return cloud;
}

function geoToSphere(lat: number, lon: number, depth: number): [number, number, number] {
  const latRad = lat * (Math.PI / 180);
  const lonRad = lon * (Math.PI / 180);
  const r = 1 - depth * 0.0001;
  return [
    r * Math.cos(latRad) * Math.cos(lonRad),
    r * Math.cos(latRad) * Math.sin(lonRad),
    r * Math.sin(latRad),
  ];
}
