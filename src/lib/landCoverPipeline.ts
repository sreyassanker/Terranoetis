/**
 * Land Cover Mapper Pipeline — Cesium capture to panoptic/spectral detection.
 *
 * Captures 3D WebGL scenes from Cesium, normalizes study areas to square rasters,
 * executes in-browser ML inference, and generates geospatial overlays.
 */

import * as Cesium from 'cesium';
import {
  LAND_COVER_CLASSES,
  classGridToCanvas,
  type LandCoverClass,
} from '@/data/landCoverClasses';
import {
  detectClassMap,
  classMapToGrid,
  spectralClassMap,
  type ClassMap,
} from '@/lib/landCoverDetect';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { polygon as turfPolygon } from '@turf/helpers';

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export interface PipelineHooks {
  onStep: (id: string, status: StepStatus, msg?: string) => void;
}

export interface Bbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export interface LandCoverGrid {
  nLat: number;
  nLon: number;
  values: number[];
}

export interface RegionStat {
  id: number;
  name: string;
  color: string;
  pct: number;
}

export interface CaptureOptions {
  topDown?: boolean;
  size?: number;
  bbox?: Bbox | null;
  polygon?: Array<Array<[number, number]>>;
  useDetr?: boolean;
  signal?: AbortSignal;
}

export interface LandCoverResult {
  imageUrl: string;
  bbox: Bbox;
  grid: LandCoverGrid;
  classes: LandCoverClass[];
  regionStats: RegionStat[];
  coarseUrl?: string;
}

function throwIfAborted(signal?: AbortSignal, msg = 'Land Cover Mapper cancelled'): void {
  if (signal?.aborted) {
    const err = new Error(msg);
    err.name = 'AbortError';
    throw err;
  }
}

interface SavedCamera {
  position: Cesium.Cartesian3;
  heading: number;
  pitch: number;
  roll: number;
}

function saveCamera(viewer: Cesium.Viewer): SavedCamera {
  const c = viewer.camera;
  return { position: c.positionWC.clone(), heading: c.heading, pitch: c.pitch, roll: c.roll };
}

function restoreCamera(viewer: Cesium.Viewer, saved: SavedCamera): void {
  if (viewer.isDestroyed()) return;
  viewer.camera.setView({
    destination: saved.position,
    orientation: { heading: saved.heading, pitch: saved.pitch, roll: saved.roll },
  });
  viewer.scene.requestRender();
}

function setTopDown(viewer: Cesium.Viewer, target?: Bbox | null): void {
  const destination = target
    ? Cesium.Rectangle.fromDegrees(target.lonMin, target.latMin, target.lonMax, target.latMax)
    : viewer.camera.positionWC.clone();

  viewer.camera.setView({
    destination,
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
  });
  viewer.scene.requestRender();
}

function nextFrame(): Promise<void> {
  return new Promise<void>(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function yieldToUi(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

function waitForTiles(viewer: Cesium.Viewer, timeoutMs = 7000): Promise<void> {
  return new Promise<void>(resolve => {
    const start = Date.now();
    const tick = () => {
      if (viewer.isDestroyed()) {
        resolve();
        return;
      }
      viewer.scene.requestRender();
      if (viewer.scene.globe.tilesLoaded || Date.now() - start > timeoutMs) {
        void nextFrame().then(resolve);
        return;
      }
      setTimeout(tick, 60);
    };
    tick();
  });
}

export function captureViewerFrame(viewer: Cesium.Viewer): { imageUrl: string; width: number; height: number } {
  const canvas = viewer.canvas as HTMLCanvasElement;
  viewer.scene.render();
  let imageUrl = canvas.toDataURL('image/png');

  if (isBlankDataUrl(imageUrl)) {
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    if (ctx) {
      viewer.scene.render();
      ctx.drawImage(canvas, 0, 0);
      imageUrl = copy.toDataURL('image/png');
    }
    copy.width = 0;
    copy.height = 0;
  }

  return { imageUrl, width: canvas.width, height: canvas.height };
}

function isBlankDataUrl(url: string): boolean {
  return url.length < 2048;
}

export function getViewBbox(viewer: Cesium.Viewer): Bbox | null {
  const rect = viewer.camera.computeViewRectangle();
  if (!rect) return null;
  const west = Cesium.Math.toDegrees(rect.west);
  const east = Cesium.Math.toDegrees(rect.east);
  const south = Cesium.Math.toDegrees(rect.south);
  const north = Cesium.Math.toDegrees(rect.north);
  if (west >= east || south >= north) return null;
  return { latMin: south, latMax: north, lonMin: west, lonMax: east };
}

/* ── Transformers Loading ── */
interface TfModule {
  pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<unknown>;
  env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    localModelPath: string;
  };
}

let tfPromise: Promise<TfModule> | null = null;

function loadTf(): Promise<TfModule> {
  if (!tfPromise) {
    tfPromise = (async () => {
      const m = (await import('@xenova/transformers')) as unknown as TfModule;
      m.env.localModelPath = '/models/';
      m.env.allowLocalModels = true;
      m.env.useBrowserCache = false;
      return m;
    })();
  }
  return tfPromise;
}

/* ── Imagery Layer Overlay Management ── */
const landCoverLayers = new WeakMap<Cesium.Viewer, Cesium.ImageryLayer>();

export function showLandCoverSurface(
  viewer: Cesium.Viewer,
  grid: LandCoverGrid,
  bbox: Bbox,
  classes: readonly LandCoverClass[] = LAND_COVER_CLASSES,
): void {
  clearLandCoverSurface(viewer);
  const canvas = classGridToCanvas(grid, classes);
  const url = canvas.toDataURL('image/png');
  const rect = Cesium.Rectangle.fromDegrees(bbox.lonMin, bbox.latMin, bbox.lonMax, bbox.latMax);

  const provider = new Cesium.SingleTileImageryProvider({
    url,
    rectangle: rect,
    tileWidth: grid.nLon,
    tileHeight: grid.nLat,
  });

  const layer = viewer.scene.imageryLayers.addImageryProvider(provider);
  layer.alpha = 0.6;
  (layer as unknown as { name: string }).name = 'land_cover_surface';
  landCoverLayers.set(viewer, layer);

  canvas.width = 0;
  canvas.height = 0;
}

export function clearLandCoverSurface(viewer: Cesium.Viewer): void {
  const layer = landCoverLayers.get(viewer);
  if (layer) {
    landCoverLayers.delete(viewer);
    if (!viewer.isDestroyed()) {
      viewer.scene.imageryLayers.remove(layer, true);
    }
  }
}

/* ── Main Pipeline Execution ── */
export async function runLandCoverPipeline(
  viewer: Cesium.Viewer,
  opts: CaptureOptions = {},
  hooks?: PipelineHooks,
): Promise<LandCoverResult> {
  const size = opts.size ?? 448;
  const signal = opts.signal;

  const saved = saveCamera(viewer);
  let imageUrl: string;
  let camW: number;
  let camH: number;
  let captureBbox: Bbox | null;

  try {
    hooks?.onStep('capture', 'running', opts.bbox ? 'Framing study area top-down…' : 'Pointing camera straight down…');
    if (opts.topDown) {
      setTopDown(viewer, opts.bbox ?? null);
      await waitForTiles(viewer);
    }
    ({ imageUrl, width: camW, height: camH } = captureViewerFrame(viewer));
    captureBbox = getViewBbox(viewer);
  } finally {
    restoreCamera(viewer, saved);
  }

  throwIfAborted(signal);

  if (!captureBbox) {
    throw new Error('Could not determine the visible map area — zoom in and try again.');
  }

  const target = opts.bbox ?? captureBbox;
  hooks?.onStep(
    'capture',
    'done',
    opts.topDown
      ? '3D scene captured (top-down)'
      : '3D scene captured (perspective view — overlay is approximate)',
  );

  const squareUrl = await cropTargetToSquare(imageUrl, target, captureBbox, camW, camH);
  const squareImage = await loadImage(squareUrl);
  throwIfAborted(signal);

  let classMap: ClassMap;
  if (opts.useDetr) {
    hooks?.onStep('features', 'running', 'Running DETR panoptic segmentation…');
    const tf = await loadTf();
    const t0 = Date.now();
    const cm = await detectClassMap(tf, squareUrl, squareImage);
    throwIfAborted(signal);

    if (!cm) {
      throw new Error('DETR returned no segments for this scene — try a clearer top-down view.');
    }
    hooks?.onStep('features', 'done', `DETR panoptic + spectral fill in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    classMap = cm;
  } else {
    hooks?.onStep('features', 'running', 'Classifying pixels by spectral indices…');
    classMap = spectralClassMap(squareImage);
    throwIfAborted(signal);
    hooks?.onStep('features', 'done', `Spectral classification done (${classMap.w}×${classMap.h})`);
  }

  hooks?.onStep('regions', 'running', 'Majority-voting the class map onto the output grid…');
  await yieldToUi();

  const { gridValues, classCounts } = classMapToGrid(classMap, size);
  throwIfAborted(signal);

  const grid: LandCoverGrid = { nLat: size, nLon: size, values: gridValues };
  if (opts.polygon && opts.polygon.length > 0) {
    maskGridToPolygon(grid, target, opts.polygon);
  }
  hooks?.onStep('regions', 'done', `${size}×${size} cells, sampled from ${classMap.w}×${classMap.h} class map`);

  const coarseUrl = renderClassPreview(squareImage, classMap);

  const usedClasses = LAND_COVER_CLASSES as LandCoverClass[];
  const regionStats: RegionStat[] = [];
  let mapped = 0;

  for (const [, cnt] of classCounts) mapped += cnt;
  for (const c of usedClasses) {
    const n = classCounts.get(c.id) ?? 0;
    if (n > 0) {
      regionStats.push({
        id: c.id,
        name: c.name,
        color: c.color,
        pct: mapped ? Math.round((n / mapped) * 1000) / 10 : 0,
      });
    }
  }

  regionStats.sort((a, b) => b.pct - a.pct);
  hooks?.onStep('sam', 'done', `Classified ${regionStats.length} land-cover classes`);

  return { imageUrl: squareUrl, bbox: target, grid, classes: usedClasses, regionStats, coarseUrl };
}

/* ── Image & Geospatial Helpers ── */

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load captured image'));
    img.src = url;
  });
}

/** Bounding Box optimization wrapper for fast spatial masking checks. */
function maskGridToPolygon(
  grid: LandCoverGrid,
  bbox: Bbox,
  rings: Array<Array<[number, number]>>,
): void {
  if (!rings.length) return;

  const polys = rings.map(r => ({
    poly: turfPolygon([r]),
    // Compute ring bounding box to bypass point-in-polygon checks for distant cells
    lonMin: Math.min(...r.map(pt => pt[0])),
    lonMax: Math.max(...r.map(pt => pt[0])),      latMin: Math.min(...r.map(pt => pt[1])),
      latMax: Math.max(...r.map(pt => pt[1])),
  }));

  const { nLat, nLon, values } = grid;
  const latStep = (bbox.latMax - bbox.latMin) / nLat;
  const lonStep = (bbox.lonMax - bbox.lonMin) / nLon;

  for (let iy = 0; iy < nLat; iy++) {
    const lat = bbox.latMax - (iy + 0.5) * latStep;
    const rowOff = iy * nLon;

    for (let ix = 0; ix < nLon; ix++) {
      const lon = bbox.lonMin + (ix + 0.5) * lonStep;
      let inside = false;

      for (let pIdx = 0; pIdx < polys.length; pIdx++) {
        const p = polys[pIdx];
        // Fast BBox check
        if (lon >= p.lonMin && lon <= p.lonMax && lat >= p.latMin && lat <= p.latMax) {
          if (booleanPointInPolygon([lon, lat], p.poly)) {
            inside = true;
            break;
          }
        }
      }

      if (!inside) {
        values[rowOff + ix] = 0;
      }
    }
  }
}

interface CenterRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function targetPixelRect(target: Bbox, capture: Bbox, W: number, H: number): CenterRect {
  const cw = capture.lonMax - capture.lonMin;
  const ch = capture.latMax - capture.latMin;
  const x0 = cw > 0 ? ((target.lonMin - capture.lonMin) / cw) * W : 0;
  const x1 = cw > 0 ? ((target.lonMax - capture.lonMin) / cw) * W : W;
  const y0 = ch > 0 ? ((capture.latMax - target.latMax) / ch) * H : 0;
  const y1 = ch > 0 ? ((capture.latMax - target.latMin) / ch) * H : H;

  return {
    x0: Math.max(0, Math.min(W, x0)),
    y0: Math.max(0, Math.min(H, y0)),
    x1: Math.max(0, Math.min(W, x1)),
    y1: Math.max(0, Math.min(H, y1)),
  };
}

function cropTargetToSquare(
  imageUrl: string,
  target: Bbox,
  capture: Bbox,
  W: number,
  H: number,
  squareSize = 1024,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const src = new Image();
    src.onload = () => {
      const r = targetPixelRect(target, capture, W, H);
      const rw = Math.max(1, r.x1 - r.x0);
      const rh = Math.max(1, r.y1 - r.y0);

      const cw = document.createElement('canvas');
      cw.width = squareSize;
      cw.height = squareSize;
      const ctx = cw.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to acquire 2D context for cropping'));
        return;
      }

      ctx.drawImage(src, r.x0, r.y0, rw, rh, 0, 0, squareSize, squareSize);
      const outUrl = cw.toDataURL('image/png');

      cw.width = 0;
      cw.height = 0;
      resolve(outUrl);
    };
    src.onerror = () => reject(new Error('Failed to load captured image for region crop'));
    src.src = imageUrl;
  });
}

function renderClassPreview(img: HTMLImageElement, classMap: ClassMap): string {
  const { classes, w, h } = classMap;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const imageData = ctx.createImageData(w, h);
  const byId = new Map(LAND_COVER_CLASSES.map(c => [c.id, c.rgb]));

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = w;
  srcCanvas.height = h;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) return '';

  srcCtx.drawImage(img, 0, 0, w, h);
  const src = srcCtx.getImageData(0, 0, w, h).data;
  const totalPixels = w * h;

  for (let i = 0; i < totalPixels; i++) {
    const pi = i * 4;
    const id = classes[i];
    const rgb = id > 0 ? byId.get(id) : undefined;

    if (rgb) {
      imageData.data[pi] = Math.round(rgb[0] * 0.7 + src[pi] * 0.3);
      imageData.data[pi + 1] = Math.round(rgb[1] * 0.7 + src[pi + 1] * 0.3);
      imageData.data[pi + 2] = Math.round(rgb[2] * 0.7 + src[pi + 2] * 0.3);
      imageData.data[pi + 3] = 220;
    } else {
      imageData.data[pi] = Math.round(src[pi] * 0.4);
      imageData.data[pi + 1] = Math.round(src[pi + 1] * 0.4);
      imageData.data[pi + 2] = Math.round(src[pi + 2] * 0.4);
      imageData.data[pi + 3] = 220;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  const outUrl = canvas.toDataURL('image/png');

  canvas.width = 0;
  canvas.height = 0;
  srcCanvas.width = 0;
  srcCanvas.height = 0;

  return outUrl;
}