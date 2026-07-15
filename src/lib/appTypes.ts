import * as Cesium from 'cesium';

export interface LayerItem {
  id: string; label: string; color: string; type: string;
  on: boolean; default: boolean; opacity: number;
  category: string; sub?: string; badge?: string;
}

export interface SeismicWaveData {
  id: number; lon: number; lat: number; aRadius: number;
  pStart: number; sStart: number; surfStart: number;
  pEnt: Cesium.Entity | null; sEnt: Cesium.Entity | null;
  surfEnt: Cesium.Entity | null; interval: ReturnType<typeof setInterval> | null;
}

export interface TimelineState {
  current: number; start: number; end: number;
  active: boolean; speed: number; interval: ReturnType<typeof setInterval> | null;
}

export interface IntelFeedItem {
  id: string; title: string; source: string; type: string;
  lat: number; lon: number; timestamp: number; timeLabel: string;
  desc?: string;
  url?: string;
  platform?: 'internal' | 'news' | 'twitter' | 'facebook' | 'social';
}

export interface HeatmapPoint { lon: number; lat: number; count: number; }

export interface CesiumWindow extends Window {
  Cesium?: typeof Cesium;
  __liveglobeDebug?: Record<string, unknown>;
}

export type AiProvider = 'gemini' | 'anthropic' | 'local';

export interface ApiVaultState {
  gemini: string;
  anthropic: string;
  cesiumIonAccessToken: string;
  sentinelHubClientId: string;
  sentinelHubClientSecret: string;
  marineTrafficApiKey: string;
  aisStreamApiKey: string;
  flightAwareAeroApiKey: string;
  airLabsApiKey: string;
  preferredAiProvider: AiProvider;
  vaultDismissed: boolean;
}

export interface LocalSearchResult {
  name: string;
  lat: number;
  lon: number;
}

export interface WeatherCardData {
  id: string;
  lat: number;
  lon: number;
  temp: number;
  humidity: number;
  windSpeed: number;
  pressure: number;
  precipitation: number;
  desc: string;
}

export interface CityData {
  name: string; country: string; pop: number; lat: number; lon: number;
}

export interface ExtraGeo {
  name: string; lat: number; lon: number;
}
