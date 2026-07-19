export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface ScenarioLocation {
  lat: number;
  lon: number;
}

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
  /** Water depth at each vertex (meters) — used for depth-based coloring */
  depths?: number[];
  /** Maximum flood depth for color scale normalization */
  maxDepth?: number;
  /** Water surface elevation in meters above ground */
  waterElevation?: number;
  /** Wave type for wavefront: 'P' | 'S' | 'Rayleigh' | 'Love' */
  waveType?: string;
  /** Wave speed in km/s for animation */
  waveSpeed?: number;
  /** Start time in hours for wave propagation */
  startTime?: number;
  /** MMI intensity value for intensity zones */
  mmi?: number;
  /** Damage percentage (0-100) for damage zones */
  damagePercent?: number;
  /** Liquefaction probability (0-1) */
  liquefactionProb?: number;
  /** Epicenter for wave calculations */
  epicenter?: { lat: number; lon: number };
  /** Event magnitude for wave amplitude scaling */
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
    type: string;
    params: Record<string, unknown>;
  };
}

export interface Scenario {
  id: string;
  type: string;
  name: string;
  pointCloud: Point3D[];
  validationScore: number;
  severity: string;
  location: ScenarioLocation;
  timestamp: string;
  metadata?: Record<string, unknown>;
  timeSeries?: ScenarioTimeSeries;
}

export interface ScenarioSummary {
  id: string;
  type: string;
  name: string;
  validationScore: number;
  severity: string;
  location: ScenarioLocation;
  timestamp: string;
  confidence: number;
  complexity: number;
  thumbnail?: string;
}


export const SCENARIO_TYPE_LABELS: Record<string, string> = {
  earthquake_swarm: 'Earthquake',
  hurricane_landfall: 'Hurricane',
  wildfire_spread: 'Wildfire',
  volcanic_eruption: 'Volcanic',
  flood_inundation: 'Flood',
  tsunami_wave: 'Tsunami',
  data_layer: 'Data Layer',
};

export const SCENARIO_TYPE_COLORS: Record<string, string> = {
  earthquake_swarm: '#ef4444',
  hurricane_landfall: '#f59e0b',
  wildfire_spread: '#ff6b35',
  volcanic_eruption: '#d946ef',
  flood_inundation: '#3b82f6',
  tsunami_wave: '#06b6d4',
  data_layer: '#10b981',
};
