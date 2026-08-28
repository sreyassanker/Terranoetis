/**
 * ToolWorkbench — Physics-Integrated Causal Chain Builder
 *
 * Executes a sequential chain of geospatial tools, runs physics surrogates
 * at each relevant step, propagates evidence through the Noisy-OR CBN,
 * and renders the final fused risk surface as IDW on the Cesium globe.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getToolIO, getMapping, extractEvidence, computeCausalProbabilities, computeFullCausalState } from '@/rendering/causalGraph';
import type { CausalState } from '@/rendering/causalGraph';
import { getDefaultScenarios, rolloutScenario } from '@/rendering/scenarioEngine';
import type { Scenario, ScenarioDiff } from '@/rendering/scenarioEngine';
import { writeCausalProbs, initBlackboard } from '@/rendering/blackboard';
import { authHeaders } from '@/context/AuthContext';
import { formatStepResult } from '@/rendering/formatStepResult';
import type { FormattedStepResult } from '@/rendering/formatStepResult';
import {
  computeLiquefaction,
  computeDispersion,
  computeWildfireSpread,
  computeFloodRouting,
} from '@/rendering/physicsSurrogates';
import { computeFusedSurface } from '@/rendering/gisFusion';
import { Wrench } from 'lucide-react';
import Panel from '@/components/ui/Panel';

/* ═════════════════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═════════════════════════════════════════════════════════════════ */

interface Tool { name: string; category: string; description: string; }
interface ChainStep { tool: string; params: string; id: string; }

interface PhysicsInline {
  model: string;
  metrics: { label: string; value: string }[];
  color: string;
}

const TOOL_META: Record<string, { code: string; color: string }> = {
  earthquakes: { code: 'EQ', color: '#f59e0b' },
  weather_forecast: { code: 'WX', color: '#3b82f6' },
  storms: { code: 'ST', color: '#6366f1' },
  wildfires: { code: 'WF', color: '#ef4444' },
  floods: { code: 'FL', color: '#06b6d4' },
  firms_fires: { code: 'FR', color: '#f97316' },
  satellite_analyze: { code: 'SA', color: '#10b981' },
  seismic_events: { code: 'SE', color: '#d97706' },
  radar_fetch: { code: 'RD', color: '#8b5cf6' },
  sentiment_analyze: { code: 'SN', color: '#ec4899' },
  predict: { code: 'PR', color: '#a855f7' },
  flood_forecast: { code: 'FF', color: '#0891b2' },
  marine: { code: 'MA', color: '#0ea5e9' },
  weather_ensemble: { code: 'EN', color: '#6366f1' },
  seasonal_forecast: { code: 'SF', color: '#8b5cf6' },
  climate_historical: { code: 'CH', color: '#a855f7' },
  air_quality: { code: 'AQ', color: '#84cc16' },
  gfs_forecast: { code: 'GF', color: '#14b8a6' },
  agriculture: { code: 'AG', color: '#65a30d' },
  gdelt: { code: 'GD', color: '#f43f5e' },
  population: { code: 'PO', color: '#d946ef' },
  space_weather: { code: 'SW', color: '#eab308' },
  infrastructure: { code: 'IN', color: '#78716c' },
  water_resources: { code: 'WR', color: '#06b6d4' },
  disaster_declarations: { code: 'DD', color: '#f97316' },
};

/** Direct API endpoints — real data, some need POST */
type DirectApiEntry = {
  path: string;
  method?: 'GET' | 'POST';
  transform: (p: Record<string, unknown>) => string | Record<string, unknown>;
};
/** Shared USGS query builder for earthquakes + seismic_events */
function usgsQuery(p: Record<string, unknown>): string {
  const s = p as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
  const bbox = `minLat=${s.latMin ?? s.lat ?? 35}&maxLat=${s.latMax ?? num(s.lat, 35) + 10}&minLon=${s.lonMin ?? s.lon ?? 139}&maxLon=${s.lonMax ?? num(s.lon, 139) + 10}&minMag=${s.minMag ?? 1}`;
  const timeRange = s.startDate ? `&starttime=${s.startDate}T${s.startTime || '00:00'}:00Z&endtime=${s.endDate || s.startDate}T${s.endTime || '23:59'}:00Z` : '';
  return `?${bbox}${timeRange}`;
}

const DIRECT_API: Record<string, DirectApiEntry> = {
  earthquakes: {
    path: '/api/earthquakes',
    transform: p => usgsQuery(p),
  },
  weather_forecast: {
    path: '/api/weather/open-meteo',
    transform: p => {
      let q = `?lat=${p.lat ?? 35}&lon=${p.lon ?? 139}`;
      if (p.startDate) q += `&startDate=${p.startDate}`;
      if (p.endDate) q += `&endDate=${p.endDate}`;
      return q;
    },
  },
  wildfires: {
    path: '/api/eonet',
    transform: p => `?category=wildfires&status=open&limit=20${p.latMin ? `&bbox=${p.lonMin},${p.latMin},${p.lonMax},${p.latMax}` : ''}`,
  },
  floods: {
    path: '/api/eonet',
    transform: p => `?category=floods&status=open&limit=20${p.latMin ? `&bbox=${p.lonMin},${p.latMin},${p.lonMax},${p.latMax}` : ''}`,
  },
  firms_fires: {
    path: '/api/firms',
    transform: p => {
      if (p.latMin != null) {
        return `?latMin=${p.latMin}&latMax=${p.latMax}&lonMin=${p.lonMin}&lonMax=${p.lonMax}`;
      }
      return `?lat=${p.lat ?? 35}&lon=${p.lon ?? 139}&radius=5`;
    },
  },
  seismic_events: {
    path: '/api/earthquakes',
    transform: p => usgsQuery(p),
  },
  storms: {
    path: '/api/weather/nhc',
    transform: p => {
      let q = '?';
      if (p.latMin != null) q += `latMin=${p.latMin}&latMax=${p.latMax}&lonMin=${p.lonMin}&lonMax=${p.lonMax}&`;
      return q === '?' ? '' : q.slice(0, -1);
    },
  },
  radar_fetch: {
    path: '/api/radar/rainviewer',
    transform: () => '',
  },
  satellite_analyze: {
    path: '/api/satellite/process',
    method: 'POST',
    transform: p => ({
      type: 'ndvi',
      bbox: { latMin: p.latMin ?? 35, latMax: p.latMax ?? 45, lonMin: p.lonMin ?? -120, lonMax: p.lonMax ?? -110 },
    }),
  },
  sentiment_analyze: {
    path: '/api/sentiment/news',
    transform: () => '?q=disaster+OR+crisis+OR+emergency+OR+weather+OR+flood+OR+fire+OR+storm+OR+earthquake',
  },
  flood_forecast: {
    path: '/api/weather/flood',
    transform: p => {
      let q = `?lat=${p.lat ?? p.latMin ?? 35}&lon=${p.lon ?? p.lonMin ?? 140}`;
      if (p.startDate) q += `&startDate=${p.startDate}`;
      if (p.endDate) q += `&endDate=${p.endDate}`;
      return q;
    },
  },
  marine: {
    path: '/api/weather/marine',
    transform: p => {
      let q = `?lat=${p.lat ?? 35}&lon=${p.lon ?? 140}`;
      if (p.startDate) q += `&startDate=${p.startDate}`;
      if (p.endDate) q += `&endDate=${p.endDate}`;
      return q;
    },
  },
  weather_ensemble: {
    path: '/api/weather/ensemble',
    transform: p => {
      let q = `?lat=${p.lat ?? 35}&lon=${p.lon ?? 140}`;
      if (p.startDate) q += `&startDate=${p.startDate}`;
      if (p.endDate) q += `&endDate=${p.endDate}`;
      return q;
    },
  },
  seasonal_forecast: {
    path: '/api/weather/seasonal',
    transform: p => {
      let q = `?lat=${p.lat ?? 35}&lon=${p.lon ?? 140}`;
      if (p.startDate) q += `&startDate=${p.startDate}`;
      return q;
    },
  },
  climate_historical: {
    path: '/api/weather/historical',
    transform: p => {
      const lat = p.lat ?? 35;
      const lon = p.lon ?? 140;
      const startDate = p.startDate || '2025-01-01';
      const endDate = p.endDate || '2025-12-31';
      return `?lat=${lat}&lon=${lon}&startDate=${startDate}&endDate=${endDate}`;
    },
  },
  air_quality: {
    path: '/api/weather/air-quality',
    transform: p => {
      let q = `?lat=${p.lat ?? 35}&lon=${p.lon ?? 140}`;
      if (p.startDate) q += `&startDate=${p.startDate}`;
      if (p.endDate) q += `&endDate=${p.endDate}`;
      return q;
    },
  },
  gfs_forecast: {
    path: '/api/weather/gfs',
    transform: p => {
      let q = `?lat=${p.lat ?? 35}&lon=${p.lon ?? 140}`;
      if (p.startDate) q += `&startDate=${p.startDate}`;
      if (p.endDate) q += `&endDate=${p.endDate}`;
      return q;
    },
  },
  agriculture: {
    path: '/api/climate/power',
    transform: p => {
      let q = `?lat=${p.lat ?? 35}&lon=${p.lon ?? 140}`;
      if (p.startDate) q += `&startDate=${p.startDate}`;
      if (p.endDate) q += `&endDate=${p.endDate}`;
      return q;
    },
  },
  gdelt: {
    path: '/api/gdelt',
    transform: p => {
      let q = `?lat=${p.lat ?? 35}&lon=${p.lon ?? 140}`;
      if (p.startDate) q += `&startDate=${p.startDate}`;
      if (p.endDate) q += `&endDate=${p.endDate}`;
      if (p.startTime) q += `&startTime=${p.startTime}`;
      if (p.endTime) q += `&endTime=${p.endTime}`;
      return q;
    },
  },
  population: {
    path: '/api/population/worldpop',
    transform: p => {
      const lat = Number(p.lat ?? 35);
      const lon = Number(p.lon ?? 140);
      if (p.latMin != null) return `?latMin=${p.latMin}&latMax=${p.latMax}&lonMin=${p.lonMin}&lonMax=${p.lonMax}`;
      return `?latMin=${lat - 5}&latMax=${lat + 5}&lonMin=${lon - 5}&lonMax=${lon + 5}`;
    },
  },
  space_weather: {
    path: '/api/space-weather/donki',
    transform: p => {
      let q = '?';
      if (p.startDate) q += `startDate=${p.startDate}&`;
      if (p.endDate) q += `endDate=${p.endDate}&`;
      return q === '?' ? '' : q.slice(0, -1);
    },
  },
  infrastructure: {
    path: '/api/geospatial/overpass',
    transform: p => {
      const lat = Number(p.lat ?? 35);
      const lon = Number(p.lon ?? 140);
      if (p.latMin != null) return `?latMin=${p.latMin}&latMax=${p.latMax}&lonMin=${p.lonMin}&lonMax=${p.lonMax}`;
      return `?latMin=${lat - 0.5}&latMax=${lat + 0.5}&lonMin=${lon - 0.5}&lonMax=${lon + 0.5}`;
    },
  },
  water_resources: {
    path: '/api/usgs/water',
    transform: p => {
      const lat = Number(p.lat ?? 35);
      const lon = Number(p.lon ?? 140);
      let q = p.latMin != null
        ? `?latMin=${p.latMin}&latMax=${p.latMax}&lonMin=${p.lonMin}&lonMax=${p.lonMax}`
        : `?latMin=${lat - 1}&latMax=${lat + 1}&lonMin=${lon - 1}&lonMax=${lon + 1}`;
      if (p.startDate) q += `&startDate=${p.startDate}`;
      if (p.endDate) q += `&endDate=${p.endDate}`;
      if (p.startTime) q += `&startTime=${p.startTime}`;
      if (p.endTime) q += `&endTime=${p.endTime}`;
      return q;
    },
  },
  disaster_declarations: {
    path: '/api/fema',
    transform: p => {
      let q = '?';
      if (p.latMin != null) q += `latMin=${p.latMin}&latMax=${p.latMax}&lonMin=${p.lonMin}&lonMax=${p.lonMax}&`;
      if (p.startDate) q += `startDate=${p.startDate}&`;
      if (p.endDate) q += `endDate=${p.endDate}&`;
      return q === '?' ? '' : q.slice(0, -1);
    },
  },
  /* predict is handled as a special case in executeChain — synthesizes from cumulative evidence */
};

/* Skip: predict (synthesis), radar_fetch (tile-only, no points), space_weather (global) */
const TOOL_WORKBENCH_SKIPPED_TOOLS = new Set(['predict', 'radar_fetch', 'space_weather']);

/** Tools in causal topological order — data flows downstream */
const AVAILABLE_TOOLS: Tool[] = [
  { name: 'earthquakes', category: 'seismic', description: 'Recent M2.5+ earthquakes (USGS)' },
  { name: 'seismic_events', category: 'seismic', description: 'Seismic waveform events' },
  { name: 'weather_forecast', category: 'weather', description: 'Current weather at lat/lon (Open-Meteo)' },
  { name: 'storms', category: 'weather', description: 'Tropical cyclone tracks (NHC)' },
  { name: 'firms_fires', category: 'hazards', description: 'NASA FIRMS satellite fire detection' },
  { name: 'wildfires', category: 'hazards', description: 'NASA EONET fire events' },
  { name: 'floods', category: 'hazards', description: 'Flood events globally (EONET)' },
  { name: 'flood_forecast', category: 'hazards', description: 'River discharge & flood forecasts (Open-Meteo)' },
  { name: 'marine', category: 'weather', description: 'Wave height, currents, swell (Open-Meteo Marine)' },
  { name: 'weather_ensemble', category: 'weather', description: 'Multi-model ensemble weather forecast' },
  { name: 'seasonal_forecast', category: 'weather', description: '3-6 month seasonal climate outlook' },
  { name: 'climate_historical', category: 'weather', description: 'Historical daily/hourly weather archive' },
  { name: 'gfs_forecast', category: 'weather', description: 'NOAA GFS global weather model (16-day)' },
  { name: 'air_quality', category: 'hazards', description: 'PM2.5, PM10, NO2, O3, UV index (Open-Meteo)' },
  { name: 'agriculture', category: 'environment', description: 'Solar radiation, crop stress (NASA POWER)' },
  { name: 'water_resources', category: 'hazards', description: 'Streamflow, groundwater (USGS Water)' },
  { name: 'disaster_declarations', category: 'hazards', description: 'FEMA disaster declarations & assistance' },
  { name: 'radar_fetch', category: 'multimodal', description: 'NEXRAD radar / weather alerts' },
  { name: 'satellite_analyze', category: 'multimodal', description: 'Analyze satellite imagery (NDVI/NDWI)' },
  { name: 'sentiment_analyze', category: 'multimodal', description: 'Social media sentiment' },
  { name: 'gdelt', category: 'multimodal', description: 'Global event, conflict & disaster database' },
  { name: 'population', category: 'environment', description: 'Population density estimates (WorldPop)' },
  { name: 'infrastructure', category: 'environment', description: 'Buildings, roads, landuse (OSM Overpass)' },
  { name: 'space_weather', category: 'multimodal', description: 'Solar flares, CMEs, geomagnetic storms' },
  { name: 'predict', category: 'ml', description: 'Multi-hazard risk prediction' },
];

interface ToolWorkbenchProps {
  onClose: () => void;
  bbox?: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null;
  onSurfaceData?: (toolId: string, resultJson: string) => void;
  onClear?: () => void;
}

/* ═════════════════════════════════════════════════════════════════
   COMPONENT
   ═════════════════════════════════════════════════════════════════ */

export default function ToolWorkbench({ onClose, bbox, onSurfaceData, onClear }: ToolWorkbenchProps) {
  const [chain, setChain] = useState<ChainStep[]>([]);
  const [executing, setExecuting] = useState(false);
  const [formattedResults, setFormattedResults] = useState<Record<string, FormattedStepResult>>({});
  const [physicsInline, setPhysicsInline] = useState<Record<string, PhysicsInline>>({});
  const [causalState, setCausalState] = useState<CausalState | null>(null);
  const [causalProbs, setCausalProbs] = useState<Record<string, number>>({});
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [autoMode, setAutoMode] = useState(true);
  const [scenarioDiffs, setScenarioDiffs] = useState<ScenarioDiff[]>([]);
  const [activeTab, setActiveTab] = useState<'chain' | 'whatif'>('chain');
  const [rangeStartDate, setRangeStartDate] = useState('');
  const [rangeStartTime, setRangeStartTime] = useState('');
  const [rangeEndDate, setRangeEndDate] = useState('');
  const [rangeEndTime, setRangeEndTime] = useState('');

  const mountedRef = useRef(true);
  const autoPopulatedRef = useRef(false);

  useEffect(() => { initBlackboard(); }, []);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  /* Set default date range (IST): now → 1 hour ago */
  useEffect(() => {
    function istParts(date: Date) {
      const ms = date.getTime() + 5.5 * 3600000;
      const ist = new Date(ms);
      return {
        date: `${ist.getUTCFullYear()}-${String(ist.getUTCMonth()+1).padStart(2,'0')}-${String(ist.getUTCDate()).padStart(2,'0')}`,
        time: `${String(ist.getUTCHours()).padStart(2,'0')}:${String(ist.getUTCMinutes()).padStart(2,'0')}`,
      };
    }
    const now = new Date();
    const end = istParts(now);
    const start = istParts(new Date(now.getTime() - 3600000));
    setRangeEndDate(end.date);
    setRangeEndTime(end.time);
    setRangeStartDate(start.date);
    setRangeStartTime(start.time);
  }, []);

  const bboxCentroid = bbox
    ? { lat: (bbox.latMin + bbox.latMax) / 2, lon: (bbox.lonMin + bbox.lonMax) / 2 }
    : undefined;

  /* Auto-populate chain in topological order when bbox appears */
  /* Skip: predict (synthesis), radar_fetch (tile-only, no points), space_weather (global) */
  useEffect(() => {
    if (autoMode && bbox && !autoPopulatedRef.current) {
      autoPopulatedRef.current = true;
      const midLat = ((bbox.latMin + bbox.latMax) / 2).toFixed(4);
      const midLon = ((bbox.lonMin + bbox.lonMax) / 2).toFixed(4);
      const params = JSON.stringify({
        lat: parseFloat(midLat), lon: parseFloat(midLon),
        latMin: bbox.latMin, latMax: bbox.latMax, lonMin: bbox.lonMin, lonMax: bbox.lonMax,
      }, null, 1);
      setChain(AVAILABLE_TOOLS.filter(t => !TOOL_WORKBENCH_SKIPPED_TOOLS.has(t.name)).map((t, i) => ({
        tool: t.name,
        params,
        id: `step_auto_${Date.now()}_${i}`,
      })));
    }
  }, [bbox, autoMode]);

  function bboxParams(): string {
    if (!bbox) return '{"lat":35,"lon":140}';
    const midLat = ((bbox.latMin + bbox.latMax) / 2).toFixed(4);
    const midLon = ((bbox.lonMin + bbox.lonMax) / 2).toFixed(4);
    return JSON.stringify({
      lat: parseFloat(midLat), lon: parseFloat(midLon),
      latMin: bbox.latMin, latMax: bbox.latMax, lonMin: bbox.lonMin, lonMax: bbox.lonMax,
    }, null, 1);
  }

  function addTool(name: string) {
    setChain(prev => [...prev, { tool: name, params: bboxParams(), id: `step_${Date.now()}_${prev.length}` }]);
  }
  function removeStep(id: string) { setChain(prev => prev.filter(s => s.id !== id)); }
  function moveStep(from: number, to: number) {
    if (to < 0 || to >= chain.length) return;
    const next = [...chain]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); setChain(next);
  }
  function updateParams(id: string, params: string) {
    setChain(prev => prev.map(s => s.id === id ? { ...s, params } : s));
  }

  /* ── Physics surrogates run inline at each relevant step ── */
  const runPhysicsForStep = useCallback((toolId: string, evidence: Record<string, number>, params: Record<string, unknown>) => {
    const results: PhysicsInline[] = [];

    if ((toolId === 'earthquakes' || toolId === 'seismic_events') && (evidence.earthquakes > 0.01 || evidence.seismic_events > 0.01)) {
      const pga = (params.pga_gal as number) ?? 200;
      const depth = (params.depth_km as number) ?? 10;
      const r = computeLiquefaction({
        peakGroundAccel: pga / 981, totalStress: depth * 18, effectiveStress: depth * 12,
        depth, sptBlowCount: (params.spt_blowcount as number) ?? 15, finesContent: 20,
      });
      results.push({
        model: `Seed-Idriss Liquefaction (FS=${r.fs})`,
        metrics: [
          { label: 'CSR/CRR', value: `${r.csr}/${r.crr}` },
          { label: 'P(liq)', value: `${(r.probLiquefaction * 100).toFixed(0)}%` },
        ],
        color: r.triggered ? '#ef4444' : '#10b981',
      });
    }

    if (toolId === 'weather_forecast' && evidence.weather_forecast > 0.01) {
      const r = computeDispersion({
        emissionRate: 10000, windSpeed: (params.windSpeed as number) ?? 5,
        windDirection: (params.windDir as number) ?? 270, stackHeight: 50, plumeRise: 30,
        downwindDist: 5000, crosswindDist: 0, solarRadiation: 300, cloudCover: 3,
      });
      results.push({
        model: `Gaussian Plume (${r.stabilityClass})`,
        metrics: [
          { label: 'Conc.', value: `${r.concentration} μg/m³` },
          { label: 'x_max', value: `${r.xMax}m` },
        ],
        color: '#8b5cf6',
      });
    }

    if ((toolId === 'wildfires' || toolId === 'firms_fires') && (evidence.wildfires > 0.01 || evidence.firms_fires > 0.01)) {
      const r = computeWildfireSpread({
        windSpeed: (params.windSpeed as number) ?? 10, windDirection: (params.windDir as number) ?? 270,
        slope: (params.slope as number) ?? 15, fuelMoisture: (params.fuelMoisture as number) ?? 80,
        deadFuelMoisture: (params.deadFuelMoisture as number) ?? 8,
        relativeHumidity: (params.humidity as number) ?? 25, temperature: (params.temperature as number) ?? 35,
      });
      results.push({
        model: `Rothermel FBP (${r.dangerLevel})`,
        metrics: [
          { label: 'ROS', value: `${r.ros} m/min` },
          { label: 'Intensity', value: `${r.intensity} kW/m` },
        ],
        color: r.dangerLevel === 'extreme' || r.dangerLevel === 'high' ? '#ef4444' : '#f59e0b',
      });
    }

    if (toolId === 'floods' && evidence.floods > 0.01) {
      const r = computeFloodRouting({
        discharge: ((params.precip as number) ?? 50) * 10, channelWidth: 30,
        channelSlope: 0.005, manningRoughness: 0.035,
      });
      results.push({
        model: `Manning Kinematic (${r.regime})`,
        metrics: [
          { label: 'Q', value: `${r.peakDischarge} m³/s` },
          { label: 'Fr', value: `${r.froudeNumber}` },
        ],
        color: '#06b6d4',
      });
    }

    if (toolId === 'flood_forecast' && evidence.flood_forecast > 0.01) {
      const discharge = (params.river_discharge as number) ?? ((params.daily as Record<string, unknown>)?.river_discharge as number[])?.[0] ?? 500;
      const r = computeFloodRouting({
        discharge: Number(discharge), channelWidth: 30,
        channelSlope: 0.005, manningRoughness: 0.035,
      });
      results.push({
        model: `Forecast Routing (Q=${Number(discharge).toFixed(0)} m³/s)`,
        metrics: [
          { label: 'Peak Q', value: `${r.peakDischarge} m³/s` },
          { label: 'Fr', value: `${r.froudeNumber}` },
        ],
        color: r.froudeNumber > 1 ? '#ef4444' : '#06b6d4',
      });
    }

    if (toolId === 'air_quality' && evidence.air_quality > 0.01) {
      const r = computeDispersion({
        emissionRate: 5000, windSpeed: (params.windSpeed as number) ?? 5,
        windDirection: (params.windDir as number) ?? 270, stackHeight: 30, plumeRise: 20,
        downwindDist: 3000, crosswindDist: 0, solarRadiation: 300, cloudCover: 3,
      });
      results.push({
        model: `AQ Dispersion (${r.stabilityClass})`,
        metrics: [
          { label: 'Conc.', value: `${r.concentration} μg/m³` },
          { label: 'Max at', value: `${r.xMax}m` },
        ],
        color: r.concentration > 100 ? '#ef4444' : '#84cc16',
      });
    }

    if (results.length > 0) {
      setPhysicsInline(prev => ({ ...prev, [toolId]: results[0] })); // show primary model
    }
  }, []);

  /* ── Execute chain ── */
  async function executeChain() {
    setExecuting(true);
    setFormattedResults({});
    setPhysicsInline({});
    setCausalProbs({});
    setCausalState(null);
    const cumulativeEvidence: Record<string, number> = {};
    const currentChain = [...chain];
    const latestProbs: Record<string, number> = {};
    // Collect raw results for GIS fusion — NOT pre-extracted points
    const toolRawResults: Record<string, Record<string, unknown>> = {};
    const duplicateTools = new Set<string>();

    for (let i = 0; i < currentChain.length; i++) {
      if (!mountedRef.current) return;
      const step = currentChain[i];

      let params: Record<string, unknown> = {};
      try { params = JSON.parse(step.params); } catch { params = {}; }

      // Inject common date/time range into every step
      // Convert user's local dates to UTC — user enters dates in their timezone (e.g. IST UTC+5:30)
      // but APIs interpret dates in UTC. toISOString() gives us the correct UTC date.
      // e.g. IST "July 3 00:00" → UTC "July 2 18:30" → API sees "2026-07-02"
      if (rangeStartDate) {
        const userDate = new Date(`${rangeStartDate}T${rangeStartTime || '00:00'}`);
        params.startDate = userDate.toISOString().slice(0, 10);
        params.startTime = userDate.toISOString().slice(11, 16);
      }
      if (rangeEndDate) {
        const userDate = new Date(`${rangeEndDate}T${rangeEndTime || '23:59'}`);
        params.endDate = userDate.toISOString().slice(0, 10);
        params.endTime = userDate.toISOString().slice(11, 16);
      }

      // Inject cumulative evidence from upstream tools
      const io = getToolIO(step.tool);
      if (io) {
        for (const input of io.inputs) {
          if (cumulativeEvidence[input] !== undefined) params[input] = cumulativeEvidence[input];
        }
      }

      try {
        // predict: synthesize from chain evidence instead of calling external ML API
        if (step.tool === 'predict') {
          const preds = Object.entries(cumulativeEvidence)
            .filter(([k]) => !k.startsWith('_'))
            .map(([key, val]) => {
              const p = typeof val === 'number' ? val : 0.5;
              return {
                hazardType: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                probability: Math.min(0.99, Math.max(0.01, p)),
                severity: p > 0.6 ? 'high' : p > 0.3 ? 'medium' : 'low',
                timeframe: 'now',
                confidence: 0.85,
                source: 'chain-evidence',
              };
            })
            .sort((a, b) => b.probability - a.probability);
          const synData = { predictions: preds, source: 'chain-evidence' };
          setFormattedResults(prev => ({ ...prev, [step.id]: formatStepResult(step.tool, synData, 0) }));
          continue; // skip to next step — no points to extract from predict
        }

        const direct = DIRECT_API[step.tool];
        let data: Record<string, unknown>;
        let directData: Record<string, unknown> | null = null;
        let latencyMs = 0;

        if (direct) {
          const start = Date.now();
          let resp: Response;
          if (direct.method === 'POST') {
            const body = direct.transform(params);
            resp = await fetch(direct.path, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeaders() },
              body: JSON.stringify(typeof body === 'string' ? JSON.parse(body) : body),
            });
          } else {
            resp = await fetch(direct.path + (direct.transform(params) as string));
          }
          latencyMs = Date.now() - start;
          directData = resp.ok ? await resp.json() : { error: `HTTP ${resp.status}` };
          data = { result: directData, latencyMs, toolUsed: step.tool, fallbackUsed: false };
        } else {
          const resp = await fetch('/api/tools/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ toolId: step.tool, params }),
          });
          data = resp.ok ? await resp.json() : { error: `HTTP ${resp.status}` };
          latencyMs = Number(data.latencyMs ?? 0);
        }

        if (!mountedRef.current) return;
        setFormattedResults(prev => ({ ...prev, [step.id]: formatStepResult(step.tool, (direct ? directData : data) as Record<string, unknown>, latencyMs) }));

        const rawResult = (data.result || data) as Record<string, unknown>;

        // Skip duplicate seismic_events if earthquakes already processed
        const isDuplicate = step.tool === 'seismic_events' && duplicateTools.has('earthquakes');
        duplicateTools.add(step.tool);

        if (rawResult && typeof rawResult === 'object' && !(rawResult as Record<string, unknown>).error && !isDuplicate) {
          // Store raw result for GIS fusion — normalize and decluster later
          toolRawResults[step.tool] = rawResult;

          // Extract evidence — output field values for downstream mappings
          const evidence = extractEvidence(rawResult, step.tool);
          Object.assign(cumulativeEvidence, evidence);

          // Compute composite risk from extracted evidence (hazard-aware normalization)
          const evidenceValues = Object.entries(evidence)
            .filter(([k]) => !k.startsWith('_'))
            .map(([, v]) => typeof v === 'number' ? v : 0)
            .filter(v => v > 0);
          if (evidenceValues.length > 0) {
            // Use top-k evidence values for composite risk
            const sorted = [...evidenceValues].sort((a, b) => b - a);
            const topK = sorted.slice(0, Math.min(3, sorted.length));
            const composite = topK.reduce((s, v) => s + v, 0) / topK.length;
            cumulativeEvidence[step.tool] = Math.min(1, Math.max(0.01, composite));
          } else if (evidence._composite !== undefined) {
            cumulativeEvidence[step.tool] = evidence._composite;
          }

          // Extract field-level evidence from known API response structures
          const rawR = rawResult as Record<string, unknown>;
          if (step.tool === 'weather_forecast') {
            const current = rawR.current as Record<string, unknown> | undefined;
            const cw = rawR.current_weather as Record<string, unknown> | undefined;
            const t = current?.temperature_2m ?? cw?.temperature;
            const w = current?.wind_speed_10m ?? cw?.windspeed;
            const h = current?.relative_humidity_2m ?? rawR.humidity;
            if (t !== undefined) { cumulativeEvidence['temperature'] = Number(t); cumulativeEvidence['temp'] = Number(t); }
            if (w !== undefined) cumulativeEvidence['windSpeed'] = Number(w);
            if (h !== undefined) cumulativeEvidence['humidity'] = Number(h);
          }

          // Run physics surrogate inline for this step
          runPhysicsForStep(step.tool, cumulativeEvidence, params);

          // Causal propagation
          const loc = bboxCentroid ?? { lat: (params.lat as number) ?? 35, lon: (params.lon as number) ?? 140 };
          const probs = computeCausalProbabilities(cumulativeEvidence, true, loc);
          const fullState = computeFullCausalState(cumulativeEvidence, loc);
          Object.assign(latestProbs, probs);
          setCausalProbs(probs);
          setCausalState(fullState);
          writeCausalProbs(probs, fullState.topoOrder);

          // Pipe data to next step via causal edge mapping
          const nextStep = currentChain[i + 1];
          if (nextStep) {
            const mapping = getMapping(step.tool, nextStep.tool);
            if (mapping) {
              let nextParams: Record<string, unknown> = {};
              try { nextParams = JSON.parse(nextStep.params); } catch { nextParams = {}; }
              for (const [fromKey, toKey] of Object.entries(mapping)) {
                if (cumulativeEvidence[fromKey] !== undefined) nextParams[toKey] = cumulativeEvidence[fromKey];
              }
              currentChain[i + 1] = { ...nextStep, params: JSON.stringify(nextParams, null, 1) };
              setChain([...currentChain]);
            }
          }
        }
      } catch (e) {
        if (mountedRef.current) {
          setFormattedResults(prev => ({ ...prev, [step.id]: { status: 'error', label: 'Error', summary: String(e), metrics: [], latencyMs: 0, raw: '', timestamp: '' } }));
        }
      }
    }

    // After chain completes: GIS-based fusion using computeFusedSurface
    // This handles proper normalization, declustering, and distance computation
    try {
      if (mountedRef.current && onSurfaceData && bbox && Object.keys(toolRawResults).length > 0) {
        // Use the GIS fusion engine for proper spatial risk surface
        const fusedPoints = computeFusedSurface(toolRawResults, bbox);

        // Only render if we have enough points for IDW (>= 3)
        if (fusedPoints.length >= 3) {
          const fusedJson = JSON.stringify({
            features: fusedPoints.map(p => ({
              geometry: { coordinates: [p.lon, p.lat] },
              properties: { value: p.value },
            })),
            fused_risk: causalProbs,
            _surfaceMode: 'fused',
          });
          onSurfaceData('fused', fusedJson);
        }
      }
    } catch (e) {
      console.error('[Chain] GIS fusion error:', e);
    }

    if (mountedRef.current) setExecuting(false);
  }

  function exportChain() {
    const blob = new Blob([JSON.stringify(chain, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `toolchain-${Date.now()}.json`; a.click();
    setShowSaveDialog(true);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function label(s: string): string {
    return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  const categories = [...new Set(AVAILABLE_TOOLS.map(t => t.category))];

  const headerExtra = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 0 }}>
      {bbox && (
        <span style={{ fontSize: 8, color: '#5eead4' }}>
          [{bbox.latMin.toFixed(1)},{bbox.lonMin.toFixed(1)} → {bbox.latMax.toFixed(1)},{bbox.lonMax.toFixed(1)}]
        </span>
      )}
      {(['chain', 'whatif'] as const).map(tab => (
        <button key={tab} onClick={() => setActiveTab(tab)}
          style={{ padding: '2px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
            background: activeTab === tab ? 'rgba(139,92,246,0.4)' : 'transparent',
            border: 'none', borderRadius: 4, color: activeTab === tab ? '#8b5cf6' : '#475569' }}>
          {tab === 'chain' ? 'Chain' : 'What-If'}
        </button>
      ))}
    </div>
  );

  return (
    <Panel
      title="TOOL WORKBENCH"
      icon={<Wrench size={16} />}
      accentColor="#8b5cf6"
      iconColor="#a78bfa"
      titleColor="#c4b5fd"
      onClose={onClose}
      headerExtra={headerExtra}
      headerHeight="44px"
      headerBackground="linear-gradient(135deg, rgba(139,92,246,0.2), rgba(139,92,246,0.15)), rgba(10,10,30,0.95)"
      style={{ background: 'transparent', backdropFilter: 'none', WebkitBackdropFilter: 'none' }}
    >

      {activeTab === 'chain' ? (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {/* Tool Palette */}
          <div style={{ width: 130, borderRight: '1px solid var(--border)', overflow: 'auto', padding: 6, background: 'transparent' }}>
            <div onClick={() => setAutoMode(!autoMode)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, fontSize: 10, fontWeight: 600,
                color: autoMode ? 'var(--accent)' : 'var(--text-dim)', cursor: 'pointer', userSelect: 'none',
                padding: '3px 6px', borderRadius: 4, background: 'rgba(10,10,30,0.92)', border: '1px solid var(--border)' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, fontSize: 8, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                background: autoMode ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)',
                border: '1px solid ' + (autoMode ? 'rgba(34,197,94,0.3)' : 'var(--border)') }}>
                {autoMode ? '✓' : ''}
              </span>
              Auto (topo order)
            </div>
            {categories.map(cat => (
              <div key={cat} style={{ marginBottom: 6, padding: '4px 6px', borderRadius: 4, background: 'rgba(10,10,30,0.92)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 8, color: '#94a3b8', marginBottom: 4, textTransform: 'uppercase', fontWeight: 600 }}>{cat}</div>
                {AVAILABLE_TOOLS.filter(t => t.category === cat).map(tool => {
                  const meta = TOOL_META[tool.name];
                  return (
                    <div key={tool.name} onClick={() => addTool(tool.name)}
                      style={{ padding: '3px 6px', fontSize: 9, cursor: 'pointer', borderRadius: 4, marginBottom: 2,
                        display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(10,10,30,0.92)',
                        border: '1px solid var(--border)', color: 'var(--text)', transition: 'all 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(10,10,30,0.92)')}
                      title={tool.description}>
                      <span style={{ width: 18, height: 14, borderRadius: 3, fontSize: 7, fontWeight: 700,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                        background: (meta?.color ?? '#666') + '22', color: meta?.color ?? '#666' }}>
                        {meta?.code ?? '?'}
                      </span>
                      {label(tool.name)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Chain Builder */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, background: 'rgba(10,10,30,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
            <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600,
              color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Chain</span>
              {causalState && (
                <span style={{ fontSize: 8, color: 'var(--teal)' }}>
                  info gain: {causalState.informationGain.toFixed(3)} bits
                </span>
              )}
            </div>

            {/* Common date/time range for all steps */}
            <div style={{ display: 'flex', gap: 6, padding: '4px 10px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
              <span style={{ fontSize: 8, fontWeight: 600, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>Date Range</span>
              <input type="date" value={rangeStartDate} onChange={e => setRangeStartDate(e.target.value)}
                style={{ flex: 1, fontSize: 8, padding: '1px 4px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', outline: 'none' }}
                placeholder="Start date" />
              <input type="time" value={rangeStartTime} onChange={e => setRangeStartTime(e.target.value)}
                style={{ width: 95, fontSize: 8, padding: '1px 4px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', outline: 'none' }} />
              <span style={{ fontSize: 8, color: 'var(--text-dim2)' }}>→</span>
              <input type="date" value={rangeEndDate} onChange={e => setRangeEndDate(e.target.value)}
                style={{ flex: 1, fontSize: 8, padding: '1px 4px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', outline: 'none' }}
                placeholder="End date" />
              <input type="time" value={rangeEndTime} onChange={e => setRangeEndTime(e.target.value)}
                style={{ width: 95, fontSize: 8, padding: '1px 4px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', outline: 'none' }} />
            </div>

            {chain.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)' }}>
                {!bbox ? (
                  <>
                    <div style={{ fontSize: 20, marginBottom: 8, opacity: 0.4 }}>◇</div>
                    <div>Draw a <strong>Study Area</strong> on the globe first</div>
                    <div style={{ marginTop: 4, fontSize: 9, color: 'var(--text-dim2)' }}>
                      Click the <strong>Crosshair</strong> icon to define your area of interest
                    </div>
                  </>
                ) : (
                  <>Click tools on the left to build a chain</>
                )}
              </div>
            ) : (
              <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
                {chain.map((step, i) => {
                  const meta = TOOL_META[step.tool];
                  const phys = physicsInline[step.tool];
                  const res = formattedResults[step.id];
                  const prob = causalProbs[step.tool];
                  return (
                    <div key={step.id} style={{ padding: '6px 8px', marginBottom: 4, borderRadius: 6,
                      background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                      borderLeft: `3px solid ${meta?.color ?? 'var(--accent)'}` }}>
                      {/* Header row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                        <span style={{ width: 20, height: 16, borderRadius: 3, fontSize: 7, fontWeight: 700,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                          background: (meta?.color ?? '#666') + '22', color: meta?.color ?? '#666' }}>
                          {meta?.code ?? '?'}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)' }}>{label(step.tool)}</span>
                        {prob !== undefined && (
                          <span style={{ marginLeft: 4, fontSize: 8, fontWeight: 600,
                            color: prob > 0.6 ? 'var(--danger)' : prob > 0.3 ? 'var(--warning)' : 'var(--teal)' }}>
                            {(prob * 100).toFixed(0)}%
                          </span>
                        )}
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                          <button onClick={() => moveStep(i, i - 1)} disabled={i === 0}
                            style={{ fontSize: 9, padding: '1px 4px', background: 'none', border: '1px solid var(--border)',
                              borderRadius: 3, color: 'var(--text-dim)', cursor: i === 0 ? 'default' : 'pointer',
                              opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                          <button onClick={() => moveStep(i, i + 1)} disabled={i === chain.length - 1}
                            style={{ fontSize: 9, padding: '1px 4px', background: 'none', border: '1px solid var(--border)',
                              borderRadius: 3, color: 'var(--text-dim)', cursor: i === chain.length - 1 ? 'default' : 'pointer',
                              opacity: i === chain.length - 1 ? 0.3 : 1 }}>↓</button>
                          <button onClick={() => removeStep(step.id)}
                            style={{ fontSize: 9, padding: '1px 4px', background: 'none',
                              border: '1px solid rgba(239,68,68,0.3)', borderRadius: 3, color: 'var(--danger)', cursor: 'pointer' }}>✕</button>
                        </div>
                      </div>
                      {/* Params */}
                      <input value={step.params} onChange={e => updateParams(step.id, e.target.value)}
                        style={{ width: '100%', fontSize: 8, padding: '2px 4px', marginTop: 2, marginBottom: 2,
                          background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
                          borderRadius: 3, color: 'var(--text-dim)', fontFamily: 'monospace', outline: 'none',
                          boxSizing: 'border-box' }}
                        placeholder='Auto from study area' spellCheck={false} />

                      {/* Data flow arrow */}
                      {i < chain.length - 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 0', marginLeft: 8 }}>
                          <span style={{ color: 'var(--teal)', fontSize: 9 }}>↓</span>
                          <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>→ {label(chain[i + 1].tool)}</span>
                        </div>
                      )}
                      {/* Result */}
                      {res && (
                        <div style={{ marginTop: 4, borderRadius: 6, overflow: 'hidden',
                          border: '1px solid ' + (res.status === 'error' ? 'rgba(239,68,68,0.3)' : res.status === 'synthetic' ? 'rgba(250,204,21,0.3)' : 'rgba(34,197,94,0.3)') }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
                            background: res.status === 'error' ? 'rgba(239,68,68,0.08)' : res.status === 'synthetic' ? 'rgba(250,204,21,0.08)' : 'rgba(34,197,94,0.08)', fontSize: 8 }}>
                            <span style={{ width: 14, height: 14, borderRadius: '50%', display: 'inline-flex',
                              alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700,
                              background: res.status === 'error' ? 'rgba(239,68,68,0.2)' : res.status === 'synthetic' ? 'rgba(250,204,21,0.2)' : 'rgba(34,197,94,0.2)',
                              color: res.status === 'error' ? 'var(--danger)' : res.status === 'synthetic' ? '#eab308' : '#22c55e' }}>
                              {res.status === 'error' ? '✕' : res.status === 'synthetic' ? '⚠' : '✓'}
                            </span>
                            <span style={{ color: res.status === 'error' ? 'var(--danger)' : res.status === 'synthetic' ? '#eab308' : '#22c55e', fontWeight: 600 }}>
                              {res.label}
                            </span>
                            {res.timestamp && (
                              <span style={{ color: 'var(--text-dim2)', fontSize: 7, marginLeft: 4 }}>{res.timestamp}</span>
                            )}
                            <span style={{ color: 'var(--text-dim2)', marginLeft: 'auto' }}>{res.latencyMs}ms</span>
                          </div>
                          <div style={{ padding: '4px 6px', fontSize: 8, color: 'var(--text)' }}>{res.summary}</div>
                          {res.metrics.length > 0 && (
                            <div style={{ padding: '2px 6px 4px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 12px', fontSize: 8 }}>
                              {res.metrics.map((m, mi) => (
                                <div key={mi} style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                                  <span style={{ color: 'var(--text-dim)' }}>{m.label}</span>
                                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>{m.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Physics inline */}
                      {phys && (
                        <div style={{ marginTop: 3, padding: '3px 6px', borderRadius: 4, fontSize: 8,
                          background: `${phys.color}11`, border: `1px solid ${phys.color}33` }}>
                          <span style={{ color: phys.color, fontWeight: 600 }}>🔬 {phys.model}</span>
                          {phys.metrics.map((m, mi) => (
                            <span key={mi} style={{ marginLeft: 6, color: 'var(--text-dim)' }}>
                              {m.label}=<strong style={{ color: 'var(--text)' }}>{m.value}</strong>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Final fused result banner */}
                {Object.keys(causalProbs).length > 0 && !executing && (
                  <div style={{ padding: '8px 10px', marginTop: 6, borderRadius: 8,
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(139,92,246,0.08))',
                    border: '1px solid rgba(59,130,246,0.2)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>
                      📊 Fused Risk Assessment
                    </div>
                    <div style={{ fontSize: 8, color: 'var(--text-dim)', marginBottom: 4 }}>
                      {(() => {
                        const chainTools = new Set(chain.map(s => s.tool));
                        const chainNodeCount = Object.keys(causalProbs).filter(k => chainTools.has(k) && !k.startsWith('_')).length;
                        return `Topological-order Noisy-OR propagation across ${chainNodeCount} chain nodes`;
                      })()}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px 8px', fontSize: 8 }}>
                      {(() => {
                        // Only show nodes that are in the chain
                        const chainTools = new Set(chain.map(s => s.tool));
                        return Object.entries(causalProbs)
                          .filter(([k]) => k !== '_composite' && k !== '_confidence' && chainTools.has(k))
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 9)
                          .map(([id, prob]) => (
                            <div key={id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-dim)' }}>{label(id)}</span>
                              <span style={{ fontWeight: 600,
                                color: prob > 0.6 ? 'var(--danger)' : prob > 0.3 ? 'var(--warning)' : 'var(--teal)' }}>
                                {(prob * 100).toFixed(0)}%
                              </span>
                            </div>
                          ));
                      })()}
                    </div>
                    {bbox && (
                      <div style={{ marginTop: 6, fontSize: 8, color: 'var(--teal)', fontWeight: 600 }}>
                        ✓ IDW surface rendered on globe — rotate to explore risk gradients
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* Actions */}
            <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
              <button onClick={executeChain} disabled={chain.length === 0 || executing}
                style={{ padding: '4px 12px', fontSize: 10, fontWeight: 600,
                  cursor: chain.length === 0 || executing ? 'default' : 'pointer',
                  background: 'linear-gradient(135deg, var(--accent), var(--purple))', border: 'none',
                  borderRadius: 6, color: '#fff', opacity: chain.length === 0 || executing ? 0.5 : 1 }}>
                {executing ? '⏳ Executing...' : '▶ Run Chain'}
              </button>
              <button onClick={exportChain} disabled={chain.length === 0}
                style={{ padding: '4px 10px', fontSize: 10, background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)',
                  cursor: chain.length === 0 ? 'default' : 'pointer', opacity: chain.length === 0 ? 0.3 : 1 }}>
                Export
              </button>
              <button onClick={() => { setChain([]); autoPopulatedRef.current = false; setFormattedResults({});
                setPhysicsInline({}); setCausalProbs({}); setCausalState(null); setScenarioDiffs([]); setSelectedScenario(null);
                onClear?.(); }}
                style={{ padding: '4px 10px', fontSize: 10, background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: 'var(--danger)', cursor: 'pointer' }}>
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* What-If Tab */
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: 10 }}>
          {!selectedScenario ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>What-If Scenarios</div>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 10 }}>
                Select a scenario to see cascading risk impact via Noisy-OR CBN
              </div>
              {causalState && (
                <div style={{ fontSize: 8, color: 'var(--text-dim2)', marginBottom: 8, padding: '4px 8px',
                  background: 'rgba(255,255,255,0.03)', borderRadius: 4, border: '1px solid var(--border)' }}>
                  Info gain: {causalState.informationGain.toFixed(3)} bits | Nodes: {Object.keys(causalState.beliefs).length}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexDirection: 'column' }}>
                {getDefaultScenarios().map(sc => (
                  <div key={sc.id} onClick={() => {
                    setSelectedScenario(sc);
                    if (Object.keys(causalProbs).length > 0) setScenarioDiffs(rolloutScenario(sc, causalProbs, bboxCentroid));
                  }}
                    style={{ padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 10,
                      background: 'rgba(59,130,246,0.06)', border: '1px solid var(--border)',
                      color: 'var(--text)', transition: 'all 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.15)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.06)')}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{sc.name}</div>
                    <div style={{ fontSize: 8, color: 'var(--text-dim)' }}>{sc.description}</div>
                    <div style={{ fontSize: 8, color: 'var(--text-dim2)', marginTop: 4 }}>
                      Affects: {Object.keys(sc.evidence).map(label).join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <button onClick={() => { setSelectedScenario(null); setScenarioDiffs([]); }}
                  style={{ padding: '2px 8px', fontSize: 9, background: 'none', border: '1px solid var(--border)',
                    borderRadius: 4, color: 'var(--text-dim)', cursor: 'pointer' }}>← Back</button>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{selectedScenario.name}</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 8 }}>{selectedScenario.description}</div>
              <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Cascading Risk Impact</div>
              {scenarioDiffs.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {scenarioDiffs.slice(0, 8).map(d => (
                    <div key={d.toolId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                      background: 'rgba(255,255,255,0.03)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 9 }}>
                      <span style={{ width: 22, height: 16, borderRadius: 3, fontSize: 7, fontWeight: 700,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                        background: (TOOL_META[d.toolId]?.color ?? '#666') + '22', color: TOOL_META[d.toolId]?.color ?? '#666' }}>
                        {TOOL_META[d.toolId]?.code ?? '?'}
                      </span>
                      <span style={{ width: 120, color: 'var(--text)' }}>{d.label || label(d.toolId)}</span>
                      <span style={{ color: 'var(--text-dim2)' }}>{(d.baseProb * 100).toFixed(0)}%</span>
                      <span style={{ color: 'var(--text-dim2)' }}>→</span>
                      <span style={{ fontWeight: 600, color: d.delta > 0 ? 'var(--danger)' : 'var(--teal)' }}>
                        {(d.scenarioProb * 100).toFixed(0)}%
                      </span>
                      <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 8,
                        color: d.delta > 0 ? 'var(--danger)' : 'var(--teal)' }}>
                        {d.delta > 0 ? '+' : ''}{(d.delta * 100).toFixed(1)}pp
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: 12, fontSize: 9, color: 'var(--text-dim2)', textAlign: 'center',
                  border: '1px dashed var(--border)', borderRadius: 6 }}>
                  Run the chain first to see real impact deltas
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showSaveDialog && (
        <div className="share-dialog active" onClick={() => setShowSaveDialog(false)}>
          <div className="share-dialog-content" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Chain exported!</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Saved to downloads as toolchain-{Date.now()}.json</div>
          </div>
        </div>
      )}
    </Panel>
  );
}
