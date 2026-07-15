export type WmdType = 'nuclear' | 'chemical' | 'biological' | 'radiological';
export type DispersalModel = 'gaussian_plume' | 'gaussian_puff' | 'puff_train' | 'lagrangian_particle';

export interface NuclearEvent {
  id: string;
  name: string;
  type: WmdType;
  lat: number;
  lon: number;
  yield_kt?: number;
  height_burst?: number;
  timestamp: number;
  dispersalModel: DispersalModel;
}

export interface FalloutPlume {
  id: string;
  eventId: string;
  segments: Array<{
    lat: number;
    lon: number;
    radius: number;
    concentration: number;
    timeStep: number;
  }>;
  maxRange: number;
  windSpeed: number;
  windDirection: number;
}

export interface ContaminationZone {
  id: string;
  eventId: string;
  severity: 'immediate_danger' | 'emergency_protective' | 'protective_action' | 'monitoring'
  coordinates: Array<{lat: number; lon: number}>;
  doseRate: number;
}

export interface NuclearStatus {
  events: NuclearEvent[];
  plumes: FalloutPlume[];
  zones: ContaminationZone[];
  activeCount: number;
}
