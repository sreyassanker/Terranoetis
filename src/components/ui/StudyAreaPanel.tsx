import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { Map, Satellite, Droplets, Flame, Sparkles, Loader2, CheckCircle2, AlertCircle, Landmark } from 'lucide-react';
import type { StudyAreaItem } from '@/rendering/studyArea';
import {
  generateAreaId, loadGeoJsonToGlobe, removeStudyAreaFromGlobe,
  setStudyAreaVisibility, exportToGeoJSON, downloadJSON,
  parseFileToGeoJSON,
  flyToStudyAreaTopDown,
  updateStudyAreaStyle,
  computeStudyAreaBbox,
} from '@/rendering/studyArea';
import { renderArchaeologyAnomaliesOnGlobe } from '@/rendering/archaeologyOverlay';
import Panel from '@/components/ui/Panel';
import { authHeaders } from '@/context/AuthContext';


type TabId = 'upload' | 'draw' | 'manage' | 'analyze' | 'export';

export interface StudyAreaDrawingStats {
  areaKm2: number;
  status: 'optimal' | 'coarse' | 'exceeds';
}

interface StudyAreaPanelProps {
  viewer: Cesium.Viewer | null;
  areas: StudyAreaItem[];
  setAreas: React.Dispatch<React.SetStateAction<StudyAreaItem[]>>;
  show: boolean;
  onClose: () => void;
  onStartDraw: (type: 'RECTANGLE' | 'POLYGON' | 'CIRCLE' | 'POINT') => void;
  onStopDraw: () => void;
  drawing: boolean;
  setDrawing: React.Dispatch<React.SetStateAction<boolean>>;
  activeStudyAreaId: string | null;
  onActivate: (id: string) => void;
  zIndex?: number;
  isArchaeologyActive?: boolean;
  drawingStats?: StudyAreaDrawingStats | null;
}

export default React.memo(function StudyAreaPanel({
  viewer, areas, setAreas, show, onClose,
  onStartDraw, onStopDraw, drawing, setDrawing,
  activeStudyAreaId, onActivate, zIndex = 110,
  isArchaeologyActive = false,
  drawingStats = null,
}: StudyAreaPanelProps) {
  const [tab, setTab] = useState<TabId>('draw');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [drawShape, setDrawShape] = useState<'RECTANGLE' | 'POLYGON' | 'CIRCLE' | 'POINT' | null>(null);

  // Satellite Raster Analysis states
  const [analyzing, setAnalyzing] = useState(false);
  const [activeAnalysisType, setActiveAnalysisType] = useState<'observation' | 'flood' | 'fire' | 'vision' | 'archaeology' | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const activeArea = areas.find(a => a.id === activeStudyAreaId) || areas[0];
  const activeBbox = activeArea ? computeStudyAreaBbox(activeArea) : null;
  const centerLat = activeBbox ? (activeBbox.latMin + activeBbox.latMax) / 2 : null;
  const centerLon = activeBbox ? (activeBbox.lonMin + activeBbox.lonMax) / 2 : null;

  const runAnalysis = async (type: 'observation' | 'flood' | 'fire' | 'vision' | 'archaeology') => {
    if (centerLat === null || centerLon === null || !activeBbox) {
      setAnalysisError('Please select or draw a valid study area with coordinates');
      return;
    }

    setAnalyzing(true);
    setActiveAnalysisType(type);
    setAnalysisError(null);
    setAnalysisResult(null);

    try {
      let endpoint = '/api/multimodal/satellite/analyze';
      let body: Record<string, unknown> = { lat: centerLat, lon: centerLon, radiusKm: 10 };

      if (type === 'flood') {
        endpoint = '/api/multimodal/satellite/flood-extent';
        body = { lat: centerLat, lon: centerLon };
      } else if (type === 'fire') {
        endpoint = '/api/multimodal/satellite/fire-scars';
        body = { lat: centerLat, lon: centerLon };
      } else if (type === 'vision') {
        endpoint = '/api/multimodal/satellite/interpret';
        body = { lat: centerLat, lon: centerLon };
      } else if (type === 'archaeology') {
        endpoint = '/api/archaeology/scan';
        body = {
          studyArea: {
            latMin: activeBbox.latMin,
            latMax: activeBbox.latMax,
            lonMin: activeBbox.lonMin,
            lonMax: activeBbox.lonMax,
          },
        };
      }

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

      if (type === 'archaeology' && data.anomalies) {
        if (viewer) {
          renderArchaeologyAnomaliesOnGlobe(viewer, data.anomalies, activeBbox);
          // Frame the camera smoothly over the study area
          const padLon = (activeBbox.lonMax - activeBbox.lonMin) * 0.20;
          const padLat = (activeBbox.latMax - activeBbox.latMin) * 0.20;
          viewer.camera.flyTo({
            destination: Cesium.Rectangle.fromDegrees(
              activeBbox.lonMin - padLon,
              activeBbox.latMin - padLat,
              activeBbox.lonMax + padLon,
              activeBbox.latMax + padLat,
            ),
            duration: 1.5,
          });
        }
        setAnalysisResult({
          interpretation: data.anomalies.length > 0
            ? `Space Archaeology Multi-Sensor Prospection Complete.\nEvaluated ${data.sensorMetrics?.pointsEvaluated || 250} grid points across ${data.studyAreaKm2} km² study area.\nIdentified ${data.anomalies.length} high-confidence archaeological feature(s) displayed on 3D globe.`
            : `Space Archaeology Prospection Complete: 0 anomalies detected.\n${data.statusMessage || 'Terrain confirmed clear across multi-spectral, radar backscatter, and elevation models.'}`,
          archaeology: data,
        });
        return;
      }

      setAnalysisResult(data);
    } catch (err: unknown) {
      setAnalysisError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !viewer) return;
    setUploadStatus(`Reading ${file.name}...`);
    try {
      const results = await parseFileToGeoJSON(file);
      const newAreas: StudyAreaItem[] = [];
      for (const { name, geojson, format } of results) {
        const ds = await loadGeoJsonToGlobe(viewer, geojson, name, '#22c55e');
        const area: StudyAreaItem = {
          id: generateAreaId(), name, type: format === 'shapefile' ? 'shapefile' : 'geojson',
          visible: true, active: false, dataSource: ds, geojson, color: '#22c55e', width: 3,
        };
        updateStudyAreaStyle(viewer, area, '#22c55e', 3);
        newAreas.push(area);
        flyToStudyAreaTopDown(viewer, area);
      }
      setAreas(prev => [...prev, ...newAreas]);
      if (newAreas.length > 0) onActivate(newAreas[0].id);
      const totalFeatures = results.reduce((s, r) => s + r.geojson.features.length, 0);
      const names = results.map(r => r.name).join(', ');
      setUploadStatus(`Loaded ${totalFeatures} features from ${names}`);
    } catch (err: unknown) {
      setUploadStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [viewer, setAreas, onActivate]);

  const toggleVisibility = useCallback((id: string) => {
    setAreas(prev => prev.map(a => {
      if (a.id !== id) return a;
      const v = !a.visible;
      if (viewer) setStudyAreaVisibility(viewer, a, v);
      return { ...a, visible: v };
    }));
  }, [viewer, setAreas]);

  const deleteArea = useCallback((item: StudyAreaItem) => {
    if (viewer) removeStudyAreaFromGlobe(viewer, item);
    setAreas(prev => prev.filter(a => a.id !== item.id));
    if (item.id === activeStudyAreaId) onActivate('');
  }, [viewer, setAreas, activeStudyAreaId, onActivate]);

  const handleExport = useCallback(() => {
    const geojson = exportToGeoJSON(areas);
    if (geojson.features.length === 0) { setUploadStatus('No areas to export'); return; }
    downloadJSON(geojson, 'study_areas.geojson');
    setUploadStatus(`Exported ${geojson.features.length} features`);
  }, [areas]);

  const handleDrawStart = useCallback((type: 'RECTANGLE' | 'POLYGON' | 'CIRCLE' | 'POINT') => {
    setDrawShape(type);
    onStartDraw(type);
    setDrawing(true);
  }, [onStartDraw, setDrawing]);

  const handleDrawStop = useCallback(() => {
    setDrawShape(null);
    onStopDraw();
    setDrawing(false);
  }, [onStopDraw, setDrawing]);

  // Reset draw state when panel hides
  useEffect(() => {
    if (!show && drawing) {
      setDrawing(false);
    }
  }, [show, drawing, setDrawing]);



  const tabLabels: { id: TabId; label: string; }[] = [
    { id: 'upload', label: 'Upload' },
    { id: 'draw', label: 'Draw' },
    { id: 'manage', label: 'List' },
    { id: 'analyze', label: 'Analyze' },
    { id: 'export', label: 'Export' },
  ];

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex, width: 340, maxHeight: 'calc(100vh - 92px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Panel
        title="STUDY AREA"
        icon={<Map size={14} />}
        accentColor="#22c55e"
        iconColor="#34d399"
        titleColor="#6ee7b7"
        onClose={onClose}
      >

      <div className="study-tabs">
        {tabLabels.map(t => (
          <button key={t.id} className={`study-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="study-panel-body">

        {tab === 'upload' && (
          <div className="study-section">
            <div className="study-section-title">Upload GeoJSON or Shapefile</div>
            <div className="study-dropzone" onClick={() => fileInputRef.current?.click()}>
              <div className="study-dropzone-icon">+</div>
              <div className="study-dropzone-text">Click to select file</div>
              <div className="study-dropzone-hint">.geojson, .json, .zip (shapefile), .shp</div>
            </div>
            <input ref={fileInputRef} type="file" accept=".geojson,.json,.zip,.shp" style={{ display: 'none' }} onChange={handleFileUpload} />
            {uploadStatus && <div className="study-status">{uploadStatus}</div>}
          </div>
        )}

        {tab === 'draw' && (
          <div className="study-section">
            <div className="study-section-title">Draw on Globe</div>

            {isArchaeologyActive && !drawing && (
              <div style={{
                marginBottom: 10,
                padding: '8px 10px',
                borderRadius: 6,
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                color: '#93c5fd',
                lineHeight: 1.4,
              }}>
                <Sparkles size={14} color="#38bdf8" style={{ flexShrink: 0 }} />
                <span>
                  <strong>Archaeology Target:</strong> 1 to 10 km² is optimal (10–25 km² coarse). Exceeding 25 km² is restricted.
                </span>
              </div>
            )}

            {!drawing ? (
              <div className="study-draw-grid">
                <button className="study-draw-btn" onClick={() => handleDrawStart('POINT')}>
                  <span className="study-draw-icon">•</span>
                  <span>Point</span>
                </button>
                <button className="study-draw-btn" onClick={() => handleDrawStart('RECTANGLE')}>
                  <span className="study-draw-icon">▭</span>
                  <span>Rectangle</span>
                </button>
                <button className="study-draw-btn" onClick={() => handleDrawStart('POLYGON')}>
                  <span className="study-draw-icon">⬠</span>
                  <span>Polygon</span>
                </button>
                <button className="study-draw-btn" onClick={() => handleDrawStart('CIRCLE')}>
                  <span className="study-draw-icon">○</span>
                  <span>Circle</span>
                </button>
              </div>
            ) : (
              <div className="study-draw-active">
                <div className="study-draw-status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span>Drawing {(drawShape ?? 'shape').toLowerCase()}...</span>
                  {drawingStats && (
                    <span style={{
                      fontSize: 11,
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: drawingStats.status === 'optimal'
                        ? 'rgba(16,185,129,0.2)'
                        : drawingStats.status === 'coarse'
                        ? 'rgba(245,158,11,0.2)'
                        : 'rgba(239,68,68,0.2)',
                      color: drawingStats.status === 'optimal'
                        ? '#34d399'
                        : drawingStats.status === 'coarse'
                        ? '#fbbf24'
                        : '#f87171',
                      border: `1px solid ${
                        drawingStats.status === 'optimal'
                          ? 'rgba(16,185,129,0.5)'
                          : drawingStats.status === 'coarse'
                          ? 'rgba(245,158,11,0.5)'
                          : 'rgba(239,68,68,0.5)'
                      }`,
                    }}>
                      {drawingStats.areaKm2 < 1 ? drawingStats.areaKm2.toFixed(2) : drawingStats.areaKm2.toFixed(1)} km²
                    </span>
                  )}
                </div>

                <div className="study-draw-hint" style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: isArchaeologyActive
                    ? (drawingStats?.status === 'optimal'
                        ? '#34d399'
                        : drawingStats?.status === 'coarse'
                        ? '#fbbf24'
                        : drawingStats?.status === 'exceeds'
                        ? '#f87171'
                        : '#38bdf8')
                    : undefined,
                }}>
                  {isArchaeologyActive ? (
                    drawingStats ? (
                      drawingStats.status === 'optimal' ? (
                        '● Optimal range (1–10 km²) · Double-click to finish'
                      ) : drawingStats.status === 'coarse' ? (
                        '▲ Coarse resolution (10–25 km²) · Double-click to finish'
                      ) : (
                        '✖ Beyond limit (> 25 km²) · Shrink area to scan'
                      )
                    ) : (
                      'Optimal: 1 – 10 km² · Limit: Max 25 km² · Click to place'
                    )
                  ) : (
                    drawingStats
                      ? `${drawingStats.areaKm2 < 1 ? drawingStats.areaKm2.toFixed(2) : drawingStats.areaKm2.toFixed(1)} km² · Double-click to finish`
                      : 'Click to place vertices · Double-click to finish'
                  )}
                </div>
                <button className="study-btn danger" onClick={handleDrawStop}>Cancel</button>
              </div>
            )}
          </div>
        )}

        {tab === 'manage' && (
          <div className="study-section">
            <div className="study-section-title">Study Areas ({areas.length})</div>
            {areas.length === 0 ? (
              <div className="study-empty">No study areas yet. Upload or draw one.</div>
            ) : (
              <div className="study-list">
                {areas.map(a => {
                  const isActive = a.id === activeStudyAreaId;
                  return (
                    <div key={a.id} className={`study-list-item ${isActive ? 'active' : 'inactive'}`}
                      onClick={() => { if (!isActive) onActivate(a.id); }}
                      style={{ cursor: 'pointer', opacity: isActive ? 1 : 0.5 }}>
                      <input type="color" className="study-list-color-picker"
                        value={a.color}
                        onChange={e => {
                          const nc = e.target.value;
                          e.stopPropagation();
                          setAreas((prev: StudyAreaItem[]) => prev.map(area =>
                            area.id === a.id ? { ...area, color: nc } : area
                          ));
                          if (viewer) updateStudyAreaStyle(viewer, a, nc, a.width);
                        }}
                        title="Change outline color" />
                      <div className="study-list-info">
                        <div className="study-list-name">{a.name}</div>
                        <div className="study-list-type">{a.type}</div>
                      </div>
                      {isActive && <span className="study-active-badge">Active</span>}
                      <div className="study-list-width-wrap">
                        <input type="number" className="study-list-width-input"
                          min={0.2} max={10} step={0.2}
                          value={a.width}
                          onClick={e => e.stopPropagation()}
                          onChange={e => {
                            const nw = Math.max(0.2, Math.min(10, parseFloat(e.target.value) || 0.2));
                            setAreas((prev: StudyAreaItem[]) => prev.map(area =>
                              area.id === a.id ? { ...area, width: nw } : area
                            ));
                            if (viewer) updateStudyAreaStyle(viewer, a, a.color, nw);
                          }}
                          title="Outline width (pt)" />
                        <span className="study-list-width-label">pt</span>
                      </div>
                      <button className={`study-list-btn ${a.visible ? '' : 'muted'}`}
                        onClick={e => { e.stopPropagation(); toggleVisibility(a.id); }} title={a.visible ? 'Hide' : 'Show'}>
                        {a.visible ? '⊙' : '◌'}
                      </button>
                      <button className="study-list-btn" onClick={e => {
                        e.stopPropagation();
                        if (viewer) flyToStudyAreaTopDown(viewer, a);
                      }} title="Fly to">⌖</button>
                      <button className="study-list-btn delete" onClick={e => {
                        e.stopPropagation();
                        deleteArea(a);
                      }} title="Delete">✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'analyze' && (
          <div className="study-section">
            <div className="study-section-title">Satellite Raster Analysis</div>

            {!activeArea ? (
              <div className="study-empty">
                No active study area. Upload or draw a study area to run multimodal satellite analysis.
              </div>
            ) : (
              <div>
                <div style={{
                  padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border)', marginBottom: 8, fontSize: 10,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>{activeArea.name}</span>
                    <span style={{ color: 'var(--accent)' }}>Active</span>
                  </div>
                  {centerLat !== null && centerLon !== null && (
                    <div style={{ color: 'var(--text-dim)', fontSize: 9 }}>
                      Center: {centerLat.toFixed(4)}°, {centerLon.toFixed(4)}°
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                  <button
                    className="study-btn"
                    disabled={analyzing}
                    onClick={() => runAnalysis('observation')}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      padding: '8px 4px', fontSize: 9, cursor: 'pointer',
                      background: activeAnalysisType === 'observation' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)',
                    }}
                  >
                    <Satellite size={14} color="#38bdf8" />
                    <span>Sentinel-2 NDVI</span>
                  </button>

                  <button
                    className="study-btn"
                    disabled={analyzing}
                    onClick={() => runAnalysis('flood')}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      padding: '8px 4px', fontSize: 9, cursor: 'pointer',
                      background: activeAnalysisType === 'flood' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)',
                    }}
                  >
                    <Droplets size={14} color="#60a5fa" />
                    <span>Flood Extent</span>
                  </button>

                  <button
                    className="study-btn"
                    disabled={analyzing}
                    onClick={() => runAnalysis('fire')}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      padding: '8px 4px', fontSize: 9, cursor: 'pointer',
                      background: activeAnalysisType === 'fire' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)',
                    }}
                  >
                    <Flame size={14} color="#f97316" />
                    <span>Burn Scars</span>
                  </button>

                  <button
                    className="study-btn"
                    disabled={analyzing}
                    onClick={() => runAnalysis('vision')}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      padding: '8px 4px', fontSize: 9, cursor: 'pointer',
                      background: activeAnalysisType === 'vision' ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)',
                    }}
                  >
                    <Sparkles size={14} color="#c084fc" />
                    <span>AI Vision Scene</span>
                  </button>

                  <button
                    className="study-btn"
                    disabled={analyzing}
                    onClick={() => runAnalysis('archaeology')}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '8px 6px', fontSize: 10, cursor: 'pointer',
                      background: activeAnalysisType === 'archaeology' ? 'rgba(245,158,11,0.25)' : 'rgba(245,158,11,0.08)',
                      border: '1px solid rgba(251,191,36,0.4)', borderRadius: 6, color: '#fde68a',
                      gridColumn: 'span 2',
                      fontWeight: 600,
                    }}
                  >
                    <Landmark size={14} color="#fbbf24" />
                    <span>Space Archaeology Prospection (Sentinel + SAR + DEM)</span>
                  </button>
                </div>

                {analyzing && (
                  <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 12, fontSize: 10 }}>
                    <Loader2 size={16} className="spin" style={{ margin: '0 auto 6px' }} />
                    Querying Copernicus Sentinel-2 / Vision processing...
                  </div>
                )}

                {analysisError && (
                  <div style={{ color: '#ef4444', fontSize: 9, padding: 6, background: 'rgba(239,68,68,0.1)', borderRadius: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
                    <AlertCircle size={12} /> {analysisError}
                  </div>
                )}

                {analysisResult && !analyzing && (
                  <div style={{
                    padding: 8, borderRadius: 6, background: 'rgba(0,0,0,0.3)',
                    border: '1px solid var(--border)', fontSize: 9, color: 'var(--text-dim)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#34d399', fontWeight: 600, marginBottom: 4 }}>
                      <CheckCircle2 size={12} /> Analysis Complete
                    </div>

                    {analysisResult.interpretation && (
                      <div style={{ color: 'var(--text)', lineHeight: 1.4, marginBottom: 4, whiteSpace: 'pre-wrap' }}>
                        {analysisResult.interpretation}
                      </div>
                    )}

                    {analysisResult.ndvi !== undefined && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span>NDVI Mean:</span>
                        <span style={{ color: '#38bdf8', fontWeight: 600 }}>{analysisResult.ndvi.toFixed(3)}</span>
                      </div>
                    )}

                    {analysisResult.cloudCover !== undefined && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span>Cloud Cover:</span>
                        <span>{analysisResult.cloudCover}%</span>
                      </div>
                    )}

                    {analysisResult.waterFraction !== undefined && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span>Water Fraction:</span>
                        <span style={{ color: '#60a5fa', fontWeight: 600 }}>{(analysisResult.waterFraction * 100).toFixed(1)}%</span>
                      </div>
                    )}

                    {analysisResult.flooded !== undefined && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span>Inundation Status:</span>
                        <span style={{ color: analysisResult.flooded ? '#ef4444' : '#10b981', fontWeight: 600 }}>
                          {analysisResult.flooded ? 'Active Flood Detected' : 'Normal Surface Water'}
                        </span>
                      </div>
                    )}

                    {analysisResult.scarDetected !== undefined && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span>Burn Scar Detected:</span>
                        <span style={{ color: analysisResult.scarDetected ? '#ef4444' : '#10b981', fontWeight: 600 }}>
                          {analysisResult.scarDetected ? 'Yes' : 'None Detected'}
                        </span>
                      </div>
                    )}

                    {analysisResult.severity && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span>Burn Severity:</span>
                        <span style={{ textTransform: 'capitalize' }}>{analysisResult.severity}</span>
                      </div>
                    )}

                    {analysisResult.source && (
                      <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border)', fontSize: 8, color: 'var(--text-muted)' }}>
                        Sensor: {analysisResult.source}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'export' && (
          <div className="study-section">
            <div className="study-section-title">Export Study Areas</div>
            <div className="study-export-info">
              Exports all study areas as a single GeoJSON FeatureCollection.
            </div>
            <button className="study-btn primary" onClick={handleExport} style={{ width: '100%', marginTop: 8 }}>
              Download GeoJSON
            </button>
            {uploadStatus && <div className="study-status">{uploadStatus}</div>}
          </div>
        )}



      </div>
    </Panel>
    </div>
  );
});
