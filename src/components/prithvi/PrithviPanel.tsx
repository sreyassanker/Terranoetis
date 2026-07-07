import { useState, useEffect, useCallback } from 'react';
import {
  Brain, MapPin, Activity, Search, RefreshCw,
  ChevronDown, ChevronRight, Loader2, Globe,
} from 'lucide-react';
import Panel from '@/components/ui/Panel';

interface PrithviStatus {
  ready: boolean;
  loading: boolean;
  modelPath: string | null;
  cachedEmbeddings: number;
  referenceClasses: number;
}

interface AnalysisResult {
  embedding: number[];
  lat: number;
  lon: number;
  timestamp: number;
  confidence: number;
  classLabel: string;
  classProbabilities: Record<string, number>;
}

interface SimilarResult {
  lat: number;
  lon: number;
  classLabel: string;
  similarity: number;
}

interface ChangeResult {
  changed: boolean;
  deltaDescription: string;
  previousClass?: string;
  currentClass: string;
}

type TabId = 'analyze' | 'similar' | 'change' | 'status';

const LAND_COVER_COLORS: Record<string, string> = {
  water: '#3b82f6',
  trees: '#22c55e',
  grass: '#84cc16',
  flooded_vegetation: '#06b6d4',
  crops: '#eab308',
  built_area: '#a855f7',
  bare_ground: '#d4a373',
  snow_ice: '#e2e8f0',
  clouds: '#94a3b8',
};

export function PrithviPanel(_props: Record<string, unknown> = {}) {
  const [activeTab, setActiveTab] = useState<TabId>('status');
  const [status, setStatus] = useState<PrithviStatus | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [similar, setSimilar] = useState<SimilarResult[]>([]);
  const [change, setChange] = useState<ChangeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lat, setLat] = useState('37.7749');
  const [lon, setLon] = useState('-122.4194');
  const [expandedProb, setExpandedProb] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/fm/prithvi/status');
      const data = await res.json();
      setStatus(data.status);
    } catch { setStatus(null); }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/fm/prithvi/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: parseFloat(lat), lon: parseFloat(lon), radiusKm: 10 }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setAnalysis(data);
      setActiveTab('analyze');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [lat, lon]);

  const findSimilar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/fm/prithvi/similar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: parseFloat(lat), lon: parseFloat(lon), topK: 5 }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setSimilar(data.similar);
      setActiveTab('similar');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [lat, lon]);

  const detectChange = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/fm/prithvi/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: parseFloat(lat), lon: parseFloat(lon) }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      setChange(data);
      setActiveTab('change');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [lat, lon]);

  const bestProb = analysis
    ? Object.entries(analysis.classProbabilities).sort((a, b) => b[1] - a[1]).slice(0, 3)
    : [];

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex: 1000, width: 340 }}>
      <Panel hideHeader accentColor="#6366f1">
        {/* Custom click-to-collapse header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1))',
          borderBottom: collapsed ? 'none' : '1px solid rgba(99,102,241,0.2)',
          cursor: 'pointer',
        }} onClick={() => setCollapsed(!collapsed)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Brain size={16} style={{ color: '#818cf8' }} />
            <span style={{ color: '#c4b5fd', fontWeight: 600, fontSize: 11, letterSpacing: 1 }}>
              PRITHVI EO FM
            </span>
            {status?.ready
              ? <span style={{ color: '#22c55e', fontSize: 9 }}>● READY</span>
              : <span style={{ color: '#eab308', fontSize: 9 }}>● {status?.loading ? 'LOADING' : 'OFFLINE'}</span>
            }
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={12} style={{ color: '#6366f1', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); fetchStatus(); }} />
            <span style={{ color: '#6366f1', fontSize: 10 }}>{collapsed ? '+' : '−'}</span>
          </div>
        </div>

      {!collapsed && (
        <>
          {/* Location Input */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(99,102,241,0.1)' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#818cf8', fontSize: 9, marginBottom: 2 }}>LAT</div>
                <input value={lat} onChange={e => setLat(e.target.value)}
                  style={{
                    width: '100%', padding: '4px 6px', background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(99,102,241,0.2)', borderRadius: 4,
                    color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#818cf8', fontSize: 9, marginBottom: 2 }}>LON</div>
                <input value={lon} onChange={e => setLon(e.target.value)}
                  style={{
                    width: '100%', padding: '4px 6px', background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(99,102,241,0.2)', borderRadius: 4,
                    color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace',
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={analyze} disabled={loading}
                style={{
                  flex: 1, padding: '5px 8px', borderRadius: 6, border: 'none',
                  background: loading ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.6)',
                  color: '#e2e8f0', fontSize: 10, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}>
                {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Brain size={12} />}
                ANALYZE
              </button>
              <button onClick={findSimilar} disabled={loading}
                style={{
                  padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(99,102,241,0.3)',
                  background: 'transparent', color: '#818cf8', fontSize: 10, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                <Search size={12} /> SIMILAR
              </button>
              <button onClick={detectChange} disabled={loading}
                style={{
                  padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(234,179,8,0.3)',
                  background: 'transparent', color: '#eab308', fontSize: 10, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                <Activity size={12} /> CHANGE
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 10 }}>
              {error}
            </div>
          )}

          {/* Tab Content */}
          <div style={{ padding: '10px 14px', maxHeight: 350, overflowY: 'auto' }}>

            {/* Status Tab */}
            {activeTab === 'status' && (
              <div>
                <div style={{ color: '#818cf8', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  System Status
                </div>
                {status ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', fontSize: 10 }}>
                    <span style={{ color: '#64748b' }}>Model Status</span>
                    <span style={{ color: status.ready ? '#22c55e' : '#eab308' }}>{status.ready ? 'Loaded' : 'Pending'}</span>
                    <span style={{ color: '#64748b' }}>Cached Embeddings</span>
                    <span style={{ color: '#e2e8f0' }}>{status.cachedEmbeddings}</span>
                    <span style={{ color: '#64748b' }}>Reference Classes</span>
                    <span style={{ color: '#e2e8f0' }}>{status.referenceClasses}</span>
                    <span style={{ color: '#64748b' }}>Model Path</span>
                    <span style={{ color: '#94a3b8', fontSize: 8, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {status.modelPath || 'N/A'}
                    </span>
                  </div>
                ) : (
                  <div style={{ color: '#64748b', fontSize: 10 }}>Status unavailable</div>
                )}

                <div style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(99,102,241,0.05)', borderRadius: 6, border: '1px solid rgba(99,102,241,0.1)' }}>
                  <div style={{ color: '#a5b4fc', fontSize: 9, marginBottom: 4 }}>ABOUT</div>
                  <div style={{ color: '#94a3b8', fontSize: 9, lineHeight: 1.5 }}>
                    Prithvi-EO-2.0 is NASA & IBM's geospatial foundation model. The tiny variant (5M params) runs entirely in Node.js via ONNX Runtime — no GPU required.
                  </div>
                </div>
              </div>
            )}

            {/* Analyze Tab */}
            {activeTab === 'analyze' && analysis && (
              <div>
                <div style={{ color: '#818cf8', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Analysis Result
                </div>

                {/* Class Label */}
                <div style={{
                  padding: '10px', borderRadius: 8, marginBottom: 8,
                  background: 'rgba(99,102,241,0.1)',
                  border: `1px solid ${LAND_COVER_COLORS[analysis.classLabel || ''] || '#6366f1'}40`,
                  textAlign: 'center',
                }}>
                  <div style={{
                    fontSize: 18, fontWeight: 'bold',
                    color: LAND_COVER_COLORS[analysis.classLabel || ''] || '#c4b5fd',
                  }}>
                    {(analysis.classLabel || 'unknown').replace(/_/g, ' ').toUpperCase()}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 9, marginTop: 2 }}>
                    Confidence: {(analysis.confidence * 100).toFixed(0)}%
                  </div>
                </div>

                {/* Location */}
                <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#94a3b8', marginBottom: 8 }}>
                  <MapPin size={10} />
                  <span>{analysis.lat.toFixed(4)}, {analysis.lon.toFixed(4)}</span>
                </div>

                {/* Top Probabilities */}
                <div style={{ marginBottom: 8 }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: '#64748b', fontSize: 9 }}
                    onClick={() => setExpandedProb(!expandedProb)}
                  >
                    {expandedProb ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    CLASS PROBABILITIES
                  </div>
                  {expandedProb && (
                    <div style={{ marginTop: 4 }}>
                      {bestProb.map(([cls, prob]) => (
                        <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: LAND_COVER_COLORS[cls] || '#6366f1',
                          }} />
                          <span style={{ color: '#cbd5e1', fontSize: 10, flex: 1 }}>{cls.replace(/_/g, ' ')}</span>
                          <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                              width: `${(prob * 100).toFixed(0)}%`, height: '100%',
                              background: LAND_COVER_COLORS[cls] || '#6366f1',
                              borderRadius: 2, transition: 'width 0.3s',
                            }} />
                          </div>
                          <span style={{ color: '#94a3b8', fontSize: 9, width: 32, textAlign: 'right' }}>
                            {(prob * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Embedding Preview */}
                <div style={{
                  padding: '6px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: 4,
                  fontSize: 8, color: '#64748b', fontFamily: 'monospace',
                  wordBreak: 'break-all', maxHeight: 40, overflow: 'hidden',
                }}>
                  embedding: [{analysis.embedding.slice(0, 6).map(v => v.toFixed(3)).join(', ')}, ...] (192-dim)
                </div>
              </div>
            )}

            {/* Similar Tab */}
            {activeTab === 'similar' && (
              <div>
                <div style={{ color: '#818cf8', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Similar Locations
                </div>
                {similar.length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: 10 }}>No similar locations found yet. Analyze a location first.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {similar.map((s, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 8px', borderRadius: 6,
                        background: 'rgba(99,102,241,0.05)',
                        border: '1px solid rgba(99,102,241,0.1)',
                        cursor: 'pointer',
                      }}>
                        <Globe size={12} style={{ color: '#6366f1' }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#e2e8f0', fontSize: 10 }}>
                            {s.lat.toFixed(2)}, {s.lon.toFixed(2)}
                          </div>
                          <div style={{ color: LAND_COVER_COLORS[s.classLabel] || '#6366f1', fontSize: 9 }}>
                            {s.classLabel.replace(/_/g, ' ')}
                          </div>
                        </div>
                        <div style={{
                          color: s.similarity > 0.9 ? '#22c55e' : s.similarity > 0.7 ? '#eab308' : '#94a3b8',
                          fontSize: 10, fontWeight: 600,
                        }}>
                          {(s.similarity * 100).toFixed(0)}%
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Change Tab */}
            {activeTab === 'change' && change && (
              <div>
                <div style={{ color: '#818cf8', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Change Detection
                </div>
                <div style={{
                  padding: '10px', borderRadius: 8, marginBottom: 8,
                  background: change.changed ? 'rgba(234,179,8,0.1)' : 'rgba(34,197,94,0.1)',
                  border: `1px solid ${change.changed ? 'rgba(234,179,8,0.3)' : 'rgba(34,197,94,0.3)'}`,
                  textAlign: 'center',
                }}>
                  <div style={{
                    fontSize: 14, fontWeight: 'bold',
                    color: change.changed ? '#eab308' : '#22c55e',
                  }}>
                    {change.changed ? 'CHANGE DETECTED' : 'STABLE'}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 9, marginTop: 4 }}>
                    {change.deltaDescription}
                  </div>
                </div>
                {change.previousClass && (
                  <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#94a3b8' }}>
                    <span>Previous: {change.previousClass.replace(/_/g, ' ')}</span>
                    <span>→</span>
                    <span style={{ color: LAND_COVER_COLORS[change.currentClass] || '#c4b5fd' }}>
                      Current: {change.currentClass.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '6px 14px', borderTop: '1px solid rgba(99,102,241,0.1)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ color: '#475569', fontSize: 8 }}>
              ONNX CPU — {status?.cachedEmbeddings || 0} cached
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['status', 'analyze', 'similar', 'change'] as TabId[]).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  style={{
                    padding: '2px 6px', borderRadius: 4, border: 'none',
                    background: activeTab === tab ? 'rgba(99,102,241,0.3)' : 'transparent',
                    color: activeTab === tab ? '#a5b4fc' : '#475569',
                    fontSize: 8, cursor: 'pointer',
                  }}>
                  {tab.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </Panel>
    </div>
  );
}
