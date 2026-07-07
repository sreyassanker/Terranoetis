import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Eye } from 'lucide-react';
import * as Cesium from 'cesium';
import { authHeaders } from '@/context/AuthContext';
import type { Point3D, Scenario, TimeStep, ShapeData } from './types';
import { SCENARIO_TYPE_COLORS } from './types';
import Panel from '@/components/ui/Panel';
import { renderHazardShapes, clearHazardShapes } from './hazardRenderers';
import FloodWaterSurface from './FloodWaterSurface';
import EarthquakeVisualizer from './EarthquakeVisualizer';
import HurricaneVisualizer from './HurricaneVisualizer';
import WildfireVisualizer from './WildfireVisualizer';
import VolcanicVisualizer from './VolcanicVisualizer';
import TimelineControls from './TimelineControls';

interface ScenarioViewerProps {
  viewer: Cesium.Viewer | null;
  scenario: Scenario | null;
  counterfactualScenario?: Scenario | null;
  onClose: () => void;
  onBack?: () => void;
}

type ColorMode = 'hazard' | 'intensity' | 'confidence';

interface StepPrimitives {
  pointPrims: Cesium.Primitive[];
  shapeEntities: Cesium.Entity[];
  floodSurfaceShapes?: ShapeData[];
  earthquakeShapes?: ShapeData[];
  hurricaneShapes?: ShapeData[];
  wildfireShapes?: ShapeData[];
  volcanicShapes?: ShapeData[];
}

/** How many steps ahead/behind the current step to pre-create */
const LAZY_WINDOW = 2;

export default function ScenarioViewer({ viewer, scenario, counterfactualScenario, onClose, onBack }: ScenarioViewerProps) {
  const [colorMode, setColorMode] = useState<ColorMode>('hazard');
  const [compareMode, setCompareMode] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [speed, setSpeed] = useState(1);
  const primitivesRef = useRef<Cesium.Primitive[]>([]);
  const cfPrimitivesRef = useRef<Cesium.Primitive[]>([]);
  const bboxEntitiesRef = useRef<Cesium.Entity[]>([]);
  const stepPrimsRef = useRef<StepPrimitives[]>([]);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const timeSeries = scenario?.timeSeries;
  const steps: TimeStep[] = useMemo(() => timeSeries?.steps ?? [], [timeSeries]);
  const hasTimeline = steps.length > 1;
  const duration = timeSeries?.metadata?.duration ?? 0;
  const dt = timeSeries?.metadata?.dt ?? 1;

  const clearPrimitives = useCallback((prims: Cesium.Primitive[]) => {
    if (!viewer) return;
    for (const p of prims) {
      viewer.scene.primitives.remove(p);
    }
    prims.length = 0;
  }, [viewer]);

  const clearAllStepPrims = useCallback(() => {
    if (!viewer) return;
    const ec = viewer.entities;
    ec.suspendEvents();
    for (const sp of stepPrimsRef.current) {
      if (!sp) continue; // sparse array — skip empty slots
      for (const p of sp.pointPrims) viewer.scene.primitives.remove(p);
      for (const e of sp.shapeEntities) ec.remove(e);
    }
    stepPrimsRef.current = [];
    ec.resumeEvents();
  }, [viewer]);

  const showStep = useCallback((stepIdx: number) => {
    const refs = stepPrimsRef.current;
    for (let i = 0; i < refs.length; i++) {
      if (!refs[i]) continue; // sparse array — skip empty slots
      const show = i === stepIdx;
      for (const p of refs[i].pointPrims) p.show = show;
      for (const e of refs[i].shapeEntities) e.show = show;
    }
  }, []);

  /** Create a single step's primitives on demand */
  const ensureStepCreated = useCallback((stepIdx: number) => {
    if (!viewer || !scenario || !hasTimeline) return;
    const refs = stepPrimsRef.current;
    if (refs[stepIdx]) return; // already created

    const step = steps[stepIdx];
    if (!step) return;

    const cv = (scenario.metadata?.colorValues as number[]) || undefined;
    const vmin = (scenario.metadata?.valueMin as number) || undefined;
    const vmax = (scenario.metadata?.valueMax as number) || undefined;
    const pointPrims = renderPointCloud(viewer, step.points, scenario.location, colorMode, 1, cv, vmin, vmax);

    // Extract type-specific shape arrays for specialized visualizers
    const floodSurfaceShapes = step.shapes.filter(s => s.type === 'flood_surface');
    const earthquakeShapes = step.shapes.filter(s => s.type === 'wavefront' || s.type === 'intensity_zone' || s.type === 'damage_zone' || s.type === 'liquefaction_zone' || s.type === 'ring');
    const hurricaneShapes = step.shapes.filter(s => s.type === 'cylinder' || s.type === 'polyline' || s.type === 'intensity_zone' || s.type === 'ring' || s.type === 'polygon');
    const wildfireShapes = step.shapes.filter(s => s.type === 'polyline' || s.type === 'intensity_zone' || s.type === 'cylinder' || s.type === 'ring' || s.type === 'damage_zone');
    const volcanicShapes = step.shapes.filter(s => s.type === 'cylinder' || s.type === 'polyline' || s.type === 'intensity_zone' || s.type === 'ring');

    // Static type sets per scenario — prevents double-rendering (static generic + animated specialized)
    const specializedTypes = new Set<string>();
    if (scenario.type === 'earthquake_swarm') {
      for (const t of ['wavefront', 'intensity_zone', 'damage_zone', 'liquefaction_zone', 'ring']) specializedTypes.add(t);
    } else if (scenario.type === 'hurricane_landfall') {
      for (const t of ['cylinder', 'polyline', 'intensity_zone', 'ring', 'polygon']) specializedTypes.add(t);
    } else if (scenario.type === 'wildfire_spread') {
      for (const t of ['polyline', 'intensity_zone', 'cylinder', 'ring', 'damage_zone']) specializedTypes.add(t);
    } else if (scenario.type === 'volcanic_eruption') {
      for (const t of ['cylinder', 'polyline', 'intensity_zone', 'ring']) specializedTypes.add(t);
    } else if (scenario.type === 'flood_inundation' || scenario.type === 'tsunami_wave') {
      specializedTypes.add('flood_surface');
    }

    // Only pass shapes to generic renderer that are NOT handled by specialized visualizers
    // This prevents double-rendering (static generic + animated specialized)
    const genericShapes = specializedTypes.size > 0
      ? step.shapes.filter(s => !specializedTypes.has(s.type))
      : step.shapes;
    const shapeEntities = renderHazardShapes(viewer, genericShapes);

    refs[stepIdx] = { pointPrims, shapeEntities, floodSurfaceShapes, earthquakeShapes, hurricaneShapes, wildfireShapes, volcanicShapes };

    // Hide all newly created entities/primitives (showStep will show the right one)
    for (const p of pointPrims) p.show = false;
    for (const e of shapeEntities) e.show = false;
  }, [viewer, scenario, hasTimeline, steps, colorMode]);

  /** Lazily create steps around current position */
  const ensureWindowCreated = useCallback((centerStep: number) => {
    if (!hasTimeline) return;
    const start = Math.max(0, centerStep - LAZY_WINDOW);
    const end = Math.min(steps.length - 1, centerStep + LAZY_WINDOW);
    for (let i = start; i <= end; i++) {
      ensureStepCreated(i);
    }
  }, [ensureStepCreated, hasTimeline, steps.length]);

  useEffect(() => {
    if (!viewer || !scenario) return;
    clearAllStepPrims();
    clearPrimitives(primitivesRef.current);

    if (hasTimeline && steps.length > 0) {
      // Only create the current step ± window (lazy loading)
      stepPrimsRef.current = new Array(steps.length); // sparse array
      ensureWindowCreated(currentStep);
      showStep(currentStep);
    } else {
      const cv = (scenario.metadata?.colorValues as number[]) || undefined;
      const vmin = (scenario.metadata?.valueMin as number) || undefined;
      const vmax = (scenario.metadata?.valueMax as number) || undefined;
      const prims = renderPointCloud(viewer, scenario.pointCloud, scenario.location, colorMode, 1, cv, vmin, vmax);
      primitivesRef.current = prims;
      if (scenario.timeSeries?.steps?.[0]?.shapes) {
        renderHazardShapes(viewer, scenario.timeSeries.steps[0].shapes);
      }
    }

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
      clearAllStepPrims();
      clearPrimitives(primitivesRef.current);
      clearHazardShapes(viewer);
      if (viewer) for (const e of bboxEntitiesRef.current) viewer.entities.remove(e);
      bboxEntitiesRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, scenario, colorMode, clearPrimitives, clearAllStepPrims, showStep, hasTimeline, steps]);

  useEffect(() => {
    if (!hasTimeline || !playing) {
      if (tickIntervalRef.current) { clearInterval(tickIntervalRef.current); tickIntervalRef.current = null; }
      return;
    }
    const ms = Math.max(50, 500 / speed);
    tickIntervalRef.current = setInterval(() => {
      setCurrentStep(prev => {
        const next = prev + 1;
        if (next >= steps.length) { setPlaying(false); return prev; }
        return next;
      });
    }, ms);
    return () => { if (tickIntervalRef.current) clearInterval(tickIntervalRef.current); };
  }, [playing, speed, hasTimeline, steps.length]);

  useEffect(() => {
    if (hasTimeline) {
      ensureWindowCreated(currentStep);
      showStep(currentStep);
    }
  }, [currentStep, hasTimeline, showStep, ensureWindowCreated]);

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

  if (!scenario) {
    return (
      <div style={{ position: 'absolute', top: 60, right: 10, zIndex: 110, width: 420 }}>
        <Panel title="SCENARIO VIEWER" icon={<Eye size={14} />} accentColor="#3b82f6" iconColor="#60a5fa" titleColor="#93c5fd" onClose={onClose} style={{ maxHeight: 'calc(100vh - 92px)' }}>
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 11 }}>
            No scenario selected
          </div>
        </Panel>
      </div>
    );
  }

  const currentLabel = hasTimeline ? steps[currentStep]?.label : undefined;
  const currentFloodShapes = stepPrimsRef.current[currentStep]?.floodSurfaceShapes ?? [];
  const currentEarthquakeShapes = stepPrimsRef.current[currentStep]?.earthquakeShapes ?? [];
  const currentHurricaneShapes = stepPrimsRef.current[currentStep]?.hurricaneShapes ?? [];
  const hasWaterSurface = scenario.type === 'flood_inundation' || scenario.type === 'tsunami_wave';
  const isEarthquake = scenario.type === 'earthquake_swarm';
  const currentWildfireShapes = stepPrimsRef.current[currentStep]?.wildfireShapes ?? [];
  const isHurricane = scenario.type === 'hurricane_landfall';
  const isWildfire = scenario.type === 'wildfire_spread';
  const isVolcanic = scenario.type === 'volcanic_eruption';
  const currentVolcanicShapes = stepPrimsRef.current[currentStep]?.volcanicShapes ?? [];

  const progress = hasTimeline ? currentStep / Math.max(1, steps.length - 1) : 1;

  const headerExtra = onBack ? (
    <button onClick={onBack} style={{ fontSize: 10, padding: '2px 8px', background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 4, color: '#94a3b8', cursor: 'pointer' }}>← Back</button>
  ) : undefined;

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex: 110, width: 420 }}>
      <Panel title={scenario.name.toUpperCase()} icon={<Eye size={14} />} accentColor={SCENARIO_TYPE_COLORS[scenario.type] || '#3b82f6'} iconColor="#60a5fa" titleColor="#93c5fd" onClose={onClose} headerExtra={headerExtra} style={{ maxHeight: 'calc(100vh - 92px)' }}>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, overflowY: 'auto', flex: 1, minHeight: 0 }}>
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

        {showInfo && (
          <div className="scenario-info" style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 10 }}>
            <div className="info-row"><span className="info-key">Type</span><span className="info-val">{scenario.type.replace(/_/g, ' ')}</span></div>
            <div className="info-row"><span className="info-key">Score</span><span className="info-val">{(scenario.validationScore * 100).toFixed(0)}%</span></div>
            <div className="info-row"><span className="info-key">Severity</span><span className="info-val">{scenario.severity}</span></div>
            <div className="info-row"><span className="info-key">Location</span><span className="info-val">{scenario.location.lat.toFixed(2)}, {scenario.location.lon.toFixed(2)}</span></div>
            <div className="info-row"><span className="info-key">Points</span><span className="info-val">{scenario.pointCloud.length}</span></div>
            {hasTimeline && <div className="info-row"><span className="info-key">Steps</span><span className="info-val">{steps.length} ({duration.toFixed(0)}s total)</span></div>}
            {scenario.metadata?.variableName !== undefined && <div className="info-row"><span className="info-key">Variable</span><span className="info-val">{String(scenario.metadata.variableName)}</span></div>}
            {Array.isArray(scenario.metadata?.dataSources) && (
              <div className="info-row"><span className="info-key">Sources</span><span className="info-val" style={{ fontSize: 9 }}>{(scenario.metadata.dataSources as string[]).join(', ')}</span></div>
            )}
          </div>
        )}

        {compareMode && counterfactualScenario && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--text-dim)' }}>Counterfactual</div>
            <div className="info-row"><span className="info-key">Name</span><span className="info-val">{counterfactualScenario.name}</span></div>
            <div className="info-row"><span className="info-key">Score</span><span className="info-val">{(counterfactualScenario.validationScore * 100).toFixed(0)}%</span></div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button className="glass-button" style={{ fontSize: 10, flex: 1 }} onClick={() => exportScenario(scenario, 'geojson')}>GeoJSON</button>
          <button className="glass-button" style={{ fontSize: 10, flex: 1 }} onClick={() => exportScenario(scenario, 'czml')}>CZML</button>
          <button className="glass-button" style={{ fontSize: 10, flex: 1 }} onClick={() => exportScenario(scenario, 'netcdf')}>NetCDF</button>
        </div>
      </div>

      {hasTimeline && (
        <TimelineControls
          playing={playing}
          onTogglePlay={() => setPlaying(p => !p)}
          currentTime={currentStep * dt}
          duration={duration}
          speed={speed}
          onSpeedChange={setSpeed}
          label={currentLabel}
          stepCount={steps.length}
          currentStep={currentStep}
          onStepJump={setCurrentStep}
          isFloodScenario={hasWaterSurface}
          maxDepth={steps[currentStep]?.shapes.find(s => s.type === 'flood_surface')?.maxDepth ?? 0}
          currentProgress={progress}
        />
      )}

      {hasWaterSurface && currentFloodShapes.length > 0 && (
        <FloodWaterSurface viewer={viewer} shapes={currentFloodShapes} progress={progress} />
      )}

      {isEarthquake && currentEarthquakeShapes.length > 0 && (
        <EarthquakeVisualizer viewer={viewer} shapes={currentEarthquakeShapes} progress={progress} />
      )}

      {isHurricane && currentHurricaneShapes.length > 0 && (
        <HurricaneVisualizer viewer={viewer} shapes={currentHurricaneShapes} progress={progress} />
      )}

      {isWildfire && currentWildfireShapes.length > 0 && (
        <WildfireVisualizer viewer={viewer} shapes={currentWildfireShapes} progress={progress} />
      )}

      {isVolcanic && currentVolcanicShapes.length > 0 && (
        <VolcanicVisualizer viewer={viewer} shapes={currentVolcanicShapes} progress={progress} />
      )}
    </Panel>
    </div>
  );
}

function renderPointCloud(viewer: Cesium.Viewer, cloud: Point3D[], _center: { lat: number; lon: number }, colorMode: ColorMode, opacity: number, colorValues?: number[], valueMin?: number, valueMax?: number): Cesium.Primitive[] {
  const primitives: Cesium.Primitive[] = [];
  const batchSize = 10000;

  for (let batch = 0; batch < cloud.length; batch += batchSize) {
    const batchCloud = cloud.slice(batch, batch + batchSize);
    const geom = new Cesium.PointPrimitiveCollection({
      modelMatrix: Cesium.Matrix4.IDENTITY,
      blendOption: Cesium.BlendOption.OPAQUE, // 2x perf boost for opaque points
    });

    for (let i = 0; i < batchCloud.length; i++) {
      const p = batchCloud[i];
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      const lat = Math.asin(clamp(p.z / r, -1, 1)) * (180 / Math.PI);
      const lon = Math.atan2(p.y, p.x) * (180 / Math.PI);
      const height = (1 - r) * 10000000;

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
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
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
  if (h < 1 / 6) { r = c; g = x; }
  else if (h < 2 / 6) { r = x; g = c; }
  else if (h < 3 / 6) { g = c; b = x; }
  else if (h < 4 / 6) { g = x; b = c; }
  else if (h < 5 / 6) { r = x; b = c; }
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
