import { useState, useCallback, useEffect } from 'react';
import { Search, Loader2, Globe, Database, Play, Square } from 'lucide-react';
import Panel from '@/components/ui/Panel';

interface SearchResult {
  lat: number; lon: number; classLabel: string; confidence: number; similarity?: number; fetchedAt: string;
}

interface SeederStatus {
  running: boolean;
  spacingDeg: number;
  totalCells: number;
  completedCells: number;
  percentComplete: number;
  lastLat: number | null;
  lastLon: number | null;
  lastError: string | null;
  activeJobs: number;
}

interface Props {
  onClose?: () => void;
  onResults?: (results: Array<{ lat: number; lon: number; classLabel: string; similarity?: number }>) => void;
  onFlyTo?: (lat: number, lon: number, options?: { label?: string; color?: string; height?: number }) => void;
}

export function SatelliteSearchPanel({ onClose, onResults, onFlyTo }: Props) {
  const [query, setQuery] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [radius, setRadius] = useState('100');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'text' | 'geo' | 'class'>('text');
  const [classes, setClasses] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [seederStatus, setSeederStatus] = useState<SeederStatus | null>(null);
  const [showSeeder, setShowSeeder] = useState(false);

  const loadClasses = useCallback(async () => {
    try {
      const res = await fetch('/api/fm/search/classes');
      const data = await res.json();
      setClasses(data.classes);
    } catch { /* ignore */ }
  }, []);

  const fetchSeederStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/fm/seeder/status');
      const data = await res.json();
      setSeederStatus(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadClasses(); }, [loadClasses]);

  const doSearch = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let url = '/api/fm/search?limit=20';
      if (mode === 'text' && query) url += `&text=${encodeURIComponent(query)}`;
      if (mode === 'geo' && lat && lon) url += `&lat=${lat}&lon=${lon}&radiusKm=${radius || '100'}`;
      if (mode === 'class' && selectedClass) url += `&classLabel=${selectedClass}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error((await res.json()).error || 'Search failed');
      const data = await res.json();
      setResults(data.results || []);
      setTotal(data.total || 0);
      onResults?.(data.results || []);
      if (data.results?.length > 0 && onFlyTo) {
        onFlyTo(data.results[0].lat, data.results[0].lon, { label: data.results[0].classLabel.replace(/_/g, ' ') });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally { setLoading(false); }
  }, [query, lat, lon, radius, mode, selectedClass, onResults, onFlyTo]);

  const handleSeedLocation = async (sLat: number, sLon: number) => {
    try {
      await fetch('/api/fm/seeder/seed-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: sLat, lon: sLon }),
      });
      fetchSeederStatus();
    } catch { /* ignore */ }
  };

  const handleStartSeeder = async () => {
    try {
      await fetch('/api/fm/seeder/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: true }),
      });
      fetchSeederStatus();
    } catch { /* ignore */ }
  };

  const handleStopSeeder = async () => {
    try {
      await fetch('/api/fm/seeder/stop', { method: 'POST' });
      fetchSeederStatus();
    } catch { /* ignore */ }
  };

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex: 1000, width: 340 }}>
      <Panel title="EO IMAGE SEARCH" icon={<Search size={16} />} accentColor="#22c55e" iconColor="#34d399" titleColor="#6ee7b7" onClose={onClose}>

      <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(34,197,94,0.1)' }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {(['text', 'geo', 'class'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{
                flex: 1, padding: '4px', borderRadius: 4, border: 'none', cursor: 'pointer',
                background: mode === m ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.05)',
                color: mode === m ? '#6ee7b7' : '#64748b', fontSize: 9, textTransform: 'uppercase',
              }}>{m}</button>
          ))}
        </div>

        {mode === 'text' && (
          <div style={{ display: 'flex', gap: 4 }}>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder='e.g., "forest near coast"'
              style={{ flex: 1, padding: '6px 8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(34,197,94,0.2)',
                borderRadius: 4, color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' }} />
            <button onClick={doSearch} disabled={loading || !query}
              style={{ padding: '6px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                background: loading ? 'rgba(34,197,94,0.3)' : 'rgba(34,197,94,0.6)', color: '#e2e8f0', fontSize: 10 }}>
              {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : 'GO'}
            </button>
          </div>
        )}

        {mode === 'geo' && (
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <input value={lat} onChange={e => setLat(e.target.value)} placeholder="Latitude"
                style={{ flex: 1, padding: '4px 6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(34,197,94,0.2)',
                  borderRadius: 4, color: '#e2e8f0', fontSize: 10, fontFamily: 'monospace' }} />
              <input value={lon} onChange={e => setLon(e.target.value)} placeholder="Longitude"
                style={{ flex: 1, padding: '4px 6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(34,197,94,0.2)',
                  borderRadius: 4, color: '#e2e8f0', fontSize: 10, fontFamily: 'monospace' }} />
              <input value={radius} onChange={e => setRadius(e.target.value)} placeholder="km"
                style={{ width: 50, padding: '4px 6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(34,197,94,0.2)',
                  borderRadius: 4, color: '#e2e8f0', fontSize: 10, fontFamily: 'monospace' }} />
            </div>
            <button onClick={doSearch} disabled={loading || !lat || !lon}
              style={{ width: '100%', padding: '5px', borderRadius: 4, border: 'none', cursor: 'pointer',
                background: loading ? 'rgba(34,197,94,0.3)' : 'rgba(34,197,94,0.6)', color: '#e2e8f0', fontSize: 10 }}>
              {loading ? <Loader2 size={12} /> : 'SEARCH NEARBY'}
            </button>
          </div>
        )}

        {mode === 'class' && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {classes.map(c => (
              <button key={c} onClick={() => { setSelectedClass(c); }}
                style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid rgba(34,197,94,0.2)', cursor: 'pointer',
                  background: selectedClass === c ? 'rgba(34,197,94,0.3)' : 'transparent',
                  color: selectedClass === c ? '#6ee7b7' : '#94a3b8', fontSize: 9 }}>
                {c.replace(/_/g, ' ')}
              </button>
            ))}
            {selectedClass && (
              <button onClick={() => doSearch()} disabled={loading}
                style={{ padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                  background: 'rgba(34,197,94,0.6)', color: '#e2e8f0', fontSize: 9 }}>
                {loading ? <Loader2 size={10} /> : 'FILTER'}
              </button>
            )}
          </div>
        )}
      </div>

      {error && <div style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 10 }}>{error}</div>}

      <div style={{ padding: '10px 14px', maxHeight: 300, overflowY: 'auto' }}>
        <div style={{ color: '#6ee7b7', fontSize: 9, marginBottom: 6 }}>{total} RESULT{total !== 1 ? 'S' : ''}</div>
        {results.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 10, textAlign: 'center', padding: 20 }}>No results found. The database may be empty — start the seeder below to populate it with real Sentinel-2 data.</div>
        ) : (
          results.map((r, i) => (
            <div key={i}
              onClick={() => onFlyTo?.(r.lat, r.lon, { label: r.classLabel.replace(/_/g, ' ') })}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', marginBottom: 4,
                borderRadius: 6, background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.1)',
                cursor: onFlyTo ? 'pointer' : 'default' }}>
              <Globe size={12} style={{ color: '#34d399' }} />
              <div style={{ flex: 1 }}>
                <div style={{ color: '#e2e8f0', fontSize: 10 }}>{r.lat.toFixed(3)}, {r.lon.toFixed(3)}</div>
                <div style={{ color: '#22c55e', fontSize: 9 }}>{r.classLabel.replace(/_/g, ' ')}</div>
              </div>
              {r.similarity != null && <span style={{ color: '#94a3b8', fontSize: 9 }}>{(r.similarity * 100).toFixed(0)}%</span>}
              <button onClick={e => { e.stopPropagation(); handleSeedLocation(r.lat, r.lon); }}
                style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(34,197,94,0.3)', cursor: 'pointer',
                  background: 'transparent', color: '#34d399', fontSize: 8 }} title="Re-analyze this location">
                <Database size={10} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Seeder Controls */}
      <div style={{ borderTop: '1px solid rgba(34,197,94,0.1)' }}>
        <button onClick={() => { setShowSeeder(p => !p); if (!showSeeder) fetchSeederStatus(); }}
          style={{ width: '100%', padding: '6px 14px', border: 'none', cursor: 'pointer',
            background: 'transparent', color: '#6ee7b7', fontSize: 9, textTransform: 'uppercase' }}>
          <Database size={10} style={{ marginRight: 4 }} />Database Seeder {showSeeder ? '▲' : '▼'}
        </button>
        {showSeeder && (
          <div style={{ padding: '8px 14px' }}>
            {seederStatus && (
              <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Progress</span>
                  <span style={{ color: '#6ee7b7' }}>{seederStatus.percentComplete}%</span>
                </div>
                <div style={{ width: '100%', height: 4, background: 'rgba(34,197,94,0.1)', borderRadius: 2, margin: '4 0', overflow: 'hidden' }}>
                  <div style={{ width: `${seederStatus.percentComplete}%`, height: '100%', background: '#22c55e', borderRadius: 2 }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span>{seederStatus.completedCells}/{seederStatus.totalCells} cells</span>
                  <span style={{ color: seederStatus.running ? '#22c55e' : '#64748b' }}>
                    {seederStatus.running ? 'RUNNING' : 'IDLE'}
                  </span>
                </div>
                {seederStatus.lastError && (
                  <div style={{ color: '#ef4444', marginTop: 4, wordBreak: 'break-all' }}>Last error: {seederStatus.lastError}</div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4 }}>
              {!seederStatus?.running ? (
                <button onClick={handleStartSeeder}
                  style={{ flex: 1, padding: '4px', borderRadius: 4, border: 'none', cursor: 'pointer',
                    background: 'rgba(34,197,94,0.6)', color: '#e2e8f0', fontSize: 9 }}>
                  <Play size={10} style={{ marginRight: 4 }} />Start Seeder
                </button>
              ) : (
                <button onClick={handleStopSeeder}
                  style={{ flex: 1, padding: '4px', borderRadius: 4, border: 'none', cursor: 'pointer',
                    background: 'rgba(239,68,68,0.6)', color: '#e2e8f0', fontSize: 9 }}>
                  <Square size={10} style={{ marginRight: 4 }} />Stop Seeder
                </button>
              )}
            </div>
          </div>
        )}
      </div>

    </Panel>
    </div>
  );
}
