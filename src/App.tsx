/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cctv, Camera } from 'lucide-react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { apiGet } from '@/lib/api';
import { addBaseImagery, applyTerrainProvider, crossfadeImagery } from '@/cesium/viewer.config';
import { cinematicFlyTo, createEntityTracker } from '@/cesium/camera.controller';
import { addEarthquakeEntity, type UsgsFeature } from '@/rendering/earthquakes';
import { loadTectonicPlates } from '@/rendering/tectonic';
import { FlightDeadReckoning, altitudeBandColor } from '@/rendering/flights';
import {
  loadAirspaces,
  loadAisVessels,
  addSpaceDebrisEntities,
  addNasaDsnEntities,
  addLightningEntities,
  addAuroraEntities,
  loadSubmarineCablesDataSource,
  addElectricityGridEntities,
  addAnimalMigrationEntities,
  getDebrisOrbitPositions
} from '@/rendering/realDataLayers';
import { ApiVault } from '@/components/ui/api-vault';
import { createRenderScheduler } from '@/lib/renderScheduler';
import { loadOsmBuildings, hideOsmBuildings, removeOsmBuildings } from '@/rendering/digitalTwinLayers';

/* ═════════════════════════════════════════════════════════════════
   TYPES
   ═════════════════════════════════════════════════════════════════ */

interface LayerItem {
  id: string; label: string; color: string; type: string;
  on: boolean; default: boolean; opacity: number;
  category: string; sub?: string; badge?: string;
}

interface SeismicWaveData {
  id: number; lon: number; lat: number; aRadius: number;
  pStart: number; sStart: number; surfStart: number;
  pEnt: Cesium.Entity | null; sEnt: Cesium.Entity | null;
  surfEnt: Cesium.Entity | null; interval: ReturnType<typeof setInterval> | null;
}

interface TimelineState {
  current: number; start: number; end: number;
  active: boolean; speed: number; interval: ReturnType<typeof setInterval> | null;
}

interface EventAlert {
  id: string; title: string; desc: string; severity: string;
  type: string; lat: number; lon: number; seen: boolean; time: string; timestamp: number;
  hasMapPosition: boolean;
}

function alertGeometryLonLat(
  geometry: { type?: string; coordinates?: unknown } | null | undefined,
): { lon: number; lat: number } | null {
  if (!geometry?.coordinates) return null;
  const { type, coordinates: coords } = geometry;
  if (type === 'Point' && Array.isArray(coords) && coords.length >= 2) {
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
  }
  let ring: number[][] | undefined;
  if (type === 'Polygon' && Array.isArray(coords) && Array.isArray(coords[0])) {
    ring = coords[0] as number[][];
  } else if (
    type === 'MultiPolygon'
    && Array.isArray(coords)
    && Array.isArray(coords[0])
    && Array.isArray(coords[0][0])
  ) {
    ring = coords[0][0] as number[][];
  }
  if (!ring?.length) return null;
  let sumLon = 0;
  let sumLat = 0;
  let n = 0;
  for (const pt of ring) {
    if (Array.isArray(pt) && pt.length >= 2) {
      sumLon += Number(pt[0]);
      sumLat += Number(pt[1]);
      n += 1;
    }
  }
  if (n === 0) return null;
  return { lon: sumLon / n, lat: sumLat / n };
}

interface IntelFeedItem {
  id: string; title: string; source: string; type: string;
  lat: number; lon: number; timestamp: number; timeLabel: string;
  url?: string;
  platform?: 'internal' | 'news' | 'twitter' | 'facebook' | 'social';
}

interface HeatmapPoint { lon: number; lat: number; count: number; }
interface WeatherCardData { id: string; lon: number; lat: number; temp: number; desc: string; }
interface LocalSearchResult { name: string; lat: number; lon: number; }
interface IndiaCctvCamera {
  id: string;
  name: string;
  lat: number;
  lon: number;
  pageUrl: string;
  previewUrl?: string;
  streamUrl?: string;
  thumbnailUrl?: string;
  source?: string;
  category?: string;
  city?: string;
  region?: string;
  location?: string;
  updatedAt?: number;
  description?: string;
  feedType?: string;
}

interface LiveGlobeDebugState {
  viewer?: Cesium.Viewer;
  lastIndiaCctvError?: string;
  getCameraState?: () => { lat: number; lon: number; height: number };
  showInfoEntity?: (layerId: string, index?: number) => boolean;
}

interface CesiumWindow extends Window {
  Cesium?: typeof Cesium;
  __liveglobeDebug?: LiveGlobeDebugState;
}
declare const window: CesiumWindow;

type AiProvider = 'gemini' | 'anthropic' | 'local';

interface ApiVaultState {
  gemini: string;
  anthropic: string;
  cesiumIonAccessToken: string;
  openSkyClientId: string;
  openSkyClientSecret: string;
  sentinelHubClientId: string;
  sentinelHubClientSecret: string;
  marineTrafficApiKey: string;
  aisStreamApiKey: string;
  preferredAiProvider: AiProvider;
  vaultDismissed: boolean;
}

let cachedCctvCanvas: HTMLCanvasElement | null = null;

const CATEGORIES = [
  { id: 'seismic', label: 'Seismic', icon: 'SM', color: '#3b82f6' },
  { id: 'weather', label: 'Weather & Hazards', icon: 'WX', color: '#f59e0b' },
  { id: 'aviation', label: 'Aviation', icon: 'AV', color: '#a855f7' },
  { id: 'marine', label: 'Maritime', icon: 'MR', color: '#14b8a6' },
  { id: 'satellite', label: 'Satellite Imagery', icon: 'IM', color: '#22c55e' },
  { id: 'advanced', label: 'Advanced', icon: 'AD', color: '#ef4444' },
];

const LAYER_DEFS: LayerItem[] = [
  // Seismic
  { id:'earthquakes', label:'Earthquakes (M2.5+)', color:'#ef4444', type:'point', on:true, default:true, opacity:1, category:'seismic', sub:'USGS Real-Time' },
  { id:'tectonic', label:'Tectonic Plates', color:'#f97316', type:'geojson', on:true, default:true, opacity:1, category:'seismic', sub:'USGS Plates' },
  { id:'seismic_waves', label:'Seismic Wave Propagation', color:'#3b82f6', type:'effect', on:true, default:true, opacity:1, category:'seismic', sub:'Click earthquake to trigger' },
  { id:'heatmap', label:'Seismic Heatmap', color:'#ef4444', type:'heatmap', on:false, default:false, opacity:0.7, category:'seismic' },
  // Weather
  { id:'wildfires', label:'Wildfires (NASA)', color:'#f97316', type:'point', on:true, default:true, opacity:1, category:'weather', sub:'MODIS/VIIRS' },
  { id:'severe_storms', label:'Severe Storms', color:'#8b5cf6', type:'point', on:true, default:true, opacity:1, category:'weather', sub:'NASA EONET' },
  { id:'lightning_strikes', label:'Live Lightning Strikes', color:'#fef08a', type:'point', on:false, default:false, opacity:1, category:'weather', badge:'LIVE', sub:'Blitzortung Real-Time' },
  { id:'aurora_oval', label:'Polar Auroral Oval', color:'#4ade80', type:'point', on:false, default:false, opacity:0.8, category:'weather', sub:'NOAA Ovation Forecast' },
  { id:'storm_forecast', label:'Storm Forecast Cone', color:'#a855f7', type:'polygon', on:false, default:false, opacity:1, category:'weather', sub:'Tropical cyclone track prediction' },
  { id:'smoke_dispersion', label:'Smoke Dispersion', color:'#6b7280', type:'effect', on:false, default:false, opacity:1, category:'weather', sub:'Wind-driven plume from active fires (EONET)' },
  { id:'tsunami', label:'Tsunami Propagation', color:'#3b82f6', type:'effect', on:false, default:false, opacity:1, category:'weather', sub:'Auto for M7.5+ ocean quakes' },
  { id:'temp_anomaly', label:'Temperature Anomaly', color:'#ef4444', type:'tile', on:false, default:false, opacity:0.6, category:'weather' },
  { id:'precipitation', label:'Precipitation', color:'#0ea5e9', type:'tile', on:false, default:false, opacity:0.6, category:'weather' },
  { id:'wind', label:'Wind Speed', color:'#8b5cf6', type:'tile', on:false, default:false, opacity:0.6, category:'weather' },
  { id:'pressure', label:'Pressure (MSLP)', color:'#f97316', type:'tile', on:false, default:false, opacity:0.5, category:'weather' },
  { id:'volcanoes', label:'Volcanoes', color:'#f59e0b', type:'point', on:false, default:false, opacity:1, category:'weather' },
  { id:'floods', label:'Flood Reports', color:'#3b82f6', type:'point', on:false, default:false, opacity:1, category:'weather' },
  { id:'dust', label:'Dust/Sandstorm', color:'#a16207', type:'point', on:false, default:false, opacity:1, category:'weather' },
  { id:'landslides', label:'Landslides', color:'#78350f', type:'point', on:false, default:false, opacity:1, category:'weather' },
  { id:'seaLakeIce', label:'Icebergs & Sea Ice', color:'#93c5fd', type:'point', on:false, default:false, opacity:1, category:'weather', sub:'Antarctic iceberg calving & sea ice events' },
  // Aviation
  { id:'flight_tracks', label:'Live Flight Tracks', color:'#a855f7', type:'point', on:false, default:false, opacity:1, category:'aviation', badge:'KEY', sub:'OpenSky client credentials in API Vault' },
  { id:'space_debris', label:'Space Debris Cloud', color:'#a855f7', type:'point', on:false, default:false, opacity:0.9, category:'aviation', sub:'CelesTrak GP (1500+ objects)' },
  { id:'airports', label:'Major Airports', color:'#14b8a6', type:'point', on:false, default:false, opacity:1, category:'aviation' },
  { id:'airspaces', label:'Airspace Boundaries', color:'#f59e0b', type:'geojson', on:false, default:false, opacity:1, category:'aviation', badge:'KEY' },
  // Marine
  { id:'ais_vessels', label:'AIS Vessel Tracking', color:'#14b8a6', type:'point', on:false, default:false, opacity:1, category:'marine', badge:'KEY', sub:'MarineTraffic or similar' },
  { id:'sea_ice', label:'Sea Ice Concentration', color:'#93c5fd', type:'tile', on:false, default:false, opacity:0.7, category:'marine' },
  { id:'sea_temp', label:'Sea Surface Temp', color:'#f59e0b', type:'tile', on:false, default:false, opacity:0.5, category:'marine' },
  // Satellite
  { id:'nasa_gibs', label:'NASA GIBS Imagery', color:'#3b82f6', type:'tile', on:false, default:false, opacity:1, category:'satellite' },
  { id:'night_lights', label:'Nighttime Lights', color:'#fbbf24', type:'tile', on:false, default:false, opacity:1, category:'satellite' },
  { id:'land_cover', label:'Land Cover', color:'#22c55e', type:'tile', on:false, default:false, opacity:1, category:'satellite' },
  // Advanced
  { id:'nasa_dsn', label:'NASA Deep Space Network', color:'#fbbf24', type:'point', on:false, default:false, opacity:1, category:'advanced', badge:'LIVE', sub:'Active deep-space tracking' },
  { id:'submarine_cables', label:'Undersea Fiber Cables', color:'#06b6d4', type:'geojson', on:false, default:false, opacity:0.9, category:'advanced', sub:'Telegeography Global Index' },
  { id:'electricity_grid', label:'Global Grid Footprint', color:'#22c55e', type:'point', on:false, default:false, opacity:0.9, category:'advanced', sub:'Regional carbon intensity' },
  { id:'animal_migrations', label:'Wildlife Migrations', color:'#f59e0b', type:'point', on:false, default:false, opacity:0.9, category:'advanced', sub:'Movebank telemetry routes' },
  { id:'disaster_alerts', label:'GDACS Disaster Alerts', color:'#ef4444', type:'point', on:false, default:false, opacity:1, category:'advanced', sub:'Global disaster alerts' },

  { id:'india_cctv', label:'Worldwide Public Cameras', color:'#22d3ee', type:'point', on:false, default:false, opacity:1, category:'advanced', badge:'LIVE', sub:'Open live public webcams worldwide' },
  { id:'space_weather', label:'Space Weather (NOAA)', color:'#f97316', type:'point', on:false, default:false, opacity:1, category:'advanced', sub:'Solar storms, aurora' },
  { id:'disaster_near_me', label:'Disasters Near Me', color:'#ef4444', type:'point', on:false, default:false, opacity:1, category:'advanced', sub:'Requires location' },
  { id:'population_impact', label:'Population Impact Zones', color:'#f59e0b', type:'polygon', on:false, default:false, opacity:1, category:'advanced', sub:'50 cities overlay' },
  { id:'intel_feed', label:'Intel Feed', color:'#00D4FF', type:'panel', on:false, default:false, opacity:1, category:'advanced', badge:'LIVE', sub:'Real-time events from all sources' },
  { id:'flood_extent', label:'Flood Extent Mapping', color:'#3b82f6', type:'tile', on:false, default:false, opacity:0.6, category:'advanced', badge:'KEY' },
  { id:'aerosol_index', label:'Aerosol Index', color:'#6b7280', type:'tile', on:false, default:false, opacity:0.6, category:'advanced' },
  { id:'so2_index', label:'Sulfur Dioxide', color:'#eab308', type:'tile', on:false, default:false, opacity:0.6, category:'advanced' },
  { id:'co_index', label:'Carbon Monoxide', color:'#6b7280', type:'tile', on:false, default:false, opacity:0.6, category:'advanced' },
  { id:'dust_score', label:'Dust Score', color:'#a16207', type:'tile', on:false, default:false, opacity:0.6, category:'advanced' },
  { id:'dt_buildings', label:'3D Buildings (OSM)', color:'#00ff88', type:'3dtiles', on:false, default:false, opacity:1, category:'advanced', sub:'OpenStreetMap 3D worldwide' },
];

const API_VAULT_STORAGE_KEY = 'liveglobe.apiVault.v1';
const CESIUM_ION_ENV_TOKEN = (import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN as string | undefined)?.trim() ?? '';

const DEFAULT_API_VAULT: ApiVaultState = {
  gemini: '',
  anthropic: '',
  cesiumIonAccessToken: '',
  openSkyClientId: '',
  openSkyClientSecret: '',
  sentinelHubClientId: '',
  sentinelHubClientSecret: '',
  marineTrafficApiKey: '',
  aisStreamApiKey: '',
  preferredAiProvider: 'gemini',
  vaultDismissed: false,
};

const CITY_DATA = [
  { name: 'Tokyo', country: 'Japan', pop: 37.4, lat: 35.6762, lon: 139.6503 },
  { name: 'Delhi', country: 'India', pop: 29.4, lat: 28.7041, lon: 77.1025 },
  { name: 'Shanghai', country: 'China', pop: 26.3, lat: 31.2304, lon: 121.4737 },
  { name: 'Sao Paulo', country: 'Brazil', pop: 21.8, lat: -23.5505, lon: -46.6333 },
  { name: 'Mexico City', country: 'Mexico', pop: 21.6, lat: 19.4326, lon: -99.1332 },
  { name: 'Cairo', country: 'Egypt', pop: 20.4, lat: 30.0444, lon: 31.2357 },
  { name: 'Mumbai', country: 'India', pop: 20.1, lat: 19.0760, lon: 72.8777 },
  { name: 'Beijing', country: 'China', pop: 20.0, lat: 39.9042, lon: 116.4074 },
  { name: 'Dhaka', country: 'Bangladesh', pop: 20.3, lat: 23.8103, lon: 90.4125 },
  { name: 'Osaka', country: 'Japan', pop: 19.3, lat: 34.6937, lon: 135.5023 },
  { name: 'New York', country: 'USA', pop: 18.8, lat: 40.7128, lon: -74.0060 },
  { name: 'Karachi', country: 'Pakistan', pop: 15.1, lat: 24.8607, lon: 67.0011 },
  { name: 'Buenos Aires', country: 'Argentina', pop: 15.2, lat: -34.6037, lon: -58.3816 },
  { name: 'Istanbul', country: 'Turkey', pop: 15.0, lat: 41.0082, lon: 28.9784 },
  { name: 'Kolkata', country: 'India', pop: 14.8, lat: 22.5726, lon: 88.3639 },
  { name: 'Manila', country: 'Philippines', pop: 13.5, lat: 14.5995, lon: 120.9842 },
  { name: 'Lagos', country: 'Nigeria', pop: 13.9, lat: 6.5244, lon: 3.3792 },
  { name: 'Rio de Janeiro', country: 'Brazil', pop: 13.3, lat: -22.9068, lon: -43.1729 },
  { name: 'Tianjin', country: 'China', pop: 13.2, lat: 39.0842, lon: 117.2009 },
  { name: 'Kinshasa', country: 'DR Congo', pop: 13.5, lat: -4.4419, lon: 15.2663 },
  { name: 'Guangzhou', country: 'China', pop: 13.0, lat: 23.1291, lon: 113.2644 },
  { name: 'Los Angeles', country: 'USA', pop: 12.4, lat: 34.0522, lon: -118.2437 },
  { name: 'Moscow', country: 'Russia', pop: 12.5, lat: 55.7558, lon: 37.6173 },
  { name: 'Shenzhen', country: 'China', pop: 12.1, lat: 22.5431, lon: 114.0579 },
  { name: 'Lahore', country: 'Pakistan', pop: 12.6, lat: 31.5204, lon: 74.3587 },
  { name: 'Bangalore', country: 'India', pop: 12.3, lat: 12.9716, lon: 77.5946 },
  { name: 'Paris', country: 'France', pop: 11.0, lat: 48.8566, lon: 2.3522 },
  { name: 'Bogota', country: 'Colombia', pop: 10.7, lat: 4.7110, lon: -74.0721 },
  { name: 'Jakarta', country: 'Indonesia', pop: 10.6, lat: -6.2088, lon: 106.8456 },
  { name: 'Chennai', country: 'India', pop: 10.6, lat: 13.0827, lon: 80.2707 },
  { name: 'Lima', country: 'Peru', pop: 10.7, lat: -12.0464, lon: -77.0428 },
  { name: 'Bangkok', country: 'Thailand', pop: 10.5, lat: 13.7563, lon: 100.5018 },
  { name: 'Hyderabad', country: 'India', pop: 9.7, lat: 17.3850, lon: 78.4867 },
  { name: 'Seoul', country: 'South Korea', pop: 9.7, lat: 37.5665, lon: 126.9780 },
  { name: 'London', country: 'UK', pop: 9.0, lat: 51.5074, lon: -0.1278 },
  { name: 'Chengdu', country: 'China', pop: 9.1, lat: 30.5728, lon: 104.0668 },
  { name: 'Nagoya', country: 'Japan', pop: 10.1, lat: 35.1815, lon: 136.9066 },
  { name: 'Tehran', country: 'Iran', pop: 8.7, lat: 35.6892, lon: 51.3890 },
  { name: 'Chicago', country: 'USA', pop: 8.8, lat: 41.8781, lon: -87.6298 },
  { name: 'Ho Chi Minh', country: 'Vietnam', pop: 8.6, lat: 10.8231, lon: 106.6297 },
  { name: 'Luanda', country: 'Angola', pop: 8.3, lat: -8.8390, lon: 13.2894 },
  { name: 'Wuhan', country: 'China', pop: 8.3, lat: 30.5928, lon: 114.3055 },
  { name: 'Kuala Lumpur', country: 'Malaysia', pop: 7.8, lat: 3.1390, lon: 101.6869 },
  { name: 'Hong Kong', country: 'China', pop: 7.5, lat: 22.3193, lon: 114.1694 },
  { name: 'Dongguan', country: 'China', pop: 8.0, lat: 23.0472, lon: 113.7493 },
  { name: 'Riyadh', country: 'Saudi Arabia', pop: 6.9, lat: 24.7136, lon: 46.6753 },
  { name: 'Baghdad', country: 'Iraq', pop: 7.1, lat: 33.3152, lon: 44.3661 },
  { name: 'Singapore', country: 'Singapore', pop: 5.7, lat: 1.3521, lon: 103.8198 },
  { name: 'Santiago', country: 'Chile', pop: 6.7, lat: -33.4489, lon: -70.6693 },
  { name: 'Madrid', country: 'Spain', pop: 6.6, lat: 40.4168, lon: -3.7038 },
];

const LOCAL_SEARCH_INDEX: Array<LocalSearchResult & { searchText: string }> = CITY_DATA.map(city => ({
  name: `${city.name}, ${city.country}`,
  lat: city.lat,
  lon: city.lon,
  searchText: normalizeLocationQuery(`${city.name} ${city.country}`),
}));



/* ═════════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═════════════════════════════════════════════════════════════════ */

function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }

function loadApiVault(): ApiVaultState {
  if (typeof window === 'undefined') return DEFAULT_API_VAULT;
  try {
    const raw = window.localStorage.getItem(API_VAULT_STORAGE_KEY);
    if (!raw) return DEFAULT_API_VAULT;
    const parsed = JSON.parse(raw) as Partial<ApiVaultState>;
    return {
      ...DEFAULT_API_VAULT,
      ...parsed,
      preferredAiProvider:
        parsed.preferredAiProvider === 'anthropic'
      ? 'anthropic'
      : parsed.preferredAiProvider === 'local'
        ? 'local'
        : 'gemini',
      vaultDismissed: Boolean(parsed.vaultDismissed),
    };
  } catch {
    return DEFAULT_API_VAULT;
  }
}

function hasAnyApiVaultValue(vault: ApiVaultState): boolean {
  return Boolean(
    vault.gemini.trim() ||
    vault.anthropic.trim() ||
    vault.cesiumIonAccessToken.trim() ||
    vault.openSkyClientId.trim() ||
    vault.openSkyClientSecret.trim() ||
    vault.sentinelHubClientId.trim() ||
    vault.sentinelHubClientSecret.trim() ||
    vault.marineTrafficApiKey.trim()
  );
}

function resolveAiProvider(vault: ApiVaultState): AiProvider {
  if (vault.preferredAiProvider === 'anthropic' && vault.anthropic.trim()) return 'anthropic';
  if (vault.preferredAiProvider === 'gemini' && vault.gemini.trim()) return 'gemini';
  if (vault.gemini.trim()) return 'gemini';
  if (vault.anthropic.trim()) return 'anthropic';
  return 'local';
}

function resolveCesiumIonToken(vault: ApiVaultState): string | undefined {
  const token = vault.cesiumIonAccessToken.trim() || CESIUM_ION_ENV_TOKEN;
  return token || undefined;
}

function normalizeLocationQuery(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s,.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCoordinateQuery(query: string): LocalSearchResult | null {
  const compact = query.trim().replace(/\s+/g, ' ');
  const pair = compact.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  const split = pair
    ? pair
    : compact.match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);
  if (!split) return null;
  const first = Number(split[1]);
  const second = Number(split[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  const lat = Math.abs(first) <= 90 ? first : second;
  const lon = Math.abs(first) <= 90 ? second : first;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon };
}

function findLocalLocationMatches(query: string, limit = 6): LocalSearchResult[] {
  const normalized = normalizeLocationQuery(query);
  if (!normalized) return [];

  const scoreEntry = (entry: (typeof LOCAL_SEARCH_INDEX)[number]) => {
    let score = 0;
    if (entry.searchText === normalized) score += 100;
    if (entry.searchText.startsWith(normalized)) score += 60;
    if (entry.searchText.includes(normalized)) score += 30;
    for (const part of normalized.split(' ')) {
      if (!part) continue;
      if (entry.searchText.includes(part)) score += 8;
    }
    return score;
  };

  return LOCAL_SEARCH_INDEX
    .map(entry => ({ entry, score: scoreEntry(entry) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map(item => ({ name: item.entry.name, lat: item.entry.lat, lon: item.entry.lon }));
}

function makeSafeAnimatedRadiusPair(
  baseRadius: () => number,
  majorMultiplier: number = 1.08
) {
  let cachedBucket = -1;
  let cachedRadius = 1;
  const sample = () => {
    const bucket = Math.floor(Date.now() / 33);
      if (bucket !== cachedBucket) {
        cachedBucket = bucket;
        cachedRadius = Math.max(1.0, baseRadius());
      }
      return cachedRadius;
    };
  return {
    minor: () => sample(),
    major: () => sample() * majorMultiplier,
  };
}

function destinationPoint(lat: number, lon: number, distance: number, bearing: number): { lat: number; lon: number } {
  const R = 6371;
  const d = distance / R;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const brng = bearing * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
}

function generateStormCone(
  center: [number, number],
  heading: number,
  radii: [number, number, number],
  spread: [number, number, number]
): { positions: Cesium.Cartesian3[]; radii: Cesium.Cartesian3 } {
  const coords: [number, number][] = [];
  for (let i = -1; i <= 1; i += 0.1) {
    const dist = radii[0];
    const angle = (heading + spread[0] * i + 360) % 360;
    const p = destinationPoint(center[1], center[0], dist, angle);
    coords.push([p.lon, p.lat]);
  }
  for (let i = 1; i >= -1; i -= 0.1) {
    const dist = radii[2];
    const angle = (heading + spread[2] * i + 360) % 360;
    const p = destinationPoint(center[1], center[0], dist, angle);
    coords.push([p.lon, p.lat]);
  }
  coords.push(coords[0]);
  const cartesians = coords.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
  const centerCart = Cesium.Cartesian3.fromDegrees(center[0], center[1]);
  const dists = cartesians.map(p => Cesium.Cartesian3.distance(centerCart, p));
  const maxDist = Math.max(...dists);
  const radiiVec = new Cesium.Cartesian3(maxDist, maxDist, maxDist);
  return { positions: cartesians, radii: radiiVec };
}

function generateStormForecast(lat: number, lon: number, windSpeed: number, pressure: number) {
  const headingSeed = Math.sin((lat + 90) * 12.9898 + (lon + 180) * 78.233 + windSpeed * 0.31831);
  const heading = ((headingSeed * 43758.5453) % 360 + 360) % 360;
  const spread24 = windSpeed > 100 ? 22.5 : windSpeed > 80 ? 30 : 45;
  const radii24: [number, number, number] = windSpeed > 100 ? [50, 100, 150] : windSpeed > 80 ? [30, 70, 120] : [20, 50, 80];
  const spread48: [number, number, number] = [spread24 * 1.5, spread24 * 1.5, spread24 * 1.5];
  const radii48: [number, number, number] = [radii24[0] * 1.5, radii24[1] * 1.8, radii24[2] * 2.0];
  const spread72: [number, number, number] = [spread24 * 2, spread24 * 2, spread24 * 2];
  const radii72: [number, number, number] = [radii24[0] * 2, radii24[1] * 2.5, radii24[2] * 3.0];
  const cone24 = generateStormCone([lon, lat], heading, radii24, [spread24, spread24, spread24]);
  const cone48 = generateStormCone([lon, lat], heading, radii48, spread48,);
  const cone72 = generateStormCone([lon, lat], heading, radii72, spread72);
  const speedKmh = windSpeed * 1.60934;
  const dest24 = destinationPoint(lat, lon, radii24[1], heading);
  const dest48 = destinationPoint(lat, lon, radii48[1], heading);
  const dest72 = destinationPoint(lat, lon, radii72[1], heading);
  return {
    heading, speedKmh, pressure,
    cone24, cone48, cone72,
    track: [
      { time: 'Now', lat, lon },
      { time: '+24h', lat: dest24.lat, lon: dest24.lon },
      { time: '+48h', lat: dest48.lat, lon: dest48.lon },
      { time: '+72h', lat: dest72.lat, lon: dest72.lon },
    ],
  };
}

function calculatePopulationImpact(lat: number, lon: number) {
  const affected = CITY_DATA.filter(c => {
    const dLat = c.lat - lat, dLon = c.lon - lon;
    const dist = Math.sqrt(dLat * dLat + dLon * dLon);
    return dist < 5;
  });
  if (affected.length === 0) return null;
  const totalPop = affected.reduce((s, c) => s + c.pop, 0);
  let severity: 'high'|'medium'|'low';
  if (totalPop > 20) severity = 'high';
  else if (totalPop > 5) severity = 'medium';
  else severity = 'low';
  return { cities: affected, totalPop, severity };
}

function generateHeatmapData(lon: number, lat: number, count: number): HeatmapPoint[] {
  const pts: HeatmapPoint[] = [];
  const grid = Math.ceil(Math.sqrt(count));
  const spacing = 200 / grid;
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      if (pts.length >= count) break;
      const w = 0.1 + Math.random() * 5;
      const clat = lat + (i - grid/2) * spacing / 111;
      const clon = lon + (j - grid/2) * spacing / (111 * Math.cos(lat * Math.PI/180));
      pts.push({ lon: clon, lat: clat, count: w });
    }
  }
  return pts;
}

const CctvVideoPlayer = ({ src }: { src: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(false);

    let hls: any = null;
    const isHls = src.includes('.m3u8') || src.includes('m3u8');

    if (isHls) {
      import('hls.js').then(({ default: Hls }) => {
        if (!videoRef.current) return;
        if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          videoRef.current.src = src;
        } else if (Hls.isSupported()) {
          hls = new Hls({
            maxMaxBufferLength: 5,
            enableWorker: true,
            lowLatencyMode: true,
          });
          hls.loadSource(src);
          hls.attachMedia(videoRef.current);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            videoRef.current?.play().catch(() => {});
          });
          hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
            if (data.fatal) {
              console.warn('HLS fatal error:', data);
              setError(true);
            }
          });
        } else {
          setError(true);
        }
      }).catch(err => {
        console.error('Failed to load hls.js', err);
        setError(true);
      });
    } else {
      video.src = src;
      video.load();
      video.play().catch(() => {});
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
      if (video) {
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [src]);

  if (error) {
    return (
      <div className="cctv-preview-empty">
        Failed to load video stream
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      controls
      playsInline
      muted
      autoPlay
      style={{ width: '100%', height: '165px', objectFit: 'cover', background: '#000', display: 'block' }}
    />
  );
};

/* ═════════════════════════════════════════════════════════════════
   MAIN APP COMPONENT
   ═════════════════════════════════════════════════════════════════ */

export default function App() {
  /* ── Refs ── */
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const cesiumElRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<TimelineState>({
    current: Date.now(), start: Date.now() - 72*3600000, end: Date.now(),
    active: false, speed: 1, interval: null,
  });
  const seismicAnimationsRef = useRef<SeismicWaveData[]>([]);
  const weatherCardsRef = useRef<WeatherCardData[]>([]);
  const heatmapDataRef = useRef<HeatmapPoint[]>([]);
  const activeHeatmapRef = useRef<string | null>(null);
  const clickHandlerRef = useRef<Cesium.Event.RemoveCallback | null>(null);
  const screenSpaceHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const issTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rotateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const geocodeCacheRef = useRef<Record<string, Array<{name:string;lat:number;lon:number}>>>({});
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchValueRef = useRef('');
  const timelineThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineLastUpdateRef = useRef<number>(0);
  const entityStoreRef = useRef<Record<string, Cesium.Entity[]>>({});
  const dataStoreRef = useRef<Record<string, unknown[]>>({});
  const magnitudeScaleRef = useRef(1);
  const autoRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const issEntityRef = useRef<Cesium.Entity | null>(null);
  const issTrailRef = useRef<Cesium.SampledPositionProperty | null>(null);
  const issTimesRef = useRef<Cesium.JulianDate[]>([]);
  const issRenderTickRef = useRef<(() => void) | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const alertsRef = useRef<EventAlert[]>([]);
  const notificationTimeoutsRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const populationImpactLayerRef = useRef<Cesium.Entity[]>([]);
  const intelFeedRef = useRef<IntelFeedItem[]>([]);
  const weatherCardElementsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const weatherAbortRef = useRef<AbortController | null>(null);
  const focusMarkerRef = useRef<Cesium.Entity | null>(null);
  const flightDrRef = useRef<FlightDeadReckoning | null>(null);
  const entityTrackerRef = useRef<ReturnType<typeof createEntityTracker> | null>(null);
  const unlockInteractionRef = useRef<(() => void) | null>(null);
  const fpsFramesRef = useRef<number[]>([]);
  const lastFpsTimeRef = useRef(performance.now());
  const feedErrorsRef = useRef<string[]>([]);
  const feedSummaryShownRef = useRef(false);
  const alertEntityRef = useRef<Record<string, Cesium.Entity>>({});
  const stormOverlaysRef = useRef<Cesium.Entity[]>([]);
  const smokeParticlesRef = useRef<Cesium.Entity[]>([]);
  const tsunamiWavesRef = useRef<Cesium.Entity[]>([]);
  const tectonicEntitiesRef = useRef<Cesium.Entity[]>([]);
  const overlayImageryLayersRef = useRef<Record<string, Cesium.ImageryLayer>>({});
  const openSkyTokenRef = useRef<{ token: string; expiresAt: number } | null>(null);
  const cctvPulseEntityRef = useRef<Cesium.Entity | null>(null);
  const nextAiMsgIdRef = useRef(1);

  /* ── State ── */
  const initialApiVault = useMemo(() => loadApiVault(), []);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Initializing Cesium...');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openCategories, setOpenCategories] = useState<string[]>(['seismic']);
  const [layers, setLayers] = useState<LayerItem[]>(LAYER_DEFS.map(l => ({ ...l })));
  const layersRef = useRef<LayerItem[]>(LAYER_DEFS.map(l => ({ ...l })));
  const renderSchedulerRef = useRef(createRenderScheduler());
  const [layerOpacity, setLayerOpacity] = useState<Record<string, number>>({});
  const [activeImagery, setActiveImagery] = useState('satellite');
  const [infoEntity, setInfoEntity] = useState<Cesium.Entity | null>(null);
  const [showHeatmapLegend, setShowHeatmapLegend] = useState(false);
  const [showStormLegend, setShowStormLegend] = useState(false);
  const [showSmokeLegend, setShowSmokeLegend] = useState(false);
  const [showTsunamiLegend, setShowTsunamiLegend] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [apiVault, setApiVault] = useState<ApiVaultState>(initialApiVault);
  const [showTokenSetup, setShowTokenSetup] = useState(() => !hasAnyApiVaultValue(initialApiVault) && !initialApiVault.vaultDismissed && !CESIUM_ION_ENV_TOKEN);
  const [showApiVault, setShowApiVault] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [showAlertsPanel, setShowAlertsPanel] = useState(false);
  const [showIntelFeed, setShowIntelFeed] = useState(false);
  const [activeLayerCount, setActiveLayerCount] = useState(0);
  const [utcTime, setUtcTime] = useState('');
  const [totalEntities, setTotalEntities] = useState(0);
  const [activeEvents, setActiveEvents] = useState(0);
  const [weatherCards, setWeatherCards] = useState<WeatherCardData[]>([]);
  const [contextMenu, setContextMenu] = useState<{show:boolean;x:number;y:number;lat:number;lon:number}>({show:false,x:0,y:0,lat:0,lon:0});
  const [alerts, setAlerts] = useState<EventAlert[]>([]);
  const [newAlertCount, setNewAlertCount] = useState(0);
  const [notifications, setNotifications] = useState<Array<{id:number;text:string;severity:string}>>([]);
  const [stormForecast, setStormForecast] = useState<ReturnType<typeof generateStormForecast> | null>(null);
  const [populationImpact, setPopulationImpact] = useState<ReturnType<typeof calculatePopulationImpact> | null>(null);
  const [aiMessages, setAiMessages] = useState<Array<{id:number;role:string;content:string}>>([
    { id: nextAiMsgIdRef.current++, role:'assistant', content:'👋 Hello! I\'m your Earth Intelligence assistant. Ask me about earthquakes, weather, disasters, or any location on Earth. Try: "Show recent earthquakes" or "What\'s the weather in Tokyo?"' },
  ]);
  const [aiTyping, setAiTyping] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState<Array<{name:string;lat:number;lon:number}>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [timelineValue, setTimelineValue] = useState(100);
  const [isAutoRotating, setIsAutoRotating] = useState(false);
  const [showISSInfo, setShowISSInfo] = useState(false);
  const [issInfo, setIssInfo] = useState<{lat:number;lon:number} | null>(null);
  const [intelFeed, setIntelFeed] = useState<IntelFeedItem[]>([]);
  const [intelFilter, setIntelFilter] = useState('all');
  const [fps, setFps] = useState(0);
  const [cameraDms, setCameraDms] = useState('');
  const [showPopulationImpact, setShowPopulationImpact] = useState(false);
  const [layerSearch, setLayerSearch] = useState('');
  const [pulsingLayer, setPulsingLayer] = useState<string | null>(null);
  const [cctvPreviewTick, setCctvPreviewTick] = useState(0);
  const lastKnownLocationRef = useRef<{ lat: number; lon: number } | null>(null);
  const disasterNearMeRequestedRef = useRef(false);
  const geolocationWatchRef = useRef<number | null>(null);
  const apiVaultRef = useRef<ApiVaultState>(initialApiVault);
  const submarineCablesDataSourceRef = useRef<Cesium.GeoJsonDataSource | null>(null);
  const selectedDebrisOrbitEntityRef = useRef<Cesium.Entity | null>(null);

  const aiApiType = useMemo(() => resolveAiProvider(apiVault), [apiVault]);
  const cesiumIonToken = useMemo(() => resolveCesiumIonToken(apiVault), [apiVault]);

  /* ── Memo ── */
  const groupedLayers = useMemo(() => {
    const g: Record<string, LayerItem[]> = {};
    for (const l of layers) {
      if (!g[l.category]) g[l.category] = [];
      g[l.category].push(l);
    }
    return g;
  }, [layers]);

  useEffect(() => {
    apiVaultRef.current = apiVault;
    try {
      window.localStorage.setItem(API_VAULT_STORAGE_KEY, JSON.stringify(apiVault));
    } catch {
      // Ignore storage failures in private or restricted browsing modes.
    }
  }, [apiVault]);

  useEffect(() => {
    openSkyTokenRef.current = null;
  }, [apiVault.openSkyClientId, apiVault.openSkyClientSecret]);

  const handleApiVaultSave = (keys: Record<string, string>) => {
    // Map the saved keys to the ApiVaultState interface
    const newVault: ApiVaultState = {
      ...apiVault,
      gemini: keys['GOOGLE_GEMINI_API_KEY'] || apiVault.gemini,
      anthropic: keys['ANTHROPIC_API_KEY'] || apiVault.anthropic,
      cesiumIonAccessToken: keys['CESIUM_ION_ACCESS_TOKEN'] || apiVault.cesiumIonAccessToken,
      openSkyClientId: keys['OPENSKY_CLIENT_ID'] || apiVault.openSkyClientId,
      openSkyClientSecret: keys['OPENSKY_CLIENT_SECRET'] || apiVault.openSkyClientSecret,
      sentinelHubClientId: keys['SENTINEL_HUB_CLIENT_ID'] || apiVault.sentinelHubClientId,
      sentinelHubClientSecret: keys['SENTINEL_HUB_CLIENT_SECRET'] || apiVault.sentinelHubClientSecret,
      marineTrafficApiKey: keys['MARINE_TRAFFIC_API_KEY'] || apiVault.marineTrafficApiKey,
      aisStreamApiKey: keys['AIS_STREAM_API_KEY'] || apiVault.aisStreamApiKey,
    };
    setApiVault(newVault);
  };

  /* ── IST Clock ── */
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const ist = now.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      setUtcTime(ist + ' IST');
    };
    tick();
    clockIntervalRef.current = setInterval(tick, 1000);
    return () => { if (clockIntervalRef.current) clearInterval(clockIntervalRef.current); };
  }, []);

  /* ── Cesium Init ── */
  useEffect(() => {
    if (!cesiumElRef.current || viewerRef.current) return;
    window.Cesium = Cesium;
    // @ts-expect-error CESIUM_BASE_URL is a global config
    window.CESIUM_BASE_URL = '/cesium/';
    if (cesiumIonToken) {
      Cesium.Ion.defaultAccessToken = cesiumIonToken;
    }

    setLoadingProgress(10);
    setLoadingStatus('Loading Cesium engine...');

    const v = new Cesium.Viewer(cesiumElRef.current, {
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      scene3DOnly: true,
      requestRenderMode: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      vrButton: false,
      infoBox: false,
      selectionIndicator: false,
      creditContainer: document.createElement('div'),
    });
    viewerRef.current = v;
    if (import.meta.env.DEV) {
      window.__liveglobeDebug = {
        ...(window.__liveglobeDebug ?? {}),
        viewer: v,
        getCameraState: () => {
          const c = v.camera.positionCartographic;
          return {
            lat: Cesium.Math.toDegrees(c.latitude),
            lon: Cesium.Math.toDegrees(c.longitude),
            height: c.height,
          };
        },
      };
    }
    entityTrackerRef.current = createEntityTracker(v);
    flightDrRef.current = new FlightDeadReckoning(v, (heading, color) => createPlaneIcon(heading, color));
    v.scene.logarithmicDepthBuffer = true;
    v.clock.shouldAnimate = true;
    v.clock.multiplier = 1;
    try { if (v.scene.postProcessStages.fxaa) v.scene.postProcessStages.fxaa.enabled = false; } catch { /* ignore */ }
    if (v.scene.postProcessStages.bloom) {
      v.scene.postProcessStages.bloom.enabled = false;
    }
    if (v.scene.postProcessStages.ambientOcclusion) {
      v.scene.postProcessStages.ambientOcclusion.enabled = false;
    }
    v.scene.globe.enableLighting = true;
    v.scene.globe.depthTestAgainstTerrain = true;
    v.scene.highDynamicRange = true;
    v.scene.globe.atmosphereLightIntensity = 30.0;
    v.scene.globe.lightingFadeOutDistance = 8e6;
    v.scene.globe.lightingFadeInDistance = 1e7;
    try {
      // Keep Cesium default imagery; add Esri layer on top (do NOT removeAll — that causes a black globe)
      addBaseImagery(v, 'satellite', false);
    } catch (err) {
      console.warn('Custom basemap failed, keeping default imagery:', err);
    }
    const ctrl = v.scene.screenSpaceCameraController;
    ctrl.enableRotate = true;
    ctrl.enableZoom = true;
    ctrl.enableTilt = true;
    ctrl.minimumZoomDistance = 100;
    ctrl.maximumZoomDistance = 5e8;
    unlockInteractionRef.current = () => {
      if (rotateTimerRef.current) {
        clearInterval(rotateTimerRef.current);
        rotateTimerRef.current = null;
      }
      setIsAutoRotating(false);
    };
    v.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0, 0, 2.2e7),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    });
    v.scene.requestRender();
    requestAnimationFrame(() => {
      v.resize();
      v.scene.requestRender();
    });

    const syncWeatherCardPositions = () => {
      for (const card of weatherCardsRef.current) {
        const el = weatherCardElementsRef.current[card.id];
        if (!el) continue;
        const position = Cesium.Cartesian3.fromDegrees(card.lon, card.lat, 0);
        const projected = Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, position);
        if (!projected) {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
          continue;
        }
        const withinBounds =
          projected.x >= 0 && projected.x <= v.canvas.clientWidth &&
          projected.y >= 0 && projected.y <= v.canvas.clientHeight;
        el.style.left = `${projected.x}px`;
        el.style.top = `${projected.y}px`;
        el.style.transform = 'translate(-50%, -110%)';
        el.style.opacity = withinBounds ? '1' : '0';
        el.style.pointerEvents = withinBounds ? 'auto' : 'none';
      }
    };
    v.scene.postRender.addEventListener(syncWeatherCardPositions);

    const onPostRender = () => {
      const now = performance.now();
      const dt = now - lastFpsTimeRef.current;
      if (dt >= 500) {
        const frames = fpsFramesRef.current.length;
        setFps(Math.round((frames * 1000) / dt));
        fpsFramesRef.current = [];
        lastFpsTimeRef.current = now;
        const c = v.camera.positionCartographic;
        const lat = Cesium.Math.toDegrees(c.latitude);
        const lon = Cesium.Math.toDegrees(c.longitude);
        const latD = Math.abs(lat);
        const lonD = Math.abs(lon);
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';
        setCameraDms(`${latD.toFixed(2)}°${latDir} ${lonD.toFixed(2)}°${lonDir}`);
      } else {
        fpsFramesRef.current.push(1);
      }
    };
    v.scene.postRender.addEventListener(onPostRender);

    setLoadingProgress(30);
    setLoadingStatus('Loading data layers...');

    const handler = new Cesium.ScreenSpaceEventHandler(v.canvas);
    screenSpaceHandlerRef.current = handler;
    const unlockOnInteract = () => unlockInteractionRef.current?.();
    handler.setInputAction(unlockOnInteract, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(unlockOnInteract, Cesium.ScreenSpaceEventType.RIGHT_DOWN);
    handler.setInputAction(unlockOnInteract, Cesium.ScreenSpaceEventType.MIDDLE_DOWN);
    handler.setInputAction(unlockOnInteract, Cesium.ScreenSpaceEventType.WHEEL);
    handler.setInputAction(unlockOnInteract, Cesium.ScreenSpaceEventType.PINCH_START);
    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = v.scene.pick(click.position);
      if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
        const ent = picked.id as Cesium.Entity;
        showInfoPanel(ent);
        const p = ent.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
        const layer = String(p?.layer ?? '');
        if (layer === 'flight_tracks') entityTrackerRef.current?.track(ent, 'aircraft');
        else if (layer === 'earthquakes') entityTrackerRef.current?.track(ent, 'earthquake');
        else if (layer === 'india_cctv') entityTrackerRef.current?.track(ent, 'cctv');
      } else {
        const cart = v.camera.pickEllipsoid(click.position, v.scene.globe.ellipsoid);
        if (cart) {
          const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(cart);
          const lon = Cesium.Math.toDegrees(carto.longitude);
          const lat = Cesium.Math.toDegrees(carto.latitude);
          if (!isContextMenuOpenRef.current) {
            setContextMenu({ show: true, x: click.position.x, y: click.position.y, lat, lon });
          }
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const cart = v.camera.pickEllipsoid(click.position, v.scene.globe.ellipsoid);
      if (cart) {
        const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(cart);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        const lat = Cesium.Math.toDegrees(carto.latitude);
        setContextMenu({ show: true, x: click.position.x, y: click.position.y, lat, lon });
      }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    handler.setInputAction(() => setContextMenu({show:false,x:0,y:0,lat:0,lon:0}), Cesium.ScreenSpaceEventType.LEFT_DOWN);

    setLoadingProgress(50);

    void loadAllData(v)
      .then(() => {
        syncWeatherCardPositions();
        autoRefreshIntervalRef.current = setInterval(() => {
          void refreshLiveData(v);
        }, 60000);
        setLoadingProgress(100);
        setLoadingStatus('Ready');
        setTimeout(() => setLoading(false), 800);
      })
      .catch((err) => {
        console.error('Data load failed:', err);
        setLoadingProgress(100);
        setLoadingStatus('Globe ready (some feeds unavailable)');
        setTimeout(() => setLoading(false), 800);
      })
      .finally(() => {
        v.scene.requestRender();
      });

    const handleDocClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(cm => ({ ...cm, show: false }));
      }
    };
    document.addEventListener('click', handleDocClick);

    return () => {
      document.removeEventListener('click', handleDocClick);
      v.scene.postRender.removeEventListener(syncWeatherCardPositions);
      v.scene.postRender.removeEventListener(onPostRender);
      cleanupCesium();
    };
  }, []);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    let cancelled = false;

    void (async () => {
      const enabled = await applyTerrainProvider(v, cesiumIonToken);
      if (!cancelled) {
        v.scene.requestRender();
        if (enabled) {
          setLoadingStatus('Cesium 3D terrain enabled');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cesiumIonToken]);

  const isContextMenuOpenRef = useRef(false);
  useEffect(() => { isContextMenuOpenRef.current = contextMenu.show; }, [contextMenu.show]);

  useEffect(() => {
    if (cctvPulseEntityRef.current && viewerRef.current) {
      viewerRef.current.entities.remove(cctvPulseEntityRef.current);
      cctvPulseEntityRef.current = null;
    }

    if (!infoEntity) {
      setCctvPreviewTick(0);
      return;
    }
    const props = infoEntity.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
    if (props?.layer !== 'india_cctv') {
      setCctvPreviewTick(0);
      return;
    }

    const v = viewerRef.current;
    if (v) {
      const lat = props.lat as number;
      const lon = props.lon as number;
      const pulse = makeSafeAnimatedRadiusPair(
        () => 15000 + Math.sin(Date.now() / 250) * 4000,
        1.05,
      );
      cctvPulseEntityRef.current = v.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 15),
        ellipse: {
          semiMajorAxis: new Cesium.CallbackProperty(() => pulse.major(), false) as unknown as number,
          semiMinorAxis: new Cesium.CallbackProperty(() => pulse.minor(), false) as unknown as number,
          material: Cesium.Color.fromCssColorString('#22d3ee').withAlpha(0.15),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#67e8f9').withAlpha(0.85),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
    }

    const timer = setInterval(() => {
      setCctvPreviewTick(t => t + 1);
    }, 10000);

    return () => {
      clearInterval(timer);
      if (cctvPulseEntityRef.current && viewerRef.current) {
        viewerRef.current.entities.remove(cctvPulseEntityRef.current);
        cctvPulseEntityRef.current = null;
      }
    };
  }, [infoEntity]);

  /* ── Layer Count Update ── */
  useEffect(() => {
    setActiveLayerCount(layers.filter(l => l.on).length);
  }, [layers]);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  /* ═════════════════════════════════════════════════════════════════
     DATA LOADING
     ═════════════════════════════════════════════════════════════════ */

  async function loadSocialFeed() {
    if (!isLayerEnabled('intel_feed')) return;
    try {
      const resp = await apiGet<any[]>('/social');
      if (!Array.isArray(resp)) return;
      resp.forEach(item => {
        if (!intelFeedRef.current.find(i => i.id === item.id)) {
          pushIntelFeed({
            id: item.id,
            title: item.title,
            source: item.source,
            type: item.type,
            lat: item.lat || 0,
            lon: item.lon || 0,
            timestamp: item.timestamp,
            url: item.url,
            platform: item.platform
          });
        }
      });
    } catch (e) {
      console.warn('Social feed error:', e);
    }
  }

  useEffect(() => {
    // Poll social feed every 60 seconds if Intel Feed is enabled
    const timer = setInterval(() => {
      void loadSocialFeed();
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  async function getOpenSkyAuthHeaders() {
    const { openSkyClientId, openSkyClientSecret } = apiVaultRef.current;
    if (!openSkyClientId.trim() || !openSkyClientSecret.trim()) return null;

    const cached = openSkyTokenRef.current;
    if (cached && cached.expiresAt - Date.now() > 60_000) {
      return { Authorization: `Bearer ${cached.token}` };
    }

    const resp = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: openSkyClientId.trim(),
        client_secret: openSkyClientSecret.trim(),
      }),
    });

    if (!resp.ok) {
      throw new Error(`OpenSky auth failed (${resp.status})`);
    }

    const data = await resp.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error('OpenSky auth response missing token');
    }

    openSkyTokenRef.current = {
      token: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in ?? 3600) * 1000),
    };

    return { Authorization: `Bearer ${data.access_token}` };
  }

  async function loadFlightTracks(viewer: Cesium.Viewer) {
    if (!isLayerEnabled('flight_tracks')) return;
    flightDrRef.current?.clear();
    removeLayerEntities('flight_tracks');

    try {
      const headers = await getOpenSkyAuthHeaders();
      const data = await apiGet<{ states?: unknown[][] | null }>('/flights', headers ? { headers } : undefined);
      if (!isLayerEnabled('flight_tracks')) return;
      if (!data.states?.length) throw new Error('OpenSky returned no states');
      flightDrRef.current?.updateFromApi(data.states);
      flightDrRef.current?.start();
      showNotification(`Loaded ${Math.min(data.states.length, 500)} live flight tracks`, 'success');
    } catch (error) {
      if (!isLayerEnabled('flight_tracks')) return;
      recordFeedError('flights', error);
    }
  }

  function pushIntelFeed(item: Omit<IntelFeedItem, 'timeLabel'>) {
    const entry: IntelFeedItem = {
      ...item,
      timeLabel: new Date(item.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }),
    };
    const next = [entry, ...intelFeedRef.current.filter(i => i.id !== item.id)];
    next.sort((a, b) => b.timestamp - a.timestamp); // Keep newest at the top
    const sliced = next.slice(0, 500); // Increase limit to 500 to hold bulk loads
    intelFeedRef.current = sliced;
    setIntelFeed(sliced);
  }

  async function loadEarthquakes(viewer: Cesium.Viewer) {
    removeLayerEntities('earthquakes');
    try {
      const geo = await apiGet<{ features: UsgsFeature[] }>('/earthquakes');
      const features = geo.features
        .filter(f => Number(f.properties?.mag ?? 0) >= 2.5)
        .slice(0, 120);
      const ents = features.map(f => {
        const c = f.geometry.coordinates;
        const p = f.properties;
        const m = Number(p.mag ?? 0);
        if (m >= 5 && p.time) checkMagnitudeAlert(m, String(p.place ?? ''), Number(p.time), c[1], c[0]);
        if (isLayerEnabled('earthquakes')) {
          pushIntelFeed({
            id: `eq-${p.time}`,
            title: `M${m.toFixed(1)} ${String(p.place ?? '')}`,
            source: 'USGS',
            type: 'earthquake',
            lat: c[1],
            lon: c[0],
            timestamp: Number(p.time ?? Date.now()),
            url: String(p.url ?? `https://earthquake.usgs.gov/earthquakes/search/`),
            platform: 'internal'
          });
        }
        return addEarthquakeEntity(viewer, f);
      });
      entityStoreRef.current['earthquakes'] = ents;
      if (!isLayerEnabled('earthquakes')) {
        setLayerEntitiesVisible('earthquakes', false);
      }
    } catch (err) {
      recordFeedError('earthquakes', err);
    }
  }

  const eonetCategoriesRef = useRef<Set<string>>(new Set());

  async function loadEonetEvents(viewer: Cesium.Viewer) {
    const eonetLayers = ['wildfires', 'severe_storms', 'volcanoes', 'floods', 'dust', 'landslides', 'seaLakeIce'];
    // Clear all previously used EONET categories (including transient ones like drought, manmade, snow, etc.)
    for (const cat of eonetCategoriesRef.current) {
      removeLayerEntities(cat);
    }
    for (const key of eonetLayers) {
      removeLayerEntities(key);
    }
    eonetCategoriesRef.current.clear();
    try {
      const data = await apiGet<{ events: Array<Record<string, unknown>> }>('/eonet');
      const evs = (data.events || []).slice(0, 60);
      setActiveEvents(evs.length);
      for (const ev of evs) {
        const geo = ev.geometry as Array<{ coordinates: number[]; date: string }> | undefined;
        if (!geo?.length) continue;
        const c = geo[0].coordinates;
        const cats = ev.categories as Array<{ id: string; title: string }>;
        const rawCat = cats?.[0]?.id || 'other';
        const cat = normalizeEventLayerId(rawCat);
        const color = getEventColor(cat);
        const ent = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(c[0], c[1]),
          name: ev.title as string,
          billboard: {
            image: createPulsingDotCanvas(color), width: 20, height: 20,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          properties: {
            layer: cat, title: ev.title, date: geo[0].date, category: rawCat,
            description: ev.description || '', categories: cats, lon: c[0], lat: c[1],
            time: new Date(geo[0].date).getTime() || Date.now(),
          },
        });
        if (!entityStoreRef.current[cat]) entityStoreRef.current[cat] = [];
        entityStoreRef.current[cat].push(ent);
        eonetCategoriesRef.current.add(cat);
        if (isLayerEnabled(cat)) {
          pushIntelFeed({
            id: `eonet-${ev.id}`,
            title: String(ev.title ?? 'Event'),
            source: 'NASA EONET',
            type: cat,
            lat: c[1],
            lon: c[0],
            timestamp: new Date(geo[0].date).getTime() || Date.now(),
            url: String(ev.link ?? `https://eonet.gsfc.nasa.gov/api/v3/events/${String(ev.id ?? '')}`),
            platform: 'internal'
          });
        }
      }
      for (const key of eonetLayers) {
        if (!isLayerEnabled(key)) {
          setLayerEntitiesVisible(key, false);
        }
      }
      refreshDerivedOverlays();
    } catch (err) {
      recordFeedError('natural events', err);
    }
  }

  async function loadNwsAlerts(viewer: Cesium.Viewer) {
    try {
      const data = await apiGet<{
        features: Array<{
          properties: Record<string, unknown>;
          geometry: { type?: string; coordinates?: unknown } | null;
        }>;
      }>('/weather/alerts');
      const parsed: EventAlert[] = (data.features ?? []).slice(0, 50).map((f, i) => {
        const p = f.properties;
        const pos = alertGeometryLonLat(f.geometry);
        const severity = String(p.severity ?? 'Unknown').toLowerCase().includes('extreme') ? 'red'
          : String(p.severity ?? '').toLowerCase().includes('severe') ? 'orange' : 'green';
        return {
          id: `nws-${i}-${p.id ?? i}`,
          title: String(p.event ?? p.headline ?? 'Weather Alert'),
          desc: String(p.description ?? p.areaDesc ?? '').slice(0, 200),
          severity,
          type: String(p.event ?? 'weather'),
          lat: pos?.lat ?? 0,
          lon: pos?.lon ?? 0,
          hasMapPosition: pos !== null,
          seen: false,
          timestamp: Date.now(),
          time: new Date().toISOString(),
        };
      });
      alertsRef.current = parsed;
      setAlerts(parsed);
      setNewAlertCount(parsed.length);
      parsed.filter(a => a.hasMapPosition).forEach(registerAlertEntity);
      if (!isLayerEnabled('disaster_alerts')) {
        setLayerEntitiesVisible('disaster_alerts', false);
      }
    } catch (err) {
      recordFeedError('weather alerts', err);
    }
  }

  async function loadSpaceWeather(viewer: Cesium.Viewer) {
    try {
      // Remove old space_weather entities before creating new ones
      const oldEnts = entityStoreRef.current['space_weather'];
      if (oldEnts) oldEnts.forEach(e => viewer.entities.remove(e));
      entityStoreRef.current['space_weather'] = [];

      const rows = await apiGet<string[][]>('/space-weather/kp');
      const recent = rows.slice(-5).reverse();
      const spaceEnts = recent.map((row, i) => {
        const kp = Number(row[1] ?? 0);
        const lat = 65 - i * 5;
        const lon = -95 + i * 30;
        if (isLayerEnabled('space_weather')) {
          pushIntelFeed({
            id: `kp-${row[0]}`,
            title: `Geomagnetic Kp ${kp}`,
            source: 'NOAA SWPC',
            type: 'space_weather',
            lat, lon,
            timestamp: Date.now() - i * 1800000,
            url: 'https://www.swpc.noaa.gov/products/planetary-k-index',
            platform: 'internal',
          });
        }
        return viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          name: `Kp ${kp}`,
          billboard: { image: createPulsingDotCanvas('#f97316', 18), width: 18, height: 18,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
          properties: { layer: 'space_weather', kpIndex: kp, name: `Kp ${kp}`, lon, lat, time: Date.now() },
        });
      });
      entityStoreRef.current['space_weather'] = spaceEnts;
      if (!isLayerEnabled('space_weather')) {
        setLayerEntitiesVisible('space_weather', false);
      }
    } catch (err) {
      recordFeedError('space weather', err);
    }
  }

  const loadAllData = useCallback(async (viewer: Cesium.Viewer) => {
    feedErrorsRef.current = [];
    feedSummaryShownRef.current = false;

    await Promise.all([
      loadEarthquakes(viewer),
      loadEonetEvents(viewer),
      apiGet<Record<string, unknown>>('/tectonic').then(async (geo) => {
        const src = await loadTectonicPlates(viewer, geo);
        entityStoreRef.current['tectonic'] = [...src.entities.values];
        if (!isLayerEnabled('tectonic')) {
          setLayerEntitiesVisible('tectonic', false);
        }
      }).catch((err) => {
        recordFeedError('tectonic plates', err);
      }),
      loadNwsAlerts(viewer),
      loadSpaceWeather(viewer),
    ]);

    if (isLayerEnabled('flight_tracks')) {
      await loadFlightTracks(viewer);
    }

    showFeedSummaryOnce();
    updateCounts();

    fetch('https://raw.githubusercontent.com/mwgg/Airports/master/airports.json')
      .then(r => r.json())
      .then((data: Record<string, Record<string, unknown>>) => {
        const apList = Object.values(data).filter((a: Record<string, unknown>) => a.Size && (a.Size as number) >= 3);
        entityStoreRef.current['airports'] = apList.slice(0, 300).map(a => viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(a.lon as number, a.lat as number),
          name: a.name as string,
          billboard: { image: createAirportIcon(), width: 12, height: 12,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
          label: { text: (a.iata as string) || (a.icao as string), font: '9px "JetBrains Mono"',
            fillColor: Cesium.Color.fromCssColorString('#14b8a6'),
            pixelOffset: new Cesium.Cartesian2(0, -8), show: (a.Size as number) >= 5 },
          properties: { layer: 'airports', ...a },
        }));
        if (!isLayerEnabled('airports')) setLayerEntitiesVisible('airports', false);
        updateCounts();
      })
      .catch((err) => recordFeedError('airports', err));

    setLoadingProgress(70);
  }, []);

  async function refreshLiveData(viewer: Cesium.Viewer) {
    if (isLayerEnabled('earthquakes')) await loadEarthquakes(viewer);
    if (isLayerEnabled('wildfires') || isLayerEnabled('severe_storms') || isLayerEnabled('volcanoes')
      || isLayerEnabled('floods') || isLayerEnabled('dust') || isLayerEnabled('seaLakeIce')) {
      await loadEonetEvents(viewer);
    }
    if (isLayerEnabled('flight_tracks')) await loadFlightTracks(viewer);
    if (isLayerEnabled('lightning_strikes')) await loadLightningStrikes(viewer);
    if (isLayerEnabled('aurora_oval')) await loadAuroraOval(viewer);
    if (isLayerEnabled('space_weather')) await loadSpaceWeather(viewer);
    if (isLayerEnabled('disaster_alerts')) await loadNwsAlerts(viewer);
    if (isLayerEnabled('india_cctv')) await loadIndiaCctv(viewer);
    if (isLayerEnabled('nasa_dsn')) {
      try {
        const data = await apiGet<any>('/nasa-dsn');
        if (isLayerEnabled('nasa_dsn')) {
          removeLayerEntities('nasa_dsn');
          const ents = addNasaDsnEntities(viewer, data);
          entityStoreRef.current['nasa_dsn'] = ents;
        }
      } catch (err) {
        console.warn('Failed to refresh NASA DSN:', err);
      }
    }
    viewer.scene.requestRender();
  }

  function updateCounts() {
    const v = viewerRef.current;
    if (!v) return;
    const ignoreLayers = new Set([
      'focus',
      'weather_cards',
      'pin',
      'india_cctv',
      'storm_forecast',
      'smoke_dispersion',
      'tsunami',
      'disaster_near_me',
    ]);
    const visibleEntities = v.entities.values.filter(e => {
      const p = e.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      const layer = p?.layer as string | undefined;
      return !layer || !ignoreLayers.has(layer);
    });
    setTotalEntities(visibleEntities.length);
    let evCount = 0;
    for (const e of visibleEntities) {
      const p = e.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      if (p?.layer && p.layer !== 'earthquakes' && p.layer !== 'tectonic') evCount++;
    }
    setActiveEvents(evCount);
  }

  function getEventColor(cat: string): string {
    const map: Record<string, string> = {
      wildfires:'#f97316', severe_storms:'#a855f7', volcanoes:'#f59e0b', floods:'#3b82f6',
      drought:'#a855f7', dustHaze:'#a16207', dust:'#a16207', landslides:'#78350f', earthquakes:'#ef4444',
      snow:'#93c5fd', waterColor:'#0ea5e9', temperature:'#ef4444', seaLakeIce:'#93c5fd',
    };
    return map[cat] || '#64748b';
  }

  function normalizeEventLayerId(cat: string): string {
    if (cat === 'severeStorms') return 'severe_storms';
    if (cat === 'dustHaze') return 'dust';
    return cat;
  }

  function createPulsingDotCanvas(color: string, size: number = 16): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const cx = size/2, cy = size/2, r = size*0.35;
    const glow = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, size * 0.5);
    glow.addColorStop(0, Cesium.Color.fromCssColorString(color).withAlpha(0.95).toCssColorString());
    glow.addColorStop(0.45, Cesium.Color.fromCssColorString(color).withAlpha(0.42).toCssColorString());
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = Cesium.Color.fromCssColorString(color).withAlpha(0.9).toCssColorString();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
    ctx.strokeStyle = Cesium.Color.fromCssColorString(color).withAlpha(0.75).toCssColorString();
    ctx.lineWidth = 1.1;
    ctx.stroke();
    return canvas;
  }

  function createPlaneIcon(heading: number, color = '#00D4FF'): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 24; canvas.height = 24;
    const ctx = canvas.getContext('2d')!;
    ctx.save();
    ctx.translate(12, 12);
    ctx.rotate((heading * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(-3, 2);
    ctx.lineTo(-8, 6);
    ctx.lineTo(-3, 4);
    ctx.lineTo(0, 8);
    ctx.lineTo(3, 4);
    ctx.lineTo(8, 6);
    ctx.lineTo(3, 2);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    return canvas;
  }

  function createAirportIcon(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 12; canvas.height = 12;
    const ctx = canvas.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(6, 6, 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#14b8a6';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    return canvas;
  }

  function getSeverityColor(severity: string): string {
    if (severity === 'red') return '#ef4444';
    if (severity === 'orange') return '#f97316';
    return '#22c55e';
  }

  function registerAlertEntity(alert: EventAlert) {
    const v = viewerRef.current;
    if (!v) return;
    const existing = alertEntityRef.current[alert.id];
    if (existing) {
      existing.show = true;
      return existing;
    }
    const ent = v.entities.add({
      position: Cesium.Cartesian3.fromDegrees(alert.lon, alert.lat, 5000),
      name: alert.title,
      billboard: {
        image: createPinIcon(getSeverityColor(alert.severity), 24),
        width: 24,
        height: 24,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: alert.title,
        font: '10px "JetBrains Mono"',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        show: false,
      },
      properties: {
        layer: 'disaster_alerts',
        title: alert.title,
        desc: alert.desc,
        severity: alert.severity,
        type: alert.type,
        lat: alert.lat,
        lon: alert.lon,
        time: alert.timestamp,
      },
    });
    alertEntityRef.current[alert.id] = ent;
    if (!entityStoreRef.current['disaster_alerts']) entityStoreRef.current['disaster_alerts'] = [];
    entityStoreRef.current['disaster_alerts'].push(ent);
    return ent;
  }

  function focusLocation(lat: number, lon: number, options?: { label?: string; color?: string; height?: number; duration?: number; }) {
    const v = viewerRef.current;
    if (!v) return;
    if (focusMarkerRef.current) {
      v.entities.remove(focusMarkerRef.current);
      focusMarkerRef.current = null;
    }
    const height = options?.height ?? 150;
    const marker = v.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, height),
      name: options?.label ?? 'Selected Location',
      billboard: {
        image: createPinIcon(options?.color ?? '#60a5fa', 24),
        width: 24,
        height: 24,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: options?.label ? {
        text: options.label,
        font: '11px "JetBrains Mono"',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cesium.Cartesian2(0, -18),
      } : undefined,
      properties: {
        layer: 'focus',
        title: options?.label ?? 'Selected Location',
        lat,
        lon,
        time: Date.now(),
      },
    });
    focusMarkerRef.current = marker;
    cinematicFlyTo(v, lon, lat, height, options?.duration ?? 2.5);
  }

  function flyToIndiaDirect() {
    const v = viewerRef.current;
    if (!v) return;
    setImagery('satellite');
    if (focusMarkerRef.current) {
      v.entities.remove(focusMarkerRef.current);
      focusMarkerRef.current = null;
    }
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(78.5, 21.0, 4200000),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-85),
        roll: 0,
      },
      duration: 2.5,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }

  function isLayerEnabled(layerId: string) {
    return layersRef.current.find(l => l.id === layerId)?.on ?? false;
  }

  function setLayerEntitiesVisible(layerId: string, visible: boolean) {
    const ents = entityStoreRef.current[layerId];
    if (!ents) return;
    ents.forEach(ent => {
      if (ent) ent.show = visible;
    });
  }

  function removeLayerEntities(layerId: string) {
    const v = viewerRef.current;
    const ents = entityStoreRef.current[layerId];
    if (!ents) return;
    if (v) {
      ents.forEach(ent => v.entities.remove(ent));
      if (layerId === 'submarine_cables' && submarineCablesDataSourceRef.current) {
        v.dataSources.remove(submarineCablesDataSourceRef.current, true);
        submarineCablesDataSourceRef.current = null;
      }
    }
    entityStoreRef.current[layerId] = [];
  }

  function clearStormForecastOverlays() {
    removeLayerEntities('storm_forecast');
    stormOverlaysRef.current = [];
    setShowStormLegend(false);
  }

  function renderStormForecastOverlays() {
    const v = viewerRef.current;
    if (!v) return;
    if (!isLayerEnabled('storm_forecast') || !isLayerEnabled('severe_storms')) {
      clearStormForecastOverlays();
      return;
    }

    clearStormForecastOverlays();

    const storms = entityStoreRef.current['severe_storms'] || [];
    const overlays: Cesium.Entity[] = [];

    storms.forEach((stormEnt, index) => {
      if (!stormEnt.show) return;
      const props = stormEnt.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      if (!props || props.lat == null || props.lon == null) return;

      const lat = Number(props.lat);
      const lon = Number(props.lon);
      const wind = Number(props.windSpeed ?? (90 + (index % 4) * 5));
      const pressure = Number(props.pressure ?? Math.max(900, 990 - wind / 2));
      const forecast = generateStormForecast(lat, lon, wind, pressure);
      const title = String(props.title ?? stormEnt.name ?? 'Storm');
      const time = Number(props.time ?? Date.now());

      const addCone = (positions: Cesium.Cartesian3[], fill: string, confidence: string) => {
        const color = Cesium.Color.fromCssColorString(fill);
        const ent = v.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: color.withAlpha(0.18),
            outline: true,
            outlineColor: color.withAlpha(0.7),
            outlineWidth: 1,
          },
          properties: {
            layer: 'storm_forecast',
            title,
            lat,
            lon,
            windSpeed: wind,
            pressure,
            heading: forecast.heading,
            speedKmh: forecast.speedKmh,
            time,
            confidence,
            stormTrack: forecast.track,
          },
        });
        overlays.push(ent);
      };

      addCone(forecast.cone24.positions, '#ff3b30', '24h');
      addCone(forecast.cone48.positions, '#f59e0b', '48h');
      addCone(forecast.cone72.positions, '#eab308', '72h');

      const trackPositions = forecast.track.map(pt => Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 5000));
      const trackEnt = v.entities.add({
        polyline: {
          positions: trackPositions,
          width: 2,
          material: Cesium.Color.fromCssColorString('#ec4899').withAlpha(0.9),
          clampToGround: true,
        },
        properties: {
          layer: 'storm_forecast',
          title,
          lat,
          lon,
          windSpeed: wind,
          pressure,
          heading: forecast.heading,
          speedKmh: forecast.speedKmh,
          time,
          stormTrack: forecast.track,
        },
      });
      overlays.push(trackEnt);
    });

    stormOverlaysRef.current = overlays;
    entityStoreRef.current['storm_forecast'] = overlays;
    setShowStormLegend(overlays.length > 0);
  }

  function clearSmokeDispersionOverlays() {
    removeLayerEntities('smoke_dispersion');
    smokeParticlesRef.current = [];
    setShowSmokeLegend(false);
  }

  function renderSmokeDispersionOverlays() {
    const v = viewerRef.current;
    if (!v) return;
    if (!isLayerEnabled('smoke_dispersion') || !isLayerEnabled('wildfires')) {
      clearSmokeDispersionOverlays();
      return;
    }

    clearSmokeDispersionOverlays();

    const fires = entityStoreRef.current['wildfires'] || [];
    const smokeEnts: Cesium.Entity[] = [];

    fires.forEach((fireEnt, index) => {
      if (!fireEnt.show) return;
      const props = fireEnt.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      if (!props || props.lat == null || props.lon == null) return;

      const lat = Number(props.lat);
      const lon = Number(props.lon);
      const fireSeed = Math.abs(Math.sin(lat * 13.37 + lon * 7.91 + index));
      const windDir = (fireSeed * 360) % 360;
      const windSpd = 10 + (fireSeed * 20);
      const end = destinationPoint(lat, lon, windSpd * 2.2, windDir);

      for (let i = 0; i < 8; i++) {
        const t = i / 7;
        const pLon = lon + (end.lon - lon) * t + (Math.random() - 0.5) * 0.35;
        const pLat = lat + (end.lat - lat) * t + (Math.random() - 0.5) * 0.22;
        const size = 3 + t * 10;
        const alpha = 0.24 * (1 - t * 0.5);
        smokeEnts.push(v.entities.add({
          position: Cesium.Cartesian3.fromDegrees(pLon, pLat),
          ellipse: {
            semiMinorAxis: size * 1000,
            semiMajorAxis: size * 1000,
            material: Cesium.Color.fromCssColorString('#78716c').withAlpha(alpha),
            outline: false,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          properties: {
            layer: 'smoke_dispersion',
            title: String(props.title ?? 'Smoke plume'),
            lat: pLat,
            lon: pLon,
            time: Number(props.time ?? Date.now()),
          },
        }));
      }

      const corePulse = makeSafeAnimatedRadiusPair(
        () => 1200 + Math.sin((Date.now() + index * 137) / 900) * 350,
        1.1
      );

      smokeEnts.push(v.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        ellipse: {
          semiMinorAxis: new Cesium.CallbackProperty(() => corePulse.minor(), false) as unknown as number,
          semiMajorAxis: new Cesium.CallbackProperty(() => corePulse.major(), false) as unknown as number,
          material: Cesium.Color.fromCssColorString('#44403c').withAlpha(0.28),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#78716c').withAlpha(0.45),
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        properties: {
          layer: 'smoke_dispersion',
          title: String(props.title ?? 'Smoke plume'),
          lat,
          lon,
          time: Number(props.time ?? Date.now()),
        },
      }));
    });

    smokeParticlesRef.current = smokeEnts;
    entityStoreRef.current['smoke_dispersion'] = smokeEnts;
    setShowSmokeLegend(smokeEnts.length > 0);
  }

  function clearDisasterNearMeOverlay() {
    removeLayerEntities('disaster_near_me');
  }

  function getCameraFallbackLocation() {
    const v = viewerRef.current;
    if (!v) return { lat: 0, lon: 0 };
    const cart = v.camera.positionCartographic;
    return {
      lat: Cesium.Math.toDegrees(cart.latitude),
      lon: Cesium.Math.toDegrees(cart.longitude),
    };
  }

  function renderDisasterNearMeLayer() {
    const v = viewerRef.current;
    if (!v) return;

    if (entityStoreRef.current['disaster_near_me']?.length) {
      setLayerEntitiesVisible('disaster_near_me', true);
      if (geolocationWatchRef.current === null && navigator.geolocation) {
        startLocationWatch();
      }
      return;
    }

    const renderAt = (lat: number, lon: number, fly: boolean) => {
      if (!isLayerEnabled('disaster_near_me')) return;
      clearDisasterNearMeOverlay();
      lastKnownLocationRef.current = { lat, lon };

      const marker = v.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 5000),
        ellipse: {
          semiMajorAxis: 500000, semiMinorAxis: 500000,
          material: Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.12),
          outline: true, outlineColor: Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.5),
          outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: 'Disasters Near Me', font: '11px "JetBrains Mono"',
          fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2, pixelOffset: new Cesium.Cartesian2(0, -18),
        },
        properties: { layer: 'disaster_near_me', title: 'Disasters Near Me', lat, lon, time: Date.now() },
      });

      entityStoreRef.current['disaster_near_me'] = [marker];
      v.scene.requestRender();
      if (fly) {
        focusLocation(lat, lon, { label: 'Disasters Near Me', color: '#ef4444', height: 1000000 });
      }
    };

    function startLocationWatch() {
      if (geolocationWatchRef.current !== null) return;
      const vv = viewerRef.current;
      geolocationWatchRef.current = navigator.geolocation.watchPosition(
        pos => {
          if (!isLayerEnabled('disaster_near_me')) return;
          const { latitude, longitude } = pos.coords;
          lastKnownLocationRef.current = { lat: latitude, lon: longitude };
          const existing = entityStoreRef.current['disaster_near_me'];
          if (existing?.length) {
            const marker = existing[0];
            marker.position = Cesium.Cartesian3.fromDegrees(longitude, latitude, 5000) as any;
            vv?.scene.requestRender();
            const nearby = findNearbyEvents(latitude, longitude, 500);
            if (nearby.length > 0) showNotification(`${nearby.length} nearby events`, 'info');
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 30000 },
      );
    }

    if (disasterNearMeRequestedRef.current) return;
    disasterNearMeRequestedRef.current = true;

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          if (!isLayerEnabled('disaster_near_me')) return;
          clearDisasterNearMeOverlay();
          renderAt(pos.coords.latitude, pos.coords.longitude, true);
          startLocationWatch();
        },
        () => {
          disasterNearMeRequestedRef.current = false;
          showNotification('Location access denied. Enable location in browser settings.', 'warning');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      disasterNearMeRequestedRef.current = false;
      showNotification('Geolocation not available in this browser.', 'warning');
    }
  }

  function refreshDerivedOverlays() {
    if (isLayerEnabled('storm_forecast') && isLayerEnabled('severe_storms')) {
      renderStormForecastOverlays();
    } else {
      clearStormForecastOverlays();
    }

    if (isLayerEnabled('smoke_dispersion') && isLayerEnabled('wildfires')) {
      renderSmokeDispersionOverlays();
    } else {
      clearSmokeDispersionOverlays();
    }

    if (isLayerEnabled('disaster_near_me')) {
      if (entityStoreRef.current['disaster_near_me']?.length) {
        setLayerEntitiesVisible('disaster_near_me', true);
      }
    } else {
      clearDisasterNearMeOverlay();
    }

    if (!isLayerEnabled('tsunami')) {
      setShowTsunamiLegend(false);
    } else if ((entityStoreRef.current['tsunami'] || []).length > 0) {
      setShowTsunamiLegend(true);
    }
  }

  /* ═════════════════════════════════════════════════════════════════
     INFO PANEL
     ═════════════════════════════════════════════════════════════════ */

  const showInfoPanel = useCallback((entity: Cesium.Entity) => {
    setInfoEntity(entity);
    const props = entity.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
    if (!props) return;

    if (props.layer === 'earthquakes' && props.magnitude) {
      const m = props.magnitude as number;
      const lat = props.lat as number;
      const lon = props.lon as number;
      if (m >= 4.0) triggerSeismicWaves(lon, lat, m);
      if (m >= 7.5) {
        const isOcean = Math.abs(lat) < 70 && (Math.abs(lon) > 150 || Math.abs(lon - 180) < 30 || lat > 50 || lat < -50);
        if (isOcean) triggerTsunami(lon, lat, m);
      }
      const pi = calculatePopulationImpact(lat, lon);
      if (pi) setPopulationImpact(pi);
      else setPopulationImpact(null);
    } else if (props.layer === 'severe_storms') {
      const wind = props.windSpeed as number || 100;
      const pressure = props.pressure as number || 950;
      const lat = props.lat as number;
      const lon = props.lon as number;
      const fc = generateStormForecast(lat, lon, wind, pressure);
      setStormForecast(fc);
    } else {
      setStormForecast(null);
      setPopulationImpact(null);
    }
  }, []);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;

    // Clear old debris orbit lines
    if (selectedDebrisOrbitEntityRef.current) {
      v.entities.remove(selectedDebrisOrbitEntityRef.current);
      selectedDebrisOrbitEntityRef.current = null;
    }

    if (!infoEntity) return;

    const p = infoEntity.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
    if (p?.layer === 'space_debris') {
      const orbitPositions = getDebrisOrbitPositions(p, v.clock.currentTime);
      selectedDebrisOrbitEntityRef.current = v.entities.add({
        polyline: {
          positions: orbitPositions,
          width: 2.0,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#d8b4fe').withAlpha(0.75),
            dashLength: 16,
          }),
        },
      });
    }
  }, [infoEntity]);

  useEffect(() => {
    if (!viewerRef.current) return;
    if (import.meta.env.DEV) {
      window.__liveglobeDebug = {
        ...(window.__liveglobeDebug ?? {}),
        viewer: viewerRef.current,
        getCameraState: () => {
          const c = viewerRef.current?.camera.positionCartographic;
          if (!c) return { lat: 0, lon: 0, height: 0 };
          return {
            lat: Cesium.Math.toDegrees(c.latitude),
            lon: Cesium.Math.toDegrees(c.longitude),
            height: c.height,
          };
        },
        showInfoEntity: (layerId: string, index: number = 0) => {
          const ent = entityStoreRef.current[layerId]?.[index];
          if (!ent) return false;
          showInfoPanel(ent);
          return true;
        },
      };
    }
  }, [showInfoPanel]);

  function triggerSeismicWaves(lon: number, lat: number, mag: number) {
    const v = viewerRef.current;
    if (!v) return;
    const maxRadius = Math.min(20, 2 + mag * 2);
    const waveId = Date.now();
    const makeWaveRadius = (startKey: 'pStart' | 'sStart' | 'surfStart', divisor: number, cap: number) =>
      makeSafeAnimatedRadiusPair(() => {
        const data = seismicAnimationsRef.current.find(a => a.id === waveId);
        const startedAt = data?.[startKey] || 0;
        const elapsed = Cesium.JulianDate.toDate(v.clock.currentTime).getTime() - startedAt;
        return elapsed > 0 ? Math.min(cap, elapsed / divisor) : 0;
      }, 1.05);
    const pRadius = makeWaveRadius('pStart', 3000, maxRadius);
    const sRadius = makeWaveRadius('sStart', 5000, maxRadius * 0.6);
    const surfRadius = makeWaveRadius('surfStart', 8000, maxRadius * 0.4);

    const pWave = v.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      ellipse: {
        semiMinorAxis: new Cesium.CallbackProperty(() => pRadius.minor(), false) as unknown as number,
        semiMajorAxis: new Cesium.CallbackProperty(() => pRadius.major(), false) as unknown as number,
        material: new Cesium.ColorMaterialProperty(Cesium.Color.RED.withAlpha(0.15)),
        outline: true, outlineColor: Cesium.Color.RED.withAlpha(0.4), outlineWidth: 1.5,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });

    const sWave = v.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      ellipse: {
        semiMinorAxis: new Cesium.CallbackProperty(() => sRadius.minor(), false) as unknown as number,
        semiMajorAxis: new Cesium.CallbackProperty(() => sRadius.major(), false) as unknown as number,
        material: new Cesium.ColorMaterialProperty(Cesium.Color.BLUE.withAlpha(0.12)),
        outline: true, outlineColor: Cesium.Color.BLUE.withAlpha(0.3), outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });

    const surfWave = v.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      ellipse: {
        semiMinorAxis: new Cesium.CallbackProperty(() => surfRadius.minor(), false) as unknown as number,
        semiMajorAxis: new Cesium.CallbackProperty(() => surfRadius.major(), false) as unknown as number,
        material: new Cesium.ColorMaterialProperty(Cesium.Color.ORANGE.withAlpha(0.1)),
        outline: true, outlineColor: Cesium.Color.ORANGE.withAlpha(0.25), outlineWidth: 0.8,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });

    const now = Date.now();
    const waveData: SeismicWaveData = {
      id: waveId, lon, lat, aRadius: maxRadius,
      pStart: now, sStart: now + 5000, surfStart: now + 12000,
      pEnt: pWave, sEnt: sWave, surfEnt: surfWave, interval: null,
    };

    const interval = setInterval(() => {
      const t = Date.now() - now;
      if (t > 30000) {
        clearInterval(interval);
        v.entities.remove(pWave);
        v.entities.remove(sWave);
        v.entities.remove(surfWave);
        seismicAnimationsRef.current = seismicAnimationsRef.current.filter(a => a.id !== waveId);
      }
    }, 1000);
    waveData.interval = interval;
    seismicAnimationsRef.current.push(waveData);
  }

  function triggerTsunami(lon: number, lat: number, mag: number) {
    const v = viewerRef.current;
    if (!v) return;
    const maxR = Math.min(50, mag * 6);
    const colors = ['#22c55e','#f59e0b','#f97316','#ef4444'];
    const labels = ['1h','3h','6h','12h'];
    const speeds = [1, 0.6, 0.35, 0.2];
    const createdWaves: Cesium.Entity[] = [];
    const tsunamiEnabled = isLayerEnabled('tsunami');
    if (tsunamiEnabled) setShowTsunamiLegend(true);

    for (let i = 0; i < 4 && tsunamiEnabled; i++) {
      setTimeout(() => {
        const c = Cesium.Color.fromCssColorString(colors[i]);
        const ring = v.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          ellipse: {
            semiMinorAxis: 0, semiMajorAxis: 0,
            material: c.withAlpha(0.08 + i * 0.02),
            outline: true, outlineColor: c.withAlpha(0.3 + i * 0.1), outlineWidth: 1.5,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          label: { text: labels[i], font: 'bold 10px "JetBrains Mono"', fillColor: c, show: false },
          properties: {
            layer: 'tsunami',
            title: 'Tsunami Wave',
            lat,
            lon,
            time: Date.now(),
            travelTime: labels[i],
            magnitude: mag,
          },
        });
        const startT = Date.now();
        const iv = setInterval(() => {
          const elapsed = (Date.now() - startT) / 1000;
          const progress = easeOutCubic(Math.min(1, elapsed / 20));
          const curR = maxR * speeds[i] * progress;
          if (ring.ellipse) {
            (ring.ellipse.semiMinorAxis as Cesium.ConstantProperty).setValue(curR * 1000);
            (ring.ellipse.semiMajorAxis as Cesium.ConstantProperty).setValue(curR * 1000);
          }
          if (elapsed > 20) {
            clearInterval(iv);
            v.entities.remove(ring);
            const ringIdx = createdWaves.indexOf(ring);
            if (ringIdx >= 0) createdWaves.splice(ringIdx, 1);
            tsunamiWavesRef.current = tsunamiWavesRef.current.filter(e => e !== ring);
            entityStoreRef.current['tsunami'] = (entityStoreRef.current['tsunami'] || []).filter(e => e !== ring);
          }
        }, 50);
        createdWaves.push(ring);
        tsunamiWavesRef.current.push(ring);
        if (!entityStoreRef.current['tsunami']) entityStoreRef.current['tsunami'] = [];
        entityStoreRef.current['tsunami'].push(ring);
      }, i * 500);
    }

    const timestamp = Date.now();
    const alert: EventAlert = {
      id: `tsunami_${timestamp}`, title: 'Tsunami Warning',
      desc: `M${mag.toFixed(1)} earthquake may generate tsunami waves. Monitor local alerts.`,
      severity: 'red', type: 'tsunami', lat, lon, seen: false,
      time: new Date(timestamp).toISOString(), timestamp, hasMapPosition: true,
    };
    registerAlertEntity(alert);
    alertsRef.current.unshift(alert);
    setAlerts([...alertsRef.current]);
    setNewAlertCount(prev => prev + 1);
    focusLocation(lat, lon, { label: 'Tsunami alert', color: '#ef4444', height: 150 });
    showNotification('Tsunami Warning triggered', 'error');
  }

  function _triggerSmoke(lon: number, lat: number) {
    const v = viewerRef.current;
    if (!v) return;
    const windDir = Math.random() * 360;
    const windSpd = 10 + Math.random() * 20;
    const dest = destinationPoint(lat, lon, windSpd * 2, windDir);
    const newParticles: Cesium.Entity[] = [];

    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const pLon = lon + (dest.lon - lon) * t + (Math.random() - 0.5) * 0.5;
      const pLat = lat + (dest.lat - lat) * t + (Math.random() - 0.5) * 0.3;
      const size = 2 + t * 8;
      const alpha = 0.15 * (1 - t * 0.5);
      const particle = v.entities.add({
        position: Cesium.Cartesian3.fromDegrees(pLon, pLat),
        ellipse: {
          semiMinorAxis: size * 1000, semiMajorAxis: size * 1000,
          material: Cesium.Color.GRAY.withAlpha(alpha),
          outline: false,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
      newParticles.push(particle);
    }

    const corePulse = makeSafeAnimatedRadiusPair(
      () => 1000 + Math.sin(Date.now() / 1000) * 500,
      1.1
    );

    const core = v.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      ellipse: {
        semiMinorAxis: new Cesium.CallbackProperty(() => corePulse.minor(), false) as unknown as number,
        semiMajorAxis: new Cesium.CallbackProperty(() => corePulse.major(), false) as unknown as number,
        material: Cesium.Color.DARKGRAY.withAlpha(0.3),
        outline: true, outlineColor: Cesium.Color.GRAY.withAlpha(0.5), outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
    newParticles.push(core);
    smokeParticlesRef.current.push(...newParticles);

    setTimeout(() => {
      newParticles.forEach(p => v.entities.remove(p));
      smokeParticlesRef.current = smokeParticlesRef.current.filter(p => !newParticles.includes(p));
    }, 30000);
  }

  function checkMagnitudeAlert(mag: number, place: string, time: number, lat: number, lon: number) {
    if (Date.now() - time < 3600000) {
      const timestamp = Date.now();
      const alert: EventAlert = {
        id: `eq_${time}`, title: `M${mag.toFixed(1)} Earthquake Detected`,
        desc: `${place} - Significant seismic event`,
        severity: mag >= 7 ? 'red' : mag >= 6 ? 'orange' : 'green',
        type: 'earthquake', lat, lon, seen: false, time: new Date(time).toISOString(), timestamp,
        hasMapPosition: true,
      };
      registerAlertEntity(alert);
      alertsRef.current.unshift(alert);
      setAlerts([...alertsRef.current]);
      setNewAlertCount(prev => prev + 1);
      showNotification(`M${mag.toFixed(1)} earthquake detected`, 'error');
      if (mag >= 6.5) requestNotification(`M${mag.toFixed(1)} Earthquake Alert`, place);
    }
  }

  const bulkOperationRef = useRef(false);

  function showNotification(text: string, severity: string) {
    if (bulkOperationRef.current) return;
    const id = Date.now();
    setNotifications(prev => [...prev, { id, text, severity }]);
    const t = setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
      try { delete notificationTimeoutsRef.current[id]; } catch { /* ignore */ }
    }, 2000);
    notificationTimeoutsRef.current[id] = t;
  }

  function recordFeedError(source: string, err?: unknown) {
    feedErrorsRef.current.push(source);
    console.warn(`[LiveGlobe] ${source} unavailable`, err);
  }

  function showFeedSummaryOnce() {
    const failed = feedErrorsRef.current;
    if (failed.length === 0 || feedSummaryShownRef.current) return;
    const critical = ['earthquakes', 'natural events', 'tectonic plates'];
    const hasCriticalFailure = failed.some(f => critical.includes(f));
    if (!hasCriticalFailure && failed.length < 2) return;
    feedSummaryShownRef.current = true;
    showNotification(
      `Some feeds unavailable (${failed.join(', ')}). Run "npm run dev" for the API proxy, or data will load via direct APIs when possible.`,
      'warning',
    );
  }

  function requestNotification(title: string, body: string) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    } else if ('Notification' in window && Notification.permission !== 'denied') {
      Notification.requestPermission().then(p => {
        if (p === 'granted') new Notification(title, { body, icon: '/favicon.ico' });
      });
    }
  }

  /* ═════════════════════════════════════════════════════════════════
     TIMELINE
     ═════════════════════════════════════════════════════════════════ */

  const toggleTimeline = useCallback(() => {
    setShowTimeline(p => !p);
  }, []);

  const startTimeline = useCallback(() => {
    if (timelineRef.current.active) return;
    timelineRef.current.active = true;
    timelineRef.current.interval = setInterval(() => {
      timelineRef.current.current += 60000 * timelineRef.current.speed;
      if (timelineRef.current.current >= timelineRef.current.end) {
        timelineRef.current.current = timelineRef.current.start;
      }
      setTimelineValue(Math.round(((timelineRef.current.current - timelineRef.current.start) /
        (timelineRef.current.end - timelineRef.current.start)) * 100));
      throttledTimelineFilter();
    }, 50);
  }, []);

  const pauseTimeline = useCallback(() => {
    timelineRef.current.active = false;
    if (timelineRef.current.interval) clearInterval(timelineRef.current.interval);
  }, []);

  const resetTimeline = useCallback(() => {
    pauseTimeline();
    timelineRef.current.current = timelineRef.current.start;
    setTimelineValue(0);
    clearTimelineFilter();
  }, [pauseTimeline]);

  const stopTimeline = useCallback(() => {
    pauseTimeline();
    setShowTimeline(false);
  }, [pauseTimeline]);

  const _changeTimelineSpeed = useCallback((speed: number) => {
    timelineRef.current.speed = speed;
    if (timelineRef.current.active) { pauseTimeline(); startTimeline(); }
  }, [pauseTimeline, startTimeline]);

  const handleTimelineSlider = useCallback((val: number) => {
    const t = timelineRef.current;
    t.current = t.start + (t.end - t.start) * (val / 100);
    setTimelineValue(val);
    throttledTimelineFilter();
  }, []);

  function throttledTimelineFilter() {
    const now = Date.now();
    if (now - timelineLastUpdateRef.current < 200) return;
    timelineLastUpdateRef.current = now;
    if (timelineThrottleRef.current) clearTimeout(timelineThrottleRef.current);
    timelineThrottleRef.current = setTimeout(() => filterEntitiesByTime(timelineRef.current.current), 50);
  }

  function filterEntitiesByTime(timeMs: number) {
    const v = viewerRef.current;
    if (!v) return;
    const time = new Date(timeMs);
    for (const entity of v.entities.values) {
      const props = entity.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      if (!props?.time) continue;
      const entityTime = new Date(props.time as number);
      const diff = Math.abs(entityTime.getTime() - time.getTime());
      const visible = diff < 3600000;
      entity.show = visible;
    }
  }

  function clearTimelineFilter() {
    const v = viewerRef.current;
    if (!v) return;
    for (const entity of v.entities.values) {
      if (entity.show !== undefined) entity.show = true;
    }
  }

  /* ═════════════════════════════════════════════════════════════════
     IMAGERY
     ═════════════════════════════════════════════════════════════════ */

  const imageryGenRef = useRef(0);

  const setImagery = useCallback((type: string) => {
    const v = viewerRef.current;
    if (!v) return;
    setActiveImagery(type);
    try {
      if (type === 'terrain') {
        imageryGenRef.current += 1;
        const gen = imageryGenRef.current;
        void (async () => {
          const enabled = await applyTerrainProvider(v, cesiumIonToken);
          if (gen !== imageryGenRef.current) return;
          crossfadeImagery(v, 'terrain');
          showNotification(
            enabled ? '3D terrain enabled' : 'Terrain needs a Cesium ion token',
            enabled ? 'success' : 'warning',
          );
          v.scene.requestRender();
        })();
        return;
      }
      const mapType = type === 'satellite'
        ? 'satellite'
        : type === 'dark'
          ? 'dark'
          : 'earth';
      crossfadeImagery(v, mapType);
    } catch (e) {
      console.error('Imagery error:', e);
    }
  }, []);

  /* ═════════════════════════════════════════════════════════════════
     WEATHER CARDS
     ═════════════════════════════════════════════════════════════════ */

  const addWeatherCard = useCallback((lat: number, lon: number) => {
    const id = `wc_${Date.now()}`;
    const card: WeatherCardData = { id, lat, lon, temp: 0, desc: '' };
    weatherCardsRef.current.push(card);
    setWeatherCards(prev => [...prev, card]);

    const v = viewerRef.current;
    if (v) {
      const marker = v.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 5000),
        name: 'Weather Location',
        billboard: {
          image: createPinIcon('#22d3ee', 20),
          width: 20,
          height: 20,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: 'Weather',
          font: '10px "JetBrains Mono"',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          show: false,
        },
        properties: { layer: 'weather_cards', title: 'Weather Location', lat, lon, time: Date.now() },
      });
      if (!entityStoreRef.current['weather_cards']) entityStoreRef.current['weather_cards'] = [];
      entityStoreRef.current['weather_cards'].push(marker);
    }

    weatherAbortRef.current?.abort();
    const controller = new AbortController();
    weatherAbortRef.current = controller;
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`, { signal: controller.signal })
      .then(r => r.json())
      .then((data: {current: {temperature_2m:number;relative_humidity_2m:number;wind_speed_10m:number;weather_code:number}}) => {
        if (controller.signal.aborted) return;
        const c = data.current;
        setWeatherCards(prev => prev.map(wc =>
          wc.id === id ? { ...wc, temp: c.temperature_2m, desc: getWeatherDesc(c.weather_code) } : wc
        ));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setWeatherCards(prev => prev.map(wc =>
          wc.id === id ? { ...wc, temp: 22, desc: 'Clear sky' } : wc
        ));
      });
  }, []);

  function getWeatherDesc(code: number): string {
    const map: Record<number, string> = {
      0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Foggy',
      48:'Depositing rime fog',51:'Light drizzle',53:'Drizzle',55:'Dense drizzle',
      61:'Slight rain',63:'Rain',65:'Heavy rain',71:'Slight snow',73:'Snow',
      75:'Heavy snow',95:'Thunderstorm',96:'Thunderstorm with hail',
    };
    return map[code] || 'Unknown';
  }

  /* ═════════════════════════════════════════════════════════════════
     ISS TRACKER
     ═════════════════════════════════════════════════════════════════ */

  const toggleISS = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (issEntityRef.current) {
      v.entities.remove(issEntityRef.current);
      issEntityRef.current = null;
      setShowISSInfo(false);
      if (issTimerRef.current) clearInterval(issTimerRef.current);
      issTimerRef.current = null;
      if (issRenderTickRef.current) { issRenderTickRef.current(); issRenderTickRef.current = null; }
      return;
    }

    const trail = new Cesium.SampledPositionProperty();
    trail.forwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE;
    trail.backwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE;
    issTrailRef.current = trail;
    issTimesRef.current = [];
    setShowISSInfo(true);

    // Keep the scene rendering every frame while ISS is active for smooth motion
    issRenderTickRef.current = v.clock.onTick.addEventListener(() => {
      if (issEntityRef.current) v.scene.requestRender();
    });

    issTimerRef.current = setInterval(() => {
      apiGet<{ latitude: number; longitude: number }>('/iss')
        .then((data) => {
          if (!issEntityRef.current && !issTrailRef.current) return;
          const pos = Cesium.Cartesian3.fromDegrees(data.longitude, data.latitude, 408000);
          const time = Cesium.JulianDate.now();
          trail.addSample(time, pos);
          issTimesRef.current.push(time);
          if (issTimesRef.current.length > 50) {
            trail.removeSample(issTimesRef.current.shift()!);
          }

          if (!issEntityRef.current) {
            issEntityRef.current = v.entities.add({
              position: trail,
              billboard: { image: createISSIcon(), width: 40, height: 40 },
              label: { text: 'ISS', font: 'bold 11px "JetBrains Mono"', fillColor: Cesium.Color.WHITE,
                pixelOffset: new Cesium.Cartesian2(0, -18) },
              path: { leadTime: 0, trailTime: 600, width: 3,
                material: Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.5),
                resolution: 120 },
            });
            trail.setInterpolationOptions({
              interpolationDegree: 1, interpolationAlgorithm: Cesium.LinearApproximation,
            });
          }
          setIssInfo({ lat: data.latitude, lon: data.longitude });
          v.scene.requestRender();
        })
        .catch(() => {
          showNotification('ISS position feed unavailable', 'warning');
        });
    }, 5000);
  }, []);

  function createISSIcon(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 40; canvas.height = 40;
    const ctx = canvas.getContext('2d')!;
    const cx = 20, cy = 20;

    // Outer glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 18);
    glow.addColorStop(0, 'rgba(255,255,255,0.25)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 40, 40);

    // Solar panels (left)
    ctx.fillStyle = '#78716c';
    ctx.fillRect(4, 14, 7, 12);
    ctx.fillStyle = '#a8a29e';
    ctx.fillRect(5, 15, 5, 10);

    // Solar panels (right)
    ctx.fillStyle = '#78716c';
    ctx.fillRect(29, 14, 7, 12);
    ctx.fillStyle = '#a8a29e';
    ctx.fillRect(30, 15, 5, 10);

    // Satellite body
    ctx.fillStyle = '#e5e5e5';
    ctx.fillRect(14, 13, 12, 14);
    ctx.fillStyle = '#d4d4d4';
    ctx.fillRect(15, 14, 10, 12);

    // Antenna dish
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, 12, 3, Math.PI, 2 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 3, 12);
    ctx.lineTo(cx, 8);
    ctx.lineTo(cx + 3, 12);
    ctx.stroke();

    // Blinking light (red)
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(cx, 10, 1.2, 0, Math.PI * 2);
    ctx.fill();

    return canvas;
  }

  /* ═════════════════════════════════════════════════════════════════
     SEARCH
     ═════════════════════════════════════════════════════════════════ */

  const handleSearch = useCallback((q: string) => {
    const trimmed = q.trim();
    setSearchValue(q);
    searchValueRef.current = q;
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!trimmed) {
      setSearchSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const coordinateMatch = parseCoordinateQuery(trimmed);
    if (coordinateMatch) {
      setSearchSuggestions([coordinateMatch]);
      setShowSuggestions(true);
      return;
    }

    const localResults = findLocalLocationMatches(trimmed);
    if (localResults.length > 0) {
      setSearchSuggestions(localResults);
      setShowSuggestions(true);
      if (localResults.length >= 4) return;
    } else {
      setSearchSuggestions([]);
      setShowSuggestions(true);
    }

    searchDebounceRef.current = setTimeout(() => {
      void doSearch(trimmed);
    }, 150);
  }, []);

  function doSearch(q: string) {
    const normalized = normalizeLocationQuery(q);
    if (!normalized) return;
    const cached = geocodeCacheRef.current[normalized] ?? geocodeCacheRef.current[q];
    if (cached?.length) {
      if (searchValueRef.current.trim() === q) {
        setSearchSuggestions(cached);
        setShowSuggestions(true);
      }
      return;
    }

    const localResults = findLocalLocationMatches(q);
    if (localResults.length > 0) {
      if (searchValueRef.current.trim() === q) {
        setSearchSuggestions(localResults);
        setShowSuggestions(true);
      }
      return;
    }

    const controller = new AbortController();
    searchAbortRef.current = controller;
    fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`, {
      signal: controller.signal,
    })
      .then(r => r.json())
      .then((results: Array<{display_name:string;lat:string;lon:string}>) => {
        const items = results.slice(0, 5).map(r => ({
          name: r.display_name, lat: parseFloat(r.lat), lon: parseFloat(r.lon),
        }));
        geocodeCacheRef.current[normalized] = items;
        if (searchValueRef.current.trim() === q) {
          setSearchSuggestions(items);
          setShowSuggestions(items.length > 0);
        }
      })
      .catch((err) => {
        if (String(err).includes('AbortError')) return;
        if (searchValueRef.current.trim() === q) setShowSuggestions(false);
      })
      .finally(() => {
        if (searchAbortRef.current === controller) searchAbortRef.current = null;
      });
  }

  function getBestSearchTarget(q: string): LocalSearchResult | null {
    const trimmed = q.trim();
    if (!trimmed) return null;
    return (
      parseCoordinateQuery(trimmed)
      ?? findLocalLocationMatches(trimmed, 1)[0]
      ?? geocodeCacheRef.current[normalizeLocationQuery(trimmed)]?.[0]
      ?? geocodeCacheRef.current[trimmed]?.[0]
      ?? null
    );
  }

  const goToLocation = useCallback((lat: number, lon: number, label?: string, color?: string, duration = 0.9) => {
    setShowSuggestions(false);
    focusLocation(lat, lon, { label, color, height: 150, duration });
  }, [focusLocation]);

  /* ═════════════════════════════════════════════════════════════════
     LAYER TOGGLES
     ═════════════════════════════════════════════════════════════════ */

  const toggleLayer = useCallback((layerId: string) => {
    setLayers(prev => {
      const wasOn = prev.find(l => l.id === layerId)?.on ?? false;
      let next: LayerItem[];

      if (wasOn) {
        next = prev.map(l => l.id === layerId ? { ...l, on: false } : l);
      } else {
        next = prev.map(l => l.id === layerId ? { ...l, on: true } : l);
      }

      layersRef.current = next;

      const updated = next.find(l => l.id === layerId);
      if (updated) {
        if (updated.on) { loadLayerData(updated.id); }
        else { hideLayerEntities(updated.id); }
        if (updated.type === 'tile') { setPulsingLayer(updated.id); setTimeout(() => setPulsingLayer(null), 600); }
      }

      if (['severe_storms', 'storm_forecast', 'wildfires', 'smoke_dispersion'].includes(layerId)) {
        refreshDerivedOverlays();
      }

      return next;
    });
  }, []);

  function loadLayerData(layerId: string) {
    const v = viewerRef.current;
    if (!v) return;

    // Helper: show existing entities for entity-based layers
    const showExisting = (id: string) => {
      const ents = entityStoreRef.current[id];
      if (ents?.length) {
        setLayerEntitiesVisible(id, true);
        return true;
      }
      return false;
    };

    if (layerId === 'population_impact') {
      loadPopulationImpact(v);
      setLayerEntitiesVisible('population_impact', true);
      setShowPopulationImpact(true);
    } else if (layerId === 'heatmap' && entityStoreRef.current['earthquakes']) {
      if (entityStoreRef.current['heatmap']?.length) {
        entityStoreRef.current['heatmap'].forEach(e => { if (e) e.show = true; });
        setShowHeatmapLegend(true);
      } else {
        generateHeatmap(v);
      }
    } else if (layerId === 'intel_feed') {
      setShowIntelFeed(true);
      void loadSocialFeed();
    } else if (layerId === 'disaster_alerts') {
      setShowAlertsPanel(true);
      entityStoreRef.current['disaster_alerts']?.forEach(e => { if (e) e.show = true; });
    } else if (layerId === 'india_cctv') {
      if (!showExisting('india_cctv')) void loadIndiaCctv(v);
      return;
    } else if (layerId === 'storm_forecast' || layerId === 'smoke_dispersion') {
      refreshDerivedOverlays();
    } else if (layerId === 'disaster_near_me') {
      renderDisasterNearMeLayer();
    } else if (layerId === 'flight_tracks') {
      if (!showExisting('flight_tracks')) void loadFlightTracks(v);
      return;
    } else if (layerId === 'space_debris') {
      if (!showExisting('space_debris')) void loadSpaceDebris(v);
      return;
    } else if (layerId === 'nasa_dsn') {
      if (!showExisting('nasa_dsn')) void loadNasaDsn(v);
      return;
    } else if (layerId === 'lightning_strikes') {
      if (!showExisting('lightning_strikes')) void loadLightningStrikes(v);
      return;
    } else if (layerId === 'aurora_oval') {
      if (!showExisting('aurora_oval')) void loadAuroraOval(v);
      return;
    } else if (layerId === 'submarine_cables') {
      void loadSubmarineCables(v);
      return;
    } else if (layerId === 'electricity_grid') {
      if (!showExisting('electricity_grid')) void loadElectricityGrid(v);
      return;
    } else if (layerId === 'animal_migrations') {
      if (!showExisting('animal_migrations')) void loadAnimalMigrations(v);
      return;
    } else if (layerId === 'dt_buildings') {
      loadOsmBuildings(v, cesiumIonToken).catch((e) => showNotification('3D Buildings failed to load: ' + (e?.message || e), 'error'));
      return;
    } else if (layerId === 'tectonic') {
      showExisting('tectonic');
    } else if (layerId === 'earthquakes') {
      showExisting('earthquakes');
    } else if (['wildfires','severe_storms','volcanoes','floods','dust','seaLakeIce'].includes(layerId)) {
      showExisting(layerId);
    } else if (layerId === 'airports') {
      showExisting('airports');
    } else if (layerId === 'space_weather') {
      showExisting('space_weather');
    } else if (layerId === 'tsunami') {
      showExisting('tsunami');
      setShowTsunamiLegend(true);
    } else {
      const wmsProvider = getNasaGibsProvider(layerId);
      if (wmsProvider) {
        if (!overlayImageryLayersRef.current[layerId]) {
          const imgLayer = v.scene.imageryLayers.addImageryProvider(wmsProvider);
          const defOpacity = LAYER_DEFS.find(l => l.id === layerId)?.opacity ?? 1.0;
          imgLayer.alpha = layerOpacity[layerId] ?? defOpacity;
          overlayImageryLayersRef.current[layerId] = imgLayer;
        }
      } else {
        if (layerId === 'airspaces' && !entityStoreRef.current['airspaces']?.length) {
          loadAirspaces(v)
            .then(entities => {
              if (!isLayerEnabled('airspaces')) return;
              entityStoreRef.current['airspaces'] = entities;
              setLayerEntitiesVisible('airspaces', true);
            })
            .catch(err => showNotification('Failed to load real airspaces', 'error'));
        } else if (layerId === 'ais_vessels' && !entityStoreRef.current['ais_vessels']?.length) {
          const key = apiVaultRef.current.aisStreamApiKey;
          if (!key) {
            showNotification('AISStream API Key required. Add it in settings.', 'warning');
            setTimeout(() => toggleLayer('ais_vessels'), 10);
          } else {
            showNotification('Connecting to live AIS stream...', 'info');
            loadAisVessels(v, key)
              .then(entities => {
                if (!isLayerEnabled('ais_vessels')) return;
                entityStoreRef.current['ais_vessels'] = entities;
                setLayerEntitiesVisible('ais_vessels', true);
                showNotification(`Loaded ${entities.length} live vessels`, 'success');
              })
              .catch(err => showNotification(err.message || 'AIS connection failed', 'error'));
          }
        } else if (entityStoreRef.current[layerId]?.length) {
          setLayerEntitiesVisible(layerId, true);
        }
      }
    }
  }

  function hideLayerEntities(layerId: string) {
    // Remove data source layers (submarine_cables, airspaces) properly
    const v = viewerRef.current;
    if (layerId === 'submarine_cables' && submarineCablesDataSourceRef.current) {
      if (v) v.dataSources.remove(submarineCablesDataSourceRef.current, true);
      submarineCablesDataSourceRef.current = null;
      entityStoreRef.current['submarine_cables'] = [];
    }
    if (layerId === 'airspaces' && v) {
      // Remove airspace entities that were added directly to viewer.entities
      const ents = entityStoreRef.current['airspaces'];
      if (ents) { ents.forEach(e => v.entities.remove(e)); }
      // Also try data source removal (legacy path)
      for (let i = v.dataSources.length - 1; i >= 0; i--) {
        const ds = v.dataSources.get(i);
        if (ds.name === 'airspaces' || (ds as any)._name === 'airspaces') {
          v.dataSources.remove(ds, true);
        }
      }
      entityStoreRef.current['airspaces'] = [];
    }

    setLayerEntitiesVisible(layerId, false);
    
    setIntelFeed(prev => {
      const typeMap: Record<string, string[]> = {
        'earthquakes': ['earthquake'],
        'wildfires': ['wildfires', 'wildfire'],
        'severe_storms': ['severe_storms', 'storm'],
        'volcanoes': ['volcanoes', 'volcano'],
        'floods': ['floods', 'flood'],
        'dust': ['dust', 'dustHaze'],
        'landslides': ['landslides', 'landslide'],
        'seaLakeIce': ['seaLakeIce', 'ice'],
        'space_weather': ['space_weather'],
        'intel_feed': ['news', 'social', 'twitter', 'facebook']
      };
      const removeTypes = typeMap[layerId];
      if (!removeTypes) return prev;
      const next = prev.filter(i => !removeTypes.includes(i.type));
      intelFeedRef.current = next;
      return next;
    });
    
    if (overlayImageryLayersRef.current[layerId]) {
      if (v) v.scene.imageryLayers.remove(overlayImageryLayersRef.current[layerId], true);
      delete overlayImageryLayersRef.current[layerId];
    }

    if (layerId === 'population_impact') {
      if (v) populationImpactLayerRef.current.forEach(e => v.entities.remove(e));
      populationImpactLayerRef.current = [];
      setShowPopulationImpact(false);
    }
    if (layerId === 'heatmap') {
      setShowHeatmapLegend(false);
      activeHeatmapRef.current = null;
    }
    if (layerId === 'storm_forecast' || layerId === 'severe_storms') {
      clearStormForecastOverlays();
      setStormForecast(null);
    }
    if (layerId === 'smoke_dispersion' || layerId === 'wildfires') {
      clearSmokeDispersionOverlays();
    }
    if (layerId === 'tsunami') {
      if (v) tsunamiWavesRef.current.forEach(e => v.entities.remove(e));
      tsunamiWavesRef.current = [];
      entityStoreRef.current['tsunami'] = [];
      setShowTsunamiLegend(false);
    }
    if (layerId === 'intel_feed') {
      setShowIntelFeed(false);
    }
    if (layerId === 'disaster_alerts') {
      setShowAlertsPanel(false);
    }
    if (layerId === 'india_cctv') {
      const p = infoEntity?.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      if (p?.layer === 'india_cctv') {
        setInfoEntity(null);
        entityTrackerRef.current?.untrack();
      }
    }
    if (layerId === 'disaster_near_me') {
      if (geolocationWatchRef.current !== null) {
        navigator.geolocation.clearWatch(geolocationWatchRef.current);
        geolocationWatchRef.current = null;
      }
      clearDisasterNearMeOverlay();
      disasterNearMeRequestedRef.current = false;
    }
    if (layerId === 'flight_tracks') {
      flightDrRef.current?.clear();
    }
    if (layerId === 'weather_cards' && v) {
      const ents = entityStoreRef.current['weather_cards'];
      if (ents) { ents.forEach(e => v.entities.remove(e)); entityStoreRef.current['weather_cards'] = []; }
      setWeatherCards([]);
    }
    if (layerId === 'seismic_waves') {
      const v2 = viewerRef.current;
      seismicAnimationsRef.current.forEach(a => {
        if (a.interval) clearInterval(a.interval);
        if (v2) { if (a.pEnt) v2.entities.remove(a.pEnt); if (a.sEnt) v2.entities.remove(a.sEnt); if (a.surfEnt) v2.entities.remove(a.surfEnt); }
      });
      seismicAnimationsRef.current = [];
    }
    if (layerId === 'dt_buildings') {
      hideOsmBuildings();
    }
  }

  function loadPopulationImpact(viewer: Cesium.Viewer) {
    if (populationImpactLayerRef.current.length > 0) return;
    const maxPop = Math.max(...CITY_DATA.map(c => c.pop));
    const newEnts: Cesium.Entity[] = [];
    for (const city of CITY_DATA) {
      const r = 5000 + (city.pop / maxPop) * 45000;
      const alpha = 0.1 + (city.pop / maxPop) * 0.35;
      const ent = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(city.lon, city.lat),
        name: city.name,
        ellipse: {
          semiMinorAxis: r, semiMajorAxis: r,
          material: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(alpha),
          outline: true, outlineColor: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.3), outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: { text: `${city.name}\n${city.pop}M`, font: '9px "JetBrains Mono"',
          fillColor: Cesium.Color.WHITE, pixelOffset: new Cesium.Cartesian2(0, 0),
          show: city.pop > 15, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
        properties: { layer:'population_impact', city, lon: city.lon, lat: city.lat },
      });
      newEnts.push(ent);
    }
    populationImpactLayerRef.current = newEnts;
    entityStoreRef.current['population_impact'] = newEnts;
    setShowPopulationImpact(true);
  }

  function createCctvIcon(): HTMLCanvasElement {
    if (cachedCctvCanvas) return cachedCctvCanvas;

    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 40;
    const ctx = canvas.getContext('2d')!;
    const mid = 20;

    // 1. Outer glow ring
    const glow = ctx.createRadialGradient(mid, mid, 2, mid, mid, 18);
    glow.addColorStop(0, 'rgba(34, 211, 238, 0.7)');
    glow.addColorStop(0.5, 'rgba(34, 211, 238, 0.2)');
    glow.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 40, 40);

    const stroke = Cesium.Color.fromCssColorString('#67e8f9').withAlpha(0.95).toCssColorString();
    const fill = Cesium.Color.fromCssColorString('#0f172a').withAlpha(0.95).toCssColorString();
    const activeRed = '#ef4444';

    ctx.save();
    // Center and scale the 24x24 Lucide CCTV vector paths to fit the 40x40 canvas nicely
    const scale = 1.35;
    const offset = 20 - 12 * scale;
    ctx.translate(offset, offset);
    ctx.scale(scale, scale);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const path1 = new Path2D("M16.75 12h3.632a1 1 0 0 1 .894 1.447l-2.034 4.069a1 1 0 0 1-1.708.134l-2.124-2.97");
    const path2 = new Path2D("M17.106 9.053a1 1 0 0 1 .447 1.341l-3.106 6.211a1 1 0 0 1-1.342.447L3.61 12.3a2.92 2.92 0 0 1-1.3-3.91L3.69 5.6a2.92 2.92 0 0 1 3.92-1.3z");
    const path3 = new Path2D("M2 19h3.76a2 2 0 0 0 1.8-1.1L9 15");
    const path4 = new Path2D("M2 21v-4");
    const path5 = new Path2D("M7 9h.01");

    // Fill camera body and visor for strong visibility against globe background
    ctx.fillStyle = fill;
    ctx.fill(path2);
    ctx.fill(path1);

    // Stroke paths
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = stroke;
    ctx.stroke(path1);
    ctx.stroke(path2);
    ctx.stroke(path3);
    ctx.stroke(path4);

    // Render the recording indicator LED in flashing red
    ctx.strokeStyle = activeRed;
    ctx.lineWidth = 2.5;
    ctx.stroke(path5);

    ctx.restore();
    cachedCctvCanvas = canvas;
    return canvas;
  }

  async function loadIndiaCctv(viewer: Cesium.Viewer) {
    const existing = entityStoreRef.current['india_cctv'];
    if (existing?.length) {
      setLayerEntitiesVisible('india_cctv', true);
      return;
    }

    try {
      const data = await apiGet<{ cameras?: IndiaCctvCamera[] }>('/cctv/worldwide');
      if (!isLayerEnabled('india_cctv')) return;
      const cameras = (data.cameras ?? [])
        .filter((camera) => Number.isFinite(camera.lat) && Number.isFinite(camera.lon))
        .slice(0, 800);

      const ents = cameras.map((camera) => {
        return viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat, 35),
          name: camera.name,
          billboard: {
            image: createCctvIcon(),
            width: 32,
            height: 32,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            pixelOffset: new Cesium.Cartesian2(0, -2),
          },
          label: {
            text: camera.name,
            font: '10px "JetBrains Mono"',
            fillColor: Cesium.Color.fromCssColorString('#67e8f9'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            pixelOffset: new Cesium.Cartesian2(0, -24),
            show: false,
          },
          properties: {
            layer: 'india_cctv',
            title: camera.name,
            lat: camera.lat,
            lon: camera.lon,
            pageUrl: camera.pageUrl,
            previewUrl: camera.previewUrl ?? camera.thumbnailUrl ?? camera.streamUrl ?? camera.pageUrl,
            streamUrl: camera.streamUrl ?? camera.pageUrl,
            thumbnailUrl: camera.thumbnailUrl ?? camera.previewUrl,
            source: camera.source ?? 'opencctv.org',
            category: camera.category ?? 'public webcam',
            city: camera.city,
            region: camera.region,
            location: camera.location,
            updatedAt: camera.updatedAt ?? Date.now(),
            description: camera.description ?? '',
            feedType: camera.feedType,
          },
        });
      });

      entityStoreRef.current['india_cctv'] = ents;
      viewer.scene.requestRender();
      showNotification(`Loaded ${ents.length} worldwide webcams`, 'success');
    } catch (err) {
      if (import.meta.env.DEV) {
        window.__liveglobeDebug = {
          ...(window.__liveglobeDebug ?? {}),
          lastIndiaCctvError: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        };
      }
      recordFeedError('worldwide cctv', err);
      showNotification('Worldwide camera feed unavailable', 'warning');
    }
  }

  async function loadSpaceDebris(viewer: Cesium.Viewer) {
    const existing = entityStoreRef.current['space_debris'];
    if (existing?.length) {
      setLayerEntitiesVisible('space_debris', true);
      return;
    }
    try {
      const data = await apiGet<any[]>('/space-debris');
      if (!isLayerEnabled('space_debris')) return;
      const ents = addSpaceDebrisEntities(viewer, data);
      entityStoreRef.current['space_debris'] = ents;
      viewer.scene.requestRender();
      showNotification(`Loaded ${ents.length} space debris objects`, 'success');
    } catch (err) {
      recordFeedError('space debris', err);
      showNotification('Space debris feed unavailable', 'warning');
    }
  }

  async function loadNasaDsn(viewer: Cesium.Viewer) {
    const existing = entityStoreRef.current['nasa_dsn'];
    if (existing?.length) {
      setLayerEntitiesVisible('nasa_dsn', true);
      return;
    }
    try {
      const data = await apiGet<any>('/nasa-dsn');
      if (!isLayerEnabled('nasa_dsn')) return;
      const ents = addNasaDsnEntities(viewer, data);
      entityStoreRef.current['nasa_dsn'] = ents;
      viewer.scene.requestRender();
      showNotification('NASA Deep Space Network active', 'success');
    } catch (err) {
      recordFeedError('nasa dsn', err);
      showNotification('NASA DSN feed unavailable', 'warning');
    }
  }

  async function loadLightningStrikes(viewer: Cesium.Viewer) {
    removeLayerEntities('lightning_strikes');
    try {
      const data = await apiGet<any[]>('/lightning');
      if (!isLayerEnabled('lightning_strikes')) return;
      const ents = addLightningEntities(viewer, data);
      entityStoreRef.current['lightning_strikes'] = ents;
      viewer.scene.requestRender();
      if (ents.length > 0) {
        showNotification(`Loaded ${ents.length} live lightning strikes`, 'success');
      }
    } catch (err) {
      recordFeedError('lightning strikes', err);
    }
  }

  async function loadAuroraOval(viewer: Cesium.Viewer) {
    const existing = entityStoreRef.current['aurora_oval'];
    if (existing?.length) {
      setLayerEntitiesVisible('aurora_oval', true);
      return;
    }
    try {
      const data = await apiGet<any>('/aurora');
      if (!isLayerEnabled('aurora_oval')) return;
      const ents = addAuroraEntities(viewer, data);
      entityStoreRef.current['aurora_oval'] = ents;
      viewer.scene.requestRender();
      showNotification('Polar auroral oval loaded', 'success');
    } catch (err) {
      recordFeedError('aurora', err);
      showNotification('Aurora forecast unavailable', 'warning');
    }
  }

  async function loadSubmarineCables(viewer: Cesium.Viewer) {
    const existing = entityStoreRef.current['submarine_cables'];
    if (existing?.length) {
      setLayerEntitiesVisible('submarine_cables', true);
      return;
    }
    try {
      const data = await apiGet<any>('/submarine-cables');
      if (!isLayerEnabled('submarine_cables')) return;
      const ds = await loadSubmarineCablesDataSource(viewer, data);
      submarineCablesDataSourceRef.current = ds;
      entityStoreRef.current['submarine_cables'] = [...ds.entities.values];
      viewer.scene.requestRender();
      showNotification('Undersea fiber cables loaded', 'success');
    } catch (err) {
      recordFeedError('submarine cables', err);
      showNotification('Submarine cables feed unavailable', 'warning');
    }
  }

  async function loadElectricityGrid(viewer: Cesium.Viewer) {
    const existing = entityStoreRef.current['electricity_grid'];
    if (existing?.length) {
      setLayerEntitiesVisible('electricity_grid', true);
      return;
    }
    try {
      const data = await apiGet<any[]>('/electricity-grid');
      if (!isLayerEnabled('electricity_grid')) return;
      const ents = addElectricityGridEntities(viewer, data);
      entityStoreRef.current['electricity_grid'] = ents;
      viewer.scene.requestRender();
      showNotification('Global grid footprint loaded', 'success');
    } catch (err) {
      recordFeedError('electricity grid', err);
      showNotification('Electricity grid feed unavailable', 'warning');
    }
  }

  async function loadAnimalMigrations(viewer: Cesium.Viewer) {
    const existing = entityStoreRef.current['animal_migrations'];
    if (existing?.length) {
      setLayerEntitiesVisible('animal_migrations', true);
      return;
    }
    try {
      const data = await apiGet<any[]>('/animal-migrations');
      if (!isLayerEnabled('animal_migrations')) return;
      const ents = addAnimalMigrationEntities(viewer, data);
      entityStoreRef.current['animal_migrations'] = ents;
      viewer.scene.requestRender();
      showNotification('Wildlife migration paths loaded', 'success');
    } catch (err) {
      recordFeedError('animal migrations', err);
      showNotification('Wildlife migrations feed unavailable', 'warning');
    }
  }

  function generateHeatmap(viewer: Cesium.Viewer) {
    if (activeHeatmapRef.current) return;
    const eqs = entityStoreRef.current['earthquakes'];
    if (!eqs?.length) return;
    const pts: HeatmapPoint[] = [];
    for (const e of eqs) {
      const p = e.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      if (p?.magnitude && Number(p.magnitude) >= 2.5) {
        const count = (p.magnitude as number) - 1.5;
        pts.push({ lon: p.lon as number, lat: p.lat as number, count });
      }
    }
    heatmapDataRef.current = pts;
    activeHeatmapRef.current = 'heatmap';
    setShowHeatmapLegend(true);

    const maxC = Math.max(...pts.map(p => p.count));
    const heatmapEntities: Cesium.Entity[] = [];
    for (const pt of pts) {
      const alpha = 0.1 + (pt.count / maxC) * 0.5;
      const r = 15000 + pt.count * 5000;
      heatmapEntities.push(viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat),
        ellipse: {
          semiMinorAxis: r, semiMajorAxis: r,
          material: Cesium.Color.fromCssColorString(getHeatmapColor(pt.count / maxC)).withAlpha(alpha),
          outline: false, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      }));
    }
    entityStoreRef.current['heatmap'] = heatmapEntities;
  }

  function getHeatmapColor(t: number): string {
    if (t < 0.25) return '#3b82f6';
    if (t < 0.5) return '#22c55e';
    if (t < 0.75) return '#f59e0b';
    if (t < 0.9) return '#ef4444';
    return '#7f1d1d';
  }

  function getNasaGibsProvider(layerId: string) {
    const layerMap: Record<string, string> = {
      temp_anomaly: 'AIRS_L2_Surface_Air_Temperature_Day',
      precipitation: 'IMERG_Precipitation_Rate',
      wind: 'CYGNSS_L3_Wind_Speed_Daily',
      pressure: 'MERRA2_Surface_Pressure_Monthly',
      sea_ice: 'MODIS_Terra_Sea_Ice',
      sea_temp: 'GHRSST_L4_MUR_Sea_Surface_Temperature',
      nasa_gibs: 'MODIS_Terra_CorrectedReflectance_TrueColor',
      night_lights: 'VIIRS_Black_Marble',
      land_cover: 'MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual',
      aerosol_index: 'OMPS_Aerosol_Index',
      so2_index: 'OMPS_NOAA20_SO2_Lower_Troposphere',
      co_index: 'MOPITT_CO_Daily_Total_Column_Day',
      dust_score: 'MODIS_Terra_Aerosol',
      flood_extent: 'MODIS_Combined_Flood_1-Day',
    };
    
    const wmsLayer = layerMap[layerId];
    if (!wmsLayer) return null;

    return new Cesium.WebMapServiceImageryProvider({
      url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
      layers: wmsLayer,
      parameters: { TRANSPARENT: 'true', FORMAT: 'image/png' },
      enablePickFeatures: false
    });
  }

  // Sync overlay opacity whenever layerOpacity changes
  useEffect(() => {
    Object.entries(overlayImageryLayersRef.current).forEach(([id, layer]) => {
      const def = LAYER_DEFS.find(l => l.id === id);
      const defaultOpacity = def?.opacity ?? 1.0;
      const val = layerOpacity[id] ?? defaultOpacity;
      if (layer) {
        layer.alpha = val;
      }
    });
    viewerRef.current?.scene.requestRender();
  }, [layerOpacity]);

  const toggleAllLayers = useCallback((state: boolean) => {
    const next = layersRef.current.map(l => ({ ...l, on: state }));
    layersRef.current = next;
    setLayers(next);

    renderSchedulerRef.current.reset();
    bulkOperationRef.current = true;
    setNotifications([]);
    try { Object.values(notificationTimeoutsRef.current).forEach(t => clearTimeout(t)); } catch { /* ignore */ }
    notificationTimeoutsRef.current = {};

    if (state) {
      const v = viewerRef.current;

      // Phase 1 (sync): immediately show any layers that already have loaded data
      const needsLoad: string[] = [];
      for (const l of layersRef.current) {
        const id = l.id;
        const ents = entityStoreRef.current[id];
        if (ents && ents.length > 0) {
          ents.forEach(e => { if (e) e.show = true; });
        } else if (overlayImageryLayersRef.current[id]) {
          // imagery already loaded, visible by default
        } else {
          needsLoad.push(id);
        }
      }

      // Phase 2 (async): only queue layers that genuinely need data loading
      if (needsLoad.length > 0) {
        const tasks = needsLoad.map(id => ({
          id: `enable:${id}`,
          execute: () => {
            if (!layersRef.current.find(x => x.id === id)?.on) return;
            try { loadLayerData(id); } catch (e) { /* ignore */ }
          },
        }));
        let notified = false;
        renderSchedulerRef.current.onProgress((done, total) => {
          if (done >= total && !notified) {
            notified = true;
            if (v) v.scene.requestRender();
            bulkOperationRef.current = false;
            showNotification(`All layers enabled (${layersRef.current.length})`, 'success');
          }
        });
        renderSchedulerRef.current.enqueueAll(tasks);
      } else {
        bulkOperationRef.current = false;
        if (v) v.scene.requestRender();
        showNotification(`All layers enabled (${layersRef.current.length})`, 'success');
      }

      if (v) void loadFlightTracks(v);
    } else {
      // Disable all in one synchronous sweep — no GPU spikes
      bulkOperationRef.current = true;

      const v = viewerRef.current;

      if (v) {
        // Suspend entity events during bulk hide to prevent per-entity callbacks
        try { v.entities.suspendEvents(); } catch { /* ignore */ }
      }
      layersRef.current.forEach(l => { hideLayerEntities(l.id); });
      if (v) {
        try { v.entities.resumeEvents(); } catch { /* ignore */ }
      }

      flightDrRef.current?.clear();

      setInfoEntity(null);
      entityTrackerRef.current?.untrack();

      if (v && focusMarkerRef.current) {
        v.entities.remove(focusMarkerRef.current);
        focusMarkerRef.current = null;
      }

      if (v) {
        try {
          v.scene.imageryLayers.removeAll(true);
          addBaseImagery(v, activeImagery, true);
        } catch (e) { /* ignore */ }
        overlayImageryLayersRef.current = {};
      }

      setNotifications([]);
      try {
        Object.values(notificationTimeoutsRef.current).forEach(t => clearTimeout(t));
      } catch (e) { /* ignore */ }
      notificationTimeoutsRef.current = {};

      setShowIntelFeed(false);
      setShowAlertsPanel(false);
      setShowPopulationImpact(false);
      const wcEnts = entityStoreRef.current['weather_cards'];
      if (wcEnts) { wcEnts.forEach(e => v?.entities.remove(e)); entityStoreRef.current['weather_cards'] = []; }
      setWeatherCards([]);
      setShowHeatmapLegend(false);
      setShowStormLegend(false);
      setShowSmokeLegend(false);
      setShowTsunamiLegend(false);
      disasterNearMeRequestedRef.current = false;
      if (geolocationWatchRef.current !== null) {
        navigator.geolocation.clearWatch(geolocationWatchRef.current);
        geolocationWatchRef.current = null;
      }

      if (v) v.scene.requestRender();
      bulkOperationRef.current = false;
      showNotification(`All layers disabled`, 'success');
    }
    refreshDerivedOverlays();
  }, []);

  const enableDefaultLayers = useCallback(() => {
    const prevLayers = layersRef.current;
    const next = prevLayers.map(l => ({ ...l, on: l.default }));
    layersRef.current = next;
    setLayers(next);
    for (const prev of prevLayers) {
      const wasOn = prev.on;
      const isOn = prev.default;
      if (wasOn && !isOn) {
        hideLayerEntities(prev.id);
      } else if (!wasOn && isOn) {
        loadLayerData(prev.id);
      }
    }
    refreshDerivedOverlays();
  }, [layers]);

  /* ═════════════════════════════════════════════════════════════════
     AI CHAT
     ═════════════════════════════════════════════════════════════════ */

  const sendAI = useCallback(async () => {
    if (!aiInput.trim()) return;
    const userMsg = aiInput.trim();
    setAiInput('');
    setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'user', content: userMsg }]);
    setAiTyping(true);

    const location = extractLocation(userMsg);
    const cmd = extractCommand(userMsg);
    if (cmd) { executeCommand(cmd, location); setAiTyping(false); return; }

    try {
      const response = await callAI(userMsg, location);
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: response }]);
    } catch {
      const fallback = generateLocalResponse(userMsg, location);
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: fallback }]);
    }
    setAiTyping(false);
  }, [aiInput, apiVault, aiApiType]);

  function extractLocation(text: string): { lat: number; lon: number } | null {
    const cityMap: Record<string, [number, number]> = {
      tokyo:[35.6762,139.6503], delhi:[28.7041,77.1025], shanghai:[31.2304,121.4737],
      'new york':[40.7128,-74.006], london:[51.5074,-0.1278], paris:[48.8566,2.3522],
      mumbai:[19.076,72.8777], cairo:[30.0444,31.2357], 'los angeles':[34.0522,-118.2437],
      beijing:[39.9042,116.4074], moscow:[55.7558,37.6173], istanbul:[41.0082,28.9784],
    };
    const lower = text.toLowerCase();
    for (const [city, coords] of Object.entries(cityMap)) {
      if (lower.includes(city)) return { lat: coords[0], lon: coords[1] };
    }
    return null;
  }

  function extractCommand(text: string): string | null {
    const lower = text.toLowerCase();
    if (lower.includes('fly to') || lower.includes('go to') || lower.includes('zoom to')) return 'flyTo';
    if (lower.includes('weather')) return 'weather';
    if (lower.includes('earthquake')) return 'earthquakes';
    if (lower.includes('population')) return 'population';
    if (lower.includes('storm') || lower.includes('hurricane') || lower.includes('typhoon')) return 'storm';
    return null;
  }

  function executeCommand(cmd: string, loc: { lat: number; lon: number } | null) {
    if (cmd === 'flyTo' && loc) {
      focusLocation(loc.lat, loc.lon, { label: 'Requested location', color: '#60a5fa', height: 150 });
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `Flew to coordinates ${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}` }]);
    } else if (cmd === 'weather' && loc) {
      focusLocation(loc.lat, loc.lon, { label: 'Weather request', color: '#22d3ee', height: 150 });
      addWeatherCard(loc.lat, loc.lon);
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: 'Weather data displayed on the globe.' }]);
    } else if (cmd === 'earthquakes') {
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: 'Showing recent earthquakes. Use the sidebar to toggle seismic data layers.' }]);
    } else if (cmd === 'population') {
      setLayers(prev => prev.map(l => l.id === 'population_impact' ? { ...l, on: true } : l));
      loadLayerData('population_impact');
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: 'Population impact zones displayed on the globe.' }]);
    } else {
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `Command recognized: ${cmd}. Executing...` }]);
    }
  }

  async function callAI(message: string, location: { lat: number; lon: number } | null): Promise<string> {
    const locationContext = location ? `Location context: ${location.lat}, ${location.lon}. ` : '';
    if (aiApiType === 'anthropic') {
      const anthropicKey = apiVault.anthropic.trim();
      if (!anthropicKey) return generateLocalResponse(message, location);
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'x-api-key':anthropicKey, 'anthropic-version':'2023-06-01' },
        body: JSON.stringify({ model:'claude-3-opus-20240229', max_tokens:1024,
          messages: [{role:'user', content:`${locationContext}${message}`}] }),
      });
      if (!resp.ok) throw new Error(`Anthropic request failed (${resp.status})`);
      const data = await resp.json();
      return data.content?.[0]?.text || 'No response';
    } else if (aiApiType === 'gemini') {
      const geminiKey = apiVault.gemini.trim();
      if (!geminiKey) return generateLocalResponse(message, location);
      const resp = await fetch('/api/ai/gemini', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ key: geminiKey, prompt: `${locationContext}${message}` }),
      });
      if (!resp.ok) throw new Error(`Gemini request failed (${resp.status})`);
      const data = await resp.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
    } else {
      return generateLocalResponse(message, location);
    }
  }

  function generateLocalResponse(message: string, location: { lat: number; lon: number } | null): string {
    const lower = message.toLowerCase();
    if (lower.includes('earthquake')) return '🌍 **Seismic Activity**\n\nRecent earthquakes are displayed on the globe. Use the sidebar to toggle earthquake data layers. The color intensity indicates magnitude - red circles show M5+ events.';
    if (lower.includes('weather')) return '🌤️ **Weather Information**\n\nClick on any location to see current weather conditions. Temperature, humidity, wind speed, and conditions are displayed in real-time cards.';
    if (lower.includes('storm') || lower.includes('hurricane')) return '🌀 **Storm Tracking**\n\nActive storms are shown with forecast cones indicating predicted paths. Click on any storm to see 24/48/72-hour forecasts and wind speed data.';
    if (lower.includes('fire') || lower.includes('wildfire')) return '🔥 **Wildfire Monitoring**\n\nNASA MODIS/VIIRS fire detections shown as orange pulsing markers. Smoke dispersion simulations available for active fires.';
    if (lower.includes('tsunami')) return '🌊 **Tsunami Alerts**\n\nM7.5+ ocean earthquakes automatically trigger tsunami propagation simulations. Check the alerts panel for active warnings.';
    if (lower.includes('population')) return '👥 **Population Impact**\n\n50 major cities shown with population-based impact zones. Useful for assessing disaster risk to urban areas.';
    if (lower.includes('help')) return '📚 **Available Commands**\n\n- "Show earthquakes in [location]"\n- "Weather in [city]"\n- "Fly to [location]"\n- "Show population impact"\n- "Storm tracking"\n- "Wildfire status"\n- "Tsunami alerts"\n\nOr ask any question about Earth data!';
    if (location) return `📍 **Location Query**\n\nCoordinates: ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}\n\nThis area can be analyzed for seismic risk, weather conditions, and population density. Use the sidebar layers to explore different data dimensions.`;
    return `🌍 **Earth Intelligence**\n\nI can help you explore:\n- Seismic activity and earthquake data\n- Weather conditions globally\n- Storm tracking and forecasts\n- Population impact analysis\n- Natural disaster monitoring\n\nTry: "Show earthquakes in Japan" or "Weather in London"`;
  }

  /* ═════════════════════════════════════════════════════════════════
     CONTEXT MENU ACTIONS
     ═════════════════════════════════════════════════════════════════ */

  const handleContextAction = useCallback((action: string) => {
    const cm = contextMenu;
    setContextMenu({ show: false, x: 0, y: 0, lat: 0, lon: 0 });
    const v = viewerRef.current;
    if (!v) return;
    if (action === 'flyTo') {
      focusLocation(cm.lat, cm.lon, { label: 'Context location', color: '#60a5fa', height: 150 });
    } else if (action === 'pin') {
      const pinId = `pin_${Date.now()}`;
      const added = v.entities.add({
        position: Cesium.Cartesian3.fromDegrees(cm.lon, cm.lat),
        name: 'Dropped Pin',
        billboard: { image: createPinIcon('#ef4444'), width: 24, height: 24,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
        label: { text: `📍 ${cm.lat.toFixed(3)}, ${cm.lon.toFixed(3)}`,
          font: '11px "JetBrains Mono"', fillColor: Cesium.Color.WHITE,
          pixelOffset: new Cesium.Cartesian2(0, -14) },
        properties: { layer: 'pin', lat: cm.lat, lon: cm.lon, id: pinId },
      }) as Cesium.Entity;
      entityStoreRef.current.pin = [...(entityStoreRef.current.pin ?? []), added];
      setInfoEntity(added);
      showNotification('Pin dropped', 'success');
    } else if (action === 'weather') {
      focusLocation(cm.lat, cm.lon, { label: 'Weather request', color: '#22d3ee', height: 150 });
      addWeatherCard(cm.lat, cm.lon);
    } else if (action === 'events') {
      const nearby = findNearbyEvents(cm.lat, cm.lon, 200);
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant',
        content: `📍 **Events near ${cm.lat.toFixed(2)}, ${cm.lon.toFixed(2)}**\n\n${nearby.length > 0 ? nearby.map(e => `- ${e.title} (${e.distance.toFixed(0)}km)`).join('\n') : 'No recent events found within 200km.'}` }]);
      setShowAI(true);
    }
  }, [contextMenu, addWeatherCard]);

  function findNearbyEvents(lat: number, lon: number, radiusKm: number) {
    const results: Array<{title: string; distance: number}> = [];
    const v = viewerRef.current;
    if (!v) return results;
    const ignoreLayers = new Set([
      'focus',
      'weather_cards',
      'pin',
      'india_cctv',
      'storm_forecast',
      'smoke_dispersion',
      'tsunami',
      'disaster_near_me',
    ]);
    for (const entity of v.entities.values) {
      const p = entity.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      if (p?.lat == null || p?.lon == null) continue;
      if (p?.layer && ignoreLayers.has(p.layer as string)) continue;
      const d = haversine(lat, lon, p.lat as number, p.lon as number);
      if (d < radiusKm && p.title) results.push({ title: p.title as string, distance: d });
    }
    return results.sort((a, b) => a.distance - b.distance).slice(0, 10);
  }

  function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function createPinIcon(color: string = '#ef4444', size: number = 24): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const center = size / 2;
    const glow = ctx.createRadialGradient(center, size * 0.4, size * 0.08, center, size * 0.4, size * 0.5);
    glow.addColorStop(0, Cesium.Color.fromCssColorString(color).withAlpha(0.9).toCssColorString());
    glow.addColorStop(0.65, Cesium.Color.fromCssColorString(color).withAlpha(0.32).toCssColorString());
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(center, size * 0.42, size * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = Cesium.Color.fromCssColorString(color).withAlpha(0.95).toCssColorString();
    ctx.beginPath();
    ctx.arc(center, size * 0.42, size * 0.33, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(center, size * 0.72);
    ctx.lineTo(size * 0.33, size);
    ctx.lineTo(size * 0.67, size);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(center, size * 0.42, size * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
    return canvas;
  }

  /* ═════════════════════════════════════════════════════════════════
     SHARE / SNAPSHOT
     ═════════════════════════════════════════════════════════════════ */

  const takeSnapshot = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    v.scene.render();
    const canvas = v.scene.canvas;
    const link = document.createElement('a');
    link.download = `liveglobe_${new Date().toISOString().slice(0,10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showNotification('Snapshot saved!', 'success');
  }, []);

  const generateShareUrl = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return '';
    const pos = v.camera.positionCartographic;
    const params = new URLSearchParams({
      lon: Cesium.Math.toDegrees(pos.longitude).toFixed(4),
      lat: Cesium.Math.toDegrees(pos.latitude).toFixed(4),
      alt: pos.height.toFixed(0),
    });
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  }, []);

  /* ═════════════════════════════════════════════════════════════════
     AUTO-ROTATE
     ═════════════════════════════════════════════════════════════════ */

  const toggleAutoRotate = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (isAutoRotating) {
      if (rotateTimerRef.current) clearInterval(rotateTimerRef.current);
      rotateTimerRef.current = null;
      setIsAutoRotating(false);
    } else {
      setIsAutoRotating(true);
      rotateTimerRef.current = setInterval(() => {
        const camera = v.camera;
        if (v.trackedEntity) v.trackedEntity = undefined;
        if (!Cesium.Matrix4.equals(camera.transform, Cesium.Matrix4.IDENTITY)) {
          camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        }
        const pos = camera.position.clone();
        const rotationMatrix = Cesium.Matrix3.fromRotationZ(0.0015);
        const nextPos = Cesium.Matrix3.multiplyByVector(rotationMatrix, pos, new Cesium.Cartesian3());
        camera.position = nextPos;
        const dir = Cesium.Cartesian3.normalize(
          Cesium.Cartesian3.negate(nextPos, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );
        camera.direction = dir;
        const dot = Math.abs(Cesium.Cartesian3.dot(dir, Cesium.Cartesian3.UNIT_Z));
        const right = dot > 0.99
          ? Cesium.Cartesian3.normalize(
              Cesium.Cartesian3.cross(dir, Cesium.Cartesian3.UNIT_Y, new Cesium.Cartesian3()),
              new Cesium.Cartesian3()
            )
          : Cesium.Cartesian3.normalize(
              Cesium.Cartesian3.cross(dir, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()),
              new Cesium.Cartesian3()
            );
        camera.right = right;
        camera.up = Cesium.Cartesian3.normalize(
          Cesium.Cartesian3.cross(right, dir, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );
      }, 16);
    }
  }, [isAutoRotating]);

  /* ═════════════════════════════════════════════════════════════════
     ZOOM
     ═════════════════════════════════════════════════════════════════ */

  const zoomIn = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    const h = v.camera.positionCartographic.height;
    v.camera.zoomIn(h * 0.3);
  }, []);

  const zoomOut = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    const h = v.camera.positionCartographic.height;
    v.camera.zoomOut(h * 0.5);
  }, []);

  /* ═════════════════════════════════════════════════════════════════
     CLEANUP
     ═════════════════════════════════════════════════════════════════ */

  const cleanupCesium = useCallback(() => {
    if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
    if (issTimerRef.current) clearInterval(issTimerRef.current);
    if (issRenderTickRef.current) { issRenderTickRef.current(); issRenderTickRef.current = null; }
    if (rotateTimerRef.current) clearInterval(rotateTimerRef.current);
    if (timelineRef.current.interval) clearInterval(timelineRef.current.interval);
    if (autoRefreshIntervalRef.current) clearInterval(autoRefreshIntervalRef.current);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAbortRef.current?.abort();
    weatherAbortRef.current?.abort();
    if (screenSpaceHandlerRef.current) screenSpaceHandlerRef.current.destroy();
    seismicAnimationsRef.current.forEach(a => { if (a.interval) clearInterval(a.interval); });
    seismicAnimationsRef.current = [];
    if (clickHandlerRef.current) clickHandlerRef.current();
    if (viewerRef.current) {
      removeOsmBuildings(viewerRef.current);
      viewerRef.current.entities.removeAll();
      viewerRef.current.destroy();
      viewerRef.current = null;
    }
    focusMarkerRef.current = null;
    stormOverlaysRef.current = [];
    smokeParticlesRef.current = [];
    tsunamiWavesRef.current = [];
    Object.keys(weatherCardElementsRef.current).forEach(key => { delete weatherCardElementsRef.current[key]; });
    entityTrackerRef.current?.destroy();
    entityTrackerRef.current = null;
    flightDrRef.current?.clear();
    flightDrRef.current = null;
    Object.keys(alertEntityRef.current).forEach(key => { delete alertEntityRef.current[key]; });
    disasterNearMeRequestedRef.current = false;
    if (geolocationWatchRef.current !== null) {
      navigator.geolocation.clearWatch(geolocationWatchRef.current);
      geolocationWatchRef.current = null;
    }
    lastKnownLocationRef.current = null;
  }, []);

  /* ═════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════ */

  const formatInfoPanel = () => {
    if (!infoEntity) return null;
    const p = infoEntity.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
    if (!p) return null;

    const layer = p.layer as string;
    const title = String(p.title ?? p.name ?? p.callsign ?? infoEntity.name ?? 'Event');
    const color = getEventColor(layer);
    const px = p as any;
    const hasCoords = p.lat != null && p.lon != null;
    const lat = hasCoords ? Number(p.lat) : 0;
    const lon = hasCoords ? Number(p.lon) : 0;

    const closeInfoPanel = () => {
      const v = viewerRef.current;
      const selectedProps = infoEntity.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      const selectedLayer = String(selectedProps?.layer ?? '');
      const selectedLat = Number(selectedProps?.lat);
      const selectedLon = Number(selectedProps?.lon);

      if (v && focusMarkerRef.current) {
        v.entities.remove(focusMarkerRef.current);
        focusMarkerRef.current = null;
      }

      if (v && (selectedLayer === 'pin' || selectedLayer === 'focus')) {
        const pins = entityStoreRef.current.pin ?? [];
        entityStoreRef.current.pin = pins.filter((pin) => {
          const pinProps = pin.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
          const pinLat = Number(pinProps?.lat);
          const pinLon = Number(pinProps?.lon);
          const isMatch = Number.isFinite(selectedLat) && Number.isFinite(selectedLon)
            && Math.abs(pinLat - selectedLat) < 0.000001
            && Math.abs(pinLon - selectedLon) < 0.000001;
          if (isMatch) {
            v.entities.remove(pin);
          }
          return !isMatch;
        });
      }

      if (v && selectedLayer === 'weather_cards') {
        const cards = entityStoreRef.current['weather_cards'] ?? [];
        entityStoreRef.current['weather_cards'] = cards.filter((c) => {
          const cProps = c.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
          const cLat = Number(cProps?.lat);
          const cLon = Number(cProps?.lon);
          const isMatch = Number.isFinite(selectedLat) && Number.isFinite(selectedLon)
            && Math.abs(cLat - selectedLat) < 0.0001
            && Math.abs(cLon - selectedLon) < 0.0001;
          if (isMatch) {
            v.entities.remove(c);
          }
          return !isMatch;
        });

        // Remove the weather card UI entry
        try {
          weatherCardsRef.current = weatherCardsRef.current.filter(wc => !(Math.abs(wc.lat - selectedLat) < 0.0001 && Math.abs(wc.lon - selectedLon) < 0.0001));
          setWeatherCards(prev => prev.filter(wc => !(Math.abs(wc.lat - selectedLat) < 0.0001 && Math.abs(wc.lon - selectedLon) < 0.0001)));
        } catch (e) {
          // ignore
        }
      }

      setInfoEntity(null);
      if (selectedLayer === 'focus') {
        setContextMenu(cm => ({ ...cm, show: false }));
      }
    };

    const rows: Array<{ key: string; val: string }> = [];

    if (layer === 'flight_tracks') {
      rows.push({ key: 'Flight', val: String(p.callsign ?? 'Unknown') });
      rows.push({ key: 'ICAO', val: String(p.icao24 ?? 'N/A').toUpperCase() });
      rows.push({ key: 'Altitude', val: `${Number(p.altitude).toFixed(0)} m (${(Number(p.altitude) * 3.28084).toFixed(0)} ft)` });
      rows.push({ key: 'Speed', val: `${(Number(p.velocity ?? 0) * 3.6).toFixed(0)} km/h (${(Number(p.velocity ?? 0) * 1.94384).toFixed(0)} kts)` });
      rows.push({ key: 'Heading', val: `${Number(p.heading).toFixed(0)}°` });
    } else if (layer === 'earthquakes') {
      rows.push({ key: 'Location', val: String(p.place ?? '') });
      rows.push({ key: 'Magnitude', val: `M${Number(p.magnitude ?? 0).toFixed(1)}` });
      rows.push({ key: 'Depth', val: `${String(p.depth ?? 'N/A')} km` });
      rows.push({ key: 'Time', val: `${new Date(Number(p.time ?? 0)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' })} IST` });
    } else if (layer === 'wildfires') {
      rows.push({ key: 'Status', val: String(p.status ?? 'Active') });
      rows.push({ key: 'Date', val: String(p.date ?? '') });
    } else if (layer === 'space_debris') {
      rows.push({ key: 'ID', val: String(p.id) });
      rows.push({ key: 'Epoch', val: new Date(String(p.epoch)).toLocaleString('en-IN') });
      rows.push({ key: 'Semi-major Axis', val: `${Number(p.semimajorAxis).toFixed(2)} km` });
      rows.push({ key: 'Inclination', val: `${Number(p.inclination).toFixed(4)}°` });
      rows.push({ key: 'Eccentricity', val: `${Number(p.eccentricity).toFixed(6)}` });
      rows.push({ key: 'Mean Motion', val: `${Number(p.meanMotion).toFixed(4)} revs/day` });
    } else if (layer === 'lightning_strikes') {
      rows.push({ key: 'Time', val: `${new Date(Number(p.time)).toLocaleTimeString('en-IN')} IST` });
    } else if (layer === 'aurora_oval') {
      rows.push({ key: 'Probability', val: `${Number(p.probability)}%` });
    } else if (layer === 'submarine_cables') {
      rows.push({ key: 'Capacity', val: String(p.capacity) });
      rows.push({ key: 'Length', val: String(p.length) });
      rows.push({ key: 'Owners', val: String(p.owners) });
    } else if (layer === 'animal_migrations') {
      rows.push({ key: 'Species', val: String(p.species) });
    } else if (layer === 'india_cctv') {
      const location = String(p.location ?? p.city ?? p.region ?? 'Worldwide');
      const updatedAt = Number(p.updatedAt ?? Date.now());
      rows.push({ key: 'Location', val: location });
      rows.push({ key: 'Category', val: String(p.category ?? 'Public webcam') });
      rows.push({ key: 'Updated', val: `${new Date(updatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST` });
    }
    if (hasCoords) rows.push({ key: 'Coordinates', val: `${lat.toFixed(4)}, ${lon.toFixed(4)}` });

    return (
      <>
        <div className="info-header">
          <div className="info-type-dot" style={{background:color}} />
          <div className="info-title">{title}</div>
          {hasCoords && (
            <button className="info-fly" onClick={() => focusLocation(lat, lon, { label: title, color, height: 150 })} title="Fly to location">
              🎯
            </button>
          )}
          <button className="info-close" onClick={closeInfoPanel}>✕</button>
        </div>
        <div className="info-body">
          {rows.map((r, i) => (
            <div key={i} className="info-row">
              <span className="info-key">{r.key}</span>
              <span className="info-val">{r.val}</span>
            </div>
          ))}

          {layer === 'earthquakes' && Number(px.magnitude ?? 0) >= 4 && (
            <div className="sparkline-wrap">
              <div className="sparkline-title">Seismic Wave Propagation</div>
              <div style={{fontSize:10,color:'var(--text-dim)',marginBottom:6}}>
                P-wave (red) → S-wave (blue) → Surface wave (orange)
              </div>
              <div style={{display:'flex',gap:8,fontSize:10,color:'var(--text-dim)'}}>
                <span style={{color:'#ef4444'}}>● P-wave (fastest)</span>
                <span style={{color:'#3b82f6'}}>● S-wave</span>
                <span style={{color:'#f97316'}}>● Surface (slowest)</span>
              </div>
            </div>
          )}

          {layer === 'earthquakes' && populationImpact && (
            <div className="sparkline-wrap">
              <div className="sparkline-title">Population Impact</div>
              {populationImpact.cities.map((c, i) => (
                <div key={i} className="pop-impact-row">
                  <span className="pop-impact-key">{c.name} ({c.country})</span>
                  <span className={`pop-impact-val ${populationImpact.severity}`}>{c.pop}M</span>
                </div>
              ))}
              <div className="pop-impact-row" style={{marginTop:8,borderTop:'1px solid var(--border)',paddingTop:6}}>
                <span className="pop-impact-key">Total Population</span>
                <span className={`pop-impact-val ${populationImpact.severity}`}>{populationImpact.totalPop.toFixed(1)}M</span>
              </div>
              <div className="pop-gradient" style={{marginTop:6}} />
              <div className="heatmap-labels"><span>Low</span><span>Medium</span><span>High</span></div>
            </div>
          )}

          {(layer === 'severe_storms' || layer === 'storm_forecast') && (stormForecast || px.stormTrack) && (
            <div className="sparkline-wrap">
              <div className="sparkline-title">Storm Forecast</div>
              <div className="info-row"><span className="info-key">Wind Speed</span><span className="info-val">{String(px.windSpeed ?? 'N/A')} mph</span></div>
              <div className="info-row"><span className="info-key">Pressure</span><span className="info-val">{(stormForecast?.pressure ?? Number(px.pressure ?? 0)).toFixed(0)} mb</span></div>
              <div className="info-row"><span className="info-key">Heading</span><span className="info-val">{(stormForecast?.heading ?? Number(px.heading ?? 0)).toFixed(0)}°</span></div>
              <div className="info-row"><span className="info-key">Forward Speed</span><span className="info-val">{(stormForecast?.speedKmh ?? Number(px.speedKmh ?? 0)).toFixed(1)} km/h</span></div>
              {((stormForecast?.track as any[]) ?? (px.stormTrack as any[]) ?? []).map((pt: any, i: number) => (
                <div key={i} className="storm-track-point">
                  <div className="storm-track-dot" />
                  <span style={{fontSize:11,fontWeight:500}}>{pt.time}</span>
                  <span className="storm-track-date">{Number(pt.lat).toFixed(1)}°, {Number(pt.lon).toFixed(1)}°</span>
                </div>
              ))}
            </div>
          )}

          {layer === 'india_cctv' && (
            <div className="cctv-preview">
              {(() => {
                const previewBase = String(p.previewUrl ?? p.thumbnailUrl ?? p.streamUrl ?? p.pageUrl ?? '');
                const previewUrl = previewBase ? `${previewBase}${previewBase.includes('?') ? '&' : '?'}tick=${cctvPreviewTick}` : '';
                const isVideo = p.feedType === 'm3u8' || previewBase.includes('.m3u8') || previewBase.includes('m3u8') || previewBase.includes('.mp4');
                return previewBase ? (
                  isVideo ? <CctvVideoPlayer src={previewBase} /> : <img src={previewUrl} alt={String(p.title ?? 'Live camera preview')} referrerPolicy="no-referrer" loading="eager" />
                ) : <div className="cctv-preview-empty">Live preview unavailable</div>;
              })()}
            </div>
          )}

          {layer === 'india_cctv' && (
            <div className="sparkline-wrap">
              <div className="sparkline-title">Public feed</div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                <div style={{fontSize:10,color:'var(--text-dim)',lineHeight:1.4}}>Open-source live public webcam feed.</div>
                <a className="cctv-link" href={String(p.pageUrl ?? p.streamUrl ?? '')} target="_blank" rel="noreferrer">Open live</a>
              </div>
            </div>
          )}

          {layer === 'space_debris' && (
            <div className="sparkline-wrap">
              <div className="sparkline-title">Orbit Visualization</div>
              <div style={{fontSize:10,color:'var(--text-dim)'}}>Dashed purple line traces the projected orbital path over one period (~90-120 mins).</div>
            </div>
          )}

          {layer === 'nasa_dsn' && (p as any).isStation && (
            <div className="sparkline-wrap" style={{marginTop:12}}>
              <div className="sparkline-title">Dish Statuses & Targets</div>
              {(((p as any).dishes as any[]) || []).map((dish: any, idx: number) => (
                <div key={idx} style={{borderBottom:'1px solid var(--border)',paddingBottom:8,marginBottom:8,fontSize:11}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontWeight:600}}>
                    <span>{dish.name}</span>
                    <span style={{color: dish.isUp ? '#22c55e' : '#94a3b8'}}>{dish.isUp ? 'ACTIVE' : 'STANDBY'}</span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',color:'var(--text-dim)',fontSize:10}}>
                    <span>Az: {Number(dish.azimuth).toFixed(1)}° / El: {Number(dish.elevation).toFixed(1)}°</span>
                    <span>Wind: {dish.windspeed} km/h</span>
                  </div>
                  {((dish.targets as any[]) || []).length > 0 ? (
                    <div style={{marginTop:4,paddingLeft:6,borderLeft:'2px solid #f59e0b'}}>
                      {((dish.targets as any[]) || []).map((t: any, tIdx: number) => (
                        <div key={tIdx} style={{fontSize:10}}>
                          <strong>Target:</strong> {t.name} (ID: {t.id})
                          <div>Distance: {(t.range / 1.496e8).toFixed(3)} AU ({(t.range/1000).toLocaleString()} km)</div>
                          <div>RTLT: {t.rtlt}s</div>
                        </div>
                      ))}
                    </div>
                  ) : <div style={{fontSize:9,color:'var(--text-dim)',marginTop:2}}>No target tracked</div>}
                </div>
              ))}
            </div>
          )}

          {layer === 'nasa_dsn' && (p as any).isBeam && (
            <div className="sparkline-wrap">
              <div className="sparkline-title">Beam Targets</div>
              <div className="info-row"><span className="info-key">Dish Antenna</span><span className="info-val">{String((p as any).dishName)}</span></div>
              <div className="info-row"><span className="info-key">Az / El</span><span className="info-val">{Number((p as any).azimuth).toFixed(1)}° / {Number((p as any).elevation).toFixed(1)}°</span></div>
              <div className="info-row"><span className="info-key">Windspeed</span><span className="info-val">{Number((p as any).windspeed).toFixed(1)} km/h</span></div>
              {(((p as any).targets as any[]) || []).map((t: any, i: number) => (
                <div key={i} style={{fontSize:11,marginBottom:6}}>
                  <div style={{fontWeight:600}}>{t.name} ({t.id})</div>
                  <div>Distance: {(t.range / 1.496e8).toFixed(3)} AU</div>
                  <div>RTLT: {t.rtlt}s</div>
                </div>
              ))}
            </div>
          )}

          {layer === 'lightning_strikes' && (
            <div className="sparkline-wrap">
              <div className="sparkline-title">Blitzortung Telemetry</div>
              <div style={{fontSize:10,color:'var(--text-dim)'}}>Real-time discharge registered by magnetic field sensors. Bolide is represented by a vertical column rising 5km into the atmosphere with an expanding ground ripple.</div>
            </div>
          )}

          {layer === 'aurora_oval' && (
            <div className="sparkline-wrap">
              <div className="sparkline-title">NOAA Ovation Prime Model</div>
              <div style={{fontSize:10,color:'var(--text-dim)'}}>Displays probability of auroral visibility. Particles float at ~95km to 150km altitudes, colored green (lower probability) to red (high probability/altitude).</div>
            </div>
          )}

          {layer === 'submarine_cables' && (
            <div className="sparkline-wrap">
              <div className="sparkline-title">TeleGeography Database</div>
              <div style={{fontSize:10,color:'var(--text-dim)'}}>Fibre-optic communications link on the sea floor connecting international landing stations.</div>
            </div>
          )}

          {layer === 'electricity_grid' && (
            <div className="sparkline-wrap" style={{marginTop:10}}>
              <div className="sparkline-title">Electricity Generation Mix</div>
              {Object.entries((p.mix as Record<string, number>) || {}).map(([source, percentage]) => {
                if (!percentage) return null;
                return (
                  <div key={source} style={{fontSize:11,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <span style={{textTransform:'capitalize'}}>{source}</span>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <div style={{background:'var(--border)',width:60,height:6,borderRadius:3,overflow:'hidden',position:'relative'}}>
                        <div style={{background: source === 'coal' || source === 'gas' || source === 'oil' ? '#ef4444' : '#22c55e', width: `${percentage}%`, height: '100%'}} />
                      </div>
                      <span style={{fontWeight:500,width:30,textAlign:'right'}}>{Number(percentage).toFixed(0)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {layer === 'animal_migrations' && (
            <div className="sparkline-wrap">
              <div className="sparkline-title">Movebank Telemetry</div>
              <div style={{fontSize:10,color:'var(--text-dim)'}}>Real-time tracking route. Orange ribbon displays the complete migration pathway, and pulsing dot marks the last recorded transmitter location.</div>
            </div>
          )}

          {layer === 'wildfires' && (
            <div className="sparkline-wrap">
              <div className="sparkline-title">Fire Monitoring</div>
              <div style={{fontSize:10,color:'var(--text-dim)',lineHeight:1.5}}>Smoke dispersion simulation active for this fire location.</div>
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {/* Cesium Container */}
      <div
        ref={cesiumElRef}
        className={`cesium-container ${sidebarCollapsed ? 'full-width' : ''}`}
        style={{ position: 'absolute', inset: 0, left: sidebarCollapsed ? 0 : 300, width: sidebarCollapsed ? '100%' : 'calc(100% - 300px)', height: '100%' }}
      />

      {/* Loading Overlay */}
      {loading && (
        <div className={`loading-overlay ${loadingProgress >= 100 ? 'fade' : ''}`}>
          <div className="loader-brand">LiveGlobe</div>
          <div className="loader-sub">Real-Time Earth Intelligence</div>
          <div className="loader-bar-wrap">
            <div className="loader-bar" style={{ width: `${loadingProgress}%` }} />
          </div>
          <div className="loader-status">{loadingStatus}</div>
        </div>
      )}

      {/* Token Setup */}
      {showTokenSetup && (
        <div className="token-setup">
          <div className="token-card api-vault-card">
            <div className="token-title">API Vault</div>
            <div className="token-sub">
              Paste the keys you want to use. Everything is stored locally in this browser, so it stays after refresh.
            </div>

            <div className="api-vault-grid">
              <section className="api-section">
                <div className="api-section-title">AI providers</div>
                <label className="api-field">
                  <span>Gemini API Key</span>
                  <input
                    type="password"
                    className="token-input"
                    placeholder="Paste your Gemini API key"
                    value={apiVault.gemini}
                    onChange={e => setApiVault(prev => ({ ...prev, gemini: e.target.value }))}
                  />
                </label>
                <label className="api-field">
                  <span>Anthropic API Key</span>
                  <input
                    type="password"
                    className="token-input"
                    placeholder="Paste your Anthropic API key"
                    value={apiVault.anthropic}
                    onChange={e => setApiVault(prev => ({ ...prev, anthropic: e.target.value }))}
                  />
                </label>
                <label className="api-field">
                  <span>Cesium Ion Access Token</span>
                  <input
                    type="password"
                    className="token-input"
                    placeholder="Paste your Cesium ion access token"
                    value={apiVault.cesiumIonAccessToken}
                    onChange={e => setApiVault(prev => ({ ...prev, cesiumIonAccessToken: e.target.value }))}
                  />
                </label>
                <div className="token-note" style={{marginTop: 6}}>
                  A valid Cesium ion token enables World Terrain and a much more convincing 3D globe.
                </div>
                <label className="api-field">
                  <span>Preferred AI Provider</span>
                  <select
                    className="token-input api-select"
                    value={apiVault.preferredAiProvider}
                    onChange={e => setApiVault(prev => ({
                      ...prev,
                      preferredAiProvider: e.target.value as AiProvider,
                    }))}
                  >
                    <option value="gemini">Gemini</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="local">Local fallback</option>
                  </select>
                </label>
              </section>

              <section className="api-section">
                <div className="api-section-title">Aviation</div>
                <label className="api-field">
                  <span>OpenSky Client ID</span>
                  <input
                    type="text"
                    className="token-input"
                    placeholder="Paste your OpenSky client ID"
                    value={apiVault.openSkyClientId}
                    onChange={e => setApiVault(prev => ({ ...prev, openSkyClientId: e.target.value }))}
                  />
                </label>
                <label className="api-field">
                  <span>OpenSky Client Secret</span>
                  <input
                    type="password"
                    className="token-input"
                    placeholder="Paste your OpenSky client secret"
                    value={apiVault.openSkyClientSecret}
                    onChange={e => setApiVault(prev => ({ ...prev, openSkyClientSecret: e.target.value }))}
                  />
                </label>
                <div className="token-note" style={{marginTop: 6}}>
                  OpenSky uses OAuth2 client credentials when supplied.
                </div>
              </section>

              <section className="api-section">
                <div className="api-section-title">Future integrations</div>
                <label className="api-field">
                  <span>Sentinel Hub Client ID</span>
                  <input
                    type="text"
                    className="token-input"
                    placeholder="Optional"
                    value={apiVault.sentinelHubClientId}
                    onChange={e => setApiVault(prev => ({ ...prev, sentinelHubClientId: e.target.value }))}
                  />
                </label>
                <label className="api-field">
                  <span>Sentinel Hub Client Secret</span>
                  <input
                    type="password"
                    className="token-input"
                    placeholder="Optional"
                    value={apiVault.sentinelHubClientSecret}
                    onChange={e => setApiVault(prev => ({ ...prev, sentinelHubClientSecret: e.target.value }))}
                  />
                </label>
                <label className="api-field">
                  <span>MarineTraffic API Key</span>
                  <input
                    type="password"
                    className="token-input"
                    placeholder="Optional"
                    value={apiVault.marineTrafficApiKey}
                    onChange={e => setApiVault(prev => ({ ...prev, marineTrafficApiKey: e.target.value }))}
                  />
                </label>
                <div className="token-note" style={{marginTop: 6}}>
                  These are stored for the matching layers when those integrations are enabled.
                </div>
              </section>
            </div>

            <div className="token-note">
              Keys are stored locally on this device. If a service is unavailable, the app falls back to simulated data so the scene stays alive.
            </div>
            <div className="api-actions">
              <button
                className="btn-primary"
                onClick={() => {
                  setApiVault(prev => ({ ...prev, vaultDismissed: true }));
                  setShowTokenSetup(false);
                }}
              >
                Save & Continue
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setApiVault(prev => ({ ...prev, vaultDismissed: true }));
                  setShowTokenSetup(false);
                }}
              >
                Continue Without Keys
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API Vault Dialog */}
      <ApiVault
        isOpen={showApiVault}
        onClose={() => setShowApiVault(false)}
        onSave={handleApiVaultSave}
        initialKeys={{
          GOOGLE_GEMINI_API_KEY: apiVault.gemini,
          ANTHROPIC_API_KEY: apiVault.anthropic,
          CESIUM_ION_ACCESS_TOKEN: apiVault.cesiumIonAccessToken,
          OPENSKY_CLIENT_ID: apiVault.openSkyClientId,
          OPENSKY_CLIENT_SECRET: apiVault.openSkyClientSecret,
          SENTINEL_HUB_CLIENT_ID: apiVault.sentinelHubClientId,
          SENTINEL_HUB_CLIENT_SECRET: apiVault.sentinelHubClientSecret,
          MARINE_TRAFFIC_API_KEY: apiVault.marineTrafficApiKey,
          AIS_STREAM_API_KEY: apiVault.aisStreamApiKey,
        }}
      />

      {/* Top Bar */}
      <div className="topbar glass-panel">
        <div className="brand">
          <div className="brand-dot" />
          <span>LiveGlobe</span>
        </div>
        <div className="topbar-sep" />
        <div className="utc-clock">{utcTime}</div>
        <div className="topbar-sep" />
        <div className="search-box" style={{ position: 'relative', flex: 1, maxWidth: 280 }}>
          <span className="search-icon">🔍</span>
          <input type="text" placeholder="Search location..." value={searchValue}
            onChange={e => handleSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter') return;
              const target = getBestSearchTarget(searchValue);
              if (target) goToLocation(target.lat, target.lon, target.name, '#60a5fa', 0.9);
            }}
            style={{ width: '100%' }} />
          {showSuggestions && searchSuggestions.length > 0 && (
            <div className="search-suggestions active" style={{ position: 'absolute', top: '100%', left: 0, right: 0 }}>
              {searchSuggestions.map((s) => (
                <div key={s.name + s.lat + s.lon} className="item" onClick={() => goToLocation(s.lat, s.lon, s.name, '#60a5fa', 0.9)}>{s.name}</div>
              ))}
            </div>
          )}
        </div>
        <div className="topbar-right">
          <div className="status-pill">
            <div className="status-dot" />
            <span>Live</span>
          </div>
          <button className={`btn-icon ${showAI ? 'active' : ''}`} onClick={() => setShowAI(p => !p)} title="AI Assistant">🤖</button>
          <button className={`btn-icon ${showAlertsPanel ? 'active' : ''}`} onClick={() => setShowAlertsPanel(p => !p)} title="Alerts">
            🔔
            {newAlertCount > 0 && <span style={{ position:'absolute',top:-2,right:-2,background:'#ef4444',color:'white',fontSize:9,borderRadius:'50%',width:14,height:14,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:600}}>{newAlertCount}</span>}
          </button>
          <button className={`btn-icon ${showShareDialog ? 'active' : ''}`} onClick={() => setShowShareDialog(true)} title="Share">📤</button>
          <button className="btn-icon" onClick={() => setShowApiVault(true)} title="API Configuration">🔑</button>
          <button className="btn-icon" onClick={takeSnapshot} title="Snapshot"><Camera size={16} /></button>
          <button className="btn-icon" onClick={flyToIndiaDirect} title="Fly to India">🇮🇳</button>
          <button
            className={`btn-icon ${isLayerEnabled('india_cctv') ? 'active' : ''}`}
            onClick={() => toggleLayer('india_cctv')}
            title="Worldwide Public Cameras"
          >
            <Cctv size={16} />
          </button>
          <button className="btn-icon" onClick={toggleISS} title="ISS Tracker">🛰️</button>
          <button className={`btn-icon ${showTimeline ? 'active' : ''}`} onClick={toggleTimeline} title="Timeline">⏱️</button>
          <button className="btn-icon" onClick={toggleAutoRotate} title="Auto Rotate" style={isAutoRotating ? {borderColor:'#22c55e',color:'#22c55e'} : {}}>🔄</button>
        </div>
      </div>

      {/* Sidebar */}
      <div className={`sidebar glass-panel ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-title">Data Layers ({activeLayerCount} active)</div>
          <div className="imagery-row">
            {['earth','satellite','dark','terrain'].map(type => (
              <button key={type} className={`img-chip ${activeImagery === type ? 'active' : ''}`}
                onClick={() => setImagery(type)}>
                {type === 'earth' ? '🌍 Earth' : type === 'satellite' ? '🛰️ Sat' : type === 'dark' ? '🌑 Dark'
                  : '⛰️ Ter'}
              </button>
            ))}
          </div>
        </div>
        <div className="sidebar-search">
          <span className="sidebar-search-icon">🔍</span>
          <input type="text" placeholder="Search data layers..." value={layerSearch}
            onChange={e => setLayerSearch(e.target.value)}
            onClick={e => e.stopPropagation()} />
        </div>
        <div className="sidebar-scroll">
          {CATEGORIES.map(cat => {
            const items = (groupedLayers[cat.id] || []).filter(l =>
              !layerSearch.trim() || l.label.toLowerCase().includes(layerSearch.toLowerCase())
            );
            if (layerSearch.trim() && items.length === 0) return null;
            const isOpen = openCategories.includes(cat.id) || (layerSearch.trim().length > 0);
            return (
              <div key={cat.id} className={`category ${isOpen ? 'open' : ''}`}>
                <div className="category-header" onClick={() => setOpenCategories(prev =>
                  prev.includes(cat.id) ? prev.filter(c => c !== cat.id) : [...prev, cat.id]
                )}>
                  <div className="cat-icon" style={{color:cat.color}}>{cat.icon}</div>
                  <span style={{color:isOpen ? 'var(--text)' : undefined}}>{cat.label}</span>
                  <span className="cat-count">{items.filter(l => l.on).length}/{items.length}</span>
                  <span className="cat-chevron">▶</span>
                </div>
                <div className="category-items">
                  {items.map(layer => (
                    <div key={layer.id} className={`layer-item ${layer.on ? 'active' : ''} ${pulsingLayer === layer.id ? 'pulsing' : ''}`}
                      onClick={() => toggleLayer(layer.id)}>
                      <div className="layer-dot" style={{background:layer.color,boxShadow:layer.on ? `0 0 8px ${layer.color}` : 'none'}} />
                      <div style={{flex:1}}>
                        <div className="layer-label">{layer.label}</div>
                        {layer.sub && <div className="layer-sub">{layer.sub}</div>}
                      </div>
                      {layer.badge && <span className={`layer-badge badge-${layer.badge.toLowerCase()}`}>{layer.badge}</span>}
                      <div className="toggle">
                        <input type="checkbox" checked={layer.on} onChange={e => { e.stopPropagation(); toggleLayer(layer.id); }} />
                        <div className="toggle-slider" />
                      </div>
                      {layer.badge === 'LIVE' && <div className="layer-status">
                        <div className="live-dot" />
                        <span>Live</span>
                      </div>}
                      {layer.type === 'tile' && layer.on && (
                        <div className="opacity-wrap">
                          <span className="opacity-label">{(layerOpacity[layer.id] ?? layer.opacity) * 100 >> 0}%</span>
                          <input type="range" min="0" max="100" value={((layerOpacity[layer.id] ?? layer.opacity) * 100) >> 0}
                            onChange={e => { e.stopPropagation(); setLayerOpacity(prev => ({...prev,[layer.id]:parseInt(e.target.value)/100})); }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="sidebar-footer">
          <div className="all-toggle-row">
            <span className="all-toggle-label">Global Controls</span>
          </div>
          <div className="btn-row" style={{marginBottom:8}}>
            <button className="btn-all" onClick={() => toggleAllLayers(true)}>Enable All</button>
            <button className="btn-all" onClick={() => toggleAllLayers(false)}>Disable All</button>
          </div>
          <button className="btn-all" onClick={enableDefaultLayers}>Reset to Defaults</button>
        </div>
      </div>

      {/* Sidebar Toggle */}
      <div className={`sidebar-toggle ${sidebarCollapsed ? 'collapsed' : ''}`}
        style={{ left: sidebarCollapsed ? 0 : 300 }}
        onClick={() => setSidebarCollapsed(p => !p)}>
        {sidebarCollapsed ? '▶' : '◀'}
      </div>

      {/* Info Panel */}
      <div className={`info-panel glass-panel ${infoEntity ? '' : 'hidden'}`}>
        {formatInfoPanel()}
      </div>

      {/* AI Panel */}
      <div className={`ai-panel glass-panel ${showAI ? 'open' : ''}`}>
        <div className="ai-header">
          <div className="ai-icon">🤖</div>
          <div className="ai-title">Earth Intelligence AI</div>
          <button className="ai-close" onClick={() => setShowAI(false)}>✕</button>
        </div>
        <div className="ai-messages">
          {aiMessages.map((msg) => (
            <div key={msg.id} className={`ai-msg ${msg.role}`}>
              {msg.role === 'assistant' ? (
                <div dangerouslySetInnerHTML={{
                  __html: msg.content
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/`([^`]+)`/g, '<code>$1</code>')
                    .replace(/\n/g, '<br/>')
                }} />
              ) : msg.content}
            </div>
          ))}
          {aiTyping && (
            <div className="ai-typing">
              <span /><span /><span />
            </div>
          )}
        </div>
        <div className="ai-suggestion-chips">
          {['Recent earthquakes?','Weather in Tokyo','Show wildfires','Population impact'].map(chip => (
            <span key={chip} className="ai-chip" onClick={() => { setAiInput(chip); }}>{chip}</span>
          ))}
        </div>
        <div className="ai-input-wrap">
          <input className="ai-input" placeholder="Ask about earthquakes, weather, disasters..."
            value={aiInput} onChange={e => setAiInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendAI(); }} />
          <button className="ai-send" onClick={sendAI}>➤</button>
        </div>
        <div className="ai-api-note">
          Powered by {aiApiType === 'anthropic' ? 'Claude' : aiApiType === 'gemini' ? 'Gemini' : 'Local AI'}
        </div>
      </div>

      {/* Alerts Panel */}
      <div className={`alerts-panel glass-panel ${showAlertsPanel ? 'open' : ''}`}>
        <div className="ai-header">
          <div className="ai-icon" style={{background:'linear-gradient(135deg,#ef4444,#f97316)'}}>⚠️</div>
          <div className="ai-title">Disaster Alerts</div>
          <button className="ai-close" onClick={() => setShowAlertsPanel(false)}>✕</button>
        </div>
        <div className="alerts-list">
          {alerts.length === 0 && <div style={{textAlign:'center',padding:20,color:'var(--text-dim)',fontSize:12}}>No active alerts</div>}
          {alerts.map(a => (
            <div key={a.id} className={`alert-item ${!a.seen ? 'new' : ''}`}
              onClick={() => {
                setAlerts(prev => prev.map(a2 => a2.id === a.id ? { ...a2, seen: true } : a2));
                setNewAlertCount(prev => Math.max(0, prev - 1));
                focusLocation(a.lat, a.lon, { label: a.title, color: getSeverityColor(a.severity), height: 150 });
              }}>
              <div className="alert-title">
                <div className="alert-dot" style={{background:a.severity === 'red' ? '#ef4444' : a.severity === 'orange' ? '#f97316' : '#22c55e'}} />
                {a.title}
              </div>
              <div className="alert-desc">{a.desc}</div>
              <div className="alert-desc" style={{marginTop:4,color:'var(--text-muted)'}}>📍 {a.lat.toFixed(2)}, {a.lon.toFixed(2)}</div>
              <div className="alert-time">{new Date(a.time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST</div>
            </div>
          ))}
        </div>
        <div className="alerts-footer">
          <button className="alert-btn" onClick={() => {
            alertsRef.current.forEach(a => a.seen = true);
            setAlerts([...alertsRef.current]);
            setNewAlertCount(0);
          }}>Mark All Read</button>
          <button className="alert-btn" onClick={() => {
            const v = viewerRef.current;
            if (v) {
              entityStoreRef.current['disaster_alerts']?.forEach(e => v.entities.remove(e));
            }
            entityStoreRef.current['disaster_alerts'] = [];
            Object.keys(alertEntityRef.current).forEach(id => { delete alertEntityRef.current[id]; });
            alertsRef.current = [];
            setAlerts([]);
            setNewAlertCount(0);
          }}>Clear All</button>
        </div>
      </div>

      {/* Social Panel */}
      <div className={`social-panel glass-panel ${showIntelFeed ? 'open' : ''}`}>
        <div className="ai-header">
          <div className="social-icon-grad">📱</div>
          <div className="ai-title">Intel Feed</div>
          <button className="ai-close" onClick={() => setShowIntelFeed(false)}>✕</button>
        </div>
        <div style={{padding:'8px 12px',borderBottom:'1px solid var(--border)',display:'flex',gap:6,flexWrap:'wrap'}}>
          {['all','fire','storm','earthquake','flood','social'].map(f => (
            <button key={f} className={`social-filter-chip ${intelFilter === f ? 'active' : ''}`}
              onClick={() => setIntelFilter(f)}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="social-feed">
          {intelFeed.filter(p => {
            if (intelFilter === 'all') return true;
            if (intelFilter === 'social') return ['news', 'social', 'twitter', 'facebook'].includes(p.type);
            return p.type === intelFilter;
          }).map(item => (
            <div key={item.id} className="social-post" onClick={() => focusLocation(item.lat, item.lon, { label: item.title, color: '#00D4FF', height: 150 })}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <span className="social-user">{item.title}</span>
                <span className="social-time">{item.timeLabel}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div>
                  <div style={{fontSize:10,color:'var(--text-muted)'}}>
                    {item.platform === 'twitter' ? '🐦 ' : item.platform === 'facebook' ? '📘 ' : item.platform === 'news' ? '📰 ' : ''}
                    {item.source} · {item.type}
                  </div>
                  <div style={{fontSize:10,color:'var(--text-dim)',marginTop:4}}>
                    {item.lat !== 0 ? `📍 ${item.lat.toFixed(2)}, ${item.lon.toFixed(2)}` : '🌍 Global'}
                  </div>
                </div>
                {item.url && (
                  <a href={item.url} target="_blank" rel="noreferrer" 
                     className="glass-button" style={{fontSize:10, padding:'2px 6px', textDecoration:'none'}}
                     onClick={(e) => e.stopPropagation()}>
                    View {item.platform === 'news' ? 'Article' : item.platform === 'internal' ? 'Details' : 'Post'}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className={`timeline-bar glass-panel ${showTimeline ? '' : 'collapsed'} ${sidebarCollapsed ? 'full-width' : ''}`}>
        <button className="tl-btn" onClick={startTimeline}>▶</button>
        <button className="tl-btn" onClick={pauseTimeline}>⏸</button>
        <button className="tl-btn" onClick={resetTimeline}>⏮</button>
        <button className="tl-btn" onClick={stopTimeline}>⏹</button>
        <div className="tl-slider-wrap">
          <div className="tl-labels">
            <span>{new Date(timelineRef.current.start).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
            <span>{new Date(timelineRef.current.current).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST</span>
            <span>Now</span>
          </div>
          <input type="range" className="tl-slider" min="0" max="100" value={timelineValue}
            onChange={e => handleTimelineSlider(parseInt(e.target.value))} />
        </div>
        <span className="tl-speed">{timelineRef.current.speed}x</span>
      </div>

      {/* Stats Bar */}
      <div className={`statsbar glass-panel ${sidebarCollapsed ? 'full-width' : ''}`}>
        <div className="stat-item"><div className="stat-dot" style={{background:'#3b82f6'}}/><span className="stat-label">Entities</span><span className="stat-val">{totalEntities}</span></div>
        <div className="stat-item"><div className="stat-dot" style={{background:'#22c55e'}}/><span className="stat-label">Events</span><span className="stat-val">{activeEvents}</span></div>
        <div className="stat-item"><div className="stat-dot" style={{background:'#a855f7'}}/><span className="stat-label">Alerts</span><span className="stat-val">{newAlertCount}</span></div>
        <div className="stat-item"><div className="stat-dot" style={{background:'#f59e0b'}}/><span className="stat-label">Layers</span><span className="stat-val">{activeLayerCount}/{LAYER_DEFS.length}</span></div>
        <div className="stat-item"><div className="stat-dot" style={{background:'#00D4FF'}}/><span className="stat-label">FPS</span><span className="stat-val">{fps}</span></div>
        <div className="stat-item"><div className="stat-dot" style={{background:'#14b8a6'}}/><span className="stat-label">Camera</span><span className="stat-val">{cameraDms || '—'}</span></div>
      </div>

      {/* Zoom Controls */}
      <div className="zoom-controls">
        <button className="zoom-btn" onClick={zoomIn} aria-label="Zoom in">+</button>
        <button className="zoom-btn" onClick={zoomOut} aria-label="Zoom out">−</button>
      </div>

      {/* Context Menu */}
      <div ref={contextMenuRef} className={`context-menu ${contextMenu.show ? 'active' : ''}`}
        style={{ left: contextMenu.x - 90, top: contextMenu.y - 90 }}>
        <div className="ctx-ring">
          <div className="ctx-center">📍</div>
          <div className="ctx-item" role="menuitem" tabIndex={0} style={{top:0,left:'50%',transform:'translateX(-50%)'}}
            onClick={() => handleContextAction('flyTo')} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleContextAction('flyTo'); } }}>
            <span className="ctx-emoji">🎯</span><span className="ctx-label">Fly To</span>
          </div>
          <div className="ctx-item" role="menuitem" tabIndex={0} style={{bottom:0,left:'50%',transform:'translateX(-50%)'}}
            onClick={() => handleContextAction('pin')} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleContextAction('pin'); } }}>
            <span className="ctx-emoji">📌</span><span className="ctx-label">Drop Pin</span>
          </div>
          <div className="ctx-item" role="menuitem" tabIndex={0} style={{left:0,top:'50%',transform:'translateY(-50%)'}}
            onClick={() => handleContextAction('weather')} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleContextAction('weather'); } }}>
            <span className="ctx-emoji">🌡️</span><span className="ctx-label">Weather</span>
          </div>
          <div className="ctx-item" role="menuitem" tabIndex={0} style={{right:0,top:'50%',transform:'translateY(-50%)'}}
            onClick={() => handleContextAction('events')} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleContextAction('events'); } }}>
            <span className="ctx-emoji">📋</span><span className="ctx-label">Events</span>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {notifications.map(n => (
        <div key={n.id} className={`notification show`} style={{ top: 72 + notifications.indexOf(n) * 44 }}>
          {n.text}
        </div>
      ))}

      {/* Share Dialog */}
      {showShareDialog && (
        <div className="share-dialog active" onClick={e => { if (e.target === e.currentTarget) setShowShareDialog(false); }}>
          <div className="share-card">
            <div className="token-title">Share LiveGlobe</div>
            <div className="token-sub">Share this view or take a snapshot.</div>
            <div className="share-options">
              <button className="share-option" onClick={takeSnapshot}><Camera size={14} style={{ marginRight: 6 }} /> Snapshot</button>
              <button className="share-option" onClick={() => {
                const url = generateShareUrl();
                navigator.clipboard?.writeText(url);
                showNotification('Link copied!', 'success');
              }}>🔗 Copy Link</button>
            </div>
            <div className="share-url-box">
              <input className="share-url-input" value={generateShareUrl()} readOnly />
              <button className="share-copy-btn" onClick={() => {
                navigator.clipboard?.writeText(generateShareUrl());
                showNotification('Copied!', 'success');
              }}>Copy</button>
            </div>
            <button className="btn-secondary" style={{marginTop:12}} onClick={() => setShowShareDialog(false)}>Close</button>
          </div>
        </div>
      )}

      {/* ISS Info */}
      {showISSInfo && issInfo && (
        <div className="iss-panel show glass-panel">
          <div className="iss-dot" />
          <div className="iss-info">ISS Position</div>
          <div className="iss-coords">{issInfo.lat.toFixed(2)}°N, {issInfo.lon.toFixed(2)}°E</div>
        </div>
      )}


      {/* Weather Cards */}
      {weatherCards.map(wc => (
        <div key={wc.id} ref={el => { weatherCardElementsRef.current[wc.id] = el; }} className="weather-card glass-panel"
          style={{ display: 'block', pointerEvents: 'auto', opacity: 0 }}
          onClick={() => focusLocation(wc.lat, wc.lon, { label: 'Weather location', color: '#22d3ee', height: 150 })}>
          <div className="weather-card-header">
            <span className="weather-icon">🌡️</span>
            <div>
              <div className="weather-temp">{wc.temp}°C</div>
              <div className="weather-desc">{wc.desc}</div>
            </div>
          </div>
          <div className="weather-grid">
            <div className="weather-item"><span className="weather-label">Lat</span><span className="weather-value">{wc.lat.toFixed(2)}°</span></div>
            <div className="weather-item"><span className="weather-label">Lon</span><span className="weather-value">{wc.lon.toFixed(2)}°</span></div>
          </div>
        </div>
      ))}

      {/* Heatmap Legend */}
      {showHeatmapLegend && (
        <div className="heatmap-legend show glass-panel" style={{ bottom: 100 }}>
          <div className="heatmap-legend-title">Seismic Density</div>
          <div className="heatmap-gradient" />
          <div className="heatmap-labels"><span>Low</span><span>Medium</span><span>High</span></div>
        </div>
      )}

      {/* Storm Legend */}
      {showStormLegend && (
        <div className="legend-panel show glass-panel" style={{ bottom: 190 }}>
          <div className="heatmap-legend-title">Storm Forecast Cone</div>
          <div className="legend-row"><div className="legend-color" style={{background:'rgba(168,85,247,0.3)'}}/><span>24h forecast</span></div>
          <div className="legend-row"><div className="legend-color" style={{background:'rgba(168,85,247,0.2)'}}/><span>48h forecast</span></div>
          <div className="legend-row"><div className="legend-color" style={{background:'rgba(168,85,247,0.1)'}}/><span>72h forecast</span></div>
        </div>
      )}

      {/* Smoke Legend */}
      {showSmokeLegend && (
        <div className="heatmap-legend show glass-panel" style={{ bottom: 280 }}>
          <div className="heatmap-legend-title">Wildfire Smoke Dispersion</div>
          <div className="heatmap-gradient" style={{ background: 'linear-gradient(90deg, rgba(120,113,108,0.15), rgba(120,113,108,0.45), rgba(68,64,60,0.75))' }} />
          <div className="heatmap-labels"><span>Light</span><span>Moderate</span><span>Heavy</span></div>
        </div>
      )}

      {/* Tsunami Legend */}
      {showTsunamiLegend && (
        <div className="legend-panel show glass-panel" style={{ bottom: 370 }}>
          <div className="heatmap-legend-title">Tsunami Travel Time</div>
          <div className="legend-row"><div className="legend-color" style={{background:'#22c55e'}}/><span>&lt; 1h</span></div>
          <div className="legend-row"><div className="legend-color" style={{background:'#f59e0b'}}/><span>1-3h</span></div>
          <div className="legend-row"><div className="legend-color" style={{background:'#ef4444'}}/><span>3-6h</span></div>
          <div className="legend-row"><div className="legend-color" style={{background:'#7f1d1d'}}/><span>6h+</span></div>
        </div>
      )}

      {/* Population Impact Indicator */}
      {showPopulationImpact && (
        <div className="heatmap-legend show glass-panel" style={{ bottom: 460 }}>
          <div className="heatmap-legend-title">Population Impact Zones</div>
          <div className="pop-gradient" />
          <div className="heatmap-labels"><span>Low</span><span>High Density</span></div>
        
        </div>
      )}
    </div>
  );
}
