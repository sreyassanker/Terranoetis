import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search } from 'lucide-react';

/* ═════════════════════════════════════════════════════════════════
   TYPES
   ═════════════════════════════════════════════════════════════════ */

interface SearchResult {
  id: string;
  type: 'action' | 'layer' | 'location';
  label: string;
  description?: string;
  icon: string;
  action?: () => void;
}

interface PaletteAction {
  id: string;
  command: string;
  label: string;
  description: string;
  icon: string;
  keywords: string[];
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onToggleLayer: (id: string) => void;
  onFlyTo: (lat: number, lon: number, opts?: { height?: number; label?: string }) => void;
  onOpenMarketIntelPanel?: () => void;
  onDispatchCommand?: (cmd: string) => void;
}

/* ═════════════════════════════════════════════════════════════════
   KNOWN ITEMS & ACTIONS
   ═════════════════════════════════════════════════════════════════ */

const ACTIONS: PaletteAction[] = [
  {
    id: 'satellite-tracker',
    command: 'satellite-tracker',
    label: 'Satellite Tracker',
    description: 'Real-time NORAD catalog, SGP4 orbital propagation, ISS & Starlink',
    icon: '🛰️',
    keywords: ['satellite', 'tracker', 'norad', 'sgp4', 'iss', 'orbit', 'starlink', 'space', 'sat']
  },
  {
    id: 'satellite-imagery',
    command: 'satellite-imagery',
    label: 'Satellite Imagery Viewer',
    description: '200+ multispectral collections (Sentinel, Landsat, MODIS, VIIRS)',
    icon: '🌍',
    keywords: ['satellite', 'imagery', 'spectral', 'sentinel', 'landsat', 'modis', 'viirs', 'earth', 'sat']
  },
  {
    id: 'aviation-tracker',
    command: 'aviation-tracker',
    label: 'Aviation Tracker & Radar',
    description: 'Live ADS-B flight tracking, overflights, callsign search, squawks',
    icon: '✈️',
    keywords: ['aviation', 'flight', 'tracker', 'radar', 'plane', 'ads-b', 'aircraft', 'airport']
  },
  {
    id: 'analytics-workbench',
    command: 'analytics-workbench',
    label: 'Analytics Workbench (150 Models)',
    description: 'Mathematical models across hydrology, wildfire, atmosphere, geophysics',
    icon: '📊',
    keywords: ['analytics', 'workbench', 'models', 'math', 'hydrology', 'atmospheric', 'seismic', '150']
  },
  {
    id: 'pulse-panel',
    command: 'market-intel',
    label: 'Market & Geopolitical Pulse',
    description: 'Macro, energy, commodities, and geopolitical event telemetry',
    icon: '🔬',
    keywords: ['pulse', 'market', 'intel', 'geopolitical', 'energy', 'oil', 'commodities']
  },
  {
    id: 'multihazard',
    command: 'multihazard',
    label: 'Multi-Hazard Assessment Workbench',
    description: 'Multi-criteria spatial hazard evaluation and vulnerability scoring',
    icon: '⚠️',
    keywords: ['hazard', 'multihazard', 'disaster', 'risk', 'assessment', 'fire', 'flood']
  },
  {
    id: 'api-vault',
    command: 'api-vault',
    label: 'API Configuration Vault',
    description: 'Configure and test Cesium Ion, Gemini, OpenAI, and Sentinel keys',
    icon: '🔐',
    keywords: ['api', 'keys', 'vault', 'tokens', 'credentials', 'config', 'cesium', 'gemini', 'openai']
  },
  {
    id: 'admin-dashboard',
    command: 'admin',
    label: 'Admin & System Diagnostics',
    description: 'Prometheus metrics, cache status, WebSocket streams, and subsystem health',
    icon: '🛡️',
    keywords: ['admin', 'dashboard', 'diagnostics', 'health', 'metrics', 'prometheus', 'redis', 'system']
  },
  {
    id: 'settings',
    command: 'settings',
    label: 'System Settings',
    description: 'Cockpit preferences, sensor styles, audio, and alert webhooks',
    icon: '⚙️',
    keywords: ['settings', 'preferences', 'sensor', 'audio', 'alerts', 'webhook', 'options']
  },
  {
    id: 'measure-tool',
    command: 'measure',
    label: 'Geospatial Ruler & Measure Tool',
    description: 'Measure geodesic surface distances and polygon areas on 3D globe',
    icon: '📐',
    keywords: ['measure', 'ruler', 'distance', 'area', 'geodesic', 'polygon', 'km', 'miles']
  },
  {
    id: 'space-archaeology',
    command: 'archaeology',
    label: 'Space Archaeology & Discovery',
    description: 'Orthogonal consensus remote sensing (Sentinel-1 SAR, Sentinel-2 Red-Edge, SRTM 30m, SoilGrids)',
    icon: '🏛️',
    keywords: ['archaeology', 'space', 'discovery', 'ruins', 'radar', 'sar', 'sentinel', 'ahramat', 'ubar', 'silchester', 'upano', 'tanis', 'satellite']
  },
  {
    id: 'time-slider',
    command: 'time-slider',
    label: 'Timeline Replay Scrubber',
    description: 'Scrub backwards in time across 24h historical telemetry and events',
    icon: '⏱️',
    keywords: ['time', 'slider', 'timeline', 'replay', 'history', 'scrubber', 'playback', '24h']
  },
  {
    id: 'cinematic-director',
    command: 'cinematic-director',
    label: 'Cinematic Director',
    description: 'Camera path keyframing, orbit sweeps, and video trajectory capture',
    icon: '🎬',
    keywords: ['cinematic', 'director', 'camera', 'keyframes', 'video', 'orbit', 'recording']
  },
  {
    id: 'memory-explorer',
    command: 'memory',
    label: 'Memory Explorer',
    description: 'Spatial RAG knowledge base, vector embeddings, and memory recall',
    icon: '🧠',
    keywords: ['memory', 'explorer', 'rag', 'vectors', 'embeddings', 'knowledge', 'ai']
  },
  {
    id: 'safe-route',
    command: 'route',
    label: 'Emergency Route Navigation',
    description: 'Calculate multi-hazard-avoiding evacuation routes and travel times',
    icon: '🧭',
    keywords: ['route', 'navigation', 'evacuation', 'safest', 'path', 'routing', 'hazard']
  },
];

const LAYERS: Array<{ id: string; label: string; icon: string }> = [
  { id: 'earthquakes', label: 'Earthquakes', icon: '🌍' },
  { id: 'flight_tracks', label: 'Flight Tracks', icon: '✈️' },
  { id: 'ais_vessels', label: 'Maritime AIS', icon: '🚢' },
  { id: 'severe_storms', label: 'Severe Storms', icon: '⛈️' },
  { id: 'wildfires', label: 'Wildfires', icon: '🔥' },
  { id: 'volcanoes', label: 'Volcanoes', icon: '🌋' },
  { id: 'lightning_strikes', label: 'Lightning', icon: '⚡' },
  { id: 'space_debris', label: 'Space Debris', icon: '🛰️' },
  { id: 'submarine_cables', label: 'Submarine Cables', icon: '🔌' },
  { id: 'tectonic', label: 'Tectonic Plates', icon: '🗺️' },
  { id: 'seismic_waves', label: 'Seismic Waves', icon: '🌊' },
  { id: 'heatmap', label: 'Earthquake Heatmap', icon: '🔥' },
  { id: 'airports', label: 'Airports', icon: '🛫' },
  { id: 'airspaces', label: 'Airspaces', icon: '🛫' },
  { id: 'nasa_dsn', label: 'NASA DSN', icon: '📡' },
  { id: 'aurora_oval', label: 'Aurora', icon: '🌌' },
  { id: 'electricity_grid', label: 'Electricity Grid', icon: '⚡' },
  { id: 'animal_migrations', label: 'Animal Migrations', icon: '🐋' },
  { id: 'dt_buildings', label: 'OSM Buildings', icon: '🏙️' },
  { id: 'temp_anomaly', label: 'Surface Air Temp (AIRS)', icon: '🌡️' },
  { id: 'sea_ice', label: 'Sea Ice', icon: '🧊' },
  { id: 'precipitation', label: 'Precipitation', icon: '🌧️' },
  { id: 'wind', label: 'Ocean Wind Speed', icon: '💨' },
  { id: 'live_media', label: 'Live Media', icon: '📺' },
  { id: 'disaster_alerts', label: 'Disaster Alerts', icon: '🚨' },
];

const LOCATIONS: Array<{ name: string; lat: number; lon: number; icon: string }> = [
  { name: 'New York', lat: 40.7128, lon: -74.0060, icon: '🗽' },
  { name: 'London', lat: 51.5074, lon: -0.1278, icon: '🇬🇧' },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503, icon: '🗼' },
  { name: 'Beijing', lat: 39.9042, lon: 116.4074, icon: '🇨🇳' },
  { name: 'Mumbai', lat: 19.0760, lon: 72.8777, icon: '🇮🇳' },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093, icon: '🇦🇺' },
  { name: 'Cairo', lat: 30.0444, lon: 31.2357, icon: '🇪🇬' },
  { name: 'Dubai', lat: 25.2048, lon: 55.2708, icon: '🇦🇪' },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198, icon: '🇸🇬' },
  { name: 'San Francisco', lat: 37.7749, lon: -122.4194, icon: '🌉' },
  { name: 'Paris', lat: 48.8566, lon: 2.3522, icon: '🇫🇷' },
  { name: 'Berlin', lat: 52.5200, lon: 13.4050, icon: '🇩🇪' },
  { name: 'Moscow', lat: 55.7558, lon: 37.6173, icon: '🇷🇺' },
  { name: 'Seoul', lat: 37.5665, lon: 126.9780, icon: '🇰🇷' },
  { name: 'São Paulo', lat: -23.5505, lon: -46.6333, icon: '🇧🇷' },
  { name: 'Taiwan Strait', lat: 23.6978, lon: 120.9605, icon: '🇹🇼' },
  { name: 'Strait of Hormuz', lat: 26.5, lon: 56.25, icon: '🚢' },
  { name: 'Strait of Malacca', lat: 2.5, lon: 101.5, icon: '🚢' },
  { name: 'Ukraine', lat: 48.3794, lon: 31.1656, icon: '🇺🇦' },
  { name: 'Israel/Palestine', lat: 31.0461, lon: 34.8516, icon: '🇮🇱' },
];

/* ═════════════════════════════════════════════════════════════════
   COMMAND PALETTE COMPONENT
   ═════════════════════════════════════════════════════════════════ */

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  onToggleLayer,
  onFlyTo,
  onOpenMarketIntelPanel,
  onDispatchCommand,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Search results
  const results = useMemo<SearchResult[]>(() => {
    const q = query.toLowerCase().trim();
    const items: SearchResult[] = [];

    // Actions & Panels
    for (const act of ACTIONS) {
      if (!q || act.label.toLowerCase().includes(q) || act.description.toLowerCase().includes(q) || act.keywords.some(k => k.includes(q))) {
        items.push({
          id: `action-${act.id}`,
          type: 'action',
          label: act.label,
          description: act.description,
          icon: act.icon,
          action: () => {
            if (onDispatchCommand) {
              onDispatchCommand(act.command);
            } else if (act.id === 'pulse-panel' && onOpenMarketIntelPanel) {
              onOpenMarketIntelPanel();
            }
          },
        });
      }
    }

    // Layers
    for (const layer of LAYERS) {
      if (!q || layer.label.toLowerCase().includes(q) || layer.id.includes(q)) {
        items.push({
          id: `layer-${layer.id}`,
          type: 'layer',
          label: `Toggle: ${layer.label}`,
          description: `Layer ID: ${layer.id}`,
          icon: layer.icon,
          action: () => onToggleLayer(layer.id),
        });
      }
    }

    // Locations
    for (const loc of LOCATIONS) {
      if (!q || loc.name.toLowerCase().includes(q)) {
        items.push({
          id: `loc-${loc.name}`,
          type: 'location',
          label: loc.name,
          description: `${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°`,
          icon: loc.icon,
          action: () => onFlyTo(loc.lat, loc.lon, { height: 2e6, label: loc.name }),
        });
      }
    }

    return items.slice(0, 24);
  }, [query, onToggleLayer, onFlyTo, onOpenMarketIntelPanel, onDispatchCommand]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      results[selectedIndex].action?.();
      onClose();
    }
  }, [results, selectedIndex, onClose]);

  // Scroll selected into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement;
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!open) return null;

  const typeMeta: Record<string, { label: string; color: string }> = {
    action: { label: 'Quick Actions', color: '#818cf8' },
    layer: { label: 'Geospatial Layers', color: '#22d3ee' },
    location: { label: 'Global Locations', color: '#34d399' },
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(5px)',
          animation: 'fadeIn 0.15s ease',
        }}
      />
      {/* Palette */}
      <div
        style={{
          position: 'fixed',
          top: '18%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 580,
          maxWidth: 'calc(100vw - 32px)',
          zIndex: 1001,
          background: 'linear-gradient(135deg, #0b1120 0%, #17223b 100%)',
          border: '1px solid rgba(255,255,255,0.16)',
          borderRadius: 14,
          boxShadow: '0 25px 80px rgba(0,0,0,0.7), 0 0 60px rgba(99,102,241,0.2)',
          overflow: 'hidden',
          animation: 'scaleIn 0.15s ease',
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '14px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          background: 'rgba(15, 23, 42, 0.4)',
          gap: 12,
        }}>
          <Search size={18} style={{ color: '#818cf8', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            placeholder="Search panels, layers, locations..."
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              color: '#f8fafc',
              fontSize: 15,
              fontWeight: 500,
              fontFamily: 'inherit',
            }}
          />
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#cbd5e1',
            background: 'rgba(255,255,255,0.08)',
            padding: '3px 8px',
            borderRadius: 5,
            border: '1px solid rgba(255,255,255,0.15)',
            fontFamily: 'monospace',
          }}>
            ESC
          </div>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ maxHeight: 420, overflowY: 'auto' }}>
          {results.length === 0 && (
            <div style={{ padding: '36px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              No results found for "{query}"
            </div>
          )}
          {results.map((result, i) => {
            const isFirstOfGroup = i === 0 || results[i - 1].type !== result.type;
            const meta = typeMeta[result.type] || { label: result.type, color: '#94a3b8' };
            const isSelected = i === selectedIndex;

            return (
              <React.Fragment key={result.id}>
                {isFirstOfGroup && (
                  <div style={{
                    padding: '8px 18px 4px',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: '#94a3b8',
                    borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                    background: 'rgba(11, 17, 32, 0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <span>{meta.label}</span>
                  </div>
                )}
                <div
                  data-index={i}
                  onClick={() => { result.action?.(); onClose(); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 18px',
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(99,102,241,0.18)' : 'transparent',
                    borderLeft: isSelected ? '3px solid #818cf8' : '3px solid transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span style={{ fontSize: 17, width: 24, textAlign: 'center' }}>{result.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: isSelected ? '#ffffff' : '#f1f5f9', fontWeight: 500 }}>
                      {result.label}
                    </div>
                    {result.description && (
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                        {result.description}
                      </div>
                    )}
                  </div>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: meta.color,
                    background: `${meta.color}18`,
                    border: `1px solid ${meta.color}35`,
                    padding: '2px 8px',
                    borderRadius: 5,
                    textTransform: 'capitalize',
                  }}>
                    {result.type}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 18px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(15, 23, 42, 0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          fontSize: 11,
          color: '#94a3b8',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <kbd style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 4, padding: '1px 6px', fontSize: 10, color: '#f1f5f9', fontFamily: 'monospace' }}>↑↓</kbd>
            Navigate
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <kbd style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 4, padding: '1px 6px', fontSize: 10, color: '#f1f5f9', fontFamily: 'monospace' }}>↵</kbd>
            Select
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <kbd style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 4, padding: '1px 6px', fontSize: 10, color: '#f1f5f9', fontFamily: 'monospace' }}>ESC</kbd>
            Close
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>
            {results.length} items
          </span>
        </div>
      </div>
    </>
  );
};
