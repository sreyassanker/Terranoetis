import { useState, useCallback } from 'react';
import { Search, Loader2, X, Globe } from 'lucide-react';

interface SearchResult {
  lat: number; lon: number; classLabel: string; confidence: number; similarity?: number; fetchedAt: string;
}

export function SatelliteSearchPanel({ onClose }: { onClose?: () => void }) {
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

  const loadClasses = useCallback(async () => {
    try {
      const res = await fetch('/api/fm/search/classes');
      const data = await res.json();
      setClasses(data.classes);
    } catch { /* ignore */ }
  }, []);

  useState(() => { loadClasses(); });

  const doSearch = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let url = '/api/fm/search?limit=20';
      if (mode === 'text' && query) url += `&text=${encodeURIComponent(query)}`;
      if (mode === 'geo' && lat && lon) url += `&lat=${lat}&lon=${lon}&radiusKm=${radius || '100'}`;
      if (mode === 'class' && selectedClass) url += `&classLabel=${selectedClass}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setResults(data.results);
      setTotal(data.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setLoading(false); }
  }, [query, lat, lon, radius, mode, selectedClass]);

  return (
    <div style={{
      position: 'absolute', top: 60, right: 10, width: 340,
      background: 'rgba(10,10,30,0.92)', border: '1px solid rgba(34,197,94,0.3)',
      borderRadius: 12, overflow: 'hidden', fontFamily: 'monospace', fontSize: 12, zIndex: 1000,
      backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px',
        background: 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(16,185,129,0.1))',
        borderBottom: '1px solid rgba(34,197,94,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={16} style={{ color: '#34d399' }} />
          <span style={{ color: '#6ee7b7', fontWeight: 600, fontSize: 11, letterSpacing: 1 }}>SATELLITE SEARCH</span>
        </div>
        {onClose && <X size={14} style={{ color: '#64748b', cursor: 'pointer' }} onClick={onClose} />}
      </div>

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

      <div style={{ padding: '10px 14px', maxHeight: 350, overflowY: 'auto' }}>
        <div style={{ color: '#6ee7b7', fontSize: 9, marginBottom: 6 }}>{total} RESULT{total !== 1 ? 'S' : ''}</div>
        {results.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 10, textAlign: 'center', padding: 20 }}>No results found</div>
        ) : (
          results.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', marginBottom: 4,
              borderRadius: 6, background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.1)' }}>
              <Globe size={12} style={{ color: '#34d399' }} />
              <div style={{ flex: 1 }}>
                <div style={{ color: '#e2e8f0', fontSize: 10 }}>{r.lat.toFixed(3)}, {r.lon.toFixed(3)}</div>
                <div style={{ color: '#22c55e', fontSize: 9 }}>{r.classLabel.replace(/_/g, ' ')}</div>
              </div>
              {r.similarity != null && <span style={{ color: '#94a3b8', fontSize: 9 }}>{(r.similarity * 100).toFixed(0)}%</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
