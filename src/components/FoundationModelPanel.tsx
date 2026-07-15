import React, { useState, useEffect, useCallback } from 'react';
import {
  Brain, Globe, MapPin, Activity, Search, RefreshCw, Loader2,
  ChevronDown, ChevronRight, Satellite, Flame, Car, Rocket,
  Cloud, Wheat, Layers, Cpu,
} from 'lucide-react';
import Panel from '@/components/ui/Panel';

interface FmStatus {
  ready?: boolean;
  loading?: boolean;
  modelPath?: string;
  [key: string]: unknown;
}

interface ModelDef {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  desc: string;
  path: string;
  actions: ActionDef[];
}

interface ActionDef {
  id: string;
  label: string;
  method: 'GET' | 'POST';
  path: string;
  needsLatLon?: boolean;
  needsCorridorId?: boolean;
  needsYear?: boolean;
  body?: (lat: number, lon: number, opts: Record<string, string>) => Record<string, unknown>;
}

const MODELS: ModelDef[] = [
  {
    id: 'clay', name: 'Clay v1', icon: <Layers size={14} />, color: '#06b6d4',
    desc: 'Multi-sensor geospatial foundation model (sentinel-2, landsat)',
    path: '/api/fm/clay',
    actions: [
      { id: 'status', label: 'Status', method: 'GET', path: '/status' },
      { id: 'analyze', label: 'Analyze', method: 'POST', path: '/analyze', needsLatLon: true, body: (lat, lon) => ({ lat, lon, sensor: 'sentinel-2' }) },
      { id: 'flood-sar', label: 'Flood SAR', method: 'POST', path: '/flood-sar', needsLatLon: true, body: (lat, lon) => ({ lat, lon }) },
    ],
  },
  {
    id: 'unet', name: 'U-Net', icon: <Cpu size={14} />, color: '#8b5cf6',
    desc: 'Semantic segmentation model for land cover',
    path: '/api/fm/unet',
    actions: [
      { id: 'status', label: 'Status', method: 'GET', path: '/status' },
      { id: 'segment', label: 'Segment', method: 'POST', path: '/segment', needsLatLon: true, body: (lat, lon) => ({ lat, lon }) },
      { id: 'change', label: 'Change', method: 'POST', path: '/change', needsLatLon: true, body: (lat, lon) => ({ lat, lon }) },
    ],
  },
  {
    id: 'samgeo', name: 'SAM-Geo', icon: <Globe size={14} />, color: '#22c55e',
    desc: 'Segment Anything for geospatial imagery',
    path: '/api/fm/samgeo',
    actions: [
      { id: 'status', label: 'Status', method: 'GET', path: '/status' },
      { id: 'segment', label: 'Segment', method: 'POST', path: '/segment', needsLatLon: true, body: (lat, lon) => ({ lat, lon }) },
    ],
  },
  {
    id: 'weather', name: 'Weather FM', icon: <Cloud size={14} />, color: '#0ea5e9',
    desc: 'AI weather forecasting model',
    path: '/api/fm/weather',
    actions: [
      { id: 'status', label: 'Status', method: 'GET', path: '/status' },
      { id: 'forecast', label: 'Forecast', method: 'POST', path: '/forecast', needsLatLon: true, body: (lat, lon, o) => ({ lat, lon, forecastDays: parseInt(o.days) || 7 }) },
      { id: 'anomalies', label: 'Anomalies', method: 'POST', path: '/anomalies', needsLatLon: false, body: () => ({}) },
    ],
  },
  {
    id: 'agri', name: 'Agri Monitor', icon: <Wheat size={14} />, color: '#84cc16',
    desc: 'AI crop health and agriculture monitoring',
    path: '/api/fm/agri',
    actions: [
      { id: 'status', label: 'Status', method: 'GET', path: '/status' },
      { id: 'analyze', label: 'Analyze Crop', method: 'POST', path: '/analyze', needsLatLon: true, body: (lat, lon) => ({ lat, lon }) },
      { id: 'alerts', label: 'Alerts', method: 'GET', path: '/alerts' },
    ],
  },
  {
    id: 'alpha', name: 'AlphaEarth', icon: <Search size={14} />, color: '#f59e0b',
    desc: 'Location embedding & temporal change lookup',
    path: '/api/fm/alpha',
    actions: [
      { id: 'status', label: 'Status', method: 'GET', path: '/status' },
      { id: 'lookup', label: 'Lookup', method: 'POST', path: '/lookup', needsLatLon: true, needsYear: true, body: (lat, lon, o) => ({ lat, lon, year: parseInt(o.year) || 2024 }) },
      { id: 'change', label: 'Change', method: 'POST', path: '/change', needsLatLon: true, body: (lat, lon, o) => ({ lat, lon, yearStart: parseInt(o.yearStart) || 2020, yearEnd: parseInt(o.yearEnd) || 2024 }) },
      { id: 'similar', label: 'Similar', method: 'POST', path: '/similar', needsLatLon: true, body: (lat, lon) => ({ lat, lon, topK: 5 }) },
    ],
  },
  {
    id: 'road-traffic', name: 'Road Traffic', icon: <Car size={14} />, color: '#ef4444',
    desc: 'Satellite-derived road traffic analysis',
    path: '/api/road-traffic',
    actions: [
      { id: 'status', label: 'Status', method: 'GET', path: '/status' },
      { id: 'corridors', label: 'Corridors', method: 'GET', path: '/corridors' },
      { id: 'analyze', label: 'Analyze', method: 'POST', path: '/analyze', needsCorridorId: true, body: (lat, lon, o) => ({ corridorId: o.corridorId }) },
      { id: 'trends', label: 'Trends', method: 'GET', path: '/trends/{{corridorId}}', needsCorridorId: true },
    ],
  },
  {
    id: 'spacex', name: 'SpaceX', icon: <Rocket size={14} />, color: '#ec4899',
    desc: 'SpaceX launch & Starlink data',
    path: '/api/spacex',
    actions: [
      { id: 'status', label: 'Status', method: 'GET', path: '/status' },
      { id: 'launches', label: 'Launches', method: 'GET', path: '/launches?limit=20' },
      { id: 'starlink', label: 'Starlink', method: 'GET', path: '/starlink' },
      { id: 'correlations', label: 'Correlations', method: 'GET', path: '/correlations' },
    ],
  },
  {
    id: 'bayfire', name: 'BayFire', icon: <Flame size={14} />, color: '#f97316',
    desc: 'Bayesian wildfire detection & clustering',
    path: '/api/bayfire',
    actions: [
      { id: 'status', label: 'Status', method: 'GET', path: '/status' },
      { id: 'clusters', label: 'Clusters', method: 'GET', path: '/clusters' },
      { id: 'results', label: 'Results', method: 'GET', path: '/results?limit=50' },
    ],
  },
  {
    id: 'prithvi-v2', name: 'Prithvi V2', icon: <Satellite size={14} />, color: '#6366f1',
    desc: 'NASA/IBM Prithvi-EO v2 geospatial FM',
    path: '/api/fm/prithvi-v2',
    actions: [
      { id: 'status', label: 'Status', method: 'GET', path: '/status' },
      { id: 'analyze', label: 'Analyze', method: 'POST', path: '/analyze', needsLatLon: true, body: (lat, lon, o) => ({ lat, lon, radiusKm: parseInt(o.radiusKm) || 10, temporalSteps: parseInt(o.temporalSteps) || 1 }) },
      { id: 'change', label: 'Change', method: 'POST', path: '/change', needsLatLon: true, body: (lat, lon) => ({ lat, lon }) },
    ],
  },
];

function renderJson(data: unknown): React.ReactNode {
  if (data == null) return <span style={{color:'#64748b',fontSize:10}}>No data</span>;
  if (typeof data === 'string') return <span style={{color:'#e2e8f0',fontSize:10}}>{data}</span>;
  if (typeof data === 'number') return <span style={{color:'#e2e8f0',fontSize:10}}>{data}</span>;
  if (typeof data === 'boolean') return <span style={{color: data ? '#22c55e' : '#ef4444',fontSize:10}}>{String(data)}</span>;
  if (Array.isArray(data)) {
    return (
      <div style={{display:'flex',flexDirection:'column',gap:4}}>
        {data.map((item, i) => (
          <div key={i} style={{padding:'6px 8px',background:'rgba(255,255,255,0.03)',borderRadius:4,border:'1px solid rgba(255,255,255,0.06)'}}>
            {typeof item === 'object' ? renderObject(item) : renderJson(item)}
          </div>
        ))}
      </div>
    );
  }
  return renderObject(data as Record<string, unknown>);
}

function renderObject(obj: Record<string, unknown>): React.ReactNode {
  const entries = Object.entries(obj).filter(([k]) => !k.startsWith('_'));
  return (
    <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'3px 10px',fontSize:10}}>
      {entries.map(([key, val]) => (
        <React.Fragment key={key}>
          <span style={{color:'#64748b',whiteSpace:'nowrap'}}>{key.replace(/([A-Z])/g, ' $1').trim()}</span>
          <span style={{color:'#e2e8f0'}}>{renderJson(val)}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

export function FoundationModelPanel({ onClose }: { onClose?: () => void }) {
  const [modelId, setModelId] = useState(MODELS[0].id);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string>('status');

  // Location inputs (used by lat-lon actions)
  const [lat, setLat] = useState('37.7749');
  const [lon, setLon] = useState('-122.4194');
  const [corridorId, setCorridorId] = useState('');
  const [extraOpts, setExtraOpts] = useState<Record<string, string>>({});
  const [showOpts, setShowOpts] = useState(false);

  const model = MODELS.find(m => m.id === modelId) || MODELS[0];

  const runAction = useCallback(async (action: ActionDef) => {
    setLoading(true);
    setError(null);
    try {
      let path = `${model.path}${action.path}`;
      const opts: RequestInit = { headers: { 'Content-Type': 'application/json' } };

      if (action.needsCorridorId && corridorId) {
        path = path.replace('{{corridorId}}', encodeURIComponent(corridorId));
      }

      if (action.method === 'POST') {
        opts.method = 'POST';
        const body = action.body ? action.body(parseFloat(lat), parseFloat(lon), extraOpts) : {};
        opts.body = JSON.stringify(body);
      }

      const res = await fetch(path, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const result = await res.json();
      setData(result);
      setLastAction(action.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [model, lat, lon, corridorId, extraOpts]);

  useEffect(() => {
    const statusAction = model.actions.find(a => a.id === 'status');
    if (statusAction) runAction(statusAction);
  }, [modelId]);

  const needsLatLon = model.actions.some(a => a.needsLatLon);
  const needsCorridorId = model.actions.some(a => a.needsCorridorId);

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex: 1000, width: 380 }}>
      <Panel title={model.name} icon={model.icon} accentColor={model.color} onClose={onClose}
        headerExtra={
          <RefreshCw size={12} style={{ color: model.color, cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); const a = model.actions.find(x => x.id === lastAction); if (a) runAction(a); }} />
        }>
        {/* Model selector */}
        <div style={{ padding: '8px 14px', borderBottom: `1px solid ${model.color}15` }}>
          <select value={modelId} onChange={e => { setModelId(e.target.value); setData(null); setError(null); }}
            style={{ width: '100%', padding: '5px 8px', background: 'rgba(0,0,0,0.3)', border: `1px solid ${model.color}30`, borderRadius: 4, color: '#e2e8f0', fontSize: 11, outline: 'none' }}>
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <div style={{ color: '#64748b', fontSize: 9, marginTop: 4 }}>{model.desc}</div>
        </div>

        {/* Location / params inputs */}
        {needsLatLon && (
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${model.color}15` }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: model.color, fontSize: 9, marginBottom: 2 }}>LAT</div>
                <input value={lat} onChange={e => setLat(e.target.value)}
                  style={{ width: '100%', padding: '4px 6px', background: 'rgba(0,0,0,0.3)', border: `1px solid ${model.color}30`, borderRadius: 4, color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: model.color, fontSize: 9, marginBottom: 2 }}>LON</div>
                <input value={lon} onChange={e => setLon(e.target.value)}
                  style={{ width: '100%', padding: '4px 6px', background: 'rgba(0,0,0,0.3)', border: `1px solid ${model.color}30`, borderRadius: 4, color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' }} />
              </div>
            </div>
          </div>
        )}

        {needsCorridorId && (
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${model.color}15` }}>
            <div style={{ color: model.color, fontSize: 9, marginBottom: 2 }}>CORRIDOR ID</div>
            <input value={corridorId} onChange={e => setCorridorId(e.target.value)}
              style={{ width: '100%', padding: '4px 6px', background: 'rgba(0,0,0,0.3)', border: `1px solid ${model.color}30`, borderRadius: 4, color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' }} />
          </div>
        )}

        {/* Action buttons */}
        <div style={{ padding: '8px 14px', borderBottom: `1px solid ${model.color}15`, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {model.actions.filter(a => a.id !== 'status').map(action => (
            <button key={action.id} onClick={() => runAction(action)} disabled={loading}
              style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: lastAction === action.id ? `${model.color}60` : `${model.color}20`, color: lastAction === action.id ? '#fff' : '#e2e8f0', fontSize: 9, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, opacity: loading ? 0.6 : 1 }}>
              {loading && lastAction === action.id ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : null}
              {action.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && <div style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 10 }}>{error}</div>}

        {/* Results */}
        <div style={{ padding: '10px 14px', maxHeight: 360, overflowY: 'auto', fontSize: 10 }}>
          {data ? (
            <div>
              <div style={{ color: model.color, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                {lastAction.toUpperCase()} RESULT
              </div>
              {renderJson(data)}
            </div>
          ) : loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b' }}>
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading...
            </div>
          ) : (
            <div style={{ color: '#64748b' }}>Select an action above</div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '6px 14px', borderTop: `1px solid ${model.color}15`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#475569', fontSize: 8 }}>{model.id}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {model.actions.map(a => (
              <button key={a.id} onClick={() => { setLastAction(a.id); runAction(a); }}
                style={{ padding: '2px 6px', borderRadius: 4, border: 'none', background: lastAction === a.id ? `${model.color}40` : 'transparent', color: lastAction === a.id ? '#e2e8f0' : '#475569', fontSize: 8, cursor: 'pointer' }}>
                {a.label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

export default FoundationModelPanel;
