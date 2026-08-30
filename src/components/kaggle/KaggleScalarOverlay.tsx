/**
 * KaggleScalarOverlay — shared 3D CFD overlay primitive stack.
 *
 * All hazard overlays follow the same pattern: fetch simulation series,
 * sample terrain, instantiate ScalarSurfacePrimitive (+ ArrowFieldPrimitive
 * + ParticleAdvector when velocity fields exist), and wire frame/opacity UI.
 *
 * This component owns the lifecycle; subclasses/hazards pass configuration.
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
} from './shared';
import type { SchemeOption } from './KaggleLegend';
import KaggleLegend from './KaggleLegend';
import KaggleAnimationControls from './KaggleAnimationControls';
import { ScalarSurfacePrimitive } from './gpu/ScalarSurfacePrimitive';
import { ArrowFieldPrimitive } from './gpu/ArrowFieldPrimitive';
import type { CfaColormapName } from './gpu/cfdColormaps';
import { sampleDomainTerrain } from './gpu/terrain';
import { buildGeoFrame } from './gpu/fieldData';

export interface ScalarOverlayFieldSpec {
  /** Name of the final-frame scalar grid npy (e.g. 'water_depth_final'). */
  finalName: string;
  /** Name of the [F,R,C] snapshot series npy. Optional; falls back to final. */
  seriesName?: string;
  /** Name of vx snapshot series npy. */
  vxName?: string;
  /** Name of vy snapshot series npy. */
  vyName?: string;
  /** Final-frame vx npy (when vx snapshot missing). */
  vxFinalName?: string;
  /** Final-frame vy npy. */
  vyFinalName?: string;
  /** Snapshot-time series npy. */
  timeName?: string;
}

export interface ScalarOverlayConfig {
  /** Kaggle sim type key (for resolveCellSizeM). */
  typeKey: string;
  /** UI header label (e.g. 'Kaggle Flood CFD'). */
  title: string;
  /** UI accent color. */
  accent: string;
  /** Npy field names for the scalar + vector + times series. */
  fields: ScalarOverlayFieldSpec;
  /** Legend colormap when the user selects "default". */
  defaultColormap: ColorStop[];
  /** GLSL colormap used by the surface primitive. */
  surfaceColormap: CfaColormapName;
  /** GLSL colormap used by the arrow field (when vectors exist). */
  arrowColormap: CfaColormapName;
  /** Vertical exaggeration (meters per normalized scalar unit). */
  exaggeration: number;
  /** Value threshold below which fragments are invisible. */
  alphaFloor: number;
  /** Side-wall tint on the displaced surface. */
  sideTint: boolean;
  /** extra fetchGrid npy names for auxiliary stats (e.g. runout). */
  auxFetchNames?: string[];
  /** Stats printer populating the bottom panel. */
  formatStats?: (ctx: {
    gs: number;
    cellSizeM: number;
    series: GridData | null;
    surface: ScalarSurfacePrimitive;
    arrows: ArrowFieldPrimitive | null;
    aux: Record<string, GridData>;
    rect: Cesium.Rectangle;
    domainKm: number;
    /** Per-frame times (same units as the snapshot_times npy). */
    times: number[];
    /** Parsed metadata.json for the run (mass balance, completion, …). */
    metadata: Record<string, unknown> | null;
  }) => Array<[string, string]>;
  /** Time label formatter for AnimationControls. */
  formatTime?: (t: number) => string;
  /**
   * Physical unit the primary scalar field is measured in ('m', 'cm/s²',
   * 'kW/m', 'kg/m²', 'm/s', …). Drives the legend scale label.
   */
  legendUnit?: string;
  /** Colormap options available in the Legend UI. */
  schemes?: SchemeOption[];
  /** Animation frames per second (default 4). */
  fps?: number;
}

export interface ScalarOverlayProps {
  viewer: Cesium.Viewer | null;
  jobId: string | null;
  lat: number;
  lon: number;
  gridSizeKm?: number;
  opacity?: number;
  onDismiss?: () => void;
  config: ScalarOverlayConfig;
}

interface GpuStack {
  surface: ScalarSurfacePrimitive;
  arrows: ArrowFieldPrimitive | null;
  frames: number;
  times: number[];
  boundary: Cesium.Entity;
}

/** The shared scalar-overlay body consumed by every hazard overlay. */
export function KaggleScalarOverlay({
  viewer,
  jobId,
  lat,
  lon,
  gridSizeKm,
  opacity = 0.85,
  onDismiss,
  config,
}: ScalarOverlayProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scheme, setScheme] = useState('default');
  const [dismissHovered, setDismissHovered] = useState(false);
  const [layerOpacity, setLayerOpacity] = useState(opacity);
  const [stats, setStats] = useState<Array<[string, string]> | null>(null);

  const loadedJobRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stackRef = useRef<GpuStack | null>(null);

  const cleanup = useCallback(() => {
    const s = stackRef.current;
    if (!s) return;
    s.surface.destroy();
    s.arrows?.destroy();
    if (viewer && typeof viewer.isDestroyed === 'function' && !viewer.isDestroyed()) {
      try {
        viewer.entities.remove(s.boundary);
      } catch {
        /* entities may be gone if the viewer is mid-teardown */
      }
    }
    stackRef.current = null;
  }, [viewer]);

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
    // NOTE: loadedJobRef is stamped only on *success*; a failed build must stay
    // retryable for the same jobId (e.g. transient 404 during result write).

    try {
      const { fields } = config;
      const names: string[] = [
        fields.finalName,
        fields.seriesName ?? '__',
        fields.vxName ?? '__',
        fields.vyName ?? '__',
        fields.vxFinalName ?? '__',
        fields.vyFinalName ?? '__',
        fields.timeName ?? '__',
        ...(config.auxFetchNames ?? []),
      ];
      // fetchGrid can't accept '__' — fire with a filter pass
      const fetches = names.map((n) =>
        n === '__' ? Promise.resolve(null) : fetchGrid(jobId, n, controller.signal),
      );
      const [meta, ...grids] = await Promise.all([
        fetchSimMeta(jobId, controller.signal),
        ...fetches,
      ]);
      if (controller.signal.aborted) return;

      // DEBUG: trace which grid failed
      const fetchStatuses = grids.map((g, i) => ({ i, name: names[i], ok: !!g, shape: g?.shape }));
      console.log('[ScalarOverlay] fetch results:', fetchStatuses);

      const finalGrid = grids[0];
      if (!finalGrid) {
        setError(`Failed to fetch ${fields.finalName}`);
        return;
      }

      const gs = finalGrid.shape[0] || 512;
      const seriesGrid =
        grids[1] && (grids[1] as GridData).shape.length === 3
          ? toFrameSeries(grids[1] as GridData, [], gs, gs)
          : toFrameSeries(
              {
                shape: [1, gs, gs],
                values: Array.from(finalGrid.values),
              },
              [],
              gs,
              gs,
            );

      const vxSeries =
        (grids[2] && (grids[2] as GridData).shape.length === 3
          ? toFrameSeries(grids[2] as GridData, [], gs, gs)
          : grids[4]
            ? toFrameSeries(
                { shape: [1, gs, gs], values: Array.from((grids[4] as GridData).values) },
                [],
                gs,
                gs,
              )
            : null) as GridData | null;
      const vySeries =
        (grids[3] && (grids[3] as GridData).shape.length === 3
          ? toFrameSeries(grids[3] as GridData, [], gs, gs)
          : grids[5]
            ? toFrameSeries(
                { shape: [1, gs, gs], values: Array.from((grids[5] as GridData).values) },
                [],
                gs,
                gs,
              )
            : null) as GridData | null;

      const timesGrid = grids[6] as GridData | null;
      const aux = (config.auxFetchNames ?? [])
        .map((name, i) => [name, grids[7 + i]] as [string, GridData])
        .reduce(
          (acc, [n, g]) => {
            acc[n] = g;
            return acc;
          },
          {} as Record<string, GridData>,
        );

      const frames = seriesGrid ? seriesGrid.shape[0] : 1;
      const times: number[] = timesGrid && timesGrid.values.length >= frames
        ? timesGrid.values.slice(0, frames)
        : Array.from({ length: frames }, (_, i) => i);

      const cellSizeM = resolveCellSizeM(config.typeKey, meta);
      const km = gridSizeKm && gridSizeKm > 0 ? gridSizeKm : extentKm(gs, cellSizeM);
      const rect = computeGridRectangle(lat, lon, km);

      const geoFrame = buildGeoFrame(lat, lon, gs, cellSizeM);

      // Build (or rebuild) the GPU stack for a given terrain heightfield.
      // Reused when Cesium streams tiles in: the surface re-seats onto the real
      // terrain instead of floating at the 0 m fallback. The same geo-frame,
      // grid size and center are used every time, so the lava stays centered
      // on the vent — only its elevation tracks the terrain.
      const buildStack = (stackTerrain: Float32Array) => {
        if (controller.signal.aborted) return;
        const prev = stackRef.current;
        if (prev) {
          try { prev.surface.destroy(); } catch { /* already gone */ }
          if (prev.arrows) { try { prev.arrows.destroy(); } catch { /* already gone */ } }
          try { viewer.entities.remove(prev.boundary); } catch { /* already gone */ }
        }
        const surface = new ScalarSurfacePrimitive({
          viewer,
          centerLat: lat,
          centerLon: lon,
          gs,
          cellSizeM,
          series: seriesGrid!, // frames are known
          times,
          terrain: stackTerrain,
          exaggeration: config.exaggeration,
          colormap: config.surfaceColormap,
          alphaFloor: config.alphaFloor,
          sideTint: config.sideTint,
        });
        let arrows: ArrowFieldPrimitive | null = null;
        if (vxSeries && vySeries) {
          arrows = new ArrowFieldPrimitive({
            viewer,
            centerLat: lat,
            centerLon: lon,
            gs,
            cellSizeM,
            vxSeries,
            vySeries,
            terrain: stackTerrain,
            // Ride the displaced debris surface: arrows hover `lift` meters above
            // the surface (which rises to (depth/maxDepth)*exaggeration), instead
            // of being buried under it at bare-terrain height.
            depthSeries: seriesGrid as GridData,
            exaggeration: config.exaggeration,
            lift: config.exaggeration * 0.12,
            stride: Math.max(1, Math.ceil(gs / 72)), // ~72 max across domain
            minLen: cellSizeM * 0.55,
            lenScale: cellSizeM * 2.2,
            thickness: 0.08,
            colormap: config.arrowColormap,
          });
        }
        const boundary = addDomainBoundary(
          viewer,
          rect,
          Cesium.Color.fromCssColorString(config.accent),
        );
        stackRef.current = { surface, arrows, frames, times, boundary };
      };

      // Initial build with whatever terrain is currently streamed. If some cells
      // missed (0 m fallback), sampleDomainTerrain also arms `onRefined` to
      // re-sample as tiles arrive and call buildStack again with real heights.
      const terrain = sampleDomainTerrain(
        {
          viewer,
          frame: geoFrame,
          outGs: gs,
          // Sample terrain at the full overlay resolution so the lava base
          // equals globe.getHeight at every cell (bilinearUpsample becomes an
          // identity pass). A coarse 72-point sample over a steep volcano leaves
          // the surface floating slightly above the real relief.
          coarseLimit: Math.min(gs, 256),
          debugName: `${config.typeKey}-${jobId}`,
        },
        buildStack,
      );
      buildStack(terrain);
      const surface = stackRef.current!.surface;
      const arrows = stackRef.current!.arrows;

      // The viewer runs in requestRenderMode (on-demand rendering), so a newly
      // added surface/arrows primitive stays invisible until something calls
      // scene.requestRender(). Without this the result only appears after the
      // user nudges a control (e.g. changing the colour scheme, which happens
      // to call requestRender via setColormap). Render immediately instead.
      try { viewer.scene.requestRender(); } catch { /* viewer may be torn down */ }

      loadedJobRef.current = jobId;

      // Stats
      if (config.formatStats) {
        setStats(
          config.formatStats({
            gs,
            cellSizeM,
            series: seriesGrid as GridData | null,
            surface,
            arrows,
            aux,
            rect,
            domainKm: km,
            times,
            metadata: meta,
          }),
        );
      } else {
        setStats([
          ['Frames', String(frames)],
          ['Domain', km.toFixed(1) + ' km'],
          ['Max', String(surface.maxValue.toFixed(2))],
        ]);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      // Debug: log the real exception so we can see what actually broke
      // (was swallowing TypeError inside GPU primitive construction).
      console.error(`[KaggleScalarOverlay] build failed for ${config.typeKey} jobId=${jobId}:`, err);
      setError(err instanceof Error ? `${err.message} (see console)` : `Failed to build ${config.typeKey} overlay`);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [viewer, jobId, lat, lon, gridSizeKm, config, cleanup]);

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
      controllerCleanup();
    };
    function controllerCleanup() {
      if (abortRef.current) abortRef.current.abort();
    }
  }, [jobId, buildOverlay, cleanup]);

  useEffect(() => {
    const s = stackRef.current;
    if (!s) return;
    s.surface.setFrame(frame);
    s.arrows?.setFrame(frame);
    // The viewer runs in requestRenderMode — uniform updates from setFrame
    // may not trigger a repaint reliably across all browsers without a
    // redundant requestRender here (belt-and-suspenders).
    try { viewer?.scene.requestRender(); } catch { /* teardown */ }
  }, [frame, viewer, cleanup]);

  useEffect(() => {
    stackRef.current?.surface.setOpacity(layerOpacity);
    stackRef.current?.arrows?.setOpacity(layerOpacity);
  }, [layerOpacity]);

  // ── Play/pause — toggling must also force a render, because the viewer runs
  // in requestRenderMode and only repaints when something calls requestRender.
  // Without this, clicking Play changes the state but the first animated frame
  // never paints until the user nudges another control.
  const handleTogglePlay = useCallback(() => {
    setPlaying((p) => {
      const next = !p;
      if (next) {
        try { viewer?.scene.requestRender(); } catch { /* teardown */ }
      }
      return next;
    });
  }, [viewer]);

  // ── Scheme change — swap the baked GLSL colormap on every primitive ─────────
  useEffect(() => {
    const s = stackRef.current;
    if (!s) return;
    const gpu = schemeToCfa(scheme, config.surfaceColormap);
    s.surface.setColormap(gpu);
    s.arrows?.setColormap(gpu);
  }, [scheme, config.surfaceColormap]);

  if (!jobId) return null;
  const seriesFrames = stackRef.current?.frames ?? 0;

  return (
    <div
      style={{
        position: 'absolute', bottom: 80, right: 20, zIndex: 100,
        background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(10px)',
        borderRadius: 8, padding: '10px 13px', fontSize: 11, color: '#fff',
        border: `1px solid ${config.accent}60`, maxWidth: 280,
      }}
    >
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 10, height: 10,
              border: `2px solid ${config.accent}`,
              borderTopColor: 'transparent', borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
          Loading {config.title}…
        </div>
      )}
      {error && <div style={{ color: '#ef4444' }}>Error: {error}</div>}
      {stats && !loading && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: config.accent }}>
              {config.title}
            </span>
            {onDismiss && (
              <button
                onClick={onDismiss}
                onMouseEnter={() => setDismissHovered(true)}
                onMouseLeave={() => setDismissHovered(false)}
                style={{
                  background: dismissHovered ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: 4, color: '#fff', fontSize: 10,
                  padding: '2px 8px', cursor: 'pointer',
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
              onTogglePlay={handleTogglePlay}
              times={stackRef.current?.times ?? []}
              formatTime={config.formatTime ?? ((t) => `${t.toFixed(1)}`)}
              fps={config.fps}
            />
          )}

          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: '2px 8px', fontSize: 10, opacity: 0.85, marginTop: 4,
          }}>
            {stats.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <span>{k}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
              </div>
            ))}
          </div>

          <KaggleLegend
            title={config.title}
            unit={config.legendUnit ?? 'm'}
            min={0}
            max={stackRef.current?.surface.maxValue ?? 1}
            colormap={getColormap(scheme, config.defaultColormap)}
            scheme={scheme}
            schemes={config.schemes ?? []}
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
