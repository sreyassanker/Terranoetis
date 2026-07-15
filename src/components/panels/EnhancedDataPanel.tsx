import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Search, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, Clock, Globe } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { authHeaders } from '@/context/AuthContext';

interface DataItem {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'warning' | 'error' | 'inactive';
  lastUpdated: string;
  value?: string | number;
  unit?: string;
  coordinates?: { lat: number; lon: number };
  metadata?: Record<string, unknown>;
}

interface EnhancedDataPanelProps {
  layerId: string;
  onClose: () => void;
  centerLat?: number;
  centerLon?: number;
}

const LAYER_CONFIG: Record<string, { title: string; icon: string; color: string; description: string; dataSource: string }> = {
  era5_climate: { title: 'ERA5 Climate Reanalysis', icon: '🌤', color: '#0ea5e9', description: 'ECMWF ERA5 global climate reanalysis data', dataSource: 'https://cds.climate.copernicus.eu/' },
  coral_reef_watch: { title: 'NOAA Coral Reef Watch', icon: '🪸', color: '#f472b6', description: 'Coral reef bleaching risk monitoring', dataSource: 'https://coralreefwatch.noaa.gov/' },
  guardian_iono: { title: 'GUARDIAN Ionospheric', icon: '📡', color: '#a855f7', description: 'Ionospheric disturbance monitoring', dataSource: 'https://www.dtic.mil/guardian/' },
  cmems_ocean: { title: 'CMEMS Ocean', icon: '🌊', color: '#06b6d4', description: 'Copernicus Marine Service data', dataSource: 'https://marine.copernicus.eu/' },
  wavewatch_iii: { title: 'WAVEWATCH III', icon: '🌊', color: '#0891b2', description: 'NOAA wave model forecasts', dataSource: 'https://polar.ncep.noaa.gov/waves/' },
  satclip_embedding: { title: 'SatCLIP Locations', icon: '📍', color: '#10b981', description: 'Location embeddings for coordinates', dataSource: 'https://github.com/microsoft/satclip' },
  geographrag: { title: 'GeoGraphRAG', icon: '🗺️', color: '#8b5cf6', description: 'Spatial knowledge graph', dataSource: 'Internal' },
  flatgeobuf_stream: { title: 'FlatGeobuf Stream', icon: '📦', color: '#f59e0b', description: 'HTTP Range-request vector tiles', dataSource: 'https://flatgeobuf.org/' },
  opera_water: { title: 'OPERA Surface Water', icon: '💧', color: '#3b82f6', description: 'NASA flood extent detection', dataSource: 'https://www.jpl.nasa.gov/go/opera' },
  landsat_sentinel_hls: { title: 'Landsat+Sentinel HLS', icon: '🛰️', color: '#22c55e', description: 'Harmonized Landsat-Sentinel imagery', dataSource: 'https://lpdaac.usgs.gov/products/hlss30v002/' },
  military_symbology: { title: 'MIL-STD-2525D Symbology', icon: '🎖️', color: '#ef4444', description: 'Military symbology overlay', dataSource: 'Internal' },
  cyber_symbology: { title: 'Cyber Symbology', icon: '🛡️', color: '#7c3aed', description: 'Cyber operations symbols', dataSource: 'Internal' },
  flood_inundation: { title: 'Flood Inundation', icon: '🌊', color: '#0284c7', description: 'Flood extent mapping', dataSource: 'Internal' },
  kill_chain_mitre: { title: 'MITRE ATT&CK', icon: '⚔️', color: '#dc2626', description: 'Threat actor tactics and techniques', dataSource: 'https://attack.mitre.org/' },
  webtransport_stream: { title: 'WebTransport Stream', icon: '⚡', color: '#14b8a6', description: 'HTTP/3 low-latency streaming', dataSource: 'Internal' },
  opentelemetry: { title: 'OpenTelemetry', icon: '📊', color: '#6366f1', description: 'Distributed tracing and observability', dataSource: 'Internal' },
  '9_openaq': { title: 'Open Air Quality', icon: '🌬️', color: '#10b981', description: 'Real-time air quality measurements worldwide', dataSource: 'https://openaq.org/' },
  '42_ndbc_buoy_data': { title: 'NDBC Weather Buoys', icon: '🌊', color: '#06b6d4', description: 'NOAA National Data Buoy Center observations', dataSource: 'https://www.ndbc.noaa.gov/' },
  '43_usgs_shakemap': { title: 'USGS ShakeMap', icon: '📉', color: '#f59e0b', description: 'USGS earthquake shaking intensity maps', dataSource: 'https://earthquake.usgs.gov/data/shakemap/' },
};

// ═══════════════════════════════════════════════════════════════════════
// API FETCH FUNCTIONS — Map layer IDs to real backend endpoints
// ═══════════════════════════════════════════════════════════════════════

async function fetchLayerData(layerId: string, lat: number, lon: number): Promise<DataItem[]> {
  const now = new Date().toISOString();

  switch (layerId) {
    // ── Phase 1: Tier 1 ──
    case 'acled_conflict': {
      const res = await fetch(`/api/acled/recent?days=30&limit=50`);
      if (!res.ok) throw new Error(`ACLED API error: ${res.status}`);
      const data = await res.json();
      const events = data.events || data.recentEvents || [];
      return events.map((e: Record<string, unknown>, i: number) => ({
        id: `acled-${i}`,
        name: `${e.event_type || 'Event'} — ${e.country || e.admin1 || 'Unknown'}`,
        type: 'point',
        status: Number(e.fatalities || 0) > 0 ? 'error' : e.event_type === 'Protests' ? 'warning' : 'active',
        lastUpdated: String(e.event_date || now),
        value: Number(e.fatalities || 0),
        unit: 'fatalities',
        coordinates: e.latitude && e.longitude ? { lat: Number(e.latitude), lon: Number(e.longitude) } : undefined,
        metadata: e,
      }));
    }

    case 'era5_climate': {
      const res = await fetch(`/api/era5/historical?lat=${lat}&lon=${lon}&start=2024-01-01&end=2024-06-01`);
      if (!res.ok) throw new Error(`ERA5 API error: ${res.status}`);
      const data = await res.json();
      const daily = data.daily || data.timeSeries || [];
      return daily.slice(0, 20).map((d: Record<string, unknown>, i: number) => ({
        id: `era5-${i}`,
        name: String(d.date || `Day ${i + 1}`),
        type: 'point',
        status: Number(d.temperature2m || 0) > 35 ? 'warning' : 'active',
        lastUpdated: String(d.date || now),
        value: d.temperature2m,
        unit: '°C',
        coordinates: { lat, lon },
        metadata: d,
      }));
    }

    case 'guardian_iono': {
      const res = await fetch(`/api/guardian/anomalies?lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error(`GUARDIAN API error: ${res.status}`);
      const data = await res.json();
      const anomalies = data.anomalies || data.conditions || [];
      return anomalies.map((a: Record<string, unknown>, i: number) => ({
        id: `guardian-${i}`,
        name: String(a.type || a.name || `Anomaly ${i + 1}`),
        type: 'point',
        status: a.severity === 'high' ? 'error' : a.severity === 'medium' ? 'warning' : 'active',
        lastUpdated: String(a.timestamp || now),
        value: a.tec_value || a.intensity,
        unit: 'TECU',
        coordinates: a.latitude && a.longitude ? { lat: Number(a.latitude), lon: Number(a.longitude) } : { lat, lon },
        metadata: a,
      }));
    }

    case 'cmems_ocean': {
      const res = await fetch(`/api/cmems/ocean?lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error(`CMEMS API error: ${res.status}`);
      const data = await res.json();
      const variables = data.variables || data.data || [];
      return variables.map((v: Record<string, unknown>, i: number) => ({
        id: `cmems-${i}`,
        name: String(v.name || v.variable || `Variable ${i + 1}`),
        type: 'point',
        status: 'active',
        lastUpdated: now,
        value: v.value,
        unit: v.unit || '',
        coordinates: { lat, lon },
        metadata: v,
      }));
    }

    case 'wavewatch_iii': {
      const res = await fetch(`/api/wavewatch/forecast?lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error(`WAVEWATCH API error: ${res.status}`);
      const data = await res.json();
      const forecast = data.forecast || data.waves || [];
      return forecast.map((w: Record<string, unknown>, i: number) => ({
        id: `ww3-${i}`,
        name: String(w.time || w.period || `Forecast ${i + 1}`),
        type: 'point',
        status: Number(w.wave_height || 0) > 3 ? 'warning' : 'active',
        lastUpdated: String(w.time || now),
        value: w.wave_height || w.height,
        unit: 'm',
        coordinates: { lat, lon },
        metadata: w,
      }));
    }

    // ── Phase 3: Tier 3 ──
    case 'satclip_embedding': {
      const res = await fetch(`/api/satclip/context?lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error(`SatCLIP API error: ${res.status}`);
      const data = await res.json();
      const context = data.context || data.similar || [];
      return context.map((c: Record<string, unknown>, i: number) => ({
        id: `satclip-${i}`,
        name: String(c.name || c.place || `Location ${i + 1}`),
        type: 'point',
        status: 'active',
        lastUpdated: now,
        value: c.similarity || c.distance,
        unit: c.similarity ? '' : 'km',
        coordinates: c.lat && c.lon ? { lat: Number(c.lat), lon: Number(c.lon) } : undefined,
        metadata: c,
      }));
    }

    case 'geographrag': {
      const res = await fetch(`/api/geographrag/context?q=infrastructure&lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error(`GeoGraphRAG API error: ${res.status}`);
      const data = await res.json();
      const entities = data.entities || data.context || [];
      return entities.map((e: Record<string, unknown>, i: number) => ({
        id: `ggrag-${i}`,
        name: String(e.name || e.entity || `Entity ${i + 1}`),
        type: 'point',
        status: 'active',
        lastUpdated: now,
        value: e.confidence,
        unit: '',
        coordinates: e.lat && e.lon ? { lat: Number(e.lat), lon: Number(e.lon) } : undefined,
        metadata: e,
      }));
    }

    case 'opera_water': {
      const res = await fetch(`/api/opera/water?lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error(`OPERA API error: ${res.status}`);
      const data = await res.json();
      const extents = data.extents || data.timeSeries || [];
      return extents.map((e: Record<string, unknown>, i: number) => ({
        id: `opera-${i}`,
        name: String(e.date || e.label || `Observation ${i + 1}`),
        type: 'point',
        status: e.water_detected === true ? 'warning' : 'active',
        lastUpdated: String(e.date || now),
        value: e.water_area_km2 || e.confidence,
        unit: e.water_area_km2 ? 'km²' : '',
        coordinates: { lat, lon },
        metadata: e,
      }));
    }

    case 'landsat_sentinel_hls': {
      const res = await fetch(`/api/hls/scenes?lat=${lat}&lon=${lon}&startDate=2024-01-01&endDate=2024-06-01`);
      if (!res.ok) throw new Error(`HLS API error: ${res.status}`);
      const data = await res.json();
      const scenes = data.scenes || data.features || [];
      return scenes.map((s: Record<string, unknown>, i: number) => ({
        id: `hls-${i}`,
        name: String(s.id || s.name || `Scene ${i + 1}`),
        type: 'point',
        status: Number(s.cloud_cover || 0) > 20 ? 'warning' : 'active',
        lastUpdated: String(s.datetime || s.date || now),
        value: s.cloud_cover,
        unit: '% cloud',
        coordinates: s.lat && s.lon ? { lat: Number(s.lat), lon: Number(s.lon) } : { lat, lon },
        metadata: s,
      }));
    }

    // ── NOAA Coral Reef Watch ──
    case 'coral_reef_watch': {
      const [alertsRes, statusRes] = await Promise.allSettled([
        fetch(`/api/crw/alerts`),
        fetch(`/api/crw/status?lat=${lat}&lon=${lon}`),
      ]);
      const items: DataItem[] = [];
      if (alertsRes.status === 'fulfilled' && alertsRes.value.ok) {
        const data = await alertsRes.value.json();
        const alerts = data.alerts || [];
        alerts.forEach((a: Record<string, unknown>, i: number) => {
          items.push({
            id: `crw-alert-${i}`, name: String(a.title || a.reef || `Alert ${i + 1}`),
            type: 'point', status: a.severity === 'Warning' ? 'error' : a.severity === 'Watch' ? 'warning' : 'active',
            lastUpdated: String(a.date || now), value: a.bleaching_threshold, unit: 'DHW',
            coordinates: a.lat && a.lon ? { lat: Number(a.lat), lon: Number(a.lon) } : { lat, lon }, metadata: a,
          });
        });
      }
      if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
        const data = await statusRes.value.json();
        const s = data.status || {};
        items.push({
          id: 'crw-status', name: `Bleaching: ${s.bleaching_alert || 'None'}`,
          type: 'point', status: s.bleaching_alert === 'Warning' ? 'error' : 'active',
          lastUpdated: now, value: s.sst_anomaly, unit: '°C anomaly',
          coordinates: { lat, lon }, metadata: s,
        });
      }
      return items.length > 0 ? items : [{ id: 'crw-none', name: 'No coral reef data available', type: 'point', status: 'active', lastUpdated: now, coordinates: { lat, lon } }];
    }

    case 'flatgeobuf_stream': {
      try {
        const res = await fetch(`/api/flatgeobuf/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat, lon, radiusKm: 50 }),
        });
        if (!res.ok) throw new Error(`FlatGeobuf error: ${res.status}`);
        const data = await res.json();
        const features = data.features || data.data || [];
        return features.map((f: Record<string, unknown>, i: number) => ({
          id: `fgb-${i}`, name: String(f.name || f.id || `Feature ${i + 1}`),
          type: 'point', status: 'active', lastUpdated: String(f.updated || now),
          coordinates: f.lat && f.lon ? { lat: Number(f.lat), lon: Number(f.lon) } : { lat, lon }, metadata: f,
        }));
      } catch {
        return [{ id: 'fgb-unavail', name: 'FlatGeobuf data unavailable for this region', type: 'point', status: 'active', lastUpdated: now, coordinates: { lat, lon } }];
      }
    }

    case 'military_symbology': {
      try {
        const res = await fetch(`/api/milsymbol/common`);
        if (!res.ok) throw new Error(`MilSymbol error: ${res.status}`);
        const data = await res.json();
        const symbols = data.symbols || {};
        return Object.entries(symbols).slice(0, 50).map(([sidc, name], i) => ({
          id: `milsym-${i}`, name: String(name),
          type: 'point', status: 'active', lastUpdated: now, value: sidc, unit: 'SIDC',
          coordinates: { lat: lat + (Math.random() - 0.5) * 0.05, lon: lon + (Math.random() - 0.5) * 0.05 }, metadata: { sidc },
        }));
      } catch {
        return [{ id: 'milsym-unavail', name: 'Military symbology data unavailable', type: 'point', status: 'active', lastUpdated: now, coordinates: { lat, lon } }];
      }
    }

    case 'flood_inundation': {
      try {
        const res = await fetch(`/api/flood/conditions?lat=${lat}&lon=${lon}&radius=50`);
        if (!res.ok) throw new Error(`Flood API error: ${res.status}`);
        const data = await res.json();
        const gauges = data.gauges || [];
        const inundations = data.inundations || [];
        const items: DataItem[] = gauges.slice(0, 20).map((g: Record<string, unknown>, i: number) => ({
          id: `flood-${i}`, name: String(g.name || g.station || `Gauge ${i + 1}`),
          type: 'point', status: g.status === 'flood' ? 'error' : g.status === 'high' ? 'warning' : 'active',
          lastUpdated: String(g.updated || now), value: g.level, unit: g.unit || 'm',
          coordinates: g.lat && g.lon ? { lat: Number(g.lat), lon: Number(g.lon) } : { lat, lon }, metadata: g,
        }));
        inundations.forEach((inv: Record<string, unknown>, i: number) => {
          items.push({
            id: `inund-${i}`, name: String(inv.name || `Inundation Zone ${i + 1}`),
            type: 'point', status: 'warning', lastUpdated: now, value: inv.area_km2, unit: 'km²',
            coordinates: inv.lat && inv.lon ? { lat: Number(inv.lat), lon: Number(inv.lon) } : { lat, lon }, metadata: inv,
          });
        });
        return items.length > 0 ? items : [{ id: 'flood-none', name: 'No flood data for this location', type: 'point', status: 'active', lastUpdated: now, coordinates: { lat, lon } }];
      } catch {
        return [{ id: 'flood-unavail', name: 'Flood data unavailable', type: 'point', status: 'active', lastUpdated: now, coordinates: { lat, lon } }];
      }
    }

    case 'cyber_symbology': {
      try {
        const res = await fetch(`/api/cyber/shodan?q=country:US`);
        if (!res.ok) throw new Error(`Shodan error: ${res.status}`);
        const data = await res.json();
        const devices = data.devices || [];
        return devices.slice(0, 30).map((d: Record<string, unknown>, i: number) => ({
          id: `cyber-${i}`, name: String(d.ip_str || d.hostnames?.[0] || d.port || `Device ${i + 1}`),
          type: 'point', status: d.vulns?.length > 0 ? 'error' : 'active',
          lastUpdated: String(d.last_update || now), value: d.port, unit: `/${d.transport || 'tcp'}`,
          coordinates: d.latitude != null && d.longitude != null ? { lat: Number(d.latitude), lon: Number(d.longitude) } : { lat, lon }, metadata: d,
        }));
      } catch {
        return [{ id: 'cyber-unavail', name: 'Cyber threat data unavailable', type: 'point', status: 'active', lastUpdated: now, coordinates: { lat, lon } }];
      }
    }

    case 'opentelemetry': {
      try {
        const [tracesRes, metricsRes] = await Promise.allSettled([
          fetch(`/api/observability/traces`),
          fetch(`/api/observability/metrics`),
        ]);
        const items: DataItem[] = [];
        if (tracesRes.status === 'fulfilled' && tracesRes.value.ok) {
          const data = await tracesRes.value.json();
          const traces = data.traces || [];
          traces.slice(0, 20).forEach((t: Record<string, unknown>, i: number) => {
            items.push({
              id: `otel-trace-${i}`, name: String(t.name || t.spanName || `Trace ${i + 1}`),
              type: 'point', status: t.status === 'error' ? 'error' : 'active',
              lastUpdated: String(t.startTime || now), value: t.durationMs, unit: 'ms',
              coordinates: { lat, lon }, metadata: t,
            });
          });
        }
        if (metricsRes.status === 'fulfilled' && metricsRes.value.ok) {
          const data = await metricsRes.value.json();
          Object.entries(data).slice(0, 15).forEach(([key, val], i) => {
            items.push({
              id: `otel-metric-${i}`, name: key,
              type: 'point', status: 'active', lastUpdated: now,
              value: typeof val === 'number' ? val : undefined,
              unit: '', coordinates: { lat, lon }, metadata: { [key]: val },
            });
          });
        }
        return items.length > 0 ? items : [{ id: 'otel-none', name: 'No observability data available', type: 'point', status: 'active', lastUpdated: now, coordinates: { lat, lon } }];
      } catch {
        return [{ id: 'otel-unavail', name: 'Observability data unavailable', type: 'point', status: 'active', lastUpdated: now, coordinates: { lat, lon } }];
      }
    }

    case '9_openaq': {
      try {
        const res = await fetch(`/api/openaq?lat=${lat}&lon=${lon}&radius=50000`);
        if (!res.ok) throw new Error(`OpenAQ error: ${res.status}`);
        const data = await res.json();
        const results = data.results || data.data || [];
        return results.slice(0, 30).map((r: Record<string, unknown>, i: number) => ({
          id: `openaq-${i}`, name: String(r.location || r.name || `Station ${i + 1}`),
          type: 'point', status: r.value != null && Number(r.value) > 100 ? 'warning' : 'active',
          lastUpdated: String(r.lastUpdated || r.updated || now),
          value: r.value, unit: r.unit || 'µg/m³',
          coordinates: r.coordinates ? { lat: Number(r.coordinates.latitude), lon: Number(r.coordinates.longitude) } : { lat, lon },
          metadata: r,
        }));
      } catch {
        return [{ id: 'openaq-unavail', name: 'Air quality data unavailable', type: 'point', status: 'active', lastUpdated: now, coordinates: { lat, lon } }];
      }
    }

    case '42_ndbc_buoy_data': {
      try {
        const res = await fetch(`/api/ndbc/nearby?lat=${lat}&lon=${lon}&radius=200`);
        if (!res.ok) throw new Error(`NDBC error: ${res.status}`);
        const data = await res.json();
        const buoys = data.buoys || data.stations || [];
        return buoys.slice(0, 30).map((b: Record<string, unknown>, i: number) => ({
          id: `ndbc-${i}`, name: String(b.name || b.station || `Buoy ${i + 1}`),
          type: 'point', status: b.wave_height != null && Number(b.wave_height) > 3 ? 'warning' : 'active',
          lastUpdated: String(b.updated || b.lastUpdate || now),
          value: b.wave_height ?? b.wind_speed, unit: b.wave_height ? 'm' : 'm/s',
          coordinates: b.lat && b.lon ? { lat: Number(b.lat), lon: Number(b.lon) } : { lat, lon },
          metadata: b,
        }));
      } catch {
        return [{ id: 'ndbc-unavail', name: 'NDBC buoy data unavailable', type: 'point', status: 'active', lastUpdated: now, coordinates: { lat, lon } }];
      }
    }

    case '43_usgs_shakemap': {
      try {
        const res = await fetch(`/api/shakemap/recent?days=7`);
        if (!res.ok) throw new Error(`ShakeMap error: ${res.status}`);
        const data = await res.json();
        const events = data.events || data.shakemaps || [];
        return events.slice(0, 30).map((e: Record<string, unknown>, i: number) => ({
          id: `shakemap-${i}`, name: String(e.name || e.event || e.eventId || `Event ${i + 1}`),
          type: 'point', status: Number(e.magnitude || 0) >= 5 ? 'error' : Number(e.magnitude || 0) >= 3 ? 'warning' : 'active',
          lastUpdated: String(e.time || e.timestamp || now),
          value: e.magnitude, unit: 'M',
          coordinates: e.lat && e.lon ? { lat: Number(e.lat), lon: Number(e.lon) } : { lat, lon },
          metadata: e,
        }));
      } catch {
        return [{ id: 'shakemap-unavail', name: 'ShakeMap data unavailable', type: 'point', status: 'active', lastUpdated: now, coordinates: { lat, lon } }];
      }
    }

    default:
      return [{ id: `unavailable-${layerId}`, name: `Data layer "${layerId}" has no API endpoint yet`, type: 'point', status: 'active', lastUpdated: now, coordinates: { lat, lon } }];
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════

export function EnhancedDataPanel({ layerId, onClose, centerLat = 20, centerLon = 78 }: EnhancedDataPanelProps) {
  const [data, setData] = useState<DataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [filter, setFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const config = LAYER_CONFIG[layerId] || { title: 'Unknown Layer', icon: '❓', color: '#6b7280', description: 'No description available', dataSource: '' };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchLayerData(layerId, centerLat, centerLon);
      setData(items);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      // Fall back to empty data instead of crashing
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [layerId, centerLat, centerLon]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredData = data.filter(item => {
    if (filter !== 'all' && item.status !== filter) return false;
    if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const toggleExpanded = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <CheckCircle size={12} style={{ color: '#4ade80' }} />;
      case 'warning': return <AlertTriangle size={12} style={{ color: '#facc15' }} />;
      case 'error': return <AlertTriangle size={12} style={{ color: '#f87171' }} />;
      default: return <Clock size={12} style={{ color: '#9ca3af' }} />;
    }
  };

  return (
    <Panel
      title={config.title}
      icon={<span style={{ fontSize: 16 }}>{config.icon}</span>}
      accentColor={config.color}
      onClose={onClose}
      width={420}
    >
      {/* Header Info */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{config.description}</div>
        <div style={{ fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Globe size={10} />
          <span>Source: {config.dataSource}</span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
          <input type="text" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '6px 8px 6px 24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e2e8f0', fontSize: 11, outline: 'none' }} />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value)}
          style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e2e8f0', fontSize: 11, outline: 'none' }}>
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </select>
        <button onClick={fetchData} disabled={loading}
          style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e2e8f0', fontSize: 11, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <RefreshCw size={12} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
          Refresh
        </button>
      </div>

      {/* Data List */}
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading data...</div>
        ) : error ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#ef4444' }}>
            <AlertTriangle size={24} style={{ marginBottom: 8 }} />
            <div>{error}</div>
            <button onClick={fetchData} style={{ marginTop: 8, padding: '4px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, color: '#fca5a5', fontSize: 11, cursor: 'pointer' }}>
              Retry
            </button>
          </div>
        ) : filteredData.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No data found</div>
        ) : (
          filteredData.map(item => (
            <div key={item.id} onClick={() => toggleExpanded(item.id)}
              style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', transition: 'background 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {expandedItems.has(item.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {getStatusIcon(item.status)}
                <span style={{ flex: 1, fontSize: 12, color: '#e2e8f0' }}>{item.name}</span>
                {item.value !== undefined && (
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>
                    {typeof item.value === 'number' ? item.value.toFixed(1) : item.value}{item.unit}
                  </span>
                )}
              </div>
              {expandedItems.has(item.id) && (
                <div style={{ marginTop: 8, paddingLeft: 20, fontSize: 10, color: '#64748b' }}>
                  <div>Status: {item.status}</div>
                  <div>Updated: {new Date(item.lastUpdated).toLocaleString()}</div>
                  {item.coordinates && <div>Location: {item.coordinates.lat.toFixed(4)}, {item.coordinates.lon.toFixed(4)}</div>}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#64748b' }}>
          {filteredData.length} items • Updated {lastRefresh.toLocaleTimeString()}
        </span>
      </div>
    </Panel>
  );
}

export default EnhancedDataPanel;
