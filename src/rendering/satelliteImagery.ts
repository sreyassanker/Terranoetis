import * as Cesium from 'cesium';

import {
  GIBS_PRODUCTS, EXTERNAL_DATA_SOURCES, GROUP_LABELS,
  groupProducts,
} from '@/rendering/satelliteDataSources';

export { GIBS_PRODUCTS, EXTERNAL_DATA_SOURCES, GROUP_LABELS, groupProducts };

const MAX_SAT_LAYERS = 5;

function enforceLayerCap(viewer: Cesium.Viewer): void {
  const layers = viewer.scene.imageryLayers;
  const satLayers: Cesium.ImageryLayer[] = [];
  for (let i = 0; i < layers.length; i++) {
    const l = layers.get(i);
    if ((l as Cesium.ImageryLayer & { name?: string })?.name?.startsWith('sat_')) satLayers.push(l);
  }
  while (satLayers.length > MAX_SAT_LAYERS) {
    const oldest = satLayers.shift()!;
    viewer.scene.imageryLayers.remove(oldest, true);
  }
}

export function loadGibsImageryForBbox(
  viewer: Cesium.Viewer,
  layer: string,
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number },
  date: string,
  opacity: number = 0.7,
  studyAreaId?: string,
  cloudCover?: number,
): Cesium.ImageryLayer {
  const params: Record<string, string> = {
    transparent: 'true',
    format: 'image/png',
    time: date,
  };
  if (cloudCover !== undefined && cloudCover < 100) {
    params.cloudcover = String(cloudCover);
  }
  const provider = new Cesium.WebMapServiceImageryProvider({
    url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
    layers: layer,
    parameters: params,
    rectangle: Cesium.Rectangle.fromDegrees(bbox.lonMin, bbox.latMin, bbox.lonMax, bbox.latMax),
  });
  const imgLayer = viewer.scene.imageryLayers.addImageryProvider(provider);
  imgLayer.alpha = opacity;
  (imgLayer as Cesium.ImageryLayer & { name?: string }).name = `sat_${studyAreaId || 'default'}_${layer}_${date}${cloudCover !== undefined && cloudCover < 100 ? `_cc${cloudCover}` : ''}`;
  enforceLayerCap(viewer);
  return imgLayer;
}

export function loadXyzImageryForBbox(
  viewer: Cesium.Viewer,
  url: string,
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number },
  opacity: number = 0.7,
  studyAreaId?: string,
  layerName?: string,
): Cesium.ImageryLayer {
  const provider = new Cesium.UrlTemplateImageryProvider({
    url,
    rectangle: Cesium.Rectangle.fromDegrees(bbox.lonMin, bbox.latMin, bbox.lonMax, bbox.latMax),
  });
  const imgLayer = viewer.scene.imageryLayers.addImageryProvider(provider);
  imgLayer.alpha = opacity;
  (imgLayer as Cesium.ImageryLayer & { name?: string }).name = `sat_${studyAreaId || 'default'}_${layerName || 'xyz'}_bbox`;
  enforceLayerCap(viewer);
  return imgLayer;
}

export function loadWmsImageryForBbox(
  viewer: Cesium.Viewer,
  url: string,
  layer: string,
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number },
  opacity: number = 0.7,
  studyAreaId?: string,
  cloudCover?: number,
): Cesium.ImageryLayer {
  const params: Record<string, string> = {
    transparent: 'true',
    format: 'image/png',
  };
  if (cloudCover !== undefined && cloudCover < 100) {
    params.MAXCC = String(cloudCover);
  }
  const provider = new Cesium.WebMapServiceImageryProvider({
    url,
    layers: layer,
    parameters: params,
    rectangle: Cesium.Rectangle.fromDegrees(bbox.lonMin, bbox.latMin, bbox.lonMax, bbox.latMax),
  });
  const imgLayer = viewer.scene.imageryLayers.addImageryProvider(provider);
  imgLayer.alpha = opacity;
  (imgLayer as Cesium.ImageryLayer & { name?: string }).name = `sat_${studyAreaId || 'default'}_${layer}_bbox`;
  enforceLayerCap(viewer);
  return imgLayer;
}

export function removeGibsImageryForStudyArea(
  viewer: Cesium.Viewer,
  studyAreaId: string,
): void {
  const layers = viewer.scene.imageryLayers;
  const toRemove: Cesium.ImageryLayer[] = [];
  for (let i = 0; i < layers.length; i++) {
    const l = layers.get(i);
    if ((l as Cesium.ImageryLayer & { name?: string })?.name?.startsWith(`sat_${studyAreaId}_`)) {
      toRemove.push(l);
    }
  }
  for (const l of toRemove) {
    viewer.scene.imageryLayers.remove(l, true);
  }
}

export function updateGibsImageryOpacity(
  viewer: Cesium.Viewer,
  studyAreaId: string,
  opacity: number,
): void {
  const layers = viewer.scene.imageryLayers;
  for (let i = 0; i < layers.length; i++) {
    const l = layers.get(i);
    if ((l as Cesium.ImageryLayer & { name?: string })?.name?.startsWith(`sat_${studyAreaId}_`)) {
      l.alpha = opacity;
    }
  }
}
