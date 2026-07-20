import type { Rectangle, Cartographic } from "cesium";

export const DisasterType = {
  Tsunami: "tsunami",
  Flood: "flood",
  Cyclone: "cyclone",
  Wildfire: "wildfire",
  Earthquake: "earthquake",
  Volcano: "volcano",
} as const;
export type DisasterType = typeof DisasterType[keyof typeof DisasterType];

export const LandCoverClass = {
  Water: 0, TreeCover: 1, Shrubland: 2, Grassland: 3, Cropland: 4,
  BuiltUp: 5, Bare: 6, SnowIce: 7, Wetland: 8, Mangrove: 9, Unknown: 255,
} as const;
export type LandCoverClass = typeof LandCoverClass[keyof typeof LandCoverClass];

export interface WeatherState {
  windSpeedMs: number;
  windDirectionDeg: number;
  temperatureC: number;
  relativeHumidityPct: number;
  precipitationMmHr: number;
  pressureHpa: number;
}

export interface HazardHistory {
  volcanoesWithin50Km: { name: string; lat: number; lon: number; elevationM: number }[];
  significantQuakesWithin100Km: { magnitude: number; depthKm: number; lat: number; lon: number; year: number }[];
  nearestFaultDistanceKm: number | null;
}

export interface EnvironmentSnapshot {
  rectangle: Rectangle;
  polygon: Cartographic[];
  gridWidth: number;
  gridHeight: number;
  cellSizeM: number;
  elevation: Float32Array;
  slopeDeg: Float32Array;
  aspectDeg: Float32Array;
  landCover: Uint8Array;
  insideMask: Uint8Array;
  riverMask: Uint8Array;
  flowDirection: Int8Array;
  flowAccumulation: Float32Array;
  weather: WeatherState;
  hazards: HazardHistory;
  stats: {
    minElevationM: number; maxElevationM: number; meanElevationM: number;
    oceanFraction: number;
    oceanConnected: boolean;
    vegetationFraction: number;
    urbanFraction: number;
    meanSlopeDeg: number;
    riverFraction: number;
    coastlineLengthM: number;
  };
}

export type ValidationStatus = "pass" | "warn" | "fail";

export interface ValidationCheck {
  id: string;
  label: string;
  status: ValidationStatus;
  detail: string;
  measured?: number | string;
}

export interface ValidationReport {
  disaster: DisasterType;
  feasible: boolean;
  checks: ValidationCheck[];
  summary: string;
}

export const SimPhase = {
  Initialization: "initialization",
  Growth: "growth",
  Peak: "peak",
  Decay: "decay",
  Recovery: "recovery",
} as const;
export type SimPhase = typeof SimPhase[keyof typeof SimPhase];

export interface SimFrame {
  timeS: number;
  phase: SimPhase;
  fields: Record<string, Float32Array>;
  entities: Record<string, Float64Array>;
  progress: number;
}


