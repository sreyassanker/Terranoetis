import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/* ═════════════════════════════════════════════════════════════════
   TYPES
   ═════════════════════════════════════════════════════════════════ */

interface SearchResult {
  id: string;
  type: 'location' | 'layer' | 'action';
  label: string;
  description?: string;
  icon: string;
  action?: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onToggleLayer: (id: string) => void;
  onFlyTo: (lat: number, lon: number, opts?: { height?: number; label?: string }) => void;
  onOpenMarketIntelPanel?: () => void;
}

/* ═════════════════════════════════════════════════════════════════
   KNOWN ITEMS
   ═════════════════════════════════════════════════════════════════ */

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
  { id: 'temp_anomaly', label: 'Temperature Anomaly', icon: '🌡️' },
  { id: 'sea_ice', label: 'Sea Ice', icon: '🧊' },
  { id: 'precipitation', label: 'Precipitation', icon: '🌧️' },
  { id: 'wind', label: 'Wind', icon: '💨' },
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
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input on open
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Search results
  const results = useMemo<SearchResult[]>(() => {
    const q = query.toLowerCase().trim();
    const items: SearchResult[] = [];

    // Actions
    if (!q || 'pulse panel'.includes(q)) {
      items.push({
        id: 'action-intelligence',
        type: 'action',
        label: 'Open Pulse',
        description: 'Market, energy, geopolitical, and correlation data',
        icon: '🔬',
        action: onOpenMarketIntelPanel,
      });
    }



    // Layers
    for (const layer of LAYERS) {
      if (!q || layer.label.toLowerCase().includes(q) || layer.id.includes(q)) {
        items.push({
          id: `layer-${layer.id}`,
          type: 'layer',
          label: `Toggle: ${layer.label}`,
          description: layer.id,
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

    return items.slice(0, 20); // Limit results
  }, [query, onToggleLayer, onFlyTo, onOpenMarketIntelPanel]);

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
      const selected = listRef.current.children[selectedIndex] as HTMLElement;
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!open) return null;

  const typeColors: Record<string, string> = {
    action: '#818cf8',
    layer: '#22d3ee',
    location: '#22c55e',
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)',
          animation: 'fadeIn 0.15s ease',
        }}
      />
      {/* Palette */}
      <div
        style={{
          position: 'fixed',
          top: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 560,
          maxWidth: 'calc(100vw - 32px)',
          zIndex: 1001,
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 12,
          boxShadow: '0 25px 80px rgba(0,0,0,0.6), 0 0 60px rgba(99,102,241,0.15)',
          overflow: 'hidden',
          animation: 'scaleIn 0.15s ease',
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '14px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          gap: 10,
        }}>
          <span style={{ fontSize: 16, color: '#64748b' }}>🔍</span>
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
              color: '#e2e8f0',
              fontSize: 15,
              fontFamily: 'inherit',
            }}
          />
          <div style={{
            fontSize: 10,
            color: '#475569',
            background: 'rgba(255,255,255,0.06)',
            padding: '3px 8px',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            ESC
          </div>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ maxHeight: 400, overflowY: 'auto' }}>
          {results.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              No results found for "{query}"
            </div>
          )}
          {results.map((result, i) => (
            <div
              key={result.id}
              onClick={() => { result.action?.(); onClose(); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 16px',
                cursor: 'pointer',
                background: i === selectedIndex ? 'rgba(99,102,241,0.12)' : 'transparent',
                borderLeft: i === selectedIndex ? '2px solid #818cf8' : '2px solid transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span style={{ fontSize: 16, width: 24, textAlign: 'center' }}>{result.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>{result.label}</div>
                {result.description && (
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>{result.description}</div>
                )}
              </div>
              <span style={{
                fontSize: 9,
                color: typeColors[result.type] || '#64748b',
                background: `${typeColors[result.type] || '#64748b'}15`,
                padding: '2px 6px',
                borderRadius: 4,
                textTransform: 'capitalize',
              }}>
                {result.type}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          gap: 12,
          fontSize: 9,
          color: '#475569',
        }}>
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>ESC Close</span>
        </div>
      </div>


    </>
  );
};
