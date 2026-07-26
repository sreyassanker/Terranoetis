/**
 * KaggleLandslideOverlay
 *
 * Fetches landslide_depth.npy, landslide_velocity.npy, runout_distance.npy,
 * and terrain.npy from Kaggle simulation results and renders them as
 * colored imagery overlays on the 3D globe.
 *
 * - Brown/Red = deep debris flow
 * - Orange = moderate debris flow
 * - Yellow = shallow debris flow
 * - Semi-transparent so terrain is visible underneath
 *
 * Also displays velocity and runout distance as separate layers.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import * as Cesium from 'cesium';
import { X } from 'lucide-react';


// ── Debris flow colormap (brown to red) ──────────────────────────────
const DEPTH_COLORMAP: { stop: number; r: number; g: number; b: number }[] = [
  { stop: 0.00, r: 139, g: 69,  b: 19  },  // dark brown (shallow)
  { stop: 0.15, r: 160, g: 82,  b: 45  },  // brown
  { stop: 0.30, r: 180, g: 100, b: 60  },  // light brown
  { stop: 0.50, r: 205, g: 120, b: 50  },  // orange-brown
  { stop: 0.70, r: 220, g: 140, b: 40  },  // orange
  { stop: 0.85, r: 240, g: 100, b: 30  },  // orange-red
  { stop: 1.00, r: 220, g: 30,  b: 30  },  // red (deep)
];

function interpolateColormap(t: number): [number, number, number] {
  const ct = Math.max(0, Math.min(1, t));
  for (let i = 0; i < DEPTH_COLORMAP.length - 1; i++) {
    const c0 = DEPTH_COLORMAP[i];
    const c1 = DEPTH_COLORMAP[i + 1];
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

interface KaggleLandslideOverlayProps {
  viewer: Cesium.Viewer | null;
  jobId: string | null;
  lat: number;
  lon: number;
  gridSizeKm?: number;
  opacity?: number;
  onDismiss?: () => void;
}

interface GridData {
  shape: number[];
  values: number[];
}

export default function KaggleLandslideOverlay({
  viewer,
  jobId,
  lat,
  lon,
  gridSizeKm = 2.56,
  opacity = 0.7,
  onDismiss,
}: KaggleLandslideOverlayProps) {
  const depthLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const velocityLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const runoutLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const terrainLayerRef = useRef<Cesium.ImageryLayer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    maxDepth: number;
    maxVelocity: number;
    maxRunout: number;
    affectedPct: number;
    totalVolume: number;
  } | null>(null);
  const loadedJobRef = useRef<string | null>(null);
  const [dismissHovered, setDismissHovered] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    if (!viewer) return;
    if (depthLayerRef.current) {
      viewer.scene.imageryLayers.remove(depthLayerRef.current, true);
      depthLayerRef.current = null;
    }
    if (velocityLayerRef.current) {
      viewer.scene.imageryLayers.remove(velocityLayerRef.current, true);
      velocityLayerRef.current = null;
    }
    if (runoutLayerRef.current) {
      viewer.scene.imageryLayers.remove(runoutLayerRef.current, true);
      runoutLayerRef.current = null;
    }
    if (terrainLayerRef.current) {
      viewer.scene.imageryLayers.remove(terrainLayerRef.current, true);
      terrainLayerRef.current = null;
    }
  }, [viewer]);

  const fetchGrid = useCallback(async (name: string, signal?: AbortSignal): Promise<GridData | null> => {
    if (!jobId) return null;
    const resp = await fetch(`/api/kaggle/simulate/${jobId}/grid/${name}?format=json`, { signal });
    if (!resp.ok) return null;
    return resp.json();
  }, [jobId]);

  const buildOverlay = useCallback(async () => {
    if (!viewer || !jobId || loadedJobRef.current === jobId) return;

    // Abort any in-flight fetch from a previous run
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setStats(null);
    cleanup();
    loadedJobRef.current = jobId;

    try {
      // Fetch all grids in parallel
      const [depthGrid, velocityGrid, runoutGrid, terrainGrid, vxGrid, vyGrid] = await Promise.all([
        fetchGrid('landslide_depth', controller.signal),
        fetchGrid('landslide_velocity', controller.signal),
        fetchGrid('runout_distance', controller.signal),
        fetchGrid('terrain', controller.signal),
        fetchGrid('velocity_x', controller.signal),
        fetchGrid('velocity_y', controller.signal),
      ]);

      if (!depthGrid || !terrainGrid) {
        setError('Failed to fetch grid data from Kaggle results');
        setLoading(false);
        return;
      }

      const gs = depthGrid.shape[0] || 512;
      const depthValues = depthGrid.values;
      const terrainValues = terrainGrid.values;
      const velocityValues = velocityGrid?.values || new Array(depthValues.length).fill(0);
      const runoutValues = runoutGrid?.values || new Array(depthValues.length).fill(0);
      const vxValues = vxGrid?.values || new Array(depthValues.length).fill(0);
      const vyValues = vyGrid?.values || new Array(depthValues.length).fill(0);

      // Compute statistics
      let maxDepth = 0;
      let maxVelocity = 0;
      let maxRunout = 0;
      let affectedCells = 0;
      let totalCells = 0;
      let totalVolume = 0;

      for (let i = 0; i < depthValues.length; i++) {
        const d = isFinite(depthValues[i]) ? depthValues[i] : 0;
        const v = isFinite(velocityValues[i]) ? velocityValues[i] : 0;
        const r = isFinite(runoutValues[i]) ? runoutValues[i] : 0;

        if (d > maxDepth) maxDepth = d;
        if (v > maxVelocity) maxVelocity = v;
        if (r > maxRunout) maxRunout = r;
        totalCells++;
        if (d > 0.01) affectedCells++;
        totalVolume += d;
      }

      if (maxDepth === 0) maxDepth = 1;

      setStats({
        maxDepth,
        maxVelocity,
        maxRunout,
        affectedPct: (affectedCells / totalCells) * 100,
        totalVolume: totalVolume * (gridSizeKm * 1000 / gs) ** 2 / 1e6, // M m³
      });

      // Build the colored canvas (debris depth overlay)
      const canvas = document.createElement('canvas');
      canvas.width = gs;
      canvas.height = gs;
      const ctx = canvas.getContext('2d')!;
      const image = ctx.createImageData(gs, gs);

      for (let row = 0; row < gs; row++) {
        for (let col = 0; col < gs; col++) {
          const idx = row * gs + col;
          const depth = isFinite(depthValues[idx]) ? depthValues[idx] : 0;

          if (depth < 0.01) {
            // No debris — transparent (show terrain underneath)
            const pi = idx * 4;
            image.data[pi] = 0;
            image.data[pi + 1] = 0;
            image.data[pi + 2] = 0;
            image.data[pi + 3] = 0;
            continue;
          }

          const t = Math.min(depth / maxDepth, 1.0);
          const [r, g, b] = interpolateColormap(t);
          const pi = idx * 4;
          image.data[pi] = r;
          image.data[pi + 1] = g;
          image.data[pi + 2] = b;
          image.data[pi + 3] = Math.round(80 + t * 140); // alpha: 80–220
        }
      }
      ctx.putImageData(image, 0, 0);

      // Position the overlay centered at (lat, lon)
      const halfKm = gridSizeKm / 2;
      const latDelta = halfKm / 111.0; // ~111 km per degree latitude
      const lonDelta = halfKm / (111.0 * Math.cos(lat * Math.PI / 180));
      const rect = Cesium.Rectangle.fromDegrees(
        lon - lonDelta, lat - latDelta,
        lon + lonDelta, lat + latDelta,
      );

      // Add depth overlay as imagery layer
      const url = canvas.toDataURL('image/png');
      const provider = new Cesium.SingleTileImageryProvider({
        url,
        rectangle: rect,
        tileWidth: gs,
        tileHeight: gs,
      });
      const layer = viewer.scene.imageryLayers.addImageryProvider(provider);
      layer.alpha = opacity;
      (layer as any).name = 'kaggle_landslide_depth';
      depthLayerRef.current = layer;

      // ── Build velocity arrow overlay ──────────────────────────────
      // Draw arrows showing debris flow direction and speed
      const arrowCanvas = document.createElement('canvas');
      arrowCanvas.width = gs;
      arrowCanvas.height = gs;
      const aCtx = arrowCanvas.getContext('2d')!;

      // Subsample arrows for performance (every N cells)
      const arrowStride = Math.max(2, Math.floor(gs / 32));
      const maxVelForScaling = maxVelocity > 0 ? maxVelocity : 1;

      for (let row = 0; row < gs; row += arrowStride) {
        for (let col = 0; col < gs; col += arrowStride) {
          const idx = row * gs + col;
          const vx = isFinite(vxValues[idx]) ? vxValues[idx] : 0;
          const vy = isFinite(vyValues[idx]) ? vyValues[idx] : 0;
          const velMag = Math.sqrt(vx * vx + vy * vy);

          // Only draw arrows where there's significant flow
          if (velMag < 0.05 || !isFinite(velMag)) continue;

          // Normalize direction
          const dirX = vx / velMag;
          const dirY = vy / velMag;

          // Arrow length scales with velocity (normalized)
          const arrowLen = Math.min(20, 4 + (velMag / maxVelForScaling) * 16);

          // Arrow color: white for fast, yellow for slow
          const t = velMag / maxVelForScaling;
          aCtx.strokeStyle = `rgba(255, ${Math.round(200 - t * 100)}, ${Math.round(100 - t * 50)}, 0.8)`;
          aCtx.lineWidth = Math.max(1, 2 - t);
          aCtx.lineCap = 'round';

          const cx = col + 0.5;
          const cy = row + 0.5;
          const ex = cx + dirX * arrowLen;
          const ey = cy + dirY * arrowLen;

          // Draw arrow shaft
          aCtx.beginPath();
          aCtx.moveTo(cx, cy);
          aCtx.lineTo(ex, ey);
          aCtx.stroke();

          // Draw arrow head
          const headLen = 3;
          const angle = Math.atan2(dirY, dirX);
          aCtx.beginPath();
          aCtx.moveTo(ex, ey);
          aCtx.lineTo(ex - headLen * Math.cos(angle - 0.4), ey - headLen * Math.sin(angle - 0.4));
          aCtx.lineTo(ex - headLen * Math.cos(angle + 0.4), ey - headLen * Math.sin(angle + 0.4));
          aCtx.closePath();
          aCtx.fillStyle = `rgba(255, ${Math.round(200 - t * 100)}, ${Math.round(100 - t * 50)}, 0.8)`;
          aCtx.fill();
        }
      }

      // Add arrow overlay as imagery layer (on top of depth)
      const arrowUrl = arrowCanvas.toDataURL('image/png');
      const arrowProvider = new Cesium.SingleTileImageryProvider({
        url: arrowUrl,
        rectangle: rect,
        tileWidth: gs,
        tileHeight: gs,
      });
      const arrowLayer = viewer.scene.imageryLayers.addImageryProvider(arrowProvider);
      arrowLayer.alpha = 0.85;
      (arrowLayer as any).name = 'kaggle_landslide_arrows';
      velocityLayerRef.current = arrowLayer;

      // Build terrain canvas (grayscale heightmap)
      const terrainCanvas = document.createElement('canvas');
      terrainCanvas.width = gs;
      terrainCanvas.height = gs;
      const tCtx = terrainCanvas.getContext('2d')!;
      const tImage = tCtx.createImageData(gs, gs);

      let tMin = Infinity, tMax = -Infinity;
      for (let i = 0; i < terrainValues.length; i++) {
        const v = isFinite(terrainValues[i]) ? terrainValues[i] : 0;
        if (v < tMin) tMin = v;
        if (v > tMax) tMax = v;
      }
      const tSpan = tMax - tMin || 1;

      for (let row = 0; row < gs; row++) {
        for (let col = 0; col < gs; col++) {
          const idx = row * gs + col;
          const v = isFinite(terrainValues[idx]) ? terrainValues[idx] : 0;
          const t = (v - tMin) / tSpan;
          // Terrain: brown-green gradient
          const pi = idx * 4;
          tImage.data[pi] = Math.round(60 + t * 80);
          tImage.data[pi + 1] = Math.round(100 + t * 60);
          tImage.data[pi + 2] = Math.round(40 + t * 30);
          tImage.data[pi + 3] = 160;
        }
      }
      tCtx.putImageData(tImage, 0, 0);

      // Add terrain layer underneath the depth overlay
      const tUrl = terrainCanvas.toDataURL('image/png');
      const tProvider = new Cesium.SingleTileImageryProvider({
        url: tUrl,
        rectangle: rect,
        tileWidth: gs,
        tileHeight: gs,
      });
      const tLayer = viewer.scene.imageryLayers.addImageryProvider(tProvider);
      tLayer.alpha = 0.5;
      (tLayer as any).name = 'kaggle_terrain';
      terrainLayerRef.current = tLayer;

      // Fly camera to the landslide area
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 8000),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-45),
          roll: 0,
        },
        duration: 2.0,
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // unmounted or new run
      setError(err instanceof Error ? err.message : 'Failed to build overlay');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [viewer, jobId, lat, lon, gridSizeKm, opacity, cleanup, fetchGrid]);

  // Build overlay when jobId changes
  useEffect(() => {
    if (jobId) {
      loadedJobRef.current = null; // force reload
      buildOverlay();
    } else {
      cleanup();
      loadedJobRef.current = null;
      setStats(null);
    }
  }, [jobId, buildOverlay, cleanup]);

  // Cleanup on unmount: remove layers + abort in-flight fetches
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      cleanup();
    };
  }, [cleanup]);

  // Render status badge (floating indicator)
  if (!jobId) return null;

  return (
    <div style={{
      position: 'absolute',
      bottom: 80,
      left: 20,
      zIndex: 100,
      background: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(8px)',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 11,
      color: '#fff',
      border: '1px solid rgba(124,45,18,0.3)',
      maxWidth: 240,
    }}>
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, border: '2px solid #7c2d12', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          Loading landslide data...
        </div>
      )}
      {error && (
        <div style={{ color: '#ef4444' }}>⚠ {error}</div>
      )}
      {stats && !loading && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: '#d2b48c' }}>🌋 Kaggle Landslide Overlay</span>
            {onDismiss && (
              <button onClick={onDismiss} onMouseEnter={() => setDismissHovered(true)} onMouseLeave={() => setDismissHovered(false)} style={{
                background: dismissHovered ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 4, color: '#fff', fontSize: 10, padding: '2px 8px', cursor: 'pointer',
                transition: 'background 0.15s ease',
              }} title="Remove overlay"><X size={10} /></button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 8px', fontSize: 10, opacity: 0.8 }}>
            <span>Max Depth</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.maxDepth.toFixed(1)} m</span>
            <span>Max Velocity</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.maxVelocity.toFixed(1)} m/s</span>
            <span>Max Runout</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.maxRunout.toFixed(1)} km</span>
            <span>Affected</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.affectedPct.toFixed(1)}%</span>
            <span>Total Volume</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{stats.totalVolume.toFixed(1)} M m³</span>
          </div>
        </div>
      )}
    </div>
  );
}
