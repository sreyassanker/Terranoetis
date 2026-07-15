import { authHeaders } from '@/context/AuthContext';
import * as Cesium from 'cesium';
import { addGenericPointEntities, type PointItem } from './weather';
import { LAYER_CATEGORIES } from '@/config/layerConfig';
import { throttledRender } from '@/lib/throttledRender';

// ═══════════════════════════════════════════════════════════════════════
// Tier Layer Renderer — Renders Tier 1-3 point-based layers on the globe
// ═══════════════════════════════════════════════════════════════════════

// API endpoints for fetching layer data
const LAYER_API_MAP: Record<string, (lat: number, lon: number) => string> = {
  acled_conflict: (_lat, _lon) => `/api/acled/recent?days=30&limit=100`,
  era5_climate: (lat, lon) => `/api/era5/historical?lat=${lat}&lon=${lon}&start=2024-01-01&end=2024-06-01`,
  guardian_iono: (lat, lon) => `/api/guardian/anomalies?lat=${lat}&lon=${lon}`,
  cmems_ocean: (lat, lon) => `/api/cmems/ocean?lat=${lat}&lon=${lon}`,
  wavewatch_iii: (lat, lon) => `/api/wavewatch/forecast?lat=${lat}&lon=${lon}`,
  satclip_embedding: (lat, lon) => `/api/satclip/similar?lat=${lat}&lon=${lon}&radius=500&limit=50`,
  geographrag: (lat, lon) => `/api/geographrag/spatial?lat=${lat}&lon=${lon}&radius=500`,
  opera_water: (lat, lon) => `/api/opera/water?lat=${lat}&lon=${lon}`,
  landsat_sentinel_hls: (lat, lon) => `/api/hls/scenes?lat=${lat}&lon=${lon}&startDate=2024-01-01&endDate=2024-06-01`,
};

// Response extractors — extract point arrays from different API response shapes
const LAYER_EXTRACTORS: Record<string, (data: unknown) => PointItem[]> = {
  acled_conflict: (data: unknown) => {
    const d = data as Record<string, unknown>;
    const events = (d.events || d.recentEvents || []) as Record<string, unknown>[];
    return events.map(e => ({
      name: `${e.event_type || 'Event'} — ${e.country || ''}`,
      lat: Number(e.latitude || 0),
      lon: Number(e.longitude || 0),
      ...e,
    }));
  },
  era5_climate: (data: unknown) => {
    const d = data as Record<string, unknown>;
    const daily = (d.daily || d.timeSeries || []) as Record<string, unknown>[];
    return daily.slice(0, 30).map((d2, i) => ({
      name: `Day ${i + 1}`,
      lat: Number((d2 as Record<string, unknown>).latitude ?? 0),
      lon: Number((d2 as Record<string, unknown>).longitude ?? 0),
      ...d2,
    }));
  },
  guardian_iono: (data: unknown) => {
    const d = data as Record<string, unknown>;
    const anomalies = (d.anomalies || d.conditions || []) as Record<string, unknown>[];
    return anomalies.map(a => ({
      name: String(a.type || a.name || 'Anomaly'),
      lat: Number(a.latitude || 0),
      lon: Number(a.longitude || 0),
      ...a,
    }));
  },
  cmems_ocean: (data: unknown) => {
    const d = data as Record<string, unknown>;
    const vars = (d.variables || d.data || []) as Record<string, unknown>[];
    return vars.map(v => ({
      name: String(v.name || v.variable || 'Variable'),
      lat: Number(v.latitude || 0),
      lon: Number(v.longitude || 0),
      ...v,
    }));
  },
  wavewatch_iii: (data: unknown) => {
    const d = data as Record<string, unknown>;
    const forecast = (d.forecast || d.waves || []) as Record<string, unknown>[];
    return forecast.map(f => ({
      name: String(f.time || 'Forecast'),
      lat: Number(f.latitude || 0),
      lon: Number(f.longitude || 0),
      ...f,
    }));
  },
  satclip_embedding: (data: unknown) => {
    const d = data as Record<string, unknown>;
    const context = (d.context || d.similar || []) as Record<string, unknown>[];
    return context.map(c => ({
      name: String(c.name || c.place || 'Location'),
      lat: Number(c.lat || 0),
      lon: Number(c.lon || 0),
      ...c,
    }));
  },
  geographrag: (data: unknown) => {
    const d = data as Record<string, unknown>;
    const entities = (d.entities || d.context || []) as Record<string, unknown>[];
    return entities.map(e => ({
      name: String(e.name || e.entity || 'Entity'),
      lat: Number(e.lat || 0),
      lon: Number(e.lon || 0),
      ...e,
    }));
  },
  opera_water: (data: unknown) => {
    const d = data as Record<string, unknown>;
    const extents = (d.extents || d.timeSeries || []) as Record<string, unknown>[];
    return extents.map(e => ({
      name: String(e.date || e.label || 'Observation'),
      lat: Number(e.latitude || 0),
      lon: Number(e.longitude || 0),
      ...e,
    }));
  },
  landsat_sentinel_hls: (data: unknown) => {
    const d = data as Record<string, unknown>;
    const scenes = (d.scenes || d.features || []) as Record<string, unknown>[];
    return scenes.map(s => ({
      name: String(s.id || s.name || 'Scene'),
      lat: Number(s.lat || 0),
      lon: Number(s.lon || 0),
      ...s,
    }));
  },
};

// ═══════════════════════════════════════════════════════════════════════
// Main renderer function
// ═══════════════════════════════════════════════════════════════════════

export async function renderTierLayer(
  viewer: Cesium.Viewer,
  layerId: string,
  centerLat: number = 20,
  centerLon: number = 78,
): Promise<Cesium.Entity[]> {
  const layer = LAYER_CATEGORIES.find(l => l.id === layerId);
  if (!layer) return [];

  const apiBuilder = LAYER_API_MAP[layerId];
  const extractor = LAYER_EXTRACTORS[layerId];

  if (!apiBuilder || !extractor) {
    // No API endpoint — render empty
    return [];
  }

  try {
    const url = apiBuilder(centerLat, centerLon);
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
    const headers: Record<string, string> = authHeaders();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetch(url, { headers: authHeaders() });
    if (!resp.ok) return [];

    const data = await resp.json();
    const items = extractor(data);
    if (items.length === 0) return [];

    const layerConfig = LAYER_CATEGORIES.find(l => l.id === layerId);
    const color = layerConfig?.color || '#3b82f6';

    const entities = addGenericPointEntities(viewer, items, layerId, {
      iconColor: color,
      labelField: 'name',
      iconSize: 14,
    });

    throttledRender(viewer);
    return entities;
  } catch (err) {
    console.warn(`[TierLayer] Failed to render ${layerId}:`, err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Check if a layer ID is a Tier 1-3 point layer
// ═══════════════════════════════════════════════════════════════════════

export function isTierLayer(layerId: string): boolean {
  return layerId in LAYER_API_MAP;
}
