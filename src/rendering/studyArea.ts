import * as Cesium from 'cesium';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point, polygon } from '@turf/helpers';

export interface StudyAreaItem {
  id: string;
  name: string;
  type: 'rectangle' | 'polygon' | 'circle' | 'geojson' | 'shapefile';
  visible: boolean;
  active: boolean;
  dataSource?: Cesium.GeoJsonDataSource;
  entity?: Cesium.Entity;
  positions?: Cesium.Cartesian3[];
  geojson?: GeoJSON.FeatureCollection;
  color: string;
  width: number;
  outlinePrimitive?: Cesium.GroundPolylinePrimitive;
}

let areaIdCounter = 0;
export function generateAreaId(): string {
  return `study_area_${++areaIdCounter}`;
}

export function loadGeoJsonToGlobe(
  viewer: Cesium.Viewer,
  geojson: GeoJSON.FeatureCollection,
  name: string,
  color: string,
): Promise<Cesium.GeoJsonDataSource> {
  const ds = new Cesium.GeoJsonDataSource(name);
  return ds.load(geojson, {
    stroke: Cesium.Color.fromCssColorString(color),
    fill: Cesium.Color.fromCssColorString(color).withAlpha(0),
    strokeWidth: 1,
    clampToGround: true,
  }).then(() => {
    viewer.dataSources.add(ds);
    return ds;
  });
}

/* ── Top-down camera fly-to from bbox ── */
export function flyToStudyAreaTopDown(viewer: Cesium.Viewer, item: StudyAreaItem): void {
  let rect: Cesium.Rectangle | undefined;
  if (item.positions && item.positions.length >= 2) {
    rect = Cesium.Rectangle.fromCartesianArray(item.positions, Cesium.Ellipsoid.WGS84);
  } else if (item.geojson) {
    rect = computeGeoJSONBbox(item.geojson);
  }
  if (!rect) return;
  const lon = Cesium.Math.toDegrees((rect.west + rect.east) / 2);
  const lat = Cesium.Math.toDegrees((rect.south + rect.north) / 2);
  const width = Cesium.Math.toDegrees(rect.east - rect.west);
  const height = Cesium.Math.toDegrees(rect.north - rect.south);
  const maxDim = Math.max(width, height, 0.01);
  const heightAbove = maxDim * 111000 * 1.8;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(heightAbove, 5000)),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    duration: 1.2,
  });
}

export function computeStudyAreaBbox(item: StudyAreaItem): { latMin: number; latMax: number; lonMin: number; lonMax: number } | null {
  let rect: Cesium.Rectangle | undefined;
  if (item.positions && item.positions.length >= 2) {
    rect = Cesium.Rectangle.fromCartesianArray(item.positions, Cesium.Ellipsoid.WGS84);
  } else if (item.geojson) {
    rect = computeGeoJSONBbox(item.geojson);
  }
  if (!rect) return null;
  return {
    latMin: Cesium.Math.toDegrees(rect.south),
    latMax: Cesium.Math.toDegrees(rect.north),
    lonMin: Cesium.Math.toDegrees(rect.west),
    lonMax: Cesium.Math.toDegrees(rect.east),
  };
}

function computeGeoJSONBbox(geojson: GeoJSON.FeatureCollection): Cesium.Rectangle | undefined {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const f of geojson.features) {
    const coords = extractCoords(f.geometry);
    for (const [lon, lat] of coords) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!isFinite(minLon)) return undefined;
  return new Cesium.Rectangle(
    Cesium.Math.toRadians(minLon), Cesium.Math.toRadians(minLat),
    Cesium.Math.toRadians(maxLon), Cesium.Math.toRadians(maxLat),
  );
}

function extractCoords(geometry: GeoJSON.Geometry | null): Array<[number, number]> {
  if (!geometry) return [];
  if (geometry.type === 'Point') return [(geometry.coordinates as [number, number])];
  if (geometry.type === 'MultiPoint') return geometry.coordinates as Array<[number, number]>;
  if (geometry.type === 'LineString') return geometry.coordinates as Array<[number, number]>;
  if (geometry.type === 'MultiLineString') {
    const result: Array<[number, number]> = [];
    for (const line of geometry.coordinates) result.push(...line as Array<[number, number]>);
    return result;
  }
  if (geometry.type === 'Polygon') return geometry.coordinates[0] as Array<[number, number]>;
  if (geometry.type === 'MultiPolygon') {
    const result: Array<[number, number]> = [];
    for (const poly of geometry.coordinates) result.push(...poly[0] as Array<[number, number]>);
    return result;
  }
  return [];
}

/* ── Helper: extract outer ring from GeoJSON geometry ── */
function getOuterRing(geometry: GeoJSON.Geometry | null): Array<[number, number]> | null {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') return geometry.coordinates[0] as Array<[number, number]>;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates[0][0] as Array<[number, number]>;
  return null;
}

/* ── Turf.js data entity filtering (hide entities outside study area) ── */
const hiddenEntityIds = new Set<string>();

function positionsToDegCoords(positions: Cesium.Cartesian3[]): Array<[number, number]> {
  return positions.map(p => {
    const c = Cesium.Cartographic.fromCartesian(p);
    return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
  });
}

function expandRectCoords(coords: Array<[number, number]>): Array<[number, number]> {
  if (coords.length >= 4) return coords;
  const [lon0, lat0] = coords[0];
  const [lon1, lat1] = coords[1];
  const west = Math.min(lon0, lon1);
  const east = Math.max(lon0, lon1);
  const south = Math.min(lat0, lat1);
  const north = Math.max(lat0, lat1);
  return [[west, north], [east, north], [east, south], [west, south], [west, north]];
}

function buildTurfPolygons(items: StudyAreaItem[]): ReturnType<typeof polygon>[] {
  const result: ReturnType<typeof polygon>[] = [];
  for (const item of items) {
    if (!item.visible) continue;
    if (item.geojson) {
      for (const f of item.geojson.features) {
        const ring = getOuterRing(f.geometry);
        if (ring && ring.length >= 3) {
          result.push(polygon([ring]));
        }
      }
    } else if (item.positions && item.positions.length >= 2) {
      let coords = positionsToDegCoords(item.positions);
      if (item.type === 'rectangle') coords = expandRectCoords(coords);
      if (coords.length >= 3) {
        if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
          coords.push(coords[0]);
        }
        result.push(polygon([coords]));
      }
    }
  }
  return result;
}

export function filterDataEntitiesByStudyArea(
  viewer: Cesium.Viewer,
  items: StudyAreaItem[],
  active: boolean,
  activeOnlyId?: string,
): void {
  if (!active) {
    restoreHiddenEntities(viewer);
    return;
  }
  const itemsToFilter = activeOnlyId ? items.filter(i => i.id === activeOnlyId) : items;
  const turfPolygons = buildTurfPolygons(itemsToFilter);
  if (turfPolygons.length === 0) return;

  hiddenEntityIds.clear();

  const allEntities: Cesium.Entity[] = [];
  allEntities.push(...viewer.entities.values);
  for (let i = 0; i < viewer.dataSources.length; i++) {
    const ds = viewer.dataSources.get(i);
    if (ds && ds.entities) {
      allEntities.push(...ds.entities.values);
    }
  }

  for (const entity of allEntities) {
    if (!entity.position) continue;
    const posVal = entity.position.getValue(Cesium.JulianDate.now());
    if (!posVal) continue;
    const carto = Cesium.Cartographic.fromCartesian(posVal);
    if (!carto) continue;
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    const pt = point([lon, lat]);
    let inside = false;
    for (const poly of turfPolygons) {
      if (booleanPointInPolygon(pt, poly)) { inside = true; break; }
    }
    if (!inside && entity.id) {
      hiddenEntityIds.add(entity.id);
      entity.show = false;
    }
  }
  viewer.scene.requestRender();
}

export function restoreHiddenEntities(viewer: Cesium.Viewer): void {
  const allEntities: Cesium.Entity[] = [];
  allEntities.push(...viewer.entities.values);
  for (let i = 0; i < viewer.dataSources.length; i++) {
    const ds = viewer.dataSources.get(i);
    if (ds && ds.entities) {
      allEntities.push(...ds.entities.values);
    }
  }
  for (const entity of allEntities) {
    if (entity.id && hiddenEntityIds.has(entity.id)) {
      entity.show = true;
    }
  }
  hiddenEntityIds.clear();
  viewer.scene.requestRender();
}

export function removeStudyAreaFromGlobe(
  viewer: Cesium.Viewer,
  item: StudyAreaItem,
): void {
  if (item.dataSource) {
    viewer.dataSources.remove(item.dataSource, true);
    item.dataSource = undefined;
  }
  if (item.entity) {
    viewer.entities.remove(item.entity);
    item.entity = undefined;
  }
  if (item.outlinePrimitive) {
    viewer.scene.groundPrimitives.remove(item.outlinePrimitive);
    item.outlinePrimitive = undefined;
  }
}

/* ── Build one batched GroundPolylinePrimitive for every polygon ring ──
 * Uses GroundPolylineGeometry — follows terrain precisely,
 * supports arbitrary width, batched into a single draw call. */
function buildOutlinePrimitive(
  viewer: Cesium.Viewer,
  item: StudyAreaItem,
  color: Cesium.Color,
  width: number,
): Cesium.GroundPolylinePrimitive | undefined {
  const instances: Cesium.GeometryInstance[] = [];
  const colorAttr = Cesium.ColorGeometryInstanceAttribute.fromColor(color);

  const addRing = (positions: Cesium.Cartesian3[]) => {
    if (positions.length < 3) return;
    /* Strip closing point if present (loop:true handles closure), and
       remove consecutive duplicates to avoid GroundPolylineGeometry
       normalize errors from zero-length direction vectors. */
    let ring = positions;
    if (Cesium.Cartesian3.equals(ring[0], ring[ring.length - 1])) {
      ring = ring.slice(0, -1);
    }
    const deduped: Cesium.Cartesian3[] = [ring[0]];
    for (let i = 1; i < ring.length; i++) {
      if (!Cesium.Cartesian3.equals(ring[i], deduped[deduped.length - 1])) {
        deduped.push(ring[i]);
      }
    }
    if (deduped.length < 2) return;
    instances.push(new Cesium.GeometryInstance({
      geometry: new Cesium.GroundPolylineGeometry({ positions: deduped, loop: true, width }),
      attributes: { color: colorAttr },
    }));
  };

  const addHierarchy = (hier: Cesium.PolygonHierarchy) => {
    if (hier.positions && hier.positions.length >= 2) addRing(hier.positions);
    if (hier.holes) for (const hole of hier.holes) addHierarchy(hole);
  };

  /* Data source entities (GeoJSON / shapefile) */
  if (item.dataSource) {
    for (const entity of item.dataSource.entities.values) {
      if (entity.polygon && entity.polygon.hierarchy) {
        const hierVal = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now());
        if (hierVal) addHierarchy(hierVal);
      }
    }
  }

  /* Drawn shapes */
  if (item.entity) {
    const drawnHier = item.entity.polygon?.hierarchy?.getValue(Cesium.JulianDate.now());
    if (drawnHier) {
      addHierarchy(drawnHier);
    } else if (item.entity.rectangle) {
      /* Rectangle: entity.rectangle.coordinates → 4 corners */
      const rect = item.entity.rectangle.coordinates?.getValue(Cesium.JulianDate.now());
      if (rect) {
        const { west, south, east, north } = rect;
        addRing([
          Cesium.Cartesian3.fromRadians(west, north),
          Cesium.Cartesian3.fromRadians(east, north),
          Cesium.Cartesian3.fromRadians(east, south),
          Cesium.Cartesian3.fromRadians(west, south),
          Cesium.Cartesian3.fromRadians(west, north),
        ]);
      }
    } else if (item.positions && item.positions.length >= 3) {
      addRing(item.positions);
    }
  }

  if (instances.length === 0) return undefined;

  const primitive = new Cesium.GroundPolylinePrimitive({
    geometryInstances: instances,
    appearance: new Cesium.PolylineColorAppearance(),
    asynchronous: true,
  });
  viewer.scene.groundPrimitives.add(primitive);
  return primitive;
}

/* ── Update study area outline style (color + width) ── */
export function updateStudyAreaStyle(
  viewer: Cesium.Viewer,
  item: StudyAreaItem,
  newColor: string,
  newWidth: number,
): void {
  const c = Cesium.Color.fromCssColorString(newColor);

  /* Remove old outline primitive */
  if (item.outlinePrimitive) {
    viewer.scene.groundPrimitives.remove(item.outlinePrimitive);
    item.outlinePrimitive = undefined;
  }

  /* Update base rendering — transparent fill (outline is handled by GroundPolylinePrimitive) */
  const transparent = c.withAlpha(0) as unknown as Cesium.MaterialProperty;
  if (item.dataSource) {
    for (const entity of item.dataSource.entities.values) {
      if (entity.polygon) {
        entity.polygon.material = transparent;
      }
    }
  }
  if (item.entity) {
    const rect = item.entity.rectangle;
    if (rect) rect.material = transparent;
    const poly = item.entity.polygon;
    if (poly) poly.material = transparent;
  }

  /* Build batched GroundPolylinePrimitive for all rings */
  if (newWidth > 0) {
    item.outlinePrimitive = buildOutlinePrimitive(viewer, item, c, newWidth);
  }

  item.color = newColor;
  item.width = newWidth;
  viewer.scene.requestRender();
}

export function setStudyAreaVisibility(
  viewer: Cesium.Viewer,
  item: StudyAreaItem,
  visible: boolean,
): void {
  if (item.dataSource) {
    item.dataSource.show = visible;
  }
  if (item.entity) {
    item.entity.show = visible;
  }
  if (item.outlinePrimitive) {
    item.outlinePrimitive.show = visible;
  }
  viewer.scene.requestRender();
}

export function setStudyAreaActive(
  viewer: Cesium.Viewer,
  item: StudyAreaItem,
  active: boolean,
): void {
  item.active = active;
  if (active) {
    updateStudyAreaStyle(viewer, item, '#22c55e', 4);
  } else {
    updateStudyAreaStyle(viewer, item, '#6b7280', 1);
  }
}

export function exportToGeoJSON(items: StudyAreaItem[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const item of items) {
    if (item.geojson) {
      features.push(...item.geojson.features);
    } else if (item.positions && item.positions.length >= 2) {
      const coords = item.positions.map(p => {
        const carto = Cesium.Cartographic.fromCartesian(p);
        return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
      });
      if (item.type === 'polygon') {
        coords.push(coords[0]);
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [coords] } as GeoJSON.Polygon,
          properties: { name: item.name, type: item.type },
        });
      } else if (item.type === 'rectangle' && coords.length >= 2) {
        const west = coords[0][0]; const south = coords[0][1];
        const east = coords[1][0]; const north = coords[1][1];
        const rectCoords: number[][] = [
          [west, north], [east, north], [east, south], [west, south], [west, north],
        ];
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [rectCoords] } as GeoJSON.Polygon,
          properties: { name: item.name, type: item.type },
        });
      } else if (item.type === 'circle' && coords.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coords[0] } as GeoJSON.Point,
          properties: { name: item.name, type: item.type, radiusMeters: item.positions[2] },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

export function downloadJSON(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.geojson') ? filename : `${filename}.geojson`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function createRectangleEntity(
  viewer: Cesium.Viewer,
  west: number, south: number, east: number, north: number,
  color: string,
  name: string,
): Cesium.Entity {
  const c = Cesium.Color.fromCssColorString(color);
  const entity = viewer.entities.add({
    name,
    rectangle: {
      coordinates: new Cesium.Rectangle(
        Cesium.Math.toRadians(west),
        Cesium.Math.toRadians(south),
        Cesium.Math.toRadians(east),
        Cesium.Math.toRadians(north),
      ),
      material: c.withAlpha(0.1),
      outline: true,
      outlineColor: c,
      outlineWidth: 2,
    },
  });
  return entity;
}

export function positionsToGeoJSON(
  positions: Cesium.Cartesian3[],
  type: 'Polygon' | 'LineString',
  name: string,
): GeoJSON.Feature {
  const coords = positions.map(p => {
    const carto = Cesium.Cartographic.fromCartesian(p);
    return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
  });
  if (type === 'Polygon') coords.push(coords[0]);
  const geometry: GeoJSON.Geometry = type === 'Polygon'
    ? { type: 'Polygon', coordinates: [coords] }
    : { type: 'LineString', coordinates: coords };
  return {
    type: 'Feature',
    geometry,
    properties: { name },
  };
}

export async function parseFileToGeoJSON(file: File): Promise<Array<{
  name: string;
  geojson: GeoJSON.FeatureCollection;
  format: 'geojson' | 'shapefile';
}>> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'geojson' || ext === 'json') {
    const text = await file.text();
    const data = JSON.parse(text);
    let geojson: GeoJSON.FeatureCollection;
    if (data.type === 'FeatureCollection') {
      geojson = data as GeoJSON.FeatureCollection;
    } else if (data.type === 'Feature') {
      geojson = { type: 'FeatureCollection', features: [data] };
    } else {
      throw new Error('Invalid GeoJSON file');
    }
    return [{ name: file.name.replace(/\.[^/.]+$/, ''), geojson, format: 'geojson' }];
  }

  if (ext === 'zip' || ext === 'shp') {
    const shp = await import('shpjs');
    const buffer = await file.arrayBuffer();
    const result = await shp.default(buffer);
    const entries: Array<{ name: string; geojson: GeoJSON.FeatureCollection; format: 'geojson' | 'shapefile' }> = [];
    const rawList: Array<{ type?: string; fileName?: string; features?: GeoJSON.Feature[] }> = Array.isArray(result) ? result as Array<{ type?: string; fileName?: string; features?: GeoJSON.Feature[] }> : [result];
    for (const r of rawList) {
      const name = rawList.length > 1 && r.fileName
        ? r.fileName.replace(/\.[^/.]+$/, '')
        : file.name.replace(/\.[^/.]+$/, '');
      if (r.type === 'FeatureCollection') {
        entries.push({ name, geojson: r as GeoJSON.FeatureCollection, format: 'shapefile' });
      } else {
        throw new Error('Shapefile did not parse to GeoJSON');
      }
    }
    return entries;
  }

  throw new Error(`Unsupported file format: .${ext}. Use .geojson, .json, .zip (shapefile), or .shp`);
}
