import * as Cesium from 'cesium';

export interface ViewerInitResult {
  viewer: Cesium.Viewer;
  unlockInteraction: () => void;
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
  dark: {
    url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    credit: 'CARTO',
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
    return createFallbackLayer('dark');
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
        requestVertexNormals: true,
        requestWaterMask: true,
      });
      return true;
    } catch {
      // Keep ellipsoid terrain if Ion terrain fails.
    }
  }

  viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
  return false;
}

export async function createLiveGlobeViewer(container: HTMLElement): Promise<ViewerInitResult> {
  const ionToken = import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN as string | undefined;
  if (ionToken) {
    Cesium.Ion.defaultAccessToken = ionToken;
  }

  const viewer = new Cesium.Viewer(container, {
    scene3DOnly: true,
    requestRenderMode: false,
    msaaSamples: 4,
    shadows: false,
    terrainShadows: Cesium.ShadowMode.DISABLED,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    vrButton: false,
    infoBox: false,
    selectionIndicator: false,
    creditContainer: document.createElement('div'),
    baseLayer: createImageryLayer('satellite'),
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  });

  await applyTerrainProvider(viewer, ionToken);

  const scene = viewer.scene;
  scene.logarithmicDepthBuffer = true;
  scene.postProcessStages.fxaa.enabled = false;
  try {
    if (scene.postProcessStages.bloom) {
      scene.postProcessStages.bloom.enabled = false;
    }
  } catch {
    // Bloom config varies by Cesium version
  }
  if (scene.postProcessStages.ambientOcclusion) {
    scene.postProcessStages.ambientOcclusion.enabled = false;
  }

  if (scene.skyAtmosphere) {
    scene.skyAtmosphere.hueShift = 0.1;
    scene.skyAtmosphere.saturationShift = 0.2;
  }
  scene.globe.enableLighting = true;
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.atmosphereLightIntensity = 30.0;
  scene.globe.lightingFadeOutDistance = 8e6;
  scene.globe.lightingFadeInDistance = 1e7;
  scene.globe.nightFadeOutDistance = 4e6;
  scene.globe.nightFadeInDistance = 8e6;
  scene.highDynamicRange = true;

  let autoRotating = false;
  const controller = scene.screenSpaceCameraController;
  controller.enableRotate = true;
  controller.enableZoom = true;
  controller.enableTilt = true;
  controller.minimumZoomDistance = 100;
  controller.maximumZoomDistance = 5e8;

  viewer.clock.shouldAnimate = true;
  viewer.clock.multiplier = 1;
  viewer.clock.onTick.addEventListener(() => {
    if (autoRotating) viewer.scene.camera.rotateRight(0.0003);
  });

  const unlockInteraction = () => {
    autoRotating = false;
  };

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(0, 0, 2.2e7),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
  });

  viewer.scene.requestRender();

  return { viewer, unlockInteraction };
}

export function addBaseImagery(viewer: Cesium.Viewer, type: string, replace = false) {
  const layers = viewer.scene.imageryLayers;
  if (replace && layers.length > 0) {
    layers.remove(layers.get(0), true);
  }
  const layer = createImageryLayer(type);
  // Base map must always be at the very bottom (index 0)
  layers.add(layer, 0);
  return layer;
}

export function crossfadeImagery(viewer: Cesium.Viewer, type: string, durationMs = 500) {
  const layers = viewer.scene.imageryLayers;
  if (layers.length === 0) {
    addBaseImagery(viewer, type);
    return;
  }

  const oldBase = layers.get(0);
  const next = createImageryLayer(type);
  
  // Insert the new base map right above the old one (index 1) so it sits below any data overlays
  layers.add(next, 1);
  next.alpha = 0;
  
  const start = performance.now();
  const fade = () => {
    const t = Math.min(1, (performance.now() - start) / durationMs);
    next.alpha = t;
    if (t < 1) {
      requestAnimationFrame(fade);
    } else {
      layers.remove(oldBase, true);
      next.alpha = 1;
    }
    viewer.scene.requestRender();
  };
  requestAnimationFrame(fade);
}
