import { useEffect, useRef, useCallback } from 'react';
import * as Cesium from 'cesium';
import type { ShapeData } from './types';
import { throttledRender } from '@/lib/throttledRender';

interface LandslideVisualizerProps {
  viewer: Cesium.Viewer | null;
  shapes: ShapeData[];
  progress: number;
}

function cachePolyPositions(positions: { lat: number; lon: number }[], height: number): Cesium.Cartesian3[] {
  return positions.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, height));
}

/**
 * Optimized debris-flow visualizer.
 * - Debris extent: animated polygon growing/opacifying with progress.
 * - Flow path: pulsing glow polyline drawn progressively downslope.
 * - Source ring: expanding ring/ellipse pulse.
 */
export default function LandslideVisualizer({ viewer, shapes, progress }: LandslideVisualizerProps) {
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

    for (const s of shapes) {
      switch (s.type) {
        case 'intensity_zone': {
          if (!s.positions || s.positions.length < 3) break;
          const baseColor = Cesium.Color.fromCssColorString(s.color);
          const cached = cachePolyPositions(s.positions, 8);
          entitiesRef.current.push(ec.add({
            polygon: {
              hierarchy: cached,
              material: new Cesium.ColorMaterialProperty(
                new Cesium.CallbackProperty(() => {
                  const grow = 0.5 + 0.5 * Math.sin(progressRef.current * Math.PI * 2);
                  return baseColor.withAlpha((s.opacity || 0.22) * (0.5 + 0.5 * progressRef.current) * grow);
                }, false),
              ),
              outline: true,
              outlineColor: new Cesium.CallbackProperty(() => {
                return baseColor.withAlpha((s.opacity || 0.22) * 1.6 * progressRef.current);
              }, false),
              height: 8,
            },
          }));
          if (s.center) {
            entitiesRef.current.push(ec.add({
              position: Cesium.Cartesian3.fromDegrees(s.center.lon, s.center.lat, 350),
              label: {
                text: 'DEBRIS FLOW',
                font: '10px monospace',
                fillColor: baseColor,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.7)'),
                scale: 0.85,
              },
            }));
          }
          break;
        }
        case 'polyline': {
          if (!s.positions || s.positions.length < 2) break;
          const cached = cachePolyPositions(s.positions, s.height || 40);
          const entity = ec.add({
            polyline: {
              positions: new Cesium.CallbackProperty(() => {
                const n = Math.max(2, Math.ceil(cached.length * progressRef.current));
                return cached.slice(0, n);
              }, false) as unknown as Cesium.Cartesian3[],
              width: s.width || 4,
              material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.45,
                color: new Cesium.CallbackProperty(() => {
                  const glow = 0.55 + 0.45 * Math.sin(progressRef.current * Math.PI * 4);
                  return Cesium.Color.fromCssColorString(s.color).withAlpha(glow * progressRef.current);
                }, false) as unknown as Cesium.MaterialProperty,
              }),
              clampToGround: true,
            },
          });
          entitiesRef.current.push(entity);
          break;
        }
        case 'ring': {
          if (!s.center || !s.radius) break;
          entitiesRef.current.push(ec.add({
            ellipse: {
              semiMajorAxis: new Cesium.CallbackProperty(() => s.radius! * (0.6 + 0.4 * progressRef.current), false),
              semiMinorAxis: new Cesium.CallbackProperty(() => s.radius! * 0.9 * (0.6 + 0.4 * progressRef.current), false),
              material: new Cesium.ColorMaterialProperty(
                new Cesium.CallbackProperty(() => {
                  const flicker = 0.6 + 0.4 * Math.sin(progressRef.current * Math.PI * 3);
                  return Cesium.Color.fromCssColorString(s.color).withAlpha((s.opacity || 0.35) * flicker * progressRef.current);
                }, false),
              ),
              outline: true,
              outlineColor: new Cesium.CallbackProperty(() => {
                return Cesium.Color.fromCssColorString(s.color).withAlpha(0.5 * progressRef.current);
              }, false),
              height: 6,
            },
            position: Cesium.Cartesian3.fromDegrees(s.center.lon, s.center.lat, 6),
          }));
          break;
        }
      }
    }

    ec.resumeEvents();
    throttledRender(viewer);
  }, [viewer, shapes, cleanup]); // NO progress dependency!

  useEffect(() => { buildEntities(); }, [buildEntities]);
  useEffect(() => { throttledRender(viewer); }, [progress, viewer]);
  useEffect(() => cleanup, [cleanup]);

  return null;
}