import { useState, useEffect, useCallback, useRef } from 'react';
import { Satellite, Search, Loader2, MapPin, Globe } from 'lucide-react';
import Panel from '@/components/ui/Panel';

interface SatelliteData {
  id: string;
  name: string;
  lat: number;
  lon: number;
  altitude: number;
  inclination: number;
  meanMotion: number;
  epoch: string;
  tle1: string;
  tle2: string;
}

export function SatelliteTrackerPanel({ onClose, onTrackSatellite }: { onClose?: () => void; onTrackSatellite?: (sat: { id: string; name: string; lat: number; lon: number; altitude: number; tle1: string; tle2: string }) => void }) {
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

  const suggestions = query.trim()
    ? allSats
        .filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 20)
    : [];

  const handleSelect = useCallback((sat: SatelliteData) => {
    setSelected(sat);
    setQuery(sat.name);
    if (onTrackSatellite) {
      onTrackSatellite({ id: sat.id, name: sat.name, lat: sat.lat, lon: sat.lon, altitude: sat.altitude, tle1: sat.tle1, tle2: sat.tle2 });
    }
  }, [onTrackSatellite]);

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex: 1000, width: 340 }}>
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
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,212,255,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Satellite size={12} style={{ color: '#00D4FF', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#e2e8f0', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div style={{ color: '#64748b', fontSize: 9 }}>NORAD {s.id} · {s.altitude.toLocaleString()}m</div>
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
              <Satellite size={18} style={{ color: '#00D4FF' }} />
              <div>
                <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{selected.name}</div>
                <div style={{ color: '#64748b', fontSize: 9 }}>NORAD {selected.id}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                { label: 'Latitude', value: `${selected.lat.toFixed(3)}°${selected.lat >= 0 ? 'N' : 'S'}` },
                { label: 'Longitude', value: `${selected.lon.toFixed(3)}°${selected.lon >= 0 ? 'E' : 'W'}` },
                { label: 'Altitude', value: `${selected.altitude.toLocaleString()} m` },
                { label: 'Inclination', value: `${selected.inclination.toFixed(2)}°` },
              ].map(d => (
                <div key={d.label} style={{ padding: '6px 8px', borderRadius: 4, background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.08)' }}>
                  <div style={{ color: '#64748b', fontSize: 8, textTransform: 'uppercase' }}>{d.label}</div>
                  <div style={{ color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' }}>{d.value}</div>
                </div>
              ))}
            </div>
            <button
              onClick={() => { setSelected(null); setQuery(''); }}
              style={{
                marginTop: 10, width: '100%', padding: '6px', borderRadius: 4, border: 'none',
                cursor: 'pointer', background: 'rgba(0,212,255,0.15)', color: '#00D4FF', fontSize: 9,
                textTransform: 'uppercase',
              }}
            >
              <MapPin size={12} style={{ display: 'inline', marginRight: 4 }} />
              Search another satellite
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}
