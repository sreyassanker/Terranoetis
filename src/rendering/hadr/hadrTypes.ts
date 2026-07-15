export type HadrOperation = 'search_rescue' | 'relief_distribution' | 'medical' | 'evacuation' | 'infrastructure';
export type HadrSeverity = 'catastrophic' | 'severe' | 'moderate' | 'minor';

export interface HadrEvent {
  id: string;
  name: string;
  type: HadrOperation;
  lat: number;
  lon: number;
  severity: HadrSeverity;
  affected: number;
  timestamp: number;
  status: 'active' | 'planning' | 'completed';
}

export interface HadrAsset {
  id: string;
  name: string;
  type: string;
  lat: number;
  lon: number;
  capacity: number;
  utilization: number;
}

export interface HadrRoute {
  id: string;
  name: string;
  origin: {lat: number; lon: number};
  destination: {lat: number; lon: number};
  distance: number;
  status: 'open' | 'blocked' | 'restricted';
}

export interface HadrStatus {
  events: HadrEvent[];
  assets: HadrAsset[];
  routes: HadrRoute[];
  totalAffected: number;
  activeOperations: number;
}
