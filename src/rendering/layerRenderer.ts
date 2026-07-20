/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Cesium from 'cesium';
import * as satellite from 'satellite.js';
import type { LayerCategory } from '@/lib/layerConfig';
import type { GhostProtocol } from './ghostProtocol';
import type { FutureTensorDomain } from './trajectoryPredictor';

const MAX_ITEMS_PER_LAYER = 500;

// ── Ocean current arrow billboard ──
let _arrowCanvas: HTMLCanvasElement | null = null;

function getArrowCanvas(): HTMLCanvasElement {
  if (_arrowCanvas) return _arrowCanvas;
  const c = document.createElement('canvas');
  c.width = 24;
  c.height = 24;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 24, 24);
  ctx.translate(12, 12);

  // Tear-drop / streamline-shaped glyph for CFD flow feel
  const grad = ctx.createLinearGradient(-4, 0, 10, 0);
  grad.addColorStop(0, 'rgba(147, 197, 253, 0.5)');
  grad.addColorStop(1, 'rgba(6, 182, 212, 1)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-3, -5);
  ctx.lineTo(-1, 0);
  ctx.lineTo(-3, 5);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  _arrowCanvas = c;
  return c;
}

const BATCH_SIZE = 50;
const FRAME_BUDGET_MS = 8;

function batchCreate(
  items: any[],
  createFn: (item: any, i: number) => Cesium.Entity | null,
): Promise<Cesium.Entity[]> {
  return new Promise((resolve) => {
    const ents: Cesium.Entity[] = [];
    let idx = 0;

    function processBatch() {
      const start = performance.now();
      while (idx < items.length) {
        const ent = createFn(items[idx], idx);
        if (ent) ents.push(ent);
        idx++;
        if (idx % BATCH_SIZE === 0 && performance.now() - start > FRAME_BUDGET_MS) break;
      }
      if (idx < items.length) {
        requestAnimationFrame(processBatch);
      } else {
        resolve(ents);
      }
    }
    requestAnimationFrame(processBatch);
  });
}

export async function renderLayer(
  viewer: Cesium.Viewer,
  layer: LayerCategory,
  items: any[],
  ghostProtocol?: GhostProtocol | null,
): Promise<Cesium.Entity[]> {
  const capped = items.slice(0, MAX_ITEMS_PER_LAYER);
  switch (layer.type) {
    case 'point':
      return renderPoints(viewer, layer, capped, ghostProtocol);
    case 'heatmap':
      return renderHeatmap(viewer, layer, capped, ghostProtocol);
    case 'geojson':
      return renderGeoJson(viewer, layer, capped, ghostProtocol);
    case 'polygon':
      return renderPolygons(viewer, layer, capped, ghostProtocol);
    default:
      return [];
  }
}

/**
 * Maps a Cesium layer group ID to a FutureTensor predictive domain.
 * Returns null for static layers that don't need probability trails.
 * Only maritime (ships) and aviation (aircraft) entities move fast enough
 * to benefit from GhostProtocol prediction trails.
 */
export function mapGroupToDomain(group: string): FutureTensorDomain | null {
  switch (group) {
    default:
      return null;
  }
}

function renderPoints(
  viewer: Cesium.Viewer,
  layer: LayerCategory,
  items: any[],
  ghostProtocol?: GhostProtocol | null,
): Promise<Cesium.Entity[]> {
  const color = Cesium.Color.fromCssColorString(layer.color || '#3b82f6');
  const isSpace = layer.group === 'space';
  const domain = mapGroupToDomain(layer.group);

  function createOne(item: any, i: number): Cesium.Entity | null {
    const lat = item.lat ?? item.latitude ?? item.latDeg;
    const lon = item.lon ?? item.longitude ?? item.lng ?? item.lonDeg;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const name = item.name || item.label || item.title || item.id || `${layer.label} ${i}`;
    const entityId = `${layer.id}_p_${i}`;

    let satrec: any = null;
    if (isSpace && item.tle1 && item.tle2) {
      try { satrec = satellite.twoline2satrec(item.tle1, item.tle2); } catch { /* ignore */ }
    }

    const position = satrec
      ? new Cesium.CallbackProperty((time: Cesium.JulianDate | undefined, _result: number[]) => {
          try {
            const date = Cesium.JulianDate.toDate(time!);
            const pv = satellite.propagate(satrec, date);
            const pos = pv?.position;
            if (pos && typeof pos.x === 'number' && isFinite(pos.x)) {
              const gmst = satellite.gstime(date);
              const gd = satellite.eciToGeodetic(pos, gmst);
              const slat = satellite.degreesLat(gd.latitude);
              const slon = satellite.degreesLong(gd.longitude);
              return Cesium.Cartesian3.fromDegrees(slon, slat, gd.height * 1000);
            }
          } catch { /* fall through */ }
          return Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        }, false) as unknown as Cesium.PositionProperty
      : Cesium.Cartesian3.fromDegrees(lon, lat);

    const hasHeading = item.heading != null;

    let entityPosition: Cesium.PositionProperty | Cesium.Cartesian3 = position;
    let shapeConfig: any = null;

    if (hasHeading) {
      const phaseOffset = ((i * 137.5 + Math.abs(lat * 7) + Math.abs(lon * 13)) % 10000);
      const speedMs = Math.max(0.1, item.value || 0.5);
      const speedFactor = Math.max(0.3, Math.min(3, speedMs * 1.5));
      const headingRad = Cesium.Math.toRadians(item.heading);
      const maxDriftDeg = 3;
      const cycleMs = 10000 / speedFactor;

      const fadeWindow = 0.18;

      // Speed-to-color mapping: slow = teal, fast = amber
      const speedNorm = Math.min(1, speedMs / 2);
      const cr = 0.1 + speedNorm * 0.7;
      const cg = 0.7 - speedNorm * 0.4;
      const cb = 0.8 - speedNorm * 0.6;

      entityPosition = new Cesium.CallbackProperty(() => {
        const elapsed = ((Date.now() + phaseOffset) % cycleMs);
        const progress = elapsed / cycleMs;
        const driftDeg = progress * maxDriftDeg;
        return Cesium.Cartesian3.fromDegrees(
          lon + Math.sin(headingRad) * driftDeg,
          lat + Math.cos(headingRad) * driftDeg,
        );
      }, false) as unknown as Cesium.PositionProperty;

      const animColor = new Cesium.CallbackProperty(() => {
        const elapsed = ((Date.now() + phaseOffset) % cycleMs);
        const progress = elapsed / cycleMs;
        const driftDeg = progress * maxDriftDeg;
        const fadeIn = Math.min(1, driftDeg / (maxDriftDeg * fadeWindow));
        const fadeOut = Math.min(1, (maxDriftDeg - driftDeg) / (maxDriftDeg * fadeWindow));
        const a = Math.min(fadeIn, fadeOut);
        return new Cesium.Color(cr, cg, cb, a);
      }, false);

      shapeConfig = {
        billboard: {
          image: getArrowCanvas(),
          rotation: Cesium.Math.toRadians(90 - item.heading),
          scale: 0.7,
          color: animColor,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          scaleByDistance: new Cesium.NearFarScalar(1.5e6, 1.2, 1.5e8, 0.3),
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        },
      };

      const trailLen = 0.3 + speedMs * 0.4;
      const trailPos = new Cesium.CallbackProperty(() => {
        const elapsed = ((Date.now() + phaseOffset) % cycleMs);
        const progress = elapsed / cycleMs;
        const driftDeg = progress * maxDriftDeg;
        const aLon = lon + Math.sin(headingRad) * driftDeg;
        const aLat = lat + Math.cos(headingRad) * driftDeg;
        const tLon = aLon - Math.sin(headingRad) * trailLen;
        const tLat = aLat - Math.cos(headingRad) * trailLen;
        return [
          Cesium.Cartesian3.fromDegrees(tLon, tLat),
          Cesium.Cartesian3.fromDegrees(aLon, aLat),
        ];
      }, false);

      const trailMat = new Cesium.CallbackProperty(() => {
        const elapsed = ((Date.now() + phaseOffset) % cycleMs);
        const progress = elapsed / cycleMs;
        const driftDeg = progress * maxDriftDeg;
        const fadeIn = Math.min(1, driftDeg / (maxDriftDeg * fadeWindow));
        const fadeOut = Math.min(1, (maxDriftDeg - driftDeg) / (maxDriftDeg * fadeWindow));
        const a = Math.min(fadeIn, fadeOut) * 0.4;
        return new Cesium.Color(cr, cg, cb, a);
      }, false);

      viewer.entities.add({
        id: `${entityId}_trail`,
        polyline: {
          positions: trailPos,
          width: 2,
          material: new Cesium.ColorMaterialProperty(trailMat),
          clampToGround: true,
          arcType: Cesium.ArcType.RHUMB,
        },
      });
    } else {
      shapeConfig = {
        point: {
          pixelSize: 6,
          color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          heightReference: isSpace ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
          ...(isSpace ? { scaleByDistance: new Cesium.NearFarScalar(1.5e6, 2.0, 1.5e8, 0.3) } : {}),
        },
      };
    }

    const config: Cesium.Entity.ConstructorOptions = {
      id: entityId,
      position: entityPosition,
      name: String(name),
      ...shapeConfig,
      label: {
        text: typeof name === 'string' && name.length > 20 ? name.slice(0, 18) + '...' : String(name),
        font: '9px Space Grotesk, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1.5,
        pixelOffset: new Cesium.Cartesian2(0, -10),
        distanceDisplayCondition: isSpace ? new Cesium.DistanceDisplayCondition(0, 1e8) : new Cesium.DistanceDisplayCondition(0, 2000000),
        show: false,
      },
      properties: {
        layer: layer.id,
        ...item,
        lat,
        lon,
      },
      show: true,
    };

    if (ghostProtocol && domain) {
      ghostProtocol.createGhost(entityId, config, domain, null, null);
      const ghostEntity = ghostProtocol.getGhost(entityId)?.getRealEntity();
      return ghostEntity ?? null;
    } else {
      return viewer.entities.add(config);
    }
  }

  return batchCreate(items, createOne);
}

function renderHeatmap(
  viewer: Cesium.Viewer,
  layer: LayerCategory,
  items: any[],
  ghostProtocol?: GhostProtocol | null,
): Promise<Cesium.Entity[]> {
  const baseColor = Cesium.Color.fromCssColorString(layer.color || '#f97316');
  const domain = mapGroupToDomain(layer.group);
  const sizes = items.map((item: any) => {
    const lat = item.lat ?? item.latitude;
    const lon = item.lon ?? item.longitude ?? item.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, val: item.value ?? item.magnitude ?? item.intensity ?? item.count ?? 1, item };
  }).filter(Boolean) as { lat: number; lon: number; val: number; item: any }[];

  const maxVal = Math.max(1, ...sizes.map(s => s.val));

  function createOne(s: { lat: number; lon: number; val: number; item: any }, i: number): Cesium.Entity | null {
    const t = s.val / maxVal;
    const alpha = 0.15 + t * 0.5;
    const r = 10000 + t * 40000;
    const pos = Cesium.Cartesian3.fromDegrees(s.lon, s.lat);
    const entityId = `${layer.id}_h_${i}`;

    const config: Cesium.Entity.ConstructorOptions = {
      id: entityId,
      position: pos,
      name: String(s.item.name ?? s.item.label ?? ''),
      ellipse: {
        semiMinorAxis: r,
        semiMajorAxis: r,
        material: baseColor.withAlpha(alpha),
        outline: true,
        outlineColor: baseColor.withAlpha(alpha * 0.6),
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: s.item.name ? String(s.item.name) : `${s.val.toFixed(1)}`,
        font: '9px Space Grotesk, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1.5,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        show: false,
      },
      properties: {
        layer: layer.id,
        ...s.item,
        lat: s.lat,
        lon: s.lon,
        time: s.item.time ?? s.item.timestamp ?? Date.now(),
      },
    };

    if (ghostProtocol && domain) {
      ghostProtocol.createGhost(entityId, config, domain, null, null);
      const ghostEntity = ghostProtocol.getGhost(entityId)?.getRealEntity();
      return ghostEntity ?? null;
    } else {
      return viewer.entities.add(config);
    }
  }

  return batchCreate(sizes, createOne);
}

async function renderGeoJson(
  viewer: Cesium.Viewer,
  layer: LayerCategory,
  items: any[],
  ghostProtocol?: GhostProtocol | null,
): Promise<Cesium.Entity[]> {
  try {
    // Group fallback data arrives as flat objects {id, name, lat, lon, ...}
    // Convert to valid GeoJSON Features with Point geometry before passing to Cesium
    const hasGeoJsonStructure = items.length > 0 && (items[0].geometry || items[0].type === 'Feature');
    if (!hasGeoJsonStructure) {
      return renderPoints(viewer, layer, items, ghostProtocol);
    }
    const geoJson = items.length === 1 && items[0]?.type === 'FeatureCollection'
      ? items[0]
      : { type: 'FeatureCollection' as const, features: items };
    const ds = await Cesium.GeoJsonDataSource.load(geoJson, {
      clampToGround: true,
      stroke: Cesium.Color.fromCssColorString(layer.color || '#3b82f6').withAlpha(0.6),
      fill: Cesium.Color.fromCssColorString(layer.color || '#3b82f6').withAlpha(0.15),
      strokeWidth: 2,
    });
    const ents: Cesium.Entity[] = [];
    const domain = mapGroupToDomain(layer.group);

    for (let i = 0; i < ds.entities.values.length; i++) {
      const e = ds.entities.values[i];
      e.properties?.addProperty('layer', layer.id);
      ents.push(e);
      viewer.entities.add(e);

      // Attach ghost entity for probability trail/halo alongside geojson geometry
      if (ghostProtocol && domain) {
        const entityId = `${layer.id}_gj_${i}`;
        const pos = e.position?.getValue(Cesium.JulianDate.now());
        if (pos instanceof Cesium.Cartesian3) {
          ghostProtocol.createGhost(
            entityId,
            { id: entityId, position: pos.clone() },
            domain,
            null,
            null,
          );
        }
      }
    }
    return ents;
  } catch {
    return [];
  }
}

function renderPolygons(
  viewer: Cesium.Viewer,
  layer: LayerCategory,
  items: any[],
  ghostProtocol?: GhostProtocol | null,
): Promise<Cesium.Entity[]> {
  const color = Cesium.Color.fromCssColorString(layer.color || '#3b82f6');
  const domain = mapGroupToDomain(layer.group);

  function createOne(item: any, i: number): Cesium.Entity | null {
    const coords = item.coordinates ?? item.geometry?.coordinates ?? [];
    if (!coords.length) return null;

    try {
      const ring = Array.isArray(coords[0]) ? coords[0] : coords;
      const positions = ring
        .map((c: any) => {
          if (Array.isArray(c) && c.length >= 2) {
            return Cesium.Cartesian3.fromDegrees(Number(c[0]), Number(c[1]));
          }
          if (c.lat != null && c.lon != null) {
            return Cesium.Cartesian3.fromDegrees(Number(c.lon), Number(c.lat));
          }
          return null;
        })
        .filter(Boolean) as Cesium.Cartesian3[];

      if (positions.length < 3) return null;

      const entityId = `${layer.id}_poly_${i}`;

      const config: Cesium.Entity.ConstructorOptions = {
        id: entityId,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: color.withAlpha(0.25),
          outline: true,
          outlineColor: color.withAlpha(0.5),
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        properties: {
          layer: layer.id,
          name: item.name ?? item.label ?? '',
          ...item,
          time: item.time ?? item.timestamp ?? Date.now(),
        },
      };

      if (ghostProtocol && domain) {
        const centroid = computePolygonCentroid(positions);
        ghostProtocol.createGhost(entityId, { ...config, position: centroid }, domain, null, null);
        const ghostEntity = ghostProtocol.getGhost(entityId)?.getRealEntity();
        return ghostEntity ?? null;
      } else {
        return viewer.entities.add(config);
      }
    } catch {
      return null;
    }
  }

  return batchCreate(items, createOne);
}

/**
 * Computes the centroid (average) of a polygon's positions for use
 * as the ghost entity anchor point.
 */
function computePolygonCentroid(positions: Cesium.Cartesian3[]): Cesium.Cartesian3 {
  const avg = new Cesium.Cartesian3(0, 0, 0);
  for (const p of positions) {
    Cesium.Cartesian3.add(avg, p, avg);
  }
  return Cesium.Cartesian3.divideByScalar(avg, positions.length, avg);
}


export async function fetchLayerData(layer: LayerCategory): Promise<any[]> {
  const params = new URLSearchParams({
    type: layer.type,
    group: layer.group,
    source: layer.dataSource,
    desc: layer.description,
  });
  const apiPath = `/api/data/${layer.id}?${params}`;
  const headers: Record<string, string> = {};
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const resp = await fetch(apiPath, { cache: 'no-store', headers });
    if (resp.ok) {
      const data = await resp.json();
      return (data as any).items ?? (data as any).features ?? data;
    }
  } catch {
    // fall through
  }

  return [];
}