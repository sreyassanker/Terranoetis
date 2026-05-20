import * as Cesium from 'cesium';

export async function loadTectonicPlates(viewer: Cesium.Viewer, geo: Record<string, unknown>) {
  const src = await Cesium.GeoJsonDataSource.load(geo, { clampToGround: true });
  for (const ent of src.entities.values) {
    if (ent.polyline) {
      ent.polyline.material = new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.25,
        color: Cesium.Color.fromCssColorString('#f97316').withAlpha(0.85),
      });
      ent.polyline.width = new Cesium.ConstantProperty(8);
    }
  }
  viewer.dataSources.add(src);
  return src;
}
