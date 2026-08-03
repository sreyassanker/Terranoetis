/**
 * KaggleFloodOverlay — 3D CFD flood rendering.
 *
 * Replaces the 2D canvas → PNG → SingleTileImageryProvider pipeline with a
 * GPU-animated primitive stack:
 *  - ScalarSurfacePrimitive  (3D water sheet, displaced per frame, lit)
 *  - ArrowFieldPrimitive     (real 3D arrows, oriented by velocity field)
 *  - ParticleAdvector        (stream tracers advected in real time)
 *
 * Animation is *uniform-only*: each frame is just one `material.uniforms.u_frame`
 * write per primitive — no imagery-layer churn, no WebGL texture leaks.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import * as Cesium from 'cesium';
import { X } from 'lucide-react';
import {
  computeGridRectangle,
  fetchGrid,
  fetchSimMeta,
  extentKm,
  getColormap,
  resolveCellSizeM,
  addDomainBoundary,
  schemeToCfa,
  toFrameSeries,
  type ColorStop,
  type GridData,
} from './kaggle/shared';
import KaggleLegend, { type SchemeOption } from './kaggle/KaggleLegend';
import KaggleAnimationControls from './kaggle/KaggleAnimationControls';
import { ScalarSurfacePrimitive } from './kaggle/gpu/ScalarSurfacePrimitive';
import { ArrowFieldPrimitive } from './kaggle/gpu/ArrowFieldPrimitive';
import { ParticleAdvector } from './kaggle/gpu/ParticleAdvector';
import { sampleDomainTerrain } from './kaggle/gpu/terrain';
import { buildGeoFrame } from './kaggle/gpu/fieldData';

// ── Colormap mapping (overlay UI ↔ GPU GLSL) ─────────────────────────────────
const DEPTH_COLORMAP: ColorStop[] = [
  { stop: 0.0, r: 10, g: 60, b: 180 },
  { stop: 0.15, r: 30, g: 120, b: 220 },
  { stop: 0.3, r: 50, g: 180, b: 220 },
  { stop: 0.5, r: 60, g: 210, b: 140 },
  { stop: 0.7, r: 220, g: 200, b: 50 },
  { stop: 0.85, r: 240, g: 120, b: 30 },
  { stop: 1.0, r: 220, g: 30, b: 30 },
];
const SCHEMES: SchemeOption[] = [
  { name: 'default', label: 'Depth (blue→red)' },
  { name: 'viridis', label: 'Viridis' },
  { name: 'turbo', label: 'Turbo' },
  { name: 'spectral', label: 'Spectral' },
  { name: 'inferno', label: 'Inferno' },
  { name: 'coolwarm', label: 'Cool–Warm' },
  { name: 'grayscale', label: 'Grayscale' },
];

interface KaggleFloodOverlayProps {
  viewer: Cesium.Viewer | null;
  jobId: string | null;
  lat: number;
  lon: number;
  opacity?: number;
  onDismiss?: () => void;
}

interface GpuStack {
  surface: ScalarSurfacePrimitive;
  arrows: ArrowFieldPrimitive;
  particles: ParticleAdvector;
  frames: number;
  times: number[];
  boundary: Cesium.Entity;
  maxDepth: number;
  maxVelocity: number;
  gs: number;
  kmExtent: number;
  floodedPct: number;
}

export default function KaggleFloodOverlay({
  viewer,
  jobId,
  lat,
  lon,
  opacity = 0.85,
  onDismiss,
}: KaggleFloodOverlayProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ maxDepth: number; floodedPct: number; extentKm: number } | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scheme, setScheme] = useState('default');
  const [dismissHovered, setDismissHovered] = useState(false);
  const loadedJobRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stackRef = useRef<GpuStack | null>(null);
  const [layerOpacity, setLayerOpacity] = useState(opacity);

  const cleanup = useCallback(() => {
    const s = stackRef.current;
    if (s) {
      s.surface.destroy();
      s.arrows.destroy();
      s.particles.destroy();
      s.boundary && viewer?.entities.remove(s.boundary);
      stackRef.current = null;
    }
  }, [viewer]);

  // ── Load + build ────────────────────────────────────────────────────────────
  const buildOverlay = useCallback(async () => {
    if (!viewer || !jobId || loadedJobRef.current === jobId) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setStats(null);
    cleanup();
    setFrame(0);
    setPlaying(false);
    // loadedJobRef is stamped only once the stack is fully built — a failed
    // fetch must leave the overlay retryable for the same jobId.

    try {
      const [depthGrid, vxGrid, vyGrid, snapDepth, snapVx, snapVy, snapTimes, meta] =
        await Promise.all([
          fetchGrid(jobId, 'water_depth_final', controller.signal),
          fetchGrid(jobId, 'velocity_x', controller.signal),
          fetchGrid(jobId, 'velocity_y', controller.signal),
          fetchGrid(jobId, 'snapshots_depth', controller.signal),
          // Some kernels (e.g. landslide) store velocity as a single combined
          // snapshots_velocity grid; try both conventions.
          fetchGrid(jobId, 'snapshots_vx', controller.signal)
            .then(g => g ?? fetchGrid(jobId, 'snapshots_velocity', controller.signal)),
          fetchGrid(jobId, 'snapshots_vy', controller.signal)
            .then(g => g ?? fetchGrid(jobId, 'snapshots_velocity', controller.signal)),
          fetchGrid(jobId, 'snapshot_times', controller.signal),
          fetchSimMeta(jobId, controller.signal),
        ]);
      if (controller.signal.aborted) return;
      if (!depthGrid) {
        setError('Failed to fetch water depth grid data');
        return;
      }

      const gs = depthGrid.shape[0] || 512;
      const depthSeries = toFrameSeries(snapDepth, [], gs, gs);
      const vxSeries = toFrameSeries(snapVx, [], gs, gs);
      const vySeries = toFrameSeries(snapVy, [], gs, gs);

      const cellSizeM = resolveCellSizeM('flood_inundation', meta);
      // Surface geometry always spans gs × cellSizeM meters — never derive
      // extent from a caller-supplied gridSizeKm that would desync the
      // boundary rectangle from the actual GPU-rendered domain.
      const km = extentKm(gs, cellSizeM);
      const rect = computeGridRectangle(lat, lon, km);

      // Sequence count for animation controls
      const frames = depthSeries?.frames ?? 1;
      const times: number[] = snapTimes && snapTimes.values.length >= frames
        ? snapTimes.values.slice(0, frames)
        : Array.from({ length: frames }, (_, i) => i);

      // Build the GeoFrame and sample terrain once
      const geoFrame = buildGeoFrame(lat, lon, gs, cellSizeM);
      const terrain = sampleDomainTerrain({
        viewer,
        frame: geoFrame,
        outGs: gs,
        debugName: `flood-${jobId}`,
      });

      const SURFACE_EXAGGERATION_M = 400;

      // Scalar surface: animated depth sheet (3D displaced)
      const surface = new ScalarSurfacePrimitive({
        viewer,
        centerLat: lat,
        centerLon: lon,
        gs,
        cellSizeM,
        series: depthSeries ?? {
          shape: [1, gs, gs],
          values: Array.from(depthGrid.values),
        },
        times,
        terrain,
        exaggeration: SURFACE_EXAGGERATION_M,   // meters at max depth
        maxValue: undefined,
        colormap: 'turbo',
        alphaFloor: 0.02,
        sideTint: true,
      });

      // Arrows: real 3D arrow field, lifted *above the displaced surface*.
      // The water sheet is displaced up to SURFACE_EXAGGERATION_M at crest; a
      // fixed 15 m lift that worked pre-displacement buries the arrows inside
      // the sheet. 0.6 * exaggeration places them above the envelope.
      const arrows = new ArrowFieldPrimitive({
        viewer,
        centerLat: lat,
        centerLon: lon,
        gs,
        cellSizeM,
        vxSeries: vxSeries ?? {
          shape: [1, gs, gs],
          values: Array.from({ length: gs * gs }, (_, i) => (vxGrid?.values[i] as number) ?? 0),
        },
        vySeries: vySeries ?? {
          shape: [1, gs, gs],
          values: Array.from({ length: gs * gs }, (_, i) => (vyGrid?.values[i] as number) ?? 0),
        },
        terrain,
        lift: SURFACE_EXAGGERATION_M * 0.6,
        stride: 6,            // every 6th cell
        minLen: 6,
        lenScale: 160,
        thickness: 0.10,
        colormap: 'inferno',
      });

      // Particles ride on the displaced water surface (mesh height at cell
      // centers ≈ terrain + depth·exaggeration·norm) — not on the bare terrain.
      const particles = new ParticleAdvector({
        viewer,
        frame: geoFrame,
        gs,
        cellSizeM,
        vxSeries: vxSeries ?? {
          shape: [1, gs, gs],
          values: Array.from({ length: gs * gs }, () => 0),
        },
        vySeries: vySeries ?? {
          shape: [1, gs, gs],
          values: Array.from({ length: gs * gs }, () => 0),
        },
        depthSeries: depthSeries ?? undefined,
        depthThreshold: 0.01,
        count: 2000,
        advectDt: 0.04,
        simDtPerStep: Math.min(4, cellSizeM * 0.4), // CFL-safe: ≤ 40% of a cell per step
        surfaceTerrain: terrain,
        surfaceExaggerationM: SURFACE_EXAGGERATION_M,
        surfaceMaxValue: surface.maxValue,
        colormap: 'turbo',
        alpha: 0.85,
      });
      particles.startIfNew();

      // Domain outline
      const boundary = addDomainBoundary(viewer, rect,
        Cesium.Color.fromCssColorString('rgba(59,130,246,0.9)'));

      stackRef.current = {
        surface,
        arrows,
        particles,
        frames,
        times,
        boundary,
        maxDepth: surface.maxValue,
        maxVelocity: arrows.maxSpeed,
        gs,
        kmExtent: km,
        floodedPct: 0,
      };
      loadedJobRef.current = jobId;

      // Stats
      let flooded = 0;
      const finalDepth = depthGrid.values;
      for (let i = 0; i < finalDepth.length; i++) {
        if (Number.isFinite(finalDepth[i]) && finalDepth[i] > 0.01) flooded++;
      }
      const floodedPct = (flooded / finalDepth.length) * 100;
      setStats({
        maxDepth: surface.maxValue,
        floodedPct,
        extentKm: km,
      });
      stackRef.current.floodedPct = floodedPct;

      // Camera framing
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(8000, km * 550)),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 },
        duration: 1.6,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to build overlay');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [viewer, jobId, lat, lon, cleanup]);

  useEffect(() => {
    if (jobId) {
      loadedJobRef.current = null;
      buildOverlay();
    } else {
      cleanup();
      loadedJobRef.current = null;
      setStats(null);
    }
    return () => {
      cleanup();
      if (abortRef.current) abortRef.current.abort();
    };
  }, [jobId, buildOverlay, cleanup]);

  // ── Per-frame update (GPU uniform writes only) ──────────────────────────────
  useEffect(() => {
    const s = stackRef.current;
    if (!s) return;
    s.surface.setFrame(frame);
    s.arrows.setFrame(frame);
    s.particles.setFrame(frame);
  }, [frame]);

  // ── Scheme change — swap the baked GLSL colormap on every primitive ─────────
  useEffect(() => {
    const s = stackRef.current;
    if (!s) return;
    const gpu = schemeToCfa(scheme, 'turbo');
    s.surface.setColormap(gpu);
    s.arrows.setColormap(gpu);
    s.particles.setColormap(gpu);
  }, [scheme]);

  // ── Opacity change ───────────────────────────────────────────────────────────
  useEffect(() => {
    stackRef.current?.surface.setOpacity(layerOpacity);
    stackRef.current?.arrows.setOpacity(layerOpacity);
    stackRef.current?.particles.setOpacity(layerOpacity);
  }, [layerOpacity]);

  const seriesFrames = stackRef.current?.frames ?? 0;

  if (!jobId) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 80,
        left: 20,
        zIndex: 100,
        background: 'rgba(0,0,0,0.82)',
        backdropFilter: 'blur(10px)',
        borderRadius: 8,
        padding: '10px 13px',
        fontSize: 11,
        color: '#fff',
        border: '1px solid rgba(59,130,246,0.4)',
        maxWidth: 280,
      }}
    >
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 10, height: 10,
              border: '2px solid #3b82f6',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
          Loading flood CFD data…
        </div>
      )}
      {error && <div style={{ color: '#ef4444' }}>Error: {error}</div>}

      {stats && !loading && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: '#60a5fa' }}>
              Kaggle Flood CFD
            </span>
            {onDismiss && (
              <button
                onClick={onDismiss}
                onMouseEnter={() => setDismissHovered(true)}
                onMouseLeave={() => setDismissHovered(false)}
                style={{
                  background: dismissHovered ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: 4,
                  color: '#fff',
                  fontSize: 10,
                  padding: '2px 8px',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                }}
                title="Remove overlay"
              >
                <X size={10} />
              </button>
            )}
          </div>

          {seriesFrames > 1 && (
            <KaggleAnimationControls
              frames={seriesFrames}
              frame={frame}
              onFrameChange={setFrame}
              playing={playing}
              onTogglePlay={() => setPlaying(p => !p)}
              times={stackRef.current?.times ?? []}
              formatTime={t => `${t.toFixed(1)}h`}
            />
          )}

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '2px 8px',
            fontSize: 10,
            opacity: 0.85,
            marginTop: 4,
          }}>
            <span>Max depth</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {stats.maxDepth.toFixed(2)} m
            </span>
            <span>Max speed</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {stackRef.current ? stackRef.current.maxVelocity.toFixed(2) : '—'} m/s
            </span>
            <span>Flooded</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {stats.floodedPct.toFixed(1)} %
            </span>
            <span>Domain</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {stats.extentKm.toFixed(1)} km
            </span>
          </div>

          <KaggleLegend
            title="Water depth"
            unit="m"
            min={0}
            max={stats.maxDepth}
            colormap={getColormap(scheme, DEPTH_COLORMAP)}
            scheme={scheme}
            schemes={SCHEMES}
            onSchemeChange={setScheme}
            opacity={layerOpacity}
            onOpacityChange={setLayerOpacity}
            decimals={2}
          />
        </div>
      )}
    </div>
  );
}
