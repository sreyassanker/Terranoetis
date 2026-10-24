import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { Map, Sparkles } from 'lucide-react';
import type { StudyAreaItem } from '@/rendering/studyArea';
import {
  generateAreaId, loadGeoJsonToGlobe, removeStudyAreaFromGlobe,
  setStudyAreaVisibility, exportToGeoJSON, downloadJSON,
  parseFileToGeoJSON,
  flyToStudyAreaTopDown,
  updateStudyAreaStyle,
} from '@/rendering/studyArea';
import Panel from '@/components/ui/Panel';


type TabId = 'upload' | 'draw' | 'manage' | 'export';

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
  onClearResult?: () => void;
  onDeleteArea?: (item: StudyAreaItem) => void;
  zIndex?: number;
  isArchaeologyActive?: boolean;
  drawingStats?: StudyAreaDrawingStats | null;
}

export default React.memo(function StudyAreaPanel({
  viewer, areas, setAreas, show, onClose,
  onStartDraw, onStopDraw, drawing, setDrawing,
  activeStudyAreaId, onActivate,
  onClearResult, onDeleteArea,
  zIndex = 110,
  isArchaeologyActive = false,
  drawingStats = null,
}: StudyAreaPanelProps) {
  const [tab, setTab] = useState<TabId>('draw');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [drawShape, setDrawShape] = useState<'RECTANGLE' | 'POLYGON' | 'CIRCLE' | 'POINT' | null>(null);

  const activeArea = areas.find(a => a.id === activeStudyAreaId) || areas[0];

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
    setAreas(prev => {
      const next = prev.filter(a => a.id !== item.id);
      if (next.length === 0) {
        onClearResult?.();
      }
      return next;
    });
    if (item.id === activeStudyAreaId) {
      onActivate('');
      onClearResult?.();
    }
    onDeleteArea?.(item);
  }, [viewer, setAreas, activeStudyAreaId, onActivate, onClearResult, onDeleteArea]);

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
              <>
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

                {areas.length > 0 && (
                  <div style={{
                    marginTop: 12,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                      <span style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: activeArea?.color || '#22c55e',
                        flexShrink: 0,
                      }} />
                      <span style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#e2e8f0',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {activeArea?.name || `${areas.length} study area${areas.length > 1 ? 's' : ''}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      style={{
                        background: 'rgba(239, 68, 68, 0.12)',
                        border: '1px solid rgba(239, 68, 68, 0.45)',
                        color: '#f87171',
                        borderRadius: 4,
                        padding: '3px 10px',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                      onClick={() => {
                        if (activeArea) {
                          deleteArea(activeArea);
                        } else {
                          if (viewer) areas.forEach(a => removeStudyAreaFromGlobe(viewer, a));
                          setAreas([]);
                          onActivate('');
                          onClearResult?.();
                        }
                      }}
                      title="Clear shape from globe"
                    >
                      Clear Shape
                    </button>
                  </div>
                )}
              </>
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="study-section-title" style={{ margin: 0 }}>Study Areas ({areas.length})</div>
              {areas.length > 0 && (
                <button
                  type="button"
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#f87171',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontSize: 10,
                    cursor: 'pointer',
                    lineHeight: '16px',
                  }}
                  onClick={() => {
                    if (viewer) {
                      areas.forEach(a => removeStudyAreaFromGlobe(viewer, a));
                    }
                    setAreas([]);
                    onActivate('');
                    onClearResult?.();
                  }}
                  title="Remove all study areas and overlay results from globe"
                >
                  Clear All
                </button>
              )}
            </div>
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
