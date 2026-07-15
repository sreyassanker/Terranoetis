import type { Affiliation } from '../militarySymbology';

/* ═══════════════════════════════════════════════════════════════════
   Air Defense / Missile Warning Type Definitions
   Models ballistic trajectory prediction, impact point estimation,
   IAMD (Integrated Air and Missile Defense), and threat tiers.
   ═══════════════════════════════════════════════════════════════════ */

export type MissileType = 'ballistic' | 'cruise' | 'hypersonic' | 'srbm' | 'mrbm' | 'icbm' | 'anti_ship' | 'surface_to_air' | 'uav';

export type ThreatTier = 'outer' | 'mid' | 'inner' | 'point';

export type InterceptStatus = 'tracking' | 'launched' | 'intercept' | 'miss' | 'kill' | 'expired';

export interface MissileTrack {
  id: string;
  name: string;
  type: MissileType;
  affiliation: Affiliation;
  lat: number;
  lon: number;
  alt: number;
  speed: number;
  heading: number;
  /** Launch point estimate */
  launchLat?: number;
  launchLon?: number;
  /** Predicted impact point */
  impactLat?: number;
  impactLon?: number;
  /** Time to impact in seconds */
  timeToImpact?: number;
  /** Trajectory points for rendering */
  trajectory: Array<{ lat: number; lon: number; alt: number; time: number }>;
  /** Confidence 0-1 */
  confidence: number;
  detectedAt: number;
  lastUpdate: number;
  /** Radar cross section estimate */
  rcs?: number;
}

export interface Interceptor {
  id: string;
  name: string;
  /** Tier this interceptor operates in */
  tier: ThreatTier;
  /** Max range in meters */
  maxRange: number;
  /** Max altitude in meters */
  maxAltitude: number;
  /** Speed in Mach */
  machSpeed: number;
  /** Kill probability */
  pk: number;
  /** Quantity available */
  quantity: number;
  /** Platform lat/lon */
  lat?: number;
  lon?: number;
  status: 'ready' | 'engaged' | 'depleted' | 'maintenance';
  /** Missile type this interceptor can engage */
  canEngage: MissileType[];
}

export interface InterceptAttempt {
  id: string;
  missileTrackId: string;
  interceptorId: string;
  interceptorName: string;
  /** Predicted Intercept Point (PIP) */
  pipLat: number;
  pipLon: number;
  pipAlt: number;
  /** Launch time */
  launchedAt: number;
  /** Expected intercept time */
  expectedInterceptTime: number;
  /** Actual result */
  status: InterceptStatus;
  /** Result timestamp */
  resultAt?: number;
  /** Tier of engagement */
  tier: ThreatTier;
}

export interface AirDefenseZone {
  id: string;
  name: string;
  tier: ThreatTier;
  positions: Array<{ lat: number; lon: number }>;
  /** Interceptor IDs assigned to this zone */
  interceptorIds: string[];
  active: boolean;
}

/** IAMD status summary */
export interface IamdStatus {
  trackingCount: number;
  activeIntercepts: number;
  readyInterceptors: number;
  depletedInterceptors: number;
  outerTierCoverage: boolean;
  midTierCoverage: boolean;
  innerTierCoverage: boolean;
  lastScanTime: number;
}
