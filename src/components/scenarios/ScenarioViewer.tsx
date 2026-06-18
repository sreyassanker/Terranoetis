import { useEffect, useRef, useState, useCallback } from 'react';
import * as Cesium from 'cesium';

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
}

type ColorMode = 'hazard' | 'intensity' | 'confidence';

const HAZARD_COLORS: Record<string, string> = {
  earthquake_swarm: '#ef4444',
  hurricane_landfall: '#f59e0b',
  wildfire_spread: '#ff6b35',
  volcanic_eruption: '#d946ef',
  flood_inundation: '#3b82f6',
  tsunami_wave: '#06b6d4',
};

export default function ScenarioViewer({ viewer, scenario, counterfactualScenario, onClose }: ScenarioViewerProps) {
  const [colorMode, setColorMode] = useState<ColorMode>('hazard');
  const [timeProgress, setTimeProgress] = useState(0);
  const [compareMode, setCompareMode] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  const primitivesRef = useRef<Cesium.Primitive[]>([]);
  const cfPrimitivesRef = useRef<Cesium.Primitive[]>([]);
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
    const prims = renderPointCloud(viewer, scenario.pointCloud, scenario.location, colorMode, 1);
    primitivesRef.current = prims;
    return () => { clearPrimitives(primitivesRef.current); };
  }, [viewer, scenario, colorMode, clearPrimitives]);

  useEffect(() => {
    if (!viewer || !counterfactualScenario || !compareMode) {
      clearPrimitives(cfPrimitivesRef.current);
      return;
    }
    clearPrimitives(cfPrimitivesRef.current);
    const prims = renderPointCloud(viewer, counterfactualScenario.pointCloud, counterfactualScenario.location, colorMode, 0.6);
    cfPrimitivesRef.current = prims;
    return () => { clearPrimitives(cfPrimitivesRef.current); };
  }, [viewer, counterfactualScenario, compareMode, colorMode, clearPrimitives]);

  useEffect(() => {
    if (!viewer || !scenario) return;
    const startTime = Date.now();
    const duration = 5000;
    const animate = () => {
      const elapsed = Date.now() - startTime;
      setTimeProgress(Math.min(1, elapsed / duration));
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
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
        <button className="ai-close" onClick={onClose}>✕</button>
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

function renderPointCloud(viewer: Cesium.Viewer, cloud: Point3D[], center: { lat: number; lon: number }, colorMode: ColorMode, opacity: number): Cesium.Primitive[] {
  const primitives: Cesium.Primitive[] = [];
  const batchSize = 10000;

  for (let batch = 0; batch < cloud.length; batch += batchSize) {
    const batchCloud = cloud.slice(batch, batch + batchSize);
    const positions = new Float64Array(batchCloud.length * 3);
    const colors = new Uint8Array(batchCloud.length * 4);

    for (let i = 0; i < batchCloud.length; i++) {
      const p = batchCloud[i];
      const cartesian = Cesium.Cartesian3.fromDegrees(
        center.lon + p.x * 10,
        center.lat + p.y * 10,
        p.z * 5000 + 1000,
      );
      positions[i * 3] = cartesian.x;
      positions[i * 3 + 1] = cartesian.y;
      positions[i * 3 + 2] = cartesian.z;

      const c = getPointColor(p, i / batchCloud.length, colorMode);
      colors[i * 4] = c[0];
      colors[i * 4 + 1] = c[1];
      colors[i * 4 + 2] = c[2];
      colors[i * 4 + 3] = Math.round(opacity * 255);
    }

    const geom = new Cesium.PointPrimitiveCollection({ modelMatrix: Cesium.Matrix4.IDENTITY });
    for (let i = 0; i < batchCloud.length; i++) {
      geom.add({
        position: Cesium.Cartesian3.fromArray(Array.from(positions), i * 3) as unknown as Cesium.Cartesian3,
        color: Cesium.Color.fromBytes(colors[i * 4], colors[i * 4 + 1], colors[i * 4 + 2], colors[i * 4 + 3]),
        pixelSize: 3,
      });
    }
    viewer.scene.primitives.add(geom);
    primitives.push(geom as unknown as Cesium.Primitive);
  }

  return primitives;
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

function exportScenario(_scenario: Scenario, _format: string): void {
  alert(`Export as ${_format} — server endpoint would be called.`);
}
