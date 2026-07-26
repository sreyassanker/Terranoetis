/**
 * KaggleVolcanoOverlay
 *
 * Fetches ash_deposit.npy and lava_thickness.npy from Kaggle simulation
 * results and renders them as colored imagery overlays on the 3D globe.
 *
 * - Gray = ash deposit
 * - Red = active lava flow
 * - Semi-transparent so terrain is visible underneath
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import * as Cesium from 'cesium';
import { X } from 'lucide-react';

// Ash colormap: light gray → dark gray
const ASH_COLORMAP: { stop: number; r: number; g: number; b: number }[] = [
  { stop: 0.00, r: 150, g: 150, b: 150 },  // light gray (thin)
  { stop: 0.30, r: 120, g: 120, b: 120 },  // medium gray
  { stop: 0.60, r: 90,  g: 90,  b: 90  },  // dark gray
  { stop: 1.00, r: 60,  g: 60,  b: 60  },  // very dark gray
];

// Lava colormap: orange → red → yellow
const LAVA_COLORMAP: { stop: number; r: number; g: number; b: number }[] = [
  { stop: 0.00, r: 255, g: 100, b: 30  },  // orange (thin)
  { stop: 0.30, r: 255, g: 50,  b: 20  },  // orange-red
  { stop: 0.60, r: 240, g: 30,  b: 20  },  // red
  { stop: 1.00, r: 255, g: 220, b: 50  },  // yellow (thick)
];

function interpolateColormap(t: number, map: { stop: number; r: number; g: number; b: number }[]): [number, number, number] {
  const ct = Math.max(0, Math.min(1, t));
  for (let i = 0; i < map.length - 1; i++) {
    const c0 = map[i];
    const c1 = map[i + 1];
    if (ct >= c0.stop && ct <= c1.stop) {
      const lt = (ct - c0.stop) / (c1.stop - c0.stop);
      return [
        Math.round(c0.r + (c1.r - c0.r) * lt),
        Math.round(c0.g + (c1.g - c0.g) * lt),
        Math.round(c0.b + (c1.b - c0.b) * lt),
      ];
    }
  }
  return [255, 100, 30];
}

interface KaggleVolcanoOverlayProps {
  viewer: Cesium.Viewer | null;
  jobId: string | null;
  lat: number;
  lon: number;
  gridSizeKm?: number;
  opacity?: number;
  onDismiss?: () => void;
}

interface GridData { shape: number[]; values: number[]; }

export default function KaggleVolcanoOverlay({
  viewer, jobId, lat, lon, gridSizeKm = 2.56, opacity = 0.7, onDismiss,
}: KaggleVolcanoOverlayProps) {
  const ashLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const lavaLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ maxAsh: number; maxLava: number; maxColumn: number; lavaArea: number } | null>(null);
  const loadedJobRef = useRef<string | null>(null);
  const [dismissHovered, setDismissHovered] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    if (!viewer) return;
    if (ashLayerRef.current) { viewer.scene.imageryLayers.remove(ashLayerRef.current, true); ashLayerRef.current = null; }
    if (lavaLayerRef.current) { viewer.scene.imageryLayers.remove(lavaLayerRef.current, true); lavaLayerRef.current = null; }
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
      const [ashGrid, lavaGrid, columnGrid] = await Promise.all([
        fetchGrid('ash_deposit', controller.signal),
        fetchGrid('lava_thickness', controller.signal),
        fetchGrid('column_height', controller.signal),
      ]);

      if (!ashGrid) { setError('Failed to fetch ash deposit grid data'); setLoading(false); return; }

      const gs = ashGrid.shape[0] || 512;
      const ashValues = ashGrid.values;
      const lavaValues = lavaGrid?.values || new Array(ashValues.length).fill(0);
      const columnValues = columnGrid?.values || new Array(ashValues.length).fill(0);

      let maxAsh = 0, maxLava = 0, maxColumn = 0, lavaCells = 0, totalCells = 0;
      for (let i = 0; i < ashValues.length; i++) {
        const a = isFinite(ashValues[i]) ? ashValues[i] : 0;
        const l = isFinite(lavaValues[i]) ? lavaValues[i] : 0;
        const c = isFinite(columnValues[i]) ? columnValues[i] : 0;
        if (a > maxAsh) maxAsh = a;
        if (l > maxLava) maxLava = l;
        if (c > maxColumn) maxColumn = c;
        totalCells++;
        if (l > 0.01) lavaCells++;
      }
      if (maxAsh === 0) maxAsh = 1;
      if (maxLava === 0) maxLava = 1;

      setStats({ maxAsh, maxLava, maxColumn, lavaArea: (lavaCells / totalCells) * 100 });

      // Build ash canvas
      const canvas = document.createElement('canvas');
      canvas.width = gs; canvas.height = gs;
      const ctx = canvas.getContext('2d')!;
      const image = ctx.createImageData(gs, gs);

      for (let row = 0; row < gs; row++) {
        for (let col = 0; col < gs; col++) {
          const idx = row * gs + col;
          const ash = isFinite(ashValues[idx]) ? ashValues[idx] : 0;
          const pi = idx * 4;
          if (ash < 0.01) {
            image.data[pi] = 0; image.data[pi+1] = 0; image.data[pi+2] = 0; image.data[pi+3] = 0;
            continue;
          }
          const t = Math.min(ash / maxAsh, 1.0);
          const [r, g, b] = interpolateColormap(t, ASH_COLORMAP);
          image.data[pi] = r; image.data[pi+1] = g; image.data[pi+2] = b;
          image.data[pi+3] = Math.round(80 + t * 120);
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
      (layer as unknown as { name: string }).name = 'kaggle_volcano_ash';
      ashLayerRef.current = layer;

      // Build lava canvas
      const lavaCanvas = document.createElement('canvas');
      lavaCanvas.width = gs; lavaCanvas.height = gs;
      const lCtx = lavaCanvas.getContext('2d')!;
      const lImage = lCtx.createImageData(gs, gs);

      for (let row = 0; row < gs; row++) {
        for (let col = 0; col < gs; col++) {
          const idx = row * gs + col;
          const lava = isFinite(lavaValues[idx]) ? lavaValues[idx] : 0;
          const pi = idx * 4;
          if (lava < 0.01) {
            lImage.data[pi] = 0; lImage.data[pi+1] = 0; lImage.data[pi+2] = 0; lImage.data[pi+3] = 0;
            continue;
          }
          const t = Math.min(lava / maxLava, 1.0);
          const [r, g, b] = interpolateColormap(t, LAVA_COLORMAP);
          lImage.data[pi] = r; lImage.data[pi+1] = g; lImage.data[pi+2] = b;
          lImage.data[pi+3] = Math.round(100 + t * 130);
        }
      }
      lCtx.putImageData(lImage, 0, 0);

      const lUrl = lavaCanvas.toDataURL('image/png');
      const lProvider = new Cesium.SingleTileImageryProvider({ url: lUrl, rectangle: rect, tileWidth: gs, tileHeight: gs });
      const lLayer = viewer.scene.imageryLayers.addImageryProvider(lProvider);
      lLayer.alpha = opacity;
      (lLayer as unknown as { name: string }).name = 'kaggle_volcano_lava';
      lavaLayerRef.current = lLayer;

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
      border: '1px solid rgba(168,85,247,0.3)', maxWidth: 220,
    }}>
      {loading && (<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 10, height: 10, border: '2px solid #a855f7', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        Loading volcano data...
      </div>)}
      {error && (<div style={{ color: '#ef4444' }}>Error: {error}</div>)}
      {stats && !loading && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: '#c084fc' }}>Kaggle Volcano Overlay</span>
            {onDismiss && (<button onClick={onDismiss} onMouseEnter={() => setDismissHovered(true)} onMouseLeave={() => setDismissHovered(false)} style={{
              background: dismissHovered ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.25)', borderRadius: 4, color: '#fff', fontSize: 10, padding: '2px 8px', cursor: 'pointer',
            }} title="Remove overlay"><X size={10} /></button>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 8px', fontSize: 10, opacity: 0.8 }}>
            <span>Max Ash</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.maxAsh.toFixed(2)} m</span>
            <span>Max Lava</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.maxLava.toFixed(1)} m</span>
            <span>Max Column</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.maxColumn.toFixed(0)} m</span>
            <span>Lava Area</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.lavaArea.toFixed(1)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
