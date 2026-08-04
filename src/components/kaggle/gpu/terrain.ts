/**
 * terrain.ts — domain-level terrain sampling for displacement stacks.
 *
 * Queries the Cesium globe's current terrain provider directly at the
 * center of each terrain cell (fast, synchronous) and bilinearly
 * upsamples low-resolution samples to overlay resolution.
 *
 * If the provider is the default `EllipsoidTerrainProvider` (flat globe),
 * all outputs are 0 meters — the OpenGL displacement is still correct,
 * because vertex world positions coincide with the ellipsoid terrain.
 */

import * as Cesium from 'cesium';
import {
  cellToLatLon,
  bilinearUpsample,
} from './fieldData';
import type { GeoFrame } from './fieldData';

export interface SampleOptions {
  viewer: Cesium.Viewer;
  frame: GeoFrame;
  /** Target output resolution [gs × gs]. */
  outGs: number;
  /**
   * Max dimension of direct globe sampling (sub-sampled first, then
   * bilinearly interpolated to outGs). Higher = more correct + slower.
   * Default 64 (→ 4096 samples).
   */
  coarseLimit?: number;
  /** Name for debug logging. */
  debugName?: string;
}

/**
 * Synchronously query terrain heights at the domain.
 * Returns Float32Array[outGs*outGs] of meters above WGS84 ellipsoid.
 *
 * NOTE: `globe.getHeight()` is a tile-cache lookup, not a raycast — tiles
 * that have not streamed yet return `undefined` and silently fall back to 0 m.
 * To avoid permanently-flat output at high relief, this helper also watches
 * `globe.tileLoadedEvent` for up to `maxWaitMs` after the last sample and
 * re-invokes itself once tiles arrive, returning the refined array via
 * `onRefined` (which the caller can use to rebuild the geometry).
 */
export function sampleDomainTerrain(
  opts: SampleOptions,
  onRefined?: (elevations: Float32Array) => void,
): Float32Array {
  const { viewer, frame, outGs } = opts;
  const coarseLimit = Math.max(8, Math.min(256, opts.coarseLimit ?? 72));
  const coarseGs = Math.min(coarseLimit, outGs);

  const coarse = new Float32Array(coarseGs * coarseGs);
  const globe = viewer.scene.globe;
  let hits = 0;
  let misses = 0;

  for (let r = 0; r < coarseGs; r++) {
    for (let c = 0; c < coarseGs; c++) {
      // Sample at (row, col) in domain coordinate space.
      const s = (c / Math.max(1, coarseGs - 1));
      const t = (r / Math.max(1, coarseGs - 1));
      const cell = cellToLatLon(frame, s * (outGs - 1), t * (outGs - 1));
      const carto = Cesium.Cartographic.fromDegrees(cell.lon, cell.lat);
      const h = globe.getHeight(carto);
      if (h !== undefined && Number.isFinite(h)) {
        coarse[r * coarseGs + c] = h;
        hits++;
      } else {
        coarse[r * coarseGs + c] = 0;
        misses++;
      }
    }
  }

  if (opts.debugName) {
    console.debug(
      `[terrain:${opts.debugName}] sampled ${hits}/${hits + misses} coarse cells ` +
      `(${coarseGs}×${coarseGs} → ${outGs}×${outGs} bilinear upsample); ` +
      `misses fall back to 0.`,
    );
  }

  const firstPass = bilinearUpsample(coarse, coarseGs, coarseGs, outGs, outGs);

  // If every sample missed (tiles not streamed yet), we return a flat array
  // immediately and subscribe to tile loads to refine later. Without this,
  // overlays built right after a camera move are permanently flat.
  if (misses > 0 && onRefined) {
    let remove: (() => void) | null = null;
    const listener = () => {
      // Debounce: let tiles settle before resampling.
      if (remove) {
        remove();
        remove = null;
      }
      // Resync synchronously once — subsequent tile loads merely increase detail.
      const refined = sampleDomainTerrain({ ...opts });
      onRefined(refined);
    };
// Sample each tile-loaded event once, then unsubscribe to avoid thrash.
  const globeLoose = globe as unknown as { tileLoadedEvent: Cesium.Event };
  globeLoose.tileLoadedEvent.addEventListener(listener);
  remove = () => globeLoose.tileLoadedEvent.removeEventListener(listener);
  }

  return firstPass;
}
