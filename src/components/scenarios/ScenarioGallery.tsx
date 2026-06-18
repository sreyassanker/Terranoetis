import { useState, useMemo } from 'react';

interface ScenarioSummary {
  id: string;
  type: string;
  name: string;
  validationScore: number;
  severity: string;
  location: { lat: number; lon: number };
  timestamp: string;
  confidence: number;
  complexity: number;
  thumbnail?: string;
}

interface ScenarioGalleryProps {
  scenarios: ScenarioSummary[];
  onSelect: (id: string) => void;
  onCreateNew: () => void;
  onClose: () => void;
}

type SortKey = 'recency' | 'confidence' | 'complexity' | 'score';
type FilterKey = 'all' | 'earthquake_swarm' | 'hurricane_landfall' | 'wildfire_spread' | 'volcanic_eruption' | 'flood_inundation' | 'tsunami_wave';

const TYPE_LABELS: Record<string, string> = {
  earthquake_swarm: 'Earthquake',
  hurricane_landfall: 'Hurricane',
  wildfire_spread: 'Wildfire',
  volcanic_eruption: 'Volcanic',
  flood_inundation: 'Flood',
  tsunami_wave: 'Tsunami',
};

const TYPE_COLORS: Record<string, string> = {
  earthquake_swarm: '#ef4444',
  hurricane_landfall: '#f59e0b',
  wildfire_spread: '#ff6b35',
  volcanic_eruption: '#d946ef',
  flood_inundation: '#3b82f6',
  tsunami_wave: '#06b6d4',
};

const MOCK_SCENARIOS: ScenarioSummary[] = Array.from({ length: 24 }, (_, i) => {
  const types: FilterKey[] = ['earthquake_swarm', 'hurricane_landfall', 'wildfire_spread', 'volcanic_eruption', 'flood_inundation', 'tsunami_wave'];
  const type = types[i % 6];
  return {
    id: `scenario_${i}`,
    type,
    name: `${TYPE_LABELS[type]} ${['— Coastal Region', '— Inland Valley', '— Mountain Pass', '— Urban Center', '— Island Chain', '— Delta Basin'][i % 6]}`,
    validationScore: 0.5 + Math.random() * 0.5,
    severity: ['low', 'medium', 'high', 'extreme'][Math.floor(Math.random() * 4)],
    location: { lat: 19 + Math.random() * 10, lon: 72 + Math.random() * 10 },
    timestamp: new Date(Date.now() - i * 3600000).toISOString(),
    confidence: 0.3 + Math.random() * 0.7,
    complexity: Math.round(Math.random() * 100),
  };
});

export default function ScenarioGallery({ scenarios: _externalScenarios, onSelect, onCreateNew, onClose }: ScenarioGalleryProps) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('recency');
  const [search, setSearch] = useState('');

  const scenarios = useMemo(() => {
    let list = _externalScenarios.length > 0 ? _externalScenarios : MOCK_SCENARIOS;
    if (filter !== 'all') list = list.filter(s => s.type === filter);
    if (search) list = list.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'confidence': return b.confidence - a.confidence;
        case 'complexity': return b.complexity - a.complexity;
        case 'score': return b.validationScore - a.validationScore;
        case 'recency': default: return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      }
    });
  }, [_externalScenarios, filter, sort, search]);

  return (
    <div className="alerts-panel glass-panel open" style={{ width: 520, maxHeight: 'calc(100vh - 92px)' }}>
      <div className="ai-header">
        <div className="social-icon-grad">🌋</div>
        <div className="ai-title">Scenario Gallery</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="glass-button" style={{ fontSize: 10, padding: '2px 8px' }} onClick={onCreateNew}>+ New</button>
          <button className="ai-close" onClick={onClose}>✕</button>
        </div>
      </div>

      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, overflowY: 'auto', maxHeight: 'calc(100vh - 140px)' }}>
        {/* Search */}
        <input className="token-input" type="text" placeholder="Search scenarios..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', fontSize: 11 }} />

        {/* Filters */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(['all', 'earthquake_swarm', 'hurricane_landfall', 'wildfire_spread', 'volcanic_eruption', 'flood_inundation', 'tsunami_wave'] as FilterKey[]).map(f => (
            <button key={f} className={`glass-button ${filter === f ? 'active' : ''}`}
              style={{ fontSize: 10, padding: '2px 6px' }}
              onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : TYPE_LABELS[f]}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Sort:</span>
          {(['recency', 'confidence', 'complexity', 'score'] as SortKey[]).map(sk => (
            <button key={sk} className={`glass-button ${sort === sk ? 'active' : ''}`}
              style={{ fontSize: 10, padding: '2px 6px' }}
              onClick={() => setSort(sk)}>
              {sk.charAt(0).toUpperCase() + sk.slice(1)}
            </button>
          ))}
          <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 'auto' }}>{scenarios.length} results</span>
        </div>

        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
          {scenarios.slice(0, 50).map(scenario => (
            <div key={scenario.id} className="scenario-card"
              style={{
                background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 10, cursor: 'pointer',
                borderLeft: `3px solid ${TYPE_COLORS[scenario.type] || '#60a5fa'}`,
                transition: 'background 0.15s',
              }}
              onClick={() => onSelect(scenario.id)}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.2)')}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{scenario.name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: TYPE_COLORS[scenario.type] }}>{TYPE_LABELS[scenario.type]}</span>
                <span>{(scenario.validationScore * 100).toFixed(0)}%</span>
                <span className={`severity-${scenario.severity}`}>{scenario.severity}</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                {scenario.location.lat.toFixed(1)}°, {scenario.location.lon.toFixed(1)}°
                {' · '}{new Date(scenario.timestamp).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>

        {scenarios.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
            No scenarios match your filter
          </div>
        )}
      </div>
    </div>
  );
}
