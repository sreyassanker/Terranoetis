/**
 * KaggleHurricaneOverlay
 *
 * Fetches wind_speed.npy, surge_height.npy, and rainfall.npy from Kaggle
 * simulation results and renders them as colored imagery overlays on the 3D globe.
 *
 * - Red = high wind speed
 * - Blue = high surge
 * - Blue = high rainfall
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import * as Cesium from 'cesium';
import { X } from 'lucide-react';

// Wind speed colormap: blue → red
const WIND_COLORMAP: { stop: number; r: number; g: number; b: number }[] = [
  { stop: 0.00, r: 50,  g: 100, b: 200 },  // blue (low)
  { stop: 0.25, r: 80,  g: 150, b: 220 },  // light blue
  { stop: 0.50, r: 255, g: 255, b: 100 },  // yellow
  { stop: 0.70, r: 255, g: 180, b: 50  },  // orange
  { stop: 0.85, r: 255, g: 80,  b: 30  },  // orange-red
  { stop: 1.00, r: 220, g: 30,  b: 30  },  // red (high)
];

function interpolateColormap(t: number): [number, number, number] {
  const ct = Math.max(0, Math.min(1, t));
  for (let i = 0; i < WIND_COLORMAP.length - 1; i++) {
    const c0 = WIND_COLORMAP[i];
    const c1 = WIND_COLORMAP[i + 1];
    if (ct >= c0.stop && ct <= c1.stop) {
      const lt = (ct - c0.stop) / (c1.stop - c0.stop);
      return [
        Math.round(c0.r + (c1.r - c0.r) * lt),
        Math.round(c0.g + (c1.g - c0.g) * lt),
        Math.round(c0.b + (c1.b - c0.b) * lt),
      ];
    }
  }
  return [220, 30, 30];
}

interface KaggleHurricaneOverlayProps {
  viewer: Cesium.Viewer | null;
  jobId: string | null;
  lat: number;
  lon: number;
  gridSizeKm?: number;
  opacity?: number;
  onDismiss?: () => void;
}

interface GridData { shape: number[]; values: number[]; }

export default function KaggleHurricaneOverlay({
  viewer, jobId, lat, lon, gridSizeKm = 2.56, opacity = 0.7, onDismiss,
}: KaggleHurricaneOverlayProps) {
  const windLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const surgeLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const windArrowLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ maxWind: number; maxSurge: number; maxRainfall: number } | null>(null);
  const loadedJobRef = useRef<string | null>(null);
  const [dismissHovered, setDismissHovered] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    if (!viewer) return;
    if (windLayerRef.current) { viewer.scene.imageryLayers.remove(windLayerRef.current, true); windLayerRef.current = null; }
    if (surgeLayerRef.current) { viewer.scene.imageryLayers.remove(surgeLayerRef.current, true); surgeLayerRef.current = null; }
    if (windArrowLayerRef.current) { viewer.scene.imageryLayers.remove(windArrowLayerRef.current, true); windArrowLayerRef.current = null; }
  }, [viewer]);

  const fetchGrid = useCallback(async (name: string, signal?: AbortSignal): Promise<GridData | null> => {
    if (!jobId) return null;
    const resp = await fetch(`/api/kaggle/simulate/${jobId}/grid/${name}?format=json`, { signal });
    if (!resp.ok) return null;
    return resp.json();
  }, [jobId]);

  const buildOverlay = useCallback(async () => {
    if (!viewer || !jobId || loadedJobRef.current === jobId) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true); setError(null); setStats(null); cleanup();
    loadedJobRef.current = jobId;

    try {
      const [windGrid, surgeGrid, rainGrid, dirGrid] = await Promise.all([
        fetchGrid('wind_speed', controller.signal),
        fetchGrid('surge_height', controller.signal),
        fetchGrid('rainfall', controller.signal),
        fetchGrid('wind_direction', controller.signal),
      ]);

      if (!windGrid) { setError('Failed to fetch wind speed grid data'); setLoading(false); return; }

      const gs = windGrid.shape[0] || 512;
      const windValues = windGrid.values;
      const surgeValues = surgeGrid?.values || new Array(windValues.length).fill(0);
      const rainValues = rainGrid?.values || new Array(windValues.length).fill(0);
      const dirValues = dirGrid?.values || new Array(windValues.length).fill(0);

      let maxWind = 0, maxSurge = 0, maxRainfall = 0;
      for (let i = 0; i < windValues.length; i++) {
        const w = isFinite(windValues[i]) ? windValues[i] : 0;
        const s = isFinite(surgeValues[i]) ? surgeValues[i] : 0;
        const r = isFinite(rainValues[i]) ? rainValues[i] : 0;
        if (w > maxWind) maxWind = w;
        if (s > maxSurge) maxSurge = s;
        if (r > maxRainfall) maxRainfall = r;
      }
      if (maxWind === 0) maxWind = 1;

      setStats({ maxWind, maxSurge, maxRainfall });

      // Build wind speed canvas
      const canvas = document.createElement('canvas');
      canvas.width = gs; canvas.height = gs;
      const ctx = canvas.getContext('2d')!;
      const image = ctx.createImageData(gs, gs);

      for (let row = 0; row < gs; row++) {
        for (let col = 0; col < gs; col++) {
          const idx = row * gs + col;
          const wind = isFinite(windValues[idx]) ? windValues[idx] : 0;
          const pi = idx * 4;
          if (wind < 1) {
            image.data[pi] = 0; image.data[pi+1] = 0; image.data[pi+2] = 0; image.data[pi+3] = 0;
            continue;
          }
          const t = Math.min(wind / maxWind, 1.0);
          const [r, g, b] = interpolateColormap(t);
          image.data[pi] = r; image.data[pi+1] = g; image.data[pi+2] = b;
          image.data[pi+3] = Math.round(80 + t * 140);
        }
      }
      ctx.putImageData(image, 0, 0);

      const halfKm = gridSizeKm / 2;
      const latDelta = halfKm / 111.0;
      const lonDelta = halfKm / (111.0 * Math.cos(lat * Math.PI / 180));
      const rect = Cesium.Rectangle.fromDegrees(lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta);

      const url = canvas.toDataURL('image/png');
      const provider = new Cesium.SingleTileImageryProvider({ url, rectangle: rect, tileWidth: gs, tileHeight: gs });
      const layer = viewer.scene.imageryLayers.addImageryProvider(provider);
      layer.alpha = opacity;
      (layer as unknown as { name: string }).name = 'kaggle_hurricane_wind';
      windLayerRef.current = layer;

      // Build surge height canvas (blue overlay)
      const surgeCanvas = document.createElement('canvas');
      surgeCanvas.width = gs; surgeCanvas.height = gs;
      const sCtx = surgeCanvas.getContext('2d')!;
      const sImage = sCtx.createImageData(gs, gs);

      let maxSurgeVal = 0;
      for (let i = 0; i < surgeValues.length; i++) {
        const s = isFinite(surgeValues[i]) ? surgeValues[i] : 0;
        if (s > maxSurgeVal) maxSurgeVal = s;
      }
      if (maxSurgeVal === 0) maxSurgeVal = 1;

      for (let row = 0; row < gs; row++) {
        for (let col = 0; col < gs; col++) {
          const idx = row * gs + col;
          const surge = isFinite(surgeValues[idx]) ? surgeValues[idx] : 0;
          const pi = idx * 4;
          if (surge < 0.1) {
            image.data[pi] = 0; image.data[pi+1] = 0; image.data[pi+2] = 0; image.data[pi+3] = 0;
            continue;
          }
          const t = Math.min(surge / maxSurgeVal, 1.0);
          sImage.data[pi] = Math.round(30 + t * 50);
          sImage.data[pi+1] = Math.round(100 + t * 100);
          sImage.data[pi+2] = Math.round(200 + t * 55);
          sImage.data[pi+3] = Math.round(100 + t * 120);
        }
      }
      sCtx.putImageData(sImage, 0, 0);

      const sUrl = surgeCanvas.toDataURL('image/png');
      const sProvider = new Cesium.SingleTileImageryProvider({ url: sUrl, rectangle: rect, tileWidth: gs, tileHeight: gs });
      const sLayer = viewer.scene.imageryLayers.addImageryProvider(sProvider);
      sLayer.alpha = 0.6;
      (sLayer as unknown as { name: string }).name = 'kaggle_hurricane_surge';
      surgeLayerRef.current = sLayer;

      // ── Build wind direction arrow overlay ──────────────────────
      // Draw arrows showing wind direction and speed (subsampled for performance)
      const arrowCanvas = document.createElement('canvas');
      arrowCanvas.width = gs; arrowCanvas.height = gs;
      const aCtx = arrowCanvas.getContext('2d')!;

      const arrowStride = Math.max(2, Math.floor(gs / 32));
      const maxWindForScaling = maxWind > 0 ? maxWind : 1;

      for (let row = 0; row < gs; row += arrowStride) {
        for (let col = 0; col < gs; col += arrowStride) {
          const idx = row * gs + col;
          const speed = isFinite(windValues[idx]) ? windValues[idx] : 0;
          const dir = isFinite(dirValues[idx]) ? dirValues[idx] : 0;

          if (speed < 1) continue; // skip low-wind cells

          // Convert meteorological direction (where wind comes FROM) to arrow vector
          // dx/dy in canvas space: +x = east, +y = south (down)
          const dirRad = dir * Math.PI / 180;
          const dx = -Math.sin(dirRad);  // east component
          const dy = Math.cos(dirRad);   // south component (positive = down in canvas)
          const velMag = Math.sqrt(dx * dx + dy * dy);
          if (velMag < 0.01) continue;

          const arrowLen = Math.min(20, 4 + (speed / maxWindForScaling) * 16);
          const ndx = dx / velMag;
          const ndy = dy / velMag;

          // Arrow color: white for fast, cyan for slow
          const t = speed / maxWindForScaling;
          aCtx.strokeStyle = `rgba(255, ${Math.round(200 - t * 100)}, ${Math.round(100 + t * 100)}, 0.9)`;
          aCtx.lineWidth = Math.max(1, 2 - t);
          aCtx.lineCap = 'round';

          const cx = col + 0.5;
          const cy = row + 0.5;
          const ex = cx + ndx * arrowLen;
          const ey = cy + ndy * arrowLen;

          // Arrow shaft
          aCtx.beginPath();
          aCtx.moveTo(cx, cy);
          aCtx.lineTo(ex, ey);
          aCtx.stroke();

          // Arrow head
          const headLen = 3;
          const angle = Math.atan2(ndy, ndx);
          aCtx.beginPath();
          aCtx.moveTo(ex, ey);
          aCtx.lineTo(ex - headLen * Math.cos(angle - 0.4), ey - headLen * Math.sin(angle - 0.4));
          aCtx.lineTo(ex - headLen * Math.cos(angle + 0.4), ey - headLen * Math.sin(angle + 0.4));
          aCtx.closePath();
          aCtx.fillStyle = `rgba(255, ${Math.round(200 - t * 100)}, ${Math.round(100 + t * 100)}, 0.9)`;
          aCtx.fill();
        }
      }

      const arrowUrl = arrowCanvas.toDataURL('image/png');
      const arrowProvider = new Cesium.SingleTileImageryProvider({
        url: arrowUrl,
        rectangle: rect,
        tileWidth: gs,
        tileHeight: gs,
      });
      const arrowLayer = viewer.scene.imageryLayers.addImageryProvider(arrowProvider);
      arrowLayer.alpha = 0.85;
      (arrowLayer as unknown as { name: string }).name = 'kaggle_hurricane_wind_arrows';
      windArrowLayerRef.current = arrowLayer;

      // Fly camera
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 8000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
        duration: 2.0,
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to build overlay');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [viewer, jobId, lat, lon, gridSizeKm, opacity, cleanup, fetchGrid]);

  useEffect(() => {
    if (jobId) { loadedJobRef.current = null; buildOverlay(); }
    else { cleanup(); loadedJobRef.current = null; setStats(null); }
  }, [jobId, buildOverlay, cleanup]);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); cleanup(); }, [cleanup]);

  if (!jobId) return null;

  return (
    <div style={{
      position: 'absolute', bottom: 80, left: 20, zIndex: 100,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
      borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#fff',
      border: '1px solid rgba(59,130,246,0.3)', maxWidth: 220,
    }}>
      {loading && (<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 10, height: 10, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        Loading hurricane data...
      </div>)}
      {error && (<div style={{ color: '#ef4444' }}>Error: {error}</div>)}
      {stats && !loading && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: '#60a5fa' }}>Kaggle Hurricane Overlay</span>
            {onDismiss && (<button onClick={onDismiss} onMouseEnter={() => setDismissHovered(true)} onMouseLeave={() => setDismissHovered(false)} style={{
              background: dismissHovered ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.25)', borderRadius: 4, color: '#fff', fontSize: 10, padding: '2px 8px', cursor: 'pointer',
            }} title="Remove overlay"><X size={10} /></button>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 8px', fontSize: 10, opacity: 0.8 }}>
            <span>Max Wind</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.maxWind.toFixed(1)} m/s</span>
            <span>Max Surge</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.maxSurge.toFixed(1)} m</span>
            <span>Max Rain</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.maxRainfall.toFixed(1)} mm</span>
          </div>
        </div>
      )}
    </div>
  );
}
