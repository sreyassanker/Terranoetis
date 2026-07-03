import { useState, useCallback, useEffect } from 'react';
import { Crosshair, X, Circle, Plus, Trash2 } from 'lucide-react';

export function Tile38Panel({ onClose }: { onClose?: () => void }) {
  const [tab, setTab] = useState<'status' | 'fences' | 'objects'>('status');
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [fences, setFences] = useState<Array<Record<string, unknown>>>([]);
  const [objects, setObjects] = useState<Array<Record<string, unknown>>>([]);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fenceId, setFenceId] = useState('');
  const [fenceLat, setFenceLat] = useState('37.7749');
  const [fenceLon, setFenceLon] = useState('-122.4194');
  const [fenceRadius, setFenceRadius] = useState('50000');

  const fetchStatus = useCallback(async () => {
    try {
      const [s, f, o, e] = await Promise.all([
        fetch('/api/tile38/status').then(r => r.json()),
        fetch('/api/tile38/fences').then(r => r.json()),
        fetch('/api/tile38/objects').then(r => r.json()),
        fetch('/api/tile38/events').then(r => r.json()),
      ]);
      setStatus(s.status);
      setFences(f.fences);
      setObjects(o.objects);
      setEvents(e.events);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const createFence = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/tile38/fence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fenceId, type: 'circle', params: { lat: parseFloat(fenceLat), lon: parseFloat(fenceLon), meters: parseInt(fenceRadius) } }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setFenceId(''); await fetchStatus();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, [fenceId, fenceLat, fenceLon, fenceRadius, fetchStatus]);

  const deleteFence = useCallback(async (id: string) => {
    await fetch(`/api/tile38/fence/${id}`, { method: 'DELETE' });
    await fetchStatus();
  }, [fetchStatus]);

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, width: 340,
      background: 'rgba(10,10,30,0.92)', border: '1px solid rgba(249,115,22,0.3)',
      borderRadius: 12, overflow: 'hidden', fontFamily: 'monospace', fontSize: 12, zIndex: 1000,
      backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px',
        background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(234,88,12,0.1))',
        borderBottom: '1px solid rgba(249,115,22,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Crosshair size={16} style={{ color: '#fb923c' }} />
          <span style={{ color: '#fdba74', fontWeight: 600, fontSize: 11, letterSpacing: 1 }}>GEOFENCING</span>
        </div>
        {onClose && <X size={14} style={{ color: '#64748b', cursor: 'pointer' }} onClick={onClose} />}
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '8px 14px', borderBottom: '1px solid rgba(249,115,22,0.1)' }}>
        {(['status', 'fences', 'objects'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex: 1, padding: '4px', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: tab === t ? 'rgba(249,115,22,0.3)' : 'transparent',
              color: tab === t ? '#fdba74' : '#64748b', fontSize: 9, textTransform: 'uppercase' }}>{t}</button>
        ))}
      </div>

      {error && <div style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 10 }}>{error}</div>}

      <div style={{ padding: '10px 14px', maxHeight: 380, overflowY: 'auto' }}>
        {tab === 'status' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 10 }}>
              <span style={{ color: '#64748b' }}>Geofences</span><span style={{ color: '#e2e8f0' }}>{(status?.geofences as number) || 0}</span>
              <span style={{ color: '#64748b' }}>Tracked Objects</span><span style={{ color: '#e2e8f0' }}>{(status?.trackedObjects as number) || 0}</span>
              <span style={{ color: '#64748b' }}>Recent Events</span><span style={{ color: '#e2e8f0' }}>{(status?.recentEvents as number) || 0}</span>
            </div>
            <button onClick={fetchStatus} style={{ width: '100%', marginTop: 8, padding: '4px', borderRadius: 4, border: 'none',
              background: 'rgba(249,115,22,0.2)', color: '#fdba74', fontSize: 9, cursor: 'pointer' }}>
              REFRESH
            </button>
          </div>
        )}

        {tab === 'fences' && (
          <div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              <input value={fenceId} onChange={e => setFenceId(e.target.value)} placeholder="Fence ID"
                style={{ width: 80, padding: '3px 5px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(249,115,22,0.2)',
                  borderRadius: 4, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }} />
              <input value={fenceLat} onChange={e => setFenceLat(e.target.value)} placeholder="Lat"
                style={{ width: 60, padding: '3px 5px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(249,115,22,0.2)',
                  borderRadius: 4, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }} />
              <input value={fenceLon} onChange={e => setFenceLon(e.target.value)} placeholder="Lon"
                style={{ width: 60, padding: '3px 5px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(249,115,22,0.2)',
                  borderRadius: 4, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }} />
              <input value={fenceRadius} onChange={e => setFenceRadius(e.target.value)} placeholder="m"
                style={{ width: 50, padding: '3px 5px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(249,115,22,0.2)',
                  borderRadius: 4, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }} />
            </div>
            <button onClick={createFence} disabled={loading || !fenceId}
              style={{ width: '100%', padding: '4px', borderRadius: 4, border: 'none', cursor: 'pointer',
                marginBottom: 8, background: 'rgba(249,115,22,0.5)', color: '#e2e8f0', fontSize: 9,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <Plus size={10} /> ADD FENCE
            </button>
            {fences.map((f: Record<string, unknown>, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', marginBottom: 4,
                borderRadius: 6, background: 'rgba(249,115,22,0.05)', border: '1px solid rgba(249,115,22,0.1)' }}>
                <Circle size={10} style={{ color: '#fb923c' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#e2e8f0', fontSize: 10 }}>{f.id as string}</div>
                  <div style={{ color: '#94a3b8', fontSize: 8 }}>{f.type as string} · {JSON.stringify(f.params)}</div>
                </div>
                <Trash2 size={12} style={{ color: '#ef4444', cursor: 'pointer' }} onClick={() => deleteFence(f.id as string)} />
              </div>
            ))}
            {fences.length === 0 && <div style={{ color: '#64748b', fontSize: 10, textAlign: 'center', padding: 10 }}>No geofences</div>}
          </div>
        )}

        {tab === 'objects' && (
          <div>
            <div style={{ color: '#fdba74', fontSize: 9, marginBottom: 6 }}>TRACKED OBJECTS</div>
            {objects.map((o: Record<string, unknown>, i: number) => (
              <div key={i} style={{ padding: '6px 8px', marginBottom: 4, borderRadius: 6,
                background: 'rgba(249,115,22,0.05)', border: '1px solid rgba(249,115,22,0.1)' }}>
                <div style={{ color: '#e2e8f0', fontSize: 10, fontWeight: 600 }}>{o.id as string}</div>
                <div style={{ color: '#94a3b8', fontSize: 9 }}>{(o.lat as number).toFixed(4)}, {(o.lon as number).toFixed(4)}</div>
                {!!o.properties && <div style={{ color: '#64748b', fontSize: 8 }}>{JSON.stringify(o.properties)}</div>}
              </div>
            ))}
            <div style={{ color: '#fdba74', fontSize: 9, marginTop: 8, marginBottom: 4 }}>RECENT EVENTS</div>
            {events.slice(-5).reverse().map((e: Record<string, unknown>, i: number) => (
              <div key={i} style={{ color: '#94a3b8', fontSize: 9, padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <span style={{ color: e.action === 'enter' ? '#22c55e' : e.action === 'exit' ? '#ef4444' : '#fbbf24' }}>{e.action as string}</span>
                {' '}{e.objectId as string} → {e.fenceId as string}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
