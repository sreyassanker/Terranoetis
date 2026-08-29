/**
 * Scenario Editor — parameter-driven control surface for Kaggle GPU runs.
 *
 * Responsibilities:
 *  - Render the parameter form for each scenario type
 *  - Apply physics form-derivations on slider input
 *  - Delegate the simulation lifecycle (submit/SSE/poll/cancel) to the hook
 *  - Surface server validation errors with zero fabricated data
 *
 * Architectural rule: NO hooks inside callbacks. All hook calls live at the
 * top level of the component body.
 */

import { Fragment, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import * as Cesium from 'cesium';
import type { Viewer } from 'cesium';
import { Sliders, CheckCircle, Loader2, Cpu, Download, ExternalLink, Image, X } from 'lucide-react';
import type { StudyAreaItem } from '@/rendering/studyArea';
import { computeStudyAreaBbox } from '@/rendering/studyArea';
import { SCENARIO_TYPE_LABELS } from './types';
import Panel from '@/components/ui/Panel';
import { useKaggleSimulation } from '@/hooks/useKaggleSimulation';
import { sampleStudyAreaTerrainAsync } from './studyAreaTerrain';
import {
  buildSimulationRequest,
  deriveCenter,
  deriveExtentKm,
  derivePhysicsFormOverrides,
  type SimulationRequest,
} from '@/services/kaggleSim';

// ── Form schema ──────────────────────────────────────────────────────────────

interface BaseParameterDef {
  key: string;
  label: string;
  defaultValue: number | string;
  unit: string;
}

interface SliderParameterDef extends BaseParameterDef {
  type?: 'slider';
  min: number;
  max: number;
  step: number;
}

interface SelectParameterDef extends BaseParameterDef {
  type: 'select';
  defaultValue: string;
  options: { value: string | number; label: string }[];
}

type ParameterDef = SliderParameterDef | SelectParameterDef;

const SCENARIO_PARAMS: Record<string, ParameterDef[]> = {
  earthquake_swarm: [
    { key: 'magnitudeMin', label: 'Min Magnitude (catalog context)', min: 1, max: 8, step: 0.1, defaultValue: 2.5, unit: 'M' },
    { key: 'magnitudeMax', label: 'Mag (Mainshock)', min: 3, max: 9.5, step: 0.1, defaultValue: 8, unit: 'M' },
    { key: 'depthMin', label: 'Min Depth (catalog context)', min: 0, max: 100, step: 1, defaultValue: 5, unit: 'km' },
    { key: 'depthMax', label: 'Depth (Mainshock)', min: 1, max: 300, step: 1, defaultValue: 30, unit: 'km' },
  ],
  hurricane_landfall: [
    { key: 'category', label: 'Saffir-Simpson Category', min: 1, max: 5, step: 1, defaultValue: 3, unit: '' },
    { key: 'forwardSpeed', label: 'Forward Speed', min: 5, max: 60, step: 1, defaultValue: 15, unit: 'km/h' },
    { key: 'pressure', label: 'Central Pressure', min: 880, max: 1010, step: 5, defaultValue: 950, unit: 'hPa' },
    { key: 'radius', label: 'Radius of Max Winds', min: 10, max: 200, step: 5, defaultValue: 50, unit: 'km' },
    { key: 'landfallTime', label: 'Hours to Landfall', min: 6, max: 96, step: 1, defaultValue: 24, unit: 'h' },
  ],
  wildfire_spread: [
    { key: 'windSpeed', label: 'Wind Speed', min: 0, max: 120, step: 1, defaultValue: 20, unit: 'km/h' },
    { key: 'windDir', label: 'Wind Direction', min: 0, max: 360, step: 5, defaultValue: 270, unit: '°' },
    { key: 'humidity', label: 'Relative Humidity', min: 1, max: 100, step: 1, defaultValue: 15, unit: '%' },
    { key: 'fuelType', label: 'Fuel Type', type: 'select', defaultValue: 'forest', unit: '', options: [
      { value: 'grass', label: 'Grassland (fast spread)' },
      { value: 'shrub', label: 'Shrub/Chaparral' },
      { value: 'forest', label: 'Forest (moderate spread)' },
      { value: 'urban', label: 'Urban Interface' },
    ]},
    { key: 'duration', label: 'Duration', min: 1, max: 168, step: 1, defaultValue: 72, unit: 'h' },
  ],
  volcanic_eruption: [
    { key: 'vei', label: 'Volcanic Explosivity Index', min: 0, max: 8, step: 1, defaultValue: 3, unit: '' },
    { key: 'windSpeed', label: 'Wind Speed', min: 0, max: 120, step: 1, defaultValue: 36, unit: 'km/h' },
    { key: 'windDir', label: 'Prevailing Wind Direction', min: 0, max: 360, step: 5, defaultValue: 260, unit: '°' },
    { key: 'duration', label: 'Duration', min: 1, max: 168, step: 1, defaultValue: 48, unit: 'h' },
    // ── Ash transport physics knobs (Stokes settling / eddy diffusion) ──
    { key: 'ashParticleDiameter', label: 'Ash Particle Diameter', min: 50, max: 2000, step: 10, defaultValue: 316, unit: 'µm' },
    { key: 'ashDiffusivity', label: 'Ash Cloud Diffusivity', min: 10, max: 5000, step: 10, defaultValue: 500, unit: 'm²/s' },
    { key: 'ashWindShear', label: 'Wind-Shear Factor', min: 0, max: 1, step: 0.05, defaultValue: 0.5, unit: '' },
  ],
  flood_inundation: [
    { key: 'rainfall', label: 'Total Rainfall', min: 50, max: 2000, step: 10, defaultValue: 500, unit: 'mm' },
    { key: 'catchmentArea', label: 'Catchment Area', min: 100, max: 20000, step: 100, defaultValue: 2000, unit: 'km²' },
    { key: 'soilSaturation', label: 'Soil Saturation', min: 0, max: 1, step: 0.05, defaultValue: 0.8, unit: '' },
    { key: 'duration', label: 'Duration', min: 1, max: 168, step: 1, defaultValue: 72, unit: 'h' },
    { key: 'windSpeed', label: 'Wind Speed (drives wave height)', min: 0, max: 100, step: 1, defaultValue: 40, unit: 'km/h' },
  ],
  tsunami_wave: [
    { key: 'magnitude', label: 'Earthquake Magnitude', min: 5, max: 9.5, step: 0.1, defaultValue: 8.5, unit: 'M' },
    { key: 'depth', label: 'Hypocenter Depth', min: 5, max: 100, step: 1, defaultValue: 20, unit: 'km' },
    { key: 'waveHeight', label: 'Max Wave Height', min: 1, max: 30, step: 0.5, defaultValue: 15, unit: 'm' },
  ],
  landslide: [
    { key: 'triggerType', label: 'Trigger Type', type: 'select', defaultValue: 'earthquake', unit: '', options: [
      { value: 'earthquake', label: 'Earthquake (PGA-triggered)' },
      { value: 'rainfall', label: 'Rainfall (saturation-triggered)' },
      { value: 'volcanic', label: 'Volcanic (lahar)' },
    ]},
    { key: 'magnitude', label: 'Earthquake Magnitude', min: 4, max: 9.5, step: 0.1, defaultValue: 6.5, unit: 'M' },
    { key: 'pgaThreshold', label: 'PGA Threshold', min: 0.05, max: 0.5, step: 0.05, defaultValue: 0.15, unit: 'g' },
    { key: 'rainfall', label: 'Total Rainfall', min: 50, max: 2000, step: 10, defaultValue: 200, unit: 'mm' },
    { key: 'frictionAngle', label: 'Friction Angle', min: 20, max: 50, step: 1, defaultValue: 35, unit: '°' },
    { key: 'cohesion', label: 'Cohesion', min: 0, max: 2000, step: 50, defaultValue: 500, unit: 'Pa' },
    { key: 'duration', label: 'Duration', min: 0.5, max: 48, step: 0.5, defaultValue: 2, unit: 'h' },
    // ── Voellmy friction law (calibration targets) ──
    { key: 'mu', label: 'Voellmy μ (dry friction)', min: 0.05, max: 0.5, step: 0.01, defaultValue: 0.25, unit: '' },
    { key: 'xi', label: 'Voellmy ξ (turbulent)', min: 50, max: 1500, step: 50, defaultValue: 300, unit: 'm/s²' },
    // ── Bed entrainment (0 = off) ──
    { key: 'entrainmentRate', label: 'Bed Entrainment Rate', min: 0, max: 0.01, step: 0.0005, defaultValue: 0, unit: '1/s' },
    { key: 'erodibleDepthM', label: 'Erodible Bed Depth', min: 0, max: 20, step: 0.5, defaultValue: 5, unit: 'm' },
    // ── Trigger thresholds ──
    { key: 'rainfallThreshold', label: 'Rain Trigger Threshold', min: 50, max: 600, step: 10, defaultValue: 150, unit: 'mm' },
  ],
};

function defaultsFor(type: string): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const def of SCENARIO_PARAMS[type] ?? []) out[def.key] = def.defaultValue;
  return derivePhysicsFormOverrides(type, out);
}

/**
 * Primary final raster exported as GeoTIFF for each simulation type. These
 * names match the grids each kernel writes (see kaggle-kernels/*-sim/main.py).
 */
const SIM_TYPE_TO_FINAL_GRID: Record<string, string> = {
  flood_inundation: 'water_depth_final',
  wildfire_spread: 'fire_intensity',
  earthquake_swarm: 'mmi',
  tsunami_wave: 'water_height',
  hurricane_landfall: 'surge_height',
  volcanic_eruption: 'ash_deposit',
  landslide: 'landslide_depth',
};

/**
 * Progress phases the Kaggle run lifecycle transitions through, in order.
 * Used to drive an honest progress bar from the *status stream position*
 * instead of hardcoded pseudo-percentages.
 */
const RUN_PHASES = [
  'queued',
  'submitting',
  'running',
  'postprocessing',
  'downloading',
  'complete',
] as const;

function phaseProgress(status: string | undefined): number {
  if (!status) return 0.05;
  const idx = (RUN_PHASES as readonly string[]).indexOf(status);
  if (idx === -1) return 0.05; // unknown status: tiny sliver, never a lie
  return (idx + 1) / RUN_PHASES.length;
}

// ── Component ────────────────────────────────────────────────────────────────

interface ScenarioEditorProps {
  onClose: () => void;
  onKaggleComplete?: (jobId: string, lat: number, lon: number, scenarioType: string) => void;
  onKaggleStart?: () => void;
  studyAreas: StudyAreaItem[];
  activeStudyAreaId: string | null;
  /** Cesium viewer (for sampling real terrain on landslide runs). */
  viewer?: Viewer | null;
  zIndex?: number;
}

export default function ScenarioEditor({
  onClose,
  onKaggleComplete,
  onKaggleStart,
  studyAreas,
  activeStudyAreaId,
  viewer,
  zIndex = 110,
}: ScenarioEditorProps) {
  const [scenarioType, setScenarioType] = useState('earthquake_swarm');
  const [params, setParams] = useState<Record<string, number | string>>(() =>
    defaultsFor('earthquake_swarm'),
  );
  // Snapshot of the scenario type actually submitted — used for downloads so
  // switching the dropdown mid-run doesn't fetch the wrong raster for the old job.
  const [runScenarioType, setRunScenarioType] = useState<string | null>(null);

  // Manual vent/origin point — only used for the volcanic scenario. Placed on
  // the real terrain surface (0 m ellipsoid, CLAMP_TO_GROUND).
  const [ventPoint, setVentPoint] = useState<{ lat: number; lon: number } | null>(null);
  const ventHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const ventMarkerRef = useRef<Cesium.Entity | null>(null);

  // Derived geometry for the active study area (memoised on identity, not on
  // every render — cheap defence against accidental recompute).
  const activeStudyArea: StudyAreaItem | undefined = useMemo(
    () => studyAreas.find((a) => a.id === activeStudyAreaId),
    [studyAreas, activeStudyAreaId],
  );
  const activeBbox = useMemo(
    () => (activeStudyArea ? computeStudyAreaBbox(activeStudyArea) : null),
    [activeStudyArea],
  );

  const kaggle = useKaggleSimulation({
    onComplete: (jobId, lat, lon, type) => onKaggleComplete?.(jobId, lat, lon, type),
    onStart: () => onKaggleStart?.(),
  });

  // Handlers — top-level hooks only, called from event handlers (not JSX).
  const updateParam = useCallback(
    (key: string, value: number | string) => {
      setParams((prev) =>
        derivePhysicsFormOverrides(scenarioType, { ...prev, [key]: value }),
      );
    },
    [scenarioType],
  );

  const switchScenarioType = useCallback((type: string) => {
    setScenarioType(type);
    setParams(defaultsFor(type));
  }, []);

  /** Remove only the vent marker entity — keeps the drawn bbox on the globe. */
  const clearVentMarker = useCallback(() => {
    if (!viewer) return;
    if (ventMarkerRef.current) {
      viewer.entities.remove(ventMarkerRef.current);
      ventMarkerRef.current = null;
    }
  }, [viewer]);

  /** Let the user click an exact vent/ignition point inside the study area. */
  const pickVentPoint = useCallback(() => {
    if (!viewer || !activeBbox) return;
    clearVentMarker();
    setVentPoint(null);
    if (ventHandlerRef.current && !ventHandlerRef.current.isDestroyed()) {
      ventHandlerRef.current.destroy();
    }
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    ventHandlerRef.current = handler;
    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      // Pick the EXACT terrain surface (not the ellipsoid) so the vent point
      // lands precisely where the user clicks, not shifted by terrain elevation.
      const ray = viewer.camera.getPickRay(click.position);
      if (!ray) return;
      const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
      if (cartesian) {
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        const pt = {
          lat: Cesium.Math.toDegrees(cartographic.latitude),
          lon: Cesium.Math.toDegrees(cartographic.longitude),
        };
        setVentPoint(pt);
        drawVentMarker(viewer, pt, ventMarkerRef);
      }
      if (!handler.isDestroyed()) handler.destroy();
      ventHandlerRef.current = null;
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }, [viewer, activeBbox, clearVentMarker]);

  // Clean up the vent picker handler + marker on unmount or study-area change.
  useEffect(() => {
    return () => {
      if (ventHandlerRef.current && !ventHandlerRef.current.isDestroyed()) {
        ventHandlerRef.current.destroy();
      }
      ventHandlerRef.current = null;
      clearVentMarker();
    };
  }, [clearVentMarker, activeBbox]);

  // Sampling a 256×256 real-terrain grid is async (yields to the event loop so
  // the browser stays responsive) — the button shows progress while preparing.
  const [preparing, setPreparing] = useState(false);

  const handleRun = useCallback(async () => {
    if (!activeBbox) return;
    setRunScenarioType(scenarioType);
    setPreparing(true);
    try {
      const base = buildSimulationRequest(
        { scenarioType, params, gridSize: 256 },
        activeBbox,
        scenarioType === 'volcanic_eruption' ? ventPoint : null,
      );
      // Landslide + flood + volcano: if the Cesium globe has real elevation for
      // the drawn box, sample it at full resolution (256×256 — no bilinear
      // loss, the kernel's simulation grid) and ship it so the kernel runs on
      // real terrain instead of the synthetic ridge/cone. No real relief →
      // keep synthetic.
      let request: SimulationRequest = base;
      if (
        (base.type === 'landslide' || base.type === 'flood_inundation' || base.type === 'volcanic_eruption') &&
        viewer
      ) {
        const real = await sampleStudyAreaTerrainAsync(viewer, activeBbox, 256);
        if (real) {
          request = { ...base, terrain: real.values, terrain_gs: real.gs };
        }
      }
      await kaggle.run(() => request, scenarioType);
    } finally {
      setPreparing(false);
    }
  }, [activeBbox, scenarioType, params, viewer, kaggle, ventPoint]);

  // ── Voellmy calibration (fit μ/ξ to an observed runout) ──
  const [calibInput, setCalibInput] = useState('2.9');
  const [calibrating, setCalibrating] = useState(false);
  const [calibError, setCalibError] = useState<string | null>(null);
  const [calibBest, setCalibBest] = useState<{
    mu: number; xi: number; runout_km: number; err: number;
  } | null>(null);

  const handleCalibrate = useCallback(async () => {
    if (!activeBbox) return;
    const observed = Number(calibInput);
    if (!Number.isFinite(observed) || observed <= 0) {
      setCalibError('Enter a positive observed runout (km).');
      return;
    }
    setCalibrating(true);
    setCalibError(null);
    setCalibBest(null);
    try {
      const base = buildSimulationRequest(
        { scenarioType, params, gridSize: 256 },
        activeBbox,
      );
      const resp = await fetch('/api/kaggle/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: base, observed_runout_km: observed }),
      });
      const data = (await resp.json()) as {
        best?: { mu: number; xi: number; runout_km: number; err: number };
        error?: string;
      };
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      setCalibBest(data.best ?? null);
    } catch (err) {
      setCalibError(err instanceof Error ? err.message : String(err));
    } finally {
      setCalibrating(false);
    }
  }, [activeBbox, scenarioType, params, calibInput]);

  /** Apply the calibrated μ/ξ pair back to the form so a run uses it. */
  const applyCalibration = useCallback(() => {
    if (!calibBest) return;
    setParams((prev) => derivePhysicsFormOverrides('landslide', {
      ...prev,
      mu: Number(calibBest.mu.toFixed(3)),
      xi: Math.round(calibBest.xi),
    }));
  }, [calibBest]);

  // ── Monte-Carlo uncertainty quantification (exceedance ensemble) ──
  const [uqRunning, setUqRunning] = useState(false);
  const [uqError, setUqError] = useState<string | null>(null);
  const [uqSummary, setUqSummary] = useState<{
    n: number; p50_runout_km: number; p95_runout_km: number;
    mean_max_depth_m: number; p95_max_depth_m: number; area_exceeded_pct: number;
  } | null>(null);

  const handleQuantify = useCallback(async () => {
    if (!activeBbox) return;
    setUqRunning(true);
    setUqError(null);
    setUqSummary(null);
    try {
      const base = buildSimulationRequest(
        { scenarioType, params, gridSize: 256 },
        activeBbox,
      );
      const resp = await fetch('/api/kaggle/landslide/quantify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: base, samples: 16, exceedance_depth_m: 0.5 }),
      });
      const data = (await resp.json()) as {
        summary?: typeof uqSummary;
        error?: string;
      };
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      setUqSummary(data.summary ?? null);
    } catch (err) {
      setUqError(err instanceof Error ? err.message : String(err));
    } finally {
      setUqRunning(false);
    }
  }, [activeBbox, scenarioType, params]);

  /** Download the type's primary raster as a georeferenced GeoTIFF. */
  const handleDownloadTiff = useCallback(() => {
    if (!kaggle.jobId || !activeBbox) return;
    const runType = runScenarioType ?? scenarioType;
    const grid = SIM_TYPE_TO_FINAL_GRID[runType];
    // Guard: never silently fetch a mismatched/flood raster for an unmapped type.
    if (!grid) {
      console.error(`No final-grid mapping for scenario type "${runType}"`);
      return;
    }
    // Query overrides are only used when the kernel didn't embed georeferencing.
    const { lat, lon } = deriveCenter(activeBbox);
    const extentKm = deriveExtentKm(activeBbox);
    const q = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      extent_km: String(extentKm),
    });
    const a = document.createElement('a');
    a.href = `/api/kaggle/simulate/${kaggle.jobId}/geotiff/${grid}?${q}`;
    a.download = `${grid}.tif`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [kaggle.jobId, scenarioType, runScenarioType, activeBbox]);

  // ── Presentation ──────────────────────────────────────────────────────────

  const formDisabled = kaggle.isRunning;
  const canRun = Boolean(activeBbox) && !kaggle.isRunning && !preparing;
  const currentParams = SCENARIO_PARAMS[scenarioType] ?? [];

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex, width: 440 }}>
      <Panel
        title="SCENARIO EDITOR"
        icon={<Sliders size={14} />}
        accentColor="#8b5cf6"
        iconColor="#a78bfa"
        titleColor="#c4b5fd"
        onClose={onClose}
        style={{ maxHeight: 'calc(100vh - 92px)' }}
      >

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, overflowY: 'auto', maxHeight: 'calc(100vh - 140px)' }}>
        {/* Active Study Area */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4, fontWeight: 600 }}>Study Area</div>
          {!activeStudyArea ? (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic', padding: '4px 0' }}>Draw and activate a study area first</div>
          ) : !activeBbox ? (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic', padding: '4px 0' }}>Invalid study area geometry</div>
          ) : (
            <div style={{ fontSize: 10, background: 'rgba(34,197,94,0.1)', borderRadius: 6, padding: '6px 8px', color: 'var(--text-dim)', border: '1px solid rgba(34,197,94,0.2)' }}>
              <div style={{ fontWeight: 600, color: '#22c55e', marginBottom: 4 }}>{activeStudyArea.name}</div>
              <div>Lat: {activeBbox.latMin.toFixed(2)}° → {activeBbox.latMax.toFixed(2)}°</div>
              <div>Lon: {activeBbox.lonMin.toFixed(2)}° → {activeBbox.lonMax.toFixed(2)}°</div>
            </div>
          )}
        </div>

        {/* Manual Vent / Origin Point — volcano only */}
        {activeBbox && scenarioType === 'volcanic_eruption' && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>
              {ventPoint ? 'Vent / Origin Point' : 'Pinpoint the exact location'}
            </div>
            {ventPoint ? (
              <div className="scenario-info" style={{ background: 'rgba(234,88,12,0.12)', borderRadius: 8, padding: 8 }}>
                <div className="info-row"><span className="info-key">Lat</span><span className="info-val">{ventPoint.lat.toFixed(4)}°</span></div>
                <div className="info-row"><span className="info-key">Lon</span><span className="info-val">{ventPoint.lon.toFixed(4)}°</span></div>
              </div>
            ) : (
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6 }}>
                Defaults to the study-area centroid. Click a precise point on the terrain for better accuracy.
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="glass-button" style={{ fontSize: 10, flex: 1 }}
                onClick={pickVentPoint} disabled={formDisabled}>
                {ventPoint ? '↻ Re-pick Point' : '📍 Set Point on Globe'}
              </button>
              {ventPoint && (
                <button className="glass-button" style={{ fontSize: 10 }}
                  onClick={() => {
                    setVentPoint(null);
                    clearVentMarker();
                  }}>
                  ✕ Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Scenario Type */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>Scenario Type</div>          <select
            className="token-input"
            value={scenarioType}
            onChange={(e) => switchScenarioType(e.target.value)}
            disabled={formDisabled}
            style={{ width: '100%', fontSize: 11 }}
          >
            {Object.keys(SCENARIO_PARAMS).map((t) => (
              <option key={t} value={t}>{SCENARIO_TYPE_LABELS[t] || t.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        {/* Scenario-Specific Parameters (physics-integrated) */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>Parameters — {SCENARIO_TYPE_LABELS[scenarioType]}</div>
          {currentParams.map((param) => {
            const inputId = `se-param-${param.key}`;
            return (
            <div key={param.key} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', marginBottom: 2 }}>
                <label htmlFor={param.type === 'select' ? undefined : inputId} style={{ cursor: 'default' }}>{param.label}</label>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{String(params[param.key] ?? param.defaultValue)}{param.unit}</span>
              </div>
              {param.type === 'select' ? (
                <select
                  className="token-input"
                  aria-label={param.label}
                  value={String(params[param.key] ?? param.defaultValue)}
                  onChange={(e) => updateParam(param.key, e.target.value)}
                  disabled={formDisabled}
                  style={{ width: '100%', fontSize: 10, padding: '3px 6px' }}
                >
                  {param.options?.map((opt) => (
                    <option key={String(opt.value)} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={inputId}
                  type="range"
                  aria-label={param.label}
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={Number(params[param.key] ?? param.defaultValue)}
                  onChange={(e) => updateParam(param.key, Number(e.target.value))}
                  disabled={formDisabled}
                  style={{ width: '100%', height: 3, accentColor: '#60a5fa' }}
                />
              )}
            </div>
          );
          })}
        </div>

        {/* Landslide: Voellmy calibration (fit μ/ξ to an observed runout) */}
        {scenarioType === 'landslide' && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>
              Calibrate μ/ξ to an observed event
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.4 }}>
              Grid-searches the Voellmy parameters so the modelled runout matches
              a documented slide distance. Runs a fast local ensemble (GPU not needed).
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                className="token-input"
                aria-label="Observed runout (km)"
                type="number"
                min={0.1}
                step={0.1}
                value={calibInput}
                onChange={(e) => setCalibInput(e.target.value)}
                disabled={calibrating || formDisabled}
                style={{ width: 90, fontSize: 11, padding: '5px 6px' }}
              />
              <button
                className="glass-button"
                style={{
                  flex: 1, fontSize: 11, padding: '5px 8px', cursor: calibrating ? 'wait' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
                onClick={() => void handleCalibrate()}
                disabled={calibrating || formDisabled}
              >
                {calibrating ? <Loader2 size={12} className="animate-spin" /> : <Sliders size={12} />}
                {calibrating ? 'Calibrating…' : 'Calibrate μ/ξ'}
              </button>
            </div>
            {calibError && (
              <div style={{ fontSize: 9, color: '#ef4444', marginTop: 6 }}>{calibError}</div>
            )}
            {calibBest && (
              <div style={{ fontSize: 10, background: 'rgba(34,197,94,0.1)', borderRadius: 6, padding: '6px 8px', border: '1px solid rgba(34,197,94,0.2)', marginTop: 6 }}>
                <div>Best fit: μ = {calibBest.mu.toFixed(3)}, ξ = {Math.round(calibBest.xi)} m/s²</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 9, marginTop: 2 }}>
                  simulated runout {calibBest.runout_km.toFixed(2)} km (err {calibBest.err.toFixed(2)} km)
                </div>
                <button
                  className="glass-button"
                  style={{ fontSize: 9, padding: '4px 8px', marginTop: 6, cursor: 'pointer' }}
                  onClick={applyCalibration}
                >
                  Apply μ/ξ to scenario
                </button>
              </div>
            )}
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 10, marginBottom: 6, fontWeight: 600 }}>
              Uncertainty quantification
            </div>
            <button
              className="glass-button"
              style={{
                width: '100%', fontSize: 11, padding: '5px 8px', cursor: uqRunning ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
              onClick={() => void handleQuantify()}
              disabled={uqRunning || formDisabled}
            >
              {uqRunning ? <Loader2 size={12} className="animate-spin" /> : <Cpu size={12} />}
              {uqRunning ? 'Running 16-sample ensemble…' : 'Run Monte-Carlo UQ (16 samples)'}
            </button>
            {uqError && (
              <div style={{ fontSize: 9, color: '#ef4444', marginTop: 6 }}>{uqError}</div>
            )}
            {uqSummary && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                {uqSummary.n}-sample ensemble over uncertain μ/ξ/cohesion/magnitude:
                P50 runout {uqSummary.p50_runout_km.toFixed(2)} km, P95 {uqSummary.p95_runout_km.toFixed(2)} km,
                mean max depth {uqSummary.mean_max_depth_m.toFixed(1)} m (P95 {uqSummary.p95_max_depth_m.toFixed(1)} m),
                {` area exceeded (${'>'}0.5 m) ${(uqSummary.area_exceeded_pct * 100).toFixed(1)}%`}.
              </div>
            )}
          </div>
        )}

        {/* Generate / Cancel controls */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Cpu size={11} /> Generate Scenario
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
            Run a full-physics simulation on Kaggle's free GPU. Results stream back in real-time.
          </div>
          <button
            className="glass-button"
            style={{
              fontSize: 11, padding: '10px 16px', width: '100%',
              background: kaggle.isRunning
                ? 'linear-gradient(135deg,rgba(251,191,36,0.3),rgba(245,158,11,0.3))'
                : !canRun
                  ? 'rgba(128,128,128,0.2)'
                  : 'linear-gradient(135deg,rgba(251,146,60,0.3),rgba(239,68,68,0.3))',
              border: kaggle.isRunning
                ? '1px solid rgba(251,191,36,0.5)'
                : !canRun
                  ? '1px solid rgba(128,128,128,0.3)'
                  : '1px solid rgba(251,146,60,0.5)',
              fontWeight: 700, cursor: !canRun ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            onClick={handleRun}
            disabled={!canRun}
          >
            {kaggle.isRunning ? <Loader2 size={12} className="animate-spin" /> : preparing ? <Loader2 size={12} className="animate-spin" /> : <Cpu size={12} />}
            {kaggle.isRunning
              ? `Generating… ${kaggle.progress?.status ?? ''}`
              : preparing
                ? 'Sampling terrain…'
                : 'Generate Scenario'}
          </button>

          {kaggle.isRunning && (
            <button
              className="glass-button"
              style={{
                fontSize: 11, padding: '8px 16px', width: '100%', marginTop: 6,
                background: 'rgba(239,68,68,0.2)',
                border: '1px solid rgba(239,68,68,0.5)',
                fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
              onClick={() => void kaggle.cancel()}
            >
              <X size={12} /> Cancel Kaggle Run
            </button>
          )}

          {/* Progress */}
          {kaggle.progress && kaggle.isRunning && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', background: 'rgba(251,146,60,0.1)', borderRadius: 6, padding: '6px 8px', border: '1px solid rgba(251,146,60,0.2)', marginTop: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{kaggle.progress.status.toUpperCase()}</span>
                {kaggle.jobId && <span style={{ opacity: 0.6, fontSize: 9 }}>{kaggle.jobId.slice(0, 16)}</span>}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>{kaggle.progress.detail}</div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(phaseProgress(kaggle.progress?.status) * 100)}
                  style={{
                    height: '100%',
                    width: `${Math.round(phaseProgress(kaggle.progress?.status) * 100)}%`,
                    background: 'linear-gradient(90deg, #fb923c, #ef4444)',
                    borderRadius: 2, transition: 'width 1s ease',
                  }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {kaggle.error && (
            <div style={{ fontSize: 10, color: '#ef4444', background: 'rgba(239,68,68,0.1)', borderRadius: 6, padding: '6px 8px', border: '1px solid rgba(239,68,68,0.2)', marginTop: 6 }}>
              {kaggle.error}
            </div>
          )}

          {/* Results */}
          {kaggle.result && kaggle.state === 'complete' && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', background: 'rgba(34,197,94,0.1)', borderRadius: 6, padding: '8px', border: '1px solid rgba(34,197,94,0.2)', marginTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, fontWeight: 600, color: '#22c55e' }}>
                <CheckCircle size={12} /> Simulation Complete
              </div>
              {kaggle.result.final_stats as Record<string, unknown> | undefined ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', fontSize: 9 }}>
                  {Object.entries(kaggle.result.final_stats as Record<string, unknown>).map(([k, v]) => (
                    <Fragment key={k}>
                      <span style={{ opacity: 0.7 }}>{k.replace(/_/g, ' ')}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {typeof v === 'number'
                          ? v < 1000 ? v.toFixed(2) : v.toLocaleString()
                          : String(v)}
                      </span>
                    </Fragment>
                  ))}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <button
                  className="glass-button"
                  style={{ fontSize: 9, flex: 1, padding: '4px 8px' }}
                  onClick={() => kaggle.jobId && window.open(`/api/kaggle/simulate/${kaggle.jobId}/results`, '_blank')}
                >
                  <Download size={10} style={{ marginRight: 3 }} />JSON
                </button>
                <button
                  className="glass-button"
                  style={{ fontSize: 9, flex: 1, padding: '4px 8px' }}
                  onClick={handleDownloadTiff}
                  title="Download primary raster as GeoTIFF"
                >
                  <Image size={10} style={{ marginRight: 3 }} />TIF
                </button>
                <button
                  className="glass-button"
                  style={{ fontSize: 9, flex: 1, padding: '4px 8px' }}
                  onClick={() => window.open('/api/kaggle/kernels', '_blank')}
                >
                  <ExternalLink size={10} style={{ marginRight: 3 }} />Kernels
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Panel>
    </div>
  );
}

/** Orange VENT marker pinned to the real terrain surface (0 m, CLAMP_TO_GROUND). */
function drawVentMarker(
  viewer: Viewer,
  pt: { lat: number; lon: number },
  markerRef: { current: Cesium.Entity | null },
): void {
  if (markerRef.current) {
    viewer.entities.remove(markerRef.current);
    markerRef.current = null;
  }
  markerRef.current = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 0),
    point: {
      pixelSize: 12,
      color: Cesium.Color.fromCssColorString('#f97316'),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
    label: {
      text: 'VENT',
      font: '10px monospace',
      fillColor: Cesium.Color.fromCssColorString('#f97316'),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -16),
      scale: 0.85,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });
}
