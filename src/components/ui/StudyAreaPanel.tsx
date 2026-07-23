import React, { useCallback, useEffect, useRef, useState } from 'react';
import type Cesium from 'cesium';
import { Map } from 'lucide-react';
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

interface StudyAreaPanelProps {
  viewer: Cesium.Viewer | null;
  areas: StudyAreaItem[];
  setAreas: React.Dispatch<React.SetStateAction<StudyAreaItem[]>>;
  show: boolean;
  onClose: () => void;
  onStartDraw: (type: 'RECTANGLE' | 'POLYGON' | 'CIRCLE') => void;
  onStopDraw: () => void;
  drawing: boolean;
  setDrawing: React.Dispatch<React.SetStateAction<boolean>>;
  activeStudyAreaId: string | null;
  onActivate: (id: string) => void;
}

export default React.memo(function StudyAreaPanel({
  viewer, areas, setAreas, show, onClose,
  onStartDraw, onStopDraw, drawing, setDrawing,
  activeStudyAreaId, onActivate,
}: StudyAreaPanelProps) {
  const [tab, setTab] = useState<TabId>('draw');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [drawShape, setDrawShape] = useState<'RECTANGLE' | 'POLYGON' | 'CIRCLE' | null>(null);

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

  const handleDrawStart = useCallback((type: 'RECTANGLE' | 'POLYGON' | 'CIRCLE') => {
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
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex: 110, width: 340, maxHeight: 'calc(100vh - 92px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
            {!drawing ? (
              <div className="study-draw-grid">
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
                <div className="study-draw-status">Drawing {(drawShape ?? 'shape').toLowerCase()}...</div>
                <div className="study-draw-hint">Click to place vertices · Double-click to finish</div>
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
