import { useEffect, useRef, useCallback } from 'react';
import * as Cesium from 'cesium';
import type { ShapeData } from './types';
import { throttledRender } from '@/lib/throttledRender';

interface EarthquakeVisualizerProps {
  viewer: Cesium.Viewer | null;
  shapes: ShapeData[];
  progress: number;
}

const MMI_COLORS: Record<number, string> = {
  1: '#ccffcc', 2: '#ccffcc', 3: '#99ff99', 4: '#ffff00',
  5: '#ffcc00', 6: '#ff9900', 7: '#ff6600', 8: '#ff3300',
  9: '#cc0000', 10: '#990000', 11: '#660000',
};

const WAVE_CONFIG: Record<string, { color: Cesium.Color; width: number }> = {
  P: { color: Cesium.Color.fromCssColorString('#60a5fa'), width: 3 },
  S: { color: Cesium.Color.fromCssColorString('#f97316'), width: 3 },
  Rayleigh: { color: Cesium.Color.fromCssColorString('#a855f7'), width: 2.5 },
  Love: { color: Cesium.Color.fromCssColorString('#22c55e'), width: 2 },
};

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
 * Optimized earthquake visualizer
 * - Positions: pre-cached static arrays
 * - Animation: minimal CallbackProperty for opacity (damage pulse, liquefaction wobble)
 * - Build: only re-runs when shapes change (NOT progress)
 * - Progress: separate useEffect calls throttledRender
 */
export default function EarthquakeVisualizer({ viewer, shapes, progress }: EarthquakeVisualizerProps) {
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
      if (count >= 60) break;

      switch (s.type) {
        case 'ring': {
          if (!s.center || !s.radius) break;
          const cfg = WAVE_CONFIG[s.waveType || 'P'] || WAVE_CONFIG.P;
          const mag = s.magnitude || 5;
          const amplitude = Math.min(1, (mag - 4) / 5);
          const lineWidth = cfg.width * (0.5 + amplitude * 0.5);
          const ringKm = s.radius / 1000;
          const cachedPositions = cacheRingPositions(s.center, ringKm);
          const entity = ec.add({
            polyline: {
              positions: cachedPositions,
              width: lineWidth,
              material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.15,
                color: new Cesium.CallbackProperty(() => {
                  return cfg.color.withAlpha((s.opacity || 0.5) * progressRef.current);
                }, false) as unknown as Cesium.Property,
              }),
              clampToGround: true,
            },
          });
          entitiesRef.current.push(entity);
          count++;
          break;
        }
        case 'intensity_zone': {
          if (!s.positions || s.positions.length < 3 || !s.mmi) break;
          const color = Cesium.Color.fromCssColorString(MMI_COLORS[s.mmi] || '#ffff00');
          const alpha = 0.08 + (s.mmi / 11) * 0.12;
          const cached = cachePolyPositions(s.positions, 5);
          const entity = ec.add({
            polygon: {
              hierarchy: cached,
              material: new Cesium.CallbackProperty(() => {
                return color.withAlpha(alpha * progressRef.current);
              }, false),
              outline: true,
              outlineColor: new Cesium.CallbackProperty(() => {
                return color.withAlpha(alpha * 2 * progressRef.current);
              }, false),
              outlineWidth: 1,
              height: 5,
            },
          });
          entitiesRef.current.push(entity);
          count++;
          break;
        }
        case 'damage_zone': {
          if (!s.positions || s.positions.length < 3) break;
          const damage = s.damagePercent || 0;
          const cached = cachePolyPositions(s.positions, 8);
          const entity = ec.add({
            polygon: {
              hierarchy: cached,
              material: new Cesium.ColorMaterialProperty(
                new Cesium.CallbackProperty(() => {
                  const pulse = 0.5 + 0.5 * Math.sin(progressRef.current * Math.PI * 4);
                  const alpha = (0.06 + damage * 0.001) * pulse * progressRef.current;
                  return Cesium.Color.fromCssColorString('#dc2626').withAlpha(alpha);
                }, false),
              ),
              outline: true,
              outlineColor: new Cesium.CallbackProperty(() => {
                const pulse = 0.5 + 0.5 * Math.sin(progressRef.current * Math.PI * 4);
                return Cesium.Color.fromCssColorString('#dc2626').withAlpha(0.25 * pulse * progressRef.current);
              }, false),
              height: 8,
            },
          });
          entitiesRef.current.push(entity);
          count++;

          if (s.center) {
            const labelEntity = ec.add({
              position: Cesium.Cartesian3.fromDegrees(s.center.lon, s.center.lat, 200),
              label: {
                text: `${damage.toFixed(0)}% damage`,
                font: '11px monospace',
                fillColor: Cesium.Color.fromCssColorString('#fca5a5'),
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -10),
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.6)'),
                scale: 0.9,
              },
            });
            entitiesRef.current.push(labelEntity);
            count++;
          }
          break;
        }
        case 'liquefaction_zone': {
          if (!s.positions || s.positions.length < 3) break;
          const prob = s.liquefactionProb || 0;
          const cached = cachePolyPositions(s.positions, 6);
          const entity = ec.add({
            polygon: {
              hierarchy: cached,
              material: new Cesium.ColorMaterialProperty(
                new Cesium.CallbackProperty(() => {
                  const wobble = 0.5 + 0.5 * Math.sin(progressRef.current * Math.PI * 6);
                  const alpha = prob * 0.15 * wobble * progressRef.current;
                  return Cesium.Color.fromCssColorString('#eab308').withAlpha(alpha);
                }, false),
              ),
              outline: true,
              outlineColor: new Cesium.CallbackProperty(() => {
                const wobble = 0.5 + 0.5 * Math.sin(progressRef.current * Math.PI * 6);
                return Cesium.Color.fromCssColorString('#ca8a04').withAlpha(0.2 * wobble * progressRef.current);
              }, false),
              height: 6,
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
