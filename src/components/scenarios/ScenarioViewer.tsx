import { useEffect, useRef, useState, useCallback } from 'react';
import * as Cesium from 'cesium';
import { authHeaders } from '@/context/AuthContext';

interface Point3D { x: number; y: number; z: number }

interface Scenario {
  id: string;
  type: string;
  name: string;
  pointCloud: Point3D[];
  validationScore: number;
  severity: string;
  location: { lat: number; lon: number };
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface ScenarioViewerProps {
  viewer: Cesium.Viewer | null;
  scenario: Scenario | null;
  counterfactualScenario?: Scenario | null;
  onClose: () => void;
  onBack?: () => void;
}

type ColorMode = 'hazard' | 'intensity' | 'confidence';

const HAZARD_COLORS: Record<string, string> = {
  earthquake_swarm: '#ef4444',
  hurricane_landfall: '#f59e0b',
  wildfire_spread: '#ff6b35',
  volcanic_eruption: '#d946ef',
  flood_inundation: '#3b82f6',
  tsunami_wave: '#06b6d4',
  data_layer: '#10b981',
};

export default function ScenarioViewer({ viewer, scenario, counterfactualScenario, onClose, onBack }: ScenarioViewerProps) {
  const [colorMode, setColorMode] = useState<ColorMode>('hazard');
  const [timeProgress, setTimeProgress] = useState(0);
  const [compareMode, setCompareMode] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  const primitivesRef = useRef<Cesium.Primitive[]>([]);
  const cfPrimitivesRef = useRef<Cesium.Primitive[]>([]);
  const bboxEntitiesRef = useRef<Cesium.Entity[]>([]);
  const animFrameRef = useRef<number>(0);

  const clearPrimitives = useCallback((prims: Cesium.Primitive[]) => {
    if (!viewer) return;
    for (const p of prims) {
      viewer.scene.primitives.remove(p);
    }
    prims.length = 0;
  }, [viewer]);

  useEffect(() => {
    if (!viewer || !scenario) return;
    clearPrimitives(primitivesRef.current);
    const cv = (scenario.metadata?.colorValues as number[]) || undefined;
    const vmin = (scenario.metadata?.valueMin as number) || undefined;
    const vmax = (scenario.metadata?.valueMax as number) || undefined;
    const prims = renderPointCloud(viewer, scenario.pointCloud, scenario.location, colorMode, 1, cv, vmin, vmax);
    primitivesRef.current = prims;

    // Draw bbox rectangle on globe for reference
    for (const e of bboxEntitiesRef.current) viewer.entities.remove(e);
    bboxEntitiesRef.current = [];
    const bbox = scenario.metadata?.bbox as { latMin: number; latMax: number; lonMin: number; lonMax: number } | undefined;
    if (bbox) {
      const rect = viewer.entities.add({
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(bbox.lonMin, bbox.latMin, bbox.lonMax, bbox.latMax),
          height: 0,
          material: Cesium.Color.fromCssColorString('rgba(59,130,246,0.06)'),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('rgba(59,130,246,0.3)'),
          outlineWidth: 1,
        },
      });
      bboxEntitiesRef.current.push(rect);
    }

    return () => {
      clearPrimitives(primitivesRef.current);
      if (viewer) for (const e of bboxEntitiesRef.current) viewer.entities.remove(e);
      bboxEntitiesRef.current = [];
    };
  }, [viewer, scenario, colorMode, clearPrimitives]);

  useEffect(() => {
    if (!viewer || !counterfactualScenario || !compareMode) {
      clearPrimitives(cfPrimitivesRef.current);
      return;
    }
    clearPrimitives(cfPrimitivesRef.current);
    const cv = (counterfactualScenario.metadata?.colorValues as number[]) || undefined;
    const vmin = (counterfactualScenario.metadata?.valueMin as number) || undefined;
    const vmax = (counterfactualScenario.metadata?.valueMax as number) || undefined;
    const prims = renderPointCloud(viewer, counterfactualScenario.pointCloud, counterfactualScenario.location, colorMode, 0.6, cv, vmin, vmax);
    cfPrimitivesRef.current = prims;
    return () => { clearPrimitives(cfPrimitivesRef.current); };
  }, [viewer, counterfactualScenario, compareMode, colorMode, clearPrimitives]);

  useEffect(() => {
    if (!viewer || !scenario) return;
    let cancelled = false;
    const startTime = Date.now();
    const duration = 5000;
    const animate = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      setTimeProgress(t);
      if (t < 1) animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => { cancelled = true; cancelAnimationFrame(animFrameRef.current); };
  }, [viewer, scenario]);

  if (!scenario) {
    return (
      <div className="alerts-panel glass-panel open" style={{ width: 420, maxHeight: 'calc(100vh - 92px)' }}>
        <div className="scenario-viewer-empty">
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>
            No scenario selected
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="alerts-panel glass-panel open" style={{ width: 420, maxHeight: 'calc(100vh - 92px)' }}>
      <div className="ai-header">
        <div className="social-icon-grad" style={{ background: HAZARD_COLORS[scenario.type] || '#60a5fa' }} />
        <div className="ai-title">{scenario.name}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {onBack && <button className="ai-close" onClick={onBack} style={{ fontSize: 11, padding: '2px 10px', position: 'static', background: 'rgba(255,255,255,0.05)' }}>← Back</button>}
          <button className="ai-close" onClick={onClose}>✕</button>
        </div>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, overflowY: 'auto', maxHeight: 'calc(100vh - 140px)' }}>
        {/* Controls */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['hazard', 'intensity', 'confidence'] as ColorMode[]).map(mode => (
            <button key={mode} className={`glass-button ${colorMode === mode ? 'active' : ''}`}
              style={{ fontSize: 10, padding: '3px 8px', textTransform: 'capitalize' }}
              onClick={() => setColorMode(mode)}>
              {mode}
            </button>
          ))}
          <button className={`glass-button ${compareMode ? 'active' : ''}`}
            style={{ fontSize: 10, padding: '3px 8px' }}
            onClick={() => setCompareMode(!compareMode)}>
            Compare
          </button>
          <button className="glass-button" style={{ fontSize: 10, padding: '3px 8px' }}
            onClick={() => setShowInfo(!showInfo)}>
            {showInfo ? 'Hide Info' : 'Show Info'}
          </button>
        </div>

        {/* Info Panel */}
        {showInfo && (
          <div className="scenario-info" style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 10 }}>
            <div className="info-row"><span className="info-key">Type</span><span className="info-val">{scenario.type.replace(/_/g, ' ')}</span></div>
            <div className="info-row"><span className="info-key">Score</span><span className="info-val">{(scenario.validationScore * 100).toFixed(0)}%</span></div>
            <div className="info-row"><span className="info-key">Severity</span><span className="info-val">{scenario.severity}</span></div>
            <div className="info-row"><span className="info-key">Location</span><span className="info-val">{scenario.location.lat.toFixed(2)}°, {scenario.location.lon.toFixed(2)}°</span></div>
            <div className="info-row"><span className="info-key">Points</span><span className="info-val">{scenario.pointCloud.length}</span></div>
            <div className="info-row"><span className="info-key">Time</span><span className="info-val">{new Date(scenario.timestamp).toLocaleString()}</span></div>
            {scenario.metadata?.variableName && <div className="info-row"><span className="info-key">Variable</span><span className="info-val">{String(scenario.metadata.variableName)}</span></div>}
            {scenario.metadata?.valueMin !== undefined && (
              <div className="info-row"><span className="info-key">Range</span><span className="info-val">{(scenario.metadata.valueMin as number).toFixed(2)} – {(scenario.metadata.valueMax as number).toFixed(2)}</span></div>
            )}
            {scenario.metadata?.dataSources && Array.isArray(scenario.metadata.dataSources) && (
              <div className="info-row"><span className="info-key">Sources</span><span className="info-val" style={{ fontSize: 9 }}>{(scenario.metadata.dataSources as string[]).join(', ')}</span></div>
            )}
            {scenario.metadata?.stats && (
              <div style={{ marginTop: 4, fontSize: 9, color: 'var(--text-dim)' }}>
                <div>Stats: min {(scenario.metadata.stats as any).min}, max {(scenario.metadata.stats as any).max}, avg {(scenario.metadata.stats as any).avg}</div>
              </div>
            )}
          </div>
        )}

        {/* Time Slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 60 }}>Evolution</span>
          <input type="range" min="0" max="100" value={timeProgress * 100}
            onChange={e => setTimeProgress(Number(e.target.value) / 100)}
            style={{ flex: 1, height: 3, accentColor: '#60a5fa' }} />
        </div>

        {/* Compare Mode */}
        {compareMode && counterfactualScenario && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--text-dim)' }}>Counterfactual</div>
            <div className="info-row"><span className="info-key">Name</span><span className="info-val">{counterfactualScenario.name}</span></div>
            <div className="info-row"><span className="info-key">Score</span><span className="info-val">{(counterfactualScenario.validationScore * 100).toFixed(0)}%</span></div>
          </div>
        )}

        {/* Export Buttons */}
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button className="glass-button" style={{ fontSize: 10, flex: 1 }} onClick={() => exportScenario(scenario, 'geojson')}>GeoJSON</button>
          <button className="glass-button" style={{ fontSize: 10, flex: 1 }} onClick={() => exportScenario(scenario, 'czml')}>CZML</button>
          <button className="glass-button" style={{ fontSize: 10, flex: 1 }} onClick={() => exportScenario(scenario, 'netcdf')}>NetCDF</button>
        </div>
      </div>
    </div>
  );
}

function renderPointCloud(viewer: Cesium.Viewer, cloud: Point3D[], _center: { lat: number; lon: number }, colorMode: ColorMode, opacity: number, colorValues?: number[], valueMin?: number, valueMax?: number): Cesium.Primitive[] {
  const primitives: Cesium.Primitive[] = [];
  const batchSize = 10000;

  for (let batch = 0; batch < cloud.length; batch += batchSize) {
    const batchCloud = cloud.slice(batch, batch + batchSize);
    const geom = new Cesium.PointPrimitiveCollection({ modelMatrix: Cesium.Matrix4.IDENTITY });

    for (let i = 0; i < batchCloud.length; i++) {
      const p = batchCloud[i];
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      const lat = Math.asin(clamp(p.z / r, -1, 1)) * (180 / Math.PI);
      const lon = Math.atan2(p.y, p.x) * (180 / Math.PI);
      const height = 5000 + (1 - r) * 10000;

      let color: [number, number, number];
      if (colorValues && valueMin !== undefined && valueMax !== undefined) {
        const idx = batch + i;
        const val = colorValues[idx];
        if (val !== undefined && !isNaN(val)) {
          const t = clamp((val - valueMin) / (valueMax - valueMin || 1), 0, 1);
          color = hslToRgb(0.66 - t * 0.66, 1.0, 0.5);
        } else {
          color = [100, 100, 100];
        }
      } else {
        color = getPointColor(p, i / batchCloud.length, colorMode);
      }

      geom.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, height) as unknown as Cesium.Cartesian3,
        color: Cesium.Color.fromBytes(...color, Math.round(opacity * 255)),
        pixelSize: 3,
      });
    }
    viewer.scene.primitives.add(geom);
    primitives.push(geom as unknown as Cesium.Primitive);
  }

  return primitives;
}

function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 1/6) { r = c; g = x; }
  else if (h < 2/6) { r = x; g = c; }
  else if (h < 3/6) { g = c; b = x; }
  else if (h < 4/6) { g = x; b = c; }
  else if (h < 5/6) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function getPointColor(p: Point3D, t: number, mode: ColorMode): [number, number, number] {
  switch (mode) {
    case 'intensity': {
      const intensity = Math.abs(p.z);
      return [Math.round(255 * intensity), Math.round(255 * (1 - intensity)), 50];
    }
    case 'confidence': {
      const conf = Math.abs(p.x * p.y);
      return [Math.round(255 * (1 - conf)), Math.round(255 * conf), 100];
    }
    case 'hazard':
    default: {
      const r = Math.round(128 + 127 * Math.sin(p.x * 5));
      const g = Math.round(128 + 127 * Math.sin(p.y * 5 + 2));
      const b = Math.round(128 + 127 * Math.sin(p.z * 5 + 4));
      return [r, g, b];
    }
  }
}

function exportScenario(scenario: Scenario, format: string): void {
  fetch(`/api/scenarios/export/${scenario.id}?format=${format}`, {
    headers: { ...authHeaders() },
  })
    .then(r => {
      if (!r.ok) throw new Error(`Export failed: ${r.status}`);
      const filename = `${scenario.id}.${format === 'netcdf' ? 'nc.json' : format}`;
      return r.blob().then(blob => { downloadBlob(blob, filename); });
    })
    .catch(err => alert(err.message));
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
