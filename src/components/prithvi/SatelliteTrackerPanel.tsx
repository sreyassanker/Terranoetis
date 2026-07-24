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

  useEffect(() => {
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch('/api/satellites/tle')
      .then(r => r.json())
      .then((data: SatelliteData[]) => {
        setAllSats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

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

          {suggestions.length > 0 && !selected && (
            <div style={{ marginTop: 6, maxHeight: 250, overflowY: 'auto', borderRadius: 4, background: 'rgba(0,0,0,0.4)' }}>
              {suggestions.map(s => (
                <div
                  key={s.id}
                  onClick={() => handleSelect(s)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
                    cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.03)',
                    opacity: s.tle1 && s.tle2 ? 1 : 0.6,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,212,255,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {s.tle1 && s.tle2
                    ? <Satellite size={12} style={{ color: '#00D4FF', flexShrink: 0 }} />
                    : <EyeOff size={12} style={{ color: '#64748b', flexShrink: 0 }} />
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: '#e2e8f0', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                      <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: SOURCE_BG[s.source] ?? 'rgba(100,116,139,0.2)', color: SOURCE_COLORS[s.source] ?? '#94a3b8', flexShrink: 0 }}>{s.source}</span>
                    </div>
                    <div style={{ color: '#64748b', fontSize: 9 }}>
                      {s.tle1 && s.tle2 ? `NORAD ${s.id}` : s.source === 'UCS' ? (s.country ?? s.orbitClass ?? 'Satellite') : `v${s.version ?? '?'}`}
                      {s.altitude != null ? ` · ${s.altitude.toLocaleString()}m` : ''}
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
