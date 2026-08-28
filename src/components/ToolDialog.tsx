import React, { useState, useMemo, useCallback } from 'react';
import {
  Play, Loader2, Check, AlertCircle, MapPin, Clock, Filter, Database,
  BookOpen, X, Info, Layers, Activity, Zap, Trash2, TrendingUp, FileDown,
} from 'lucide-react';
import {
  type AnalysisTool, type AnalysisToolParameter, type StudyAreaMode,
  type AggregationPeriod,
  STUDY_AREA_MODE_LABELS, CATEGORY_FILTER_META, AUTO_DATA_SOURCE_LABELS,
  AGGREGATION_LABELS, TEMPORAL_MODE_LABELS,
} from '@/data/analyticalModels';
import { ToolResultChart } from './ToolResultChart';
import type { ToolSeries } from './chartShared';
import { exportToolResultAsPDF } from '@/lib/toolReportPdf';
import { formatSci } from '@/lib/formatSci';

export interface ToolGrid {
  latMin: number; latMax: number; lonMin: number; lonMax: number;
  nLat: number; nLon: number; values: number[];
  valueMin: number; valueMax: number;
  valueMean: number; valueStd: number; valueMedian: number;
  finiteCellCount: number; hasNaN: boolean;
}

interface ToolDialogProps {
  tool: AnalysisTool;
  color: string;
  onClose: () => void;
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null;
  polygon?: Array<Array<[number, number]>>;
  points?: Array<{ lat: number; lon: number }>;
  /** What the user actually drew on the globe (drives study-area validation:
   *  a tool requiring a bbox must not accept a point and vice versa). */
  studyAreaType?: StudyAreaDrawType | null;
  onToolResult?: (
    toolId: number, label: string, lat: number, lon: number,
    value?: number, grid?: ToolGrid, unit?: string, vizType?: string,
  ) => void;
  onClearResult?: () => void;
  /** Color-stop ramp for the heatmap (matches the globe's active scheme) so the
   *  histogram bins are colored by their value the same way as the field. */
  schemeColors?: Array<{ stop: number; r: number; g: number; b: number }>;
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

/** What the user can actually draw on the globe. `null` means nothing is drawn. */
export type StudyAreaDrawType =
  | 'point' | 'rectangle' | 'polygon' | 'circle' | 'geojson' | 'shapefile' | null;

type SelectionKind = 'none' | 'point' | 'two-points' | 'bbox' | 'polygon';

interface StudyAreaSelection {
  kind: SelectionKind;
  pointCount: number;
}

/** Derive what the user currently has drawn on the globe from the active
 *  study-area type (authoritative) with a fallback to the raw geometry props. */
function deriveSelection(
  studyAreaType: StudyAreaDrawType,
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null,
  polygon: Array<Array<[number, number]>> | undefined,
  points: Array<{ lat: number; lon: number }> | undefined,
): StudyAreaSelection {
  const type = studyAreaType;
  if (type === 'point') {
    const n = points?.length ?? 0;
    if (n >= 2) return { kind: 'two-points', pointCount: n };
    if (n === 1) return { kind: 'point', pointCount: 1 };
    return { kind: 'none', pointCount: 0 };
  }
  if (type === 'rectangle') return { kind: 'bbox', pointCount: 0 };
  if (type === 'polygon' || type === 'circle') return { kind: 'polygon', pointCount: 0 };
  if (type === 'geojson' || type === 'shapefile') return { kind: 'polygon', pointCount: 0 };
  // Fallback (type unknown): prefer a wide bbox/area, then points.
  const isWideBox = bbox && (bbox.latMax - bbox.latMin > 0.2 || bbox.lonMax - bbox.lonMin > 0.2);
  if (isWideBox) return { kind: 'bbox', pointCount: 0 };
  if (points && points.length >= 2) return { kind: 'two-points', pointCount: points.length };
  if (points && points.length === 1) return { kind: 'point', pointCount: 1 };
  if (polygon && polygon.length > 0) return { kind: 'polygon', pointCount: 0 };
  if (bbox) return { kind: 'bbox', pointCount: 0 };
  return { kind: 'none', pointCount: 0 };
}

/** Does the user's current drawing satisfy a given tool required mode? */
function modeSatisfied(mode: StudyAreaMode, sel: StudyAreaSelection): boolean {
  switch (mode) {
    case 'point': return sel.kind === 'point';
    case 'two-points':
    case 'transect':
    case 'fault-line':
    case 'path': return sel.kind === 'two-points';
    case 'bbox': return sel.kind === 'bbox';
    case 'polygon': return sel.kind === 'polygon';
    case 'region':
    case 'basin':
    case 'coastal': return sel.kind === 'bbox' || sel.kind === 'polygon';
    default: return false;
  }
}

/** Build a fully-populated StudyArea for a satisfied mode from the drawn geometry. */
function buildAreaFromSelection(
  mode: StudyAreaMode,
  sel: StudyAreaSelection,
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null,
  points: Array<{ lat: number; lon: number }> | undefined,
): StudyArea {
  const base: StudyArea = { ...DEFAULT_STUDY_AREA, mode };
  switch (mode) {
    case 'point': {
      const p = sel.kind === 'point' ? points?.[0] : undefined;
      if (!p) return base;
      return { ...base, lat: p.lat, lon: p.lon };
    }
    case 'two-points':
    case 'transect':
    case 'fault-line':
    case 'path': {
      const p1 = points?.[0];
      if (!p1) return base;
      const p2 = points?.[1] ?? { lat: p1.lat + 5, lon: p1.lon + 5 };
      return {
        ...base, lat: (p1.lat + p2.lat) / 2, lon: (p1.lon + p2.lon) / 2,
        lat1: p1.lat, lon1: p1.lon, lat2: p2.lat, lon2: p2.lon,
      };
    }
    case 'bbox':
    case 'polygon':
    case 'region':
    case 'basin':
    case 'coastal': {
      if (!bbox) return base;
      const { latMin, latMax, lonMin, lonMax } = bbox;
      return {
        ...base, lat: (latMin + latMax) / 2, lon: (lonMin + lonMax) / 2,
        latMin, latMax, lonMin, lonMax,
        lat1: latMin, lon1: lonMin, lat2: latMax, lon2: lonMax,
      };
    }
    default: return base;
  }
}

/** Produce the guidance message shown when the drawn selection is invalid. */
function buildStudyAreaHint(allowed: StudyAreaMode[], sel: StudyAreaSelection): string {
  const hasTwoPointMode = allowed.some(m =>
    ['two-points', 'transect', 'fault-line', 'path'].includes(m));
  const hasPoint = allowed.includes('point');
  const hasBbox = allowed.includes('bbox');
  const hasPoly = allowed.includes('polygon');
  const hasArea = allowed.some(m => ['region', 'basin', 'coastal'].includes(m));

  if (hasTwoPointMode) {
    if (sel.kind === 'point') return 'This tool needs two points. Select the second point on the globe.';
    if (sel.kind === 'bbox' || sel.kind === 'polygon')
      return 'This tool needs two points, not an area. Place two points on the globe.';
    return 'Place two points on the globe to define the line/reach.';
  }
  if (hasPoint && !hasBbox && !hasPoly && !hasArea) {
    if (sel.kind === 'bbox' || sel.kind === 'polygon')
      return 'This tool needs a single point, not an area. Draw a point on the globe.';
    return 'Draw a point on the globe to set the location.';
  }
  if (hasBbox && !hasPoint && !hasPoly && !hasArea) {
    if (sel.kind === 'point' || sel.kind === 'two-points')
      return 'This tool needs a bounding box, not a point. Draw a rectangle on the globe.';
    if (sel.kind === 'polygon')
      return 'This tool needs a bounding box. Draw a rectangle on the globe.';
    return 'Draw a bounding box on the globe.';
  }
  if (hasPoly && !hasBbox && !hasArea) {
    if (sel.kind === 'bbox')
      return 'This tool needs a polygon. Draw a polygon on the globe.';
    return 'Draw a polygon on the globe.';
  }
  if (hasArea) {
    if (sel.kind === 'point' || sel.kind === 'two-points')
      return 'This tool needs an area (bounding box or polygon). Draw a bounding box or polygon on the globe.';
    return 'Draw a bounding box or polygon on the globe to define the area.';
  }
  return 'Select a study area on the globe to match this tool’s requirements.';
}

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
          placeholder={def === null || def === undefined ? 'auto' : String(def)} min={min ?? undefined} max={max ?? undefined} step="any"
          style={{ ...fieldStyle, borderColor: `${color}30` }}
        />
      )}
    </div>
  );
};

const NumberField: React.FC<{ label: string; value: number; unit?: string; onChange: (v: number) => void }> = ({ label, value, unit, onChange }) => (
  <div>
    <label style={labelStyle}>{label}{unit ? ` (${unit})` : ''}</label>
    <input type="number" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value))} style={fieldStyle} />
  </div>
);

const sectionStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 600, color: '#64748b', textTransform: 'uppercase',
  letterSpacing: 0.5, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5,
};

/** Format a result value for display, handling NaN/Infinity/null gracefully. */
function formatResult(val: unknown, unit?: string): string {
  const n = Number(val);
  if (!Number.isFinite(n)) return 'N/A';
  const abs = Math.abs(n);
  let str: string;
  if (abs === 0) str = '0';
  else if (abs < 0.001 || abs >= 1e6) str = formatSci(n); // "3.00 × 10¹⁸"
  else str = n.toPrecision(6);
  return unit ? `${str} ${unit}` : str;
}

/** Build a value-distribution histogram series from the finite grid cells —
 *  the standard companion to a raster map (histogram-legend convention):
 *  shows how the field's values are distributed across the study area. */
function buildGridHistogram(grid: ToolGrid, bins = 20): ToolSeries {
  const finite = grid.values.filter((v): v is number => Number.isFinite(v));
  const lo = grid.valueMin, hi = grid.valueMax;
  const span = hi - lo;
  if (finite.length === 0 || !Number.isFinite(lo) || !Number.isFinite(hi) || span <= 0) {
    return { label: 'Value Distribution', points: [] };
  }
  const counts = new Array<number>(bins).fill(0);
  for (const v of finite) {
    let b = Math.floor(((v - lo) / span) * bins);
    if (b >= bins) b = bins - 1;
    if (b < 0) b = 0;
    counts[b]++;
  }
  const points = counts.map((c, i) => ({
    x: lo + ((i + 0.5) / bins) * span,
    y: c,
  }));
  return { label: 'Value Distribution', points, color: '#8b5cf6' };
}

const GridHeatmap: React.FC<{ grid: ToolGrid; color: string; schemeColors?: Array<{ stop: number; r: number; g: number; b: number }> }> = ({ grid, color, schemeColors }) => {
  const { nLat, nLon, valueMean, valueStd, valueMedian, finiteCellCount, hasNaN } = grid;
  const histogram = React.useMemo(() => buildGridHistogram(grid, 20), [grid]);
  return (
    <div>
      {histogram.points.length > 0 ? (
        <ToolResultChart vizType="histogram" series={[histogram]} unit="" color={color} colorStops={schemeColors} />
      ) : (
        <div style={{ fontSize: 10, color: '#f59e0b', padding: 4 }}>No finite values to chart.</div>
      )}
      <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 4, background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)' }}>
        <div style={{ fontSize: 8, fontWeight: 600, color: '#c4b5fd', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Field Statistics</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '3px 12px', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>
          <span style={{ color: '#94a3b8' }}>Mean <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{formatResult(valueMean)}</span></span>
          <span style={{ color: '#94a3b8' }}>Std Dev <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{formatResult(valueStd)}</span></span>
          <span style={{ color: '#94a3b8' }}>Median <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{formatResult(valueMedian)}</span></span>
          <span style={{ color: '#94a3b8' }}>Cells <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{finiteCellCount} / {nLat * nLon}</span></span>
        </div>
      </div>
      {hasNaN && (
        <div style={{ fontSize: 8, color: '#f59e0b', marginTop: 2 }}>Some cells produced non-finite values (shown as gaps in the field).</div>
      )}
    </div>
  );
};

const ToolDialog: React.FC<ToolDialogProps> = ({ tool, color, onClose, bbox, polygon, points, studyAreaType, onToolResult, onClearResult, schemeColors }) => {
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  // Strict study-area validation: a tool only runs against a drawing that
  // satisfies one of its declared modes. A bbox-only tool must NOT accept a
  // point, and a point-only tool must NOT accept a bounding box. The lat/long
  // fields appear (pre-populated from the drawing) only once the selection is
  // valid, and Run is disabled with a guidance message otherwise.
  const allowedModes: StudyAreaMode[] = tool.analysisMeta?.allowedStudyAreaModes ?? ['point'];
  const selection = React.useMemo<StudyAreaSelection>(
    () => deriveSelection(studyAreaType ?? null, bbox, polygon, points),
    [studyAreaType, bbox, polygon, points],
  );
  const satisfiedModes = React.useMemo<StudyAreaMode[]>(
    () => allowedModes.filter(m => modeSatisfied(m, selection)),
    [allowedModes, selection],
  );
  const validSelection = satisfiedModes.length > 0;
  const studyAreaHint = React.useMemo(
    () => (validSelection ? null : buildStudyAreaHint(allowedModes, selection)),
    [validSelection, allowedModes, selection],
  );
  const initialArea: StudyArea = validSelection
    ? buildAreaFromSelection(satisfiedModes[0], selection, bbox, points)
    : { ...DEFAULT_STUDY_AREA, mode: allowedModes[0] ?? 'point' };
  const [area, setArea] = useState<StudyArea>(initialArea);
  // Keep the study area in sync with the globe drawing: when the selection
  // changes, snap the mode into the satisfied set and (re)populate the
  // lat/long fields from the geometry. Manual edits to the fields are
  // preserved until the drawing itself is changed.
  React.useEffect(() => {
    if (satisfiedModes.length === 0) return;
    setArea(prev => {
      const mode = satisfiedModes.includes(prev.mode) ? prev.mode : satisfiedModes[0];
      const next = buildAreaFromSelection(mode, selection, bbox, points);
      const same =
        prev.mode === next.mode && prev.lat === next.lat && prev.lon === next.lon &&
        prev.latMin === next.latMin && prev.latMax === next.latMax &&
        prev.lonMin === next.lonMin && prev.lonMax === next.lonMax &&
        prev.lat1 === next.lat1 && prev.lon1 === next.lon1 &&
        prev.lat2 === next.lat2 && prev.lon2 === next.lon2;
      return same ? prev : next;
    });
  }, [satisfiedModes, selection, bbox, points]);
  const isMultiYear = tool.analysisMeta?.timeGranularity === 'multi-year';
  const [start, setStart] = useState(isMultiYear ? '2020' : '2025-01-01');
  const [end, setEnd] = useState(isMultiYear ? '2024' : '2025-12-31');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    result: number; unit?: string; steps: string[]; series?: Array<{ label: string; points: Array<{ x: number; y: number }>; color?: string }>; secondary?: Array<{ key: string; value: number; unit?: string; label: string }>; log?: string[]; warnings?: string[];
    visualizationType?: string;
    grid?: ToolGrid; dataSource?: string; fetchedParams?: Record<string, unknown>; label?: string;
    validation?: { valid: boolean; errors: string[]; warnings: string[] };
    qualityControl?: { passed: boolean; checks: Array<{ name: string; passed: boolean; message: string; severity: string }> };
    uncertainty?: { method: string; rmse?: number; rmseUnit?: string; confidenceInterval?: { lower: number; upper: number; level: number }; contributingFactors: Array<{ factor: string; contribution: string }>; overallAssessment: string };
    interpretation?: { classification?: { label: string; color: string; description: string }; contextualAnalysis: string; recommendations: string[] };
    workflowLog?: string[];
    dataQualityScore?: number;
    processingTimeMs?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRef, setShowRef] = useState(false);
  const [showScientificConcept, setShowScientificConcept] = useState(false);
  const [showMethodology, setShowMethodology] = useState(false);
  const [showOutputInterpretation, setShowOutputInterpretation] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
        if (val) payload[inp.symbol] = Number(val);
        // Parameters without a numeric default (and left empty) are NOT
        // sent as fabricated values — the server derives them genuinely
        // from live context data or reports honest NaN.
        else if (inp.default !== undefined && inp.default !== null) {
          payload[inp.symbol] = inp.default as number;
        }
      }
      const res = await fetch(`/api/analytical-models/${tool.id}/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: payload,
          context: {
            studyArea: { mode: area.mode, point: [area.lat, area.lon], bbox: [[area.latMin, area.lonMin], [area.latMax, area.lonMax]], twoPoints: [[area.lat1, area.lon1], [area.lat2, area.lon2]], polygon: area.mode === 'bbox' ? polygon : undefined },
            time: { granularity: meta?.timeGranularity ?? null, start, end },
            filters: filterValues,
            autoDataSources: meta?.autoDataSources ?? [],
          },
        }),
      });
      if (!res.ok) { const errBody = await res.json().catch(() => ({})); throw new Error(errBody.error || `HTTP ${res.status}`); }
      const data = await res.json();
      const grid = data.grid ?? undefined;
      setResult({
        result: data.result, unit: data.unit, steps: data.steps ?? [], series: data.series, secondary: data.secondary, log: data.log,
        visualizationType: data.visualizationType,
        warnings: data.warnings, grid, dataSource: data.dataSource, fetchedParams: data.fetchedParams,
        label: tool.name,
        validation: data.validation, qualityControl: data.qualityControl,
        uncertainty: data.uncertainty, interpretation: data.interpretation,
        workflowLog: data.workflowLog, dataQualityScore: data.dataQualityScore,
        processingTimeMs: data.processingTimeMs,
      });
      if (onToolResult && data.result != null) {
        const val = Number(data.result);
        const displayName = tool.toolName || tool.name;
        // For spatial-field tools (heatmap/contour/vector) the legend label is
        // just the tool name — the centre-point scalar value is misleading for
        // a varying field. Non-spatial tools keep the value in the label.
        const isFieldViz = ['heatmap', 'contour', 'vector'].includes(data.visualizationType ?? '');
        const label = isFieldViz ? displayName : `${displayName}: ${formatResult(val, data.unit)}`;
        const useLat = area.mode === 'point' ? area.lat : (bbox ? (bbox.latMin + bbox.latMax) / 2 : area.lat);
        const useLon = area.mode === 'point' ? area.lon : (bbox ? (bbox.lonMin + bbox.lonMax) / 2 : area.lon);
        onToolResult(tool.id, label, useLat, useLon, Number.isFinite(val) ? val : undefined, grid, data.unit, data.visualizationType);
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setRunning(false); }
  }, [tool.id, tool.inputs, tool.toolName, tool.name, paramValues, area, meta, start, end, filterValues, onToolResult, bbox, polygon]);

  const resultIsFinite = result && Number.isFinite(result.result);

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
          <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 6 }}>
            {displayName}
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: color, background: `${color}15`, padding: '1px 5px', borderRadius: 3 }}>#{tool.id}</span>
          </div>
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
        {/* Equation */}
        {tool.equation && (
          <div style={{ marginBottom: 10, padding: '6px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.3)', border: `1px solid ${color}15` }}>
            <div style={{ fontSize: 8, color: '#64748b', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Equation</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: color, lineHeight: 1.5 }}>{tool.equation}</div>
          </div>
        )}

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

        {/* Study Area — only show controls for scientifically relevant modes */}
        {allowedModes.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={sectionStyle}>
            <MapPin size={10} /> Study Area
            {allowedModes.length === 1 && (
              <span style={{ marginLeft: 4, fontSize: 9, color: color, fontFamily: 'JetBrains Mono, monospace' }}>
                {STUDY_AREA_MODE_LABELS[allowedModes[0]]}
              </span>
            )}
          </div>
          {allowedModes.length > 1 && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {allowedModes.map((m) => (
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
          )}
          {validSelection ? (
            <>
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
          {(area.mode === 'polygon' || area.mode === 'transect' || area.mode === 'coastal' || area.mode === 'basin' || area.mode === 'fault-line' || area.mode === 'region' || area.mode === 'path') && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <NumberField label="Center Lat" value={area.lat} unit="°" onChange={(v) => setArea(a => ({ ...a, lat: v }))} />
              <NumberField label="Center Lon" value={area.lon} unit="°" onChange={(v) => setArea(a => ({ ...a, lon: v }))} />
              <NumberField label="Lat extent" value={area.latMax - area.latMin} unit="°" onChange={(v) => setArea(a => ({ ...a, latMax: a.latMin + v, latMin: a.latMin }))} />
              <NumberField label="Lon extent" value={area.lonMax - area.lonMin} unit="°" onChange={(v) => setArea(a => ({ ...a, lonMax: a.lonMin + v, lonMin: a.lonMin }))} />
            </div>
          )}
            </>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 4,
              padding: '6px 8px', borderRadius: 6, fontSize: 10, lineHeight: 1.4,
              color: '#fcd34d', background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.35)',
            }}>
              <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{studyAreaHint}</span>
            </div>
          )}
        </div>
        )}

        {/* Time */}
        {needsTime && (
          <div style={{ marginBottom: 10 }}>
            <div style={sectionStyle}><Clock size={10} /> Time Range {meta && <span style={{ marginLeft: 4, fontSize: 8, color: '#64748b' }}>({TEMPORAL_MODE_LABELS[meta.temporalMode]})</span>}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {meta?.timeGranularity === 'multi-year' ? (
                <>
                  <div><label style={labelStyle}>Start year</label><input type="number" value={start.replace(/-\d{2}-\d{2}$/, '')} onChange={(e) => setStart(e.target.value)} style={fieldStyle} /></div>
                  <div><label style={labelStyle}>End year</label><input type="number" value={end.replace(/-\d{2}-\d{2}$/, '')} onChange={(e) => setEnd(e.target.value)} style={fieldStyle} /></div>
                </>
              ) : (
                <>
                  {meta?.temporalControls?.includes('start-date') && (
                    <div><label style={labelStyle}>Start date</label><input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={fieldStyle} /></div>
                  )}
                  {meta?.temporalControls?.includes('end-date') && (
                    <div><label style={labelStyle}>End date</label><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={fieldStyle} /></div>
                  )}
                  {meta?.temporalControls?.includes('start-time') && (
                    <div><label style={labelStyle}>Start time</label><input type="time" defaultValue="00:00" style={fieldStyle} /></div>
                  )}
                  {meta?.temporalControls?.includes('end-time') && (
                    <div><label style={labelStyle}>End time</label><input type="time" defaultValue="23:59" style={fieldStyle} /></div>
                  )}
                  {meta?.temporalControls?.includes('time-zone') && (
                    <div><label style={labelStyle}>Time zone</label>
                      <select defaultValue="UTC" style={fieldStyle}>
                        {['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Kolkata', 'Australia/Sydney'].map(tz => <option key={tz} value={tz}>{tz}</option>)}
                      </select>
                    </div>
                  )}
                  {meta?.temporalControls?.includes('time-interval') && (
                    <div><label style={labelStyle}>Time interval</label>
                      <select defaultValue={meta.defaultAggregation} style={fieldStyle}>
                        {(['instant', 'hourly', 'daily', 'weekly', 'monthly', 'seasonal', 'annual'] as AggregationPeriod[]).map(a => <option key={a} value={a}>{AGGREGATION_LABELS[a]}</option>)}
                      </select>
                    </div>
                  )}
                  {meta?.temporalControls?.includes('aggregation') && (
                    <div><label style={labelStyle}>Aggregation</label>
                      <select defaultValue={meta.defaultAggregation} style={fieldStyle}>
                        {(['instant', 'hourly', 'daily', 'weekly', 'monthly', 'seasonal', 'annual', 'climatology'] as AggregationPeriod[]).map(a => <option key={a} value={a}>{AGGREGATION_LABELS[a]}</option>)}
                      </select>
                    </div>
                  )}
                  {meta?.temporalControls?.includes('forecast-lead') && (
                    <div><label style={labelStyle}>Forecast lead</label>
                      <select defaultValue="0-24h" style={fieldStyle}>
                        {['Analysis (now)', '0-24h', '1-3 days', '4-7 days', '8-14 days', 'Monthly', 'Seasonal'].map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                  )}
                  {meta?.temporalControls?.includes('historical-forecast') && (
                    <div><label style={labelStyle}>Data mode</label>
                      <select defaultValue={meta.temporalMode} style={fieldStyle}>
                        {['historical', 'forecast', 'realtime', 'both'].map(m => <option key={m} value={m}>{TEMPORAL_MODE_LABELS[m as keyof typeof TEMPORAL_MODE_LABELS]}</option>)}
                      </select>
                    </div>
                  )}
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
            <div style={sectionStyle}><Database size={10} /> Auto-Fetched Data Sources</div>
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

        {/* Outputs */}
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

        {/* Run Button — disabled until a valid study area is drawn */}
        <button onClick={handleRun} disabled={running || !validSelection}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 6, border: 'none',
            background: (running || !validSelection) ? `${color}30` : `linear-gradient(135deg, ${color}40, ${color}20)`,
            color: (running || !validSelection) ? '#64748b' : '#e2e8f0', fontSize: 12, fontWeight: 600,
            cursor: (running || !validSelection) ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            marginBottom: 8,
          }}>
          {running ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} />}
          {running ? 'Computing with live data...' : (!validSelection ? 'Select a Study Area First' : (hasInputs ? 'Run Analysis' : 'Compute with Auto-Fetched Data'))}
        </button>

        {/* Result */}
        {result && (
          <div style={{ padding: '8px 10px', borderRadius: 6, marginBottom: 8, background: resultIsFinite ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)', border: `1px solid ${resultIsFinite ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)'}` }}>
            <div style={{ fontSize: 9, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4, color: resultIsFinite ? '#22c55e' : '#f59e0b' }}>
              {resultIsFinite ? <Check size={9} /> : <AlertCircle size={9} />} Result
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, color: '#e2e8f0', fontWeight: 600 }}>
              {formatResult(result.result, result.unit)}
            </div>

            {/* Secondary outputs (e.g. GDD Method 2, method difference) */}
            {result.secondary && result.secondary.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {result.secondary.map((s) => (
                  <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8', padding: '1px 0', borderBottom: '1px dashed rgba(255,255,255,0.06)' }}>
                    <span>{s.label}</span>
                    <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{Number.isFinite(s.value) ? (Math.abs(s.value) >= 100 ? s.value.toFixed(1) : s.value.toFixed(2)) + (s.unit ? ` ${s.unit}` : '') : 'NaN'}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Visualization: render the tool's chart series (timeseries, profile,
                spectrum, scatter, bar, histogram, distribution) when the engine
                emitted numeric series data. */}
            {result.series && result.series.length > 0 && (
              <div id="tool-result-chart" style={{ marginTop: 8 }}>
                <ToolResultChart vizType={result.visualizationType ?? 'scalar'} series={result.series} unit={result.unit} color={color} />
              </div>
            )}

            {/* Data Source Provenance */}
            {result.dataSource && result.dataSource !== 'user-provided' && (
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <Database size={9} color="#475569" />
                {result.dataSource.split(', ').map((src, i) => (
                  <span key={i} style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', color: '#a78bfa', fontFamily: 'JetBrains Mono, monospace' }}>{src}</span>
                ))}
              </div>
            )}

            {/* Workflow Status Bar: Validation + QC + Data Quality */}
            <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {result.validation && (
                <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: result.validation.valid ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${result.validation.valid ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`, color: result.validation.valid ? '#86efac' : '#fca5a5', display: 'flex', alignItems: 'center', gap: 3 }}>
                  {result.validation.valid ? <Check size={8} /> : <AlertCircle size={8} />} Validation {result.validation.valid ? 'OK' : 'FAILED'}
                </span>
              )}
              {result.qualityControl && (
                <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: result.qualityControl.passed ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)', border: `1px solid ${result.qualityControl.passed ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`, color: result.qualityControl.passed ? '#86efac' : '#fbbf24', display: 'flex', alignItems: 'center', gap: 3 }}>
                  {result.qualityControl.passed ? <Check size={8} /> : <AlertCircle size={8} />} QC {result.qualityControl.passed ? 'PASS' : 'CHECK'}
                </span>
              )}
              {result.dataQualityScore !== undefined && (
                <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', color: '#a78bfa', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Zap size={8} /> Quality {Math.round(result.dataQualityScore * 100)}%
                </span>
              )}
              {result.processingTimeMs !== undefined && (
                <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)', color: '#94a3b8' }}>
                  {result.processingTimeMs < 1000 ? result.processingTimeMs + 'ms' : (result.processingTimeMs / 1000).toFixed(1) + 's'}
                </span>
              )}
            </div>

            {/* Classification Badge */}
            {result.interpretation?.classification && (
              <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4, background: `${result.interpretation.classification.color}15`, border: `1px solid ${result.interpretation.classification.color}40`, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: result.interpretation.classification.color, flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: result.interpretation.classification.color }}>{result.interpretation.classification.label}</span>
                <span style={{ fontSize: 9, color: '#94a3b8', flex: 1 }}>{result.interpretation.classification.description}</span>
              </div>
            )}

            {/* Uncertainty Estimation */}
            {result.uncertainty && (
              <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 4, background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.15)' }}>
                <div style={{ fontSize: 8, fontWeight: 600, color: '#60a5fa', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Uncertainty Estimation</div>
                {result.uncertainty.rmse !== undefined && (
                  <div style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace' }}>
                    RMSE: {result.uncertainty.rmse} {result.uncertainty.rmseUnit || ''} (method: {result.uncertainty.method})
                  </div>
                )}
                {result.uncertainty.confidenceInterval && (
                  <div style={{ fontSize: 9, color: '#60a5fa', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
                    {(result.uncertainty.confidenceInterval.level * 100).toFixed(0)}% CI: [{result.uncertainty.confidenceInterval.lower.toFixed(4)}, {result.uncertainty.confidenceInterval.upper.toFixed(4)}]
                  </div>
                )}
                <div style={{ fontSize: 9, color: '#64748b', marginTop: 3, lineHeight: 1.4 }}>{result.uncertainty.overallAssessment}</div>
                {result.uncertainty.contributingFactors.length > 0 && (
                  <div style={{ marginTop: 3 }}>
                    {result.uncertainty.contributingFactors.map((f, i) => (
                      <div key={i} style={{ fontSize: 8, color: '#64748b', display: 'flex', gap: 4, marginTop: 1 }}>
                        <span style={{ color: '#475569' }}>•</span>
                        <span><b style={{ color: '#94a3b8' }}>{f.factor}:</b> {f.contribution}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Contextual Analysis */}
            {result.interpretation?.contextualAnalysis && (
              <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 4, background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.15)' }}>
                <div style={{ fontSize: 8, fontWeight: 600, color: '#c084fc', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Contextual Analysis</div>
                <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>{result.interpretation.contextualAnalysis}</div>
              </div>
            )}

            {/* Scientific Recommendations */}
            {result.interpretation?.recommendations && result.interpretation.recommendations.length > 0 && (
              <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 4, background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)' }}>
                <div style={{ fontSize: 8, fontWeight: 600, color: '#86efac', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <TrendingUp size={9} /> Scientific Recommendations
                </div>
                {result.interpretation.recommendations.map((rec, i) => (
                  <div key={i} style={{ fontSize: 9, color: '#94a3b8', display: 'flex', gap: 4, marginBottom: 2, lineHeight: 1.4 }}>
                    <span style={{ color: '#22c55e', flexShrink: 0 }}>{i + 1}.</span>
                    <span>{rec}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Spatial Field: the globe shows the heatmap itself, so the panel
                shows the companion value-distribution histogram + statistics
                (histogram-legend convention) instead of a redundant mini-map. */}
            {result.grid && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 9, color: '#c4b5fd', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Layers size={10} /> Spatial Field · {result.grid.nLat}×{result.grid.nLon} cells
                </div>
                <GridHeatmap grid={result.grid} color={color} schemeColors={schemeColors} />
              </div>
            )}

            {/* Warnings */}
            {result.warnings && result.warnings.length > 0 && (
              <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                {result.warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 9, color: '#fbbf24', display: 'flex', alignItems: 'flex-start', gap: 3, marginBottom: 2 }}>
                    <AlertCircle size={9} style={{ flexShrink: 0, marginTop: 1 }} /> {w}
                  </div>
                ))}
              </div>
            )}

            {/* Computation Steps */}
            {result.steps?.length > 0 && (
              <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6 }}>
                <button onClick={() => setShowAdvanced(p => !p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 9, display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
                  <Activity size={9} /> {showAdvanced ? 'Hide' : 'Show'} computation steps ({result.steps.length})
                </button>
                {showAdvanced && (
                  <div style={{ marginTop: 4 }}>
                    {result.steps.map((step, i) => (
                      <div key={i} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#94a3b8', lineHeight: 1.6, paddingLeft: 8, borderLeft: `2px solid ${color}30`, marginBottom: 2 }}>{step}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Workflow Log (7-stage pipeline) */}
            {result.workflowLog && result.workflowLog.length > 0 && showAdvanced && (
              <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', maxHeight: 150, overflowY: 'auto' }}>
                <div style={{ fontSize: 9, color: '#64748b', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Activity size={9} /> SCIENTIFIC WORKFLOW LOG ({result.workflowLog.length} entries)
                </div>
                {result.workflowLog.map((l, i) => (
                  <div key={i} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: l.includes('ERROR') ? '#ef4444' : l.includes('WARN') ? '#fbbf24' : l.includes('PASS') ? '#86efac' : l.match(/^\[\d\/7\]/) ? '#a78bfa' : '#94a3b8', lineHeight: 1.5 }}>{l}</div>
                ))}
              </div>
            )}

            {resultIsFinite && (
              <button onClick={async () => {
                await exportToolResultAsPDF({
                  toolName: tool.toolName || tool.name || '',
                  toolId: tool.id,
                  resultText: `${formatResult(result.result)}`,
                  resultUnit: result.unit || '—',
                  secondary: result.secondary?.map(s => ({ label: s.label, value: `${Number.isFinite(s.value) ? (Math.abs(s.value) >= 100 ? s.value.toFixed(1) : s.value.toFixed(2)) + (s.unit ? ' ' + s.unit : '') : 'NaN'}` })),
                  dataSource: result.dataSource,
                  contextualAnalysis: result.interpretation?.contextualAnalysis,
                  recommendations: result.interpretation?.recommendations,
                  steps: result.steps,
                  series: result.series,
                  seriesVizType: result.visualizationType,
                  grid: result.grid ? {
                    valueMin: result.grid.valueMin, valueMax: result.grid.valueMax,
                    valueMean: result.grid.valueMean, valueStd: result.grid.valueStd,
                    valueMedian: result.grid.valueMedian,
                    finiteCellCount: result.grid.finiteCellCount, nLat: result.grid.nLat, nLon: result.grid.nLon,
                  } : undefined,
                  colorStops: schemeColors,
                  gridValues: result.grid ? result.grid.values.filter((v): v is number => Number.isFinite(v)) : undefined,
                });
              }}
                style={{
                  marginTop: 6, width: '100%', padding: '5px 0', borderRadius: 6, border: '1px solid rgba(139,92,246,0.3)',
                  background: 'rgba(139,92,246,0.08)', color: '#a78bfa', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}>
                <FileDown size={10} /> Download PDF Report
              </button>
            )}

            {onClearResult && (
              <button onClick={() => { onClearResult(); setResult(null); }}
                style={{
                  marginTop: 6, width: '100%', padding: '5px 0', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)',
                  background: 'rgba(239,68,68,0.08)', color: '#fca5a5', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}>
                <Trash2 size={10} /> Clear Result
              </button>
            )}
          </div>
        )}
        {error && (
          <div style={{ padding: '6px 10px', borderRadius: 6, marginBottom: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', fontSize: 10, color: '#ef4444', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
            <AlertCircle size={10} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
          </div>
        )}

        {/* Scientific Concept */}
        {tool.scientificConcept && (
          <div style={{ marginBottom: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.15)' }}>
            <button onClick={() => setShowScientificConcept(p => !p)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
              <div style={{ ...sectionStyle, flex: 1, marginBottom: 0 }}><Info size={10} /> Scientific Concept</div>
              <span style={{ fontSize: 9, color: '#64748b' }}>{showScientificConcept ? 'Hide' : 'View'}</span>
            </button>
            {showScientificConcept && (
              <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5, marginTop: 4 }}>{tool.scientificConcept}</div>
            )}
          </div>
        )}

        {/* Methodology */}
        {tool.methodology && (
          <div style={{ marginBottom: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(234,179,8,0.05)', border: '1px solid rgba(234,179,8,0.15)' }}>
            <button onClick={() => setShowMethodology(p => !p)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
              <div style={{ ...sectionStyle, flex: 1, marginBottom: 0 }}><Zap size={10} /> Processing Methodology</div>
              <span style={{ fontSize: 9, color: '#64748b' }}>{showMethodology ? 'Hide' : 'View'}</span>
            </button>
            {showMethodology && (
              tool.processingSteps ? (
                <ol style={{ margin: 0, paddingLeft: 16, fontSize: 10, color: '#94a3b8', lineHeight: 1.6, marginTop: 4 }}>
                  {tool.processingSteps.map((step, i) => (
                    <li key={i} style={{ marginBottom: 3 }}>{step}</li>
                  ))}
                </ol>
              ) : (
                <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginTop: 4 }}>{tool.methodology}</div>
              )
            )}
          </div>
        )}

        {/* Output Interpretation */}
        {tool.outputInterpretation && (
          <div style={{ marginBottom: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)' }}>
            <button onClick={() => setShowOutputInterpretation(p => !p)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
              <div style={{ ...sectionStyle, flex: 1, marginBottom: 0 }}><TrendingUp size={10} /> Output Interpretation</div>
              <span style={{ fontSize: 9, color: '#64748b' }}>{showOutputInterpretation ? 'Hide' : 'View'}</span>
            </button>
            {showOutputInterpretation && (
              <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginTop: 4 }}>{tool.outputInterpretation}</div>
            )}
          </div>
        )}

        {/* Assumptions & Limitations */}
        {(tool.assumptions || tool.limitations) && (
          <div style={{ marginBottom: 8 }}>
            {tool.assumptions && tool.assumptions.length > 0 && (
              <div style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 8, color: '#f59e0b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Assumptions</div>
                <ul style={{ margin: 0, paddingLeft: 14, fontSize: 9, color: '#94a3b8', lineHeight: 1.5 }}>
                  {tool.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
            {tool.limitations && tool.limitations.length > 0 && (
              <div>
                <div style={{ fontSize: 8, color: '#ef4444', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Limitations</div>
                <ul style={{ margin: 0, paddingLeft: 14, fontSize: 9, color: '#94a3b8', lineHeight: 1.5 }}>
                  {tool.limitations.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            )}
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
              {tool.paperUrl && (
                <div style={{ marginBottom: 4 }}>
                  <a href={tool.paperUrl} target="_blank" rel="noopener noreferrer"
                    style={{ color: '#60a5fa', textDecoration: 'none', borderBottom: '1px solid rgba(96,165,250,0.3)' }}>
                    <BookOpen size={9} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                    View Paper ↗
                  </a>
                </div>
              )}
              {tool.paperSummary && (
                <div style={{ marginBottom: 4, whiteSpace: 'pre-wrap' }}><span style={{ color: '#64748b' }}>Paper Summary: </span>{tool.paperSummary}</div>
              )}
              <div><span style={{ color: '#64748b' }}>Applies to: </span>{tool.appliesTo}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ToolDialog;
