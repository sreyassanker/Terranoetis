import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Satellite, Search, Loader2, MapPin, Globe, EyeOff } from 'lucide-react';
import Panel from '@/components/ui/Panel';

interface SatelliteData {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  inclination: number | null;
  meanMotion: number | null;
  epoch: string | null;
  tle1: string | null;
  tle2: string | null;
  source: string;
  hasTle: boolean;
  country?: string | null;
  purpose?: string | null;
  orbitClass?: string | null;
  velocity?: number | null;
  version?: string | null;
}

const SOURCE_COLORS: Record<string, string> = {
  CelesTrak: '#00D4FF',
  UCS: '#22c55e',
  Starlink: '#f59e0b',
};

const SOURCE_BG: Record<string, string> = {
  CelesTrak: 'rgba(0,212,255,0.15)',
  UCS: 'rgba(34,197,94,0.15)',
  Starlink: 'rgba(245,158,11,0.15)',
};

export function SatelliteTrackerPanel({ onClose, onTrackSatellite, onTravelView, zIndex = 1000 }: { onClose?: () => void; onTrackSatellite?: (sat: { id: string; name: string; lat: number; lon: number; altitude: number; tle1: string; tle2: string }) => void; onTravelView?: () => void; zIndex?: number }) {
  const [query, setQuery] = useState('');
  const [allSats, setAllSats] = useState<SatelliteData[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SatelliteData | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadSats = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/satellites/tle');
      const data = (await r.json()) as SatelliteData[];
      setAllSats(data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    // Loading is toggled inside loadSats (async), not synchronously in this
    // effect body, so there is no cascading render on mount.
    void loadSats();
  }, [loadSats]);

  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const out: SatelliteData[] = [];
    for (let i = 0; i < allSats.length && out.length < 100; i++) {
      if (allSats[i].name.toLowerCase().includes(q)) out.push(allSats[i]);
    }
    return out;
  }, [query, allSats]);

  const handleSelect = useCallback((sat: SatelliteData) => {
    setSelected(sat);
    setQuery(sat.name);
    if (onTrackSatellite && sat.tle1 && sat.tle2) {
      onTrackSatellite({
        id: sat.id, name: sat.name,
        lat: sat.lat ?? 0, lon: sat.lon ?? 0,
        altitude: sat.altitude ?? 0,
        tle1: sat.tle1, tle2: sat.tle2,
      });
    }
  }, [onTrackSatellite]);

  const fmt = (v: number | null | undefined, fn: (v: number) => string, fallback = '—') =>
    v != null && isFinite(v) ? fn(v) : fallback;

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex, width: 340 }}>
      <Panel title="SATELLITE TRACKER" icon={<Satellite size={16} />} accentColor="#00D4FF" iconColor="#00D4FF" titleColor="#00D4FF" onClose={onClose}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(0,212,255,0.1)' }}>
          <div style={{ position: 'relative', display: 'flex', gap: 4 }}>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setSelected(null); }}
              placeholder="Search satellite by name..."
              style={{
                flex: 1, padding: '6px 8px', background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(0,212,255,0.2)', borderRadius: 4,
                color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace',
              }}
            />
            {loading ? <Loader2 size={14} style={{ color: '#00D4FF', alignSelf: 'center', animation: 'spin 1s linear infinite' }} /> : <Search size={14} style={{ color: '#64748b', alignSelf: 'center' }} />}
          </div>

          {/* Quick-Pick Featured Presets */}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              Featured Missions
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {[
                { label: '🛰️ ISS', q: 'ISS' },
                { label: '🔭 Hubble', q: 'HST' },
                { label: '🌐 Starlink', q: 'STARLINK' },
                { label: '🌦️ NOAA', q: 'NOAA' },
                { label: '🛰️ Tiangong', q: 'TIANGONG' },
                { label: '🌍 Landsat', q: 'LANDSAT' },
              ].map(preset => (
                <button
                  key={preset.q}
                  onClick={() => {
                    setQuery(preset.q);
                    setSelected(null);
                  }}
                  style={{
                    padding: '3px 7px',
                    borderRadius: 4,
                    background: query.toLowerCase() === preset.q.toLowerCase() ? 'rgba(0,212,255,0.25)' : 'rgba(255,255,255,0.05)',
                    border: query.toLowerCase() === preset.q.toLowerCase() ? '1px solid #00D4FF' : '1px solid rgba(255,255,255,0.1)',
                    color: query.toLowerCase() === preset.q.toLowerCase() ? '#00D4FF' : '#cbd5e1',
                    fontSize: 10,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {suggestions.length > 0 && !selected && (
            <div style={{ marginTop: 8, maxHeight: 250, overflowY: 'auto', borderRadius: 6, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(0,212,255,0.15)' }}>
              {suggestions.map(s => (
                <div
                  key={s.id}
                  onClick={() => handleSelect(s)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px',
                    cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)',
                    opacity: s.tle1 && s.tle2 ? 1 : 0.6,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,212,255,0.12)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {s.tle1 && s.tle2
                    ? <Satellite size={12} style={{ color: '#00D4FF', flexShrink: 0 }} />
                    : <EyeOff size={12} style={{ color: '#64748b', flexShrink: 0 }} />
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: '#f8fafc', fontSize: 10, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                      <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: SOURCE_BG[s.source] ?? 'rgba(100,116,139,0.2)', color: SOURCE_COLORS[s.source] ?? '#94a3b8', flexShrink: 0 }}>{s.source}</span>
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 9 }}>
                      {s.tle1 && s.tle2 ? `NORAD ${s.id}` : s.source === 'UCS' ? (s.country ?? s.orbitClass ?? 'Satellite') : `v${s.version ?? '?'}`}
                      {s.altitude != null ? ` · ${s.altitude.toLocaleString()}m` : ''}
                    </div>
                  </div>
                  <Globe size={10} style={{ color: '#64748b', flexShrink: 0 }} />
                </div>
              ))}
            </div>
          )}

          {/* Empty state guidance when no search active */}
          {!selected && suggestions.length === 0 && !query.trim() && (
            <div style={{
              marginTop: 10,
              padding: '12px 10px',
              borderRadius: 6,
              background: 'rgba(0, 212, 255, 0.04)',
              border: '1px dashed rgba(0, 212, 255, 0.25)',
              textAlign: 'center',
            }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0, 212, 255, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px', color: '#00D4FF' }}>
                <Satellite size={16} />
              </div>
              <div style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                Real-Time SGP4 Propagation
              </div>
              <div style={{ color: '#94a3b8', fontSize: 10, lineHeight: 1.4, marginBottom: 8 }}>
                Select a featured mission above or enter any satellite name or NORAD ID to track orbits, compute altitude, and render ground tracks.
              </div>
              <div style={{ fontSize: 9, color: '#38bdf8', fontFamily: 'monospace' }}>
                {allSats.length > 0 ? `● ${allSats.length.toLocaleString()} orbital objects loaded` : 'Loading orbital catalog...'}
              </div>
            </div>
          )}
        </div>

        {selected && (
          <div style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              {selected.tle1 && selected.tle2
                ? <Satellite size={18} style={{ color: '#00D4FF' }} />
                : <EyeOff size={18} style={{ color: '#64748b' }} />
              }
              <div>
                <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{selected.name}</div>
                <div style={{ color: '#64748b', fontSize: 9 }}>
                  <span style={{ padding: '1px 4px', borderRadius: 3, background: SOURCE_BG[selected.source] ?? 'rgba(100,116,139,0.2)', color: SOURCE_COLORS[selected.source] ?? '#94a3b8', fontSize: 8 }}>{selected.source}</span>
                  {selected.country ? ` · ${selected.country}` : ''}
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                { label: 'Latitude', value: fmt(selected.lat, v => `${v.toFixed(3)}°${v >= 0 ? 'N' : 'S'}`) },
                { label: 'Longitude', value: fmt(selected.lon, v => `${v.toFixed(3)}°${v >= 0 ? 'E' : 'W'}`) },
                { label: 'Altitude', value: fmt(selected.altitude, v => `${v.toLocaleString()} m`) },
                { label: 'Inclination', value: fmt(selected.inclination, v => `${v.toFixed(2)}°`) },
              ].concat(
                selected.velocity != null ? [{ label: 'Velocity', value: fmt(selected.velocity, v => `${v.toFixed(2)} km/s`) }] : [],
                selected.purpose ? [{ label: 'Purpose', value: selected.purpose }] : [],
                selected.orbitClass ? [{ label: 'Orbit', value: selected.orbitClass }] : [],
              ).map(d => (
                <div key={d.label} style={{ padding: '6px 8px', borderRadius: 4, background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.08)' }}>
                  <div style={{ color: '#64748b', fontSize: 8, textTransform: 'uppercase' }}>{d.label}</div>
                  <div style={{ color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' }}>{d.value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {onTravelView && selected.tle1 && selected.tle2 && (
                <button
                  onClick={onTravelView}
                  style={{
                    flex: 1, padding: '6px', borderRadius: 4, border: 'none',
                    cursor: 'pointer', background: 'rgba(0,212,255,0.2)', color: '#00D4FF', fontSize: 9,
                    textTransform: 'uppercase',
                  }}
                >
                  <Satellite size={12} style={{ display: 'inline', marginRight: 4 }} />
                  Travel View
                </button>
              )}
              {(!selected.tle1 || !selected.tle2) && (
                <div style={{ flex: 1, padding: '6px', fontSize: 9, color: '#64748b', textAlign: 'center', alignSelf: 'center' }}>
                  Real-time tracking unavailable
                </div>
              )}
              <button
                onClick={() => { setSelected(null); setQuery(''); }}
                style={{
                  flex: 1, padding: '6px', borderRadius: 4, border: 'none',
                  cursor: 'pointer', background: 'rgba(0,212,255,0.15)', color: '#00D4FF', fontSize: 9,
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
