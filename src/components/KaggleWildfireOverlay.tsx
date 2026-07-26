/**
 * KaggleWildfireOverlay
 *
 * Fetches fire_intensity.npy and fire_state.npy from Kaggle simulation
 * results and renders them as colored imagery overlays on the 3D globe.
 *
 * - Red = high fire intensity (active burning)
 * - Orange = moderate
 * - Yellow = low
 * - Transparent where unburned
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import * as Cesium from 'cesium';
import { X } from 'lucide-react';

// Fire intensity colormap: yellow → red
const FIRE_COLORMAP: { stop: number; r: number; g: number; b: number }[] = [
  { stop: 0.00, r: 255, g: 255, b: 100 },  // yellow (low)
  { stop: 0.20, r: 255, g: 220, b: 50  },  // light orange
  { stop: 0.40, r: 255, g: 150, b: 30  },  // orange
  { stop: 0.60, r: 255, g: 80,  b: 20  },  // orange-red
  { stop: 0.80, r: 240, g: 30,  b: 20  },  // red
  { stop: 1.00, r: 200, g: 10,  b: 10  },  // deep red (high)
];

function interpolateColormap(t: number): [number, number, number] {
  const ct = Math.max(0, Math.min(1, t));
  for (let i = 0; i < FIRE_COLORMAP.length - 1; i++) {
    const c0 = FIRE_COLORMAP[i];
    const c1 = FIRE_COLORMAP[i + 1];
    if (ct >= c0.stop && ct <= c1.stop) {
      const lt = (ct - c0.stop) / (c1.stop - c0.stop);
      return [
        Math.round(c0.r + (c1.r - c0.r) * lt),
        Math.round(c0.g + (c1.g - c0.g) * lt),
        Math.round(c0.b + (c1.b - c0.b) * lt),
      ];
    }
  }
  return [200, 10, 10];
}

interface KaggleWildfireOverlayProps {
  viewer: Cesium.Viewer | null;
  jobId: string | null;
  lat: number;
  lon: number;
  gridSizeKm?: number;
  opacity?: number;
  onDismiss?: () => void;
}

interface GridData { shape: number[]; values: number[]; }

export default function KaggleWildfireOverlay({
  viewer, jobId, lat, lon, gridSizeKm = 2.56, opacity = 0.7, onDismiss,
}: KaggleWildfireOverlayProps) {
  const fireLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ maxIntensity: number; burningPct: number; burnedPct: number } | null>(null);
  const loadedJobRef = useRef<string | null>(null);
  const [dismissHovered, setDismissHovered] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    if (!viewer) return;
    if (fireLayerRef.current) { viewer.scene.imageryLayers.remove(fireLayerRef.current, true); fireLayerRef.current = null; }
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
      const [intensityGrid, stateGrid] = await Promise.all([
        fetchGrid('fire_intensity', controller.signal),
        fetchGrid('fire_state', controller.signal),
      ]);

      if (!intensityGrid) { setError('Failed to fetch fire intensity grid data'); setLoading(false); return; }

      const gs = intensityGrid.shape[0] || 512;
      const intensityValues = intensityGrid.values;
      const stateValues = stateGrid?.values || new Array(intensityValues.length).fill(0);

      let maxIntensity = 0, burningCells = 0, burnedCells = 0, totalCells = 0;
      for (let i = 0; i < intensityValues.length; i++) {
        const v = isFinite(intensityValues[i]) ? intensityValues[i] : 0;
        if (v > maxIntensity) maxIntensity = v;
        totalCells++;
        if (v > 0.01) burningCells++;
        const s = isFinite(stateValues[i]) ? stateValues[i] : 0;
        if (s === 2) burnedCells++;
      }
      if (maxIntensity === 0) maxIntensity = 1;

      setStats({
        maxIntensity,
        burningPct: (burningCells / totalCells) * 100,
        burnedPct: (burnedCells / totalCells) * 100,
      });

      // Build fire intensity canvas
      const canvas = document.createElement('canvas');
      canvas.width = gs; canvas.height = gs;
      const ctx = canvas.getContext('2d')!;
      const image = ctx.createImageData(gs, gs);

      for (let row = 0; row < gs; row++) {
        for (let col = 0; col < gs; col++) {
          const idx = row * gs + col;
          const intensity = isFinite(intensityValues[idx]) ? intensityValues[idx] : 0;
          const pi = idx * 4;
          if (intensity < 0.01) {
            image.data[pi] = 0; image.data[pi+1] = 0; image.data[pi+2] = 0; image.data[pi+3] = 0;
            continue;
          }
          const t = Math.min(intensity / maxIntensity, 1.0);
          const [r, g, b] = interpolateColormap(t);
          image.data[pi] = r; image.data[pi+1] = g; image.data[pi+2] = b;
          image.data[pi+3] = Math.round(100 + t * 130);
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
      (layer as unknown as { name: string }).name = 'kaggle_wildfire';
      fireLayerRef.current = layer;

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
      border: '1px solid rgba(249,115,22,0.3)', maxWidth: 220,
    }}>
      {loading && (<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 10, height: 10, border: '2px solid #f97316', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        Loading wildfire data...
      </div>)}
      {error && (<div style={{ color: '#ef4444' }}>Error: {error}</div>)}
      {stats && !loading && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: '#fb923c' }}>Kaggle Wildfire Overlay</span>
            {onDismiss && (<button onClick={onDismiss} onMouseEnter={() => setDismissHovered(true)} onMouseLeave={() => setDismissHovered(false)} style={{
              background: dismissHovered ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.25)', borderRadius: 4, color: '#fff', fontSize: 10, padding: '2px 8px', cursor: 'pointer',
            }} title="Remove overlay"><X size={10} /></button>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 8px', fontSize: 10, opacity: 0.8 }}>
            <span>Max Intensity</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.maxIntensity.toFixed(0)} kW/m</span>
            <span>Burning</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.burningPct.toFixed(1)}%</span>
            <span>Burned</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.burnedPct.toFixed(1)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
