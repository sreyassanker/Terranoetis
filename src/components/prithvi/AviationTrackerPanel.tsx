import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plane, Search, Loader2, MapPin, Globe, Radio } from 'lucide-react';
import Panel from '@/components/ui/Panel';

interface FlightData {
  id: string;
  callsign: string;
  country: string | null;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  velocity: number | null;
  heading: number | null;
  onGround: boolean;
  verticalRate: number | null;
  sqwk: string | null;
}

function parseState(state: unknown[]): FlightData | null {
  const icao24 = String(state[0] ?? '');
  if (!icao24) return null;
  const lonVal = state[5];
  const latVal = state[6];
  if (lonVal == null || latVal == null) return null;
  const lon = Number(lonVal);
  const lat = Number(latVal);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const cs = String(state[1] ?? '').trim();
  return {
    id: icao24,
    callsign: cs || icao24.toUpperCase(),
    country: state[2] ? String(state[2]) : null,
    lat,
    lon,
    altitude: state[7] != null && Number.isFinite(Number(state[7])) ? Number(state[7]) : (state[13] != null && Number.isFinite(Number(state[13])) ? Number(state[13]) : null),
    velocity: state[9] != null && Number.isFinite(Number(state[9])) ? Number(state[9]) : null,
    heading: state[10] != null && Number.isFinite(Number(state[10])) ? Number(state[10]) : null,
    onGround: Boolean(state[8]),
    verticalRate: state[11] != null && Number.isFinite(Number(state[11])) ? Number(state[11]) : null,
    sqwk: state[14] ? String(state[14]) : null,
  };
}

const SOURCE_COLOR = '#60a5fa';
const SOURCE_BG = 'rgba(96,165,250,0.15)';

export function AviationTrackerPanel({ onClose, onTravelView }: {
  onClose?: () => void;
  onTravelView?: (f: { id: string; name: string; lat: number; lon: number; altitude: number; velocity: number; heading: number; verticalRate: number }) => void;
}) {
  const [query, setQuery] = useState('');
  const [allFlights, setAllFlights] = useState<FlightData[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FlightData | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    setLoading(true);
    fetch('/api/flights/all')
      .then(r => r.json())
      .then((data: { states?: unknown[][] }) => {
        const flights: FlightData[] = [];
        const states = data.states || [];
        for (let i = 0; i < states.length; i++) {
          const f = parseState(states[i] as unknown[]);
          if (f) flights.push(f);
        }
        setAllFlights(flights);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const out: FlightData[] = [];
    for (let i = 0; i < allFlights.length && out.length < 100; i++) {
      const f = allFlights[i];
      if (
        f.callsign.toLowerCase().includes(q) ||
        f.id.toLowerCase().includes(q) ||
        (f.country && f.country.toLowerCase().includes(q))
      ) out.push(f);
    }
    return out;
  }, [query, allFlights]);

  const handleSelect = useCallback((f: FlightData) => {
    setSelected(f);
    setQuery(f.callsign);
  }, []);

  const fmt = (v: number | null | undefined, fn: (v: number) => string, fallback = '—') =>
    v != null && isFinite(v) ? fn(v) : fallback;

  const mpsToKts = (v: number) => (v * 1.94384);
  const mpsToKmh = (v: number) => (v * 3.6);
  const mToFt = (v: number) => (v * 3.28084);

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex: 1000, width: 340 }}>
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
                  key={f.id}
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
                      <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: SOURCE_BG, color: SOURCE_COLOR, flexShrink: 0 }}>{f.id}</span>
                    </div>
                    <div style={{ color: '#64748b', fontSize: 9 }}>
                      {f.country ?? 'Unknown'}{f.altitude != null ? ` · ${Math.round(mToFt(f.altitude)).toLocaleString()} ft` : ''}
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
                  <span style={{ padding: '1px 4px', borderRadius: 3, background: SOURCE_BG, color: SOURCE_COLOR, fontSize: 8 }}>{selected.id}</span>
                  {selected.country ? ` · ${selected.country}` : ''}
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                { label: 'Latitude', value: fmt(selected.lat, v => `${v.toFixed(3)}°${v >= 0 ? 'N' : 'S'}`) },
                { label: 'Longitude', value: fmt(selected.lon, v => `${v.toFixed(3)}°${v >= 0 ? 'E' : 'W'}`) },
                { label: 'Altitude', value: fmt(selected.altitude, v => `${Math.round(mToFt(v)).toLocaleString()} ft`) },
                { label: 'Status', value: selected.onGround ? 'On Ground' : 'In Flight' },
              ].concat(
                selected.velocity != null ? [{ label: 'Speed', value: `${Math.round(mpsToKmh(selected.velocity))} km/h` }] : [],
                selected.velocity != null ? [{ label: 'Speed', value: `${Math.round(mpsToKts(selected.velocity))} kts` }] : [],
                selected.heading != null ? [{ label: 'Heading', value: `${selected.heading.toFixed(0)}°` }] : [],
                selected.verticalRate != null ? [{ label: 'V/S', value: `${selected.verticalRate >= 0 ? '+' : ''}${Math.round(selected.verticalRate)} m/s` }] : [],
                selected.sqwk ? [{ label: 'Squawk', value: selected.sqwk }] : [],
              ).map(d => (
                <div key={d.label} style={{ padding: '6px 8px', borderRadius: 4, background: 'rgba(96,165,250,0.05)', border: '1px solid rgba(96,165,250,0.08)' }}>
                  <div style={{ color: '#64748b', fontSize: 8, textTransform: 'uppercase' }}>{d.label}</div>
                  <div style={{ color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' }}>{d.value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {onTravelView && (selected.lat != null && selected.lon != null) && (
                <button
                  onClick={() => onTravelView({ id: selected.id, name: selected.callsign, lat: selected.lat, lon: selected.lon, altitude: selected.altitude ?? 0, velocity: selected.velocity ?? 0, heading: selected.heading ?? 0, verticalRate: selected.verticalRate ?? 0 })}
                  style={{
                    flex: 1, padding: '6px', borderRadius: 4, border: 'none',
                    cursor: 'pointer', background: 'rgba(96,165,250,0.2)', color: SOURCE_COLOR, fontSize: 9,
                    textTransform: 'uppercase',
                  }}
                >
                  <Radio size={12} style={{ display: 'inline', marginRight: 4 }} />
                  Travel View
                </button>
              )}
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
