/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Cesium from 'cesium';

let osmBuildingsTileset: Cesium.Cesium3DTileset | null = null;


export async function loadOsmBuildings(
  viewer: Cesium.Viewer,
  ionToken?: string,
): Promise<Cesium.Cesium3DTileset> {
  if (osmBuildingsTileset) {
    osmBuildingsTileset.show = true;
    return osmBuildingsTileset;
  }

  if (ionToken) {
    Cesium.Ion.defaultAccessToken = ionToken;
  }

  const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(96188, {
    maximumScreenSpaceError: 16,
    cullWithChildrenBounds: true,
    skipLevelOfDetail: true,
    baseScreenSpaceError: 1024,
    skipScreenSpaceErrorFactor: 16,
    skipLevels: 1,
    immediatelyLoadDesiredLevelOfDetail: false,
    loadSiblings: false,
    preferLeaves: true,
    showCreditsOnScreen: false,
  } as any);
  tileset.style = new Cesium.Cesium3DTileStyle({
    color: "Boolean(${feature['cesium#color']}) ? color(${feature['cesium#color']}) : color('#00ff88')",
  });

  viewer.scene.primitives.add(tileset);

  // Lift buildings slightly above terrain to prevent occlusion from depthTestAgainstTerrain
  (tileset as any).heightOffset = 2.0;

  osmBuildingsTileset = tileset;

  return tileset;
}

export function hideOsmBuildings() {
  if (osmBuildingsTileset) {
    osmBuildingsTileset.show = false;
  }
}

/** Returns the active OSM buildings tileset, or null if not loaded. */
export function getOsmBuildingsTileset(): Cesium.Cesium3DTileset | null {
  return osmBuildingsTileset;
}

export function removeOsmBuildings(viewer: Cesium.Viewer) {
  if (osmBuildingsTileset) {
    viewer.scene.primitives.remove(osmBuildingsTileset);
    osmBuildingsTileset.destroy();
    osmBuildingsTileset = null;
  }
}
