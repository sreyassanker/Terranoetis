import React, { useState, useCallback } from 'react';

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

export default function MemoryExplorer({ onClose }: MemoryExplorerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemoryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [entities, setEntities] = useState<Entity[]>([
    { name: 'Tokyo Earthquake', type: 'event', relations: [{ target: 'Japan Trench', relationType: 'located_at' }, { target: 'M6.2', relationType: 'magnitude' }] },
    { name: 'Japan Trench', type: 'geological', relations: [{ target: 'Pacific Plate', relationType: 'boundary' }, { target: 'Tokyo Earthquake', relationType: 'caused' }] },
    { name: 'Pacific Plate', type: 'geological', relations: [{ target: 'Japan Trench', relationType: 'subducts' }] },
    { name: 'M6.2', type: 'measurement', relations: [] },
    { name: 'Nankai Trough', type: 'geological', relations: [{ target: 'Japan Trench', relationType: 'extends' }] },
  ]);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const resp = await fetch(`/api/agent/memory?q=${encodeURIComponent(query)}`);
      if (resp.ok) {
        const data = await resp.json();
        setResults(Array.isArray(data) ? data.slice(0, 20) : []);
      }
    } catch { setResults([]); } finally {
      setSearching(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="panel-header">
        <span style={{ fontWeight: 700, fontSize: 13 }}>🧠 Memory Explorer</span>
        <button className="ai-close" onClick={onClose}>✕</button>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="What did I ask about Japan last month?"
            style={{
              flex: 1, padding: '5px 8px', fontSize: 10, borderRadius: 6,
              background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
              color: 'var(--text)', outline: 'none',
            }}
          />
          <button onClick={handleSearch}
            style={{
              padding: '5px 10px', fontSize: 10, fontWeight: 600,
              background: 'linear-gradient(135deg, var(--accent), var(--purple))',
              border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer',
            }}>
            🔍
          </button>
        </div>
        <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
          {['earthquake', 'weather', 'Japan', 'wildfires'].map(s => (
            <button key={s} onClick={() => { setQuery(s); }}
              style={{
                fontSize: 8, padding: '1px 6px', borderRadius: 8, cursor: 'pointer',
                background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                color: 'var(--text-dim)',
              }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Search Results */}
        {results.length > 0 && (
          <div style={{ padding: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)', padding: '4px 6px' }}>
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
                <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4, maxHeight: 40, overflow: 'hidden' }}>
                  {item.content?.slice(0, 200)}
                </div>
              </div>
            ))}
          </div>
        )}

        {searching && <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)' }}>Searching...</div>}

        {/* Knowledge Graph */}
        <div style={{ padding: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)', padding: '4px 6px', marginBottom: 4 }}>
            Knowledge Graph
          </div>
          <div className="cockpit-card" style={{ padding: '8px 0' }}>
            <KnowledgeGraph entities={entities} />
          </div>
        </div>

        {/* Consolidation Status */}
        <div style={{ padding: 6 }}>
          <div className="cockpit-card" style={{ padding: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span className="pulse-dot" />
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--purple)' }}>Dreaming now...</span>
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              Consolidating 3 new experiences into long-term memory.
              Strengthening connections between seismic patterns and historical earthquake data.
              Pruning 2 outdated fact associations.
            </div>
            <div style={{ marginTop: 6, fontSize: 9, display: 'flex', gap: 12 }}>
              <span style={{ color: 'var(--teal)' }}>▶ Next consolidation in ~15m</span>
              <span style={{ color: 'var(--text-dim)' }}>Memory usage: 42%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
