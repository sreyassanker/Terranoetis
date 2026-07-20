import React, { useState, useMemo, useCallback } from 'react';
import {
  Play, Loader2, Check, AlertCircle, MapPin, Clock, Filter, Database,
  BookOpen, X, Info,
} from 'lucide-react';
import {
  type AnalysisTool, type AnalysisToolParameter, type StudyAreaMode, type TimeGranularity,
  type CategoryFilterId, type AutoDataSourceId,
  STUDY_AREA_MODE_LABELS, TIME_GRANULARITY_LABELS, CATEGORY_FILTER_META, AUTO_DATA_SOURCE_LABELS,
} from '@/data/analyticalModels';

interface ToolDialogProps {
  tool: AnalysisTool;
  color: string;
  onClose: () => void;
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null;
  onToolResult?: (toolId: number, label: string, lat: number, lon: number, value?: number) => void;
  onClearResult?: () => void;
}

interface StudyArea {
  mode: StudyAreaMode;
  lat: number; lon: number;
  latMin: number; latMax: number; lonMin: number; lonMax: number;
  lat1: number; lon1: number; lat2: number; lon2: number;
}

const DEFAULT_STUDY_AREA: StudyArea = {
  mode: 'point',
  lat: 35.68, lon: 139.76,
  latMin: 35.43, latMax: 35.93, lonMin: 139.51, lonMax: 140.01,
  lat1: 35.68, lon1: 139.76, lat2: 34.69, lon2: 135.50,
};

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '4px 6px', borderRadius: 4,
  background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(139,92,246,0.25)',
  color: '#e2e8f0', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', outline: 'none', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = { fontSize: 9, color: '#64748b', marginBottom: 2, display: 'block' };

const ParamInput: React.FC<{
  param: AnalysisToolParameter; value: string; onChange: (val: string) => void; color: string;
}> = ({ param, value, onChange, color }) => {
  const { label, unit, default: def, min, max, options } = param;
  return (
    <div>
      <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        {unit && <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#475569' }}>{unit}</span>}
      </div>
      {options ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}
          style={{ ...fieldStyle, borderColor: `${color}30` }}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type="number" value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={String(def)} min={min ?? undefined} max={max ?? undefined} step="any"
          style={{ ...fieldStyle, borderColor: `${color}30` }}
        />
      )}
    </div>
  );
};

const NumberField: React.FC<{ label: string; value: number; unit?: string; onChange: (v: number) => void }> = ({ label, value, unit, onChange }) => (
  <div>
    <label style={labelStyle}>{label}{unit ? ` (${unit})` : ''}</label>
    <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} style={fieldStyle} />
  </div>
);

const sectionStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 600, color: '#64748b', textTransform: 'uppercase',
  letterSpacing: 0.5, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5,
};

const ToolDialog: React.FC<ToolDialogProps> = ({ tool, color, onClose, bbox, onToolResult, onClearResult }) => {
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const initialArea: StudyArea = bbox
    ? { mode: 'bbox' as const, lat: 0, lon: 0, latMin: bbox.latMin, latMax: bbox.latMax, lonMin: bbox.lonMin, lonMax: bbox.lonMax, lat1: bbox.latMin, lon1: bbox.lonMin, lat2: bbox.latMax, lon2: bbox.lonMax }
    : DEFAULT_STUDY_AREA;
  const [area, setArea] = useState<StudyArea>(initialArea);
  const [start, setStart] = useState('2024-01-01');
  const [end, setEnd] = useState('2024-12-31');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ result: number; unit?: string; steps: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRef, setShowRef] = useState(false);

  const meta = tool.analysisMeta;
  const displayName = tool.toolName || tool.name;

  const hasInputs = tool.inputs && tool.inputs.length > 0;
  const hasFilters = meta?.categoryFilters && meta.categoryFilters.length > 0;
  const needsTime = meta?.needsTime;

  const groupedParams = useMemo(() => {
    if (!tool.inputs) return { '': [] as AnalysisToolParameter[] };
    const groups: Record<string, AnalysisToolParameter[]> = {};
    for (const p of tool.inputs) {
      const g = p.group || '';
      if (!groups[g]) groups[g] = [];
      groups[g].push(p);
    }
    return groups;
  }, [tool.inputs]);

  const handleRun = useCallback(async () => {
    setRunning(true); setError(null); setResult(null);
    try {
      const payload: Record<string, number> = {};
      if (tool.inputs) for (const inp of tool.inputs) {
        const val = paramValues[inp.symbol]?.trim();
        payload[inp.symbol] = val ? Number(val) : (inp.default as number);
      }
      const res = await fetch(`/api/analytical-models/${tool.id}/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: payload,
          context: {
            studyArea: { mode: area.mode, point: [area.lat, area.lon], bbox: [[area.latMin, area.lonMin], [area.latMax, area.lonMax]], twoPoints: [[area.lat1, area.lon1], [area.lat2, area.lon2]] },
            time: { granularity: meta?.timeGranularity ?? null, start, end },
            filters: filterValues,
            autoDataSources: meta?.autoDataSources ?? [],
          },
        }),
      });
      if (!res.ok) { const errBody = await res.json().catch(() => ({})); throw new Error(errBody.error || `HTTP ${res.status}`); }
      const data = await res.json();
      setResult({ result: data.result, unit: data.unit, steps: data.steps });
      if (onToolResult && data.result != null) {
        const val = Number(data.result);
        const label = `${tool.name}: ${val.toExponential(3)}${data.unit ? ' ' + data.unit : ''}`;
        if (area.mode === 'point') {
          onToolResult(tool.id, label, area.lat, area.lon, val);
        } else if (bbox) {
          const lat = (bbox.latMin + bbox.latMax) / 2;
          const lon = (bbox.lonMin + bbox.lonMax) / 2;
          onToolResult(tool.id, label, lat, lon, val);
        }
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setRunning(false); }
  }, [tool.id, tool.inputs, paramValues, area, meta, start, end, filterValues, onToolResult, bbox, tool.name]);

  return (
    <div style={{
      background: 'rgba(12,12,30,0.94)', borderRadius: 12, border: `1px solid ${color}30`,
      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px ${color}10`,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px',
        background: `linear-gradient(135deg, ${color}20, ${color}08)`,
        borderBottom: `1px solid ${color}20`,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{displayName}</div>
          {tool.shortDescription && (
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{tool.shortDescription}</div>
          )}
        </div>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 2 }}>
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', maxHeight: 420 }}>
        {/* Parameters */}
        {hasInputs && (
          <div style={{ marginBottom: 10 }}>
            <div style={sectionStyle}><Play size={10} /> Parameters</div>
            {Object.entries(groupedParams).map(([group, params]) => (
              <div key={group} style={{ marginBottom: group ? 8 : 0 }}>
                {group && <div style={{ fontSize: 9, color: '#475569', marginBottom: 4 }}>{group}</div>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {params.map((p) => (
                    <ParamInput key={p.symbol} param={p} value={paramValues[p.symbol] ?? ''}
                      onChange={(v) => setParamValues(prev => ({ ...prev, [p.symbol]: v }))} color={color} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Study Area */}
        <div style={{ marginBottom: 10 }}>
          <div style={sectionStyle}><MapPin size={10} /> Study Area</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {(['point', 'bbox', 'two-points'] as StudyAreaMode[]).map((m) => (
              <button key={m} onClick={() => setArea(a => ({ ...a, mode: m }))}
                style={{
                  flex: 1, padding: '3px 0', borderRadius: 4, fontSize: 9, cursor: 'pointer',
                  border: `1px solid ${area.mode === m ? color : 'rgba(255,255,255,0.1)'}`,
                  background: area.mode === m ? `${color}20` : 'transparent',
                  color: area.mode === m ? '#c4b5fd' : '#94a3b8',
                }}>
                {STUDY_AREA_MODE_LABELS[m]}
              </button>
            ))}
          </div>
          {area.mode === 'point' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <NumberField label="Latitude" value={area.lat} unit="°" onChange={(v) => setArea(a => ({ ...a, lat: v }))} />
              <NumberField label="Longitude" value={area.lon} unit="°" onChange={(v) => setArea(a => ({ ...a, lon: v }))} />
            </div>
          )}
          {area.mode === 'bbox' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <NumberField label="Lat min" value={area.latMin} unit="°" onChange={(v) => setArea(a => ({ ...a, latMin: v }))} />
              <NumberField label="Lat max" value={area.latMax} unit="°" onChange={(v) => setArea(a => ({ ...a, latMax: v }))} />
              <NumberField label="Lon min" value={area.lonMin} unit="°" onChange={(v) => setArea(a => ({ ...a, lonMin: v }))} />
              <NumberField label="Lon max" value={area.lonMax} unit="°" onChange={(v) => setArea(a => ({ ...a, lonMax: v }))} />
            </div>
          )}
          {area.mode === 'two-points' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <NumberField label="Lat 1" value={area.lat1} unit="°" onChange={(v) => setArea(a => ({ ...a, lat1: v }))} />
              <NumberField label="Lon 1" value={area.lon1} unit="°" onChange={(v) => setArea(a => ({ ...a, lon1: v }))} />
              <NumberField label="Lat 2" value={area.lat2} unit="°" onChange={(v) => setArea(a => ({ ...a, lat2: v }))} />
              <NumberField label="Lon 2" value={area.lon2} unit="°" onChange={(v) => setArea(a => ({ ...a, lon2: v }))} />
            </div>
          )}
        </div>

        {/* Time */}
        {needsTime && (
          <div style={{ marginBottom: 10 }}>
            <div style={sectionStyle}><Clock size={10} /> Time Range</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {meta?.timeGranularity === 'multi-year' ? (
                <>
                  <div><label style={labelStyle}>Start year</label><input type="number" value={start} onChange={(e) => setStart(e.target.value)} style={fieldStyle} /></div>
                  <div><label style={labelStyle}>End year</label><input type="number" value={end} onChange={(e) => setEnd(e.target.value)} style={fieldStyle} /></div>
                </>
              ) : (
                <>
                  <div><label style={labelStyle}>Start date</label><input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={fieldStyle} /></div>
                  <div><label style={labelStyle}>End date</label><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={fieldStyle} /></div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Category Filters */}
        {hasFilters && (
          <div style={{ marginBottom: 10 }}>
            <div style={sectionStyle}><Filter size={10} /> Category Filters</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {(meta?.categoryFilters ?? []).map((f) => {
                const metaF = CATEGORY_FILTER_META[f];
                return (
                  <div key={f}>
                    <label style={labelStyle}>{metaF.label}{metaF.unit ? ` (${metaF.unit})` : ''}</label>
                    {metaF.options ? (
                      <select value={filterValues[f] ?? metaF.options[0]} onChange={(e) => setFilterValues(v => ({ ...v, [f]: e.target.value }))} style={fieldStyle}>
                        {metaF.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input type="number" value={filterValues[f] ?? ''} placeholder={metaF.min !== undefined ? `${metaF.min}–${metaF.max}` : ''}
                        min={metaF.min} max={metaF.max} onChange={(e) => setFilterValues(v => ({ ...v, [f]: e.target.value }))} style={fieldStyle} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Auto Data Sources */}
        {meta?.autoDataSources && meta.autoDataSources.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={sectionStyle}><Database size={10} /> Auto-Filled Data</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {meta.autoDataSources.map((s) => (
                <span key={s} title={AUTO_DATA_SOURCE_LABELS[s]}
                  style={{ fontSize: 8.5, padding: '2px 6px', borderRadius: 4, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#86efac', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Database size={8} /> {AUTO_DATA_SOURCE_LABELS[s]}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Output */}
        {tool.outputs && tool.outputs.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={sectionStyle}><Info size={10} /> Outputs</div>
            {tool.outputs.map((o) => (
              <div key={o.id} style={{ fontSize: 10, color: '#94a3b8', display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span>{o.label}</span>
                {o.unit && <span style={{ color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>({o.unit})</span>}
                <span style={{ fontSize: 9, color: '#475569' }}>{o.type}</span>
              </div>
            ))}
          </div>
        )}

        {/* Run Button */}
        {hasInputs && (
          <button onClick={handleRun} disabled={running}
            style={{
              width: '100%', padding: '8px 0', borderRadius: 6, border: 'none',
              background: running ? `${color}30` : `linear-gradient(135deg, ${color}40, ${color}20)`,
              color: running ? '#64748b' : '#e2e8f0', fontSize: 11, fontWeight: 600,
              cursor: running ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              marginBottom: 8,
            }}>
            {running ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={12} />}
            {running ? 'Computing...' : 'Run Tool'}
          </button>
        )}
        {!hasInputs && (
          <div style={{ padding: '6px 10px', borderRadius: 6, marginBottom: 8, background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.15)', fontSize: 10, color: '#64748b', textAlign: 'center' }}>
            Reference analysis tool (view academic reference for details)
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{ padding: '8px 10px', borderRadius: 6, marginBottom: 8, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
            <div style={{ fontSize: 9, color: '#22c55e', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Check size={9} /> Result
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>
              {result.result.toExponential(4)}{result.unit && <span style={{ color: '#94a3b8', fontWeight: 400, marginLeft: 4, fontSize: 11 }}>{result.unit}</span>}
            </div>
            {result.steps?.length > 0 && (
              <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6 }}>
                <div style={{ fontSize: 9, color: '#64748b', marginBottom: 4 }}>Computation steps</div>
                {result.steps.map((step, i) => (
                  <div key={i} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#94a3b8', lineHeight: 1.6, paddingLeft: 8, borderLeft: `2px solid ${color}30`, marginBottom: 2 }}>{step}</div>
                ))}
              </div>
            )}
            {onClearResult && (
              <button onClick={() => { onClearResult(); setResult(null); }}
                style={{
                  marginTop: 6, width: '100%', padding: '5px 0', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)',
                  background: 'rgba(239,68,68,0.08)', color: '#fca5a5', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}>
                Clear
              </button>
            )}
          </div>
        )}
        {error && (
          <div style={{ padding: '6px 10px', borderRadius: 6, marginBottom: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', fontSize: 10, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}>
            <AlertCircle size={10} /> {error}
          </div>
        )}

        {/* Reference (collapsible) */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6 }}>
          <button onClick={() => setShowRef(p => !p)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
            <BookOpen size={10} /> {showRef ? 'Hide' : 'View'} Academic Reference
          </button>
          {showRef && (
            <div style={{ marginTop: 6, fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
              <div style={{ marginBottom: 4 }}><span style={{ color: '#64748b' }}>Reference: </span>{tool.reference}</div>
              <div><span style={{ color: '#64748b' }}>Applies to: </span>{tool.appliesTo}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ToolDialog;
