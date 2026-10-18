import React, { useState, useCallback, useEffect } from 'react';
import { Brain, Radio, Cpu, TrendingUp, Search, Share2, RefreshCw, CheckCircle2 } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { authHeaders } from '@/context/AuthContext';

interface MemoryItem {
  id: number;
  role: string;
  content: string;
  type?: string;
  feedback?: string;
  created_at?: string;
}

interface Entity {
  name: string;
  type: string;
  relations: Array<{ target: string; relationType: string }>;
}

interface SensoryEvent {
  timestamp: number;
  type: string;
  source: string;
  data: Record<string, unknown>;
  importanceScore: number;
}

interface ProceduralPattern {
  query: string;
  response: string;
  intentType: string;
  successCount: number;
  avgLatency?: number;
}

interface PredictiveItem {
  hazardType: string;
  probability: number;
  confidence: number;
  timeframe: string;
  modelType: string;
}

interface MemoryStatus {
  tiers?: {
    sensory?: { count: number; window: number };
    working?: { count: number; capacity: number };
    episodic?: { count: number; limit: number };
    procedural?: { count: number };
    predictive?: { count: number };
  };
}

interface MemoryExplorerProps {
  onClose: () => void;
}

function KnowledgeGraph({ entities }: { entities: Entity[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const cx = 150;
  const cy = 100;
  const radius = 70;

  if (entities.length === 0) {
    return (
      <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-dim)' }}>
        No entities in knowledge graph yet
      </div>
    );
  }

  const angleStep = (2 * Math.PI) / entities.length;

  return (
    <svg width={300} height={200} style={{ display: 'block', margin: '0 auto' }}>
      {/* Connection lines */}
      {entities.map((entity, i) => {
        const angle = i * angleStep - Math.PI / 2;
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        return entity.relations.map((rel, j) => {
          const targetIdx = entities.findIndex(e => e.name === rel.target);
          if (targetIdx < 0) return null;
          const ta = targetIdx * angleStep - Math.PI / 2;
          const tx = cx + radius * Math.cos(ta);
          const ty = cy + radius * Math.sin(ta);
          return (
            <line key={`${i}-${j}`} x1={x} y1={y} x2={tx} y2={ty}
              stroke={hovered === entity.name || hovered === rel.target ? 'var(--accent)' : 'rgba(255,255,255,0.06)'}
              strokeWidth={hovered === entity.name || hovered === rel.target ? 1.5 : 0.5}
              strokeDasharray={rel.relationType === 'triggered' ? '3,2' : 'none'}
            />
          );
        });
      })}
      {/* Entity nodes */}
      {entities.map((entity, i) => {
        const angle = i * angleStep - Math.PI / 2;
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        const isHovered = hovered === entity.name;
        return (
          <g key={entity.name} onMouseEnter={() => setHovered(entity.name)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'pointer' }}>
            <circle cx={x} cy={y} r={isHovered ? 18 : 14}
              fill={isHovered ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.08)'}
              stroke={isHovered ? 'var(--accent)' : 'var(--border)'}
              strokeWidth={isHovered ? 2 : 1}
            />
            <text x={x} y={y + 3} textAnchor="middle" fontSize={7} fill="var(--text)" style={{ pointerEvents: 'none' }}>
              {entity.name.length > 12 ? entity.name.slice(0, 10) + '..' : entity.name}
            </text>
          </g>
        );
      })}
      {hovered && (
        <text x={cx} y={195} textAnchor="middle" fontSize={8} fill="var(--text-dim)">
          {hovered} — {entities.find(e => e.name === hovered)?.type || 'entity'}
        </text>
      )}
    </svg>
  );
}

type TabType = 'search' | 'sensory' | 'procedural' | 'predictive' | 'graph';

export default function MemoryExplorer({ onClose }: MemoryExplorerProps) {
  const [activeTab, setActiveTab] = useState<TabType>('sensory');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemoryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [entities, setEntities] = useState<Entity[]>([]);

  // Real Multi-tier memory states
  const [sensoryEvents, setSensoryEvents] = useState<SensoryEvent[]>([]);
  const [sensoryLoading, setSensoryLoading] = useState(false);
  const [proceduralPatterns, setProceduralPatterns] = useState<ProceduralPattern[]>([]);
  const [proceduralLoading, setProceduralLoading] = useState(false);
  const [predictiveItems, setPredictiveItems] = useState<PredictiveItem[]>([]);
  const [predictiveLoading, setPredictiveLoading] = useState(false);
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [consolidating, setConsolidating] = useState(false);
  const [consolidationResult, setConsolidationResult] = useState<string | null>(null);

  // Fetch real knowledge graph on mount
  useEffect(() => {
    fetch('/api/causal-graph')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.nodes) return;
        const nodeById = new Map<number, { id: number; name: string; type: string }>(
          data.nodes.map((n: { id: number; name: string; type: string }) => [n.id, n])
        );
        const graphEntities: Entity[] = data.nodes.map((n: { id: number; name: string; type: string }) => {
          const rels = data.edges
            .filter((e: { source: number; target: number; relation: string }) => e.source === n.id || e.target === n.id)
            .map((e: { source: number; target: number; relation: string }) => {
              const otherId = e.source === n.id ? e.target : e.source;
              const other = nodeById.get(otherId);
              return other ? { target: other.name, relationType: e.relation } : null;
            })
            .filter(Boolean) as Array<{ target: string; relationType: string }>;
          return { name: n.name, type: n.type, relations: rels };
        });
        setEntities(graphEntities);
      })
      .catch(() => {});
  }, []);

  // Fetch real memory status
  const fetchStatus = useCallback(() => {
    fetch('/api/memory/status', { headers: { ...authHeaders() } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setStatus(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Fetch sensory events
  const fetchSensory = useCallback(async () => {
    setSensoryLoading(true);
    try {
      const res = await fetch('/api/memory/sensory?limit=50', { headers: { ...authHeaders() } });
      if (res.ok) {
        const data = await res.json();
        setSensoryEvents(Array.isArray(data.events) ? data.events : []);
      }
    } catch {
      setSensoryEvents([]);
    } finally {
      setSensoryLoading(false);
    }
  }, []);

  // Fetch procedural memory patterns
  const fetchProcedural = useCallback(async () => {
    setProceduralLoading(true);
    try {
      const res = await fetch('/api/memory/procedural?limit=25', { headers: { ...authHeaders() } });
      if (res.ok) {
        const data = await res.json();
        setProceduralPatterns(Array.isArray(data.patterns) ? data.patterns : []);
      }
    } catch {
      setProceduralPatterns([]);
    } finally {
      setProceduralLoading(false);
    }
  }, []);

  // Fetch predictive memory priors
  const fetchPredictive = useCallback(async () => {
    setPredictiveLoading(true);
    try {
      const res = await fetch('/api/memory/predictive', { headers: { ...authHeaders() } });
      if (res.ok) {
        const data = await res.json();
        setPredictiveItems(Array.isArray(data.predictions) ? data.predictions : []);
      }
    } catch {
      setPredictiveItems([]);
    } finally {
      setPredictiveLoading(false);
    }
  }, []);

  // Trigger loads when tabs switch
  useEffect(() => {
    if (activeTab === 'sensory') fetchSensory();
    if (activeTab === 'procedural') fetchProcedural();
    if (activeTab === 'predictive') fetchPredictive();
  }, [activeTab, fetchSensory, fetchProcedural, fetchPredictive]);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const resp = await fetch(`/api/agent/memory?q=${encodeURIComponent(query)}`);
      if (resp.ok) {
        const data = await resp.json();
        setResults(Array.isArray(data) ? data.slice(0, 20) : []);
      }
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleConsolidate = async () => {
    setConsolidating(true);
    setConsolidationResult(null);
    try {
      const res = await fetch('/api/memory/consolidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
      });
      if (res.ok) {
        const data = await res.json();
        setConsolidationResult(`Consolidated in ${data.durationMs}ms`);
        fetchStatus();
      } else {
        setConsolidationResult('Consolidation failed');
      }
    } catch (err: unknown) {
      setConsolidationResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConsolidating(false);
      setTimeout(() => setConsolidationResult(null), 5000);
    }
  };

  return (
    <Panel
      title="MEMORY EXPLORER"
      icon={<Brain size={16} />}
      accentColor="#06b6d4"
      iconColor="#22d3ee"
      titleColor="#67e8f9"
      onClose={onClose}
      style={{ height: '100%', maxHeight: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {/* Navigation Tabs */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
        borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)',
        padding: '4px', gap: 2, flexShrink: 0,
      }}>
        {[
          { id: 'sensory', label: 'Sensory', icon: <Radio size={11} /> },
          { id: 'procedural', label: 'Procedural', icon: <Cpu size={11} /> },
          { id: 'predictive', label: 'Predictive', icon: <TrendingUp size={11} /> },
          { id: 'search', label: 'Search', icon: <Search size={11} /> },
          { id: 'graph', label: 'Graph', icon: <Share2 size={11} /> },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as TabType)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '4px 2px', fontSize: 9.5,
              fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
              background: activeTab === t.id ? 'rgba(6,182,212,0.25)' : 'transparent',
              color: activeTab === t.id ? '#22d3ee' : 'var(--text-dim)',
              whiteSpace: 'nowrap',
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 }}>
        {/* TAB 1: SENSORY BUFFER */}
        {activeTab === 'sensory' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)' }}>
                Sensory Ingestion Buffer ({sensoryEvents.length} items)
              </div>
              <button
                onClick={fetchSensory}
                disabled={sensoryLoading}
                style={{
                  background: 'none', border: 'none', color: '#22d3ee', cursor: 'pointer',
                  fontSize: 10, display: 'flex', alignItems: 'center', gap: 3,
                }}
              >
                <RefreshCw size={10} className={sensoryLoading ? 'spin' : ''} /> Refresh
              </button>
            </div>
            {sensoryLoading ? (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 20, fontSize: 10 }}>Loading sensory events...</div>
            ) : sensoryEvents.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24, fontSize: 10 }}>
                No sensory events in recent buffer window. Incoming telemetry streams will buffer here.
              </div>
            ) : (
              sensoryEvents.map((e, idx) => (
                <div key={idx} style={{
                  padding: '6px 8px', marginBottom: 6, borderRadius: 6,
                  background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
                  borderLeft: `3px solid ${e.importanceScore > 0.7 ? '#ef4444' : e.importanceScore > 0.4 ? '#f59e0b' : '#3b82f6'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#38bdf8' }}>{e.type.toUpperCase()}</span>
                    <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{new Date(e.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 2 }}>
                    Source: <span style={{ color: 'var(--text)' }}>{e.source}</span> · Score: {(e.importanceScore * 100).toFixed(0)}%
                  </div>
                  {e.data && (
                    <div style={{
                      fontSize: 9, color: '#94a3b8', background: 'rgba(0,0,0,0.35)',
                      padding: '4px 6px', borderRadius: 4, fontFamily: 'monospace',
                      wordBreak: 'break-word', whiteSpace: 'pre-wrap', lineHeight: 1.35,
                    }}>
                      {typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 2: PROCEDURAL ROUTINES */}
        {activeTab === 'procedural' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)' }}>
                Procedural Patterns & Tool Chains ({proceduralPatterns.length})
              </div>
              <button
                onClick={fetchProcedural}
                disabled={proceduralLoading}
                style={{
                  background: 'none', border: 'none', color: '#22d3ee', cursor: 'pointer',
                  fontSize: 10, display: 'flex', alignItems: 'center', gap: 3,
                }}
              >
                <RefreshCw size={10} className={proceduralLoading ? 'spin' : ''} /> Refresh
              </button>
            </div>
            {proceduralLoading ? (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 20, fontSize: 10 }}>Loading procedures...</div>
            ) : proceduralPatterns.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24, fontSize: 10 }}>
                No procedural patterns recorded yet.
              </div>
            ) : (
              proceduralPatterns.map((p, idx) => (
                <div key={idx} style={{
                  padding: '6px 8px', marginBottom: 6, borderRadius: 6,
                  background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
                  borderLeft: '3px solid #8b5cf6',
                }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#c4b5fd', marginBottom: 2 }}>
                    {p.intentType || p.query}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 4 }}>
                    Tool Chain: <span style={{ color: '#38bdf8' }}>{p.response || 'Direct response'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 8, color: 'var(--text-muted)' }}>
                    <span>Successes: {p.successCount}</span>
                    {p.avgLatency !== undefined && <span>Avg Latency: {p.avgLatency.toFixed(0)}ms</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 3: PREDICTIVE MEMORY */}
        {activeTab === 'predictive' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)' }}>
                Predictive Hazard Priors ({predictiveItems.length})
              </div>
              <button
                onClick={fetchPredictive}
                disabled={predictiveLoading}
                style={{
                  background: 'none', border: 'none', color: '#22d3ee', cursor: 'pointer',
                  fontSize: 10, display: 'flex', alignItems: 'center', gap: 3,
                }}
              >
                <RefreshCw size={10} className={predictiveLoading ? 'spin' : ''} /> Refresh
              </button>
            </div>
            {predictiveLoading ? (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 20, fontSize: 10 }}>Loading predictions...</div>
            ) : predictiveItems.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24, fontSize: 10 }}>
                No predictive priors active in current spatial focus.
              </div>
            ) : (
              predictiveItems.map((item, idx) => (
                <div key={idx} style={{
                  padding: '6px 8px', marginBottom: 6, borderRadius: 6,
                  background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
                  borderLeft: `3px solid ${item.probability > 0.5 ? '#ef4444' : '#10b981'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#f87171' }}>{item.hazardType.toUpperCase()}</span>
                    <span style={{ fontSize: 9, color: '#38bdf8' }}>{(item.probability * 100).toFixed(1)}% prob</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, fontSize: 8, color: 'var(--text-dim)' }}>
                    <span>Confidence: {(item.confidence * 100).toFixed(0)}%</span>
                    <span>Timeframe: {item.timeframe}</span>
                    <span>Model: {item.modelType}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 4: SEARCH & EPISODIC */}
        {activeTab === 'search' && (
          <div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              <input
                value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown}
                placeholder="Search semantic facts and past episodes..."
                style={{
                  flex: 1, padding: '5px 8px', fontSize: 10, borderRadius: 6,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
                  color: 'var(--text)', outline: 'none',
                }}
              />
              <button
                onClick={handleSearch}
                style={{
                  padding: '5px 10px', fontSize: 10, fontWeight: 600,
                  background: 'linear-gradient(135deg, var(--accent), var(--purple))',
                  border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer',
                }}
              >
                🔍
              </button>
            </div>
            <div style={{ marginBottom: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {['earthquake', 'weather', 'Japan', 'wildfires'].map(s => (
                <button
                  key={s} onClick={() => { setQuery(s); }}
                  style={{
                    fontSize: 8, padding: '2px 6px', borderRadius: 8, cursor: 'pointer',
                    background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                    color: 'var(--text-dim)',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>

            {searching && <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)' }}>Searching...</div>}

            {results.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)', padding: '4px 0', marginBottom: 4 }}>
                  Results ({results.length})
                </div>
                {results.map((item, i) => (
                  <div key={item.id || i} style={{
                    padding: '6px 8px', marginBottom: 4, borderRadius: 6,
                    background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
                    borderLeft: `3px solid ${item.role === 'user' ? 'var(--accent)' : 'var(--purple)'}`,
                  }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontSize: 8, fontWeight: 600, color: item.role === 'user' ? 'var(--accent)' : 'var(--purple)' }}>
                        {item.role === 'user' ? 'You' : 'AI'}
                      </span>
                      {item.type && <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>{item.type}</span>}
                      {item.feedback && <span style={{ fontSize: 8 }}>{item.feedback === 'up' ? '👍' : '👎'}</span>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4, maxHeight: 60, overflow: 'hidden' }}>
                      {item.content?.slice(0, 200)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: KNOWLEDGE GRAPH */}
        {activeTab === 'graph' && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
              Causal Knowledge Graph ({entities.length} Nodes)
            </div>
            <div className="cockpit-card" style={{ padding: '8px 0' }}>
              <KnowledgeGraph entities={entities} />
            </div>
          </div>
        )}
      </div>

      {/* Memory Status & Consolidation Footer */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.4)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="pulse-dot" style={{ background: '#22d3ee' }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: '#67e8f9' }}>Memory Tiers Active</span>
          </div>
          <button
            onClick={handleConsolidate}
            disabled={consolidating}
            style={{
              padding: '3px 8px', fontSize: 9, fontWeight: 600, borderRadius: 4, cursor: 'pointer',
              background: consolidating ? 'rgba(255,255,255,0.05)' : 'rgba(6,182,212,0.2)',
              border: '1px solid rgba(6,182,212,0.4)', color: '#22d3ee',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <RefreshCw size={10} className={consolidating ? 'spin' : ''} />
            {consolidating ? 'Consolidating...' : 'Consolidate Now'}
          </button>
        </div>

        {consolidationResult && (
          <div style={{ fontSize: 9, color: '#34d399', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <CheckCircle2 size={10} /> {consolidationResult}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, fontSize: 8, color: 'var(--text-muted)' }}>
          <span>Sensory: {status?.tiers?.sensory?.count ?? 0}</span>
          <span>Working: {status?.tiers?.working?.count ?? 0}/{status?.tiers?.working?.capacity ?? 50}</span>
          <span>Episodic: {status?.tiers?.episodic?.count ?? 0}</span>
        </div>
      </div>
    </Panel>
  );
}

