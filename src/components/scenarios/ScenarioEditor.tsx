import { useState, useCallback, useEffect } from 'react';

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
  onGenerate: (type: string, params: Record<string, unknown>) => void;
}

export default function ScenarioEditor({ onClose, onGenerate }: ScenarioEditorProps) {
  const [scenarioType, setScenarioType] = useState('earthquake_swarm');
  const [params, setParams] = useState<Record<string, number>>(() => {
    const p: Record<string, number> = {};
    for (const param of PARAMETERS) p[param.key] = param.defaultValue;
    return p;
  });
  const [location, setLocation] = useState({ lat: 19, lon: 72 });
  const [autoPreview, setAutoPreview] = useState(true);
  const [previewToken, setPreviewToken] = useState(0);

  const updateParam = useCallback((key: string, value: number) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const applyPreset = useCallback((preset: ScenarioPreset) => {
    setScenarioType(preset.type);
    setParams(prev => ({ ...prev, ...preset.params }));
  }, []);

  const handleGenerate = useCallback(() => {
    onGenerate(scenarioType, { ...params, lat: location.lat, lon: location.lon });
  }, [scenarioType, params, location, onGenerate]);

  useEffect(() => {
    if (autoPreview) {
      const timer = setTimeout(() => setPreviewToken(t => t + 1), 500);
      return () => clearTimeout(timer);
    }
  }, [autoPreview, params, scenarioType]);

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

        {/* Location */}
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>Latitude</div>
            <input type="number" className="token-input" value={location.lat}
              onChange={e => setLocation(prev => ({ ...prev, lat: Number(e.target.value) }))}
              style={{ width: '100%', fontSize: 11 }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>Longitude</div>
            <input type="number" className="token-input" value={location.lon}
              onChange={e => setLocation(prev => ({ ...prev, lon: Number(e.target.value) }))}
              style={{ width: '100%', fontSize: 11 }} />
          </div>
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

        {/* Auto Preview Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Auto Preview</span>
          <label className="switch">
            <input type="checkbox" checked={autoPreview} onChange={() => setAutoPreview(!autoPreview)} />
            <span className="slider" />
          </label>
        </div>

        {/* Generate Button */}
        <button className="glass-button" style={{
          fontSize: 12, padding: '8px 16px', background: 'rgba(59,130,246,0.2)',
          border: '1px solid rgba(59,130,246,0.3)', fontWeight: 600,
        }} onClick={handleGenerate}>
          Generate Scenario
        </button>

        {/* Export */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', gap: 6 }}>
          <button className="glass-button" style={{ fontSize: 10, flex: 1 }}>GeoJSON</button>
          <button className="glass-button" style={{ fontSize: 10, flex: 1 }}>CZML</button>
          <button className="glass-button" style={{ fontSize: 10, flex: 1 }}>NetCDF</button>
        </div>
      </div>
    </div>
  );
}
