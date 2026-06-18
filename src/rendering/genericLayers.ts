/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Cesium from 'cesium';
import * as satellite from 'satellite.js';
import type { LayerCategory } from '@/config/layerConfig';
import type { GhostProtocol } from './ghostProtocol';
import type { FutureTensorDomain } from './FutureTensor';

export async function renderLayer(
  viewer: Cesium.Viewer,
  layer: LayerCategory,
  items: any[],
  ghostProtocol?: GhostProtocol | null,
): Promise<Cesium.Entity[]> {
  switch (layer.type) {
    case 'point':
      return renderPoints(viewer, layer, items, ghostProtocol);
    case 'heatmap':
      return renderHeatmap(viewer, layer, items, ghostProtocol);
    case 'geojson':
      return renderGeoJson(viewer, layer, items, ghostProtocol);
    case 'polygon':
      return renderPolygons(viewer, layer, items, ghostProtocol);
    default:
      return [];
  }
}

/**
 * Maps a Cesium layer group ID to a FutureTensor predictive domain.
 * Seismic maps directly; weather/atmosphere → 'weather'; ocean/argo/tides/ports
 * → 'maritime'; aviation → 'aviation'; everything else defaults to 'seismic'
 * for static-layer probability halo rendering.
 */
export function mapGroupToDomain(group: string): FutureTensorDomain {
  switch (group) {
    case 'seismic':
      return 'seismic';
    case 'weather':
    case 'atmosphere':
      return 'weather';
    case 'aviation':
      return 'aviation';
    case 'ocean':
    case 'argo':
    case 'tides':
    case 'ports':
    case 'usgs_water':
      return 'maritime';
    case 'satellite':
    case 'space':
      return 'aviation';
    default:
      return 'seismic';
  }
}

function renderPoints(
  viewer: Cesium.Viewer,
  layer: LayerCategory,
  items: any[],
  ghostProtocol?: GhostProtocol | null,
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const color = Cesium.Color.fromCssColorString(layer.color || '#3b82f6');
  const isSpace = layer.group === 'space';
  const domain = mapGroupToDomain(layer.group);

  viewer.entities.suspendEvents();
  try {

  items.forEach((item: any, i: number) => {
    const lat = item.lat ?? item.latitude ?? item.latDeg;
    const lon = item.lon ?? item.longitude ?? item.lng ?? item.lonDeg;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const name = item.name || item.label || item.title || item.id || `${layer.label} ${i}`;
    const entityId = `${layer.id}_p_${i}`;

    // Build orbital propagator for space-group satellites (TLE + SGP4 client-side animation)
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

    const config: Cesium.Entity.ConstructorOptions = {
      id: entityId,
      position,
      name: String(name),
      point: {
        pixelSize: 6,
        color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1,
        heightReference: isSpace ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
        ...(isSpace ? { scaleByDistance: new Cesium.NearFarScalar(1.5e6, 2.0, 1.5e8, 0.3) } : {}),
      },
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

    if (ghostProtocol) {
      // GhostProtocol handles entity creation via GhostEntity constructor
      ghostProtocol.createGhost(entityId, config, domain, null, null);
      const ghostEntity = ghostProtocol.getGhost(entityId)?.getRealEntity();
      if (ghostEntity) ents.push(ghostEntity);
    } else {
      const ent = viewer.entities.add(config);
      ents.push(ent);
    }
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
  ghostProtocol?: GhostProtocol | null,
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const baseColor = Cesium.Color.fromCssColorString(layer.color || '#f97316');
  const domain = mapGroupToDomain(layer.group);
  const sizes = items.map((item: any) => {
    const lat = item.lat ?? item.latitude;
    const lon = item.lon ?? item.longitude ?? item.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, val: item.value ?? item.magnitude ?? item.intensity ?? item.count ?? 1, item };
  }).filter(Boolean) as { lat: number; lon: number; val: number; item: any }[];

  viewer.entities.suspendEvents();
  try {

  const maxVal = Math.max(1, ...sizes.map(s => s.val));
  sizes.forEach((s, i) => {
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

    if (ghostProtocol) {
      ghostProtocol.createGhost(entityId, config, domain, null, null);
      const ghostEntity = ghostProtocol.getGhost(entityId)?.getRealEntity();
      if (ghostEntity) ents.push(ghostEntity);
    } else {
      const ent = viewer.entities.add(config);
      ents.push(ent);
    }
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
      if (ghostProtocol) {
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
): Cesium.Entity[] {
  const ents: Cesium.Entity[] = [];
  const color = Cesium.Color.fromCssColorString(layer.color || '#3b82f6');
  const domain = mapGroupToDomain(layer.group);

  items.forEach((item: any, i: number) => {
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

      if (ghostProtocol) {
        // Use polygon centroid as position for the ghost entity
        const centroid = computePolygonCentroid(positions);
        ghostProtocol.createGhost(entityId, { ...config, position: centroid }, domain, null, null);
        const ghostEntity = ghostProtocol.getGhost(entityId)?.getRealEntity();
        if (ghostEntity) ents.push(ghostEntity);
      } else {
        const ent = viewer.entities.add(config);
        ents.push(ent);
      }
    } catch {
      // skip invalid geometry
    }
  });
  return ents;
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