import { type ScenarioBase } from './templates';

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: 'Point' | 'MultiPoint';
    coordinates: number[];
  };
  properties: Record<string, unknown>;
}

export interface GeoJSONCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

export function exportToGeoJSON(scenario: ScenarioBase): GeoJSONCollection {
  const features: GeoJSONFeature[] = scenario.pointCloud.map((p, i) => ({
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: [p.x, p.y, p.z],
    },
    properties: {
      index: i,
      scenarioId: scenario.id,
      scenarioType: scenario.type,
      ...scenario.params,
    },
  }));

  return { type: 'FeatureCollection', features };
}

export interface CZMLPacket {
  id: string;
  name?: string;
  description?: string;
  point?: {
    show: boolean;
    color?: { rgba: number[] };
    pixelSize?: number;
  };
  polygon?: {
    positions: { cartographicDegrees: number[] };
    material?: { solidColor: { color: { rgba: number[] } } };
    outline?: boolean;
    outlineColor?: { rgba: number[] };
  };
  availability?: string;
}

export function exportToCZML(scenario: ScenarioBase): CZMLPacket[] {
  const positions: number[] = [];
  scenario.pointCloud.slice(0, 500).forEach(p => {
    const lat = Math.asin(p.z) * (180 / Math.PI);
    const lon = Math.atan2(p.y, p.x) * (180 / Math.PI);
    const height = p.z * 1000;
    positions.push(lon, lat, height);
  });

  return [
    {
      id: 'document',
      name: `Scenario: ${scenario.id}`,
      version: '1.0',
    } as unknown as Record<string, unknown>,
    {
      id: scenario.id,
      name: `${scenario.type} — ${scenario.id}`,
      description: `Generated scenario of type ${scenario.type} with validation score ${scenario.validationScore.toFixed(2)}`,
      point: {
        show: true,
        color: { rgba: [255, 100, 50, 200] },
        pixelSize: 4,
      },
    },
    {
      id: `${scenario.id}_envelope`,
      polygon: {
        positions: { cartographicDegrees: positions },
        material: { solidColor: { color: { rgba: [255, 100, 50, 80] } } },
        outline: true,
        outlineColor: { rgba: [255, 50, 0, 200] },
      },
    },
  ];
}

export interface NetCDFVariable {
  name: string;
  dimensions: string[];
  values: number[];
  attributes: Record<string, unknown>;
}

export function exportToNetCDF(scenario: ScenarioBase): { dimensions: Record<string, number>; variables: NetCDFVariable[] } {
  const n = scenario.pointCloud.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  scenario.pointCloud.forEach((p, i) => { x[i] = p.x; y[i] = p.y; z[i] = p.z; });

  return {
    dimensions: { points: n, xyz: 3 },
    variables: [
      { name: 'x', dimensions: ['points'], values: Array.from(x), attributes: { units: 'normalized', long_name: 'X coordinate' } },
      { name: 'y', dimensions: ['points'], values: Array.from(y), attributes: { units: 'normalized', long_name: 'Y coordinate' } },
      { name: 'z', dimensions: ['points'], values: Array.from(z), attributes: { units: 'normalized', long_name: 'Z coordinate' } },
      { name: 'scenario_type', dimensions: [], values: [scenario.type.charCodeAt(0)], attributes: { description: scenario.type } },
      { name: 'validation_score', dimensions: [], values: [scenario.validationScore], attributes: { description: 'Validation confidence score' } },
    ],
  };
}

export interface TrainingRecord {
  features: number[];
  labels: number[];
  metadata: Record<string, unknown>;
}

export function exportToTrainingData(scenario: ScenarioBase): TrainingRecord {
  const features: number[] = [];
  const params = scenario.params as Record<string, unknown>;
  const numericValues = Object.values(params).filter(v => typeof v === 'number') as number[];
  features.push(...numericValues);
  features.push(scenario.pointCloud.length / 2000);
  features.push(scenario.validationScore);

  const centroid = scenario.pointCloud.reduce(
    (acc, p) => { acc.x += p.x; acc.y += p.y; acc.z += p.z; return acc; },
    { x: 0, y: 0, z: 0 },
  );
  const n = Math.max(1, scenario.pointCloud.length);
  features.push(centroid.x / n, centroid.y / n, centroid.z / n);

  const typeCodes: Record<string, number> = {
    earthquake_swarm: 0, hurricane_landfall: 1, wildfire_spread: 2,
    volcanic_eruption: 3, flood_inundation: 4, tsunami_wave: 5,
  };
  const labels = [typeCodes[scenario.type] ?? 0];

  return { features, labels, metadata: { id: scenario.id, type: scenario.type, createdAt: scenario.createdAt } };
}
