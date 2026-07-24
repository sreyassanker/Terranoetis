import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import * as Cesium from 'cesium';
import { Satellite, Globe, Calendar, Eye, Loader2, X } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { throttledRender } from '@/lib/throttledRender';
import {
  GIBS_PRODUCTS, EXTERNAL_DATA_SOURCES, GROUP_LABELS,
  groupProducts,
  loadGibsImageryForBbox,
  loadXyzImageryForBbox,
  loadWmsImageryForBbox,
  removeGibsImageryForStudyArea,
  updateGibsImageryOpacity,
} from '@/rendering/satelliteImagery';

interface Props {
  viewer: Cesium.Viewer | null;
  show: boolean;
  onClose: () => void;
  zIndex?: number;
}

export default React.memo(function SatelliteImageryPanel({ viewer, show, onClose, zIndex = 110 }: Props) {
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

  /* ── Bounding box state ── */
  const [bbox, setBbox] = useState({ latMin: 24, latMax: 49, lonMin: -125, lonMax: -66 });

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

  /* ── Satellite: load imagery ── */
  const handleLoadSatellite = useCallback(() => {
    if (!viewer) return;
    const sessionId = 'standalone';
    setSatLoading(true);
    setSatStatus('Loading satellite imagery...');
    removeGibsImageryForStudyArea(viewer, sessionId);
    if (activeSatLayerRef.current) activeSatLayerRef.current = null;
    const source = resolveSource(satProduct);
    if (source === 'gibs') {
      const product = GIBS_PRODUCTS.find(p => p.id === satProduct);
      if (!product) { setSatLoading(false); setSatStatus('Unknown product'); return; }
      const cc = satCloudCover < 100 ? satCloudCover : undefined;
      try {
        const imgLayer = loadGibsImageryForBbox(
          viewer, product.layer, bbox, satStartDate, satOpacity / 100, sessionId, cc,
        );
        activeSatLayerRef.current = imgLayer;
        throttledRender(viewer);
        const ccMsg = cc !== undefined ? ` · max cloud ${cc}%` : '';
        setSatStatus(`Loaded ${product.label} (${satStartDate} — ${satEndDate}${ccMsg})`);
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
          ? loadXyzImageryForBbox(viewer, resolvedUrl, bbox, satOpacity / 100, sessionId, src.id)
          : loadWmsImageryForBbox(viewer, resolvedUrl, src.layer || '', bbox, satOpacity / 100, sessionId, cc);
        activeSatLayerRef.current = imgLayer;
        throttledRender(viewer);
        const ccMsg = cc !== undefined && src.type !== 'xyz' ? ` · max cloud ${cc}%` : '';
        setSatStatus(`Loaded ${src.label}${ccMsg}`);
      } catch (err: unknown) {
        setSatStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setSatLoading(false);
  }, [viewer, satStartDate, satEndDate, satProduct, resolveSource, satOpacity, satCloudCover, sentinelHubKey, bbox]);

  /* ── Satellite: update opacity ── */
  const handleOpacityChange = useCallback((val: number) => {
    setSatOpacity(val);
    if (viewer) {
      updateGibsImageryOpacity(viewer, 'standalone', val / 100);
      throttledRender(viewer);
    }
  }, [viewer]);

  /* ── Satellite: remove imagery ── */
  const handleRemoveSatellite = useCallback(() => {
    if (viewer) {
      removeGibsImageryForStudyArea(viewer, 'standalone');
      activeSatLayerRef.current = null;
      throttledRender(viewer);
      setSatStatus('Satellite imagery removed');
    }
  }, [viewer]);

  const handleBboxChange = useCallback((field: string, value: number) => {
    setBbox(prev => ({ ...prev, [field]: value }));
  }, []);

  useEffect(() => {
    if (!show && viewer) {
      removeGibsImageryForStudyArea(viewer, 'standalone');
      activeSatLayerRef.current = null;
    }
  }, [show, viewer]);

  return (
    <div style={{ position: 'absolute', top: 60, right: 10, zIndex, width: 340, maxHeight: 'calc(100vh - 92px)', display: show ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
      <Panel title="SATELLITE IMAGERY" icon={<Satellite size={14} />} accentColor="#3b82f6" iconColor="#60a5fa" titleColor="#93c5fd" onClose={onClose}>
        <div style={{ padding: '8px 10px', overflowY: 'auto', flex: 1 }}>
          {/* Bounding Box Inputs */}
          <div className="study-section-title"><Globe size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Bounding Box</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 }}>
            {(['latMin', 'latMax', 'lonMin', 'lonMax'] as const).map(field => (
              <div key={field}>
                <label style={{ fontSize: 9, color: '#94a3b8', display: 'block', marginBottom: 2 }}>{field}</label>
                <input type="number" step="any" value={bbox[field]} onChange={e => handleBboxChange(field, Number(e.target.value))}
                  style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 4, padding: '3px 6px', color: '#e2e8f0', fontSize: 10 }} />
              </div>
            ))}
          </div>

          {/* Date Range */}
          <div className="study-section-title"><Calendar size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Date Range</div>
          <div className="sat-date-row" style={{ marginBottom: 8 }}>
            <div className="sat-date-group">
              <label className="sat-label">Start</label>
              <input type="date" className="sat-date-input" value={satStartDate} max={satEndDate}
                onChange={e => setSatStartDate(e.target.value)} />
            </div>
            <div className="sat-date-group">
              <label className="sat-label">End</label>
              <input type="date" className="sat-date-input" value={satEndDate} min={satStartDate}
                max={new Date().toISOString().slice(0, 10)} onChange={e => setSatEndDate(e.target.value)} />
            </div>
          </div>

          {/* Availability info */}
          <div className="sat-availability">
            {Object.entries(availabilityInfo.byCategory).map(([cat, count]) => (
              <span key={cat} className="sat-avail-chip">{cat} {count}</span>
            ))}
          </div>

          {/* Product Selector */}
          <div className="sat-product-section">
            <input type="text" className="sat-search-input" placeholder="Search products..." value={productSearch}
              onChange={e => setProductSearch(e.target.value.toLowerCase())} />
            <select className="sat-product-select" value={satProduct} onChange={e => handleSelectProduct(e.target.value)}>
              <option value="" disabled>Select a product...</option>
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

          {/* Cloud Cover */}
          <div className="sat-opacity-row">
            <label className="sat-label-row">
              <span>Max Cloud Cover</span>
              <span className="sat-opacity-value">{satCloudCover < 100 ? `${satCloudCover}%` : 'Any'}</span>
            </label>
            <input type="range" className="sat-opacity-slider" min={0} max={100} value={satCloudCover}
              onChange={e => setSatCloudCover(Number(e.target.value))} />
          </div>

          {/* Availability context */}
          <div className="sat-avail-msg" key={`${satStartDate}-${satEndDate}-${satProduct}`}>
            {(() => {
              const gibsP = GIBS_PRODUCTS.find(p => p.id === satProduct);
              if (gibsP) {
                if (gibsP.temporal) {
                  const startY = parseInt(satStartDate.slice(0, 4));
                  if (startY < 2000) return 'Temporal product — selected date may be before mission start (most GIBS data from 2000 onward)';
                  return 'Temporal product — data expected for the selected date range';
                }
                return 'Static product — date range not applied';
              }
              const extP = EXTERNAL_DATA_SOURCES.find(s => s.id === satProduct);
              if (extP) return 'Static external source — date range not applied';
              return '';
            })()}
          </div>

          {/* API Key */}
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
                      onChange={e => handleSaveKey(e.target.value)} />
                    <button className="study-btn primary sm" onClick={() => setShowKeyInput(false)}>Save</button>
                  </div>
                )}
                <div className="sat-key-hint">
                  Get a free key at sentinel-hub.com — enables Sentinel-1 SAR, Sentinel-2 bands, and custom processing.
                </div>
              </div>
            );
          })()}

          {/* Opacity */}
          <div className="sat-opacity-row">
            <label className="sat-label-row">
              <span>Opacity</span>
              <span className="sat-opacity-value">{satOpacity}%</span>
            </label>
            <input type="range" className="sat-opacity-slider" min={5} max={100} value={satOpacity}
              onChange={e => handleOpacityChange(Number(e.target.value))} />
          </div>

          {/* Action Buttons */}
          <div className="sat-action-row">
            <button className="study-btn primary sm" onClick={handleLoadSatellite} disabled={satLoading}>
              {satLoading ? <Loader2 size={10} style={{ marginRight: 4, animation: 'spin 1s linear infinite' }} /> : <Eye size={10} style={{ marginRight: 4 }} />}
              {satLoading ? 'Loading...' : 'Load'}
            </button>
            <button className="study-btn sm" onClick={handleRemoveSatellite} disabled={satLoading}>
              <X size={10} style={{ marginRight: 4 }} /> Clear
            </button>
          </div>

          {satStatus && (
            <div className="study-status" style={{ marginTop: 8 }}>{satStatus}</div>
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
        </div>
      </Panel>
    </div>
  );
});
