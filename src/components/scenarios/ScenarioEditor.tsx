import { useState, useCallback, useRef } from 'react';
import { Sliders, AlertTriangle, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { NetCDFReader } from 'netcdfjs';
import type { Cartographic, TerrainProvider } from 'cesium';
import type { StudyAreaItem } from '@/rendering/studyArea';
import { computeStudyAreaBbox } from '@/rendering/studyArea';
import type { Point3D, Scenario } from './types';
import { SCENARIO_TYPE_LABELS } from './types';
import Panel from '@/components/ui/Panel';
import { DisasterType } from './analysis/core/types';
import type { EnvironmentSnapshot, ValidationReport, ValidationCheck } from './analysis/core/types';
import { EnvironmentAnalyzer } from './analysis/environment/EnvironmentAnalyzer';
import { ValidationEngine } from './analysis/validation/ValidationEngine';

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
};

const PRESETS: { name: string; type: string; params: Record<string, number | string> }[] = [
  { name: 'M8.0 Earthquake', type: 'earthquake_swarm', params: { magnitudeMin: 2.5, magnitudeMax: 8, depthMin: 5, depthMax: 30, numEvents: 50, timeWindow: 168, decayModel: 'omori' } },
  { name: 'Cat 5 Hurricane', type: 'hurricane_landfall', params: { category: 5, forwardSpeed: 20, pressure: 910, radius: 80, landfallTime: 36 } },
  { name: 'Massive Wildfire', type: 'wildfire_spread', params: { windSpeed: 60, windDir: 270, humidity: 10, fuelType: 'forest', area: 25000, duration: 72 } },
  { name: 'VEI 5 Eruption', type: 'volcanic_eruption', params: { vei: 5, ashHeight: 0, windDir: 260, duration: 48 } },
  { name: 'Flash Flood', type: 'flood_inundation', params: { rainfall: 800, catchmentArea: 3000, soilSaturation: 0.9, duration: 24, windSpeed: 40 } },
  { name: 'M9.0 Tsunami', type: 'tsunami_wave', params: { magnitude: 9, depth: 20, waveHeight: 25 } },
];

/** Map editor scenario types to DisasterType enum */
const SCENARIO_TO_DISASTER: Record<string, DisasterType> = {
  earthquake_swarm: DisasterType.Earthquake,
  hurricane_landfall: DisasterType.Cyclone,
  wildfire_spread: DisasterType.Wildfire,
  volcanic_eruption: DisasterType.Volcano,
  flood_inundation: DisasterType.Flood,
  tsunami_wave: DisasterType.Tsunami,
};

function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

function ValidationStatusIcon({ status }: { status: ValidationCheck['status'] }) {
  if (status === 'pass') return <CheckCircle size={12} color="#22c55e" />;
  if (status === 'fail') return <XCircle size={12} color="#ef4444" />;
  return <AlertTriangle size={12} color="#f59e0b" />;
}

interface ScenarioEditorProps {
  onClose: () => void;
  onGenerateFromBbox: (hazardType: string, bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number }, params: Record<string, unknown>) => void;
  onImport?: (scenario: Scenario) => void;
  studyAreas: StudyAreaItem[];
  activeStudyAreaId: string | null;
  terrainProvider?: TerrainProvider;
  zIndex?: number;
}

export default function ScenarioEditor({ onClose, onGenerateFromBbox, onImport, studyAreas = [], activeStudyAreaId, terrainProvider, zIndex = 110 }: ScenarioEditorProps) {
  const [scenarioType, setScenarioType] = useState('earthquake_swarm');
  const [params, setParams] = useState<Record<string, number | string>>(() => {
    const p: Record<string, number | string> = {};
    for (const param of SCENARIO_PARAMS.earthquake_swarm) p[param.key] = param.defaultValue;
    return p;
  });
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{ step: string; fraction: number } | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  // Environment analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ step: string; fraction: number } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [envSnapshot, setEnvSnapshot] = useState<EnvironmentSnapshot | null>(null);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);

  const geoInputRef = useRef<HTMLInputElement>(null);
  const czmlInputRef = useRef<HTMLInputElement>(null);
  const ncInputRef = useRef<HTMLInputElement>(null);
  const [importPath, setImportPath] = useState('');
  const [importingPath, setImportingPath] = useState(false);

  const currentParams = SCENARIO_PARAMS[scenarioType] ?? [];

  const updateParam = useCallback((key: string, value: number | string) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const switchScenarioType = useCallback((type: string) => {
    setScenarioType(type);
    const defaults: Record<string, number | string> = {};
    for (const param of (SCENARIO_PARAMS[type] ?? [])) defaults[param.key] = param.defaultValue;
    setParams(defaults);
    // Re-validate if we have an environment snapshot
    setValidationReport(null);
  }, []);

  const applyPreset = useCallback((preset: { type: string; params: Record<string, number | string> }) => {
    setScenarioType(preset.type);
    setParams({ ...preset.params });
    setValidationReport(null);
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!terrainProvider) {
      setAnalysisError('Terrain provider not available');
      return;
    }
    const active = studyAreas.find(a => a.id === activeStudyAreaId);
    if (!active) return;

    // Build polygon from study area positions
    const bbox = computeStudyAreaBbox(active);
    if (!bbox) return;

    setAnalyzing(true);
    setAnalysisProgress({ step: 'Starting analysis...', fraction: 0 });
    setAnalysisError(null);
    setEnvSnapshot(null);
    setValidationReport(null);

    try {
      // Convert bbox to Cartographic polygon (corners)
      const polygon: Cartographic[] = [
        { longitude: bbox.lonMin * Math.PI / 180, latitude: bbox.latMin * Math.PI / 180, height: 0 },
        { longitude: bbox.lonMax * Math.PI / 180, latitude: bbox.latMin * Math.PI / 180, height: 0 },
        { longitude: bbox.lonMax * Math.PI / 180, latitude: bbox.latMax * Math.PI / 180, height: 0 },
        { longitude: bbox.lonMin * Math.PI / 180, latitude: bbox.latMax * Math.PI / 180, height: 0 },
      ] as Cartographic[];

      const analyzer = new EnvironmentAnalyzer(terrainProvider);
      const { env } = await analyzer.analyze(polygon, (step, fraction) => {
        setAnalysisProgress({ step, fraction });
      });

      setEnvSnapshot(env);

      // Run validation for current scenario type
      const disasterType = SCENARIO_TO_DISASTER[scenarioType];
      if (disasterType) {
        const validator = new ValidationEngine();
        const report = validator.validate(disasterType, env);
        setValidationReport(report);
      }
    } catch (e: unknown) {
      setAnalysisError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
      setAnalysisProgress(null);
    }
  }, [terrainProvider, studyAreas, activeStudyAreaId, scenarioType]);

  const handleGenerate = useCallback(async () => {
    const active = studyAreas.find(a => a.id === activeStudyAreaId);
    if (!active) return;
    const bbox = computeStudyAreaBbox(active);
    if (!bbox) return;
    setGenerating(true);
    setGenerationError(null);
    setGenerationProgress({ step: 'Initializing generation...', fraction: 0 });

    // Simulate progress steps while API call runs
    const progressSteps = [
      { step: 'Preparing parameters...', fraction: 0.15 },
      { step: 'Running simulator...', fraction: 0.4 },
      { step: 'Computing hazard fields...', fraction: 0.65 },
      { step: 'Building time series...', fraction: 0.85 },
    ];
    let stepIdx = 0;
    const progressInterval = setInterval(() => {
      if (stepIdx < progressSteps.length) {
        setGenerationProgress(progressSteps[stepIdx]);
        stepIdx++;
      }
    }, 800);

    try {
      await onGenerateFromBbox(scenarioType, bbox, { ...params });
      setGenerationProgress({ step: 'Complete', fraction: 1 });
    } catch (e: unknown) {
      setGenerationError(e instanceof Error ? e.message : String(e));
    } finally {
      clearInterval(progressInterval);
      setGenerating(false);
      setGenerationProgress(null);
    }
  }, [scenarioType, params, studyAreas, activeStudyAreaId, onGenerateFromBbox]);

  const parseFile = useCallback((text: string, format: string) => {
    try {
      const pointCloud: Point3D[] = [];
      let lat = 0, lon = 0;

      if (format === 'geojson') {
        const data = JSON.parse(text);
        const features = data.features || [];
        let sumLat = 0, sumLon = 0, count = 0;
        for (const f of features) {
          if (f.geometry?.type !== 'Point') continue;
          const c = f.geometry.coordinates;
          const lonDeg = Number(c[0]); const latDeg = Number(c[1]);
          if (!Number.isFinite(lonDeg) || !Number.isFinite(latDeg)) continue;
          if (Math.abs(latDeg) > 90 || Math.abs(lonDeg) > 180) continue;
          const lonRad = lonDeg * Math.PI / 180; const latRad = latDeg * Math.PI / 180;
          pointCloud.push({ x: Math.cos(latRad) * Math.cos(lonRad), y: Math.cos(latRad) * Math.sin(lonRad), z: Math.sin(latRad) });
          sumLat += latDeg; sumLon += lonDeg; count++;
        }
        if (count > 0) { lat = sumLat / count; lon = sumLon / count; }
      } else if (format === 'czml') {
        const packets = JSON.parse(text);
        let sumLat = 0, sumLon = 0, count = 0;
        for (const pkt of packets) {
          if (pkt.id === 'document') continue;
          const positions = pkt.position?.cartographicDegrees;
          if (!positions) continue;
          for (let i = 0; i + 1 < positions.length; i += 3) {
            const lonDeg = positions[i]; const latDeg = positions[i + 1]; const heightM = positions[i + 2] || 0;
            if (!Number.isFinite(lonDeg) || !Number.isFinite(latDeg)) continue;
            const lonRad = lonDeg * Math.PI / 180; const latRad = latDeg * Math.PI / 180;
            const r = 1 - (heightM / 6371000);
            pointCloud.push({ x: r * Math.cos(latRad) * Math.cos(lonRad), y: r * Math.cos(latRad) * Math.sin(lonRad), z: r * Math.sin(latRad) });
            sumLon += lonDeg; sumLat += latDeg; count++;
          }
        }
        if (count > 0) { lat = sumLat / count; lon = sumLon / count; }
      }

      if (pointCloud.length === 0) { alert('No points found in file'); return; }
      const id = `imported_${Date.now().toString(36)}`;
      onImport?.({ id, type: format, name: `Imported ${format.toUpperCase()} — ${pointCloud.length} points`, pointCloud, validationScore: 0.5, severity: 'medium', location: { lat, lon }, timestamp: new Date().toISOString() });
    } catch (e: unknown) {
      alert(`Failed to parse ${format.toUpperCase()}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [onImport]);

  function parseNcVars(vars: Record<string, number[] | undefined>): { pointCloud: Point3D[]; lat: number; lon: number } {
    const pointCloud: Point3D[] = [];
    let lat = 0, lon = 0;
    if (vars.x && vars.y && vars.z) {
      const n = Math.min(vars.x.length, vars.y.length, vars.z.length);
      let sumLat = 0, sumLon = 0;
      for (let i = 0; i < n; i++) {
        pointCloud.push({ x: vars.x[i], y: vars.y[i], z: vars.z[i] });
        const r = Math.sqrt(vars.x[i] * vars.x[i] + vars.y[i] * vars.y[i] + vars.z[i] * vars.z[i]);
        sumLat += Math.asin(clamp(vars.z[i] / r, -1, 1)) * 180 / Math.PI;
        sumLon += Math.atan2(vars.y[i], vars.x[i]) * 180 / Math.PI;
      }
      if (n > 0) { lat = sumLat / n; lon = sumLon / n; }
    } else {
      const lats = (vars.lat || vars.latitude) as number[];
      const lons = (vars.lon || vars.longitude) as number[];
      if (lats && lons) {
        const n = Math.min(lats.length, lons.length);
        let sumLat = 0, sumLon = 0;
        for (let i = 0; i < n; i++) {
          const latRad = lats[i] * Math.PI / 180; const lonRad = lons[i] * Math.PI / 180;
          pointCloud.push({ x: Math.cos(latRad) * Math.cos(lonRad), y: Math.cos(latRad) * Math.sin(lonRad), z: Math.sin(latRad) });
          sumLat += lats[i]; sumLon += lons[i];
        }
        if (n > 0) { lat = sumLat / n; lon = sumLon / n; }
      }
    }
    return { pointCloud, lat, lon };
  }

  const parseNcFile = useCallback((buffer: ArrayBuffer) => {
    try {
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const text = decoder.decode(buffer.slice(0, Math.min(buffer.byteLength, 65536)));
      if (text.trim().startsWith('{')) {
        const fullText = decoder.decode(buffer);
        const data = JSON.parse(fullText);
        const vars = data.variables || data;
        if (vars.x || vars.lat || vars.latitude) {
          const { pointCloud, lat, lon } = parseNcVars(vars);
          if (pointCloud.length > 0) {
            onImport?.({ id: `imported_${Date.now().toString(36)}`, type: 'netcdf', name: `Imported NetCDF — ${pointCloud.length} points`, pointCloud, validationScore: 0.5, severity: 'medium', location: { lat, lon }, timestamp: new Date().toISOString() });
            return;
          }
        }
      }
    } catch { /* not JSON */ }

    try {
      const reader = new NetCDFReader(buffer);
      const vars: Record<string, number[]> = {};
      for (const v of reader.variables) vars[v.name] = reader.getDataVariable(v) as number[];
      const { pointCloud, lat, lon } = parseNcVars(vars);
      if (pointCloud.length === 0) { alert(`No recognized variables. Available: ${Object.keys(vars).join(', ') || 'none'}`); return; }
      onImport?.({ id: `imported_${Date.now().toString(36)}`, type: 'netcdf', name: `Imported NetCDF — ${pointCloud.length} points`, pointCloud, validationScore: 0.5, severity: 'medium', location: { lat, lon }, timestamp: new Date().toISOString() });
      return;
    } catch { /* not v3 classic */ }

    const bytes = new Uint8Array(buffer);
    const CHUNK = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    const base64 = btoa(binary);
    fetch('/api/scenarios/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: base64 }) })
      .then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error || 'Import failed'); }); return r.json(); })
      .then(data => {
        const { pointCloud, lat, lon } = parseNcVars({ x: data.pointCloud?.map((p: { x: number }) => p.x), y: data.pointCloud?.map((p: { y: number }) => p.y), z: data.pointCloud?.map((p: { z: number }) => p.z), lat: data.lat ? [data.lat] : undefined, lon: data.lon ? [data.lon] : undefined });
        if (pointCloud.length === 0) { alert(`No recognized variables. Available: ${(data.variables || []).join(', ')}`); return; }
        onImport?.({ id: `imported_${Date.now().toString(36)}`, type: 'netcdf', name: `Imported NetCDF — ${pointCloud.length} points`, pointCloud, validationScore: 0.5, severity: 'medium', location: { lat, lon }, timestamp: new Date().toISOString() });
      }).catch((e: unknown) => { alert(`Failed to import NetCDF: ${e instanceof Error ? e.message : String(e)}`); });
  }, [onImport]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>, format: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(format);
    if (format === 'netcdf') {
      const reader = new FileReader();
      reader.onload = () => { setImporting(null); parseNcFile(reader.result as ArrayBuffer); };
      reader.onerror = () => setImporting(null);
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => { setImporting(null); parseFile(reader.result as string, format); };
      reader.onerror = () => setImporting(null);
      reader.readAsText(file);
    }
    e.target.value = '';
  }, [parseFile, parseNcFile]);

  const handleImportPath = useCallback(async () => {
    if (!importPath.trim()) { alert('Enter a file path'); return; }
    setImportingPath(true);
    try {
      const active = studyAreas.find(a => a.id === activeStudyAreaId);
      const activeBbox = active ? computeStudyAreaBbox(active) : null;
      const body: Record<string, unknown> = { path: importPath.trim(), maxPoints: 8000 };
      if (activeBbox) { body.bbox = activeBbox; body.maxPoints = 20000; }
      const resp = await fetch('/api/scenarios/import-from-path', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Import failed');
      const pointCloud = data.pointCloud.map((p: { x: number; y: number; z: number }) => ({ x: p.x, y: p.y, z: p.z }));
      onImport?.({ id: `imported_${Date.now().toString(36)}`, type: 'netcdf', name: `${data.variableName || 'NetCDF'} — ${pointCloud.length} points`, pointCloud, validationScore: 0.5, severity: 'medium', location: { lat: data.lat, lon: data.lon }, timestamp: new Date().toISOString(), metadata: { variableName: data.variableName, colorValues: data.colorValues, valueMin: data.valueMin, valueMax: data.valueMax } });
    } catch (e: unknown) {
      alert(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setImportingPath(false); }
  }, [importPath, studyAreas, activeStudyAreaId, onImport]);

  const active = studyAreas.find(a => a.id === activeStudyAreaId);
  const bbox = active ? computeStudyAreaBbox(active) : null;
  const canAnalyze = !!terrainProvider && !!activeStudyAreaId;
  const canGenerate = !!activeStudyAreaId && (!validationReport || validationReport.feasible);

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
        {/* Presets */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>Quick Presets</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {PRESETS.map(preset => (
              <button key={preset.name} className="glass-button" style={{ fontSize: 10, padding: '3px 8px' }} onClick={() => applyPreset(preset)}>
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        {/* Type Select */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>Scenario Type</div>
          <select className="token-input" value={scenarioType} onChange={e => switchScenarioType(e.target.value)} style={{ width: '100%', fontSize: 11 }}>
            {Object.keys(SCENARIO_PARAMS).map(t => (
              <option key={t} value={t}>{SCENARIO_TYPE_LABELS[t] || t.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

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

        {/* Analyze Area Button */}
        <button className="glass-button" style={{
          fontSize: 11, padding: '8px 14px', width: '100%',
          background: !canAnalyze ? 'rgba(128,128,128,0.2)' : 'linear-gradient(135deg,rgba(139,92,246,0.3),rgba(59,130,246,0.3))',
          border: !canAnalyze ? '1px solid rgba(128,128,128,0.3)' : '1px solid rgba(139,92,246,0.5)',
          fontWeight: 600, cursor: !canAnalyze ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }} onClick={handleAnalyze} disabled={analyzing || !canAnalyze}
          title={!canAnalyze ? 'Draw and activate a study area first' : undefined}>
          {analyzing ? <Loader2 size={12} className="animate-spin" /> : null}
          {analyzing ? `Analyzing... ${Math.round((analysisProgress?.fraction ?? 0) * 100)}%` : 'Analyze Area'}
        </button>

        {/* Analysis Progress */}
        {analysisProgress && analyzing && (
          <div style={{ fontSize: 10, color: 'var(--text-dim)', background: 'rgba(139,92,246,0.1)', borderRadius: 6, padding: '6px 8px', border: '1px solid rgba(139,92,246,0.2)' }}>
            <div style={{ marginBottom: 4 }}>{analysisProgress.step}</div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${analysisProgress.fraction * 100}%`, background: 'linear-gradient(90deg, #8b5cf6, #3b82f6)', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
          </div>
        )}

        {/* Analysis Error */}
        {analysisError && (
          <div style={{ fontSize: 10, color: '#ef4444', background: 'rgba(239,68,68,0.1)', borderRadius: 6, padding: '6px 8px', border: '1px solid rgba(239,68,68,0.2)' }}>
            {analysisError}
          </div>
        )}

        {/* Environment Snapshot Stats */}
        {envSnapshot && !analyzing && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4, fontWeight: 600 }}>Environment Analysis</div>
            <div style={{ fontSize: 10, background: 'rgba(59,130,246,0.1)', borderRadius: 6, padding: '6px 8px', color: 'var(--text-dim)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px' }}>
                <span>Elevation</span><span>{envSnapshot.stats.minElevationM.toFixed(0)} – {envSnapshot.stats.maxElevationM.toFixed(0)} m</span>
                <span>Mean Slope</span><span>{envSnapshot.stats.meanSlopeDeg.toFixed(1)}°</span>
                <span>Water</span><span>{(envSnapshot.stats.oceanFraction * 100).toFixed(1)}%</span>
                <span>Vegetation</span><span>{(envSnapshot.stats.vegetationFraction * 100).toFixed(1)}%</span>
                <span>Urban</span><span>{(envSnapshot.stats.urbanFraction * 100).toFixed(1)}%</span>
                <span>Rivers</span><span>{(envSnapshot.stats.riverFraction * 100).toFixed(1)}%</span>
                <span>Coastline</span><span>{(envSnapshot.stats.coastlineLengthM / 1000).toFixed(1)} km</span>
                <span>Ocean Connected</span><span>{envSnapshot.stats.oceanConnected ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Validation Report */}
        {validationReport && !analyzing && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              Validation — {SCENARIO_TYPE_LABELS[scenarioType] || scenarioType}
              <span style={{
                fontSize: 9, padding: '1px 6px', borderRadius: 4, fontWeight: 700,
                background: validationReport.feasible ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                color: validationReport.feasible ? '#22c55e' : '#ef4444',
              }}>
                {validationReport.feasible ? 'FEASIBLE' : 'REJECTED'}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {validationReport.checks.map(check => (
                <div key={check.id} style={{
                  fontSize: 10, borderRadius: 6, padding: '6px 8px',
                  background: check.status === 'fail' ? 'rgba(239,68,68,0.08)' : check.status === 'warn' ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)',
                  border: `1px solid ${check.status === 'fail' ? 'rgba(239,68,68,0.2)' : check.status === 'warn' ? 'rgba(245,158,11,0.2)' : 'rgba(34,197,94,0.2)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <ValidationStatusIcon status={check.status} />
                    <span style={{ fontWeight: 600, color: 'var(--text-dim)' }}>{check.label}</span>
                    {check.measured !== undefined && (
                      <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>{String(check.measured)}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.4 }}>{check.detail}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
              {validationReport.summary}
            </div>
          </div>
        )}

        {/* Scenario-Specific Parameters */}
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

        {/* Generation Error */}
        {generationError && (
          <div style={{ fontSize: 10, color: '#ef4444', background: 'rgba(239,68,68,0.1)', borderRadius: 6, padding: '6px 8px', border: '1px solid rgba(239,68,68,0.2)' }}>
            {generationError}
          </div>
        )}

        {/* Generate Scenario */}
        <button className="glass-button" style={{
          fontSize: 12, padding: '10px 16px', width: '100%',
          background: !canGenerate ? 'rgba(128,128,128,0.2)' : 'linear-gradient(135deg,rgba(16,185,129,0.3),rgba(59,130,246,0.3))',
          border: !canGenerate ? '1px solid rgba(128,128,128,0.3)' : '1px solid rgba(16,185,129,0.5)',
          fontWeight: 700, cursor: !canGenerate ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }} onClick={handleGenerate} disabled={generating || !canGenerate}
          title={!canGenerate ? (validationReport && !validationReport.feasible ? 'Scenario rejected by validation' : 'Draw and activate a study area first') : undefined}>
          {generating && <Loader2 size={12} className="animate-spin" />}
          {generating ? `Generating... ${Math.round((generationProgress?.fraction ?? 0) * 100)}%` : (validationReport && !validationReport.feasible) ? 'Scenario Rejected' : 'Generate Scenario'}
        </button>

        {/* Generation Progress */}
        {generationProgress && generating && (
          <div style={{ fontSize: 10, color: 'var(--text-dim)', background: 'rgba(16,185,129,0.1)', borderRadius: 6, padding: '6px 8px', border: '1px solid rgba(16,185,129,0.2)' }}>
            <div style={{ marginBottom: 4 }}>{generationProgress.step}</div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${generationProgress.fraction * 100}%`, background: 'linear-gradient(90deg, #10b981, #3b82f6)', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
          </div>
        )}

        {/* Import */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>Import Data</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input type="file" accept=".geojson,.json" ref={geoInputRef} style={{ display: 'none' }} onChange={e => handleFile(e, 'geojson')} />
            <input type="file" accept=".czml,.json" ref={czmlInputRef} style={{ display: 'none' }} onChange={e => handleFile(e, 'czml')} />
            <input type="file" accept=".nc,.json" ref={ncInputRef} style={{ display: 'none' }} onChange={e => handleFile(e, 'netcdf')} />
            <button className="glass-button" style={{ fontSize: 10, flex: 1, opacity: importing ? 0.5 : 1 }} onClick={() => geoInputRef.current?.click()} disabled={!!importing}>{importing === 'geojson' ? '...' : 'GeoJSON'}</button>
            <button className="glass-button" style={{ fontSize: 10, flex: 1, opacity: importing ? 0.5 : 1 }} onClick={() => czmlInputRef.current?.click()} disabled={!!importing}>{importing === 'czml' ? '...' : 'CZML'}</button>
            <button className="glass-button" style={{ fontSize: 10, flex: 1, opacity: importing ? 0.5 : 1 }} onClick={() => ncInputRef.current?.click()} disabled={!!importing}>{importing === 'netcdf' ? '...' : 'NetCDF'}</button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="text" className="token-input" placeholder="Server file path for large .nc" value={importPath}
              onChange={e => setImportPath(e.target.value)} style={{ flex: 1, fontSize: 10, padding: '3px 6px' }} />
            <button className="glass-button" style={{ fontSize: 10, padding: '3px 10px', whiteSpace: 'nowrap' }}
              onClick={handleImportPath} disabled={importingPath}>
              {importingPath ? '...' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </Panel>
    </div>
  );
}
