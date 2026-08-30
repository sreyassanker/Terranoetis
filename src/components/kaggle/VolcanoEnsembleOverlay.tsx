/**
 * VolcanoEnsembleOverlay — decision-grade Monte-Carlo uncertainty overlay.
 *
 * Renders the percentile ash-fall / lava-thickness maps (P5 / P50 / P95) from
 * the `/api/kaggle/volcano/quantify` ensemble as Cesium imagery layers, plus a compact
 * panel of the ensemble summary. The 3D surface primitive from the single-run
 * overlay is deliberately NOT reused here: for a decision-maker the percentile
 * rasters ARE the product, and 2D imagery is the honest way to show them.
 *
 * Layer legend:
 *   P5  — "confidently affected" (5th percentile: where ash IS almost always)
 *   P50 — median expectation
 *   P95 — "worst plausible" (95th percentile: conservative planning envelope)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { X } from 'lucide-react';
import {
  addCanvasLayer,
  buildColoredCanvas,
  computeGridRectangle,
  getColormap,
  type ColorStop,
} from './shared';

// ── Ash-fall colormap: transparent → light ash → heavy dark pumice ─────────
const ASH_FALL_COLORMAP: ColorStop[] = [
  { stop: 0.0, r: 240, g: 240, b: 230 },   // light ash
  { stop: 0.35, r: 200, g: 180, b: 150 },   // sandy ash
  { stop: 0.7, r: 150, g: 120, b: 90 },     // pumice
  { stop: 1.0, r: 90, g: 60, b: 40 },       // heavy dark deposit
];

// Lava: cooled crust → incandescent (mirrors KaggleVolcanoOverlay)
const ENS_LAVA_COLORMAP: ColorStop[] = [
  { stop: 0.0, r: 25, g: 15, b: 10 },
  { stop: 0.25, r: 100, g: 25, b: 10 },
  { stop: 0.5, r: 200, g: 45, b: 10 },
  { stop: 0.75, r: 250, g: 130, b: 25 },
  { stop: 1.0, r: 255, g: 230, b: 120 },
];

export interface VolcanicEnsembleResult {
  gs: number;
  exceedance_threshold_mm: number;
  ash_p5: number[];
  ash_p50: number[];
  ash_p95: number[];
  ash_mean: number[];
  ash_min: number[];
  ash_max: number[];
  ash_exceedance: number[];
  lava_p5: number[];
  lava_p50: number[];
  lava_p95: number[];
  lava_mean: number[];
  lava_min: number[];
  lava_max: number[];
  lava_exceedance: number[];
  summary: {
    n: number;
    p50_max_ash_mm: number;
    p95_max_ash_mm: number;
    max_ash_mm: number;
    p50_max_lava_m: number;
    p95_max_lava_m: number;
    max_lava_m: number;
    mean_plume_height_km: number;
    p50_plume_height_km: number;
    area_ash_exceeded_pct: number;
    member_max_ash_mm: number[];
    member_max_lava_m: number[];
    member_plume_height_km: number[];
    member_settling_velocity_ms: number[];
  };
}

export interface VolcanoEnsembleOverlayProps {
  viewer: Cesium.Viewer | null;
  result: VolcanicEnsembleResult;
  lat: number;
  lon: number;
  /** Cell size in meters (defaults to the volcano kernel's 50 m). */
  cellSizeM?: number;
  onDismiss?: () => void;
}

type PercentileKey = 'p5' | 'p50' | 'p95';
type FieldKey = 'ash' | 'lava';

const PERCENTILE_META: Record<PercentileKey, { label: string; desc: string }> = {
  p5: { label: 'P5 · confident', desc: 'Plausible lower bound — where the hazard almost certainly reaches' },
  p50: { label: 'P50 · median', desc: 'Median expectation across the ensemble' },
  p95: { label: 'P95 · worst case', desc: 'Conservative planning envelope (95th percentile)' },
};

export default function VolcanoEnsembleOverlay({
  viewer,
  result,
  lat,
  lon,
  cellSizeM = 50,
  onDismiss,
}: VolcanoEnsembleOverlayProps) {
  const [field, setField] = useState<FieldKey>('ash');
  const [pct, setPct] = useState<PercentileKey>('p95');
  const [opacity, setOpacity] = useState(0.8);
  const [showExceedance, setShowExceedance] = useState(false);

  const layersRef = useRef<Cesium.ImageryLayer[]>([]);

  const removeLayers = useCallback(() => {
    if (!viewer) return;
    for (const layer of layersRef.current) {
      try { viewer.scene.imageryLayers.remove(layer); } catch { /* mid-teardown */ }
    }
    layersRef.current = [];
  }, [viewer]);

  // Rebuild imagery whenever the selected field / percentile / scheme changes.
  useEffect(() => {
    if (!viewer) return;
    removeLayers();
    const gs = result.gs || 128;
    const fieldKey = field === 'ash' ? 'ash' : 'lava';
    const valuesKey = showExceedance
      ? `${fieldKey}_exceedance`
      : `${fieldKey}_${pct}`;
    const values = (result as unknown as Record<string, number[]>)[valuesKey];
    if (!values) return;

    // Exceedance is a probability 0..1 — render on its own scale.
    const isProb = showExceedance;
    const colormap = isProb
      ? getColormap('inferno', ENS_LAVA_COLORMAP)
      : field === 'ash'
        ? getColormap('default', ASH_FALL_COLORMAP)
        : getColormap('default', ENS_LAVA_COLORMAP);

    // Fixed normalization: the P95 max is the legend ceiling, so all three
    // percentile layers share one scale and are directly comparable.
    const raw = field === 'ash'
      ? result.ash_p95
      : result.lava_p95;
    const p95Max = raw.reduce((a, b) => (b > a ? b : a), 0);
    const legendMax = isProb ? 1 : Math.max(p95Max, 1e-9);

    const canvas = buildColoredCanvas({
      size: gs,
      values,
      colormap,
      nodata: isProb ? 0.001 : 0.01,
      maxValue: legendMax,
      clampMax: false,
    });

    const km = (gs * cellSizeM) / 1000;
    const rect = computeGridRectangle(lat, lon, km);
    const layer = addCanvasLayer(viewer, canvas, rect, opacity, `volcano-ens-${field}-${pct}`);
    layersRef.current.push(layer);
    // The viewer uses requestRenderMode — new imagery layers need an explicit
    // render request or they stay invisible until the user nudges a control.
    try { viewer.scene.requestRender(); } catch { /* viewer may be torn down */ }
    return () => { removeLayers(); };
  }, [viewer, result, field, pct, opacity, showExceedance, cellSizeM, lat, lon, removeLayers]);

  useEffect(() => () => removeLayers(), [removeLayers]);

  // Max values for legend display
  const legendMax = field === 'ash' ? result.ash_p95.reduce((a, b) => (b > a ? b : a), 0) : result.lava_p95.reduce((a, b) => (b > a ? b : a), 0);
  const s = result.summary;

  return (
    <div
      style={{
        position: 'absolute', bottom: 80, right: 20, zIndex: 100,
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)',
        borderRadius: 8, padding: '10px 13px', fontSize: 11, color: '#fff',
        border: '1px solid rgba(234,88,12,0.6)', maxWidth: 300,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 700, color: '#fb923c' }}>
          Volcano Ensemble UQ
        </span>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 4, color: '#fff', fontSize: 10, padding: '2px 8px', cursor: 'pointer',
            }}
            title="Remove ensemble overlay"
          >
            <X size={10} />
          </button>
        )}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-muted, #9ca3af)', marginBottom: 6 }}>
        {s.n}-member Monte-Carlo over wind / ash properties / intensity · real terrain
      </div>

      {/* Field toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {(['ash', 'lava'] as FieldKey[]).map((f) => (
          <button
            key={f}
            onClick={() => setField(f)}
            style={{
              flex: 1, fontSize: 10, padding: '3px 6px', borderRadius: 4, cursor: 'pointer',
              background: field === f ? 'rgba(234,88,12,0.3)' : 'rgba(255,255,255,0.08)',
              border: field === f ? '1px solid rgba(234,88,12,0.6)' : '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
            }}
          >
            {f === 'ash' ? 'Ash fall (mm)' : 'Lava (m)'}
          </button>
        ))}
      </div>

      {/* Percentile selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {(['p5', 'p50', 'p95'] as PercentileKey[]).map((p) => (
          <button
            key={p}
            onClick={() => { setPct(p); setShowExceedance(false); }}
            style={{
              flex: 1, fontSize: 10, padding: '3px 6px', borderRadius: 4, cursor: 'pointer',
              background: pct === p && !showExceedance ? 'rgba(234,88,12,0.3)' : 'rgba(255,255,255,0.08)',
              border: pct === p && !showExceedance ? '1px solid rgba(234,88,12,0.6)' : '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
            }}
            title={PERCENTILE_META[p].desc}
          >
            {PERCENTILE_META[p].label}
          </button>
        ))}
        <button
          onClick={() => setShowExceedance((v) => !v)}
          style={{
            flex: 1, fontSize: 10, padding: '3px 6px', borderRadius: 4, cursor: 'pointer',
            background: showExceedance ? 'rgba(234,88,12,0.3)' : 'rgba(255,255,255,0.08)',
            border: showExceedance ? '1px solid rgba(234,88,12,0.6)' : '1px solid rgba(255,255,255,0.2)',
            color: '#fff',
          }}
          title="Fraction of members exceeding the ash threshold at each cell"
        >
          P(×)
        </button>
      </div>
      <div style={{ fontSize: 9, color: '#9ca3af', marginBottom: 6, lineHeight: 1.35, minHeight: 24 }}>
        {showExceedance
          ? `Exceedance probability (ash > ${result.exceedance_threshold_mm.toFixed(2)} mm)`
          : PERCENTILE_META[pct].desc}
      </div>

      {/* Legend strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 9, opacity: 0.7 }}>0</span>
        <div style={{
          flex: 1, height: 8, borderRadius: 3,
          background: `linear-gradient(to right, ${(showExceedance
            ? getColormap('inferno', ENS_LAVA_COLORMAP)
            : field === 'ash'
              ? getColormap('default', ASH_FALL_COLORMAP)
              : getColormap('default', ENS_LAVA_COLORMAP)
          ).map((c) => `rgb(${c.r},${c.g},${c.b}) ${Math.round(c.stop * 100)}%`).join(', ')})`,
        }} />
        <span style={{ fontSize: 9, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
          {showExceedance ? '100%' : legendMax.toFixed(field === 'ash' ? 1 : 2)}
        </span>
      </div>

      {/* Opacity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 9, opacity: 0.7 }}>Opacity</span>
        <input
          type="range" min={0} max={100} value={Math.round(opacity * 100)}
          onChange={(e) => setOpacity(Number(e.target.value) / 100)}
          style={{ flex: 1, accentColor: '#fb923c' }}
        />
      </div>

      {/* Summary */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', fontSize: 9.5, opacity: 0.9 }}>
        <span>Max ash · P50 / P95</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {s.p50_max_ash_mm.toFixed(1)} / {s.p95_max_ash_mm.toFixed(1)} mm
        </span>
        <span>Max lava · P50 / P95</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {s.p50_max_lava_m.toFixed(1)} / {s.p95_max_lava_m.toFixed(1)} m
        </span>
        <span>Plume height · med</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{s.p50_plume_height_km.toFixed(1)} km</span>
        <span>Ash exceedance area</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{(s.area_ash_exceeded_pct * 100).toFixed(1)}%</span>
        <span>Ensemble size</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{s.n} members</span>
      </div>

      {/* Method footnote */}
      <div style={{ fontSize: 8.5, color: '#6b7280', marginTop: 6, lineHeight: 1.4, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 5 }}>
        Perturbed: wind speed (σ 25%), wind direction (σ 20°), ash diameter, diffusivity, wind shear, intensity (×0.3–3.0).
        Percentiles are computed per cell across all members. P5 = confident, P95 = conservative planning envelope.
      </div>
    </div>
  );
}
