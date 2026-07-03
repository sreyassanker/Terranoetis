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

  // Pre-compute static positions for the vertical line (these never change)
  const carto = Cesium.Cartographic.fromDegrees(c[0], c[1]);
  const groundPos = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0);
  const topPos = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, height);
  const staticPositions = [groundPos, topPos];

  // Cache final animated values (after 40s) so callbacks short-circuit
  const transparentColor = Cesium.Color.fromAlpha(color, 0.4);
  const ringFinalRadius = 10000 + 40 * 2500; // 110,000m at t=40s

  // Pre-compute animated color palette (12 frames at 0.25s intervals = 3s cycle)
  const PULSE_FRAMES = 12;
  const pulseColors: Cesium.Color[] = new Array(PULSE_FRAMES);
  for (let f = 0; f < PULSE_FRAMES; f++) {
    const pulse = 0.4 + 0.6 * Math.sin((f / PULSE_FRAMES) * Math.PI * 2);
    pulseColors[f] = Cesium.Color.fromAlpha(color, pulse);
  }
  // Pre-compute ring opacity palette (40 frames at 1s intervals)
  const RING_FRAMES = 40;
  const ringColors: Cesium.Color[] = new Array(RING_FRAMES);
  for (let f = 0; f < RING_FRAMES; f++) {
    const opacity = Math.max(0, 1 - f / 40);
    ringColors[f] = Cesium.Color.fromAlpha(Cesium.Color.ORANGE, opacity * 0.3);
  }
  const transparentOrange = Cesium.Color.fromAlpha(Cesium.Color.ORANGE, 0);

  // Pulse material: 3-second cycle, but after 40s return static value
  const pulseMaterial = new Cesium.ColorMaterialProperty(
    new Cesium.CallbackProperty((time?: Cesium.JulianDate) => {
      const elapsed = Cesium.JulianDate.secondsDifference(time ?? eventTime, eventTime);
      if (elapsed > 40) return transparentColor;
      const frame = Math.floor((elapsed % 3) * (PULSE_FRAMES / 3)) % PULSE_FRAMES;
      return pulseColors[frame];
    }, false),
  );

  // Ring material: fades over 40s, then transparent
  const ringMaterial = new Cesium.ColorMaterialProperty(
    new Cesium.CallbackProperty((time?: Cesium.JulianDate) => {
      const elapsed = Cesium.JulianDate.secondsDifference(time ?? eventTime, eventTime);
      if (elapsed >= 40) return transparentOrange;
      const frame = Math.min(Math.floor(elapsed), RING_FRAMES - 1);
      return ringColors[frame];
    }, false),
  );

  // Ring radius: expands for 40s, then frozen
  const ringRadius = new Cesium.CallbackProperty((time?: Cesium.JulianDate) => {
    const elapsed = Cesium.JulianDate.secondsDifference(time ?? eventTime, eventTime);
    if (elapsed >= 40) return ringFinalRadius;
    return 10000 + Math.max(0, elapsed) * 2500;
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
      // Static positions — no CallbackProperty needed
      positions: staticPositions,
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
