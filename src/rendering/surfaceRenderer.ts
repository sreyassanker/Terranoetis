import * as Cesium from 'cesium';
import { renderGridToCanvas } from './idwInterpolation';
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

export function getViewDependentResolution(
  cameraAlt: number,
  maxGrid: number = 400,
): { width: number; height: number } {
  if (cameraAlt > 500000) return { width: 50, height: 50 };
  if (cameraAlt > 100000) return { width: 100, height: 100 };
  if (cameraAlt > 20000) return { width: 200, height: 200 };
  return { width: maxGrid, height: maxGrid };
}

function renderConfidenceToCanvas(grid: InterpGrid): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(grid.width, grid.height);

  let varMin = Infinity;
  let varMax = -Infinity;
  for (let i = 0; i < grid.variance.length; i++) {
    const v = grid.variance[i];
    if (v < varMin) varMin = v;
    if (v > varMax) varMax = v;
  }
  const span = varMax - varMin || 1;

  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const idx = row * grid.width + col;
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
      const pi = idx * 4;
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
): void {
  clearInterpSurface(viewer);

  const canvas = renderGridToCanvas(grid, colors);
  const url = canvas.toDataURL('image/png');
  const rect = Cesium.Rectangle.fromDegrees(grid.lonMin, grid.latMin, grid.lonMax, grid.latMax);
  const provider = new Cesium.SingleTileImageryProvider({ url, rectangle: rect, tileWidth: grid.width, tileHeight: grid.height });
  surfaceLayer = viewer.scene.imageryLayers.addImageryProvider(provider);
  surfaceLayer.alpha = opacity;
  (surfaceLayer as unknown as { name: string }).name = 'interp_surface';

  if (showConfidence && grid.variance.length > 0) {
    const confCanvas = renderConfidenceToCanvas(grid);
    const confUrl = confCanvas.toDataURL('image/png');
    const confProvider = new Cesium.SingleTileImageryProvider({ url: confUrl, rectangle: rect, tileWidth: grid.width, tileHeight: grid.height });
    confidenceLayer = viewer.scene.imageryLayers.addImageryProvider(confProvider);
    confidenceLayer.alpha = 0.4;
    (confidenceLayer as unknown as { name: string }).name = 'confidence_overlay';
  }
}

export function clearInterpSurface(viewer: Cesium.Viewer): void {
  if (surfaceLayer) {
    viewer.scene.imageryLayers.remove(surfaceLayer, true);
    surfaceLayer = null;
  }
  if (confidenceLayer) {
    viewer.scene.imageryLayers.remove(confidenceLayer, true);
    confidenceLayer = null;
  }
}

export function updateInterpSurfaceOpacity(viewer: Cesium.Viewer, opacity: number): void {
  if (surfaceLayer) {
    surfaceLayer.alpha = opacity;
  }
}

export function isConfidenceVisible(): boolean {
  return confidenceLayer !== null;
}
