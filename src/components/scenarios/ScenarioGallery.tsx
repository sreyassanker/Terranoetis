import { useState, useMemo } from 'react';
import { Layers } from 'lucide-react';
import type { ScenarioSummary } from './types';
import { SCENARIO_TYPE_LABELS, SCENARIO_TYPE_COLORS } from './types';
import ScenarioThumbnail from './ScenarioThumbnail';
import Panel from '@/components/ui/Panel';
import { formatISTDate } from '@/lib/formatTime';

type SortKey = 'recency' | 'confidence' | 'complexity' | 'score';
type FilterKey = 'all' | keyof typeof SCENARIO_TYPE_LABELS;

/** How many cards render before the "+N more" note appears. */
const MAX_RENDERED = 50;

interface ScenarioGalleryProps {
  scenarios: ScenarioSummary[];
  loading?: boolean;
  error?: string | null;
  onSelect: (id: string) => void;
  onCreateNew: () => void;
  onClose: () => void;
  zIndex?: number;
}

function sortList(list: ScenarioSummary[], key: SortKey): ScenarioSummary[] {
  const copy = [...list];
  switch (key) {
    case 'confidence': copy.sort((a, b) => b.confidence - a.confidence); break;
    case 'complexity': copy.sort((a, b) => b.complexity - a.complexity); break;
    case 'score': copy.sort((a, b) => b.validationScore - a.validationScore); break;
    case 'recency': copy.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()); break;
  }
  return copy;
}

export default function ScenarioGallery({ scenarios: externalScenarios, loading, error, onSelect, onCreateNew, onClose, zIndex = 110 }: ScenarioGalleryProps) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('recency');
  const [search, setSearch] = useState('');

  const scenarios = useMemo(() => {
    let list = externalScenarios;
    if (filter !== 'all') list = list.filter(s => s.type === filter);
    if (search) list = list.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));
    return sortList(list, sort);
  }, [externalScenarios, filter, sort, search]);

  const totalMatching = scenarios.length;
  const visible = scenarios.slice(0, MAX_RENDERED);
  const hiddenCount = totalMatching - visible.length;

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex, width: 520 }}>
      <Panel
        title="SCENARIO GALLERY"
        icon={<Layers size={14} />}
        accentColor="#3b82f6"
        iconColor="#60a5fa"
        titleColor="#93c5fd"
        onClose={onClose}
        headerExtra={<button className="glass-button" style={{ fontSize: 10, padding: '2px 8px', background: 'rgba(59,130,246,0.3)', border: 'none', borderRadius: 4, color: '#93c5fd', cursor: 'pointer' }} onClick={onCreateNew}>+ New</button>}
        style={{ maxHeight: 'calc(100vh - 92px)' }}
      >

      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, overflowY: 'auto', maxHeight: 'calc(100vh - 140px)' }}>
        {/* Search */}
        <input className="token-input" type="text" placeholder="Search scenarios..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', fontSize: 11 }} />

        {/* Filters */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} role="tablist" aria-label="Scenario type filter">
          {(['all', ...Object.keys(SCENARIO_TYPE_LABELS)] as FilterKey[]).map(f => (
            <button key={f} className={`glass-button ${filter === f ? 'active' : ''}`} role="tab" aria-selected={filter === f}
              style={{ fontSize: 10, padding: '2px 6px' }}
              onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : SCENARIO_TYPE_LABELS[f]}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Sort:</span>
          {(['recency', 'confidence', 'complexity', 'score'] as SortKey[]).map(sk => (
            <button key={sk} className={`glass-button ${sort === sk ? 'active' : ''}`} aria-pressed={sort === sk}
              style={{ fontSize: 10, padding: '2px 6px' }}
              onClick={() => setSort(sk)}>
              {sk.charAt(0).toUpperCase() + sk.slice(1)}
            </button>
          ))}
          <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 'auto' }}>
            {hiddenCount > 0 ? `${visible.length} of ${totalMatching} (refine filter)` : `${totalMatching} results`}
          </span>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
            Loading scenarios...
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div style={{ textAlign: 'center', color: '#ef4444', padding: 24, fontSize: 11 }}>
            {error}
          </div>
        )}

        {/* Grid */}
        {!loading && !error && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
            {visible.map(scenario => (
              <div
                key={scenario.id}
                className="scenario-card"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(scenario.id); } }}
                style={{
                  background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 10, cursor: 'pointer',
                  borderLeft: `3px solid ${SCENARIO_TYPE_COLORS[scenario.type] || '#60a5fa'}`,
                  transition: 'background 0.15s', display: 'flex', gap: 8, alignItems: 'flex-start',
                }}
                onClick={() => onSelect(scenario.id)}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.2)')}>
                <ScenarioThumbnail type={scenario.type} name={scenario.name} lat={scenario.location.lat} lon={scenario.location.lon} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{scenario.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: SCENARIO_TYPE_COLORS[scenario.type] }}>{SCENARIO_TYPE_LABELS[scenario.type]}</span>
                    <span>{(scenario.validationScore * 100).toFixed(0)}%</span>
                    <span className={`severity-${(scenario.severity || '').toLowerCase()}`}>{scenario.severity}</span>
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                    {scenario.location.lat.toFixed(1)}, {scenario.location.lon.toFixed(1)}
                    {' · '}{formatISTDate(scenario.timestamp)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && totalMatching === 0 && externalScenarios.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>No scenarios yet</div>
            <div style={{ fontSize: 11, marginBottom: 12 }}>Create your first scenario using the editor or spatial sketching tool.</div>
            <button className="glass-button" style={{ fontSize: 11, padding: '6px 16px' }} onClick={onCreateNew}>+ Create Scenario</button>
          </div>
        )}

        {!loading && !error && totalMatching === 0 && externalScenarios.length > 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
            No scenarios match your filter
          </div>
        )}
      </div>
    </Panel>
    </div>
  );
}
