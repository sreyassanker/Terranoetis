/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Cesium from 'cesium';
import * as satellite from 'satellite.js';
import type { LayerCategory } from '@/config/layerConfig';

export function renderLayer(
  viewer: Cesium.Viewer,
  layer: LayerCategory,
  items: any[],
): Cesium.Entity[] {
  switch (layer.type) {
    case 'point':
      return renderPoints(viewer, layer, items);
    case 'heatmap':
      return renderHeatmap(viewer, layer, items);
    case 'geojson':
      return renderGeoJson(viewer, layer, items);
    case 'polygon':
      return renderPolygons(viewer, layer, items);
    default:
      return [];
  }
}

const ICON_CACHE = new Map<string, HTMLCanvasElement>();

function createLayerIcon(color: string, size: number = 12): HTMLCanvasElement {
  const key = color + '_' + size;
  const cached = ICON_CACHE.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2, cy = size / 2;
  const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, size / 2);
  glow.addColorStop(0, Cesium.Color.fromCssColorString(color).withAlpha(0.95).toCssColorString());
  glow.addColorStop(0.5, Cesium.Color.fromCssColorString(color).withAlpha(0.45).toCssColorString());
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = Cesium.Color.fromCssColorString(color).withAlpha(0.9).toCssColorString();
  ctx.fill();
  ICON_CACHE.set(key, canvas);
  return canvas;
}

function renderPoints(
  viewer: Cesium.Viewer,
  layer: LayerCategory,
  items: any[],
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const color = layer.color || '#3b82f6';
  const iconSize = 16;
  const isSpace = layer.group === 'space';

  viewer.entities.suspendEvents();
  try {

  items.forEach((item: any, i: number) => {
    const lat = item.lat ?? item.latitude ?? item.latDeg;
    const lon = item.lon ?? item.longitude ?? item.lng ?? item.lonDeg;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const name = item.name || item.label || item.title || item.id || `${layer.label} ${i}`;

    // Build orbital propagator for space-group satellites (TLE + SGP4 client-side animation)
    let satrec: any = null;
    if (isSpace && item.tle1 && item.tle2) {
      try { satrec = satellite.twoline2satrec(item.tle1, item.tle2); } catch { /* ignore */ }
    }

    const position = satrec
      ? new Cesium.CallbackProperty((time, result) => {
          try {
            const date = Cesium.JulianDate.toDate(time);
            const pv = satellite.propagate(satrec, date);
            if (pv.position && isFinite(pv.position.x)) {
              const gmst = satellite.gstime(date);
              const gd = satellite.eciToGeodetic(pv.position, gmst);
              const slat = satellite.degreesLat(gd.latitude);
              const slon = satellite.degreesLong(gd.longitude);
              return Cesium.Cartesian3.fromDegrees(slon, slat, gd.height * 1000, undefined, result);
            }
          } catch { /* fall through */ }
          return Cesium.Cartesian3.fromDegrees(lon, lat, 0, undefined, result);
        }, false)
      : Cesium.Cartesian3.fromDegrees(lon, lat);

    const billboard: any = {
      image: createLayerIcon(color, isSpace ? 10 : iconSize),
      width: isSpace ? 10 : iconSize,
      height: isSpace ? 10 : iconSize,
      heightReference: isSpace ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
    };
    if (isSpace) {
      billboard.scaleByDistance = new Cesium.NearFarScalar(1.5e6, 2.0, 1.5e8, 0.3);
    }

    const ent = viewer.entities.add({
      position,
      name: String(name),
      billboard,
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
        time: item.time ?? item.timestamp ?? Date.now(),
      },
    });
    ents.push(ent);
  });

  } finally {
    viewer.entities.resumeEvents();
  }
  return ents;
}

function renderHeatmap(
  viewer: Cesium.Viewer,
  layer: LayerCategory,
  items: any[],
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const baseColor = Cesium.Color.fromCssColorString(layer.color || '#f97316');
  const sizes = items.map((item: any) => {
    const lat = item.lat ?? item.latitude;
    const lon = item.lon ?? item.longitude ?? item.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, val: item.value ?? item.magnitude ?? item.intensity ?? item.count ?? 1, item };
  }).filter(Boolean) as { lat: number; lon: number; val: number; item: any }[];

  viewer.entities.suspendEvents();
  try {

  const maxVal = Math.max(1, ...sizes.map(s => s.val));
  sizes.forEach((s) => {
    const t = s.val / maxVal;
    const alpha = 0.15 + t * 0.5;
    const r = 10000 + t * 40000;
    const pos = Cesium.Cartesian3.fromDegrees(s.lon, s.lat);
    const ent = viewer.entities.add({
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
    });
    ents.push(ent);
  });

  } finally {
    viewer.entities.resumeEvents();
  }
  return ents;
}

async function renderGeoJson(
  viewer: Cesium.Viewer,
  layer: LayerCategory,
  items: any[],
): Promise<Cesium.Entity[]> {
  try {
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
    for (let i = 0; i < ds.entities.values.length; i++) {
      const e = ds.entities.values[i];
      e.properties?.addProperty('layer', layer.id);
      ents.push(e);
      viewer.entities.add(e);
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
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const color = Cesium.Color.fromCssColorString(layer.color || '#3b82f6');

  items.forEach((item: any) => {
    const coords = item.coordinates ?? item.geometry?.coordinates ?? [];
    if (!coords.length) return;

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

      if (positions.length < 3) return;

      const ent = viewer.entities.add({
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
      });
      ents.push(ent);
    } catch {
      // skip invalid geometry
    }
  });
  return ents;
}

export function createLayerEntityStoreKey(layerId: string): string {
  return `generic_${layerId}`;
}

export async function fetchLayerData(layer: LayerCategory): Promise<any[]> {
  const params = new URLSearchParams({
    type: layer.type,
    group: layer.group,
    source: layer.dataSource,
    desc: layer.description,
  });
  const apiPath = `/api/data/${layer.id}?${params}`;
  try {
    const resp = await fetch(apiPath, { cache: 'no-store' });
    if (resp.ok) {
      const data = await resp.json();
      return (data as any).items ?? (data as any).features ?? data;
    }
  } catch {
    // fall through
  }

  return [];
}
