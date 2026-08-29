import * as Cesium from 'cesium';
import { renderGridToCanvas, pointInRing } from './idwInterpolation';
import type { InterpGrid } from './idwInterpolation';

const DEFAULT_COLORS = [
  { stop: 0.0, r: 20, g: 40, b: 180 },
  { stop: 0.25, r: 30, g: 120, b: 220 },
  { stop: 0.5, r: 50, g: 200, b: 100 },
  { stop: 0.75, r: 220, g: 200, b: 50 },
  { stop: 1.0, r: 200, g: 30, b: 30 },
];

const CONFIDENCE_COLORS = [
  { stop: 0.0, r: 200, g: 200, b: 200 },
  { stop: 1.0, r: 0, g: 180, b: 0 },
];

let surfaceLayer: Cesium.ImageryLayer | null = null;
let confidenceLayer: Cesium.ImageryLayer | null = null;

/** The currently displayed interpolation grid, kept so the globe's mouse-move
 *  handler can look up the exact value at the hovered pixel (raster probe). */
let currentGrid: InterpGrid | null = null;

export function getCurrentGrid(): InterpGrid | null {
  return currentGrid;
}

/** Map a geographic lat/lon to the nearest finite grid cell value, or NaN when
 *  the point falls outside the raster extent (or over a NaN cell). Uses
 *  cell-centre mapping matching the server's (r+0.5)/nLat sampling, so the
 *  probe value aligns exactly with the rendered pixel. */
export function probeGridValue(lat: number, lon: number): { value: number; lat: number; lon: number; cellX: number; cellY: number } | null {
  const g = currentGrid;
  if (!g) return null;
  if (lat < g.latMin || lat > g.latMax || lon < g.lonMin || lon > g.lonMax) return null;
  const x = Math.max(0, Math.min(g.width - 1, Math.floor((lon - g.lonMin) / (g.lonMax - g.lonMin || 1) * g.width)));
  const y = Math.max(0, Math.min(g.height - 1, Math.floor((lat - g.latMin) / (g.latMax - g.latMin || 1) * g.height)));
  // Grid row 0 = latMin (south). The data array is south-first, north-up
  // rendering does the flip — the probe reads the source grid directly.
  const v = g.data[y * g.width + x];
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return {
    value: v,
    lat: g.latMin + (y + 0.5) / g.height * (g.latMax - g.latMin),
    lon: g.lonMin + (x + 0.5) / g.width * (g.lonMax - g.lonMin),
    cellX: x,
    cellY: y,
  };
}

/** CSS vertical linear-gradient string for the heatmap legend bar, matching the
 *  color ramp used by renderGridToCanvas (same stops, same interpolation) and
 *  the landslide-simulation legend convention: low value at the bottom,
 *  high value at the top (linear-gradient to top). */
export function legendGradientCSS(colors: { stop: number; r: number; g: number; b: number }[] = DEFAULT_COLORS): string {
  const stops = colors
    .map(c => `rgb(${c.r},${c.g},${c.b}) ${Math.round(c.stop * 100)}%`)
    .join(', ');
  return `linear-gradient(to top, ${stops})`;
}

export function getViewDependentResolution(
  cameraAlt: number,
  maxGrid: number = 400,
): { width: number; height: number } {
  if (cameraAlt > 500000) return { width: 50, height: 50 };
  if (cameraAlt > 100000) return { width: 100, height: 100 };
  if (cameraAlt > 20000) return { width: 200, height: 200 };
  return { width: maxGrid, height: maxGrid };
}

function renderConfidenceToCanvas(
  grid: InterpGrid,
  maskPolygon?: Array<Array<[number, number]>>,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(grid.width, grid.height);
  // Same polygon mask as renderGridToCanvas: without it the confidence tint
  // covers the full bbox rectangle and visibly spills outside a drawn
  // polygon study area.
  const outerRing = maskPolygon && maskPolygon.length > 0 ? maskPolygon[0] : undefined;
  const dLon = (grid.lonMax - grid.lonMin) / grid.width;
  const dLat = (grid.latMax - grid.latMin) / grid.height;

  let varMin = Infinity;
  let varMax = -Infinity;
  for (let i = 0; i < grid.variance.length; i++) {
    const v = grid.variance[i];
    if (v < varMin) varMin = v;
    if (v > varMax) varMax = v;
  }
  const span = varMax - varMin || 1;

  for (let row = 0; row < grid.height; row++) {
    // Flip Y: grid row 0 = south → canvas bottom (north-up rendering).
    const canvasRow = grid.height - 1 - row;
    const lat = grid.latMin + (row + 0.5) * dLat;
    for (let col = 0; col < grid.width; col++) {
      const idx = row * grid.width + col;
      const pi = (canvasRow * grid.width + col) * 4;
      if (outerRing) {
        const lon = grid.lonMin + (col + 0.5) * dLon;
        if (!pointInRing(lon, lat, outerRing)) {
          image.data[pi + 3] = 0;
          continue;
        }
      }
      const t = (grid.variance[idx] - varMin) / span;
      let r = 0, g = 0, b = 0;
      for (let ci = 0; ci < CONFIDENCE_COLORS.length - 1; ci++) {
        const c0 = CONFIDENCE_COLORS[ci];
        const c1 = CONFIDENCE_COLORS[ci + 1];
        if (t >= c0.stop && t <= c1.stop) {
          const lt = (t - c0.stop) / (c1.stop - c0.stop);
          r = c0.r + (c1.r - c0.r) * lt;
          g = c0.g + (c1.g - c0.g) * lt;
          b = c0.b + (c1.b - c0.b) * lt;
          break;
        }
      }
      image.data[pi] = 255 - r;
      image.data[pi + 1] = 255 - g;
      image.data[pi + 2] = 255 - b;
      image.data[pi + 3] = 128;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function showInterpSurface(
  viewer: Cesium.Viewer,
  grid: InterpGrid,
  colors: { stop: number; r: number; g: number; b: number }[] = DEFAULT_COLORS,
  opacity: number = 0.65,
  showConfidence: boolean = false,
  maskPolygon?: Array<Array<[number, number]>>,
): void {
  clearInterpSurface(viewer);

  const canvas = renderGridToCanvas(grid, colors, maskPolygon);
  const url = canvas.toDataURL('image/png');
  const rect = Cesium.Rectangle.fromDegrees(grid.lonMin, grid.latMin, grid.lonMax, grid.latMax);
  const provider = new Cesium.SingleTileImageryProvider({ url, rectangle: rect, tileWidth: grid.width, tileHeight: grid.height });
  surfaceLayer = viewer.scene.imageryLayers.addImageryProvider(provider);
  surfaceLayer.alpha = opacity;
  (surfaceLayer as unknown as { name: string }).name = 'interp_surface';

  if (showConfidence && grid.variance.length > 0) {
    const confCanvas = renderConfidenceToCanvas(grid, maskPolygon);
    const confUrl = confCanvas.toDataURL('image/png');
    const confProvider = new Cesium.SingleTileImageryProvider({ url: confUrl, rectangle: rect, tileWidth: grid.width, tileHeight: grid.height });
    confidenceLayer = viewer.scene.imageryLayers.addImageryProvider(confProvider);
    confidenceLayer.alpha = 0.4;
    (confidenceLayer as unknown as { name: string }).name = 'confidence_overlay';
  }
  currentGrid = grid;
}

export function clearInterpSurface(viewer: Cesium.Viewer): void {
  currentGrid = null;
  if (surfaceLayer) {
    viewer.scene.imageryLayers.remove(surfaceLayer, true);
    surfaceLayer = null;
  }
  if (confidenceLayer) {
    viewer.scene.imageryLayers.remove(confidenceLayer, true);
    confidenceLayer = null;
  }
}


