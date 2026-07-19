export type ScenarioType = 'earthquake_swarm' | 'hurricane_landfall' | 'wildfire_spread' | 'volcanic_eruption' | 'flood_inundation' | 'tsunami_wave' | 'data_layer';

export interface Point3D { x: number; y: number; z: number }

export interface ShapeData {
  type: 'polygon' | 'cylinder' | 'corridor' | 'ellipse' | 'polyline' | 'ring' | 'flood_surface' | 'wavefront' | 'intensity_zone' | 'damage_zone' | 'liquefaction_zone';
  color: string;
  opacity: number;
  positions?: { lat: number; lon: number }[];
  center?: { lat: number; lon: number };
  radius?: number;
  innerRadius?: number;
  height?: number;
  extrudedHeight?: number;
  width?: number;
  semiMajorAxis?: number;
  semiMinorAxis?: number;
  rotation?: number;
  depths?: number[];
  maxDepth?: number;
  waterElevation?: number;
  waveType?: string;
  waveSpeed?: number;
  startTime?: number;
  mmi?: number;
  damagePercent?: number;
  liquefactionProb?: number;
  epicenter?: { lat: number; lon: number };
  magnitude?: number;
}

export interface TimeStep {
  time: number;
  points: Point3D[];
  shapes: ShapeData[];
  intensity: number[];
  label?: string;
}

export interface ScenarioTimeSeries {
  steps: TimeStep[];
  metadata: {
    duration: number;
    dt: number;
    type: ScenarioType;
    params: Record<string, unknown>;
  };
}

export interface ScenarioBase {
  id: string;
  type: ScenarioType;
  params: Record<string, unknown>;
  pointCloud: Point3D[];
  validationScore: number;
  createdAt: string;
  metadata: Record<string, unknown>;
  timeSeries?: ScenarioTimeSeries;
}

export interface EarthquakeSwarmParams {
  lat: number;
  lon: number;
  depthRange: [number, number];
  magnitudeRange: [number, number];
  numEvents: number;
  timeWindow: number;
  decayModel: 'omori' | 'exponential' | 'uniform';
}

export interface HurricaneLandfallParams {
  lat: number;
  lon: number;
  category: number;
  forwardSpeed: number;
  pressure: number;
  radius: number;
  landfallTime: number;
}

export interface WildfireSpreadParams {
  lat: number;
  lon: number;
  area: number;
  windSpeed: number;
  windDir: number;
  humidity: number;
  fuelType: 'grass' | 'forest' | 'shrub' | 'urban';
  duration: number;
}

export interface VolcanicEruptionParams {
  lat: number;
  lon: number;
  vei: number;
  ashHeight: number;
  windDir: number;
  duration: number;
}

export interface FloodInundationParams {
  lat: number;
  lon: number;
  rainfall: number;
  catchmentArea: number;
  soilSaturation: number;
  duration: number;
}

export interface TsunamiWaveParams {
  epicenterLat: number;
  epicenterLon: number;
  magnitude: number;
  depth: number;
  waveHeight: number;
  arrivalTimes: number[];
}

export type ScenarioParams = EarthquakeSwarmParams | HurricaneLandfallParams | WildfireSpreadParams | VolcanicEruptionParams | FloodInundationParams | TsunamiWaveParams;


export const DEFAULT_PARAMS: Record<ScenarioType, Record<string, unknown>> = {
  earthquake_swarm: {
    lat: 35.68, lon: 139.65, depthRange: [5, 30], magnitudeRange: [2.5, 5.5],
    numEvents: 50, timeWindow: 168, decayModel: 'omori',
  },
  hurricane_landfall: {
    lat: 25.0, lon: -80.0, category: 3, forwardSpeed: 15,
    pressure: 950, radius: 50, landfallTime: 24,
  },
  wildfire_spread: {
    lat: 38.5, lon: -121.5, area: 10000, windSpeed: 20,
    windDir: 270, humidity: 15, fuelType: 'forest', duration: 72,
  },
  volcanic_eruption: {
    lat: 19.4, lon: -155.2, vei: 3, ashHeight: 10000,
    windDir: 260, duration: 48,
  },
  flood_inundation: {
    lat: 29.5, lon: -95.0, rainfall: 500, catchmentArea: 2000,
    soilSaturation: 0.8, duration: 72,
  },
  tsunami_wave: {
    epicenterLat: 35.0, epicenterLon: 140.0, magnitude: 8.5,
    depth: 20, waveHeight: 15, arrivalTimes: [30, 45, 60, 90, 120],
  },
  data_layer: {
    variableName: '', pointCloud: [], bbox: { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 },
  },
};
