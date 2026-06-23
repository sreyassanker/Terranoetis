import { useState, useCallback, useEffect, useRef } from 'react';
import { NetCDFReader } from 'netcdfjs';
import type { StudyAreaItem } from '@/rendering/studyArea';
import { computeStudyAreaBbox } from '@/rendering/studyArea';

interface ParameterSlider {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit: string;
}

interface ScenarioPreset {
  name: string;
  type: string;
  params: Record<string, number>;
}

interface Point3D { x: number; y: number; z: number }

function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

const PARAMETERS: ParameterSlider[] = [
  { key: 'magnitude', label: 'Magnitude', min: 3, max: 9.5, step: 0.1, defaultValue: 5, unit: '' },
  { key: 'depth', label: 'Depth', min: 1, max: 100, step: 1, defaultValue: 10, unit: 'km' },
  { key: 'spread', label: 'Spread Radius', min: 0.01, max: 1, step: 0.01, defaultValue: 0.1, unit: '°' },
  { key: 'intensity', label: 'Intensity', min: 0.1, max: 10, step: 0.1, defaultValue: 1, unit: '' },
  { key: 'duration', label: 'Duration', min: 1, max: 72, step: 1, defaultValue: 24, unit: 'h' },
  { key: 'windSpeed', label: 'Wind Speed', min: 0, max: 300, step: 1, defaultValue: 50, unit: 'km/h' },
  { key: 'populationDensity', label: 'Population Density', min: 0, max: 10000, step: 100, defaultValue: 500, unit: '/km²' },
];

const PRESETS: ScenarioPreset[] = [
  { name: 'M8.0 Earthquake', type: 'earthquake_swarm', params: { magnitude: 8, depth: 10, spread: 0.3, intensity: 8, duration: 48, windSpeed: 0, populationDensity: 5000 } },
  { name: 'Category 5 Hurricane', type: 'hurricane_landfall', params: { magnitude: 9, depth: 0, spread: 0.8, intensity: 9, duration: 36, windSpeed: 280, populationDensity: 2000 } },
  { name: 'Massive Wildfire', type: 'wildfire_spread', params: { magnitude: 6, depth: 0, spread: 0.5, intensity: 7, duration: 72, windSpeed: 60, populationDensity: 500 } },
  { name: 'Tsunami Wave', type: 'tsunami_wave', params: { magnitude: 8.5, depth: 20, spread: 0.6, intensity: 9, duration: 6, windSpeed: 0, populationDensity: 10000 } },
  { name: 'Volcanic Eruption', type: 'volcanic_eruption', params: { magnitude: 5, depth: 5, spread: 0.4, intensity: 8, duration: 48, windSpeed: 30, populationDensity: 1000 } },
  { name: 'Flash Flood', type: 'flood_inundation', params: { magnitude: 4, depth: 0, spread: 0.2, intensity: 6, duration: 12, windSpeed: 40, populationDensity: 3000 } },
];

const SCENARIO_TYPES = ['earthquake_swarm', 'hurricane_landfall', 'wildfire_spread', 'volcanic_eruption', 'flood_inundation', 'tsunami_wave'];

interface ScenarioEditorProps {
  onClose: () => void;
  onGenerateFromBbox: (hazardType: string, bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number }, params: Record<string, unknown>) => void;
  onImport?: (scenario: { id: string; type: string; name: string; pointCloud: Point3D[]; validationScore: number; severity: string; location: { lat: number; lon: number }; timestamp: string; metadata?: Record<string, unknown> }) => void;
  studyAreas: StudyAreaItem[];
  activeStudyAreaId: string | null;
}

export default function ScenarioEditor({ onClose, onGenerateFromBbox, onImport, studyAreas = [], activeStudyAreaId }: ScenarioEditorProps) {
  const [scenarioType, setScenarioType] = useState('earthquake_swarm');
  const [params, setParams] = useState<Record<string, number>>(() => {
    const p: Record<string, number> = {};
    for (const param of PARAMETERS) p[param.key] = param.defaultValue;
    return p;
  });
  const [generating, setGenerating] = useState(false);

  const geoInputRef = useRef<HTMLInputElement>(null);
  const czmlInputRef = useRef<HTMLInputElement>(null);
  const ncInputRef = useRef<HTMLInputElement>(null);
  const [importPath, setImportPath] = useState('');
  const [importVar, setImportVar] = useState('');
  const [importingPath, setImportingPath] = useState(false);

  const updateParam = useCallback((key: string, value: number) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const applyPreset = useCallback((preset: ScenarioPreset) => {
    setScenarioType(preset.type);
    setParams(prev => ({ ...prev, ...preset.params }));
  }, []);

  const handleGenerate = useCallback(async () => {
    const active = studyAreas.find(a => a.id === activeStudyAreaId);
    if (!active) return;
    const bbox = computeStudyAreaBbox(active);
    if (!bbox) return;
    setGenerating(true);
    try {
      await onGenerateFromBbox(scenarioType, bbox, { ...params });
    } finally {
      setGenerating(false);
    }
  }, [scenarioType, params, studyAreas, activeStudyAreaId, onGenerateFromBbox]);

  const parseFile = useCallback((text: string, format: string) => {
    try {
      let pointCloud: Point3D[] = [];
      let lat = 0, lon = 0;

      if (format === 'geojson') {
        const data = JSON.parse(text);
        const features = data.features || [];
        let sumLat = 0, sumLon = 0, count = 0;
        for (const f of features) {
          if (f.geometry?.type !== 'Point') continue;
          const c = f.geometry.coordinates;
          let px: number, py: number, pz: number;
          if (Math.abs(c[0]) <= 1 && Math.abs(c[1]) <= 1) {
            px = c[0]; py = c[1]; pz = c[2] || 0;
          } else {
            const lonRad = c[0] * Math.PI / 180;
            const latRad = c[1] * Math.PI / 180;
            px = Math.cos(latRad) * Math.cos(lonRad);
            py = Math.cos(latRad) * Math.sin(lonRad);
            pz = Math.sin(latRad);
          }
          pointCloud.push({ x: px, y: py, z: pz });
          const r = Math.sqrt(px*px + py*py + pz*pz);
          sumLat += Math.asin(clamp(pz / r, -1, 1)) * 180 / Math.PI;
          sumLon += Math.atan2(py, px) * 180 / Math.PI;
          count++;
        }
        if (count > 0) { lat = sumLat / count; lon = sumLon / count; }
      } else if (format === 'czml') {
        const packets = JSON.parse(text);
        let sumLat = 0, sumLon = 0, count = 0;
        for (const pkt of packets) {
          if (pkt.id === 'document') continue;
          const positions = pkt.position?.cartographicDegrees;
          if (!positions) continue;
          for (let i = 0; i < positions.length; i += 3) {
            const lonRad = positions[i] * Math.PI / 180;
            const latRad = positions[i+1] * Math.PI / 180;
            pointCloud.push({
              x: Math.cos(latRad) * Math.cos(lonRad),
              y: Math.cos(latRad) * Math.sin(lonRad),
              z: Math.sin(latRad),
            });
            sumLon += positions[i]; sumLat += positions[i+1]; count++;
          }
        }
        if (count > 0) { lat = sumLat / count; lon = sumLon / count; }
      }

      if (pointCloud.length === 0) { alert('No points found in file'); return; }
      const id = `imported_${Date.now().toString(36)}`;
      onImport?.({
        id,
        type: format,
        name: `Imported ${format.toUpperCase()} — ${pointCloud.length} points`,
        pointCloud,
        validationScore: 0.5,
        severity: 'medium',
        location: { lat, lon },
        timestamp: new Date().toISOString(),
      });
    } catch (e: any) {
      alert(`Failed to parse ${format.toUpperCase()}: ${e.message}`);
    }
  }, [onImport]);

  function parseNcVars(vars: Record<string, number[]>): { pointCloud: Point3D[]; lat: number; lon: number } {
    let pointCloud: Point3D[] = [];
    let lat = 0, lon = 0;

    if (vars.x && vars.y && vars.z) {
      const n = Math.min(vars.x.length, vars.y.length, vars.z.length);
      let sumLat = 0, sumLon = 0;
      for (let i = 0; i < n; i++) {
        pointCloud.push({ x: vars.x[i], y: vars.y[i], z: vars.z[i] });
        const r = Math.sqrt(vars.x[i]*vars.x[i] + vars.y[i]*vars.y[i] + vars.z[i]*vars.z[i]);
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
          const latRad = lats[i] * Math.PI / 180;
          const lonRad = lons[i] * Math.PI / 180;
          pointCloud.push({
            x: Math.cos(latRad) * Math.cos(lonRad),
            y: Math.cos(latRad) * Math.sin(lonRad),
            z: Math.sin(latRad),
          });
          sumLat += lats[i]; sumLon += lons[i];
        }
        if (n > 0) { lat = sumLat / n; lon = sumLon / n; }
      }
    }
    return { pointCloud, lat, lon };
  }

  const parseNcFile = useCallback((buffer: ArrayBuffer) => {
    // Try parsing as JSON text first (our server's .nc.json wrapper)
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
            const id = `imported_${Date.now().toString(36)}`;
            onImport?.({ id, type: 'netcdf', name: `Imported NetCDF — ${pointCloud.length} points`, pointCloud, validationScore: 0.5, severity: 'medium', location: { lat, lon }, timestamp: new Date().toISOString() });
            return;
          }
        }
      }
    } catch { /* not JSON */ }

    // Try binary NetCDF v3.x classic (small files only)
    try {
      const reader = new NetCDFReader(buffer);
      const vars: Record<string, number[]> = {};
      for (const name of Object.keys(reader.variables)) {
        vars[name] = reader.variables[name].data as number[];
      }
      const { pointCloud, lat, lon } = parseNcVars(vars);
      if (pointCloud.length === 0) { alert(`No recognized variables found. Available: ${Object.keys(vars).join(', ') || 'none'}`); return; }
      const id = `imported_${Date.now().toString(36)}`;
      onImport?.({ id, type: 'netcdf', name: `Imported NetCDF — ${pointCloud.length} points`, pointCloud, validationScore: 0.5, severity: 'medium', location: { lat, lon }, timestamp: new Date().toISOString() });
      return;
    } catch { /* not v3 classic, try server-side */ }

    // Upload to server for HDF5/NetCDF4 parsing
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    fetch('/api/scenarios/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: base64 }),
    }).then(r => {
      if (!r.ok) return r.json().then(e => { throw new Error(e.error || 'Import failed'); });
      return r.json();
    }).then(data => {
      const { pointCloud, lat, lon } = parseNcVars({
        x: data.pointCloud?.map((p: any) => p.x),
        y: data.pointCloud?.map((p: any) => p.y),
        z: data.pointCloud?.map((p: any) => p.z),
        lat: data.lat ? [data.lat] : undefined,
        lon: data.lon ? [data.lon] : undefined,
      });
      if (pointCloud.length === 0) { alert(`No recognized variables in server response. Available: ${(data.variables || []).join(', ')}`); return; }
      const id = `imported_${Date.now().toString(36)}`;
      onImport?.({ id, type: 'netcdf', name: `Imported NetCDF — ${pointCloud.length} points`, pointCloud, validationScore: 0.5, severity: 'medium', location: { lat, lon }, timestamp: new Date().toISOString() });
    }).catch((e: any) => {
      alert(`Failed to import NetCDF: ${e.message}`);
    });
  }, [onImport]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>, format: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (format === 'netcdf') {
      const reader = new FileReader();
      reader.onload = () => parseNcFile(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => parseFile(reader.result as string, format);
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
      const body: any = { path: importPath.trim(), variable: importVar || undefined, maxPoints: 8000 };
      if (activeBbox) {
        body.bbox = activeBbox;
        body.maxPoints = 20000;
      }
      const resp = await fetch('/api/scenarios/import-from-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Import failed');
      const pointCloud = data.pointCloud.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
      const id = `imported_${Date.now().toString(36)}`;
      onImport?.({
        id, type: 'netcdf',
        name: `${data.variableName || 'NetCDF'} — ${pointCloud.length} points`,
        pointCloud, validationScore: 0.5, severity: 'medium',
        location: { lat: data.lat, lon: data.lon },
        timestamp: new Date().toISOString(),
        metadata: { variableName: data.variableName, colorValues: data.colorValues, valueMin: data.valueMin, valueMax: data.valueMax },
      });
    } catch (e: any) {
      alert(`Import failed: ${e.message}`);
    } finally {
      setImportingPath(false);
    }
  }, [importPath, importVar, studyAreas, activeStudyAreaId, onImport]);

  return (
    <div className="alerts-panel glass-panel open" style={{ width: 440, maxHeight: 'calc(100vh - 92px)' }}>
      <div className="ai-header">
        <div className="social-icon-grad">🎬</div>
        <div className="ai-title">Scenario Editor</div>
        <button className="ai-close" onClick={onClose}>✕</button>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, overflowY: 'auto', maxHeight: 'calc(100vh - 140px)' }}>
        {/* Presets */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>Presets</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {PRESETS.map(preset => (
              <button key={preset.name} className="glass-button" style={{ fontSize: 10, padding: '3px 8px' }}
                onClick={() => applyPreset(preset)}>
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        {/* Type Select */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>Scenario Type</div>
          <select className="token-input" value={scenarioType}
            onChange={e => setScenarioType(e.target.value)}
            style={{ width: '100%', fontSize: 11 }}>
            {SCENARIO_TYPES.map(t => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        {/* Active Study Area */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4, fontWeight: 600 }}>Study Area</div>
          {(() => {
            const active = studyAreas.find(a => a.id === activeStudyAreaId);
            if (!active) return (
              <div style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic', padding: '4px 0' }}>
                Draw and activate a study area first
              </div>
            );
            const bbox = computeStudyAreaBbox(active);
            if (!bbox) return (
              <div style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic', padding: '4px 0' }}>
                Invalid study area geometry
              </div>
            );
            return (
              <div style={{ fontSize: 10, background: 'rgba(34,197,94,0.1)', borderRadius: 6, padding: '6px 8px', color: 'var(--text-dim)', border: '1px solid rgba(34,197,94,0.2)' }}>
                <div style={{ fontWeight: 600, color: '#22c55e', marginBottom: 4 }}>{active.name}</div>
                <div>Lat: {bbox.latMin.toFixed(2)}° → {bbox.latMax.toFixed(2)}°</div>
                <div>Lon: {bbox.lonMin.toFixed(2)}° → {bbox.lonMax.toFixed(2)}°</div>
              </div>
            );
          })()}
        </div>

        {/* Parameter Sliders */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>Parameters</div>
          {PARAMETERS.map(param => (
            <div key={param.key} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)' }}>
                <span>{param.label}</span>
                <span>{params[param.key]}{param.unit}</span>
              </div>
              <input type="range" min={param.min} max={param.max} step={param.step}
                value={params[param.key]}
                onChange={e => updateParam(param.key, Number(e.target.value))}
                style={{ width: '100%', height: 3, accentColor: '#60a5fa' }} />
            </div>
          ))}
        </div>

        {/* Generate Scenario */}
        <button className="glass-button" style={{
          fontSize: 12, padding: '10px 16px', width: '100%',
          background: !activeStudyAreaId ? 'rgba(128,128,128,0.2)' : 'linear-gradient(135deg,rgba(16,185,129,0.3),rgba(59,130,246,0.3))',
          border: !activeStudyAreaId ? '1px solid rgba(128,128,128,0.3)' : '1px solid rgba(16,185,129,0.5)',
          fontWeight: 700, cursor: !activeStudyAreaId ? 'not-allowed' : 'pointer',
        }} onClick={handleGenerate} disabled={generating || !activeStudyAreaId}>
          {generating ? 'Generating...' : 'Generate Scenario'}
        </button>

        {/* Import */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>Import</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input type="file" accept=".geojson,.json" ref={geoInputRef} style={{ display: 'none' }} onChange={e => handleFile(e, 'geojson')} />
            <input type="file" accept=".czml,.json" ref={czmlInputRef} style={{ display: 'none' }} onChange={e => handleFile(e, 'czml')} />
            <input type="file" accept=".nc,.json" ref={ncInputRef} style={{ display: 'none' }} onChange={e => handleFile(e, 'netcdf')} />
            <button className="glass-button" style={{ fontSize: 10, flex: 1 }} onClick={() => geoInputRef.current?.click()}>GeoJSON</button>
            <button className="glass-button" style={{ fontSize: 10, flex: 1 }} onClick={() => czmlInputRef.current?.click()}>CZML</button>
            <button className="glass-button" style={{ fontSize: 10, flex: 1 }} onClick={() => ncInputRef.current?.click()}>NetCDF</button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="text" className="token-input" placeholder="Server file path for large .nc" value={importPath}
              onChange={e => setImportPath(e.target.value)}
              style={{ flex: 1, fontSize: 10, padding: '3px 6px' }} />
            <button className="glass-button" style={{ fontSize: 10, padding: '3px 10px', whiteSpace: 'nowrap' }}
              onClick={handleImportPath} disabled={importingPath}>
              {importingPath ? '...' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
