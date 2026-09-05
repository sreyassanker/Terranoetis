import * as Cesium from 'cesium';

export interface RadioWaveHandle {
  /** Recolor the live wave without restarting its animation phase. */
  setColor: (cssColor: string) => void;
  /** Remove all wave entities and stop the render loop. Idempotent. */
  stop: () => void;
}

/** Ring outline points (closed loop) around a center at a given radius. */
function circlePositions(lon: number, lat: number, radiusM: number, segments = 72): Cesium.Cartesian3[] {
  const pts: Cesium.Cartesian3[] = [];
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.max(Math.cos(Cesium.Math.toRadians(lat)), 0.2));
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(Cesium.Cartesian3.fromDegrees(lon + Math.cos(a) * dLon, lat + Math.sin(a) * dLat, 0));
  }
  return pts;
}

/**
 * Draw a continuous "radio wave" at a station: concentric RING OUTLINES (no
 * fill) that expand outward and fade, looping slowly, plus a center marker —
 * in the given color. Rings are ground-clamped polylines so they follow terrain
 * and render at real width (a filled ellipse or polygon.outline would not).
 *
 * The viewer runs with requestRenderMode:true, so a self-perpetuating
 * requestAnimationFrame loop calls scene.requestRender() each frame while the
 * wave is active; stop() cancels it.
 */
export function startRadioWave(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  cssColor: string,
  opts?: { maxRadiusM?: number; periodS?: number; rings?: number },
): RadioWaveHandle {
  const maxRadius = opts?.maxRadiusM ?? 160000;
  const period = opts?.periodS ?? 5.5; // slow, calm expansion
  const ringCount = opts?.rings ?? 3;
  const start = Cesium.JulianDate.now();
  let color = Cesium.Color.fromCssColorString(cssColor);
  const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
  const entities: Cesium.Entity[] = [];

  for (let r = 0; r < ringCount; r++) {
    const offset = r / ringCount;
    const phase = (time: Cesium.JulianDate): number => {
      const elapsed = Cesium.JulianDate.secondsDifference(time, start);
      return ((elapsed / period) + offset) % 1;
    };
    const positions = new Cesium.CallbackProperty((time) => {
      if (!time) return [];
      // Start from a near-point (5 m) so the ring blooms outward when the
      // camera flies in on a station — a nicer reveal than starting at 4 km.
      return circlePositions(lon, lat, 5 + phase(time) * maxRadius);
    }, false);
    const material = new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty((time) => {
      if (!time) return color.withAlpha(0);
      return color.withAlpha(0.6 * (1 - phase(time)));
    }, false));
    entities.push(viewer.entities.add({
      name: 'radio_wave',
      polyline: {
        positions,
        width: 2.5,
        material,
        clampToGround: true,
      },
      properties: { layer: 'radio_wave', isRadioWave: true },
    }));
  }

  entities.push(viewer.entities.add({
    position: pos,
    name: 'radio_wave',
    point: {
      pixelSize: 10,
      color: new Cesium.CallbackProperty(() => color, false),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: { layer: 'radio_wave', isRadioWave: true },
  }));

  let raf = 0;
  let active = true;
  const loop = (): void => {
    if (!active || viewer.isDestroyed()) return;
    viewer.scene.requestRender();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    setColor: (cssColor: string) => { color = Cesium.Color.fromCssColorString(cssColor); },
    stop: () => {
      if (!active) return;
      active = false;
      if (raf) cancelAnimationFrame(raf);
      for (const e of entities) { try { viewer.entities.remove(e); } catch { /* ignore */ } }
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    },
  };
}
