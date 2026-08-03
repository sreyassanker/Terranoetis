export interface Point3D {
  /**
   * Cartesian coordinates on the **unit sphere** in geodetic space:
   * `z === sin(lat)` and `x,y` encode longitude. Producers MUST normalize so
   * `|(x,y,z)| === 1`; `ScenarioViewer.renderPointCloud` assumes this and
   * projects back via `asin(z / r)` / `atan2(y, x)`.
   */
  x: number;
  y: number;
  z: number;
}

export interface ScenarioLocation {
  lat: number;
  lon: number;
}

export type ShapeType =
  | 'polygon' | 'cylinder' | 'corridor' | 'ellipse' | 'polyline' | 'ring'
  | 'flood_surface' | 'wavefront' | 'intensity_zone' | 'damage_zone' | 'liquefaction_zone';

interface BaseShapeData {
  type: ShapeType;
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

interface PolygonShapeData extends Omit<BaseShapeData,'type'> {
  type: 'polygon';
}

interface CorridorShapeData extends Omit<BaseShapeData,'type'> {
  type: 'corridor';
}

interface PolylineShapeData extends Omit<BaseShapeData,'type'> {
  type: 'polyline';
}

interface EllipseShapeData extends Omit<BaseShapeData,'type'> {
  type: 'ellipse';
}

interface RingShapeData extends Omit<BaseShapeData,'type'> {
  type: 'ring';
}

interface CylinderShapeData extends Omit<BaseShapeData,'type'> {
  type: 'cylinder';
}

interface FloodSurfaceShapeData extends Omit<BaseShapeData,'type'> {
  type: 'flood_surface';
}

interface WavefrontShapeData extends Omit<BaseShapeData,'type'> {
  type: 'wavefront';
}

interface IntensityZoneShapeData extends Omit<BaseShapeData,'type'> {
  type: 'intensity_zone';
}

interface DamageZoneShapeData extends Omit<BaseShapeData,'type'> {
  type: 'damage_zone';
}

interface LiquefactionZoneShapeData extends Omit<BaseShapeData,'type'> {
  type: 'liquefaction_zone';
}

/**
 * Discriminated union on `type` — consumers can narrow on `shape.type` to get
 * type-safe access to the per-shape fields. Unknown / server-produced shapes
 * may still need casts.
 */
export type ShapeData =
  | PolygonShapeData
  | CorridorShapeData
  | PolylineShapeData
  | EllipseShapeData
  | RingShapeData
  | CylinderShapeData
  | FloodSurfaceShapeData
  | WavefrontShapeData
  | IntensityZoneShapeData
  | DamageZoneShapeData
  | LiquefactionZoneShapeData;

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
  landslide: 'Landslide',
  data_layer: 'Data Layer',
};

export const SCENARIO_TYPE_COLORS: Record<string, string> = {
  earthquake_swarm: '#ef4444',
  hurricane_landfall: '#f59e0b',
  wildfire_spread: '#ff6b35',
  volcanic_eruption: '#d946ef',
  flood_inundation: '#3b82f6',
  tsunami_wave: '#06b6d4',
  landslide: '#78350f',
  data_layer: '#10b981',
};
