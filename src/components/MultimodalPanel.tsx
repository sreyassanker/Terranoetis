import { useState, useEffect, useCallback } from 'react';
import React from 'react';
import {
  Satellite, Radio, Radar, MessageCircle, Share2, Activity,
  Loader2, MapPin, RefreshCw, Flame, Droplets, Search,
} from 'lucide-react';
import Panel from '@/components/ui/Panel';

type Tab = 'status' | 'satellite' | 'seismic' | 'radar' | 'sentiment' | 'fusion';

const TABS: { id: Tab; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'status', label: 'Status', icon: <Activity size={12} />, color: '#64748b' },
  { id: 'satellite', label: 'Satellite', icon: <Satellite size={12} />, color: '#22c55e' },
  { id: 'seismic', label: 'Seismic', icon: <Radio size={12} />, color: '#ef4444' },
  { id: 'radar', label: 'Radar', icon: <Radar size={12} />, color: '#0ea5e9' },
  { id: 'sentiment', label: 'Sentiment', icon: <MessageCircle size={12} />, color: '#f59e0b' },
  { id: 'fusion', label: 'Fusion', icon: <Share2 size={12} />, color: '#a855f7' },
];

function renderJson(data: unknown): React.ReactNode {
  if (data == null) return <span style={{ color: '#64748b', fontSize: 10 }}>—</span>;
  if (typeof data === 'object') {
    if (Array.isArray(data)) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.map((item, i) => (
            <div key={i} style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.06)' }}>
              {renderJson(item)}
            </div>
          ))}
        </div>
      );
    }
    const entries = Object.entries(data as Record<string, unknown>).filter(([k]) => !k.startsWith('_'));
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px', fontSize: 10 }}>
        {entries.map(([k, v]) => (
          <React.Fragment key={k}>
            <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{k.replace(/([A-Z])/g, ' $1').trim()}</span>
            <span style={{ color: '#e2e8f0' }}>{renderJson(v)}</span>
          </React.Fragment>
        ))}
      </div>
    );
  }
  if (typeof data === 'boolean') return <span style={{ color: data ? '#22c55e' : '#ef4444', fontSize: 10 }}>{String(data)}</span>;
  return <span style={{ color: '#e2e8f0', fontSize: 10 }}>{String(data)}</span>;
}

export function MultimodalPanel({ onClose }: { onClose?: () => void }) {
  const [tab, setTab] = useState<Tab>('status');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<unknown>(null);
  const [lat, setLat] = useState('37.7749');
  const [lon, setLon] = useState('-122.4194');

  const api = useCallback(async (method: string, path: string, body?: unknown) => {
    setLoading(true);
    setError(null);
    try {
      const opts: RequestInit = { headers: { 'Content-Type': 'application/json' } };
      if (body) { opts.method = 'POST'; opts.body = JSON.stringify(body); }
      const res = await fetch(path, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const result = await res.json();
      setData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { api('GET', '/api/multimodal/status'); }, []);

  const tabColor = TABS.find(t => t.id === tab)?.color || '#64748b';

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex: 1000, width: 380 }}>
      <Panel title="MULTIMODAL" icon={TABS.find(t => t.id === tab)?.icon} accentColor={tabColor} onClose={onClose}
        headerExtra={
          <RefreshCw size={12} style={{ color: tabColor, cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); api('GET', `/api/multimodal/${tab === 'status' ? 'status' : ''}`); }} />
        }>
        {/* Tab bar */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${tabColor}20` }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => { setTab(t.id); setData(null); setError(null); }}
                  style={{
                    flex: 1, padding: '6px 4px', border: 'none', cursor: 'pointer',
                    background: tab === t.id ? `${t.color}20` : 'transparent',
                    color: tab === t.id ? t.color : '#64748b',
                    fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    borderBottom: tab === t.id ? `2px solid ${t.color}` : '2px solid transparent',
                  }}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {/* Satellite / Seismic / Radar lat/lon input */}
            {(tab === 'satellite' || tab === 'seismic' || tab === 'fusion') && (
              <div style={{ padding: '8px 14px', borderBottom: `1px solid ${tabColor}15`, display: 'flex', gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: tabColor, fontSize: 9 }}>LAT</div>
                  <input value={lat} onChange={e => setLat(e.target.value)}
                    style={{ width: '100%', padding: '3px 6px', background: 'rgba(0,0,0,0.3)', border: `1px solid ${tabColor}30`, borderRadius: 4, color: '#e2e8f0', fontSize: 10, fontFamily: 'monospace' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: tabColor, fontSize: 9 }}>LON</div>
                  <input value={lon} onChange={e => setLon(e.target.value)}
                    style={{ width: '100%', padding: '3px 6px', background: 'rgba(0,0,0,0.3)', border: `1px solid ${tabColor}30`, borderRadius: 4, color: '#e2e8f0', fontSize: 10, fontFamily: 'monospace' }} />
                </div>
              </div>
            )}

            {/* Action buttons per tab */}
            <div style={{ padding: '8px 14px', borderBottom: `1px solid ${tabColor}15`, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {tab === 'satellite' && (
                <>
                  <ActBtn label="Analyze" color="#22c55e" onClick={() => api('POST', '/api/multimodal/satellite/analyze', { lat: +lat, lon: +lon, radiusKm: 10 })} />
                  <ActBtn label="Change" color="#eab308" onClick={() => api('POST', '/api/multimodal/satellite/change', { lat: +lat, lon: +lon, daysBefore: 30 })} />
                  <ActBtn label="Fire Scars" color="#ef4444" icon={<Flame size={10} />} onClick={() => api('POST', '/api/multimodal/satellite/fire-scars', { lat: +lat, lon: +lon })} />
                  <ActBtn label="Flood" color="#3b82f6" icon={<Droplets size={10} />} onClick={() => api('POST', '/api/multimodal/satellite/flood-extent', { lat: +lat, lon: +lon })} />
                  <ActBtn label="Interpret" color="#a855f7" onClick={() => api('POST', '/api/multimodal/satellite/interpret', { lat: +lat, lon: +lon })} />
                </>
              )}
              {tab === 'seismic' && (
                <>
                  <ActBtn label="Events" color="#ef4444" onClick={() => api('GET', '/api/multimodal/seismic/events?minMag=2.5&hours=24')} />
                  <ActBtn label="History" color="#f59e0b" onClick={() => api('GET', `/api/multimodal/seismic/history?lat=${+lat}&lon=${+lon}&radius=2&limit=20`)} />
                  <ActBtn label="Poll" color="#06b6d4" onClick={() => api('POST', '/api/multimodal/seismic/poll')} />
                </>
              )}
              {tab === 'radar' && (
                <>
                  <ActBtn label="Scans" color="#0ea5e9" onClick={() => api('GET', '/api/multimodal/radar/scans?limit=10')} />
                  <ActBtn label="Fetch KTLX" color="#0284c7" onClick={() => api('POST', '/api/multimodal/radar/fetch', { station: 'KTLX' })} />
                  <ActBtn label="Precip" color="#06b6d4" onClick={() => api('POST', '/api/multimodal/radar/precipitation', { station: 'KTLX', dbz: 35 })} />
                </>
              )}
              {tab === 'sentiment' && (
                <>
                  <ActBtn label="Analyze" color="#f59e0b" onClick={() => api('POST', '/api/multimodal/sentiment/analyze', { text: 'Severe thunderstorm warning issued for Dallas-Fort Worth area' })} />
                </>
              )}
              {tab === 'fusion' && (
                <>
                  <ActBtn label="Events" color="#a855f7" onClick={() => api('GET', '/api/multimodal/fusion/events?limit=20')} />
                  <ActBtn label="Nearby" color="#c084fc" onClick={() => api('GET', `/api/multimodal/fusion/nearby?lat=${+lat}&lon=${+lon}&radius=1&limit=20`)} />
                  <ActBtn label="Fuse" color="#8b5cf6" onClick={() => api('POST', '/api/multimodal/fusion/fuse')} />
                </>
              )}
            </div>

            {error && <div style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 10 }}>{error}</div>}

            {/* Results */}
            <div style={{ padding: '10px 14px', maxHeight: 360, overflowY: 'auto', fontSize: 10 }}>
              {data ? renderJson(data)
                : loading
                  ? <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b' }}><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading...</div>
                  : <div style={{ color: '#64748b' }}>Select a tab and action</div>}
            </div>

            <div style={{ padding: '6px 14px', borderTop: `1px solid ${tabColor}15`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#475569', fontSize: 8 }}>multimodal/{tab}</span>
            </div>
      </Panel>
    </div>
  );
}

function ActBtn({ label, color, icon, onClick }: { label: string; color: string; icon?: React.ReactNode; onClick: () => void }) {
  const [loading, setLoading] = useState(false);
  return (
    <button onClick={async () => { setLoading(true); try { await onClick(); } finally { setLoading(false); } }}
      style={{
        padding: '4px 8px', borderRadius: 4, border: 'none',
        background: `${color}20`, color: '#e2e8f0', fontSize: 9,
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        opacity: loading ? 0.6 : 1,
      }}>
      {loading ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : icon}
      {label}
    </button>
  );
}

export default MultimodalPanel;
