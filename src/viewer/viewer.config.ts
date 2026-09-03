import * as Cesium from 'cesium';
import { throttledRender } from '@/lib/throttledRender';

export interface ViewerInitResult {
  viewer: Cesium.Viewer;
  unlockInteraction: () => void;
  removeAutoRotateTick: () => void;
}

const IMAGERY: Record<string, { url: string; credit?: string }> = {
  earth: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    credit: 'Esri',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credit: 'Esri',
  },
  terrain: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credit: 'Esri',
  },
};

const WORLD_IMAGERY_STYLES: Record<'earth' | 'satellite' | 'terrain', Cesium.IonWorldImageryStyle> = {
  earth: Cesium.IonWorldImageryStyle.ROAD,
  satellite: Cesium.IonWorldImageryStyle.AERIAL,
  terrain: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS,
};

function hasIonAccess(): boolean {
  return Boolean((Cesium.Ion.defaultAccessToken ?? '').trim());
}

function createFallbackLayer(type: string): Cesium.ImageryLayer {
  const def = IMAGERY[type] ?? IMAGERY.satellite;
  return new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({ url: def.url, credit: def.credit }),
  );
}

function createImageryLayer(type: string): Cesium.ImageryLayer {
  if (type === 'night') {
    if (hasIonAccess()) {
      const layer = Cesium.ImageryLayer.fromProviderAsync(Cesium.IonImageryProvider.fromAssetId(3812));
      layer.alpha = 0.96;
      layer.brightness = 1.9;
      layer.contrast = 1.1;
      return layer;
    }
    return createFallbackLayer('satellite');
  }

  if ((type === 'earth' || type === 'satellite' || type === 'terrain') && hasIonAccess()) {
    return Cesium.ImageryLayer.fromProviderAsync(
      Cesium.createWorldImageryAsync({ style: WORLD_IMAGERY_STYLES[type] }),
    );
  }

  return createFallbackLayer(type);
}

export async function applyTerrainProvider(viewer: Cesium.Viewer, ionToken?: string) {
  if (ionToken) {
    Cesium.Ion.defaultAccessToken = ionToken;
    try {
      viewer.terrainProvider = await Cesium.createWorldTerrainAsync({
        // Vertex normals / water mask are cosmetic (lighting + ocean depth) and
        // require premium Ion assets; the plain global terrain loads with any
        // valid Ion token, which is all we need for height sampling.
        requestVertexNormals: false,
        requestWaterMask: false,
      });
      return true;
    } catch {
      console.warn('[Terrain] Cesium World Terrain failed to load. Using flat ellipsoid. Scenario shapes will use ground-clamped heights.');
    }
  } else {
    console.warn('[Terrain] No VITE_CESIUM_ION_ACCESS_TOKEN found. Terrain is flat ellipsoid. Set the token for real terrain and ocean detection.');
  }

  viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
  return false;
}


export function addBaseImagery(viewer: Cesium.Viewer, type: string, replace = false) {
  const layers = viewer.scene.imageryLayers;
  if (replace) {
    for (const l of baseLayers) {
      if (layers.contains(l)) layers.remove(l, true);
    }
    baseLayers.clear();
  }
  const layer = createImageryLayer(type);
  // Base map must always be at the very bottom (index 0)
  layers.add(layer, 0);
  baseLayers.add(layer);
  return layer;
}

/** Remove every tracked base imagery layer (used to give photoreal exclusivity). */
export function removeBaseImagery(viewer: Cesium.Viewer) {
  const layers = viewer.scene.imageryLayers;
  for (const l of [...baseLayers]) {
    if (layers.contains(l)) layers.remove(l, true);
  }
  baseLayers.clear();
}

/**
 * Exclusive single-select base map: drop every current base layer and add a
 * single new one at the bottom. Prevents the four imagery modes from stacking
 * on top of each other.
 */
export function replaceBaseImagery(viewer: Cesium.Viewer, type: string) {
  removeBaseImagery(viewer);
  const layer = createImageryLayer(type);
  viewer.scene.imageryLayers.add(layer, 0);
  baseLayers.add(layer);
  return layer;
}

let baseLayers: Set<Cesium.ImageryLayer> = new Set();
let crossfadeToken = 0;

export function crossfadeImagery(viewer: Cesium.Viewer, type: string, durationMs = 500) {
  const layers = viewer.scene.imageryLayers;
  const token = ++crossfadeToken;

  const next = createImageryLayer(type);
  // Insert the new base map right above any previous base (index 1) so it
  // sits below data overlays and crossfades over the old base.
  layers.add(next, 1);
  next.alpha = 0;
  baseLayers.add(next);

  const start = performance.now();
  const fade = () => {
    if (token !== crossfadeToken) return; // superseded by a newer switch
    const t = Math.min(1, (performance.now() - start) / durationMs);
    next.alpha = t;
    if (t < 1) {
      requestAnimationFrame(fade);
    } else {
      next.alpha = 1;
      // Drop every previous base layer. Removing ALL tracked bases (not just
      // one captured at call time) guarantees rapid chip switching never
      // orphans an intermediate base layer behind the new one.
      for (const l of [...baseLayers]) {
        if (l !== next && layers.contains(l)) layers.remove(l, true);
      }
      baseLayers = new Set([next]);
    }
    throttledRender(viewer);
  };
  requestAnimationFrame(fade);
}
