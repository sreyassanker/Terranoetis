import { useState, useCallback, useRef, useEffect } from 'react';
import { Sliders, CheckCircle, Loader2, Cpu, Download, ExternalLink } from 'lucide-react';
import type { StudyAreaItem } from '@/rendering/studyArea';
import { computeStudyAreaBbox } from '@/rendering/studyArea';
import { SCENARIO_TYPE_LABELS } from './types';
import Panel from '@/components/ui/Panel';

interface ParameterDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number | string;
  unit: string;
  type?: 'slider' | 'select';
  options?: { value: string | number; label: string }[];
}

const SCENARIO_PARAMS: Record<string, ParameterDef[]> = {
  earthquake_swarm: [
    { key: 'magnitudeMin', label: 'Min Magnitude', min: 1, max: 8, step: 0.1, defaultValue: 2.5, unit: 'M' },
    { key: 'magnitudeMax', label: 'Max Magnitude (Mainshock)', min: 3, max: 9.5, step: 0.1, defaultValue: 8, unit: 'M' },
    { key: 'depthMin', label: 'Min Depth', min: 0, max: 100, step: 1, defaultValue: 5, unit: 'km' },
    { key: 'depthMax', label: 'Max Depth', min: 1, max: 300, step: 1, defaultValue: 30, unit: 'km' },
    { key: 'numEvents', label: 'Number of Events', min: 1, max: 200, step: 1, defaultValue: 50, unit: '' },
    { key: 'timeWindow', label: 'Time Window', min: 1, max: 720, step: 1, defaultValue: 168, unit: 'h' },
    { key: 'decayModel', label: 'Decay Model', type: 'select', defaultValue: 'omori', unit: '', min: 0, max: 0, step: 1, options: [
      { value: 'omori', label: "Omori's Law (realistic)" },
      { value: 'exponential', label: 'Exponential Decay' },
      { value: 'uniform', label: 'Uniform Distribution' },
    ]},
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
    { key: 'fuelType', label: 'Fuel Type', type: 'select', defaultValue: 'forest', unit: '', min: 0, max: 0, step: 1, options: [
      { value: 'grass', label: 'Grassland (fast spread)' },
      { value: 'shrub', label: 'Shrub/Chaparral' },
      { value: 'forest', label: 'Forest (moderate spread)' },
      { value: 'urban', label: 'Urban Interface' },
    ]},
    { key: 'area', label: 'Initial Area', min: 100, max: 50000, step: 100, defaultValue: 10000, unit: 'ha' },
    { key: 'duration', label: 'Duration', min: 1, max: 168, step: 1, defaultValue: 72, unit: 'h' },
  ],
  volcanic_eruption: [
    { key: 'vei', label: 'Volcanic Explosivity Index', min: 0, max: 6, step: 1, defaultValue: 3, unit: '' },
    { key: 'ashHeight', label: 'Ash Column Height (0=auto)', min: 0, max: 40000, step: 500, defaultValue: 0, unit: 'm' },
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
    { key: 'triggerType', label: 'Trigger Type', type: 'select', defaultValue: 'earthquake', unit: '', min: 0, max: 0, step: 1, options: [
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

// ── Physics-integrated parameter derivation ──────────────────────
// When the primary parameter changes, related parameters are auto-updated
// based on physical relationships. This ensures the simulation parameters
// are physically consistent.
function derivePhysicsParams(type: string, params: Record<string, number | string>): Record<string, number | string> {
  const p = { ...params };

  switch (type) {
    case 'earthquake_swarm': {
      const mag = Number(p.magnitudeMax) || 6.5;
      // Depth scales with magnitude (larger quakes rupture deeper)
      p.depthMax = Math.max(5, Math.min(50, mag * 5));
      p.depthMin = Math.max(1, mag * 2);
      // PGA threshold decreases with magnitude (larger quakes trigger at lower PGA)
      p.pgaThreshold = Math.max(0.05, 0.3 - mag * 0.03);
      // Affected area scales with M^1.5
      p.affectedArea = Math.round(Math.pow(mag, 1.5) * 100);
      break;
    }
    case 'hurricane_landfall': {
      const cat = Number(p.category) || 3;
      // Saffir-Simpson: wind speed from category
      const windSpeeds = { 1: 43, 2: 50, 3: 58, 4: 70, 5: 90 };
      p.windSpeed = windSpeeds[cat as 1 | 2 | 3 | 4 | 5] || 58;
      // Central pressure decreases with category
      p.pressure = Math.round(1010 - cat * 20);
      // Radius of max winds increases with category
      p.radius = Math.max(20, 30 + cat * 15);
      // Storm surge scales with wind speed squared
      p.stormSurge = Math.round((p.windSpeed as number) ** 2 / 100);
      break;
    }
    case 'volcanic_eruption': {
      const vei = Number(p.vei) || 3;
      // Column height: ~10^VEI meters (empirical)
      const colHeights = { 0: 100, 1: 1000, 2: 5000, 3: 10000, 4: 25000, 5: 40000, 6: 60000 };
      p.ashHeight = colHeights[vei as 0 | 1 | 2 | 3 | 4 | 5 | 6] || 10000;
      // Lava volume scales with 10^VEI
      p.lavaVolume = Math.pow(10, vei + 4);
      // Ash volume scales with 10^(VEI+3)
      p.ashVolume = Math.pow(10, vei + 3);
      // Duration increases with VEI
      p.duration = Math.max(1, vei * 8);
      break;
    }
    case 'landslide': {
      const mag = Number(p.magnitude) || 6.5;
      const trigger = p.triggerType || 'earthquake';
      // Friction angle decreases with earthquake magnitude (more violent shaking = lower effective friction)
      p.frictionAngle = Math.max(25, 40 - mag * 1.5);
      // Cohesion decreases with magnitude
      p.cohesion = Math.max(100, 800 - mag * 50);
      // Runout distance scales with magnitude and inverse friction
      p.runoutDistance = Math.round(mag * 5 / Math.max(0.1, (p.frictionAngle as number) / 35));
      // PGA threshold decreases with magnitude
      p.pgaThreshold = Math.max(0.05, 0.3 - mag * 0.03);
      // Rainfall threshold for rain-triggered landslides
      if (trigger === 'rainfall') {
        p.rainfallThreshold = Math.max(50, 300 - mag * 20);
      }
      break;
    }
    case 'flood_inundation': {
      const rainfall = Number(p.rainfall) || 500;
      const area = Number(p.catchmentArea) || 2000;
      // Runoff scales with rainfall (SCS-CN method)
      const cn = p.soilSaturation ? 80 + (p.soilSaturation as number) * 15 : 85;
      const S = 1000 / cn - 10;
      const P = rainfall / 25.4; // convert mm to inches
      const runoff = P > 0.2 * S ? Math.pow(P - 0.2 * S, 2) / (P + 0.8 * S) : 0;
      p.runoffDepth = Math.round(runoff * 25.4); // convert back to mm
      // Duration scales with rainfall and catchment area
      p.duration = Math.max(1, Math.round(rainfall / 50 + area / 500));
      // Flood extent scales with runoff × catchment area
      p.floodExtent = Math.round(p.runoffDepth as number * area / 1000);
      break;
    }
    case 'wildfire_spread': {
      const wind = Number(p.windSpeed) || 20;
      const humidity = Number(p.humidity) || 15;
      const fuelType = p.fuelType || 'forest';
      // Fuel load by type
      const fuelLoads = { grass: 5, shrub: 15, forest: 30, urban: 2 };
      p.fuelLoad = fuelLoads[fuelType as 'grass' | 'shrub' | 'forest' | 'urban'] || 30;
      // Spread rate scales with wind (Rothermel model)
      p.spreadRate = Math.round(wind * 0.5 * (p.fuelLoad as number) / 10);
      // Fire intensity scales with spread rate × fuel load
      p.fireIntensity = Math.round(p.spreadRate as number * (p.fuelLoad as number) * 100);
      // Area burned scales with spread rate × duration
      p.areaBurned = Math.round(p.spreadRate as number * (Number(p.duration) || 72) * 10);
      // Humidity inversely affects spread
      p.effectiveHumidity = Math.max(0, humidity - wind * 0.3);
      break;
    }
    case 'tsunami_wave': {
      const mag = Number(p.magnitude) || 8.5;
      // Seafloor displacement scales with magnitude
      p.seafloorDisplacement = Math.round(Math.pow(10, mag - 6) * 5);
      // Wave height scales with sqrt(displacement × depth)
      const depth = Number(p.depth) || 20;
      p.waveHeight = Math.round(Math.sqrt(p.seafloorDisplacement as number * depth) * 0.5);
      // Runup distance scales with wave height × sqrt(slope)
      p.runupDistance = Math.round((p.waveHeight as number) * 5);
      // Arrival time scales with distance / wave speed (√(g×depth))
      const waveSpeed = Math.sqrt(9.81 * depth * 1000);
      p.arrivalTime = Math.round(100000 / waveSpeed / 60); // minutes for 100km
      break;
    }
  }

  return p;
}

interface ScenarioEditorProps {
  onClose: () => void;
  onKaggleComplete?: (jobId: string, lat: number, lon: number, scenarioType: string) => void;
  onKaggleStart?: () => void;
  studyAreas: StudyAreaItem[];
  activeStudyAreaId: string | null;
  zIndex?: number;
}

export default function ScenarioEditor({ onClose, onKaggleComplete, onKaggleStart, studyAreas = [], activeStudyAreaId, zIndex = 110 }: ScenarioEditorProps) {
  const [scenarioType, setScenarioType] = useState('earthquake_swarm');
  const [params, setParams] = useState<Record<string, number | string>>(() => {
    const p: Record<string, number | string> = {};
    for (const param of SCENARIO_PARAMS.earthquake_swarm) p[param.key] = param.defaultValue;
    // Apply physics-integrated derivation
    const derived = derivePhysicsParams('earthquake_swarm', p);
    return derived;
  });

  // Kaggle GPU simulation state
  const [kaggleRunning, setKaggleRunning] = useState(false);
  const [kaggleJobId, setKaggleJobId] = useState<string | null>(null);
  const [kaggleProgress, setKaggleProgress] = useState<{ status: string; detail: string } | null>(null);
  const [kaggleError, setKaggleError] = useState<string | null>(null);
  const [kaggleResult, setKaggleResult] = useState<Record<string, unknown> | null>(null);
  const kaggleEsRef = useRef<EventSource | null>(null);

  // Cleanup SSE on unmount + track cancelled state for polling fallback
  const kaggleCancelledRef = useRef(false);
  const kaggleRunCounter = useRef(0);
  useEffect(() => {
    return () => {
      kaggleCancelledRef.current = true;
      kaggleEsRef.current?.close();
      kaggleEsRef.current = null;
    };
  }, []);

  const currentParams = SCENARIO_PARAMS[scenarioType] ?? [];

  const updateParam = useCallback((key: string, value: number | string) => {
    setParams(prev => {
      const newParams = { ...prev, [key]: value };
      // Apply physics-integrated derivation
      return derivePhysicsParams(scenarioType, newParams);
    });
  }, [scenarioType]);

  const switchScenarioType = useCallback((type: string) => {
    setScenarioType(type);
    const defaults: Record<string, number | string> = {};
    for (const param of (SCENARIO_PARAMS[type] ?? [])) defaults[param.key] = param.defaultValue;
    // Apply physics-integrated derivation to defaults
    const derived = derivePhysicsParams(type, defaults);
    setParams(derived);
  }, []);

  // Map ScenarioEditor params → Kaggle simulation params
  const mapToKaggleParams = useCallback(() => {
    const active = studyAreas.find(a => a.id === activeStudyAreaId);
    const bbox = active ? computeStudyAreaBbox(active) : null;
    const lat = bbox ? (bbox.latMin + bbox.latMax) / 2 : 29.76;
    const lon = bbox ? (bbox.lonMin + bbox.lonMax) / 2 : -95.37;
    const base: Record<string, unknown> = { type: scenarioType, lat, lon, grid_size: 512 };

    // Map scenario-specific params
    if (scenarioType === 'flood_inundation') {
      base.rainfall_mm = Number(params.rainfall) || 300;
      base.duration_hours = Number(params.duration) || 6;
      base.soil_saturation = Number(params.soilSaturation) || 0.3;
      base.dam_breach = true;
    } else if (scenarioType === 'hurricane_landfall') {
      base.category = Number(params.category) || 3;
      base.forward_speed_kmh = Number(params.forwardSpeed) || 15;
      base.central_pressure_hpa = Number(params.pressure) || 950;
      base.radius_max_wind_km = Number(params.radius) || 50;
      base.duration_hours = Number(params.landfallTime) || 24;
    } else if (scenarioType === 'earthquake_swarm') {
      base.magnitude = Number(params.magnitudeMax) || 6.5;
      base.depth_km = Number(params.depthMax) || 15;
      base.duration_seconds = 30;
    } else if (scenarioType === 'wildfire_spread') {
      base.wind_speed_ms = (Number(params.windSpeed) || 20) / 3.6;
      base.wind_dir_deg = Number(params.windDir) || 270;
      base.humidity_pct = Number(params.humidity) || 20;
      base.duration_hours = Number(params.duration) || 72;
    } else if (scenarioType === 'volcanic_eruption') {
      base.vei = Number(params.vei) || 3;
      base.wind_speed_ms = 10;
      base.wind_dir_deg = Number(params.windDir) || 260;
      base.duration_hours = Number(params.duration) || 48;
    } else if (scenarioType === 'tsunami_wave') {
      base.magnitude = Number(params.magnitude) || 8.5;
      base.seafloor_displacement_m = Number(params.waveHeight) || 5;
      base.duration_minutes = 30;
    } else if (scenarioType === 'landslide') {
      base.trigger_type = params.triggerType || 'earthquake';
      base.magnitude = Number(params.magnitude) || 6.5;
      base.pga_threshold = Number(params.pgaThreshold) || 0.15;
      base.rainfall_mm = Number(params.rainfall) || 200;
      base.friction_angle = Number(params.frictionAngle) || 35;
      base.cohesion = Number(params.cohesion) || 500;
      base.duration_hours = Number(params.duration) || 2;
    }
    return base;
  }, [scenarioType, params, studyAreas, activeStudyAreaId]);

  const handleKaggleRun = useCallback(async () => {
    // Clear any existing overlay from a previous run
    onKaggleStart?.();
    // Close any existing EventSource + cancel stale polling from previous runs
    kaggleEsRef.current?.close();
    kaggleEsRef.current = null;
    kaggleCancelledRef.current = true; // cancel any in-flight polling from prior run
    const myRun = ++kaggleRunCounter.current;
    kaggleCancelledRef.current = false; // this run is active
    setKaggleRunning(true);
    setKaggleError(null);
    setKaggleResult(null);
    setKaggleProgress({ status: 'starting', detail: 'Submitting to Kaggle GPU...' });

    try {
      const kaggleParams = mapToKaggleParams();
      const resp = await fetch('/api/kaggle/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kaggleParams),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to start simulation');

      const jobId = data.jobId;
      setKaggleJobId(jobId);
      setKaggleProgress({ status: 'pushing', detail: 'Kernel pushed to Kaggle. GPU booting...' });

      // Connect to SSE stream for real-time updates
      const es = new EventSource(`/api/kaggle/simulate/${jobId}/stream`);
      kaggleEsRef.current = es;

      es.onmessage = (event) => {
        try {
          if (kaggleRunCounter.current !== myRun) { es.close(); return; }
          const msg = JSON.parse(event.data);
          if (msg.error) {
            setKaggleError(msg.error);
            setKaggleRunning(false);
            es.close();
            return;
          }
          setKaggleProgress({ status: msg.status, detail: msg.detail || msg.status });

          if (msg.status === 'complete' || msg.status === 'error') {
            es.close();
            kaggleEsRef.current = null;
            if (kaggleRunCounter.current !== myRun) return;
            if (msg.status === 'complete') {
              fetch(`/api/kaggle/simulate/${jobId}/results`)
                .then(r => r.json())
                .then(results => {
                  if (kaggleRunCounter.current === myRun) {
                    setKaggleResult(results);
                    const p = mapToKaggleParams();
                    onKaggleComplete?.(jobId, p.lat as number, p.lon as number, scenarioType);
                  }
                })
                .catch(() => {});
            }
            setKaggleRunning(msg.status !== 'complete');
            if (msg.status === 'error') {
              setKaggleError(msg.detail || 'Simulation failed on Kaggle');
            }
          }
        } catch { /* ignore malformed SSE */ }
      };

      es.onerror = () => {
        // SSE connection lost — poll status as fallback
        es.close();
        kaggleEsRef.current = null;
        const poll = async () => {
          // Abort if unmounted or a newer run has started
          if (kaggleCancelledRef.current || kaggleRunCounter.current !== myRun) return;
          try {
            const r = await fetch(`/api/kaggle/simulate/${jobId}`);
            const j = await r.json();
            if (kaggleRunCounter.current !== myRun) return; // stale
            setKaggleProgress({ status: j.status, detail: j.status });
            if (j.status === 'complete') {
              const res = await fetch(`/api/kaggle/simulate/${jobId}/results`);
              if (kaggleRunCounter.current !== myRun) return;
              const results = await res.json();
              setKaggleResult(results);
              setKaggleRunning(false);
              const p = mapToKaggleParams();
              onKaggleComplete?.(jobId, p.lat as number, p.lon as number, scenarioType);
            } else if (j.status === 'error') {
              setKaggleError(j.error || 'Simulation failed');
              setKaggleRunning(false);
            } else if (!kaggleCancelledRef.current && kaggleRunCounter.current === myRun) {
              setTimeout(poll, 10000);
            }
          } catch {
            if (!kaggleCancelledRef.current && kaggleRunCounter.current === myRun) setTimeout(poll, 10000);
          }
        };
        if (!kaggleCancelledRef.current && kaggleRunCounter.current === myRun) setTimeout(poll, 10000);
      };
    } catch (e: unknown) {
      setKaggleError(e instanceof Error ? e.message : String(e));
      setKaggleRunning(false);
    }
  }, [mapToKaggleParams, onKaggleStart]);

  const active = studyAreas.find(a => a.id === activeStudyAreaId);
  const bbox = active ? computeStudyAreaBbox(active) : null;
  const canKaggle = !!activeStudyAreaId && !kaggleRunning;

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
          {!active ? (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic', padding: '4px 0' }}>Draw and activate a study area first</div>
          ) : !bbox ? (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic', padding: '4px 0' }}>Invalid study area geometry</div>
          ) : (
            <div style={{ fontSize: 10, background: 'rgba(34,197,94,0.1)', borderRadius: 6, padding: '6px 8px', color: 'var(--text-dim)', border: '1px solid rgba(34,197,94,0.2)' }}>
              <div style={{ fontWeight: 600, color: '#22c55e', marginBottom: 4 }}>{active.name}</div>
              <div>Lat: {bbox.latMin.toFixed(2)}° → {bbox.latMax.toFixed(2)}°</div>
              <div>Lon: {bbox.lonMin.toFixed(2)}° → {bbox.lonMax.toFixed(2)}°</div>
            </div>
          )}
        </div>

        {/* Scenario Type */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>Scenario Type</div>
          <select className="token-input" value={scenarioType} onChange={e => switchScenarioType(e.target.value)} style={{ width: '100%', fontSize: 11 }}>
            {Object.keys(SCENARIO_PARAMS).map(t => (
              <option key={t} value={t}>{SCENARIO_TYPE_LABELS[t] || t.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        {/* Scenario-Specific Parameters (physics-integrated) */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>Parameters — {SCENARIO_TYPE_LABELS[scenarioType]}</div>
          {currentParams.map(param => (
            <div key={param.key} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', marginBottom: 2 }}>
                <span>{param.label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{String(params[param.key] ?? param.defaultValue)}{param.unit}</span>
              </div>
              {param.type === 'select' ? (
                <select className="token-input" value={String(params[param.key] ?? param.defaultValue)}
                  onChange={e => updateParam(param.key, e.target.value)} style={{ width: '100%', fontSize: 10, padding: '3px 6px' }}>
                  {param.options?.map(opt => (
                    <option key={String(opt.value)} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <input type="range" min={param.min} max={param.max} step={param.step}
                  value={Number(params[param.key] ?? param.defaultValue)}
                  onChange={e => updateParam(param.key, Number(e.target.value))}
                  style={{ width: '100%', height: 3, accentColor: '#60a5fa' }} />
              )}
            </div>
          ))}
        </div>

        {/* ═══ Generate Scenario ═══ */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Cpu size={11} /> Generate Scenario
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
            Run a full-physics simulation on Kaggle's free GPU. Results stream back in real-time.
          </div>
          <button className="glass-button" style={{
            fontSize: 11, padding: '10px 16px', width: '100%',
            background: kaggleRunning
              ? 'linear-gradient(135deg,rgba(251,191,36,0.3),rgba(245,158,11,0.3))'
              : !canKaggle
                ? 'rgba(128,128,128,0.2)'
                : 'linear-gradient(135deg,rgba(251,146,60,0.3),rgba(239,68,68,0.3))',
            border: kaggleRunning
              ? '1px solid rgba(251,191,36,0.5)'
              : !canKaggle
                ? '1px solid rgba(128,128,128,0.3)'
                : '1px solid rgba(251,146,60,0.5)',
            fontWeight: 700, cursor: !canKaggle ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }} onClick={handleKaggleRun} disabled={!canKaggle}>
            {kaggleRunning ? <Loader2 size={12} className="animate-spin" /> : <Cpu size={12} />}
            {kaggleRunning ? `Generating... ${kaggleProgress?.status || ''}` : 'Generate Scenario'}
          </button>

          {/* Kaggle Progress */}
          {kaggleProgress && kaggleRunning && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', background: 'rgba(251,146,60,0.1)', borderRadius: 6, padding: '6px 8px', border: '1px solid rgba(251,146,60,0.2)', marginTop: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{kaggleProgress.status.toUpperCase()}</span>
                {kaggleJobId && <span style={{ opacity: 0.6, fontSize: 9 }}>{kaggleJobId.slice(0, 16)}</span>}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>{kaggleProgress.detail}</div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: kaggleProgress.status === 'complete' ? '100%' :
                         kaggleProgress.status === 'running' ? '70%' :
                         kaggleProgress.status === 'downloading' ? '90%' : '30%',
                  background: 'linear-gradient(90deg, #fb923c, #ef4444)',
                  borderRadius: 2, transition: 'width 1s ease',
                  animation: kaggleProgress.status !== 'complete' ? 'pulse 2s ease-in-out infinite' : undefined,
                }} />
              </div>
            </div>
          )}

          {/* Kaggle Error */}
          {kaggleError && (
            <div style={{ fontSize: 10, color: '#ef4444', background: 'rgba(239,68,68,0.1)', borderRadius: 6, padding: '6px 8px', border: '1px solid rgba(239,68,68,0.2)', marginTop: 6 }}>
              {kaggleError}
            </div>
          )}

          {/* Kaggle Results */}
          {kaggleResult && !kaggleRunning && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', background: 'rgba(34,197,94,0.1)', borderRadius: 6, padding: '8px', border: '1px solid rgba(34,197,94,0.2)', marginTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, fontWeight: 600, color: '#22c55e' }}>
                <CheckCircle size={12} /> Simulation Complete
              </div>
              {kaggleResult.final_stats as Record<string, unknown> && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', fontSize: 9 }}>
                  {Object.entries(kaggleResult.final_stats as Record<string, unknown>).map(([k, v]) => (
                    <><span style={{ opacity: 0.7 }}>{k.replace(/_/g, ' ')}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{typeof v === 'number' ? v < 1000 ? v.toFixed(2) : v.toLocaleString() : String(v)}</span></>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <button className="glass-button" style={{ fontSize: 9, flex: 1, padding: '4px 8px' }}
                  onClick={() => window.open(`/api/kaggle/simulate/${kaggleJobId}/results`, '_blank')}>
                  <Download size={10} style={{ marginRight: 3 }} />JSON
                </button>
                <button className="glass-button" style={{ fontSize: 9, flex: 1, padding: '4px 8px' }}
                  onClick={() => window.open(`/api/kaggle/kernels`, '_blank')}>
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
