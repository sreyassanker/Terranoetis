import { useEffect, useRef, useCallback } from 'react';
import * as Cesium from 'cesium';
import type { ShapeData } from './types';
import { throttledRender } from '@/lib/throttledRender';

interface VolcanicVisualizerProps {
  viewer: Cesium.Viewer | null;
  shapes: ShapeData[];
  progress: number;
}

const ZONE_LABELS: Record<string, string> = {
  lava: 'LAVA FLOW',
  pdc: 'PYROCLASTIC CURRENT',
  lahar: 'LAHAR',
  ballistic: 'BALLISTIC ZONE',
};

function cachePolyPositions(positions: { lat: number; lon: number }[], height: number): Cesium.Cartesian3[] {
  return positions.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, height));
}

/**
 * Optimized volcanic visualizer
 * - Positions: pre-cached static arrays
 * - Animation: minimal CallbackProperty for opacity (eruption pulse, lava glow, lahar wobble)
 * - Build: only re-runs when shapes change (NOT progress)
 * - Progress: separate useEffect calls throttledRender
 */
export default function VolcanicVisualizer({ viewer, shapes, progress }: VolcanicVisualizerProps) {
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
      if (count >= 50) break;

      switch (s.type) {
        case 'cylinder': {
          if (!s.center) break;
          const baseColor = Cesium.Color.fromCssColorString(s.color);
          const entity = ec.add({
            cylinder: {
              length: new Cesium.CallbackProperty(() => {
                const pulse = 0.7 + 0.3 * Math.sin(progressRef.current * Math.PI * 8);
                return (s.height || 10000) * progressRef.current * pulse;
              }, false),
              topRadius: new Cesium.CallbackProperty(() => {
                return (s.radius || 800) * 0.4 * progressRef.current;
              }, false),
              bottomRadius: new Cesium.CallbackProperty(() => {
                return (s.radius || 800) * progressRef.current;
              }, false),
              material: new Cesium.ColorMaterialProperty(
                new Cesium.CallbackProperty(() => {
                  const pulse = 0.7 + 0.3 * Math.sin(progressRef.current * Math.PI * 8);
                  return baseColor.withAlpha((s.opacity || 0.5) * pulse * progressRef.current);
                }, false),
              ),
            },
            position: Cesium.Cartesian3.fromDegrees(s.center.lon, s.center.lat, 5000),
          });
          entitiesRef.current.push(entity);
          count++;
          break;
        }
        case 'polyline': {
          if (!s.positions || s.positions.length < 2) break;
          const isLava = s.color === '#991b1b';
          const height = isLava ? 20 : 10;
          const cached = cachePolyPositions(s.positions, height);

          if (isLava) {
            const entity = ec.add({
              polyline: {
                positions: cached,
                width: (s.width || 4) + 2,
                material: new Cesium.PolylineGlowMaterialProperty({
                  glowPower: 0.3,
                  color: new Cesium.CallbackProperty(() => {
                    const glow = 0.6 + 0.4 * Math.sin(progressRef.current * Math.PI * 6);
                    return Cesium.Color.fromCssColorString('#ff4500').withAlpha(glow * progressRef.current);
                  }, false) as unknown as Cesium.Property,
                }),
                clampToGround: true,
              },
            });
            entitiesRef.current.push(entity);
            count++;
          } else {
            const entity = ec.add({
              polyline: {
                positions: cached,
                width: s.width || 3,
                material: new Cesium.CallbackProperty(() => {
                  return Cesium.Color.fromCssColorString(s.color).withAlpha((s.opacity || 0.5) * progressRef.current);
                }, false) as unknown as Cesium.Property,
                clampToGround: true,
              },
            });
            entitiesRef.current.push(entity);
            count++;
          }
          break;
        }
        case 'intensity_zone': {
          if (!s.positions || s.positions.length < 3) break;
          const baseColor = Cesium.Color.fromCssColorString(s.color);
          const isLahar = s.waveType === 'lahar';
          const cached = cachePolyPositions(s.positions, 8);
          const entity = ec.add({
            polygon: {
              hierarchy: cached,
              material: new Cesium.ColorMaterialProperty(
                new Cesium.CallbackProperty(() => {
                  const wobble = isLahar ? (0.5 + 0.5 * Math.sin(progressRef.current * Math.PI * 4)) : 1;
                  return baseColor.withAlpha((s.opacity || 0.15) * wobble * progressRef.current);
                }, false),
              ),
              outline: true,
              outlineColor: new Cesium.CallbackProperty(() => {
                return baseColor.withAlpha((s.opacity || 0.15) * 2 * progressRef.current);
              }, false),
              height: 8,
            },
          });
          entitiesRef.current.push(entity);
          count++;

          const zoneLabel = ZONE_LABELS[s.waveType || ''] || '';
          if (zoneLabel && s.center) {
            const labelEntity = ec.add({
              position: Cesium.Cartesian3.fromDegrees(s.center.lon, s.center.lat, 350),
              label: {
                text: zoneLabel,
                font: '10px monospace',
                fillColor: baseColor,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.7)'),
                scale: 0.85,
              },
            });
            entitiesRef.current.push(labelEntity);
            count++;
          }
          break;
        }
        case 'ring': {
          if (!s.center || !s.radius) break;
          const isLava = s.waveType === 'lava';
          const isBallistic = s.waveType === 'ballistic';
          const entity = ec.add({
            ellipse: {
              semiMajorAxis: new Cesium.CallbackProperty(() => s.radius! * progressRef.current, false),
              semiMinorAxis: new Cesium.CallbackProperty(() => s.radius! * 0.9 * progressRef.current, false),
              material: new Cesium.ColorMaterialProperty(
                new Cesium.CallbackProperty(() => {
                  const flicker = isLava ? (0.5 + 0.5 * Math.sin(progressRef.current * Math.PI * 10)) : 1;
                  return Cesium.Color.fromCssColorString(s.color).withAlpha((s.opacity || 0.4) * flicker * progressRef.current);
                }, false),
              ),
              outline: true,
              outlineColor: new Cesium.CallbackProperty(() => {
                return Cesium.Color.fromCssColorString(s.color).withAlpha(0.5 * progressRef.current);
              }, false),
              height: isBallistic ? 5 : 10,
            },
            position: Cesium.Cartesian3.fromDegrees(s.center.lon, s.center.lat, isBallistic ? 5 : 10),
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
