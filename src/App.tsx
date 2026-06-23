/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cctv, Camera, Monitor } from 'lucide-react';
import DOMPurify from 'dompurify';
import { useWebSocket } from '@/hooks/useWebSocket';
import LoginModal from '@/components/LoginModal';
import AdminDashboard from '@/pages/AdminDashboard';
import { useAuth, authHeaders } from '@/context/AuthContext';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { apiGet } from '@/lib/api';
import StudyAreaPanel from '@/components/ui/StudyAreaPanel';
import type { StudyAreaItem } from '@/rendering/studyArea';
import {
  removeStudyAreaFromGlobe, setStudyAreaVisibility,
  flyToStudyAreaTopDown, filterDataEntitiesByStudyArea, updateStudyAreaStyle,
  setStudyAreaActive, computeStudyAreaBbox, restoreHiddenEntities,
} from '@/rendering/studyArea';
import { addBaseImagery, applyTerrainProvider, crossfadeImagery } from '@/cesium/viewer.config';
import { cinematicFlyTo, createEntityTracker, type TrackEntityType } from '@/cesium/camera.controller';
import { addEarthquakeEntity, type UsgsFeature } from '@/rendering/earthquakes';
import { loadTectonicPlates } from '@/rendering/tectonic';
import { FlightDeadReckoning, altitudeBandColor } from '@/rendering/flights';
import { AisVesselTracker } from '@/rendering/ais';
import { GhostProtocol } from '@/rendering/ghostProtocol';
import { ForkRenderer } from '@/rendering/forkRenderer';
import { EntropyHalo } from '@/rendering/entropyHalo';
import { OracleChainRenderer, type CausalChainLink } from '@/rendering/oracleChains';
import {
  loadAirspaces,
  addSpaceDebrisEntities,
  addNasaDsnEntities,
  addLightningEntities,
  addAuroraEntities,
  loadSubmarineCablesDataSource,
  addElectricityGridEntities,
  addAnimalMigrationEntities,
  getDebrisOrbitPositions
} from '@/rendering/realDataLayers';
import { ForkPanel } from '@/components/ForkPanel';

import { ReasoningTraceViewer, EvidenceChainPanel, UncertaintyBadge, HumanOverrideBanner } from '@/components/explainability/index';
import { CognitiveDashboard, AlertPanel as CockpitAlertPanel, ToolWorkbench, MemoryExplorer, SettingsPanel } from '@/components/cockpit/index';
import { ApiVault } from '@/components/ui/api-vault';
import ScenarioViewer from '@/components/scenarios/ScenarioViewer';
import ScenarioEditor from '@/components/scenarios/ScenarioEditor';
import ScenarioGallery from '@/components/scenarios/ScenarioGallery';
import CinematicDirector from '@/components/scenarios/CinematicDirector';
import SpatialSketching from '@/components/scenarios/SpatialSketching';
import { createRenderScheduler } from '@/lib/renderScheduler';
import { loadOsmBuildings, hideOsmBuildings, removeOsmBuildings } from '@/rendering/digitalTwinLayers';
import {
  FlightDeadReckoning as AviationFlightDeadReckoning,
  addVolcanoEntities,
  addVaacAdvisoryEntities,
  addSo2Entities,
  addOpenFlightsEntities,
} from '@/rendering/aviation';
import {
  addGenericPointEntities,
  addStormTrackEntities,
  addDroughtZoneEntities,
  addRadarSiteEntities,
  addClimateIndicesEntities,
} from '@/rendering/weather';
import { renderLayer, fetchLayerData } from '@/rendering/genericLayers';
import { LAYER_GROUPS, LAYER_CATEGORIES, LEGACY_DEFAULTS } from '@/config/layerConfig';
import { listChats, getChat, saveChat, deleteChat, generateChatId, autoTitle, groupChatsByDate, type ChatSession, type ChatListItem, type ChatMessage } from '@/lib/chatStore';

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
interface WeatherCardData { id: string; lon: number; lat: number; temp: number; humidity: number; windSpeed: number; pressure: number; precipitation: number; desc: string; }
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
  sentinelHubClientId: string;
  sentinelHubClientSecret: string;
  marineTrafficApiKey: string;
  aisStreamApiKey: string;
  preferredAiProvider: AiProvider;
  vaultDismissed: boolean;
}

let cachedCctvCanvas: HTMLCanvasElement | null = null;

const CATEGORIES = LAYER_GROUPS.map(g => ({
  id: g.id,
  label: g.label,
  icon: g.icon,
  color: g.color,
}));

// Build LAYER_DEFS from config, applying legacy defaults
const LAYER_DEFS: LayerItem[] = LAYER_CATEGORIES.map(lc => {
  const def = LEGACY_DEFAULTS[lc.id];
  const isDefault = def?.on === true;
  return {
    id: lc.id,
    label: lc.label,
    color: lc.color,
    type: lc.type,
    on: def?.on === true,
    default: isDefault,
    opacity: def?.opacity ?? 1,
    category: lc.group,
    sub: lc.sub,
    badge: lc.badge,
  };
});

const LEGACY_VAULT_KEYS = 'liveglobe.apiKeys.v1';
const LEGACY_VAULT_STATE = 'liveglobe.apiVault.v1';
const CESIUM_ION_ENV_TOKEN = (import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN as string | undefined)?.trim() ?? '';

const DEFAULT_API_VAULT: ApiVaultState = {
  gemini: '',
  anthropic: '',
  cesiumIonAccessToken: '',
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

function sanitizeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
}

function vaultFromFlatKeys(keys: Record<string, string>): ApiVaultState {
  return {
    ...DEFAULT_API_VAULT,
    gemini: keys.GOOGLE_GEMINI_API_KEY ?? '',
    anthropic: keys.ANTHROPIC_API_KEY ?? '',
    cesiumIonAccessToken: keys.CESIUM_ION_ACCESS_TOKEN ?? CESIUM_ION_ENV_TOKEN,
    sentinelHubClientId: keys.SENTINEL_HUB_CLIENT_ID ?? '',
    sentinelHubClientSecret: keys.SENTINEL_HUB_CLIENT_SECRET ?? '',
    marineTrafficApiKey: keys.MARINE_TRAFFIC_API_KEY ?? '',
    aisStreamApiKey: keys.AIS_STREAM_API_KEY ?? '',
  };
}

function loadApiVault(): ApiVaultState {
  return {
    ...DEFAULT_API_VAULT,
    cesiumIonAccessToken: CESIUM_ION_ENV_TOKEN,
  };
}

function purgeLegacyVaultStorage(): void {
  try {
    localStorage.removeItem(LEGACY_VAULT_KEYS);
    localStorage.removeItem(LEGACY_VAULT_STATE);
  } catch {
    /* ignore */
  }
}

function hasAnyApiVaultValue(vault: ApiVaultState): boolean {
  return Boolean(
    vault.gemini.trim() ||
    vault.anthropic.trim() ||
    vault.cesiumIonAccessToken.trim() ||
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
    const cone48 = generateStormCone([lon, lat], heading, radii48, spread48);
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
    let cancelled = false;
    const isHls = src.includes('.m3u8') || src.includes('m3u8');

    if (isHls) {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) {
          if (hls) hls.destroy();
          return;
        }
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
        if (cancelled) return;
        console.error('Failed to load hls.js', err);
        setError(true);
      });
    } else {
      video.src = src;
      video.load();
      video.play().catch(() => {});
    }

    return () => {
      cancelled = true;
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
   PHASE 8: Rich message renderer — code blocks, tables, lists
   ═════════════════════════════════════════════════════════════════ */

const RICH_MESSAGE_CACHE = new Map<string, string>();

const TYPE_LABELS: Record<string, string> = {
  earthquake_swarm: 'Earthquake Swarm', hurricane_landfall: 'Hurricane Landfall',
  wildfire_spread: 'Wildfire Spread', volcanic_eruption: 'Volcanic Eruption',
  flood_inundation: 'Flood Inundation', tsunami_wave: 'Tsunami Wave',
  data_layer: 'Data Layer',
};

function adaptScenario(raw: any): any {
  const severity = raw.validationScore > 0.8 ? 'extreme' : raw.validationScore > 0.6 ? 'high' : raw.validationScore > 0.4 ? 'medium' : 'low';
  const lat = raw.params?.lat ?? raw.params?.epicenterLat ?? 0;
  const lon = raw.params?.lon ?? raw.params?.epicenterLon ?? 0;
  return {
    id: raw.id,
    type: raw.type,
    name: (raw.dataSources?.length ? '🧬 ' : '') + (TYPE_LABELS[raw.type as string] || raw.type),
    pointCloud: raw.pointCloud,
    validationScore: raw.validationScore,
    severity,
    location: { lat, lon },
    timestamp: raw.createdAt,
    metadata: {
      ...raw.metadata,
      colorValues: raw.colorValues,
      valueMin: raw.valueMin,
      valueMax: raw.valueMax,
      variableName: raw.variableName,
      dataSources: raw.dataSources,
      bbox: raw.bbox,
    },
  };
}

function mapFrontendParams(type: string, params: Record<string, unknown>): Record<string, unknown> {
  const { lat, lon, magnitude = 5, depth = 10, spread = 0.1, intensity = 1, duration = 24, windSpeed = 50, populationDensity: _pd, ...rest } = params;
  const base = { lat, lon };
  switch (type) {
    case 'earthquake_swarm':
      return { ...base, depthRange: [Math.max(0.1, (depth as number) - 5), (depth as number) + 5], magnitudeRange: [Math.max(0, (magnitude as number) - 2), Math.min(9.5, (magnitude as number) + 2)], numEvents: Math.max(10, Math.round((spread as number) * 100)), timeWindow: duration, decayModel: 'omori' };
    case 'hurricane_landfall':
      return { ...base, category: Math.min(7, Math.max(1, Math.round((magnitude as number) / 1.5))), forwardSpeed: windSpeed, pressure: Math.round(1050 - (intensity as number) * 10), radius: Math.max(10, (spread as number) * 200 + 10), landfallTime: duration };
    case 'wildfire_spread':
      return { ...base, area: Math.max(100, (spread as number) * 5000 + 500), windSpeed: windSpeed, windDir: 270, humidity: Math.max(0, Math.min(100, 100 - (depth as number))), fuelType: 'forest', duration };
    case 'volcanic_eruption':
      return { ...base, vei: Math.min(7, Math.max(1, Math.round((magnitude as number) / 2))), ashHeight: Math.max(1000, (intensity as number) * 2000), windDir: 260, duration };
    case 'flood_inundation':
      return { ...base, rainfall: Math.max(10, (intensity as number) * 100), catchmentArea: Math.max(100, (spread as number) * 5000), soilSaturation: Math.min(1, Math.max(0, (depth as number) / 100)), duration };
    case 'tsunami_wave':
      return { epicenterLat: lat, epicenterLon: lon, magnitude, depth, waveHeight: Math.max(1, (intensity as number) * 5), arrivalTimes: [30, 45, 60, 90, 120] };
    default:
      return { ...base, ...params };
  }
}

function richRender(text: string): string {
  const cached = RICH_MESSAGE_CACHE.get(text);
  if (cached) return cached;

  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks ```lang\n...\n```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langTag = lang ? `<span class="code-lang">${lang}</span>` : '';
    return `<div class="rich-code-block">${langTag}<pre><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre></div>`;
  });

  // Tables: | col1 | col2 |\n | --- | --- |\n | val1 | val2 |
  html = html.replace(/\n?\|(.+)\|\n\|([-|:\s]+)\|\n((?:\|.+\|\n?)*)/g, (_, headerRow, _sepRow, dataRows) => {
    const headers = headerRow.split('|').map((h: string) => `<th>${h.trim()}</th>`).join('');
    const rows = dataRows.trim().split('\n').map((row: string) => {
      const cells = row.split('|').map((c: string) => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<div class="rich-table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
  });

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="rich-hr" />');

  // Unordered lists: - item or * item
  html = html.replace(/^( *)[-*] (.+)$/gm, '$1<li>$2</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul class="rich-list">$&</ul>');

  // Ordered lists: 1. item
  html = html.replace(/^ *(\d+)\. (.+)$/gm, '<li value="$1">$2</li>');

  // ### Headers
  html = html.replace(/^### (.+)$/gm, '<h3 class="rich-h3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="rich-h2">$1</h2>');

  // Bold, italic, inline code — in this order to avoid overlap
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code class="rich-code">$1</code>');

  // Line breaks (preserve double newlines as paragraph breaks)
  html = html.replace(/\n{2,}/g, '</p><p class="rich-p">');
  html = html.replace(/\n/g, '<br/>');

  // Wrap in paragraph if not already wrapped
  if (!html.startsWith('<')) html = `<p class="rich-p">${html}</p>`;

  // Sanitize to prevent XSS — defense in depth even though text was already escaped
  const safe = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'hr', 'strong', 'em', 'code', 'pre', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'a', 'blockquote'],
    ALLOWED_ATTR: ['class', 'value', 'href', 'rel', 'target'],
    ALLOW_DATA_ATTR: false,
  });
  RICH_MESSAGE_CACHE.set(text, safe);
  return safe;
}

function renderCommandChips(
  content: string,
  focusLocation: (lat: number, lon: number, opts?: Record<string, unknown>) => void,
  toggleLayer: (id: string) => void,
) {
  const cmdChips: Array<{label:string;action:string;lat?:number;lon?:number;layerId?:string}> = [];
  const cmdBlock = content.match(/## COMMANDS\n([\s\S]*?)(?:\n##|\n*$)/);
  if (cmdBlock) {
    const cmdMatches = cmdBlock[1].match(/\{[^}]+\}/g);
    if (cmdMatches) {
      for (const json of cmdMatches) {
        try {
          const cmd = JSON.parse(json);
          if (cmd.action === 'flyTo' && cmd.lat && cmd.lon) {
            cmdChips.push({label:'📍 ' + (cmd.label||'Fly'),action:'flyTo',lat:cmd.lat,lon:cmd.lon});
          }
          if (cmd.action === 'toggleLayer' && cmd.layerId) {
            cmdChips.push({label:'👁 ' + cmd.layerId,action:'toggleLayer',layerId:cmd.layerId});
          }
        } catch { /* skip */ }
      }
    }
  }
  if (cmdChips.length === 0) return null;
  return (
    <div className="msg-commands" style={{display:'flex',gap:4,marginTop:6,flexWrap:'wrap'}}>
      {cmdChips.map((chip,i) => (
        <span key={i} className="ai-chip command-chip" style={{fontSize:10,padding:'2px 8px'}}
          onClick={() => {
            if (chip.action === 'flyTo' && chip.lat && chip.lon) focusLocation(chip.lat, chip.lon, { label: chip.label || 'Location', color: '#60a5fa', height: 150 });
            if (chip.action === 'toggleLayer' && chip.layerId) toggleLayer(chip.layerId);
          }}>{chip.label}</span>
      ))}
    </div>
  );
}

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
  const forkRendererRef = useRef<ForkRenderer | null>(null);
  const issTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rotateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const geocodeCacheRef = useRef<Record<string, Array<{name:string;lat:number;lon:number}>>>({});
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchValueRef = useRef('');
  const timelineThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineLastUpdateRef = useRef<number>(0);
  const pinCountRef = useRef(0);
  const entityStoreRef = useRef<Record<string, Cesium.Entity[]>>({});
  const dataStoreRef = useRef<Record<string, unknown[]>>({});
  const magnitudeScaleRef = useRef(1);
  const autoRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRefreshSlowRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const issEntityRef = useRef<Cesium.Entity | null>(null);
  const issTrailRef = useRef<Cesium.SampledPositionProperty | null>(null);
  const issTimesRef = useRef<Cesium.JulianDate[]>([]);
  const issRenderTickRef = useRef<(() => void) | null>(null);
  const issLoadingRef = useRef(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const alertsRef = useRef<EventAlert[]>([]);
  const notificationTimeoutsRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const populationImpactLayerRef = useRef<Cesium.Entity[]>([]);
  const intelFeedRef = useRef<IntelFeedItem[]>([]);
  const weatherCardElementsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const weatherAbortRef = useRef<AbortController | null>(null);
  const focusMarkerRef = useRef<Cesium.Entity | null>(null);
  const flightDrRef = useRef<FlightDeadReckoning | null>(null);
  const adsbLolDrRef = useRef<FlightDeadReckoning | null>(null);
  const adsbFiDrRef = useRef<FlightDeadReckoning | null>(null);
  const flightawareDrRef = useRef<FlightDeadReckoning | null>(null);
  const airlabsDrRef = useRef<FlightDeadReckoning | null>(null);
  const aisTrackerRef = useRef<AisVesselTracker | null>(null);
  const ghostProtocolRef = useRef<GhostProtocol | null>(null);
  const entropyHaloRef = useRef<EntropyHalo | null>(null);
  const oracleChainRef = useRef<OracleChainRenderer | null>(null);
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
  const cctvPulseEntityRef = useRef<Cesium.Entity | null>(null);
  const nextAiMsgIdRef = useRef(1);
  const MAX_ENTITIES = 50000;
  const toggleDebounceRef = useRef<Record<string, number>>({});

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
  const [showStudyArea, setShowStudyArea] = useState(false);
  const [studyWest, setStudyWest] = useState('68.0');
  const [studySouth, setStudySouth] = useState('6.0');
  const [studyEast, setStudyEast] = useState('98.0');
  const [studyNorth, setStudyNorth] = useState('38.0');
  const [showAlertsPanel, setShowAlertsPanel] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<Record<string, unknown> | null>(null);
  const [showIntelFeed, setShowIntelFeed] = useState(false);
  const [activeLayerCount, setActiveLayerCount] = useState(0);
  const [utcTime, setUtcTime] = useState('');
  const [totalEntities, setTotalEntities] = useState(0);
  const [activeEvents, setActiveEvents] = useState(0);
  const [weatherCards, setWeatherCards] = useState<WeatherCardData[]>([]);
  const [contextMenu, setContextMenu] = useState<{show:boolean;x:number;y:number;lat:number;lon:number}>({show:false,x:0,y:0,lat:0,lon:0});
  const [forks, setForks] = useState<Array<{forkId: string; name: string; divergenceScore: number; status: string}>>([]);
  const [activeForkCount, setActiveForkCount] = useState(0);
  const [monitorCollapsed, setMonitorCollapsed] = useState(false);
  const [memoryStats, setMemoryStats] = useState<Record<string, { count: number }> | null>(null);
  const [reflexStates, setReflexStates] = useState<Array<{ reflexId: string; status: string }>>([
    { reflexId: 'seismic-pupillary', status: 'IDLE' },
    { reflexId: 'storm-pupillary', status: 'IDLE' },
    { reflexId: 'maritime-distress', status: 'IDLE' },
  ]);
  const [recentDiscoveries, setRecentDiscoveries] = useState<Array<{ summary: string; confidence: number }>>([]);
  const [lastDream, setLastDream] = useState<{ scenariosRun: number; modelUpdates: number; newCausalEdges: number; timestamp: number } | null>(null);
  const [alerts, setAlerts] = useState<EventAlert[]>([]);
  const [newAlertCount, setNewAlertCount] = useState(0);
  const [notifications, setNotifications] = useState<Array<{id:number;text:string;severity:string}>>([]);
  const [stormForecast, setStormForecast] = useState<ReturnType<typeof generateStormForecast> | null>(null);
  const [populationImpact, setPopulationImpact] = useState<ReturnType<typeof calculatePopulationImpact> | null>(null);
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([
    { id: nextAiMsgIdRef.current++, role: 'assistant', content: '👋 Welcome to Earth Intelligence AI. Ask me about earthquakes, weather, flights, or any location on Earth.' },
  ]);
  const [aiTyping, setAiTyping] = useState(false);
  const auth = useAuth();
  const ws = useWebSocket(auth.token ?? undefined);
  const { isLoggedIn, isAdmin } = auth;
  const [aiInput, setAiInput] = useState('');
  const [agentSteps, setAgentSteps] = useState<Array<{type:string;text:string;code?:string;output?:string;timeMs?:number;toolName?:string;subtask?:string;status?:string}>>([]);
  const [showReasoningFor, setShowReasoningFor] = useState<Record<string, boolean>>({});
  const [showEvidenceFor, setShowEvidenceFor] = useState<Record<string, boolean>>({});
  const [reasoningTraces, setReasoningTraces] = useState<Record<string, any>>({});
  const [evidenceChains, setEvidenceChains] = useState<Record<string, any>>({});
  const [showCognitiveDashboard, setShowCognitiveDashboard] = useState(false);
  const [showCockpitAlerts, setShowCockpitAlerts] = useState(false);
  const [showToolWorkbench, setShowToolWorkbench] = useState(false);
  const [showMemoryExplorer, setShowMemoryExplorer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showScenarioGallery, setShowScenarioGallery] = useState(false);
  const [showScenarioEditor, setShowScenarioEditor] = useState(false);
  const [showCinematicDirector, setShowCinematicDirector] = useState(false);
  const [showSpatialSketching, setShowSpatialSketching] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<any>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [scenarioGalleryScenarios, setScenarioGalleryScenarios] = useState<any[]>([]);
  const [activeStudyAreaId, setActiveStudyAreaId] = useState<string | null>(null);
  useEffect(() => {
    if (!showScenarioGallery) return;
    fetch('/api/scenarios/search', { headers: { ...authHeaders() } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.scenarios) setScenarioGalleryScenarios(data.scenarios.map(adaptScenario));
      }).catch(() => {});
  }, [showScenarioGallery]);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [agentEnvironmentId, setAgentEnvironmentId] = useState<string | null>(null);
  const agentInteractionIdRef = useRef<string | null>(null);
  const [sandboxWorkspaceId, setSandboxWorkspaceId] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [pipelineProgress, setPipelineProgress] = useState<Array<{id:string;description:string;status:string}>>([]);
  // Phase 2: Vision
  const [chatImages, setChatImages] = useState<Array<{id:number;dataUrl:string;mimeType:string;fileName:string}>>([]);
  const nextImageIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Phase 2: Voice
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<globalThis.SpeechRecognition | null>(null);
  // Phase 2: Data Analysis
  const [dataAnalysisResult, setDataAnalysisResult] = useState<Record<string, unknown> | null>(null);
  // Chat history
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showTimeSlider, setShowTimeSlider] = useState(false);
  const [timeSliderValue, setTimeSliderValue] = useState(Date.now());
  const [timeSliderPlaying, setTimeSliderPlaying] = useState(false);
  const [showMeasureTool, setShowMeasureTool] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<Array<{ lat: number; lon: number }>>([]);
  const [measureDistance, setMeasureDistance] = useState<number | null>(null);
  const [showRiskForecast, setShowRiskForecast] = useState(false);
  const currentChatIdRef = useRef<string | null>(null);
  const chatSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  // Phase 8: Session sharing. New shares store session contents locally and
  // place only an opaque reference in the URL so operational chat text is not
  // continuously leaked through address bars, browser history, screenshots, or logs.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('sessionRef=')) {
      try {
        const id = decodeURIComponent(hash.slice('sessionRef='.length));
        const raw = window.localStorage.getItem(`liveglobe.sharedSession.${id}`);
        if (!raw) return;
        const session = JSON.parse(raw);
        if (Array.isArray(session.messages)) {
          setAiMessages(session.messages.map((m: {id?:number;role:string;content:string;type?:string}) => ({...m, id: m.id || nextAiMsgIdRef.current++})));
        }
        if (session.envId) setAgentEnvironmentId(session.envId);
        if (session.wsId) setSandboxWorkspaceId(session.wsId);
        if (session.input) setAiInput(session.input);
      } catch { /* ignore session parse */ }
    } else if (hash.startsWith('session=')) {
      // Backward compatibility for old links only; new links never encode
      // message contents in the URL.
      try {
        const session = JSON.parse(decodeURIComponent(hash.slice(8)));
        if (Array.isArray(session.messages)) {
          setAiMessages(session.messages.map((m: {id?:number;role:string;content:string;type?:string}) => ({...m, id: m.id || nextAiMsgIdRef.current++})));
        }
        if (session.envId) setAgentEnvironmentId(session.envId);
        if (session.wsId) setSandboxWorkspaceId(session.wsId);
        if (session.input) setAiInput(session.input);
      } catch { /* ignore session parse */ }
    }
  }, []);

  const buildSessionShareLink = useCallback(() => {
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = {
      messages: aiMessages.slice(-10),
      envId: agentEnvironmentId,
      wsId: sandboxWorkspaceId,
      input: aiInput,
      ts: Date.now(),
    };
    window.localStorage.setItem(`liveglobe.sharedSession.${id}`, JSON.stringify(session));
    const url = new URL(window.location.href);
    url.hash = `sessionRef=${encodeURIComponent(id)}`;
    return url.toString();
  }, [agentEnvironmentId, aiInput, aiMessages, sandboxWorkspaceId]);

  // Load chat list on mount
  useEffect(() => {
    listChats().then(setChatList).catch(() => {});
  }, []);

  // Poll memory stats every 30s
  useEffect(() => {
    const fetchMemory = async () => {
      try {
        const res = await fetch('/api/memory/stats', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setMemoryStats(data.tiers);
        }
      } catch { /* silent */ }
    };
    fetchMemory();
    const interval = setInterval(fetchMemory, 30000);
    return () => clearInterval(interval);
  }, []);

  // Auto-save chat after each new message
  useEffect(() => {
    if (aiMessages.length <= 1) return;
    const id = currentChatIdRef.current || generateChatId();
    currentChatIdRef.current = id;
    if (chatSaveTimerRef.current) clearTimeout(chatSaveTimerRef.current);
    chatSaveTimerRef.current = setTimeout(() => {
      saveChat({
        id,
        title: autoTitle(aiMessages),
        messages: aiMessages as ChatMessage[],
        environmentId: agentEnvironmentId || undefined,
        workspaceId: sandboxWorkspaceId || undefined,
      }).then(() => {
        listChats().then(setChatList).catch(() => {});
      }).catch(() => {});
    }, 2000);
    return () => { if (chatSaveTimerRef.current) clearTimeout(chatSaveTimerRef.current); };
  }, [aiMessages, agentEnvironmentId, sandboxWorkspaceId]);
  // Auto-expand thinking block when new steps arrive
  const prevStepCountRef = useRef(0);
  useEffect(() => {
    if (agentSteps.length > prevStepCountRef.current) {
      setExpandedStep(-1);
    }
    prevStepCountRef.current = agentSteps.length;
  }, [agentSteps.length]);
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
  const layerGenRef = useRef<Record<string, number>>({});
  const submarineCablesDataSourceRef = useRef<Cesium.GeoJsonDataSource | null>(null);
  const selectedDebrisOrbitEntityRef = useRef<Cesium.Entity | null>(null);
  const studyAreaEntityRef = useRef<Cesium.Entity | null>(null);
  const studyAreasRef = useRef<StudyAreaItem[]>([]);
  const [studyAreas, setStudyAreas] = useState<StudyAreaItem[]>([]);
  const [studyDrawing, setStudyDrawing] = useState(false);
  const drawerRef = useRef<any>(null);

  const aiApiType = useMemo(() => resolveAiProvider(apiVault), [apiVault]);
  const cesiumIonToken = useMemo(() => resolveCesiumIonToken(apiVault), [apiVault]);

  /* ── Memo ── */
  const groupedLayers = useMemo(() => {
    const g: Record<string, LayerItem[]> = {};
    const primaryIds = new Set([
      'earthquakes', 'tectonic', 'seismic_waves', 'tsunami', 'heatmap',
      'flight_tracks', 'airports', 'airspaces',
      'ais_vessels', 'submarine_cables',
      'space_debris', 'nasa_dsn', 'space_weather',
      'lightning_strikes', 'severe_storms', 'wildfires',
      'aurora_oval', 'dust', 'co_index', 'so2_index', 'temp_anomaly',
      'volcanoes', 'floods', 'seaLakeIce',
      'disaster_alerts', 'landslides', 'flood_extent', 'disaster_near_me',
      'india_cctv', 'intel_feed', 'electricity_grid',
      'population_impact', 'dt_buildings',
      'animal_migrations', 'land_cover',
      'nasa_gibs', 'night_lights', 'aerosol_index', 'dust_score',
      'sea_ice', 'sea_temp', 'precipitation', 'wind', 'pressure',
    ]);
    for (const l of layers) {
      if (!g[l.category]) g[l.category] = [];
      g[l.category].push(l);
    }
    for (const cat of Object.keys(g)) {
      g[cat].sort((a, b) => {
        const aPrio = primaryIds.has(a.id) ? 0 : 1;
        const bPrio = primaryIds.has(b.id) ? 0 : 1;
        if (aPrio !== bPrio) return aPrio - bPrio;
        return 0;
      });
    }
    return g;
  }, [layers]);

  useEffect(() => {
    apiVaultRef.current = apiVault;
  }, [apiVault]);

  const flatKeysRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!isLoggedIn) return;
    purgeLegacyVaultStorage();
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/vault', { headers: authHeaders() });
        if (!resp.ok || cancelled) return;
        const data = await resp.json() as { keys?: Record<string, string> };
        if (cancelled || !data.keys) return;
        flatKeysRef.current = data.keys;
        setApiVault(prev => ({ ...vaultFromFlatKeys(data.keys!), preferredAiProvider: prev.preferredAiProvider, vaultDismissed: prev.vaultDismissed }));
      } catch {
        /* vault optional until user saves keys */
      }
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  const handleApiVaultSave = async (keys: Record<string, string>) => {
    flatKeysRef.current = keys;
    const newVault = vaultFromFlatKeys(keys);
    setApiVault(prev => ({ ...newVault, preferredAiProvider: prev.preferredAiProvider, vaultDismissed: prev.vaultDismissed }));
    try {
      await fetch('/api/vault', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ keys }),
      });
      purgeLegacyVaultStorage();
    } catch {
      showNotification('Failed to save API keys to server', 'warning');
    }
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
    forkRendererRef.current = new ForkRenderer(v);
    ghostProtocolRef.current = new GhostProtocol(v);
    entropyHaloRef.current = new EntropyHalo(v);
    oracleChainRef.current = new OracleChainRenderer(v);
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
      (window as any).__renderCausalChain = renderCausalChain;
    }
    entityTrackerRef.current = createEntityTracker(v);
    flightDrRef.current = new FlightDeadReckoning(v, ghostProtocolRef.current ?? undefined);
    adsbLolDrRef.current = new FlightDeadReckoning(v, ghostProtocolRef.current ?? undefined);
    adsbFiDrRef.current = new FlightDeadReckoning(v, ghostProtocolRef.current ?? undefined);
    flightawareDrRef.current = new FlightDeadReckoning(v, ghostProtocolRef.current ?? undefined);
    airlabsDrRef.current = new FlightDeadReckoning(v, ghostProtocolRef.current ?? undefined);
    const aisKey = apiVaultRef.current.aisStreamApiKey;
    if (aisKey) {
      aisTrackerRef.current = new AisVesselTracker(v, aisKey, ghostProtocolRef.current ?? undefined);
    }
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
        const trackTypes: Record<string, TrackEntityType> = {
          flight_tracks: 'aircraft',
          earthquakes: 'earthquake',
          india_cctv: 'cctv',
          ais_vessels: 'ship',
          space_debris: 'satellite',
        };
        entityTrackerRef.current?.track(ent, trackTypes[layer] ?? 'default');
      } else {
        setInfoEntity(null);
        entityTrackerRef.current?.untrack();
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
      if (!cart) return;
      const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(cart);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      setContextMenu({ show: true, x: click.position.x, y: click.position.y, lat, lon });

      // Fork creation prompt
      const forkName = window.prompt('🍴 Name this parallel reality:', `Fork-${Date.now()}`);
      if (!forkName) return;
      fetch('/api/fork/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: forkName,
          lat,
          lon,
          deltas: [{ type: 'INJECT_EVENT', targetId: 'manual_fork', parameters: { lat, lon }, effectiveTimeOffsetHours: 0 }],
          maxSimulationHours: 72,
        }),
      }).then(r => r.json()).then(data => {
        console.log('Fork created:', data);
      }).catch(e => console.error('Fork creation failed:', e));
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    handler.setInputAction(() => setContextMenu({show:false,x:0,y:0,lat:0,lon:0}), Cesium.ScreenSpaceEventType.LEFT_DOWN);

    setLoadingProgress(50);

    void loadAllData(v)
      .then(() => {
        syncWeatherCardPositions();
        autoRefreshIntervalRef.current = setInterval(() => {
          void refreshLiveData(v);
        }, 60000);
        // Slow-refresh groups (ocean, geology, space — data changes hourly+)
        autoRefreshSlowRef.current = setInterval(() => {
          void refreshGenericLayers(v, ['geology', 'space', 'ocean', 'argo', 'tides', 'usgs_water', 'ports']);
        }, 300000);
        // Pre-warm server cache for slow groups so first toggle is instant
        const warmGroupLayers: Record<string, string> = {
          ocean: '42_ndbc_buoy_data', argo: '31_argo_floats', tides: '31_noaa_tides_currents',
          usgs_water: '27_usgs_nawqa', ports: '1_world_port_index',
          geology: '5_usgs_mineral_deposits', space: '6_celestrak_gp_api',
        };
        Promise.all(Object.entries(warmGroupLayers).map(([, lid]) => {
          const lc = LAYER_CATEGORIES.find(l => l.id === lid);
          return lc ? fetchLayerData(lc).catch(() => {}) : Promise.resolve();
        }));
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Request geolocation once on mount for "near me" features
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => { lastKnownLocationRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude }; },
        () => {},
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
      );
    }
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInfoEntity(null);
        entityTrackerRef.current?.untrack();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
    const timer = setInterval(() => {
      if (isLayerEnabled('intel_feed')) {
        void loadSocialFeed();
      }
    }, 60000);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadFlightTracks(viewer: Cesium.Viewer) {
    if (!isLayerEnabled('flight_tracks')) return;
    flightDrRef.current?.clear();
    removeLayerEntities('flight_tracks');

    const sources = ['/flights', '/adsb-fi', '/adsb-lol'];
    for (const source of sources) {
      try {
        const data = await apiGet<{ states?: unknown[][] | null }>(source);
        if (!isLayerEnabled('flight_tracks')) return;
        if (data.states?.length) {
          flightDrRef.current?.updateFromApi(data.states);
          flightDrRef.current?.start();
          viewer.scene.requestRender();
          showNotification(`Loaded ${data.states.length} live flight tracks`, 'success');
          return;
        }
      } catch { /* try next source */ }
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

  const loadGenRef = useRef<Record<string, number>>({});

  async function loadEarthquakes(viewer: Cesium.Viewer) {
    const gen = (loadGenRef.current['earthquakes'] = (loadGenRef.current['earthquakes'] ?? 0) + 1);
    try {
      const geo = await apiGet<{ features: UsgsFeature[] }>('/earthquakes');
      if (loadGenRef.current['earthquakes'] !== gen) return;
      removeLayerEntities('earthquakes');
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
            description: sanitizeHtml(String(ev.description || '')), categories: cats, lon: c[0], lat: c[1],
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
      const oldEnts = entityStoreRef.current['space_weather'];
      if (oldEnts) oldEnts.forEach(e => viewer.entities.remove(e));
      entityStoreRef.current['space_weather'] = [];

      const rows = await apiGet<string[][]>('/space-weather/kp');
      const recent = rows.slice(-5).reverse();
      const enabled = isLayerEnabled('space_weather');
      const spaceEnts = recent.map((row, i) => {
        const kp = Number(row[1] ?? 0);
        const lat = 65 - i * 5;
        const lon = -95 + i * 30;
        if (enabled) {
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
          show: enabled,
        });
      });
      entityStoreRef.current['space_weather'] = spaceEnts;
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

    fetch('/api/data/airports?group=aviation')
      .then(r => r.json())
      .then((data: any) => { const items: any[] = data.items ?? data; if (!Array.isArray(items)) return;
        const norm = items.map(a => ({
          iata: a.iata || '',
          icao: a.icao || '',
          name: a.name,
          lat: a.lat,
          lon: a.lon,
          Size: a.magnitude ? 3 + Math.round(a.magnitude * 4) : 3,
        }));
        entityStoreRef.current['airports'] = norm.slice(0, 300).map(a => viewer.entities.add({
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshLiveData(viewer: Cesium.Viewer) {
    if (isLayerEnabled('earthquakes')) await loadEarthquakes(viewer);
    if (isLayerEnabled('wildfires') || isLayerEnabled('severe_storms') || isLayerEnabled('volcanoes')
      || isLayerEnabled('floods') || isLayerEnabled('dust') || isLayerEnabled('seaLakeIce')) {
      await loadEonetEvents(viewer);
    }
    if (isLayerEnabled('flight_tracks')) await loadFlightTracks(viewer);
    if (isLayerEnabled('2_adsb_lol')) await loadAdsbLolFlights(viewer);
    if (isLayerEnabled('2_adsb_fi')) await loadAdsbFiFlights(viewer);
    if (isLayerEnabled('2_flightaware_aeroapi')) await loadFlightawareFlights(viewer);
    if (isLayerEnabled('2_airlabs_api')) await loadAirlabsFlights(viewer);
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
    // Refresh generic layers with fast-changing data
    await refreshGenericLayers(viewer, ['seismic', 'hazards', 'weather', 'atmosphere']);
    viewer.scene.requestRender();
  }

  async function refreshGenericLayers(viewer: Cesium.Viewer, groups: string[]) {
    const groupSet = new Set(groups);
    for (const layer of LAYER_CATEGORIES) {
      if (!isLayerEnabled(layer.id)) continue;
      if (!groupSet.has(layer.group)) continue;
      if (layer.type === 'tile' || layer.type === 'effect' || layer.type === 'panel' || layer.type === '3dtiles') continue;
      // Skip layers with explicit handlers already refreshed above
      if (layer.id === 'earthquakes' || layer.id === 'wildfires' || layer.id === 'severe_storms' ||
          layer.id === 'volcanoes' || layer.id === 'floods' || layer.id === 'dust' || layer.id === 'seaLakeIce' ||
          layer.id === 'space_debris' || layer.id === 'space_weather' || layer.id === 'nasa_dsn' ||
          layer.id === 'lightning_strikes' || layer.id === 'aurora_oval' || layer.id === 'disaster_alerts') continue;
      if (layer.group === 'weather' && (layer.type as string) !== 'tile' && (layer.type as string) !== 'effect') continue;
      try {
        const items = await fetchLayerData(layer);
        if (!isLayerEnabled(layer.id)) return;
        removeLayerEntities(layer.id);
        if (items.length) {
          const ents = await renderLayer(viewer, layer, items, ghostProtocolRef.current ?? undefined);
          entityStoreRef.current[layer.id] = ents;
        }
      } catch { /* skip */ }
    }
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

  const focusLocation = useCallback((lat: number, lon: number, options?: { label?: string; color?: string; height?: number; duration?: number; }) => {
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
  }, []);

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

  function clearEntityProperties(ent: Cesium.Entity): void {
    if (!ent) return;
    const props: Array<keyof Cesium.Entity> = [
      'position', 'billboard', 'label', 'point', 'ellipse', 'cylinder',
      'polyline', 'polygon', 'box', 'corridor', 'ellipsoid', 'model',
      'path', 'rectangle', 'wall',
    ];
    for (const key of props) {
      const val = ent[key];
      if (val && typeof val === 'object' && 'setValue' in val) {
        (val as any).setValue(undefined);
      }
    }
    ent.properties = undefined;
    ent.name = undefined;
    ent.description = undefined;
  }

  function removeLayerEntities(layerId: string) {
    const v = viewerRef.current;
    const ents = entityStoreRef.current[layerId];
    if (!ents) return;
    if (v) {
      ents.forEach(ent => {
        clearEntityProperties(ent);
        v.entities.remove(ent);
        ghostProtocolRef.current?.removeGhost(ent.id);
      });
      if (layerId === 'submarine_cables' && submarineCablesDataSourceRef.current) {
        v.dataSources.remove(submarineCablesDataSourceRef.current, true);
        submarineCablesDataSourceRef.current = null;
      }
    }
    entityStoreRef.current[layerId] = [];
  }

  function enforceEntityCap(): void {
    const v = viewerRef.current;
    if (!v) return;
    const layers = Object.entries(entityStoreRef.current);
    let total = 0;
    for (const [, ents] of layers) total += ents.length;
    if (total <= MAX_ENTITIES) return;
    const sorted = [...layers].sort((a, b) => b[1].length - a[1].length);
    let removed = 0;
    for (const [id, ents] of sorted) {
      if (total - removed <= MAX_ENTITIES) break;
      if (id === 'earthquakes' || id === 'heatmap') continue;
      const next = entityStoreRef.current[id];
      if (!next || next !== ents) continue;
      removed += next.length;
      if (v) {
        next.forEach(ent => { clearEntityProperties(ent); v.entities.remove(ent); });
      }
      entityStoreRef.current[id] = [];
    }
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;

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
        [pWave, sWave, surfWave].forEach(ent => { clearEntityProperties(ent); v.entities.remove(ent); });
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
        if (!isLayerEnabled('tsunami')) return;
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
            clearEntityProperties(ring);
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
      delete notificationTimeoutsRef.current[id];
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    const ALWAYS_VISIBLE = new Set(['tectonic', 'airports', 'airspaces', 'submarine_cables', 'nasa_dsn', 'pin', 'focus']);
    for (const entity of v.entities.values) {
      const props = entity.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      if (!props?.time) continue;
      const layer = String(props.layer ?? '');
      if (ALWAYS_VISIBLE.has(layer)) continue;
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
      const props = entity.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      const layer = String(props?.layer ?? '');
      const layerState = layersRef.current.find(l => l.id === layer);
      if (layerState) {
        entity.show = layerState.on;
      } else if (entity.show !== undefined) {
        entity.show = true;
      }
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
  }, [cesiumIonToken]);

  /* ═════════════════════════════════════════════════════════════════
     WEATHER CARDS
     ═════════════════════════════════════════════════════════════════ */

  const addWeatherCard = useCallback((lat: number, lon: number) => {
    const id = `wc_${Date.now()}`;
    const card: WeatherCardData = { id, lat, lon, temp: 0, humidity: 0, windSpeed: 0, pressure: 0, precipitation: 0, desc: '' };
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
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,pressure_msl,wind_speed_10m,weather_code`, { signal: controller.signal })
      .then(r => r.json())
      .then((data: {current: {temperature_2m:number;relative_humidity_2m:number;precipitation:number;pressure_msl:number;wind_speed_10m:number;weather_code:number}}) => {
        if (controller.signal.aborted) return;
        const c = data.current;
        setWeatherCards(prev => prev.map(wc =>
          wc.id === id ? {
            ...wc,
            temp: c.temperature_2m,
            humidity: c.relative_humidity_2m,
            precipitation: c.precipitation,
            pressure: c.pressure_msl,
            windSpeed: c.wind_speed_10m,
            desc: getWeatherDesc(c.weather_code),
          } : wc
        ));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setWeatherCards(prev => prev.map(wc =>
          wc.id === id ? { ...wc, temp: 0, humidity: 0, windSpeed: 0, pressure: 0, precipitation: 0, desc: 'Unavailable' } : wc
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
      if (issLoadingRef.current) return;
      issLoadingRef.current = true;
      apiGet<{ latitude: number; longitude: number }>('/iss')
        .then((data) => {
          if (!issEntityRef.current && !issTrailRef.current) return;
          const pos = Cesium.Cartesian3.fromDegrees(data.longitude, data.latitude, 408000);
          const time = Cesium.JulianDate.now();
          trail.addSample(time, pos);
          issTimesRef.current.push(time);
          if (issTimesRef.current.length > 50) {
            const ts = issTimesRef.current.shift();
            if (ts) trail.removeSample(ts);
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
        })
        .finally(() => { issLoadingRef.current = false; });
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

  const handlePauseFork = useCallback(async (forkId: string) => {
    try {
      await fetch(`/api/fork/${forkId}/pause`, { method: 'POST', credentials: 'include' });
      forkRendererRef.current?.pauseForkVisual(forkId);
      setForks(prev => prev.map(f => f.forkId === forkId ? { ...f, status: 'paused' } : f));
    } catch (e) { console.error('Pause fork failed:', e); }
  }, []);

  const handleResumeFork = useCallback(async (forkId: string) => {
    try {
      await fetch(`/api/fork/${forkId}/resume`, { method: 'POST', credentials: 'include' });
      forkRendererRef.current?.resumeForkVisual(forkId);
      setForks(prev => prev.map(f => f.forkId === forkId ? { ...f, status: 'running' } : f));
    } catch (e) { console.error('Resume fork failed:', e); }
  }, []);

  const handleTerminateFork = useCallback(async (forkId: string) => {
    try {
      await fetch(`/api/fork/${forkId}/terminate`, { method: 'POST', credentials: 'include' });
      forkRendererRef.current?.removeForkVisual(forkId);
      setForks(prev => prev.filter(f => f.forkId !== forkId));
      setActiveForkCount(prev => Math.max(0, prev - 1));
    } catch (e) { console.error('Terminate fork failed:', e); }
  }, []);

  const renderCausalChain = useCallback((links: CausalChainLink[]) => {
    oracleChainRef.current?.renderChain(links);
  }, []);

  /* ═════════════════════════════════════════════════════════════════
     LAYER TOGGLES
     ═════════════════════════════════════════════════════════════════ */

  const toggleLayer = useCallback((layerId: string) => {
    const now = Date.now();
    const last = toggleDebounceRef.current[layerId] || 0;
    if (now - last < 300) return;
    toggleDebounceRef.current[layerId] = now;
    // Record toggle in user profile (fire-and-forget)
    fetch('/api/agent/profile/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'browser-user', layerId }) }).catch(() => {});
    // Read BEFORE setLayers — the updater runs asynchronously, not synchronously
    const wasOn = layersRef.current.find(l => l.id === layerId)?.on ?? false;
    setLayers(prev => {
      const next = prev.map(l => l.id === layerId ? { ...l, on: !l.on } : l);
      layersRef.current = next;
      return next;
    });

    // Side effects outside setLayers updater — critical for React 18+ batching safety
    if (!wasOn) {
      loadLayerData(layerId);
    } else {
      hideLayerEntities(layerId);
    }

    const layer = layersRef.current.find(l => l.id === layerId);
    if (layer?.type === 'tile') {
      setPulsingLayer(layerId);
      setTimeout(() => setPulsingLayer(null), 600);
    }

    if (['severe_storms', 'storm_forecast', 'wildfires', 'smoke_dispersion'].includes(layerId)) {
      refreshDerivedOverlays();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function loadGenericLayer(viewer: Cesium.Viewer, layerId: string) {
    const layer = LAYER_CATEGORIES.find(l => l.id === layerId);
    if (!layer) return;
    if (layer.type === 'tile' || layer.type === 'effect' || layer.type === 'panel' || layer.type === '3dtiles') return;
    if (entityStoreRef.current[layerId]?.length) {
      setLayerEntitiesVisible(layerId, true);
      return;
    }
    const gen = (layerGenRef.current[layerId] = (layerGenRef.current[layerId] || 0) + 1);
    fetchLayerData(layer).then(async (items) => {
      if (layerGenRef.current[layerId] !== gen) return;
      if (!isLayerEnabled(layerId) || !items.length) return;
      const ents = await renderLayer(viewer, layer, items, ghostProtocolRef.current ?? undefined);
      if (ents.length) {
        entityStoreRef.current[layerId] = ents;
        viewer.scene.requestRender();
        viewer.zoomTo(ents);
      }
    }).catch((e: any) => console.warn(`Failed to load generic layer ${layerId}:`, e));
  }

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
      return;
    } else if (layerId === 'disaster_near_me') {
      renderDisasterNearMeLayer();
    } else if (layerId === 'flight_tracks') {
      if (!showExisting('flight_tracks')) void loadFlightTracks(v);
      return;
    } else if (layerId === '2_adsb_lol') {
      if (!showExisting('2_adsb_lol')) void loadAdsbLolFlights(v);
      return;
    } else if (layerId === '2_adsb_fi') {
      if (!showExisting('2_adsb_fi')) void loadAdsbFiFlights(v);
      return;
    } else if (layerId === '2_flightaware_aeroapi') {
      if (!showExisting('2_flightaware_aeroapi')) void loadFlightawareFlights(v);
      return;
    } else if (layerId === '2_airlabs_api') {
      if (!showExisting('2_airlabs_api')) void loadAirlabsFlights(v);
      return;
    } else if (layerId === '2_openflights') {
      if (!showExisting('2_openflights')) void loadOpenFlights(v);
      return;
    } else if (layerId.startsWith('29_') || layerId === '29_wovodat' || layerId === '29_nasa_so2_monitoring' || layerId === '29_noaa_so2_portal') {
      const needsLoad = !showExisting(layerId);
      if (needsLoad) {
        const isSo2 = layerId.includes('so2');
        void loadVolcanicLayer(v, layerId, isSo2 ? '/volcanoes?format=location' : '/volcanoes');
      }
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
    } else if (['12_nhc_tropical_cyclone_data','12_ibtracs'].includes(layerId)) {
      if (!showExisting(layerId)) void loadWeatherStorms(v, layerId);
      return;
    } else if (layerId === '26_us_drought_monitor') {
      if (!showExisting(layerId)) void loadWeatherDrought(v, layerId);
      return;
    } else if (layerId === '64_nexrad_level_ii') {
      if (!showExisting(layerId)) void loadWeatherRadar(v, layerId);
      return;
    } else if (layerId === '57_noaa_cpc') {
      if (!showExisting(layerId)) void loadClimateIndices(v, layerId);
      return;
    } else {
      const layerDef = LAYER_DEFS.find(l => l.id === layerId);
      if (layerDef?.category === 'weather' && layerDef.type !== 'tile' && layerDef.type !== 'effect') {
        return; // Weather data available via right-click context menu only
      }
      const wmsProvider = getNasaGibsProvider(layerId) || getOceanTileWmsProvider(layerId);
      if (wmsProvider) {
        if (!overlayImageryLayersRef.current[layerId]) {
          const imgLayer = v.scene.imageryLayers.addImageryProvider(wmsProvider);
          const defOpacity = LAYER_DEFS.find(l => l.id === layerId)?.opacity ?? 1.0;
          imgLayer.alpha = layerOpacity[layerId] ?? defOpacity;
          overlayImageryLayersRef.current[layerId] = imgLayer;
          let lastWmsError = 0;
          wmsProvider.errorEvent.addEventListener((err: any) => {
            const now = Date.now();
            if (lastWmsError + 120000 < now) {
              lastWmsError = now;
              console.warn(`WMS tile layer "${layerId}" error:`, err?.message);
            }
          });
        }
      } else {
        if (layerId === 'airspaces') {
          if (!entityStoreRef.current['airspaces']?.length) {
            const gen = (layerGenRef.current['airspaces'] = (layerGenRef.current['airspaces'] || 0) + 1);
            loadAirspaces(v)
              .then(entities => {
                if (layerGenRef.current['airspaces'] !== gen) return;
                if (!isLayerEnabled('airspaces')) return;
                entityStoreRef.current['airspaces'] = entities;
                setLayerEntitiesVisible('airspaces', true);
              })
              .catch(err => {
                if (layerGenRef.current['airspaces'] === gen) showNotification('Failed to load real airspaces', 'error');
              });
          }
          return;
        } else if (layerId === 'ais_vessels') {
          const startTracker = (tracker: AisVesselTracker) => {
            tracker.setStatusHandler((msg, type) => showNotification(msg, type));
            tracker.start();
          };
          if (aisTrackerRef.current) {
            startTracker(aisTrackerRef.current);
          } else {
            const key = apiVaultRef.current.aisStreamApiKey;
            if (!key) {
              showNotification('AISStream API Key required. Add it in settings.', 'warning');
              setTimeout(() => toggleLayer('ais_vessels'), 10);
            } else {
              aisTrackerRef.current = new AisVesselTracker(v, key, ghostProtocolRef.current ?? undefined);
              startTracker(aisTrackerRef.current);
            }
          }
          return;
        } else if (entityStoreRef.current[layerId]?.length) {
          setLayerEntitiesVisible(layerId, true);
        } else {
          loadGenericLayer(v, layerId);
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
    if (layerId === 'ais_vessels') {
      aisTrackerRef.current?.stop();
      aisTrackerRef.current?.clear();
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
    if (layerId === '2_adsb_lol') {
      adsbLolDrRef.current?.clear();
    }
    if (layerId === '2_adsb_fi') {
      adsbFiDrRef.current?.clear();
    }
    if (layerId === '2_flightaware_aeroapi') {
      flightawareDrRef.current?.clear();
    }
    if (layerId === '2_airlabs_api') {
      airlabsDrRef.current?.clear();
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
    viewer.scene.requestRender();
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
            description: sanitizeHtml(String(camera.description ?? '')),
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
      const data = await apiGet<{
        items: any[];
        available: boolean;
        stale?: boolean;
        message?: string;
      }>('/space-debris');
      if (!isLayerEnabled('space_debris')) return;
      const ents = addSpaceDebrisEntities(viewer, data.items || []);
      entityStoreRef.current['space_debris'] = ents;
      viewer.scene.requestRender();
      if (!data.available) {
        showNotification(data.message || 'Space debris feed unavailable', 'warning');
      } else {
        showNotification(
          `${data.stale ? 'Showing' : 'Loaded'} ${ents.length} space debris objects`,
          data.stale ? 'warning' : 'success',
        );
      }
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

  function getApiKey(keyName: string): string {
    return flatKeysRef.current[keyName] || '';
  }

  async function loadAviationLayer(
    viewer: Cesium.Viewer,
    layerId: string,
    apiPath: string,
    drRef: { current: FlightDeadReckoning | null },
  ) {
    drRef.current?.clear();
    removeLayerEntities(layerId);
    try {
      const fetchOpts: RequestInit | undefined = layerId === '2_flightaware_aeroapi'
        ? { headers: { 'x-aeroapi-key': getApiKey('FLIGHTAWARE_AEROAPI_KEY') || '' } }
        : layerId === '2_airlabs_api'
          ? { headers: { 'x-airlabs-key': getApiKey('AIRLABS_API_KEY') || '' } }
          : undefined;
      const data = await apiGet<{ states?: unknown[][] | null }>(apiPath, fetchOpts);
      if (!isLayerEnabled(layerId)) return;
      if (!data.states?.length) throw new Error(`${layerId} returned no states`);
      drRef.current?.updateFromApi(data.states);
      drRef.current?.start();
      viewer.scene.requestRender();
      showNotification(`Loaded ${data.states.length} ${layerId.replace(/^\d+_/, '').replace(/_/g, ' ')} tracks`, 'success');
    } catch (error) {
      if (!isLayerEnabled(layerId)) return;
      recordFeedError(layerId, error);
      showNotification(`${layerId} feed unavailable`, 'warning');
    }
  }

  async function loadAirlabsFlights(viewer: Cesium.Viewer) {
    return loadAviationLayer(viewer, '2_airlabs_api', '/airlabs', airlabsDrRef);
  }

  async function loadFlightawareFlights(viewer: Cesium.Viewer) {
    return loadAviationLayer(viewer, '2_flightaware_aeroapi', '/flightaware', flightawareDrRef);
  }

  async function loadAdsbLolFlights(viewer: Cesium.Viewer) {
    return loadAviationLayer(viewer, '2_adsb_lol', '/adsb-lol', adsbLolDrRef);
  }

  async function loadAdsbFiFlights(viewer: Cesium.Viewer) {
    return loadAviationLayer(viewer, '2_adsb_fi', '/adsb-fi', adsbFiDrRef);
  }

  async function loadOpenFlights(viewer: Cesium.Viewer) {
    const existing = entityStoreRef.current['2_openflights'];
    if (existing?.length) {
      setLayerEntitiesVisible('2_openflights', true);
      return;
    }
    try {
      const data = await apiGet<any>('/openflights');
      if (!isLayerEnabled('2_openflights')) return;
      removeLayerEntities('2_openflights');
      const ents = addOpenFlightsEntities(viewer, data, '2_openflights');
      entityStoreRef.current['2_openflights'] = ents;
      viewer.scene.requestRender();
      const airports = data.airports?.length || 0;
      const routes = data.routes?.length || 0;
      showNotification(`OpenFlights: ${airports} airports, ${routes} routes`, 'success');
    } catch (err) {
      recordFeedError('openflights', err);
      showNotification('OpenFlights data unavailable', 'warning');
    }
  }

  async function loadVolcanicLayer(viewer: Cesium.Viewer, layerId: string, apiPath: string) {
    const existing = entityStoreRef.current[layerId];
    if (existing?.length) {
      setLayerEntitiesVisible(layerId, true);
      return;
    }
    try {
      const data = await apiGet<any>(apiPath);
      if (!isLayerEnabled(layerId)) return;
      removeLayerEntities(layerId);
      let ents: Cesium.Entity[];
      if (layerId.includes('so2')) {
        ents = addSo2Entities(viewer, data, layerId);
      } else {
        ents = addVaacAdvisoryEntities(viewer, data, layerId);
      }
      entityStoreRef.current[layerId] = ents;
      viewer.scene.requestRender();
      showNotification(`Loaded ${ents.length} ${layerId.replace(/^\d+_/, '').replace(/_/g, ' ')} points`, 'success');
    } catch (err) {
      recordFeedError(layerId, err);
      showNotification(`${layerId} data unavailable`, 'warning');
    }
  }

  async function loadWeatherStorms(viewer: Cesium.Viewer, layerId: string) {
    const existing = entityStoreRef.current[layerId];
    if (existing?.length) { setLayerEntitiesVisible(layerId, true); return; }
    try {
      removeLayerEntities(layerId);
      const apiMap: Record<string, string> = {
        '12_nhc_tropical_cyclone_data': '/weather/nhc',
        '12_ibtracs': '/weather/ibtracs',
      };
      const path = apiMap[layerId] || '/weather/nhc';
      const data = await apiGet<any>(path);
      if (!isLayerEnabled(layerId)) return;
      const items = data.storms || data.cyclones || data.activeStorms || [];
      const ents = addStormTrackEntities(viewer, items, layerId);
      entityStoreRef.current[layerId] = ents;
      viewer.scene.requestRender();
      showNotification(`Loaded ${ents.length} storm track features`, 'success');
    } catch (err) {
      recordFeedError(layerId, err);
    }
  }

  async function loadWeatherDrought(viewer: Cesium.Viewer, layerId: string) {
    const existing = entityStoreRef.current[layerId];
    if (existing?.length) { setLayerEntitiesVisible(layerId, true); return; }
    try {
      removeLayerEntities(layerId);
      const data = await apiGet<any>('/weather/drought');
      if (!isLayerEnabled(layerId)) return;
      const ents = addDroughtZoneEntities(viewer, data, layerId);
      entityStoreRef.current[layerId] = ents;
      viewer.scene.requestRender();
      showNotification(`Loaded drought monitor zones`, 'success');
    } catch (err) {
      recordFeedError(layerId, err);
    }
  }

  async function loadWeatherRadar(viewer: Cesium.Viewer, layerId: string) {
    const existing = entityStoreRef.current[layerId];
    if (existing?.length) { setLayerEntitiesVisible(layerId, true); return; }
    try {
      removeLayerEntities(layerId);
      const data = await apiGet<any[]>('/weather/radar');
      if (!isLayerEnabled(layerId)) return;
      const ents = addRadarSiteEntities(viewer, data, layerId);
      entityStoreRef.current[layerId] = ents;
      viewer.scene.requestRender();
      showNotification(`Loaded ${ents.length} radar sites`, 'success');
    } catch (err) {
      recordFeedError(layerId, err);
    }
  }

  async function loadClimateIndices(viewer: Cesium.Viewer, layerId: string) {
    const existing = entityStoreRef.current[layerId];
    if (existing?.length) { setLayerEntitiesVisible(layerId, true); return; }
    try {
      removeLayerEntities(layerId);
      const data = await apiGet<any>('/weather/climate-indices');
      if (!isLayerEnabled(layerId)) return;
      const ents = addClimateIndicesEntities(viewer, data, layerId);
      entityStoreRef.current[layerId] = ents;
      viewer.scene.requestRender();
      showNotification(`Loaded climate indices`, 'success');
    } catch (err) {
      recordFeedError(layerId, err);
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
        name: 'Seismic Heatmap',
        ellipse: {
          semiMinorAxis: r, semiMajorAxis: r,
          material: Cesium.Color.fromCssColorString(getHeatmapColor(pt.count / maxC)).withAlpha(alpha),
          outline: false, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        properties: {
          layer: 'heatmap',
          title: 'Seismic Heatmap',
          lat: pt.lat,
          lon: pt.lon,
          count: pt.count,
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
      nasa_gibs: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
      night_lights: 'VIIRS_Black_Marble',
      land_cover: 'MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual',
      aerosol_index: 'OMPS_Aerosol_Index',
      so2_index: 'OMPS_SO2_Total_Column_Lower_Troposphere',
      co_index: 'MOPITT_CO_Daily_Total_Column_Day',
      dust_score: 'MODIS_Terra_Aerosol',
      flood_extent: 'MODIS_Combined_Flood_1-Day',
      // Weather imagery layers via GIBS
      '12_nhc_tropical_cyclone_data': 'GOES-East_ABI_Band13_Clean_IR',
      '12_ibtracs': 'MODIS_Terra_Sea_Ice',
      '26_us_drought_monitor': 'SMAP_Soil_Moisture',
      '57_noaa_cpc': 'MERRA2_Surface_Air_Temperature_Monthly',
      '64_nexrad_level_ii': 'GOES-East_ABI_Band14_IR',
      // Section 3 — Satellite Imagery & Earth Observation (each a unique GIBS product)
      '3_planetary_computer_stac': 'MODIS_Terra_CorrectedReflectance_TrueColor',
      '3_aws_earth_search': 'MODIS_Aqua_CorrectedReflectance_TrueColor',
      '3_copernicus_data_space': 'MODIS_Terra_CorrectedReflectance_Bands721',
      '3_usgs_earthexplorer': 'MODIS_Terra_SurfaceReflectance_Bands143',
      '3_usgs_appeears': 'MODIS_Terra_Land_Surface_Temp_Day',
      '3_veda_dashboard': 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
      '3_jaxa_g_portal': 'MODIS_Terra_AOD_Deep_Blue_Combined',
      '3_jaxa_himawari_monitor': 'MODIS_Terra_Cloud_Top_Height_Day',
      '3_noaa_goes_r_series': 'MODIS_Terra_Brightness_Temp_Band31_Day',
      '3_landsat_look': 'MODIS_Terra_SurfaceReflectance_Bands721',
      '3_planet_labs_open_data': 'MODIS_Terra_Cloud_Effective_Radius',
      '3_openaerialmap': 'MODIS_Terra_Cloud_Fraction_Day',
      '3_bhuvan_isro': 'MODIS_Terra_Cloud_Optical_Thickness',
      '3_air_centre_eo_catalog': 'AIRS_L2_Dust_Score_Day',
      '3_aster_gdem': 'ASTER_GDEM_Color_Index',
      '3_srtm': 'MODIS_Terra_CorrectedReflectance_Bands367',
      '3_gebco': 'GHRSST_L4_MUR_Sea_Surface_Temperature',
      '3_modis_web_services': 'MODIS_Terra_Water_Vapor_5km_Day',
      '3_viirs_active_fires': 'MODIS_Terra_Thermal_Anomalies_All',
      '3_global_surface_water_explorer': 'MODIS_Combined_Flood_1-Day',
      // Section 70 — InSAR & Ground Deformation
      '70_comet': 'VIIRS_SNPP_Thermal_Anomalies_375m_All',
      '70_comet_licsar': 'MODIS_Terra_Cloud_Phase_Infrared_Day',
      '70_licsar': 'MODIS_Terra_L3_Sea_Ice_Daily',
      '70_asf_sar_data': 'AIRS_L2_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Day',
      '70_unavco_sar': 'MODIS_Terra_NDSI_Snow_Cover',
      '70_squeesar': 'VIIRS_SNPP_L2_Sea_Surface_Temp_Day',
      '70_mintpy': 'MODIS_Terra_EVI_8Day',
      // Ocean tile WMS replacements (original servers dead/unavailable)
      '50_emodnet_chemistry': 'VIIRS_SNPP_L2_Chlorophyll_A',
      '50_globcolour': 'MODIS_Aqua_L2_Chlorophyll_A',

    };
    
    const wmsLayer = layerMap[layerId];
    if (!wmsLayer) return null;

    const params: Record<string, string> = { TRANSPARENT: 'true', FORMAT: 'image/png' };
    const time = getLatestGibsTime(wmsLayer);
    if (time) params.TIME = time;

    return new Cesium.WebMapServiceImageryProvider({
      url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
      layers: wmsLayer,
      parameters: params,
      enablePickFeatures: false
    });
  }

  const gibsTimeCache = new Map<string, string | null>();

  function getLatestGibsTime(layer: string): string | null {
    if (layer === 'VIIRS_Black_Marble') return null;
    const cached = gibsTimeCache.get(layer);
    if (cached !== undefined) return cached;
    fetchLatestGibsTime(layer);
    return null;
  }

  async function fetchLatestGibsTime(layer: string) {
    try {
      const resp = await fetch('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities', { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return;
      const xml = await resp.text();
      const layerMatch = xml.match(new RegExp(`<Layer[^>]*>[\\s\\S]*?<Name>${escapeRegex(layer)}</Name>([\\s\\S]*?)</Layer>`));
      if (!layerMatch) return;
      const timeDim = layerMatch[1].match(/<Dimension[^>]*name="time"[^>]*>([\s\S]*?)<\/Dimension>/);
      if (!timeDim) return;
      const ranges = timeDim[1].trim().split(',');
      let latest = '';
      for (const range of ranges) {
        const parts = range.trim().split('/');
        if (parts.length >= 2) {
          const end = parts[1].trim();
          if (end > latest) latest = end;
        }
      }
      if (latest) gibsTimeCache.set(layer, latest);
    } catch { /* ignore */ }
  }

  function escapeRegex(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getOceanTileWmsProvider(layerId: string) {
    type WmsCfg = { url: string; layers: string; format?: string };
    const oceanWms: Record<string, WmsCfg> = {
      '50_gebco': { url: 'https://wms.gebco.net/mapserv?', layers: 'GEBCO_LATEST_2' },
      '50_emodnet_bathymetry': { url: 'https://ows.emodnet-bathymetry.eu/ows', layers: 'emodnet:mean' },

    };
    const cfg = oceanWms[layerId];
    if (!cfg) return null;
    return new Cesium.WebMapServiceImageryProvider({
      url: cfg.url,
      layers: cfg.layers,
      parameters: { transparent: 'true', format: cfg.format || 'image/png' },
      enablePickFeatures: false,
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
        v.entities.suspendEvents();
      }
      try {
        layersRef.current.forEach(l => { hideLayerEntities(l.id); });
      } finally {
        if (v) {
          v.entities.resumeEvents();
        }
      }

      flightDrRef.current?.clear();
      aisTrackerRef.current?.clear();

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const enableDefaultLayers = useCallback(() => {
    const prevLayers = layersRef.current;
    const next = prevLayers.map(l => ({ ...l, on: l.default }));
    layersRef.current = next;
    setLayers(next);
    setShowPopulationImpact(false);
    setShowStormLegend(false);
    setShowSmokeLegend(false);
    setShowTsunamiLegend(false);
    setShowHeatmapLegend(false);
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ═════════════════════════════════════════════════════════════════
     AI CHAT
     ═════════════════════════════════════════════════════════════════ */

  const handleFileUpload = useCallback(async (file: File) => {
    let workspaceId = sandboxWorkspaceId;
    if (!workspaceId) {
      try {
        const resp = await fetch('/api/sandbox/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'browser-user' }),
        });
        if (resp.ok) {
          const ws = await resp.json();
          workspaceId = ws.id;
          setSandboxWorkspaceId(workspaceId);
        } else {
          setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `❌ Sandbox workspace creation failed (${resp.status})`, type: 'error' }]);
          return;
        }
      } catch (e) {
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `❌ Sandbox workspace error: ${e}`, type: 'error' }]);
        return;
      }
    }

    if (!workspaceId) return;

    const content = await file.text();
    const resp = await fetch(`/api/sandbox/workspace/${workspaceId}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, content }),
    });
    if (resp.ok) {
      setUploadedFiles(prev => [...prev, file.name]);
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `📎 Uploaded **${file.name}** to sandbox workspace. You can now ask me to analyze it.`, type: 'upload' }]);
    } else {
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `❌ File upload failed (${resp.status})`, type: 'error' }]);
    }
  }, [sandboxWorkspaceId]);

  // Phase 2.1: Vision — analyze image via Gemini Vision API
  const handleImageUpload = useCallback(async (file: File) => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
    if (!validTypes.includes(file.type)) {
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `❌ Unsupported image type: ${file.type}. Supported: JPEG, PNG, WebP, GIF, BMP.`, type: 'error' }]);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: '❌ Image too large. Max 10MB.', type: 'error' }]);
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      const imageId = nextImageIdRef.current++;
      setChatImages(prev => [...prev, { id: imageId, dataUrl, mimeType: file.type, fileName: file.name }]);
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'user', content: `📷 [Image: ${file.name}]`, type: 'image' }]);
      setAiTyping(true);

      try {
        const resp = await fetch('/api/agent/analyze-vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64, mimeType: file.type, prompt: 'Analyze this image in detail. If it is a satellite image, map, chart, or geographic area, describe what you see including any notable features, patterns, colors, text, or structures.' }),
        });
        if (resp.ok) {
          const data = await resp.json();
          setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `**🔍 Image Analysis**\n\n${data.analysis || 'No analysis returned.'}`, type: 'vision' }]);
        } else {
          setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `❌ Vision analysis failed (${resp.status})`, type: 'error' }]);
        }
      } catch (e) {
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `❌ Vision analysis error: ${e}`, type: 'error' }]);
      }
      setAiTyping(false);
    };
    reader.readAsDataURL(file);
  }, []);

  // Phase 2.2: Voice — speech recognition
  // Phase 3: Connect to proactive events via WebSocket
  useEffect(() => {
    const unsubMonitor = ws.onMessage('message', (msg) => {
      if (msg.event === 'monitor_trigger') {
        const data = (msg.data || msg) as any;
        const r = (data.rule || data) as any;
        setAiMessages(prev => [...prev, {
          id: nextAiMsgIdRef.current++,
          role: 'assistant',
          content: `🔔 **Monitor Alert: ${r.label}**\n\nTriggered ${r.count}x — condition met on \`${r.id}\`.\n*Check the globe for current data.*`,
          type: 'monitor'
        }]);
      }

      if (msg.event === 'scheduled_report') {
        const data = (msg.data || msg) as any;
        const t = (data.task || data) as any;
        setAiMessages(prev => [...prev, {
          id: nextAiMsgIdRef.current++,
          role: 'assistant',
          content: `📋 **Scheduled Report: ${t.label}**\n\n${t.result || 'No results.'}`,
          type: 'pipeline'
        }]);
      }

      if (msg.event === 'ambient_event') {
        const data = (msg.data || msg) as any;
        const ev = (data.event || data) as any;
        const severityColors: Record<string, string> = { critical: '#ef4444', warning: '#f97316', info: '#22c55e' };
        setAiMessages(prev => [...prev, {
          id: nextAiMsgIdRef.current++,
          role: 'assistant',
          content: `**${ev.type === 'major_earthquake' ? '🌋' : ev.type === 'storm_formation' ? '🌀' : ev.type === 'fire_outbreak' ? '🔥' : '🌍'} ${ev.title}**\n\n${ev.description}`,
          type: 'ambient'
        }]);
        const color = severityColors[ev.severity] || '#f97316';
        setAlerts(prev => {
          const exists = prev.some(a => a.title === ev.title);
          if (exists) return prev;
          const alert: EventAlert = {
            id: ev.id,
            title: ev.title,
            desc: ev.description || ev.title,
            type: ev.type,
            lat: ev.lat,
            lon: ev.lon,
            severity: ev.severity,
            time: new Date(ev.timestamp).toLocaleTimeString(),
            timestamp: ev.timestamp,
            seen: false,
            hasMapPosition: true,
          };
          return [alert, ...prev].slice(0, 50);
        });
        setNewAlertCount(prev => prev + 1);
      }

      // Phase 2: Reflex engine events
      if (msg.event === 'REFLEX_DILATE') {
        const data = (msg.data || msg) as any;
        const { lat, lon, region, reflexId } = data;
        setAiMessages(prev => [...prev, {
          id: nextAiMsgIdRef.current++,
          role: 'assistant',
          content: `👁️ **Reflex Dilate: ${region || 'unknown region'}**\n\nReflex \`${reflexId || 'unknown'}\` triggered camera dilation to [${lat?.toFixed(2)}, ${lon?.toFixed(2)}].`,
          type: 'reflex',
        }]);
        if (lat != null && lon != null && viewerRef.current) {
          cinematicFlyTo(viewerRef.current, lon, lat, 500000, 3);
        }
      }

      if (msg.event === 'REFLEX_ALERT') {
        const data = (msg.data || msg) as any;
        const { title, description, severity, reflexId, lat, lon } = data;
        console.warn(`[REFLEX_ALERT] ${title}: ${description}`);
        setAiMessages(prev => [...prev, {
          id: nextAiMsgIdRef.current++,
          role: 'assistant',
          content: `🚨 **Reflex Alert: ${title || 'Unspecified'}**\n\n${description || ''}`,
          type: 'reflex',
        }]);
        setNewAlertCount(prev => prev + 1);
        if (reflexId) {
          setReflexStates(prev => prev.map(r =>
            r.reflexId === reflexId ? { ...r, status: 'ACTIVE' } : r
          ));
          setTimeout(() => {
            setReflexStates(prev => prev.map(r =>
              r.reflexId === reflexId ? { ...r, status: 'IDLE' } : r
            ));
          }, 5000);
        }
      }

      if (msg.event === 'SYSTEM_TRAUMA') {
        const data = (msg.data || msg) as any;
        const active = data.active === true || data.active === 'true';
        if (active) {
          console.error('[SYSTEM_TRAUMA] Trauma mode ACTIVE — multiple reflexes firing simultaneously');
        } else {
          console.log('[SYSTEM_TRAUMA] Trauma mode ended');
        }
      }

      // Phase 3: Fork stream events
      const forkMsg: any = msg.type === 'FORK_STREAM' ? (msg.data || msg) : msg;
      if (forkMsg.type === 'FORK_INIT') {
        const payload: any = forkMsg.payload || forkMsg;
        const forkId: string = payload.forkId || forkMsg.forkId;
        const name: string = payload.name || forkMsg.name || 'Unnamed Fork';
        const request: any = payload.request || payload;
        forkRendererRef.current?.createForkVisual(forkId, name, request?.lat || 0, request?.lon || 0);
        setForks(prev => [...prev, { forkId, name, divergenceScore: 0, status: 'running' }]);
        setActiveForkCount(prev => prev + 1);
      }
      if (forkMsg.type === 'FORK_TICK') {
        const payload: any = forkMsg.payload || forkMsg;
        const forkId: string = payload.forkId || forkMsg.forkId;
        forkRendererRef.current?.updateDivergence(forkId, payload.divergenceScore || 0, payload.simulatedTimeMs || 0);
        setForks(prev => prev.map((f: any) => f.forkId === forkId ? { ...f, divergenceScore: payload.divergenceScore || f.divergenceScore, status: 'running' } : f));
      }
      if (forkMsg.type === 'FORK_TERMINATED') {
        const payload: any = forkMsg.payload || forkMsg;
        const forkId: string = payload.forkId || forkMsg.forkId;
        forkRendererRef.current?.removeForkVisual(forkId);
        setForks(prev => prev.filter((f: any) => f.forkId !== forkId));
        setActiveForkCount(prev => Math.max(0, prev - 1));
      }

      // Phase 4: Entropy and discovery events
      if (msg.type === 'ENTROPY_UPDATE' || msg.event === 'ENTROPY_UPDATE') {
        const data: any = msg.data || msg;
        entropyHaloRef.current?.setEntropy(data.planetaryEntropy || 0);
        console.log(`🌍 Planetary Entropy: ${(data.planetaryEntropy * 100).toFixed(1)}% — ${entropyHaloRef.current?.getInterpretation()?.toUpperCase()}`);
      }
      if (msg.type === 'DISCOVERY' || msg.event === 'DISCOVERY') {
        const data: any = msg.data || msg;
        const disc = data.discovery || data;
        if (disc?.summary) {
          setRecentDiscoveries(prev => [{ summary: disc.summary, confidence: disc.edge?.confidence || 0.5 }, ...prev].slice(0, 5));
          setAiMessages(prev => [...prev, {
            id: nextAiMsgIdRef.current++,
            role: 'assistant',
            content: `🧠 **Causal Discovery**\n\n${disc.summary}`,
            type: 'discovery',
          }]);
        }
      }

      // Phase 5: Dream cycle events
      if (msg.type === 'DREAM_COMPLETE' || msg.event === 'DREAM_COMPLETE') {
        const data: any = msg.data || msg;
        setLastDream({
          scenariosRun: data.scenariosRun || 0,
          modelUpdates: data.modelUpdates || 0,
          newCausalEdges: data.newCausalEdges || 0,
          timestamp: Date.now(),
        });
        console.log(`🌙 DREAM COMPLETE: ${data.scenariosRun} scenarios, ${data.modelUpdates} model updates, ${data.newCausalEdges} new causal edges`);
        setAiMessages(prev => [...prev, {
          id: nextAiMsgIdRef.current++,
          role: 'assistant',
          content: `🌙 **Dream Cycle Complete**\n\nThe system dreamed ${data.scenariosRun} synthetic catastrophes while you slept.\n• ${data.modelUpdates} prediction models retrained\n• ${data.newCausalEdges} new causal edges discovered\n\n*The planet learns even when you do not.*`,
          type: 'dream',
        }]);
      }
    });

    ws.subscribe('fork:all');

    ws.subscribe('proactive');
    ws.subscribe('reflex');

    return () => {
      unsubMonitor();
      ws.unsubscribe('proactive');
      ws.unsubscribe('reflex');
      ws.unsubscribe('fork:all');
    };
  }, [ws]);

  // Phase 3: Send monitor command via chat
  const sendMonitorCommand = useCallback(async (text: string) => {
    // Parse: "monitor for M6+ earthquakes near Japan"
    const monitorMatch = text.match(/monitor\s+(?:for\s+)?(.+?)(?:\s+near\s+(.+))?$/i);
    if (monitorMatch) {
      const conditionText = monitorMatch[1].toLowerCase();
      const locationText = monitorMatch[2];

      let layerId = 'earthquakes';
      let field = 'mag';
      let operator = '>';
      let value = 6;

      if (conditionText.includes('earthquake') || conditionText.includes('seismic') || conditionText.includes('quake')) {
        const magMatch = conditionText.match(/m\s*(\d+\.?\d*)/);
        if (magMatch) value = parseFloat(magMatch[1]);
        if (conditionText.includes('>=')) operator = '>=';
        else if (conditionText.includes('<=')) operator = '<=';
        else if (conditionText.includes('<')) operator = '<';
        layerId = 'earthquakes';
      } else if (conditionText.includes('storm') || conditionText.includes('hurricane') || conditionText.includes('cyclone')) {
        layerId = 'severe_storms';
        field = 'maxWind';
        const windMatch = conditionText.match(/(\d+)\s*knots?/);
        if (windMatch) value = parseFloat(windMatch[1]);
      } else if (conditionText.includes('fire') || conditionText.includes('wildfire')) {
        layerId = 'wildfires';
        field = 'frp';
        const frpMatch = conditionText.match(/(\d+)\s*frp/);
        if (frpMatch) value = parseFloat(frpMatch[1]);
      }

      let location;
      if (locationText) {
        const l = await extractLocation(locationText);
        if (l) location = { lat: l.lat, lon: l.lon, radiusKm: 500 };
      }

      const resp = await fetch('/api/agent/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layerId, condition: { field, operator, value }, location, label: `Monitor: ${conditionText}`, userId: 'browser-user', intervalMs: 300000 }),
      });
      if (resp.ok) {
        const rule = await resp.json();
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `✅ **Monitor Created**\n\nID: \`${rule.id}\`\nLayer: ${rule.layerId}\nCondition: ${rule.condition.field} ${rule.condition.operator} ${rule.condition.value}\nInterval: every ${rule.intervalMs / 60000} min\n\n*You'll be alerted when conditions are met.*`, type: 'monitor' }]);
        return true;
      }
    }
    return false;
  }, []);

  // Phase 3: Send schedule command via chat
  const sendScheduleCommand = useCallback(async (text: string) => {
    const scheduleMatch = text.match(/schedule\s+(.+?)(?:\s+every\s+(\d+)\s*(minute|hour|day)s?)?$/i);
    if (scheduleMatch) {
      const goal = scheduleMatch[1];
      const num = scheduleMatch[2] ? parseInt(scheduleMatch[2]) : 1;
      const unit = scheduleMatch[3] || 'day';
      const intervalMs = unit.startsWith('min') ? num * 60000 : unit.startsWith('hour') ? num * 3600000 : num * 86400000;

      const resp = await fetch('/api/agent/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: `Scheduled: ${goal.slice(0, 40)}`, goal, userId: 'browser-user', intervalMs }),
      });
      if (resp.ok) {
        const task = await resp.json();
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `✅ **Schedule Created**\n\nID: \`${task.id}\`\nGoal: ${goal}\nEvery: ${num} ${unit}${num > 1 ? 's' : ''}\n\n*Reports will appear here automatically.*`, type: 'monitor' }]);
        return true;
      }
    }
    return false;
  }, []);

  // Phase 3: Get location context
  const getLocationContextData = useCallback(async (lat: number, lon: number) => {
    try {
      const resp = await fetch(`/api/agent/context?lat=${lat}&lon=${lon}`);
      if (resp.ok) {
        const ctx = await resp.json();
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `📍 **Location Context: ${ctx.location.label}**\n\n🌋 **Seismic**: ${ctx.earthquakeRisk}\n🌤️ **Weather**: ${ctx.weather}\n${ctx.nearbyEvents?.length > 0 ? `📋 **Nearby Events**:\n${ctx.nearbyEvents.slice(0, 3).map((e: { title: string; category: string }) => `- ${e.title} (${e.category})`).join('\n')}` : ''}\n\n*Data from live APIs*`, type: 'context' }]);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    const SpeechRecognitionAPI = (window as unknown as Record<string, unknown>).SpeechRecognition as (new () => SpeechRecognition) | undefined
      || (window as unknown as Record<string, unknown>).webkitSpeechRecognition as (new () => SpeechRecognition) | undefined;
    if (SpeechRecognitionAPI) {
      setVoiceSupported(true);
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = Array.from(event.results)
          .map(r => r[0].transcript)
          .join('');
        setAiInput(transcript);
        if (event.results[event.results.length - 1].isFinal) {
          recognition.stop();
          setIsListening(false);
          // Auto-send after a short delay
          setTimeout(() => {
            setAiInput(''); // Clear so sendAI uses the already-set value
            // We need to trigger sendAI with the final transcript
            const finalText = transcript;
            if (finalText.trim()) {
              // Simulate the sendAI flow by setting a temporary ref
              setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'user', content: finalText }]);
              // The actual send will happen via the synthetic event
            }
          }, 300);
        }
      };
      recognition.onerror = () => { setIsListening(false); };
      recognition.onend = () => { setIsListening(false); };
      recognitionRef.current = recognition;
    }
  }, []);

  const toggleVoiceInput = useCallback(() => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setAiInput('');
      recognitionRef.current.start();
      setIsListening(true);
    }
  }, [isListening]);

  // Phase 2.2: Voice — speech synthesis (text-to-speech)
  const speakResponse = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/\*\*|`|#/g, '').slice(0, 500));
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
  }, []);

  // Phase 2.3: Data file analysis
  const handleDataFileUpload = useCallback(async (file: File) => {
    const content = await file.text();
    setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'user', content: `📊 [Data file: ${file.name}]`, type: 'data' }]);
    setAiTyping(true);
    try {
      const resp = await fetch('/api/agent/analyze-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, fileName: file.name }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setDataAnalysisResult(data);
        let msg = `**📊 Data Analysis: ${file.name}**\n\n`;
        if (data.type === 'csv') {
          msg += `Rows: **${data.rows}** | Columns: **${(data.columns || []).length}**\n\n**Columns:**\n`;
          msg += (data.columns || []).map((c: { name: string; type: string; min?: number; max?: number; mean?: number; uniqueValues?: number }) =>
            `- **${c.name}** (${c.type})${c.min !== undefined ? ` [${c.min?.toFixed(2)} – ${c.max?.toFixed(2)}, μ=${c.mean?.toFixed(2)}]` : ''}${c.uniqueValues !== undefined ? ` (${c.uniqueValues} unique)` : ''}`
          ).join('\n');
          if (data.detectedLocation) {
            msg += `\n\n📍 **Location data detected!** Lat: \`${data.detectedLocation.latColumn}\`, Lon: \`${data.detectedLocation.lonColumn}\`\n`;
            msg += `Try: *"Plot these points on the globe"* or *"Analyze this data"*`;
          }
          msg += `\n\n\`\`\`\n${data.preview?.slice(0, 5).map((r: Record<string, string>) => JSON.stringify(r)).join('\n')}\n\`\`\``;
        } else if (data.type === 'geojson') {
          msg += `Features: **${data.features}** | Types: **${(data.geometryTypes || []).join(', ')}**\n`;
          if (data.properties?.length) msg += `Properties: \`${data.properties.join(', ')}\`\n`;
          msg += `\nTry: *"Show this on the globe"* or *"Analyze spatial patterns"*`;
        } else {
          msg += data.message || 'Unknown file format.';
        }
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: msg, type: 'data-analysis' }]);
      } else {
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `❌ Data analysis failed (${resp.status})`, type: 'error' }]);
      }
    } catch (e) {
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `❌ Data analysis error: ${e}`, type: 'error' }]);
    }
    setAiTyping(false);
  }, []);

  const sendToPipeline = useCallback(async (goal: string, wsId: string | null) => {
    const resp = await fetch('/api/agent/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal, workspaceId: wsId }),
    });
    if (!resp.ok) throw new Error(`Pipeline failed (${resp.status})`);

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let currentWsId = wsId;
    const stepOutputs: string[] = [];

    const processLines = () => {
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('event: ')) continue;
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));

          if (data.workspaceId) {
            currentWsId = data.workspaceId;
            setSandboxWorkspaceId(data.workspaceId);
          }

          if (data.subtasks) {
            setPipelineProgress(data.subtasks.map((s: { id: string; description: string }) => ({ id: s.id, description: s.description, status: 'pending' })));
          }

          if (data.subtask) {
            setPipelineProgress(prev => prev.map(p =>
              p.id === data.subtask.id ? { ...p, status: data.subtask.status } : p
            ));
            if (data.subtask.status === 'running') {
              setAgentSteps(prev => [...prev.slice(-5), {type:'subtask',text:`🔄 ${data.subtask.description}`,subtask:data.subtask.description,status:'running'}]);
            }
            if (data.subtask.status === 'completed' && data.subtask.result) {
              stepOutputs.push(`## ${data.subtask.description}\n\`\`\`\n${data.subtask.result.slice(0, 500)}\n\`\`\``);
              setAgentSteps(prev => [...prev.slice(-5), {type:'subtask',text:`✅ ${data.subtask.description} (${data.subtask.executionTimeMs || 0}ms)`,subtask:data.subtask.description,status:'completed',timeMs:data.subtask.executionTimeMs,output:data.subtask.result}]);
            }
            if (data.subtask.status === 'failed') {
              setAgentSteps(prev => [...prev.slice(-5), {type:'subtask',text:`❌ ${data.subtask.description}: ${data.subtask.error || 'Failed'}`,subtask:data.subtask.description,status:'failed',output:data.subtask.error}]);
            }
          }

          if (data.done) {
            if (data.workspaceId) setSandboxWorkspaceId(data.workspaceId);
            const summary = stepOutputs.join('\n\n');
            if (summary) {
              setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: summary, type: 'pipeline' }]);
              stepOutputs.length = 0; // prevent fallback duplicate
            }
          }
        } catch { /* ignore */ }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      processLines();
    }
    processLines();
    // If data.done wasn't caught in the SSE stream (e.g. event type vs data mismatch),
    // ensure the result is still shown
    if (stepOutputs.length > 0) {
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: stepOutputs.join('\n\n'), type: 'pipeline' }]);
    }
    setPipelineProgress([]);
  }, []);

  function newChat() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setAiMessages([{ id: nextAiMsgIdRef.current++, role: 'assistant', content: '👋 Welcome to Earth Intelligence AI. Ask me about earthquakes, weather, flights, or any location on Earth.' }]);
    setAiTyping(false);
    setAiInput('');
    setAgentSteps([]);
    setPipelineProgress([]);
    setChatImages([]);
    setShowChatHistory(false);
    currentChatIdRef.current = null;
    agentInteractionIdRef.current = null;
  }

  async function loadChat(id: string) {
    if (currentChatIdRef.current) {
      await saveChat({
        id: currentChatIdRef.current,
        title: autoTitle(aiMessages),
        messages: aiMessages,
        environmentId: agentEnvironmentId || undefined,
        workspaceId: sandboxWorkspaceId || undefined,
      });
    }
    const session = await getChat(id);
    if (!session) return;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setAiTyping(false);
    setAgentSteps([]);
    setPipelineProgress([]);
    setChatImages([]);
    setAiMessages(session.messages.map(m => ({ ...m, id: m.id || nextAiMsgIdRef.current++ })));
    if (session.environmentId) setAgentEnvironmentId(session.environmentId);
    if (session.workspaceId) setSandboxWorkspaceId(session.workspaceId);
    currentChatIdRef.current = session.id;
    setShowChatHistory(false);
  }

  async function deleteChatSession(id: string) {
    await deleteChat(id);
    if (currentChatIdRef.current === id) {
      currentChatIdRef.current = null;
    }
    setChatList(prev => prev.filter(c => c.id !== id));
  }

  const sendAI = useCallback(async () => {
    if (!aiInput.trim()) return;
    const userMsg = aiInput.trim();
    setAiInput('');
    setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'user', content: userMsg }]);
    setAiTyping(true);
    setAgentSteps([]);
    setPipelineProgress([]);

    const loc = await extractLocation(userMsg);

    // Only intercept PURE location commands (e.g. just "fly to Tokyo") — nothing else
    const isPureFlyCommand = /^(?:fly|go|zoom)\s+(?:to|in|into)\s+/i.test(userMsg.trim());
    if (isPureFlyCommand && loc) {
      focusLocation(loc.lat, loc.lon, { label: 'Requested location', color: '#60a5fa', height: 150 });
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `📍 Flying to ${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}` }]);
      setAiTyping(false);
      return;
    }

    // Phase 3: Monitor/schedule commands — handled instantly, no agent needed
    if (/^monitor\s+/i.test(userMsg)) {
      const handled = await sendMonitorCommand(userMsg);
      if (handled) { setAiTyping(false); return; }
    }
    if (/^schedule\s+/i.test(userMsg)) {
      const handled = await sendScheduleCommand(userMsg);
      if (handled) { setAiTyping(false); return; }
    }

    const isComputeTask = /compute|calculate|analyze|statistics|average|distribution|correlation|regression|simulate|cluster|predict|forecast|run script|execute|csv|data|pipeline|magnitude|histogram|seismic|m[0-9]|percentage|above/i.test(userMsg);

    if (isComputeTask) {
      try {
        setAgentSteps(prev => [...prev, {type:'planning',text:'🧠 Planning computation pipeline...',status:'running'}]);
        setExpandedStep(-1);
        const wsId = sandboxWorkspaceId || null;
        await sendToPipeline(userMsg, wsId);
        setAiTyping(false);
        return;
      } catch (e) {
        setAgentSteps(prev => [...prev, {type:'error',text:`⚠️ Pipeline: ${e}`}]);
      }
    }

    // Direct command: show planes/flights/aircraft near a location
    const lower = userMsg.toLowerCase();
    const wantsFlights = lower.includes('plane') || lower.includes('flight') || lower.includes('aircraft') || lower.includes('adsb') || lower.includes('fly');
    if (wantsFlights && loc) {
      const layerId = '2_adsb_lol';
      if (!isLayerEnabled(layerId)) toggleLayer(layerId);
      focusLocation(loc.lat, loc.lon, { label: 'Live Aircraft', color: '#60a5fa', height: 50000 });
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `✈️ **Loading live aircraft near ${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}**\n\nThe ADSB flight tracking layer has been enabled. Aircraft within the visible area will appear on the globe in real-time.` }]);
      setAiTyping(false);
      return;
    }

    setAgentSteps(prev => [...prev, {type:'reasoning',text:'🧠 Analyzing your request...',status:'running'}]);
    setExpandedStep(-1);

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    try {
      const resp = await fetch('/api/agent/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          userId: 'browser-user',
          environmentId: agentEnvironmentId,
          interactionId: agentInteractionIdRef.current,
        }),
        signal: abortController.signal,
      });

      if (!resp.ok) {
        throw new Error(`Agent request failed (${resp.status})`);
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';
      let lastInteractionId: string | null = null;
      let lastEnvironmentId: string | null = null;
      let lastTraceId: string | null = null;

      const processLines = () => {
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('event: ')) continue;
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'connected' && data.requestId) {
              currentRequestIdRef.current = data.requestId;
            }
            if (data.steps) {
              setAgentSteps(data.steps.map((s: { text?: string; type?: string; code?: string; output?: string }) => ({type:s.type||'step',text:s.text||s.type||'',code:s.code,output:s.output})));
            }
            if (data.type === 'step') {
              setAgentSteps(prev => [...prev, {type:data.stepType||'step',text:data.text||'',code:data.code,output:data.output}]);
            }
            if (data.commands && Array.isArray(data.commands)) {
              executeAgentCommands(data.commands);
            }
            if (data.type === 'intent') {
              if (data.location) {
                focusLocation(data.location.lat, data.location.lon, { label: data.location.label || 'Location', color: '#60a5fa', height: 150 });
              }
              if (data.layerIds) {
                (data.layerIds as string[]).forEach((layerId: string) => { if (!isLayerEnabled(layerId)) toggleLayer(layerId); });
              }
            }
            if (data.type === 'output') {
              finalText = data.text;
              if (data.environmentId) lastEnvironmentId = data.environmentId;
              if (data.interactionId) lastInteractionId = data.interactionId;
              if (data.traceId) lastTraceId = data.traceId;
            }
            if (data.type === 'done') {
              if (data.environmentId) lastEnvironmentId = data.environmentId;
              if (data.interactionId) lastInteractionId = data.interactionId;
              if (data.traceId) lastTraceId = data.traceId;
            }
          } catch { /* skip malformed JSON */ }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        processLines();
      }
      processLines();

      if (lastEnvironmentId) setAgentEnvironmentId(lastEnvironmentId);
      if (lastInteractionId) agentInteractionIdRef.current = lastInteractionId;

      if (finalText) {
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: finalText, traceId: lastTraceId }]);
      } else {
        const fallback = generateLocalResponse(userMsg, loc);
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: fallback }]);
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: '⏹ Response stopped.' }]);
      } else {
        const fallback = generateLocalResponse(userMsg, loc);
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `${fallback}\n\n*(Agent unavailable: ${e})*` }]);
      }
    }
    setAiTyping(false);
    abortControllerRef.current = null;
  }, [aiInput, agentEnvironmentId, sandboxWorkspaceId, sendToPipeline, focusLocation, sendMonitorCommand, sendScheduleCommand, toggleLayer]); // eslint-disable-line react-hooks/exhaustive-deps

  async function extractLocation(text: string): Promise<{ lat: number; lon: number } | null> {
    // Fast path: local coordinate regex
    const coordMatch = text.match(/(-?\d+\.?\d*)\s*[,，]\s*(-?\d+\.?\d*)/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { lat, lon };
      }
    }

    // Fast path: local city map (instant, no API call)
    const cityMap: Record<string, [number, number]> = {
      tokyo:[35.6762,139.6503], delhi:[28.7041,77.1025], shanghai:[31.2304,121.4737],
      'new york':[40.7128,-74.006], london:[51.5074,-0.1278], paris:[48.8566,2.3522],
      mumbai:[19.076,72.8777], cairo:[30.0444,31.2357], 'los angeles':[34.0522,-118.2437],
      beijing:[39.9042,116.4074], moscow:[55.7558,37.6173], istanbul:[41.0082,28.9784],
      seoul:[37.5665,126.978], bangkok:[13.7563,100.5018], singapore:[1.3521,103.8198],
      sydney:[-33.8688,151.2093], dubai:[25.2048,55.2708], rio:[-22.9068,-43.1729],
      chicago:[41.8781,-87.6298], 'san francisco':[37.7749,-122.4194], toronto:[43.6532,-79.3832],
      berlin:[52.52,13.405], madrid:[40.4168,-3.7038], rome:[41.9028,12.4964],
      hongkong:[22.3193,114.1694], 'kuala lumpur':[3.139,101.6869], jakarta:[-6.2088,106.8456],
      'sao paulo':[-23.5505,-46.6333], 'mexico city':[19.4326,-99.1332],
    };
    const lower = text.toLowerCase();
    for (const [city, coords] of Object.entries(cityMap)) {
      if (lower.includes(city)) return { lat: coords[0], lon: coords[1] };
    }

    // Deep path: server-side LLM geocoding for any location name
    try {
      const resp = await fetch(`/api/agent/geocode?q=${encodeURIComponent(text)}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.lat !== undefined) return { lat: data.lat, lon: data.lon };
      }
    } catch { /* fall through to null */ }

    // Fallback: if query implies "near me" and we have a last known location, use it
    const loc = lastKnownLocationRef.current;
    if (loc && (lower.includes('nearby') || lower.includes('nearest') || lower.includes('near me') || lower.includes('around me') || lower.includes('within ') || lower.includes('closest') || lower.includes('my location') || lower.includes('current location'))) {
      return loc;
    }

    return null;
  }

  function extractCommand(text: string): string | null {
    return null;
  }

  function executeCommand(_cmd: string, _loc: { lat: number; lon: number } | null) {
  }

  function executeAgentCommands(commands: Array<{ action: string; [key: string]: unknown }>) {
    for (const cmd of commands) {
      try {
        const v = viewerRef.current;
        if (!v) continue;
        switch (cmd.action) {
          case 'flyTo': {
            const lat = cmd.lat as number;
            const lon = cmd.lon as number;
            if (isFinite(lat) && isFinite(lon)) {
              focusLocation(lat, lon, { label: (cmd.label as string) || 'Location', color: '#60a5fa', height: 150 });
            }
            break;
          }
          case 'toggleLayer': {
            const layerId = cmd.layerId as string;
            const enabled = cmd.enabled as boolean;
            if (layerId) {
              const currentOn = isLayerEnabled(layerId);
              if (currentOn !== enabled) toggleLayer(layerId);
            }
            break;
          }
          case 'addPin': {
            const lat = cmd.lat as number;
            const lon = cmd.lon as number;
            if (isFinite(lat) && isFinite(lon)) {
              const color = (cmd.color as string) || '#ef4444';
              const label = (cmd.label as string);
              v.entities.add({
                position: Cesium.Cartesian3.fromDegrees(lon, lat),
                name: label || 'Agent Pin',
                billboard: { image: createPinIcon(color, 24), width: 24, height: 24, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
                label: label ? { text: label, font: '11px "JetBrains Mono"', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, pixelOffset: new Cesium.Cartesian2(0, -18) } : undefined,
                properties: { layer: 'pin', lat, lon, agent: true },
              });
            }
            break;
          }
          default:
            break;
        }
      } catch { /* skip malformed commands */ }
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
    if (lower.includes('plane') || lower.includes('flight') || lower.includes('aircraft') || lower.includes('adsb')) return '✈️ **Live Aircraft**\n\nAircraft tracking is available via the sidebar (Aviation category). Enable "ADSB.lol" or "Flight Tracks" to see live planes on the globe. Try saying "show flights near me" with location enabled.';
    if (lower.includes('help')) return '📚 **Available Commands**\n\n- "Show earthquakes in [location]"\n- "Weather in [city]"\n- "Fly to [location]"\n- "Show population impact"\n- "Storm tracking"\n- "Wildfire status"\n- "Tsunami alerts"\n- "Show flights near me"\n\nOr ask any question about Earth data!';
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
      v.entities.add({
        position: Cesium.Cartesian3.fromDegrees(cm.lon, cm.lat),
        name: 'Dropped Pin',
        billboard: { image: createPinIcon('#ef4444'), width: 24, height: 24,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
        label: { text: `📍 ${cm.lat.toFixed(3)}, ${cm.lon.toFixed(3)}`,
          font: '11px "JetBrains Mono"', fillColor: Cesium.Color.WHITE,
          pixelOffset: new Cesium.Cartesian2(0, -14) },
        properties: { layer: 'pin', lat: cm.lat, lon: cm.lon, id: pinId },
      });
      pinCountRef.current += 1;
      if (pinCountRef.current > 50) {
        const oldestPin = v.entities.values.find(e => e.properties?.getValue(Cesium.JulianDate.now())?.layer === 'pin');
        if (oldestPin) { v.entities.remove(oldestPin); pinCountRef.current -= 1; }
      }
      showNotification('Pin dropped', 'success');
    } else if (action === 'weather') {
      focusLocation(cm.lat, cm.lon, { label: 'Weather request', color: '#22d3ee', height: 150 });
      addWeatherCard(cm.lat, cm.lon);
    } else if (action === 'events') {
      const nearby = findNearbyEvents(cm.lat, cm.lon, 200);
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant',
        content: `📍 **Events near ${cm.lat.toFixed(2)}, ${cm.lon.toFixed(2)}**\n\n${nearby.length > 0 ? nearby.map(e => `- ${e.title} (${e.distance.toFixed(0)}km)`).join('\n') : 'No recent events found within 200km.'}` }]);
      setShowAI(true);
    } else if (action === 'ai_intel') {
      setShowAI(true);
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'user', content: `🧠 AI Intelligence for ${cm.lat.toFixed(2)}, ${cm.lon.toFixed(2)}` }]);
      getLocationContextData(cm.lat, cm.lon);
    }
  }, [contextMenu, addWeatherCard, getLocationContextData, focusLocation]); // eslint-disable-line react-hooks/exhaustive-deps

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
     STUDY AREA
     ═════════════════════════════════════════════════════════════════ */

  const applyStudyArea = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    clearStudyArea();
    const west = parseFloat(studyWest);
    const south = parseFloat(studySouth);
    const east = parseFloat(studyEast);
    const north = parseFloat(studyNorth);
    if (!isFinite(west) || !isFinite(south) || !isFinite(east) || !isFinite(north)) return;
    const rect = Cesium.Rectangle.fromDegrees(west, south, east, north);
    studyAreaEntityRef.current = v.entities.add({
      rectangle: {
        coordinates: rect,
        material: new Cesium.Color(0.2, 0.8, 0.3, 0.08),
        outline: true,
        outlineColor: Cesium.Color.LIME,
        outlineWidth: 2,
      },
    });
    v.camera.flyTo({ destination: rect });
    v.scene.requestRender();
  }, [studyWest, studySouth, studyEast, studyNorth]);

  function clearStudyArea() {
    const v = viewerRef.current;
    if (!v) return;
    if (studyAreaEntityRef.current) {
      v.entities.remove(studyAreaEntityRef.current);
      studyAreaEntityRef.current = null;
      v.scene.requestRender();
    }
  }

  const flyToStudyArea = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    const west = parseFloat(studyWest);
    const south = parseFloat(studySouth);

    const east = parseFloat(studyEast);
    const north = parseFloat(studyNorth);
    if (!isFinite(west) || !isFinite(south) || !isFinite(east) || !isFinite(north)) return;
    const rect = Cesium.Rectangle.fromDegrees(west, south, east, north);
    studyAreaEntityRef.current = v.entities.add({
      rectangle: {
        coordinates: rect,
        material: new Cesium.Color(0.2, 0.8, 0.3, 0.08),
        outline: true,
        outlineColor: Cesium.Color.LIME,
        outlineWidth: 2,
      },
    });
    v.camera.flyTo({ destination: rect });
    v.scene.requestRender();
  }, [studyWest, studySouth, studyEast, studyNorth]);

  const startStudyDraw = useCallback(async (type: 'RECTANGLE' | 'POLYGON' | 'CIRCLE') => {
    const v = viewerRef.current;
    if (!v) return;
    try {
      const Drawer = (await import('@cesium-extends/drawer')).default;
      if (drawerRef.current) { drawerRef.current.destroy(); drawerRef.current = null; }
      const drawer = new Drawer(v, {
        terrain: false,
        tips: { init: 'Click to start drawing', start: 'Click to place · Double-click to finish', end: '' },
      });
      drawerRef.current = drawer;
      drawer.start({
        type,
        oneInstance: false,
        finalOptions: type === 'RECTANGLE' ? {
          material: new Cesium.Color(0.2, 0.8, 0.3, 0.12),
          outline: true, outlineColor: Cesium.Color.LIME, outlineWidth: 2,
        } : type === 'CIRCLE' ? {
          material: new Cesium.Color(0.2, 0.8, 0.3, 0.12),
          outline: true, outlineColor: Cesium.Color.LIME, outlineWidth: 2,
        } : {
          material: new Cesium.Color(0.2, 0.8, 0.3, 0.12),
          outline: true, outlineColor: Cesium.Color.LIME, outlineWidth: 2,
        },
        onEnd: (entity: any, positions: Cesium.Cartesian3[]) => {
          if (!v || !positions?.length) return;
          const typeLabel = type === 'RECTANGLE' ? 'rectangle' : type === 'CIRCLE' ? 'circle' : 'polygon';
          const name = `${typeLabel} ${studyAreasRef.current.length + 1}`;
          const color = '#22c55e';
          const coords = positions.map((p: Cesium.Cartesian3) => {
            const carto = Cesium.Cartographic.fromCartesian(p);
            return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
          });
          const geojson: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [coords.length >= 2 ? [...coords, coords[0]] : coords],
              },
              properties: { name, type: typeLabel },
            }],
          };
          const area: StudyAreaItem = {
            id: `study_area_${Date.now()}`, name, type: typeLabel as any,
            visible: true, active: false, entity, positions, geojson, color, width: 3,
          };
          updateStudyAreaStyle(v, area, color, 3);
          // Deactivate all other areas, activate this one
          studyAreasRef.current.forEach(a => {
            if (a.id !== area.id && a.active) setStudyAreaActive(v, a, false);
          });
          setStudyAreaActive(v, area, true);
          studyAreasRef.current = [...studyAreasRef.current, area];
          setStudyAreas(studyAreasRef.current);
          setActiveStudyAreaId(area.id);
          flyToStudyAreaTopDown(v, area);
          setStudyDrawing(false);
          v.scene.requestRender();
        },
      });
    } catch (err) {
      console.warn('Drawer init failed:', err);
      setStudyDrawing(false);
    }
  }, []);

  const stopStudyDraw = useCallback(() => {
    if (drawerRef.current) {
      drawerRef.current.reset();
      drawerRef.current = null;
    }
    setStudyDrawing(false);
  }, []);

  /* ═════════════════════════════════════════════════════════════════
     AUTO CLIP TO ACTIVE STUDY AREA
     ═════════════════════════════════════════════════════════════════ */

  const clipTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (clipTimeoutRef.current) clearTimeout(clipTimeoutRef.current);
    if (activeStudyAreaId && layers.some(l => l.on)) {
      clipTimeoutRef.current = setTimeout(() => {
        filterDataEntitiesByStudyArea(v, studyAreasRef.current, true, activeStudyAreaId);
      }, 500);
    } else {
      restoreHiddenEntities(v);
      layers.filter(l => !l.on).forEach(l => {
        const ents = entityStoreRef.current[l.id];
        if (ents) ents.forEach(e => { if (e) e.show = false; });
      });
      v.scene.requestRender();
    }
    return () => { if (clipTimeoutRef.current) clearTimeout(clipTimeoutRef.current); };
  }, [activeStudyAreaId, layers]);

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
    Object.values(notificationTimeoutsRef.current).forEach(clearTimeout);
    notificationTimeoutsRef.current = {};
    if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
    if (issTimerRef.current) clearInterval(issTimerRef.current);
    if (issRenderTickRef.current) { issRenderTickRef.current(); issRenderTickRef.current = null; }
    if (rotateTimerRef.current) clearInterval(rotateTimerRef.current);
    if (timelineRef.current.interval) clearInterval(timelineRef.current.interval);
    if (autoRefreshIntervalRef.current) clearInterval(autoRefreshIntervalRef.current);
    if (autoRefreshSlowRef.current) clearInterval(autoRefreshSlowRef.current);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAbortRef.current?.abort();
    weatherAbortRef.current?.abort();
    if (screenSpaceHandlerRef.current) screenSpaceHandlerRef.current.destroy();
    if (drawerRef.current) { drawerRef.current.destroy(); drawerRef.current = null; }
    studyAreasRef.current.forEach(a => { if (viewerRef.current) removeStudyAreaFromGlobe(viewerRef.current, a); });
    studyAreasRef.current = [];
    seismicAnimationsRef.current.forEach(a => { if (a.interval) clearInterval(a.interval); });
    seismicAnimationsRef.current = [];
    if (clickHandlerRef.current) { clickHandlerRef.current(); clickHandlerRef.current = null; }
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
    entropyHaloRef.current?.destroy();
    entropyHaloRef.current = null;
    oracleChainRef.current?.destroy();
    oracleChainRef.current = null;
    entityTrackerRef.current?.destroy();
    entityTrackerRef.current = null;
    aisTrackerRef.current?.stop();
    aisTrackerRef.current?.clear();
    aisTrackerRef.current = null;
    flightDrRef.current?.clear();
    flightDrRef.current = null;
    adsbLolDrRef.current?.clear();
    adsbLolDrRef.current = null;
    adsbFiDrRef.current?.clear();
    adsbFiDrRef.current = null;
    flightawareDrRef.current?.clear();
    flightawareDrRef.current = null;
    airlabsDrRef.current?.clear();
    airlabsDrRef.current = null;
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
    } else if (px.temperature != null) {
      rows.push({ key: 'Temp', val: `${Number(px.temperature).toFixed(1)}°C` });
      rows.push({ key: 'Humidity', val: `${Number(px.humidity ?? 0).toFixed(0)}%` });
      rows.push({ key: 'Rain', val: `${Number(px.precipitation ?? 0).toFixed(1)} mm` });
      rows.push({ key: 'Wind', val: `${Number(px.windSpeed ?? 0).toFixed(1)} km/h` });
      rows.push({ key: 'Pressure', val: `${Number(px.pressure ?? 0).toFixed(1)} hPa` });
      rows.push({ key: 'Source', val: 'Open-Meteo' });
    } else {
      // Cesium InfoBox fallback: show all properties as key-value rows
      for (const [key, val] of Object.entries(p)) {
        if (['layer', 'title', 'name', 'callsign'].includes(key)) continue;
        if (key === 'lat' || key === 'lon') continue;
        const strVal = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '');
        if (strVal && strVal !== 'undefined' && strVal !== 'null') {
          rows.push({ key: key.charAt(0).toUpperCase() + key.slice(1), val: strVal });
        }
      }
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
          <button className="info-close" onClick={() => { setInfoEntity(null); entityTrackerRef.current?.untrack(); }}>✕</button>
        </div>
        <div className="info-body">
          {rows.map((r, i) => (
            <div key={i} className="info-row">
              <span className="info-key">{r.key}</span>
              <span className="info-val">{r.val}</span>
            </div>
          ))}

          {infoEntity.description && (
            <div className="info-description" dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(
                String(infoEntity.description.getValue(Cesium.JulianDate.now()))
                  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  .replace(/`([^`]+)`/g, '<code>$1</code>')
                  .replace(/\n/g, '<br/>'),
                { ALLOWED_TAGS: ['strong', 'em', 'code', 'br', 'p', 'span'], ALLOWED_ATTR: ['class'], ALLOW_DATA_ATTR: false }
              ),
            }} />
          )}

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

  const traceKeyFor = (msg: ChatMessage) => `trace_${msg.traceId || msg.id}`;
  const traceTargetFor = (msg: ChatMessage) => encodeURIComponent(String(msg.traceId || msg.id));

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
          <button className={`btn-icon ${showStudyArea ? 'active' : ''}`} onClick={() => setShowStudyArea(p => !p)} title="Study Area">🎯</button>
          <button className={`btn-icon ${showAI ? 'active' : ''}`} onClick={() => setShowAI(p => !p)} title="AI Assistant">🤖</button>
          <button className={`btn-icon ${showAlertsPanel ? 'active' : ''}`} onClick={() => setShowAlertsPanel(p => !p)} title="Alerts">
            🔔
            {newAlertCount > 0 && <span style={{ position:'absolute',top:-2,right:-2,background:'#ef4444',color:'white',fontSize:9,borderRadius:'50%',width:14,height:14,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:600}}>{newAlertCount}</span>}
          </button>
          <button className={`btn-icon ${showAnalytics ? 'active' : ''}`} onClick={() => { setShowAnalytics(p => !p); if (!analyticsData) fetch('/api/agent/analytics').then(r => r.json()).then(setAnalyticsData).catch(() => {}); }} title="Analytics & Insights">📊</button>
          <button className={`btn-icon ${showShareDialog ? 'active' : ''}`} onClick={() => setShowShareDialog(true)} title="Share">📤</button>
          <button className="btn-icon" onClick={() => setShowApiVault(true)} title="API Configuration">🔑</button>
          <button className={`btn-icon ${showCognitiveDashboard ? 'active' : ''}`} onClick={() => setShowCognitiveDashboard(p => !p)} title="Cognitive Dashboard">🧠</button>
          <button className={`btn-icon ${showCockpitAlerts ? 'active' : ''}`} onClick={() => setShowCockpitAlerts(p => !p)} title="Proactive Alerts">🚨</button>
          <button className={`btn-icon ${showToolWorkbench ? 'active' : ''}`} onClick={() => setShowToolWorkbench(p => !p)} title="Tool Workbench">🔧</button>
          <button className={`btn-icon ${showMemoryExplorer ? 'active' : ''}`} onClick={() => setShowMemoryExplorer(p => !p)} title="Memory Explorer">💾</button>
          <button className={`btn-icon ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings(p => !p)} title="Settings">⚙️</button>
          <button className={`btn-icon ${showScenarioGallery ? 'active' : ''}`} onClick={() => setShowScenarioGallery(p => !p)} title="Scenarios">🌋</button>
          <button className={`btn-icon ${showScenarioEditor ? 'active' : ''}`} onClick={() => setShowScenarioEditor(p => !p)} title="New Scenario">🎬</button>

          <button className={`btn-icon ${showCinematicDirector ? 'active' : ''}`} onClick={() => setShowCinematicDirector(p => !p)} title="Cinematic Director">🎥</button>
          <button className={`btn-icon ${showSpatialSketching ? 'active' : ''}`} onClick={() => setShowSpatialSketching(p => !p)} title="Spatial Sketch">✏️</button>
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
          <span className="sidebar-search-icon">⌕</span>
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
                      <div className="layer-controls">
                        {layer.badge && <span className={`layer-badge badge-${layer.badge.toLowerCase()}`}>{layer.badge}</span>}
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
                        <div className="toggle">
                          <input type="checkbox" checked={layer.on} onChange={e => { e.stopPropagation(); toggleLayer(layer.id); }} />
                          <div className="toggle-slider" />
                        </div>
                      </div>
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
          <div className="btn-row" style={{marginBottom:8, gap:4, flexWrap:'wrap'}}>
            <button className="btn-all" style={{background:showRiskForecast ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)', fontSize:10}} onClick={() => setShowRiskForecast(p => !p)}>⚠️ Risk</button>
            <button className="btn-all" style={{background:showTimeSlider ? 'rgba(96,165,250,0.2)' : 'rgba(255,255,255,0.05)', fontSize:10}} onClick={() => setShowTimeSlider(p => !p)}>⏱ Time</button>
            <button className="btn-all" style={{background:showMeasureTool ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)', fontSize:10}} onClick={() => setShowMeasureTool(p => !p)}>📏 Measure</button>
            {isAdmin && <button className="btn-all" style={{background:'rgba(59,130,246,0.2)', fontSize:10}} onClick={() => setShowAdmin(true)}>🛡️ Admin</button>}
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

      {/* Study Area Panel */}
      <StudyAreaPanel
        viewer={viewerRef.current}
        areas={studyAreas}
        setAreas={(updater: any) => {
          const next = typeof updater === 'function' ? updater(studyAreasRef.current) : updater;
          studyAreasRef.current = next;
          setStudyAreas(next);
        }}
        activeStudyAreaId={activeStudyAreaId}
        onActivate={(id: string) => {
          const v = viewerRef.current;
          if (!v) return;
          if (!id) {
            setActiveStudyAreaId(null);
            return;
          }
          studyAreasRef.current.forEach(a => {
            if (a.id === id) setStudyAreaActive(v, a, true);
            else if (a.active) setStudyAreaActive(v, a, false);
          });
          setActiveStudyAreaId(id);
        }}
        show={showStudyArea}
        onClose={() => { stopStudyDraw(); setShowStudyArea(false); }}
        onStartDraw={startStudyDraw}
        onStopDraw={stopStudyDraw}
        drawing={studyDrawing}
        setDrawing={setStudyDrawing}
      />

      {/* AI Panel */}
      <div className={`ai-panel glass-panel ${showAI ? 'open' : ''}`}>
        <div className="ai-header">
          <div className="ai-icon">🤖</div>
          <div className="ai-title">Earth Intelligence AI</div>
          <div className="ai-header-actions" style={{display:'flex',gap:4,marginLeft:'auto',alignItems:'center'}}>
            <button className="ai-header-btn" onClick={() => setShowChatHistory(prev => !prev)} title="Chat History" style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',fontSize:14,padding:'2px 6px'}}>📋</button>
            <button className="ai-header-btn" onClick={newChat} title="New Chat" style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',fontSize:14,padding:'2px 6px'}}>✏️</button>
            <button className="ai-close" onClick={() => setShowAI(false)}>✕</button>
          </div>
        </div>
        <div className="ai-messages" style={{paddingBottom:4}}>
          {aiMessages.map((msg) => (
            <div key={msg.id} className={`ai-msg ${msg.role}${msg.type === 'code-result' || msg.type === 'pipeline' || msg.type === 'data-analysis' ? ' code-result' : ''}${msg.type === 'image' ? ' image-msg' : ''}`}>
              {msg.role === 'assistant' ? (
                <div>
                  {msg.type === 'pipeline' && <div className="msg-label">⚡ Computation Pipeline Result</div>}
                  {msg.type === 'upload' && <div className="msg-label" style={{color:'#60a5fa'}}>📁 File Upload</div>}
                  {msg.type === 'vision' && <div className="msg-label" style={{color:'#a78bfa'}}>🔍 Vision Analysis</div>}
                  {msg.type === 'data-analysis' && <div className="msg-label" style={{color:'#34d399'}}>📊 Data Analysis</div>}
                  {msg.type === 'error' && <div className="msg-label" style={{color:'#ef4444'}}>⚠️ Error</div>}
                  <div className="rich-content" dangerouslySetInnerHTML={{ __html: richRender(msg.content) }} />
                  {renderCommandChips(msg.content, focusLocation, toggleLayer)}
                  {msg.type !== 'error' && !msg.type?.startsWith('monitor') && !msg.feedback && (
                    <div className="msg-feedback" style={{display:'flex',gap:6,marginTop:6,alignItems:'center'}}>
                      <span style={{fontSize:9,color:'var(--text-dim)'}}>Was this helpful?</span>
                      <button className="fb-btn up" onClick={() => {
                        fetch('/api/agent/feedback', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({vote:'up', query:aiMessages.filter(m => m.role==='user' && m.id < msg.id).slice(-1)[0]?.content||'', response:msg.content, intentType:msg.type||'unknown', modelTier:'auto'}) }).catch(()=>{});
                        setAiMessages(prev => prev.map(m => m.id === msg.id ? {...m, feedback:'up'} : m));
                      }} title="Helpful">👍</button>
                      <button className="fb-btn down" onClick={() => {
                        fetch('/api/agent/feedback', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({vote:'down', query:aiMessages.filter(m => m.role==='user' && m.id < msg.id).slice(-1)[0]?.content||'', response:msg.content, intentType:msg.type||'unknown', modelTier:'auto'}) }).catch(()=>{});
                        setAiMessages(prev => prev.map(m => m.id === msg.id ? {...m, feedback:'down'} : m));
                      }} title="Not helpful">👎</button>
                    </div>
                  )}
                  {msg.feedback && <div style={{fontSize:9,color:'var(--text-dim)',marginTop:4}}>Feedback: {msg.feedback === 'up' ? '👍' : '👎'}</div>}
                  {/* Explainability: reasoning trace & evidence chain buttons */}
                  {msg.role === 'assistant' && msg.content.length > 20 && (
                    <div style={{display:'flex',gap:4,marginTop:4}}>
                      <button
                        onClick={() => {
                          const key = traceKeyFor(msg);
                          if (showReasoningFor[key]) {
                            setShowReasoningFor(prev => ({...prev, [key]: false}));
                            return;
                          }
                          setShowReasoningFor(prev => ({...prev, [key]: true}));
                          fetch(`/api/explain/trace/${traceTargetFor(msg)}`).then(r => r.ok ? r.json() : null).then(data => {
                            if (data) setReasoningTraces(prev => ({...prev, [key]: data}));
                          }).catch(() => {});
                        }}
                        style={{fontSize:9,color:'var(--text-dim)',background:'none',border:'none',cursor:'pointer',padding:'1px 4px',borderRadius:3}}
                        title="View reasoning trace"
                      >
                        🧠 Trace
                      </button>
                      <button
                        onClick={() => {
                          const key = `evidence_${msg.id}`;
                          if (showEvidenceFor[key]) {
                            setShowEvidenceFor(prev => ({...prev, [key]: false}));
                            return;
                          }
                          setShowEvidenceFor(prev => ({...prev, [key]: true}));
                          fetch(`/api/explain/evidence/${msg.id}`).then(r => r.ok ? r.json() : null).then(data => {
                            if (data) setEvidenceChains(prev => ({...prev, [key]: data}));
                          }).catch(() => {});
                        }}
                        style={{fontSize:9,color:'var(--text-dim)',background:'none',border:'none',cursor:'pointer',padding:'1px 4px',borderRadius:3}}
                        title="View evidence chain"
                      >
                        📋 Evidence
                      </button>
                    </div>
                  )}
                  {showReasoningFor[traceKeyFor(msg)] && reasoningTraces[traceKeyFor(msg)] && (
                    <ReasoningTraceViewer trace={reasoningTraces[traceKeyFor(msg)]} />
                  )}
                  {showEvidenceFor[`evidence_${msg.id}`] && evidenceChains[`evidence_${msg.id}`] && (
                    <EvidenceChainPanel
                      chain={evidenceChains[`evidence_${msg.id}`].chain}
                      integrity={evidenceChains[`evidence_${msg.id}`].integrity}
                    />
                  )}
                </div>
              ) : msg.type === 'image' ? (
                <div>
                  <div>{msg.content}</div>
                  {chatImages.filter(img => img.fileName === msg.content.replace(/\[Image: |]/g, '')).slice(-1).map(img => (
                    <div key={img.id} className="chat-image-container" style={{marginTop:4}}>
                      <img src={img.dataUrl} alt={img.fileName} className="chat-image" style={{maxWidth:'100%',maxHeight:180,borderRadius:6,cursor:'pointer'}} onClick={() => window.open(img.dataUrl, '_blank')} />
                      <div style={{fontSize:9,color:'var(--text-dim)',marginTop:2}}>{img.fileName}</div>
                    </div>
                  ))}
                </div>
              ) : msg.content}
            </div>
          ))}
          {pipelineProgress.length > 0 && (
            <div className="ai-msg assistant" style={{borderColor:'rgba(96,165,250,0.3)',background:'rgba(96,165,250,0.04)'}}>
              <div className="msg-label" style={{fontSize:10,fontWeight:600,color:'#60a5fa',marginBottom:4}}>🔄 Pipeline Progress</div>
              {pipelineProgress.map(p => (
                <div key={p.id} className={`pipeline-step ${p.status}`}>
                  <span className="pipeline-step-icon">
                    {p.status === 'completed' ? '✅' : p.status === 'running' ? '🔄' : p.status === 'failed' ? '❌' : '⏳'}
                  </span>
                  <span>{p.description}</span>
                </div>
              ))}
            </div>
          )}
          {agentSteps.length > 0 && (
            <div className="thinking-block">
              <div className="thinking-header" onClick={() => setExpandedStep(expandedStep === -1 ? null : -1)}>
                <span className="thinking-chevron">{expandedStep === -1 ? '▼' : '▶'}</span>
                <span className="thinking-title">🤔 Thinking... ({agentSteps.length} steps)</span>
                <span className="thinking-count">{agentSteps.filter(s => s.status === 'completed').length}/{agentSteps.length}</span>
              </div>
              {expandedStep === -1 && (
                <div className="thinking-body">
                  {agentSteps.map((step, i) => (
                    <div key={i} className={`think-step ${step.status === 'running' ? 'running' : step.status === 'failed' ? 'failed' : ''}`}>
                      <div className="think-step-header" onClick={() => setExpandedStep(expandedStep === i ? null : i)}>
                        <span className="think-step-icon">
                          {step.status === 'running' ? '🔄' : step.status === 'completed' ? '✅' : step.status === 'failed' ? '❌' : '💭'}
                        </span>
                        <span className="think-step-text">{step.text}</span>
                        <span className="think-step-chevron">{expandedStep === i ? '▼' : '▶'}</span>
                      </div>
                      {expandedStep === i && (
                        <div className="think-step-detail">
                          {step.code && <div className="think-code-block"><div className="think-code-label">Code</div><pre className="think-code">{step.code}</pre></div>}
                          {step.output && <div className="think-output-block"><div className="think-output-label">Output</div><pre className="think-output">{step.output}</pre></div>}
                          {step.timeMs !== undefined && <div className="think-timing">⏱ {step.timeMs}ms</div>}
                        </div>
                      )}
                    </div>
                  ))}
                  {agentSteps.length === 0 && <div className="think-step" style={{padding:8,fontSize:11,color:'var(--text-dim)'}}>Waiting for agent...</div>}
                  {agentSteps.some(s => s.status === 'running') && <div className="think-thinking"><span /><span /><span /></div>}
                </div>
              )}
            </div>
          )}
          {aiTyping && agentSteps.length === 0 && (
            <div className="ai-typing">
              <span /><span /><span />
            </div>
          )}
        </div>
        <HumanOverrideBanner />
        {sandboxWorkspaceId && uploadedFiles.length > 0 && (
          <div className="sandbox-file-upload">
            <span className="sandbox-workspace-badge">📦 Workspace active</span>
            <span className="sandbox-file-name">{uploadedFiles.length} file(s)</span>
          </div>
        )}
        {aiMessages.length <= 1 && (
        <div className="ai-suggestion-chips">
          {['Recent earthquakes?','Weather in Tokyo','Show wildfires','Aircraft near Delhi','Analyze quake stats','Compute averages'].map(chip => (
            <span key={chip} className="ai-chip" onClick={() => { setAiInput(chip); }}>{chip}</span>
          ))}
        </div>
        )}
        <div className="ai-input-wrap">
          <button className={`ai-voice-btn ${isListening ? 'listening' : ''}`}
            onClick={toggleVoiceInput} title={isListening ? 'Listening...' : 'Voice input'}
            style={{display:voiceSupported ? 'flex' : 'none'}}>
            {isListening ? '🔴' : '🎤'}
          </button>
          <input className="ai-input" placeholder="Ask, analyze, compute, or upload data..."
            value={aiInput} onChange={e => setAiInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendAI(); }} />
          {aiTyping ? (
            <button className="ai-stop" onClick={() => {
              abortControllerRef.current?.abort();
              if (currentRequestIdRef.current) {
                ws.cancelRequest(currentRequestIdRef.current);
                currentRequestIdRef.current = null;
              }
            }} title="Stop response" style={{background:'rgba(239,68,68,0.15)',border:'1px solid rgba(239,68,68,0.4)',color:'#ef4444',borderRadius:6,cursor:'pointer',fontSize:11,fontWeight:600,padding:'4px 10px'}}>■ Stop</button>
          ) : (
            <button className="ai-send" onClick={sendAI}>➤</button>
          )}
        </div>
        <div className="sandbox-file-upload" style={{borderTop:'1px solid var(--border)',padding:'4px 12px',display:'flex',gap:8,flexWrap:'wrap'}}>
          <label className="sandbox-file-btn" style={{fontSize:10,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4}}>
            📎 Upload data (sandbox)
            <input type="file" style={{display:'none'}} onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }} />
          </label>
          <label className="sandbox-file-btn" style={{fontSize:10,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4}}>
            📷 Upload image
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{display:'none'}} onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleImageUpload(file);
            }} />
          </label>
          <label className="sandbox-file-btn" style={{fontSize:10,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4}}>
            📊 Analyze data file
            <input type="file" accept=".csv,.json,.geojson" style={{display:'none'}} onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleDataFileUpload(file);
            }} />
          </label>
          <button className="sandbox-file-btn" style={{fontSize:10,display:'inline-flex',alignItems:'center',gap:4}}
            onClick={() => { speakResponse(aiMessages.filter(m => m.role === 'assistant').slice(-1)[0]?.content || ''); }}
            title="Read last response aloud">
            🔊 Speak
          </button>
          <button className="sandbox-file-btn" style={{fontSize:10,display:'inline-flex',alignItems:'center',gap:4}}
            onClick={() => { navigator.clipboard.writeText(buildSessionShareLink()).catch(() => {}); setShowShareDialog(true); setTimeout(() => setShowShareDialog(false), 1500); }}
            title="Copy session link to clipboard">
            🔗 Share session
          </button>
          {showShareDialog && <span style={{fontSize:9,color:'#34d399'}}>Copied!</span>}
          {sandboxWorkspaceId && <span className="sandbox-workspace-badge">☰ Workspace</span>}
        </div>
        <div className="ai-api-note">
          Powered by {aiApiType === 'anthropic' ? 'Claude' : aiApiType === 'gemini' ? 'Gemini' : 'Local AI'}
          {sandboxWorkspaceId && ' · Sandbox active'}
          {voiceSupported && ' · Voice supported'}
        </div>
      </div>

      {/* Chat History Panel */}
      <div className={`chat-history-panel glass-panel ${showChatHistory ? 'open' : ''}`} style={{position:'fixed',top:0,left:0,width:300,height:'100vh',zIndex:1001,transform:showChatHistory ? 'translateX(0)' : 'translateX(-100%)',transition:'transform 0.25s ease',display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div className="chat-history-header" style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',borderBottom:'1px solid var(--border)'}}>
          <span style={{fontWeight:600,fontSize:14}}>Chat History</span>
          <button onClick={() => setShowChatHistory(false)} style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',fontSize:16}}>✕</button>
        </div>
        <div className="chat-history-list" style={{flex:1,overflowY:'auto',padding:'6px 0'}}>
          {chatList.length === 0 && <div style={{padding:'20px 14px',fontSize:12,color:'var(--text-dim)',textAlign:'center'}}>No saved chats yet.</div>}
          {groupChatsByDate(chatList).map(group => (
            <div key={group.label}>
              <div className="chat-date-group" style={{padding:'8px 14px 4px',fontSize:10,fontWeight:600,color:'var(--text-dim)',textTransform:'uppercase',letterSpacing:0.5}}>{group.label}</div>
              {group.items.map(chat => (
                <div key={chat.id} className={`chat-history-item ${chat.id === currentChatIdRef.current ? 'active' : ''}`}
                  onClick={() => loadChat(chat.id)}
                  style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 14px',cursor:'pointer',fontSize:12,borderRadius:0,background:chat.id === currentChatIdRef.current ? 'rgba(96,165,250,0.08)' : 'transparent',borderLeft: chat.id === currentChatIdRef.current ? '3px solid #60a5fa' : '3px solid transparent'}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{chat.title}</div>
                    <div style={{fontSize:10,color:'var(--text-dim)',marginTop:2}}>{chat.messageCount} messages · {new Date(chat.updatedAt || chat.createdAt).toLocaleDateString()}</div>
                  </div>
                  <button onClick={async (e) => { e.stopPropagation(); await deleteChatSession(chat.id); }} style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',fontSize:12,padding:'2px 4px',opacity:0.6}} title="Delete">✕</button>
                </div>
              ))}
            </div>
          ))}
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

      {/* Phase 10: Analytics Panel */}
      <div className={`alerts-panel glass-panel ${showAnalytics ? 'open' : ''}`} style={{right:60}}>
        <div className="ai-header">
          <div className="ai-icon">📊</div>
          <div className="ai-title">Analytics & Insights</div>
          <button className="ai-close" onClick={() => setShowAnalytics(false)}>✕</button>
        </div>
        <div className="alerts-list" style={{fontSize:11}}>
          {!analyticsData ? (
            <div style={{textAlign:'center',padding:20,color:'var(--text-dim)',fontSize:11}}>Loading...</div>
          ) : (
            <>
              <div className="alert-item" style={{cursor:'default'}}>
                <div className="alert-title">💰 Cost Summary</div>
                <div style={{padding:'4px 0',display:'flex',justifyContent:'space-between'}}>
                  <span>Total spent:</span>
                  <span style={{color:'var(--accent)'}}>${(analyticsData as any).cost?.totalCost?.toFixed(6) || '0'}</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between'}}>
                  <span>Total queries:</span>
                  <span>{(analyticsData as any).cost?.totalQueries || 0}</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between'}}>
                  <span>Avg cost/query:</span>
                  <span style={{color:'var(--text-dim)'}}>${(analyticsData as any).cost?.avgCostPerQuery?.toFixed(8) || '0'}</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between'}}>
                  <span>Today cost:</span>
                  <span>${(analyticsData as any).cost?.todayCost?.toFixed(6) || '0'}</span>
                </div>
              </div>
              <div className="alert-item" style={{cursor:'default'}}>
                <div className="alert-title">🎯 Satisfaction</div>
                <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0'}}>
                  <span>Rate:</span>
                  <span style={{color:(analyticsData as any).satisfactionRate >= 70 ? '#22c55e' : '#f59e0b'}}>{(analyticsData as any).satisfactionRate || 0}%</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between'}}>
                  <span>👍 Upvotes:</span>
                  <span style={{color:'#22c55e'}}>{(analyticsData as any).totalUpvotes || 0}</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between'}}>
                  <span>👎 Downvotes:</span>
                  <span style={{color:'#ef4444'}}>{(analyticsData as any).totalDownvotes || 0}</span>
                </div>
              </div>
              <div className="alert-item" style={{cursor:'default'}}>
                <div className="alert-title">🗃️ Cache</div>
                <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0'}}>
                  <span>Hit rate:</span>
                  <span style={{color:'var(--accent)'}}>{(analyticsData as any).cache?.hitRate || 0}%</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between'}}>
                  <span>Entries:</span>
                  <span>{(analyticsData as any).cache?.size || 0}</span>
                </div>
              </div>
              {(analyticsData as any).cost?.byModel && (
                <div className="alert-item" style={{cursor:'default'}}>
                  <div className="alert-title">🤖 By Model</div>
                  {Object.entries((analyticsData as any).cost.byModel).map(([tier, data]: [string, any]) => (
                    <div key={tier} style={{display:'flex',justifyContent:'space-between',padding:'2px 0',fontSize:10}}>
                      <span>{tier}</span>
                      <span>{data.queries} queries · ${data.cost?.toFixed(5)}</span>
                    </div>
                  ))}
                </div>
              )}
              <button className="alert-btn" onClick={() => {
                fetch('/api/agent/analytics').then(r=>r.json()).then(setAnalyticsData).catch(()=>{});
              }} style={{width:'100%',marginTop:4}}>🔄 Refresh</button>
            </>
          )}
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
        <div className="stat-item"><div className="stat-dot" style={{background:'#FF8C00'}}/><span className="stat-label">Forks</span><span className="stat-val">{activeForkCount}</span></div>
        <div className="stat-item"><div className="stat-dot" style={{background:'#14b8a6'}}/><span className="stat-label">Camera</span><span className="stat-val">{cameraDms || '—'}</span></div>
        <button
          className={`btn-icon monitor-btn ${!monitorCollapsed ? 'active' : ''}`}
          onClick={() => setMonitorCollapsed(prev => !prev)}
          title="Monitor Panel"
        >
          <Monitor size={14} />
        </button>
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
          <div className="ctx-item" role="menuitem" tabIndex={0} style={{left:'50%',top:0,transform:'translateX(-50%)'}}
            onClick={() => handleContextAction('ai_intel')} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleContextAction('ai_intel'); } }}>
            <span className="ctx-emoji">🧠</span><span className="ctx-label">AI Intel</span>
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
              <div className="weather-temp">{wc.temp > -999 ? `${wc.temp}°C` : 'N/A'}</div>
              <div className="weather-desc">{wc.desc}</div>
            </div>
          </div>
          <div className="weather-grid">
            <div className="weather-item"><span className="weather-label">Humidity</span><span className="weather-value">{wc.humidity > 0 ? `${wc.humidity}%` : '-'}</span></div>
            <div className="weather-item"><span className="weather-label">Wind</span><span className="weather-value">{wc.windSpeed > 0 ? `${wc.windSpeed} km/h` : '-'}</span></div>
            <div className="weather-item"><span className="weather-label">Pressure</span><span className="weather-value">{wc.pressure > 0 ? `${wc.pressure} hPa` : '-'}</span></div>
            <div className="weather-item"><span className="weather-label">Rain</span><span className="weather-value">{wc.precipitation > 0 ? `${wc.precipitation} mm` : '-'}</span></div>
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

      {/* Measure Tool Display */}
      {showMeasureTool && measurePoints.length > 0 && (
        <div className="glass-panel" style={{
          position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
          padding: '10px 20px', borderRadius: 10, zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ color: '#f59e0b', fontWeight: 600 }}>📏 Measurement</span>
          {measureDistance !== null ? (
            <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{measureDistance.toFixed(1)} km</span>
          ) : (
            <span style={{ color: '#94a3b8' }}>Click a second point on the globe</span>
          )}
          <button onClick={() => { setMeasurePoints([]); setMeasureDistance(null); setShowMeasureTool(false); }}
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '4px 10px' }}>
            Clear
          </button>
        </div>
      )}

      {/* Time Slider */}
      {showTimeSlider && (
        <div className="glass-panel" style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          padding: '12px 24px', borderRadius: 12, zIndex: 1000, minWidth: 400,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <button onClick={() => setTimeSliderPlaying(p => !p)}
            style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 18 }}>
            {timeSliderPlaying ? '⏸' : '▶'}
          </button>
          <input type="range" min={Date.now() - 86400000} max={Date.now()} value={timeSliderValue}
            onChange={e => setTimeSliderValue(Number(e.target.value))}
            style={{ flex: 1, height: 4, accentColor: '#60a5fa' }} />
          <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 80, textAlign: 'right' }}>
            {new Date(timeSliderValue).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button onClick={() => setShowTimeSlider(false)}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      )}

      {/* Risk Forecast Layer */}
      {showRiskForecast && (
        <div className="heatmap-legend show glass-panel" style={{ bottom: 200, right: 16 }}>
          <div className="heatmap-legend-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Risk Forecast
            <button onClick={() => setShowRiskForecast(false)}
              style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12, marginLeft: 8 }}>✕</button>
          </div>
          <div className="heatmap-gradient" style={{ background: 'linear-gradient(90deg, #22c55e, #f59e0b, #ef4444)' }} />
          <div className="heatmap-labels"><span>Low</span><span>Medium</span><span>High</span></div>
        </div>
      )}

      {/* Cognitive Dashboard */}
      <div className={`alerts-panel glass-panel ${showCognitiveDashboard ? 'open' : ''}`} style={{ width: 380, maxHeight: 'calc(100vh - 92px)' }}>
        <CognitiveDashboard onClose={() => setShowCognitiveDashboard(false)} />
      </div>

      {/* Cockpit Alerts Panel */}
      <div className={`alerts-panel glass-panel ${showCockpitAlerts ? 'open' : ''}`} style={{ width: 380, maxHeight: 'calc(100vh - 92px)' }}>
        <CockpitAlertPanel onClose={() => setShowCockpitAlerts(false)} onFlyTo={(lat, lon) => { setShowCockpitAlerts(false); focusLocation(lat, lon); }} />
      </div>

      {/* Tool Workbench */}
      <div className={`alerts-panel glass-panel ${showToolWorkbench ? 'open' : ''}`} style={{ width: 480, maxHeight: 'calc(100vh - 92px)' }}>
        <ToolWorkbench onClose={() => setShowToolWorkbench(false)} />
      </div>

      {/* Memory Explorer */}
      <div className={`alerts-panel glass-panel ${showMemoryExplorer ? 'open' : ''}`} style={{ width: 380, maxHeight: 'calc(100vh - 92px)' }}>
        <MemoryExplorer onClose={() => setShowMemoryExplorer(false)} />
      </div>

      {/* Settings Panel */}
      <div className={`alerts-panel glass-panel ${showSettings ? 'open' : ''}`} style={{ width: 360, maxHeight: 'calc(100vh - 92px)' }}>
        <SettingsPanel onClose={() => setShowSettings(false)} />
      </div>

      {/* Fork Panel */}
      <ForkPanel
        forks={forks}
        onPauseFork={handlePauseFork}
        onResumeFork={handleResumeFork}
        onTerminateFork={handleTerminateFork}
      />

      {/* Monitor Panel */}
      {!loading && (
        <div className={`alerts-panel glass-panel ${!monitorCollapsed ? 'open' : ''}`}
          style={{ width: 320, fontFamily: 'monospace', fontSize: 11 }}>
          <div className="ai-header">
            <div className="ai-icon" style={{ background: 'linear-gradient(135deg,#00ff88,#0066ff)' }}>⬡</div>
            <div className="ai-title" style={{ color: '#00ff88' }}>MONITOR</div>
            <button className="ai-close" onClick={() => setMonitorCollapsed(true)}>✕</button>
          </div>
          <div style={{ padding: 8, overflowY: 'auto', maxHeight: 'calc(100vh - 160px)' }}>
            {/* Planetary Entropy */}
            {(() => {
              const entropyVal = entropyHaloRef.current?.getEntropy() || 0;
              const interp = entropyHaloRef.current?.getInterpretation() || 'baseline';
              const pct = Math.round(entropyVal * 100);
              const color = entropyVal < 0.3 ? '#22c55e' : entropyVal < 0.6 ? '#eab308' : entropyVal < 0.9 ? '#FF8C00' : '#ef4444';
              return (
                <>
                  <div style={{ color: '#00ff88', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Planetary Entropy</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 20, fontWeight: 'bold', color }} className={entropyVal >= 0.9 ? 'monitor-entropy-critical' : ''}>{pct}%</span>
                    <span style={{ color, fontSize: 10 }}>{interp.toUpperCase()}</span>
                  </div>
                  <div style={{ width: '100%', height: 8, background: '#1a1a2e', borderRadius: 4, overflow: 'hidden', marginTop: 4 }}>
                    <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.5s ease' }} />
                  </div>
                </>
              );
            })()}

            {/* Active Forks */}
            <div style={{ padding: '8px 0', borderBottom: '1px solid #1a3a2a' }}>
              <div style={{ color: '#00ff88', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                Active Forks <span style={{ marginLeft: 6, color: '#ff8c00', fontSize: 10 }}>({forks.length})</span>
              </div>
              {forks.length === 0 && <div style={{ color: '#666', fontSize: 10 }}>No active forks</div>}
              {forks.map(fork => (
                <div key={fork.forkId} style={{ marginBottom: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                    <span style={{ color: '#ddd' }}>{fork.name}</span>
                    <span style={{ color: fork.status === 'running' ? '#22c55e' : '#eab308' }}>{fork.status}</span>
                  </div>
                  <div style={{ width: '100%', height: 6, background: '#1a1a2e', borderRadius: 4, overflow: 'hidden', marginTop: 2 }}>
                    <div style={{
                      width: `${Math.min(100, fork.divergenceScore * 100)}%`,
                      height: '100%',
                      background: fork.divergenceScore > 0.6 ? '#ef4444' : fork.divergenceScore > 0.3 ? '#eab308' : '#22c55e',
                      borderRadius: 4,
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Reflex Status */}
            <div style={{ padding: '8px 0', borderBottom: '1px solid #1a3a2a' }}>
              <div style={{ color: '#00ff88', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Reflex Status</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                {reflexStates.map(reflex => {
                  const refColors: Record<string, string> = { IDLE: '#22c55e', ARMED: '#eab308', ACTIVE: '#ef4444', RECOVERING: '#6b7280' };
                  return (
                    <div key={reflex.reflexId} style={{ padding: '4px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: 4, textAlign: 'center' }}>
                      <div style={{ fontSize: 8, color: '#888', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {reflex.reflexId.replace(/-/g, '\n')}
                      </div>
                      <div style={{ fontSize: 9, fontWeight: 'bold', color: refColors[reflex.status] || '#666' }}
                        className={reflex.status === 'ACTIVE' ? 'monitor-entropy-critical' : ''}>
                        {reflex.status}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Memory Tiers */}
            <div style={{ padding: '8px 0', borderBottom: '1px solid #1a3a2a' }}>
              <div style={{ color: '#00ff88', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Memory Tiers</div>
              {memoryStats ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', fontSize: 10 }}>
                  {Object.entries(memoryStats).map(([tier, info]) => (
                    <div key={tier} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#888' }}>{tier}</span>
                      <span style={{ color: '#ddd' }}>{(info as any).count ?? 0}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#666', fontSize: 10 }}>Loading...</div>
              )}
            </div>

            {/* Recent Discoveries */}
            <div style={{ padding: '8px 0', borderBottom: '1px solid #1a3a2a' }}>
              <div style={{ color: '#00ff88', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Recent Discoveries</div>
              {recentDiscoveries.length === 0 && <div style={{ color: '#666', fontSize: 10 }}>No discoveries yet</div>}
              {recentDiscoveries.slice(0, 3).map((d, i) => (
                <div key={i} style={{ fontSize: 10, color: '#ccc', marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{d.summary}</span>
                  <span style={{ color: d.confidence > 0.7 ? '#22c55e' : d.confidence > 0.4 ? '#eab308' : '#ef4444', marginLeft: 6, flexShrink: 0 }}>
                    {Math.round(d.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>

            {/* Last Dream Cycle */}
            <div style={{ padding: '8px 0' }}>
              <div style={{ color: '#00ff88', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Last Dream Cycle</div>
              {lastDream ? (
                <div style={{ fontSize: 10, color: '#ccc' }}>
                  <div>Scenarios: <span style={{ color: '#ddd' }}>{lastDream.scenariosRun}</span></div>
                  <div>Model updates: <span style={{ color: '#ddd' }}>{lastDream.modelUpdates}</span></div>
                  <div>New edges: <span style={{ color: '#ddd' }}>{lastDream.newCausalEdges}</span></div>
                  <div style={{ color: '#666', fontSize: 9, marginTop: 2 }}>{new Date(lastDream.timestamp).toLocaleString()}</div>
                </div>
              ) : (
                <div style={{ color: '#666', fontSize: 10 }}>No dream cycle recorded</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Login Modal */}
      <LoginModal />

      {/* Scenario Gallery */}
      {showScenarioGallery && (
        <ScenarioGallery
          scenarios={scenarioGalleryScenarios}
          onSelect={(id) => { setSelectedScenarioId(id); setShowScenarioGallery(false); }}
          onCreateNew={() => { setShowScenarioGallery(false); setShowScenarioEditor(true); }}
          onClose={() => setShowScenarioGallery(false)}
        />
      )}

      {/* Scenario Viewer */}
      {selectedScenario && (
        <ScenarioViewer
          viewer={viewerRef.current}
          scenario={selectedScenario}
          onClose={() => setSelectedScenario(null)}
          onBack={() => { setSelectedScenario(null); setShowScenarioEditor(true); }}
        />
      )}

      {/* Scenario Editor (always mounted to preserve state) */}
      <div style={{ display: showScenarioEditor ? '' : 'none' }}>
        <ScenarioEditor
          onClose={() => setShowScenarioEditor(false)}
          onGenerateFromBbox={async (hazardType, bbox, params) => {
            setShowScenarioEditor(false);
            try {
              const resp = await fetch('/api/scenarios/generate-from-bbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ hazardType, bbox, params }),
              });
              if (!resp.ok) throw new Error(resp.status === 401 ? 'Not logged in' : 'Generation failed');
              const data = await resp.json();
              if (data.scenario) setSelectedScenario(adaptScenario(data.scenario));
            } catch (err: any) {
              setAiMessages(prev => [...prev, { id: Date.now(), role: 'assistant', content: `⚠️ Real-data scenario failed: ${err.message}`, type: 'error' }]);
            }
          }}
          onImport={(scenario) => {
            setShowScenarioEditor(false);
            setSelectedScenario(scenario);
          }}
          studyAreas={studyAreas}
          activeStudyAreaId={activeStudyAreaId}
        />
      </div>

      {/* Cinematic Director */}
      {showCinematicDirector && (
        <CinematicDirector
          viewer={viewerRef.current}
          onClose={() => setShowCinematicDirector(false)}
        />
      )}

      {/* Spatial Sketching */}
      {showSpatialSketching && (
        <SpatialSketching
          viewer={viewerRef.current}
          onClose={() => setShowSpatialSketching(false)}
          onGenerateScenario={(type, params) => {
            setShowSpatialSketching(false);
            const mappedParams = mapFrontendParams(type, params);
            fetch('/api/scenarios/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeaders() },
              body: JSON.stringify({ type, params: mappedParams }),
            }).then(r => {
              if (!r.ok) throw new Error(r.status === 401 ? 'Not logged in' : 'Generation failed');
              return r.json();
            }).then(data => {
              if (data.scenario) setSelectedScenario(adaptScenario(data.scenario));
            }).catch(err => {
              setAiMessages(prev => [...prev, { id: Date.now(), role: 'assistant', content: `⚠️ Scenario generation failed: ${err.message}`, type: 'error' }]);
            });
          }}
        />
      )}

      {/* Admin Dashboard */}
      {showAdmin && <AdminDashboard onClose={() => setShowAdmin(false)} />}
    </div>
  );
}
