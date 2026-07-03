import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Cesium from 'cesium';
import type { StudyAreaItem } from '@/rendering/studyArea';
import {
  generateAreaId, loadGeoJsonToGlobe, removeStudyAreaFromGlobe,
  setStudyAreaVisibility, exportToGeoJSON, downloadJSON,
  parseFileToGeoJSON,
  flyToStudyAreaTopDown,
  updateStudyAreaStyle,
  computeStudyAreaBbox,
  GIBS_PRODUCTS,
  loadGibsImageryForBbox,
  loadXyzImageryForBbox,
  loadWmsImageryForBbox,
  removeGibsImageryForStudyArea,
  updateGibsImageryOpacity,
  EXTERNAL_DATA_SOURCES,
  GROUP_LABELS,
  groupProducts,
} from '@/rendering/studyArea';
import { throttledRender } from '@/lib/throttledRender';

type TabId = 'upload' | 'draw' | 'manage' | 'export' | 'satellite' | 'analysis';

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

  /* ── Satellite tab state ── */
  const [satStartDate, setSatStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [satEndDate, setSatEndDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [satProduct, setSatProduct] = useState('terra_true_color');
  const resolveSource = useCallback((id: string) => {
    if (GIBS_PRODUCTS.some(p => p.id === id)) return 'gibs';
    return 'external';
  }, []);
  const externalByGroup = useMemo(() => {
    const map: Record<string, typeof EXTERNAL_DATA_SOURCES> = {};
    for (const s of EXTERNAL_DATA_SOURCES) {
      const key = s.group || 'other';
      if (!map[key]) map[key] = [];
      map[key].push(s);
    }
    return map;
  }, []);
  const availabilityInfo = useMemo(() => {
    const byCategory: Record<string, number> = {};
    for (const p of GIBS_PRODUCTS) {
      const cat = GROUP_LABELS[p.group] || p.group;
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
    for (const s of EXTERNAL_DATA_SOURCES) {
      const cat = GROUP_LABELS[s.group] || s.group;
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
    return { byCategory };
  }, []);
  const [satOpacity, setSatOpacity] = useState(70);
  const [satCloudCover, setSatCloudCover] = useState(100);
  const [satLoading, setSatLoading] = useState(false);
  const [satStatus, setSatStatus] = useState('');
  const activeSatLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [sentinelHubKey, setSentinelHubKey] = useState(() => {
    try { return localStorage.getItem('sentinel_hub_api_key') || ''; } catch { return ''; }
  });
  const [showKeyInput, setShowKeyInput] = useState(false);

  const handleSelectProduct = useCallback((value: string) => {
    setSatProduct(value);
    if (!GIBS_PRODUCTS.some(p => p.id === value)) {
      const src = EXTERNAL_DATA_SOURCES.find(s => s.id === value);
      if (src?.url?.includes('{key}') && !sentinelHubKey) {
        setShowKeyInput(true);
      }
    }
  }, [sentinelHubKey]);

  const handleSaveKey = useCallback((key: string) => {
    setSentinelHubKey(key);
    try {
      if (key) {
        localStorage.setItem('sentinel_hub_api_key', key);
      } else {
        localStorage.removeItem('sentinel_hub_api_key');
      }
    } catch { /* ignore */ }
  }, []);

  /* ── Analysis tab state ── */
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [analysisType, setAnalysisType] = useState<string | null>(null);

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

  // Reset draw state when panel hides, and cleanup satellite layers
  useEffect(() => {
    if (!show && drawing) {
      setDrawing(false);
    }
    if (!show && viewer && activeStudyAreaId) {
      removeGibsImageryForStudyArea(viewer, activeStudyAreaId);
      activeSatLayerRef.current = null;
    }
  }, [show, drawing, setDrawing, viewer, activeStudyAreaId]);

  /* ── Satellite: load imagery for active study area ── */
  const handleLoadSatellite = useCallback(() => {
    if (!viewer) return;
    const active = areas.find(a => a.id === activeStudyAreaId);
    if (!active) { setSatStatus('No active study area — draw or select one first'); return; }
    const bbox = computeStudyAreaBbox(active);
    if (!bbox) { setSatStatus('Could not compute bounding box'); return; }
    setSatLoading(true);
    setSatStatus('Loading satellite imagery...');
    removeGibsImageryForStudyArea(viewer, active.id);
    if (activeSatLayerRef.current) activeSatLayerRef.current = null;
    const source = resolveSource(satProduct);
    if (source === 'gibs') {
      const product = GIBS_PRODUCTS.find(p => p.id === satProduct);
      if (!product) { setSatLoading(false); setSatStatus('Unknown product'); return; }
      const cc = satCloudCover < 100 ? satCloudCover : undefined;
      try {
        const imgLayer = loadGibsImageryForBbox(
          viewer, product.layer, bbox, satStartDate, satOpacity / 100, active.id, cc,
        );
        activeSatLayerRef.current = imgLayer;
        throttledRender(viewer);
        const ccMsg = cc !== undefined ? ` · max cloud ${cc}%` : '';
        setSatStatus(`Loaded ${product.label} for ${active.name} (${satStartDate} — ${satEndDate}${ccMsg})`);
      } catch (err: unknown) {
        setSatStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      const src = EXTERNAL_DATA_SOURCES.find(s => s.id === satProduct);
      if (!src) { setSatLoading(false); setSatStatus('Unknown external source'); return; }
      if (src.url.includes('{key}') && !sentinelHubKey) {
        setSatLoading(false);
        setSatStatus('Sentinel Hub API key required — enter it above to access SAR data');
        return;
      }
      const resolvedUrl = src.url.replace('{key}', sentinelHubKey);
      const cc = satCloudCover < 100 ? satCloudCover : undefined;
      try {
        const imgLayer = src.type === 'xyz'
          ? loadXyzImageryForBbox(viewer, resolvedUrl, bbox, satOpacity / 100, active.id, src.id)
          : loadWmsImageryForBbox(viewer, resolvedUrl, src.layer || '', bbox, satOpacity / 100, active.id, cc);
        activeSatLayerRef.current = imgLayer;
        throttledRender(viewer);
        const ccMsg = cc !== undefined && src.type !== 'xyz' ? ` · max cloud ${cc}%` : '';
        setSatStatus(`Loaded ${src.label} for ${active.name}${ccMsg}`);
      } catch (err: unknown) {
        setSatStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setSatLoading(false);
  }, [viewer, areas, activeStudyAreaId, satStartDate, satEndDate, satProduct, resolveSource, satOpacity, satCloudCover, sentinelHubKey]);

  /* ── Satellite: update opacity ── */
  const handleOpacityChange = useCallback((val: number) => {
    setSatOpacity(val);
    if (viewer && activeStudyAreaId) {
      updateGibsImageryOpacity(viewer, activeStudyAreaId, val / 100);
      throttledRender(viewer);
    }
  }, [viewer, activeStudyAreaId]);

  /* ── Satellite: remove imagery ── */
  const handleRemoveSatellite = useCallback(() => {
    if (viewer && activeStudyAreaId) {
      removeGibsImageryForStudyArea(viewer, activeStudyAreaId);
      activeSatLayerRef.current = null;
      throttledRender(viewer);
      setSatStatus('Satellite imagery removed');
    }
  }, [viewer, activeStudyAreaId]);

  /* ── Analysis: run processing on backend ── */
  const handleAnalysis = useCallback(async (type: string) => {
    const active = areas.find(a => a.id === activeStudyAreaId);
    if (!active) { setAnalysisResult('No active study area'); return; }
    const bbox = computeStudyAreaBbox(active);
    if (!bbox) { setAnalysisResult('Could not compute bounding box'); return; }
    setAnalysisLoading(true);
    setAnalysisType(type);
    setAnalysisResult(null);
    try {
      const res = await fetch('/api/satellite/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, bbox, date: satStartDate, startDate: satStartDate, endDate: satEndDate, studyAreaId: active.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${res.status} — ${JSON.stringify(body)}`);
      setAnalysisResult(body?.message || `${type.toUpperCase()} computed successfully`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      setAnalysisResult(`Error: ${msg}`);
    } finally {
      setAnalysisLoading(false);
      setAnalysisType(null);
    }
  }, [areas, activeStudyAreaId, satStartDate, satEndDate]);

  /* ── Clear stale status when switching areas ── */
  useEffect(() => {
    setSatStatus('');
    setAnalysisResult(null);
  }, [activeStudyAreaId]);

  /* ── Memoize bbox for the active study area ── */
  const activeArea = areas.find(a => a.id === activeStudyAreaId);
  const activeBbox = useMemo(() => activeArea ? computeStudyAreaBbox(activeArea) : null, [activeArea]);
  const hasActiveArea = Boolean(activeArea);

  const tabLabels: { id: TabId; label: string; }[] = [
    { id: 'upload', label: 'Upload' },
    { id: 'draw', label: 'Draw' },
    { id: 'manage', label: 'List' },
    { id: 'export', label: 'Export' },
    { id: 'satellite', label: 'Satellite' },
    { id: 'analysis', label: 'Analysis' },
  ];

  return (
    <div className={`study-area-panel glass-panel ${show ? 'open' : ''}`}>
      <div className="ai-header">
        <div className="ai-icon" style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)', fontSize: 11, fontFamily: 'monospace', fontWeight: 700 }}>SA</div>
        <div className="ai-title">Study Area</div>
        <button className="ai-close" onClick={onClose}>✕</button>
      </div>

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

        {/* ── Satellite Tab ── */}
        {tab === 'satellite' && (
          <div className="study-section">
            <div className="study-section-title">Satellite Imagery</div>

            {!hasActiveArea && (
              <div className="study-empty" style={{ marginBottom: 8 }}>
                Draw or select a study area first to load satellite data for that region.
              </div>
            )}

            {hasActiveArea && (
              <>
                <div className="sat-region-label">
                  {activeArea!.name} &middot; {activeBbox ? `${activeBbox.latMin.toFixed(1)}° – ${activeBbox.latMax.toFixed(1)}° lat` : '—'}
                </div>

                {/* Date Range */}
                <div className="sat-date-row">
                  <div className="sat-date-group">
                    <label className="sat-label">Start</label>
                    <input type="date" className="sat-date-input" value={satStartDate}
                      max={satEndDate}
                      onChange={e => setSatStartDate(e.target.value)}
                    />
                  </div>
                  <div className="sat-date-group">
                    <label className="sat-label">End</label>
                    <input type="date" className="sat-date-input" value={satEndDate}
                      min={satStartDate}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={e => setSatEndDate(e.target.value)}
                    />
                  </div>
                </div>

                {/* Availability info — per-category breakdown */}
                <div className="sat-availability">
                  {Object.entries(availabilityInfo.byCategory).map(([cat, count]) => (
                    <span key={cat} className="sat-avail-chip">{cat} {count}</span>
                  ))}
                </div>

                {/* Unified Product Selector */}
                <div className="sat-product-section">
                  <input type="text" className="sat-search-input" placeholder="Search products..." value={productSearch}
                    onChange={e => setProductSearch(e.target.value.toLowerCase())}
                  />
                  <select className="sat-product-select" value={satProduct}
                    onChange={e => handleSelectProduct(e.target.value)}
                  >
                    <option value="" disabled>Select a product...</option>
                    {/* GIBS products grouped by category */}
                    {Object.entries(groupProducts(GIBS_PRODUCTS)).map(([group, products]) => {
                      const filtered = productSearch ? products.filter(p => p.label.toLowerCase().includes(productSearch) || p.description.toLowerCase().includes(productSearch)) : products;
                      if (filtered.length === 0) return null;
                      return (
                        <optgroup key={`gibs-${group}`} label={`${GROUP_LABELS[group] || group} (${filtered.length})`}>
                          {filtered.map(p => (
                            <option key={p.id} value={p.id}>{p.label}{p.resolution ? `  [${p.resolution}]` : ''}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                    {/* External sources grouped by type */}
                    {Object.entries(externalByGroup).map(([group, sources]) => {
                      const filtered = productSearch ? sources.filter(s => s.label.toLowerCase().includes(productSearch) || s.description.toLowerCase().includes(productSearch)) : sources;
                      if (filtered.length === 0) return null;
                      const needsKey = (s: typeof EXTERNAL_DATA_SOURCES[0]) => s.url.includes('{key}') && !sentinelHubKey;
                      return (
                        <optgroup key={`ext-${group}`} label={`${GROUP_LABELS[group] || group} (${filtered.length})`}>
                          {filtered.map(src => (
                            <option key={src.id} value={src.id}>
                              {src.label}  [{src.resolution || '?'}]{needsKey(src) ? '  [key required]' : ''}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                  <div className="sat-product-meta">
                    {(() => {
                      const gibsP = GIBS_PRODUCTS.find(p => p.id === satProduct);
                      if (gibsP) {
                        const cat = GROUP_LABELS[gibsP.group] || gibsP.group;
                        return `${gibsP.label} · ${cat}${gibsP.resolution ? ` · ${gibsP.resolution}` : ''}${gibsP.temporal ? ' · temporal' : ' · static'}`;
                      }
                      const extP = EXTERNAL_DATA_SOURCES.find(s => s.id === satProduct);
                      if (extP) {
                        const cat = GROUP_LABELS[extP.group] || extP.group;
                        return `${extP.label} · ${cat} · ${extP.resolution || '?'}`;
                      }
                      return 'Select a product from the list above';
                    })()}
                  </div>
                </div>

                {/* Cloud Cover Filter */}
                <div className="sat-opacity-row">
                  <label className="sat-label-row">
                    <span>Max Cloud Cover</span>
                    <span className="sat-opacity-value">{satCloudCover < 100 ? `${satCloudCover}%` : 'Any'}</span>
                  </label>
                  <input type="range" className="sat-opacity-slider" min={0} max={100} value={satCloudCover}
                    onChange={e => setSatCloudCover(Number(e.target.value))}
                  />
                </div>

                {/* Data availability context */}
                <div className="sat-avail-msg" key={`${satStartDate}-${satEndDate}-${satProduct}`}>
                  {(() => {
                    const gibsP = GIBS_PRODUCTS.find(p => p.id === satProduct);
                    if (gibsP) {
                      if (gibsP.temporal) {
                        const startY = parseInt(satStartDate.slice(0, 4));
                        if (startY < 2000) {
                          return 'Temporal product — selected date may be before mission start (most GIBS data from 2000 onward)';
                        }
                        return 'Temporal product — data expected for the selected date range';
                      }
                      return 'Static product — date range not applied';
                    }
                    const extP = EXTERNAL_DATA_SOURCES.find(s => s.id === satProduct);
                    if (extP) return 'Static external source — date range not applied';
                    return '';
                  })()}
                </div>

                {/* Sentinel Hub API Key (shown when an external source requiring a key is selected) */}
                {(() => {
                  const selSrc = EXTERNAL_DATA_SOURCES.find(s => s.id === satProduct);
                  const needsKey = Boolean(selSrc?.url?.includes('{key}'));
                  if (!needsKey) return null;
                  return (
                    <div className={`sat-key-box ${sentinelHubKey ? 'configured' : 'pending'}`}>
                      <div className="sat-key-header">
                        <span className={`sat-key-status ${sentinelHubKey ? 'ok' : 'warn'}`}>
                          {sentinelHubKey ? 'API key configured' : 'API key required'}
                        </span>
                        <button className="sat-key-toggle" onClick={() => setShowKeyInput(!showKeyInput)}>
                          {showKeyInput ? 'Hide' : sentinelHubKey ? 'Change' : 'Enter'}
                        </button>
                      </div>
                      {(showKeyInput || !sentinelHubKey) && (
                        <div className="sat-key-input-row">
                          <input type="password" className="sat-key-input" placeholder="Enter your Sentinel Hub API key..." value={sentinelHubKey}
                            onChange={e => handleSaveKey(e.target.value)}
                          />
                          <button className="study-btn primary sm" onClick={() => setShowKeyInput(false)}>Save</button>
                        </div>
                      )}
                      <div className="sat-key-hint">
                        Get a free key at sentinel-hub.com — enables Sentinel-1 SAR, Sentinel-2 bands, and custom processing.
                      </div>
                    </div>
                  );
                })()}

                {/* Opacity Slider */}
                <div className="sat-opacity-row">
                  <label className="sat-label-row">
                    <span>Opacity</span>
                    <span className="sat-opacity-value">{satOpacity}%</span>
                  </label>
                  <input type="range" className="sat-opacity-slider" min={5} max={100} value={satOpacity}
                    onChange={e => handleOpacityChange(Number(e.target.value))}
                  />
                </div>

                {/* Action Buttons */}
                <div className="sat-action-row">
                  <button className="study-btn primary sm" onClick={handleLoadSatellite}
                    disabled={satLoading || !hasActiveArea}>
                    {satLoading ? 'Loading...' : 'Load'}
                  </button>
                  <button className="study-btn sm" onClick={handleRemoveSatellite}
                    disabled={!hasActiveArea || satLoading}>
                    Clear
                  </button>
                </div>

                {satStatus && (
                  <div className="study-status" style={{ marginTop: 8 }}>
                    {satStatus}
                  </div>
                )}

                {/* Quick select chips */}
                <div className="sat-quick-row">
                  <div className="sat-quick-label">Quick Select</div>
                  <div className="sat-quick-chips">
                    {[{ id: 'terra_true_color' }, { id: 'terra_false_721' }, { id: 'viirs_fires' }, { id: 'terra_ndvi' }, { id: 'tropomi_no2' }, { id: 'esa_worldcover_2021' }, { id: 'eox_s2_cloudless' }, { id: 'esri_imagery' }].map(chip => {
                      const isActive = satProduct === chip.id;
                      const chipLabel = GIBS_PRODUCTS.find(p => p.id === chip.id)?.label
                        || EXTERNAL_DATA_SOURCES.find(s => s.id === chip.id)?.label
                        || chip.id;
                      return (
                        <button key={chip.id} className={`sat-chip ${isActive ? 'active' : ''}`}
                          onClick={() => handleSelectProduct(chip.id)}>
                          {chipLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Analysis Tab ── */}
        {tab === 'analysis' && (
          <div className="study-section">
            <div className="study-section-title">Region Analysis</div>

            {!hasActiveArea && (
              <div className="study-empty" style={{ marginBottom: 8 }}>
                Draw or select a study area first to run analysis on that region.
              </div>
            )}

            {hasActiveArea && (
              <>
                <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 8, fontFamily: 'monospace' }}>
                  Region: {activeArea!.name} | {satStartDate} — {satEndDate}
                </div>

                {/* Analysis buttons grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                  <button className="study-draw-btn" onClick={() => handleAnalysis('ndvi')}
                    disabled={analysisLoading} style={{ fontSize: 10 }}>
                    <span className="study-draw-icon">ND</span>
                    <span>{analysisType === 'ndvi' ? '...' : 'NDVI'}</span>
                  </button>
                  <button className="study-draw-btn" onClick={() => handleAnalysis('ndwi')}
                    disabled={analysisLoading} style={{ fontSize: 10 }}>
                    <span className="study-draw-icon">NW</span>
                    <span>{analysisType === 'ndwi' ? '...' : 'NDWI'}</span>
                  </button>
                  <button className="study-draw-btn" onClick={() => handleAnalysis('cloud_mask')}
                    disabled={analysisLoading} style={{ fontSize: 10 }}>
                    <span className="study-draw-icon">CM</span>
                    <span>{analysisType === 'cloud_mask' ? '...' : 'Cloud'}</span>
                  </button>
                  <button className="study-draw-btn" onClick={() => handleAnalysis('land_cover')}
                    disabled={analysisLoading} style={{ fontSize: 10 }}>
                    <span className="study-draw-icon">LC</span>
                    <span>{analysisType === 'land_cover' ? '...' : 'Land Cover'}</span>
                  </button>
                </div>

                {/* Processing status */}
                {analysisLoading && (
                  <div style={{
                    padding: '8px 10px', borderRadius: 6, marginBottom: 8,
                    background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)',
                    fontSize: 10, color: '#6ee7b7', fontFamily: 'monospace',
                  }}>
                    Processing {analysisType?.toUpperCase()} for {activeArea!.name}...
                  </div>
                )}

                {/* Result */}
                {analysisResult && !analysisLoading && (
                  <div style={{
                    padding: '8px 10px', borderRadius: 6, marginBottom: 8,
                    background: analysisResult.startsWith('Error') ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)',
                    border: `1px solid ${analysisResult.startsWith('Error') ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)'}`,
                    fontSize: 10, color: analysisResult.startsWith('Error') ? '#ef4444' : '#6ee7b7',
                    fontFamily: 'monospace',
                  }}>
                    {analysisResult}
                  </div>
                )}

                {/* Info */}
                <div style={{
                  padding: '6px 8px', borderRadius: 4, marginTop: 6,
                  background: 'rgba(0,0,0,0.2)', fontSize: 8, color: '#64748b',
                  lineHeight: 1.5, fontFamily: 'monospace',
                }}>
                  <strong>NDVI</strong> — Normalized Difference Vegetation Index (vegetation health).<br />
                  <strong>NDWI</strong> — Normalized Difference Water Index (water body detection).<br />
                  <strong>Cloud Mask</strong> — Identifies cloud-covered pixels in satellite imagery.<br />
                  <strong>Land Cover</strong> — Classifies surface types (urban, forest, water, etc.).<br /><br />
                  Each analysis fetches the selected date range from the satellite product loaded on the globe and processes it server-side. The [object Object] error occurs when the server returns an unexpected response format — the error display now handles this properly.
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
});
