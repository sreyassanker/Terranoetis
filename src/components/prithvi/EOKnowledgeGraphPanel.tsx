import { useState, useCallback, useEffect } from 'react';
import { Network, Search, MapPin, Loader2, X, BookOpen, Globe, Satellite } from 'lucide-react';

const TYPE_ICONS: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = { Planet: Globe, Satellite, LandCover: MapPin, FoundationModel: BookOpen, GeoLocation: MapPin };

export function EOKnowledgeGraphPanel({ onClose }: { onClose?: () => void }) {
  const [query, setQuery] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [entities, setEntities] = useState<Array<Record<string, unknown>>>([]);
  const [curated, setCurated] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'search' | 'curated'>('curated');

  useEffect(() => {
    fetch('/api/fm/kg/entities').then(r => r.json()).then(d => setCurated(d.entities)).catch(() => {});
  }, []);

  const doSearch = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let url = '/api/fm/kg/search?limit=15';
      if (query) url += `&text=${encodeURIComponent(query)}`;
      if (lat && lon) url += `&lat=${lat}&lon=${lon}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setEntities(data.entities);
      setTab('search');
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, [query, lat, lon]);

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, width: 340,
      background: 'rgba(10,10,30,0.92)', border: '1px solid rgba(139,92,246,0.3)',
      borderRadius: 12, overflow: 'hidden', fontFamily: 'monospace', fontSize: 12, zIndex: 1000,
      backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px',
        background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(168,85,247,0.1))',
        borderBottom: '1px solid rgba(139,92,246,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Network size={16} style={{ color: '#a78bfa' }} />
          <span style={{ color: '#c4b5fd', fontWeight: 600, fontSize: 11, letterSpacing: 1 }}>EO KNOWLEDGE GRAPH</span>
        </div>
        {onClose && <X size={14} style={{ color: '#64748b', cursor: 'pointer' }} onClick={onClose} />}
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '8px 14px', borderBottom: '1px solid rgba(139,92,246,0.1)' }}>
        {(['search', 'curated'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex: 1, padding: '4px', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: tab === t ? 'rgba(139,92,246,0.3)' : 'transparent',
              color: tab === t ? '#a78bfa' : '#64748b', fontSize: 9, textTransform: 'uppercase' }}>{t}</button>
        ))}
      </div>

      <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(139,92,246,0.1)' }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder='e.g., "Sentinel", "forest"'
            style={{ flex: 1, padding: '5px 8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(139,92,246,0.2)',
              borderRadius: 4, color: '#e2e8f0', fontSize: 10, fontFamily: 'monospace' }} />
          <button onClick={doSearch} disabled={loading || (!query && !lat)}
            style={{ padding: '5px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: loading ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.6)', color: '#e2e8f0', fontSize: 10 }}>
            {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={12} />}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input value={lat} onChange={e => setLat(e.target.value)} placeholder="Lat (optional)"
            style={{ flex: 1, padding: '3px 6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(139,92,246,0.2)',
              borderRadius: 4, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }} />
          <input value={lon} onChange={e => setLon(e.target.value)} placeholder="Lon (optional)"
            style={{ flex: 1, padding: '3px 6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(139,92,246,0.2)',
              borderRadius: 4, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }} />
        </div>
      </div>

      {error && <div style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 10 }}>{error}</div>}

      <div style={{ padding: '10px 14px', maxHeight: 380, overflowY: 'auto' }}>
        {tab === 'search' && entities.length === 0 && (
          <div style={{ color: '#64748b', fontSize: 10, textAlign: 'center', padding: 20 }}>No entities found</div>
        )}
        {tab === 'search' && entities.map((e: Record<string, unknown>, i: number) => {
          const Icon = TYPE_ICONS[e.type as string] || MapPin;
          return (
            <div key={i} style={{ padding: '8px', marginBottom: 4, borderRadius: 6,
              background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <Icon size={12} style={{ color: '#a78bfa' }} />
                <span style={{ color: '#e2e8f0', fontSize: 10, fontWeight: 600 }}>{e.name as string}</span>
                <span style={{ color: '#64748b', fontSize: 8, marginLeft: 'auto' }}>{e.source as string}</span>
              </div>
              <div style={{ color: '#94a3b8', fontSize: 9 }}>{e.type as string}</div>
              {!!e.description && <div style={{ color: '#64748b', fontSize: 8, marginTop: 2 }}>{(e.description as string).slice(0, 100)}</div>}
              {!!(e.lat || e.lon) && <div style={{ color: '#475569', fontSize: 8, marginTop: 2 }}>{(e.lat as number)?.toFixed(2)}, {(e.lon as number)?.toFixed(2)}</div>}
            </div>
          );
        })}

        {tab === 'curated' && (
          <div>
            <div style={{ color: '#a78bfa', fontSize: 9, marginBottom: 6 }}>CURATED EO ENTITIES</div>
            {curated.map((e: Record<string, unknown>, i: number) => (
              <div key={i} style={{ padding: '6px 8px', marginBottom: 4, borderRadius: 6,
                background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#e2e8f0', fontSize: 10, fontWeight: 600 }}>{e.name as string}</span>
                  <span style={{ color: '#64748b', fontSize: 8 }}>{e.type as string}</span>
                </div>
                {!!e.description && <div style={{ color: '#94a3b8', fontSize: 9, marginTop: 2 }}>{e.description as string}</div>}
                {!!e.properties && Object.keys(e.properties as Record<string, unknown>).length > 0 && (
                  <div style={{ color: '#475569', fontSize: 8, marginTop: 2 }}>
                    {Object.entries(e.properties).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
