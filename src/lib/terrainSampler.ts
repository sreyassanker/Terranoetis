import * as Cesium from 'cesium';

const BATCH_SIZE = 20;

export async function sampleTerrainHeights(
  viewer: Cesium.Viewer,
  positions: { lat: number; lon: number }[],
): Promise<Map<string, number>> {
  const heightMap = new Map<string, number>();
  if (!viewer.scene.terrainProvider) return heightMap;

  for (let i = 0; i < positions.length; i += BATCH_SIZE) {
    const batch = positions.slice(i, i + BATCH_SIZE);
    const cesiumPositions = batch.map(p =>
      Cesium.Cartographic.fromDegrees(p.lon, p.lat),
    );

    try {
      const sampledPositions = await Cesium.sampleTerrainMostDetailed(
        viewer.scene.terrainProvider,
        cesiumPositions,
      );

      for (let j = 0; j < sampledPositions.length; j++) {
        const key = `${batch[j].lat.toFixed(4)},${batch[j].lon.toFixed(4)}`;
        heightMap.set(key, sampledPositions[j].height);
      }
    } catch {
      for (const pos of batch) {
        const key = `${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}`;
        heightMap.set(key, 0);
      }
    }
  }

  return heightMap;
}

