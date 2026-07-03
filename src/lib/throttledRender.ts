/**
 * Throttled Render — P0 Performance Optimization
 *
 * The CesiumJS globe has 42+ places calling scene.requestRender() independently.
 * Each call forces a GPU frame render. When many fire in the same tick (e.g. from
 * postRender handlers, setInterval callbacks, and entity updates), this causes
 * excessive GPU usage and device heat.
 *
 * This utility coalesces all requestRender() calls into at most ONE per
 * requestAnimationFrame frame, keeping the same visual result with a fraction
 * of the GPU cost.
 */

import type * as Cesium from 'cesium';

let pending = false;
let viewerRef: Cesium.Viewer | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

const FALLBACK_TIMEOUT_MS = 200;

function doRender() {
  if (!pending) return; // already rendered — prevents double-render race
  pending = false;
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  if (viewerRef && !viewerRef.isDestroyed()) {
    viewerRef.scene.requestRender();
  }
}

/**
 * Schedule a single Cesium render for the next animation frame.
 * Multiple calls within the same frame are coalesced into one.
 * A setTimeout fallback ensures rendering even when the tab is backgrounded.
 */
export function throttledRender(viewer?: Cesium.Viewer | null): void {
  if (viewer) viewerRef = viewer;
  if (pending) return; // already scheduled
  pending = true;
  requestAnimationFrame(doRender);
  // Fallback: if rAF is frozen (backgrounded tab), render after timeout
  fallbackTimer = setTimeout(doRender, FALLBACK_TIMEOUT_MS);
}

