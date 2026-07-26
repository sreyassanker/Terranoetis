/**
 * KaggleEarthquakeOverlay
 *
 * Fetches pga_cm_s2.npy, pgv_cm_s2.npy, and mmi.npy from Kaggle simulation
 * results and renders them as colored imagery overlays on the 3D globe.
 *
 * - Red = high ground acceleration (dangerous)
 * - Yellow = moderate
 * - Transparent where no shaking
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import * as Cesium from 'cesium';
import { X } from 'lucide-react';

// Red-to-Yellow PGA colormap
const PGA_COLORMAP: { stop: number; r: number; g: number; b: number }[] = [
  { stop: 0.00, r: 255, g: 255, b: 100 },  // yellow (low)
  { stop: 0.20, r: 255, g: 200, b: 50  },  // orange
  { stop: 0.40, r: 255, g: 100, b: 30  },  // orange-red
  { stop: 0.60, r: 240, g: 50,  b: 30  },  // red
  { stop: 0.80, r: 220, g: 20,  b: 20  },  // deep red
  { stop: 1.00, r: 180, g: 10,  b: 10  },  // very deep red
];

function interpolateColormap(t: number): [number, number, number] {
  const ct = Math.max(0, Math.min(1, t));
  for (let i = 0; i < PGA_COLORMAP.length - 1; i++) {
    const c0 = PGA_COLORMAP[i];
    const c1 = PGA_COLORMAP[i + 1];
    if (ct >= c0.stop && ct <= c1.stop) {
      const lt = (ct - c0.stop) / (c1.stop - c0.stop);
      return [
        Math.round(c0.r + (c1.r - c0.r) * lt),
        Math.round(c0.g + (c1.g - c0.g) * lt),
        Math.round(c0.b + (c1.b - c0.b) * lt),
      ];
    }
  }
  return [180, 10, 10];
}

interface KaggleEarthquakeOverlayProps {
  viewer: Cesium.Viewer | null;
  jobId: string | null;
  lat: number;
  lon: number;
  gridSizeKm?: number;
  opacity?: number;
  onDismiss?: () => void;
}

interface GridData { shape: number[]; values: number[]; }

export default function KaggleEarthquakeOverlay({
  viewer, jobId, lat, lon, gridSizeKm = 2.56, opacity = 0.7, onDismiss,
}: KaggleEarthquakeOverlayProps) {
  const pgaLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const mmiLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ maxPGA: number; maxPGV: number; maxMMI: number } | null>(null);
  const loadedJobRef = useRef<string | null>(null);
  const [dismissHovered, setDismissHovered] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    if (!viewer) return;
    if (pgaLayerRef.current) { viewer.scene.imageryLayers.remove(pgaLayerRef.current, true); pgaLayerRef.current = null; }
    if (mmiLayerRef.current) { viewer.scene.imageryLayers.remove(mmiLayerRef.current, true); mmiLayerRef.current = null; }
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
      const [pgaGrid, pgvGrid, mmiGrid] = await Promise.all([
        fetchGrid('pga_cm_s2', controller.signal),
        fetchGrid('pgv_cm_s2', controller.signal),
        fetchGrid('mmi', controller.signal),
      ]);

      if (!pgaGrid) { setError('Failed to fetch PGA grid data'); setLoading(false); return; }

      const gs = pgaGrid.shape[0] || 512;
      const pgaValues = pgaGrid.values;
      const pgvValues = pgvGrid?.values || new Array(pgaValues.length).fill(0);
      const mmiValues = mmiGrid?.values || new Array(pgaValues.length).fill(0);

      let maxPGA = 0, maxPGV = 0, maxMMI = 0;
      for (let i = 0; i < pgaValues.length; i++) {
        const p = isFinite(pgaValues[i]) ? pgaValues[i] : 0;
        const v = isFinite(pgvValues[i]) ? pgvValues[i] : 0;
        const m = isFinite(mmiValues[i]) ? mmiValues[i] : 0;
        if (p > maxPGA) maxPGA = p;
        if (v > maxPGV) maxPGV = v;
        if (m > maxMMI) maxMMI = m;
      }
      if (maxPGA === 0) maxPGA = 1;

      setStats({ maxPGA, maxPGV, maxMMI });

      // Build PGA canvas
      const canvas = document.createElement('canvas');
      canvas.width = gs; canvas.height = gs;
      const ctx = canvas.getContext('2d')!;
      const image = ctx.createImageData(gs, gs);

      for (let row = 0; row < gs; row++) {
        for (let col = 0; col < gs; col++) {
          const idx = row * gs + col;
          const pga = isFinite(pgaValues[idx]) ? pgaValues[idx] : 0;
          const pi = idx * 4;
          if (pga < 1) { // below detection threshold
            image.data[pi] = 0; image.data[pi+1] = 0; image.data[pi+2] = 0; image.data[pi+3] = 0;
            continue;
          }
          const t = Math.min(pga / maxPGA, 1.0);
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
      (layer as unknown as { name: string }).name = 'kaggle_earthquake_pga';
      pgaLayerRef.current = layer;

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
      border: '1px solid rgba(239,68,68,0.3)', maxWidth: 220,
    }}>
      {loading && (<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 10, height: 10, border: '2px solid #ef4444', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        Loading earthquake data...
      </div>)}
      {error && (<div style={{ color: '#ef4444' }}>Error: {error}</div>)}
      {stats && !loading && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: '#f87171' }}>Kaggle Earthquake Overlay</span>
            {onDismiss && (<button onClick={onDismiss} onMouseEnter={() => setDismissHovered(true)} onMouseLeave={() => setDismissHovered(false)} style={{
              background: dismissHovered ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.25)', borderRadius: 4, color: '#fff', fontSize: 10, padding: '2px 8px', cursor: 'pointer',
            }} title="Remove overlay"><X size={10} /></button>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 8px', fontSize: 10, opacity: 0.8 }}>
            <span>Max PGA</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.maxPGA.toFixed(0)} cm/s²</span>
            <span>Max PGV</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.maxPGV.toFixed(0)} cm/s</span>
            <span>Max MMI</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.maxMMI.toFixed(0)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
