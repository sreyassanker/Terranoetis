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

import { Fragment, useCallback, useMemo, useState } from 'react';
import type { Viewer } from 'cesium';
import { Sliders, CheckCircle, Loader2, Cpu, Download, ExternalLink, Image, X } from 'lucide-react';
import type { StudyAreaItem } from '@/rendering/studyArea';
import { computeStudyAreaBbox } from '@/rendering/studyArea';
import { SCENARIO_TYPE_LABELS } from './types';
import Panel from '@/components/ui/Panel';
import { useKaggleSimulation } from '@/hooks/useKaggleSimulation';
import { sampleStudyAreaTerrain } from './studyAreaTerrain';
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
    { key: 'vei', label: 'Volcanic Explosivity Index', min: 0, max: 6, step: 1, defaultValue: 3, unit: '' },
    { key: 'windDir', label: 'Prevailing Wind Direction', min: 0, max: 360, step: 5, defaultValue: 260, unit: '°' },
    { key: 'duration', label: 'Duration', min: 1, max: 168, step: 1, defaultValue: 48, unit: 'h' },
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

  const buildRequest = useCallback<() => SimulationRequest>(() => {
    if (!activeBbox) {
      throw new Error('Draw and activate a study area before generating.');
    }
    const base = buildSimulationRequest(
      { scenarioType, params, gridSize: 256 },
      activeBbox,
    );
    // Landslide only: if the Cesium globe has real elevation for the drawn
    // box, sample it and ship it so the kernel runs on real terrain instead of
    // the synthetic ridge. No real relief → keep synthetic (never zero/flat).
    if (base.type === 'landslide' && viewer) {
      const real = sampleStudyAreaTerrain(viewer, activeBbox);
      if (real) {
        return { ...base, terrain: real.values, terrain_gs: real.gs };
      }
    }
    return base;
  }, [activeBbox, scenarioType, params, viewer]);

  const handleRun = useCallback(() => {
    setRunScenarioType(scenarioType);
    void kaggle.run(buildRequest, scenarioType);
  }, [kaggle, buildRequest, scenarioType]);

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
  const canRun = Boolean(activeBbox) && !kaggle.isRunning;
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

        {/* Scenario Type */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>Scenario Type</div>
          <select
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
            {kaggle.isRunning ? <Loader2 size={12} className="animate-spin" /> : <Cpu size={12} />}
            {kaggle.isRunning ? `Generating… ${kaggle.progress?.status ?? ''}` : 'Generate Scenario'}
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
