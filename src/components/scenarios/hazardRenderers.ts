import * as Cesium from 'cesium';
import type { ShapeData } from './types';

/** Track entities per viewer to avoid cross-lifecycle leaks */
const viewerEntities = new WeakMap<Cesium.Viewer, Cesium.Entity[]>();

function getEntities(viewer: Cesium.Viewer): Cesium.Entity[] {
  let arr = viewerEntities.get(viewer);
  if (!arr) { arr = []; viewerEntities.set(viewer, arr); }
  return arr;
}

export function clearHazardShapes(viewer: Cesium.Viewer): void {
  const entities = getEntities(viewer);
  for (const e of entities) {
    viewer.entities.remove(e);
  }
  entities.length = 0;
}

/** Safely convert a position to Cartesian3 — handles {lat,lon}, Cartesian3, and array formats */
function safeToCartesian3(p: unknown, fallbackHeight = 0): Cesium.Cartesian3 | null {
  if (!p) return null;
  // Already a Cartesian3
  if (p instanceof Cesium.Cartesian3) return p;
  // {lat, lon} object
  if (typeof p === 'object' && p !== null) {
    const obj = p as Record<string, unknown>;
    if (typeof obj.lon === 'number' && typeof obj.lat === 'number') {
      return Cesium.Cartesian3.fromDegrees(obj.lon, obj.lat, fallbackHeight);
    }
  }
  return null;
}

/** Safely convert an array of positions to Cartesian3[], filtering out invalid entries */
function safePositions(positions: unknown[], fallbackHeight = 0): Cesium.Cartesian3[] {
  const out: Cesium.Cartesian3[] = [];
  for (const p of positions) {
    const c = safeToCartesian3(p, fallbackHeight);
    if (c) out.push(c);
  }
  return out;
}

export function renderHazardShapes(
  viewer: Cesium.Viewer,
  shapes: ShapeData[],
): Cesium.Entity[] {
  const entities: Cesium.Entity[] = [];
  for (const shape of shapes) {
    let entity: Cesium.Entity | undefined;
    const color = Cesium.Color.fromCssColorString(shape.color).withAlpha(shape.opacity);

    switch (shape.type) {
      case 'polygon':
        if (shape.positions && shape.positions.length >= 3) {
          const pts = safePositions(shape.positions);
          if (pts.length >= 3) {
            entity = viewer.entities.add({
              polygon: {
                hierarchy: pts,
                material: color,
                outline: true,
                outlineColor: color.withAlpha(Math.min(1, shape.opacity + 0.3)),
                height: 0,
                extrudedHeight: shape.extrudedHeight ?? 0,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
            });
          }
        }
        break;

      case 'cylinder':
        if (shape.center && shape.radius != null) {
          const pos = safeToCartesian3(shape.center);
          if (pos) {
            entity = viewer.entities.add({
              position: pos,
              cylinder: {
                length: shape.height ?? 5000,
                topRadius: shape.radius ?? 1000,
                bottomRadius: shape.radius ?? 1000,
                material: color,
                outline: true,
                outlineColor: color.withAlpha(0.5),
                heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
              },
            });
          }
        }
        break;

      case 'corridor':
        if (shape.positions && shape.positions.length >= 2) {
          const pts = safePositions(shape.positions);
          if (pts.length >= 2) {
            entity = viewer.entities.add({
              corridor: {
                positions: pts,
                width: shape.width ?? 1000,
                material: color,
                outline: true,
                outlineColor: color.withAlpha(0.4),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
            });
          }
        }
        break;

      case 'ellipse':
        if (shape.center && shape.semiMajorAxis != null && shape.semiMinorAxis != null) {
          const pos = safeToCartesian3(shape.center);
          if (pos) {
            entity = viewer.entities.add({
              position: pos,
              ellipse: {
                semiMajorAxis: shape.semiMajorAxis,
                semiMinorAxis: shape.semiMinorAxis,
                rotation: shape.rotation ?? 0,
                material: color,
                outline: true,
                outlineColor: color.withAlpha(0.4),
                height: 0,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
            });
          }
        }
        break;

      case 'polyline':
        if (shape.positions && shape.positions.length >= 2) {
          const pts = safePositions(shape.positions);
          if (pts.length >= 2) {
            entity = viewer.entities.add({
              polyline: {
                positions: pts,
                width: shape.width ?? 2,
                material: new Cesium.PolylineGlowMaterialProperty({
                  glowPower: 0.15,
                  color,
                }),
                clampToGround: true,
              },
            });
          }
        }
        break;

      case 'ring':
        if (shape.center && shape.radius != null && typeof shape.center.lon === 'number' && typeof shape.center.lat === 'number') {
          const ringPts: Cesium.Cartesian3[] = [];
          const numPts = 64;
          const latRad = shape.center.lat * Math.PI / 180;
          const kmPerDegLat = 111.32;
          const kmPerDegLon = 111.32 * Math.cos(latRad);
          for (let i = 0; i <= numPts; i++) {
            const a = (i / numPts) * 2 * Math.PI;
            ringPts.push(Cesium.Cartesian3.fromDegrees(
              shape.center.lon + (shape.radius * Math.sin(a)) / kmPerDegLon,
              shape.center.lat + (shape.radius * Math.cos(a)) / kmPerDegLat,
            ));
          }
          entity = viewer.entities.add({
            polyline: {
              positions: ringPts,
              width: shape.width ?? 1.5,
              material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.1,
                color,
              }),
              clampToGround: true,
            },
          });
        }
        break;
    }

    if (entity) {
      entities.push(entity);
      getEntities(viewer).push(entity);
    }
  }
  return entities;
}
