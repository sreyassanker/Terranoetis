import { useEffect, useRef, useCallback } from 'react';
import * as Cesium from 'cesium';
import type { ShapeData } from './types';
import { throttledRender } from '@/lib/throttledRender';

interface WildfireVisualizerProps {
  viewer: Cesium.Viewer | null;
  shapes: ShapeData[];
  progress: number;
}

function cachePolyPositions(positions: { lat: number; lon: number }[], height: number): Cesium.Cartesian3[] {
  return positions.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, height));
}

/**
 * Optimized wildfire visualizer
 * - Positions: pre-cached static arrays
 * - Animation: minimal CallbackProperty for opacity (fire flicker, smoke drift, crown pulse)
 * - Build: only re-runs when shapes change (NOT progress)
 * - Progress: separate useEffect calls throttledRender
 */
export default function WildfireVisualizer({ viewer, shapes, progress }: WildfireVisualizerProps) {
  const entitiesRef = useRef<Cesium.Entity[]>([]);
  const progressRef = useRef(progress);
  progressRef.current = progress;

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
        case 'polyline': {
          if (!s.positions || s.positions.length < 2) break;
          const isFireFront = s.color === '#ef4444' && s.opacity > 0.7;
          const isEvacGreen = s.color === '#22c55e';
          const isEvacRed = s.color === '#ef4444' && s.opacity <= 0.7;
          const cached = cachePolyPositions(s.positions, isFireFront ? 15 : 12);

          if (isFireFront) {
            const entity = ec.add({
              polyline: {
                positions: cached,
                width: 5,
                material: new Cesium.PolylineGlowMaterialProperty({
                  glowPower: 0.25,
                  color: new Cesium.CallbackProperty(() => {
                    const flicker = 0.7 + 0.3 * Math.sin(progressRef.current * Math.PI * 12);
                    return Cesium.Color.fromCssColorString('#ef4444').withAlpha(flicker * progressRef.current);
                  }, false) as unknown as Cesium.Property,
                }),
                clampToGround: true,
              },
            });
            entitiesRef.current.push(entity);
            count++;
          } else if (isEvacGreen || isEvacRed) {
            const entity = ec.add({
              polyline: {
                positions: cached,
                width: 3,
                material: new Cesium.PolylineDashMaterialProperty({
                  color: new Cesium.CallbackProperty(() => {
                    return Cesium.Color.fromCssColorString(s.color).withAlpha((s.opacity || 0.7) * progressRef.current);
                  }, false) as unknown as Cesium.Property,
                  dashLength: 16,
                }),
                clampToGround: true,
              },
            });
            entitiesRef.current.push(entity);
            count++;

            if (s.positions.length > 0) {
              const mid = s.positions[Math.floor(s.positions.length / 2)];
              const labelEntity = ec.add({
                position: Cesium.Cartesian3.fromDegrees(mid.lon, mid.lat, 200),
                label: {
                  text: isEvacGreen ? 'EVAC ROUTE' : 'ROUTE BLOCKED',
                  font: '10px monospace',
                  fillColor: Cesium.Color.fromCssColorString(s.color),
                  outlineColor: Cesium.Color.BLACK,
                  outlineWidth: 2,
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  showBackground: true,
                  backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.6)'),
                  scale: 0.85,
                },
              });
              entitiesRef.current.push(labelEntity);
              count++;
            }
          } else {
            const entity = ec.add({
              polyline: {
                positions: cached,
                width: s.width || 2,
                material: new Cesium.CallbackProperty(() => {
                  return Cesium.Color.fromCssColorString(s.color).withAlpha((s.opacity || 0.25) * progressRef.current);
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
          const cached = cachePolyPositions(s.positions, 5);
          const entity = ec.add({
            polygon: {
              hierarchy: cached,
              material: new Cesium.ColorMaterialProperty(
                new Cesium.CallbackProperty(() => {
                  return baseColor.withAlpha((s.opacity || 0.15) * progressRef.current);
                }, false),
              ),
              outline: true,
              outlineColor: new Cesium.CallbackProperty(() => {
                return baseColor.withAlpha((s.opacity || 0.15) * 2 * progressRef.current);
              }, false),
              height: 5,
            },
          });
          entitiesRef.current.push(entity);
          count++;

          const severityLabel = getSeverityLabel(s.mmi || 0);
          if (s.center && severityLabel) {
            const labelEntity = ec.add({
              position: Cesium.Cartesian3.fromDegrees(s.center.lon, s.center.lat, 250),
              label: {
                text: severityLabel,
                font: '9px monospace',
                fillColor: baseColor,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.6)'),
                scale: 0.8,
              },
            });
            entitiesRef.current.push(labelEntity);
            count++;
          }
          break;
        }
        case 'cylinder': {
          if (!s.center) break;
          const baseColor = Cesium.Color.fromCssColorString(s.color || '#6b7280');
          const entity = ec.add({
            cylinder: {
              length: new Cesium.CallbackProperty(() => {
                return (s.height || 3000) * progressRef.current;
              }, false),
              topRadius: new Cesium.CallbackProperty(() => {
                return (s.radius || 10000) * 0.3 * progressRef.current;
              }, false),
              bottomRadius: new Cesium.CallbackProperty(() => {
                return (s.radius || 10000) * progressRef.current;
              }, false),
              material: new Cesium.ColorMaterialProperty(
                new Cesium.CallbackProperty(() => {
                  const drift = 0.5 + 0.5 * Math.sin(progressRef.current * Math.PI * 3);
                  return baseColor.withAlpha((s.opacity || 0.12) * drift * progressRef.current);
                }, false),
              ),
            },
            position: Cesium.Cartesian3.fromDegrees(s.center.lon, s.center.lat, 1200),
          });
          entitiesRef.current.push(entity);
          count++;
          break;
        }
        case 'ring': {
          if (!s.center || !s.radius) break;
          const entity = ec.add({
            ellipse: {
              semiMajorAxis: new Cesium.CallbackProperty(() => s.radius! * progressRef.current, false),
              semiMinorAxis: new Cesium.CallbackProperty(() => s.radius! * 0.8 * progressRef.current, false),
              material: Cesium.Color.fromCssColorString(s.color).withAlpha(0.6),
              outline: true,
              outlineColor: Cesium.Color.fromCssColorString('#ff9900').withAlpha(0.5),
              height: 10,
            },
            position: Cesium.Cartesian3.fromDegrees(s.center.lon, s.center.lat, 10),
          });
          entitiesRef.current.push(entity);
          count++;
          break;
        }
        case 'damage_zone': {
          if (!s.center) break;
          const baseColor = Cesium.Color.fromCssColorString(s.color);
          const entity = ec.add({
            ellipse: {
              semiMajorAxis: new Cesium.CallbackProperty(() => (s.radius || 5000) * progressRef.current, false),
              semiMinorAxis: new Cesium.CallbackProperty(() => (s.radius || 5000) * 0.85 * progressRef.current, false),
              material: new Cesium.ColorMaterialProperty(
                new Cesium.CallbackProperty(() => {
                  const pulse = 0.5 + 0.5 * Math.sin(progressRef.current * Math.PI * 10);
                  return baseColor.withAlpha((s.opacity || 0.12) * pulse * progressRef.current);
                }, false),
              ),
              outline: true,
              outlineColor: new Cesium.CallbackProperty(() => {
                return Cesium.Color.fromCssColorString('#ff0000').withAlpha(0.4 * progressRef.current);
              }, false),
              height: 15,
            },
            position: Cesium.Cartesian3.fromDegrees(s.center.lon, s.center.lat, 15),
          });
          entitiesRef.current.push(entity);
          count++;

          if (s.damagePercent) {
            const labelEntity = ec.add({
              position: Cesium.Cartesian3.fromDegrees(s.center.lon, s.center.lat, 400),
              label: {
                text: `CROWN FIRE — ${s.damagePercent}% canopy loss`,
                font: '10px monospace',
                fillColor: Cesium.Color.fromCssColorString('#ff4444'),
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

function getSeverityLabel(dnbrScaled: number): string {
  if (dnbrScaled >= 6) return 'HIGH SEVERITY';
  if (dnbrScaled >= 4) return 'MODERATE';
  if (dnbrScaled >= 2) return 'LOW SEVERITY';
  return '';
}
