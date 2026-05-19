import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

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
}

interface SocialPost {
  id: string; user: string; name: string; avatar: string;
  text: string; time: string; timeLabel: string; timestamp: number; source: string; lat: number; lon: number;
  likes: number; shares: number; type: string;
}

interface HeatmapPoint { lon: number; lat: number; count: number; }
interface WeatherCardData { id: string; lon: number; lat: number; temp: number; desc: string; }

interface CesiumWindow extends Window { Cesium?: typeof Cesium; }
declare const window: CesiumWindow;

type AiProvider = 'gemini' | 'anthropic' | 'local';

interface ApiVaultState {
  gemini: string;
  anthropic: string;
  openSkyClientId: string;
  openSkyClientSecret: string;
  sentinelHubClientId: string;
  sentinelHubClientSecret: string;
  marineTrafficApiKey: string;
  preferredAiProvider: AiProvider;
  vaultDismissed: boolean;
}

/* ═════════════════════════════════════════════════════════════════
   CONSTANTS
   ═════════════════════════════════════════════════════════════════ */

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
  { id:'heatmap', label:'Seismic Heatmap', color:'#ef4444', type:'heatmap', on:false, default:false, opacity:0.7, category:'seismic', badge:'FREE' },
  // Weather
  { id:'wildfires', label:'Wildfires (NASA)', color:'#f97316', type:'point', on:true, default:true, opacity:1, category:'weather', sub:'MODIS/VIIRS' },
  { id:'severe_storms', label:'Severe Storms', color:'#8b5cf6', type:'point', on:true, default:true, opacity:1, category:'weather', sub:'NASA EONET' },
  { id:'storm_forecast', label:'Storm Forecast Cone', color:'#a855f7', type:'polygon', on:true, default:true, opacity:1, category:'weather', sub:'Tropical cyclone track prediction' },
  { id:'smoke_dispersion', label:'Smoke Dispersion', color:'#6b7280', type:'effect', on:true, default:true, opacity:1, category:'weather', sub:'Wildfire smoke plume simulation' },
  { id:'tsunami', label:'Tsunami Propagation', color:'#3b82f6', type:'effect', on:true, default:true, opacity:1, category:'weather', sub:'Auto for M7.5+ ocean quakes' },
  { id:'temp_anomaly', label:'Temperature Anomaly', color:'#ef4444', type:'tile', on:false, default:false, opacity:0.6, category:'weather', badge:'FREE' },
  { id:'precipitation', label:'Precipitation', color:'#0ea5e9', type:'tile', on:false, default:false, opacity:0.6, category:'weather', badge:'FREE' },
  { id:'wind', label:'Wind Speed', color:'#8b5cf6', type:'tile', on:false, default:false, opacity:0.6, category:'weather', badge:'FREE' },
  { id:'pressure', label:'Pressure (MSLP)', color:'#f97316', type:'tile', on:false, default:false, opacity:0.5, category:'weather', badge:'FREE' },
  { id:'volcanoes', label:'Volcanoes', color:'#f59e0b', type:'point', on:false, default:false, opacity:1, category:'weather', badge:'FREE' },
  { id:'floods', label:'Flood Reports', color:'#3b82f6', type:'point', on:false, default:false, opacity:1, category:'weather', badge:'FREE' },
  { id:'dust', label:'Dust/Sandstorm', color:'#a16207', type:'point', on:false, default:false, opacity:1, category:'weather', badge:'FREE' },
  // Aviation
  { id:'flight_tracks', label:'Live Flight Tracks', color:'#a855f7', type:'point', on:false, default:false, opacity:1, category:'aviation', badge:'KEY', sub:'OpenSky client credentials in API Vault' },
  { id:'airports', label:'Major Airports', color:'#14b8a6', type:'point', on:false, default:false, opacity:1, category:'aviation', badge:'FREE' },
  { id:'airspaces', label:'Airspace Boundaries', color:'#f59e0b', type:'geojson', on:false, default:false, opacity:1, category:'aviation', badge:'KEY' },
  // Marine
  { id:'ais_vessels', label:'AIS Vessel Tracking', color:'#14b8a6', type:'point', on:false, default:false, opacity:1, category:'marine', badge:'KEY', sub:'MarineTraffic or similar' },
  { id:'sea_ice', label:'Sea Ice Concentration', color:'#93c5fd', type:'tile', on:false, default:false, opacity:0.7, category:'marine', badge:'FREE' },
  { id:'wave_height', label:'Wave Height', color:'#3b82f6', type:'tile', on:false, default:false, opacity:0.6, category:'marine', badge:'FREE' },
  { id:'ocean_currents', label:'Ocean Currents', color:'#14b8a6', type:'tile', on:false, default:false, opacity:0.5, category:'marine', badge:'FREE' },
  { id:'sea_temp', label:'Sea Surface Temp', color:'#f59e0b', type:'tile', on:false, default:false, opacity:0.5, category:'marine', badge:'FREE' },
  // Satellite
  { id:'sentinel_hub', label:'Sentinel-2 (ESA)', color:'#22c55e', type:'tile', on:false, default:false, opacity:1, category:'satellite', badge:'REG', sub:'Registration required' },
  { id:'nasa_gibs', label:'NASA GIBS Imagery', color:'#3b82f6', type:'tile', on:false, default:false, opacity:1, category:'satellite', badge:'FREE' },
  { id:'night_lights', label:'Nighttime Lights', color:'#fbbf24', type:'tile', on:false, default:false, opacity:1, category:'satellite', badge:'FREE' },
  { id:'land_cover', label:'Land Cover', color:'#22c55e', type:'tile', on:false, default:false, opacity:1, category:'satellite', badge:'FREE' },
  // Advanced
  { id:'disaster_alerts', label:'GDACS Disaster Alerts', color:'#ef4444', type:'point', on:false, default:false, opacity:1, category:'advanced', badge:'FREE', sub:'Global disaster alerts' },
  { id:'space_weather', label:'Space Weather (NOAA)', color:'#f97316', type:'point', on:false, default:false, opacity:1, category:'advanced', badge:'FREE', sub:'Solar storms, aurora' },
  { id:'disaster_near_me', label:'Disasters Near Me', color:'#ef4444', type:'point', on:false, default:false, opacity:1, category:'advanced', badge:'FREE', sub:'Requires location' },
  { id:'population_impact', label:'Population Impact Zones', color:'#f59e0b', type:'polygon', on:false, default:false, opacity:1, category:'advanced', badge:'FREE', sub:'50 cities overlay' },
  { id:'social_groundtruth', label:'Social Media Ground Truth', color:'#ec4899', type:'point', on:false, default:false, opacity:1, category:'advanced', badge:'PROXY', sub:'Simulated social feed' },
  { id:'ground_deformation', label:'Ground Deformation (InSAR)', color:'#a855f7', type:'tile', on:false, default:false, opacity:0.8, category:'advanced', badge:'KEY', sub:'Advanced geospatial' },
  { id:'flood_extent', label:'Flood Extent Mapping', color:'#3b82f6', type:'tile', on:false, default:false, opacity:0.6, category:'advanced', badge:'KEY' },
  { id:'burn_scars', label:'Burn Scar Mapping', color:'#7c2d12', type:'tile', on:false, default:false, opacity:0.7, category:'advanced', badge:'KEY' },
  { id:'aerosol_index', label:'Aerosol Index', color:'#6b7280', type:'tile', on:false, default:false, opacity:0.6, category:'advanced', badge:'FREE' },
  { id:'so2_index', label:'Sulfur Dioxide', color:'#eab308', type:'tile', on:false, default:false, opacity:0.6, category:'advanced', badge:'FREE' },
  { id:'co_index', label:'Carbon Monoxide', color:'#6b7280', type:'tile', on:false, default:false, opacity:0.6, category:'advanced', badge:'FREE' },
  { id:'dust_score', label:'Dust Score', color:'#a16207', type:'tile', on:false, default:false, opacity:0.6, category:'advanced', badge:'FREE' },
];

const API_VAULT_STORAGE_KEY = 'liveglobe.apiVault.v1';

const DEFAULT_API_VAULT: ApiVaultState = {
  gemini: '',
  anthropic: '',
  openSkyClientId: '',
  openSkyClientSecret: '',
  sentinelHubClientId: '',
  sentinelHubClientSecret: '',
  marineTrafficApiKey: '',
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
        cachedRadius = Math.max(0, baseRadius());
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

function generateSocialPosts(): SocialPost[] {
  const posts: SocialPost[] = [];
  const templates = [
    { type:'fire', text:'Large fire visible from my window! Smoke covering the whole area. Stay safe everyone!', source:'Twitter', hashtags:['#fire','#emergency'] },
    { type:'fire', text:'Fire department just arrived. Flames are huge - can see them from 2 miles away.', source:'Twitter', hashtags:['#wildfire','#breaking'] },
    { type:'fire', text:'Evacuation order issued for our neighborhood. Packing up now. This is scary.', source:'Facebook', hashtags:['#evacuation'] },
    { type:'storm', text:'Storm is getting really intense. Wind picking up fast. Power just went out!', source:'Twitter', hashtags:['#storm','#hurricane'] },
    { type:'storm', text:'Just saw a transformer explode. Sparks everywhere. Stay indoors!', source:'Twitter', hashtags:['#weather'] },
    { type:'storm', text:'Flooding on Main Street already. Cars are getting stranded. Avoid the area!', source:'Facebook', hashtags:['#flood'] },
    { type:'earthquake', text:'Did anyone else feel that? Whole building shook for like 10 seconds!', source:'Twitter', hashtags:['#earthquake'] },
    { type:'earthquake', text:'Pictures fell off the walls. My dog started barking 30 seconds before it hit. Animals know!', source:'Facebook', hashtags:['#quake'] },
    { type:'earthquake', text:'Aftershock just now - smaller but still scary. Everyone okay in the neighborhood?', source:'Twitter', hashtags:['#aftershock'] },
    { type:'flood', text:'Water level rising fast. Already at my doorstep. Calling emergency services.', source:'Twitter', hashtags:['#flooding'] },
    { type:'flood', text:'Bridge is underwater. Can\'t get to the other side of town. Photos attached.', source:'Facebook', hashtags:['#flood'] },
    { type:'volcano', text:'Ash falling on our town. Sky is gray. Everyone wearing masks outside.', source:'Twitter', hashtags:['#volcano'] },
    { type:'landslide', text:'Road completely blocked by mudslide. Heard rumbling sound before it came down.', source:'Twitter', hashtags:['#landslide'] },
    { type:'default', text:'Emergency services are doing an amazing job. Saw 5 fire trucks pass by in 10 minutes.', source:'Twitter', hashtags:['#grateful'] },
    { type:'default', text:'Shelter set up at the community center. They have food, water, and charging stations.', source:'Facebook', hashtags:['#community'] },
  ];
  const users = ['Sarah M.','John K.','Maria G.','David L.','Emma R.','Carlos V.','Yuki T.','Alex P.','Lisa H.','Tom W.'];
  for (let i = 0; i < templates.length; i++) {
    const t = templates[i];
    const lat = (Math.random() - 0.5) * 60;
    const lon = (Math.random() - 0.5) * 160;
    const hoursAgo = Math.floor(Math.random() * 12) + 1;
    const likes = Math.floor(Math.random() * 200) + 10;
    const shares = Math.floor(Math.random() * 50) + 1;
    const timestamp = Date.now() - hoursAgo * 3600000;
    posts.push({
      id:`sp${i}`, user:`user_${1000+i}`, name:users[i%users.length], avatar:'👤',
      text:`${t.text} ${t.hashtags.join(' ')}`,
      time:new Date(timestamp).toISOString(), timeLabel:`${hoursAgo}h ago`, timestamp, source:t.source, lat, lon, likes, shares, type:t.type,
    });
  }
  return posts;
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

function generateMockSpaceWeather() {
  const storms = [
    { name:'CME Impact', kpIndex:7, scale:3, lat:70, lon:-95 },
    { name:'Solar Flare X1.2', kpIndex:6, scale:2, lat:65, lon:25 },
    { name:'Geomagnetic Storm', kpIndex:8, scale:4, lat:60, lon:-130 },
    { name:'High Speed Stream', kpIndex:5, scale:1, lat:55, lon:10 },
    { name:'CME Glancing Blow', kpIndex:6, scale:2, lat:75, lon:-45 },
  ];
  const baseTime = Date.now();
  return storms.map((s, i) => ({
    ...s,
    description: `KP ${s.kpIndex} geomagnetic activity detected. Aurora visibility expected at ${60 - s.kpIndex * 3}° latitude.`,
    time: baseTime - i * 1800000,
  }));
}

function generateMockDisasterAlerts(): EventAlert[] {
  const now = Date.now();
  return [
    { id:'d1', title:'GDACS Orange Alert', desc:'Flood warning in Southeast Asia', severity:'orange', type:'flood', lat:13.7563, lon:100.5018, seen:false, timestamp:now, time:new Date(now).toISOString() },
    { id:'d2', title:'GDACS Red Alert', desc:'Earthquake M7.2 - Pacific Ring of Fire', severity:'red', type:'earthquake', lat:-15, lon:-175, seen:false, timestamp:now - 3600000, time:new Date(now - 3600000).toISOString() },
    { id:'d3', title:'GDACS Green Alert', desc:'Drought conditions in East Africa', severity:'green', type:'drought', lat:1.2921, lon:36.8219, seen:false, timestamp:now - 7200000, time:new Date(now - 7200000).toISOString() },
  ];
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
  const issTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rotateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const geocodeCacheRef = useRef<Record<string, Array<{name:string;lat:number;lon:number}>>>({});
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineLastUpdateRef = useRef<number>(0);
  const entityStoreRef = useRef<Record<string, Cesium.Entity[]>>({});
  const dataStoreRef = useRef<Record<string, unknown[]>>({});
  const magnitudeScaleRef = useRef(1);
  const autoRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const issEntityRef = useRef<Cesium.Entity | null>(null);
  const issTrailRef = useRef<Cesium.SampledPositionProperty | null>(null);
  const issTimesRef = useRef<Cesium.JulianDate[]>([]);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const alertsRef = useRef<EventAlert[]>([]);
  const notificationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const populationImpactLayerRef = useRef<Cesium.Entity[]>([]);
  const socialPostsRef = useRef<SocialPost[]>([]);
  const weatherCardElementsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const focusMarkerRef = useRef<Cesium.Entity | null>(null);
  const socialEntityRef = useRef<Record<string, Cesium.Entity>>({});
  const alertEntityRef = useRef<Record<string, Cesium.Entity>>({});
  const stormOverlaysRef = useRef<Cesium.Entity[]>([]);
  const smokeParticlesRef = useRef<Cesium.Entity[]>([]);
  const tsunamiWavesRef = useRef<Cesium.Entity[]>([]);
  const tectonicEntitiesRef = useRef<Cesium.Entity[]>([]);
  const openSkyTokenRef = useRef<{ token: string; expiresAt: number } | null>(null);

  /* ── State ── */
  const initialApiVault = useMemo(() => loadApiVault(), []);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Initializing Cesium...');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openCategories, setOpenCategories] = useState<string[]>(['seismic']);
  const [layers, setLayers] = useState<LayerItem[]>(LAYER_DEFS.map(l => ({ ...l })));
  const layersRef = useRef<LayerItem[]>(LAYER_DEFS.map(l => ({ ...l })));
  const [layerOpacity, setLayerOpacity] = useState<Record<string, number>>({});
  const [activeImagery, setActiveImagery] = useState('earth');
  const [infoEntity, setInfoEntity] = useState<Cesium.Entity | null>(null);
  const [showHeatmapLegend, setShowHeatmapLegend] = useState(false);
  const [showStormLegend, setShowStormLegend] = useState(false);
  const [showSmokeLegend, setShowSmokeLegend] = useState(false);
  const [showTsunamiLegend, setShowTsunamiLegend] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [apiVault, setApiVault] = useState<ApiVaultState>(initialApiVault);
  const [showTokenSetup, setShowTokenSetup] = useState(() => !hasAnyApiVaultValue(initialApiVault) && !initialApiVault.vaultDismissed);
  const [showAI, setShowAI] = useState(false);
  const [showAlertsPanel, setShowAlertsPanel] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
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
  const [aiMessages, setAiMessages] = useState<Array<{role:string;content:string}>>([
    { role:'assistant', content:'👋 Hello! I\'m your Earth Intelligence assistant. Ask me about earthquakes, weather, disasters, or any location on Earth. Try: "Show recent earthquakes" or "What\'s the weather in Tokyo?"' },
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
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([]);
  const [socialFilter, setSocialFilter] = useState('all');
  const [socialPulse, setSocialPulse] = useState(false);
  const [showPopulationImpact, setShowPopulationImpact] = useState(false);
  const [pulsingLayer, setPulsingLayer] = useState<string | null>(null);
  const lastKnownLocationRef = useRef<{ lat: number; lon: number } | null>(null);
  const disasterNearMeRequestedRef = useRef(false);
  const apiVaultRef = useRef<ApiVaultState>(initialApiVault);

  const aiApiType = useMemo(() => resolveAiProvider(apiVault), [apiVault]);

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

  /* ── UTC Clock ── */
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setUtcTime(now.toISOString().replace('T',' ').substring(0,19) + ' UTC');
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

    setLoadingProgress(10);
    setLoadingStatus('Loading Cesium engine...');

    const v = new Cesium.Viewer(cesiumElRef.current, {
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      vrButton: false,
      infoBox: true,
      creditContainer: document.createElement('div'),
    });
    viewerRef.current = v;
    v.scene.globe.enableLighting = true;
    v.scene.globe.depthTestAgainstTerrain = true;
    v.scene.highDynamicRange = true;
    v.scene.postProcessStages.fxaa.enabled = true;
    v.scene.globe.atmosphereLightIntensity = 20.0;
    v.scene.globe.lightingFadeOutDistance = 10000000;
    v.scene.globe.lightingFadeInDistance = 5000000;

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

    // Initial position
    v.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(20, 0, 20000000), duration: 2 });

    setLoadingProgress(30);
    setLoadingStatus('Loading data layers...');

    // Click handler
    const handler = new Cesium.ScreenSpaceEventHandler(v.canvas);
    screenSpaceHandlerRef.current = handler;
    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = v.scene.pick(click.position);
      if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
        showInfoPanel(picked.id);
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

    // Load default layers
    loadAllData(v);
    syncWeatherCardPositions();

    setLoadingProgress(100);
    setLoadingStatus('Ready');

    // Hide loading
    setTimeout(() => setLoading(false), 800);

    // Auto-dismiss context on other clicks
    const handleDocClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(cm => ({ ...cm, show: false }));
      }
    };
    document.addEventListener('click', handleDocClick);

    return () => {
      document.removeEventListener('click', handleDocClick);
      v.scene.postRender.removeEventListener(syncWeatherCardPositions);
      cleanupCesium();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isContextMenuOpenRef = useRef(false);
  useEffect(() => { isContextMenuOpenRef.current = contextMenu.show; }, [contextMenu.show]);

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

  function loadMockFlightTracks(viewer: Cesium.Viewer) {
    const flights = [
      { callsign: 'GLB101', lat: 40.6413, lon: -73.7781, alt: 11200, heading: 84, origin: 'KJFK' },
      { callsign: 'GLB118', lat: 51.4700, lon: -0.4543, alt: 10800, heading: 97, origin: 'EGLL' },
      { callsign: 'GLB233', lat: 35.5494, lon: 139.7798, alt: 11400, heading: 272, origin: 'RJTT' },
      { callsign: 'GLB309', lat: 25.2532, lon: 55.3657, alt: 11900, heading: 310, origin: 'OMDB' },
      { callsign: 'GLB412', lat: 33.9416, lon: -118.4085, alt: 11600, heading: 110, origin: 'KLAX' },
      { callsign: 'GLB527', lat: 1.3644, lon: 103.9915, alt: 11800, heading: 225, origin: 'WSSS' },
      { callsign: 'GLB640', lat: 48.3538, lon: 11.7861, alt: 10600, heading: 74, origin: 'EDDM' },
      { callsign: 'GLB774', lat: 28.5562, lon: 77.1000, alt: 11100, heading: 135, origin: 'VIDP' },
      { callsign: 'GLB881', lat: -33.9399, lon: 151.1753, alt: 10900, heading: 42, origin: 'YSSY' },
      { callsign: 'GLB905', lat: 41.9742, lon: -87.9073, alt: 11700, heading: 122, origin: 'KORD' },
    ];

    const ents = flights.map((flight, index) => viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(flight.lon, flight.lat, flight.alt),
      name: flight.callsign,
      billboard: { image: createPlaneIcon(flight.heading), width: 20, height: 20 },
      label: {
        text: flight.callsign,
        font: '10px "JetBrains Mono"',
        fillColor: Cesium.Color.WHITE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        show: index % 2 === 0,
      },
      properties: {
        layer: 'flight_tracks',
        callsign: flight.callsign,
        altitude: flight.alt,
        origin: flight.origin,
        lon: flight.lon,
        lat: flight.lat,
        time: Date.now(),
      },
    }));

    entityStoreRef.current['flight_tracks'] = ents;
  }

  async function loadFlightTracks(viewer: Cesium.Viewer) {
    if (!isLayerEnabled('flight_tracks')) return;
    removeLayerEntities('flight_tracks');
    entityStoreRef.current['flight_tracks'] = [];

    try {
      const headers = await getOpenSkyAuthHeaders();
      const resp = await fetch('https://opensky-network.org/api/states/all', headers ? { headers } : undefined);
      if (!resp.ok) {
        throw new Error(`OpenSky request failed (${resp.status})`);
      }

      const data = await resp.json() as { states?: unknown[][] | null };
      if (!data.states?.length) {
        throw new Error('OpenSky returned no states');
      }

      const ents = data.states.slice(0, 200).map(state => {
        const lon = Number(state[5]);
        const lat = Number(state[6]);
        const alt = Number(state[7] ?? 0);
        const callsign = String(state[1] ?? 'Unknown').trim() || 'Unknown';
        const heading = Number(state[10] ?? 0);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
          name: callsign,
          billboard: { image: createPlaneIcon(heading), width: 20, height: 20 },
          label: {
            text: callsign,
            font: '10px "JetBrains Mono"',
            fillColor: Cesium.Color.WHITE,
            pixelOffset: new Cesium.Cartesian2(0, -14),
            show: false,
          },
          properties: {
            layer: 'flight_tracks',
            callsign,
            altitude: alt,
            origin: String(state[2] ?? ''),
            lon,
            lat,
            time: Date.now(),
          },
        });
      }).filter(Boolean) as Cesium.Entity[];

      if (ents.length === 0) {
        throw new Error('OpenSky produced no drawable tracks');
      }

      if (!isLayerEnabled('flight_tracks')) return;
      entityStoreRef.current['flight_tracks'] = ents;
      showNotification(`Loaded ${ents.length} live flight tracks`, 'success');
    } catch (error) {
      if (!isLayerEnabled('flight_tracks')) return;
      console.warn('OpenSky flight tracks unavailable, using simulation.', error);
      loadMockFlightTracks(viewer);
      showNotification('Live flight data unavailable. Showing simulated flight tracks.', 'warning');
    }
  }

  const loadAllData = useCallback((viewer: Cesium.Viewer) => {
    // Earthquakes
    fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson', { cache: 'no-store' })
      .then(r => r.json())
      .then((geo: {features: Array<Record<string, unknown>>}) => {
        const ents = geo.features.map(f => {
          const c = (f.geometry as {coordinates:number[]}).coordinates;
          const p = f.properties as Record<string, unknown>;
          const m = (p.mag as number) || 0;
          const size = Math.max(6, Math.min(48, m * 6));
          const ent = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(c[0], c[1]),
            name: p.place as string,
            ellipse: {
              semiMinorAxis: size * 1000, semiMajorAxis: size * 1000,
              material: Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.4 + m/12),
              outline: true, outlineColor: Cesium.Color.fromCssColorString('#ef4444'), outlineWidth: 1,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            label: {
              text: `M${m.toFixed(1)}`, font: 'bold 12px "JetBrains Mono"',
              fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
              pixelOffset: new Cesium.Cartesian2(0, -size/2 - 8), show: m >= 5.5,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            properties: { ...p, layer: 'earthquakes', magnitude: m, lon: c[0], lat: c[1] },
          });
          // Check for M5+ alerts
          if (m >= 5 && p.time) {
            checkMagnitudeAlert(m, p.place as string, p.time as number, c[1], c[0]);
          }
          return ent;
        });
        entityStoreRef.current['earthquakes'] = ents;
        updateCounts();
      })
      .catch(() => loadMockEarthquakes(viewer));

    // Natural events
    fetch('https://eonet.gsfc.nasa.gov/api/v3/events?days=30&status=open')
      .then(r => r.json())
      .then((data: {events: Array<Record<string, unknown>>}) => {
        const evs = data.events || [];
        setActiveEvents(evs.length);
        for (const ev of evs) {
          const geo = ev.geometry as Array<{coordinates:number[];date:string}> | undefined;
          if (!geo?.length) continue;
          const c = geo[0].coordinates;
          const cats = ev.categories as Array<{id:string;title:string}>;
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
        }
        updateCounts();
        refreshDerivedOverlays();
      })
      .catch(() => loadMockEvents(viewer));

    // Tectonic plates
    fetch('https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json')
      .then(r => r.json())
      .then((geo: Record<string, unknown>) => {
        const src = new Cesium.GeoJsonDataSource('Tectonic');
        src.load(geo).then(() => {
          for (const ent of src.entities.values) {
            if (ent.polyline) {
              ent.polyline.material = new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#f97316').withAlpha(0.6));
              (ent.polyline.width as unknown as Cesium.ConstantProperty) = new Cesium.ConstantProperty(2);
            }
          }
          tectonicEntitiesRef.current = src.entities.values as unknown as Cesium.Entity[];
          viewer.dataSources.add(src);
        });
      })
      .catch(() => loadMockTectonic(viewer));

    // Aviation
    void loadFlightTracks(viewer);

    // Volcanoes - use mock data directly
    const volcanoEnts = generateMockVolcanoes().map(v => viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(v.lon, v.lat),
      name: v.name,
      billboard: { image: createPulsingDotCanvas('#f59e0b', 14), width: 14, height: 14,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
      properties: { layer: 'volcanoes', ...v },
    }));
    entityStoreRef.current['volcanoes'] = volcanoEnts;

    // Airports
    fetch('https://raw.githubusercontent.com/mwgg/Airports/master/airports.json')
      .then(r => r.json())
      .then((data: Record<string, Record<string, unknown>>) => {
        const apList = Object.values(data).filter((a: Record<string, unknown>) => a.Size && (a.Size as number) >= 3);
        const ents = apList.slice(0, 300).map(a => viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(a.lon as number, a.lat as number),
          name: a.name as string,
          billboard: { image: createAirportIcon(), width: 12, height: 12,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
          label: { text: a.iata as string || a.icao as string, font: '9px "JetBrains Mono"', fillColor: Cesium.Color.fromCssColorString('#14b8a6'),
            pixelOffset: new Cesium.Cartesian2(0, -8), show: (a.Size as number) >= 5 },
          properties: { layer:'airports', ...a },
        }));
        entityStoreRef.current['airports'] = ents;
        updateCounts();
      })
      .catch(() => {
        const mockAirports = [
          { name:'Heathrow', iata:'LHR', icao:'EGLL', lat:51.47,lon:-0.46,size:5 },
          { name:'JFK', iata:'JFK', icao:'KJFK', lat:40.64,lon:-73.78,size:5 },
          { name:'Haneda', iata:'HND', icao:'RJTT', lat:35.55,lon:139.78,size:5 },
          { name:'Charles de Gaulle', iata:'CDG', icao:'LFPG', lat:49.01,lon:2.55,size:5 },
          { name:'Dubai Intl', iata:'DXB', icao:'OMDB', lat:25.25,lon:55.36,size:5 },
          { name:'LAX', iata:'LAX', icao:'KLAX', lat:33.94,lon:-118.41,size:5 },
          { name:'Changi', iata:'SIN', icao:'WSSS', lat:1.36,lon:103.99,size:5 },
          { name:'Frankfurt', iata:'FRA', icao:'EDDF', lat:50.04,lon:8.57,size:5 },
          { name:'Amsterdam', iata:'AMS', icao:'EHAM', lat:52.31,lon:4.77,size:5 },
          { name:'Madrid', iata:'MAD', icao:'LEMD', lat:40.47,lon:-3.57,size:5 },
        ];
        const ents = mockAirports.map(a => viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat),
          name: a.name,
          billboard: { image: createAirportIcon(), width: 12, height: 12,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
          label: { text: a.iata, font: '9px "JetBrains Mono"', fillColor: Cesium.Color.fromCssColorString('#14b8a6'),
            pixelOffset: new Cesium.Cartesian2(0, -8), show: a.size >= 5 },
          properties: { layer:'airports', ...a },
        }));
        entityStoreRef.current['airports'] = ents;
        updateCounts();
      });

    // Initial disaster alerts
    const initialAlerts = generateMockDisasterAlerts();
    alertsRef.current = initialAlerts;
    setAlerts(initialAlerts);
    setNewAlertCount(initialAlerts.length);
    initialAlerts.forEach(registerAlertEntity);

    // Space weather
    const mockSpace = generateMockSpaceWeather();
    const spaceEnts = mockSpace.map(s => viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
      name: s.name,
      billboard: { image: createPulsingDotCanvas('#f97316', 18), width: 18, height: 18,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
      properties: { layer:'space_weather', ...s },
    }));
    entityStoreRef.current['space_weather'] = spaceEnts;
    updateCounts();

    // Social posts
    const sp = generateSocialPosts();
    socialPostsRef.current = sp;
    setSocialPosts(sp);
    sp.forEach(registerSocialEntity);

    updateCounts();
    setLoadingProgress(70);
  }, []);

  function updateCounts() {
    const v = viewerRef.current;
    if (!v) return;
    const ignoreLayers = new Set([
      'focus',
      'weather_cards',
      'pin',
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
  }

  function getEventColor(cat: string): string {
    const map: Record<string, string> = {
      wildfires:'#f97316', severe_storms:'#a855f7', volcanoes:'#f59e0b', floods:'#3b82f6',
      drought:'#a855f7', dustHaze:'#a16207', landslides:'#78350f', earthquakes:'#ef4444',
      snow:'#93c5fd', waterColor:'#0ea5e9', temperature:'#ef4444',
    };
    return map[cat] || '#64748b';
  }

  function normalizeEventLayerId(cat: string): string {
    if (cat === 'severeStorms') return 'severe_storms';
    return cat;
  }

  function loadMockEarthquakes(viewer: Cesium.Viewer) {
    const mock = [
      { mag:7.2, place:'Near Coast of Chile', time:Date.now()-86400000, depth:35, geometry:{coordinates:[-72, -35, 35]} },
      { mag:6.8, place:'Japan Region', time:Date.now()-172800000, depth:45, geometry:{coordinates:[142, 38, 45]} },
      { mag:6.5, place:'Indonesia', time:Date.now()-259200000, depth:60, geometry:{coordinates:[120, -5, 60]} },
      { mag:5.9, place:'Turkey', time:Date.now()-345600000, depth:15, geometry:{coordinates:[35, 38, 15]} },
      { mag:5.5, place:'California, USA', time:Date.now()-432000000, depth:8, geometry:{coordinates:[-117, 34, 8]} },
      { mag:5.2, place:'Philippines', time:Date.now()-518400000, depth:25, geometry:{coordinates:[125, 14, 25]} },
      { mag:4.8, place:'Greece', time:Date.now()-604800000, depth:10, geometry:{coordinates:[25, 37, 10]} },
      { mag:4.5, place:'New Zealand', time:Date.now()-691200000, depth:55, geometry:{coordinates:[175, -40, 55]} },
    ];
    const ents = mock.map(f => {
      const c = f.geometry.coordinates;
      const m = f.mag;
      const size = Math.max(6, Math.min(48, m * 6));
      return viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(c[0], c[1]),
        name: f.place,
        ellipse: {
          semiMinorAxis: size * 1000, semiMajorAxis: size * 1000,
          material: Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.4 + m/12),
          outline: true, outlineColor: Cesium.Color.fromCssColorString('#ef4444'), outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: `M${m.toFixed(1)}`, font: 'bold 12px "JetBrains Mono"',
          fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
          pixelOffset: new Cesium.Cartesian2(0, -size/2 - 8), show: m >= 5.5,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        properties: { layer:'earthquakes', magnitude:m, place:f.place, depth:f.depth, time:f.time, lon:c[0], lat:c[1] },
      });
    });
    entityStoreRef.current['earthquakes'] = ents;
    updateCounts();
  }

  function loadMockEvents(viewer: Cesium.Viewer) {
    const baseTime = Date.now();
    const events = [
      { title:'Creek Fire', category:'wildfires', lat:37.2, lon:-119.5, time:baseTime - 2 * 3600000 },
      { title:'Australian Bushfire', category:'wildfires', lat:-33.5, lon:150.3, time:baseTime - 4 * 3600000 },
      { title:'Typhoon Mawar', category:'severe_storms', lat:13.4, lon:144.8, windSpeed:120, pressure:934, time:baseTime - 6 * 3600000 },
      { title:'Hurricane Lee', category:'severe_storms', lat:25.0, lon:-70.0, windSpeed:145, pressure:925, time:baseTime - 8 * 3600000 },
      { title:'Etna Eruption', category:'volcanoes', lat:37.75, lon:14.99, time:baseTime - 10 * 3600000 },
      { title:'Semeru Eruption', category:'volcanoes', lat:-8.1, lon:112.9, time:baseTime - 12 * 3600000 },
      { title:'European Floods', category:'floods', lat:50.9, lon:7.0, time:baseTime - 14 * 3600000 },
      { title:'Pakistan Floods', category:'floods', lat:28.4, lon:69.3, time:baseTime - 16 * 3600000 },
    ];
    for (const ev of events) {
      const color = getEventColor(ev.category);
      const ent = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(ev.lon, ev.lat),
        name: ev.title,
        billboard: { image: createPulsingDotCanvas(color), width: 20, height: 20,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
        properties: { layer: ev.category, title: ev.title, lon: ev.lon, lat: ev.lat, time: ev.time, windSpeed: (ev as {windSpeed?:number}).windSpeed, pressure: (ev as {pressure?:number}).pressure },
      });
      if (!entityStoreRef.current[ev.category]) entityStoreRef.current[ev.category] = [];
      entityStoreRef.current[ev.category].push(ent);
    }
    setActiveEvents(events.length);
    updateCounts();
    refreshDerivedOverlays();
  }

  function loadMockTectonic(viewer: Cesium.Viewer) {
    // Silently skip tectonic if API fails
    void viewer;
  }

  function generateMockVolcanoes() {
    const baseTime = Date.now();
    return [
      { name:'Mount Etna', alertLevel:'Orange', lat:37.751, lon:14.9934, time: baseTime - 2 * 3600000 },
      { name:'Semeru', alertLevel:'Orange', lat:-8.108, lon:112.922, time: baseTime - 4 * 3600000 },
      { name:'Popocatepetl', alertLevel:'Yellow', lat:19.023, lon:-98.622, time: baseTime - 6 * 3600000 },
      { name:'Kilauea', alertLevel:'Orange', lat:19.421, lon:-155.287, time: baseTime - 8 * 3600000 },
      { name:'Fagradalsfjall', alertLevel:'Green', lat:63.906, lon:-22.273, time: baseTime - 10 * 3600000 },
      { name:'Sakurajima', alertLevel:'Orange', lat:31.593, lon:130.653, time: baseTime - 12 * 3600000 },
      { name:'Merapi', alertLevel:'Orange', lat:-7.54, lon:110.446, time: baseTime - 14 * 3600000 },
      { name:'Cotopaxi', alertLevel:'Yellow', lat:-0.684, lon:-78.438, time: baseTime - 16 * 3600000 },
      { name:'Mauna Loa', alertLevel:'Green', lat:19.472, lon:-155.592, time: baseTime - 18 * 3600000 },
      { name:'Erta Ale', alertLevel:'Orange', lat:13.6, lon:40.67, time: baseTime - 20 * 3600000 },
      { name:'Yasur', alertLevel:'Orange', lat:-19.532, lon:169.447, time: baseTime - 22 * 3600000 },
      { name:'Stromboli', alertLevel:'Orange', lat:38.789, lon:15.213, time: baseTime - 24 * 3600000 },
      { name:'Pacaya', alertLevel:'Orange', lat:14.382, lon:-90.601, time: baseTime - 26 * 3600000 },
      { name:'Villarrica', alertLevel:'Yellow', lat:-39.42, lon:-71.93, time: baseTime - 28 * 3600000 },
      { name:'Krakatau', alertLevel:'Orange', lat:-6.102, lon:105.423, time: baseTime - 30 * 3600000 },
      { name:'Sinabung', alertLevel:'Orange', lat:3.17, lon:98.392, time: baseTime - 32 * 3600000 },
    ];
  }

  function createPulsingDotCanvas(color: string, size: number = 16): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const cx = size/2, cy = size/2, r = size*0.35;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
    return canvas;
  }

  function createPlaneIcon(heading: number): HTMLCanvasElement {
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
    ctx.fillStyle = '#a855f7';
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

  function registerSocialEntity(post: SocialPost) {
    const v = viewerRef.current;
    if (!v) return;
    const existing = socialEntityRef.current[post.id];
    if (existing) {
      existing.show = true;
      return existing;
    }
    const ent = v.entities.add({
      position: Cesium.Cartesian3.fromDegrees(post.lon, post.lat, 5000),
      name: post.name,
      billboard: {
        image: createPinIcon('#ec4899', 22),
        width: 22,
        height: 22,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: post.name,
        font: '10px "JetBrains Mono"',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        show: false,
      },
      properties: {
        layer: 'social_groundtruth',
        title: post.name,
        text: post.text,
        source: post.source,
        type: post.type,
        lat: post.lat,
        lon: post.lon,
        time: new Date(post.time).getTime() || post.timestamp,
      },
    });
    socialEntityRef.current[post.id] = ent;
    if (!entityStoreRef.current['social_groundtruth']) entityStoreRef.current['social_groundtruth'] = [];
    entityStoreRef.current['social_groundtruth'].push(ent);
    return ent;
  }

  function focusLocation(lat: number, lon: number, options?: { label?: string; color?: string; height?: number; }) {
    const v = viewerRef.current;
    if (!v) return;
    if (focusMarkerRef.current) {
      v.entities.remove(focusMarkerRef.current);
      focusMarkerRef.current = null;
    }
    const height = options?.height ?? 50000;
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
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
      duration: 1.8,
      orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
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
    if (v) ents.forEach(ent => v.entities.remove(ent));
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
      return;
    }

    const renderAt = (lat: number, lon: number, source: string) => {
      if (!isLayerEnabled('disaster_near_me')) {
        disasterNearMeRequestedRef.current = false;
        return;
      }
      clearDisasterNearMeOverlay();
      lastKnownLocationRef.current = { lat, lon };

      const marker = v.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 5000),
        ellipse: {
          semiMajorAxis: 500000,
          semiMinorAxis: 500000,
          material: Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.12),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.5),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: 'Disasters Near Me',
          font: '11px "JetBrains Mono"',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          pixelOffset: new Cesium.Cartesian2(0, -18),
        },
        properties: {
          layer: 'disaster_near_me',
          title: 'Disasters Near Me',
          lat,
          lon,
          source,
          time: Date.now(),
        },
      });

      entityStoreRef.current['disaster_near_me'] = [marker];
      focusLocation(lat, lon, { label: 'Disasters Near Me', color: '#ef4444', height: 1000000 });
      const nearby = findNearbyEvents(lat, lon, 500);
      showNotification(
        nearby.length > 0
          ? `Found ${nearby.length} nearby events`
          : 'No major events found nearby',
        nearby.length > 0 ? 'warning' : 'success'
      );
      if (nearby.length > 0) {
        setShowAI(true);
        setAiMessages(prev => [...prev, {
          role: 'assistant',
          content: `📍 **Nearby Events**\n\n${nearby.map(e => `- ${e.title} (${e.distance.toFixed(0)} km)`).join('\n')}`,
        }]);
      }
    };

    if (disasterNearMeRequestedRef.current) return;

    disasterNearMeRequestedRef.current = true;

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          if (!isLayerEnabled('disaster_near_me')) {
            disasterNearMeRequestedRef.current = false;
            return;
          }
          renderAt(pos.coords.latitude, pos.coords.longitude, 'geolocation');
        },
        () => {
          if (!isLayerEnabled('disaster_near_me')) {
            disasterNearMeRequestedRef.current = false;
            return;
          }
          const fallback = lastKnownLocationRef.current || getCameraFallbackLocation();
          renderAt(fallback.lat, fallback.lon, 'fallback');
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      if (!isLayerEnabled('disaster_near_me')) {
        disasterNearMeRequestedRef.current = false;
        return;
      }
      const fallback = lastKnownLocationRef.current || getCameraFallbackLocation();
      renderAt(fallback.lat, fallback.lon, 'fallback');
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
      time: new Date(timestamp).toISOString(), timestamp,
    };
    registerAlertEntity(alert);
    alertsRef.current.unshift(alert);
    setAlerts([...alertsRef.current]);
    setNewAlertCount(prev => prev + 1);
    focusLocation(lat, lon, { label: 'Tsunami alert', color: '#ef4444', height: 45000 });
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
      };
      registerAlertEntity(alert);
      alertsRef.current.unshift(alert);
      setAlerts([...alertsRef.current]);
      setNewAlertCount(prev => prev + 1);
      showNotification(`M${mag.toFixed(1)} earthquake detected`, 'error');
      if (mag >= 6.5) requestNotification(`M${mag.toFixed(1)} Earthquake Alert`, place);
    }
  }

  function showNotification(text: string, severity: string) {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, text, severity }]);
    if (notificationTimeoutRef.current) clearTimeout(notificationTimeoutRef.current);
    notificationTimeoutRef.current = setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3500);
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
      try { (entity as unknown as Record<string, unknown>).show = visible; } catch { /* ignore */ }
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

  const setImagery = useCallback((type: string) => {
    const v = viewerRef.current;
    if (!v) return;
    setActiveImagery(type);
    try {
      v.scene.imageryLayers.removeAll();
      if (type === 'dark') {
        v.scene.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
          url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        }));
      } else if (type === 'temperature') {
        v.scene.imageryLayers.addImageryProvider(new Cesium.WebMapServiceImageryProvider({
          url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
          layers: 'AIRS_L2_Surface_Air_Temperature_Daily_Day', parameters: { TRANSPARENT: 'true' },
        }));
      } else {
        /* default imagery */
      }
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

    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`)
      .then(r => r.json())
      .then((data: {current: {temperature_2m:number;relative_humidity_2m:number;wind_speed_10m:number;weather_code:number}}) => {
        const c = data.current;
        setWeatherCards(prev => prev.map(wc =>
          wc.id === id ? { ...wc, temp: c.temperature_2m, desc: getWeatherDesc(c.weather_code) } : wc
        ));
      })
      .catch(() => {
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
      return;
    }

    const trail = new Cesium.SampledPositionProperty();
    issTrailRef.current = trail;
    issTimesRef.current = [];
    setShowISSInfo(true);

    issTimerRef.current = setInterval(() => {
      fetch('https://api.wheretheiss.at/v1/satellites/25544')
        .then(r => r.json())
        .then((data: {latitude:number;longitude:number}) => {
          const pos = Cesium.Cartesian3.fromDegrees(data.longitude, data.latitude, 408000);
          const time = Cesium.JulianDate.now();
          trail.addSample(time, pos);
          issTimesRef.current.push(time);
          if (issTimesRef.current.length > 50) {
            trail.removeSample(issTimesRef.current.shift()!);
          }

          if (!issEntityRef.current) {
            issEntityRef.current = v.entities.add({
              position: pos,
              billboard: { image: createISSIcon(), width: 32, height: 32 },
              label: { text: 'ISS', font: 'bold 11px "JetBrains Mono"', fillColor: Cesium.Color.WHITE,
                pixelOffset: new Cesium.Cartesian2(0, -18) },
              path: { leadTime: 0, trailTime: 300, width: 2,
                material: Cesium.Color.fromCssColorString('#3b82f6').withAlpha(0.6),
                resolution: 60 },
            });
            (issEntityRef.current.position as Cesium.SampledPositionProperty).setInterpolationOptions({
              interpolationDegree: 5, interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
            });
          }
          (issEntityRef.current.position as Cesium.SampledPositionProperty) = trail;
          setIssInfo({ lat: data.latitude, lon: data.longitude });
        })
        .catch(() => {
          // Mock ISS position
          const mockLat = 51.6 + Math.random() * 2;
          const mockLon = -0.1 + Math.random() * 2;
          const pos = Cesium.Cartesian3.fromDegrees(mockLon, mockLat, 408000);
          if (!issEntityRef.current) {
            issEntityRef.current = v.entities.add({
              position: pos,
              billboard: { image: createISSIcon(), width: 32, height: 32 },
              label: { text: 'ISS', font: 'bold 11px "JetBrains Mono"', fillColor: Cesium.Color.WHITE,
                pixelOffset: new Cesium.Cartesian2(0, -18) },
            });
          }
          setIssInfo({ lat: mockLat, lon: mockLon });
        });
    }, 5000);
  }, []);

  function createISSIcon(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(16, 16, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(59,130,246,0.3)';
    ctx.beginPath();
    ctx.arc(16, 16, 12, 0, Math.PI * 2);
    ctx.fill();
    return canvas;
  }

  /* ═════════════════════════════════════════════════════════════════
     SEARCH
     ═════════════════════════════════════════════════════════════════ */

  const handleSearch = useCallback((q: string) => {
    setSearchValue(q);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!q.trim()) { setShowSuggestions(false); return; }
    searchDebounceRef.current = setTimeout(() => doSearch(q), 220);
  }, []);

  function doSearch(q: string) {
    if (geocodeCacheRef.current[q]) {
      setSearchSuggestions(geocodeCacheRef.current[q]);
      setShowSuggestions(true);
      return;
    }
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then((results: Array<{display_name:string;lat:string;lon:string}>) => {
        const items = results.slice(0, 5).map(r => ({
          name: r.display_name, lat: parseFloat(r.lat), lon: parseFloat(r.lon),
        }));
        geocodeCacheRef.current[q] = items;
        setSearchSuggestions(items);
        setShowSuggestions(true);
      })
      .catch(() => setShowSuggestions(false));
  }

  const goToLocation = useCallback((lat: number, lon: number, label?: string, color?: string) => {
    setShowSuggestions(false);
    focusLocation(lat, lon, { label, color, height: 50000 });
  }, [focusLocation]);

  /* ═════════════════════════════════════════════════════════════════
     LAYER TOGGLES
     ═════════════════════════════════════════════════════════════════ */

  const toggleLayer = useCallback((layerId: string) => {
    setLayers(prev => {
      const next = prev.map(l => l.id === layerId ? { ...l, on: !l.on } : l);
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
    if (layerId === 'population_impact') {
      loadPopulationImpact(v);
    } else if (layerId === 'heatmap' && entityStoreRef.current['earthquakes']) {
      if (entityStoreRef.current['heatmap']?.length) {
        entityStoreRef.current['heatmap'].forEach(e => { if (e) e.show = true; });
        setShowHeatmapLegend(true);
      } else {
        generateHeatmap(v);
      }
    } else if (layerId === 'social_groundtruth') {
      setShowSocial(true);
      setSocialPulse(true);
      entityStoreRef.current['social_groundtruth']?.forEach(e => { if (e) e.show = true; });
      setTimeout(() => setSocialPulse(false), 5000);
    } else if (layerId === 'disaster_alerts') {
      setShowAlertsPanel(true);
      entityStoreRef.current['disaster_alerts']?.forEach(e => { if (e) e.show = true; });
    } else if (layerId === 'storm_forecast' || layerId === 'smoke_dispersion') {
      refreshDerivedOverlays();
    } else if (layerId === 'disaster_near_me') {
      renderDisasterNearMeLayer();
    } else if (layerId === 'flight_tracks') {
      void loadFlightTracks(v);
      return;
    } else if (entityStoreRef.current[layerId]?.length) {
      setLayerEntitiesVisible(layerId, true);
      if (layerId === 'tsunami') setShowTsunamiLegend(true);
    }
    showNotification(`${layerId} enabled`, 'success');
  }

  function hideLayerEntities(layerId: string) {
    setLayerEntitiesVisible(layerId, false);
    if (layerId === 'population_impact') {
      const v = viewerRef.current;
      if (v) populationImpactLayerRef.current.forEach(e => v.entities.remove(e));
      populationImpactLayerRef.current = [];
      setShowPopulationImpact(false);
    }
    if (layerId === 'heatmap') { setShowHeatmapLegend(false); }
    if (layerId === 'storm_forecast' || layerId === 'severe_storms') {
      clearStormForecastOverlays();
      setStormForecast(null);
    }
    if (layerId === 'smoke_dispersion' || layerId === 'wildfires') {
      clearSmokeDispersionOverlays();
    }
    if (layerId === 'tsunami') {
      const v = viewerRef.current;
      if (v) tsunamiWavesRef.current.forEach(e => v.entities.remove(e));
      tsunamiWavesRef.current = [];
      entityStoreRef.current['tsunami'] = [];
      setShowTsunamiLegend(false);
    }
    if (layerId === 'social_groundtruth') {
      setShowSocial(false);
      setSocialPulse(false);
    }
    if (layerId === 'disaster_alerts') {
      setShowAlertsPanel(false);
    }
    if (layerId === 'disaster_near_me') {
      clearDisasterNearMeOverlay();
      disasterNearMeRequestedRef.current = false;
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
    setShowPopulationImpact(true);
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

  const toggleAllLayers = useCallback((state: boolean) => {
    const next = layersRef.current.map(l => ({ ...l, on: state }));
    layersRef.current = next;
    setLayers(next);
    for (const key of Object.keys(entityStoreRef.current)) {
      entityStoreRef.current[key]?.forEach(e => { if (e) e.show = state; });
    }
    if (!state) {
      const v = viewerRef.current;
      if (v && focusMarkerRef.current) {
        v.entities.remove(focusMarkerRef.current);
        focusMarkerRef.current = null;
      }
      setShowSocial(false);
      setSocialPulse(false);
      setShowAlertsPanel(false);
      setShowPopulationImpact(false);
      setShowHeatmapLegend(false);
      setShowStormLegend(false);
      setShowSmokeLegend(false);
      setShowTsunamiLegend(false);
      disasterNearMeRequestedRef.current = false;
    }
    if (state) {
      const v = viewerRef.current;
      if (v) void loadFlightTracks(v);
    }
    refreshDerivedOverlays();
  }, []);

  const enableDefaultLayers = useCallback(() => {
    const next = layersRef.current.map(l => ({ ...l, on: l.default }));
    layersRef.current = next;
    setLayers(next);
    for (const layer of next) {
      const ents = entityStoreRef.current[layer.id];
      if (ents) ents.forEach(e => { if (e) e.show = layer.on; });
    }
    if (!next.find(l => l.id === 'social_groundtruth' && l.on)) {
      setShowSocial(false);
      setSocialPulse(false);
    }
    if (!next.find(l => l.id === 'disaster_alerts' && l.on)) {
      setShowAlertsPanel(false);
    }
    if (!next.find(l => l.id === 'disaster_near_me' && l.on)) {
      disasterNearMeRequestedRef.current = false;
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
    setAiMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setAiTyping(true);

    const location = extractLocation(userMsg);
    const cmd = extractCommand(userMsg);
    if (cmd) { executeCommand(cmd, location); setAiTyping(false); return; }

    try {
      const response = await callAI(userMsg, location);
      setAiMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch {
      const fallback = generateLocalResponse(userMsg, location);
      setAiMessages(prev => [...prev, { role: 'assistant', content: fallback }]);
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
      focusLocation(loc.lat, loc.lon, { label: 'Requested location', color: '#60a5fa', height: 50000 });
      setAiMessages(prev => [...prev, { role: 'assistant', content: `Flew to coordinates ${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}` }]);
    } else if (cmd === 'weather' && loc) {
      focusLocation(loc.lat, loc.lon, { label: 'Weather request', color: '#22d3ee', height: 50000 });
      addWeatherCard(loc.lat, loc.lon);
      setAiMessages(prev => [...prev, { role: 'assistant', content: 'Weather data displayed on the globe.' }]);
    } else if (cmd === 'earthquakes') {
      setAiMessages(prev => [...prev, { role: 'assistant', content: 'Showing recent earthquakes. Use the sidebar to toggle seismic data layers.' }]);
    } else if (cmd === 'population') {
      setLayers(prev => prev.map(l => l.id === 'population_impact' ? { ...l, on: true } : l));
      loadLayerData('population_impact');
      setAiMessages(prev => [...prev, { role: 'assistant', content: 'Population impact zones displayed on the globe.' }]);
    } else {
      setAiMessages(prev => [...prev, { role: 'assistant', content: `Command recognized: ${cmd}. Executing...` }]);
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
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${locationContext}${message}` }] }] }),
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
      focusLocation(cm.lat, cm.lon, { label: 'Context location', color: '#60a5fa', height: 50000 });
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
      showNotification('Pin dropped', 'success');
    } else if (action === 'weather') {
      focusLocation(cm.lat, cm.lon, { label: 'Weather request', color: '#22d3ee', height: 50000 });
      addWeatherCard(cm.lat, cm.lon);
    } else if (action === 'events') {
      const nearby = findNearbyEvents(cm.lat, cm.lon, 200);
      setAiMessages(prev => [...prev, { role: 'assistant',
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
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(center, size * 0.42, size * 0.33, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(center, size * 0.72);
    ctx.lineTo(size * 0.33, size);
    ctx.lineTo(size * 0.67, size);
    ctx.closePath();
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
      v.clock.shouldAnimate = false;
      if (rotateTimerRef.current) clearInterval(rotateTimerRef.current);
      setIsAutoRotating(false);
    } else {
      v.clock.shouldAnimate = true;
      setIsAutoRotating(true);
      rotateTimerRef.current = setInterval(() => {
        v.camera.rotate(Cesium.Cartesian3.UNIT_Z, 0.002);
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
    if (rotateTimerRef.current) clearInterval(rotateTimerRef.current);
    if (timelineRef.current.interval) clearInterval(timelineRef.current.interval);
    if (autoRefreshIntervalRef.current) clearInterval(autoRefreshIntervalRef.current);
    if (screenSpaceHandlerRef.current) screenSpaceHandlerRef.current.destroy();
    seismicAnimationsRef.current.forEach(a => { if (a.interval) clearInterval(a.interval); });
    if (clickHandlerRef.current) clickHandlerRef.current();
    if (viewerRef.current) {
      viewerRef.current.entities.removeAll();
      viewerRef.current.destroy();
      viewerRef.current = null;
    }
    focusMarkerRef.current = null;
    stormOverlaysRef.current = [];
    smokeParticlesRef.current = [];
    tsunamiWavesRef.current = [];
    Object.keys(weatherCardElementsRef.current).forEach(key => { delete weatherCardElementsRef.current[key]; });
    Object.keys(socialEntityRef.current).forEach(key => { delete socialEntityRef.current[key]; });
    Object.keys(alertEntityRef.current).forEach(key => { delete alertEntityRef.current[key]; });
    disasterNearMeRequestedRef.current = false;
    lastKnownLocationRef.current = null;
  }, []);

  /* ═════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════ */

  const formatInfoPanel = () => {
    if (!infoEntity) return null;
    const p = infoEntity.properties?.getValue(Cesium.JulianDate.now()) as Record<string, unknown> | undefined;
    if (!p) return null;

    if (p.layer === 'earthquakes' || p.magnitude) {
      const mag = Number(p.magnitude ?? 0);
      return (
        <>
          <div className="info-header">
            <div className="info-type-dot" style={{background:'#ef4444'}} />
            <div className="info-title">M{mag.toFixed(1)} Earthquake</div>
            <button className="info-close" onClick={() => setInfoEntity(null)}>✕</button>
          </div>
          <div className="info-body">
            <div className="info-row"><span className="info-key">Location</span><span className="info-val">{String(p.place ?? '')}</span></div>
            <div className="info-row"><span className="info-key">Magnitude</span><span className="info-val">M{mag.toFixed(1)}</span></div>
            <div className="info-row"><span className="info-key">Depth</span><span className="info-val">{String(p.depth ?? 'N/A')} km</span></div>
            <div className="info-row"><span className="info-key">Time</span><span className="info-val">{new Date(Number(p.time ?? 0)).toUTCString()}</span></div>
            <div className="info-row"><span className="info-key">Coordinates</span><span className="info-val">{Number(p.lat ?? 0).toFixed(4)}, {Number(p.lon ?? 0).toFixed(4)}</span></div>
            {Number(p.magnitude ?? 0) >= 4 && (
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
            {populationImpact && (
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
          </div>
        </>
      );
    }

    if ((p.layer === 'severe_storms' || p.layer === 'storm_forecast') && (stormForecast || p.stormTrack)) {
      const forecastTrack = (stormForecast?.track as Array<{ time: string; lat: number; lon: number }> | undefined)
        ?? (p.stormTrack as Array<{ time: string; lat: number; lon: number }> | undefined)
        ?? [];
      const heading = stormForecast?.heading ?? Number(p.heading ?? 0);
      const speedKmh = stormForecast?.speedKmh ?? Number(p.speedKmh ?? 0);
      const pressure = stormForecast?.pressure ?? Number(p.pressure ?? 0);
      return (
        <>
          <div className="info-header">
            <div className="info-type-dot" style={{background:'#a855f7'}} />
            <div className="info-title">{String(p.title ?? 'Storm')}</div>
            <button className="info-close" onClick={() => setInfoEntity(null)}>✕</button>
          </div>
          <div className="info-body">
            <div className="info-row"><span className="info-key">Wind Speed</span><span className="info-val">{String(p.windSpeed ?? 'N/A')} mph</span></div>
            <div className="info-row"><span className="info-key">Pressure</span><span className="info-val">{pressure.toFixed(0)} mb</span></div>
            <div className="info-row"><span className="info-key">Heading</span><span className="info-val">{heading.toFixed(0)}°</span></div>
            <div className="info-row"><span className="info-key">Forward Speed</span><span className="info-val">{speedKmh.toFixed(1)} km/h</span></div>
            <div className="sparkline-wrap">
              <div className="sparkline-title">Forecast Track</div>
              {forecastTrack.map((pt, i) => (
                <div key={i} className="storm-track-point">
                  <div className="storm-track-dot" />
                  <span style={{fontSize:11,fontWeight:500}}>{pt.time}</span>
                  <span className="storm-track-date">{pt.lat.toFixed(1)}°, {pt.lon.toFixed(1)}°</span>
                </div>
              ))}
            </div>
            <div className="sparkline-wrap">
              <div className="sparkline-title">Storm Cone Legend</div>
              <div style={{display:'flex',flexDirection:'column',gap:4,fontSize:10}}>
                <div className="legend-row"><div className="legend-color" style={{background:'rgba(168,85,247,0.3)'}}/><span>24h forecast (narrowest)</span></div>
                <div className="legend-row"><div className="legend-color" style={{background:'rgba(168,85,247,0.2)'}}/><span>48h forecast</span></div>
                <div className="legend-row"><div className="legend-color" style={{background:'rgba(168,85,247,0.1)'}}/><span>72h forecast (widest)</span></div>
                <div className="legend-row"><div className="legend-color" style={{background:'rgba(168,85,247,0.4)'}}/><span>Projected track</span></div>
              </div>
            </div>
          </div>
        </>
      );
    }

    if (p.layer === 'wildfires' || p.category === 'wildfires') {
      return (
        <>
          <div className="info-header">
            <div className="info-type-dot" style={{background:'#f97316'}} />
            <div className="info-title">{String(p.title ?? 'Wildfire')}</div>
            <button className="info-close" onClick={() => setInfoEntity(null)}>✕</button>
          </div>
          <div className="info-body">
            <div className="info-row"><span className="info-key">Status</span><span className="info-val">{String(p.status ?? 'Active')}</span></div>
            <div className="info-row"><span className="info-key">Date</span><span className="info-val">{String(p.date ?? '')}</span></div>
            {p.lat != null && p.lon != null && <div className="info-row"><span className="info-key">Coordinates</span><span className="info-val">{Number(p.lat).toFixed(4)}, {Number(p.lon).toFixed(4)}</span></div>}
            <div className="sparkline-wrap">
              <div className="sparkline-title">Fire Monitoring</div>
              <div style={{fontSize:10,color:'var(--text-dim)',lineHeight:1.5}}>
                Smoke dispersion simulation active for this fire location.
              </div>
            </div>
          </div>
        </>
      );
    }

    return (
      <>
        <div className="info-header">
          <div className="info-type-dot" style={{background:getEventColor(String(p.layer ?? p.type ?? 'default'))}} />
          <div className="info-title">{String(p.title ?? p.name ?? 'Event')}</div>
          <button className="info-close" onClick={() => setInfoEntity(null)}>✕</button>
        </div>
        <div className="info-body">
          {!!p.type && <div className="info-row"><span className="info-key">Type</span><span className="info-val">{String(p.type)}</span></div>}
          {!!p.date && <div className="info-row"><span className="info-key">Date</span><span className="info-val">{String(p.date)}</span></div>}
          {!!p.description && <div className="info-row"><span className="info-key">Details</span><span className="info-val" style={{fontSize:10}}>{String(p.description)}</span></div>}
          {p.lat != null && p.lon != null && <div className="info-row"><span className="info-key">Coordinates</span><span className="info-val">{Number(p.lat).toFixed(4)}, {Number(p.lon).toFixed(4)}</span></div>}
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
            onKeyDown={e => { if (e.key === 'Enter' && searchSuggestions.length) goToLocation(searchSuggestions[0].lat, searchSuggestions[0].lon, searchSuggestions[0].name, '#60a5fa'); }}
            style={{ width: '100%' }} />
          {showSuggestions && searchSuggestions.length > 0 && (
            <div className="search-suggestions active" style={{ position: 'absolute', top: '100%', left: 0, right: 0 }}>
              {searchSuggestions.map((s, i) => (
                <div key={i} className="item" onClick={() => goToLocation(s.lat, s.lon, s.name, '#60a5fa')}>{s.name}</div>
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
          <button className="btn-icon" onClick={() => setShowTokenSetup(true)} title="API Keys">🔑</button>
          <button className="btn-icon" onClick={takeSnapshot} title="Snapshot">📷</button>
          <button className="btn-icon" onClick={() => focusLocation(20.5937, 78.9629, { label: 'India', color: '#f59e0b', height: 6500000 })} title="Fly to India">🇮🇳</button>
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
            {['earth','satellite','dark','terrain','population','temperature','night'].map(type => (
              <button key={type} className={`img-chip ${activeImagery === type ? 'active' : ''}`}
                onClick={() => setImagery(type)}>
                {type === 'earth' ? '🌍 Earth' : type === 'satellite' ? '🛰️ Sat' : type === 'dark' ? '🌑 Dark'
                  : type === 'terrain' ? '⛰️ Ter' : type === 'population' ? '👥 Pop' : type === 'temperature' ? '🌡️ Temp'
                  : '🌃 Night'}
              </button>
            ))}
          </div>
        </div>
        <div className="sidebar-scroll">
          {CATEGORIES.map(cat => {
            const items = groupedLayers[cat.id] || [];
            const isOpen = openCategories.includes(cat.id);
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
                        <input type="checkbox" checked={layer.on} readOnly />
                        <div className="toggle-slider" />
                      </div>
                      <div className="layer-status">
                        <div className="live-dot" />
                        <span>Live</span>
                      </div>
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
          {aiMessages.map((msg, i) => (
            <div key={i} className={`ai-msg ${msg.role}`}>
              {msg.role === 'assistant' ? (
                <div dangerouslySetInnerHTML={{
                  __html: msg.content.replace(/\*\*(.*?)\*/g, '<strong>$1</strong>')
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
                a.seen = true;
                setAlerts([...alertsRef.current]);
                setNewAlertCount(prev => Math.max(0, prev - 1));
                focusLocation(a.lat, a.lon, { label: a.title, color: getSeverityColor(a.severity), height: 45000 });
              }}>
              <div className="alert-title">
                <div className="alert-dot" style={{background:a.severity === 'red' ? '#ef4444' : a.severity === 'orange' ? '#f97316' : '#22c55e'}} />
                {a.title}
              </div>
              <div className="alert-desc">{a.desc}</div>
              <div className="alert-desc" style={{marginTop:4,color:'var(--text-muted)'}}>📍 {a.lat.toFixed(2)}, {a.lon.toFixed(2)}</div>
              <div className="alert-time">{new Date(a.time).toLocaleString()}</div>
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
      <div className={`social-panel glass-panel ${showSocial ? 'open' : ''}`}>
        <div className="ai-header">
          <div className="social-icon-grad">📱</div>
          <div className="ai-title">Social Ground Truth</div>
          <button className="ai-close" onClick={() => setShowSocial(false)}>✕</button>
        </div>
        <div style={{padding:'8px 12px',borderBottom:'1px solid var(--border)',display:'flex',gap:6,flexWrap:'wrap'}}>
          {['all','fire','storm','earthquake','flood'].map(f => (
            <button key={f} className={`social-filter-chip ${socialFilter === f ? 'active' : ''}`}
              onClick={() => setSocialFilter(f)}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="social-feed">
          {socialPosts.filter(p => socialFilter === 'all' || p.type === socialFilter).map(post => (
            <div key={post.id} className="social-post" onClick={() => focusLocation(post.lat, post.lon, { label: post.name, color: '#ec4899', height: 45000 })}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                <div className="social-avatar">{post.avatar}</div>
                <div>
                  <div className="social-user">{post.name}</div>
                  <div style={{fontSize:9,color:'var(--text-muted)'}}>@{post.user} · {post.source}</div>
                </div>
                <span className="social-time">{post.timeLabel}</span>
              </div>
              <div className="social-text">{post.text}</div>
              <div style={{fontSize:10,color:'var(--text-muted)',marginBottom:6}}>📍 {post.lat.toFixed(2)}, {post.lon.toFixed(2)}</div>
              <div className="social-meta">
                <span>❤️ {post.likes}</span>
                <span>🔄 {post.shares}</span>
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
            <span>{new Date(timelineRef.current.start).toLocaleDateString()}</span>
            <span>{new Date(timelineRef.current.current).toLocaleString()}</span>
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
        <div className="stat-item"><div className="stat-dot" style={{background:'#f59e0b'}}/><span className="stat-label">Layers</span><span className="stat-val">{activeLayerCount}/45</span></div>
      </div>

      {/* Zoom Controls */}
      <div className="zoom-controls">
        <button className="zoom-btn" onClick={zoomIn}>+</button>
        <button className="zoom-btn" onClick={zoomOut}>−</button>
      </div>

      {/* Context Menu */}
      <div ref={contextMenuRef} className={`context-menu ${contextMenu.show ? 'active' : ''}`}
        style={{ left: contextMenu.x - 90, top: contextMenu.y - 90 }}>
        <div className="ctx-ring">
          <div className="ctx-center">📍</div>
          <div className="ctx-item" style={{top:0,left:'50%',transform:'translateX(-50%)'}}
            onClick={() => handleContextAction('flyTo')}>
            <span className="ctx-emoji">🎯</span><span className="ctx-label">Fly To</span>
          </div>
          <div className="ctx-item" style={{bottom:0,left:'50%',transform:'translateX(-50%)'}}
            onClick={() => handleContextAction('pin')}>
            <span className="ctx-emoji">📌</span><span className="ctx-label">Drop Pin</span>
          </div>
          <div className="ctx-item" style={{left:0,top:'50%',transform:'translateY(-50%)'}}
            onClick={() => handleContextAction('weather')}>
            <span className="ctx-emoji">🌡️</span><span className="ctx-label">Weather</span>
          </div>
          <div className="ctx-item" style={{right:0,top:'50%',transform:'translateY(-50%)'}}
            onClick={() => handleContextAction('events')}>
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
              <button className="share-option" onClick={takeSnapshot}>📷 Snapshot</button>
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

      {/* Social Pulse Indicator */}
      {socialPulse && (
        <div className="social-pulse-indicator show">
          <div className="social-pulse-dot" />
          <span>Ground truth pulse active</span>
        </div>
      )}

      {/* Weather Cards */}
      {weatherCards.map(wc => (
        <div key={wc.id} ref={el => { weatherCardElementsRef.current[wc.id] = el; }} className="weather-card glass-panel"
          style={{ display: 'block', pointerEvents: 'auto', opacity: 0 }}
          onClick={() => focusLocation(wc.lat, wc.lon, { label: 'Weather location', color: '#22d3ee', height: 45000 })}>
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
