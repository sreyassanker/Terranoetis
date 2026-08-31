/**
 * CCTV Viewshed — coverage-volume visualization for live public cameras.
 * Upgrades the existing CCTV layer: instead of only point markers, each
 * camera gets a projected coverage cone (estimated view direction + field of
 * view + range) rendered over the 3D terrain, like the reference platform's VIEWSHED mode.
 *
 * Positions are published (from the camera API). Poses are estimated priors —
 * the cone uses a heuristic azimuth/range and is labeled as an estimate, the
 * same honest framing the reference platform uses. Fully client-side, no extra API key.
 */

import * as Cesium from 'cesium';

export interface ViewshedCamera {
  lat: number;
  lon: number;
  name: string;
  /** Estimated azimuth (degrees, 0 = north, clockwise). */
  azimuthDeg: number;
  /** Horizontal field of view in degrees. */
  fovDeg: number;
  /** Coverage range in meters. */
  rangeM: number;
  /** Surface mount height in meters (small pole/corner camera). */
  mountHeightM: number;
}

export interface ViewshedOptions {
  /** Cone material alpha (default 0.18). */
  fillAlpha?: number;
  /** Line width of the cone edges. */
  lineWidth?: number;
  color?: string;
}

export class CctvViewshed {
  private viewer: Cesium.Viewer;
  private entities: Cesium.Entity[] = [];
  private active = false;
  private color: Cesium.Color;
  private fillAlpha: number;
  private lineWidth: number;
  private destroyed = false;

  constructor(viewer: Cesium.Viewer, options: ViewshedOptions = {}) {
    this.viewer = viewer;
    this.color = Cesium.Color.fromCssColorString(options.color ?? '#22d3ee');
    this.fillAlpha = options.fillAlpha ?? 0.18;
    this.lineWidth = options.lineWidth ?? 1;
  }

  /** Render coverage cones for a set of cameras. Replaces any existing cones. */
  render(cameras: ViewshedCamera[]): void {
    this.clear();
    if (!this.active) return;
    for (const cam of cameras.slice(0, 400)) {
      const cone = this.buildCone(cam);
      if (cone) this.entities.push(cone);
    }
    this.viewer.scene.requestRender();
  }

  private buildCone(cam: ViewshedCamera): Cesium.Entity | null {
    if (!Number.isFinite(cam.lat) || !Number.isFinite(cam.lon)) return null;
    const origin = Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat, cam.mountHeightM);

    // Compute the three cone tip points at ground level.
    const rangeKm = cam.rangeM / 1000;
    const halfFov = cam.fovDeg / 2;
    const leftAz = cam.azimuthDeg - halfFov;
    const rightAz = cam.azimuthDeg + halfFov;

    const tipLeft = this.destination(cam.lon, cam.lat, rangeKm, leftAz);
    const tipRight = this.destination(cam.lon, cam.lat, rangeKm, rightAz);
    // Center tip for the cone fill.
    const tipCenter = this.destination(cam.lon, cam.lat, rangeKm * 0.99, cam.azimuthDeg);

    // Fill: a triangle fan from the apex to the left/center/right tips.
    const fill = this.viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy([origin, tipLeft, tipCenter, tipRight]),
        material: this.color.withAlpha(this.fillAlpha),
        outline: false,
        classificationType: Cesium.ClassificationType.TERRAIN,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      properties: { layer: 'cctv_viewshed', cctv: cam.name, estimated: true },
    });

    // Edges: apex → left tip, apex → right tip, and the range arc.
    const arcPoints: Cesium.Cartesian3[] = [];
    const arcSteps = 24;
    for (let i = 0; i <= arcSteps; i++) {
      const az = leftAz + (i / arcSteps) * cam.fovDeg;
      arcPoints.push(this.destination(cam.lon, cam.lat, rangeKm, az));
    }
    const edges = this.viewer.entities.add({
      polyline: {
        positions: [origin, tipLeft, ...arcPoints, tipRight, origin],
        width: this.lineWidth,
        material: this.color.withAlpha(0.9),
        clampToGround: true,
      },
      properties: { layer: 'cctv_viewshed', cctv: cam.name, estimated: true },
    });

    // Keep both; caller can group them.
    this.entities.push(fill, edges);
    return fill;
  }

  /** Destination point at bearing `azDeg` and distance `rangeKm` (equirect approx). */
  private destination(lon: number, lat: number, rangeKm: number, azDeg: number): Cesium.Cartesian3 {
    const az = Cesium.Math.toRadians(azDeg);
    const R = 6371.0;
    const lat1 = Cesium.Math.toRadians(lat);
    const lon1 = Cesium.Math.toRadians(lon);
    const delta = rangeKm / R;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(az));
    const lon2 = lon1 + Math.atan2(Math.sin(az) * Math.sin(delta) * Math.cos(lat1), Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2));
    return Cesium.Cartesian3.fromRadians(lon2, lat2, 0);
  }

  start(): void {
    this.active = true;
  }

  stop(): void {
    this.active = false;
    this.clear();
  }

  clear(): void {
    for (const e of this.entities) {
      this.viewer.entities.remove(e);
    }
    this.entities = [];
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
  }
}
