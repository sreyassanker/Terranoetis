import { useEffect, useRef, useCallback } from 'react';
import * as Cesium from 'cesium';
import type { ShapeData } from './types';
import { throttledRender } from '@/lib/throttledRender';

interface HurricaneVisualizerProps {
  viewer: Cesium.Viewer | null;
  shapes: ShapeData[];
  progress: number;
}

/** Pre-cache a ring of Cartesian3 positions */
function cacheRingPositions(center: { lat: number; lon: number }, radiusKm: number, numPts = 48): Cesium.Cartesian3[] {
  const r = radiusKm / 111;
  const cosLat = Math.cos(center.lat * Math.PI / 180);
  const out: Cesium.Cartesian3[] = [];
  for (let i = 0; i <= numPts; i++) {
    const a = (i / numPts) * 2 * Math.PI;
    out.push(Cesium.Cartesian3.fromDegrees(center.lon + (r * Math.sin(a)) / (cosLat || 1), center.lat + r * Math.cos(a), 100));
  }
  return out;
}

function cachePolyPositions(positions: { lat: number; lon: number }[], height: number): Cesium.Cartesian3[] {
  return positions.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, height));
}

/**
 * Optimized hurricane visualizer
 * - Positions: pre-cached static arrays (zero per-frame recalculation)
 * - Animation: minimal CallbackProperty for opacity only (one sin() per entity)
 * - Build: only re-runs when shapes change (NOT when progress changes)
 * - Progress: separate useEffect calls throttledRender to re-evaluate CallbackProperties
 */
export default function HurricaneVisualizer({ viewer, shapes, progress }: HurricaneVisualizerProps) {
  const entitiesRef = useRef<Cesium.Entity[]>([]);
  const progressRef = useRef(progress);
  useEffect(() => { progressRef.current = progress; });

  const cleanup = useCallback(() => {
    if (!viewer) return;
    const ec = viewer.entities;
    ec.suspendEvents();
    for (const e of entitiesRef.current) ec.remove(e);
    entitiesRef.current = [];
    ec.resumeEvents();
  }, [viewer]);

  /** Only depends on shapes — does NOT rebuild on progress changes */
  const buildEntities = useCallback(() => {
    if (!viewer || shapes.length === 0) return;
    cleanup();
    const ec = viewer.entities;
    ec.suspendEvents();
    let count = 0;

    for (const s of shapes) {
      if (count >= 55) break;

      switch (s.type) {
        case 'cylinder': {
          if (!s.center) break;
          const baseColor = Cesium.Color.fromCssColorString(s.color);
          const entity = ec.add({
            cylinder: {
              length: new Cesium.CallbackProperty(() => {
                const pp = progressRef.current;
                const pulse = 0.7 + 0.3 * Math.sin(pp * Math.PI * 8);
                return (s.height || 14000) * pp * pulse;
              }, false),
              topRadius: new Cesium.CallbackProperty(() => {
                return (s.radius || 50000) * 0.9 * progressRef.current;
              }, false),
              bottomRadius: new Cesium.CallbackProperty(() => {
                return (s.radius || 50000) * progressRef.current;
              }, false),
              material: new Cesium.ColorMaterialProperty(
                new Cesium.CallbackProperty(() => {
                  const pp = progressRef.current;
                  const pulse = 0.7 + 0.3 * Math.sin(pp * Math.PI * 8);
                  return baseColor.withAlpha((s.opacity || 0.5) * pulse * pp);
                }, false),
              ),
            },
            position: Cesium.Cartesian3.fromDegrees(s.center.lon, s.center.lat, 7000),
          });
          entitiesRef.current.push(entity);
          count++;
          break;
        }
        case 'ring': {
          if (!s.center || !s.radius) break;
          if (s.waveType === 'eye') {
            const entity = ec.add({
              ellipse: {
                semiMajorAxis: new Cesium.CallbackProperty(() => s.radius! * progressRef.current, false),
                semiMinorAxis: new Cesium.CallbackProperty(() => s.radius! * 0.8 * progressRef.current, false),
                material: Cesium.Color.WHITE.withAlpha(0.15),
                outline: true,
                outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
                height: 500,
              },
              position: Cesium.Cartesian3.fromDegrees(s.center.lon, s.center.lat, 500),
            });
            entitiesRef.current.push(entity);
            count++;
          } else {
            const ringKm = s.radius / 1000;
            const cachedPositions = cacheRingPositions(s.center, ringKm);
            const entity = ec.add({
              polyline: {
                positions: cachedPositions,
                width: 2.5,
                material: new Cesium.PolylineGlowMaterialProperty({
                  glowPower: 0.12,
                  color: new Cesium.CallbackProperty(() => {
                    return Cesium.Color.fromCssColorString(s.color).withAlpha((s.opacity || 0.3) * progressRef.current);
                  }, false) as unknown as Cesium.Property,
                }),
                clampToGround: true,
              },
            });
            entitiesRef.current.push(entity);
            count++;
          }
          break;
        }
        case 'polyline': {
          if (!s.positions || s.positions.length < 2) break;
          const cached = cachePolyPositions(s.positions, 800);
          const entity = ec.add({
            polyline: {
              positions: cached,
              width: s.width || 2,
              material: new Cesium.CallbackProperty(() => {
                return Cesium.Color.fromCssColorString(s.color || '#22d3ee').withAlpha((s.opacity || 0.25) * progressRef.current);
              }, false) as unknown as Cesium.Property,
              clampToGround: true,
            },
          });
          entitiesRef.current.push(entity);
          count++;
          break;
        }
        case 'intensity_zone': {
          if (!s.positions || s.positions.length < 3) break;
          const baseColor = Cesium.Color.fromCssColorString(s.color);
          const isSurge = s.waveType === 'surge';
          const cached = cachePolyPositions(s.positions, 5);
          const entity = ec.add({
            polygon: {
              hierarchy: cached,
              material: new Cesium.ColorMaterialProperty(
                new Cesium.CallbackProperty(() => {
                  const pp = progressRef.current;
                  const wobble = isSurge ? (0.5 + 0.5 * Math.sin(pp * Math.PI * 6)) : 1;
                  return baseColor.withAlpha((s.opacity || 0.1) * wobble * pp);
                }, false),
              ),
              outline: true,
              outlineColor: new Cesium.CallbackProperty(() => {
                const pp = progressRef.current;
                const wobble = isSurge ? (0.5 + 0.5 * Math.sin(pp * Math.PI * 6)) : 1;
                return baseColor.withAlpha((s.opacity || 0.1) * 2 * wobble * pp);
              }, false),
              height: 5,
            },
          });
          entitiesRef.current.push(entity);
          count++;

          if (s.center) {
            const labelText = isSurge ? `Surge: ${(s.mmi! / 1.5).toFixed(1)}m` : `Rain: ${(s.mmi! * 5).toFixed(0)} mm/hr`;
            const labelEntity = ec.add({
              position: Cesium.Cartesian3.fromDegrees(s.center.lon, s.center.lat, 300),
              label: {
                text: labelText,
                font: '10px monospace',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -10),
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.6)'),
                scale: 0.85,
              },
            });
            entitiesRef.current.push(labelEntity);
            count++;
          }
          break;
        }
        case 'polygon': {
          if (!s.positions || s.positions.length < 4) break;
          const cached = cachePolyPositions(s.positions, 3);
          const entity = ec.add({
            polygon: {
              hierarchy: cached,
              material: new Cesium.CallbackProperty(() => {
                return Cesium.Color.fromCssColorString(s.color || '#fbbf24').withAlpha((s.opacity || 0.08) * progressRef.current);
              }, false),
              outline: true,
              outlineColor: Cesium.Color.fromCssColorString('#fbbf24').withAlpha(0.2),
              height: 3,
            },
          });
          entitiesRef.current.push(entity);
          count++;
          break;
        }
      }
    }

    ec.resumeEvents();
    throttledRender(viewer);
  }, [viewer, shapes, cleanup]); // NO progress dependency!

  useEffect(() => { buildEntities(); }, [buildEntities]);
  // Progress changes only trigger a render — CallbackProperties read progressRef.current
  useEffect(() => { throttledRender(viewer); }, [progress, viewer]);
  useEffect(() => cleanup, [cleanup]);

  return null;
}
