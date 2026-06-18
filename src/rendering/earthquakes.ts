/* eslint-disable @typescript-eslint/no-unused-vars */
import * as Cesium from 'cesium';

export interface UsgsFeature {
  geometry: { coordinates: number[] };
  properties: Record<string, unknown>;
}

function depthColor(depthKm: number): Cesium.Color {
  const hue = Math.max(0, 0.33 - (depthKm / 700) * 0.33);
  return Cesium.Color.fromHsl(hue, 1.0, 0.5);
}

export function addEarthquakeEntity(
  viewer: Cesium.Viewer,
  feature: UsgsFeature,
): Cesium.Entity {
  const c = feature.geometry.coordinates;
  const p = feature.properties;
  const mag = Number(p.mag ?? 0);
  const depth = Number(p.depth ?? c[2] ?? 10);
  const color = depthColor(depth);
  const height = Math.max(5000, mag * 15000);
  const radius = 2000 + mag * 800;
  const eventTime = Cesium.JulianDate.fromDate(new Date(Number(p.time ?? Date.now())));

  const pulseMaterial = new Cesium.ColorMaterialProperty(
    new Cesium.CallbackProperty((time?: Cesium.JulianDate) => {
      const t = (Cesium.JulianDate.secondsDifference(time ?? eventTime, eventTime) % 3) / 3;
      const pulse = 0.4 + 0.6 * Math.sin(t * Math.PI * 2);
      return Cesium.Color.fromAlpha(color, pulse);
    }, false),
  );

  const ringMaterial = new Cesium.ColorMaterialProperty(
    new Cesium.CallbackProperty((time?: Cesium.JulianDate) => {
      const elapsed = Cesium.JulianDate.secondsDifference(time ?? eventTime, eventTime);
      const opacity = Math.max(0, 1 - elapsed / 40);
      return Cesium.Color.fromAlpha(Cesium.Color.ORANGE, opacity * 0.3);
    }, false),
  );

  const ringRadius = new Cesium.CallbackProperty((time?: Cesium.JulianDate) => {
    const elapsed = Math.max(0, Cesium.JulianDate.secondsDifference(time ?? eventTime, eventTime));
    return 10000 + elapsed * 2500;
  }, false);

  return viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(c[0], c[1]),
    name: String(p.place ?? 'Earthquake'),
    cylinder: {
      length: height,
      topRadius: radius,
      bottomRadius: radius * 0.3,
      material: pulseMaterial,
      outline: true,
      outlineColor: color.withAlpha(0.8),
    },
    polyline: {
      positions: new Cesium.CallbackProperty((time) => {
        const carto = Cesium.Cartographic.fromDegrees(c[0], c[1]);
        const ground = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0);
        const top = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, height);
        return [ground, top];
      }, false),
      width: 2,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.3,
        color: color.withAlpha(0.6),
      }),
    },
    ellipse: {
      semiMajorAxis: ringRadius,
      semiMinorAxis: ringRadius,
      material: ringMaterial,
      height: 0,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      show: new Cesium.CallbackProperty((time?: Cesium.JulianDate) => {
        const elapsed = Cesium.JulianDate.secondsDifference(time ?? eventTime, eventTime);
        return elapsed >= 0 && elapsed < 40;
      }, false),
    },
    label: {
      text: `M${mag.toFixed(1)}`,
      font: 'bold 12px "JetBrains Mono"',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      pixelOffset: new Cesium.Cartesian2(0, -20),
      scaleByDistance: new Cesium.NearFarScalar(1e5, 1.2, 5e6, 0.4),
      translucencyByDistance: new Cesium.NearFarScalar(1e5, 1.0, 8e6, 0.2),
      show: mag >= 5,
    },
    properties: {
      ...p,
      layer: 'earthquakes',
      magnitude: mag,
      depth,
      lon: c[0],
      lat: c[1],
      time: Number(p.time ?? Date.now()),
    },
  });
}
