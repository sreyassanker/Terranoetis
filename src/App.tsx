/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cctv, Camera, Monitor, Eye, Brain, Search as SearchIcon, Activity, Crosshair, Network, Bot, BarChart3, Share2, Key, Wrench, Save, Cog, Flame, Clapperboard, Film, Pencil, Navigation2, Satellite, Timer, RefreshCw, History, Plus, Upload, AlertTriangle, ClipboardList, CheckCircle, Loader, XCircle, Hourglass, MessageCircle, ChevronDown, ChevronRight, Package, Mic, Square, Send, Paperclip, Image, FileSpreadsheet, Volume2, Link, Grid, Circle, DollarSign, Target, ThumbsUp, ThumbsDown, Database, Radio, MapPin, Globe, Newspaper, Moon, Mountain, X, ChevronLeft, Ruler, Clock, Play, Pause, SkipBack, Thermometer, Shield, Plane, FlaskConical, RotateCcw, Trash2, FileDown, Layers, Rocket } from 'lucide-react';
import DOMPurify from 'dompurify';
import { useWebSocket } from '@/hooks/useWebSocket';
import LoginModal from '@/components/LoginModal';
import { formatIST, formatISTTime, getTimezone, timezoneLabel } from '@/lib/formatTime';
import AdminDashboard from '@/pages/AdminDashboard';
import { useAuth, authHeaders } from '@/context/AuthContext';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { apiGet } from '@/lib/api';
import * as satellite from 'satellite.js';
import StudyAreaPanel from '@/components/ui/StudyAreaPanel';
import { CameraControls } from '@/components/CameraControls';
import type { StudyAreaItem } from '@/rendering/studyArea';
import { throttledRender } from '@/lib/throttledRender';
import { useChatStore } from '@/store/chatStore';
import { useUserPrefStore } from '@/store/userPrefStore';
import { ChatPanel } from '@/components/chat';
import type { VirtualizedMessageListHandle } from '@/components/chat/VirtualizedMessageList';
import { useCollaboration } from '@/hooks/useCollaboration';
import { useOfflineChat } from '@/hooks/useOfflineChat';
import { useChat } from '@/hooks/useChat';
import { useRealtimeVoice } from '@/hooks/useRealtimeVoice';
import {
  removeStudyAreaFromGlobe, setStudyAreaVisibility,
  flyToStudyAreaTopDown, filterDataEntitiesByStudyArea, updateStudyAreaStyle,
  setStudyAreaActive, computeStudyAreaBbox, restoreHiddenEntities, getStudyAreaOuterRings,
} from '@/rendering/studyArea';
import { addBaseImagery, applyTerrainProvider, replaceBaseImagery } from '@/viewer/viewer.config';
import { cinematicFlyTo, createEntityTracker, type TrackEntityType } from '@/viewer/camera.controller';
import { addEarthquakeEntity, type UsgsFeature } from '@/rendering/earthquakes';
import { loadTectonicPlates } from '@/rendering/tectonic';
import { FlightDeadReckoning, altitudeBandColor, getPlaneIcon, parseFlightState } from '@/rendering/flights';
import { AisVesselTracker } from '@/rendering/ais';
import { GhostProtocol } from '@/rendering/ghostProtocol';
import { ForkRenderer } from '@/rendering/forkRenderer';
import { EntropyHalo } from '@/rendering/entropyHalo';
import { OracleChainRenderer, type CausalChainLink } from '@/rendering/oracleChains';
import { interpolateIDW } from '@/rendering/idwInterpolation';
import type { InterpGrid } from '@/rendering/idwInterpolation';
import { extractPointsFromResult } from '@/rendering/toolResultParser';
import { showInterpSurface, clearInterpSurface, getViewDependentResolution, getCurrentGrid, probeGridValue, legendGradientCSS } from '@/rendering/surfaceRenderer';
import { COLORMAPS } from '@/components/kaggle/shared';
import {
  loadAirspaces,
  addSpaceDebrisEntities,
  addNasaDsnEntities,
  addLightningEntities,
  addAuroraEntities,
  loadSubmarineCablesDataSource,
  addElectricityGridEntities,
  addEuGasStorageEntities,
  addGroundClampedRing,
  addAnimalMigrationEntities,
  getDebrisOrbitPositions
} from '@/rendering/domainLayers';
import { fetchAndStoreSatnogsData, getSatnogsForNorad, addSatnogsEntities } from '@/rendering/satnogs';
import { fetchAndStoreUcsData, getUcsForNorad, addUcsEntities } from '@/rendering/ucsSatelliteDb';
import { HumanOverrideBanner } from '@/components/explainability/index';

import { CognitiveDashboard, MultiHazardPanel, MemoryExplorer, SettingsPanel } from '@/components/cockpit/index';
import { ApiVault } from '@/components/ui/ApiVault';
import Panel from '@/components/ui/Panel';
import ScenarioEditor from '@/components/scenarios/ScenarioEditor';
import KaggleFloodOverlay from '@/components/KaggleFloodOverlay';
import KaggleLandslideOverlay from '@/components/KaggleLandslideOverlay';
import KaggleEarthquakeOverlay from '@/components/KaggleEarthquakeOverlay';
import KaggleHurricaneOverlay from '@/components/KaggleHurricaneOverlay';
import KaggleWildfireOverlay from '@/components/KaggleWildfireOverlay';
import KaggleVolcanoOverlay from '@/components/KaggleVolcanoOverlay';
import KaggleTsunamiOverlay from '@/components/KaggleTsunamiOverlay';
import ScenarioGallery from '@/components/scenarios/ScenarioGallery';
import CinematicDirector from '@/components/scenarios/CinematicDirector';
import SpatialSketching from '@/components/scenarios/SpatialSketching';
import PerformanceMonitor from '@/components/PerformanceMonitor';
import { IssTravelView } from '@/components/IssTravelView';
import { FlightTravelView } from '@/components/FlightTravelView';
import { CommandPalette } from '@/components/CommandPalette';
import { AnalyticsWorkbench } from '@/components/AnalyticsWorkbench';
import type { StudyAreaDrawType } from '@/components/ToolDialog';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { createRenderScheduler } from '@/lib/batchScheduler';
import { createUnifiedTimer } from '@/lib/unifiedTimer'; // P0 perf: unified timer
import { SensorStyles, SENSOR_STYLES, type SensorStyleId } from '@/rendering/sensorStyles';
import SensorStyleWidget from '@/components/SensorStyleWidget';
import { TomTomTrafficLayer } from '@/rendering/tomtomTraffic';
import { FirstRunCard } from '@/components/FirstRunCard';
import { isFirstRun, markFirstRunDone, type FirstRunMission } from '@/lib/firstRun';
import { fetchWalkingRoute, drawRouteOnGlobe, flyRoute } from '@/rendering/osrmRoute';
import { DetectionOverlay } from '@/rendering/detectionOverlay';
import { CctvViewshed, type ViewshedCamera } from '@/rendering/cctvViewshed';
import { AircraftHangar } from '@/rendering/aircraftHangar';
import { PhotorealisticGlobe } from '@/rendering/photorealisticGlobe';
import { CinematicCamera } from '@/rendering/cinematicCamera';
import { loadOsmBuildings, hideOsmBuildings, removeOsmBuildings, getOsmBuildingsTileset } from '@/rendering/osmBuildings';
import {
  addOpenFlightsEntities,
  addMilitaryFlightEntities,
  addUcdpEntities,
  type UcdpEvent,
  addMilitaryBaseEntities,
} from '@/rendering/aviation';
import {
  routeBetween, computeSafestLocation, drawNavPolyline, drawNavMarker, drawNavIso,
  facilityLabel, type RouteResult, type SafeFacility, type SafestResult,
} from '@/rendering/navigation';
import {
  addGenericPointEntities,
  addStormTrackEntities,
  addDroughtZoneEntities,
  addRadarSiteEntities,
  addClimateIndicesEntities,
} from '@/rendering/weather';
import { renderLayer, fetchLayerData } from '@/rendering/layerRenderer';
import { LAYER_GROUPS, LAYER_CATEGORIES, LEGACY_DEFAULTS } from '@/lib/layerConfig';
import { listChats, getChat, saveChat, deleteChat, generateChatId, autoTitle, groupChatsByDate, type ChatSession, type ChatListItem, type ChatMessage, type ToolEvent, type PlanCard } from '@/lib/chatStore';
import { StreamingMarkdownRenderer, extractArtifacts, fetchSuggestions, fetchTiers, resumeStream, generatePlanClient, type SuggestionContextClient } from '@/lib/advancedChat';
import { exportConversationAsPDF } from '@/lib/pdfReport';
import { formatSci } from '@/lib/formatSci';
import { PlanCardView, SubAgentActivityView, ArtifactView, ToolApprovalView, ModelTierSelector, TraceExpander, VoiceModeIndicator } from '@/components/chat/AdvancedChatViews';

/* ═════════════════════════════════════════════════════════════════
   LAZY PANELS
   Panels are heavy (Cesium rendering, live-data polling) and only ever
   opened on demand. Loading them lazily keeps them out of the initial
   bundle — the first paint ships without several MB of panel code and
   each chunk only downloads when the user opens that panel.
   ═════════════════════════════════════════════════════════════════ */

const LazyAviationTrackerPanel = lazy(() => import('@/components/prithvi/AviationTrackerPanel').then(m => ({ default: m.AviationTrackerPanel })));
const LazyChatHistoryPanel = lazy(() => import('@/components/chat/ChatHistoryPanel').then(m => ({ default: m.ChatHistoryPanel })));
const LazyForkPanel = lazy(() => import('@/components/ForkPanel').then(m => ({ default: m.ForkPanel })));
const LazyMarketIntelPanel = lazy(() => import('@/components/MarketIntelPanel').then(m => ({ default: m.MarketIntelPanel })));
const LazyIssLivePanel = lazy(() => import('@/components/IssLivePanel').then(m => ({ default: m.IssLivePanel })));
const LazyLandCoverMapperPanel = lazy(() => import('@/components/LandCoverMapperPanel').then(m => ({ default: m.LandCoverMapperPanel })));
const LazyLaunchReplayPanel = lazy(() => import('@/components/LaunchReplayPanel').then(m => ({ default: m.LaunchReplayPanel })));
const LazyRadioTunerPanel = lazy(() => import('@/components/RadioTunerPanel').then(m => ({ default: m.RadioTunerPanel })));
const LazySatelliteImageryPanel = lazy(() => import('@/components/ui/SatelliteImageryPanel'));
const LazySatelliteTrackerPanel = lazy(() => import('@/components/prithvi/SatelliteTrackerPanel').then(m => ({ default: m.SatelliteTrackerPanel })));
const LazyDuckdbAnalyticsPanel = lazy(() => import('@/components/DuckdbAnalyticsPanel').then(m => ({ default: m.DuckdbAnalyticsPanel })));

/** Suspense boundary for the lazy panels — a silent null keeps the layout
 *  stable while a panel chunk loads (panels render after user interaction,
 *  so there is no visible flicker). */
function PanelSuspense({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

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

interface IntelFeedItem {
  id: string; title: string; source: string; type: string;
  lat: number; lon: number; timestamp: number; timeLabel: string;
  desc?: string;
  url?: string;
  platform?: 'internal' | 'news' | 'twitter' | 'facebook' | 'social';
}

interface HeatmapPoint { lon: number; lat: number; count: number; }

interface CesiumWindow extends Window {
  Cesium?: typeof Cesium;
  __terranoetisDebug?: Record<string, unknown>;
}
declare const window: CesiumWindow;

type AiProvider = 'gemini' | 'anthropic' | 'local';

/** Full API vault — dynamic flat key map loaded from the server.
 *  The server has 83+ VAULT_KEY_NAMES; the client stores them all here
 *  so the ApiVault dialog can show pre-filled values for every provider. */
interface ApiVaultState {
  /** All provider keys as a flat Record<ENV_KEY, value>. */
  keys: Record<string, string>;
  preferredAiProvider: AiProvider;
  vaultDismissed: boolean;
}

let cachedCctvCanvas: HTMLCanvasElement | null = null;
const cachedCctvCanvases = new Map<string, HTMLCanvasElement>();

const CCTV_FEED_COLORS: Record<string, string> = {
  m3u8: '#22c55e',
  mjpeg: '#22c55e',
  image: '#f59e0b',
  iframe: '#ec4899',
};
const CCTV_UNKNOWN_COLOR = '#64748b';

function cctvFeedColor(meta: Record<string, unknown>): string {
  const feedType = String(meta.feedType ?? '').toLowerCase();
  if (CCTV_FEED_COLORS[feedType]) return CCTV_FEED_COLORS[feedType];
  const url = String(meta.previewUrl ?? meta.streamUrl ?? '');
  if (/\.m3u8(\?|$)/i.test(url)) return CCTV_FEED_COLORS.m3u8;
  if (/\.mjpeg|\.mjpg|multipart/i.test(url)) return CCTV_FEED_COLORS.mjpeg;
  if (/youtube\.com\/(watch|embed)|youtu\.be|player\./i.test(url)) return CCTV_FEED_COLORS.iframe;
  if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) return CCTV_FEED_COLORS.image;
  return CCTV_UNKNOWN_COLOR;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
let cachedYoutubeCanvas: HTMLCanvasElement | null = null;

function extractYoutubeId(url?: string): string | undefined {
  if (!url) return;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v') || undefined;
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || undefined;
  } catch { /* */ }
}

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

// Static/reference layers: tile/3dtiles/effect/panel imagery + fixed geodata.
// The camera does NOT fly to these when toggled on.
const STATIC_LAYER_IDS = new Set<string>([
  ...LAYER_CATEGORIES.filter(l => ['tile','3dtiles','effect','panel'].includes(l.type)).map(l => l.id),
  'tectonic','airports','airspaces','submarine_cables','eu_gas_storage',
  'radio_stations','bikeshare','military_bases','electricity_grid','16_macrostrat','16_pbdb',
  'population_impact','disaster_near_me','tomtom_traffic','animal_migrations','live_media',
  'detection_overlay','smoke_dispersion',
]);

const LEGACY_VAULT_KEYS = 'terranoetis.apiKeys.v1';
const LEGACY_VAULT_STATE = 'terranoetis.apiVault.v1';
const SESSION_VAULT_KEY = 'worldmonitor.vault.v1';
const CESIUM_ION_ENV_TOKEN = (import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN as string | undefined)?.trim() ?? '';

const DEFAULT_API_VAULT: ApiVaultState = {
  keys: {},
  preferredAiProvider: 'gemini',
  vaultDismissed: false,
};

interface LocalSearchResult {
  name: string;
  lat: number;
  lon: number;
}

interface WeatherCardData {
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

// Static anchor seeds for search/geo-extraction and as the pre-live-load
// snapshot: the 50 largest urban agglomerations, UN World Urbanization
// Prospects 2018 metro ranking (population in millions, city-centre coords).
// Once the population-impact layer fetches live data from the server
// (Open-Meteo Geocoding / GeoNames), `livePopulationCities` replaces this.
let livePopulationCities: Array<{ name: string; country: string; pop: number; lat: number; lon: number }> = [];
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

const EXTRA_GEO: Array<{ name: string; lat: number; lon: number }> = [
  { name: 'Afghanistan', lat: 33.9391, lon: 67.7100 },
  { name: 'Algeria', lat: 28.0339, lon: 1.6596 },
  { name: 'Angola', lat: -11.2027, lon: 17.8739 },
  { name: 'Argentina', lat: -38.4161, lon: -63.6167 },
  { name: 'Australia', lat: -25.2744, lon: 133.7751 },
  { name: 'Bangladesh', lat: 23.6850, lon: 90.3563 },
  { name: 'Bolivia', lat: -16.2902, lon: -63.5887 },
  { name: 'Botswana', lat: -22.3285, lon: 24.6849 },
  { name: 'Brazil', lat: -14.2350, lon: -51.9253 },
  { name: 'Cambodia', lat: 12.5657, lon: 104.9910 },
  { name: 'Cameroon', lat: 7.3697, lon: 12.3547 },
  { name: 'Canada', lat: 56.1304, lon: -106.3468 },
  { name: 'Chad', lat: 15.4542, lon: 18.7322 },
  { name: 'Chile', lat: -35.6751, lon: -71.5430 },
  { name: 'Colombia', lat: 4.5709, lon: -74.2973 },
  { name: 'Congo', lat: -4.0383, lon: 21.7587 },
  { name: 'Croatia', lat: 45.1000, lon: 15.2000 },
  { name: 'Cuba', lat: 21.5218, lon: -77.7812 },
  { name: 'Czech Republic', lat: 49.8175, lon: 15.4730 },
  { name: 'DR Congo', lat: -4.0383, lon: 21.7587 },
  { name: 'Ecuador', lat: -1.8312, lon: -78.1834 },
  { name: 'Egypt', lat: 26.8206, lon: 30.8025 },
  { name: 'Ethiopia', lat: 9.1450, lon: 40.4897 },
  { name: 'Fiji', lat: -17.7134, lon: 178.0650 },
  { name: 'France', lat: 46.6034, lon: 1.8883 },
  { name: 'Germany', lat: 51.1657, lon: 10.4515 },
  { name: 'Ghana', lat: 7.9465, lon: -1.0232 },
  { name: 'Greece', lat: 39.0742, lon: 21.8243 },
  { name: 'Guatemala', lat: 15.7835, lon: -90.2308 },
  { name: 'Haiti', lat: 18.9712, lon: -72.2852 },
  { name: 'Hungary', lat: 47.1625, lon: 19.5033 },
  { name: 'Iceland', lat: 64.9631, lon: -19.0208 },
  { name: 'India', lat: 20.5937, lon: 78.9629 },
  { name: 'Indonesia', lat: -0.7893, lon: 113.9213 },
  { name: 'Iran', lat: 32.4279, lon: 53.6880 },
  { name: 'Iraq', lat: 33.3152, lon: 44.3661 },
  { name: 'Ireland', lat: 53.1424, lon: -7.6921 },
  { name: 'Israel', lat: 31.0461, lon: 34.8516 },
  { name: 'Italy', lat: 41.8719, lon: 12.5674 },
  { name: 'Japan', lat: 36.2048, lon: 138.2529 },
  { name: 'Jordan', lat: 30.5852, lon: 36.2384 },
  { name: 'Kazakhstan', lat: 48.0196, lon: 66.9237 },
  { name: 'Kenya', lat: -0.0236, lon: 37.9062 },
  { name: 'Kuwait', lat: 29.3117, lon: 47.4818 },
  { name: 'Laos', lat: 19.8563, lon: 102.4955 },
  { name: 'Lebanon', lat: 33.8547, lon: 35.8623 },
  { name: 'Libya', lat: 26.3351, lon: 17.2283 },
  { name: 'Madagascar', lat: -18.7669, lon: 46.8691 },
  { name: 'Malaysia', lat: 4.2105, lon: 101.9758 },
  { name: 'Mali', lat: 17.5707, lon: -3.9962 },
  { name: 'Mexico', lat: 23.6345, lon: -102.5528 },
  { name: 'Mongolia', lat: 46.8625, lon: 103.8467 },
  { name: 'Morocco', lat: 31.7917, lon: -7.0926 },
  { name: 'Myanmar', lat: 21.9162, lon: 95.9560 },
  { name: 'Nepal', lat: 28.3949, lon: 84.1240 },
  { name: 'Netherlands', lat: 52.1326, lon: 5.2913 },
  { name: 'New Zealand', lat: -40.9006, lon: 174.8860 },
  { name: 'Nicaragua', lat: 12.8654, lon: -85.2072 },
  { name: 'Niger', lat: 17.6078, lon: 8.0817 },
  { name: 'Nigeria', lat: 9.0820, lon: 8.6753 },
  { name: 'North Korea', lat: 40.3399, lon: 127.5101 },
  { name: 'Norway', lat: 60.4720, lon: 8.4689 },
  { name: 'Oman', lat: 21.5126, lon: 55.9233 },
  { name: 'Pakistan', lat: 30.3753, lon: 69.3451 },
  { name: 'Panama', lat: 8.5380, lon: -80.7821 },
  { name: 'Papua New Guinea', lat: -6.3150, lon: 143.9555 },
  { name: 'Paraguay', lat: -23.4425, lon: -58.4438 },
  { name: 'Peru', lat: -9.1900, lon: -75.0152 },
  { name: 'Philippines', lat: 12.8797, lon: 121.7740 },
  { name: 'Poland', lat: 51.9194, lon: 19.1451 },
  { name: 'Portugal', lat: 39.3999, lon: -8.2245 },
  { name: 'Qatar', lat: 25.3548, lon: 51.1839 },
  { name: 'Romania', lat: 45.9432, lon: 24.9668 },
  { name: 'Russia', lat: 61.5240, lon: 105.3188 },
  { name: 'Rwanda', lat: -1.9403, lon: 29.8739 },
  { name: 'Saudi Arabia', lat: 23.8859, lon: 45.0792 },
  { name: 'Senegal', lat: 14.4974, lon: -14.4524 },
  { name: 'Serbia', lat: 44.0165, lon: 21.0059 },
  { name: 'Sierra Leone', lat: 8.4606, lon: -11.7799 },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { name: 'Somalia', lat: 5.1521, lon: 46.1996 },
  { name: 'South Africa', lat: -30.5595, lon: 22.9375 },
  { name: 'South Korea', lat: 35.9078, lon: 127.7669 },
  { name: 'South Sudan', lat: 6.8770, lon: 31.3070 },
  { name: 'Spain', lat: 40.4637, lon: -3.7492 },
  { name: 'Sri Lanka', lat: 7.8731, lon: 80.7718 },
  { name: 'Sudan', lat: 12.8628, lon: 30.2176 },
  { name: 'Sweden', lat: 60.1282, lon: 18.6435 },
  { name: 'Switzerland', lat: 46.8182, lon: 8.2275 },
  { name: 'Syria', lat: 34.8021, lon: 38.9968 },
  { name: 'Taiwan', lat: 23.6978, lon: 120.9605 },
  { name: 'Tajikistan', lat: 38.8610, lon: 71.2761 },
  { name: 'Tanzania', lat: -6.3690, lon: 34.8888 },
  { name: 'Thailand', lat: 15.8700, lon: 100.9925 },
  { name: 'Tunisia', lat: 33.8869, lon: 9.5375 },
  { name: 'Turkey', lat: 38.9637, lon: 35.2433 },
  { name: 'Turkmenistan', lat: 38.9697, lon: 59.5563 },
  { name: 'Uganda', lat: 1.3733, lon: 32.2903 },
  { name: 'Ukraine', lat: 48.3794, lon: 31.1656 },
  { name: 'United Arab Emirates', lat: 23.4241, lon: 53.8478 },
  { name: 'United Kingdom', lat: 55.3781, lon: -3.4360 },
  { name: 'USA', lat: 39.8283, lon: -98.5795 },
  { name: 'Uruguay', lat: -32.5228, lon: -55.7658 },
  { name: 'Uzbekistan', lat: 41.3775, lon: 64.5853 },
  { name: 'Venezuela', lat: 6.4238, lon: -66.5897 },
  { name: 'Vietnam', lat: 14.0583, lon: 108.2772 },
  { name: 'Yemen', lat: 15.5527, lon: 48.5164 },
  { name: 'Zambia', lat: -13.1339, lon: 27.8493 },
  { name: 'Zimbabwe', lat: -19.0154, lon: 29.1549 },
  { name: 'Alabama', lat: 32.3182, lon: -86.9023 },
  { name: 'Alaska', lat: 64.2008, lon: -149.4937 },
  { name: 'Arizona', lat: 34.0489, lon: -111.0937 },
  { name: 'Arkansas', lat: 34.7465, lon: -92.2896 },
  { name: 'California', lat: 36.7783, lon: -119.4179 },
  { name: 'Colorado', lat: 39.5501, lon: -105.7821 },
  { name: 'Connecticut', lat: 41.6032, lon: -73.0877 },
  { name: 'Delaware', lat: 38.9108, lon: -75.5277 },
  { name: 'Florida', lat: 27.6648, lon: -81.5158 },
  { name: 'Georgia', lat: 32.1656, lon: -82.9001 },
  { name: 'Hawaii', lat: 19.8968, lon: -155.5828 },
  { name: 'Idaho', lat: 44.0682, lon: -114.7420 },
  { name: 'Illinois', lat: 40.6331, lon: -89.3985 },
  { name: 'Indiana', lat: 40.2672, lon: -86.1349 },
  { name: 'Iowa', lat: 41.8780, lon: -93.0977 },
  { name: 'Kansas', lat: 39.0119, lon: -98.4842 },
  { name: 'Kentucky', lat: 37.8393, lon: -84.2700 },
  { name: 'Louisiana', lat: 30.9843, lon: -91.9623 },
  { name: 'Maine', lat: 45.2538, lon: -69.4455 },
  { name: 'Maryland', lat: 39.0458, lon: -76.6413 },
  { name: 'Massachusetts', lat: 42.4072, lon: -71.3824 },
  { name: 'Michigan', lat: 44.3148, lon: -85.6024 },
  { name: 'Minnesota', lat: 46.7296, lon: -94.6859 },
  { name: 'Mississippi', lat: 32.3547, lon: -89.3985 },
  { name: 'Missouri', lat: 37.9643, lon: -91.8318 },
  { name: 'Montana', lat: 46.8797, lon: -110.3626 },
  { name: 'Nebraska', lat: 41.4925, lon: -99.9018 },
  { name: 'Nevada', lat: 38.8026, lon: -116.4194 },
  { name: 'New Hampshire', lat: 43.1939, lon: -71.5724 },
  { name: 'New Jersey', lat: 40.0583, lon: -74.0057 },
  { name: 'New Mexico', lat: 34.5199, lon: -105.8701 },
  { name: 'New York', lat: 43.2994, lon: -74.2179 },
  { name: 'North Carolina', lat: 35.7596, lon: -79.0193 },
  { name: 'North Dakota', lat: 47.5515, lon: -101.0020 },
  { name: 'Ohio', lat: 40.4173, lon: -82.9071 },
  { name: 'Oklahoma', lat: 35.0078, lon: -97.0929 },
  { name: 'Oregon', lat: 43.8041, lon: -120.5542 },
  { name: 'Pennsylvania', lat: 41.2033, lon: -77.1945 },
  { name: 'Rhode Island', lat: 41.5801, lon: -71.4774 },
  { name: 'South Carolina', lat: 33.8361, lon: -81.1637 },
  { name: 'South Dakota', lat: 43.9695, lon: -99.9018 },
  { name: 'Tennessee', lat: 35.5175, lon: -86.5804 },
  { name: 'Texas', lat: 31.9686, lon: -99.9018 },
  { name: 'Utah', lat: 39.3210, lon: -111.0937 },
  { name: 'Vermont', lat: 44.5588, lon: -72.5778 },
  { name: 'Virginia', lat: 37.4316, lon: -78.6569 },
  { name: 'Washington', lat: 47.7511, lon: -120.7401 },
  { name: 'West Virginia', lat: 38.5976, lon: -80.4549 },
  { name: 'Wisconsin', lat: 43.7844, lon: -88.7879 },
  { name: 'Wyoming', lat: 42.7560, lon: -107.3025 },
  { name: 'Middle East', lat: 26.0, lon: 45.0 },
  { name: 'Central America', lat: 12.0, lon: -86.0 },
  { name: 'Southeast Asia', lat: 12.0, lon: 105.0 },
  { name: 'South Asia', lat: 22.0, lon: 80.0 },
  { name: 'Central Asia', lat: 45.0, lon: 68.0 },
  { name: 'West Africa', lat: 10.0, lon: -5.0 },
  { name: 'East Africa', lat: -2.0, lon: 37.0 },
  { name: 'Southern Africa', lat: -25.0, lon: 25.0 },
  { name: 'North Africa', lat: 28.0, lon: 5.0 },
  { name: 'Scandinavia', lat: 62.0, lon: 15.0 },
  { name: 'Balkans', lat: 43.0, lon: 22.0 },
  { name: 'Caucasus', lat: 42.0, lon: 44.0 },
  { name: 'Horn of Africa', lat: 5.0, lon: 47.0 },
  { name: 'Sahel', lat: 15.0, lon: 5.0 },
  { name: 'Maghreb', lat: 30.0, lon: 2.0 },
  { name: 'Levant', lat: 33.0, lon: 36.0 },
  { name: 'Gulf', lat: 26.0, lon: 52.0 },
  { name: 'Arctic', lat: 75.0, lon: -100.0 },
  { name: 'Antarctica', lat: -75.0, lon: 0.0 },
  { name: 'Atlantic', lat: 30.0, lon: -40.0 },
  { name: 'Pacific', lat: 0.0, lon: -160.0 },
  { name: 'Indian Ocean', lat: -20.0, lon: 80.0 },
  { name: 'Mediterranean', lat: 36.0, lon: 18.0 },
  { name: 'Caribbean', lat: 18.0, lon: -72.0 },
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

function loadApiVault(): ApiVaultState {
  if (typeof window === 'undefined') return DEFAULT_API_VAULT;
  try {
    const cached = window.localStorage.getItem(SESSION_VAULT_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<ApiVaultState>;
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_API_VAULT, ...parsed, keys: parsed.keys || {} };
      }
    }
    // One-time migration: check old sessionStorage for vault data
    try {
      const oldSession = window.sessionStorage.getItem(SESSION_VAULT_KEY);
      if (oldSession) {
        const old = JSON.parse(oldSession) as Record<string, unknown>;
        if (old && typeof old === 'object') {
          // Migrate old format (individual fields) to new flat keys format
          const migratedKeys: Record<string, string> = {};
          if ((old as Record<string, string>).gemini) migratedKeys.GOOGLE_GEMINI_API_KEY = (old as Record<string, string>).gemini;
          if ((old as Record<string, string>).anthropic) migratedKeys.ANTHROPIC_API_KEY = (old as Record<string, string>).anthropic;
          if ((old as Record<string, string>).cesiumIonAccessToken) migratedKeys.CESIUM_ION_ACCESS_TOKEN = (old as Record<string, string>).cesiumIonAccessToken;
          if (Object.keys(migratedKeys).length > 0) {
            const migrated = { keys: migratedKeys, preferredAiProvider: 'gemini' as AiProvider, vaultDismissed: Boolean((old as Record<string, unknown>).vaultDismissed) };
            window.localStorage.setItem(SESSION_VAULT_KEY, JSON.stringify(migrated));
            window.sessionStorage.removeItem(SESSION_VAULT_KEY);
            return migrated;
          }
        }
      }
    } catch { /* ignore */ }
  } catch { /* ignore */ }
  return DEFAULT_API_VAULT;
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
  return Object.values(vault.keys).some(v => typeof v === 'string' && v.trim() !== '');
}

function resolveAiProvider(vault: ApiVaultState): AiProvider {
  const geminiKey = (vault.keys.GOOGLE_GEMINI_API_KEY || vault.keys.GEMINI_API_KEY || '').trim();
  const anthropicKey = (vault.keys.ANTHROPIC_API_KEY || '').trim();
  if (vault.preferredAiProvider === 'anthropic' && anthropicKey) return 'anthropic';
  if (vault.preferredAiProvider === 'gemini' && geminiKey) return 'gemini';
  if (geminiKey) return 'gemini';
  if (anthropicKey) return 'anthropic';
  return 'local';
}

function resolveCesiumIonToken(vault: ApiVaultState): string | undefined {
  const t = (vault.keys.CESIUM_ION_ACCESS_TOKEN || '').trim();
  if (t) return t;
  return CESIUM_ION_ENV_TOKEN || undefined;
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

function calculatePopulationImpact(lat: number, lon: number) {
  const pool = livePopulationCities.length ? livePopulationCities : CITY_DATA;
  const affected = pool.filter(c => {
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

const ISS_LIVE_EMBED = 'https://www.youtube.com/embed/awQzjn72bI0?autoplay=1&rel=0';

const YoutubePlayer = ({ videoId, src }: { videoId?: string; src?: string }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState(false);

  if (error) {
    return <div className="cctv-preview-empty">Failed to load YouTube video</div>;
  }

  const embedSrc = src ?? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;

  return (
    <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', background: '#000', borderRadius: 6, overflow: 'hidden' }}>
      <iframe
        ref={iframeRef}
        src={embedSrc}
        title="YouTube video player"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        onError={() => setError(true)}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
      />
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════
   PHASE 8: Rich message renderer — code blocks, tables, lists
   ═════════════════════════════════════════════════════════════════ */

const RICH_MESSAGE_CACHE = new Map<string, string>();
const RICH_MESSAGE_CACHE_MAX = 200;

const TYPE_LABELS: Record<string, string> = {
  earthquake_swarm: 'Earthquake Swarm', hurricane_landfall: 'Hurricane Landfall',
  wildfire_spread: 'Wildfire Spread', volcanic_eruption: 'Volcanic Eruption',
  flood_inundation: 'Flood Inundation', tsunami_wave: 'Tsunami Wave',
  landslide: 'Landslide',
  data_layer: 'Data Layer',
};

function adaptScenario(raw: any): any {
  const severity = raw.validationScore > 0.8 ? 'extreme' : raw.validationScore > 0.6 ? 'high' : raw.validationScore > 0.4 ? 'medium' : 'low';
  const lat = raw.params?.lat ?? raw.params?.epicenterLat ?? 0;
  const lon = raw.params?.lon ?? raw.params?.epicenterLon ?? 0;
  return {
    id: raw.id,
    type: raw.type,
    name: (raw.dataSources?.length ? 'Data: ' : '') + (TYPE_LABELS[raw.type as string] || raw.type),
    pointCloud: raw.pointCloud,
    validationScore: raw.validationScore,
    severity,
    location: { lat, lon },
    timestamp: raw.createdAt,
    timeSeries: raw.timeSeries,
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


function richRender(text: string): string {
  const cached = RICH_MESSAGE_CACHE.get(text);
  if (cached) return cached;

  // Strip ## COMMANDS block — it's only needed for command chips, not visible text
  const readableText = text.replace(/## COMMANDS\n[\s\S]*?(?=\n##|\n*$)/g, '');
  let html = readableText
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
  if (RICH_MESSAGE_CACHE.size > RICH_MESSAGE_CACHE_MAX) RICH_MESSAGE_CACHE.clear();
  RICH_MESSAGE_CACHE.set(text, safe);
  return safe;
}

function renderCommandChips(
  commands: Array<{ action: string; label?: string; lat?: number; lon?: number; layerId?: string }> | undefined,
  focusLocation: (lat: number, lon: number, opts?: Record<string, unknown>) => void,
  toggleLayer: (id: string) => void,
) {
  if (!commands || commands.length === 0) return null;
  const cmdChips: Array<{label:string;action:string;lat?:number;lon?:number;layerId?:string}> = [];
  for (const cmd of commands) {
    if (cmd.action === 'flyTo' && cmd.lat != null && cmd.lon != null) {
      cmdChips.push({ label: cmd.label || 'Fly', action: 'flyTo', lat: cmd.lat, lon: cmd.lon });
    }
    if (cmd.action === 'toggleLayer' && cmd.layerId) {
      cmdChips.push({ label: cmd.layerId, action: 'toggleLayer', layerId: cmd.layerId });
    }
  }
  if (cmdChips.length === 0) return null;
  return (
    <div className="msg-commands" style={{display:'flex',gap:4,marginTop:6,flexWrap:'wrap'}}>
      {cmdChips.map((chip,i) => (
        <span key={i} className="ai-chip command-chip" style={{fontSize:10,padding:'2px 8px'}}
          onClick={() => {
            if (chip.action === 'flyTo' && chip.lat && chip.lon) focusLocation(chip.lat, chip.lon, { label: chip.label || 'Location', color: '#60a5fa', height: 20000 });
            if (chip.action === 'toggleLayer' && chip.layerId) toggleLayer(chip.layerId);
          }}>{chip.label}</span>
      ))}
    </div>
  );
}

/* ── Measure helpers ── */
function greatCircleDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Top bar grouped menu ── */
interface TopbarMenuItem {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}

function TopbarMenu({
  id, title, icon, active, menuId, setMenuId, items, direction = 'down', triggerClassName,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  active?: boolean;
  menuId: string | null;
  setMenuId: (id: string | null) => void;
  items: TopbarMenuItem[];
  direction?: 'down' | 'up';
  triggerClassName?: string;
}) {
  const open = menuId === id;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuId(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, setMenuId]);
  return (
    <div className="topbar-menu" ref={ref}>
      <button
        className={`${triggerClassName ?? 'btn-icon'} ${active || open ? 'active' : ''}`}
        title={title}
        onClick={() => setMenuId(open ? null : id)}
      >
        {icon}
      </button>
      {open && (
        <div className={`topbar-menu-pop ${direction === 'up' ? 'up' : ''}`}>
          {items.map((it, i) => (
            <button
              key={i}
              className={`topbar-menu-item ${it.active ? 'active' : ''}`}
              onClick={() => { it.onClick(); setMenuId(null); }}
            >
              <span className="topbar-menu-item-icon">{it.icon}</span>
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════
   MAIN APP COMPONENT
   ═════════════════════════════════════════════════════════════════ */

/** Compact numeric formatting for the raster legend / value probe (kept small
 *  enough for narrow legend bars; falls back to scientific notation for
 *  extreme magnitudes). */
function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return formatSci(v, 2);
}

/** Resolve a scheme name to the full ColorStop[] used by renderGridToCanvas
 *  and legendGradientCSS. 'default' returns undefined (the renderer's own
 *  DEFAULT_COLORS). */
function schemeToColorStops(scheme: string): { stop: number; r: number; g: number; b: number }[] | undefined {
  if (scheme === 'default') return undefined;
  const cm = COLORMAPS[scheme];
  if (!cm) return undefined;
  return cm.stops;
}

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
  /** Ref synced with toolSurfaceLegend state so Cesium event closures read
   *  the latest value without stale-closure issues. */
  const toolSurfaceLegendRef = useRef<typeof toolSurfaceLegend>(null);
  /** Legend metadata for the current tool-result heatmap surface (grid + unit),
   *  shown as a color-bar legend on the globe (raster map convention). */
  const [toolSurfaceLegend, setToolSurfaceLegend] = useState<{
    label: string; unit?: string;
    valueMin: number; valueMax: number; valueMean: number; valueStd: number; valueMedian: number; finiteCellCount: number;
  } | null>(null);
  /** Raster value probe: the heatmap cell under the cursor while hovering the
   *  tool-result surface on the 3D globe (QGIS identify-tool behaviour). */
  const [toolSurfaceProbe, setToolSurfaceProbe] = useState<{
    x: number; y: number; value: number; lat: number; lon: number;
  } | null>(null);
  /** Active color scheme for the tool-result heatmap surface + legend. */
  const [toolSurfaceScheme, setToolSurfaceScheme] = useState('default');
  /** Whether the hover value-probe is enabled. Off by default so the mouse
   *  never runs the raycast unless the user explicitly turns it on (keeps
   *  zoom/pan fully smooth). */
  const [toolSurfaceProbeEnabled, setToolSurfaceProbeEnabled] = useState(false);
  /** Ref for the MOUSE_MOVE handler to read the toggle without stale closure. */
  const toolSurfaceProbeEnabledRef = useRef(false);
  useEffect(() => { toolSurfaceProbeEnabledRef.current = toolSurfaceProbeEnabled; }, [toolSurfaceProbeEnabled]);
  /** Traffic hover readout — live speed/free-flow/confidence when the cursor
   *  is over a TomTom traffic segment entity. */
  const [trafficHover, setTrafficHover] = useState<{
    x: number; y: number; speed: number; freeFlow: number; confidence: number; lat: number; lon: number;
    length?: number; travelTime?: number; freeFlowTravelTime?: number;
  } | null>(null);
  /** The rendered grid for re-coloring on scheme change. */
  const toolSurfaceGridRef = useRef<InterpGrid | null>(null);
  /** Polyon mask used when the surface was rendered (re-applied on recolor). */
  const toolSurfacePolygonRef = useRef<Array<Array<[number, number]>> | undefined>(undefined);
  useEffect(() => { toolSurfaceLegendRef.current = toolSurfaceLegend; }, [toolSurfaceLegend]);
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
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const [searchBoxRect, setSearchBoxRect] = useState<DOMRect | null>(null);
  const timelineThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineLastUpdateRef = useRef<number>(0);
  const pinCountRef = useRef(0);
  const entityStoreRef = useRef<Record<string, Cesium.Entity[]>>({});
  const layerDataCacheRef = useRef<Record<string, unknown[]>>({});
  const LAYER_CACHE_MAX = 60;
  const magnitudeScaleRef = useRef(1);
  const autoRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRefreshSlowRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastZoomToRef = useRef(0);
  const issEntityRef = useRef<Cesium.Entity | null>(null);
  const issTrailRef = useRef<Cesium.SampledPositionProperty | null>(null);
  const issTimesRef = useRef<Cesium.JulianDate[]>([]);
  const issRenderTickRef = useRef<(() => void) | null>(null);
  const issLoadingRef = useRef(false);
  // ── Satellite Travel View (first-person onboard camera) ──
  const satTravelRef = useRef(false);
  const satTravelPosRef = useRef<Cesium.PositionProperty | null>(null);
  const satTravelNameRef = useRef('');
  const satTravelYawRef = useRef(0);                                  // azimuth around zenith (rad)
  const satTravelPitchRef = useRef(Cesium.Math.toRadians(22));        // depression from nadir (rad)
  const satTravelFovRef = useRef(Cesium.Math.toRadians(60));          // camera field of view (rad)
  const satTravelPreRenderRef = useRef<(() => void) | null>(null);
  const satTravelHudIntRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const satTravelDragRef = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });
  const satTravelDragCleanupRef = useRef<(() => void) | null>(null);
  const satTravelSavedViewRef = useRef<{ pos: Cesium.Cartesian3; hdg: number; pitch: number; roll: number } | null>(null);
  // ── Flight Travel View (separate chase-cam style, distinct from satellite travel) ──
  const flightTravelRef = useRef(false);
  const flightTravelSimRef = useRef<{ lat: number; lon: number; alt: number; velocity: number; heading: number; verticalRate: number; lastUpdate: number } | null>(null);
  const flightTravelNameRef = useRef('');
  const flightTravelIcaoRef = useRef('');
  const flightTravelCallsignRef = useRef('');
  const flightTravelYawRef = useRef(0);                                  // yaw look-offset (rad)
  const flightTravelPitchRef = useRef(Cesium.Math.toRadians(-14));       // chase look pitch (rad)
  const flightTravelFovRef = useRef(Cesium.Math.toRadians(65));
  const flightTravelPreRenderRef = useRef<(() => void) | null>(null);
  const flightTravelHudIntRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flightTravelRefreshIntRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flightTravelDragRef = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });
  const flightTravelDragCleanupRef = useRef<(() => void) | null>(null);
  const flightTravelMarkerRef = useRef<Cesium.Entity | null>(null);
  const flightTravelSavedViewRef = useRef<{ pos: Cesium.Cartesian3; hdg: number; pitch: number; roll: number } | null>(null);
  const flightTravelNearbyEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const flightTravelHiddenEntityRef = useRef<Cesium.Entity | null>(null);
  const trackedSatRef = useRef<Cesium.Entity | null>(null);
  const trackedSatTrailEntityRef = useRef<Cesium.Entity | null>(null);
  const trackedSatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackedSatTleRef = useRef<{ tle1: string; tle2: string } | null>(null);
  const trackedSatRenderTickRef = useRef<(() => void) | null>(null);
  const trackedSatPosPropRef = useRef<Cesium.SampledPositionProperty | null>(null);
  const trackedSatSpeedRef = useRef(0);
  const trackedSatNameRef = useRef('');
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const intelFeedRef = useRef<IntelFeedItem[]>([]);
  const notificationTimeoutsRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const populationImpactLayerRef = useRef<Cesium.Entity[]>([]);
  const weatherCardElementsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const weatherAbortRef = useRef<AbortController | null>(null);
  const focusMarkerRef = useRef<Cesium.Entity | null>(null);
  const focusMarkerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flightDrRef = useRef<FlightDeadReckoning | null>(null);
  const adsbLolDrRef = useRef<FlightDeadReckoning | null>(null);
  const adsbFiDrRef = useRef<FlightDeadReckoning | null>(null);
  const airlabsDrRef = useRef<FlightDeadReckoning | null>(null);
  const aisTrackerRef = useRef<AisVesselTracker | null>(null);
  const ghostProtocolRef = useRef<GhostProtocol | null>(null);
  const entropyHaloRef = useRef<EntropyHalo | null>(null);
  const oracleChainRef = useRef<OracleChainRenderer | null>(null);
  const entityTrackerRef = useRef<ReturnType<typeof createEntityTracker> | null>(null);
  const unlockInteractionRef = useRef<(() => void) | null>(null);
  const feedErrorsRef = useRef<string[]>([]);
  const feedSummaryShownRef = useRef(false);
  const smokeParticlesRef = useRef<Cesium.Entity[]>([]);
  const tectonicEntitiesRef = useRef<Cesium.Entity[]>([]);
  const overlayImageryLayersRef = useRef<Record<string, Cesium.ImageryLayer>>({});

  const cctvPulseEntityRef = useRef<Cesium.Entity | null>(null);
  const cctvMetaRef = useRef<Map<string, any>>(new Map());
  const nextAiMsgIdRef = useRef(1);
  const tiersLoadedRef = useRef(false);
  const MAX_ENTITIES = 30000;
  const toggleDebounceRef = useRef<Record<string, number>>({});
  /** Track layer enables from the AI panel so loadLayerData's auto-revert
   *  (e.g. ais_vessels toggling off when the API key is missing) does not
   *  override explicit AI commands. */
  const agentLayerForceRef = useRef<Record<string, boolean>>({});



  /* ── State ── */
  const initialApiVault = useMemo(() => loadApiVault(), []);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Initializing Cesium...');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openCategories, setOpenCategories] = useState<string[]>([]);
  const [layers, setLayers] = useState<LayerItem[]>(LAYER_DEFS.map(l => ({ ...l })));
  const layersRef = useRef<LayerItem[]>(LAYER_DEFS.map(l => ({ ...l })));
  const renderSchedulerRef = useRef(createRenderScheduler());
  const unifiedTimerRef = useRef(createUnifiedTimer()); // P0 perf: single rAF loop replaces 97+ setInterval calls
  const [layerOpacity, setLayerOpacity] = useState<Record<string, number>>({});
  const [activeImagery, setActiveImagery] = useState('satellite');
  const [infoEntity, setInfoEntity] = useState<Cesium.Entity | null>(null);
  const [showHeatmapLegend, setShowHeatmapLegend] = useState(false);
  const [showSmokeLegend, setShowSmokeLegend] = useState(false);
  const [apiVault, setApiVault] = useState<ApiVaultState>(initialApiVault);
  const [showTokenSetup, setShowTokenSetup] = useState(() => !hasAnyApiVaultValue(initialApiVault) && !initialApiVault.vaultDismissed && !CESIUM_ION_ENV_TOKEN);
  const [showApiVault, setShowApiVault] = useState(false);
  const [showStudyArea, setShowStudyArea] = useState(false);
  const [studyWest, setStudyWest] = useState('68.0');
  const [studySouth, setStudySouth] = useState('6.0');
  const [studyEast, setStudyEast] = useState('98.0');
  const [studyNorth, setStudyNorth] = useState('38.0');
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<Record<string, unknown> | null>(null);
  const [showIntelFeed, setShowIntelFeed] = useState(false);
  const [activeLayerCount, setActiveLayerCount] = useState(0);
  const [utcTime, setUtcTime] = useState('');
  const [activeEvents, setActiveEvents] = useState(0);
  const [weatherCards, setWeatherCards] = useState<WeatherCardData[]>([]);
  const [contextMenu, setContextMenu] = useState<{show:boolean;x:number;y:number;lat:number;lon:number}>({show:false,x:0,y:0,lat:0,lon:0});
  const [forks, setForks] = useState<Array<{forkId: string; name: string; divergenceScore: number; status: string}>>([]);
  const [activeForkCount, setActiveForkCount] = useState(0);
  const [monitorCollapsed, setMonitorCollapsed] = useState(true);
  const [forkMode, setForkMode] = useState(false);
  const forkModeRef = useRef(false);
  useEffect(() => { forkModeRef.current = forkMode; }, [forkMode]);

  // ── Fork creation dialog state ──
  // When the user right-clicks the globe in Fork Mode, we open this dialog
  // instead of a browser prompt so they can name the reality and set a
  // buffer radius (with m/km unit toggle) in a professional manner.
  const [forkDialog, setForkDialog] = useState<{
    open: boolean;
    lat: number;
    lon: number;
    name: string;
    radius: number;   // always stored in meters
    unit: 'm' | 'km';
  }>({ open: false, lat: 0, lon: 0, name: '', radius: 500000, unit: 'km' });

  const [showMarketIntelPanel, setShowMarketIntelPanel] = useState(false);
  const [showSatelliteTracker, setShowSatelliteTracker] = useState(false);
  const [showAviationTracker, setShowAviationTracker] = useState(false);
  const [showSatelliteImagery, setShowSatelliteImagery] = useState(false);
  const [showAnalyticsWorkbench, setShowAnalyticsWorkbench] = useState(false);
  const [pendingAnalyticalToolId, setPendingAnalyticalToolId] = useState<number | null>(null);
  const [showLaunchReplay, setShowLaunchReplay] = useState(false);
  const [showRadioTuner, setShowRadioTuner] = useState(false);
  const [showDuckdbAnalytics, setShowDuckdbAnalytics] = useState(false);
  const [duckdbRestoreKey, setDuckdbRestoreKey] = useState(0);
  const [analyticalNeedsTwoPoints, setAnalyticalNeedsTwoPoints] = useState(false);
  const [sensorStyle, setSensorStyle] = useState<SensorStyleId>('normal');
  const sensorStylesRef = useRef<SensorStyles | null>(null);
  const tomtomTrafficRef = useRef<TomTomTrafficLayer | null>(null);
  const detectionOverlayRef = useRef<DetectionOverlay | null>(null);
  const cctvViewshedRef = useRef<CctvViewshed | null>(null);
  const aircraftHangarRef = useRef<AircraftHangar | null>(null);
  const photorealGlobeRef = useRef<PhotorealisticGlobe | null>(null);
  const [photoreal, setPhotoreal] = useState(false);
  const cinematicCameraRef = useRef<CinematicCamera | null>(null);
  const [showFirstRun, setShowFirstRun] = useState<boolean>(() => isFirstRun());
  const [showLandCoverMapper, setShowLandCoverMapper] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  // CMD+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
      // Sensor styles: 1–6 cycle CRT / NVG / FLIR / Noir / Snow (1 = Normal).
      // Only when no text input has focus.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && /^[1-6]$/.test(e.key)) {
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        const def = SENSOR_STYLES[Number(e.key) - 1];
        if (def) {
          e.preventDefault();
          setSensorStyle(prev => sensorStylesRef.current?.toggle(def.id) ?? def.id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  // Sync sensor-style state → the Cesium post-process stage (created after viewer).
  useEffect(() => {
    sensorStylesRef.current?.set(sensorStyle);
  }, [sensorStyle]);
  const [memoryStats, setMemoryStats] = useState<Record<string, { count: number }> | null>(null);
  const [reflexStates, setReflexStates] = useState<Array<{ reflexId: string; status: string }>>([
    { reflexId: 'seismic-pupillary', status: 'IDLE' },
    { reflexId: 'storm-pupillary', status: 'IDLE' },
    { reflexId: 'maritime-distress', status: 'IDLE' },
  ]);
  const [recentDiscoveries, setRecentDiscoveries] = useState<Array<{ summary: string; confidence: number }>>([]);
  const [lastDream, setLastDream] = useState<{ scenariosRun: number; modelUpdates: number; newCausalEdges: number; timestamp: number } | null>(null);
  const [notifications, setNotifications] = useState<Array<{id:number;text:string;severity:string}>>([]);
  const [populationImpact, setPopulationImpact] = useState<ReturnType<typeof calculatePopulationImpact> | null>(null);

  // ── Chat state from Zustand store ──
  const chatState = useChatStore();
  const aiMessages = chatState.aiMessages;
  const setAiMessages = chatState.setAiMessages;
  const addMessage = chatState.addMessage;
  const updateMessage = chatState.updateMessage;
  const aiTyping = chatState.aiTyping;
  const setAiTyping = chatState.setAiTyping;
  const aiInput = chatState.aiInput;
  const setAiInput = chatState.setAiInput;
  const sessionId = chatState.sessionId;
  const selectedTier = chatState.selectedTier;
  const setSelectedTier = chatState.setSelectedTier;
  const modelTiers = chatState.modelTiers;
  const setModelTiers = chatState.setModelTiers;
  const adaptiveSuggestions = chatState.adaptiveSuggestions;
  const setAdaptiveSuggestions = chatState.setAdaptiveSuggestions;
  const voiceMode = chatState.voiceMode;
  const setVoiceMode = chatState.setVoiceMode;
  const bargeIn = chatState.bargeIn;
  const setBargeIn = chatState.setBargeIn;
  const planningFor = chatState.planningFor;
  const setPlanningFor = chatState.setPlanningFor;
  const pdfExporting = chatState.pdfExporting;
  const setPdfExporting = chatState.setPdfExporting;
  const agentSteps = chatState.agentSteps;
  const setAgentSteps = chatState.setAgentSteps;
  const showReasoningFor = chatState.showReasoningFor;
  const setShowReasoningFor = chatState.setShowReasoningFor;
  const showEvidenceFor = chatState.showEvidenceFor;
  const setShowEvidenceFor = chatState.setShowEvidenceFor;
  const reasoningTraces = chatState.reasoningTraces;
  const setReasoningTraces = chatState.setReasoningTraces;
  const evidenceChains = chatState.evidenceChains;
  const setEvidenceChains = chatState.setEvidenceChains;
  const showAI = chatState.showAI;
  const setShowAI = chatState.setShowAI;
  const copiedMsgId = chatState.copiedMsgId;
  const setCopiedMsgId = chatState.setCopiedMsgId;
  const thinkingExpanded = chatState.thinkingExpanded;
  const setThinkingExpanded = chatState.setThinkingExpanded;
  const expandedStep = chatState.expandedStep;
  const setExpandedStep = chatState.setExpandedStep;
  const sandboxWorkspaceId = chatState.sandboxWorkspaceId;
  const setSandboxWorkspaceId = chatState.setSandboxWorkspaceId;
  const uploadedFiles = chatState.uploadedFiles;
  const setUploadedFiles = chatState.setUploadedFiles;
  const chatImages = chatState.chatImages;
  const setChatImages = chatState.setChatImages;
  const clearChatImages = chatState.clearChatImages;
  const isListening = chatState.isListening;
  const setIsListening = chatState.setIsListening;
  const dataAnalysisResult = chatState.dataAnalysisResult;
  const setDataAnalysisResult = chatState.setDataAnalysisResult;
  const chatList = chatState.chatList;
  const setChatList = chatState.setChatList;
  const showChatHistory = chatState.showChatHistory;
  const setShowChatHistory = chatState.setShowChatHistory;
  const shareUrl = chatState.shareUrl;
  const setShareUrl = chatState.setShareUrl;
  const showShareDialog = chatState.showShareDialog;
  const setShowShareDialog = chatState.setShowShareDialog;
  const streamingMdRef = chatState.streamingMdRef;
  const pipelineProgress = chatState.pipelineProgress;
  const setPipelineProgress = chatState.setPipelineProgress;

  const aiMessagesRef = useRef<ChatMessage[]>([]);
  aiMessagesRef.current = aiMessages;
  const showAIRef = useRef(false);
  showAIRef.current = showAI;

  const auth = useAuth();
  const ws = useWebSocket(auth.token ?? undefined);
  const { isLoggedIn, isAdmin } = auth;

  // ── Collaboration ──
  const collaboration = useCollaboration(ws, sessionId, 'browser-user', 'You');

  // ── Offline support ──
  const offline = useOfflineChat();
  const [showCognitiveDashboard, setShowCognitiveDashboard] = useState(false);
  const [showMultiHazardPanel, setShowMultiHazardPanel] = useState(false);
  const [showMemoryExplorer, setShowMemoryExplorer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showScenarioGallery, setShowScenarioGallery] = useState(false);
  const [showScenarioEditor, setShowScenarioEditor] = useState(false);
  const [kaggleOverlay, setKaggleOverlay] = useState<{ jobId: string; lat: number; lon: number; scenarioType: string } | null>(null);
  // E2E bridge: Playwright live-render tests invoke this to trigger overlays
  // without driving the full ScenarioEditor UI. Production users never see it.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).setKaggleOverlay = (v: { jobId: string; lat: number; lon: number; scenarioType: string }) =>
        setKaggleOverlay(v);
      (window as unknown as Record<string, unknown>).kaggleOverlayState = kaggleOverlay;
      // God-eye test hook: set the active study-area bbox directly so the AI
      // analytical engine can compute over it (used by e2e / dev tests).
      (window as unknown as Record<string, unknown>).setStudyAreaBbox = (bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null) => {
        useChatStore.getState().setStudyAreaBbox(bbox);
      };
      return () => {
        delete (window as unknown as Record<string, unknown>).setKaggleOverlay;
      };
    }
  }, [kaggleOverlay]);

  // Panel z-index stacking manager
  const [panelZStack, setPanelZStack] = useState<Record<string, number>>({});
  const panelZCounter = useRef(999);
  const focusPanel = useCallback((panelId: string) => {
    panelZCounter.current += 1;
    setPanelZStack(prev => ({ ...prev, [panelId]: panelZCounter.current }));
  }, []);
  const getPanelZIndex = useCallback((panelId: string, base: number = 999) =>
    panelZStack[panelId] ?? base,
  [panelZStack]);

  const [showCinematicDirector, setShowCinematicDirector] = useState(false);
  const [cinematicLayerVersion, setCinematicLayerVersion] = useState(0);
  const [cinematicFocusEntity, setCinematicFocusEntity] = useState<{ lat: number; lon: number; layer: string; name?: string } | null>(null);
  const [showSpatialSketching, setShowSpatialSketching] = useState(false);
  const [showPerfMonitor, setShowPerfMonitor] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [scenarioGalleryScenarios, setScenarioGalleryScenarios] = useState<any[]>([]);
  const [scenarioGalleryLoading, setScenarioGalleryLoading] = useState(false);
  const [scenarioGalleryError, setScenarioGalleryError] = useState<string | null>(null);
  const [activeStudyAreaId, setActiveStudyAreaId] = useState<string | null>(null);
  useEffect(() => {
    if (!showScenarioGallery) return;
    setScenarioGalleryLoading(true);
    setScenarioGalleryError(null);
    fetch('/api/scenarios/search', { headers: { ...authHeaders() } })
      .then(r => {
        if (!r.ok) throw new Error(r.status === 401 ? 'Not logged in' : 'Failed to load scenarios');
        return r.json();
      })
      .then(data => {
        if (data?.scenarios) setScenarioGalleryScenarios(data.scenarios.map(adaptScenario));
      })
      .catch(err => setScenarioGalleryError(err.message))
      .finally(() => setScenarioGalleryLoading(false));
  }, [showScenarioGallery]);
  // Phase 2: Vision
  const nextImageIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Phase 2: Voice
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<globalThis.SpeechRecognition | null>(null);
  // PRIMARY voice: OpenAI Realtime (interruptible audio-in/audio-out).
  // Web Speech → /api/agent/ask remains the FALLBACK when Realtime can't connect.
  const [realtimeVoiceAvailable, setRealtimeVoiceAvailable] = useState(false);
  const realtimeVoice = useRealtimeVoice({
    getToken: () => localStorage.getItem('auth_token'),
    onStatus: (s) => { if (import.meta.env.DEV) console.log('[Voice]', s); },
    onError: (msg) => { setRealtimeVoiceAvailable(false); if (import.meta.env.DEV) console.warn('[Voice]', msg); },
  });
  // Chat history — abort controller and refs remain local
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const sendAIRef = useRef<(overrideMessage?: string, opts?: { force?: boolean }) => Promise<void>>(async () => {});
  const [showAdmin, setShowAdmin] = useState(false);
  const [showTimeSlider, setShowTimeSlider] = useState(false);
  const [timeSliderValue, setTimeSliderValue] = useState(Date.now());
  const [timeSliderPlaying, setTimeSliderPlaying] = useState(false);

  // Time slider: apply entity filtering when value changes
  useEffect(() => {
    if (showTimeSlider) {
      filterEntitiesByTime(timeSliderValue);
    } else {
      clearTimelineFilter();
    }
  }, [showTimeSlider, timeSliderValue]);

  // Time slider play/pause: advance time forward when playing
  useEffect(() => {
    if (!timeSliderPlaying || !showTimeSlider) return;
    const interval = setInterval(() => {
      setTimeSliderValue(prev => {
        const next = prev + 60000; // advance 1 minute per tick
        if (next >= Date.now()) {
          setTimeSliderPlaying(false);
          return Date.now();
        }
        return next;
      });
    }, 100); // 10 ticks per second for smooth playback
    return () => clearInterval(interval);
  }, [timeSliderPlaying, showTimeSlider]);
  const [showMeasureTool, setShowMeasureTool] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<Array<{ lat: number; lon: number }>>([]);
  const [measureDistance, setMeasureDistance] = useState<number | null>(null);
  const [measureArea, setMeasureArea] = useState<number | null>(null);

  /* ── Navigation / Spatial Safety tools ── */
  const [navMode, setNavMode] = useState<'none' | 'route' | 'safest'>('none');
  const [routePoints, setRoutePoints] = useState<Array<{ lat: number; lon: number }>>([]);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [safestHazard, setSafestHazard] = useState<{ lat: number; lon: number } | null>(null);
  const [safestResult, setSafestResult] = useState<SafestResult | null>(null);
  const navModeRef = useRef<'none' | 'route' | 'safest'>('none');
  const routePointsRef = useRef<Array<{ lat: number; lon: number }>>([]);
  const navEntitiesRef = useRef<Cesium.Entity[]>([]);
  useEffect(() => { navModeRef.current = navMode; }, [navMode]);
  const clearNavEntities = useCallback(() => {
    for (const e of navEntitiesRef.current) {
      try { viewerRef.current?.entities.remove(e); } catch { /* ignore */ }
    }
    navEntitiesRef.current = [];
  }, []);
  const measureEntitiesRef = useRef<Cesium.Entity[]>([]);
  const chatSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentActionHistoryRef = useRef<Array<{
    type: 'flyTo' | 'toggleLayer' | 'addEntity' | 'removeEntity' | 'addPanel';
    entities?: Cesium.Entity[];
    layerId?: string;
    previousEnabled?: boolean;
    previousCamera?: { longitude: number; latitude: number; height: number };
    panelData?: unknown;
    description: string;
    timestamp: number;
  }>>([]);
  const chatListRef = useRef<ChatListItem[]>([]);
  chatListRef.current = chatList;
  const chatSearch = chatState.chatSearch;
  const setChatSearch = chatState.setChatSearch;
  // Phase 8: Session sharing. New shares store session contents locally and
  // place only an opaque reference in the URL so operational chat text is not
  // continuously leaked through address bars, browser history, screenshots, or logs.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    // New: server-backed shared sessions — fetch from /api/shared/:token
    if (hash.startsWith('shared/')) {
      const token = hash.slice('shared/'.length);
      fetch(`/api/shared/${encodeURIComponent(token)}`)
        .then(r => r.ok ? r.json() : null)
        .then(session => {
          if (session && Array.isArray(session.messages)) {
            setAiMessages(session.messages.map((m: {id?:number;role:string;content:string;type?:string}) => ({...m, id: m.id || nextAiMsgIdRef.current++})));
            if (session.title) setAiInput('');
            // Auto-open the AI panel
            setShowAI(true);
          }
        })
        .catch(() => {});
      return;
    }
    if (hash.startsWith('sessionRef=')) {
      try {
        const id = decodeURIComponent(hash.slice('sessionRef='.length));
        const raw = window.localStorage.getItem(`terranoetis.sharedSession.${id}`);
        if (!raw) return;
        const session = JSON.parse(raw);
        if (Array.isArray(session.messages)) {
          setAiMessages(session.messages.map((m: {id?:number;role:string;content:string;type?:string}) => ({...m, id: m.id || nextAiMsgIdRef.current++})));
        }
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
        if (session.wsId) setSandboxWorkspaceId(session.wsId);
        if (session.input) setAiInput(session.input);
      } catch { /* ignore session parse */ }
    }
  }, [setAiMessages, setSandboxWorkspaceId, setAiInput, setShowAI]);

  const buildSessionShareLink = useCallback(async () => {
    // Save the current conversation to the server first
    const id = useChatStore.getState().currentChatId || generateChatId();
    useChatStore.getState().setCurrentChatId(id);
    const title = aiMessagesRef.current.find(m => m.role === 'user')?.content.slice(0, 40) || 'Shared Session';
    try {
      await saveChat({
        id,
        title,
        messages: aiMessagesRef.current,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch { /* non-critical — may already exist */ }
    // Request a share token from the server
    const resp = await fetch(`/api/chats/${id}/share`, {
      method: 'POST',
      headers: { ...authHeaders() },
    });
    if (!resp.ok) throw new Error('Failed to create share link');
    const data = await resp.json();
    return data.url as string;
  }, []);  

  // Load chat list on mount
  useEffect(() => {
    if (!auth.token) return;
    listChats().then(setChatList).catch(() => {});
  }, [auth.token, setChatList]);

  // Poll memory stats every 30s
  useEffect(() => {
    const fetchMemory = async () => {
      try {
        const res = await fetch('/api/memory/stats');
        if (res.ok) {
          const data = await res.json();
          setMemoryStats(data.tiers);
        }
      } catch { /* silent */ }
    };
    fetchMemory();
    const timer = unifiedTimerRef.current;
    timer.register('memory-stats', fetchMemory, 30000);
    return () => { timer.unregister('memory-stats'); };
  }, [auth.token]);

  // Auto-save chat after each new message
  useEffect(() => {
    if (aiMessages.length <= 1) return;
    const id = useChatStore.getState().currentChatId || generateChatId();
    useChatStore.getState().setCurrentChatId(id);
    if (chatSaveTimerRef.current) clearTimeout(chatSaveTimerRef.current);
    chatSaveTimerRef.current = setTimeout(() => {
      saveChat({
        id,
        title: autoTitle(aiMessages),
        messages: aiMessages as ChatMessage[],
        workspaceId: sandboxWorkspaceId || undefined,
      }).then(() => {
        listChats().then(setChatList).catch(() => {});
      }).catch(() => {});
    }, 2000);
    return () => { if (chatSaveTimerRef.current) clearTimeout(chatSaveTimerRef.current); };
  }, [aiMessages, sandboxWorkspaceId, setChatList]);
  // Auto-collapse once the whole run settles (no steps running, done streaming)
  useEffect(() => {
    if (agentSteps.length === 0 && pipelineProgress.length === 0) return;
    const settled = !aiTyping
      && !agentSteps.some(s => s.status === 'running')
      && !pipelineProgress.some(p => p.status === 'running');
    if (settled) setThinkingExpanded(false);
  }, [aiTyping, agentSteps, pipelineProgress, setThinkingExpanded]);
  const [searchValue, setSearchValue] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState<Array<{name:string;lat:number;lon:number}>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [timelineValue, setTimelineValue] = useState(100);
  const [isAutoRotating, setIsAutoRotating] = useState(false);
  const [showISSInfo, setShowISSInfo] = useState(false);
  const [issInfo, setIssInfo] = useState<{lat:number;lon:number} | null>(null);
  const [satTravel, setSatTravel] = useState(false);
  const [satTravelHud, setSatTravelHud] = useState<{ lat: number; lon: number; altKm: number; az: number; el: number; speed: number } | null>(null);
  const [flightTravel, setFlightTravel] = useState(false);
  const [flightTravelHud, setFlightTravelHud] = useState<{ callsign: string; lat: number; lon: number; altFt: number; speedKts: number; speedKmh: number; heading: number; vs: number; pitch?: number } | null>(null);
  const [intelFeed, setIntelFeed] = useState<IntelFeedItem[]>([]);
  const [intelFilter, setIntelFilter] = useState('all');
  const [cameraLat, setCameraLat] = useState('');
  const [cameraLon, setCameraLon] = useState('');
  const [cameraLatDir, setCameraLatDir] = useState('N');
  const [cameraLonDir, setCameraLonDir] = useState('E');
  const [showPopulationImpact, setShowPopulationImpact] = useState(false);
  const [layerSearch, setLayerSearch] = useState('');
  const [pulsingLayer, setPulsingLayer] = useState<string | null>(null);
  const [cctvPreviewTick, setCctvPreviewTick] = useState(0);
  const [cctvPreviewFailed, setCctvPreviewFailed] = useState(false);
  useEffect(() => { setCctvPreviewFailed(false); }, [infoEntity]);
  useEffect(() => {
    if (showSuggestions && searchSuggestions.length > 0) {
      const el = searchBoxRef.current;
      if (el) setSearchBoxRect(el.getBoundingClientRect());
    }
  }, [showSuggestions, searchSuggestions]);
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
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const virtualizedChatRef = useRef<VirtualizedMessageListHandle>(null);

  /* Auto-scroll chat to bottom on new messages */
  useEffect(() => { chatMessagesRef.current?.scrollTo({ top: chatMessagesRef.current.scrollHeight, behavior: 'smooth' }); }, [aiMessages.length, aiMessages[aiMessages.length - 1]?.content, aiTyping]); // eslint-disable-line react-hooks/exhaustive-deps

  const aiApiType = useMemo(() => resolveAiProvider(apiVault), [apiVault]);
  const cesiumIonToken = useMemo(() => resolveCesiumIonToken(apiVault), [apiVault]);

  const activeBbox = useMemo(() => {
    if (!activeStudyAreaId) return null;
    const active = studyAreas.find(a => a.id === activeStudyAreaId);
    if (!active) return null;
    return computeStudyAreaBbox(active);
  }, [studyAreas, activeStudyAreaId]);

  const activeStudyAreaPolygon = useMemo(() => {
    if (!activeStudyAreaId) return null;
    const active = studyAreas.find(a => a.id === activeStudyAreaId);
    if (!active) return null;
    const rings = getStudyAreaOuterRings(active);
    return rings.length > 0 ? rings : null;
  }, [studyAreas, activeStudyAreaId]);

  // The actual geometry the user drew on the globe (authoritative for study-area
  // validation): a bbox-only tool must not accept a point and vice versa.
  const activeStudyAreaType = useMemo<StudyAreaDrawType>(() => {
    if (!activeStudyAreaId) return null;
    const active = studyAreas.find(a => a.id === activeStudyAreaId);
    return (active?.type ?? null) as StudyAreaDrawType;
  }, [studyAreas, activeStudyAreaId]);

  // Auto-detected points from the active study area(s): a single point marker
  // yields one [lat, lon]; a drawn point expands to a ±0.05° bbox whose centre
  // is the exact placed point. Used by analytical tools to seed their study
  // point (or the two endpoints for two-point tools) without manual entry.
  const activeStudyPoints = useMemo(() => {
    const pts: Array<{ lat: number; lon: number }> = [];
    for (const a of studyAreas) {
      if (a.active && a.type === 'point' && a.geojson) {
        for (const f of a.geojson.features) {
          const g = f.geometry;
          if (g && g.type === 'Point') pts.push({ lon: g.coordinates[0] as number, lat: g.coordinates[1] as number });
        }
      }
    }
    if (pts.length === 0 && activeStudyAreaId) {
      const b = activeBbox;
      if (b) pts.push({ lat: (b.latMin + b.latMax) / 2, lon: (b.lonMin + b.lonMax) / 2 });
    }
    return pts;
  }, [studyAreas, activeStudyAreaId, activeBbox]);

  const handleSurfaceData = useCallback((toolId: string, resultJson: string) => {
    const viewer = viewerRef.current;
    if (!viewer || !activeBbox) return;
    try {
      const points = extractPointsFromResult(toolId, resultJson);
      if (points.length < 3) { console.warn('[Surface] Too few points:', points.length); return; }
      const camAlt = viewer.camera.positionCartographic.height;
      const { width, height } = getViewDependentResolution(camAlt, 200);
      const b = activeBbox;
      console.log('[Surface] Rendering', points.length, 'points, bbox:', b, 'grid:', width, 'x', height);
      if (b.latMin >= b.latMax || b.lonMin >= b.lonMax) { console.error('[Surface] Invalid bbox:', b); return; }
      const grid = interpolateIDW(points, b, width, height);
      showInterpSurface(viewer, grid, undefined, 0.65, true, activeStudyAreaPolygon ?? undefined);
    } catch (e) {
      console.error('[Surface] Render error:', (e as Error)?.message, (e as Error)?.stack);
    }
  }, [activeBbox, activeStudyAreaPolygon]);

  const toolResultEntityRef = useRef<Cesium.Entity | null>(null);
  const _toolSurfacePrimitive = useRef<unknown>(null);

  const handleToolResult = useCallback((
    toolId: number, label: string, lat: number, lon: number, value?: number,
    grid?: { latMin: number; latMax: number; lonMin: number; lonMax: number; nLat: number; nLon: number; values: number[]; valueMin: number; valueMax: number; valueMean?: number; valueStd?: number; valueMedian?: number; finiteCellCount?: number; hasNaN: boolean },
    unit?: string, vizType?: string,
  ) => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const b = activeBbox;
    const spatialViz = ['heatmap', 'contour', 'vector'];
    // Skip the yellow labelled point entirely for spatial-field tools
    // (heatmap/contour/vector) — the field overlay IS the result; a single
    // centre pixel value + dot on the globe is misleading (the field varies).
    if (!spatialViz.includes(vizType ?? '')) {
      if (toolResultEntityRef.current) {
        viewer.entities.remove(toolResultEntityRef.current);
      }
      toolResultEntityRef.current = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        label: {
          text: label,
          font: 'bold 12px monospace',
          fillColor: Cesium.Color.YELLOW,
          backgroundColor: new Cesium.Color(0, 0, 0, 0.6),
          showBackground: true,
          pixelOffset: new Cesium.Cartesian2(0, -24),
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 2,
          outlineColor: Cesium.Color.BLACK,
          scale: 1,
          eyeOffset: new Cesium.Cartesian3(0, 0, -100),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        point: {
          pixelSize: 10,
          color: Cesium.Color.YELLOW.withAlpha(0.8),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
    }

    // QGIS-style raster output: render the computed spatial grid as a styled
    // surface over the study area (real per-cell values, not a flat plane).
    if (grid && b && b.latMin < b.latMax && b.lonMin < b.lonMax) {
      // Clear any leftover yellow point from a previous scalar-tool run — the
      // heatmap overlay is the result for spatial tools.
      if (toolResultEntityRef.current) {
        viewer.entities.remove(toolResultEntityRef.current);
        toolResultEntityRef.current = null;
      }
      const n = grid.nLat * grid.nLon;
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        // Keep NaN as-is so cells outside a drawn polygon study area render
        // transparent (the IDW overlay hugs the shape, not its bounding box).
        const v = grid.values[i];
        data[i] = typeof v === 'number' && Number.isFinite(v) ? v : NaN;
      }
      const interpGrid: InterpGrid = {
        data,
        variance: new Float32Array(n),
        width: grid.nLon,
        height: grid.nLat,
        latMin: grid.latMin, latMax: grid.latMax, lonMin: grid.lonMin, lonMax: grid.lonMax,
        valueMin: grid.valueMin, valueMax: grid.valueMax,
      };
      toolSurfaceGridRef.current = interpGrid;
      toolSurfacePolygonRef.current = activeStudyAreaPolygon ?? undefined;
      const schemeColors = schemeToColorStops(toolSurfaceScheme);
      showInterpSurface(viewer, interpGrid, schemeColors, 0.6, false, activeStudyAreaPolygon ?? undefined);
      // Raster-map legend: show the field colour bar + zonal statistics on the
      // globe whenever a spatial grid is displayed.
      setToolSurfaceLegend({
        label, unit,
        valueMin: grid.valueMin, valueMax: grid.valueMax,
        valueMean: grid.valueMean ?? Number.NaN,
        valueStd: grid.valueStd ?? Number.NaN,
        valueMedian: grid.valueMedian ?? Number.NaN,
        finiteCellCount: grid.finiteCellCount ?? 0,
      });
      setToolSurfaceProbe(null);
      return;
    }

    // Fallback: point mode with no grid — paint a surface only if a study area
    // is active and a scalar value exists, AND the tool is a spatial viz type
    // (heatmap/contour/vector). Non-spatial types (timeseries, profile, scatter,
    // gauge, spectrum, bar, etc.) show only the labeled point — no flat rectangle.
    if (!b || b.latMin >= b.latMax || b.lonMin >= b.lonMax || value == null || !spatialViz.includes(vizType ?? '')) return;
    const camAlt = viewer.camera.positionCartographic.height;
    const { width, height } = getViewDependentResolution(camAlt, 100);
    const nLat = Math.max(4, Math.floor(width / 10));
    const nLon = Math.max(4, Math.floor(height / 10));
    const pts: Array<{ lat: number; lon: number; value: number }> = [];
    for (let i = 0; i < nLat; i++) {
      for (let j = 0; j < nLon; j++) {
        pts.push({
          lat: b.latMin + (b.latMax - b.latMin) * i / (nLat - 1),
          lon: b.lonMin + (b.lonMax - b.lonMin) * j / (nLon - 1),
          value,
        });
      }
    }
    if (pts.length < 3) { setToolSurfaceLegend(null); setToolSurfaceProbe(null); return; }
    const idwGrid = interpolateIDW(pts, b, width, height);
    showInterpSurface(viewer, idwGrid, undefined, 0.6, true, activeStudyAreaPolygon ?? undefined);
  }, [activeBbox, activeStudyAreaPolygon, toolSurfaceScheme]);

  const handleClearToolResult = useCallback(() => {
    setToolSurfaceLegend(null);
    setToolSurfaceProbe(null);
    setToolSurfaceScheme('default');
    toolSurfaceGridRef.current = null;
    toolSurfacePolygonRef.current = undefined;
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (toolResultEntityRef.current) {
      viewer.entities.remove(toolResultEntityRef.current);
      toolResultEntityRef.current = null;
    }
    clearInterpSurface(viewer);
  }, []);

  // Re-render the tool-result heatmap with a different color scheme (Viridis,
  // Turbo, Spectral, ...) — the legend bar and the 3D surface stay in sync.
  const handleToolSurfaceSchemeChange = useCallback((scheme: string) => {
    setToolSurfaceScheme(scheme);
    const viewer = viewerRef.current;
    const grid = toolSurfaceGridRef.current;
    if (!viewer || !grid) return;
    showInterpSurface(viewer, grid, schemeToColorStops(scheme), 0.6, false, toolSurfacePolygonRef.current);
  }, []);

  /* ── Memo ── */
  const groupedLayers = useMemo(() => {
    const g: Record<string, LayerItem[]> = {};
    const primaryIds = new Set([
      'earthquakes', 'tectonic', 'seismic_waves', 'heatmap',
      'flight_tracks', 'airports', 'airspaces',
      'ais_vessels', 'submarine_cables',
      'space_debris', 'nasa_dsn', 'space_weather',
      'lightning_strikes', 'severe_storms', 'wildfires',
      'aurora_oval', 'dust', 'co_index', 'so2_index', 'temp_anomaly',
      'volcanoes', 'floods', 'seaLakeIce',
      'disaster_alerts', 'landslides', 'flood_extent', 'disaster_near_me',
      'live_media', 'electricity_grid',
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
    // Server-side /api/vault was removed (enterprise: keys resolve from server
    // .env only — no per-user vault endpoint exists anymore). Purge stale
    // browser storage; the fetch below intentionally never runs.
    purgeLegacyVaultStorage();
  }, [isLoggedIn, auth.token]);

  const handleApiVaultSave = async (keys: Record<string, string>) => {
    flatKeysRef.current = keys;
    setApiVault(prev => ({ ...prev, keys }));
    // Keys are stored locally for UI convenience only; the SERVER ignores them
    // entirely (enterprise: /api/vault removed — AI/data keys resolve from the
    // server .env). No network call, so no 404.
    try { localStorage.setItem(SESSION_VAULT_KEY, JSON.stringify({ keys, preferredAiProvider: 'gemini', vaultDismissed: false })); } catch { /* ignore */ }
    purgeLegacyVaultStorage();
  };

  /* ── Clock (selected timezone) ── */
  const clockTz = useUserPrefStore(s => s.pref.timezone);
  useEffect(() => {
    const tz = clockTz;
    const tick = () => {
      const now = new Date();
      const formatted = now.toLocaleString('en-IN', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      setUtcTime(formatted);
    };
    tick();
    const timer = unifiedTimerRef.current;
    timer.register('clock', tick, 1000);
    timer.start();
    return () => { timer.unregister('clock'); };
  }, [clockTz]);

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
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true,
          alpha: false,
        },
      },
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity, // P0 perf: only render on demand
      targetFrameRate: 30,
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
    // God-eye test hook: expose the viewer for e2e camera assertions.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__VIEWER__ = v;
    }
    forkRendererRef.current = new ForkRenderer(v);
    forkRendererRef.current.setEntityCacheGetter(() => entityStoreRef.current);
    forkRendererRef.current.setImageryGetter(() => overlayImageryLayersRef.current);
    forkRendererRef.current.setTilesetsGetter(() => {
      const ts = getOsmBuildingsTileset();
      return ts ? [{ tileset: ts, layerId: 'dt_buildings' }] : [];
    });
    forkRendererRef.current.setSkipLayers(['live_media', 'weather_cards', 'india_cctv']);
    ghostProtocolRef.current = new GhostProtocol(v);
    entropyHaloRef.current = new EntropyHalo(v);
    sensorStylesRef.current = new SensorStyles(v);
    // Photorealistic 3D globe (Google Photorealistic 3D Tiles via Cesium Ion).
    // Gracefully degrades to standard imagery + terrain if the Ion asset is
    // unreachable — the app never breaks.
    photorealGlobeRef.current = new PhotorealisticGlobe(v);
    // Not auto-enabled — user clicks the Photo chip in the sidebar to turn it on.
    // Cinematic camera engine — orbit/pan/tilt/rotate/route dolly.
    cinematicCameraRef.current = new CinematicCamera(v);
    oracleChainRef.current = new OracleChainRenderer(v);
    if (import.meta.env.DEV) {
      window.__terranoetisDebug = {
        ...(window.__terranoetisDebug ?? {}),
        viewer: v,
        Cesium,
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
    flightDrRef.current = new FlightDeadReckoning(v);
    adsbLolDrRef.current = new FlightDeadReckoning(v);
    adsbFiDrRef.current = new FlightDeadReckoning(v);
    airlabsDrRef.current = new FlightDeadReckoning(v);
    const aisKey = apiVaultRef.current.keys.AIS_STREAM_API_KEY || '';
    if (aisKey) {
      aisTrackerRef.current = new AisVesselTracker(v, aisKey);
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
      // Remove Cesium default imagery and add Esri satellite as the single base layer
      v.scene.imageryLayers.remove(v.scene.imageryLayers.get(0));
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
    // Safari-only two-finger orbit, Google Earth Pro right-drag style: trackpad
    // twists surface as GestureEvent.rotation (degrees, counterclockwise-
    // positive) in Safari; Chrome/Firefox never emit these events. Twisting
    // orbits the camera around the AREA CENTER (not the globe center, which is
    // what camera.rotate does and what makes the whole globe spin), so the area
    // stays centered and you see it from different sides. Only acts when the
    // twist component dominates so plain pinch-zoom still works, and respects
    // enableRotate (Travel View locks it while active).
    const GestureCtor = (window as unknown as { GestureEvent?: unknown }).GestureEvent;
    if (typeof GestureCtor !== 'undefined') {
      const gestureCanvas = v.scene.canvas;
      let lastGestureRotation = 0;
      let orbitCenter: Cesium.Cartesian3 | null = null;
      const computeOrbitCenter = (): Cesium.Cartesian3 => {
        const cam = v.camera;
        const px = new Cesium.Cartesian2(gestureCanvas.clientWidth / 2, gestureCanvas.clientHeight / 2);
        const ray = cam.getPickRay(px);
        if (ray) {
          const picked = v.scene.globe.pick(ray, v.scene);
          if (picked) return picked;
        }
        const ellipsoidPicked = cam.pickEllipsoid(px, Cesium.Ellipsoid.WGS84);
        if (ellipsoidPicked) return ellipsoidPicked;
        return Cesium.Cartesian3.add(
          cam.position,
          Cesium.Cartesian3.multiplyByScalar(cam.direction, 1e6, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );
      };
      const orbitAround = (axis: Cesium.Cartesian3, angle: number, center: Cesium.Cartesian3) => {
        const cam = v.camera;
        const quat = Cesium.Quaternion.fromAxisAngle(axis, angle, new Cesium.Quaternion());
        const rot = Cesium.Matrix3.fromQuaternion(quat, new Cesium.Matrix3());
        const rel = Cesium.Cartesian3.subtract(cam.position, center, new Cesium.Cartesian3());
        Cesium.Matrix3.multiplyByVector(rot, rel, rel);
        Cesium.Cartesian3.add(rel, center, cam.position);
        Cesium.Matrix3.multiplyByVector(rot, cam.direction, cam.direction);
        Cesium.Matrix3.multiplyByVector(rot, cam.up, cam.up);
        Cesium.Cartesian3.cross(cam.direction, cam.up, cam.right);
        Cesium.Cartesian3.cross(cam.right, cam.direction, cam.up);
      };
      const gestureStart = () => {
        lastGestureRotation = 0;
        const cam = v.camera;
        orbitCenter = computeOrbitCenter();
        // Looking almost straight down makes a horizontal orbit degenerate (it
        // would just spin the view in place). Tilt toward the area so the orbit
        // actually shows its sides.
        if (cam.pitch < Cesium.Math.toRadians(-75)) {
          orbitAround(cam.right, Cesium.Math.toRadians(-75) - cam.pitch, orbitCenter);
        }
      };
      const gestureChange = (ev: Event) => {
        const ge = ev as unknown as { rotation?: number };
        const rot = typeof ge.rotation === 'number' ? ge.rotation : 0;
        const delta = rot - lastGestureRotation;
        lastGestureRotation = rot;
        const gestureCtrl = v.scene.screenSpaceCameraController;
        if (!gestureCtrl.enableRotate || Math.abs(delta) < 0.25 || !orbitCenter) return;
        ev.preventDefault();
        const axis = Cesium.Cartesian3.normalize(orbitCenter, new Cesium.Cartesian3());
        orbitAround(axis, Cesium.Math.toRadians(delta), orbitCenter);
      };
      gestureCanvas.addEventListener('gesturestart', gestureStart);
      gestureCanvas.addEventListener('gesturechange', gestureChange);
    }
    unlockInteractionRef.current = () => {
      if (rotateTimerRef.current) {
        cancelAnimationFrame(rotateTimerRef.current as unknown as number);
        rotateTimerRef.current = null;
      }
      setIsAutoRotating(false);
    };
    v.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(78, 22, 2.2e7),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    });
    throttledRender(v);
    requestAnimationFrame(() => {
      v.resize();
      throttledRender(v);
    });

    // Dismiss loading overlay immediately — globe is visible, data loads in background
    setLoadingProgress(100);
    setLoadingStatus('Globe ready');
    setTimeout(() => setLoading(false), 400);

    let lastCardSyncTime = 0;
    const CARD_SYNC_THROTTLE_MS = 500; // P0 perf: sync card positions at 2 Hz instead of every frame
    const syncWeatherCardPositions = () => {
      const now = performance.now();
      if (now - lastCardSyncTime < CARD_SYNC_THROTTLE_MS) return;
      lastCardSyncTime = now;
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
      // Throttled to ~10 Hz: the 4 setStates force a full App re-render every
      // frame, which competes with Cesium compositing during zoom/pan and
      // causes the stutter that users report as "smooth without heatmap,
      // laggy with it." (The heatmap overlay is just a static tile — the
      // per-frame cost is the React render loop, not the tile itself.)
      const now = performance.now();
      if (now - lastCamTime < 100) return;
      lastCamTime = now;
      const c = v.camera.positionCartographic;
      const latRaw = Cesium.Math.toDegrees(c.latitude);
      const lonRaw = Cesium.Math.toDegrees(c.longitude);
      setCameraLat(Math.abs(latRaw).toFixed(4));
      setCameraLon(Math.abs(lonRaw).toFixed(4));
      setCameraLatDir(latRaw >= 0 ? 'N' : 'S');
      setCameraLonDir(lonRaw >= 0 ? 'E' : 'W');
    };
    let lastCamTime = 0;
    v.scene.postRender.addEventListener(onPostRender);

    setLoadingProgress(100);

    const handler = new Cesium.ScreenSpaceEventHandler(v.canvas);
    screenSpaceHandlerRef.current = handler;
    const unlockOnInteract = () => unlockInteractionRef.current?.();
    handler.setInputAction(unlockOnInteract, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(unlockOnInteract, Cesium.ScreenSpaceEventType.RIGHT_DOWN);
    handler.setInputAction(unlockOnInteract, Cesium.ScreenSpaceEventType.MIDDLE_DOWN);
    handler.setInputAction(unlockOnInteract, Cesium.ScreenSpaceEventType.WHEEL);
    handler.setInputAction(unlockOnInteract, Cesium.ScreenSpaceEventType.PINCH_START);
    // ── Raster value probe ──
    // While hovering the 3D globe with a tool-result heatmap surface active,
    // identify the exact cell under the cursor and show its value (QGIS
    // identify-tool behaviour, per cartographic raster-map convention).
    // Throttled: pickPosition is a depth-buffer raycast (~1-3 ms), and firing
    // it on every mousemove (hundreds/sec, incl. during zoom/pan) causes the
    // camera stutter. We cap it to ~12 Hz and skip entirely while navigating.
    let lastProbeAt = 0;
    let probeNav = 0;
    v.scene.camera.moveStart.addEventListener(() => { probeNav++; });
    v.scene.camera.moveEnd.addEventListener(() => { probeNav = Math.max(0, probeNav - 1); });
    handler.setInputAction((move: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      // Traffic hover readout: when the street-traffic layer is active, pick
      // the entity under the cursor and surface its real speed/free-flow/
      // confidence (TomTom data), independent of the heatmap probe toggle.
      if (isLayerEnabled('tomtom_traffic')) {
        let picked: any = null;
        try { picked = v.scene.pick(move.endPosition); } catch { /* ignore */ }
        const ent = picked?.id;
        if (ent?.properties) {
          const props = ent.properties.getValue(Cesium.JulianDate.now()) as Record<string, unknown>;
          const speed = Number(props.speed);
          if (Number.isFinite(speed)) {
            const freeFlow = Number(props.freeFlow);
            const confidence = Number(props.confidence);
            setTrafficHover({
              x: move.endPosition.x, y: move.endPosition.y,
              speed, freeFlow: Number.isFinite(freeFlow) ? freeFlow : NaN,
              confidence: Number.isFinite(confidence) ? confidence : NaN,
              lat: Number(props.lat ?? NaN), lon: Number(props.lon ?? NaN),
              length: Number(props.length) || undefined,
              travelTime: Number(props.travelTime) || undefined,
              freeFlowTravelTime: Number(props.freeFlowTravelTime) || undefined,
            });
          } else {
            setTrafficHover(null);
          }
        } else {
          setTrafficHover(null);
        }
      } else {
        setTrafficHover(null);
      }
      // Probe only runs when explicitly enabled via the legend toggle.
      if (!toolSurfaceProbeEnabledRef.current) { setToolSurfaceProbe(null); return; }
      const now = performance.now();
      if (probeNav > 0) { setToolSurfaceProbe(null); return; }
      if (now - lastProbeAt < 80) return; // ~12 Hz cap
      lastProbeAt = now;
      if (v.isDestroyed() || !getCurrentGrid()) { setToolSurfaceProbe(null); return; }
      if (toolSurfaceLegendRef.current === null) { setToolSurfaceProbe(null); return; }
      let cart: Cesium.Cartesian3 | undefined;
      try { cart = v.scene.pickPosition(move.endPosition); } catch { /* pick can throw outside globe */ }
      if (!cart || !Cesium.defined(cart)) { setToolSurfaceProbe(null); return; }
      const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(cart);
      if (!carto) { setToolSurfaceProbe(null); return; }
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const hit = probeGridValue(lat, lon);
      if (!hit) { setToolSurfaceProbe(null); return; }
      setToolSurfaceProbe({ x: move.endPosition.x, y: move.endPosition.y, value: hit.value, lat: hit.lat, lon: hit.lon });
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      // The viewer may have been destroyed while the interaction was queued.
      if (v.isDestroyed()) return;
      // ── Navigation / Spatial Safety tools ──
      if (navModeRef.current === 'route' || navModeRef.current === 'safest') {
        let cart = v.scene.pickPosition(click.position);
        if (!cart || !Cesium.defined(cart)) cart = v.camera.pickEllipsoid(click.position, v.scene.globe.ellipsoid) as Cesium.Cartesian3;
        if (cart && Cesium.defined(cart)) {
          const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(cart);
          if (carto) {
            const lon = Cesium.Math.toDegrees(carto.longitude);
            const lat = Cesium.Math.toDegrees(carto.latitude);
            const pt = { lat, lon };
            if (navModeRef.current === 'route') {
              const cur = routePointsRef.current;
              if (cur.length >= 2) { clearNavEntities(); setRouteResult(null); }
              const next = cur.length >= 2 ? [pt] : [...cur, pt];
              routePointsRef.current = next;
              setRoutePoints(next);
              if (next.length === 2) {
                const [a, b] = next;
                routeBetween(a, b).then(res => {
                  const v = viewerRef.current;
                  if (!v) return;
                  navEntitiesRef.current.push(drawNavPolyline(v, res.coords, '#22d3ee'));
                  navEntitiesRef.current.push(drawNavMarker(v, a, '#22d3ee', 'Start'));
                  navEntitiesRef.current.push(drawNavMarker(v, b, '#22d3ee', 'End'));
                  setRouteResult(res);
                }).catch(() => setRouteResult(null));
              }
            } else {
              setSafestHazard(pt);
              setSafestResult({ best: null, bestRoute: null, facilities: [], iso: null, status: 'Searching safe locations nearby…' });
              computeSafestLocation(pt).then(r => {
                if (!viewerRef.current) return;
                setSafestResult(r);
                if (r.best && r.bestRoute) {
                  const v = viewerRef.current;
                  if (v) {
                    navEntitiesRef.current.push(drawNavPolyline(v, r.bestRoute.coords, '#22c55e'));
                    navEntitiesRef.current.push(drawNavMarker(v, pt, '#ef4444', 'Hazard'));
                    navEntitiesRef.current.push(drawNavMarker(v, r.best, '#22c55e', 'Safe'));
                  }
                }
                if (r.iso) {
                  const v = viewerRef.current;
                  if (v) navEntitiesRef.current.push(drawNavIso(v, r.iso, '#ef4444'));
                }
              }).catch(e => setSafestResult({ best: null, bestRoute: null, facilities: [], iso: null, status: 'Error: ' + (e instanceof Error ? e.message : String(e)) }));
            }
          }
        }
        return;
      }

      // Measure tool: when active, clicking adds measurement points
      if (showMeasureToolRef.current) {
        let cart: Cesium.Cartesian3 | undefined = v.scene.pickPosition(click.position);
        if (!cart || !Cesium.defined(cart)) {
          cart = v.camera.pickEllipsoid(click.position, v.scene.globe.ellipsoid);
        }
        if (cart && Cesium.defined(cart)) {
          const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(cart);
          if (!carto) return;
          const lon = Cesium.Math.toDegrees(carto.longitude);
          const lat = Cesium.Math.toDegrees(carto.latitude);
          const newLat = lat, newLon = lon;
          setMeasurePoints(prev => {
            const next = [...prev, { lat: newLat, lon: newLon }];
            let total = 0;
            for (let i = 1; i < next.length; i++) {
              total += greatCircleDistance(
                next[i - 1].lat, next[i - 1].lon,
                next[i].lat, next[i].lon,
              );
            }
            setMeasureDistance(total);
            return next;
          });
        }
        return;
      }

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
          live_media: 'cctv',
          ais_vessels: 'ship',
          space_debris: 'satellite',
        };
        entityTrackerRef.current?.track(ent, trackTypes[layer] ?? 'default');

        // Open the live ISS camera panel when the ISS marker is selected
        if (ent === issEntityRef.current) setShowISSInfo(true);

        // #9 Spatial/chat two-way binding: clicking an entity drops a contextual
        // "Ask about this" chip into the AI input so the user can query it.
        if (showAIRef.current) {
          const entName = typeof ent.name === 'string' ? ent.name : (typeof p?.place === 'string' ? p.place : undefined) || layer;
          const entLat = p?.lat as number | undefined;
          const entLon = p?.lon as number | undefined;
          if (entLat != null && entLon != null) {
            const chip = `Tell me about ${entName} at ${Number(entLat).toFixed(2)}, ${Number(entLon).toFixed(2)}`;
            setAiInput(chip);
          }
        }

        // If CinematicDirector is open, focus on this entity
        if (showCinematicDirector) {
          const pos = ent.position?.getValue(Cesium.JulianDate.now()) as Cesium.Cartesian3 | undefined;
          if (pos) {
            const carto = Cesium.Cartographic.fromCartesian(pos);
            setCinematicFocusEntity({
              lat: Cesium.Math.toDegrees(carto.latitude),
              lon: Cesium.Math.toDegrees(carto.longitude),
              layer,
              name: typeof ent.name === 'string' ? ent.name : typeof p?.place === 'string' ? p.place : undefined,
            });
          }
        }
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
      if (v.isDestroyed()) return;
      const cart = v.camera.pickEllipsoid(click.position, v.scene.globe.ellipsoid);
      if (!cart) return;
      const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(cart);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const lat = Cesium.Math.toDegrees(carto.latitude);

      if (!forkModeRef.current) {
        setContextMenu({ show: true, x: click.position.x, y: click.position.y, lat, lon });
        return;
      }

      // Open the fork-creation dialog (name + buffer radius) instead of a prompt.
      setForkDialog({
        open: true,
        lat,
        lon,
        name: `Fork-${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        radius: 500000,   // 500 km default
        unit: 'km',
      });
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    handler.setInputAction(() => setContextMenu({show:false,x:0,y:0,lat:0,lon:0}), Cesium.ScreenSpaceEventType.LEFT_DOWN);

    v.scene.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    void loadAllData(v)
      .then(() => {
        if (v.isDestroyed()) return;
        syncWeatherCardPositions();
        unifiedTimerRef.current.register('refresh-live', () => { void refreshLiveData(v); }, 60000);
        // Slow-refresh groups (ocean, geology, space — data changes hourly+)
        unifiedTimerRef.current.register('refresh-slow', () => { void refreshGenericLayers(v, ['geology', 'space', 'ocean', 'argo', 'tides', 'usgs_water']); }, 300000);
        // Re-clip data layers against any active fork domes after live refresh
        // so newly streamed entities respect dome cropping automatically.
        unifiedTimerRef.current.register('fork-recrop', () => { forkRendererRef.current?.reapplyCrop(); }, 5000);
        unifiedTimerRef.current.start();
        // Pre-warm server cache for slow groups so first toggle is instant
        const warmGroupLayers: Record<string, string> = {
          ocean: '42_ndbc_buoy_data', argo: '31_argo_floats', tides: '31_noaa_tides_currents',
          usgs_water: '27_usgs_nawqa',
          geology: '5_usgs_mineral_deposits', space: '6_celestrak_gp_api',
        };
        Promise.all(Object.entries(warmGroupLayers).map(([, lid]) => {
          const lc = LAYER_CATEGORIES.find(l => l.id === lid);
          return lc ? fetchLayerData(lc).catch(() => {}) : Promise.resolve();
        }));
      })
      .catch((err) => {
        console.error('Data load failed:', err);
      })
      .finally(() => {
        throttledRender(v);
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
        throttledRender(v);
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
  const showMeasureToolRef = useRef(false);
  useEffect(() => { showMeasureToolRef.current = showMeasureTool; }, [showMeasureTool]);

  // Render measure points, polyline, and polygon on globe
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    // Clear previous measure entities
    measureEntitiesRef.current.forEach(e => v.entities.remove(e));
    measureEntitiesRef.current = [];
    if (!showMeasureTool || measurePoints.length === 0) return;

    const ents: Cesium.Entity[] = [];
    const pts = measurePoints.map(p =>
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 1)
    );

    // Point markers
    for (let i = 0; i < measurePoints.length; i++) {
      ents.push(v.entities.add({
        position: pts[i],
        point: {
          pixelSize: 6,
          color: Cesium.Color.fromCssColorString('#f59e0b'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1.5,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(100, 1.0, 50000, 0.4),
        },
        label: {
          text: `${i + 1}`,
          font: 'bold 12px monospace',
          fillColor: Cesium.Color.WHITE,
          backgroundColor: new Cesium.Color(0, 0, 0, 0.6),
          showBackground: true,
          pixelOffset: new Cesium.Cartesian2(12, -8),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(100, 1.0, 50000, 0.0),
        },
        properties: { layer: 'measure_tool', type: 'point', index: i },
      }));
    }

    // Polyline connecting points (open path)
    if (pts.length >= 2) {
      ents.push(v.entities.add({
        polyline: {
          positions: pts,
          width: 2.5,
          material: new Cesium.PolylineOutlineMaterialProperty({
            color: Cesium.Color.fromCssColorString('#f59e0b'),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1,
          }),
          clampToGround: true,
        },
        properties: { layer: 'measure_tool', type: 'polyline' },
      }));
    }

    // Polygon fill only when 3+ points (closed shape)
    if (pts.length >= 3) {
      // Compute polygon area via 3D triangulation (fan from first vertex)
      let area3d = 0;
      const ref = pts[0];
      for (let i = 1; i < pts.length - 1; i++) {
        const v1 = new Cesium.Cartesian3();
        const v2 = new Cesium.Cartesian3();
        Cesium.Cartesian3.subtract(pts[i], ref, v1);
        Cesium.Cartesian3.subtract(pts[i + 1], ref, v2);
        const cross = Cesium.Cartesian3.cross(v1, v2, new Cesium.Cartesian3());
        area3d += Cesium.Cartesian3.magnitude(cross) / 2;
      }
      setMeasureArea(area3d / 1e6);

      // Visual polygon fill (semi-transparent) — always closed
      ents.push(v.entities.add({
        polygon: {
          hierarchy: pts,
          material: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.12),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.6),
          outlineWidth: 1.5,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        properties: { layer: 'measure_tool', type: 'polygon' },
      }));

      // Closing edge polyline (last → first) shown as dashed
      const closePositions = [pts[pts.length - 1], pts[0]];
      ents.push(v.entities.add({
        polyline: {
          positions: closePositions,
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.5),
          }),
          clampToGround: true,
        },
        properties: { layer: 'measure_tool', type: 'close_edge' },
      }));
    }

    measureEntitiesRef.current = ents;
    throttledRender(v);
  }, [showMeasureTool, measurePoints]);

  // Sample terrain heights for more accurate distance (overrides ellipsoid value)
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || measurePoints.length < 2) return;
    const t = v.terrainProvider;
    if (!t || !Cesium.sampleTerrain) return;
    const cartos = measurePoints.map(p =>
      new Cesium.Cartographic(Cesium.Math.toRadians(p.lon), Cesium.Math.toRadians(p.lat), 0)
    );
    let stop = false;
    Cesium.sampleTerrain(t, 11, cartos).then(() => {
      if (stop) return;
      let total = 0;
      for (let i = 1; i < cartos.length; i++) {
        const a = cartos[i - 1], b = cartos[i];
        const ca = Cesium.Cartesian3.fromRadians(a.longitude, a.latitude, a.height ?? 0);
        const cb = Cesium.Cartesian3.fromRadians(b.longitude, b.latitude, b.height ?? 0);
        total += Cesium.Cartesian3.distance(ca, cb);
      }
      setMeasureDistance(total);
    });
    return () => { stop = true; };
  }, [measurePoints]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const v = viewerRef.current;
        if (v && focusMarkerRef.current) { v.entities.remove(focusMarkerRef.current); focusMarkerRef.current = null; }
        if (focusMarkerTimerRef.current) { clearTimeout(focusMarkerTimerRef.current); focusMarkerTimerRef.current = null; }
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
      const meta = cctvMetaRef.current.get(infoEntity.id);
      const lat = (meta?.lat as number) ?? (props.lat as number);
      const lon = (meta?.lon as number) ?? (props.lon as number);
      if (lat == null || lon == null) { setCctvPreviewTick(0); return; }
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

  useEffect(() => {
    if (!isLoggedIn) return;
    const token = auth.token || localStorage.getItem('auth_token');
    const url = `/api/social/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const es = new EventSource(url);
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    es.addEventListener('items', (e: MessageEvent) => {
      try {
        const items = JSON.parse(e.data) as any[];
        if (!Array.isArray(items)) return;
        for (const item of items) {
          if (!item.id || intelFeedRef.current.find(i => i.id === item.id)) continue;
          if (item.youtubeVideoId || extractYoutubeId(item.url)) {
            if (!item.lat && !item.lon) {
              const geo = geoFromText(item.title || '');
              if (geo.lat || geo.lon) { item.lat = geo.lat; item.lon = geo.lon; }
            }
            if (item.lat && item.lon) addYoutubeEntity(item);
            continue;
          }
          pushIntelFeed({
            id: item.id,
            title: item.title ?? '',
            source: item.source ?? '',
            type: item.type ?? 'news',
            lat: item.lat || 0,
            lon: item.lon || 0,
            timestamp: item.timestamp ?? Date.now(),
            url: item.url,
            platform: item.platform,
          });
        }
      } catch { /* ignore malformed SSE data */ }
    });

    es.addEventListener('enriched', (e: MessageEvent) => {
      try {
        const items = JSON.parse(e.data) as any[];
        if (!Array.isArray(items)) return;
        for (const item of items) {
          if (!item.id) continue;
          if (item.youtubeVideoId || extractYoutubeId(item.url)) {
            if (item.lat && item.lon) addYoutubeEntity(item);
            continue;
          }
          const existing = intelFeedRef.current.find(i => i.id === item.id);
          if (existing) {
            if (item.lat) existing.lat = item.lat;
            if (item.lon) existing.lon = item.lon;
          }
        }
      } catch { /* ignore */ }
    });

    es.onerror = () => {
      es.close();
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        fetch('/api/social', { headers: { ...authHeaders() } })
          .then(r => r.ok ? r.json() : [])
          .then((items: any[]) => {
            for (const item of items) {
              if (!item.id || intelFeedRef.current.find(i => i.id === item.id)) continue;
              if (item.youtubeVideoId || extractYoutubeId(item.url)) {
                if (!item.lat && !item.lon) {
                  const geo = geoFromText(item.title || '');
                  if (geo.lat || geo.lon) { item.lat = geo.lat; item.lon = geo.lon; }
                }
                if (item.lat && item.lon) addYoutubeEntity(item);
                continue;
              }
              pushIntelFeed({
                id: item.id,
                title: item.title ?? '',
                source: item.source ?? '',
                type: item.type ?? 'news',
                lat: item.lat || 0,
                lon: item.lon || 0,
                timestamp: item.timestamp ?? Date.now(),
                url: item.url,
                platform: item.platform,
              });
            }
          })
          .catch(() => {});
      }, 60000);
    };

    return () => {
      es.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, auth.token]);

  async function loadFlightTracks(viewer: Cesium.Viewer) {
    const gen = (loadGenRef.current['flight_tracks'] = (loadGenRef.current['flight_tracks'] ?? 0) + 1);
    if (!isLayerEnabled('flight_tracks')) return;
    flightDrRef.current?.clear();
    removeLayerEntities('flight_tracks');

    const cam = viewer.camera.positionCartographic;
    const lat = cam ? (cam.latitude * 180 / Math.PI).toFixed(2) : '';
    const lon = cam ? (cam.longitude * 180 / Math.PI).toFixed(2) : '';
    const locParam = (lat && lon) ? `?lat=${lat}&lon=${lon}` : '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const data = await apiGet<{ states?: unknown[][] | null }>(`/flights/all${locParam}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (loadGenRef.current['flight_tracks'] !== gen) return;
      if (!isLayerEnabled('flight_tracks')) return;
      if (!data.states?.length) {
        showNotification('No aircraft data available', 'warning');
        return;
      }
      flightDrRef.current?.updateFromApi(data.states);
      flightDrRef.current?.start();
      throttledRender(viewer);
      showNotification(`Loaded ${data.states.length} live aircraft (combined sources)`, 'success');
    } catch {
      clearTimeout(timeout);
      showNotification('Flight tracking unavailable', 'warning');
    }
  }

  function pushIntelFeed(item: Omit<IntelFeedItem, 'timeLabel'>) {
    const entry: IntelFeedItem = {
      ...item,
      timeLabel: new Date(item.timestamp).toLocaleTimeString('en-IN', { timeZone: getTimezone(), hour: '2-digit', minute: '2-digit', hour12: true }),
    };
    const next = [entry, ...intelFeedRef.current.filter(i => i.id !== item.id)];
    next.sort((a, b) => b.timestamp - a.timestamp); // Keep newest at the top
    const sliced = next.slice(0, 500); // Increase limit to 500 to hold bulk loads
    intelFeedRef.current = sliced;
    setIntelFeed(sliced);
  }

  function addYoutubeEntity(item: { id: string; title: string; lat: number; lon: number; url?: string; source?: string }) {
    const v = viewerRef.current;
    if (!v || !isLayerEnabled('live_media')) {
      console.warn('[LiveMedia] addYoutubeEntity skipped: viewer/layer disabled');
      return;
    }
    const existing = entityStoreRef.current['live_media'];
    if (existing?.find(e => e.id === item.id)) {
      console.warn('[LiveMedia] addYoutubeEntity skipped: duplicate', item.title?.slice(0, 50));
      return;
    }
    const videoId = extractYoutubeId(item.url);
    if (!videoId) {
      console.warn('[LiveMedia] addYoutubeEntity skipped: no videoId', item.url);
      return;
    }
    console.warn('[LiveMedia] Creating entity', item.title?.slice(0, 50), `@(${item.lat},${item.lon})`, videoId);
    const ent = v.entities.add({
      id: item.id,
      position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, 0),
      name: item.title,
      billboard: {
        image: createYoutubeIcon(),
        width: 32, height: 32,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: 10000,
        pixelOffset: new Cesium.Cartesian2(0, -2),
      },
      label: {
        text: item.title,
        font: '10px "JetBrains Mono"',
        fillColor: Cesium.Color.fromCssColorString('#ef4444'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cesium.Cartesian2(0, -24),
        show: false,
      },
      properties: {
        layer: 'live_media',
        title: item.title,
        lat: item.lat,
        lon: item.lon,
        source: item.source,
        url: item.url,
        youtubeVideoId: videoId,
      },
    });
    const store = entityStoreRef.current['live_media'] || [];
    if (!store.find(e => e.id === item.id)) {
      store.push(ent);
    }
    entityStoreRef.current['live_media'] = store;
    throttledRender(v);
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
        pushIntelFeed({
            id: `eq-${p.time}`,
            title: `M${m.toFixed(1)} ${String(p.place ?? '')}`,
            source: 'USGS',
            type: 'earthquake',
            lat: c[1],
            lon: c[0],
            timestamp: Number(p.time ?? Date.now()),
            url: String(p.url ?? `https://earthquake.usgs.gov/earthquakes/search/`),
            platform: 'internal',
            desc: `Magnitude ${m.toFixed(1)} at ${String(p.place ?? 'unknown location')}`,
          });
        return addEarthquakeEntity(viewer, f);
      });
      entityStoreRef.current['earthquakes'] = ents;
      enforceEntityCap();
      if (!isLayerEnabled('earthquakes')) {
        setLayerEntitiesVisible('earthquakes', false);
      }
    } catch (err) {
      recordFeedError('earthquakes', err);
    }
  }

  const eonetCategoriesRef = useRef<Set<string>>(new Set());

  async function loadEonetEvents(viewer: Cesium.Viewer) {
    const gen = (loadGenRef.current['eonet'] = (loadGenRef.current['eonet'] ?? 0) + 1);
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
      if (loadGenRef.current['eonet'] !== gen) return;
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
        pushIntelFeed({
            id: `eonet-${ev.id}`,
            title: String(ev.title ?? 'Event'),
            source: 'NASA EONET',
            type: cat === 'wildfires' ? 'fire' : cat === 'severe_storms' ? 'storm' : cat === 'floods' ? 'flood' : cat,
            lat: c[1],
            lon: c[0],
            timestamp: new Date(geo[0].date).getTime() || Date.now(),
            url: String(ev.link ?? `https://eonet.gsfc.nasa.gov/api/v3/events/${String(ev.id ?? '')}`),
            platform: 'internal'
          });
      }
      for (const key of eonetLayers) {
        if (!isLayerEnabled(key)) {
          setLayerEntitiesVisible(key, false);
        }
      }
      enforceEntityCap();
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
      const groups = new Map<string, { title: string; desc: string; count: number; lat: number; lon: number }>();
      for (const f of (data.features ?? []).slice(0, 50)) {
        const p = f.properties;
        const coords = f.geometry?.coordinates;
        let lat = 0, lon = 0;
        if (f.geometry?.type === 'Point' && Array.isArray(coords) && coords.length >= 2) {
          lon = Number(coords[0]); lat = Number(coords[1]);
        } else if (f.geometry?.type === 'Polygon' && Array.isArray(coords) && Array.isArray(coords[0])) {
          const ring = coords[0] as number[][];
          lon = ring.reduce((s, c) => s + Number(c[0]), 0) / ring.length;
          lat = ring.reduce((s, c) => s + Number(c[1]), 0) / ring.length;
        }
        if (!isFinite(lat) || !isFinite(lon)) continue;
        const title = String(p.event ?? p.headline ?? 'Weather Alert');
        const desc = String(p.description ?? '').slice(0, 300);
        if (groups.has(title)) {
          const g = groups.get(title)!;
          g.count++;
          if (desc.length > g.desc.length) g.desc = desc;
        } else {
          groups.set(title, { title, desc, count: 1, lat, lon });
        }
      }
      for (const g of groups.values()) {
        pushIntelFeed({
          id: `nws-${g.title}`,
          title: g.count > 1 ? `${g.title} (${g.count} alerts)` : g.title,
          source: 'NWS',
          type: 'weather',
          lat: g.lat, lon: g.lon,
          timestamp: Date.now(),
          url: 'https://www.weather.gov/',
          platform: 'internal',
          desc: g.desc,
        });
      }
      entityStoreRef.current['disaster_alerts'] = [];
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
      enforceEntityCap();
    } catch (err) {
      recordFeedError('space weather', err);
    }
  }

  const loadAllData = useCallback(async (viewer: Cesium.Viewer) => {
    feedErrorsRef.current = [];
    feedSummaryShownRef.current = false;
    // The viewer (and the whole Cesium context) may have been torn down while
    // this async routine was queued (e.g. unmount / hot reload).
    if (viewer.isDestroyed()) return;

    // Only load data for layers that are actually enabled at startup
    const startupLoads: Promise<void>[] = [];
    if (isLayerEnabled('earthquakes')) {
      startupLoads.push(loadEarthquakes(viewer));
    }
    if (isLayerEnabled('wildfires') || isLayerEnabled('severe_storms') || isLayerEnabled('volcanoes')
      || isLayerEnabled('floods') || isLayerEnabled('dust') || isLayerEnabled('seaLakeIce')) {
      startupLoads.push(loadEonetEvents(viewer));
    }
    if (isLayerEnabled('tectonic')) {
      startupLoads.push(
        apiGet<Record<string, unknown>>('/tectonic').then(async (geo) => {
          if (viewer.isDestroyed()) return;
          const src = await loadTectonicPlates(viewer, geo);
          entityStoreRef.current['tectonic'] = [...src.entities.values];
        }).catch((err) => {
          recordFeedError('tectonic plates', err);
        })
      );
    }
    if (isLayerEnabled('disaster_alerts')) {
      startupLoads.push(loadNwsAlerts(viewer));
    }
    if (isLayerEnabled('space_weather')) {
      startupLoads.push(loadSpaceWeather(viewer));
    }

    await Promise.all(startupLoads);

    // The viewer may have been destroyed while the network requests above were
    // in flight — stop before touching any Cesium API.
    if (viewer.isDestroyed()) return;

    if (isLayerEnabled('flight_tracks')) {
      await loadFlightTracks(viewer);
    }

    if (isLayerEnabled('airports')) {
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
          updateCounts();
        })
        .catch((err) => recordFeedError('airports', err));
    }

    showFeedSummaryOnce();
    updateCounts();

    setLoadingProgress(70);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshLiveData(viewer: Cesium.Viewer) {
    if (viewer.isDestroyed()) return;
    if (isLayerEnabled('earthquakes')) await loadEarthquakes(viewer);
    if (isLayerEnabled('wildfires') || isLayerEnabled('severe_storms') || isLayerEnabled('volcanoes')
      || isLayerEnabled('floods') || isLayerEnabled('dust') || isLayerEnabled('seaLakeIce')) {
      await loadEonetEvents(viewer);
    }
    if (isLayerEnabled('flight_tracks')) await loadFlightTracks(viewer);
    if (isLayerEnabled('2_adsb_lol')) await loadAdsbLolFlights(viewer);
    if (isLayerEnabled('2_adsb_fi')) await loadAdsbFiFlights(viewer);
    if (isLayerEnabled('2_airlabs_api')) await loadAirlabsFlights(viewer);
    if (isLayerEnabled('2_military_flights')) await loadMilitaryFlights(viewer);
    if (isLayerEnabled('ucdp_conflict')) await loadUcdp(viewer);
    if (isLayerEnabled('military_bases')) await loadMilitaryBases(viewer);
    if (isLayerEnabled('lightning_strikes')) await loadLightningStrikes(viewer);
    if (isLayerEnabled('aurora_oval')) await loadAuroraOval(viewer);
    if (isLayerEnabled('space_weather')) await loadSpaceWeather(viewer);
    if (isLayerEnabled('disaster_alerts')) await loadNwsAlerts(viewer);
    if (isLayerEnabled('india_cctv')) await loadIndiaCctv(viewer);
    if (isLayerEnabled('live_media')) await loadLiveMedia(viewer);
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
    throttledRender(viewer);
  }

  async function refreshGenericLayers(viewer: Cesium.Viewer, groups: string[]) {
    if (viewer.isDestroyed()) return;
    const groupSet = new Set(groups);
    // Quick check: skip entirely if no layers in these groups are enabled
    const hasEnabled = LAYER_CATEGORIES.some(l => groupSet.has(l.group) && isLayerEnabled(l.id));
    if (!hasEnabled) return;
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
      const gen = (loadGenRef.current[layer.id] = (loadGenRef.current[layer.id] ?? 0) + 1);
      try {
        const items = await fetchLayerData(layer);
        if (viewer.isDestroyed()) return;
        if (loadGenRef.current[layer.id] !== gen) continue;
        if (!isLayerEnabled(layer.id)) continue;
        // Skip destroy+recreate if data is unchanged
        const cached = layerDataCacheRef.current[layer.id];
        if (cached && cached.length === items.length) {
          let same = true;
          for (let i = 0; i < cached.length; i++) {
            const c = cached[i] as Record<string, unknown>, n = items[i] as Record<string, unknown>;
            if (c.lat !== n.lat || c.lon !== n.lon || c.name !== n.name || c.magnitude !== n.magnitude ||
                c.depth !== n.depth || c.category !== n.category || c.status !== n.status) {
              same = false;
              break;
            }
          }
          if (same) continue;
        }
        removeLayerEntities(layer.id);
        if (items.length) {
          const keys = Object.keys(layerDataCacheRef.current);
          if (keys.length > LAYER_CACHE_MAX) {
            for (const k of keys.slice(0, keys.length - LAYER_CACHE_MAX)) delete layerDataCacheRef.current[k];
          }
          layerDataCacheRef.current[layer.id] = items;
          const ents = await renderLayer(viewer, layer, items, ghostProtocolRef.current ?? undefined);
          if (loadGenRef.current[layer.id] !== gen) continue;
          entityStoreRef.current[layer.id] = ents;
          enforceEntityCap();
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
      'smoke_dispersion',
      'disaster_near_me',
    ]);
    const visibleEntities = v.entities.values.filter(e => {
      const p = e.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      const layer = p?.layer as string | undefined;
      return !layer || !ignoreLayers.has(layer);
    });
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

  const pulsingDotCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const PULSING_DOT_CACHE_MAX = 200;

  function createPulsingDotCanvas(color: string, size: number = 16): HTMLCanvasElement {
    if (pulsingDotCacheRef.current.size > PULSING_DOT_CACHE_MAX) pulsingDotCacheRef.current.clear();
    const key = `${color}_${size}`;
    const cached = pulsingDotCacheRef.current.get(key);
    if (cached) return cached;
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
    pulsingDotCacheRef.current.set(key, canvas);
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

  let cachedAirportIcon: HTMLCanvasElement | null = null;
  function createAirportIcon(): HTMLCanvasElement {
    if (cachedAirportIcon) return cachedAirportIcon;
    const canvas = document.createElement('canvas');
    canvas.width = 12; canvas.height = 12;
    const ctx = canvas.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(6, 6, 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#14b8a6';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    cachedAirportIcon = canvas;
    return canvas;
  }

  const focusLocation = useCallback((lat: number, lon: number, options?: { label?: string; color?: string; height?: number; duration?: number; rect?: { west: number; south: number; east: number; north: number }; }) => {
    const v = viewerRef.current;
    if (!v) return;
    if (focusMarkerRef.current) {
      v.entities.remove(focusMarkerRef.current);
      focusMarkerRef.current = null;
    }
    if (focusMarkerTimerRef.current) {
      clearTimeout(focusMarkerTimerRef.current);
      focusMarkerTimerRef.current = null;
    }
    const height = options?.height ?? 20000;
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
        font: '12px "Inter", sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        backgroundColor: Cesium.Color.fromCssColorString('#0b1220').withAlpha(0.65),
        showBackground: true,
        backgroundPadding: new Cesium.Cartesian2(6, 4),
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        pixelOffset: new Cesium.Cartesian2(0, -6),
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
    // Auto-hide the marker + label after a few seconds so it doesn't linger.
    focusMarkerTimerRef.current = setTimeout(() => {
      const v2 = viewerRef.current;
      if (v2 && focusMarkerRef.current) {
        v2.entities.remove(focusMarkerRef.current);
        focusMarkerRef.current = null;
      }
      focusMarkerTimerRef.current = null;
    }, 6000);
    const range = Math.max(height, 500);
    if (options?.rect) {
      // Fit the ENTIRE area to the viewport (Cesium auto-frames the rectangle) —
      // not too far, not too close. Pad slightly so the boundary isn't clipped.
      const { west, south, east, north } = options.rect;
      const padLon = Math.max((east - west) * 0.08, 0.02);
      const padLat = Math.max((north - south) * 0.08, 0.02);
      v.camera.flyTo({
        destination: Cesium.Rectangle.fromDegrees(west - padLon, south - padLat, east + padLon, north + padLat),
        orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: options?.duration ?? 2.5,
      });
    } else {
      v.flyTo(marker, {
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(20),
          Cesium.Math.toRadians(-90),
          range,
        ),
        duration: options?.duration ?? 2.5,
      });
    }
  }, []);

  const trackSatellite = useCallback((sat: { id: string; name: string; lat: number; lon: number; altitude: number; tle1: string; tle2: string }) => {
    const v = viewerRef.current;
    if (!v) return;

    // Clean up previous
    if (trackedSatIntervalRef.current) { clearInterval(trackedSatIntervalRef.current); trackedSatIntervalRef.current = null; }
    if (trackedSatRenderTickRef.current) { trackedSatRenderTickRef.current(); trackedSatRenderTickRef.current = null; }
    if (trackedSatRef.current) { v.entities.remove(trackedSatRef.current); trackedSatRef.current = null; }
    if (trackedSatTrailEntityRef.current) { v.entities.remove(trackedSatTrailEntityRef.current); trackedSatTrailEntityRef.current = null; }

    const rec = satellite.twoline2satrec(sat.tle1, sat.tle2);
    trackedSatTleRef.current = { tle1: sat.tle1, tle2: sat.tle2 };

    // ── Trail polyline with arrow material for direction ──
    const TRAIL_MAX = 120;
    const trailPositions: Cesium.Cartesian3[] = [];

    const trailEntity = v.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => trailPositions, false),
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString('#00D4FF').withAlpha(0.6),
          dashLength: 12,
        }),
        arcType: Cesium.ArcType.NONE,
      },
    });
    trackedSatTrailEntityRef.current = trailEntity;

    // ── Current position (SampledPositionProperty — updated every 2s, interpolated between samples) ──
    const posProp = new Cesium.SampledPositionProperty();
    posProp.forwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE;
    posProp.backwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE;
    // Seed initial position
    try {
      const pv = satellite.propagate(rec, new Date());
      if (pv && pv.position && isFinite(pv.position.x)) {
        const gmst = satellite.gstime(new Date());
        const gd = satellite.eciToGeodetic(pv.position, gmst);
        const pos = Cesium.Cartesian3.fromDegrees(satellite.degreesLong(gd.longitude), satellite.degreesLat(gd.latitude), gd.height * 1000);
        posProp.addSample(Cesium.JulianDate.now(), pos);
        if (pv.velocity && isFinite(pv.velocity.x)) {
          const vx = pv.velocity.x, vy = pv.velocity.y, vz = pv.velocity.z;
          trackedSatSpeedRef.current = Math.sqrt(vx*vx + vy*vy + vz*vz);
        }
      }
    } catch { /* ignore */ }

    const entity = v.entities.add({
      position: posProp,
      point: { pixelSize: 11, color: Cesium.Color.CYAN, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
      label: { text: sat.name, font: 'bold 10px "JetBrains Mono"', fillColor: Cesium.Color.WHITE,
        pixelOffset: new Cesium.Cartesian2(0, -18) },
      properties: { layer: 'tracked_satellite', satId: sat.id },
    });
    trackedSatRef.current = entity;

    // Seed trail with a 2-minute arc
    const now = new Date();
    for (let t = -120; t <= 0; t += 5) {
      const date = new Date(now.getTime() + t * 1000);
      const pv = satellite.propagate(rec, date);
      if (!pv || !pv.position || !isFinite(pv.position.x)) continue;
      const gmst = satellite.gstime(date);
      const gd = satellite.eciToGeodetic(pv.position, gmst);
      const pos = Cesium.Cartesian3.fromDegrees(satellite.degreesLong(gd.longitude), satellite.degreesLat(gd.latitude), gd.height * 1000);
      trailPositions.push(pos);
    }

    // Fly to entity
    v.flyTo(entity, {
      duration: 2,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-25), 20000),
    });

    // Force render every frame
    trackedSatRenderTickRef.current = v.clock.onTick.addEventListener(() => {
      if (trackedSatRef.current) throttledRender(v);
    });

    // Update both position and trail every 2s
    trackedSatIntervalRef.current = setInterval(() => {
      const date = new Date();
      try {
        const pv = satellite.propagate(rec, date);
        if (!pv || !pv.position || !isFinite(pv.position.x)) return;
        if (pv.velocity && isFinite(pv.velocity.x)) {
          const vx = pv.velocity.x, vy = pv.velocity.y, vz = pv.velocity.z;
          trackedSatSpeedRef.current = Math.sqrt(vx*vx + vy*vy + vz*vz);
        }
        const gmst = satellite.gstime(date);
        const gd = satellite.eciToGeodetic(pv.position, gmst);
        const lat = satellite.degreesLat(gd.latitude);
        const lon = satellite.degreesLong(gd.longitude);
        const alt = gd.height * 1000;
        const pos = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
        posProp.addSample(Cesium.JulianDate.now(), pos);
        trailPositions.push(Cesium.Cartesian3.clone(pos));
        if (trailPositions.length > TRAIL_MAX) trailPositions.splice(0, trailPositions.length - TRAIL_MAX);
        throttledRender(v);
      } catch { /* ignore */ }
    }, 2000);

    trackedSatPosPropRef.current = posProp;
    trackedSatNameRef.current = sat.name;
  }, []);

  const travelToTrackedSatellite = useCallback(() => {
    const v = viewerRef.current;
    const posProp = trackedSatPosPropRef.current;
    const name = trackedSatNameRef.current;
    if (!v || !posProp || !name) return;
    if (satTravelRef.current) exitSatelliteTravel(v);
    enterSatelliteTravel(v, posProp, name);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flyToIndiaDirect() {
    const v = viewerRef.current;
    if (!v) return;
    setImagery('satellite');
    if (focusMarkerRef.current) {
      v.entities.remove(focusMarkerRef.current);
      focusMarkerRef.current = null;
    }
    if (focusMarkerTimerRef.current) { clearTimeout(focusMarkerTimerRef.current); focusMarkerTimerRef.current = null; }
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

  const isLayerEnabled = useCallback((layerId: string) => {
    return layersRef.current.find(l => l.id === layerId)?.on ?? false;
  }, []);

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
        next.forEach(ent => {
          ghostProtocolRef.current?.removeGhost(ent.id);
          clearEntityProperties(ent);
          v.entities.remove(ent);
        });
      }
      entityStoreRef.current[id] = [];
    }
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
      throttledRender(v);
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
            throttledRender(vv);
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
  }

  /* ═════════════════════════════════════════════════════════════════
     INFO PANEL
     ═════════════════════════════════════════════════════════════════ */

  const showInfoPanel = useCallback((entity: Cesium.Entity) => {
    const props = entity.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
    if (!props || Object.keys(props).length === 0) {
      setInfoEntity(null);
      entityTrackerRef.current?.untrack();
      return;
    }
    setInfoEntity(entity);
    focusPanel('info');

    if (props.layer === 'earthquakes' && props.magnitude) {
      const m = props.magnitude as number;
      const lat = props.lat as number;
      const lon = props.lon as number;
      if (m >= 4.0) triggerSeismicWaves(lon, lat, m);
      const pi = calculatePopulationImpact(lat, lon);
      if (pi) setPopulationImpact(pi);
      else setPopulationImpact(null);
    } else {
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
      window.__terranoetisDebug = {
        ...(window.__terranoetisDebug ?? {}),
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
      showNotification(`M${mag.toFixed(1)} earthquake detected`, 'error');
      if (mag >= 6.5) requestNotification(`M${mag.toFixed(1)} Earthquake Alert`, place);
      pushIntelFeed({
        id: `mag_${time}`,
        title: `M${mag.toFixed(1)} Earthquake: ${place}`,
        source: 'USGS',
        type: 'earthquake',
        lat, lon,
        timestamp: Date.now(),
        url: `https://earthquake.usgs.gov/earthquakes/eventpage/${time}`,
        platform: 'internal',
      });
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
    console.warn(`[Terranoetis] ${source} unavailable`, err);
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
    const photo = photorealGlobeRef.current;

    // ── PHOTOREAL: tileset on top of current base imagery (fills tile gaps) ──
    if (type === 'photoreal') {
      if (!photo) return;
      if (photo.isPhotoreal) {
        photo.disable();
        setPhotoreal(false);
        setActiveImagery('satellite');
        replaceBaseImagery(v, 'satellite');
        showNotification('Satellite imagery restored', 'success');
      } else {
        setActiveImagery('photoreal');
        void photo.enable().then(ok => {
          setPhotoreal(ok);
          if (!ok) {
            setActiveImagery('satellite');
            replaceBaseImagery(v, 'satellite');
          }
        });
      }
      return;
    }

    // Leaving photoreal → tear the tileset down
    if (photo?.isPhotoreal) {
      photo.disable();
      setPhotoreal(false);
    }

    // Clicking the already-active chip → revert to satellite (default)
    if (type === activeImagery) {
      setActiveImagery('satellite');
      if (type === 'terrain') {
        imageryGenRef.current += 1; // invalidate any in-flight terrain apply
        v.terrainProvider = new Cesium.EllipsoidTerrainProvider();
        throttledRender(v);
        replaceBaseImagery(v, 'satellite');
        showNotification('3D terrain disabled — satellite view restored', 'success');
      } else {
        replaceBaseImagery(v, 'satellite');
        showNotification('Satellite imagery restored', 'success');
      }
      return;
    }

    setActiveImagery(type);

    if (type === 'terrain') {
      imageryGenRef.current += 1;
      const gen = imageryGenRef.current;
      void (async () => {
        const enabled = await applyTerrainProvider(v, cesiumIonToken);
        if (gen !== imageryGenRef.current) return;
        replaceBaseImagery(v, 'terrain');
        showNotification(
          enabled ? '3D terrain enabled' : 'Terrain needs a Cesium ion token',
          enabled ? 'success' : 'warning',
        );
        throttledRender(v);
      })();
      return;
    }

    const mapType = type === 'satellite' ? 'satellite' : 'earth';
    replaceBaseImagery(v, mapType);
  }, [cesiumIonToken, activeImagery]);

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
        properties: { layer: 'weather_cards', title: 'Weather Location', lat, lon, cardId: id, time: Date.now() },
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
      if (satTravelRef.current) exitSatelliteTravel(v);
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
      if (issEntityRef.current) throttledRender(v);
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
              billboard: { image: createISSIcon(), width: 28, height: 28 },
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
          throttledRender(v);
        })
        .catch(() => {
          showNotification('ISS position feed unavailable', 'warning');
        })
        .finally(() => { issLoadingRef.current = false; });
    }, 5000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ═════════════════════════════════════════════════════════════════
     ISS TRAVEL VIEW — first-person onboard camera (live orbit, no driving)
     ═════════════════════════════════════════════════════════════════ */

  const SAT_TRAVEL_PITCH_MIN = 0;                                   // straight down (nadir)
  const SAT_TRAVEL_PITCH_MAX = Cesium.Math.toRadians(85);           // near horizon
  const SAT_TRAVEL_FOV_MIN = Cesium.Math.toRadians(15);
  const SAT_TRAVEL_FOV_MAX = Cesium.Math.toRadians(90);

  // Flight Travel View — chase-cam constants (distinct from satellite nadir view)
  const FLIGHT_TRAVEL_CHASE_DIST = 1800;                          // metres behind the aircraft
  const FLIGHT_TRAVEL_CHASE_HEIGHT = 480;                         // metres above the aircraft
  const FLIGHT_TRAVEL_PITCH = Cesium.Math.toRadians(-14);        // default chase look-down (rad)
  const FLIGHT_TRAVEL_PITCH_MIN = Cesium.Math.toRadians(-80);    // can look back/down
  const FLIGHT_TRAVEL_PITCH_MAX = Cesium.Math.toRadians(35);     // can look up
  const FLIGHT_TRAVEL_FOV = Cesium.Math.toRadians(65);               // default field of view (rad)
  const FLIGHT_TRAVEL_FOV_MIN = Cesium.Math.toRadians(25);
  const FLIGHT_TRAVEL_FOV_MAX = Cesium.Math.toRadians(90);


  // Per-frame: glue the camera to the live satellite position and orient it from yaw/pitch.
  // We pass heading/pitch/roll directly (roll = 0) instead of direction/up — Cesium
  // internally converts direction/up -> hpr and that round-trip inverts the up vector
  // (roll 180°), which flipped the Earth upside-down. hpr keeps "up" = zenith (upright).
  function updateTravelCamera(v: Cesium.Viewer) {
    const posProp = satTravelPosRef.current;
    if (!posProp) return;
    const pos = posProp.getValue(Cesium.JulianDate.now());
    if (!pos) return;

    const heading = satTravelYawRef.current;                         // azimuth, north=0, east=+90
    const pitch = satTravelPitchRef.current - Cesium.Math.PI_OVER_TWO; // depression-from-nadir -> cesium pitch (-90 nadir .. 0 horizon)

    const frustum = v.camera.frustum as Cesium.PerspectiveFrustum;
    frustum.fov = satTravelFovRef.current;

    v.camera.setView({ destination: pos, orientation: { heading, pitch, roll: 0 } });
  }

  // ~5 Hz HUD telemetry (avoids setState every frame)
  function updateTravelHud(v: Cesium.Viewer) {
    const posProp = satTravelPosRef.current;
    if (!posProp) return;
    const now = Cesium.JulianDate.now();
    const pos = posProp.getValue(now);
    if (!pos) return;
    const t1 = Cesium.JulianDate.addSeconds(now, 1, new Cesium.JulianDate());
    const pos1 = posProp.getValue(t1);
    const carto = Cesium.Cartographic.fromCartesian(pos);
    const az = (Cesium.Math.toDegrees(satTravelYawRef.current) % 360 + 360) % 360;
    const el = Cesium.Math.toDegrees(satTravelPitchRef.current) - 90; // -90 nadir .. 0 horizon .. +90 zenith
    let speed = 0;
    if (pos1) {
      const v = Cesium.Cartesian3.subtract(pos1, pos, new Cesium.Cartesian3());
      const w = 7.2921159e-5;
      const vx = v.x - w * pos.y;
      const vy = v.y + w * pos.x;
      const vz = v.z;
      speed = Math.sqrt(vx * vx + vy * vy + vz * vz) / 1000; // ECI speed in km/s
    }
    setSatTravelHud({
      lat: +Cesium.Math.toDegrees(carto.latitude).toFixed(3),
      lon: +Cesium.Math.toDegrees(carto.longitude).toFixed(3),
      altKm: +(carto.height / 1000).toFixed(1),
      az: +az.toFixed(0),
      el: +el.toFixed(0),
      speed: +speed.toFixed(2),
    });
  }

  function setupTravelDrag(v: Cesium.Viewer) {
    const canvas = v.scene.canvas;
    const SENS = Cesium.Math.toRadians(0.25);
    const onDown = (ev: PointerEvent) => { satTravelDragRef.current = { x: ev.clientX, y: ev.clientY, active: true }; };
    const onUp = () => { satTravelDragRef.current.active = false; };
    const onMove = (ev: PointerEvent) => {
      const d = satTravelDragRef.current;
      if (!d.active) return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      d.x = ev.clientX;
      d.y = ev.clientY;
      satTravelYawRef.current -= dx * SENS;
      satTravelPitchRef.current = Math.min(SAT_TRAVEL_PITCH_MAX, Math.max(SAT_TRAVEL_PITCH_MIN, satTravelPitchRef.current + dy * SENS));
    };
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointermove', onMove);
    satTravelDragCleanupRef.current = () => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
    };
  }

  function satTravelKeyHandler(e: KeyboardEvent) {
    if (!satTravelRef.current) return;
    const STEP = Cesium.Math.toRadians(6);
    const FOV = Cesium.Math.toRadians(5);
    switch (e.key) {
      case 'ArrowLeft': satTravelYawRef.current -= STEP; e.preventDefault(); break;
      case 'ArrowRight': satTravelYawRef.current += STEP; e.preventDefault(); break;
      case 'ArrowUp': satTravelPitchRef.current = Math.min(SAT_TRAVEL_PITCH_MAX, satTravelPitchRef.current + STEP); e.preventDefault(); break;
      case 'ArrowDown': satTravelPitchRef.current = Math.max(SAT_TRAVEL_PITCH_MIN, satTravelPitchRef.current - STEP); e.preventDefault(); break;
      case 'q': case 'Q': satTravelYawRef.current += Math.PI; break;
      case 'r': case 'R': satTravelPitchRef.current = SAT_TRAVEL_PITCH_MIN; break;
      case 'f': case 'F': satTravelPitchRef.current = Cesium.Math.toRadians(80); break;
      case '+': case '=': satTravelFovRef.current = Math.max(SAT_TRAVEL_FOV_MIN, satTravelFovRef.current - FOV); break;
      case '-': case '_': satTravelFovRef.current = Math.min(SAT_TRAVEL_FOV_MAX, satTravelFovRef.current + FOV); break;
      case 'Escape': { const v = viewerRef.current; if (v) exitSatelliteTravel(v); break; }
    }
  }

  // Forward heading (azimuth) of the satellite's actual direction of travel,
  // derived from its live position samples — so the default view is "where it's pointing",
  // not a fixed north. Recomputed every boarding, so a different satellite yields a different default.
  function getSatForwardAzimuth(posProp: Cesium.PositionProperty): number {
    const t0 = Cesium.JulianDate.now();
    const t1 = Cesium.JulianDate.addSeconds(t0, 20, new Cesium.JulianDate());
    const p0 = posProp.getValue(t0);
    const p1 = posProp.getValue(t1);
    if (!p0 || !p1) return 0;
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(p0);
    const eAxis = new Cesium.Cartesian3(enu[0], enu[4], enu[8]);
    const nAxis = new Cesium.Cartesian3(enu[1], enu[5], enu[9]);
    const vel = Cesium.Cartesian3.subtract(p1, p0, new Cesium.Cartesian3());
    const eastComp = Cesium.Cartesian3.dot(vel, eAxis);
    const northComp = Cesium.Cartesian3.dot(vel, nAxis);
    if (Math.abs(eastComp) < 1e-9 && Math.abs(northComp) < 1e-9) return 0;
    return Math.atan2(eastComp, northComp); // matches h = e*sin(az) + n*cos(az)
  }

  function enterSatelliteTravel(v: Cesium.Viewer, posProp: Cesium.PositionProperty, name: string) {
    if (flightTravelRef.current) exitFlightTravel(v);
    satTravelRef.current = true;
    setSatTravel(true);
    // Ensure position property can always return a value (debris etc. may lack extrapolation)
    if ('forwardExtrapolationType' in posProp) {
      (posProp as Cesium.SampledPositionProperty).forwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE;
      (posProp as Cesium.SampledPositionProperty).backwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE;
    }
    satTravelPosRef.current = posProp;
    satTravelNameRef.current = name;
    // remember the current globe camera so we can return to the exact same spot on exit
    satTravelSavedViewRef.current = {
      pos: Cesium.Cartesian3.clone(v.camera.position),
      hdg: v.camera.heading,
      pitch: v.camera.pitch,
      roll: v.camera.roll,
    };
    // default look = ahead along the orbit, looking straight down at Earth (nadir)
    satTravelYawRef.current = getSatForwardAzimuth(posProp);
    satTravelPitchRef.current = SAT_TRAVEL_PITCH_MIN;
    satTravelFovRef.current = Cesium.Math.toRadians(60);

    // Position camera at the satellite immediately (preRender starts on next frame)
    const initPos = posProp.getValue(Cesium.JulianDate.now());
    if (initPos) {
      v.camera.setView({
        destination: initPos,
        orientation: { heading: satTravelYawRef.current, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
      });
    }

    const ctrl = v.scene.screenSpaceCameraController;
    ctrl.enableRotate = false;
    ctrl.enableZoom = false;
    ctrl.enableTilt = false;
    ctrl.enableTranslate = false;

    // Hide the tracked entity and trail while riding along
    if (trackedSatRef.current) trackedSatRef.current.show = false;
    if (trackedSatTrailEntityRef.current) trackedSatTrailEntityRef.current.show = false;

    satTravelPreRenderRef.current = v.scene.preRender.addEventListener(() => updateTravelCamera(v));
    satTravelHudIntRef.current = setInterval(() => updateTravelHud(v), 200);
    setupTravelDrag(v);
    window.addEventListener('keydown', satTravelKeyHandler);
    showNotification('Boarded ' + name + ' — Travel View (live orbit)', 'success');
  }

  function exitSatelliteTravel(v: Cesium.Viewer) {
    satTravelRef.current = false;
    setSatTravel(false);
    setSatTravelHud(null);
    satTravelPosRef.current = null;
    satTravelNameRef.current = '';
    if (satTravelPreRenderRef.current) { satTravelPreRenderRef.current(); satTravelPreRenderRef.current = null; }
    if (satTravelHudIntRef.current) { clearInterval(satTravelHudIntRef.current); satTravelHudIntRef.current = null; }
    if (satTravelDragCleanupRef.current) { satTravelDragCleanupRef.current(); satTravelDragCleanupRef.current = null; }
    window.removeEventListener('keydown', satTravelKeyHandler);

    // Restore tracked entity and trail
    if (trackedSatRef.current) trackedSatRef.current.show = true;
    if (trackedSatTrailEntityRef.current) trackedSatTrailEntityRef.current.show = true;

    const ctrl = v.scene.screenSpaceCameraController;
    ctrl.enableRotate = true;
    ctrl.enableZoom = true;
    ctrl.enableTilt = true;
    ctrl.enableTranslate = true;
    (v.camera.frustum as Cesium.PerspectiveFrustum).fov = Cesium.Math.toRadians(60);

    // return to the exact globe position we were at before boarding
    const saved = satTravelSavedViewRef.current;
    satTravelSavedViewRef.current = null;
    if (saved) {
      v.camera.flyTo({
        destination: saved.pos,
        orientation: { heading: saved.hdg, pitch: saved.pitch, roll: saved.roll },
        duration: 1.5,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
    } else {
      cinematicFlyTo(v, 78, 22, 2.2e7, 2);
    }
    showNotification('Exited Travel View', 'info');
  }

  const toggleIssTravel = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (satTravelRef.current) { exitSatelliteTravel(v); return; }
    if (!issEntityRef.current) toggleISS();   // ensure ISS is live before boarding
    enterSatelliteTravel(v, issTrailRef.current!, 'ISS');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggleISS]);

  // D-pad / button actions driven from the Travel View HUD
  const travelLook = useCallback((action: 'left' | 'right' | 'up' | 'down' | 'back' | 'nadir' | 'horizon' | 'zoomin' | 'zoomout' | 'default') => {
    const STEP = Cesium.Math.toRadians(8);
    const FOV = Cesium.Math.toRadians(6);
    switch (action) {
      case 'left': satTravelYawRef.current -= STEP; break;
      case 'right': satTravelYawRef.current += STEP; break;
      case 'up': satTravelPitchRef.current = Math.min(SAT_TRAVEL_PITCH_MAX, satTravelPitchRef.current + STEP); break;
      case 'down': satTravelPitchRef.current = Math.max(SAT_TRAVEL_PITCH_MIN, satTravelPitchRef.current - STEP); break;
      case 'back': satTravelYawRef.current += Math.PI; break;
      case 'nadir': satTravelPitchRef.current = SAT_TRAVEL_PITCH_MIN; break;
      case 'horizon': satTravelPitchRef.current = Cesium.Math.toRadians(80); break;
      case 'zoomin': satTravelFovRef.current = Math.max(SAT_TRAVEL_FOV_MIN, satTravelFovRef.current - FOV); break;
      case 'zoomout': satTravelFovRef.current = Math.min(SAT_TRAVEL_FOV_MAX, satTravelFovRef.current + FOV); break;
      case 'default':
        // reset to the satellite's actual default look (forward along orbit, nadir)
        if (satTravelPosRef.current) {
          satTravelYawRef.current = getSatForwardAzimuth(satTravelPosRef.current);
        }
        satTravelPitchRef.current = SAT_TRAVEL_PITCH_MIN;
        satTravelFovRef.current = Cesium.Math.toRadians(60);
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const boardSatelliteFromInfoPanel = useCallback(() => {
    const v = viewerRef.current;
    const ent = infoEntity;
    if (!v || !ent || !ent.position) return;
    if (satTravelRef.current) exitSatelliteTravel(v);
    const p = ent.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
    const name = String(p?.name ?? p?.title ?? ent.name ?? 'Satellite');
    enterSatelliteTravel(v, ent.position, name);
    setInfoEntity(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoEntity]);

  const boardFlightFromInfoPanel = useCallback(() => {
    const v = viewerRef.current;
    const ent = infoEntity;
    if (!v || !ent) return;
    if (satTravelRef.current) exitSatelliteTravel(v);
    const p = ent.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
    if (!p) return;
    const lat = Number(p.lat ?? 0);
    const lon = Number(p.lon ?? 0);
    const alt = Number(p.altitude ?? 0);
    const vel = Number(p.velocity ?? 0);
    const hdg = Number(p.heading ?? 0);
    const vr = Number(p.verticalRate ?? 0);
    const callsign = String(p.callsign ?? ent.name ?? 'Flight');
    const icao24 = String(p.icao24 ?? '');
    if (!lat && !lon) return;
    enterFlightTravel(v, { lat, lon, alt, velocity: vel, heading: hdg, verticalRate: vr }, `${callsign} (${icao24})`, icao24);
    setInfoEntity(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoEntity]);

  // ── Flight Travel View: chase-cam that rides behind/above a live aircraft ──
  function flightChaseCam(v: Cesium.Viewer, pos: Cesium.Cartesian3, acHeadingDeg: number, yawRad: number, pitchRad: number) {
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(pos);
    const eAxis = new Cesium.Cartesian3(enu[0], enu[4], enu[8]);
    const nAxis = new Cesium.Cartesian3(enu[1], enu[5], enu[9]);
    // forward direction = aircraft heading (determines camera position, not look)
    const hRad = Cesium.Math.toRadians(acHeadingDeg);
    const fwd = new Cesium.Cartesian3();
    Cesium.Cartesian3.multiplyByScalar(eAxis, Math.sin(hRad), fwd);
    Cesium.Cartesian3.add(fwd, Cesium.Cartesian3.multiplyByScalar(nAxis, Math.cos(hRad), new Cesium.Cartesian3()), fwd);
    // chase position = aircraft - forward*dist + up*height (using aircraft heading only)
    const uAxis = new Cesium.Cartesian3(enu[2], enu[6], enu[10]);
    const chasePos = new Cesium.Cartesian3();
    Cesium.Cartesian3.multiplyByScalar(fwd, -FLIGHT_TRAVEL_CHASE_DIST, chasePos);
    Cesium.Cartesian3.add(pos, chasePos, chasePos);
    Cesium.Cartesian3.add(chasePos, Cesium.Cartesian3.multiplyByScalar(uAxis, FLIGHT_TRAVEL_CHASE_HEIGHT, new Cesium.Cartesian3()), chasePos);
    // look direction: aircraft heading + yaw offset
    const lookHeading = hRad + yawRad;
    const frustum = v.camera.frustum as Cesium.PerspectiveFrustum;
    frustum.fov = flightTravelFovRef.current;
    v.camera.setView({ destination: chasePos, orientation: { heading: lookHeading, pitch: pitchRad, roll: 0 } });
  }

  function updateFlightTravelCamera(v: Cesium.Viewer) {
    const sim = flightTravelSimRef.current;
    if (!sim) return;
    const now = Date.now();
    const dt = (now - sim.lastUpdate) / 1000;
    if (dt > 0) {
      if (sim.velocity > 0) {
        const dist = sim.velocity * dt;
        const rad = (sim.heading * Math.PI) / 180;
        const dLat = (dist * Math.cos(rad)) / 111320;
        const cosLat = Math.cos((sim.lat * Math.PI) / 180);
        if (Math.abs(cosLat) >= 0.01) {
          const dLon = (dist * Math.sin(rad)) / (111320 * cosLat);
          sim.lat += dLat;
          sim.lon += dLon;
          if (sim.lon > 180) sim.lon -= 360; else if (sim.lon < -180) sim.lon += 360;
        }
      }
      sim.alt = Math.max(0, sim.alt + sim.verticalRate * dt);
      sim.lastUpdate = now;
    }
    const pos = Cesium.Cartesian3.fromDegrees(sim.lon, sim.lat, sim.alt);
    flightChaseCam(v, pos, sim.heading, flightTravelYawRef.current, flightTravelPitchRef.current);
  }

  function updateFlightTravelHud(_v: Cesium.Viewer) {
    const sim = flightTravelSimRef.current;
    if (!sim) return;
    setFlightTravelHud({
      callsign: flightTravelNameRef.current,
      lat: +sim.lat.toFixed(3),
      lon: +sim.lon.toFixed(3),
      altFt: Math.round(sim.alt * 3.28084),
      speedKts: Math.round(sim.velocity * 1.94384),
      speedKmh: Math.round(sim.velocity * 3.6),
      heading: +sim.heading.toFixed(0),
      vs: +sim.verticalRate.toFixed(1),
      pitch: +Cesium.Math.toDegrees(flightTravelPitchRef.current).toFixed(1),
    });
  }

  function flightTravelKeyHandler(e: KeyboardEvent) {
    if (!flightTravelRef.current) return;
    const STEP = Cesium.Math.toRadians(6);
    const FOV = Cesium.Math.toRadians(5);
    switch (e.key) {
      case 'ArrowLeft': flightTravelYawRef.current -= STEP; e.preventDefault(); break;
      case 'ArrowRight': flightTravelYawRef.current += STEP; e.preventDefault(); break;
      case 'ArrowUp': flightTravelPitchRef.current = Math.min(FLIGHT_TRAVEL_PITCH_MAX, flightTravelPitchRef.current + STEP); e.preventDefault(); break;
      case 'ArrowDown': flightTravelPitchRef.current = Math.max(FLIGHT_TRAVEL_PITCH_MIN, flightTravelPitchRef.current - STEP); e.preventDefault(); break;
      case 'r': case 'R': flightTravelPitchRef.current = FLIGHT_TRAVEL_PITCH; flightTravelYawRef.current = 0; break;
      case '+': case '=': flightTravelFovRef.current = Math.max(FLIGHT_TRAVEL_FOV_MIN, flightTravelFovRef.current - FOV); break;
      case '-': case '_': flightTravelFovRef.current = Math.min(FLIGHT_TRAVEL_FOV_MAX, flightTravelFovRef.current + FOV); break;
      case 'Escape': { const v = viewerRef.current; if (v) exitFlightTravel(v); break; }
    }
  }

  function setupFlightTravelDrag(v: Cesium.Viewer) {
    const canvas = v.scene.canvas;
    const SENS = Cesium.Math.toRadians(0.25);
    const onDown = (ev: PointerEvent) => { flightTravelDragRef.current = { x: ev.clientX, y: ev.clientY, active: true }; };
    const onUp = () => { flightTravelDragRef.current.active = false; };
    const onMove = (ev: PointerEvent) => {
      const d = flightTravelDragRef.current;
      if (!d.active) return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      d.x = ev.clientX; d.y = ev.clientY;
      flightTravelYawRef.current -= dx * SENS;
      flightTravelPitchRef.current = Math.min(FLIGHT_TRAVEL_PITCH_MAX, Math.max(FLIGHT_TRAVEL_PITCH_MIN, flightTravelPitchRef.current + dy * SENS));
    };
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointermove', onMove);
    flightTravelDragCleanupRef.current = () => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
    };
  }

  function enterFlightTravel(v: Cesium.Viewer, sim: { lat: number; lon: number; alt: number; velocity: number; heading: number; verticalRate: number }, name: string, icao24?: string) {
    flightTravelRef.current = true;
    setFlightTravel(true);
    flightTravelSimRef.current = { ...sim, lastUpdate: Date.now() };
    flightTravelNameRef.current = name;
    flightTravelIcaoRef.current = icao24 || '';
    flightTravelCallsignRef.current = name.replace(/\s*\(.*\)$/, '').trim();
    flightTravelSavedViewRef.current = {
      pos: Cesium.Cartesian3.clone(v.camera.position),
      hdg: v.camera.heading, pitch: v.camera.pitch, roll: v.camera.roll,
    };
    flightTravelYawRef.current = 0;
    flightTravelPitchRef.current = FLIGHT_TRAVEL_PITCH;
    flightTravelFovRef.current = FLIGHT_TRAVEL_FOV;

    const pos = Cesium.Cartesian3.fromDegrees(sim.lon, sim.lat, sim.alt);
    flightChaseCam(v, pos, sim.heading, 0, FLIGHT_TRAVEL_PITCH);

    const ctrl = v.scene.screenSpaceCameraController;
    ctrl.enableRotate = false; ctrl.enableZoom = false; ctrl.enableTilt = false; ctrl.enableTranslate = false;

    flightTravelPreRenderRef.current = v.scene.preRender.addEventListener(() => updateFlightTravelCamera(v));
    flightTravelHudIntRef.current = setInterval(() => updateFlightTravelHud(v), 200);
    flightTravelRefreshIntRef.current = setInterval(() => refreshFlightTravelPosition(), 30000);
    setupFlightTravelDrag(v);
    window.addEventListener('keydown', flightTravelKeyHandler);
    showNotification('Boarded ' + name + ' — Flight Travel View (chase cam)', 'success');

    const qIcao = (icao24 || '').toLowerCase();
    if (qIcao) {
      for (const ent of v.entities.values) {
        const props = ent.properties?.getValue(Cesium.JulianDate.now());
        if (props?.icao24 && String(props.icao24).toLowerCase() === qIcao) {
          ent.show = false;
          flightTravelHiddenEntityRef.current = ent;
          break;
        }
      }
    }
  }

  function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function updateNearbyFlights(v: Cesium.Viewer, states: unknown[][], centerLat: number, centerLon: number) {
    const BUFFER_KM = 50;
    const tIcao = flightTravelIcaoRef.current.toLowerCase();
    const map = flightTravelNearbyEntitiesRef.current;
    const active = new Set<string>();

    for (const s of states) {
      const f = parseFlightState(s as unknown[]);
      if (!f) continue;
      const sIcao = f.icao24;
      if (!sIcao || sIcao.toLowerCase() === tIcao) continue;
      if (haversineKm(centerLat, centerLon, f.lat, f.lon) > BUFFER_KM) continue;

      const key = sIcao;
      active.add(key);
      const cs = f.callsign;
      const hdg = f.heading;
      const pos = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, Math.max(f.alt, 0));

      let ent = map.get(key);
      if (!ent) {
        ent = v.entities.add({
          position: pos,
          billboard: {
            image: getPlaneIcon(hdg, '#60a5fa'),
            width: 14, height: 14,
            scaleByDistance: new Cesium.NearFarScalar(5000, 1, 100000, 0.2),
          },
          label: {
            text: cs,
            font: '8px monospace',
            fillColor: Cesium.Color.fromCssColorString('#94a3b8'),
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.5)'),
            pixelOffset: new Cesium.Cartesian2(0, -12),
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          },
          properties: new Cesium.ConstantProperty({ layer: 'flight_nearby', icao24: sIcao }),
        });
        map.set(key, ent);
      } else {
        if (ent.position instanceof Cesium.ConstantPositionProperty) {
          ent.position.setValue(pos);
        }
        ent.billboard!.image = getPlaneIcon(hdg, '#60a5fa') as unknown as Cesium.Property;
      }
    }

    for (const [key, ent] of map) {
      if (!active.has(key)) {
        v.entities.remove(ent);
        map.delete(key);
      }
    }
  }

  async function refreshFlightTravelPosition() {
    if (!flightTravelRef.current) return;
    const icao = flightTravelIcaoRef.current;
    const cs = flightTravelCallsignRef.current;
    if (!icao || !cs) return;
    try {
      const data = await fetch('/api/flights/all').then(r => r.json()) as { states?: unknown[][] };
      const states = data.states || [];
      const qcs = cs.toLowerCase();
      let trackedLat = 0, trackedLon = 0;
      for (const s of states) {
        const f = parseFlightState(s as unknown[]);
        if (!f) continue;
        const sIcao = f.icao24.toLowerCase();
        const sCs = f.callsign.toLowerCase();
        if (sIcao === icao.toLowerCase() || sCs === qcs || sCs.includes(qcs)) {
          const sim = flightTravelSimRef.current;
          if (!sim) return;
          sim.lon = f.lon;
          sim.lat = f.lat;
          sim.alt = Math.max(0, f.alt);
          sim.velocity = f.velocity;
          sim.heading = f.heading;
          sim.verticalRate = f.verticalRate ?? sim.verticalRate;
          sim.lastUpdate = Date.now();
          flightTravelIcaoRef.current = f.icao24;
          trackedLat = sim.lat;
          trackedLon = sim.lon;
          break;
        }
      }
      const v = viewerRef.current;
      if (v && trackedLat && trackedLon) {
        updateNearbyFlights(v, states, trackedLat, trackedLon);
      }
    } catch { /* silently ignore */ }
  }

  function exitFlightTravel(v: Cesium.Viewer) {
    flightTravelRef.current = false;
    setFlightTravel(false);
    setFlightTravelHud(null);
    flightTravelSimRef.current = null;
    flightTravelNameRef.current = '';
    flightTravelIcaoRef.current = '';
    flightTravelCallsignRef.current = '';
    if (flightTravelPreRenderRef.current) { flightTravelPreRenderRef.current(); flightTravelPreRenderRef.current = null; }
    if (flightTravelHudIntRef.current) { clearInterval(flightTravelHudIntRef.current); flightTravelHudIntRef.current = null; }
    if (flightTravelRefreshIntRef.current) { clearInterval(flightTravelRefreshIntRef.current); flightTravelRefreshIntRef.current = null; }
    if (flightTravelDragCleanupRef.current) { flightTravelDragCleanupRef.current(); flightTravelDragCleanupRef.current = null; }
    window.removeEventListener('keydown', flightTravelKeyHandler);
    const ctrl = v.scene.screenSpaceCameraController;
    ctrl.enableRotate = true; ctrl.enableZoom = true; ctrl.enableTilt = true; ctrl.enableTranslate = true;
    (v.camera.frustum as Cesium.PerspectiveFrustum).fov = Cesium.Math.toRadians(60);
    const saved = flightTravelSavedViewRef.current;
    flightTravelSavedViewRef.current = null;
    if (saved) {
      v.camera.flyTo({
        destination: saved.pos,
        orientation: { heading: saved.hdg, pitch: saved.pitch, roll: saved.roll },
        duration: 1.5, easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
    } else {
      cinematicFlyTo(v, 78, 22, 2.2e7, 2);
    }
    if (flightTravelHiddenEntityRef.current) {
      flightTravelHiddenEntityRef.current.show = true;
      flightTravelHiddenEntityRef.current = null;
    }
    for (const ent of flightTravelNearbyEntitiesRef.current.values()) {
      v.entities.remove(ent);
    }
    flightTravelNearbyEntitiesRef.current.clear();
    showNotification('Exited Flight Travel View', 'info');
  }

  const travelToFlight = useCallback((f: { id: string; name: string; lat: number; lon: number; altitude: number; velocity: number; heading: number; verticalRate: number }) => {
    const v = viewerRef.current;
    if (!v) return;
    if (satTravelRef.current) exitSatelliteTravel(v);
    enterFlightTravel(v, {
      lat: f.lat, lon: f.lon, alt: f.altitude,
      velocity: f.velocity, heading: f.heading, verticalRate: f.verticalRate,
    }, `${f.name} (${f.id})`, f.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const travelLookFlight = useCallback((action: 'left' | 'right' | 'up' | 'down' | 'back' | 'default' | 'zoomin' | 'zoomout' | 'chase' | 'cockpit' | 'topdown') => {
    const STEP = Cesium.Math.toRadians(8);
    const FOV = Cesium.Math.toRadians(6);
    switch (action) {
      case 'left': flightTravelYawRef.current -= STEP; break;
      case 'right': flightTravelYawRef.current += STEP; break;
      case 'up': flightTravelPitchRef.current = Math.min(FLIGHT_TRAVEL_PITCH_MAX, flightTravelPitchRef.current + STEP); break;
      case 'down': flightTravelPitchRef.current = Math.max(FLIGHT_TRAVEL_PITCH_MIN, flightTravelPitchRef.current - STEP); break;
      case 'back': flightTravelYawRef.current += Math.PI; break;
      case 'default': flightTravelPitchRef.current = FLIGHT_TRAVEL_PITCH; flightTravelYawRef.current = 0; break;
      case 'chase': flightTravelPitchRef.current = FLIGHT_TRAVEL_PITCH; flightTravelYawRef.current = 0; break;
      case 'cockpit': flightTravelPitchRef.current = Cesium.Math.toRadians(10); flightTravelYawRef.current = 0; break;
      case 'topdown': flightTravelPitchRef.current = FLIGHT_TRAVEL_PITCH_MIN; flightTravelYawRef.current = 0; break;
      case 'zoomin': flightTravelFovRef.current = Math.max(FLIGHT_TRAVEL_FOV_MIN, flightTravelFovRef.current - FOV); break;
      case 'zoomout': flightTravelFovRef.current = Math.min(FLIGHT_TRAVEL_FOV_MAX, flightTravelFovRef.current + FOV); break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function createISSIcon(): HTMLCanvasElement {
    const s = 28;
    const canvas = document.createElement('canvas');
    canvas.width = s; canvas.height = s;
    const ctx = canvas.getContext('2d')!;
    const c = s / 2;

    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, 11, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(c, c - 15);
    ctx.lineTo(c, c + 15);
    ctx.moveTo(c - 15, c);
    ctx.lineTo(c + 15, c);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(c, c, 3, 0, Math.PI * 2);
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
    focusLocation(lat, lon, { label, color, height: 20000, duration });
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

  // God-eye direct setter: set a layer to an explicit on/off state, bypassing
  // the toggle's auto-revert-on-load-error behaviour (e.g. ais_vessels toggles
  // itself back off when the API key is missing). Used by executeAgentCommands.
  const setLayerEnabled = useCallback((layerId: string, enabled: boolean) => {
    const v = viewerRef.current;
    const now = Date.now();
    toggleDebounceRef.current[layerId] = now;
    const wasOn = layersRef.current.find(l => l.id === layerId)?.on ?? false;
    if (wasOn === enabled) return;
    setLayers(prev => {
      const next = prev.map(l => l.id === layerId ? { ...l, on: enabled } : l);
      layersRef.current = next;
      return next;
    });
    if (enabled) {
      // Remember the AI's intended state so loadLayerData's auto-revert paths
      // (missing API key, load errors) don't flip the layer back off.
      agentLayerForceRef.current[layerId] = true;
      forkRendererRef.current?.showLayer(layerId);
      loadLayerData(layerId);
    } else {
      delete agentLayerForceRef.current[layerId];
      forkRendererRef.current?.hideLayer(layerId);
      hideLayerEntities(layerId);
    }
    setTimeout(() => forkRendererRef.current?.reapplyCrop(), 0);
    setCinematicLayerVersion(x => x + 1);
    if (['severe_storms', 'wildfires', 'smoke_dispersion'].includes(layerId)) {
      refreshDerivedOverlays();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLayer = useCallback((layerId: string) => {
    const now = Date.now();
    const last = toggleDebounceRef.current[layerId] || 0;
    if (now - last < 300) return;
    toggleDebounceRef.current[layerId] = now;
    // Record toggle in user profile (fire-and-forget)
    fetch('/api/agent/profile/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' , ...authHeaders() }, body: JSON.stringify({ userId: 'browser-user', layerId }) }).catch(() => {});
    // Read BEFORE setLayers — the updater runs asynchronously, not synchronously
    const wasOn = layersRef.current.find(l => l.id === layerId)?.on ?? false;
    setLayers(prev => {
      const next = prev.map(l => l.id === layerId ? { ...l, on: !l.on } : l);
      layersRef.current = next;
      return next;
    });

    // Side effects outside setLayers updater — critical for React 18+ batching safety
    if (!wasOn) {
      forkRendererRef.current?.showLayer(layerId);
      loadLayerData(layerId);
      scheduleFlyToLayer(layerId);
    } else {
      forkRendererRef.current?.hideLayer(layerId);
      hideLayerEntities(layerId);
    }

    // Re-clip data layers against any active fork domes (so newly
    // shown/hidden entities respect dome cropping automatically).
    setTimeout(() => forkRendererRef.current?.reapplyCrop(), 0);

    // Notify CinematicDirector that entities changed
    setCinematicLayerVersion(v => v + 1);

    const layer = layersRef.current.find(l => l.id === layerId);
    if (layer?.type === 'tile') {
      setPulsingLayer(layerId);
      setTimeout(() => setPulsingLayer(null), 600);
    }

    if (['severe_storms', 'wildfires', 'smoke_dispersion'].includes(layerId)) {
      refreshDerivedOverlays();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function loadGenericLayer(viewer: Cesium.Viewer, layerId: string) {
    const layer = LAYER_CATEGORIES.find(l => l.id === layerId);
    if (!layer) return;
    if (layer.type === 'tile' || layer.type === 'effect' || layer.type === 'panel' || layer.type === '3dtiles') return;
    // Re-render from cached data if entities were previously loaded but removed on hide
    const cached = layerDataCacheRef.current[layerId];
    if (cached?.length) {
      const gen = (layerGenRef.current[layerId] = (layerGenRef.current[layerId] || 0) + 1);
      renderLayer(viewer, layer, cached, ghostProtocolRef.current ?? undefined).then((ents) => {
        if (layerGenRef.current[layerId] !== gen) return;
        if (!isLayerEnabled(layerId) || !ents.length) return;
        entityStoreRef.current[layerId] = ents;
        throttledRender(viewer);
        enforceEntityCap();
      }).catch(() => {});
      return;
    }
    if (entityStoreRef.current[layerId]?.length) {
      setLayerEntitiesVisible(layerId, true);
      return;
    }
    const gen = (layerGenRef.current[layerId] = (layerGenRef.current[layerId] || 0) + 1);
    fetchLayerData(layer).then(async (items) => {
      if (layerGenRef.current[layerId] !== gen) return;
      if (!isLayerEnabled(layerId)) return;
      if (!items.length) {
        recordFeedError(layerId, new Error('no data returned'));
        showNotification(`${layer.label} — no data available from upstream`, 'warning');
        return;
      }
      const keys = Object.keys(layerDataCacheRef.current);
      if (keys.length > LAYER_CACHE_MAX) {
        for (const k of keys.slice(0, keys.length - LAYER_CACHE_MAX)) delete layerDataCacheRef.current[k];
      }
      layerDataCacheRef.current[layerId] = items;
      const ents = await renderLayer(viewer, layer, items, ghostProtocolRef.current ?? undefined);
      if (layerGenRef.current[layerId] !== gen) return;
      if (ents.length) {
        entityStoreRef.current[layerId] = ents;
        throttledRender(viewer);
        enforceEntityCap();
      }
    }).catch((e: any) => console.warn(`Failed to load generic layer ${layerId}:`, e));
  }

  /**
   * Fly the camera to a data layer's rendered entities on the 3D globe.
   * Only dynamic layers trigger this — static/reference layers keep the
   * camera where it is.
   */
  function flyToLayerEntities(layerId: string) {
    const v = viewerRef.current;
    if (!v) return;
    if (STATIC_LAYER_IDS.has(layerId)) return;

    // Collect positions from entityStoreRef (point/geojson layers)
    const ents = entityStoreRef.current[layerId];
    const positions: Cesium.Cartesian3[] = [];
    const clock = v.clock;

    if (ents?.length) {
      for (const e of ents) {
        const pos = e.position?.getValue(clock.currentTime);
        if (pos && Cesium.defined(pos)) positions.push(pos);
      }
    }

    // Also collect positions from FlightDeadReckoning for aviation layers
    const drMap: Record<string, React.MutableRefObject<FlightDeadReckoning | null>> = {
      'flight_tracks': flightDrRef,
      '2_adsb_lol': adsbLolDrRef,
      '2_adsb_fi': adsbFiDrRef,
      '2_airlabs_api': airlabsDrRef,
    };
    const drRef = drMap[layerId];
    if (drRef?.current) {
      const flights = drRef.current.getFlightsSnapshot();
      for (const f of flights) {
        if (Number.isFinite(f.lat) && Number.isFinite(f.lon)) {
          positions.push(Cesium.Cartesian3.fromDegrees(f.lon, f.lat, f.alt || 0));
        }
      }
    }

    if (!positions.length) return;
    const now = Date.now();
    if (now - lastZoomToRef.current < 3000) return;
    lastZoomToRef.current = now;

    try {
      const sphere = Cesium.BoundingSphere.fromPoints(positions);
      if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return;
      const range = Math.max(sphere.radius * 3.5, 20000);
      v.camera.flyToBoundingSphere(sphere, {
        duration: 1.6,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), range),
      });
    } catch {
      /* camera move is best-effort */
    }
  }

  /** Schedule a fly-to once the layer's entities have been rendered. */
  function scheduleFlyToLayer(layerId: string) {
    if (STATIC_LAYER_IDS.has(layerId)) return;
    if (entityStoreRef.current[layerId]?.length) {
      flyToLayerEntities(layerId);
      return;
    }
    // Retry briefly while async loaders populate entityStoreRef.
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (entityStoreRef.current[layerId]?.length) {
        window.clearInterval(timer);
        flyToLayerEntities(layerId);
      } else if (attempts > 30) {
        window.clearInterval(timer);
      }
    }, 200);
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
      return;
    } else if (layerId === 'heatmap' && entityStoreRef.current['earthquakes']) {
      if (entityStoreRef.current['heatmap']?.length) {
        entityStoreRef.current['heatmap'].forEach(e => { if (e) e.show = true; });
        setShowHeatmapLegend(true);
      } else {
        generateHeatmap(v);
      }
      return;
    } else if (layerId === 'intel_feed') {
      setShowIntelFeed(true); focusPanel('intel-feed');
      const v = viewerRef.current;
      if (!v) return;
      if (!entityStoreRef.current['earthquakes']?.length) loadEarthquakes(v);
      if (!entityStoreRef.current['wildfires']?.length && !entityStoreRef.current['severe_storms']?.length) loadEonetEvents(v);
      if (!entityStoreRef.current['disaster_alerts']) loadNwsAlerts(v);
      if (!entityStoreRef.current['space_weather']?.length) loadSpaceWeather(v);
      return;
    } else if (layerId === 'disaster_alerts') {
      entityStoreRef.current['disaster_alerts']?.forEach(e => { if (e) e.show = true; });
      return;
    } else if (layerId === 'india_cctv') {
      if (!showExisting('india_cctv')) void loadIndiaCctv(v);
      return;
    } else if (layerId === 'tomtom_traffic') {
      startTomTomTraffic(v);
      return;
    } else if (layerId === 'detection_overlay') {
      if (!detectionOverlayRef.current) detectionOverlayRef.current = new DetectionOverlay(v);
      detectionOverlayRef.current.start();
      return;
    } else if (layerId === 'cctv_viewshed') {
      // Upgrade of the existing CCTV layer: draw estimated coverage cones over
      // the already-loaded public webcams. Requires india_cctv to be loaded.
      const cams = cctvMetaRef.current;
      if (!cams.size && !entityStoreRef.current['india_cctv']?.length) {
        void loadIndiaCctv(v).then(() => {
          if (isLayerEnabled('cctv_viewshed')) renderCctvViewshed(v);
        });
      } else {
        renderCctvViewshed(v);
      }
      return;
    } else if (layerId === 'aircraft_hangar') {
      // Upgrade of the aviation layers: swap flight glyphs for 3D models on
      // close approach. Requires a flight layer to be active; runs continuously.
      if (!aircraftHangarRef.current) aircraftHangarRef.current = new AircraftHangar(v);
      aircraftHangarRef.current.start();
      return;
    } else if (layerId === 'live_media') {
      if (!showExisting('live_media')) void loadLiveMedia(v);
      return;
    } else if (layerId === 'smoke_dispersion') {
      refreshDerivedOverlays();
      return;
    } else if (layerId === 'disaster_near_me') {
      renderDisasterNearMeLayer();
      return;
    } else if (layerId === 'flight_tracks') {
      if (!showExisting('flight_tracks')) void loadFlightTracks(v);
      return;
    } else if (layerId === '2_adsb_lol') {
      if (!showExisting('2_adsb_lol')) void loadAdsbLolFlights(v);
      return;
    } else if (layerId === '2_adsb_fi') {
      if (!showExisting('2_adsb_fi')) void loadAdsbFiFlights(v);
      return;
    } else if (layerId === '2_airlabs_api') {
      if (!showExisting('2_airlabs_api')) void loadAirlabsFlights(v);
      return;
    } else if (layerId === '2_openflights') {
      if (!showExisting('2_openflights')) void loadOpenFlights(v);
      return;
    } else if (layerId === '2_military_flights') {
      if (!showExisting('2_military_flights')) void loadMilitaryFlights(v);
      return;
    } else if (layerId === 'ucdp_conflict') {
      if (!showExisting('ucdp_conflict')) void loadUcdp(v);
      return;
    } else if (layerId === 'military_bases') {
      if (!showExisting('military_bases')) void loadMilitaryBases(v);
      return;
    } else if (layerId === 'space_debris') {
      if (!showExisting('space_debris')) void loadSpaceDebris(v);
      return;
    } else if (layerId === 'satnogs_db') {
      void loadSatnogsDb(v);
      return;
    } else if (layerId === 'ucs_satellite_db') {
      void loadUcsSatelliteDb(v);
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
    } else if (layerId === 'eu_gas_storage') {
      if (!showExisting('eu_gas_storage')) void loadEuGasStorage(v);
      return;
    } else if (layerId === 'animal_migrations') {
      if (!showExisting('animal_migrations')) void loadAnimalMigrations(v);
      return;
    } else if (layerId === 'dt_buildings') {
      loadOsmBuildings(v, cesiumIonToken).catch((e) => showNotification('3D Buildings failed to load: ' + (e?.message || e), 'error'));
      return;
    } else if (layerId === 'tectonic') {
      if (!showExisting('tectonic')) {
        apiGet<Record<string, unknown>>('/tectonic').then(async (geo) => {
          const src = await loadTectonicPlates(v, geo);
          entityStoreRef.current['tectonic'] = [...src.entities.values];
          updateCounts();
        }).catch((err) => {
          recordFeedError('tectonic plates', err);
        });
      }
      return;
    } else if (layerId === 'earthquakes') {
      if (!showExisting('earthquakes')) {
        void loadEarthquakes(v);
      }
      return;
    } else if (['wildfires','severe_storms','volcanoes','floods','dust','seaLakeIce'].includes(layerId)) {
      if (!showExisting(layerId)) {
        void loadEonetEvents(v);
      }
      return;
    } else if (layerId === 'airports') {
      if (!showExisting('airports')) {
        loadGenericLayer(v, layerId);
      }
      return;
    } else if (layerId === 'space_weather') {
      if (!showExisting('space_weather')) {
        void loadSpaceWeather(v);
      }
      return;
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
            const key = apiVaultRef.current.keys.AIS_STREAM_API_KEY || '';
            if (!key) {
              showNotification('AISStream API Key required. Add it in settings.', 'warning');
              // Don't auto-toggle back off when the enable came from the AI
              // god-eye command — the layer stays requested-on.
              if (!agentLayerForceRef.current['ais_vessels']) {
                setTimeout(() => toggleLayer('ais_vessels'), 10);
              }
            } else {
              aisTrackerRef.current = new AisVesselTracker(v, key);
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
    if (layerId === 'tomtom_traffic') {
      tomtomTrafficRef.current?.stop();
      tomtomTrafficRef.current?.clearEntities();
    }
    if (layerId === 'detection_overlay') {
      detectionOverlayRef.current?.stop();
    }
    if (layerId === 'cctv_viewshed') {
      cctvViewshedRef.current?.stop();
    }
    if (layerId === 'aircraft_hangar') {
      aircraftHangarRef.current?.stop();
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

    // Remove entities from viewer for ALL layers to free Cesium resources.
    // Skip layers that have no re-fetch fallback and rely on show/hide only.
    const skipRemove = new Set([
      'submarine_cables', 'airspaces', 'ais_vessels',
      'population_impact', 'weather_cards',
      // Layers loaded at init with no re-fetch fallback in loadLayerData
      'earthquakes', 'tectonic', 'airports', 'space_weather',
      'wildfires', 'severe_storms', 'volcanoes', 'floods', 'dust', 'seaLakeIce',
    ]);
    if (!skipRemove.has(layerId)) {
      const ents = entityStoreRef.current[layerId];
      if (ents?.length && v) {
        for (const ent of ents) {
          if (ent) {
            clearEntityProperties(ent);
            v.entities.remove(ent);
            ghostProtocolRef.current?.removeGhost(ent.id);
          }
        }
        entityStoreRef.current[layerId] = [];
      }
    } else {
      setLayerEntitiesVisible(layerId, false);
    }
    
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
        'intel_feed': ['news', 'social', 'twitter', 'facebook'],
        'live_media': ['news', 'social', 'twitter', 'facebook', 'youtube'],
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
    if (layerId === 'severe_storms') {
      setPopulationImpact(null);
    }
    if (layerId === 'smoke_dispersion' || layerId === 'wildfires') {
      clearSmokeDispersionOverlays();
    }
    if (layerId === 'intel_feed') {
      setShowIntelFeed(false);
    }
    if (layerId === 'india_cctv') {
      const p = infoEntity?.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      if (p?.layer === 'india_cctv') {
        setInfoEntity(null);
        entityTrackerRef.current?.untrack();
      }
    }
    if (layerId === 'live_media') {
      const p = infoEntity?.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      if (p?.layer === 'live_media') {
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
    if (layerId === '2_airlabs_api') {
      airlabsDrRef.current?.clear();
    }
    if (layerId === '2_military_flights') {
      const v2 = viewerRef.current;
      const ents = entityStoreRef.current['2_military_flights'];
      if (ents && v2) { ents.forEach(e => v2.entities.remove(e)); }
      entityStoreRef.current['2_military_flights'] = [];
    }
    if (layerId === 'ucdp_conflict') {
      const v2 = viewerRef.current;
      const ents = entityStoreRef.current['ucdp_conflict'];
      if (ents && v2) { ents.forEach(e => v2.entities.remove(e)); }
      entityStoreRef.current['ucdp_conflict'] = [];
    }
    if (layerId === 'military_bases') {
      const v2 = viewerRef.current;
      const ents = entityStoreRef.current['military_bases'];
      if (ents && v2) { ents.forEach(e => v2.entities.remove(e)); }
      entityStoreRef.current['military_bases'] = [];
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
    if (layerId === 'satnogs_db' || layerId === 'ucs_satellite_db') {
      const v2 = viewerRef.current;
      const ents = entityStoreRef.current[layerId];
      if (ents && v2) { ents.forEach((e: Cesium.Entity) => v2.entities.remove(e)); }
      entityStoreRef.current[layerId] = [];
      const p = infoEntity?.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      if (p?.layer === layerId) {
        setInfoEntity(null);
        entityTrackerRef.current?.untrack();
      }
    }
  }

  async function loadPopulationImpact(viewer: Cesium.Viewer) {
    if (populationImpactLayerRef.current.length > 0) return;
    // Live source of truth: the server fetches authoritative GeoNames city
    // records (name, coordinates, population) via the Open-Meteo Geocoding
    // API. On failure the layer stays empty with an honest notice — no
    // fabricated circles.
    let cities = CITY_DATA;
    try {
      const data = await apiGet<{ items?: Array<{ name?: string; country?: string; lat: number; lon: number; population: number; popM: number }> }>('/population-impact');
      const items = data?.items;
      if (items?.length) {
        cities = items.map(c => ({
          name: c.name || 'City',
          country: c.country || '',
          pop: c.popM,
          lat: c.lat,
          lon: c.lon,
        }));
        livePopulationCities = cities;
      } else {
        showNotification('Population data source returned no cities', 'warning');
        return;
      }
    } catch {
      showNotification('Population data source unavailable', 'warning');
      return;
    }
    // The user may have toggled the layer off while the fetch was in flight.
    if (!isLayerEnabled('population_impact')) return;
    const maxPop = Math.max(...cities.map(c => c.pop));
    const newEnts: Cesium.Entity[] = [];
    for (const city of cities) {
      const r = 5000 + (city.pop / maxPop) * 45000;
      const alpha = 0.1 + (city.pop / maxPop) * 0.35;
      // Flat disc 2 m above the ground (defined height + RELATIVE_TO_GROUND,
      // no clamped-geometry warnings) with a ground-clamped polyline ring
      // for the edge — geometry outlines are unsupported on terrain.
      const ent = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(city.lon, city.lat),
        name: city.name,
        ellipse: {
          semiMinorAxis: r, semiMajorAxis: r,
          material: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(alpha),
          height: 2,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
        label: { text: `${city.name}\n${city.pop}M`, font: '9px "JetBrains Mono"',
          fillColor: Cesium.Color.WHITE, pixelOffset: new Cesium.Cartesian2(0, 0),
          show: city.pop > 15, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
        properties: { layer:'population_impact', city, lon: city.lon, lat: city.lat },
      });
      newEnts.push(ent);
      newEnts.push(addGroundClampedRing(viewer, city.lon, city.lat, r, Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.55), 'population_impact', 1));
    }
    populationImpactLayerRef.current = newEnts;
    entityStoreRef.current['population_impact'] = newEnts;
    throttledRender(viewer);
    setShowPopulationImpact(true);
  }

  function createYoutubeIcon(): HTMLCanvasElement {
    if (cachedYoutubeCanvas) return cachedYoutubeCanvas;
    const canvas = document.createElement('canvas');
    canvas.width = 36;
    canvas.height = 36;
    const ctx = canvas.getContext('2d')!;
    const cx = 18, cy = 18;
    const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 16);
    glow.addColorStop(0, 'rgba(239, 68, 68, 0.7)');
    glow.addColorStop(0.5, 'rgba(239, 68, 68, 0.2)');
    glow.addColorStop(1, 'rgba(239, 68, 68, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 36, 36);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(-7, -5);
    ctx.lineTo(-7, 5);
    ctx.lineTo(6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    cachedYoutubeCanvas = canvas;
    return canvas;
  }

  function createCctvIcon(color: string = '#67e8f9'): HTMLCanvasElement {
    const cached = cachedCctvCanvases.get(color);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = 36;
    canvas.height = 36;
    const ctx = canvas.getContext('2d')!;
    const cx = 18, cy = 18;
    const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 16);
    const glowRgb = hexToRgb(color) ?? { r: 103, g: 232, b: 249 };
    glow.addColorStop(0, `rgba(${glowRgb.r}, ${glowRgb.g}, ${glowRgb.b}, 0.7)`);
    glow.addColorStop(0.5, `rgba(${glowRgb.r}, ${glowRgb.g}, ${glowRgb.b}, 0.2)`);
    glow.addColorStop(1, `rgba(${glowRgb.r}, ${glowRgb.g}, ${glowRgb.b}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 36, 36);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    cachedCctvCanvases.set(color, canvas);
    if (color === '#67e8f9') cachedCctvCanvas = canvas;
    return canvas;
  }

  async function loadIndiaCctv(viewer: Cesium.Viewer) {
    const existing = entityStoreRef.current['india_cctv'];
    if (existing?.length) {
      setLayerEntitiesVisible('india_cctv', true);
      return;
    }

    try {
      const data = await apiGet<{ cameras?: Array<Record<string, unknown>> }>('/cctv/worldwide');
      if (!isLayerEnabled('india_cctv')) return;
      const cameras = (data.cameras ?? [])
        .filter((camera) => Number.isFinite(camera.lat) && Number.isFinite(camera.lon));

      const total = cameras.length;
      const ents: Cesium.Entity[] = [];
      let idx = 0;
      const chunkSize = 300;
      const metaMap = cctvMetaRef.current;

      const addChunk = () => {
        const end = Math.min(idx + chunkSize, total);
        for (; idx < end; idx++) {
          const camera = cameras[idx];
          const entityId = `cctv_${camera.id || idx}`;
          const meta = {
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
          };
          metaMap.set(entityId, meta);
          ents.push(viewer.entities.add({
            id: entityId,
            position: Cesium.Cartesian3.fromDegrees(camera.lon as number, camera.lat as number, 0),
            name: camera.name as string,
            billboard: {
              image: createCctvIcon(cctvFeedColor(meta)),
              width: 28,
              height: 28,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              disableDepthTestDistance: 10000,
              pixelOffset: new Cesium.Cartesian2(0, -2),
            },
            properties: { layer: 'india_cctv' },
          }));
        }
        if (idx < total) {
          requestAnimationFrame(addChunk);
        } else {
          entityStoreRef.current['india_cctv'] = ents;
          enforceEntityCap();
          throttledRender(viewer);
          showNotification(`Loaded ${ents.length} worldwide webcams`, 'success');
        }
      };
      addChunk();
    } catch (err) {
      if (import.meta.env.DEV) {
        window.__terranoetisDebug = {
          ...(window.__terranoetisDebug ?? {}),
          lastIndiaCctvError: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        };
      }
      recordFeedError('worldwide cctv', err);
      showNotification('Worldwide camera feed unavailable', 'warning');
    }
  }

  // Simple frontend geo extraction from text (city/country lookup)
  function geoFromText(text: string): { lat: number; lon: number } {
    const lower = text.toLowerCase();
    for (const city of CITY_DATA) {
      if (lower.includes(city.name.toLowerCase()) || lower.includes(city.name.toLowerCase().split(',')[0])) {
        return { lat: city.lat, lon: city.lon };
      }
    }
    for (const entry of EXTRA_GEO) {
      if (lower.includes(entry.name.toLowerCase())) {
        return { lat: entry.lat, lon: entry.lon };
      }
    }
    return { lat: 0, lon: 0 };
  }

  function flyToLiveMediaEntities(viewer: Cesium.Viewer) {
    const ents = entityStoreRef.current['live_media'];
    if (!ents?.length) return;
    const positions = ents.map(e => e.position!.getValue(Cesium.JulianDate.now())!).filter(Boolean);
    if (positions.length > 0) {
      try {
        viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(positions), { duration: 1.2 });
      } catch { /* ignore */ }
    }
  }

  // TomTom street-level traffic: per-vehicle flow, congestion-colored, refreshed
  // on a timer as the camera moves. Real API data when TOMTOM_API_KEY is set;
  // an empty layer (no fabricated vehicles) when the key is absent.
  function startTomTomTraffic(viewer: Cesium.Viewer) {
    if (!tomtomTrafficRef.current) {
      tomtomTrafficRef.current = new TomTomTrafficLayer(viewer);
    }
    tomtomTrafficRef.current.start();
  }

  // CCTV viewshed — coverage cones over the existing webcam layer. Poses are
  // estimated (azimuth/FOV/range heuristics) and labeled as such, matching how
  // the public-camera data actually arrives (positions real, poses estimated).
  function renderCctvViewshed(viewer: Cesium.Viewer) {
    if (!cctvViewshedRef.current) {
      cctvViewshedRef.current = new CctvViewshed(viewer);
      cctvViewshedRef.current.start();
    }
    const ents = entityStoreRef.current['india_cctv'] ?? [];
    const cams: ViewshedCamera[] = [];
    for (const e of ents) {
      const pos = e.position?.getValue(Cesium.JulianDate.now());
      if (!pos) continue;
      const carto = Cesium.Cartographic.fromCartesian(pos);
      if (!carto) continue;
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      // Deterministic pseudo-azimuth per camera so cones are stable across
      // refreshes while still being an estimated prior (honest framing).
      const seed = Math.abs(Math.sin(lon * 12.9898) * 43758.5453) % 1;
      const azimuthDeg = (seed * 360 + 45) % 360;
      const rangeM = 150 + Math.abs(Math.sin(lat)) * 500; // 150–650 m coverage
      cams.push({
        lat, lon, name: e.name || 'camera',
        azimuthDeg, fovDeg: 60, rangeM, mountHeightM: 5,
      });
    }
    cctvViewshedRef.current.render(cams);
  }

  async function loadLiveMedia(viewer: Cesium.Viewer) {
    const existing = entityStoreRef.current['live_media'];
    if (existing?.length) {
      console.warn(`[LiveMedia] loadLiveMedia: showing ${existing.length} existing entities`);
      setLayerEntitiesVisible('live_media', true);
      return;
    }
    console.warn('[LiveMedia] loadLiveMedia: no existing entities, scanning intelFeed...', intelFeedRef.current.length);
    const items = intelFeedRef.current
      .map(i => {
        const geo = (!i.lat || !i.lon) ? geoFromText(i.title || i.url || '') : { lat: 0, lon: 0 };
        return { ...i, lat: i.lat || geo.lat, lon: i.lon || geo.lon, youtubeVideoId: extractYoutubeId(i.url) };
      })
      .filter(i => i.youtubeVideoId && i.lat && i.lon);
    console.warn(`[LiveMedia] loadLiveMedia: found ${items.length} YouTube items with geo`);
    if (!items.length) return;
    const ents = items.map(item => {
      return viewer.entities.add({
        id: item.id,
      position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, 2),
        name: item.title,
        billboard: {
          image: createYoutubeIcon(),
          width: 32,
          height: 32,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          pixelOffset: new Cesium.Cartesian2(0, -2),
        },
        label: {
          text: item.title,
          font: '10px "JetBrains Mono"',
          fillColor: Cesium.Color.fromCssColorString('#ef4444'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          pixelOffset: new Cesium.Cartesian2(0, -24),
          show: false,
        },
        properties: {
          layer: 'live_media',
          title: item.title,
          lat: item.lat,
          lon: item.lon,
          source: item.source,
          url: item.url,
          youtubeVideoId: item.youtubeVideoId,
        },
      });
    });
    entityStoreRef.current['live_media'] = ents;
    enforceEntityCap();
    throttledRender(viewer);
    flyToLiveMediaEntities(viewer);
    showNotification(`Loaded ${ents.length} YouTube news videos on globe`, 'success');
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
      enforceEntityCap();
      throttledRender(viewer);
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

  async function loadSatnogsDb(viewer: Cesium.Viewer) {
    try {
      const data = await fetchAndStoreSatnogsData(apiGet);
      if (!isLayerEnabled('satnogs_db')) return;
      const ents = await addSatnogsEntities(viewer, apiGet);
      if (ents.length === 0) {
        showNotification('SatNOGS: no matching satellites found on the globe', 'warning');
        return;
      }
      entityStoreRef.current['satnogs_db'] = ents;
      enforceEntityCap();
      throttledRender(viewer);
      pushIntelFeed({
        id: 'satnogs-db-loaded',
        title: `SatNOGS: ${ents.length} satellites with frequency data`,
        source: 'SatNOGS DB',
        type: 'space',
        lat: 0, lon: 0,
        timestamp: Date.now(),
        url: 'https://db.satnogs.org/',
        platform: 'internal',
      });
      showNotification(`SatNOGS: ${ents.length} satellites with known frequencies`, 'success');
    } catch (err) {
      recordFeedError('SatNOGS DB', err);
      showNotification('SatNOGS DB unavailable', 'warning');
    }
  }

  async function loadUcsSatelliteDb(viewer: Cesium.Viewer) {
    try {
      const data = await fetchAndStoreUcsData(apiGet);
      if (!isLayerEnabled('ucs_satellite_db')) return;
      const ents = addUcsEntities(viewer);
      entityStoreRef.current['ucs_satellite_db'] = ents;
      enforceEntityCap();
      throttledRender(viewer);
      pushIntelFeed({
        id: 'ucs-satellite-db-loaded',
        title: `UCS Catalog: ${ents.length} operational satellites`,
        source: 'UCS Satellite Database',
        type: 'space',
        lat: 0, lon: 0,
        timestamp: Date.now(),
        url: 'https://www.ucs.org/resources/satellite-database',
        platform: 'internal',
      });
      showNotification(`UCS Catalog: ${ents.length} operational satellites loaded`, 'success');
    } catch (err) {
      recordFeedError('UCS Satellite DB', err);
      showNotification('UCS Satellite DB unavailable', 'warning');
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
      enforceEntityCap();
      throttledRender(viewer);
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
      enforceEntityCap();
      throttledRender(viewer);
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
      enforceEntityCap();
      throttledRender(viewer);
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
      enforceEntityCap();
      throttledRender(viewer);
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
      enforceEntityCap();
      throttledRender(viewer);
      showNotification('Global grid footprint loaded', 'success');
    } catch (err) {
      recordFeedError('electricity grid', err);
      showNotification('Electricity grid feed unavailable', 'warning');
    }
  }

  async function loadEuGasStorage(viewer: Cesium.Viewer) {
    const existing = entityStoreRef.current['eu_gas_storage'];
    if (existing?.length) {
      setLayerEntitiesVisible('eu_gas_storage', true);
      return;
    }
    try {
      // Real GIE AGSI+ storage levels via the /api/data fetcher (key stays in .env).
      const data = await apiGet<{ items?: Array<{ lat: number; lon: number; countryCode: string; name: string; fillPct: number; gasInStorage: number; workingGasVolume: number; gasDayStart?: string; status?: string; source?: string }> }>('/data/eu_gas_storage');
      if (!isLayerEnabled('eu_gas_storage')) return;
      const items = data?.items;
      if (!items?.length) {
        showNotification('EU gas storage: no data returned by GIE AGSI+', 'warning');
        return;
      }
      const ents = addEuGasStorageEntities(viewer, items);
      entityStoreRef.current['eu_gas_storage'] = ents;
      enforceEntityCap();
      throttledRender(viewer);
      showNotification(`EU gas storage: ${ents.length} countries (GIE AGSI+)`, 'success');
    } catch (err) {
      recordFeedError('eu_gas_storage', err);
      showNotification('EU gas storage feed unavailable', 'warning');
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
      enforceEntityCap();
      throttledRender(viewer);
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
      const fetchOpts: RequestInit | undefined = layerId === '2_airlabs_api'
        ? { headers: { 'x-airlabs-key': getApiKey('AIRLABS_API_KEY') || '' } }
        : undefined;
      const cam = viewer.camera.positionCartographic;
      const lat = cam ? (cam.latitude * 180 / Math.PI).toFixed(2) : '';
      const lon = cam ? (cam.longitude * 180 / Math.PI).toFixed(2) : '';
      const locParam = (lat && lon) ? `?lat=${lat}&lon=${lon}` : '';
      const data = await apiGet<{ states?: unknown[][] | null }>(`${apiPath}${locParam}`, fetchOpts);
      if (!isLayerEnabled(layerId)) return;
      if (!data.states?.length) throw new Error(`${layerId} returned no states`);
      drRef.current?.updateFromApi(data.states);
      drRef.current?.start();
      throttledRender(viewer);
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
      enforceEntityCap();
      throttledRender(viewer);
      const airports = data.airports?.length || 0;
      const routes = data.routes?.length || 0;
      showNotification(`OpenFlights: ${airports} airports, ${routes} routes`, 'success');
    } catch (err) {
      recordFeedError('openflights', err);
      showNotification('OpenFlights data unavailable', 'warning');
    }
  }

  async function loadMilitaryFlights(viewer: Cesium.Viewer) {
    const existing = entityStoreRef.current['2_military_flights'];
    if (existing?.length) {
      setLayerEntitiesVisible('2_military_flights', true);
      return;
    }
    try {
      const data = await apiGet<any>('/flights/military');
      if (!isLayerEnabled('2_military_flights')) return;
      removeLayerEntities('2_military_flights');
      const ents = addMilitaryFlightEntities(viewer, data, '2_military_flights');
      entityStoreRef.current['2_military_flights'] = ents;
      enforceEntityCap();
      throttledRender(viewer);
      showNotification(`Loaded ${ents.length} military flight tracks`, 'success');
    } catch (err) {
      recordFeedError('military_flights', err);
      showNotification('Military flights data unavailable', 'warning');
    }
  }

  async function loadUcdp(viewer: Cesium.Viewer) {
    const existing = entityStoreRef.current['ucdp_conflict'];
    if (existing?.length) {
      setLayerEntitiesVisible('ucdp_conflict', true);
      return;
    }
    try {
      const data = await apiGet<UcdpEvent[]>('/ucdp');
      if (!isLayerEnabled('ucdp_conflict')) return;
      removeLayerEntities('ucdp_conflict');
      const ents = addUcdpEntities(viewer, Array.isArray(data) ? data : [], 'ucdp_conflict');
      entityStoreRef.current['ucdp_conflict'] = ents;
      enforceEntityCap();
      throttledRender(viewer);
      showNotification(`Loaded ${ents.length} UCDP conflict events`, 'success');
    } catch (err) {
      recordFeedError('ucdp', err);
      showNotification('UCDP conflict data unavailable', 'warning');
    }
  }

  async function loadMilitaryBases(viewer: Cesium.Viewer) {
    const existing = entityStoreRef.current['military_bases'];
    if (existing?.length) {
      setLayerEntitiesVisible('military_bases', true);
      return;
    }
    try {
      const data = await apiGet<any>('/military-bases');
      if (!isLayerEnabled('military_bases')) return;
      removeLayerEntities('military_bases');
      const ents = addMilitaryBaseEntities(viewer, data, 'military_bases');
      entityStoreRef.current['military_bases'] = ents;
      enforceEntityCap();
      throttledRender(viewer);
      showNotification(`Loaded ${ents.length} military base locations`, 'success');
    } catch (err) {
      recordFeedError('military_bases', err);
      showNotification('Military bases data unavailable', 'warning');
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
      enforceEntityCap();
      throttledRender(viewer);
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
      enforceEntityCap();
      throttledRender(viewer);
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
      enforceEntityCap();
      throttledRender(viewer);
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
      enforceEntityCap();
      throttledRender(viewer);
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
      nasa_gibs: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
      night_lights: 'VIIRS_Black_Marble',
      land_cover: 'MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual',
      aerosol_index: 'OMPS_Aerosol_Index',
      so2_index: 'OMPS_SO2_Lower_Troposphere',
      co_index: 'MOPITT_CO_Daily_Total_Column_Day',
      dust_score: 'MERRA2_Dust_Surface_Mass_Concentration_Monthly',
      flood_extent: 'MODIS_Combined_Flood_1-Day',
      // Note: NHC storms, IBTrACS, US Drought Monitor, NOAA CPC and NEXRAD are
      // DATA layers rendered from their own API loaders (loadWeather*), not
      // GIBS imagery — so they intentionally have no entry in this map.
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
    throttledRender(viewerRef.current);
  }, [layerOpacity]);

  const toggleAllLayers = useCallback((state: boolean) => {
    // "Enable All" turns on a curated lightweight set (real-time + low-entity
    // layers) instead of all 145 — enabling every layer at once floods the
    // scene with tens of thousands of entities and freezes the browser.
    // "Disable All" still turns every layer off.
    const ENABLE_ALL_WHITELIST = new Set([
      'earthquakes', 'lightning_strikes', 'space_weather',
      'wildfires', 'severe_storms', 'aurora_oval',
      '31_noaa_tides_currents', '50_ocean_currents', 'nasa_gibs',
      'ais_vessels', 'space_debris',
    ]);
    const next = layersRef.current.map(l => ({ ...l, on: state && ENABLE_ALL_WHITELIST.has(l.id) }));
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
      const now = Cesium.JulianDate.now();
      const hasForks = forkRendererRef.current?.hasActiveForks() ?? false;
      for (const l of layersRef.current) {
        if (!l.on) {
          forkRendererRef.current?.hideLayer(l.id);
          hideLayerEntities(l.id);
          continue;
        }
        forkRendererRef.current?.showLayer(l.id);
        const id = l.id;
        const ents = entityStoreRef.current[id];
        if (ents && ents.length > 0) {
          // When a fork dome is active, entities show only if inside a dome;
          // otherwise show everything as normal.
          if (hasForks) {
            ents.forEach(e => { if (e) e.show = forkRendererRef.current?.shouldEntityShow(e, now) ?? true; });
          } else {
            ents.forEach(e => { if (e) e.show = true; });
          }
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
            // Re-clip freshly-loaded entities against any active fork domes.
            forkRendererRef.current?.reapplyCrop();
            if (v) throttledRender(v);
            bulkOperationRef.current = false;
showNotification(`Enabled ${layersRef.current.filter(l=>l.on).length} layers`, 'success');
          }
        });
        renderSchedulerRef.current.enqueueAll(tasks);
      } else {
        bulkOperationRef.current = false;
        forkRendererRef.current?.reapplyCrop();
        if (v) throttledRender(v);
        showNotification(`Enabled ${layersRef.current.filter(l=>l.on).length} layers`, 'success');
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
        layersRef.current.forEach(l => {
          forkRendererRef.current?.hideLayer(l.id);
          hideLayerEntities(l.id);
        });
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
      if (focusMarkerTimerRef.current) { clearTimeout(focusMarkerTimerRef.current); focusMarkerTimerRef.current = null; }

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
      setShowPopulationImpact(false);
      const wcEnts = entityStoreRef.current['weather_cards'];
      if (wcEnts) { wcEnts.forEach(e => v?.entities.remove(e)); entityStoreRef.current['weather_cards'] = []; }
      setWeatherCards([]);
      setShowHeatmapLegend(false);
      setShowSmokeLegend(false);
      disasterNearMeRequestedRef.current = false;
      if (geolocationWatchRef.current !== null) {
        navigator.geolocation.clearWatch(geolocationWatchRef.current);
        geolocationWatchRef.current = null;
      }

      if (v) throttledRender(v);
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
    setShowSmokeLegend(false);
    setShowHeatmapLegend(false);
    for (const prev of prevLayers) {
      const wasOn = prev.on;
      const isOn = prev.default;
      if (wasOn && !isOn) {
        forkRendererRef.current?.hideLayer(prev.id);
        hideLayerEntities(prev.id);
      } else if (!wasOn && isOn) {
        forkRendererRef.current?.showLayer(prev.id);
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
          headers: { 'Content-Type': 'application/json' , ...authHeaders() },
          body: JSON.stringify({ userId: 'browser-user' }),
        });
        if (resp.ok) {
          const ws = await resp.json();
          workspaceId = ws.id;
          setSandboxWorkspaceId(workspaceId);
        } else {
          setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `Error: Sandbox workspace creation failed (${resp.status})`, type: 'error' }]);
          return;
        }
      } catch (e) {
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `Error: Sandbox workspace error: ${e}`, type: 'error' }]);
        return;
      }
    }

    if (!workspaceId) return;

    const content = await file.text();
    const resp = await fetch(`/api/sandbox/workspace/${workspaceId}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' , ...authHeaders() },
      body: JSON.stringify({ fileName: file.name, content }),
    });
    if (resp.ok) {
      setUploadedFiles(prev => [...prev, file.name]);
              setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `Uploaded **${file.name}** to sandbox workspace. You can now ask me to analyze it.`, type: 'upload' }]);
    } else {
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `Error: File upload failed (${resp.status})`, type: 'error' }]);
    }
  }, [sandboxWorkspaceId, setAiMessages, setUploadedFiles, setSandboxWorkspaceId]);

  // Phase 2.1: Vision — analyze image via Gemini Vision API
  const handleImageUpload = useCallback(async (file: File) => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
    if (!validTypes.includes(file.type)) {
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `Error: Unsupported image type: ${file.type}. Supported: JPEG, PNG, WebP, GIF, BMP.`, type: 'error' }]);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: 'Error: Image too large. Max 10MB.', type: 'error' }]);
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      const imageId = nextImageIdRef.current++;
      setChatImages(prev => [...prev, { id: imageId, dataUrl, mimeType: file.type, fileName: file.name }]);
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'user', content: `[Image: ${file.name}]`, type: 'image', images: [{ dataUrl, mimeType: file.type, fileName: file.name }] }]);
      clearChatImages();
      setAiTyping(true);

      try {
        const resp = await fetch('/api/agent/analyze-vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' , ...authHeaders() },
          body: JSON.stringify({ image: base64, mimeType: file.type, prompt: 'Analyze this image in detail. If it is a satellite image, map, chart, or geographic area, describe what you see including any notable features, patterns, colors, text, or structures.' }),
        });
        if (resp.ok) {
          const data = await resp.json();
          setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `**Image Analysis**\n\n${data.analysis || 'No analysis returned.'}`, type: 'vision' }]);
        } else {
          setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `Error: Vision analysis failed (${resp.status})`, type: 'error' }]);
        }
      } catch (e) {
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `Error: Vision analysis error: ${e}`, type: 'error' }]);
      }
      setAiTyping(false);
    };
    reader.readAsDataURL(file);
  }, [setAiMessages, setAiTyping, setChatImages, clearChatImages]);

  // #11 Load model tiers on mount
  useEffect(() => {
    if (tiersLoadedRef.current) return;
    tiersLoadedRef.current = true;
    fetchTiers().then(({ tiers }) => setModelTiers(tiers)).catch(() => {});
  }, [setModelTiers]);

  // #10 Adaptive suggestions — refresh when visible layers change (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      const visibleLayers = layersRef.current.filter(l => l.on).map(l => l.id);
      const ctx: SuggestionContextClient = {
        visibleLayers,
        recentQueries: aiMessagesRef.current.filter(m => m.role === 'user').slice(-5).map(m => m.content.slice(0, 80)),
        activeAlerts: intelFeed.length,
        recentDiscoveries: recentDiscoveries.slice(0, 3).map(d => d.summary),
      };
      fetchSuggestions(ctx).then(setAdaptiveSuggestions).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [activeLayerCount, intelFeed.length, recentDiscoveries, setAdaptiveSuggestions]);

  // #8 Continuous voice mode — re-arms STT after each response, supports barge-in
  useEffect(() => {
    if (!voiceMode || !recognitionRef.current) return;
    if (aiTyping) { setBargeIn(true); recognitionRef.current.stop?.(); return; }
    setBargeIn(false);
    // Re-arm listening after a short pause
    const t = setTimeout(() => {
      try { recognitionRef.current?.start?.(); setIsListening(true); } catch { /* already listening */ }
    }, 400);
    return () => clearTimeout(t);
  }, [voiceMode, aiTyping, setBargeIn, setIsListening]);

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
        setAiMessages(prev => [...prev, {
          id: nextAiMsgIdRef.current++,
          role: 'assistant',
          content: `**${ev.title}**\n\n${ev.description}`,
          type: 'ambient'
        }]);
        if (ev.lat != null && ev.lon != null && ev.title) {
          pushIntelFeed({
            id: `ambient_${ev.id ?? Date.now()}`,
            title: ev.title,
            source: 'Ambient',
            type: ev.type ?? 'ambient',
            lat: ev.lat,
            lon: ev.lon,
            timestamp: ev.timestamp ?? Date.now(),
            url: '',
            platform: 'internal',
            desc: ev.description ?? '',
          });
        }
      }

      // Phase 2: Reflex engine events
      if (msg.event === 'REFLEX_DILATE') {
        const data = (msg.data || msg) as any;
        const { lat, lon, region, reflexId } = data;
        setAiMessages(prev => [...prev, {
          id: nextAiMsgIdRef.current++,
          role: 'assistant',
          content: `**Reflex Dilate: ${region || 'unknown region'}**\n\nReflex \`${reflexId || 'unknown'}\` triggered camera dilation to [${lat?.toFixed(2)}, ${lon?.toFixed(2)}].`,
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
          content: `**Reflex Alert: ${title || 'Unspecified'}**\n\n${description || ''}`,
          type: 'reflex',
        }]);
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
        forkRendererRef.current?.createForkVisual(forkId, name, request?.lat || 0, request?.lon || 0, request?.bufferRadiusM);
        // entity cache is now read via getter — no manual refresh needed
        forkRendererRef.current?.spawnGhostsWithRetry(forkId);
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
            content: `**Causal Discovery**\n\n${disc.summary}`,
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
          content: `**Dream Cycle Complete**\n\nThe system dreamed ${data.scenariosRun} synthetic catastrophes while you slept.\n• ${data.modelUpdates} prediction models retrained\n• ${data.newCausalEdges} new causal edges discovered\n\n*The planet learns even when you do not.*`,
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
  }, [ws, setAiMessages]);

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
        headers: { 'Content-Type': 'application/json' , ...authHeaders() },
        body: JSON.stringify({ layerId, condition: { field, operator, value }, location, label: `Monitor: ${conditionText}`, userId: 'browser-user', intervalMs: 300000 }),
      });
      if (resp.ok) {
        const rule = await resp.json();
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `**Monitor Created**\n\nID: \`${rule.id}\`\nLayer: ${rule.layerId}\nCondition: ${rule.condition.field} ${rule.condition.operator} ${rule.condition.value}\nInterval: every ${rule.intervalMs / 60000} min\n\n*You'll be alerted when conditions are met.*`, type: 'monitor' }]);
        return true;
      }
    }
    return false;
  }, [setAiMessages]);

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
        headers: { 'Content-Type': 'application/json' , ...authHeaders() },
        body: JSON.stringify({ label: `Scheduled: ${goal.slice(0, 40)}`, goal, userId: 'browser-user', intervalMs }),
      });
      if (resp.ok) {
        const task = await resp.json();
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `**Schedule Created**\n\nID: \`${task.id}\`\nGoal: ${goal}\nEvery: ${num} ${unit}${num > 1 ? 's' : ''}\n\n*Reports will appear here automatically.*`, type: 'monitor' }]);
        return true;
      }
    }
    return false;
  }, [setAiMessages]);

  // Phase 3: Get location context
  const getLocationContextData = useCallback(async (lat: number, lon: number) => {
    try {
      const resp = await fetch(`/api/agent/context?lat=${lat}&lon=${lon}`);
      if (resp.ok) {
        const ctx = await resp.json();
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `**Location Context: ${ctx.location.label}**\n\n**Seismic**: ${ctx.earthquakeRisk}\n**Weather**: ${ctx.weather}\n${ctx.nearbyEvents?.length > 0 ? `**Nearby Events**:\n${ctx.nearbyEvents.slice(0, 3).map((e: { title: string; category: string }) => `- ${e.title} (${e.category})`).join('\n')}` : ''}\n\n*Data from live APIs*`, type: 'context' }]);
      }
    } catch { /* silent */ }
  }, [setAiMessages]);

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
            const finalText = transcript;
            if (finalText.trim()) {
              sendAIRef.current(finalText);
            }
          }, 300);
        }
      };
      recognition.onerror = () => { setIsListening(false); };
      recognition.onend = () => { setIsListening(false); };
      recognitionRef.current = recognition;
    }
  }, [setIsListening, setAiInput]);

  const toggleVoiceInput = useCallback(async () => {
    // PRIMARY: OpenAI Realtime voice (interruptible audio-in/audio-out).
    if (isListening) {
      // If realtime is active, stop it; if it's the fallback, stop recognition.
      if (realtimeVoice.active) {
        realtimeVoice.stop();
        setIsListening(false);
        return;
      }
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    // Try Realtime first; fall back to Web Speech if it can't connect.
    const token = localStorage.getItem('auth_token');
    if (token) {
      const started = await realtimeVoice.start().catch(() => false);
      if (started) {
        setRealtimeVoiceAvailable(true);
        setAiInput('');
        setIsListening(true);
        return;
      }
    }
    // Fallback: Web Speech API → /api/agent/ask
    if (!recognitionRef.current) return;
    setAiInput('');
    recognitionRef.current.start();
    setIsListening(true);
  }, [isListening, setAiInput, setIsListening, realtimeVoice]);

  // Phase 2.2: Voice — speech synthesis (text-to-speech)
  const speakResponse = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/\*\*|`|#/g, '').slice(0, 500));
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.onstart = () => useChatStore.getState().setSpeaking(true);
    utterance.onend = () => useChatStore.getState().setSpeaking(false);
    utterance.onerror = () => useChatStore.getState().setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    useChatStore.getState().stopSpeaking();
  }, []);

  // Phase 2.3: Data file analysis
  const handleDataFileUpload = useCallback(async (file: File) => {
    const content = await file.text();
    setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'user', content: `[Data file: ${file.name}]`, type: 'data' }]);
    setAiTyping(true);
    try {
      const resp = await fetch('/api/agent/analyze-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' , ...authHeaders() },
        body: JSON.stringify({ content, fileName: file.name }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setDataAnalysisResult(data);
        let msg = `**Data Analysis: ${file.name}**\n\n`;
        if (data.type === 'csv') {
          msg += `Rows: **${data.rows}** | Columns: **${(data.columns || []).length}**\n\n**Columns:**\n`;
          msg += (data.columns || []).map((c: { name: string; type: string; min?: number; max?: number; mean?: number; uniqueValues?: number }) =>
            `- **${c.name}** (${c.type})${c.min !== undefined ? ` [${c.min?.toFixed(2)} – ${c.max?.toFixed(2)}, μ=${c.mean?.toFixed(2)}]` : ''}${c.uniqueValues !== undefined ? ` (${c.uniqueValues} unique)` : ''}`
          ).join('\n');
          if (data.detectedLocation) {
            msg += `\n\n**Location data detected!** Lat: \`${data.detectedLocation.latColumn}\`, Lon: \`${data.detectedLocation.lonColumn}\`\n`;
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
        setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `Error: Data analysis failed (${resp.status})`, type: 'error' }]);
      }
    } catch (e) {
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `Error: Data analysis error: ${e}`, type: 'error' }]);
    }
    setAiTyping(false);
  }, [setAiMessages, setAiTyping, setDataAnalysisResult]);

  const cleanupThinkingSteps = useCallback((_?: boolean) => {
    setAgentSteps([]);
  }, [setAgentSteps]);

  // God-eye command bridge: map a panel id to its opener/closer so the AI can
  // open, close, or toggle ANY panel in the app. Returns true when opened,
  // false when closed, undefined when the panel id is unknown.
  const applyPanelCommand = useCallback((panelId: string, desired?: boolean): boolean | undefined => {
    const isOpen = (cur: boolean) => (desired === undefined ? !cur : desired);
    const apply = (setter: (v: boolean) => void, current: boolean, focusId?: string): boolean => {
      const next = isOpen(current);
      setter(next);
      if (next && focusId) focusPanel(focusId);
      return next;
    };
    switch (panelId) {
      case 'analytics': case 'analytics-workbench': case 'workbench':
        return apply(setShowAnalyticsWorkbench, showAnalyticsWorkbench, 'analytics');
      case 'analytics-insights': case 'analytics_insights': case 'insights':
        return apply(setShowAnalytics, showAnalytics, 'analytics-insights');
      case 'satellite-tracker': case 'satellites':
        return apply(setShowSatelliteTracker, showSatelliteTracker, 'satellite-tracker');
      case 'satellite-imagery': case 'satellite_imagery': case 'imagery':
        return apply(setShowSatelliteImagery, showSatelliteImagery, 'satellite-imagery');
      case 'aviation-tracker': case 'aviation': case 'flights':
        return apply(setShowAviationTracker, showAviationTracker, 'aviation-tracker');
      case 'land-cover': case 'land_cover': case 'land-cover-mapper':
        return apply(setShowLandCoverMapper, showLandCoverMapper, 'land-cover');
      case 'market-intel': case 'market_intel': case 'intelligence': case 'pulse': case 'intel':
        return apply(setShowMarketIntelPanel, showMarketIntelPanel, 'market-intel');
      case 'intel-feed': case 'intel_feed': case 'feed':
        return apply(setShowIntelFeed, showIntelFeed, 'intel-feed');
      case 'cognitive': case 'cognitive-dashboard':
        return apply(setShowCognitiveDashboard, showCognitiveDashboard, 'cognitive');
      case 'multihazard': case 'multi-hazard': case 'toolworkbench': case 'tool-workbench':
        return apply(setShowMultiHazardPanel, showMultiHazardPanel, 'multihazard');
      case 'memory': case 'memory-explorer':
        return apply(setShowMemoryExplorer, showMemoryExplorer, 'memory');
      case 'settings': case 'settings-panel':
        return apply(setShowSettings, showSettings, 'settings');
      case 'study-area': case 'study_area':
        return apply(setShowStudyArea, showStudyArea, 'study-area');
      case 'api-vault': case 'api_vault': case 'keys':
        return apply(setShowApiVault, showApiVault);
      case 'command-palette': case 'command_palette': case 'palette':
        return apply(setShowCommandPalette, showCommandPalette);
      case 'scenario-gallery': case 'scenario_gallery': case 'scenarios':
        return apply(setShowScenarioGallery, showScenarioGallery, 'scenario-gallery');
      case 'scenario-editor': case 'scenario_editor': case 'new-scenario':
        return apply(setShowScenarioEditor, showScenarioEditor, 'scenario-editor');
      case 'cinematic-director': case 'cinematic_director': case 'cinematic':
        return apply(setShowCinematicDirector, showCinematicDirector, 'cinematic-director');
      case 'spatial-sketch': case 'spatial_sketch': case 'sketch':
        return apply(setShowSpatialSketching, showSpatialSketching, 'spatial-sketch');
      case 'performance': case 'perf': case 'perf-monitor':
        return apply(setShowPerfMonitor, showPerfMonitor);
      case 'timeline': case 'timeline-bar':
        return apply(setShowTimeline, showTimeline);
      case 'measure': case 'measure-tool':
        return apply(setShowMeasureTool, showMeasureTool);
      case 'time-slider': case 'time_slider':
        return apply(setShowTimeSlider, showTimeSlider);
      case 'admin': case 'admin-dashboard':
        if (isAdmin) return apply(setShowAdmin, showAdmin);
        return undefined;
      case 'iss': case 'iss-live': case 'iss-tracker':
        toggleISS();
        return true;
      case 'ai': case 'chat': case 'ai-chat':
        setShowAI(true);
        focusPanel('ai');
        return true;
      // ── Newly wired panels ──
      case 'fork': case 'fork-manager': case 'fork-mode':
        setForkMode(p => !p);
        return true;
      case 'monitor': case 'monitor-panel':
        if (desired === false) { setMonitorCollapsed(true); return false; }
        setMonitorCollapsed(false);
        return true;
      case 'route': case 'route-tool':
        setNavMode(desired === false ? 'none' : 'route');
        if (desired !== false) { setShowMeasureTool(false); }
        return true;
      case 'safest': case 'safest-location':
        setNavMode(desired === false ? 'none' : 'safest');
        if (desired !== false) { setShowMeasureTool(false); }
        return true;
      case 'heatmap-legend': case 'heatmap_legend':
        return apply(setShowHeatmapLegend, showHeatmapLegend);
      case 'smoke-legend': case 'smoke_legend':
        return apply(setShowSmokeLegend, showSmokeLegend);
      case 'population-impact': case 'population_impact':
        return apply(setShowPopulationImpact, showPopulationImpact);
      default:
        return undefined;
    }
  }, [showAnalyticsWorkbench, showAnalytics, showSatelliteTracker, showSatelliteImagery, showAviationTracker, showLandCoverMapper, showMarketIntelPanel, showIntelFeed, showCognitiveDashboard, showMultiHazardPanel, showMemoryExplorer, showSettings, showStudyArea, showApiVault, showCommandPalette, showScenarioGallery, showScenarioEditor, showCinematicDirector, showSpatialSketching, showPerfMonitor, showTimeline, showMeasureTool, showTimeSlider, showAdmin, showHeatmapLegend, showSmokeLegend, showPopulationImpact, setShowAnalyticsWorkbench, setShowAnalytics, setShowSatelliteTracker, setShowSatelliteImagery, setShowAviationTracker, setShowLandCoverMapper, setShowMarketIntelPanel, setShowIntelFeed, setShowCognitiveDashboard, setShowMultiHazardPanel, setShowMemoryExplorer, setShowSettings, setShowStudyArea, setShowApiVault, setShowCommandPalette, setShowScenarioGallery, setShowScenarioEditor, setShowCinematicDirector, setShowSpatialSketching, setShowPerfMonitor, setShowTimeline, setShowMeasureTool, setShowTimeSlider, setShowAdmin, setShowAI, focusPanel, toggleISS, isAdmin, setForkMode, setMonitorCollapsed, setNavMode, setShowHeatmapLegend, setShowSmokeLegend, setShowPopulationImpact]);

  const executeAgentCommands = useCallback((commands: Array<Record<string, unknown>>) => {
    const v = viewerRef.current;
    if (!v) return;
    const history = agentActionHistoryRef.current;
    // A flyTo creates a labelled focus marker; an addPin at the SAME spot would
    // duplicate the label. Track the flyTo target so we can skip that pin.
    let flyTarget: { lat: number; lon: number } | null = null;
    for (const cmd of commands) {
      try {
        const action: { type: 'flyTo' | 'toggleLayer' | 'addEntity' | 'addPanel' | 'openPanel' | 'setLayerOpacity' | 'screenshot'; entities?: Cesium.Entity[]; layerId?: string; previousEnabled?: boolean; previousCamera?: { longitude: number; latitude: number; height: number }; panelData?: unknown; description: string; timestamp: number } = {
          type: 'addEntity',
          description: cmd.action as string,
          timestamp: Date.now(),
        };
        switch (cmd.action as string) {
          case 'flyTo': {
            const lat = cmd.lat as number;
            const lon = cmd.lon as number;
            if (isFinite(lat) && isFinite(lon)) {
              const cam = v.camera.positionCartographic;
              action.type = 'flyTo';
              action.previousCamera = { longitude: Cesium.Math.toDegrees(cam.longitude), latitude: Cesium.Math.toDegrees(cam.latitude), height: cam.height };
              action.description = `Fly to ${(cmd.label as string) || `${lat.toFixed(2)}, ${lon.toFixed(2)}`}`;
              flyTarget = { lat, lon };
              const bbox = cmd.bbox as { latMin: number; latMax: number; lonMin: number; lonMax: number } | undefined;
              focusLocation(lat, lon, {
                label: (cmd.label as string) || 'Location',
                color: '#60a5fa',
                height: (cmd.height as number) || 20000,
                rect: bbox ? { west: bbox.lonMin, south: bbox.latMin, east: bbox.lonMax, north: bbox.latMax } : undefined,
              });
              cleanupThinkingSteps(true);
            }
            break;
          }
          case 'toggleLayer': {
            const layerId = cmd.layerId as string;
            const enabled = cmd.enabled as boolean;
            if (layerId) {
              const currentOn = isLayerEnabled(layerId);
              if (currentOn !== enabled) {
                action.type = 'toggleLayer';
                action.layerId = layerId;
                action.previousEnabled = currentOn;
                action.description = `${enabled ? 'Enable' : 'Disable'} layer: ${layerId}`;
                // Use the direct setter (not toggleLayer) so the AI's
                // explicit on/off isn't overridden by layer loading errors
                // (e.g. ais_vessels auto-toggles off when API key is missing).
                setLayerEnabled(layerId, enabled);
              }
            }
            break;
          }
          case 'addPin': {
            const lat = cmd.lat as number;
            const lon = cmd.lon as number;
            if (isFinite(lat) && isFinite(lon)) {
              // Skip if this pin duplicates the flyTo focus marker at the same spot
              if (flyTarget && Math.abs(flyTarget.lat - lat) < 0.0001 && Math.abs(flyTarget.lon - lon) < 0.0001) {
                break;
              }
              const color = (cmd.color as string) || '#ef4444';
              const label = (cmd.label as string);
              const entity = v.entities.add({
                position: Cesium.Cartesian3.fromDegrees(lon, lat),
                name: label || 'Agent Pin',
                billboard: { image: createPinIcon(color, 24), width: 24, height: 24, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
                label: label ? { text: label, font: '12px "Inter", sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, backgroundColor: Cesium.Color.fromCssColorString('#0b1220').withAlpha(0.65), showBackground: true, backgroundPadding: new Cesium.Cartesian2(6, 4), style: Cesium.LabelStyle.FILL_AND_OUTLINE, horizontalOrigin: Cesium.HorizontalOrigin.CENTER, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY, pixelOffset: new Cesium.Cartesian2(0, -6) } : undefined,
                properties: { lat, lon, agent: true },
              });
              action.entities = [entity];
              action.description = label || `Pin at ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
            }
            break;
          }
          case 'addHeatmap': {
            const points = cmd.points as Array<{ lat: number; lon: number; value: number }>;
            const radius = (cmd.radius as number) || 50;
            if (Array.isArray(points)) {
              const entities: Cesium.Entity[] = [];
              for (const pt of points) {
                if (!isFinite(pt.lat) || !isFinite(pt.lon)) continue;
                const intensity = Math.max(0, Math.min(1, pt.value || 0.5));
                const color = Cesium.Color.fromHsl(0.66 - intensity * 0.66, 1, 0.5, 0.6);
                const pixelSize = Math.max(4, Math.round(radius * intensity * 0.15));
                entities.push(v.entities.add({
                  position: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat),
                  point: { pixelSize, color, outlineColor: Cesium.Color.WHITE.withAlpha(0.3), outlineWidth: 1, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
                  properties: { layer: 'heatmap', lat: pt.lat, lon: pt.lon, value: pt.value, agent: true },
                }));
              }
              action.entities = entities;
              action.description = `Heatmap (${entities.length} points)`;
            }
            break;
          }
          case 'addPolygon': {
            const coords = cmd.coordinates as Array<[number, number]>;
            const label = (cmd.label as string) || 'Zone';
            const color = (cmd.color as string) || 'rgba(255,0,0,0.3)';
            const extrudedHeight = (cmd.extrudedHeight as number) || (cmd.height as number) || 0;
            const outlineOnly = (cmd.outlineOnly as boolean) || false;
            if (Array.isArray(coords) && coords.length >= 3) {
              const positions = coords.map(c => Cesium.Cartesian3.fromDegrees(c[1], c[0]));
              const rgba = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
              const fill = rgba ? Cesium.Color.fromBytes(+rgba[1], +rgba[2], +rgba[3], Math.round((parseFloat(rgba[4]) || 0.35) * 255)) : Cesium.Color.WHITE.withAlpha(0.35);
              const entity = v.entities.add({
                polygon: {
                  hierarchy: positions,
                  material: outlineOnly ? Cesium.Color.TRANSPARENT : fill,
                  outline: true,
                  outlineColor: outlineOnly ? Cesium.Color.LIME : fill.withAlpha(0.9),
                  height: 1.0,
                  ...(extrudedHeight > 0 ? { extrudedHeight: extrudedHeight + 1.0 } : {}),
                },
                name: label,
                properties: { label, agent: true },
              });
              action.entities = [entity];
              action.description = label;
            }
            break;
          }
          case 'addGeoJSON': {
            const geojson = cmd.geojson as { type: string; features?: Array<{ geometry: { type: string; coordinates: unknown }; properties?: Record<string, unknown> }> };
            const label = (cmd.label as string) || 'GeoJSON';
            const color = (cmd.color as string) || '#22c55e';
            const cesiumColor = (() => { try { return Cesium.Color.fromCssColorString(color); } catch { return Cesium.Color.fromCssColorString('#22c55e'); } })();
            const entities: Cesium.Entity[] = [];
            const addPoint = (lon: number, lat: number, props?: Record<string, unknown>) => {
              if (!isFinite(lon) || !isFinite(lat)) return;
              entities.push(v.entities.add({
                position: Cesium.Cartesian3.fromDegrees(lon, lat),
                billboard: { image: createPinIcon(color, 20), width: 20, height: 20, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
                properties: { layer: 'geojson', agent: true, ...props },
              }));
            };
            const addLine = (coords: number[][], props?: Record<string, unknown>) => {
              if (!Array.isArray(coords) || coords.length < 2) return;
              const positions = coords.map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1]));
              entities.push(v.entities.add({
                polyline: { positions, width: 2, material: cesiumColor, clampToGround: true },
                properties: { layer: 'geojson', agent: true, ...props },
              }));
            };
            const addPolygon = (rings: number[][][], props?: Record<string, unknown>) => {
              if (!Array.isArray(rings) || rings.length === 0) return;
              const outer = rings[0];
              if (outer.length < 3) return;
              const positions = outer.map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1]));
              const holes = rings.slice(1).map(ring => new Cesium.PolygonHierarchy(ring.map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1]))));
              entities.push(v.entities.add({
                polygon: {
                  hierarchy: new Cesium.PolygonHierarchy(positions, holes),
                  material: cesiumColor.withAlpha(0.4),
                  outline: true,
                  outlineColor: cesiumColor.withAlpha(0.9),
                  height: 0.5,
                },
                properties: { agent: true, ...props },
              }));
            };
            const renderGeometry = (geom: { type: string; coordinates: unknown }, props?: Record<string, unknown>) => {
              if (!geom) return;
              switch (geom.type) {
                case 'Point': { const c = geom.coordinates as [number, number]; addPoint(c[0], c[1], props); break; }
                case 'MultiPoint': { for (const c of (geom.coordinates as number[][])) addPoint(c[0], c[1], props); break; }
                case 'LineString': { addLine(geom.coordinates as number[][], props); break; }
                case 'MultiLineString': { for (const line of (geom.coordinates as number[][][])) addLine(line, props); break; }
                case 'Polygon': { addPolygon(geom.coordinates as number[][][], props); break; }
                case 'MultiPolygon': { for (const poly of (geom.coordinates as number[][][][])) addPolygon(poly, props); break; }
                case 'GeometryCollection': { const geoms = (geom as unknown as { geometries: Array<{ type: string; coordinates: unknown }> }).geometries; if (Array.isArray(geoms)) for (const g of geoms) renderGeometry(g, props); break; }
              }
            };
            if (geojson?.features) {
              for (const feature of geojson.features) renderGeometry(feature.geometry, feature.properties);
            } else if (geojson?.type === 'Feature') {
              const singleFeature = geojson as unknown as { geometry: { type: string; coordinates: unknown }; properties?: Record<string, unknown> };
              renderGeometry(singleFeature.geometry, singleFeature.properties);
            } else if (geojson?.type && geojson.type !== 'FeatureCollection') {
              renderGeometry(geojson as unknown as { type: string; coordinates: unknown }, { label });
            }
            action.entities = entities;
            action.description = `${label} (${entities.length} features)`;
            break;
          }
          case 'addChart': {
            const chartType = (cmd.type as string) || 'bar';
            const title = (cmd.title as string) || 'Chart';
            const labels = cmd.labels as string[] | undefined;
            const values = cmd.values as number[] | undefined;
            const pos = cmd.position as { lat: number; lon: number } | undefined;
            if (pos && isFinite(pos.lat) && isFinite(pos.lon) && labels && values) {
              const canvas = document.createElement('canvas');
              canvas.width = 320;
              canvas.height = 200;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.fillStyle = 'rgba(15,23,42,0.9)';
                ctx.fillRect(0, 0, 320, 200);
                ctx.fillStyle = '#e2e8f0';
                ctx.font = 'bold 13px sans-serif';
                ctx.fillText(title, 12, 22);
                const maxVal = Math.max(...values, 1);
                const barW = Math.max(8, Math.floor(260 / labels.length) - 6);
                labels.forEach((lbl, i) => {
                  const barH = (values[i] / maxVal) * 130;
                  const x = 20 + i * (barW + 6);
                  const y = 175 - barH;
                  ctx.fillStyle = Cesium.Color.fromHsl(0.55 + (i / labels.length) * 0.3, 0.8, 0.5).toCssColorString();
                  ctx.fillRect(x, y, barW, barH);
                  ctx.fillStyle = '#94a3b8';
                  ctx.font = '9px sans-serif';
                  ctx.fillText(lbl.slice(0, 6), x, 190);
                  ctx.fillText(String(values[i]), x, y - 3);
                });
              }
              const entity = v.entities.add({
                position: Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, 5000),
                billboard: { image: canvas.toDataURL(), width: 320, height: 200, disableDepthTestDistance: Number.POSITIVE_INFINITY },
                properties: { layer: 'chart', agent: true },
              });
              action.entities = [entity];
              action.description = title;
            }
            break;
          }
          case 'addRoute': {
            // Real OSRM street-following walking route drawn on the globe and
            // flown with a banked camera path. fromLat/fromLon/toLat/toLon are
            // required; label + color optional.
            const fromLat = cmd.fromLat as number;
            const fromLon = cmd.fromLon as number;
            const toLat = cmd.toLat as number;
            const toLon = cmd.toLon as number;
            if (isFinite(fromLat) && isFinite(fromLon) && isFinite(toLat) && isFinite(toLon)) {
              const label = (cmd.label as string) || 'Route';
              const routeColor = Cesium.Color.CYAN;
              const routeEntity = drawRouteOnGlobe(v, [[fromLat, fromLon], [toLat, toLon]], routeColor);
              action.entities = [routeEntity];
              action.description = label;
              fetchWalkingRoute(fromLat, fromLon, toLat, toLon).then(res => {
                if (res.error || res.polyline.length < 2) return;
                if (action.entities?.[0]) v.entities.remove(action.entities[0]);
                const realRoute = drawRouteOnGlobe(v, res.polyline, routeColor);
                action.entities = [realRoute];
                flyRoute(v, res.polyline, 8);
              });
            }
            break;
          }
          case 'moveCamera': {
            // Cinematic camera verbs driven by voice/text: orbit / pan / tilt /
            // rotate / stop, with optional speed (slow|normal|fast). This is the
            // "camera choreography" path — real continuous motion.
            const motion = String(cmd.motion || '');
            const direction = String(cmd.direction || 'right');
            const speed = String(cmd.speed || 'normal') as 'slow' | 'normal' | 'fast';
            const cam = cinematicCameraRef.current;
            if (motion === 'stop') {
              cam?.stop();
              action.description = 'Stop camera motion';
            } else if (motion === 'orbit') {
              // Orbit around the current view center — pick the globe under the
              // crosshair as the pivot.
              const pos = v.camera.pickEllipsoid(new Cesium.Cartesian2(v.canvas.clientWidth / 2, v.canvas.clientHeight / 2), v.scene.globe.ellipsoid);
              if (pos) {
                // Create a transient entity at the pivot so the camera orbits it.
                const pivot = v.entities.add({ position: pos, point: { pixelSize: 0 } });
                cam?.orbit(pivot, speed, 'continuous');
                action.description = `Orbit ${speed}`;
                setTimeout(() => v.entities.remove(pivot), 50);
              }
            } else if (motion === 'pan') {
              cam?.pan(direction as 'left' | 'right' | 'up' | 'down', speed, 'continuous');
              action.description = `Pan ${direction}`;
            } else if (motion === 'tilt') {
              cam?.tilt(direction as 'up' | 'down', speed, 'continuous');
              action.description = `Tilt ${direction}`;
            } else if (motion === 'rotate') {
              cam?.rotate(direction as 'left' | 'right', speed, 'continuous');
              action.description = `Rotate ${direction}`;
            }
            break;
          }
case 'openPanel':
          case 'closePanel':
          case 'togglePanel': {
            const panelId = cmd.panelId as string;
            const desired = cmd.action === 'openPanel' ? true : cmd.action === 'closePanel' ? false : undefined;
            if (panelId) {
              const opened = applyPanelCommand(panelId, desired);
              if (opened !== undefined) {
                action.type = 'openPanel';
                action.description = `${cmd.action} ${panelId}`;
              }
            }
            break;
          }
          case 'openAnalyticalModel': {
            const modelId = cmd.modelId as number;
            setShowAnalyticsWorkbench(true);
            focusPanel('analytics');
            if (typeof modelId === 'number') setPendingAnalyticalToolId(modelId);
            action.type = 'openPanel';
            action.description = `open ${cmd.name || `model ${modelId}`} in Analytics Workbench`;
            break;
          }
          case 'setLayerOpacity': {
            const layerId = cmd.layerId as string;
            const opacity = cmd.opacity as number;
            if (layerId && typeof opacity === 'number' && isFinite(opacity)) {
              const clamped = Math.max(0, Math.min(1, opacity));
              setLayerOpacity(prev => ({ ...prev, [layerId]: clamped }));
              action.type = 'setLayerOpacity';
              action.description = `Opacity ${layerId} → ${Math.round(clamped * 100)}%`;
            }
            break;
          }
          case 'screenshot': {
            try {
              v.render();
              const canvas = v.canvas;
              const url = canvas.toDataURL('image/png');
              const a = document.createElement('a');
              a.href = url;
              a.download = `terranoetis-${Date.now()}.png`;
              a.click();
              action.type = 'screenshot';
              action.description = 'Globe screenshot saved';
            } catch { /* canvas tainted or render fail */ }
            break;
          }
          case 'focusEntity': {
            const entityId = cmd.entityId as string;
            const search = entityId
              ? v.entities.values.find(e => e.id === entityId || e.name?.toLowerCase() === String(entityId).toLowerCase())
              : undefined;
            if (search && search.position) {
              const posVal = search.position.getValue(v.clock.currentTime);
              if (!posVal) break;
              const carto = Cesium.Cartographic.fromCartesian(posVal);
              if (carto) {
                const lat = Cesium.Math.toDegrees(carto.latitude);
                const lon = Cesium.Math.toDegrees(carto.longitude);
                flyTarget = { lat, lon };
                focusLocation(lat, lon, { label: (cmd.label as string) || search.name || entityId, color: '#f59e0b', height: 3000000 });
                action.type = 'flyTo';
                action.description = `Tracking ${search.name || entityId}`;
              }
            } else if (cmd.lat != null && cmd.lon != null) {
              const lat = cmd.lat as number, lon = cmd.lon as number;
              if (isFinite(lat) && isFinite(lon)) {
                flyTarget = { lat, lon };
                focusLocation(lat, lon, { label: (cmd.label as string) || 'Target', color: '#f59e0b', height: 3000000 });
                action.type = 'flyTo';
                action.description = `Tracking ${cmd.label || 'target'}`;
              }
            }
            break;
          }
          default:
            break;
        }
        if (action.type !== 'addEntity') history.push(action as any);
        else if (action.entities && action.entities.length > 0) history.push(action as any);
      } catch { /* skip malformed commands */ }
    }
  }, [focusLocation, isLayerEnabled, cleanupThinkingSteps, applyPanelCommand, setLayerEnabled, setLayerOpacity, focusPanel]);

  const sendToPipeline = useCallback(async (goal: string, wsId: string | null) => {
    const resp = await fetch('/api/agent/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' , ...authHeaders() },
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
              setAgentSteps(prev => [...prev.slice(-5), {type:'subtask',text:`Running: ${data.subtask.description}`,subtask:data.subtask.description,status:'running',startedAt:Date.now()}]);
            }
            if (data.subtask.status === 'completed' && data.subtask.result) {
              stepOutputs.push(`## ${data.subtask.description}\n\`\`\`\n${data.subtask.result.slice(0, 500)}\n\`\`\``);
              setAgentSteps(prev => [...prev.slice(-5), {type:'subtask',text:`Completed: ${data.subtask.description} (${data.subtask.executionTimeMs || 0}ms)`,subtask:data.subtask.description,status:'completed',timeMs:data.subtask.executionTimeMs,output:data.subtask.result,startedAt:Date.now()}]);
            }
            if (data.subtask.status === 'failed') {
              setAgentSteps(prev => [...prev.slice(-5), {type:'subtask',text:`Failed: ${data.subtask.description}: ${data.subtask.error || 'Failed'}`,subtask:data.subtask.description,status:'failed',output:data.subtask.error,startedAt:Date.now()}]);
            }
          }

          if (data.commands && Array.isArray(data.commands)) {
            executeAgentCommands(data.commands);
          }
          if (data.done) {
            if (data.workspaceId) setSandboxWorkspaceId(data.workspaceId);
            const summary = stepOutputs.join('\n\n');
            if (summary) {
              setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: summary, type: 'pipeline' }]);
              stepOutputs.length = 0;
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
  }, [executeAgentCommands, setAgentSteps, setAiMessages, setPipelineProgress, setSandboxWorkspaceId]);

  function newChat() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    // Use the tab system: open a new tab (snapshots current, creates fresh)
    chatState.openChatTab();
  }

  async function loadChat(id: string) {
    // Save the current tab's chat if it exists
    const prevChatId = chatState.currentChatId;
    if (prevChatId) {
      await saveChat({
        id: prevChatId,
        title: autoTitle(aiMessages),
        messages: aiMessages,
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
    const loadedMessages = session.messages.map(m => ({ ...m, id: m.id || nextAiMsgIdRef.current++ }));
    setAiMessages(loadedMessages);
    if (session.workspaceId) setSandboxWorkspaceId(session.workspaceId);
    chatState.setCurrentChatId(session.id);
    // Sync loaded messages into the active tab record so persistence captures them.
    if (chatState.activeTabId) {
      chatState.mutateTab(chatState.activeTabId, tab => ({
        ...tab,
        messages: loadedMessages,
        currentChatId: session.id,
        sandboxWorkspaceId: session.workspaceId || tab.sandboxWorkspaceId,
      }));
      chatState.renameChatTab(chatState.activeTabId, session.title || autoTitle(session.messages));
    }
    setShowChatHistory(false);
  }

  async function deleteChatSession(id: string) {
    await deleteChat(id);
    if (chatState.currentChatId === id) {
      chatState.setCurrentChatId(null);
      setAiMessages([]); // prevent auto-save from recreating the chat
    }
    setChatList(prev => prev.filter(c => c.id !== id));
  }

  async function deleteCurrentChat() {
    const id = chatState.currentChatId;
    if (!id) {
      // No saved session yet — just clear the composer.
      setAiMessages([]);
      chatState.setCurrentChatId(null);
      return;
    }
    await deleteChatSession(id);
  }

  async function clearAllChats() {
    for (const chat of chatListRef.current) {
      await deleteChat(chat.id);
    }
    chatState.setCurrentChatId(null);
    setChatList([]);
    setAiMessages([]);
  }


  const { sendAI } = useChat(
    extractLocation,
    focusLocation,
    toggleLayer,
    isLayerEnabled,
    sendToPipeline,
    sendMonitorCommand,
    sendScheduleCommand,
    executeAgentCommands,
    generateLocalResponse,
    cleanupThinkingSteps,
    loadFlightTracks,
    viewerRef,
    { abortControllerRef, currentRequestIdRef, onAnalyticalResult: (data) => {
      // Analytical compute → globe: render the real computed field as a
      // heatmap over the study area when the agent runs analytical_execute.
      const d = data as { toolId?: number; label?: string; lat?: number; lon?: number; unit?: string; vizType?: string; value?: number; grid?: { latMin: number; latMax: number; lonMin: number; lonMax: number; nLat: number; nLon: number; values: number[]; valueMin: number; valueMax: number; valueMean?: number; valueStd?: number; valueMedian?: number; finiteCellCount?: number; hasNaN?: boolean } };
      if (d?.grid) {
        const g = d.grid;
        handleToolResult(
          d.toolId ?? 0,
          d.label || `Model ${d.toolId}`,
          d.lat ?? 0,
          d.lon ?? 0,
          d.value,
          { ...g, valueMean: g.valueMean, valueStd: g.valueStd, valueMedian: g.valueMedian, finiteCellCount: g.finiteCellCount, hasNaN: g.hasNaN ?? g.values.some(v => typeof v !== 'number' || !Number.isFinite(v)) },
          d.unit,
          d.vizType,
        );
      }
    } },
  );
  sendAIRef.current = sendAI;
  (window as unknown as Record<string, unknown>).__sendAI = sendAI;

  async function extractLocation(text: string): Promise<{ lat: number; lon: number } | null> {
    if (typeof text !== 'string' || !text) return null;
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

  function undoLastAgentAction() {
    const history = agentActionHistoryRef.current;
    if (history.length === 0) return;
    const last = history.pop()!;
    const v = viewerRef.current;
    if (!v) return;
    switch (last.type) {
      case 'flyTo':
        if (last.previousCamera) {
          focusLocation(last.previousCamera.latitude, last.previousCamera.longitude, { label: 'Previous view', color: '#60a5fa', height: last.previousCamera.height });
        }
        break;
      case 'toggleLayer':
        if (last.layerId) {
          toggleLayer(last.layerId);
        }
        break;
      case 'addEntity':
        if (last.entities) {
          for (const e of last.entities) {
            try { v.entities.remove(e); } catch { /* ignore */ }
          }
        }
        break;
    }
  }

  function clearAllAgentActions() {
    const v = viewerRef.current;
    if (!v) return;
    const toRemove = v.entities.values.filter((e: any) => {
      const props = e.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      return props?.agent === true;
    });
    for (const e of toRemove) {
      try { v.entities.remove(e); } catch { /* ignore */ }
    }
    agentActionHistoryRef.current = [];
  }

  // ── Advanced chat helpers ──────────────────────────────────────────────

  // #5 Execute a plan from a plan card via the /plan/execute streaming endpoint
  const executePlanFromCard = useCallback(async (plan: PlanCard, msgId: number) => {
    setAiTyping(true);
    try {
      const resp = await fetch('/api/agent/plan/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ plan, sessionId }),
      });
      if (!resp.ok || !resp.body) throw new Error(`Plan execution failed (${resp.status})`);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';
      const subAgents: any[] = [];
      const stepStatuses: Record<string, string> = {};
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'subagent' || data.role) {
              subAgents.push({ role: data.role, stepId: data.stepId, status: data.status, text: data.text, timestamp: data.timestamp || Date.now() });
              setAiMessages(prev => prev.map(m => m.id === msgId ? { ...m, subAgents: [...(m.subAgents || []), subAgents[subAgents.length - 1]].slice(-50) } : m));
            }
            if (data.type === 'step_output' && data.stepId) {
              stepStatuses[data.stepId] = 'completed';
              setAiMessages(prev => prev.map(m => m.id === msgId && m.plan ? { ...m, plan: { ...m.plan, steps: m.plan.steps.map(s => s.id === data.stepId ? { ...s, status: 'completed', output: data.output, durationMs: data.durationMs } : s) } } : m));
            }
            if (data.type === 'token' && data.text) { finalText += data.text; setAiMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: m.content + data.text } : m)); }
            if (data.type === 'output' && data.text) { finalText = data.text; }
            if (data.type === 'error') { setAiMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: `Error: ${data.error}` } : m)); }
          } catch { /* skip */ }
        }
      }
      // Mark plan as executed and parse artifacts
      const { cleanedContent, artifacts } = extractArtifacts(finalText);
      setAiMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: artifacts.length > 0 ? cleanedContent : finalText, plan: m.plan ? { ...m.plan, executed: true } : m.plan, artifacts: artifacts.length > 0 ? artifacts : undefined, resumable: true } : m));
    } catch (e) {
      setAiMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: `Plan execution failed: ${e}` } : m));
    }
    setAiTyping(false);
  }, [sessionId, setAiMessages, setAiTyping]);

  // #5 Toggle a plan step's enabled state
  const togglePlanStep = useCallback((msgId: number, stepId: string) => {
    setAiMessages(prev => prev.map(m => m.id === msgId && m.plan ? { ...m, plan: { ...m.plan, steps: m.plan.steps.map(s => s.id === stepId ? { ...s, enabled: !s.enabled } : s) } } : m));
  }, [setAiMessages]);

  // #4 Update a tool event (after approval/denial)
  const updateToolEvent = useCallback((msgId: number, toolName: string, patch: Partial<ToolEvent>) => {
    setAiMessages(prev => prev.map(m => {
      if (m.id !== msgId || !m.toolEvents) return m;
      return { ...m, toolEvents: m.toolEvents.map(e => e.name === toolName ? { ...e, ...patch } : e) };
    }));
  }, [setAiMessages]);

  // #7 Re-run a query with an adjusted slider parameter
  const rerunWithParam = useCallback((msg: ChatMessage, param: string, value: number) => {
    // Find the original user query that produced this message
    const idx = aiMessagesRef.current.findIndex(m => m.id === msg.id);
    let userQuery = '';
    for (let i = idx - 1; i >= 0; i--) {
      if (aiMessagesRef.current[i].role === 'user') { userQuery = aiMessagesRef.current[i].content; break; }
    }
    if (!userQuery) return;
    const rerunQuery = `${userQuery} (${param} = ${value})`;
    // Genuine rerun — bypass the double-send guard so a slider re-run always goes through.
    sendAIRef.current(rerunQuery, { force: true });
  }, []);

  // #14 Resume a partially-generated message
  const resumeMessage = useCallback(async (msg: ChatMessage) => {
    const idx = aiMessagesRef.current.findIndex(m => m.id === msg.id);
    let originalMessage = '';
    for (let i = idx - 1; i >= 0; i--) {
      if (aiMessagesRef.current[i].role === 'user') { originalMessage = aiMessagesRef.current[i].content; break; }
    }
    if (!originalMessage) return;
    setAiTyping(true);
    // Mark message as being resumed
    setAiMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: m.content + '\n\n*[continuing...]*', resumable: false } : m));
    try {
      await resumeStream(
        msg.content,
        originalMessage,
        sessionId,
        (token) => {
          setAiMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: m.content + token } : m));
        },
        (continuation) => {
          setAiMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: m.content + '\n\n' + continuation, resumable: true } : m));
          setAiTyping(false);
        },
        (err) => {
          setAiMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: m.content + `\n\n*[Resume failed: ${err}]*`, resumable: true } : m));
          setAiTyping(false);
        },
      );
    } finally {
      // Guarantee the composer unlocks even if resumeStream rejects — otherwise
      // the double-send guard would block every future message until reload.
      setAiTyping(false);
    }
  }, [sessionId, setAiMessages, setAiTyping]);

  // #5 Generate a plan for a complex query (triggered by user)
  const generatePlanForQuery = useCallback(async (query: string) => {
    setPlanningFor(query);
    setAiTyping(true);
    try {
      const plan = await generatePlanClient(query) as PlanCard | undefined;
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: '', plan, type: 'plan' }]);
    } catch (e) {
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant', content: `Plan generation failed: ${e}`, type: 'error' }]);
    }
    setAiTyping(false);
    setPlanningFor(null);
  }, [setAiMessages, setAiTyping, setPlanningFor]);

  async function generateLocalResponse(message: string, location: { lat: number; lon: number } | null): Promise<string> {
    try {
      const resp = await fetch('/api/agent/local-ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.slice(0, 2000) }),
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.response) return data.response;
      }
    } catch { /* fall through to keyword matcher */ }
    const lower = message.toLowerCase();
    if (lower.includes('earthquake')) return '**Seismic Activity**\n\nRecent earthquakes are displayed on the globe. Use the sidebar to toggle earthquake data layers. The color intensity indicates magnitude - red circles show M5+ events.';
    if (lower.includes('weather')) return '**Weather Information**\n\nClick on any location to see current weather conditions. Temperature, humidity, wind speed, and conditions are displayed in real-time cards.';
    if (lower.includes('storm') || lower.includes('hurricane')) return '**Storm Tracking**\n\nActive storms are shown with forecast cones indicating predicted paths. Click on any storm to see 24/48/72-hour forecasts and wind speed data.';
    if (lower.includes('fire') || lower.includes('wildfire')) return '**Wildfire Monitoring**\n\nNASA MODIS/VIIRS fire detections shown as orange pulsing markers. Smoke dispersion simulations available for active fires.';
    if (lower.includes('population')) return '**Population Impact**\n\n50 major cities shown with population-based impact zones. Useful for assessing disaster risk to urban areas.';
    if (lower.includes('plane') || lower.includes('flight') || lower.includes('aircraft') || lower.includes('adsb')) return '**Live Aircraft**\n\nAircraft tracking is available via the sidebar (Aviation category). Enable "ADSB.lol" or "Flight Tracks" to see live planes on the globe. Try saying "show flights near me" with location enabled.';
    if (lower.includes('help')) return '**Available Commands**\n\n- "Show earthquakes in [location]"\n- "Weather in [city]"\n- "Fly to [location]"\n- "Show population impact"\n- "Storm tracking"\n- "Wildfire status"\n- "Show flights near me"\n\nOr ask any question about Earth data!';
    if (location) return `**Location Query**\n\nCoordinates: ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}\n\nThis area can be analyzed for seismic risk, weather conditions, and population density. Use the sidebar layers to explore different data dimensions.`;
    return `**Earth Intelligence**\n\nI can help you explore:\n- Seismic activity and earthquake data\n- Weather conditions globally\n- Storm tracking and forecasts\n- Population impact analysis\n- Natural disaster monitoring\n\nTry: "Show earthquakes in Japan" or "Weather in London"`;
  }

  /* ═════════════════════════════════════════════════════════════════
     FORK (PARALLEL REALITY) CREATION
     ═════════════════════════════════════════════════════════════════ */

  const submitFork = useCallback((opts: { name: string; radiusM: number; lat: number; lon: number }) => {
    const forkName = opts.name.trim() || `Fork-${Date.now()}`;
    fetch('/api/fork/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      credentials: 'include',
      body: JSON.stringify({
        name: forkName,
        lat: opts.lat,
        lon: opts.lon,
        bufferRadiusM: opts.radiusM,
        deltas: [{ type: 'INJECT_EVENT', targetId: 'manual_fork', parameters: { lat: opts.lat, lon: opts.lon }, effectiveTimeOffsetHours: 0 }],
        maxSimulationHours: 72,
      }),
    }).then(r => r.json()).then(data => {
      if (data.forkId) {
        forkRendererRef.current?.createForkVisual(data.forkId, forkName, opts.lat, opts.lon, opts.radiusM);
        forkRendererRef.current?.spawnGhostsWithRetry(data.forkId);
        setForks(prev => [...prev, { forkId: data.forkId, name: forkName, divergenceScore: 0, status: 'running' }]);
        setActiveForkCount(prev => prev + 1);
        showNotification(`Parallel reality "${forkName}" created (${(opts.radiusM / 1000).toFixed(0)} km buffer)`, 'success');
      }
    }).catch(e => console.error('Fork creation failed:', e));
    setForkDialog(d => ({ ...d, open: false }));
  }, []);

  /* ═════════════════════════════════════════════════════════════════
     CONTEXT MENU ACTIONS
     ═════════════════════════════════════════════════════════════════ */

  const handleContextAction = useCallback((action: string) => {
    const cm = contextMenu;
    setContextMenu({ show: false, x: 0, y: 0, lat: 0, lon: 0 });
    const v = viewerRef.current;
    if (!v) return;
    if (action === 'flyTo') {
      focusLocation(cm.lat, cm.lon, { label: 'Context location', color: '#60a5fa', height: 20000 });
    } else if (action === 'pin') {
      const pinId = `pin_${Date.now()}`;
      v.entities.add({
        position: Cesium.Cartesian3.fromDegrees(cm.lon, cm.lat),
        name: 'Dropped Pin',
        billboard: { image: createPinIcon('#ef4444'), width: 24, height: 24,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
        label: { text: `${cm.lat.toFixed(3)}, ${cm.lon.toFixed(3)}`,
          font: '11px "JetBrains Mono"', fillColor: Cesium.Color.WHITE,
          pixelOffset: new Cesium.Cartesian2(0, -14) },
        properties: { layer: 'pin', lat: cm.lat, lon: cm.lon, id: pinId },
      });
      pinCountRef.current += 1;
      if (pinCountRef.current > 50) {
        const oldestPin = v.entities.values.find(e => e.properties?.getValue(Cesium.JulianDate.now())?.layer === 'pin');
        if (oldestPin) { v.entities.remove(oldestPin); pinCountRef.current -= 1; }
      }
      focusLocation(cm.lat, cm.lon, { label: 'Dropped Pin', color: '#ef4444', height: 20000 }); showNotification('Pin dropped', 'success');
    } else if (action === 'weather') {
      focusLocation(cm.lat, cm.lon, { label: 'Weather request', color: '#22d3ee', height: 20000 });
      addWeatherCard(cm.lat, cm.lon);
    } else if (action === 'events') {
      const nearby = findNearbyEvents(cm.lat, cm.lon, 200);
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'assistant',
        content: `**Events near ${cm.lat.toFixed(2)}, ${cm.lon.toFixed(2)}**\n\n${nearby.length > 0 ? nearby.map(e => `- ${e.title} (${e.distance.toFixed(0)}km)`).join('\n') : 'No recent events found within 200km.'}` }]);
      setShowAI(true); focusPanel('ai');
    } else if (action === 'ai_intel') {
      setShowAI(true); focusPanel('ai');
      setAiMessages(prev => [...prev, { id: nextAiMsgIdRef.current++, role: 'user', content: `AI Intelligence for ${cm.lat.toFixed(2)}, ${cm.lon.toFixed(2)}` }]);
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
      'smoke_dispersion',
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
    v.render();
    const canvas = v.scene.canvas;
    requestAnimationFrame(() => {
      const link = document.createElement('a');
      link.download = `terranoetis_${new Date().toISOString().slice(0,10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      showNotification('Snapshot saved!', 'success');
    });
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
      if (rotateTimerRef.current) cancelAnimationFrame(rotateTimerRef.current as unknown as number);
      rotateTimerRef.current = null;
      setIsAutoRotating(false);
    } else {
      setIsAutoRotating(true);
      const rotateFrame = () => {
        if (document.hidden) {
          rotateTimerRef.current = requestAnimationFrame(rotateFrame) as unknown as ReturnType<typeof setInterval>;
          return;
        }
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
        throttledRender(v);
        rotateTimerRef.current = requestAnimationFrame(rotateFrame) as unknown as ReturnType<typeof setInterval>;
      };
      rotateTimerRef.current = requestAnimationFrame(rotateFrame) as unknown as ReturnType<typeof setInterval>;
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
    throttledRender(v);
    // Sync the bbox to the chat store so the AI can use it for analytical models
    useChatStore.getState().setStudyAreaBbox({ latMin: south, latMax: north, lonMin: west, lonMax: east });
  }, [studyWest, studySouth, studyEast, studyNorth]);

  function clearStudyArea() {
    const v = viewerRef.current;
    if (!v) return;
    if (studyAreaEntityRef.current) {
      v.entities.remove(studyAreaEntityRef.current);
      studyAreaEntityRef.current = null;
      throttledRender(v);
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
    throttledRender(v);
  }, [studyWest, studySouth, studyEast, studyNorth]);

  const startStudyDraw = useCallback(async (type: 'RECTANGLE' | 'POLYGON' | 'CIRCLE' | 'POINT') => {
    const v = viewerRef.current;
    if (!v) return;
    // POINT: place a single marker directly (the Drawer is for shapes only)
    if (type === 'POINT') {
      setStudyDrawing(true);
      const handler = new Cesium.ScreenSpaceEventHandler(v.canvas);
      const handleClick = (e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        handler.destroy();
        const cartesian = v.scene.globe.pick(v.camera.getPickRay(e.position)!, v.scene);
        if (!cartesian) return;
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        const lat = Cesium.Math.toDegrees(carto.latitude);
        const name = `point ${studyAreasRef.current.length + 1}`;
        const entity = v.entities.add({
          position: cartesian,
          point: {
            pixelSize: 14,
            color: Cesium.Color.LIME,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        const geojson: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: { name, type: 'point' },
          }],
        };
        const area: StudyAreaItem = {
          id: `study_area_${Date.now()}`, name, type: 'point' as any,
          visible: true, active: false, entity, positions: [cartesian], geojson, color: '#22c55e', width: 3,
        };
        if (analyticalNeedsTwoPoints) {
          const activePts = studyAreasRef.current.filter(a => a.active && a.type === 'point' && a.id !== area.id);
          while (activePts.length >= 2) {
            const oldest = activePts.shift();
            if (oldest) setStudyAreaActive(v, oldest, false);
          }
        } else {
          studyAreasRef.current.forEach(a => { if (a.id !== area.id && a.active) setStudyAreaActive(v, a, false); });
        }
        setStudyAreaActive(v, area, true);
        studyAreasRef.current = [...studyAreasRef.current, area];
        setStudyAreas(studyAreasRef.current);
        setActiveStudyAreaId(area.id);
        flyToStudyAreaTopDown(v, area);
        setStudyDrawing(false);
        throttledRender(v);
      };
      handler.setInputAction(handleClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      return;
    }

    try {
      const Drawer = (await import('@cesium-extends/drawer')).default;
      if (drawerRef.current) { drawerRef.current.destroy(); drawerRef.current = null; }
      const drawer = new Drawer(v, {
        terrain: false,
        tips: { init: 'Click to place the point', start: 'Click to place · Double-click to finish', end: '' },
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
          const typeLabel = type === 'RECTANGLE' ? 'rectangle' : 'polygon';
          const name = `${typeLabel} ${studyAreasRef.current.length + 1}`;
          const color = '#22c55e';
          // The drawer reports a circle as its degenerate [center, center] point
          // list, which would make the study-area bbox a zero-area point (and the
          // land-cover grid a garbage sliver). Normalize circles to their true
          // extent: bbox-corner positions (for bbox / fly-to math) plus a proper
          // closed ring in GeoJSON (for point-in-polygon masking + export).
          const toDeg = (p: Cesium.Cartesian3): [number, number] => {
            const carto = Cesium.Cartographic.fromCartesian(p);
            return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
          };
          let finalPositions = positions;
          let ringCoords = positions.map(toDeg);
          if (type === 'CIRCLE') {
            const [cLon, cLat] = toDeg(positions[0]);
            const radiusM = entity?.ellipse?.semiMajorAxis?.getValue(Cesium.JulianDate.now()) as number | undefined;
            const rM = typeof radiusM === 'number' && Number.isFinite(radiusM) ? radiusM : 0;
            if (rM > 0) {
              const dLon = rM / (111320 * Math.max(Math.cos(Cesium.Math.toRadians(cLat)), 0.2));
              const dLat = rM / 111320;
              finalPositions = [
                Cesium.Cartesian3.fromDegrees(cLon - dLon, cLat + dLat),
                Cesium.Cartesian3.fromDegrees(cLon + dLon, cLat + dLat),
                Cesium.Cartesian3.fromDegrees(cLon + dLon, cLat - dLat),
                Cesium.Cartesian3.fromDegrees(cLon - dLon, cLat - dLat),
              ];
              ringCoords = [];
              for (let k = 0; k < 36; k++) {
                const a = (k / 36) * Math.PI * 2;
                ringCoords.push([cLon + Math.cos(a) * dLon, cLat + Math.sin(a) * dLat]);
              }
            }
          }
          // POINT is handled separately before the Drawer — this branch is
          // only for rectangles, circles, and polygons.
          const geojson: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [ringCoords.length >= 2 ? [...ringCoords, ringCoords[0]] : ringCoords],
              },
              properties: { name, type: typeLabel },
            }],
          };
          const area: StudyAreaItem = {
            id: `study_area_${Date.now()}`, name, type: typeLabel as any,
            visible: true, active: false, entity, positions: finalPositions, geojson, color, width: 3,
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
          throttledRender(v);
          // Sync the drawn area to the chat store so the AI can use it
          const bbox = computeStudyAreaBbox(area);
          if (bbox) useChatStore.getState().setStudyAreaBbox(bbox);
          // Auto-send any pending study-area query
          const pending = useChatStore.getState().pendingStudyAreaQuery;
          if (pending) {
            useChatStore.getState().setPendingStudyAreaQuery(null);
            // Access the sendAI from the ref (set by ChatPanel)
            const sendFn = (window as any).__sendAI;
            if (typeof sendFn === 'function') sendFn(pending, { force: true, studyAreaAction: 'draw' });
          }
        },
      });
    } catch (err) {
      console.warn('Drawer init failed:', err);
      setStudyDrawing(false);
    }
  }, [analyticalNeedsTwoPoints]);
  // Expose the drawing function globally so the StudyAreaPrompt can trigger it.
  (window as unknown as Record<string, unknown>).__startStudyAreaDraw = () => startStudyDraw('RECTANGLE');
  // Draw the auto-detected OSM boundary on the globe so the user can see (and
  // optionally adjust) it before the analysis runs.
  (window as unknown as Record<string, unknown>).__drawStudyAreaBbox = (bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null) => {
    const v = viewerRef.current;
    if (!v || !bbox) return;
    clearStudyArea();
    const rect = Cesium.Rectangle.fromDegrees(bbox.lonMin, bbox.latMin, bbox.lonMax, bbox.latMax);
    studyAreaEntityRef.current = v.entities.add({
      rectangle: {
        coordinates: rect,
        material: new Cesium.Color(0.2, 0.8, 0.3, 0.12),
        outline: true,
        outlineColor: Cesium.Color.LIME,
        outlineWidth: 2,
      },
    });
    v.camera.flyTo({ destination: rect });
    throttledRender(v);
    // Make sure the AI uses it even if the user just clicks "Use This Area".
    useChatStore.getState().setStudyAreaBbox(bbox);
  };

  const stopStudyDraw = useCallback(() => {
    if (drawerRef.current) {
      drawerRef.current.reset();
      drawerRef.current = null;
    }
    setStudyDrawing(false);
  }, []);

  // Stage a mission from the first-run card.
  const stageFirstRunMission = useCallback((mission: FirstRunMission) => {
    switch (mission) {
      case 'live-contacts':
        // Enable flights, AIS, satellites, earthquakes — the "live world" view.
        toggleLayer('2_adsb_lol');
        toggleLayer('ais_vessels');
        toggleLayer('6_celestrak_gp_api');
        toggleLayer('earthquakes');
        break;
      case 'environmental':
        // Enable fire, storms, alerts, floods.
        toggleLayer('wildfires');
        toggleLayer('severe_storms');
        toggleLayer('disaster_alerts');
        toggleLayer('flood_extent');
        break;
    }
    markFirstRunDone();
  }, [toggleLayer]);

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
      throttledRender(v);
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
    unifiedTimerRef.current.stop();
    Object.values(notificationTimeoutsRef.current).forEach(clearTimeout);
    notificationTimeoutsRef.current = {};
    if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
    if (issTimerRef.current) clearInterval(issTimerRef.current);
    if (issRenderTickRef.current) { issRenderTickRef.current(); issRenderTickRef.current = null; }
    if (rotateTimerRef.current) cancelAnimationFrame(rotateTimerRef.current as unknown as number);
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
    const v = viewerRef.current;
    if (v) {
      // Tear down children FIRST while the viewer is still alive — several
      // renderers (entropyHalo, oracleChain, entityTracker) dereference
      // viewer.entities / viewer.scene in their destroy() and throw if the
      // viewer is destroyed before them.
      try { entropyHaloRef.current?.destroy(); } catch { /* ignore */ }
      try { sensorStylesRef.current?.destroy(); sensorStylesRef.current = null; } catch { /* ignore */ }
      try { oracleChainRef.current?.destroy(); } catch { /* ignore */ }
      try { entityTrackerRef.current?.destroy(); } catch { /* ignore */ }
      try { aisTrackerRef.current?.stop(); aisTrackerRef.current?.clear(); } catch { /* ignore */ }
      try { flightDrRef.current?.clear(); } catch { /* ignore */ }
      try { adsbLolDrRef.current?.clear(); } catch { /* ignore */ }
      try { adsbFiDrRef.current?.clear(); } catch { /* ignore */ }
      try { airlabsDrRef.current?.clear(); } catch { /* ignore */ }
      try { removeOsmBuildings(v); } catch { /* ignore */ }
      try { v.entities.removeAll(); } catch { /* ignore */ }
      v.destroy();
    }
    viewerRef.current = null;
    focusMarkerRef.current = null;
    smokeParticlesRef.current = [];
    Object.keys(weatherCardElementsRef.current).forEach(key => { delete weatherCardElementsRef.current[key]; });
    entropyHaloRef.current = null;
    oracleChainRef.current = null;
    entityTrackerRef.current = null;
    aisTrackerRef.current = null;
    flightDrRef.current = null;
    adsbLolDrRef.current = null;
    adsbFiDrRef.current = null;
    airlabsDrRef.current = null;
    forkRendererRef.current = null;
    ghostProtocolRef.current = null;
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
    try {
      const p = infoEntity.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
      if (!p || Object.keys(p).length === 0) return null;
      const cctvMeta = p.layer === 'india_cctv' ? cctvMetaRef.current.get(infoEntity.id) : null;
      if (p.layer === 'india_cctv' && cctvMeta) {
        Object.assign(p, cctvMeta);
      } else if (p.layer === 'india_cctv' && !cctvMeta) {
        if (import.meta.env.DEV) console.warn('[InfoPanel] cctvMeta not found for', infoEntity.id, 'map size:', cctvMetaRef.current.size);
      }

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
      rows.push({ key: 'Time', val: `${new Date(Number(p.time ?? 0)).toLocaleString('en-IN', { timeZone: getTimezone(), dateStyle: 'medium', timeStyle: 'medium' })} ${getTimezone().split('/').pop()?.replace('_', ' ') || ''}` });
    } else if (layer === 'wildfires') {
      rows.push({ key: 'Status', val: String(p.status ?? 'Active') });
      rows.push({ key: 'Date', val: String(p.date ?? '') });
    } else if (layer === 'space_debris') {
      rows.push({ key: 'ID', val: String(p.id) });
      rows.push({ key: 'Epoch', val: formatIST(String(p.epoch), { dateStyle: 'medium', timeStyle: 'short' }) });
      rows.push({ key: 'Semi-major Axis', val: `${Number(p.semimajorAxis).toFixed(2)} km` });
      rows.push({ key: 'Inclination', val: `${Number(p.inclination).toFixed(4)}°` });
      rows.push({ key: 'Eccentricity', val: `${Number(p.eccentricity).toFixed(6)}` });
      rows.push({ key: 'Mean Motion', val: `${Number(p.meanMotion).toFixed(4)} revs/day` });
    } else if (layer === 'lightning_strikes') {
      rows.push({ key: 'Time', val: `${formatIST(Number(p.time), { dateStyle: 'medium', timeStyle: 'short' })} ${timezoneLabel()}` });
    } else if (layer === 'aurora_oval') {
      rows.push({ key: 'Probability', val: `${Number(p.probability)}%` });
    } else if (layer === 'submarine_cables') {
      rows.push({ key: 'Capacity', val: String(p.capacity) });
      rows.push({ key: 'Length', val: String(p.length) });
      rows.push({ key: 'Owners', val: String(p.owners) });
    } else if (layer === 'animal_migrations') {
      rows.push({ key: 'Species', val: String(p.species) });
    } else if (layer === 'live_media') {
      rows.push({ key: 'Source', val: String(p.source ?? 'YouTube') });
      rows.push({ key: 'Location', val: `${Number(p.lat).toFixed(4)}, ${Number(p.lon).toFixed(4)}` });
    } else if (layer === 'india_cctv') {
      const location = String(p.location ?? p.city ?? p.region ?? 'Worldwide');
      const updatedAt = Number(p.updatedAt ?? Date.now());
      rows.push({ key: 'Location', val: location });
      rows.push({ key: 'Category', val: String(p.category ?? 'Public webcam') });
      rows.push({ key: 'Updated', val: `${new Date(updatedAt).toLocaleString('en-IN', { timeZone: getTimezone(), dateStyle: 'medium', timeStyle: 'short' })} ${timezoneLabel()}` });
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
            <button className="info-fly" onClick={() => focusLocation(lat, lon, { label: title, color, height: 20000 })} title="Fly to location">
              <Crosshair size={14} />
            </button>
          )}
          <button className="info-close" onClick={() => { const ent = infoEntity; const props = ent?.properties?.getValue(Cesium.JulianDate.now()); if (props?.layer === 'pin') { viewerRef.current?.entities.remove(ent); pinCountRef.current = Math.max(0, pinCountRef.current - 1); } if (props?.layer === 'focus' && focusMarkerRef.current === ent) { viewerRef.current?.entities.remove(ent); focusMarkerRef.current = null; } if (props?.layer === 'weather_cards') { viewerRef.current?.entities.remove(ent); const a = entityStoreRef.current['weather_cards']; if (a) { const i = a.indexOf(ent); if (i > -1) a.splice(i, 1); } const cid = props?.cardId; if (cid) { weatherCardsRef.current = weatherCardsRef.current.filter(c => c.id !== cid); setWeatherCards(prev => prev.filter(c => c.id !== cid)); } } setInfoEntity(null); entityTrackerRef.current?.untrack(); }}><X size={14} /></button>
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

          {layer === 'india_cctv' && (
            <div className="cctv-preview">
              {(() => {
                const thumbUrl = String(p.thumbnailUrl ?? p.previewUrl ?? '');
                const streamUrl = String(p.streamUrl ?? '');
                const feedType = String(p.feedType ?? '');
                const isHls = feedType === 'm3u8' || streamUrl.includes('.m3u8') || streamUrl.includes('m3u8');
                if (isHls && streamUrl && !cctvPreviewFailed) {
                  return <CctvVideoPlayer key={`${streamUrl}-${cctvPreviewTick}`} src={streamUrl} />;
                }
                const imgUrl = thumbUrl && !cctvPreviewFailed ? `${thumbUrl}${thumbUrl.includes('?') ? '&' : '?'}tick=${cctvPreviewTick}` : '';
                return imgUrl ? (
                  <img key={imgUrl} src={imgUrl} alt={String(p.title ?? 'Live camera preview')} referrerPolicy="no-referrer" loading="eager" style={{width:'100%',height:'165px',objectFit:'cover',display:'block',background:'#000'}} onError={() => setCctvPreviewFailed(true)} />
                ) : <div className="cctv-preview-empty">Live preview unavailable</div>;
              })()}
            </div>
          )}

          {layer === 'india_cctv' && (
            <div className="sparkline-wrap">
              <div className="sparkline-title">Public feed</div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                <div style={{fontSize:10,color:'var(--text-dim)',lineHeight:1.4}}>Open-source live public webcam feed.</div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  <button
                    type="button"
                    className="cctv-link"
                    style={{border:'none',background:'none',cursor:'pointer',padding:0}}
                    onClick={() => { setCctvPreviewTick(t => t + 1); setCctvPreviewFailed(false); }}
                  >
                    Refresh
                  </button>
                  <a className="cctv-link" href={String(p.pageUrl ?? '')} target="_blank" rel="noreferrer">Open live</a>
                </div>
              </div>
            </div>
          )}

          {layer === 'live_media' && (
            <div className="cctv-preview">
              {p.youtubeVideoId ? <YoutubePlayer videoId={String(p.youtubeVideoId)} /> : <div className="cctv-preview-empty">Video unavailable</div>}
            </div>
          )}

          {layer === 'live_media' && p.youtubeVideoId && (
            <div className="sparkline-wrap">
              <div className="sparkline-title">YouTube Video</div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                <div style={{fontSize:10,color:'var(--text-dim)',lineHeight:1.4}}>{String(p.title ?? '')}</div>
                <a className="cctv-link" href={`https://www.youtube.com/watch?v=${String(p.youtubeVideoId)}`} target="_blank" rel="noreferrer">Open on YouTube</a>
              </div>
            </div>
          )}

          {layer === 'space_debris' && (
            <div className="sparkline-wrap">
              <div className="sparkline-title">Orbit Visualization</div>
              <div style={{fontSize:10,color:'var(--text-dim)'}}>Dashed purple line traces the projected orbital path over one period (~90-120 mins).</div>
            </div>
          )}

          {layer === 'flight_tracks' && (
            <div className="sparkline-wrap">
              <button className="board-sat-btn" onClick={boardFlightFromInfoPanel}>
                <Plane size={14} style={{marginRight:6,display:'inline'}} /> Travel View
              </button>
            </div>
          )}

          {['space_debris', 'satnogs_db', 'ucs_satellite_db', 'tracked_satellite', '6_celestrak_gp_api'].includes(layer) && (
            <div className="sparkline-wrap">
              <button className="board-sat-btn" onClick={boardSatelliteFromInfoPanel}>
                <Satellite size={14} style={{marginRight:6,display:'inline'}} /> Enter Travel View
              </button>
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
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[InfoPanel] error:', e);
      return <div className="cctv-preview-empty">Error loading details</div>;
    }
  };

  const traceKeyFor = (msg: ChatMessage) => `trace_${msg.traceId || msg.id}`;
  const traceTargetFor = (msg: ChatMessage) => encodeURIComponent(String(msg.traceId || msg.id));

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {/* Cesium Container */}
      <div
        ref={cesiumElRef}
        className={`cesium-container ${sidebarCollapsed ? 'full-width' : ''}`}
        style={{ position: 'absolute', inset: 0, left: sidebarCollapsed ? 0 : 280, width: sidebarCollapsed ? '100%' : 'calc(100% - 280px)', height: '100%' }}
      />

      {/* Loading Overlay */}
      {loading && (
        <div className={`loading-overlay ${loadingProgress >= 100 ? 'fade' : ''}`}>
          <div className="loader-brand">Terranoetis</div>
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
                    value={apiVault.keys.GOOGLE_GEMINI_API_KEY || ''}
                    onChange={e => setApiVault(prev => ({ ...prev, keys: { ...prev.keys, GOOGLE_GEMINI_API_KEY: e.target.value } }))}
                  />
                </label>
                <label className="api-field">
                  <span>Anthropic API Key</span>
                  <input
                    type="password"
                    className="token-input"
                    placeholder="Paste your Anthropic API key"
                    value={apiVault.keys.ANTHROPIC_API_KEY || ''}
                    onChange={e => setApiVault(prev => ({ ...prev, keys: { ...prev.keys, ANTHROPIC_API_KEY: e.target.value } }))}
                  />
                </label>
                <label className="api-field">
                  <span>Cesium Ion Access Token</span>
                  <input
                    type="password"
                    className="token-input"
                    placeholder="Paste your Cesium ion access token"
                    value={apiVault.keys.CESIUM_ION_ACCESS_TOKEN || ''}
                    onChange={e => setApiVault(prev => ({ ...prev, keys: { ...prev.keys, CESIUM_ION_ACCESS_TOKEN: e.target.value } }))}
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
                    value={apiVault.keys.SENTINEL_HUB_CLIENT_ID || ''}
                    onChange={e => setApiVault(prev => ({ ...prev, keys: { ...prev.keys, SENTINEL_HUB_CLIENT_ID: e.target.value } }))}
                  />
                </label>
                <label className="api-field">
                  <span>Sentinel Hub Client Secret</span>
                  <input
                    type="password"
                    className="token-input"
                    placeholder="Optional"
                    value={apiVault.keys.SENTINEL_HUB_CLIENT_SECRET || ''}
                    onChange={e => setApiVault(prev => ({ ...prev, keys: { ...prev.keys, SENTINEL_HUB_CLIENT_SECRET: e.target.value } }))}
                  />
                </label>
                <label className="api-field">
                  <span>MarineTraffic API Key</span>
                  <input
                    type="password"
                    className="token-input"
                    placeholder="Optional"
                    value={apiVault.keys.MARINE_TRAFFIC_API_KEY || ''}
                    onChange={e => setApiVault(prev => ({ ...prev, keys: { ...prev.keys, MARINE_TRAFFIC_API_KEY: e.target.value } }))}
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
        initialKeys={apiVault.keys}
      />

      {/* Top Bar */}
      <div className="topbar glass-panel">
        <div className="brand">
          <div className="brand-dot" />
          <span>Terranoetis</span>
        </div>
        <div className="topbar-sep" />
        <div className="utc-clock">{utcTime}</div>
        <div className="topbar-sep" />
        <div className="search-box" ref={searchBoxRef} style={{ position: 'relative', flex: 1, maxWidth: 280 }}>
          <span className="search-icon"><SearchIcon size={14} /></span>
          <input type="text" placeholder="Search location..." value={searchValue}
            onChange={e => {
              handleSearch(e.target.value);
              const el = searchBoxRef.current;
              if (el) setSearchBoxRect(el.getBoundingClientRect());
            }}
            onKeyDown={e => {
              if (e.key !== 'Enter') return;
              const target = getBestSearchTarget(searchValue);
              if (target) goToLocation(target.lat, target.lon, target.name, '#60a5fa', 0.9);
            }}
            style={{ width: '100%' }} />
        </div>
        <div className="topbar-right">
          <div className="status-pill">
            <div className="status-dot" />
            <span>Live</span>
          </div>

          <button className={`btn-icon ${showIntelFeed ? 'active' : ''}`} onClick={() => { setShowIntelFeed(p => !p); focusPanel('intel-feed'); }} title="Intel Feed"><Activity size={16} /></button>
          <button className={`btn-icon ${showStudyArea ? 'active' : ''}`} onClick={() => { setShowStudyArea(p => !p); focusPanel('study-area'); }} title="Study Area"><Crosshair size={16} /></button>
          <button className={`btn-icon ${showAI ? 'active' : ''}`} onClick={() => { setShowAI(p => !p); focusPanel('ai'); }} title="AI Assistant"><Bot size={16} /></button>
          <button className="btn-icon" onClick={flyToIndiaDirect} title="Fly to India"><Navigation2 size={16} /></button>
          <button className={`btn-icon ${showShareDialog ? 'active' : ''}`} onClick={() => setShowShareDialog(true)} title="Share"><Share2 size={16} /></button>

          <div className="topbar-sep" />

          <TopbarMenu
            id="analysis" title="AI & Analysis" icon={<Brain size={16} />}
            menuId={openMenu} setMenuId={setOpenMenu}
            active={showCognitiveDashboard || showMultiHazardPanel || showMemoryExplorer || showAnalytics}
            items={[
              { label: 'Cognitive Dashboard', icon: <Brain size={15} />, active: showCognitiveDashboard, onClick: () => { setShowCognitiveDashboard(p => !p); focusPanel('cognitive'); } },
              { label: 'Multi-Hazard', icon: <Wrench size={15} />, active: showMultiHazardPanel, onClick: () => { setShowMultiHazardPanel(p => !p); focusPanel('multihazard'); } },
              { label: 'Memory Explorer', icon: <Save size={15} />, active: showMemoryExplorer, onClick: () => { setShowMemoryExplorer(p => !p); focusPanel('memory'); } },
              { label: 'Analytics & Insights', icon: <BarChart3 size={15} />, active: showAnalytics, onClick: () => { setShowAnalytics(p => !p); focusPanel('analytics-insights'); if (!analyticsData) fetch('/api/agent/analytics').then(r => r.json()).then(setAnalyticsData).catch(() => {}); } },
            ]}
          />

          <TopbarMenu
            id="scenarios" title="Scenarios" icon={<Flame size={16} />}
            menuId={openMenu} setMenuId={setOpenMenu}
            active={showScenarioGallery || showScenarioEditor || showCinematicDirector || showSpatialSketching}
            items={[
              { label: 'Scenarios', icon: <Flame size={15} />, active: showScenarioGallery, onClick: () => { setShowScenarioGallery(p => !p); focusPanel('scenario-gallery'); } },
              { label: 'New Scenario', icon: <Clapperboard size={15} />, active: showScenarioEditor, onClick: () => { setShowScenarioEditor(p => !p); focusPanel('scenario-editor'); } },
              { label: 'Cinematic Director', icon: <Film size={15} />, active: showCinematicDirector, onClick: () => { setShowCinematicDirector(p => !p); focusPanel('cinematic-director'); } },
              { label: 'Spatial Sketch', icon: <Pencil size={15} />, active: showSpatialSketching, onClick: () => { setShowSpatialSketching(p => !p); focusPanel('spatial-sketch'); } },
            ]}
          />

          <TopbarMenu
            id="view" title="View & Capture" icon={<Eye size={16} />}
            menuId={openMenu} setMenuId={setOpenMenu}
            active={isLayerEnabled('india_cctv') || showTimeline || isAutoRotating}
            items={[
              { label: 'Worldwide Public Cameras', icon: <Cctv size={15} />, active: isLayerEnabled('india_cctv'), onClick: () => toggleLayer('india_cctv') },
              { label: 'ISS Tracker', icon: <Satellite size={15} />, onClick: () => toggleISS() },
              { label: 'Timeline', icon: <Timer size={15} />, active: showTimeline, onClick: () => toggleTimeline() },
              { label: 'Auto Rotate', icon: <RefreshCw size={15} />, active: isAutoRotating, onClick: () => toggleAutoRotate() },
              { label: 'Snapshot', icon: <Camera size={15} />, onClick: () => takeSnapshot() },
            ]}
          />

          <TopbarMenu
            id="system" title="System" icon={<Cog size={16} />}
            menuId={openMenu} setMenuId={setOpenMenu}
            active={showSettings || showPerfMonitor}
            items={[
              { label: 'API Configuration', icon: <Key size={15} />, onClick: () => setShowApiVault(true) },
              { label: 'Settings', icon: <Cog size={15} />, active: showSettings, onClick: () => { setShowSettings(p => !p); focusPanel('settings'); } },
              { label: 'Performance Monitor', icon: <Activity size={15} />, active: showPerfMonitor, onClick: () => setShowPerfMonitor(p => !p) },
            ]}
          />
        </div>
      </div>

      {showSuggestions && searchSuggestions.length > 0 && searchBoxRect && (
        <div className="search-suggestions active" style={{
          position: 'fixed',
          top: searchBoxRect.bottom + 4,
          left: searchBoxRect.left,
          width: searchBoxRect.width,
        }}>
          {searchSuggestions.map((s) => (
            <div key={s.name + s.lat + s.lon} className="item" onClick={() => goToLocation(s.lat, s.lon, s.name, '#60a5fa', 0.9)}>{s.name}</div>
          ))}
        </div>
      )}

      {/* Sidebar */}
      <div className={`sidebar glass-panel ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-title">Data Layers ({activeLayerCount} active)</div>
          <div className="imagery-row">
            {['earth','satellite','photoreal','terrain'].map(type => {
              const isActive = type === 'photoreal' ? photoreal : (activeImagery === type && !photoreal);
              return (
                <button key={type} className={`img-chip ${isActive ? 'active' : ''}`}
                  onClick={() => setImagery(type)}>
                  {type === 'earth' ? <><Globe size={12} style={{display:'inline',marginRight:3}} /> Street</> : type === 'satellite' ? <><Satellite size={12} style={{display:'inline',marginRight:3}} /> Sat</> : type === 'photoreal' ? <><Globe size={12} style={{display:'inline',marginRight:3}} /> Photo</> : <><Mountain size={12} style={{display:'inline',marginRight:3}} /> Hybrid</>}
                </button>
              );
            })}
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
                  <ChevronRight size={10} className="cat-chevron" />
                </div>
                <div className="category-items">
                  {items.map(layer => (
                    <div key={layer.id} className={`layer-item ${layer.on ? 'active' : ''} ${pulsingLayer === layer.id ? 'pulsing' : ''}`}
                      onClick={() => toggleLayer(layer.id)}>
                      <div className="layer-dot" style={{background:layer.color,boxShadow:layer.on ? `0 0 8px ${layer.color}` : 'none'}} />
                      <div style={{flex:1}}>
                        <div className="layer-label">{layer.label.replace(/\sAPI$/i, '')}</div>
                        {layer.sub && <div className="layer-sub">{layer.sub}</div>}
                      </div>
                      <div className="layer-controls">
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
            <button className="btn-all" style={{background:showTimeSlider ? 'rgba(96,165,250,0.2)' : 'rgba(255,255,255,0.05)', fontSize:10}} onClick={() => setShowTimeSlider(p => !p)}><Clock size={12} style={{display:'inline',marginRight:3}} /> Time</button>
            <button className="btn-all" style={{background:showMeasureTool ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)', fontSize:10}} onClick={() => setShowMeasureTool(p => !p)}><Ruler size={12} style={{display:'inline',marginRight:3}} /> Measure</button>
            <button className="btn-all" style={{background: navMode==='route' ? 'rgba(34,211,238,0.25)' : 'rgba(255,255,255,0.05)', fontSize:10}} onClick={() => { const on = navMode!=='route'; setNavMode(on?'route':'none'); if(!on){clearNavEntities(); setRoutePoints([]); setRouteResult(null);} setShowMeasureTool(false); }}><Navigation2 size={12} style={{display:'inline',marginRight:3}} /> Route</button>
            <button className="btn-all" style={{background: navMode==='safest' ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.05)', fontSize:10}} onClick={() => { const on = navMode!=='safest'; setNavMode(on?'safest':'none'); if(!on){clearNavEntities(); setSafestHazard(null); setSafestResult(null);} setShowMeasureTool(false); }}><Shield size={12} style={{display:'inline',marginRight:3}} /> Safest</button>
            {isAdmin && <button className="btn-all" style={{background:'rgba(59,130,246,0.2)', fontSize:10}} onClick={() => setShowAdmin(true)}><Shield size={12} style={{display:'inline',marginRight:3}} /> Admin</button>}
          </div>
          <button className="btn-all" onClick={enableDefaultLayers}>Reset to Defaults</button>
        </div>
      </div>

      {/* Sidebar Toggle */}
      <div className={`sidebar-toggle ${sidebarCollapsed ? 'collapsed' : ''}`}
        style={{ left: sidebarCollapsed ? 0 : 280 }}
        onClick={() => setSidebarCollapsed(p => !p)}>
        {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </div>

      {/* Info Panel */}
      <div className={`info-panel glass-panel ${infoEntity ? '' : 'hidden'}`} style={{ zIndex: getPanelZIndex('info', 110) }}>
        {formatInfoPanel()}
      </div>

      {/* Study Area Panel */}
      {showStudyArea && <StudyAreaPanel
        viewer={viewerRef.current}
        zIndex={getPanelZIndex('study-area', 110)}
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
      />}

      {/* Analytics Panel */}
      {showAnalytics && (
        <div style={{ position: 'absolute', top: 60, right: 10, zIndex: getPanelZIndex('analytics-insights', 110), width: 340 }}>
          <Panel title="ANALYTICS & INSIGHTS" icon={<BarChart3 size={14} />} accentColor="#3b82f6" iconColor="#60a5fa" titleColor="#93c5fd" onClose={() => setShowAnalytics(false)} style={{ maxHeight: 'calc(100vh - 96px)' }}>
            <div style={{ flex: 1, overflowY: 'auto', fontSize: 11 }}>
              {!analyticsData ? (
                <div style={{textAlign:'center',padding:20,color:'#94a3b8',fontSize:11}}>Loading...</div>
              ) : (
                <div style={{ padding: 8 }}>
                  <div className="alert-item" style={{cursor:'default'}}>
                    <div className="alert-title"><DollarSign size={12} style={{display:'inline',marginRight:3}} /> Cost Summary</div>
                    <div style={{padding:'4px 0',display:'flex',justifyContent:'space-between'}}>
                      <span>Total spent:</span>
                      <span style={{color:'#60a5fa'}}>${(analyticsData as any).cost?.totalCost?.toFixed(6) || '0'}</span>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between'}}>
                      <span>Total queries:</span>
                      <span>{(analyticsData as any).cost?.totalQueries || 0}</span>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between'}}>
                      <span>Avg cost/query:</span>
                      <span style={{color:'#94a3b8'}}>${(analyticsData as any).cost?.avgCostPerQuery?.toFixed(8) || '0'}</span>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between'}}>
                      <span>Today cost:</span>
                      <span>${(analyticsData as any).cost?.todayCost?.toFixed(6) || '0'}</span>
                    </div>
                  </div>
                  <div className="alert-item" style={{cursor:'default'}}>
                    <div className="alert-title"><Target size={12} style={{display:'inline',marginRight:3}} /> Satisfaction</div>
                    <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0'}}>
                      <span>Rate:</span>
                      <span style={{color:(analyticsData as any).satisfactionRate >= 70 ? '#22c55e' : '#f59e0b'}}>{(analyticsData as any).satisfactionRate || 0}%</span>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between'}}>
                      <span><ThumbsUp size={10} style={{display:'inline',marginRight:2}} /> Upvotes:</span>
                      <span style={{color:'#22c55e'}}>{(analyticsData as any).totalUpvotes || 0}</span>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between'}}>
                      <span><ThumbsDown size={10} style={{display:'inline',marginRight:2}} /> Downvotes:</span>
                      <span style={{color:'#ef4444'}}>{(analyticsData as any).totalDownvotes || 0}</span>
                    </div>
                  </div>
                  <div className="alert-item" style={{cursor:'default'}}>
                    <div className="alert-title"><Database size={12} style={{display:'inline',marginRight:3}} /> Cache</div>
                    <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0'}}>
                      <span>Hit rate:</span>
                      <span style={{color:'#60a5fa'}}>{(analyticsData as any).cache?.hitRate || 0}%</span>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between'}}>
                      <span>Entries:</span>
                      <span>{(analyticsData as any).cache?.size || 0}</span>
                    </div>
                  </div>
                  {(analyticsData as any).cost?.byModel && (
                    <div className="alert-item" style={{cursor:'default'}}>
                      <div className="alert-title"><Bot size={12} style={{display:'inline',marginRight:3}} /> By Model</div>
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
                  }} style={{width:'100%',marginTop:4,display:'flex',alignItems:'center',gap:4,justifyContent:'center'}}><RefreshCw size={12} /> Refresh</button>
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}

      {/* AI Panel — extracted component */}
      <ChatPanel
        getPanelZIndex={getPanelZIndex}
        focusLocation={focusLocation}
        toggleLayer={toggleLayer}
        activeLayers={layers.filter(l => l.on).map(l => ({ id: l.id, label: l.label }))}
        sendAI={sendAI}
        handleFileUpload={handleFileUpload}
        handleImageUpload={handleImageUpload}
        handleDataFileUpload={handleDataFileUpload}
        toggleVoiceInput={toggleVoiceInput}
        voiceSupported={voiceSupported}
        buildSessionShareLink={buildSessionShareLink}
        showNotification={showNotification}
        newChat={newChat}
        undoLastAgentAction={undoLastAgentAction}
        clearAllAgentActions={clearAllAgentActions}
        deleteCurrentChat={deleteCurrentChat}
        cleanupThinkingSteps={cleanupThinkingSteps}
        abortControllerRef={abortControllerRef}
        virtualizedChatRef={virtualizedChatRef}
        speakResponse={speakResponse}
        stopSpeaking={stopSpeaking}
        executePlanFromCard={executePlanFromCard}
        togglePlanStep={togglePlanStep}
        rerunWithParam={rerunWithParam}
        resumeMessage={resumeMessage}
      />

      {/* Chat History Panel — extracted component */}
      <PanelSuspense><LazyChatHistoryPanel
        loadChat={loadChat}
        deleteChatSession={deleteChatSession}
        clearAllChats={clearAllChats}
        currentChatId={chatState.currentChatId}
      /></PanelSuspense>

      {/* Social Panel */}
      {showIntelFeed && (
        <div style={{ position: 'absolute', top: 60, right: 10, zIndex: getPanelZIndex('intel-feed', 110), width: 360 }}>
          <Panel title="INTEL FEED" icon={<Radio size={16} />} accentColor="#3b82f6" iconColor="#60a5fa" titleColor="#93c5fd" onClose={() => setShowIntelFeed(false)} style={{ maxHeight: 'calc(100vh - 160px)' }}>
        <div style={{padding:'8px 12px',borderBottom:'1px solid var(--border)',display:'flex',gap:6,flexWrap:'wrap'}}>
          {['all','news','fire','storm','earthquake','flood','weather','space_weather'].map(f => (
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
            <div key={item.id} className="social-post" onClick={() => focusLocation(item.lat, item.lon, { label: item.title, color: '#00D4FF', height: 20000 })}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <span className="social-user">{item.title}</span>
                <span className="social-time">{item.timeLabel}</span>
              </div>
              {item.desc && <div style={{fontSize:10,color:'var(--text-dim)',marginBottom:4,lineHeight:1.4}}>{item.desc}</div>}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div>
                  <div style={{fontSize:10,color:'var(--text-muted)'}}>
                    {item.platform === 'twitter' ? <MessageCircle size={10} style={{display:'inline',marginRight:3}} /> : item.platform === 'facebook' ? <Share2 size={10} style={{display:'inline',marginRight:3}} /> : item.platform === 'news' ? <Newspaper size={10} style={{display:'inline',marginRight:3}} /> : ''}
                    {item.source} · {item.type}
                  </div>
                  <div style={{fontSize:10,color:'var(--text-dim)',marginTop:4}}>
                    {item.lat !== 0 ? <><MapPin size={10} style={{display:'inline',marginRight:2}} /> {item.lat.toFixed(2)}, {item.lon.toFixed(2)}</> : <><Globe size={10} style={{display:'inline',marginRight:2}} /> Global</>}
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
      </Panel>
        </div>
      )}

      {/* Timeline */}
      <div className={`timeline-bar glass-panel ${showTimeline ? '' : 'collapsed'} ${sidebarCollapsed ? 'full-width' : ''}`}>
        <button className="tl-btn" onClick={startTimeline}><Play size={14} /></button>
        <button className="tl-btn" onClick={pauseTimeline}><Pause size={14} /></button>
        <button className="tl-btn" onClick={resetTimeline}><SkipBack size={14} /></button>
        <button className="tl-btn" onClick={stopTimeline}><Square size={14} /></button>
        <div className="tl-slider-wrap">
          <div className="tl-labels">
            <span>{new Date(timelineRef.current.start).toLocaleDateString('en-IN', { timeZone: getTimezone() })}</span>
            <span>{new Date(timelineRef.current.current).toLocaleString('en-IN', { timeZone: getTimezone(), dateStyle: 'medium', timeStyle: 'short' })} {timezoneLabel()}</span>
            <span>Now</span>
          </div>
          <input type="range" className="tl-slider" min="0" max="100" value={timelineValue}
            onChange={e => handleTimelineSlider(parseInt(e.target.value))} />
        </div>
        <span className="tl-speed">{timelineRef.current.speed}x</span>
      </div>

      {/* Stats Bar */}
      <div className={`statsbar glass-panel ${sidebarCollapsed ? 'full-width' : ''}`}>
        <div className="stat-item"><div className="stat-dot" style={{background:'#f59e0b'}}/><span className="stat-label">Layers</span><span className="stat-val">{activeLayerCount}/{LAYER_DEFS.length}</span></div>
        <div className="stat-item"><div className="stat-dot" style={{background:'#22c55e'}}/><span className="stat-label">Events</span><span className="stat-val">{activeEvents}</span></div>
        <div className="stat-item"><div className="stat-dot" style={{background:'#8b5cf6'}}/><span className="stat-label">Intel</span><span className="stat-val">{intelFeedRef.current.length}</span></div>
        <div className="stat-item"><div className="stat-dot" style={{background:'#FF8C00'}}/><span className="stat-label">Forks</span><span className="stat-val">{activeForkCount}</span></div>
        <div className="stat-item"><div className="stat-dot" style={{background:'#14b8a6'}}/><span className="stat-val">{cameraLat && cameraLon ? `${cameraLat}°${cameraLatDir} ${cameraLon}°${cameraLonDir}` : '—'}</span></div>

        <button
          className={`btn-icon monitor-btn ${!monitorCollapsed ? 'active' : ''}`}
          onClick={() => { setMonitorCollapsed(prev => !prev); focusPanel('monitor'); }}
          title="Monitor Panel"
        >
          <Monitor size={14} />
        </button>
        <button
          className={`btn-icon monitor-btn ${forkMode ? 'active' : ''}`}
          onClick={() => setForkMode(prev => !prev)}
          title="Fork Mode — right-click to create parallel realities"
          style={forkMode ? { borderColor: '#FF8C00', color: '#FF8C00' } : {}}
        >
          <span style={{ fontSize: 16 }}>⬡</span>
        </button>

        <TopbarMenu
          id="models" title="Models & Panels" icon={<Grid size={16} />}
          direction="up" triggerClassName="btn-icon monitor-btn"
          menuId={openMenu} setMenuId={setOpenMenu}
          active={showMarketIntelPanel || showSatelliteTracker || showAviationTracker || showLandCoverMapper}
          items={[
            { label: 'Pulse', icon: <Eye size={15} />, active: showMarketIntelPanel, onClick: () => { setShowMarketIntelPanel(p => !p); focusPanel('market-intel'); } },
    { label: 'Satellite Tracker', icon: <Satellite size={15} />, active: showSatelliteTracker, onClick: () => { setShowSatelliteTracker(p => !p); focusPanel('satellite-tracker'); } },
    { label: 'Satellite Imagery', icon: <Satellite size={15} />, active: showSatelliteImagery, onClick: () => { setShowSatelliteImagery(p => !p); focusPanel('satellite-imagery'); } },
    { label: 'Land Cover Mapper', icon: <Layers size={15} />, active: showLandCoverMapper, onClick: () => { setShowLandCoverMapper(p => !p); focusPanel('land-cover'); } },
    { label: 'Aviation Tracker', icon: <Plane size={15} />, active: showAviationTracker, onClick: () => { setShowAviationTracker(p => !p); focusPanel('aviation-tracker'); } },
          ]}
        />
        <button
          className={`btn-icon monitor-btn ${showAnalyticsWorkbench ? 'active' : ''}`}
          onClick={() => { setShowAnalyticsWorkbench(p => !p); focusPanel('analytics'); }}
          title="Analytics Workbench — 150 analytical models"
          style={{ color: showAnalyticsWorkbench ? '#a78bfa' : undefined }}
        >
          <FlaskConical size={14} />
        </button>
        <button
          className={`btn-icon monitor-btn ${showLaunchReplay ? 'active' : ''}`}
          onClick={() => { setShowLaunchReplay(p => !p); focusPanel('analytics'); }}
          title="Launch Replay — scrubbable rocket ascent reconstruction (Launch Library 2)"
          style={{ color: showLaunchReplay ? '#fb923c' : undefined }}
        >
          <Rocket size={14} />
        </button>
        <button
          className={`btn-icon monitor-btn ${showRadioTuner ? 'active' : ''}`}
          onClick={() => {
            setShowRadioTuner(p => !p);
            focusPanel('analytics');
            // Ensure the radio station markers are on the globe for the tuner.
            if (!isLayerEnabled('radio_stations')) toggleLayer('radio_stations');
          }}
          title="World Radio — analog tuner over 500 real geolocated stations"
          style={{ color: showRadioTuner ? '#22d3ee' : undefined }}
        >
          <Radio size={14} />
        </button>
        {/* DuckDB Spatial SQL — query live data layers with real SQL */}
        <button
          className={`btn-icon monitor-btn ${showDuckdbAnalytics ? 'active' : ''}`}
          onClick={() => { setShowDuckdbAnalytics(true); setDuckdbRestoreKey(k => k + 1); focusPanel('analytics'); }}
          title="DuckDB Spatial SQL — run SQL over live data layers (earthquakes, flights, satellites, radio, weather)"
          style={{ color: showDuckdbAnalytics ? '#34d399' : undefined }}
        >
          <Database size={14} />
        </button>
        </div>

      {/* Camera Controls — advanced zoom with smooth flyTo */}
      {!satTravel && !flightTravel && <CameraControls viewer={viewerRef.current} />}

      {/* Context Menu */}
      <div ref={contextMenuRef} className={`context-menu ${contextMenu.show ? 'active' : ''}`}
        style={{ left: contextMenu.x - 90, top: contextMenu.y - 90 }}>
        <div className="ctx-ring">
          <div className="ctx-center"><MapPin size={16} /></div>
          <div className="ctx-item" role="menuitem" tabIndex={0} style={{top:0,left:'50%',transform:'translateX(-50%)'}}
            onClick={() => handleContextAction('flyTo')} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleContextAction('flyTo'); } }}>
            <Crosshair size={14} className="ctx-emoji" /><span className="ctx-label">Fly To</span>
          </div>
          <div className="ctx-item" role="menuitem" tabIndex={0} style={{bottom:0,left:'50%',transform:'translateX(-50%)'}}
            onClick={() => handleContextAction('pin')} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleContextAction('pin'); } }}>
            <MapPin size={14} className="ctx-emoji" /><span className="ctx-label">Drop Pin</span>
          </div>
          <div className="ctx-item" role="menuitem" tabIndex={0} style={{left:0,top:'50%',transform:'translateY(-50%)'}}
            onClick={() => handleContextAction('weather')} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleContextAction('weather'); } }}>
            <Thermometer size={14} className="ctx-emoji" /><span className="ctx-label">Weather</span>
          </div>
          <div className="ctx-item" role="menuitem" tabIndex={0} style={{right:0,top:'50%',transform:'translateY(-50%)'}}
            onClick={() => handleContextAction('events')} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleContextAction('events'); } }}>
            <ClipboardList size={14} className="ctx-emoji" /><span className="ctx-label">Events</span>
          </div>
          <div className="ctx-item" role="menuitem" tabIndex={0} style={{left:'50%',top:0,transform:'translateX(-50%)'}}
            onClick={() => handleContextAction('ai_intel')} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleContextAction('ai_intel'); } }}>
            <Brain size={14} className="ctx-emoji" /><span className="ctx-label">AI Intel</span>
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
            <div className="token-title">Share Terranoetis</div>
            <div className="token-sub">Share this view or take a snapshot.</div>
            <div className="share-options">
              <button className="share-option" onClick={takeSnapshot}><Camera size={14} style={{ marginRight: 6 }} /> Snapshot</button>
              <button className="share-option" onClick={() => {
                const url = generateShareUrl();
                navigator.clipboard?.writeText(url);
                showNotification('Link copied!', 'success');
              }}><Link size={14} style={{display:'inline',marginRight:6}} /> Copy Link</button>
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

      {/* Fork (Parallel Reality) Creation Dialog */}
      {forkDialog.open && (
        <div className="fork-dialog" onClick={e => { if (e.target === e.currentTarget) setForkDialog(d => ({ ...d, open: false })); }}>
          <div className="fork-card">
            <div className="fork-header">
              <span className="fork-icon">⬡</span>
              <div>
                <div className="fork-title">Create Parallel Reality</div>
                <div className="fork-sub">Define a forked simulation branch with a buffer zone.</div>
              </div>
            </div>

            <div className="fork-field">
              <label className="fork-label">Reality Name</label>
              <input
                className="fork-input"
                value={forkDialog.name}
                autoFocus
                onChange={e => setForkDialog(d => ({ ...d, name: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') submitFork({ name: forkDialog.name, radiusM: forkDialog.radius, lat: forkDialog.lat, lon: forkDialog.lon }); }}
                placeholder="e.g. Atlantic Storm Surge Variant"
              />
            </div>

            <div className="fork-field">
              <label className="fork-label">Origin Coordinates</label>
              <div className="fork-coords">
                <span>{forkDialog.lat.toFixed(4)}°, {forkDialog.lon.toFixed(4)}°</span>
              </div>
            </div>

            <div className="fork-field">
              <div className="fork-label-row">
                <label className="fork-label">Buffer Radius</label>
                <div className="fork-unit-toggle">
                  <button className={forkDialog.unit === 'm' ? 'active' : ''} onClick={() => setForkDialog(d => ({ ...d, unit: 'm' }))}>m</button>
                  <button className={forkDialog.unit === 'km' ? 'active' : ''} onClick={() => setForkDialog(d => ({ ...d, unit: 'km' }))}>km</button>
                </div>
              </div>
              <div className="fork-radius-row">
                <input
                  className="fork-input fork-radius-input"
                  type="number"
                  min={0}
                  step={forkDialog.unit === 'm' ? 100 : 0.1}
                  value={forkDialog.unit === 'km' ? +(forkDialog.radius / 1000).toFixed(2) : Math.round(forkDialog.radius)}
                  onChange={e => {
                    const raw = parseFloat(e.target.value);
                    if (!Number.isFinite(raw) || raw < 0) return;
                    const meters = forkDialog.unit === 'km' ? raw * 1000 : raw;
                    // Allow 0 m up to 10,000 km.
                    setForkDialog(d => ({ ...d, radius: Math.min(meters, 10000000) }));
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') submitFork({ name: forkDialog.name, radiusM: forkDialog.radius, lat: forkDialog.lat, lon: forkDialog.lon }); }}
                />
                <input
                  className="fork-slider"
                  type="range"
                  min={0}
                  max={10000000}
                  step={1000}
                  value={forkDialog.radius}
                  onChange={e => setForkDialog(d => ({ ...d, radius: parseInt(e.target.value, 10) }))}
                />
              </div>
              <div className="fork-presets">
                {[
                  { label: '50 km', m: 50000 },
                  { label: '250 km', m: 250000 },
                  { label: '500 km', m: 500000 },
                  { label: '1,000 km', m: 1000000 },
                  { label: '2,500 km', m: 2500000 },
                ].map(p => (
                  <button
                    key={p.label}
                    className={`fork-preset ${forkDialog.radius === p.m ? 'active' : ''}`}
                    onClick={() => setForkDialog(d => ({ ...d, radius: p.m }))}
                  >{p.label}</button>
                ))}
              </div>
              <div className="fork-radius-hint">
                Coverage diameter ≈ {(forkDialog.radius * 2 / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} km · Dome height ≈ {(() => {
                  const h = Math.min(Math.max(forkDialog.radius * 0.25, 50000), 500000);
                  return (h / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 });
                })()} km · Range 0 m – 10,000 km
              </div>
            </div>

            <div className="fork-actions">
              <button className="btn-secondary" onClick={() => setForkDialog(d => ({ ...d, open: false }))}>Cancel</button>
              <button className="fork-create-btn" onClick={() => submitFork({ name: forkDialog.name, radiusM: forkDialog.radius, lat: forkDialog.lat, lon: forkDialog.lon })}>
                <Plus size={14} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> Create Reality
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ISS Live Camera — top-right panel */}
      {showISSInfo && issInfo && (
        <PanelSuspense><LazyIssLivePanel
          lat={issInfo.lat}
          lon={issInfo.lon}
          src={ISS_LIVE_EMBED}
          onClose={toggleISS}
          isTraveling={satTravel}
          onBoard={() => toggleIssTravel()}
        /></PanelSuspense>
      )}

      {satTravel && (
        <IssTravelView
          hud={satTravelHud}
          onLook={travelLook}
          onCapture={() => takeSnapshot()}
          onExit={() => { const v = viewerRef.current; if (v) exitSatelliteTravel(v); }}
          satName={satTravelNameRef.current}
        />
      )}

      {flightTravel && (
        <FlightTravelView
          hud={flightTravelHud}
          onLook={travelLookFlight}
          onCapture={() => takeSnapshot()}
          onExit={() => { const v = viewerRef.current; if (v) exitFlightTravel(v); }}
        />
      )}


      {/* Weather Cards */}
      {weatherCards.map(wc => (
        <div key={wc.id} ref={el => { weatherCardElementsRef.current[wc.id] = el; }} className="weather-card glass-panel"
          style={{ display: 'block', pointerEvents: 'auto', opacity: 0 }}
          onClick={() => focusLocation(wc.lat, wc.lon, { label: 'Weather location', color: '#22d3ee', height: 20000 })}>
          <div className="weather-card-header">
            <Thermometer size={16} className="weather-icon" />
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

      {/* Tool-result raster legend: matches the landslide-simulation legend style
          (bottom-left dark glass panel, vertical gradient with max/mid/min labels,
          zonal statistics, and color-scheme switcher). */}
      {toolSurfaceLegend && (
        <div style={{
          position: 'absolute', bottom: 80, left: 20, zIndex: 100,
          background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(10px)',
          borderRadius: 8, padding: '10px 13px', fontSize: 11, color: '#fff',
          border: '1px solid rgba(139,92,246,0.5)', maxWidth: 260,
        }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: '#c4b5fd', marginBottom: 4 }}>
            {toolSurfaceLegend.label}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 9, opacity: 0.8, minWidth: 34 }}>
              <span>{formatValue(toolSurfaceLegend.valueMax)}</span>
              <span>{formatValue((toolSurfaceLegend.valueMin + toolSurfaceLegend.valueMax) / 2)}</span>
              <span>{formatValue(toolSurfaceLegend.valueMin)}</span>
            </div>
            <div style={{
              width: 14, borderRadius: 3,
              background: legendGradientCSS(schemeToColorStops(toolSurfaceScheme)),
              border: '1px solid rgba(255,255,255,0.25)',
              minHeight: 54,
            }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <span style={{ fontSize: 9, opacity: 0.7, whiteSpace: 'nowrap' }}>Colors</span>
            <select
              value={toolSurfaceScheme}
              onChange={e => handleToolSurfaceSchemeChange(e.target.value)}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.08)', color: '#fff',
                border: '1px solid rgba(255,255,255,0.25)', borderRadius: 4,
                fontSize: 10, padding: '2px 4px',
              }}
            >
              <option value="default" style={{ background: '#1f2937', color: '#fff' }}>Default</option>
              {Object.entries(COLORMAPS).map(([key, cm]) => (
                <option key={key} value={key} style={{ background: '#1f2937', color: '#fff' }}>{cm.label}</option>
              ))}
            </select>
          </div>
          {/* Value probe toggle — hover value only runs when enabled (keeps
              zoom/pan fully smooth otherwise). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 9, opacity: 0.7, whiteSpace: 'nowrap' }}>Probe</span>
            <button
              onClick={() => { setToolSurfaceProbeEnabled(p => { const n = !p; if (!n) setToolSurfaceProbe(null); return n; }); }}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'rgba(255,255,255,0.08)', color: '#fff',
                border: `1px solid ${toolSurfaceProbeEnabled ? 'rgba(96,165,250,0.6)' : 'rgba(255,255,255,0.25)'}`,
                borderRadius: 4, fontSize: 10, padding: '2px 6px', cursor: 'pointer',
              }}
              title="Show the exact heatmap value under the cursor when hovering"
            >
              <span>{toolSurfaceProbeEnabled ? 'On' : 'Off'}</span>
              <span style={{ width: 20, height: 12, borderRadius: 6, background: toolSurfaceProbeEnabled ? '#3b82f6' : 'rgba(255,255,255,0.15)', position: 'relative', transition: 'background 0.15s' }}>
                <span style={{
                  position: 'absolute', top: 2, width: 8, height: 8, borderRadius: '50%', background: '#fff',
                  left: toolSurfaceProbeEnabled ? 10 : 2, transition: 'left 0.15s',
                }} />
              </span>
            </button>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', marginTop: 6, paddingTop: 5, fontSize: 10, opacity: 0.85 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px' }}>
              <span>Mean</span><span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: '#e2e8f0', fontWeight: 600 }}>{formatValue(toolSurfaceLegend.valueMean)}</span>
              <span>σ</span><span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: '#e2e8f0', fontWeight: 600 }}>{formatValue(toolSurfaceLegend.valueStd)}</span>
              <span>Med</span><span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: '#e2e8f0', fontWeight: 600 }}>{formatValue(toolSurfaceLegend.valueMedian)}</span>
              <span>Cells</span><span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: '#64748b' }}>{toolSurfaceLegend.finiteCellCount}</span>
            </div>
          </div>
        </div>
      )}

      {/* Raster value probe: exact heatmap cell value under the cursor */}
      {toolSurfaceProbe && (
        <div style={{
          position: 'absolute', left: toolSurfaceProbe.x + 14, top: toolSurfaceProbe.y + 14,
          zIndex: 90, pointerEvents: 'none',
          padding: '6px 10px', borderRadius: 6,
          background: 'rgba(0,0,0,0.78)', border: '1px solid rgba(255,255,255,0.15)',
          fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#e2e8f0',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          <div style={{ color: '#a78bfa', fontWeight: 600, marginBottom: 2 }}>
            {formatValue(toolSurfaceProbe.value)}{toolSurfaceLegend?.unit ? ` ${toolSurfaceLegend.unit}` : ''}
          </div>
          <div style={{ color: '#64748b', fontSize: 9 }}>
            {toolSurfaceProbe.lat.toFixed(4)}°, {toolSurfaceProbe.lon.toFixed(4)}°
          </div>
        </div>
      )}

      {/* Traffic hover readout — live TomTom speed/free-flow/confidence/travel-time */}
      {trafficHover && (
        <div style={{
          position: 'absolute', left: trafficHover.x + 14, top: trafficHover.y + 14,
          zIndex: 91, pointerEvents: 'none',
          padding: '8px 12px', borderRadius: 8,
          background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(249,115,22,0.35)',
          fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#e2e8f0',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)', minWidth: 180, lineHeight: 1.5,
        }}>
          {/* Header: status dot + label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            {(() => {
              const ratio = trafficHover.freeFlow > 0 ? trafficHover.speed / trafficHover.freeFlow : 0;
              const dotColor = ratio > 0.85 ? '#22c55e' : ratio > 0.6 ? '#eab308' : '#ef4444';
              return <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />;
            })()}
            <span style={{ color: '#fdba74', fontWeight: 700, fontSize: 11 }}>TRAFFIC</span>
            <span style={{ color: '#94a3b8', marginLeft: 'auto', fontSize: 11 }}>{trafficHover.speed} <span style={{ color: '#64748b', fontSize: 9 }}>km/h</span></span>
          </div>
          {/* Speed bar: visual comparison current vs free-flow */}
          <div style={{ marginBottom: 5 }}>
            <div style={{ background: 'rgba(148,163,184,0.15)', borderRadius: 3, height: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(100, (trafficHover.speed / Math.max(trafficHover.freeFlow, 1)) * 100)}%`,
                height: '100%', background: 'linear-gradient(90deg, #ef4444, #eab308, #22c55e)',
                borderRadius: 3, transition: 'width 0.15s',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#64748b', marginTop: 2 }}>
              <span>0</span>
              <span>Free flow {Number.isFinite(trafficHover.freeFlow) ? `${trafficHover.freeFlow} km/h` : '—'}</span>
            </div>
          </div>
          {/* Detail row: travel time, delay, length */}
          <div style={{ color: '#94a3b8', fontSize: 9, display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
            {trafficHover.travelTime != null && (
              <span>Travel <b style={{ color: '#e2e8f0' }}>{trafficHover.travelTime}s</b></span>
            )}
            {trafficHover.travelTime != null && trafficHover.freeFlowTravelTime != null && trafficHover.freeFlowTravelTime > 0 && (
              <span>Delay <b style={{ color: trafficHover.travelTime > trafficHover.freeFlowTravelTime * 1.2 ? '#f87171' : '#4ade80' }}>
                +{trafficHover.travelTime - trafficHover.freeFlowTravelTime}s
              </b></span>
            )}
            {trafficHover.length != null && (
              <span>Len <b style={{ color: '#e2e8f0' }}>{trafficHover.length.toFixed(1)} km</b></span>
            )}
            <span>Conf <b style={{ color: '#e2e8f0' }}>{Number.isFinite(trafficHover.confidence) ? `${(trafficHover.confidence * 100).toFixed(0)}%` : '—'}</b></span>
            {Number.isFinite(trafficHover.lat) && <span style={{ color: '#64748b' }}>{trafficHover.lat.toFixed(4)}, {trafficHover.lon.toFixed(4)}</span>}
          </div>
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

      {/* Population Impact Indicator */}
      {showPopulationImpact && (
        <div className="heatmap-legend show glass-panel" style={{ bottom: 460 }}>
          <div className="heatmap-legend-title">Population Impact Zones</div>
          <div className="pop-gradient" />
          <div className="heatmap-labels"><span>Low</span><span>High Density</span></div>
        
        </div>
      )}

      {/* CCTV Feed Legend */}
      {isLayerEnabled('india_cctv') && (
        <div className="legend-panel show glass-panel">
          <div className="heatmap-legend-title">Camera Feeds</div>
          <div className="legend-row"><span className="legend-color" style={{ background: '#22c55e' }} />Live video (HLS / MJPEG)</div>
          <div className="legend-row"><span className="legend-color" style={{ background: '#f59e0b' }} />Snapshot image</div>
          <div className="legend-row"><span className="legend-color" style={{ background: '#ec4899' }} />Embedded player (YouTube)</div>
          <div className="legend-row"><span className="legend-color" style={{ background: '#64748b' }} />Unknown feed type</div>
        </div>
      )}

      {/* Measure Tool Display */}
      {showMeasureTool && measurePoints.length > 0 && (
        <div className="glass-panel" style={{
          position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
          padding: '10px 20px', borderRadius: 10, zIndex: 110,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ color: '#f59e0b', fontWeight: 600 }}><Ruler size={12} style={{display:'inline',marginRight:4}} /> Measurement</span>
          {measureDistance !== null && (
            <span style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: 13 }}>
              {measureDistance >= 1000
                ? `${(measureDistance / 1000).toFixed(2)} km`
                : `${measureDistance.toFixed(0)} m`}
            </span>
          )}
          {measureArea !== null && measurePoints.length >= 3 && (
            <span style={{ color: '#22d3ee', fontFamily: 'monospace', fontSize: 13 }}>
              Area: {measureArea >= 1
                ? `${measureArea.toFixed(2)} km²`
                : `${(measureArea * 1e6).toFixed(2)} m²`}
            </span>
          )}
          {measureDistance === null && measurePoints.length === 1 && (
            <span style={{ color: '#94a3b8' }}>Click a second point on the globe</span>
          )}
          <button onClick={() => { setMeasurePoints([]); setMeasureDistance(null); setMeasureArea(null); }}
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '4px 10px' }}>
            Clear
          </button>
        </div>
      )}

      {/* Route Tool Display */}
      {navMode === 'route' && (routePoints.length > 0 || routeResult) && (
        <div className="glass-panel" style={{ position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)', padding: '10px 20px', borderRadius: 10, zIndex: 110, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: '#22d3ee', fontWeight: 600 }}><Navigation2 size={12} style={{ display: 'inline', marginRight: 4 }} /> Route</span>
          {routeResult && (
            <>
              <span style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: 13 }}>{(routeResult.distanceM / 1000).toFixed(2)} km</span>
              <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 13 }}>{Math.round(routeResult.durationS / 60)} min</span>
            </>
          )}
          {routePoints.length < 2 && <span style={{ color: '#94a3b8' }}>Click a second point on the globe</span>}
          <button onClick={() => { clearNavEntities(); setRoutePoints([]); routePointsRef.current = []; setRouteResult(null); }}
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '4px 10px' }}>Clear</button>
        </div>
      )}

      {/* Safest Location Display */}
      {navMode === 'safest' && safestResult && (
        <div className="glass-panel" style={{ position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)', padding: '12px 18px', borderRadius: 10, zIndex: 110, width: 340, maxWidth: 'calc(100vw - 24px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ color: '#22c55e', fontWeight: 600 }}><Shield size={12} style={{ display: 'inline', marginRight: 4 }} /> Safest Location</span>
            <button onClick={() => { clearNavEntities(); setSafestHazard(null); setSafestResult(null); }}
              style={{ marginLeft: 'auto', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 11, padding: '3px 9px' }}>Clear</button>
          </div>
          <div style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 8 }}>{safestResult.status}</div>
          {safestResult.best && safestResult.bestRoute && (
            <div style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12, marginBottom: 8 }}>
              {facilityLabel(safestResult.best)} · {(safestResult.bestRoute.distanceM / 1000).toFixed(1)} km · {Math.round(safestResult.bestRoute.durationS / 60)} min
            </div>
          )}
          {safestResult.facilities.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {safestResult.facilities.map((f, i) => (
                <div key={i} style={{ fontSize: 11, color: '#94a3b8' }}>{i === 0 ? '★ ' : ''}{facilityLabel(f)} — {(f.distM / 1000).toFixed(1)} km</div>
              ))}
            </div>
          )}
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
            style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {timeSliderPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <input type="range" min={Date.now() - 86400000} max={Date.now()} value={timeSliderValue}
            onChange={e => setTimeSliderValue(Number(e.target.value))}
            style={{ flex: 1, height: 4, accentColor: '#60a5fa' }} />
          <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 80, textAlign: 'right' }}>
            {formatISTTime(timeSliderValue)}
          </span>
          <button onClick={() => setShowTimeSlider(false)}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      )}

      {/* Cognitive Dashboard */}
      {showCognitiveDashboard && (
        <div style={{ position: 'absolute', top: 60, right: 10, zIndex: getPanelZIndex('cognitive', 110), width: 380, maxHeight: 'calc(100vh - 160px)' }}>
          <CognitiveDashboard onClose={() => setShowCognitiveDashboard(false)} />
        </div>
      )}

{/* Multi-Hazard Panel */}
      <div style={{ position: 'absolute', top: 60, right: 10, zIndex: getPanelZIndex('multihazard', 110), width: 480, maxHeight: 'calc(100vh - 160px)', overflowY: 'auto', display: showMultiHazardPanel ? 'block' : 'none' }}>
        <MultiHazardPanel onClose={() => setShowMultiHazardPanel(false)} bbox={activeBbox} studyAreaName={studyAreas.find(a => a.id === activeStudyAreaId)?.name} onSurfaceData={handleSurfaceData} onClear={() => { clearStudyArea(); clearInterpSurface(viewerRef.current!); }} />
      </div>

      {/* Memory Explorer */}
      {showMemoryExplorer && (
        <div style={{ position: 'absolute', top: 60, right: 10, zIndex: getPanelZIndex('memory', 110), width: 380, maxHeight: 'calc(100vh - 160px)' }}>
          <MemoryExplorer onClose={() => setShowMemoryExplorer(false)} />
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <div style={{ position: 'absolute', top: 60, right: 10, zIndex: getPanelZIndex('settings', 110), width: 360, maxHeight: 'calc(100vh - 160px)' }}>
          <SettingsPanel onClose={() => setShowSettings(false)} />
        </div>
      )}

      {/* Fork Panel */}
      <PanelSuspense><LazyForkPanel
        forks={forks}
        onPauseFork={handlePauseFork}
        onResumeFork={handleResumeFork}
        onTerminateFork={handleTerminateFork}
        zIndex={getPanelZIndex('fork', 110)}
      /></PanelSuspense>

      {/* Market Intel Panel */}
      <PanelSuspense><LazyMarketIntelPanel
        open={showMarketIntelPanel}
        onClose={() => setShowMarketIntelPanel(false)}
        onToggleLayer={toggleLayer}
        onFlyTo={focusLocation}
        zIndex={getPanelZIndex('market-intel')}
      /></PanelSuspense>

      {/* Satellite Tracker Panel */}
      {showSatelliteTracker && <PanelSuspense><LazySatelliteTrackerPanel zIndex={getPanelZIndex('satellite-tracker')} onClose={() => { setShowSatelliteTracker(false); if (trackedSatIntervalRef.current) { clearInterval(trackedSatIntervalRef.current); trackedSatIntervalRef.current = null; } if (trackedSatRenderTickRef.current) { trackedSatRenderTickRef.current(); trackedSatRenderTickRef.current = null; } if (trackedSatRef.current) { viewerRef.current?.entities.remove(trackedSatRef.current); trackedSatRef.current = null; } if (trackedSatTrailEntityRef.current) { viewerRef.current?.entities.remove(trackedSatTrailEntityRef.current); trackedSatTrailEntityRef.current = null; } trackedSatTleRef.current = null; trackedSatPosPropRef.current = null; trackedSatSpeedRef.current = 0; trackedSatNameRef.current = ''; }} onTrackSatellite={trackSatellite} onTravelView={travelToTrackedSatellite} /></PanelSuspense>}

      {/* Aviation Tracker Panel */}
      {showAviationTracker && <PanelSuspense><LazyAviationTrackerPanel zIndex={getPanelZIndex('aviation-tracker')} onClose={() => setShowAviationTracker(false)} onTravelView={travelToFlight} /></PanelSuspense>}

      {/* Satellite Imagery Panel */}
      <PanelSuspense><LazySatelliteImageryPanel viewer={viewerRef.current} show={showSatelliteImagery} onClose={() => setShowSatelliteImagery(false)} zIndex={getPanelZIndex('satellite-imagery')} /></PanelSuspense>

      {/* First-run mission card */}
      {showFirstRun && (
        <FirstRunCard
          onDismiss={() => setShowFirstRun(false)}
          onStage={(mission) => { stageFirstRunMission(mission); setShowFirstRun(false); }}
        />
      )}

      {/* Launch Replay Panel */}
      <PanelSuspense><LazyLaunchReplayPanel open={showLaunchReplay} onClose={() => setShowLaunchReplay(false)} viewer={viewerRef.current} zIndex={getPanelZIndex('analytics') + 1} /></PanelSuspense>

      {/* World Radio Tuner */}
      <PanelSuspense><LazyRadioTunerPanel open={showRadioTuner} onClose={() => setShowRadioTuner(false)} zIndex={getPanelZIndex('analytics') + 2}
        getStations={() => {
          const ents = entityStoreRef.current['radio_stations'] ?? [];
          return ents.map(e => {
            const props = e.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined ?? {};
            return {
              lat: Number(props.lat ?? 0), lon: Number(props.lon ?? 0),
              name: String(props.name ?? e.name ?? 'Unknown'),
              url: String(props.url ?? ''), tags: String(props.tags ?? ''),
              codec: String(props.codec ?? ''), bitrate: Number(props.bitrate ?? 0),
              stationuuid: String(props.stationuuid ?? ''), favicon: String(props.favicon ?? ''),
            };
          });
        }}
        flyTo={(lat, lon, alt) => {
          const v = viewerRef.current;
          if (v) v.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt ?? 30000), duration: 1.0 });
        }}
      /></PanelSuspense>

      {/* DuckDB Spatial SQL Analytics */}
      {showDuckdbAnalytics && <PanelSuspense><LazyDuckdbAnalyticsPanel open={showDuckdbAnalytics} onClose={() => setShowDuckdbAnalytics(false)} restoreKey={duckdbRestoreKey} zIndex={getPanelZIndex('analytics') + 3} /></PanelSuspense>}

      {/* Analytics Workbench Panel */}
      <ErrorBoundary label="Analytics Workbench">        <AnalyticsWorkbench open={showAnalyticsWorkbench} onClose={() => setShowAnalyticsWorkbench(false)} initialToolId={pendingAnalyticalToolId} onInitialToolConsumed={() => setPendingAnalyticalToolId(null)} bbox={activeBbox} polygon={activeStudyAreaPolygon ?? undefined} points={activeStudyPoints} studyAreaType={activeStudyAreaType} onToolResult={handleToolResult} onClearResult={handleClearToolResult} onToolModeChange={setAnalyticalNeedsTwoPoints} zIndex={getPanelZIndex('analytics')} schemeColors={schemeToColorStops(toolSurfaceScheme)} />
      </ErrorBoundary>

      {/* Land Cover Mapper Panel */}
      <PanelSuspense><LazyLandCoverMapperPanel
        open={showLandCoverMapper}
        onClose={() => setShowLandCoverMapper(false)}
        viewer={viewerRef.current}
        bbox={activeBbox}
        polygon={activeStudyAreaPolygon ?? undefined}
        onClearResult={handleClearToolResult}
        zIndex={getPanelZIndex('land-cover')}
      /></PanelSuspense>

      {/* Command Palette (CMD+K) */}
      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onToggleLayer={toggleLayer}
        onFlyTo={focusLocation}
        onOpenMarketIntelPanel={() => { setShowMarketIntelPanel(true); setShowCommandPalette(false); focusPanel('market-intel'); }}
      />

      <PerformanceMonitor viewer={viewerRef.current} visible={showPerfMonitor} onToggle={() => setShowPerfMonitor(p => !p)} />
      {/* Monitor Panel */}
      {!loading && !monitorCollapsed && (
        <div style={{ position: 'absolute', top: 60, right: 10, zIndex: getPanelZIndex('monitor', 110), width: 320 }}>
          <Panel title="MONITOR" icon={<span>⬡</span>} accentColor="#00ff88" iconColor="#00ff88" titleColor="#00ff88" onClose={() => setMonitorCollapsed(true)} style={{ fontFamily: 'monospace', fontSize: 11, maxHeight: 'calc(100vh - 96px)' }}>
            <div style={{ padding: 8, overflowY: 'auto', flex: 1 }}>
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
                  <div style={{ color: '#666', fontSize: 9, marginTop: 2 }}>{formatIST(lastDream.timestamp, { dateStyle: 'medium', timeStyle: 'short' })} IST</div>
                </div>
              ) : (
                <div style={{ color: '#666', fontSize: 10 }}>No dream cycle recorded</div>
              )}
            </div>
            </div>
          </Panel>
        </div>
      )}

      {/* Login Modal */}
      <LoginModal />

      {/* Scenario Gallery */}
      {showScenarioGallery && (
        <ScenarioGallery
          scenarios={scenarioGalleryScenarios}
          loading={scenarioGalleryLoading}
          error={scenarioGalleryError}
          onSelect={() => {
            setShowScenarioGallery(false);
          }}
          onCreateNew={() => { setShowScenarioGallery(false); setShowScenarioEditor(true); }}
          onClose={() => setShowScenarioGallery(false)}
          zIndex={getPanelZIndex('scenario-gallery')}
        />
      )}

      {/* Scenario Editor (lazy mounted) */}
      {showScenarioEditor && (
        <ScenarioEditor
          onClose={() => setShowScenarioEditor(false)}
          zIndex={getPanelZIndex('scenario-editor')}
          studyAreas={studyAreas}
          activeStudyAreaId={activeStudyAreaId}
          viewer={viewerRef.current}
          onKaggleComplete={(jobId, lat, lon, scenarioType) => {
            setShowScenarioEditor(false);
            setKaggleOverlay({ jobId, lat, lon, scenarioType });
          }}
          onKaggleStart={() => setKaggleOverlay(null)} // Clear old overlay when starting a new run
        />
      )}

      {/* Kaggle Flood Overlay on 3D Globe */}
      {kaggleOverlay && kaggleOverlay.scenarioType === 'flood_inundation' && (          <KaggleFloodOverlay
          key={kaggleOverlay.jobId}
          viewer={viewerRef.current}
          jobId={kaggleOverlay.jobId}
          lat={kaggleOverlay.lat}
          lon={kaggleOverlay.lon}
          // extent auto-derived from grid shape & cell size
          opacity={0.7}
          onDismiss={() => setKaggleOverlay(null)}
        />
      )}

      {/* Kaggle Landslide Overlay on 3D Globe */}
      {kaggleOverlay && kaggleOverlay.scenarioType === 'landslide' && (
        <KaggleLandslideOverlay
          key={kaggleOverlay.jobId}
          viewer={viewerRef.current}
          jobId={kaggleOverlay.jobId}
          lat={kaggleOverlay.lat}
          lon={kaggleOverlay.lon}
          // extent auto-derived from grid shape & cell size
          opacity={0.7}
          onDismiss={() => setKaggleOverlay(null)}
        />
      )}

      {/* Kaggle Earthquake Overlay on 3D Globe */}
      {kaggleOverlay && kaggleOverlay.scenarioType === 'earthquake_swarm' && (
        <KaggleEarthquakeOverlay
          key={kaggleOverlay.jobId}
          viewer={viewerRef.current}
          jobId={kaggleOverlay.jobId}
          lat={kaggleOverlay.lat}
          lon={kaggleOverlay.lon}
          // extent auto-derived from grid shape & cell size
          opacity={0.7}
          onDismiss={() => setKaggleOverlay(null)}
        />
      )}

      {/* Kaggle Hurricane Overlay on 3D Globe */}
      {kaggleOverlay && kaggleOverlay.scenarioType === 'hurricane_landfall' && (
        <KaggleHurricaneOverlay
          key={kaggleOverlay.jobId}
          viewer={viewerRef.current}
          jobId={kaggleOverlay.jobId}
          lat={kaggleOverlay.lat}
          lon={kaggleOverlay.lon}
          // extent auto-derived from grid shape & cell size
          opacity={0.7}
          onDismiss={() => setKaggleOverlay(null)}
        />
      )}

      {/* Kaggle Wildfire Overlay on 3D Globe */}
      {kaggleOverlay && kaggleOverlay.scenarioType === 'wildfire_spread' && (
        <KaggleWildfireOverlay
          key={kaggleOverlay.jobId}
          viewer={viewerRef.current}
          jobId={kaggleOverlay.jobId}
          lat={kaggleOverlay.lat}
          lon={kaggleOverlay.lon}
          // extent auto-derived from grid shape & cell size
          opacity={0.7}
          onDismiss={() => setKaggleOverlay(null)}
        />
      )}

      {/* Kaggle Volcano Overlay on 3D Globe */}
      {kaggleOverlay && kaggleOverlay.scenarioType === 'volcanic_eruption' && (
        <KaggleVolcanoOverlay
          key={kaggleOverlay.jobId}
          viewer={viewerRef.current}
          jobId={kaggleOverlay.jobId}
          lat={kaggleOverlay.lat}
          lon={kaggleOverlay.lon}
          // extent auto-derived from grid shape & cell size
          opacity={0.7}
          onDismiss={() => setKaggleOverlay(null)}
        />
      )}

      {/* Kaggle Tsunami Overlay on 3D Globe */}
      {kaggleOverlay && kaggleOverlay.scenarioType === 'tsunami_wave' && (
        <KaggleTsunamiOverlay
          key={kaggleOverlay.jobId}
          viewer={viewerRef.current}
          jobId={kaggleOverlay.jobId}
          lat={kaggleOverlay.lat}
          lon={kaggleOverlay.lon}
          // extent auto-derived from grid shape & cell size
          opacity={0.7}
          onDismiss={() => setKaggleOverlay(null)}
        />
      )}

      {/* Cinematic Director */}
      {showCinematicDirector && (
        <CinematicDirector
          viewer={viewerRef.current}
          onClose={() => { setShowCinematicDirector(false); setCinematicFocusEntity(null); }}
          layerVersion={cinematicLayerVersion}
          focusEntity={cinematicFocusEntity}
          zIndex={getPanelZIndex('cinematic-director')}
        />
      )}

      {/* Spatial Sketching */}
      {showSpatialSketching && (
        <SpatialSketching
          viewer={viewerRef.current}
          onClose={() => setShowSpatialSketching(false)}
          zIndex={getPanelZIndex('spatial-sketch')}
          onGenerateScenario={(type, params) => {
            setShowSpatialSketching(false);
            setAiMessages(prev => [...prev, {
              id: Date.now(),
              role: 'assistant',
              content: `Prepared a ${type.replace(/_/g, ' ')} scenario at your selected point.`,
              type: 'text',
            }]);
          }}
        />
      )}

      {/* Admin Dashboard */}
      {showAdmin && <AdminDashboard onClose={() => setShowAdmin(false)} />}

      {/* Sensor-style accessibility widget — floating, draggable, lockable */}
      {!loading && <SensorStyleWidget activeStyle={sensorStyle} onSelect={id => setSensorStyle(prev => sensorStylesRef.current?.toggle(id) ?? id)} />}
    </div>
  );
}
