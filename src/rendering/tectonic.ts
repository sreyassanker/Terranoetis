import * as Cesium from 'cesium';

export async function loadTectonicPlates(viewer: Cesium.Viewer, geo: Record<string, unknown>) {
  const src = await Cesium.GeoJsonDataSource.load(geo, { clampToGround: true });
  let polylineCount = 0;
  const toRemove: Cesium.Entity[] = [];
  for (const ent of src.entities.values) {
    if (ent.polyline) {
      polylineCount++;
      ent.polyline.material = new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.25,
        color: Cesium.Color.fromCssColorString('#f97316').withAlpha(0.85),
      });
      ent.polyline.width = new Cesium.ConstantProperty(8);
    } else {
      toRemove.push(ent);
    }
  }
  for (const ent of toRemove) {
    src.entities.remove(ent);
  }
  if (polylineCount === 0) {
    console.warn('[Tectonic] No polyline entities found — GeoJSON may have unexpected geometry types');
  }
  viewer.dataSources.add(src);
  return src;
}
