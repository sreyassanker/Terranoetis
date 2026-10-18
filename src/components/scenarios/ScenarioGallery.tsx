import { useState, useMemo } from 'react';
import { Layers, Zap, Loader2, CheckCircle2 } from 'lucide-react';
import type { ScenarioSummary } from './types';
import { SCENARIO_TYPE_LABELS, SCENARIO_TYPE_COLORS } from './types';
import ScenarioThumbnail from './ScenarioThumbnail';
import Panel from '@/components/ui/Panel';
import { formatISTDate } from '@/lib/formatTime';
import { authHeaders } from '@/context/AuthContext';

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
  onRefresh?: () => void;
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

export default function ScenarioGallery({
  scenarios: externalScenarios, loading, error, onSelect, onCreateNew, onClose, zIndex = 110, onRefresh
}: ScenarioGalleryProps) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('recency');
  const [search, setSearch] = useState('');

  // BBox Auto-Generation states
  const [showBboxDrawer, setShowBboxDrawer] = useState(false);
  const [latMin, setLatMin] = useState('35.0');
  const [latMax, setLatMax] = useState('36.0');
  const [lonMin, setLonMin] = useState('139.0');
  const [lonMax, setLonMax] = useState('140.5');
  const [hazardType, setHazardType] = useState<string>('earthquake');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genSuccess, setGenSuccess] = useState<string | null>(null);

  const presets = [
    { label: 'Tokyo Bay', bbox: ['35.0', '35.8', '139.5', '140.2'], type: 'earthquake' },
    { label: 'Cascadia', bbox: ['43.5', '47.5', '-126.0', '-123.5'], type: 'tsunami' },
    { label: 'Gulf Coast', bbox: ['28.0', '30.5', '-95.0', '-88.0'], type: 'hurricane' },
    { label: 'Bay of Bengal', bbox: ['18.0', '22.5', '88.0', '92.0'], type: 'flood' },
  ];

  const handleGenerateBbox = async () => {
    const lMin = parseFloat(latMin);
    const lMax = parseFloat(latMax);
    const lnMin = parseFloat(lonMin);
    const lnMax = parseFloat(lonMax);

    if (isNaN(lMin) || isNaN(lMax) || isNaN(lnMin) || isNaN(lnMax)) {
      setGenError('All coordinates must be valid numbers');
      return;
    }
    if (lMin >= lMax) {
      setGenError('Min latitude must be less than Max latitude');
      return;
    }
    if (lnMin >= lnMax) {
      setGenError('Min longitude must be less than Max longitude');
      return;
    }

    setGenerating(true);
    setGenError(null);
    setGenSuccess(null);

    try {
      const resp = await fetch('/api/scenarios/generate-from-bbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          bbox: [lMin, lMax, lnMin, lnMax],
          hazardType,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

      setGenSuccess(`Scenario "${data.scenario?.name || hazardType}" generated from live sources!`);
      if (onRefresh) onRefresh();
      if (data.scenario?.id) {
        setTimeout(() => {
          onSelect(data.scenario.id);
        }, 1200);
      }
    } catch (err: unknown) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

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
        headerExtra={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              className="glass-button"
              style={{
                fontSize: 10, padding: '2px 8px',
                background: showBboxDrawer ? 'rgba(234,179,8,0.3)' : 'rgba(255,255,255,0.06)',
                border: 'none', borderRadius: 4,
                color: showBboxDrawer ? '#fde047' : '#93c5fd', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 3,
              }}
              onClick={() => setShowBboxDrawer(p => !p)}
            >
              <Zap size={10} /> {showBboxDrawer ? 'Hide BBox' : '⚡ Auto-BBox'}
            </button>
            <button
              className="glass-button"
              style={{
                fontSize: 10, padding: '2px 8px', background: 'rgba(59,130,246,0.3)',
                border: 'none', borderRadius: 4, color: '#93c5fd', cursor: 'pointer'
              }}
              onClick={onCreateNew}
            >
              + New
            </button>
          </div>
        }
        style={{ maxHeight: 'calc(100vh - 92px)' }}
      >

      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, overflowY: 'auto', maxHeight: 'calc(100vh - 140px)' }}>
        {/* BBox Drawer */}
        {showBboxDrawer && (
          <div style={{
            background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: 8, padding: 10, marginBottom: 4,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#93c5fd', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Zap size={12} color="#fde047" /> Auto-Generate from Real Bounding Box Data
            </div>

            {/* Presets */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, color: 'var(--text-dim)', alignSelf: 'center' }}>Presets:</span>
              {presets.map(p => (
                <button
                  key={p.label}
                  onClick={() => {
                    setLatMin(p.bbox[0]);
                    setLatMax(p.bbox[1]);
                    setLonMin(p.bbox[2]);
                    setLonMax(p.bbox[3]);
                    setHazardType(p.type);
                  }}
                  style={{
                    fontSize: 9, padding: '1px 6px', borderRadius: 4, cursor: 'pointer',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
                    color: 'var(--text-dim)',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Coordinates */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
              <div>
                <label style={{ fontSize: 9, color: 'var(--text-dim)' }}>Lat Min</label>
                <input
                  type="text" value={latMin} onChange={e => setLatMin(e.target.value)}
                  style={{ width: '100%', fontSize: 10, padding: '3px 6px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 9, color: 'var(--text-dim)' }}>Lat Max</label>
                <input
                  type="text" value={latMax} onChange={e => setLatMax(e.target.value)}
                  style={{ width: '100%', fontSize: 10, padding: '3px 6px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 9, color: 'var(--text-dim)' }}>Lon Min</label>
                <input
                  type="text" value={lonMin} onChange={e => setLonMin(e.target.value)}
                  style={{ width: '100%', fontSize: 10, padding: '3px 6px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 9, color: 'var(--text-dim)' }}>Lon Max</label>
                <input
                  type="text" value={lonMax} onChange={e => setLonMax(e.target.value)}
                  style={{ width: '100%', fontSize: 10, padding: '3px 6px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}
                />
              </div>
            </div>

            {/* Hazard Type & Action */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={hazardType}
                onChange={e => setHazardType(e.target.value)}
                style={{
                  fontSize: 10, padding: '4px 6px', background: 'rgba(0,0,0,0.4)',
                  border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)',
                }}
              >
                {Object.entries(SCENARIO_TYPE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>

              <button
                onClick={handleGenerateBbox}
                disabled={generating}
                style={{
                  flex: 1, padding: '4px 10px', fontSize: 10, fontWeight: 600,
                  background: generating ? 'rgba(59,130,246,0.3)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
                  border: 'none', borderRadius: 4, color: '#fff', cursor: generating ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}
              >
                {generating ? <Loader2 size={12} className="spin" /> : <Zap size={12} />}
                {generating ? 'Querying APIs & Generating...' : '⚡ Generate Scenario from Real Data'}
              </button>
            </div>

            {genError && (
              <div style={{ marginTop: 6, fontSize: 10, color: '#ef4444' }}>{genError}</div>
            )}
            {genSuccess && (
              <div style={{ marginTop: 6, fontSize: 10, color: '#34d399', display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={12} /> {genSuccess}
              </div>
            )}
          </div>
        )}

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
