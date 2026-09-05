import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plane, Search, Loader2, MapPin, Globe, Radio } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { parseFlightState, type FlightState } from '@/rendering/flights';

// Live-aviation self-refresh cadence: matches OpenSky's public ~10s update
// rate while keeping request volume low enough for the public/whitelisted feed.
const REFRESH_MS = 15000;

const SOURCE_COLOR = '#60a5fa';
const SOURCE_BG = 'rgba(96,165,250,0.15)';

export function AviationTrackerPanel({ onClose, onTravelView, zIndex = 1000 }: {
  onClose?: () => void;
  onTravelView?: (f: { id: string; name: string; lat: number; lon: number; altitude: number; velocity: number; heading: number; verticalRate: number }) => void;
  zIndex?: number;
}) {
  const [query, setQuery] = useState('');
  const [allFlights, setAllFlights] = useState<FlightState[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FlightState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchFlights = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const resp = await fetch('/api/flights/all', { headers });
      if (!resp.ok) return;
      const data: { states?: unknown[][] } = await resp.json();
      const flights: FlightState[] = [];
      const states = data.states || [];
      for (let i = 0; i < states.length; i++) {
        const f = parseFlightState(states[i] as unknown[]);
        if (f) flights.push(f);
      }
      setAllFlights(flights);
    } catch { /* silent */ }
    finally { if (initial) setLoading(false); }
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    // Loading state is toggled inside fetchFlights (async), not synchronously
    // in this effect body, to avoid a cascading render on mount.
    void fetchFlights(true);
    pollRef.current = setInterval(() => { void fetchFlights(false); }, REFRESH_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchFlights]);

  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const out: FlightState[] = [];
    for (let i = 0; i < allFlights.length && out.length < 100; i++) {
      const f = allFlights[i];
      if (
        f.callsign.toLowerCase().includes(q) ||
        f.icao24.toLowerCase().includes(q) ||
        (f.country && f.country.toLowerCase().includes(q))
      ) out.push(f);
    }
    return out;
  }, [query, allFlights]);

  const handleSelect = useCallback((f: FlightState) => {
    setSelected(f);
    setQuery(f.callsign);
  }, []);

  const fmt = (v: number | null | undefined, fn: (v: number) => string, fallback = '—') =>
    v != null && isFinite(v) ? fn(v) : fallback;

  const mpsToKts = (v: number) => (v * 1.94384);
  const mpsToKmh = (v: number) => (v * 3.6);
  const mToFt = (v: number) => (v * 3.28084);

  // Remove the old FlightData / parseState — replaced by shared parseFlightState

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex, width: 340 }}>
      <Panel title="AVIATION TRACKER" icon={<Plane size={16} />} accentColor={SOURCE_COLOR} iconColor={SOURCE_COLOR} titleColor={SOURCE_COLOR} onClose={onClose}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${SOURCE_BG}` }}>
          <div style={{ position: 'relative', display: 'flex', gap: 4 }}>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setSelected(null); }}
              placeholder="Search callsign, ICAO24 or country..."
              style={{
                flex: 1, padding: '6px 8px', background: 'rgba(0,0,0,0.3)',
                border: `1px solid ${SOURCE_BG}`, borderRadius: 4,
                color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace',
              }}
            />
            {loading ? <Loader2 size={14} style={{ color: SOURCE_COLOR, alignSelf: 'center', animation: 'spin 1s linear infinite' }} /> : <Search size={14} style={{ color: '#64748b', alignSelf: 'center' }} />}
          </div>
          <div style={{ color: '#64748b', fontSize: 9, marginTop: 4 }}>
            {loading ? 'Loading live flights...' : `${allFlights.length.toLocaleString()} live aircraft`}
          </div>

          {suggestions.length > 0 && !selected && (
            <div style={{ marginTop: 6, maxHeight: 250, overflowY: 'auto', borderRadius: 4, background: 'rgba(0,0,0,0.4)' }}>
              {suggestions.map(f => (
                <div
                  key={f.icao24}
                  onClick={() => handleSelect(f)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
                    cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.03)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(96,165,250,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Plane size={12} style={{ color: f.onGround ? '#64748b' : SOURCE_COLOR, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: '#e2e8f0', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.callsign}</span>
                      <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: SOURCE_BG, color: SOURCE_COLOR, flexShrink: 0 }}>{f.icao24}</span>
                    </div>
                    <div style={{ color: '#64748b', fontSize: 9 }}>
                      {f.country ?? 'Unknown'}{f.alt != null ? ` · ${Math.round(mToFt(f.alt)).toLocaleString()} ft` : ''}
                    </div>
                  </div>
                  <Globe size={10} style={{ color: '#64748b', flexShrink: 0 }} />
                </div>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Plane size={18} style={{ color: SOURCE_COLOR }} />
              <div>
                <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{selected.callsign}</div>
                <div style={{ color: '#64748b', fontSize: 9 }}>
                  <span style={{ padding: '1px 4px', borderRadius: 3, background: SOURCE_BG, color: SOURCE_COLOR, fontSize: 8 }}>{selected.icao24}</span>
                  {selected.country ? ` · ${selected.country}` : ''}
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                { label: 'Latitude', value: fmt(selected.lat, v => `${v.toFixed(3)}°${v >= 0 ? 'N' : 'S'}`) },
                { label: 'Longitude', value: fmt(selected.lon, v => `${v.toFixed(3)}°${v >= 0 ? 'E' : 'W'}`) },
                { label: 'Altitude', value: fmt(selected.alt, v => `${Math.round(mToFt(v)).toLocaleString()} ft`) },
                { label: 'Status', value: selected.onGround ? 'On Ground' : 'In Flight' },
              ].concat(
                selected.velocity != null ? [{ label: 'Speed (km/h)', value: `${Math.round(mpsToKmh(selected.velocity))} km/h` }, { label: 'Speed (kts)', value: `${Math.round(mpsToKts(selected.velocity))} kts` }] : [],
                selected.heading != null ? [{ label: 'Heading', value: `${selected.heading.toFixed(0)}°` }] : [],
                selected.verticalRate != null ? [{ label: 'V/S', value: `${selected.verticalRate >= 0 ? '+' : ''}${Math.round(selected.verticalRate)} m/s` }] : [],
                selected.squawk ? [{ label: 'Squawk', value: selected.squawk }] : [],
              ).map(d => (
                <div key={d.label} style={{ padding: '6px 8px', borderRadius: 4, background: 'rgba(96,165,250,0.05)', border: '1px solid rgba(96,165,250,0.08)' }}>
                  <div style={{ color: '#64748b', fontSize: 8, textTransform: 'uppercase' }}>{d.label}</div>
                  <div style={{ color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' }}>{d.value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {onTravelView && (selected.lat != null && selected.lon != null) && (() => {
                const travelLat = selected.lat ?? 0;
                const travelLon = selected.lon ?? 0;
                return (
                <button
                  onClick={() => onTravelView({ id: selected.icao24, name: selected.callsign, lat: travelLat, lon: travelLon, altitude: selected.alt ?? 0, velocity: selected.velocity ?? 0, heading: selected.heading ?? 0, verticalRate: selected.verticalRate ?? 0 })}
                  style={{
                    flex: 1, padding: '6px', borderRadius: 4, border: 'none',
                    cursor: 'pointer', background: 'rgba(96,165,250,0.2)', color: SOURCE_COLOR, fontSize: 9,
                    textTransform: 'uppercase',
                  }}
                >
                  <Radio size={12} style={{ display: 'inline', marginRight: 4 }} />
                  Travel View
                </button>
                );
              })()}
              <button
                onClick={() => { setSelected(null); setQuery(''); }}
                style={{
                  flex: 1, padding: '6px', borderRadius: 4, border: 'none',
                  cursor: 'pointer', background: 'rgba(96,165,250,0.15)', color: SOURCE_COLOR, fontSize: 9,
                  textTransform: 'uppercase',
                }}
              >
                <MapPin size={12} style={{ display: 'inline', marginRight: 4 }} />
                Search another
              </button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
